// ============================================================================
//  ALPHA QUDITS  ·  model/records.js  ·  slots, records, exchanges, sectors (MODEL)
// ----------------------------------------------------------------------------
//  Builds the measurement records of a configuration with two read links
//  from the slot construction (paper Sec. S7), with no published count as
//  an input:
//    1. Slots: the two ends of each read link. A centre slot has c^2 - 1
//       letters, a far slot e^2 - 1.
//    2. Product terms: one letter at each of two distinct slots.
//    3. The exchange E of the two reads swaps slot 1 and slot 2 of each
//       role. Each term and its image form an orbit; a fixed term is a
//       'self' record, a moved pair gives an 'even' (t + Et) and an 'odd'
//       (t - Et) record.
//    4. Commutator records: at the qubit end of each read link, reads
//       anticommute (the Weyl phase is -1, computed in letters.js). Each
//       pair of letters mu < nu whose commutator is a single letter gives
//       the record [mu, nu] at read 1 minus the same at read 2 ('diff').
//    5. Survival. X acts on records with both letters at ends of one role
//       (and on commutator records, by swapping the two letters). Y acts
//       on records whose qudits change under the swap of the two read
//       links. An exchange that returns a record times its own sign reads
//       -1 (the record survives); otherwise it reads +1. The action is
//       applied to the record's terms and compared, not looked up.
//    6. Weight: k = (factor of X if it survives X) * (factor of Y ...),
//       with the factors from the rule set (rules.js).
//
//  grep -n targets:  export function slots | buildRecords | sectors |
//  sectorTable | exchangeTraces | edgeTable | function survival |
//  function commutatorRecords | function weightFactors
// ============================================================================
import { letters, anticommutingReads, weylPhase, commutatorLetter } from './letters.js';
import { rulesFor } from './rules.js';

// Slots of the two read links. Object ids are Q1, q1, Q2, q2 (paper order).
export function slots(rulesOrOpts = {}) {
  const r = rulesOrOpts.xAt ? rulesOrOpts : rulesFor(rulesOrOpts);
  const c = r.center, [e1, e2] = r.far;
  const obj = c === 3 && e1 === 2 && e2 === 2;
  const nm = (role, k, d) => obj ? (role === 'center' ? 'Q' : 'q') + k : (role === 'center' ? 'c' : 'f') + k;
  return [
    { id: nm('center', 1), role: 'center', read: 1, d: c, letters: c * c - 1 },
    { id: nm('far', 1), role: 'far', read: 1, d: e1, letters: e1 * e1 - 1 },
    { id: nm('center', 2), role: 'center', read: 2, d: c, letters: c * c - 1 },
    { id: nm('far', 2), role: 'far', read: 2, d: e2, letters: e2 * e2 - 1 },
  ];
}

// ---------------------------------------------------------------- terms
// A term is a map slot -> letter, stored as a sorted key 'Q1:3|q2:1'.
function termKey(entries, order) {
  return entries.slice().sort((a, b) => order[a[0]] - order[b[0]]).map(([s, l]) => s + ':' + l).join('|');
}
function parseKey(key) { return key.split('|').map(p => { const [s, l] = p.split(':'); return [s, +l]; }); }

// A vector is Map key -> {re, im}.
function vadd(v, key, re, im = 0) {
  const o = v.get(key) || { re: 0, im: 0 };
  o.re += re; o.im += im;
  if (Math.abs(o.re) < 1e-12 && Math.abs(o.im) < 1e-12) v.delete(key); else v.set(key, o);
}
// If w = lambda v for a real or complex lambda, return lambda; else null.
function ratio(w, v) {
  if (w.size !== v.size || v.size === 0) return null;
  let lam = null;
  for (const [k, a] of v) {
    const b = w.get(k); if (!b) return null;
    const m = a.re * a.re + a.im * a.im;
    const re = (b.re * a.re + b.im * a.im) / m, im = (b.im * a.re - b.re * a.im) / m;
    if (!lam) lam = { re, im };
    else if (Math.abs(lam.re - re) > 1e-9 || Math.abs(lam.im - im) > 1e-9) return null;
  }
  return lam;
}

