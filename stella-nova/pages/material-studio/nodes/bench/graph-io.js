// ============================================================================
//  MATERIAL STUDIO  ·  nodes/bench/graph-io.js — bench graph import, export and hand-off
// ────────────────────────────────────────────────────────────────────────────
//  Converts a Composition Bench graph JSON to a contract Graph and back.
//  openInBench hands the bench JSON to the bench page through localStorage.
//
//  GREP TARGETS  (grep -n the name to jump)
//      importBenchGraph
//      exportBenchGraph / openInBench
// ============================================================================
import { BENCH_STATES, BENCH_PALETTE } from '../../../../lib/bench-wgsl.js';
import { OUTPUT_TYPE, GRAPH_VERSION, DEFAULT_SETTINGS, validateGraph } from '../../contract.js';
import { BENCH_PAGE, BENCH_HANDOFF_KEY, CAT, GEN_KINDS, benchDef } from './catalog.js';
import { withDefaults } from './values.js';

/**
 * Convert a Composition Bench graph JSON (the bench "copy graph" format:
 * {nodes:[{id, kind, x, y, k, xk, fn, op, state, code?}], links:[{from, to, input}]},
 * optional palette {ink, tone, cream}) into a material graph (contract Graph).
 * Library nodes become bench.<lib>.<cell>, generic kinds bench.gen.<kind>,
 * and the bench output node becomes the Material Output. Image links use the
 * 'tex' output, coordinate links the 'uv' output. The node that fed the bench
 * output drives opts.wire (default ['baseColor']); pass for example
 * ['baseColor', 'height'] to also wire its value into height.
 * Needs loadBenchNodes() to have run (it does at boot).
 * @param {object|string} json
 * @param {{wire?:string[], idPrefix?:string, palette?:object, settings?:object}} [opts]
 * @returns {import('../../contract.js').Graph}
 */
export function importBenchGraph(json, opts = {}) {
  if (!CAT) throw new Error('bench catalog is not loaded yet');
  const g = typeof json === 'string' ? JSON.parse(json) : json;
  if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.links)) throw new Error('not a Composition Bench graph (needs nodes[] and links[])');
  const pre = opts.idPrefix || 'b';
  const palette = { ...BENCH_PALETTE, ...(g.palette || {}), ...(opts.palette || {}) };
  const out = { version: GRAPH_VERSION, nodes: [], links: [], frames: [], output: 'out', settings: { ...DEFAULT_SETTINGS, ...(opts.settings || {}) }, name: g.name || 'Composition Bench import' };
  const skipped = [];
  const map = new Map();   // bench id -> {id, def}
  let outNode = null;
  for (const bn of g.nodes) {
    if (bn.kind === 'output') { outNode = bn; continue; }
    let type;
    if (CAT.LIBS[bn.kind]) {
      const L = CAT.LIBS[bn.kind]; const fn = L.cells.some(c => c.name === bn.fn) ? bn.fn : L.cells[0].name;
      type = `bench.${bn.kind}.${fn}`;
    } else if (GEN_KINDS.includes(bn.kind)) type = `bench.gen.${bn.kind}`;
    const def = type && benchDef(type);
    if (!def) { skipped.push(bn.kind); continue; }
    const params = {};
    const k = Array.isArray(bn.k) ? bn.k : [];
    def.params.forEach(p => { if (/^k\d$/.test(p.id) && k[+p.id[1]] !== undefined) params[p.id] = +k[+p.id[1]]; });
    if (def.bench.lib) {
      const L = CAT.LIBS[def.bench.lib];
      if (Array.isArray(bn.xk) && bn.xk.length === L.extras.length) bn.xk.forEach((x, j) => { params['x' + j] = +x; });
      if (L.orb && bn.state != null) params.state = BENCH_STATES[bn.state | 0] || 'idle';
      params.ink = palette.ink; params.tone = palette.tone; params.cream = palette.cream;
    }
    if (def.bench.gen && bn.op && CAT.GENERIC[bn.kind].ops && bn.op in CAT.GENERIC[bn.kind].ops) params.op = bn.op;
    if (typeof bn.code === 'string' && bn.code.trim()) params.code = bn.code;
    const id = pre + bn.id;
    out.nodes.push({ id, type, x: +bn.x || 0, y: +bn.y || 0, params });
    map.set(bn.id, { id, def });
  }
  const ox = outNode ? +outNode.x || 0 : Math.max(0, ...out.nodes.map(n => n.x)) + 340;
  const oy = outNode ? +outNode.y || 0 : 0;
  out.nodes.push({ id: 'out', type: OUTPUT_TYPE, x: ox, y: oy, params: {} });
  const taken = new Set();
  for (const l of g.links) {
    const a = map.get(l.from);
    if (outNode && l.to === outNode.id) {
      if (!a) continue;
      const wires = opts.wire || ['baseColor'];
      for (const w of wires) {
        const fromPort = a.def.bench.out === 'coord' ? 'uv' : (w === 'baseColor' || w === 'emissive' ? 'color' : (w === 'normal' ? 'color' : 'value'));
        if (taken.has('out:' + w)) continue; taken.add('out:' + w);
        out.links.push({ from: [a.id, fromPort], to: ['out', w] });
      }
      continue;
    }
    const b = map.get(l.to); if (!a || !b) continue;
    const port = b.def.inputs.find(p => p.id === l.input); if (!port) continue;
    const key = b.id + ':' + port.id; if (taken.has(key)) continue; taken.add(key);
    out.links.push({ from: [a.id, a.def.bench.out === 'coord' ? 'uv' : 'tex'], to: [b.id, port.id] });
  }
  if (out.nodes.length > 1) {
    const xs = out.nodes.map(n => n.x), ys = out.nodes.map(n => n.y);
    const x0 = Math.min(...xs) - 40, y0 = Math.min(...ys) - 60;
    out.frames.push({ id: 'f_bench', label: 'Composition Bench import', x: x0, y: y0, w: Math.max(...xs) - x0 + 300, h: Math.max(...ys) - y0 + 360, color: '#5a8cc0' });
  }
  const check = validateGraph(out);
  if (!check.ok) throw new Error('bench import produced a bad graph: ' + check.errors.join('; '));
  out.importNotes = { skipped, nodes: out.nodes.length - 1, links: out.links.length };
  return out;
}

