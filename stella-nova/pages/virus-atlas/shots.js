// ============================================================================
//  VIRUS ATLAS  ·  shots.js — the screensaver plan (no DOM)
// ----------------------------------------------------------------------------
//  plan(seed, calm, n) gives n shots. Each shot draws every dimension
//  from its own weighted bag (makeBag), with a seeded RNG per run, so
//  two runs differ and no value repeats in two shots in a row:
//    kind    the effect (EFFECTS)
//    entry   from the pool of the effect, never the last entry
//    rep     the view (budget.js REPS) at the start; repTo a second view
//            for a morph mid-shot (always in a 'morph' shot, else 35 %)
//    scheme  colour scheme (colors.js SCHEMES), pal palette, light rig
//    cam     the camera move (CAMS)
//    peel    the peel order for peel and inside shots, reclose: the shell
//            closes again; ex the explode axes; slice the slice style
//    dur     5 to 12 s (symmetry.js shotSeconds; calm 1 gives the long end)
//
//  EFFECTS  kind -> { pool, w (bag weight), d (duration weight) }
//    assemble  a capsid, rod, cone or virion builds from its subunits
//    peel      subunits lift off in one of six orders (heavy weight)
//    inside    the near half or the outer shell peels, then the camera
//              goes in to the inner surface or the inner shell
//    explode   the shell opens along its 5-, 3- or 2-fold axes or radially
//    implode   the shell starts open and closes
//    slice     a plane cuts to the centre, or a thin slab sweeps through
//    axes      the camera looks down a 5-fold, a 3-fold, then a 2-fold axis
//    spikes    a push-in on one swaying spike of a virion
//    grow      a prion or amyloid fibril grows at both ends
//    morph     one view turns into another (beads melt into blobs, a
//              tube grows along each chain ...), a drawing change only
//    protein   one protein builds and turns
//    ladder    the scale ladder: 4 nm protein to the 300 nm TMV rod
//
//  grep -n targets: "export function makeBag", "export const EFFECTS",
//    "export const CAMS", "export function okRep", "export function plan"
// ============================================================================
import { makeRng, shotSeconds } from './symmetry.js';
import { LADDER_KEYS, entryByKey } from './catalog.js';
import { REPS } from './budget.js';
import { SCHEMES, PALETTES, LIGHTS } from './colors.js';

export const CAPSIDS = ['polio', 'rhino', 'noro', 'hbv', 'hpv', 'adeno', 'zika', 'hk97'];
const VIRIONS = ['sars2-virion', 'flu-virion'];
const FIBRILS = ['prion-263k', 'prion-rml', 'prp-fibril', 'tau', 'asyn'];
const PROTEINS = ['spike', 'rbd-ace2', 'ha', 'na', 'env', 'hiv-ca', 'ebola', 'rabies', 'measles', 'prp'];
const ALL = [...CAPSIDS, 'tmv', 'hiv-cone', ...VIRIONS, ...FIBRILS, ...PROTEINS];

export const EFFECTS = {
  assemble: { pool: [...CAPSIDS, 'tmv', 'hiv-cone', ...VIRIONS], w: 1.0, d: 1.1 },
  peel: { pool: [...CAPSIDS, 'tmv', 'hiv-cone', ...VIRIONS], w: 2.6, d: 1.05 },
  inside: { pool: ['adeno', 'hk97', 'hpv', 'zika', 'polio', 'rhino', 'noro', 'hbv', 'hiv-cone'], w: 1.2, d: 1.15 },
  explode: { pool: CAPSIDS, w: 1.1, d: 1 },
  implode: { pool: [...CAPSIDS, 'tmv'], w: 0.8, d: 0.95 },
  slice: { pool: ['adeno', 'hiv-cone', 'hbv', 'zika', 'hk97', 'hpv', 'tmv', 'polio'], w: 1.0, d: 1 },
  axes: { pool: CAPSIDS, w: 0.8, d: 1.1 },
  spikes: { pool: VIRIONS, w: 0.7, d: 1 },
  grow: { pool: FIBRILS, w: 0.7, d: 1 },
  morph: { pool: ALL, w: 1.5, d: 1.1 },
  protein: { pool: PROTEINS, w: 0.7, d: 0.9 },
  ladder: { pool: [LADDER_KEYS[0]], w: 0.5, d: 1.3 },
};
export const PEELS = { 0: 'the side facing the camera', 1: 'latitude, from the pole down', 2: 'symmetry copy by copy', 3: 'the outer shell first', 4: 'a spiral from the pole', 5: 'random tiles' };
export const EXES = { 5: '5-fold axes', 3: '3-fold axes', 2: '2-fold axes', '-1': 'radial lines' };
export const SLICES = ['half', 'slab'];
export const CAMS = ['orbit', 'pushin', 'pullout', 'crane', 'arc', 'dutch', 'flyby'];
const W_REPS = { beads: 0.9, space: 1.3, tube: 1.1, blob: 1.2, cage: 1.0, glow: 0.9, toon: 0.9 };
const W_SCHEMES = { protein: 1.3, chain: 0.9, copy: 1.0, radius: 1.3, structure: 0.9, residue: 0.7, hydro: 0.7, rainbow: 1.0, burial: 0.8 };

