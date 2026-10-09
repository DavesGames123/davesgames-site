// ============================================================================
//  PERIODIC TABLE  ·  saver-plan.js  ·  the screensaver shot plan (no DOM)
// ----------------------------------------------------------------------------
//  planShots(seed, n) -> [{ kind, dur, ... }] with no kind twice in a row.
//  A seeded bag: every kind once in a shuffled order, then a new bag, and a
//  draw that would repeat the last kind swaps with the next one. Each shot
//  has its own random settings, so two runs of the saver differ.
//    morph     the table flies through three views in turn
//    melt      a temperature sweep melts and boils the table, live
//    timeline  the discovery years run, elements appear as they are found
//    tower     a property as height, the 3D tower turning
//    heat      a heat map tour: the property and the colour map change
//    atom      a push-in on one element, its atom fills the frame: Bohr
//              shells, then the orbital clouds
//    scatter   property against property, the points fly into the plot
//    spiral    the spiral and the shells views with a slow turn of focus
//  saver.js plays the plan; tests.mjs checks it.
//
//  GREP MAP
//    grep -n "export const KINDS"      the shot kinds
//    grep -n "export function planShots"
// ============================================================================
export const KINDS = ['morph', 'melt', 'timeline', 'tower', 'heat', 'atom', 'scatter', 'spiral'];

const PROPS_H = ['density', 'ie1', 'en', 'mp', 'bp', 'radius', 'mass', 'zeff'];
const PROPS_HEAT = ['en', 'ie1', 'radius', 'density', 'mp', 'bp', 'ea', 'crust', 'universe', 'year', 'zeff'];
const MAPS = ['magma', 'inferno', 'viridis', 'plasma', 'mako', 'rocket', 'turbo', 'aurora', 'nebula', 'ember', 'glacier', 'synthwave', 'gold-leaf', 'cubehelix', 'ice', 'hot-iron'];
const VIEWS2D = ['standard', 'long', 'spiral', 'radial', 'janet', 'blocks', 'abundance'];
const PAIRS = [['radius', 'ie1'], ['mass', 'density'], ['en', 'ie1'], ['radius', 'en'], ['mp', 'bp'], ['z', 'zeff']];
// Elements that make a good close-up (light, transition, heavy, odd ones).
const ATOMS = [1, 2, 6, 8, 10, 11, 17, 26, 29, 47, 79, 80, 82, 92, 94, 118, 55, 24, 64, 86, 54, 36, 7, 15];

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, a) => a[Math.floor(r() * a.length)];
function shuffle(r, a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

export function planShots(seed = 1, n = 24) {
  const r = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const out = [];
  let bag = [];
  while (out.length < n) {
    if (!bag.length) bag = shuffle(r, KINDS.slice());
    let kind = bag.shift();
    if (out.length && kind === out[out.length - 1].kind) {
      if (bag.length) { const k2 = bag.shift(); bag.unshift(kind); kind = k2; }
      else { bag = shuffle(r, KINDS.filter(k => k !== kind)); bag.push(kind); kind = bag.shift(); }
    }
    const dur = Math.round((6 + 6 * r()) * 10) / 10;
    const S = { kind, dur, seed: Math.floor(r() * 1e9) };
    if (kind === 'morph') S.views = shuffle(r, VIEWS2D.slice()).slice(0, 3);
    if (kind === 'melt') { S.from = pick(r, [10, 50, 200]); S.to = pick(r, [2500, 4000, 6000]); S.view = pick(r, ['standard', 'long', 'spiral']); }
    if (kind === 'timeline') { S.from = pick(r, [1600, 1700, 1750]); S.view = 'timeline'; }
    if (kind === 'tower') { S.prop = pick(r, PROPS_H); S.cmap = pick(r, MAPS); S.turn = (r() < 0.5 ? -1 : 1) * (0.35 + 0.3 * r()); }
    if (kind === 'heat') { S.props = shuffle(r, PROPS_HEAT.slice()).slice(0, 2); S.cmaps = shuffle(r, MAPS.slice()).slice(0, 2); S.view = pick(r, ['heat', 'long', 'spiral', 'janet']); }
    if (kind === 'atom') { S.z = pick(r, ATOMS); S.view = pick(r, ['standard', 'long', 'blocks']); }
    if (kind === 'scatter') { const p = pick(r, PAIRS); S.x = p[0]; S.y = p[1]; S.cmap = pick(r, MAPS); }
    if (kind === 'spiral') { S.view = pick(r, ['spiral', 'radial']); S.focus = shuffle(r, ATOMS.slice()).slice(0, 3); }
    out.push(S);
  }
  return out;
}
