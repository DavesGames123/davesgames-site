// ============================================================================
//  NEURON LAB ENGINE  ·  netplan.js  ·  the network mode without the DOM
// ----------------------------------------------------------------------------
//  The page (netmode.js), the saver and tests.mjs share these functions, so
//  the tests check what the page does. multicell.js is the simulator; this
//  file builds a MultiNet from the Randomize values or from the URL hash,
//  edits its connections, and tells the view where each spike is.
//
//    buildNet(o)        Randomize values (or a hash net) -> a wired MultiNet
//    applyPreset(net)   rewire with a preset (chain, ring, all, ff, ...)
//    cycleLink(net)     the matrix click: none -> E -> I -> none
//    editLinks(net)     one edit on many selected links at once
//    netState(net)      the hash part of the lab state (hashstate.js net)
//    flightsOf(conn, t) where each spike in flight is on its axon (0..1)
//    DEMOS              the saver set-ups: chain, ring, inhibition, random
//    kicker(kicks)      a per-step function that kicks cells on a schedule
//
//  Weights: a link keeps wx, its weight in multiples of THRESH_W of the
//  post type (I links twice that, as in multicell.js connect). A type
//  change keeps wx, so the edit "make these inhibitory" stays sensible.
//
//  grep -n targets
//    "export function buildNet"     specs, placement, wiring
//    "export function applyPreset"  presets through multicell wirePreset
//    "export function cycleLink"    matrix click
//    "export function editLinks"    multi-select edit
//    "export function netState"     hash state
//    "export function flightsOf"    spike positions on the axons
//    "export const DEMOS"           saver and demo set-ups
//    "export function kicker"       timed soma kicks
// ============================================================================
import { MultiNet, BUDGET, THRESH_W, SYN_DELAY, layoutPositions, wirePreset } from './multicell.js';
import { typeFor, morphFactors, TYPES } from './random.js';

export const SIGN_COL = { e: '#ffb347', i: '#7aa8ff' };

// wx of a link (its weight over the threshold weight of the post type)
export function wxOf(net, c) { return c.w / (THRESH_W[net.specs[c.post].type] * (c.ty === 'i' ? 2 : 1)); }

// o: { wire, morph, bio, seeds: { morph, wire }, phone, types, place, conns, velocity }
//   wire   Randomize 'wire' values: count, layout, preset, p, wE, wI, fracE, velocity
//   morph  Randomize 'morph' values (types mix and shape factors) or null
//   bio    Randomize 'bio' values (one set for every cell)
//   types  fixed cell types (from the hash); else from morph.types
//   place  fixed positions [[x, y, z] | null] (from the hash)
//   conns  fixed links [{ pre, post, ty, w, sec, x, d }] (from the hash)
export function buildNet(o) {
  const budget = o.phone ? BUDGET.phone : BUDGET.desktop;
  const w = o.wire, n = Math.max(2, Math.min(budget.cells, (o.types && o.types.length) || w.count | 0));
  const ms = (o.seeds && o.seeds.morph) || 1, ws = (o.seeds && o.seeds.wire) || 1;
  const specs = [];
  for (let i = 0; i < n; i++) {
    const type = o.types && TYPES.includes(o.types[i]) ? o.types[i] : o.morph ? typeFor(o.morph, i, ms) : 'pyramidal';
    specs.push({ type, seed: (ms * 7 + i * 131) % 9973 + 1, morph: o.morph ? morphFactors(o.morph, i, ms) : null, bio: o.bio });
  }
  const place = layoutPositions(n, w.layout, ws);
  if (o.place) o.place.forEach((p, i) => { if (p && i < n && p.length === 3 && p.every(Number.isFinite)) place[i].p = p.slice(); });
  const net = new MultiNet({ specs, place, budget, velocity: o.velocity ?? w.velocity, seed: ws });
  net.layout = w.layout; net.moved = new Array(n).fill(false);
  if (o.place) o.place.forEach((p, i) => { if (p && i < n) net.moved[i] = true; });
  net.sign = new Array(n).fill('e');
  if (o.conns) {
    for (const c of o.conns) if (c.pre < n && c.post < n && c.pre !== c.post) {
      const k = net.connect(c.pre, c.post, { ty: c.ty, w: c.w, sec: c.sec, x: c.x, delay: c.d });
      if (k && k.ty === 'i') net.sign[k.pre] = 'i';
    }
  } else applyPreset(net, w, ws);
  return net;
}

// Rewire net with w.preset. Keeps the cells.
export function applyPreset(net, w, seed = net.seed) {
  net.clearConns();
  const P = wirePreset(net.n, w.preset, { p: w.p, seed, fracE: w.fracE });
  net.sign = P.sign.slice();
  for (const c of P.conns) net.connect(c.pre, c.post, { ty: c.ty, wx: c.ty === 'i' ? w.wI : w.wE });
  return net;
}

