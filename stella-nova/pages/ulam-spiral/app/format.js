// ============================================================================
//  ULAM SPIRAL  ·  app/format.js — number and lattice-number text
// ----------------------------------------------------------------------------
//  Pure functions, no DOM. The readout card, the status line, the sieve
//  note, the overlay labels and the saver plates (app.fmt, app.fmtS) all
//  print numbers through these.
//
//  GREP MAP
//    grep -n 'export function fmt'     1,234,567 (or 1.234×10^16 past 1e16)
//    grep -n 'export const fmtS'       1.23×10⁸: short, for the status line
//    grep -n 'export const gaussText'  a + bi with a true minus sign
//    grep -n 'export const eisenText'  a + bω with a true minus sign
// ============================================================================

export function fmt(n) {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e16) return n.toExponential(3).replace('e+', '×10^');
  return Math.round(n).toLocaleString('en-US');
}
export const fmtS = n => (n >= 1e6 ? (n / 10 ** Math.floor(Math.log10(n))).toFixed(2) + '×10' + String(Math.floor(Math.log10(n))).split('').map(d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]).join('') : fmt(n));

// One template for both rings: unit is 'i' (Gaussian) or 'ω' (Eisenstein).
const ringText = unit => (a, b) => (b === 0 ? `${a}` : a === 0 ? `${b === 1 ? '' : b === -1 ? '−' : b}${unit}` : `${a}${b < 0 ? '−' : '+'}${Math.abs(b) === 1 ? '' : Math.abs(b)}${unit}`).replace(/-/g, '−');
export const gaussText = ringText('i');
export const eisenText = ringText('ω');
