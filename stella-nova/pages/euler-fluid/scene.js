// ============================================================================
//  EULER FLUID  ·  pages/euler-fluid/scene.js — schema and scene rules
// ----------------------------------------------------------------------------
//  No DOM, so main.js and tests.mjs use the same rules:
//    makeSchema(phone)       every control and its random rule (sim kit)
//    REBUILD                 keys that need a new scene
//    guard(next)             clamps a random draw so the scene stays stable
//    sceneConfig(st, r)      the solver.buildScene config of a state
//    applyParams(S, st)      live parameters onto the sim
//  Our code (davesgames.io); the upstream credit is in solver.js.
//
//  grep -n targets: "export function makeSchema", "export function guard",
//  "export function sceneConfig", "export function applyParams"
// ============================================================================
import * as K from '../../widgets/sim-kit/core.js';
import { SHAPES } from './solver.js';

export const SHAPE_SETS = { mixed: SHAPES, circles: ['circle'], squares: ['square'], foils: ['ellipse'], plates: ['plate'] };
export const MOTIONS = ['static', 'orbit', 'bob', 'sweep', 'spin'];

export function makeSchema(PHONE) {
  return { groups: [
    { id: 'scene', label: 'Scene', controls: [
      { key: 'kind', type: 'choice', label: 'Scene', value: 'tunnel', seg: false, rebuild: true, options: [
        { id: 'tunnel', label: 'Wind tunnel' }, { id: 'hires', label: 'Hires tunnel' }, { id: 'tank', label: 'Tank' }, { id: 'paint', label: 'Paint' },
        { id: 'cavity', label: 'Lid-driven cavity' }, { id: 'jets', label: 'Jets' }],
        random: { weights: { tunnel: 5, hires: 1, tank: 1, paint: 2, cavity: 2, jets: 2 } } },
      { key: 'res', type: 'range', label: 'Cells high', min: 40, max: PHONE ? 120 : 200, step: 10, value: PHONE ? 80 : 100, phone: 80, rebuild: true, random: { min: 60, max: PHONE ? 110 : 140 } },
      { key: 'aspect', type: 'range', label: 'Width', min: 1.2, max: 2.4, step: 0.05, value: 1.8, unit: '× height', rebuild: true },
      { key: 'inVel', type: 'range', label: 'Inflow speed', min: 0.5, max: 4, step: 0.1, value: 2, unit: 'm/s', random: { min: 1, max: 3.4 } },
      { key: 'streaks', type: 'range', label: 'Smoke streaks', min: 1, max: 9, step: 1, value: 1, rebuild: true, random: { dist: 'int', min: 1, max: 7 } },
      { key: 'streakW', type: 'range', label: 'Streak width', min: 0.02, max: 0.3, step: 0.01, value: 0.1, rebuild: true },
      { key: 'lid', type: 'range', label: 'Lid speed (cavity)', min: 0.3, max: 4, step: 0.1, value: 1.5, unit: 'm/s' },
      { key: 'jet', type: 'range', label: 'Jet speed', min: 0.5, max: 5, step: 0.1, value: 2.5, unit: 'm/s' },
      { key: 'visc', type: 'range', label: 'Viscosity', min: 0, max: 0.003, step: 0.0001, value: 0.0005, unit: 'm²/s', digits: 4, random: { min: 0, max: 0.0018 } },
      { key: 'g', type: 'range', label: 'Gravity (tank)', min: 0, max: 20, step: 0.1, value: 9.81, unit: 'm/s²' },
    ] },
    { id: 'objects', label: 'Obstacles', hint: 'Drag an obstacle to move it. Drag in open fluid to stir with a finger.', controls: [
      { key: 'nObs', type: 'range', label: 'Obstacles', min: 0, max: 6, step: 1, value: 1, rebuild: true, random: { dist: 'int', min: 1, max: 5 } },
      { key: 'shapes', type: 'choice', label: 'Shapes', value: 'circles', seg: false, rebuild: true, options: Object.keys(SHAPE_SETS).map(id => ({ id, label: id[0].toUpperCase() + id.slice(1) })),
        random: { weights: { mixed: 4, circles: 2, squares: 1, foils: 2, plates: 1 } } },
      { key: 'size', type: 'range', label: 'Size', min: 0.04, max: 0.2, step: 0.005, value: 0.15, rebuild: true, random: { min: 0.05, max: 0.16 } },
      { key: 'motion', type: 'choice', label: 'Motion', value: 'static', seg: false, rebuild: true, options: ['mixed'].concat(MOTIONS).map(id => ({ id, label: id[0].toUpperCase() + id.slice(1) })),
        random: { weights: { mixed: 3, static: 3, orbit: 2, bob: 2, sweep: 1, spin: 2 } } },
      { key: 'speed', type: 'range', label: 'Motion speed', min: 0.05, max: 0.6, step: 0.01, value: 0.2, unit: 'Hz', rebuild: true },
      { key: 'finger', type: 'range', label: 'Finger size', min: 0.03, max: 0.2, step: 0.005, value: 0.1 },
      { type: 'buttons', key: 'add', label: 'Add', action: 'add', items: SHAPES.map(s => ({ id: s, label: s[0].toUpperCase() + s.slice(1) })) },
      { type: 'button', key: 'clear', label: 'Remove all obstacles', action: 'clear' },
    ] },
    { id: 'look', label: 'Look', controls: [
      { key: 'colorBy', type: 'choice', label: 'Show', value: 'smoke', seg: false, options: [
        { id: 'smoke', label: 'Smoke' }, { id: 'pressure', label: 'Pressure' }, { id: 'pressmoke', label: 'Pressure + smoke' }, { id: 'speed', label: 'Speed' }, { id: 'vorticity', label: 'Vorticity' }],
        random: { weights: { smoke: 4, pressure: 2, pressmoke: 1, speed: 2, vorticity: 3 } } },
      { key: 'cmap', type: 'cmap', label: 'Colour map', value: 'ice', random: { pick: K.CMAP_DRAW } },
      { key: 'reverse', type: 'toggle', label: 'Reverse map', value: false, random: { p: 0.15 } },
      { key: 'stream', type: 'toggle', label: 'Streamlines', value: false, random: { p: 0.3 } },
      { key: 'vel', type: 'toggle', label: 'Velocities', value: false, random: { p: 0.1 } },
      { key: 'smooth', type: 'toggle', label: 'Smooth cells', value: true, random: false },
      K.themeControl('night'),
      K.paletteControl('toybox'),
    ] },
    { id: 'solver', label: 'Solver', open: false, random: false, controls: [
      { key: 'iters', type: 'range', label: 'Pressure iterations', min: 5, max: 100, step: 1, value: 40 },
      { key: 'over', type: 'toggle', label: 'Overrelaxation (1.9)', value: true },
      { key: 'dt', type: 'choice', label: 'Time step', value: '60', options: [{ id: '60', label: '1/60 s' }, { id: '120', label: '1/120 s' }] },
      { type: 'note', text: 'Staggered grid, Gauss-Seidel pressure projection with overrelaxation, semi-Lagrangian advection (Müller, Ten Minute Physics 17).' },
    ] },
  ] };
}
export const REBUILD = new Set(['kind', 'res', 'aspect', 'streaks', 'streakW', 'nObs', 'shapes', 'size', 'motion', 'speed']);

