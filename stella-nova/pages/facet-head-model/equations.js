// ============================================================================
//  FACET HEAD MODEL  ·  equations.js — TeX in the article
// ----------------------------------------------------------------------------
//  Typesets each .sci-eq box as MathJax SVG through lib/sci-math.js.
//  Colours follow the figures (lib/sci.css): m1 regional (blue),
//  m2 global (orange), m3 Laplacian targets, m5 position targets.
//  If MathJax does not load, the TeX stays with class "raw".
// ============================================================================
import { typeset } from '../../lib/sci-math.js';

export const RULES = [
  ['\\delta', 'm3'], ['\\xi', 'm5'], ['\\beta', 'm1'], ['N-1', 'm2'], ['w_a', 'm6'],
];
const boxes = [...document.querySelectorAll('.sci-eq[data-tex]')];
Promise.all(boxes.map(el => typeset(el, el.dataset.tex, { rules: RULES }))).catch(err => console.error('[math]', err));
