// ============================================================================
//  BREADBOARD LAB  ·  sim/digital.js — logic chips, the LCD and MCU pins
// ----------------------------------------------------------------------------
//  A DIGITAL INPUT reads a node voltage against its chip supply with a
//  hysteresis band: it goes high above VIH, low below VIL, and holds the old
//  level in between (HC and CD4000: 0.3·Vcc and 0.7·Vcc). The engine asks
//  every device for cross(xo, xn): the fraction of the trial step where an
//  input passes its threshold. If the crossing is earlier than the step end,
//  the engine shortens the step to land just past it. So edges have exact
//  times, and a 555 or an MCU pin edge clocks a counter at the right moment.
//
//  A DIGITAL OUTPUT is a resistor rout to the chip vcc pin (high) or to its
//  gnd pin (low), so the supply pins carry the output current. Outputs go to
//  high impedance when Vcc − GND < 1.5 V.
//
//  MCU PIN (type 'mcupin', made by the engine for each GPIO of a board).
//  Modes: out, in (100 MΩ), in_pullup (35 kΩ AVR, 45 kΩ ESP32),
//  in_pulldown, off, and the timed modes pwm, tone and servo. A timed mode
//  either SWITCHES (real edges at exact times, breakpoints) or drives its
//  AVERAGE (duty·vdd through rout). The engine picks per pin (sim/engine.js
//  pwmMode). Clamp diodes to vdd and gnd. Above 40 mA for 10 ms the pin dies.
//
//  GREP MAP
//    DIn ................. one hysteresis input: level, u(), crossing
//    Logic ............... the 74HC / CD4000 chips of sim/chips.js
//    LogicExpr ........... custom parts: outputs from expressions
//    Lcd ................. the hd44780 element (vis rows, cursor, cgram)
//    McuPin .............. GPIO driver and input watcher
//    McuCore ............. the board supply draw (vdd to gnd)
//    DIGITAL_TYPES ....... type name → class
// ============================================================================
import { Dev, vat, stampG, GMIN, pnj, LIMIT, vcritOf, VT, crossFrac, CROSS } from './devbase.js';
import { chipOf, FAMILIES, exprCompile, Hd44780 } from './chips.js';

// One input with hysteresis. thr(x) returns [vil, vih] in absolute volts.
export class DIn {
  constructor(node, ref) { this.n = node; this.ref = ref; this.level = 0; }
  v(x) { return vat(x, this.n) - vat(x, this.ref); }
  next(x, vil, vih) {
    const v = this.v(x);
    if (!this.level && v > vih) return 1;
    if (this.level && v < vil) return 0;
    return this.level;
  }
  crossing(xo, xn, lo0, hi0, lo1, hi1) {
    const v0 = this.v(xo), v1 = this.v(xn);
    const vp = CROSS.xp ? this.v(CROSS.xp) : undefined;
    if (!this.level && v1 > hi1) return crossFrac(v0 - hi0, v1 - hi1, vp === undefined ? undefined : vp - hi0);
    if (this.level && v1 < lo1) return crossFrac(v0 - lo0, v1 - lo1, vp === undefined ? undefined : vp - lo0);
    return 2;
  }
}

