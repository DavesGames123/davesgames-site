// ============================================================================
//  DARK MATTER HALO  ·  model.js — the mass model of the Milky Way
// ----------------------------------------------------------------------------
//  The components and best-fit values of McMillan (2017), "The mass
//  distribution and gravitational potential of the Milky Way", MNRAS 465, 76,
//  arXiv:1608.00971. Equations and tables:
//    bulge ........ eq. 1-2, alpha 1.8, r0 0.075 kpc, rcut 2.1 kpc, q 0.5
//    stellar discs  eq. 3, zd 0.3 and 0.9 kpc (fixed in the paper)
//    gas discs .... eq. 4, Table 1 (HI and H2, each with a central hole)
//    halo ......... eq. 5, gamma 1 (NFW) in the main model
//    best fit ..... Table 3 (Sigma0, Rd, rho0, rh, R0 = 8.21 kpc)
//  The page compares other halo profiles (Einasto, Burkert, cored
//  isothermal) at the same local density. Those are profile families, not
//  fits to the Milky Way; the page labels them so.
//
//  Units: kpc, Msun, km/s. Densities are Msun/kpc^3 inside this module.
//  perPc3() and gev() convert for display.
//
//  How the speeds are found:
//    discs ... the potential of each disc is a sum of thin rings
//              (complete elliptic integral K, from the AGM), over composite
//              Gauss-Legendre panels in R' and z. The panels close in on
//              R' = R, where the ring potential is sharp. v^2 = R dPhi/dR,
//              from a central difference.
//    bulge ... the exact midplane speed of an oblate spheroid of similar
//              shells (Binney & Tremaine, eq. 2.132).
//    halo .... spherical: v^2 = G M(<r) / r.
//
//  DOM-free ES module. It runs in the page, in a worker and in node tests.
//
//  grep -n targets
//    constants ............. "export const G"
//    best fit .............. "export const MCMILLAN17"
//    density laws .......... "export function density"
//    halo families ......... "export const HALO_FAMILIES"
//    enclosed mass ......... "export function haloMass"
//    elliptic integral ..... "function ellipK"
//    disc speed ............ "function discV2"
//    bulge speed ........... "function bulgeV2"
//    rotation curve ........ "export function curve"
//    virial mass ........... "export function virial"
// ============================================================================

export const G = 4.30091e-6;            // kpc (km/s)^2 / Msun
export const GEV_PER_MSUN_PC3 = 37.97;  // 1 Msun/pc^3 in GeV/cm^3
export const perPc3 = rhoKpc => rhoKpc * 1e-9;
export const gev = rhoKpc => rhoKpc * 1e-9 * GEV_PER_MSUN_PC3;

// Table 3 and Table 1 of McMillan (2017). Surface densities in Msun/pc^2
// and rho0 in Msun/pc^3 are converted to per kpc here.
export const MCMILLAN17 = Object.freeze({
  ref: 'McMillan 2017, MNRAS 465, 76 (arXiv:1608.00971), Table 3',
  R0: 8.21, v0: 233.1, H: 70.4,
  bulge: { rho0: 98.4e9, r0: 0.075, rcut: 2.1, alpha: 1.8, q: 0.5 },
  discs: [
    { id: 'thin', label: 'Thin stellar disc', law: 'exp', sigma0: 896e6, Rd: 2.50, zd: 0.3 },
    { id: 'thick', label: 'Thick stellar disc', law: 'exp', sigma0: 183e6, Rd: 3.02, zd: 0.9 },
    { id: 'hi', label: 'Atomic gas (HI)', law: 'gas', sigma0: 53.1e6, Rd: 7, Rm: 4, zd: 0.085 },
    { id: 'h2', label: 'Molecular gas (H2)', law: 'gas', sigma0: 2180e6, Rd: 1.5, Rm: 12, zd: 0.045 },
  ],
  halo: { family: 'nfw', rho0: 0.00854e9, rs: 19.6 },
  derived: { Mb: 9.23e9, Mstar: 5.43e10, Mv: 1.37e12, rhoSun: 0.0101e9 },
});

// ---------------------------------------------------------------- densities

// Surface density of a disc at R (Msun/kpc^2).
export function discSigma(d, R) {
  return d.law === 'gas' ? d.sigma0 * Math.exp(-d.Rm / Math.max(R, 1e-6) - R / d.Rd) : d.sigma0 * Math.exp(-R / d.Rd);
}

// Vertical law of a disc, normalised so that its integral over z is 1.
function discZ(d, z) {
  const a = Math.abs(z);
  if (d.law === 'gas') { const c = Math.cosh(a / (2 * d.zd)); return 1 / (4 * d.zd * c * c); }
  return Math.exp(-a / d.zd) / (2 * d.zd);
}

export function bulgeDensity(b, R, z) {
  const m = Math.hypot(R, z / b.q);
  return b.rho0 / Math.pow(1 + m / b.r0, b.alpha) * Math.exp(-(m / b.rcut) * (m / b.rcut));
}

