// ============================================================================
//  CLOTH  ·  pages/cloth/scene.js — controls, guard and scene build
//  (no DOM: tests.mjs runs it in node with the upstream script)
// ----------------------------------------------------------------------------
//  The physics is the upstream Cloth of main.js (Ten Minute Physics #14,
//  Matthias Müller, MIT): XPBD stretching and bending constraints on a
//  triangle mesh. This file sets it up: the cloth size, how it starts
//  (hang, drape over obstacles, flag), which particles are pinned, the two
//  compliances, wind, gravity, substeps and the obstacles.
//  Our additions to the upstream solve, both as wraps on Cloth.prototype:
//    preSolve  wind: a gusting acceleration on every free particle
//    solve     obstacles: stage3d.collide pushes particles out of spheres
//              and boxes, with friction
//
//  grep -n targets: "export function makeSchema", "export function guard",
//  "export function build", "function pins", "function wind"
// ============================================================================
import * as S3 from '../soft-bodies/stage3d.js';

export function makeSchema(PHONE) {
  return { groups: [
    { id: 'cloth', label: 'Cloth', open: true, controls: [
      { key: 'start', type: 'choice', label: 'Start', value: 'hang', seg: false, rebuild: true, options: [
        { id: 'hang', label: 'Hang' }, { id: 'drape', label: 'Drape over obstacles' }, { id: 'flag', label: 'Flag' }, { id: 'drop', label: 'Drop flat' }],
        random: { weights: { hang: 3, drape: 3, flag: 2, drop: 2 } } },
      { key: 'pins', type: 'choice', label: 'Pinned', value: 'corners', seg: false, rebuild: true, options: [
        { id: 'corners', label: 'Two top corners' }, { id: 'top', label: 'Top edge' }, { id: 'one', label: 'One corner' }, { id: 'three', label: 'Three points' },
        { id: 'left', label: 'Left edge' }, { id: 'center', label: 'Centre point' }, { id: 'none', label: 'None' }] },
      { key: 'size', type: 'range', label: 'Size', min: 0.6, max: 1.8, step: 0.05, value: 1, unit: '×', rebuild: true, random: { min: 0.8, max: 1.6 } },
      { key: 'height', type: 'range', label: 'Height', min: 0, max: 1.5, step: 0.05, value: 0.35, unit: 'm', rebuild: true, random: { min: 0.1, max: 1.0 } },
      { key: 'bendC', type: 'range', label: 'Bending compliance', min: 0, max: 10, step: 0.1, value: 1, random: { dist: 'log', min: 0.05, max: 10 } },
      { key: 'stretchC', type: 'range', label: 'Stretch compliance', min: 0, max: 0.002, step: 0.0001, value: 0, digits: 4, random: { min: 0, max: 0.0012 } },
    ] },
    { id: 'wind', label: 'Wind', controls: [
      { key: 'wind', type: 'range', label: 'Wind', min: 0, max: 12, step: 0.1, value: 0, unit: 'm/s²', random: { min: 0, max: 8 } },
      { key: 'windDir', type: 'range', label: 'Direction', min: 0, max: 360, step: 5, value: 90, unit: '°' },
      { key: 'gust', type: 'range', label: 'Gusts', min: 0, max: 1, step: 0.05, value: 0.5, random: { min: 0.1, max: 0.9 } },
    ] },
    { id: 'world', label: 'World', controls: [
      { key: 'g', type: 'range', label: 'Gravity', min: 1, max: 20, step: 0.1, value: 10, unit: 'm/s²', random: { min: 5, max: 14 } },
      { key: 'subs', type: 'range', label: 'Substeps', min: 5, max: 30, step: 1, value: 15, random: { dist: 'int', min: 10, max: 18 } },
      { key: 'obstacles', type: 'range', label: 'Obstacles', min: 0, max: 4, step: 1, value: 0, rebuild: true, random: { dist: 'int', min: 0, max: 3 } },
      { key: 'obKind', type: 'choice', label: 'Obstacle kind', value: 'mixed', seg: false, rebuild: true, options: [
        { id: 'mixed', label: 'Mixed' }, { id: 'spheres', label: 'Spheres' }, { id: 'boxes', label: 'Boxes' }, { id: 'pillars', label: 'Pillars' }] },
      { key: 'fric', type: 'range', label: 'Obstacle friction', min: 0, max: 1, step: 0.05, value: 0.5, random: { min: 0.2, max: 0.9 } },
    ] },
    S3.lookGroup([
      { key: 'pattern', type: 'choice', label: 'Pattern', value: 'gingham', seg: false, options: S3.PATTERNS, random: { weights: { solid: 1, stripes: 2, check: 2, gingham: 2, plaid: 2, dots: 2, chevron: 2, grid: 1 } } },
      { key: 'edges', type: 'toggle', label: 'Show edges', value: false, random: false },
    ], { mat: 'satin', palette: 'harbour', cloth: true }),
    { id: 'act', label: 'Actions', random: false, controls: [
      { type: 'buttons', label: 'Do', action: 'act', items: [{ id: 'release', label: 'Release pins' }, { id: 'gust', label: 'Gust' }, { id: 'shake', label: 'Shake' }] },
      { type: 'note', text: 'Drag the cloth to pull it. Drag an obstacle to move it under the cloth. Drag the floor to turn the view.' },
    ] },
  ] };
}

