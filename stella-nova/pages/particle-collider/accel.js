// ============================================================================
//  PARTICLE COLLIDER  ·  accel.js — the accelerator chain as formulas
// ----------------------------------------------------------------------------
//  No DOM. The plots (accplots.js) and the ring model (ring.js) read it;
//  tests.mjs checks it. SI units unless a name says otherwise (GeV, MV).
//  Parameters are those of the CERN LHC chain in published design reports;
//  the layout of ring.js is a schematic, not a survey.
//
//  CHAIN (grep -n 'export const CHAIN')
//    source -> Linac4 (H-, 160 MeV) -> PS Booster (2 GeV) -> PS (26 GeV/c)
//    -> SPS (450 GeV/c) -> LHC (6.8 TeV). brho(p) = p / (e c); B = brho / rho.
//  LINAC (grep -n 'function linacTrack')
//    Drift-tube cells of length beta lambda at 352.2 MHz. Per cell:
//      dW += q E0 T L (cos(phis + dphi) - cos phis)
//      dphi -= 2 pi L dW / (m c^2 beta^3 gamma^3 lambda)
//    Small amplitudes oscillate with k_l^2 = 2 pi q E0 T sin(-phis) / (m c^2 beta^3 gamma^3 lambda).
//  TRANSVERSE (grep -n 'function fodo')
//    A FODO cell from thin quadrupoles (focal length +-f) and sector
//    dipoles: 2x2 matrices for the Twiss functions beta, alpha and the
//    phase advance mu (cos mu = trace / 2), 3x3 matrices for the
//    periodic dispersion D. Thin-lens checks:
//      beta_max,min = Lc (1 +- sin(mu/2)) / sin mu
//      xi_cell = -tan(mu/2) / pi   (natural chromaticity)
//    Sextupoles at the quadrupoles add (1/4pi) sum k2L D beta (x; minus
//    for y): sextupoleFor() solves the two strengths for a target Q'.
//  LONGITUDINAL (grep -n 'function rfMap' / 'function separatrix')
//    The turn map  d += eV/(beta^2 E) (sin phi - sin phis),
//                  phi += 2 pi h eta d,  eta = alpha_c - 1/gamma^2,
//    Qs = sqrt(h eV |eta cos phis| / (2 pi beta^2 E)), and the separatrix
//    of the Hamiltonian H = pi h eta d^2 + eV/(beta^2 E) (cos phi - cos phis
//    + (phi - phis) sin phis) through the unstable point pi - phis.
//  RAMP (grep -n 'function ramp')
//    The LHC cycle: injection plateau, a parabolic-linear-parabolic ramp,
//    flat top, stable beams, dump and ramp-down. B(t) = p(t) / (e c rho).
//  COLLISIONS (grep -n 'function luminosity')
//    L = f n_b N1 N2 / (4 pi sx sy) * F, F = 1 / sqrt(1 + (theta_c sz / 2 sx)^2),
//    sigma = sqrt(eps_n beta* / gamma), pile-up mu = L sigma_inel / (n_b f).
//  RADIATION (grep -n 'function srLoss')
//    U0 = C_gamma E^4 / rho; C_gamma = 8.846e-5 m/GeV^3 (e), 7.783e-18 (p);
//    critical energy Ec = (3/2) hbar c gamma^3 / rho.
//  DUMP (grep -n 'function dump')
//    Stored energy n_b N E; the dilution sweep that paints the beam on the
//    graphite block in an 'e' shape over 86 us.
// ============================================================================
export const CLIGHT = 299792458, QE = 1.602176634e-19, MP = 0.93827208816, ME_GEV = 0.51099895e-3;
export const HBARC = 197.3269804e-9;   // eV m
export const TAU = Math.PI * 2;

export const brho = pGeV => pGeV / 0.299792458;   // T m
export const pOfT = (TGeV, m = MP) => Math.sqrt(TGeV * (TGeV + 2 * m));

