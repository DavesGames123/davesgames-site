// ============================================================================
//  BREADBOARD LAB  ·  sim/devices.js — passive and electromechanical devices
// ----------------------------------------------------------------------------
//  Linear parts, switches, reactive parts and the parts that move or make a
//  sound. Each class follows the hook list in sim/devbase.js.
//
//  REACTIVE PARTS. A capacitor is a companion model: a conductance plus a
//  history current (trapezoid, or backward Euler for the first steps after a
//  breakpoint). Its series ESR folds into the same Norton pair, so it needs
//  no internal node. An inductor, a relay coil and a motor keep a branch
//  current unknown, so a short and an ideal coil stay exact.
//
//  THE MOTOR is two equations on two unknowns: the winding current i and
//  the shaft speed ω. Electrical: v = R·i + L·di/dt + ke·ω. Mechanical:
//  J·dω/dt = ke·i − b·ω − load·tanh(ω/0.5). In steady state ω = (v − i·R)/ke.
//
//  DAMAGE. Resistors and pots heat with a first-order thermal model and burn
//  near 1 s at 4 × pmax. A polarized capacitor reversed past 1 V for 0.5 s
//  vents. A fuse and a meter fuse blow by i²t. A lamp blows at 3 × its power.
//
//  GREP MAP
//    TwoTerm ............. the base of two-terminal conductances
//    Resistor / Wire / Pot / Ldr / Thermistor
//    Capacitor / Inductor
//    Switch / Spdt / Button (bounce schedule)
//    Relay ............... coil branch, pick and drop, contact travel time
//    Motor ............... branch current plus shaft speed unknown
//    Servo ............... pulse width in (544–2400 µs = 0–180°), horn angle out
//    FreqMeter / Buzzer / Speaker   tone frequency from the current
//    Lamp / Fuse / TempSensor
//    VMeter / AMeter ..... the probe elements
//    PASSIVE_TYPES ....... type name → class
// ============================================================================
import {
  Dev, vat, stampG, stampI, lteRatio, pushHist, thermalStep, softplus, sigmoid, crossFrac, CROSS,
} from './devbase.js';


export class TwoTerm extends Dev {
  setup(b) {
    this.ia = b.node('a'); this.ib = b.node('b');
    this.h = b.pair(this.ia, this.ib);
  }
  vab(x) { return vat(x, this.ia) - vat(x, this.ib); }
  g() { return 0; }
  load(s) { const g = this.g(); if (g) stampG(s.A, this.h, g); }
  current(x) { return this.vab(x) * this.g(); }
  power(x) { const v = this.vab(x); return v * v * this.g(); }
}

// ---------------------------------------------------------------- resistor
export class Resistor extends TwoTerm {
  static defaults = { r: 1000, pmax: 0.25 };
  g() { return this.damaged ? 0 : 1 / Math.max(Math.abs(this.p.r), 1e-6); }
  accept(s) {
    if (this.damaged) return;
    const P = this.power(s.x), pmax = this.p.pmax || 0.25;
    if (P < 0.2 * pmax && this.temp <= 25.5) { this.temp = 25; return; }
    this.temp = thermalStep(this.temp, P, 100 / pmax, 1.02, s.h);
    if (this.temp > 25 + 250) {
      this.damage('burnt', `${this.label()} burned: ${P.toFixed(2)} W in a ${pmax} W resistor. Use a larger resistor or a higher power rating.`, true, s.t);
    }
  }
}

export class Wire extends TwoTerm {
  static defaults = { r: 0.02, imax: 3 };
  constructor(el, eng) { super(el, eng); this.hot = 0; this.warned = false; this.metered = true; }
  g() { return 1 / Math.max(this.p.r, 1e-6); }
  accept(s) {
    const i = Math.abs(this.current(s.x));
    if (i > this.p.imax) this.hot += s.h; else this.hot = Math.max(0, this.hot - s.h);
    if (this.hot > 1 && !this.warned) {
      this.warned = true;
      this.eng._event({ t: s.t, kind: 'warn', owner: this.owner, severity: 'warn', msg: `Wire ${this.owner} carries ${i.toFixed(1)} A. Jumper wires are rated about ${this.p.imax} A.` });
    }
  }
}

