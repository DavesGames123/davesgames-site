// ============================================================================
//  CLOTH SELF COLLISION  ·  pages/cloth-self-collision/scene.js — controls,
//  guard and scene build (no DOM: tests.mjs runs it in node)
// ----------------------------------------------------------------------------
//  The physics is the upstream Cloth of main.js (Ten Minute Physics #15,
//  Matthias Müller, MIT): a particle grid with stretch, shear and bending
//  distance constraints and particle-particle self collision through a
//  spatial hash. This file sets it up: the grid size and spacing, how it
//  starts (a falling strip as upstream, a flat sheet, a tilted strip, a
//  spinning strip), pins, bending, self collision on or off, gravity, wind
//  and the obstacles.
//  Our additions:
//    - wind: the upstream integrate adds the gravity vector per substep,
//      so the wind is a gusting horizontal part of that vector
//    - obstacles: stage3d.collide wraps solveGroundCollisions (once per
//      substep, before the constraints)
//    - the upstream jitter uses Math.random: the build seeds it
//
//  grep -n targets: "export function makeSchema", "export function guard",
//  "export function build", "function startPose"
// ============================================================================
import * as S3 from '../soft-bodies/stage3d.js';

export function makeSchema(PHONE) {
  const cap = PHONE ? 2500 : 6000;
  return { groups: [
    { id: 'cloth', label: 'Cloth', open: true, controls: [
      { key: 'start', type: 'choice', label: 'Start', value: 'strip', seg: false, rebuild: true, options: [
        { id: 'strip', label: 'Falling strip (upstream)' }, { id: 'sheet', label: 'Flat sheet' }, { id: 'tilted', label: 'Tilted strip' }, { id: 'spin', label: 'Spinning strip' }],
        random: { weights: { strip: 3, sheet: 3, tilted: 2, spin: 2 } } },
      { key: 'nx', type: 'range', label: 'Width (particles)', min: 8, max: 50, step: 1, value: 30, phone: 20, rebuild: true, random: { dist: 'int', min: 12, max: 40 } },
      { key: 'ny', type: 'range', label: 'Length (particles)', min: 20, max: 200, step: 5, value: 200, phone: 110, rebuild: true, random: { dist: 'int', min: 40, max: 200 } },
      { key: 'spacing', type: 'range', label: 'Spacing', min: 0.008, max: 0.02, step: 0.001, value: 0.01, unit: 'm', digits: 3, rebuild: true, random: { min: 0.008, max: 0.016 } },
      { key: 'pins', type: 'choice', label: 'Pinned', value: 'none', seg: false, rebuild: true, options: [
        { id: 'none', label: 'None' }, { id: 'corners', label: 'Two top corners' }, { id: 'edge', label: 'Top edge' }, { id: 'one', label: 'One corner' }],
        random: { weights: { none: 4, corners: 1, edge: 1, one: 1 } } },
      { key: 'height', type: 'range', label: 'Start height', min: 0, max: 1.5, step: 0.05, value: 0.2, unit: 'm', rebuild: true, random: { min: 0.1, max: 0.8 } },
      { key: 'bendC', type: 'range', label: 'Bending compliance', min: 0, max: 10, step: 0.1, value: 1, rebuild: true, random: { dist: 'log', min: 0.05, max: 10 } },
      { key: 'selfColl', type: 'toggle', label: 'Self collision', value: true, random: { p: 0.9 } },
    ] },
    { id: 'world', label: 'World', controls: [
      { key: 'g', type: 'range', label: 'Gravity', min: 1, max: 20, step: 0.1, value: 10, unit: 'm/s²', random: { min: 5, max: 14 } },
      { key: 'wind', type: 'range', label: 'Wind', min: 0, max: 8, step: 0.1, value: 0, unit: 'm/s²', random: { min: 0, max: 3 } },
      { key: 'windDir', type: 'range', label: 'Wind direction', min: 0, max: 360, step: 5, value: 90, unit: '°' },
      { key: 'subs', type: 'range', label: 'Substeps', min: 4, max: 20, step: 1, value: 10, random: { dist: 'int', min: 8, max: 14 } },
      { key: 'obstacles', type: 'range', label: 'Obstacles', min: 0, max: 4, step: 1, value: 0, rebuild: true, random: { dist: 'int', min: 0, max: 3 } },
      { key: 'obKind', type: 'choice', label: 'Obstacle kind', value: 'mixed', seg: false, rebuild: true, options: [
        { id: 'mixed', label: 'Mixed' }, { id: 'spheres', label: 'Spheres' }, { id: 'boxes', label: 'Boxes' }, { id: 'pillars', label: 'Pillars' }] },
      { key: 'fric', type: 'range', label: 'Obstacle friction', min: 0, max: 1, step: 0.05, value: 0.5, random: { min: 0.2, max: 0.9 } },
    ] },
    S3.lookGroup([
      { key: 'pattern', type: 'choice', label: 'Pattern', value: 'stripes', seg: false, options: S3.PATTERNS, random: { weights: { solid: 2, stripes: 3, check: 2, gingham: 2, plaid: 2, dots: 2, chevron: 2, grid: 1 } } },
      { key: 'edges', type: 'toggle', label: 'Show edges', value: false, random: false },
    ], { mat: 'satin', palette: 'sunset', cloth: true }),
    { id: 'act', label: 'Actions', random: false, controls: [
      { type: 'buttons', label: 'Do', action: 'act', items: [{ id: 'lift', label: 'Lift and drop' }, { id: 'release', label: 'Release pins' }, { id: 'shake', label: 'Shake' }] },
      { type: 'note', text: 'Drag the cloth to pull a fold out of the pile. Drag an obstacle to push it. Self collision keeps the layers apart.' },
    ] },
  ] };
}

