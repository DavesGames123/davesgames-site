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
//    exview    the exploded view: the parts separate along the 5-, 3- or
//              2-fold axes, radially, or capsomer by capsomer, with a
//              stagger (by distance, ring, copy, or pentamers first),
//              hold apart while the camera flies between two parts,
//              then close (or stay open for the next shot of a chapter)
//    inspect   one region (regions.js REGION_KINDS) lifts out while the
//              rest turns to a ghost or moves away; the camera pushes in
//              and turns round it; the view morphs to a tube or space-
//              filling and the colour to chain or secondary structure;
//              then the region rejoins the whole
//
//  CHAPTERS  the bag key 'tour' plays 3 shots on one capsid (a guided
//    tour): for example explode along the 5-fold axes, inspect a
//    pentamer from the open shell, then peel to the inside. A shot after
//    the first has cont: true; it keeps the entry, palette, light, colour
//    and view of the shot before it (no cut), and fromEx: true when the
//    shell is still open.
//
//  grep -n targets: "export function makeBag", "export const EFFECTS",
//    "export const CAMS", "export function okRep", "export const CHAPTERS",
//    "export function plan"
// ============================================================================
import { makeRng, shotSeconds } from './symmetry.js';
import { LADDER_KEYS, entryByKey } from './catalog.js';
import { REPS } from './budget.js';
import { SCHEMES, PALETTES, LIGHTS } from './colors.js';
import { REGION_KINDS } from './regions.js';

export const CAPSIDS = ['polio', 'rhino', 'noro', 'hbv', 'hpv', 'adeno', 'zika', 'hk97'];
const VIRIONS = ['sars2-virion', 'flu-virion'];
const FIBRILS = ['prion-263k', 'prion-rml', 'prp-fibril', 'tau', 'asyn'];
const PROTEINS = ['spike', 'rbd-ace2', 'ha', 'na', 'env', 'hiv-ca', 'ebola', 'rabies', 'measles', 'prp'];
const ALL = [...CAPSIDS, 'tmv', 'hiv-cone', ...VIRIONS, ...FIBRILS, ...PROTEINS];