export class Ldr extends TwoTerm {
  static defaults = { lux: 100, r10: 10000, gamma: 0.7 };
  constructor(el, eng) { super(el, eng); this.nonlinear = false; }
  g() {
    const lux = Math.min(1e5, Math.max(0.1, this.p.lux));
    return 1 / (this.p.r10 * Math.pow(lux / 10, -this.p.gamma));
  }
}

export class Thermistor extends TwoTerm {
  static defaults = { r25: 10000, beta: 3950, tempC: 25 };
  resistance() { const T = this.p.tempC + 273.15; return this.p.r25 * Math.exp(this.p.beta * (1 / T - 1 / 298.15)); }
  g() { return 1 / this.resistance(); }
}

// --------------------------------------------------------------------- pot
export class Pot extends Dev {
  static defaults = { r: 10000, pos: 0.5, taper: 'lin', pmax: 0.5 };
  setup(b) {
    this.ia = b.node('a'); this.iw = b.node('w'); this.ib = b.node('b');
    this.h1 = b.pair(this.ia, this.iw); this.h2 = b.pair(this.iw, this.ib);
  }
  frac() {
    const pos = Math.min(1, Math.max(0, +this.p.pos));
    return this.p.taper === 'log' ? (Math.pow(10, 2 * pos) - 1) / 99 : pos;
  }
  gs() {
    if (this.damaged) return [0, 0];
    const f = this.frac(), r = this.p.r, rmin = Math.max(0.5, r * 1e-4);
    return [1 / Math.max(rmin, f * r), 1 / Math.max(rmin, (1 - f) * r)];
  }
  load(s) { const [g1, g2] = this.gs(); stampG(s.A, this.h1, g1); stampG(s.A, this.h2, g2); }
  current(x) { const [g1] = this.gs(); return (vat(x, this.ia) - vat(x, this.iw)) * g1; }
  power(x) {
    const [g1, g2] = this.gs();
    const v1 = vat(x, this.ia) - vat(x, this.iw), v2 = vat(x, this.iw) - vat(x, this.ib);
    return v1 * v1 * g1 + v2 * v2 * g2;
  }
  accept(s) {
    if (this.damaged) return;
    const P = this.power(s.x), pmax = this.p.pmax || 0.5;
    this.temp = thermalStep(this.temp, P, 100 / pmax, 1.02, s.h);
    if (this.temp > 275) this.damage('burnt', `${this.label()} burned: ${P.toFixed(2)} W in a ${pmax} W pot track.`, true, s.t);
  }
}

