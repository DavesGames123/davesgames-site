// ============================================================================
//  THUNDER ACOUSTICS  ·  equations.js — the equations in the panel
// ----------------------------------------------------------------------------
//  Typesets each .sci-eq box in #panel as MathJax SVG through
//  lib/sci-math.js. The TeX is in index.html. Colours (lib/sci.css):
//      m4  E_l, R_0          m2  f_m           m1  c, T, c_0
//      m3  r, r_i            m6  sigma         m5  p(t)
//  If MathJax does not load, the TeX stays in the box with the class "raw".
// ============================================================================
import { typeset } from '../../lib/sci-math.js';

export const RULES = [
  ['E_l', 'm4'], ['R_0', 'm4'], ['f_m', 'm2'], ['c_0', 'm1'], ['c(z)', 'm1'],
  ['r_i', 'm3'], ['p(t)', 'm5'], ['\\sigma', 'm6'], ['T', 'm1'], ['c', 'm1'],
];
window.TA_RULES = RULES;
const boxes = [...document.querySelectorAll('#panel .sci-eq[data-tex]')];
Promise.all(boxes.map(el => typeset(el, el.dataset.tex, { rules: RULES }))).catch(err => console.error('[math]', err));
