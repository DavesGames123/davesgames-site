// ============================================================================
//  CHANDRASEKHAR LIMIT  ·  physics.js — the white-dwarf model (no DOM)
// ----------------------------------------------------------------------------
//  Every number on the page comes from this module. Node can import it
//  (tests.mjs), and the figures, the renders and the saver import it.
//
//  MODEL
//    Units are SI. A cold white dwarf is a ball of ions and a degenerate
//    electron gas. The ions give the mass, mu_e m_u per electron. The
//    electrons give the pressure. x = p_F / (m_e c) is the Fermi momentum
//    in units of m_e c.
//      rho = B x^3                         B = 8 pi mu_e m_u (m_e c)^3 / 3 h^3
//      P   = A f(x)                        A = pi m_e^4 c^5 / 3 h^3
//      f(x) = x (2x^2 - 3) sqrt(1 + x^2) + 3 asinh x
//    x << 1 gives P ~ rho^(5/3), x >> 1 gives P ~ rho^(4/3).
//
//    Lane-Emden (polytrope P = K rho^(1+1/n)):
//      theta'' + (2/xi) theta' + theta^n = 0,  theta(0) = 1, theta'(0) = 0
//      xi_1 = the first zero, omega_n = -xi_1^2 theta'(xi_1)
//    Chandrasekhar (full equation of state, y = sqrt(1 + x^2) = y0 phi):
//      phi'' + (2/eta) phi' + (phi^2 - 1/y0^2)^(3/2) = 0,  surface phi = 1/y0
//      r = alpha eta,  alpha = sqrt(2A / (pi G)) / (B y0)
//      M = (8A / (B^2 G)) sqrt(2A / (pi G)) (-eta_1^2 phi'(eta_1))
//    Both use RK4 with a fixed step and a secant step onto the surface.
//
//    M_Ch = (sqrt(3 pi) / 2) omega_3 (hbar c / G)^(3/2) / (mu_e m_u)^2.
//    The mass per electron is mu_e m_u: for carbon-12 it is exactly 2 m_u.
//    Chandrasekhar wrote the formula with m_H. massChandra(mu, M_H) gives
//    that form too.
//
//  EXPORTS   (jump with grep -n "<anchor>" physics.js)
//    constants ........ "export const K"           SI constants, solar units
//    stars ............ "export const STARS"       Sirius B and two more
//    equation of state  "export function eos"     A, B, f, P, rho, Gamma
//    Lane-Emden ....... "export function laneEmden"   one polytrope
//    RK4 step ......... "export function rk4Step"  the step the saver shows
//    M_Ch formula ..... "export function massChandra"
//    exact dwarf ...... "export function whiteDwarf"  one model from x_c
//    M-R curve ........ "export function massRadiusCurve"
//    n = 1.5 curve .... "export function polytropeMR"
//    model by mass .... "export function dwarfOfMass"  bisection on x_c
//    energy toy ....... "export function energyModel"  E(R) for section 4
//    Fermi gas ........ "export function fermi"   p_F, E_F, x from rho
//    cosmology ........ "export function distanceModulus"
// ============================================================================

export const K = {
  c: 299792458,
  hbar: 1.054571817e-34,
  h: 6.62607015e-34,
  G: 6.67430e-11,
  me: 9.1093837015e-31,
  mu: 1.66053906660e-27,     // atomic mass unit
  mH: 1.6735575e-27,         // hydrogen atom
  Msun: 1.98841e30,          // IAU nominal GM_sun / G
  Rsun: 6.957e8,
  Rearth: 6.371e6,
  MeV: 1.602176634e-13,
  pc: 3.0856775814913673e16,
};
K.mec2 = K.me * K.c * K.c;

// Measured white dwarfs: mass (Msun) and radius (Rsun), with 1 sigma.
export const STARS = [
  { id: 'siriusB', name: 'Sirius B', M: 1.018, dM: 0.011, R: 0.008098, dR: 0.000046, T: 25369,
    ref: 'Bond et al. 2017 (mass); Joyce et al. 2018 (radius)' },
  { id: 'procyonB', name: 'Procyon B', M: 0.592, dM: 0.006, R: 0.01234, dR: 0.00032, T: 7740,
    ref: 'Bond et al. 2015' },
  { id: 'eri40B', name: '40 Eridani B', M: 0.573, dM: 0.018, R: 0.01308, dR: 0.00020, T: 17200,
    ref: 'Bond et al. 2017' },
];

