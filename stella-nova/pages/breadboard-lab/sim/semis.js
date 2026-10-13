// ============================================================================
//  BREADBOARD LAB  ·  sim/semis.js — diodes, LEDs, bipolar and MOS transistors
// ----------------------------------------------------------------------------
//  DIODE. Shockley junction i = Is·(exp(v/(n·VT)) − 1) behind a series
//  resistance rs (an internal node when rs > 0). Reverse breakdown is a
//  softplus knee at −bv with a 1 Ω slope, so it needs no limiting. The LED is
//  the same junction; its Is comes from the colour so that vf at 20 mA is the
//  table value of the contract (red 2.0 V … blue 3.1 V).
//
//  BJT. Transport Ebers-Moll with the Early effect on the transfer current:
//    Icc = Is·(e^(vbe/VT) − e^(vbc/VT))·(1 − vbc/Vaf)
//    Ic = Icc − Is/βr·(e^(vbc/VT) − 1),   Ib = Is/βf·(e^(vbe/VT) − 1) + Is/βr·(e^(vbc/VT) − 1)
//  In the active region Ic/Ib = βf·(1 − vbc/Vaf). A softplus avalanche from
//  C to E at BVceo bounds the flyback spike of an unprotected coil. Every
//  current is linearized in (vbe, vbc) after junction limiting, then mapped
//  to the three nodes. A PNP is the same with every sign flipped.
//
//  MOSFET. Square law with a softplus overdrive (smooth at threshold):
//    sat: Id = k/2·vov²·(1 + λ·vds);  triode: Id = k·(vov·vds − vds²/2)·(1 + λ·vds)
//  Drain and source swap when vds < 0. Power parts carry a body diode and
//  an avalanche at BVdss.
//
//  DAMAGE. Thermal model per device (devbase thermalStep). An LED above iabs
//  for 50 ms burns open with smoke. A transistor dies open above about 1.2 ×
//  pmax in steady state.
//
//  GREP MAP
//    DIODE_MODELS / LED_VF / BJT_MODELS / MOS_MODELS   the model tables
//    junction ............ current and conductance of one pn junction
//    Diode / Zener / Led
//    Bjt ................. npn and pnp
//    Mos ................. nmos and pmos
//    ledModel ............ Is, n and rs of an LED colour (tests use it)
//    SEMI_TYPES .......... type name → class
// ============================================================================
import {
  Dev, VT, GMIN, vat, stampG, stampI, pnjlim, vcritOf, stepLimit, softplus, sigmoid, thermalStep,
} from './devbase.js';

export const DIODE_MODELS = {
  '1n4148': { is: 2.52e-9, n: 1.752, rs: 0.568, bv: 100, pmax: 0.5 },
  '1n4007': { is: 7.03e-9, n: 1.808, rs: 0.034, bv: 1000, pmax: 3 },
  schottky: { is: 3.17e-5, n: 1.373, rs: 0.051, bv: 40, pmax: 1.25 },
};
export const LED_VF = { red: 2.0, orange: 2.05, yellow: 2.1, green: 2.2, blue: 3.1, white: 3.1, ir: 1.3 };
const LED_N = { red: 2, orange: 2, yellow: 2.1, green: 2.3, blue: 3, white: 3, ir: 1.6 };
const LED_RS = { red: 5, orange: 5, yellow: 5, green: 6, blue: 10, white: 10, ir: 3 };
export function ledModel(color) {
  const c = LED_VF[color] != null ? color : 'red';
  const n = LED_N[c], rs = LED_RS[c], vf = LED_VF[c];
  const is = 0.02 / Math.expm1((vf - 0.02 * rs) / (n * VT));
  return { is, n, rs, vf };
}
export const BJT_MODELS = {
  '2n3904': { is: 6.734e-15, bf: 416.4, br: 0.7371, vaf: 74.03, pmax: 0.625, bv: 40 },
  '2n2222': { is: 14.34e-15, bf: 255.9, br: 6.092, vaf: 74.03, pmax: 0.625, bv: 40 },
  '2n3906': { is: 1.41e-15, bf: 180.7, br: 4.977, vaf: 18.7, pmax: 0.625, bv: 40 },
};
export const MOS_MODELS = {
  '2n7000': { vth: 2.1, k: 0.08, lambda: 0.01, pmax: 0.4, bv: 60, body: false },
  'logic-to220': { vth: 1.5, k: 12, lambda: 0.005, pmax: 2, bv: 55, body: true },
  'p-to220': { vth: 2.0, k: 3, lambda: 0.01, pmax: 2, bv: 60, body: true },
};