/**
 * Convert the bench nodes of a material graph into a Composition Bench graph
 * JSON. Links between bench nodes are kept. The bench output takes the node
 * that feeds Material Output baseColor (else emissive, else the last bench
 * node). Studio-only nodes are left out (the bench cannot run them).
 * @param {import('../../contract.js').Graph} graph
 * @returns {{nodes:object[], links:object[], palette:object, name:string, dropped:number}}
 */
export function exportBenchGraph(graph) {
  if (!graph || !Array.isArray(graph.nodes)) throw new Error('no graph');
  const ids = new Map(); const nodes = []; let next = 1; let dropped = 0; let palette = null;
  for (const gn of graph.nodes) {
    const def = benchDef(gn.type);
    if (!def) { if (gn.type !== OUTPUT_TYPE) dropped++; continue; }
    const v = withDefaults(def, gn.params || {});
    const id = next++; ids.set(gn.id, id);
    const B = def.bench; const bn = { id, kind: B.lib || B.gen, x: gn.x, y: gn.y };
    if (B.lib) {
      const L = CAT.LIBS[B.lib]; const cell = L.cells.find(c => c.name === B.cell);
      bn.fn = B.cell; bn.k = (cell.defaults || [0.5, 0.5, 0.5, 0.5]).map((dv, i) => (v['k' + i] !== undefined ? +v['k' + i] : dv));
      bn.xk = L.extras.map((e, j) => +v['x' + j]);
      if (L.orb) bn.state = Math.max(0, BENCH_STATES.indexOf(v.state));
      if (!palette) palette = { ink: v.ink, tone: v.tone, cream: v.cream };
    } else {
      const Gk = CAT.GENERIC[B.gen]; bn.op = v.op; bn.k = Gk.defaults.map((dv, i) => (v['k' + i] !== undefined ? +v['k' + i] : dv)); bn.xk = [];
    }
    if (v.code && String(v.code).trim()) bn.code = v.code;
    nodes.push(bn);
  }
  const links = [];
  for (const l of graph.links || []) {
    const a = ids.get(l.from[0]), b = ids.get(l.to[0]); if (!a || !b) continue;
    links.push({ from: a, to: b, input: l.to[1] });
  }
  const feed = ['baseColor', 'emissive'].map(w => (graph.links || []).find(l => l.to[0] === graph.output && l.to[1] === w && ids.has(l.from[0]))).find(Boolean);
  const src = feed ? ids.get(feed.from[0]) : (nodes.length ? nodes[nodes.length - 1].id : null);
  if (src) {
    const sx = nodes.find(n => n.id === src);
    const oid = next++; nodes.push({ id: oid, kind: 'output', x: Math.max(...nodes.map(n => n.x)) + 340, y: sx.y, k: [0.5, 0.5, 0.5, 0.5], xk: [] });
    links.push({ from: src, to: oid, input: 'img' });
  }
  return { nodes, links, palette: palette || { ...BENCH_PALETTE }, name: graph.name || 'Material Studio export', dropped };
}

/**
 * Hand a material graph to the Composition Bench page: the bench JSON goes
 * to localStorage (BENCH_HANDOFF_KEY) and the bench opens with #import in a
 * new tab, where it loads the graph once and clears the key.
 * @returns {{url:string, json:object}}
 */
export function openInBench(graph, opts = {}) {
  const json = exportBenchGraph(graph);
  if (!json.nodes.length) throw new Error('the graph has no Composition Bench nodes');
  try { localStorage.setItem(BENCH_HANDOFF_KEY, JSON.stringify(json)); } catch (e) { throw new Error('localStorage is blocked, so the graph cannot be handed to the bench'); }
  const url = BENCH_PAGE.href + '#import';
  if (opts.open !== false && typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
  return { url, json };
}
