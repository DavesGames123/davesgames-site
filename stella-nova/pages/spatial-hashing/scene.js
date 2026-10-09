// ============================================================================
//  SPATIAL HASHING  ·  pages/spatial-hashing/scene.js — schema and rules
// ----------------------------------------------------------------------------
//  No DOM, so app.js and tests.mjs use the same rules:
//    makeSchema(phone)     every control and its random rule (sim kit)
//    REBUILD               keys that need a new scene
//    guard(next)           clamps a random draw (ball budget, stable box)
//    sceneConfig(st)       the sim.buildScene config of a state
//    applyParams(S, st)    live parameters onto the sim
//  Our code (davesgames.io); the upstream credit is in sim.js.
//
//  grep -n targets: "export function makeSchema", "export function guard"
// ============================================================================
import * as K from '../../widgets/sim-kit/core.js';
import { lightControl, floorControl, finishControl } from '../../widgets/sim-kit/stage3d.js';

export const COLOR_BY = [
  { id: 'collisions', label: 'Collisions (upstream)' }, { id: 'speed', label: 'Speed' }, { id: 'bucket', label: 'Hash bucket' },
  { id: 'origin', label: 'Start side' }, { id: 'height', label: 'Height' }, { id: 'palette', label: 'Palette' },
];

export function makeSchema(PHONE) {
  const MAX = PHONE ? 4000 : 16000;
  return { groups: [
    { id: 'scene', label: 'Scene', controls: [
      { key: 'start', type: 'choice', label: 'Start', value: 'gas', seg: false, rebuild: true, options: [
        { id: 'gas', label: 'Gas (upstream)' }, { id: 'burst', label: 'Burst' }, { id: 'twin', label: 'Two clouds collide' }, { id: 'rain', label: 'Rain' },
        { id: 'slosh', label: 'Slosh' }, { id: 'vortex', label: 'Vortex' }, { id: 'layers', label: 'Layers mix' }],
        random: { weights: { gas: 3, burst: 3, twin: 3, rain: 2, slosh: 2, vortex: 2, layers: 2 } } },
      { key: 'count', type: 'range', label: 'Balls (target)', min: 200, max: MAX, step: 100, value: PHONE ? 2500 : 9000, phone: 2500, rebuild: true, random: { min: PHONE ? 1200 : 3000, max: MAX } },
      { key: 'radius', type: 'range', label: 'Ball radius', min: 0.012, max: 0.06, step: 0.001, value: 0.025, unit: 'm', rebuild: true, random: { min: 0.016, max: 0.045 } },
      { key: 'speed', type: 'range', label: 'Start speed', min: 0, max: 2, step: 0.01, value: 0.2, unit: 'm/s', rebuild: true, random: { min: 0.1, max: 1.2 } },
      { key: 'w', type: 'range', label: 'Box width', min: 1, max: 3.5, step: 0.05, value: 2, unit: 'm', rebuild: true, random: { min: 1.4, max: 3 } },
      { key: 'h', type: 'range', label: 'Box height', min: 0.6, max: 3, step: 0.05, value: 2, unit: 'm', rebuild: true, random: { min: 1, max: 2.6 } },
      { key: 'd', type: 'range', label: 'Box depth', min: 1, max: 3.5, step: 0.05, value: 2, unit: 'm', rebuild: true, random: { min: 1.4, max: 3 } },
    ] },
    { id: 'physics', label: 'Physics', hint: 'Drag the glass sphere through the balls.', controls: [
      { key: 'g', type: 'range', label: 'Gravity', min: 0, max: 15, step: 0.1, value: 0, unit: 'm/s²', random: { min: 0, max: 10 } },
      { key: 'tiltX', type: 'range', label: 'Tilt forward', min: -40, max: 40, step: 1, value: 0, unit: '°', random: { dist: 'normal', mean: 0, sd: 8, min: -25, max: 25 } },
      { key: 'tiltZ', type: 'range', label: 'Tilt sideways', min: -40, max: 40, step: 1, value: 0, unit: '°', random: { dist: 'normal', mean: 0, sd: 8, min: -25, max: 25 } },
      { key: 'e', type: 'range', label: 'Ball restitution', min: 0, max: 1, step: 0.01, value: 1, random: { min: 0.6, max: 1 } },
      { key: 'eWall', type: 'range', label: 'Wall restitution', min: 0, max: 1, step: 0.01, value: 1, random: { min: 0.6, max: 1 } },
      { key: 'stir', type: 'toggle', label: 'Stirrer sphere', value: true, random: { p: 0.6 } },
      { key: 'stirAuto', type: 'toggle', label: 'Stirrer moves by itself', value: false, random: { p: 0.5 } },
      { key: 'stirR', type: 'range', label: 'Stirrer radius', min: 0.08, max: 0.5, step: 0.01, value: 0.18, unit: 'm', random: { min: 0.1, max: 0.35 } },
      { type: 'buttons', key: 'act', label: 'Do', action: 'act', items: [{ id: 'kick', label: 'Kick' }, { id: 'heat', label: 'Heat up' }, { id: 'cool', label: 'Cool down' }, { id: 'probe', label: 'New probe' }] },
    ] },
    { id: 'look', label: 'Look', controls: [
      { key: 'colorBy', type: 'choice', label: 'Colour by', value: 'speed', seg: false, options: COLOR_BY, random: { weights: { collisions: 2, speed: 3, bucket: 2, origin: 2, height: 1, palette: 1 } } },
      { key: 'cmap', type: 'cmap', label: 'Colour map', value: 'plasma' },
      { key: 'probeOn', type: 'toggle', label: 'Show one hash query', value: false, random: { p: 0.25 } },
      { key: 'cells', type: 'toggle', label: 'Show hash grid', value: false, random: { p: 0.3 } },
      K.themeControl('night'),
      lightControl('studio'),
      floorControl('grid'),
      finishControl('gloss'),
      K.paletteControl('neon'),
    ] },
    { id: 'solver', label: 'Solver', open: false, random: false, controls: [
      { key: 'substeps', type: 'range', label: 'Substeps', min: 1, max: 4, step: 1, value: 1 },
      { type: 'note', text: 'Upstream (Ten Minute Physics #11): a dense hash table of 2N cells of size 2r; each ball checks only the balls in the 27 cells around it.' },
    ] },
  ] };
}
export const REBUILD = new Set(['start', 'count', 'radius', 'speed', 'w', 'h', 'd']);

