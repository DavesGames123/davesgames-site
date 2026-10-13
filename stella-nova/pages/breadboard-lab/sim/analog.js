// ============================================================================
//  BREADBOARD LAB  ·  sim/analog.js — op-amp, 555 timer and regulators
// ----------------------------------------------------------------------------
//  OP-AMP. Two stages. The input stage is a transconductance gm1 with a tanh
//  limit into an internal node x. R1 and C1 on x set the DC gain a0 = gm1·R1
//  and the dominant pole a0·fp = gbw. The tanh limit sets the slew rate:
//  slew = Imax / C1. The output stage drives the pin through rout toward a
//  soft clamp of x between the model rails (vee + swingLow, vcc − swingHigh).
//  The output current comes from vcc when it sources and goes to vee when it
//  sinks, so the supply pins carry the load current. A soft clamp on x
//  keeps x near the rails, so the amplifier comes out of saturation fast.
//
//  555. The internal 5k-5k-5k divider is real (ctrl is a pin; the lower
//  reference is an internal node). Two comparators and a reset input feed an
//  SR latch: trigger below the lower reference sets it (and wins), threshold
//  above ctrl resets it, reset below 0.7 V clears it. The engine finds the
//  exact crossing time (cross()), so the timing does not depend on the step.
//  Output: Norton source, high = vcc − 1.4 V, low = gnd + 0.05 V, rout 10 Ω.
//  Discharge: 10 Ω to gnd while the latch is clear.
//
//  REGULATOR. A pass current Ip from in to out, toward the target
//  vt = softmin(gnd + vout_nominal, vin − dropout). Three regions, picked
//  per Newton iteration with hysteresis (as in the bench supply): 'reg' is
//  a Thevenin source vt behind 5 mΩ, 'lim' is a current source at the
//  limit (folded back by a thermal model above 150 °C), 'off' is vout above
//  vt (the pass element does not sink). A 1 µS leak from vt to out keeps a
//  floating output defined; in 'off' the leak goes to the ground pin.
//  The ground pin takes the quiescent current.
//  Model 'ideal' (or boost: true) is the boost of the 18650 shield: no
//  dropout, and the input current scales by vout / vin / 0.9. Below its
//  undervoltage lockout uvlo (2.7 V for a boost; 0.2 V hysteresis) the
//  regulator is 'off'. Without it the boost made 5 V from an open switch.
//
//  GREP MAP
//    OPAMP_MODELS / REG_MODELS
//    softClamp2 .......... two-sided soft clamp with derivatives
//    Opamp ............... the two-stage macro model
//    Timer555 ............ the behavioural 555
//    Regulator ........... 78xx and 1117 regulators, ideal boost
//    ANALOG_TYPES ........ type name → class
// ============================================================================
import { Dev, vat, stampG, stampI, softplus, sigmoid, softmin, thermalStep, lteRatio, pushHist, GMIN, crossFrac, CROSS } from './devbase.js';

export const OPAMP_MODELS = {
  lm358: { a0: 1e5, gbw: 1e6, rout: 50, slew: 0.3e6, swHi: 1.5, swLo: 0.005, iq: 0.7e-3 },
  ideal: { a0: 1e6, gbw: 1e8, rout: 1, slew: 1e9, swHi: 0, swLo: 0, iq: 0 },
};
export const REG_MODELS = {
  '7805': { vout: 5, dropout: 2, iq: 5e-3, imax: 1.5, rth: 50 },
  'ncp1117-5': { vout: 5, dropout: 1.1, iq: 5e-3, imax: 1, rth: 60 },
  'ams1117-3.3': { vout: 3.3, dropout: 1.1, iq: 5e-3, imax: 1, rth: 60 },
  ideal: { vout: 5, dropout: -100, iq: 1e-3, imax: 2, rth: 20 },
};

// f(u) = clamp of u into [lo, hi] with width s. Returns [f, df/du, df/dlo, df/dhi].
export function softClamp2(u, lo, hi, s) {
  const a = (u - lo) / s;
  const g = lo + s * softplus(a), dg_du = sigmoid(a), dg_dlo = 1 - dg_du;
  const b = (hi - g) / s;
  const f = hi - s * softplus(b), df_dg = sigmoid(b), df_dhi = 1 - df_dg;
  return [f, df_dg * dg_du, df_dg * dg_dlo, df_dhi];
}

