// ============================================================================
//  JOINT SIMULATION  ·  pages/joints/scenes.js — scenes, schema, rules
// ----------------------------------------------------------------------------
//  The upstream page loads three scene files (basicJoints.json,
//  steering.json, pendulum.json) through its SceneImporter (engine.js).
//  makeScene(cfg, rng) writes more scenes in the same JSON format, so the
//  upstream importer builds them with no change: a hinge chain, a ball
//  joint rope, a robot arm on hinge targets, a windmill on a motor joint
//  with chains on its blades, and cart-poles on prismatic rails. Each body
//  gets a Visual mesh (the importer's coloured display mesh), so the view
//  toggle shows the joint frames as upstream.
//
//  Frames: the upstream hinge, motor and servo turn about the x axis of
//  the joint frame; the prismatic joint slides along that x axis. A frame
//  rotation maps x onto the wanted world axis (frameFor).
//
//  Also here (no DOM, so app.js and tests.mjs share them):
//    FILES, makeSchema(phone), REBUILD, guard(next), sceneRng
//
//  grep -n targets: "function hinges", "function rope", "function arm",
//  "function windmill", "function cartpole", "export function makeScene",
//  "export function makeSchema", "export function guard"
// ============================================================================
import * as K from '../../widgets/sim-kit/core.js';
import { lightControl, floorControl, finishControl } from '../../widgets/sim-kit/stage3d.js';

const THREE = globalThis.THREE;
export const FILES = { basic: './basicJoints.json', steering: './steering.json', pendulum: './pendulum.json' };
export const SCENES = [
  { id: 'basic', label: 'Basic joints (upstream)' }, { id: 'steering', label: 'Steering (upstream)' }, { id: 'pendulum', label: 'Pendulums (upstream)' },
  { id: 'hinges', label: 'Hinge chain' }, { id: 'rope', label: 'Ball-joint rope' }, { id: 'arm', label: 'Robot arm' },
  { id: 'windmill', label: 'Windmill (motor)' }, { id: 'cartpole', label: 'Cart-poles (prismatic)' },
];
export const isFile = id => id in FILES;

