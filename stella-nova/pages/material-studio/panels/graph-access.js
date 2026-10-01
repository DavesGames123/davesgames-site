// ============================================================================
//  MATERIAL STUDIO  ·  panels/graph-access.js — read and write the live graph
// ────────────────────────────────────────────────────────────────────────────
//  Every graph read and write of the panels goes through this module.
//  When graph.js has an action (M.graph.actions or a helper), it uses it.
//  Otherwise it edits state.graph and emits graph:changed itself.
//  queueEdit merges param edits: one graph:changed per frame, and one
//  undo step per gesture (the merge key holds the gesture session).
//  selfEmit is above zero while this module emits, so init() can tell
//  its own edits from edits that come from other modules.
//
//  GREP TARGETS
//      GA graph nodesOf linksOf getNode defOf outputNode nodeLabel paramVal
//      UNIFORM_KINDS catColor selfEmit pending flushRaf queueEdit flushEdit
//      writeParam commitParam editDone loadGraph serializeGraph
// ============================================================================
import { OUTPUT_TYPE, validateGraph, emptyGraph } from '../contract.js';
import { store, state, M } from './ctx.js';
import { clone } from './util.js';

/** graph.js stateful actions (one undo step each), when graph.js has them. */
export const GA = () => M.graph?.actions || null;
export const graph = () => state.graph;
export const nodesOf = () => (graph() && graph().nodes) || [];
export const linksOf = () => (graph() && graph().links) || [];
export function getNode(id) {
  const g = graph(); if (!g || id == null) return null;
  if (typeof M.graph?.getNode === 'function') { try { const n = M.graph.getNode(g, id); if (n) return n; } catch (e) { /* fall back */ } }
  return (g.nodes || []).find(n => n.id === id) || null;
}
export const defOf = n => n && state.registry.get(n.type);
export const outputNode = () => getNode(graph()?.output) || nodesOf().find(n => n.type === OUTPUT_TYPE) || null;
export const nodeLabel = n => (n && (n.label || defOf(n)?.label || n.type)) || '?';
export const paramVal = (n, p) => { const v = n.params ? n.params[p.id] : undefined; return v === undefined ? clone(p.default) : v; };
const UNIFORM_KINDS = new Set(['slider', 'int', 'color', 'vec2', 'bool']);
export const catColor = cat => {
  const map = { Output: '#ffc832', Input: '#96c8ff', Generator: '#64c864', Noise: '#7ad0c0', Pattern: '#5ab0a0', Math: '#a0a8b8', Vector: '#96c8ff', Color: '#ffc832', Adjust: '#ff9a4a', Blend: '#e08ad0', Filter: '#b090ff', 'Height & Normal': '#b090ff', Transform: '#7ad0c0', Utility: '#8090b0', Bench: '#ff8a5c' };
  return map[cat] || '#8090b0';
};

/** Coalesced edit: one graph:changed per frame, one undo step per gesture. */
export let selfEmit = 0, pending = null, flushRaf = 0;
export function queueEdit(ids, paramOnly, label, merge, final) {
  if (!pending) pending = { ids: new Set(), paramOnly: true, label, merge };
  ids.forEach(i => pending.ids.add(i));
  pending.paramOnly = pending.paramOnly && paramOnly;
  pending.label = label; pending.merge = merge;
  if (final) flushEdit(); else if (!flushRaf) flushRaf = requestAnimationFrame(flushEdit);
}
function flushEdit() {
  if (flushRaf) { cancelAnimationFrame(flushRaf); flushRaf = 0; }
  const p = pending; pending = null; if (!p) return;
  selfEmit++;
  try { store.emit('graph:changed', { reason: 'param', nodeIds: [...p.ids], paramOnly: p.paramOnly }); }
  finally { selfEmit--; }
  store.checkpoint(p.label, p.merge ? { merge: p.merge } : {});
}
export function writeParam(n, pid, v) {
  if (typeof M.graph?.setParam === 'function') { try { M.graph.setParam(graph(), n.id, pid, clone(v)); return; } catch (e) { /* fall back */ } }
  n.params = n.params || {}; n.params[pid] = clone(v);
}
/** Write param p of every node in `nodes` and queue the edit. */
export function commitParam(nodes, p, v, final, session) {
  for (const n of nodes) writeParam(n, p.id, v);
  const ids = nodes.map(n => n.id);
  const paramOnly = p.uniform !== false && UNIFORM_KINDS.has(p.kind);
  queueEdit(ids, paramOnly, `${p.label || p.id}`, `p:${ids.join(',')}:${p.id}:${session}`, final);
}
export function editDone(label, ids = [], reason = 'edit') {
  selfEmit++;
  try { store.emit('graph:changed', { reason, nodeIds: ids }); } finally { selfEmit--; }
  store.checkpoint(label);
}


/** Replace the live graph with contract Graph JSON. One undo step. */
export function loadGraph(json, label = 'Load graph', { keepRes = false } = {}) {
  const v = validateGraph(json, state.registry);
  if (!v.ok) {
    const structural = v.errors.filter(e => !/^unknown node type/.test(e));
    if (structural.length) { store.toast('Graph not loaded: ' + structural.slice(0, 3).join('; '), 'error'); return false; }
    store.toast(`${v.errors.length} unknown node type(s): ${v.errors.slice(0, 2).join('; ')}`, 'warn', 6000);
  }
  const j = clone(json);
  j.settings = { ...state.settings, ...(j.settings || {}) };
  if (keepRes) j.settings.res = state.settings.res;
  if (typeof GA()?.load === 'function') { GA().load(j, { resetHistory: false, label }); return true; }
  state.graph = typeof M.graph?.deserialize === 'function' ? M.graph.deserialize(j) : j;
  state.settings.tiling = j.settings.tiling ?? 1;
  state.settings.seed = j.settings.seed ?? 0;
  store.select([]);
  if (!keepRes && j.settings.res && j.settings.res !== state.settings.res) store.setRes(j.settings.res);
  store.emit('graph:changed', { reason: 'load' });
  store.checkpoint(label);
  return true;
}
export function serializeGraph() {
  const g = graph(); if (!g) return emptyGraph();
  const j = typeof M.graph?.serialize === 'function' ? M.graph.serialize(g) : clone(g);
  return typeof j === 'string' ? JSON.parse(j) : j;
}
