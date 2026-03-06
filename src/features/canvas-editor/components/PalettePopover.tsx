import type { RefObject } from "react";

type PaletteState = {
  h: number;
  s: number;
  v: number;
  a: number;
};

type PaletteRgb = {
  r: number;
  g: number;
  b: number;
};

type Props = {
  palette: PaletteState;
  paletteHex: string;
  paletteRgb: PaletteRgb;
  svRef: RefObject<HTMLDivElement | null>;
  hueRef: RefObject<HTMLDivElement | null>;
  alphaRef: RefObject<HTMLDivElement | null>;
  onStartSvDrag: (clientX: number, clientY: number) => void;
  onStartHueDrag: (clientX: number) => void;
  onStartAlphaDrag: (clientX: number) => void;
  onHexChange: (hex: string) => void;
  onRgbChange: (rgb: PaletteRgb) => void;
  onAlphaChange: (alpha: number) => void;
};

export function PalettePopover(props: Props) {
  const {
    palette,
    paletteHex,
    paletteRgb,
    svRef,
    hueRef,
    alphaRef,
    onStartSvDrag,
    onStartHueDrag,
    onStartAlphaDrag,
    onHexChange,
    onRgbChange,
    onAlphaChange,
  } = props;

  return (
    <div className="palette-popover">
      <div
        ref={svRef}
        className="palette-sv"
        style={{ backgroundColor: `hsl(${palette.h} 100% 50%)` }}
        onPointerDown={(e) => onStartSvDrag(e.clientX, e.clientY)}
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
      <div ref={hueRef} className="palette-hue" onPointerDown={(e) => onStartHueDrag(e.clientX)}>
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
        onPointerDown={(e) => onStartAlphaDrag(e.clientX)}
      >
        <div
          className="palette-bar-cursor"
          style={{
            left: `${(palette.a / 255) * 100}%`,
          }}
        />
      </div>
      <div className="palette-inputs">
        <input className="palette-hex" value={paletteHex} onChange={(e) => onHexChange(e.target.value)} />
        <div className="palette-rgba">
          <input
            type="number"
            min={0}
            max={255}
            value={paletteRgb.r}
            onChange={(e) => onRgbChange({ ...paletteRgb, r: Number(e.target.value) })}
          />
          <input
            type="number"
            min={0}
            max={255}
            value={paletteRgb.g}
            onChange={(e) => onRgbChange({ ...paletteRgb, g: Number(e.target.value) })}
          />
          <input
            type="number"
            min={0}
            max={255}
            value={paletteRgb.b}
            onChange={(e) => onRgbChange({ ...paletteRgb, b: Number(e.target.value) })}
          />
          <input type="number" min={0} max={255} value={palette.a} onChange={(e) => onAlphaChange(Number(e.target.value))} />
        </div>
      </div>
    </div>
  );
}

export type { PaletteState, PaletteRgb };
