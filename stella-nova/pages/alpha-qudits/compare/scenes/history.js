// ============================================================================
//  ALPHA QUDITS  ·  compare/scenes/history.js  ·  closed forms against time (DOM-free)
// ----------------------------------------------------------------------------
//  1/alpha against the year. A closed form is a horizontal line from the
//  year it was proposed (it cannot move); a measurement is a point with its
//  one-sigma bar. Five steps zoom the 1/alpha axis: Eddington's 136 and 137,
//  Wyler's 1969 form against the CODATA 1973 and 1986 values, the
//  rejoinders, the modern adjustments, and the 2026 candidate.
//
//  Claims come from MODEL HISTORY (with citations, and whether the paper
//  cites them). The CODATA adjustments before 2022 are from the general
//  literature, not from the paper's references; each row carries its
//  citation. Every sigma in the text is computed here, not typed in.
//
//  grep -n targets:  export const CODATA_SERIES | export const STEPS |
//  export function stepFacts | function viewAt | draw(g
// ============================================================================
import { C, text, line, dot, clamp, lerp, ease, backdrop, fitSize, rgba, ticks, niceStep } from '../draw.js';
import { fmtGroup, fmtSigma } from '../data.js';
import { axisLabels } from './ruler.js';

export const CODATA_SERIES = [
  { year: 1973, value: '137.03604', unc: '0.00011', cite: 'E. R. Cohen and B. N. Taylor, J. Phys. Chem. Ref. Data 2, 663 (1973)' },
  { year: 1986, value: '137.0359895', unc: '0.0000061', cite: 'E. R. Cohen and B. N. Taylor, Rev. Mod. Phys. 59, 1121 (1987)' },
  { year: 1998, value: '137.03599976', unc: '0.00000050', cite: 'P. J. Mohr and B. N. Taylor, Rev. Mod. Phys. 72, 351 (2000)' },
  { year: 2002, value: '137.03599911', unc: '0.00000046', cite: 'P. J. Mohr and B. N. Taylor, Rev. Mod. Phys. 77, 1 (2005)' },
  { year: 2006, value: '137.035999679', unc: '0.000000094', cite: 'P. J. Mohr, B. N. Taylor, and D. B. Newell, Rev. Mod. Phys. 80, 633 (2008)' },
  { year: 2010, value: '137.035999074', unc: '0.000000044', cite: 'P. J. Mohr, B. N. Taylor, and D. B. Newell, Rev. Mod. Phys. 84, 1527 (2012)' },
  { year: 2014, value: '137.035999139', unc: '0.000000031', cite: 'P. J. Mohr, D. B. Newell, and B. N. Taylor, Rev. Mod. Phys. 88, 035009 (2016)' },
  { year: 2018, value: '137.035999084', unc: '0.000000021', cite: 'E. Tiesinga, P. J. Mohr, D. B. Newell, and B. N. Taylor, Rev. Mod. Phys. 93, 025010 (2021)' },
].map(r => ({ ...r, v: parseFloat(r.value), u: parseFloat(r.unc), source: 'general literature (not in the paper’s references)' }));

// y views: centre and half width of the 1/alpha axis
const V_WIDE = { c: 136.55, h: 1.05 }, V_WYLER = { c: 137.0360, h: 0.00019 }, V_NOW = { c: 137.0359993, h: 0.00000105 };
export const STEPS = [
  { id: 'eddington', label: 'Eddington', view: V_WIDE },
  { id: 'wyler', label: 'Wyler', view: V_WYLER },
  { id: 'rejoinders', label: 'Rejoinders', view: V_WYLER },
  { id: 'measurements', label: 'Measurements', view: V_NOW },
  { id: 'candidate', label: '2026', view: V_NOW },
];
const DWELL = 6.5, X0 = 1922, X1 = 2032;