// shared base: supply pins, input set, output pins
class DigitalBase extends Dev {
  constructor(el, eng) { super(el, eng); this.digitalDev = true; this.out = {}; this.powered = false; this.burnT = 0; }
  supplySpan(x) { return vat(x, this.ivcc) - vat(x, this.ignd); }
  thr(x) { const s = Math.max(0, this.supplySpan(x)); return [this.fam.vil * s, this.fam.vih * s]; }
  stampOutputs(s) {
    const g = 1 / this.fam.rout;
    for (const k in this.outPins) {
      const lv = this.powered && !this.damaged ? this.out[k] : 'z';
      const h = this.outPins[k];
      if (lv === 1) stampG(s.A, h.hv, g);
      else if (lv === 0) stampG(s.A, h.hg, g);
      else stampG(s.A, h.hg, 1e-9);
    }
  }
  outCurrent(x, k) {
    const h = this.outPins[k], lv = this.powered && !this.damaged ? this.out[k] : 'z';
    const v = vat(x, h.n);
    if (lv === 1) return (vat(x, this.ivcc) - v) / this.fam.rout;
    if (lv === 0) return (vat(x, this.ignd) - v) / this.fam.rout;
    return 0;
  }
  current(x) {
    // total supply current: quiescent plus sourced outputs
    let i = this.supplySpan(x) * this.fam.iq / 5;
    for (const k in this.outPins) { const c = this.outCurrent(x, k); if (c > 0) i += c; }
    return i;
  }
  power(x) {
    let p = this.supplySpan(x) ** 2 * this.fam.iq / 5;
    for (const k in this.outPins) {
      const c = this.outCurrent(x, k), v = vat(x, this.outPins[k].n);
      p += c > 0 ? c * (vat(x, this.ivcc) - v) : c * (vat(x, this.ignd) - v);
    }
    return p;
  }
  crossAll(xo, xn) {
    const [lo0, hi0] = this.thr(xo), [lo1, hi1] = this.thr(xn);
    let f = 2;
    for (const k in this.ins) f = Math.min(f, this.ins[k].crossing(xo, xn, lo0, hi0, lo1, hi1));
    const p0 = this.supplySpan(xo) >= this.fam.vmin, p1 = this.supplySpan(xn) >= this.fam.vmin;
    if (p0 !== p1) f = Math.min(f, crossFrac(this.supplySpan(xo) - this.fam.vmin, this.supplySpan(xn) - this.fam.vmin));
    return f;
  }
  readInputs(x) {
    const [lo, hi] = this.thr(x);
    const lv = {}, rise = {}, fall = {};
    for (const k in this.ins) {
      const d = this.ins[k], nl = d.next(x, lo, hi);
      if (nl && !d.level) rise[k] = true;
      if (!nl && d.level) fall[k] = true;
      d.level = nl; lv[k] = nl;
    }
    return { lv, rise, fall };
  }
  sig() { let o = this.powered ? 'p' : 'u'; for (const k in this.out) o += this.out[k]; return o; }
  checkBurn(s) {
    if (this.damaged) return;
    let worst = 0;
    for (const k in this.outPins) worst = Math.max(worst, Math.abs(this.outCurrent(s.x, k)));
    // the family limit (FAMILIES iburn). The old fixed 0.1 A could never
    // fire: rout bounds an HC short at 5 V to 100 mA.
    const fam = this.fam || {}, lim = fam.iburn || 0.035, abs = fam.iabs || 0.025;
    if (worst > lim) this.burnT += s.h; else this.burnT = 0;
    if (this.burnT > 0.05) this.damage('burnt', `${this.label()} burned: an output carried ${(worst * 1000).toFixed(0)} mA (limit ${(abs * 1000).toFixed(0)} mA). An output is shorted to a supply or to another output.`, true, s.t);
  }
}

// ------------------------------------------------------------------ logic
export class Logic extends DigitalBase {
  static defaults = { chip: '74hc00' };
  constructor(el, eng) {
    super(el, eng);
    this.chip = chipOf(this.p.chip);
    if (!this.chip) throw new Error(`unknown logic chip "${this.p.chip}"`);
    this.fam = { ...FAMILIES[this.chip.family], ...(this.p.rout ? { rout: this.p.rout } : {}) };
    this.st = this.chip.init ? this.chip.init() : {};
  }
  setup(b) {
    const c = this.chip;
    this.ivcc = b.node('p' + c.vcc); this.ignd = b.node('p' + c.gnd);
    this.ins = {};
    for (const pin of c.inputs) this.ins[pin] = new DIn(b.node('p' + pin), this.ignd);
    this.outPins = {};
    for (const pin of c.outputs) {
      const n = b.node('p' + pin);
      this.outPins[pin] = { n, hv: b.pair(n, this.ivcc), hg: b.pair(n, this.ignd) };
      this.out[pin] = 'z';
    }
    this.hq = b.pair(this.ivcc, this.ignd);
    this.hin = Object.values(this.ins).map(d => b.pair(d.n, this.ignd));
  }
  load(s) {
    stampG(s.A, this.hq, this.fam.iq / 5);
    for (const h of this.hin) stampG(s.A, h, 1e-12);
    this.stampOutputs(s);
  }
  cross(xo, xn) { return this.crossAll(xo, xn); }
  digital(s) {
    const pw = this.supplySpan(s.x) >= this.fam.vmin;
    const { lv, rise, fall } = this.readInputs(s.x);
    let changed = pw !== this.powered;
    if (!pw) {
      if (this.powered) this.st = this.chip.init ? this.chip.init() : {};
      this.powered = false;
      return changed;
    }
    // power-up: no edges on the first powered evaluation
    const wasPw = this.powered;
    this.powered = true;
    const o = this.chip.step(this.st, lv, wasPw ? rise : {}, wasPw ? fall : {});
    for (const k in o) if (this.out[k] !== o[k]) { this.out[k] = o[k]; changed = true; }
    return changed;
  }
  accept(s) { this.checkBurn(s); }
  save() { return { ...super.save(), st: JSON.parse(JSON.stringify(this.st)), out: { ...this.out }, lv: Object.fromEntries(Object.entries(this.ins).map(([k, d]) => [k, d.level])), powered: this.powered }; }
  restore(st) {
    super.restore(st);
    if (!st || !st.st) return;
    this.st = st.st; Object.assign(this.out, st.out); this.powered = st.powered;
    for (const k in st.lv) if (this.ins[k]) this.ins[k].level = st.lv[k];
  }
  resetState() { super.resetState(); this.st = this.chip.init ? this.chip.init() : {}; this.powered = false; }
  frameVis(vis) { vis.state = this.st.n ?? this.st.latch ?? undefined; }
}

