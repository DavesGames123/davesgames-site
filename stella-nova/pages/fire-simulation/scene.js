// ============================================================================
//  FIRE SIMULATION  ·  pages/fire-simulation/scene.js — schema and scene rules
// ----------------------------------------------------------------------------
//  No DOM, so main.js and tests.mjs use the same rules:
//    makeSchema(phone), REBUILD, guard(next), sceneConfig(st, r),
//    applyParams(S, st), PALETTES (fire colour ramps)
//  Our code (davesgames.io); the upstream credit is in solver.js.
//  grep -n targets: "export function makeSchema", "export function guard",
//  "export function sceneConfig", "export function applyParams"
// ============================================================================
import * as K from '../../widgets/sim-kit/core.js';
import { BURNERS } from './solver.js';

// Fire ramps (t = 0 cold .. 1 hot). 'upstream' is getFireColor of 21-fire.html.
export const FIRE = [
  { id: 'upstream', label: 'Classic', colors: ['#000000', '#333333', '#ff1a1a', '#ff9900', '#ffff00'] },
  { id: 'campfire', label: 'Campfire', colors: ['#050302', '#3a2a22', '#c2300c', '#ff8a1c', '#fff2b0'] },
  { id: 'blue', label: 'Gas flame', colors: ['#010208', '#14203a', '#1f5bff', '#79c6ff', '#f2fbff'] },
  { id: 'green', label: 'Copper', colors: ['#020502', '#123220', '#13b26b', '#7dffb0', '#f4fff4'] },
  { id: 'violet', label: 'Potassium', colors: ['#050208', '#2a1838', '#9b37ff', '#e09bff', '#fff0ff'] },
  { id: 'white', label: 'Magnesium', colors: ['#020202', '#2b2b2b', '#c7c9d6', '#f2f4ff', '#ffffff'] },
  { id: 'ghost', label: 'Ghost', colors: ['#000306', '#062430', '#18a3b8', '#9ef3ff', '#ffffff'] },
];
// stops of each ramp at t = 0, 0.3, 0.5, 0.75, 1 (upstream breaks)
export const FIRE_STOPS = [0, 0.3, 0.5, 0.75, 1];

