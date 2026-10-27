// ============================================================================
//  LENIA  ·  app/saver/grid.js — the saver tracker grid and seeded random
// ----------------------------------------------------------------------------
//  engine.stats() gives one centroid for all cells, which is the empty space
//  between two copies. The saver director reads the world into a grid of
//  B x B blocks and finds one creature near a point (gridCentroid) or one
//  point per creature (gridPeaks). mulberry() is the seeded random source
//  of the scene order, the shots and the stamps. No DOM, no GPU.
//
//  GREP MAP
//    function mulberry       seeded random in 0..1
//    function saverGrid      world -> block mass and mass-weighted x, y
//    function gridCentroid   torus centroid of the blocks near a point
//    function gridPeaks      one point per creature, near enough
// ============================================================================
import { wrap, wrapDelta } from '../torus.js';

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// The world as blocks of B x B cells: mass and mass-weighted x, y per block.
export function saverGrid(A, W, H, B) {
  const gw = Math.ceil(W / B), gh = Math.ceil(H / B);
  const m = new Float32Array(gw * gh), mx = new Float32Array(gw * gh), my = new Float32Array(gw * gh);
  for (let y = 0; y < H; y++) {
    const row = y * W, gy = ((y / B) | 0) * gw;
    for (let x = 0; x < W; x++) {
      const a = A[row + x];
      if (a < 0.02) continue;
      const g = gy + ((x / B) | 0);
      m[g] += a; mx[g] += a * x; my[g] += a * y;
    }
  }
  return { gw, gh, B, W, H, m, mx, my };
}
// The torus centroid of the blocks within rad cells of p, or null if empty.
export function gridCentroid(g, p, rad) {
  let M = 0, X = 0, Y = 0;
  const n = Math.ceil(rad / g.B);
  const bx = Math.floor(p.x / g.B), by = Math.floor(p.y / g.B);
  for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
    const k = wrap(by + j, g.gh) * g.gw + wrap(bx + i, g.gw), mk = g.m[k];
    if (mk <= 0) continue;
    const dx = wrapDelta(g.mx[k] / mk - p.x, g.W), dy = wrapDelta(g.my[k] / mk - p.y, g.H);
    if (dx * dx + dy * dy > rad * rad) continue;
    M += mk; X += mk * dx; Y += mk * dy;
  }
  return M > 1e-3 ? { x: wrap(p.x + X / M, g.W), y: wrap(p.y + Y / M, g.H), m: M } : null;
}
// Points with mass: the blocks whose 3 x 3 sum is a local maximum above a
// quarter of the largest. One point per creature, near enough.
export function gridPeaks(g) {
  const s = new Float32Array(g.m.length);
  let top = 0;
  for (let y = 0; y < g.gh; y++) for (let x = 0; x < g.gw; x++) {
    let v = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) v += g.m[wrap(y + j, g.gh) * g.gw + wrap(x + i, g.gw)];
    s[y * g.gw + x] = v; top = Math.max(top, v);
  }
  const out = [];
  for (let y = 0; y < g.gh; y++) for (let x = 0; x < g.gw; x++) {
    const v = s[y * g.gw + x];
    if (v < top * 0.25) continue;
    let max = true;
    for (let j = -2; j <= 2 && max; j++) for (let i = -2; i <= 2; i++) {
      if ((i || j) && s[wrap(y + j, g.gh) * g.gw + wrap(x + i, g.gw)] > v) { max = false; break; }
    }
    if (max) out.push({ x: (x + 0.5) * g.B, y: (y + 0.5) * g.B, v });
  }
  return out;
}
