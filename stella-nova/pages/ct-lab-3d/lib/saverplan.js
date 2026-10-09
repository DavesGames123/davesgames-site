// ============================================================================
//  CT LAB 3D  ·  lib/saverplan.js — the screensaver's shot plan (no DOM)
// ----------------------------------------------------------------------------
//  A seeded sequence of shots. Each shot is { kind, dur, object, map, map2,
//  preset, seed }:
//    kind    never the kind of the shot before
//    object  from a seeded bag of the objects, never the object before
//    map     from a seeded bag of colour maps, never a map of the shot before; map2 is
//            a second map for a cross-fade (about 40 % of the shots)
//    dur     6 to 12 s (the kind sets its range)
//  3D kinds need WebGPU; without it the plan uses the 2D kinds only.
//
//  GREP MAP
//    export const KINDS ........ shot kinds, lengths, needs
//    export const MAPS ......... the colour map pool
//    export function makePlan .. the plan object: next(force)
//    export function mulberry .. the seeded RNG
// ============================================================================

export const KINDS = [
  { kind: 'scan', dur: [10, 12], gpu: true },      // gantry spins, projections fill, FDK emerges
  { kind: 'reveal', dur: [8, 12], gpu: true },     // transfer function morphs: skin -> dense -> metal
  { kind: 'planes', dur: [7, 11], gpu: true },     // three slice planes sweep through the volume
  { kind: 'cutaway', dur: [7, 11], gpu: true },    // volume render with the cutaway, slow close orbit
  { kind: 'mip', dur: [6, 10], gpu: true },        // maximum intensity projection, colour cross-fade
  { kind: 'sweep2d', dur: [6, 10] },               // one slice view sweeping through the object
  { kind: 'triptych', dur: [7, 11] },              // axial, coronal, sagittal + MIP, linked sweep
];
export const MAPS = ['bone', 'grey', 'ice', 'hot-iron', 'copper', 'magma', 'inferno', 'viridis', 'mako', 'rocket', 'cubehelix',
  'aurora', 'nebula', 'ember', 'glacier', 'synthwave', 'gold-leaf', 'xray-blue', 'cyanotype', 'orchid'];

export function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A seeded bag: a shuffle, drawn in order; a new shuffle when empty. draw(avoid) skips
// the items in avoid (the shot before) while the bag allows it.
function bag(R, items) {
  let pool = [];
  return (avoid = []) => {
    if (!pool.length) { pool = items.slice(); for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; } }
    let k = pool.findIndex((x) => !avoid.includes(x));
    if (k < 0) { pool = items.filter((x) => !avoid.includes(x)); k = 0; if (!pool.length) pool = items.slice(); }
    return pool.splice(k, 1)[0];
  };
}

// objects: ids; caps: { gpu }. presetsOf(id) -> preset keys of that object.
export function makePlan(seed, objects, caps = {}, presetsOf = () => ['everything']) {
  const R = mulberry(seed);
  const kinds = KINDS.filter((k) => !k.gpu || caps.gpu);
  const nextKind = bag(R, kinds.map((k) => k.kind)), nextObj = bag(R, objects), nextMap = bag(R, MAPS);
  let prev = null;
  return {
    kinds: kinds.map((k) => k.kind),
    next(force) {
      const kind = force && kinds.some((k) => k.kind === force) ? force : nextKind(prev ? [prev.kind] : []);
      const K = kinds.find((k) => k.kind === kind);
      // the first map differs from both maps of the shot before (its end colour)
      const map = nextMap(prev ? [prev.map, prev.map2].filter(Boolean) : []);
      const map2 = R() < 0.4 ? nextMap([map]) : null;
      const object = nextObj(prev ? [prev.object] : []);
      const ps = presetsOf(object);
      prev = {
        kind, object, map, map2, seed: Math.floor(R() * 1e9),
        dur: K.dur[0] + R() * (K.dur[1] - K.dur[0]),
        preset: ps[Math.floor(R() * ps.length)],
      };
      return prev;
    },
  };
}
