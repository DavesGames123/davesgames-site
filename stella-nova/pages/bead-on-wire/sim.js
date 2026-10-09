/*
Copyright 2021 Matthias Müller - Ten Minute Physics

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
// Pendulum in 100 Lines · upstream script 1, verbatim from Ten Minute Physics
// 06-pendulumShort.html by Matthias Müller. MIT License (notice kept above).
// ============================================================================
//  BEAD ON A WIRE  ·  pages/bead-on-wire/sim.js — simulation and scene rules
// ----------------------------------------------------------------------------
//  UPSTREAM. Ten Minute Physics #05 "bead" by Matthias Müller (MIT, notice
//  above): a bead on a circular wire by position based dynamics (red)
//  against the analytic pendulum equation (green), 1000 substeps per
//  frame, with the constraint force of each. startStep / keepOnWire /
//  endStep below are the upstream Bead methods; analyticStep() is the
//  upstream AnalyticBead.simulate.
//
//  OUR ADDITIONS (davesgames.io, not upstream): wire shapes (ellipse,
//  rounded square, wave track) with a closest-point projection, several
//  beads, start speeds, wire friction, force arrows, trails, dragging,
//  the schema and random rules for the sim kit, and a guard. No DOM.
//
//  grep -n targets: "export function makeSchema", "export function guard",
//  "function curvePoint", "function project", "function keepOnWire",
//  "function analyticStep", "export function step"
// ============================================================================
import * as K from '../../widgets/sim-kit/core.js';

export const W = 2.4, H = 2.0;

export function makeSchema(PHONE) {
  return { groups: [
    { id: 'wire', label: 'Wire', hint: 'Red: PBD. Green: the analytic solution (circle only). Drag a bead to move it along the wire.', controls: [
      { key: 'shape', type: 'choice', label: 'Shape', value: 'circle', seg: false, options: [{ id: 'circle', label: 'Circle (upstream)' }, { id: 'ellipse', label: 'Ellipse' }, { id: 'squircle', label: 'Rounded square' }, { id: 'wave', label: 'Wave track' }, { id: 'heart', label: 'Heart' }], rebuild: true, random: { weights: { circle: 3, ellipse: 2, squircle: 2, wave: 2, heart: 1 } } },
      { key: 'size', type: 'range', label: 'Size', min: 0.4, max: 0.9, step: 0.01, value: 0.8, unit: 'm', rebuild: true, random: { min: 0.55, max: 0.9 } },
      { key: 'aspect', type: 'range', label: 'Aspect', min: 0.4, max: 1.6, step: 0.01, value: 1, rebuild: true, random: { min: 0.55, max: 1.45 } },
    ] },
    { id: 'beads', label: 'Beads', controls: [
      { key: 'beads', type: 'range', label: 'Beads', min: 1, max: 8, step: 1, value: 1, rebuild: true, random: { dist: 'int', min: 1, max: 6 } },
      { key: 'start', type: 'range', label: 'Start angle', min: 0, max: 180, step: 1, value: 90, unit: '°', rebuild: true, random: { min: 20, max: 175 } },
      { key: 'v0', type: 'range', label: 'Start speed', min: 0, max: 12, step: 0.1, value: 0, unit: 'm/s', rebuild: true, random: { dist: 'normal', mean: 1.5, sd: 2.5, min: 0, max: 9 } },
      { key: 'analytic', type: 'toggle', label: 'Analytic twin', value: true, random: { p: 0.7 } },
      { key: 'friction', type: 'range', label: 'Wire friction', min: 0, max: 0.6, step: 0.01, value: 0, unit: '1/s', random: { min: 0, max: 0.15 } },
    ] },
    { id: 'world', label: 'World', controls: [
      { key: 'g', type: 'range', label: 'Gravity', min: 1, max: 25, step: 0.1, value: 10, unit: 'm/s²', random: { dist: 'normal', mean: 10, sd: 3, min: 4, max: 20 } },
      { key: 'tilt', type: 'range', label: 'Gravity tilt', min: -30, max: 30, step: 1, value: 0, unit: '°', random: { dist: 'normal', mean: 0, sd: 6, min: -20, max: 20 } },
      { key: 'timeScale', type: 'range', label: 'Time scale', min: 0.2, max: 1.5, step: 0.05, value: 1, random: { min: 0.6, max: 1.2 } },
    ] },
    { id: 'look', label: 'Look', controls: [
      { key: 'arrows', type: 'toggle', label: 'Force arrows', value: true, random: { p: 0.7 } },
      { key: 'trail', type: 'range', label: 'Trail', min: 0, max: 600, step: 10, value: 160, random: { min: 40, max: 500 } },
      { key: 'colorBy', type: 'choice', label: 'Colour by', value: 'palette', options: [{ id: 'palette', label: 'Palette' }, { id: 'speed', label: 'Speed' }, { id: 'force', label: 'Force' }], random: { weights: { palette: 2, speed: 1, force: 1 } } },
      { key: 'cmap', type: 'cmap', label: 'Colour map', value: 'plasma' },
      { key: 'glow', type: 'toggle', label: 'Glow', value: true, random: { p: 0.7 } },
      { key: 'grid', type: 'toggle', label: 'Grid', value: true, random: { p: 0.4 } },
      K.themeControl('night'),
      K.paletteControl('toybox', { random: { pick: ['toybox', 'neon', 'sunset', 'harbour', 'pastel'], rnd: 0.3 } }),
    ] },
    { id: 'solver', label: 'Solver', open: false, random: false, controls: [
      { key: 'sub', type: 'choice', label: 'Substeps per frame', value: PHONE ? '200' : '1000', phone: '200', options: ['1', '10', '100', '200', '1000'] },
      { type: 'note', text: 'Each substep: predict with gravity, move the bead back onto the wire, v = (x − x_prev)/Δt. The constraint force is λ/Δt² (Ten Minute Physics #05).' },
    ] },
  ] };
}
export const REBUILD = new Set(['shape', 'size', 'aspect', 'beads', 'start', 'v0']);

export function guard(next) {
  const s = Object.assign({}, next);
  if (s.shape === 'circle') s.aspect = 1;
  // a fast start on a wave track flies off its open ends: slower there
  if (s.shape === 'wave') s.v0 = Math.min(s.v0, 5);
  return s;
}
export const sceneRng = seed => K.rng((seed ^ 0x6a09e667) >>> 0);

// ---- the wire ------------------------------------------------------------------
// A closed curve over t in [0, 2 pi) (the wave track is open, t in [-1, 1]).
function curvePoint(C, t, out) {
  const { cx, cy, a, b } = C;
  if (C.type === 'circle' || C.type === 'ellipse') { out[0] = cx + a * Math.sin(t); out[1] = cy - b * Math.cos(t); }
  else if (C.type === 'squircle') { const s = Math.sin(t), c = Math.cos(t), k = 1 / Math.pow(s ** 4 + c ** 4, 0.25); out[0] = cx + a * s * k; out[1] = cy - b * c * k; }
  else if (C.type === 'heart') { const s = Math.sin(t), c = Math.cos(t); out[0] = cx + a * 0.95 * s ** 3; out[1] = cy - b * (0.8 * c - 0.3 * Math.cos(2 * t) - 0.12 * Math.cos(3 * t) - 0.05 * Math.cos(4 * t)) * 0.95 - b * 0.1; }
  else { out[0] = cx + a * t; out[1] = cy - b * 0.55 * Math.cos(Math.PI * 1.5 * t) + b * 0.25 * t * t; }
  return out;
}
const tmp0 = [0, 0], tmp1 = [0, 0];
function curveDeriv(C, t, out) { const e = 1e-5; curvePoint(C, t + e, tmp0); curvePoint(C, t - e, tmp1); out[0] = (tmp0[0] - tmp1[0]) / (2 * e); out[1] = (tmp0[1] - tmp1[1]) / (2 * e); return out; }

// The closest curve parameter to point (x, y), from a start guess: a
// coarse scan around the guess, then a few Newton steps.
const P0 = [0, 0], D0 = [0, 0];
function project(C, x, y, t0, scan = true) {
  let best = t0, bd = Infinity;
  if (!scan) bd = -1;
  const span = C.closed ? Math.PI : 0.6, N = 24;
  for (let k = -N; k <= N && scan; k++) {
    let t = t0 + span * k / N; if (!C.closed) t = Math.max(-1, Math.min(1, t));
    curvePoint(C, t, P0); const d = (P0[0] - x) ** 2 + (P0[1] - y) ** 2;
    if (d < bd) { bd = d; best = t; }
  }
  let t = best;
  for (let k = 0; k < (scan ? 6 : 3); k++) {
    curvePoint(C, t, P0); curveDeriv(C, t, D0);
    const fx = P0[0] - x, fy = P0[1] - y, g = fx * D0[0] + fy * D0[1], h = D0[0] ** 2 + D0[1] ** 2 + 1e-9;
    t -= g / h; if (!C.closed) t = Math.max(-1, Math.min(1, t));
  }
  return t;
}

export function createSim() { return { beads: [], twins: [], C: null, t: 0, P: {}, grab: null, TL: 2 }; }
export function applyParams(S, st) {
  const a = st.tilt * Math.PI / 180;
  Object.assign(S.P, { gx: st.g * Math.sin(a), gy: -st.g * Math.cos(a), g: st.g, friction: st.friction, timeScale: st.timeScale, sub: Math.max(1, +st.sub | 0), analytic: st.analytic });
  const TL = Math.max(2, st.trail | 0);
  if (S.TL !== TL) { S.TL = TL; for (const b of S.beads.concat(S.twins)) { b.tx = new Float32Array(TL); b.ty = new Float32Array(TL); b.tN = 0; } }
}

export function buildScene(S, st, r) {
  S.TL = Math.max(2, st.trail | 0);
  applyParams(S, st);
  const R = st.size, asp = st.shape === 'circle' ? 1 : st.aspect;
  S.C = { type: st.shape, cx: W / 2, cy: H / 2, a: st.shape === 'wave' ? 1.05 : R * Math.sqrt(asp), b: st.shape === 'wave' ? 0.7 : R / Math.sqrt(asp), closed: st.shape !== 'wave' };
  if (st.shape === 'circle') { S.C.a = S.C.b = R; }
  // keep the wire inside the box
  const fitK = Math.min(1, (W / 2 - 0.12) / S.C.a, (H / 2 - 0.1) / S.C.b); S.C.a *= fitK; S.C.b *= fitK;
  S.t = 0; S.grab = null; S.beads = []; S.twins = [];
  const n = st.beads, ang0 = st.start * Math.PI / 180;
  for (let i = 0; i < n; i++) {
    const tt = S.C.closed ? ang0 + (i ? (2 * Math.PI * i / n) * (0.6 + 0.4 * r()) : 0) : Math.max(-0.95, Math.min(0.95, -0.9 + 1.8 * (i + 0.5) / n));
    const p = curvePoint(S.C, tt, [0, 0]), d = curveDeriv(S.C, tt, [0, 0]), dl = Math.hypot(d[0], d[1]) || 1;
    const v = st.v0 * (i ? 0.6 + 0.8 * r() : 1);
    S.beads.push({ x: p[0], y: p[1], px: p[0], py: p[1], vx: d[0] / dl * v, vy: d[1] / dl * v, t: tt, m: 1, r: 0.06, force: 0, c: i, tx: new Float32Array(S.TL), ty: new Float32Array(S.TL), tN: 0 });
    if (st.shape === 'circle') S.twins.push({ angle: tt, omega: v / S.C.a, force: 0, R: S.C.a, c: i, x: p[0], y: p[1], tx: new Float32Array(S.TL), ty: new Float32Array(S.TL), tN: 0 });
  }
}

// Upstream Bead.startStep / keepOnWire / endStep (the wire is any curve
// here; on the circle the projection is the upstream one exactly).
function keepOnWire(S, b) {
  const C = S.C;
  let nx, ny, lam;
  if (C.type === 'circle') {
    const dx = b.x - C.cx, dy = b.y - C.cy, len = Math.hypot(dx, dy);
    if (len === 0) return 0;
    lam = C.a - len; b.x += dx / len * lam; b.y += dy / len * lam; b.t = Math.atan2(dx, -dy);
    const sg = lam >= 0 ? 1 : -1; b.nx = dx / len * sg; b.ny = dy / len * sg;
    return lam;
  }
  b.t = project(C, b.x, b.y, b.t, !!b.scan); b.scan = false;
  curvePoint(C, b.t, P0);
  nx = P0[0] - b.x; ny = P0[1] - b.y; lam = Math.hypot(nx, ny);
  if (lam > 1e-15) { b.nx = nx / lam; b.ny = ny / lam; }
  b.x = P0[0]; b.y = P0[1];
  return lam;
}
function analyticStep(S, a, dt) {
  // the upstream AnalyticBead.simulate (gravity straight down)
  const g = S.P.g, acc = -g / a.R * Math.sin(a.angle);
  a.omega += acc * dt; a.angle += a.omega * dt;
  if (S.P.friction) a.omega *= Math.exp(-S.P.friction * dt);
  a.force = a.omega * a.omega * a.R + Math.cos(a.angle) * Math.abs(g);
  a.x = S.C.cx + Math.sin(a.angle) * a.R; a.y = S.C.cy - Math.cos(a.angle) * a.R;
}

export function step(S, h) {
  const P = S.P, n = P.sub, T = h * P.timeScale, dt = T / n, gap = Math.max(1, Math.floor(n / 4));
  const twinsOn = P.analytic && S.C.type === 'circle' && Math.abs(P.gx) < 1e-9;
  for (let s = 0; s < n; s++) {
    for (const b of S.beads) {
      if (S.grab && S.grab.b === b) { b.px = b.x; b.py = b.y; b.x = S.grab.x; b.y = S.grab.y; b.scan = true; keepOnWire(S, b); b.vx = (b.x - b.px) / dt; b.vy = (b.y - b.py) / dt; continue; }
      b.vx += P.gx * dt; b.vy += P.gy * dt;
      b.px = b.x; b.py = b.y;
      b.x += b.vx * dt; b.y += b.vy * dt;
      const lam = keepOnWire(S, b);
      b.force = Math.abs(lam / dt / dt) * b.m;
      const f = P.friction ? Math.exp(-P.friction * dt) : 1;
      b.vx = (b.x - b.px) / dt * f; b.vy = (b.y - b.py) / dt * f;
      // the open wave track ends in stops
      if (!S.C.closed && Math.abs(b.t) >= 1 - 1e-9) { const d = curveDeriv(S.C, b.t, [0, 0]), l = Math.hypot(d[0], d[1]); const vt = (b.vx * d[0] + b.vy * d[1]) / l; if (vt * b.t > 0) { b.vx -= 1.6 * vt * d[0] / l; b.vy -= 1.6 * vt * d[1] / l; } }
    }
    if (twinsOn) for (const a of S.twins) analyticStep(S, a, dt);
    if (s % gap === 0) for (const b of S.beads.concat(twinsOn ? S.twins : [])) { const k = b.tN % S.TL; b.tx[k] = b.x; b.ty[k] = b.y; b.tN++; }
  }
  S.t += T;
}

// The wire as a polyline (for drawing and tests).
export function wirePoints(S, n = 240) {
  const C = S.C, out = [];
  for (let k = 0; k <= n; k++) { const t = C.closed ? 2 * Math.PI * k / n : -1 + 2 * k / n; out.push(curvePoint(C, t, [0, 0])); }
  return out;
}
export function distToWire(S, x, y) { const t = project(S.C, x, y, 0); curvePoint(S.C, t, P0); return Math.hypot(P0[0] - x, P0[1] - y); }
export function health(S) {
  let bad = 0, out = 0;
  for (const b of S.beads) { if (!Number.isFinite(b.x + b.y + b.vx + b.vy)) bad++; else if (b.x < -0.05 || b.x > W + 0.05 || b.y < -0.05 || b.y > H + 0.05) out++; }
  return { bad, out };
}
export function pick(S, x, y) {
  let best = null, bd = 0.15;
  for (const b of S.beads) { const d = Math.hypot(b.x - x, b.y - y); if (d < bd) { bd = d; best = { b, x, y }; } }
  return best;
}
