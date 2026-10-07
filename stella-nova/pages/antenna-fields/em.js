// ============================================================================
//  ANTENNA FIELDS  ·  em.js — the field model and the moment-method solvers
// ----------------------------------------------------------------------------
//  DOM-free ES module. main.js, the saver and tests.mjs import it. All
//  lengths are in wavelengths (lambda = 1, so k = 2 pi). Fields are phasors:
//  the field at time t is Re{F e^{j w t}}. Currents are in amperes, E in V per
//  unit length, H in A per unit length.
//
//  FIELD MODEL. An antenna is a list of current elements (Hertzian dipoles).
//  Each element has a position, a unit direction u and a complex moment
//  m = I dl. fieldAt() sums the exact element fields, with the near, the
//  intermediate and the far terms:
//      E = (u.R)(Bc + A) R - A u      H = C (u x R)      (R: unit vector)
//      A  = j eta k m/(4 pi R) (1 - j/kR - 1/(kR)^2) e^{-jkR}
//      Bc = eta m/(2 pi R^2) (1 - j/kR) e^{-jkR}
//      C  = j k m/(4 pi R) (1 - j/kR) e^{-jkR}
//  The GPU shader in field-gl.js has the same sum.
//
//  CURRENTS.
//    Straight parallel wires (dipoles, Yagi-Uda): Galerkin moment method with
//    piecewise-sinusoidal (PWS) bases and the reduced (thin-wire) kernel
//    R = sqrt((z - z')^2 + c^2), c = sqrt(rho^2 + a^2). The field of one PWS
//    basis is closed form (three point terms), so Z_mn is one smooth integral.
//    The substitution z - z' = c sinh t removes the 1/R peak.
//    Sinusoidal dipole: the same integral with one basis over the whole wire
//    (the induced-EMF method). L = lambda/2 gives 73.1 + j42.5 ohm.
//    Circular loop: Fourier-mode moment method. The loop is symmetric under
//    rotation, so each mode e^{jn phi} is solved alone (a diagonal system).
//
//  PATTERN. farIntensity() gives U(theta, phi) in W/sr from the element sum.
//  patternStats() integrates U over the sphere (Gauss-Legendre in cos theta)
//  for the radiated power, the directivity, the beamwidths and front/back.
//
//  EXPORTS   (grep -n "export function <name>")
//    fieldAt ............ E, H and A/mu at one point (complex, 18 numbers)
//    farIntensity ....... radiation intensity U in one direction
//    patternStats ....... P_rad, D, max direction, HPBW, F/B
//    patternCut ......... U along a great circle (the pattern cut)
//    solveWires ......... PWS Galerkin MoM for parallel z-directed wires
//    dipoleZsin ......... induced-EMF impedance of a sinusoidal dipole
//    mutualZsin ......... induced-EMF mutual impedance, parallel dipoles
//    solveLoop .......... Fourier-mode MoM for a circular loop
//    buildAntenna ....... a page state -> elements, wires and numbers
//    hertzClosed ........ the textbook spherical fields (tests only)
//    pwsField ........... the closed-form field of a sinusoidal dipole
// ============================================================================

export const ETA = 376.730313668;
export const K = 2 * Math.PI;
export const STRIDE = 8;     // x y z  ux uy uz  m.re m.im
const FOUR_PI = 4 * Math.PI;

// ── element list ────────────────────────────────────────────────────────────
export function elemList(cap) { return { n: 0, d: new Float64Array(cap * STRIDE) }; }
function pushElem(L, x, y, z, ux, uy, uz, mr, mi) {
  if ((L.n + 1) * STRIDE > L.d.length) { const d = new Float64Array(L.d.length * 2 + STRIDE * 16); d.set(L.d); L.d = d; }
  const o = L.n * STRIDE;
  L.d[o] = x; L.d[o + 1] = y; L.d[o + 2] = z; L.d[o + 3] = ux; L.d[o + 4] = uy; L.d[o + 5] = uz; L.d[o + 6] = mr; L.d[o + 7] = mi;
  L.n++;
}

