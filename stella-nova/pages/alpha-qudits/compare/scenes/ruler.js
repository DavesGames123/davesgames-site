// ============================================================================
//  ALPHA QUDITS  ·  compare/scenes/ruler.js  ·  the measurement ruler (DOM-free)
// ----------------------------------------------------------------------------
//  Our drawing of the comparison of the paper's Fig. 3: the four most
//  precise determinations of 1/alpha(0), each with its one-standard-
//  deviation bar, and the candidate 1/alpha_cand as a dashed gold line.
//  The view zooms from a window 2.6 wide around 137 down to 2.6 x 10^-7,
//  where the paper's own axis (1/alpha - 137.035 999) x 10^9 is readable.
//  Zoom is z in [0, 1]; the half width of the view is 1.3 x 10^(-7 z).
//
//  grep -n targets:  export function halfAt | export function zForHalf |
//  export function axisLabels | function zAt | draw(g
// ============================================================================
import { C, text, line, dot, niceStep, ticks, clamp, lerp, ease, fitSize, backdrop, rgba, measure } from '../draw.js';
import { fmtGroup, fmtSigma, fmtSci, sup } from '../data.js';

// Centre of every view. The lowest bar (Cs, 137.035 999 019) and the
// highest (Rb, 137.035 999 217) both fit at full zoom, and the view starts
// above 137.035 999, so the deep axis reads as in the paper.
export const CENTER = 137.0359991325;
const H0 = 1.3, H1 = 1.3e-7, LN0 = Math.log(H0), LN1 = Math.log(H1);
export const halfAt = z => Math.exp(lerp(LN0, LN1, clamp(z)));
export const zForHalf = h => clamp((LN0 - Math.log(h)) / (LN0 - LN1));
export const PRESETS = [
  { id: 'whole', label: '137', z: 0 },
  { id: 'milli', label: '10⁻³', z: zForHalf(1.3e-3) },
  { id: 'micro', label: '10⁻⁶', z: zForHalf(1.3e-6) },
  { id: 'nano', label: '10⁻⁹', z: 1 },
];
const PERIOD = 17;

// Tick labels for a view [lo, hi] and a width in px. Returns { ticks:
// [{ v, label }], title }. A wide view labels values; a narrow one labels
// (1/alpha - B) x 10^k, the way the paper's Fig. 3 does.
export function axisLabels(lo, hi, px) {
  const span = hi - lo, step = niceStep(span, Math.max(2, Math.min(8, Math.floor(px / 62))));
  const q = Math.floor(Math.log10(step) + 1e-9);
  const tk = ticks(lo, hi, step);
  if (span >= 2e-3) {
    const dp = Math.max(0, -q);
    return { ticks: tk.map(v => ({ v, label: fmtGroup(v.toFixed(dp)) })), title: '1/α', offset: false };
  }
  const p = Math.ceil(Math.log10(span) - 1e-9);
  const Bk = Math.floor(lo / 10 ** p + 1e-9), B = Bk * 10 ** p;
  const Bs = fmtGroup(B.toFixed(Math.max(0, -p)));
  // label unit 10^u: a multiple of 3 when one fits (10^9 as in the paper)
  let u = q;
  for (let m = q; m >= p - 3; m--) if (m % 3 === 0) { u = m; break; }
  const scale = 10 ** (p - u);
  return {
    ticks: tk.map(v => ({ v, label: String(Math.round(v / 10 ** u - Bk * scale)) })),
    title: `(1/α − ${Bs}) × 10${sup(-u)}`, offset: true,
  };
}