// --------------------------------------------------------------- capacitor
export class Capacitor extends TwoTerm {
  static defaults = { c: 1e-6, esr: null, polarized: false, vmax: 50, leak: 1e9, ic: 0 };
  constructor(el, eng) {
    super(el, eng);
    if (this.p.esr == null) this.p.esr = this.p.polarized ? 0.1 : 0.01;
    this.resetState();
  }
  resetState() {
    super.resetState();
    this.vc = +this.p.ic || 0; this.ic = 0; this.hist = [this.vc, this.vc, this.vc];
    this.revT = 0; this.overT = 0;
  }
  save() { return { ...super.save(), vc: this.vc, ic: this.ic, hist: this.hist.slice() }; }
  restore(st) { super.restore(st); if (st) { this.vc = st.vc ?? 0; this.ic = st.ic ?? 0; this.hist = st.hist ? st.hist.slice() : [this.vc, this.vc, this.vc]; } }
  comp(s) {
    // returns [gp, c0, g, Ih]
    if (this.damaged || s.mode === 'dc') return [0, 0, 0, 0];
    const c = this.p.c, h = s.h;
    let g, Ih;
    if (s.method === 'trap') { g = 2 * c / h; Ih = g * this.vc + this.ic; }
    else { g = c / h; Ih = g * this.vc; }
    const gp = 1 / (this.p.esr + 1 / g);
    return [gp, -gp * Ih / g, g, Ih];
  }
  load(s) {
    const [gp, c0] = this.comp(s);
    stampG(s.A, this.h, gp + 1 / this.p.leak);
    if (c0) stampI(s.rhs, this.ia, this.ib, c0);
    this._s = s;
  }
  trial(s) {
    const [gp, c0, g, Ih] = this.comp(s);
    if (!g) return [this.vab(s.x), 0];
    const i = gp * this.vab(s.x) + c0;
    return [(i + Ih) / g, i];
  }
  current(x) {
    const s = this._s;
    if (!s || s.mode === 'dc' || this.damaged) return this.vab(x) / this.p.leak;
    return this.ic + this.vab(x) / this.p.leak;
  }
  power(x) { return this.p.esr * this.ic * this.ic + this.vab(x) ** 2 / this.p.leak; }
  lte(s) {
    if (this.damaged || s.mode !== 'tran') return 0;
    const [vc] = this.trial(s);
    return lteRatio(s, vc, this.hist, 1e-4);
  }
  accept(s) {
    if (s.mode === 'tran') {
      const [vc, i] = this.trial(s);
      this.vc = vc; this.ic = i;
    }
    pushHist(this.hist, this.vc);
    if (this.damaged) return;
    const v = this.vab(s.x);
    if (this.p.polarized) {
      if (v < -1) this.revT += s.h; else this.revT = Math.max(0, this.revT - s.h * 0.5);
      if (v > this.p.vmax * 1.15) this.overT += s.h; else this.overT = Math.max(0, this.overT - s.h * 0.5);
      if (this.revT > 0.5) this.damage('vented', `${this.label()} vented: an electrolytic capacitor was reversed (${v.toFixed(1)} V). The stripe marks the negative leg.`, true, s.t);
      else if (this.overT > 0.5) this.damage('vented', `${this.label()} vented: ${v.toFixed(1)} V on a ${this.p.vmax} V capacitor.`, true, s.t);
    }
  }
  acceptDC(s) {
    this.vc = this.vab(s.x); this.ic = 0;
    this.hist = [this.vc, this.vc, this.vc];
  }
}

// ---------------------------------------------------------------- inductor
export class Inductor extends Dev {
  static defaults = { l: 1e-3, rdc: 0.1, ic: 0 };
  constructor(el, eng) { super(el, eng); this.resetState(); }
  resetState() { super.resetState(); this.i = +this.p.ic || 0; this.vL = 0; this.hist = [this.i, this.i, this.i]; }
  save() { return { ...super.save(), i: this.i, vL: this.vL, hist: this.hist.slice() }; }
  restore(st) { super.restore(st); if (st) { this.i = st.i ?? 0; this.vL = st.vL ?? 0; this.hist = st.hist ? st.hist.slice() : [this.i, this.i, this.i]; } }
  setup(b) {
    this.ia = b.node('a'); this.ib = b.node('b'); this.k = b.branch('i');
    this.hb = b.branchPair(this.ia, this.ib, this.k);
  }
  rser() { return this.p.rdc; }
  load(s) {
    const A = s.A, h = this.hb;
    if (h[0] >= 0) A[h[0]] += 1;
    if (h[1] >= 0) A[h[1]] -= 1;
    if (h[2] >= 0) A[h[2]] += 1;
    if (h[3] >= 0) A[h[3]] -= 1;
    const r = Math.max(this.rser(), 1e-9);
    if (this.damaged) { A[h[4]] -= 1e9; return; }
    if (s.mode === 'dc') { A[h[4]] -= r; return; }
    const L = this.p.l;
    if (s.method === 'trap') { A[h[4]] -= r + 2 * L / s.h; s.rhs[this.k] += -(2 * L / s.h) * this.i - this.vL; }
    else { A[h[4]] -= r + L / s.h; s.rhs[this.k] += -(L / s.h) * this.i; }
  }
  current(x) { return x[this.k]; }
  power(x) { const i = x[this.k]; return i * i * this.rser(); }
  lte(s) { if (s.mode !== 'tran' || this.damaged) return 0; return lteRatio(s, s.x[this.k], this.hist, 1e-6); }
  accept(s) {
    const i = s.x[this.k];
    if (s.mode === 'tran') {
      this.vL = vat(s.x, this.ia) - vat(s.x, this.ib) - this.rser() * i;
      this.i = i;
    }
    pushHist(this.hist, this.i);
  }
  acceptDC(s) { this.i = s.x[this.k]; this.vL = 0; this.hist = [this.i, this.i, this.i]; }
}

