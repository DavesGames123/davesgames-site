/*
Copyright 2021 Matthias Müller - Ten Minute Physics

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
// Pendulum in 100 Lines · upstream script 1, verbatim from Ten Minute Physics
// 06-pendulumShort.html by Matthias Müller. MIT License (notice kept above).
// ============================================================================
//  BILLIARD  ·  pages/billiard/sim.js — simulation and scene rules
// ----------------------------------------------------------------------------
//  UPSTREAM. Ten Minute Physics #03 "billiard" by Matthias Müller (MIT,
//  notice above): twenty balls of random size in a box, one explicit step
//  per frame, then handleBallCollision (push apart by half the overlap
//  each, exchange the normal velocity with restitution, by mass) and
//  handleWallCollision. Those are collideBalls() and walls() below.
//
//  OUR ADDITIONS (davesgames.io, not upstream): layouts (the upstream
//  random box, a pool break, a gas, two gases mixing, a Brownian
//  particle), a pool table with cushions and pockets, a round table,
//  bumpers, rolling friction, gravity, a spatial grid for many balls, the
//  cue shot, trails, the schema and random rules for the sim kit, and a
//  guard. No DOM.
//
//  grep -n targets: "export function makeSchema", "export function guard",
//  "export function buildScene", "function collideBalls", "function walls",
//  "export function step", "export function shoot"
// ============================================================================
import * as K from '../../widgets/sim-kit/core.js';

export const W = 2.4, H = 1.3;

export function makeSchema(PHONE) {
  return { groups: [
    { id: 'scene', label: 'Scene', hint: 'Drag back from a ball and let go to shoot it (the cue ball on a pool table).', controls: [
      { key: 'layout', type: 'choice', label: 'Layout', value: 'random', seg: false, options: [{ id: 'random', label: 'Random (upstream)' }, { id: 'break', label: 'Pool break' }, { id: 'gas', label: 'Gas' }, { id: 'mixing', label: 'Two gases mixing' }, { id: 'brownian', label: 'Brownian particle' }, { id: 'lattice', label: 'Lattice' }], rebuild: true, random: { weights: { random: 2, break: 2, gas: 2, mixing: 2, brownian: 2, lattice: 1 } } },
      { key: 'table', type: 'choice', label: 'Table', value: 'box', options: [{ id: 'box', label: 'Box' }, { id: 'pool', label: 'Pool table' }, { id: 'round', label: 'Round' }], rebuild: true, random: { weights: { box: 3, pool: 2, round: 1 } } },
      { key: 'count', type: 'range', label: 'Balls', min: 2, max: PHONE ? 200 : 400, step: 1, value: 20, rebuild: true, random: { dist: 'log', min: 8, max: PHONE ? 140 : 260 } },
      { key: 'rMin', type: 'range', label: 'Smallest ball', min: 0.01, max: 0.1, step: 0.005, value: 0.05, unit: 'm', rebuild: true, random: { min: 0.015, max: 0.06 } },
      { key: 'rMax', type: 'range', label: 'Largest ball', min: 0.015, max: 0.16, step: 0.005, value: 0.15, unit: 'm', rebuild: true, random: { min: 0.02, max: 0.1 } },
      { key: 'speed', type: 'range', label: 'Start speed', min: 0, max: 6, step: 0.1, value: 1, unit: 'm/s', rebuild: true, random: { min: 0.4, max: 3.5 } },
      { key: 'bumpers', type: 'range', label: 'Bumpers', min: 0, max: 8, step: 1, value: 0, rebuild: true, random: { dist: 'int', min: 0, max: 5 } },
      { type: 'buttons', key: 'act', label: 'Do', action: 'act', items: [{ id: 'break', label: 'Cue shot' }, { id: 'heat', label: 'Heat up' }, { id: 'cool', label: 'Cool down' }] },
    ] },
    { id: 'physics', label: 'Physics', controls: [
      { key: 'e', type: 'range', label: 'Restitution', min: 0, max: 1, step: 0.01, value: 1, random: { min: 0.75, max: 1 } },
      { key: 'eWall', type: 'range', label: 'Cushion bounce', min: 0.2, max: 1, step: 0.01, value: 1, random: { min: 0.7, max: 1 } },
      { key: 'roll', type: 'range', label: 'Rolling friction', min: 0, max: 1, step: 0.01, value: 0, unit: '1/s', random: { dist: 'normal', mean: 0, sd: 0.1, min: 0, max: 0.3 } },
      { key: 'g', type: 'range', label: 'Gravity', min: 0, max: 10, step: 0.1, value: 0, unit: 'm/s²', random: { dist: 'normal', mean: 0, sd: 1, min: 0, max: 4 } },
    ] },
    { id: 'look', label: 'Look', controls: [
      { key: 'colorBy', type: 'choice', label: 'Colour by', value: 'palette', seg: false, options: [{ id: 'palette', label: 'Palette' }, { id: 'speed', label: 'Speed' }, { id: 'mass', label: 'Mass' }, { id: 'side', label: 'Starting side' }, { id: 'pool', label: 'Pool balls' }], random: { weights: { palette: 2, speed: 3, mass: 1, side: 1 } } },
      { key: 'cmap', type: 'cmap', label: 'Colour map', value: 'inferno' },
      { key: 'trail', type: 'range', label: 'Trail', min: 0, max: 400, step: 5, value: 0, random: { dist: 'normal', mean: 20, sd: 40, min: 0, max: 200 } },
      { key: 'hist', type: 'toggle', label: 'Speed histogram', value: false, random: { p: 0.3 } },
      { key: 'shine', type: 'toggle', label: 'Shiny balls', value: true, random: { p: 0.8 } },
      K.themeControl('night'),
      K.paletteControl('toybox', { random: { pick: ['toybox', 'neon', 'sunset', 'harbour', 'pastel'], rnd: 0.3 } }),
    ] },
    { id: 'solver', label: 'Solver', open: false, random: false, controls: [
      { key: 'sub', type: 'range', label: 'Substeps per frame', min: 1, max: 16, step: 1, value: 4 },
      { type: 'note', text: 'Each substep: move every ball, resolve ball pairs (half the overlap each, exchange the normal velocity with restitution), then the walls (Ten Minute Physics #03). A grid finds the near pairs.' },
    ] },
  ] };
}
export const REBUILD = new Set(['layout', 'table', 'count', 'rMin', 'rMax', 'speed', 'bumpers']);

// Area check: the balls must fit (at most 40 % of the table area).
export function guard(next) {
  const s = Object.assign({}, next);
  if (s.layout === 'break') { s.table = s.table === 'round' ? 'pool' : s.table; s.count = Math.max(s.count, 16); }
  if (s.layout === 'brownian') { s.rMax = Math.min(s.rMax, 0.03); s.rMin = Math.min(s.rMin, s.rMax); }
  if (s.rMax < s.rMin) { const t = s.rMax; s.rMax = s.rMin; s.rMin = t; }
  const area = s.table === 'round' ? Math.PI * 0.6 * 0.6 : (W - 0.2) * (H - 0.2);
  const mean = s.count * Math.PI * ((s.rMin + s.rMax) / 2) ** 2;
  if (mean > 0.4 * area) { const k = Math.sqrt(0.4 * area / mean); const q = v => Math.round(v * 200) / 200; s.rMin = Math.max(0.01, q(s.rMin * k)); s.rMax = Math.max(0.015, q(s.rMin + 0.005), q(s.rMax * k)); }
  // still too full at the smallest sizes: fewer balls
  const per = Math.PI * ((s.rMin + s.rMax) / 2) ** 2;
  if (s.count * per > 0.4 * area) s.count = Math.max(2, Math.floor(0.4 * area / per));
  if (s.count > 200 && s.sub > 4) s.sub = 4;
  return s;
}
export const sceneRng = seed => K.rng((seed ^ 0x1f83d9ab) >>> 0);

export function createSim(cap = 420) {
  return { n: 0, cap, x: new Float64Array(cap), y: new Float64Array(cap), vx: new Float64Array(cap), vy: new Float64Array(cap), r: new Float64Array(cap), m: new Float64Array(cap), c: new Uint16Array(cap), side: new Uint8Array(cap), live: new Uint8Array(cap),
    tx: null, ty: null, TL: 0, tN: 0, bumpers: [], pockets: [], potted: 0, t: 0, P: {}, cue: -1, big: -1, hits: 0 };
}
export function applyParams(S, st) {
  Object.assign(S.P, { e: st.e, eWall: st.eWall, roll: st.roll, g: st.g, sub: Math.max(1, st.sub | 0) });
  const TL = Math.max(0, st.trail | 0);
  if (S.TL !== TL || !S.tx) { S.TL = TL; S.tx = TL ? new Float32Array(S.cap * TL).fill(NaN) : null; S.ty = TL ? new Float32Array(S.cap * TL).fill(NaN) : null; S.tN = 0; }
}
function free(S, x, y, r) {
  for (let i = 0; i < S.n; i++) if ((S.x[i] - x) ** 2 + (S.y[i] - y) ** 2 < (S.r[i] + r + 0.002) ** 2) return false;
  for (const b of S.bumpers) if ((b.x - x) ** 2 + (b.y - y) ** 2 < (b.r + r + 0.01) ** 2) return false;
  return inside(S, x, y, r);
}
function inside(S, x, y, r) {
  if (S.table === 'round') return Math.hypot(x - W / 2, y - H / 2) < S.R - r;
  return x > S.x0 + r && x < S.x1 - r && y > S.y0 + r && y < S.y1 - r;
}
function add(S, x, y, vx, vy, r, side, c) {
  const i = S.n++; S.x[i] = x; S.y[i] = y; S.vx[i] = vx; S.vy[i] = vy; S.r[i] = r; S.m[i] = Math.PI * r * r; S.side[i] = side; S.c[i] = c; S.live[i] = 1; return i;
}

export function buildScene(S, st, r) {
  applyParams(S, st);
  S.n = 0; S.t = 0; S.potted = 0; S.cue = -1; S.big = -1; S.hits = 0; S.tN = 0; S.table = st.table;
  if (S.tx) { S.tx.fill(NaN); S.ty.fill(NaN); }
  const m = st.table === 'pool' ? 0.12 : 0.04;
  S.x0 = m; S.x1 = W - m; S.y0 = m; S.y1 = H - m; S.R = H / 2 - 0.04;
  S.pockets = [];
  if (st.table === 'pool') for (const [px, py] of [[S.x0, S.y0], [W / 2, S.y0 - 0.02], [S.x1, S.y0], [S.x0, S.y1], [W / 2, S.y1 + 0.02], [S.x1, S.y1]]) S.pockets.push({ x: px, y: py, r: 0.075 });
  S.bumpers = [];
  for (let k = 0; k < st.bumpers; k++) {
    for (let t = 0; t < 40; t++) { const br = 0.05 + 0.07 * r(), bx = 0.4 + (W - 0.8) * r(), by = 0.3 + (H - 0.6) * r(); if (S.bumpers.every(b => Math.hypot(b.x - bx, b.y - by) > b.r + br + 0.25) && inside(S, bx, by, br + 0.1)) { S.bumpers.push({ x: bx, y: by, r: br, hit: 0 }); break; } }
  }
  const N = Math.min(S.cap, st.count), v0 = st.speed, rr = () => st.rMin + (st.rMax - st.rMin) * r();
  const place = (side, rad, vx, vy, c, region) => {
    for (let t = 0; t < 200; t++) {
      let x, y;
      if (S.table === 'round') { const a = 2 * Math.PI * r(), d = S.R * Math.sqrt(r()); x = W / 2 + d * Math.cos(a); y = H / 2 + d * Math.sin(a); }
      else { x = S.x0 + (S.x1 - S.x0) * r(); y = S.y0 + (S.y1 - S.y0) * r(); }
      if (region === 0 && x > W / 2 - 0.02) continue; if (region === 1 && x < W / 2 + 0.02) continue;
      if (free(S, x, y, rad)) return add(S, x, y, vx, vy, rad, side, c);
    }
    return -1;
  };
  const rv = () => { const a = 2 * Math.PI * r(), s = v0 * (0.3 + 0.7 * r()); return [s * Math.cos(a), s * Math.sin(a)]; };
  if (st.layout === 'break') {
    const R = Math.max(0.02, Math.min(0.045, (st.rMin + st.rMax) / 2)), rows = Math.min(7, Math.max(3, Math.floor((Math.sqrt(8 * (N - 1) + 1) - 1) / 2)));
    const ax = W * 0.68, ay = H / 2; let c = 1;
    for (let i = 0; i < rows; i++) for (let j = 0; j <= i; j++) add(S, ax + i * R * 1.75, ay + (j - i / 2) * R * 2.02, 0, 0, R, 1, c++);
    S.cue = add(S, W * 0.25, H / 2 + (r() - 0.5) * 0.04, 0, 0, R, 0, 0);
    S.vx[S.cue] = 3 + 3 * r() + v0; S.vy[S.cue] = (r() - 0.5) * 0.3;
  } else if (st.layout === 'lattice') {
    const R = Math.max(0.015, Math.min(0.06, (st.rMin + st.rMax) / 2)), cols = Math.max(2, Math.round(Math.sqrt(N * W / H))), rows = Math.max(2, Math.ceil(N / cols));
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols && S.n < N; i++) { const x = S.x0 + (i + 0.5) * (S.x1 - S.x0) / cols, y = S.y0 + (j + 0.5) * (S.y1 - S.y0) / rows; if (free(S, x, y, R)) add(S, x, y, 0, 0, R, 0, S.n); }
    if (S.n) { const k = Math.floor(r() * S.n); S.vx[k] = 3 + 2 * v0; S.vy[k] = 1.3; S.cue = k; }
  } else if (st.layout === 'brownian') {
    S.big = place(1, 0.13, 0, 0, 0, -1);
    if (S.big < 0) S.big = add(S, W / 2, H / 2, 0, 0, 0.13, 1, 0);
    S.x[S.big] = W / 2; S.y[S.big] = H / 2;
    for (let k = 1; k < N; k++) { const [vx, vy] = rv(); place(0, rr(), vx * 1.6, vy * 1.6, k, -1); }
  } else {
    const mixing = st.layout === 'mixing';
    for (let k = 0; k < N; k++) { const side = mixing ? (k % 2) : 0, [vx, vy] = rv(); place(side, rr(), vx, vy, k, mixing ? side : -1); }
    if (mixing) S.wall = true;
  }
  S.wallT = st.layout === 'mixing' ? 1.2 : 0;
}

// Upstream handleBallCollision: half the overlap each, then the normal
// velocity exchange with restitution, by mass.
function collideBalls(S, i, j) {
  let dx = S.x[j] - S.x[i], dy = S.y[j] - S.y[i]; const d = Math.hypot(dx, dy), rr = S.r[i] + S.r[j];
  if (d === 0 || d > rr) return;
  dx /= d; dy /= d;
  const corr = (rr - d) / 2;
  S.x[i] -= dx * corr; S.y[i] -= dy * corr; S.x[j] += dx * corr; S.y[j] += dy * corr;
  const v1 = S.vx[i] * dx + S.vy[i] * dy, v2 = S.vx[j] * dx + S.vy[j] * dy, m1 = S.m[i], m2 = S.m[j], e = S.P.e;
  const n1 = (m1 * v1 + m2 * v2 - m2 * (v1 - v2) * e) / (m1 + m2), n2 = (m1 * v1 + m2 * v2 - m1 * (v2 - v1) * e) / (m1 + m2);
  S.vx[i] += dx * (n1 - v1); S.vy[i] += dy * (n1 - v1); S.vx[j] += dx * (n2 - v2); S.vy[j] += dy * (n2 - v2);
  if (v1 - v2 > 1) S.hits++;
}
// Upstream handleWallCollision (box), plus the round table, the mixing
// divider and the bumpers.
function walls(S, i) {
  const r = S.r[i], e = S.P.eWall;
  if (S.table === 'round') {
    const dx = S.x[i] - W / 2, dy = S.y[i] - H / 2, d = Math.hypot(dx, dy), lim = S.R - r;
    if (d > lim) { const nx = dx / d, ny = dy / d; S.x[i] = W / 2 + nx * lim; S.y[i] = H / 2 + ny * lim; const vn = S.vx[i] * nx + S.vy[i] * ny; if (vn > 0) { S.vx[i] -= (1 + e) * vn * nx; S.vy[i] -= (1 + e) * vn * ny; } }
  } else {
    if (S.x[i] < S.x0 + r) { S.x[i] = S.x0 + r; S.vx[i] = Math.abs(S.vx[i]) * e; }
    if (S.x[i] > S.x1 - r) { S.x[i] = S.x1 - r; S.vx[i] = -Math.abs(S.vx[i]) * e; }
    if (S.y[i] < S.y0 + r) { S.y[i] = S.y0 + r; S.vy[i] = Math.abs(S.vy[i]) * e; }
    if (S.y[i] > S.y1 - r) { S.y[i] = S.y1 - r; S.vy[i] = -Math.abs(S.vy[i]) * e; }
  }
  if (S.wallT > 0) { const cx = W / 2; if ((S.x[i] - cx) * (S.side[i] ? 1 : -1) < r) { S.x[i] = cx + (S.side[i] ? r : -r); S.vx[i] = (S.side[i] ? 1 : -1) * Math.abs(S.vx[i]); } }
  for (const b of S.bumpers) {
    const dx = S.x[i] - b.x, dy = S.y[i] - b.y, d = Math.hypot(dx, dy), m = b.r + r;
    if (d < m && d > 0) { const nx = dx / d, ny = dy / d; S.x[i] = b.x + nx * m; S.y[i] = b.y + ny * m; const vn = S.vx[i] * nx + S.vy[i] * ny; if (vn < 0) { S.vx[i] -= (1 + e) * vn * nx; S.vy[i] -= (1 + e) * vn * ny; b.hit = 1; } }
  }
}

// Near pairs by a uniform grid (cell = the largest diameter).
let gHead = new Int32Array(0), gNext = new Int32Array(0);
function pairs(S) {
  let rmax = 0; for (let i = 0; i < S.n; i++) if (S.live[i]) rmax = Math.max(rmax, S.r[i]);
  const cs = Math.max(0.02, 2 * rmax), nx = Math.ceil(W / cs) + 1, ny = Math.ceil(H / cs) + 1;
  if (gHead.length < nx * ny) gHead = new Int32Array(nx * ny);
  if (gNext.length < S.n) gNext = new Int32Array(S.cap);
  gHead.fill(-1, 0, nx * ny);
  for (let i = 0; i < S.n; i++) { if (!S.live[i]) continue; const cx = Math.max(0, Math.min(nx - 1, Math.floor(S.x[i] / cs))), cy = Math.max(0, Math.min(ny - 1, Math.floor(S.y[i] / cs))), c = cy * nx + cx; gNext[i] = gHead[c]; gHead[c] = i; }
  for (let i = 0; i < S.n; i++) {
    if (!S.live[i]) continue;
    const cx = Math.floor(S.x[i] / cs), cy = Math.floor(S.y[i] / cs);
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const X = cx + ox, Y = cy + oy; if (X < 0 || Y < 0 || X >= nx || Y >= ny) continue;
      for (let j = gHead[Y * nx + X]; j >= 0; j = gNext[j]) if (j > i) collideBalls(S, i, j);
    }
  }
}

export function step(S, h) {
  const P = S.P, n = P.sub, dt = h / n;
  const f = P.roll ? Math.exp(-P.roll * dt) : 1;
  for (let s = 0; s < n; s++) {
    for (let i = 0; i < S.n; i++) { if (!S.live[i]) continue; S.vy[i] -= P.g * dt; S.vx[i] *= f; S.vy[i] *= f; S.x[i] += S.vx[i] * dt; S.y[i] += S.vy[i] * dt; }
    pairs(S);
    for (let i = 0; i < S.n; i++) if (S.live[i]) walls(S, i);
    for (const p of S.pockets) for (let i = 0; i < S.n; i++) if (S.live[i] && Math.hypot(S.x[i] - p.x, S.y[i] - p.y) < p.r) { if (i === S.cue) { S.x[i] = W * 0.25; S.y[i] = H / 2; S.vx[i] = S.vy[i] = 0; } else { S.live[i] = 0; S.potted++; } }
  }
  if (S.wallT > 0) S.wallT = Math.max(0, S.wallT - h);
  for (const b of S.bumpers) b.hit = Math.max(0, b.hit - h * 3);
  if (S.tx) { const k = S.tN % S.TL; for (let i = 0; i < S.n; i++) { S.tx[i * S.TL + k] = S.live[i] ? S.x[i] : NaN; S.ty[i * S.TL + k] = S.y[i]; } S.tN++; }
  S.t += h;
}
// Shoot ball i with velocity (vx, vy) (the cue).
export function shoot(S, i, vx, vy) { if (i < 0 || i >= S.n || !S.live[i]) return; const s = Math.hypot(vx, vy), k = s > 8 ? 8 / s : 1; S.vx[i] = vx * k; S.vy[i] = vy * k; }
export function scaleSpeed(S, k) { for (let i = 0; i < S.n; i++) { S.vx[i] *= k; S.vy[i] *= k; } }
export function kinetic(S) { let E = 0; for (let i = 0; i < S.n; i++) if (S.live[i]) E += 0.5 * S.m[i] * (S.vx[i] ** 2 + S.vy[i] ** 2); return E; }
export function momentum(S) { let px = 0, py = 0; for (let i = 0; i < S.n; i++) if (S.live[i]) { px += S.m[i] * S.vx[i]; py += S.m[i] * S.vy[i]; } return [px, py]; }
export function health(S) {
  let bad = 0, out = 0;
  for (let i = 0; i < S.n; i++) { if (!S.live[i]) continue; if (!Number.isFinite(S.x[i] + S.y[i] + S.vx[i] + S.vy[i])) bad++; else if (S.x[i] < -1e-6 || S.x[i] > W + 1e-6 || S.y[i] < -1e-6 || S.y[i] > H + 1e-6) out++; }
  return { bad, out };
}
export function pick(S, x, y) { let best = -1, bd = 0.12; for (let i = 0; i < S.n; i++) { if (!S.live[i]) continue; const d = Math.hypot(S.x[i] - x, S.y[i] - y) - S.r[i]; if (d < bd) { bd = d; best = i; } } return best; }
