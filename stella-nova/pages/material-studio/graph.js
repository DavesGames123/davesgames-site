// ============================================================================
//  MATERIAL STUDIO  ·  graph.js — the graph model and its edit actions
// ────────────────────────────────────────────────────────────────────────────
//  Owner: GRAPH-EDITOR agent. The live graph is plain contract Graph JSON
//  (contract.js Graph): state.graph.nodes, .links, .frames, .output,
//  .settings. Other modules can read it directly. This file has two layers.
//
//  1. PURE FUNCTIONS take the graph as the first argument, change it in
//     place and return a result. They do not emit events and do not touch
//     the undo history. The compiler, the presets and the tests use them.
//  2. ACTIONS (the `actions` object, also __studio.graph) run a pure function
//     on state.graph, then queue one debounced 'graph:changed' and call
//     store.checkpoint(label). The editor and the panels use them.
//
//  DATA FLOW
//      editor / panels ──actions.*──▶ pure fn on state.graph
//          ├─▶ queueChanged ─(16 ms debounce)─▶ emit 'graph:changed' ─▶ bake
//          ├─▶ emit 'graph:layout' (moves, frames, renames: no re-bake)
//          └─▶ store.checkpoint(label) ─▶ undo history (JSON snapshots)
//      store.undo / redo ─▶ deserialize(json) ─▶ new state.graph object
//
//  SECTIONS  (grep -n the name to jump)
//      REROUTE_TYPE / REROUTE_DEF . the pass-through reroute node
//      createGraph / serialize / deserialize   JSON in and out
//      nextId / nodeById / getNode / getDef  lookup helpers
//      nodePorts / portType ....... ports of a node, effective socket types
//      canLink / wouldCycle ....... typed link check, cycle prevention
//      addNode / removeNode(s) .... node edits (the output node is fixed)
//      dissolveNodes .............. remove nodes and keep the data path
//      connect / disconnect ....... link edits, one link per input
//      setParam / isUniformParam .. param edits
//      moveNodes / setNodeProps ... layout edits
//      copySubgraph / pasteSubgraph / duplicateNodes   clipboard
//      addFrame / removeFrames / frameNodes / fitFrame  frames (groups)
//      alignNodes / autoLayout .... arrangement
//      topoOrder / flattenReroutes / findIssues   helpers for the compiler
//      queueChanged / flushChanged  the debounced graph:changed
//      actions .................... stateful edits with events and undo
//      selfTest ................... 20-node build, connect, undo, redo
//      init ....................... registers IO, reroute def and the api
//
//  CONVENTIONS
//      Node ids are "n<k>", frame ids are "f<k>". The Material Output node
//      (contract OUTPUT_TYPE) is exactly one per graph: it cannot be removed,
//      duplicated or pasted. An input takes at most one link: connect()
//      replaces the old link. GraphNode.preview (optional boolean, false
//      hides the node thumbnail) is an editor field added to the JSON.
// ============================================================================
import {
  OUTPUT_TYPE, GRAPH_VERSION, DEFAULT_SETTINGS, emptyGraph, canConnect,
  PORT_DEFAULTS, MATERIAL_INPUTS,
} from './contract.js';
import { state, emit, on, checkpoint, setGraphIO, resetHistory, setRes, select, undo, redo, canUndo, canRedo } from './store.js';

// ------------------------------------------------------------ REROUTE_TYPE
/** Type id of the reroute (a dot that carries one wire). */
export const REROUTE_TYPE = 'utility.reroute';

/**
 * The reroute NodeDef. The socket type of a reroute is the type of the wire
 * that feeds it (see portType). For a compiler that does not know reroutes,
 * the def carries the value as a vec4 ('texture') through a plain expr. A
 * compiler that wants exact types calls flattenReroutes(json) first.
 * @type {import('./contract.js').NodeDef}
 */
export const REROUTE_DEF = Object.freeze({
  type: REROUTE_TYPE, label: 'Reroute', category: 'Utility',
  inputs: [{ id: 'in', label: 'In', type: 'texture' }],
  outputs: [{ id: 'out', label: 'Out', type: 'texture' }],
  params: [],
  expr: ctx => ({ out: ctx.inputs.in }),
  doc: 'A dot that routes one wire. It passes its input through unchanged.',
  tags: ['dot', 'wire', 'route', 'pass'],
  reroute: true,
  source: 'core',
});

const isReroute = n => !!n && n.type === REROUTE_TYPE;

// ------------------------------------------------------------ createGraph
/** Make a live graph from contract Graph JSON (or a blank graph).
 *  @param {import('./contract.js').Graph} [json] @returns {import('./contract.js').Graph} */
export function createGraph(json) { return deserialize(json || emptyGraph()); }

/** Live graph -> contract Graph JSON (a new plain object, no shared refs). */
export function serialize(graph) { return JSON.parse(JSON.stringify(graph)); }

/**
 * Contract Graph JSON (object or string) -> live graph. The result is a new
 * object. It repairs what it can: missing arrays, a missing or duplicate
 * Material Output, duplicate node ids, links to missing nodes and second
 * links into one input. It keeps nodes of unknown type (a library can load
 * later), so their links stay.
 */
export function deserialize(json) {
  const src = typeof json === 'string' ? JSON.parse(json) : json;
  const g = JSON.parse(JSON.stringify(src || emptyGraph()));
  g.version = GRAPH_VERSION;
  g.nodes = Array.isArray(g.nodes) ? g.nodes.filter(n => n && typeof n === 'object') : [];
  g.links = Array.isArray(g.links) ? g.links : [];
  g.frames = Array.isArray(g.frames) ? g.frames.filter(f => f && typeof f === 'object') : [];
  g.settings = { ...DEFAULT_SETTINGS, ...(g.settings || {}) };
  // node ids: unique strings
  const ids = new Set();
  for (const n of g.nodes) {
    if (typeof n.id !== 'string' || !n.id || ids.has(n.id)) n.id = freshId(ids, 'n');
    ids.add(n.id);
    n.x = Number.isFinite(+n.x) ? +n.x : 0;
    n.y = Number.isFinite(+n.y) ? +n.y : 0;
    if (!n.params || typeof n.params !== 'object') n.params = {};
  }
  // exactly one output node
  const outs = g.nodes.filter(n => n.type === OUTPUT_TYPE);
  if (!outs.find(n => n.id === g.output)) g.output = outs[0]?.id;
  if (!g.output) {
    const id = ids.has('out') ? freshId(ids, 'n') : 'out';
    ids.add(id);
    const maxX = g.nodes.reduce((m, n) => Math.max(m, n.x + 200), 600);
    g.nodes.push({ id, type: OUTPUT_TYPE, x: g.nodes.length ? maxX : 600, y: 120, params: {} });
    g.output = id;
  }
  g.nodes = g.nodes.filter(n => n.type !== OUTPUT_TYPE || n.id === g.output);
  const live = new Set(g.nodes.map(n => n.id));
  // links: endpoints exist, one per input
  const taken = new Set();
  g.links = g.links.filter(l => {
    if (!l || !Array.isArray(l.from) || !Array.isArray(l.to)) return false;
    if (!live.has(l.from[0]) || !live.has(l.to[0]) || l.from[0] === l.to[0]) return false;
    const k = l.to[0] + '\u0000' + l.to[1];
    if (taken.has(k)) return false;
    taken.add(k);
    l.from = [String(l.from[0]), String(l.from[1])];
    l.to = [String(l.to[0]), String(l.to[1])];
    return true;
  });
  const fids = new Set();
  for (const f of g.frames) {
    if (typeof f.id !== 'string' || fids.has(f.id)) f.id = freshId(fids, 'f');
    fids.add(f.id);
    for (const k of ['x', 'y', 'w', 'h']) f[k] = Number.isFinite(+f[k]) ? +f[k] : 0;
    f.w = Math.max(80, f.w); f.h = Math.max(50, f.h);
    if (typeof f.label !== 'string') f.label = 'Frame';
  }
  return g;
}