// ---------------------------------------------------------------- switches
export class Switch extends TwoTerm {
  static defaults = { on: false, ron: 0.05 };
  g() { return this.p.on && !this.damaged ? 1 / this.p.ron : 0; }
  paramChanged() { this.eng._discontinuity(); }
  sig() { return this.p.on ? 1 : 0; }
}

export class Spdt extends Dev {
  static defaults = { pos: 0, ron: 0.05 };
  setup(b) {
    this.ic = b.node('com'); this.ia = b.node('a'); this.ib = b.node('b');
    this.ha = b.pair(this.ic, this.ia); this.hb = b.pair(this.ic, this.ib);
  }
  load(s) { stampG(s.A, +this.p.pos ? this.hb : this.ha, 1 / this.p.ron); }
  current(x) { const o = +this.p.pos ? this.ib : this.ia; return (vat(x, this.ic) - vat(x, o)) / this.p.ron; }
  paramChanged() { this.eng._discontinuity(); }
}

export class Button extends TwoTerm {
  static defaults = { pressed: false, ron: 0.05, bounce: 0 };
  constructor(el, eng) { super(el, eng); this.contact = !!this.p.pressed; this.chatter = []; }
  g() { return this.contact ? 1 / this.p.ron : 0; }
  sig() { return this.contact ? 1 : 0; }
  save() { return { ...super.save(), contact: this.contact }; }
  restore(st) { super.restore(st); if (st && 'contact' in st) this.contact = st.contact; }
  setPressed(on, t) {
    on = !!on;
    this.p.pressed = on;
    const b = +this.p.bounce || 0;
    if (b > 0) {
      const T = b / 1000;
      this.chatter = [0.08, 0.2, 0.33, 0.5, 0.7, 1].map(f => t + f * T);
      this.contact = on; // first touch
    } else { this.chatter = []; this.contact = on; }
    this.eng._discontinuity();
  }
  paramChanged(key) { if (key === 'pressed') this.setPressed(this.p.pressed, this.eng.t); }
  nextBreak(t) { return this.chatter.length ? this.chatter[0] : Infinity; }
  fire(t) {
    let changed = false;
    while (this.chatter.length && this.chatter[0] <= t + 1e-12) {
      this.chatter.shift();
      this.contact = this.chatter.length ? !this.contact : !!this.p.pressed;
      changed = true;
    }
    return changed;
  }
}

// ------------------------------------------------------------------- relay
export class Relay extends Inductor {
  static defaults = { coilR: 70, coilL: 0.1, vpick: 3.75, vdrop: 1.5, tmove: 0.005, ron: 0.05 };
  constructor(el, eng) { super(el, eng); this.p.l = this.p.coilL; this.ener = false; this.contact = 'nc'; this.moveAt = Infinity; this.digitalDev = true; }
  rser() { return this.p.coilR; }
  setup(b) {
    this.ia = b.node('c1'); this.ib = b.node('c2'); this.k = b.branch('i');
    this.hb = b.branchPair(this.ia, this.ib, this.k);
    this.icom = b.node('com'); this.ino = b.node('no'); this.inc = b.node('nc');
    this.hno = b.pair(this.icom, this.ino); this.hnc = b.pair(this.icom, this.inc);
  }
  save() { return { ...super.save(), ener: this.ener, contact: this.contact }; }
  restore(st) { super.restore(st); if (st) { this.ener = !!st.ener; this.contact = st.contact || 'nc'; } }
  load(s) {
    super.load(s);
    if (this.contact === 'no') stampG(s.A, this.hno, 1 / this.p.ron);
    else if (this.contact === 'nc') stampG(s.A, this.hnc, 1 / this.p.ron);
  }
  drive(x) { return Math.abs(x[this.k]) * this.p.coilR; }
  cross(xo, xn) {
    const thr = this.ener ? this.p.vdrop : this.p.vpick;
    const u0 = this.drive(xo) - thr, u1 = this.drive(xn) - thr;
    const up = CROSS.xp ? this.drive(CROSS.xp) - thr : undefined;
    if (!this.ener && u0 < 0 && u1 >= 0) return crossFrac(u0, u1, up);
    if (this.ener && u0 > 0 && u1 <= 0) return crossFrac(u0, u1, up);
    return 2;
  }
  digital(s) {
    const v = this.drive(s.x);
    let next = this.ener;
    if (!this.ener && v >= this.p.vpick) next = true;
    else if (this.ener && v <= this.p.vdrop) next = false;
    if (next !== this.ener) {
      this.ener = next;
      this.moveAt = s.t + this.p.tmove;
      const was = this.contact;
      this.contact = 'moving';
      return was !== 'moving';
    }
    return false;
  }
  nextBreak() { return this.moveAt; }
  fire(t) {
    if (t + 1e-12 < this.moveAt) return false;
    this.moveAt = Infinity;
    this.contact = this.ener ? 'no' : 'nc';
    return true;
  }
  frameVis(vis) { vis.on = this.contact === 'no'; vis.contact = this.contact; }
  sig() { return this.contact; }
}

