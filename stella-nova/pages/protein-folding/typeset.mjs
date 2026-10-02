// ============================================================================
//  PROTEIN FOLDING  ·  typeset.mjs — formulas to static SVG  (Node, by hand)
// ----------------------------------------------------------------------------
//  Typesets the explainer formulas with MathJax into SVG and writes
//  equations.js. The page then shows the same glyph outlines in each
//  browser, Safari included. No math library loads at run time.
//
//  RUN (MathJax is not a dependency of the site):
//      cd "$(mktemp -d)" && npm i mathjax-full@3 && \
//        NODE_PATH="$PWD/node_modules" node \
//        <repo>/stella-nova/pages/protein-folding/typeset.mjs
//
//  grep: const TEX  function svg
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

// Symbol classes. ../../lib/sci.css colors .m1 to .m6. One class per
// quantity in every formula, and the same class on the T, gamma and force
// slider labels (index.html) and the plot titles (main.js):
//   m1  positions and distances r     m2  energy V, E
//   m3  fraction of native contacts Q m4  temperature T
//   m5  friction gamma                m6  pulling force F
// The free energy F(Q), the constants and the angles stay ink.
const c = (k, t) => String.raw`\class{${k}}{${t}}`;
const R = t => c('m1', t), V = c('m2', 'V'), E = c('m2', 'E'), Q = c('m3', 'Q'), T = c('m4', 'T'), G = c('m5', String.raw`\gamma`), F = c('m6', 'F');

// Each key fills the element with id "eq-<key>" in index.html.
const TEX = {
  go: String.raw`\begin{aligned}${V} ={}& \sum_{\text{bonds}} K_b\,(${R('r')}-r_0)^2 + \sum_{\text{angles}} K_\theta\,(\theta-\theta_0)^2 \\ &+ \sum_{\text{dihedrals}}\ \sum_{n=1,3} K_n\big[1-\cos n(\phi-\phi_0)\big] \\ &+ \sum_{\text{native } ij} \varepsilon\left[5\Big(\frac{\sigma_{ij}}{${R('r_{ij}')}}\Big)^{12} - 6\Big(\frac{\sigma_{ij}}{${R('r_{ij}')}}\Big)^{10}\right] \\ &+ \sum_{\text{other } ij} \varepsilon\Big(\frac{\sigma}{${R('r_{ij}')}}\Big)^{12} - ${F}\,\lvert${R(String.raw`\mathbf r_N`)}-${R(String.raw`\mathbf r_1`)}\rvert\end{aligned}`,
  langevin: String.raw`m\,${R(String.raw`\ddot{\mathbf r}_i`)} = -\nabla_i ${V} - ${G} m\,${R(String.raw`\dot{\mathbf r}_i`)} + \sqrt{2${G} m\,k_B${T}}\;\eta_i(t)`,
  q: String.raw`\begin{gathered}${Q} = \frac{1}{N_c}\sum_{ij\,\in\,\text{native}} \Theta\big(1.2\,\sigma_{ij} - ${R('r_{ij}')}\big) \\[4pt] \frac{F(${Q})}{k_B${T}} = -\ln P(${Q}) + \text{const}\end{gathered}`,
  levinthal: String.raw`\begin{gathered}3^{100} \approx 5\times10^{47}\ \text{shapes} \\[4pt] \frac{5\times10^{47}}{10^{13}\ \text{s}^{-1}} \approx 10^{27}\ \text{years}\end{gathered}`,
  hp: String.raw`${E} = -\sum_{i<j-1} h_i\,h_j\,\Delta(${R(String.raw`\mathbf r_i`)},${R(String.raw`\mathbf r_j`)}), \qquad h_i = \begin{cases}1 & \text{H}\\ 0 & \text{P}\end{cases}`,
  // control label symbols (index.html [data-sym])
  symT: String.raw`${T}/${T}_{\mathrm m}`,
  symGamma: G,
  symF: F,
};

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const doc = mathjax.document('', { InputJax: new TeX({ packages: ['base', 'ams', 'html'] }), OutputJax: new SVG({ fontCache: 'local' }) });
function svg(tex) {
  const node = doc.convert(tex, { display: true });
  let s = adaptor.innerHTML(node).replace(/ aria-hidden="true"/, '');
  s = s.replace('<svg ', `<svg role="img" aria-label="${tex.replace(/"/g, '&quot;')}" `);
  if (s.includes('merror')) throw new Error('TeX error in: ' + tex);
  return s;
}
const out = Object.fromEntries(Object.entries(TEX).map(([k, t]) => [k, svg(t)]));
const js = `// ============================================================================
//  PROTEIN FOLDING  ·  equations.js — explainer formulas  (GENERATED)
// ----------------------------------------------------------------------------
//  Do not edit by hand. Change the TeX in typeset.mjs and run it again.
//  Each formula is static MathJax SVG with glyphs as paths. mountEquations()
//  fills every element whose id is "eq-<key>".
//
//  grep: const SVG  export function mountEquations
// ============================================================================
const SVG = ${JSON.stringify(out, null, 2)};
export function mountEquations(root = document) {
  for (const [k, s] of Object.entries(SVG)) { const el = root.getElementById ? root.getElementById('eq-' + k) : null; if (el) el.innerHTML = s; }
}
`;
const dest = fileURLToPath(new URL('./equations.js', import.meta.url));
writeFileSync(dest, js);
console.log('wrote', dest, js.length, 'bytes');
for (const [k, s] of Object.entries(out)) console.log(' ', k, s.length, 'bytes', s.match(/width="[^"]+" height="[^"]+"/)[0]);