// Points: every CODATA adjustment, 2022 from MODEL (or the stub).
function series(F) {
  const c22 = F.meas.find(m => m.id === 'codata2022');
  const out = CODATA_SERIES.slice();
  if (c22) out.push({ year: 2022, value: c22.value, unc: c22.unc, v: c22.v, u: c22.u, cite: c22.cite || 'CODATA 2022', source: 'the paper’s ref. [4]' });
  return out;
}
// Claims: Eddington, Wyler, the candidate, from MODEL HISTORY.
function claims(F) {
  const out = [];
  for (const h of F.history || []) {
    let inv = h.inverse;
    if (h.inverseFn === 'wylerInverse') inv = F.wyler;
    if (h.inverseFn === 'candidate') inv = F.cand.invF;
    if (inv == null) continue;
    out.push({ ...h, inv, kind: h.who.includes('Eddington') ? 'eddington' : h.who.includes('Wyler') ? 'wyler' : 'candidate' });
  }
  if (!out.some(c => c.kind === 'candidate')) out.push({ year: 2026, who: 'A. D. Wissner-Gross', inv: F.cand.invF, kind: 'candidate', cite: 'preprint dated 23 October 2026', citedByPaper: true });
  return out;
}
// Numbers the step texts quote, computed from the series.
export function stepFacts(F) {
  const S = series(F), by = y => S.find(s => s.year === y);
  const wy = F.wyler;
  const a73 = by(1973), a86 = by(1986), a06 = by(2006), a10 = by(2010);
  const c22 = S.find(s => s.year === 2022);
  return {
    wylerIn1973: wy && a73 ? (wy - a73.v) / a73.u : null,
    wylerOff1986: wy && a86 ? (wy - a86.v) / a86.u : null,
    wylerOff2022: wy && c22 ? (wy - c22.v) / c22.u : null,
    shift0610: a06 && a10 ? (a10.v - a06.v) / a06.u : null,
    cand22: c22 ? (F.cand.invF - c22.v) / c22.u : null,
  };
}

