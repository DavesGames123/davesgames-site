// ============================================================================
//  tensor/trace.js  ·  OpTrace builders: operations as small teachable steps
// ----------------------------------------------------------------------------
//  Each builder returns an OpTrace (CONTRACT.md):
//      { steps: [Step], dim, metric?, coords?, result }
//      Step = { id, kind, label, before, after, focus, sums, numeric?, viz?, ms,
//               display? }
//  before and after are TensorExprs. numeric.inputs maps a name to a
//  Tensor (a Components object); numeric.output is the Tensor of the step.
//  display (optional) has TeX for the TeX view: { expanded, numeric } with
//  index colours and coordinate labels. result is the final Tensor.
//  A label is one plain sentence; its math is in $...$ (inline TeX).
//
//  Slot order of derivative data: the derivative slot is last, the same
//  as the order of factorIndices(f): d_k g_ij is stored as [i][j][k].
//
//  Builders:
//      traceEinstein(tex | expr, bindings, opts)  find pairs, write the sum
//                         out, add, name the result (any Einstein expression)
//      traceProduct(A, B, opts)          traceContract(T, i, j, opts)
//      traceRaise(T, slot, g, opts)      traceLower(T, slot, g, opts)
//      traceTranspose(T, perm, opts)     traceTrace(T, opts)
//      traceSymmetrize(T, slots, opts)   traceAntisymmetrize(T, slots, opts)
//      traceEinsum(spec, ...tensors[, opts])
//      traceTransform(T, J, opts)        traceLeviCivita(A, B, opts)
//      traceChristoffel(metric, x, params, opts)
//      traceCovariant(metric, x, field, opts)
//      traceRiemann(metric, x, params, opts)   traceRicci   traceEinsteinTensor
//      traceParallelTransport(metric, curve, v0, opts)
//      traceGeodesic(metric, x0, v0, opts)
//  opts common: names, syms, resultName, coords, values (free index
//  values for the written-out sum), params.
//
//  ANCHORS   (grep -n "<anchor>" trace.js)  "export function trace<Name>"
// ============================================================================

import { Tensor, product, contract, raise, lower, transpose, symmetrize, antisymmetrize, matInverse, permutations, indexTuples } from './tensor.js';
import { parseIndexTex, makeExpr, fac, idx, term, validate, toTex, symTex, fmtNum } from './expr.js';
import { evaluateExpr, expandToComponents, factorTensor, fmtVal } from './evaluate.js';
import { getMetric, metricJet, paramsOf } from './metrics.js';
import { christoffelJet, curvatureAt, christoffel, partialDerivative, nablaFromPartials, parallelTransport, geodesic, angleBetween } from './geometry.js';

const LATIN = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].filter(s => s !== 'g');
const GREEKS = ['mu', 'nu', 'rho', 'sigma', 'lambda', 'kappa', 'alpha', 'beta', 'tau', 'eta'].filter(s => s !== 'eta');
const symsFor = (n, opts = {}) => (opts.syms ? opts.syms.slice() : (opts.greek ? GREEKS : LATIN).slice(0, n));
const ex = s => (typeof s === 'string' ? parseIndexTex(s) : s);
const MS = { short: 1200, mid: 1800, long: 2600 };

function finish(steps, extra) {
  steps.forEach((s, k) => { s.id = `${s.kind}-${k}`; s.focus ||= []; s.sums ||= []; s.ms ||= MS.mid; });
  return { steps, ...extra };
}
const tensorExpr = (name, variance, syms, opts = {}) => makeExpr([term(1, [fac(name, variance.map((v, k) => idx(syms[k], v === 'u')), opts)])]);
const eqExpr = (lhsTerms, rhsTerms) => makeExpr({ lhs: lhsTerms, rhs: rhsTerms });
const asTensor = (x, v) => Tensor.from(x, v);
const listTex = syms => syms.map(x => `$${symTex(x)}$`).join(', ');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// Fixed component name for "C^{0}_{1} = 35".
function componentExpr(name, free, vals, value) {
  const f = fac(name, free.map((ix, k) => idx(String(vals[k]), ix.up)));
  return eqExpr([term(1, [f])], [term(value, [])]);
}

