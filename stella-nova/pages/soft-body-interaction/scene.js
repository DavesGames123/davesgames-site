// ============================================================================
//  GRAB INTERACTION  ·  pages/soft-body-interaction/scene.js — controls,
//  guard and scene build (no DOM: tests.mjs runs it in node)
// ----------------------------------------------------------------------------
//  The physics is the upstream Ball of main.js (Ten Minute Physics #08,
//  Matthias Müller, MIT): a sphere with gravity that reflects from the
//  floor and the walls of a box, picked up and thrown with the grabber.
//  This file adds, around Ball.simulate:
//    - many balls of mixed sizes and the start (rain, burst, stack, throw)
//    - restitution: a wrap scales the velocity parts the upstream bounce
//      reflects (upstream bounces lose nothing)
//    - ball-ball collisions, obstacles (spheres, boxes, pillars) and a
//      ceiling when gravity is low, with the same restitution
//    - substeps: the upstream step runs n times at dt / n
//    - visible arena walls
//
//  grep -n targets: "export function makeSchema", "export function guard",
//  "export function build", "export function simulate", "function contacts"
// ============================================================================
import * as S3 from '../soft-bodies/stage3d.js';

export function makeSchema(PHONE) {
  return { groups: [
    { id: 'balls', label: 'Balls', open: true, controls: [
      { key: 'count', type: 'range', label: 'Balls', min: 1, max: PHONE ? 16 : 40, step: 1, value: 8, phone: 6, rebuild: true, random: { dist: 'int', min: 1, max: PHONE ? 12 : 28 } },
      { key: 'radius', type: 'range', label: 'Radius', min: 0.05, max: 0.35, step: 0.01, value: 0.16, unit: 'm', rebuild: true, random: { min: 0.07, max: 0.26 } },
      { key: 'mix', type: 'range', label: 'Size mix', min: 0, max: 1, step: 0.05, value: 0.4, rebuild: true, random: { min: 0, max: 0.9 } },
      { key: 'launch', type: 'choice', label: 'Start', value: 'rain', seg: false, rebuild: true, options: [
        { id: 'rain', label: 'Rain' }, { id: 'burst', label: 'Burst' }, { id: 'stack', label: 'Stack' }, { id: 'throw', label: 'Thrown' }],
        random: { weights: { rain: 3, burst: 2, stack: 2, throw: 2 } } },
      { key: 'speed', type: 'range', label: 'Start speed', min: 0, max: 10, step: 0.1, value: 3, unit: 'm/s', rebuild: true, random: { min: 1, max: 7 } },
    ] },
    { id: 'world', label: 'World', controls: [
      { key: 'g', type: 'range', label: 'Gravity', min: 0, max: 20, step: 0.1, value: 10, unit: 'm/s²', random: { min: 2, max: 15 } },
      { key: 'e', type: 'range', label: 'Bounce (restitution)', min: 0.2, max: 1, step: 0.01, value: 0.85, random: { min: 0.55, max: 0.98 } },
      { key: 'width', type: 'range', label: 'Box width', min: 0.6, max: 4, step: 0.1, value: 3, unit: 'm', rebuild: true, random: { min: 1.6, max: 3.6 } },
      { key: 'depth', type: 'range', label: 'Box depth', min: 0.6, max: 6, step: 0.1, value: 5, unit: 'm', rebuild: true, random: { min: 1.6, max: 5 } },
      { key: 'collide', type: 'toggle', label: 'Balls collide', value: true, random: { p: 0.9 } },
      { key: 'obstacles', type: 'range', label: 'Obstacles', min: 0, max: 6, step: 1, value: 2, rebuild: true, random: { dist: 'int', min: 0, max: 5 } },
      { key: 'obKind', type: 'choice', label: 'Obstacle kind', value: 'mixed', seg: false, rebuild: true, options: [
        { id: 'mixed', label: 'Mixed' }, { id: 'spheres', label: 'Spheres' }, { id: 'boxes', label: 'Boxes' }, { id: 'pillars', label: 'Pillars' }] },
      { key: 'subs', type: 'range', label: 'Substeps', min: 1, max: 8, step: 1, value: 4, random: false },
      { key: 'walls', type: 'toggle', label: 'Show the box', value: true, random: { p: 0.8 } },
    ] },
    S3.lookGroup([], { mat: 'gloss', palette: 'toybox' }),
    { id: 'act', label: 'Actions', random: false, controls: [
      { type: 'buttons', label: 'Do', action: 'act', items: [{ id: 'throw', label: 'Throw all' }, { id: 'burst', label: 'Burst' }, { id: 'add', label: 'Add a ball' }, { id: 'calm', label: 'Calm' }] },
      { type: 'note', text: 'Drag a ball to pick it up, let go to throw it. Drag an obstacle to move it. Drag the floor to turn the view.' },
    ] },
  ] };
}

