// ============================================================================
//  NEURON LAB ENGINE  ·  cell.js  ·  a branched cable cell, Hines solve
// ----------------------------------------------------------------------------
//  A small copy of the way NEURON integrates one cell. No DOM, no THREE:
//  tests.mjs and the pages import this file.
//
//  A cell is a tree of sections. Each section is split into nseg
//  compartments (segments). The node of a segment sits at its centre. The
//  nodes are numbered so that a parent node has a lower number than its
//  children. The tree matrix then has one diagonal entry per node and one
//  off-diagonal pair per node and its parent, and the Hines method solves
//  it in O(n): one elimination pass from the leaves to the root, then one
//  back substitution from the root to the leaves.
//
//  Units (NEURON units): mV, ms, um, nA, uS, S/cm2, mA/cm2, uF/cm2, ohm cm.
//  Per node: C nF = cm area 1e-5, G uS = g area 1e-2, I nA = i area 1e-2.
//  Axial R in Mohm = Ra len 4 / (pi d^2) 1e-2 (len and d in um).
//
//  Time step (NEURON fixed step, secondorder = 0): with the gates fixed, the
//  membrane current is linear in v (di/dv = gna + gk + gl, the value that
//  NEURON gets by its finite difference). An implicit backward Euler step
//  solves for dv on the tree. The gates then take one cnexp step at the new
//  v, so the gates run half a step out of phase with v, as in NEURON.
//  secondorder = 2 gives Crank-Nicolson for the voltage.
//
//  Simplification: a child section joins its parent at the parent segment
//  that holds the join point x, through the child half segment plus the
//  parent length from that segment centre to x. NEURON puts a zero-area
//  node at x = 1 instead. The two agree when one child joins at a point.
//
//  Spines: a section with s.spines (per um) gets a larger membrane area
//  (C and channel conductances) and the same axial resistance, the usual
//  NEURON spine factor F = 1 + density * area_spine / (pi d).
//
//  Ih (optional, gihbar from dens, 0 by default): the HCN current of Hay et
//  al. 2011 (ModelDB 139653, Ih.mod, after Kole et al. 2006): one gate m,
//  i = gihbar m (v - ehcn), ehcn = -45 mV. Only the equations are copied.
//  With every gihbar = 0 the step skips it and the cell is pure hh.
//
//  grep -n targets
//    "export function ihRates"      the Ih gate rates
//    "export function dLambdaNseg"  the d_lambda nseg rule (NEURON book)
//    "export function hinesSolve"   the O(n) tree solve
//    "export function denseSolve"   Gaussian elimination, for the tests
//    "export class Cell"            build, mechanisms, point processes
//    "step("                        one fixed time step
//    "export class EventQueue"      NetCon and NetStim events
// ============================================================================
import { HH, NRN, rates } from './hh.js';

const PI = Math.PI;
export const SPINE_AREA = 1.2; // um2 per spine (head and neck)
export const EHCN = -45;
// Ih.mod (Hay 2011): mAlpha = 0.001*6.43*(v+154.9)/(exp((v+154.9)/11.9)-1), mBeta = 0.001*193*exp(v/33.1), per ms.
export function ihRates(v) {
  const x = v + 154.9, a = 0.001 * 6.43 * (Math.abs(x) < 1e-6 ? 11.9 : x / (Math.exp(x / 11.9) - 1)), b = 0.001 * 193 * Math.exp(v / 33.1);
  return [a / (a + b), 1 / (a + b)];
}

// lambda at frequency f (NEURON book, d_lambda rule). d um, Ra ohm cm, cm uF/cm2.
export function lambdaF(f, d, Ra, cm) { return 1e5 * Math.sqrt(d / (4 * PI * f * Ra * cm)); }
// nseg = int((L / (d_lambda lambda_100) + 0.9) / 2) * 2 + 1, d_lambda = 0.1. NEURON's own
// default is nseg = 1; models use this rule to pick nseg.
export function dLambdaNseg(L, d, Ra = NRN.Ra, cm = NRN.cm, dl = 0.1, f = 100) {
  return Math.floor((L / (dl * lambdaF(f, d, Ra, cm)) + 0.9) / 2) * 2 + 1;
}

