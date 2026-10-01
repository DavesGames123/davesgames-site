// ============================================================================
//  MATERIAL STUDIO  ·  export/graph-access.js — the graph and the scalars
// ────────────────────────────────────────────────────────────────────────────
//  The export reads the graph only through these functions. graphJSON
//  gives a copy of state.graph (graph.serialize when graph.js has it).
//  scalarsNow merges the material scalars in a fixed order. sanitize and
//  materialName give the file-safe name of the material.
//
//  GREP TARGETS
//      graphJSON  outputParams  scalarsNow  sanitize  materialName
// ============================================================================
import { DEFAULT_SCALARS, OUTPUT_TYPE } from '../contract.js';
import { C, S, UI } from './ctx.js';

export function graphJSON() {
  const g = S.graph;
  if (!g) return null;
  const ser = C?.modules?.graph?.serialize;
  try { return ser ? ser(g) : JSON.parse(JSON.stringify(g)); } catch (e) { return JSON.parse(JSON.stringify(g)); }
}
export function outputParams(gj = graphJSON()) {
  if (!gj) return {};
  const n = (gj.nodes || []).find(x => x.id === gj.output) || (gj.nodes || []).find(x => x.type === OUTPUT_TYPE);
  return (n && n.params) || {};
}
/** The material scalars: contract defaults < state.scalars < bake result < Output node params. */
export function scalarsNow(maps = S.maps) {
  const s = { ...DEFAULT_SCALARS, ...(S.scalars || {}), ...((maps && maps.scalars) || {}) };
  const p = outputParams();
  for (const k of Object.keys(DEFAULT_SCALARS)) if (p[k] !== undefined) s[k] = p[k];
  return s;
}
export const sanitize = s => (String(s || '').trim().replace(/[^A-Za-z0-9_\-]+/g, '_').replace(/^_+|_+$/g, '') || 'Material');
export function materialName() { return sanitize(UI.name?.value || graphJSON()?.name || 'Material'); }
