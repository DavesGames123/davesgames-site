// ============================================================================
//  library/kit.js  ·  helpers that every library entry uses (DOM-free)
// ----------------------------------------------------------------------------
//  X(src) ........... index TeX -> TensorExpr (never throws; see below)
//  step(...) ........ one OpTrace Step of the contract
//  trace(...) ....... an OpTrace, plus the LIBRARY extras 'checks' and 'values'
//  check(...) ....... a closed-form check { label, got, want, tol, ok }
//  P(defs, params) .. param values with defaults from the entry's params list
//  num, vecTex, matTex  TeX for numbers, vectors and matrices
//  comp(...) ........ Components for Step.numeric
//  METRICS .......... LIBRARY metric objects { id, dim, coords, signature, g(x) }
//  refs: wp(title), CARROLL, MTW, SCHUTZ, PENROSE, and more book refs
//
//  OpTrace extras (not in the contract, CORE may show them):
//      checks: [{ label, got, want, tol, ok }]  numeric result against a
//              closed form, computed on a different path from the trace
//      values: { name: number }                 headline numbers of the run
//
//  X never throws. When the parser refuses a string (a matrix on the right
//  side of an 'evaluate' step, for example), X parses the left side only and
//  keeps the full TeX, with parseError set. Tests require that every entry's
//  main equation parses with no parseError.
// ============================================================================
import * as M from './math.js';
import { toViz } from './scenes.js';

export function X(src) {
  try {
    const e = M.parseIndexTex(src);
    if (e && e.tex == null) e.tex = src;
    return e;
  } catch (err) {
    const left = src.split('=')[0];
    let e;
    try { e = M.parseIndexTex(left); } catch { e = { terms: [], free: [], dummies: [] }; }
    return { ...e, tex: src, parseError: String(err.message || err) };
  }
}

let stepCounter = 0;
export function step(kind, label, before, after, o = {}) {
  return {
    id: o.id ?? `s${++stepCounter}`,
    kind, label,
    before: typeof before === 'string' ? X(before) : before,
    after: typeof after === 'string' ? X(after) : after,
    focus: o.focus ?? [],
    sums: o.sums ?? [],
    ...(o.numeric ? { numeric: o.numeric } : {}),
    ...(o.viz ? { viz: toViz(o.viz) } : {}),
    ms: o.ms ?? 1800,
  };
}

export function trace(steps, o = {}) {
  steps.forEach((s, k) => { s.id = `s${k + 1}`; });
  return { steps, dim: o.dim ?? 3, ...(o.metric ? { metric: o.metric } : {}), ...(o.coords ? { coords: o.coords } : {}), checks: o.checks ?? [], values: o.values ?? {} };
}

export function check(label, got, want, tol = 1e-6) {
  const ok = Number.isFinite(got) && Math.abs(got - want) <= tol * Math.max(1, Math.abs(want));
  return { label, got, want, tol, ok };
}

export function P(defs, params = {}) {
  const out = {};
  for (const d of defs) out[d.key] = params[d.key] != null && Number.isFinite(+params[d.key]) ? +params[d.key] : d.def;
  return out;
}

export function num(v, d = 3) {
  if (!Number.isFinite(v)) return '\\infty';
  if (Math.abs(v) < 0.5 * 10 ** -d) v = 0;
  const s = v.toFixed(d).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}
export const vecTex = (v, d = 3) => `\\begin{pmatrix}${v.map(x => num(x, d)).join('\\\\')}\\end{pmatrix}`;
export const matTex = (A, d = 3) => `\\begin{pmatrix}${A.map(r => r.map(x => num(x, d)).join('&')).join('\\\\')}\\end{pmatrix}`;

// Components for Step.numeric, from a nested array or Components.
export function comp(x, variance) { return M.T(x, variance); }