// The halo families. rho(r, p) uses p.rho0 and p.rs; shape keys are extra.
export const HALO_FAMILIES = Object.freeze({
  nfw: { label: 'NFW (cusp, rho ~ 1/r inside rs)', rho: (r, p) => { const x = r / p.rs; return p.rho0 / (x * (1 + x) * (1 + x)); } },
  einasto: { label: 'Einasto (alpha 0.17)', rho: (r, p) => p.rho0 * Math.exp(-2 / (p.alpha ?? 0.17) * (Math.pow(r / p.rs, p.alpha ?? 0.17) - 1)) },
  burkert: { label: 'Burkert (core)', rho: (r, p) => { const x = r / p.rs; return p.rho0 / ((1 + x) * (1 + x * x)); } },
  isothermal: { label: 'Cored isothermal (rho ~ 1/r^2 outside the core)', rho: (r, p) => { const x = r / p.rs; return p.rho0 / (1 + x * x); } },
});

export function haloDensity(h, r) { return HALO_FAMILIES[h.family].rho(Math.max(r, 1e-6), h); }

// density(model, part, R, z): part = 'bulge' | 'halo' | 'stars' | 'gas' | 'baryons' | a disc id.
export function density(model, part, R, z) {
  const r = Math.hypot(R, z);
  if (part === 'halo') return haloDensity(model.halo, r);
  if (part === 'bulge') return bulgeDensity(model.bulge, R, z);
  let s = 0;
  for (const d of model.discs) {
    const gas = d.law === 'gas';
    if (part === d.id || part === 'baryons' || (part === 'stars' && !gas) || (part === 'gas' && gas)) s += discSigma(d, R) * discZ(d, z);
  }
  if (part === 'baryons' || part === 'stars') s += bulgeDensity(model.bulge, R, z);
  return s;
}

// ------------------------------------------------------------ quadrature

// 8-point Gauss-Legendre on [-1, 1].
const GLX = [-0.9602898564975363, -0.7966664774136267, -0.5255324099163290, -0.1834346424956498,
  0.1834346424956498, 0.5255324099163290, 0.7966664774136267, 0.9602898564975363];
const GLW = [0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.3626837833783620,
  0.3626837833783620, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763];

// Integral of f over the panels between the sorted breakpoints in bp.
function integrate(f, bp) {
  let s = 0;
  for (let i = 0; i + 1 < bp.length; i++) {
    const a = bp[i], b = bp[i + 1];
    if (!(b > a)) continue;
    const h = (b - a) / 2, c = (a + b) / 2;
    let p = 0;
    for (let k = 0; k < 8; k++) p += GLW[k] * f(c + h * GLX[k]);
    s += p * h;
  }
  return s;
}

function breaks(list, lo, hi) {
  return [...new Set(list.filter(v => v >= lo && v <= hi).concat([lo, hi]))].sort((a, b) => a - b);
}

// --------------------------------------------------------------- halo mass

// Mass of the halo inside radius r (Msun). NFW is analytic; the other
// families use quadrature on a log grid.
export function haloMass(h, r) {
  if (r <= 0) return 0;
  if (h.family === 'nfw') { const x = r / h.rs; return 4 * Math.PI * h.rho0 * h.rs ** 3 * (Math.log(1 + x) - x / (1 + x)); }
  const bp = [0];
  for (let v = Math.min(1e-3, r / 10); v < r; v *= 2) bp.push(v);
  return integrate(q => 4 * Math.PI * q * q * haloDensity(h, q), breaks(bp, 0, r));
}

// A halo of another family with the same density at the Sun as model.halo.
export function matchLocal(model, family, rs, extra = {}) {
  const h = { family, rho0: 1, rs, ...extra };
  h.rho0 = haloDensity(model.halo, model.R0) / haloDensity(h, model.R0);
  return h;
}

// ------------------------------------------------------------------ discs

// Complete elliptic integral of the first kind, parameter m = k^2.
function ellipK(m) {
  let a = 1, b = Math.sqrt(Math.max(1 - m, 1e-300));
  for (let i = 0; i < 40 && Math.abs(a - b) > 1e-15 * a; i++) { const t = (a + b) / 2; b = Math.sqrt(a * b); a = t; }
  return Math.PI / (2 * a);
}

// Potential per unit mass at (R, 0) of a ring of radius a at height z.
function ringPhi(R, a, z) {
  const s = (R + a) * (R + a) + z * z;
  return -2 * G * ellipK(4 * a * R / s) / (Math.PI * Math.sqrt(s));
}

const ZB = [0, 0.02, 0.06, 0.2, 0.6, 1.5, 3, 6, 12];
const AB = [0.03, 0.1, 0.3, 1, 3, 10, 30];