// The matrix click on (pre, post): none -> E -> I -> none. Returns the new state.
export function cycleLink(net, pre, post, wx = { e: 2.5, i: 2 }) {
  if (pre === post) return 0;
  const c = net.conns.find(q => q.pre === pre && q.post === post);
  if (!c) { net.connect(pre, post, { ty: 'e', wx: wx.e }); return 1; }
  if (c.ty === 'e') { const x = wxOf(net, c); net.setType(c, 'i'); net.setWeight(c, x * THRESH_W[net.specs[post].type] * 2); return -1; }
  net.disconnect(c); return 0;
}

// One edit on many links. e: { ty, wx, delay ('auto' | ms), remove }
export function editLinks(net, links, e) {
  if (e.remove) { for (const c of links) net.disconnect(c); return []; }
  for (const c of links) {
    const x = e.wx ?? wxOf(net, c);
    if (e.ty && e.ty !== c.ty) net.setType(c, e.ty);
    net.setWeight(c, x * THRESH_W[net.specs[c.post].type] * (c.ty === 'i' ? 2 : 1));
    if (e.delay != null) { c.fixed = e.delay === 'auto' ? null : Math.max(SYN_DELAY, +e.delay); net.geometry(c); }
  }
  return links;
}

// The net part of the hash state (hashstate.js encodes it).
export function netState(net) {
  return {
    n: net.n, layout: net.layout || 'ring', vel: net.velocity, types: net.specs.map(s => s.type),
    conns: net.conns.map(c => ({ pre: c.pre, post: c.post, ty: c.ty, w: c.w, sec: c.sec, x: c.x, d: c.fixed ?? undefined })),
    pos: net.moved && net.moved.some(Boolean) ? net.place.map((q, i) => (net.moved[i] ? q.p.slice() : null)) : null,
  };
}

// Spikes in flight on one link at time t: the axon part of the delay
// (delay minus the synaptic delay) maps to 0..1 along the drawn curve.
// Returns [{ u, age }]; u >= 1 means the spike reached the synapse.
export function flightsOf(c, t, out = []) {
  out.length = 0;
  const travel = Math.max(0.05, c.delay - SYN_DELAY);
  for (const t0 of c.flights) { const u = (t - t0) / travel; if (u >= 0 && u <= 1.6) out.push({ u, age: t - t0 }); }
  return out;
}
// the point at fraction u of a polyline pts
export function pointOn(pts, u) {
  const k = Math.max(0, Math.min(pts.length - 1, u * (pts.length - 1))), i = Math.min(pts.length - 2, Math.floor(k)), f = k - i, a = pts[i], b = pts[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

// Saver and "Demo" set-ups: wire values plus which cells to kick and when.
// kick: [cell, every ms, first ms]
export const DEMOS = {
  chain: { title: 'A spike handed down a chain', wire: { count: 6, layout: 'line', preset: 'chain', p: 0.3, wE: 2.5, wI: 2, fracE: 0.8, velocity: 0.3 }, kick: [[0, 70, 2]], tex: 't_{k+1} = t_k + \\delta_{syn} + \\frac{\\ell_k}{\\theta} + t_{rise}' },
  ring: { title: 'A loop that keeps itself going', wire: { count: 6, layout: 'ring', preset: 'ring', p: 0.3, wE: 3, wI: 2, fracE: 0.8, velocity: 0.3 }, kick: [[0, 1e9, 2]], tex: 'T_{lap} = \\sum_k \\left(\\delta_{syn} + \\frac{\\ell_k}{\\theta} + t_{rise}\\right)' },
  inhibit: { title: 'Inhibition stops the wave', wire: { count: 7, layout: 'ring', preset: 'loop', p: 0.3, wE: 3, wI: 3, fracE: 0.8, velocity: 0.3 }, kick: [[0, 90, 2]], tex: 'I_{syn} = g(t)\\,(V - E_{GABA}),\\quad E_{GABA} = -75\\,\\mathrm{mV}' },
  ff: { title: 'Layers feeding forward', wire: { count: 8, layout: 'layer', preset: 'ff', p: 0.3, wE: 2, wI: 2, fracE: 0.8, velocity: 0.4 }, kick: [[0, 60, 2], [1, 60, 4]], tex: 'V_j \\leftarrow \\sum_i w_{ij}\\, g_i(t - d_{ij})' },
  ei: { title: 'Excitation and inhibition, Dale\'s law', wire: { count: 8, layout: 'cluster', preset: 'ei', p: 0.35, wE: 2.5, wI: 2.5, fracE: 0.75, velocity: 0.3 }, kick: [[0, 50, 2], [3, 80, 20]], tex: '\\mathrm{sign}(w_{ij}) = \\mathrm{sign}(i)' },
};

// kicks: [[cell, every ms, first ms]]. Returns f(net) to call after each
// step; it kicks each cell at first, then every 'every' ms.
export function kicker(kicks) {
  const next = kicks.map(k => k[2]);
  return net => {
    for (let q = 0; q < kicks.length; q++) if (net.t >= next[q] && kicks[q][0] < net.n) { net.kick(kicks[q][0]); next[q] += kicks[q][1]; }
  };
}