// ── near and far field of an element list ───────────────────────────────────
// out: Float64Array(18) = E (x re, x im, y re, y im, z re, z im), H (6), A/mu (6).
export function fieldAt(L, px, py, pz, out) {
  out.fill(0);
  const D = L.d;
  for (let i = 0; i < L.n; i++) {
    const o = i * STRIDE;
    const dx = px - D[o], dy = py - D[o + 1], dz = pz - D[o + 2];
    const R = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (R < 1e-9) continue;
    const rx = dx / R, ry = dy / R, rz = dz / R;
    const ux = D[o + 3], uy = D[o + 4], uz = D[o + 5], mr = D[o + 6], mi = D[o + 7];
    const x = K * R, ix = 1 / x, c = Math.cos(x), s = -Math.sin(x);
    const er = mr * c - mi * s, ei = mr * s + mi * c;          // m e^{-jkR}
    const kr = K / (FOUR_PI * R);
    const pi2 = 1 - ix * ix;
    const Ar = ETA * kr * (ix * er - pi2 * ei), Ai = ETA * kr * (ix * ei + pi2 * er);
    const bq = 2 * ETA * kr * ix;
    const Br = bq * (er + ix * ei), Bi = bq * (ei - ix * er);
    const Cr = kr * (ix * er - ei), Ci = kr * (ix * ei + er);
    const ud = ux * rx + uy * ry + uz * rz;
    const Sr = (Br + Ar) * ud, Si = (Bi + Ai) * ud;
    out[0] += Sr * rx - Ar * ux; out[1] += Si * rx - Ai * ux;
    out[2] += Sr * ry - Ar * uy; out[3] += Si * ry - Ai * uy;
    out[4] += Sr * rz - Ar * uz; out[5] += Si * rz - Ai * uz;
    const cx = uy * rz - uz * ry, cy = uz * rx - ux * rz, cz = ux * ry - uy * rx;
    out[6] += Cr * cx; out[7] += Ci * cx; out[8] += Cr * cy; out[9] += Ci * cy; out[10] += Cr * cz; out[11] += Ci * cz;
    const ia = 1 / (FOUR_PI * R);
    out[12] += er * ia * ux; out[13] += ei * ia * ux; out[14] += er * ia * uy; out[15] += ei * ia * uy; out[16] += er * ia * uz; out[17] += ei * ia * uz;
  }
  return out;
}

// Textbook spherical fields of a z-directed Hertzian dipole I dl at the origin
// (Balanis eq. 4-26 a-c with H_phi from 4-10a). Returns {Er, Eth, Hph} as [re, im].
export function hertzClosed(Idl, r, th) {
  const kr = K * r, e = [Math.cos(kr), -Math.sin(kr)];
  const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
  const Er = mul([ETA * Idl * Math.cos(th) / (2 * Math.PI * r * r), 0], mul([1, -1 / kr], e));
  const Eth = mul([0, ETA * K * Idl * Math.sin(th) / (FOUR_PI * r)], mul([1 - 1 / (kr * kr), -1 / kr], e));
  const Hph = mul([0, K * Idl * Math.sin(th) / (FOUR_PI * r)], mul([1, -1 / kr], e));
  return { Er, Eth, Hph };
}

// Closed-form field of a centre-fed dipole of half length h on the z axis with
// the current I(z) = Im sin k(h - |z|) (Balanis eq. 8-58a,b and 8-59).
export function pwsField(h, Im, rho, z) {
  const R1 = Math.hypot(rho, z - h), R2 = Math.hypot(rho, z + h), r0 = Math.hypot(rho, z), ck = Math.cos(K * h);
  const ex = R => [Math.cos(K * R), -Math.sin(K * R)];
  const e1 = ex(R1), e2 = ex(R2), e0 = ex(r0);
  // E_z = -j eta Im/(4pi) [e1/R1 + e2/R2 - 2cos(kh) e0/r0]
  const sz = [e1[0] / R1 + e2[0] / R2 - 2 * ck * e0[0] / r0, e1[1] / R1 + e2[1] / R2 - 2 * ck * e0[1] / r0];
  const q = ETA * Im / FOUR_PI;
  const Ez = [q * sz[1], -q * sz[0]];
  // E_rho = j eta Im/(4pi rho) [(z-h) e1/R1 + (z+h) e2/R2 - 2 z cos(kh) e0/r0]
  const sr = [(z - h) * e1[0] / R1 + (z + h) * e2[0] / R2 - 2 * z * ck * e0[0] / r0, (z - h) * e1[1] / R1 + (z + h) * e2[1] / R2 - 2 * z * ck * e0[1] / r0];
  const Erho = [-q * sr[1] / rho, q * sr[0] / rho];
  // H_phi = j Im/(4pi rho) [e1 + e2 - 2 cos(kh) e0]
  const sh = [e1[0] + e2[0] - 2 * ck * e0[0], e1[1] + e2[1] - 2 * ck * e0[1]];
  const p = Im / (FOUR_PI * rho);
  const Hphi = [-p * sh[1], p * sh[0]];
  return { Ez, Erho, Hphi };
}

