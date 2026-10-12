// ============================================================================
//  ANTENNA FIELDS  ·  geom.js — the geometry of radiation, from em.js fields
// ----------------------------------------------------------------------------
//  DOM-free ES module. main.js, overlay.js, scene3d.js, the saver and
//  tests.mjs import it. Lengths are in wavelengths (k = 2 pi). A field point
//  uses the wire nodes of em.js when the antenna has them (exact), else the
//  element sum.
//
//  FLUX THROUGH A SPHERE. With phasors E and H, the instantaneous flux of
//  S = E x H through a sphere of radius r is
//      P(t) = P + Re{ Q e^{2 j w t} }
//      P    = closed integral of 1/2 Re{E x H*} . n dA      (the radiated power)
//      Q    = closed integral of 1/2 (E x H) . n dA
//  P is the same for every r: div <S> = 0 in empty space, so the divergence
//  theorem gives the same flux through any two spheres. |Q| is large near
//  the antenna, where the stored energy flows out and back each half
//  cycle, so P(t) goes below zero there. Far away |Q| = P and P(t) >= 0.
//
//  OBSERVER. At one point: E and H, the phase gap between them (the angle of
//  the complex Poynting vector 1/2 E x H* along r), and the real amplitudes
//  along their main directions. Near the antenna the gap goes to -90 deg (E
//  lags B); far away it goes to 0 (in phase). hertzGap(kr) is the closed form
//  for a Hertzian dipole, the curve the page draws.
//
//  ENERGY VELOCITY. v = S/u with u = (eps E^2 + mu H^2)/2. In units of c:
//      v/c = 2 E x (eta H) / (E^2 + (eta H)^2),  |v| <= c
//  The flow particles move at this velocity.
//
//  PHASOR SUM. The far field toward s is a sum over the current:
//      F(s) = sum m_i u_i e^{jk s.r_i}
//  phasorTerms() groups the terms by wire (or by pieces of one wire), takes
//  the part across s, and projects it on the polarisation. The terms are the
//  arrows the page draws head to tail; the length of the sum squared, times
//  eta k^2/(32 pi^2), is the radiation intensity U(s).
//
//  EXPORTS   (grep -n "export function <name>")
//    fieldPoint ...... E, H at one point (12 numbers), nodes or elements
//    sphereFlux ...... P, Q and the reactive power through a sphere
//    fluxAt .......... P(t) from sphereFlux and the phase w t
//    observer ........ E, H, gap, amplitudes and the zone at one point
//    hertzGap ........ closed-form E-H phase gap of a Hertzian dipole (deg)
//    energyVelocity .. v/c from the instantaneous E and H
//    phasorTerms ..... the far-field phasors toward one direction
//    patternGrid ..... U on a theta x phi grid (the 3D pattern mesh)
//    zoneRadii ....... the reactive near-field and far-field radii
// ============================================================================
import { fieldAt, fieldAtNodes, gaussLegendre, ETA, K } from './em.js';

const UK = ETA * K * K / (32 * Math.PI * Math.PI);
const o18 = new Float64Array(18);

// E and H (re, im per axis) at p, into out (12 numbers).
export function fieldPoint(A, px, py, pz, out = new Float64Array(12)) {
  if (A.nodes) return fieldAtNodes(A.nodes, px, py, pz, out);
  fieldAt(A.elems, px, py, pz, o18);
  for (let i = 0; i < 12; i++) out[i] = o18[i];
  return out;
}

// 1/2 E x H* (conj) and 1/2 E x H (no conj), dotted with n. f: 12 numbers.
function poyntingDots(f, n) {
  const Er = [f[0], f[2], f[4]], Ei = [f[1], f[3], f[5]], Hr = [f[6], f[8], f[10]], Hi = [f[7], f[9], f[11]];
  const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  // E x H* = (Er + jEi) x (Hr - jHi) = Er x Hr + Ei x Hi + j (Ei x Hr - Er x Hi)
  const rrH = cr(Er, Hr), iiH = cr(Ei, Hi), irH = cr(Ei, Hr), riH = cr(Er, Hi);
  const cRe = 0.5 * (dot(rrH, n) + dot(iiH, n)), cIm = 0.5 * (dot(irH, n) - dot(riH, n));
  // E x H = Er x Hr - Ei x Hi + j (Er x Hi + Ei x Hr)
  const qRe = 0.5 * (dot(rrH, n) - dot(iiH, n)), qIm = 0.5 * (dot(riH, n) + dot(irH, n));
  return [cRe, cIm, qRe, qIm];
}

