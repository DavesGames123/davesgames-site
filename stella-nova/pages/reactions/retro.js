// ============================================================================
//  REACTIONS  ·  retro.js — a route from common compounds to a target
// ----------------------------------------------------------------------------
//  No DOM. The Web Worker (retro-worker.js) runs it so the page stays
//  responsive; tests.mjs runs it in node. A teaching model: it knows only
//  the classes of templates.js and the BASICS list, so it finds routes a
//  textbook would show, not what a chemist would choose.
//
//  BACKWARD STEP  For each class, react.js apply(cls, [target, by-products],
//  'rev') undoes the change and gives the reactants. A proposal counts only
//  when the class, run forward on those reactants, gives the target again
//  (this also applies the Markovnikov and ortho/para rules). Reagent
//  patterns come back as their reagent; formal reagents ([O], 2[H]) are
//  free. A declined compound is never a reactant.
//
//  SEARCH  best-first over partial routes. A state holds the molecules
//  still to make; its cost is the steps so far plus, for each open
//  molecule, 1 + 0.02 per heavy atom. The largest open molecule is
//  expanded first. Limits: maxSteps (default 6), maxExpand backward steps
//  (default 2500) and timeMs (default 8000). A route scores its steps plus
//  0.2 per rank point of its starting compounds (BASICS rank 1 bulk .. 3
//  lab reagent), so common starting compounds win a tie.
//
//  findRoutes(G, opt) -> { routes: [{ steps: [{ cls, ins: [{ sp } |
//    { smiles } | { made: step index }], pick }], leaves: [sp | smiles],
//    score }], stats: { expanded, states, ms }, reason }
//  reason: 'blocked: ...' | 'basic' | 'none' | 'limit' | null
//
//  GREP MAP: grep -n 'function backward'  'export function findRoutes'
// ============================================================================
import { CLASSES, BASICS } from './templates.js';
import { apply, key as keyOfG, blockedWhy } from './react.js';
import { graphOf, keyOfSpecies, speciesByKey } from './species.js';
import { smilesOf } from './rxgraph.js';

let OCL = null;
export const setRetroOCL = o => { OCL = o; };
let BASIC = null;
function basics() {
  if (!BASIC) BASIC = new Map(BASICS.map(([k, r]) => [keyOfSpecies(k), { sp: k, rank: r }]));
  return BASIC;
}
const cache = new Map();

// all one-step ways to make the molecule G (key k)
function backward(G, k) {
  if (cache.has(k)) return cache.get(k);
  const out = [], seen = new Set();
  for (const cls of CLASSES) {
    if (cls.kind === 'overall' || cls.retro === false) continue;
    if ((cls.byp || []).length !== cls.rhs.length - 1) continue;
    let res = [];
    try { res = apply(cls, [G, ...cls.byp.map(graphOf)], 'rev', { maxMatches: 40, maxCombos: 80 }); } catch (e) { res = []; }
    for (const r of res) {
      if (r.products.length !== cls.lhs.length) continue;
      const ins = [];
      let ok = true;
      r.products.forEach((p, i) => {
        const role = cls.role[i], pk = keyOfG(p.G);
        if (typeof role === 'string' && role.startsWith('f:')) { ins.push({ formal: role.slice(2) }); return; }
        if (pk === k || blockedWhy(p.G)) ok = false;
        const sp = speciesByKey(pk);
        ins.push({ key: pk, G: p.G, sp, role, heavy: p.G.heavyCount() });
      });
      if (!ok) continue;
      const sig = cls.id + ':' + ins.map(x => x.key || x.formal).join(',');
      if (seen.has(sig)) continue;
      seen.add(sig);
      // forward check: the class run on these reactants gives the target
      const fw = apply(cls, ins.map(x => (x.formal ? graphOf(x.formal) : x.G)), 'fwd', { maxMatches: 60 });
      if (!fw.some(o => keyOfG(o.products[0].G) === k)) continue;
      out.push({ cls: cls.id, ins });
    }
  }
  cache.set(k, out);
  return out;
}

