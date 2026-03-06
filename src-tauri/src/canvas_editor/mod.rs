pub mod tools;
pub mod types;

use base64::Engine;
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use tools::{bresenham_line, flood_fill, normalize_rect, point_in_rect};
use types::{
    EditorEventResult, EditorStatus, MovePreviewData, PixelPatch, Point, PointerInput, Rect, SelectionMode,
    SelectionState, ShortcutInput, SnapshotResult, ToolKind,
};

#[derive(Clone)]
struct PixelChange {
    before: [u8; 4],
    after: [u8; 4],
}

#[derive(Default)]
struct PointerSession {
    last_point: Option<Point>,
    action_changes: HashMap<u32, PixelChange>,
    select_start: Option<Point>,
    move_start: Option<Point>,
    move_drag_origin: Option<Point>,
    move_base_bitmap: Option<Vec<u8>>,
    move_selected_mask: Vec<u8>,
    move_selection_bounds: Option<Rect>,
    move_current_delta: Point,
}

struct Editor {
    width: u32,
    height: u32,
    bitmap: Vec<u8>,
    tool: ToolKind,
    active_color: String,
    selection: SelectionState,
    message: Option<String>,
    zoom: f32,
    pan: Point,
    is_pointer_down: bool,
    undo_stack: Vec<PixelPatch>,
    redo_stack: Vec<PixelPatch>,
    selected_indices: HashSet<u32>,
    pointer: PointerSession,
}