// ---- generic Einstein trace -----------------------------------------------
export function traceEinstein(src, bindings = {}, opts = {}) {
  const expr = ex(src);
  const v = validate(expr, { dim: opts.dim, euclidean: opts.euclidean });
  if (!v.ok) throw new Error(v.errors[0].msg);
  const rhsExpr = expr.rel ? expr.rhs : expr;
  const result = evaluateExpr(rhsExpr, bindings, opts);
  const dim = opts.dim ?? (result.rank ? result.shape[0] : Tensor.from(Object.values(bindings).find(b => b && typeof b !== 'number')).shape[0]);
  const inputs = {};
  for (const t of rhsExpr.terms) for (const f of t.factors) {
    const key = f.deriv ? `${f.derivKind}:${f.name}` : f.name;
    if (!(key in inputs)) { try { inputs[key] = factorTensor(f, bindings, { ...opts, dim }); } catch (e) { /* a scalar with no binding */ } }
  }
  const free = rhsExpr.free, dummies = rhsExpr.dummies;
  const resName = opts.resultName ?? (expr.rel && expr.lhs.terms[0] && expr.lhs.terms[0].factors[0] ? expr.lhs.terms[0].factors[0].name : 'C');
  const named = expr.rel ? expr : eqExpr([term(1, [fac(resName, free.map(i => ({ ...i })))])], rhsExpr.terms);
  const vals = free.map(i => (opts.values && opts.values[i.sym] != null ? opts.values[i.sym] : 0));
  const values = Object.fromEntries(free.map((i, k) => [i.sym, vals[k]]));
  const sums = dummies.map(sym => ({ sym, range: [0, dim] }));
  const steps = [];
  const viz = opts.viz;
  if (dummies.length) {
    steps.push({
      kind: opts.firstKind ?? 'contract', label: `The index ${listTex(dummies)} appears once up and once down in a term, so Einstein notation sums over it.`,
      before: rhsExpr, after: rhsExpr, focus: dummies.slice(), sums, numeric: { inputs, output: result }, viz, ms: MS.mid,
    });
    const plain = expandToComponents(rhsExpr, { bindings, values, dim, colors: false, coeffs: opts.coeffs, maxTerms: opts.maxTerms ?? 81 });
    const shown = expandToComponents(rhsExpr, { bindings, values, dim, coords: opts.coords, coeffs: opts.coeffs, maxTerms: opts.maxTerms ?? 81 });
    const shownNZ = expandToComponents(rhsExpr, { bindings, values, dim, coords: opts.coords, coeffs: opts.coeffs, maxTerms: opts.maxTerms ?? 81, skipZero: true });
    const line = plain.lines[0];
    let after;
    try { after = parseIndexTex(line.tex.replace(/ \+ \\cdots$/, '')); } catch (e) { after = rhsExpr; }
    const products = Tensor.fromNested(line.terms.map(p => p.value), ['u']);
    steps.push({
      kind: 'expandSum', label: `Write the sum out: one product for each value of ${listTex(dummies)} from 0 to ${dim - 1}, ${plural(line.terms.length, 'product')} in all.`,
      before: rhsExpr, after, focus: dummies.slice(), sums, numeric: { inputs, output: products }, viz, ms: MS.long,
      display: { expanded: shown.lines[0].tex, numeric: shown.lines[0].texNumeric, expandedNonzero: shownNZ.lines[0].tex, numericNonzero: shownNZ.lines[0].texNumeric, values },
    });
    const value = line.value;
    steps.push({
      kind: 'evaluate', label: free.length ? `Add the products. This gives one component, with ${free.map((i, k) => `$${symTex(i.sym)} = ${vals[k]}$`).join(', ')}: ${fmtVal(value)}.` : `Add the products. The result is one number: ${fmtVal(value)}.`,
      before: after, after: componentExpr(resName, free, vals, value), focus: free.map(i => i.sym), sums: [], numeric: { inputs, output: result }, viz, ms: MS.mid,
      display: { numeric: `${shown.lines[0].texNumeric} = ${fmtVal(value)}` },
    });
  } else {
    steps.push({
      kind: opts.firstKind ?? 'product', label: `No index repeats, so nothing is summed. Each component is a product of components: ${plural(result.size, 'component')}.`,
      before: rhsExpr, after: rhsExpr, focus: free.map(i => i.sym), sums: [], numeric: { inputs, output: result }, viz, ms: MS.mid,
    });
  }
  const rank = { up: free.filter(i => i.up).length, down: free.filter(i => !i.up).length };
  steps.push({
    kind: 'relabel', label: free.length
      ? `The free indices ${listTex(free.map(i => i.sym))} stay. The result ${resName} is a (${rank.up},${rank.down}) tensor with ${plural(result.size, 'component')}.`
      : `No free index stays: the result ${resName} is a scalar, the same number in every coordinate system.`,
    before: rhsExpr, after: named, focus: free.map(i => i.sym), sums: [], numeric: { inputs, output: result }, viz, ms: MS.short,
  });
  return finish(steps, { dim, result, expr: named });
}

// ---- algebra traces ------------------------------------------------------------
export function traceProduct(A, B, opts = {}) {
  A = asTensor(A); B = asTensor(B);
  const [nA, nB] = opts.names ?? ['A', 'B'];
  const syms = symsFor(A.rank + B.rank, opts);
  const fA = fac(nA, A.variance.map((v, k) => idx(syms[k], v === 'u'))), fB = fac(nB, B.variance.map((v, k) => idx(syms[A.rank + k], v === 'u')));
  const tr = traceEinstein(makeExpr([term(1, [fA, fB])]), { [nA]: A, [nB]: B }, { ...opts, resultName: opts.resultName ?? 'C', firstKind: 'product', viz: opts.viz ?? { scene: 'outer-product', params: {} } });
  tr.steps[0].label = `The tensor product puts the slots side by side: every component of ${nA} times every component of ${nB}, ${plural(A.size * B.size, 'component')}.`;
  return tr;
}

export function traceContract(Tn, i, j, opts = {}) {
  Tn = asTensor(Tn);
  contract(Tn, i, j, opts); // the friendly error comes from here
  const name = (opts.names && opts.names[0]) ?? 'T';
  const syms = symsFor(Tn.rank, opts);
  syms[j] = syms[i];
  const f = fac(name, Tn.variance.map((v, k) => idx(syms[k], v === 'u')));
  return traceEinstein(makeExpr([term(1, [f])]), { [name]: Tn }, { ...opts, euclidean: opts.force, viz: opts.viz ?? { scene: 'contraction-block', params: { axes: [i, j] } } });
}

