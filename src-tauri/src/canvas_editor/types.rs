use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ToolKind {
    Pick,
    Draw,
    Fill,
    Erase,
    Select,
    Move,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SelectionMode {
    Rect,
    Lasso,
}

#[derive(Debug, Default, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct Point {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SelectionState {
    pub rect: Option<Rect>,
    pub draft_rect: Option<Rect>,
    pub moving: bool,
    pub move_delta: Point,
    pub mode: SelectionMode,
    pub lasso_points: Vec<Point>,
    pub draft_lasso_points: Vec<Point>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorStatus {
    pub width: u32,
    pub height: u32,
    pub tool: ToolKind,
    pub active_color: String,
    pub selection: SelectionState,
    pub message: Option<String>,
    pub can_undo: bool,
    pub can_redo: bool,
    pub zoom: f32,
    pub pan: Point,
    pub is_pointer_down: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PixelPatch {
    pub changed_indices: Vec<u32>,
    pub before: Vec<u8>,
    pub after: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutInput {
    pub key: String,
    pub ctrl: bool,
    pub shift: bool,
    pub alt: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointerInput {
    pub kind: String,
    pub x: i32,
    pub y: i32,
    pub button: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorEventResult {
    pub status: EditorStatus,
    pub patch: Option<PixelPatch>,
    pub consumed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotResult {
    pub width: u32,
    pub height: u32,
    pub rgba_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MovePreviewData {
    pub bounds: Rect,
    pub selected_indices: Vec<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
// TODO(canvas-editor): remove this once layer reordering API is reintroduced,
// or wire it back into command/frontend paths when layer stack support returns.
#[allow(dead_code)]
pub struct LayerOrderInput {
    pub ids: Vec<u32>,
}
