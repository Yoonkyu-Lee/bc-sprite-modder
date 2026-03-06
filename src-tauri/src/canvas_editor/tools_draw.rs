use std::collections::HashMap;

use super::state::{Editor, PixelChange};
use super::tools::bresenham_line;
use super::types::{PixelPatch, Point};

impl Editor {
    pub(crate) fn draw_segment_solid(&mut self, from: Point, to: Point, rgba: [u8; 4]) -> Option<PixelPatch> {
        let mut local = HashMap::<u32, PixelChange>::new();
        let mut action = std::mem::take(&mut self.pointer.action_changes);
        for p in bresenham_line(from, to) {
            if p.x < 0 || p.y < 0 || p.x >= self.width as i32 || p.y >= self.height as i32 {
                continue;
            }
            self.set_pixel_with_changes(&mut local, p, rgba);
            let idx = self.idx(p);
            let after = Self::rgba_at(self.active_bitmap(), idx);
            let before = local.get(&idx).map(|c| c.before).unwrap_or([0, 0, 0, 0]);
            action
                .entry(idx)
                .and_modify(|c| c.after = after)
                .or_insert(PixelChange { before, after });
        }
        self.pointer.action_changes = action;
        self.patch_from_changes(&local)
    }

    pub(crate) fn draw_segment_blended(&mut self, from: Point, to: Point, src_rgba: [u8; 4]) -> Option<PixelPatch> {
        let mut local = HashMap::<u32, PixelChange>::new();
        let mut action = std::mem::take(&mut self.pointer.action_changes);
        for p in bresenham_line(from, to) {
            if p.x < 0 || p.y < 0 || p.x >= self.width as i32 || p.y >= self.height as i32 {
                continue;
            }
            let idx = self.idx(p);
            // For pixel-draw behavior, apply alpha only once per stroke per pixel.
            // Otherwise slow pointer movement repeatedly blends the same pixel.
            if action.contains_key(&idx) {
                continue;
            }
            let dst = Self::rgba_at(self.active_bitmap(), idx);
            let out = Self::alpha_blend(src_rgba, dst);
            self.set_pixel_with_changes(&mut local, p, out);
            let after = Self::rgba_at(self.active_bitmap(), idx);
            let before = local.get(&idx).map(|c| c.before).unwrap_or([0, 0, 0, 0]);
            action
                .entry(idx)
                .and_modify(|c| c.after = after)
                .or_insert(PixelChange { before, after });
        }
        self.pointer.action_changes = action;
        self.patch_from_changes(&local)
    }
}
