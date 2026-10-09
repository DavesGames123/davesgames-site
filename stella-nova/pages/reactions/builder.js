// ============================================================================
//  REACTIONS  ·  builder.js — build your own reaction sequence
// ----------------------------------------------------------------------------
//  MODEL (no DOM; tests.mjs runs it)
//    new Builder(OCL)       an empty surface: a synth.js SYNTH and an op log
//    b.add(node)            put a molecule on the surface (a leaf)
//    b.options(ids)         the classes that can run on the selected
//                           molecules: the selected fill the 'sub' patterns
//                           (one molecule may fill two, as in an aldol);
//                           reagents fill in by default. Each option lists
//                           its outcomes (regio-isomers) with names. An
//                           outcome with a declined product is held back.
//    b.apply(opt, k)        run outcome k; the product joins the surface
//    b.undo()  b.clear()    b.encode() / Builder.decode(OCL, text, nodeOf)
//  The op log is the share link: #b=<base64url JSON of the ops>. decode
//  replays the ops, so a link rebuilds the same tree.
//
//  UI (BuilderUI): the right-hand surface. Search the species list and the
//  Molecule Explorer library, or type a SMILES string; tap molecules to
//  select them; tap an option to run it. The centre tree shows the build.
//
//  GREP MAP: grep -n 'options(ids'  'apply(opt'  'class BuilderUI'
// ============================================================================
import { CLASSES, CLASS, SPECIES } from './templates.js';
import { emptySynth, addLeaf, addStep } from './synth.js';
import { outcomesFor, nodeOfSpecies } from './steps.js';
import { key as keyOfG, blockedWhy } from './react.js';
import { nameOf } from './species.js';
import { hill } from './rxgraph.js';

const snap = S => ({ nodes: S.nodes.map(n => Object.assign({}, n)), steps: S.steps.slice(), root: S.root });

export class Builder {
  constructor(OCL) { this.OCL = OCL; this.clear(); }
  clear() { this.S = emptySynth(); this.S.name = 'Your synthesis'; this.ops = []; this.hist = []; }
  push() { this.hist.push({ s: snap(this.S), ops: this.ops.slice() }); }
  undo() {
    const h = this.hist.pop(); if (!h) return false;
    Object.assign(this.S, h.s); this.ops = h.ops;
    return true;
  }
  add(node, op) {
    this.push();
    const id = addLeaf(this.S, node);
    this.S.root = id;
    this.ops.push(op || ['a', node.sp || 'smi:' + (node.rec.s || '')]);
    return id;
  }
  // free molecules: on the surface, not yet used by a step
  free() { return this.S.nodes.filter(n => n.used < 0).map(n => n.id); }
  options(ids) {
    const out = [];
    for (const cls of CLASSES) {
      if (cls.kind === 'overall' && !cls.fuel) continue;
      const subs = cls.kind === 'overall' ? [0] : cls.role.map((r, i) => (r === 'sub' ? i : -1)).filter(i => i >= 0);
      const fills = [];
      if (ids.length === subs.length) permutations(ids).forEach(p => fills.push(p));
      else if (ids.length === 1 && subs.length === 2) fills.push([ids[0], ids[0]]);
      for (const f of fills) {
        const ins = cls.kind === 'overall' ? [f[0]] : cls.role.map((r, i) => (r === 'sub' ? f[subs.indexOf(i)] : r.replace(/^f:/, '')));
        const mols = ins.map(x => (typeof x === 'number' ? this.S.nodes[x].mol : nodeOfSpecies(x)));
        let outs = [];
        try { outs = outcomesFor(this.OCL, cls, mols); } catch (e) { outs = []; }
        if (!outs.length) continue;
        const items = outs.slice(0, 4).map((o, k) => {
          const names = o.products.map(p => { const kk = keyOfG(p.G); return nameOf(kk) || hill(p.G); });
          const why = o.products.map(p => blockedWhy(p.G)).find(Boolean) || null;
          return { k, names, main: names[0], key: keyOfG(o.products[0].G), why };
        });
        // the same products from another order of the same molecules: once
        const sig = cls.id + '|' + items.map(i => i.key).sort().join(',');
        if (out.some(o => o.sig === sig)) continue;
        out.push({ cls: cls.id, name: cls.name, ins, items, sig });
      }
    }
    return out;
  }
  apply(opt, k = 0) {
    const it = opt.items[k];
    if (!it || it.why) return -1;
    this.push();
    const id = addStep(this.S, this.OCL, CLASS[opt.cls], opt.ins, it.key);
    if (id < 0) { this.hist.pop(); return -1; }
    this.ops.push(['s', opt.cls, opt.ins, it.key]);
    return id;
  }
  encode() {
    const j = JSON.stringify(this.ops.map(o => (o[0] === 's' ? ['s', o[1], o[2], o[3]] : o)));
    return btoa(unescape(encodeURIComponent(j))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  static decode(OCL, text, nodeOf) {
    const b = new Builder(OCL);
    const j = JSON.parse(decodeURIComponent(escape(atob(text.replace(/-/g, '+').replace(/_/g, '/')))));
    for (const o of j) {
      if (o[0] === 'a') { const n = nodeOf(o[1]); if (n) b.add(n, o); }
      else if (o[0] === 's') {
        b.push();
        const id = addStep(b.S, OCL, CLASS[o[1]], o[2], o[3]);
        if (id < 0) { b.hist.pop(); break; }
        b.ops.push(o);
      }
    }
    b.hist = [];
    return b;
  }
}
function permutations(a) {
  if (a.length <= 1) return [a.slice()];
  const out = [];
  a.forEach((x, i) => { for (const p of permutations(a.filter((_, j) => j !== i))) out.push([x, ...p]); });
  return out;
}
// species for the quick chips and the search
export const QUICK = ['water', 'ethanol', 'aceticacid', 'ethylene', 'propene', 'benzene', 'phenol', 'acetone', 'benzaldehyde', 'etbr', 'butadiene', 'methane'];
export function speciesSearch(q, n = 12) {
  q = q.trim().toLowerCase(); if (!q) return [];
  const hits = [];
  for (const [k, [smi, name, ce]] of Object.entries(SPECIES)) {
    if (k === 'oform') continue;
    const nm = name.toLowerCase();
    const s = nm === q ? 100 : nm.startsWith(q) ? 80 : nm.includes(q) ? 50 : ce.toLowerCase() === q ? 90 : 0;
    if (s) hits.push([s, k]);
  }
  return hits.sort((a, b) => b[0] - a[0]).slice(0, n).map(h => h[1]);
}
