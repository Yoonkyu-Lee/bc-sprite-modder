use base64::Engine;
use std::collections::HashSet;

use super::session_store::{create_editor_session, with_editor_mut};
use super::state::{Editor, MovePreviewCache};
use super::types::{
    EditorEventResult, EditorStatus, LayerComposites, MovePreviewData, Point, PointerInput, SelectionMode,
    ShortcutInput, SnapshotResult, ToolKind,
};

impl Editor {
    fn snapshot(&self) -> SnapshotResult {
        let composited = self.composite_bitmap();
        SnapshotResult {
            width: self.width,
            height: self.height,
            rgba_base64: base64::engine::general_purpose::STANDARD.encode(composited),
        }
    }

    /// Compute and store the move preview cache from current selection + layer state.
    ///
    /// Called at two distinct times:
    ///   1. At `commit_select()` (prefetch): no FloatingLayer yet. Simulates the hole
    ///      by excluding selected pixels from the active layer in the underlay pass.
    ///   2. During a move session (cache rebuild): FloatingLayer exists. The source
    ///      layer already has holes burned, so no exclusion is needed; selected_block
    ///      is read from FloatingLayer.bitmap instead of the active layer.
    pub(crate) fn build_move_preview_cache(&mut self) {
        let Some(bounds) = self.selected_bounds() else {
            self.move_preview_cache = None;
            return;
        };

        let is_floating = self.floating_layer.is_some();
        let selected_indices_vec: Vec<u32> = self.selected_indices.iter().copied().collect();
        let selected_set: HashSet<u32> = selected_indices_vec.iter().copied().collect();
        let pixel_count = self.width * self.height;
        let active_id = self.active_layer().id;
        let active_layer_index = self.active_layer_index;
        let source_opacity = self.active_layer().opacity;

        let bw = bounds.width.max(1) as usize;
        let bh = bounds.height.max(1) as usize;

        // Build selected_block: read from FloatingLayer if it exists (active bitmap has holes),
        // otherwise read directly from the active bitmap (prefetch path).
        let selected_block = if is_floating {
            self.floating_layer.as_ref().unwrap().bitmap.clone()
        } else {
            let mut block = vec![0u8; bw * bh * 4];
            for idx in &selected_indices_vec {
                let x = (*idx % self.width) as i32;
                let y = (*idx / self.width) as i32;
                let lx = x - bounds.x;
                let ly = y - bounds.y;
                if lx < 0 || ly < 0 || lx >= bounds.width || ly >= bounds.height {
                    continue;
                }
                let src = Editor::rgba_at(self.active_bitmap(), *idx);
                let dst_i = ((ly as usize * bw) + lx as usize) * 4;
                block[dst_i] = src[0];
                block[dst_i + 1] = src[1];
                block[dst_i + 2] = src[2];
                block[dst_i + 3] = src[3];
            }
            block
        };

        // Build underlay: all layers up to and including the active layer.
        // When not floating (prefetch): exclude selected pixels from the active layer
        //   to simulate the hole that will be burned at move-start time.
        // When floating: the active layer already has holes burned; composite as-is.
        let mut underlay = vec![0u8; (pixel_count * 4) as usize];
        for (layer_index, layer) in self.layers.iter().enumerate() {
            if layer_index > active_layer_index || !layer.visible || layer.opacity == 0 {
                continue;
            }
            for idx in 0..pixel_count {
                if !is_floating && layer.id == active_id && selected_set.contains(&idx) {
                    continue;
                }
                let src_raw = Editor::rgba_at(&layer.bitmap, idx);
                if src_raw[3] == 0 {
                    continue;
                }
                let src = [
                    src_raw[0],
                    src_raw[1],
                    src_raw[2],
                    ((src_raw[3] as u16 * layer.opacity as u16) / 255) as u8,
                ];
                let dst = Editor::rgba_at(&underlay, idx);
                Editor::set_rgba(&mut underlay, idx, Editor::alpha_blend(src, dst));
            }
        }

        // Build overlay: all layers above the active layer.
        let mut overlay = vec![0u8; (pixel_count * 4) as usize];
        for (layer_index, layer) in self.layers.iter().enumerate() {
            if layer_index <= active_layer_index || !layer.visible || layer.opacity == 0 {
                continue;
            }
            for idx in 0..pixel_count {
                let src_raw = Editor::rgba_at(&layer.bitmap, idx);
                if src_raw[3] == 0 {
                    continue;
                }
                let src = [
                    src_raw[0],
                    src_raw[1],
                    src_raw[2],
                    ((src_raw[3] as u16 * layer.opacity as u16) / 255) as u8,
                ];
                let dst = Editor::rgba_at(&overlay, idx);
                Editor::set_rgba(&mut overlay, idx, Editor::alpha_blend(src, dst));
            }
        }

        self.move_preview_cache = Some(MovePreviewCache {
            selected_indices_vec,
            selected_block,
            underlay,
            overlay,
            source_opacity,
        });
    }

