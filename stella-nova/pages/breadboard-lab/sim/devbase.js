// ============================================================================
//  BREADBOARD LAB  ·  sim/devbase.js — the device base class and stamp helpers
// ----------------------------------------------------------------------------
//  Every netlist element becomes one DEVICE. A device owns its terminals, its
//  extra unknowns (internal nodes and branch currents) and its state. The
//  engine (sim/engine.js) calls the same hooks on every device:
//
//    setup(b) ......... ask for unknowns and matrix entries (once per build)
//    load(s) .......... stamp the linearized device into s.A and s.rhs
//    lte(s) ........... local truncation error ratio (error / tolerance)
//    accept(s) ........ the step is good: move state, damage, meters
//    cross(xo, xn) .... fraction of the step where a logic input crosses
//    digital(s) ....... update logic state at an accepted time point
//    nextBreak(t) ..... the next time this device needs a time point
//    fire(t) .......... the device reached its time point
//
//  SIGN RULE. The matrix row of a node is "current that leaves the node into
//  devices = current that sources push in". A current I that flows inside a
//  device from terminal a to terminal b leaves node a. stampI(rhs, a, b, I)
//  writes a constant one. A branch unknown k carries the current from its
//  first terminal through the device to its second terminal.
//
//  GREP MAP
//    VT / KELVIN ......... thermal voltage at 300 K
//    softplus / sigmoid .. smooth limits used by the behavioural models
//    pnjlim / pnj ........ junction voltage limiting for Newton steps
//    CROSS / crossFrac ... crossing fraction (linear, or Hermite quadratic)
//    Dev ................. the base class with default hooks and meters
//                          (nonlinear, metered, digitalDev flags; sig())
//    Builder hooks ....... b.node / b.internal / b.branch / b.entry / b.pair
//    stampG / stampI / stampVCCS / stampBranch  the stamp helpers
//    dd2 / dd3 / lteRatio  divided differences for step control
// ============================================================================

export const VT = 0.025852; // k·T/q at 300 K
export const GMIN = 1e-12;

export function softplus(x) {
  return x > 30 ? x : x < -30 ? Math.exp(x) : Math.log1p(Math.exp(x));
}
export function sigmoid(x) {
  return x > 30 ? 1 : x < -30 ? Math.exp(x) : 1 / (1 + Math.exp(-x));
}
// Smooth min of a and b with width s: returns value, d/da, d/db.
export function softmin(a, b, s) {
  const u = (a - b) / s;
  const sp = softplus(u), sg = sigmoid(u);
  return [a - s * sp, 1 - sg, sg];
}
export function softmax(a, b, s) {
  const u = (b - a) / s;
  const sp = softplus(u), sg = sigmoid(u);
  return [a + s * sp, 1 - sg, sg];
}

// Junction limiting: keep the exponential from running away between Newton
// iterations. Returns [vLimited, limited].
export function pnjlim(vnew, vold, vt, vcrit) {
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / vt;
      return arg > 0 ? [vold + vt * Math.log(arg), true] : [vcrit, true];
    }
    return [vt * Math.log(vnew / vt), true];
  }
  return [vnew, false];
}
// Same rule without an array: returns the limited voltage, sets LIMIT.hit.
export const LIMIT = { hit: false };
export function pnj(vnew, vold, vt, vcrit) {
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
    LIMIT.hit = true;
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / vt;
      return arg > 0 ? vold + vt * Math.log(arg) : vcrit;
    }
    return vt * Math.log(vnew / vt);
  }
  LIMIT.hit = false;
  return vnew;
}
export function vcritOf(is, nvt) { return nvt * Math.log(nvt / (Math.SQRT2 * is)); }

// Limit the change of a gate or control voltage per iteration.
export function stepLimit(vnew, vold, maxStep) {
  const d = vnew - vold;
  if (d > maxStep) return [vold + maxStep, true];
  if (d < -maxStep) return [vold - maxStep, true];
  return [vnew, false];
}

export const vat = (x, i) => (i >= 0 ? x[i] : 0);

// Crossing context: the engine sets xp (the accepted point before xo) and
// k = h / hLast before it calls cross(). A detector that can evaluate its
// signed distance u at xp gets a Hermite quadratic estimate (u0, slope from
// the backward difference, u1) instead of a straight line.
export const CROSS = { xp: null, k: 0 };
export function crossFrac(u0, u1, up) {
  if (u0 === u1) return 1;
  const lin = Math.min(1, Math.max(0, u0 / (u0 - u1)));
  if (up === undefined || CROSS.xp === null || !(CROSS.k > 0)) return lin;
  const sl = (u0 - up) * CROSS.k, a = u1 - u0 - sl;
  // u0 + sl·τ + a·τ² = 0, smallest root in (0, 1]
  let r = -1;
  if (Math.abs(a) < 1e-12 * (Math.abs(sl) + Math.abs(u0) + 1e-30)) r = sl !== 0 ? -u0 / sl : -1;
  else {
    const D = sl * sl - 4 * a * u0;
    if (D >= 0) {
      const q = -0.5 * (sl + Math.sign(sl || 1) * Math.sqrt(D));
      const r1 = q / a, r2 = q !== 0 ? u0 / q : -1;
      for (const c of [r1, r2]) if (c > 0 && c <= 1 && (r < 0 || c < r)) r = c;
    }
  }
  return r > 0 && r <= 1 ? r : lin;
}

