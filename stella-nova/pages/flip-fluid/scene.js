// ============================================================================
//  FLIP WATER  ·  scene.js  —  the sim kit schema over scenes.js and looks.js
// ----------------------------------------------------------------------------
//  Our addition to the Ten Minute Physics port (not upstream code). No DOM,
//  so main.js and tests.mjs use the same rules.
//
//  The scenes.js randomizer stays the model: one seed text, and one sub
//  seed per category. The kit holds them as controls:
//    preset         'harbour' (the default scene) or 'seeded' (the kit seed)
//    v_<category>   the category's variant: 0 = from the seed, n > 0 =
//                   scenes.js sub seed 'v<n>'. The kit group dice draws a
//                   new n; the group lock keeps it.
//    o_<key>        an Adjust value (scenes.js OVERRIDES); the low end is
//                   "auto" (no override)
//    look keys      view, water, map, rev, bg, obj, foam (looks.js)
//  toScenesState(kitState, seed) gives the scenes.js state.
//
//  grep -n targets: "export function makeSchema", "export function toScenesState",
//  "export function guard", "export function lookToKit"
// ============================================================================
import { CATS, CAT_NAMES, OVERRIDES } from './scenes.js';
import { SCHEMES, BACKGROUNDS, VIEWS, OBJECT_TINTS, contrast } from './looks.js';
import { KINDS, KIND_IDS } from './bodies.js';
import * as K from '../../widgets/sim-kit/core.js';

// The group each Adjust key sits in.
const OVER_GROUP = { flip: 'solver', g: 'gravity', tilt: 'gravity', damping: 'damping', viscosity: 'damping', wind: 'flow', stiffness: 'solver', pressureIters: 'solver' };
export const OVER_KEYS = new Set(Object.keys(OVERRIDES).map(k => 'o_' + k));
export const overKey = k => k.slice(2);
const autoOf = k => { const [lo, , st] = OVERRIDES[k]; return +(lo - st).toFixed(4); };
export const BG_THEME = { night: 'night', abyss: 'abyss', slate: 'slate', dusk: 'violet', dawn: 'ember', paper: 'paper', grid: 'blueprint' };
export const themeForBg = id => BG_THEME[id] || 'night';
export const pageBg = c => (BACKGROUNDS[c && c.bg] || BACKGROUNDS.night).page;

export function makeSchema() {
  const groups = [
    { id: 'scene', label: 'Scene', controls: [
      { key: 'preset', type: 'choice', label: 'Scene', value: 'harbour', options: [{ id: 'harbour', label: 'Harbour dam break' }, { id: 'seeded', label: 'From the seed' }], rebuild: true, random: { pick: ['seeded'] } },
      { type: 'note', text: 'Each group below has its own dice and lock. "New scene" rolls every group that is not locked.' },
    ] },
  ];
  for (const cat of CATS.concat(['objects'])) {
    const controls = [{ key: 'v_' + cat, type: 'range', label: 'Variant', min: 0, max: 999999, step: 1, value: 0, rebuild: true, fmt: v => (v ? '#' + v : 'from the seed'), random: { dist: 'int', min: 1, max: 999999 } }];
    for (const [k, [lo, hi, st, label]] of Object.entries(OVERRIDES)) if (OVER_GROUP[k] === cat) {
      controls.push({ key: 'o_' + k, type: 'range', label, min: autoOf(k), max: hi, step: st, value: autoOf(k), random: false, fmt: v => (v < lo ? 'auto' : String(+(+v).toFixed(st < 0.1 ? 2 : st < 1 ? 1 : 0))) });
    }
    if (cat === 'objects') {
      controls.push(
        { type: 'buttons', key: 'arm', label: 'Drop (tap the water)', action: 'arm', items: KIND_IDS.map(id => ({ id, label: KINDS[id].name })) },
        { type: 'buttons', key: 'objs', label: 'Objects', action: 'objs', items: [{ id: 'drop3', label: 'Drop 3 random' }, { id: 'clearObj', label: 'Clear objects' }] },
        { key: 'erase', type: 'toggle', label: 'Eraser (tap an object)', value: false, random: false });
    }
    groups.push({ id: cat, label: CAT_NAMES[cat] || cat, controls, hint: cat === 'objects' ? 'Drag any object to move or throw it.' : undefined });
  }
  groups.push({ id: 'look', label: 'Look', controls: [
    { key: 'view', type: 'choice', label: 'View', value: 'surface', seg: false, options: Object.entries(VIEWS).map(([id, v]) => ({ id, label: v.name })), random: { weights: { surface: 62, particles: 11, speed: 7, vorticity: 7, pressure: 6, density: 7 } } },
    { key: 'water', type: 'swatch', label: 'Water', value: 'clear', options: Object.entries(SCHEMES).map(([id, s]) => ({ id, label: s.name, colors: [s.line, s.shallow, s.deep] })) },
    { key: 'map', type: 'cmap', label: 'Colour map (field views)', value: 'turbo' },
    { key: 'rev', type: 'toggle', label: 'Reverse map', value: false, random: { p: 0.2 } },
    { key: 'bg', type: 'choice', label: 'Background', value: 'night', seg: false, options: Object.entries(BACKGROUNDS).map(([id, b]) => ({ id, label: b.name, swatch: [b.top, b.bottom] })), random: { weights: { night: 2, abyss: 1, slate: 1, dusk: 1, dawn: 1, paper: 1, grid: 1 } } },
    { key: 'obj', type: 'choice', label: 'Object colours', value: 'own', seg: false, options: Object.entries(OBJECT_TINTS).map(([id, t]) => ({ id, label: t.name })), random: { weights: { own: 7, pastel: 1, dusk: 1, gold: 1, ghost: 1 } } },
    { key: 'foam', type: 'toggle', label: 'Foam and spray', value: true, random: { p: 0.85 } },
    Object.assign(K.themeControl('night'), { label: 'Panel theme', random: false }),
  ] });
  return { groups };
}
export const REBUILD = new Set(['preset'].concat(CATS.concat(['objects']).map(c => 'v_' + c)));

// Random looks keep the water readable on the background (looks.js
// contrast > 0.1), and the panel theme follows the background.
export function guard(next) {
  const s = Object.assign({}, next);
  if (contrast(SCHEMES[s.water] || SCHEMES.clear, BACKGROUNDS[s.bg] || BACKGROUNDS.night) <= 0.1) s.bg = 'night';
  if (contrast(SCHEMES[s.water] || SCHEMES.clear, BACKGROUNDS[s.bg]) <= 0.1) s.bg = 'abyss';
  s.theme = themeForBg(s.bg);
  return s;
}

export function toScenesState(st, seed) {
  const sub = {};
  for (const cat of CATS.concat(['objects'])) if (st['v_' + cat] > 0) sub[cat] = 'v' + st['v_' + cat];
  const over = {};
  for (const k of Object.keys(OVERRIDES)) { const v = st['o_' + k]; if (v != null && v >= OVERRIDES[k][0]) over[k] = v; }
  return {
    seed: st.preset === 'harbour' ? 'harbour' : 'k' + (seed >>> 0), sub, locks: [], over,
    colours: { view: st.view, water: st.water, map: st.map, rev: st.rev ? '1' : '0', bg: st.bg, obj: st.obj, foam: st.foam ? '1' : '0' },
  };
}
// looks.js randomLook values -> kit keys
export function lookToKit(L) {
  const o = { view: L.view, water: L.water, bg: L.bg, obj: L.obj, foam: L.foam !== '0', theme: themeForBg(L.bg) };
  if (L.map) o.map = L.map;
  o.rev = L.rev === '1';
  return o;
}