function raiseLower(Tn, slot, g, opts, up) {
  Tn = asTensor(Tn);
  if (Tn.variance[slot] === (up ? 'u' : 'd')) throw new Error(`slot ${slot + 1} is already ${up ? 'upper' : 'lower'}`);
  const name = (opts.names && opts.names[0]) ?? 'T';
  const syms = symsFor(Tn.rank + 1, opts);
  const newSym = syms[Tn.rank], oldSym = syms[slot];
  const gf = fac('g', [idx(newSym, up), idx(oldSym, up)]);
  const tf = fac(name, Tn.variance.map((v, k) => idx(syms[k], v === 'u')));
  const outIdx = Tn.variance.map((v, k) => (k === slot ? idx(newSym, up) : idx(syms[k], v === 'u')));
  const lhs = [term(1, [fac(opts.resultName ?? name, outIdx)])];
  const gT = asTensor(g, ['d', 'd']);
  const tr = traceEinstein(eqExpr(lhs, [term(1, [gf, tf])]), { g: new Tensor(gT.shape, ['d', 'd'], gT.data), [name]: Tn }, { ...opts, firstKind: up ? 'raise' : 'lower', viz: opts.viz ?? { scene: 'vector-covector', params: {} } });
  tr.steps[0].label = up
    ? `To raise $${symTex(oldSym)}$, contract it with the inverse metric $g^{${symTex(newSym)}${symTex(oldSym)}}$. The index $${symTex(oldSym)}$ is summed and $${symTex(newSym)}$ takes its place, upper.`
    : `To lower $${symTex(oldSym)}$, contract it with the metric $g_{${symTex(newSym)}${symTex(oldSym)}}$. The index $${symTex(oldSym)}$ is summed and $${symTex(newSym)}$ takes its place, lower.`;
  return tr;
}
export function traceRaise(Tn, slot, g, opts = {}) { return raiseLower(Tn, slot, g, opts, true); }
export function traceLower(Tn, slot, g, opts = {}) { return raiseLower(Tn, slot, g, opts, false); }

export function traceTranspose(Tn, perm, opts = {}) {
  Tn = asTensor(Tn);
  if (typeof perm === 'number') { const p = Tn.shape.map((_, k) => k); [p[perm], p[perm + 1]] = [p[perm + 1], p[perm]]; perm = p; }
  const name = (opts.names && opts.names[0]) ?? 'T', res = opts.resultName ?? 'S';
  const syms = symsFor(Tn.rank, opts);
  const out = transpose(Tn, perm);
  const lhs = fac(res, perm.map((p, k) => idx(syms[p], out.variance[k] === 'u')));
  const rhs = fac(name, Tn.variance.map((v, k) => idx(syms[k], v === 'u')));
  const e = eqExpr([term(1, [lhs])], [term(1, [rhs])]);
  return finish([
    { kind: 'relabel', label: `A transpose changes the order of the slots, not the numbers: ${res} reads the components of ${name} with the indices in a new order.`, before: tensorExpr(name, Tn.variance, syms), after: e, focus: syms.slice(), numeric: { inputs: { [name]: Tn }, output: out }, viz: opts.viz ?? { scene: 'component-cube', params: {} }, ms: MS.mid },
  ], { dim: Tn.shape[0], result: out, expr: e });
}

function traceSymCore(Tn, slots, opts, anti) {
  Tn = asTensor(Tn);
  slots ??= Tn.shape.map((_, k) => k);
  const name = (opts.names && opts.names[0]) ?? 'T';
  const syms = symsFor(Tn.rank, opts);
  const perms = permutations(slots);
  const k = perms.length;
  const out = anti ? antisymmetrize(Tn, slots) : symmetrize(Tn, slots);
  const base = fac(name, Tn.variance.map((v, q) => idx(syms[q], v === 'u')));
  const marked = fac(name, base.indices, { sym: [{ type: anti ? 'antisym' : 'sym', slots: slots.slice() }] });
  const inputs = { [name]: Tn };
  const termsP = perms.map(({ p, sign }, q) => {
    const order = Tn.shape.map((_, s) => s);
    slots.forEach((s, r) => { order[s] = p[r]; });
    const f = fac(name, order.map(o => ({ ...base.indices[o] })));
    inputs[`${name}#${q}`] = transpose(Tn, order);
    return term((anti ? sign : 1) / k, [f]);
  });
  const e = eqExpr([term(1, [marked])], termsP);
  const word = anti ? 'antisymmetrize' : 'symmetrize';
  const focus = slots.map(s => syms[s]);
  const steps = [
    { kind: anti ? 'antisymmetrize' : 'symmetrize', label: anti ? `The square bracket means: add every order of ${listTex(focus)} with the sign of the permutation (+ for even, - for odd), then divide by ${k}.` : `The round bracket means: average ${name} over every order of the indices ${listTex(focus)}.`, before: makeExpr([term(1, [base])]), after: makeExpr([term(1, [marked])]), focus, numeric: { inputs: { [name]: Tn }, output: out }, ms: MS.mid },
    { kind: 'expandSum', label: `Write the ${k} orders out. Each term is ${name} with its slots in a new order${anti ? ', with a sign' : ''}.`, before: makeExpr([term(1, [marked])]), after: e, focus, sums: [], numeric: { inputs, output: out }, ms: MS.long },
    { kind: 'evaluate', label: anti ? `The result changes sign when two of ${listTex(focus)} swap, so a component with two equal indices is 0.` : `The result does not change when ${listTex(focus)} swap. To ${word} twice gives the same tensor.`, before: e, after: e, focus, numeric: { inputs, output: out }, ms: MS.mid },
  ];
  steps.forEach(s => { s.viz = opts.viz ?? { scene: 'rank2-transform', params: {} }; });
  return finish(steps, { dim: Tn.shape[0], result: out, expr: e });
}
export function traceSymmetrize(Tn, slots, opts = {}) { return traceSymCore(Tn, slots, opts, false); }
export function traceAntisymmetrize(Tn, slots, opts = {}) { return traceSymCore(Tn, slots, opts, true); }

