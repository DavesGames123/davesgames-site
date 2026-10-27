// ============================================================================
//  ULAM SPIRAL  ·  app/overlay.js — the 2D overlay canvas (#ov)
// ----------------------------------------------------------------------------
//  Drawn from the same camera as the GL canvas, once a frame (main.js
//  loop) and by saver.js (app.drawOverlay): the densest diagonals and
//  their quadratics, the number labels of the lattice and point shapes,
//  the hover and selection rings, then S.overlayHook (the saver plates).
//
//  GREP MAP
//    grep -n 'export function drawOverlay'  labels, diagonals, rings
//    grep -n 'function drawRays'            a glowing line and its quadratic
//    grep -n 'export function computeRays'  rank the diagonals (diagonals.js)
// ============================================================================
import * as T from '../numtheory.js';
import * as L from '../layouts.js';
import { densestRays } from '../diagonals.js';
import { S, rt } from './state.js';
import { oc } from './dom.js';
import { clamp, lerp, is3D, toScreen, worldRect, cellRect } from './camera.js';
import { startOf } from './framing.js';
import { frameState } from './frame.js';
import { gaussText, eisenText } from './format.js';
import { isPrimeN } from './numbers.js';

export function drawOverlay(v, ctx = oc, scale = rt.dpr) {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, v.w, v.h);
  const sh = S.shape;
  if (S.morph || is3D(sh)) { if (S.overlayHook) S.overlayHook(ctx, v); return; }
  const c = S.cam;
  // diagonals
  if (S.diag && S.rays.length && (sh.key === 'square' || sh.key === 'klauber')) drawRays(ctx, v);
  // labels
  const cellPx = c.z;
  if (S.labels && L.isLattice(sh) && cellPx >= 24) {
    const cr = cellRect(sh, worldRect(v));
    const count = (cr[2] - cr[0] + 1) * (cr[3] - cr[1] + 1);
    if (count < 6000) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const st = startOf();
      for (let j = cr[1]; j <= cr[3]; j++) for (let i = cr[0]; i <= cr[2]; i++) {
        const n = L.nAt(sh, S.P, i, j);
        if (n < 0) continue;
        if (S.walk && n - st > S.walk.k) continue;
        const [wx, wy] = L.worldOf(sh, i, j), [sx, sy] = toScreen(wx, wy, v);
        if (sx < -cellPx || sy < -cellPx || sx > v.w + cellPx || sy > v.h + cellPx) continue;
        let txt;
        if (sh.lattice) { const [a, b] = L.latticeNumber(sh, i, j); txt = sh.lattice === 'gauss' ? gaussText(a, b) : eisenText(a, b); }
        else txt = String(n);
        const prime = sh.lattice ? false : isPrimeN(n);
        const fs = Math.min(cellPx * 0.34, cellPx * 0.86 / (0.58 * Math.max(2, txt.length)));
        if (fs < 5.5) continue;
        ctx.font = `${prime ? 600 : 400} ${fs.toFixed(1)}px Inter, system-ui, sans-serif`;
        ctx.fillStyle = prime ? 'rgba(6,10,22,0.92)' : 'rgba(205,214,232,0.5)';
        if (prime && S.style !== 0) ctx.fillStyle = 'rgba(255,255,255,0.96)';
        ctx.fillText(txt, sx, sy + (S.style === 0 ? 0 : S.dotR * cellPx + fs * 0.75));
      }
    }
  }
  if (S.labels && sh.kind === 'pt' && c.z >= 22) {
    const fsx = frameState(v);
    if (fsx.points && fsx.points.count < 5000) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (let n = fsx.points.n0; n < fsx.points.n0 + fsx.points.count; n++) {
        if (S.walk && n - startOf() > S.walk.k) continue;
        const p = L.posOf(sh, n, S.P); if (!p) continue;
        const [sx, sy] = toScreen(p[0], p[1], v);
        if (sx < -20 || sy < -20 || sx > v.w + 20 || sy > v.h + 20) continue;
        const prime = isPrimeN(n), fs = Math.min(13, c.z * 0.28);
        ctx.font = `${prime ? 600 : 400} ${fs.toFixed(1)}px Inter, system-ui, sans-serif`;
        ctx.fillStyle = prime ? 'rgba(255,255,255,0.92)' : 'rgba(205,214,232,0.42)';
        ctx.fillText(String(n), sx, sy + S.dotR * c.z + 2);
      }
    }
  }
  // hover and selection rings
  for (const h of [S.hover, S.sel]) {
    if (!h || h.n < 0 || !h.w) continue;
    const [sx, sy] = toScreen(h.w[0], h.w[1], v), r = Math.max(7, c.z * 0.62);
    ctx.strokeStyle = h === S.sel ? 'rgba(255,196,107,0.95)' : 'rgba(220,228,255,0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke();
  }
  if (S.overlayHook) S.overlayHook(ctx, v);
}
// The densest half-lines: a glowing line and its quadratic.
function drawRays(ctx, v) {
  const sh = S.shape, c = S.cam;
  ctx.save();
  ctx.lineCap = 'round';
  S.rays.forEach((r, i) => {
    const steps = Math.min(r.steps + r.t0, 4000);
    const p = q => (sh.key === 'square' ? L.orient(q[0], q[1], S.P) : q);
    const a = p(r.start), b = p([r.start[0] + r.d[0] * steps, r.start[1] + r.d[1] * steps]);
    const [ax, ay] = toScreen(a[0], a[1], v), [bx, by] = toScreen(b[0], b[1], v);
    const hue = i === 0 ? '255,196,107' : '190,200,255';
    const g = ctx.createLinearGradient(ax, ay, bx, by);
    g.addColorStop(0, `rgba(${hue},0.75)`); g.addColorStop(1, `rgba(${hue},0.05)`);
    ctx.strokeStyle = g; ctx.lineWidth = Math.max(1.2, Math.min(5, c.z * 0.18));
    ctx.shadowColor = `rgba(${hue},0.8)`; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    // label inside the view, along the line
    const t = clamp(((v.cx - ax) * (bx - ax) + (v.cy - ay) * (by - ay)) / Math.max(1, (bx - ax) ** 2 + (by - ay) ** 2), 0.04, 0.8);
    const lx = lerp(ax, bx, t), ly = lerp(ay, by, t);
    if (lx > 10 && ly > 10 && lx < v.w - 10 && ly < v.h - 10) {
      ctx.shadowBlur = 0;
      ctx.font = '500 12px Inter, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      const txt = `${T.quadText(r.a, r.b, r.c0, 'm')}   ${r.ratio.toFixed(2)}×`;
      ctx.fillStyle = 'rgba(3,4,10,0.7)'; const tw = ctx.measureText(txt).width;
      ctx.fillRect(lx + 6, ly - 19, tw + 10, 18);
      ctx.fillStyle = `rgba(${hue},1)`; ctx.fillText(txt, lx + 11, ly - 4);
    }
  });
  ctx.restore();
}
export function computeRays() {
  S.rays = [];
  if (!S.bits || !(S.shape.key === 'square' || S.shape.key === 'klauber')) return;
  S.rays = densestRays({ C: 60, M: 700, start: S.P.start, prime: isPrimeN, shape: S.shape.key, top: 7 });
}
