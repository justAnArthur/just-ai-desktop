use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::sessions::shell_path;

const PATCH_BYTES: usize = 200 * 1024;
const PATCHED_FILES: usize = 200;
const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

#[derive(Serialize, Debug, PartialEq)]
pub struct Change {
    path: String,
    status: &'static str,
    staged: bool,
    patch: String,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    branch: Option<String>,
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    changes: Vec<Change>,
}

/// One `git status --porcelain=v2` record; untracked files have `x == y == '?'`.
struct Entry {
    x: char,
    y: char,
    path: String,
    orig: Option<String>,
}

fn git(root: &Path) -> Command {
    let mut cmd = Command::new("git");
    // Literal pathspecs: a file named `*.ts` must not stage every .ts file.
    cmd.arg("--literal-pathspecs")
        .arg("-C")
        .arg(root)
        .stdin(Stdio::null())
        .env("PATH", shell_path())
        // Reading status must not take index.lock away from the session's own git commands.
        .env("GIT_OPTIONAL_LOCKS", "0");
    cmd
}

fn run(cmd: &mut Command) -> Result<String, String> {
    let out = cmd.output().map_err(|e| format!("failed to run git: {e}"))?;
    if out.status.success() {
        return Ok(String::from_utf8_lossy(&out.stdout).into_owned());
    }
    // `git commit` with nothing staged explains itself on stdout.
    let text = if out.stderr.is_empty() { out.stdout } else { out.stderr };
    Err(String::from_utf8_lossy(&text).trim().to_owned())
}

fn root(cwd: &str) -> Result<PathBuf, String> {
    let cwd = Path::new(cwd);
    if !cwd.is_dir() {
        return Err(format!("no such directory: {}", cwd.display()));
    }
    Ok(PathBuf::from(run(git(cwd).args(["rev-parse", "--show-toplevel"]))?.trim_end()))
}

fn parse(out: &str, status: &mut GitStatus) -> (Vec<Entry>, bool) {
    let mut entries = Vec::new();
    let mut initial = false;
    let mut records = out.split('\0');
    while let Some(record) = records.next() {
        let (kind, rest) = record.split_once(' ').unwrap_or((record, ""));
        let fields = match kind {
            "#" => {
                let (key, value) = rest.split_once(' ').unwrap_or((rest, ""));
                match key {
                    "branch.oid" => initial = value == "(initial)",
                    "branch.head" if value != "(detached)" => status.branch = Some(value.into()),
                    "branch.upstream" => status.upstream = Some(value.into()),
                    "branch.ab" => {
                        let mut ab = value.split(' ').map(|n| n.trim_start_matches(['+', '-']).parse().unwrap_or(0));
                        status.ahead = ab.next().unwrap_or(0);
                        status.behind = ab.next().unwrap_or(0);
                    }
                    _ => {}
                }
                continue;
            }
            "?" => {
                entries.push(Entry { x: '?', y: '?', path: rest.into(), orig: None });
                continue;
            }
            "1" => 8,
            "2" => 9,
            "u" => 10,
            _ => continue,
        };
        let parts: Vec<&str> = rest.splitn(fields, ' ').collect();
        let (Some(xy), Some(path)) = (parts.first(), parts.get(fields - 1)) else { continue };
        let mut xy = xy.chars();
        let orig = if kind == "2" { records.next().map(str::to_owned) } else { None };
        entries.push(Entry {
            x: xy.next().unwrap_or('.'),
            y: xy.next().unwrap_or('.'),
            path: (*path).into(),
            orig,
        });
    }
    (entries, initial)
}

fn entries(root: &Path, status: &mut GitStatus) -> Result<(Vec<Entry>, bool), String> {
    let out = run(git(root).args(["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"]))?;
    Ok(parse(&out, status))
}

fn letter(c: char) -> &'static str {
    match c {
        'A' | 'C' | '?' => "added",
        'D' => "deleted",
        _ => "modified",
    }
}

