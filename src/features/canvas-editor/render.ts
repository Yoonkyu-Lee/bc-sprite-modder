import type { Point, Rect, ToolKind } from "./types";

export type RenderView = {
  viewportWidth: number;
  viewportHeight: number;
  imageWidth: number;
  imageHeight: number;
  zoom: number;
  panX: number;
  panY: number;
};

export type RenderSelection = {
  rect: Rect | null;
  draftRect: Rect | null;
  lassoPoints: Point[];
  draftLassoPoints: Point[];
};

export type RenderMovePreview = {
  bounds: Rect;
  delta: Point;
  mask: Uint8Array;
  maskVersion: number;
  pixels: Uint8ClampedArray;
  pixelsVersion: number;
  overlayBitmap: Uint8ClampedArray;
  overlayBitmapVersion: number;
};

export type RenderInput = {
  bitmap: Uint8ClampedArray;
  bitmapVersion: number;
  imageWidth: number;
  imageHeight: number;
  tool: ToolKind;
  hoverPixel: Point | null;
  view: RenderView;
  selection: RenderSelection;
  movePreview: RenderMovePreview | null;
};

type Transform = {
  originX: number;
  originY: number;
  drawWidth: number;
  drawHeight: number;
};

function computeTransform(view: RenderView): Transform {
  const drawWidth = view.imageWidth * view.zoom;
  const drawHeight = view.imageHeight * view.zoom;
  const originX = (view.viewportWidth - drawWidth) / 2 + view.panX;
  const originY = (view.viewportHeight - drawHeight) / 2 + view.panY;
  return { originX, originY, drawWidth, drawHeight };
}

export function screenToPixel(sx: number, sy: number, view: RenderView): { x: number; y: number } {
  const { originX, originY } = computeTransform(view);
  return {
    x: Math.floor((sx - originX) / view.zoom),
    y: Math.floor((sy - originY) / view.zoom),
  };
}

export class CanvasRenderer {
  private gl: WebGL2RenderingContext | null = null;
  private imageProgram: WebGLProgram | null = null;
  private lineProgram: WebGLProgram | null = null;
  private imageVao: WebGLVertexArrayObject | null = null;
  private lineVao: WebGLVertexArrayObject | null = null;
  private lineBuffer: WebGLBuffer | null = null;
  private baseTexture: WebGLTexture | null = null;
  private maskTexture: WebGLTexture | null = null;
  private floatingTexture: WebGLTexture | null = null;
  private overlayTexture: WebGLTexture | null = null;
  private baseTexSize: { w: number; h: number } = { w: 0, h: 0 };
  private maskTexSize: { w: number; h: number } = { w: 0, h: 0 };
  private floatingTexSize: { w: number; h: number } = { w: 0, h: 0 };
  private overlayTexSize: { w: number; h: number } = { w: 0, h: 0 };
  private uploadedBitmapVersion = -1;
  private uploadedMaskVersion = -1;
  private uploadedFloatingVersion = -1;
  private uploadedOverlayVersion = -1;

  private imageRectUniform: WebGLUniformLocation | null = null;
  private imageSamplerUniform: WebGLUniformLocation | null = null;
  private imageMaskSamplerUniform: WebGLUniformLocation | null = null;
  private hideSelectedUniform: WebGLUniformLocation | null = null;
  private lineColorUniform: WebGLUniformLocation | null = null;

  constructor(_width: number, _height: number) {}

