// ============================================================================
//  TENSOR CALCULUS  ·  learn/drive.js  ·  a beat drives the three views  (LEARN)
// ----------------------------------------------------------------------------
//  DOM-free. A beat's show object says what the page shows while the beat
//  is open. driveBeat() turns it into calls on window.tensorPage (CORE,
//  ui/page-api.js). The calls go in this order:
//    1. setView(spec)            when show.view or show.style is set
//    2. openEntry(id)            when show.entry is set (its TeX, scene,
//                                diagram and trace)
//    3. setScene(id, params)     when show.scene is set (after the entry,
//                                so the beat's scene wins)
//    4. showExpr(tex)            when show.expr is set and there is no entry
//    5. seek(i, 0) + resume()    when show.step names a Step.kind: i is the
//                                first step of that kind in the entry trace
//       playTrace(trace, {step}) when show.step is set with no entry: the
//                                trace comes from MATH traceEinstein(expr)
//    6. pickIndex(sym | null)    always: the beat's index, or no highlight
//
//  show = { view?: 'all'|'tex'|'viz'|'diagram', style?: 'penrose'|
//           'birdtrack'|'network', entry?, scene?, params?, expr?, step?,
//           pick? }
//
//  EXPORTS   (grep -n "^export" drive.js)
//      viewSpec(show) ......... the setView argument
//      planBeat(show, ctx) .... [[method, ...args]] with no side effect
//      driveBeat(page, show, ctx) runs the plan; returns the plan
//      stepIndexOf(trace, kind)
//      entryTrace(lib, id) .... the default trace of a LIBRARY entry
//      autoBindings(expr, n, math)  sample components for traceEinstein
// ============================================================================

import { parseFactors } from './widgets/math.js';

const ALL = ['tex', 'viz', 'diagram'];

export function viewSpec(show) {
  const views = !show.view || show.view === 'all' ? ALL : [show.view];
  if (show.style) return { views, style: show.style };
  return show.view || 'all';
}

export function stepIndexOf(trace, kind) {
  if (!trace || !trace.steps) return -1;
  return trace.steps.findIndex(s => s.kind === kind);
}

function findEntry(lib, id) {
  if (!lib) return null;
  if (typeof lib.getEntry === 'function') return lib.getEntry(id);
  const list = lib.ENTRIES || lib.LIBRARY || lib.entries || [];
  return (Array.isArray(list) ? list : Object.values(list)).find(e => e && e.id === id) || null;
}

export function entryTrace(lib, id) {
  const e = findEntry(lib, id);
  if (!e || typeof e.trace !== 'function') return null;
  const p = {};
  for (const q of e.params || []) p[q.key] = q.def;
  try { return e.trace(p); } catch { return null; }
}

// Small sample components for every factor of expr, so MATH traceEinstein
// can run a beat's expression with numbers. g gets a positive definite
// metric (lower components, as MATH asks); a derivative gets
// 'partial:<name>' / 'nabla:<name>' with the derivative slot last; a factor
// with no index is the number 1.5.
const SKIP = new Set(['delta', 'epsilon', 'varepsilon']);
export function autoBindings(expr, n, math) {
  const b = {};
  if (!math || !math.Tensor) return b;
  const fs = parseFactors(String(expr).split(/\s=\s/)[0]);
  let k = 1;
  for (let i = 0; i < fs.length; i++) {
    const f = fs[i];
    if (SKIP.has(f.name)) continue;
    if (f.name === 'partial' || f.name === 'nabla') {
      const g = fs[i + 1];
      if (!g) continue;
      const slots = [...g.idx, ...f.idx];
      b[f.name + ':' + g.name] = sample(math, slots, n, k++);
      if (!g.idx.length && !(g.name in b)) b[g.name] = 1.5;
      continue;
    }
    if (f.name in b) continue;
    if (f.name === 'g' && f.idx.length === 2) {
      const d = [];
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) d.push(r === c ? 2 + r : 0.3);
      b.g = new math.Tensor([n, n], ['d', 'd'], d);
      continue;
    }
    b[f.name] = f.idx.length ? sample(math, f.idx, n, k++) : 1.5;
  }
  return b;
}
function sample(math, idx, n, k) {
  const size = n ** idx.length;
  const data = Array.from({ length: size }, (_, i) => ((i * 7 + k * 3) % 5) - 1.5);
  return new math.Tensor(idx.map(() => n), idx.map(x => (x.up ? 'u' : 'd')), data);
}

// ctx: { lib (library/index.js module), math (tensor/index.js module),
//        resolveScene(id), resolveEntry(id) -> id | null, fallbackExpr }
export function planBeat(show = {}, ctx = {}) {
  const plan = [];
  const rs = ctx.resolveScene || (x => x), re = ctx.resolveEntry || (x => x);
  if (show.view || show.style) plan.push(['setView', viewSpec(show)]);
  const entry = show.entry ? re(show.entry) : null;
  if (entry) plan.push(['openEntry', entry]);
  if (show.scene) plan.push(['setScene', rs(show.scene), { ...(show.params || {}) }]);
  // No entry (or the library does not hold it yet): show the expression,
  // else the beat's display TeX (ctx.fallbackExpr).
  const ex = show.expr || (show.entry && !entry ? ctx.fallbackExpr : null);
  if (ex && !entry) plan.push(['showExpr', ex]);
  if (show.step) {
    if (entry) {
      const tr = entryTrace(ctx.lib, entry);
      const i = stepIndexOf(tr, show.step);
      plan.push(['seek', Math.max(0, i), 0], ['resume']);
    } else if (show.expr && ctx.math && typeof ctx.math.traceEinstein === 'function') {
      let tr = null;
      try { tr = ctx.math.traceEinstein(show.expr, autoBindings(show.expr, 2, ctx.math), { dim: 2 }); } catch { tr = null; }
      if (tr && tr.steps && tr.steps.length) plan.push(['playTrace', tr, { step: Math.max(0, stepIndexOf(tr, show.step)), autoplay: true }]);
    }
  }
  plan.push(['pickIndex', show.pick || null]);
  return plan;
}

export async function driveBeat(page, show, ctx = {}) {
  const plan = planBeat(show, ctx);
  if (!page) return plan;
  for (const [m, ...args] of plan) {
    if (typeof page[m] !== 'function') continue;
    try { await page[m](...args); } catch (e) { /* one failed call does not stop the beat */ }
  }
  return plan;
}