// Particles x substeps inside a budget (upstream: 6000 x 10).
export function guard(next, prev, r, cap = 6000) {
  const out = Object.assign({}, next);
  const n = out.nx * out.ny;
  if (n > cap) out.ny = Math.max(20, Math.floor(cap / out.nx / 5) * 5);
  const work = out.nx * out.ny * out.subs;
  if (work > cap * 10) out.subs = Math.max(4, Math.floor(cap * 10 / (out.nx * out.ny)));
  return out;
}

export const KINDS = { mixed: ['sphere', 'box', 'pillar'], spheres: ['sphere'], boxes: ['box'], pillars: ['pillar'] };
export const W = { obs: [], fric: 0.5, wind: [0, 0, 0], gust: 0.5, t: 0, meshes: [], size: 1 };

// U = { THREE, scene, P, Cloth, Math? (the upstream realm's Math, for tests) }
export function install(U) {
  S3.wrapAfter(U.Cloth.prototype, 'solveGroundCollisions', b => { S3.collide(W.obs, b.pos, b.prevPos, b.invMass, b.numParticles, b.thickness, W.fric, 0); });
}

export function clear(U) {
  const c = U.P.cloth;
  if (c) for (const m of [c.triMesh, c.backMesh, c.edgeMesh]) { if (!m) continue; U.scene.remove(m); if (m.geometry) m.geometry.dispose(); if (m.material.map) m.material.map.dispose(); m.material.dispose(); }
  U.P.cloth = null;
  S3.disposeMeshes({ gThreeScene: U.scene }, W.meshes); W.meshes = [];
}

// Move the upstream strip (x across, y up from 0.2, z = 0) into the start pose.
function startPose(c, st, r) {
  const n = c.numParticles, A = [c.pos, c.prevPos, c.restPos];
  let ymin = Infinity, ymax = -Infinity;
  for (let i = 0; i < n; i++) { ymin = Math.min(ymin, c.pos[3 * i + 1]); ymax = Math.max(ymax, c.pos[3 * i + 1]); }
  const L = ymax - ymin, yaw = r() * 6.283, cy = Math.cos(yaw), sy = Math.sin(yaw);
  const tilt = st.start === 'tilted' ? 0.6 + 0.5 * r() : 0;
  for (const P of A) for (let i = 0; i < n; i++) {
    let x = P[3 * i], y = P[3 * i + 1] - ymin, z = P[3 * i + 2];
    if (st.start === 'sheet') { z = y - L / 2; y = 0; }                       // flat, centred
    else if (tilt) { const y1 = Math.cos(tilt) * y, z1 = Math.sin(tilt) * y; y = y1; z = z1 - Math.sin(tilt) * L / 2; }
    const x1 = cy * x + sy * z, z1 = -sy * x + cy * z;
    P[3 * i] = x1; P[3 * i + 1] = y; P[3 * i + 2] = z1;
  }
  const lift = st.start === 'sheet' ? st.height + W.top + 0.05 : st.height + 0.02;
  for (const P of A) for (let i = 0; i < n; i++) P[3 * i + 1] += lift;
  if (st.start === 'spin') {
    const w = (r() < 0.5 ? -1 : 1) * (3 + 4 * r());
    for (let i = 0; i < n; i++) { const x = c.pos[3 * i], z = c.pos[3 * i + 2]; c.vel[3 * i] = -w * z; c.vel[3 * i + 2] = w * x; }
  }
}

