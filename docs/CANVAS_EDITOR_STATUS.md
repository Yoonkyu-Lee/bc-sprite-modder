# Canvas Editor Status

Last updated: 2026-03-06  
Scope: current local workspace state after layer-stack introduction and move-preview z-order fixes.

## 1. Current Scope

Implemented:
- Fixed-size canvas workflow (1024x1024 session default in UI)
- Tools: `draw`, `erase`, `fill`, `pick`, `select` (rect/lasso), `move`
- Alpha-aware paint/composite (`RGBA`, source-over blending)
- Patch-based undo/redo
- Layer stack model (active layer, visibility, opacity, rename, reorder, create/delete)
- Rust editing core + WebGL2 frontend renderer
- Move preview pipeline with layer-correct z-order (`underlay -> floating -> overlay`)

Not implemented (or still basic):
- Canvas document save/load format for multi-layer editor state
- Automated regression tests for canvas core

## 2. Architecture Overview

### 2.1 Layers

1. Frontend panel/input  
- File: `src/panels/CanvasPanel.tsx`  
- Responsibility: pointer/keyboard input, toolbar/status/layer UI, backend RPC calls, render inputs

2. Frontend backend adapter  
- File: `src/features/canvas-editor/backend.ts`  
- Responsibility: Tauri invoke wrappers, patch apply helper, snapshot/move-preview decode

3. Frontend renderer (GPU)  
- File: `src/features/canvas-editor/render.ts`  
- Responsibility: WebGL2 rendering (composited base or move underlay, floating block, overlay, guides)

4. Tauri command layer  
- File: `src-tauri/src/commands/canvas_editor.rs`  
- Responsibility: command arg deserialize + forward to canvas core API

5. Rust canvas core  
- Directory: `src-tauri/src/canvas_editor/`  
- Responsibility: state, tools, history, session store, API boundary

### 2.2 Rust module map

- `mod.rs`: thin module entry, re-exports public API
- `api.rs`: public core API boundary (`session -> editor method`)
- `session_store.rs`: session lifetime + lock/store only
- `state.rs`: `Editor`, `Layer`, `PointerSession`, base state helpers
- `input.rs`: pointer event handlers and `dispatch_pointer`
- `shortcuts.rs`: keyboard/tool switching/view setters
- `history.rs`: patch build/apply/history/undo/redo
- `tools_draw.rs`: draw/erase/fill/pick logic
- `tools_select.rs`: rect/lasso selection build + commit
- `tools_move.rs`: move mask/preview/commit/cancel
- `tools.rs`: common algorithms (bresenham, flood fill, rect helpers)
- `types.rs`: shared RPC/status payload types

## 3. Layer Design (Current)

### 3.1 Core model (`state.rs`)

`Editor` stores:
- `layers: Vec<Layer>`
- `active_layer_index: usize`
- `active_color: String` (hex RGB)
- `active_alpha: u8` (0..255)
- selection/move/history/view state

`Layer` stores:
- `id: u32`
- `name: String`
- `visible: bool`
- `opacity: u8` (0..255)
- `bitmap: Vec<u8>` (`width * height * 4` RGBA)

Layer order rule:
- `layers[0]` is bottom; higher index is visually above.

### 3.2 Composite rule

Composited snapshot is produced by iterating visible layers in order and applying source-over blend:
- Per layer pixel alpha is first scaled by `layer.opacity`
- Then blended into the destination using `alpha_blend(src, dst)`

This same visual rule is respected in move preview via separated underlay/overlay buffers.

### 3.3 Active-layer edit policy

Tools write/read active layer bitmap by default:
- `draw`, `erase`, `fill`, `pick`
- selection creation and move commit target active layer data

Other layers are not directly modified unless they become active.

### 3.4 Layer operations

Implemented operations:
- `create_layer_above_active`
- `delete_layer`
- `set_active_layer`
- `rename_layer`
- `set_layer_opacity`
- `toggle_layer_visibility`
- `reorder_layers`

Behavior policies:
- Last remaining layer cannot be deleted.
- Creating a layer inserts at current active position and activates new layer.
- Deleting a layer reselects nearest valid layer.
- Active-layer switch clears/finalizes move/selection transient state.

## 4. Selection and Move State Rules

### 4.1 Selection source-of-truth

Source of truth:
- `selected_indices: HashSet<u32>`