// Keep the work per frame inside a budget (size grows nothing: the mesh is
// fixed; substeps cost). A drape needs something to drape over.
export function guard(next) {
  const out = Object.assign({}, next);
  if (out.subs > 22) out.subs = 22;
  if (out.start === 'drape' && out.obstacles < 1) out.obstacles = 1;
  if (out.start === 'flag' && !['left', 'top', 'corners'].includes(out.pins)) out.pins = 'left';
  // a flat start hangs from nothing (or a centre point, like a tablecloth on a pole)
  if ((out.start === 'drape' || out.start === 'drop') && out.pins !== 'center') out.pins = 'none';
  return out;
}

export const KINDS = { mixed: ['sphere', 'box', 'pillar'], spheres: ['sphere'], boxes: ['box'], pillars: ['pillar'] };
// The world shared with the wraps (one per page).
export const W = { obs: [], fric: 0.5, wind: [0, 0, 0], gust: 0, t: 0, pad: 0.012, top: 0, pinned: 0, meshes: [] };

function wind(b, dt) {
  const w = W.wind; if (!w[0] && !w[1] && !w[2]) return;
  const n = b.numParticles, t = W.t, gs = W.gust;
  for (let i = 0; i < n; i++) {
    if (b.invMass[i] === 0) continue;
    const x = b.pos[3 * i], y = b.pos[3 * i + 1];
    const f = 1 + gs * (0.6 * Math.sin(t * 1.7 + x * 4) + 0.4 * Math.sin(t * 3.1 + y * 5 + 1.3));
    b.vel[3 * i] += w[0] * f * dt; b.vel[3 * i + 1] += w[1] * f * dt + 0.15 * gs * Math.sin(t * 2.3 + x * 7) * dt; b.vel[3 * i + 2] += w[2] * f * dt;
  }
}

// U = { THREE, scene, P, Cloth, meshes }
export function install(U) {
  S3.wrapBefore(U.Cloth.prototype, 'preSolve', (b, a) => wind(b, a[0]));
  S3.wrapAfter(U.Cloth.prototype, 'solve', (b, a) => { S3.collide(W.obs, b.pos, b.prevPos, b.invMass, b.numParticles, W.pad, W.fric, a[0]); });
}

export function clear(U) {
  for (const b of U.P.objects) for (const m of [b.triMesh, b.edgeMesh]) { U.scene.remove(m); m.geometry.dispose(); if (m.material.map) m.material.map.dispose(); m.material.dispose(); }
  U.P.objects.length = 0;
  S3.disposeMeshes({ gThreeScene: U.scene }, W.meshes); W.meshes = [];
}

