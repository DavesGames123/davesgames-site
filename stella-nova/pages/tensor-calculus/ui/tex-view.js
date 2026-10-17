// ============================================================================
//  TENSOR CALCULUS  ·  ui/tex-view.js  ·  the equation view  (CORE)
// ----------------------------------------------------------------------------
//  The TeX view has the same interface as the 3D view and the diagram:
//  show(expr), play(step, t), pickIndex(sym). CORE calls onStep(step) once
//  when the player moves to a new step; the view typesets then. play() runs
//  each frame and only sets styles, so a frame never waits for MathJax.
//
//  WHAT IT SHOWS
//    no step     the expression, with each index in its palette colour
//    a step      the step label, the expression before (it fades and moves
//                up as t grows), the operation name, and the expression
//                after (it comes in). The indices in step.focus pulse.
//    sums        with "Write out sums" on, or for an expandSum step, the
//                Einstein sums of the step (or of the expression) are
//                written out term by term, values in the index colour.
//
//  TeX SOURCE. An expression object goes through MATH toTex with a
//  colorMap from palette.js, so the TeX colours match the diagram and 3D.
//  A string, or an object with no MATH, goes through colorIndexTex().
//
//  DEPENDENCIES are passed in (typeset, math), so tests run in node.
//
//  EXPORTS   (grep -n "export" ui/tex-view.js)
//      exprSyms(expr, math)        index syms of an expression, in order
//      exprTex(expr, math, opts)   coloured TeX (opts.colors = false: plain)
//      sumsTex(tex, sums, opts)    the written-out sums of a plain TeX
//      createTexView(els, deps)    the view
// ============================================================================
import { indexSlot, indexClass } from '../palette.js';
import { colorIndexTex, scriptIndices, expandSumTex } from './tex-color.js';
import { symLabel } from './lens.js';

const isExpr = x => x && typeof x === 'object' && Array.isArray(x.terms);

export function exprSyms(expr, math) {
  if (!expr) return [];
  if (typeof expr === 'string') return scriptIndices(expr);
  if (isExpr(expr) && math && math.indexColorMap) {
    try { return [...math.indexColorMap(expr).keys()]; } catch (e) { /* fall through */ }
  }
  const out = [];
  const add = s => { if (s && !out.includes(s)) out.push(s); };
  if (isExpr(expr)) for (const t of expr.terms) for (const f of t.factors || []) {
    for (const ix of (f.deriv || [])) if (!ix.fixed) add(ix.sym);
    for (const ix of (f.indices || [])) if (!ix.fixed) add(ix.sym);
  }
  if (!out.length && expr.tex) scriptIndices(expr.tex).forEach(add);
  return out;
}

export function exprTex(expr, math, opts = {}) {
  const colors = opts.colors !== false;
  if (expr == null) return '';
  if (typeof expr === 'string') return colors && !expr.includes('\\class{i') ? colorIndexTex(expr, indexClass) : expr;
  if (isExpr(expr) && math && math.toTex) {
    try {
      const colorMap = new Map(exprSyms(expr, math).map(s => [s, indexSlot(s)]));
      return math.toTex(expr, { colors, colorMap });
    } catch (e) { /* fall back to expr.tex */ }
  }
  const tex = expr.tex || '';
  return colors && !tex.includes('\\class{i') ? colorIndexTex(tex, indexClass) : tex;
}

// tex: plain TeX (no colours). sums: [{ sym, range: [0, n] }]. At most two
// sums are written out, so a double sum stays readable.
export function sumsTex(tex, sums, { max = 2 } = {}) {
  let out = tex;
  for (const s of (sums || []).slice(0, max)) {
    const n = Array.isArray(s.range) ? s.range[1] - s.range[0] : (+s.range || 3);
    out = expandSumTex(out, s.sym, n, indexClass);
  }
  return colorIndexTex(out, indexClass);
}

const OP_NAMES = {
  product: 'tensor product', contract: 'contract', raise: 'raise an index', lower: 'lower an index',
  transform: 'change coordinates', symmetrize: 'symmetrise', antisymmetrize: 'antisymmetrise', partial: 'partial derivative',
  covariant: 'covariant derivative', christoffel: 'Christoffel symbols', trace: 'trace', expandSum: 'write out the sum',
  substitute: 'substitute', relabel: 'rename indices', evaluate: 'evaluate',
};

