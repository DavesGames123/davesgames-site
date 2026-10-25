// ============================================================================
//  ALPHA QUDITS  ·  compare/scenes/digits.js  ·  the digit stream (DOM-free)
// ----------------------------------------------------------------------------
//  Top: the 60 decimals of 1/alpha_cand roll in, three to a group, from the
//  exact form (MODEL value().inverseDigits(60): BigInt integer square
//  roots, both bounds agree). Bottom: the four measured values under the
//  candidate's first decimals, digit by digit. A digit that matches the
//  candidate is bright, the first one that differs is orange, and the
//  measured value stops at the ninth decimal, where its bracketed
//  uncertainty sits. Past that point only the closed form has digits.
//
//  grep -n targets:  export function layoutDigits | export function agreeCount |
//  export function revealAt | draw(g
// ============================================================================
import { C, text, line, clamp, backdrop, fitSize, rgba, easeOut } from '../draw.js';
import { numText } from '../data.js';

const RATE = 7.5;              // digits per second
const NDEC = 60;

// Geometry of the stream for a width: digit size, cell width, groups per
// line and the line count.
export function layoutDigits(w) {
  const size = w < 400 ? 17 : w < 640 ? 20 : 23;
  const cell = Math.round(size * 0.64), gap = Math.round(size * 0.42);
  const pad = w < 420 ? 12 : 22;
  const intW = cell * 4;                       // '137.'
  const groupW = cell * 3 + gap;
  const per = Math.max(2, Math.floor((w - 2 * pad - intW + gap) / groupW));
  const lines = Math.ceil(NDEC / 3 / per);
  return { size, cell, gap, pad, intW, groupW, per, lines, lineH: Math.round(size * 1.55) };
}
// x of decimal i (0-based) and its line, in the layout.
function decPos(L, i) {
  const gi = Math.floor(i / 3), li = Math.floor(gi / L.per), gk = gi % L.per;
  return { x: L.pad + L.intW + gk * L.groupW + (i % 3) * L.cell, line: li };
}
// How many leading significant digits of a measured value agree with
// the candidate (both as digit strings).
export function agreeCount(cand, meas) {
  const a = cand.replace('.', ''), b = meas.replace('.', '');
  let n = 0;
  while (n < b.length && a[n] === b[n]) n++;
  return n;
}
// Number of characters of the stream shown at t ('137.' counts as 4).
export const revealAt = (t, reduced) => reduced ? 4 + NDEC : clamp(Math.floor(4 + t * RATE), 4, 4 + NDEC);

