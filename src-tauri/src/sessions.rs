use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, UNIX_EPOCH};
use std::{env, thread};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::profiles::expand;

const STDERR_LINES: usize = 40;
const TAIL_BYTES: u64 = 256 * 1024;
const HEAD_BYTES: u64 = 8 * 1024 * 1024;
const TITLE_CHARS: usize = 80;

struct Live {
    pid: u32,
    stdin: ChildStdin,
}

#[derive(Default)]
pub struct Sessions(Arc<Mutex<HashMap<String, Live>>>);

impl Sessions {
    fn signal(&self, key: &str, signal: i32) -> Option<u32> {
        let live = self.0.lock().unwrap();
        let pid = live.get(key)?.pid;
        // Each session leads its own process group, so its tools (shells, servers) go down with it.
        unsafe { libc::kill(-(pid as i32), signal) };
        Some(pid)
    }

    fn alive(&self, key: &str, pid: u32) -> bool {
        self.0.lock().unwrap().get(key).is_some_and(|live| live.pid == pid)
    }

    pub fn kill_all(&self) {
        let keys: Vec<String> = self.0.lock().unwrap().keys().cloned().collect();
        for key in &keys {
            self.signal(key, libc::SIGTERM);
        }
        let deadline = Instant::now() + Duration::from_secs(1);
        while !self.0.lock().unwrap().is_empty() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(50));
        }
        for key in &keys {
            self.signal(key, libc::SIGKILL);
        }
    }
}

#[derive(Serialize, Clone)]
struct LinePayload<'a> {
    key: &'a str,
    line: String,
}

#[derive(Serialize, Clone)]
struct ExitPayload {
    key: String,
    code: Option<i32>,
    stderr: String,
}

fn home() -> PathBuf {
    env::var_os("HOME").map(PathBuf::from).unwrap_or_default()
}

/// The login shell's PATH: a GUI app launched from Finder only gets launchd's bare one.
pub(crate) fn shell_path() -> &'static str {
    static PATH: OnceLock<String> = OnceLock::new();
    PATH.get_or_init(|| {
        let fallback = env::var("PATH").unwrap_or_default();
        let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        let Ok(mut child) = Command::new(shell)
            .args(["-ilc", r#"printf '\n__AID_PATH__%s__AID_PATH__' "$PATH""#])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        else {
            return fallback;
        };
        let deadline = Instant::now() + Duration::from_secs(5);
        while child.try_wait().ok().flatten().is_none() {
            if Instant::now() > deadline {
                let _ = child.kill();
                let _ = child.wait();
                return fallback;
            }
            thread::sleep(Duration::from_millis(20));
        }
        let mut out = String::new();
        let _ = child.stdout.take().map(|mut s| s.read_to_string(&mut out));
        out.split("__AID_PATH__").nth(1).filter(|p| !p.is_empty()).map_or(fallback, str::to_owned)
    })
}

fn find_claude(path: &str) -> Option<PathBuf> {
    let home = home();
    env::split_paths(path)
        .map(|dir| dir.join("claude"))
        .chain([
            home.join(".local/bin/claude"),
            "/opt/homebrew/bin/claude".into(),
            "/usr/local/bin/claude".into(),
        ])
        .find(|bin| fs::metadata(bin).is_ok_and(|m| m.is_file()))
}

// Markers of the Claude Code session this app may itself have been launched from; a nested `claude`
// would otherwise join that session or reuse its account and endpoint.
fn inherited(name: &str) -> bool {
    name.starts_with("CLAUDE") || name.starts_with("ANTHROPIC_") || name == "AI_AGENT"
}

fn command(bin: &Path, config_dir: &Path, cwd: &Path, args: &[String]) -> Command {
    let mut cmd = Command::new(bin);
    cmd.args([
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-prompts",
        "host",
        // `host` alone auto-denies every ask; `stdio` makes them arrive as `can_use_tool` control requests.
        "--permission-prompt-tool",
        "stdio",
    ])
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .env("PATH", shell_path());
    for (name, _) in env::vars_os() {
        if name.to_str().is_some_and(inherited) {
            cmd.env_remove(name);
        }
    }
    // The default profile keeps its account in ~/.claude.json, which Claude Code reads only when the variable is unset.
    if config_dir != home().join(".claude") {
        cmd.env("CLAUDE_CONFIG_DIR", config_dir);
    }
    cmd
}