// one junction: returns [i, g] at the (already limited) voltage v
export function junction(v, is, nvt) {
  const e = Math.exp(Math.min(v / nvt, 90));
  return [is * (e - 1) + GMIN * v, is * e / nvt + GMIN];
}
// softplus avalanche: current in the reverse direction above bv
function avalanche(vrev, bv, r, s = 0.05) {
  const u = (vrev - bv) / s;
  return [s / r * softplus(u), sigmoid(u) / r];
}

// ------------------------------------------------------------------- diode
export class Diode extends Dev {
  static defaults = { model: '1n4148' };
  constructor(el, eng) {
    super(el, eng);
    this.nonlinear = true;
    const m = DIODE_MODELS[this.p.model] || DIODE_MODELS['1n4148'];
    for (const k of ['is', 'n', 'rs', 'bv', 'pmax']) if (this.p[k] == null) this.p[k] = m[k];
    if (this.p.ibv == null) this.p.ibv = 1e-4;
    this.init();
  }
  init() {
    this.nvt = this.p.n * VT;
    this.vcrit = vcritOf(this.p.is, this.nvt);
    this.vd = 0;
  }
  setup(b) {
    this.ia = b.node('a'); this.ik = b.node('k');
    if (this.p.rs > 0) {
      this.ij = b.internal('j');
      this.hrs = b.pair(this.ia, this.ij);
    } else this.ij = this.ia;
    this.hd = b.pair(this.ij, this.ik);
  }
  // reverse branch current (k → a direction as positive) and its slope vs vka
  rev(vka) { return avalanche(vka, this.p.bv, 1); }
  load(s) {
    if (this.damaged) { stampG(s.A, this.hd, GMIN); if (this.hrs) stampG(s.A, this.hrs, 1 / this.p.rs); return; }
    if (this.hrs) stampG(s.A, this.hrs, 1 / this.p.rs);
    const v = vat(s.x, this.ij) - vat(s.x, this.ik);
    const [vl, lim] = pnjlim(v, this.vd, this.nvt, this.vcrit);
    if (lim) s.noncon = true;
    this.vd = vl;
    let [i, g] = junction(vl, this.p.is, this.nvt);
    const [ir, gr] = this.rev(-vl);
    i -= ir; g += gr;
    stampG(s.A, this.hd, g);
    stampI(s.rhs, this.ij, this.ik, i - g * vl);
  }
  iAt(v) {
    const [i] = junction(v, this.p.is, this.nvt);
    return i - this.rev(-v)[0];
  }
  current(x) { return this.damaged ? 0 : this.iAt(vat(x, this.ij) - vat(x, this.ik)); }
  power(x) { return this.damaged ? 0 : this.current(x) * (vat(x, this.ia) - vat(x, this.ik)); }
  accept(s) {
    this.vd = vat(s.x, this.ij) - vat(s.x, this.ik);
    if (this.damaged) return;
    const P = this.power(s.x), pmax = this.p.pmax || 0.5;
    this.temp = thermalStep(this.temp, Math.abs(P), 100 / pmax, 0.5, s.h);
    if (this.temp > 275) this.damage('burnt', `${this.label()} burned: ${Math.abs(P).toFixed(2)} W in a ${pmax} W diode.`, true, s.t);
  }
  save() { return { ...super.save(), vd: this.vd }; }
  restore(st) { super.restore(st); if (st && st.vd != null) this.vd = st.vd; }
}

export class Zener extends Diode {
  static defaults = { vz: 5.1, rz: 5, is: 1e-14, n: 1, rs: 0, bv: 0, pmax: 0.5 };
  rev(vka) { return avalanche(vka, this.p.vz, this.p.rz, 0.03); }
}