export function guard(next) {
  const s = Object.assign({}, next);
  // the ball budget: the box holds at most volume / (3r)^3 grid places
  const places = Math.floor(s.w / (3 * s.radius)) * Math.floor(s.h / (3 * s.radius)) * Math.floor(s.d / (3 * s.radius));
  if (s.count > places) s.count = Math.max(200, Math.floor(places / 100) * 100);
  // the gas and the twin clouds read best without gravity; rain and slosh need it
  if (s.start === 'gas' || s.start === 'twin' || s.start === 'burst' || s.start === 'vortex') { if (s.g > 2) s.g = 0; }
  if ((s.start === 'rain' || s.start === 'slosh') && s.g < 3) s.g = 9.8;
  if (s.start === 'slosh') { s.tiltX = Math.max(-12, Math.min(12, s.tiltX)); }
  else if (s.g === 0) { s.tiltX = 0; s.tiltZ = 0; }
  // with gravity, damp the bounce a little so the balls settle
  if (s.g > 0) { s.e = Math.min(s.e, 0.95); s.eWall = Math.min(s.eWall, 0.95); }
  return s;
}
export const sceneRng = seed => K.rng((seed ^ 0x7f4a7c15) >>> 0);
export function sceneConfig(st) { return { start: st.start, radius: st.radius, count: st.count, speed: st.speed, w: st.w, h: st.h, d: st.d }; }
export function applyParams(S, st) {
  const P = S.P;
  P.g = st.g; P.tiltX = st.tiltX; P.tiltZ = st.tiltZ; P.e = st.e; P.eWall = st.eWall;
  S.stirrer.on = st.stir; S.stirrer.auto = st.stirAuto; S.stirrer.r = st.stirR;
  S.substeps = st.substeps;
}
