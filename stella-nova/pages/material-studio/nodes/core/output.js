// ============================================================================
//  MATERIAL STUDIO  ·  nodes/core/output.js — core library: output
// ────────────────────────────────────────────────────────────────────────────
//  The Material Output node: the graph sink. Each of its inputs bakes into
//  one channel of the PBR maps.
//
//  nodes/core.js imports this file for its side effect: each def() call
//  appends one NodeDef to the shared list in nodes/core/build.js.
//
//  GREP TARGETS  (grep -n the name)
//      def types .. OUTPUT_TYPE (the type id comes from contract.js)
// ============================================================================
import { OUTPUT_TYPE, MATERIAL_INPUTS, MATERIAL_PARAMS } from '../../contract.js';
import { def } from './build.js';

def(OUTPUT_TYPE, 'Material Output', 'Output',
  MATERIAL_INPUTS.map(({ id, label, type, default: d }) => ({ id, label, type, default: d })),
  [], MATERIAL_PARAMS.map(p => ({ ...p, uniform: false })), null,
  'The material: each input bakes into one channel of the PBR maps.', { tags: ['pbr', 'final', 'result'] });
