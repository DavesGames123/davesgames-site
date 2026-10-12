// ============================================================================
//  ANTENNA FIELDS  ·  equations.js — the equations in the panel
// ----------------------------------------------------------------------------
//  Typesets each .sci-eq box in #panel as MathJax SVG through
//  lib/sci-math.js. The TeX is in index.html. Each symbol has the colour of
//  its field on screen (lib/sci.css):
//      m2  E                      m1  B, H
//      m3  S, U (energy flow)     m5  the current I, J, V
//      m6  beta, theta_s (phase)  m4  D, P_rad
//  If MathJax does not load, the TeX stays in the box with the class "raw".
//  window.AF_RULES gives the same rules to the saver plate.
// ============================================================================
import { typeset } from '../../lib/sci-math.js';

export const RULES = [
  ['\\vec E', 'm2'], ['E_\\theta', 'm2'], ['E', 'm2'],
  ['\\vec B', 'm1'], ['\\vec H', 'm1'], ['H_\\phi', 'm1'], ['B', 'm1'], ['H', 'm1'],
  ['\\vec S', 'm3'], ['S_r', 'm3'], ['U_\\text{max}', 'm3'], ['U', 'm3'],
  ['I_m', 'm5'], ['I_n', 'm5'], ['I', 'm5'], ['\\vec J', 'm5'], ['V_m', 'm5'],
  ['\\beta', 'm6'], ['\\theta_s', 'm6'],
  ['P_\\text{rad}', 'm4'], ['D', 'm4'],
];
window.AF_RULES = RULES;
const boxes = [...document.querySelectorAll('#panel .sci-eq[data-tex]')];
Promise.all(boxes.map(el => typeset(el, el.dataset.tex, { rules: RULES }))).catch(err => console.error('[math]', err));
