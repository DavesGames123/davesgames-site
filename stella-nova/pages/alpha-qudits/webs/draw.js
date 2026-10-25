// ============================================================================
//  ALPHA QUDITS  ·  webs/draw.js  ·  canvas helpers of the WEBS figures
// ----------------------------------------------------------------------------
//  Re-exports the colour tokens and text helpers of ../ends/draw.js (read
//  only, so the closing section speaks the page's visual language) and adds
//  the WEBS pieces: a qudit dot by dimension, a link coloured by genre, a
//  grade chip, a dashed "unspecified" link.
//
//  DIMENSION COLOURS   qubit C.qubit (m1), qutrit C.qutrit (m2),
//                      ququart (d = 4) C.imag
//  GRADE COLOURS       data.js GRADE_COLORS
//
//  GREP MAP   (grep -n "export function" draw.js)
//    dimColor, quditDot, linkLine, gradeChip, legendRow, panel
// ============================================================================
export { C, font, label, setBounds, wrap, ease, easeIO, clamp, lerp, rgba, mix, window01, arrow, rrect } from '../ends/draw.js';
import { C, font, label, rgba, rrect } from '../ends/draw.js';
import { GRADE_COLORS, GRADES } from './data.js';

export function dimColor(d) { return d === 2 ? C.qubit : d === 3 ? C.qutrit : C.imag; }
export function dimName(d) { return d === 2 ? 'qubit' : d === 3 ? 'qutrit' : 'ququart'; }

// A qudit at (x, y): radius grows with d; d dots inside mark its directions.
export function quditDot(g, x, y, d, o = {}) {
  const r = o.r || (5 + 2.2 * d), col = dimColor(d);
  g.save(); g.globalAlpha *= o.alpha ?? 1;
  g.fillStyle = rgba(col, 0.2); g.strokeStyle = col; g.lineWidth = o.ghost ? 1.2 : 2;
  if (o.ghost) g.setLineDash([3, 3]);
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.stroke();
  g.setLineDash([]); g.fillStyle = col;
  for (let i = 0; i < d; i++) {
    const a = -Math.PI / 2 + i * 2 * Math.PI / d, rr = d === 1 ? 0 : r * 0.45;
    g.beginPath(); g.arc(x + Math.cos(a) * rr, y + Math.sin(a) * rr, Math.max(1.4, r * 0.14), 0, Math.PI * 2); g.fill();
  }
  g.restore();
}

// A link from a to b. o.dashed: a link whose count or far end the deck does
// not give. o.heavy: a read line. The colour mixes the two end colours.
export function linkLine(g, ax, ay, bx, by, o = {}) {
  g.save(); g.globalAlpha *= o.alpha ?? 1;
  const grad = typeof g.createLinearGradient === 'function' ? g.createLinearGradient(ax, ay, bx, by) : null;
  const ca = dimColor(o.da || 2), cb = dimColor(o.db || 2);
  if (grad && grad.addColorStop) { grad.addColorStop(0, ca); grad.addColorStop(1, cb); g.strokeStyle = o.color || grad; } else g.strokeStyle = o.color || ca;
  g.lineWidth = o.heavy ? 5 : o.w || 2.4; g.lineCap = 'round';
  if (o.dashed) g.setLineDash([5, 5]);
  g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
  g.restore();
}

// A rounded chip with the grade's colour; returns its width.
export function gradeChip(g, x, y, grade, o = {}) {
  const txt = o.text || GRADES[grade] || grade, col = GRADE_COLORS[grade] || C.dim, px = o.px || 11.5;
  g.save(); g.font = font(px, 600);
  const w = g.measureText(txt).width + 14, h = px + 9;
  const x0 = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
  g.fillStyle = rgba(col, 0.16); g.strokeStyle = rgba(col, 0.75); g.lineWidth = 1;
  rrect(g, x0, y - h / 2, w, h, h / 2); g.fill(); g.stroke();
  g.restore();
  label(g, txt, x0 + w / 2, y + 0.5, { font: font(px, 600), color: col, halo: false });
  return w;
}

// A soft panel behind a group of labels.
export function panel(g, x, y, w, h, o = {}) {
  g.save(); g.fillStyle = o.fill || C.panel; g.strokeStyle = o.stroke || C.line; g.lineWidth = 1;
  rrect(g, x, y, w, h, o.r || 10); g.fill(); g.stroke(); g.restore();
}

// A legend of grades in a row (wraps to two rows when narrow); returns height.
export function legendRow(g, x, y, w, grades, o = {}) {
  let cx = x, cy = y; const gap = 6, rowH = 22;
  for (const k of grades) {
    g.save(); g.font = font(o.px || 11.5, 600); const cw = g.measureText(GRADES[k]).width + 14; g.restore();
    if (cx + cw > x + w && cx > x) { cx = x; cy += rowH; }
    gradeChip(g, cx, cy, k, { px: o.px });
    cx += cw + gap;
  }
  return cy - y + rowH;
}
