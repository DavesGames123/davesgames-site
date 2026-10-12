// ============================================================================
//  VIRUS ATLAS  ·  shots.js — the screensaver plan (no DOM)
// ----------------------------------------------------------------------------
//  The saver builds a virus, looks at it, takes it apart, and goes on to
//  the next virus. plan(seed, calm, n) gives n beats of 5 to 12 s, three
//  beats per virus (a cycle):
//    build    the parts fly in from nothing along the 5-, 3- or 2-fold
//             axes, radial lines, or capsomer by capsomer, in a stagger
//             that shows the structure (from the pole, ring by ring, or
//             pentamers first); the camera closes in as the shell closes
//    inspect  one region (a pentamer, hexamer, hexon face, rod section,
//             spike ...) lifts out, the rest fades, the camera pushes in
//             and turns; the region may morph to the backbone tube
//    axes     (icosahedral capsids, 30 %) glowing 5-, 3- and 2-fold axes;
//             the camera looks down a 5-fold axis, then turns to a 3-fold
//    apart    the parts fly out along other axes and shrink to nothing,
//             so the next virus loads on an empty screen
//  order(r, n)  the viruses: a seeded shuffle of all 12 (saver-look.js
//    VIRUSES), no repeat until every one has played, and a neighbour of
//    another size (30 % or more) or another kind where the pool allows.
//  A cycle keeps one look (saver-look.js LOOKS) and never the look of the
//  cycle before.
//
//  grep -n targets: "export function makeBag", "export function order",
//    "export function plan", "export const BEAT_W", "export const EX_STYLES"
// ============================================================================
import { makeRng, shotSeconds } from './symmetry.js';
import { entryByKey } from './catalog.js';
import { REGION_KINDS } from './regions.js';
import { VIRUSES, VIRUS_KEYS, LOOKS, okLook } from './saver-look.js';

export const EX_STYLES = { 5: '5-fold axes', 3: '3-fold axes', 2: '2-fold axes', '-1': 'radial lines', cap: 'capsomer by capsomer' };
export const STAGGERS = { distance: 'from one pole to the other', ring: 'ring by ring', type: 'pentamers first, then the rest' };
// duration weights (symmetry.js shotSeconds; every beat is 5..12 s)
export const BEAT_W = { build: 1.3, inspect: 1.45, axes: 1.15, apart: 1.0 };

// A weighted bag: each key goes in max(1, round(2 w)) times, shuffled.
// next(ok) takes the first key that is not the last key drawn and passes
// ok(); an empty bag refills.
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

const kindOf = k => (entryByKey(k) || {}).look;
// the icosahedral capsids of the tour (tests.mjs section 19 walks them)
export const CAPSIDS = VIRUS_KEYS.filter(k => kindOf(k) === 'capsid');
const contrast = (a, b) => !b || kindOf(a) !== kindOf(b) || Math.max(VIRUSES[a].d, VIRUSES[b].d) / Math.min(VIRUSES[a].d, VIRUSES[b].d) >= 1.3;
export function order(r, n) {
  const out = [];
  let pool = [];
  while (out.length < n) {
    if (!pool.length) pool = r.shuffle(VIRUS_KEYS.slice());
    const last = out[out.length - 1];
    let i = pool.findIndex(k => k !== last && contrast(k, last));
    if (i < 0) i = pool.findIndex(k => k !== last);
    if (i < 0) { pool = r.shuffle(VIRUS_KEYS.slice()); continue; }
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}
const STAG_OK = (ex, st) => st === 'type' ? ex === 'cap' : true;

export function plan(seed, calm, n) {
  const r = makeRng(seed), out = [];
  const keys = order(r, Math.ceil(n / 3) + 1);
  let lastLook = null;
  for (let c = 0; out.length < n; c++) {
    const key = keys[c], V = VIRUSES[key], look = kindOf(key);
    const icosa = look === 'capsid';
    const looks = LOOKS.filter(l => okLook(key, l) && l.id !== lastLook);
    const lk = r.pick(looks.length ? looks : LOOKS).id;
    lastLook = lk;
    const ex = String(r.pick(V.build));
    const stags = (look === 'capsid' || look === 'cone') ? Object.keys(STAGGERS).filter(s => STAG_OK(ex, s)) : ['distance'];
    const stag = ex === 'cap' && stags.includes('type') && r.next() < 0.6 ? 'type' : r.pick(stags);
    const apartEx = String(r.pick(V.apart.map(String).filter(x => x !== ex).length ? V.apart.map(String).filter(x => x !== ex) : V.apart.map(String)));
    const apartStag = r.pick(stags.filter(s => s !== stag && STAG_OK(apartEx, s)).concat(['distance']));
    const regions = V.mid.filter(k => (REGION_KINDS[key] || []).includes(k));
    const mid = icosa && r.next() < 0.3 ? 'axes' : 'inspect';
    const base = { entry: key, cycle: c, look: lk };
    const beat = (kind, o) => ({ ...base, kind, dur: shotSeconds(calm, r.next(), BEAT_W[kind]), seed: Math.floor(r.next() * 1e9), ...o });
    out.push(beat('build', { ex, stag }));
    out.push(mid === 'axes' ? beat('axes', {}) : beat('inspect', { region: r.pick(regions), detail: r.next() < 0.5 ? 'tube' : null }));
    out.push(beat('apart', { ex: apartEx, stag: apartStag }));
  }
  return out.slice(0, n);
}