// ------------------------------------------------------------------- motor
export class Motor extends Dev {
  static defaults = { r: 5, l: 0.001, ke: 0.005, j: 2e-6, bfric: 2.5e-7, load: 0 };
  constructor(el, eng) { super(el, eng); this.nonlinear = (+this.p.load || 0) > 0; this.resetState(); }
  resetState() {
    super.resetState();
    this.i = 0; this.w = 0; this.vL = 0; this.aJ = 0; this.angle = 0;
    this.hi = [0, 0, 0]; this.hw = [0, 0, 0];
  }
  save() { return { ...super.save(), i: this.i, w: this.w, vL: this.vL, aJ: this.aJ, angle: this.angle, hi: this.hi.slice(), hw: this.hw.slice() }; }
  restore(st) {
    super.restore(st);
    if (st) for (const k of ['i', 'w', 'vL', 'aJ', 'angle']) if (k in st) this[k] = st[k];
    if (st && st.hi) { this.hi = st.hi.slice(); this.hw = st.hw.slice(); }
  }
  setup(b) {
    this.ia = b.node('a'); this.ib = b.node('b');
    this.k = b.branch('i'); this.kw = b.branch('w');
    this.hb = b.branchPair(this.ia, this.ib, this.k);
    this.e_kw = b.entry(this.k, this.kw);
    this.e_wk = b.entry(this.kw, this.k);
    this.e_ww = b.entry(this.kw, this.kw);
  }
  torque(w) {
    const L = +this.p.load || 0;
    if (!L) return [0, 0];
    const th = Math.tanh(w / 0.5);
    return [L * th, L * (1 - th * th) / 0.5];
  }
  load(s) {
    const A = s.A, h = this.hb, p = this.p, rhs = s.rhs;
    if (h[0] >= 0) A[h[0]] += 1;
    if (h[1] >= 0) A[h[1]] -= 1;
    if (h[2] >= 0) A[h[2]] += 1;
    if (h[3] >= 0) A[h[3]] -= 1;
    let Lc = 0, rk = 0, Jc = 0, rw = 0;
    if (s.mode !== 'dc') {
      if (s.method === 'trap') {
        Lc = 2 * p.l / s.h; rk = -Lc * this.i - this.vL;
        Jc = 2 * p.j / s.h; rw = Jc * this.w + this.aJ;
      } else {
        Lc = p.l / s.h; rk = -Lc * this.i;
        Jc = p.j / s.h; rw = Jc * this.w;
      }
    }
    A[h[4]] -= p.r + Lc;
    A[this.e_kw] -= p.ke;
    rhs[this.k] += rk;
    const w0 = s.x[this.kw];
    const [t0, td] = this.torque(w0);
    A[this.e_ww] += Jc + Math.max(p.bfric, 1e-12) + td;
    A[this.e_wk] -= p.ke;
    rhs[this.kw] += rw - t0 + td * w0;
  }
  current(x) { return x[this.k]; }
  power(x) { return x[this.k] * (vat(x, this.ia) - vat(x, this.ib)); }
  lte(s) {
    if (s.mode !== 'tran') return 0;
    return Math.max(lteRatio(s, s.x[this.k], this.hi, 1e-5), lteRatio(s, s.x[this.kw], this.hw, 1e-2));
  }
  accept(s) {
    const x = s.x, i = x[this.k], w = x[this.kw], p = this.p;
    if (s.mode === 'tran') {
      this.angle += 0.5 * (w + this.w) * s.h;
      this.vL = vat(x, this.ia) - vat(x, this.ib) - p.r * i - p.ke * w;
      this.aJ = p.ke * i - p.bfric * w - this.torque(w)[0];
      this.i = i; this.w = w;
    }
    pushHist(this.hi, this.i); pushHist(this.hw, this.w);
  }
  acceptDC(s) {
    this.i = s.x[this.k]; this.w = s.x[this.kw]; this.vL = 0; this.aJ = 0;
    this.hi = [this.i, this.i, this.i]; this.hw = [this.w, this.w, this.w];
  }
  frameVis(vis) { vis.omega = this.w; vis.angle = this.angle; }
}

