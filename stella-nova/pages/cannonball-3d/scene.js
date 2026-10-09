// ============================================================================
//  CANNONBALL 3D  ·  pages/cannonball-3d/scene.js — schema and scene rules
// ----------------------------------------------------------------------------
//  No DOM, so app.js and tests.mjs use the same rules (cannonball-vr too):
//    makeSchema(phone)     every control and its random rule (sim kit)
//    REBUILD               keys that need a new scene
//    guard(next)           clamps a random draw so the scene stays readable
//    sceneConfig(st)       the sim.buildScene config of a state
//    applyParams(S, st)    live parameters onto the sim
//  Our code (davesgames.io); the upstream credit is in sim.js.
//
//  grep -n targets: "export function makeSchema", "export function guard",
//  "export function sceneConfig", "export function applyParams"
// ============================================================================
import * as K from '../../widgets/sim-kit/core.js';
import { lightControl, floorControl, finishControl } from '../../widgets/sim-kit/stage3d.js';

export function makeSchema(PHONE) {
  return { groups: [
    { id: 'scene', label: 'Scene', controls: [
      { key: 'start', type: 'choice', label: 'Start', value: 'drop', seg: false, rebuild: true, options: [
        { id: 'upstream', label: 'One ball (upstream)' }, { id: 'drop', label: 'Drop' }, { id: 'fountain', label: 'Fountain' }, { id: 'cannon', label: 'Cannon' },
        { id: 'burst', label: 'Burst' }, { id: 'billiard', label: 'Rolling' }, { id: 'rain', label: 'Rain' }],
        random: { weights: { upstream: 1, drop: 3, fountain: 3, cannon: 3, burst: 3, billiard: 2, rain: 2 } } },
      { key: 'count', type: 'range', label: 'Balls', min: 1, max: PHONE ? 80 : 160, step: 1, value: 24, phone: 16, rebuild: true, random: { min: 6, max: PHONE ? 60 : 120 } },
      { key: 'rMin', type: 'range', label: 'Smallest radius', min: 0.04, max: 0.3, step: 0.01, value: 0.08, unit: 'm', rebuild: true, random: { min: 0.05, max: 0.16 } },
      { key: 'rMax', type: 'range', label: 'Largest radius', min: 0.05, max: 0.45, step: 0.01, value: 0.2, unit: 'm', rebuild: true, random: { min: 0.1, max: 0.35 } },
      { key: 'density', type: 'range', label: 'Density', min: 0.2, max: 5, step: 0.1, value: 1, rebuild: true, random: { dist: 'log', min: 0.4, max: 4 } },
      { key: 'speed', type: 'range', label: 'Launch speed', min: 0, max: 12, step: 0.1, value: 5, unit: 'm/s', rebuild: true, random: { min: 2, max: 10 } },
      { key: 'hx', type: 'range', label: 'Box width', min: 0.8, max: 3, step: 0.05, value: 1.5, unit: 'm', rebuild: true, random: { min: 1, max: 2.6 } },
      { key: 'hz', type: 'range', label: 'Box depth', min: 1, max: 4, step: 0.05, value: 2.5, unit: 'm', rebuild: true, random: { min: 1.4, max: 3.4 } },
      { key: 'bumpers', type: 'range', label: 'Bumpers', min: 0, max: 8, step: 1, value: 0, rebuild: true, random: { dist: 'int', min: 0, max: 5 } },
      { key: 'crates', type: 'range', label: 'Crates', min: 0, max: 8, step: 1, value: 0, rebuild: true, random: { dist: 'int', min: 0, max: 5 } },
    ] },
    { id: 'cannon', label: 'Cannon', hint: 'Drag a ball to throw it.', controls: [
      { key: 'cannon', type: 'toggle', label: 'Cannon fires', value: false, random: { p: 0.35 } },
      { key: 'cannonRate', type: 'range', label: 'Shots per second', min: 0.2, max: 8, step: 0.1, value: 1.5, random: { min: 0.5, max: 5 } },
      { key: 'cannonSpeed', type: 'range', label: 'Muzzle speed', min: 2, max: 14, step: 0.1, value: 7, unit: 'm/s', random: { min: 4, max: 11 } },
      { type: 'buttons', key: 'act', label: 'Do', action: 'act', items: [{ id: 'fire', label: 'Fire' }, { id: 'kick', label: 'Kick all' }, { id: 'add', label: 'Add ball' }, { id: 'clear', label: 'Clear' }] },
    ] },
    { id: 'physics', label: 'Physics', controls: [
      { key: 'g', type: 'range', label: 'Gravity', min: 0, max: 25, step: 0.1, value: 10, unit: 'm/s²', random: { dist: 'normal', mean: 10, sd: 4, min: 1.6, max: 22 } },
      { key: 'tiltX', type: 'range', label: 'Tilt forward', min: -30, max: 30, step: 1, value: 0, unit: '°', random: { dist: 'normal', mean: 0, sd: 2.5, min: -10, max: 10 } },
      { key: 'tiltZ', type: 'range', label: 'Tilt sideways', min: -30, max: 30, step: 1, value: 0, unit: '°', random: { dist: 'normal', mean: 0, sd: 2.5, min: -10, max: 10 } },
      { key: 'e', type: 'range', label: 'Bounce (restitution)', min: 0, max: 1, step: 0.01, value: 0.85, random: { min: 0.55, max: 0.98 } },
      { key: 'eWall', type: 'range', label: 'Wall bounce', min: 0, max: 1, step: 0.01, value: 0.9, random: { min: 0.6, max: 1 } },
      { key: 'friction', type: 'range', label: 'Floor friction', min: 0, max: 1, step: 0.01, value: 0.12, random: { min: 0, max: 0.4 } },
      { key: 'drag', type: 'range', label: 'Air drag', min: 0, max: 1, step: 0.01, value: 0.02, random: { min: 0, max: 0.2 } },
      { key: 'windX', type: 'range', label: 'Wind x', min: -6, max: 6, step: 0.1, value: 0, unit: 'm/s', random: { dist: 'normal', mean: 0, sd: 0.8, min: -3, max: 3 } },
      { key: 'windZ', type: 'range', label: 'Wind z', min: -6, max: 6, step: 0.1, value: 0, unit: 'm/s', random: { dist: 'normal', mean: 0, sd: 0.8, min: -3, max: 3 } },
      { key: 'collide', type: 'toggle', label: 'Balls collide', value: true, random: { p: 0.85 } },
    ] },
    { id: 'look', label: 'Look', controls: [
      K.themeControl('night'),
      lightControl('studio'),
      floorControl('grid'),
      finishControl('gloss'),
      K.paletteControl('toybox'),
      { key: 'trails', type: 'toggle', label: 'Trails', value: true, random: { p: 0.6 } },
      { key: 'walls', type: 'toggle', label: 'Box edges', value: true, random: { p: 0.8 } },
      { key: 'flash', type: 'toggle', label: 'Flash on bounce', value: true, random: { p: 0.6 } },
    ] },
    { id: 'solver', label: 'Solver', open: false, random: false, controls: [
      { key: 'substeps', type: 'range', label: 'Substeps', min: 1, max: 12, step: 1, value: PHONE ? 3 : 4, phone: 3 },
      { type: 'note', text: 'Upstream step (Ten Minute Physics #02): v ← v + g Δt, x ← x + v Δt, with a velocity flip at each wall. Ball-ball impulses, friction, drag and the cannon are our additions.' },
    ] },
  ] };
}
export const REBUILD = new Set(['start', 'count', 'rMin', 'rMax', 'density', 'speed', 'hx', 'hz', 'bumpers', 'crates']);

