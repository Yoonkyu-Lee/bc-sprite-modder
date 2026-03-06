type Props = {
  toolLabel: string;
  zoom: number;
  selectionLabel: string;
  statusLine: string;
};

export function CanvasStatusBar(props: Props) {
  const { toolLabel, zoom, selectionLabel, statusLine } = props;
  return (
    <div className="canvas-status">
      <span>{`Tool: ${toolLabel}`}</span>
      <span>{`Zoom: ${zoom.toFixed(2)}x`}</span>
      <span>{selectionLabel}</span>
      <span>{statusLine}</span>
      <span className="hint">TAB/p/d/f/e/s/m/l, Z hold+drag, Ctrl+Wheel=H-Scroll, Ctrl+Z/Y</span>
    </div>
  );
}
