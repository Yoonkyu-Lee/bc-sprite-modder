import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import { CanvasEditor } from "../engine";
import { CANVAS_SIZE } from "../panel/status";
import type { MovePreviewState } from "../panel/movePreview";
import type { CanvasRenderer } from "../render";
import type { EditorStatus, Point } from "../types";

type Params = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  rendererRef: RefObject<CanvasRenderer | null>;
  editorRef: RefObject<CanvasEditor | null>;
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
    editorRef,
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

  // Initialize the WASM editor once on mount.
  // CanvasEditor constructor is synchronous because vite-plugin-wasm ensures
  // the WASM binary is ready before any module code executes.
  useEffect(() => {
    let editor: CanvasEditor | null = null;
    try {
      editor = new CanvasEditor(CANVAS_SIZE, CANVAS_SIZE);
      editorRef.current = editor;
      setStatus(editor.get_status() as EditorStatus);
      setBitmap(new Uint8ClampedArray(editor.get_composite_bitmap()));
      setBitmapVersion((v) => v + 1);
      setMovePreview(null);
      setRevision((v) => v + 1);
      setLoadError(null);
    } catch (err) {
      if (editor) { editor.free(); editorRef.current = null; }
      setLoadError(err instanceof Error ? err.message : String(err));
    }
    return () => {
      if (editorRef.current) {
        editorRef.current.free();
        editorRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

