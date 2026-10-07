// ============================================================================
//  NUCLEAR BLAST EFFECTS  ·  effects.js — the effects model (no DOM, no THREE)
// ----------------------------------------------------------------------------
//  Public scaling laws for the effects of one nuclear explosion near sea
//  level, from S. Glasstone and P. J. Dolan, "The Effects of Nuclear
//  Weapons", 3rd ed. (US DoD and ERDA, 1977), cited below as G&D with the
//  paragraph, table or figure number. tests.mjs checks each law against the
//  worked examples and tables of G&D and a published summary table.
//
//  UNITS  metres, seconds, kilotons (kt), pascals. psi(), calcm2 and rem
//  appear only where G&D states the value in those units.
//
//  SCALING  Blast distances and times scale as W^(1/3) (G&D 3.60-3.63).
//  A surface burst acts as a free-air burst of 2 W (G&D 3.34).
//
//  SOURCES OF THE FITS
//    blast ....... the DNA 1-kt free-air standard and the DNA air-burst
//                  height-of-burst fit (regular and Mach reflection with a
//                  switching function), arrival time and positive phase
//                  duration, from the Defense Nuclear Agency BLAST program
//                  notes as printed in NRDC, "The U.S. Nuclear War Plan: A
//                  Time for Change" (2001). The equations were read from
//                  their transcription in the MIT-licensed "glasstone"
//                  library (E. Geist); this file is an independent JS
//                  version. tests.mjs checks them against G&D Figs.
//                  3.72-3.77.
//    fireball .... G&D 2.127 (radius at breakaway, maximum = 2x breakaway)
//    thermal ..... G&D 7.85 (t_max, P_max), 7.96 (Q = f W tau / 4 pi D^2),
//                  7.101 (surface burst partition 0.18); burn thresholds
//                  of G&D Fig. 12.65 as summarised in the Nuclear Weapons
//                  FAQ 5.1 (20 kt, 1 Mt, 20 Mt columns)
//    radiation ... initial gamma + neutron dose as K W e^(-D/L) / D^2 with
//                  L growing with yield (hydrodynamic enhancement, G&D 8.33
//                  to 8.36); K and L fitted to G&D Figs. 8.33 / 8.64 as
//                  summarised in the Wikipedia "Effects of nuclear
//                  explosions" table (1 Gy and 10 Gy slant ranges)
//    fallout ..... G&D Table 9.93 (idealised unit-time dose-rate contours,
//                  15 mph), 9.94 (fission fraction), 9.97 (wind factor F),
//                  9.15 (t^-1.2 decay), 2.128 (no local fallout above
//                  180 W^0.4 ft)
//    cloud ....... G&D Table 2.12 (rise of a 1 Mt cloud) and Fig. 2.16
//                  (stabilised height and radius), with the tops seen at
//                  Trinity, Castle Bravo and Tsar Bomba as anchors
//
//  GREP MAP
//    function freeAir1kt ......... DNA free-air overpressure, 1 kt
//    function overpressure ....... peak overpressure on the ground
//    function dynamicPressure .... peak dynamic pressure
//    function arrivalTime ........ shock arrival on the ground
//    function positiveDuration ... overpressure positive phase
//    function friedlander ........ the pressure-time waveform
//    function rangeFor ........... ground range of an overpressure
//    function optimumHeight ...... height that maximises that range
//    function shockRadius ........ free-air shock radius at time t
//    function fireballRadius ..... luminous fireball radius at time t
//    function thermalPower ....... the second thermal pulse
//    function firstPulse ......... the first (1%) pulse
//    function wilsonWindow ....... when a condensation cloud shows
//    function thermalFluence ..... radiant exposure at a slant range
//    function burnThreshold ...... radiant exposure for a burn degree
//    function promptDose ......... initial radiation dose
//    function falloutRate ........ H+1 dose rate at a ground point
//    function cloudTop ........... cloud top height at time t
//    function summary ............ every ring radius for one burst
// ============================================================================

