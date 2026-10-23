// ============================================================================
//  OCTANE NUMBER  ·  knock.js — one engine cycle and its knock (no DOM)
// ----------------------------------------------------------------------------
//  A zero-dimensional model of the compression and power strokes of one
//  cylinder, from intake valve closing to exhaust valve opening. It is a
//  teaching model: one zone of gas, no heat loss, a fixed burn shape. The
//  page tags it "model". Every step is one crank degree.
//
//  GEOMETRY  slider-crank volume V(θ), θ = 0 at top centre.
//  BURN      Wiebe function xb(θ) = 1 - exp(-a ((θ - θs) / Δθ)^m), from
//            the spark θs over Δθ degrees; heat release LHV·mfuel·dxb.
//  PRESSURE  first law for a closed volume, ratio of heats γ:
//              dp = (γ-1)/V dQ - γ p/V dV
//  END GAS   the unburned gas ahead of the flame, compressed with no heat
//            loss: Tu = Tivc (p / pivc)^((γu-1)/γu).
//  DELAY     Douaud and Eyzat (1978), as given by Heywood:
//              τ = 17.68 ms · (ON/100)^3.402 · (p/atm)^-1.7 · exp(3800 K / Tu)
//  KNOCK     Livengood and Wu (1955): the end gas ignites when
//              I(θ) = ∫ dt / τ  reaches 1
//            before the flame has burned it (xb < XB_END). The unburned
//            share at that moment sets the knock intensity; the pressure
//            then rings at the first circumferential acoustic mode of the
//            bore, f = 1.84 c / (π B).
//
//  cycle(opts) -> { th[], V[], p0[], Tu[], I[], xb[], knock, ... }
//  pressureAt(c, θ) -> Pa, the trace with the knock ring, any θ
//  requiredON(opts) -> lowest octane number with no knock (bisection)
//  criticalCR(opts)  -> lowest compression ratio that knocks (the CFR idea)
//  CONTROLS  slider ranges and defaults for the page
//
//  grep -n targets: "export function volume", "export function wiebe",
//  "export function delayMs", "export function cycle", "export function pressureAt",
//  "export function requiredON", "export function criticalCR",
//  "export const CONTROLS"
// ============================================================================

export const ENGINE = {
  bore: 0.086, stroke: 0.086, rod: 0.145,   // m: a square 0.5 L cylinder
  ivc: -140, evo: 130,                     // valve events, crank degrees
  gamma: 1.30, gammaU: 1.30,               // burned mix, unburned end gas
  R: 287,                                  // J/(kg K), the mixture
  afr: 14.7, lhv: 43.4e6,                  // stoichiometric gasoline, J/kg
  eta: 0.75,                               // share of the fuel heat that raises pressure (the rest: wall loss, dissociation)
  burn: 60, wa: 5, wm: 3,                  // burn duration (deg) and Wiebe shape
  XB_END: 0.9,                             // past this burned share no end gas is left to knock
};

// The CFR test engine: 3.25 in bore, 4.5 in stroke (ASTM D2699). The rod
// length is a round value for the drawing and the volume curve.
export const CFR_ENGINE = { ...ENGINE, bore: 0.08255, stroke: 0.1143, rod: 0.254 };
// The two rating conditions in this model (see data.js CFR for the
// standards). The model fit (Douaud-Eyzat) holds for octane numbers of
// about 40 and up, the working range of the test method too.
export const RATING = {
  ron: { rpm: 600, tin: 325, spark: 13, boost: 1 },
  mon: { rpm: 900, tin: 422, spark: 20, boost: 1 },
};

export const CONTROLS = {
  on: { min: 40, max: 120, step: 1, def: 95, label: 'fuel octane number' },
  cr: { min: 7, max: 15, step: 0.1, def: 10.5, label: 'compression ratio' },
  spark: { min: 0, max: 45, step: 1, def: 22, label: 'spark advance, ° before top centre' },
  boost: { min: 0.6, max: 2.2, step: 0.05, def: 1.0, label: 'intake pressure, bar' },
  rpm: { min: 800, max: 6500, step: 50, def: 2000, label: 'engine speed, rpm' },
  tin: { min: 290, max: 360, step: 1, def: 325, label: 'intake temperature, K' },
};
export const defaults = () => Object.fromEntries(Object.entries(CONTROLS).map(([k, c]) => [k, c.def]));

const DEG = Math.PI / 180;

// Cylinder volume (m^3) at crank angle th (degrees, 0 = top centre).
export function volume(th, cr, E = ENGINE) {
  const A = Math.PI * E.bore * E.bore / 4, a = E.stroke / 2, l = E.rod;
  const Vd = A * E.stroke, Vc = Vd / (cr - 1);
  const s = Math.sin(th * DEG), c = Math.cos(th * DEG);
  return Vc + A * (l + a - a * c - Math.sqrt(l * l - a * a * s * s));
}
// Piston distance below top centre, m (for the drawing).
export function pistonDrop(th, E = ENGINE) {
  const a = E.stroke / 2, l = E.rod, s = Math.sin(th * DEG), c = Math.cos(th * DEG);
  return l + a - a * c - Math.sqrt(l * l - a * a * s * s);
}

// Burned mass share at th for a spark at -spark degrees.
export function wiebe(th, spark, E = ENGINE) {
  const u = (th + spark) / E.burn;
  return u <= 0 ? 0 : 1 - Math.exp(-E.wa * Math.pow(u, E.wm));
}

