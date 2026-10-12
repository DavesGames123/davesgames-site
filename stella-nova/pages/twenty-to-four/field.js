// ============================================================================
//  TWENTY TO FOUR  ·  field.js — the radiating dipole and the geometry of
//  curl, divergence and forms  (ES module, no DOM: node tests import it)
// ----------------------------------------------------------------------------
//  One source: a point dipole p(t) = cos(ωt) ẑ at the origin. Units: c = 1,
//  ε0 = μ0 = 1, and 4π is in the dipole strength, so the factor 1/4π goes.
//  λ is the wavelength in world units, k = 2π/λ, ω = k.
//
//  EXACT FIELDS   (retarded time t_r = t − r, so p, ṗ, p̈ are at t_r)
//      E = [3r̂(r̂·p) − p]/r³ + [3r̂(r̂·ṗ) − ṗ]/r² + [r̂(r̂·p̈) − p̈]/r
//      B = (ṗ × r̂)/r² + (p̈ × r̂)/r
//  POTENTIALS (Lorenz gauge)
//      A = ṗ/r ẑ                 φ = cosθ (p/r² + ṗ/r)
//      E = −∇φ − ∂A/∂t           B = ∇ × A
//  E LINES. In a plane through the axis, E is tangent to the level lines of
//      Q = sin²θ (p/r + ṗ)  (Q = ρ ∫B_φ dt). The shader in render.js draws
//      the level lines of Q/k = sin²θ [cos u/(kr) − sin u], u = ω t − k r.
//
//  GEOMETRY  (the limits that define curl and divergence)
//      circulation(F, P, axis, h)  ∮ F·dℓ round a square of side h in the
//                                  plane normal to axis, counterclockwise
//                                  seen from +axis. Divided by h² it is
//                                  the axis component of curl F.
//      faceFlux(F, P, h)           the flux out of each face of a cube of
//                                  side h. Each opposite pair, over h³, is
//                                  one term ∂_i F_i of the divergence.
//
//  GREP MAP
//      grep -n "export function EB"        E and B at a point
//      grep -n "export function dEdt"      ∂E/∂t and ∂B/∂t (closed form)
//      grep -n "export function potentials" φ and A
//      grep -n "export function fluxQ"     the E-line function Q
//      grep -n "export function gauge"     χ, ∇χ and ∂χ/∂t of the gauge blob
//      grep -n "export function curlFD"    curl by central differences
//      grep -n "export function circulation"  the loop integral
//      grep -n "export function faceFlux"  flux out of a small cube
//      grep -n "export function tensorF"   F_{μν} from E and B
//      grep -n "export function dF"        the four components of dF
//      grep -n "export function termAmps"  near, induction and far terms
//      grep -n "export function ampEquator" |E| on the equator, closed form
//      grep -n "export function fromPotentials"  E and B by differencing φ, A
// ============================================================================

export const TAU = Math.PI * 2;
export const kOf = lambda => TAU / lambda;

// p, ṗ, p̈ (and the third derivative) at the retarded time.
function pr(k, r, t) {
  const u = k * (t - r), c = Math.cos(u), s = Math.sin(u);
  return [c, -k * s, -k * k * c, k * k * k * s];
}

// E and B at (x, y, z), time t, wavenumber k. Writes E[0..2], B[0..2].
export function EB(x, y, z, t, k, E, B) {
  const r2 = x * x + y * y + z * z, r = Math.sqrt(r2);
  const [p, pd, pdd] = pr(k, r, t);
  const nx = x / r, ny = y / r, nz = z / r;
  const a = 3 * p / (r2 * r) + 3 * pd / r2 + pdd / r;   // times r̂ (r̂·ẑ)
  const b = p / (r2 * r) + pd / r2 + pdd / r;           // times ẑ
  E[0] = nx * nz * a; E[1] = ny * nz * a; E[2] = nz * nz * a - b;
  const m = pd / r2 + pdd / r;                          // times ẑ × r̂ = (−ny, nx, 0)
  B[0] = -ny * m; B[1] = nx * m; B[2] = 0;
}

