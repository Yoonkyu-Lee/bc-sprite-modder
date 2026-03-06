use std::collections::{HashMap, HashSet};

use super::types::{EditorStatus, PixelPatch, Point, Rect, SelectionMode, SelectionState, ToolKind};

#[derive(Clone)]
pub(crate) struct PixelChange {
    pub(crate) before: [u8; 4],
    pub(crate) after: [u8; 4],
}

#[derive(Default)]
pub(crate) struct PointerSession {
    pub(crate) last_point: Option<Point>,
    pub(crate) action_changes: HashMap<u32, PixelChange>,
    pub(crate) select_start: Option<Point>,
    pub(crate) move_start: Option<Point>,
    pub(crate) move_drag_origin: Option<Point>,
    pub(crate) move_base_bitmap: Option<Vec<u8>>,
    pub(crate) move_selected_mask: Vec<u8>,
    pub(crate) move_selection_bounds: Option<Rect>,
    pub(crate) move_current_delta: Point,
}

pub(crate) struct Editor {
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) bitmap: Vec<u8>,
    pub(crate) tool: ToolKind,
    pub(crate) active_color: String,
    pub(crate) active_alpha: u8,
    pub(crate) selection: SelectionState,
    pub(crate) message: Option<String>,
    pub(crate) zoom: f32,
    pub(crate) pan: Point,
    pub(crate) is_pointer_down: bool,
    pub(crate) undo_stack: Vec<PixelPatch>,
    pub(crate) redo_stack: Vec<PixelPatch>,
    pub(crate) selected_indices: HashSet<u32>,
    pub(crate) pointer: PointerSession,
}

impl Editor {
    pub(crate) fn new(width: u32, height: u32) -> Self {
        Self {
            width,
            height,
            bitmap: vec![0u8; (width * height * 4) as usize],
            tool: ToolKind::Draw,
            active_color: "#ffffff".to_string(),
            active_alpha: 255,
            selection: SelectionState {
                rect: None,
                draft_rect: None,
                moving: false,
                move_delta: Point { x: 0, y: 0 },
                mode: SelectionMode::Rect,
                lasso_points: Vec::new(),
                draft_lasso_points: Vec::new(),
            },
            message: None,
            zoom: 1.0,
            pan: Point { x: 0, y: 0 },
            is_pointer_down: false,
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            selected_indices: HashSet::new(),
            pointer: PointerSession::default(),
        }
    }

    pub(crate) fn status(&self) -> EditorStatus {
        EditorStatus {
            width: self.width,
            height: self.height,
            tool: self.tool,
            active_color: self.active_color.clone(),
            active_alpha: self.active_alpha,
            selection: self.selection.clone(),
            message: self.message.clone(),
            can_undo: !self.undo_stack.is_empty(),
            can_redo: !self.redo_stack.is_empty(),
            zoom: self.zoom,
            pan: self.pan,
            is_pointer_down: self.is_pointer_down,
        }
    }

    pub(crate) fn parse_color(hex: &str) -> [u8; 4] {
        let n = hex.trim().trim_start_matches('#');
        if n.len() != 6 {
            return [255, 255, 255, 255];
        }
        let Ok(v) = u32::from_str_radix(n, 16) else {
            return [255, 255, 255, 255];
        };
        [((v >> 16) & 0xff) as u8, ((v >> 8) & 0xff) as u8, (v & 0xff) as u8, 255]
    }

    pub(crate) fn active_rgba(&self) -> [u8; 4] {
        let mut rgba = Self::parse_color(&self.active_color);
        rgba[3] = self.active_alpha;
        rgba
    }

    // Source-over alpha compositing for straight-alpha RGBA.
    pub(crate) fn alpha_blend(src: [u8; 4], dst: [u8; 4]) -> [u8; 4] {
        let sa = src[3] as f32 / 255.0;
        let da = dst[3] as f32 / 255.0;
        let out_a = sa + da * (1.0 - sa);
        if out_a <= f32::EPSILON {
            return [0, 0, 0, 0];
        }
        let src_r = src[0] as f32 / 255.0;
        let src_g = src[1] as f32 / 255.0;
        let src_b = src[2] as f32 / 255.0;
        let dst_r = dst[0] as f32 / 255.0;
        let dst_g = dst[1] as f32 / 255.0;
        let dst_b = dst[2] as f32 / 255.0;
        let out_r = (src_r * sa + dst_r * da * (1.0 - sa)) / out_a;
        let out_g = (src_g * sa + dst_g * da * (1.0 - sa)) / out_a;
        let out_b = (src_b * sa + dst_b * da * (1.0 - sa)) / out_a;
        [
            (out_r.clamp(0.0, 1.0) * 255.0).round() as u8,
            (out_g.clamp(0.0, 1.0) * 255.0).round() as u8,
            (out_b.clamp(0.0, 1.0) * 255.0).round() as u8,
            (out_a.clamp(0.0, 1.0) * 255.0).round() as u8,
        ]
    }

