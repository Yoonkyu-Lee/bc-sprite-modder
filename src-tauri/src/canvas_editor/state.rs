use std::collections::{HashMap, HashSet};

use super::types::{EditorStatus, LayerStatus, PixelPatch, Point, Rect, SelectionMode, SelectionState, ToolKind};

#[derive(Clone)]
pub(crate) struct PixelChange {
    pub(crate) before: [u8; 4],
    pub(crate) after: [u8; 4],
}

/// A floating selection lifted off the source layer.
/// The source layer has the selected pixels burned to transparent.
/// On commit (finalize) these pixels are composited at `offset` into the target layer.
/// On cancel, `original_pixels` is used to restore the source layer.
pub(crate) struct FloatingLayer {
    pub(crate) source_layer_id: u32,
    /// Bounds-local RGBA bitmap (bounds.width * bounds.height * 4 bytes).
    pub(crate) bitmap: Vec<u8>,
    /// Canvas-space pixel indices that make up this floating layer.
    pub(crate) selected_indices: Vec<u32>,
    /// Current move offset relative to original position.
    pub(crate) offset: Point,
    /// Bounding box of the selection in canvas space (original position).
    pub(crate) bounds: Rect,
    /// Opacity inherited from the source layer at float-start time.
    pub(crate) opacity: u8,
    /// Original RGBA for each pixel in selected_indices (N * 4 bytes, packed).
    /// Used to restore the source layer on cancel.
    pub(crate) original_pixels: Vec<u8>,
}

pub(crate) struct MovePreviewCache {
    pub(crate) selected_indices_vec: Vec<u32>,
    pub(crate) selected_block: Vec<u8>,
    pub(crate) underlay: Vec<u8>,
    pub(crate) overlay: Vec<u8>,
    /// Active layer opacity captured at cache-build time (used when no FloatingLayer yet).
    pub(crate) source_opacity: u8,
}

#[derive(Default)]
pub(crate) struct PointerSession {
    pub(crate) last_point: Option<Point>,
    pub(crate) action_changes: HashMap<u32, PixelChange>,
    pub(crate) select_start: Option<Point>,
    pub(crate) move_start: Option<Point>,
    pub(crate) move_drag_origin: Option<Point>,
}

pub(crate) struct Editor {
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) layers: Vec<Layer>,
    pub(crate) active_layer_index: usize,
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
    pub(crate) next_layer_id: u32,
    pub(crate) move_preview_cache: Option<MovePreviewCache>,
    /// Active floating selection. When Some, source layer has pixels burned to transparent.
    pub(crate) floating_layer: Option<FloatingLayer>,
}

pub(crate) struct Layer {
    pub(crate) id: u32,
    pub(crate) name: String,
    pub(crate) visible: bool,
    pub(crate) opacity: u8,
    pub(crate) bitmap: Vec<u8>,
}

impl Editor {
    pub(crate) fn new(width: u32, height: u32) -> Self {
        let layer_bitmap = vec![0u8; (width * height * 4) as usize];
        Self {
            width,
            height,
            layers: vec![Layer {
                id: 1,
                name: "Layer 1".to_string(),
                visible: true,
                opacity: 255,
                bitmap: layer_bitmap,
            }],
            active_layer_index: 0,
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
            next_layer_id: 2,
            move_preview_cache: None,
            floating_layer: None,
        }
    }