// Solve the tree system in place. d diagonal, a[i] = A[i][parent], b[i] = A[parent][i],
// rhs right side. On return rhs holds the answer. parent[i] < i, parent[0] = -1.
export function hinesSolve(n, parent, d, a, b, rhs) {
  for (let i = n - 1; i > 0; i--) {
    const p = parent[i], f = b[i] / d[i];
    d[p] -= f * a[i];
    rhs[p] -= f * rhs[i];
  }
  rhs[0] /= d[0];
  for (let i = 1; i < n; i++) rhs[i] = (rhs[i] - a[i] * rhs[parent[i]]) / d[i];
  return rhs;
}

// Dense Gaussian elimination with partial pivoting (tests only).
export function denseSolve(M, y) {
  const n = y.length, A = M.map(r => r.slice()), x = y.slice();
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [x[c], x[p]] = [x[p], x[c]];
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c]; if (!f) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      x[r] -= f * x[c];
    }
  }
  for (let r = n - 1; r >= 0; r--) { let s = x[r]; for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k]; x[r] = s / A[r][r]; }
  return x;
}

// A binary heap of events { t, fn } ordered by delivery time.
export class EventQueue {
  constructor() { this.h = []; }
  get size() { return this.h.length; }
  push(t, fn) {
    const h = this.h; h.push({ t, fn }); let i = h.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (h[p].t <= h[i].t) break; [h[p], h[i]] = [h[i], h[p]]; i = p; }
  }
  peek() { return this.h[0]; }
  pop() {
    const h = this.h, top = h[0], last = h.pop();
    if (h.length) {
      h[0] = last; let i = 0;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < h.length && h[l].t < h[m].t) m = l; if (r < h.length && h[r].t < h[m].t) m = r;
        if (m === i) break; [h[m], h[i]] = [h[i], h[m]]; i = m; }
    }
    return top;
  }
  clear() { this.h.length = 0; }
}

// Exp2Syn normalisation (exp2syn.mod INITIAL): the peak conductance per unit weight is 1.
export function exp2Factor(tau1, tau2) {
  if (tau1 / tau2 > 0.9999) tau1 = 0.9999 * tau2;
  if (tau1 / tau2 < 1e-9) tau1 = tau2 * 1e-9;
  const tp = (tau1 * tau2) / (tau2 - tau1) * Math.log(tau2 / tau1);
  return { tau1, factor: 1 / (-Math.exp(-tp / tau1) + Math.exp(-tp / tau2)) };
}

// sections: [{ name, kind, parent, x, L, d0, d1, pts }] with parent < own index.
// opts: Ra, cm, nseg ('dlambda' | number | fn(sec)), dens(sec, xc) -> { gnabar, gkbar, gl, el }
export class Cell {
  constructor(sections, opts = {}) {
    this.Ra = opts.Ra ?? NRN.Ra; this.cm = opts.cm ?? NRN.cm;
    this.celsius = opts.celsius ?? NRN.celsius; this.dt = opts.dt ?? NRN.dt;
    this.secondorder = opts.secondorder ?? 0;
    this.ena = HH.ena; this.ek = HH.ek;
    this.sections = sections.map(s => ({ ...s }));
    this.dens = opts.dens || (() => ({ gnabar: HH.gnabar, gkbar: HH.gkbar, gl: HH.gl, el: HH.el }));
    this.nsegRule = opts.nseg ?? 'dlambda';
    this.diamScale = opts.diamScale ?? 1;
    this.dl = opts.dlambda ?? 0.1;
    this.build();
  }

