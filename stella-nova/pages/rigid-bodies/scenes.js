// ============================================================================
//  RIGID BODIES  ·  pages/rigid-bodies/scenes.js — scenes, schema, rules
// ----------------------------------------------------------------------------
//  buildScene(sim, root, cfg, rng) fills an upstream RigidBodySimulator
//  (sim.js) with bodies and distance constraints. The two upstream scenes
//  are here with their parameters opened up: the crib mobile (a tree of
//  bars whose sphere radii balance every level) and the chain of boxes
//  whose mass doubles per link (with force and stretch labels). Our
//  scenes use the same two parts: a pendulum wave, a chandelier, a rope
//  bridge, a net, and a wrecking ball. The bodies have no contacts with
//  each other, as upstream.
//
//  Also here (no DOM, so app.js and tests.mjs share them):
//    makeSchema(phone), REBUILD, guard(next), sceneConfig(st), sceneRng
//
//  grep -n targets: "function mobile", "function chain", "function
//  pendulums", "function chandelier", "function bridge", "function net",
//  "function wrecking", "export function makeSchema", "export function guard"
// ============================================================================
import { RigidBody, DistanceConstraint, RigidBodySimulator } from './sim.js';
import * as K from '../../widgets/sim-kit/core.js';
import { lightControl, floorControl, finishControl } from '../../widgets/sim-kit/stage3d.js';

const THREE = globalThis.THREE;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const ZERO = () => V3(0, 0, 0);
export const SCENES = [
  { id: 'mobile', label: 'Crib mobile (upstream)' }, { id: 'chain', label: 'Mass chain (upstream)' }, { id: 'pendulums', label: 'Pendulum wave' },
  { id: 'chandelier', label: 'Chandelier' }, { id: 'bridge', label: 'Rope bridge' }, { id: 'net', label: 'Net' }, { id: 'wrecking', label: 'Wrecking ball' },
];
export const TOP = 2.5;   // the hanging point height of every scene (upstream)

// ---- upstream scene 0: the crib mobile ----------------------------------------
// The upstream initScene(0), with levels, length, height and density as
// parameters. Each sphere has the volume of the subtree it balances.
function mobile(sim, root, c, r) {
  const unilateral = true, compliance = 0.0, length = c.length, thickness = 0.04, height = c.height, baseRadius = 0.08;
  const distance = 0.5 * length - thickness;
  const barSize = V3(length, thickness, thickness), angles = ZERO();
  const barPos = V3(0.0, TOP, 0.0);
  let prevBar = null;
  const numLevels = c.levels;
  const volBar = length * thickness * thickness;
  let volTree = 2.0 * 4.0 / 3.0 * Math.PI * baseRadius ** 3 + volBar;
  const radii = [baseRadius];
  for (let i = 1; i < numLevels; i++) { radii.push(Math.pow(3.0 / 4.0 / Math.PI * volTree, 1.0 / 3.0)); volTree = 2.0 * volTree + volBar; }
  for (let i = 0; i < numLevels; i++) {
    const radius = radii[numLevels - i - 1];
    const bar = new RigidBody(root, 'box', barSize, c.density, barPos, angles);
    sim.addRigidBody(bar);
    let p0 = V3(barPos.x, barPos.y + 0.5 * thickness, barPos.z), p1 = V3(barPos.x, barPos.y + height - 0.5 * thickness, barPos.z);
    sim.addDistanceConstraint(new DistanceConstraint(root, bar, prevBar, p0, p1, height - thickness, compliance, unilateral));
    const spherePos = V3(barPos.x + distance, barPos.y - height, barPos.z), sphereSize = V3(radius, radius, radius);
    let sphere = new RigidBody(root, 'sphere', sphereSize, c.density, spherePos, angles);
    sim.addRigidBody(sphere);
    p0 = V3(spherePos.x, spherePos.y + 0.5 * radius, spherePos.z); p1 = V3(spherePos.x, spherePos.y + height - 0.5 * thickness, spherePos.z);
    sim.addDistanceConstraint(new DistanceConstraint(root, sphere, bar, p0, p1, height - thickness, compliance, unilateral));
    if (i === numLevels - 1) {
      spherePos.x -= 2.0 * distance;
      sphere = new RigidBody(root, 'sphere', sphereSize, c.density, spherePos, angles);
      sim.addRigidBody(sphere);
      p0.x -= 2.0 * distance; p1.x -= 2.0 * distance;
      sim.addDistanceConstraint(new DistanceConstraint(root, sphere, bar, p0, p1, height - thickness, compliance, unilateral));
    }
    prevBar = bar; barPos.y -= height; barPos.x -= distance;
  }
  // a push so the mobile turns from the start
  const top = sim.rigidBodies[0]; if (top) top.omega.set(0, c.spin, 0);
}