export class Led extends Diode {
  static defaults = { color: 'red', imax: 0.02, iabs: 0.05, vrmax: 5 };
  constructor(el, eng) {
    const m = ledModel((el.params || {}).color || 'red');
    el = { ...el, params: { is: m.is, n: m.n, rs: m.rs, bv: 40, pmax: 1, ...(el.params || {}) } };
    super(el, eng);
    this.overAbs = 0; this.overMax = 0;
    this.metered = true;
  }
  paramChanged(key) {
    if (key === 'color') {
      const m = ledModel(this.p.color);
      Object.assign(this.p, { is: m.is, n: m.n, rs: m.rs });
      this.init();
    }
  }
  accept(s) {
    this.vd = vat(s.x, this.ij) - vat(s.x, this.ik);
    if (this.damaged) return;
    const i = this.current(s.x);
    if (i > this.p.iabs) this.overAbs += s.h; else this.overAbs = 0;
    if (i > this.p.imax * 1.5) this.overMax += s.h; else this.overMax = Math.max(0, this.overMax - s.h);
    if (this.overAbs > 0.05) {
      this.damage('burnt', `${this.label()} burned out: ${(i * 1000).toFixed(0)} mA through an LED rated ${(this.p.imax * 1000).toFixed(0)} mA. Put a resistor in series (about 220 Ω at 5 V).`, true, s.t);
    } else if (this.overMax > 3) {
      this.damage('burnt', `${this.label()} overheated: ${(i * 1000).toFixed(0)} mA for seconds (rated ${(this.p.imax * 1000).toFixed(0)} mA). Use a larger series resistor.`, true, s.t);
    }
  }
  frameVis(vis, avgI) {
    vis.b = this.damaged ? 0 : Math.min(1.5, Math.max(0, avgI) / 0.02);
    vis.color = this.p.color;
  }
}

// --------------------------------------------------------------------- BJT
export class Bjt extends Dev {
  static defaults = { model: '2n3904' };
  constructor(el, eng) {
    super(el, eng);
    this.nonlinear = true;
    this.sgn = el.type === 'pnp' ? -1 : 1;
    const def = this.sgn < 0 ? '2n3906' : '2n3904';
    const m = BJT_MODELS[this.p.model] || BJT_MODELS[def];
    for (const k of ['is', 'bf', 'br', 'vaf', 'pmax', 'bv']) if (this.p[k] == null) this.p[k] = m[k];
    this.vcrit = vcritOf(this.p.is, VT);
    this.vbe = 0; this.vbc = 0;
  }
  setup(b) {
    this.ic = b.node('c'); this.ib = b.node('b'); this.ie = b.node('e');
    const ids = [this.ic, this.ib, this.ie];
    this.H = [];
    for (const r of ids) for (const c of ids) this.H.push(b.entry(r, c));
  }
  // currents (Ic, Ib) and derivatives in junction coordinates
  eval(vbe, vbc) {
    const p = this.p;
    const eBE = Math.exp(Math.min(vbe / VT, 90)), eBC = Math.exp(Math.min(vbc / VT, 90));
    const If = p.is * (eBE - 1), Ir = p.is * (eBC - 1);
    const gif = p.is * eBE / VT, gir = p.is * eBC / VT;
    let kE = 1 - vbc / p.vaf, dkE = -1 / p.vaf;
    if (kE < 0.05) { kE = 0.05; dkE = 0; }
    const Icc = (If - Ir) * kE;
    let Ic = Icc - Ir / p.br + GMIN * (vbe - vbc);
    let gc_be = gif * kE + GMIN;
    let gc_bc = -gir * kE + (If - Ir) * dkE - gir / p.br - GMIN;
    const Ib = If / p.bf + Ir / p.br + GMIN * (vbe + vbc);
    const gb_be = gif / p.bf + GMIN, gb_bc = gir / p.br + GMIN;
    // avalanche C→E at bv (vce = vbe − vbc)
    const [ia, ga] = avalanche(vbe - vbc, p.bv, 2, 0.1);
    Ic += ia; gc_be += ga; gc_bc -= ga;
    return [Ic, gc_be, gc_bc, Ib, gb_be, gb_bc];
  }
  load(s) {
    const x = s.x, sg = this.sgn;
    if (this.damaged) {
      const H = this.H;
      for (const [r, c] of [[0, 0], [1, 1], [2, 2]]) if (H[r * 3 + c] >= 0) s.A[H[r * 3 + c]] += GMIN;
      return;
    }
    const vb = vat(x, this.ib), vc = vat(x, this.ic), ve = vat(x, this.ie);
    let vbe = sg * (vb - ve), vbc = sg * (vb - vc);
    const [l1, a] = pnjlim(vbe, this.vbe, VT, this.vcrit);
    const [l2, b2] = pnjlim(vbc, this.vbc, VT, this.vcrit);
    if (a || b2) s.noncon = true;
    vbe = l1; vbc = l2;
    this.vbe = vbe; this.vbc = vbc;
    const [Ic, gcbe, gcbc, Ib, gbbe, gbbc] = this.eval(vbe, vbc);
    const A = s.A, H = this.H, rhs = s.rhs;
    // rows: 0 = c, 1 = b, 2 = e ; cols the same order
    const rows = [[Ic, gcbe, gcbc], [Ib, gbbe, gbbc], [-(Ic + Ib), -(gcbe + gbbe), -(gcbc + gbbc)]];
    const idx = [this.ic, this.ib, this.ie];
    for (let r = 0; r < 3; r++) {
      const [I0, gbe, gbc] = rows[r];
      const ri = idx[r];
      if (ri < 0) continue;
      rhs[ri] -= sg * (I0 - gbe * vbe - gbc * vbc);
      if (H[r * 3 + 1] >= 0) A[H[r * 3 + 1]] += gbe + gbc;
      if (H[r * 3 + 2] >= 0) A[H[r * 3 + 2]] -= gbe;
      if (H[r * 3 + 0] >= 0) A[H[r * 3 + 0]] -= gbc;
    }
  }
  terminal(x) {
    const sg = this.sgn;
    const vb = vat(x, this.ib), vc = vat(x, this.ic), ve = vat(x, this.ie);
    const [Ic, , , Ib] = this.eval(sg * (vb - ve), sg * (vb - vc));
    return [sg * Ic, sg * Ib];
  }
  current(x) { return this.damaged ? 0 : this.terminal(x)[0]; }
  power(x) {
    if (this.damaged) return 0;
    const [ic, ib] = this.terminal(x);
    const ve = vat(x, this.ie);
    return ic * (vat(x, this.ic) - ve) + ib * (vat(x, this.ib) - ve);
  }
  accept(s) {
    const x = s.x, sg = this.sgn;
    const vb = vat(x, this.ib);
    this.vbe = sg * (vb - vat(x, this.ie)); this.vbc = sg * (vb - vat(x, this.ic));
    if (this.damaged) return;
    const P = this.power(x);
    this.temp = thermalStep(this.temp, Math.abs(P), 125 / this.p.pmax, 1, s.h);
    if (this.temp > 175) this.damage('burnt', `${this.label()} overheated and failed: ${Math.abs(P).toFixed(2)} W in a ${this.p.pmax} W transistor.`, true, s.t);
  }
  save() { return { ...super.save(), vbe: this.vbe, vbc: this.vbc }; }
  restore(st) { super.restore(st); if (st && st.vbe != null) { this.vbe = st.vbe; this.vbc = st.vbc; } }
}

