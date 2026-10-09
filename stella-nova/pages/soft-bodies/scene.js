// ============================================================================
//  SOFT BODIES  ·  pages/soft-bodies/scene.js — controls, guard and scene
//  build (no DOM: tests.mjs runs it in node with the upstream script)
// ----------------------------------------------------------------------------
//  The physics is the upstream SoftBody of main.js (Ten Minute Physics #10,
//  Matthias Müller, MIT): XPBD edge and volume constraints on the bunny tet
//  mesh. This file only sets it up: how many bunnies, where they start, how
//  they spin and fly, the two compliances, gravity and its tilt, substeps,
//  and the obstacles (stage3d.collide after the upstream solve).
//  Note: upstream bodies do not collide with each other; the layouts keep
//  them apart at the start.
//
//  grep -n targets: "export function makeSchema", "export function guard",
//  "export function build", "export function simulate"
// ============================================================================
import * as S3 from './stage3d.js';

export function makeSchema(PHONE) {
  return { groups: [
    { id: 'bodies', label: 'Bunnies', open: true, controls: [
      { key: 'count', type: 'range', label: 'Bunnies', min: 1, max: PHONE ? 2 : 4, step: 1, value: 2, phone: 1, rebuild: true, random: { dist: 'int', min: 1, max: PHONE ? 2 : 4 } },
      { key: 'layout', type: 'choice', label: 'Start', value: 'drop', seg: false, rebuild: true, options: [
        { id: 'drop', label: 'Drop' }, { id: 'rain', label: 'Rain' }, { id: 'toss', label: 'Thrown in' }, { id: 'ring', label: 'Ring' }],
        random: { weights: { drop: 3, rain: 2, toss: 3, ring: 1 } } },
      { key: 'height', type: 'range', label: 'Drop height', min: 0, max: 2.5, step: 0.05, value: 0.8, unit: 'm', rebuild: true, random: { min: 0.2, max: 2.2 } },
      { key: 'spin', type: 'range', label: 'Spin', min: 0, max: 6, step: 0.1, value: 0, unit: 'rad/s', rebuild: true, random: { min: 0, max: 4 } },
      { key: 'tumble', type: 'toggle', label: 'Tumble at start', value: false, rebuild: true, random: { p: 0.5 } },
    ] },
    { id: 'stiff', label: 'Material', controls: [
      { key: 'edgeC', type: 'range', label: 'Edge compliance', min: 0, max: 500, step: 5, value: 100, unit: '', random: { min: 0, max: 350 } },
      { key: 'volC', type: 'range', label: 'Volume compliance', min: 0, max: 0.02, step: 0.0005, value: 0, digits: 4, random: { min: 0, max: 0.008 } },
      { key: 'fric', type: 'range', label: 'Obstacle friction', min: 0, max: 1, step: 0.05, value: 0.6, random: { min: 0.2, max: 0.9 } },
    ] },
    { id: 'world', label: 'World', controls: [
      { key: 'g', type: 'range', label: 'Gravity', min: 1, max: 20, step: 0.1, value: 10, unit: 'm/s²', random: { min: 4, max: 15 } },
      { key: 'tilt', type: 'range', label: 'Gravity tilt', min: 0, max: 4, step: 0.1, value: 0, unit: 'm/s²', random: { min: 0, max: 2.4 } },
      { key: 'tiltDir', type: 'range', label: 'Tilt direction', min: 0, max: 360, step: 5, value: 0, unit: '°' },
      { key: 'subs', type: 'range', label: 'Substeps', min: 3, max: 20, step: 1, value: 10, random: { dist: 'int', min: 6, max: 14 } },
      { key: 'obstacles', type: 'range', label: 'Obstacles', min: 0, max: 5, step: 1, value: 1, rebuild: true, random: { dist: 'int', min: 0, max: 4 } },
      { key: 'obKind', type: 'choice', label: 'Obstacle kind', value: 'mixed', seg: false, rebuild: true, options: [
        { id: 'mixed', label: 'Mixed' }, { id: 'spheres', label: 'Spheres' }, { id: 'boxes', label: 'Boxes' }, { id: 'pillars', label: 'Pillars' }] },
    ] },
    S3.lookGroup([], { mat: 'gloss' }),
    { id: 'act', label: 'Actions', random: false, controls: [
      { type: 'buttons', label: 'Do', action: 'act', items: [{ id: 'squash', label: 'Squash' }, { id: 'add', label: 'Add a bunny' }, { id: 'kick', label: 'Kick' }, { id: 'lift', label: 'Lift all' }] },
      { type: 'note', text: 'Drag a bunny to pull it, let go to throw it. Drag an obstacle to move it. Drag the floor to turn the view.' },
    ] },
  ] };
}

// Keep the work per frame inside a budget: bunnies x substeps <= 30
// (about one upstream bunny at its default 10 substeps per 3).
export function guard(next) {
  const out = Object.assign({}, next);
  const work = out.count * out.subs;
  if (work > 30) out.subs = Math.max(5, Math.floor(30 / out.count));
  return out;
}