/// Reads at most `PATCH_BYTES` of the diff, cut at a line, so one huge file can't stall the pane.
fn patch(cmd: &mut Command) -> String {
    let Ok(mut child) = cmd.stdout(Stdio::piped()).stderr(Stdio::null()).spawn() else {
        return String::new();
    };
    let mut out = Vec::new();
    let _ = child.stdout.take().unwrap().take(PATCH_BYTES as u64 + 1).read_to_end(&mut out);
    let _ = child.kill();
    let _ = child.wait();
    if out.len() > PATCH_BYTES {
        out.truncate(out[..PATCH_BYTES].iter().rposition(|&b| b == b'\n').map_or(0, |i| i + 1));
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// A file changed both in the index and the work tree is one unstaged row whose patch runs from HEAD:
/// the pane keys rows by path, so two rows for one file would stage, pick and revert together.
fn change(root: &Path, entry: &Entry, base: &str, patched: bool) -> Change {
    let (status, staged) = match (entry.x, entry.y) {
        (x, '.') => (letter(x), true),
        (x, y) => (letter(if x == '.' || y == 'D' { y } else { x }), false),
    };
    let mut cmd = git(root);
    cmd.args(["diff", "--no-color", "--no-ext-diff"]);
    match (entry.x, entry.y) {
        ('?', _) => cmd.args(["--no-index", "--", "/dev/null"]),
        (_, '.') => cmd.args(["--cached", "-M", "--"]),
        ('.', _) => cmd.arg("--"),
        _ => cmd.args(["-M", base, "--"]),
    };
    cmd.args(entry.orig.iter()).arg(&entry.path);
    let patch = if patched { patch(&mut cmd) } else { String::new() };
    Change { path: entry.path.clone(), status, staged, patch }
}

#[tauri::command]
pub async fn git_status(cwd: String) -> Result<GitStatus, String> {
    let root = root(&cwd)?;
    let mut status = GitStatus::default();
    let (entries, initial) = entries(&root, &mut status)?;
    let base = if initial { EMPTY_TREE } else { "HEAD" };
    status.changes = entries.iter().enumerate().map(|(i, e)| change(&root, e, base, i < PATCHED_FILES)).collect();
    Ok(status)
}

#[tauri::command]
pub async fn git_stage(cwd: String, paths: Vec<String>) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    run(git(&root(&cwd)?).args(["add", "-A", "--"]).args(&paths)).map(drop)
}

#[tauri::command]
pub async fn git_unstage(cwd: String, paths: Vec<String>) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let root = root(&cwd)?;
    let (entries, _) = entries(&root, &mut GitStatus::default())?;
    // A staged rename lists only its new path; unstaging that alone would leave the old one staged as deleted.
    let origs = entries.iter().filter(|e| paths.contains(&e.path)).filter_map(|e| e.orig.as_ref());
    // `reset`, not `restore --staged`: it also works before the first commit.
    run(git(&root).args(["reset", "-q", "--"]).args(&paths).args(origs)).map(drop)
}

/// Reverts the work tree only: tracked files go back to the index, untracked ones are deleted.
#[tauri::command]
pub async fn git_discard(cwd: String, paths: Vec<String>) -> Result<(), String> {
    let root = root(&cwd)?;
    let (entries, _) = entries(&root, &mut GitStatus::default())?;
    let (untracked, tracked): (Vec<&String>, Vec<&String>) =
        paths.iter().partition(|p| entries.iter().any(|e| e.x == '?' && e.path == **p));
    if !untracked.is_empty() {
        run(git(&root).args(["clean", "-f", "-q", "--"]).args(untracked))?;
    }
    if !tracked.is_empty() {
        run(git(&root).args(["restore", "--worktree", "--"]).args(tracked))?;
    }
    Ok(())
}

/// Commits the index; returns the new commit's short sha.
#[tauri::command]
pub async fn git_commit(cwd: String, message: String) -> Result<String, String> {
    let root = root(&cwd)?;
    run(git(&root).args(["commit", "-q", "-m", &message]))?;
    Ok(run(git(&root).args(["rev-parse", "--short", "HEAD"]))?.trim_end().to_owned())
}