// ------------------------------------------------------------ nextId
function freshId(used, prefix) {
  let k = 1;
  for (const id of used) {
    const m = typeof id === 'string' && id.startsWith(prefix) ? /^\d+$/.exec(id.slice(prefix.length)) : null;
    if (m) k = Math.max(k, +m[0] + 1);
  }
  while (used.has(prefix + k)) k++;
  return prefix + k;
}

/** A node id (or frame id with prefix 'f') not used in the graph. */
export function nextId(graph, prefix = 'n') {
  const used = new Set(prefix === 'f' ? graph.frames.map(f => f.id) : graph.nodes.map(n => n.id));
  return freshId(used, prefix);
}

/** @returns {import('./contract.js').GraphNode|undefined} */
export function nodeById(graph, id) { return graph.nodes.find(n => n.id === id); }

/** Alias of nodeById (panels.js calls graph.getNode). */
export const getNode = (graph, id) => nodeById(graph, id);

/** The NodeDef of a type from state.registry (the reroute def as fallback). */
export function getDef(type, registry = state.registry) {
  return registry.get(type) || (type === REROUTE_TYPE ? REROUTE_DEF : undefined);
}

/** Links into a node, and links out of a node. */
export const linksInto = (graph, id) => graph.links.filter(l => l.to[0] === id);
export const linksFrom = (graph, id) => graph.links.filter(l => l.from[0] === id);
/** The link into input [nodeId, inId], or undefined. */
export const linkInto = (graph, to) => graph.links.find(l => l.to[0] === to[0] && l.to[1] === to[1]);

// ------------------------------------------------------------ nodePorts
/**
 * The ports of a node. For a type that is not in the registry (a missing
 * library) the ports come from the links that touch the node, with
 * type 'texture', so the wires still draw. `missing` is then true.
 * @returns {{inputs:import('./contract.js').PortDef[], outputs:import('./contract.js').PortDef[], missing:boolean}}
 */
export function nodePorts(graph, node, registry = state.registry) {
  const def = getDef(node.type, registry);
  if (def) return { inputs: def.inputs || [], outputs: def.outputs || [], missing: false };
  const ins = new Map(), outs = new Map();
  for (const l of graph.links) {
    if (l.to[0] === node.id) ins.set(l.to[1], { id: l.to[1], label: l.to[1], type: 'texture' });
    if (l.from[0] === node.id) outs.set(l.from[1], { id: l.from[1], label: l.from[1], type: 'texture' });
  }
  return { inputs: [...ins.values()], outputs: [...outs.values()], missing: true };
}

// ------------------------------------------------------------ portType
/**
 * The effective socket type of a port. A reroute takes the type of the wire
 * that feeds it (followed upstream). An unfed reroute is 'any'.
 * @param {'in'|'out'} side
 * @returns {string} a PORT_TYPES value, 'any', or null for no such port
 */
export function portType(graph, nodeId, side, portId, registry = state.registry, guard = 0) {
  const node = nodeById(graph, nodeId);
  if (!node) return null;
  if (isReroute(node)) {
    if (guard > 64) return 'any';
    const l = linkInto(graph, [nodeId, 'in']);
    return l ? portType(graph, l.from[0], 'out', l.from[1], registry, guard + 1) || 'any' : 'any';
  }
  const p = nodePorts(graph, node, registry)[side === 'in' ? 'inputs' : 'outputs'].find(q => q.id === portId);
  return p ? p.type : null;
}

/** The input types that a reroute feeds, followed downstream through reroutes. */
function rerouteSinkTypes(graph, nodeId, registry, out = [], seen = new Set()) {
  if (seen.has(nodeId)) return out;
  seen.add(nodeId);
  for (const l of linksFrom(graph, nodeId)) {
    const t = nodeById(graph, l.to[0]);
    if (isReroute(t)) rerouteSinkTypes(graph, t.id, registry, out, seen);
    else { const ty = portType(graph, l.to[0], 'in', l.to[1], registry); if (ty) out.push(ty); }
  }
  return out;
}

// ------------------------------------------------------------ canLink
/** True when a link from node `fromId` into node `toId` makes a cycle:
 *  that is, `fromId` is already downstream of `toId`. */
export function wouldCycle(graph, fromId, toId) {
  if (fromId === toId) return true;
  const down = new Map();
  for (const l of graph.links) {
    if (!down.has(l.from[0])) down.set(l.from[0], []);
    down.get(l.from[0]).push(l.to[0]);
  }
  const stack = [toId], seen = new Set();
  while (stack.length) {
    const id = stack.pop();
    if (id === fromId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const nx of down.get(id) || []) stack.push(nx);
  }
  return false;
}

/** Socket compatibility with the reroute wildcard 'any'. */
export function typesCompatible(from, to) {
  if (from === 'any' || to === 'any') return true;
  return canConnect(from, to);
}

/**
 * Check a link [fromNode, outId] -> [toNode, inId] before it is made.
 * @returns {{ok:boolean, reason:string, cast:boolean, fromType?:string, toType?:string}}
 *   cast is true when the link converts between two different types.
 */
