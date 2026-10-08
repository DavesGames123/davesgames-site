// ============================================================================
//  ROCHE LIMIT  ·  app/lines.js — line overlays
// ----------------------------------------------------------------------------
//  buildSegments() fills segs with the line segments of the frame:
//  the limit circles, the paths, the track and the drag arrow.
//  drawFrame() gives segs and segN to the renderer.
//
//  grep -n targets
//    segment buffer .... "let segs"
//    one segment ....... "function seg("
//    circle ............ "function circle"
//    all lines ......... "function buildSegments"
// ============================================================================
import * as P from '../physics.js';
import { norm, cross } from '../render.js';
import { limitsFor } from './runs.js';
import { UI } from './env.js';
import { satCentre, satState } from './sat.js';
import { S } from './state.js';

export let segs = new Float32Array(16 * 8192), segN = 0;
function seg(a, b, ca, cb, w) {
  if (segN >= 8192) return;
  const o = segN++ * 16;
  segs[o] = a[0]; segs[o + 1] = a[1]; segs[o + 2] = a[2]; segs[o + 3] = w;
  segs[o + 4] = b[0]; segs[o + 5] = b[1]; segs[o + 6] = b[2];
  segs.set(ca, o + 8); segs.set(cb, o + 12);
}
function circle(c, r, col, w, dash = 0, n = 192) {
  for (let i = 0; i < n; i++) {
    if (dash && (i % 4) >= 2) continue;
    const a0 = 2 * Math.PI * i / n, a1 = 2 * Math.PI * (i + 1) / n;
    seg([c[0] + r * Math.cos(a0), c[1] + r * Math.sin(a0), c[2]], [c[0] + r * Math.cos(a1), c[1] + r * Math.sin(a1), c[2]], col, col, w);
  }
}
function hex(h, a) { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, a]; }
// The Roche limit (fluid) bright, the solid-moon limit faint, the path
// ahead, the past track, the drag arrow on the moon while the drag is on,
// and (paused only) short paths of shed grains.
export function buildSegments(dpr) {
  segN = 0;
  const s0 = S.run.sats[0], L = S.run.limits || limitsFor(S.run.spec);
  const W = 1.6 * dpr;
  if (UI.rings) {
    circle([0, 0, 0], L.fluid, hex('#ff7a59', 0.8), W, 0, 256);
    circle([0, 0, 0], L.rigid, hex('#9aa6b8', 0.35), W * 0.7, 1);
  }
  if (S.run.phase !== 'orbit') return;
  for (const s of S.run.sats) {
    const c = satCentre(s);
    if (UI.hill && s.an && s.an.live && Number.isFinite(s.an.rH)) circle(c, s.an.rH * s.k, [1, 1, 1, 0.45], W * 0.8, 1, 96);
    if (UI.pred && (!s.an || s.an.live)) {
      const st = satState(s);
      const T = S.run.spec.kind === 'flyby' ? 2.5 * S.run.T0 : 0.6 * S.run.T0;
      const pts = P.keplerPath(st.r, st.v, s.pl.GM, T, 120).pts;
      for (let i = 0; i < 119; i++) {
        const a0 = 0.55 * (1 - i / 119), a1 = 0.55 * (1 - (i + 1) / 119);
        seg([pts[3 * i] * s.k, pts[3 * i + 1] * s.k, pts[3 * i + 2] * s.k], [pts[3 * i + 3] * s.k, pts[3 * i + 4] * s.k, pts[3 * i + 5] * s.k], [1, 0.95, 0.85, a0], [1, 0.95, 0.85, a1], W * 0.8);
      }
    }
    if (UI.pred && UI.paused && !S.saverOn) {
      for (const fp of s.frag) {
        for (let i = 0; i < 23; i++) {
          const a0 = 0.32 * (1 - i / 23), a1 = 0.32 * (1 - (i + 1) / 23);
          seg([fp[3 * i] * s.k, fp[3 * i + 1] * s.k, fp[3 * i + 2] * s.k], [fp[3 * i + 3] * s.k, fp[3 * i + 4] * s.k, fp[3 * i + 5] * s.k], [0.55, 0.85, 1, a0], [0.55, 0.85, 1, a1], W * 0.55);
        }
      }
    }
    // the drag: an arrow against the motion, from the moon's edge
    if (s.pl.drag > 0 && (!s.an || s.an.live)) {
      const st = satState(s), v = norm(st.v), Rw = (s.Rs || s.C.Rs) * s.k;
      const a = [0, 1, 2].map(i => c[i] - v[i] * 1.3 * Rw), b = [0, 1, 2].map(i => c[i] - v[i] * (1.3 * Rw + 0.32));
      const col = [1, 0.62, 0.3, 0.85];
      seg(a, b, col, col, W * 1.1);
      const sd = norm(cross(v, [0, 0, 1]));
      for (const sg of [1, -1]) seg(b, [0, 1, 2].map(i => b[i] + v[i] * 0.07 + sd[i] * sg * 0.045), col, col, W * 1.1);
    }
  }
  if (UI.track && S.run.track.length > 1) {
    const tr = S.run.track, n = tr.length;
    for (let i = 1; i < n; i++) { const a = 0.45 * i / n; seg(tr[i - 1], tr[i], [1, 0.75, 0.35, a * 0.9], [1, 0.75, 0.35, a], W * 0.8); }
    if (s0.an && s0.an.live) seg(tr[n - 1], satCentre(s0), [1, 0.75, 0.35, 0.45], [1, 0.75, 0.35, 0.45], W * 0.8);
  }
}