// ------------------------------------------------------------------- servo
export class Servo extends Dev {
  // pmin / pmax: the pulse widths of 0° and 180° (the Arduino Servo library
  // range, so write(x) gives x degrees)
  static defaults = { vmin: 4, rate: 500, thrHi: 1.5, thrLo: 1.0, pmin: 544e-6, pmax: 2400e-6 };
  constructor(el, eng) {
    super(el, eng); this.digitalDev = true;
    this.level = 0; this.tRise = -1; this.angle = 90; this.target = 90; this.moving = false; this.pulse = 0;
  }
  setup(b) {
    this.isig = b.node('sig'); this.ivcc = b.node('vcc'); this.ignd = b.node('gnd');
    this.hs = b.pair(this.isig, this.ignd); this.hv = b.pair(this.ivcc, this.ignd);
  }
  save() { return { ...super.save(), angle: this.angle, target: this.target }; }
  restore(st) { super.restore(st); if (st) { this.angle = st.angle ?? 90; this.target = st.target ?? 90; } }
  gload() { return this.moving ? 0.25 / 5 : 0.008 / 5; }
  load(s) { stampG(s.A, this.hs, 1 / 20000); stampG(s.A, this.hv, this.gload()); }
  vsig(x) { return vat(x, this.isig) - vat(x, this.ignd); }
  cross(xo, xn) {
    const thr = this.level ? this.p.thrLo : this.p.thrHi;
    const u0 = this.vsig(xo) - thr, u1 = this.vsig(xn) - thr;
    const up = CROSS.xp ? this.vsig(CROSS.xp) - thr : undefined;
    if (!this.level && u0 < 0 && u1 >= 0) return crossFrac(u0, u1, up);
    if (this.level && u0 > 0 && u1 <= 0) return crossFrac(u0, u1, up);
    return 2;
  }
  digital(s) {
    const v = this.vsig(s.x);
    if (!this.level && v >= this.p.thrHi) { this.level = 1; this.tRise = s.t; }
    else if (this.level && v <= this.p.thrLo) {
      this.level = 0;
      const w = s.t - this.tRise;
      if (this.tRise >= 0 && w > 0.3e-3 && w < 3e-3) {
        this.pulse = w;
        this.target = Math.min(180, Math.max(0, (w - this.p.pmin) / (this.p.pmax - this.p.pmin) * 180));
      }
    }
    return false;
  }
  current(x) { return (vat(x, this.ivcc) - vat(x, this.ignd)) * this.gload(); }
  power(x) { const v = vat(x, this.ivcc) - vat(x, this.ignd); return v * v * this.gload(); }
  accept(s) {
    const vcc = vat(s.x, this.ivcc) - vat(s.x, this.ignd);
    const d = this.target - this.angle;
    const was = this.moving;
    if (vcc >= this.p.vmin && Math.abs(d) > 0.2) {
      const step = this.p.rate * s.h;
      this.angle += Math.abs(d) <= step ? d : Math.sign(d) * step;
      this.moving = true;
    } else this.moving = false;
    if (was !== this.moving) this.eng._softChange();
  }
  nextBreak(t) { return Infinity; }
  frameVis(vis) { vis.angle = this.angle; vis.pulse = this.pulse; }
}