    /// Reads move preview data from cache. Cache must be built before calling this.
    /// Can be called before the move session starts (e.g., for pre-fetching),
    /// in which case bounds and opacity are derived from the current selection / active layer.
    fn move_preview_data(&self) -> Result<MovePreviewData, String> {
        let bounds = self
            .floating_layer
            .as_ref()
            .map(|fl| fl.bounds)
            .or_else(|| self.selected_bounds())
            .ok_or_else(|| "no active selection".to_string())?;
        let cache = self
            .move_preview_cache
            .as_ref()
            .ok_or_else(|| "move preview cache not ready".to_string())?;
        let opacity = self
            .floating_layer
            .as_ref()
            .map(|fl| fl.opacity)
            .unwrap_or(cache.source_opacity);
        Ok(MovePreviewData {
            bounds,
            selected_indices: cache.selected_indices_vec.clone(),
            selected_block_rgba_base64: base64::engine::general_purpose::STANDARD
                .encode(&cache.selected_block),
            under_selection_rgba_base64: String::new(),
            underlay_rgba_base64: base64::engine::general_purpose::STANDARD.encode(&cache.underlay),
            overlay_rgba_base64: base64::engine::general_purpose::STANDARD.encode(&cache.overlay),
            opacity,
        })
    }

    /// Returns composite bitmaps of all layers below and above the active layer.
    /// Used by the frontend to correctly composite draw/erase patches on the
    /// display bitmap (which is a flat composite, not per-layer).
    fn layer_composites(&self) -> LayerComposites {
        let pixel_count = self.width * self.height;
        let active_idx = self.active_layer_index;

        let mut underlay = vec![0u8; (pixel_count * 4) as usize];
        for (i, layer) in self.layers.iter().enumerate() {
            if i >= active_idx || !layer.visible || layer.opacity == 0 {
                continue;
            }
            for idx in 0..pixel_count {
                let src_raw = Editor::rgba_at(&layer.bitmap, idx);
                if src_raw[3] == 0 {
                    continue;
                }
                let src = [
                    src_raw[0],
                    src_raw[1],
                    src_raw[2],
                    ((src_raw[3] as u16 * layer.opacity as u16) / 255) as u8,
                ];
                let dst = Editor::rgba_at(&underlay, idx);
                Editor::set_rgba(&mut underlay, idx, Editor::alpha_blend(src, dst));
            }
        }

        let mut overlay = vec![0u8; (pixel_count * 4) as usize];
        for (i, layer) in self.layers.iter().enumerate() {
            if i <= active_idx || !layer.visible || layer.opacity == 0 {
                continue;
            }
            for idx in 0..pixel_count {
                let src_raw = Editor::rgba_at(&layer.bitmap, idx);
                if src_raw[3] == 0 {
                    continue;
                }
                let src = [
                    src_raw[0],
                    src_raw[1],
                    src_raw[2],
                    ((src_raw[3] as u16 * layer.opacity as u16) / 255) as u8,
                ];
                let dst = Editor::rgba_at(&overlay, idx);
                Editor::set_rgba(&mut overlay, idx, Editor::alpha_blend(src, dst));
            }
        }

        LayerComposites {
            underlay_rgba_base64: base64::engine::general_purpose::STANDARD.encode(&underlay),
            overlay_rgba_base64: base64::engine::general_purpose::STANDARD.encode(&overlay),
        }
    }
}

pub fn create_session(session_id: String, width: u32, height: u32) -> Result<EditorStatus, String> {
    create_editor_session(session_id, width, height)
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

pub fn get_layer_composites(session_id: &str) -> Result<LayerComposites, String> {
    with_editor_mut(session_id, |e| e.layer_composites())
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

pub fn set_active_alpha(session_id: &str, alpha: u8) -> Result<EditorStatus, String> {
    with_editor_mut(session_id, |e| e.set_active_alpha(alpha))
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

pub fn create_layer_above_active(session_id: &str) -> Result<EditorStatus, String> {
    with_editor_mut(session_id, |e| {
        e.create_layer_above_active();
        e.status()
    })
}

pub fn delete_layer(session_id: &str, layer_id: u32) -> Result<EditorStatus, String> {
    with_editor_mut(session_id, |e| {
        e.delete_layer_by_id(layer_id)?;
        Ok(e.status())
    })?
}

pub fn set_active_layer(session_id: &str, layer_id: u32) -> Result<EditorStatus, String> {
    with_editor_mut(session_id, |e| {
        e.set_active_layer_by_id(layer_id)?;
        Ok(e.status())
    })?
}

pub fn rename_layer(session_id: &str, layer_id: u32, name: String) -> Result<EditorStatus, String> {
    with_editor_mut(session_id, |e| {
        e.rename_layer(layer_id, name)?;
        Ok(e.status())
    })?
}

pub fn set_layer_opacity(session_id: &str, layer_id: u32, opacity: u8) -> Result<EditorStatus, String> {
    with_editor_mut(session_id, |e| {
        e.set_layer_opacity(layer_id, opacity)?;
        Ok(e.status())
    })?
}

pub fn toggle_layer_visibility(session_id: &str, layer_id: u32) -> Result<EditorStatus, String> {
    with_editor_mut(session_id, |e| {
        e.toggle_layer_visibility(layer_id)?;
        Ok(e.status())
    })?
}

pub fn reorder_layers(session_id: &str, ids: Vec<u32>) -> Result<EditorStatus, String> {
    with_editor_mut(session_id, |e| {
        e.reorder_layers(ids)?;
        Ok(e.status())
    })?
}
