// ============================================================================
//  PHOTON CAUSTICS 2D  ·  render2d.js — the 2D view in WebGL2
// ----------------------------------------------------------------------------
//  Input: the segments from optics2d.trace (x0 y0 x1 y1 r g b).
//
//  LIGHT IMAGE. Each segment is one GL line (one pixel wide) added into a
//  float target `hist`. A pixel so gets the power of each photon that goes
//  through it: the ray density, which is the fluence. Each frame first
//  scales hist by (1 - a), then adds the new lines times a. That is a
//  running mean of the frames:
//    a = 1 / frame number, down to A_MIN, for a still scene (it converges)
//    a = A_LIVE for a scene that moves (waves, marbles) or a moving camera
//  GL draws a line one pixel per step on its long axis, so a slant line
//  puts less power per unit length. Each line gets the factor
//  length / max(|dx|, |dy|) in pixels to remove that.
//
//  SCALE. The gain makes the open beam read 1: N photons across a beam W
//  world units wide, at s device px per unit, cross one pixel N / (W s)
//  times, so each line adds W s / N.
//
//  DISPLAY. Tone map 1 - exp(-0.04 k E), so the open beam is dim and a
//  caustic (20 times the open beam and more) is bright. Then the sRGB curve, on a dark ground.
//  Over it, with alpha: glass and water fills, outlines, mirrors as thick
//  strips, and the detector curve (irradiance along the floor or screen).
//
//  FLIGHT. Last, the photons in flight (flight.js): soft strips and discs
//  added on top (blend ONE, ONE), so where many photons cross, it is bright.
//
//  EXPORTS
//    createRender2D(gl, caps) -> { resize, reset, draw, frames }
//  draw(o): o = { scene, segs, ns, view, exposure, live, outline,
//                 curve, curves, fade, geom, flight, hold }
//    curves = [{ pts, color: [r, g, b, a, width px] } or { tris, color }]
//           more polylines and fills (the plot of the pool cross-section)
//    hold: true to show the light image again with no new photons
//    flight = { verts, count }  from flight.js build()
//    view = { cx, cy, s, px, py }  world point (cx, cy) shows at device
//           pixel (px, py), s device px per world unit
// ============================================================================
import { program, target, drawFull, FULL_VS } from './gl.js';

const A_MIN = 0.012, A_LIVE = 0.22;

const LINE_VS = `#version 300 es
layout(location=0) in vec2 a_pos; layout(location=1) in vec3 a_col;
uniform vec4 u_view; uniform vec2 u_c;
out vec3 v_col;
void main(){ v_col = a_col; gl_Position = vec4((a_pos - u_c) * u_view.xy + u_view.zw, 0.0, 1.0); }`;
const LINE_FS = `#version 300 es
precision highp float;
in vec3 v_col; uniform float u_gain; out vec4 o;
void main(){ o = vec4(v_col * u_gain, 1.0); }`;

const SCALE_FS = `#version 300 es
precision mediump float; out vec4 o;
void main(){ o = vec4(0.0); }`;

const SHOW_FS = `#version 300 es
precision highp float;
in vec2 v_uv; uniform sampler2D u_hist; uniform float u_exp, u_fade; out vec4 o;
vec3 srgb(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main(){
  vec3 E = max(texture(u_hist, v_uv).rgb, 0.0);
  vec3 c = 1.0 - exp(-0.04 * u_exp * E);
  vec3 bg = vec3(0.012, 0.016, 0.026);
  o = vec4(srgb(bg + c) * u_fade, 1.0);
}`;

const GEOM_VS = `#version 300 es
layout(location=0) in vec2 a_pos; uniform vec4 u_view; uniform vec2 u_c;
void main(){ gl_Position = vec4((a_pos - u_c) * u_view.xy + u_view.zw, 0.0, 1.0); }`;
const GEOM_FS = `#version 300 es
precision mediump float; uniform vec4 u_color; out vec4 o;
void main(){ o = vec4(u_color.rgb * u_color.a, u_color.a); }`;