// ---------------------------------------------------------------- build
export function buildRecords(opts = {}) {
  const r = opts.xAt ? opts : rulesFor(opts);
  const S = slots(r);
  const order = Object.fromEntries(S.map((s, i) => [s.id, i]));
  const byId = Object.fromEntries(S.map(s => [s.id, s]));
  // E: slot of read 1 <-> slot of read 2 with the same role.
  const swap = {};
  for (const s of S) swap[s.id] = S.find(t => t.role === s.role && t.read !== s.read).id;
  const Ekey = key => termKey(parseKey(key).map(([s, l]) => [swap[s], l]), order);

  // With unequal far ends E maps no slot onto a slot of the same size, so
  // the reads cannot be exchanged: each product is its own record and
  // neither exchange acts (only the counts of such pairs are used).
  const symmetric = S[1].d === S[3].d;
  const out = [];
  const seen = new Set();
  // 1-3: products and their orbits under E.
  for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
    const sa = S[a], sb = S[b];
    for (let i = 0; i < sa.letters; i++) for (let j = 0; j < sb.letters; j++) {
      const key = termKey([[sa.id, i], [sb.id, j]], order);
      if (seen.has(key)) continue;
      if (!symmetric) {
        const v = new Map(); vadd(v, key, 1); seen.add(key);
        out.push({ kind: 'product', slots: [sa.id, sb.id], letters: [i, j], edge: sa.id + sb.id,
          sameEnd: sa.role === sb.role, role: sa.role === sb.role ? sa.role : 'mixed', ownSign: 1,
          combo: 'single', partner: null, image: null, vector: v, parity: null });
        continue;
      }
      const img = Ekey(key);
      seen.add(key); seen.add(img);
      const base = {
        kind: 'product', slots: [sa.id, sb.id], letters: [i, j],
        edge: sa.id + sb.id, sameEnd: sa.role === sb.role,
        role: sa.role === sb.role ? sa.role : 'mixed', ownSign: 1,
      };
      if (img === key) {
        const v = new Map(); vadd(v, key, 1);
        out.push({ ...base, combo: 'self', partner: null, image: null, vector: v, parity: 1 });
      } else {
        const ve = new Map(); vadd(ve, key, 1); vadd(ve, img, 1);
        const vo = new Map(); vadd(vo, key, 1); vadd(vo, img, -1);
        const imgP = parseKey(img);
        const image = { slots: imgP.map(p => p[0]), letters: imgP.map(p => p[1]) };
        out.push({ ...base, combo: 'even', image, vector: ve, parity: 1 });
        out.push({ ...base, combo: 'odd', image, vector: vo, parity: -1 });
      }
    }
  }
  // 4: commutator records.
  for (const rec of commutatorRecords(r, S)) out.push(rec);

  // ids, partners.
  out.forEach((rec, n) => { rec.id = n + 1; });
  for (let n = 0; n < out.length; n++) {
    const rec = out[n];
    if (rec.combo === 'even') { rec.partner = out[n + 1].id; out[n + 1].partner = rec.id; }
  }

  // 5-6: survival and weights.
  const act = {
    symmetric,
    E: v => { const w = new Map(); for (const [k, z] of v) vadd(w, Ekey(k), z.re, z.im); return w; },
  };
  for (const rec of out) {
    const sx = survival(rec, 'X', r, act, byId, swap);
    const sy = survival(rec, 'Y', r, act, byId, swap);
    rec.X = sx.reads; rec.Y = sy.reads;
    rec.inX = sx.inDomain; rec.inY = sy.inDomain;
    const f = weightFactors(rec, r, byId, swap);
    rec.fx = f.fx; rec.fy = f.fy;
    rec.k = (rec.X === -1 ? f.fx : 1) * (rec.Y === -1 ? f.fy : 1);
    rec.weight = Math.sqrt(rec.k);
    rec.sector = (rec.X === 1 ? '+' : '-') + (rec.Y === 1 ? '+' : '-');
    rec.terms = [...rec.vector].map(([k, z]) => {
      const p = parseKey(k);
      return { slots: p.map(q => q[0]), letters: p.map(q => q[1]), coef: { re: z.re, im: z.im } };
    });
    delete rec.vector; delete rec.cterms;
  }
  return out;
}

// Commutator records between the qubit ends of the two read links. Each
// read link's qubit end is its far end when the far end has anticommuting
// reads, else its centre end when that one has.
function commutatorRecords(r, S) {
  if (r.commutators === 'none') return [];
  const pick = read => {
    const far = S.find(s => s.read === read && s.role === 'far');
    const cen = S.find(s => s.read === read && s.role === 'center');
    if (anticommutingReads(far.d)) return far;
    if (anticommutingReads(cen.d)) return cen;
    return null;
  };
  const s1 = pick(1), s2 = pick(2);
  if (!s1 || !s2 || s1.d !== s2.d) return [];
  const d = s1.d, n = d * d - 1;
  const orderSign = weylPhase(d).re; // -1 at a qubit
  const out = [];
  const kinds = r.commutators === 'both' ? ['sum', 'diff'] : ['diff'];
  for (let mu = 0; mu < n; mu++) for (let nu = mu + 1; nu < n; nu++) {
    const c = commutatorLetter(d, mu, nu);
    if (!c.single) continue;
    for (const kind of kinds) {
      const sgn = kind === 'diff' ? -1 : 1;
      const cterms = [{ slot: s1.id, mu, nu, sign: 1 }, { slot: s2.id, mu, nu, sign: sgn }];
      out.push({
        kind: 'commutator', slots: [s1.id, s2.id], letters: [mu, nu], result: c.letter,
        edge: 'arc', sameEnd: s1.role === s2.role, role: 'commutator',
        combo: kind, partner: null, image: null, parity: sgn,
        ownSign: r.ownSign ? orderSign : 1,
        cterms, vector: commVector(d, cterms),
      });
    }
  }
  return out;
}
function commVector(d, cterms) {
  const v = new Map();
  for (const t of cterms) {
    const c = commutatorLetter(d, t.mu, t.nu);
    vadd(v, t.slot + ':' + c.letter, t.sign * c.coeff.re, t.sign * c.coeff.im);
  }
  return v;
}