export const P0 = 101325;            // Pa, sea-level ambient pressure
export const PSI = 6894.757;         // Pa per psi
export const C0 = 340.3;             // m/s, sea-level sound speed
export const FT = 0.3048, MI = 1609.344;
export const KT_CAL = 1e12;          // cal per kt (G&D 1.20)
export const psi = pa => pa / PSI;

const cbrt = Math.cbrt, clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;

// ── blast: free air ────────────────────────────────────────────────────────
// DNA 1-kt free-air standard: peak overpressure (Pa) at r metres.
// Checked: G&D 3.72 example, 1 kt at 1,360 ft gives 4.2 psi.
export function freeAir1kt(r) {
  r = Math.max(r, 1);
  const k = r / 445.42;
  return 3.04e11 / r ** 3 + 1.13e9 / r ** 2 + 7.9e6 / (r * Math.sqrt(Math.log(k + 3 * Math.exp(-Math.sqrt(k) / 3))));
}
// free-air arrival time (s) of the shock at r metres from a 1 kt burst
export function freeAirArrival1kt(r) {
  return (r * r * (6.7 + r)) / (7.12e6 + 7.32e4 * r + 340.5 * r * r);
}

// Rankine-Hugoniot terms with a real-air gamma (G&D 3.53-3.55)
function shockGamma(p) {
  const xi = p / P0 + 1, t = 1e-12 * xi ** 6, z = Math.log(xi) - (0.47 * t) / (100 + t);
  return 1.402 - (3.4e-4 * z ** 4) / (1 + 2.22e-5 * z ** 6);
}
function densityRatio(p) {
  const xi = p / P0 + 1, g = shockGamma(p), mu = (g + 1) / (g - 1);
  return (1 + mu * xi) / (5.975 + xi);
}
// peak wind (particle) speed behind a shock of overpressure p (G&D 3.55)
export function windSpeed(p) {
  return p <= 0 ? 0 : C0 * (5 * p / (7 * P0)) / Math.sqrt(1 + 6 * p / (7 * P0));
}
// shock front speed (G&D 3.55.1)
export function shockSpeed(p) { return C0 * Math.sqrt(1 + 6 * Math.max(0, p) / (7 * P0)); }
// normal reflection factor pr / p (G&D 3.56.1: 2 for weak shocks, 8 for strong)
export function reflectionFactor(p) { return 2 * (7 * P0 + 4 * p) / (7 * P0 + p); }

