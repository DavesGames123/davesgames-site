// ============================================================================
//  MATERIAL STUDIO  ·  nodes/core/build.js — builders for the core node library
// ────────────────────────────────────────────────────────────────────────────
//  Every section file in nodes/core/ imports these builders and calls def()
//  once per node. def() puts each NodeDef on the shared `defs` array in call
//  order. nodes/core.js imports the section files in display order and
//  exports `defs` as NODES.
//
//  GREP TARGETS  (grep -n the name)
//      fP cP v2P v3P nP tP .. input port builders (float, color, vec2, vec3,
//                             normal, texture)
//      UVIN IN_C ............ shared input ports (uv, color "Input")
//      O .................... output port builder (optional swizzle)
//      S I E B K V SEED ..... param builders (slider, int, enum, bool, color,
//                             vec2) and the shared seed param
//      ix sd lp ............. enum index, seed expr, linked-or-param expr
//      def pass defs ........ NodeDef builder, pass body wrapper, def list
// ============================================================================

// ------------------------------------------------------------ ports
export const fP = (id, label, d = 0) => ({ id, label, type: 'float', default: d });
export const cP = (id, label, d = [0.5, 0.5, 0.5]) => ({ id, label, type: 'color', default: d });
export const v2P = (id, label, d = [0, 0]) => ({ id, label, type: 'vec2', default: d });
export const v3P = (id, label, d = [0, 0, 0]) => ({ id, label, type: 'vec3', default: d });
export const nP = (id, label) => ({ id, label, type: 'normal', default: [0, 0, 1] });
export const tP = (id, label) => ({ id, label, type: 'texture', default: [0, 0, 0, 1] });
export const UVIN = { id: 'uv', label: 'UV', type: 'vec2', default: 'uv' };
export const IN_C = cP('in', 'Input', [0.5, 0.5, 0.5]);
export const O = (id, label, type, swizzle) => (swizzle ? { id, label, type, swizzle } : { id, label, type });

// ------------------------------------------------------------ params
export const S = (id, label, min, max, d, step) => ({ id, label, kind: 'slider', min, max, step: step ?? (max - min > 20 ? 1 : 0.001), default: d });
export const I = (id, label, min, max, d) => ({ id, label, kind: 'int', min, max, step: 1, default: d });
export const E = (id, label, options, d) => ({ id, label, kind: 'enum', options, default: d ?? options[0] });
export const B = (id, label, d = false) => ({ id, label, kind: 'bool', default: d });
export const K = (id, label, d) => ({ id, label, kind: 'color', default: d });
export const V = (id, label, d, min = -1, max = 1) => ({ id, label, kind: 'vec2', min, max, step: 0.001, default: d });
export const SEED = I('seed', 'Seed', 0, 9999, 0);

// ------------------------------------------------------------ expr helpers
export const ix = (c, id, list) => Math.max(0, list.indexOf(c.values[id]));
export const sd = c => `(${c.seed} + ${c.params.seed})`;
/** Linked input or the param that stands in for it. */
export const lp = (c, inp, par) => (c.linked && c.linked[inp] ? c.inputs[inp] : c.params[par]);

// ------------------------------------------------------------ defs
/** @type {import('../../contract.js').NodeDef[]} */
export const defs = [];
export function def(type, label, category, inputs, outputs, params, body, doc, extra = {}) {
  const d = { type, label, category, inputs, outputs, params, doc, ...extra };
  if (typeof body === 'function') d.expr = body;
  else if (body && body.wgsl) d.pass = { inputsAsTextures: true, ...body };
  else if (body && body.expand) d.expand = body.expand;
  defs.push(d);
  return d;
}
export const pass = wgsl => ({ wgsl });