// ── equation of state ──────────────────────────────────────────────────────
export function eos(mue = 2) {
  const { me, c, h, mu } = K;
  const A = Math.PI * me ** 4 * c ** 5 / (3 * h ** 3);
  const B = 8 * Math.PI * mue * mu * (me * c) ** 3 / (3 * h ** 3);
  const f = x => x < 1e-3
    ? (8 / 5) * x ** 5 - (4 / 7) * x ** 7          // series: x(2x^2-3)y + 3 asinh x
    : x * (2 * x * x - 3) * Math.sqrt(1 + x * x) + 3 * Math.asinh(x);
  return {
    mue, A, B, f,
    P: x => A * f(x),
    rho: x => B * x ** 3,
    xOf: rho => Math.cbrt(rho / B),
    // Gamma = d ln P / d ln rho = (x f'(x)) / (3 f(x)), f' = 8 x^4 / y
    Gamma: x => x < 1e-3 ? 5 / 3 - (4 / 9) * x * x : (8 * x ** 5 / Math.sqrt(1 + x * x)) / (3 * f(x)),
  };
}

// ── Fermi gas ──────────────────────────────────────────────────────────────
// For electron density n (m^-3): p_F = hbar (3 pi^2 n)^(1/3).
export function fermi(rho, mue = 2) {
  const n = rho / (mue * K.mu);
  const pF = K.hbar * Math.cbrt(3 * Math.PI * Math.PI * n);
  const x = pF / (K.me * K.c);
  const EF = (Math.sqrt(1 + x * x) - 1) * K.mec2;        // kinetic, J
  const E = eos(mue);
  return { n, pF, x, EF, EFMeV: EF / K.MeV, P: E.P(x), Gamma: E.Gamma(x), v: x / Math.sqrt(1 + x * x) };
}

// ── RK4 ────────────────────────────────────────────────────────────────────
// One RK4 step of the system s' = F(t, s), with s = [y, y'] for
// y'' + (2/t) y' + g(y) = 0. This is the step the saver plate shows.
export function rk4Step(t, y, dy, h, g) {
  const F = (t, y, dy) => [dy, -g(y) - 2 * dy / t];
  const [k1y, k1d] = F(t, y, dy);
  const [k2y, k2d] = F(t + h / 2, y + h / 2 * k1y, dy + h / 2 * k1d);
  const [k3y, k3d] = F(t + h / 2, y + h / 2 * k2y, dy + h / 2 * k2d);
  const [k4y, k4d] = F(t + h, y + h * k3y, dy + h * k3d);
  return [y + h / 6 * (k1y + 2 * k2y + 2 * k3y + k4y), dy + h / 6 * (k1d + 2 * k2d + 2 * k3d + k4d)];
}

// Integrate y'' + (2/t) y' + g(y) = 0 from the series start to y = yEnd.
// Returns { t1, y1p, prof: [[t, y], ...] } with the root found by secant
// steps (each a single RK4 step from the last point before the root).
function integrate(g, t0, y0, dy0, h, yEnd, keep = 0) {
  let t = t0, y = y0, dy = dy0;
  const raw = keep ? [[0, 1]] : null;
  for (let guard = 0; guard < 5e6; guard++) {
    const [yn, dyn] = rk4Step(t, y, dy, h, g);
    if (yn <= yEnd) {
      // Secant on s in (0, h]: y(t + s) - yEnd = 0.
      let s0 = 0, f0 = y - yEnd, s1 = h, f1 = yn - yEnd, s = h, d = dyn;
      for (let k = 0; k < 40 && Math.abs(f1) > 1e-15; k++) {
        s = s1 - f1 * (s1 - s0) / (f1 - f0);
        if (!(s > 0 && s <= h)) s = (s0 + s1) / 2;
        const [ys, dys] = rk4Step(t, y, dy, s, g);
        s0 = s1; f0 = f1; s1 = s; f1 = ys - yEnd; d = dys;
      }
      let prof = null;
      if (raw) {
        // Downsample to about keep points, always with the surface point.
        const st = Math.max(1, Math.floor(raw.length / keep));
        prof = raw.filter((_, j) => j % st === 0);
        prof.push([t + s1, yEnd]);
      }
      return { t1: t + s1, y1p: d, prof };
    }
    t += h; y = yn; dy = dyn;
    if (raw) raw.push([t, y]);
  }
  throw new Error('integrate: no surface');
}

// ── Lane-Emden ─────────────────────────────────────────────────────────────
export function laneEmden(n, { h = 1e-3, keep = 0 } = {}) {
  const t0 = 1e-4;
  const y0 = 1 - t0 * t0 / 6 + n * t0 ** 4 / 120, dy0 = -t0 / 3 + n * t0 ** 3 / 30;
  const g = y => y > 0 ? y ** n : 0;
  const r = integrate(g, t0, y0, dy0, h, 0, keep);
  return { n, xi1: r.t1, dtheta1: r.y1p, omega: -r.t1 * r.t1 * r.y1p, prof: r.prof };
}

