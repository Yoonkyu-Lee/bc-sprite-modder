import type { LayerStatus } from "../types";

type Props = {
  layers: LayerStatus[];
  activeLayerId: number;
  layerNameDrafts: Record<number, string>;
  onCreateLayer: () => void;
  onDeleteActiveLayer: () => void;
  onDragLayerStart: (layerId: number) => void;
  onDragLayerEnd: () => void;
  onDropLayer: (targetLayerId: number) => void;
  onToggleLayerVisibility: (layerId: number) => void;
  onSelectLayer: (layerId: number) => void;
  onLayerNameDraftChange: (layerId: number, value: string) => void;
  onCommitLayerName: (layer: LayerStatus) => void;
  onSetLayerOpacity: (layerId: number, opacity: number) => void;
};

export function LayersPanel(props: Props) {
  const {
    layers,
    activeLayerId,
    layerNameDrafts,
    onCreateLayer,
    onDeleteActiveLayer,
    onDragLayerStart,
    onDragLayerEnd,
    onDropLayer,
    onToggleLayerVisibility,
    onSelectLayer,
    onLayerNameDraftChange,
    onCommitLayerName,
    onSetLayerOpacity,
  } = props;

  return (
    <aside className="canvas-layers">
      <div className="canvas-layers-header">
        <span>Layers</span>
        <div className="canvas-layers-actions">
          <button type="button" onClick={onCreateLayer} title="Create Layer">
            +
          </button>
          <button type="button" onClick={onDeleteActiveLayer} disabled={layers.length <= 1} title="Delete Active Layer">
            -
          </button>
        </div>
      </div>
      <ul className="canvas-layer-list">
        {[...layers].reverse().map((layer) => (
          <li
            key={layer.id}
            className={layer.id === activeLayerId ? "active" : ""}
            draggable
            onDragStart={() => onDragLayerStart(layer.id)}
            onDragEnd={onDragLayerEnd}
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
                {layer.id === activeLayerId ? "*" : " "}
              </button>
              <input
                value={layerNameDrafts[layer.id] ?? layer.name}
                onChange={(e) => onLayerNameDraftChange(layer.id, e.target.value)}
                onBlur={() => onCommitLayerName(layer)}
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
  );
}
