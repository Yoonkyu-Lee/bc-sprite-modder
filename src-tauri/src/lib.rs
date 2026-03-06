mod commands;
mod canvas_editor;
mod viewport;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    eprintln!("[init] Tauri Builder 시작");
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            commands::workspace::get_workspace,
            commands::workspace::set_workspace,
            commands::workspace::ensure_workspace_structure,
            commands::data_setup::run_data_setup,
            commands::data_setup::scan_datasets,
            commands::data_setup::extract_packs,
            commands::project::list_datasets,
            commands::project::list_projects,
            commands::project::create_project,
            commands::sprite::build_manifest,
            commands::sprite::list_unit_forms,
            commands::sprite::load_form_assets,
            commands::sprite::extract_viewport_assets,
            commands::sprite::get_viewport_meta,
            commands::sprite::get_viewport_playback_data,
            commands::canvas_editor::canvas_editor_create_session,
            commands::canvas_editor::canvas_editor_get_status,
            commands::canvas_editor::canvas_editor_get_snapshot,
            commands::canvas_editor::canvas_editor_get_move_preview_data,
            commands::canvas_editor::canvas_editor_dispatch_pointer,
            commands::canvas_editor::canvas_editor_dispatch_shortcut,
            commands::canvas_editor::canvas_editor_set_tool,
            commands::canvas_editor::canvas_editor_set_selection_mode,
            commands::canvas_editor::canvas_editor_set_active_color,
            commands::canvas_editor::canvas_editor_set_view,
            commands::canvas_editor::canvas_editor_undo,
            commands::canvas_editor::canvas_editor_redo,
        ])
        .setup(|_app| {
            eprintln!("[init] Tauri setup (윈도우 생성 직전)");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