export function canLink(graph, from, to, registry = state.registry) {
  const a = nodeById(graph, from[0]), b = nodeById(graph, to[0]);
  if (!a || !b) return { ok: false, reason: 'missing node', cast: false };
  if (a.id === b.id) return { ok: false, reason: 'a node cannot feed itself', cast: false };
  const ft = portType(graph, from[0], 'out', from[1], registry);
  const tt = portType(graph, to[0], 'in', to[1], registry);
  if (!ft) return { ok: false, reason: `no output ${from[1]}`, cast: false };
  if (!tt) return { ok: false, reason: `no input ${to[1]}`, cast: false };
  if (!typesCompatible(ft, tt)) return { ok: false, reason: `${ft} cannot feed ${tt}`, cast: false, fromType: ft, toType: tt };
  if (isReroute(b)) {
    for (const sink of rerouteSinkTypes(graph, b.id, registry)) {
      if (!typesCompatible(ft, sink)) return { ok: false, reason: `${ft} cannot feed ${sink} after the reroute`, cast: false, fromType: ft, toType: tt };
    }
  }
  if (wouldCycle(graph, a.id, b.id)) return { ok: false, reason: 'the link makes a cycle', cast: false, fromType: ft, toType: tt };
  return { ok: true, reason: '', cast: ft !== tt && ft !== 'any' && tt !== 'any', fromType: ft, toType: tt };
}

// ------------------------------------------------------------ addNode
/** Default param values of a def (deep copies). */
export function defaultParams(def) {
  const p = {};
  for (const d of def?.params || []) p[d.id] = d.default === undefined ? null : JSON.parse(JSON.stringify(d.default));
  return p;
}

/**
 * Add a node. Missing params get their defaults. A second Material Output
 * is refused (returns null).
 * @returns {import('./contract.js').GraphNode|null} the new node
 */
export function addNode(graph, type, x = 0, y = 0, params = {}, registry = state.registry) {
  if (type === OUTPUT_TYPE && graph.nodes.some(n => n.type === OUTPUT_TYPE)) return null;
  const def = getDef(type, registry);
  const node = { id: nextId(graph), type, x: Math.round(x), y: Math.round(y), params: { ...defaultParams(def), ...JSON.parse(JSON.stringify(params || {})) } };
  graph.nodes.push(node);
  if (type === OUTPUT_TYPE) graph.output = node.id;
  return node;
}

/** Remove a node and its links. The Material Output cannot be removed. @returns {boolean} */
export function removeNode(graph, id) { return removeNodes(graph, [id]).length > 0; }

/** Remove nodes and their links. @returns {string[]} the ids removed */
export function removeNodes(graph, ids) {
  const kill = new Set([...ids].filter(id => id !== graph.output && nodeById(graph, id)));
  if (!kill.size) return [];
  graph.nodes = graph.nodes.filter(n => !kill.has(n.id));
  graph.links = graph.links.filter(l => !kill.has(l.from[0]) && !kill.has(l.to[0]));
  return [...kill];
}

// ------------------------------------------------------------ dissolveNodes
/**
 * Remove nodes but keep the data path: for each removed node, the wire that
 * fed its first linked input goes on to each target that its outputs fed,
 * when the types are compatible. @returns {string[]} the ids removed
 */
export function dissolveNodes(graph, ids, registry = state.registry) {
  const kill = new Set([...ids].filter(id => id !== graph.output && nodeById(graph, id)));
  if (!kill.size) return [];
  // resolve the upstream source of each killed node, through other killed nodes
  const srcOf = (id, guard = 0) => {
    if (guard > 64) return null;
    const node = nodeById(graph, id);
    const ports = nodePorts(graph, node, registry);
    for (const p of ports.inputs) {
      const l = linkInto(graph, [id, p.id]);
      if (!l) continue;
      return kill.has(l.from[0]) ? srcOf(l.from[0], guard + 1) : l.from;
    }
    return null;
  };
  const reconnect = [];
  for (const l of graph.links) {
    if (!kill.has(l.from[0]) || kill.has(l.to[0])) continue;
    const s = srcOf(l.from[0]);
    if (s) reconnect.push({ from: s, to: l.to });
  }
  removeNodes(graph, kill);
  for (const r of reconnect) if (canLink(graph, r.from, r.to, registry).ok) connect(graph, r.from, r.to, registry);
  return [...kill];
}

// ------------------------------------------------------------ connect
/**
 * Link [nodeId, outId] -> [nodeId, inId]. It replaces a link already on that
 * input. It refuses a link that canLink rejects (wrong types or a cycle),
 * unless opts.force is true.
 * @returns {import('./contract.js').Link|null}
 */
export function connect(graph, from, to, registry = state.registry, opts = {}) {
  if (registry && !(registry instanceof Map)) { opts = registry; registry = state.registry; }
  if (!opts.force) {
    const chk = canLink(graph, from, to, registry);
    if (!chk.ok) return null;
  }
  disconnect(graph, to);
  const link = { from: [String(from[0]), String(from[1])], to: [String(to[0]), String(to[1])] };
  graph.links.push(link);
  return link;
}

/** Remove the link into input [nodeId, inId]. @returns {boolean} */
export function disconnect(graph, to) {
  const n = graph.links.length;
  graph.links = graph.links.filter(l => !(l.to[0] === to[0] && l.to[1] === to[1]));
  return graph.links.length !== n;
}

/** Remove every link that touches a node. @returns {number} links removed */
export function disconnectNode(graph, id) {
  const n = graph.links.length;
  graph.links = graph.links.filter(l => l.from[0] !== id && l.to[0] !== id);
  return n - graph.links.length;
}

/** Remove the links in a list (matched by their endpoints). @returns {number} */
export function removeLinks(graph, links) {
  const key = l => l.from.join('\u0000') + '\u0001' + l.to.join('\u0000');
  const kill = new Set(links.map(key));
  const n = graph.links.length;
  graph.links = graph.links.filter(l => !kill.has(key(l)));
  return n - graph.links.length;
}

// ------------------------------------------------------------ setParam
/** True when a change of this param needs no recompile (uniform-fed kinds). */
export function isUniformParam(def, pid) {
  const p = def?.params?.find(q => q.id === pid);
  if (!p) return false;
  if (p.uniform === false) return false;
  return ['slider', 'int', 'color', 'vec2', 'bool'].includes(p.kind);
}

/** Set one param. @returns {boolean} true when the value changed */
export function setParam(graph, nodeId, pid, value) {
  const n = nodeById(graph, nodeId);
  if (!n) return false;
  const old = n.params[pid];
  if (JSON.stringify(old) === JSON.stringify(value)) return false;
  n.params[pid] = value === undefined ? value : JSON.parse(JSON.stringify(value));
  return true;
}

