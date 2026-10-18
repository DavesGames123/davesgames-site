// ============================================================================
//  ANIMATED PATTERN DESIGNER  ·  presets.js — curated loops and random picks
// ----------------------------------------------------------------------------
//  PRESETS. Each preset names a pattern of the pattern-designer book, its
//  slider changes (P), a palette, a style, a loop length L, the channels
//  (motion.js CHANNELS) with their curve, amount, freq and cycles, and an
//  optional morph (to a second seed or a second pattern). The presets
//  start dense: the page gives them the default density, and only the
//  frame budget of the device can make it lower.
//
//  randomAnim(rng, pat) picks two or three channels that suit the family
//  of the pattern (FAMILY_POOL), with mild curves and amounts, and a loop
//  of 6 to 16 s.
//
//  COMPOSED: families and patterns that draw one centred motif. A turn of
//  the board keeps the board size for these (motion.js coverFor), so the
//  motif keeps its size and the corners show paper.
//
//  grep -n targets: "export const PRESETS", "export const FAMILY_POOL",
//                   "export function randomAnim", "export function presetAnim"
// ============================================================================
import { CHANNELS, animDefaults, cleanAnim } from './motion.js';

export const COMPOSED_FAMS = ['radial', 'geometric'];
export const COMPOSED_IDS = ['drift-tunnel', 'harmonic-trace', 'orbit-trails', 'cyclotron', 'growth-rings', 'ring-labyrinth', 'bound-rings'];
export const isComposed = p => !!p && (COMPOSED_FAMS.includes(p.family) || COMPOSED_IDS.includes(p.id));