export function stampG(A, h, g) {
  if (h[0] >= 0) A[h[0]] += g;
  if (h[1] >= 0) A[h[1]] -= g;
  if (h[2] >= 0) A[h[2]] -= g;
  if (h[3] >= 0) A[h[3]] += g;
}
// constant current I flowing a -> b inside the device
export function stampI(rhs, a, b, I) {
  if (a >= 0) rhs[a] -= I;
  if (b >= 0) rhs[b] += I;
}
// current gm·(v(c) - v(d)) flowing a -> b inside the device; h from b.vccs
export function stampVCCS(A, h, gm) {
  if (h[0] >= 0) A[h[0]] += gm;
  if (h[1] >= 0) A[h[1]] -= gm;
  if (h[2] >= 0) A[h[2]] -= gm;
  if (h[3] >= 0) A[h[3]] += gm;
}

// Divided differences on the engine time history.
// xs: [x(t0), x(t1), x(t2), x(t3)], ts likewise, t0 newest.
export function dd2(x0, x1, x2, t0, t1, t2) {
  const a = (x0 - x1) / (t0 - t1), b = (x1 - x2) / (t1 - t2);
  return (a - b) / (t0 - t2);
}
export function dd3(x0, x1, x2, x3, t0, t1, t2, t3) {
  return (dd2(x0, x1, x2, t0, t1, t2) - dd2(x1, x2, x3, t1, t2, t3)) / (t0 - t3);
}
// Error ratio for one state variable. hist = [x1, x2, x3] (older values),
// s.th = [t0, t1, t2, t3], s.nh = number of valid older points.
export function lteRatio(s, x0, hist, abstol) {
  const h = s.h, th = s.th;
  const tol = s.reltol * Math.max(Math.abs(x0), Math.abs(hist[0])) + abstol;
  if (s.method === 'trap') {
    if (s.nh < 3) return 0;
    const d = dd3(x0, hist[0], hist[1], hist[2], th[0], th[1], th[2], th[3]);
    return Math.abs(h * h * h * d * 0.5) / (tol * s.trtol);
  }
  if (s.nh < 2) return 0;
  const d = dd2(x0, hist[0], hist[1], th[0], th[1], th[2]);
  return Math.abs(h * h * d) / (tol * s.trtol);
}
export function pushHist(hist, v) { hist[2] = hist[1]; hist[1] = hist[0]; hist[0] = v; }

// Thermal model: C·dT/dt = P − (T − 25)/Rth. tau = Rth·C.
export function thermalStep(T, P, rth, tau, dt) {
  const Tss = 25 + P * rth;
  const a = Math.exp(-dt / tau);
  return Tss + (T - Tss) * a;
}

export class Dev {
  constructor(el, eng) {
    this.el = el;
    this.id = el.id;
    this.owner = el.owner;
    this.type = el.type;
    this.vis = el.vis;
    this.eng = eng;
    this.p = Object.assign({}, this.constructor.defaults || {}, el.params || {});
    this.damaged = null;
    this.temp = 25;
    this.accI = 0; this.accP = 0; this.lastI = 0; this.lastP = 0;
    this.nonlinear = false;   // load() reads x: stamped every Newton iteration
    this.digitalDev = false;
    this.metered = false;     // keep frame averages of i and p (LEDs, wires, supplies)
  }
  setup(b) {}
  load(s) {}
  lte(s) { return 0; }
  accept(s) {}
  acceptDC(s) {}  // DC commits state only; no damage or thermal step
  // instantaneous main current and power for the solution x
  current(x) { return 0; }
  power(x) { return 0; }
  nextBreak(t) { return Infinity; }
  fire(t) { return false; }
  cross(xo, xn) { return 2; }
  digital(s) { return false; }
  paramChanged(key) {}
  // discrete switching state (outputs, contacts) for the start-point cache
  sig() { return ''; }
  repair() { this.damaged = null; this.temp = 25; }
  resetState() { this.repair(); }
  save() { return { damaged: this.damaged, temp: this.temp }; }
  restore(st) { if (st) { this.damaged = st.damaged ?? null; this.temp = st.temp ?? 25; } }
  // frame accumulation (called by the engine after accept)
  meter(x, h) {
    if (!this.metered) return;
    const i = this.current(x), p = this.power(x);
    this.accI += 0.5 * (i + this.lastI) * h;
    this.accP += 0.5 * (p + this.lastP) * h;
    this.lastI = i; this.lastP = p;
  }
  meterReset(x) { this.lastI = this.current(x); this.lastP = this.power(x); this.accI = 0; this.accP = 0; }
  // write vis fields for the frame; avgI / avgP are window averages
  frameVis(vis, avgI, avgP, win) {}
  damage(kind, msg, smoke, t) {
    if (this.damaged) return;
    this.damaged = kind;
    this.eng._event({ t, kind: 'damage', owner: this.owner, element: this.id, severity: 'error', msg, smoke: !!smoke });
    this.eng._discontinuity();
  }
  label() { return this.eng.labelOf(this.owner); }
}