// ------------------------------------------------------------ moveNodes
/** Move nodes by (dx, dy). Snap: round the result to a grid step. */
export function moveNodes(graph, ids, dx, dy, snap = 0) {
  const set = new Set(ids);
  for (const n of graph.nodes) {
    if (!set.has(n.id)) continue;
    n.x += dx; n.y += dy;
    if (snap > 0) { n.x = Math.round(n.x / snap) * snap; n.y = Math.round(n.y / snap) * snap; }
  }
}

/** Set node positions from a map id -> [x, y]. */
export function placeNodes(graph, pos) {
  for (const n of graph.nodes) if (pos[n.id]) { n.x = Math.round(pos[n.id][0]); n.y = Math.round(pos[n.id][1]); }
}

/** Set label / collapsed / preview on nodes. A null value deletes the field. */
export function setNodeProps(graph, ids, props) {
  const set = new Set(ids);
  for (const n of graph.nodes) {
    if (!set.has(n.id)) continue;
    for (const [k, v] of Object.entries(props)) {
      if (!['label', 'collapsed', 'preview'].includes(k)) continue;
      if (v === null || v === undefined || v === '') delete n[k]; else n[k] = v;
    }
  }
}

// ------------------------------------------------------------ copySubgraph
export const CLIP_KIND = 'material-studio/subgraph';

/**
 * Copy nodes, the links between them and the given frames into a clip.
 * The Material Output node is left out.
 * @returns {{kind:string, version:1, nodes:object[], links:object[], frames:object[], origin:[number,number]}}
 */
export function copySubgraph(graph, ids, frameIds = []) {
  const set = new Set([...ids].filter(id => id !== graph.output));
  const nodes = graph.nodes.filter(n => set.has(n.id)).map(n => JSON.parse(JSON.stringify(n)));
  const links = graph.links.filter(l => set.has(l.from[0]) && set.has(l.to[0])).map(l => JSON.parse(JSON.stringify(l)));
  const fset = new Set(frameIds);
  const frames = graph.frames.filter(f => fset.has(f.id)).map(f => ({ ...f }));
  const xs = [...nodes.map(n => n.x), ...frames.map(f => f.x)], ys = [...nodes.map(n => n.y), ...frames.map(f => f.y)];
  return { kind: CLIP_KIND, version: 1, nodes, links, frames, origin: [xs.length ? Math.min(...xs) : 0, ys.length ? Math.min(...ys) : 0] };
}

/** Make a clip from any accepted source: a clip, or a full Graph JSON. */
export function toClip(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.kind === CLIP_KIND && Array.isArray(data.nodes)) return data;
  if (Array.isArray(data.nodes) && Array.isArray(data.links)) {
    const g = deserialize(data);
    return copySubgraph(g, g.nodes.map(n => n.id), g.frames.map(f => f.id));
  }
  return null;
}

/**
 * Paste a clip so that its top-left goes to (x, y). New ids are made; links
 * and frames are remapped. A clip node of OUTPUT_TYPE is skipped.
 * @returns {{nodeIds:string[], frameIds:string[], map:Object<string,string>}}
 */
export function pasteSubgraph(graph, clip, x, y, registry = state.registry) {
  clip = toClip(clip);
  if (!clip) return { nodeIds: [], frameIds: [], map: {} };
  const [ox, oy] = clip.origin || [0, 0];
  const dx = x - ox, dy = y - oy;
  const used = new Set(graph.nodes.map(n => n.id));
  const map = {}, nodeIds = [];
  for (const n of clip.nodes) {
    if (n.type === OUTPUT_TYPE) continue;
    const id = freshId(used, 'n'); used.add(id);
    map[n.id] = id;
    const c = JSON.parse(JSON.stringify(n));
    c.id = id; c.x = Math.round(n.x + dx); c.y = Math.round(n.y + dy);
    if (!c.params) c.params = {};
    graph.nodes.push(c);
    nodeIds.push(id);
  }
  for (const l of clip.links || []) {
    const a = map[l.from[0]], b = map[l.to[0]];
    if (a && b) connect(graph, [a, l.from[1]], [b, l.to[1]], registry, { force: true });
  }
  const fused = new Set(graph.frames.map(f => f.id)), frameIds = [];
  for (const f of clip.frames || []) {
    const id = freshId(fused, 'f'); fused.add(id);
    graph.frames.push({ ...f, id, x: Math.round(f.x + dx), y: Math.round(f.y + dy) });
    frameIds.push(id);
  }
  return { nodeIds, frameIds, map };
}

/**
 * Duplicate nodes (offset by dx, dy). With keepInputs, links from outside
 * the set into the copies are made too. @returns {string[]} new node ids
 */
export function duplicateNodes(graph, ids, dx = 30, dy = 30, keepInputs = false, registry = state.registry) {
  const clip = copySubgraph(graph, ids);
  const { nodeIds, map } = pasteSubgraph(graph, clip, clip.origin[0] + dx, clip.origin[1] + dy, registry);
  if (keepInputs) {
    const set = new Set(ids);
    for (const l of [...graph.links]) {
      if (set.has(l.to[0]) && !set.has(l.from[0]) && map[l.to[0]]) connect(graph, l.from, [map[l.to[0]], l.to[1]], registry, { force: true });
    }
  }
  return nodeIds;
}

// ------------------------------------------------------------ addFrame
export const FRAME_COLORS = Object.freeze(['#5a8cc0', '#64c864', '#ffc832', '#ff9a4a', '#ff6a6a', '#b090ff', '#7ad0c0', '#8090b0']);

/** Add a frame. @returns {import('./contract.js').Frame} */
export function addFrame(graph, rect, label = 'Frame', color) {
  const f = {
    id: nextId(graph, 'f'), label,
    x: Math.round(rect.x), y: Math.round(rect.y),
    w: Math.max(80, Math.round(rect.w)), h: Math.max(50, Math.round(rect.h)),
  };
  if (color) f.color = color;
  graph.frames.push(f);
  return f;
}

/** Remove frames (the nodes inside stay). @returns {string[]} */
export function removeFrames(graph, ids) {
  const set = new Set(ids);
  const gone = graph.frames.filter(f => set.has(f.id)).map(f => f.id);
  graph.frames = graph.frames.filter(f => !set.has(f.id));
  return gone;
}

/** Change frame fields (label, color, x, y, w, h). */
export function setFrameProps(graph, id, props) {
  const f = graph.frames.find(q => q.id === id);
  if (!f) return false;
  for (const [k, v] of Object.entries(props)) {
    if (!['label', 'color', 'x', 'y', 'w', 'h'].includes(k)) continue;
    if (v === null || v === undefined) delete f[k]; else f[k] = typeof v === 'number' ? Math.round(v) : v;
  }
  f.w = Math.max(80, f.w); f.h = Math.max(50, f.h);
  return true;
}

