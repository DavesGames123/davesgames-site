// ============================================================================
//  REACTIONS  ·  react.js — apply a reaction class to graphs (no DOM)
// ----------------------------------------------------------------------------
//  apply(cls, inputs, dir) runs one class of templates.js on molecule
//  graphs (rxgraph.js). dir 'fwd' matches the lhs patterns, one per input,
//  and makes the rhs; dir 'rev' matches the rhs patterns (the target and
//  the by-products) and makes the lhs, for the backward search.
//  The edit only moves bonds and charges between mapped atoms, so every
//  atom of the inputs is in exactly one product: mass balances by build.
//
//  OUTCOME { cls, inputs: [Graph], off: [first atom of input k in the
//    union], products: [{ G, origin: Int32Array (union atom of each
//    product atom), comp }], key: product keys joined }
//  products[0] is the main product (rhs[0] forward, lhs[0] backward).
//
//  applyOverall(cls, lhs [[G, coef]], rhs [[G, coef]]) pairs the atoms of
//  an overall equation (combustion, fermentation, Haber) by element,
//  keeping bonds where it can: copies of each species, one per coefficient.
//  combustionOf(G) gives the coefficients for a C, H, O fuel.
//
//  GREP MAP
//    grep -n 'export function compile'        templates -> patterns
//    grep -n 'export function apply('         one class on inputs
//    grep -n 'function easOK'                 ortho/para and meta rules
//    grep -n 'export function applyOverall'   an overall equation
//    grep -n 'export function combustionOf'   the fuel coefficients
//    grep -n 'export function blockedWhy'     the declined-target check
//    grep -n 'export function equationTeX'    the mhchem equation
// ============================================================================
import { parsePattern, matchPattern, bondOrderOf } from './smarts.js';
import { Graph, union, fragments, pairIons, subGraph, normalise, valenceOK, keyOf, counts, hill } from './rxgraph.js';
import { BLOCK } from './templates.js';

let OCL = null;
export const setOCL = o => { OCL = o; };
export const key = G => keyOf(OCL, G);

// ── compile ─────────────────────────────────────────────────────────────────
export function compile(cls) {
  if (cls._c) return cls._c;
  const L = cls.lhs.map(parsePattern), R = cls.rhs.map(parsePattern);
  const side = P => {
    const at = new Map(), bonds = new Map();
    P.forEach((p, c) => p.atoms.forEach((a, i) => {
      if (!a.map) throw new Error(cls.id + ': unmapped atom ' + a.src);
      if (at.has(a.map)) throw new Error(cls.id + ': map ' + a.map + ' twice');
      at.set(a.map, { c, i, a });
    }));
    P.forEach((p, c) => p.bonds.forEach(b => {
      const m1 = p.atoms[b.a].map, m2 = p.atoms[b.b].map;
      bonds.set(m1 < m2 ? m1 + ',' + m2 : m2 + ',' + m1, b.sym);
    }));
    return { P, at, bonds };
  };
  const l = side(L), r = side(R);
  for (const m of l.at.keys()) if (!r.at.has(m)) throw new Error(cls.id + ': map ' + m + ' only on the left');
  for (const m of r.at.keys()) if (!l.at.has(m)) throw new Error(cls.id + ': map ' + m + ' only on the right');
  const pairs = new Set([...l.bonds.keys(), ...r.bonds.keys()]);
  return (cls._c = { l, r, pairs: [...pairs].map(s => s.split(',').map(Number)), maps: [...l.at.keys()] });
}

// ── apply ───────────────────────────────────────────────────────────────────
export function apply(cls, inputs, dir = 'fwd', opt = {}) {
  const T = compile(cls);
  const Q = dir === 'fwd' ? T.l : T.r, Rs = dir === 'fwd' ? T.r : T.l;
  if (inputs.length !== Q.P.length) return [];
  const maxM = opt.maxMatches || 120;
  // matches per input, deduplicated by their heavy atoms
  const per = Q.P.map((p, k) => {
    const seen = new Set(), out = [];
    for (const m of matchPattern(p, inputs[k], maxM * 4)) {
      const hk = p.atoms.map((a, i) => (a.plainH ? '' : m[i])).join(',');
      if (seen.has(hk)) continue;
      seen.add(hk); out.push(m);
      if (out.length >= maxM) break;
    }
    return out;
  });
  if (per.some(x => !x.length)) return [];
  const { G: U, off } = union(inputs);
  const results = [], keys = new Set();
  const combo = new Array(per.length).fill(0);
  let guard = 0;
  for (;;) {
    if (++guard > (opt.maxCombos || 600)) break;
    const r = tryCombo(cls, T, Q, Rs, U, off, per.map((x, k) => x[combo[k]]), dir, inputs);
    if (r) {
      const k = r.products.map(p => key(p.G)).join('|');
      if (!keys.has(k)) { keys.add(k); r.key = k; results.push(r); }
    }
    let k = 0;
    while (k < combo.length && ++combo[k] >= per[k].length) { combo[k] = 0; k++; }
    if (k === combo.length) break;
  }
  return results;
}