// ---- upstream scene 1: the chain of boxes ------------------------------------------
// The upstream initScene(1): each box has growth^3 times the volume of the
// one above it (upstream: 2, so the mass doubles), with force labels.
function chain(sim, root, c) {
  // the upstream compliance holds for its density 1000; a denser chain
  // gets a stiffer thread, so the stretch stays near the upstream one
  const unilateral = false, compliance = c.compliance * 1000 / c.density;
  const boxSize = V3(0.1, 0.1, 0.1), boxPos = V3(0.0, TOP, 0.0), boxAngles = ZERO();
  const width = 0.01, fontSize = c.labels ? 0.03 : 0.0, dist = 0.2;
  let prevY = TOP, prevSize = 0.0, prevBox = null;
  for (let level = 0; level < c.links; level++) {
    prevY = boxPos.y; boxPos.y -= dist + boxSize.y;
    const box = new RigidBody(root, 'box', boxSize, c.density, boxPos, boxAngles, fontSize);
    box.damping = c.damping;
    sim.addRigidBody(box);
    const p0 = V3(0.4 * prevSize, boxPos.y + 0.5 * boxSize.y, 0.0), p1 = V3(0.4 * prevSize, prevY - 0.5 * prevSize, 0.0);
    sim.addDistanceConstraint(new DistanceConstraint(root, box, prevBox, p0, p1, p1.y - p0.y, compliance, unilateral, width, fontSize));
    prevBox = box; prevSize = boxSize.y;
    boxSize.multiplyScalar(Math.cbrt(c.growth));
  }
}

