#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod git;
mod profiles;
mod sessions;

use tauri::{Manager, RunEvent};

fn main() {
    app_core::builder()
        .manage(sessions::Sessions::default())
        .invoke_handler(tauri::generate_handler![
            git::git_status,
            git::git_stage,
            git::git_unstage,
            git::git_discard,
            git::git_commit,
            git::git_branches,
            profiles::list_profiles,
            sessions::session_start,
            sessions::session_write,
            sessions::session_kill,
            sessions::session_running,
            sessions::list_sessions,
            sessions::read_transcript,
        ])
        .build(tauri::generate_context!())
        .expect("error while building AI Desktop")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<sessions::Sessions>().kill_all();
            }
        });
}
