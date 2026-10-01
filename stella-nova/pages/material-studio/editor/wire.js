// ============================================================================
//  MATERIAL STUDIO  ·  editor/wire.js — wire edits and port matching
// ────────────────────────────────────────────────────────────────────────────
//  The graph edits that pointer gestures make on wires, through graph.js
//  actions (one undo step each). Also the port match that a wire drag and
//  a typed palette add use: which ports accept the wire, and which port is
//  best on one node.
//
//  GREP TARGETS
//      computeOkPorts ... "node\0port" keys that accept a wire from a source
//      bestPortOn ....... exact type first, then a free input
//      endWire .......... drop of a wire drag: connect, reconnect or palette
//      insertOnLink ..... drop a lone node on a wire: from -> node -> to
//      addReroute ....... reroute dot on a wire
// ============================================================================
import * as G from '../graph.js';
import { state } from '../store.js';
import { RR } from './state.js';
import { layout } from './layout.js';
import { openPalette } from './palette.js';

/** Ports that accept a wire from the drag source, keyed "node\0port". */
export function computeOkPorts(dir, srcNodeId, srcPort) {
  const g = state.graph, ok = new Set();
  for (const n of g.nodes) {
    if (n.id === srcNodeId) continue;
    const L = layout(n);
    if (dir === 'out') { for (const pid of L.ins.keys()) if (G.canLink(g, [srcNodeId, srcPort], [n.id, pid]).ok) ok.add(n.id + '\u0000' + pid); }
    else for (const pid of L.outs.keys()) if (G.canLink(g, [n.id, pid], [srcNodeId, srcPort]).ok) ok.add(n.id + '\u0000' + pid);
  }
  return ok;
}
/** Best port on node `n` for a wire of the drag (prefers the exact type, then a free input). */
export function bestPortOn(n, dir, type, okPorts) {
  const L = layout(n);
  const g = state.graph;
  const cands = [...(dir === 'out' ? L.ins : L.outs).entries()].filter(([pid]) => okPorts.has(n.id + '\u0000' + pid));
  if (!cands.length) return null;
  const free = pid => dir !== 'out' || !G.linkInto(g, [n.id, pid]);
  cands.sort(([a, pa], [b, pb]) => ((pb.port.type === type) - (pa.port.type === type)) * 2 + (free(b) - free(a)));
  return cands[0][0];
}

export function endWire(d, sx, sy, gx, gy) {
  const g = state.graph;
  if (d.target) {
    const [nid, pid] = d.target;
    const from = d.dir === 'out' ? d.src : [nid, pid];
    const to = d.dir === 'out' ? [nid, pid] : d.src;
    if (d.detached && d.detached.to[0] === to[0] && d.detached.to[1] === to[1] && d.detached.from[0] === from[0] && d.detached.from[1] === from[1]) {
      G.connect(g, from, to); G.queueChanged({ reason: 'edit', nodeIds: [to[0]] }); return; // dropped back where it was
    }
    G.actions.edit(d.detached ? 'Reconnect' : 'Connect', gg => G.connect(gg, from, to), { nodeIds: [to[0]] });
    return;
  }
  if (d.detached) { G.actions.commit('Disconnect'); return; }
  if (!d.moved) return;
  openPalette({ sx, sy, gx, gy, wire: { dir: d.dir, src: d.src, type: d.type } });
}

/** Drop a lone node onto a wire: wire.from -> node -> wire.to. */
export function insertOnLink(n, l) {
  const g = state.graph;
  const L = layout(n);
  const ft = G.portType(g, l.from[0], 'out', l.from[1]);
  const tt = G.portType(g, l.to[0], 'in', l.to[1]);
  const inP = [...L.ins.values()].sort((a, b) => (b.port.type === ft) - (a.port.type === ft)).find(p => G.typesCompatible(ft, p.port.type));
  const outP = [...L.outs.values()].sort((a, b) => (b.port.type === tt) - (a.port.type === tt)).find(p => G.typesCompatible(p.port.type, tt));
  if (!inP || !outP) { G.actions.edit('Move node', () => true, { kind: 'layout', nodeIds: [n.id] }); return; }
  G.actions.edit(`Insert ${L.def?.label || n.type}`, gg => {
    G.disconnect(gg, l.to);
    G.connect(gg, l.from, [n.id, inP.port.id]);
    G.connect(gg, [n.id, outP.port.id], l.to);
    return true;
  }, { nodeIds: [n.id, l.to[0]] });
}

export function addReroute(l, gx, gy) {
  G.actions.edit('Add reroute', gg => {
    const r = G.addNode(gg, G.REROUTE_TYPE, gx - RR / 2, gy - RR / 2);
    G.disconnect(gg, l.to);
    G.connect(gg, l.from, [r.id, 'in'], undefined, { force: true });
    G.connect(gg, [r.id, 'out'], l.to, undefined, { force: true });
    return r;
  }, { nodeIds: [l.to[0]] });
}
