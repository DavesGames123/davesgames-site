// ============================================================================
//  tensor/evaluate.js  ·  numbers for a TensorExpr (DOM-free)
// ----------------------------------------------------------------------------
//  evaluateExpr(expr, bindings, opts) -> Tensor
//      bindings: { name: Components | Tensor | nested array | number }
//      A tensor factor takes bindings[name]. When the factor's index
//      heights differ from the bound variance, the engine raises or lowers
//      the slots with the metric (bindings.g, or opts.metric = g as a
//      nested array or Tensor). delta and epsilon come from opts.dim.
//      A scalar factor takes bindings[name] or opts.coeffs[tex]; a string
//      coefficient takes opts.coeffs[coeff]. A derivative factor takes
//      bindings['nabla:T'] or bindings['partial:T'] with the derivative
//      slots last (the order of f.deriv). A digit index picks one
//      component. (..) and [..] marks symmetrize the slots first, also
//      a mark over several factors (term.sym, for example g_{a[c} R_{d]b}).
//      One name for a tensor and a scalar (R_{mn} and R): bind the tensor
//      as bindings.R and the scalar as bindings['scalar:R']. One name for
//      tensors of two ranks (Riemann R_{abcd}, Ricci R_{ab}): bind 'R@4' and 'R@2'.
//      The result slots follow expr.free; an equation gives
//      { lhs, rhs, residual } with residual = max |lhs - rhs|.
//
//  expandToComponents(expr, opts) -> { lines, tex, truncated }
//      Writes the Einstein sums out for the TeX view. It writes the
//      ( ) and [ ] brackets out first (expandBrackets). opts: dim, values
//      ({ sym: k } for the free indices; default all 0), all (every free
//      value), coords (labels such as ['t','r','\\theta','\\phi']),
//      bindings (then each product and the sum have numbers), maxTerms,
//      skipZero (with bindings: leave out the products that are 0).
//      Each line: { values, tex, texNumeric?, value?, terms: [{ tex, value?, values }] }.
//
//  ANCHORS   (grep -n "<anchor>" evaluate.js)
//      factorTensor ......... "export function factorTensor"
//      evaluateExpr ......... "export function evaluateExpr"
//      expandToComponents ... "export function expandToComponents"
// ============================================================================

import { Tensor, einsum, product, raise, lower, symmetrize, antisymmetrize, kroneckerDelta, leviCivita, matInverse, indexTuples } from './tensor.js';
import { factorTex, indexColorMap, fmtNum, factorIndices, expandBrackets } from './expr.js';

const isComp = x => x && (x instanceof Tensor || (x.shape && x.data) || Array.isArray(x));

function metricPair(bindings, opts) {
  let g = opts.metric ?? bindings.g ?? bindings.eta;
  if (g == null) return null;
  g = Tensor.from(g, ['d', 'd']);
  const gInv = Tensor.fromNested(matInverse(g.toNested()), ['u', 'u']);
  return { g: new Tensor(g.shape, ['d', 'd'], g.data), gInv };
}

function dimOf(bindings, opts) {
  if (opts.dim) return opts.dim;
  for (const v of Object.values(bindings || {})) if (isComp(v)) { const t = Tensor.from(v); if (t.rank) return t.shape[0]; }
  throw new Error('give opts.dim: no bound tensor shows the dimension');
}

