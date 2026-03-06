import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { applyPatch, decodeRgbaBase64, dispatchPointer, dispatchShortcut, getMovePreviewData, getSnapshot, setSelectionMode, setTool, setView } from "../backend";
import { screenToPixel } from "../render";
import { buildMovePreview, type MovePreviewState } from "../panel/movePreview";
import { CANVAS_SIZE } from "../panel/status";
import type { EditorStatus, Point, SelectionMode, ToolKind } from "../types";

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 64;
const ZOOM_SCRUB_SENSITIVITY = 0.005;

type Params = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  sessionIdRef: { current: string };
  enqueue: (task: () => Promise<void>) => void;
  status: EditorStatus;
  bitmap: Uint8ClampedArray | null;
  movePreview: MovePreviewState | null;
  setStatus: Dispatch<SetStateAction<EditorStatus>>;
  setBitmap: Dispatch<SetStateAction<Uint8ClampedArray | null>>;
  setBitmapVersion: Dispatch<SetStateAction<number>>;
  setMovePreview: Dispatch<SetStateAction<MovePreviewState | null>>;
  setHoverPixel: Dispatch<SetStateAction<Point | null>>;
  setRevision: Dispatch<SetStateAction<number>>;
  focusPanel: () => void;
};

export function useCanvasInputController(params: Params) {
  const {
    canvasRef,
    sessionIdRef,
    enqueue,
    status,
    bitmap,
    movePreview,
    setStatus,
    setBitmap,
    setBitmapVersion,
    setMovePreview,
    setHoverPixel,
    setRevision,
    focusPanel,
  } = params;

  const [zoomToolLatched, setZoomToolLatched] = useState(false);
  const [zoomToolHeld, setZoomToolHeld] = useState(false);

  const panDragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const zoomDragRef = useRef<{
    startClientX: number;
    startZoom: number;
    anchorPixel: Point;
    anchorScreenX: number;
    anchorScreenY: number;
    viewportWidth: number;
    viewportHeight: number;
  } | null>(null);
  const pointerDragActiveRef = useRef(false);
  const pendingMoveRef = useRef<{ x: number; y: number; button?: number } | null>(null);
  const moveRafRef = useRef<number | null>(null);
  const pendingViewRef = useRef<{ zoom: number; pan: Point } | null>(null);
  const viewRafRef = useRef<number | null>(null);

  const isZoomToolActive = zoomToolLatched || zoomToolHeld;

  const toPixel = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return screenToPixel(event.clientX - rect.left, event.clientY - rect.top, {
        viewportWidth: rect.width,
        viewportHeight: rect.height,
        imageWidth: CANVAS_SIZE,
        imageHeight: CANVAS_SIZE,
        zoom: status.zoom,
        panX: status.pan.x,
        panY: status.pan.y,
      });
    },
    [canvasRef, status.pan.x, status.pan.y, status.zoom]
  );

  const syncView = useCallback(
    (zoom: number, pan: Point) => {
      pendingViewRef.current = { zoom, pan };
      if (viewRafRef.current != null) return;
      viewRafRef.current = requestAnimationFrame(() => {
        viewRafRef.current = null;
        const payload = pendingViewRef.current;
        pendingViewRef.current = null;
        if (!payload) return;
        enqueue(async () => {
          const next = await setView(sessionIdRef.current, payload.zoom, payload.pan);
          setStatus(next);
          setRevision((v) => v + 1);
        });
      });
    },
    [enqueue, sessionIdRef, setRevision, setStatus]
  );

  const changeZoom = useCallback(
    (next: number) => {
      syncView(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next)), status.pan);
    },
    [status.pan, syncView]
  );

  const computePanForAnchor = useCallback(
    (
      zoom: number,
      anchorPixel: Point,
      anchorScreenX: number,
      anchorScreenY: number,
      viewportWidth: number,
      viewportHeight: number
    ): Point => {
      const panX = anchorScreenX - anchorPixel.x * zoom - (viewportWidth - CANVAS_SIZE * zoom) / 2;
      const panY = anchorScreenY - anchorPixel.y * zoom - (viewportHeight - CANVAS_SIZE * zoom) / 2;
      return { x: Math.round(panX), y: Math.round(panY) };
    },
    []
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      focusPanel();
      pointerDragActiveRef.current = true;
      if (isZoomToolActive) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const point = screenToPixel(event.clientX - rect.left, event.clientY - rect.top, {
          viewportWidth: rect.width,
          viewportHeight: rect.height,
          imageWidth: CANVAS_SIZE,
          imageHeight: CANVAS_SIZE,
          zoom: status.zoom,
          panX: status.pan.x,
          panY: status.pan.y,
        });
        zoomDragRef.current = {
          startClientX: event.clientX,
          startZoom: status.zoom,
          anchorPixel: point,
          anchorScreenX: event.clientX - rect.left,
          anchorScreenY: event.clientY - rect.top,
          viewportWidth: rect.width,
          viewportHeight: rect.height,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
      if (event.button === 1) {
        panDragStartRef.current = {
          x: event.clientX,
          y: event.clientY,
          panX: status.pan.x,
          panY: status.pan.y,
        };
        return;
      }
      const point = toPixel(event);
      if (!bitmap) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      enqueue(async () => {
        const result = await dispatchPointer(sessionIdRef.current, {
          kind: "down",
          x: point.x,
          y: point.y,
          button: event.button,
        });
        applyPatch(bitmap, result.patch);
        if (result.patch) {
          setBitmapVersion((v) => v + 1);
        }
        setStatus(result.status);
        if (result.status.tool === "move" && result.status.selection.moving) {
          const previewData = await getMovePreviewData(sessionIdRef.current);
          const preview = buildMovePreview(
            CANVAS_SIZE,
            previewData.bounds,
            previewData.selectedIndices,
            decodeRgbaBase64(previewData.selectedBlockRgbaBase64),
            decodeRgbaBase64(previewData.underlayRgbaBase64),
            decodeRgbaBase64(previewData.overlayRgbaBase64)
          );
          preview.delta = result.status.selection.moveDelta;
          setMovePreview(preview);
        } else {
          setMovePreview(null);
        }
        setRevision((v) => v + 1);
      });
    },
    [
      focusPanel,
      isZoomToolActive,
      canvasRef,
      status.zoom,
      status.pan.x,
      status.pan.y,
      toPixel,
      bitmap,
      enqueue,
      sessionIdRef,
      setStatus,
      setBitmapVersion,
      setMovePreview,
      setRevision,
    ]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!bitmap) return;
      if (isZoomToolActive && zoomDragRef.current) {
        const d = zoomDragRef.current;
        const dx = event.clientX - d.startClientX;
        const nextZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, d.startZoom * Math.exp(dx * ZOOM_SCRUB_SENSITIVITY)));
        const nextPan = computePanForAnchor(
          nextZoom,
          d.anchorPixel,
          d.anchorScreenX,
          d.anchorScreenY,
          d.viewportWidth,
          d.viewportHeight
        );
        syncView(nextZoom, nextPan);
        return;
      }
      const panStart = panDragStartRef.current;
      const point = toPixel(event);
      setHoverPixel((prev) => (prev?.x === point.x && prev?.y === point.y ? prev : point));
      if (panStart) {
        syncView(status.zoom, {
          x: panStart.panX + (event.clientX - panStart.x),
          y: panStart.panY + (event.clientY - panStart.y),
        });
        return;
      }
      if (!pointerDragActiveRef.current) {
        return;
      }
      pendingMoveRef.current = {
        x: point.x,
        y: point.y,
        button: event.button,
      };
      if (moveRafRef.current != null) return;
      moveRafRef.current = requestAnimationFrame(() => {
        moveRafRef.current = null;
        const payload = pendingMoveRef.current;
        pendingMoveRef.current = null;
        if (!payload || !bitmap) return;
        enqueue(async () => {
          const result = await dispatchPointer(sessionIdRef.current, {
            kind: "move",
            x: payload.x,
            y: payload.y,
            button: payload.button,
          });
          applyPatch(bitmap, result.patch);
          if (result.patch) {
            setBitmapVersion((v) => v + 1);
          }
          setStatus(result.status);
          setMovePreview((prev) => {
            if (!prev) return prev;
            if (!result.status.selection.moving) return null;
            return {
              ...prev,
              delta: result.status.selection.moveDelta,
            };
          });
          setRevision((v) => v + 1);
        });
      });
    },
    [
      bitmap,
      isZoomToolActive,
      computePanForAnchor,
      syncView,
      toPixel,
      setHoverPixel,
      status.zoom,
      enqueue,
      sessionIdRef,
      setBitmapVersion,
      setStatus,
      setMovePreview,
      setRevision,
    ]
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      pointerDragActiveRef.current = false;
      if (zoomDragRef.current) {
        zoomDragRef.current = null;
        return;
      }
      if (event.button === 1) {
        panDragStartRef.current = null;
        return;
      }
      if (!bitmap) return;
      pendingMoveRef.current = null;
      if (moveRafRef.current != null) {
        cancelAnimationFrame(moveRafRef.current);
        moveRafRef.current = null;
      }
      const point = toPixel(event);
      setHoverPixel(point);
      enqueue(async () => {
        const result = await dispatchPointer(sessionIdRef.current, {
          kind: "up",
          x: point.x,
          y: point.y,
          button: event.button,
        });
        applyPatch(bitmap, result.patch);
        if (result.patch) {
          setBitmapVersion((v) => v + 1);
        }
        setStatus(result.status);
        setMovePreview((prev) => {
          if (!prev) return null;
          if (result.status.tool !== "move") return null;
          if (!result.status.selection.rect && !result.status.selection.draftRect) return null;
          return {
            ...prev,
            delta: result.status.selection.moveDelta,
          };
        });
        setRevision((v) => v + 1);
      });
    },
    [bitmap, enqueue, sessionIdRef, setBitmapVersion, setHoverPixel, setMovePreview, setRevision, setStatus, toPixel]
  );

  const handlePointerLeave = useCallback(() => {
    setHoverPixel(null);
    if (!status.selection.moving) {
      pointerDragActiveRef.current = false;
    }
  }, [setHoverPixel, status.selection.moving]);

  const canvasCursor = useMemo(() => {
    if (zoomDragRef.current) {
      return "ew-resize";
    }
    if (isZoomToolActive) {
      return "zoom-in";
    }
    return status.tool === "move" ? (status.selection.moving ? "grabbing" : "grab") : "crosshair";
  }, [isZoomToolActive, status.selection.moving, status.tool]);

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLCanvasElement>) => {
      event.preventDefault();
      if (event.ctrlKey) {
        syncView(status.zoom, {
          x: status.pan.x - event.deltaY,
          y: status.pan.y,
        });
        return;
      }
      syncView(status.zoom, {
        x: status.pan.x - event.deltaX,
        y: status.pan.y - event.deltaY,
      });
    },
    [status.zoom, status.pan, syncView]
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const key = event.key;
      const keyLower = key.toLowerCase();
      if (!event.ctrlKey && !event.shiftKey && !event.altKey && keyLower === "z") {
        event.preventDefault();
        if (!zoomToolHeld) {
          setZoomToolHeld(true);
        }
        return;
      }
      const isShortcutKey =
        key === "Enter" ||
        key === "Tab" ||
        key === "<" ||
        key === ">" ||
        key.toLowerCase() === "p" ||
        key.toLowerCase() === "d" ||
        key.toLowerCase() === "f" ||
        key.toLowerCase() === "e" ||
        key.toLowerCase() === "s" ||
        key.toLowerCase() === "m" ||
        (event.ctrlKey && (key.toLowerCase() === "z" || key.toLowerCase() === "y"));
      if (isShortcutKey) {
        event.preventDefault();
        event.stopPropagation();
      }
      const ctrl = event.ctrlKey;
      const shift = event.shiftKey;
      const alt = event.altKey;
      const hadMovePreview = movePreview != null;
      enqueue(async () => {
        const result = await dispatchShortcut(sessionIdRef.current, {
          key,
          ctrl,
          shift,
          alt,
        });
        if (bitmap) {
          applyPatch(bitmap, result.patch);
          if (result.patch) {
            setBitmapVersion((v) => v + 1);
          }
        }
        setStatus(result.status);
        if (hadMovePreview && result.status.tool !== "move") {
          const snapshot = await getSnapshot(sessionIdRef.current);
          setBitmap(decodeRgbaBase64(snapshot.rgbaBase64));
          setBitmapVersion((v) => v + 1);
          setMovePreview(null);
        } else if (!result.status.selection.moving && result.status.tool !== "move") {
          setMovePreview(null);
        }
        setRevision((v) => v + 1);
      });
    },
    [zoomToolHeld, movePreview, enqueue, sessionIdRef, bitmap, setBitmapVersion, setStatus, setBitmap, setMovePreview, setRevision]
  );

  const handleKeyUp = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const keyLower = event.key.toLowerCase();
    if (keyLower === "z") {
      setZoomToolHeld(false);
    }
  }, []);

  const selectTool = useCallback(
    (tool: ToolKind) => {
      enqueue(async () => {
        const hadMovePreview = movePreview != null;
        const next = await setTool(sessionIdRef.current, tool);
        if (hadMovePreview) {
          const snapshot = await getSnapshot(sessionIdRef.current);
          setBitmap(decodeRgbaBase64(snapshot.rgbaBase64));
          setBitmapVersion((v) => v + 1);
          setMovePreview(null);
        }
        setStatus(next);
        setRevision((v) => v + 1);
      });
    },
    [enqueue, movePreview, sessionIdRef, setBitmap, setBitmapVersion, setMovePreview, setStatus, setRevision]
  );

  const selectSelectionMode = useCallback(
    (mode: SelectionMode) => {
      enqueue(async () => {
        const hadMovePreview = movePreview != null;
        const next = await setSelectionMode(sessionIdRef.current, mode);
        if (hadMovePreview) {
          const snapshot = await getSnapshot(sessionIdRef.current);
          setBitmap(decodeRgbaBase64(snapshot.rgbaBase64));
          setBitmapVersion((v) => v + 1);
          setMovePreview(null);
        }
        setStatus(next);
        setRevision((v) => v + 1);
      });
    },
    [enqueue, movePreview, sessionIdRef, setBitmap, setBitmapVersion, setMovePreview, setStatus, setRevision]
  );

  useEffect(
    () => () => {
      if (moveRafRef.current != null) {
        cancelAnimationFrame(moveRafRef.current);
      }
      if (viewRafRef.current != null) {
        cancelAnimationFrame(viewRafRef.current);
      }
    },
    []
  );

  return {
    zoomToolLatched,
    setZoomToolLatched,
    zoomToolHeld,
    setZoomToolHeld,
    isZoomToolActive,
    canvasCursor,
    changeZoom,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerLeave,
    handleWheel,
    handleKeyDown,
    handleKeyUp,
    selectTool,
    selectSelectionMode,
  };
}