export function makeSchema(PHONE) {
  return { groups: [
    { id: 'scene', label: 'Scene', controls: [
      { key: 'preset', type: 'choice', label: 'Fire', value: 'ring', seg: false, rebuild: true, options: [
        { id: 'ring', label: 'Burning ring' }, { id: 'floor', label: 'Burning floor' }, { id: 'both', label: 'Ring over fire' },
        { id: 'campfire', label: 'Campfire logs' }, { id: 'torches', label: 'Torches' }, { id: 'mixed', label: 'Mixed burners' }],
        random: { weights: { ring: 3, floor: 2, both: 2, campfire: 2, torches: 2, mixed: 3 } } },
      { key: 'nBurn', type: 'range', label: 'Burners', min: 1, max: 6, step: 1, value: 1, rebuild: true, random: { dist: 'int', min: 1, max: 5 } },
      { key: 'size', type: 'range', label: 'Burner size', min: 0.05, max: 0.25, step: 0.005, value: 0.13, rebuild: true, random: { min: 0.07, max: 0.2 } },
      { key: 'motion', type: 'choice', label: 'Burner motion', value: 'static', seg: false, rebuild: true, options: ['mixed', 'static', 'orbit', 'sweep', 'bob'].map(id => ({ id, label: id[0].toUpperCase() + id.slice(1) })),
        random: { weights: { mixed: 3, static: 2, orbit: 2, sweep: 2, bob: 1 } } },
      { key: 'speed', type: 'range', label: 'Motion speed', min: 0.03, max: 0.4, step: 0.01, value: 0.12, unit: 'Hz', rebuild: true },
      { key: 'floor', type: 'toggle', label: 'Floor burns', value: false, random: false },
      { key: 'cells', type: 'range', label: 'Cells', min: 20000, max: PHONE ? 60000 : 140000, step: 5000, value: PHONE ? 40000 : 100000, phone: 40000, rebuild: true, random: { min: PHONE ? 30000 : 60000, max: PHONE ? 50000 : 110000 } },
      { key: 'aspect', type: 'range', label: 'Width', min: 0.6, max: 2.2, step: 0.05, value: 1.6, unit: '× height', rebuild: true, random: { min: 0.9, max: 2 } },
      { type: 'buttons', key: 'add', label: 'Add burner', action: 'add', items: BURNERS.map(b => ({ id: b, label: b[0].toUpperCase() + b.slice(1) })) },
      { type: 'button', key: 'clear', label: 'Put out the burners', action: 'clear' },
    ] },
    { id: 'flame', label: 'Flame', hint: 'Drag a burner to move it and fan the flame.', controls: [
      { key: 'lift', type: 'range', label: 'Buoyant lift', min: 0.5, max: 8, step: 0.1, value: 3, unit: 'm/s', random: { min: 1.5, max: 6 } },
      { key: 'fireCool', type: 'range', label: 'Fire cooling', min: 0.3, max: 3, step: 0.05, value: 1.2, unit: '1/s', random: { min: 0.6, max: 2.2 } },
      { key: 'smokeCool', type: 'range', label: 'Smoke cooling', min: 0.05, max: 1.5, step: 0.05, value: 0.3, unit: '1/s', random: { min: 0.2, max: 0.8 } },
      { key: 'accel', type: 'range', label: 'Acceleration', min: 1, max: 15, step: 0.5, value: 6, unit: '1/s' },
      { key: 'torch', type: 'range', label: 'Torch jet', min: 0.5, max: 6, step: 0.1, value: 2.5, unit: 'm/s' },
      { key: 'wind', type: 'range', label: 'Side wind', min: -1.5, max: 1.5, step: 0.05, value: 0, unit: 'm/s', random: { dist: 'normal', mean: 0, sd: 0.3, min: -1, max: 1 } },
    ] },
    { id: 'swirl', label: 'Swirls', controls: [
      { key: 'prob', type: 'range', label: 'Swirl probability', min: 0, max: 100, step: 1, value: 50, random: { min: 0, max: 100 } },
      { key: 'swirlR', type: 'range', label: 'Swirl radius', min: 0.02, max: 0.1, step: 0.005, value: 0.05, unit: 'm', random: { min: 0.03, max: 0.08 } },
      { key: 'swirlW', type: 'range', label: 'Swirl strength', min: 5, max: 40, step: 1, value: 20, unit: 'rad/s', random: { min: 10, max: 32 } },
      { key: 'swirlLife', type: 'range', label: 'Swirl life', min: 0.3, max: 3, step: 0.1, value: 1, unit: 's' },
      { key: 'showSwirls', type: 'toggle', label: 'Show swirls', value: false, random: { p: 0.15 } },
    ] },
    { id: 'look', label: 'Look', controls: [
      { key: 'fire', type: 'swatch', label: 'Flame colour', value: 'upstream', options: FIRE.map(f => ({ id: f.id, label: f.label, colors: f.colors })), random: { weights: { upstream: 3, campfire: 3, blue: 1, green: 1, violet: 1, white: 1, ghost: 1 } } },
      { key: 'colorBy', type: 'choice', label: 'Colour by', value: 'flame', options: [{ id: 'flame', label: 'Flame' }, { id: 'map', label: 'Colour map' }, { id: 'speed', label: 'Speed' }], random: { weights: { flame: 6, map: 2, speed: 1 } } },
      { key: 'cmap', type: 'cmap', label: 'Colour map', value: 'inferno', random: { pick: ['inferno', 'magma', 'hot-iron', 'ember', 'plasma', 'gold-leaf', 'copper', 'rocket', 'synthwave', 'ice', 'aurora', 'nebula', 'turbo'] } },
      { key: 'glow', type: 'range', label: 'Glow', min: 0, max: 1, step: 0.05, value: 0.6, random: { min: 0.3, max: 0.9 } },
      { key: 'showBurners', type: 'toggle', label: 'Show burners', value: true, random: { p: 0.85 } },
      K.themeControl('night', { random: { pick: ['night', 'abyss', 'ember', 'violet', 'forest', 'slate'] } }),
    ] },
    { id: 'solver', label: 'Solver', open: false, random: false, controls: [
      { key: 'iters', type: 'range', label: 'Pressure iterations', min: 4, max: 40, step: 1, value: 10 },
      { key: 'gravity', type: 'range', label: 'Gravity', min: -10, max: 0, step: 0.1, value: 0, unit: 'm/s²' },
      { type: 'note', text: 'Staggered grid fluid with buoyant temperature, cooling and random swirls (Müller, Ten Minute Physics 21).' },
    ] },
  ] };
}
export const REBUILD = new Set(['preset', 'nBurn', 'size', 'motion', 'speed', 'cells', 'aspect']);

