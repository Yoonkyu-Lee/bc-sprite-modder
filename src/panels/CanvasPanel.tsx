import type { IDockviewPanelProps } from "dockview";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CanvasRenderer } from "../features/canvas-editor/render";
import { CanvasStatusBar } from "../features/canvas-editor/components/CanvasStatusBar";
import { CanvasToolbar } from "../features/canvas-editor/components/CanvasToolbar";
import { LayersPanel } from "../features/canvas-editor/components/LayersPanel";
import type { MovePreviewState } from "../features/canvas-editor/panel/movePreview";
import { CANVAS_SIZE, fallbackStatus } from "../features/canvas-editor/panel/status";
import { useCanvasSessionQueue } from "../features/canvas-editor/hooks/useCanvasSessionQueue";
import { usePaletteController } from "../features/canvas-editor/hooks/usePaletteController";
import { useCanvasInputController } from "../features/canvas-editor/hooks/useCanvasInputController";
import { useCanvasActions } from "../features/canvas-editor/hooks/useCanvasActions";
import {
  createSession,
  decodeRgbaBase64,
  getSnapshot,
} from "../features/canvas-editor/backend";
import type { EditorStatus, Point } from "../features/canvas-editor/types";

export function CanvasPanel(_props: IDockviewPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const { sessionIdRef, loadError, setLoadError, enqueue } = useCanvasSessionQueue();
  const [status, setStatus] = useState<EditorStatus>(fallbackStatus());
  const [bitmap, setBitmap] = useState<Uint8ClampedArray | null>(null);
  const [bitmapVersion, setBitmapVersion] = useState(0);
  const [movePreview, setMovePreview] = useState<MovePreviewState | null>(null);
  const [hoverPixel, setHoverPixel] = useState<Point | null>(null);
  const [revision, setRevision] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const [dragLayerId, setDragLayerId] = useState<number | null>(null);
  const [layerNameDrafts, setLayerNameDrafts] = useState<Record<number, string>>({});

  if (rendererRef.current == null) {
    rendererRef.current = new CanvasRenderer(CANVAS_SIZE, CANVAS_SIZE);
  }

  const bumpRevision = useCallback(() => setRevision((v) => v + 1), []);
  const {
    paletteOpen,
    setPaletteOpen,
    palette,
    paletteRgb,
    paletteHex,
    svRef,
    hueRef,
    alphaRef,
    startSvDrag,
    startHueDrag,
    startAlphaDrag,
    onHexChange,
    onRgbChange,
    onAlphaChange,
  } = usePaletteController({
    status,
    sessionIdRef,
    enqueue,
    setStatus,
    bumpRevision,
  });

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
    setLayerNameDrafts((prev) => {
      const next: Record<number, string> = {};
      for (const layer of status.layers) {
        next[layer.id] = prev[layer.id] ?? layer.name;
      }
      return next;
    });
  }, [status.layers]);

  const focusPanel = () => rootRef.current?.focus();
  const {
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
  } = useCanvasInputController({
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
  });

  const {
    onUndo,
    onRedo,
    onCreateLayer,
    onDeleteLayer,
    onSelectLayer,
    onToggleLayerVisibility,
    onSetLayerOpacity,
    commitLayerName,
    onDropLayer,
  } = useCanvasActions({
    sessionIdRef,
    enqueue,
    status,
    bitmap,
    dragLayerId,
    layerNameDrafts,
    setStatus,
    setBitmap,
    setBitmapVersion,
    setMovePreview,
    setRevision,
    setDragLayerId,
    setLayerNameDrafts,
  });

  const statusLine = useMemo(() => {
    if (loadError) return `Error: ${loadError}`;
    if (isZoomToolActive) return `ZOOM TOOL (${zoomToolHeld ? "hold" : "latched"})`;
    return status.message ?? "Ready";
  }, [status.message, loadError, isZoomToolActive, zoomToolHeld]);

  const selectionLabel = status.selection.rect
    ? `Selection: ${status.selection.rect.width}x${status.selection.rect.height}`
    : "Selection: none";
  const toolLabel = (isZoomToolActive ? "zoom" : status.tool).toUpperCase();

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
      <CanvasToolbar
        activeTool={status.tool}
        selectionMode={status.selection.mode}
        canUndo={status.canUndo}
        canRedo={status.canRedo}
        zoomToolLatched={zoomToolLatched}
        paletteOpen={paletteOpen}
        palette={palette}
        paletteHex={paletteHex}
        paletteRgb={paletteRgb}
        svRef={svRef}
        hueRef={hueRef}
        alphaRef={alphaRef}
        onSelectTool={selectTool}
        onTogglePaletteOpen={() => setPaletteOpen((v) => !v)}
        onUndo={onUndo}
        onRedo={onRedo}
        onToggleZoomTool={() => setZoomToolLatched((v) => !v)}
        onResetZoom={() => changeZoom(1)}
        onSelectSelectionMode={selectSelectionMode}
        onStartSvDrag={startSvDrag}
        onStartHueDrag={startHueDrag}
        onStartAlphaDrag={startAlphaDrag}
        onHexChange={onHexChange}
        onRgbChange={onRgbChange}
        onAlphaChange={onAlphaChange}
      />
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
        <LayersPanel
          layers={status.layers}
          activeLayerId={status.activeLayerId}
          layerNameDrafts={layerNameDrafts}
          onCreateLayer={onCreateLayer}
          onDeleteActiveLayer={() => onDeleteLayer(status.activeLayerId)}
          onDragLayerStart={(layerId) => setDragLayerId(layerId)}
          onDragLayerEnd={() => setDragLayerId(null)}
          onDropLayer={onDropLayer}
          onToggleLayerVisibility={onToggleLayerVisibility}
          onSelectLayer={onSelectLayer}
          onLayerNameDraftChange={(layerId, value) =>
            setLayerNameDrafts((prev) => ({
              ...prev,
              [layerId]: value,
            }))
          }
          onCommitLayerName={commitLayerName}
          onSetLayerOpacity={onSetLayerOpacity}
        />
      </div>
      <CanvasStatusBar toolLabel={toolLabel} zoom={status.zoom} selectionLabel={selectionLabel} statusLine={statusLine} />
    </div>
  );
}
