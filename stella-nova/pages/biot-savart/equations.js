// ============================================================================
//  BIOT-SAVART  ·  equation panel renderer  (ES module)
// ----------------------------------------------------------------------------
//  Typesets the three formulas in the collapsible equation panel as MathJax
//  SVG with lib/sci-math.js, and wires the collapse toggle. The TeX is in
//  index.html, on each element with data-tex. RULES gives one .mN class to
//  each quantity, the same classes as on the other field pages
//  (maxwells-equations, magnetlab). lib/sci.css gives .m1 to .m6 a color.
//      m1  the magnetic field B, B_total
//      m5  the current I, I_i (also the I label on each wire card)
//      m3  the distance r, r_i, s
//  μ0, dℓ, the unit vectors and Σ stay ink.
//
//  The wire cards are made again by main.js rebuildWireList(). It reads
//  window.BS_SYM.I for the label symbol, so this module typesets the symbol
//  once and then calls rebuildWireList() again.
//
//  If MathJax does not load, the TeX stays in the box with the class "raw".
//
//  SECTION MAP   (jump with grep -n "<anchor>" equations.js)
//      color rules ......... "const RULES"      symbol -> .mN class
//      typeset ............. "typesetAll"       paint the three formulas
//      label symbol ........ "BS_SYM"           the I label for wire cards
//      collapse toggle ..... "eq-toggle"        show or hide the panel
// ============================================================================
import { typesetAll, typeset } from '../../lib/sci-math.js';

// One class per quantity, shared across all three formulas.
const RULES = [['\\vec{B}', 'm1'], ['I_i', 'm5'], ['I', 'm5'], ['r_i', 'm3'], ['s', 'm3'], ['r', 'm3']];

const panel = document.getElementById('eq-panel');
typesetAll(panel, RULES);

// The I label symbol for the wire cards.
const tmp = document.createElement('span');
typeset(tmp, 'I', { display: false, rules: RULES }).then(ok => {
  if (!ok) return;
  window.BS_SYM = { I: tmp.innerHTML };
  if (typeof window.rebuildWireList === 'function') window.rebuildWireList();
});

// Collapse toggle: a click on the header folds the panel. The word at the
// right says what the next click does.
document.getElementById('eq-toggle').addEventListener('click', () => {
  const c = panel.classList.toggle('collapsed');
  panel.querySelector('.arrow').textContent = c ? 'Show' : 'Hide';
});