// add a linearized current L (leaving `row`) with partials J over cols
function stampRow(s, eng, row, L0, cols, J, v0) {
  if (row < 0) return;
  let c = L0;
  for (let j = 0; j < cols.length; j++) {
    c -= J[j] * v0[j];
    const h = eng.entryOf(row, cols[j]);
    if (h >= 0) s.A[h] += J[j];
  }
  s.rhs[row] -= c;
}

// ------------------------------------------------------------------ op-amp
export class Opamp extends Dev {
  static defaults = { model: 'lm358' };
  constructor(el, eng) {
    super(el, eng);
    this.nonlinear = true;
    const m = OPAMP_MODELS[this.p.model] || OPAMP_MODELS.lm358;
    for (const k of Object.keys(m)) if (this.p[k] == null) this.p[k] = m[k];
    this.gm1 = 1e-3;
    this.R1 = this.p.a0 / this.gm1;
    this.C1 = this.gm1 / (2 * Math.PI * this.p.gbw);
    this.Im = this.p.slew * this.C1;
    this.resetState();
  }
  resetState() { super.resetState(); this.xc = 0; this.ic = 0; this.hist = [0, 0, 0]; }
  save() { return { ...super.save(), xc: this.xc, ic: this.ic, hist: this.hist.slice() }; }
  restore(st) { super.restore(st); if (st && st.xc != null) { this.xc = st.xc; this.ic = st.ic; this.hist = st.hist.slice(); } }
  setup(b) {
    this.ip = b.node('inp'); this.in = b.node('inn'); this.io = b.node('out');
    this.ivcc = b.node('vcc'); this.ivee = b.node('vee');
    this.ix = b.internal('x');
    const all = [this.ip, this.in, this.io, this.ivcc, this.ivee, this.ix];
    for (const r of [this.io, this.ivcc, this.ivee, this.ix]) for (const c of all) b.entry(r, c);
    this.hq = b.pair(this.ivcc, this.ivee);
    this.hin = b.pair(this.ip, this.in);
  }
  powered(x) { return vat(x, this.ivcc) - vat(x, this.ivee) > 1.0; }
  outI(x) {
    const vcc = vat(x, this.ivcc), vee = vat(x, this.ivee), xv = x[this.ix], vo = vat(x, this.io);
    const lo = vee + this.p.swLo, hi = vcc - this.p.swHi;
    if (hi - lo < 0.1) return [(0.5 * (vcc + vee) - vo) * 1e-6, 0, 0, 0, 1e-6];
    const [f, fx, flo, fhi] = softClamp2(xv, lo, hi, 0.01);
    const g = 1 / this.p.rout;
    return [(f - vo) * g, fx * g, fhi * g, flo * g, g];
  }
  load(s) {
    const x = s.x, eng = this.eng;
    if (this.p.iq > 0) stampG(s.A, this.hq, this.p.iq / 5);
    stampG(s.A, this.hin, GMIN);
    // input stage into x
    const vd = vat(x, this.ip) - vat(x, this.in);
    const th = Math.tanh(this.gm1 * vd / this.Im);
    const iin = this.Im * th, gd = this.gm1 * (1 - th * th);
    stampRow(s, eng, this.ix, -iin, [this.ip, this.in], [-gd, gd], [vat(x, this.ip), vat(x, this.in)]);
    // R1 and C1 from x to ground
    let gx = 1 / this.R1;
    if (s.mode !== 'dc') {
      if (s.method === 'trap') { const g = 2 * this.C1 / s.h; gx += g; s.rhs[this.ix] += g * this.xc + this.ic; }
      else { const g = this.C1 / s.h; gx += g; s.rhs[this.ix] += g * this.xc; }
    }
    const hxx = eng.entryOf(this.ix, this.ix);
    s.A[hxx] += gx;
    // clamp of x near the rails
    const xv = x[this.ix], vcc = vat(x, this.ivcc), vee = vat(x, this.ivee);
    const sc = 0.05, gc = 1e-3;
    const a = (xv - vcc - 0.5) / sc, bb = (vee - 0.5 - xv) / sc;
    const icl = gc * sc * (softplus(a) - softplus(bb));
    const gcl = gc * (sigmoid(a) + sigmoid(bb));
    s.A[hxx] += gcl;
    s.rhs[this.ix] -= icl - gcl * xv;
    // output stage
    const [I, dx, dvcc, dvee, gout] = this.outI(x);
    const vo = vat(x, this.io);
    const cols = [this.ix, this.ivcc, this.ivee, this.io];
    const v0 = [xv, vcc, vee, vo];
    const J = [dx, dvcc, dvee, -gout];
    stampRow(s, eng, this.io, -I, cols, J.map(v => -v), v0);
    stampRow(s, eng, I >= 0 ? this.ivcc : this.ivee, I, cols, J, v0);
  }
  xTrial(s) { return s.x[this.ix]; }
  lte(s) { if (s.mode !== 'tran') return 0; return lteRatio(s, s.x[this.ix], this.hist, 1e-3); }
  accept(s) {
    const xv = s.x[this.ix];
    if (s.mode === 'tran') {
      const g = (s.method === 'trap' ? 2 : 1) * this.C1 / s.h;
      this.ic = s.method === 'trap' ? g * (xv - this.xc) - this.ic : g * (xv - this.xc);
    }
    this.xc = xv;
    pushHist(this.hist, xv);
  }
  acceptDC(s) { this.xc = s.x[this.ix]; this.ic = 0; this.hist = [this.xc, this.xc, this.xc]; }
  current(x) { return this.outI(x)[0]; }
  power(x) {
    const I = this.outI(x)[0], vo = vat(x, this.io);
    const rail = I >= 0 ? vat(x, this.ivcc) : vat(x, this.ivee);
    const vq = vat(x, this.ivcc) - vat(x, this.ivee);
    return (rail - vo) * I + vq * vq * this.p.iq / 5;
  }
}

