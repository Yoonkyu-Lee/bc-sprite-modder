# App Architecture Overview

Last updated: 2026-03-11  
Purpose: one-document onboarding for the current workspace state.

## 1. What this app is

`the-battle-cats-sprite-modder` is a Tauri desktop app with:
- React + TypeScript frontend UI
- Rust backend core (Tauri commands)
- Python helper scripts for data setup and asset extraction

Main user flow:
1. Select workspace
2. Download/extract/index game data
3. Create/select project
4. Open sprite editor (viewport + canvas)
5. Edit assets (canvas pipeline is under active development)
6. Repack (currently placeholder UI)

## 2. Runtime Architecture

High-level layers:
1. UI layer (`src/`)
2. Tauri invoke bridge (`src/features/.../backend.ts` + command invokes)
3. Command layer (`src-tauri/src/commands/*.rs`)
4. Core modules (`src-tauri/src/canvas_editor`, `src-tauri/src/viewport`)
5. External script tooling (`src-tauri/scripts/*.py`)

Data moves from UI events -> `invoke(...)` -> Rust command -> Rust core -> response payload -> UI render.

## 3. Frontend Structure (`src/`)

App shell and tabs:
- `src/App.tsx`: workspace bootstrap gate
- `src/components/AppShell.tsx`: tab navigation (`data-setup`, `project`, `sprite`, `repack`)
- `src/pages/DataSetupPage.tsx`
- `src/pages/ProjectPage.tsx`
- `src/pages/SpritePage.tsx`
- `src/pages/RepackPage.tsx`

Global stores:
- `src/stores/workspaceStore.tsx`: workspace path + pick/refresh
- `src/stores/projectStore.tsx`: current project path + list/create helpers
- `src/stores/spriteEditorStore.tsx`: selected unit/form + browser state

Sprite editor dock panels:
- `src/panels/ViewportPanel.tsx`: animation playback panel
- `src/panels/CanvasPanel.tsx`: pixel canvas panel (modularized orchestration shell)

Canvas frontend modules:
- Backend adapter: `src/features/canvas-editor/backend.ts`
- WebGL renderer: `src/features/canvas-editor/render.ts`
- Types: `src/features/canvas-editor/types.ts`
- Hooks:
  - `hooks/useCanvasSessionQueue.ts`
  - `hooks/useCanvasRenderBridge.ts`
  - `hooks/useCanvasInputController.ts`
  - `hooks/useCanvasActions.ts`
  - `hooks/usePaletteController.ts`
- Components:
  - `components/CanvasToolbar.tsx`
  - `components/PalettePopover.tsx`
  - `components/LayersPanel.tsx`
  - `components/CanvasStatusBar.tsx`
- Helpers:
  - `panel/color.ts`
  - `panel/status.ts`
  - `panel/movePreview.ts`

Styles:
- Global: `src/styles.css`
- Canvas-specific: `src/styles/canvas-editor/layout.css`

## 4. Tauri Backend Structure (`src-tauri/src/`)

Entry:
- `src-tauri/src/lib.rs`: registers all Tauri commands

Command modules:
- `commands/workspace.rs`: get/set workspace, ensure folders
- `commands/data_setup.rs`: run/setup/extract pipeline with log events
- `commands/project.rs`: list datasets/projects, create project
- `commands/sprite.rs`: manifest build, unit form listing, asset extraction, viewport payload
- `commands/canvas_editor.rs`: canvas API command boundary

Core domains:
- `canvas_editor/`: editing core (state/history/tools/move/selection/session)
- `viewport/`: animation parse/state/playback data generation

## 5. Canvas Core (Rust) quick map

Directory: `src-tauri/src/canvas_editor/`