// ---- metrics ---------------------------------------------------------------
const diag = d => d.map((v, i) => d.map((_, j) => (i === j ? v : 0)));
export const METRICS = {
  euclid: n => ({ id: `euclid${n}`, dim: n, coords: ['x', 'y', 'z', 'w'].slice(0, n), signature: '+'.repeat(n), g: () => diag(new Array(n).fill(1)) }),
  skew: angle => ({ id: 'skew', dim: 2, coords: ['a', 'b'], signature: '++', g: () => [[1, Math.cos(angle)], [Math.cos(angle), 1]] }),
  polar: () => ({ id: 'polar', dim: 2, coords: ['r', '\\theta'], signature: '++', g: x => diag([1, x[0] * x[0]]) }),
  sphere: a => ({ id: 'sphere', dim: 2, coords: ['\\theta', '\\phi'], signature: '++', g: x => diag([a * a, a * a * Math.sin(x[0]) ** 2]) }),
  torus: (R, r) => ({ id: 'torus', dim: 2, coords: ['\\theta', '\\phi'], signature: '++', g: x => diag([r * r, (R + r * Math.cos(x[0])) ** 2]) }),
  spherical: () => ({ id: 'spherical', dim: 3, coords: ['r', '\\theta', '\\phi'], signature: '+++', g: x => diag([1, x[0] ** 2, (x[0] * Math.sin(x[1])) ** 2]) }),
  minkowski: () => ({ id: 'minkowski', dim: 4, coords: ['t', 'x', 'y', 'z'], signature: '-+++', g: () => diag([-1, 1, 1, 1]) }),
  schwarzschild: m => ({ id: 'schwarzschild', dim: 4, coords: ['t', 'r', '\\theta', '\\phi'], signature: '-+++', g: x => { const f = 1 - 2 * m / x[1]; return diag([-f, 1 / f, x[1] ** 2, (x[1] * Math.sin(x[2])) ** 2]); } }),
  // a(t) and k (spatial curvature) given; x = [t, r, theta, phi]
  flrw: (a, k = 0) => ({ id: 'flrw', dim: 4, coords: ['t', 'r', '\\theta', '\\phi'], signature: '-+++', g: x => { const A = a(x[0]) ** 2; return diag([-1, A / (1 - k * x[1] ** 2), A * x[1] ** 2, A * (x[1] * Math.sin(x[2])) ** 2]); } }),
};

// ---- references ------------------------------------------------------------
export const wp = title => ({ text: `Wikipedia: ${title.replace(/_/g, ' ')}`, url: `https://en.wikipedia.org/wiki/${title}` });
export const CARROLL = { text: 'S. M. Carroll, Spacetime and Geometry (2004); free lecture notes arXiv:gr-qc/9712019', url: 'https://arxiv.org/abs/gr-qc/9712019' };
export const MTW = { text: 'C. W. Misner, K. S. Thorne, J. A. Wheeler, Gravitation (1973)', url: 'https://en.wikipedia.org/wiki/Gravitation_(book)' };
export const SCHUTZ = { text: 'B. F. Schutz, A First Course in General Relativity, 2nd ed. (2009)', url: 'https://doi.org/10.1017/CBO9780511984181' };
export const PENROSE = { text: 'R. Penrose, The Road to Reality (2004), ch. 12 and 14: diagrammatic tensor notation', url: 'https://en.wikipedia.org/wiki/The_Road_to_Reality' };
export const PENROSE71 = { text: 'R. Penrose, Applications of negative dimensional tensors (1971), the origin of the diagram notation', url: 'https://en.wikipedia.org/wiki/Penrose_graphical_notation' };
export const CVITANOVIC = { text: 'P. Cvitanovic, Group Theory: Birdtracks, Lie\'s, and Exceptional Groups (2008)', url: 'https://birdtracks.eu/' };
export const JACKSON = { text: 'J. D. Jackson, Classical Electrodynamics, 3rd ed. (1999), ch. 11 and 12', url: 'https://en.wikipedia.org/wiki/Classical_Electrodynamics_(book)' };
export const LL2 = { text: 'L. D. Landau, E. M. Lifshitz, The Classical Theory of Fields (Course of Theoretical Physics, vol. 2)', url: 'https://en.wikipedia.org/wiki/Course_of_Theoretical_Physics' };
export const LL7 = { text: 'L. D. Landau, E. M. Lifshitz, Theory of Elasticity (Course of Theoretical Physics, vol. 7)', url: 'https://en.wikipedia.org/wiki/Course_of_Theoretical_Physics' };
export const GOLDSTEIN = { text: 'H. Goldstein, C. Poole, J. Safko, Classical Mechanics, 3rd ed. (2002), ch. 5', url: 'https://en.wikipedia.org/wiki/Classical_Mechanics_(Goldstein)' };
export const NIELSEN = { text: 'M. A. Nielsen, I. L. Chuang, Quantum Computation and Quantum Information (2000)', url: 'https://en.wikipedia.org/wiki/Quantum_Computation_and_Quantum_Information' };
export const VASWANI = { text: 'A. Vaswani et al., Attention Is All You Need (2017)', url: 'https://arxiv.org/abs/1706.03762' };
export const BRIDGEMAN = { text: 'J. C. Bridgeman, C. T. Chubb, Hand-waving and interpretive dance: an introductory course on tensor networks (2017)', url: 'https://arxiv.org/abs/1603.03039' };
export const MALVERN = { text: 'L. E. Malvern, Introduction to the Mechanics of a Continuous Medium (1969)', url: 'https://en.wikipedia.org/wiki/Continuum_mechanics' };