// --------------------------------------------------------- sound: freq meter
export class FreqMeter {
  constructor() { this.mean = 0; this.env = 0; this.state = 0; this.edges = []; this.tp = null; this.vp = 0; this.init = false; }
  feed(t, v, h) {
    if (!this.init) { this.init = true; this.mean = v; this.tp = t; this.vp = v; return; }
    this.mean += (v - this.mean) * Math.min(1, h / 0.02);
    this.env = Math.max(Math.abs(v - this.mean), this.env * Math.exp(-h / 0.05));
    const hi = this.mean + 0.3 * this.env, lo = this.mean - 0.3 * this.env;
    if (this.env > 1e-6) {
      if (!this.state && v > hi) {
        const tc = this.vp >= hi || v === this.vp ? t : this.tp + (hi - this.vp) / (v - this.vp) * (t - this.tp);
        this.edges.push(tc);
        if (this.edges.length > 64) this.edges.shift();
        this.state = 1;
      } else if (this.state && v < lo) this.state = 0;
    }
    this.tp = t; this.vp = v;
  }
  // the mean of the newest periods that agree with the last one (±3 %),
  // so a note change does not blend two pitches
  read(t) {
    const e = this.edges;
    while (e.length && e[0] < t - 0.25) e.shift();
    if (e.length < 3) return [0, this.env];
    const last = e[e.length - 1] - e[e.length - 2];
    let sum = 0, n = 0;
    for (let k = e.length - 1; k > 0 && n < 16; k--) {
      const d = e[k] - e[k - 1];
      if (Math.abs(d / last - 1) > 0.03) break;
      sum += d; n++;
    }
    const per = sum / n;
    if (n < 2 || t - e[e.length - 1] > 3 * per + 0.02) return [0, this.env];
    return [1 / per, this.env];
  }
}

export class Buzzer extends TwoTerm {
  static defaults = { active: true, r: null, vmin: 2.5, tone: 2300 };
  constructor(el, eng) {
    super(el, eng);
    const act = this.p.active === true || this.p.active === 'true' || this.p.active === 1;
    this.p.active = act;
    if (this.p.r == null) this.p.r = act ? 160 : 40;
    if (this.p.freq != null) this.p.tone = +this.p.freq; // template name for the tone
    this.fm = new FreqMeter(); this.onT = 0; this.vOn = 0;
  }
  g() { return 1 / this.p.r; }
  accept(s) {
    const v = this.vab(s.x);
    if (this.p.active) { if (v > this.p.vmin) { this.onT += s.h; this.vOn += v * s.h; } }
    else this.fm.feed(s.t, this.current(s.x), s.h);
  }
  frameVis(vis, avgI, avgP, win) {
    if (this.p.active) {
      const f = win > 0 ? this.onT / win : 0;
      const va = this.onT > 0 ? this.vOn / this.onT : 0;
      vis.freq = f > 0.02 ? this.p.tone : 0;
      vis.amp = Math.min(1, f * Math.min(1, va / 5));
      this.onT = 0; this.vOn = 0;
    } else {
      const [f, env] = this.fm.read(this.eng.t);
      vis.freq = f; vis.amp = f ? Math.min(1, env * this.p.r / 2.5) : 0;
    }
  }
}

export class Speaker extends TwoTerm {
  static defaults = { r: 8 };
  constructor(el, eng) { super(el, eng); this.fm = new FreqMeter(); }
  g() { return 1 / this.p.r; }
  accept(s) { this.fm.feed(s.t, this.current(s.x), s.h); }
  frameVis(vis) {
    const [f, env] = this.fm.read(this.eng.t);
    vis.freq = f; vis.amp = f ? Math.min(1, env * this.p.r / 2.5) : 0;
  }
}

// -------------------------------------------------------------------- lamp
export class Lamp extends TwoTerm {
  static defaults = { vnom: 6, pnom: 0.6, ratio: 10 };
  constructor(el, eng) { super(el, eng); this.th = 0; this.overT = 0; }
  save() { return { ...super.save(), th: this.th }; }
  restore(st) { super.restore(st); if (st) this.th = st.th ?? 0; }
  resetState() { super.resetState(); this.th = 0; this.overT = 0; }
  g() {
    if (this.damaged) return 0;
    const rh = this.p.vnom * this.p.vnom / this.p.pnom;
    return 1 / (rh * (1 / this.p.ratio + (1 - 1 / this.p.ratio) * this.th));
  }
  accept(s) {
    if (this.damaged) return;
    const P = this.power(s.x);
    const target = Math.min(2, Math.sqrt(Math.max(0, P) / this.p.pnom));
    const before = this.th;
    this.th += (target - this.th) * (1 - Math.exp(-s.h / 0.06));
    if (Math.abs(this.th - before) > 0.02) this.eng._softChange();
    if (P > 3 * this.p.pnom) this.overT += s.h; else this.overT = 0;
    if (this.overT > 0.3) this.damage('blown', `${this.label()} blew: ${P.toFixed(1)} W in a ${this.p.pnom} W lamp.`, false, s.t);
  }
  frameVis(vis) { vis.on = this.th > 0.15; vis.b = Math.min(1.5, this.th); }
}