// ── far field, radiation intensity ──────────────────────────────────────────
// U = eta k^2/(32 pi^2) |F_perp|^2, F = sum m u e^{jk rhat.r}.
const UK = ETA * K * K / (32 * Math.PI * Math.PI);
export function farIntensity(L, sx, sy, sz) {
  let fxr = 0, fxi = 0, fyr = 0, fyi = 0, fzr = 0, fzi = 0;
  const D = L.d;
  for (let i = 0; i < L.n; i++) {
    const o = i * STRIDE;
    const ph = K * (sx * D[o] + sy * D[o + 1] + sz * D[o + 2]);
    const c = Math.cos(ph), s = Math.sin(ph);
    const mr = D[o + 6] * c - D[o + 7] * s, mi = D[o + 6] * s + D[o + 7] * c;
    fxr += mr * D[o + 3]; fxi += mi * D[o + 3];
    fyr += mr * D[o + 4]; fyi += mi * D[o + 4];
    fzr += mr * D[o + 5]; fzi += mi * D[o + 5];
  }
  const dr = fxr * sx + fyr * sy + fzr * sz, di = fxi * sx + fyi * sy + fzi * sz;
  const ar = fxr - dr * sx, br = fyr - dr * sy, cr = fzr - dr * sz;
  const ai = fxi - di * sx, bi = fyi - di * sy, ci = fzi - di * sz;
  return UK * (ar * ar + br * br + cr * cr + ai * ai + bi * bi + ci * ci);
}
// The dominant polarisation direction at one far-field direction (real unit vector).
function farPol(L, sx, sy, sz) {
  let f = [0, 0, 0, 0, 0, 0];
  const D = L.d;
  for (let i = 0; i < L.n; i++) {
    const o = i * STRIDE, ph = K * (sx * D[o] + sy * D[o + 1] + sz * D[o + 2]);
    const c = Math.cos(ph), s = Math.sin(ph), mr = D[o + 6] * c - D[o + 7] * s, mi = D[o + 6] * s + D[o + 7] * c;
    for (let a = 0; a < 3; a++) { f[2 * a] += mr * D[o + 3 + a]; f[2 * a + 1] += mi * D[o + 3 + a]; }
  }
  const sv = [sx, sy, sz];
  const dr = f[0] * sx + f[2] * sy + f[4] * sz, di = f[1] * sx + f[3] * sy + f[5] * sz;
  const re = [0, 1, 2].map(a => f[2 * a] - dr * sv[a]), im = [0, 1, 2].map(a => f[2 * a + 1] - di * sv[a]);
  // Rotate the phasor so the real part is largest: the major axis.
  const rr = re[0] ** 2 + re[1] ** 2 + re[2] ** 2, ii = im[0] ** 2 + im[1] ** 2 + im[2] ** 2, ri = re[0] * im[0] + re[1] * im[1] + re[2] * im[2];
  const th = 0.5 * Math.atan2(2 * ri, rr - ii);
  const v = [0, 1, 2].map(a => re[a] * Math.cos(th) + im[a] * Math.sin(th));
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return v.map(q => q / n);
}

// ── Gauss-Legendre nodes on [-1, 1] ─────────────────────────────────────────
const GL_CACHE = new Map();
export function gaussLegendre(n) {
  if (GL_CACHE.has(n)) return GL_CACHE.get(n);
  const x = new Float64Array(n), w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let z = Math.cos(Math.PI * (i + 0.75) / (n + 0.5)), pp = 1;
    for (let it = 0; it < 100; it++) {
      let p1 = 1, p2 = 0;
      for (let j = 1; j <= n; j++) { const p3 = p2; p2 = p1; p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j; }
      pp = n * (z * p1 - p2) / (z * z - 1);
      const z1 = z; z = z1 - p1 / pp;
      if (Math.abs(z - z1) < 1e-15) break;
    }
    x[i] = z; w[i] = 2 / ((1 - z * z) * pp * pp);
  }
  const r = { x, w }; GL_CACHE.set(n, r); return r;
}

