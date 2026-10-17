// ============================================================================
//  TENSOR CALCULUS  ·  ui/ops.js  ·  playground operations -> OpTrace (CORE)
// ----------------------------------------------------------------------------
//  DOM-free. The playground applies one operation to the expression the
//  reader typed, and plays the result as an OpTrace in the three views.
//  The steps are symbolic: each one is a TensorExpr made with the MATH
//  expression functions (parseIndexTex, toTex, relabel, makeExpr,
//  cloneExpr), so the TeX, the diagram and the 3D view all get real
//  TensorExpr objects. The transform step also carries numbers
//  (step.numeric) from MATH transform() for a one-factor expression.
//
//  OPERATIONS  (OPS below; args in brackets)
//    contract [a: upper free, b: lower free]   b becomes a, then a is summed
//    trace                                      contract the first pair
//    raise [s: lower free]    g^{s d} T_{..d..} then sum over d
//    lower [s: upper free]    g_{s d} T^{..d..} then sum over d
//    transform [jacobian]     J^a_c (J^-1)^d_b T^c_d, then the primed tensor
//    symmetrize [a, b]        T_{(ab)} = 1/2 (T_{ab} + T_{ba})
//    antisymmetrize [a, b]    T_{[ab]} = 1/2 (T_{ab} - T_{ba})
//    covariant [d]            nabla_d T = partial_d T + Gamma terms
//    product [tex]            the outer product with a second expression
//    expandSum                write out each Einstein sum
//  Each builder throws an OpError with a plain sentence when the
//  operation does not apply (for example, raise on an upper index).
//
//  JACOBIANS (for transform): rotation (angle), stretch (sx, sy),
//  shear (k), boost (beta, 4D), polar (r, theta: Cartesian to polar).
//
//  EXPORTS   (grep -n "export" ui/ops.js)
//      OPS, JACOBIANS, OpError, freeIndices(expr), freshSym(expr, prefer),
//      jacobianMatrix(id, dim, p), buildOpTrace(M, expr, op, args, opts)
// ============================================================================

export class OpError extends Error { constructor(msg) { super(msg); this.name = 'OpError'; } }

export const OPS = Object.freeze([
  { id: 'contract', label: 'Contract', args: ['up', 'down'], blurb: 'Join an upper and a lower index and sum over them.' },
  { id: 'trace', label: 'Trace', args: [], blurb: 'Contract the first upper index with the first lower index.' },
  { id: 'raise', label: 'Raise', args: ['down'], blurb: 'Use the inverse metric to turn a lower index into an upper one.' },
  { id: 'lower', label: 'Lower', args: ['up'], blurb: 'Use the metric to turn an upper index into a lower one.' },
  { id: 'transform', label: 'Transform', args: ['jacobian'], blurb: 'Change coordinates: upper slots get J, lower slots get the inverse of J.' },
  { id: 'symmetrize', label: 'Symmetrise', args: ['pair'], blurb: 'Average over the swap of two indices of the same height.' },
  { id: 'antisymmetrize', label: 'Antisymmetrise', args: ['pair'], blurb: 'Half the difference of the two orders of two indices.' },
  { id: 'covariant', label: 'Covariant derivative', args: ['newsym'], blurb: 'Take nabla: the partial derivative plus a Christoffel term for each index.' },
  { id: 'product', label: 'Tensor product', args: ['tex'], blurb: 'Multiply by a second tensor; all slots are kept.' },
  { id: 'expandSum', label: 'Write out sums', args: [], blurb: 'Write each summed index as an explicit sum of components.' },
]);