// ── the chain ─────────────────────────────────────────────────────────────
export const CHAIN = [
  { id: 'source', name: 'Ion source', kind: 'H⁻ source', ion: 'H⁻', T: 45e-6, len: 3, note: 'A plasma source makes H⁻ ions (a proton with two electrons) and pulls them out at 45 keV.' },
  { id: 'linac', name: 'Linac4', kind: 'Linear accelerator', ion: 'H⁻', T: 0.160, len: 86, fRF: 352.2e6, note: 'RFQ, drift-tube and coupled-cavity sections bring the ions to 160 MeV. Each bunch rides the RF wave just before its crest.' },
  { id: 'psb', name: 'PS Booster', kind: 'Synchrotron, 4 rings', T: 2.0, C: 157.08, rho: 8.239, note: 'Stripping foils take both electrons off: the protons stack in four small rings and reach 2 GeV.' },
  { id: 'ps', name: 'Proton Synchrotron', kind: 'Synchrotron', p: 26, C: 628.32, rho: 70.079, note: 'RF gymnastics split each bunch into the 25 ns bunch train that the collider needs.' },
  { id: 'sps', name: 'Super Proton Synchrotron', kind: 'Synchrotron', p: 450, C: 6911.5, rho: 741.3, note: 'Trains of up to 288 bunches go to 450 GeV and into the collider through two transfer lines.' },
  { id: 'lhc', name: 'Collider ring', kind: 'Two-beam synchrotron', p: 6800, C: 26658.883, rho: 2803.95, note: '1232 superconducting dipoles at 1.9 K bend two counter-rotating beams. They cross at four interaction points.' },
];
export function chainTable() {
  return CHAIN.map(s => {
    const p = s.p ?? pOfT(s.T, s.ion === 'H⁻' ? MP + 2 * ME_GEV : MP), m = MP, E = Math.hypot(p, m);
    const g = E / m, b = p / E;
    return { ...s, pGeV: p, E, gamma: g, beta: b, brho: brho(p), B: s.rho ? brho(p) / s.rho : 0, frev: s.C ? b * CLIGHT / s.C : 0 };
  });
}

// ── LHC parameters (presets) ──────────────────────────────────────────────
export const LHC = {
  C: 26658.883, rho: 2803.95, h: 35640, fRF: 400.789e6, alphaC: 3.225e-4,
  nDipole: 1232, cellL: 106.9, arcCells: 23, arcs: 8, Qx: 64.31, Qy: 59.32, Einj: 450,
};
export const PRESETS = {
  design: { name: 'Design (7 TeV)', E: 7000, nb: 2808, N: 1.15e11, epsN: 3.75e-6, betaStar: 0.55, thetaC: 285e-6, sigZ: 0.0755, V: 16, sigInel: 80 },
  run3: { name: 'Run 3 (6.8 TeV)', E: 6800, nb: 2748, N: 1.6e11, epsN: 2.5e-6, betaStar: 0.30, thetaC: 320e-6, sigZ: 0.076, V: 12, sigInel: 80 },
  hl: { name: 'High-luminosity (7 TeV)', E: 7000, nb: 2760, N: 2.2e11, epsN: 2.5e-6, betaStar: 0.15, thetaC: 500e-6, sigZ: 0.076, V: 16, sigInel: 81 },
};

// ── linac longitudinal dynamics ───────────────────────────────────────────
// E0T in V/m, phis in rad (negative: before the crest), W in MeV
export function linacParams(W = 50, E0T = 3.0e6, phis = -30 * Math.PI / 180, f = 352.2e6, mMeV = 939.29) {
  const g = 1 + W / mMeV, b = Math.sqrt(1 - 1 / (g * g)), lam = CLIGHT / f, L = b * lam;
  const kl2 = TAU * E0T * Math.sin(-phis) / (mMeV * 1e6 * b ** 3 * g ** 3 * lam);   // per metre^2
  return { W, E0T, phis, f, m: mMeV, gamma: g, beta: b, lam, L, gain: E0T * L * Math.cos(phis) / 1e6, kl: Math.sqrt(kl2), muCell: Math.sqrt(kl2) * L };
}
// track particles [[dphi, dW(MeV)], ...] through n cells; returns history
export function linacTrack(P, parts, n) {
  const out = parts.map(p => [p.slice()]);
  const { E0T, phis, L, m, beta: b, gamma: g, lam } = P;
  for (let k = 0; k < n; k++) for (let i = 0; i < parts.length; i++) {
    const q = parts[i];
    q[1] += E0T * L * (Math.cos(phis + q[0]) - Math.cos(phis)) / 1e6;
    q[0] -= TAU * L * q[1] / (m * b ** 3 * g ** 3 * lam);
    out[i].push(q.slice());
  }
  return out;
}

