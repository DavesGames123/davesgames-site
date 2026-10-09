/*
Copyright 2021 Matthias Müller - Ten Minute Physics

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
// Pendulum in 100 Lines · upstream script 1, verbatim from Ten Minute Physics
// 06-pendulumShort.html by Matthias Müller. MIT License (notice kept above).
// ============================================================================
//  PINBALL  ·  pages/pinball/sim.js — simulation and scene rules
// ----------------------------------------------------------------------------
//  UPSTREAM. Ten Minute Physics #04 "pinball" by Matthias Müller (MIT,
//  notice above): balls under a weak gravity in a polygon table, round
//  bumpers that set the ball's normal speed to a push velocity, two
//  flippers whose moving surface sets the ball's normal speed, ball-ball
//  hits with restitution, and the closest-segment border push.
//  closestPointOnSegment, ballBall, ballObstacle, ballFlipper, ballBorder
//  and Flipper.simulate below are the upstream functions, unchanged in
//  form.
//
//  OUR ADDITIONS (davesgames.io, not upstream): random bumper fields and
//  posts, ball count, launch speeds, table tilt, flipper strength and
//  length, a drain with relaunch, an autopilot for the flippers, combos,
//  substeps, the schema and random rules for the sim kit, and a guard.
//
//  World: the upstream table, 1 wide and 1.7 tall, y up.
//
//  grep -n targets: "export function makeSchema", "export function guard",
//  "export function buildScene", "function ballFlipper", "function ballBorder",
//  "function autopilot", "export function step"
// ============================================================================
import * as K from '../../widgets/sim-kit/core.js';

export const W = 1.0, H = 1.7;

export function makeSchema(PHONE) {
  return { groups: [
    { id: 'table', label: 'Table', hint: 'Flip with Z and M, the arrow keys, or a tap on the left or right half. Tap Launch for another ball.', controls: [
      { key: 'layout', type: 'choice', label: 'Bumpers', value: 'upstream', seg: false, options: [{ id: 'upstream', label: 'Upstream (four)' }, { id: 'random', label: 'Random field' }, { id: 'triangle', label: 'Triangle' }, { id: 'pachinko', label: 'Posts (pachinko)' }, { id: 'ring', label: 'Ring' }], rebuild: true, random: { weights: { upstream: 1, random: 3, triangle: 2, pachinko: 2, ring: 1 } } },
      { key: 'nBump', type: 'range', label: 'Bumpers (random)', min: 2, max: 12, step: 1, value: 6, rebuild: true, random: { dist: 'int', min: 3, max: 9 } },
      { key: 'bumpR', type: 'range', label: 'Bumper size', min: 0.04, max: 0.14, step: 0.005, value: 0.1, unit: '', rebuild: true, random: { min: 0.05, max: 0.12 } },
      { key: 'push', type: 'range', label: 'Bumper push', min: 0.5, max: 4, step: 0.05, value: 2, unit: 'm/s', random: { min: 1.2, max: 3.2 } },
      { key: 'drain', type: 'toggle', label: 'Open drain', value: false, rebuild: true, random: { p: 0.4 } },
    ] },
    { id: 'balls', label: 'Balls', controls: [
      { key: 'balls', type: 'range', label: 'Balls', min: 1, max: 8, step: 1, value: 2, rebuild: true, random: { dist: 'int', min: 1, max: 6 } },
      { key: 'ballR', type: 'range', label: 'Ball size', min: 0.015, max: 0.05, step: 0.001, value: 0.03, rebuild: true, random: { min: 0.02, max: 0.04 } },
      { key: 'e', type: 'range', label: 'Bounce', min: 0, max: 0.9, step: 0.01, value: 0.2, random: { min: 0.1, max: 0.6 } },
      { key: 'launch', type: 'range', label: 'Launch speed', min: 2, max: 5, step: 0.05, value: 3.5, unit: 'm/s', random: { min: 3, max: 4.4 } },
      { type: 'buttons', key: 'act', label: 'Do', action: 'act', items: [{ id: 'launch', label: 'Launch a ball' }, { id: 'nudge', label: 'Nudge' }] },
    ] },
    { id: 'flippers', label: 'Flippers', controls: [
      { key: 'auto', type: 'toggle', label: 'Autopilot', value: true, random: false },
      { key: 'flipLen', type: 'range', label: 'Length', min: 0.14, max: 0.26, step: 0.005, value: 0.2, rebuild: true, random: { min: 0.17, max: 0.24 } },
      { key: 'flipW', type: 'range', label: 'Speed', min: 4, max: 20, step: 0.5, value: 10, unit: 'rad/s', random: { min: 8, max: 16 } },
      { key: 'g', type: 'range', label: 'Table tilt (gravity)', min: 1, max: 8, step: 0.1, value: 3, unit: 'm/s²', random: { min: 2.2, max: 5 } },
    ] },
    { id: 'look', label: 'Look', controls: [
      { key: 'style', type: 'choice', label: 'Style', value: 'neon', options: [{ id: 'neon', label: 'Neon' }, { id: 'classic', label: 'Classic' }, { id: 'flat', label: 'Flat' }], random: { weights: { neon: 3, classic: 2, flat: 1 } } },
      { key: 'trail', type: 'range', label: 'Trail', min: 0, max: 120, step: 1, value: 40, random: { min: 10, max: 100 } },
      { key: 'colorBy', type: 'choice', label: 'Ball colour', value: 'palette', options: [{ id: 'palette', label: 'Palette' }, { id: 'speed', label: 'Speed' }], random: { weights: { palette: 2, speed: 1 } } },
      { key: 'cmap', type: 'cmap', label: 'Colour map', value: 'plasma' },
      K.themeControl('violet'),
      K.paletteControl('neon', { random: { pick: ['toybox', 'neon', 'sunset', 'harbour', 'pastel'], rnd: 0.3 } }),
    ] },
    { id: 'solver', label: 'Solver', open: false, random: false, controls: [
      { key: 'sub', type: 'range', label: 'Substeps per frame', min: 1, max: 8, step: 1, value: 4 },
      { type: 'note', text: 'Upstream takes one step per frame; substeps stop a fast ball from passing through a flipper.' },
    ] },
  ] };
}
export const REBUILD = new Set(['layout', 'nBump', 'bumpR', 'drain', 'balls', 'ballR', 'flipLen']);

export function guard(next) {
  const s = Object.assign({}, next);
  if (s.push > 2.8 && s.g < 2.6) s.push = 2.8;     // a strong push in a flat table keeps balls up forever
  if (s.balls > 5 && s.layout === 'pachinko') s.balls = 5;
  return s;
}
export const sceneRng = seed => K.rng((seed ^ 0xbb67ae85) >>> 0);

// ---- upstream geometry ------------------------------------------------------------
function closestPointOnSegment(px, py, ax, ay, bx, by, out) {
  const abx = bx - ax, aby = by - ay; let t = abx * abx + aby * aby;
  if (t === 0) { out[0] = ax; out[1] = ay; return out; }
  t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / t));
  out[0] = ax + abx * t; out[1] = ay + aby * t; return out;
}
const CP = [0, 0];

export function createSim() { return { balls: [], obstacles: [], flippers: [], border: [], score: 0, combo: 0, comboT: 0, t: 0, P: {}, keys: [false, false], grab: null, TL: 2, lost: 0 }; }
export function applyParams(S, st) {
  Object.assign(S.P, { g: st.g, e: st.e, push: st.push, flipW: st.flipW, auto: st.auto, sub: Math.max(1, st.sub | 0), launch: st.launch });
  for (const o of S.obstacles) if (!o.post) o.pushVel = st.push;
  for (const f of S.flippers) f.angularVelocity = st.flipW;
  const TL = Math.max(2, st.trail | 0);
  if (S.TL !== TL) { S.TL = TL; for (const b of S.balls) { b.tx = new Float32Array(TL); b.ty = new Float32Array(TL); b.tN = 0; } }
}
function makeBall(S, x, y, vx, vy, r, c) { return { x, y, vx, vy, r, m: Math.PI * r * r, c, tx: new Float32Array(S.TL), ty: new Float32Array(S.TL), tN: 0 }; }

export function buildScene(S, st, r) {
  S.TL = Math.max(2, st.trail | 0);
  S.score = 0; S.combo = 0; S.comboT = 0; S.t = 0; S.lost = 0; S.drain = st.drain; S.rng = r;
  const off = 0.02, fh = H;
  // the upstream border; an open drain removes the bottom segment between the flippers
  S.border = [[0.74, 0.25], [1 - off, 0.4], [1 - off, fh - off], [off, fh - off], [off, 0.4], [0.26, 0.25], [0.26, 0.0], [0.74, 0.0]];
  S.obstacles = [];
  const bump = (x, y, rad) => S.obstacles.push({ x, y, r: rad, pushVel: st.push, hit: 0 });
  const post = (x, y) => S.obstacles.push({ x, y, r: 0.018, pushVel: 0, post: true, hit: 0 });
  const R = st.bumpR;
  if (st.layout === 'upstream') { bump(0.25, 0.6, 0.1); bump(0.75, 0.5, 0.1); bump(0.7, 1.0, 0.12); bump(0.2, 1.2, 0.1); }
  else if (st.layout === 'triangle') { const cx = 0.5, cy = 1.05 + 0.15 * r(); for (const [dx, dy] of [[0, 0.22], [-0.2, -0.1], [0.2, -0.1]]) bump(cx + dx, cy + dy, R); bump(0.2, 0.62, R * 0.8); bump(0.8, 0.62, R * 0.8); }
  else if (st.layout === 'ring') { const n = Math.max(4, Math.min(8, st.nBump)), cx = 0.5, cy = 1.0, rr = 0.26; for (let k = 0; k < n; k++) { const a = 2 * Math.PI * k / n + 0.3; bump(cx + rr * Math.cos(a), cy + rr * Math.sin(a), Math.min(R, 0.08)); } }
  else if (st.layout === 'pachinko') { for (let j = 0; j < 7; j++) for (let i = 0; i < 6 + (j % 2); i++) post(0.12 + (i + (j % 2 ? 0 : 0.5)) * 0.13, 0.62 + j * 0.13); bump(0.5, 1.5, 0.07); }
  else { for (let k = 0, t = 0; k < st.nBump && t < 400; t++) { const rad = R * (0.7 + 0.6 * r()), x = 0.1 + rad + (0.8 - 2 * rad) * r(), y = 0.55 + rad + (1.0 - 2 * rad) * r(); if (S.obstacles.every(o => Math.hypot(o.x - x, o.y - y) > o.r + rad + 0.08)) { bump(x, y, rad); k++; } } }
  S.flippers = [];
  const L = st.flipLen, ra = 0.5, maxRot = 1.0;
  S.flippers.push({ r: 0.03, x: 0.26, y: 0.22, L, restAngle: -ra, maxRotation: maxRot, sign: 1, angularVelocity: st.flipW, rotation: 0, w: 0, pressed: false });
  S.flippers.push({ r: 0.03, x: 0.74, y: 0.22, L, restAngle: Math.PI + ra, maxRotation: maxRot, sign: -1, angularVelocity: st.flipW, rotation: 0, w: 0, pressed: false });
  S.balls = [];
  for (let i = 0; i < st.balls; i++) S.balls.push(launchBall(S, st, r, i));
  applyParams(S, st);
}
function launchBall(S, st, r, i) {
  const left = i % 2 === 1, x = left ? 0.08 : 0.92, y = 0.5 + 0.12 * Math.floor(i / 2);
  return makeBall(S, x, y, (left ? 0.2 : -0.2) + (r() - 0.5) * 0.2, st.launch * (0.9 + 0.2 * r()), st.ballR, i);
}
export function launch(S, st, r) { if (S.balls.length < 12) S.balls.push(launchBall(S, st, r, S.balls.length)); }
export function nudge(S, r) { for (const b of S.balls) { b.vx += (r() - 0.5) * 1.2; b.vy += 0.4 * r(); } }

// Upstream Flipper.simulate.
function flipperStep(f, dt) {
  const prev = f.rotation;
  if (f.pressed) f.rotation = Math.min(f.rotation + dt * f.angularVelocity, f.maxRotation);
  else f.rotation = Math.max(f.rotation - dt * f.angularVelocity, 0);
  f.w = f.sign * (f.rotation - prev) / dt;
}
const tipOf = f => { const a = f.restAngle + f.sign * f.rotation; return [f.x + Math.cos(a) * f.L, f.y + Math.sin(a) * f.L]; };

function ballBall(S, a, b) {
  const e = S.P.e; let dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy);
  if (d === 0 || d > a.r + b.r) return;
  dx /= d; dy /= d; const corr = (a.r + b.r - d) / 2;
  a.x -= dx * corr; a.y -= dy * corr; b.x += dx * corr; b.y += dy * corr;
  const v1 = a.vx * dx + a.vy * dy, v2 = b.vx * dx + b.vy * dy, m1 = a.m, m2 = b.m;
  const n1 = (m1 * v1 + m2 * v2 - m2 * (v1 - v2) * e) / (m1 + m2), n2 = (m1 * v1 + m2 * v2 - m1 * (v2 - v1) * e) / (m1 + m2);
  a.vx += dx * (n1 - v1); a.vy += dy * (n1 - v1); b.vx += dx * (n2 - v2); b.vy += dy * (n2 - v2);
}
function ballObstacle(S, b, o) {
  let dx = b.x - o.x, dy = b.y - o.y; const d = Math.hypot(dx, dy);
  if (d === 0 || d > b.r + o.r) return;
  dx /= d; dy /= d; const corr = b.r + o.r - d;
  b.x += dx * corr; b.y += dy * corr;
  const v = b.vx * dx + b.vy * dy;
  // upstream: the normal speed becomes the push velocity; a post (push 0) reflects with restitution
  const vn = o.post ? Math.abs(v) * Math.max(0.5, S.P.e + 0.3) : o.pushVel;
  b.vx += dx * (vn - v); b.vy += dy * (vn - v);
  if (!o.post || Math.abs(v) > 0.3) { o.hit = 1; if (!o.post) { S.score += 1 + S.combo; S.combo = Math.min(9, S.combo + 1); S.comboT = 1.5; } }
}
function ballFlipper(S, b, f) {
  const [tx, ty] = tipOf(f);
  closestPointOnSegment(b.x, b.y, f.x, f.y, tx, ty, CP);
  let dx = b.x - CP[0], dy = b.y - CP[1]; const d = Math.hypot(dx, dy);
  if (d === 0 || d > b.r + f.r) return;
  dx /= d; dy /= d; const corr = b.r + f.r - d;
  b.x += dx * corr; b.y += dy * corr;
  const rx = CP[0] + dx * f.r - f.x, ry = CP[1] + dy * f.r - f.y;
  const sx = -ry * f.w, sy = rx * f.w;
  const v = b.vx * dx + b.vy * dy, vnew = sx * dx + sy * dy;
  b.vx += dx * (vnew - v); b.vy += dy * (vnew - v);
}
function ballBorder(S, b) {
  const B = S.border, n = B.length; let minD = 0, cx = 0, cy = 0, nx = 0, ny = 0;
  for (let i = 0; i < n; i++) {
    if (S.drain && i === n - 2) continue;            // the open drain: no bottom segment
    const a = B[i], c = B[(i + 1) % n];
    closestPointOnSegment(b.x, b.y, a[0], a[1], c[0], c[1], CP);
    const dist = Math.hypot(b.x - CP[0], b.y - CP[1]);
    if (i === 0 || dist < minD) { minD = dist; cx = CP[0]; cy = CP[1]; nx = -(c[1] - a[1]); ny = c[0] - a[0]; }
  }
  let dx = b.x - cx, dy = b.y - cy, dist = Math.hypot(dx, dy);
  if (dist === 0) { dx = nx; dy = ny; dist = Math.hypot(nx, ny); }
  dx /= dist; dy /= dist;
  if (dx * nx + dy * ny >= 0) { if (dist > b.r) return; b.x += dx * (b.r - dist); b.y += dy * (b.r - dist); }
  else { b.x += dx * -(dist + b.r); b.y += dy * -(dist + b.r); }
  const v = b.vx * dx + b.vy * dy, vnew = Math.abs(v) * S.P.e;
  b.vx += dx * (vnew - v); b.vy += dy * (vnew - v);
}

// The autopilot flips a flipper when a ball comes down onto it.
function autopilot(S) {
  for (const f of S.flippers) {
    let want = false;
    for (const b of S.balls) {
      const dx = b.x - f.x, dy = b.y - f.y;
      if (dy > -0.03 && dy < 0.16 && dx * f.sign > -0.02 && dx * f.sign < f.L + 0.04 && b.vy < 0.6) want = true;
    }
    f.pressed = want;
  }
}

export function step(S, h) {
  const P = S.P, n = P.sub, dt = h / n;
  // a key or a tap takes the flippers from the autopilot for 4 s
  S.manualT = Math.max(0, (S.manualT || 0) - h);
  if (P.auto && !S.manualT) autopilot(S); else S.flippers.forEach((f, k) => { f.pressed = S.keys[k]; });
  for (let s = 0; s < n; s++) {
    for (const f of S.flippers) flipperStep(f, dt);
    for (const b of S.balls) {
      if (S.grab && S.grab.b === b) { const px = b.x, py = b.y; b.x = S.grab.x; b.y = S.grab.y; b.vx = (b.x - px) / dt; b.vy = (b.y - py) / dt; continue; }
      b.vy -= P.g * dt; b.x += b.vx * dt; b.y += b.vy * dt;
    }
    for (let i = 0; i < S.balls.length; i++) {
      const b = S.balls[i];
      for (let j = i + 1; j < S.balls.length; j++) ballBall(S, b, S.balls[j]);
      for (const o of S.obstacles) ballObstacle(S, b, o);
      for (const f of S.flippers) ballFlipper(S, b, f);
      ballBorder(S, b);
    }
  }
  // speed cap (safety net), drain, trails, timers
  for (const b of S.balls) { const v = Math.hypot(b.vx, b.vy); if (v > 8) { b.vx *= 8 / v; b.vy *= 8 / v; } }
  if (S.drain) for (let i = 0; i < S.balls.length; i++) { const b = S.balls[i]; if (b.y < -0.1) { S.lost++; S.balls[i] = launchBall(S, { launch: P.launch, ballR: b.r }, S.rng, i); S.balls[i].c = b.c; } }
  for (const b of S.balls) { const k = b.tN % S.TL; b.tx[k] = b.x; b.ty[k] = b.y; b.tN++; }
  for (const o of S.obstacles) o.hit = Math.max(0, o.hit - h * 4);
  S.comboT -= h; if (S.comboT <= 0) S.combo = 0;
  S.t += h;
}
export function health(S) {
  let bad = 0, out = 0;
  for (const b of S.balls) { if (!Number.isFinite(b.x + b.y + b.vx + b.vy)) bad++; else if (b.x < -0.01 || b.x > W + 0.01 || b.y > H + 0.01 || (!S.drain && b.y < -0.01)) out++; }
  return { bad, out };
}
export function pick(S, x, y) { let best = null, bd = 0.08; for (const b of S.balls) { const d = Math.hypot(b.x - x, b.y - y); if (d < bd) { bd = d; best = { b, x, y }; } } return best; }
export const flipperTip = tipOf;