// ── M_Ch from the formula ──────────────────────────────────────────────────
export function massChandra(mue = 2, { omega3 = 2.01824, perElectron = K.mu } = {}) {
  const { hbar, c, G } = K;
  const M = Math.sqrt(3 * Math.PI) / 2 * omega3 * (hbar * c / G) ** 1.5 / (mue * perElectron) ** 2;
  return { kg: M, Msun: M / K.Msun };
}

// ── one exact white dwarf ──────────────────────────────────────────────────
// xc: central x = p_F / (m_e c). Returns M (Msun), R (m), rhoc, and
// optional profiles r/R -> rho/rhoc and x.
export function whiteDwarf(xc, mue = 2, { keep = 0, steps = 3000 } = {}) {
  const E = eos(mue), { A, B } = E, G = K.G;
  const y0 = Math.sqrt(1 + xc * xc), iy2 = 1 / (y0 * y0), q3 = (1 - iy2) ** 1.5;
  const g = p => { const s = p * p - iy2; return s > 0 ? s ** 1.5 : 0; };
  // Scale of eta near the centre: phi'' ~ -q^3, so phi falls by 1 - 1/y0
  // over eta ~ sqrt(6 (1 - 1/y0) / q^3). The step is a fraction of that.
  const scale = Math.max(1.5, Math.sqrt(6 * (1 - 1 / y0) / q3));
  const h = scale / steps;
  const t0 = h * 1e-2;
  const r = integrate(g, t0, 1 - q3 * t0 * t0 / 6, -q3 * t0 / 3, h, 1 / y0, keep);
  const alpha = Math.sqrt(2 * A / (Math.PI * G)) / (B * y0);
  const Mkg = (8 * A / (B * B * G)) * Math.sqrt(2 * A / (Math.PI * G)) * (-r.t1 * r.t1 * r.y1p);
  const out = { xc, mue, M: Mkg / K.Msun, Mkg, R: alpha * r.t1, rhoc: B * xc ** 3, eta1: r.t1, omega: -r.t1 * r.t1 * r.y1p };
  if (keep) {
    out.prof = r.prof.map(([t, p]) => {
      const x = Math.sqrt(Math.max(0, y0 * y0 * p * p - 1));
      return { s: t / r.t1, x, rho: (x / xc) ** 3 };
    });
  }
  out.rhoMean = out.Mkg / (4 / 3 * Math.PI * out.R ** 3);
  return out;
}

// The curve from low mass (xc = 0.03) to near the limit (xc = 1e3).
export function massRadiusCurve(mue = 2, { n = 120, x0 = 0.03, x1 = 1000 } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const xc = x0 * (x1 / x0) ** (i / (n - 1));
    out.push(whiteDwarf(xc, mue, { steps: 1500 }));
  }
  return out;
}

// Polytrope with P = K rho^(1+1/n), central density rhoc: M, R.
// a^2 = (n+1) K rhoc^(1/n - 1) / (4 pi G),  R = xi1 a,  M = 4 pi a^3 rhoc omega
const LE = new Map();
export function leCached(n) { if (!LE.has(n)) LE.set(n, laneEmden(n)); return LE.get(n); }
export function polytropeMR(n, Kp, rhoc) {
  const L = leCached(n);
  const a = Math.sqrt((n + 1) * Kp * rhoc ** (1 / n - 1) / (4 * Math.PI * K.G));
  return { M: 4 * Math.PI * a ** 3 * rhoc * L.omega / K.Msun, R: L.xi1 * a, rhoc };
}
// The two limits of the electron gas as polytropes.
export function polyK(mue = 2) {
  const { hbar, me, c, mu } = K, m = mue * mu;
  return {
    nr: (3 * Math.PI ** 2) ** (2 / 3) * hbar * hbar / (5 * me * m ** (5 / 3)),   // n = 1.5
    ur: (3 * Math.PI ** 2) ** (1 / 3) * hbar * c / (4 * m ** (4 / 3)),          // n = 3
  };
}
// n = 1.5 radius for a mass (Msun): R = R1 (M / 1)^(-1/3).
export function radiusNR(Msun, mue = 2) {
  const Kn = polyK(mue).nr, p = polytropeMR(1.5, Kn, 1e9);
  return p.R * (p.M / Msun) ** (1 / 3);
}

