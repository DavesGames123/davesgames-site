// ============================================================================
//  ANTENNA FIELDS  ·  equations.js — the equations in the Details drawer
// ----------------------------------------------------------------------------
//  Typesets each [data-tex] box in #eqs as MathJax SVG through
//  lib/sci-math.js. The TeX is in index.html. One colour per quantity:
//      m2  E fields     m5  currents, voltage     m4  impedance Z
//  If MathJax does not load, the TeX stays in the box with the class "raw".
//  The drawer is closed at start, so this runs once, in the background.
// ============================================================================
import { typesetAll } from '../../lib/sci-math.js';

const RULES = [['E_\\theta', 'm2'], ['\\vec E', 'm2'], ['I_n', 'm5'], ['V_m', 'm5'], ['I', 'm5'], ['Z_{mn}', 'm4']];
window.AF_RULES = RULES;
typesetAll(document.getElementById('eqs'), RULES).catch(err => console.error('[math]', err));