// --------------------------------------------------------------------- 555
export class Timer555 extends Dev {
  static defaults = { vhiDrop: 1.4, vlo: 0.05, rout: 10, rdis: 10, iq: 3e-3 };
  constructor(el, eng) {
    super(el, eng);
    this.digitalDev = true;
    this.nonlinear = true; // output current path picks vcc or gnd from x
    this.q = 0; this.cu = false; this.cl = false; this.cr = false; this.pw = false;
  }
  setup(b) {
    for (const t of ['gnd', 'trig', 'out', 'reset', 'ctrl', 'thres', 'dis', 'vcc']) this['n_' + t] = b.node(t);
    this.iL = b.internal('lref');
    this.h1 = b.pair(this.n_vcc, this.n_ctrl); this.h2 = b.pair(this.n_ctrl, this.iL); this.h3 = b.pair(this.iL, this.n_gnd);
    this.hq = b.pair(this.n_vcc, this.n_gnd);
    this.hdis = b.pair(this.n_dis, this.n_gnd);
    this.hout = b.pair(this.n_out, this.n_gnd);
    for (const r of [this.n_out, this.n_vcc, this.n_gnd]) for (const c of [this.n_out, this.n_vcc, this.n_gnd]) b.entry(r, c);
    this.hin = [b.pair(this.n_trig, this.n_gnd), b.pair(this.n_thres, this.n_gnd), b.pair(this.n_reset, this.n_gnd)];
  }
  save() { return { ...super.save(), q: this.q, cu: this.cu, cl: this.cl, cr: this.cr }; }
  restore(st) { super.restore(st); if (st && st.q != null) { this.q = st.q; this.cu = st.cu; this.cl = st.cl; this.cr = st.cr; } }
  resetState() { super.resetState(); this.q = 0; this.cu = this.cl = this.cr = false; }
  us(x) {
    const g = vat(x, this.n_gnd);
    return {
      upper: vat(x, this.n_thres) - vat(x, this.n_ctrl),
      lower: x[this.iL] - vat(x, this.n_trig),
      reset: 0.7 - (vat(x, this.n_reset) - g),
      pw: vat(x, this.n_vcc) - g,
    };
  }
  load(s) {
    const A = s.A, x = s.x;
    stampG(A, this.h1, 1 / 5000); stampG(A, this.h2, 1 / 5000); stampG(A, this.h3, 1 / 5000);
    stampG(A, this.hq, 1 / (5 / this.p.iq));
    for (const h of this.hin) stampG(A, h, 1e-9);
    if (!this.pw) { stampG(A, this.hout, 1e-6); stampG(A, this.hdis, GMIN); return; }
    if (!this.q && !this.damaged) stampG(A, this.hdis, 1 / this.p.rdis);
    // output Norton: target depends on vcc (high) or gnd (low)
    const g = 1 / this.p.rout;
    const vcc = vat(x, this.n_vcc), vg = vat(x, this.n_gnd), vo = vat(x, this.n_out);
    const target = this.q ? vcc - this.p.vhiDrop : vg + this.p.vlo;
    const I = (target - vo) * g;
    const cols = [this.n_vcc, this.n_gnd, this.n_out];
    const J = this.q ? [g, 0, -g] : [0, g, -g];
    const v0 = [vcc, vg, vo];
    stampRow(s, this.eng, this.n_out, -I, cols, J.map(v => -v), v0);
    stampRow(s, this.eng, I >= 0 ? this.n_vcc : this.n_gnd, I, cols, J, v0);
  }
  cross(xo, xn) {
    const a = this.us(xo), b = this.us(xn);
    const h = 5e-4;
    // time only transitions that change the latch or the power state
    let cu = this.cu, cl = this.cl, cr = this.cr;
    if (b.upper > h) cu = true; else if (b.upper < -h) cu = false;
    if (b.lower > h) cl = true; else if (b.lower < -h) cl = false;
    if (b.reset > 0.02) cr = true; else if (b.reset < -0.02) cr = false;
    const pw = b.pw >= 2;
    const q = !pw || cr ? 0 : cl ? 1 : cu ? 0 : this.q;
    if (q === this.q && pw === this.pw) return 2;
    const p = CROSS.xp ? this.us(CROSS.xp) : null;
    let f = 2;
    if (pw !== this.pw) f = Math.min(f, crossFrac(a.pw - 2, b.pw - 2, p ? p.pw - 2 : undefined));
    const cf = (k, off) => crossFrac(a[k] + off, b[k] + off, p ? p[k] + off : undefined);
    if (!this.cu && b.upper > h) f = Math.min(f, cf('upper', -h));
    if (this.cu && b.upper < -h) f = Math.min(f, cf('upper', h));
    if (!this.cl && b.lower > h) f = Math.min(f, cf('lower', -h));
    if (this.cl && b.lower < -h) f = Math.min(f, cf('lower', h));
    if (!this.cr && b.reset > 0.02) f = Math.min(f, cf('reset', -0.02));
    if (this.cr && b.reset < -0.02) f = Math.min(f, cf('reset', 0.02));
    return f;
  }
  digital(s) {
    const u = this.us(s.x), h = 5e-4;
    if (u.upper > h) this.cu = true; else if (u.upper < -h) this.cu = false;
    if (u.lower > h) this.cl = true; else if (u.lower < -h) this.cl = false;
    if (u.reset > 0.02) this.cr = true; else if (u.reset < -0.02) this.cr = false;
    const pw = u.pw >= 2;
    let q = this.q;
    if (!pw) q = 0;
    else if (this.cr) q = 0;
    else if (this.cl) q = 1;
    else if (this.cu) q = 0;
    const changed = q !== this.q || pw !== this.pw;
    this.q = q; this.pw = pw;
    return changed;
  }
  current(x) {
    if (!this.pw) return 0;
    const target = this.q ? vat(x, this.n_vcc) - this.p.vhiDrop : vat(x, this.n_gnd) + this.p.vlo;
    return (target - vat(x, this.n_out)) / this.p.rout;
  }
  power(x) {
    const vq = vat(x, this.n_vcc) - vat(x, this.n_gnd);
    const I = this.current(x);
    const rail = I >= 0 ? vat(x, this.n_vcc) : vat(x, this.n_gnd);
    return vq * vq * this.p.iq / 5 + (rail - vat(x, this.n_out)) * I;
  }
  frameVis(vis) { vis.on = !!this.q; }
  sig() { return (this.pw ? 2 : 0) + this.q; }
}