/** Default node size estimate (the editor passes its exact measure). */
export function estimateSize(graph, node, registry = state.registry) {
  if (isReroute(node)) return { w: 14, h: 14 };
  const p = nodePorts(graph, node, registry);
  if (node.collapsed) return { w: 168, h: 20 };
  return { w: node.type === OUTPUT_TYPE ? 180 : 168, h: 24 + 18 * (p.inputs.length + p.outputs.length) + (node.type === OUTPUT_TYPE ? 0 : 88) };
}

/** Ids of the nodes whose top-left corner lies inside the frame. */
export function frameNodes(graph, frameId) {
  const f = graph.frames.find(q => q.id === frameId);
  if (!f) return [];
  return graph.nodes.filter(n => n.x >= f.x && n.y >= f.y + 4 && n.x < f.x + f.w && n.y < f.y + f.h).map(n => n.id);
}

/** Resize a frame around node ids (or its own nodes). */
export function fitFrame(graph, frameId, ids, sizeOf, pad = 24) {
  const f = graph.frames.find(q => q.id === frameId);
  if (!f) return false;
  const b = bounds(graph, ids || frameNodes(graph, frameId), sizeOf);
  if (!b) return false;
  Object.assign(f, { x: Math.round(b.x - pad), y: Math.round(b.y - pad - 22), w: Math.round(b.w + pad * 2), h: Math.round(b.h + pad * 2 + 22) });
  return true;
}

/** Bounding box of nodes. @returns {{x,y,w,h}|null} */
export function bounds(graph, ids, sizeOf) {
  sizeOf = sizeOf || (n => estimateSize(graph, n));
  const set = ids ? new Set(ids) : null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of graph.nodes) {
    if (set && !set.has(n.id)) continue;
    const s = sizeOf(n);
    x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x + s.w); y1 = Math.max(y1, n.y + s.h);
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ------------------------------------------------------------ alignNodes
export const ALIGN_MODES = Object.freeze(['left', 'centerX', 'right', 'top', 'centerY', 'bottom', 'distributeX', 'distributeY', 'stackY']);

/**
 * Align or distribute nodes. sizeOf(node) -> {w, h}.
 * @param {string} mode one of ALIGN_MODES
 */
export function alignNodes(graph, ids, mode, sizeOf, gap = 24) {
  sizeOf = sizeOf || (n => estimateSize(graph, n));
  const set = new Set(ids);
  const ns = graph.nodes.filter(n => set.has(n.id));
  if (ns.length < 2) return false;
  const S = new Map(ns.map(n => [n.id, sizeOf(n)]));
  const b = bounds(graph, ids, sizeOf);
  if (mode === 'left') ns.forEach(n => { n.x = b.x; });
  else if (mode === 'right') ns.forEach(n => { n.x = b.x + b.w - S.get(n.id).w; });
  else if (mode === 'centerX') ns.forEach(n => { n.x = Math.round(b.x + b.w / 2 - S.get(n.id).w / 2); });
  else if (mode === 'top') ns.forEach(n => { n.y = b.y; });
  else if (mode === 'bottom') ns.forEach(n => { n.y = b.y + b.h - S.get(n.id).h; });
  else if (mode === 'centerY') ns.forEach(n => { n.y = Math.round(b.y + b.h / 2 - S.get(n.id).h / 2); });
  else if (mode === 'distributeX' || mode === 'distributeY') {
    const ax = mode === 'distributeX' ? 'x' : 'y', dim = ax === 'x' ? 'w' : 'h';
    const sorted = [...ns].sort((p, q) => p[ax] - q[ax]);
    const total = sorted.reduce((s, n) => s + S.get(n.id)[dim], 0);
    const span = (ax === 'x' ? b.w : b.h);
    const step = Math.max(0, (span - total) / (sorted.length - 1));
    let c = ax === 'x' ? b.x : b.y;
    for (const n of sorted) { n[ax] = Math.round(c); c += S.get(n.id)[dim] + step; }
  } else if (mode === 'stackY') {
    const sorted = [...ns].sort((p, q) => p.y - q.y);
    let c = b.y;
    for (const n of sorted) { n.x = b.x; n.y = Math.round(c); c += S.get(n.id).h + gap; }
  } else return false;
  return true;
}

// ------------------------------------------------------------ autoLayout
/**
 * Arrange nodes in columns by their distance from the sinks (the Material
 * Output and nodes with no consumer). Column 0 is on the right. The order in
 * a column follows the mean y of the consumers. The right edge and the top
 * of the set stay where they were.
 * @param {string[]} [ids] the nodes to arrange (default: all)
 * @returns {Object<string,[number,number]>} the new positions
 */
export function autoLayout(graph, ids, sizeOf, opts = {}) {
  sizeOf = sizeOf || (n => estimateSize(graph, n));
  const colGap = opts.colGap ?? 60, rowGap = opts.rowGap ?? 22;
  const set = new Set(ids && ids.length ? ids : graph.nodes.map(n => n.id));
  const ns = graph.nodes.filter(n => set.has(n.id));
  if (!ns.length) return {};
  const b = bounds(graph, [...set], sizeOf);
  const consumers = new Map(ns.map(n => [n.id, []]));
  for (const l of graph.links) if (set.has(l.from[0]) && set.has(l.to[0]) && l.from[0] !== l.to[0]) consumers.get(l.from[0]).push(l.to[0]);
  const depth = new Map(), busy = new Set();
  const dfs = id => {
    if (depth.has(id)) return depth.get(id);
    if (busy.has(id)) return 0;
    busy.add(id);
    let d = 0;
    for (const c of consumers.get(id) || []) d = Math.max(d, dfs(c) + 1);
    busy.delete(id);
    depth.set(id, d);
    return d;
  };
  ns.forEach(n => dfs(n.id));
  const cols = [];
  for (const n of ns) (cols[depth.get(n.id)] ||= []).push(n);
  const colW = cols.map(c => Math.max(...(c || []).map(n => sizeOf(n).w), 0));
  const right = b.x + b.w;
  const pos = {};
  let x = right;
  for (let d = 0; d < cols.length; d++) {
    const col = cols[d] || [];
    x -= colW[d];
    if (d === 0) col.sort((p, q) => p.y - q.y);
    else {
      const key = n => {
        const cs = consumers.get(n.id).filter(c => pos[c]);
        return cs.length ? cs.reduce((s, c) => s + pos[c][1], 0) / cs.length : n.y;
      };
      const k = new Map(col.map(n => [n.id, key(n)]));
      col.sort((p, q) => k.get(p.id) - k.get(q.id));
    }
    let y = b.y;
    for (const n of col) {
      pos[n.id] = [x + (colW[d] - sizeOf(n).w), y];
      y += sizeOf(n).h + rowGap;
    }
    x -= colGap;
  }
  placeNodes(graph, pos);
  return pos;
}