// The closed-form time derivatives: every p shifts one derivative up.
export function dEdt(x, y, z, t, k, dE, dB) {
  const r2 = x * x + y * y + z * z, r = Math.sqrt(r2);
  const [, pd, pdd, pddd] = pr(k, r, t);
  const nx = x / r, ny = y / r, nz = z / r;
  const a = 3 * pd / (r2 * r) + 3 * pdd / r2 + pddd / r;
  const b = pd / (r2 * r) + pdd / r2 + pddd / r;
  dE[0] = nx * nz * a; dE[1] = ny * nz * a; dE[2] = nz * nz * a - b;
  const m = pdd / r2 + pddd / r;
  dB[0] = -ny * m; dB[1] = nx * m; dB[2] = 0;
}

// The Lorenz-gauge potentials. Returns [φ, Ax, Ay, Az].
export function potentials(x, y, z, t, k) {
  const r = Math.hypot(x, y, z), [p, pd] = pr(k, r, t);
  return [z / r * (p / (r * r) + pd / r), 0, 0, pd / r];
}

// The E-line function Q at a point (axisymmetric, so ρ and z are enough).
export function fluxQ(rho, z, t, k) {
  const r = Math.hypot(rho, z), [p, pd] = pr(k, r, t), s2 = rho * rho / (r * r);
  return s2 * (p / r + pd);
}

// A gauge function: a blob that breathes in time, centred at c with width w.
//   χ = g cos(ωt) exp(−|x − c|²/w²)
// Returns [χ, ∂xχ, ∂yχ, ∂zχ, ∂tχ]. A' = A + ∇χ and φ' = φ − ∂tχ give the
// same E and B (tests.mjs checks it).
export function gauge(x, y, z, t, k, g, c, w) {
  const dx = x - c[0], dy = y - c[1], dz = z - c[2];
  const G = Math.exp(-(dx * dx + dy * dy + dz * dz) / (w * w));
  const ch = g * Math.cos(k * t) * G, f = -2 / (w * w);
  return [ch, ch * f * dx, ch * f * dy, ch * f * dz, -g * k * Math.sin(k * t) * G];
}

// A vector field as a function: (x, y, z, out) -> out[0..2].
// fieldFn('E' | 'B', t, k) wraps EB for the geometry helpers below.
export function fieldFn(which, t, k) {
  const E = [0, 0, 0], B = [0, 0, 0];
  return (x, y, z, out) => { EB(x, y, z, t, k, E, B); const F = which === 'B' ? B : E; out[0] = F[0]; out[1] = F[1]; out[2] = F[2]; return out; };
}

// Partial derivatives by central differences: J[i][j] = ∂_j F_i.
export function jacobian(F, P, h = 1e-5) {
  const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], a = [0, 0, 0], b = [0, 0, 0];
  for (let j = 0; j < 3; j++) {
    const q0 = P.slice(), q1 = P.slice();
    q0[j] -= h; q1[j] += h;
    F(q1[0], q1[1], q1[2], a); F(q0[0], q0[1], q0[2], b);
    for (let i = 0; i < 3; i++) J[i][j] = (a[i] - b[i]) / (2 * h);
  }
  return J;
}

// The three lines of the curl, written out one component at a time, as
// Maxwell wrote them:  (∇×F)_x = ∂_y F_z − ∂_z F_y  and so on.
export function curlFD(F, P, h) {
  const J = jacobian(F, P, h);
  return [J[2][1] - J[1][2], J[0][2] - J[2][0], J[1][0] - J[0][1]];
}
// The same curl from the Levi-Civita symbol: (∇×F)_i = ε_ijk ∂_j F_k.
// One formula, no written-out lines: the vector form.
export function curlLC(F, P, h) {
  const J = jacobian(F, P, h), out = [0, 0, 0];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) out[i] += eps3(i, j, k) * J[k][j];
  return out;
}
export function eps3(i, j, k) { return (i - j) * (j - k) * (k - i) / 2; }
export function divFD(F, P, h) { const J = jacobian(F, P, h); return J[0][0] + J[1][1] + J[2][2]; }

