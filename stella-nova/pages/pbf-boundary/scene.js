// ============================================================================
//  PBF BOUNDARIES  ·  pages/pbf-boundary/scene.js — schema and scene rules
// ----------------------------------------------------------------------------
//  No DOM, so main.js and tests.mjs use the same rules:
//    makeSchema(phone)       every control and its random rule (sim kit)
//    REBUILD                 keys that need a new scene
//    guard(next)             clamps a random draw so the scene stays stable
//    sceneConfig(st, seed)   the solver.buildScene config of a state
//    applyParams(S, st)      live parameters onto the solver
//  Our code (davesgames.io); the upstream credit is in main.js and solver.js.
//
//  grep -n targets: "export function makeSchema", "export function guard",
//  "export function sceneConfig", "export function applyParams"
// ============================================================================
import * as SV from './solver.js';
import { WATER } from './render.js';
import * as K from '../../widgets/sim-kit/core.js';

export const BODY_SETS = {
  mixed: ['box', 'disc', 'boat', 'duck', 'log', 'plank', 'rock', 'ball'],
  floaters: ['box', 'disc', 'boat', 'duck', 'log', 'plank'],
  sinkers: ['rock', 'ball'],
  boats: ['boat'],
  ducks: ['duck'],
  logs: ['log', 'plank'],
};