// ------------------------------------------------------------ topoOrder
/** Node ids upstream first. Nodes on a cycle (bad JSON) come last. */
export function topoOrder(graph) {
  const indeg = new Map(graph.nodes.map(n => [n.id, 0]));
  const down = new Map(graph.nodes.map(n => [n.id, []]));
  for (const l of graph.links) {
    if (!indeg.has(l.to[0]) || !down.has(l.from[0])) continue;
    indeg.set(l.to[0], indeg.get(l.to[0]) + 1);
    down.get(l.from[0]).push(l.to[0]);
  }
  const q = [...indeg].filter(([, d]) => d === 0).map(([id]) => id), out = [];
  while (q.length) {
    const id = q.shift(); out.push(id);
    for (const nx of down.get(id)) { indeg.set(nx, indeg.get(nx) - 1); if (indeg.get(nx) === 0) q.push(nx); }
  }
  for (const n of graph.nodes) if (!out.includes(n.id)) out.push(n.id);
  return out;
}

/** Ids of the nodes that feed the Material Output (directly or not). */
export function liveNodes(graph) {
  const up = new Map();
  for (const l of graph.links) { if (!up.has(l.to[0])) up.set(l.to[0], []); up.get(l.to[0]).push(l.from[0]); }
  const seen = new Set(), stack = graph.output ? [graph.output] : [];
  while (stack.length) { const id = stack.pop(); if (seen.has(id)) continue; seen.add(id); for (const u of up.get(id) || []) stack.push(u); }
  return seen;
}

/**
 * Graph JSON with every reroute removed: each link out of a reroute is
 * reattached to the source that feeds the reroute. Links out of an unfed
 * reroute are dropped. Returns a new object.
 */
export function flattenReroutes(json) {
  const g = JSON.parse(JSON.stringify(json));
  const rr = new Set(g.nodes.filter(isReroute).map(n => n.id));
  if (!rr.size) return g;
  const feed = new Map();
  for (const l of g.links) if (rr.has(l.to[0])) feed.set(l.to[0], l.from);
  const src = (id, guard = 0) => {
    const f = feed.get(id);
    if (!f || guard > 64) return null;
    return rr.has(f[0]) ? src(f[0], guard + 1) : f;
  };
  const links = [];
  for (const l of g.links) {
    if (rr.has(l.to[0])) continue;
    if (rr.has(l.from[0])) { const s = src(l.from[0]); if (s) links.push({ from: [...s], to: l.to }); }
    else links.push(l);
  }
  g.links = links;
  g.nodes = g.nodes.filter(n => !rr.has(n.id));
  return g;
}

/**
 * Problems in a graph: unknown node types, links between incompatible
 * types, links to missing ports, cycles.
 * @returns {Array<{nodeId?:string, level:'error'|'warn', message:string}>}
 */
export function findIssues(graph, registry = state.registry) {
  const out = [];
  for (const n of graph.nodes) if (!getDef(n.type, registry)) out.push({ nodeId: n.id, level: 'error', message: `unknown node type ${n.type}` });
  for (const l of graph.links) {
    const ft = portType(graph, l.from[0], 'out', l.from[1], registry), tt = portType(graph, l.to[0], 'in', l.to[1], registry);
    if (!ft || !tt) out.push({ nodeId: l.to[0], level: 'warn', message: `link ${l.from.join('.')} -> ${l.to.join('.')} has a missing port` });
    else if (!typesCompatible(ft, tt)) out.push({ nodeId: l.to[0], level: 'error', message: `${ft} cannot feed ${tt} (${l.to.join('.')})` });
  }
  const order = topoOrder(graph);
  const pos = new Map(order.map((id, i) => [id, i]));
  for (const l of graph.links) if (pos.get(l.from[0]) > pos.get(l.to[0])) { out.push({ nodeId: l.to[0], level: 'error', message: 'cycle' }); break; }
  return out;
}

// ------------------------------------------------------------ queueChanged
const DEBOUNCE_MS = 16;
let pending = null, timer = 0;

/**
 * Queue one graph:changed. Calls inside one debounce window merge: the reason
 * is 'edit' when any call was an edit, nodeIds join, and paramOnly stays
 * true only when every call was paramOnly.
 * @param {{reason?:string, nodeIds?:string[], paramOnly?:boolean}} info
 */
export function queueChanged(info = {}) {
  const reason = info.reason || 'edit';
  const rank = { param: 0, edit: 1, load: 2 };
  if (!pending) pending = { reason, nodeIds: new Set(), paramOnly: !!info.paramOnly };
  else {
    if ((rank[reason] ?? 1) > (rank[pending.reason] ?? 1)) pending.reason = reason;
    pending.paramOnly = pending.paramOnly && !!info.paramOnly;
  }
  for (const id of info.nodeIds || []) pending.nodeIds.add(id);
  clearTimeout(timer);
  timer = setTimeout(flushChanged, DEBOUNCE_MS);
}

/** Emit the queued graph:changed now. @returns {boolean} true when one was queued */
export function flushChanged() {
  clearTimeout(timer);
  if (!pending) return false;
  const p = pending; pending = null;
  emit('graph:changed', { reason: p.reason, nodeIds: [...p.nodeIds], paramOnly: p.paramOnly });
  return true;
}

// ------------------------------------------------------------ actions
/**
 * Run `fn(state.graph)` as one undoable edit.
 *   opts.kind  'edit' (default, topology) | 'param' | 'layout'
 *              'layout' emits 'graph:layout' and no graph:changed (no bake).
 *   opts.nodeIds   the nodes the edit touched (for graph:changed)
 *   opts.paramOnly for kind 'param'
 *   opts.merge     undo merge key (one drag = one step)
 *   opts.checkpoint false: no undo step now (call actions.commit later)
 * If fn returns false (or null / an empty array), nothing is emitted.
 */
export function edit(label, fn, opts = {}) {
  const g = state.graph;
  if (!g) return null;
  const r = fn(g);
  if (r === false || r === null || (Array.isArray(r) && r.length === 0)) return r;
  const kind = opts.kind || 'edit';
  if (kind === 'layout') emit('graph:layout', { reason: label, nodeIds: opts.nodeIds || [] });
  else queueChanged({ reason: kind === 'param' ? 'param' : 'edit', nodeIds: opts.nodeIds, paramOnly: kind === 'param' && !!opts.paramOnly });
  if (opts.checkpoint !== false) checkpoint(label, opts.merge ? { merge: opts.merge } : {});
  return r;
}

