// ============================================================================
//  MATERIAL STUDIO  ·  nodes/bench/values.js — node values and the bench node shape
// ────────────────────────────────────────────────────────────────────────────
//  Merges node params over the def defaults, and converts a def plus its
//  values into the bench node shape (lib/bench-wgsl.js NODE SHAPE) and
//  the palette that fillUniform reads.
//
//  GREP TARGETS  (grep -n the name to jump)
//      withDefaults / nodeOf / paletteOf
// ============================================================================
import { BENCH_STATES, BENCH_PALETTE, hexToRgb } from '../../../../lib/bench-wgsl.js';
import { CAT } from './catalog.js';

/** Node params merged over the def defaults (arrays copied). */
export function withDefaults(def, values = {}) {
  const v = {};
  for (const p of def.params) v[p.id] = values[p.id] !== undefined ? values[p.id] : (Array.isArray(p.default) ? p.default.slice() : p.default);
  return v;
}
/** The bench node shape (lib/bench-wgsl.js NODE SHAPE) for a def and its values. */
export function nodeOf(def, v) {
  const B = def.bench;
  if (B.gen) {
    const Gk = CAT.GENERIC[B.gen];
    const n = { kind: B.gen, op: v.op, k: Gk.defaults.map((d, i) => (v['k' + i] !== undefined ? +v['k' + i] : d)), xk: [] };
    n.code = (v.code && v.code.trim()) ? v.code : CAT.templateCode(n);
    return n;
  }
  const L = CAT.LIBS[B.lib]; const cell = L.cells.find(c => c.name === B.cell);
  const n = { kind: B.lib, fn: B.cell, k: (cell.defaults || [0.5, 0.5, 0.5, 0.5]).map((d, i) => (v['k' + i] !== undefined ? +v['k' + i] : d)),
    xk: L.extras.map((e, j) => (v['x' + j] !== undefined ? +v['x' + j] : e.d)) };
  if (L.orb) { n.state = Math.max(0, BENCH_STATES.indexOf(v.state)); n.stateAt = 0; }
  n.code = (!L.sim && v.code && v.code.trim()) ? v.code : CAT.templateCode(n);
  return n;
}
export const paletteOf = v => ({ ink: hexToRgb(v.ink || BENCH_PALETTE.ink), tone: hexToRgb(v.tone || BENCH_PALETTE.tone), cream: hexToRgb(v.cream || BENCH_PALETTE.cream) });
