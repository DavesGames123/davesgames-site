// ============================================================================
//  REACTIONS  ·  smarts.js — a small SMARTS subset: parse and match (no DOM)
// ----------------------------------------------------------------------------
//  The reaction templates (templates.js) are written in a subset of SMARTS.
//  Every hydrogen that moves is an explicit [H] atom with a map number, so
//  a template moves real atoms and the 3D animation can follow each one.
//  The molecule graphs (rxgraph.js) hold every hydrogen as an atom.
//
//  ATOMS  always in brackets: [C:1], [c,n:2], [C&X4&H2:3], [Cl-,Br-:4]
//    C N O S P B      aliphatic element      c n o s     aromatic element
//    Cl Br I F H Na K Mg Li Al   the element (no aromatic test)
//    #6               element by number      * any       A aliphatic  a aromatic
//    Hn  n H neighbours     Xn  n neighbours (H included)
//    Dn  n heavy neighbours R  in a ring
//    + - +2 -1        charge. An atom with no charge term must have charge 0.
//    !  not     &  and (high)     ,  or     ;  and (low)
//    Adjacent terms with no operator join by and: [Cl-] is Cl & -.
//    :n at the end is the map number.
//  BONDS  - single  = double  # triple  : aromatic  ~ any
//         (none) single or aromatic.  Ring closures 1-9 and %nn.
//  A dot separates fragments of one pattern (an ion pair: [Na+:1].[O-:2]).
//
//  parsePattern(text) -> { atoms: [{ map, test, charge, plainH }], bonds:
//                          [{ a, b, sym }], adj }
//  matchPattern(P, G, max) -> [Int32Array of graph atom per pattern atom]
//    Backtracking in a connected order (heavy atoms first). Sibling plain
//    [H] atoms on one parent take graph atoms in increasing order, so the
//    n! hydrogen permutations count once.
//  bondTest(sym, bond)    does a graph bond satisfy a bond symbol
//  bondOrderOf(sym)       the order a template sets (0 = keep)
//
//  GREP MAP
//    grep -n 'export function parsePattern'   the parser
//    grep -n 'function parseAtomExpr'         one bracket atom
//    grep -n 'export function matchPattern'   the matcher
// ============================================================================

const ELEM = { H: 1, He: 2, Li: 3, Be: 4, B: 5, C: 6, N: 7, O: 8, F: 9, Na: 11, Mg: 12, Al: 13, Si: 14, P: 15, S: 16, Cl: 17, K: 19, Ca: 20,
  Fe: 26, Cu: 29, Zn: 30, Br: 35, Pd: 46, Sn: 50, I: 53, Pt: 78 };
const AROM = { b: 5, c: 6, n: 7, o: 8, p: 15, s: 16 };
const ALIPHATIC_ONLY = new Set([5, 6, 7, 8, 15, 16]);

// ── one bracket atom ────────────────────────────────────────────────────────
// Grammar (low to high): expr := and (';' and)*;  and := or;  or := term
// (',' term)*;  term := prim (('&')? prim)*;  prim := '!'? primitive.
function parseAtomExpr(src) {
  let map = 0;
  const mm = /:(\d+)$/.exec(src);
  if (mm) { map = +mm[1]; src = src.slice(0, mm.index); }
  let hasCharge = false, firstCharge = null;
  const lowParts = src.split(';');
  const prims = s => {
    // split one term into primitives
    const out = [];
    let i = 0, first = true;
    while (i < s.length) {
      if (s[i] === '&') { i++; continue; }
      let neg = false;
      while (s[i] === '!') { neg = !neg; i++; }
      let m, f, chg = null;
      const rest = s.slice(i);
      if ((m = /^#(\d+)/.exec(rest))) { const z = +m[1]; f = (G, a) => G.z[a] === z; }
      else if ((m = /^\*/.exec(rest))) f = () => true;
      else if (first && (m = /^(Cl|Br|Na|Mg|Li|Al|Si|Ca|Fe|Cu|Zn|Pd|Sn|Pt|He|Be|[BCNOSPFIKH])/.exec(rest))) {
        const z = ELEM[m[1]];
        f = ALIPHATIC_ONLY.has(z) ? (G, a) => G.z[a] === z && !G.ar[a] : (G, a) => G.z[a] === z;
      }
      else if ((m = /^[bcnops]/.exec(rest)) && first) { const z = AROM[m[0]]; f = (G, a) => G.z[a] === z && !!G.ar[a]; }
      else if ((m = /^A/.exec(rest))) f = (G, a) => !G.ar[a];
      else if ((m = /^a/.exec(rest))) f = (G, a) => !!G.ar[a];
      else if ((m = /^H(\d+)/.exec(rest))) { const n = +m[1]; f = (G, a) => G.hCount(a) === n; }
      else if ((m = /^X(\d+)/.exec(rest))) { const n = +m[1]; f = (G, a) => G.adj[a].length === n; }
      else if ((m = /^D(\d+)/.exec(rest))) { const n = +m[1]; f = (G, a) => G.adj[a].length - G.hCount(a) === n; }
      else if ((m = /^R/.exec(rest))) f = (G, a) => G.inRing(a);
      else if ((m = /^([+-])(\d*)/.exec(rest))) {
        const q = (m[1] === '+' ? 1 : -1) * (m[2] ? +m[2] : 1);
        f = (G, a) => G.q[a] === q; chg = q;
      }
      else throw new Error('SMARTS: cannot read "' + rest + '" in [' + src + ']');
      if (chg != null) { hasCharge = true; if (!neg && firstCharge == null) firstCharge = chg; }
      out.push(neg ? (G, a) => !f(G, a) : f);
      i += m[0].length; first = false;
    }
    return out;
  };
  const ands = lowParts.map(lp => lp.split(',').map(term => prims(term)));
  const test0 = (G, a) => ands.every(ors => ors.some(ps => ps.every(p => p(G, a))));
  const test = hasCharge ? test0 : (G, a) => G.q[a] === 0 && test0(G, a);
  const plainH = src === 'H' || src === '#1';
  return { map, test, charge: hasCharge ? (firstCharge ?? 0) : 0, plainH, src };
}

// ── pattern ─────────────────────────────────────────────────────────────────
export function parsePattern(text) {
  const atoms = [], bonds = [];
  const stack = [], rings = new Map();
  let prev = -1, bsym = '', i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '[') {
      const j = text.indexOf(']', i);
      if (j < 0) throw new Error('SMARTS: no ] in ' + text);
      const a = parseAtomExpr(text.slice(i + 1, j));
      atoms.push(a);
      const k = atoms.length - 1;
      if (prev >= 0) bonds.push({ a: prev, b: k, sym: bsym });
      prev = k; bsym = ''; i = j + 1;
    } else if (c === '(') { stack.push(prev); i++; }
    else if (c === ')') { prev = stack.pop(); i++; }
    else if (c === '.') { prev = -1; bsym = ''; i++; }
    else if ('-=#:~'.includes(c)) { bsym = c; i++; }
    else if (/[0-9%]/.test(c)) {
      let n;
      if (c === '%') { n = +text.slice(i + 1, i + 3); i += 3; } else { n = +c; i++; }
      if (rings.has(n)) { const r = rings.get(n); bonds.push({ a: r.atom, b: prev, sym: bsym || r.sym }); rings.delete(n); }
      else rings.set(n, { atom: prev, sym: bsym });
      bsym = '';
    } else if (c === ' ') i++;
    else throw new Error('SMARTS: unexpected "' + c + '" in ' + text);
  }
  if (rings.size) throw new Error('SMARTS: open ring closure in ' + text);
  const adj = atoms.map(() => []);
  bonds.forEach((b, k) => { adj[b.a].push({ to: b.b, k }); adj[b.b].push({ to: b.a, k }); });
  return { atoms, bonds, adj, text };
}