// ── 2x2 and 3x3 matrix helpers ────────────────────────────────────────────
const mul2 = (A, B) => [[A[0][0] * B[0][0] + A[0][1] * B[1][0], A[0][0] * B[0][1] + A[0][1] * B[1][1]], [A[1][0] * B[0][0] + A[1][1] * B[1][0], A[1][0] * B[0][1] + A[1][1] * B[1][1]]];
const mul3 = (A, B) => A.map((r, i) => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const drift = L => [[1, L], [0, 1]];
const lens = f => [[1, 0], [-1 / f, 1]];
const drift3 = L => [[1, L, 0], [0, 1, 0], [0, 0, 1]];
const lens3 = f => [[1, 0, 0], [-1 / f, 1, 0], [0, 0, 1]];
const bend3 = (L, th) => { if (!th) return drift3(L); const r = L / th; return [[Math.cos(th), r * Math.sin(th), r * (1 - Math.cos(th))], [-Math.sin(th) / r, Math.cos(th), Math.sin(th)], [0, 0, 1]]; };

// ── FODO cell ─────────────────────────────────────────────────────────────
// Lc: cell length; mu: phase advance (rad); theta: bend per half cell.
// Elements from the centre of QF: QF/2, bend L/2, QD, bend L/2, QF/2.
export function fodo(Lc = LHC.cellL, mu = Math.PI / 2, theta = TAU / LHC.nDipole * 3, nS = 120) {
  const L = Lc / 2, f = L / (2 * Math.sin(mu / 2));
  // x sees QF focusing (f), y sees it defocusing (-f)
  const plane = sgn => {
    const seq = [['q', 2 * f * sgn], ['d', L], ['q', -f * sgn], ['d', L], ['q', 2 * f * sgn]];
    let M = [[1, 0], [0, 1]]; for (const [k, v] of seq) M = mul2(k === 'q' ? lens(v) : drift(v), M);
    const c = (M[0][0] + M[1][1]) / 2, s = Math.sign(M[0][1]) * Math.sqrt(1 - c * c);
    const b0 = M[0][1] / s, a0 = (M[0][0] - M[1][1]) / (2 * s);
    // sample beta and the phase along the cell
    const pts = []; let B = b0, A = a0, G = (1 + a0 * a0) / b0, psi = 0;
    const step = (Mi) => { const [[m11, m12], [m21, m22]] = Mi; const nb = m11 * m11 * B - 2 * m11 * m12 * A + m12 * m12 * G, na = -m11 * m21 * B + (m11 * m22 + m12 * m21) * A - m12 * m22 * G; psi += Math.atan2(m12, m11 * B - m12 * A); B = nb; A = na; G = (1 + A * A) / B; };
    let s0 = 0; pts.push([0, B, A, 0]);
    step(lens(2 * f * sgn));
    for (const [half, fq] of [[1, -f * sgn], [2, 2 * f * sgn]]) {
      for (let i = 0; i < nS / 2; i++) { step(drift(L / (nS / 2))); s0 += L / (nS / 2); pts.push([s0, B, A, psi]); }
      if (half === 1) step(lens(fq));
    }
    return { mu: Math.acos(c), beta0: b0, alpha0: a0, pts, M };
  };
  const X = plane(1), Y = plane(-1);
  // periodic dispersion from the 3x3 cell map
  const seq3 = [lens3(2 * f), bend3(L, theta), lens3(-f), bend3(L, theta), lens3(2 * f)];
  let M3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]; for (const E of seq3) M3 = mul3(E, M3);
  const a = 1 - M3[0][0], b = -M3[0][1], c = -M3[1][0], d = 1 - M3[1][1], det = a * d - b * c;
  const D0 = (d * M3[0][2] - b * M3[1][2]) / det, Dp0 = (a * M3[1][2] - c * M3[0][2]) / det;
  // D along the cell
  const Dpts = []; let v = [D0, Dp0, 1], s = 0; Dpts.push([0, D0]);
  v = [v[0], v[1] - v[0] / (2 * f), 1];
  for (const [half, fq] of [[1, -f], [2, 2 * f]]) {
    for (let i = 0; i < nS / 2; i++) { const B = bend3(L / (nS / 2), theta / (nS / 2)); v = [B[0][0] * v[0] + B[0][1] * v[1] + B[0][2], B[1][0] * v[0] + B[1][1] * v[1] + B[1][2], 1]; s += L / (nS / 2); Dpts.push([s, v[0]]); }
    if (half === 1) v = [v[0], v[1] - v[0] / fq, 1];
  }
  const Dmax = Math.max(...Dpts.map(p => p[1])), Dmin = Math.min(...Dpts.map(p => p[1]));
  const betaMax = Math.max(...X.pts.map(p => p[1])), betaMin = Math.min(...X.pts.map(p => p[1]));
  // natural chromaticity of the cell: -(1/4pi) sum beta / f_signed
  const xiX = -(X.beta0 / f - X.pts[nS / 2][1] / f) / (2 * TAU), xiY = -(-Y.beta0 / f + Y.pts[nS / 2][1] / f) / (2 * TAU);
  return { Lc, L, f, theta, mu: X.mu, muY: Y.mu, X, Y, betaMax, betaMin, D0, Dmax, Dmin, Dpts, xiX, xiY, betaD: X.pts[nS / 2][1], betaFy: Y.pts[nS / 2][1] };
}
// the two sextupole strengths (k2 L at QF and at QD) for a target Q' per cell
export function sextupoleFor(cell, targetX, targetY) {
  const Df = cell.D0, Dd = cell.Dmin, bxF = cell.X.beta0, bxD = cell.betaD, byF = cell.Y.beta0, byD = cell.betaFy;
  // (1/4pi) [ SF Df bxF + SD Dd bxD ] = targetX - xiX ;  -(1/4pi) [ SF Df byF + SD Dd byD ] = targetY - xiY
  const a = Df * bxF / (2 * TAU), b = Dd * bxD / (2 * TAU), c = -Df * byF / (2 * TAU), d = -Dd * byD / (2 * TAU);
  const rx = targetX - cell.xiX, ry = targetY - cell.xiY, det = a * d - b * c;
  return { SF: (rx * d - b * ry) / det, SD: (a * ry - c * rx) / det };
}
// one-cell tune of an off-momentum particle (quads scale 1/(1+d), sextupoles
// focus with k2 L D d), for the chromaticity check and the tune-shift plot
export function cellTune(cell, delta, sx = { SF: 0, SD: 0 }) {
  const f = cell.f, L = cell.L, df = cell.D0 * delta, dd = cell.Dmin * delta;
  const one = (sgn, s) => {
    const kF = sgn / (2 * f) / (1 + delta) + s * sx.SF * df / 2, kD = -sgn / f / (1 + delta) + s * sx.SD * dd;
    const seq = [lens(1 / kF), drift(L), lens(1 / kD), drift(L), lens(1 / kF)];
    let M = [[1, 0], [0, 1]]; for (const E of seq) M = mul2(E, M);
    return Math.acos(Math.max(-1, Math.min(1, (M[0][0] + M[1][1]) / 2))) / TAU;
  };
  return { qx: one(1, 1), qy: one(-1, -1) };
}

