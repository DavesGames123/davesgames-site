// ============================================================================
//  MATERIAL STUDIO  ·  graph.js — the graph model   [STUB]
// ────────────────────────────────────────────────────────────────────────────
//  Owner: GRAPH-EDITOR agent. The live graph and its edits. The stub keeps
//  the live graph as plain contract Graph JSON, which is enough to boot.
//  Every edit function changes the graph in place and returns its result;
//  the caller emits graph:changed and calls store.checkpoint.
// ============================================================================
import { emptyGraph, OUTPUT_TYPE } from './contract.js';

/** Make a live graph from contract Graph JSON (or a blank graph).
 *  @param {import('./contract.js').Graph} [json] @returns {any} live graph */
export function createGraph(json) { return deserialize(json || emptyGraph()); }

/** Live graph -> contract Graph JSON (a new plain object). */
export function serialize(graph) { return JSON.parse(JSON.stringify(graph)); }

/** Contract Graph JSON (object or string) -> live graph. */
export function deserialize(json) {
  const g = typeof json === 'string' ? JSON.parse(json) : JSON.parse(JSON.stringify(json));
  if (!g.output) g.output = (g.nodes.find(n => n.type === OUTPUT_TYPE) || {}).id;
  g.frames = g.frames || [];
  return g;
}

let seq = 1;
/** Add a node. @returns {object} the new GraphNode */
export function addNode(graph, type, x = 0, y = 0, params = {}) {
  let id; do { id = 'n' + seq++; } while (graph.nodes.some(n => n.id === id));
  const node = { id, type, x, y, params: { ...params } };
  graph.nodes.push(node);
  return node;
}

/** Remove a node and its links. The Material Output cannot be removed. @returns {boolean} */
export function removeNode(graph, id) {
  if (id === graph.output) return false;
  const i = graph.nodes.findIndex(n => n.id === id);
  if (i < 0) return false;
  graph.nodes.splice(i, 1);
  graph.links = graph.links.filter(l => l.from[0] !== id && l.to[0] !== id);
  return true;
}

/** Link [nodeId, outId] -> [nodeId, inId]. Replaces a link already on that input.
 *  @returns {import('./contract.js').Link} */
export function connect(graph, from, to) {
  disconnect(graph, to);
  const link = { from: [...from], to: [...to] };
  graph.links.push(link);
  return link;
}

/** Remove the link into input [nodeId, inId]. @returns {boolean} */
export function disconnect(graph, to) {
  const n = graph.links.length;
  graph.links = graph.links.filter(l => !(l.to[0] === to[0] && l.to[1] === to[1]));
  return graph.links.length !== n;
}

/** @param {object} ctx main.js module context */
export async function init(ctx) {
  ctx.store.setGraphIO({ serialize, deserialize });
}
