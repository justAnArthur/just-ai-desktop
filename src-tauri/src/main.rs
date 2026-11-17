#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    app_core::builder()
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error while running Agents");
}