export function traceTrace(Tn, opts = {}) {
  Tn = asTensor(Tn);
  if (Tn.variance[0] !== Tn.variance[1]) {
    const tr = traceContract(Tn, 0, 1, opts);
    tr.steps[0].kind = 'trace';
    return tr;
  }
  if (!opts.metric) throw new Error('both slots have one height; give opts.metric (g, lower) to take the trace');
  const name = (opts.names && opts.names[0]) ?? 'T';
  const [a, b] = symsFor(2, opts);
  const up = Tn.variance[0] === 'd';
  const gf = fac('g', [idx(a, up), idx(b, up)]), tf = fac(name, [idx(a, !up), idx(b, !up)]);
  const gT = asTensor(opts.metric, ['d', 'd']);
  const tr = traceEinstein(makeExpr([term(1, [gf, tf])]), { g: new Tensor(gT.shape, ['d', 'd'], gT.data), [name]: Tn }, { ...opts, firstKind: 'trace', resultName: opts.resultName ?? `\\operatorname{tr}${name}` });
  return tr;
}

// einsum spec as a trace. Letters of the spec become the indices.
export function traceEinsum(spec, ...args) {
  let opts = {};
  if (args.length && args[args.length - 1] && !args[args.length - 1].shape && !Array.isArray(args[args.length - 1])) opts = args.pop();
  const ts = args.map(a => asTensor(a));
  const [lhs, rhs] = spec.replace(/\s+/g, '').split('->');
  const names = opts.names ?? ts.map((_, k) => String.fromCharCode(65 + k));
  const bindings = {};
  const factors = lhs.split(',').map((s, q) => { bindings[names[q]] = ts[q]; return fac(names[q], [...s].map((c, k) => idx(c, ts[q].variance[k] === 'u'))); });
  let expr = makeExpr([term(1, factors)]);
  const euclidean = !validate(expr).ok;
  if (rhs != null) {
    const vmap = {};
    lhs.split(',').forEach((s, q) => [...s].forEach((c, k) => { vmap[c] ??= ts[q].variance[k]; }));
    const out = fac(opts.resultName ?? 'C', [...rhs].map(c => idx(c, vmap[c] === 'u')));
    expr = eqExpr([term(1, [out])], [term(1, factors)]);
  }
  return traceEinstein(expr, bindings, { ...opts, euclidean, viz: opts.viz ?? { scene: 'contraction-block', params: {} } });
}

// Cross product as a Levi-Civita contraction: C_i = eps_{ijk} A^j B^k.
export function traceLeviCivita(A, B, opts = {}) {
  A = asTensor(A, ['u']); B = asTensor(B, ['u']);
  const tr = traceEinstein('C_{i} = \\epsilon_{ijk} A^{j} B^{k}', { A, B }, { dim: 3, ...opts, viz: opts.viz ?? { scene: 'levi-civita-cube', params: { a: [...A.data], b: [...B.data] } } });
  tr.steps[0].label = 'The Levi-Civita symbol is +1 for an even order of (1,2,3), -1 for an odd order, and 0 when two indices are equal. The indices j and k are summed.';
  return tr;
}

// Transform every slot with J (upper) or J^-1 transposed (lower).
export function traceTransform(Tn, J, opts = {}) {
  Tn = asTensor(Tn);
  const Jt = asTensor(J, ['u', 'd']);
  const Jinv = Tensor.fromNested(matInverse(Jt.toNested()), ['u', 'd']);
  const name = (opts.names && opts.names[0]) ?? 'T';
  const n = Tn.shape[0], r = Tn.rank;
  const syms = symsFor(2 * r, opts), oldS = syms.slice(0, r), newS = oldS.map(s => s + "'"), sumS = syms.slice(r, 2 * r);
  const steps = [];
  const viz = opts.viz ?? { scene: r === 2 ? 'rank2-transform' : 'vector-covector', params: { matrix: Jt.toNested() } };
  steps.push({
    kind: 'transform', label: `The Jacobian $J^{a'}{}_{b} = \\partial x'^{a}/\\partial x^{b}$ tells how the new coordinates change with the old ones. Its inverse undoes it.`,
    before: tensorExpr(name, Tn.variance, oldS), after: makeExpr([term(1, [fac('J', [idx("a'", true), idx('b', false)])])]), focus: [],
    numeric: { inputs: { [name]: Tn, J: Jt, Jinv }, output: Jt }, viz, ms: MS.mid,
  });
  let cur = Tn;
  const curIdx = Tn.variance.map((v, k) => idx(oldS[k], v === 'u'));
  for (let s = 0; s < r; s++) {
    const up = Tn.variance[s] === 'u';
    const M = up ? Jt : transpose(Jinv, [1, 0]);
    // apply to slot s
    const next = new Tensor(cur.shape, cur.variance);
    const id2 = new Array(r);
    for (const id of indexTuples(cur.shape)) {
      let v = 0;
      for (let q = 0; q < r; q++) id2[q] = id[q];
      for (let b = 0; b < n; b++) { id2[s] = b; v += M.data[id[s] * n + b] * cur.data[cur.offset(id2)]; }
      next.data[next.offset(id)] = v;
    }
    const lhsIdx = curIdx.map((ix, k) => (k === s ? idx(newS[s], up) : { ...ix }));
    const rhsT = curIdx.map((ix, k) => (k === s ? idx(sumS[s], up) : { ...ix }));
    const jf = up ? fac('J', [idx(newS[s], true), idx(sumS[s], false)]) : fac('Jinv', [idx(sumS[s], true), idx(newS[s], false)], { tex: '(J^{-1})' });
    const e = eqExpr([term(1, [fac(name + "'", lhsIdx, { tex: name + "'" })])], [term(1, [jf, fac(s === 0 ? name : name + "'", rhsT, { tex: s === 0 ? name : name + "'" })])]);
    steps.push({
      kind: 'transform', label: up
        ? `Slot ${s + 1} is upper (contravariant): its components change with $J$, the same way as the coordinate differentials $dx^{a}$.`
        : `Slot ${s + 1} is lower (covariant): its components change with $J^{-1}$, the opposite way, the same as a gradient.`,
      before: steps[steps.length - 1].after, after: e, focus: [oldS[s], newS[s]], sums: [{ sym: sumS[s], range: [0, n] }],
      numeric: { inputs: { [name]: cur, M }, output: next }, viz, ms: MS.long,
    });
    curIdx[s] = idx(newS[s], up);
    cur = next;
  }
  const invariant = r === 2 && Tn.variance[0] !== Tn.variance[1] ? { before: Tn.data[0] + Tn.data[n + 1] + (n > 2 ? Tn.data[2 * n + 2] : 0), after: cur.data[0] + cur.data[n + 1] + (n > 2 ? cur.data[2 * n + 2] : 0) } : null;
  if (invariant && n > 3) { invariant.before = 0; invariant.after = 0; for (let k = 0; k < n; k++) { invariant.before += Tn.data[k * n + k]; invariant.after += cur.data[k * n + k]; } }
  steps.push({
    kind: 'evaluate', label: invariant
      ? `All slots are done. The components changed, but the trace did not: ${fmtVal(invariant.before)} before and ${fmtVal(invariant.after)} after. The tensor is the same object in new coordinates.`
      : 'All slots are done. The components changed, but the tensor is the same object in new coordinates.',
    before: steps[steps.length - 1].after, after: tensorExpr(name + "'", Tn.variance, newS, { tex: name + "'" }), focus: newS.slice(),
    numeric: { inputs: { [name]: Tn, J: Jt, Jinv }, output: cur }, viz, ms: MS.mid, invariant,
  });
  return finish(steps, { dim: n, result: cur });
}