// ── pattern statistics ──────────────────────────────────────────────────────
// opt: { nt, np } integration grid. Returns P (W), D (linear), Ddb (dBi),
// dir (unit vector of the maximum), pol (its E direction), hpbwE / hpbwH
// (degrees), fb (dB), Umax.
export function patternStats(L, opt = {}) {
  const nt = opt.nt || 72, np = opt.np || 144;
  const g = gaussLegendre(nt);
  let P = 0, Umax = -1, best = [1, 0, 0];
  for (let i = 0; i < nt; i++) {
    const ct = g.x[i], st = Math.sqrt(Math.max(0, 1 - ct * ct));
    for (let j = 0; j < np; j++) {
      const ph = 2 * Math.PI * (j + 0.5) / np;
      const sx = st * Math.cos(ph), sy = st * Math.sin(ph);
      const U = farIntensity(L, sx, sy, ct);
      P += g.w[i] * (2 * Math.PI / np) * U;
      if (U > Umax) { Umax = U; best = [sx, sy, ct]; }
    }
  }
  // Refine the maximum: a shrinking pattern search on the sphere.
  let step = 0.08;
  for (let it = 0; it < 200 && step > 1e-5; it++) {
    let moved = false;
    const t1 = perp(best), t2 = cross(best, t1);
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const v = norm([best[0] + step * (a * t1[0] + b * t2[0]), best[1] + step * (a * t1[1] + b * t2[1]), best[2] + step * (a * t1[2] + b * t2[2])]);
      const U = farIntensity(L, v[0], v[1], v[2]);
      // A relative margin: on an omni ring, round-off must not count as a gain.
      if (U > Umax * (1 + 1e-12)) { Umax = U; best = v; moved = true; }
    }
    if (!moved) step *= 0.5;
  }
  const D = P > 0 ? FOUR_PI * Umax / P : 0;
  const pol = farPol(L, best[0], best[1], best[2]);
  const hpol = cross(best, pol);
  const hpbwE = halfPowerWidth(L, best, pol, Umax), hpbwH = halfPowerWidth(L, best, hpol, Umax);
  const Uback = farIntensity(L, -best[0], -best[1], -best[2]);
  const fb = 10 * Math.log10(Umax / Math.max(Uback, Umax * 1e-12));
  return { P, D, Ddb: 10 * Math.log10(D), dir: best, pol, hpol, hpbwE, hpbwH, fb, Umax };
}
function perp(v) { const a = Math.abs(v[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]; return norm(cross(v, a)); }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(v) { const n = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / n, v[1] / n, v[2] / n]; }
// Full width (degrees) between the half-power points either side of dir,
// in the plane of dir and e. NaN when the lobe never falls to half power.
function halfPowerWidth(L, dir, e, Umax) {
  const side = sgn => {
    let prev = 0;
    for (let a = 0.25; a <= 180; a += 0.25) {
      const r = a * Math.PI / 180, c = Math.cos(r), s = sgn * Math.sin(r);
      const U = farIntensity(L, c * dir[0] + s * e[0], c * dir[1] + s * e[1], c * dir[2] + s * e[2]);
      if (U < Umax / 2) {
        // Linear interpolation between the last two samples.
        const Up = prev || Umax;
        return a - 0.25 + 0.25 * (Up - Umax / 2) / Math.max(1e-30, Up - U);
      }
      prev = U;
    }
    return NaN;
  };
  return side(1) + side(-1);
}
// U along the great circle cos(a) p + sin(a) q, n samples over 0..2pi.
export function patternCut(L, p, q, n) {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = 2 * Math.PI * i / n, c = Math.cos(a), s = Math.sin(a);
    out[i] = farIntensity(L, c * p[0] + s * q[0], c * p[1] + s * q[1], c * p[2] + s * q[2]);
  }
  return out;
}
// ── PWS kernel integral ─────────────────────────────────────────────────────
// Integral over [z0, z1] of sin(k sg (z - zb)) e^{-jkR}/R dz with
// R = sqrt((z - zp)^2 + c^2). z - zp = c sinh t gives dz/R = dt, so the
// integrand in t is smooth. Panels of at most 0.7 in t, 8-point Gauss each.
// Adds the result to acc[0], acc[1] times the weight wgt.
const G8 = gaussLegendre(8);
function segInt(z0, z1, zp, c, zb, sg, wgt, acc) {
  const ta = Math.asinh((z0 - zp) / c), tb = Math.asinh((z1 - zp) / c);
  const cuts = (ta < 0 && tb > 0) ? [ta, 0, tb] : [ta, tb];
  let sr = 0, si = 0;
  for (let q = 0; q + 1 < cuts.length; q++) {
    const a = cuts[q], b = cuts[q + 1], np = Math.max(1, Math.ceil((b - a) / 0.7)), h = (b - a) / np;
    for (let p = 0; p < np; p++) {
      const m = a + (p + 0.5) * h, hw = 0.5 * h;
      for (let i = 0; i < 8; i++) {
        const t = m + hw * G8.x[i], z = zp + c * Math.sinh(t), R = c * Math.cosh(t);
        const f = Math.sin(K * sg * (z - zb)) * G8.w[i] * hw;
        sr += f * Math.cos(K * R); si -= f * Math.sin(K * R);
      }
    }
  }
  acc[0] += wgt * sr; acc[1] += wgt * si;
}

// ── complex linear solve (Gaussian elimination, partial pivoting) ─────────
// A: Float64Array n*n*2 (row major, re im), b: Float64Array n*2. Solves in place,
// returns x as Float64Array n*2.
export function csolve(A, b, n) {
  for (let col = 0; col < n; col++) {
    let piv = col, pm = -1;
    for (let r = col; r < n; r++) { const o = (r * n + col) * 2, m = A[o] * A[o] + A[o + 1] * A[o + 1]; if (m > pm) { pm = m; piv = r; } }
    if (piv !== col) {
      for (let c = 0; c < n; c++) { const o1 = (col * n + c) * 2, o2 = (piv * n + c) * 2; for (let q = 0; q < 2; q++) { const t = A[o1 + q]; A[o1 + q] = A[o2 + q]; A[o2 + q] = t; } }
      for (let q = 0; q < 2; q++) { const t = b[col * 2 + q]; b[col * 2 + q] = b[piv * 2 + q]; b[piv * 2 + q] = t; }
    }
    const od = (col * n + col) * 2, dr = A[od], di = A[od + 1], dm = dr * dr + di * di;
    for (let r = col + 1; r < n; r++) {
      const o = (r * n + col) * 2;
      // f = A[r][col] / A[col][col]
      const fr = (A[o] * dr + A[o + 1] * di) / dm, fi = (A[o + 1] * dr - A[o] * di) / dm;
      if (fr === 0 && fi === 0) continue;
      for (let c = col; c < n; c++) {
        const a = (col * n + c) * 2, t = (r * n + c) * 2;
        A[t] -= fr * A[a] - fi * A[a + 1]; A[t + 1] -= fr * A[a + 1] + fi * A[a];
      }
      b[r * 2] -= fr * b[col * 2] - fi * b[col * 2 + 1]; b[r * 2 + 1] -= fr * b[col * 2 + 1] + fi * b[col * 2];
    }
  }
  const x = new Float64Array(n * 2);
  for (let r = n - 1; r >= 0; r--) {
    let sr = b[r * 2], si = b[r * 2 + 1];
    for (let c = r + 1; c < n; c++) { const o = (r * n + c) * 2; sr -= A[o] * x[c * 2] - A[o + 1] * x[c * 2 + 1]; si -= A[o] * x[c * 2 + 1] + A[o + 1] * x[c * 2]; }
    const o = (r * n + r) * 2, dr = A[o], di = A[o + 1], dm = dr * dr + di * di;
    x[r * 2] = (sr * dr + si * di) / dm; x[r * 2 + 1] = (si * dr - sr * di) / dm;
  }
  return x;
}

