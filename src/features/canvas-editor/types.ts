export type ToolKind = "pick" | "draw" | "fill" | "erase" | "select" | "move";
export type SelectionMode = "rect" | "lasso";

export type Point = {
  x: number;
  y: number;
};

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SelectionState = {
  rect: Rect | null;
  draftRect: Rect | null;
  moving: boolean;
  moveDelta: Point;
  mode: SelectionMode;
  lassoPoints: Point[];
  draftLassoPoints: Point[];
};

export type LayerStatus = {
  id: number;
  name: string;
  visible: boolean;
  opacity: number;
};

export type EditorStatus = {
  width: number;
  height: number;
  tool: ToolKind;
  activeColor: string;
  activeAlpha: number;
  activeLayerId: number;
  layers: LayerStatus[];
  selection: SelectionState;
  message: string | null;
  canUndo: boolean;
  canRedo: boolean;
  zoom: number;
  pan: Point;
  isPointerDown: boolean;
};

export type CanvasPointerInput = {
  type: "down" | "move" | "up";
  point: Point;
  button?: number;
};

export type PixelPatch = {
  layerId: number;
  changedIndices: number[];
  before: number[];
  after: number[];
};

export type EditorEventResult = {
  status: EditorStatus;
  patch: PixelPatch | null;
  consumed: boolean;
};

export type SnapshotResult = {
  width: number;
  height: number;
  rgbaBase64: string;
};

export type LayerComposites = {
  underlayRgbaBase64: string;
  overlayRgbaBase64: string;
};

export type MovePreviewData = {
  bounds: Rect;
  selectedIndices: number[];
  selectedBlockRgbaBase64: string;
  underSelectionRgbaBase64: string;
  underlayRgbaBase64: string;
  overlayRgbaBase64: string;
  /** Source layer opacity at float-start time (0-255). */
  opacity: number;
};