export function build(U, st, r) {
  clear(U);
  W.fric = st.fric;
  const sp = st.spacing, wdt = st.nx * sp, len = st.ny * sp;
  W.size = Math.max(wdt, Math.min(len, 1.2));
  const flat = st.start === 'sheet';
  W.obs = S3.makeObstacles(r, st.obstacles, flat
    ? { area: [wdt * 0.4, len * 0.4], size: [0.04 + 0.02 * W.size, 0.06 + 0.1 * W.size], kinds: KINDS[st.obKind] || KINDS.mixed }
    : { area: [0.35 + wdt, 0.35 + wdt], size: [0.04, 0.12], kinds: KINDS[st.obKind] || KINDS.mixed, keepOut: [0, 0, 0, wdt * 0.6 + 0.03] });
  W.top = W.obs.reduce((m, o) => Math.max(m, o.type === 'sphere' ? o.c[1] + o.r : o.c[1] + o.h[1]), 0);
  const c = S3.seeded(r, () => new U.Cloth(U.scene, st.nx, st.ny, sp, sp, st.bendC), U.Math || Math);
  // the upstream maths keeps 1 / mass = 1: the pins are 0
  const id = (i, j) => i * st.ny + j;
  const top = st.ny - 1;
  if (st.pins === 'corners') { c.invMass[id(0, top)] = 0; c.invMass[id(st.nx - 1, top)] = 0; }
  else if (st.pins === 'edge') for (let i = 0; i < st.nx; i++) c.invMass[id(i, top)] = 0;
  else if (st.pins === 'one') c.invMass[id(0, top)] = 0;
  startPose(c, st, r);
  c.updateVisMeshes();
  U.P.cloth = c;
  live(U, st);
  return { particles: c.numParticles, obstacles: W.obs.length };
}

export function live(U, st) {
  const c = U.P.cloth;
  if (c) { c.handleCollisions = !!st.selfColl; if (c.edgeMesh) { c.edgeMesh.visible = !!st.edges; c.triMesh.visible = c.backMesh.visible = !st.edges; } }
  W.fric = st.fric;
  const a = st.windDir * Math.PI / 180;
  W.wind = [st.wind * Math.cos(a), 0, st.wind * Math.sin(a)];
  W.g = st.g;
  U.P.numSubsteps = st.subs;
  gravity(U);
}
// The gravity vector of the next frame: g down plus the gusting wind.
export function gravity(U) {
  const t = W.t, f = 1 + W.gust * (0.6 * Math.sin(t * 1.3) + 0.4 * Math.sin(t * 2.9 + 1.1));
  const g = U.P.gravity; g[0] = W.wind[0] * f; g[1] = -(W.g || 10); g[2] = W.wind[2] * f;
}

// One upstream frame without the DOM-bound simulate() (tests).
export function simulate(U) {
  W.t += U.P.dt; gravity(U);
  U.P.cloth.simulate(U.P.dt, U.P.numSubsteps, U.P.gravity);
}

export function release(U) { const c = U.P.cloth; if (c) for (let i = 0; i < c.numParticles; i++) if (c.invMass[i] === 0 && c.grabId !== i) c.invMass[i] = 1; }
export function lift(U) {
  const c = U.P.cloth; if (!c) return;
  let cx = 0, cz = 0; for (let i = 0; i < c.numParticles; i++) { cx += c.pos[3 * i]; cz += c.pos[3 * i + 2]; } cx /= c.numParticles; cz /= c.numParticles;
  for (let i = 0; i < c.numParticles; i++) { const d = Math.hypot(c.pos[3 * i] - cx, c.pos[3 * i + 2] - cz); c.vel[3 * i + 1] += Math.max(0, 4.5 - 12 * d); }
}
export function shake(U, r) {
  const c = U.P.cloth; if (!c) return;
  const a = r() * 6.283, s = 0.6 + 0.8 * r();
  for (let i = 0; i < c.numParticles; i++) if (c.invMass[i] > 0) { c.vel[3 * i] += Math.cos(a) * s; c.vel[3 * i + 2] += Math.sin(a) * s; c.vel[3 * i + 1] += 0.8; }
}
