use std::collections::HashMap;

use super::state::{Editor, PixelChange};
use super::tools::{flood_fill, normalize_rect, point_in_rect};
use super::types::{EditorEventResult, PixelPatch, PointerInput, Point, Rect, SelectionMode, ToolKind};

impl Editor {
    fn handle_pointer_down(&mut self, input: &PointerInput) -> Option<PixelPatch> {
        let button = input.button.unwrap_or(0);
        let p = Point {
            x: input.x,
            y: input.y,
        };
        self.is_pointer_down = true;
        self.pointer.last_point = Some(p);
        if button != 0 {
            self.message = None;
            return None;
        }

        match self.tool {
            ToolKind::Draw => {
                self.pointer.action_changes.clear();
                self.message = Some("DRAW".into());
                self.draw_segment(p, p, Self::parse_color(&self.active_color))
            }
            ToolKind::Erase => {
                self.pointer.action_changes.clear();
                self.message = Some("ERASE".into());
                self.draw_segment(p, p, [0, 0, 0, 0])
            }
            ToolKind::Pick => {
                if !self.in_bounds(p) {
                    self.is_pointer_down = false;
                    return None;
                }
                let idx = self.idx(p);
                self.active_color = Self::to_hex(Self::rgba_at(&self.bitmap, idx));
                self.message = Some(format!("PICK {}", self.active_color));
                self.is_pointer_down = false;
                None
            }
            ToolKind::Fill => {
                if !self.in_bounds(p) {
                    self.is_pointer_down = false;
                    return None;
                }
                self.pointer.action_changes.clear();
                let idx = self.idx(p);
                let target = Self::rgba_at(&self.bitmap, idx);
                let replacement = Self::parse_color(&self.active_color);
                let mut changes = HashMap::<u32, PixelChange>::new();
                for fp in flood_fill(
                    &self.bitmap,
                    self.width as i32,
                    self.height as i32,
                    p,
                    target,
                    replacement,
                ) {
                    self.set_pixel_with_changes(&mut changes, fp, replacement);
                }
                let patch = Self::patch_from_changes(&changes);
                if let Some(ref pch) = patch {
                    self.push_history(pch.clone());
                }
                self.is_pointer_down = false;
                self.message = Some("FILL".into());
                patch
            }
            ToolKind::Select => {
                self.message = Some("SELECT".into());
                if self.selection.mode == SelectionMode::Rect {
                    self.pointer.select_start = Some(p);
                    self.selection.draft_rect = Some(Rect {
                        x: p.x,
                        y: p.y,
                        width: 1,
                        height: 1,
                    });
                    self.selection.draft_lasso_points.clear();
                } else {
                    self.pointer.select_start = Some(p);
                    self.selection.draft_rect = None;
                    self.selection.draft_lasso_points = vec![p];
                }
                None
            }
            ToolKind::Move => {
                if self.pointer.move_base_bitmap.is_none() {
                    if self.selected_indices.is_empty() {
                        self.message = Some("MOVE: no active selection".into());
                        return None;
                    }
                    let Some(bounds) = self.selected_bounds() else {
                        self.message = Some("MOVE: no active selection".into());
                        return None;
                    };
                    if !self.rebuild_move_selection_cache() {
                        self.message = Some("MOVE: no movable pixels".into());
                        return None;
                    }
                    self.pointer.move_selection_bounds = Some(bounds);
                    self.pointer.move_base_bitmap = Some(self.bitmap.clone());
                    self.pointer.move_current_delta = Point { x: 0, y: 0 };
                    self.selection.move_delta = Point { x: 0, y: 0 };
                }

                let Some(bounds) = self.pointer.move_selection_bounds else {
                    self.message = Some("MOVE: invalid selection state".into());
                    return None;
                };
                let current_rect = Rect {
                    x: bounds.x + self.pointer.move_current_delta.x,
                    y: bounds.y + self.pointer.move_current_delta.y,
                    width: bounds.width,
                    height: bounds.height,
                };
                if !point_in_rect(p, current_rect) {
                    let patch = self.finalize_move_session();
                    self.message = Some("MOVE END".into());
                    return patch;
                }

                self.pointer.move_start = Some(p);
                self.pointer.move_drag_origin = Some(self.pointer.move_current_delta);
                self.selection.moving = true;
                self.message = Some("MOVE".into());
                None
            }
        }
    }

    fn handle_pointer_move(&mut self, input: &PointerInput) -> Option<PixelPatch> {
        if !self.is_pointer_down {
            return None;
        }
        let Some(last) = self.pointer.last_point else {
            return None;
        };
        let p = Point {
            x: input.x,
            y: input.y,
        };
        self.pointer.last_point = Some(p);

        match self.tool {
            ToolKind::Draw => self.draw_segment(last, p, Self::parse_color(&self.active_color)),
            ToolKind::Erase => self.draw_segment(last, p, [0, 0, 0, 0]),
            ToolKind::Select => {
                if self.selection.mode == SelectionMode::Rect {
                    if let Some(start) = self.pointer.select_start {
                        self.selection.draft_rect = Some(normalize_rect(start, p));
                    }
                } else if self
                    .selection
                    .draft_lasso_points
                    .last()
                    .is_none_or(|last| *last != p)
                {
                    self.selection.draft_lasso_points.push(p);
                }
                None
            }
            ToolKind::Move => {
                let Some(start) = self.pointer.move_start else {
                    return None;
                };
                if self.pointer.move_selection_bounds.is_none() {
                    return None;
                }
                let Some(origin_delta) = self.pointer.move_drag_origin else {
                    return None;
                };
                let raw = Point {
                    x: p.x - start.x,
                    y: p.y - start.y,
                };
                self.update_move_preview_state(Point {
                    x: origin_delta.x + raw.x,
                    y: origin_delta.y + raw.y,
                });
                None
            }
            _ => None,
        }
    }

    fn handle_pointer_up(&mut self) -> Option<PixelPatch> {
        if !self.is_pointer_down {
            return None;
        }
        match self.tool {
            ToolKind::Draw | ToolKind::Erase => {
                if let Some(patch) = Self::patch_from_changes(&self.pointer.action_changes) {
                    self.push_history(patch);
                }
                self.pointer.action_changes.clear();
            }
            ToolKind::Select => {
                self.commit_select();
                self.pointer.select_start = None;
            }
            ToolKind::Move => {
                self.selection.moving = false;
                self.pointer.move_start = None;
                self.pointer.move_drag_origin = None;
            }
            _ => {}
        }
        self.is_pointer_down = false;
        self.pointer.last_point = None;
        None
    }

    pub(crate) fn dispatch_pointer(&mut self, input: PointerInput) -> EditorEventResult {
        let patch = match input.kind.as_str() {
            "down" => self.handle_pointer_down(&input),
            "move" => self.handle_pointer_move(&input),
            "up" => self.handle_pointer_up(),
            _ => None,
        };
        EditorEventResult {
            status: self.status(),
            patch,
            consumed: true,
        }
    }
}
