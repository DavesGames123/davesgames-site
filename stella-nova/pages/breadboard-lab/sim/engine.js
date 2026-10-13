// ============================================================================
//  BREADBOARD LAB  ·  sim/engine.js — modified nodal analysis in time
// ----------------------------------------------------------------------------
//  createEngine(netlist, opts) turns a netlist (sim/netlist.js) into devices
//  (one per element, plus probe inputs and MCU pin drivers) and steps them in
//  time. Contract section 3.8.
//
//  UNKNOWNS. Node n (n ≥ 1) is unknown n − 1; node 0 is ground. Devices add
//  internal nodes and branch currents. Every node unknown gets gmin = 1e-12 S
//  to ground, so a floating net stays solvable.
//
//  ONE STEP. Newton-Raphson on the stamped matrix (sparse LU, sim/solver.js;
//  refactor() reuses the pivot order). Linear devices stamp once per step
//  (A0, rhs0); nonlinear devices stamp on each iteration. Near convergence a
//  chord step reuses the last LU with a residual solve; it counts as
//  converged only if it also contracts. The start point is a linear
//  prediction from the last two points after the last breakpoint. Then
//  three checks, in order:
//    1. Newton failed .............. h /= 8 and try again
//    2. LTE ratio > 1 .............. h shrinks by the error ratio
//    3. a logic input crosses inside the step (cross()) .. land just past it
//  Then accept: devices move state; logic outputs, timers and MCUs update;
//  a change of any of them is a BREAKPOINT.
//
//  BREAKPOINTS. Source edges, PWM edges, MCU wake times, relay moves and
//  button bounce are time points the step lands on exactly. After a
//  breakpoint the next two steps use backward Euler (no trapezoid ringing)
//  and start at hReg/64 (hReg: the last clean, untruncated step plan).
//  Trapezoid steps after that. The first step after a breakpoint starts
//  Newton from the solution seen at the last edge with the same switching
//  state (startCache, keyed by Dev.sig()), so periodic circuits converge
//  in one or two iterations at their edges.
//
//  CROSSINGS. cross() gives the fraction of the step where a logic input
//  passes its threshold (a Hermite quadratic when the previous point is
//  known, devbase CROSS). The retry aims 0.5 % short of a far crossing, and
//  crossHint keeps the next step from jumping over it. A fraction that does
//  not change when the step shrinks means the input jumped at the step
//  start; that step is accepted.
//
//  START. The first advance solves the power-on state: capacitors at their
//  ic (0 V), inductors at 0 A, motors still. That is a backward Euler step of
//  1 ns that does not commit state. dcop() instead solves the DC operating
//  point (capacitors open), commits it, and the transient starts there.
//  Both fall back to gmin stepping, then source stepping.
//
//  PWM: 'auto' switches a timed pin when its net reaches a nonlinear or
//  timing-sensitive device (LED, diode, transistor, logic input, 555, op-amp,
//  servo, buzzer, speaker, relay coil, another MCU pin, a scope or logic
//  lead) through resistors, wires, switches, pots and capacitors. Else it
//  drives the average. (An LED needs switching: its average current is
//  duty · I_on only with real edges.)
//
//  GREP MAP
//    TYPES ............... element type → device class
//    createEngine / Engine
//    _build .............. devices, unknowns, matrix entries, LU
//    _newton ............. one Newton-Raphson solve (base stamps, chord steps)
//    _nlUnknowns ......... the unknowns nonlinear devices read (first-iteration exit)
//    _solveRobust ........ Newton, then gmin stepping, then source stepping
//    _start / _initSolve / dcop
//    advanceTo ........... the time loop with step control, crossHint, predictor
//    startCache / pendingSig  the start point at a breakpoint
//    _accept ............. state update, digital, breakpoints, MCUs, meters
//    frame / drainEvents / drainSerial
//    setParam / patch / press / repair / reset
//    loadProgram / serialIn / addProbe / removeProbe
//    measureR ............ zeroed sources, 1 mA test current
//    snapshotState / restoreState
//    pinSwitched ......... the PWM auto rule
//    runFor .............. test helper
// ============================================================================
import { createLU } from './solver.js';
import { Dev, GMIN, CROSS } from './devbase.js';
import { PASSIVE_TYPES } from './devices.js';
import { SOURCE_TYPES } from './sources.js';
import { SEMI_TYPES } from './semis.js';
import { ANALOG_TYPES } from './analog.js';
import { DIGITAL_TYPES } from './digital.js';
import { McuHost } from './mcuhost.js';
import { probeElements, ProbeReader } from './probes.js';

export const TYPES = { ...PASSIVE_TYPES, ...SOURCE_TYPES, ...SEMI_TYPES, ...ANALOG_TYPES, ...DIGITAL_TYPES };

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const BIG = 1 << 20;

// element types the PWM auto rule passes through (terminals all connected)
const PASS_TYPES = new Set(['resistor', 'wire', 'pot', 'switch', 'button', 'fuse', 'ameter', 'capacitor', 'inductor', 'ldr', 'thermistor', 'spdt']);
const SENSITIVE_TYPES = new Set(['led', 'diode', 'zener', 'npn', 'pnp', 'nmos', 'pmos', 'logic', 'logic-expr', 'hd44780', 'timer555', 'opamp', 'servo', 'buzzer', 'speaker', 'relay']);

