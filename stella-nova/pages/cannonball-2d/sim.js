/*
Copyright 2021 Matthias Müller - Ten Minute Physics

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
// ============================================================================
//  CANNONBALL 2D  ·  pages/cannonball-2d/sim.js — simulation and scene rules
// ----------------------------------------------------------------------------
//  UPSTREAM. Ten Minute Physics #01 "cannonball2d" by Matthias Müller (MIT,
//  notice above): a ball under gravity with one explicit Euler step per
//  frame (v += g dt, x += v dt) that bounces off the floor and the walls.
//  That step is ballStep() below, unchanged in form.
//
//  OUR ADDITIONS (davesgames.io, not upstream): many balls fired from a
//  cannon, restitution, drag, wind, a ceiling, pegs (scatter, Galton board,
//  ring), ball-ball collisions, the schema and random rules for the sim
//  kit, and a stability guard. No DOM: main.js and tests.mjs share it.
//
//  World: a box W x H metres, y up, floor at y = 0.
//
//  grep -n targets: "export function makeSchema", "export function guard",
//  "export function createSim", "export function buildScene",
//  "function ballStep", "export function step", "export function fire"
// ============================================================================
import * as K from '../../widgets/sim-kit/core.js';

export const W = 16, H = 10;

export function makeSchema(PHONE) {
  return { groups: [
    { id: 'cannon', label: 'Cannon', hint: 'Drag from empty space to fling a ball. Drag a ball to throw it.', controls: [
      { key: 'side', type: 'choice', label: 'Cannon', value: 'left', options: [{ id: 'left', label: 'Left' }, { id: 'right', label: 'Right' }, { id: 'both', label: 'Both' }], rebuild: true, random: { weights: { left: 3, right: 1, both: 2 } } },
      { key: 'angle', type: 'range', label: 'Angle', min: 10, max: 85, step: 1, value: 56, unit: '°', random: { min: 25, max: 80 } },
      { key: 'speed', type: 'range', label: 'Muzzle speed', min: 4, max: 24, step: 0.5, value: 18, unit: 'm/s', random: { min: 9, max: 22 } },
      { key: 'spread', type: 'range', label: 'Spread', min: 0, max: 20, step: 1, value: 4, unit: '°', random: { min: 0, max: 14 } },
      { key: 'rate', type: 'range', label: 'Shots per second', min: 0, max: 8, step: 0.1, value: 1.2, random: { min: 0.4, max: 5 } },
      { key: 'count', type: 'range', label: 'Balls kept', min: 1, max: PHONE ? 60 : 120, step: 1, value: 24, phone: 18, rebuild: true, random: { dist: 'int', min: 4, max: PHONE ? 40 : 80 } },
      { type: 'buttons', key: 'fireBtn', label: 'Fire', action: 'fire', items: [{ id: '1', label: 'One' }, { id: '10', label: 'Salvo ×10' }] },
      { type: 'button', key: 'clearBtn', label: 'Clear the balls', action: 'clear' },
    ] },
    { id: 'world', label: 'World', controls: [
      { key: 'g', type: 'range', label: 'Gravity', min: 0.5, max: 30, step: 0.1, value: 10, unit: 'm/s²', random: { dist: 'log', min: 1.2, max: 26 } },
      { key: 'wind', type: 'range', label: 'Wind', min: -6, max: 6, step: 0.1, value: 0, unit: 'm/s²', random: { dist: 'normal', mean: 0, sd: 1.5, min: -4, max: 4 } },
      { key: 'drag', type: 'range', label: 'Air drag', min: 0, max: 0.6, step: 0.01, value: 0, unit: '1/s', random: { min: 0, max: 0.25 } },
      { key: 'e', type: 'range', label: 'Bounce', min: 0.2, max: 1, step: 0.01, value: 1, random: { min: 0.55, max: 0.98 } },
      { key: 'mu', type: 'range', label: 'Floor friction', min: 0, max: 0.5, step: 0.01, value: 0, random: { min: 0, max: 0.2 } },
      { key: 'ceiling', type: 'toggle', label: 'Ceiling', value: false, random: { p: 0.35 } },
    ] },
    { id: 'pegs', label: 'Pegs', controls: [
      { key: 'pegs', type: 'choice', label: 'Layout', value: 'none', seg: false, options: [{ id: 'none', label: 'None' }, { id: 'scatter', label: 'Scatter' }, { id: 'galton', label: 'Galton board' }, { id: 'ring', label: 'Ring' }, { id: 'wall', label: 'Bumper wall' }], rebuild: true, random: { weights: { none: 2, scatter: 2, galton: 2, ring: 1, wall: 1 } } },
      { key: 'nPegs', type: 'range', label: 'Pegs', min: 3, max: 60, step: 1, value: 20, rebuild: true, random: { dist: 'int', min: 6, max: 40 } },
      { key: 'pegR', type: 'range', label: 'Peg size', min: 0.08, max: 0.6, step: 0.01, value: 0.18, unit: 'm', rebuild: true },
      { key: 'kick', type: 'range', label: 'Bumper kick', min: 1, max: 1.6, step: 0.01, value: 1, random: { min: 1, max: 1.35 } },
    ] },
    { id: 'balls', label: 'Balls', controls: [
      { key: 'r', type: 'range', label: 'Radius', min: 0.08, max: 0.6, step: 0.01, value: 0.2, unit: 'm', random: { min: 0.1, max: 0.4 } },
      { key: 'rVar', type: 'range', label: 'Size spread', min: 0, max: 0.8, step: 0.01, value: 0, random: { min: 0, max: 0.6 } },
      { key: 'collide', type: 'toggle', label: 'Balls collide', value: false, random: { p: 0.6 } },
    ] },
    { id: 'look', label: 'Look', controls: [
      { key: 'colorBy', type: 'choice', label: 'Colour by', value: 'palette', seg: false, options: [{ id: 'palette', label: 'Palette' }, { id: 'speed', label: 'Speed' }, { id: 'height', label: 'Height' }, { id: 'energy', label: 'Energy' }], random: { weights: { palette: 3, speed: 2, height: 1, energy: 1 } } },
      { key: 'cmap', type: 'cmap', label: 'Colour map', value: 'plasma' },
      { key: 'trail', type: 'range', label: 'Trail', min: 0, max: 240, step: 1, value: 90, random: { min: 20, max: 220 } },
      { key: 'glow', type: 'toggle', label: 'Glow', value: true, random: { p: 0.7 } },
      { key: 'grid', type: 'toggle', label: 'Grid', value: true, random: { p: 0.5 } },
      K.themeControl('night'),
      K.paletteControl('sunset'),
    ] },
    { id: 'solver', label: 'Solver', open: false, random: false, controls: [
      { key: 'sub', type: 'range', label: 'Substeps', min: 1, max: 8, step: 1, value: 2 },
      { type: 'note', text: 'Explicit Euler, one step per substep: v ← v + g Δt, x ← x + v Δt (Ten Minute Physics #01).' },
    ] },
  ] };
}
export const REBUILD = new Set(['side', 'count', 'pegs', 'nPegs', 'pegR']);

// Keep random scenes readable: the arc must fit the box (with no ceiling)
// and fast, bouncy, crowded scenes get more substeps.
export function guard(next) {
  const s = Object.assign({}, next);
  if (s.pegs === 'galton' && s.angle < 40) s.angle = 40 + (s.angle % 30);
  const top = 0.92 * H;
  const vyMax = Math.sqrt(2 * s.g * top);
  const vy = s.speed * Math.sin(s.angle * Math.PI / 180);
  if (!s.ceiling && vy > vyMax) s.speed = Math.max(4, Math.floor(2 * vyMax / Math.sin(s.angle * Math.PI / 180)) / 2);
  if (s.speed > 18 || s.collide) s.sub = Math.max(s.sub, 3);
  if (s.e > 0.97 && s.kick > 1.15) s.kick = 1.15;
  return s;
}

export const sceneRng = seed => K.rng((seed ^ 0x2545f491) >>> 0);

export function createSim(cap = 160) {
  return {
    cap, n: 0, head: 0, x: new Float64Array(cap), y: new Float64Array(cap), vx: new Float64Array(cap), vy: new Float64Array(cap),
    r: new Float64Array(cap), c: new Uint8Array(cap), age: new Float64Array(cap),
    tx: null, ty: null, tlen: 0, tN: 0,
    pegs: [], cannons: [], bins: [], binH: 0, t: 0, fireAcc: 0, shots: 0, P: {}, grab: -1, rng: K.rng(1), bumps: 0,
  };
}

export function applyParams(S, st) {
  Object.assign(S.P, { g: st.g, wind: st.wind, drag: st.drag, e: st.e, mu: st.mu, ceiling: st.ceiling, kick: st.kick, collide: st.collide,
    r: st.r, rVar: st.rVar, angle: st.angle, speed: st.speed, spread: st.spread, rate: st.rate, sub: st.sub, trail: st.trail });
  const tl = Math.max(2, st.trail | 0);
  if (S.tlen !== tl || !S.tx) { S.tlen = tl; S.tx = new Float32Array(S.cap * tl).fill(NaN); S.ty = new Float32Array(S.cap * tl).fill(NaN); S.tN = 0; }
}

function makePegs(st, r) {
  const out = [], R = st.pegR, N = st.nPegs;
  const ok = (x, y, rr) => out.every(p => Math.hypot(p.x - x, p.y - y) > p.r + rr + 0.5) && y > 1.6 && y < H - 1.2 && x > 2.4 && x < W - 2.4;
  if (st.pegs === 'scatter') {
    for (let k = 0; out.length < N && k < N * 40; k++) { const x = 2.4 + (W - 4.8) * r(), y = 1.6 + (H - 2.8) * r(), rr = R * (0.7 + 0.8 * r()); if (ok(x, y, rr)) out.push({ x, y, r: rr }); }
  } else if (st.pegs === 'galton') {
    const rows = Math.max(3, Math.min(10, Math.round(Math.sqrt(N * 1.4)))), dx = (W - 6) / rows;
    for (let i = 0; i < rows; i++) for (let j = 0; j <= i; j++) {
      const x = W / 2 + (j - i / 2) * dx, y = H - 2.2 - i * (H - 4) / rows;
      out.push({ x, y, r: R });
    }
  } else if (st.pegs === 'ring') {
    const n = Math.min(N, 24), cx = W / 2 + (r() - 0.5) * 3, cy = H * (0.45 + 0.15 * r()), rad = 1.6 + 1.4 * r();
    for (let k = 0; k < n; k++) { const a = 2 * Math.PI * k / n; out.push({ x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a), r: R }); }
  } else if (st.pegs === 'wall') {
    const n = Math.min(N, 9), x = W * (0.55 + 0.2 * r());
    const rb = Math.min(0.4, Math.max(0.2, R * 1.4));
    for (let k = 0; k < n; k++) out.push({ x: x + (k % 2 ? 0.5 : -0.5) + (r() - 0.5) * 0.3, y: 1.4 + k * (H - 2.8) / Math.max(1, n - 1), r: rb, bumper: true });
  }
  return out;
}

export function buildScene(S, st, r) {
  applyParams(S, st);
  S.n = 0; S.head = 0; S.t = 0; S.fireAcc = 0; S.shots = 0; S.grab = -1; S.bumps = 0; S.rng = r;
  S.keep = Math.min(S.cap, st.count | 0);
  if (S.tx) { S.tx.fill(NaN); S.ty.fill(NaN); S.tN = 0; }
  S.pegs = makePegs(st, r);
  S.cannons = [];
  S.bins = [];
  if (st.pegs === 'galton') {
    // a hopper at the top centre feeds the board; bins catch the balls
    S.cannons.push({ x: W / 2, y: H - 0.9, dir: 0, recoil: 0, hopper: true });
    const nb = 2 * Math.max(3, Math.min(10, Math.round(Math.sqrt(st.nPegs * 1.4)))) + 1, bw = (W - 2) / nb;
    for (let k = 1; k < nb; k++) S.bins.push(1 + k * bw);
    S.binH = 2.2;
    return;
  }
  if (st.side !== 'right') S.cannons.push({ x: 0.7, y: 0.7, dir: 1, recoil: 0 });
  if (st.side !== 'left') S.cannons.push({ x: W - 0.7, y: 0.7, dir: -1, recoil: 0 });
}

// Add a ball at (x, y) with velocity (vx, vy); the oldest goes when full.
export function addBall(S, x, y, vx, vy, rad) {
  let i;
  if (S.n < S.keep) i = S.n++; else { i = S.head; S.head = (S.head + 1) % S.keep; }
  S.x[i] = x; S.y[i] = y; S.vx[i] = vx; S.vy[i] = vy; S.r[i] = rad; S.c[i] = S.shots % 6; S.age[i] = 0;
  if (S.tx) for (let k = 0; k < S.tlen; k++) { S.tx[i * S.tlen + k] = NaN; S.ty[i * S.tlen + k] = NaN; }
  S.shots++;
  return i;
}
export function fire(S, which) {
  const P = S.P, r = S.rng;
  const list = which == null ? S.cannons : [S.cannons[which % S.cannons.length]];
  for (const c of list) {
    if (c.hopper) {
      const rad = Math.max(0.05, Math.min(0.22, P.r * (1 + (r() - 0.5) * 2 * P.rVar)));
      addBall(S, c.x + (r() - 0.5) * 0.3, c.y, (r() - 0.5) * 0.6, -0.5, rad); c.recoil = 1; continue;
    }
    const a = (P.angle + (r() - 0.5) * 2 * P.spread) * Math.PI / 180;
    const v = P.speed * (0.94 + 0.12 * r());
    const rad = Math.max(0.05, P.r * (1 + (r() - 0.5) * 2 * P.rVar));
    addBall(S, c.x + c.dir * 0.6 * Math.cos(a), c.y + 0.6 * Math.sin(a), c.dir * v * Math.cos(a), v * Math.sin(a), rad);
    c.recoil = 1;
  }
}

// The upstream step for one ball: Euler, then the walls. Ours adds wind,
// drag, restitution, friction and the optional ceiling.
function ballStep(S, i, dt) {
  const P = S.P;
  if (i === S.grab) return;
  S.vx[i] += P.wind * dt; S.vy[i] += -P.g * dt;
  if (P.drag) { const f = Math.exp(-P.drag * dt); S.vx[i] *= f; S.vy[i] *= f; }
  S.x[i] += S.vx[i] * dt; S.y[i] += S.vy[i] * dt;
  const rr = S.r[i];
  if (S.x[i] < rr) { S.x[i] = rr; S.vx[i] = -S.vx[i] * P.e; }
  if (S.x[i] > W - rr) { S.x[i] = W - rr; S.vx[i] = -S.vx[i] * P.e; }
  if (S.y[i] < rr) { S.y[i] = rr; S.vy[i] = -S.vy[i] * P.e; S.vx[i] *= 1 - P.mu; if (Math.abs(S.vy[i]) < 0.05) S.vy[i] = 0; }
  if (P.ceiling && S.y[i] > H - rr) { S.y[i] = H - rr; S.vy[i] = -S.vy[i] * P.e; }
  if (S.bins && S.bins.length && S.y[i] - rr < S.binH) {
    for (const bx of S.bins) {
      const d = S.x[i] - bx;
      if (Math.abs(d) < rr) { S.x[i] = bx + Math.sign(d || 1) * rr; if (S.vx[i] * d < 0) S.vx[i] = -S.vx[i] * P.e; }
    }
  }
  for (const p of S.pegs) {
    const dx = S.x[i] - p.x, dy = S.y[i] - p.y, d = Math.hypot(dx, dy), m = p.r + rr;
    if (d >= m || d < 1e-9) continue;
    const nx = dx / d, ny = dy / d, vn = S.vx[i] * nx + S.vy[i] * ny;
    S.x[i] = p.x + nx * m; S.y[i] = p.y + ny * m;
    if (vn < 0) {
      const k = (1 + P.e * (p.bumper ? P.kick : 1)) * vn; S.vx[i] -= k * nx; S.vy[i] -= k * ny; p.hit = 1; S.bumps++;
      // a bumper adds energy: cap the speed it gives so the ball cannot
      // climb above the box (the random scenes have no hand on the brake)
      if (p.bumper) { const cap = Math.sqrt(2 * P.g * Math.max(0.5, 0.85 * H - S.y[i])) + 1, sp = Math.hypot(S.vx[i], S.vy[i]); if (sp > cap) { S.vx[i] *= cap / sp; S.vy[i] *= cap / sp; } }
    }
  }
}
// After the collision pass: no ball outside the box (the correction can
// push one through a wall).
function clampBox(S, i) {
  const rr = S.r[i];
  if (S.x[i] < rr) S.x[i] = rr; else if (S.x[i] > W - rr) S.x[i] = W - rr;
  if (S.y[i] < rr) S.y[i] = rr; else if (S.P.ceiling && S.y[i] > H - rr) S.y[i] = H - rr;
}
function collide(S) {
  const P = S.P;
  for (let i = 0; i < S.n; i++) for (let j = i + 1; j < S.n; j++) {
    const dx = S.x[j] - S.x[i], dy = S.y[j] - S.y[i], d = Math.hypot(dx, dy), m = S.r[i] + S.r[j];
    if (d >= m || d < 1e-9) continue;
    const nx = dx / d, ny = dy / d, mi = S.r[i] * S.r[i], mj = S.r[j] * S.r[j], wi = 1 / mi, wj = 1 / mj;
    const corr = (m - d) / (wi + wj);
    S.x[i] -= nx * corr * wi; S.y[i] -= ny * corr * wi; S.x[j] += nx * corr * wj; S.y[j] += ny * corr * wj;
    const vn = (S.vx[j] - S.vx[i]) * nx + (S.vy[j] - S.vy[i]) * ny;
    if (vn >= 0) continue;
    const J = -(1 + P.e) * vn / (wi + wj);
    S.vx[i] -= J * wi * nx; S.vy[i] -= J * wi * ny; S.vx[j] += J * wj * nx; S.vy[j] += J * wj * ny;
  }
}

export function step(S, h) {
  const P = S.P, n = Math.max(1, P.sub | 0), dt = h / n;
  if (P.rate > 0 && S.cannons.length) {
    S.fireAcc += h * P.rate;
    while (S.fireAcc >= 1) { S.fireAcc -= 1; fire(S, S.shots % S.cannons.length); }
  }
  for (let s = 0; s < n; s++) {
    for (let i = 0; i < S.n; i++) ballStep(S, i, dt);
    if (P.collide) { collide(S); for (let i = 0; i < S.n; i++) clampBox(S, i); }
  }
  // a speed cap (a safety net only; random scenes stay far below it)
  for (let i = 0; i < S.n; i++) { const v = Math.hypot(S.vx[i], S.vy[i]); if (v > 60) { S.vx[i] *= 60 / v; S.vy[i] *= 60 / v; } S.age[i] += h; }
  for (const c of S.cannons) c.recoil = Math.max(0, c.recoil - h * 4);
  for (const p of S.pegs) if (p.hit) p.hit = Math.max(0, p.hit - h * 3);
  if (S.tx) {
    const k = S.tN % S.tlen;
    for (let i = 0; i < S.n; i++) { S.tx[i * S.tlen + k] = S.x[i]; S.ty[i * S.tlen + k] = S.y[i]; }
    S.tN++;
  }
  S.t += h;
}

// Health: NaN count and balls that left the box (the open top is allowed
// up to 4 H, since gravity brings them back).
export function health(S) {
  let bad = 0, out = 0;
  for (let i = 0; i < S.n; i++) {
    if (!Number.isFinite(S.x[i] + S.y[i] + S.vx[i] + S.vy[i])) bad++;
    else if (S.x[i] < -1e-6 || S.x[i] > W + 1e-6 || S.y[i] < -1e-6 || S.y[i] > 4 * H) out++;
  }
  return { bad, out };
}
export function pick(S, x, y) {
  let best = -1, bd = 1e9;
  for (let i = 0; i < S.n; i++) { const d = Math.hypot(S.x[i] - x, S.y[i] - y) - S.r[i]; if (d < bd && d < 0.4) { bd = d; best = i; } }
  return best;
}