// Flux through the sphere of radius r around c (Gauss-Legendre in cos theta).
// Returns { r, P, Qr (reactive: Im of the complex power), Q: [re, im] }.
export function sphereFlux(A, c, r, nt = 32, np = 64) {
  const g = gaussLegendre(nt), f = new Float64Array(12);
  let P = 0, Qr = 0, qr = 0, qi = 0;
  for (let i = 0; i < nt; i++) {
    const ct = g.x[i], st = Math.sqrt(Math.max(0, 1 - ct * ct));
    for (let j = 0; j < np; j++) {
      const ph = 2 * Math.PI * (j + 0.5) / np, n = [st * Math.cos(ph), st * Math.sin(ph), ct];
      fieldPoint(A, c[0] + r * n[0], c[1] + r * n[1], c[2] + r * n[2], f);
      const d = poyntingDots(f, n), w = g.w[i] * (2 * Math.PI / np) * r * r;
      P += d[0] * w; Qr += d[1] * w; qr += d[2] * w; qi += d[3] * w;
    }
  }
  return { r, P, Qr, Q: [qr, qi] };
}
// Instantaneous flux P(t) at the display phase wt (field = Re{F e^{j wt}}).
export function fluxAt(sf, wt) {
  const c = Math.cos(2 * wt), s = Math.sin(2 * wt);
  return sf.P + sf.Q[0] * c - sf.Q[1] * s;
}

// Main real direction of a complex 3-vector (re, im): the major axis of its
// ellipse. Returns { v: unit vector, a: complex amplitude along v }.
function major(re, im) {
  const rr = re[0] ** 2 + re[1] ** 2 + re[2] ** 2, ii = im[0] ** 2 + im[1] ** 2 + im[2] ** 2, ri = re[0] * im[0] + re[1] * im[1] + re[2] * im[2];
  const th = 0.5 * Math.atan2(2 * ri, rr - ii);
  let v = [0, 1, 2].map(k => re[k] * Math.cos(th) + im[k] * Math.sin(th));
  const n = Math.hypot(v[0], v[1], v[2]);
  if (n < 1e-30) return { v: [0, 0, 0], a: [0, 0] };
  v = v.map(q => q / n);
  return { v, a: [v[0] * re[0] + v[1] * re[1] + v[2] * re[2], v[0] * im[0] + v[1] * im[1] + v[2] * im[2]] };
}

// The observer at p, around the antenna centre c.
// Returns { dist, kr, rhat, E: {v, a}, H: {v, a}, gap (deg, E minus H),
//   Sr (time-average radial flux density, W per square wavelength), f (12) }.
// The signs of the E and H directions are set so that E x H points out.
export function observer(A, c, p) {
  const f = fieldPoint(A, p[0], p[1], p[2]);
  const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], dist = Math.hypot(d[0], d[1], d[2]) || 1e-9;
  const rhat = d.map(q => q / dist);
  const E = major([f[0], f[2], f[4]], [f[1], f[3], f[5]]), H = major([f[6], f[8], f[10]], [f[7], f[9], f[11]]);
  const x = [E.v[1] * H.v[2] - E.v[2] * H.v[1], E.v[2] * H.v[0] - E.v[0] * H.v[2], E.v[0] * H.v[1] - E.v[1] * H.v[0]];
  if (x[0] * rhat[0] + x[1] * rhat[1] + x[2] * rhat[2] < 0) { H.v = H.v.map(q => -q); H.a = [-H.a[0], -H.a[1]]; }
  const pd = poyntingDots(f, rhat);
  const gap = Math.atan2(pd[1], pd[0]) * 180 / Math.PI;
  return { dist, kr: K * dist, rhat, E, H, gap, Sr: pd[0], f };
}

// Closed-form E_theta / H_phi phase gap of a Hertzian dipole, degrees.
// E_theta ~ j(1 + 1/(jkr) - 1/(kr)^2), H_phi ~ j(1 + 1/(jkr)).
export function hertzGap(kr) {
  const a = [1 - 1 / (kr * kr), -1 / kr], b = [1, -1 / kr];
  return (Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0])) * 180 / Math.PI;
}

// v/c from the instantaneous real E (V per wavelength) and H (A per
// wavelength), as 3-vectors. Returns [vx, vy, vz]; zero where the field is zero.
export function energyVelocity(E, H, out = [0, 0, 0]) {
  const h = [ETA * H[0], ETA * H[1], ETA * H[2]];
  const u = E[0] * E[0] + E[1] * E[1] + E[2] * E[2] + h[0] * h[0] + h[1] * h[1] + h[2] * h[2];
  if (!(u > 0)) { out[0] = out[1] = out[2] = 0; return out; }
  out[0] = 2 * (E[1] * h[2] - E[2] * h[1]) / u;
  out[1] = 2 * (E[2] * h[0] - E[0] * h[2]) / u;
  out[2] = 2 * (E[0] * h[1] - E[1] * h[0]) / u;
  return out;
}

