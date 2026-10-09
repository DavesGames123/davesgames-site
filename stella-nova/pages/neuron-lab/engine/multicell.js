// ============================================================================
//  NEURON LAB ENGINE  ·  multicell.js  ·  2 to 12 full cells and their NetCons
// ----------------------------------------------------------------------------
//  The Lab's network mode runs this file. Each cell is a full branched
//  cable (cell.js, the same Hines step as one cell). All cells step at the
//  same t. A connection is what a NEURON user writes by hand:
//      syn = Exp2Syn(post.dend(x)); nc = NetCon(pre.soma(0.5)._ref_v, syn)
//      nc.threshold = -10; nc.delay = delay; nc.weight[0] = w
//  The NetCon watches the presynaptic soma and sends the event to the
//  postsynaptic cell's queue (cell.js sendAt). E synapses are AMPA-like
//  (tau1 0.2, tau2 2 ms, e 0 mV); I synapses are GABA_A-like (0.5, 8 ms,
//  e -75 mV).
//
//  The axon of a connection is drawn as a cubic curve from the axon
//  hillock of the presynaptic cell to the synapse. Its length over the
//  conduction velocity, plus a 0.5 ms synaptic delay, is the NetCon delay,
//  unless the connection has a fixed delay.
//
//  Real-time budget: the sum of compartments over all cells stays under
//  BUDGET.comps. chooseDlambda picks the finest d_lambda that fits, so
//  each cell gets fewer segments as the count grows. Phones get fewer
//  cells and fewer compartments.
//
//  Cells keep their own coordinates; place[i] = { p, yaw } puts cell i in
//  the world (a turn about y, then a shift).
//
//  grep -n targets
//    "export const BUDGET"          cell and compartment limits
//    "export const THRESH_W"        the E weight that just fires each type
//    "export function chooseDlambda" the compartment budget
//    "export function layoutPositions" line, ring, layer, cluster
//    "export function wirePreset"    chain, ring, all, ff, random, ei, loop
//    "export function axonCurve"     the drawn axon and its length
//    "export class MultiNet"         build, connect, kick, step
//    "export function matrixOf"      the connectivity matrix
// ============================================================================
import { Cell, dLambdaNseg, exp2Factor } from './cell.js';
import { makeCell } from './morph.js';
import { rng } from './rng.js';
import { cellOpts, stdStimulus, BASE_AMP } from './random.js';

export const BUDGET = { desktop: { cells: 12, comps: 6000 }, phone: { cells: 6, comps: 2400 } };
export const SYN = { e: { tau1: 0.2, tau2: 2, e: 0 }, i: { tau1: 0.5, tau2: 8, e: -75 } };
export const SYN_DELAY = 0.5;      // ms, transmitter release and binding
export const NC_THRESHOLD = -10;   // mV at the soma
// uS of one AMPA-like synapse 30 to 100 um out on a dendrite that fires a
// resting cell of each type with the default biophysics: the largest
// threshold over six placements (pyramidal 0.0050 to 0.0073, purkinje
// 0.0061 to 0.0081, motor 0.023 to 0.031, granule 0.00034 to 0.00038),
// rounded up. An oblique branch next to the thick apical trunk can need up
// to 3x (the trunk is a current sink). The page sets weights in multiples.
export const THRESH_W = { pyramidal: 0.0075, purkinje: 0.0085, motor: 0.032, granule: 0.0004 };

// ── the compartment budget ──────────────────────────────────────────────
const DLS = [0.03, 0.05, 0.08, 0.1, 0.15, 0.2, 0.3, 0.5, 0.8, 1.5, 3, 10];
export function countComps(S, dl, Ra, cm) {
  let n = 0;
  for (const s of S) n += s.kind === 'soma' ? 1 : dLambdaNseg(s.L, 0.5 * (s.d0 + (s.d1 ?? s.d0)), Ra, cm, dl);
  return n;
}
// list: [{ S, Ra, cm }]. Returns { dl, total, over }.
export function chooseDlambda(list, comps) {
  let last = null;
  for (const dl of DLS) {
    let tot = 0; for (const c of list) tot += countComps(c.S, dl, c.Ra, c.cm);
    last = { dl, total: tot, over: tot > comps };
    if (tot <= comps) return last;
  }
  return last;
}