export const EFFECTS = {
  assemble: { pool: [...CAPSIDS, 'tmv', 'hiv-cone', ...VIRIONS], w: 0.8, d: 1.1 },
  peel: { pool: [...CAPSIDS, 'tmv', 'hiv-cone', ...VIRIONS], w: 1.5, d: 1.05 },
  inside: { pool: ['adeno', 'hk97', 'hpv', 'zika', 'polio', 'rhino', 'noro', 'hbv', 'hiv-cone'], w: 0.9, d: 1.15 },
  explode: { pool: CAPSIDS, w: 0.4, d: 1 },
  implode: { pool: [...CAPSIDS, 'tmv'], w: 0.3, d: 0.95 },
  slice: { pool: ['adeno', 'hiv-cone', 'hbv', 'zika', 'hk97', 'hpv', 'tmv', 'polio'], w: 0.8, d: 1 },
  axes: { pool: CAPSIDS, w: 0.5, d: 1.1 },
  spikes: { pool: VIRIONS, w: 0.4, d: 1 },
  grow: { pool: FIBRILS, w: 0.6, d: 1 },
  morph: { pool: ALL, w: 0.9, d: 1.1 },
  protein: { pool: PROTEINS, w: 0.4, d: 0.9 },
  ladder: { pool: [LADDER_KEYS[0]], w: 0.4, d: 1.3 },
  exview: { pool: [...CAPSIDS, 'hiv-cone', ...VIRIONS], w: 1.6, d: 1.3 },
  inspect: { pool: Object.keys(REGION_KINDS), w: 2.2, d: 1.35 },
};
// The tour chapters: 3 shot kinds on one capsid. 'hold' leaves the shell
// open for the next shot; 'fromEx' starts open and closes at the end.
export const CHAPTERS = [
  [{ kind: 'exview', hold: true }, { kind: 'inspect', fromEx: true }, { kind: 'peel' }],
  [{ kind: 'exview', hold: true }, { kind: 'inspect', fromEx: true }, { kind: 'inside' }],
  [{ kind: 'assemble' }, { kind: 'inspect' }, { kind: 'slice' }],
  [{ kind: 'inspect' }, { kind: 'exview' }, { kind: 'peel' }],
  [{ kind: 'exview' }, { kind: 'inspect' }, { kind: 'morph' }],
];
const TOUR_W = 2.0;
// explode styles: axis set (or 'cap') and stagger, per entry
export const EX_STYLES = { 5: '5-fold axes', 3: '3-fold axes', 2: '2-fold axes', '-1': 'radial lines', cap: 'capsomer by capsomer' };
export const STAGGERS = { distance: 'by distance from the pole', ring: 'ring by ring', copy: 'part by part', type: 'pentamers first, then the rest' };
const capsOf = key => (REGION_KINDS[key] || []).filter(k => k === 'hexamer' || k === 'trimer' || k === 'pentamer6');
export function okEx(key, ex) {
  const look = (entryByKey(key) || {}).look;
  if (look === 'capsid') return ex !== 'cap' || capsOf(key).length > 0;
  if (look === 'cone') return ex === 'cap' || ex === '-1';
  return ex === '-1';
}
export function okStag(ex, st) { return st === 'type' ? ex === 'cap' : true; }
// the region kinds that suit an open shell of this style
export function okRegion(key, kind, ex) {
  if (!(REGION_KINDS[key] || []).includes(kind)) return false;
  if (ex == null) return true;
  if (ex === '5') return kind === 'pentamer' || kind === 'au';
  if (ex === '3') return kind === 'face' || kind === 'au';
  if (ex === 'cap') return kind !== 'face' && kind !== 'au';
  return true;
}
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
  const allRegions = [...new Set(Object.values(REGION_KINDS).flat())];
  const bags = {
    kind: makeBag(r, { ...W(EFFECTS), tour: TOUR_W }), rep: makeBag(r, W_REPS), scheme: makeBag(r, W_SCHEMES),
    pal: makeBag(r, Object.fromEntries(Object.keys(PALETTES).map(k => [k, k === 'atlas' || k === 'goodsell' ? 1.4 : 1]))),
    light: makeBag(r, Object.fromEntries(Object.keys(LIGHTS).map(k => [k, k === 'studio' ? 1.4 : 1]))),
    cam: makeBag(r, Object.fromEntries(CAMS.map(k => [k, 1]))),
    peel: makeBag(r, { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 }),
    ex: makeBag(r, { 5: 1.2, 3: 1, 2: 1, '-1': 0.8 }),
    exv: makeBag(r, { 5: 1.3, 3: 0.9, 2: 0.8, '-1': 0.6, cap: 1.4 }),
    stag: makeBag(r, { distance: 1, ring: 1, copy: 0.8, type: 1.2 }),
    region: makeBag(r, Object.fromEntries(allRegions.map(k => [k, k === 'pentamer' || k === 'hexamer' ? 1.4 : 1]))),
    detail: makeBag(r, { tube: 1.2, space: 1 }),
    dscheme: makeBag(r, { chain: 1, structure: 1 }),
    iso: makeBag(r, { ghost: 1.3, away: 1 }),
    chapter: makeBag(r, Object.fromEntries(CHAPTERS.map((_, i) => [i, 1]))),
    slice: makeBag(r, { half: 1, slab: 1.2 }),
  };
  REPS.forEach(k => { if (W_REPS[k] == null) throw new Error('no weight for view ' + k); });
  SCHEMES.forEach(s => { if (W_SCHEMES[s.id] == null) throw new Error('no weight for scheme ' + s.id); });
  // one shot; cx: { kind, entry, prev (the shot before, in a chapter),
  // hold, fromEx } or null for a free shot
  const shot = (kind, entry, prev, cx = {}) => {
    const E = EFFECTS[kind], cont = !!cx.cont;
    let rep, repTo = null, scheme;
    const sh = { kind, entry, cont, morphAt: r.range(0.32, 0.55) };
    if (kind === 'exview') {
      sh.ex = bags.exv.next(x => okEx(entry, x) && (!cx.hold || x !== '-1' || entryByKey(entry).look !== 'capsid'));
      sh.stag = bags.stag.next(x => okStag(sh.ex, x));
      sh.hold = !!cx.hold;
    }
    if (kind === 'inspect') {
      sh.region = bags.region.next(k => okRegion(entry, k, cx.fromEx ? cx.ex : null));
      if (!okRegion(entry, sh.region, cx.fromEx ? cx.ex : null)) sh.region = (REGION_KINDS[entry] || []).find(k => okRegion(entry, k, cx.fromEx ? cx.ex : null)) || REGION_KINDS[entry][0];
      sh.detail = bags.detail.next();
      sh.dscheme = bags.dscheme.next();
      sh.iso = bags.iso.next();
      sh.fromEx = !!cx.fromEx;
      if (sh.fromEx) { sh.ex = cx.ex; sh.stag = cx.stag; }
    }
    if (cont && prev) {
      // no cut: carry the view and colour of the shot before
      rep = prev.repTo || prev.rep;
      scheme = prev.dscheme && prev.kind === 'inspect' ? prev.dscheme : prev.scheme;
      sh.pal = prev.pal; sh.light = prev.light;
    } else {
      // after a chapter the bags did not draw the carried view and colour
      const last = out[out.length - 1], lastRep = last && (last.repTo || last.rep), lastCol = last && [last.scheme, last.kind === 'inspect' ? last.dscheme : null];
      rep = bags.rep.next(v => okRep(kind, entry, v) && v !== lastRep && (kind !== 'inspect' || v !== sh.detail));
      scheme = bags.scheme.next(x => okScheme(entry, x) && !(lastCol && lastCol.includes(x)));
      sh.pal = bags.pal.next(); sh.light = bags.light.next();
    }
    if (kind === 'inspect') { repTo = sh.detail === rep ? (rep === 'tube' ? 'space' : 'tube') : sh.detail; sh.detail = repTo; sh.morphAt = 0.4; if (sh.dscheme === scheme) sh.dscheme = scheme === 'chain' ? 'structure' : 'chain'; }
    else if (kind === 'morph' || (kind !== 'ladder' && kind !== 'axes' && kind !== 'exview' && r.next() < 0.35)) repTo = bags.rep.next(v => v !== rep && okRep(kind, entry, v));
    Object.assign(sh, {
      rep, repTo, scheme,
      cam: bags.cam.next(c => okCam(kind, c)),
      peel: kind === 'peel' || kind === 'inside' ? +bags.peel.next(p => kind !== 'inside' || p === '0' || p === '3') : null,
      reclose: kind === 'peel' ? r.next() < 0.45 : false,
      ex: sh.ex != null ? sh.ex : kind === 'explode' || kind === 'implode' ? +bags.ex.next(x => entryByKey(entry).look === 'capsid' || x === '-1') : null,
      slice: kind === 'slice' ? bags.slice.next() : null,
      dur: shotSeconds(calm, r.next(), E.d), seed: Math.floor(r.next() * 1e9),
    });
    return sh;
  };
  while (out.length < n) {
    const prev = out[out.length - 1];
    // an effect with one entry (the ladder) waits when that entry just played
    const kind = bags.kind.next(k => k === 'tour' ? !(prev && CHAPTERS.every(c => c[0].kind === prev.kind)) :
      !(prev && (k === prev.kind || (EFFECTS[k].pool.length === 1 && EFFECTS[k].pool[0] === prev.entry))));
    if (kind === 'tour') {
      const ci = +bags.chapter.next(i => !prev || CHAPTERS[i][0].kind !== prev.kind), ch = CHAPTERS[ci];
      // a capsid that every effect of the chapter can show
      const pool = CAPSIDS.filter(k => ch.every(st => EFFECTS[st.kind].pool.includes(k)));
      let entry = r.pick(pool);
      if (prev && prev.entry === entry) entry = pool[(pool.indexOf(entry) + 1) % pool.length];
      let last = null;
      for (const step of ch) {
        if (out.length >= n) break;
        const sh = shot(step.kind, entry, last, { cont: !!last, hold: step.hold, fromEx: step.fromEx && last && last.hold, ex: last && last.ex, stag: last && last.stag });
        sh.chapter = ci;
        out.push(sh); last = sh;
      }
      continue;
    }
    const E = EFFECTS[kind];
    // an inspection needs an entry with a region kind other than the last one
    const lastReg = bags.region.last;
    const pool = kind === 'inspect' ? E.pool.filter(k => REGION_KINDS[k].some(x => x !== lastReg)) : E.pool;
    let entry = r.pick(pool);
    if (prev && prev.entry === entry && pool.length > 1) entry = pool[(pool.indexOf(entry) + 1) % pool.length];
    out.push(shot(kind, entry, null));
  }
  return out;
}
