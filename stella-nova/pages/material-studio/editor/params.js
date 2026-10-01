// ============================================================================
//  MATERIAL STUDIO  ·  editor/params.js — param values: format and quantize
// ────────────────────────────────────────────────────────────────────────────
//  Pure functions for the param widgets on a node. pointer.js (slider drag)
//  and inline.js (typed value, color picker) write values. node-draw.js
//  shows values. nextMerge gives each widget edit its own undo merge key.
//
//  GREP TARGETS
//      fmtNum ...... a number with the decimals of the param step
//      fmtDefault .. the default of an unlinked input port
//      hexOk ....... a '#rrggbb' string test
//      quant ....... clamp to min/max and round to the step
//      nextMerge ... 'param:<node>.<param>:<seq>' undo merge key
// ============================================================================
export function fmtNum(v, p) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return String(v ?? '');
  const step = p?.step || (p?.kind === 'int' ? 1 : 0.001);
  const d = Math.min(4, Math.max(0, -Math.floor(Math.log10(step) + 1e-9)));
  return v.toFixed(p?.kind === 'int' ? 0 : d);
}
export function fmtDefault(d) { return Array.isArray(d) ? d.map(x => +(+x).toFixed(2)).join(' ') : (typeof d === 'number' ? +d.toFixed(3) + '' : ''); }
export function hexOk(h) { return typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h); }
export function quant(v, p) {
  const min = p.min ?? (p.kind === 'vec2' ? -Infinity : 0), max = p.max ?? (p.kind === 'vec2' ? Infinity : 1);
  v = Math.max(min, Math.min(max, v));
  const step = p.kind === 'int' ? Math.max(1, p.step || 1) : (p.step || 0.001);
  v = Math.round(v / step) * step;
  return +v.toFixed(p.kind === 'int' ? 0 : Math.min(6, Math.max(0, -Math.floor(Math.log10(step) - 1e-9))));
}
let paramSeq = 0;
export function nextMerge(n, p) { return `param:${n.id}.${p.id}:${++paramSeq}`; }