// ── placement ───────────────────────────────────────────────────────────
// Returns [{ p: [x, y, z], yaw }] in um. Cells are about 400 um wide.
export function layoutPositions(n, layout = 'ring', seed = 1, gap = 430) {
  const R = rng(seed * 59 + 5), out = [];
  if (layout === 'line') for (let i = 0; i < n; i++) out.push({ p: [(i - (n - 1) / 2) * gap, 0, 0], yaw: R() * 6.283 });
  else if (layout === 'ring') {
    const r = Math.max(gap * 0.9, n * gap / (2 * Math.PI));
    for (let i = 0; i < n; i++) { const a = i / n * 2 * Math.PI; out.push({ p: [r * Math.sin(a), 0, r * Math.cos(a)], yaw: a + Math.PI }); }
  } else if (layout === 'layer') {
    const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
    for (let i = 0; i < n; i++) { const c = i % cols, r = Math.floor(i / cols); out.push({ p: [(c - (cols - 1) / 2) * gap, 0, (r - (rows - 1) / 2) * gap], yaw: R() * 6.283 }); }
  } else {
    const rad = gap * 0.75 * Math.cbrt(n);
    for (let i = 0; i < n; i++) {
      let p, k = 0;
      do { p = [(R() * 2 - 1) * rad, (R() * 2 - 1) * rad * 0.35, (R() * 2 - 1) * rad]; k++; }
      while (k < 200 && out.some(o => Math.hypot(o.p[0] - p[0], o.p[1] - p[1], o.p[2] - p[2]) < gap * 0.62));
      out.push({ p, yaw: R() * 6.283 });
    }
  }
  return out;
}

// ── wiring presets ──────────────────────────────────────────────────────
// Returns { conns: [{ pre, post, ty }], sign: ['e' | 'i' per cell] }.
export function wirePreset(n, preset = 'chain', o = {}) {
  const R = rng((o.seed || 1) * 83 + 29), p = o.p ?? 0.3, conns = [];
  const sign = new Array(n).fill('e');
  const add = (a, b) => { if (a !== b && a < n && b < n && !conns.some(c => c.pre === a && c.post === b)) conns.push({ pre: a, post: b, ty: sign[a] }); };
  if (preset === 'chain') for (let i = 0; i + 1 < n; i++) add(i, i + 1);
  else if (preset === 'ring') for (let i = 0; i < n; i++) add(i, (i + 1) % n);
  else if (preset === 'all') { for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) add(i, j); }
  else if (preset === 'ff') {
    const L = Math.max(2, Math.min(4, Math.round(n / 2))), per = Math.ceil(n / L), layer = i => Math.floor(i / per);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (layer(j) === layer(i) + 1) add(i, j);
  } else if (preset === 'random') {
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j && R() < p) add(i, j);
  } else if (preset === 'ei') {
    // Dale's law: a cell is E or I for all of its outputs
    const nE = Math.max(1, Math.min(n - 1, Math.round(n * (o.fracE ?? 0.8))));
    for (let i = nE; i < n; i++) sign[i] = 'i';
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j && R() < Math.max(p, 0.35)) add(i, j);
    // every cell gets at least one E input, every I cell at least one output
    for (let j = 0; j < n; j++) if (!conns.some(c => c.post === j && sign[c.pre] === 'e')) { const e = [...Array(nE).keys()].find(q => q !== j); if (e != null) add(e, j); }
    for (let i = nE; i < n; i++) if (!conns.some(c => c.pre === i)) add(i, 0);
  } else if (preset === 'loop') {
    // a ring of E cells and one I cell that all of them drive and that inhibits all of them
    const m = Math.max(2, n - 1); sign[n - 1] = 'i';
    for (let i = 0; i < m; i++) add(i, (i + 1) % m);
    for (let i = 0; i < m; i++) { add(i, n - 1); add(n - 1, i); }
  }
  return { conns, sign };
}

// ── the drawn axon ──────────────────────────────────────────────────────
function bez(a, b, c, d, t) { const u = 1 - t; return [0, 1, 2].map(k => u * u * u * a[k] + 3 * u * u * t * b[k] + 3 * u * t * t * c[k] + t * t * t * d[k]); }
// From the hillock p0 to the synapse p3: the axon leaves down, arcs over, and
// comes in to the synapse from below. Returns { pts, len } (k + 1 points).
export function axonCurve(p0, p3, k = 32) {
  const D = Math.hypot(p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]), drop = 60 + 0.35 * D;
  const p1 = [p0[0], p0[1] - drop, p0[2]], p2 = [p3[0], p3[1] - drop * 0.6, p3[2]];
  const pts = []; let len = 0;
  for (let i = 0; i <= k; i++) { const q = bez(p0, p1, p2, p3, i / k); if (i) { const r = pts[i - 1]; len += Math.hypot(q[0] - r[0], q[1] - r[1], q[2] - r[2]); } pts.push(q); }
  return { pts, len };
}

