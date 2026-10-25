// ============================================================================
//  ALPHA QUDITS  ·  records/data.js  ·  what the RECORDS figures draw (RECORDS)
// ----------------------------------------------------------------------------
//  DOM-free. Every count on a RECORDS figure comes from here, and this file
//  reads every count from MODEL (../model/index.js): the slots, the 172
//  records, their sectors, edges, weights, the readout dimension N and the
//  exact digits. No published count is typed in. tests.mjs compares the
//  results with the paper's printed numbers.
//
//  GREP MAP   (grep -n "<anchor>" data.js)
//    export const RECORDS / SLOTS / BY_ID ... the model records and slots
//    export const SECTOR_ORDER / SECTORS .... sector keys and counts
//    export const SECTOR_ROWS ............... { key, X, Y, k, weight, count }
//    export const EDGES ..................... the six slot pairs and the arc
//    export const READOUT ................... N and its factors
//    export const VALUE / ALT ............... value() and two Table S5 rows
//    export function letterOf ............... letterInfo of a slot letter
//    export function termText / recordText .. plain-text record names
//    export function modeCounts ............. even and odd modes of n letters
//    export function edgeSplit .............. records of an edge by combo, k
//    export function samples ................ example records per mirror step
//    export function runningSum ............. the abacus state after n records
//    export function oneMore ................ 1/alpha shift for one more record
// ============================================================================
import * as M from '../model/index.js';

export const MODEL = M;
export const RULES = M.DEFAULT_RULES;
export const SLOTS = M.slots();
export const SLOT = Object.fromEntries(SLOTS.map(s => [s.id, s]));
export const RECORDS = M.buildRecords();
export const BY_ID = new Map(RECORDS.map(r => [r.id, r]));
export const SECTOR_ORDER = ['++', '+-', '-+', '--'];
export const SECTORS = M.sectors(RECORDS);
export const TRACES = M.exchangeTraces(RECORDS);
export const PRODUCTS = RECORDS.filter(r => r.kind === 'product');
export const COMMUTATORS = RECORDS.filter(r => r.kind === 'commutator');

// One row per sector, in SECTOR_ORDER. Each sector has one k in the paper's
// rules; the row keeps the list in case a rule change splits it.
export const SECTOR_ROWS = SECTOR_ORDER.map(key => {
  const rs = RECORDS.filter(r => r.sector === key);
  const ks = [...new Set(rs.map(r => r.k))];
  const X = key[0] === '+' ? 1 : -1, Y = key[1] === '+' ? 1 : -1;
  return { key, X, Y, k: ks[0] || 1, ks, weight: Math.sqrt(ks[0] || 1), count: rs.length,
    label: '(' + (X > 0 ? '+' : '−') + ', ' + (Y > 0 ? '+' : '−') + ')' };
});

export const WEIGHT_TEXT = { 1: '1', 2: '√2', 3: '√3', 6: '√6' };
export const wText = k => WEIGHT_TEXT[k] || '√' + k;

// The slot pairs of the square (Fig. 1(b) of the paper, our drawing) and the
// arc. products = letters at one slot times letters at the other; records =
// how many model records have their first term on that edge (an even and an
// odd record both carry the edge of their first term, so the image edges
// Q2q2 and q1Q2 hold none).
const PAIRS = [];
for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) PAIRS.push([SLOTS[a], SLOTS[b]]);
export const EDGES = [
  ...PAIRS.map(([a, b]) => ({
    id: a.id + b.id, a: a.id, b: b.id, solid: a.role === b.role,
    products: a.letters * b.letters, na: a.letters, nb: b.letters,
    records: RECORDS.filter(r => r.edge === a.id + b.id).length,
  })),
  { id: 'arc', a: SLOTS[1].id, b: SLOTS[3].id, solid: true, arc: true, products: 0,
    na: SLOTS[1].letters, nb: SLOTS[3].letters, records: COMMUTATORS.length },
];
export const EDGE = Object.fromEntries(EDGES.map(e => [e.id, e]));
export const PRODUCT_TERMS = EDGES.reduce((s, e) => s + e.products, 0);
export const SAME_END_TERMS = EDGES.filter(e => !e.arc && e.solid).reduce((s, e) => s + e.products, 0);
export const MIXED_TERMS = EDGES.filter(e => !e.arc && !e.solid).reduce((s, e) => s + e.products, 0);
export const SELF_TERMS = PRODUCTS.filter(r => r.combo === 'self').length;

