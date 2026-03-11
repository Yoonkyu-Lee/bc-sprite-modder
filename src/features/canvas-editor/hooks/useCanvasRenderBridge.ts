import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import { createSession, decodeRgbaBase64, getSnapshot } from "../backend";
import { CANVAS_SIZE } from "../panel/status";
import type { MovePreviewState } from "../panel/movePreview";
import type { CanvasRenderer } from "../render";
import type { EditorStatus, Point } from "../types";

type Params = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  rendererRef: RefObject<CanvasRenderer | null>;
  sessionIdRef: { current: string };
  enqueue: (task: () => Promise<void>) => void;
  setLoadError: Dispatch<SetStateAction<string | null>>;
  status: EditorStatus;
  bitmap: Uint8ClampedArray | null;
  bitmapVersion: number;
  movePreview: MovePreviewState | null;
  hoverPixel: Point | null;
  revision: number;
  setStatus: Dispatch<SetStateAction<EditorStatus>>;
  setBitmap: Dispatch<SetStateAction<Uint8ClampedArray | null>>;
  setBitmapVersion: Dispatch<SetStateAction<number>>;
  setMovePreview: Dispatch<SetStateAction<MovePreviewState | null>>;
  setRevision: Dispatch<SetStateAction<number>>;
};

export function useCanvasRenderBridge(params: Params) {
  const {
    canvasRef,
    rendererRef,
    sessionIdRef,
    enqueue,
    setLoadError,
    status,
    bitmap,
    bitmapVersion,
    movePreview,
    hoverPixel,
    revision,
    setStatus,
    setBitmap,
    setBitmapVersion,
    setMovePreview,
    setRevision,
  } = params;

  useEffect(() => {
    let cancelled = false;
    enqueue(async () => {
      const sessionId = sessionIdRef.current;
      const created = await createSession(sessionId, CANVAS_SIZE, CANVAS_SIZE);
      const snapshot = await getSnapshot(sessionId);
      if (cancelled) return;
      setStatus(created);
      setBitmap(decodeRgbaBase64(snapshot.rgbaBase64));
      setBitmapVersion((v) => v + 1);
      setMovePreview(null);
      setRevision((v) => v + 1);
      setLoadError(null);
    });
    return () => {
      cancelled = true;
    };
  }, [enqueue, sessionIdRef, setStatus, setBitmap, setBitmapVersion, setMovePreview, setRevision, setLoadError]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer || !bitmap) return;
    const renderBitmap = movePreview?.baseBitmap ?? bitmap;
    const renderBitmapVersion = movePreview?.baseBitmapVersion ?? bitmapVersion;
    renderer.render(canvas, {
      bitmap: renderBitmap,
      bitmapVersion: renderBitmapVersion,
      imageWidth: CANVAS_SIZE,
      imageHeight: CANVAS_SIZE,
      tool: status.tool,
      hoverPixel,
      view: {
        viewportWidth: Math.max(1, canvas.clientWidth),
        viewportHeight: Math.max(1, canvas.clientHeight),
        imageWidth: CANVAS_SIZE,
        imageHeight: CANVAS_SIZE,
        zoom: status.zoom,
        panX: status.pan.x,
        panY: status.pan.y,
      },
      selection: status.selection,
      movePreview,
    });
  }, [canvasRef, rendererRef, bitmap, bitmapVersion, status, hoverPixel, movePreview, revision]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => setRevision((v) => v + 1));
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [canvasRef, setRevision]);
}

