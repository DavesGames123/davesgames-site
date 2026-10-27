// ============================================================================
//  ULAM SPIRAL  ·  app/framing.js — what a camera shows, and home views
// ----------------------------------------------------------------------------
//  The world box of a run of numbers, a 2D camera that fits a box, the
//  home cameras of each shape (2D and 3D), the point count of a 3D view
//  and the n range under a 2D view. Read by the morph, the walk, the
//  thumbnails, the minimap, the tiles and saver.js (app.bboxOf, ...).
//
//  GREP MAP
//    grep -n 'export function bboxOf'     the world box of n in [n0, n1]
//    grep -n 'export function fitCam'     a camera that fits a box
//    grep -n 'export function homeCount'  how many numbers the home view shows
//    grep -n 'export function homeCam'    the 2D home camera (and home3)
//    grep -n 'export function n3Count'    the point count of a 3D view
//    grep -n 'export function nSpan'      the n range under a 2D view
// ============================================================================
import * as L from '../layouts.js';
import { S, rt } from './state.js';
import { clamp, lerp, worldRect } from './camera.js';
import { view } from './view.js';

export const startOf = () => L.startOf(S.shape, S.P);

// The world bounding box of n in [n0, n1], from samples.
export function bboxOf(shape, n0, n1, samples = 600) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = n => {
    const p = L.posOf(shape, n, S.P); if (!p) return;
    const [x, y] = L.isLattice(shape) ? L.worldOf(shape, p[0], p[1]) : p;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  };
  const span = Math.max(1, n1 - n0);
  for (let i = 0; i <= samples; i++) add(n0 + Math.round(span * Math.sqrt(i / samples)));
  for (let i = 0; i < 64; i++) add(n1 - i);
  return [x0, y0, x1, y1];
}
// A 2D camera that fits the box in the clear area (fill: fraction used).
export function fitCam(b, fill = 0.9, v = rt.VW || view()) {
  const w = Math.max(1, b[2] - b[0] + 1), h = Math.max(1, b[3] - b[1] + 1);
  return { x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2, z: clamp(fill * Math.min(v.cw / w, v.ch / h), 1e-4, 400) };
}
export function homeCount(shape) {
  if (shape.key === 'rows' || shape.key === 'snake') return S.P.w * Math.max(40, Math.round(S.P.w * 0.75));
  if (shape.key === 'hilbert' || shape.key === 'zorder') return 65536;
  if (shape.key === 'cantor') return 20000;
  if (shape.key === 'archi') return S.P.w * 60;
  return 40000;
}
export function homeCam(shape = S.shape) {
  const st = L.startOf(shape, S.P);
  return fitCam(bboxOf(shape, st, st + homeCount(shape)), 0.92);
}
export function home3(shape = S.shape) {
  if (shape.key === 'helix') { const Hh = 120; return { yaw: -0.6, pitch: 0.25, dist: Hh * 1.25, tx: 0, ty: 0, tz: Hh / 2 }; }
  if (shape.key === 'pyramid') return { yaw: -0.8, pitch: 0.62, dist: 230, tx: 0, ty: 0, tz: -25 };
  return { yaw: -0.8, pitch: 0.55, dist: 300, tx: 0, ty: 0, tz: -60 };
}
export function n3Count(shape, c3) {
  if (shape.key === 'helix') return Math.min(1500000, Math.round(S.P.w * c3.dist * 1.6));
  if (shape.key === 'pyramid') return Math.min(1500000, Math.round((c3.dist * 0.9) ** 2));
  return Math.min(1500000, Math.round((c3.dist * 0.75) ** 2));
}

// The largest and smallest n in the view, from a grid of samples.
export function nSpan(shape = S.shape, v = rt.VW, c = S.cam) {
  const r = worldRect(v, c);
  let lo = Infinity, hi = -Infinity, far = 0;
  const G = 14;
  for (let i = 0; i <= G; i++) for (let j = 0; j <= G; j++) {
    const wx = lerp(r[0], r[2], i / G), wy = lerp(r[1], r[3], j / G);
    const [cx, cy] = L.cellAt(shape, wx, wy);
    far = Math.max(far, Math.abs(cx), Math.abs(cy));
    const n = L.nAt(shape, S.P, cx, cy);
    if (n >= 0) { lo = Math.min(lo, n); hi = Math.max(hi, n); }
  }
  return { lo, hi, far };
}