// ---- geometry traces -------------------------------------------------------------
const nest3 = (A, n, variance, order = 'aij') => {
  const t = new Tensor([n, n, n], variance);
  for (let a = 0; a < n; a++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) t.data[(a * n + i) * n + j] = A[a][i][j];
  return t;
};
function coordInfo(m) { return { coords: m.coordTex, metric: m.id }; }
function nonzero(Tn, labels, name, tol = 1e-12) {
  const out = [];
  for (const id of indexTuples(Tn.shape)) {
    const v = Tn.get(id);
    if (Math.abs(v) <= tol) continue;
    const groups = [];
    id.forEach((k, q) => {
      const up = Tn.variance[q] === 'u';
      if (!groups.length || groups[groups.length - 1].up !== up) groups.push({ up, s: '' });
      groups[groups.length - 1].s += labels[k] + ' ';
    });
    const ix = groups.map((g, q) => (q > 1 ? '{}' : '') + (g.up ? '^' : '_') + '{' + g.s.trim() + '}').join('');
    out.push({ values: id, value: v, tex: `${name}${ix} = ${fmtVal(v)}` });
  }
  return out;
}

export function traceChristoffel(metric, x, params, opts = {}) {
  const m = getMetric(metric), p = paramsOf(m, params), n = m.dim;
  const greek = opts.greek ?? n === 4;
  const [l, mu, nu, s] = greek ? ['lambda', 'mu', 'nu', 'sigma'] : ['c', 'a', 'b', 'd'];
  const L = symTex(l), M = symTex(mu), N = symTex(nu), S = symTex(s);
  const { g, dg } = metricJet(m, x, p, 1);
  const gInv = matInverse(g);
  const gT = Tensor.fromNested(g, ['d', 'd']), giT = Tensor.fromNested(gInv, ['u', 'u']);
  const dgT = new Tensor([n, n, n], ['d', 'd', 'd']);
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) dgT.data[(i * n + j) * n + k] = dg[k][i][j];
  const G1 = new Tensor([n, n, n], ['d', 'd', 'd']);
  for (let b = 0; b < n; b++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) G1.data[(b * n + i) * n + j] = 0.5 * (dg[i][b][j] + dg[j][b][i] - dg[b][i][j]);
  const Gam = christoffel(m, x, p);
  const labels = m.coordTex;
  const viz = opts.viz ?? { scene: 'christoffel-basis', params: { coords: m.id, point: x.slice() } };
  const at = `at (${x.map((v, k) => `${labels[k]} = ${fmtVal(v)}`).join(', ')})`;
  const nz = nonzero(Gam, labels, '\\Gamma');
  const steps = [
    { kind: 'evaluate', label: `Start with the metric $g_{${M}${N}}$ of the ${m.label.toLowerCase()} ${at}.`, before: ex(`g_{${M}${N}}`), after: ex(`g_{${M}${N}}`), focus: [mu, nu], numeric: { inputs: { g: gT }, output: gT }, viz },
    { kind: 'partial', label: `Take the partial derivative of every metric component along every coordinate: ${n * n * n} numbers $\\partial_{${L}} g_{${M}${N}}$.`, before: ex(`g_{${M}${N}}`), after: ex(`\\partial_{${L}} g_{${M}${N}}`), focus: [l], sums: [], numeric: { inputs: { g: gT }, output: dgT }, viz },
    { kind: 'raise', label: `Invert the metric matrix to get $g^{${M}${N}}$. Then $g^{${M}${S}} g_{${S}${N}} = \\delta^{${M}}_{${N}}$.`, before: ex(`g_{${M}${N}}`), after: ex(`g^{${M}${N}}`), focus: [mu, nu], numeric: { inputs: { g: gT }, output: giT }, viz },
    { kind: 'christoffel', label: 'Combine three derivatives with signs + + -. This is the Christoffel symbol of the first kind: all three indices lower.', before: ex(`\\partial_{${L}} g_{${M}${N}}`), after: ex(`\\Gamma_{${L}${M}${N}} = \\frac{1}{2}(\\partial_{${M}} g_{${L}${N}} + \\partial_{${N}} g_{${L}${M}} - \\partial_{${L}} g_{${M}${N}})`), focus: [l, mu, nu], numeric: { inputs: { dg: dgT }, output: G1 }, viz, ms: MS.long },
    { kind: 'raise', label: `Raise the first index with the inverse metric. The sum over $${S}$ gives $\\Gamma^{${L}}_{${M}${N}}$, symmetric in $${M}$ and $${N}$.`, before: ex(`\\Gamma_{${S}${M}${N}}`), after: ex(`\\Gamma^{${L}}_{${M}${N}} = g^{${L}${S}} \\Gamma_{${S}${M}${N}}`), focus: [l, s], sums: [{ sym: s, range: [0, n] }], numeric: { inputs: { gInv: giT, Gamma1: G1 }, output: Gam }, viz, ms: MS.long },
    { kind: 'evaluate', label: nz.length ? `${plural(nz.length, 'component')} of the ${n * n * n} are not zero: ${nz.slice(0, 6).map(z => `$${z.tex}$`).join(', ')}${nz.length > 6 ? ', and more' : ''}.` : 'Every component is zero here: these coordinates are straight and evenly spaced.', before: ex(`\\Gamma^{${L}}_{${M}${N}}`), after: ex(`\\Gamma^{${L}}_{${M}${N}}`), focus: [l, mu, nu], numeric: { inputs: { g: gT }, output: Gam }, viz, display: { nonzero: nz } },
  ];
  return finish(steps, { dim: n, ...coordInfo(m), result: Gam });
}