// Four-point Gauss–Legendre nodes and weights on [−1, 1].
const GL = [[-0.8611363115940526, 0.3478548451374538], [-0.3399810435848563, 0.6521451548625461],
  [0.3399810435848563, 0.6521451548625461], [0.8611363115940526, 0.3478548451374538]];

// The two axes of the plane normal to `axis`, in right-hand order: e1 × e2 = n.
export const PLANE = [[1, 2], [2, 0], [0, 1]];

// ∮ F·dℓ round the square of side h centred at P, in the plane normal to
// axis (0 x, 1 y, 2 z), counterclockwise seen from the +axis side.
export function circulation(F, P, axis, h) {
  const [i, j] = PLANE[axis], v = [0, 0, 0], q = [0, 0, 0], H = h / 2;
  // Edges as (start corner in (i, j), direction in (i, j)).
  const edges = [[[-H, -H], [1, 0]], [[H, -H], [0, 1]], [[H, H], [-1, 0]], [[-H, H], [0, -1]]];
  let sum = 0;
  for (const [s, d] of edges) {
    for (const [x, w] of GL) {
      const tt = (x + 1) / 2 * h;
      q[0] = P[0]; q[1] = P[1]; q[2] = P[2];
      q[i] += s[0] + d[0] * tt; q[j] += s[1] + d[1] * tt;
      F(q[0], q[1], q[2], v);
      sum += w * (h / 2) * (v[i] * d[0] + v[j] * d[1]);
    }
  }
  return sum;
}

// Flux out of each face of the cube of side h centred at P:
// [x−, x+, y−, y+, z−, z+], each with its outward normal.
export function faceFlux(F, P, h) {
  const out = [], v = [0, 0, 0], q = [0, 0, 0], H = h / 2;
  for (let a = 0; a < 3; a++) {
    const [i, j] = PLANE[a];
    for (const sgn of [-1, 1]) {
      let s = 0;
      for (const [x1, w1] of GL) for (const [x2, w2] of GL) {
        q[0] = P[0]; q[1] = P[1]; q[2] = P[2];
        q[a] += sgn * H; q[i] += x1 * H; q[j] += x2 * H;
        F(q[0], q[1], q[2], v);
        s += w1 * w2 * H * H * sgn * v[a];
      }
      out.push(s);
    }
  }
  return out;
}

// The field tensor F_{μν} (μ, ν = t, x, y, z) for metric (−,+,+,+), c = 1:
//   F_{0i} = −E_i,  F_{ij} = ε_ijk B_k.  F = dA with A_μ = (−φ, A).
export function tensorF(E, B) {
  const F = [[0, -E[0], -E[1], -E[2]], [E[0], 0, B[2], -B[1]], [E[1], -B[2], 0, B[0]], [E[2], B[1], -B[0], 0]];
  return F;
}
// The four components of the 3-form dF:  ∂_λF_{μν} + ∂_μF_{νλ} + ∂_νF_{λμ}
// for the index triples (λμν) = (x y z), (t y z), (t z x), (t x y).
//   (x y z) is ∇·B.   (t y z), (t z x), (t x y) are (∂_t B + ∇×E)_x, _y, _z.
export const TRIPLES = [[1, 2, 3], [0, 2, 3], [0, 3, 1], [0, 1, 2]];
export function dF(x, y, z, t, k, h = 1e-5, fields = dipoleEB(k)) {
  const at = (X) => { const [E, B] = fields(X[0], X[1], X[2], X[3]); return tensorF(E, B); };
  const X = [t, x, y, z];
  const d = (mu, a, b) => { const p = X.slice(), m = X.slice(); p[mu] += h; m[mu] -= h; return (at(p)[a][b] - at(m)[a][b]) / (2 * h); };
  return TRIPLES.map(([l, m, n]) => d(l, m, n) + d(m, n, l) + d(n, l, m));
}
// The dipole as (t, x, y, z) -> [E, B], the default field of dF and dStarF.
export function dipoleEB(k) {
  return (t, x, y, z) => { const E = [0, 0, 0], B = [0, 0, 0]; EB(x, y, z, t, k, E, B); return [E, B]; };
}
// The four components of d⋆F (in vacuum J = 0), as ∂_μ F^{μν}, ν = t, x, y, z.
//   ν = t is −∇·E.  ν = x, y, z are (∂_t E − ∇×B)_x, _y, _z.
export function dStarF(x, y, z, t, k, h = 1e-5, fields = dipoleEB(k)) {
  const eta = [-1, 1, 1, 1];
  const up = (X) => { const [E, B] = fields(X[0], X[1], X[2], X[3]); const F = tensorF(E, B); return F.map((row, a) => row.map((v, b) => v * eta[a] * eta[b])); };
  const X = [t, x, y, z], out = [0, 0, 0, 0];
  for (let mu = 0; mu < 4; mu++) {
    const p = X.slice(), m = X.slice(); p[mu] += h; m[mu] -= h;
    const Fp = up(p), Fm = up(m);
    for (let nu = 0; nu < 4; nu++) out[nu] += (Fp[mu][nu] - Fm[mu][nu]) / (2 * h);
  }
  return out;
}

