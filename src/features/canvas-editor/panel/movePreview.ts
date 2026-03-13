import type { Point, Rect } from "../types";

export type MovePreviewState = {
  bounds: Rect;
  delta: Point;
  mask: Uint8Array;
  maskVersion: number;
  pixels: Uint8ClampedArray;
  pixelsVersion: number;
  baseBitmap: Uint8ClampedArray;
  baseBitmapVersion: number;
  overlayBitmap: Uint8ClampedArray;
  overlayBitmapVersion: number;
};

export function buildMovePreview(
  canvasSize: number,
  bounds: Rect,
  selectedIndices: number[],
  selectedBlock: Uint8ClampedArray,
  underlay: Uint8ClampedArray,
  overlay: Uint8ClampedArray,
  opacity: number
): MovePreviewState {
  const mask = new Uint8Array(canvasSize * canvasSize);
  for (let i = 0; i < selectedIndices.length; i += 1) {
    const idx = selectedIndices[i];
    if (idx >= 0 && idx < canvasSize * canvasSize) {
      mask[idx] = 255;
    }
  }

  // Apply source layer opacity to floating pixels CPU-side so the WebGL shader
  // does not need a separate uniform for layer opacity.
  let pixels = selectedBlock;
  if (opacity < 255) {
    const factor = opacity / 255;
    pixels = new Uint8ClampedArray(selectedBlock.length);
    for (let i = 0; i < selectedBlock.length; i += 4) {
      pixels[i] = selectedBlock[i];
      pixels[i + 1] = selectedBlock[i + 1];
      pixels[i + 2] = selectedBlock[i + 2];
      pixels[i + 3] = Math.round(selectedBlock[i + 3] * factor);
    }
  }

  const ts = Date.now();
  return {
    bounds,
    delta: { x: 0, y: 0 },
    mask,
    maskVersion: ts,
    pixels,
    pixelsVersion: ts + 1,
    baseBitmap: underlay,
    baseBitmapVersion: ts + 2,
    overlayBitmap: overlay,
    overlayBitmapVersion: ts + 3,
  };
}
