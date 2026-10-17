// ============================================================================
//  TENSOR CALCULUS  ·  viz/trace-map.js  ·  which scene plays a step  (VIZ)
// ----------------------------------------------------------------------------
//  DOM-free. play(step, t) in viz/index.js asks stepScene(step) for the
//  scene and its params. MATH writes step.viz.scene with the LIBRARY ids
//  of library/scenes.js; toViz() there gives the VIZ id. A hint that names
//  a geometric scene is used. A step of a block kind (product, contract,
//  trace, symmetrize, ...) with a hint to a block scene gets the block
//  scene of its own kind, because one trace has one hint for all its
//  steps. With no usable hint, the step kind picks the scene:
//      product ............................ outer-product
//      contract, trace .................... contraction
//      raise, lower ....................... upper-lower (the metric morph)
//      transform .......................... transform-rank2 for rank 2,
//                                           upper-lower for rank 1
//      christoffel, partial, covariant .... christoffel
//      every other kind ................... components (before -> after)
//  The scene reads step.numeric (Components) itself, so the numbers on
//  screen are the numbers of the trace.
//
//  EXPORTS   stepScene(step, known) -> { scene, params }
//            rankOf(components) -> number
// ============================================================================

import { toViz } from '../library/scenes.js';

const BLOCK_SCENES = new Set(['outer-product', 'contraction', 'rank3-cube', 'components']);
const BLOCK_KINDS = new Set(['product', 'contract', 'trace', 'symmetrize', 'antisymmetrize', 'expandSum', 'relabel', 'evaluate', 'substitute']);

export const rankOf = c => (c && Array.isArray(c.shape) ? c.shape.length : 0);

export function stepScene(step, known = null) {
  const has = id => !known || (Array.isArray(known) ? known.includes(id) : !!known[id]);
  if (!step) return { scene: 'components', params: {} };
  let hint = step.viz && step.viz.scene ? step.viz : null;
  if (hint) { try { hint = toViz(hint) || hint; } catch (e) { /* keep the raw hint */ } }
  if (hint && has(hint.scene) && !(BLOCK_SCENES.has(hint.scene) && BLOCK_KINDS.has(step.kind))) return { scene: hint.scene, params: { ...(hint.params || {}) } };
  if (hint && has(hint.scene) && hint.scene === 'rank3-cube' && step.kind === 'relabel') return { scene: 'components', params: {} };
  const out = step.numeric && step.numeric.output;
  switch (step.kind) {
    case 'product': return { scene: 'outer-product', params: {} };
    case 'contract': case 'trace': return { scene: 'contraction', params: {} };
    case 'raise': case 'lower': return { scene: 'upper-lower', params: {} };
    case 'transform': return rankOf(out) === 1 ? { scene: 'upper-lower', params: {} } : { scene: 'transform-rank2', params: {} };
    case 'christoffel': case 'partial': case 'covariant': return { scene: 'christoffel', params: {} };
    default: return { scene: 'components', params: {} };
  }
}