// ── betatron motion (one-turn map with a thin sextupole: the Henon map) ───
export function henon(q, k2, x0, n, beta = 1) {
  const c = Math.cos(TAU * q), s = Math.sin(TAU * q), out = [];
  let x = x0[0], p = x0[1];
  for (let i = 0; i < n; i++) {
    out.push([x, p]);
    const pk = p + k2 * x * x;
    const nx = c * x + s * beta * pk, np = -s / beta * x + c * pk;
    x = nx; p = np;
    if (Math.abs(x) > 1e3) break;
  }
  return out;
}
// the fractional tune of a turn-by-turn record (phase advance per turn)
export function measureTune(rec) {
  let sum = 0;
  for (let i = 1; i < rec.length; i++) {
    const a0 = Math.atan2(-rec[i - 1][1], rec[i - 1][0]), a1 = Math.atan2(-rec[i][1], rec[i][0]);
    let d = a1 - a0; while (d < 0) d += TAU; while (d >= TAU) d -= TAU; sum += d;
  }
  return sum / (rec.length - 1) / TAU;
}
// resonance lines m Qx + n Qy = p in the unit square, |m| + |n| <= order
export function resonances(order = 5) {
  const out = [];
  for (let m = -order; m <= order; m++) for (let n = -order; n <= order; n++) {
    const o = Math.abs(m) + Math.abs(n);
    if (!o || o > order || (m < 0) || (m === 0 && n < 0)) continue;
    for (let p = -order * 2; p <= order * 2; p++) out.push({ m, n, p, o });
  }
  return out;
}

