// ============================================================================
//  LENIA  ·  app/equations.js — the MathJax lines for the current rule
// ----------------------------------------------------------------------------
//  tex() typesets one TeX string as color-coded MathJax SVG.
//  renderEquations() fills #eqs with G(u) and K_c(r) of the current rule.
//
//  GREP MAP
//    grep -n 'function tex'              typeset one TeX string
//    grep -n 'function renderEquations'  the #eqs lines
// ============================================================================
import { typeset } from '../../../lib/sci-math.js';
import { RULES, CORE_TEX, growthTeX } from './tex.js';
import { $, S } from './state.js';

// Typeset one TeX string into el as color-coded MathJax SVG.
export function tex(el, src, display = true) {
  el.classList.add('sci-eq');
  return typeset(el, src, { display, rules: RULES });
}
export function renderEquations() {
  const c = S.c;
  if (!c) return;
  const box = $('eqs');
  box.textContent = '';
  const add = src => { const d = document.createElement('div'); d.className = 'eq'; tex(d, src); box.append(d); };
  add(growthTeX(c.gn, S.rule.m, S.rule.s));
  add(CORE_TEX[c.kn - 1] + (c.b.length > 1 ? String.raw`,\quad \beta = (${c.b.map(v => +v.toFixed(3)).join(',\\ ')})` : ''));
}