export function createEngine(netlist, opts = {}) { return new Engine(netlist, opts); }

export class Engine {
  constructor(nl, opts = {}) {
    this.nl = nl;
    this.o = {
      method: 'trap', dtMax: 2e-3, dtMin: 1e-9, reltol: 1e-3, vabstol: 1e-6, abstol: 1e-12,
      trtol: 7, ltetol: 1, pwm: 'auto', tTol: 2e-8, start: 'power', maxNewton: 40,
      ...opts,
    };
    this.mcuFactory = opts.mcuFactory || null;
    this.labels = nl.labels || {};
    this.t = 0; this.tLoad = 0;
    this.events = []; this.serial = [];
    this.probeSpecs = (nl.probes || []).map(p => ({ ...p, leads: { ...(p.leads || {}) }, settings: { ...(p.settings || {}) } }));
    this.hosts = new Map();
    for (const m of nl.mcus || []) this.hosts.set(m.id, new McuHost(this, m));
    this.stats = { steps: 0, rejected: 0, newton: 0, solveMs: 0, nodes: nl.nodeCount, rejNewton: 0, rejLte: 0, rejCross: 0 };
    this.paramVersion = 0;
    this.srcFactNow = 1;
    this.started = false;
    this._mrCache = new Map();
    this._build();
    this.loadResults = {};
    for (const [id, h] of this.hosts) if (h.program) this.loadResults[id] = h.create(this.mcuFactory, 0);
  }

  // ---------------------------------------------------------------- build
  _elements() {
    const els = (this.nl.elements || []).slice();
    for (const p of this.probeSpecs) els.push(...probeElements(p));
    for (const h of this.hosts.values()) els.push(...h.elements());
    return els;
  }
  _build() {
    const N = this.nl.nodeCount;
    let nUnk = Math.max(0, N - 1);
    const nodeLike = [];
    for (let i = 0; i < nUnk; i++) nodeLike.push(true);
    const emap = new Map(), rows = [], cols = [];
    const entry = (r, c) => {
      if (r < 0 || c < 0) return -1;
      const k = r * BIG + c;
      let e = emap.get(k);
      if (e === undefined) { e = rows.length; emap.set(k, e); rows.push(r); cols.push(c); }
      return e;
    };
    const devs = [], warnings = [];
    let cur = null, used = null;
    const note = (i) => { if (i >= 0) used.push(i); return i; };
    const b = {
      node: (term) => {
        const n = cur.nodes ? cur.nodes[term] : undefined;
        if (n == null || n < 0 || n >= N) { nodeLike.push(true); return note(nUnk++); }
        return note(n === 0 ? -1 : n - 1);
      },
      has: (term) => cur.nodes && cur.nodes[term] != null,
      internal: () => { nodeLike.push(true); return note(nUnk++); },
      branch: () => { nodeLike.push(false); return note(nUnk++); },
      entry,
      pair: (a, c) => [entry(a, a), entry(a, c), entry(c, a), entry(c, c)],
      branchPair: (a, c, k) => [entry(a, k), entry(c, k), entry(k, a), entry(k, c), entry(k, k)],
    };
    for (const el of this._elements()) {
      const C = TYPES[el.type];
      if (!C) { warnings.push(`unknown element type "${el.type}" (${el.id})`); continue; }
      let d;
      try { d = new C(el, this); cur = el; used = []; d.setup(b); d.unknowns = used; }
      catch (e) { warnings.push(`${el.id}: ${e.message}`); continue; }
      devs.push(d);
    }
    // gmin on every node-like unknown, and a diagonal for every unknown
    this.nodeDiag = [];
    for (let i = 0; i < nUnk; i++) { const e = entry(i, i); if (nodeLike[i]) this.nodeDiag.push(e); }
    this.n = nUnk;
    this.nodeLike = Uint8Array.from(nodeLike);
    this.emap = emap;
    this.devs = devs;
    this.devById = new Map(devs.map(d => [d.id, d]));
    this.byOwner = new Map();
    for (const d of devs) { if (!this.byOwner.has(d.owner)) this.byOwner.set(d.owner, []); this.byOwner.get(d.owner).push(d); }
    this.digitalDevs = devs.filter(d => d.digitalDev);
    this.timedDevs = devs.filter(d => d.nextBreak !== Dev.prototype.nextBreak);
    this.lteDevs = devs.filter(d => d.lte !== Dev.prototype.lte);
    this.acceptDevs = devs.filter(d => d.accept !== Dev.prototype.accept);
    this.sigDevs = devs.filter(d => d.sig !== Dev.prototype.sig);
    this.startCache = new Map(); this.pendingSig = null;
    this.meterDevs = devs.filter(d => d.metered);
    this.nonlinear = devs.some(d => d.nonlinear);
    this.warnings = warnings;
    for (const h of this.hosts.values()) h.attach(this.devById);
    this.readers = this.probeSpecs.map(p => new ProbeReader(p, this));
    this.A = new Float64Array(rows.length);
    this.A0 = new Float64Array(rows.length);
    this.Afact = new Float64Array(rows.length);
    this.rhs = new Float64Array(nUnk);
    this.rhs0 = new Float64Array(nUnk);
    this.baseDevs = devs.filter(d => !d.nonlinear);
    this.iterDevs = devs.filter(d => d.nonlinear);
    this.nlIdx = this._nlUnknowns();
    this.rowsArr = Int32Array.from(rows); this.colsArr = Int32Array.from(cols);
    this.resid = new Float64Array(nUnk);
    this.lu = createLU(nUnk, this.rowsArr, this.colsArr);
    this.luFresh = true;
    this.xAcc = new Float64Array(nUnk);
    this.xPrev = new Float64Array(nUnk);
    this.xTrial = new Float64Array(nUnk);
    this.xNew = new Float64Array(nUnk);
    this.th = new Float64Array(4);
    this.nh = 0; this.sinceBp = 0;
    this.hNext = 1e-6;
    this._pwmCache = new Map();
    this.wireDevs = (this.nl.wireIds || []).map(id => this.devById.get(id) || null);
    this.dtMaxEff = Math.min(this.o.dtMax, ...devs.map(d => (d.dtMax ? d.dtMax() : Infinity)), ...this.probeSpecs.filter(p => p.type === 'scope').map(p => Math.max(1e-8, (+(p.settings || {}).tdiv || 1e-3) / 10)));
    this.s = {
      A: this.A, rhs: this.rhs, x: this.xTrial, h: 0, method: 'be', mode: 'tran', t: 0,
      srcFact: 1, gshunt: 0, noncon: false, reltol: this.o.reltol, trtol: this.o.trtol * this.o.ltetol,
      th: this.th, nh: 0, eng: this,
    };
  }
  // unknowns that nonlinear devices read (recorded by the builder in setup)
  _nlUnknowns() {
    const set = new Set();
    for (const d of this.iterDevs) for (const i of d.unknowns || []) set.add(i);
    return Int32Array.from(set);
  }
  entryOf(r, c) {
    if (r < 0 || c < 0) return -1;
    const e = this.emap.get(r * BIG + c);
    return e === undefined ? -1 : e;
  }
  labelOf(owner) { return this.labels[owner] || owner; }
  vNode(n) { return n > 0 ? this.xAcc[n - 1] : 0; }
  get x() { return this.xAcc; }

