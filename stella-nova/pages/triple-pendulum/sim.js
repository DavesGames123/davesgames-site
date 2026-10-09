/*
Copyright 2021 Matthias Müller - Ten Minute Physics

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
// Pendulum in 100 Lines · upstream script 1, verbatim from Ten Minute Physics
// 06-pendulumShort.html by Matthias Müller. MIT License (notice kept above).
// ============================================================================
//  TRIPLE PENDULUM  ·  pages/triple-pendulum/sim.js — simulation and rules
// ----------------------------------------------------------------------------
//  UPSTREAM. Ten Minute Physics #06 "pendulum" by Matthias Müller (MIT,
//  notice above): a triple pendulum by position based dynamics (red)
//  against the analytic Lagrange equations integrated with the same tiny
//  substep (green), with six presets of masses and lengths and a substep
//  choice from 1 to 10 000. pbdStep() and analyticStep() below are the
//  upstream simulatePBD and simulateAnalytic, unchanged in form.
//
//  OUR ADDITIONS (davesgames.io, not upstream): random chains and starts,
//  a second PBD copy a hair apart (the butterfly), gravity and time scale,
//  dragging, energy, trails sampled by substep, the schema and random
//  rules for the sim kit, and a stability guard. No DOM.
//
//  grep -n targets: "export const PRESETS", "export function makeSchema",
//  "export function guard", "function pbdStep", "function analyticStep",
//  "export function step"
// ============================================================================
import * as K from '../../widgets/sim-kit/core.js';

export const W = 1.12, H = 1.12;   // the pivot sits at the centre
const SUBS = [1, 5, 10, 100, 1000, 10000];

// The six upstream presets (lengths, masses), in their order.
export const PRESETS = {
  equal: { label: 'Equal', L: [0.15, 0.15, 0.15], m: [1, 1, 1] },
  growing: { label: 'Short to long', L: [0.06, 0.15, 0.2], m: [1, 0.5, 0.1] },
  lightMid: { label: 'Light middle', L: [0.15, 0.15, 0.15], m: [1, 0.01, 1] },
  lightEnds: { label: 'Light ends', L: [0.15, 0.15, 0.15], m: [0.01, 1, 0.01] },
  shrinking: { label: 'Long to short', L: [0.2, 0.133, 0.04], m: [0.3, 0.3, 0.3] },
  five: { label: 'Five links', L: [0.1, 0.12, 0.1, 0.15, 0.05], m: [0.2, 0.6, 0.4, 0.3, 0.2] },
};

export function makeSchema(PHONE) {
  return { groups: [
    { id: 'pendulum', label: 'Pendulum', hint: 'Red: position based dynamics. Green: the analytic equations (three links). Drag a bob to move it.', controls: [
      { key: 'preset', type: 'choice', label: 'Masses and lengths', value: 'equal', seg: false, options: Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label })).concat([{ id: 'random', label: 'Random' }]), rebuild: true, random: { weights: { equal: 1, growing: 1, lightMid: 1, lightEnds: 1, shrinking: 1, five: 1, random: 4 } } },
      { key: 'links', type: 'range', label: 'Links (random)', min: 2, max: 7, step: 1, value: 3, rebuild: true, random: { dist: 'int', min: 3, max: 5 } },
      { key: 'start', type: 'choice', label: 'Start', value: 'upstream', seg: false, options: [{ id: 'upstream', label: 'Upstream (90°, 180°, …)' }, { id: 'up', label: 'Nearly upright' }, { id: 'side', label: 'To the side' }, { id: 'random', label: 'Random' }], rebuild: true, random: { weights: { upstream: 2, up: 2, side: 1, random: 2 } } },
      { key: 'analytic', type: 'toggle', label: 'Analytic solution (3 links)', value: true, random: { p: 0.75 } },
      { key: 'twin', type: 'toggle', label: 'Second PBD copy', value: false, rebuild: true, random: { p: 0.35 } },
      { key: 'delta', type: 'range', label: 'Copy offset', min: -8, max: -1, step: 0.1, value: -4, rebuild: true, fmt: v => '10^' + v.toFixed(1) + ' rad' },
    ] },
    { id: 'world', label: 'World', controls: [
      { key: 'g', type: 'range', label: 'Gravity', min: 2, max: 25, step: 0.1, value: 10, unit: 'm/s²', random: { dist: 'normal', mean: 10, sd: 3, min: 4, max: 20 } },
      { key: 'timeScale', type: 'range', label: 'Time scale', min: 0.1, max: 1.5, step: 0.05, value: 0.6, random: { min: 0.35, max: 0.9 } },
    ] },
    { id: 'look', label: 'Look', controls: [
      { key: 'colorBy', type: 'choice', label: 'Colour by', value: 'palette', options: [{ id: 'palette', label: 'Palette' }, { id: 'speed', label: 'Speed' }], random: { weights: { palette: 3, speed: 1 } } },
      { key: 'cmap', type: 'cmap', label: 'Colour map', value: 'inferno' },
      { key: 'trail', type: 'range', label: 'Trail', min: 0, max: 2000, step: 20, value: 500, random: { min: 200, max: 1600 } },
      { key: 'rods', type: 'toggle', label: 'Rods', value: true, random: { p: 0.85 } },
      { key: 'glow', type: 'toggle', label: 'Glow', value: true, random: { p: 0.7 } },
      { key: 'grid', type: 'toggle', label: 'Grid', value: false, random: { p: 0.3 } },
      K.themeControl('night'),
      K.paletteControl('neon', { random: { pick: ['toybox', 'neon', 'sunset', 'harbour', 'pastel'], rnd: 0.3 } }),
    ] },
    { id: 'solver', label: 'Solver', random: false, controls: [
      { key: 'subIdx', type: 'choice', label: 'Substeps per 0.01 s', value: PHONE ? '4' : '5', phone: '4', options: SUBS.map((n, i) => ({ id: String(i), label: n.toLocaleString('en') })) },
      { type: 'note', text: 'Upstream: dt = 0.01 s per frame, split into the chosen number of substeps. PBD stays stable with 1 or 5 substeps; it is just less accurate. The analytic curve shows from 100 substeps.' },
    ] },
  ] };
}
export const REBUILD = new Set(['preset', 'links', 'start', 'twin', 'delta']);
export const subsOf = st => SUBS[+st.subIdx] || 1000;

export function guard(next) {
  const s = Object.assign({}, next);
  if (s.preset !== 'random') s.links = PRESETS[s.preset].L.length;
  return s;
}
export const sceneRng = seed => K.rng((seed ^ 0x3c6ef372) >>> 0);

export function createSim() { return { list: [], t: 0, P: {}, grab: null, TL: 2 }; }
export function applyParams(S, st) {
  Object.assign(S.P, { g: st.g, timeScale: st.timeScale, sub: subsOf(st), analytic: st.analytic });
  const TL = Math.max(2, st.trail | 0);
  if (S.TL !== TL) { S.TL = TL; for (const p of S.list) { p.tx = new Float32Array(TL); p.ty = new Float32Array(TL); p.tN = 0; } }
}

function makePendulum(kind, masses, lengths, angles, S) {
  const n = masses.length;
  const p = { kind, m: [0].concat(masses), L: [0].concat(lengths), x: new Float64Array(n + 1), y: new Float64Array(n + 1), px: new Float64Array(n + 1), py: new Float64Array(n + 1), vx: new Float64Array(n + 1), vy: new Float64Array(n + 1),
    th: new Float64Array(n + 1), om: new Float64Array(n + 1), tx: new Float32Array(S.TL), ty: new Float32Array(S.TL), tN: 0 };
  let x = 0, y = 0;
  for (let i = 0; i < n; i++) { p.th[i + 1] = angles[i]; x += lengths[i] * Math.sin(angles[i]); y -= lengths[i] * Math.cos(angles[i]); p.x[i + 1] = x; p.y[i + 1] = y; }
  return p;
}

export function buildScene(S, st, r) {
  S.TL = Math.max(2, st.trail | 0);
  applyParams(S, st);
  S.t = 0; S.grab = null; S.acc = 0;
  let L, m;
  if (st.preset === 'random') {
    const n = st.links; L = []; m = [];
    for (let i = 0; i < n; i++) { L.push(0.4 + r()); m.push(0.05 + 0.95 * r()); }
    const sum = L.reduce((a, b) => a + b, 0); L = L.map(v => v / sum * (0.36 + 0.08 * r()));
  } else { L = PRESETS[st.preset].L.slice(); m = PRESETS[st.preset].m.slice(); }
  const n = L.length, ang = [];
  for (let i = 0; i < n; i++) {
    if (st.start === 'upstream') ang.push(i === 0 ? 0.5 * Math.PI : Math.PI);
    else if (st.start === 'up') ang.push(Math.PI + (r() - 0.5) * 0.4);
    else if (st.start === 'side') ang.push(0.5 * Math.PI + (r() - 0.5) * 0.3);
    else ang.push(2 * Math.PI * r());
  }
  S.list = [makePendulum('pbd', m, L, ang, S)];
  if (n === 3) S.list.push(makePendulum('analytic', m, L, ang, S));
  if (st.twin) { const a2 = ang.slice(); a2[n - 1] += Math.pow(10, st.delta); S.list.push(makePendulum('twin', m, L, a2, S)); }
  S.E0 = energy(S, S.list[0]);
}

// Upstream simulatePBD: predict, correct each link, update velocity.
function pbdStep(S, p, dt) {
  const g = -S.P.g, n = p.x.length, G = S.grab && S.grab.p === p ? S.grab : null;
  for (let i = 1; i < n; i++) {
    if (G && G.i === i) continue;
    p.vy[i] += dt * g;
    p.px[i] = p.x[i]; p.py[i] = p.y[i];
    p.x[i] += p.vx[i] * dt; p.y[i] += p.vy[i] * dt;
  }
  if (G) { p.px[G.i] = p.x[G.i]; p.py[G.i] = p.y[G.i]; p.x[G.i] = G.x; p.y[G.i] = G.y; }
  for (let i = 1; i < n; i++) {
    const dx = p.x[i] - p.x[i - 1], dy = p.y[i] - p.y[i - 1], d = Math.sqrt(dx * dx + dy * dy);
    let w0 = p.m[i - 1] > 0 ? 1 / p.m[i - 1] : 0, w1 = p.m[i] > 0 ? 1 / p.m[i] : 0;
    if (G) { if (G.i === i) w1 = 0; if (G.i === i - 1) w0 = 0; }
    if (w0 + w1 === 0 || d < 1e-12) continue;
    const corr = (p.L[i] - d) / d / (w0 + w1);
    p.x[i - 1] -= w0 * corr * dx; p.y[i - 1] -= w0 * corr * dy;
    p.x[i] += w1 * corr * dx; p.y[i] += w1 * corr * dy;
  }
  for (let i = 1; i < n; i++) { p.vx[i] = (p.x[i] - p.px[i]) / dt; p.vy[i] = (p.y[i] - p.py[i]) / dt; }
}

// Upstream simulateAnalytic: the Lagrange equations of the triple
// pendulum, solved for the angular accelerations by Cramer's rule, then a
// symplectic Euler step of the angles.
function analyticStep(S, p, dt) {
  const g = S.P.g;
  const m1 = p.m[1], m2 = p.m[2], m3 = p.m[3], l1 = p.L[1], l2 = p.L[2], l3 = p.L[3];
  const t1 = p.th[1], t2 = p.th[2], t3 = p.th[3], w1 = p.om[1], w2 = p.om[2], w3 = p.om[3];
  const sin = Math.sin, cos = Math.cos;
  let b1 = g*l1*m1*sin(t1) + g*l1*m2*sin(t1) + g*l1*m3*sin(t1) + m2*l1*l2*sin(t1-t2)*w1*w2 +
    m3*l1*l3*sin(t1-t3)*w1*w3 + m3*l1*l2*sin(t1-t2)*w1*w2 +
    m2*l1*l2*sin(t2-t1)*(w1-w2)*w2 + m3*l1*l2*sin(t2-t1)*(w1-w2)*w2 + m3*l1*l3*sin(t3-t1)*(w1-w3)*w3;
  const a11 = l1*l1*(m1+m2+m3), a12 = m2*l1*l2*cos(t1-t2) + m3*l1*l2*cos(t1-t2), a13 = m3*l1*l3*cos(t1-t3);
  let b2 = g*l2*m2*sin(t2) + g*l2*m3*sin(t2) + w1*w2*l1*l2*sin(t2-t1)*(m2 + m3) + m3*l2*l3*sin(t2-t3)*w2*w3 +
    (m2 + m3)*l1*l2*sin(t2-t1)*(w1-w2)*w1 + m3*l2*l3*sin(t3-t2)*(w2-w3)*w3;
  const a21 = (m2 + m3)*l1*l2*cos(t2-t1), a22 = l2*l2*(m2+m3), a23 = m3*l2*l3*cos(t2-t3);
  let b3 = m3*g*l3*sin(t3) - m3*l2*l3*sin(t2-t3)*w2*w3 - m3*l1*l3*sin(t1-t3)*w1*w3 +
    m3*l1*l3*sin(t3-t1)*(w1-w3)*w1 + m3*l2*l3*sin(t3-t2)*(w2-w3)*w2;
  const a31 = m3*l1*l3*cos(t1-t3), a32 = m3*l2*l3*cos(t2-t3), a33 = m3*l3*l3;
  b1 = -b1; b2 = -b2; b3 = -b3;
  const det = a11 * (a22 * a33 - a23 * a32) + a21 * (a32 * a13 - a33 * a12) + a31 * (a12 * a23 - a13 * a22);
  if (det === 0) return;
  const A1 = (b1 * (a22 * a33 - a23 * a32) + b2 * (a32 * a13 - a33 * a12) + b3 * (a12 * a23 - a13 * a22)) / det;
  const A2 = (b1 * (a23 * a31 - a21 * a33) + b2 * (a33 * a11 - a31 * a13) + b3 * (a13 * a21 - a11 * a23)) / det;
  const A3 = (b1 * (a21 * a32 - a22 * a31) + b2 * (a31 * a12 - a32 * a11) + b3 * (a11 * a22 - a12 * a21)) / det;
  p.om[1] += A1 * dt; p.om[2] += A2 * dt; p.om[3] += A3 * dt;
  p.th[1] += p.om[1] * dt; p.th[2] += p.om[2] * dt; p.th[3] += p.om[3] * dt;
  let x = 0, y = 0;
  for (let i = 1; i <= 3; i++) {
    const nx = x + p.L[i] * sin(p.th[i]), ny = y - p.L[i] * cos(p.th[i]);
    p.vx[i] = (nx - p.x[i]) / dt; p.vy[i] = (ny - p.y[i]) / dt;
    x = nx; y = ny; p.x[i] = x; p.y[i] = y;
  }
}

function record(S) {
  for (const p of S.list) { const k = p.tN % S.TL, e = p.x.length - 1; p.tx[k] = p.x[e]; p.ty[k] = p.y[e]; p.tN++; }
}

// One frame: upstream sim time 0.01 s x time scale, split into substeps.
export function step(S, h) {
  // timeScale = simulated seconds per real second (0.6 = upstream: 0.01 s per 60 Hz frame)
  const P = S.P, n = Math.max(1, P.sub), T = h * P.timeScale, dt = T / n;
  const gap = Math.max(1, Math.floor(n / 10));
  for (let s = 0; s < n; s++) {
    for (const p of S.list) { if (p.kind !== 'analytic') pbdStep(S, p, dt); else if (P.analytic) analyticStep(S, p, dt); }
    if (s % gap === 0) record(S);
  }
  S.t += T;
}

export function energy(S, p) {
  let E = 0;
  for (let i = 1; i < p.x.length; i++) E += p.m[i] * (0.5 * (p.vx[i] ** 2 + p.vy[i] ** 2) + S.P.g * p.y[i]);
  return E;
}
export function health(S) {
  let bad = 0, out = 0;
  for (const p of S.list) for (let i = 0; i < p.x.length; i++) { if (!Number.isFinite(p.x[i] + p.y[i])) bad++; else if (Math.abs(p.x[i]) > W / 2 + 0.05 || Math.abs(p.y[i]) > H / 2 + 0.05) out++; }
  return { bad, out };
}
export function pick(S, x, y) {
  let best = null, bd = 0.04;
  for (const p of S.list) { if (p.kind === 'analytic') continue; for (let i = 1; i < p.x.length; i++) { const d = Math.hypot(p.x[i] - x, p.y[i] - y); if (d < bd) { bd = d; best = { p, i, x, y }; } } }
  return best;
}