// Midplane potential of a disc at R.
function discPhi(d, R) {
  const aMax = R + 25 * d.Rd;
  const near = [];
  for (const f of AB) { near.push(R - f * d.zd, R + f * d.zd); }
  near.push(R - 1, R + 1, R - 3, R + 3, R / 2, 2 * R);
  for (let v = 0.25; v < aMax; v *= 2) near.push(v);
  const ab = breaks(near, 0, aMax), zb = ZB.map(f => f * d.zd);
  return integrate(a => {
    const sig = discSigma(d, a);
    if (sig === 0) return 0;
    return 2 * Math.PI * a * sig * 2 * integrate(z => discZ(d, z) * ringPhi(R, a, z), zb);
  }, ab);
}

// v^2 of a disc at R, from a central difference of the potential.
function discV2(d, R) {
  const h = 1e-3 * Math.max(R, 0.1);
  return R * (discPhi(d, R + h) - discPhi(d, R - h)) / (2 * h);
}

// ------------------------------------------------------------------ bulge

// Midplane v^2 of an oblate spheroid of similar shells (BT08 eq. 2.132).
function bulgeV2(b, R) {
  const e2 = 1 - b.q * b.q;
  const f = m => bulgeDensity(b, m, 0) * m * m / Math.sqrt(R * R - m * m * e2);
  return 4 * Math.PI * G * b.q * integrate(f, breaks([b.r0, 0.3, 1, b.rcut, 4], 0, R));
}

export function bulgeMass(b) {
  return 4 * Math.PI * b.q * integrate(m => bulgeDensity(b, m, 0) * m * m, breaks([b.r0, 0.3, 1, b.rcut, 4, 8], 0, 12));
}

export function discMass(d) {
  return d.law === 'gas' ? integrate(R => 2 * Math.PI * R * discSigma(d, R), breaks([1, 2, 4, 8, 16, 32, 64], 0, 40 * d.Rd + d.Rm))
    : 2 * Math.PI * d.sigma0 * d.Rd * d.Rd;
}

// --------------------------------------------------------- rotation curve

const signedV = v2 => Math.sign(v2) * Math.sqrt(Math.abs(v2));

// curve(model, radii, { discs }) -> { R, v2: { part: Float64Array }, v: { part: Float64Array } }
// Parts: bulge, each disc id, halo, baryons, total. A disc with a hole can
// pull outward inside the hole, so v2 can be negative there; v keeps the
// sign. opts.discs reuses disc v2 arrays from an earlier call (the discs do
// not change when the halo changes, and they are the slow part).
export function curve(model, radii, opts = {}) {
  const n = radii.length, v2 = {};
  v2.bulge = Float64Array.from(radii, R => bulgeV2(model.bulge, R));
  for (const d of model.discs) v2[d.id] = opts.discs?.[d.id] || Float64Array.from(radii, R => discV2(d, R));
  v2.halo = Float64Array.from(radii, R => G * haloMass(model.halo, R) / R);
  v2.baryons = new Float64Array(n); v2.total = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let b = v2.bulge[i];
    for (const d of model.discs) b += v2[d.id][i];
    v2.baryons[i] = b; v2.total[i] = b + v2.halo[i];
  }
  const v = {};
  for (const k in v2) v[k] = Float64Array.from(v2[k], signedV);
  return { R: Float64Array.from(radii), v2, v };
}

// ----------------------------------------------------------- virial mass

export function baryonMass(model) {
  return bulgeMass(model.bulge) + model.discs.reduce((s, d) => s + discMass(d), 0);
}

// The radius where the mean density inside is 200 x critical (H in
// km/s/Mpc), and the mass inside it. withBaryons adds every baryon (all of
// them are well inside rv). The bisection is on log r.
export function virial(model, withBaryons = true) {
  const H = model.H / 1000, rhoc = 3 * H * H / (8 * Math.PI * G);
  const mb = withBaryons ? baryonMass(model) : 0;
  const excess = r => (haloMass(model.halo, r) + mb) / (4 / 3 * Math.PI * r ** 3) - 200 * rhoc;
  let lo = 1, hi = 5000;
  for (let i = 0; i < 80; i++) { const m = Math.sqrt(lo * hi); if (excess(m) > 0) lo = m; else hi = m; }
  return { rv: lo, Mv: haloMass(model.halo, lo) + mb, rhoCrit: rhoc };
}

// Fraction of the mass inside sphere radius r that is dark (spherical
// approximation for the baryons: the mass of each part inside r, by
// integration of its density over the sphere).
export function darkFraction(model, r) {
  const mh = haloMass(model.halo, r);
  const inSphere = part => integrate(q => 4 * Math.PI * q * q * integrate(mu => density(model, part, q * Math.sqrt(1 - mu * mu), q * mu), [0, 0.02, 0.1, 0.3, 1]), breaks([0.1, 0.5, 1, 2, 4, 8, 16, 32, 64], 0, r));
  const mb = inSphere('baryons');
  return { dark: mh, baryons: mb, frac: mh / (mh + mb) };
}