  _event(ev) { this.events.push(ev); if (this.events.length > 500) this.events.shift(); }
  _discontinuity() { this._bp = true; }
  _softChange() {}

  // ---------------------------------------------------------------- Newton
  _newton(s, maxIter) {
    const A = this.A, rhs = this.rhs, x = s.x, xn = this.xNew, n = this.n, lu = this.lu;
    const A0 = this.A0, rhs0 = this.rhs0, Af = this.Afact;
    const base = this.baseDevs, iter = this.iterDevs, nd = this.nodeDiag, nl = this.nodeLike;
    const { reltol, vabstol, abstol } = this.o;
    const t0 = now();
    // linear devices: stamped once per call (they do not read x)
    A0.fill(0); rhs0.fill(0);
    s.noncon = false;
    this.srcFactNow = s.srcFact;
    const gd = GMIN + s.gshunt;
    for (let i = 0; i < nd.length; i++) A0[nd[i]] += gd;
    s.A = A0; s.rhs = rhs0;
    for (let i = 0; i < base.length; i++) base[i].load(s);
    s.A = A; s.rhs = rhs;
    const nnz = A.length;
    const R = this.rowsArr, C = this.colsArr, res = this.resid;
    let chord = 0, qPrev = Infinity, wasChord = false, limPrev = true;
    for (let it = 0; it < maxIter; it++) {
      A.set(A0); rhs.set(rhs0);
      s.noncon = false;
      for (let i = 0; i < iter.length; i++) iter[i].load(s);
      this.stats.newton++;
      // chord step: keep the factors of the first iteration and solve for
      // the residual; refactor only when two chord steps do not converge
      wasChord = false;
      // chord only near the solution: the last update was small and no
      // junction was limited (else the old Jacobian can diverge)
      if (it > 0 && chord < 2 && !this.luFresh && s.mode === 'tran' && qPrev <= 50 && !limPrev) {
        chord++; wasChord = true;
        for (let i = 0; i < n; i++) res[i] = rhs[i];
        for (let k = 0; k < nnz; k++) res[R[k]] -= A[k] * x[C[k]];
        lu.solve(res, xn);
        for (let i = 0; i < n; i++) xn[i] += x[i];
      } else {
        let same = !this.luFresh && iter.length === 0;
        if (same) for (let k = 0; k < nnz; k++) if (A[k] !== Af[k]) { same = false; break; }
        if (!same) {
          let ok = this.luFresh ? lu.factor(A) : lu.refactor(A);
          if (!ok) { ok = lu.factor(A); if (!ok) { this.luFresh = true; this.stats.solveMs += now() - t0; return { ok: false, singular: true, iters: it + 1 }; } }
          this.luFresh = false;
          Af.set(A);
        }
        if (it > 0) chord = 0;
        lu.solve(rhs, xn);
      }
      let conv = !s.noncon, bad = false, q = 0;
      for (let i = 0; i < n; i++) {
        const a = xn[i];
        if (!Number.isFinite(a)) { bad = true; break; }
        const r = Math.abs(a - x[i]) / (reltol * Math.max(Math.abs(a), Math.abs(x[i])) + (nl[i] ? vabstol : Math.max(abstol, 1e-9)));
        if (r > q) q = r;
      }
      if (q > 1) conv = false;
      // a chord step converges only if it also contracts (no false stall)
      if (wasChord && conv && !(q <= 0.3 * qPrev)) conv = false;
      qPrev = q; limPrev = s.noncon;
      if (bad) { this.stats.solveMs += now() - t0; return { ok: false, iters: it + 1 }; }
      // first iteration: the linear part is exact, so only the terminals of
      // nonlinear devices decide; 0.2 mV keeps the linearization error ~1e-5
      if (it === 0 && !conv && !s.noncon && s.mode === 'tran' && this.nlIdx) {
        let ok0 = true;
        const ni = this.nlIdx;
        for (let k = 0; k < ni.length; k++) {
          const i = ni[k], d = Math.abs(xn[i] - x[i]);
          if (d > 2e-4 + reltol * Math.abs(xn[i]) * 0.1) { ok0 = false; break; }
        }
        conv = ok0;
      }
      x.set(xn);
      if (conv) { this.stats.solveMs += now() - t0; return { ok: true, iters: it + 1 }; }
    }
    this.stats.solveMs += now() - t0;
    return { ok: false, iters: maxIter };
  }