#[tauri::command]
pub async fn session_start(
    app: AppHandle,
    sessions: State<'_, Sessions>,
    key: String,
    config_dir: String,
    cwd: String,
    args: Vec<String>,
) -> Result<(), String> {
    let home = home();
    let config_dir = expand(&home, config_dir.trim_end_matches('/'));
    let cwd = expand(&home, &cwd);
    if !cwd.is_dir() {
        return Err(format!("no such directory: {}", cwd.display()));
    }
    let bin = find_claude(shell_path()).ok_or("claude not found on PATH")?;
    let mut live = sessions.0.lock().unwrap();
    if live.contains_key(&key) {
        return Err(format!("session {key} is already running"));
    }
    let mut child = command(&bin, &config_dir, &cwd, &args).spawn().map_err(|e| format!("failed to start claude: {e}"))?;
    let stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let pid = child.id();
    live.insert(key.clone(), Live { pid, stdin });
    drop(live);

    let tail = thread::spawn(move || {
        let mut tail = VecDeque::with_capacity(STDERR_LINES);
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if tail.len() == STDERR_LINES {
                tail.pop_front();
            }
            tail.push_back(line);
        }
        Vec::from(tail).join("\n")
    });
    let map = sessions.0.clone();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let _ = app.emit("session://line", LinePayload { key: &key, line });
        }
        let stderr = tail.join().unwrap_or_default();
        let code = child.wait().ok().and_then(|status| status.code());
        let mut live = map.lock().unwrap();
        if live.get(&key).is_some_and(|l| l.pid == pid) {
            live.remove(&key);
        }
        drop(live);
        let _ = app.emit("session://exit", ExitPayload { key, code, stderr });
    });
    Ok(())
}

#[tauri::command]
pub fn session_write(sessions: State<'_, Sessions>, key: String, line: String) -> Result<(), String> {
    let mut live = sessions.0.lock().unwrap();
    let session = live.get_mut(&key).ok_or_else(|| format!("session {key} is not running"))?;
    writeln!(session.stdin, "{line}").and_then(|_| session.stdin.flush()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn session_kill(app: AppHandle, key: String) -> Result<(), String> {
    let sessions = app.state::<Sessions>();
    let pid = sessions.signal(&key, libc::SIGTERM).ok_or_else(|| format!("session {key} is not running"))?;
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(2));
        let sessions = app.state::<Sessions>();
        if sessions.alive(&key, pid) {
            sessions.signal(&key, libc::SIGKILL);
        }
    });
    Ok(())
}

#[tauri::command]
pub fn session_running(sessions: State<'_, Sessions>) -> Vec<String> {
    sessions.0.lock().unwrap().keys().cloned().collect()
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    id: String,
    cwd: String,
    title: Option<String>,
    updated: u64,
    git_branch: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct Entry {
    #[serde(rename = "type")]
    kind: String,
    cwd: Option<String>,
    git_branch: Option<String>,
    custom_title: Option<String>,
    summary: Option<String>,
    is_sidechain: bool,
    is_meta: bool,
    message: Option<Message>,
}

#[derive(Deserialize)]
struct Message {
    content: Content,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Content {
    Text(String),
    Blocks(Vec<Block>),
}

#[derive(Deserialize)]
struct Block {
    text: Option<String>,
}

impl Entry {
    fn prompt(&self) -> Option<String> {
        if self.kind != "user" || self.is_meta || self.is_sidechain {
            return None;
        }
        let texts: Vec<&str> = match &self.message.as_ref()?.content {
            Content::Text(text) => vec![text],
            Content::Blocks(blocks) => blocks.iter().filter_map(|b| b.text.as_deref()).collect(),
        };
        // Wrapped text (`<command-name>`, `<system-reminder>`, ...) is the harness talking, not the user.
        let text = texts.into_iter().map(str::trim).find(|t| !t.is_empty() && !t.starts_with('<'))?;
        let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
        Some(match text.char_indices().nth(TITLE_CHARS) {
            Some((end, _)) => format!("{}…", &text[..end]),
            None => text,
        })
    }
}

fn entries(reader: impl BufRead) -> impl Iterator<Item = Entry> {
    reader.lines().map_while(Result::ok).filter_map(|line| serde_json::from_str(&line).ok())
}

fn summarize(path: &Path, updated: u64) -> Option<SessionSummary> {
    let mut file = File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let start = len.saturating_sub(TAIL_BYTES);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut tail = BufReader::new(&mut file);
    if start > 0 {
        tail.read_until(b'\n', &mut Vec::new()).ok()?;
    }
    let (mut cwd, mut git_branch, mut title, mut summary) = (None, None, None, None);
    for entry in entries(tail) {
        if entry.kind == "custom-title" {
            title = entry.custom_title.or(title);
        } else if entry.kind == "summary" {
            summary = entry.summary.or(summary);
        } else if !entry.is_sidechain {
            cwd = entry.cwd.or(cwd);
            git_branch = entry.git_branch.or(git_branch);
        }
    }
    let mut title = title.or(summary);
    if title.is_none() || cwd.is_none() {
        file.seek(SeekFrom::Start(0)).ok()?;
        for entry in entries(BufReader::new(file.take(HEAD_BYTES))) {
            if cwd.is_none() && !entry.is_sidechain {
                cwd = entry.cwd.clone();
                git_branch = git_branch.or(entry.git_branch.clone());
            }
            title = title.or_else(|| entry.prompt());
            if title.is_some() && cwd.is_some() {
                break;
            }
        }
    }
    Some(SessionSummary {
        id: path.file_stem()?.to_str()?.to_owned(),
        cwd: cwd?,
        title,
        updated,
        git_branch: git_branch.filter(|b| !b.is_empty()),
    })
}

// Only `projects/<dir>/<id>.jsonl`: subagent transcripts live one level deeper, under `<id>/subagents/`.
fn transcripts(config_dir: &Path) -> impl Iterator<Item = PathBuf> {
    fs::read_dir(config_dir.join("projects"))
        .into_iter()
        .flatten()
        .flatten()
        .flat_map(|project| fs::read_dir(project.path()).into_iter().flatten().flatten())
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "jsonl") && path.is_file())
}