// ---- ours -----------------------------------------------------------------------------
// A pendulum wave: n spheres on threads from a world bar; thread k has
// the length whose period fits (N0 + k) swings in the cycle time T.
function pendulums(sim, root, c) {
  const n = c.count, g = c.g, T = 30, N0 = 18, span = 1.6;
  for (let k = 0; k < n; k++) {
    const per = T / (N0 + k), L = g * (per / (2 * Math.PI)) ** 2;
    const x = -span / 2 + span * k / Math.max(1, n - 1), a = c.angle * Math.PI / 180;
    const anchor = V3(x, TOP, 0), pos = V3(x, TOP - L * Math.cos(a), L * Math.sin(a));
    const rad = 0.045;
    const b = new RigidBody(root, 'sphere', V3(rad, rad, rad), c.density, pos, ZERO());
    sim.addRigidBody(b);
    sim.addDistanceConstraint(new DistanceConstraint(root, b, undefined, pos.clone(), anchor, L, 0.0, false, 0.004));
  }
}
// A chandelier: a plate on three threads, with a chain and a drop at
// each point of its rim.
function chandelier(sim, root, c, r) {
  const arms = c.count, R = 0.36, y = TOP - 0.45;
  const hub = new RigidBody(root, 'box', V3(2 * R, 0.03, 2 * R), c.density * 0.5, V3(0, y, 0), ZERO());
  sim.addRigidBody(hub);
  for (let k = 0; k < 3; k++) {
    const a = 2 * Math.PI * k / 3, p = V3(Math.cos(a) * R * 0.9, y + 0.015, Math.sin(a) * R * 0.9);
    sim.addDistanceConstraint(new DistanceConstraint(root, hub, undefined, p.clone(), V3(0, TOP, 0), p.distanceTo(V3(0, TOP, 0)), 0.0, false, 0.005));
  }
  for (let k = 0; k < arms; k++) {
    const a = 2 * Math.PI * k / arms, x = Math.cos(a) * R * 0.95, z = Math.sin(a) * R * 0.95;
    const len = 0.2 + 0.35 * r(), links = 2 + Math.floor(3 * r());
    let prev = hub, py = y - 0.015;
    for (let j = 0; j < links; j++) {
      const last = j === links - 1, s = last ? 0.045 + 0.04 * r() : 0.018;
      const pos = V3(x, py - len / links, z);
      const b = last ? new RigidBody(root, 'sphere', V3(s, s, s), c.density, pos, ZERO()) : new RigidBody(root, 'box', V3(s, 2 * s, s), c.density, pos, ZERO());
      sim.addRigidBody(b);
      const att = V3(x, py, z);
      sim.addDistanceConstraint(new DistanceConstraint(root, b, prev, pos.clone(), att, pos.distanceTo(att), c.compliance, false, 0.005));
      prev = b; py = pos.y;
    }
  }
  hub.omega.set(0, c.spin, 0);
}
// A rope bridge: planks between two world posts, each joined to the next
// at both rope sides.
function bridge(sim, root, c) {
  const n = c.count, span = 1.8, w = 0.32, gap = span / n, y = TOP - 0.6;
  let prev = null;
  for (let k = 0; k <= n; k++) {
    const x = -span / 2 + k * gap;
    if (k === n) {
      for (const s of [-1, 1]) { const p = V3(x - 0.02, y, s * w / 2); sim.addDistanceConstraint(new DistanceConstraint(root, prev, undefined, p.clone(), V3(span / 2 + 0.05, y + 0.25, s * w / 2), 0.32, c.compliance, false, 0.006)); }
      break;
    }
    const pos = V3(x + gap / 2, y, 0), plank = new RigidBody(root, 'box', V3(gap * 0.82, 0.03, w), c.density, pos, ZERO());
    sim.addRigidBody(plank);
    for (const s of [-1, 1]) {
      const p = V3(x + gap * 0.09, y, s * w / 2);
      if (!prev) sim.addDistanceConstraint(new DistanceConstraint(root, plank, undefined, p.clone(), V3(-span / 2 - 0.05, y + 0.25, s * w / 2), 0.32, c.compliance, false, 0.006));
      else sim.addDistanceConstraint(new DistanceConstraint(root, plank, prev, p.clone(), V3(x - gap * 0.09, y, s * w / 2), gap * 0.18, c.compliance, false, 0.006));
    }
    prev = plank;
  }
}
// A net: a grid of beads joined to the right and below, the top row tied
// to world points.
function net(sim, root, c) {
  const n = c.count, size = 1.2, d = size / (n - 1), rad = 0.025, grid = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const pos = V3(-size / 2 + i * d, TOP - 0.1 - j * d * 0.95, 0.15 * Math.sin(i * 0.9));
    const b = new RigidBody(root, 'sphere', V3(rad, rad, rad), c.density, pos, ZERO());
    sim.addRigidBody(b); grid.push(b);
  }
  const at = (i, j) => grid[j * n + i];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const b = at(i, j);
    if (i + 1 < n) sim.addDistanceConstraint(new DistanceConstraint(root, b, at(i + 1, j), b.pos.clone(), at(i + 1, j).pos.clone(), b.pos.distanceTo(at(i + 1, j).pos), c.compliance, false, 0.004));
    if (j + 1 < n) sim.addDistanceConstraint(new DistanceConstraint(root, at(i, j + 1), b, at(i, j + 1).pos.clone(), b.pos.clone(), b.pos.distanceTo(at(i, j + 1).pos), c.compliance, false, 0.004));
    if (j === 0) sim.addDistanceConstraint(new DistanceConstraint(root, b, undefined, b.pos.clone(), V3(b.pos.x, TOP + 0.05, 0), 0.15, 0.0, false, 0.004));
  }
}
// A wrecking ball: a chain of links with a heavy sphere, let go from the side.
function wrecking(sim, root, c) {
  const links = c.count, a = c.angle * Math.PI / 180, L = 1.35, step = L / (links + 1);
  let prev = null, prevP = V3(0, TOP, 0);
  for (let k = 1; k <= links + 1; k++) {
    const last = k === links + 1, pos = V3(Math.sin(a) * step * k, TOP - Math.cos(a) * step * k, 0);
    const b = last ? new RigidBody(root, 'sphere', V3(0.16, 0.16, 0.16), c.density * 2, pos, ZERO()) : new RigidBody(root, 'box', V3(0.03, step * 0.7, 0.03), c.density, pos, V3(0, 0, a));
    sim.addRigidBody(b);
    // stiff links: a soft compliance stretches under the heavy ball
    sim.addDistanceConstraint(new DistanceConstraint(root, b, prev || undefined, pos.clone(), prevP.clone(), pos.distanceTo(prevP), 0.0, false, 0.008));
    prev = b; prevP = pos;
  }
}

