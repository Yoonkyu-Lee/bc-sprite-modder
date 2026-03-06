use base64::Engine;

use super::session_store::{create_editor_session, with_editor_mut};
use super::state::Editor;
use super::types::{
    EditorEventResult, EditorStatus, MovePreviewData, Point, PointerInput, SelectionMode, ShortcutInput,
    SnapshotResult, ToolKind,
};

impl Editor {
    fn snapshot(&self) -> SnapshotResult {
        SnapshotResult {
            width: self.width,
            height: self.height,
            rgba_base64: base64::engine::general_purpose::STANDARD.encode(&self.bitmap),
        }
    }

    fn move_preview_data(&self) -> Result<MovePreviewData, String> {
        let Some(bounds) = self.pointer.move_selection_bounds else {
            return Err("move session is not active".to_string());
        };
        Ok(MovePreviewData {
            bounds,
            selected_indices: self.selected_indices.iter().copied().collect(),
        })
    }
}

pub fn create_session(session_id: String, width: u32, height: u32) -> Result<EditorStatus, String> {
    create_editor_session(session_id, width, height)
}

pub fn get_status(session_id: &str) -> Result<EditorStatus, String> {
    with_editor_mut(session_id, |e| e.status())
}

pub fn get_snapshot(session_id: &str) -> Result<SnapshotResult, String> {
    with_editor_mut(session_id, |e| e.snapshot())
}

pub fn get_move_preview_data(session_id: &str) -> Result<MovePreviewData, String> {
    with_editor_mut(session_id, |e| e.move_preview_data())?
}

pub fn dispatch_pointer(session_id: &str, input: PointerInput) -> Result<EditorEventResult, String> {
    with_editor_mut(session_id, |e| e.dispatch_pointer(input))
}

pub fn dispatch_shortcut(session_id: &str, input: ShortcutInput) -> Result<EditorEventResult, String> {
    with_editor_mut(session_id, |e| e.dispatch_shortcut(input))
}

pub fn set_tool(session_id: &str, tool: ToolKind) -> Result<EditorStatus, String> {
    with_editor_mut(session_id, |e| e.set_tool(tool))
}

pub fn set_selection_mode(session_id: &str, mode: SelectionMode) -> Result<EditorStatus, String> {
    with_editor_mut(session_id, |e| e.set_selection_mode(mode))
}

pub fn set_active_color(session_id: &str, hex: String) -> Result<EditorStatus, String> {
    with_editor_mut(session_id, |e| e.set_active_color(hex))
}

pub fn set_view(session_id: &str, zoom: f32, pan: Point) -> Result<EditorStatus, String> {
    with_editor_mut(session_id, |e| e.set_view(zoom, pan))
}

pub fn undo(session_id: &str) -> Result<EditorEventResult, String> {
    with_editor_mut(session_id, |e| e.undo())
}

pub fn redo(session_id: &str) -> Result<EditorEventResult, String> {
    with_editor_mut(session_id, |e| e.redo())
}
