import { useCallback, type Dispatch, type SetStateAction } from "react";
import {
  applyPatch,
  createLayerAboveActive,
  decodeRgbaBase64,
  deleteLayer,
  getSnapshot,
  redo,
  renameLayer,
  reorderLayers,
  setActiveLayer,
  setLayerOpacity,
  toggleLayerVisibility,
  undo,
} from "../backend";
import type { EditorStatus, LayerStatus } from "../types";
import type { MovePreviewState } from "../panel/movePreview";

type Params = {
  sessionIdRef: { current: string };
  enqueue: (task: () => Promise<void>) => void;
  status: EditorStatus;
  bitmap: Uint8ClampedArray | null;
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
  } = params;

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
    [sessionIdRef, setStatus, setBitmap, setBitmapVersion, setMovePreview, setRevision]
  );

  const onUndo = useCallback(() => {
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
  }, [bitmap, enqueue, sessionIdRef, setBitmapVersion, setMovePreview, setStatus, setRevision]);

  const onRedo = useCallback(() => {
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
  }, [bitmap, enqueue, sessionIdRef, setBitmapVersion, setMovePreview, setStatus, setRevision]);

  const onCreateLayer = useCallback(() => {
    enqueue(async () => {
      const next = await createLayerAboveActive(sessionIdRef.current);
      await applyStatusWithSnapshot(next, true);
    });
  }, [enqueue, sessionIdRef, applyStatusWithSnapshot]);

  const onDeleteLayer = useCallback(
    (layerId: number) => {
      enqueue(async () => {
        const next = await deleteLayer(sessionIdRef.current, layerId);
        await applyStatusWithSnapshot(next, true);
      });
    },
    [enqueue, sessionIdRef, applyStatusWithSnapshot]
  );

  const onSelectLayer = useCallback(
    (layerId: number) => {
      enqueue(async () => {
        const next = await setActiveLayer(sessionIdRef.current, layerId);
        await applyStatusWithSnapshot(next, false);
      });
    },
    [enqueue, sessionIdRef, applyStatusWithSnapshot]
  );

  const onToggleLayerVisibility = useCallback(
    (layerId: number) => {
      enqueue(async () => {
        const next = await toggleLayerVisibility(sessionIdRef.current, layerId);
        await applyStatusWithSnapshot(next, true);
      });
    },
    [enqueue, sessionIdRef, applyStatusWithSnapshot]
  );

  const onSetLayerOpacity = useCallback(
    (layerId: number, opacity: number) => {
      enqueue(async () => {
        const next = await setLayerOpacity(sessionIdRef.current, layerId, opacity);
        await applyStatusWithSnapshot(next, true);
      });
    },
    [enqueue, sessionIdRef, applyStatusWithSnapshot]
  );

  const commitLayerName = useCallback(
    (layer: LayerStatus) => {
      const draft = (layerNameDrafts[layer.id] ?? layer.name).trim();
      if (!draft || draft === layer.name) {
        setLayerNameDrafts((prev) => ({ ...prev, [layer.id]: layer.name }));
        return;
      }
      enqueue(async () => {
        const next = await renameLayer(sessionIdRef.current, layer.id, draft);
        await applyStatusWithSnapshot(next, false);
      });
    },
    [layerNameDrafts, setLayerNameDrafts, enqueue, sessionIdRef, applyStatusWithSnapshot]
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
      enqueue(async () => {
        const next = await reorderLayers(sessionIdRef.current, ids);
        await applyStatusWithSnapshot(next, true);
      });
    },
    [dragLayerId, status.layers, setDragLayerId, enqueue, sessionIdRef, applyStatusWithSnapshot]
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