const BUILD = { mobile, chain, pendulums, chandelier, bridge, net, wrecking };
// Our scenes hang heavier bodies than the upstream chain: their threads
// take a twentieth of the compliance, so they stretch by millimetres.
const SOFT = { chandelier: 0.05, bridge: 0.05, net: 0.05 };
// cfg: { scene, levels, length, height, links, growth, labels, count,
//        angle, density, compliance, damping, spin, g, dt, substeps }
export function buildScene(root, cfg, r) {
  const sim = new RigidBodySimulator(root, cfg.dt, V3(0, -cfg.g, 0));
  sim.numSubSteps = cfg.substeps;
  const k = SOFT[cfg.scene];
  (BUILD[cfg.scene] || mobile)(sim, root, k ? Object.assign({}, cfg, { compliance: cfg.compliance * k }) : cfg, r);
  return sim;
}

// ---- schema -------------------------------------------------------------------------
export function makeSchema(PHONE) {
  return { groups: [
    { id: 'scene', label: 'Scene', controls: [
      { key: 'scene', type: 'choice', label: 'Scene', value: 'mobile', seg: false, options: SCENES, rebuild: true, random: { weights: { mobile: 3, chain: 2, pendulums: 3, chandelier: 3, bridge: 2, net: 2, wrecking: 2 } } },
      { key: 'levels', type: 'range', label: 'Mobile levels', min: 2, max: 7, step: 1, value: 5, rebuild: true, random: { dist: 'int', min: 3, max: 6 } },
      { key: 'length', type: 'range', label: 'Mobile bar length', min: 0.4, max: 1.4, step: 0.01, value: 0.9, unit: 'm', rebuild: true, random: { min: 0.6, max: 1.2 } },
      { key: 'height', type: 'range', label: 'Mobile drop', min: 0.15, max: 0.5, step: 0.01, value: 0.3, unit: 'm', rebuild: true, random: { min: 0.2, max: 0.4 } },
      { key: 'links', type: 'range', label: 'Chain links', min: 2, max: 7, step: 1, value: 4, rebuild: true, random: { dist: 'int', min: 3, max: 6 } },
      { key: 'growth', type: 'range', label: 'Mass growth per link', min: 1, max: 3, step: 0.05, value: 2, unit: '×', rebuild: true, random: { min: 1.2, max: 2.6 } },
      { key: 'labels', type: 'toggle', label: 'Force labels (chain)', value: true, rebuild: true, random: { p: 0.7 } },
      { key: 'count', type: 'range', label: 'Count (pendulums, arms, planks, net, links)', min: 3, max: 16, step: 1, value: 10, rebuild: true, random: { dist: 'int', min: 5, max: 14 } },
      { key: 'angle', type: 'range', label: 'Start angle', min: 0, max: 80, step: 1, value: 30, unit: '°', rebuild: true, random: { min: 15, max: 70 } },
      { key: 'spin', type: 'range', label: 'Start spin', min: -3, max: 3, step: 0.05, value: 0.6, unit: 'rad/s', rebuild: true, random: { dist: 'normal', mean: 0, sd: 1, min: -2, max: 2 } },
    ] },
    { id: 'physics', label: 'Physics', hint: 'Drag any body; let go fast to throw it.', controls: [
      { key: 'g', type: 'range', label: 'Gravity', min: 1, max: 20, step: 0.1, value: 10, unit: 'm/s²', random: { dist: 'normal', mean: 10, sd: 2.5, min: 4, max: 16 } },
      { key: 'density', type: 'range', label: 'Density', min: 100, max: 8000, step: 50, value: 1000, unit: 'kg/m³', rebuild: true, random: { dist: 'log', min: 300, max: 5000 } },
      { key: 'compliance', type: 'range', label: 'Compliance', min: 0, max: 0.01, step: 0.0001, value: 0.001, rebuild: true, random: { dist: 'log', min: 0.0001, max: 0.005 } },
      { key: 'damping', type: 'range', label: 'Chain damping', min: 0, max: 10, step: 0.1, value: 5, rebuild: true, random: { min: 0, max: 6 } },
      { key: 'windX', type: 'range', label: 'Wind x', min: -10, max: 10, step: 0.1, value: 0, unit: 'm/s²', random: { dist: 'normal', mean: 0, sd: 1.2, min: -4, max: 4 } },
      { key: 'windZ', type: 'range', label: 'Wind z', min: -10, max: 10, step: 0.1, value: 0, unit: 'm/s²', random: { dist: 'normal', mean: 0, sd: 1.2, min: -4, max: 4 } },
      { key: 'gust', type: 'range', label: 'Gusts', min: 0, max: 1, step: 0.01, value: 0, random: { min: 0, max: 0.6 } },
      { type: 'buttons', key: 'act', label: 'Do', action: 'act', items: [{ id: 'kick', label: 'Kick' }, { id: 'spin', label: 'Spin' }, { id: 'still', label: 'Still' }] },
    ] },
    { id: 'look', label: 'Look', controls: [
      K.themeControl('night'),
      lightControl('studio'),
      floorControl('grid'),
      finishControl('gloss'),
      K.paletteControl('toybox'),
      { key: 'threads', type: 'choice', label: 'Threads', value: 'accent', options: [{ id: 'accent', label: 'Accent' }, { id: 'wall', label: 'Pale' }, { id: 'red', label: 'Red (upstream)' }], random: { weights: { accent: 3, wall: 2, red: 1 } } },
    ] },
    { id: 'solver', label: 'Solver', open: false, random: false, controls: [
      { key: 'dt', type: 'choice', label: 'Time step', value: '0.02', options: [{ id: '0.01', label: '0.01 s' }, { id: '0.02', label: '0.02 s' }, { id: '0.05', label: '0.05 s' }], rebuild: true },
      { key: 'substeps', type: 'range', label: 'Substeps', min: 2, max: 30, step: 1, value: PHONE ? 8 : 10, phone: 8, rebuild: true },
      { type: 'note', text: 'Upstream (Ten Minute Physics #22): XPBD rigid bodies with distance constraints, 10 substeps per step. The bodies do not collide with each other.' },
    ] },
  ] };
}
export const REBUILD = new Set(['scene', 'levels', 'length', 'height', 'links', 'growth', 'labels', 'count', 'angle', 'spin', 'density', 'compliance', 'damping', 'dt', 'substeps']);