// ── moment method: parallel z-directed wires ────────────────────────────────
// wires: [{ x, y, zc, h, a, n, V }]: axis position, centre height, half length,
// radius, segment count (even), feed voltage at the centre (0 = passive).
// Galerkin with PWS bases on the interior nodes:
//   Z_mn = j eta/(4 pi sin(k d_n)) sum_p w_p  int f_m(z) G(z - z_p; c_mn) dz
//   p = the three nodes of basis n, w = 1, -2 cos(k d_n), 1.
// Returns { nodes: [{ z: Float64Array, Ir, Ii }], Zin (driven wire 0 that has
// V), feed: [re, im] current, n: unknowns }.
export function solveWires(wires) {
  const B = [];   // bases: { w, z, d, s }
  wires.forEach((W, wi) => {
    const dz = 2 * W.h / W.n;
    for (let j = 1; j < W.n; j++) B.push({ w: wi, j, z: W.zc - W.h + j * dz, d: dz, s: Math.sin(K * dz) });
  });
  const N = B.length, A = new Float64Array(N * N * 2), b = new Float64Array(N * 2);
  const acc = [0, 0];
  for (let m = 0; m < N; m++) {
    const bm = B[m], Wm = wires[bm.w];
    for (let n = m; n < N; n++) {
      const bn = B[n], Wn = wires[bn.w];
      const rho = Math.hypot(Wm.x - Wn.x, Wm.y - Wn.y);
      const c = Math.sqrt(rho * rho + Wn.a * Wn.a);
      acc[0] = 0; acc[1] = 0;
      const nodes = [[bn.z - bn.d, 1], [bn.z, -2 * Math.cos(K * bn.d)], [bn.z + bn.d, 1]];
      for (const [zp, wp] of nodes) {
        segInt(bm.z - bm.d, bm.z, zp, c, bm.z - bm.d, 1, wp, acc);
        segInt(bm.z, bm.z + bm.d, zp, c, bm.z + bm.d, -1, wp, acc);
      }
      // (j eta / (4 pi s_n s_m)) * acc
      const q = ETA / (FOUR_PI * bn.s * bm.s);
      const zr = -q * acc[1], zi = q * acc[0];
      A[(m * N + n) * 2] = zr; A[(m * N + n) * 2 + 1] = zi;
      A[(n * N + m) * 2] = zr; A[(n * N + m) * 2 + 1] = zi;
    }
  }
  let feedIdx = -1, Vf = 0;
  wires.forEach((W, wi) => {
    if (!W.V) return;
    const m = B.findIndex(q => q.w === wi && q.j === W.n / 2);
    b[m * 2] = W.V;
    if (feedIdx < 0) { feedIdx = m; Vf = W.V; }
  });
  const x = csolve(A, b, N);
  const nodes = wires.map(W => ({ z: new Float64Array(W.n + 1), Ir: new Float64Array(W.n + 1), Ii: new Float64Array(W.n + 1) }));
  wires.forEach((W, wi) => { const dz = 2 * W.h / W.n; for (let j = 0; j <= W.n; j++) nodes[wi].z[j] = W.zc - W.h + j * dz; });
  B.forEach((q, i) => { nodes[q.w].Ir[q.j] = x[i * 2]; nodes[q.w].Ii[q.j] = x[i * 2 + 1]; });
  const fr = feedIdx >= 0 ? x[feedIdx * 2] : 0, fi = feedIdx >= 0 ? x[feedIdx * 2 + 1] : 0, fm = fr * fr + fi * fi;
  const Zin = fm > 0 ? [Vf * fr / fm, -Vf * fi / fm] : [Infinity, 0];
  return { nodes, Zin, feed: [fr, fi], n: N };
}

