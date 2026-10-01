// ============================================================================
//  APERTURE DIFFRACTION  ·  formula typesetter  (Node, run by hand)
// ----------------------------------------------------------------------------
//  Typesets the equations of the page with MathJax into static SVG and
//  writes equations.js. The page then shows the same glyph outlines in each
//  browser. KaTeX HTML output broke in Safari (subscripts and fraction
//  denominators stayed on the baseline), so no math library loads at run
//  time.
//
//  RUN (MathJax is not a dependency of the site):
//      cd "$(mktemp -d)" && npm i mathjax-full@3 && \
//        NODE_PATH="$PWD/node_modules" node \
//        <repo>/stella-nova/pages/diffraction-lab/typeset.mjs
//  The script finds equations.js next to itself.
//
//  Colours: each symbol has the colour of the thing it names in the view.
//    E field (amber) · t transmittance (orange) · F transforms (violet)
//    k wave numbers (green) · lambda wavelength (cyan)
//
//  SECTION MAP   (jump with grep -n "<anchor>" typeset.mjs)
//      palette ......... "const C"      symbol colours
//      main formulas ... "const MAIN"   Helmholtz, ASM, Fresnel, CIE
//      apertures ....... "const TRANS"  one transmittance per element key
//      svg cleanup ..... "function svg" MathJax output to inline SVG
// ============================================================================
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const require = createRequire(process.env.NODE_PATH + '/');
const { mathjax } = require('mathjax-full/js/mathjax.js');
const { TeX } = require('mathjax-full/js/input/tex.js');
require('mathjax-full/js/input/tex/AllPackages.js');
const { SVG } = require('mathjax-full/js/output/svg.js');
const { liteAdaptor } = require('mathjax-full/js/adaptors/liteAdaptor.js');
const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html.js');

const C = { E: '#ffc832', T: '#ff9a5c', F: '#c890ff', K: '#7fd88a', L: '#60e0ee' };
const c = (k, s) => String.raw`{\color{${C[k]}}{${s}}}`;
const E = c('E', 'E'), t = c('T', 't'), F = c('F', String.raw`\mathcal{F}`), Fi = c('F', String.raw`\mathcal{F}^{-1}`);
const k = c('K', 'k'), kz = c('K', 'k_z'), lam = c('L', String.raw`\lambda`);

const MAIN = {
  helm: String.raw`\nabla^2 ${E} + ${k}^2 ${E} = 0,\qquad ${k} = \frac{2\pi}{${lam}}`,
  asm: String.raw`${E}(x,y,z) = ${Fi}\Big\{\, ${F}\{\, ${t}\,${E}_0 \}\; e^{\,i ${kz} z} \Big\},\qquad ${kz} = \sqrt{${k}^2 - k_x^2 - k_y^2}`,
  fresnel: String.raw`N_F = \frac{a^2}{${lam}\, z}\qquad \begin{cases} N_F \gg 1 & \text{shadow} \\ N_F \sim 1 & \text{Fresnel} \\ N_F \ll 1 & \text{Fraunhofer} \end{cases}`,
  cie: String.raw`\begin{aligned} (X,Y,Z) &= \int S_{D65}(${lam})\; I(${lam})\; \big(\bar x, \bar y, \bar z\big)(${lam})\; d${lam} \\ (R,G,B) &= \gamma\big(\mathbf{M}\,(X,Y,Z)\big) \end{aligned}`,
};

