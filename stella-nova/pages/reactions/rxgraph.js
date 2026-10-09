// ============================================================================
//  REACTIONS  ·  rxgraph.js — molecular graphs with every hydrogen (no DOM)
// ----------------------------------------------------------------------------
//  A Graph holds every atom of one species, hydrogens included, so that a
//  reaction template can move single hydrogen atoms and the 3D animation
//  can follow each atom from reactant to product.
//
//  ATOM ORDER is the order of a chem.js record (molecules/chem.js): the
//  shown atoms first (heavy atoms, and any H that must show, as in H2 or
//  a hydride), then the hidden hydrogens. fromRecord() keeps that order,
//  so graph atom i is record atom i and its 3D position is p3[i].
//  toOCL() writes the same order to an OpenChemLib Molecule, and
//  normalise() sorts a new graph into that order (simple H last).
//
//  Graph fields: N, z (Int16Array), q (Int8Array), ar (aromatic atom
//  flags), bonds [{ a, b, o, ar }] (o is the Kekule order 1, 2, 3),
//  adj[i] = [{ to, k }]. Methods: bondIndex, hCount, inRing, clone.
//
//  GREP MAP
//    grep -n 'export class Graph'          the graph
//    grep -n 'export function fromRecord'  chem.js record -> graph
//    grep -n 'export function fromOCL'     OpenChemLib Molecule -> graph
//    grep -n 'export function toOCL'       graph -> OpenChemLib Molecule
//    grep -n 'export function keyOf'       canonical key (no stereo)
//    grep -n 'export function fragments'   connected parts, ion pairs joined
//    grep -n 'export function valenceOK'   a sanity check after an edit
//    grep -n 'export function hill'        the Hill formula
// ============================================================================
import { decode } from '../molecules/chem.js';

const SYM = ['', 'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca'];
SYM[26] = 'Fe'; SYM[29] = 'Cu'; SYM[30] = 'Zn'; SYM[35] = 'Br'; SYM[46] = 'Pd'; SYM[50] = 'Sn'; SYM[53] = 'I'; SYM[78] = 'Pt';
export const symOf = z => SYM[z] || '?';

export class Graph {
  constructor(N) {
    this.N = N; this.z = new Int16Array(N); this.q = new Int8Array(N); this.ar = new Uint8Array(N);
    this.bonds = []; this.adj = Array.from({ length: N }, () => []);
    this._ring = null;
  }
  addBond(a, b, o, ar = false) {
    const k = this.bonds.length;
    this.bonds.push({ a, b, o, ar: !!ar });
    this.adj[a].push({ to: b, k }); this.adj[b].push({ to: a, k });
    this._ring = null;
    return k;
  }
  bondIndex(a, b) { for (const e of this.adj[a]) if (e.to === b) return e.k; return -1; }
  hCount(a) { let h = 0; for (const e of this.adj[a]) if (this.z[e.to] === 1) h++; return h; }
  // A bond is in a ring when it is not a bridge (Tarjan low-link).
  inRing(a) {
    if (!this._ring) {
      const N = this.N, disc = new Int32Array(N).fill(-1), low = new Int32Array(N), ringB = new Uint8Array(this.bonds.length);
      let t = 0;
      const dfs = (u, pk) => {
        disc[u] = low[u] = t++;
        for (const e of this.adj[u]) {
          if (e.k === pk) continue;
          if (disc[e.to] < 0) { dfs(e.to, e.k); low[u] = Math.min(low[u], low[e.to]); if (low[e.to] <= disc[u]) ringB[e.k] = 1; }
          else { low[u] = Math.min(low[u], disc[e.to]); ringB[e.k] = 1; }
        }
      };
      for (let i = 0; i < N; i++) if (disc[i] < 0) dfs(i, -1);
      const ra = new Uint8Array(N);
      this.bonds.forEach((b, k) => { if (ringB[k]) { ra[b.a] = 1; ra[b.b] = 1; } });
      this._ring = ra;
    }
    return !!this._ring[a];
  }
  heavyCount() { let n = 0; for (let i = 0; i < this.N; i++) if (this.z[i] !== 1) n++; return n; }
  // a simple hydrogen: H, no charge, one bond, to a non-H atom
  simpleH(i) { return this.z[i] === 1 && this.q[i] === 0 && this.adj[i].length === 1 && this.z[this.adj[i][0].to] !== 1; }
  charge() { let s = 0; for (let i = 0; i < this.N; i++) s += this.q[i]; return s; }
}