// ── induced EMF: sinusoidal dipoles ─────────────────────────────────────────
// Impedance referred to the current maximum, Z_m = j eta/(4 pi) int f [G1 + G2
// - 2 cos(kh) G0] dz with f = sin k(h - |z|), c = sqrt(rho^2 + a^2).
function sinReaction(h1, h2, c) {
  const acc = [0, 0];
  for (const [zp, wp] of [[-h2, 1], [0, -2 * Math.cos(K * h2)], [h2, 1]]) {
    segInt(-h1, 0, zp, c, -h1, 1, wp, acc);
    segInt(0, h1, zp, c, h1, -1, wp, acc);
  }
  const q = ETA / FOUR_PI;
  return [-q * acc[1], q * acc[0]];
}
// Input impedance of a centre-fed dipole of length L with I = Im sin k(L/2 - |z|).
// Returns { Zm, Zin } ([re, im]; Zin is Infinity where sin(kL/2) = 0).
export function dipoleZsin(L, a) {
  const h = L / 2, Zm = sinReaction(h, h, a), s2 = Math.sin(K * h) ** 2;
  return { Zm, Zin: s2 > 1e-6 ? [Zm[0] / s2, Zm[1] / s2] : [Infinity, Infinity] };
}
// Mutual impedance (referred to the input currents) of two parallel side by
// side sinusoidal dipoles, lengths L1 and L2, axis distance d.
export function mutualZsin(L1, L2, d) {
  const Zm = sinReaction(L1 / 2, L2 / 2, d), s = Math.sin(K * L1 / 2) * Math.sin(K * L2 / 2);
  return [Zm[0] / s, Zm[1] / s];
}

// ── moment method: circular loop, Fourier modes ─────────────────────────────
// Loop radius b in the xy plane, wire radius a, delta-gap feed V at phi = 0.
//   K_m = int_{-pi}^{pi} e^{-jkR}/R cos(m psi) dpsi,  R = sqrt(4 b^2 sin^2(psi/2) + a^2)
//   a_n = (kb/2)(K_{n-1} + K_{n+1}) - (n^2/(kb)) K_n,   I_n = -2j V/(eta b a_n)
//   I(phi) = I_0 + 2 sum_{n>=1} I_n cos(n phi)
export function solveLoop(b, a, nModes = 40, V = 1) {
  const M = nModes + 1;
  const Kr = new Float64Array(M + 1), Ki = new Float64Array(M + 1);
  // Geometric panels from psi = 0 (the 1/R peak has width a/b), then panels of
  // at most 0.04 rad, so cos(m psi) is resolved to m = 60.
  const edges = [0];
  let e = a / b;
  while (e < Math.PI) { edges.push(e); e = Math.min(Math.PI, e * 2); if (e >= Math.PI) edges.push(Math.PI); }
  if (edges[edges.length - 1] !== Math.PI) edges.push(Math.PI);
  for (let q = 0; q + 1 < edges.length; q++) {
    const lo = edges[q], hi = edges[q + 1], np = Math.max(1, Math.ceil((hi - lo) / 0.04)), hp = (hi - lo) / np;
    for (let p = 0; p < np; p++) {
      const mid = lo + (p + 0.5) * hp;
      for (let i = 0; i < 8; i++) {
        const psi = mid + 0.5 * hp * G8.x[i], w = 2 * G8.w[i] * 0.5 * hp;   // x2: the integrand is even
        const sh = Math.sin(psi / 2), R = Math.sqrt(4 * b * b * sh * sh + a * a);
        const gr = Math.cos(K * R) / R * w, gi = -Math.sin(K * R) / R * w;
        // cos(m psi) by the recurrence c_{m+1} = 2 cos(psi) c_m - c_{m-1}
        const c2 = 2 * Math.cos(psi);
        let cp = 1, cc = Math.cos(psi);
        Kr[0] += gr; Ki[0] += gi; Kr[1] += gr * cc; Ki[1] += gi * cc;
        for (let m = 2; m <= M; m++) { const cn = c2 * cc - cp; cp = cc; cc = cn; Kr[m] += gr * cn; Ki[m] += gi * cn; }
      }
    }
  }
  const kb = K * b;
  const In = [];   // [re, im] for n = 0..nModes
  for (let n = 0; n <= nModes; n++) {
    const km1 = Math.abs(n - 1), kp1 = n + 1;
    const ar = kb / 2 * (Kr[km1] + Kr[kp1]) - n * n / kb * Kr[n];
    const ai = kb / 2 * (Ki[km1] + Ki[kp1]) - n * n / kb * Ki[n];
    // I_n = -2jV / (eta b (ar + j ai))
    const den = ETA * b * (ar * ar + ai * ai);
    In.push([-2 * V * ai / den, -2 * V * ar / den]);
  }
  const Iat = phi => {
    let r = In[0][0], i = In[0][1];
    for (let n = 1; n <= nModes; n++) { const c = 2 * Math.cos(n * phi); r += In[n][0] * c; i += In[n][1] * c; }
    return [r, i];
  };
  const I0 = Iat(0), m0 = I0[0] * I0[0] + I0[1] * I0[1];
  // Z0: the impedance of the uniform mode alone (V / I_0). For a small loop
  // its real part is the radiation resistance; Zin also holds the gap
  // capacitance of the higher modes.
  const q0 = In[0][0] ** 2 + In[0][1] ** 2;
  return { In, Iat, Zin: [V * I0[0] / m0, -V * I0[1] / m0], Z0: [V * In[0][0] / q0, -V * In[0][1] / q0], feed: I0 };
}