export const KINDS = { mixed: ['sphere', 'box', 'pillar'], spheres: ['sphere'], boxes: ['box'], pillars: ['pillar'] };

// The world shared with the collision wrap (one per page).
export const W = { obs: [], fric: 0.6, spread: 0, meshes: [] };

// U = { THREE, scene, P (gPhysicsScene), SoftBody, bunnyMesh }
export function install(U) {
  S3.wrapAfter(U.SoftBody.prototype, 'solve', (b, a) => { S3.collide(W.obs, b.pos, b.prevPos, b.invMass, b.numParticles, 0.008, W.fric, a[0]); });
}

export function clear(U) {
  for (const b of U.P.objects) { U.scene.remove(b.surfaceMesh); b.surfaceMesh.geometry.dispose(); if (b.surfaceMesh.material.map) b.surfaceMesh.material.map.dispose(); b.surfaceMesh.material.dispose(); }
  U.P.objects.length = 0;
  S3.disposeMeshes({ gThreeScene: U.scene }, W.meshes); W.meshes = [];
}

// Start places: drop (a loose grid), rain (staggered heights), toss (a
// ring, thrown at the centre), ring (on a circle, facing out).
function places(st, r) {
  const n = st.count, out = [];
  const R = n === 1 ? 0 : 0.25 + 0.38 * n;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.283 + r() * 0.5;
    const yaw = st.layout === 'ring' ? a : r() * 6.283;
    const pitch = st.tumble ? (r() - 0.5) * 2.4 : 0;
    let at, v = [0, 0, 0];
    if (st.layout === 'rain') at = [Math.cos(a) * R * 0.6, st.height + 0.2 + i * 0.9 + r() * 0.4, Math.sin(a) * R * 0.6];
    else if (st.layout === 'toss') { const rr = 2.2 + 0.5 * n; at = [Math.cos(a) * rr, 0.3 + st.height * 0.5 + r() * 0.3, Math.sin(a) * rr]; const s = 2.6 + 1.6 * r(); v = [-Math.cos(a) * s, 3 + 1.5 * r(), -Math.sin(a) * s]; }
    else at = [Math.cos(a) * R, st.height + 0.15 * i, Math.sin(a) * R];
    out.push({ at, v, yaw, pitch, w: (r() < 0.5 ? -1 : 1) * st.spin });
  }
  return out;
}

export function build(U, st, r) {
  clear(U);
  W.fric = st.fric;
  const pl = places(st, r);
  const n = st.count, R = n === 1 ? 0 : 0.25 + 0.38 * n;
  W.spread = R;
  W.obs = S3.makeObstacles(r, st.obstacles, { area: [R + 0.6, R + 0.6], size: [0.14, 0.34], kinds: KINDS[st.obKind] || KINDS.mixed, keepOut: st.layout === 'drop' && n === 1 ? [0, 0, 0, 0.55] : null });
  for (const p of pl) {
    const b = new U.SoftBody(U.bunnyMesh, U.scene, st.edgeC, st.volC);
    S3.placeBody(b, p);
    b.updateMeshes();
    U.P.objects.push(b);
  }
  live(U, st);
  return { bodies: U.P.objects.length, obstacles: W.obs.length };
}

export function live(U, st) {
  for (const b of U.P.objects) { b.edgeCompliance = st.edgeC; b.volCompliance = st.volC; }
  W.fric = st.fric;
  const a = st.tiltDir * Math.PI / 180;
  const g = U.P.gravity; g[0] = st.tilt * Math.cos(a); g[1] = -st.g; g[2] = st.tilt * Math.sin(a);
  U.P.numSubsteps = st.subs;
}

// One upstream frame (gPhysicsScene.dt) without the DOM-bound simulate().
export function simulate(U) {
  const P = U.P, sdt = P.dt / P.numSubsteps;
  for (let s = 0; s < P.numSubsteps; s++) {
    for (const b of P.objects) b.preSolve(sdt, P.gravity);
    for (const b of P.objects) b.solve(sdt);
    for (const b of P.objects) b.postSolve(sdt);
  }
}

// A kick: an upward and sideways push on one body.
export function kick(U, i, r) {
  const b = U.P.objects[i % Math.max(1, U.P.objects.length)]; if (!b) return;
  const a = r() * 6.283, s = 1.5 + 2 * r(), up = 3 + 2.5 * r(), w = (r() - 0.5) * 6;
  const c = S3.centroid([b]);
  for (let k = 0; k < b.numParticles; k++) {
    if (b.invMass[k] === 0) continue;
    const rx = b.pos[3 * k] - c[0], rz = b.pos[3 * k + 2] - c[2];
    b.vel[3 * k] += Math.cos(a) * s - w * rz; b.vel[3 * k + 1] += up; b.vel[3 * k + 2] += Math.sin(a) * s + w * rx;
  }
}