const FLY_VS = `#version 300 es
layout(location=0) in vec2 a_pos; layout(location=1) in vec4 a_col; layout(location=2) in vec2 a_q;
uniform vec4 u_view; uniform vec2 u_c;
out vec4 v_col; out vec2 v_q;
void main(){ v_col = a_col; v_q = a_q; gl_Position = vec4((a_pos - u_c) * u_view.xy + u_view.zw, 0.0, 1.0); }`;
const FLY_FS = `#version 300 es
precision mediump float;
in vec4 v_col; in vec2 v_q; uniform float u_fade; out vec4 o;
void main(){
  float a = v_col.a * (1.0 - smoothstep(0.35, 1.0, length(v_q))) * u_fade;
  o = vec4(v_col.rgb * a, a);
}`;

const STYLE = {
  fill: { glass: [0.55, 0.75, 1.0, 0.07], water: [0.15, 0.45, 0.8, 0.10] },
  line: { glass: [0.7, 0.85, 1.0, 0.42, 1.2], water: [0.55, 0.8, 1.0, 0.5, 1.4], mirror: [0.88, 0.9, 0.95, 0.9, 3.0],
          wall: [0.45, 0.48, 0.55, 0.6, 2.0], detector: [0.62, 0.58, 0.5, 0.7, 2.0] },
  curve: [1.0, 0.86, 0.6, 0.85, 1.6],
};

export function createRender2D(gl, caps) {
  const pLine = program(gl, LINE_VS, LINE_FS), pScale = program(gl, FULL_VS, SCALE_FS);
  const pShow = program(gl, FULL_VS, SHOW_FS), pGeom = program(gl, GEOM_VS, GEOM_FS), pFly = program(gl, FLY_VS, FLY_FS);
  const lineVao = gl.createVertexArray(), lineBuf = gl.createBuffer();
  gl.bindVertexArray(lineVao); gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 20, 8);
  const geomVao = gl.createVertexArray(), geomBuf = gl.createBuffer();
  gl.bindVertexArray(geomVao); gl.bindBuffer(gl.ARRAY_BUFFER, geomBuf);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
  const flyVao = gl.createVertexArray(), flyBuf = gl.createBuffer();
  gl.bindVertexArray(flyVao); gl.bindBuffer(gl.ARRAY_BUFFER, flyBuf);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 32, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 8);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
  gl.bindVertexArray(null);

  let hist = null, W = 0, H = 0, verts = new Float32Array(0), frames = 0;
  const api = {
    get frames() { return frames; },
    resize(w, h) {
      if (w === W && h === H && hist) return;
      W = w; H = h; if (hist) hist.free();
      hist = target(gl, W, H, caps, gl.NEAREST); frames = 0;
    },
    reset() {
      if (!hist) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, hist.fbo); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); frames = 0;
    },
    draw(o) {
      const v = o.view, sx = 2 * v.s / W, sy = 2 * v.s / H, ox = 2 * v.px / W - 1, oy = 1 - 2 * v.py / H;
      // repack the segments to vertices, with the slant factor
      const ns = o.ns;
      if (verts.length < ns * 10) verts = new Float32Array(Math.ceil(ns * 1.3) * 10);
      for (let i = 0; i < ns; i++) {
        const k = i * 7, j = i * 10, g = o.segs;
        const ddx = Math.abs(g[k + 2] - g[k]), ddy = Math.abs(g[k + 3] - g[k + 1]), m = Math.max(ddx, ddy);
        const f = m > 0 ? Math.hypot(ddx, ddy) / m : 1;
        verts[j] = g[k]; verts[j + 1] = g[k + 1]; verts[j + 2] = g[k + 4] * f; verts[j + 3] = g[k + 5] * f; verts[j + 4] = g[k + 6] * f;
        verts[j + 5] = g[k + 2]; verts[j + 6] = g[k + 3]; verts[j + 7] = verts[j + 2]; verts[j + 8] = verts[j + 3]; verts[j + 9] = verts[j + 4];
      }
      gl.viewport(0, 0, W, H);
      // o.hold: a converged image, shown again with no new photons
      if (!o.hold) {
        frames++;
        const a = o.live ? A_LIVE : Math.max(A_MIN, 1 / frames);
        gl.bindFramebuffer(gl.FRAMEBUFFER, hist.fbo);
        gl.enable(gl.BLEND);
        // hist *= (1 - a)
        gl.blendColor(0, 0, 0, 1 - a); gl.blendFunc(gl.ZERO, gl.CONSTANT_ALPHA);
        gl.useProgram(pScale); drawFull(gl);
        // hist += a * lines
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(pLine);
        gl.uniform4f(pLine.u.u_view, sx, sy, ox, oy); gl.uniform2f(pLine.u.u_c, v.cx, v.cy);
        gl.uniform1f(pLine.u.u_gain, a * o.gain);
        gl.bindVertexArray(lineVao); gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
        gl.bufferData(gl.ARRAY_BUFFER, verts.subarray(0, ns * 10), gl.STREAM_DRAW);
        gl.drawArrays(gl.LINES, 0, ns * 2);
      }
      // show
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.BLEND);
      gl.useProgram(pShow);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, hist.tex);
      gl.uniform1i(pShow.u.u_hist, 0); gl.uniform1f(pShow.u.u_exp, o.exposure); gl.uniform1f(pShow.u.u_fade, o.fade ?? 1);
      drawFull(gl);
      if (o.geom !== false && o.outline) {
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(pGeom);
        gl.uniform4f(pGeom.u.u_view, sx, sy, ox, oy); gl.uniform2f(pGeom.u.u_c, v.cx, v.cy);
        gl.bindVertexArray(geomVao); gl.bindBuffer(gl.ARRAY_BUFFER, geomBuf);
        const fade = o.fade ?? 1;
        const put = (tris, c) => {
          gl.uniform4f(pGeom.u.u_color, c[0], c[1], c[2], c[3] * fade);
          gl.bufferData(gl.ARRAY_BUFFER, tris, gl.STREAM_DRAW); gl.drawArrays(gl.TRIANGLES, 0, tris.length / 2);
        };
        for (const f of o.outline.fills) put(f.f32 || (f.f32 = new Float32Array(f.tris)), STYLE.fill[f.kind]);
        for (const l of o.outline.lines) { const c = STYLE.line[l.kind]; put(strip(l.pts, c[4] * (v.dpr || 1) / v.s), c); }
        if (o.curve) put(strip(o.curve, STYLE.curve[4] * (v.dpr || 1) / v.s), STYLE.curve);
        for (const c of o.curves || []) put(c.tris ? new Float32Array(c.tris) : strip(c.pts, c.color[4] * (v.dpr || 1) / v.s), c.color);
        if (o.marker) { const c = [1, 0.95, 0.8, 0.95]; put(disc(o.marker[0], o.marker[1], 4 * (v.dpr || 1) / v.s), c); }
        gl.disable(gl.BLEND);
      }
      if (o.flight && o.flight.count) {
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(pFly);
        gl.uniform4f(pFly.u.u_view, sx, sy, ox, oy); gl.uniform2f(pFly.u.u_c, v.cx, v.cy); gl.uniform1f(pFly.u.u_fade, o.fade ?? 1);
        gl.bindVertexArray(flyVao); gl.bindBuffer(gl.ARRAY_BUFFER, flyBuf);
        gl.bufferData(gl.ARRAY_BUFFER, o.flight.verts.subarray(0, o.flight.count * 8), gl.STREAM_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, o.flight.count);
        gl.disable(gl.BLEND);
      }
      gl.bindVertexArray(null);
    },
  };
  return api;
}