// ── record -> graph ─────────────────────────────────────────────────────────
export function fromRecord(rec) {
  const M = decode(rec);
  const G = new Graph(M.N);
  for (let i = 0; i < M.N; i++) { G.z[i] = M.z[i]; G.q[i] = M.q[i]; }
  for (const b of M.bonds) G.addBond(b.a, b.b, b.ml ? 1 : b.o || 1, b.ar);
  aromFlags(G);
  return G;
}
function aromFlags(G) {
  G.ar.fill(0);
  for (const b of G.bonds) if (b.ar) { G.ar[b.a] = 1; G.ar[b.b] = 1; }
}

// ── OpenChemLib <-> graph ───────────────────────────────────────────────────
// fromOCL: every hydrogen made explicit, in OpenChemLib's own order (simple
// hydrogens last).
export function fromOCL(OCL, mol) {
  const m = mol.getCompactCopy();
  m.addImplicitHydrogens();
  m.ensureHelperArrays(OCL.Molecule.cHelperRings);
  const N = m.getAllAtoms(), G = new Graph(N);
  for (let i = 0; i < N; i++) { G.z[i] = m.getAtomicNo(i); G.q[i] = m.getAtomCharge(i); }
  for (let k = 0; k < m.getAllBonds(); k++) {
    const t = m.getBondType(k);
    const o = t === OCL.Molecule.cBondTypeMetalLigand ? 1 : m.getBondOrder(k) || 1;
    G.addBond(m.getBondAtom(0, k), m.getBondAtom(1, k), o, m.isAromaticBond(k));
  }
  aromFlags(G);
  return G;
}
export function toOCL(OCL, G) {
  const M = OCL.Molecule, m = new M(G.N, G.bonds.length);
  for (let i = 0; i < G.N; i++) { m.addAtom(G.z[i]); if (G.q[i]) m.setAtomCharge(i, G.q[i]); }
  const T = [0, M.cBondTypeSingle, M.cBondTypeDouble, M.cBondTypeTriple];
  for (const b of G.bonds) { const k = m.addBond(b.a, b.b); m.setBondType(k, T[b.o] || M.cBondTypeSingle); }
  // an atom with no implicit H: keep it so (a lone [O] stays an O atom)
  return m;
}
// Canonical key: the OpenChemLib ID code of the structure without stereo.
// Explicit hydrogens do not change an ID code.
export function keyOf(OCL, G) {
  const m = toOCL(OCL, G);
  m.stripStereoInformation();
  return m.getIDCode();
}
export function smilesOf(OCL, G) {
  const m = toOCL(OCL, G);
  m.removeExplicitHydrogens();
  return m.toSmiles();
}

// ── order ───────────────────────────────────────────────────────────────────
// Shown atoms first, simple hydrogens last; each block keeps its order.
// Returns { G, perm } with perm[new] = old.
export function normalise(G) {
  const heavy = [], hs = [];
  for (let i = 0; i < G.N; i++) (G.simpleH(i) ? hs : heavy).push(i);
  const perm = heavy.concat(hs), inv = new Int32Array(G.N);
  perm.forEach((o, n) => { inv[o] = n; });
  const H = new Graph(G.N);
  perm.forEach((o, n) => { H.z[n] = G.z[o]; H.q[n] = G.q[o]; });
  for (const b of G.bonds) H.addBond(inv[b.a], inv[b.b], b.o, b.ar);
  aromFlags(H);
  return { G: H, perm };
}