// ── the network ─────────────────────────────────────────────────────────
// o: { specs: [{ type, seed, morph, bio }], place: [{ p, yaw }], budget, velocity (m/s), seed }
export class MultiNet {
  constructor(o) {
    this.specs = o.specs.map(s => ({ ...s }));
    this.place = o.place.map(q => ({ p: q.p.slice(), yaw: q.yaw || 0 }));
    this.budget = o.budget || BUDGET.desktop;
    this.velocity = o.velocity ?? 0.3;
    this.seed = o.seed || 1;
    this.R = rng(this.seed * 101 + 13);
    if (this.specs.length > this.budget.cells) throw new Error(`at most ${this.budget.cells} cells here`);
    const morphs = this.specs.map(s => s.S || makeCell(s.type, s.seed, s.morph));
    const ch = chooseDlambda(morphs.map((S, i) => ({ S, Ra: this.specs[i].bio.Ra, cm: this.specs[i].bio.cm })), this.budget.comps);
    this.dl = ch.dl; this.over = ch.over;
    this.cells = morphs.map((S, i) => {
      const c = new Cell(S, { ...cellOpts(this.specs[i].bio), dlambda: this.dl, dt: o.dt });
      c.useTable(true); c.index = i;
      // the spike source: the end of the AIS (the hillock region), or the soma
      let src = 0; for (let k = 0; k < c.n; k++) if (c.sections[c.sec[k]].kind === 'ais') src = k;
      c.src = src;
      const watch = c.netcon(src, null, { threshold: NC_THRESHOLD });
      watch.onSpike = t => this._spike(i, t);
      c.kick = c.iclamp(0, { del: 1e9, dur: 0, amp: 0 });
      c.stimPP = [];
      return c;
    });
    this.total = this.cells.reduce((a, c) => a + c.n, 0);
    this.conns = []; this.spikes = []; this.t = 0;
    this.onSpike = null; this.onDeliver = null;
  }
  get n() { return this.cells.length; }

  // world position of node k of cell i
  world(i, k) {
    const c = this.cells[i], P = this.place[i], x = c.pos[k * 3], y = c.pos[k * 3 + 1], z = c.pos[k * 3 + 2];
    const cs = Math.cos(P.yaw), sn = Math.sin(P.yaw);
    return [P.p[0] + cs * x + sn * z, P.p[1] + y, P.p[2] - sn * x + cs * z];
  }
  hillock(i) { const c = this.cells[i]; for (let k = 0; k < c.n; k++) if (c.sections[c.sec[k]].kind === 'ais') return this.world(i, k); return this.world(i, 0); }
  isDend(i, k) { const kd = this.cells[i].sections[this.cells[i].sec[k]].kind; return kd === 'dend' || kd === 'apical' || kd === 'tuft'; }
  // a proximal thin dendrite node of post (30 to 100 um from the soma) that faces pre
  targetNode(post, pre, R = this.R) {
    const c = this.cells[post], from = this.world(pre, 0), cand = [];
    // thin branches only (not the thick apical trunk), so one weight scale fits all targets
    for (let k = 0; k < c.n; k++) if (this.isDend(post, k) && c.sections[c.sec[k]].kind !== 'apical' && c.dist[k] >= 30 && c.dist[k] <= 100) {
      const w = this.world(post, k); cand.push([Math.hypot(w[0] - from[0], w[1] - from[1], w[2] - from[2]), k]);
    }
    if (!cand.length) { for (let k = 1; k < c.n; k++) if (this.isDend(post, k)) return k; return 0; }
    cand.sort((a, b) => a[0] - b[0]);
    return cand[Math.min(cand.length - 1, Math.floor(R() * Math.min(4, cand.length)))][1];
  }