export const JACOBIANS = Object.freeze([
  { id: 'rotation', label: 'Rotation', params: [{ key: 'angle', label: 'angle', min: -3.1416, max: 3.1416, step: 0.01, def: 0.6 }] },
  { id: 'stretch', label: 'Stretch', params: [{ key: 'sx', label: 'x scale', min: 0.2, max: 3, step: 0.01, def: 2 }, { key: 'sy', label: 'y scale', min: 0.2, max: 3, step: 0.01, def: 0.5 }] },
  { id: 'shear', label: 'Shear', params: [{ key: 'k', label: 'shear', min: -2, max: 2, step: 0.01, def: 0.8 }] },
  { id: 'boost', label: 'Lorentz boost', params: [{ key: 'beta', label: 'speed v/c', min: -0.95, max: 0.95, step: 0.01, def: 0.6 }] },
  { id: 'polar', label: 'Cartesian to polar', params: [{ key: 'r', label: 'r', min: 0.2, max: 3, step: 0.01, def: 1.5 }, { key: 'theta', label: 'theta', min: -3.1416, max: 3.1416, step: 0.01, def: 0.7 }] },
]);

const GREEK_POOL = ['lambda', 'sigma', 'kappa', 'alpha', 'beta', 'gamma', 'tau', 'rho', 'eta', 'xi', 'zeta', 'delta', 'mu', 'nu'];
const LATIN_POOL = ['k', 'l', 'm', 'n', 'p', 'q', 'r', 's', 'a', 'b', 'c', 'd', 'e', 'f', 'i', 'j'];

function allSyms(expr) {
  const s = new Set();
  for (const t of expr.terms) for (const f of t.factors) { for (const i of f.indices || []) s.add(i.sym); for (const i of f.deriv || []) s.add(i.sym); }
  return s;
}

export function freeIndices(expr) { return (expr && expr.free) || []; }

export function freshSym(expr, prefer = null, avoid = []) {
  const used = allSyms(expr);
  for (const a of avoid) used.add(a);
  const greek = [...used].some(s => s.length > 1) || (prefer && prefer.length > 1);
  const pool = greek ? GREEK_POOL : LATIN_POOL;
  for (const s of pool) if (!used.has(s)) return s;
  for (let k = 1; k < 9; k++) for (const s of pool) if (!used.has(s + "'".repeat(k))) return s + "'".repeat(k);
  throw new OpError('No free index letter is left.');
}

const T = s => (/^[A-Za-z]+'*$/.test(s) && s.replace(/'+$/, '').length > 1 ? '\\' + s : s);

export function jacobianMatrix(id, dim, p = {}) {
  const I = n => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  const J = I(dim);
  if (id === 'rotation') { const a = p.angle ?? 0.6, c = Math.cos(a), s = Math.sin(a); J[0][0] = c; J[0][1] = -s; J[1][0] = s; J[1][1] = c; }
  else if (id === 'stretch') { J[0][0] = p.sx ?? 2; J[1][1] = p.sy ?? 0.5; }
  else if (id === 'shear') { J[0][1] = p.k ?? 0.8; }
  else if (id === 'boost') {
    const b = p.beta ?? 0.6, g = 1 / Math.sqrt(1 - b * b);
    if (dim < 2) throw new OpError('A boost needs two or more dimensions.');
    J[0][0] = g; J[0][1] = -g * b; J[1][0] = -g * b; J[1][1] = g;
  } else if (id === 'polar') {
    // dx'^a/dx^b for x' = (r, theta) as functions of (x, y), at the point (r, theta).
    const r = p.r ?? 1.5, th = p.theta ?? 0.7, c = Math.cos(th), s = Math.sin(th);
    J[0][0] = c; J[0][1] = s; J[1][0] = -s / r; J[1][1] = c / r;
  } else throw new OpError('Unknown Jacobian ' + id);
  return J;
}

function plain(M, e) { return M.toTex(e, { colors: false }); }
function parse(M, tex) { return M.parseIndexTex(tex); }

function needPlain(expr) {
  if (expr.rel) throw new OpError('An operation acts on an expression. Remove the = and one side.');
}

function find(expr, sym, up) {
  const f = freeIndices(expr).find(i => i.sym === sym);
  if (!f) throw new OpError(`${sym} is not a free index of the expression.`);
  if (up != null && f.up !== up) throw new OpError(`${sym} is ${f.up ? 'an upper' : 'a lower'} index here.`);
  return f;
}

