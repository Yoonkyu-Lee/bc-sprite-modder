import { useRef, useEffect, useState, useCallback } from "react";
import type { IDockviewPanelProps } from "dockview";
import { invoke } from "@tauri-apps/api/core";
import { useSpriteEditor } from "../stores/spriteEditorStore";
import { useWorkspace } from "../stores/workspaceStore";
import { useProject } from "../stores/projectStore";

const TARGET_FPS = 30;
const LOGICAL_VIEWPORT = 400;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;

type PartDraw = {
  rect: [number, number, number, number];
  corners: number[];
  alpha: number;
  additive: boolean;
};

type FrameDrawData = { parts: PartDraw[] };

type PlaybackData = {
  texture: HTMLImageElement;
  textureWidth: number;
  textureHeight: number;
  frames: FrameDrawData[];
  totalFrames: number;
  animCount: number;
};

export function ViewportPanel(_props: IDockviewPanelProps) {
  const { selectedUnitId: unitId, selectedForm: form } = useSpriteEditor();
  const { workspacePath } = useWorkspace();
  const { currentProjectPath } = useProject();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [animIndex, setAnimIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [fps, setFps] = useState(0);
  const frameRef = useRef(0);
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const dragStartRef = useRef<{ panX: number; panY: number; clientX: number; clientY: number } | null>(null);
  const [extractDir, setExtractDir] = useState<string | null>(null);
  const [playbackCache, setPlaybackCache] = useState<Record<number, PlaybackData>>({});
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [playbackLoading, setPlaybackLoading] = useState(false);

  const playback = playbackCache[animIndex] ?? null;

  const loadOneAndCache = useCallback(
    async (dir: string, animIdx: number, showLoading: boolean) => {
      if (showLoading) {
        setPlaybackLoading(true);
        setPlaybackError(null);
      }
      try {
        const data = await invoke<{
          textureBase64: string;
          textureWidth: number;
          textureHeight: number;
          frames: FrameDrawData[];
          totalFrames: number;
          animCount: number;
        }>("get_viewport_playback_data", {
          args: {
            extractDir: dir,
            animIndex: animIdx,
            viewportWidth: LOGICAL_VIEWPORT,
            viewportHeight: LOGICAL_VIEWPORT,
          },
        });
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("텍스처 이미지 로드 실패"));
          img.src = `data:image/png;base64,${data.textureBase64}`;
        });
        const entry: PlaybackData = {
          texture: img,
          textureWidth: data.textureWidth,
          textureHeight: data.textureHeight,
          frames: data.frames,
          totalFrames: data.totalFrames,
          animCount: data.animCount,
        };
        setPlaybackCache((prev) => ({ ...prev, [animIdx]: entry }));
        if (showLoading) {
          frameRef.current = 0;
        }
      } catch (e) {
        if (showLoading) {
          setPlaybackError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (showLoading) {
          setPlaybackLoading(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    if (!unitId || !form || !workspacePath || !currentProjectPath) {
      setExtractDir(null);
      setPlaybackCache({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await invoke("load_form_assets", {
          args: {
            workspacePath,
            projectDir: currentProjectPath,
            unitId,
            form,
          },
        });
        if (cancelled) return;
        const { extract_dir } = await invoke<{ extract_dir: string }>("extract_viewport_assets", {
          args: {
            workspacePath,
            projectDir: currentProjectPath,
            unitId,
            form,
          },
        });
        if (cancelled) return;
        setPlaybackCache({});
        setExtractDir(extract_dir);
      } catch (e) {
        if (!cancelled) {
          console.warn("[ViewportPanel] 로드/추출 실패:", e);
          setPlaybackError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unitId, form, workspacePath, currentProjectPath]);

  useEffect(() => {
    if (extractDir == null) return;
    if (playbackCache[animIndex] != null) {
      frameRef.current = 0;
      return;
    }
    loadOneAndCache(extractDir, animIndex, true);
  }, [extractDir, animIndex, loadOneAndCache, playbackCache]);

  useEffect(() => {
    if (extractDir == null || playback == null) return;
    const count = playback.animCount;
    for (let i = 0; i < count; i++) {
      if (playbackCache[i] != null) continue;
      loadOneAndCache(extractDir, i, false);
    }
  }, [extractDir, playback, playbackCache, loadOneAndCache]);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#282c34");
      bg.addColorStop(1, "#1e2228");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      if (!unitId || !form) {
        ctx.fillStyle = "#888";
        ctx.font = "14px system-ui";
        ctx.textAlign = "center";
        ctx.fillText("유닛·폼을 선택하세요", w / 2, h / 2);
        return;
      }

      if (playbackLoading) {
        ctx.fillStyle = "#aaa";
        ctx.font = "14px system-ui";
        ctx.textAlign = "center";
        ctx.fillText("재생 데이터 생성 중…", w / 2, h / 2 - 10);
        ctx.font = "12px system-ui";
        ctx.fillStyle = "#888";
        ctx.fillText("(모든 프레임 draw 데이터 + 텍스처 인코딩)", w / 2, h / 2 + 12);
        return;
      }

      if (playbackError) {
        ctx.fillStyle = "#e06c75";
        ctx.font = "12px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(playbackError, w / 2, h / 2);
        return;
      }

      if (!playback || playback.frames.length === 0) {
        ctx.fillStyle = "#888";
        ctx.font = "14px system-ui";
        ctx.textAlign = "center";
        ctx.fillText("재생 데이터 없음", w / 2, h / 2);
        return;
      }

      const { texture, frames, totalFrames } = playback;
      const frameIndex = totalFrames > 0 ? frameRef.current % totalFrames : 0;
      const frame = frames[frameIndex];
      if (!frame) return;

      const baseScale = Math.min(w / LOGICAL_VIEWPORT, h / LOGICAL_VIEWPORT);
      const zoom = zoomRef.current;
      const scale = baseScale * zoom;
      const baseOffsetX = (w - LOGICAL_VIEWPORT * scale) / 2;
      const baseOffsetY = (h - LOGICAL_VIEWPORT * scale) / 2;
      const offsetX = baseOffsetX + panRef.current.x;
      const offsetY = baseOffsetY + panRef.current.y;

      for (const part of frame.parts) {
        const [sx, sy, sw, sh] = part.rect;
        const c = part.corners;
        if (c.length < 8) continue;
        const x0 = c[0], y0 = c[1];
        const x1 = c[2], y1 = c[3];
        const x3 = c[6], y3 = c[7];
        const a = (x1 - x0) / sw;
        const b = (y1 - y0) / sw;
        const c_ = (x3 - x0) / sh;
        const d = (y3 - y0) / sh;
        const e = x0;
        const f = y0;

        ctx.save();
        ctx.globalAlpha = part.alpha;
        ctx.globalCompositeOperation = part.additive ? "lighter" : "source-over";
        ctx.setTransform(
          scale * a,
          scale * b,
          scale * c_,
          scale * d,
          offsetX + scale * e,
          offsetY + scale * f
        );
        ctx.drawImage(texture, sx, sy, sw, sh, 0, 0, sw, sh);
        ctx.restore();
      }

      ctx.fillStyle = "#ccc";
      ctx.font = "12px system-ui";
      ctx.textAlign = "left";
      ctx.globalAlpha = 1;
      ctx.fillText(
        `${unitId} / ${form}  Anim #${animIndex}  Frame ${frameIndex + 1}/${totalFrames}`,
        8,
        h - 8
      );
    },
    [unitId, form, playback, playbackLoading, playbackError, animIndex]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId: number;
    const resize = () => {
      const dpr = window.devicePixelRatio ?? 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(ctx, rect.width, rect.height);
    };

    const intervalMs = Math.round(1000 / TARGET_FPS);
    const logicTick = () => {
      if (!pausedRef.current) {
        frameRef.current += 1;
        setFps(TARGET_FPS);
      }
    };
    const drawTick = () => {
      const w = canvas.getBoundingClientRect().width;
      const h = canvas.getBoundingClientRect().height;
      draw(ctx, w, h);
      rafId = requestAnimationFrame(drawTick);
    };

    resize();
    rafId = requestAnimationFrame(drawTick);
    const intervalId = window.setInterval(logicTick, intervalMs);
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => {
      cancelAnimationFrame(rafId);
      clearInterval(intervalId);
      ro.disconnect();
    };
  }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas) return;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0) {
        canvas.focus();
      }
      if (e.button === 1) {
        e.preventDefault();
        canvas.style.cursor = "grabbing";
        dragStartRef.current = {
          panX: panRef.current.x,
          panY: panRef.current.y,
          clientX: e.clientX,
          clientY: e.clientY,
        };
      }
    };
    const onMouseMove = (e: MouseEvent) => {
      if (dragStartRef.current != null) {
        e.preventDefault();
        panRef.current = {
          x: dragStartRef.current.panX + (e.clientX - dragStartRef.current.clientX),
          y: dragStartRef.current.panY + (e.clientY - dragStartRef.current.clientY),
        };
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 1) {
        dragStartRef.current = null;
        canvas.style.cursor = "grab";
      }
    };
    const onMouseLeave = () => {
      if (dragStartRef.current != null) canvas.style.cursor = "grab";
      dragStartRef.current = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.deltaY !== 0) {
        const factor = 1 - e.deltaY * 0.002;
        zoomRef.current = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomRef.current * factor));
      }
      if (e.deltaX !== 0) {
        panRef.current = {
          x: panRef.current.x - e.deltaX,
          y: panRef.current.y,
        };
      }
      if (e.deltaY === 0 && e.deltaX === 0 && e.deltaZ !== 0) {
        const factor = 1 - e.deltaZ * 0.002;
        zoomRef.current = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomRef.current * factor));
      }
    };

    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("mouseleave", onMouseLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    if (container) {
      container.addEventListener("wheel", onWheel, { passive: false });
    }
    return () => {
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("mouseleave", onMouseLeave);
      canvas.removeEventListener("wheel", onWheel);
      if (container) {
        container.removeEventListener("wheel", onWheel);
      }
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement !== canvas) {
        return;
      }
      if (e.key === "1") {
        setAnimIndex(0);
        e.preventDefault();
      } else if (e.key === "2") {
        setAnimIndex(1);
        e.preventDefault();
      } else if (e.key === "3") {
        setAnimIndex(2);
        e.preventDefault();
      } else if (e.key === "4") {
        setAnimIndex(3);
        e.preventDefault();
      } else if (e.key === " ") {
        setPaused((p) => !p);
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div
      ref={containerRef}
      className="viewport-panel"
      style={{ height: "100%", position: "relative", overflow: "hidden" }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block", background: "#1e2228", cursor: "grab" }}
        tabIndex={0}
        aria-label="애니메이션 뷰포트 (휠: 줌, 휠 드래그: 이동, 키 1-4: 애니 전환, Space: 일시정지)"
      />
      <div
        className="viewport-fps"
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          color: "#fff",
          fontSize: 12,
          fontWeight: "bold",
          pointerEvents: "none",
        }}
      >
        FPS: {fps.toFixed(1)} {paused ? " [일시정지]" : ""}
      </div>
    </div>
  );
}
