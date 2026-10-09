/*
Copyright 2021 Matthias Müller - Ten Minute Physics

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
// Pendulum in 100 Lines · upstream script 1, verbatim from Ten Minute Physics
// 06-pendulumShort.html by Matthias Müller. MIT License (notice kept above).
// ============================================================================
//  PENDULUM IN 100 LINES  ·  pages/pendulum-short/sim.js — simulation and rules
// ----------------------------------------------------------------------------
//  UPSTREAM. Ten Minute Physics #06 "pendulumShort" by Matthias Müller (MIT,
//  notice above): an n-link pendulum by position based dynamics. Each
//  substep predicts every bob with gravity, corrects each link back to its
//  length (inverse-mass weighted), then sets v = (x - x_prev) / dt. That
//  loop is pbdStep() below, unchanged in form.
//
//  OUR ADDITIONS (davesgames.io, not upstream): mass patterns, random
//  start angles, damping, a driven pivot, several copies with tiny start
//  differences (the chaos fan), dragging a bob, energy, trails, the schema
//  and random rules for the sim kit, and a stability guard. No DOM.
//
//  World: a box W x H metres, y up; the pivot near the top centre.
//
//  grep -n targets: "export function makeSchema", "export function guard",
//  "export function buildScene", "function pbdStep", "export function step",
//  "export function energy"
// ============================================================================
import * as K from '../../widgets/sim-kit/core.js';

export const W = 1.3, H = 1.24;

export function makeSchema(PHONE) {
  return { groups: [
    { id: 'chain', label: 'Pendulum', hint: 'Drag a bob to move it; let go to throw it.', controls: [
      { key: 'links', type: 'range', label: 'Links', min: 1, max: 16, step: 1, value: 3, rebuild: true, random: { dist: 'int', min: 2, max: 9 } },
      { key: 'massMode', type: 'choice', label: 'Masses', value: 'falling', seg: false, options: [{ id: 'equal', label: 'Equal' }, { id: 'falling', label: 'Heavy to light' }, { id: 'rising', label: 'Light to heavy' }, { id: 'random', label: 'Random' }, { id: 'upstream', label: 'Upstream 1, 0.5, 0.3' }], rebuild: true, random: { weights: { equal: 2, falling: 2, rising: 1, random: 2, upstream: 1 } } },
      { key: 'length', type: 'range', label: 'Total length', min: 0.2, max: 0.58, step: 0.01, value: 0.54, unit: 'm', rebuild: true, random: { min: 0.36, max: 0.58 } },
      { key: 'lenVar', type: 'range', label: 'Length spread', min: 0, max: 0.8, step: 0.01, value: 0, rebuild: true, random: { min: 0, max: 0.6 } },
      { key: 'start', type: 'choice', label: 'Start', value: 'upstream', seg: false, options: [{ id: 'upstream', label: 'Upstream (90°, 180°, 180°)' }, { id: 'up', label: 'Nearly upright' }, { id: 'side', label: 'All to the side' }, { id: 'random', label: 'Random angles' }, { id: 'curl', label: 'Curled' }], rebuild: true, random: { weights: { upstream: 1, up: 2, side: 2, random: 3, curl: 2 } } },
      { key: 'copies', type: 'range', label: 'Copies', min: 1, max: PHONE ? 8 : 16, step: 1, value: 1, phone: 1, rebuild: true, random: { dist: 'int', min: 1, max: PHONE ? 6 : 10 } },
      { key: 'delta', type: 'range', label: 'Copy offset', min: -6, max: -1, step: 0.1, value: -3, rebuild: true, fmt: v => '10^' + v.toFixed(1) + ' rad' },
    ] },
    { id: 'world', label: 'World', controls: [
      { key: 'g', type: 'range', label: 'Gravity', min: 1, max: 25, step: 0.1, value: 10, unit: 'm/s²', random: { dist: 'normal', mean: 10, sd: 4, min: 3, max: 22 } },
      { key: 'damp', type: 'range', label: 'Damping', min: 0, max: 0.5, step: 0.005, value: 0, unit: '1/s', random: { min: 0, max: 0.08 } },
      { key: 'driveA', type: 'range', label: 'Drive amplitude', min: 0, max: 0.12, step: 0.002, value: 0, unit: 'm', random: { dist: 'normal', mean: 0, sd: 0.02, min: 0, max: 0.08 } },
      { key: 'driveF', type: 'range', label: 'Drive frequency', min: 0.2, max: 4, step: 0.05, value: 1.2, unit: 'Hz' },
      { key: 'timeScale', type: 'range', label: 'Time scale', min: 0.2, max: 1.5, step: 0.05, value: 0.6, random: { min: 0.4, max: 1 } },
    ] },
    { id: 'look', label: 'Look', controls: [
      { key: 'colorBy', type: 'choice', label: 'Colour by', value: 'palette', seg: false, options: [{ id: 'palette', label: 'Palette' }, { id: 'speed', label: 'Speed' }, { id: 'copy', label: 'Copy (colour map)' }], random: { weights: { palette: 2, speed: 2, copy: 2 } } },
      { key: 'cmap', type: 'cmap', label: 'Colour map', value: 'plasma' },
      { key: 'trail', type: 'range', label: 'Trail', min: 0, max: 2400, step: 20, value: 1000, random: { min: 300, max: 2000 } },
      { key: 'trailAll', type: 'toggle', label: 'Trail every bob', value: false, random: { p: 0.3 } },
      { key: 'rods', type: 'toggle', label: 'Rods', value: true, random: { p: 0.85 } },
      { key: 'glow', type: 'toggle', label: 'Glow', value: true, random: { p: 0.7 } },
      { key: 'grid', type: 'toggle', label: 'Grid', value: false, random: { p: 0.3 } },
      K.themeControl('night'),
      K.paletteControl('neon', { random: { pick: ['toybox', 'neon', 'sunset', 'harbour', 'pastel'], rnd: 0.3 } }),
    ] },
    { id: 'solver', label: 'Solver', open: false, random: false, controls: [
      { key: 'sub', type: 'range', label: 'Substeps per frame', min: 5, max: 200, step: 5, value: PHONE ? 50 : 100, phone: 50 },
      { type: 'note', text: 'Position based dynamics: predict, correct each link, v = (x − x_prev)/Δt (Ten Minute Physics #06).' },
    ] },
  ] };
}
export const REBUILD = new Set(['links', 'massMode', 'length', 'lenVar', 'start', 'copies', 'delta']);

export function guard(next) {
  const s = Object.assign({}, next);
  // many links and many copies cost links x copies x substeps per frame
  const cost = s.links * s.copies * s.sub;
  if (cost > 4000) s.copies = Math.max(1, Math.floor(4000 / (s.links * s.sub)));
  // a strong drive near resonance throws a long chain about: keep it mild
  if (s.driveA > 0.04 && s.links > 6) s.driveA = 0.04;
  return s;
}
export const sceneRng = seed => K.rng((seed ^ 0x51ed270b) >>> 0);

function massesOf(st, r) {
  const n = st.links, m = [];
  for (let i = 0; i < n; i++) {
    if (st.massMode === 'upstream') m.push([1, 0.5, 0.3][i] ?? 0.3);
    else if (st.massMode === 'equal') m.push(0.5);
    else if (st.massMode === 'falling') m.push(1 - 0.85 * i / Math.max(1, n - 1));
    else if (st.massMode === 'rising') m.push(0.15 + 0.85 * i / Math.max(1, n - 1));
    else m.push(0.08 + 0.92 * r());
  }
  return m;
}
function anglesOf(st, r) {
  const n = st.links, a = [];
  for (let i = 0; i < n; i++) {
    if (st.start === 'upstream') a.push(i === 0 ? 0.5 * Math.PI : Math.PI);
    else if (st.start === 'up') a.push(Math.PI + (r() - 0.5) * 0.3);
    else if (st.start === 'side') a.push(0.5 * Math.PI + (r() - 0.5) * 0.2);
    else if (st.start === 'curl') a.push(0.5 * Math.PI + i * (0.9 + 0.5 * r()));
    else a.push(2 * Math.PI * r());
  }
  return a;
}

export function createSim() { return { chains: [], t: 0, P: {}, grab: null, trailN: 0 }; }
export function applyParams(S, st) {
  Object.assign(S.P, { g: st.g, damp: st.damp, driveA: st.driveA, driveF: st.driveF, timeScale: st.timeScale, sub: st.sub, trail: st.trail | 0 });
  const TL = Math.max(2, st.trail | 0);
  if (S.chains && S.chains.length && S.TL !== TL) { S.TL = TL; for (const ch of S.chains) { const nb = ch.x.length - 1; ch.tx = new Float32Array(TL * nb); ch.ty = new Float32Array(TL * nb); ch.tN = 0; } }
}

export function buildScene(S, st, r) {
  applyParams(S, st);
  S.t = 0; S.grab = null;
  const masses = massesOf(st, r), ang = anglesOf(st, r), n = st.links;
  const raw = Array.from({ length: n }, () => 1 + st.lenVar * (r() * 2 - 1));
  const sum = raw.reduce((a, b) => a + b, 0), lens = raw.map(v => v / sum * st.length);
  S.pivot = { x: W / 2, y: H / 2, x0: W / 2 };
  S.TL = Math.max(2, st.trail | 0);
  S.chains = [];
  for (let c = 0; c < st.copies; c++) {
    const d = c === 0 ? 0 : Math.pow(10, st.delta) * c;
    const ch = { m: [0].concat(masses), w: [0].concat(masses.map(v => 1 / v)), L: [0].concat(lens), x: new Float64Array(n + 1), y: new Float64Array(n + 1), px: new Float64Array(n + 1), py: new Float64Array(n + 1), vx: new Float64Array(n + 1), vy: new Float64Array(n + 1), tx: new Float32Array(S.TL * n), ty: new Float32Array(S.TL * n), tN: 0 };
    let x = S.pivot.x, y = S.pivot.y; ch.x[0] = x; ch.y[0] = y;
    for (let i = 0; i < n; i++) { const a = ang[i] + (i === n - 1 ? d : 0); x += lens[i] * Math.sin(a); y -= lens[i] * Math.cos(a); ch.x[i + 1] = x; ch.y[i + 1] = y; }
    S.chains.push(ch);
  }
  S.E0 = energy(S, 0);
}

// The upstream substep: predict, correct each link, update velocity.
function pbdStep(S, ch, dt) {
  const P = S.P, n = ch.x.length;
  for (let i = 1; i < n; i++) {
    if (S.grab && S.grab.ch === ch && S.grab.i === i) continue;
    ch.vy[i] += dt * -P.g;
    ch.px[i] = ch.x[i]; ch.py[i] = ch.y[i];
    ch.x[i] += ch.vx[i] * dt; ch.y[i] += ch.vy[i] * dt;
  }
  if (S.grab && S.grab.ch === ch) { const i = S.grab.i; ch.px[i] = ch.x[i]; ch.py[i] = ch.y[i]; ch.x[i] = S.grab.x; ch.y[i] = S.grab.y; }
  for (let i = 1; i < n; i++) {
    const dx = ch.x[i] - ch.x[i - 1], dy = ch.y[i] - ch.y[i - 1], d = Math.sqrt(dx * dx + dy * dy);
    let w0 = ch.w[i - 1], w1 = ch.w[i];
    if (S.grab && S.grab.ch === ch) { if (S.grab.i === i) w1 = 0; if (S.grab.i === i - 1) w0 = 0; }
    if (w0 + w1 === 0 || d < 1e-12) continue;
    const corr = (ch.L[i] - d) / d / (w0 + w1);
    ch.x[i - 1] -= w0 * corr * dx; ch.y[i - 1] -= w0 * corr * dy;
    ch.x[i] += w1 * corr * dx; ch.y[i] += w1 * corr * dy;
  }
  const f = P.damp ? Math.exp(-P.damp * dt) : 1;
  for (let i = 1; i < n; i++) { ch.vx[i] = (ch.x[i] - ch.px[i]) / dt * f; ch.vy[i] = (ch.y[i] - ch.py[i]) / dt * f; }
}

// Trail ring buffers: TL samples x n bobs (allocated in buildScene), four
// samples per frame so a fast whip draws a curve, not a polygon.
function record(S) {
  for (const ch of S.chains) {
    const nb = ch.x.length - 1, k = (ch.tN % S.TL) * nb;
    for (let i = 0; i < nb; i++) { ch.tx[k + i] = ch.x[i + 1]; ch.ty[k + i] = ch.y[i + 1]; }
    ch.tN++;
  }
}
export function step(S, h) {
  const P = S.P, n = Math.max(1, P.sub | 0), T = h * P.timeScale, dt = T / n, rec = Math.max(1, Math.floor(n / 4));
  for (let s = 0; s < n; s++) {
    S.t += dt;
    const px = S.pivot.x0 + P.driveA * Math.sin(2 * Math.PI * P.driveF * S.t);
    for (const ch of S.chains) { ch.x[0] = px; ch.y[0] = S.pivot.y; pbdStep(S, ch, dt); }
    S.pivot.x = px;
    if (s % rec === rec - 1) record(S);
  }
}

// Kinetic + potential energy of copy c (pivot at height 0).
export function energy(S, c = 0) {
  const ch = S.chains[c]; let E = 0;
  for (let i = 1; i < ch.x.length; i++) E += ch.m[i] * (0.5 * (ch.vx[i] ** 2 + ch.vy[i] ** 2) + S.P.g * (ch.y[i] - S.pivot.y));
  return E;
}
export function health(S) {
  let bad = 0, out = 0;
  for (const ch of S.chains) for (let i = 0; i < ch.x.length; i++) {
    if (!Number.isFinite(ch.x[i] + ch.y[i] + ch.vx[i] + ch.vy[i])) bad++;
    else if (ch.x[i] < -0.1 || ch.x[i] > W + 0.1 || ch.y[i] < -0.1 || ch.y[i] > H + 0.1) out++;
  }
  return { bad, out };
}
export function pick(S, x, y) {
  let best = null, bd = 0.05;
  S.chains.forEach(ch => { for (let i = 1; i < ch.x.length; i++) { const d = Math.hypot(ch.x[i] - x, ch.y[i] - y); if (d < bd) { bd = d; best = { ch, i, x, y }; } } });
  return best;
}
