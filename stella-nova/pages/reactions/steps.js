// ============================================================================
//  REACTIONS  ·  steps.js — a reaction step with records, names and TeX
// ----------------------------------------------------------------------------
//  No DOM. The page, the saver and tests.mjs use it; it needs OpenChemLib
//  (the product records get a 2D layout and a 3D conformer).
//
//  A NODE is one molecule: { rec, G, key, name, ce, sp } where G is in the
//  atom order of rec (rxgraph.js), key the stereo-free ID code, sp the
//  species key of templates.js or null.
//  nodeOfSpecies(k)          a node from data/species.json
//  nodeOfGraph(OCL, G)       a node for a new product (productRecord)
//  runStep(OCL, cls, nodes, pick) -> STEP or null:
//    { cls, inputs: [node], products: [node + origin], off, names, tex,
//      coef: [{ node, n }] (lhs terms), outs: [{ node, n }] (rhs terms) }
//    pick: the key of the wanted main product, else the first outcome.
//  outcomesFor(OCL, cls, nodes) -> every forward outcome (react.js apply),
//    for the builder preview.
//
//  GREP MAP: grep -n 'export function runStep'  'function texOf'
// ============================================================================
import { apply, applyOverall, combustionOf, equationTeX, key as keyOfG } from './react.js';
import { CLASS, SPECIES } from './templates.js';
import { graphOf, recordOf, keyOfSpecies, ceOf, speciesByKey, nameOf, productRecord } from './species.js';
import { hill } from './rxgraph.js';

export function nodeOfSpecies(k) {
  const rec = recordOf(k);
  return { rec, G: graphOf(k), key: keyOfSpecies(k), name: SPECIES[k][1], ce: ceOf(k), sp: k };
}
const cache = new Map();
export function nodeOfGraph(OCL, G, key) {
  key = key || keyOfG(G);
  const sp = speciesByKey(key);
  const name = nameOf(key) || 'Product ' + hill(G);
  const { rec, G: G2, perm } = productRecord(OCL, G, { n: name, d: '' });
  return { rec, G: G2, key, name, ce: sp ? ceOf(sp) : hill(G2).replace(/[+-]\d*$/, ''), sp, perm };
}

export function outcomesFor(OCL, cls, nodes) {
  if (cls.kind === 'overall') {
    const o = overallOutcome(cls, nodes);
    return o ? [o] : [];
  }
  return apply(cls, nodes.map(n => n.G));
}
function overallOutcome(cls, nodes) {
  if (cls.fuel) {
    const c = combustionOf(nodes[0].G); if (!c) return null;
    const o = applyOverall(cls, [[nodes[0].G, c.fuel], [graphOf('o2'), c.o2]], [[graphOf('co2'), c.co2], [graphOf('water'), c.h2o]]);
    o.coefIn = [c.fuel, c.o2]; o.extraIn = ['o2']; o.coefOut = [c.co2, c.h2o];
    return o;
  }
  const o = applyOverall(cls, cls.lhsQ.map(([k, q]) => [graphOf(k), q]), cls.rhsQ.map(([k, q]) => [graphOf(k), q]));
  o.coefIn = cls.lhsQ.map(x => x[1]); o.coefOut = cls.rhsQ.map(x => x[1]);
  return o;
}

export function runStep(OCL, cls, nodes, pick = null) {
  cls = typeof cls === 'string' ? CLASS[cls] : cls;
  const outs = outcomesFor(OCL, cls, nodes);
  if (!outs.length) return null;
  const o = (pick && outs.find(x => keyOfG(x.products[0].G) === pick)) || outs[0];
  // the input nodes, one per input graph (copies for an overall equation)
  let inputs;
  if (cls.kind === 'overall') {
    const species = cls.fuel ? [nodes[0], nodeOfSpecies('o2')] : cls.lhsQ.map(([k]) => nodeOfSpecies(k));
    const q = o.coefIn; inputs = [];
    species.forEach((n, s) => { for (let i = 0; i < q[s]; i++) inputs.push(n); });
  } else inputs = nodes;
  // the product nodes; a species product (water, NaBr) shares one record
  const products = o.products.map(p => {
    const nd = nodeOfGraph(OCL, p.G);
    return Object.assign(nd, { origin: Int32Array.from(nd.perm, j => p.origin[j]) });
  });
  const step = { cls: cls.id, inputs, products, off: o.off, names: products.map(p => p.name) };
  texOf(step, cls);
  return step;
}

// lhs and rhs terms (identical species summed) and the mhchem equation;
// a formal reagent shows as [O] or 2[H]
function texOf(step, cls) {
  const left = [], right = [];
  const addT = (list, node, ce, n) => { const t = list.find(x => x.key === node.key && x.ce === ce); if (t) t.n += n; else list.push({ key: node.key, node, ce, n }); };
  step.inputs.forEach((nd, i) => {
    const r = cls.role ? cls.role[i] : null;
    if (typeof r === 'string' && r.startsWith('f:')) { if (r === 'f:h2') addT(left, nd, '[H]', 2); else addT(left, nd, '[O]', 1); }
    else addT(left, nd, nd.ce, 1);
  });
  step.products.forEach(nd => addT(right, nd, nd.ce, 1));
  step.left = left; step.right = right;
  step.tex = equationTeX(cls, left, right);
  step.formal = step.inputs.map((nd, i) => !!(cls.role && typeof cls.role[i] === 'string' && cls.role[i].startsWith('f:')));
  return step;
}
