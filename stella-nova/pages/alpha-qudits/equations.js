// ============================================================================
//  ALPHA FROM ENTANGLED QUDITS  ·  equations.js  (CORE, DOM-free)
// ----------------------------------------------------------------------------
//  Every display equation of the page as TeX, by key. story/*.js puts an
//  equation in a chapter with { eq: 'key', note: '...' }, and main.js
//  typesets it through ../../lib/sci-math.js (MathJax SVG, never KaTeX).
//
//  COLOUR. The TeX carries the lib/sci.css classes itself, so no colorize
//  rules are needed. One class per kind of thing, on the whole page:
//      m1  qubit (d = 2) and its slots q1, q2, f
//      m2  qutrit (d = 3) and its copies Q1, Q2, Q3
//      m3  records, letters and weights (k, sqrt k)
//      m4  the charge Q, the hypercharge Y, the unbroken generator U
//      m5  alpha and the value of the readout
//      m6  the readout dimension N and the readout algebra R
//
//  tests.mjs typesets every string in EQ and INLINE with mathjax-full in
//  node, when NODE_PATH holds it, and fails on a TeX error.
//
//  GREP MAP
//      grep -n 'export const C'       the colour wrappers
//      grep -n 'export const EQ'      display equations by key
//      grep -n 'export const INLINE'  short inline TeX the story uses
// ============================================================================

const cls = n => s => `\\class{m${n}}{${s}}`;
export const C = { qb: cls(1), qt: cls(2), rec: cls(3), q: cls(4), a: cls(5), n: cls(6) };
const { qb, qt, rec, q, a, n } = C;

const ALPHA_CAND = `\\frac{79 + 48\\sqrt{2} + 42\\sqrt{3} + 3\\sqrt{6}}{${n('31104')}}`;

