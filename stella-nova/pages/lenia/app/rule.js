// ============================================================================
//  LENIA  ·  app/rule.js — the m, s, T and scale sliders
// ----------------------------------------------------------------------------
//  One row per rule value, built again for each creature. A slider sends
//  the live rule to the engine. A new scale stamps the creature again.
//
//  GREP MAP
//    grep -n 'const RULE_ROWS'     the rows and their ranges
//    grep -n 'function buildRule'  build the rows for S.c
// ============================================================================
import { typeset } from '../../../lib/sci-math.js';
import { RULES, RULE_CLASS } from './tex.js';
import { $, S, det } from './state.js';
import { engineRule, placeCreature } from './creature.js';
import { drawPlots } from './plots.js';
import { renderEquations } from './equations.js';

const RULE_ROWS = [
  { key: 'm', sym: 'm', word: 'center', min: 0.01, max: 0.6, step: 0.001, dec: 3 },
  { key: 's', sym: 's', word: 'width', min: 0.0005, max: 0.1, step: 0.0001, dec: 4 },
  { key: 'T', sym: 'T', word: 'steps', min: 1, max: 50, step: 1, dec: 0 },
  { key: 'scale', label: 'Scale', min: 0.4, max: 2.5, step: 0.05, dec: 2 },
];
export function buildRule() {
  const box = $('rule');
  box.textContent = '';
  const c = S.c;
  for (const r of RULE_ROWS) {
    const row = document.createElement('div'); row.className = 'row';
    const lab = document.createElement('label'); lab.htmlFor = 'r-' + r.key; lab.title = r.word ? `${r.sym} · ${r.word}` : r.label;
    // A rule symbol shows as MathJax SVG in its equation color (RULES).
    if (r.sym) {
      const m = document.createElement('span'); m.className = 'sci-sym ' + RULE_CLASS[r.sym]; m.textContent = r.sym;
      const w = document.createElement('small'); w.textContent = r.word;
      lab.append(m, w);
      typeset(m, r.sym, { display: false, rules: RULES });
    } else lab.textContent = r.label;
    const inp = document.createElement('input'); inp.type = 'range'; inp.id = 'r-' + r.key;
    const base = r.key === 'scale' ? c.scale : c[r.key];
    inp.min = Math.min(r.min, base); inp.max = Math.max(r.max, base * 2); inp.step = r.step; inp.value = S.rule[r.key];
    const val = document.createElement('span'); val.className = 'val acc';
    const rst = document.createElement('button'); rst.className = 'rst'; rst.textContent = '↺'; rst.title = 'Back to the catalog value';
    const show = () => {
      const v = S.rule[r.key];
      val.textContent = r.key === 'scale' ? `×${v.toFixed(2)}` : v.toFixed(r.dec);
      rst.classList.toggle('same', Math.abs(v - base) < r.step / 2);
      if (r.key === 'scale') lab.textContent = `R = ${Math.round(c.R * v * det() * 10) / 10}`;
    };
    const set = (v, commit) => {
      S.rule[r.key] = v;
      show();
      if (S.engine) {
        S.engine.setRule(engineRule());
        if (r.key === 'scale' && commit) placeCreature();
      }
      drawPlots();
      renderEquations();
    };
    inp.addEventListener('input', () => set(+inp.value, false));
    // A new scale changes R, and the creature must be drawn again at that size.
    if (r.key === 'scale') inp.addEventListener('change', () => set(+inp.value, true));
    rst.addEventListener('click', () => { inp.value = base; set(base, true); });
    show();
    row.append(lab, inp, val, rst);
    box.append(row);
  }
}