// ── longitudinal motion ───────────────────────────────────────────────────
// E in GeV, V in MV; returns the parameters of the turn map
export function rfParams(EGeV, VMV = 16, dEturnMeV = 0, h = LHC.h, alphaC = LHC.alphaC, m = MP) {
  const g = EGeV / m, b2 = 1 - 1 / (g * g), eta = alphaC - 1 / (g * g);
  const sinS = dEturnMeV / VMV, phis = eta > 0 ? Math.PI - Math.asin(sinS) : Math.asin(sinS);
  const k = VMV * 1e-3 / (b2 * EGeV);      // eV / (beta^2 E)
  const Qs = Math.sqrt(h * VMV * 1e6 * Math.abs(eta * Math.cos(phis)) / (TAU * b2 * EGeV * 1e9));
  const dmax0 = Math.sqrt(2 * VMV * 1e6 / (Math.PI * b2 * EGeV * 1e9 * h * Math.abs(eta)));
  return { E: EGeV, V: VMV, h, eta, gamma: g, phis, k, Qs, dmax0 };
}
export function rfMap(P, pts, n = 1) {
  for (let t = 0; t < n; t++) for (const q of pts) {
    q[1] += P.k * (Math.sin(q[0]) - Math.sin(P.phis));
    q[0] += TAU * P.h * P.eta * q[1];
  }
  return pts;
}
export function rfH(P, phi, d) { return Math.PI * P.h * P.eta * d * d + P.k * (Math.cos(phi) - Math.cos(P.phis) + (phi - P.phis) * Math.sin(P.phis)); }
// separatrix: d(phi) for the phi range of the bucket (upper branch)
export function separatrix(P, n = 240) {
  const phu = Math.PI - P.phis, Hs = rfH(P, phu, 0), out = [];
  const lo = Math.min(P.phis, phu) - Math.PI, hi = Math.max(P.phis, phu) + Math.PI;
  for (let i = 0; i <= n; i++) {
    const ph = lo + (hi - lo) * i / n, v = (Hs - P.k * (Math.cos(ph) - Math.cos(P.phis) + (ph - P.phis) * Math.sin(P.phis))) / (Math.PI * P.h * P.eta);
    out.push([ph, v >= 0 ? Math.sqrt(v) : NaN]);
  }
  return { pts: out, phu, Hs };
}