// Pinned particles from the local (upstream) layout: u across 0..1, v up 0..1.
function pins(kind, u, v) {
  const e = 0.02;
  switch (kind) {
    case 'corners': return v > 1 - e && (u < e || u > 1 - e);
    case 'top': return v > 1 - e;
    case 'one': return v > 1 - e && u < e;
    case 'three': return v > 1 - e && (u < e || u > 1 - e || Math.abs(u - 0.5) < 0.013);
    case 'left': return u < e;
    case 'center': return Math.abs(u - 0.5) < 0.013 && Math.abs(v - 0.5) < 0.013;
    default: return false;
  }
}

// The local mesh -> world: scale about the top centre, turn it flat for a
// drape or drop, lift it to the start height. Returns the moved vertices.
function place(base, st, r) {
  const v = base.vertices, n = v.length / 3, s = st.size, out = new Float32Array(v.length);
  let ymin = Infinity, ymax = -Infinity;
  for (let i = 0; i < n; i++) { ymin = Math.min(ymin, v[3 * i + 1]); ymax = Math.max(ymax, v[3 * i + 1]); }
  const flat = st.start === 'drape' || st.start === 'drop';
  const yaw = flat ? r() * 6.283 : (st.start === 'flag' ? 0 : (r() - 0.5) * 0.8);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const H = ymax - ymin;
  let xmin = Infinity; for (let i = 0; i < n; i++) xmin = Math.min(xmin, v[3 * i]);
  const flag = st.start === 'flag';
  for (let i = 0; i < n; i++) {
    let x = v[3 * i] * s, y = (v[3 * i + 1] - ymax) * s, z = v[3 * i + 2] * s;
    if (flat) { const yy = y; y = 0; z = yy + H * s * 0.5; }   // the sheet lies flat, centred
    // a flag: the long side runs out from the pole at x = 0, the short side is the pole
    if (flag) { const xx = x; x = (v[3 * i + 1] - ymin) * s; y = (v[3 * i] - xmin) * s - (0.4 * s); z = 0; }
    const x1 = cy * x + sy * z, z1 = -sy * x + cy * z;
    out[3 * i] = x1; out[3 * i + 1] = y; out[3 * i + 2] = z1;
  }
  // lift: hanging sheets keep their bottom at the start height
  const lift = flat ? st.height + W.top + 0.05 : flag ? st.height + 0.4 * s + 0.5 : st.height + H * s;
  for (let i = 0; i < n; i++) out[3 * i + 1] += lift;
  return out;
}