// The component Tensor of one factor, with the factor's index heights.
export function factorTensor(f, bindings = {}, opts = {}) {
  const dim = dimOf(bindings, opts);
  const want = factorIndices(f).map(i => (i.up ? 'u' : 'd'));
  let t;
  if (f.kind === 'delta') t = kroneckerDelta(dim, want);
  else if (f.kind === 'epsilon') t = leviCivita(want.length, want); // the symbol, frame values
  else if (f.kind === 'metric' || f.kind === 'inverseMetric') {
    const mp = metricPair(bindings, opts);
    if (!mp) throw new Error(`bind the metric: give bindings.g (lower components) to evaluate ${f.tex}`);
    t = want[0] === want[1] ? (want[0] === 'u' ? mp.gInv : mp.g) : kroneckerDelta(dim, want);
  } else if (f.kind === 'scalar') {
    const v = bindings['scalar:' + f.name] ?? bindings[f.name] ?? (opts.coeffs || {})[f.tex] ?? (f.name === 'pi' ? Math.PI : undefined);
    if (typeof v !== 'number') throw new Error(`bind the scalar ${f.tex}: give bindings['${f.name}'] or opts.coeffs['${f.tex}'] as a number`);
    t = Tensor.scalar(f.power != null ? v ** f.power : v);
    return t;
  } else {
    const key = f.deriv ? `${f.derivKind || 'nabla'}:${f.name}` : f.name;
    const b = bindings[`${key}@${want.length}`] ?? bindings[key];
    if (b == null) throw new Error(f.deriv ? `bind the derivative: give bindings['${key}'] with the derivative slots last` : `bind the tensor ${f.tex}: give bindings['${f.name}'] as components`);
    if (typeof b === 'number') throw new Error(`${f.tex} has indices, but bindings['${key}'] is a number`);
    t = Tensor.from(b);
    if (t.rank !== want.length) throw new Error(`${f.tex} has ${want.length} indices but its bound components have rank ${t.rank}`);
    for (let s = 0; s < want.length; s++) {
      if (t.variance[s] === want[s]) continue;
      const mp = metricPair(bindings, opts);
      if (!mp) throw new Error(`${f.tex} slot ${s + 1} is bound ${t.variance[s] === 'u' ? 'upper' : 'lower'} but written ${want[s] === 'u' ? 'upper' : 'lower'}; bind the metric g to raise or lower it`);
      t = want[s] === 'u' ? raise(t, s, mp.gInv) : lower(t, s, mp.g);
    }
  }
  for (const s of f.sym || []) t = s.type === 'sym' ? symmetrize(t, s.slots) : antisymmetrize(t, s.slots);
  return t;
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Digit indices pick one component: slice those slots away.
function sliceFixed(ft, ixs) {
  const keep = ixs.map((i, k) => (i.fixed ? -1 : k)).filter(k => k >= 0);
  const out = new Tensor(keep.map(k => ft.shape[k]), keep.map(k => ft.variance[k]));
  const full = ixs.map(i => (i.fixed ? +i.sym : 0));
  for (const id of indexTuples(out.shape)) { keep.forEach((k, q) => { full[k] = id[q]; }); out.data[out.offset(id)] = ft.data[ft.offset(full)]; }
  return out;
}

function termValue(t, freeOrder, bindings, opts, dim) {
  let coeff = t.coeff;
  if (typeof coeff === 'string') {
    const c = (opts.coeffs || {})[coeff];
    if (typeof c !== 'number') throw new Error(`bind the coefficient: give opts.coeffs['${coeff}'] as a number`);
    coeff = c;
  }
  const letter = new Map();
  const L = sym => { if (!letter.has(sym)) letter.set(sym, LETTERS[letter.size]); return letter.get(sym); };
  for (const ix of freeOrder) L(ix.sym);
  const specs = [], ts = [];
  // A bracket over several factors (term.sym): form the outer product of
  // the factors, (anti)symmetrize the marked slots, then contract it as
  // one tensor. The bracket acts before the sums, as the notation says.
  if (t.sym && t.sym.length && t.factors.length) {
    const offs = [];
    let big = null, off = 0;
    for (const f of t.factors) {
      const ft = factorTensor(f, bindings, opts);
      offs.push(off); off += ft.rank;
      big = big ? product(big, ft) : ft;
    }
    for (const m of t.sym) {
      const slots = m.slots.map(r => offs[r.factor] + r.index);
      big = m.type === 'sym' ? symmetrize(big, slots) : antisymmetrize(big, slots);
    }
    const ixs = t.factors.flatMap(factorIndices);
    if (ixs.some(i => i.fixed)) big = sliceFixed(big, ixs);
    const outSpec = freeOrder.map(i => L(i.sym)).join('');
    return einsum(`${ixs.filter(i => !i.fixed).map(i => L(i.sym)).join('')}->${outSpec}`, big).scale(coeff);
  }
  for (const f of t.factors) {
    let ft = factorTensor(f, bindings, opts);
    const ixs = factorIndices(f);
    // Digit indices pick one component: slice those slots away.
    if (ixs.some(i => i.fixed)) ft = sliceFixed(ft, ixs);
    specs.push(ixs.filter(i => !i.fixed).map(i => L(i.sym)).join(''));
    ts.push(ft);
  }
  const outSpec = freeOrder.map(i => L(i.sym)).join('');
  if (!ts.length) {
    if (freeOrder.length && coeff !== 0) throw new Error('a number alone cannot be added to a tensor with free indices');
    return new Tensor(freeOrder.map(() => dim), freeOrder.map(i => (i.up ? 'u' : 'd'))).map(() => (freeOrder.length ? 0 : coeff));
  }
  const r = einsum(`${specs.join(',')}->${outSpec}`, ...ts);
  return r.scale(coeff);
}

function sideValue(terms, freeOrder, bindings, opts, dim) {
  let acc = null;
  for (const t of terms) {
    const v = termValue(t, freeOrder, bindings, opts, dim);
    acc = acc ? acc.add(v) : v;
  }
  if (!acc) acc = new Tensor(freeOrder.map(() => dim), freeOrder.map(i => (i.up ? 'u' : 'd')));
  acc.variance = freeOrder.map(i => (i.up ? 'u' : 'd'));
  return acc;
}

export function evaluateExpr(expr, bindings = {}, opts = {}) {
  const dim = dimOf(bindings, opts);
  if (expr.rel) {
    const lhs = sideValue(expr.lhs.terms, expr.free, bindings, opts, dim);
    const rhs = sideValue(expr.rhs.terms, expr.free, bindings, opts, dim);
    return { lhs, rhs, residual: lhs.sub(rhs).maxAbs() };
  }
  return sideValue(expr.terms, expr.free, bindings, opts, dim);
}

// ---- explicit sums for the TeX view ------------------------------------------
export function expandToComponents(expr, opts = {}) {
  // Brackets first: the written-out sum has one product per permutation.
  if (expr.terms.some(t => (t.sym && t.sym.length) || t.factors.some(f => f.sym && f.sym.length))) expr = expandBrackets(expr);
  const bindings = opts.bindings;
  const dim = opts.dim ?? (bindings ? dimOf(bindings, opts) : 3);
  const label = k => (opts.coords ? opts.coords[k] : String(k));
  const cmap = indexColorMap(expr);
  const maxTerms = opts.maxTerms ?? 64;
  const free = expr.free;
  const freeSets = opts.all ? [...indexTuples(free.map(() => dim))] : [free.map(i => (opts.values && opts.values[i.sym] != null ? opts.values[i.sym] : 0))];
  const ftCache = new Map();
  const comp = (f, vals) => {
    if (!bindings) return null;
    if (!ftCache.has(f)) ftCache.set(f, factorTensor(f, bindings, opts));
    const t = ftCache.get(f);
    if (!t.rank) return t.data[0];
    return t.get(factorIndices(f).map(i => (i.fixed ? +i.sym : vals[i.sym])));
  };
  let truncated = false;
  const sides = expr.rel ? [expr.lhs.terms, expr.rhs.terms] : [expr.terms];
  const lines = freeSets.slice(0, opts.maxLines ?? 64).map(fv => {
    const values = {};
    free.forEach((ix, k) => { values[ix.sym] = fv[k]; });
    const sideOut = sides.map(terms => {
      const out = [];
      for (const t of terms) {
        const seen = [];
        for (const f of t.factors) for (const ix of factorIndices(f)) if (!ix.fixed && values[ix.sym] == null && !seen.includes(ix.sym)) seen.push(ix.sym);
        for (const dv of indexTuples(seen.map(() => dim))) {
          if (out.length >= maxTerms) { truncated = true; break; }
          const vals = { ...values };
          seen.forEach((s, k) => { vals[s] = dv[k]; });
          const subst = {};
          for (const s of Object.keys(vals)) subst[s] = label(vals[s]);
          let co = typeof t.coeff === 'number' ? t.coeff : 1;
          const coTex = typeof t.coeff === 'string' ? t.coeff + ' ' : '';
          const body = t.factors.map(f => factorTex(f, { colorMap: cmap, colors: opts.colors !== false, subst })).join(' ');
          let value, parts;
          if (bindings) {
            value = typeof t.coeff === 'number' ? co : ((opts.coeffs || {})[t.coeff] ?? NaN);
            parts = t.factors.map(f => comp(f, vals));
            for (const v of parts) value *= v;
            if (opts.skipZero && value === 0) continue;
          }
          out.push({ tex: coTex + body, coeff: co, value, parts, values: vals, bare: !t.factors.length });
        }
      }
      return out;
    });
    const join = (list, numeric) => {
      if (!list.length) return '0';
      let s = '';
      list.forEach((p, k) => {
        const neg = p.coeff < 0, mag = Math.abs(p.coeff);
        if (p.bare) { s += (k === 0 ? (neg ? '-' : '') : (neg ? ' - ' : ' + ')) + fmtNum(mag); return; }
        const c = mag === 1 ? '' : fmtNum(mag) + ' ';
        const piece = numeric ? p.parts.map(v => `(${fmtVal(v)})`).join('') : p.tex;
        s += (k === 0 ? (neg ? '-' : '') : (neg ? ' - ' : ' + ')) + c + piece;
      });
      return s + (truncated ? ' + \\cdots' : '');
    };
    const line = { values, terms: sideOut.flat(), tex: sideOut.map(l => join(l, false)).join(' = ') };
    if (bindings) {
      line.texNumeric = sideOut.map(l => join(l, true)).join(' = ');
      line.value = sideOut.map(l => l.reduce((a, p) => a + p.value, 0));
      if (!expr.rel) line.value = line.value[0];
    }
    return line;
  });
  return { lines, tex: lines.length ? lines[0].tex : '', truncated };
}

export function fmtVal(v) {
  if (!Number.isFinite(v)) return String(v);
  if (Math.abs(v) < 1e-12) return '0';
  const r = +v.toPrecision(4);
  return Math.abs(r) >= 1e5 || Math.abs(r) < 1e-3 ? r.toExponential(2).replace(/e([+-]?)(\d+)/, (_, s, d) => `\\times 10^{${s === '-' ? '-' : ''}${d}}`) : String(r);
}
