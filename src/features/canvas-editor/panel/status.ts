import type { EditorStatus } from "../types";

export const CANVAS_SIZE = 1024;

export function fallbackStatus(): EditorStatus {
  return {
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
    tool: "draw",
    activeColor: "#ffffff",
    activeAlpha: 255,
    activeLayerId: 1,
    layers: [{ id: 1, name: "Layer 1", visible: true, opacity: 255 }],
    selection: {
      rect: null,
      draftRect: null,
      moving: false,
      moveDelta: { x: 0, y: 0 },
      mode: "rect",
      lassoPoints: [],
      draftLassoPoints: [],
    },
    message: "Initializing...",
    canUndo: false,
    canRedo: false,
    zoom: 1,
    pan: { x: 0, y: 0 },
    isPointerDown: false,
  };
}