// What exchange ex ('X' or 'Y') reads on rec: -1 when it returns the
// record times its own sign, +1 otherwise or when it does not act.
function survival(rec, ex, r, act, byId, swap) {
  const qudit = id => (byId[id].role === 'center' && r.copiesOneQudit) ? 'C' : id;
  let inDomain, image;
  if (!act.symmetric && !(ex === 'X' && rec.kind === 'commutator')) return { inDomain: false, reads: 1, lambda: null };
  if (ex === 'X') {
    if (rec.kind === 'commutator') {
      inDomain = true;
      // X exchanges the two reads that the record orders: swap mu and nu.
      const d = byId[rec.slots[0]].d;
      image = commVector(d, rec.cterms.map(t => ({ ...t, mu: t.nu, nu: t.mu })));
    } else {
      inDomain = rec.sameEnd;
      image = inDomain ? act.E(rec.vector) : null;
    }
  } else {
    if (rec.kind === 'commutator') {
      inDomain = r.yMovesCommutators &&
        rec.cterms.some(t => qudit(t.slot) !== qudit(swap[t.slot]));
    } else {
      const before = rec.slots.map(qudit).sort().join(',');
      const after = rec.slots.map(s => qudit(swap[s])).sort().join(',');
      inDomain = before !== after || (r.yMovesSameQudits && rec.role === 'far');
    }
    image = inDomain ? act.E(rec.vector) : null;
  }
  if (!inDomain) return { inDomain, reads: 1, lambda: null };
  const lam = ratio(image, rec.vector);
  const survives = !!lam && Math.abs(lam.im) < 1e-9 && Math.abs(lam.re - rec.ownSign) < 1e-9;
  return { inDomain, reads: survives ? -1 : 1, lambda: lam };
}

// The dimension factors of the ends at which X and Y act on rec.
function weightFactors(rec, r, byId, swap) {
  const c = r.center, e = r.far[0];
  const dimsOf = ids => [...new Set(ids.map(id => byId[id].d + '@' + byId[id].role))]
    .reduce((p, s) => p * +s.split('@')[0], 1);
  let fx;
  if (r.xAt === 'read') fx = c;
  else if (r.xAt === 'far') fx = e;
  else fx = dimsOf(rec.kind === 'commutator' ? [rec.slots[0]] : rec.slots); // letters
  let fy;
  if (r.yAt === 'center') fy = c;
  else if (r.yAt === 'far') fy = e;
  else {
    // 'moved': every end whose letters Y carries to another qudit.
    const moved = id => byId[id].role === 'far' || !r.copiesOneQudit;
    const ids = (rec.kind === 'commutator' ? rec.slots : rec.slots).filter(moved);
    fy = ids.length ? dimsOf(ids) : 1;
  }
  return { fx, fy };
}

// ---------------------------------------------------------------- tables
// Counts per sector, keys '++', '+-', '-+', '--' (X sign, Y sign).
export function sectors(records) {
  const s = { '++': 0, '+-': 0, '-+': 0, '--': 0 };
  for (const r of records) s[r.sector]++;
  return s;
}

// One row per (sector, k): { sector, X, Y, k, count, weight }.
export function sectorTable(records) {
  const m = new Map();
  for (const r of records) {
    const key = r.sector + '/' + r.k;
    if (!m.has(key)) m.set(key, { sector: r.sector, X: r.X, Y: r.Y, k: r.k, weight: Math.sqrt(r.k), count: 0 });
    m.get(key).count++;
  }
  const ord = { '++': 0, '+-': 1, '-+': 2, '--': 3 };
  return [...m.values()].sort((a, b) => ord[a.sector] - ord[b.sector] || a.k - b.k);
}

// Traces of X, Y, XY on the record space (in its eigenbasis), and the
// trace of the Born operator sum k.
export function exchangeTraces(records) {
  let tx = 0, ty = 0, txy = 0, born = 0;
  for (const r of records) { tx += r.X; ty += r.Y; txy += r.X * r.Y; born += r.k; }
  return { X: tx, Y: ty, XY: txy, born, records: records.length };
}

// Table S3: records by edge (pair of slots) and by k. Edges that E maps
// to each other are grouped, e.g. 'Q1q1+Q2q2'.
export function edgeTable(records) {
  const groups = new Map();
  for (const r of records) {
    let g = r.edge;
    if (r.kind === 'product' && !r.sameEnd) {
      const other = r.image ? r.image.slots.join('') : r.edge;
      g = [r.edge, other].sort().join('+');
    }
    if (!groups.has(g)) groups.set(g, { edge: g, records: 0, byK: {} });
    const o = groups.get(g); o.records++; o.byK[r.k] = (o.byK[r.k] || 0) + 1;
  }
  return [...groups.values()];
}
