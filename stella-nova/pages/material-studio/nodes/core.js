// ============================================================================
//  MATERIAL STUDIO  ·  nodes/core.js — the built-in node library   [STUB]
// ────────────────────────────────────────────────────────────────────────────
//  Owner: COMPILER agent. Exports NODES, an array of contract NodeDef.
//  main.js puts each def on state.registry under its type before any init.
//  This stub holds only the Material Output node and two input nodes, so the
//  page boots end to end. Replace the whole file.
// ============================================================================
import { OUTPUT_TYPE, MATERIAL_INPUTS, MATERIAL_PARAMS } from '../contract.js';

/** @type {import('../contract.js').NodeDef[]} */
export const NODES = [
  {
    type: OUTPUT_TYPE, label: 'Material Output', category: 'Output',
    inputs: MATERIAL_INPUTS.map(({ id, label, type, default: d }) => ({ id, label, type, default: d })),
    outputs: [], params: MATERIAL_PARAMS.map(p => ({ ...p })),
    doc: 'The material: each input bakes into one channel of the PBR maps.',
  },
  {
    type: 'input.value', label: 'Value', category: 'Input', inputs: [],
    outputs: [{ id: 'out', label: 'Value', type: 'float' }],
    params: [{ id: 'v', label: 'Value', kind: 'slider', min: 0, max: 1, step: 0.001, default: 0.5 }],
    expr: ctx => ({ out: ctx.params.v }),
    doc: 'A constant number.',
  },
  {
    type: 'input.color', label: 'Color', category: 'Input', inputs: [],
    outputs: [{ id: 'out', label: 'Color', type: 'color' }],
    params: [{ id: 'c', label: 'Color', kind: 'color', default: '#b0b0b0' }],
    expr: ctx => ({ out: ctx.params.c }),
    doc: 'A constant color (sRGB picker, linear output).',
  },
];

/** @param {object} ctx main.js module context */
export async function init(ctx) {}