  _solveRobust(s) {
    const x0 = Float64Array.from(s.x);
    let r = this._newton(s, 100);
    if (r.ok) return { ok: true, iters: r.iters, method: 'newton' };
    let iters = r.iters;
    // gmin stepping
    s.x.set(x0);
    let ok = true;
    for (let g = 1e-2; g >= 1e-11; g /= 10) {
      s.gshunt = g;
      r = this._newton(s, 100); iters += r.iters;
      if (!r.ok) { ok = false; break; }
    }
    s.gshunt = 0;
    if (ok) { r = this._newton(s, 100); iters += r.iters; if (r.ok) return { ok: true, iters, method: 'gmin' }; }
    // source stepping
    s.x.fill(0);
    let f = 0, df = 0.1;
    s.srcFact = 0;
    r = this._newton(s, 100); iters += r.iters;
    if (r.ok) {
      const xs = Float64Array.from(s.x);
      while (f < 1 && df > 1e-4) {
        const nf = Math.min(1, f + df);
        s.srcFact = nf;
        r = this._newton(s, 60); iters += r.iters;
        if (r.ok) { f = nf; xs.set(s.x); df = Math.min(0.25, df * 1.5); }
        else { s.x.set(xs); df /= 4; }
      }
      s.srcFact = 1;
      if (f >= 1) return { ok: true, iters, method: 'source' };
    }
    s.srcFact = 1;
    return { ok: false, iters, method: 'source' };
  }

  // ------------------------------------------------------------ start / dc
  _settle(s, solve) {
    // logic and MCUs at one time point, re-solve until nothing changes
    for (let k = 0; k < 60; k++) {
      this._bp = false;
      let ch = false;
      this.xAcc.set(s.x);
      for (const d of this.digitalDevs) if (d.digital(s)) ch = true;
      for (const h of this.hosts.values()) if (h.process(this.t)) ch = true;
      if (this._bp) ch = true;
      if (!ch) return true;
      solve();
    }
    return false;
  }
  _initSolve() {
    const s = this.s;
    s.mode = 'tran'; s.method = 'be'; s.h = 1e-9; s.t = this.t; s.x = this.xTrial; s.srcFact = 1; s.gshunt = 0;
    s.th[0] = this.t; s.nh = 0;
    this.xTrial.set(this.xAcc);
    let res = this._solveRobust(s);
    this._settle(s, () => { const r = this._solveRobust(s); if (!r.ok) res = r; });
    this.xAcc.set(this.xTrial); this.xPrev.set(this.xTrial);
    for (const d of this.devs) d.meterReset(this.xAcc);
    for (const r of this.readers) r.reset(this.t);
    this.th[1] = this.t; this.nh = 1; this.sinceBp = 0;
    this.hNext = Math.min(this.dtMaxEff / 4, 1e-6);
    this.frameT0 = this.t;
    this.started = true;
    if (!res.ok) this._event({ t: this.t, kind: 'warn', severity: 'error', msg: 'The circuit has no stable starting point. Check for loops of sources or parts with no path to ground.' });
    return res;
  }
  _start() {
    this.tLoad = this.t;
    if (this.o.start === 'dcop') return this.dcop();
    return this._initSolve();
  }
  dcop() {
    const s = this.s;
    s.mode = 'dc'; s.method = 'be'; s.h = 1; s.t = this.t; s.x = this.xTrial; s.srcFact = 1; s.gshunt = 0;
    this.xTrial.set(this.xAcc);
    let res = this._solveRobust(s);
    this._settle(s, () => { const r = this._solveRobust(s); if (!r.ok) res = r; });
    this.xAcc.set(this.xTrial); this.xPrev.set(this.xTrial);
    for (const d of this.devs) d.acceptDC(s);
    for (const d of this.devs) d.meterReset(this.xAcc);
    for (const r of this.readers) r.reset(this.t);
    this.th[1] = this.t; this.nh = 1; this.sinceBp = 0;
    this.hNext = Math.min(this.dtMaxEff / 4, 1e-6);
    this.frameT0 = this.t;
    this.started = true;
    s.mode = 'tran';
    return { ok: res.ok, iters: res.iters, method: res.method };
  }

