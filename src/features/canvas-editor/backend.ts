import { invoke } from "@tauri-apps/api/core";
import type { EditorEventResult, EditorStatus, MovePreviewData, Point, SelectionMode, SnapshotResult, ToolKind } from "./types";

export type PointerRpcInput = {
  kind: "down" | "move" | "up";
  x: number;
  y: number;
  button?: number;
};

export type ShortcutRpcInput = {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
};

export async function createSession(sessionId: string, width: number, height: number): Promise<EditorStatus> {
  return invoke("canvas_editor_create_session", {
    args: { sessionId, width, height },
  });
}

export async function getSnapshot(sessionId: string): Promise<SnapshotResult> {
  return invoke("canvas_editor_get_snapshot", { args: { sessionId } });
}

export async function dispatchPointer(sessionId: string, input: PointerRpcInput): Promise<EditorEventResult> {
  return invoke("canvas_editor_dispatch_pointer", {
    args: { sessionId, input },
  });
}

export async function getMovePreviewData(sessionId: string): Promise<MovePreviewData> {
  return invoke("canvas_editor_get_move_preview_data", { args: { sessionId } });
}

export async function dispatchShortcut(sessionId: string, input: ShortcutRpcInput): Promise<EditorEventResult> {
  return invoke("canvas_editor_dispatch_shortcut", {
    args: { sessionId, input },
  });
}

export async function setTool(sessionId: string, tool: ToolKind): Promise<EditorStatus> {
  return invoke("canvas_editor_set_tool", {
    args: { sessionId, tool },
  });
}

export async function setSelectionMode(sessionId: string, mode: SelectionMode): Promise<EditorStatus> {
  return invoke("canvas_editor_set_selection_mode", {
    args: { sessionId, mode },
  });
}

export async function setActiveColor(sessionId: string, hex: string): Promise<EditorStatus> {
  return invoke("canvas_editor_set_active_color", {
    args: { sessionId, hex },
  });
}

export async function setActiveAlpha(sessionId: string, alpha: number): Promise<EditorStatus> {
  return invoke("canvas_editor_set_active_alpha", {
    args: { sessionId, alpha: Math.max(0, Math.min(255, Math.round(alpha))) },
  });
}

export async function setView(sessionId: string, zoom: number, pan: Point): Promise<EditorStatus> {
  return invoke("canvas_editor_set_view", {
    args: {
      sessionId,
      zoom,
      pan: { x: Math.round(pan.x), y: Math.round(pan.y) },
    },
  });
}

export async function undo(sessionId: string): Promise<EditorEventResult> {
  return invoke("canvas_editor_undo", { args: { sessionId } });
}

export async function redo(sessionId: string): Promise<EditorEventResult> {
  return invoke("canvas_editor_redo", { args: { sessionId } });
}

export function applyPatch(bitmap: Uint8ClampedArray, patch: EditorEventResult["patch"]): void {
  if (!patch) return;
  for (let n = 0; n < patch.changedIndices.length; n += 1) {
    const base = patch.changedIndices[n] * 4;
    const j = n * 4;
    bitmap[base] = patch.after[j];
    bitmap[base + 1] = patch.after[j + 1];
    bitmap[base + 2] = patch.after[j + 2];
    bitmap[base + 3] = patch.after[j + 3];
  }
}

export function decodeRgbaBase64(base64: string): Uint8ClampedArray {
  const binary = atob(base64);
  const out = new Uint8ClampedArray(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}
