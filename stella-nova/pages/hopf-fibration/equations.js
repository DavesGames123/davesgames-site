// ============================================================================
//  HOPF FIBRATION  ·  equations.js — the TeX of the page and its colours
// ----------------------------------------------------------------------------
//  The formulas are TeX strings here. lib/sci-math.js typesets them as
//  MathJax SVG at run time and colours each symbol by RULES. The panel
//  labels use the same classes, so a symbol and its control share a colour.
//      z0 .m1 (blue)    z1 .m2 (orange)   t .m3 (green, along the fibre)
//      phi .m4 (pink, longitude: the hue)  theta .m5 (yellow, latitude:
//      the lightness)   a .m6 (violet, the 4D rotation angle)
//  The formulas were checked against the Wikipedia article "Hopf
//  fibration" (complex form of p, fibres as great circles, stereographic
//  projection) and against the node tests in tests.mjs.
//
//  EXPORTS  TEX, RULES, ROT_TEX, typesetPage(), typesetRotation(mode),
//           typesetLive(el, b)        (grep -n "export")
// ============================================================================
import { typeset, typesetAll } from '../../lib/sci-math.js';

export const RULES = [['z_0', 'm1'], ['z_1', 'm2'], ['t', 'm3'], ['\\varphi', 'm4'], ['\\theta', 'm5'], ['a', 'm6']];

export const TEX = {
  map: String.raw`p(z_0,z_1)=\big(2\,z_0\,\bar z_1,\;|z_0|^2-|z_1|^2\big)`,
  where: String.raw`S^3=\{(z_0,z_1)\in\mathbb{C}^2:\ |z_0|^2+|z_1|^2=1\},\quad p:S^3\to S^2\subset\mathbb{C}\times\mathbb{R}`,
  base: String.raw`2\,z_0\bar z_1=\sin\theta\,e^{i\varphi},\qquad |z_0|^2-|z_1|^2=\cos\theta`,
  fibre: String.raw`(z_0,z_1)=e^{it}\big(\cos\tfrac{\theta}{2}\,e^{i\varphi},\ \sin\tfrac{\theta}{2}\big),\quad 0\le t<2\pi`,
  stereo: String.raw`(x_1,x_2,x_3,x_4)\mapsto\frac{(x_1,\,x_2,\,x_3)}{1-x_4},\qquad z_0=x_1+i x_2,\ z_1=x_3+i x_4`,
  link: String.raw`\mathrm{Lk}(A,B)=\frac{1}{4\pi}\oint_A\!\oint_B\frac{(\mathbf{r}_A-\mathbf{r}_B)\cdot(d\mathbf{r}_A\times d\mathbf{r}_B)}{|\mathbf{r}_A-\mathbf{r}_B|^3}=\pm1`,
};

// The 4D rotation of each mode. q = z_0 + z_1 j is the same point as a unit
// quaternion.
export const ROT_TEX = {
  still: String.raw`q\mapsto q`,
  along: String.raw`q\mapsto e^{i a}\,q`,
  isoclinic: String.raw`q\mapsto q\,e^{a u/2},\ \ u=j\cos\beta+k\sin\beta`,
  plane: String.raw`(x_1,x_4)\mapsto(x_1\cos a-x_4\sin a,\ x_1\sin a+x_4\cos a)`,
  double: String.raw`R_{14}(a)\,R_{23}(a/\phi),\ \ \phi=\tfrac{1+\sqrt5}{2}`,
};

// Typeset every [data-tex] box and every [data-eq="key"] box of the page.
export function typesetPage(root = document) {
  root.querySelectorAll('[data-eq]').forEach(el => { el.dataset.tex = TEX[el.dataset.eq] || ''; });
  root.querySelectorAll('[data-sym]').forEach(el => typeset(el, el.dataset.sym, { display: false, rules: RULES }));
  return typesetAll(root, RULES);
}
// The second box (the gauge caption) gets the short form: the text before
// the first ',\ \ '.
export function typesetRotation(els, mode) {
  const full = ROT_TEX[mode] || ROT_TEX.still, short = full.split(',\\ \\ ')[0];
  return Promise.all(els.map((el, i) => el ? typeset(el, i ? short : full, { display: false, rules: RULES }) : false));
}
// The base point of one fibre, as numbers: p = (X + iY, Z).
export function typesetLive(el, b) {
  if (!el) return Promise.resolve(false);
  if (!b) { el.replaceChildren(); el.dataset.tex = ''; return Promise.resolve(false); }
  const f = v => (Math.abs(v) < 5e-4 ? 0 : v).toFixed(3);
  const tex = String.raw`p(z_0,z_1)=\big(${f(b[0])}${b[1] < 0 ? '-' : '+'}${f(Math.abs(b[1]))}\,i,\ ${f(b[2])}\big)`;
  return typeset(el, tex, { display: false, rules: RULES });
}