  // ------------------------------------------------------------- time loop
  _nextBreak() {
    let tb = Infinity;
    const t = this.t;
    for (const d of this.timedDevs) { const b = d.nextBreak(t); if (b < tb) tb = b; }
    for (const h of this.hosts.values()) { const w = h.nextWake(); if (w > t && w < tb) tb = w; }
    return tb;
  }
  advanceTo(tEnd, budgetMs) {
    const wall0 = now();
    let steps = 0, rejected = 0;
    if (!this.started) this._start();
    const s = this.s, o = this.o;
    let guard = 0;
    while (this.t < tEnd - 1e-15 * Math.max(1, tEnd)) {
      if (budgetMs != null && (steps & 7) === 0 && now() - wall0 > budgetMs) break;
      if (++guard > 5e6) break;
      const t = this.t;
      const tb = this._nextBreak();
      const hPlan = Math.min(this.hNext, this.dtMaxEff);
      let h = Math.min(hPlan, tEnd - t);
      let toBp = false, cut = h < hPlan;
      // walk up to a predicted logic crossing instead of jumping over it
      if (this.crossHint != null) {
        if (this.crossHint <= t) this.crossHint = null;
        else { const hc = this.crossHint - t + o.tTol * 0.5; if (hc < h) { h = hc; cut = true; } }
      }
      if (tb - t <= h * 1.000001) { h = tb - t; toBp = true; cut = true; }
      else if (tb - t < 2 * h) { h = (tb - t) / 2; cut = true; }
      if (h <= 0) { h = Math.max(o.dtMin, 1e-15); }
      let tries = 0, accepted = false, lastFrac = 2;
      while (!accepted) {
        tries++;
        const method = this.sinceBp < 2 ? 'be' : o.method;
        s.mode = 'tran'; s.method = method; s.h = h; s.t = t + h; s.x = this.xTrial;
        s.srcFact = 1; s.gshunt = 0;
        s.th[0] = t + h; s.nh = this.nh;
        // predictor: linear extrapolation of the last two points (not across a breakpoint)
        const xt = this.xTrial, xa = this.xAcc;
        if (this.sinceBp >= 2 && this.hLast > 0) {
          const xp = this.xPrev, nn = this.n;
          let k = h / this.hLast;
          for (let i = 0; i < nn; i++) xt[i] = xa[i] + (xa[i] - xp[i]) * k;
          // look ahead: if the predicted end state crosses a logic threshold,
          // aim the step at the predicted crossing before solving
          if (tries === 1 && this.digitalDevs.length) {
            CROSS.xp = xp; CROSS.k = k;
            let fr = 2;
            for (const d of this.digitalDevs) { const f = d.cross(xa, xt); if (f < fr) fr = f; }
            CROSS.xp = null;
            if (fr <= 1 && (1 - fr) * h > o.tTol) {
              const hn = Math.max(o.dtMin, fr * h + o.tTol * 0.5);
              if (hn < h) {
                h = hn; toBp = false; cut = true;
                s.h = h; s.t = t + h; s.th[0] = t + h;
                k = h / this.hLast;
                for (let i = 0; i < nn; i++) xt[i] = xa[i] + (xa[i] - xp[i]) * k;
              }
            }
          }
        } else {
          xt.set(xa);
          // right after a breakpoint: start from the solution seen last time
          // the circuit was in this switching state (periodic circuits)
          if (this.sinceBp === 0 && this.pendingSig != null) {
            const c = this.startCache.get(this.pendingSig);
            if (c && c.length === xt.length) { const ni = this.nlIdx; for (let k = 0; k < ni.length; k++) xt[ni[k]] = c[ni[k]]; }
          }
        }
        const r = this._newton(s, o.maxNewton);
        if (!r.ok) {
          rejected++; this.stats.rejNewton++;
          if (h <= o.dtMin * 1.0001 || tries > 30) {
            // give up on this point: hold the old solution and move on
            this._event({ t: t + h, kind: 'warn', severity: 'warn', msg: `The solver did not converge at t = ${(t + h).toExponential(3)} s.` });
            this.xTrial.set(this.xAcc);
            this._accept(h, true);
            accepted = true; break;
          }
          h = Math.max(o.dtMin, h / 8); toBp = false;
          continue;
        }
        // local truncation error
        let ratio = 0;
        if (this.lteDevs.length && this.nh >= 2) {
          for (const d of this.lteDevs) { const q = d.lte(s); if (q > ratio) ratio = q; }
        }
        const order = method === 'trap' ? 2 : 1;
        if (ratio > 1 && h > o.dtMin * 2 && tries < 40) {
          rejected++; this.stats.rejLte++;
          h = Math.max(o.dtMin, h * Math.max(0.1, 0.9 * Math.pow(ratio, -1 / (order + 1))));
          toBp = false;
          continue;
        }
        // a logic input crosses inside the step: land just past it
        let frac = 2;
        if (this.sinceBp >= 2 && this.hLast > 0) { CROSS.xp = this.xPrev; CROSS.k = h / this.hLast; } else { CROSS.xp = null; CROSS.k = 0; }
        for (const d of this.digitalDevs) { const f = d.cross(this.xAcc, this.xTrial); if (f < frac) frac = f; }
        CROSS.xp = null;
        // the same fraction at a shorter step means the input jumped at the
        // step start (an output switched at the breakpoint): accept it
        const jump = frac <= 1 && lastFrac <= 1 && Math.abs(frac - lastFrac) < 1e-3;
        lastFrac = frac;
        if (frac <= 1 && !jump && (1 - frac) * h > o.tTol && tries < 40) {
          this.crossHint = t + frac * h;
          // aim a little short of a far crossing (that step is progress), then
          // close the small gap: a short secant lands within tTol
          const hc = frac * h;
          const hn = Math.max(Math.min(o.dtMin, h), hc > 100 * o.tTol ? hc * 0.995 : hc + o.tTol * 0.5);
          if (hn < h * 0.999999) { h = hn; toBp = false; rejected++; this.stats.rejCross++; continue; }
        }
        const grow = ratio > 0 ? Math.min(ratio < 1e-3 ? 4 : 2, 0.9 * Math.pow(ratio, -1 / (order + 1))) : (this.sinceBp < 3 ? 4 : 2);
        const hn = Math.max(o.dtMin, h * Math.max(0.3, grow));
        if (cut && tries === 1 && ratio <= 1) {
          // a truncated step (breakpoint, crossing, frame end): keep the plan
          this.hNext = Math.max(hn, Math.min(hPlan, this.hReg || hPlan));
        } else { this.hNext = hn; if (tries === 1 && !cut) this.hReg = hn; }
        if (this.sinceBp === 0 && this.pendingSig != null) {
          if (this.startCache.size > 64) this.startCache.delete(this.startCache.keys().next().value);
          this.startCache.set(this.pendingSig, Float64Array.from(this.xTrial));
          this.pendingSig = null;
        }
        this._accept(h, false);
        this.hLast = h;
        accepted = true;
      }
      steps++;
    }
    this.stats.steps += steps; this.stats.rejected += rejected;
    return { t: this.t, steps, rejected, done: this.t >= tEnd - 1e-15 * Math.max(1, tEnd) };
  }