function flipHeight(M, expr, sym) {
  const e = M.cloneExpr(expr);
  for (const t of e.terms) for (const f of t.factors) for (const ix of f.indices) if (ix.sym === sym) ix.up = !ix.up;
  return M.makeExpr(e.terms);
}

function sampleComponents(M, f, dim) {
  const n = f.indices.length;
  if (!n || !M.Tensor) return null;
  const shape = Array(n).fill(dim), variance = f.indices.map(i => (i.up ? 'u' : 'd'));
  const size = dim ** n, data = new Float64Array(size);
  for (let k = 0; k < size; k++) data[k] = Math.round(10 * Math.sin(1.7 * k + 0.4 * n + 1)) / 10 + (n === 2 && k % (dim + 1) === 0 ? 1 : 0);
  return new M.Tensor(shape, variance, data);
}

const plainComp = t => (t ? { shape: t.shape.slice(), variance: t.variance.slice(), data: Float64Array.from(t.data) } : null);

function stepOf(id, kind, label, before, after, o = {}) {
  return { id, kind, label, before, after, focus: o.focus || [], sums: o.sums || [], numeric: o.numeric, viz: o.viz, ms: o.ms || 2600 };
}

export function buildOpTrace(M, expr, op, args = {}, opts = {}) {
  if (!M || !M.parseIndexTex) throw new OpError('The tensor engine has not loaded.');
  const dim = opts.dim || 3;
  const sums = s => [{ sym: s, range: [0, dim] }];
  const steps = [];
  const free = freeIndices(expr);
  let n = 0;
  const id = () => 'p' + (++n);
  needPlain(expr);

  switch (op) {
    case 'trace':
    case 'contract': {
      let a = args.up, b = args.down;
      if (op === 'trace' || !a || !b) {
        a = a || (free.find(i => i.up) || {}).sym; b = b || (free.find(i => !i.up) || {}).sym;
      }
      if (!a || !b) throw new OpError('A contraction needs one free upper index and one free lower index.');
      find(expr, a, true); find(expr, b, false);
      const after = M.relabel(expr, { [b]: a });
      steps.push(stepOf(id(), 'relabel', `Give the lower index ${b} the same letter as the upper index ${a}.`, expr, after, { focus: [a, b], viz: { scene: 'contraction-block' } }));
      steps.push(stepOf(id(), 'contract', `Now ${a} is up once and down once, so the Einstein rule sums over it. The rank goes down by two.`, after, after, { focus: [a], sums: sums(a), viz: { scene: 'contraction-block' } }));
      break;
    }
    case 'raise':
    case 'lower': {
      const up = op === 'lower';
      const s = args.sym || args.down || args.up || (free.find(i => i.up === up) || {}).sym;
      if (!s) throw new OpError(`There is no free ${up ? 'upper' : 'lower'} index to ${op}.`);
      find(expr, s, up);
      const d = freshSym(expr, s);
      const g = op === 'raise' ? `g^{${T(s)}${T(d)}}` : `g_{${T(s)}${T(d)}}`;
      const mid = parse(M, `${g} (${plain(M, M.relabel(expr, { [s]: d }))})`);
      const after = flipHeight(M, expr, s);
      const word = op === 'raise' ? 'inverse metric' : 'metric';
      steps.push(stepOf(id(), op, `Multiply by the ${word} and give the old slot a new summed letter ${d}.`, expr, mid, { focus: [s, d], viz: { scene: 'vector-covector' } }));
      steps.push(stepOf(id(), 'contract', `Sum over ${d}. The ${word} turns the ${up ? 'upper' : 'lower'} slot ${s} into a${up ? ' lower' : 'n upper'} slot.`, mid, after, { focus: [d, s], sums: sums(d), viz: { scene: 'vector-covector' } }));
      break;
    }
    case 'transform': {
      const jac = args.jacobian || 'rotation';
      const Jm = jacobianMatrix(jac, dim, args.params || {});
      const map = {}, facs = [];
      const avoid = [];
      for (const ix of free) {
        const d = freshSym(expr, ix.sym, avoid); avoid.push(d); map[ix.sym] = d;
        facs.push(ix.up ? `J^{${T(ix.sym)}}{}_{${T(d)}}` : `\\tilde{J}^{${T(d)}}{}_{${T(ix.sym)}}`);
      }
      const inner = plain(M, M.relabel(expr, map));
      const mid = parse(M, `${facs.join(' ')} (${inner})`);
      const prim = M.cloneExpr(expr);
      for (const t of prim.terms) for (const f of t.factors) if (f.indices.length && !/metric|delta|epsilon/.test(f.kind || '')) { f.tex = f.tex + "'"; f.name = f.name + "'"; }
      const after = M.makeExpr(prim.terms);
      let numeric;
      const one = expr.terms.length === 1 && expr.terms[0].factors.length === 1 && !(expr.terms[0].factors[0].deriv || []).length ? expr.terms[0].factors[0] : null;
      if (one && M.transform && !expr.dummies.length) {
        try {
          const Tin = sampleComponents(M, one, dim);
          if (Tin) numeric = { inputs: { [one.name]: plainComp(Tin), J: plainComp(new M.Tensor([dim, dim], ['u', 'd'], Float64Array.from(Jm.flat()))) }, output: plainComp(M.transform(Tin, Jm)) };
        } catch (e) { numeric = undefined; }
      }
      const syms = free.map(i => i.sym);
      steps.push(stepOf(id(), 'transform', 'Each upper slot gets a factor of the Jacobian J, and each lower slot a factor of its inverse.', expr, mid, { focus: syms.concat(Object.values(map)), numeric, viz: { scene: 'rank2-transform', params: { jacobian: jac, matrix: Jm } } }));
      steps.push(stepOf(id(), 'contract', 'Sum over the new letters. The components change, but the tensor is the same object in new coordinates.', mid, after, { focus: syms, sums: Object.values(map).slice(0, 2).map(s => ({ sym: s, range: [0, dim] })), numeric, viz: { scene: 'rank2-transform', params: { jacobian: jac, matrix: Jm } } }));
      break;
    }
    case 'symmetrize':
    case 'antisymmetrize': {
      let [a, b] = args.pair || [];
      if (!a || !b) {
        const up = free.filter(i => i.up), dn = free.filter(i => !i.up);
        const g = dn.length >= 2 ? dn : up;
        if (g.length < 2) throw new OpError('Symmetrisation needs two free indices of the same height.');
        [a, b] = [g[0].sym, g[1].sym];
      }
      const A = find(expr, a), B = find(expr, b);
      if (A.up !== B.up) throw new OpError(`${a} and ${b} have different heights. Symmetrise indices of one height only.`);
      const swapped = M.relabel(M.relabel(expr, { [a]: '__tmp' }), { [b]: a });
      const swap2 = M.relabel(swapped, { __tmp: b });
      const sign = op === 'symmetrize' ? '+' : '-';
      const after = parse(M, `\\frac{1}{2} (${plain(M, expr)}) ${sign} \\frac{1}{2} (${plain(M, swap2)})`);
      // The bracket form T_{(ab)} when both letters are on one factor.
      let bracket = null;
      if (expr.terms.length === 1) {
        const e = M.cloneExpr(expr);
        for (const f of e.terms[0].factors) {
          const ia = f.indices.findIndex(i => i.sym === a), ib = f.indices.findIndex(i => i.sym === b);
          if (ia >= 0 && ib >= 0 && Math.abs(ia - ib) === 1) { f.sym = (f.sym || []).concat([{ type: op === 'symmetrize' ? 'sym' : 'antisym', slots: [Math.min(ia, ib), Math.max(ia, ib)] }]); bracket = M.makeExpr(e.terms); }
        }
      }
      const word = op === 'symmetrize' ? 'symmetric' : 'antisymmetric';
      if (bracket) steps.push(stepOf(id(), op, `Take the ${word} part in ${a} and ${b}: write the pair in ${op === 'symmetrize' ? 'round' : 'square'} brackets.`, expr, bracket, { focus: [a, b], viz: { scene: 'component-cube' } }));
      steps.push(stepOf(id(), 'expandSum', `The bracket is half the ${op === 'symmetrize' ? 'sum' : 'difference'} of the two orders of ${a} and ${b}.`, bracket || expr, after, { focus: [a, b], viz: { scene: 'component-cube' } }));
      break;
    }
    case 'covariant': {
      if (expr.terms.length !== 1 || expr.terms[0].factors.length !== 1) throw new OpError('In the playground, take the covariant derivative of one tensor (one factor).');
      const f = expr.terms[0].factors[0];
      if ((f.deriv || []).length) throw new OpError('The tensor already has a derivative. Start from a plain tensor.');
      const d = args.sym || freshSym(expr, (f.indices[0] || {}).sym);
      if (allSyms(expr).has(d)) throw new OpError(`${d} is already used. Pick a new letter for the derivative.`);
      const s = freshSym(expr, d, [d]);
      const base = plain(M, expr);
      const nab = parse(M, `\\nabla_{${T(d)}} ${base}`);
      let rhs = `\\partial_{${T(d)}} ${base}`;
      for (const ix of f.indices) {
        const swapped = plain(M, M.relabel(expr, { [ix.sym]: s }));
        rhs += ix.up ? ` + \\Gamma^{${T(ix.sym)}}_{${T(d)}${T(s)}} ${swapped}` : ` - \\Gamma^{${T(s)}}_{${T(d)}${T(ix.sym)}} ${swapped}`;
      }
      const after = parse(M, rhs);
      steps.push(stepOf(id(), 'covariant', `Apply nabla with a new lower index ${d}. The rank goes up by one lower slot.`, expr, nab, { focus: [d], viz: { scene: 'christoffel-basis' } }));
      steps.push(stepOf(id(), 'christoffel', `The partial derivative misses the change of the basis. Each upper index adds a +Gamma term, each lower index a -Gamma term, summed over ${s}.`, nab, after, { focus: [d, s].concat(f.indices.map(i => i.sym)), sums: sums(s), viz: { scene: 'christoffel-basis' } }));
      break;
    }
    case 'product': {
      if (!args.tex) throw new OpError('Type the second tensor, for example v^{\\lambda}.');
      const other = parse(M, args.tex);
      const after = parse(M, `(${plain(M, expr)}) (${plain(M, other)})`);
      const shared = freeIndices(other).filter(i => free.some(j => j.sym === i.sym)).map(i => i.sym);
      steps.push(stepOf(id(), 'product', shared.length ? `Multiply. The shared letters ${shared.join(', ')} are now summed.` : 'Multiply. Every slot of both tensors stays, so the ranks add.', expr, after, { focus: freeIndices(other).map(i => i.sym), sums: shared.map(s => ({ sym: s, range: [0, dim] })), viz: { scene: 'outer-product' } }));
      break;
    }
    case 'expandSum': {
      const dummies = expr.dummies || [];
      if (!dummies.length) throw new OpError('The expression has no summed index. A summed index appears once up and once down.');
      steps.push(stepOf(id(), 'expandSum', `Write out the sum over ${dummies.join(' and ')}, one term for each value.`, expr, expr, { focus: dummies.slice(), sums: dummies.map(s => ({ sym: s, range: [0, dim] })), ms: 3200 }));
      break;
    }
    default: throw new OpError('Unknown operation ' + op);
  }
  for (const st of steps) {
    const v = M.validate ? M.validate(st.after, { dim }) : { ok: true, errors: [] };
    if (!v.ok) throw new OpError(v.errors[0].msg);
  }
  return { steps, dim, metric: opts.metric, source: 'playground' };
}
