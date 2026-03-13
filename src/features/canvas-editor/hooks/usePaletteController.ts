import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { CanvasEditor } from "../engine";
import { clamp, hexToRgb, hsvToRgb, rgbToHex, rgbToHsv, type PaletteState } from "../panel/color";
import type { EditorStatus } from "../types";

type UsePaletteControllerParams = {
  status: EditorStatus;
  editorRef: { current: CanvasEditor | null };
  setStatus: Dispatch<SetStateAction<EditorStatus>>;
  bumpRevision: () => void;
};

export function usePaletteController(params: UsePaletteControllerParams) {
  const { status, editorRef, setStatus, bumpRevision } = params;

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [palette, setPalette] = useState<PaletteState>({ h: 0, s: 0, v: 1, a: 255 });

  const paletteDragModeRef = useRef<"sv" | "h" | "a" | null>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const alphaRef = useRef<HTMLDivElement>(null);
  const palettePendingRef = useRef<{ hex: string; alpha: number } | null>(null);
  const paletteRafRef = useRef<number | null>(null);

  const pushPaletteToEditor = useCallback(
    (hex: string, alpha: number) => {
      palettePendingRef.current = { hex, alpha: clamp(Math.round(alpha), 0, 255) };
      if (paletteRafRef.current != null) return;
      paletteRafRef.current = requestAnimationFrame(() => {
        paletteRafRef.current = null;
        const payload = palettePendingRef.current;
        palettePendingRef.current = null;
        const editor = editorRef.current;
        if (!payload || !editor) return;
        editor.set_active_color(payload.hex);
        const next = editor.set_active_alpha(payload.alpha) as EditorStatus;
        setStatus(next);
        bumpRevision();
      });
    },
    [bumpRevision, editorRef, setStatus]
  );

  const applyPalette = useCallback(
    (next: PaletteState) => {
      const safe: PaletteState = {
        h: clamp(next.h, 0, 360),
        s: clamp(next.s, 0, 1),
        v: clamp(next.v, 0, 1),
        a: clamp(Math.round(next.a), 0, 255),
      };
      setPalette(safe);
      const rgb = hsvToRgb(safe.h, safe.s, safe.v);
      const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
      pushPaletteToEditor(hex, safe.a);
    },
    [pushPaletteToEditor]
  );

  const updateSvFromClient = useCallback(
    (clientX: number, clientY: number) => {
      const el = svRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const s = clamp((clientX - r.left) / r.width, 0, 1);
      const v = 1 - clamp((clientY - r.top) / r.height, 0, 1);
      applyPalette({ ...palette, s, v });
    },
    [palette, applyPalette]
  );

  const updateHueFromClient = useCallback(
    (clientX: number) => {
      const el = hueRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const t = clamp((clientX - r.left) / r.width, 0, 1);
      applyPalette({ ...palette, h: t * 360 });
    },
    [palette, applyPalette]
  );

  const updateAlphaFromClient = useCallback(
    (clientX: number) => {
      const el = alphaRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const t = clamp((clientX - r.left) / r.width, 0, 1);
      applyPalette({ ...palette, a: Math.round(t * 255) });
    },
    [palette, applyPalette]
  );

  const paletteRgb = useMemo(() => hsvToRgb(palette.h, palette.s, palette.v), [palette]);
  const paletteHex = useMemo(() => rgbToHex(paletteRgb.r, paletteRgb.g, paletteRgb.b), [paletteRgb]);

  const onHexChange = useCallback(
    (hex: string) => {
      const { r, g, b } = hexToRgb(hex);
      const hsv = rgbToHsv(r, g, b);
      applyPalette({ ...palette, h: hsv.h, s: hsv.s, v: hsv.v });
    },
    [applyPalette, palette]
  );

  const onRgbChange = useCallback(
    (rgb: { r: number; g: number; b: number }) => {
      const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      applyPalette({ ...palette, h: hsv.h, s: hsv.s, v: hsv.v });
    },
    [applyPalette, palette]
  );

  const onAlphaChange = useCallback(
    (alpha: number) => {
      applyPalette({ ...palette, a: alpha });
    },
    [applyPalette, palette]
  );

  const startSvDrag = useCallback(
    (x: number, y: number) => {
      paletteDragModeRef.current = "sv";
      updateSvFromClient(x, y);
    },
    [updateSvFromClient]
  );

  const startHueDrag = useCallback(
    (x: number) => {
      paletteDragModeRef.current = "h";
      updateHueFromClient(x);
    },
    [updateHueFromClient]
  );

  const startAlphaDrag = useCallback(
    (x: number) => {
      paletteDragModeRef.current = "a";
      updateAlphaFromClient(x);
    },
    [updateAlphaFromClient]
  );

  useEffect(() => {
    if (paletteDragModeRef.current) return;
    const { r, g, b } = hexToRgb(status.activeColor);
    const hsv = rgbToHsv(r, g, b);
    setPalette({ h: hsv.h, s: hsv.s, v: hsv.v, a: status.activeAlpha });
  }, [status.activeColor, status.activeAlpha]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const mode = paletteDragModeRef.current;
      if (!mode) return;
      if (mode === "sv") updateSvFromClient(event.clientX, event.clientY);
      else if (mode === "h") updateHueFromClient(event.clientX);
      else if (mode === "a") updateAlphaFromClient(event.clientX);
    };
    const onUp = () => { paletteDragModeRef.current = null; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [updateSvFromClient, updateHueFromClient, updateAlphaFromClient]);

  useEffect(
    () => () => {
      if (paletteRafRef.current != null) cancelAnimationFrame(paletteRafRef.current);
    },
    []
  );

  return {
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
  };
}
