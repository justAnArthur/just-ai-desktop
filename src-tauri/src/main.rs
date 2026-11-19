#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod git;

use claude_code::{auth, profiles, sessions};
use tauri::{Manager, RunEvent};

fn main() {
    app_core::builder()
        .manage(sessions::Sessions::default())
        .manage(sessions::Summaries::default())
        .manage(auth::Logins::default())
        .invoke_handler(tauri::generate_handler![
            git::git_status,
            git::git_stage,
            git::git_unstage,
            git::git_discard,
            git::git_commit,
            git::git_branches,
            profiles::list_profiles,
            profiles::create_profile_dir,
            auth::auth_status,
            auth::auth_login,
            auth::auth_write,
            auth::auth_cancel,
            auth::auth_logout,
            auth::auth_usage,
            sessions::session_start,
            sessions::session_write,
            sessions::session_kill,
            sessions::session_running,
            sessions::list_sessions,
            sessions::read_transcript,
            sessions::set_session_title,
        ])
        .build(tauri::generate_context!())
        .expect("error while building JustAIDesktop")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<sessions::Sessions>().kill_all();
                app.state::<auth::Logins>().kill_all();
            }
        });
}
