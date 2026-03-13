import { invoke } from "@tauri-apps/api/core";
import type { EditorEventResult, EditorStatus, LayerComposites, MovePreviewData, Point, SelectionMode, SnapshotResult, ToolKind } from "./types";

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

export async function createLayerAboveActive(sessionId: string): Promise<EditorStatus> {
  return invoke("canvas_editor_create_layer_above_active", { args: { sessionId } });
}

export async function deleteLayer(sessionId: string, layerId: number): Promise<EditorStatus> {
  return invoke("canvas_editor_delete_layer", { args: { sessionId, layerId } });
}

export async function setActiveLayer(sessionId: string, layerId: number): Promise<EditorStatus> {
  return invoke("canvas_editor_set_active_layer", { args: { sessionId, layerId } });
}

export async function renameLayer(sessionId: string, layerId: number, name: string): Promise<EditorStatus> {
  return invoke("canvas_editor_rename_layer", { args: { sessionId, layerId, name } });
}

export async function setLayerOpacity(sessionId: string, layerId: number, opacity: number): Promise<EditorStatus> {
  return invoke("canvas_editor_set_layer_opacity", {
    args: { sessionId, layerId, opacity: Math.max(0, Math.min(255, Math.round(opacity))) },
  });
}

export async function toggleLayerVisibility(sessionId: string, layerId: number): Promise<EditorStatus> {
  return invoke("canvas_editor_toggle_layer_visibility", { args: { sessionId, layerId } });
}

export async function reorderLayers(sessionId: string, ids: number[]): Promise<EditorStatus> {
  return invoke("canvas_editor_reorder_layers", { args: { sessionId, ids } });
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

export async function getLayerComposites(sessionId: string): Promise<LayerComposites> {
  return invoke("canvas_editor_get_layer_composites", { args: { sessionId } });
}

/**
 * Correctly applies a draw/erase patch to the composite bitmap by re-compositing
 * the changed pixels using pre-computed underlay and overlay layers.
 * Required when drawing on a non-topmost layer, because the patch contains raw
 * active-layer pixels which must be composited below the overlay.
 */
export function applyPatchWithComposites(
  bitmap: Uint8ClampedArray,
  patch: EditorEventResult["patch"],
  underlay: Uint8ClampedArray,
  overlay: Uint8ClampedArray
): void {
  if (!patch) return;
  for (let n = 0; n < patch.changedIndices.length; n += 1) {
    const base = patch.changedIndices[n] * 4;
    const j = n * 4;
    // layer_new over underlay
    const [r1, g1, b1, a1] = alphaBlend(
      patch.after[j], patch.after[j + 1], patch.after[j + 2], patch.after[j + 3],
      underlay[base], underlay[base + 1], underlay[base + 2], underlay[base + 3]
    );
    // overlay over (layer_new over underlay)
    const [r2, g2, b2, a2] = alphaBlend(
      overlay[base], overlay[base + 1], overlay[base + 2], overlay[base + 3],
      r1, g1, b1, a1
    );
    bitmap[base] = r2;
    bitmap[base + 1] = g2;
    bitmap[base + 2] = b2;
    bitmap[base + 3] = a2;
  }
}

function alphaBlend(
  sr: number, sg: number, sb: number, sa: number,
  dr: number, dg: number, db: number, da: number
): [number, number, number, number] {
  const s = sa / 255;
  const d = da / 255;
  const outA = s + d * (1 - s);
  if (outA <= 0) return [0, 0, 0, 0];
  return [
    Math.round(((sr / 255) * s + (dr / 255) * d * (1 - s)) / outA * 255),
    Math.round(((sg / 255) * s + (dg / 255) * d * (1 - s)) / outA * 255),
    Math.round(((sb / 255) * s + (db / 255) * d * (1 - s)) / outA * 255),
    Math.round(outA * 255),
  ];
}