export function guard(next) {
  const s = Object.assign({}, next);
  // the floor presets set the floor; others leave it off
  s.floor = s.preset === 'floor' || s.preset === 'both';
  // a burning floor fills the box unless the flame cools fast
  if (s.floor) { s.fireCool = Math.max(s.fireCool, 1.2); s.lift = Math.min(s.lift, 4); }
  // smoke must outlast the flame or the plume has no tail
  if (s.smokeCool > s.fireCool * 0.8) s.smokeCool = Math.max(0.05, +(Math.round(s.fireCool * 0.5 / 0.05) * 0.05).toFixed(2));
  // a strong side wind lays a weak flame flat: keep enough lift
  if (Math.abs(s.wind) > 0.6 && s.lift < 2.5) s.lift = 2.5;
  // upstream: a portrait domain gets more, smaller swirls
  if (s.aspect < 1) s.swirlR = Math.min(s.swirlR, 0.045);
  // many big burners fill the box with heat: keep the burner area bounded
  if (s.nBurn * s.size > 0.45) s.size = Math.max(0.05, Math.floor(0.45 / s.nBurn / 0.005) * 0.005);
  return s;
}

export const sceneRng = seed => K.rng((seed ^ 0x68e31da4) >>> 0);
export function burnersFor(st, r) {
  const out = [], n = st.nBurn, mot = () => (st.motion === 'mixed' ? r.pick(['static', 'static', 'orbit', 'sweep', 'bob']) : st.motion);
  const add = (kind, fx, fy, rr) => out.push({ kind, fx, fy, r: rr, motion: mot(), amp: 0.08 + 0.22 * r(), freq: st.speed * (0.6 + 0.8 * r()), ph: r() * 6.283 });
  switch (st.preset) {
    case 'floor': add('ring', 0.5, 0.35, st.size); out[0].on = false; break;   // upstream: an unlit ring stirs the air
    case 'both': add('ring', 0.5, 0.45, st.size * 0.8); break;
    case 'campfire': for (let k = 0; k < n; k++) add('log', (k + 0.5) / n, 0.12 + 0.06 * r(), st.size * 0.9); break;
    case 'torches': for (let k = 0; k < n; k++) add('torch', (k + 0.5) / n, 0.1 + 0.15 * r(), st.size); break;
    case 'mixed': for (let k = 0; k < n; k++) add(r.pick(['ring', 'disc', 'log', 'torch']), 0.15 + 0.7 * r(), 0.12 + 0.35 * r(), st.size * (0.7 + 0.5 * r())); break;
    default: add('ring', 0.5, 0.3, st.size); for (let k = 1; k < n; k++) add('ring', 0.15 + 0.7 * r(), 0.2 + 0.3 * r(), st.size * (0.6 + 0.4 * r()));
  }
  return out;
}
export function sceneConfig(st, r) { return { cells: st.cells, aspect: st.aspect, burners: burnersFor(st, r) }; }
export function applyParams(S, st) {
  const C = S.cfg;
  C.lift = st.lift; C.fireCooling = st.fireCool; C.smokeCooling = st.smokeCool; C.accel = st.accel; C.torch = st.torch; C.wind = st.wind;
  C.swirlProbability = st.prob; C.swirlMaxRadius = st.swirlR; C.swirlOmega = st.swirlW; C.swirlLife = st.swirlLife;
  C.floor = st.floor; C.iters = st.iters; C.gravity = st.gravity;
}
