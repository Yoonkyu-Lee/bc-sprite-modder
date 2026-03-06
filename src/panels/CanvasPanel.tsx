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
  createLayerAboveActive,
  createSession,
  decodeRgbaBase64,
  deleteLayer,
  dispatchPointer,
  dispatchShortcut,
  getMovePreviewData,
  getSnapshot,
  renameLayer,
  reorderLayers,
  redo,
  setActiveAlpha,
  setActiveColor,
  setActiveLayer,
  setLayerOpacity,
  setSelectionMode,
  setTool,
  toggleLayerVisibility,
  setView,
  undo,
} from "../features/canvas-editor/backend";
import type { EditorStatus, LayerStatus, Point, SelectionMode, ToolKind } from "../features/canvas-editor/types";
import type { Rect } from "../features/canvas-editor/types";

const CANVAS_SIZE = 1024;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 64;
const ZOOM_SCRUB_SENSITIVITY = 0.005;

type PaletteState = {
  h: number;
  s: number;
  v: number;
  a: number;
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = hex.trim().replace(/^#/, "");
  if (n.length !== 6) return { r: 255, g: 255, b: 255 };
  const v = Number.parseInt(n, 16);
  if (Number.isNaN(v)) return { r: 255, g: 255, b: 255 };
  return {
    r: (v >> 16) & 0xff,
    g: (v >> 8) & 0xff,
    b: v & 0xff,
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const rr = clamp(Math.round(r), 0, 255);
  const gg = clamp(Math.round(g), 0, 255);
  const bb = clamp(Math.round(b), 0, 255);
  return `#${rr.toString(16).padStart(2, "0")}${gg.toString(16).padStart(2, "0")}${bb.toString(16).padStart(2, "0")}`;
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const hh = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = v - c;
  let rn = 0;
  let gn = 0;
  let bn = 0;
  if (hh < 60) [rn, gn, bn] = [c, x, 0];
  else if (hh < 120) [rn, gn, bn] = [x, c, 0];
  else if (hh < 180) [rn, gn, bn] = [0, c, x];
  else if (hh < 240) [rn, gn, bn] = [0, x, c];
  else if (hh < 300) [rn, gn, bn] = [x, 0, c];
  else [rn, gn, bn] = [c, 0, x];
  return {
    r: Math.round((rn + m) * 255),
    g: Math.round((gn + m) * 255),
    b: Math.round((bn + m) * 255),
  };
}

type MovePreviewState = {
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [palette, setPalette] = useState<PaletteState>({ h: 0, s: 0, v: 1, a: 255 });
  const [dragLayerId, setDragLayerId] = useState<number | null>(null);
  const [layerNameDrafts, setLayerNameDrafts] = useState<Record<number, string>>({});
  const [zoomToolLatched, setZoomToolLatched] = useState(false);
  const [zoomToolHeld, setZoomToolHeld] = useState(false);
  const paletteDragModeRef = useRef<"sv" | "h" | "a" | null>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const alphaRef = useRef<HTMLDivElement>(null);
  const palettePendingRef = useRef<{ hex: string; alpha: number } | null>(null);
  const paletteRafRef = useRef<number | null>(null);
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
    (
      bounds: Rect,
      selectedIndices: number[],
      selectedBlock: Uint8ClampedArray,
      underlay: Uint8ClampedArray,
      overlay: Uint8ClampedArray
    ): MovePreviewState => {
      const mask = new Uint8Array(CANVAS_SIZE * CANVAS_SIZE);
      for (let i = 0; i < selectedIndices.length; i += 1) {
        const idx = selectedIndices[i];
        if (idx >= 0 && idx < CANVAS_SIZE * CANVAS_SIZE) {
          mask[idx] = 255;
        }
      }
      const pixels = selectedBlock;
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
    },
    []
  );

  const enqueue = useCallback((task: () => Promise<void>) => {
    queueRef.current = queueRef.current.then(task).catch((err) => {
      console.warn("[canvas] backend call failed", err);
      setLoadError(err instanceof Error ? err.message : String(err));
    });
  }, []);

  const pushPaletteToBackend = useCallback(
    (hex: string, alpha: number) => {
      palettePendingRef.current = { hex, alpha: clamp(Math.round(alpha), 0, 255) };
      if (paletteRafRef.current != null) return;
      paletteRafRef.current = requestAnimationFrame(() => {
        paletteRafRef.current = null;
        const payload = palettePendingRef.current;
        palettePendingRef.current = null;
        if (!payload) return;
        enqueue(async () => {
          const colorStatus = await setActiveColor(sessionIdRef.current, payload.hex);
          const alphaStatus = await setActiveAlpha(sessionIdRef.current, payload.alpha);
          setStatus(alphaStatus ?? colorStatus);
          setRevision((v) => v + 1);
        });
      });
    },
    [enqueue]
  );

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
      if (paletteRafRef.current != null) {
        cancelAnimationFrame(paletteRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (paletteDragModeRef.current) return;
    const { r, g, b } = hexToRgb(status.activeColor);
    const hsv = rgbToHsv(r, g, b);
    setPalette({ h: hsv.h, s: hsv.s, v: hsv.v, a: status.activeAlpha });
  }, [status.activeColor, status.activeAlpha]);

  useEffect(() => {
    setLayerNameDrafts((prev) => {
      const next: Record<number, string> = {};
      for (const layer of status.layers) {
        next[layer.id] = prev[layer.id] ?? layer.name;
      }
      return next;
    });
  }, [status.layers]);

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
        const preview = buildMovePreview(
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

  const applyPalette = useCallback(
    (next: PaletteState) => {
      const safe: PaletteState = {
        h: clamp(next.h, 0, 360),
        s: clamp(next.s, 0, 1),
        v: clamp(next.v, 0, 1),
        a: clamp(Math.round(next.a), 0, 255),
      };
      setPalette(safe);
      const rgb = hsvToRgb(safe.h, safe.s, safe.v);
      const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
      pushPaletteToBackend(hex, safe.a);
    },
    [pushPaletteToBackend]
  );

  const updateSvFromClient = useCallback(
    (clientX: number, clientY: number) => {
      const el = svRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const s = clamp((clientX - r.left) / r.width, 0, 1);
      const v = 1 - clamp((clientY - r.top) / r.height, 0, 1);
      applyPalette({ ...palette, s, v });
    },
    [palette, applyPalette]
  );

  const updateHueFromClient = useCallback(
    (clientX: number) => {
      const el = hueRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const t = clamp((clientX - r.left) / r.width, 0, 1);
      applyPalette({ ...palette, h: t * 360 });
    },
    [palette, applyPalette]
  );

  const updateAlphaFromClient = useCallback(
    (clientX: number) => {
      const el = alphaRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const t = clamp((clientX - r.left) / r.width, 0, 1);
      applyPalette({ ...palette, a: Math.round(t * 255) });
    },
    [palette, applyPalette]
  );

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const mode = paletteDragModeRef.current;
      if (!mode) return;
      if (mode === "sv") updateSvFromClient(event.clientX, event.clientY);
      else if (mode === "h") updateHueFromClient(event.clientX);
      else if (mode === "a") updateAlphaFromClient(event.clientX);
    };
    const onUp = () => {
      paletteDragModeRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [updateSvFromClient, updateHueFromClient, updateAlphaFromClient]);

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

  const applyStatusWithSnapshot = useCallback(
    async (next: EditorStatus, refreshBitmap: boolean) => {
      setStatus(next);
      if (refreshBitmap) {
        const snapshot = await getSnapshot(sessionIdRef.current);
        setBitmap(decodeRgbaBase64(snapshot.rgbaBase64));
        setBitmapVersion((v) => v + 1);
      }
      setMovePreview(null);
      setRevision((v) => v + 1);
    },
    []
  );

  const onCreateLayer = () => {
    enqueue(async () => {
      const next = await createLayerAboveActive(sessionIdRef.current);
      await applyStatusWithSnapshot(next, true);
    });
  };

  const onDeleteLayer = (layerId: number) => {
    enqueue(async () => {
      const next = await deleteLayer(sessionIdRef.current, layerId);
      await applyStatusWithSnapshot(next, true);
    });
  };

  const onSelectLayer = (layerId: number) => {
    enqueue(async () => {
      const next = await setActiveLayer(sessionIdRef.current, layerId);
      await applyStatusWithSnapshot(next, false);
    });
  };

  const onToggleLayerVisibility = (layerId: number) => {
    enqueue(async () => {
      const next = await toggleLayerVisibility(sessionIdRef.current, layerId);
      await applyStatusWithSnapshot(next, true);
    });
  };

  const onSetLayerOpacity = (layerId: number, opacity: number) => {
    enqueue(async () => {
      const next = await setLayerOpacity(sessionIdRef.current, layerId, opacity);
      await applyStatusWithSnapshot(next, true);
    });
  };

  const commitLayerName = (layer: LayerStatus) => {
    const draft = (layerNameDrafts[layer.id] ?? layer.name).trim();
    if (!draft || draft === layer.name) {
      setLayerNameDrafts((prev) => ({ ...prev, [layer.id]: layer.name }));
      return;
    }
    enqueue(async () => {
      const next = await renameLayer(sessionIdRef.current, layer.id, draft);
      await applyStatusWithSnapshot(next, false);
    });
  };

  const onDropLayer = (targetLayerId: number) => {
    if (dragLayerId == null || dragLayerId === targetLayerId) return;
    const ids = status.layers.map((l) => l.id);
    const from = ids.indexOf(dragLayerId);
    const to = ids.indexOf(targetLayerId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, dragLayerId);
    setDragLayerId(null);
    enqueue(async () => {
      const next = await reorderLayers(sessionIdRef.current, ids);
      await applyStatusWithSnapshot(next, true);
    });
  };

  const statusLine = useMemo(() => {
    if (loadError) return `Error: ${loadError}`;
    if (isZoomToolActive) return `ZOOM TOOL (${zoomToolHeld ? "hold" : "latched"})`;
    return status.message ?? "Ready";
  }, [status.message, loadError, isZoomToolActive, zoomToolHeld]);

  const paletteRgb = useMemo(() => hsvToRgb(palette.h, palette.s, palette.v), [palette]);
  const paletteHex = useMemo(() => rgbToHex(paletteRgb.r, paletteRgb.g, paletteRgb.b), [paletteRgb]);

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
        <div className="palette-pop">
          <button
            type="button"
            className={paletteOpen ? "active" : ""}
            onClick={() => setPaletteOpen((v) => !v)}
            title="Palette"
          >
            PALETTE
          </button>
          {paletteOpen ? (
            <div className="palette-popover">
              <div
                ref={svRef}
                className="palette-sv"
                style={{ backgroundColor: `hsl(${palette.h} 100% 50%)` }}
                onPointerDown={(e) => {
                  paletteDragModeRef.current = "sv";
                  updateSvFromClient(e.clientX, e.clientY);
                }}
              >
                <div className="palette-sv-white" />
                <div className="palette-sv-black" />
                <div
                  className="palette-cursor"
                  style={{
                    left: `${palette.s * 100}%`,
                    top: `${(1 - palette.v) * 100}%`,
                  }}
                />
              </div>
              <div
                ref={hueRef}
                className="palette-hue"
                onPointerDown={(e) => {
                  paletteDragModeRef.current = "h";
                  updateHueFromClient(e.clientX);
                }}
              >
                <div
                  className="palette-bar-cursor"
                  style={{
                    left: `${(palette.h / 360) * 100}%`,
                  }}
                />
              </div>
              <div
                ref={alphaRef}
                className="palette-alpha"
                style={{
                  backgroundImage: `linear-gradient(to right, rgba(0,0,0,0) 0%, ${paletteHex} 100%),
                    linear-gradient(45deg, #737b88 25%, transparent 25%),
                    linear-gradient(-45deg, #737b88 25%, transparent 25%),
                    linear-gradient(45deg, transparent 75%, #737b88 75%),
                    linear-gradient(-45deg, transparent 75%, #737b88 75%)`,
                  backgroundSize: "100% 100%, 12px 12px, 12px 12px, 12px 12px, 12px 12px",
                  backgroundPosition: "0 0, 0 0, 0 6px, 6px -6px, -6px 0",
                  backgroundRepeat: "no-repeat, repeat, repeat, repeat, repeat",
                }}
                onPointerDown={(e) => {
                  paletteDragModeRef.current = "a";
                  updateAlphaFromClient(e.clientX);
                }}
              >
                <div
                  className="palette-bar-cursor"
                  style={{
                    left: `${(palette.a / 255) * 100}%`,
                  }}
                />
              </div>
              <div className="palette-inputs">
                <input
                  className="palette-hex"
                  value={paletteHex}
                  onChange={(e) => {
                    const { r, g, b } = hexToRgb(e.target.value);
                    const hsv = rgbToHsv(r, g, b);
                    applyPalette({ ...palette, h: hsv.h, s: hsv.s, v: hsv.v });
                  }}
                />
                <div className="palette-rgba">
                  <input
                    type="number"
                    min={0}
                    max={255}
                    value={paletteRgb.r}
                    onChange={(e) => {
                      const next = rgbToHsv(Number(e.target.value), paletteRgb.g, paletteRgb.b);
                      applyPalette({ ...palette, h: next.h, s: next.s, v: next.v });
                    }}
                  />
                  <input
                    type="number"
                    min={0}
                    max={255}
                    value={paletteRgb.g}
                    onChange={(e) => {
                      const next = rgbToHsv(paletteRgb.r, Number(e.target.value), paletteRgb.b);
                      applyPalette({ ...palette, h: next.h, s: next.s, v: next.v });
                    }}
                  />
                  <input
                    type="number"
                    min={0}
                    max={255}
                    value={paletteRgb.b}
                    onChange={(e) => {
                      const next = rgbToHsv(paletteRgb.r, paletteRgb.g, Number(e.target.value));
                      applyPalette({ ...palette, h: next.h, s: next.s, v: next.v });
                    }}
                  />
                  <input
                    type="number"
                    min={0}
                    max={255}
                    value={palette.a}
                    onChange={(e) => applyPalette({ ...palette, a: Number(e.target.value) })}
                  />
                </div>
              </div>
            </div>
          ) : null}
        </div>
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
        <div className="canvas-stage-main">
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
        <aside className="canvas-layers">
          <div className="canvas-layers-header">
            <span>Layers</span>
            <div className="canvas-layers-actions">
              <button type="button" onClick={onCreateLayer} title="Create Layer">
                +
              </button>
              <button
                type="button"
                onClick={() => onDeleteLayer(status.activeLayerId)}
                disabled={status.layers.length <= 1}
                title="Delete Active Layer"
              >
                -
              </button>
            </div>
          </div>
          <ul className="canvas-layer-list">
            {status.layers.map((layer) => (
              <li
                key={layer.id}
                className={layer.id === status.activeLayerId ? "active" : ""}
                draggable
                onDragStart={() => setDragLayerId(layer.id)}
                onDragEnd={() => setDragLayerId(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDropLayer(layer.id)}
              >
                <div className="layer-row">
                  <button
                    type="button"
                    className={`vis ${layer.visible ? "on" : "off"}`}
                    onClick={() => onToggleLayerVisibility(layer.id)}
                    title="Toggle visibility"
                  >
                    {layer.visible ? "V" : "-"}
                  </button>
                  <button type="button" className="layer-pick" onClick={() => onSelectLayer(layer.id)}>
                    {layer.id === status.activeLayerId ? "*" : " "}
                  </button>
                  <input
                    value={layerNameDrafts[layer.id] ?? layer.name}
                    onChange={(e) =>
                      setLayerNameDrafts((prev) => ({
                        ...prev,
                        [layer.id]: e.target.value,
                      }))
                    }
                    onBlur={() => commitLayerName(layer)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        (e.currentTarget as HTMLInputElement).blur();
                      }
                    }}
                  />
                </div>
                <div className="layer-opacity">
                  <span>{layer.opacity}</span>
                  <input
                    type="range"
                    min={0}
                    max={255}
                    step={1}
                    value={layer.opacity}
                    onChange={(e) => onSetLayerOpacity(layer.id, Number(e.target.value))}
                  />
                </div>
              </li>
            ))}
          </ul>
        </aside>
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