    pub(crate) fn to_hex(rgba: [u8; 4]) -> String {
        format!("#{:02x}{:02x}{:02x}", rgba[0], rgba[1], rgba[2])
    }

    pub(crate) fn idx(&self, p: Point) -> u32 {
        p.y as u32 * self.width + p.x as u32
    }

    pub(crate) fn in_bounds(&self, p: Point) -> bool {
        p.x >= 0 && p.y >= 0 && p.x < self.width as i32 && p.y < self.height as i32
    }

    pub(crate) fn rgba_at(bitmap: &[u8], idx: u32) -> [u8; 4] {
        let i = (idx * 4) as usize;
        [bitmap[i], bitmap[i + 1], bitmap[i + 2], bitmap[i + 3]]
    }

    pub(crate) fn set_rgba(bitmap: &mut [u8], idx: u32, rgba: [u8; 4]) {
        let i = (idx * 4) as usize;
        bitmap[i] = rgba[0];
        bitmap[i + 1] = rgba[1];
        bitmap[i + 2] = rgba[2];
        bitmap[i + 3] = rgba[3];
    }

    pub(crate) fn set_pixel_with_changes(
        &mut self,
        changes: &mut HashMap<u32, PixelChange>,
        p: Point,
        rgba: [u8; 4],
    ) {
        let idx = self.idx(p);
        let before = Self::rgba_at(&self.bitmap, idx);
        if before == rgba {
            return;
        }
        changes
            .entry(idx)
            .and_modify(|c| c.after = rgba)
            .or_insert(PixelChange { before, after: rgba });
        Self::set_rgba(&mut self.bitmap, idx, rgba);
    }

    pub(crate) fn selection_bounds(indices: &HashSet<u32>, width: u32) -> Option<Rect> {
        let mut it = indices.iter();
        let first = *it.next()?;
        let mut min_x = (first % width) as i32;
        let mut max_x = min_x;
        let mut min_y = (first / width) as i32;
        let mut max_y = min_y;
        for idx in it {
            let x = (*idx % width) as i32;
            let y = (*idx / width) as i32;
            min_x = min_x.min(x);
            max_x = max_x.max(x);
            min_y = min_y.min(y);
            max_y = max_y.max(y);
        }
        Some(Rect {
            x: min_x,
            y: min_y,
            width: max_x - min_x + 1,
            height: max_y - min_y + 1,
        })
    }

    // Selection source of truth (SoT): selected_indices.
    // Any caller that mutates selected_indices must rebuild rect cache.
    pub(crate) fn set_selected_indices_sot(&mut self, indices: HashSet<u32>) {
        self.selected_indices = indices;
        self.rebuild_selection_rect_cache();
    }

    // Derived cache from selected_indices for UI overlay.
    pub(crate) fn rebuild_selection_rect_cache(&mut self) {
        self.selection.rect = Self::selection_bounds(&self.selected_indices, self.width);
    }

    pub(crate) fn selected_bounds(&self) -> Option<Rect> {
        Self::selection_bounds(&self.selected_indices, self.width)
    }

    // Clear selection SoT and all move-related caches that depend on it.
    pub(crate) fn clear_selection_and_move_cache(&mut self) {
        self.selected_indices.clear();
        self.selection.rect = None;
        self.pointer.move_selected_mask.clear();
        self.pointer.move_selection_bounds = None;
    }

    pub(crate) fn clear_selection_visual_state(&mut self) {
        self.clear_selection_and_move_cache();
        self.selection.draft_rect = None;
        self.selection.lasso_points.clear();
        self.selection.draft_lasso_points.clear();
        self.selection.moving = false;
        self.selection.move_delta = Point { x: 0, y: 0 };
    }
}
