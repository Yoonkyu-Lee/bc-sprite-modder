use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::state::Editor;
use crate::types::{Point, PointerInput, Rect, SelectionMode, ShortcutInput, ToolKind};

// ---------------------------------------------------------------------------
// Move preview metadata — byte buffers are returned via separate methods so
// that wasm-bindgen's native Vec<u8> → Uint8Array conversion is used instead
// of serde's (which would produce a number array).
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WasmMovePreviewMeta {
    bounds: Rect,
    selected_indices: Vec<u32>,
    opacity: u8,
}

// ---------------------------------------------------------------------------
// CanvasEditor — the single WASM-exported object that replaces session_store
// ---------------------------------------------------------------------------

#[wasm_bindgen]
pub struct CanvasEditor {
    inner: Editor,
}

#[wasm_bindgen]
impl CanvasEditor {
    #[wasm_bindgen(constructor)]
    pub fn new(width: u32, height: u32) -> Result<CanvasEditor, JsValue> {
        if width == 0 || height == 0 {
            return Err(JsValue::from_str("width/height must be > 0"));
        }
        Ok(CanvasEditor { inner: Editor::new(width, height) })
    }

    /// Returns the current EditorStatus as a JS object.
    pub fn get_status(&self) -> JsValue {
        to_js(&self.inner.status())
    }

    // -----------------------------------------------------------------------
    // Input dispatch
    // -----------------------------------------------------------------------

    /// Dispatches a pointer event. `button` is -1 when not applicable.
    /// Returns `{ status, patch, consumed }`.
    pub fn dispatch_pointer(&mut self, kind: &str, x: i32, y: i32, button: i32) -> JsValue {
        let input = PointerInput {
            kind: kind.to_string(),
            x,
            y,
            button: if button < 0 { None } else { Some(button) },
        };
        to_js(&self.inner.dispatch_pointer(input))
    }

    /// Dispatches a keyboard shortcut. Returns `{ status, patch, consumed }`.
    pub fn dispatch_shortcut(&mut self, key: &str, ctrl: bool, shift: bool, alt: bool) -> JsValue {
        let input = ShortcutInput { key: key.to_string(), ctrl, shift, alt };
        to_js(&self.inner.dispatch_shortcut(input))
    }

    // -----------------------------------------------------------------------
    // Tool / view settings — all return the updated EditorStatus
    // -----------------------------------------------------------------------

    pub fn set_tool(&mut self, tool: &str) -> Result<JsValue, JsValue> {
        Ok(to_js(&self.inner.set_tool(parse_tool(tool)?)))
    }

    pub fn set_selection_mode(&mut self, mode: &str) -> Result<JsValue, JsValue> {
        Ok(to_js(&self.inner.set_selection_mode(parse_selection_mode(mode)?)))
    }

    pub fn set_active_color(&mut self, hex: &str) -> JsValue {
        to_js(&self.inner.set_active_color(hex.to_string()))
    }

    pub fn set_active_alpha(&mut self, alpha: u8) -> JsValue {
        to_js(&self.inner.set_active_alpha(alpha))
    }

    pub fn set_view(&mut self, zoom: f32, pan_x: i32, pan_y: i32) -> JsValue {
        to_js(&self.inner.set_view(zoom, Point { x: pan_x, y: pan_y }))
    }

    // -----------------------------------------------------------------------
    // History
    // -----------------------------------------------------------------------

    /// Returns `{ status, patch, consumed }`.
    pub fn undo(&mut self) -> JsValue {
        to_js(&self.inner.undo())
    }

    /// Returns `{ status, patch, consumed }`.
    pub fn redo(&mut self) -> JsValue {
        to_js(&self.inner.redo())
    }

    // -----------------------------------------------------------------------
    // Layer management — all return the updated EditorStatus
    // -----------------------------------------------------------------------

    pub fn create_layer_above_active(&mut self) -> JsValue {
        self.inner.create_layer_above_active();
        to_js(&self.inner.status())
    }

    pub fn delete_layer(&mut self, layer_id: u32) -> Result<JsValue, JsValue> {
        self.inner.delete_layer_by_id(layer_id).map_err(js_err)?;
        Ok(to_js(&self.inner.status()))
    }

    pub fn set_active_layer(&mut self, layer_id: u32) -> Result<JsValue, JsValue> {
        self.inner.set_active_layer_by_id(layer_id).map_err(js_err)?;
        Ok(to_js(&self.inner.status()))
    }

    pub fn rename_layer(&mut self, layer_id: u32, name: &str) -> Result<JsValue, JsValue> {
        self.inner.rename_layer(layer_id, name.to_string()).map_err(js_err)?;
        Ok(to_js(&self.inner.status()))
    }

    pub fn set_layer_opacity(&mut self, layer_id: u32, opacity: u8) -> Result<JsValue, JsValue> {
        self.inner.set_layer_opacity(layer_id, opacity).map_err(js_err)?;
        Ok(to_js(&self.inner.status()))
    }

