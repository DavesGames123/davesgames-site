// ============================================================================
//  REACTIONS  ·  species.js — species records, graphs, names (no DOM)
// ----------------------------------------------------------------------------
//  data/species.json (build/build.mjs) holds a chem.js record for each
//  SPECIES key of templates.js, and a name index of the Molecule Explorer
//  library (stereo-free OpenChemLib ID code -> [id, name]). Records come
//  from that library when it has the compound (PubChem 3D conformer), else
//  from an OpenChemLib conformer.
//
//  useData(json)          install the loaded file
//  recordOf(k), graphOf(k), keyOfSpecies(k), ceOf(k), nameOfSpecies(k)
//  speciesByKey(idcode)   the species key of a structure, or null
//  nameOf(idcode)         a species or library name, or null
//  productRecord(OCL, G, meta) -> { rec, G, perm }  a new record for a
//      product graph; G is put in the record's atom order first (perm[j]
//      = old atom of new atom j), so record atom j is graph atom j.
//
//  GREP MAP: grep -n 'export function productRecord'
// ============================================================================
import { SPECIES } from './templates.js';
import { fromRecord, toOCL, Graph } from './rxgraph.js';
import { recordFrom } from '../molecules/engine.js';

const D = { recs: {}, keys: {}, byKey: new Map(), names: new Map(), graphs: new Map() };
export function useData(j) {
  D.recs = j.species; D.keys = j.keys;
  D.byKey = new Map(Object.entries(j.keys).map(([k, id]) => [id, k]));
  D.names = new Map(j.names);
  D.graphs.clear();
}
export const recordOf = k => D.recs[k] || null;
export function graphOf(k) {
  if (!D.graphs.has(k)) { const r = D.recs[k]; if (!r) throw new Error('no species ' + k); D.graphs.set(k, fromRecord(r)); }
  return D.graphs.get(k);
}
export const keyOfSpecies = k => D.keys[k];
export const ceOf = k => (SPECIES[k] ? SPECIES[k][2] : k);
export const nameOfSpecies = k => (SPECIES[k] ? SPECIES[k][1] : k);
export const speciesByKey = id => D.byKey.get(id) || null;
export function nameOf(id) {
  const s = D.byKey.get(id);
  if (s) return SPECIES[s][1];
  const l = D.names.get(id);
  return l ? l[1] : null;
}
export const libIdOf = id => { const l = D.names.get(id); return l ? l[0] : null; };

export function productRecord(OCL, G, meta = {}) {
  let m = toOCL(OCL, G);
  const map = m.getHandleHydrogenMap ? Array.from(m.getHandleHydrogenMap()) : null;
  let perm = Array.from({ length: G.N }, (_, i) => i);
  if (map && map.some((v, i) => v !== i)) {
    perm = new Array(G.N); map.forEach((nw, old) => { perm[nw] = old; });
    G = permute(G, perm);
    m = toOCL(OCL, G);
  }
  const rec = recordFrom(OCL, m, { keepInput: true, meta });
  // the record must hold the graph's atoms in the graph's order
  const sh = rec.a.split(' '), hp = rec.h || [];
  if (sh.length + hp.length !== G.N) throw new Error('record atom count differs');
  for (let i = sh.length; i < G.N; i++) {
    const nb = G.adj[i];
    if (G.z[i] !== 1 || nb.length !== 1 || nb[0].to !== hp[i - sh.length]) throw new Error('record hydrogen order differs at ' + i);
  }
  return { rec, G, perm };
}
export function permute(G, perm) {
  const inv = new Int32Array(G.N); perm.forEach((o, n) => { inv[o] = n; });
  const H = new Graph(G.N);
  perm.forEach((o, n) => { H.z[n] = G.z[o]; H.q[n] = G.q[o]; H.ar[n] = G.ar[o]; });
  for (const b of G.bonds) H.addBond(inv[b.a], inv[b.b], b.o, b.ar);
  return H;
}