// -------------------------------------------------------------------- fuse
export class Fuse extends TwoTerm {
  static defaults = { rating: 1, i2t: null, r: 0.05 };
  constructor(el, eng) { super(el, eng); this.heat = 0; if (this.p.i2t == null) this.p.i2t = 0.3 * this.p.rating * this.p.rating; }
  resetState() { super.resetState(); this.heat = 0; }
  repair() { super.repair(); this.heat = 0; }
  g() { return this.damaged ? 0 : 1 / this.p.r; }
  accept(s) {
    if (this.damaged) return;
    const i = Math.abs(this.current(s.x)), R = this.p.rating;
    if (i > R) this.heat += (i * i - R * R) * s.h;
    else this.heat = Math.max(0, this.heat - R * R * s.h * 0.2);
    if (this.heat > this.p.i2t) {
      this.damaged = 'blown';
      this.eng._event({ t: s.t, kind: 'fuse', owner: this.owner, element: this.id, severity: 'warn', msg: `${this.label()} blew at ${i.toFixed(2)} A (rated ${R} A).`, smoke: false });
      this.eng._discontinuity();
    }
  }
}

// ------------------------------------------------------------ temp sensor
export class TempSensor extends Dev {
  static defaults = { tempC: 25, vmin: 2.7, rout: 100 };
  constructor(el, eng) { super(el, eng); this.nonlinear = true; }
  setup(b) {
    this.ivs = b.node('vs'); this.iout = b.node('out'); this.ignd = b.node('gnd');
    this.hq = b.pair(this.ivs, this.ignd); this.ho = b.pair(this.iout, this.ignd);
  }
  powered(x) { return vat(x, this.ivs) - vat(x, this.ignd) >= this.p.vmin; }
  load(s) {
    stampG(s.A, this.hq, 50e-6 / 5);
    if (this.powered(s.x) && !this.damaged) {
      const g = 1 / this.p.rout, vt = 0.5 + 0.01 * this.p.tempC;
      stampG(s.A, this.ho, g);
      stampI(s.rhs, this.ignd, this.iout, vt * g);
    } else stampG(s.A, this.ho, 1e-6);
  }
  current(x) { return (vat(x, this.ivs) - vat(x, this.ignd)) * 1e-5; }
}

// ----------------------------------------------------------- probe elements
export class VMeter extends TwoTerm {
  static defaults = { r: 1e7 };
  g() { return 1 / this.p.r; }
}

export class AMeter extends TwoTerm {
  static defaults = { r: 0.1, fuse: 10 };
  g() { return this.damaged ? 0 : 1 / this.p.r; }
  accept(s) {
    if (this.damaged) return;
    const i = Math.abs(this.current(s.x));
    if (i > this.p.fuse) {
      this.damaged = 'blown';
      this.eng._event({ t: s.t, kind: 'fuse', owner: this.owner, element: this.id, severity: 'warn', msg: `The meter fuse blew at ${i.toFixed(1)} A. An ammeter goes in series, never across a supply.`, smoke: false });
      this.eng._discontinuity();
    }
  }
}

export const PASSIVE_TYPES = {
  resistor: Resistor, wire: Wire, pot: Pot, capacitor: Capacitor, inductor: Inductor,
  switch: Switch, spdt: Spdt, button: Button, relay: Relay, ldr: Ldr, thermistor: Thermistor,
  tempsensor: TempSensor, motor: Motor, servo: Servo, buzzer: Buzzer, speaker: Speaker,
  lamp: Lamp, fuse: Fuse, vmeter: VMeter, ameter: AMeter,
};
export { crossFrac };
