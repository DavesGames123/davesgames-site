// ============================================================================
//  BREADBOARD LAB  ·  sim/sources.js — voltage and current sources
// ----------------------------------------------------------------------------
//  A source with a voltage keeps a branch current unknown I (from p through
//  the source to n). Its row says v(p) − v(n) − rint·I = E. The current the
//  source DELIVERS to the circuit is −I. This keeps rint = 0 exact and lets
//  two sources in parallel stay solvable (a 1 nΩ floor).
//
//  The bench supply is a CV/CC source. In CV it is a 1 mΩ Thevenin source.
//  When the current would pass the limit it turns into a current source at
//  the limit (CC). It goes back to CV when the voltage would rise above the
//  set point. A small hysteresis keeps Newton from flipping between them.
//
//  EVENTS. 'cc' when a supply enters CC. 'short' when a source current passes
//  5 A or its own limit within 1 ms after the circuit was loaded. 'fuse' when
//  the USB polyfuse trips.
//
//  GREP MAP
//    waveAt / waveBreaks .. dc, sine, square, triangle values and edges
//    VSource .............. ideal or Thevenin source, function generator
//    ISource .............. constant current source
//    Supply ............... the CV/CC bench supply
//    Battery / emfFrac .... EMF falls with state of charge
//    UsbPower ............. 5 V with a resettable polyfuse
//    Solar ................ photocurrent minus a diode string
//    SOURCE_TYPES ......... type name → class
// ============================================================================
import { Dev, VT, vat, stampG, stampI, pnjlim, vcritOf } from './devbase.js';

const TAU = Math.PI * 2;

export function waveOf(p) {
  const w = p.wave && typeof p.wave === 'object' ? { ...p.wave } : {};
  for (const k of ['kind', 'v', 'amp', 'freq', 'offset', 'phase', 'duty']) if (w[k] == null && p[k] != null) w[k] = p[k];
  if (!w.kind) w.kind = 'dc';
  if (w.kind === 'dc' && w.v == null) w.v = w.offset ?? 0;
  w.amp = +(w.amp ?? 1); w.freq = Math.max(1e-6, +(w.freq ?? 1000)); w.offset = +(w.offset ?? 0);
  w.phase = +(w.phase ?? 0); w.duty = Math.min(0.999, Math.max(0.001, +(w.duty ?? 0.5)));
  w.v = +(w.v ?? 0);
  return w;
}

export function waveAt(w, t) {
  switch (w.kind) {
    case 'sine': return w.offset + w.amp * Math.sin(TAU * w.freq * t + w.phase * Math.PI / 180);
    case 'square': {
      const ph = frac(w.freq * t + w.phase / 360);
      return w.offset + (ph < w.duty ? w.amp : -w.amp);
    }
    case 'tri': {
      const ph = frac(w.freq * t + w.phase / 360);
      return w.offset + w.amp * (ph < 0.5 ? -1 + 4 * ph : 3 - 4 * ph);
    }
    default: return w.v;
  }
}
function frac(u) { return u - Math.floor(u); }

// next edge strictly after t (square, tri corners)
export function waveNextBreak(w, t) {
  if (w.kind !== 'square' && w.kind !== 'tri') return Infinity;
  const P = 1 / w.freq, sh = w.phase / 360 * P;
  const marks = w.kind === 'square' ? [0, w.duty] : [0, 0.5];
  const base = Math.floor((t + sh) / P);
  let best = Infinity;
  for (let c = base; c <= base + 1; c++) for (const m of marks) {
    const tb = (c + m) * P - sh;
    if (tb > t + 1e-13 * Math.max(1, t) + 1e-15 && tb < best) best = tb;
  }
  return best;
}
export function waveDtMax(w) {
  if (w.kind === 'sine') return 1 / (w.freq * 40);
  if (w.kind === 'square' || w.kind === 'tri') return 1 / (w.freq * 8);
  return Infinity;
}

// Branch source base: E() is the EMF, rint() the series resistance.
class BranchSource extends Dev {
  setup(b) {
    this.ip = b.node('p'); this.in = b.node('n'); this.k = b.branch('i');
    this.hb = b.branchPair(this.ip, this.in, this.k);
    this.shortSent = false;
  }
  E(t) { return 0; }
  rint() { return 0; }
  ilimit() { return 5; }
  load(s) {
    const A = s.A, h = this.hb;
    if (h[0] >= 0) A[h[0]] += 1;
    if (h[1] >= 0) A[h[1]] -= 1;
    if (h[2] >= 0) A[h[2]] += 1;
    if (h[3] >= 0) A[h[3]] -= 1;
    A[h[4]] -= Math.max(this.rint(), 1e-9);
    s.rhs[this.k] += this.E(s.t) * s.srcFact;
  }
  delivered(x) { return -x[this.k]; }
  current(x) { return -x[this.k]; }
  power(x) { const r = this.rint(), i = x[this.k]; return i * i * r; }
  checkShort(s) {
    if (this.shortSent || s.mode !== 'tran') return;
    if (s.t - this.eng.tLoad > 1e-3) return;
    const i = Math.abs(this.delivered(s.x));
    if (i > Math.max(5, this.ilimit()) || i > this.ilimit()) {
      this.shortSent = true;
      this.eng._event({ t: s.t, kind: 'short', owner: this.owner, element: this.id, severity: 'error', msg: `Short circuit: ${this.label()} delivers ${i.toFixed(2)} A.` });
    }
  }
}