const c = (curve, amount, freq, cycles = 1, phase = 0) => ({ on: 1, curve, amount, freq, cycles, phase });
export const PRESETS = [
  { id: 'tidal-arcs', name: 'Tidal arcs', pat: 'arc-lattice', pal: 'bone', seed: 12, L: 8, ch: { spin: c('ease', 90, 1), colour: c('ramp', 1, 0.8) } },
  { id: 'ripple-rings', name: 'Ripple rings', pat: 'phase-rings', pal: 'night', seed: 5, L: 10, ch: { ripple: c('ramp', 0.012, 5), twist: c('sine', 40, 0.9) } },
  { id: 'guilloche-turn', name: 'Guilloche turn', pat: 'guilloche', pal: 'gold-black', seed: 3, L: 12, ch: { twist: c('sine', 70, 0.9), rotate: c('sine', 8, 0) } },
  { id: 'moire-shimmer', name: 'Moire shimmer', pat: 'moire-lines', pal: 'paper', seed: 21, L: 10, ch: { rotate: c('sine', 4, 0), wave: c('ramp', 0.006, 3) } },
  { id: 'seed-spiral', name: 'Seed spiral', pat: 'seed-head', pal: 'ember', seed: 8, L: 20, ch: { rotate: c('ramp', 12, 0), breathe: c('sine', 0.4, 2, 2) } },
  { id: 'halftone-breath', name: 'Halftone breath', pat: 'screen-dots', pal: 'riso', seed: 4, L: 6, ch: { breathe: c('sine', 0.6, 1.5), colour: c('sine', 1, 1) } },
  { id: 'iso-tide', name: 'Iso tide', pat: 'tumbling-blocks', pal: 'clay', seed: 9, L: 10, ch: { thin: c('sine', 0.55, 1), colour: c('ramp', 1, 0) } },
  { id: 'ribbon-current', name: 'Ribbon current', pat: 'flow-ribbons', pal: 'deep-sea', seed: 14, L: 12, ch: { flow: c('ramp', 0.015, 1.4), dash: c('ramp', 0.4, 1) } },
  { id: 'curl-march', name: 'Curl march', pat: 'curl-streams', pal: 'neon', seed: 2, L: 8, ch: { dash: c('ramp', 0.5, 2), flow: c('ramp', 0.006, 1.2) } },
  { id: 'hex-weave', name: 'Hex weave', pat: 'hex-arcs', pal: 'riso-fluor', seed: 31, L: 10, ch: { spin: c('ease', 120, 1.2), colour: c('ramp', 1, 1) } },
  { id: 'rosette-bloom', name: 'Rosette bloom', pat: 'star-rosettes', pal: 'deco', seed: 6, L: 8, ch: { spin: c('sine', 30, 0.5), breathe: c('sine', 0.3, 1) } },
  { id: 'lissajous-dance', name: 'Lissajous dance', pat: 'lissajous-table', pal: 'synth', seed: 11, L: 12, ch: { spin: c('ramp', 90, 0.5), colour: c('ramp', 1, 1) } },
  { id: 'tunnel-dive', name: 'Tunnel dive', pat: 'drift-tunnel', pal: 'aurora', seed: 7, L: 10, ch: { zoom: c('ease', 0.35, 0), twist: c('sine', 90, 1.2) } },
  { id: 'wave-bands', name: 'Rolling bands', pat: 'wave-bands', pal: 'seventies', seed: 3, L: 8, ch: { wave: c('ramp', 0.02, 1.5), colour: c('ramp', 1, 0) } },
  { id: 'turning-squares', name: 'Turning squares', pat: 'turning-squares', pal: 'swiss', seed: 5, L: 6, ch: { spin: c('ease', 90, 1.5) } },
  { id: 'leaf-whorl', name: 'Leaf whorl', pat: 'leaf-spiral', pal: 'forest-floor', seed: 13, L: 24, ch: { rotate: c('ramp', 12, 0), breathe: c('sine', 0.3, 2, 2) } },
  { id: 'glass-flow', name: 'Glass flow', pat: 'lead-glass', pal: 'lapis', seed: 17, L: 12, ch: { flow: c('ramp', 0.012, 1.6), colour: c('ramp', 1, 1.5) } },
  { id: 'maze-run', name: 'Maze run', pat: 'maze-walls', pal: 'blueprint', seed: 23, L: 10, ch: { dash: c('ramp', 0.25, 1), lens: c('ramp', 0.5, 0.3) } },
  { id: 'herringbone-tide', name: 'Herringbone tide', pat: 'herringbone', pal: 'terracotta', seed: 2, L: 8, ch: { wave: c('ramp', 0.01, 2), colour: c('ramp', 1, 0.6) } },
  { id: 'plaid-lens', name: 'Plaid lens', pat: 'sett-plaid', pal: 'letterpress', seed: 4, L: 10, ch: { lens: c('ramp', 0.6, 0.35), pan: c('ramp', 0.02, 0) } },
  { id: 'superformula-morph', name: 'Superformula morph', pat: 'superformula', pal: 'okabe-dark', seed: 19, L: 10, ch: { spin: c('sine', 40, 1) }, morph: { seed: 20, curve: 'ease', cycles: 1 } },
  { id: 'rhomb-lens', name: 'Rhomb lens', pat: 'rhomb-inflation', pal: 'macaron', seed: 8, L: 12, ch: { lens: c('ramp', 0.7, 0.4), colour: c('ramp', 1, 1) } },
  { id: 'crackle-ripple', name: 'Crackle ripple', pat: 'crackle', pal: 'basalt', seed: 15, L: 10, ch: { ripple: c('ramp', 0.008, 6), thin: c('sine', 0.4, 0.5) } },
  { id: 'fern-wind', name: 'Fern wind', pat: 'fern-fronds', pal: 'moss', seed: 9, L: 12, ch: { flow: c('ramp', 0.01, 1.2), breathe: c('sine', 0.12, 1) } },
  { id: 'ray-pulse', name: 'Ray pulse', pat: 'ray-burst', pal: 'sodium', seed: 10, L: 16, ch: { rotate: c('ramp', 12, 0), ripple: c('ramp', 0.01, 3, 2) } },
  { id: 'module-morph', name: 'Module morph', pat: 'module-grid', pal: 'primaries', seed: 6, L: 10, ch: { colour: c('ramp', 1, 0) }, morph: { pat: 'split-squares', curve: 'ease', cycles: 1 } },
  { id: 'kaleido-ribbons', name: 'Kaleido ribbons', pat: 'flow-ribbons', pal: 'magma', seed: 12, L: 20, mods: [{ type: 'mirror', kind: 'kaleido', n: 8 }], ch: { rotate: c('ramp', 12, 0), breathe: c('sine', 0.2, 1.5) } },
  { id: 'truchet-tide', name: 'Truchet tide', pat: 'nested-truchet', pal: 'tide', seed: 27, L: 8, ch: { spin: c('ease', 90, 1) } },
];
export const presetById = id => PRESETS.find(p => p.id === id) || null;
// The animation state of a preset (every other channel off).
export function presetAnim(pr) {
  const a = animDefaults(pr.L);
  for (const id in pr.ch) Object.assign(a.ch[id], pr.ch[id]);
  a.morph = pr.morph ? Object.assign({ phase: 0 }, pr.morph) : null;
  return cleanAnim(a);
}