// Model of a given mass (Msun), by bisection on log xc. null past the limit.
export function dwarfOfMass(Msun, mue = 2, opts = {}) {
  const Mch = massChandra(mue).Msun;
  if (!(Msun > 0) || Msun >= Mch * 0.9995) return null;
  let lo = Math.log(1e-3), hi = Math.log(5e3);
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2, m = whiteDwarf(Math.exp(mid), mue, { steps: 800 }).M;
    if (m < Msun) lo = mid; else hi = mid;
  }
  return whiteDwarf(Math.exp((lo + hi) / 2), mue, opts);
}

// ── energy argument (section 4) ────────────────────────────────────────────
// A uniform ball of N electrons, radius R. Kinetic energy of the full
// relativistic Fermi gas, minus the binding energy alpha_g G M^2 / R.
//   uniform: alpha_g = 3/5 (Landau 1932); its critical mass is 1.20 M_Ch.
//   profile: alpha_g chosen so that the critical mass is M_Ch (the n = 3
//            star is centrally concentrated, so it is more tightly bound).
export function energyModel(mue = 2, mode = 'profile') {
  const { hbar, c, G, me, mu } = K;
  const m = mue * mu;
  const kUR = 0.75 * Math.cbrt(9 * Math.PI / 4);                       // E_k -> kUR hbar c N^(4/3) / R
  const coef = Math.sqrt(3 * Math.PI) / 2 * leCached(3).omega;        // M_Ch / ((hbar c/G)^1.5 / m^2)
  const ag = mode === 'uniform' ? 0.6 : kUR / coef ** (2 / 3);
  const Mcrit = (kUR / ag) ** 1.5 * (hbar * c / G) ** 1.5 / (m * m) / K.Msun;
  const u0 = me ** 4 * c ** 5 / (8 * Math.PI ** 2 * hbar ** 3);        // energy density unit
  // Kinetic energy density of the gas at x (J m^-3), rest mass removed.
  const ukin = x => {
    const n = x ** 3 * (me * c) ** 3 / (3 * Math.PI ** 2 * hbar ** 3);
    if (x < 1e-2) return n * K.mec2 * (0.3 * x * x - (3 / 56) * x ** 4);
    return u0 * (x * (2 * x * x + 1) * Math.sqrt(1 + x * x) - Math.asinh(x)) - n * K.mec2;
  };
  const at = (Msun, R) => {
    const M = Msun * K.Msun, N = M / m, V = 4 / 3 * Math.PI * R ** 3;
    const x = hbar * Math.cbrt(3 * Math.PI ** 2 * N / V) / (me * c);
    const Ek = ukin(x) * V, Eg = -ag * G * M * M / R;
    return { Ek, Eg, E: Ek + Eg, x };
  };
  // Minimum of E on a log grid then golden refinement; null when none.
  const minimum = (Msun, R0 = 1e3, R1 = 1e9) => {
    if (Msun >= Mcrit) return null;
    const N = 400; let bi = -1, bv = Infinity;
    for (let i = 0; i <= N; i++) { const R = R0 * (R1 / R0) ** (i / N), v = at(Msun, R).E; if (v < bv) { bv = v; bi = i; } }
    if (bi <= 0 || bi >= N) return null;
    let a = Math.log(R0) + (bi - 1) / N * Math.log(R1 / R0), b = a + 2 / N * Math.log(R1 / R0);
    const gr = (Math.sqrt(5) - 1) / 2;
    for (let k = 0; k < 80; k++) {
      const c1 = b - gr * (b - a), c2 = a + gr * (b - a);
      if (at(Msun, Math.exp(c1)).E < at(Msun, Math.exp(c2)).E) b = c2; else a = c1;
    }
    const R = Math.exp((a + b) / 2);
    return { R, ...at(Msun, R) };
  };
  return { ag, Mcrit, at, minimum, mode };
}

// ── cosmology (section 6) ──────────────────────────────────────────────────
// Flat universe with Omega_L = 1 - Omega_m. Distance modulus, H0 = 70.
export function distanceModulus(z, OmL, H0 = 70) {
  const Om = 1 - OmL, N = 200, dH = K.c / 1e3 / H0;   // Mpc
  let s = 0;
  for (let i = 0; i < N; i++) {
    const zz = (i + 0.5) / N * z;
    s += 1 / Math.sqrt(Om * (1 + zz) ** 3 + OmL);
  }
  const dL = (1 + z) * dH * s * z / N;                 // Mpc
  return 5 * Math.log10(dL * 1e6 / 10);
}
// The empty (coasting) universe, the usual reference line.
export function distanceModulusEmpty(z, H0 = 70) {
  const dL = K.c / 1e3 / H0 * z * (1 + z / 2);
  return 5 * Math.log10(dL * 1e6 / 10);
}