#[derive(Serialize, Deserialize, Clone)]
struct Cached {
    updated: u64,
    len: u64,
    summary: Option<SessionSummary>,
}

/// Summaries by transcript, kept while its mtime and size hold: a refresh re-reads only the files that changed.
/// Saved to a file, so a launch lists warm too.
#[derive(Default)]
pub struct Summaries {
    map: Mutex<HashMap<PathBuf, Cached>>,
    file: OnceLock<Option<PathBuf>>,
}

impl Summaries {
    /// Loads the saved summaries on first use; a missing or unreadable file starts empty.
    pub fn saved_at(&self, file: impl FnOnce() -> Option<PathBuf>) -> &Self {
        self.file.get_or_init(|| {
            let file = file()?;
            if let Some(saved) = fs::read(&file).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()) {
                *self.map.lock().unwrap() = saved;
            }
            Some(file)
        });
        self
    }

    fn save(&self, map: &HashMap<PathBuf, Cached>) {
        let Some(Some(file)) = self.file.get() else { return };
        // Through a temp file: a crash mid-write leaves the old cache, not half a new one.
        let tmp = file.with_extension("tmp");
        let written = file.parent().map_or(Ok(()), fs::create_dir_all).and_then(|_| {
            fs::write(&tmp, serde_json::to_vec(map).map_err(std::io::Error::other)?)?;
            fs::rename(&tmp, file)
        });
        if let Err(e) = written {
            eprintln!("[sessions] saving {}: {e}", file.display());
        }
    }
}

pub fn sessions_in(config_dir: &Path, limit: usize, cache: &Summaries) -> Vec<SessionSummary> {
    let mut files: Vec<(PathBuf, u64, u64)> = transcripts(config_dir)
        .filter_map(|path| {
            let meta = path.metadata().ok()?;
            let updated = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64;
            Some((path, updated, meta.len()))
        })
        .collect();
    files.sort_by(|a, b| b.1.cmp(&a.1));
    let seen: HashSet<PathBuf> = files.iter().map(|(path, ..)| path.clone()).collect();
    let mut changed = false;
    // Locked per file, not across the reads: the profiles list in parallel.
    let found = files
        .into_iter()
        .filter_map(|(path, updated, len)| {
            let hit = cache.map.lock().unwrap().get(&path).filter(|c| c.updated == updated && c.len == len).map(|c| c.summary.clone());
            hit.unwrap_or_else(|| {
                let summary = summarize(&path, updated);
                cache.map.lock().unwrap().insert(path, Cached { updated, len, summary: summary.clone() });
                changed = true;
                summary
            })
        })
        .take(limit)
        .collect();
    let projects = config_dir.join("projects");
    let mut map = cache.map.lock().unwrap();
    let before = map.len();
    map.retain(|path, _| !path.starts_with(&projects) || seen.contains(path));
    if changed || map.len() != before {
        cache.save(&map);
    }
    found
}

