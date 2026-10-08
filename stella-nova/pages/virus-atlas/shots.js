// ============================================================================
//  VIRUS ATLAS  ·  shots.js — the screensaver plan (no DOM)
// ----------------------------------------------------------------------------
//  plan(seed, calm, n) gives n shots: { kind, entry, dur, seed }. The kinds
//  play in a seeded shuffle (a bag of every kind, then a new bag), each
//  with an entry picked from its pool. No shot repeats back to back. A
//  shot lasts 5 to 12 s (symmetry.js shotSeconds; calm 1 gives the long
//  end). saver.js plays the plan; tests.mjs checks it.
//
//  SHOTS  kind -> { pool, weight, title }
//    assemble  a capsid, rod or cone builds itself from its subunits
//    peel      the near half of a capsid lifts off, subunit by subunit
//    explode   a capsid opens along its 5-fold axes and closes again
//    axes      the camera looks down a 5-fold, a 3-fold, then a 2-fold axis
//    spikes    a push-in on one spike of an enveloped virion; spikes sway
//    grow      a prion or amyloid fibril grows at both ends
//    slice     a clipping plane sweeps through a large particle
//    protein   one protein turns, with a push-in on its top
//    ladder    the scale ladder: a zoom out from one protein to a 300 nm rod
//
//  grep -n targets: "export const SHOTS", "export function plan"
// ============================================================================
import { makeRng, shotSeconds } from './symmetry.js';
import { LADDER_KEYS } from './catalog.js';

const CAPSIDS = ['polio', 'rhino', 'noro', 'hbv', 'hpv', 'adeno', 'zika', 'hk97'];
export const SHOTS = {
  assemble: { pool: [...CAPSIDS, 'tmv', 'hiv-cone'], weight: 1.15 },
  peel: { pool: CAPSIDS, weight: 1 },
  explode: { pool: CAPSIDS, weight: 1 },
  axes: { pool: CAPSIDS, weight: 1.1 },
  spikes: { pool: ['sars2-virion', 'flu-virion'], weight: 1 },
  grow: { pool: ['prion-263k', 'prion-rml', 'prp-fibril', 'tau', 'asyn'], weight: 1 },
  slice: { pool: ['adeno', 'hiv-cone', 'hbv', 'zika', 'hk97'], weight: 1 },
  protein: { pool: ['spike', 'rbd-ace2', 'ha', 'na', 'env', 'hiv-ca', 'ebola', 'rabies', 'measles', 'prp'], weight: 0.9 },
  ladder: { pool: [LADDER_KEYS[0]], weight: 1.3 },
};

export function plan(seed, calm, n) {
  const r = makeRng(seed), kinds = Object.keys(SHOTS), out = [];
  let bag = [];
  while (out.length < n) {
    if (!bag.length) bag = r.shuffle(kinds);
    const kind = bag.shift(), pool = SHOTS[kind].pool;
    let entry = r.pick(pool);
    const prev = out[out.length - 1];
    if (prev && prev.kind === kind) { bag.push(kind); if (bag.length === 1) bag = r.shuffle(kinds).filter(k => k !== kind).concat(bag); continue; }
    if (prev && prev.entry === entry && pool.length > 1) entry = pool[(pool.indexOf(entry) + 1) % pool.length];
    out.push({ kind, entry, dur: shotSeconds(calm, r.next(), SHOTS[kind].weight), seed: Math.floor(r.next() * 1e9) });
  }
  return out;
}