// The readout dimension N and its three factors (Eq. (4) of the paper):
// the traceless part of the unread link times the whole operator space of
// the link at each read.
const OC = M.OBJECT_CONFIG;
export const READOUT = {
  N: M.readoutDimension(OC),
  unread: (OC.center * OC.center - 1) * (OC.unread * OC.unread - 1),
  read: OC.far.map(e => (OC.center * e) ** 2),
};

export const VALUE = M.value();
export const ALT = {
  born: M.value({ born: true }),
  noWeights: M.value({ noWeights: true }),
};
export const SIGMA = M.sigma(VALUE.inverseDigits(30));
export const MEASUREMENTS = M.MEASUREMENTS;

// letterInfo for letter i at slot id.
export function letterOf(slotId, i) { return M.letterInfo(SLOT[slotId].d, i); }

// 'λ4 at Q1 · σx at q2'
export function termText(t) { return t.slots.map((s, n) => letterOf(s, t.letters[n]).name + ' at ' + s).join(' · '); }

function coefText(c, first) {
  const re = Math.round(c.re * 1e6) / 1e6, im = Math.round(c.im * 1e6) / 1e6;
  if (im === 0) {
    if (re === 1) return first ? '' : ' + ';
    if (re === -1) return first ? '−' : ' − ';
    return (first ? '' : re < 0 ? ' − ' : ' + ') + Math.abs(re) + ' ';
  }
  if (re === 0) return (first ? (im < 0 ? '−' : '') : im < 0 ? ' − ' : ' + ') + (Math.abs(im) === 1 ? '' : Math.abs(im)) + 'i ';
  return (first ? '' : ' + ') + '(' + re + (im < 0 ? '−' : '+') + Math.abs(im) + 'i) ';
}

// A plain-text name of the record and its parts.
export function recordText(r) {
  if (r.kind === 'commutator') {
    const L = n => letterOf(r.slots[0], n).name;
    return { name: '[' + L(r.letters[0]) + ', ' + L(r.letters[1]) + '] at ' + r.slots[0] + ' − the same at ' + r.slots[1],
      sum: r.terms.map((t, n) => coefText(t.coef, n === 0) + termText(t)).join('') };
  }
  const sum = r.terms.map((t, n) => coefText(t.coef, n === 0) + termText(t)).join('');
  return { name: sum, sum };
}

export const COMBO_TEXT = {
  self: 'its own mirror image', even: 'even: the term plus its image', odd: 'odd: the term minus its image',
  diff: 'commutator at q1 minus the same at q2', sum: 'commutator sum', single: 'a single term',
};

// A mirror that swaps two letters of n letters each: n^2 placements, n of
// them their own image, the rest in pairs. Even = (n^2 + n) / 2 (the self
// images and the pair sums), odd = (n^2 - n) / 2.
export function modeCounts(n) { return { placements: n * n, self: n, even: (n * n + n) / 2, odd: (n * n - n) / 2 }; }

// Records of an edge (or of the two edges that E maps to each other).
export function edgeSplit(ids) {
  const set = new Set([].concat(ids));
  const rs = RECORDS.filter(r => set.has(r.edge));
  const by = (f) => rs.filter(f).length;
  const ks = {};
  for (const r of rs) ks[r.k] = (ks[r.k] || 0) + 1;
  return { records: rs.length, self: by(r => r.combo === 'self'), even: by(r => r.combo === 'even'),
    odd: by(r => r.combo === 'odd'), survivors: by(r => r.X === -1 || r.Y === -1), ks };
}

// Example records for the mirror scene, per step. Each list is in record
// order; the scene steps through it.
export function samples(step) {
  if (step === 'self') return PRODUCTS.filter(r => r.combo === 'self');
  if (step === 'pair') return PRODUCTS.filter(r => r.combo === 'even' && r.sameEnd);
  if (step === 'mixed') return PRODUCTS.filter(r => r.combo === 'even' && !r.sameEnd);
  if (step === 'commutator') return COMMUTATORS;
  return [];
}
export function oddPartner(r) { return r.partner ? BY_ID.get(r.partner) : null; }

// The abacus after the first n records (in record id order): counts and
// exact parts per k, the float sum.
export function runningSum(n) {
  const c = { 1: 0, 2: 0, 3: 0, 6: 0 };
  let f = 0;
  for (let i = 0; i < Math.min(n, RECORDS.length); i++) { const r = RECORDS[i]; c[r.k] = (c[r.k] || 0) + 1; f += r.weight; }
  return { counts: c, sum: f, n: Math.min(n, RECORDS.length) };
}
export const TOTAL = runningSum(RECORDS.length);

// How far 1/alpha moves if one more record of squared weight k were counted.
export function oneMore(k) {
  const S = TOTAL.sum, N = READOUT.N;
  return N / (S + Math.sqrt(k)) - N / S;
}