export function guard(next) {
  const s = Object.assign({}, next);
  // a big net or many pendulums cost constraints: keep the count sane
  if (s.scene === 'net') s.count = Math.min(s.count, 12);
  if (s.scene === 'bridge') s.count = Math.max(5, s.count);
  if (s.scene === 'wrecking') s.count = Math.max(4, Math.min(s.count, 12));
  // the mass chain with big growth and no damping swings for ever
  if (s.scene === 'chain' && s.growth > 2.2 && s.damping < 1) s.damping = 2;
  // the top thread carries growth^(links-1) times the last box: cap it at 32
  if (s.scene === 'chain') while (s.links > 2 && Math.pow(s.growth, s.links - 1) > 32) s.links--;
  // and it must hang clear of the floor: the boxes grow, so the length
  // grows faster than the link count
  const chainLow = n => { let y = TOP, size = 0.1, last = 0.1; for (let k = 0; k < n; k++) { y -= 0.2 + size; last = size; size *= Math.cbrt(s.growth); } return y - last / 2; };
  if (s.scene === 'chain') while (s.links > 2 && chainLow(s.links) < 0.75) s.links--;
  // labels only where the upstream scene has them
  if (s.scene !== 'chain') s.labels = false;
  // the mobile hangs from a unilateral thread: a strong wind tangles it
  if (s.scene === 'mobile' || s.scene === 'chandelier') { s.windX = Math.round(s.windX * 4) / 10; s.windZ = Math.round(s.windZ * 4) / 10; }
  // the chain stretch: thread i carries the boxes below it, sum of growth^j
  // (times 1 kg at density 1000); keep the summed stretch g alpha S under
  // 0.6 m so the last box stays well above the floor
  if (s.scene === 'chain') {
    let S = 0; for (let i = 0; i < s.links; i++) for (let j = i; j < s.links; j++) S += Math.pow(s.growth, j);
    const amax = 0.6 / (s.g * S);
    if (s.compliance > amax) s.compliance = Math.max(0.0001, Math.floor(amax * 1e4) / 1e4);
  }
  return s;
}
export const sceneRng = seed => K.rng((seed ^ 0x1b873593) >>> 0);
export function sceneConfig(st) {
  return { scene: st.scene, levels: st.levels, length: st.length, height: st.height, links: st.links, growth: st.growth, labels: st.labels, count: st.count,
    angle: st.angle, spin: st.spin, density: st.density, compliance: st.compliance, damping: st.damping, g: st.g, dt: parseFloat(st.dt), substeps: st.substeps };
}