const reg = () => state.registry;
const defLabel = type => getDef(type)?.label || type;

/** Stateful graph edits on state.graph, each one undo step. Also __studio.graph. */
export const actions = {
  get graph() { return state.graph; },
  edit, flush: flushChanged, queueChanged,
  /** Add a node. @returns {object|null} the node */
  add(type, x, y, params, opts = {}) {
    return edit(opts.label || `Add ${defLabel(type)}`, g => addNode(g, type, x, y, params), { nodeIds: [], ...opts });
  },
  /** Remove nodes (and frames, opts.frames). @returns {string[]} */
  remove(ids, opts = {}) {
    return edit(opts.label || (ids.length === 1 ? `Delete ${defLabel(nodeById(state.graph, ids[0])?.type)}` : `Delete ${ids.length} nodes`), g => {
      const gone = removeNodes(g, ids);
      const fr = removeFrames(g, opts.frames || []);
      return gone.length || fr.length ? [...gone, ...fr] : false;
    }, { nodeIds: ids });
  },
  /** Remove nodes and keep the wire through them. */
  dissolve(ids) { return edit(`Dissolve ${ids.length} node${ids.length === 1 ? '' : 's'}`, g => dissolveNodes(g, ids), { nodeIds: ids }); },
  /** Link from [node, out] to [node, in]. @returns {object|null} the link */
  connect(from, to) { return edit('Connect', g => connect(g, from, to), { nodeIds: [to[0]] }); },
  /** Remove the link into [node, in]. */
  disconnect(to) { return edit('Disconnect', g => disconnect(g, to), { nodeIds: [to[0]] }); },
  /** Remove a list of links (knife cut). */
  cutLinks(links) { return edit(`Cut ${links.length} link${links.length === 1 ? '' : 's'}`, g => removeLinks(g, links) || false, { nodeIds: links.map(l => l.to[0]) }); },
  /** Remove every link of a node. */
  disconnectNode(id) { return edit('Disconnect node', g => disconnectNode(g, id) || false, { nodeIds: [id] }); },
  /**
   * Set a param. opts.merge (default `${id}.${pid}`) merges a drag into one
   * undo step; opts.checkpoint false skips the undo step (commit later).
   */
  setParam(id, pid, value, opts = {}) {
    const node = nodeById(state.graph, id);
    if (!node) return false;
    const def = getDef(node.type);
    const pdef = def?.params?.find(p => p.id === pid);
    return edit(opts.label || `Set ${pdef?.label || pid}`, g => setParam(g, id, pid, value), {
      kind: 'param', paramOnly: isUniformParam(def, pid), nodeIds: [id],
      merge: opts.merge === undefined ? `param:${id}.${pid}` : opts.merge, checkpoint: opts.checkpoint,
    });
  },
  /** Set several params of one node in one step. */
  setParams(id, values, opts = {}) {
    const node = nodeById(state.graph, id);
    if (!node) return false;
    const def = getDef(node.type);
    const uni = Object.keys(values).every(pid => isUniformParam(def, pid));
    return edit(opts.label || 'Set params', g => Object.entries(values).map(([k, v]) => setParam(g, id, k, v)).some(Boolean), {
      kind: 'param', paramOnly: uni, nodeIds: [id], merge: opts.merge, checkpoint: opts.checkpoint,
    });
  },
  /** Move nodes (and frames: opts.frames). */
  move(ids, dx, dy, opts = {}) {
    return edit(opts.label || 'Move', g => {
      moveNodes(g, ids, dx, dy, opts.snap || 0);
      for (const f of g.frames) if ((opts.frames || []).includes(f.id)) { f.x += dx; f.y += dy; }
      return true;
    }, { kind: 'layout', nodeIds: ids, checkpoint: opts.checkpoint, merge: opts.merge });
  },
  /** Record an undo step for edits made with checkpoint:false (end of a drag). */
  commit(label, opts = {}) { if (state.graph) checkpoint(label, opts.merge ? { merge: opts.merge } : {}); },
  rename(id, label) { return edit('Rename', g => (setNodeProps(g, [id], { label }), true), { kind: 'layout', nodeIds: [id] }); },
  setCollapsed(ids, collapsed) { return edit(collapsed ? 'Collapse' : 'Expand', g => (setNodeProps(g, ids, { collapsed: collapsed || null }), true), { kind: 'layout', nodeIds: ids }); },
  setPreview(ids, on) { return edit(on ? 'Show preview' : 'Hide preview', g => (setNodeProps(g, ids, { preview: on ? null : false }), true), { kind: 'layout', nodeIds: ids }); },
  /** Copy to a clip object (no state change). */
  copy(ids, frameIds) { return copySubgraph(state.graph, ids, frameIds); },
  /** Paste a clip at (x, y). @returns {{nodeIds, frameIds}} */
  paste(clip, x, y) {
    return edit('Paste', g => { const r = pasteSubgraph(g, clip, x, y); return r.nodeIds.length || r.frameIds.length ? r : false; }, {});
  },
  duplicate(ids, dx = 30, dy = 30, keepInputs = false) {
    return edit(`Duplicate ${ids.length} node${ids.length === 1 ? '' : 's'}`, g => duplicateNodes(g, ids, dx, dy, keepInputs), {});
  },
  addFrame(rect, label, color) { return edit('Add frame', g => addFrame(g, rect, label, color), { kind: 'layout' }); },
  /** Frame around node ids. sizeOf from the editor. */
  frameNodes(ids, sizeOf, label = 'Frame') {
    const b = bounds(state.graph, ids, sizeOf);
    if (!b) return null;
    return actions.addFrame({ x: b.x - 24, y: b.y - 46, w: b.w + 48, h: b.h + 70 }, label);
  },
  setFrame(id, props, opts = {}) { return edit(opts.label || 'Edit frame', g => setFrameProps(g, id, props), { kind: 'layout', checkpoint: opts.checkpoint, merge: opts.merge }); },
  removeFrames(ids) { return edit('Delete frame', g => removeFrames(g, ids), { kind: 'layout' }); },
  align(ids, mode, sizeOf) { return edit(`Align ${mode}`, g => alignNodes(g, ids, mode, sizeOf), { kind: 'layout', nodeIds: ids }); },
  autoLayout(ids, sizeOf) { return edit('Auto layout', g => { const p = autoLayout(g, ids, sizeOf); return Object.keys(p).length ? p : false; }, { kind: 'layout', nodeIds: ids }); },
  /**
   * Replace the whole graph (file import, preset, bench import). The JSON is
   * repaired by deserialize. opts.resetHistory (default true) forgets undo;
   * false makes the load one undo step. Emits graph:changed {reason:'load'}.
   */
  load(json, opts = {}) {
    const g = deserialize(json);
    flushChanged();
    state.graph = g;
    if (g.settings?.res && g.settings.res !== state.settings.res) setRes(g.settings.res);
    Object.assign(state.settings, { tiling: g.settings.tiling, seed: g.settings.seed });
    select([]);
    if (opts.resetHistory === false) checkpoint(opts.label || 'Load graph');
    else resetHistory();
    emit('graph:changed', { reason: 'load', nodeIds: [] });
    return g;
  },
  /** The live graph as contract JSON. */
  toJSON() { return serialize(state.graph); },
  canLink: (from, to) => canLink(state.graph, from, to),
  portType: (id, side, port) => portType(state.graph, id, side, port),
  issues: () => findIssues(state.graph),
  undo, redo, canUndo, canRedo,
  selfTest,
};