// ── blast: on the ground ────────────────────────────────────────────────────
// x, y: ground range and burst height scaled to 1 kt (m / W^(1/3))
function scaled(r, W, h) { const s = cbrt(W); return { x: Math.max(r / s, 1), y: Math.max(0, h / s) }; }
function switching(x, y) {
  const pf = freeAir1kt(Math.hypot(x, y)), a = Math.atan(y / x);
  const t = 340 / pf ** 0.55, u = 1 / (7782 * pf ** 0.7 + 0.9);
  const w = 1 / (7473 * pf ** 0.5 + 6.6), v = 1 / (647 * pf ** 0.8 + w);
  const merge = Math.atan(1 / (t + u)), width = Math.atan(1 / (t + v));
  const s = clamp((a - merge) / width, -1, 1);
  return 0.5 * (Math.sin(0.5 * Math.PI * s) + 1);
}
// Mach reflection: the twice-yield surface wave, raised by the burst angle
function pMach(x, y) {
  const a = Math.atan(y / x), lx = Math.log(x);
  const c = Math.max(Math.min(3.7 - 0.94 * lx, 0.7), 0.77 * lx - 3.8 - 18 / x);
  return freeAir1kt(x / cbrt(2)) / (1 - c * Math.sin(a));
}
// regular reflection: the free-air wave times a reflection factor
function pReg(x, y) {
  const pf = freeAir1kt(Math.hypot(x, y)), a = Math.atan(y / x);
  const rn = 2 + ((shockGamma(pf) + 1) * (densityRatio(pf) - 1)) / 2;
  const f = pf / 75842, d = (f ** 6 * (1.2 + 0.07 * Math.sqrt(f))) / (f ** 6 + 1);
  return pf * ((rn - 2) * Math.sin(a) ** d + 2);
}
// Peak overpressure (Pa) on the ground at range r (m), yield W (kt),
// burst height h (m). Checked against G&D Figs. 3.73a-c.
export function overpressure(r, W, h = 0) {
  const { x, y } = scaled(r, W, h), s = switching(x, y);
  if (s <= 0) return pMach(x, y);
  if (s >= 1) return pReg(x, y);
  return pReg(x, y) * s + pMach(x, y) * (1 - s);
}
// Peak horizontal dynamic pressure (Pa). G&D Fig. 3.75.
export function dynamicPressure(r, W, h = 0) {
  const { x, y } = scaled(r, W, h), p = overpressure(r, W, h), s = switching(x, y), a = Math.atan(y / x);
  return 0.5 * p * (densityRatio(p) - 1) * (1 - s * Math.sin(a) ** 2);
}
// Scaled range (m, 1 kt) at which the Mach stem forms for a scaled height y.
export function machRange1kt(y) { return y ** 2.5 / 5822 + 2.09 * y ** 0.75; }
export function machStemRange(W, h) { return h <= 0 ? 0 : machRange1kt(h / cbrt(W)) * cbrt(W); }
function slantFactor(x, y) { const xm = machRange1kt(y); return x <= xm ? 1 : 1.26 - 0.26 * (xm / x); }
// Shock arrival time (s) on the ground. G&D Fig. 3.77.
export function arrivalTime(r, W, h = 0) {
  const { x, y } = scaled(r, W, h), v = slantFactor(x, y);
  return freeAirArrival1kt(Math.hypot(x, y) / v) * v * cbrt(W);
}
// Overpressure positive phase duration (s). G&D Fig. 3.76.
export function positiveDuration(r, W, h = 0) {
  const { x, y } = scaled(r, W, h), v = slantFactor(x, y);
  const ta = freeAirArrival1kt(Math.hypot(x, y) / v) * v, t0 = Math.log(1000 * ta) / 3.77;
  const dSurf = (155 * Math.exp(-20.8 * ta) + Math.exp(-t0 * t0 + 4.86 * t0 + 0.25)) / 1000;
  const dUn = dSurf * (1 - (1 - 1 / (1 + 4.5e-8 * y ** 7)) * (0.04 + 0.61 / (1 + ta ** 1.5 / 0.027)));
  return dUn * 1.16 * Math.exp(-Math.abs(y / FT - 156) / 1062) * cbrt(W);
}
// Friedlander waveform: overpressure at time t after the burst, for a point
// reached at ta with peak pk and positive phase dur. b sets the decay; the
// negative phase follows from the same form (G&D 3.57, Fig. 3.57).
export function friedlander(t, ta, dur, pk, b = 1.2) {
  if (t < ta) return 0;
  const u = (t - ta) / dur;
  return pk * (1 - u) * Math.exp(-b * u);
}
// Ground range (m) out to which the overpressure is at least p (Pa). The
// curve is scanned outward in log steps, then the last crossing is bisected.
export function rangeFor(p, W, h = 0) {
  const s = cbrt(W), N = 160, lo = Math.log(1), hi = Math.log(2e5);
  let last = -1;
  for (let i = 0; i <= N; i++) { const r = Math.exp(lo + (hi - lo) * i / N) * s; if (overpressure(r, W, h) >= p) last = i; }
  if (last < 0) return 0;
  if (last === N) return Math.exp(hi) * s;
  let a = Math.exp(lo + (hi - lo) * last / N) * s, b = Math.exp(lo + (hi - lo) * (last + 1) / N) * s;
  for (let k = 0; k < 40; k++) { const m = 0.5 * (a + b); if (overpressure(m, W, h) >= p) a = m; else b = m; }
  return 0.5 * (a + b);
}
// The burst height (m) that gives the largest ground range for p
// (G&D Fig. 3.73c). Coarse scan in scaled height, then golden search.
const optCache = new Map();
export function optimumHeight(p, W) {
  const key = Math.round(p);
  let y = optCache.get(key);
  if (y === undefined) {
    const R = yy => rangeFor(p, 1, yy);
    let best = 0, bestR = R(0);
    for (let yy = 10; yy <= 2400; yy *= 1.12) { const rr = R(yy); if (rr > bestR) { bestR = rr; best = yy; } }
    let a = best / 1.12, b = best * 1.12;
    const g = 0.381966;
    for (let k = 0; k < 28; k++) {
      const c = a + g * (b - a), d = b - g * (b - a);
      if (R(c) > R(d)) b = d; else a = c;
    }
    y = 0.5 * (a + b);
    optCache.set(key, y);
  }
  return y * cbrt(W);
}

