import type { IDockviewPanelProps } from "dockview";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { CanvasRenderer, screenToPixel } from "../features/canvas-editor/render";
import {
  applyPatch,
  createSession,
  decodeRgbaBase64,
  dispatchPointer,
  dispatchShortcut,
  getMovePreviewData,
  getSnapshot,
  redo,
  setActiveAlpha,
  setActiveColor,
  setSelectionMode,
  setTool,
  setView,
  undo,
} from "../features/canvas-editor/backend";
import type { EditorStatus, Point, SelectionMode, ToolKind } from "../features/canvas-editor/types";
import type { Rect } from "../features/canvas-editor/types";

const CANVAS_SIZE = 1024;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 64;
const ZOOM_SCRUB_SENSITIVITY = 0.005;

type MovePreviewState = {
  bounds: Rect;
  delta: Point;
  mask: Uint8Array;
  maskVersion: number;
  pixels: Uint8ClampedArray;
  pixelsVersion: number;
};

const TOOL_BUTTONS: { tool: ToolKind; label: string; hotkey: string }[] = [
  { tool: "draw", label: "DRAW", hotkey: "D" },
  { tool: "fill", label: "FILL", hotkey: "F" },
  { tool: "erase", label: "ERASE", hotkey: "E" },
  { tool: "select", label: "SELECT", hotkey: "S" },
  { tool: "move", label: "MOVE", hotkey: "M" },
  { tool: "pick", label: "PICK", hotkey: "P" },
];

