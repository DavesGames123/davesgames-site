// ============================================================================
//  ATOMIC ORBITAL VR  ·  equation panel  (ES module)
// ----------------------------------------------------------------------------
//  Typesets the three governing equations in the [data-tex] boxes of
//  index.html as MathJax SVG, through lib/sci-math.js. Each quantity has one
//  math color class from lib/sci.css. The same class is on the quantum-number
//  steppers and on the B toggles, so a control and its symbol agree. Also
//  wires the collapse button of the panel.
//
//  COLOR MAP  (symbol -> class)
//      n principal ........ m1      l (ell) angular ...... m2
//      m magnetic ......... m3      B magnetic field ..... m4
//      psi wavefunction ... m5      J_i current density .. m6
//  H, E, R, Y, r, mu_0 and the numbers stay the default color. The
//  subscripts n, l, m keep their colors, so each factor shows which quantum
//  numbers it depends on.
//
//  SECTION MAP   (jump with grep -n "<anchor>" equations.js)
//      color rules ....... "export const RULES"   symbol -> class
//      typeset ........... "typesetAll("          every [data-tex] box
//      control symbols ... "data-sym"             n, l, m and B labels
//      collapse toggle ... "eq-collapse-btn"      show or hide the panel
// ============================================================================
import { typeset, typesetAll } from '../../lib/sci-math.js';

export const RULES = [
  ['n', 'm1'], ['\\ell', 'm2'], ['m', 'm3'],
  ['\\vec{B}', 'm4'], ['\\psi', 'm5'], ['\\vec{J}_i', 'm6'],
];

const panel = document.getElementById('eq-panel');
typesetAll(panel, RULES);

// A label with data-sym shows that symbol in its equation color.
for (const el of document.querySelectorAll('[data-sym]')) {
  typeset(el, el.dataset.sym, { display: false, rules: RULES });
}

// Collapse toggle: flip the panel's collapsed class and swap the caret glyph.
const btn = document.getElementById('eq-collapse-btn');
btn.addEventListener('click', () => {
  const c = panel.classList.toggle('collapsed');
  btn.textContent = c ? '▼' : '▲';
  btn.title = c ? 'Expand equations' : 'Collapse equations';
});
