import { useCallback, type Dispatch, type SetStateAction } from "react";
import { CanvasEditor } from "../engine";
import type { EditorEventResult, EditorStatus, LayerStatus } from "../types";
import type { MovePreviewState } from "../panel/movePreview";

type Params = {
  editorRef: { current: CanvasEditor | null };
  status: EditorStatus;
  dragLayerId: number | null;
  layerNameDrafts: Record<number, string>;
  setStatus: Dispatch<SetStateAction<EditorStatus>>;
  setBitmap: Dispatch<SetStateAction<Uint8ClampedArray | null>>;
  setBitmapVersion: Dispatch<SetStateAction<number>>;
  setMovePreview: Dispatch<SetStateAction<MovePreviewState | null>>;
  setRevision: Dispatch<SetStateAction<number>>;
  setDragLayerId: Dispatch<SetStateAction<number | null>>;
  setLayerNameDrafts: Dispatch<SetStateAction<Record<number, string>>>;
};

export function useCanvasActions(params: Params) {
  const {
    editorRef,
    status,
    dragLayerId,
    layerNameDrafts,
    setStatus,
    setBitmap,
    setBitmapVersion,
    setMovePreview,
    setRevision,
    setDragLayerId,
    setLayerNameDrafts,
  } = params;

  const refreshBitmap = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    setBitmap(new Uint8ClampedArray(editor.get_composite_bitmap()));
    setBitmapVersion((v) => v + 1);
  }, [editorRef, setBitmap, setBitmapVersion]);

  const applyEventResult = useCallback(
    (result: EditorEventResult) => {
      setStatus(result.status);
      if (result.patch) refreshBitmap();
      setMovePreview(null);
      setRevision((v) => v + 1);
    },
    [setStatus, refreshBitmap, setMovePreview, setRevision]
  );

  const onUndo = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const result = editor.undo() as EditorEventResult;
    applyEventResult(result);
  }, [editorRef, applyEventResult]);

  const onRedo = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const result = editor.redo() as EditorEventResult;
    applyEventResult(result);
  }, [editorRef, applyEventResult]);

  const onCreateLayer = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const next = editor.create_layer_above_active() as EditorStatus;
    setStatus(next);
    refreshBitmap();
    setMovePreview(null);
    setRevision((v) => v + 1);
  }, [editorRef, setStatus, refreshBitmap, setMovePreview, setRevision]);

  const onDeleteLayer = useCallback(
    (layerId: number) => {
      const editor = editorRef.current;
      if (!editor) return;
      const next = editor.delete_layer(layerId) as EditorStatus;
      setStatus(next);
      refreshBitmap();
      setMovePreview(null);
      setRevision((v) => v + 1);
    },
    [editorRef, setStatus, refreshBitmap, setMovePreview, setRevision]
  );

  const onSelectLayer = useCallback(
    (layerId: number) => {
      const editor = editorRef.current;
      if (!editor) return;
      const next = editor.set_active_layer(layerId) as EditorStatus;
      setStatus(next);
      setMovePreview(null);
      setRevision((v) => v + 1);
    },
    [editorRef, setStatus, setMovePreview, setRevision]
  );

  const onToggleLayerVisibility = useCallback(
    (layerId: number) => {
      const editor = editorRef.current;
      if (!editor) return;
      const next = editor.toggle_layer_visibility(layerId) as EditorStatus;
      setStatus(next);
      refreshBitmap();
      setMovePreview(null);
      setRevision((v) => v + 1);
    },
    [editorRef, setStatus, refreshBitmap, setMovePreview, setRevision]
  );

  const onSetLayerOpacity = useCallback(
    (layerId: number, opacity: number) => {
      const editor = editorRef.current;
      if (!editor) return;
      const next = editor.set_layer_opacity(layerId, Math.max(0, Math.min(255, Math.round(opacity)))) as EditorStatus;
      setStatus(next);
      refreshBitmap();
      setMovePreview(null);
      setRevision((v) => v + 1);
    },
    [editorRef, setStatus, refreshBitmap, setMovePreview, setRevision]
  );

  const commitLayerName = useCallback(
    (layer: LayerStatus) => {
      const draft = (layerNameDrafts[layer.id] ?? layer.name).trim();
      if (!draft || draft === layer.name) {
        setLayerNameDrafts((prev) => ({ ...prev, [layer.id]: layer.name }));
        return;
      }
      const editor = editorRef.current;
      if (!editor) return;
      const next = editor.rename_layer(layer.id, draft) as EditorStatus;
      setStatus(next);
      setMovePreview(null);
      setRevision((v) => v + 1);
    },
    [layerNameDrafts, setLayerNameDrafts, editorRef, setStatus, setMovePreview, setRevision]
  );

  const onDropLayer = useCallback(
    (targetLayerId: number) => {
      if (dragLayerId == null || dragLayerId === targetLayerId) return;
      const ids = status.layers.map((l) => l.id);
      const from = ids.indexOf(dragLayerId);
      const to = ids.indexOf(targetLayerId);
      if (from < 0 || to < 0) return;
      ids.splice(from, 1);
      ids.splice(to, 0, dragLayerId);
      setDragLayerId(null);
      const editor = editorRef.current;
      if (!editor) return;
      const next = editor.reorder_layers(new Uint32Array(ids)) as EditorStatus;
      setStatus(next);
      refreshBitmap();
      setMovePreview(null);
      setRevision((v) => v + 1);
    },
    [dragLayerId, status.layers, setDragLayerId, editorRef, setStatus, refreshBitmap, setMovePreview, setRevision]
  );

  return {
    onUndo,
    onRedo,
    onCreateLayer,
    onDeleteLayer,
    onSelectLayer,
    onToggleLayerVisibility,
    onSetLayerOpacity,
    commitLayerName,
    onDropLayer,
  };
}
