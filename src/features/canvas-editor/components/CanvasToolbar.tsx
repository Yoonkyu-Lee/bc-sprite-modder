import type { RefObject } from "react";
import type { SelectionMode, ToolKind } from "../types";
import { PalettePopover, type PaletteRgb, type PaletteState } from "./PalettePopover";

const TOOL_BUTTONS: { tool: ToolKind; label: string; hotkey: string }[] = [
  { tool: "draw", label: "DRAW", hotkey: "D" },
  { tool: "fill", label: "FILL", hotkey: "F" },
  { tool: "erase", label: "ERASE", hotkey: "E" },
  { tool: "select", label: "SELECT", hotkey: "S" },
  { tool: "move", label: "MOVE", hotkey: "M" },
  { tool: "pick", label: "PICK", hotkey: "P" },
];

type Props = {
  activeTool: ToolKind;
  selectionMode: SelectionMode;
  canUndo: boolean;
  canRedo: boolean;
  zoomToolLatched: boolean;
  paletteOpen: boolean;
  palette: PaletteState;
  paletteHex: string;
  paletteRgb: PaletteRgb;
  svRef: RefObject<HTMLDivElement | null>;
  hueRef: RefObject<HTMLDivElement | null>;
  alphaRef: RefObject<HTMLDivElement | null>;
  onSelectTool: (tool: ToolKind) => void;
  onTogglePaletteOpen: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleZoomTool: () => void;
  onResetZoom: () => void;
  onSelectSelectionMode: (mode: SelectionMode) => void;
  onStartSvDrag: (x: number, y: number) => void;
  onStartHueDrag: (x: number) => void;
  onStartAlphaDrag: (x: number) => void;
  onHexChange: (hex: string) => void;
  onRgbChange: (rgb: PaletteRgb) => void;
  onAlphaChange: (alpha: number) => void;
};

export function CanvasToolbar(props: Props) {
  const {
    activeTool,
    selectionMode,
    canUndo,
    canRedo,
    zoomToolLatched,
    paletteOpen,
    palette,
    paletteHex,
    paletteRgb,
    svRef,
    hueRef,
    alphaRef,
    onSelectTool,
    onTogglePaletteOpen,
    onUndo,
    onRedo,
    onToggleZoomTool,
    onResetZoom,
    onSelectSelectionMode,
    onStartSvDrag,
    onStartHueDrag,
    onStartAlphaDrag,
    onHexChange,
    onRgbChange,
    onAlphaChange,
  } = props;

  return (
    <div className="canvas-toolbar">
      {TOOL_BUTTONS.map((item) => (
        <button
          key={item.tool}
          type="button"
          className={activeTool === item.tool ? "active" : ""}
          title={`${item.label} (${item.hotkey})`}
          onClick={() => onSelectTool(item.tool)}
        >
          {item.label}
        </button>
      ))}
      <div className="palette-pop">
        <button type="button" className={paletteOpen ? "active" : ""} onClick={onTogglePaletteOpen} title="Palette">
          PALETTE
        </button>
        {paletteOpen ? (
          <PalettePopover
            palette={palette}
            paletteHex={paletteHex}
            paletteRgb={paletteRgb}
            svRef={svRef}
            hueRef={hueRef}
            alphaRef={alphaRef}
            onStartSvDrag={onStartSvDrag}
            onStartHueDrag={onStartHueDrag}
            onStartAlphaDrag={onStartAlphaDrag}
            onHexChange={onHexChange}
            onRgbChange={onRgbChange}
            onAlphaChange={onAlphaChange}
          />
        ) : null}
      </div>
      <button type="button" disabled={!canUndo} onClick={onUndo}>
        Undo
      </button>
      <button type="button" disabled={!canRedo} onClick={onRedo}>
        Redo
      </button>
      <button type="button" className={zoomToolLatched ? "active" : ""} title="Zoom Tool (Z hold)" onClick={onToggleZoomTool}>
        ZOOM
      </button>
      <button type="button" title="Zoom Reset" onClick={onResetZoom}>
        100%
      </button>
      <div className="select-mode-switch">
        <button
          type="button"
          className={selectionMode === "rect" ? "active" : ""}
          onClick={() => onSelectSelectionMode("rect")}
          title="Rect Selection"
        >
          RECT
        </button>
        <button
          type="button"
          className={selectionMode === "lasso" ? "active" : ""}
          onClick={() => onSelectSelectionMode("lasso")}
          title="Lasso Selection"
        >
          LASSO
        </button>
      </div>
    </div>
  );
}
