// ============================================================================
//  ALPHAFOLD EXPLAINED  ·  formula typesetter  (Node, run by hand)
// ----------------------------------------------------------------------------
//  Typesets the page formulas with MathJax into static SVG and writes
//  equations.js. The glyphs are paths, so each browser shows the same shape.
//  KaTeX is not used: its HTML layout broke in Safari (see hydrogen-table).
//
//  RUN (MathJax is not a dependency of the site):
//      cd "$(mktemp -d)" && npm i mathjax-full@3 && \
//        NODE_PATH="$PWD/node_modules" node \
//        <repo>/stella-nova/pages/alphafold-explained/typeset.mjs
//  The script finds equations.js next to itself.
//
//  The page puts each formula into every element with data-eq="<key>".
//
//  SECTION MAP   (jump with grep -n "<anchor>" typeset.mjs)
//      formulas ........ "const TEX"    the TeX source of each formula
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

const TEX = {
  // ---- input and embedding
  embed: String.raw`z_{ij}=\mathrm{Lin}(f^{\,\mathrm{tgt}}_i)+\mathrm{Lin}(f^{\,\mathrm{tgt}}_j)+\mathrm{Lin}\bigl(\mathrm{onehot}(\mathrm{clip}(i-j,\,-32,\,32))\bigr)`,
  msaembed: String.raw`m_{si}=\mathrm{Lin}(f^{\,\mathrm{msa}}_{si})+\mathrm{Lin}(f^{\,\mathrm{tgt}}_i)`,
  recycle: String.raw`z_{ij}\mathrel{+}=\mathrm{LN}(z^{\mathrm{prev}}_{ij})+\mathrm{Lin}\bigl(\mathrm{onehot}(d^{\,\mathrm{prev}}_{C\beta,ij})\bigr),\qquad m_{1i}\mathrel{+}=\mathrm{LN}(m^{\mathrm{prev}}_{1i})`,
  // ---- Evoformer
  rowattn: String.raw`a^{h}_{sij}=\operatorname*{softmax}_{j}\Bigl(\tfrac{1}{\sqrt{c}}\,q^{h}_{si}\!\cdot k^{h}_{sj}+b^{h}_{ij}\Bigr),\qquad o^{h}_{si}=g^{h}_{si}\odot\sum_{j}a^{h}_{sij}\,v^{h}_{sj}`,
  colattn: String.raw`a^{h}_{sti}=\operatorname*{softmax}_{t}\Bigl(\tfrac{1}{\sqrt{c}}\,q^{h}_{si}\!\cdot k^{h}_{ti}\Bigr),\qquad o^{h}_{si}=g^{h}_{si}\odot\sum_{t}a^{h}_{sti}\,v^{h}_{ti}`,
  transition: String.raw`x\leftarrow x+\mathrm{Lin}\bigl(\mathrm{ReLU}(\mathrm{Lin}(\mathrm{LN}(x)))\bigr),\qquad c\to 4c\to c`,
  opm: String.raw`o_{ij}=\mathrm{flatten}\Bigl(\tfrac{1}{N_{\mathrm{seq}}}\sum_{s}a_{si}\otimes b_{sj}\Bigr),\qquad z_{ij}\mathrel{+}=\mathrm{Lin}(o_{ij})`,
  triout: String.raw`\tilde z_{ij}=g_{ij}\odot\mathrm{Lin}\Bigl(\mathrm{LN}\Bigl(\sum_{k}a_{ik}\odot b_{jk}\Bigr)\Bigr)`,
  triin: String.raw`\tilde z_{ij}=g_{ij}\odot\mathrm{Lin}\Bigl(\mathrm{LN}\Bigl(\sum_{k}a_{ki}\odot b_{kj}\Bigr)\Bigr)`,
  tristart: String.raw`a^{h}_{ijk}=\operatorname*{softmax}_{k}\Bigl(\tfrac{1}{\sqrt{c}}\,q^{h}_{ij}\!\cdot k^{h}_{ik}+b^{h}_{jk}\Bigr),\qquad o^{h}_{ij}=g^{h}_{ij}\odot\sum_{k}a^{h}_{ijk}\,v^{h}_{ik}`,
  triend: String.raw`a^{h}_{ijk}=\operatorname*{softmax}_{k}\Bigl(\tfrac{1}{\sqrt{c}}\,q^{h}_{ij}\!\cdot k^{h}_{kj}+b^{h}_{ki}\Bigr),\qquad o^{h}_{ij}=g^{h}_{ij}\odot\sum_{k}a^{h}_{ijk}\,v^{h}_{kj}`,
  triineq: String.raw`\bigl|d_{ik}-d_{jk}\bigr|\;\le\;d_{ij}\;\le\;d_{ik}+d_{jk}\quad\text{for every }k`,
  single: String.raw`s_i=\mathrm{Lin}(m_{1i})\in\mathbb{R}^{384}`,
  // ---- structure module
  frame: String.raw`T_i=(R_i,\vec t_i),\qquad x_{\mathrm{global}}=T_i\circ x_{\mathrm{local}}=R_i\,x_{\mathrm{local}}+\vec t_i`,
  ipa: String.raw`a^{h}_{ij}=\operatorname*{softmax}_{j}\Bigl(w_L\Bigl[\tfrac{1}{\sqrt{c}}\,q^{h}_{i}\!\cdot k^{h}_{j}+b^{h}_{ij}-\tfrac{\gamma^{h}w_C}{2}\sum_{p}\bigl\|T_i\circ\vec q^{\,hp}_{i}-T_j\circ\vec k^{\,hp}_{j}\bigr\|^{2}\Bigr]\Bigr)`,
  ipainv: String.raw`\|(T_g\circ T_i)\circ\vec q-(T_g\circ T_j)\circ\vec k\|=\|R_g(T_i\circ\vec q-T_j\circ\vec k)\|=\|T_i\circ\vec q-T_j\circ\vec k\|`,
  bbupdate: String.raw`T_i\leftarrow T_i\circ\Bigl(\tfrac{(1,\,b_i,\,c_i,\,d_i)}{\sqrt{1+b_i^2+c_i^2+d_i^2}},\;\vec t_i\Bigr)`,
  torsion: String.raw`(\omega,\phi,\psi,\chi_1,\chi_2,\chi_3,\chi_4)_i,\qquad \alpha=(\sin\theta,\cos\theta)/\|\cdot\|`,
  // ---- losses and confidence
  fape: String.raw`\mathrm{FAPE}=\frac{1}{Z}\;\operatorname*{mean}_{i,j}\;\min\Bigl(d_{\mathrm{clamp}},\;\sqrt{\bigl\|T_i^{-1}\circ\vec x_j-T_i^{\mathrm{true}\,-1}\circ\vec x^{\,\mathrm{true}}_j\bigr\|^{2}+\epsilon}\Bigr),\quad Z=d_{\mathrm{clamp}}=10\,\text{Å}`,
  loss: String.raw`\mathcal{L}=0.5\,\mathcal{L}_{\mathrm{FAPE}}+0.5\,\mathcal{L}_{\mathrm{aux}}+0.3\,\mathcal{L}_{\mathrm{dist}}+2.0\,\mathcal{L}_{\mathrm{msa}}+0.01\,\mathcal{L}_{\mathrm{conf}}`,
  plddt: String.raw`\mathrm{pLDDT}_i=\sum_{b=1}^{50}p^{\,b}_i\,v_b,\qquad v_b=\text{bin centre of lDDT-C}\alpha\in[0,100]`,
  pae: String.raw`\mathrm{PAE}_{ij}=\mathbb{E}\Bigl[\bigl\|T_i^{-1}\circ\vec x_j-T_i^{\mathrm{true}\,-1}\circ\vec x^{\,\mathrm{true}}_j\bigr\|\Bigr],\quad 64\text{ bins},\ 0\text{–}31.75\,\text{Å}`,
  // ---- AF3
  diffuse: String.raw`\tilde x=x+\sigma\,\varepsilon,\quad \varepsilon\sim\mathcal{N}(0,I),\qquad \mathcal{L}_{\mathrm{diff}}\propto\bigl\|D_\theta(\tilde x,\sigma;\,s,z)-x\bigr\|^{2}`,
};

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const doc = mathjax.document('', { InputJax: new TeX({ packages: ['base', 'ams'] }), OutputJax: new SVG({ fontCache: 'local' }) });