function fallbackStatus(): EditorStatus {
  return {
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
    tool: "draw",
    activeColor: "#ffffff",
    activeAlpha: 255,
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

export function CanvasPanel(_props: IDockviewPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const queueRef = useRef(Promise.resolve());
  const sessionIdRef = useRef(`canvas-main-${Date.now()}-${Math.floor(Math.random() * 100000)}`);
  const [status, setStatus] = useState<EditorStatus>(fallbackStatus());
  const [bitmap, setBitmap] = useState<Uint8ClampedArray | null>(null);
  const [bitmapVersion, setBitmapVersion] = useState(0);
  const [movePreview, setMovePreview] = useState<MovePreviewState | null>(null);
  const [hoverPixel, setHoverPixel] = useState<Point | null>(null);
  const [revision, setRevision] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
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

  if (rendererRef.current == null) {
    rendererRef.current = new CanvasRenderer(CANVAS_SIZE, CANVAS_SIZE);
  }

  const buildMovePreview = useCallback(
    (baseBitmap: Uint8ClampedArray, bounds: Rect, selectedIndices: number[]): MovePreviewState => {
      const width = Math.max(1, bounds.width);
      const height = Math.max(1, bounds.height);
      const mask = new Uint8Array(CANVAS_SIZE * CANVAS_SIZE);
      const pixels = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < selectedIndices.length; i += 1) {
        const idx = selectedIndices[i];
        if (idx < 0 || idx >= CANVAS_SIZE * CANVAS_SIZE) continue;
        mask[idx] = 255;
        const x = idx % CANVAS_SIZE;
        const y = Math.floor(idx / CANVAS_SIZE);
        const lx = x - bounds.x;
        const ly = y - bounds.y;
        if (lx < 0 || ly < 0 || lx >= width || ly >= height) continue;
        const src = idx * 4;
        const dst = (ly * width + lx) * 4;
        pixels[dst] = baseBitmap[src];
        pixels[dst + 1] = baseBitmap[src + 1];
        pixels[dst + 2] = baseBitmap[src + 2];
        pixels[dst + 3] = baseBitmap[src + 3];
      }
      return {
        bounds,
        delta: { x: 0, y: 0 },
        mask,
        maskVersion: Date.now(),
        pixels,
        pixelsVersion: Date.now() + 1,
      };
    },
    []
  );

  const enqueue = useCallback((task: () => Promise<void>) => {
    queueRef.current = queueRef.current.then(task).catch((err) => {
      console.warn("[canvas] backend call failed", err);
      setLoadError(err instanceof Error ? err.message : String(err));
    });
  }, []);

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
  }, [enqueue]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer || !bitmap) return;
    renderer.render(canvas, {
      bitmap,
      bitmapVersion,
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
  }, [bitmap, bitmapVersion, status, hoverPixel, movePreview, revision]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => setRevision((v) => v + 1));
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (moveRafRef.current != null) {
        cancelAnimationFrame(moveRafRef.current);
      }
      if (viewRafRef.current != null) {
        cancelAnimationFrame(viewRafRef.current);
      }
    };
  }, []);

  const focusPanel = () => rootRef.current?.focus();
  const isZoomToolActive = zoomToolLatched || zoomToolHeld;

  const toPixel = (event: ReactPointerEvent<HTMLCanvasElement>) => {
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
  };

  const syncView = (zoom: number, pan: Point) => {
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
  };

  const changeZoom = (next: number) => {
    syncView(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next)), status.pan);
  };

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

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
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
        const preview = buildMovePreview(bitmap, previewData.bounds, previewData.selectedIndices);
        preview.delta = result.status.selection.moveDelta;
        setMovePreview(preview);
      } else {
        setMovePreview(null);
      }
      setRevision((v) => v + 1);
    });
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
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
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
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
  };

  const handlePointerLeave = () => {
    setHoverPixel(null);
    if (!status.selection.moving) {
      pointerDragActiveRef.current = false;
    }
  };

  const canvasCursor = useMemo(() => {
    if (zoomDragRef.current) {
      return "ew-resize";
    }
    if (isZoomToolActive) {
      return "zoom-in";
    }
    const inBounds =
      hoverPixel != null &&
      hoverPixel.x >= 0 &&
      hoverPixel.y >= 0 &&
      hoverPixel.x < CANVAS_SIZE &&
      hoverPixel.y < CANVAS_SIZE;
    if (inBounds) {
      return "none";
    }
    if (status.tool === "move") {
      return status.selection.moving ? "grabbing" : "grab";
    }
    return "crosshair";
  }, [hoverPixel, status.tool, status.selection.moving, isZoomToolActive]);

  const handleWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
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
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
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
  };

  const handleKeyUp = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const keyLower = event.key.toLowerCase();
    if (keyLower === "z") {
      setZoomToolHeld(false);
    }
  };

  const selectTool = (tool: ToolKind) => {
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
  };

  const selectSelectionMode = (mode: SelectionMode) => {
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
  };

  const onColorChange = (hex: string) => {
    enqueue(async () => {
      const next = await setActiveColor(sessionIdRef.current, hex);
      setStatus(next);
      setRevision((v) => v + 1);
    });
  };

  const onAlphaChange = (alpha: number) => {
    enqueue(async () => {
      const next = await setActiveAlpha(sessionIdRef.current, alpha);
      setStatus(next);
      setRevision((v) => v + 1);
    });
  };

  const onUndo = () => {
    if (!bitmap) return;
    enqueue(async () => {
      const result = await undo(sessionIdRef.current);
      applyPatch(bitmap, result.patch);
      if (result.patch) {
        setBitmapVersion((v) => v + 1);
      }
      setMovePreview(null);
      setStatus(result.status);
      setRevision((v) => v + 1);
    });
  };

  const onRedo = () => {
    if (!bitmap) return;
    enqueue(async () => {
      const result = await redo(sessionIdRef.current);
      applyPatch(bitmap, result.patch);
      if (result.patch) {
        setBitmapVersion((v) => v + 1);
      }
      setMovePreview(null);
      setStatus(result.status);
      setRevision((v) => v + 1);
    });
  };

  const statusLine = useMemo(() => {
    if (loadError) return `Error: ${loadError}`;
    if (isZoomToolActive) return `ZOOM TOOL (${zoomToolHeld ? "hold" : "latched"})`;
    return status.message ?? "Ready";
  }, [status.message, loadError, isZoomToolActive, zoomToolHeld]);

  return (
    <div
      ref={rootRef}
      className={`canvas-panel ${isFocused ? "focused" : ""}`}
      tabIndex={0}
      onFocus={() => setIsFocused(true)}
      onBlur={() => {
        setIsFocused(false);
        setZoomToolHeld(false);
      }}
      onMouseDown={focusPanel}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
    >
      <div className="canvas-toolbar">
        {TOOL_BUTTONS.map((item) => (
          <button
            key={item.tool}
            type="button"
            className={status.tool === item.tool ? "active" : ""}
            title={`${item.label} (${item.hotkey})`}
            onClick={() => selectTool(item.tool)}
          >
            {item.label}
          </button>
        ))}
        <label className="color-input">
          COLOR
          <input type="color" value={status.activeColor} onChange={(e) => onColorChange(e.target.value)} />
        </label>
        <label className="alpha-input">
          ALPHA {status.activeAlpha}
          <input
            type="range"
            min={0}
            max={255}
            step={1}
            value={status.activeAlpha}
            onChange={(e) => onAlphaChange(Number(e.target.value))}
          />
        </label>
        <button type="button" disabled={!status.canUndo} onClick={onUndo}>
          Undo
        </button>
        <button type="button" disabled={!status.canRedo} onClick={onRedo}>
          Redo
        </button>
        <button
          type="button"
          className={zoomToolLatched ? "active" : ""}
          title="Zoom Tool (Z hold)"
          onClick={() => setZoomToolLatched((v) => !v)}
        >
          ZOOM
        </button>
        <button type="button" title="Zoom Reset" onClick={() => changeZoom(1)}>
          100%
        </button>
        <div className="select-mode-switch">
          <button
            type="button"
            className={status.selection.mode === "rect" ? "active" : ""}
            onClick={() => selectSelectionMode("rect")}
            title="Rect Selection"
          >
            RECT
          </button>
          <button
            type="button"
            className={status.selection.mode === "lasso" ? "active" : ""}
            onClick={() => selectSelectionMode("lasso")}
            title="Lasso Selection"
          >
            LASSO
          </button>
        </div>
      </div>
      <div className="canvas-stage">
        <canvas
          ref={canvasRef}
          className="canvas-surface"
          style={{ cursor: canvasCursor }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerLeave}
          onWheel={handleWheel}
        />
      </div>
      <div className="canvas-status">
        <span>{`Tool: ${(isZoomToolActive ? "zoom" : status.tool).toUpperCase()}`}</span>
        <span>{`Zoom: ${status.zoom.toFixed(2)}x`}</span>
        <span>
          {status.selection.rect
            ? `Selection: ${status.selection.rect.width}x${status.selection.rect.height}`
            : "Selection: none"}
        </span>
        <span>{statusLine}</span>
        <span className="hint">TAB/p/d/f/e/s/m/l, Z hold+drag, Ctrl+Wheel=H-Scroll, Ctrl+Z/Y</span>
      </div>
    </div>
  );
}