  _accept(h, forced) {
    const s = this.s;
    const t0 = this.t, t1 = t0 + h;
    this.xPrev.set(this.xAcc);
    this.xAcc.set(this.xTrial);
    this.t = t1;
    s.t = t1; s.h = h; s.x = this.xAcc;
    this._bp = false;
    const ad = this.acceptDevs, md = this.meterDevs;
    for (let i = 0; i < ad.length; i++) ad[i].accept(s);
    for (let i = 0; i < md.length; i++) md[i].meter(this.xAcc, h);
    for (const r of this.readers) r.sample(t0, this.xPrev, t1, this.xAcc);
    // time history for the LTE estimate
    this.th[3] = this.th[2]; this.th[2] = this.th[1]; this.th[1] = t1;
    // logic, timed devices, MCUs
    let bp = this._bp;
    for (const d of this.digitalDevs) if (d.digital(s)) bp = true;
    const eps = 1e-12 * Math.max(1, t1) + 1e-15;
    for (const d of this.timedDevs) {
      const b = d.nextBreak(t0);
      if (b <= t1 + eps && d.fire(t1)) bp = true;
    }
    for (const hst of this.hosts.values()) if (hst.process(t1)) bp = true;
    if (this._bp) bp = true;
    if (bp || forced) {
      this.sinceBp = 0; this.nh = 1; this.crossHint = null;
      if (this.sigDevs.length) { let g = ''; for (const d of this.sigDevs) g += d.sig() + ','; this.pendingSig = g; }
      const hb = this.hReg || h;
      this.hNext = Math.max(this.o.dtMin * 4, Math.min(hb / 64, 1e-5, this.dtMaxEff / 4));
    } else {
      this.sinceBp++; this.nh = Math.min(3, this.nh + 1);
    }
  }