// A weighted bag: each key goes in max(1, round(2 w)) times, shuffled.
// next(ok) takes the first key in the bag that is not the last key
// drawn and passes ok(); an empty bag refills. It returns the last key
// again only when ok() allows nothing else.
export function makeBag(rng, weights) {
  const keys = Object.keys(weights);
  let bag = [], last = null;
  const fill = () => { bag = []; for (const k of keys) for (let i = 0; i < Math.max(1, Math.round(2 * weights[k])); i++) bag.push(k); bag = rng.shuffle(bag); };
  return {
    next(ok = () => true) {
      for (let pass = 0; pass < 2; pass++) {
        if (!bag.length) fill();
        const i = bag.findIndex(k => k !== last && ok(k));
        if (i >= 0) { last = bag.splice(i, 1)[0]; return last; }
        fill();
      }
      const alt = keys.filter(k => ok(k) && k !== last);
      last = alt.length ? rng.pick(alt) : keys.find(ok) || keys[0];
      return last;
    },
    get last() { return last; },
  };
}

// Views that suit an entry and an effect (cost and legibility)
export function okRep(kind, key, rep) {
  const e = entryByKey(key), look = e ? e.look : 'capsid';
  if (rep === 'cage' && (look === 'protein' || kind === 'spikes' || kind === 'grow')) return false;
  if (kind === 'ladder') return rep !== 'tube' && rep !== 'cage';
  if (rep === 'tube' && kind === 'assemble' && look === 'virion') return false;
  return true;
}
export function okScheme(key, s) {
  const e = entryByKey(key), look = e ? e.look : 'capsid';
  if (s === 'copy') return look !== 'protein';
  if (s === 'radius') return look === 'capsid' || look === 'cone' || look === 'virion' || look === 'rod';
  return true;
}
export function okCam(kind, cam) {
  if (kind === 'axes' || kind === 'ladder' || kind === 'spikes') return cam === 'orbit';
  if (kind === 'inside') return cam === 'orbit' || cam === 'crane' || cam === 'dutch';
  return true;
}

export function plan(seed, calm, n) {
  const r = makeRng(seed), out = [];
  const W = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? v : v.w]));
  const bags = {
    kind: makeBag(r, W(EFFECTS)), rep: makeBag(r, W_REPS), scheme: makeBag(r, W_SCHEMES),
    pal: makeBag(r, Object.fromEntries(Object.keys(PALETTES).map(k => [k, k === 'atlas' || k === 'goodsell' ? 1.4 : 1]))),
    light: makeBag(r, Object.fromEntries(Object.keys(LIGHTS).map(k => [k, k === 'studio' ? 1.4 : 1]))),
    cam: makeBag(r, Object.fromEntries(CAMS.map(k => [k, 1]))),
    peel: makeBag(r, { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 }),
    ex: makeBag(r, { 5: 1.2, 3: 1, 2: 1, '-1': 0.8 }),
    slice: makeBag(r, { half: 1, slab: 1.2 }),
  };
  REPS.forEach(k => { if (W_REPS[k] == null) throw new Error('no weight for view ' + k); });
  SCHEMES.forEach(s => { if (W_SCHEMES[s.id] == null) throw new Error('no weight for scheme ' + s.id); });
  while (out.length < n) {
    const prev = out[out.length - 1];
    // an effect with one entry (the ladder) waits when that entry just played
    const kind = bags.kind.next(k => !(prev && EFFECTS[k].pool.length === 1 && EFFECTS[k].pool[0] === prev.entry)), E = EFFECTS[kind];
    let entry = r.pick(E.pool);
    if (prev && prev.entry === entry && E.pool.length > 1) entry = E.pool[(E.pool.indexOf(entry) + 1) % E.pool.length];
    const rep = bags.rep.next(v => okRep(kind, entry, v));
    let repTo = null;
    if (kind === 'morph' || (kind !== 'ladder' && kind !== 'axes' && r.next() < 0.35)) repTo = bags.rep.next(v => v !== rep && okRep(kind, entry, v));
    const sh = {
      kind, entry, rep, repTo, morphAt: r.range(0.32, 0.55),
      scheme: bags.scheme.next(s => okScheme(entry, s)), pal: bags.pal.next(), light: bags.light.next(),
      cam: bags.cam.next(c => okCam(kind, c)),
      peel: kind === 'peel' || kind === 'inside' ? +bags.peel.next(p => kind !== 'inside' || p === '0' || p === '3') : null,
      reclose: kind === 'peel' ? r.next() < 0.45 : false,
      ex: kind === 'explode' || kind === 'implode' ? +bags.ex.next(x => entryByKey(entry).look === 'capsid' || x === '-1') : null,
      slice: kind === 'slice' ? bags.slice.next() : null,
      dur: shotSeconds(calm, r.next(), E.d), seed: Math.floor(r.next() * 1e9),
    };
    out.push(sh);
  }
  return out;
}