// field(x) -> vector components (array or Tensor). opts.variance 'd' for a covector.
export function traceCovariant(metric, x, field, opts = {}) {
  const m = getMetric(metric), p = paramsOf(m, opts.params), n = m.dim;
  const vari = opts.variance ?? 'u';
  const fieldT = y => { const v = field(y); return v instanceof Tensor ? v : new Tensor([n], [vari], v.data ?? v); };
  const { T: V, dT } = partialDerivative(fieldT, x, opts.h ?? 1e-3);
  const Gam = christoffel(m, x, p);
  const conn = new Tensor([n, n], [vari, 'd']); // [nu][mu]
  for (let a = 0; a < n; a++) for (let k = 0; k < n; k++) {
    let s = 0;
    for (let c = 0; c < n; c++) s += vari === 'u' ? Gam.get(a, k, c) * V.data[c] : -Gam.get(c, k, a) * V.data[c];
    conn.data[a * n + k] = s;
  }
  const nab = nablaFromPartials(Gam, V, dT);
  const greek = opts.greek ?? n === 4;
  const [mu, nu, la] = greek ? ['mu', 'nu', 'lambda'] : ['a', 'b', 'c'];
  const M = symTex(mu), N = symTex(nu), La = symTex(la);
  const up = vari === 'u';
  const Vn = up ? `V^{${N}}` : `V_{${N}}`;
  const connTex = up ? `\\Gamma^{${N}}_{${M}${La}} V^{${La}}` : `\\Gamma^{${La}}_{${M}${N}} V_{${La}}`;
  const full = `\\nabla_{${M}} ${Vn} = \\partial_{${M}} ${Vn} ${up ? '+' : '-'} ${connTex}`;
  const viz = opts.viz ?? { scene: 'christoffel-basis', params: { coords: m.id, point: x.slice() } };
  const steps = [
    { kind: 'partial', label: `Differentiate the components $${Vn}$ along each coordinate. In curved coordinates this is not the whole change: the basis vectors also change from point to point.`, before: ex(Vn), after: ex(`\\partial_{${M}} ${Vn}`), focus: [mu], numeric: { inputs: { V }, output: dT }, viz },
    { kind: 'christoffel', label: 'The Christoffel symbols measure how the basis vectors change.', before: ex(`\\partial_{${M}} ${Vn}`), after: ex(`\\Gamma^{${N}}_{${M}${La}}`), focus: [mu, nu, la], numeric: { inputs: {}, output: Gam }, viz },
    { kind: 'covariant', label: up ? `The connection term adds the part that comes from the basis: a sum over $${La}$.` : `For a covector the connection term has a minus sign: a sum over $${La}$.`, before: ex(`\\Gamma^{${N}}_{${M}${La}}`), after: ex(connTex), focus: [la], sums: [{ sym: la, range: [0, n] }], numeric: { inputs: { V, Gamma: Gam }, output: conn }, viz, ms: MS.long },
    { kind: 'evaluate', label: 'Add the two parts. The covariant derivative is a tensor: it transforms correctly, and the partial derivative alone does not.', before: ex(connTex), after: ex(full), focus: [mu, nu], numeric: { inputs: { V, dV: dT, Gamma: Gam }, output: nab }, viz, ms: MS.long },
  ];
  return finish(steps, { dim: n, ...coordInfo(m), result: nab });
}

