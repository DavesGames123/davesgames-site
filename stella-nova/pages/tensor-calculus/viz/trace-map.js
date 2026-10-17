// ============================================================================
//  TENSOR CALCULUS  ·  viz/trace-map.js  ·  which scene plays a step  (VIZ)
// ----------------------------------------------------------------------------
//  DOM-free. play(step, t) in viz/index.js asks stepScene(step) for the
//  scene and its params. A step with a viz hint ({ scene, params }) that
//  names a known scene uses it. Otherwise the step kind picks the scene:
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

export const rankOf = c => (c && Array.isArray(c.shape) ? c.shape.length : 0);

export function stepScene(step, known = null) {
  const has = id => !known || (Array.isArray(known) ? known.includes(id) : !!known[id]);
  if (!step) return { scene: 'components', params: {} };
  if (step.viz && step.viz.scene && has(step.viz.scene)) return { scene: step.viz.scene, params: { ...(step.viz.params || {}) } };
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