// The balls must fit: total footprint at most 45 % of the floor.
export function guard(next) {
  const out = Object.assign({}, next);
  const area = out.width * out.depth, rMax = out.radius * (1 + out.mix);
  while (out.count > 1 && out.count * Math.PI * rMax * rMax > 0.45 * area) out.count--;
  if (out.radius * (1 + out.mix) > 0.42 * Math.min(out.width, out.depth)) out.mix = 0;
  return out;
}

export const KINDS = { mixed: ['sphere', 'box', 'pillar'], spheres: ['sphere'], boxes: ['box'], pillars: ['pillar'] };
export const W = { obs: [], e: 0.85, collide: true, ceil: 0, meshes: [], arena: null, hits: 0 };

// U = { THREE, scene, P, Ball }
export function install(U) {
  // restitution: upstream reflects a velocity part on a bounce; scale it
  S3.wrapBefore(U.Ball.prototype, 'simulate', b => { b._vx = b.vel.x; b._vy = b.vel.y; b._vz = b.vel.z; });
  S3.wrapAfter(U.Ball.prototype, 'simulate', b => {
    if (b.grabbed) return;
    const e = W.e, v = b.vel;
    if (Math.sign(v.x) !== Math.sign(b._vx) && b._vx !== 0) v.x *= e;
    if (Math.sign(v.z) !== Math.sign(b._vz) && b._vz !== 0) v.z *= e;
    if (b._vy < 0 && v.y > 0 && b.pos.y <= b.radius + 1e-9) v.y *= e;
  });
}

export function clear(U) {
  for (const b of U.P.objects) { U.scene.remove(b.visMesh); b.visMesh.geometry.dispose(); b.visMesh.material.dispose(); }
  U.P.objects.length = 0;
  S3.disposeMeshes({ gThreeScene: U.scene }, W.meshes); W.meshes = [];
  if (W.arena) { U.scene.remove(W.arena); W.arena.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); W.arena = null; }
}

function radiusOf(st, r) { return Math.max(0.04, st.radius * (1 - 0.5 * st.mix + st.mix * 1.5 * r())); }

export function build(U, st, r) {
  clear(U);
  const THREE = U.THREE, P = U.P;
  P.worldSize = { x: st.width / 2, z: st.depth / 2 };
  W.e = st.e; W.collide = st.collide;
  W.obs = S3.makeObstacles(r, st.obstacles, { area: [st.width / 2 - 0.25, st.depth / 2 - 0.25], size: [0.12, 0.3], kinds: KINDS[st.obKind] || KINDS.mixed, keepOut: st.launch === 'stack' ? [0, 0, 0, 0.45] : null });
  const n = st.count, s = st.speed;
  for (let i = 0; i < n; i++) {
    const rad = radiusOf(st, r);
    const hx = P.worldSize.x - rad, hz = P.worldSize.z - rad;
    let pos, vel;
    switch (st.launch) {
      case 'burst': { const a = r() * 6.283, el = 0.3 + 0.9 * r(); pos = [(r() - 0.5) * 0.2, 0.6 + 0.2 * r(), (r() - 0.5) * 0.2]; vel = [Math.cos(a) * Math.cos(el) * s, Math.sin(el) * s + 2, Math.sin(a) * Math.cos(el) * s]; break; }
      case 'stack': pos = [(r() - 0.5) * 0.05, rad + 0.05 + i * 2.1 * st.radius * (1 + st.mix), (r() - 0.5) * 0.05]; vel = [0, 0, 0]; break;
      case 'throw': { pos = [-hx * 0.9, 0.4 + r() * 1.2, (r() - 0.5) * 2 * hz * 0.8]; vel = [s + r() * 2, 2 + 3 * r(), (r() - 0.5) * 2]; break; }
      default: pos = [(r() - 0.5) * 2 * hx, 1 + r() * 2.5, (r() - 0.5) * 2 * hz]; vel = [(r() - 0.5) * s, 0, (r() - 0.5) * s];
    }
    pos[0] = Math.max(-hx, Math.min(hx, pos[0])); pos[2] = Math.max(-hz, Math.min(hz, pos[2]));
    const b = new U.Ball(new THREE.Vector3(pos[0], pos[1], pos[2]), rad, new THREE.Vector3(vel[0], vel[1], vel[2]));
    b.visMesh.castShadow = true;
    P.objects.push(b);
  }
  arena(U, st);
  live(U, st);
  return { balls: P.objects.length, obstacles: W.obs.length };
}