export function traceRiemann(metric, x, params, opts = {}) {
  const m = getMetric(metric), p = paramsOf(m, params), n = m.dim;
  const c = curvatureAt(m, x, p);
  const [r, s, mu, nu, la] = ['rho', 'sigma', 'mu', 'nu', 'lambda'];
  const [R_, S_, M_, N_, L_] = [r, s, mu, nu, la].map(symTex);
  // dGamma as a Tensor [rho][nu][sigma][mu] (derivative slot last).
  const dG = new Tensor([n, n, n, n], ['u', 'd', 'd', 'd']);
  for (let k = 0; k < n; k++) for (let a = 0; a < n; a++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) dG.data[((a * n + i) * n + j) * n + k] = c.dGamma[k][a][i][j];
  const G = c.Gamma;
  const dPart = new Tensor([n, n, n, n], ['u', 'd', 'd', 'd']), qPart = new Tensor([n, n, n, n], ['u', 'd', 'd', 'd']);
  for (const [a, b, cc, d] of indexTuples([n, n, n, n])) {
    dPart.set(c.dGamma[cc][a][d][b] - c.dGamma[d][a][cc][b], a, b, cc, d);
    let q = 0;
    for (let l = 0; l < n; l++) q += G.get(a, cc, l) * G.get(l, d, b) - G.get(a, d, l) * G.get(l, cc, b);
    qPart.set(q, a, b, cc, d);
  }
  const viz = opts.viz ?? { scene: 'curvature-loop', params: { surface: m.id } };
  const Rtex = `R^{${R_}}{}_{${S_}${M_}${N_}}`;
  const dTex = `\\partial_{${M_}} \\Gamma^{${R_}}_{${N_}${S_}} - \\partial_{${N_}} \\Gamma^{${R_}}_{${M_}${S_}}`;
  const qTex = `\\Gamma^{${R_}}_{${M_}${L_}} \\Gamma^{${L_}}_{${N_}${S_}} - \\Gamma^{${R_}}_{${N_}${L_}} \\Gamma^{${L_}}_{${M_}${S_}}`;
  const ch = traceChristoffel(m, x, p, { ...opts, greek: true }).steps;
  const steps = [
    { ...ch[ch.length - 1], kind: 'christoffel', label: 'Start from the Christoffel symbols of the metric at this point.' },
    { kind: 'partial', label: `Take the derivative of every Christoffel symbol: how the connection changes from point to point.`, before: ex(`\\Gamma^{${R_}}_{${N_}${S_}}`), after: ex(`\\partial_{${M_}} \\Gamma^{${R_}}_{${N_}${S_}}`), focus: [mu], numeric: { inputs: { Gamma: G }, output: dG }, viz },
    { kind: 'antisymmetrize', label: `The derivative part is antisymmetric in $${M_}$ and $${N_}$: go around a small loop one way, then the other way.`, before: ex(`\\partial_{${M_}} \\Gamma^{${R_}}_{${N_}${S_}}`), after: ex(dTex), focus: [mu, nu], numeric: { inputs: { dGamma: dG }, output: dPart }, viz, ms: MS.long },
    { kind: 'product', label: `The quadratic part multiplies two Christoffel symbols and sums over $${L_}$.`, before: ex(`\\Gamma^{${R_}}_{${M_}${L_}}`), after: ex(qTex), focus: [la], sums: [{ sym: la, range: [0, n] }], numeric: { inputs: { Gamma: G }, output: qPart }, viz, ms: MS.long },
    { kind: 'evaluate', label: `Add the two parts. The Riemann tensor $${Rtex}$ has ${n ** 4} components; ${c.Riemann.maxAbs() < 1e-12 ? 'all are zero, so the space is flat' : 'some are not zero, so the space is curved'}.`, before: ex(`${dTex} + ${qTex}`), after: ex(`${Rtex} = ${dTex} + ${qTex}`), focus: [r, s, mu, nu], numeric: { inputs: { dPart, qPart }, output: c.Riemann }, viz, ms: MS.long, display: { nonzero: nonzero(c.Riemann, m.coordTex, 'R').slice(0, 24) } },
  ];
  if (opts.ricci !== false) {
    steps.push({ kind: 'contract', label: `Contract the upper index with the second lower index: the Ricci tensor $R_{${S_}${N_}}$.`, before: ex(Rtex), after: ex(`R_{${S_}${N_}} = R^{${R_}}{}_{${S_}${R_}${N_}}`), focus: [r], sums: [{ sym: r, range: [0, n] }], numeric: { inputs: { Riemann: c.Riemann }, output: c.Ricci }, viz: opts.viz ?? { scene: 'contraction-block', params: {} } });
    steps.push({ kind: 'contract', label: `Contract the Ricci tensor with the inverse metric: the scalar curvature $R = ${fmtVal(c.R)}$.`, before: ex(`R_{${S_}${N_}}`), after: ex(`R = g^{${S_}${N_}} R_{${S_}${N_}}`), focus: [s, nu], sums: [{ sym: s, range: [0, n] }, { sym: nu, range: [0, n] }], numeric: { inputs: { Ricci: c.Ricci, gInv: c.gInv }, output: Tensor.scalar(c.R) }, viz });
  }
  if (opts.einstein) {
    steps.push({ kind: 'evaluate', label: `Take away half of $R g_{${M_}${N_}}$: the Einstein tensor, the left side of the field equations.`, before: ex(`R_{${M_}${N_}}`), after: ex(`G_{${M_}${N_}} = R_{${M_}${N_}} - \\frac{1}{2} R g_{${M_}${N_}}`), focus: [mu, nu], numeric: { inputs: { Ricci: c.Ricci, g: c.g }, output: c.Einstein }, viz });
  }
  return finish(steps, { dim: n, ...coordInfo(m), result: opts.einstein ? c.Einstein : c.Riemann, curvature: { R: c.R, Ricci: c.Ricci, Riemann: c.Riemann, Einstein: c.Einstein } });
}
export function traceRicci(metric, x, params, opts = {}) { const t = traceRiemann(metric, x, params, { ...opts, ricci: true }); t.result = t.curvature.Ricci; return t; }
export function traceEinsteinTensor(metric, x, params, opts = {}) { return traceRiemann(metric, x, params, { ...opts, ricci: true, einstein: true }); }