  render(target: HTMLCanvasElement, input: RenderInput): void {
    if (!this.ensureGl(target)) return;
    const gl = this.gl;
    if (
      !gl ||
      !this.imageProgram ||
      !this.lineProgram ||
      !this.imageVao ||
      !this.lineVao ||
      !this.lineBuffer ||
      !this.baseTexture ||
      !this.maskTexture ||
      !this.floatingTexture ||
      !this.overlayTexture
    ) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const viewportW = Math.max(1, Math.floor(target.clientWidth));
    const viewportH = Math.max(1, Math.floor(target.clientHeight));
    const pixelW = Math.max(1, Math.floor(viewportW * dpr));
    const pixelH = Math.max(1, Math.floor(viewportH * dpr));
    if (target.width !== pixelW || target.height !== pixelH) {
      target.width = pixelW;
      target.height = pixelH;
    }
    gl.viewport(0, 0, pixelW, pixelH);

    const tf = computeTransform({
      ...input.view,
      viewportWidth: viewportW,
      viewportHeight: viewportH,
    });

    this.uploadBaseTextureIfNeeded(input.imageWidth, input.imageHeight, input.bitmap, input.bitmapVersion);
    if (input.movePreview) {
      this.uploadMaskTextureIfNeeded(input.imageWidth, input.imageHeight, input.movePreview.mask, input.movePreview.maskVersion);
      this.uploadFloatingTextureIfNeeded(
        Math.max(1, input.movePreview.bounds.width),
        Math.max(1, input.movePreview.bounds.height),
        input.movePreview.pixels,
        input.movePreview.pixelsVersion
      );
      this.uploadOverlayTextureIfNeeded(
        input.imageWidth,
        input.imageHeight,
        input.movePreview.overlayBitmap,
        input.movePreview.overlayBitmapVersion
      );
    }

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const frame = ndcRect(tf.originX, tf.originY, tf.drawWidth, tf.drawHeight, viewportW, viewportH);
    // Base bitmap can already include "source hole + under-layer restore" during move preview.
    // Applying hideSelected mask again causes a false cut-out of other layers.
    this.drawImageQuad(frame, this.baseTexture, false);

    if (input.movePreview) {
      const b = input.movePreview.bounds;
      const d = input.movePreview.delta;
      const ox = tf.originX + (b.x + d.x) * input.view.zoom;
      const oy = tf.originY + (b.y + d.y) * input.view.zoom;
      const ow = b.width * input.view.zoom;
      const oh = b.height * input.view.zoom;
      this.drawImageQuad(ndcRect(ox, oy, ow, oh, viewportW, viewportH), this.floatingTexture, false);
      this.drawImageQuad(frame, this.overlayTexture, false);
    }

    gl.useProgram(this.lineProgram);
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
    gl.uniform4f(this.lineColorUniform, 1.0, 0.87, 0.35, 0.95);
    this.drawRectLoop(frame);

    const activeRect = input.selection.draftRect ?? input.selection.rect;
    if (activeRect) {
      const rx0 = tf.originX + activeRect.x * input.view.zoom;
      const ry0 = tf.originY + activeRect.y * input.view.zoom;
      const rw = activeRect.width * input.view.zoom;
      const rh = activeRect.height * input.view.zoom;
      this.drawRectLoop(ndcRect(rx0, ry0, rw, rh, viewportW, viewportH));
    }

    const lasso =
      input.selection.draftLassoPoints.length > 1 ? input.selection.draftLassoPoints : input.selection.lassoPoints;
    if (lasso.length > 1) {
      this.drawLassoLoop(lasso, tf.originX, tf.originY, input.view.zoom, viewportW, viewportH);
    }

    if (
      input.hoverPixel &&
      (input.tool === "draw" ||
        input.tool === "erase" ||
        input.tool === "fill" ||
        input.tool === "pick" ||
        input.tool === "select") &&
      input.hoverPixel.x >= 0 &&
      input.hoverPixel.y >= 0 &&
      input.hoverPixel.x < input.imageWidth &&
      input.hoverPixel.y < input.imageHeight
    ) {
      gl.uniform4f(this.lineColorUniform, 0.75, 0.9, 1.0, 0.95);
      this.drawPixelMarker(input.hoverPixel, tf.originX, tf.originY, input.view.zoom, viewportW, viewportH);
    }
  }