- `mod.rs`: module entry/re-export
- `api.rs`: public editor API facade
- `session_store.rs`: session lifetime + locking
- `state.rs`: editor state model
- `input.rs`: pointer event dispatch
- `shortcuts.rs`: keyboard dispatch
- `history.rs`: patch history + undo/redo
- `tools_draw.rs`: draw/erase/fill/pick
- `tools_select.rs`: rect/lasso selection
- `tools_move.rs`: move preview + finalize/cancel
- `tools.rs`: shared algorithms
- `types.rs`: transport types

Key design points:
- Layered RGBA editor model
- Active-layer-only editing
- Patch-based undo/redo
- Selection move preview split into underlay/floating/overlay for correct z-order

Detailed canvas status and risks are tracked in:
- `docs/CANVAS_EDITOR_STATUS.md`

## 6. Data Setup and Asset Pipeline

Python scripts live in `src-tauri/scripts/` and are invoked from Rust commands.

Main scripts:
- `data_setup.py`
- `extract_form_assets.py`
- `load_form_assets.py`
- `render_viewport_frame.py`
- plus helper modules (`project_model.py`, `game_packs_loader.py`, etc.)

Workflow summary:
1. User runs data setup from UI
2. Rust `run_data_setup` spawns Python process and streams logs to frontend (`data-setup-log`)
3. On success, manifest build is triggered (`_manifest.json`)
4. Sprite tab uses manifest to list `unit_id/form`
5. Selected unit/form assets are loaded/extracted for viewport and editor features

## 7. Persistence and Filesystem Model

Workspace:
- Stored in app data file (`workspace_path.txt`)
- Required directories created: `BCData/`, `projects/`

Project:
- `projects/<project_name>/project.json`
- Metadata includes dataset reference (`server`, `version`, `path`)
- Additional folders: `mods/`, `exports/`

Dataset:
- Usually under `BCData/apks/<package>/<version+server>/decompiled`
- Manifest index file: `_manifest.json`

## 8. Main Command Surface (for frontend integration)

Workspace:
- `get_workspace`, `set_workspace`, `ensure_workspace_structure`

Data setup:
- `run_data_setup`, `scan_datasets`, `extract_packs`

Project:
- `list_datasets`, `list_projects`, `create_project`

Sprite/viewport:
- `build_manifest`, `list_unit_forms`, `load_form_assets`, `extract_viewport_assets`
- `get_viewport_meta`, `get_viewport_playback_data`

Canvas editor:
- session: create/status/snapshot/move-preview
- input: dispatch_pointer/dispatch_shortcut
- tool/view/color/alpha setters
- undo/redo
- layer CRUD + reorder + visibility/opacity/rename

## 9. Current Development Focus and Risk Areas

Current active area:
- Canvas editor frontend modularization and UX upgrades

Known risk hotspots:
- Move preview startup latency (first interaction cost)
- High-frequency input paths (queue pressure)
- Manual synchronization of Rust/TS type contracts
- Limited automated tests around canvas state machine/history invariants

## 10. Recommended Reading Order (new thread onboarding)

1. `docs/APP_ARCHITECTURE_OVERVIEW.md` (this file)
2. `docs/CANVAS_EDITOR_STATUS.md` (deep canvas details)
3. `src/components/AppShell.tsx` + `src/pages/*.tsx` (product flow)
4. `src-tauri/src/lib.rs` + `src-tauri/src/commands/*.rs` (command map)
5. Canvas:
   - frontend: `src/panels/CanvasPanel.tsx`, `src/features/canvas-editor/*`
   - backend: `src-tauri/src/canvas_editor/*`

## 11. Immediate Next-Step Checklist (for contributors)

- Confirm target area before coding:
  - product flow (tabs/stores/pages)
  - viewport playback
  - canvas core/frontend
  - data setup pipeline
- If changing canvas contracts, update both:
  - Rust `types.rs` + command payloads
  - TS `src/features/canvas-editor/types.ts` + adapter decode
- After significant change:
  - run `cargo check`
  - run `npx vite build`
  - update `docs/CANVAS_EDITOR_STATUS.md` (canvas changes)
  - update this doc when architecture-level boundaries move