function tryCombo(cls, T, Q, Rs, U, off, matches, dir, inputs) {
  const img = new Map();
  for (const [m, { c, i }] of Q.at) img.set(m, off[c] + matches[c][i]);
  // the edited bond table
  const bmap = new Map();
  const bk = (a, b) => (a < b ? a * 1e6 + b : b * 1e6 + a);
  for (const b of U.bonds) bmap.set(bk(b.a, b.b), { a: b.a, b: b.b, o: b.o, ar: b.ar });
  for (const [m1, m2] of T.pairs) {
    const s = m1 + ',' + m2, qs = Q.bonds.get(s), rs = Rs.bonds.get(s);
    const a = img.get(m1), b = img.get(m2), k = bk(a, b);
    if (qs != null && rs == null) bmap.delete(k);
    else if (qs == null && rs != null) {
      if (bmap.has(k)) return null;
      bmap.set(k, { a, b, o: bondOrderOf(rs) || 1, ar: false });
    } else if (qs != null && rs != null) {
      // a bond with no symbol is single, or stays aromatic
      const cur = bmap.get(k), o = bondOrderOf(rs) || (cur && cur.ar ? 0 : 1);
      if (o && cur && (cur.o !== o || cur.ar)) { cur.o = o; cur.ar = false; }
    }
  }
  const G = new Graph(U.N);
  for (let i = 0; i < U.N; i++) { G.z[i] = U.z[i]; G.q[i] = U.q[i]; }
  for (const [m, { a }] of Rs.at) G.q[img.get(m)] = a.charge;
  for (const b of bmap.values()) G.addBond(b.a, b.b, b.o, b.ar);
  for (const b of G.bonds) if (b.ar) { G.ar[b.a] = 1; G.ar[b.b] = 1; }
  if (!valenceOK(G, [...img.values()])) return null;
  if (dir === 'fwd' && cls.filter === 'markovnikov' && U.hCount(img.get(2)) > U.hCount(img.get(1))) return null;
  if (dir === 'fwd' && cls.filter === 'eas' && !easOK(U, img.get(1))) return null;
  // products: the fragments that hold each result pattern's atoms
  const frags = fragments(G), fragOf = new Int32Array(G.N);
  frags.forEach((f, k) => f.forEach(a => { fragOf[a] = k; }));
  const owner = new Int32Array(frags.length).fill(-1);
  for (const [m, { c }] of Rs.at) {
    const f = fragOf[img.get(m)];
    if (owner[f] >= 0 && owner[f] !== c) return null;
    owner[f] = c;
  }
  const products = [];
  for (let c = 0; c < Rs.P.length; c++) {
    const atoms = [];
    frags.forEach((f, k) => { if (owner[k] === c) atoms.push(...f); });
    if (!atoms.length) return null;
    products.push(atoms.sort((x, y) => x - y));
  }
  const left = frags.filter((f, k) => owner[k] < 0);
  if (left.length) for (const p of pairIons(G, left)) products.push(p);
  return {
    cls: cls.id, dir, inputs, off,
    products: products.map((atoms, c) => {
      const s = subGraph(G, atoms), n = normalise(s.G);
      return { G: n.G, origin: Int32Array.from(n.perm, p => s.perm[p]), comp: c };
    }),
  };
}

// Electrophilic aromatic substitution: a new group goes ortho or para to an
// activating or ortho/para-directing group, else meta to a deactivating
// one. Distances are counted along aromatic bonds.
function easOK(G, t) {
  const dist = new Map([[t, 0]]), q = [t];
  while (q.length) {
    const a = q.shift();
    for (const e of G.adj[a]) if (G.bonds[e.k].ar && !dist.has(e.to)) { dist.set(e.to, dist.get(a) + 1); q.push(e.to); }
  }
  let op = [], meta = [];
  for (const [s, d] of dist) {
    if (d === 0 || d > 3) continue;
    for (const e of G.adj[s]) {
      if (G.bonds[e.k].ar || G.z[e.to] === 1) continue;
      (director(G, e.to) === 'op' ? op : meta).push(d);
    }
  }
  if (op.length) return op.some(d => d === 1 || d === 3);
  if (meta.length) return meta.every(d => d === 2);
  return true;
}
function director(G, x) {
  const z = G.z[x];
  if (G.q[x] > 0) return 'm';
  if (z === 8 || z === 7) return 'op';
  if (z === 9 || z === 17 || z === 35 || z === 53) return 'op';
  if (z === 6) {
    for (const e of G.adj[x]) { const b = G.bonds[e.k], y = G.z[e.to]; if ((b.o >= 2 && !b.ar && (y === 8 || y === 7)) || y === 9) return 'm'; }
    return 'op';
  }
  return 'm';
}

