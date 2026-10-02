// ============================================================================
//  REACTION–DIFFUSION  ·  equation renderer  (ES module)
// ----------------------------------------------------------------------------
//  Typesets the TeX strings of a preset (presets.json "equations", one per
//  chemical) as color-coded MathJax SVG through lib/sci-math.js. If MathJax
//  does not load, or a string does not parse, the plain TeX text stays on
//  the page.
//
//  COLORS. Chemical a, b, c, d get .m1 to .m4. A diffusion constant D_x of a
//  chemical x gets the color of x. The other parameters take the remaining
//  classes in turn. The parameter labels in the panel use the same classes.
//
//  EXPORTS   (jump with grep -n "<anchor>" equations.js)
//  --------------------------------------------------------------------------
//      paramTeX ......... "export function paramTeX"        name -> TeX symbol
//      presetRules ...... "export function presetRules"     symbol -> class
//      renderTeX ........ "export function renderTeX"       one string, one box
//      renderEquations .. "export function renderEquations" a list of boxes
//      GENERAL .......... "export const GENERAL"            the general form
// ============================================================================
import { typeset } from '../../lib/sci-math.js';

// The general form of a two-chemical reaction–diffusion system.
export const GENERAL = String.raw`\begin{aligned}\frac{\partial a}{\partial t} &= D_a\,\nabla^2 a + f(a,b)\\[2pt] \frac{\partial b}{\partial t} &= D_b\,\nabla^2 b + g(a,b)\end{aligned}`;
export const GENERAL_RULES = [['a', 'm1'], ['b', 'm2'], ['D_a', 'm1'], ['D_b', 'm2']];

const CHEMS = ['a', 'b', 'c', 'd'];
const GREEK = new Set(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'rho', 'sigma', 'tau', 'phi', 'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Phi', 'Psi', 'Omega']);

// A parameter name from presets.json ('D_a', 'Da', 'k1', 'mu1', 'epsilon')
// as a TeX symbol, or null when the name is a word ('rampPower').
export function paramTeX(name) {
  let m;
  if (/^[A-Za-z]$/.test(name)) return name;
  if ((m = /^D_?([a-d])$/.exec(name))) return `D_${m[1]}`;
  if ((m = /^([A-Za-z]+?)(\d+)$/.exec(name)) && (m[1].length === 1 || GREEK.has(m[1]))) {
    const base = m[1].length === 1 ? m[1] : '\\' + m[1];
    return m[2].length === 1 ? `${base}_${m[2]}` : `${base}_{${m[2]}}`;
  }
  if (GREEK.has(name)) return '\\' + name;
  if ((m = /^([A-Za-z])_([A-Za-z0-9]+)$/.exec(name))) return m[2].length === 1 ? name : `${m[1]}_{${m[2]}}`;
  return null;
}

// The color rules of a preset: [[TeX symbol, class], ...]. Also returns a
// map from parameter name to class, for the panel labels.
export function presetRules(p) {
  const n = Math.max(1, Math.min(4, p.chemicals || (p.names || []).length || 2));
  const rules = [], byName = {};
  for (let i = 0; i < n; i++) rules.push([CHEMS[i], 'm' + (i + 1)]);
  const free = [];
  for (let i = n + 1; i <= 6; i++) free.push('m' + i);
  let k = 0;
  for (const q of p.params || []) {
    const sym = paramTeX(q.name);
    if (!sym) continue;
    const d = /^D_([a-d])$/.exec(sym);
    const cls = d && CHEMS.indexOf(d[1]) < n ? 'm' + (CHEMS.indexOf(d[1]) + 1) : free[k++ % free.length];
    byName[q.name] = cls;
    rules.push([sym, cls]);
    // The presets write some Greek letters in two forms.
    if (sym.startsWith('\\epsilon')) rules.push([sym.replace('\\epsilon', '\\varepsilon'), cls]);
    if (sym.startsWith('\\theta')) rules.push([sym.replace('\\theta', '\\vartheta'), cls]);
    if (sym.startsWith('\\phi')) rules.push([sym.replace('\\phi', '\\varphi'), cls]);
  }
  return { rules, byName };
}

// Typeset one TeX string into el.
export function renderTeX(el, tex, rules = null, display = true) {
  el.classList.add('sci-eq');
  return typeset(el, tex, { display, rules });
}

// Replace the content of box with one .eq line per TeX string.
export function renderEquations(box, list, rules = null) {
  box.textContent = '';
  for (const tex of list || []) {
    const d = document.createElement('div');
    d.className = tex.length > 90 ? 'eq long' : 'eq';
    box.appendChild(d);
    renderTeX(d, tex, rules);
  }
  if (!list || !list.length) {
    const d = document.createElement('div');
    d.className = 'hint'; d.textContent = 'No equations given for this preset.';
    box.appendChild(d);
  }
}