export function findRoutes(G, opt = {}) {
  const maxSteps = opt.maxSteps ?? 6, maxExpand = opt.maxExpand ?? 2500, timeMs = opt.timeMs ?? 8000, maxRoutes = opt.maxRoutes ?? 3;
  const t0 = Date.now(), B = basics(), k0 = keyOfG(G);
  const why = blockedWhy(G);
  if (why) return { routes: [], stats: { expanded: 0, states: 0, ms: 0 }, reason: 'blocked: ' + why };
  if (B.has(k0)) return { routes: [], stats: { expanded: 0, states: 0, ms: 0 }, reason: 'basic' };
  const heavy = new Map([[k0, G.heavyCount()]]), graphs = new Map([[k0, G]]);
  const h = keys => keys.reduce((s, x) => s + 1 + 0.02 * (heavy.get(x) || 0), 0);
  // state: { open: [keys], steps: [{ cls, ins, out }], line: Set of keys
  // on the route (no cycles), g }
  const heap = [{ open: [k0], steps: [], made: new Set([k0]), g: 0, f: h([k0]) }];
  const seen = new Map(), routes = [];
  let expanded = 0, states = 0, limit = false;
  while (heap.length) {
    if (expanded >= maxExpand || Date.now() - t0 > timeMs) { limit = true; break; }
    // pop the cheapest state
    let bi = 0; for (let i = 1; i < heap.length; i++) if (heap[i].f < heap[bi].f) bi = i;
    const st = heap.splice(bi, 1)[0];
    if (!st.open.length) { routes.push(st); if (routes.length >= maxRoutes) break; continue; }
    if (st.steps.length >= maxSteps) continue;
    // expand the largest open molecule
    const m = st.open.slice().sort((a, b) => (heavy.get(b) || 0) - (heavy.get(a) || 0))[0];
    if (!cache.has(m)) expanded++;
    for (const opt2 of backward(graphs.get(m), m)) {
      if (opt2.ins.some(x => x.key && st.made.has(x.key))) continue;
      const open = st.open.filter(x => x !== m);
      for (const x of opt2.ins) {
        if (!x.key || B.has(x.key)) continue;
        heavy.set(x.key, x.heavy); graphs.set(x.key, x.G);
        if (!open.includes(x.key)) open.push(x.key);
      }
      const steps = st.steps.concat([{ cls: opt2.cls, ins: opt2.ins, out: m }]);
      if (steps.length > maxSteps || steps.length + open.length > maxSteps) continue;
      const sig = open.slice().sort().join('|');
      if (seen.has(sig) && seen.get(sig) <= steps.length) continue;
      seen.set(sig, steps.length);
      const made = new Set(st.made); for (const x of opt2.ins) if (x.key) made.add(x.key);
      heap.push({ open, steps, made, g: steps.length, f: steps.length + h(open) });
      states++;
    }
  }
  const out = routes.map(r => routeOut(r, B)).sort((a, b) => a.score - b.score);
  return { routes: out, stats: { expanded, states, ms: Date.now() - t0 }, reason: out.length ? null : limit ? 'limit' : 'none' };
}

// the steps in forward order, with the inputs named for the page
function routeOut(st, B) {
  const steps = st.steps.slice().reverse(), madeAt = new Map();
  const leaves = [];
  let rank = 0;
  const outSteps = steps.map((s, i) => {
    const ins = s.ins.map(x => {
      if (x.formal) return { sp: x.formal };
      if (madeAt.has(x.key)) return { made: madeAt.get(x.key) };
      const b = B.get(x.key);
      if (b) { leaves.push(b.sp); rank += b.rank - 1; return { sp: b.sp }; }
      if (x.sp) { leaves.push(x.sp); return { sp: x.sp }; }
      const smi = smilesOf(OCL, x.G); leaves.push(smi); return { smiles: smi };
    });
    madeAt.set(s.out, i);
    return { cls: s.cls, ins, pick: s.out };
  });
  return { steps: outSteps, leaves, score: outSteps.length + 0.2 * rank };
}