// Far-field phasors toward the unit direction s. One term per wire, or,
// for an antenna with one wire, `pieces` terms along it. Returns
// { terms: [[re, im]..], sum: [re, im], U, pol: unit vector, mags (sum of
// the term lengths), scale: sqrt(UK) }. U = UK |sum|^2 for a linear
// polarisation, which all the z-wire antennas have.
export function phasorTerms(A, s, pieces = 12) {
  const L = A.elems, D = L.d;
  let groups = A.wires.map(w => [w.e0, w.e1]);
  if (groups.length === 1) {
    const [a, b] = groups[0], n = Math.max(1, Math.min(pieces, b - a));
    groups = [];
    for (let i = 0; i < n; i++) groups.push([a + Math.round((b - a) * i / n), a + Math.round((b - a) * (i + 1) / n)]);
  }
  const F = groups.map(([a, b]) => {
    const f = [0, 0, 0, 0, 0, 0];
    for (let i = a; i < b; i++) {
      const o = i * 8, ph = K * (s[0] * D[o] + s[1] * D[o + 1] + s[2] * D[o + 2]);
      const c = Math.cos(ph), sn = Math.sin(ph), mr = D[o + 6] * c - D[o + 7] * sn, mi = D[o + 6] * sn + D[o + 7] * c;
      for (let k = 0; k < 3; k++) { f[2 * k] += mr * D[o + 3 + k]; f[2 * k + 1] += mi * D[o + 3 + k]; }
    }
    // the part across s
    const dr = f[0] * s[0] + f[2] * s[1] + f[4] * s[2], di = f[1] * s[0] + f[3] * s[1] + f[5] * s[2];
    for (let k = 0; k < 3; k++) { f[2 * k] -= dr * s[k]; f[2 * k + 1] -= di * s[k]; }
    return f;
  });
  const tot = [0, 0, 0, 0, 0, 0];
  for (const f of F) for (let k = 0; k < 6; k++) tot[k] += f[k];
  const M = major([tot[0], tot[2], tot[4]], [tot[1], tot[3], tot[5]]);
  let pol = M.v;
  if (!(Math.hypot(pol[0], pol[1], pol[2]) > 0)) {
    // a null: take the polarisation of the largest term
    let best = null, bm = -1;
    for (const f of F) { const m = major([f[0], f[2], f[4]], [f[1], f[3], f[5]]); const a = Math.hypot(m.a[0], m.a[1]); if (a > bm) { bm = a; best = m.v; } }
    pol = best || [0, 0, 1];
  }
  const sc = Math.sqrt(UK);
  const terms = F.map(f => [sc * (f[0] * pol[0] + f[2] * pol[1] + f[4] * pol[2]), sc * (f[1] * pol[0] + f[3] * pol[1] + f[5] * pol[2])]);
  const sum = terms.reduce((a, t) => [a[0] + t[0], a[1] + t[1]], [0, 0]);
  const mags = terms.reduce((a, t) => a + Math.hypot(t[0], t[1]), 0);
  return { terms, sum, U: sum[0] * sum[0] + sum[1] * sum[1], pol, mags, scale: sc };
}

// U(theta, phi) on (nt + 1) x (np + 1) samples, theta in [0, pi], phi in
// [0, 2 pi] (the seam repeats). farU: (sx, sy, sz) -> U. Returns
// { U: Float32Array, nt, np, Umax }.
export function patternGrid(farU, nt = 72, np = 144) {
  const U = new Float32Array((nt + 1) * (np + 1));
  let Umax = 0;
  for (let i = 0; i <= nt; i++) {
    const th = Math.PI * i / nt, st = Math.sin(th), ct = Math.cos(th);
    for (let j = 0; j <= np; j++) {
      const ph = 2 * Math.PI * j / np;
      const u = j === np ? U[i * (np + 1)] : farU(st * Math.cos(ph), st * Math.sin(ph), ct);
      U[i * (np + 1) + j] = u;
      if (u > Umax) Umax = u;
    }
  }
  return { U, nt, np, Umax };
}

// Reactive near field inside max(lambda/2pi, 0.62 sqrt(D^3/lambda)); far field
// beyond max(2 D^2/lambda, 2D, lambda). D: the largest size, in wavelengths.
export function zoneRadii(D) {
  return { rNear: Math.max(1 / (2 * Math.PI), 0.62 * Math.sqrt(D * D * D)), rFar: Math.max(2 * D * D, 2 * D, 1) };
}