const packPath = (rows, max = 160) => {
  const stride = Math.max(1, Math.ceil(rows.length / max));
  const pick = rows.filter((_, k) => k % stride === 0 || k === rows.length - 1);
  return new Tensor([pick.length, pick[0].length], ['u', 'u'], pick.flat());
};

// Parallel transport along curve(s), s in [0, 1].
export function traceParallelTransport(metric, curve, v0, opts = {}) {
  const m = getMetric(metric), n = m.dim;
  const res = parallelTransport(m, curve, v0, opts);
  const x0 = res.x[0], x1 = res.x[res.x.length - 1];
  const per = m.periodic || [];
  const closed = opts.closed ?? x0.every((v, k) => {
    let d = Math.abs(v - x1[k]);
    if (per[k]) d = Math.min(d % per[k], per[k] - (d % per[k]));
    return d < 1e-6;
  });
  let holonomy = null;
  if (closed && n === 2) holonomy = angleBetween(m, x0, v0, res.final, opts.params);
  const viz = opts.viz ?? { scene: 'parallel-transport', params: {} };
  const steps = [
    { kind: 'covariant', label: 'Parallel transport keeps a vector as constant as the space allows: its covariant derivative along the curve is zero.', before: ex('V^{\\mu}'), after: ex('\\dot{x}^{\\nu} \\nabla_{\\nu} V^{\\mu} = 0'), focus: ['nu'], sums: [{ sym: 'nu', range: [0, n] }], numeric: { inputs: { v0: Tensor.fromNested(v0) }, output: Tensor.fromNested(v0) }, viz },
    { kind: 'christoffel', label: 'Write the covariant derivative out. The components change only because the basis changes, by the Christoffel symbols.', before: ex('\\dot{x}^{\\nu} \\nabla_{\\nu} V^{\\mu} = 0'), after: ex('\\dot{V}^{\\mu} = -\\Gamma^{\\mu}_{\\nu\\lambda} \\dot{x}^{\\nu} V^{\\lambda}'), focus: ['nu', 'lambda'], sums: [{ sym: 'nu', range: [0, n] }, { sym: 'lambda', range: [0, n] }], numeric: { inputs: { Gamma: christoffel(m, x0, opts.params) }, output: Tensor.fromNested(v0) }, viz },
    { kind: 'evaluate', label: holonomy != null ? `Step along the curve (RK4). Back at the start, the vector has turned by ${fmtVal(holonomy)} rad: the holonomy, a sign of curvature inside the loop.` : 'Step along the curve (RK4) and keep the vector at each point.', before: ex('\\dot{V}^{\\mu} = -\\Gamma^{\\mu}_{\\nu\\lambda} \\dot{x}^{\\nu} V^{\\lambda}'), after: ex('V^{\\mu}'), focus: ['mu'], numeric: { inputs: { path: packPath(res.x) }, output: packPath(res.v) }, viz, ms: MS.long, holonomy },
  ];
  return finish(steps, { dim: n, ...coordInfo(m), result: Tensor.fromNested(res.final), path: res, holonomy });
}

export function traceGeodesic(metric, x0, v0, opts = {}) {
  const m = getMetric(metric), n = m.dim;
  const res = geodesic(m, x0, v0, opts);
  const viz = opts.viz ?? { scene: 'geodesics', params: { surface: m.id } };
  const eq = '\\ddot{x}^{\\mu} + \\Gamma^{\\mu}_{\\nu\\lambda} \\dot{x}^{\\nu} \\dot{x}^{\\lambda} = 0';
  const steps = [
    { kind: 'covariant', label: 'A geodesic is as straight as the space allows: its velocity is parallel transported along itself.', before: ex('\\dot{x}^{\\mu}'), after: ex('\\dot{x}^{\\nu} \\nabla_{\\nu} \\dot{x}^{\\mu} = 0'), focus: ['nu'], sums: [{ sym: 'nu', range: [0, n] }], numeric: { inputs: { x0: Tensor.fromNested(x0), v0: Tensor.fromNested(v0) }, output: Tensor.fromNested(v0) }, viz },
    { kind: 'christoffel', label: 'In coordinates this is the geodesic equation. The Christoffel term is the "fictitious force" of curved coordinates.', before: ex('\\dot{x}^{\\nu} \\nabla_{\\nu} \\dot{x}^{\\mu} = 0'), after: ex(eq), focus: ['nu', 'lambda'], sums: [{ sym: 'nu', range: [0, n] }, { sym: 'lambda', range: [0, n] }], numeric: { inputs: { Gamma: christoffel(m, x0, opts.params) }, output: christoffel(m, x0, opts.params) }, viz },
    { kind: 'evaluate', label: `Integrate the equation step by step (RK4, ${plural(res.x.length - 1, 'step')}).`, before: ex(eq), after: ex('x^{\\mu}'), focus: ['mu'], numeric: { inputs: { velocity: packPath(res.v) }, output: packPath(res.x) }, viz, ms: MS.long },
  ];
  return finish(steps, { dim: n, ...coordInfo(m), result: Tensor.fromNested(res.final.x), path: res });
}