// Ignition delay of the end gas, ms. p in Pa, T in K.
export function delayMs(on, p, T) {
  return 17.68 * Math.pow(Math.max(on, 1) / 100, 3.402) * Math.pow(p / 101325, -1.7) * Math.exp(3800 / T);
}

// Acoustic ring frequency of the first circumferential mode, Hz.
export function ringHz(T, E = ENGINE) {
  return 1.841 * Math.sqrt(E.gamma * E.R * T) / (Math.PI * E.bore);
}

// One cycle. opts: { on, cr, spark, boost (bar), rpm, tin (K), ring (bool) }
export function cycle(opts, E = ENGINE) {
  const o = { ...defaults(), ...opts };
  const pivc = o.boost * 1e5, Tivc = o.tin;
  const Vivc = volume(E.ivc, o.cr, E);
  const mair = pivc * Vivc / (E.R * Tivc);
  const Qtot = E.eta * E.lhv * mair / E.afr;
  const msPerDeg = 1000 / (6 * o.rpm);
  const n = E.evo - E.ivc + 1;
  const th = new Float64Array(n), V = new Float64Array(n), p0 = new Float64Array(n);
  const Tu = new Float64Array(n), I = new Float64Array(n), xb = new Float64Array(n), T = new Float64Array(n);
  let P = pivc, integ = 0, knock = null, work = 0;
  for (let i = 0; i < n; i++) {
    const t = E.ivc + i;
    th[i] = t; V[i] = volume(t, o.cr, E); xb[i] = wiebe(t, o.spark, E);
    if (i > 0) {
      const dV = V[i] - V[i - 1], dQ = Qtot * (xb[i] - xb[i - 1]);
      const Vm = 0.5 * (V[i] + V[i - 1]);
      P = P + (E.gamma - 1) / Vm * dQ - E.gamma * P / Vm * dV;
      work += P * dV;
    }
    p0[i] = P;
    Tu[i] = Tivc * Math.pow(P / pivc, (E.gammaU - 1) / E.gammaU);
    T[i] = P * V[i] / (mair * (1 + 1 / E.afr) * E.R);
    if (!knock) {
      integ += msPerDeg / delayMs(o.on, P, Tu[i]);
      if (integ >= 1 && xb[i] < E.XB_END && t > -o.spark) {
        knock = { i, th: t, unburned: 1 - xb[i], p: P, Tu: Tu[i] };
      }
    }
    I[i] = Math.min(integ, 1.5);
  }
  // Ring: the amplitude grows with the unburned share at the onset (the
  // energy that is released at once). pressureAt() adds the damped sine.
  let amp = 0, hz = 0;
  if (knock) {
    hz = ringHz(T[knock.i], E);
    amp = Math.min(0.6, 2.2 * knock.unburned * knock.unburned + 0.25 * knock.unburned) * knock.p;
    knock.intensity = amp / 1e5;                   // bar
    knock.hz = hz;
  }
  const Vd = volume(180, o.cr, E) - volume(0, o.cr, E);
  const imep = work / Vd;                          // Pa
  let pmax = 0, thPmax = 0;
  for (let i = 0; i < n; i++) if (p0[i] > pmax) { pmax = p0[i]; thPmax = th[i]; }
  return { opts: o, th, V, p0, Tu, T, I, xb, knock, amp, hz, imep, pmax, thPmax, Vd, msPerDeg, eff: work / Qtot * E.eta };
}

// Pressure (Pa) at any crank angle: the smooth trace, linear between the
// whole degrees, plus the knock ring. The ring is about 6 kHz, two crank
// degrees a period at 2000 rpm, so a plot samples it finer than the cycle.
export function pressureAt(c, t) {
  const n = c.th.length, x = Math.max(0, Math.min(n - 1.0001, t - c.th[0]));
  const i = Math.floor(x), f = x - i;
  let P = c.p0[i] * (1 - f) + c.p0[i + 1] * f;
  if (c.knock && t > c.knock.th) {
    const s = (t - c.knock.th) / (6 * c.opts.rpm);      // seconds after onset
    P += c.amp * Math.exp(-s / RING_DECAY) * Math.sin(2 * Math.PI * c.hz * s);
  }
  return P;
}
export const RING_DECAY = 0.0012;                    // s, the e-folding time of the ring

// Lowest octane number that does not knock at these settings, or null
// when even ON 140 knocks, 0 when ON 0 does not.
export function requiredON(opts, E = ENGINE) {
  const knocks = on => !!cycle({ ...opts, on }, E).knock;
  if (!knocks(0)) return 0;
  if (knocks(140)) return null;
  let lo = 0, hi = 140;
  for (let k = 0; k < 18; k++) { const m = (lo + hi) / 2; if (knocks(m)) lo = m; else hi = m; }
  return hi;
}

// Critical compression ratio: the lowest ratio in 2..20 at which a fuel
// knocks under the given conditions (the CFR method raises it until the
// knock meter reads standard knock). null when it never knocks; 3 when
// it knocks even at 2 (below the range of the fit).
export function criticalCR(opts, E = CFR_ENGINE) {
  const knocks = cr => !!cycle({ ...opts, cr }, E).knock;
  if (!knocks(20)) return null;
  if (knocks(2)) return 2;
  let lo = 2, hi = 20;
  for (let k = 0; k < 16; k++) { const m = (lo + hi) / 2; if (knocks(m)) hi = m; else lo = m; }
  return hi;
}

// Knock-limited spark advance: the largest advance in 0..45 with no knock.
export function knockLimitedSpark(opts, E = ENGINE) {
  for (let s = 45; s >= 0; s--) if (!cycle({ ...opts, spark: s }, E).knock) return s;
  return null;
}