// ------------------------------------------------------------- logic-expr
export class LogicExpr extends DigitalBase {
  static defaults = { outputs: {}, inputs: null, family: 'hc' };
  constructor(el, eng) {
    super(el, eng);
    this.fam = { ...FAMILIES[this.p.family] || FAMILIES.hc, ...(this.p.rout ? { rout: this.p.rout } : {}) };
    let outs = this.p.outputs;
    if (typeof outs === 'string') { try { outs = JSON.parse(outs); } catch { outs = {}; } }
    this.exprs = {};
    const names = new Set();
    for (const k of Object.keys(outs || {})) {
      const c = exprCompile(outs[k]);
      this.exprs[k] = c.fn;
      c.names.forEach(n => names.add(n));
    }
    this.inNames = Array.isArray(this.p.inputs) ? this.p.inputs : [...names];
  }
  setup(b) {
    this.ivcc = b.node('vcc'); this.ignd = b.node('gnd');
    this.ins = {};
    for (const n of this.inNames) this.ins[n] = new DIn(b.node(n), this.ignd);
    this.outPins = {};
    for (const k of Object.keys(this.exprs)) {
      const n = b.node(k);
      this.outPins[k] = { n, hv: b.pair(n, this.ivcc), hg: b.pair(n, this.ignd) };
      this.out[k] = 'z';
    }
    this.hq = b.pair(this.ivcc, this.ignd);
  }
  load(s) { stampG(s.A, this.hq, this.fam.iq / 5); this.stampOutputs(s); }
  cross(xo, xn) { return this.crossAll(xo, xn); }
  digital(s) {
    const pw = this.supplySpan(s.x) >= this.fam.vmin;
    const { lv } = this.readInputs(s.x);
    let changed = pw !== this.powered;
    this.powered = pw;
    if (!pw) return changed;
    for (const k in this.exprs) { const v = this.exprs[k](lv); if (this.out[k] !== v) { this.out[k] = v; changed = true; } }
    return changed;
  }
  accept(s) { this.checkBurn(s); }
}