  // ----------------------------------------------------------------- frame
  frame() {
    const x = this.xAcc;
    const win = Math.max(0, this.t - (this.frameT0 ?? this.t));
    const N = this.nl.nodeCount;
    const nodeV = new Float32Array(N);
    for (let i = 1; i < N; i++) nodeV[i] = x[i - 1];
    const wires = new Float32Array(this.wireDevs.length);
    this.wireDevs.forEach((d, i) => { if (d) wires[i] = d.metered && win > 0 ? d.accI / win : d.current(x); });
    const parts = {};
    const skip = new Set([...(this.nl.wireIds || []), ...this.probeSpecs.map(p => p.id)]);
    for (const [owner, list] of this.byOwner) {
      if (skip.has(owner)) continue;
      const main = list.find(d => d.id === owner + '/main') || list.find(d => !d.id.includes('/pin:') && !d.id.endsWith('/core')) || list[0];
      const avg = d => (d.metered && win > 0 ? d.accI / win : d.current(x));
      const pf = { i: avg(main), p: 0, temp: 25, damaged: null };
      const vis = {};
      const leds = list.filter(d => d.type === 'led');
      const singleLed = leds.length === 1 && (leds[0].vis == null || leds[0].vis === 'main' || leds[0].id === owner + '/main');
      for (const d of list) {
        pf.p += d.metered && win > 0 ? d.accP / win : d.power(x);
        if (d.temp > pf.temp) pf.temp = d.temp;
        if (d.damaged && !pf.damaged) pf.damaged = d.damaged;
        if (d.type === 'led') {
          const b = d.damaged ? 0 : Math.min(1.5, Math.max(0, avg(d)) / 0.02);
          if (singleLed) { vis.b = b; vis.color = d.p.color; }
          else {
            const key = d.vis || d.id.slice(d.id.indexOf('/') + 1);
            (vis.leds || (vis.leds = {}))[key] = b;
            if (key === 'bl') vis.backlight = b;
          }
        } else d.frameVis(vis, avg(d), d.metered && win > 0 ? d.accP / win : d.power(x), win);
      }
      if (Object.keys(vis).length) pf.vis = vis;
      parts[owner] = pf;
    }
    const probes = {};
    for (const r of this.readers) probes[r.id] = r.frame(x);
    const mcus = {};
    for (const [id, h] of this.hosts) mcus[id] = h.state();
    for (const d of this.devs) { d.accI = 0; d.accP = 0; }
    this.frameT0 = this.t;
    return {
      t: this.t, speed: 1, ratio: 1, running: true, nodeV, wires, parts, probes, mcus,
      stats: { ...this.stats, nodes: N, unknowns: this.n },
    };
  }
  drainEvents() { const e = this.events; this.events = []; return e; }
  drainSerial() { const e = this.serial; this.serial = []; return e; }
  v(node) { return this.vNode(node); }
  i(id) {
    const d = this.devById.get(id);
    if (d) return d.current(this.xAcc);
    const list = this.byOwner.get(id);
    return list ? list[0].current(this.xAcc) : 0;
  }
  dev(id) { return this.devById.get(id); }

  // ------------------------------------------------------- live interaction
  _paramBp() {
    this.sinceBp = 0; this.nh = 1;
    this.hNext = Math.max(this.o.dtMin * 4, Math.min(this.hNext, 1e-5));
    this.paramVersion++;
    this._mrCache.clear();
  }
  setParam(owner, key, value) {
    let hit = false;
    for (const d of this.byOwner.get(owner) || []) {
      const bind = d.el.bind || {};
      let done = false;
      for (const ek in bind) if (bind[ek] === key) { setPath(d.p, ek, value); d.paramChanged(ek); done = true; }
      if (!done && Object.prototype.hasOwnProperty.call(d.p, key) && !Object.values(bind).includes(key)) { d.p[key] = value; d.paramChanged(key); done = true; }
      if (done) { hit = true; d.el.params = { ...(d.el.params || {}), ...(bind[key] ? {} : {}) }; }
    }
    if (hit) {
      // keep the netlist in step so a rebuild keeps the value
      for (const el of this.nl.elements || []) {
        if (el.owner !== owner) continue;
        const bind = el.bind || {};
        for (const ek in bind) if (bind[ek] === key) { el.params = el.params || {}; setPath(el.params, ek, value); }
      }
      this._paramBp();
    }
    return hit;
  }
  patch(owner, elements) {
    const byId = new Map((elements || []).map(e => [e.id, e]));
    let n = 0;
    this.nl.elements = (this.nl.elements || []).map(e => { const r = byId.get(e.id); if (r && r.type === e.type) { n++; return { ...e, params: r.params, bind: r.bind || e.bind, vis: r.vis ?? e.vis }; } return e; });
    if (n) this._rebuild();
    return n;
  }
  press(id, on) {
    let hit = false;
    const d = this.devById.get(id);
    const list = d && d.setPressed ? [d] : (this.byOwner.get(id) || []).filter(x => x.setPressed);
    for (const b of list) { b.setPressed(on, this.t); hit = true; }
    if (hit) this._paramBp();
    return hit;
  }
  repair(owner) {
    for (const d of this.byOwner.get(owner) || []) d.repair();
    this._paramBp();
  }
  reset() {
    this.t = 0; this.tLoad = 0;
    this.events = []; this.serial = [];
    for (const d of this.devs) d.resetState();
    this.xAcc.fill(0); this.xTrial.fill(0);
    for (const h of this.hosts.values()) { h.error = null; h.create(this.mcuFactory, 0); }
    this.started = false;
    this.paramVersion++; this._mrCache.clear();
  }
  loadProgram(mcuId, program) {
    const h = this.hosts.get(mcuId);
    if (!h) return { ok: false, errors: [{ line: 0, col: 0, msg: `no board "${mcuId}"` }] };
    h.program = program;
    h.allPins({ mode: 'in' });
    const r = h.create(this.mcuFactory, this.t);
    this._paramBp();
    return r;
  }
  serialIn(mcuId, text) {
    const h = this.hosts.get(mcuId);
    if (h && h.mcu && h.mcu.serialIn) h.mcu.serialIn(text);
  }
  addProbe(probe) {
    this.probeSpecs = this.probeSpecs.filter(p => p.id !== probe.id);
    this.probeSpecs.push({ ...probe, leads: { ...(probe.leads || {}) }, settings: { ...(probe.settings || {}) } });
    this._rebuild();
  }
  removeProbe(id) {
    this.probeSpecs = this.probeSpecs.filter(p => p.id !== id);
    this._rebuild();
  }
  _rebuild() {
    const snap = this.snapshotState();
    this._build();
    this.restoreState(snap);
  }

