// ============================================================================
//  APERTURE DIFFRACTION  ·  equations.js  ·  color-coded MathJax SVG (module)
// ----------------------------------------------------------------------------
//  The TeX of each formula on the page. lib/sci-math.js typesets it at run
//  time as MathJax SVG. RULES gives each physical quantity one color class
//  (lib/sci.css .m1 to .m6). The parameter labels in main.js use the same
//  RULES, so a slider label has the color of its symbol in the formulas.
//
//  COLOR MAP
//      λ   wavelength ........ m1      t   transmittance ..... m2
//      k, k_x, k_y, k_z ...... m3      z   distance .......... m4
//      E   field ............. m5      F   Fourier transform . m6
//  The distance z is marked by hand with \class{m4}{z}, because a rule for
//  z would also color the z of k_z and of the color-matching function z̄.
//  Aperture sizes (R, W, H, d, f, Λ ...) and constants stay the text color.
//
//  GREP MAP
//      "const RULES"   symbol to color class
//      "const MAIN"    Helmholtz, angular spectrum, Fresnel, CIE
//      "const TRANS"   one transmittance per element key of EL in main.js
//      "window.DiffEq" the API main.js calls (trans, sym, symAll)
//  When it is ready, the module sends the 'diffeq-ready' event on window.
// ============================================================================
import { typeset } from '../../lib/sci-math.js';

const RULES = [
  ['\\lambda', 'm1'], ['t', 'm2'], ['k_x', 'm3'], ['k_y', 'm3'], ['k_z', 'm3'], ['k', 'm3'],
  ['E', 'm5'], ['\\mathcal{F}', 'm6'],
];
const z = String.raw`\class{m4}{z}`;

const MAIN = {
  helm: String.raw`\nabla^2 E + k^2 E = 0,\qquad k = \frac{2\pi}{\lambda}`,
  asm: String.raw`\begin{aligned} E(x,y,${z}) &= \mathcal{F}^{-1}\Big\{\, \mathcal{F}\{\, t\,E_0 \}\; e^{\,i k_z ${z}} \Big\} \\ k_z &= \sqrt{k^2 - k_x^2 - k_y^2} \end{aligned}`,
  fresnel: String.raw`N_F = \frac{a^2}{\lambda\, ${z}}\qquad \begin{cases} N_F \gg 1 & \text{shadow} \\ N_F \sim 1 & \text{Fresnel} \\ N_F \ll 1 & \text{Fraunhofer} \end{cases}`,
  cie: String.raw`\begin{aligned} (X,Y,Z) &= \int S_{D65}(\lambda)\; I(\lambda)\; \big(\bar x, \bar y, \bar z\big)(\lambda)\; d\lambda \\ (R,G,B) &= \gamma\big(\mathbf{M}\,(X,Y,Z)\big) \end{aligned}`,
};

const win = String.raw`\,\mathrm{rect}\!\left(\tfrac{x}{W}\right)\mathrm{rect}\!\left(\tfrac{y}{H}\right)`;
const TRANS = {
  hex: String.raw`t = \begin{cases} 1 & |x| + |y|/\sqrt{3} \le R,\ \ |y| \le \tfrac{\sqrt3}{2}R \\ 0 & \text{otherwise} \end{cases}`,
  circular: String.raw`t = \mathrm{circ}\!\left(\frac{r}{R}\right) = \begin{cases} 1 & r \le R \\ 0 & r > R \end{cases}`,
  rect: String.raw`t = \mathrm{rect}\!\left(\frac{x}{W}\right)\mathrm{rect}\!\left(\frac{y}{H}\right)`,
  double: String.raw`t = \Big[\mathrm{rect}\!\left(\tfrac{x - d/2}{W}\right) + \mathrm{rect}\!\left(\tfrac{x + d/2}{W}\right)\Big]\,\mathrm{rect}\!\left(\tfrac{y}{H}\right)`,
  star: String.raw`t = \begin{cases} 1 & (x,y) \in \text{star}_n(R,\ r_i) \\ 0 & \text{otherwise} \end{cases}`,
  heart: String.raw`t = \begin{cases} 1 & (u^2 + v^2 - 1)^3 \le u^2 v^3 \\ 0 & \text{otherwise} \end{cases},\quad (u,v) = \left(\tfrac{x}{s},\ \tfrac{-y}{s} + 0.35\right)`,
  ring: String.raw`t = \begin{cases} 1 & r_i \le r \le r_o \\ 0 & \text{otherwise} \end{cases}`,
  cross: String.raw`t = \begin{cases} 1 & |x| < \tfrac{w}{2},\ |y| < a \ \ \text{or}\ \ |y| < \tfrac{w}{2},\ |x| < a \\ 0 & \text{otherwise} \end{cases}`,
  'grating-bin': String.raw`t = \tfrac12\Big[1 + \mathrm{sgn}\cos\!\big(\tfrac{2\pi x}{\Lambda}\big)\Big]${win}`,
  'grating-phase': String.raw`t = e^{\,i\,2\pi x/\Lambda}${win}`,
  'lens-ap': String.raw`t = \mathrm{circ}\!\left(\frac{r}{R}\right)\, e^{-i\pi r^2/(\lambda f)}`,
  fzp: String.raw`t = \mathrm{circ}\!\left(\frac{r}{R}\right)\, e^{-i\,2\pi\left(\sqrt{f^2 + r^2} - f\right)/\lambda}`,
  text: String.raw`t(x,y) = \text{glyph mask of the text}\ \in \{0, 1\}`,
  image: String.raw`t(x,y) = \text{luminance of the image}\ \in [0, 1]`,
};

// Inline symbol: the TeX in data-sym. A symbol with no rule ('R') stays the
// text color. 'z' is the distance, so it gets m4 like in the formulas.
const symTeX = s => s === 'z' ? z : s;
function sym(el, tex) { return typeset(el, symTeX(tex), { display: false, rules: RULES }); }
function symAll(root = document) { return Promise.all([...root.querySelectorAll('[data-sym]')].map(el => sym(el, el.dataset.sym))); }

const ready = Promise.all([
  ...Object.entries(MAIN).map(([k, tex]) => { const el = document.getElementById('eq-' + k); return el ? typeset(el, tex, { rules: RULES }) : true; }),
  symAll(),
]);
window.DiffEq = { RULES, TRANS, ready, trans: (el, key) => typeset(el, TRANS[key] || '', { rules: RULES }), sym, symAll };
window.dispatchEvent(new Event('diffeq-ready'));