  build() {
    const S = this.sections, Ra = this.Ra;
    let n = 0;
    for (const s of S) {
      const dm = 0.5 * (s.d0 + (s.d1 ?? s.d0)) * this.diamScale;
      s.nseg = typeof this.nsegRule === 'number' ? this.nsegRule
        : typeof this.nsegRule === 'function' ? this.nsegRule(s)
        : s.kind === 'soma' ? 1 : dLambdaNseg(s.L, dm, Ra, this.cm, this.dl);
      s.first = n; n += s.nseg;
    }
    this.n = n;
    const F = k => new Float64Array(n);
    this.parent = new Int32Array(n); this.ga = F(); this.area = F(); this.C = F(); this.diam = F();
    this.gnabar = F(); this.gkbar = F(); this.gl = F(); this.el = F(); this.gih = F(); this.qih = F();
    this.v = F(); this.m = F(); this.h = F(); this.nn = F(); this.vprev = F();
    this.sec = new Int32Array(n); this.xc = F(); this.pos = new Float32Array(n * 3); this.dist = F();
    this.gsyn = F(); this.isyn = F(); this.iext = F(); this.ina = F(); this.ik = F();
    this._d = F(); this._a = F(); this._b = F(); this._r = F();
    const halfR = (L, d) => Ra * L * 4 / (PI * d * d) * 1e-2;
    for (let si = 0; si < S.length; si++) {
      const s = S[si], ns = s.nseg, len = s.L / ns;
      for (let j = 0; j < ns; j++) {
        const i = s.first + j, xc = (j + 0.5) / ns;
        const d = (s.d0 + ((s.d1 ?? s.d0) - s.d0) * xc) * this.diamScale;
        this.sec[i] = si; this.xc[i] = xc; this.diam[i] = d;
        this.area[i] = PI * d * len * (s.spines ? 1 + s.spines * SPINE_AREA / (PI * d) : 1); this.C[i] = this.cm * this.area[i] * 1e-5;
        const D = this.dens(s, xc);
        this.gnabar[i] = D.gnabar; this.gkbar[i] = D.gkbar; this.gl[i] = D.gl; this.el[i] = D.el; this.gih[i] = D.gih || 0;
        const p = this.pointAt(s, xc); this.pos[i * 3] = p[0]; this.pos[i * 3 + 1] = p[1]; this.pos[i * 3 + 2] = p[2];
        if (j > 0) {
          const dp = this.diam[i - 1];
          this.parent[i] = i - 1; this.ga[i] = 1 / (halfR(len / 2, dp) + halfR(len / 2, d));
          this.dist[i] = this.dist[i - 1] + len;
        } else if (s.parent < 0) {
          this.parent[i] = -1; this.ga[i] = 0; this.dist[i] = 0;
        } else {
          const P = S[s.parent], x = s.x ?? 1, k = Math.min(P.nseg - 1, Math.floor(x * P.nseg));
          const pi = P.first + k, pxc = (k + 0.5) / P.nseg, plen = Math.abs(x - pxc) * P.L;
          this.parent[i] = pi;
          this.ga[i] = 1 / (halfR(len / 2, d) + (plen > 0 ? halfR(plen, this.diam[pi]) : 0));
          this.dist[i] = this.dist[pi] + plen + len / 2;
        }
      }
    }
    if (this.parent[0] !== -1) throw new Error('first section must be the root');
    this.ihCheck();
    this.syns = []; this.clamps = []; this.netcons = []; this.stims = [];
    this.queue = new EventQueue();
    this.tbl = null;
    this.init();
  }

