// ============================================================================
//  ANTENNA FIELDS  ·  equations.js — the equation panel  (ES module)
// ----------------------------------------------------------------------------
//  Typesets each [data-tex] box in #eqPanel as MathJax SVG through
//  lib/sci-math.js, and wires the collapse toggle. The TeX is in index.html.
//  The colour of a quantity is the same in every formula and in the control
//  labels (main.js uses the same RULES through AF_RULES):
//      m2  E fields          m1  H fields          m5  currents, voltage
//      m4  impedance Z       m6  array phase psi, beta, AF
//      m3  power and intensity
//  The panel starts collapsed, so it does not cover the field.
//  If MathJax does not load, the TeX stays in the box with the class "raw".
//
//  grep -n: "const RULES"  "eqCollapse"
// ============================================================================
import { typesetAll } from '../../lib/sci-math.js';

const RULES = [
  ['E_\\theta', 'm2'], ['\\vec E', 'm2'], ['E_z^{(n)}', 'm2'],
  ['H_\\phi', 'm1'], ['\\vec H', 'm1'],
  ['I_n', 'm5'], ['V_m', 'm5'], ['I', 'm5'],
  ['Z_{mn}', 'm4'],
  ['AF', 'm6'], ['\\psi', 'm6'], ['\\beta', 'm6'],
  ['U_{\\max}', 'm3'], ['P_{\\mathrm{rad}}', 'm3'], ['\\vec S', 'm3'],
];
window.AF_RULES = RULES;

const panel = document.getElementById('eqPanel'), btn = document.getElementById('eqCollapse');
const setCollapsed = on => {
  panel.classList.toggle('collapsed', on);
  btn.textContent = on ? '▼' : '▲';
  btn.title = btn.ariaLabel = on ? 'Expand equations' : 'Collapse equations';
};
// The panel starts folded: open, it covers a third of the field.
setCollapsed(true);
panel.classList.remove('collapsed-init');
btn.addEventListener('click', () => { setCollapsed(!panel.classList.contains('collapsed')); window.dispatchEvent(new Event('af-layout')); });

typesetAll(panel, RULES).catch(err => console.error('[math]', err));
typesetAll(document.getElementById('panel'), RULES).catch(() => {});