export default {
  id: 'ruler',
  title: 'Against the measurements',
  init(env) {
    const st = { auto: !env.reduced && !env.fill ? true : !!env.fill, z: env.reduced ? 1 : 0, tw: null, t: 0, reduced: !!env.reduced, drag: null };
    if (env.params) this.show(st, env.params);
    return st;
  },
  show(st, p = {}) {
    if (p.z != null) this.setZ(st, p.z, !p.animate);
    if (p.preset) { const pr = PRESETS.find(x => x.id === p.preset); if (pr) this.setZ(st, pr.z); }
    if (p.auto != null) st.auto = !!p.auto && !st.reduced;
  },
  setZ(st, z, instant = false) {
    const cur = zAt(st, st.t);
    st.auto = false;
    st.tw = instant || st.reduced ? null : { from: cur, to: clamp(z), t0: st.t, dur: 1.6 };
    st.z = clamp(z);
  },
  height(w) { return w < 480 ? 318 : 330; },
  caption(st, F) {
    const z = zAt(st, st.t), h = halfAt(z);
    const cod = F.meas.find(m => m.id === 'codata2022');
    const d9 = cod ? (F.cand.invF - cod.v) * 1e9 : 0;
    if (h > 1e-5) return `View ${fmtSci(2 * h)} wide: at this scale the candidate and all four measurements fall on one pixel.`;
    return cod ? `Candidate − CODATA 2022 = ${d9 >= 0 ? '+' : '−'}${Math.abs(d9).toFixed(1)} × 10⁻⁹ = ${fmtSigma(cod.sigma)}. View ${fmtSci(2 * h)} wide.` : '';
  },
  controls(st, ui) {
    const g = ui.group('Zoom');
    ui.button(g, 'Auto', () => { st.auto = true; st.tw = null; ui.redraw(); }, { pressed: () => st.auto });
    for (const p of PRESETS) ui.button(g, p.label, () => { this.setZ(st, p.z); ui.redraw(); }, { pressed: () => !st.auto && Math.abs(st.z - p.z) < 1e-6, aria: `Zoom to a view about ${p.label} wide` });
    ui.hint('Drag the ruler sideways to zoom.');
  },
  pointer(st, ev, box) {
    if (ev.type === 'down') st.drag = { x: ev.x, z: zAt(st, st.t) };
    else if (ev.type === 'move' && st.drag) {
      const z = clamp(st.drag.z + (ev.x - st.drag.x) / Math.max(200, box.w) * 1.2);
      st.auto = false; st.tw = null; st.z = z;
      return true;
    } else if (ev.type === 'up') st.drag = null;
    return false;
  },
  draw(g, box, t, st, F) {
    st.t = t;
    const z = zAt(st, t), half = halfAt(z), lo = CENTER - half, hi = CENTER + half;
    const fill = !!box.fill;
    backdrop(g, box, C.val, 0.04);
    const pad = box.w < 420 ? 12 : 22, x0 = box.x + pad, x1 = box.x + box.w - pad, W = x1 - x0;
    const X = v => x0 + (v - lo) / (hi - lo) * W;
    const topH = 46, axisH = 54;
    const rowsH = box.h - topH - axisH, rowH = rowsH / Math.max(1, F.meas.length);
    const y0 = box.y + topH, yAxis = box.y + box.h - axisH + 6;
    // grid and axis
    const ax = axisLabels(lo, hi, W);
    for (const tk of ax.ticks) {
      const x = X(tk.v); if (x < x0 - 1 || x > x1 + 1) continue;
      line(g, x, y0 - 4, x, yAxis, C.grid, 1);
      line(g, x, yAxis, x, yAxis + 5, C.dim, 1);
      text(g, tk.label, x, yAxis + 18, { size: 11, color: C.dim, align: 'center' });
    }
    line(g, x0, yAxis, x1, yAxis, C.line2, 1);
    text(g, ax.title, box.x + box.w / 2, yAxis + 36, { size: fitSize(g, ax.title, W, 12), color: C.ink2, align: 'center' });
    // the rows
    const cx = X(F.cand.invF);
    F.meas.forEach((m, i) => {
      const ry = y0 + i * rowH, by = ry + rowH * 0.66;
      const lab = `${m.label}  ${m.short}`;
      const sig = fmtSigma(m.sigma);
      const sw = 54;
      text(g, lab, x0, ry + 15, { size: fitSize(g, lab, W - sw - 8, 12.5), color: C.ink2 });
      text(g, sig, x1, ry + 15, { size: 12.5, color: Math.abs(m.sigma) < 2 ? C.ink : C.qt, align: 'right', w: 600 });
      line(g, x0, by, x1, by, rgba('#ffffff', 0.04), 1);
      const xa = X(m.v - m.u), xb = X(m.v + m.u), xm = X(m.v);
      const visible = xb >= x0 && xa <= x1;
      if (visible) {
        const ca = Math.max(x0, xa), cb = Math.min(x1, xb);
        if (cb - ca >= 3) {
          line(g, ca, by, cb, by, C.ink, 2.2);
          if (xa >= x0) line(g, xa, by - 6, xa, by + 6, C.ink, 1.6);
          if (xb <= x1) line(g, xb, by - 6, xb, by + 6, C.ink, 1.6);
        }
        if (xm >= x0 && xm <= x1) {
          if (m.id === 'codata2022') dot(g, xm, by, 4.6, C.card, C.ink, 1.8);
          else dot(g, xm, by, 4.2, C.ink);
        }
      } else {
        // an off-view marker at the edge
        const left = xb < x0, ex = left ? x0 + 6 : x1 - 6;
        g.beginPath(); g.moveTo(ex + (left ? -6 : 6), by); g.lineTo(ex, by - 5); g.lineTo(ex, by + 5); g.closePath(); g.fillStyle = C.dim; g.fill();
      }
    });
    // the candidate
    if (cx >= x0 - 2 && cx <= x1 + 2) {
      line(g, cx, y0 - 6, cx, yAxis, C.val, 1.6, [5, 4]);
      const lab = `1/α cand = ${fmtGroup(F.cand.inv.slice(0, 14))}…`;
      const size = fitSize(g, lab, W, 13);
      const tw = g.measureText(lab).width;
      const lx = clamp(cx - tw / 2, x0, x1 - tw);
      text(g, lab, lx, box.y + 22, { size, color: C.val, w: 600 });
      line(g, cx, box.y + 28, cx, y0 - 6, rgba(C.val, 0.6), 1);
    }
    // at wide views the bars are far below one pixel: say so in the footer
    const spread = Math.abs(X(137.035999206) - X(137.035999046));
    if (!fill) {
      let s = spread < 2 ? 'the candidate and all four values share one pixel here' : 'bars: one standard deviation';
      if (measure(g, s, { size: 11, it: true }) > W) s = 'all five values share one pixel here';
      text(g, s, x0, box.y + box.h - 2, { size: fitSize(g, s, W, 11), color: C.dim, it: spread < 2 });
    }
  },
};

function zAt(st, t) {
  if (st.auto) {
    const k = ((t % PERIOD) + PERIOD) % PERIOD;
    if (k < 1.5) return 0;
    if (k < 8) return ease((k - 1.5) / 6.5);
    if (k < 14) return 1;
    return 1 - ease((k - 14) / 3);
  }
  if (st.tw) {
    const k = (t - st.tw.t0) / st.tw.dur;
    if (k >= 1 || k < 0) { st.tw = null; return st.z; }
    return lerp(st.tw.from, st.tw.to, ease(k));
  }
  return st.z;
}
export { zAt };
