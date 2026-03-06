use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionArgs {
    pub session_id: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionArgs {
    pub session_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DispatchPointerArgs {
    pub session_id: String,
    pub input: crate::canvas_editor::types::PointerInput,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DispatchShortcutArgs {
    pub session_id: String,
    pub input: crate::canvas_editor::types::ShortcutInput,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetToolArgs {
    pub session_id: String,
    pub tool: crate::canvas_editor::types::ToolKind,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSelectionModeArgs {
    pub session_id: String,
    pub mode: crate::canvas_editor::types::SelectionMode,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetColorArgs {
    pub session_id: String,
    pub hex: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAlphaArgs {
    pub session_id: String,
    pub alpha: u8,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetViewArgs {
    pub session_id: String,
    pub zoom: f32,
    pub pan: crate::canvas_editor::types::Point,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerIdArgs {
    pub session_id: String,
    pub layer_id: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameLayerArgs {
    pub session_id: String,
    pub layer_id: u32,
    pub name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetLayerOpacityArgs {
    pub session_id: String,
    pub layer_id: u32,
    pub opacity: u8,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderLayersArgs {
    pub session_id: String,
    pub ids: Vec<u32>,
}

#[tauri::command]
pub fn canvas_editor_create_session(
    args: CreateSessionArgs,
) -> Result<crate::canvas_editor::types::EditorStatus, String> {
    crate::canvas_editor::create_session(args.session_id, args.width, args.height)
}

#[tauri::command]
pub fn canvas_editor_get_status(
    args: SessionArgs,
) -> Result<crate::canvas_editor::types::EditorStatus, String> {
    crate::canvas_editor::get_status(&args.session_id)
}

#[tauri::command]
pub fn canvas_editor_get_snapshot(
    args: SessionArgs,
) -> Result<crate::canvas_editor::types::SnapshotResult, String> {
    crate::canvas_editor::get_snapshot(&args.session_id)
}

#[tauri::command]
pub fn canvas_editor_get_move_preview_data(
    args: SessionArgs,
) -> Result<crate::canvas_editor::types::MovePreviewData, String> {
    crate::canvas_editor::get_move_preview_data(&args.session_id)
}

#[tauri::command]
pub fn canvas_editor_dispatch_pointer(
    args: DispatchPointerArgs,
) -> Result<crate::canvas_editor::types::EditorEventResult, String> {
    crate::canvas_editor::dispatch_pointer(&args.session_id, args.input)
}

#[tauri::command]
pub fn canvas_editor_dispatch_shortcut(
    args: DispatchShortcutArgs,
) -> Result<crate::canvas_editor::types::EditorEventResult, String> {
    crate::canvas_editor::dispatch_shortcut(&args.session_id, args.input)
}

#[tauri::command]
pub fn canvas_editor_set_tool(
    args: SetToolArgs,
) -> Result<crate::canvas_editor::types::EditorStatus, String> {
    crate::canvas_editor::set_tool(&args.session_id, args.tool)
}

#[tauri::command]
pub fn canvas_editor_set_selection_mode(
    args: SetSelectionModeArgs,
) -> Result<crate::canvas_editor::types::EditorStatus, String> {
    crate::canvas_editor::set_selection_mode(&args.session_id, args.mode)
}

#[tauri::command]
pub fn canvas_editor_set_active_color(
    args: SetColorArgs,
) -> Result<crate::canvas_editor::types::EditorStatus, String> {
    crate::canvas_editor::set_active_color(&args.session_id, args.hex)
}

#[tauri::command]
pub fn canvas_editor_set_active_alpha(
    args: SetAlphaArgs,
) -> Result<crate::canvas_editor::types::EditorStatus, String> {
    crate::canvas_editor::set_active_alpha(&args.session_id, args.alpha)
}

#[tauri::command]
pub fn canvas_editor_set_view(
    args: SetViewArgs,
) -> Result<crate::canvas_editor::types::EditorStatus, String> {
    crate::canvas_editor::set_view(&args.session_id, args.zoom, args.pan)
}

#[tauri::command]
pub fn canvas_editor_undo(
    args: SessionArgs,
) -> Result<crate::canvas_editor::types::EditorEventResult, String> {
    crate::canvas_editor::undo(&args.session_id)
}

#[tauri::command]
pub fn canvas_editor_redo(
    args: SessionArgs,
) -> Result<crate::canvas_editor::types::EditorEventResult, String> {
    crate::canvas_editor::redo(&args.session_id)
}

#[tauri::command]
pub fn canvas_editor_create_layer_above_active(
    args: SessionArgs,
) -> Result<crate::canvas_editor::types::EditorStatus, String> {
    crate::canvas_editor::create_layer_above_active(&args.session_id)
}

#[tauri::command]
pub fn canvas_editor_delete_layer(
    args: LayerIdArgs,
) -> Result<crate::canvas_editor::types::EditorStatus, String> {
    crate::canvas_editor::delete_layer(&args.session_id, args.layer_id)
}

#[tauri::command]
pub fn canvas_editor_set_active_layer(
    args: LayerIdArgs,
) -> Result<crate::canvas_editor::types::EditorStatus, String> {
    crate::canvas_editor::set_active_layer(&args.session_id, args.layer_id)
}

#[tauri::command]
pub fn canvas_editor_rename_layer(
    args: RenameLayerArgs,
) -> Result<crate::canvas_editor::types::EditorStatus, String> {
    crate::canvas_editor::rename_layer(&args.session_id, args.layer_id, args.name)
}

#[tauri::command]
pub fn canvas_editor_set_layer_opacity(
    args: SetLayerOpacityArgs,
) -> Result<crate::canvas_editor::types::EditorStatus, String> {
    crate::canvas_editor::set_layer_opacity(&args.session_id, args.layer_id, args.opacity)
}

#[tauri::command]
pub fn canvas_editor_toggle_layer_visibility(
    args: LayerIdArgs,
) -> Result<crate::canvas_editor::types::EditorStatus, String> {
    crate::canvas_editor::toggle_layer_visibility(&args.session_id, args.layer_id)
}

#[tauri::command]
pub fn canvas_editor_reorder_layers(
    args: ReorderLayersArgs,
) -> Result<crate::canvas_editor::types::EditorStatus, String> {
    crate::canvas_editor::reorder_layers(&args.session_id, args.ids)
}