// Glass walls and a rim around the upstream box (|x| < width/2, |z| < depth/2).
function arena(U, st) {
  const THREE = U.THREE, g = new THREE.Group(), hx = st.width / 2, hz = st.depth / 2, h = 0.6;
  const glass = new THREE.MeshPhongMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false });
  for (const [w, x, z, ry] of [[st.width, 0, -hz, 0], [st.width, 0, hz, 0], [st.depth, -hx, 0, Math.PI / 2], [st.depth, hx, 0, Math.PI / 2]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glass.clone()); m.position.set(x, h / 2, z); m.rotation.y = ry; g.add(m);
  }
  const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(st.width, h, st.depth)), new THREE.LineBasicMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.55 }));
  box.position.y = h / 2; g.add(box);
  g.visible = st.walls !== false;
  U.scene.add(g); W.arena = g;
}

export function live(U, st) {
  W.e = st.e; W.collide = st.collide; W.subs = st.subs;
  U.P.gravity.set(0, -st.g, 0);
  // a ceiling keeps low-gravity balls in view
  W.ceil = st.g < 3 ? 2.6 : 0;
  if (W.arena) W.arena.visible = st.walls !== false;
}

// Ball-ball, ball-obstacle and ceiling contacts with restitution W.e.
function contacts(list) {
  const e = W.e;
  if (W.collide) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y, dz = b.pos.z - a.pos.z, R = a.radius + b.radius;
    const d2 = dx * dx + dy * dy + dz * dz; if (d2 >= R * R || d2 === 0) continue;
    const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, nz = dz / d;
    const ma = a.grabbed ? 0 : 1 / (a.radius ** 3), mb = b.grabbed ? 0 : 1 / (b.radius ** 3), w = ma + mb; if (!w) continue;
    const corr = (R - d) / w;
    a.pos.x -= nx * corr * ma; a.pos.y -= ny * corr * ma; a.pos.z -= nz * corr * ma;
    b.pos.x += nx * corr * mb; b.pos.y += ny * corr * mb; b.pos.z += nz * corr * mb;
    const vn = (b.vel.x - a.vel.x) * nx + (b.vel.y - a.vel.y) * ny + (b.vel.z - a.vel.z) * nz;
    if (vn >= 0) continue;
    const jn = -(1 + e) * vn / w;
    a.vel.x -= jn * ma * nx; a.vel.y -= jn * ma * ny; a.vel.z -= jn * ma * nz;
    b.vel.x += jn * mb * nx; b.vel.y += jn * mb * ny; b.vel.z += jn * mb * nz;
    W.hits++;
  }
  for (const b of list) {
    if (b.grabbed) continue;
    for (const o of W.obs) {
      let qx, qy, qz;
      if (o.type === 'sphere') { qx = o.c[0]; qy = o.c[1]; qz = o.c[2]; }
      else { qx = Math.max(o.c[0] - o.h[0], Math.min(b.pos.x, o.c[0] + o.h[0])); qy = Math.max(o.c[1] - o.h[1], Math.min(b.pos.y, o.c[1] + o.h[1])); qz = Math.max(o.c[2] - o.h[2], Math.min(b.pos.z, o.c[2] + o.h[2])); }
      let dx = b.pos.x - qx, dy = b.pos.y - qy, dz = b.pos.z - qz;
      const R = b.radius + (o.type === 'sphere' ? o.r : 0);
      let d = Math.hypot(dx, dy, dz);
      if (d >= R) continue;
      if (d < 1e-9) { dx = 0; dy = 1; dz = 0; d = 1e-9; }
      const nx = dx / d, ny = dy / d, nz = dz / d;
      b.pos.x = qx + nx * R; b.pos.y = qy + ny * R; b.pos.z = qz + nz * R;
      const vn = b.vel.x * nx + b.vel.y * ny + b.vel.z * nz;
      if (vn < 0) { b.vel.x -= (1 + e) * vn * nx; b.vel.y -= (1 + e) * vn * ny; b.vel.z -= (1 + e) * vn * nz; }
    }
    if (W.ceil && b.pos.y > W.ceil - b.radius) { b.pos.y = W.ceil - b.radius; if (b.vel.y > 0) b.vel.y *= -e; }
    b.visMesh.position.copy(b.pos);
  }
}

// One frame: the upstream Ball.simulate W.subs times at dt / subs, each
// followed by the contacts. The page passes its own upstream simulate for
// the grabber clock (after: true).
export function simulate(U, after) {
  const P = U.P, dt = P.dt, n = Math.max(1, W.subs || 1);
  P.dt = dt / n;
  for (let s = 0; s < n; s++) { for (const b of P.objects) b.simulate(); contacts(P.objects); }
  P.dt = dt;
  if (after) after();
}

export function kick(U, r, mode) {
  for (const b of U.P.objects) {
    if (b.grabbed) continue;
    if (mode === 'calm') { b.vel.set(0, 0, 0); continue; }
    const a = r() * 6.283, s = mode === 'burst' ? 3 + 3 * r() : 2 + 4 * r();
    b.vel.set(b.vel.x + Math.cos(a) * s, b.vel.y + (mode === 'burst' ? 6 + 3 * r() : 3 + 3 * r()), b.vel.z + Math.sin(a) * s);
  }
}
