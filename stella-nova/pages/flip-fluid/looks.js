// ============================================================================
//  FLIP WATER  ·  looks.js  —  colour schemes, backgrounds and views
// ----------------------------------------------------------------------------
//  Our addition to the Ten Minute Physics port (not upstream code).
//
//  The look lives in state.colours (scenes.js COLOUR_KEYS), so it is in the
//  URL hash:
//    water  scheme id (SCHEMES): the water colours, shallow to deep, the
//           surface line and the foam
//    view   VIEWS id: 'surface' (smooth water), 'particles', or a field
//           drawn with a colour map: 'speed', 'vorticity', 'pressure',
//           'density'
//    map    colour map id of ../ct-lab/colormaps/maps.js for field views
//    rev    '1' reverses the colour map
//    bg     BACKGROUNDS id
//    obj    OBJECT_TINTS id (a tint over every object's own colours)
//    foam   '0' turns foam and spray off
//  resolveLook(colours) fills the defaults; randomLook(rnd) draws a whole
//  look (the "Random look" button and the saver).
//
//  grep -n targets
//    export const SCHEMES / BACKGROUNDS / VIEWS / OBJECT_TINTS
//    export function resolveLook
//    export function randomLook
//    export function contrast    water vs background, for random looks
// ============================================================================
import * as CM from '../ct-lab/colormaps/maps.js';

// shallow, deep, surface line, foam (hex)
export const SCHEMES = {
  clear:    { name: 'Clear blue',  shallow: '#7cc8ff', deep: '#1a5fd0', line: '#d8f1ff', foam: '#ffffff' },
  ocean:    { name: 'Deep ocean',  shallow: '#2f8fd8', deep: '#061c4a', line: '#9fd6ff', foam: '#e8f6ff' },
  tropical: { name: 'Tropical',    shallow: '#6ff2d9', deep: '#0b8fb0', line: '#e9fffb', foam: '#ffffff' },
  swamp:    { name: 'Swamp',       shallow: '#8fae4a', deep: '#2d3b16', line: '#c9dc8a', foam: '#e6efc4' },
  lava:     { name: 'Lava',        shallow: '#ffd34d', deep: '#b8240f', line: '#fff3b0', foam: '#fff8d6' },
  ink:      { name: 'Ink',         shallow: '#5b4bd6', deep: '#120a3a', line: '#b9aefc', foam: '#e8e4ff' },
  neon:     { name: 'Neon',        shallow: '#ff5ce1', deep: '#2b0b6e', line: '#9ffcff', foam: '#ffffff' },
  mono:     { name: 'Monochrome',  shallow: '#d7dbe3', deep: '#3d4250', line: '#ffffff', foam: '#ffffff' },
  sunset:   { name: 'Sunset',      shallow: '#ffb36b', deep: '#5a1f5e', line: '#ffe2bd', foam: '#fff1e0' },
  arctic:   { name: 'Arctic',      shallow: '#e2f7ff', deep: '#4d93b8', line: '#ffffff', foam: '#ffffff' },
  milk:     { name: 'Milk',        shallow: '#ffffff', deep: '#d9d2c4', line: '#ffffff', foam: '#ffffff' },
  blood:    { name: 'Wine',        shallow: '#d94a5c', deep: '#3a0612', line: '#ffb3bf', foam: '#ffe0e6' },
};
// page, tank top, tank bottom, wall stroke
export const BACKGROUNDS = {
  night:  { name: 'Night',  page: '#0b1220', top: '#111b2e', bottom: '#0c1424', wall: '#8a93a8' },
  abyss:  { name: 'Abyss',  page: '#020306', top: '#06080d', bottom: '#020306', wall: '#4a5468' },
  slate:  { name: 'Slate',  page: '#1c2129', top: '#2a313c', bottom: '#20262f', wall: '#a7b0bf' },
  dusk:   { name: 'Dusk',   page: '#140d1f', top: '#3a2045', bottom: '#120b1c', wall: '#c4a6d6' },
  dawn:   { name: 'Dawn',   page: '#1a1410', top: '#f0b98a', bottom: '#5b3a2a', wall: '#f6dcc4' },
  paper:  { name: 'Paper',  page: '#e9e4da', top: '#f6f2ea', bottom: '#e2dccf', wall: '#5b5446' },
  grid:   { name: 'Blueprint', page: '#0c2a4a', top: '#11365e', bottom: '#0b2846', wall: '#cfe6ff', grid: 'rgba(207,230,255,0.10)' },
};
export const VIEWS = {
  surface:   { name: 'Water' },
  particles: { name: 'Particles' },
  speed:     { name: 'Speed', field: true, map: 'turbo' },
  vorticity: { name: 'Swirl', field: true, map: 'coolwarm', signed: true },
  pressure:  { name: 'Pressure', field: true, map: 'magma' },
  density:   { name: 'Density', field: true, map: 'viridis' },
};
// [hex, amount] mixed into every object colour; null keeps the own colours
export const OBJECT_TINTS = {
  own:    { name: 'Own colours', tint: null },
  pastel: { name: 'Pastel', tint: ['#ffffff', 0.35] },
  dusk:   { name: 'Dusk', tint: ['#3a2a5a', 0.35] },
  gold:   { name: 'Gold', tint: ['#ffcc55', 0.45] },
  ghost:  { name: 'Ghost', tint: ['#cfe6ff', 0.7] },
};