const win = String.raw`\,\mathrm{rect}\!\left(\tfrac{x}{W}\right)\mathrm{rect}\!\left(\tfrac{y}{H}\right)`;
const TRANS = {
  hex: String.raw`${t} = \begin{cases} 1 & |x| + |y|/\sqrt{3} \le R,\ \ |y| \le \tfrac{\sqrt3}{2}R \\ 0 & \text{otherwise} \end{cases}`,
  circular: String.raw`${t} = \mathrm{circ}\!\left(\frac{r}{R}\right) = \begin{cases} 1 & r \le R \\ 0 & r > R \end{cases}`,
  rect: String.raw`${t} = \mathrm{rect}\!\left(\frac{x}{W}\right)\mathrm{rect}\!\left(\frac{y}{H}\right)`,
  double: String.raw`${t} = \Big[\mathrm{rect}\!\left(\tfrac{x - d/2}{W}\right) + \mathrm{rect}\!\left(\tfrac{x + d/2}{W}\right)\Big]\,\mathrm{rect}\!\left(\tfrac{y}{H}\right)`,
  star: String.raw`${t} = \begin{cases} 1 & (x,y) \in \text{star}_n(R,\ r_i) \\ 0 & \text{otherwise} \end{cases}`,
  heart: String.raw`${t} = \begin{cases} 1 & (u^2 + v^2 - 1)^3 \le u^2 v^3 \\ 0 & \text{otherwise} \end{cases},\quad (u,v) = \left(\tfrac{x}{s},\ \tfrac{-y}{s} + 0.35\right)`,
  ring: String.raw`${t} = \begin{cases} 1 & r_i \le r \le r_o \\ 0 & \text{otherwise} \end{cases}`,
  cross: String.raw`${t} = \begin{cases} 1 & |x| < \tfrac{w}{2},\ |y| < a \ \ \text{or}\ \ |y| < \tfrac{w}{2},\ |x| < a \\ 0 & \text{otherwise} \end{cases}`,
  'grating-bin': String.raw`${t} = \tfrac12\Big[1 + \mathrm{sgn}\cos\!\big(\tfrac{2\pi x}{\Lambda}\big)\Big]${win}`,
  'grating-phase': String.raw`${t} = e^{\,i\,2\pi x/\Lambda}${win}`,
  'lens-ap': String.raw`${t} = \mathrm{circ}\!\left(\frac{r}{R}\right)\, e^{-i\pi r^2/(${lam} f)}`,
  fzp: String.raw`${t} = \mathrm{circ}\!\left(\frac{r}{R}\right)\, e^{-i\,2\pi\left(\sqrt{f^2 + r^2} - f\right)/${lam}}`,
  text: String.raw`${t}(x,y) = \text{glyph mask of the text}\ \in \{0, 1\}`,
  image: String.raw`${t}(x,y) = \text{luminance of the image}\ \in [0, 1]`,
};

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const doc = mathjax.document('', { InputJax: new TeX({ packages: ['base', 'ams', 'color'] }), OutputJax: new SVG({ fontCache: 'global' }) });

// The glyph outlines go once into a shared hidden <svg> (fontCache global);
// each formula refers to them with <use>. This halves equations.js.
// MathJax output to inline SVG. The ex sizes stay, so CSS font-size scales
// the formula. aria-hidden is removed and a label with the TeX is added.
function svg(tex) {
  const node = doc.convert(tex, { display: true });
  let s = adaptor.innerHTML(node).replace(/ aria-hidden="true"/, '');
  const label = tex.replace(/\{\\color\{#[0-9a-f]+\}\{/g, '{').replace(/"/g, '&quot;');
  s = s.replace('<svg ', `<svg role="img" aria-label="${label}" `);
  if (s.includes('merror')) throw new Error('TeX error in: ' + tex);
  return s;
}

const main = Object.fromEntries(Object.entries(MAIN).map(([key, tex]) => [key, svg(tex)]));
const trans = Object.fromEntries(Object.entries(TRANS).map(([key, tex]) => [key, svg(tex)]));
// getCache() gives a bare <defs>; it needs an <svg> parent, or the HTML
// parser makes the paths plain HTML elements and no glyph draws.
const defs = '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0">' +
  adaptor.outerHTML(doc.outputJax.fontCache.getCache()) + '</svg>';
const js = `// ============================================================================
//  APERTURE DIFFRACTION  ·  equations  (GENERATED by typeset.mjs)
// ----------------------------------------------------------------------------
//  Do not edit by hand. Change the TeX in typeset.mjs and run it again.
//  Each formula is static SVG from MathJax, with glyphs as paths. No font
//  or math library loads at run time, so each browser shows the same shape.
//
//  defs                 the shared glyph outlines, added to <body> once
//  window.DiffEq.main   helm, asm, fresnel, cie
//  window.DiffEq.trans  one transmittance formula per element key of EL
//  The elements with id eq-<name> get main[name] at load. main.js puts
//  trans[key] into #eq-trans when the element changes.
// ============================================================================
(function () {
const main = ${JSON.stringify(main, null, 1)};
const trans = ${JSON.stringify(trans, null, 1)};
const defs = ${JSON.stringify(defs)};
const holder = document.createElement('div');
holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
holder.setAttribute('aria-hidden', 'true');
holder.innerHTML = defs;
document.body.appendChild(holder);
window.DiffEq = { main, trans };
for (const [name, s] of Object.entries(main)) {
  const el = document.getElementById('eq-' + name);
  if (el) el.innerHTML = s;
}
})();
`;
const out = fileURLToPath(new URL('./equations.js', import.meta.url));
writeFileSync(out, js);
console.log('wrote', out, (js.length / 1024).toFixed(1) + ' KB,', Object.keys(main).length, 'main,', Object.keys(trans).length, 'apertures');
