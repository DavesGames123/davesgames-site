// ============================================================================
//  MATERIAL STUDIO  ·  nodes/bench.js — Composition Bench cells as nodes   [STUB]
// ────────────────────────────────────────────────────────────────────────────
//  Owner: BENCH agent. Turns each Composition Bench library cell
//  (composition-bench/libs/index.json + libs/<key>.json) into a pass NodeDef
//  of type "bench.<lib>.<cell>", with WGSL assembly from ../../lib/bench-wgsl.js.
// ============================================================================

/**
 * Build the bench NodeDefs. main.js calls this once before module init and
 * adds the result to state.registry.
 * @returns {Promise<import('../contract.js').NodeDef[]>}
 */
export async function loadBenchNodes() { return []; }

/**
 * Convert a Composition Bench graph JSON (its export format) into a material
 * graph (contract Graph JSON), with bench nodes wired to a Material Output.
 * @param {object} json  a Composition Bench graph
 * @returns {import('../contract.js').Graph}
 */
export function importBenchGraph(json) { throw new Error('importBenchGraph is not implemented yet'); }

/** @param {object} ctx main.js module context */
export async function init(ctx) {}