export default {
  id: 'digits',
  title: 'Every digit fixed in advance',
  init(env) { return { t: 0, reduced: !!env.reduced, t0: 0 }; },
  show(st) { st.t0 = st.t; },
  height(w) {
    const L = layoutDigits(w);
    return 40 + L.lines * L.lineH + 26 + 30 + 5 * Math.round(L.size * 1.05 + 20) + 26;
  },
  caption(st, F) {
    const cod = F.meas.find(m => m.id === 'codata2022');
    const n = cod ? agreeCount(F.cand.inv, cod.value) : 0;
    return `CODATA 2022 and the candidate share their first ${n} significant digits; the measured value ends at the ninth decimal, the closed form does not.`;
  },
  controls(st, ui) {
    const g = ui.group('Stream');
    ui.button(g, 'Replay', () => { st.t0 = st.t; ui.redraw(); }, { aria: 'Roll the digits in again' });
  },
  draw(g, box, t, st, F) {
    st.t = t;
    const L = layoutDigits(box.w);
    const local = Math.max(0, t - st.t0);
    const shown = revealAt(local, st.reduced);
    backdrop(g, box, C.val, 0.045);
    const X = box.x, Y = box.y;
    const inv = F.cand.inv;                       // '137.' + decimals
    const dec = inv.split('.')[1] || '';
    // the exact form
    const form = `(${numText(F.cand.num)}) / ${F.cand.den}`;
    text(g, 'α cand  =  ', X + L.pad, Y + 22, { size: 12, color: C.dim });
    const fx = X + L.pad + g.measureText('α cand  =  ').width;
    text(g, form, fx, Y + 22, { size: fitSize(g, form, box.w - (fx - X) - L.pad, 14, { fam: 'serif' }), color: C.val, fam: 'serif' });
    // the stream
    const sy = Y + 40;
    const font = { size: L.size, fam: 'mono', w: 600 };
    const draw1 = (ch, x, y, col, alpha = 1) => text(g, ch, x, y, { ...font, color: col, alpha });
    const base = (li) => sy + (li + 1) * L.lineH - L.lineH * 0.3;
    for (let k = 0; k < 4 && k < shown; k++) draw1('137.'[k], X + L.pad + k * L.cell, base(0), C.val);
    for (let i = 0; i < NDEC; i++) {
      const p = decPos(L, i), idx = 4 + i;
      if (idx >= shown + 3) break;
      const y = base(p.line), x = X + p.x;
      if (idx < shown) {
        const age = local - (idx - 4) / RATE;
        const glow = st.reduced ? 0 : clamp(1 - age / 1.2);
        if (glow > 0) { g.fillStyle = rgba(C.val, 0.18 * glow); g.fillRect(x - 1, y - L.size * 0.85, L.cell, L.size * 1.1); }
        draw1(dec[i], x, y, i < 9 ? C.val : C.ink);
      } else {
        // the next few digits roll before they settle
        const r = Math.floor((t * 23 + i * 7) % 10);
        draw1(String(r), x, y, C.faint, 0.8);
      }
    }
    // index marks under decimals 9 and 60
    const markAt = (i, s) => { const p = decPos(L, i); text(g, s, X + p.x + L.cell / 2, base(p.line) + L.size * 0.62, { size: 11, color: C.dim, align: 'center' }); };
    if (shown > 4 + 9) markAt(8, '10⁻⁹');
    if (shown >= 4 + NDEC) markAt(NDEC - 1, '10⁻⁶⁰');
    // the comparison
    let y = sy + L.lines * L.lineH + 26;
    line(g, X + L.pad, y - 12, X + box.w - L.pad, y - 12, C.line2, 1);
    text(g, 'Against the measurements, digit by digit', X + L.pad, y + 4, { size: 12.5, color: C.ink2, w: 600 });
    y += 16;
    const rowH = Math.round(L.size * 1.05 + 20);
    const cmpDec = 12;
    let rows = [{ label: '1/α cand (this paper’s closed form)', value: inv.slice(0, 4 + cmpDec), unc: null, cand: true }, ...F.meas.map(m => ({ id: m.id, label: m.label, value: m.value, unc: m.short.match(/\((\d+)\)/)?.[1] || '', cand: false }))];
    // Fill mode (the saver) in a short band: keep the rows that fit, CODATA
    // first, then the electron moment, rubidium and cesium. With no room
    // for the candidate and one measurement, draw the stream alone.
    if (box.fill) {
      const fit = Math.floor((Y + box.h - y - 30) / rowH);
      if (fit < rows.length) {
        if (fit < 2) return;
        const keep = new Set(['codata2022', 'g2', 'rb2020', 'cs2018'].slice(0, fit - 1));
        rows = rows.filter(r => r.cand || keep.has(r.id));
      }
    }
    const cellB = Math.round(L.cell * 1.0), fontB = { size: L.size, fam: 'mono', w: 600 };
    const xB = i => X + L.pad + (i < 4 ? i * cellB : 4 * cellB + (i - 4) * cellB + Math.floor((i - 4) / 3) * L.gap);
    const progress = st.reduced ? 1 : clamp((shown - 4) / 12);
    rows.forEach((r, ri) => {
      const ry = y + ri * rowH;
      const n = r.cand ? r.value.length : agreeCount(inv, r.value);
      const sub = r.cand ? '' : `  ·  first ${n} digits agree`;
      text(g, r.label + sub, X + L.pad, ry + 12, { size: fitSize(g, r.label + sub, box.w - 2 * L.pad, 11.5), color: r.cand ? C.val : C.dim });
      const by = ry + 12 + L.size * 1.05;
      const chars = r.value.split('');
      const nShow = Math.floor(chars.length * (r.cand ? 1 : easeOut(progress)) + 0.0001);
      let firstOff = -1;
      chars.forEach((ch, i) => {
        if (i >= nShow) return;
        let col = C.val;
        if (!r.cand) {
          const same = inv[i] === ch;
          if (!same && firstOff < 0) firstOff = i;
          col = firstOff < 0 ? C.ink : i === firstOff ? C.qt : C.dim;
        }
        text(g, ch, xB(i), by, { ...fontB, color: col });
      });
      if (!r.cand && nShow >= chars.length && r.unc) {
        const ux = xB(chars.length) + 2;
        text(g, `(${r.unc})`, ux, by, { size: L.size * 0.72, fam: 'mono', color: C.dim });
      }
      if (r.cand) text(g, '…', xB(chars.length), by, { ...fontB, color: C.dim });
    });
    // where the measurements stop: after decimal 9 (index 4 + 9)
    const xs = xB(13) - Math.max(2, L.gap / 2);
    for (let ri = 1; ri < rows.length; ri++) { const by = y + ri * rowH + 12 + L.size * 1.05; line(g, xs, by - L.size * 0.9, xs, by + 5, rgba(C.ink2, 0.55), 1, [3, 3]); }
    text(g, '↑ measurements end here', Math.max(X + L.pad, Math.min(xs - 6, X + box.w - L.pad - 150)), y + rows.length * rowH + 14, { size: 11, color: C.dim, it: true });
  },
};
