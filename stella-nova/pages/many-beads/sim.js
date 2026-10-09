/*
Copyright 2021 Matthias Müller - Ten Minute Physics

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
// Pendulum in 100 Lines · upstream script 1, verbatim from Ten Minute Physics
// 06-pendulumShort.html by Matthias Müller. MIT License (notice kept above).
// ============================================================================
//  MANY BEADS  ·  pages/many-beads/sim.js — simulation and scene rules
// ----------------------------------------------------------------------------
//  UPSTREAM. Ten Minute Physics #05 "manyBeads" by Matthias Müller (MIT,
//  notice above): beads of random size on a circular wire, each substep
//  startStep (gravity), keepOnWire (project to the circle), endStep
//  (v = dx/dt), then the bead-bead collisions: push apart by half the
//  overlap each and exchange the normal velocity with restitution, by
//  mass. Those steps are in step() and collide() below.
//
//  OUR ADDITIONS (davesgames.io, not upstream): concentric rings, bead
//  counts, sizes and mass rules, start patterns (the Newton's cradle),
//  restitution, friction, gravity tilt, a shake, adding beads, dragging,
//  trails, the schema and random rules for the sim kit, and a guard.
//
//  grep -n targets: "export function makeSchema", "export function guard",
//  "export function buildScene", "function collide", "export function step"
// ============================================================================
import * as K from '../../widgets/sim-kit/core.js';

export const W = 2.4, H = 2.0;
const CX = W / 2, CY = H / 2, R0 = 0.82;

export function makeSchema(PHONE) {
  return { groups: [
    { id: 'beads', label: 'Beads', hint: 'Drag a bead along its wire. Tap the wire to add a bead.', controls: [
      { key: 'rings', type: 'range', label: 'Wires', min: 1, max: 3, step: 1, value: 1, rebuild: true, random: { dist: 'int', min: 1, max: 3 } },
      { key: 'count', type: 'range', label: 'Beads per wire', min: 2, max: PHONE ? 30 : 48, step: 1, value: 5, rebuild: true, random: { dist: 'int', min: 3, max: PHONE ? 20 : 32 } },
      { key: 'rMin', type: 'range', label: 'Smallest bead', min: 0.02, max: 0.12, step: 0.005, value: 0.05, unit: 'm', rebuild: true, random: { min: 0.03, max: 0.08 } },
      { key: 'rMax', type: 'range', label: 'Largest bead', min: 0.03, max: 0.2, step: 0.005, value: 0.15, unit: 'm', rebuild: true, random: { min: 0.06, max: 0.16 } },
      { key: 'massRule', type: 'choice', label: 'Mass', value: 'area', options: [{ id: 'area', label: 'By area (upstream)' }, { id: 'equal', label: 'Equal' }, { id: 'inverse', label: 'Small is heavy' }], rebuild: true, random: { weights: { area: 3, equal: 1, inverse: 1 } } },
      { key: 'start', type: 'choice', label: 'Start', value: 'upstream', seg: false, options: [{ id: 'upstream', label: 'Half circle (upstream)' }, { id: 'cradle', label: "Newton's cradle" }, { id: 'random', label: 'Random' }, { id: 'cluster', label: 'One cluster' }, { id: 'spin', label: 'Spinning' }], rebuild: true, random: { weights: { upstream: 2, cradle: 2, random: 3, cluster: 2, spin: 2 } } },
      { type: 'buttons', key: 'act', label: 'Do', action: 'act', items: [{ id: 'shake', label: 'Shake' }, { id: 'add', label: 'Add a bead' }, { id: 'kick', label: 'Kick one' }] },
    ] },
    { id: 'physics', label: 'Physics', controls: [
      { key: 'e', type: 'range', label: 'Restitution', min: 0, max: 1, step: 0.01, value: 1, random: { min: 0.6, max: 1 } },
      { key: 'friction', type: 'range', label: 'Wire friction', min: 0, max: 0.5, step: 0.005, value: 0, unit: '1/s', random: { min: 0, max: 0.06 } },
      { key: 'g', type: 'range', label: 'Gravity', min: 1, max: 25, step: 0.1, value: 10, unit: 'm/s²', random: { dist: 'normal', mean: 10, sd: 3, min: 4, max: 20 } },
      { key: 'tilt', type: 'range', label: 'Gravity tilt', min: -45, max: 45, step: 1, value: 0, unit: '°', random: { dist: 'normal', mean: 0, sd: 8, min: -30, max: 30 } },
      { key: 'turn', type: 'range', label: 'Turn gravity', min: -60, max: 60, step: 1, value: 0, unit: '°/s', random: { dist: 'normal', mean: 0, sd: 8, min: -30, max: 30 } },
    ] },
    { id: 'look', label: 'Look', controls: [
      { key: 'colorBy', type: 'choice', label: 'Colour by', value: 'palette', seg: false, options: [{ id: 'palette', label: 'Palette' }, { id: 'speed', label: 'Speed' }, { id: 'mass', label: 'Mass' }, { id: 'wire', label: 'Wire' }], random: { weights: { palette: 3, speed: 2, mass: 1, wire: 1 } } },
      { key: 'cmap', type: 'cmap', label: 'Colour map', value: 'viridis' },
      { key: 'trail', type: 'range', label: 'Trail', min: 0, max: 120, step: 1, value: 30, random: { min: 0, max: 90 } },
      { key: 'flash', type: 'toggle', label: 'Flash on impact', value: true, random: { p: 0.75 } },
      { key: 'glow', type: 'toggle', label: 'Glow', value: true, random: { p: 0.6 } },
      K.themeControl('night'),
      K.paletteControl('toybox', { random: { pick: ['toybox', 'neon', 'sunset', 'harbour', 'pastel'], rnd: 0.3 } }),
    ] },
    { id: 'solver', label: 'Solver', open: false, random: false, controls: [
      { key: 'sub', type: 'range', label: 'Substeps per frame', min: 1, max: 200, step: 1, value: PHONE ? 50 : 100, phone: 50 },
      { type: 'note', text: 'Each substep: gravity, back onto the wire, v = Δx/Δt, then the bead-bead collisions (Ten Minute Physics #05).' },
    ] },
  ] };
}
export const REBUILD = new Set(['rings', 'count', 'rMin', 'rMax', 'massRule', 'start']);

// The beads of one wire must fit on it with room to move.
export function guard(next) {
  const s = Object.assign({}, next);
  if (s.rMax < s.rMin) { const t = s.rMax; s.rMax = s.rMin; s.rMin = t; }
  const rInner = R0 * (s.rings === 3 ? 0.38 : s.rings === 2 ? 0.55 : 1);
  const room = 2 * Math.PI * rInner * 0.7, q = v => Math.round(v * 200) / 200;
  if (s.count * (s.rMin + s.rMax) > room) {
    const k = room / (s.count * (s.rMin + s.rMax));
    s.rMin = Math.max(0.02, q(Math.floor(200 * s.rMin * k) / 200)); s.rMax = Math.max(0.03, q(s.rMin + 0.005), q(Math.floor(200 * s.rMax * k) / 200));
  }
  // still too full at the smallest sizes: fewer beads
  if (s.count * (s.rMin + s.rMax) > room) s.count = Math.max(2, Math.floor(room / (s.rMin + s.rMax)));
  if (s.rings * s.count * s.sub > 9000) s.count = Math.max(2, Math.floor(9000 / (s.rings * s.sub)));
  return s;
}
export const sceneRng = seed => K.rng((seed ^ 0x9b05688c) >>> 0);

export function createSim() { return { b: [], wires: [], t: 0, P: {}, grab: null, hits: 0, TL: 2 }; }
export function applyParams(S, st) {
  Object.assign(S.P, { g: st.g, tilt: st.tilt * Math.PI / 180, turn: st.turn * Math.PI / 180, e: st.e, friction: st.friction, sub: Math.max(1, st.sub | 0) });
  const TL = Math.max(2, st.trail | 0);
  if (S.TL !== TL) { S.TL = TL; for (const b of S.b) { b.tx = new Float32Array(TL); b.ty = new Float32Array(TL); b.tN = 0; } }
}
function bead(S, w, ang, r, m, v) {
  const R = S.wires[w];
  return { w, x: CX + R * Math.cos(ang), y: CY + R * Math.sin(ang), px: 0, py: 0, vx: -Math.sin(ang) * v, vy: Math.cos(ang) * v, r, m, hit: 0, c: S.b.length, tx: new Float32Array(S.TL), ty: new Float32Array(S.TL), tN: 0 };
}
const massOf = (st, r) => st.massRule === 'equal' ? 0.02 : st.massRule === 'inverse' ? 0.0004 / r : Math.PI * r * r;

export function buildScene(S, st, r) {
  S.TL = Math.max(2, st.trail | 0);
  applyParams(S, st);
  S.t = 0; S.grab = null; S.b = []; S.hits = 0; S.gang = 0;
  S.wires = st.rings === 1 ? [R0] : st.rings === 2 ? [R0, R0 * 0.55] : [R0, R0 * 0.68, R0 * 0.38];
  for (let w = 0; w < S.wires.length; w++) {
    const R = S.wires[w], n = st.count;
    const rads = Array.from({ length: n }, (_, i) => (i === 0 && st.start === 'upstream' ? Math.min(st.rMax, 0.1) : st.rMin + (st.rMax - st.rMin) * r()));
    if (st.start === 'cradle') {
      const rr = (st.rMin + st.rMax) / 2;
      let ang = -Math.PI / 2 - (n - 1) * rr / R;
      for (let i = 0; i < n; i++) { const a = i === 0 ? ang - 0.9 : ang; S.b.push(bead(S, w, a, rr, massOf(st, rr), 0)); ang += 2 * rr / R * 1.001; }
    } else if (st.start === 'upstream') {
      let ang = 0;
      for (let i = 0; i < n; i++) { S.b.push(bead(S, w, ang, rads[i], massOf(st, rads[i]), 0)); ang += Math.PI / n; }
    } else if (st.start === 'cluster') {
      let ang = r() * 2 * Math.PI;
      for (let i = 0; i < n; i++) { S.b.push(bead(S, w, ang, rads[i], massOf(st, rads[i]), 0)); ang += (rads[i] + (rads[i + 1] || rads[i])) / R * 1.02; }
    } else {
      // random or spinning: spread evenly with jitter (no overlaps)
      for (let i = 0; i < n; i++) { const a = 2 * Math.PI * (i + 0.35 * (r() - 0.5)) / n; const v = st.start === 'spin' ? (w % 2 ? -1 : 1) * (3 + 2 * r()) : (r() - 0.5) * 4; S.b.push(bead(S, w, a, rads[i], massOf(st, rads[i]), v)); }
    }
  }
  S.E0 = energy(S);
}

// Upstream handleBeadBeadCollision (with our restitution).
function collide(S, a, b) {
  let dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy);
  if (d === 0 || d > a.r + b.r) return;
  dx /= d; dy /= d;
  const corr = (a.r + b.r - d) / 2;
  a.x -= dx * corr; a.y -= dy * corr; b.x += dx * corr; b.y += dy * corr;
  const v1 = a.vx * dx + a.vy * dy, v2 = b.vx * dx + b.vy * dy, m1 = a.m, m2 = b.m, e = S.P.e;
  const n1 = (m1 * v1 + m2 * v2 - m2 * (v1 - v2) * e) / (m1 + m2), n2 = (m1 * v1 + m2 * v2 - m1 * (v2 - v1) * e) / (m1 + m2);
  a.vx += dx * (n1 - v1); a.vy += dy * (n1 - v1); b.vx += dx * (n2 - v2); b.vy += dy * (n2 - v2);
  if (v1 - v2 > 0.3) { a.hit = b.hit = Math.min(1, (v1 - v2) / 3); S.hits++; }
}

export function step(S, h) {
  const P = S.P, n = P.sub, dt = h / n;
  S.gang += P.turn * h;
  const ga = P.tilt + S.gang, gx = P.g * Math.sin(ga), gy = -P.g * Math.cos(ga);
  const f = P.friction ? Math.exp(-P.friction * dt) : 1;
  for (let s = 0; s < n; s++) {
    for (const b of S.b) { b.vx += gx * dt; b.vy += gy * dt; b.px = b.x; b.py = b.y; b.x += b.vx * dt; b.y += b.vy * dt; }
    if (S.grab) { const b = S.grab.b; b.x = S.grab.x; b.y = S.grab.y; }
    for (const b of S.b) { const dx = b.x - CX, dy = b.y - CY, len = Math.hypot(dx, dy); if (len > 0) { const lam = S.wires[b.w] - len; b.x += dx / len * lam; b.y += dy / len * lam; } }
    for (const b of S.b) { b.vx = (b.x - b.px) / dt * f; b.vy = (b.y - b.py) / dt * f; }
    for (let i = 0; i < S.b.length; i++) for (let j = 0; j < i; j++) if (S.b[i].w === S.b[j].w) collide(S, S.b[i], S.b[j]);
  }
  for (const b of S.b) { b.hit = Math.max(0, b.hit - h * 3); const k = b.tN % S.TL; b.tx[k] = b.x; b.ty[k] = b.y; b.tN++; }
  S.t += h;
}
export function energy(S) { let E = 0; for (const b of S.b) E += b.m * (0.5 * (b.vx ** 2 + b.vy ** 2) + S.P.g * (b.y - CY)); return E; }
export function shake(S, r) { for (const b of S.b) { const k = (r() - 0.5) * 6; b.vx += -(b.y - CY) / S.wires[b.w] * k; b.vy += (b.x - CX) / S.wires[b.w] * k; } }
export function kick(S, r) { if (!S.b.length) return; const b = S.b[Math.floor(r() * S.b.length)], k = (r() < 0.5 ? -1 : 1) * 6; b.vx += -(b.y - CY) / S.wires[b.w] * k; b.vy += (b.x - CX) / S.wires[b.w] * k; b.hit = 1; }
export function addBead(S, st, x, y, r) {
  const d = Math.hypot(x - CX, y - CY); let w = 0, bd = 1e9; S.wires.forEach((R, k) => { if (Math.abs(R - d) < bd) { bd = Math.abs(R - d); w = k; } });
  if (bd > 0.15) return false;
  const rad = st.rMin + (st.rMax - st.rMin) * r(), ang = Math.atan2(y - CY, x - CX);
  for (const b of S.b) if (b.w === w && Math.hypot(b.x - (CX + S.wires[w] * Math.cos(ang)), b.y - (CY + S.wires[w] * Math.sin(ang))) < b.r + rad) return false;
  S.b.push(bead(S, w, ang, rad, massOf(st, rad), 0)); return true;
}
export function health(S) {
  let bad = 0, out = 0, overlap = 0;
  for (const b of S.b) { if (!Number.isFinite(b.x + b.y + b.vx + b.vy)) bad++; else if (Math.abs(Math.hypot(b.x - CX, b.y - CY) - S.wires[b.w]) > 1e-3) out++; }
  for (let i = 0; i < S.b.length; i++) for (let j = 0; j < i; j++) { const a = S.b[i], b = S.b[j]; if (a.w === b.w && Math.hypot(a.x - b.x, a.y - b.y) < 0.9 * (a.r + b.r)) overlap++; }
  return { bad, out, overlap };
}
export function pick(S, x, y) { let best = null, bd = 0.2; for (const b of S.b) { const d = Math.hypot(b.x - x, b.y - y); if (d < Math.max(bd, b.r)) { bd = d; best = { b, x, y }; } } return best; }
export const CENTER = [CX, CY];