// --------------------------------------------------------------------- MOS
export class Mos extends Dev {
  static defaults = {};
  constructor(el, eng) {
    super(el, eng);
    this.nonlinear = true;
    this.sgn = el.type === 'pmos' ? -1 : 1;
    const def = this.sgn < 0 ? 'p-to220' : '2n7000';
    const m = MOS_MODELS[this.p.model] || MOS_MODELS[def];
    for (const k of ['vth', 'k', 'lambda', 'pmax', 'bv', 'body']) if (this.p[k] == null) this.p[k] = m[k];
    this.p.vth = Math.abs(this.p.vth);
    this.vgs = 0; this.vds = 0; this.vbd = 0;
    this.bodyVcrit = vcritOf(1e-12, 1.2 * VT);
  }
  setup(b) {
    this.nd = b.node('d'); this.ig = b.node('g'); this.is_ = b.node('s');
    const ids = [this.nd, this.ig, this.is_];
    this.H = [];
    for (const r of ids) for (const c of ids) this.H.push(b.entry(r, c));
    this.hgs = b.pair(this.ig, this.is_);
    this.hsd = b.pair(this.is_, this.nd);
  }
  // forward square law for vds >= 0: [id, gm, gds]
  fwd(vgs, vds) {
    const { vth, k, lambda } = this.p;
    const st = 0.03;
    const vov = st * softplus((vgs - vth) / st), dvov = sigmoid((vgs - vth) / st);
    const cl = 1 + lambda * vds;
    if (vds < vov) {
      const f = vov * vds - vds * vds / 2;
      return [k * f * cl, k * vds * cl * dvov, k * (vov - vds) * cl + k * f * lambda];
    }
    return [k / 2 * vov * vov * cl, k * vov * cl * dvov, k / 2 * vov * vov * lambda];
  }
  // channel current d → s and derivatives vs (vgs, vds)
  chan(vgs, vds) {
    if (vds >= 0) return this.fwd(vgs, vds);
    const [i, g, d] = this.fwd(vgs - vds, -vds);
    return [-i, -g, g + d];
  }
  load(s) {
    const x = s.x, sg = this.sgn, A = s.A, H = this.H;
    stampG(A, this.hgs, GMIN);
    if (this.damaged) { stampG(A, this.hsd, GMIN); return; }
    const vg = vat(x, this.ig), vd = vat(x, this.nd), vs = vat(x, this.is_);
    let vgs = sg * (vg - vs), vds = sg * (vd - vs);
    let l1, l2;
    [vgs, l1] = stepLimit(vgs, this.vgs, Math.max(1, Math.abs(this.vgs - this.p.vth)));
    [vds, l2] = stepLimit(vds, this.vds, Math.max(2, Math.abs(this.vds)));
    if (l1 || l2) s.noncon = true;
    this.vgs = vgs; this.vds = vds;
    let [I, gm, gds] = this.chan(vgs, vds);
    const [ia, ga] = avalanche(vds, this.p.bv, 2, 0.1);
    I += ia; gds += ga;
    I += GMIN * vds; gds += GMIN;
    // rows d (0) and s (2); cols d 0, g 1, s 2
    const c0 = sg * (I - gm * vgs - gds * vds);
    if (this.nd >= 0) s.rhs[this.nd] -= c0;
    if (this.is_ >= 0) s.rhs[this.is_] += c0;
    const put = (r, c, v) => { const h = H[r * 3 + c]; if (h >= 0) A[h] += v; };
    put(0, 1, gm); put(0, 0, gds); put(0, 2, -gm - gds);
    put(2, 1, -gm); put(2, 0, -gds); put(2, 2, gm + gds);
    if (this.p.body) {
      // body diode from source to drain (nmos); drain to source (pmos)
      let vb = -vds;
      const [vl, lim] = pnjlim(vb, this.vbd, 1.2 * VT, this.bodyVcrit);
      if (lim) s.noncon = true;
      this.vbd = vl;
      const [ib, gb] = junction(vl, 1e-12, 1.2 * VT);
      // current ib flows s → d (in sgn space); the source-drain pair carries it
      stampG(A, this.hsd, gb);
      stampI(s.rhs, this.is_, this.nd, sg * (ib - gb * vl));
    }
  }
  chanAt(x) {
    const sg = this.sgn;
    const vgs = sg * (vat(x, this.ig) - vat(x, this.is_)), vds = sg * (vat(x, this.nd) - vat(x, this.is_));
    let I = this.chan(vgs, vds)[0] + avalanche(vds, this.p.bv, 2, 0.1)[0];
    if (this.p.body) I -= junction(-vds, 1e-12, 1.2 * VT)[0];
    return sg * I;
  }
  current(x) { return this.damaged ? 0 : this.chanAt(x); }
  power(x) { return this.damaged ? 0 : this.chanAt(x) * (vat(x, this.nd) - vat(x, this.is_)); }
  accept(s) {
    const x = s.x, sg = this.sgn;
    this.vgs = sg * (vat(x, this.ig) - vat(x, this.is_)); this.vds = sg * (vat(x, this.nd) - vat(x, this.is_));
    this.vbd = -this.vds;
    if (this.damaged) return;
    const P = Math.abs(this.power(x));
    this.temp = thermalStep(this.temp, P, 125 / this.p.pmax, 1, s.h);
    if (this.temp > 175) this.damage('burnt', `${this.label()} overheated and failed: ${P.toFixed(2)} W in a ${this.p.pmax} W MOSFET.`, true, s.t);
  }
  save() { return { ...super.save(), vgs: this.vgs, vds: this.vds }; }
  restore(st) { super.restore(st); if (st && st.vgs != null) { this.vgs = st.vgs; this.vds = st.vds; } }
}

export const SEMI_TYPES = { diode: Diode, zener: Zener, led: Led, npn: Bjt, pnp: Bjt, nmos: Mos, pmos: Mos };