  pointAt(s, x) {
    const P = s.pts; if (!P || P.length < 2) return P ? P[0] : [0, 0, 0];
    // arc length along the polyline
    let tot = 0; const seg = [];
    for (let k = 1; k < P.length; k++) { const l = Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1], P[k][2] - P[k - 1][2]); seg.push(l); tot += l; }
    let want = x * tot;
    for (let k = 0; k < seg.length; k++) {
      if (want <= seg[k] || k === seg.length - 1) { const f = seg[k] ? Math.min(1, want / seg[k]) : 0, a = P[k], b = P[k + 1]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; }
      want -= seg[k];
    }
    return P[P.length - 1];
  }

  // finitialize(v_init): gates at steady state, synapses at 0.
  init(vinit = NRN.v_init) {
    const r = new Float64Array(6);
    rates(vinit, this.celsius, r);
    this.v.fill(vinit); this.vprev.fill(vinit);
    this.m.fill(r[0]); this.h.fill(r[2]); this.nn.fill(r[4]); this.qih.fill(ihRates(vinit)[0]);
    for (const s of this.syns) { s.g = 0; s.A = 0; s.B = 0; }
    this.queue.clear();
    this.t = 0;
    for (const ns of this.stims) ns.reset(this);
  }

  // Call after gih changes: the step skips Ih when every gih is 0.
  ihCheck() { this.ihOn = this.gih.some(g => g > 0); }

  // Use a fine rate table (0.05 mV, linear) instead of exp() in the loop. Pages use it.
  useTable(on) { this.tbl = on ? { celsius: NaN, dt: NaN } : null; }
  _table() {
    const T = this.tbl;
    if (T.celsius === this.celsius && T.dt === this.dt) return T;
    const lo = -120, hi = 80, st = 0.05, n = Math.round((hi - lo) / st) + 1, r = new Float64Array(6);
    T.inf = new Float64Array(n * 3); T.k = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) { rates(lo + i * st, this.celsius, r);
      for (let g = 0; g < 3; g++) { T.inf[i * 3 + g] = r[g * 2]; T.k[i * 3 + g] = 1 - Math.exp(-this.dt / r[g * 2 + 1]); } }
    T.lo = lo; T.st = st; T.n = n; T.celsius = this.celsius; T.dt = this.dt;
    return T;
  }

  // ── point processes ──────────────────────────────────────────────────
  iclamp(node, o = {}) { const c = { type: 'IClamp', node, del: o.del ?? 0, dur: o.dur ?? 0, amp: o.amp ?? 0 }; this.clamps.push(c); return c; }
  expSyn(node, o = {}) { const s = { type: 'ExpSyn', node, tau: o.tau ?? 0.1, e: o.e ?? 0, g: 0 }; this.syns.push(s); return s; }
  exp2Syn(node, o = {}) {
    const f = exp2Factor(o.tau1 ?? 0.1, o.tau2 ?? 10);
    const s = { type: 'Exp2Syn', node, tau1: f.tau1, tau2: o.tau2 ?? 10, e: o.e ?? 0, factor: f.factor, A: 0, B: 0, g: 0 };
    this.syns.push(s); return s;
  }
  remove(pp) { for (const L of [this.syns, this.clamps]) { const k = L.indexOf(pp); if (k >= 0) L.splice(k, 1); } this.netcons = this.netcons.filter(nc => nc.target !== pp); }
  // NET_RECEIVE of ExpSyn / Exp2Syn
  receive(s, w) { if (s.type === 'ExpSyn') s.g += w; else { s.A += w * s.factor; s.B += w * s.factor; } }

  // NetCon from a node of this cell (threshold crossing) or from a NetStim.
  netcon(source, target, o = {}) {
    const nc = { source, target, threshold: o.threshold ?? NRN.threshold, delay: o.delay ?? NRN.delay, weight: o.weight ?? 0, cell: o.cell || this };
    if (typeof source === 'number') this.netcons.push(nc); else source.out.push(nc);
    return nc;
  }
  netstim(o = {}) { const ns = new NetStim(o); this.stims.push(ns); ns.reset(this); return ns; }
  // A spike from outside (another cell): deliver w to target at time t.
  sendAt(t, target, w, cell = this) { this.queue.push(t, () => cell.receive(target, w)); }

  // ── one fixed step ───────────────────────────────────────────────────
  step() {
    const n = this.n, dt = this.dt, v = this.v, t = this.t;
    // events due by t + dt/2 (NEURON delivers events at the step boundary)
    const Q = this.queue;
    while (Q.size && Q.peek().t <= t + dt / 2) Q.pop().fn();
    // point process currents
    const gs = this.gsyn, is = this.isyn, ie = this.iext;
    gs.fill(0); is.fill(0); ie.fill(0);
    for (const s of this.syns) { const g = s.type === 'ExpSyn' ? s.g : s.B - s.A; s.gnow = g; gs[s.node] += g; is[s.node] += g * (v[s.node] - s.e); }
    for (const c of this.clamps) if (t + dt / 2 >= c.del && t + dt / 2 < c.del + c.dur) ie[c.node] += c.amp;
    // the tree matrix for dv
    const d = this._d, a = this._a, b = this._b, r = this._r, P = this.parent, ga = this.ga;
    const ena = this.ena, ek = this.ek, m = this.m, h = this.h, nk = this.nn;
    const cfac = this.secondorder === 2 ? 2 / dt : 1 / dt;
    for (let i = 0; i < n; i++) {
      const gna = this.gnabar[i] * m[i] * m[i] * m[i] * h[i], n2 = nk[i] * nk[i], gk = this.gkbar[i] * n2 * n2, gl = this.gl[i];
      const ina = gna * (v[i] - ena), ik = gk * (v[i] - ek), il = gl * (v[i] - this.el[i]);
      this.ina[i] = ina; this.ik[i] = ik;
      const ar = this.area[i] * 1e-2;
      let gh = 0, ih = 0;
      if (this.ihOn) { gh = this.gih[i] * this.qih[i]; ih = gh * (v[i] - EHCN); }
      d[i] = this.C[i] * cfac + (gna + gk + gl + gh) * ar + gs[i];
      r[i] = ie[i] - (ina + ik + il + ih) * ar - is[i];
    }
    for (let i = 1; i < n; i++) {
      const p = P[i], g = ga[i], dv = v[p] - v[i];
      d[i] += g; d[p] += g; a[i] = -g; b[i] = -g;
      r[i] += g * dv; r[p] -= g * dv;
    }
    hinesSolve(n, P, d, a, b, r);
    const vp = this.vprev;
    for (let i = 0; i < n; i++) { vp[i] = v[i]; v[i] += this.secondorder === 2 ? 2 * r[i] : r[i]; }
    // gates: cnexp at the new v
    if (this.tbl) {
      const T = this._table(), inf = T.inf, K = T.k;
      for (let i = 0; i < n; i++) {
        let f = (v[i] - T.lo) / T.st; if (f < 0) f = 0; else if (f > T.n - 1.001) f = T.n - 1.001;
        const j = f | 0, u = f - j, o = j * 3, q = o + 3;
        m[i] += (K[o] + (K[q] - K[o]) * u) * (inf[o] + (inf[q] - inf[o]) * u - m[i]);
        h[i] += (K[o + 1] + (K[q + 1] - K[o + 1]) * u) * (inf[o + 1] + (inf[q + 1] - inf[o + 1]) * u - h[i]);
        nk[i] += (K[o + 2] + (K[q + 2] - K[o + 2]) * u) * (inf[o + 2] + (inf[q + 2] - inf[o + 2]) * u - nk[i]);
      }
    } else {
      const R = this._rr || (this._rr = new Float64Array(6)), cel = this.celsius;
      for (let i = 0; i < n; i++) {
        rates(v[i], cel, R);
        m[i] += (1 - Math.exp(-dt / R[1])) * (R[0] - m[i]);
        h[i] += (1 - Math.exp(-dt / R[3])) * (R[2] - h[i]);
        nk[i] += (1 - Math.exp(-dt / R[5])) * (R[4] - nk[i]);
      }
    }
    if (this.ihOn) {
      const q = this.qih, gi = this.gih;
      for (let i = 0; i < n; i++) if (gi[i] > 0) { const [inf, tau] = ihRates(v[i]); q[i] += (1 - Math.exp(-dt / tau)) * (inf - q[i]); }
    }
    for (const s of this.syns) {
      if (s.type === 'ExpSyn') s.g *= Math.exp(-dt / s.tau);
      else { s.A *= Math.exp(-dt / s.tau1); s.B *= Math.exp(-dt / s.tau2); }
    }
    this.t = t + dt;
    // threshold crossings (NetCon sources on this cell)
    for (const nc of this.netcons) {
      const k = nc.source;
      if (vp[k] < nc.threshold && v[k] >= nc.threshold) {
        // linear interpolation of the crossing time inside the step
        const tc = t + dt * (nc.threshold - vp[k]) / (v[k] - vp[k]);
        if (nc.onSpike) nc.onSpike(tc);
        if (nc.target) nc.cell.sendAt(tc + nc.delay, nc.target, nc.weight, nc.cell);
      }
    }
  }

  run(tstop, each) { while (this.t < tstop - 1e-9) { this.step(); if (each) each(this); } }
}