// ── shock radius and fireball ──────────────────────────────────────────────
// Free-air shock radius (m) at time t (s): the inverse of the arrival fit.
// For a surface burst the hemispherical wave scales with 2 W (G&D 3.34).
export function shockRadius(t, W, surface = false) {
  const We = surface ? 2 * W : W, s = cbrt(We), ts = t / s;
  if (ts <= 0) return 0;
  let a = 0.01, b = 1e6;
  for (let k = 0; k < 60; k++) { const m = Math.sqrt(a * b); if (freeAirArrival1kt(m) < ts) a = m; else b = m; }
  return Math.sqrt(a * b) * s;
}
// G&D 2.127: radius at breakaway 100 W^0.4 ft (air burst), 145 W^0.4 ft
// (contact surface burst); the maximum is about twice that. Between the
// two, the blast energy reflected into the fireball falls off with height,
// so the coefficient goes from 100 to 145 as the burst comes down.
export function fireballSizes(W, h = 0) {
  const rAir = 2 * 100 * W ** 0.4 * FT;
  const k = clamp(1 - h / rAir, 0, 1);
  const rb = lerp(100, 145, k) * W ** 0.4 * FT;
  return { breakaway: rb, max: 2 * rb, thermalMin: 90 * W ** 0.4 * FT, surface: h < 2 * rb };
}
// G&D 2.125-2.126: the first thermal minimum is at 11 ms for 20 kt and the
// times of fireball events scale as W^0.4. The fireball reaches its
// largest size after about a second for 20 kt (G&D 2.121).
export const tThermalMin = W => 0.011 * (W / 20) ** 0.4;
export const tFireballMax = W => 1.0 * (W / 20) ** 0.4;
// Luminous fireball radius (m) at time t: the shock front until breakaway,
// then a slower growth to the maximum (G&D Fig. 2.121, log-log).
export function fireballRadius(t, W, h = 0) {
  const F = fireballSizes(W, h), rs = shockRadius(t, W, F.surface);
  if (rs < F.breakaway) return rs;
  const tb = arrivalOfRadius(F.breakaway, W, F.surface), tm = Math.max(tb * 2, tFireballMax(W));
  if (t >= tm) return F.max;
  const u = clamp(Math.log(t / tb) / Math.log(tm / tb), 0, 1);
  return F.breakaway + (F.max - F.breakaway) * (1 - (1 - u) ** 2);
}
// time (s) at which the free-air shock reaches radius r
export function arrivalOfRadius(r, W, surface = false) {
  const s = cbrt(surface ? 2 * W : W);
  return freeAirArrival1kt(r / s) * s;
}
// Apparent fireball temperature (K) for the colour of the ball: hot at
// first, a minimum near 3,000 C at the thermal minimum, then 7,700 C at
// the second maximum, then a slow decline (G&D 2.122-2.125, Fig. 2.123).
export function fireballTemperature(t, W) {
  const tmin = tThermalMin(W), tmax = thermalPeakTime(W);
  if (t <= 0) return 0;
  if (t < tmin) return lerp(3300, 9000, clamp(Math.log(tmin / t) / Math.log(1e3), 0, 1) ** 0.6);
  if (t < tmax) return lerp(3300, 7970, clamp(Math.log(t / tmin) / Math.log(tmax / tmin), 0, 1));
  return Math.max(900, 7970 * (t / tmax) ** -0.45);
}