// ── antennas ────────────────────────────────────────────────────────────────
// state (all lengths in wavelengths at the operating frequency):
//   type: 'hertz' | 'dipole' | 'loop' | 'array' | 'yagi'
//   hertz:  dl
//   dipole: L, a, model ('sin' | 'mom'), nseg
//   loop:   C (circumference), a
//   array:  N, d, beta (radians, progressive phase), Le (element length), a
//   yagi:   Lr, Ld, Lz (director), sr (reflector spacing), sd (director spacing), nd, a
// Returns { elems, wires: [{ pts: [[x,y,z]..], I: [[re,im]..] }], Zin, feed,
//   extent (largest size D), psi: { side, top } flux function kinds, note }.
// All results are scaled so the feed current is 1 A (0 phase).
function cmul(a, b) { return [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]; }
function cdiv(a, b) { const m = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / m, (a[1] * b[0] - a[0] * b[1]) / m]; }

// Elements for a z wire from node currents with sinusoidal interpolation.
function wireElems(Lst, x, y, z, Ir, Ii, sub, scale, draw) {
  const n = z.length - 1, dz = z[1] - z[0], s = Math.sin(K * dz);
  const pts = [], cur = [];
  for (let j = 0; j < n; j++) {
    for (let q = 0; q < sub; q++) {
      const t0 = (q + 0.5) / sub, zz = z[j] + t0 * dz;
      const wa = Math.abs(s) > 1e-9 ? Math.sin(K * (z[j + 1] - zz)) / s : 1 - t0, wb = Math.abs(s) > 1e-9 ? Math.sin(K * (zz - z[j])) / s : t0;
      const ir = Ir[j] * wa + Ir[j + 1] * wb, ii = Ii[j] * wa + Ii[j + 1] * wb;
      const I = cmul([ir, ii], scale), l = dz / sub;
      pushElem(Lst, x, y, zz, 0, 0, 1, I[0] * l, I[1] * l);
    }
  }
  for (let j = 0; j <= n; j++) { pts.push([x, y, z[j]]); cur.push(cmul([Ir[j], Ii[j]], scale)); }
  draw.push({ pts, I: cur });
}