// The size of the three terms of E_θ on the equator, as k r runs: the
// bound term 1/(kr)³, the induction term 1/(kr)², the radiation term
// 1/(kr). They are equal at kr = 1, the edge of the near zone.
export function termAmps(kr) { return [1 / (kr * kr * kr), 1 / (kr * kr), 1 / kr]; }

// The amplitude of E (largest |E| over one period, n phases) at (r, θ).
export function ampE(r, theta, k, n = 64) {
  const E = [0, 0, 0], B = [0, 0, 0], x = r * Math.sin(theta), z = r * Math.cos(theta);
  let m = 0;
  for (let i = 0; i < n; i++) { EB(x, 0, z, i / n * TAU / k, k, E, B); m = Math.max(m, Math.hypot(E[0], E[1], E[2])); }
  return m;
}
// The time-averaged Poynting flux out through a sphere of radius r, per
// unit solid angle, in the direction θ:  r² ⟨(E × B) · r̂⟩.
export function powerPattern(r, theta, k, n = 64) {
  const E = [0, 0, 0], B = [0, 0, 0], nx = Math.sin(theta), nz = Math.cos(theta);
  let s = 0;
  for (let i = 0; i < n; i++) {
    EB(r * nx, 0, r * nz, i / n * TAU / k, k, E, B);
    const S = [E[1] * B[2] - E[2] * B[1], E[2] * B[0] - E[0] * B[2], E[0] * B[1] - E[1] * B[0]];
    s += S[0] * nx + S[2] * nz;
  }
  return r * r * s / n;
}

// |E| amplitude on the equator in units of k³ (p0 = 1), as a function of
// x = kr: the phasor sum 1/x³ + i/x² − 1/x of the three terms.
export function ampEquator(x) { const re = 1 / (x * x * x) - 1 / x, im = 1 / (x * x); return Math.hypot(re, im); }

// E and B from potentials by central differences: pot(x, y, z, t) returns
// [φ, Ax, Ay, Az]. Also the Lorenz expression ∇·A + ∂φ/∂t. The gauge check
// of the page and tests.mjs use it.
export function fromPotentials(P, t, pot, h = 1e-5) {
  const g = [0, 0, 0], Ab = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let j = 0; j < 3; j++) {
    const p = P.slice(), m = P.slice(); p[j] += h; m[j] -= h;
    const a = pot(p[0], p[1], p[2], t), b = pot(m[0], m[1], m[2], t);
    g[j] = (a[0] - b[0]) / (2 * h);
    for (let i = 0; i < 3; i++) Ab[i][j] = (a[i + 1] - b[i + 1]) / (2 * h);
  }
  const ap = pot(P[0], P[1], P[2], t + h), am = pot(P[0], P[1], P[2], t - h);
  const dA = [1, 2, 3].map(i => (ap[i] - am[i]) / (2 * h));
  const dphi = (ap[0] - am[0]) / (2 * h);
  const E = [0, 1, 2].map(i => -g[i] - dA[i]);
  const B = [Ab[2][1] - Ab[1][2], Ab[0][2] - Ab[2][0], Ab[1][0] - Ab[0][1]];
  return { E, B, lorenz: Ab[0][0] + Ab[1][1] + Ab[2][2] + dphi };
}