// ── thermal ────────────────────────────────────────────────────────────────
// G&D 7.85: below 15,000 ft, t_max = 0.0417 W^0.44 s, P_max = 3.18 W^0.56 kt/s.
export const thermalPeakTime = W => 0.0417 * W ** 0.44;
export const thermalPeakPower = W => 3.18 * W ** 0.56;
// Scaled pulse P/P_max against x = t/t_max: (1+c) x^a / (c + x^b), c = b/a - 1,
// fitted to G&D Fig. 7.84 (P/P_max = 0.59 and 40% of the energy at x = 1.56,
// about 80% of the energy by x = 10). Peak 1 at x = 1.
const PA = 3.9, PB = 5.75, PC = PB / PA - 1;
export function pulseShape(x) { return x <= 0 ? 0 : (1 + PC) * x ** PA / (PC + x ** PB); }
// cumulative energy fraction by x (numerical, cached on a log grid)
let pulseCum = null;
export function pulseEnergy(x) {
  if (!pulseCum) {
    const N = 600, lo = Math.log(1e-3), hi = Math.log(1e5), xs = [], cs = [];
    let s = 0, px = Math.exp(lo), pf = pulseShape(px);
    for (let i = 1; i <= N; i++) { const xx = Math.exp(lo + (hi - lo) * i / N), f = pulseShape(xx); s += 0.5 * (f + pf) * (xx - px); xs.push(xx); cs.push(s); px = xx; pf = f; }
    pulseCum = { lo, hi, N, cs: cs.map(c => c / s) };
  }
  if (x <= 1e-3) return 0;
  const { lo, hi, N, cs } = pulseCum, u = (Math.log(x) - lo) / (hi - lo) * N - 1;
  if (u >= N - 1) return 1;
  const i = Math.max(0, Math.floor(u)), f = u - i;
  return lerp(cs[i], cs[Math.min(N - 1, i + 1)], f);
}
// thermal power (kt/s) at time t, second pulse only
export function thermalPower(t, W) { return thermalPeakPower(W) * pulseShape(t / thermalPeakTime(W)); }
// First pulse (G&D 2.39, 7.03): short and ultraviolet, it ends at the first
// thermal minimum and carries about 1% of the thermal energy. Shape: a
// linear rise to 0.8 P_max at t_min / 4, then an exponential fall; its area
// is 0.35 P_max t_min, which gives 0.9% of the energy for 20 kt.
export function firstPulse(t, W) {
  const u = t / tThermalMin(W), pk = 0.8 * thermalPeakPower(W);
  if (u <= 0) return 0;
  return u < 0.25 ? pk * u / 0.25 : pk * Math.exp(-(u - 0.25) * 3.2);
}
export const thermalPowerTotal = (t, W) => thermalPower(t, W) + firstPulse(t, W);
// Wilson (condensation) cloud in humid air (G&D 2.48-2.50): at Bikini
// (about 23 kt) it formed 1 to 2 s after the burst, a dome that became a
// ring and was gone a second or so later. Times scale as W^(1/3).
export function wilsonWindow(W) { const k = cbrt(W / 23); return { t0: 1.2 * k, life: 1.5 * k }; }
// Thermal partition f: 0.35 for an air burst (G&D 7.04, Table 7.88), 0.18
// for a contact surface burst (G&D 7.101). Between, a linear blend in burst
// height over the maximum fireball radius (a reading of Table 7.101).
export function thermalPartition(W, h) {
  const R = fireballSizes(W, 0).max;
  return 0.18 + 0.17 * clamp(h / R, 0, 1);
}
// Atmospheric transmittance for a slant range D (m) and visibility V (km):
// tau = e^(-D / 1.5 V). The length 1.5 V (30 km on a clear 20 km day) is
// fitted to the nine burn ranges of the Nuclear Weapons FAQ 5.1 (20 kt,
// 1 Mt, 20 Mt; worst error 15%, tests.mjs). Scattered light, which G&D
// Fig. 7.98 adds back at long range, is left out. See G&D 7.12.
export function transmittance(D, V = 20) { return Math.exp(-D / (1500 * V)); }
// Radiant exposure (cal/cm^2) at slant range D (m). G&D 7.96.
export function thermalFluence(D, W, h = 0, V = 20) {
  const Dcm = Math.max(D, 1) * 100;
  return thermalPartition(W, h) * W * KT_CAL * transmittance(D, V) / (4 * Math.PI * Dcm * Dcm);
}
// Radiant exposure (cal/cm^2) for a 50% chance of a burn of degree 1-3,
// interpolated in log yield (G&D Fig. 12.65). Longer pulses need more energy.
const BURN = { W: [20, 1000, 20000], q: [[2.5, 3.2, 5], [5, 6, 8.5], [8, 10, 12]] };
export function burnThreshold(degree, W) {
  const q = BURN.q[degree - 1], lw = Math.log(clamp(W, 0.01, 1e6)), L = BURN.W.map(Math.log);
  let i = lw < L[1] ? 0 : 1;
  const t = (lw - L[i]) / (L[i + 1] - L[i]);
  return Math.exp(lerp(Math.log(q[i]), Math.log(q[i + 1]), t));
}
// Ground range (m) at which the radiant exposure equals q (cal/cm^2).
export function thermalRange(q, W, h = 0, V = 20) {
  let a = 1, b = 5e6;
  if (thermalFluence(Math.hypot(a, h), W, h, V) < q) return 0;
  for (let k = 0; k < 80; k++) { const m = Math.sqrt(a * b); if (thermalFluence(Math.hypot(m, h), W, h, V) >= q) a = m; else b = m; }
  return Math.sqrt(a * b);
}