/// Local branch names, the current one first.
#[tauri::command]
pub async fn git_branches(cwd: String) -> Result<Vec<String>, String> {
    let root = root(&cwd)?;
    let current = run(git(&root).args(["branch", "--show-current"]))?.trim_end().to_owned();
    let refs = run(git(&root).args(["for-each-ref", "--format=%(refname:lstrip=2)", "refs/heads/"]))?;
    let others = refs.lines().filter(|b| *b != current).map(str::to_owned);
    Ok(Some(current.clone()).filter(|c| !c.is_empty()).into_iter().chain(others).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tauri::async_runtime::block_on;

    fn sh(root: &Path, args: &[&str]) {
        run(git(root).args(args)).unwrap();
    }

    fn rows(status: &GitStatus) -> Vec<(&str, &str, bool)> {
        status.changes.iter().map(|c| (c.path.as_str(), c.status, c.staged)).collect()
    }

    #[test]
    fn reads_and_changes_a_repo() {
        let dir = std::env::temp_dir().join(format!("ai-desktop-git-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("src")).unwrap();
        let root = fs::canonicalize(&dir).unwrap();
        let cwd = root.join("src").to_str().unwrap().to_owned();
        sh(&root, &["init", "-q", "-b", "main"]);
        sh(&root, &["config", "user.name", "Test"]);
        sh(&root, &["config", "user.email", "test@example.com"]);
        sh(&root, &["config", "commit.gpgsign", "false"]);

        fs::write(root.join("src/a.ts"), "export const a = 1\n").unwrap();
        fs::write(root.join("old name.md"), "# notes\n\nline one\nline two\nline three\n").unwrap();
        fs::write(root.join("gone.txt"), "bye\n").unwrap();
        block_on(git_stage(cwd.clone(), vec!["src/a.ts".into()])).unwrap();
        let first = block_on(git_status(cwd.clone())).unwrap();
        assert_eq!(first.branch.as_deref(), Some("main"));
        assert_eq!(rows(&first), [("src/a.ts", "added", true), ("gone.txt", "added", false), ("old name.md", "added", false)]);
        assert!(first.changes[1].patch.contains("+bye"));
        block_on(git_unstage(cwd.clone(), vec!["src/a.ts".into()])).unwrap();
        block_on(git_stage(cwd.clone(), vec!["src/a.ts".into(), "old name.md".into(), "gone.txt".into()])).unwrap();
        let sha = block_on(git_commit(cwd.clone(), "init".into())).unwrap();
        assert!(sha.len() >= 7);
        assert!(block_on(git_commit(cwd.clone(), "again".into())).unwrap_err().contains("nothing"));

        sh(&root, &["mv", "old name.md", "new name.md"]);
        fs::write(root.join("src/a.ts"), "export const a = 2\n").unwrap();
        sh(&root, &["add", "src/a.ts"]);
        fs::write(root.join("src/a.ts"), "export const a = 3\n").unwrap();
        fs::remove_file(root.join("gone.txt")).unwrap();
        fs::write(root.join("src/*.ts"), "new\n").unwrap();

        let status = block_on(git_status(cwd.clone())).unwrap();
        assert_eq!((status.ahead, status.behind, status.upstream.as_deref()), (0, 0, None));
        assert_eq!(
            rows(&status),
            [
                ("gone.txt", "deleted", false),
                ("new name.md", "modified", true),
                ("src/a.ts", "modified", false),
                ("src/*.ts", "added", false),
            ]
        );
        let patch = |path: &str| &status.changes.iter().find(|c| c.path == path).unwrap().patch;
        assert!(patch("new name.md").contains("rename from old name.md"));
        assert!(patch("src/a.ts").contains("-export const a = 1") && patch("src/a.ts").contains("+export const a = 3"));
        assert!(patch("gone.txt").contains("-bye"));
        assert!(patch("src/*.ts").contains("+new"));

        block_on(git_unstage(cwd.clone(), vec!["new name.md".into()])).unwrap();
        let unstaged = block_on(git_status(cwd.clone())).unwrap();
        assert!(unstaged.changes.iter().any(|c| c.path == "old name.md" && c.status == "deleted" && !c.staged));
        assert!(unstaged.changes.iter().any(|c| c.path == "new name.md" && c.status == "added" && !c.staged));

        block_on(git_stage(cwd.clone(), vec!["src/*.ts".into()])).unwrap();
        let staged = block_on(git_status(cwd.clone())).unwrap();
        assert!(staged.changes.iter().any(|c| c.path == "src/*.ts" && c.staged));
        assert!(staged.changes.iter().any(|c| c.path == "src/a.ts" && !c.staged));

        block_on(git_discard(cwd.clone(), vec!["src/a.ts".into(), "new name.md".into(), "gone.txt".into()])).unwrap();
        assert!(!root.join("new name.md").exists());
        assert_eq!(fs::read_to_string(root.join("src/a.ts")).unwrap(), "export const a = 2\n");
        assert_eq!(fs::read_to_string(root.join("gone.txt")).unwrap(), "bye\n");

        sh(&root, &["branch", "a-feature"]);
        sh(&root, &["checkout", "-q", "-b", "z-current"]);
        assert_eq!(block_on(git_branches(cwd.clone())).unwrap(), ["z-current", "a-feature", "main"]);

        assert!(block_on(git_status(std::env::temp_dir().join("ai-desktop-no-such-dir").to_str().unwrap().into())).is_err());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn caps_patches() {
        let mut status = GitStatus::default();
        let (entries, initial) = parse("# branch.oid (initial)\0# branch.head (detached)\0# branch.ab +2 -3\0? a b.txt\0", &mut status);
        assert!(initial);
        assert_eq!((status.branch, status.ahead, status.behind), (None, 2, 3));
        assert_eq!(entries[0].path, "a b.txt");

        let big = format!("{}\n", "x".repeat(99)).repeat(PATCH_BYTES / 50);
        let text = patch(Command::new("printf").arg("%s").arg(&big));
        assert!(text.len() <= PATCH_BYTES && text.len() > PATCH_BYTES - 100 && text.ends_with('\n'));
    }
}