export function bondTest(sym, bd) {
  switch (sym) {
    case '-': return bd.o === 1 && !bd.ar;
    case '=': return bd.o === 2 && !bd.ar;
    case '#': return bd.o === 3;
    case ':': return !!bd.ar;
    case '~': return true;
    default: return bd.ar || bd.o === 1;
  }
}
export const bondOrderOf = sym => (sym === '-' ? 1 : sym === '=' ? 2 : sym === '#' ? 3 : 0);

// ── matcher ─────────────────────────────────────────────────────────────────
// Order: each next atom is bonded to an earlier one when it can be; a new
// fragment of the pattern starts at a heavy atom when it can.
function matchOrder(P) {
  const n = P.atoms.length, seen = new Uint8Array(n), order = [], parent = new Int32Array(n).fill(-1), pbond = new Int32Array(n).fill(-1);
  while (order.length < n) {
    let s = -1;
    for (let i = 0; i < n; i++) if (!seen[i] && !P.atoms[i].plainH) { s = i; break; }
    if (s < 0) for (let i = 0; i < n; i++) if (!seen[i]) { s = i; break; }
    seen[s] = 1; order.push(s);
    const q = [s];
    while (q.length) {
      const a = q.shift();
      // heavy neighbours first, then hydrogens
      const nb = P.adj[a].slice().sort((x, y) => (P.atoms[x.to].plainH ? 1 : 0) - (P.atoms[y.to].plainH ? 1 : 0));
      for (const e of nb) if (!seen[e.to]) { seen[e.to] = 1; order.push(e.to); parent[e.to] = a; pbond[e.to] = e.k; q.push(e.to); }
    }
  }
  return { order, parent, pbond };
}

export function matchPattern(P, G, max = 400) {
  if (!P._ord) P._ord = matchOrder(P);
  const { order, parent, pbond } = P._ord;
  const n = P.atoms.length, img = new Int32Array(n).fill(-1), used = new Uint8Array(G.N), out = [];
  // sibling plain H atoms on the same pattern parent, earlier in the order
  const sib = order.map((p, k) => {
    if (!P.atoms[p].plainH || parent[p] < 0) return -1;
    for (let j = k - 1; j >= 0; j--) { const o = order[j]; if (P.atoms[o].plainH && parent[o] === parent[p]) return o; }
    return -1;
  });
  const sibOf = new Int32Array(n).fill(-1); order.forEach((p, k) => { sibOf[p] = sib[k]; });
  const ok = (p, a) => {
    if (used[a] || !P.atoms[p].test(G, a)) return false;
    for (const e of P.adj[p]) {
      const b = img[e.to]; if (b < 0) continue;
      const k = G.bondIndex(a, b);
      if (k < 0 || !bondTest(P.bonds[e.k].sym, G.bonds[k])) return false;
    }
    if (sibOf[p] >= 0 && img[sibOf[p]] > a) return false;
    return true;
  };
  const rec = k => {
    if (out.length >= max) return;
    if (k === n) { out.push(Int32Array.from(img)); return; }
    const p = order[k];
    const par = parent[p];
    const cand = par >= 0 ? G.adj[img[par]].map(e => e.to) : Array.from({ length: G.N }, (_, i) => i);
    for (const a of cand) {
      if (!ok(p, a)) continue;
      img[p] = a; used[a] = 1;
      rec(k + 1);
      img[p] = -1; used[a] = 0;
      if (out.length >= max) return;
    }
  };
  rec(0);
  return out;
}