export function makeSchema(PHONE) {
  const CAP = PHONE ? 1600 : 3200;
  return {
  groups: [
    { id: 'scene', label: 'Scene', controls: [
      { key: 'container', type: 'choice', label: 'Container', value: 'tank', seg: false, options: [
        { id: 'tank', label: 'Tank' }, { id: 'drum', label: 'Drum' }, { id: 'bowl', label: 'Bowl' }, { id: 'beach', label: 'Beach' },
        { id: 'twin', label: 'Twin basins' }, { id: 'funnel', label: 'Funnel' }, { id: 'mixer', label: 'Mixer (upstream)' }, { id: 'steps', label: 'Steps' }], rebuild: true },
      { key: 'fill', type: 'choice', label: 'Start', value: 'dam', seg: false, options: [
        { id: 'pool', label: 'Still pool' }, { id: 'dam', label: 'Dam break' }, { id: 'drop', label: 'Drop into pool' }, { id: 'twin', label: 'Two columns' },
        { id: 'rain', label: 'Scattered' }, { id: 'empty', label: 'Empty + pour' }], rebuild: true },
      { key: 'count', type: 'range', label: 'Particles', min: 300, max: CAP, step: 50, value: PHONE ? 1100 : 2000, phone: 1100, rebuild: true, random: { min: 600, max: CAP } },
      { key: 'obstacles', type: 'range', label: 'Obstacles', min: 0, max: 5, step: 1, value: 1, rebuild: true, random: { dist: 'int', min: 0, max: 4 } },
      { key: 'emitters', type: 'range', label: 'Emitters', min: 0, max: 3, step: 1, value: 0, rebuild: true, random: { dist: 'int', min: 0, max: 2 } },
      { key: 'paddle', type: 'toggle', label: 'Wave paddle', value: false, rebuild: true, random: { p: 0.25 } },
    ] },
    { id: 'objects', label: 'Objects', hint: 'Drag a body to throw it. Tap empty water to stir.', controls: [
      { key: 'nBodies', type: 'range', label: 'Bodies', min: 0, max: 8, step: 1, value: 3, rebuild: true, random: { dist: 'int', min: 0, max: 7 } },
      { key: 'bodySet', type: 'choice', label: 'Kinds', value: 'mixed', seg: false, options: Object.keys(BODY_SETS).map(id => ({ id, label: id[0].toUpperCase() + id.slice(1) })), rebuild: true, random: { weights: { mixed: 4, floaters: 2, sinkers: 1, boats: 1, ducks: 1, logs: 1 } } },
      { key: 'bodySize', type: 'range', label: 'Size', min: 0.6, max: 1.6, step: 0.05, value: 1, rebuild: true },
      { key: 'coupling', type: 'range', label: 'Two-way coupling', min: 0, max: 1.5, step: 0.05, value: 1, random: { min: 0.6, max: 1.3 } },
      { type: 'buttons', key: 'drop', label: 'Drop', action: 'drop', items: SV.BODY_KINDS.map(k => ({ id: k, label: k[0].toUpperCase() + k.slice(1) })) },
      { type: 'button', key: 'clear', label: 'Remove all bodies', action: 'clear' },
    ] },
    { id: 'material', label: 'Material', controls: [
      { key: 'material', type: 'choice', label: 'Model', value: 'water', options: [{ id: 'water', label: 'Water (PBF)' }, { id: 'granular', label: 'Grains (upstream)' }], random: { weights: { water: 4, granular: 1 } } },
      { key: 'visc', type: 'range', label: 'Viscosity (XSPH)', min: 0, max: 0.3, step: 0.005, value: 0.06, random: { min: 0.01, max: 0.2 } },
      { key: 'vort', type: 'range', label: 'Vorticity', min: 0, max: 1.5, step: 0.05, value: 0.4 },
      { key: 'tension', type: 'range', label: 'Surface tension', min: 0, max: 0.4, step: 0.01, value: 0.12 },
      { key: 'mu_s', type: 'range', label: 'Static friction μs', min: 0, max: 1, step: 0.01, value: 0.4 },
      { key: 'mu_k', type: 'range', label: 'Kinetic friction μk', min: 0, max: 1, step: 0.01, value: 0.3 },
      { key: 'e', type: 'range', label: 'Restitution', min: 0, max: 1, step: 0.01, value: 0.2 },
      { key: 'velPass', type: 'toggle', label: 'Velocity pass', value: true, random: { p: 0.8 } },
    ] },
    { id: 'forces', label: 'Forces', controls: [
      { key: 'g', type: 'range', label: 'Gravity', min: 2, max: 20, step: 0.1, value: 9.81, unit: 'm/s²', random: { dist: 'normal', mean: 9.81, sd: 3, min: 4, max: 18 } },
      { key: 'tilt', type: 'range', label: 'Tilt', min: -40, max: 40, step: 1, value: 0, unit: '°', random: { dist: 'normal', mean: 0, sd: 10, min: -30, max: 30 } },
      { key: 'spin', type: 'range', label: 'Turn gravity', min: -60, max: 60, step: 1, value: 0, unit: '°/s', random: { dist: 'normal', mean: 0, sd: 10, min: -40, max: 40 } },
      { key: 'shakeA', type: 'range', label: 'Shake amplitude', min: 0, max: 0.08, step: 0.002, value: 0, unit: 'm', random: { dist: 'normal', mean: 0, sd: 0.015, min: 0, max: 0.06 } },
      { key: 'shakeF', type: 'range', label: 'Shake frequency', min: 0.3, max: 3, step: 0.05, value: 1.2, unit: 'Hz' },
      { key: 'mixer', type: 'range', label: 'Mixer disks', min: -240, max: 240, step: 5, value: 120, unit: '°/s' },
    ] },
    { id: 'look', label: 'Look', controls: [
      { key: 'render', type: 'choice', label: 'Draw', value: 'smooth', options: [{ id: 'smooth', label: 'Surface' }, { id: 'particles', label: 'Particles' }, { id: 'both', label: 'Both' }], random: { weights: { smooth: 4, particles: 1, both: 1 } } },
      { key: 'colorBy', type: 'choice', label: 'Colour by', value: 'water', seg: false, options: [
        { id: 'water', label: 'Water colour' }, { id: 'speed', label: 'Speed' }, { id: 'density', label: 'Density' }, { id: 'pressure', label: 'Pressure' }, { id: 'vorticity', label: 'Vorticity' }, { id: 'depth', label: 'Height' }], random: { weights: { water: 3, speed: 2, density: 1, pressure: 1, vorticity: 2, depth: 1 } } },
      { key: 'water', type: 'swatch', label: 'Water', value: 'ocean', options: WATER.map(w => ({ id: w.id, label: w.label, colors: w.colors })) },
      { key: 'cmap', type: 'cmap', label: 'Colour map', value: 'ocean' },
      { key: 'foam', type: 'toggle', label: 'Foam and spray', value: true, random: { p: 0.8 } },
      { key: 'grid', type: 'toggle', label: 'Grid', value: false, random: { p: 0.3 } },
      K.themeControl('abyss'),
      K.paletteControl('toybox'),
    ] },
    { id: 'solver', label: 'Solver', open: false, random: false, controls: [
      { key: 'substeps', type: 'range', label: 'Substeps', min: 1, max: 6, step: 1, value: PHONE ? 2 : 3, phone: 2 },
      { key: 'iters', type: 'range', label: 'Iterations', min: 1, max: 6, step: 1, value: 3 },
      { key: 'bspace', type: 'range', label: 'Boundary spacing', min: 0.6, max: 1, step: 0.05, value: 0.8, unit: '× d' },
      { type: 'note', text: 'Position based fluids (Macklin and Müller 2013) with boundary particles (Akinci et al. 2012). Grains use the upstream friction model.' },
    ] },
  ],
};
}
export const REBUILD = new Set(['container', 'fill', 'count', 'obstacles', 'emitters', 'paddle', 'nBodies', 'bodySet', 'bodySize']);