// The channels that suit each family (the random pick draws from these).
export const FAMILY_POOL = {
  grid: ['spin', 'breathe', 'thin', 'colour', 'lens', 'wave'],
  tiling: ['spin', 'breathe', 'colour', 'lens', 'thin', 'wave'],
  iso: ['thin', 'colour', 'breathe', 'lens', 'wave'],
  textile: ['wave', 'lens', 'colour', 'pan', 'flow'],
  mesh: ['flow', 'colour', 'breathe', 'thin', 'ripple'],
  flow: ['flow', 'dash', 'wave', 'colour', 'lens'],
  distort: ['wave', 'twist', 'lens', 'colour', 'ripple'],
  opart: ['wave', 'rotate', 'twist', 'colour', 'zoom'],
  paths: ['dash', 'lens', 'colour', 'wave', 'twist'],
  physics: ['dash', 'flow', 'twist', 'colour', 'rotate'],
  radial: ['rotate', 'twist', 'ripple', 'breathe', 'colour', 'zoom'],
  geometric: ['spin', 'rotate', 'twist', 'colour', 'breathe', 'zoom'],
  texture: ['breathe', 'ripple', 'wave', 'colour', 'thin'],
  organic: ['flow', 'breathe', 'colour', 'thin', 'wave'],
  botanical: ['flow', 'breathe', 'colour', 'rotate', 'wave'],
};
const CURVE_W = [['def', 0.45], ['sine', 0.2], ['ease', 0.2], ['noise', 0.1], ['bounce', 0.05]];
// o.geo: motion.js geoInfo of the geometry, so a pick skips dashes with no
// strokes and turns of circles only. o.morph false: no morph.
export function randomAnim(rng, pat, o = {}) {
  let pool = (FAMILY_POOL[pat.family] || FAMILY_POOL.flow).slice();
  if (o.geo) pool = pool.filter(id => !(id === 'dash' && !o.geo.lines) && !(id === 'spin' && !o.geo.shapes));
  const a = animDefaults(rng.pick([6, 8, 8, 10, 12, 16]));
  const k = rng.chance(0.6) ? 2 : 3;
  rng.shuffle(pool);
  for (const id of pool.slice(0, k)) {
    const d = CHANNELS[id], s = a.ch[id];
    const cv = CURVE_W[rng.weighted(CURVE_W.map(x => x[1]))][0];
    s.on = 1; s.curve = cv === 'def' ? d.curve : cv;
    // A phase channel with a still curve swings; a ramp keeps it moving.
    s.amount = Math.min(d.amount[1], Math.max(d.amount[0], d.amount[3] * rng.range(0.6, 1.4)));
    if (d.freq) s.freq = Math.min(d.freq[1], Math.max(d.freq[0], d.freq[3] * rng.range(0.6, 1.5)));
    if (id === 'dash') s.freq = rng.int(1, 2);
    if (id === 'colour' && rng.chance(0.5)) s.freq = +rng.range(0.5, 1.5).toFixed(2);
    s.cycles = rng.chance(0.75) ? 1 : 2;
  }
  if (o.morph !== false && ['grid', 'tiling', 'geometric', 'mesh'].includes(pat.family) && rng.chance(0.2)) a.morph = { seed: rng.int(1, 999999), curve: 'ease', cycles: 1, phase: 0 };
  return cleanAnim(a);
}
