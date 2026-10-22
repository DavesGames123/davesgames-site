// ============================================================================
//  DARK MATTER HALO  ·  halo.js — page logic on top of model.js (DOM-free)
// ----------------------------------------------------------------------------
//  model.js holds the McMillan (2017) mass model. This module turns the
//  three halo controls of the page (family, scale radius, local density)
//  into a halo, and computes what every plot reads: rotation curves,
//  density grids, enclosed dark fractions and the virial radius.
//
//  SPEED. The disc speeds are the slow part of model.js (about 2 ms per
//  radius for all four discs). makeBase() computes them once on the page
//  grid; curveFor() reuses them through opts.discs. The baryon mass
//  inside each radius is also computed once (baseFractions), because the
//  baryons do not change when the halo changes.
//
//  Units: kpc, Msun, km/s. Local density in GeV/cm^3 at the controls.
//
//  grep -n targets
//    families and names ...... "export const FAMILIES"
//    control -> halo ......... "export function makeHalo"
//    radius grids ............ "export const CURVE_R"
//    disc cache .............. "export function makeBase", "export function baseOnce"
//    curve for a halo ........ "export function curveFor"
//    dark fraction ........... "export function fractionCurve"
//    density grid ............ "export function densityGrid"
//    projected halo .......... "export function haloColumn"
//    summary numbers ......... "export function summary"
//    misfit to points ........ "export function misfit"
//    seeded random ........... "export function rng"
// ============================================================================
import * as M from './model.js';

export const BASE = M.MCMILLAN17;
export const FAMILIES = ['nfw', 'einasto', 'burkert', 'isothermal'];
export const FAMILY_NAME = Object.freeze({ nfw: 'NFW', einasto: 'Einasto', burkert: 'Burkert', isothermal: 'Cored isothermal' });
export const FAMILY_SHAPE = Object.freeze({ nfw: 'cusp, rho ~ 1/r inside rs', einasto: 'shallow cusp, alpha 0.17', burkert: 'flat core', isothermal: 'flat core, rho ~ 1/r^2 outside' });

// The control ranges. The defaults are the McMillan (2017) best fit. The
// local-density default is not rounded (0.3835 GeV/cm^3), so that the
// default halo is the paper's halo; the slider shows it as 0.38.
export const CONTROLS = Object.freeze({
  family: 'nfw',
  rs: { min: 2, max: 50, step: 0.1, def: BASE.halo.rs },
  local: { min: 0.20, max: 0.50, step: 0.01, def: M.gev(M.haloDensity(BASE.halo, BASE.R0)) },
});

const GEV_TO_KPC = 1e9 / M.GEV_PER_MSUN_PC3;   // GeV/cm^3 -> Msun/kpc^3

// A halo of the family with scale radius rs and density localGeV at R0.
export function makeHalo(family, rs, localGeV, R0 = BASE.R0) {
  const h = { family, rho0: 1, rs };
  h.rho0 = localGeV * GEV_TO_KPC / M.haloDensity(h, R0);
  return h;
}
export const withHalo = halo => ({ ...BASE, halo });

// Radius grids. CURVE_R: the rotation curves (fine to 30 kpc, then
// coarser to 100 kpc), with R0 itself on the grid so that the readouts at
// the Sun need no interpolation. FRAC_R: the enclosed fraction, log-spaced.
export const CURVE_R = Object.freeze([
  ...Array.from({ length: 120 }, (_, i) => 0.1 + i * 0.25),
  ...Array.from({ length: 47 }, (_, i) => 30.5 + i * 1.5),
  BASE.R0,
].sort((a, b) => a - b));
export const FRAC_R = Object.freeze(Array.from({ length: 64 }, (_, i) => 0.5 * Math.pow(600, i / 63)));

// The halo-free parts on the grid: disc v2 arrays (the slow part) and the
// baryon curve. Pass the result to curveFor().
export function makeBase(radii = CURVE_R) {
  const c = M.curve({ ...BASE, halo: { family: 'nfw', rho0: 0, rs: 1 } }, radii);
  return { R: c.R, discs: Object.fromEntries(BASE.discs.map(d => [d.id, c.v2[d.id]])), bulge: c.v2.bulge, baryons: c.v2.baryons };
}

// makeBase() on CURVE_R once per load: main.js and saver.js share it.
let shared = null;
export function baseOnce() { return shared || (shared = makeBase()); }

