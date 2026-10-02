// ============================================================================
//  MAGNETLAB  ·  equation panel renderer  (ES module)
// ----------------------------------------------------------------------------
//  Typesets the three governing equations of the MagnetLab overlay panel as
//  MathJax SVG with lib/sci-math.js, then wires the panel collapse toggle.
//  It only paints math and one click handler. It never touches the
//  simulation state.
//
//  The TeX is in index.html, on each element with data-tex. RULES gives
//  one .mN class to each quantity, so the same quantity has the same color
//  in each line, and on the other field pages (maxwells-equations,
//  twenty-to-four). lib/sci.css gives .m1 to .m6 a color.
//      m1  the magnetic field B          m2  the electric field E
//      m5  the free current density J    m3  the dipole moment m
//  ∇, μ0, ε0 and r stay ink.
//
//  TARGET ELEMENTS  (ids owned by index.html)
//      #eq-gauss-b   div B = 0            no magnetic monopoles
//      #eq-ampere    curl B = ...         Ampere with Maxwell's correction
//      #eq-dipole    B(r) = ...           the point-dipole field, the sim core
//
//  If MathJax does not load, the TeX stays in the box with the class "raw".
//
//  SECTION MAP   (jump with grep -n "<anchor>" equations.js)
//      color rules ......... "const RULES"        symbol -> .mN class
//      typeset ............. "typesetAll"         paint the three formulas
//      collapse toggle ..... "eq-toggle"          expand or collapse the panel
// ============================================================================
import { typesetAll } from '../../lib/sci-math.js';

// One class per quantity, shared across all three formulas.
const RULES = [['\\vec{B}', 'm1'], ['\\vec{E}', 'm2'], ['\\vec{J}', 'm5'], ['\\vec{m}', 'm3']];

const panel = document.getElementById('eq-panel');
typesetAll(panel, RULES);

// Collapse toggle: a click on the header folds the panel. The word at the
// right says what the next click does.
document.getElementById('eq-toggle').addEventListener('click', () => {
  const c = panel.classList.toggle('collapsed');
  panel.querySelector('.arrow').textContent = c ? 'Show' : 'Hide';
});