  private drawImageQuad(rect: { x0: number; y0: number; x1: number; y1: number }, texture: WebGLTexture, hideSelected: boolean): void {
    const gl = this.gl;
    if (!gl || !this.imageProgram) return;
    gl.useProgram(this.imageProgram);
    gl.bindVertexArray(this.imageVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
    gl.uniform4f(this.imageRectUniform, rect.x0, rect.y0, rect.x1, rect.y1);
    gl.uniform1i(this.imageSamplerUniform, 0);
    gl.uniform1i(this.imageMaskSamplerUniform, 1);
    gl.uniform1i(this.hideSelectedUniform, hideSelected ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private drawRectLoop(rect: { x0: number; y0: number; x1: number; y1: number }): void {
    const gl = this.gl;
    if (!gl) return;
    const verts = new Float32Array([rect.x0, rect.y0, rect.x1, rect.y0, rect.x1, rect.y1, rect.x0, rect.y1, rect.x0, rect.y0]);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.LINE_STRIP, 0, 5);
  }

  private drawLassoLoop(points: Point[], originX: number, originY: number, zoom: number, viewportW: number, viewportH: number): void {
    const gl = this.gl;
    if (!gl) return;
    const verts = new Float32Array((points.length + 1) * 2);
    let n = 0;
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i];
      verts[n++] = toNdcX(originX + (p.x + 0.5) * zoom, viewportW);
      verts[n++] = toNdcY(originY + (p.y + 0.5) * zoom, viewportH);
    }
    const first = points[0];
    verts[n++] = toNdcX(originX + (first.x + 0.5) * zoom, viewportW);
    verts[n++] = toNdcY(originY + (first.y + 0.5) * zoom, viewportH);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.LINE_STRIP, 0, points.length + 1);
  }

  private drawPixelMarker(pixel: Point, originX: number, originY: number, zoom: number, viewportW: number, viewportH: number): void {
    const x = originX + pixel.x * zoom;
    const y = originY + pixel.y * zoom;
    this.drawRectLoop(ndcRect(x, y, zoom, zoom, viewportW, viewportH));
  }

  private uploadBaseTextureIfNeeded(width: number, height: number, bitmap: Uint8ClampedArray, version: number): void {
    const gl = this.gl;
    if (!gl || !this.baseTexture) return;
    gl.bindTexture(gl.TEXTURE_2D, this.baseTexture);
    if (this.baseTexSize.w !== width || this.baseTexSize.h !== height) {
      this.baseTexSize = { w: width, h: height };
      this.uploadedBitmapVersion = -1;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    if (this.uploadedBitmapVersion === version) return;
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    this.uploadedBitmapVersion = version;
  }

  private uploadMaskTextureIfNeeded(width: number, height: number, mask: Uint8Array, version: number): void {
    const gl = this.gl;
    if (!gl || !this.maskTexture) return;
    gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
    if (this.maskTexSize.w !== width || this.maskTexSize.h !== height) {
      this.maskTexSize = { w: width, h: height };
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, null);
      this.uploadedMaskVersion = -1;
    }
    if (this.uploadedMaskVersion === version) return;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RED, gl.UNSIGNED_BYTE, mask);
    this.uploadedMaskVersion = version;
  }

  private uploadFloatingTextureIfNeeded(width: number, height: number, pixels: Uint8ClampedArray, version: number): void {
    const gl = this.gl;
    if (!gl || !this.floatingTexture) return;
    gl.bindTexture(gl.TEXTURE_2D, this.floatingTexture);
    if (this.floatingTexSize.w !== width || this.floatingTexSize.h !== height) {
      this.floatingTexSize = { w: width, h: height };
      this.uploadedFloatingVersion = -1;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    if (this.uploadedFloatingVersion === version) return;
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    this.uploadedFloatingVersion = version;
  }

  private uploadOverlayTextureIfNeeded(width: number, height: number, bitmap: Uint8ClampedArray, version: number): void {
    const gl = this.gl;
    if (!gl || !this.overlayTexture) return;
    gl.bindTexture(gl.TEXTURE_2D, this.overlayTexture);
    if (this.overlayTexSize.w !== width || this.overlayTexSize.h !== height) {
      this.overlayTexSize = { w: width, h: height };
      this.uploadedOverlayVersion = -1;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    if (this.uploadedOverlayVersion === version) return;
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    this.uploadedOverlayVersion = version;
  }

  private ensureGl(target: HTMLCanvasElement): boolean {
    if (this.gl) return true;
    const gl = target.getContext("webgl2", { antialias: false, premultipliedAlpha: false });
    if (!gl) return false;
    this.gl = gl;
    this.imageProgram = createProgram(gl, IMAGE_VERT, IMAGE_FRAG);
    this.lineProgram = createProgram(gl, LINE_VERT, LINE_FRAG);
    if (!this.imageProgram || !this.lineProgram) return false;

    this.imageRectUniform = gl.getUniformLocation(this.imageProgram, "u_rectNdc");
    this.imageSamplerUniform = gl.getUniformLocation(this.imageProgram, "u_tex");
    this.imageMaskSamplerUniform = gl.getUniformLocation(this.imageProgram, "u_selMask");
    this.hideSelectedUniform = gl.getUniformLocation(this.imageProgram, "u_hideSelected");
    this.lineColorUniform = gl.getUniformLocation(this.lineProgram, "u_color");

    this.imageVao = gl.createVertexArray();
    this.lineVao = gl.createVertexArray();
    this.lineBuffer = gl.createBuffer();
    this.baseTexture = gl.createTexture();
    this.maskTexture = gl.createTexture();
    this.floatingTexture = gl.createTexture();
    this.overlayTexture = gl.createTexture();
    if (
      !this.imageVao ||
      !this.lineVao ||
      !this.lineBuffer ||
      !this.baseTexture ||
      !this.maskTexture ||
      !this.floatingTexture ||
      !this.overlayTexture
    ) {
      return false;
    }

    gl.bindVertexArray(this.imageVao);
    const quadBuffer = gl.createBuffer();
    if (!quadBuffer) return false;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(this.imageProgram, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
    const aLine = gl.getAttribLocation(this.lineProgram, "a_pos");
    gl.enableVertexAttribArray(aLine);
    gl.vertexAttribPointer(aLine, 2, gl.FLOAT, false, 0, 0);

    initTexture(gl, this.baseTexture);
    initTexture(gl, this.maskTexture);
    initTexture(gl, this.floatingTexture);
    initTexture(gl, this.overlayTexture);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    return true;
  }
}

function initTexture(gl: WebGL2RenderingContext, tex: WebGLTexture): void {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function ndcRect(x: number, y: number, w: number, h: number, viewportW: number, viewportH: number): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: toNdcX(x, viewportW),
    y0: toNdcY(y, viewportH),
    x1: toNdcX(x + w, viewportW),
    y1: toNdcY(y + h, viewportH),
  };
}

function toNdcX(x: number, viewportW: number): number {
  return (x / viewportW) * 2 - 1;
}

function toNdcY(y: number, viewportH: number): number {
  return 1 - (y / viewportH) * 2;
}

function createShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext, vertSrc: string, fragSrc: string): WebGLProgram | null {
  const vert = createShader(gl, gl.VERTEX_SHADER, vertSrc);
  const frag = createShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  if (!vert || !frag) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

const IMAGE_VERT = `#version 300 es
in vec2 a_pos;
uniform vec4 u_rectNdc;
out vec2 v_uv;
void main() {
  float x = mix(u_rectNdc.x, u_rectNdc.z, a_pos.x);
  float y = mix(u_rectNdc.y, u_rectNdc.w, a_pos.y);
  gl_Position = vec4(x, y, 0.0, 1.0);
  v_uv = a_pos;
}
`;

const IMAGE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform sampler2D u_selMask;
uniform int u_hideSelected;
out vec4 outColor;
void main() {
  vec4 color = texture(u_tex, v_uv);
  if (u_hideSelected == 1) {
    float m = texture(u_selMask, v_uv).r;
    if (m > 0.5) {
      color = vec4(0.0);
    }
  }
  outColor = color;
}
`;

const LINE_VERT = `#version 300 es
in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const LINE_FRAG = `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 outColor;
void main() {
  outColor = u_color;
}
`;