// --------------------------------------------------------------- regulator
export class Regulator extends Dev {
  static defaults = { model: '7805' };
  constructor(el, eng) {
    super(el, eng);
    this.nonlinear = true;
    const m = REG_MODELS[this.p.model] || REG_MODELS['7805'];
    for (const k of Object.keys(m)) if (this.p[k] == null) this.p[k] = m[k];
    this.ideal = this.p.model === 'ideal' || this.p.boost === true || this.p.boost === 'true';
    this.limWarned = false; this.boostK = 1; this.region = 'reg';
    // undervoltage lockout: a boost stops below uvlo (2.7 V by default)
    if (this.p.uvlo == null && (this.p.boost === true || this.p.boost === 'true')) this.p.uvlo = 2.7;
    this.uv = false;
  }
  setup(b) {
    this.iin = b.node('in'); this.ig = b.node('gnd'); this.iout = b.node('out');
    const all = [this.iin, this.ig, this.iout];
    for (const r of all) for (const c of all) b.entry(r, c);
    this.hq = b.pair(this.iin, this.ig);
    this.hout = b.pair(this.iout, this.ig);
  }
  imaxEff() { return this.p.imax * Math.min(1, Math.max(0.02, (165 - this.temp) / 15)); }
  // Three regions, picked per Newton iteration with hysteresis (like the
  // bench supply): 'reg' a Thevenin source vt behind rreg, 'lim' a current
  // source at the limit, 'off' (vout above vt: the pass element does not
  // sink). A 1 µS leak from vt keeps a floating output defined.
  target(x) {
    const vin = vat(x, this.iin), vg = vat(x, this.ig);
    return this.ideal ? [vg + this.p.vout, 1, 0] : softmin(vg + this.p.vout, vin - this.p.dropout, 0.02);
  }
  pass(x, pick) {
    const rreg = 0.005, gleak = 1e-6;
    const vo = vat(x, this.iout);
    const [vt, da, db] = this.target(x);
    const d = vt - vo, iu = d / rreg, im = this.imaxEff();
    let reg = this.region || 'reg';
    const uvlo = +this.p.uvlo || 0;
    if (pick && uvlo > 0) {
      // 0.2 V of hysteresis, so Newton does not flip the lockout
      const vi = vat(x, this.iin) - vat(x, this.ig);
      if (this.uv) { if (vi > uvlo + 0.2) this.uv = false; } else if (vi < uvlo) this.uv = true;
    }
    if (uvlo > 0 && this.uv) { if (pick) this.region = 'off'; reg = 'off'; }
    else if (pick) {
      if (reg === 'reg') { if (iu > im * 1.0005) reg = 'lim'; else if (iu < -1e-6) reg = 'off'; }
      else if (reg === 'lim') { if (iu < im) reg = 'reg'; }
      else if (reg === 'off') { if (iu > 1e-6) reg = 'reg'; }
      this.region = reg;
    }
    let I, g;
    if (reg === 'reg') { I = iu + gleak * d; g = 1 / rreg + gleak; }
    else if (reg === 'lim') { I = im + gleak * d; g = gleak; }
    else {
      // off: the pass element conducts nothing. The leak goes to the ground
      // pin, not to vt: with no input, vt (vin − dropout) is below ground,
      // and a leak toward it pulled an open output to −1.1 V.
      return [gleak * (vat(x, this.ig) - vo), [0, gleak, -gleak]];
    }
    // partials of I vs (vin, vg, vout)
    return [I, [g * db, g * da, -g]];
  }
  load(s) {
    const x = s.x;
    const rq = (this.p.vout + 2) / this.p.iq;
    stampG(s.A, this.hq, 1 / rq);
    stampG(s.A, this.hout, GMIN * 1000);
    if (this.damaged) return;
    const before = this.region;
    const [I, J] = this.pass(x, true);
    if (before && before !== this.region) s.noncon = true;
    const cols = [this.iin, this.ig, this.iout];
    const v0 = cols.map(c => vat(x, c));
    stampRow(s, this.eng, this.iout, -I, cols, J.map(v => -v), v0);
    if (!this.ideal) stampRow(s, this.eng, this.iin, I, cols, J, v0);
    else {
      // boost: the input carries k·I (lagged k), the ground carries the rest
      const k = this.boostK;
      stampRow(s, this.eng, this.iin, k * I, cols, J.map(v => k * v), v0);
      stampRow(s, this.eng, this.ig, (1 - k) * I, cols, J.map(v => (1 - k) * v), v0);
    }
  }
  current(x) { return this.pass(x)[0]; }
  power(x) {
    const I = this.pass(x)[0];
    const vin = vat(x, this.iin), vg = vat(x, this.ig), vo = vat(x, this.iout);
    const rq = (this.p.vout + 2) / this.p.iq;
    return (this.ideal ? 0.1 * Math.abs(I * (vo - vg)) : (vin - vo) * I) + (vin - vg) ** 2 / rq;
  }
  accept(s) {
    const x = s.x;
    if (this.ideal) {
      const vin = vat(x, this.iin) - vat(x, this.ig), vo = vat(x, this.iout) - vat(x, this.ig);
      this.boostK = vin > 0.5 ? Math.min(20, Math.max(1, vo / vin / 0.9)) : 1;
    }
    if (s.mode !== 'tran') return;
    const P = Math.max(0, this.power(x));
    this.temp = thermalStep(this.temp, P, this.p.rth, 5, s.h);
    if (this.temp > 150 && !this.limWarned) {
      this.limWarned = true;
      this.eng._event({ t: s.t, kind: 'warn', owner: this.owner, element: this.id, severity: 'warn', msg: `${this.label()} is in thermal limit (${P.toFixed(1)} W). Its output current folds back. Use a heatsink or drop less voltage across it.` });
    } else if (this.temp < 130) this.limWarned = false;
  }
}

export const ANALOG_TYPES = { opamp: Opamp, timer555: Timer555, regulator: Regulator };
