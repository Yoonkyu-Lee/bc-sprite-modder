# Canvas Editor Status

Last updated: 2026-03-06
Scope: current local workspace state after modularization pass.

## 1. Current Scope

Implemented:
- Fixed-size canvas workflow (currently 1024x1024 in UI session setup)
- Tools: `draw`, `erase`, `fill`, `pick`, `select` (rect/lasso), `move`
- Move preview + move commit flow
- Patch-based undo/redo
- Rust editing core + WebGL2 frontend renderer

Not implemented (or still basic):
- Layer stack
- Full RGBA authoring UI (active color is hex-based)
- Save/load format pipeline for editor documents
- Automated regression tests for canvas core

## 2. Architecture Overview

### 2.1 Layers

1. Frontend panel/input
- File: `src/panels/CanvasPanel.tsx`
- Responsibility: pointer/keyboard input, toolbar/status UI, backend RPC calls, render inputs

2. Frontend backend adapter
- File: `src/features/canvas-editor/backend.ts`
- Responsibility: Tauri invoke wrappers, patch apply helper, snapshot decode

3. Frontend renderer (GPU)
- File: `src/features/canvas-editor/render.ts`
- Responsibility: WebGL2 rendering (`base texture + optional move mask + floating texture + overlays`)

4. Tauri command layer
- File: `src-tauri/src/commands/canvas_editor.rs`
- Responsibility: command args deserialize and forward to canvas core API

5. Rust canvas core
- Directory: `src-tauri/src/canvas_editor/`
- Responsibility: state, tools, history, session store

### 2.2 Rust module map

- `mod.rs`: thin module entry, re-exports public API
- `api.rs`: public core API boundary (`session -> editor method`)
- `session_store.rs`: session lifetime + lock/store only
- `state.rs`: `Editor`, `PointerSession`, base state helpers
- `input.rs`: pointer event handlers and `dispatch_pointer`
- `shortcuts.rs`: keyboard/tool switching/view setters
- `history.rs`: patch build/apply/history/undo/redo
- `tools_draw.rs`: draw/line write logic
- `tools_select.rs`: rect/lasso selection build + commit
- `tools_move.rs`: move mask/preview/commit/cancel
- `tools.rs`: common algorithms (bresenham, flood fill, rect helpers)
- `types.rs`: shared RPC/status payload types

## 3. Data Model and State Rules

### 3.1 Core state (`state.rs`)

Main fields:
- `bitmap: Vec<u8>` (`width * height * 4`, RGBA)
- `selected_indices: HashSet<u32>`
- `selection: SelectionState`
- `pointer: PointerSession`
- `undo_stack`, `redo_stack`

### 3.2 Selection source-of-truth and cache policy

Source of truth:
- `selected_indices`

Derived caches:
- `selection.rect`
- `pointer.move_selected_mask`
- `pointer.move_selection_bounds`

Rule functions:
- `set_selected_indices_sot(...)`
- `rebuild_selection_rect_cache()`
- `rebuild_move_selection_cache()`
- `clear_selection_and_move_cache()`

Policy:
- Mutate selection through SoT first.
- Rebuild dependent caches explicitly.
- Clear move caches on move session end/cancel.

## 4. Event and Render Flow

### 4.1 Draw/Erase/Fill

1. Frontend sends `dispatchPointer(down/move/up)`.
2. Rust applies tool logic and creates `PixelPatch`.
3. Frontend `applyPatch(bitmap, patch)` mutates local bitmap.
4. Renderer uploads updated texture on `bitmapVersion` change.

### 4.2 Undo/Redo

- History stores action patches.
- Undo applies reverse change in Rust and returns a frontend-applicable patch.
- Frontend always writes `patch.after`.

### 4.3 Move

1. Enter move with active selection (SoT-based).
2. Build move caches (mask/bounds) from selection.
3. During drag: update delta only.
4. Frontend shows GPU preview (`base + floating`).
5. On finalize: Rust computes one commit patch and clears move state.

## 5. Frontend Renderer Status

Renderer (`render.ts`) currently draws:
- base image texture
- optional move mask texture
- optional floating texture
- selection rectangle/lasso overlay
- pixel marker overlay

Current properties:
- nearest-neighbor filtering (`NEAREST`)
- alpha blending enabled
- selection/move overlay order fixed in renderer path

## 6. Change Impact Map (for upcoming large refactor)

### 6.1 Tool behavior changes

Primary:
- `src-tauri/src/canvas_editor/input.rs`
- `src-tauri/src/canvas_editor/tools_draw.rs`
- `src-tauri/src/canvas_editor/tools_select.rs`
- `src-tauri/src/canvas_editor/tools_move.rs`

Also verify:
- `src/features/canvas-editor/types.ts`
- `src/panels/CanvasPanel.tsx`

### 6.2 State model changes (layers, alpha, etc.)

Primary:
- `src-tauri/src/canvas_editor/state.rs`
- `src-tauri/src/canvas_editor/types.rs`
- `src-tauri/src/canvas_editor/history.rs`
- `src-tauri/src/canvas_editor/api.rs`

Also verify:
- `src-tauri/src/commands/canvas_editor.rs`
- `src/features/canvas-editor/types.ts`
- `src/features/canvas-editor/backend.ts`

### 6.3 Rendering pipeline changes

Primary:
- `src/features/canvas-editor/render.ts`
- `src/panels/CanvasPanel.tsx`

Also verify:
- `src/features/canvas-editor/backend.ts`
- Rust `types.rs` / `api.rs`

## 7. Known Risks / Technical Debt

- Regression risk is high around move/select/undo state transitions.
- Rust/TS type contracts are manually synchronized.
- Automated test coverage is still missing for core state machine paths.
- High-frequency input paths still require ongoing perf monitoring.

## 8. Recommended Refactor Sequence

1. Stabilize data model first (`state.rs`, `types.rs`).
2. Lock API contract (`api.rs`, `commands/canvas_editor.rs`).
3. Update panel/backend adapter (`CanvasPanel.tsx`, `backend.ts`).
4. Update renderer (`render.ts`).
5. Re-validate history/undo/redo (`history.rs`).

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