export const EQ = {
  // ---------------------------------------------------------------- c0
  hero: `${a('\\alpha_{\\text{cand}}')} = ${ALPHA_CAND}, \\qquad ${a('\\alpha_{\\text{cand}}^{-1}')} = 137.035\\,999\\,189\\,566\\ldots`,

  // ---------------------------------------------------------------- c1
  alphaDef: `${a('\\alpha')} = \\frac{e^{2}}{4\\pi\\varepsilon_{0}\\hbar c} \\approx \\frac{1}{137.036}`,
  onShell: `${a('\\alpha(0)')} = Z_{3}\\,${a('\\alpha_{\\text{bare}}')}, \\qquad Z_{1} = Z_{2}`,
  running: `\\frac{1}{${a('\\alpha(Q)')}} \\approx \\frac{1}{${a('\\alpha(0)')}} - \\frac{2}{3\\pi}\\ln\\frac{Q}{m_{e}c^{2}} \\qquad (Q \\gg m_{e}c^{2},\\ \\text{electron loop only})`,

  // ---------------------------------------------------------------- c2
  pairKet: `|\\omega_{m}\\rangle = \\frac{1}{\\sqrt{m}}\\sum_{i=1}^{m} |i\\rangle|i\\rangle, \\qquad m = \\min(d_{1}, d_{2})`,
  distill: `P_{m} = |\\omega_{m}\\rangle\\langle\\omega_{m}|`,
  swap: `\\langle\\omega_{d}|_{23}\\,|\\omega_{d}\\rangle_{12}|\\omega_{d}\\rangle_{34} = \\frac{1}{d}\\,|\\omega_{d}\\rangle_{14}`,

  // ---------------------------------------------------------------- c3
  transpose: `(A \\otimes \\mathbf{1})\\,|\\omega_{m}\\rangle = (\\mathbf{1} \\otimes A^{\\mathsf{T}})\\,|\\omega_{m}\\rangle`,
  matching: `(U \\otimes \\bar{U})\\,|\\omega_{m}\\rangle = |\\omega_{m}\\rangle`,
  letters: `(d+1)(d-1) = d^{2}-1: \\qquad ${qb('3')}\\ \\text{at a qubit (Pauli)}, \\quad ${qt('8')}\\ \\text{at a qutrit (Gell-Mann)}`,
  weyl: `${qb('\\sigma_{x}\\sigma_{z} = -\\,\\sigma_{z}\\sigma_{x}')}, \\qquad ${qt('Z X = \\omega\\, X Z')}, \\quad \\omega = e^{2\\pi i/3}`,
  signOnly: `AB = \\lambda BA \\;\\Rightarrow\\; \\lambda^{d} = 1, \\qquad \\lambda = \\lambda^{-1} \\;\\Rightarrow\\; \\lambda = \\pm 1 \\text{ only at even } d`,

  // ---------------------------------------------------------------- c4
  decomposable: `\\Lambda = \\Phi_{1} + \\Phi_{2}\\circ T, \\qquad \\Phi_{1}, \\Phi_{2}\\ \\text{completely positive}`,
  readCap: `\\text{readable} \\iff d_{1} d_{2} \\le 6: \\qquad (${qb('2')},${qb('2')}),\\ (${qb('2')},${qt('3')})`,

  // ---------------------------------------------------------------- c5
  algebra: `\\begin{gathered} \\mathfrak{su}(${qt('3')}) \\oplus \\mathfrak{su}(${qb('2')}) \\oplus \\mathfrak{u}(1) = \\operatorname{Lie} S\\big(U(${qt('3')}) \\times U(${qb('2')})\\big) \\\\ S\\big(U(3)\\times U(2)\\big) \\cong \\frac{SU(3)\\times SU(2)\\times U(1)}{\\mathbb{Z}_{6}} \\end{gathered}`,
  charge: `${q('Q')} = i\\,\\operatorname{diag}\\big(d_{2}\\mathbf{1}_{d_{1}};\\, -d_{1}\\mathbf{1}_{d_{2}}\\big), \\qquad ${q('Q')}\\,|\\omega_{m}\\rangle = i\\,(d_{2}-d_{1})\\,|\\omega_{m}\\rangle`,
  hyper: `${q('Q')} = i\\,\\operatorname{diag}(3,3;-2,-2,-2) = 6i\\,${q('Y')}, \\qquad ${q('Y')} = \\operatorname{diag}\\!\\left(\\tfrac12,\\tfrac12;-\\tfrac13,-\\tfrac13,-\\tfrac13\\right)`,
  doublet: `${q('Y')}\\big|_{\\mathbb{C}^{2}\\otimes\\mathbb{C}^{3}} = \\tfrac12 - \\tfrac13 = \\tfrac16 \\quad (\\mathbf{3}, \\mathbf{2})_{1/6}`,
  unbroken: `${q('U')} = i\\,\\operatorname{diag}(1,1;-1,-1,0)`,
  conserved: `2x + 3y = 0 \\;\\Rightarrow\\; (x, y) \\propto (3, -2), \\qquad 3 + (-2) = 1`,

  // ---------------------------------------------------------------- c6
  jointState: `|\\Omega\\rangle = \\sqrt{6}\\,(P_{3})_{${qt('Q_1')}${qt('Q_2')}}\\,|\\omega_{2}\\rangle_{${qt('Q_1')}${qb('q_1')}}|\\omega_{2}\\rangle_{${qt('Q_2')}${qb('q_2')}}|\\omega_{2}\\rangle_{${qt('Q_3')}${qb('f')}}`,
  path: `\\frac{1}{\\sqrt{2}}\\cdot\\frac{1}{\\sqrt{3}}\\cdot\\frac{1}{\\sqrt{2}} = \\frac{1}{2\\sqrt{3}}, \\qquad 12 \\times \\frac{1}{12} = 1`,

  // ---------------------------------------------------------------- c7
  readoutDim: `${n('N')} = \\dim ${n('R')} = \\underbrace{(${qt('3')}^{2}-1)(${qb('2')}^{2}-1)}_{\\text{unread: }24}\\cdot\\underbrace{(${qt('3')}\\cdot${qb('2')})^{2}}_{\\text{read: }36}\\cdot 36 \\qquad = ${n('31104')} = 2^{7}3^{5}`,
  products: `\\underbrace{${qt('8')}\\cdot${qt('8')}}_{${qt('Q_1')}${qt('Q_2')}} + \\underbrace{${qb('3')}\\cdot${qb('3')}}_{${qb('q_1')}${qb('q_2')}} + 4\\cdot\\underbrace{${qt('8')}\\cdot${qb('3')}}_{\\text{mixed}} \\qquad = 64 + 9 + 96 = ${rec('169')}`,
  records: `${rec('169')}\\ \\text{products} + ${rec('3')}\\ \\text{commutators} = ${rec('172')}\\ \\text{records}`,
  readout: `\\langle M\\rangle = \\frac{\\operatorname{tr}_{${n('R')}} M}{\\dim ${n('R')}}`,

  // ---------------------------------------------------------------- c8
  exchanges: `X_{r} = \\begin{cases} -p_{r} & \\text{both slots at one end} \\\\ +1 & \\text{one slot at each end}\\end{cases} \\qquad Y_{r} = \\begin{cases} +1 & \\text{both slots at one end} \\\\ -p_{r} & \\text{one slot at each end}\\end{cases}`,
  weight: `${rec('k_{r}')} = 3^{[X_{r}=-1]}\\,2^{[Y_{r}=-1]} = \\tfrac12\\,(2-X_{r})(3-Y_{r}) \\in \\{1, 2, 3, 6\\}`,
  strandSum: `d \\cdot \\frac{1}{\\sqrt{d}} = \\sqrt{d}: \\qquad ${qt('\\sqrt{3}')}\\ \\text{for } X, \\quad ${qb('\\sqrt{2}')}\\ \\text{for } Y`,
  sectors: `\\begin{aligned} (+,+)&: \\tfrac12(a^{2}-a+b^{2}-b)+2ab = ${rec('79')} \\\\ (+,-)&: 2ab = ${rec('48')} \\\\ (-,+)&: \\tfrac12(a^{2}+a+b^{2}+b) = ${rec('42')} \\\\ (-,-)&: \\tfrac12 b(b-1) = ${rec('3')} \\end{aligned}`,
  value: `\\frac{G_{\\text{dressed}}}{G_{\\text{bare}}} = \\frac{1}{${n('N')}}\\sum_{r=1}^{${rec('172')}} \\sqrt{${rec('k_{r}')}} \\qquad = ${ALPHA_CAND}`,
  coords: `${a('\\alpha_{\\text{cand}}')} = \\tfrac{79}{31104} + \\tfrac{1}{648}\\sqrt{2} \\qquad + \\tfrac{7}{5184}\\sqrt{3} + \\tfrac{1}{10368}\\sqrt{6} \\qquad \\in \\mathbb{Q}(\\sqrt{2}, \\sqrt{3})`,

  // ---------------------------------------------------------------- c9
  factorize: `\\frac{G_{\\text{dressed}}}{G_{\\text{bare}}} = Z_{3}\\left(\\frac{Z_{2}}{Z_{1}}\\right)^{2} ${a('\\alpha_{\\text{bare}}')}, \\qquad ${a('\\alpha_{\\text{bare}}')} = \\tfrac12 + \\tfrac12 = 1, \\quad \\frac{Z_{2}}{Z_{1}} = 1`,
  digits: `${a('\\alpha_{\\text{cand}}^{-1}')} = 137.035\\,999\\,189\\,566\\,155\\,029\\,183\\,744\\,020\\,866\\ldots`,
  sigma: `n_{\\sigma} = \\frac{${a('\\alpha_{\\text{cand}}^{-1}')} - \\alpha^{-1}_{\\text{meas}}}{u(\\alpha^{-1}_{\\text{meas}})}`,

  // ---------------------------------------------------------------- c10
  wyler: `${a('\\alpha_{\\text{W}}')} = \\frac{9}{8\\pi^{4}}\\left(\\frac{\\pi^{5}}{2^{4}\\cdot 5!}\\right)^{1/4} = \\frac{1}{137.036\\,08\\ldots}`,
  family: `x = \\frac{a + b\\sqrt{2} + c\\sqrt{3} + d\\sqrt{6}}{D}, \\qquad a, b, c, d \\in \\{0, \\ldots, c_{\\max}\\}`,
};