// A polyline as a strip of triangles w world units wide (miter-free: each
// part is its own quad, with a round-free joint; at these widths it does
// not show).
function strip(pts, w) {
  const n = pts.length / 2 - 1, out = new Float32Array(Math.max(0, n) * 12), h = w / 2;
  for (let i = 0; i < n; i++) {
    const x0 = pts[2 * i], y0 = pts[2 * i + 1], x1 = pts[2 * i + 2], y1 = pts[2 * i + 3];
    let dx = x1 - x0, dy = y1 - y0; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    const nx = -dy * h, ny = dx * h, ex = dx * h * 0.5, ey = dy * h * 0.5, k = i * 12;
    out.set([x0 + nx - ex, y0 + ny - ey, x1 + nx + ex, y1 + ny + ey, x0 - nx - ex, y0 - ny - ey,
             x1 + nx + ex, y1 + ny + ey, x1 - nx + ex, y1 - ny + ey, x0 - nx - ex, y0 - ny - ey], k);
  }
  return out;
}
function disc(x, y, r) {
  const out = [];
  for (let i = 0; i < 20; i++) {
    const a0 = i / 20 * Math.PI * 2, a1 = (i + 1) / 20 * Math.PI * 2;
    out.push(x, y, x + r * Math.cos(a0), y + r * Math.sin(a0), x + r * Math.cos(a1), y + r * Math.sin(a1));
  }
  return new Float32Array(out);
}
