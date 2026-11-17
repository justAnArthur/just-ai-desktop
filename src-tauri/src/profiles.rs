use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileInfo {
    config_dir: String,
    signed_in: bool,
    email: Option<String>,
    display_name: Option<String>,
    organization_name: Option<String>,
    organization_type: Option<String>,
    rate_limit_tier: Option<String>,
    default_model: Option<String>,
    base_url: Option<String>,
}

// Only the fields we show: the rest of `.claude.json` (and every token) is never deserialized.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Account {
    oauth_account: Option<OauthAccount>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct OauthAccount {
    email_address: Option<String>,
    display_name: Option<String>,
    organization_name: Option<String>,
    organization_type: Option<String>,
    organization_rate_limit_tier: Option<String>,
    user_rate_limit_tier: Option<String>,
}

#[derive(Deserialize)]
struct Settings {
    model: Option<String>,
    env: Option<Env>,
}

#[derive(Deserialize)]
struct Env {
    #[serde(rename = "ANTHROPIC_BASE_URL")]
    base_url: Option<String>,
}

fn read<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

fn is_profile(dir: &Path) -> bool {
    dir.join(".claude.json").is_file() || dir.join("settings.json").is_file()
}

fn expand(home: &Path, dir: &str) -> PathBuf {
    match dir.strip_prefix('~') {
        Some(rest) => home.join(rest.trim_start_matches('/')),
        None => PathBuf::from(dir),
    }
}

fn info(home: &Path, dir: &Path) -> ProfileInfo {
    let default = home.join(".claude");
    // Claude Code keeps the default profile's account beside its dir, in $HOME.
    let account_file = if dir == default { home.join(".claude.json") } else { dir.join(".claude.json") };
    let account = read::<Account>(&account_file).and_then(|a| a.oauth_account);
    let settings = read::<Settings>(&dir.join("settings.json"));
    let (default_model, base_url) = match settings {
        Some(s) => (s.model, s.env.and_then(|e| e.base_url)),
        None => (None, None),
    };
    let signed_in = account.is_some();
    let a = account.unwrap_or_default();
    ProfileInfo {
        config_dir: dir.to_string_lossy().into_owned(),
        signed_in,
        email: a.email_address,
        display_name: a.display_name,
        organization_name: a.organization_name,
        organization_type: a.organization_type,
        rate_limit_tier: a.user_rate_limit_tier.or(a.organization_rate_limit_tier),
        default_model,
        base_url,
    }
}

pub fn discover(home: &Path, extra: &[String]) -> Vec<PathBuf> {
    let default = home.join(".claude");
    let mut dirs: Vec<PathBuf> = fs::read_dir(home)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with(".claude-"))
                && is_profile(path)
        })
        .collect();
    if default.is_dir() {
        dirs.push(default.clone());
    }
    dirs.extend(
        extra
            .iter()
            .map(|dir| expand(home, dir.trim_end_matches('/')))
            .filter(|dir| dir.is_dir()),
    );
    dirs.sort_by(|a, b| (*a != default, a.file_name(), a).cmp(&(*b != default, b.file_name(), b)));
    dirs.dedup();
    dirs
}

#[tauri::command]
pub async fn list_profiles(extra: Vec<String>) -> Vec<ProfileInfo> {
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
        return Vec::new();
    };
    discover(&home, &extra).iter().map(|dir| info(&home, dir)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    #[test]
    fn discovers_and_reads_profiles() {
        let home = std::env::temp_dir().join(format!("ai-desktop-profiles-{}", std::process::id()));
        let _ = fs::remove_dir_all(&home);
        write(&home.join(".claude/settings.json"), r#"{"model":"opus"}"#);
        write(
            &home.join(".claude.json"),
            r#"{"oauthAccount":{"emailAddress":"a@example.com","organizationType":"claude_max","organizationRateLimitTier":"default_claude_max_20x","userRateLimitTier":null},"oauthToken":"secret"}"#,
        );
        write(&home.join(".claude-work/.claude.json"), "not json");
        write(
            &home.join(".claude-glm/settings.json"),
            r#"{"env":{"ANTHROPIC_BASE_URL":"https://example.com/api"}}"#,
        );
        fs::create_dir_all(home.join(".claude-launcher-backups/old")).unwrap();
        fs::create_dir_all(home.join("custom")).unwrap();

        let dirs = discover(&home, &["~/custom/".into(), "~/.claude-work".into()]);
        let names: Vec<_> = dirs.iter().map(|d| d.file_name().unwrap().to_str().unwrap()).collect();
        assert_eq!(names, [".claude", ".claude-glm", ".claude-work", "custom"]);

        let default = info(&home, &dirs[0]);
        assert!(default.signed_in);
        assert_eq!(default.email.as_deref(), Some("a@example.com"));
        assert_eq!(default.rate_limit_tier.as_deref(), Some("default_claude_max_20x"));
        assert_eq!(default.default_model.as_deref(), Some("opus"));

        let glm = info(&home, &dirs[1]);
        assert!(!glm.signed_in);
        assert_eq!(glm.base_url.as_deref(), Some("https://example.com/api"));
        assert!(!info(&home, &dirs[2]).signed_in);

        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    #[ignore = "reads this machine's real profiles"]
    fn prints_local_profiles() {
        let home = PathBuf::from(std::env::var_os("HOME").unwrap());
        for dir in discover(&home, &[]) {
            let p = info(&home, &dir);
            println!(
                "{} signedIn={} type={:?} tier={:?} model={:?}",
                dir.display(),
                p.signed_in,
                p.organization_type,
                p.rate_limit_tier,
                p.default_model
            );
        }
    }
}