export function guard(next) {
  const s = Object.assign({}, next);
  if (s.rMin > s.rMax) { const t = s.rMin; s.rMin = s.rMax; s.rMax = t; }
  // big balls in a small box jam: cap the packed volume at a third
  const vol = 4 * s.hx * s.hz * 2.5, rm = (s.rMin + s.rMax) / 2, ball = 8 * rm * rm * rm;
  if (s.count * ball > vol / 3) s.count = Math.max(1, Math.floor(vol / 3 / ball));
  if (s.start === 'cannon') s.cannon = true;
  if (s.start === 'upstream') { s.count = 1; s.cannon = false; s.e = 1; s.eWall = 1; s.friction = 0; s.drag = 0; s.tiltX = 0; s.tiltZ = 0; s.windX = 0; s.windZ = 0; s.g = 10; }
  // strong wind with a big tilt throws everything into a corner
  if (Math.abs(s.tiltX) + Math.abs(s.tiltZ) > 25) { s.windX *= 0.3; s.windZ *= 0.3; }
  if (s.g < 3 && s.drag > 0.1) s.drag = 0.05;
  return s;
}
export const sceneRng = seed => K.rng((seed ^ 0x2c1b3c6d) >>> 0);
export function sceneConfig(st) {
  return { start: st.start, count: st.count, rMin: st.rMin, rMax: st.rMax, density: st.density, speed: st.speed, bumpers: st.bumpers, crates: st.crates };
}
export function applyParams(S, st) {
  const P = S.P;
  for (const k of ['g', 'tiltX', 'tiltZ', 'windX', 'windZ', 'e', 'eWall', 'friction', 'drag', 'collide', 'substeps', 'cannon', 'cannonRate', 'cannonSpeed', 'hx', 'hz']) P[k] = st[k];
}