// ── overall equations ───────────────────────────────────────────────────────
export function combustionOf(G) {
  const c = counts(G), C = c.C || 0, H = c.H || 0, O = c.O || 0;
  if (!C || Object.keys(c).some(k => !['C', 'H', 'O'].includes(k))) return null;
  for (const a of [1, 2, 4]) {
    const b = a * (C + H / 4 - O / 2), d = a * H / 2;
    if (Number.isInteger(b) && Number.isInteger(d) && b > 0) return { fuel: a, o2: b, co2: a * C, h2o: d };
  }
  return null;
}
export function applyOverall(cls, lhs, rhs) {
  const inputs = [], inSpecies = [];
  lhs.forEach(([G, n], s) => { for (let k = 0; k < n; k++) { inputs.push(G); inSpecies.push(s); } });
  const { G: U, off } = union(inputs);
  const outs = [];
  rhs.forEach(([G, n], s) => { for (let k = 0; k < n; k++) outs.push({ G, s }); });
  const totalR = outs.reduce((t, o) => t + o.G.N, 0);
  if (totalR !== U.N) throw new Error(cls.id + ': atoms do not balance');
  const used = new Uint8Array(U.N), molOf = new Int32Array(U.N);
  off.forEach((o, k) => { for (let i = 0; i < inputs[k].N; i++) molOf[o + i] = k; });
  // larger products first; a product atom next to a placed atom takes a
  // neighbour of that atom's image when one has the right element
  const order = outs.map((o, i) => i).sort((a, b) => outs[b].G.heavyCount() - outs[a].G.heavyCount());
  const products = new Array(outs.length);
  for (const pi of order) {
    const P = outs[pi].G, origin = new Int32Array(P.N).fill(-1);
    const pick = (z, near) => {
      if (near != null) for (const e of U.adj[near]) if (!used[e.to] && U.z[e.to] === z) return e.to;
      if (near != null) for (let i = 0; i < U.N; i++) if (!used[i] && U.z[i] === z && molOf[i] === molOf[near]) return i;
      let best = -1, bs = -1;
      for (let i = 0; i < U.N; i++) {
        if (used[i] || U.z[i] !== z) continue;
        let free = 0; for (const e of U.adj[i]) if (!used[e.to]) free++;
        if (free > bs) { bs = free; best = i; }
      }
      return best;
    };
    const seen = new Uint8Array(P.N);
    const heavyFirst = [...Array(P.N).keys()].sort((a, b) => (P.z[a] === 1) - (P.z[b] === 1));
    for (const s of heavyFirst) {
      if (seen[s]) continue;
      seen[s] = 1; const q = [s];
      origin[s] = pick(P.z[s], null); used[origin[s]] = 1;
      while (q.length) {
        const a = q.shift();
        for (const e of P.adj[a]) {
          if (seen[e.to]) continue;
          seen[e.to] = 1; q.push(e.to);
          const o = pick(P.z[e.to], origin[a]);
          if (o < 0) throw new Error(cls.id + ': no atom for product');
          origin[e.to] = o; used[o] = 1;
        }
      }
    }
    products[pi] = { G: P, origin, comp: outs[pi].s };
  }
  return { cls: cls.id, dir: 'fwd', inputs, inSpecies, off, products, key: '' };
}

// ── declined targets ────────────────────────────────────────────────────────
let BLOCK_C = null;
export function blockedWhy(G) {
  if (!BLOCK_C) BLOCK_C = { keys: new Set(), pats: BLOCK.patterns.map(([s, why]) => [parsePattern(s), why]), nitro: parsePattern('[c,C][N+](=[O])[O-]') };
  if (!BLOCK_C.keys.size && OCL) for (const s of BLOCK.smiles) { try { const m = OCL.Molecule.fromSmiles(s); m.stripStereoInformation(); BLOCK_C.keys.add(m.getIDCode()); } catch (e) { /* skip */ } }
  if (OCL && BLOCK_C.keys.has(key(G))) return 'a listed explosive, weapon agent or controlled substance';
  for (const [p, why] of BLOCK_C.pats) if (matchPattern(p, G, 1).length) return why;
  if (matchPattern(BLOCK_C.nitro, G, 20).length >= BLOCK.minNitro) return 'a polynitro compound (explosive)';
  return null;
}

// ── equation text ───────────────────────────────────────────────────────────
// terms: [{ ce, n }]; returns the mhchem equation.
export function equationTeX(cls, left, right) {
  const side = ts => ts.map(t => (t.n > 1 ? t.n : '') + t.ce).join(' + ');
  const arrow = cls.arrow || '->';
  const br = (cls.cond || cls.below) ? `[${cls.cond || ''}]` + (cls.below ? `[${cls.below}]` : '') : '';
  return `\\ce{${side(left)} ${arrow}${br} ${side(right)}}`;
}
export { hill };
