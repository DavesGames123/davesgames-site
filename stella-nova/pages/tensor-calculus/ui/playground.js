// ============================================================================
//  TENSOR CALCULUS  ·  ui/playground.js  ·  the Playground tab  (CORE)
// ----------------------------------------------------------------------------
//  The reader types an index expression in TeX. Each key press parses it
//  with MATH parseIndexTex and checks it with MATH validate; the errors
//  show at once, in plain sentences, with the place of a parse error. A
//  valid expression goes to the views (onExpr), so the diagram and the TeX
//  follow the typing. The reader then picks an operation (ui/ops.js) and
//  its arguments, and "Play the operation" gives an OpTrace to onTrace.
//  The result can become the new input, so operations chain.
//
//  EXAMPLES are short starting points; each one is a tap.
//
//  EXPORTS   (grep -n "export" ui/playground.js)
//      EXAMPLES, createPlayground(els, deps) -> { setInput(tex), expr(),
//        apply(), selectOp(id) }
// ============================================================================
import { OPS, JACOBIANS, OpError, buildOpTrace } from './ops.js';
import { symLabel } from './lens.js';
import { indexClass } from '../palette.js';

export const EXAMPLES = Object.freeze([
  { tex: 'T^{\\mu}{}_{\\nu}', label: 'mixed rank 2' },
  { tex: 'v^{\\mu}', label: 'vector' },
  { tex: '\\omega_{\\mu}', label: 'covector' },
  { tex: 'g_{\\mu\\nu} v^{\\mu} w^{\\nu}', label: 'dot product' },
  { tex: 'T_{\\mu\\nu}', label: 'rank 2, lower' },
  { tex: 'R^{\\rho}{}_{\\sigma\\mu\\nu}', label: 'Riemann' },
  { tex: '\\epsilon_{ijk} a^{j} b^{k}', label: 'cross product' },
  { tex: 'A^{i}{}_{j} B^{j}{}_{k}', label: 'matrix product' },
  { tex: 'F_{\\mu\\nu}', label: 'field strength' },
]);