  // o: { ty 'e' | 'i', w (uS) or wx (x THRESH_W of the post type), node, delay (fixed ms) }
  connect(pre, post, o = {}) {
    if (pre === post) return null;
    const ty = o.ty === 'i' ? 'i' : 'e';
    const node = o.node ?? (o.sec != null ? this.nodeAt(post, o.sec, o.x ?? 0.5) : this.targetNode(post, pre));
    const P = this.cells[pre], Q = this.cells[post], k = SYN[ty];
    const syn = Q.exp2Syn(node, { tau1: k.tau1, tau2: k.tau2, e: k.e });
    const w = o.w ?? (o.wx ?? 1) * THRESH_W[this.specs[post].type] * (ty === 'i' ? 2 : 1);
    const conn = { pre, post, ty, node, sec: Q.sec[node], x: Q.xc[node], w, fixed: o.delay ?? null, syn, flights: [], flash: 0 };
    conn.nc = P.netcon(P.src, syn, { threshold: NC_THRESHOLD, weight: w, delay: 1, cell: Q });
    this.conns.push(conn);
    this.geometry(conn);
    return conn;
  }
  nodeAt(i, si, x) { const s = this.cells[i].sections[si]; return s.first + Math.min(s.nseg - 1, Math.floor(x * s.nseg)); }
  // the curve, its length and the delay that follows from them
  geometry(c) {
    const cv = axonCurve(this.hillock(c.pre), this.world(c.post, c.node));
    c.pts = cv.pts; c.len = cv.len;
    c.delay = c.fixed ?? SYN_DELAY + c.len / (this.velocity * 1000);
    c.nc.delay = c.delay;
    return c;
  }
  regeometry() { for (const c of this.conns) this.geometry(c); }
  setVelocity(v) { this.velocity = v; this.regeometry(); }
  setWeight(c, w) { c.w = w; c.nc.weight = w; }
  setType(c, ty) {
    c.ty = ty === 'i' ? 'i' : 'e'; const k = SYN[c.ty], f = exp2Factor(k.tau1, k.tau2);
    Object.assign(c.syn, { tau1: f.tau1, tau2: k.tau2, e: k.e, factor: f.factor });
  }
  disconnect(c) {
    const P = this.cells[c.pre], Q = this.cells[c.post];
    P.netcons = P.netcons.filter(q => q !== c.nc); Q.remove(c.syn);
    this.conns = this.conns.filter(q => q !== c);
  }
  clearConns() { for (const c of this.conns.slice()) this.disconnect(c); }
  move(i, p) { this.place[i].p = p.slice(); this.regeometry(); }

  _spike(i, t) {
    this.spikes.push(t, i);
    for (const c of this.conns) if (c.pre === i) c.flights.push(t);
    if (this.onSpike) this.onSpike(i, t);
  }

  // a soma pulse that fires any cell (random.js stdStimulus)
  kick(i, scale = 1) {
    const c = this.cells[i], s = stdStimulus(this.specs[i].type, this.specs[i].morph || {});
    c.kick.del = c.t + 0.1; c.kick.dur = s.dur; c.kick.amp = s.amp * scale;
  }
  // stim items from random.js stimPlan, for cell i
  addStim(i, it, R = this.R) {
    const c = this.cells[i];
    if (it.kind === 'iclamp') { const pp = c.iclamp(it.node, { del: c.t + it.del, dur: it.dur, amp: it.amp }); c.stimPP.push(pp); return pp; }
    const syn = c.exp2Syn(it.node, SYN.e), ns = c.netstim({ interval: it.interval, number: it.number, start: -1, noise: it.noise, rand: R });
    c.netcon(ns, syn, { delay: 1, weight: it.weight }); ns.burst(c, c.t + it.start);
    const pp = { syn, ns }; c.stimPP.push(pp); return pp;
  }
  clearStims() {
    for (const c of this.cells) {
      for (const pp of c.stimPP) { if (pp.ns) { pp.ns.number = 0; c.remove(pp.syn); c.stims = c.stims.filter(s => s !== pp.ns); } else c.remove(pp); }
      c.stimPP = [];
    }
  }

  step() {
    for (const c of this.cells) c.step();
    this.t = this.cells[0].t;
    // trim flights that have landed long ago
    for (const c of this.conns) { if (c.flights.length && c.flights[0] + c.delay + 8 < this.t) c.flights.shift(); }
  }
  run(tstop, each) { while (this.t < tstop - 1e-9) { this.step(); if (each) each(this); } }
  reset() {
    for (const c of this.cells) { c.init(); c.kick.del = 1e9; c.kick.dur = 0; }
    for (const c of this.conns) c.flights.length = 0;
    this.spikes.length = 0; this.t = 0;
  }
  spikeTimes(i) { const o = []; for (let q = 0; q < this.spikes.length; q += 2) if (this.spikes[q + 1] === i) o.push(this.spikes[q]); return o; }
}

// n x n: 0 none, 1 excitatory, -1 inhibitory (row pre, column post).
export function matrixOf(n, conns) {
  const M = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const c of conns) M[c.pre][c.post] = c.ty === 'i' ? -1 : 1;
  return M;
}
export { BASE_AMP };