// ── the ramp ──────────────────────────────────────────────────────────────
// segments in seconds: injection plateau, ramp, flat top (squeeze), stable
// beams, dump, ramp down. p(t) in GeV/c; parabolic ends of tp seconds.
export const CYCLE = { inj: 1800, ramp: 1200, flat: 900, stable: 36000, down: 1200, tp: 180 };
export function ramp(t, Ein = LHC.Einj, Etop = 6800, c = CYCLE) {
  const t1 = c.inj, t2 = t1 + c.ramp, t3 = t2 + c.flat, t4 = t3 + c.stable, t5 = t4 + c.down;
  const lin = (u, T, tp) => {           // parabolic-linear-parabolic from 0 to 1 over T
    const r = 1 / (T - tp);             // the slope of the linear part
    if (u <= 0) return 0; if (u >= T) return 1;
    if (u < tp) return r * u * u / (2 * tp);
    if (u > T - tp) return 1 - r * (T - u) ** 2 / (2 * tp);
    return r * (u - tp / 2);
  };
  let p, phase;
  if (t < t1) { p = Ein; phase = 'injection'; }
  else if (t < t2) { p = Ein + (Etop - Ein) * lin(t - t1, c.ramp, c.tp); phase = 'ramp'; }
  else if (t < t3) { p = Etop; phase = 'flat top · squeeze'; }
  else if (t < t4) { p = Etop; phase = 'stable beams'; }
  else if (t < t5) { p = Etop - (Etop - Ein) * lin(t - t4, c.down, c.tp); phase = 'ramp down'; }
  else { p = Ein; phase = 'injection'; }
  return { p, B: brho(p) / LHC.rho, phase, T: t5, marks: [0, t1, t2, t3, t4, t5] };
}
export function rampRate(t, dt = 1) { return (ramp(t + dt).p - ramp(t - dt).p) / (2 * dt); }   // GeV/s

// ── luminosity ────────────────────────────────────────────────────────────
export function luminosity(o) {
  const g = o.E / MP, sig = Math.sqrt(o.epsN * o.betaStar / g), f = CLIGHT / LHC.C * Math.sqrt(1 - 1 / (g * g));
  const F = 1 / Math.sqrt(1 + (o.thetaC * o.sigZ / (2 * sig)) ** 2);
  const L0 = f * o.nb * o.N * o.N / (4 * Math.PI * sig * sig);   // m^-2 s^-1
  const L = L0 * F * 1e-4;                                     // cm^-2 s^-1
  const mu = L * o.sigInel * 1e-27 / (o.nb * f);
  return { sigma: sig, f, F, L, L0: L0 * 1e-4, mu, rate: L * o.sigInel * 1e-27, stored: o.nb * o.N * o.E * 1e9 * QE };
}

// ── synchrotron radiation ─────────────────────────────────────────────────
export const C_GAMMA = { e: 8.846e-5, p: 8.846e-5 * (ME_GEV / MP) ** 4 };   // m / GeV^3
export function srLoss(EGeV, rho, sp = 'p') {
  const m = sp === 'e' ? ME_GEV : MP, g = EGeV / m;
  return { U0: C_GAMMA[sp] * EGeV ** 4 / rho * 1e9, Ec: 1.5 * HBARC * g ** 3 / rho, gamma: g };   // eV, eV
}

// ── beam dump ─────────────────────────────────────────────────────────────
// dilution sweep: two kicker families at 14.2 kHz (h) and 12.7 kHz (v) whose
// amplitude falls over the 86 us of the beam; positions in cm on the block
export function dump(o, n = 900) {
  const T = LHC.C / CLIGHT, pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / n * T, a = 1 - 0.55 * t / T;
    pts.push([35 * a * Math.sin(TAU * 14.2e3 * t), 35 * a * Math.cos(TAU * 12.7e3 * t) * 0.9, t]);
  }
  return { stored: o.nb * o.N * o.E * 1e9 * QE, turn: T, gap: 3e-6, pts };
}

// ── layout of the ring for ring.js: 8 arcs, 8 straight sections ───────────
export const IPS = [
  { n: 1, kind: 'ip', label: 'IP1 · interaction point' }, { n: 2, kind: 'ip', label: 'IP2 · interaction point · injection' },
  { n: 3, kind: 'col', label: 'Point 3 · momentum cleaning' }, { n: 4, kind: 'rf', label: 'Point 4 · RF cavities' },
  { n: 5, kind: 'ip', label: 'IP5 · interaction point · the detector on this page' }, { n: 6, kind: 'dump', label: 'Point 6 · beam dump' },
  { n: 7, kind: 'col', label: 'Point 7 · betatron cleaning' }, { n: 8, kind: 'ip', label: 'IP8 · interaction point · injection' },
];
