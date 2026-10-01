// ============================================================================
//  MATERIAL STUDIO  ·  bake.js — run the compiled passes into MaterialMaps   [STUB]
// ────────────────────────────────────────────────────────────────────────────
//  Owner: COMPILER agent. Listens to graph:changed and res:changed, compiles,
//  bakes, sets state.maps and emits bake:start, then bake:done or bake:error.
// ============================================================================

/**
 * @param {import('./compile.js').CompiledGraph} compiled
 * @param {number} res  texels per side
 * @returns {Promise<import('./contract.js').MaterialMaps|null>}
 */
export async function bake(compiled, res) { return null; }

/** @param {object} ctx main.js module context */
export async function init(ctx) {}