export class VSource extends BranchSource {
  static defaults = { rint: 0 };
  constructor(el, eng) { super(el, eng); this.w = waveOf(this.p); }
  paramChanged() { this.w = waveOf(this.p); this.eng._discontinuity(); }
  E(t) { return waveAt(this.w, t); }
  rint() { return +this.p.rint || 0; }
  accept(s) { this.checkShort(s); }
  nextBreak(t) { return waveNextBreak(this.w, t); }
  fire() { return true; }
  dtMax() { return waveDtMax(this.w); }
  sig() { return this.w.kind === 'square' ? (waveAt(this.w, this.eng.t + 1e-12) > this.w.offset ? 1 : 0) : ''; }
  frameVis(vis, avgI) { vis.v = this.w.kind === 'dc' ? this.w.v : this.w.amp; vis.on = true; }
}

export class ISource extends Dev {
  static defaults = { i: 1e-3 };
  setup(b) { this.ip = b.node('p'); this.in = b.node('n'); }
  load(s) { stampI(s.rhs, this.ip, this.in, -this.p.i * s.srcFact); }
  current() { return this.p.i; }
  power(x) { return (vat(x, this.ip) - vat(x, this.in)) * this.p.i; }
}

export class Supply extends Dev {
  static defaults = { v: 5, ilim: 1, on: true, rint: 1e-3 };
  constructor(el, eng) { super(el, eng); this.nonlinear = true; this.metered = true; this.region = 'cv'; this.wasCC = false; this.shortSent = false; }
  setup(b) { this.ip = b.node('p'); this.in = b.node('n'); this.h = b.pair(this.ip, this.in); }
  isOn() { return this.p.on === true || this.p.on === 'true' || this.p.on === 1; }
  paramChanged() { this.eng._discontinuity(); }
  vpn(x) { return vat(x, this.ip) - vat(x, this.in); }
  pick(v) {
    const V = this.p.v * this.eng.srcFactNow, il = Math.max(1e-6, this.p.ilim), r = this.p.rint;
    const iu = (V - v) / r;
    if (this.region === 'cv') { if (iu > il * 1.0005) this.region = 'cc'; else if (iu < -il * 1.0005) this.region = 'ccn'; }
    else if (this.region === 'cc') { if (v > V) this.region = 'cv'; }
    else if (this.region === 'ccn') { if (v < V) this.region = 'cv'; }
    return this.region;
  }
  load(s) {
    if (!this.isOn()) { stampG(s.A, this.h, 1e-6); return; }
    const reg = this.pick(this.vpn(s.x));
    const il = Math.max(1e-6, this.p.ilim);
    if (reg === 'cv') {
      const g = 1 / this.p.rint;
      stampG(s.A, this.h, g);
      stampI(s.rhs, this.ip, this.in, -this.p.v * s.srcFact * g);
    } else {
      stampG(s.A, this.h, 1e-6);
      stampI(s.rhs, this.ip, this.in, (reg === 'cc' ? -il : il) * s.srcFact);
    }
  }
  delivered(x) {
    if (!this.isOn()) return -this.vpn(x) * 1e-6;
    const il = Math.max(1e-6, this.p.ilim);
    if (this.region === 'cc') return il - this.vpn(x) * 1e-6;
    if (this.region === 'ccn') return -il - this.vpn(x) * 1e-6;
    return (this.p.v - this.vpn(x)) / this.p.rint;
  }
  current(x) { return this.delivered(x); }
  accept(s) {
    const cc = this.isOn() && this.region !== 'cv';
    if (cc && !this.wasCC && s.mode === 'tran') {
      this.eng._event({ t: s.t, kind: 'cc', owner: this.owner, element: this.id, severity: 'warn', msg: `${this.label()} is current limiting at ${this.p.ilim} A (CC). The output voltage dropped to ${this.vpn(s.x).toFixed(2)} V.` });
      if (!this.shortSent && s.t - this.eng.tLoad <= 1e-3) {
        this.shortSent = true;
        this.eng._event({ t: s.t, kind: 'short', owner: this.owner, element: this.id, severity: 'error', msg: `Short circuit across ${this.label()}: it hit its ${this.p.ilim} A limit at once.` });
      }
    }
    this.wasCC = cc;
  }
  frameVis(vis, avgI) {
    vis.on = this.isOn(); vis.cc = this.isOn() && this.region !== 'cv';
    vis.v = this.isOn() ? this.vpn(this.eng.x) : 0; vis.a = this.isOn() ? avgI : 0;
  }
}