// ── parts ───────────────────────────────────────────────────────────────────
// Connected parts; then ions join into neutral sets (an ion pair stays one
// species, as NaCl or CH3COO- Na+). Returns arrays of atom indices.
export function fragments(G) {
  const comp = new Int32Array(G.N).fill(-1), parts = [];
  for (let s = 0; s < G.N; s++) {
    if (comp[s] >= 0) continue;
    const list = [s]; comp[s] = parts.length;
    for (let i = 0; i < list.length; i++) for (const e of G.adj[list[i]]) if (comp[e.to] < 0) { comp[e.to] = parts.length; list.push(e.to); }
    parts.push(list.sort((a, b) => a - b));
  }
  return parts;
}
export function pairIons(G, parts) {
  const ch = parts.map(p => p.reduce((s, i) => s + G.q[i], 0));
  const out = [], done = new Uint8Array(parts.length);
  for (let i = 0; i < parts.length; i++) {
    if (done[i]) continue;
    done[i] = 1;
    let atoms = parts[i].slice(), c = ch[i];
    for (let j = i + 1; j < parts.length && c !== 0; j++) {
      if (done[j] || Math.sign(ch[j]) !== -Math.sign(c)) continue;
      done[j] = 1; atoms = atoms.concat(parts[j]); c += ch[j];
    }
    out.push(atoms.sort((a, b) => a - b));
  }
  return out;
}
// The sub-graph of the atoms (in the given order). Returns { G, perm }.
export function subGraph(G, atoms) {
  const inv = new Map(atoms.map((a, i) => [a, i])), H = new Graph(atoms.length);
  atoms.forEach((a, i) => { H.z[i] = G.z[a]; H.q[i] = G.q[a]; });
  for (const b of G.bonds) if (inv.has(b.a) && inv.has(b.b)) H.addBond(inv.get(b.a), inv.get(b.b), b.o, b.ar);
  aromFlags(H);
  return { G: H, perm: atoms.slice() };
}
// Disjoint union. Returns { G, off } (off[k] = first atom of graph k).
export function union(list) {
  const N = list.reduce((s, g) => s + g.N, 0), U = new Graph(N), off = [];
  let o = 0;
  for (const g of list) {
    off.push(o);
    for (let i = 0; i < g.N; i++) { U.z[o + i] = g.z[i]; U.q[o + i] = g.q[i]; }
    for (const b of g.bonds) U.addBond(o + b.a, o + b.b, b.o, b.ar);
    o += g.N;
  }
  aromFlags(U);
  return { G: U, off };
}

// ── checks ──────────────────────────────────────────────────────────────────
// Bond-order sum allowed for an element at a charge.
const VAL = {
  1: [1], 5: [3], 6: [4], 7: [3], 8: [2], 9: [1], 15: [3, 5], 16: [2, 4, 6], 17: [1], 35: [1], 53: [1], 12: [2], 11: [1], 19: [1], 3: [1], 13: [3], 14: [4],
};
export function valenceOK(G, atoms = null) {
  const list = atoms || Array.from({ length: G.N }, (_, i) => i);
  for (const i of list) {
    const z = G.z[i], q = G.q[i];
    let s = 0; for (const e of G.adj[i]) s += G.bonds[e.k].o;
    let allowed = VAL[z]; if (!allowed) continue;
    if (z === 7 && q === 1) allowed = [4];
    else if (z === 7 && q === -1) allowed = [2];
    else if (z === 8 && q === 1) allowed = [3];
    else if (z === 8 && q === -1) allowed = [1];
    else if (z === 6 && q !== 0) allowed = [3];
    else if ((z === 11 || z === 19 || z === 3) && q === 1) allowed = [0];
    else if (z === 1 && q !== 0) allowed = [0];
    else if ((z === 17 || z === 35 || z === 53 || z === 9) && q === -1) allowed = [0];
    else if (z === 12 && q === 2) allowed = [0];
    else if (q !== 0) continue;
    // under-valence is allowed only for a lone formal atom ([O], [H])
    if (s > Math.max(...allowed)) return false;
    if (!allowed.includes(s) && G.adj[i].length > 0) return false;
  }
  return true;
}

// ── formula ─────────────────────────────────────────────────────────────────
export function counts(G) {
  const c = {};
  for (let i = 0; i < G.N; i++) { const s = symOf(G.z[i]); c[s] = (c[s] || 0) + 1; }
  return c;
}
export function hill(G) {
  const c = counts(G), keys = Object.keys(c).sort();
  const order = c.C ? ['C', ...(c.H ? ['H'] : []), ...keys.filter(k => k !== 'C' && k !== 'H')] : keys;
  let f = order.map(k => k + (c[k] > 1 ? c[k] : '')).join('');
  const q = G.charge();
  if (q) f += (Math.abs(q) > 1 ? Math.abs(q) : '') + (q > 0 ? '+' : '-');
  return f;
}
