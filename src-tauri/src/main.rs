#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod profiles;

fn main() {
    app_core::builder()
        .invoke_handler(tauri::generate_handler![profiles::list_profiles])
        .run(tauri::generate_context!())
        .expect("error while running AI Desktop");
}