// -------------------------------------------------------------------- LCD
export class Lcd extends DigitalBase {
  static defaults = {};
  constructor(el, eng) {
    super(el, eng);
    this.fam = { rout: 1e9, vil: 0.3, vih: 0.7, vmin: 2.7, iq: 1e-3 };
    this.ctl = new Hd44780();
  }
  setup(b) {
    this.ignd = b.node('vss'); this.ivcc = b.node('vdd'); this.iv0 = b.node('v0');
    this.ins = {};
    for (const t of ['rs', 'rw', 'e', 'd0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7']) this.ins[t] = new DIn(b.node(t), this.ignd);
    this.outPins = {};
    this.hq = b.pair(this.ivcc, this.ignd);
    this.hv0 = b.pair(this.iv0, this.ignd);
    this.hin = Object.values(this.ins).map(d => b.pair(d.n, this.ignd));
  }
  load(s) {
    stampG(s.A, this.hq, 1e-3 / 5);
    stampG(s.A, this.hv0, 1e-7);
    for (const h of this.hin) stampG(s.A, h, 1e-9);
  }
  cross(xo, xn) {
    // only the falling E line times anything; the data lines are sampled then
    const [lo0, hi0] = this.thr(xo), [lo1, hi1] = this.thr(xn);
    let f = this.ins.e.level ? this.ins.e.crossing(xo, xn, lo0, hi0, lo1, hi1) : 2;
    const p0 = this.supplySpan(xo) >= this.fam.vmin, p1 = this.supplySpan(xn) >= this.fam.vmin;
    if (p0 !== p1) f = Math.min(f, crossFrac(this.supplySpan(xo) - this.fam.vmin, this.supplySpan(xn) - this.fam.vmin));
    return f;
  }
  digital(s) {
    const pw = this.supplySpan(s.x) >= this.fam.vmin;
    const { lv, fall } = this.readInputs(s.x);
    if (!pw) { if (this.powered) this.ctl.powerOn(); this.powered = false; return false; }
    this.powered = true;
    if (fall.e) {
      let d = 0;
      for (let i = 0; i < 8; i++) if (lv['d' + i]) d |= 1 << i;
      this.ctl.bus(lv.rs, lv.rw, d);
    }
    return false;
  }
  current(x) { return this.supplySpan(x) * 1e-3 / 5; }
  power(x) { return this.supplySpan(x) ** 2 * 1e-3 / 5; }
  save() { return { ...super.save(), ctl: this.ctl.save(), powered: this.powered }; }
  restore(st) { super.restore(st); if (st && st.ctl) { this.ctl.restore(st.ctl); this.powered = st.powered; } }
  resetState() { super.resetState(); this.ctl.powerOn(); this.powered = false; }
  frameVis(vis) {
    const x = this.eng.x;
    const on = this.powered;
    vis.rows = on ? this.ctl.rows() : ['                ', '                '];
    vis.cursor = on ? this.ctl.cursor() : { r: 0, c: 0, on: false };
    const span = Math.max(0.1, this.supplySpan(x));
    vis.contrast = on ? Math.min(1, Math.max(0, 1 - 1.6 * (vat(x, this.iv0) - vat(x, this.ignd)) / span)) : 0;
    vis.lcdOn = on && this.ctl.disp;
    if (this.ctl.cgram.some(v => v)) vis.cgram = this.ctl.cgramRows();
  }
}

// ---------------------------------------------------------------- MCU pins
export const PIN_PROFILES = {
  avr: { rout: 25, rpu: 35000, rpd: 35000, vil: 0.3, vih: 0.6, imax: 0.04, vdd: 5 },
  esp32: { rout: 30, rpu: 45000, rpd: 45000, vil: 0.25, vih: 0.75, imax: 0.04, vdd: 3.3 },
};

