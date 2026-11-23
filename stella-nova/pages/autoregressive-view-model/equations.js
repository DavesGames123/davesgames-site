// ============================================================================
//  AUTOREGRESSIVE VIEW MODEL  ·  equations.js — TeX in the article
// ----------------------------------------------------------------------------
//  Typesets each .sci-eq box as MathJax SVG through lib/sci-math.js.
//  Colours follow the lab (lib/sci.css): m6 sink, m3 retrieved, m2 motion,
//  m1 target. If MathJax does not load, the TeX stays with class "raw".
// ============================================================================
import { typeset } from '../../lib/sci-math.js';

export const RULES = [
  ['L_\\text{sin}', 'm6'], ['L_\\text{rtr}', 'm3'], ['L_\\text{mot}', 'm2'], ['L_\\text{tgt}', 'm1'],
  ['\\hat v', 'm1'], ['\\epsilon', 'm4'],
];
const boxes = [...document.querySelectorAll('.sci-eq[data-tex]')];
Promise.all(boxes.map(el => typeset(el, el.dataset.tex, { rules: RULES }))).catch(err => console.error('[math]', err));