// ---- mesh helpers in the importer format -------------------------------------------
const q = (x, y, z, w) => [x, y, z, w];
const QI = q(0, 0, 0, 1);
function frameFor(axis) {   // a rotation that maps the frame x axis onto axis
  const v = new THREE.Vector3(axis[0], axis[1], axis[2]).normalize();
  const r = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), v);
  return q(r.x, r.y, r.z, r.w);
}
function corners(sx, sy, sz) {
  const out = [];
  for (const x of [-sx / 2, sx / 2]) for (const y of [-sy / 2, sy / 2]) for (const z of [-sz / 2, sz / 2]) out.push(x, y, z);
  return out;
}
function geomArrays(g) {
  const p = Array.from(g.attributes.position.array), n = Array.from(g.attributes.normal.array), t = g.index ? Array.from(g.index.array) : null;
  g.dispose();
  return { vertices: p, normals: n, triangles: t };
}
const rnd3 = v => Math.round(v * 1e5) / 1e5;
function body(name, kind, size, pos, density, rot = QI) {
  const v = kind === 'sphere' ? geomArrays(new THREE.SphereGeometry(size[0], 10, 8)).vertices : corners(size[0], size[1], size[2]);
  return { name, vertices: v.map(rnd3), transform: { position: pos, rotation: rot }, properties: { simType: kind === 'sphere' ? 'RigidSphere' : 'RigidBox', density } };
}
function visual(name, parent, geom, pos, color, rot = QI) {
  const a = geomArrays(geom);
  return { name, vertices: a.vertices.map(rnd3), normals: a.normals.map(rnd3), triangles: a.triangles, transform: { position: pos, rotation: rot }, properties: { simType: 'Visual', parent, color } };
}
function joint(name, type, p1, p2, pos, rot, props = {}) {
  return { name, vertices: [], transform: { position: pos, rotation: rot }, properties: Object.assign({ simType: type, parent1: p1, parent2: p2 }, props) };
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const ball = r => new THREE.SphereGeometry(r, 24, 16);
const cyl = (r, h) => new THREE.CylinderGeometry(r, r, h, 20);

// A fixed anchor: a static box (density 0) with a post or a beam to show.
function anchor(M, name, pos, size, col) {
  M.push(body(name, 'box', size, pos, 0));
  M.push(visual(name + 'V', name, box(size[0], size[1], size[2]), pos, col));
}

// ---- our scenes ----------------------------------------------------------------------
// A hinge chain: n links on hinges about z, swinging in the x-y plane,
// from a start angle.
function hinges(c, r, C) {
  const M = [], top = 1.05, n = c.count, L = c.length, a0 = c.angle * Math.PI / 180;
  anchor(M, 'post', [0, top + 0.03, 0], [0.5, 0.04, 0.12], C.wall);
  let prev = 'post', px = 0, py = top;
  const fr = frameFor([0, 0, 1]);
  for (let k = 0; k < n; k++) {
    const a = a0 + (k ? c.bend * (r() - 0.5) : 0), dx = Math.sin(a) * L, dy = -Math.cos(a) * L;
    const cx = px + dx / 2, cy = py + dy / 2, rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
    const nm = 'link' + k, rq = q(rot.x, rot.y, rot.z, rot.w);
    M.push(body(nm, 'box', [0.035, L, 0.035], [cx, cy, 0], c.density, rq));
    M.push(visual(nm + 'V', nm, box(0.035, L, 0.035), [cx, cy, 0], C.pal(k), rq));
    if (k === n - 1) M.push(visual(nm + 'B', nm, ball(0.05), [px + dx, py + dy, 0], C.pal(k + 1)));
    M.push(joint('h' + k, 'HingeJoint', prev, nm, [px, py, 0], fr, Object.assign({ damping: c.damping }, c.limit ? { swingMin: -c.limit * Math.PI / 180, swingMax: c.limit * Math.PI / 180 } : {})));
    prev = nm; px += dx; py += dy;
  }
  return M;
}
// A ball-joint rope: beads joined by ball joints with a swing limit,
// held out to one side, so it falls and swings in 3D.
function rope(c, r, C) {
  const M = [], top = 1.1, n = c.count, L = c.length * 0.6, a0 = c.angle * Math.PI / 180, yaw = (r() - 0.5) * 1.2;
  anchor(M, 'hook', [0, top + 0.03, 0], [0.12, 0.04, 0.12], C.wall);
  let prev = 'hook', p = [0, top, 0];
  for (let k = 0; k < n; k++) {
    const d = [Math.sin(a0) * Math.cos(yaw) * L, -Math.cos(a0) * L, Math.sin(a0) * Math.sin(yaw) * L];
    const cpos = [p[0] + d[0], p[1] + d[1], p[2] + d[2]], nm = 'bead' + k, rad = k === n - 1 ? 0.045 : 0.025;
    M.push(body(nm, 'sphere', [rad, rad, rad], cpos, c.density));
    M.push(visual(nm + 'V', nm, ball(rad), cpos, C.pal(k)));
    M.push(joint('b' + k, 'BallJoint', prev, nm, p.slice(), QI, Object.assign({ damping: c.damping }, c.limit ? { swingMax: c.limit * Math.PI / 180 } : {})));
    prev = nm; p = cpos;
  }
  return M;
}
// A robot arm: a turntable (hinge about y) and links on hinges about z,
// each with a target angle that app.js moves (hasTargetAngle).
function arm(c, r, C) {
  const M = [], n = Math.max(2, Math.min(5, Math.round(c.count / 2))), L = c.length * 1.2;
  anchor(M, 'base', [0, 0.03, 0], [0.3, 0.06, 0.3], C.wall);
  M.push(body('turn', 'box', [0.16, 0.08, 0.16], [0, 0.1, 0], c.density));
  M.push(visual('turnV', 'turn', cyl(0.09, 0.08), [0, 0.1, 0], C.pal(0)));
  M.push(joint('yaw', 'HingeJoint', 'base', 'turn', [0, 0.06, 0], frameFor([0, 1, 0]), { targetAngle: 0, targetAngleCompliance: 0.0001, damping: c.damping + 2 }));
  let prev = 'turn', y = 0.14;
  for (let k = 0; k < n; k++) {
    const nm = 'seg' + k, cy = y + L / 2, w = 0.06 - 0.008 * k;
    M.push(body(nm, 'box', [w, L, w], [0, cy, 0], c.density));
    M.push(visual(nm + 'V', nm, box(w, L, w), [0, cy, 0], C.pal(k + 1)));
    M.push(visual(nm + 'J', nm, cyl(w * 0.75, w * 1.4), [0, y, 0], C.wall, q(0.7071068, 0, 0, 0.7071068)));   // the hinge drum, along z
    M.push(joint('pitch' + k, 'HingeJoint', prev, nm, [0, y, 0], frameFor([0, 0, 1]), { targetAngle: 0, targetAngleCompliance: 0.0001, damping: c.damping + 2, swingMin: -2.2, swingMax: 2.2 }));
    prev = nm; y += L;
  }
  M.push(visual('tip', prev, ball(0.04), [0, y, 0], C.accent));
  return M;
}
// A windmill: a rotor on a motor joint (app.js sets the drive), with
// blades as Visual meshes and a chain of beads on ball joints at each tip.
function windmill(c, r, C) {
  const M = [], hub = [0, 0.95, 0.08], blades = Math.max(2, Math.min(6, Math.round(c.count / 2))), R = 0.32;
  anchor(M, 'tower', [0, 0.47, 0], [0.07, 0.94, 0.07], C.wall);
  M.push(body('rotor', 'box', [0.06, 0.06, 0.05], hub, c.density * 2));
  M.push(visual('hubV', 'rotor', cyl(0.05, 0.06), hub, C.accent, q(0.7071068, 0, 0, 0.7071068)));
  for (let k = 0; k < blades; k++) {
    const a = 2 * Math.PI * k / blades, x = Math.cos(a) * R / 2, y = Math.sin(a) * R / 2;
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
    M.push(visual('blade' + k, 'rotor', box(R, 0.05, 0.012), [hub[0] + x, hub[1] + y, hub[2]], C.pal(k), q(rot.x, rot.y, rot.z, rot.w)));
  }
  M.push(joint('motor', 'MotorJoint', 'tower', 'rotor', hub.slice(), frameFor([0, 0, 1]), { velocity: 3 }));
  // chains from the first blade tips
  const links = Math.max(2, Math.min(5, c.count - 4));
  for (let k = 0; k < Math.min(blades, 3); k++) {
    const a = 2 * Math.PI * k / blades;
    let prev = 'rotor', p = [hub[0] + Math.cos(a) * R, hub[1] + Math.sin(a) * R, hub[2] + 0.03];
    for (let j = 0; j < links; j++) {
      const nm = 'w' + k + '_' + j, cp = [p[0], p[1] - 0.06, p[2]], rad = j === links - 1 ? 0.03 : 0.015;
      M.push(body(nm, 'sphere', [rad, rad, rad], cp, c.density));
      M.push(visual(nm + 'V', nm, ball(rad), cp, C.pal(k + j)));
      M.push(joint('wj' + k + '_' + j, 'BallJoint', prev, nm, p.slice(), QI, { damping: c.damping }));
      prev = nm; p = cp;
    }
  }
  return M;
}
// Cart-poles: carts on a rail (prismatic along x, limited), each with a
// one- or two-link pole on hinges about z. app.js drives the carts.
function cartpole(c, r, C) {
  const M = [], carts = Math.max(1, Math.min(3, Math.round(c.count / 4))), y = 0.5;
  for (let k = 0; k < carts; k++) {
    const z = (k - (carts - 1) / 2) * 0.32, rail = 'rail' + k, cart = 'cart' + k;
    anchor(M, rail, [0, y - 0.04, z], [1.2, 0.02, 0.03], C.wall);
    M.push(body(cart, 'box', [0.14, 0.06, 0.08], [0, y, z], c.density));
    M.push(visual(cart + 'V', cart, box(0.14, 0.06, 0.08), [0, y, z], C.pal(k)));
    M.push(joint('slide' + k, 'PrismaticJoint', rail, cart, [0, y, z], frameFor([1, 0, 0]), { distanceMin: -0.5, distanceMax: 0.5, damping: 0.5 }));
    let prev = cart, px = 0, py = y + 0.03;
    const segs = r() < 0.5 || c.count > 9 ? 2 : 1, L = c.length * 1.4;
    for (let j = 0; j < segs; j++) {
      const a = (c.angle * Math.PI / 180) * (r() < 0.5 ? -1 : 1) * 0.3, dx = Math.sin(a) * L, dy = Math.cos(a) * L;
      const nm = 'pole' + k + '_' + j, rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -a), rq = q(rot.x, rot.y, rot.z, rot.w);
      M.push(body(nm, 'box', [0.02, L, 0.02], [px + dx / 2, py + dy / 2, z], c.density * 0.5, rq));
      M.push(visual(nm + 'V', nm, box(0.02, L, 0.02), [px + dx / 2, py + dy / 2, z], C.pal(k + j + 1), rq));
      if (j === segs - 1) M.push(visual(nm + 'B', nm, ball(0.035), [px + dx, py + dy, z], C.accent));
      M.push(joint('hp' + k + '_' + j, 'HingeJoint', prev, nm, [px, py, z], frameFor([0, 0, 1]), { damping: c.damping * 0.2 }));
      prev = nm; px += dx; py += dy;
    }
  }
  return M;
}