// Long equations stack their parts on lines, so that they fit a phone:
// each '\\qquad' (with a comma before it) starts a new line of a gathered
// block (lines centred). A part that starts with '=', '+' or '\\in'
// continues the line before it.
const G = rows => `\\begin{gathered} ${rows.join(' \\\\ ')} \\end{gathered}`;
const STACK = ['hero', 'running', 'pairKet', 'letters', 'weyl', 'signOnly', 'decomposable', 'readCap', 'charge', 'hyper', 'conserved', 'path', 'readoutDim', 'products', 'exchanges', 'strandSum', 'value', 'coords', 'factorize', 'family'];
for (const k of STACK) EQ[k] = G(EQ[k].split(/,?\s*\\qquad\s*/));

// Short TeX for inline use in the story text (data-inline boxes).
export const INLINE = {
  alpha: a('\\alpha'),
  alpha0: a('\\alpha(0)'),
  alphaInv: a('\\alpha^{-1}'),
  cand: a('\\alpha_{\\text{cand}}'),
  omega: '|\\omega_{m}\\rangle',
  omega2: '|\\omega_{2}\\rangle',
  omega3: '|\\omega_{3}\\rangle',
  Pm: 'P_{m}',
  UUbar: 'U\\otimes\\bar U',
  AT: 'A^{\\mathsf{T}}',
  Q: q('Q'), Y: q('Y'), U: q('U'),
  N: n('N'), R: n('R'),
  k: rec('k_{r}'), sqrtk: rec('\\sqrt{k_{r}}'),
  Q1: qt('Q_1'), Q2: qt('Q_2'), Q3: qt('Q_3'), q1: qb('q_1'), q2: qb('q_2'), f: qb('f'),
  Z3: 'Z_{3}', Z1Z2: 'Z_{1} = Z_{2}',
  d1d2: 'd_{1}d_{2}',
  r2: rec('\\sqrt{2}'), r3: rec('\\sqrt{3}'), r6: rec('\\sqrt{6}'),
  X: 'X', Yx: 'Y',
};
