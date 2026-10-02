// ============================================================================
//  TWENTY TO FOUR  ·  equation typesetter  (Node, run by hand)
// ----------------------------------------------------------------------------
//  Typesets every formula of the page with MathJax into static SVG and
//  writes equations.js. The page then shows the same glyph outlines in each
//  browser and loads no math library. KaTeX HTML broke in Safari: subscripts
//  and fraction denominators stayed on the baseline (see hydrogen-table).
//
//  Colour: each symbol family is wrapped in \class{mN}{...}. MathJax keeps
//  the class on the SVG group, and lib/sci.css gives .m1 to .m6 a fill. The
//  classes are the same as on the other field pages (maxwells-equations,
//  smith-chart). style.css --e, --b ... and main.js PAL use the same values.
//    m2  electric field E, D       m1  magnetic field B, H
//    m3  vector potential A, φ     m4  charge ρ
//    m5  current J, J'             m6  wavelength λ (label only)
//  Operators, constants and the displacement term stay ink.
//
//  RUN (MathJax is not a dependency of the site):
//      cd "$(mktemp -d)" && npm i mathjax-full@3 && \
//        NODE_PATH="$PWD/node_modules" node \
//        <repo>/stella-nova/pages/twenty-to-four/typeset.mjs
//  The script writes equations.js next to itself.
//
//  SECTION MAP   (jump with grep -n "<anchor>" typeset.mjs)
//      symbol macros ... "const E ="      \class wrappers per symbol family
//      concept table ... "const CONCEPTS" the 20 -> 4 collapse, with ov keys
//      the four ........ "const FOUR"     the summary grid
//      svg cleanup ..... "function svg"   MathJax output to inline SVG
//      inline math ..... "function prose" \( \) inside notes to inline SVG
//      label symbols ... "const SYM"      inline symbols for the legend and
//                                         the slider labels
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

const S = String.raw;
// Symbol macros: one \class per family (see the header).
const E = t => S`\class{m2}{${t}}`, B = t => S`\class{m1}{${t}}`, A = t => S`\class{m3}{${t}}`;
const J = t => S`\class{m5}{${t}}`, Q = t => S`\class{m4}{${t}}`, L = t => S`\class{m6}{${t}}`;
// Operators and the displacement term are not quantities: they stay ink.
const O = t => t, DISP = t => t;
const d = i => O(S`\partial_${i}`), nabla = O(S`\nabla`), rho = Q(S`\rho`), phi = A(S`\varphi`);