impl Editor {
    fn new(width: u32, height: u32) -> Self {
        Self {
            width,
            height,
            bitmap: vec![0u8; (width * height * 4) as usize],
            tool: ToolKind::Draw,
            active_color: "#ffffff".to_string(),
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

    fn status(&self) -> EditorStatus {
        EditorStatus {
            width: self.width,
            height: self.height,
            tool: self.tool,
            active_color: self.active_color.clone(),
            selection: self.selection.clone(),
            message: self.message.clone(),
            can_undo: !self.undo_stack.is_empty(),
            can_redo: !self.redo_stack.is_empty(),
            zoom: self.zoom,
            pan: self.pan,
            is_pointer_down: self.is_pointer_down,
        }
    }

    fn parse_color(hex: &str) -> [u8; 4] {
        let n = hex.trim().trim_start_matches('#');
        if n.len() != 6 {
            return [255, 255, 255, 255];
        }
        let Ok(v) = u32::from_str_radix(n, 16) else {
            return [255, 255, 255, 255];
        };
        [((v >> 16) & 0xff) as u8, ((v >> 8) & 0xff) as u8, (v & 0xff) as u8, 255]
    }

    fn to_hex(rgba: [u8; 4]) -> String {
        format!("#{:02x}{:02x}{:02x}", rgba[0], rgba[1], rgba[2])
    }

    fn idx(&self, p: Point) -> u32 {
        p.y as u32 * self.width + p.x as u32
    }

    fn in_bounds(&self, p: Point) -> bool {
        p.x >= 0 && p.y >= 0 && p.x < self.width as i32 && p.y < self.height as i32
    }

    fn rgba_at(bitmap: &[u8], idx: u32) -> [u8; 4] {
        let i = (idx * 4) as usize;
        [bitmap[i], bitmap[i + 1], bitmap[i + 2], bitmap[i + 3]]
    }

    fn set_rgba(bitmap: &mut [u8], idx: u32, rgba: [u8; 4]) {
        let i = (idx * 4) as usize;
        bitmap[i] = rgba[0];
        bitmap[i + 1] = rgba[1];
        bitmap[i + 2] = rgba[2];
        bitmap[i + 3] = rgba[3];
    }

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
                    desired = color;
                }
            }
        }
        desired
    }

    fn set_pixel_with_changes(
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

    fn patch_from_changes(changes: &HashMap<u32, PixelChange>) -> Option<PixelPatch> {
        if changes.is_empty() {
            return None;
        }
        let mut changed_indices = Vec::with_capacity(changes.len());
        let mut before = Vec::with_capacity(changes.len() * 4);
        let mut after = Vec::with_capacity(changes.len() * 4);
        for (idx, c) in changes {
            changed_indices.push(*idx);
            before.extend_from_slice(&c.before);
            after.extend_from_slice(&c.after);
        }
        Some(PixelPatch {
            changed_indices,
            before,
            after,
        })
    }

    fn apply_patch(&mut self, patch: &PixelPatch, undo: bool) {
        let src = if undo { &patch.before } else { &patch.after };
        for (n, idx) in patch.changed_indices.iter().enumerate() {
            let j = n * 4;
            Self::set_rgba(&mut self.bitmap, *idx, [src[j], src[j + 1], src[j + 2], src[j + 3]]);
        }
    }

    fn push_history(&mut self, patch: PixelPatch) {
        const MAX_HISTORY: usize = 128;
        self.undo_stack.push(patch);
        if self.undo_stack.len() > MAX_HISTORY {
            self.undo_stack.remove(0);
        }
        self.redo_stack.clear();
    }

    fn draw_segment(&mut self, from: Point, to: Point, rgba: [u8; 4]) -> Option<PixelPatch> {
        let mut local = HashMap::<u32, PixelChange>::new();
        let mut action = std::mem::take(&mut self.pointer.action_changes);
        for p in bresenham_line(from, to) {
            if p.x < 0 || p.y < 0 || p.x >= self.width as i32 || p.y >= self.height as i32 {
                continue;
            }
            self.set_pixel_with_changes(&mut local, p, rgba);
            let idx = self.idx(p);
            let after = Self::rgba_at(&self.bitmap, idx);
            let before = local.get(&idx).map(|c| c.before).unwrap_or([0, 0, 0, 0]);
            action
                .entry(idx)
                .and_modify(|c| c.after = after)
                .or_insert(PixelChange { before, after });
        }
        self.pointer.action_changes = action;
        Self::patch_from_changes(&local)
    }

    fn build_selection_indices_from_rect(&self, rect: Rect) -> HashSet<u32> {
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

    fn point_in_polygon(point: Point, polygon: &[Point]) -> bool {
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

    fn build_selection_indices_from_lasso(&self, points: &[Point]) -> HashSet<u32> {
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

    fn selection_bounds(indices: &HashSet<u32>, width: u32) -> Option<Rect> {
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

    // selected_indices is the single source of truth for selected pixels.
    // Rect is treated as a derived cache for UI overlays.
    fn set_selected_indices(&mut self, indices: HashSet<u32>) {
        self.selected_indices = indices;
        self.selection.rect = Self::selection_bounds(&self.selected_indices, self.width);
    }

    fn selected_bounds(&self) -> Option<Rect> {
        Self::selection_bounds(&self.selected_indices, self.width)
    }

    // Move cache: rebuilt once when move session starts, cleared when move session ends.
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
                for fp in flood_fill(&self.bitmap, self.width as i32, self.height as i32, p, target, replacement) {
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
                    let bounds = self.selected_bounds();
                    let Some(bounds) = bounds else {
                        self.message = Some("MOVE: no active selection".into());
                        return None;
                    };
                    let (selected_mask, has_opaque) = self.build_move_mask_from_selected_indices();
                    if !has_opaque {
                        self.message = Some("MOVE: no movable pixels".into());
                        return None;
                    }
                    self.pointer.move_base_bitmap = Some(self.bitmap.clone());
                    self.pointer.move_selected_mask = selected_mask;
                    self.pointer.move_selection_bounds = Some(bounds);
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

    fn update_move_preview_state(&mut self, next_delta: Point) {
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

    fn commit_select(&mut self) {
        self.selection.move_delta = Point { x: 0, y: 0 };
        self.selection.moving = false;
        if self.selection.mode == SelectionMode::Rect {
            let rect = self.selection.draft_rect;
            self.selection.draft_rect = None;
            self.selection.lasso_points.clear();
            self.selection.draft_lasso_points.clear();
            let indices = rect.map(|r| self.build_selection_indices_from_rect(r)).unwrap_or_default();
            self.set_selected_indices(indices);
        } else {
            self.selection.lasso_points = self.selection.draft_lasso_points.clone();
            self.selection.draft_lasso_points.clear();
            let indices = self.build_selection_indices_from_lasso(&self.selection.lasso_points);
            self.set_selected_indices(indices);
            self.selection.draft_rect = None;
        }
    }

    fn clear_move_state(&mut self) {
        self.set_selected_indices(HashSet::new());
        self.selection.lasso_points.clear();
        self.selection.draft_rect = None;
        self.selection.draft_lasso_points.clear();
        self.selection.moving = false;
        self.selection.move_delta = Point { x: 0, y: 0 };
        self.pointer.move_start = None;
        self.pointer.move_drag_origin = None;
        self.pointer.move_base_bitmap = None;
        self.pointer.move_selected_mask.clear();
        self.pointer.move_selection_bounds = None;
        self.pointer.move_current_delta = Point { x: 0, y: 0 };
    }

    fn cancel_move_session(&mut self) {
        self.clear_move_state();
    }

    fn finalize_move_session(&mut self) -> Option<PixelPatch> {
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

    fn dispatch_pointer(&mut self, input: PointerInput) -> EditorEventResult {
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

    fn set_tool(&mut self, tool: ToolKind) -> EditorStatus {
        if self.tool == ToolKind::Move && tool != ToolKind::Move && self.pointer.move_base_bitmap.is_some() {
            let _ = self.finalize_move_session();
        }
        self.tool = tool;
        self.message = Some(format!("TOOL: {:?}", tool).to_uppercase());
        self.status()
    }

    fn set_selection_mode(&mut self, mode: SelectionMode) -> EditorStatus {
        if self.pointer.move_base_bitmap.is_some() {
            let _ = self.finalize_move_session();
        }
        self.selection.mode = mode;
        self.message = Some(format!("SELECT MODE: {:?}", mode).to_uppercase());
        self.status()
    }

    fn set_active_color(&mut self, hex: String) -> EditorStatus {
        self.active_color = hex;
        self.status()
    }

    fn set_view(&mut self, zoom: f32, pan: Point) -> EditorStatus {
        self.zoom = zoom;
        self.pan = pan;
        self.status()
    }

    fn undo(&mut self) -> EditorEventResult {
        if self.pointer.move_base_bitmap.is_some() {
            self.cancel_move_session();
        }
        let patch = self.undo_stack.pop();
        if let Some(ref pch) = patch {
            self.apply_patch(pch, true);
            self.redo_stack.push(pch.clone());
            self.message = Some("UNDO".into());
        }
        EditorEventResult {
            status: self.status(),
            patch,
            consumed: true,
        }
    }

    fn redo(&mut self) -> EditorEventResult {
        if self.pointer.move_base_bitmap.is_some() {
            self.cancel_move_session();
        }
        let patch = self.redo_stack.pop();
        if let Some(ref pch) = patch {
            self.apply_patch(pch, false);
            self.undo_stack.push(pch.clone());
            self.message = Some("REDO".into());
        }
        EditorEventResult {
            status: self.status(),
            patch,
            consumed: true,
        }
    }

    fn dispatch_shortcut(&mut self, input: ShortcutInput) -> EditorEventResult {
        let key = input.key.to_lowercase();
        if input.ctrl && !input.shift && key == "z" {
            return self.undo();
        }
        if input.ctrl && !input.shift && key == "y" {
            return self.redo();
        }
        if key == "tab" {
            if self.tool == ToolKind::Move && self.pointer.move_base_bitmap.is_some() {
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
            if self.pointer.move_base_bitmap.is_some() {
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
            if self.tool == ToolKind::Move && tool != ToolKind::Move && self.pointer.move_base_bitmap.is_some() {
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

static STORE: OnceLock<Mutex<HashMap<String, Editor>>> = OnceLock::new();

fn store() -> &'static Mutex<HashMap<String, Editor>> {
    STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn with_editor_mut<R, F>(session_id: &str, f: F) -> Result<R, String>
where
    F: FnOnce(&mut Editor) -> R,
{
    let mut guard = store()
        .lock()
        .map_err(|_| "canvas editor lock poisoned".to_string())?;
    let Some(editor) = guard.get_mut(session_id) else {
        return Err(format!("canvas session not found: {session_id}"));
    };
    Ok(f(editor))
}

pub fn create_session(session_id: String, width: u32, height: u32) -> Result<EditorStatus, String> {
    if width == 0 || height == 0 {
        return Err("width/height must be > 0".into());
    }
    let mut guard = store()
        .lock()
        .map_err(|_| "canvas editor lock poisoned".to_string())?;
    guard.insert(session_id.clone(), Editor::new(width, height));
    Ok(guard
        .get(&session_id)
        .ok_or("failed to create session".to_string())?
        .status())
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