export default {
  id: 'history',
  title: 'History',
  init(env) {
    const st = { step: env.reduced ? STEPS.length - 1 : 0, auto: !env.reduced, t: 0, t0: 0, tw: null, reduced: !!env.reduced, view: null };
    if (env.params) this.show(st, env.params);
    return st;
  },
  show(st, p = {}) {
    if (p.step != null) { const i = typeof p.step === 'number' ? p.step : STEPS.findIndex(s => s.id === p.step); if (i >= 0) this.go(st, i); }
    if (p.auto != null) { st.auto = !!p.auto && !st.reduced; st.t0 = st.t; }
  },
  go(st, i, keepAuto = false) {
    const from = st.view || STEPS[st.step].view;
    if (!keepAuto) st.auto = false;
    st.step = i;
    st.tw = st.reduced ? null : { from, t0: st.t };
  },
  height(w) { return w < 480 ? 330 : 360; },
  activeStep(st, t) {
    if (st.auto) {
      const i = Math.floor(Math.max(0, t - st.t0) / DWELL) % STEPS.length;
      if (i !== st.step) this.go(st, i, true);
    }
    return st.step;
  },
  caption(st, F) {
    const f = stepFacts(F);
    const id = STEPS[st.step].id;
    if (id === 'eddington') return 'Eddington’s 136 (1929) and 137: a closed form is a line that cannot move; the measured value went on to 137.036.';
    if (id === 'wyler') return f.wylerIn1973 != null ? `Wyler (1969) sat ${Math.abs(f.wylerIn1973).toFixed(1)}σ from CODATA 1973, then ${Math.abs(f.wylerOff1986).toFixed(0)}σ from CODATA 1986.` : 'Wyler (1969) against CODATA 1973 and 1986.';
    if (id === 'rejoinders') return 'Robertson (1971) and Gilmore (1972): nothing fixed the normalization of Wyler’s volumes.';
    if (id === 'measurements') return f.shift0610 != null ? `Adjustments move too: CODATA 2010 sits ${Math.abs(f.shift0610).toFixed(1)}σ (of the 2006 uncertainty) below CODATA 2006.` : 'The modern adjustments.';
    return f.cand22 != null ? `The 2026 candidate, ${fmtSigma(f.cand22)} from CODATA 2022: a conjecture that each new digit of measurement tests.` : 'The 2026 candidate.';
  },
  info(st, F) {
    const f = stepFacts(F), id = STEPS[st.step].id;
    const H = F.history || [];
    const cite = (who, year) => { const h = H.find(x => x.who.includes(who) && (!year || x.year === year)); if (!h) return '';
      const note = h.ref ? ` (the paper’s ref. [${h.ref}])` : h.citedByPaper ? '' : ' (general literature, not in the paper’s references)';
      return `<span class="cmp-ref">${h.cite}${note}</span>`; };
    if (id === 'eddington') return `<p><b>1929 and after.</b> A. S. Eddington argued from a counting argument that 1/α is exactly 136, and later revised the count to 137 when measurements moved away from 136. ${cite('Eddington', 1929)} ${cite('Eddington', 1936)}</p>`;
    if (id === 'wyler') return `<p><b>1969.</b> A. Wyler obtained α = (9/8π⁴)(π⁵/2⁴·5!)^¼ from volumes of symmetric domains, 1/α = ${F.wyler ? F.wyler.toFixed(5) : '137.036 08'}. It lay ${f.wylerIn1973 != null ? Math.abs(f.wylerIn1973).toFixed(1) : '—'}σ from CODATA 1973; by 1986 the bar had shrunk and the gap was ${f.wylerOff1986 != null ? Math.abs(f.wylerOff1986).toFixed(0) : '—'}σ, and today it is about ${f.wylerOff2022 != null ? Math.round(Math.abs(f.wylerOff2022) / 100) * 100 : '—'}σ from CODATA 2022. ${cite('Wyler', 1969)} ${cite('Wyler', 1971)}</p><p class="cmp-sub">CODATA adjustments before 2022: ${CODATA_SERIES[0].cite}; ${CODATA_SERIES[1].cite} (general literature).</p>`;
    if (id === 'rejoinders') return `<p><b>1971–72.</b> B. Robertson and R. Gilmore objected that nothing in Wyler’s construction fixed the normalization: the volume of a symmetric domain can be rescaled, and the number with it. The paper cites both and states its own aim against them: a derivation must exhibit its one input and leave nothing to fix. ${cite('Robertson')} ${cite('Gilmore')}</p>`;
    if (id === 'measurements') return `<p><b>The modern adjustments.</b> CODATA 1998 to 2022, each with its one-sigma bar. The bars shrink, and the central values move by more than their bars more than once: CODATA 2010 lies ${f.shift0610 != null ? Math.abs(f.shift0610).toFixed(1) : '—'} of the 2006 standard deviations below CODATA 2006. A candidate that agrees with one adjustment is tested again by the next.</p><p class="cmp-sub">${CODATA_SERIES.slice(2).map(r => `${r.year}: ${r.cite}`).join('; ')}; 2022: the paper’s ref. [4].</p>`;
    return `<p><b>2026.</b> The paper’s candidate, 1/α = ${fmtGroup(F.cand.inv.slice(0, 14))}…, ${f.cand22 != null ? fmtSigma(f.cand22) : ''} from CODATA 2022. Its identification with α(0) is Conjecture 1 of the paper. Unlike every bar on this chart, the line has no width, so each further digit of measurement is a sharper test. ${cite('Wissner-Gross')}</p>`;
  },
  controls(st, ui) {
    const g = ui.group('Steps');
    ui.button(g, 'Auto', () => { st.auto = true; st.t0 = st.t - st.step * DWELL; ui.redraw(); }, { pressed: () => st.auto });
    STEPS.forEach((s, i) => ui.button(g, s.label, () => { this.go(st, i); ui.redraw(); }, { pressed: () => !st.auto && st.step === i }));
  },
  draw(g, box, t, st, F) {
    st.t = t;
    const si = this.activeStep(st, t), step = STEPS[si];
    const view = viewAt(st, t, step.view);
    st.view = view;
    backdrop(g, box, C.ro, 0.035);
    const narrow = box.w < 480;
    const padL = narrow ? 44 : 62, padR = narrow ? 12 : 22, padT = 34, padB = 40;
    const px0 = box.x + padL, px1 = box.x + box.w - padR, py0 = box.y + padT, py1 = box.y + box.h - padB;
    const lo = view.c - view.h, hi = view.c + view.h;
    const Y = v => py1 - (v - lo) / (hi - lo) * (py1 - py0);
    const Xy = yr => px0 + (yr - X0) / (X1 - X0) * (px1 - px0);
    // axes
    const ax = axisLabels(lo, hi, (py1 - py0) * 1.25);
    for (const tk of ax.ticks) {
      const y = Y(tk.v); if (y < py0 - 1 || y > py1 + 1) continue;
      line(g, px0, y, px1, y, C.grid, 1);
      text(g, tk.label, px0 - 6, y + 4, { size: 11, color: C.dim, align: 'right' });
    }
    text(g, ax.title, box.x + 8, box.y + 18, { size: fitSize(g, ax.title, box.w * 0.6, 12), color: C.ink2 });
    const yStep = narrow ? 20 : 10;
    for (const yr of ticks(1930, 2030, yStep)) {
      const x = Xy(yr);
      line(g, x, py1, x, py1 + 5, C.dim, 1);
      text(g, String(yr), x, py1 + 18, { size: 11, color: C.dim, align: 'center' });
    }
    line(g, px0, py1, px1, py1, C.line2, 1);
    if (!narrow) text(g, 'year', px1, py1 + 34, { size: 11, color: C.dim, align: 'right' });
    if (!box.fill && !narrow) text(g, 'points: CODATA adjustments, one-sigma bars', box.x + box.w - padR, box.y + 18, { size: 11, color: C.dim, align: 'right' });
    else if (!box.fill) text(g, 'points: CODATA, one-sigma bars', box.x + box.w - padR, py1 + 34, { size: 11, color: C.dim, align: 'right' });
    g.save(); g.beginPath(); g.rect(px0, py0 - 4, px1 - px0, py1 - py0 + 8); g.clip();
    // claims: lines from their year
    const CL = claims(F);
    const litClaim = c => (step.id === 'eddington' && c.kind === 'eddington') || ((step.id === 'wyler' || step.id === 'rejoinders') && c.kind === 'wyler') || (step.id === 'candidate' && c.kind === 'candidate');
    for (const c of CL) {
      const y = Y(c.inv), x = Xy(c.year), lit = litClaim(c);
      const col = c.kind === 'candidate' ? C.val : c.kind === 'wyler' ? C.chg : C.qt;
      if (y < py0 - 30 || y > py1 + 30) continue;
      g.globalAlpha = lit ? 1 : 0.55;
      line(g, x, y, px1, y, col, lit ? 2 : 1.4, c.kind === 'candidate' ? [6, 4] : null);
      dot(g, x, y, lit ? 4.5 : 3.5, col);
      g.globalAlpha = 1;
    }
    // measurements
    const S = series(F);
    const litMeas = r => (step.id === 'wyler' && (r.year === 1973 || r.year === 1986)) || (step.id === 'measurements' && r.year >= 1998) || (step.id === 'candidate' && r.year === 2022);
    for (const r of S) {
      const x = Xy(r.year), y = Y(r.v), ya = Y(r.v - r.u), yb = Y(r.v + r.u), lit = litMeas(r);
      g.globalAlpha = lit ? 1 : 0.6;
      if (ya - yb >= 3) { line(g, x, clamp(yb, py0 - 4, py1 + 4), x, clamp(ya, py0 - 4, py1 + 4), C.ink, 1.8); if (yb >= py0) line(g, x - 4, yb, x + 4, yb, C.ink, 1.4); if (ya <= py1) line(g, x - 4, ya, x + 4, ya, C.ink, 1.4); }
      if (y >= py0 - 4 && y <= py1 + 4) { if (r.year === 2022) dot(g, x, y, 4.2, C.card, C.ink, 1.6); else dot(g, x, y, 3.6, C.ink); }
      g.globalAlpha = 1;
    }
    g.restore();
    // labels for claims (outside the clip, clamped)
    for (const c of CL) {
      const y = Y(c.inv), x = Xy(c.year), lit = litClaim(c);
      const col = c.kind === 'candidate' ? C.val : c.kind === 'wyler' ? C.chg : C.qt;
      let lab = c.kind === 'candidate' ? `candidate ${c.inv.toFixed(9)}` : c.kind === 'wyler' ? `Wyler ${c.inv.toFixed(5)}` : `Eddington ${c.inv}`;
      if (!lit && c.kind === 'candidate') continue;
      if (y < py0 - 2) { if (lit) text(g, `↑ ${lab}`, px1 - 4, py0 + 12, { size: 11.5, color: col, align: 'right' }); continue; }
      if (y > py1 + 2) { if (lit) text(g, `↓ ${lab}`, px1 - 4, py1 - 6, { size: 11.5, color: col, align: 'right' }); continue; }
      const above = c.kind !== 'eddington' || c.inv > 136.5;
      text(g, lab, Math.min(x + 6, px1 - 4 - g.measureText(lab).width), y + (above ? -7 : 15), { size: 11.5, color: col, alpha: lit ? 1 : 0.7, w: lit ? 600 : 400 });
    }
    if (step.id === 'eddington') text(g, 'measured', Xy(1990), Y(137.036) - 8, { size: 11, color: C.ink2, align: 'center' });
  },
};

function viewAt(st, t, target) {
  if (!st.tw) return target;
  const k = (t - st.tw.t0) / 1.6;
  if (k >= 1 || k < 0) { st.tw = null; return target; }
  const e = ease(k), f = st.tw.from;
  return { c: lerp(f.c, target.c, e), h: Math.exp(lerp(Math.log(f.h), Math.log(target.h), e)) };
}