// The concept table. role: core (one of the four), aside (a material
// relation) or follows (not independent). Each line has an ov key that
// main.js reads (OVL table) to paint that quantity on the canvas.
const CONCEPTS = [
  { key: 'gaussE', role: 'core', numeral: 'I', name: 'Gauss’s law', tag: 'electric',
    plain: 'Electric field lines begin and end on charge.',
    src: 'G · free charge  ·  E · elasticity',
    lines: [
      [S`${d('x')}${E('D_x')}+${d('y')}${E('D_y')}+${d('z')}${E('D_z')}=${rho}`, 'divE'],
      [S`${E('D_x')}=\varepsilon\,${E('E_x')}`, 'Ex'],
      [S`${E('D_y')}=\varepsilon\,${E('E_y')}`, 'Ey'],
      [S`${E('D_z')}=\varepsilon\,${E('E_z')}`, 'zero'],
    ],
    heav: S`${nabla}\cdot${E(S`\vec{E}`)}=\dfrac{${rho}}{\varepsilon_0}`,
    note: S`Put \(${E('D')}=\varepsilon ${E('E')}\) into the first line, and the three terms \(\partial_i ${E('D_i')}\) fold into one <b>divergence</b>.` },
  { key: 'gaussB', role: 'core', numeral: 'II', name: 'Gauss’s law', tag: 'magnetic',
    plain: 'There is no magnetic charge. Every B line closes on itself.',
    src: 'B · field from the vector potential',
    lines: [
      [S`${B('B_x')}=${d('y')}${A('A_z')}-${d('z')}${A('A_y')}`, 'zero'],
      [S`${B('B_y')}=${d('z')}${A('A_x')}-${d('x')}${A('A_z')}`, 'zero'],
      [S`${B('B_z')}=${d('x')}${A('A_y')}-${d('y')}${A('A_x')}`, 'Bz'],
    ],
    heav: S`${nabla}\cdot${B(S`\vec{B}`)}=0`,
    note: S`Because \(${B(S`\vec B`)}=\nabla\times${A(S`\vec A`)}\), the identity \(\nabla\cdot(\nabla\times${A(S`\vec A`)})=0\) makes this law true <b>for free</b>.` },
  { key: 'faraday', role: 'core', numeral: 'III', name: 'Faraday’s law', tag: 'induction',
    plain: 'A changing magnetic field drives a curling electric field.',
    src: 'D · electromotive force',
    lines: [
      [S`${E('E_x')}=\mu(v_y${B('H_z')}-v_z${B('H_y')})-${O(S`\partial_t`)}${A('A_x')}-${d('x')}${phi}`, 'Ex'],
      [S`${E('E_y')}=\mu(v_z${B('H_x')}-v_x${B('H_z')})-${O(S`\partial_t`)}${A('A_y')}-${d('y')}${phi}`, 'Ey'],
      [S`${E('E_z')}=\mu(v_x${B('H_y')}-v_y${B('H_x')})-${O(S`\partial_t`)}${A('A_z')}-${d('z')}${phi}`, 'zero'],
    ],
    heav: S`${nabla}\times${E(S`\vec{E}`)}=-\dfrac{\partial${B(S`\vec{B}`)}}{\partial t}`,
    note: S`Drop the motional term and take the <b>curl</b>: \(\nabla\times(-\partial_t${A(S`\vec A`)})=-\partial_t${B(S`\vec B`)}\).` },
  { key: 'ampere', role: 'core', numeral: 'IV', name: 'Ampère–Maxwell law', tag: 'circulation',
    plain: 'Current, and a changing electric field, curl the magnetic field.',
    src: 'C · circuital law  ·  A · total current',
    lines: [
      [S`${d('y')}${B('H_z')}-${d('z')}${B('H_y')}=${J("J'_x")}`, 'curlHx'],
      [S`${d('z')}${B('H_x')}-${d('x')}${B('H_z')}=${J("J'_y")}`, 'curlHy'],
      [S`${d('x')}${B('H_y')}-${d('y')}${B('H_x')}=${J("J'_z")}`, 'zero'],
      [S`${J("J'_x")}=${J('J_x')}+${DISP(S`\partial_t ${E('D_x')}`)}`, 'dExdt'],
      [S`${J("J'_y")}=${J('J_y')}+${DISP(S`\partial_t ${E('D_y')}`)}`, 'dEydt'],
      [S`${J("J'_z")}=${J('J_z')}+${DISP(S`\partial_t ${E('D_z')}`)}`, 'zero'],
    ],
    heav: S`${nabla}\times${B(S`\vec{B}`)}=\mu_0${J(S`\vec{J}`)}+${DISP(S`\mu_0\varepsilon_0\dfrac{\partial${E(S`\vec{E}`)}}{\partial t}`)}`,
    note: S`The curl of \(${B('H')}\) is the <b>total</b> current. Its \(\partial ${E('D')}/\partial t\) part is Maxwell’s <b>displacement current</b>: the term that lets the loops on the canvas break free and travel as light.` },
  { key: 'const', role: 'aside', numeral: '', name: 'Constitutive relations', tag: 'set aside',
    plain: 'How a material answers the field. They describe the medium, not the field.',
    src: 'F · Ohm’s law  ·  E · elasticity',
    lines: [
      [S`${J('J_x')}=\sigma\,${E('E_x')}`, 'Ex'],
      [S`${J('J_y')}=\sigma\,${E('E_y')}`, 'Ey'],
      [S`${J('J_z')}=\sigma\,${E('E_z')}`, 'zero'],
    ],
    heav: S`${J(S`\vec J`)}=\sigma${E(S`\vec E`)},\qquad ${E(S`\vec D`)}=\varepsilon${E(S`\vec E`)}`,
    note: S`Material relations sit outside the famous four.` },
  { key: 'contin', role: 'follows', numeral: '', name: 'Continuity', tag: 'follows',
    plain: 'Charge is conserved. This follows from the Ampère–Maxwell law.',
    src: 'H · conservation of charge',
    lines: [
      [S`${d('x')}${J('J_x')}+${d('y')}${J('J_y')}+${d('z')}${J('J_z')}+${O(S`\partial_t`)}${rho}=0`, 'zero'],
    ],
    heav: S`${nabla}\cdot${J(S`\vec J`)}+\dfrac{\partial${rho}}{\partial t}=0`,
    note: S`Take the divergence of Ampère–Maxwell: \(\nabla\cdot(\nabla\times${B(S`\vec B`)})=0\) leaves exactly this line.` },
];