// netstim.mod: interval, number, start, noise. noise 0 is periodic; 1 is Poisson.
export class NetStim {
  constructor(o = {}) { this.interval = o.interval ?? 10; this.number = o.number ?? 10; this.start = o.start ?? 50; this.noise = Math.min(1, Math.max(0, o.noise ?? 0)); this.rand = o.rand || Math.random; this.out = []; this.count = 0; }
  invl(mean) { return this.noise === 0 ? mean : (1 - this.noise) * mean + this.noise * mean * -Math.log(1 - this.rand()); }
  reset(cell) {
    this.count = 0; this.cell = cell;
    if (this.start >= 0 && this.number > 0) cell.queue.push(this.start + this.invl(this.interval) - this.interval * (1 - this.noise), () => this.fire());
  }
  // re-arm from now: a burst of number spikes from time t0
  burst(cell, t0) { this.count = 0; this.cell = cell; cell.queue.push(t0, () => this.fire()); }
  fire() {
    const c = this.cell; if (this.count >= this.number) return;
    this.count++;
    for (const nc of this.out) { if (nc.onSpike) nc.onSpike(c.t); if (nc.target) nc.cell.sendAt(c.t + nc.delay, nc.target, nc.weight, nc.cell); }
    if (this.count < this.number) c.queue.push(c.t + this.invl(this.interval), () => this.fire());
  }
}

// A one-section cylinder, the classic NEURON soma: L = diam = 12.6157 um gives 500 um2.
export function somaOnly(opts = {}) {
  const d = opts.diam ?? 12.6157;
  return new Cell([{ name: 'soma', kind: 'soma', parent: -1, L: opts.L ?? d, d0: d, pts: [[0, 0, 0], [0, 0, 0]] }], { nseg: 1, ...opts });
}
