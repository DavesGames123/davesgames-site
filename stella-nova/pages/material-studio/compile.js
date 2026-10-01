// ============================================================================
//  MATERIAL STUDIO  ·  compile.js — graph to WGSL passes   [STUB]
// ────────────────────────────────────────────────────────────────────────────
//  Owner: COMPILER agent. Fuses runs of expr nodes into one fragment shader
//  per pass; each pass node is a boundary that renders to its own texture.
// ============================================================================

/**
 * @typedef {Object} CompiledGraph
 * @property {Array<object>} passes  ordered render passes (shape owned by compile.js)
 * @property {Object<string,any>} outputs  MaterialMaps slot -> where its value comes from
 * @property {import('./contract.js').Scalars} scalars
 * @property {Array<{nodeId?:string, message:string}>} errors
 */

/**
 * @param {any} graph  live graph (graph.js)
 * @param {Map<string, import('./contract.js').NodeDef>} registry
 * @returns {CompiledGraph}
 */
export function compileGraph(graph, registry) {
  return { passes: [], outputs: {}, scalars: null, errors: [] };
}

/** @param {object} ctx main.js module context */
export async function init(ctx) {}