Derived caches:
- `selection.rect`
- `pointer.move_selected_mask`
- `pointer.move_selection_bounds`

Helper rules:
- `set_selected_indices_sot(...)`
- `rebuild_selection_rect_cache()`
- `rebuild_move_selection_cache()`
- `clear_selection_and_move_cache()`

### 4.2 Move preview data contract

`MovePreviewData` now carries:
- `selected_indices`
- `selected_block_rgba_base64` (floating pixels)
- `under_selection_rgba_base64` (legacy support field)
- `underlay_rgba_base64` (all layers up to active, with selected source removed)
- `overlay_rgba_base64` (layers above active)

Frontend composes preview as:
1. Draw `underlay`
2. Draw floating selected block at current delta
3. Draw `overlay`

Result:
- Drag preview respects layer z-order.
- Active-layer floating content no longer incorrectly overdraws top layers.

### 4.3 Why move preview is correct (current golden behavior)

For correct move preview, three conditions must hold at the same time:
- Preserve layer z-order during preview (floating content must not always render at top).
- Remove source pixels from original selection area during preview.
- Keep preview non-destructive until final commit.

Current implementation satisfies this with a 3-pass render:
1. `underlay`
- Composite from bottom layer up to active layer.
- While compositing active layer, selected source pixels are excluded (source hole).

2. `floating`
- Render selected block texture at `bounds + delta`.
- During drag, only `delta` changes. No bitmap commit is performed.

3. `overlay`
- Composite only layers above active layer and render last.
- This restores true z-order so top layers remain above floating preview when appropriate.

Why previous 2-pass previews failed:
- `base + floating` draws floating effectively on top of everything.
- If active layer is not top layer, preview can falsely cover pixels from upper layers.
- If source clearing is applied both in data and shader masking, false cutout artifacts appear.

Commit/undo contract:
- Move preview is visual-only until finalize.
- Finalize generates exactly one layer-targeted patch.
- Undo/redo remains action-based and stable.

## 5. History and Undo/Redo

Patch model:
- `PixelPatch { layer_id, changed_indices, before, after }`

Key properties:
- History is layer-aware (`layer_id`), so undo/redo targets original edited layer.
- Undo returns reverse-applicable patch for frontend `applyPatch(patch.after)` flow.
- Move commit is one action (single patch) at finalize time.

## 6. Frontend Renderer Status

Renderer (`render.ts`) draws:
- base image texture (normal mode) OR underlay (move preview mode)
- floating texture (move preview)
- overlay texture (move preview)
- selection rectangle/lasso outline
- hover pixel marker

Properties:
- nearest-neighbor (`NEAREST`)
- alpha blending enabled
- fixed ordering for predictable preview correctness

## 7. Known Risks / Technical Debt

- Rust/TS contract synchronization is manual.
- Move preview currently sends full-size RGBA underlay/overlay on session start; can be optimized with regions/texture caching later.
- Core state-machine paths still lack automated tests.
- High-frequency input paths need periodic perf checks.

## 8. Recommended Next Validation Matrix

1. Layer order correctness:
- Active layer at top/middle/bottom, then move preview and commit.

2. Opacity/visibility:
- Semi-transparent layer overlap + toggle visibility during edit.

3. Undo/redo stability:
- Draw/fill/move across different active layers, then multi-step undo/redo.

4. Selection edge behavior:
- Rect/lasso selection -> move -> commit/cancel -> tool switch.

## 9. Quick File Index

Rust core:
- `src-tauri/src/canvas_editor/mod.rs`
- `src-tauri/src/canvas_editor/api.rs`
- `src-tauri/src/canvas_editor/state.rs`
- `src-tauri/src/canvas_editor/input.rs`
- `src-tauri/src/canvas_editor/shortcuts.rs`
- `src-tauri/src/canvas_editor/history.rs`
- `src-tauri/src/canvas_editor/tools_draw.rs`
- `src-tauri/src/canvas_editor/tools_select.rs`
- `src-tauri/src/canvas_editor/tools_move.rs`
- `src-tauri/src/canvas_editor/tools.rs`
- `src-tauri/src/canvas_editor/types.rs`

Tauri commands:
- `src-tauri/src/commands/canvas_editor.rs`

Frontend:
- `src/panels/CanvasPanel.tsx`
- `src/features/canvas-editor/backend.ts`
- `src/features/canvas-editor/render.ts`
- `src/features/canvas-editor/types.ts`
