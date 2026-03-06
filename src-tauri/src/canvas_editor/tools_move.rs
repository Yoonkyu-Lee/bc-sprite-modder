use std::collections::HashMap;

use super::state::{Editor, PixelChange};
use super::types::{PixelPatch, Point, Rect};

impl Editor {
    fn is_selected_masked(&self, idx: u32) -> bool {
        self.pointer
            .move_selected_mask
            .get(idx as usize)
            .copied()
            .unwrap_or(0)
            == 1
    }

    fn desired_color_for_move_at(&self, pos_idx: u32, delta: Point, base: &[u8]) -> [u8; 4] {
        let mut desired = Self::rgba_at(base, pos_idx);
        if self.is_selected_masked(pos_idx) {
            desired = [0, 0, 0, 0];
        }

        let px = (pos_idx % self.width) as i32;
        let py = (pos_idx / self.width) as i32;
        let sx = px - delta.x;
        let sy = py - delta.y;
        if sx >= 0 && sy >= 0 && sx < self.width as i32 && sy < self.height as i32 {
            let src_idx = sy as u32 * self.width + sx as u32;
            if self.is_selected_masked(src_idx) {
                let color = Self::rgba_at(base, src_idx);
                if color[3] > 0 {
                    desired = Self::alpha_blend(color, desired);
                }
            }
        }
        desired
    }

    // Derived cache from selected_indices SoT for move preview/commit.
    fn build_move_mask_from_selected_indices(&self) -> (Vec<u8>, bool) {
        let mut mask = vec![0u8; (self.width * self.height) as usize];
        let mut has_opaque = false;
        for idx in &self.selected_indices {
            if *idx >= self.width * self.height {
                continue;
            }
            mask[*idx as usize] = 1;
            if Self::rgba_at(&self.bitmap, *idx)[3] > 0 {
                has_opaque = true;
            }
        }
        (mask, has_opaque)
    }

    // Refresh move caches (mask + bounds) from selected_indices SoT.
    // Returns false when nothing opaque is movable.
    pub(crate) fn rebuild_move_selection_cache(&mut self) -> bool {
        let (mask, has_opaque) = self.build_move_mask_from_selected_indices();
        self.pointer.move_selected_mask = mask;
        self.pointer.move_selection_bounds = self.selected_bounds();
        has_opaque
    }

    pub(crate) fn update_move_preview_state(&mut self, next_delta: Point) {
        if self.pointer.move_base_bitmap.is_none() {
            return;
        }
        self.pointer.move_current_delta = next_delta;
        self.selection.move_delta = next_delta;
        if let Some(rect) = self.selection.rect {
            self.selection.draft_rect = Some(Rect {
                x: rect.x + next_delta.x,
                y: rect.y + next_delta.y,
                width: rect.width,
                height: rect.height,
            });
        }
        if !self.selection.lasso_points.is_empty() {
            self.selection.draft_lasso_points = self
                .selection
                .lasso_points
                .iter()
                .map(|p| Point {
                    x: p.x + next_delta.x,
                    y: p.y + next_delta.y,
                })
                .collect();
        }
    }

    fn clear_move_state(&mut self) {
        self.clear_selection_and_move_cache();
        self.selection.lasso_points.clear();
        self.selection.draft_rect = None;
        self.selection.draft_lasso_points.clear();
        self.selection.moving = false;
        self.selection.move_delta = Point { x: 0, y: 0 };
        self.pointer.move_start = None;
        self.pointer.move_drag_origin = None;
        self.pointer.move_base_bitmap = None;
        self.pointer.move_current_delta = Point { x: 0, y: 0 };
    }

    pub(crate) fn cancel_move_session(&mut self) {
        self.clear_move_state();
    }

    pub(crate) fn finalize_move_session(&mut self) -> Option<PixelPatch> {
        let Some(base) = self.pointer.move_base_bitmap.as_ref() else {
            return None;
        };
        let Some(bounds) = self.pointer.move_selection_bounds else {
            return None;
        };
        let delta = self.pointer.move_current_delta;

        let base_rect = bounds;
        let moved_rect = Rect {
            x: bounds.x + delta.x,
            y: bounds.y + delta.y,
            width: bounds.width,
            height: bounds.height,
        };
        let min_x = base_rect.x.min(moved_rect.x).clamp(0, self.width as i32 - 1);
        let max_x = (base_rect.x + base_rect.width - 1)
            .max(moved_rect.x + moved_rect.width - 1)
            .clamp(0, self.width as i32 - 1);
        let min_y = base_rect.y.min(moved_rect.y).clamp(0, self.height as i32 - 1);
        let max_y = (base_rect.y + base_rect.height - 1)
            .max(moved_rect.y + moved_rect.height - 1)
            .clamp(0, self.height as i32 - 1);

        let mut changes = HashMap::<u32, PixelChange>::new();
        for y in min_y..=max_y {
            for x in min_x..=max_x {
                let idx = self.idx(Point { x, y });
                let before = Self::rgba_at(base, idx);
                let after = self.desired_color_for_move_at(idx, delta, base);
                if before == after {
                    continue;
                }
                changes.insert(idx, PixelChange { before, after });
                Self::set_rgba(&mut self.bitmap, idx, after);
            }
        }
        let committed_patch = Self::patch_from_changes(&changes);
        if let Some(ref patch) = committed_patch {
            self.push_history(patch.clone());
        }
        self.clear_move_state();
        committed_patch
    }
}
