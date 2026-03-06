import { useRef } from "react";
import { DockviewReact } from "dockview";
import "dockview/dist/styles/dockview.css";
import { ViewportPanel } from "../panels/ViewportPanel";
import { CanvasPanel } from "../panels/CanvasPanel";

const components = {
  viewport: ViewportPanel,
  canvas: CanvasPanel,
};

export function SpriteEditorView() {
  const dockRef = useRef<DockviewReact | null>(null);

  return (
    <div className="sprite-editor-view dockview-theme-dark" style={{ height: "100%", minHeight: 400 }}>
      <DockviewReact
        ref={dockRef}
        components={components}
        onReady={(event) => {
          const api = event.api;
          api.addPanel({
            id: "viewport",
            component: "viewport",
            title: "애니메이션 뷰포트",
          });
          api.addPanel({
            id: "canvas",
            component: "canvas",
            title: "캔버스",
            position: { referencePanel: "viewport", direction: "below" },
          });
        }}
      />
    </div>
  );
}
