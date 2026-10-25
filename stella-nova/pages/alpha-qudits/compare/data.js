// ============================================================================
//  ALPHA QUDITS  ·  compare/data.js  ·  numbers for the COMPARE figures (DOM-free)
// ----------------------------------------------------------------------------
//  COMPARE reads every number from MODEL (../model/index.js). Until MODEL
//  loads, facts() gives a small stub with the values of CONTRACT.md, so the
//  ruler and the digits can draw at once. tests.mjs checks that the stub
//  agrees with MODEL digit for digit.
//
//  facts() -> {
//    ready         true when MODEL is loaded
//    cand          { num {a,b,c,d}, den, inv (60 decimals, a string),
//                    invF (float), tex, coords }
//    meas          [{ id, label, short, value, unc, v, u, sigma, cite }]
//                  sigma = (1/alpha_cand - value) / unc, as in the paper
//    alts          Table S5 rows (MODEL valueTable), [] before MODEL
//    sectors       { '++', '+-', '-+', '--' } record counts, or null
//    records       number of records, or null
//    N             readout dimension, or null
//    history       MODEL HISTORY, [] before MODEL
//    wyler         Wyler's 1/alpha, or null
//  }
//  loadModel() -> Promise of the MODEL module (or null on failure).
//  model() -> the loaded MODEL module, or null.
//
//  grep -n targets:  export const STUB | export function facts |
//  export function loadModel | function build | export function fmtGroup
// ============================================================================

// CONTRACT.md "Number facts to keep exact". Used only until MODEL loads.
export const STUB = Object.freeze({
  num: { a: 79, b: 48, c: 42, d: 3 }, den: 31104,
  inv: '137.035999189566155029183744020866',
  meas: [
    { id: 'codata2022', label: 'CODATA 2022', short: '137.035999177(21)', value: '137.035999177', unc: '0.000000021' },
    { id: 'g2', label: 'Electron g−2 (2023)', short: '137.035999166(15)', value: '137.035999166', unc: '0.000000015' },
    { id: 'rb2020', label: 'Rb recoil (2020)', short: '137.035999206(11)', value: '137.035999206', unc: '0.000000011' },
    { id: 'cs2018', label: 'Cs recoil (2018)', short: '137.035999046(27)', value: '137.035999046', unc: '0.000000027' },
  ],
});

let M = null, loading = null, cache = null, cacheKey = '';

export function loadModel() {
  if (!loading) {
    loading = import('../model/index.js').then(m => { M = m; cache = null; return m; },
      e => { console.info('alpha-qudits compare: model/ not loaded', e && e.message); return null; });
  }
  return loading;
}
export const model = () => M;

// Exact decimal difference of two digit strings, in units of 1e-15 (BigInt).
function scaled(s, k = 15) {
  const [i, f = ''] = String(s).split('.');
  return BigInt(i) * 10n ** BigInt(k) + BigInt((f + '0'.repeat(k)).slice(0, k));
}
function sigmaOf(inv, m) {
  const d = scaled(inv) - scaled(m.value), u = scaled(m.unc);
  return Number((d * 1000000n) / u) / 1e6;
}

function build() {
  const ready = !!M;
  let cand;
  if (ready) {
    const v = M.value();
    cand = { num: { ...v.numerator }, den: v.denominator, inv: v.inverseDigits(60), invF: v.inverse, tex: v.tex, coords: v.coords.map(c => c.text) };
  } else {
    cand = { num: { ...STUB.num }, den: STUB.den, inv: STUB.inv, invF: parseFloat(STUB.inv), tex: null, coords: null };
  }
  const src = ready ? M.MEASUREMENTS : STUB.meas;
  // Fig. 3 of the paper lists g-2, Rb, Cs, then CODATA; we keep that order.
  const order = ['g2', 'rb2020', 'cs2018', 'codata2022'];
  const meas = order.map(id => src.find(m => m.id === id)).filter(Boolean).map(m => ({
    id: m.id, label: m.label, short: m.short, value: m.value, unc: m.unc,
    v: parseFloat(m.value), u: parseFloat(m.unc), cite: m.cite || '', kind: m.kind || '',
    sigma: ready ? M.sigma(cand.inv, m.id) : sigmaOf(cand.inv, m),
  }));
  let alts = [], sectors = null, records = null, N = null, history = [], wyler = null;
  if (ready) {
    alts = M.valueTable().map(r => ({
      key: r.key, label: r.label, why: r.why || '', ref: r.ref || '',
      num: { ...r.value.numerator }, den: r.value.denominator, inv: r.value.inverse,
      invText: r.value.inverseDigits(6), fromPaper: !!r.value.fromPaper,
      ours: r.value.ours ? { num: { ...r.value.ours.numerator }, den: r.value.ours.denominator, inv: r.value.ours.inverse } : null,
      paper: r.paper ? { num: { ...r.paper.numerator }, den: r.paper.denominator, inv: parseFloat(r.paper.inverse), invText: r.paper.inverse } : null,
      agrees: r.agrees, records: r.value.records, N: r.value.N,
    }));
    const rec = M.buildRecords();
    sectors = M.sectors(rec); records = rec.length;
    N = M.readoutDimension(M.OBJECT_CONFIG);
    history = M.HISTORY.map(h => ({ ...h }));
    wyler = M.wylerInverse();
  }
  return { ready, cand, meas, alts, sectors, records, N, history, wyler };
}

export function facts() {
  const key = M ? 'model' : 'stub';
  if (!cache || cacheKey !== key) { cache = build(); cacheKey = key; }
  return cache;
}

// ------------------------------------------------------------- formatting
// '137.035999189566' -> '137.035 999 189 566' (groups of 3 after the point).
export function fmtGroup(s, sep = ' ') {
  const [i, f = ''] = String(s).split('.');
  return f ? i + '.' + f.replace(/(\d{3})(?=\d)/g, '$1' + sep) : i;
}
export const fmtSigma = s => (s >= 0 ? '+' : '−') + Math.abs(s).toFixed(Math.abs(s) >= 10 ? 1 : 2) + 'σ';
// 5.4e7 -> '5.4 × 10⁷'
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
export const sup = n => String(n).split('').map(c => SUP[c] ?? c).join('');
export function fmtSci(x, digits = 2) {
  if (!isFinite(x)) return '∞';
  if (x === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(x)));
  if (e >= -2 && e <= 4) return x.toFixed(Math.max(0, digits - 1 - e)).replace(/\.0+$/, '');
  const m = x / 10 ** e;
  return `${m.toFixed(digits - 1)} × 10${sup(e)}`;
}
// Numerator { a, b, c, d } as plain text: '79 + 48√2 + 42√3 + 3√6'.
export function numText(n) {
  const parts = [];
  if (n.a) parts.push(String(n.a));
  if (n.b) parts.push(n.b + '√2');
  if (n.c) parts.push(n.c + '√3');
  if (n.d) parts.push(n.d + '√6');
  return parts.join(' + ') || '0';
}
// The same, as a list of terms { key, text } for drawing with highlights.
export function numTerms(n) {
  return [['a', ''], ['b', '√2'], ['c', '√3'], ['d', '√6']].filter(([k]) => n[k]).map(([k, r]) => ({ key: k, text: n[k] + r, value: n[k] }));
}
