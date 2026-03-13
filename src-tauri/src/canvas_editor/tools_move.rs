use std::collections::HashMap;

use super::state::{Editor, FloatingLayer, PixelChange};
use super::types::{PixelPatch, Point, Rect};

impl Editor {
    /// Lift the current selection off the active layer into a FloatingLayer.
    /// Burns transparent holes where the pixels were in the source layer.
    /// Returns false if there are no opaque pixels to move.
    pub(crate) fn start_floating_layer(&mut self) -> bool {
        let Some(bounds) = self.selected_bounds() else {
            return false;
        };

        let selected_indices: Vec<u32> = self.selected_indices.iter().copied().collect();
        if selected_indices.is_empty() {
            return false;
        }

        let bw = bounds.width.max(1) as usize;
        let bh = bounds.height.max(1) as usize;
        let n = selected_indices.len();

        let mut bitmap = vec![0u8; bw * bh * 4];
        let mut original_pixels = vec![0u8; n * 4];
        let mut has_opaque = false;

        for (i, &idx) in selected_indices.iter().enumerate() {
            let src = Self::rgba_at(self.active_bitmap(), idx);
            original_pixels[i * 4] = src[0];
            original_pixels[i * 4 + 1] = src[1];
            original_pixels[i * 4 + 2] = src[2];
            original_pixels[i * 4 + 3] = src[3];
            if src[3] > 0 {
                has_opaque = true;
            }
            let x = (idx % self.width) as i32;
            let y = (idx / self.width) as i32;
            let lx = (x - bounds.x) as usize;
            let ly = (y - bounds.y) as usize;
            let li = (ly * bw + lx) * 4;
            bitmap[li] = src[0];
            bitmap[li + 1] = src[1];
            bitmap[li + 2] = src[2];
            bitmap[li + 3] = src[3];
        }

        if !has_opaque {
            return false;
        }

        // Burn holes into the source layer.
        for &idx in &selected_indices {
            Self::set_rgba(self.active_bitmap_mut(), idx, [0, 0, 0, 0]);
        }

        let source_layer_id = self.active_layer().id;
        let opacity = self.active_layer().opacity;

        self.floating_layer = Some(FloatingLayer {
            source_layer_id,
            bitmap,
            selected_indices,
            offset: Point { x: 0, y: 0 },
            bounds,
            opacity,
            original_pixels,
        });

        true
    }

    pub(crate) fn update_move_preview_state(&mut self, next_delta: Point) {
        if let Some(ref mut fl) = self.floating_layer {
            fl.offset = next_delta;
        } else {
            return;
        }
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
        // NOTE: clear_selection_and_move_cache clears floating_layer and selected_indices.
        self.clear_selection_and_move_cache();
        self.selection.lasso_points.clear();
        self.selection.draft_rect = None;
        self.selection.draft_lasso_points.clear();
        self.selection.moving = false;
        self.selection.move_delta = Point { x: 0, y: 0 };
        self.pointer.move_start = None;
        self.pointer.move_drag_origin = None;
    }

    /// Cancel the move session: restore the source layer from the FloatingLayer's
    /// original_pixels before clearing all move state.
    pub(crate) fn cancel_move_session(&mut self) {
        if let Some(fl) = self.floating_layer.take() {
            for (i, &idx) in fl.selected_indices.iter().enumerate() {
                let original = [
                    fl.original_pixels[i * 4],
                    fl.original_pixels[i * 4 + 1],
                    fl.original_pixels[i * 4 + 2],
                    fl.original_pixels[i * 4 + 3],
                ];
                if let Some(layer_bitmap) = self.bitmap_mut_for_layer_id(fl.source_layer_id) {
                    Self::set_rgba(layer_bitmap, idx, original);
                }
            }
            // floating_layer is already taken (None), so clear_move_state's
            // clear_selection_and_move_cache will find None and is a no-op for it.
        }
        self.clear_move_state();
    }

    /// Commit the FloatingLayer to the target layer at its current offset.
    /// Produces a PixelPatch covering the full before→after transformation so
    /// that undo correctly restores the pre-move state.
    pub(crate) fn finalize_move_session(&mut self) -> Option<PixelPatch> {
        let Some(fl) = self.floating_layer.take() else {
            return None;
        };

        let bw = fl.bounds.width.max(1) as usize;
        let mut changes = HashMap::<u32, PixelChange>::new();

        // Step 1: Record source holes.
        // The source layer already has holes burned (transparent) since move start.
        // For the PixelPatch, before = original pixel, after = transparent (current).
        for (i, &src_idx) in fl.selected_indices.iter().enumerate() {
            let original = [
                fl.original_pixels[i * 4],
                fl.original_pixels[i * 4 + 1],
                fl.original_pixels[i * 4 + 2],
                fl.original_pixels[i * 4 + 3],
            ];
            if original != [0, 0, 0, 0] {
                changes.insert(src_idx, PixelChange { before: original, after: [0, 0, 0, 0] });
            }
        }

        // Step 2: Composite float pixels at destination positions.
        // Accumulate updates separately so we apply them after building the change map.
        let mut dest_updates: Vec<(u32, [u8; 4])> = Vec::new();

        for &src_idx in &fl.selected_indices {
            let dst_x = (src_idx % self.width) as i32 + fl.offset.x;
            let dst_y = (src_idx / self.width) as i32 + fl.offset.y;
            if dst_x < 0 || dst_y < 0 || dst_x >= self.width as i32 || dst_y >= self.height as i32 {
                continue;
            }
            let dst_idx = dst_y as u32 * self.width + dst_x as u32;

            // Fetch float pixel from the bounds-local bitmap.
            let bx = (src_idx % self.width) as i32 - fl.bounds.x;
            let by = (src_idx / self.width) as i32 - fl.bounds.y;
            let li = (by as usize * bw + bx as usize) * 4;
            let float_raw = [fl.bitmap[li], fl.bitmap[li + 1], fl.bitmap[li + 2], fl.bitmap[li + 3]];
            let float_pixel = [
                float_raw[0],
                float_raw[1],
                float_raw[2],
                ((float_raw[3] as u16 * fl.opacity as u16) / 255) as u8,
            ];
            if float_pixel[3] == 0 {
                // Transparent float pixel: nothing to deposit at destination.
                continue;
            }

            // Current state at dest: use changes map if this is also a source position
            // (it will be [0,0,0,0] since it was burned), otherwise read from bitmap.
            let current_dst = changes.get(&dst_idx).map(|c| c.after).unwrap_or_else(|| {
                Self::rgba_at(self.active_bitmap(), dst_idx)
            });

            let composited = Self::alpha_blend(float_pixel, current_dst);

            // True "before" for undo: what this position held before the entire operation.
            let before_dst = changes
                .get(&dst_idx)
                .map(|c| c.before)
                .unwrap_or_else(|| Self::rgba_at(self.active_bitmap(), dst_idx));

            // Always queue a bitmap write (needed to restore burned holes at src==dst).
            dest_updates.push((dst_idx, composited));

            if composited != before_dst {
                changes
                    .entry(dst_idx)
                    .and_modify(|c| c.after = composited)
                    .or_insert(PixelChange { before: before_dst, after: composited });
            } else {
                // No net change: remove source hole entry if present.
                changes.remove(&dst_idx);
            }
        }

        // Apply destination composites to the active bitmap.
        for (idx, color) in dest_updates {
            Self::set_rgba(self.active_bitmap_mut(), idx, color);
        }

        let committed_patch = self.patch_from_changes(&changes);
        if let Some(ref patch) = committed_patch {
            self.push_history(patch.clone());
        }
        self.clear_move_state();
        committed_patch
    }
}