    pub(crate) fn status(&self) -> EditorStatus {
        EditorStatus {
            width: self.width,
            height: self.height,
            tool: self.tool,
            active_color: self.active_color.clone(),
            active_alpha: self.active_alpha,
            active_layer_id: self.active_layer().id,
            layers: self
                .layers
                .iter()
                .map(|l| LayerStatus {
                    id: l.id,
                    name: l.name.clone(),
                    visible: l.visible,
                    opacity: l.opacity,
                })
                .collect(),
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

    pub(crate) fn active_layer(&self) -> &Layer {
        &self.layers[self.active_layer_index]
    }

    pub(crate) fn active_layer_mut(&mut self) -> &mut Layer {
        &mut self.layers[self.active_layer_index]
    }

    pub(crate) fn active_bitmap(&self) -> &[u8] {
        &self.active_layer().bitmap
    }

    pub(crate) fn active_bitmap_mut(&mut self) -> &mut [u8] {
        &mut self.active_layer_mut().bitmap
    }

    pub(crate) fn layer_index_by_id(&self, layer_id: u32) -> Option<usize> {
        self.layers.iter().position(|l| l.id == layer_id)
    }

    pub(crate) fn bitmap_mut_for_layer_id(&mut self, layer_id: u32) -> Option<&mut [u8]> {
        let idx = self.layer_index_by_id(layer_id)?;
        Some(&mut self.layers[idx].bitmap)
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
        let before = Self::rgba_at(self.active_bitmap(), idx);
        if before == rgba {
            return;
        }
        changes
            .entry(idx)
            .and_modify(|c| c.after = rgba)
            .or_insert(PixelChange { before, after: rgba });
        Self::set_rgba(self.active_bitmap_mut(), idx, rgba);
    }

    /// Composite all layers in z-order, inserting the FloatingLayer at the correct
    /// z-position (immediately above its source layer) if one is active.
    pub(crate) fn composite_bitmap(&self) -> Vec<u8> {
        let mut out = vec![0u8; (self.width * self.height * 4) as usize];

        // Determine at which layer index to insert the floating layer.
        let float_insert_after: Option<usize> = self
            .floating_layer
            .as_ref()
            .and_then(|fl| self.layer_index_by_id(fl.source_layer_id));

        for (layer_index, layer) in self.layers.iter().enumerate() {
            if layer.visible && layer.opacity > 0 {
                for idx in 0..(self.width * self.height) {
                    let src_raw = Self::rgba_at(&layer.bitmap, idx);
                    if src_raw[3] == 0 {
                        continue;
                    }
                    let src = [
                        src_raw[0],
                        src_raw[1],
                        src_raw[2],
                        ((src_raw[3] as u16 * layer.opacity as u16) / 255) as u8,
                    ];
                    let dst = Self::rgba_at(&out, idx);
                    Self::set_rgba(&mut out, idx, Self::alpha_blend(src, dst));
                }
            }

            // Insert floating layer right above its source layer.
            if Some(layer_index) == float_insert_after {
                let fl = self.floating_layer.as_ref().unwrap();
                let bw = fl.bounds.width.max(1) as usize;
                for &src_idx in &fl.selected_indices {
                    let dst_x = (src_idx % self.width) as i32 + fl.offset.x;
                    let dst_y = (src_idx / self.width) as i32 + fl.offset.y;
                    if dst_x < 0
                        || dst_y < 0
                        || dst_x >= self.width as i32
                        || dst_y >= self.height as i32
                    {
                        continue;
                    }
                    let dst_idx = dst_y as u32 * self.width + dst_x as u32;
                    let bx = (src_idx % self.width) as i32 - fl.bounds.x;
                    let by = (src_idx / self.width) as i32 - fl.bounds.y;
                    let li = (by as usize * bw + bx as usize) * 4;
                    let src_raw = [fl.bitmap[li], fl.bitmap[li + 1], fl.bitmap[li + 2], fl.bitmap[li + 3]];
                    if src_raw[3] == 0 {
                        continue;
                    }
                    let src = [
                        src_raw[0],
                        src_raw[1],
                        src_raw[2],
                        ((src_raw[3] as u16 * fl.opacity as u16) / 255) as u8,
                    ];
                    let dst = Self::rgba_at(&out, dst_idx);
                    Self::set_rgba(&mut out, dst_idx, Self::alpha_blend(src, dst));
                }
            }
        }

        out
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
        self.move_preview_cache = None;
        self.floating_layer = None;
    }

    pub(crate) fn clear_selection_visual_state(&mut self) {
        self.clear_selection_and_move_cache();
        self.selection.draft_rect = None;
        self.selection.lasso_points.clear();
        self.selection.draft_lasso_points.clear();
        self.selection.moving = false;
        self.selection.move_delta = Point { x: 0, y: 0 };
    }

    pub(crate) fn create_layer_above_active(&mut self) {
        if self.floating_layer.is_some() {
            self.cancel_move_session();
        }
        let id = self.next_layer_id;
        self.next_layer_id += 1;
        let insert_at = self.active_layer_index + 1;
        let layer = Layer {
            id,
            name: format!("Layer {}", id),
            visible: true,
            opacity: 255,
            bitmap: vec![0u8; (self.width * self.height * 4) as usize],
        };
        self.layers.insert(insert_at, layer);
        self.active_layer_index = insert_at;
        self.clear_selection_visual_state();
    }

    pub(crate) fn delete_layer_by_id(&mut self, layer_id: u32) -> Result<(), String> {
        if self.layers.len() <= 1 {
            return Err("cannot delete the last layer".to_string());
        }
        if self.floating_layer.is_some() {
            self.cancel_move_session();
        }
        let Some(idx) = self.layer_index_by_id(layer_id) else {
            return Err(format!("layer not found: {layer_id}"));
        };
        self.layers.remove(idx);
        if idx < self.layers.len() {
            self.active_layer_index = idx;
        } else {
            self.active_layer_index = self.layers.len() - 1;
        }
        self.clear_selection_visual_state();
        Ok(())
    }

    pub(crate) fn set_active_layer_by_id(&mut self, layer_id: u32) -> Result<(), String> {
        let Some(idx) = self.layer_index_by_id(layer_id) else {
            return Err(format!("layer not found: {layer_id}"));
        };
        if self.floating_layer.is_some() {
            let _ = self.finalize_move_session();
        }
        self.active_layer_index = idx;
        self.clear_selection_visual_state();
        Ok(())
    }

    pub(crate) fn rename_layer(&mut self, layer_id: u32, name: String) -> Result<(), String> {
        let Some(idx) = self.layer_index_by_id(layer_id) else {
            return Err(format!("layer not found: {layer_id}"));
        };
        let n = name.trim();
        if n.is_empty() {
            return Err("layer name cannot be empty".to_string());
        }
        self.layers[idx].name = n.to_string();
        Ok(())
    }

    pub(crate) fn set_layer_opacity(&mut self, layer_id: u32, opacity: u8) -> Result<(), String> {
        let Some(idx) = self.layer_index_by_id(layer_id) else {
            return Err(format!("layer not found: {layer_id}"));
        };
        self.layers[idx].opacity = opacity;
        self.move_preview_cache = None;
        Ok(())
    }

    pub(crate) fn toggle_layer_visibility(&mut self, layer_id: u32) -> Result<(), String> {
        let Some(idx) = self.layer_index_by_id(layer_id) else {
            return Err(format!("layer not found: {layer_id}"));
        };
        self.layers[idx].visible = !self.layers[idx].visible;
        self.move_preview_cache = None;
        Ok(())
    }

    pub(crate) fn reorder_layers(&mut self, ids: Vec<u32>) -> Result<(), String> {
        if ids.len() != self.layers.len() {
            return Err("layer id count mismatch".to_string());
        }
        let current_ids: std::collections::HashSet<u32> = self.layers.iter().map(|l| l.id).collect();
        let incoming_ids: std::collections::HashSet<u32> = ids.iter().copied().collect();
        if current_ids != incoming_ids {
            return Err("layer id set mismatch".to_string());
        }

        let active_id = self.active_layer().id;
        let mut by_id = HashMap::new();
        for layer in self.layers.drain(..) {
            by_id.insert(layer.id, layer);
        }
        let mut reordered = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(layer) = by_id.remove(&id) {
                reordered.push(layer);
            }
        }
        self.layers = reordered;
        self.active_layer_index = self
            .layer_index_by_id(active_id)
            .ok_or("active layer missing after reorder".to_string())?;
        self.move_preview_cache = None;
        Ok(())
    }
}
