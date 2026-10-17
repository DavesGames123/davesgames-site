// ============================================================================
//  TENSOR CALCULUS  ·  viz/look.js  ·  colours and label text  (VIZ)
// ----------------------------------------------------------------------------
//  DOM-free. Index colours come only from palette.js (CORE): ic(sym). The
//  other colours here are for objects that have no index: the grid, the
//  vector and covector glyphs of the basis demo, signs of components.
//
//  Labels are small HTML strings (no MathJax per frame): Greek letters as
//  Unicode, upper indices in <sup>, lower indices in <sub>, each index in
//  its own colour and CSS class (.i0-.i7 of style.css).
//
//  EXPORTS   (grep -n "export" look.js)
//      ic(sym) ........ '#rrggbb' of an index (palette.indexColor)
//      LOOK ........... named object colours
//      greek(sym) ..... 'mu' -> 'μ'
//      idx(sym) ....... one coloured index letter (HTML)
//      tn(name, up, dn) a tensor symbol with coloured upper and lower
//                       indices: tn('R', ['rho'], ['sigma','mu','nu'])
//      num(x, d) ...... a number with a true minus sign
//      signColor(x, m)  a diverging colour for a component value
// ============================================================================
import { indexColor, indexClass } from '../palette.js';

export const ic = sym => indexColor(sym);

export const LOOK = {
  bg: ['#141826', '#05060a'],
  fog: '#080a10',
  grid: '#8794b0',
  gridDim: '#4a5470',
  ink: '#eceef2',
  dim: '#9aa3b5',
  vec: '#ffb466',      // a vector (contravariant) with no index of its own
  cov: '#66d9c8',      // a covector (covariant) plane stack
  metric: '#c9a6ff',   // the metric and its ellipses
  pos: '#ff8a5c',      // positive component
  neg: '#5ca8ff',      // negative component
  zero: '#5b6276',
  gold: '#ffd77a',
  surf: '#2a3350',     // a curved surface
  surfHi: '#3c4a75',
  light: '#ffe9a8',    // light cone
};

const GREEK = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ',
  iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ',
  upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};
export const greek = sym => {
  const s = String(sym).replace(/^\\+/, '');
  return GREEK[s] || s;
};
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
export function idx(sym) {
  let cls = '', col = '#ffffff';
  try { cls = indexClass(sym); col = indexColor(sym); } catch (e) { /* palette missing */ }
  return `<span class="${cls}" style="color:${col}">${esc(greek(sym))}</span>`;
}
// a tensor symbol: name, then upper and lower index lists (syms or digits)
export function tn(name, up = [], dn = [], o = {}) {
  const part = list => list.map(s => (/^[0-9]$/.test(String(s)) && !o.colorDigits) ? esc(s) : idx(s)).join('');
  let h = `<i>${esc(greek(name))}</i>`;
  if (up.length && dn.length) h += `<span class="tc-ud"><sup>${part(up)}</sup><sub>${part(dn)}</sub></span>`;
  else if (up.length) h += `<sup>${part(up)}</sup>`;
  else if (dn.length) h += `<sub>${part(dn)}</sub>`;
  return h;
}
export function num(x, d = 2) {
  if (!isFinite(x)) return '∞';
  const s = Math.abs(x) < 0.5 * Math.pow(10, -d) ? (0).toFixed(d) : x.toFixed(d);
  return s.replace('-', '−');
}
// m: the value that maps to the full colour
export function signColor(x, m = 1) {
  const t = Math.min(1, Math.abs(x) / (m || 1));
  const a = [0x5b, 0x62, 0x76].map(v => v / 255);
  const b = (x >= 0 ? [0xff, 0x8a, 0x5c] : [0x5c, 0xa8, 0xff]).map(v => v / 255);
  const k = Math.pow(t, 0.7);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}