#[tauri::command]
pub async fn list_sessions(
    app: AppHandle,
    cache: State<'_, Summaries>,
    config_dir: String,
    limit: Option<usize>,
) -> Result<Vec<SessionSummary>, String> {
    // Versioned: a summary of another shape is not read back.
    let cache = cache.saved_at(|| app.path().app_cache_dir().ok().map(|dir| dir.join("summaries-v1.json")));
    Ok(sessions_in(&expand(&home(), config_dir.trim_end_matches('/')), limit.unwrap_or(200), cache))
}

#[tauri::command]
pub async fn read_transcript(config_dir: String, session_id: String) -> Result<Vec<String>, String> {
    if session_id.is_empty() || session_id.contains(['/', '\\']) || session_id.starts_with('.') {
        return Err(format!("invalid session id: {session_id}"));
    }
    let config_dir = expand(&home(), config_dir.trim_end_matches('/'));
    let name = format!("{session_id}.jsonl");
    let path = transcripts(&config_dir)
        .find(|path| path.file_name().is_some_and(|n| *n == *name))
        .ok_or_else(|| format!("no transcript for session {session_id}"))?;
    let file = File::open(path).map_err(|e| e.to_string())?;
    Ok(BufReader::new(file).lines().map_while(Result::ok).filter_map(|line| slim(&line)).collect())
}

/// What the transcript view reads of an entry: user and assistant messages, without image data or tool-result
/// copies (`toolUseResult`), which can make a transcript hundreds of MB.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Slim {
    #[serde(rename = "type")]
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    permission_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    uuid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    timestamp: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    is_sidechain: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    is_meta: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    is_compact_summary: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    is_api_error_message: bool,
}

fn slim(line: &str) -> Option<String> {
    let mut entry: Slim = serde_json::from_str(line).ok()?;
    if entry.kind != "user" && entry.kind != "assistant" || entry.is_sidechain {
        return None;
    }
    if let Some(blocks) = entry.message.as_mut().and_then(|m| m.get_mut("content")).and_then(|c| c.as_array_mut()) {
        for block in blocks {
            strip_images(block);
            if let Some(inner) = block.get_mut("content").and_then(|c| c.as_array_mut()) {
                inner.iter_mut().for_each(strip_images);
            }
        }
    }
    serde_json::to_string(&entry).ok()
}