// EMF fraction of the full voltage as the cell discharges (soc 1 → 0).
export function emfFrac(soc) {
  soc = Math.min(1, Math.max(0, soc));
  return 0.82 + 0.18 * soc - 0.12 * Math.pow(1 - soc, 6);
}

export class Battery extends BranchSource {
  static defaults = { v: 9, rint: 1.5, mah: 500, soc: 1 };
  constructor(el, eng) { super(el, eng); this.soc = +this.p.soc; }
  save() { return { ...super.save(), soc: this.soc }; }
  restore(st) { super.restore(st); if (st && st.soc != null) this.soc = st.soc; }
  resetState() { super.resetState(); this.soc = +this.p.soc; }
  paramChanged(key) { if (key === 'soc') this.soc = +this.p.soc; this.eng._discontinuity(); }
  E() { return this.p.v * emfFrac(this.soc); }
  rint() { return +this.p.rint || 0; }
  accept(s) {
    this.checkShort(s);
    if (s.mode !== 'tran') return;
    const i = this.delivered(s.x);
    this.soc = Math.min(1, Math.max(0, this.soc - i * s.h / (this.p.mah * 3.6)));
  }
  frameVis(vis) { vis.soc = this.soc; vis.v = this.E(); }
}

export class UsbPower extends BranchSource {
  static defaults = { v: 5, rint: 0.2, trip: 0.5, usb: true };
  constructor(el, eng) { super(el, eng); this.heat = 0; this.tripped = false; }
  isOn() { return !(this.p.usb === false || this.p.usb === 'false' || this.p.usb === 0); }
  paramChanged() { this.eng._discontinuity(); }
  E() { return this.isOn() ? this.p.v : 0; }
  rint() { return !this.isOn() ? 1e6 : this.tripped ? 50 : this.p.rint; }
  ilimit() { return this.p.trip; }
  save() { return { ...super.save(), heat: this.heat, tripped: this.tripped }; }
  restore(st) { super.restore(st); if (st) { this.heat = st.heat ?? 0; this.tripped = !!st.tripped; } }
  resetState() { super.resetState(); this.heat = 0; this.tripped = false; }
  repair() { super.repair(); this.heat = 0; this.tripped = false; }
  accept(s) {
    this.checkShort(s);
    if (s.mode !== 'tran') return;
    const i = Math.abs(this.delivered(s.x)), tr = this.p.trip;
    if (i > tr) this.heat += (i * i - tr * tr) * s.h;
    else this.heat = Math.max(0, this.heat - tr * tr * s.h * (this.tripped ? 0.25 : 1));
    if (!this.tripped && this.heat > tr * tr * 0.5) {
      this.tripped = true;
      this.eng._event({ t: s.t, kind: 'fuse', owner: this.owner, element: this.id, severity: 'warn', msg: `USB polyfuse tripped: ${i.toFixed(2)} A from a ${tr} A port. It resets when the load is removed.` });
      this.eng._discontinuity();
    } else if (this.tripped && this.heat <= 0) {
      this.tripped = false;
      this.eng._event({ t: s.t, kind: 'info', owner: this.owner, element: this.id, severity: 'info', msg: 'USB polyfuse reset.' });
      this.eng._discontinuity();
    }
  }
  frameVis(vis) { vis.on = this.isOn() && !this.tripped; vis.tripped = this.tripped; }
}

export class Solar extends Dev {
  static defaults = { isc: 0.1, voc: 6, lux: 50000, luxFull: 100000, rsh: 1e4 };
  constructor(el, eng) {
    super(el, eng); this.nonlinear = true;
    const ns = Math.max(1, Math.round(this.p.voc / 0.6));
    this.nvt = ns * 1.3 * VT;
    this.is = this.p.isc / Math.expm1(this.p.voc / this.nvt);
    this.vcrit = vcritOf(this.is, this.nvt);
    this.vd = 0;
  }
  setup(b) { this.ip = b.node('p'); this.in = b.node('n'); this.h = b.pair(this.ip, this.in); }
  iph() { return this.p.isc * Math.max(0, this.p.lux) / this.p.luxFull; }
  load(s) {
    let v = vat(s.x, this.ip) - vat(s.x, this.in);
    const [vl, lim] = pnjlim(v, this.vd, this.nvt, this.vcrit);
    if (lim) s.noncon = true;
    this.vd = vl;
    const e = Math.exp(Math.min(vl / this.nvt, 80));
    const id = this.is * (e - 1), gd = this.is * e / this.nvt;
    // current leaving p into the cell: id + v/rsh − iph
    stampG(s.A, this.h, gd + 1 / this.p.rsh);
    stampI(s.rhs, this.ip, this.in, (id - gd * vl) - this.iph() * s.srcFact);
  }
  delivered(x) {
    const v = vat(x, this.ip) - vat(x, this.in);
    return this.iph() - this.is * Math.expm1(Math.min(v / this.nvt, 80)) - v / this.p.rsh;
  }
  current(x) { return this.delivered(x); }
}

export const SOURCE_TYPES = { vsource: VSource, isource: ISource, supply: Supply, battery: Battery, usbpower: UsbPower, solar: Solar };