const MAKE = { hinges, rope, arm, windmill, cartpole };
// cfg: { scene, count, length, angle, bend, limit, damping, density };
// C: { pal(k) -> [r, g, b], wall, accent } colours for the Visual meshes.
export function makeScene(cfg, r, C) {
  const f = MAKE[cfg.scene] || hinges;
  return { meshes: f(cfg, r, C), exportInfo: { by: 'davesgames.io scenes.js', scene: cfg.scene } };
}

// ---- schema ---------------------------------------------------------------------------
export function makeSchema(PHONE) {
  return { groups: [
    { id: 'scene', label: 'Scene', controls: [
      { key: 'scene', type: 'choice', label: 'Scene', value: 'basic', seg: false, options: SCENES, rebuild: true,
        random: { weights: { basic: 2, steering: 2, pendulum: 2, hinges: 3, rope: 3, arm: 3, windmill: 3, cartpole: 3 } } },
      { key: 'count', type: 'range', label: 'Count (links, beads, blades, carts)', min: 2, max: 14, step: 1, value: 6, rebuild: true, random: { dist: 'int', min: 3, max: 12 } },
      { key: 'length', type: 'range', label: 'Link length', min: 0.06, max: 0.3, step: 0.01, value: 0.15, unit: 'm', rebuild: true, random: { min: 0.08, max: 0.22 } },
      { key: 'angle', type: 'range', label: 'Start angle', min: 0, max: 120, step: 1, value: 70, unit: '°', rebuild: true, random: { min: 30, max: 110 } },
      { key: 'bend', type: 'range', label: 'Start bend', min: 0, max: 2, step: 0.01, value: 0.4, rebuild: true, random: { min: 0, max: 1.4 } },
      { key: 'limit', type: 'range', label: 'Swing limit (0: none)', min: 0, max: 170, step: 1, value: 0, unit: '°', rebuild: true, random: { min: 0, max: 120 } },
      { key: 'density', type: 'range', label: 'Density', min: 100, max: 5000, step: 50, value: 1000, unit: 'kg/m³', rebuild: true, random: { dist: 'log', min: 300, max: 3000 } },
      { key: 'damping', type: 'range', label: 'Joint damping', min: 0, max: 20, step: 0.1, value: 1, rebuild: true, random: { min: 0, max: 6 } },
    ] },
    { id: 'drive', label: 'Drive', hint: 'Drag any body. The joystick drives the upstream steering scene.', controls: [
      { key: 'auto', type: 'toggle', label: 'Autopilot (motors, servos, arm, carts)', value: true, random: { p: 0.9 } },
      { key: 'throttle', type: 'range', label: 'Throttle', min: -1, max: 1, step: 0.01, value: 0.6, random: { min: -1, max: 1 } },
      { key: 'steer', type: 'range', label: 'Steer swing', min: 0, max: 1, step: 0.01, value: 0.6, random: { min: 0, max: 1 } },
      { key: 'rate', type: 'range', label: 'Drive rate', min: 0.05, max: 2, step: 0.01, value: 0.4, unit: 'Hz', random: { min: 0.15, max: 1 } },
      { type: 'buttons', key: 'act', label: 'Do', action: 'act', items: [{ id: 'kick', label: 'Kick' }, { id: 'view', label: 'Joint frames' }, { id: 'still', label: 'Still' }] },
    ] },
    { id: 'physics', label: 'Physics', controls: [
      { key: 'g', type: 'range', label: 'Gravity', min: 0, max: 20, step: 0.01, value: 9.81, unit: 'm/s²', random: { dist: 'normal', mean: 9.81, sd: 2.5, min: 3, max: 16 } },
      { key: 'slow', type: 'range', label: 'Time scale', min: 0.1, max: 1.5, step: 0.05, value: 1, unit: '×', random: false },
    ] },
    { id: 'look', label: 'Look', controls: [
      K.themeControl('night'),
      lightControl('studio'),
      floorControl('grid'),
      finishControl('gloss'),
      K.paletteControl('toybox'),
      { key: 'recolour', type: 'toggle', label: 'Recolour upstream scenes', value: true, random: { p: 0.6 } },
      { key: 'frames', type: 'toggle', label: 'Show joint frames', value: false, random: { p: 0.15 } },
    ] },
    { id: 'solver', label: 'Solver', open: false, random: false, controls: [
      { key: 'substeps', type: 'range', label: 'Substeps', min: 5, max: 40, step: 1, value: PHONE ? 12 : 20, phone: 12, rebuild: true },
      { type: 'note', text: 'Upstream (Ten Minute Physics #25): XPBD joints (distance, hinge, servo, motor, ball, prismatic, cylinder) at 30 frames per second, 20 substeps. Bodies do not collide with each other.' },
    ] },
  ] };
}
export const REBUILD = new Set(['scene', 'count', 'length', 'angle', 'bend', 'limit', 'density', 'damping', 'substeps']);
export function guard(next) {
  const s = Object.assign({}, next);
  if (s.scene === 'arm') s.angle = Math.min(s.angle, 60);
  // a hanging chain must clear the floor (bodies do not touch the floor)
  if (s.scene === 'hinges') s.count = Math.max(2, Math.min(s.count, Math.floor(0.9 / s.length)));
  if (s.scene === 'rope') s.count = Math.max(2, Math.min(s.count, Math.floor(0.95 / (0.6 * s.length))));
  if (s.scene === 'windmill') s.count = Math.max(6, s.count);
  if (s.scene === 'cartpole') s.limit = 0;
  if (s.scene === 'rope' && s.limit && s.limit < 25) s.limit = 25;
  // heavy beads on light damping whip the rope too hard
  if ((s.scene === 'rope' || s.scene === 'hinges') && s.count > 9 && s.damping < 0.5) s.damping = 0.5;
  return s;
}
export const sceneRng = seed => K.rng((seed ^ 0x68e31da4) >>> 0);
export function sceneConfig(st) { return { scene: st.scene, count: st.count, length: st.length, angle: st.angle, bend: st.bend, limit: st.limit, density: st.density, damping: st.damping }; }
