use super::state::Editor;
use super::types::{EditorEventResult, EditorStatus, Point, SelectionMode, ShortcutInput, ToolKind};

impl Editor {
    pub(crate) fn set_tool(&mut self, tool: ToolKind) -> EditorStatus {
        if self.tool == ToolKind::Move && tool != ToolKind::Move && self.floating_layer.is_some() {
            let _ = self.finalize_move_session();
        }
        self.tool = tool;
        self.message = Some(format!("TOOL: {:?}", tool).to_uppercase());
        self.status()
    }

    pub(crate) fn set_selection_mode(&mut self, mode: SelectionMode) -> EditorStatus {
        if self.floating_layer.is_some() {
            let _ = self.finalize_move_session();
        }
        self.selection.mode = mode;
        self.message = Some(format!("SELECT MODE: {:?}", mode).to_uppercase());
        self.status()
    }

    pub(crate) fn set_active_color(&mut self, hex: String) -> EditorStatus {
        self.active_color = hex;
        self.status()
    }

    pub(crate) fn set_active_alpha(&mut self, alpha: u8) -> EditorStatus {
        self.active_alpha = alpha;
        self.status()
    }

    pub(crate) fn set_view(&mut self, zoom: f32, pan: Point) -> EditorStatus {
        self.zoom = zoom;
        self.pan = pan;
        self.status()
    }

    pub(crate) fn dispatch_shortcut(&mut self, input: ShortcutInput) -> EditorEventResult {
        let key = input.key.to_lowercase();
        if key == "enter" {
            let patch = if self.floating_layer.is_some() {
                self.finalize_move_session()
            } else {
                self.clear_selection_visual_state();
                None
            };
            self.message = Some("SELECTION COMMIT".into());
            return EditorEventResult {
                status: self.status(),
                patch,
                consumed: true,
            };
        }
        if input.ctrl && !input.shift && key == "z" {
            return self.undo();
        }
        if input.ctrl && !input.shift && key == "y" {
            return self.redo();
        }
        if key == "tab" {
            if self.tool == ToolKind::Move && self.floating_layer.is_some() {
                let _ = self.finalize_move_session();
            }
            self.tool = match self.tool {
                ToolKind::Draw => ToolKind::Fill,
                ToolKind::Fill => ToolKind::Erase,
                ToolKind::Erase => ToolKind::Select,
                ToolKind::Select => ToolKind::Move,
                ToolKind::Move => ToolKind::Pick,
                ToolKind::Pick => ToolKind::Draw,
            };
            self.message = Some(format!("TOOL: {:?}", self.tool).to_uppercase());
            return EditorEventResult {
                status: self.status(),
                patch: None,
                consumed: true,
            };
        }
        if key == "l" {
            if self.floating_layer.is_some() {
                let _ = self.finalize_move_session();
            }
            self.selection.mode = if self.selection.mode == SelectionMode::Rect {
                SelectionMode::Lasso
            } else {
                SelectionMode::Rect
            };
            self.message = Some(format!("SELECT MODE: {:?}", self.selection.mode).to_uppercase());
            return EditorEventResult {
                status: self.status(),
                patch: None,
                consumed: true,
            };
        }
        let next_tool = match key.as_str() {
            "p" => Some(ToolKind::Pick),
            "d" => Some(ToolKind::Draw),
            "f" => Some(ToolKind::Fill),
            "e" => Some(ToolKind::Erase),
            "s" => Some(ToolKind::Select),
            "m" => Some(ToolKind::Move),
            "<" | ">" | "," | "." => {
                self.message = Some("Frame feature disabled".into());
                return EditorEventResult {
                    status: self.status(),
                    patch: None,
                    consumed: true,
                };
            }
            _ => None,
        };
        if let Some(tool) = next_tool {
            if self.tool == ToolKind::Move && tool != ToolKind::Move && self.floating_layer.is_some() {
                let _ = self.finalize_move_session();
            }
            self.tool = tool;
            self.message = Some(format!("TOOL: {:?}", self.tool).to_uppercase());
            return EditorEventResult {
                status: self.status(),
                patch: None,
                consumed: true,
            };
        }
        EditorEventResult {
            status: self.status(),
            patch: None,
            consumed: false,
        }
    }
}