export function build(U, st, r) {
  clear(U);
  const base = U.meshes[0];
  W.fric = st.fric;
  const flat = st.start === 'drape' || st.start === 'drop';
  const span = 0.4 * st.size, len = 0.8 * st.size;
  W.obs = S3.makeObstacles(r, st.obstacles, flat
    ? { area: [span * 0.45, span * 0.45], size: [0.07 * st.size, 0.16 * st.size], kinds: KINDS[st.obKind] || KINDS.mixed }
    : { area: [span * 1.1, 0.3 + 0.2 * st.size], size: [0.05, 0.14], kinds: KINDS[st.obKind] || KINDS.mixed });
  if (!flat) for (const o of W.obs) if (Math.abs(o.c[2]) < 0.08 + (o.r || o.h[2])) o.c[2] += (o.c[2] < 0 ? -1 : 1) * 0.12;   // not inside the hanging sheet
  W.top = W.obs.reduce((m, o) => Math.max(m, o.type === 'sphere' ? o.c[1] + o.r : o.c[1] + o.h[1]), 0);
  const verts = place(base, st, r);
  const cloth = new U.Cloth({ vertices: verts, faceTriIds: base.faceTriIds }, U.scene, st.bendC);
  // pins: area masses as upstream, then our pattern in the local layout
  const v = base.vertices, n = v.length / 3;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, v[3 * i]); x1 = Math.max(x1, v[3 * i]); y0 = Math.min(y0, v[3 * i + 1]); y1 = Math.max(y1, v[3 * i + 1]); }
  const inv = cloth.invMass; inv.fill(0);
  const T = base.faceTriIds;
  for (let t = 0; t < T.length; t += 3) {
    const a = T[t], b = T[t + 1], c = T[t + 2];
    const ex = verts[3 * b] - verts[3 * a], ey = verts[3 * b + 1] - verts[3 * a + 1], ez = verts[3 * b + 2] - verts[3 * a + 2];
    const fx = verts[3 * c] - verts[3 * a], fy = verts[3 * c + 1] - verts[3 * a + 1], fz = verts[3 * c + 2] - verts[3 * a + 2];
    const A = 0.5 * Math.hypot(ey * fz - ez * fy, ez * fx - ex * fz, ex * fy - ey * fx);
    const w = A > 0 ? 1 / A / 3 : 0;
    inv[a] += w; inv[b] += w; inv[c] += w;
  }
  cloth.skMass = inv.slice();
  // a flag hangs on its pole edge: the local bottom edge (v = 0)
  const kind = st.pins;
  let pinned = 0;
  for (let i = 0; i < n; i++) {
    const u = (v[3 * i] - x0) / (x1 - x0), w = (v[3 * i + 1] - y0) / (y1 - y0);
    const pin = st.start === 'flag' ? (st.pins === 'corners' ? w < 0.02 && (u < 0.02 || u > 0.98) : w < 0.02) : pins(kind, u, w);
    if (pin) { inv[i] = 0; pinned++; }
  }
  if (st.start === 'flag') {   // the pole: a thin box from the floor to the top of the flag
    let top = 0; for (let i = 0; i < n; i++) top = Math.max(top, verts[3 * i + 1]);
    W.obs.push({ type: 'box', c: [-0.02, (top + 0.05) / 2, 0], h: [0.012, (top + 0.05) / 2, 0.012], v: [0, 0, 0], pole: true });
  }
  W.pinned = pinned;
  U.P.objects.push(cloth);
  live(U, st);
  return { pinned, obstacles: W.obs.length };
}

export function live(U, st) {
  for (const b of U.P.objects) { b.bendingCompliance = st.bendC; b.stretchingCompliance = st.stretchC; if (b.edgeMesh) { b.edgeMesh.visible = !!st.edges; b.triMesh.visible = !st.edges; } }
  W.fric = st.fric;
  const a = st.windDir * Math.PI / 180;
  W.wind = [st.wind * Math.cos(a), 0, st.wind * Math.sin(a)]; W.gust = st.gust;
  const g = U.P.gravity; g[0] = 0; g[1] = -st.g; g[2] = 0;
  U.P.numSubsteps = st.subs;
}

// One upstream frame without the DOM-bound simulate() (tests).
export function simulate(U) {
  const P = U.P, sdt = P.dt / P.numSubsteps;
  W.t += P.dt;
  for (let s = 0; s < P.numSubsteps; s++) {
    for (const b of P.objects) b.preSolve(sdt, P.gravity);
    for (const b of P.objects) b.solve(sdt);
    for (const b of P.objects) b.postSolve(sdt);
  }
  for (const b of P.objects) b.endFrame();
}

export function release(U) { for (const b of U.P.objects) if (b.skMass) for (let i = 0; i < b.numParticles; i++) if (b.invMass[i] === 0 && b.grabId !== i) b.invMass[i] = b.skMass[i]; W.pinned = 0; }
export function shake(U, r) {
  for (const b of U.P.objects) { const a = r() * 6.283, s = 2 + 2 * r(); for (let i = 0; i < b.numParticles; i++) if (b.invMass[i] > 0) { b.vel[3 * i] += Math.cos(a) * s; b.vel[3 * i + 2] += Math.sin(a) * s; b.vel[3 * i + 1] += 1.5; } }
}