// The full curve for a halo, reusing the disc arrays of base.
export function curveFor(base, halo) {
  return M.curve(withHalo(halo), base.R, { discs: base.discs });
}

// Linear interpolation of a curve array at R.
export function at(R, arr, x) {
  if (x <= R[0]) return arr[0];
  for (let i = 1; i < R.length; i++) if (R[i] >= x) { const t = (x - R[i - 1]) / (R[i] - R[i - 1]); return arr[i - 1] + t * (arr[i] - arr[i - 1]); }
  return arr[R.length - 1];
}

// The baryon mass inside each sphere radius of FRAC_R (spherical sum of
// the axisymmetric densities, as in model.js darkFraction).
export function baseFractions(radii = FRAC_R) {
  return Float64Array.from(radii, r => M.darkFraction(BASE, r).baryons);
}

// Enclosed dark fraction for a halo, from the cached baryon masses.
export function fractionCurve(halo, mb, radii = FRAC_R) {
  return Float64Array.from(radii, (r, i) => { const mh = M.haloMass(halo, r); return mh / (mh + mb[i]); });
}

// log10 density in Msun/pc^3 on an R-z grid. part: 'halo' | 'baryons'.
// Cell centres: R = (i + 0.5) / nx * Rmax, z = zmax * (1 - 2 (j + 0.5) / nz).
export function densityGrid(model, part, nx, nz, Rmax, zmax) {
  const out = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    const z = zmax * (1 - 2 * (j + 0.5) / nz);
    for (let i = 0; i < nx; i++) {
      const R = (i + 0.5) / nx * Rmax, rho = M.perPc3(M.density(model, part, R, z));
      out[j * nx + i] = rho > 0 ? Math.log10(rho) : -12;
    }
  }
  return out;
}

// Surface density of the halo seen face-on at R (Msun/pc^2), out to zmax.
export function haloColumn(halo, R, zmax = 300) {
  let s = 0, z0 = 0;
  for (let z = 0.01; z0 < zmax; z *= 1.15) {
    const z1 = Math.min(z, zmax), zm = (z0 + z1) / 2;
    s += M.haloDensity(halo, Math.hypot(R, zm)) * (z1 - z0);
    z0 = z1;
  }
  return 2 * s * 1e-6;
}

// The numbers the readouts show.
export function summary(base, halo, curve, mb) {
  const R0 = BASE.R0, model = withHalo(halo);
  const v = M.virial(model);
  const mbAt = r => at(FRAC_R, mb, r);
  const fracAt = r => { const mh = M.haloMass(halo, r); return mh / (mh + mbAt(r)); };
  return {
    vSun: at(curve.R, curve.v.total, R0),
    vSunBaryons: at(curve.R, curve.v.baryons, R0),
    vSunHalo: at(curve.R, curve.v.halo, R0),
    localGeV: M.gev(M.haloDensity(halo, R0)),
    m50: M.haloMass(halo, 50),
    fracSun: fracAt(R0), frac50: fracAt(50),
    rv: v.rv, Mv: v.Mv,
  };
}

// Mean and RMS of (model - measured) over a points table, km/s.
export function misfit(curve, rows) {
  let s = 0, s2 = 0;
  for (const p of rows) { const d = at(curve.R, curve.v.total, p.R) - p.v; s += d; s2 += d * d; }
  return { mean: s / rows.length, rms: Math.sqrt(s2 / rows.length) };
}

// Mulberry32: a small seeded random generator, values in [0, 1).
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Star positions for the face-on view, seeded. The radii follow the
// exponential thin disc (scale length from the model); the two-arm
// spiral pattern is illustrative.
export function discStars(n, seed = 7) {
  const r = rng(seed), Rd = BASE.discs[0].Rd, out = [];
  while (out.length < n) {
    const R = -Rd * Math.log(Math.max(1e-9, r() * r()));
    if (R > 22) continue;
    const arm = r() < 0.55;
    let phi = r() * Math.PI * 2;
    if (arm) phi = (r() < 0.5 ? 0 : Math.PI) + Math.log(Math.max(R, 0.5) / 1.5) / Math.tan(0.22) + (r() - 0.5) * 0.5;
    out.push({ R, phi, m: 0.4 + r() * 0.6, gas: r() < 0.12 });
  }
  return out;
}