export function buildAntenna(st) {
  const L = elemList(256), wires = [];
  let Zin = null, extent = 0, note = '', psi = { side: null, top: null }, nonUniform = 0;
  const budget = st.budget || 260;
  if (st.type === 'hertz') {
    pushElem(L, 0, 0, 0, 0, 0, 1, st.dl, 0);
    wires.push({ pts: [[0, 0, -st.dl / 2], [0, 0, st.dl / 2]], I: [[1, 0], [1, 0]] });
    extent = st.dl;
    psi = { side: 'E', top: 'B' };
    // Radiation resistance only: the reactance of an ideal element is not
    // defined. (2 pi/3) eta (dl/lambda)^2 is the textbook 80 pi^2 (dl/lambda)^2
    // with the exact eta in place of 120 pi.
    Zin = [2 * Math.PI / 3 * ETA * st.dl * st.dl, NaN];
  } else if (st.type === 'dipole') {
    const h = st.L / 2;
    extent = st.L;
    psi = { side: 'E', top: 'B' };
    if (st.model === 'mom') {
      const nseg = st.nseg || Math.max(16, 2 * Math.round(st.L * 40));
      const r = solveWires([{ x: 0, y: 0, zc: 0, h, a: st.a, n: nseg, V: 1 }]);
      Zin = r.Zin;
      const sc = cdiv([1, 0], r.feed);
      const nd = r.nodes[0];
      wireElems(L, 0, 0, nd.z, nd.Ir, nd.Ii, Math.max(1, Math.round(Math.min(budget, 200) / nseg)), sc, wires);
      note = nseg - 1 + ' PWS bases';
    } else {
      const zs = dipoleZsin(st.L, st.a);
      Zin = zs.Zin;
      // I(z) = Im sin k(h - |z|); with Im = 1/sin(kh) the feed current is 1 A.
      const sk = Math.sin(K * h), Im = Math.abs(sk) > 0.05 ? 1 / sk : 1;
      const ne = Math.max(24, Math.min(budget, Math.round(st.L * 96)));
      const pts = [], cur = [];
      for (let i = 0; i < ne; i++) {
        const z = -h + (i + 0.5) * (2 * h / ne), I = Im * Math.sin(K * (h - Math.abs(z)));
        pushElem(L, 0, 0, z, 0, 0, 1, I * 2 * h / ne, 0);
      }
      for (let i = 0; i <= 40; i++) { const z = -h + i * h / 20; pts.push([0, 0, z]); cur.push([Im * Math.sin(K * (h - Math.abs(z))), 0]); }
      wires.push({ pts, I: cur });
      if (Math.abs(sk) <= 0.05) note = 'feed at a current node: Z_in is very large';
    }
  } else if (st.type === 'loop') {
    const b = st.C / (2 * Math.PI);
    extent = 2 * b;
    const lp = solveLoop(b, st.a, st.modes || 40);
    Zin = lp.Zin;
    const sc = cdiv([1, 0], lp.feed);
    const ne = Math.max(48, Math.min(budget, 96));
    const pts = [], cur = [];
    for (let i = 0; i < ne; i++) {
      const ph = 2 * Math.PI * (i + 0.5) / ne, I = cmul(lp.Iat(ph), sc), l = 2 * Math.PI * b / ne;
      pushElem(L, b * Math.cos(ph), b * Math.sin(ph), 0, -Math.sin(ph), Math.cos(ph), 0, I[0] * l, I[1] * l);
    }
    for (let i = 0; i <= 64; i++) { const ph = 2 * Math.PI * i / 64; pts.push([b * Math.cos(ph), b * Math.sin(ph), 0]); cur.push(cmul(lp.Iat(ph), sc)); }
    wires.push({ pts, I: cur });
    // A uniform current has a flux function for B in the side view. Here the
    // other modes are measured against the uniform one: sum_{n>=1} 2|I_n| / |I_0|.
    // Under 0.12 the contours of rho A_phi are drawn as the B lines.
    const a0 = Math.hypot(lp.In[0][0], lp.In[0][1]);
    let rest = 0;
    for (let n = 1; n < lp.In.length; n++) rest += 2 * Math.hypot(lp.In[n][0], lp.In[n][1]);
    psi = { side: rest / a0 < 0.12 ? 'Bloop' : null, top: null };
    nonUniform = rest / a0;
    note = (st.modes || 40) + ' Fourier modes';
  } else if (st.type === 'array') {
    const N = st.N, d = st.d, h = st.Le / 2;
    extent = Math.hypot((N - 1) * d, st.Le);
    const sub = Math.max(6, Math.min(24, Math.floor(budget / N)));
    for (let n = 0; n < N; n++) {
      const x = (n - (N - 1) / 2) * d, ph = n * st.beta - (N - 1) / 2 * st.beta;
      const I = [Math.cos(ph), Math.sin(ph)], sk = Math.sin(K * h), Im = 1 / sk;
      const pts = [], cur = [];
      for (let i = 0; i < sub; i++) {
        const z = -h + (i + 0.5) * (2 * h / sub), a = Im * Math.sin(K * (h - Math.abs(z)));
        pushElem(L, x, 0, z, 0, 0, 1, I[0] * a * 2 * h / sub, I[1] * a * 2 * h / sub);
      }
      for (let i = 0; i <= 12; i++) { const z = -h + i * h / 6, a = Im * Math.sin(K * (h - Math.abs(z))); pts.push([x, 0, z]); cur.push([I[0] * a, I[1] * a]); }
      wires.push({ pts, I: cur });
    }
    // Active impedance of the centre element from induced-EMF mutual impedances.
    const c = Math.floor((N - 1) / 2), self = dipoleZsin(st.Le, st.a).Zin;
    let Za = self.slice();
    for (let n = 0; n < N; n++) {
      if (n === c) continue;
      const Zm = mutualZsin(st.Le, st.Le, Math.abs(n - c) * d), r = [Math.cos((n - c) * st.beta), Math.sin((n - c) * st.beta)];
      const t = cmul(Zm, r); Za[0] += t[0]; Za[1] += t[1];
    }
    Zin = Za;
    psi = { side: null, top: 'B' };
    note = 'active Z of element ' + (c + 1);
  } else if (st.type === 'yagi') {
    const W = [];
    const nseg = st.nseg || 12;
    W.push({ x: -st.sr, y: 0, zc: 0, h: st.Lr / 2, a: st.a, n: nseg, V: 0 });
    W.push({ x: 0, y: 0, zc: 0, h: st.Ld / 2, a: st.a, n: nseg, V: 1 });
    for (let i = 0; i < st.nd; i++) W.push({ x: (i + 1) * st.sd, y: 0, zc: 0, h: st.Lz / 2 * Math.pow(st.taper || 1, i), a: st.a, n: nseg, V: 0 });
    const r = solveWires(W);
    Zin = r.Zin;
    const sc = cdiv([1, 0], r.feed);
    const sub = Math.max(1, Math.floor(budget / (W.length * nseg)));
    W.forEach((w, i) => wireElems(L, w.x, w.y, r.nodes[i].z, r.nodes[i].Ir, r.nodes[i].Ii, sub, sc, wires));
    const span = st.sr + st.nd * st.sd;
    extent = Math.hypot(span, Math.max(st.Lr, st.Ld));
    psi = { side: null, top: 'B' };
    note = r.n + ' PWS bases on ' + W.length + ' wires';
    wires.forEach((w, i) => { w.role = i === 0 ? 'reflector' : i === 1 ? 'driven' : 'director'; });
  }
  return { elems: L, wires, Zin, extent, note, psi, nonUniform };
}