// ------------------------------------------------------------ selfTest
/**
 * Build a 20-node graph on a scratch state.graph, connect it, check that a
 * cycle and a bad type are refused, undo every step and redo every step, and
 * check copy/paste, dissolve and serialize round trips. It puts the old graph
 * back after, and resets the undo history (the old history is lost).
 * @returns {Promise<{ok:boolean, checks:Object<string,boolean>, detail:Object}>}
 */
export async function selfTest() {
  const saved = state.graph ? serialize(state.graph) : null;
  const checks = {}, detail = {};
  const keepSel = [...state.selection];
  try {
    state.graph = createGraph();
    resetHistory();
    const g0 = JSON.stringify(serialize(state.graph));
    const R = state.registry;
    // value-like nodes: no inputs, one float or color output
    const sources = [...R.values()].filter(d => !d.pass && (d.inputs || []).length === 0 && (d.outputs || []).some(o => o.type === 'float' || o.type === 'color')).map(d => d.type);
    const srcType = sources[0] || REROUTE_TYPE;
    const ids = [];
    for (let i = 0; i < 12; i++) ids.push(actions.add(srcType, 40 + (i % 3) * 190, 40 + Math.floor(i / 3) * 130).id);
    for (let i = 0; i < 7; i++) ids.push(actions.add(REROUTE_TYPE, 420, 40 + i * 50).id);
    const steps = 19;
    checks.nodes20 = state.graph.nodes.length === 20;
    // chain: src0 -> r0 -> r1 -> ... -> r6 -> out.roughness
    const out = state.graph.output, rr = ids.slice(12);
    const srcOut = getDef(srcType)?.outputs?.[0]?.id || 'out';
    let links = 0;
    if (actions.connect([ids[0], srcOut], [rr[0], 'in'])) links++;
    for (let i = 1; i < rr.length; i++) if (actions.connect([rr[i - 1], 'out'], [rr[i], 'in'])) links++;
    if (actions.connect([rr[rr.length - 1], 'out'], [out, 'roughness'])) links++;
    for (let i = 1; i < 11; i++) {
      const inp = MATERIAL_INPUTS[i]; if (inp.id === 'roughness' || inp.id === 'normal') continue;
      if (actions.connect([ids[i], srcOut], [out, inp.id])) links++;
    }
    detail.links = links;
    checks.linked = state.graph.links.length === links && links >= 15;
    checks.reroutePort = portType(state.graph, rr[6], 'out', 'out') === portType(state.graph, ids[0], 'out', srcOut);
    // cycle: r6 -> r0 is refused
    const before = state.graph.links.length;
    checks.cycleRefused = actions.connect([rr[6], 'out'], [rr[0], 'in']) === null && state.graph.links.length === before;
    // replace: a second link into out.roughness replaces the old one
    const srcT = portType(state.graph, ids[0], 'out', srcOut);
    checks.typedNormal = canLink(state.graph, [ids[1], srcOut], [out, 'normal']).ok === typesCompatible(srcT, 'normal');
    const mid = JSON.stringify(serialize(state.graph));
    const nSteps = steps + links;
    let u = 0; while (undo()) u++;
    detail.undone = u;
    checks.undoAll = u === nSteps && JSON.stringify(serialize(state.graph)) === g0;
    let r = 0; while (redo()) r++;
    detail.redone = r;
    checks.redoAll = r === nSteps && JSON.stringify(serialize(state.graph)) === mid;
    // copy / paste: 3 reroutes with 2 internal links
    const clip = actions.copy(rr.slice(0, 3));
    const pasted = actions.paste(clip, 900, 600);
    checks.paste = pasted.nodeIds.length === 3 && state.graph.links.filter(l => pasted.nodeIds.includes(l.to[0])).length === 2;
    // dissolve r3: r2 -> r4 keeps the path
    actions.dissolve([rr[3]]);
    checks.dissolve = !!linkInto(state.graph, [rr[4], 'in']) && linkInto(state.graph, [rr[4], 'in']).from[0] === rr[2];
    // output node is fixed
    checks.outputFixed = actions.remove([out]) === false || nodeById(state.graph, out) !== undefined;
    checks.roundTrip = JSON.stringify(serialize(deserialize(serialize(state.graph)))) === JSON.stringify(serialize(state.graph));
    checks.flatten = flattenReroutes(serialize(state.graph)).nodes.every(n => n.type !== REROUTE_TYPE);
    flushChanged();
  } catch (e) {
    checks.threw = false; detail.error = String(e && e.stack || e);
  } finally {
    flushChanged();
    state.graph = saved ? deserialize(saved) : createGraph();
    resetHistory();
    select(keepSel.filter(id => nodeById(state.graph, id)));
    emit('graph:changed', { reason: 'load', nodeIds: [] });
  }
  return { ok: Object.values(checks).every(Boolean), checks, detail };
}

// ------------------------------------------------------------ init
/** @param {object} ctx main.js module context */
export async function init(ctx) {
  setGraphIO({ serialize, deserialize });
  if (!state.registry.has(REROUTE_TYPE)) ctx.registerNodes([REROUTE_DEF], 'core');
  // a load / undo / redo replaces the graph: drop a queued edit event
  on('graph:changed', p => { if (p && p.reason !== 'edit' && p.reason !== 'param' && pending) { clearTimeout(timer); pending = null; } });
  on('res:changed', ({ res }) => { if (state.graph?.settings) state.graph.settings.res = res; });
  ctx.register('graph', actions);
}