export class McuPin extends Dev {
  static defaults = { profile: 'avr' };
  constructor(el, eng) {
    super(el, eng);
    this.digitalDev = true;
    this.nonlinear = true;
    this.prof = PIN_PROFILES[this.p.profile] || PIN_PROFILES.avr;
    this.pin = this.p.pin; this.host = null;
    this.cfg = { mode: 'in' }; this.switched = true; this.lvl = 0; this.t0 = 0;
    this.din = null; this.overT = 0; this.vc1 = 0; this.vc2 = 0;
    this.vcrit = vcritOf(1e-15, VT);
  }
  setup(b) {
    this.ip = b.node('p'); this.ignd = b.node('gnd'); this.ivdd = b.node('vdd');
    this.hv = b.pair(this.ip, this.ivdd); this.hg = b.pair(this.ip, this.ignd);
    this.din = new DIn(this.ip, this.ignd);
  }
  vddOf(x) { return vat(x, this.ivdd) - vat(x, this.ignd); }
  setCfg(cfg, t, switched) {
    const c = { ...cfg };
    if (c.mode === 'pwm' || c.mode === 'tone' || c.mode === 'servo') {
      if (c.duty != null && c.duty > 1) c.duty /= 255;
      if (c.mode === 'tone') { c.duty = 0.5; }
      if (c.mode === 'servo') {
        let pulse = +c.pulse || 1.5e-3;
        if (pulse > 0.1) pulse *= 1e-6;
        c.freq = 50; c.duty = pulse * 50; c.pulse = pulse;
      }
      if (!c.freq) c.freq = 490;
      c.duty = Math.min(1, Math.max(0, c.duty ?? 0));
    }
    const same = JSON.stringify(c) === JSON.stringify(this.cfg) && switched === this.switched;
    if (same) return false;
    const timedBefore = this.cfg.mode === 'pwm' || this.cfg.mode === 'tone' || this.cfg.mode === 'servo';
    const timed = c.mode === 'pwm' || c.mode === 'tone' || c.mode === 'servo';
    if (!timedBefore || !timed || this.cfg.freq !== c.freq) this.t0 = t;
    this.cfg = c; this.switched = switched;
    this.lvl = this.levelAt(t);
    return true;
  }
  timed() { const m = this.cfg.mode; return m === 'pwm' || m === 'tone' || m === 'servo'; }
  sig() { const m = this.cfg.mode; return this.damaged ? 'x' : m === 'out' ? (this.cfg.level ? 'H' : 'L') : this.timed() ? (this.switched ? (this.lvl ? 'h' : 'l') : 'a') : m[0] + m.length; }
  levelAt(t) {
    if (!this.timed()) return this.cfg.level ? 1 : 0;
    const d = this.cfg.duty;
    if (d <= 0) return 0;
    if (d >= 1) return 1;
    const T = 1 / this.cfg.freq;
    const u = (t - this.t0) / T + 1e-9;
    const ph = (u - Math.floor(u)) * T;
    return ph < d * T - 1e-12 * T ? 1 : 0;
  }
  nextBreak(t) {
    if (!this.timed() || !this.switched || this.damaged) return Infinity;
    const d = this.cfg.duty;
    if (d <= 0 || d >= 1) return Infinity;
    const T = 1 / this.cfg.freq;
    const n = Math.floor((t - this.t0) / T + 1e-9);
    const cands = [this.t0 + n * T + d * T, this.t0 + (n + 1) * T, this.t0 + (n + 1) * T + d * T];
    for (const c of cands) if (c > t + 1e-12 * Math.max(1, t)) return c;
    return Infinity;
  }
  fire(t) {
    if (!this.timed() || !this.switched) return false;
    const l = this.levelAt(t);
    if (l === this.lvl) return false;
    this.lvl = l;
    return true;
  }
  load(s) {
    const A = s.A, x = s.x, m = this.cfg.mode, P = this.prof;
    const g = 1 / P.rout;
    if (this.damaged || m === 'off' || (this.host && this.host.brownout)) stampG(A, this.hg, 1e-9);
    else if (m === 'out') stampG(A, this.cfg.level ? this.hv : this.hg, g);
    else if (m === 'in') stampG(A, this.hg, 1e-8);
    else if (m === 'in_pullup') { stampG(A, this.hv, 1 / P.rpu); stampG(A, this.hg, 1e-8); }
    else if (m === 'in_pulldown') stampG(A, this.hg, 1 / P.rpd);
    else if (this.timed()) {
      if (this.switched) stampG(A, this.lvl ? this.hv : this.hg, g);
      else { const d = this.cfg.duty; stampG(A, this.hv, g * d); stampG(A, this.hg, g * (1 - d)); }
    } else stampG(A, this.hg, 1e-8);
    // ESD clamp diodes: pin → vdd and gnd → pin
    const vp = vat(x, this.ip);
    const v1 = pnj(vp - vat(x, this.ivdd), this.vc1, VT * 1.5, this.vcrit);
    if (LIMIT.hit) s.noncon = true;
    const v2 = pnj(vat(x, this.ignd) - vp, this.vc2, VT * 1.5, this.vcrit);
    if (LIMIT.hit) s.noncon = true;
    this.vc1 = v1; this.vc2 = v2;
    const nvt = 1.5 * VT;
    if (v1 !== this._b1) { const e1 = Math.exp(Math.min(v1 / nvt, 80)); this._b1 = v1; this._i1 = 1e-15 * (e1 - 1); this._g1 = 1e-15 * e1 / nvt + GMIN; }
    if (v2 !== this._b2) { const e2 = Math.exp(Math.min(v2 / nvt, 80)); this._b2 = v2; this._i2 = 1e-15 * (e2 - 1); this._g2 = 1e-15 * e2 / nvt + GMIN; }
    const i1 = this._i1, g1 = this._g1, i2 = this._i2, g2 = this._g2;
    stampG(A, this.hv, g1);
    if (this.ip >= 0) s.rhs[this.ip] -= i1 - g1 * v1;
    if (this.ivdd >= 0) s.rhs[this.ivdd] += i1 - g1 * v1;
    stampG(A, this.hg, g2);
    if (this.ignd >= 0) s.rhs[this.ignd] -= i2 - g2 * v2;
    if (this.ip >= 0) s.rhs[this.ip] += i2 - g2 * v2;
  }
  // current out of the pin into the circuit
  current(x) {
    const m = this.cfg.mode, P = this.prof, vp = vat(x, this.ip);
    const vd = vat(x, this.ivdd), vg = vat(x, this.ignd);
    if (this.damaged || m === 'off' || (this.host && this.host.brownout)) return 0;
    if (m === 'out') return ((this.cfg.level ? vd : vg) - vp) / P.rout;
    if (m === 'in_pullup') return (vd - vp) / P.rpu;
    if (m === 'in_pulldown') return (vg - vp) / P.rpd;
    if (this.timed()) {
      if (this.switched) return ((this.lvl ? vd : vg) - vp) / P.rout;
      const d = this.cfg.duty;
      return (d * vd + (1 - d) * vg - vp) / P.rout;
    }
    return 0;
  }
  power(x) { const i = this.current(x); return i * i * this.prof.rout; }
  thr(x) { const v = Math.max(0, this.vddOf(x)); return [this.prof.vil * v, this.prof.vih * v]; }
  cross(xo, xn) {
    if (!this.host || !this.host.mcu || this.host.brownout || !this.host.watching(this.pin)) return 2;
    const [lo0, hi0] = this.thr(xo), [lo1, hi1] = this.thr(xn);
    return this.din.crossing(xo, xn, lo0, hi0, lo1, hi1);
  }
  digital(s) {
    const [lo, hi] = this.thr(s.x);
    const nl = this.din.next(s.x, lo, hi);
    if (nl !== this.din.level) {
      this.din.level = nl;
      if (this.host) this.host.pinEvent(this.pin, nl, s.t);
    }
    return false;
  }
  accept(s) {
    if (this.damaged) return;
    const i = Math.abs(this.current(s.x));
    if (i > this.prof.imax) this.overT += s.h; else this.overT = 0;
    if (this.overT > 0.01) {
      this.damage('dead-pin', `${this.label()} pin ${this.pin} died: ${(i * 1000).toFixed(0)} mA (limit ${(this.prof.imax * 1000).toFixed(0)} mA). Use a resistor or a transistor driver.`, false, s.t);
    }
  }
  save() { return { ...super.save(), cfg: { ...this.cfg }, switched: this.switched, lvl: this.lvl, t0: this.t0, din: this.din.level }; }
  restore(st) {
    super.restore(st);
    if (st && st.cfg) { this.cfg = st.cfg; this.switched = st.switched; this.lvl = st.lvl; this.t0 = st.t0; this.din.level = st.din; }
  }
}

export class McuCore extends Dev {
  static defaults = { idd: 0.02, vnom: 5 };
  setup(b) { this.ivdd = b.node('vdd'); this.ignd = b.node('gnd'); this.h = b.pair(this.ivdd, this.ignd); }
  g() { return this.p.idd / this.p.vnom; }
  load(s) { stampG(s.A, this.h, this.g()); }
  current(x) { return (vat(x, this.ivdd) - vat(x, this.ignd)) * this.g(); }
  power(x) { return (vat(x, this.ivdd) - vat(x, this.ignd)) ** 2 * this.g(); }
}

export const DIGITAL_TYPES = { logic: Logic, 'logic-expr': LogicExpr, hd44780: Lcd, mcupin: McuPin, mcucore: McuCore };