// ── initial radiation ──────────────────────────────────────────────────────
// Dose (rem, gamma + neutron, taken as rad for the sum) at slant range D (m).
// The e-folding length L grows with yield: the hot, thin air behind the
// shock lets the fission-product gamma rays through (G&D 8.36).
// K (rad km^2 / kt), L0 (km) and p fitted to the 1 Gy and 10 Gy slant ranges
// of 1 kt, 20 kt, 1 Mt and 20 Mt (worst error 17%, tests.mjs).
export const RAD = { K: 1.284e5, L0: 0.155, p: 0.085 };
export function promptDose(D, W) {
  const Dk = Math.max(D, 10) / 1000, L = RAD.L0 * W ** RAD.p;
  return RAD.K * W * Math.exp(-Dk / L) / (Dk * Dk);
}
// slant range (m) at which the prompt dose equals d (rem)
export function promptSlant(d, W) {
  let a = 10, b = 2e5;
  for (let k = 0; k < 80; k++) { const m = Math.sqrt(a * b); if (promptDose(m, W) >= d) a = m; else b = m; }
  return Math.sqrt(a * b);
}
export function promptRange(d, W, h = 0) { const s = promptSlant(d, W); return s > h ? Math.sqrt(s * s - h * h) : 0; }

// ── fallout ────────────────────────────────────────────────────────────────
// G&D Table 9.93, contact surface burst, 15 mph effective wind: per H+1
// dose rate (rad/hr), downwind distance, maximum width and ground-zero
// width in statute miles, each as c W^e (W in kt).
export const FALLOUT = [
  { rate: 3000, d: [0.95, 0.45], w: [0.0076, 0.86], g: [0.026, 0.58] },
  { rate: 1000, d: [1.8, 0.45], w: [0.036, 0.76], g: [0.060, 0.57] },
  { rate: 300, d: [4.5, 0.45], w: [0.13, 0.66], g: [0.20, 0.48] },
  { rate: 100, d: [8.9, 0.45], w: [0.38, 0.60], g: [0.39, 0.42] },
  { rate: 30, d: [16, 0.45], w: [0.76, 0.56], g: [0.53, 0.41] },
  { rate: 10, d: [24, 0.45], w: [1.4, 0.53], g: [0.68, 0.41] },
  { rate: 3, d: [30, 0.45], w: [2.2, 0.50], g: [0.89, 0.41] },
  { rate: 1, d: [40, 0.45], w: [3.3, 0.48], g: [1.5, 0.41] },
];
// G&D 9.97: downwind distances times F for an effective wind of v mph
export function windFactor(vmph) { return vmph >= 15 ? 1 + (vmph - 15) / 60 : 1 + (vmph - 15) / 30; }
// G&D 2.128: little local fallout above H = 180 W^0.4 ft
export const falloutCeiling = W => 180 * W ** 0.4 * FT;
// Share of the contact-burst fallout for a burst at height h: 1 on the
// ground, 0 at the ceiling. The taper between is a display choice, not G&D.
export const falloutShare = (W, h) => clamp(1 - h / falloutCeiling(W), 0, 1) ** 2;
// One contour (metres): downwind length, half of the max width, half of the
// ground-zero width, for a level between the table rows (log interpolation).
export function falloutContour(level, W, vms) {
  const F = windFactor(vms / 0.44704), lr = Math.log(level), T = FALLOUT;
  let i = 0;
  while (i < T.length - 2 && lr < Math.log(T[i + 1].rate)) i++;
  const t = (lr - Math.log(T[i].rate)) / (Math.log(T[i + 1].rate) - Math.log(T[i].rate));
  const v = k => Math.exp(lerp(Math.log(T[i][k][0] * W ** T[i][k][1]), Math.log(T[i + 1][k][0] * W ** T[i + 1][k][1]), t)) * MI;
  return { d: v('d') * F, w: v('w') / 2, g: v('g') / 2 };
}
// Is ground point (x downwind, y crosswind, metres from ground zero) inside
// the contour C? Upwind: a half-circle of radius g (G&D 9.93). Downwind:
// the half-width grows from g at ground zero to w at 0.35 d, then the
// contour closes as a half-ellipse at d (the cigar of G&D Fig. 9.93).
export function inContour(x, y, C) {
  if (x <= 0) return x * x + y * y <= C.g * C.g;
  if (x >= C.d) return false;
  const u = x / C.d;
  let hw;
  if (u < 0.35) { const s = u / 0.35; hw = C.g + (C.w - C.g) * s * s * (3 - 2 * s); }
  else { const v = (u - 0.35) / 0.65; hw = C.w * Math.sqrt(Math.max(0, 1 - v * v)); }
  return Math.abs(y) <= hw;
}
// H+1 reference dose rate (rad/hr) at a ground point; x along the wind.
// Bisection on the level whose contour passes through the point.
export function falloutRate(x, y, W, vms, fission = 1, h = 0) {
  const share = falloutShare(W, h);
  if (share <= 0) return 0;
  const out = FALLOUT[FALLOUT.length - 1].rate, top = FALLOUT[0].rate * 3;
  if (!inContour(x, y, falloutContour(out, W, vms))) return 0;
  let a = Math.log(out), b = Math.log(top);
  if (inContour(x, y, falloutContour(top, W, vms))) return top * fission * share;
  for (let k = 0; k < 30; k++) { const m = 0.5 * (a + b); if (inContour(x, y, falloutContour(Math.exp(m), W, vms))) a = m; else b = m; }
  return Math.exp(0.5 * (a + b)) * fission * share;
}
// H+1 rate along the downwind line at x metres (log-log through the table)
export function falloutCentreline(x, W, vms, fission = 1, h = 0) { return falloutRate(x, 0, W, vms, fission, h); }
// G&D 9.15: R(t) = R1 t^-1.2 (t in hours); dose from ta to tb (hours)
export const doseRateAt = (R1, th) => R1 * Math.pow(Math.max(th, 1 / 60), -1.2);
export const falloutDose = (R1, ta, tb) => 5 * R1 * (Math.pow(ta, -0.2) - Math.pow(tb, -0.2));
// Arrival (hours) of the fallout at x metres downwind: the cloud edge moves
// with the wind (G&D 9.98 example: subtract the cloud radius).
export function falloutArrival(x, W, vms) { return Math.max(Math.max(x - cloudRadius(W), 0) / vms / 3600, 0.1); }

