// ============================================================================
//  HOHMANN  ·  typeset.mjs — reference equations to static SVG  (Node, by hand)
// ----------------------------------------------------------------------------
//  Typesets the six reference equations with MathJax into SVG and writes
//  equations.js. The page shows the same glyph outlines in each browser,
//  Safari included. No math library loads at run time (KaTeX HTML layout
//  failed in Safari, so the page does not use KaTeX).
//
//  RUN (MathJax is not a dependency of the site):
//      cd "$(mktemp -d)" && npm i mathjax-full@3 && \
//        NODE_PATH="$PWD/node_modules" node \
//        <repo>/stella-nova/pages/hohmann/typeset.mjs
//
//  The colours match the CC table in mathpanel.js and the canvas:
//    mu yellow · r blue · v green · a orange · dv cyan · t yellow · phi magenta
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

const mu = '\\color{#ffc832}{\\mu}';
const r = s => `\\color{#96c8ff}{r${s}}`;
const v = s => `\\color{#7ad87a}{v${s}}`;
const a = s => `\\color{#ff9050}{a${s}}`;
const dv = s => `\\color{#5cd8e8}{\\Delta v${s}}`;
const t = '\\color{#ffc832}{t_{\\mathrm{tr}}}';
const phi = '\\color{#d870c8}{\\varphi_{\\mathrm{req}}}';
const om = '\\color{#d870c8}{\\omega_{\\mathrm{tgt}}}';

// Each key fills the element with id "eq-<key>" in index.html.
const TEX = {
  visviva: `${v('')} = \\sqrt{${mu}\\left(\\frac{2}{${r('')}} - \\frac{1}{${a('')}}\\right)}`,
  atransfer: `${a('_t')} = \\frac{${r('_1')} + ${r('_2')}}{2}`,
  dv1: `${dv('_1')} = \\big|\\,${v('_t(r_1)')} - ${v('_c(r_1)')}\\,\\big|`,
  dv2: `${dv('_2')} = \\big|\\,${v('_t(r_2)')} - ${v('_c(r_2)')}\\,\\big|`,
  time: `${t} = \\pi\\sqrt{\\frac{${a('_t')}^{3}}{${mu}}}`,
  phi: `${phi} = \\pi - ${om}\\,${t}`,
};

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const doc = mathjax.document('', { InputJax: new TeX({ packages: ['base', 'ams', 'color'] }), OutputJax: new SVG({ fontCache: 'local' }) });
function svg(tex) {
  const node = doc.convert(tex, { display: true });
  let s = adaptor.innerHTML(node).replace(/ aria-hidden="true"/, '');
  if (s.includes('merror')) throw new Error('TeX error in: ' + tex);
  // currentColor lets the page set the colour of the uncoloured glyphs.
  s = s.replace('<svg ', '<svg role="img" aria-label="' + tex.replace(/\\color\{#[0-9a-f]+\}/g, '').replace(/"/g, '&quot;') + '" ');
  return s;
}
const out = Object.fromEntries(Object.entries(TEX).map(([k, x]) => [k, svg(x)]));
const js = `// ============================================================================
//  HOHMANN  ·  equations.js — reference equations  (GENERATED)
// ----------------------------------------------------------------------------
//  Do not edit by hand. Change the TeX in typeset.mjs and run it again.
//  Each formula is static MathJax SVG with glyphs as paths. A classic script:
//  it fills every element whose id is "eq-<key>" and wires the collapse
//  button of #eqPanel.
//
//  grep: const HOHMANN_EQ_SVG
// ============================================================================
const HOHMANN_EQ_SVG = ${JSON.stringify(out, null, 2)};
(function(){
  for (const k in HOHMANN_EQ_SVG) { const el = document.getElementById('eq-' + k); if (el) el.innerHTML = HOHMANN_EQ_SVG[k]; }
  const panel = document.getElementById('eqPanel'), btn = document.getElementById('eqCollapseBtn');
  if (panel && btn) btn.addEventListener('click', () => {
    const c = panel.classList.toggle('collapsed');
    btn.setAttribute('aria-expanded', String(!c));
    btn.title = c ? 'Show the equations' : 'Hide the equations';
  });
})();
`;
const dest = fileURLToPath(new URL('./equations.js', import.meta.url));
writeFileSync(dest, js);
console.log('wrote', dest, js.length, 'bytes');
for (const [k, s] of Object.entries(out)) console.log(' ', k, s.length, 'bytes', s.match(/width="[^"]+" height="[^"]+"/)[0]);
