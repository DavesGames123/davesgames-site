// ============================================================================
//  MUSHROOM DRAW  ·  engine/path.js — a meridian path with arc-length reads
// ----------------------------------------------------------------------------
//  Original code (davesgames.io). No DOM. makePath(pts) takes [r, h]
//  points and stores the arc length and the slopes. readPath(P, u)
//  reads the path at the arc-length fraction u. capShape() in engine.js
//  builds the cap top and the underside with these.
//
//  GREP MAP
//    grep -n 'export function makePath'   a path from [r, h] points
//    grep -n 'export function readPath'   a linear read at arc-length fraction u
// ============================================================================

export function makePath(pts) {
  const n = pts.length, r = new Float64Array(n), h = new Float64Array(n), s = new Float64Array(n);
  for (let i = 0; i < n; i++) { r[i] = pts[i][0]; h[i] = pts[i][1]; if (i) s[i] = s[i - 1] + Math.hypot(r[i] - r[i - 1], h[i] - h[i - 1]); }
  const L = s[n - 1] || 1;
  for (let i = 0; i < n; i++) s[i] /= L;
  const dr = new Float64Array(n), dh = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1), ds = (s[b] - s[a]) || 1e-6;
    dr[i] = (r[b] - r[a]) / ds; dh[i] = (h[b] - h[a]) / ds;
  }
  return { n, r, h, s, dr, dh, L };
}
// Linear read of a path at arc-length fraction u: [r, h, dr/du, dh/du].
export function readPath(P, u) {
  const s = P.s;
  if (u <= 0) return [P.r[0], P.h[0], P.dr[0], P.dh[0]];
  if (u >= 1) { const k = P.n - 1; return [P.r[k], P.h[k], P.dr[k], P.dh[k]]; }
  let lo = 0, hi = P.n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m] <= u) lo = m; else hi = m; }
  const t = (u - s[lo]) / ((s[hi] - s[lo]) || 1e-9);
  return [P.r[lo] + (P.r[hi] - P.r[lo]) * t, P.h[lo] + (P.h[hi] - P.h[lo]) * t, P.dr[lo] + (P.dr[hi] - P.dr[lo]) * t, P.dh[lo] + (P.dh[hi] - P.dh[lo]) * t];
}