// MathJax output to inline SVG. The ex sizes stay, so CSS font-size scales
// the formula. aria-hidden is removed and a label with the TeX is added.
function svg(tex) {
  const node = doc.convert(tex, { display: true });
  let s = adaptor.innerHTML(node).replace(/ aria-hidden="true"/, '');
  s = s.replace('<svg ', `<svg role="img" aria-label="${tex.replace(/"/g, '&quot;').replace(/</g, '&lt;')}" `);
  if (s.includes('merror')) throw new Error('TeX error in: ' + tex);
  return s;
}

const out = Object.fromEntries(Object.entries(TEX).map(([k, t]) => [k, svg(t)]));
const js = `// ============================================================================
//  ALPHAFOLD EXPLAINED  ·  equation renderer  (GENERATED by typeset.mjs)
// ----------------------------------------------------------------------------
//  Do not edit by hand. Change the TeX in typeset.mjs and run it again.
//  Each formula is static SVG from MathJax, with glyphs as paths. No font
//  or math library loads at run time, so each browser shows the same shape.
//
//  Each element with data-eq="<key>" gets the formula with that key.
//
//  SECTION MAP   (jump with grep -n "<anchor>" equations.js)
//      formulas ........ "const SVG"  the SVG text of each formula
//      mount ........... "data-eq"    fills the slots
// ============================================================================
(function(){
  const SVG = ${JSON.stringify(out, null, 1)};
  window.AfEq = SVG;
  const mount = () => document.querySelectorAll('[data-eq]').forEach(el => {
    const s = SVG[el.getAttribute('data-eq')]; if (s) el.innerHTML = s;
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
`;
const dest = fileURLToPath(new URL('./equations.js', import.meta.url));
writeFileSync(dest, js);
console.log('wrote', dest, js.length, 'bytes');
for (const [k, s] of Object.entries(out)) console.log(' ', k, s.length, 'bytes', s.match(/width="[^"]+" height="[^"]+"/)[0]);
