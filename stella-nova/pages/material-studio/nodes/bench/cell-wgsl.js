// ============================================================================
//  MATERIAL STUDIO  ·  nodes/bench/cell-wgsl.js — WGSL module of a bench cell
// ────────────────────────────────────────────────────────────────────────────
//  The WGSL module that the runner compiles for a non-sim cell: the bench
//  module (CAT.moduleFor) with its in0/in1 reads sent through input hooks.
//
//  GREP TARGETS  (grep -n the name to jump)
//      RE_IN / hookInputs / cellSource
// ============================================================================
import { CAT } from './catalog.js';

// The bench reads its inputs with textureSampleLevel(in0|in1, smp, uv, lod).
// hookInputs routes those reads through bench_in0/bench_in1, which convert a
// studio uv coordinate into bench p space when b.pad > 0 (the coord scale).
export const RE_IN = /textureSampleLevel\(\s*(in0|in1)\s*,\s*smp\s*,/g;
function hookInputs(code, inputs) {
  const hooked = code.replace(RE_IN, (m, which) => `bench_${which}(`);
  const fn = (which, i) => {
    const ty = inputs[i] ? inputs[i].type : 'img';
    const conv = ty === 'coord'
      ? `select(t, vec4f(((t.xy * 2.0) - vec2f(1.0)) * b.pad, t.z, t.w), b.pad > 0.0)`
      : 't';
    return `fn bench_${which}(uv: vec2f, lod: f32) -> vec4f { let t = textureSampleLevel(${which}, smp, uv, lod); return ${conv}; }\n`;
  };
  return hooked + '\n// ── studio input hooks (nodes/bench.js hookInputs)\n' + fn('in0', 0) + fn('in1', 1);
}
/** The complete WGSL module of a non-sim node, as the bench assembles it plus the input hooks. */
export function cellSource(def, n) {
  return CAT.moduleFor(n, hookInputs(n.code, def.bench.inputs));
}
