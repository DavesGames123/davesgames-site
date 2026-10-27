// ============================================================================
//  ULAM SPIRAL  ·  app/camera.js — 2D and 3D camera maths
// ----------------------------------------------------------------------------
//  No DOM. 2D: cam = { x, y, z }: the world point at the centre of the
//  clear area and the CSS px per world unit (one lattice cell = 1 unit).
//  3D: cam3 = { yaw, pitch, dist, tx, ty, tz }, orbit around (tx, ty, tz).
//  A view v = { w, h, cx, cy, cw, ch } comes from view.js; the defaults of
//  toWorld, toScreen and worldRect are the last view (rt.VW) and S.cam.
//
//  GREP MAP
//    grep -n 'export const toWorld'      screen px -> world (and toScreen)
//    grep -n 'export function cam3Mats'  orbit camera -> mvp and focal
//    grep -n 'export function project3'  a world point -> screen px
//    grep -n 'export function worldRect' the world rectangle of the canvas
//    grep -n 'export function cellRect'  the lattice cells under a rectangle
// ============================================================================
import * as L from '../layouts.js';
import { S, rt } from './state.js';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeIO = t => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
export const is3D = s => s.kind === '3d';

export const toWorld = (sx, sy, v = rt.VW, c = S.cam) => [c.x + (sx - v.cx) / c.z, c.y - (sy - v.cy) / c.z];
export const toScreen = (wx, wy, v = rt.VW, c = S.cam) => [v.cx + (wx - c.x) * c.z, v.cy - (wy - c.y) * c.z];

// --- 3D matrices ---------------------------------------------------------------------
function mul4(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; }
  return o;
}
export const FOV = 0.8;
export function cam3Mats(c3, v) {
  const cp = Math.cos(c3.pitch), eye = [c3.tx + c3.dist * cp * Math.cos(c3.yaw), c3.ty + c3.dist * cp * Math.sin(c3.yaw), c3.tz + c3.dist * Math.sin(c3.pitch)];
  const f = [c3.tx - eye[0], c3.ty - eye[1], c3.tz - eye[2]], fl = Math.hypot(...f); f.forEach((_, i) => { f[i] /= fl; });
  let s = [f[1] * 1 - f[2] * 0, f[2] * 0 - f[0] * 1, 0]; const sl = Math.hypot(...s) || 1; s = s.map(x => x / sl);
  const u = [s[1] * f[2] - s[2] * f[1], s[2] * f[0] - s[0] * f[2], s[0] * f[1] - s[1] * f[0]];
  const V = new Float32Array([s[0], u[0], -f[0], 0, s[1], u[1], -f[1], 0, s[2], u[2], -f[2], 0,
    -(s[0] * eye[0] + s[1] * eye[1] + s[2] * eye[2]), -(u[0] * eye[0] + u[1] * eye[1] + u[2] * eye[2]), f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2], 1]);
  const near = Math.max(0.05, c3.dist * 0.01), far = c3.dist * 30 + 1000, t = 1 / Math.tan(FOV / 2), asp = v.w / v.h;
  const Pm = new Float32Array([t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0]);
  const ox = 2 * v.cx / v.w - 1, oy = 1 - 2 * v.cy / v.h;
  const O = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ox, oy, 0, 1]);
  const mvp = mul4(O, mul4(Pm, V));
  return { mvp, focal: v.h * rt.dpr / (2 * Math.tan(FOV / 2)) };
}
export function project3(mvp, p, v) {
  const x = mvp[0] * p[0] + mvp[4] * p[1] + mvp[8] * p[2] + mvp[12], y = mvp[1] * p[0] + mvp[5] * p[1] + mvp[9] * p[2] + mvp[13];
  const w = mvp[3] * p[0] + mvp[7] * p[1] + mvp[11] * p[2] + mvp[15];
  if (w <= 0) return null;
  return [(x / w * 0.5 + 0.5) * v.w, (0.5 - y / w * 0.5) * v.h, w];
}

// --- the visible region ----------------------------------------------------------------
// The world rectangle of the canvas (2D).
export function worldRect(v = rt.VW, c = S.cam) {
  const [x0, y1] = toWorld(0, 0, v, c), [x1, y0] = toWorld(v.w, v.h, v, c);
  return [x0, y0, x1, y1];
}
// The lattice cells under the canvas: [i0, j0, i1, j1] (axial for hex).
export function cellRect(shape, r) {
  if (shape.kind !== 'hex') return [Math.floor(r[0] - 0.5), Math.floor(r[1] - 0.5), Math.ceil(r[2] + 0.5), Math.ceil(r[3] + 0.5)];
  const rr0 = Math.floor(r[1] / L.SQ3) - 1, rr1 = Math.ceil(r[3] / L.SQ3) + 1;
  const q0 = Math.floor(r[0] - rr1 / 2) - 1, q1 = Math.ceil(r[2] - rr0 / 2) + 1;
  return [q0, rr0, q1, rr1];
}