  // ------------------------------------------------------------- measureR
  measureR(nodeA, nodeB) {
    if (nodeA == null || nodeB == null) return Infinity;
    if (nodeA === nodeB) return 0;
    const key = `${nodeA}|${nodeB}|${this.paramVersion}`;
    if (this._mrCache.has(key)) return this._mrCache.get(key);
    const els = [];
    for (const el of this.nl.elements || []) {
      const e = { ...el, params: { ...(el.params || {}) } };
      switch (el.type) {
        case 'vsource': e.params = { rint: el.params.rint || 0, wave: { kind: 'dc', v: 0 } }; break;
        case 'battery': e.params.v = 0; break;
        case 'supply': e.params.on = false; break;
        case 'usbpower': e.params.usb = false; break;
        case 'isource': e.params.i = 0; break;
        case 'solar': e.params.lux = 0; break;
        default: break;
      }
      els.push(e);
    }
    els.push({ id: '__ohm', owner: '__ohm', type: 'isource', nodes: { p: nodeA, n: nodeB }, params: { i: 1e-3 } });
    const sub = new Engine({ ...this.nl, elements: els, probes: [], mcus: [] }, { start: 'dcop' });
    for (const d of sub.devs) { const o = this.devById.get(d.id); if (o && o.damaged) d.damaged = o.damaged; }
    const r = sub.dcop();
    let R = r.ok ? (sub.vNode(nodeA) - sub.vNode(nodeB)) / 1e-3 : Infinity;
    if (!(R < 1e9)) R = Infinity;
    if (R < 0) R = Math.abs(R);
    this._mrCache.set(key, R);
    return R;
  }

  // --------------------------------------------------------- state carry
  snapshotState() {
    const devs = {};
    for (const d of this.devs) devs[d.id] = { type: d.type, st: d.save() };
    const hosts = {};
    for (const [id, h] of this.hosts) hosts[id] = { mcu: h.mcu, program: h.program, brownout: h.brownout, error: h.error, everRan: h.everRan };
    return { t: this.t, devs, hosts, started: this.started, tLoad: this.tLoad };
  }
  restoreState(snap) {
    if (!snap) return;
    this.t = snap.t || 0;
    for (const d of this.devs) {
      const s = snap.devs[d.id];
      if (s && s.type === d.type) d.restore(s.st);
    }
    for (const [id, h] of this.hosts) {
      const o = snap.hosts && snap.hosts[id];
      if (o && o.mcu && JSON.stringify(o.program) === JSON.stringify(h.program || o.program)) {
        h.mcu = o.mcu; h.program = o.program; h.brownout = o.brownout; h.error = o.error; h.everRan = o.everRan;
      }
    }
    // restore pin configs after hosts were attached (saved inside pin devices)
    if (snap.started) {
      this.tLoad = this.t;
      this._initSolve();
    }
  }

  // ---------------------------------------------------------- PWM rule
  pinSwitched(mcuId, pin) {
    if (this.o.pwm === 'switch') return true;
    if (this.o.pwm === 'average') return false;
    const key = mcuId + '.' + pin;
    if (this._pwmCache.has(key)) return this._pwmCache.get(key);
    const h = this.hosts.get(mcuId);
    const start = h && h.spec.pins ? h.spec.pins[pin] : null;
    let res = false;
    if (start != null && start > 0) {
      const adj = new Map(), sens = new Set();
      const add = (a, b) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); };
      for (const el of this._elements()) {
        const nodes = Object.values(el.nodes || {}).filter(n => n != null && n > 0);
        if (el.type === 'mcupin') { if (el.id !== `${mcuId}/pin:${pin}`) sens.add(el.nodes.p); continue; }
        if (SENSITIVE_TYPES.has(el.type)) nodes.forEach(n => sens.add(n));
        if (el.type === 'vmeter' && /\/(ch\d|d\d)$/.test(el.id)) sens.add(el.nodes.a);
        if (PASS_TYPES.has(el.type)) for (const a of nodes) for (const b of nodes) if (a !== b) add(a, b);
      }
      const seen = new Set([start]), q = [start];
      while (q.length) {
        const n = q.pop();
        if (sens.has(n)) { res = true; break; }
        for (const m of adj.get(n) || []) if (!seen.has(m)) { seen.add(m); q.push(m); }
      }
    }
    this._pwmCache.set(key, res);
    return res;
  }
}

function setPath(obj, path, value) {
  const ks = String(path).split('.');
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) { if (typeof o[ks[i]] !== 'object' || o[ks[i]] == null) o[ks[i]] = {}; o = o[ks[i]]; }
  o[ks[ks.length - 1]] = value;
}

export function runFor(netlist, seconds, opts = {}) {
  const eng = createEngine(netlist, opts);
  if (opts.dcop) eng.dcop();
  const frames = [];
  const fdt = opts.frameDt ?? 1 / 30;
  while (eng.t < seconds - 1e-12) {
    eng.advanceTo(Math.min(seconds, eng.t + fdt));
    const f = eng.frame();
    f.events = eng.drainEvents();
    frames.push(f);
  }
  return { eng, frames };
}