// The view counts images but never shows them.
fn strip_images(block: &mut serde_json::Value) {
    if block["type"] == "image" {
        if let Some(block) = block.as_object_mut() {
            block.remove("source");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    fn write(path: &Path, lines: &[&str]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, lines.join("\n") + "\n").unwrap();
    }

    #[test]
    fn lists_sessions_newest_first() {
        let dir = env::temp_dir().join(format!("ai-desktop-sessions-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let project = dir.join("projects/-Users-you-my-app");
        write(
            &project.join("old.jsonl"),
            &[
                r#"{"type":"file-history-snapshot","messageId":"m","snapshot":{}}"#,
                r#"{"type":"user","cwd":"/Users/you/my-app","gitBranch":"main","isMeta":true,"message":{"role":"user","content":"<local-command-caveat>x</local-command-caveat>"}}"#,
                r#"{"type":"user","cwd":"/Users/you/my-app","gitBranch":"main","message":{"role":"user","content":[{"type":"text","text":"<system-reminder>ctx</system-reminder>"},{"type":"text","text":"  Fix the\nlogin   bug please "}]}}"#,
                r#"{"type":"assistant","cwd":"/Users/you/my-app","gitBranch":"main","message":{"role":"assistant","content":[{"type":"tool_use","id":"t","name":"Bash","input":{}}]}}"#,
                "not json",
            ],
        );
        thread::sleep(Duration::from_millis(20));
        let long = "word ".repeat(40);
        write(
            &dir.join("projects/-Users-you-other/new.jsonl"),
            &[
                &format!(r#"{{"type":"user","cwd":"/Users/you/other","gitBranch":"","message":{{"role":"user","content":"{long}"}}}}"#),
                r#"{"type":"custom-title","customTitle":"Old name","sessionId":"new"}"#,
                r#"{"type":"custom-title","customTitle":"Renamed","sessionId":"new"}"#,
            ],
        );
        write(&project.join("old/subagents/agent-a1.jsonl"), &[r#"{"type":"user","cwd":"/x","message":{"content":"hi"}}"#]);
        write(&project.join("empty.jsonl"), &[r#"{"type":"file-history-snapshot"}"#]);

        let cache = Summaries::default();
        let all = sessions_in(&dir, 200, &cache);
        let ids: Vec<_> = all.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, ["new", "old"]);
        assert_eq!(all[0].title.as_deref(), Some("Renamed"));
        assert_eq!(all[0].cwd, "/Users/you/other");
        assert_eq!(all[0].git_branch, None);
        assert_eq!(all[1].title.as_deref(), Some("Fix the login bug please"));
        assert_eq!(all[1].git_branch.as_deref(), Some("main"));
        assert!(all[0].updated >= all[1].updated);
        assert_eq!(sessions_in(&dir, 1, &cache).len(), 1);
        assert_eq!(sessions_in(&dir, 200, &cache), all);

        let first = Entry {
            kind: "user".into(),
            message: Some(Message { content: Content::Text(long) }),
            ..Default::default()
        };
        assert_eq!(first.prompt().unwrap().chars().count(), TITLE_CHARS + 1);

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn keeps_summaries_across_launches() {
        let dir = env::temp_dir().join(format!("ai-desktop-saved-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let project = dir.join("projects/-Users-you-app");
        write(&project.join("a.jsonl"), &[r#"{"type":"user","cwd":"/Users/you/app","message":{"content":"Hello"}}"#]);
        let file = dir.join("cache/summaries.json");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, "{not json").unwrap();

        let first = Summaries::default();
        let listed = sessions_in(&dir, 200, first.saved_at(|| Some(file.clone())));
        assert_eq!(listed.len(), 1);

        let relaunch = Summaries::default();
        relaunch.saved_at(|| Some(file.clone()));
        assert_eq!(relaunch.map.lock().unwrap().len(), 1);
        assert_eq!(sessions_in(&dir, 200, &relaunch), listed);

        // A deleted transcript leaves the saved cache too.
        fs::remove_file(project.join("a.jsonl")).unwrap();
        assert!(sessions_in(&dir, 200, &relaunch).is_empty());
        let after = Summaries::default();
        after.saved_at(|| Some(file.clone()));
        assert!(after.map.lock().unwrap().is_empty());

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn slims_transcript_lines() {
        assert_eq!(slim(r#"{"type":"file-history-snapshot","snapshot":{}}"#), None);
        assert_eq!(slim(r#"{"type":"user","isSidechain":true,"message":{"content":"x"}}"#), None);
        let line = r#"{"type":"user","uuid":"u","cwd":"/x","toolUseResult":{"file":"big"},"message":{"role":"user","content":[{"type":"image","source":{"data":"AAAA"}},{"type":"tool_result","tool_use_id":"t","content":[{"type":"text","text":"ok"},{"type":"image","source":{"data":"BBBB"}}]}]}}"#;
        assert_eq!(
            slim(line).unwrap(),
            r#"{"type":"user","message":{"content":[{"type":"image"},{"content":[{"text":"ok","type":"text"},{"type":"image"}],"tool_use_id":"t","type":"tool_result"}],"role":"user"},"cwd":"/x","uuid":"u"}"#
        );
    }

    #[test]
    #[ignore = "starts a real claude session with haiku on this machine's default profile"]
    fn runs_a_real_session() {
        let cwd = env::temp_dir().join(format!("ai-desktop-live-{}", std::process::id()));
        fs::create_dir_all(&cwd).unwrap();
        let bin = find_claude(shell_path()).expect("claude on PATH");
        let args = ["--model".to_owned(), "haiku".to_owned()];
        let mut child = command(&bin, &home().join(".claude"), &cwd, &args).spawn().unwrap();
        let mut stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let _ = tx.send(line);
            }
        });
        writeln!(stdin, r#"{{"type":"user","message":{{"role":"user","content":"Reply with just: ok"}}}}"#).unwrap();
        let deadline = Instant::now() + Duration::from_secs(90);
        let mut types = Vec::new();
        let result = loop {
            let line = rx.recv_timeout(deadline - Instant::now()).expect("a result line before the deadline");
            let value: serde_json::Value = serde_json::from_str(&line).unwrap();
            types.push(value["type"].as_str().unwrap_or("?").to_owned());
            if value["type"] == "result" {
                break value;
            }
        };
        unsafe { libc::kill(-(child.id() as i32), libc::SIGTERM) };
        let _ = child.wait();
        let _ = fs::remove_dir_all(&cwd);
        println!("types={types:?} is_error={} subtype={}", result["is_error"], result["subtype"]);
    }
}