// ── cloud ──────────────────────────────────────────────────────────────────
// Stabilised cloud top (m) against yield: a smooth log-log curve through
// G&D Fig. 2.16 / 9.96 values and observed tops. The flat part from 20 to
// 100 kt is the tropopause (G&D 2.16).
const TOPS = [[0.01, 1200], [0.1, 2600], [1, 5500], [10, 9500], [20, 11500], [100, 14000], [1000, 20500], [10000, 37000], [15000, 40000], [50000, 64000], [1e5, 75000]];
export function cloudTopFinal(W) {
  const lw = Math.log(clamp(W, TOPS[0][0], TOPS[TOPS.length - 1][0]));
  let i = 0; while (i < TOPS.length - 2 && lw > Math.log(TOPS[i + 1][0])) i++;
  const t = (lw - Math.log(TOPS[i][0])) / (Math.log(TOPS[i + 1][0]) - Math.log(TOPS[i][0]));
  return Math.exp(lerp(Math.log(TOPS[i][1]), Math.log(TOPS[i + 1][1]), t));
}
// cloud bottom about 0.6 of the top (G&D Fig. 9.96)
export const cloudBottomFinal = W => 0.6 * cloudTopFinal(W);
// stabilised cloud radius (m): 21 miles for 10 Mt (G&D 9.98), as W^0.4
export const cloudRadius = W => 21 * MI * (W / 1e4) ** 0.4;
// Rise of the cloud top above the burst (m) at time t (s): a stretched
// exponential fitted to G&D Table 2.12 (1 Mt: 2, 4, 6, 10, 12 miles at
// 0.3, 0.7, 1.1, 2.5, 3.8 min); the time constant grows slowly with yield.
export const cloudTau = W => 96 * (W / 1000) ** 0.12;
export function cloudTop(t, W, h = 0) {
  const H = cloudTopFinal(W) - (W > 15 ? h : 0);   // G&D 2.16: small yields are above the burst point
  return Math.max(0, H * (1 - Math.exp(-((Math.max(t, 0) / cloudTau(W)) ** 1.07))));
}

// ── one burst: all the rings ───────────────────────────────────────────────
// W kt, h m, opts { vis km, wind m/s, fission share }.
export function summary(W, h, o = {}) {
  const V = o.vis ?? 20;
  const F = fireballSizes(W, h);
  return {
    W, h,
    fireball: F.max,
    fireballGround: h < F.max ? Math.sqrt(F.max * F.max - h * h) : 0,
    psi20: rangeFor(20 * PSI, W, h), psi5: rangeFor(5 * PSI, W, h), psi1: rangeFor(1 * PSI, W, h),
    burn3: thermalRange(burnThreshold(3, W), W, h, V), burn1: thermalRange(burnThreshold(1, W), W, h, V),
    rem500: promptRange(500, W, h),
    mach: machStemRange(W, h),
    fallout: falloutShare(W, h) > 0,
    cloudTop: cloudTopFinal(W), cloudRadius: cloudRadius(W),
  };
}