    pub fn toggle_layer_visibility(&mut self, layer_id: u32) -> Result<JsValue, JsValue> {
        self.inner.toggle_layer_visibility(layer_id).map_err(js_err)?;
        Ok(to_js(&self.inner.status()))
    }

    pub fn reorder_layers(&mut self, ids: Box<[u32]>) -> Result<JsValue, JsValue> {
        self.inner.reorder_layers(ids.into_vec()).map_err(js_err)?;
        Ok(to_js(&self.inner.status()))
    }

    // -----------------------------------------------------------------------
    // Pixel data access
    // -----------------------------------------------------------------------

    /// Returns the fully composited RGBA bitmap of all visible layers.
    /// In JS this becomes a `Uint8Array`.
    pub fn get_composite_bitmap(&self) -> Vec<u8> {
        self.inner.composite_bitmap()
    }

    /// Returns the raw RGBA pixel data for a single layer.
    /// Returns an empty array if the layer is not found.
    pub fn get_layer_bitmap(&self, layer_id: u32) -> Vec<u8> {
        self.inner.layer_bitmap(layer_id).unwrap_or_default()
    }

    /// Overwrites a layer's pixel data with raw RGBA bytes.
    /// `data` must be exactly `width * height * 4` bytes; silently ignored otherwise.
    pub fn load_layer_pixels(&mut self, layer_id: u32, data: &[u8]) {
        self.inner.load_layer_pixels(layer_id, data);
    }

    // -----------------------------------------------------------------------
    // Move preview — split into metadata + separate byte-buffer accessors so
    // that wasm-bindgen returns proper Uint8Arrays (not serde number arrays).
    // Call get_move_preview_meta() first, then the three buffer methods.
    // -----------------------------------------------------------------------

    /// Returns `{ bounds, selectedIndices, opacity }`.
    pub fn get_move_preview_meta(&self) -> Result<JsValue, JsValue> {
        let bounds = self
            .inner
            .floating_layer
            .as_ref()
            .map(|fl| fl.bounds)
            .or_else(|| self.inner.selected_bounds())
            .ok_or_else(|| JsValue::from_str("no active selection"))?;

        let cache = self
            .inner
            .move_preview_cache
            .as_ref()
            .ok_or_else(|| JsValue::from_str("move preview cache not ready"))?;

        let opacity = self
            .inner
            .floating_layer
            .as_ref()
            .map(|fl| fl.opacity)
            .unwrap_or(cache.source_opacity);

        Ok(to_js(&WasmMovePreviewMeta {
            bounds,
            selected_indices: cache.selected_indices_vec.clone(),
            opacity,
        }))
    }

    /// Returns the selected pixels RGBA block as a `Uint8Array`.
    pub fn get_move_preview_selected_block(&self) -> Result<Vec<u8>, JsValue> {
        let cache = self
            .inner
            .move_preview_cache
            .as_ref()
            .ok_or_else(|| JsValue::from_str("move preview cache not ready"))?;
        Ok(cache.selected_block.clone())
    }

    /// Returns the underlay (all layers below active) RGBA as a `Uint8Array`.
    pub fn get_move_preview_underlay(&self) -> Result<Vec<u8>, JsValue> {
        let cache = self
            .inner
            .move_preview_cache
            .as_ref()
            .ok_or_else(|| JsValue::from_str("move preview cache not ready"))?;
        Ok(cache.underlay.clone())
    }

    /// Returns the overlay (all layers above active) RGBA as a `Uint8Array`.
    pub fn get_move_preview_overlay(&self) -> Result<Vec<u8>, JsValue> {
        let cache = self
            .inner
            .move_preview_cache
            .as_ref()
            .ok_or_else(|| JsValue::from_str("move preview cache not ready"))?;
        Ok(cache.overlay.clone())
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn to_js<T: serde::Serialize>(v: &T) -> JsValue {
    serde_wasm_bindgen::to_value(v).unwrap_or(JsValue::NULL)
}

fn js_err(s: String) -> JsValue {
    JsValue::from_str(&s)
}

fn parse_tool(s: &str) -> Result<ToolKind, JsValue> {
    match s {
        "pick"   => Ok(ToolKind::Pick),
        "draw"   => Ok(ToolKind::Draw),
        "fill"   => Ok(ToolKind::Fill),
        "erase"  => Ok(ToolKind::Erase),
        "select" => Ok(ToolKind::Select),
        "move"   => Ok(ToolKind::Move),
        _ => Err(JsValue::from_str(&format!("unknown tool: {s}"))),
    }
}

fn parse_selection_mode(s: &str) -> Result<SelectionMode, JsValue> {
    match s {
        "rect"  => Ok(SelectionMode::Rect),
        "lasso" => Ok(SelectionMode::Lasso),
        _ => Err(JsValue::from_str(&format!("unknown selection mode: {s}"))),
    }
}