// Stable, readable random scenes. Semi-Lagrangian advection is stable for
// any step, but streaks smear above a few cells per step: the inflow, lid
// and jet move at most CFL_MAX cells per step (upstream defaults: 3.3).
export const CFL_MAX = 3.5;
export function guard(next) {
  const s = Object.assign({}, next);
  if (s.kind === 'hires') s.res = Math.max(s.res, 140);
  const dt = s.dt === '120' ? 1 / 120 : 1 / 60, h = 1 / s.res;
  const vmax = CFL_MAX * h / dt;
  if (s.inVel > vmax) s.inVel = Math.floor(vmax * 10) / 10;
  if (s.lid > vmax) s.lid = Math.floor(vmax * 10) / 10;
  if (s.jet > vmax) s.jet = Math.floor(vmax * 10) / 10;
  // the tank shows hydrostatic pressure: show pressure, keep gravity
  if (s.kind === 'tank') { if (s.colorBy === 'smoke') s.colorBy = 'pressure'; if (s.g < 3) s.g = 9.81; }
  if (s.kind === 'paint' && s.nObs > 3) s.nObs = 3;
  // a cavity is driven only through viscosity
  if (s.kind === 'cavity' && s.visc < 0.0006) s.visc = 0.0012;
  return s;
}

export const sceneRng = seed => K.rng((seed ^ 0x2545f491) >>> 0);
export function obstaclesFor(st, r, W) {
  const shapes = SHAPE_SETS[st.shapes] || SHAPES, out = [];
  const n = st.kind === 'tank' ? Math.min(st.nObs, 2) : st.nObs;
  for (let k = 0; k < n; k++) {
    const motion = st.motion === 'mixed' ? r.pick(['static', 'static', 'orbit', 'bob', 'spin', 'sweep']) : st.motion;
    let x, y;
    if (st.kind === 'tunnel' || st.kind === 'hires') {
      // the first one where upstream put it; the rest staggered downstream
      x = k === 0 ? 0.4 : 0.4 + (W - 0.8) * (k / Math.max(1, n)) + 0.1 * (r() - 0.5); y = 0.5 + (k === 0 ? 0 : 0.5 * (r() - 0.5));
    } else { x = 0.2 + (W - 0.4) * r(); y = 0.2 + 0.6 * r(); }
    out.push({ shape: r.pick(shapes), x, y, r: st.size * (0.75 + 0.5 * r()), a: (r() - 0.5) * 1.2, motion, amp: 0.06 + 0.14 * r(), freq: st.speed * (0.7 + 0.6 * r()), ph: r() * 6.283, hue: r() });
  }
  return out;
}
export function sceneConfig(st, r) {
  const res = st.kind === 'hires' ? Math.max(140, st.res) : st.kind === 'tank' ? Math.min(st.res, 60) : st.res;
  return { kind: st.kind, res, aspect: st.aspect, streaks: st.streaks, streakW: st.streakW, obstacles: obstaclesFor(st, r, st.aspect) };
}
export function applyParams(S, st) {
  const P = S.P;
  P.inVel = st.inVel; P.lid = st.lid; P.jet = st.jet; P.g = st.g; P.visc = st.visc;
  P.iters = st.iters; P.over = st.over ? 1.9 : 1.0; P.dt = st.dt === '120' ? 1 / 120 : 1 / 60;
}