// els: { input, status, examples, dim, metric, ops, args, apply, history }
// deps: { math, onExpr(expr), onTrace(trace, meta), typeset }
export function createPlayground(els, deps) {
  const M = deps.math;
  const doc = els.input.ownerDocument;
  const h = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  let cur = null, op = 'contract', timer = 0;
  const argState = { jacobian: 'rotation', params: {} };

  // ---- examples
  for (const ex of EXAMPLES) {
    const b = h('button', 'chip', ex.label);
    b.title = ex.tex;
    b.addEventListener('click', () => setInput(ex.tex));
    els.examples.appendChild(b);
  }

  // ---- metrics
  const metrics = M && M.METRICS ? Object.values(M.METRICS) : [];
  els.metric.replaceChildren();
  const none = h('option', null, 'Euclidean (default)'); none.value = ''; els.metric.appendChild(none);
  for (const m of metrics) { const o = h('option', null, m.label || m.id); o.value = m.id; els.metric.appendChild(o); }
  els.metric.addEventListener('change', () => {
    const m = metrics.find(q => q.id === els.metric.value);
    if (m && m.dim) {
      if (![...els.dim.options].some(o => +o.value === m.dim)) { const o = h('option', null, String(m.dim)); o.value = m.dim; els.dim.appendChild(o); }
      els.dim.value = String(m.dim);
    }
    check();
  });
  els.dim.addEventListener('change', check);

  // ---- operations
  for (const o of OPS) {
    const b = h('button', 'op' + (o.id === op ? ' on' : ''), o.label);
    b.dataset.op = o.id; b.title = o.blurb;
    b.addEventListener('click', () => selectOp(o.id));
    els.ops.appendChild(b);
  }

  function selectOp(id) {
    op = id;
    for (const b of els.ops.querySelectorAll('button')) b.classList.toggle('on', b.dataset.op === id);
    renderArgs();
  }

  function idxSelect(name, list, pick) {
    const wrap = h('label', 'arg');
    wrap.appendChild(h('span', 'arg-name', name));
    const s = doc.createElement('select');
    for (const i of list) { const o = h('option', null, `${symLabel(i.sym)} (${i.up ? 'upper' : 'lower'})`); o.value = i.sym; o.className = indexClass(i.sym); s.appendChild(o); }
    if (pick && list.some(i => i.sym === pick)) s.value = pick;
    wrap.appendChild(s);
    return [wrap, s];
  }

  function renderArgs() {
    els.args.replaceChildren();
    const meta = OPS.find(o => o.id === op);
    els.args.appendChild(h('p', 'hint', meta.blurb));
    const free = (cur && cur.free) || [];
    argState.read = () => ({});
    if (op === 'contract') {
      const [a, sa] = idxSelect('upper', free.filter(i => i.up)), [b, sb] = idxSelect('lower', free.filter(i => !i.up));
      els.args.append(a, b);
      argState.read = () => ({ up: sa.value, down: sb.value });
    } else if (op === 'raise' || op === 'lower') {
      const [a, sa] = idxSelect('index', free.filter(i => i.up === (op === 'lower')));
      els.args.append(a);
      argState.read = () => ({ sym: sa.value });
    } else if (op === 'symmetrize' || op === 'antisymmetrize') {
      const [a, sa] = idxSelect('first', free), [b, sb] = idxSelect('second', free, free[1] && free[1].sym);
      els.args.append(a, b);
      argState.read = () => ({ pair: [sa.value, sb.value] });
    } else if (op === 'transform') {
      const wrap = h('label', 'arg'); wrap.appendChild(h('span', 'arg-name', 'Jacobian'));
      const s = doc.createElement('select');
      for (const j of JACOBIANS) { const o = h('option', null, j.label); o.value = j.id; s.appendChild(o); }
      s.value = argState.jacobian;
      wrap.appendChild(s); els.args.appendChild(wrap);
      const box = h('div', 'arg-params'); els.args.appendChild(box);
      const params = () => {
        box.replaceChildren();
        const j = JACOBIANS.find(q => q.id === s.value);
        argState.params = {};
        for (const p of j.params) {
          const row = h('label', 'row'); row.appendChild(h('span', 'row-name', p.label));
          const inp = doc.createElement('input'); inp.type = 'range'; inp.min = p.min; inp.max = p.max; inp.step = p.step; inp.value = p.def;
          const out = h('span', 'row-val', (+p.def).toFixed(2));
          argState.params[p.key] = p.def;
          inp.addEventListener('input', () => { argState.params[p.key] = +inp.value; out.textContent = (+inp.value).toFixed(2); });
          row.append(inp, out); box.appendChild(row);
        }
      };
      s.addEventListener('change', () => { argState.jacobian = s.value; params(); });
      params();
      argState.read = () => ({ jacobian: s.value, params: { ...argState.params } });
    } else if (op === 'covariant') {
      const wrap = h('label', 'arg'); wrap.appendChild(h('span', 'arg-name', 'new index'));
      const s = doc.createElement('select');
      for (const g of ['lambda', 'alpha', 'beta', 'kappa', 'tau', 'k', 'l', 'm']) { const o = h('option', null, symLabel(g)); o.value = g; s.appendChild(o); }
      wrap.appendChild(s); els.args.appendChild(wrap);
      argState.read = () => ({ sym: s.value });
    } else if (op === 'product') {
      const wrap = h('label', 'arg'); wrap.appendChild(h('span', 'arg-name', 'times'));
      const i = doc.createElement('input'); i.type = 'text'; i.value = 'w^{\\lambda}'; i.spellcheck = false;
      wrap.appendChild(i); els.args.appendChild(wrap);
      argState.read = () => ({ tex: i.value });
    }
  }

  function status(kind, html) {
    els.status.className = 'pg-status ' + kind;
    els.status.replaceChildren();
    if (typeof html === 'string') els.status.textContent = html; else if (html) els.status.appendChild(html);
  }

  function check() {
    cur = null;
    const src = els.input.value.trim();
    if (!src) { status('', 'Type an expression, for example T^{\\mu}{}_{\\nu}.'); renderArgs(); return null; }
    if (!M) { status('err', 'The tensor engine has not loaded, so the playground cannot parse the expression.'); return null; }
    let e;
    try { e = M.parseIndexTex(src); }
    catch (err) {
      const box = h('div');
      box.appendChild(h('div', 'pg-err', err.message));
      if (err.pos != null) {
        const pre = h('code', 'pg-caret');
        pre.textContent = src + '\n' + ' '.repeat(Math.max(0, err.pos)) + '^';
        box.appendChild(pre);
      }
      status('err', box); renderArgs(); return null;
    }
    const v = M.validate ? M.validate(e, { dim: +els.dim.value }) : { ok: true, errors: [], warnings: [], free: e.free, dummies: e.dummies, rank: { up: 0, down: 0 } };
    if (!v.ok) { status('err', v.errors.map(x => x.msg).join(' ')); renderArgs(); return null; }
    cur = e;
    const box = h('div');
    const r = v.rank || { up: e.free.filter(i => i.up).length, down: e.free.filter(i => !i.up).length };
    box.appendChild(h('span', 'pg-ok', `Valid. Type (${r.up}, ${r.down}): ${r.up} upper and ${r.down} lower free ${r.up + r.down === 1 ? 'index' : 'indices'}`));
    if (e.dummies.length) box.appendChild(h('span', 'pg-ok', `, summed over ${e.dummies.map(symLabel).join(', ')}`));
    box.appendChild(doc.createTextNode('.'));
    for (const w of v.warnings || []) box.appendChild(h('div', 'pg-warn', w.msg));
    status('ok', box);
    renderArgs();
    if (deps.onExpr) deps.onExpr(e);
    return e;
  }

  function apply() {
    if (!cur && !check()) return null;
    try {
      const trace = buildOpTrace(M, cur, op, argState.read(), { dim: +els.dim.value, metric: els.metric.value || undefined });
      const last = trace.steps[trace.steps.length - 1].after;
      addHistory(op, last);
      deps.onTrace(trace, { op, source: 'playground' });
      return trace;
    } catch (err) {
      status('err', err instanceof OpError || err.name === 'TexParseError' ? err.message : 'The operation failed: ' + err.message);
      return null;
    }
  }

  function addHistory(opId, expr) {
    const row = h('div', 'pg-hist-row');
    const tex = M.toTex(expr, { colors: false });
    row.appendChild(h('span', 'pg-hist-op', (OPS.find(o => o.id === opId) || {}).label || opId));
    const code = h('code', null, tex); row.appendChild(code);
    const use = h('button', 'mini', 'Use as input');
    use.addEventListener('click', () => setInput(tex));
    row.appendChild(use);
    els.history.prepend(row);
    while (els.history.children.length > 6) els.history.lastChild.remove();
  }

  function setInput(tex) { els.input.value = tex; check(); }

  els.input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(check, 140); });
  els.input.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) { e.preventDefault(); apply(); } });
  els.apply.addEventListener('click', apply);
  renderArgs();

  return { setInput, expr: () => cur, apply, selectOp, check };
}
