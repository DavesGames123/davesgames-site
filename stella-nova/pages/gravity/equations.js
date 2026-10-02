// ============================================================================
//  GRAVITY PLAYGROUND  ·  equation panel  (ES module)
// ----------------------------------------------------------------------------
//  Typesets the five governing equations into their [data-tex] boxes in
//  index.html as MathJax SVG, through lib/sci-math.js. Each quantity has one
//  math color class from lib/sci.css. The same class is on the slider label
//  and on the readout value that shows the quantity. Also wires the collapse
//  button of the panel.
//
//  COLOR MAP  (symbol -> class)
//      F force .......... m1      m, M mass ...... m2
//      v speed .......... m3      L ang. momentum  m4
//      G constant ....... m5      r distance ..... m6
//  E, K, U, T, a, A and the numbers stay the default color.
//
//  SECTION MAP   (jump with grep -n "<anchor>" equations.js)
//      color rules ....... "export const RULES"   symbol -> class
//      typeset ........... "typesetAll("          every [data-tex] box
//      slider symbols .... "data-sym"             G on its slider label
//      collapse toggle ... "eqCollapseBtn"        show or hide the panel
// ============================================================================
import { typeset, typesetAll } from '../../lib/sci-math.js';

export const RULES = [
  ['F', 'm1'], ['m_1', 'm2'], ['m_2', 'm2'], ['m', 'm2'], ['M', 'm2'],
  ['v', 'm3'], ['L', 'm4'], ['G', 'm5'], ['r', 'm6'],
];

const panel = document.getElementById('eqPanel');
typesetAll(panel, RULES);

// A label with data-sym shows that symbol in its equation color.
for (const el of document.querySelectorAll('[data-sym]')) {
  typeset(el, el.dataset.sym, { display: false, rules: RULES });
}

// Collapse toggle: flip the panel's collapsed class and swap the caret glyph.
const btn = document.getElementById('eqCollapseBtn');
btn.addEventListener('click', () => {
  const c = panel.classList.toggle('collapsed');
  btn.innerHTML = c ? '&#9660;' : '&#9650;';
  btn.title = c ? 'Expand' : 'Collapse';
});