// els: { label, before, op, opName, after, sum, info, caption, host }
// deps: { typeset(el, tex, opts) -> Promise, math, dim() -> number }
export function createTexView(els, deps) {
  const { typeset, math } = deps;
  let sumsOn = false, curStep = null, curExpr = null, picked = null;
  const host = els.host;

  function setTex(el, tex) {
    if (!el) return Promise.resolve(false);
    el.hidden = !tex;
    if (!tex) { el.replaceChildren(); return Promise.resolve(false); }
    return Promise.resolve(typeset(el, tex, { display: true })).catch(() => false);
  }

  function info(expr) {
    if (!els.info) return;
    els.info.replaceChildren();
    if (!isExpr(expr)) return;
    const doc = els.info.ownerDocument;
    const add = (title, list) => {
      if (!list.length) return;
      const g = doc.createElement('span'); g.className = 'ii-group';
      const t = doc.createElement('span'); t.className = 'ii-title'; t.textContent = title; g.appendChild(t);
      for (const it of list) {
        const c = doc.createElement('button'); c.type = 'button';
        c.className = 'ii-chip ' + indexClass(it.sym);
        c.dataset.sym = it.sym;
        c.textContent = symLabel(it.sym) + (it.up === true ? ' upper' : it.up === false ? ' lower' : '');
        g.appendChild(c);
      }
      els.info.appendChild(g);
    };
    add('Free', (expr.free || []).map(i => ({ sym: i.sym, up: i.up })));
    add('Summed', (expr.dummies || []).map(s => ({ sym: typeof s === 'string' ? s : s.sym })));
  }

  function plainTex(expr) { return exprTex(expr, math, { colors: false }); }

  function sumsFor(step, expr) {
    if (step && step.sums && step.sums.length) return step.sums;
    const dim = (deps.dim && deps.dim()) || 3;
    return (expr && expr.dummies || []).map(s => ({ sym: typeof s === 'string' ? s : s.sym, range: [0, dim] }));
  }

  function renderSums() {
    if (!els.sum) return;
    const want = sumsOn || (curStep && curStep.kind === 'expandSum');
    const src = curStep ? curStep.before : curExpr;
    const sums = want ? sumsFor(curStep, src) : [];
    if (!sums.length || !src) { setTex(els.sum, ''); return; }
    let tex = '';
    try { tex = sumsTex(plainTex(src), sums); } catch (e) { tex = ''; }
    setTex(els.sum, tex);
  }

  function pulse(focus) {
    host.dataset.pulse = (focus || []).map(s => indexClass(s)).join(' ');
  }

  const view = {
    show(expr) {
      curStep = null; curExpr = expr;
      host.classList.remove('stepping');
      if (els.label) els.label.textContent = '';
      if (els.op) els.op.hidden = true;
      setTex(els.before, '');
      const p = setTex(els.after, exprTex(expr, math));
      pulse([]);
      info(expr);
      renderSums();
      return p;
    },
    onStep(step) {
      curStep = step; curExpr = step ? step.after : curExpr;
      if (!step) return Promise.resolve();
      host.classList.add('stepping');
      if (els.label) els.label.textContent = step.label || '';
      if (els.op) els.op.hidden = false;
      if (els.opName) els.opName.textContent = OP_NAMES[step.kind] || step.kind || '';
      pulse(step.focus);
      info(step.after);
      const a = setTex(els.before, exprTex(step.before, math));
      const b = setTex(els.after, exprTex(step.after, math));
      renderSums();
      return Promise.all([a, b]);
    },
    play(step, t) {
      if (step && step !== curStep) view.onStep(step);
      const k = Math.min(1, Math.max(0, t));
      host.style.setProperty('--t', k.toFixed(4));
      if (els.before) { els.before.style.opacity = (1 - 0.55 * k).toFixed(3); els.before.style.transform = `translateY(${(-6 * k).toFixed(2)}px)`; }
      if (els.after && curStep) { els.after.style.opacity = (0.15 + 0.85 * k).toFixed(3); els.after.style.transform = `translateY(${(10 * (1 - k)).toFixed(2)}px) scale(${(0.97 + 0.03 * k).toFixed(4)})`; }
      if (els.op) els.op.style.setProperty('--k', k.toFixed(3));
    },
    pickIndex(sym) {
      picked = sym || null;
      if (picked) host.dataset.pick = indexClass(picked); else delete host.dataset.pick;
    },
    setSums(on) { sumsOn = !!on; renderSums(); return sumsOn; },
    sums() { return sumsOn; },
    refresh() { if (curStep) { const s = curStep; curStep = null; return view.onStep(s); } return view.show(curExpr); },
    state() { return { step: curStep, expr: curExpr, picked, sumsOn }; },
    dispose() {},
  };
  return view;
}