const FOUR = [
  ['I', 'Gauss · electric', S`${nabla}\cdot${E(S`\vec E`)}=\dfrac{${rho}}{\varepsilon_0}`],
  ['II', 'Gauss · magnetic', S`${nabla}\cdot${B(S`\vec B`)}=0`],
  ['III', 'Faraday', S`${nabla}\times${E(S`\vec E`)}=-\dfrac{\partial${B(S`\vec B`)}}{\partial t}`],
  ['IV', 'Ampère–Maxwell', S`${nabla}\times${B(S`\vec B`)}=\mu_0${J(S`\vec J`)}+${DISP(S`\mu_0\varepsilon_0\dfrac{\partial${E(S`\vec E`)}}{\partial t}`)}`],
];

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const doc = mathjax.document('', { InputJax: new TeX({ packages: ['base', 'ams', 'html'] }), OutputJax: new SVG({ fontCache: 'local' }) });

// MathJax output to inline SVG. The ex sizes stay, so CSS font-size scales
// the formula. aria-hidden goes, and the TeX becomes the label.
let nSvg = 0;
function svg(tex, display = true) {
  const node = doc.convert(tex, { display });
  let s = adaptor.innerHTML(node).replace(/ aria-hidden="true"/, '');
  if (s.includes('merror')) throw new Error('TeX error in: ' + tex);
  // Glyph ids are MJX-<n>-...; give every SVG its own prefix so the ids in
  // one document never clash.
  const id = 'T' + (nSvg++);
  s = s.replace(/MJX-(\d+)-/g, `MJX-${id}-`);
  const label = tex.replace(/\\class\{m\d\}/g, '').replace(/"/g, '&quot;');
  return s.replace('<svg ', `<svg class="mj" aria-label="${label}" `);
}
// Prose with inline \( \) math: each piece becomes an inline SVG.
const prose = html => html.replace(/\\\((.+?)\\\)/g, (m, tex) => svg(tex, false));

let n = 0;
const data = {
  concepts: CONCEPTS.map(c => ({
    key: c.key, role: c.role, numeral: c.numeral, name: c.name, tag: c.tag, plain: c.plain, src: c.src,
    lines: c.lines.map(([tex, ov]) => ({ n: ++n, ov, svg: svg(tex, false) })),
    heav: svg(c.heav),
    note: prose(c.note),
  })),
  four: FOUR.map(([numeral, name, tex]) => ({ numeral, name, svg: svg(tex) })),
};
// Inline symbols for the legend (E, B) and the slider labels. concepts.js
// puts each one into the element with the matching data-sym.
const SYM = { E: E(S`\vec E`), B: B(S`\vec B`), f: 'f', lambda: L(S`\lambda`), axis: S`\theta_a` };
data.sym = Object.fromEntries(Object.entries(SYM).map(([k, t]) => [k, svg(t, false)]));
if (n !== 20) throw new Error(`expected 20 scalar lines, got ${n}`);

const js = `// ============================================================================
//  TWENTY TO FOUR  ·  equation data  (GENERATED by typeset.mjs)
// ----------------------------------------------------------------------------
//  Do not edit by hand. Change the TeX in typeset.mjs and run it again.
//  window.T24 holds the six concept blocks (20 scalar lines, each with its
//  canvas overlay key ov) and the four vector equations, as static MathJax
//  SVG. concepts.js builds the panel from it. window.T24.sym holds the
//  inline label symbols. Symbol colours are the .m1 to .m6 classes of
//  lib/sci.css.
// ============================================================================
window.T24 = ${JSON.stringify(data)};
`;
const dest = fileURLToPath(new URL('./equations.js', import.meta.url));
writeFileSync(dest, js);
console.log('wrote', dest, js.length, 'bytes,', n, 'scalar lines,', nSvg, 'svg');