// Keep random scenes stable and readable: a vetoed or clamped draw.
export function guard(next) {
  const s = Object.assign({}, next);
  // shaking and turning gravity together throw the water out of open tanks
  if (s.shakeA > 0.03 && Math.abs(s.spin) > 15) s.spin = 0;
  if (s.container !== 'drum' && s.container !== 'mixer' && Math.abs(s.spin) > 10) s.spin = Math.sign(s.spin) * 10;
  // strong gravity needs a substep more
  if (s.g > 14) s.substeps = Math.max(s.substeps, 3);
  // grains: no emitters (they jam the nozzle), mild tilt
  if (s.material === 'granular') { s.emitters = 0; s.tilt = Math.max(-15, Math.min(15, s.tilt)); if (s.fill === 'empty') s.fill = 'pool'; }
  // an empty start needs a pour
  if (s.fill === 'empty' && !s.emitters) s.emitters = 1;
  return s;
}


export function bodiesFor(st, r) {
  const kinds = BODY_SETS[st.bodySet] || BODY_SETS.mixed, out = [];
  for (let i = 0; i < st.nBodies; i++) out.push({ kind: r.pick(kinds), size: st.bodySize * (0.8 + 0.4 * r()) });
  return out;
}
// The scene rng of a seed (bodies, obstacles, emitters, container details).
export const sceneRng = seed => K.rng((seed ^ 0x5bd1e995) >>> 0);
export function sceneConfig(st, r) {
  return { container: st.container, fill: st.fill, count: st.count, obstacles: st.obstacles, emitters: st.emitters, paddle: st.paddle, bodies: bodiesFor(st, r) };
}
export function applyParams(S, st) {
  const P = S.P, a = st.tilt * Math.PI / 180;
  P.gx = st.g * Math.sin(a); P.gy = -st.g * Math.cos(a);
  P.spin = st.spin * Math.PI / 180;
  P.material = st.material; P.visc = st.visc; P.vort = st.vort; P.tension = st.tension;
  P.mu_s = st.mu_s; P.mu_k = st.mu_k; P.e = st.e; P.velPass = st.velPass;
  P.shakeA = st.shakeA; P.shakeF = st.shakeF; P.coupling = st.coupling;
  P.substeps = st.substeps; P.iters = st.iters;
  const om = st.mixer * Math.PI / 180;
  for (const ob of S.obstacles) if (ob.kind === 'disk') ob.orbit = om;
  P.mixer = st.mixer;
  if (P.bspace !== st.bspace) { P.bspace = st.bspace; if (S.container) SV.resample(S); }
}
