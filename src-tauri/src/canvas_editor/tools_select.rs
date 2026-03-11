use std::collections::HashSet;

use super::state::Editor;
use super::types::{Point, Rect, SelectionMode};

impl Editor {
    pub(crate) fn build_selection_indices_from_rect(&self, rect: Rect) -> HashSet<u32> {
        let mut out = HashSet::new();
        for y in rect.y..(rect.y + rect.height) {
            for x in rect.x..(rect.x + rect.width) {
                if x < 0 || y < 0 || x >= self.width as i32 || y >= self.height as i32 {
                    continue;
                }
                out.insert(self.idx(Point { x, y }));
            }
        }
        out
    }

    pub(crate) fn point_in_polygon(point: Point, polygon: &[Point]) -> bool {
        if polygon.len() < 3 {
            return false;
        }
        let px = point.x as f64 + 0.5;
        let py = point.y as f64 + 0.5;
        let mut inside = false;
        for i in 0..polygon.len() {
            let a = polygon[i];
            let b = polygon[(i + 1) % polygon.len()];
            let ay = a.y as f64;
            let by = b.y as f64;
            let ax = a.x as f64;
            let bx = b.x as f64;
            let intersect =
                ((ay > py) != (by > py)) && (px < (bx - ax) * (py - ay) / ((by - ay).max(1e-9)) + ax);
            if intersect {
                inside = !inside;
            }
        }
        inside
    }

    pub(crate) fn build_selection_indices_from_lasso(&self, points: &[Point]) -> HashSet<u32> {
        if points.len() < 3 {
            return HashSet::new();
        }
        let min_x = points.iter().map(|p| p.x).min().unwrap_or(0).clamp(0, self.width as i32 - 1);
        let max_x = points.iter().map(|p| p.x).max().unwrap_or(0).clamp(0, self.width as i32 - 1);
        let min_y = points.iter().map(|p| p.y).min().unwrap_or(0).clamp(0, self.height as i32 - 1);
        let max_y = points.iter().map(|p| p.y).max().unwrap_or(0).clamp(0, self.height as i32 - 1);
        let mut out = HashSet::new();
        for y in min_y..=max_y {
            for x in min_x..=max_x {
                if Self::point_in_polygon(Point { x, y }, points) {
                    out.insert(self.idx(Point { x, y }));
                }
            }
        }
        out
    }

    pub(crate) fn commit_select(&mut self) {
        self.selection.move_delta = Point { x: 0, y: 0 };
        self.selection.moving = false;
        if self.selection.mode == SelectionMode::Rect {
            let rect = self.selection.draft_rect;
            self.selection.draft_rect = None;
            self.selection.lasso_points.clear();
            self.selection.draft_lasso_points.clear();
            let indices = rect
                .map(|r| self.build_selection_indices_from_rect(r))
                .unwrap_or_default();
            self.set_selected_indices_sot(indices);
        } else {
            self.selection.lasso_points = self.selection.draft_lasso_points.clone();
            self.selection.draft_lasso_points.clear();
            let indices = self.build_selection_indices_from_lasso(&self.selection.lasso_points);
            self.set_selected_indices_sot(indices);
            self.selection.draft_rect = None;
        }
        // Pre-compute move preview cache so the first drag starts immediately.
        self.build_move_preview_cache();
    }
}