const lum = (c) => { const v = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16) / 255); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
// Light difference between the water (mean of shallow and deep) and the
// tank background (mean of top and bottom), 0..1.
export function contrast(scheme, bg) {
  return Math.abs((lum(scheme.shallow) + lum(scheme.deep)) / 2 - (lum(bg.top) + lum(bg.bottom)) / 2);
}

export function resolveLook(c = {}) {
  const view = VIEWS[c.view] ? c.view : 'surface';
  const mapId = c.map && CM.has(c.map) ? c.map : (VIEWS[view].map || 'turbo');
  return {
    water: SCHEMES[c.water] ? c.water : 'clear',
    view, map: mapId, rev: c.rev === '1' || c.rev === 1 || c.rev === true,
    bg: BACKGROUNDS[c.bg] ? c.bg : 'night',
    obj: OBJECT_TINTS[c.obj] ? c.obj : 'own',
    foam: !(c.foam === '0' || c.foam === 0 || c.foam === false),
  };
}

// A whole random look as hash values. Water views are the most common.
export function randomLook(rnd = Math.random) {
  const pick = (a) => a[Math.floor(rnd() * a.length) % a.length];
  const view = rnd() < 0.62 ? 'surface' : rnd() < 0.3 ? 'particles' : pick(['speed', 'vorticity', 'pressure', 'density']);
  const out = { water: pick(Object.keys(SCHEMES)), view, bg: 'night', obj: rnd() < 0.7 ? 'own' : pick(Object.keys(OBJECT_TINTS)), foam: rnd() < 0.85 ? '1' : '0' };
  // a background the water stands out from (milk water on paper, sunset
  // water at dawn are nearly invisible)
  const bgs = ['night', 'night', 'abyss', 'slate', 'dusk', 'dawn', 'paper', 'grid'];
  for (let k = 0; k < 12; k++) { out.bg = pick(bgs); if (contrast(SCHEMES[out.water], BACKGROUNDS[out.bg]) > 0.1) break; out.bg = 'night'; }
  if (VIEWS[view].field) {
    const group = VIEWS[view].signed ? 'diverging' : pick(['perceptual', 'perceptual', 'artistic', 'medical']);
    out.map = pick(CM.list(group).map(m => m.id));
    out.rev = rnd() < 0.2 ? '1' : '0';
  }
  return out;
}

export { CM };
