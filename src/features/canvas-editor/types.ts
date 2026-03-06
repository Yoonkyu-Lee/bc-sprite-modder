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

export type EditorStatus = {
  width: number;
  height: number;
  tool: ToolKind;
  activeColor: string;
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

export type MovePreviewData = {
  bounds: Rect;
  selectedIndices: number[];
};
