// ============================================================================
//  ALPHA QUDITS  ·  compare/scenes/dials.js  ·  Table S5 as switches (DOM-free)
// ----------------------------------------------------------------------------
//  Analogy 6. Each alternative of the paper's Table S5 is a switch. One
//  switch at a time, as in the table: each row changes one clause. MODEL
//  recomputes the value from the records under the changed rule
//  (valueTable()); the needle moves to it on a 1/alpha ruler from 60 to
//  190, and the readout gives the change against the computed value and
//  against the CODATA 2022 uncertainty. Two rows need a flag:
//    sumsAndDiffs  our recomputation differs from the printed value; both
//                  are shown (NOTES.md, MODEL line)
//    readEnds      MODEL cannot recompute it; the printed value is shown
//                  and marked "printed value"
//
//  grep -n targets:  export const GROUPS | export function rulerX |
//  export function deltaText | function needleAt | draw(g
// ============================================================================
import { C, text, line, dot, clamp, lerp, backdrop, fitSize, rgba, measure } from '../draw.js';
import { numTerms, fmtSci, fmtGroup } from '../data.js';

export const GROUPS = [
  { label: 'The paper’s reading', keys: ['computed'] },
  { label: 'Where the exchanges act', keys: ['endsSwapped', 'bothAtQubit', 'bothAtQutrit', 'xWhereLettersSit'] },
  { label: 'What the exchange of links moves', keys: ['qqMovedByY', 'copiesSeparate'] },
  { label: 'Commutator records', keys: ['noOwnSign', 'commutatorsXOnly', 'sumsAndDiffs', 'noCommutators'] },
  { label: 'Weights', keys: ['born', 'noWeights'] },
  { label: 'Normalization', keys: ['readEnds', 'perRecord'] },
  { label: 'Configuration', keys: ['smallest'] },
];
export const LO = 60, HI = 190;
const TOUR_S = 3.4;

export const rulerX = (v, x0, x1) => x0 + (clamp(v, LO, HI) - LO) / (HI - LO) * (x1 - x0);
// Change against the computed value, in percent and in CODATA sigma.
export function deltaText(alt, cand, codata) {
  if (!alt || alt.key === 'computed') return 'the computed value';
  const d = alt.inv - cand.invF, pct = d / cand.invF * 100;
  const sig = codata ? Math.abs(alt.inv - codata.v) / codata.u : null;
  return `${d >= 0 ? '+' : '−'}${Math.abs(pct) < 10 ? Math.abs(pct).toFixed(2) : Math.abs(pct).toFixed(0)} % · ${sig != null ? fmtSci(sig, 2) + ' σ from CODATA 2022' : ''}`;
}
const backOut = k => { k = clamp(k); const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };

export default {
  id: 'dials',
  title: 'Flip a clause',
  init(env) {
    const st = { sel: 'computed', tour: !env.reduced, t: 0, reduced: !!env.reduced, nd: null, tourT0: 0, lastKey: 'computed' };
    if (env.params) this.show(st, env.params);
    return st;
  },
  show(st, p = {}) {
    if (p.key) this.select(st, p.key);
    if (p.tour != null) { st.tour = !!p.tour && !st.reduced; st.tourT0 = st.t; }
  },
  select(st, key, F, keepTour = false) {
    if (!keepTour) st.tour = false;
    st.sel = key;
  },
  height(w) { return w < 480 ? 232 : 206; },
  current(st, F, t) {
    if (!F.alts.length) return null;
    if (st.tour) {
      const k = Math.floor(Math.max(0, t - st.tourT0) / TOUR_S) % F.alts.length;
      return F.alts[k];
    }
    return F.alts.find(a => a.key === st.sel) || F.alts[0];
  },
  caption(st, F) {
    const a = this.current(st, F, st.t);
    if (!a) return 'Loading the model…';
    if (a.key === 'computed') return `The paper's reading gives 1/α = ${fmtGroup(F.cand.inv.slice(0, 11))}…, computed from ${a.records} records over N = ${a.N}.`;
    return `${a.label}: 1/α = ${a.inv.toFixed(3)} (${deltaText(a, F.cand, F.meas.find(m => m.id === 'codata2022'))}).`;
  },
  info(st, F) {
    const a = this.current(st, F, st.t);
    if (!a) return '';
    if (a.key === 'computed') return `<b>The paper’s reading.</b> The exchange of reads X acts at the qutrit end, the exchange of links Y at the qubit end, and each record enters with weight √k (Theorem 2). Pick any switch to change one clause.`;
    let extra = '';
    if (a.fromPaper) extra = ` <span class="cmp-flag">Printed value.</span> The paper gives this count only in summary, so our model cannot rebuild it; our partial count gives ${a.ours ? a.ours.inv.toFixed(3) : '—'}.`;
    else if (a.agrees === false && a.paper) extra = ` <span class="cmp-flag">Our value differs.</span> Table S5 prints ${a.paper.invText}; under our reading of the stated survival rule (the sums survive X only), our model gets ${a.inv.toFixed(3)}. Both are shown.`;
    return `<b>${a.label}.</b> Excluded by the paper because: ${a.why} <span class="cmp-ref">(${a.ref})</span>${extra}`;
  },
  controls(st, ui, F) {
    const top = ui.group('Tour');
    ui.button(top, 'Tour all switches', () => { st.tour = true; st.tourT0 = st.t; ui.redraw(); }, { pressed: () => st.tour });
    const byKey = Object.fromEntries((F.alts || []).map(a => [a.key, a]));
    for (const gr of GROUPS) {
      const g = ui.group(gr.label, { stack: true });
      for (const k of gr.keys) {
        const a = byKey[k];
        const label = a ? (k === 'computed' ? 'Computed (Theorem 2)' : a.label) : k;
        const sub = a ? '1/α = ' + (a.inv < 10 ? a.inv.toFixed(3) : a.inv.toFixed(3)) + (a.fromPaper ? ' · printed' : a.agrees === false ? ' · differs' : '') : '';
        ui.button(g, label, () => { this.select(st, st.sel === k && k !== 'computed' ? 'computed' : k); ui.redraw(); },
          { pressed: () => !st.tour && st.sel === k, sub, wide: true });
      }
    }
  },
  draw(g, box, t, st, F) {
    st.t = t;
    backdrop(g, box, C.qt, 0.035);
    const pad = box.w < 420 ? 12 : 22, x0 = box.x + pad, x1 = box.x + box.w - pad, W = x1 - x0;
    const a = this.current(st, F, t);
    if (!a) { text(g, 'Loading the model…', box.x + box.w / 2, box.y + box.h / 2, { size: 13, color: C.dim, align: 'center' }); return; }
    if (a.key !== st.lastKey) { st.nd = { from: needleAt(st, t), t0: t }; st.lastKey = a.key; st.target = a.inv; }
    if (st.target == null) st.target = a.inv;
    const v = needleAt(st, t);
    const cod = F.meas.find(m => m.id === 'codata2022');
    const isComp = a.key === 'computed';
    const col = isComp ? C.val : C.qt;
    // readout
    const big = a.inv < 10 ? a.inv.toFixed(3) : a.inv.toFixed(3);
    text(g, '1/α =', x0, box.y + 30, { size: 13, color: C.dim });
    const bx = x0 + measure(g, '1/α = ', { size: 13 }) + 4;
    text(g, big, bx, box.y + 31, { size: box.w < 420 ? 24 : 28, fam: 'mono', w: 600, color: col });
    const lab = isComp ? 'Computed: the paper’s reading' : a.label;
    const dt = deltaText(a, F.cand, cod);
    if (box.w >= 560) {
      text(g, lab, x1, box.y + 20, { size: fitSize(g, lab, W * 0.5, 13), color: C.ink, align: 'right', w: 600 });
      text(g, dt, x1, box.y + 38, { size: 12, color: C.dim, align: 'right' });
    } else {
      text(g, lab, x0, box.y + 54, { size: fitSize(g, lab, W, 13), color: C.ink, w: 600 });
      text(g, dt, x0, box.y + 72, { size: fitSize(g, dt, W, 12), color: C.dim });
    }
    // the ruler
    const ry = box.y + (box.w >= 560 ? 104 : 126);
    line(g, x0, ry, x1, ry, C.line2, 1.2);
    const step = W < 340 ? 20 : 10;
    for (let k = LO; k <= HI; k += 10) {
      const x = rulerX(k, x0, x1), major = k % step === 0;
      line(g, x, ry, x, ry + (major ? 7 : 4), C.dim, 1);
      if (major) text(g, String(k), x, ry + 21, { size: 11, color: C.dim, align: 'center' });
    }
    text(g, '1/α of the readout', x1, ry + 38, { size: 11, color: C.dim, align: 'right' });
    // every alternative as a faint mark
    for (const b of F.alts) {
      if (b.key === 'computed') continue;
      const off = b.inv < LO || b.inv > HI;
      const x = rulerX(b.inv, x0, x1);
      const on = b.key === a.key;
      g.fillStyle = on ? C.qt : rgba(C.ink2, off ? 0.25 : 0.45);
      g.fillRect(x - (on ? 1.5 : 1), ry - (on ? 12 : 8), on ? 3 : 2, on ? 12 : 8);
    }
    // the computed value and the measured window
    const xc = rulerX(F.cand.invF, x0, x1);
    line(g, xc, ry - 34, xc, ry + 8, C.val, 1.6, [4, 3]);
    text(g, 'computed 137.036', xc, ry - 39, { size: 11, color: C.val, align: xc > x1 - 60 ? 'right' : 'center' });
    // the needle
    const xn = rulerX(v, x0, x1);
    const offL = a.inv < LO;
    g.beginPath(); g.moveTo(xn, ry - 2); g.lineTo(xn - 7, ry - 18); g.lineTo(xn + 7, ry - 18); g.closePath();
    g.fillStyle = col; g.fill();
    line(g, xn, ry - 18, xn, ry - 26, col, 2);
    if (offL && !st.nd) text(g, `← off scale (${a.inv.toFixed(3)})`, xn + 10, ry - 12, { size: 11, color: C.qt });
    // the formula with the changed terms marked
    const fy = ry + 62;
    const ref = F.alts.find(b => b.key === 'computed');
    const terms = numTerms(a.num), refT = ref ? Object.fromEntries(numTerms(ref.num).map(x => [x.key, x.value])) : {};
    let x = x0;
    const fs = box.w < 420 ? 13 : 14.5;
    x += text(g, '(', x, fy, { size: fs, fam: 'serif', color: C.ink2 });
    terms.forEach((tm, i) => {
      if (i) x += text(g, ' + ', x, fy, { size: fs, fam: 'serif', color: C.ink2 });
      const changed = refT[tm.key] !== tm.value;
      x += text(g, tm.text, x, fy, { size: fs, fam: 'serif', color: changed ? C.qt : C.ink, w: changed ? 600 : 400 });
    });
    const removed = ref ? numTerms(ref.num).filter(r => !a.num[r.key]).map(r => r.text) : [];
    x += text(g, `) / ${a.den}`, x, fy, { size: fs, fam: 'serif', color: a.den !== (ref && ref.den) ? C.qt : C.ink2 });
    if (removed.length && x + 80 < x1) text(g, `  (no ${removed.map(s => s.replace(/^\d+/, '')).join(', ')} term)`, x, fy, { size: 11.5, color: C.dim });
    if (a.fromPaper) text(g, 'printed value (Table S5); not recomputed', x0, fy + 20, { size: 11.5, color: C.qt, it: true });
    else if (a.agrees === false && a.paper) text(g, `Table S5 prints ${a.paper.invText}; our reading of its rule: ${a.inv.toFixed(3)}`, x0, fy + 20, { size: fitSize(g, 'Table S5 prints 000.000; our reading of its rule: 000.000', W, 11.5, { it: true }), color: C.qt, it: true });
    else if (!isComp) text(g, `${a.records} records over N = ${a.den}`, x0, fy + 20, { size: 11.5, color: C.dim });
    else {
      let s = 'the measured window around 137.036 is 4 × 10⁻⁸ wide: far thinner than the dashed line';
      if (measure(g, s, { size: 11, it: true }) > W) s = 'the measured window is 4 × 10⁻⁸ wide';
      text(g, s, x0, fy + 20, { size: fitSize(g, s, W, 11.5, { it: true }), color: C.dim, it: true });
    }
  },
};

function needleAt(st, t) {
  const to = st.target ?? 137.036;
  if (!st.nd) return to;
  if (st.reduced) { st.nd = null; return to; }
  const k = (t - st.nd.t0) / 0.9;
  if (k >= 1 || k < 0) { st.nd = null; return to; }
  return lerp(clamp(st.nd.from, LO, HI), clamp(to, LO, HI), backOut(k));
}
