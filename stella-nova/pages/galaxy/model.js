// ============================================================================
//  GALAXY  ·  model.js — the physical model of one galaxy (no DOM, no GPU)
// ----------------------------------------------------------------------------
//  Units: length in kpc, speed in km/s, time in Myr. tests.mjs imports this
//  file, and engine.js packs its output into GPU buffers.
//
//  PROFILES
//    Sersic bulge, surface    I(R) = I_e exp(-b_n ((R/r_e)^(1/n) - 1))
//    Sersic bulge, volume     rho(r) = rho_0 (r/r_e)^-p exp(-b_n (r/r_e)^(1/n))
//                             (Prugniel and Simien 1997), triaxial: r is the
//                             ellipsoidal radius sqrt(x^2 + y^2/q^2 + z^2/c^2)
//    exponential disk         rho(R, z) = rho_0 exp(-R/R_d) exp(-|z|/h_z)
//    log spiral arm           r = a e^(b theta), b = tan(pitch); the arms turn
//                             as one rigid pattern at Omega_p
//    rotation curve           v(R) = v_flat R / sqrt(R^2 + R_t^2), flat past R_t
//    star colour              Planck spectrum x CIE 1931 (Wyman 2013 fit) -> sRGB
//
//  A galaxy is a parameter object (PRESETS or randomParams). buildGalaxy
//  turns it into
//    gals   Float32Array, GAL_FLOATS per galaxy: the volume uniforms
//    stars  Float32Array, STAR_FLOATS per star: the point-sprite instances
//  Interacting pairs run a restricted three-body model (Toomre and Toomre
//  1972) in tidalPair: two point masses on a parabolic orbit and test
//  stars in two disks.
//
//  EXPORTS (grep -n "^export" model.js)
//    sersicB sersicI sersicTotal sersicRho sersicRhoTotal prugnielP gammaFn
//    diskRho diskTotal vcirc omega armAzimuth spiralRadius blackbodyRGB
//    TYPES PRESETS randomParams buildGalaxy packGalaxy tidalPair rng
//    GAL_FLOATS STAR_FLOATS OFF
// ============================================================================

export const KMS_KPC = 1.0227e-3;          // 1 km/s/kpc in rad/Myr
export const GAL_VEC4 = 24, GAL_FLOATS = GAL_VEC4 * 4;
export const STAR_FLOATS = 16;             // four vec4 per star
// Float offsets inside one galaxy block that the engine patches per frame.
export const OFF = { phase: 8 * 4 + 1 };   // arms2.y = Omega_p t (block 8 is arms2)

// ── random numbers ──────────────────────────────────────────────────────────
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  const f = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  f.gauss = () => { const u = Math.max(1e-9, f()), v = f(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307 * v); };
  f.range = (a0, a1) => a0 + (a1 - a0) * f();
  return f;
}

// ── special functions ───────────────────────────────────────────────────────
// Lanczos approximation, good to about 1e-13 for x > 0.
export function gammaFn(x) {
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gammaFn(1 - x));
  x -= 1; let a = c[0]; const t = x + g + 0.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a;
}

// ── Sersic ──────────────────────────────────────────────────────────────────
// b_n so that r_e holds half the light (Ciotti and Bertin 1999 series).
export function sersicB(n) {
  return 2 * n - 1 / 3 + 4 / (405 * n) + 46 / (25515 * n * n) + 131 / (1148175 * n ** 3) - 2194697 / (30690717750 * n ** 4);
}
export function sersicI(R, Ie, re, n) { return Ie * Math.exp(-sersicB(n) * (Math.pow(R / re, 1 / n) - 1)); }
// Total light of the surface profile: 2 pi n I_e r_e^2 e^b b^-2n Gamma(2n).
export function sersicTotal(Ie, re, n) { const b = sersicB(n); return 2 * Math.PI * n * Ie * re * re * Math.exp(b) * Math.pow(b, -2 * n) * gammaFn(2 * n); }
// Prugniel and Simien (1997) exponent of the volume profile.
export function prugnielP(n) { return 1 - 0.6097 / n + 0.05463 / (n * n); }
export function sersicRho(r, rho0, re, n) { const b = sersicB(n), x = r / re; return rho0 * Math.pow(x, -prugnielP(n)) * Math.exp(-b * Math.pow(x, 1 / n)); }
// Total light of the volume profile, triaxial axis ratios q and c:
// 4 pi q c rho_0 r_e^3 n b^-n(3-p) Gamma(n(3-p)).
export function sersicRhoTotal(rho0, re, n, q = 1, c = 1) {
  const b = sersicB(n), p = prugnielP(n);
  return 4 * Math.PI * q * c * rho0 * re ** 3 * n * Math.pow(b, -n * (3 - p)) * gammaFn(n * (3 - p));
}

// ── exponential disk ────────────────────────────────────────────────────────
export function diskRho(R, z, rho0, Rd, hz) { return rho0 * Math.exp(-R / Rd - Math.abs(z) / hz); }
export function diskTotal(rho0, Rd, hz) { return 4 * Math.PI * rho0 * Rd * Rd * hz; }

// ── rotation ────────────────────────────────────────────────────────────────
export function vcirc(R, vflat, Rt) { return vflat * R / Math.sqrt(R * R + Rt * Rt); }
// Angular speed in rad/Myr.
export function omega(R, vflat, Rt) { return vflat / Math.sqrt(R * R + Rt * Rt) * KMS_KPC; }

// ── spiral arms ─────────────────────────────────────────────────────────────
// Azimuth of arm k (of m) at radius R and pattern phase Omega_p t. The arms
// trail: the azimuth falls as R grows, by ln(R/R0)/tan(pitch).
export function armAzimuth(R, R0, pitchDeg, k = 0, m = 2, phaseP = 0) {
  return phaseP + 2 * Math.PI * k / m - Math.log(R / R0) / Math.tan(pitchDeg * Math.PI / 180);
}
// r = a e^(b theta), b = tan(pitch), theta measured against the rotation.
export function spiralRadius(theta, a, pitchDeg) { return a * Math.exp(Math.tan(pitchDeg * Math.PI / 180) * theta); }

// ── blackbody colour ────────────────────────────────────────────────────────
// CIE 1931 colour matching functions, multi-lobe Gaussian fit (Wyman, Sloan
// and Shirley 2013).
function lobe(l, mu, s1, s2) { const t = (l - mu) / (l < mu ? s1 : s2); return Math.exp(-0.5 * t * t); }
function cmf(l) {
  return [
    1.056 * lobe(l, 599.8, 37.9, 31.0) + 0.362 * lobe(l, 442.0, 16.0, 26.7) - 0.065 * lobe(l, 501.1, 20.4, 26.2),
    0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1),
    1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8),
  ];
}
const BB_CACHE = new Map();
// Linear sRGB of a blackbody at T kelvin, scaled so the largest channel is 1.
export function blackbodyRGB(T) {
  const key = Math.round(T);
  if (BB_CACHE.has(key)) return BB_CACHE.get(key);
  let X = 0, Y = 0, Z = 0;
  for (let l = 380; l <= 780; l += 5) {
    const B = Math.pow(l, -5) / (Math.exp(1.4388e7 / (l * T)) - 1);
    const c = cmf(l); X += B * c[0]; Y += B * c[1]; Z += B * c[2];
  }
  let r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z, g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z, b = 0.0557 * X - 0.2040 * Y + 1.0570 * Z;
  r = Math.max(0, r); g = Math.max(0, g); b = Math.max(0, b);
  const m = Math.max(r, g, b) || 1;
  const out = [r / m, g / m, b / m];
  if (BB_CACHE.size < 4096) BB_CACHE.set(key, out);
  return out;
}

// ── galaxy types and presets ────────────────────────────────────────────────
export const TYPES = [
  { key: 'grand', name: 'Grand-design spiral', hubble: 'Sc' },
  { key: 'barred', name: 'Barred spiral', hubble: 'SBb' },
  { key: 'flocculent', name: 'Flocculent spiral', hubble: 'Sc' },
  { key: 'elliptical', name: 'Elliptical', hubble: 'E' },
  { key: 'lenticular', name: 'Lenticular', hubble: 'S0' },
  { key: 'irregular', name: 'Irregular', hubble: 'Irr' },
  { key: 'pair', name: 'Interacting pair', hubble: 'pec' },
];

// One parameter object. Light totals are in arbitrary units; the ratios
// matter (B/T is bulge / total).
function base() {
  return {
    type: 'grand', name: '', sub: '', seed: 1,
    Rd: 3, hz: 0.28, thickRd: 3.6, thickHz: 0.9, thickFrac: 0.12,
    BT: 0.15, n: 2, re: 0.8, q: 0.85, c: 0.7,
    m: 2, pitch: 16, armAmp: 0.85, sharp: 3, R0: 1.5, minor: 0, flocc: 0,
    bar: 0, barA: 4, barB: 1.1, barDust: 0,
    tau: 1.2, dustRd: 3.6, dustHz: 0.13, lane: 2.2, laneOff: 0.45, filament: 0.8, ringR: 0, ringW: 1, ringTau: 0, hole: 0,
    young: 0.22, hii: 1, irr: 0,
    vflat: 220, Rt: 1.4, corot: 2.6,
    halo: 0.03, rh: 6, nGC: 120,
    jet: 0, companion: null,
    incl: 35, pa: 0,
  };
}
export const PRESETS = [
  { key: 'milkyway', label: 'Milky Way-like', type: 'barred', name: 'A Milky Way-like barred spiral', sub: 'SBbc · a 5 kpc bar, two major and two minor arms',
    Rd: 2.6, hz: 0.3, thickRd: 2.2, thickHz: 0.9, BT: 0.16, n: 1.3, re: 0.75, q: 0.6, c: 0.55,
    m: 2, pitch: 12, armAmp: 0.8, sharp: 2.6, minor: 0.55, bar: 0.11, barA: 4.6, barB: 1.3, barDust: 1.2,
    tau: 1.1, dustRd: 3.4, lane: 2.0, young: 0.24, hii: 1.0, vflat: 230, Rt: 1.2, corot: 2.4, nGC: 150, incl: 40 },
  { key: 'm51', label: 'M51-like', type: 'grand', name: 'A grand-design spiral, M51-like', sub: 'SAbc · two density-wave arms and a small companion',
    Rd: 3.0, BT: 0.1, n: 2.2, re: 0.55, m: 2, pitch: 19, armAmp: 0.95, sharp: 3.6, R0: 1.2,
    tau: 1.5, lane: 2.8, filament: 0.9, young: 0.3, hii: 1.4, vflat: 210, corot: 3.0, incl: 22,
    companion: { kind: 'lenticular', at: [11.5, 4.5, -2.5], tilt: 58, scale: 0.45, L: 0.35 } },
  { key: 'm87', label: 'M87-like', type: 'elliptical', name: 'A giant elliptical, M87-like', sub: 'E0-1 · a de Vaucouleurs bulge, a jet and a swarm of globular clusters',
    BT: 1, n: 4, re: 6.5, q: 0.92, c: 0.82, tau: 0, young: 0, hii: 0, halo: 0.06, rh: 14, nGC: 1400, vflat: 120, Rt: 3, jet: 1, incl: 60 },
  { key: 'sombrero', label: 'Sombrero-like', type: 'lenticular', name: 'An edge-on Sa with a dust ring, Sombrero-like', sub: 'SAa · a huge bulge cut by a ring of dust',
    Rd: 3.6, hz: 0.25, BT: 0.7, n: 4, re: 2.2, q: 0.9, c: 0.72, armAmp: 0.18, m: 2, pitch: 6, sharp: 1.5,
    tau: 1.6, dustRd: 6, dustHz: 0.16, lane: 0.6, ringR: 6.4, ringW: 1.2, ringTau: 5.5, hole: 4.6, filament: 0.6,
    young: 0.05, hii: 0.15, halo: 0.05, rh: 9, nGC: 650, vflat: 300, Rt: 0.9, incl: 84 },
  { key: 'ngc1300', label: 'NGC 1300-like', type: 'barred', name: 'A strongly barred spiral, NGC 1300-like', sub: 'SBbc · a 6 kpc bar with dust lanes on its leading edges',
    Rd: 3.6, BT: 0.12, n: 1.6, re: 0.7, m: 2, pitch: 17, armAmp: 0.92, sharp: 3.2, bar: 0.18, barA: 6, barB: 1.1, barDust: 2.2,
    tau: 1.2, dustRd: 4, lane: 2.4, young: 0.26, hii: 1.2, vflat: 220, corot: 2.0, incl: 30 },
  { key: 'flocculent', label: 'Flocculent', type: 'flocculent', name: 'A flocculent spiral, NGC 2841-like', sub: 'SAb · short arm fragments, no global density wave',
    Rd: 2.8, BT: 0.18, n: 2.5, re: 0.7, m: 5, pitch: 24, armAmp: 0.75, sharp: 2.2, flocc: 0.85,
    tau: 1.4, lane: 1.2, filament: 1.0, young: 0.26, hii: 1.0, vflat: 250, corot: 3, incl: 48 },
  { key: 'antennae', label: 'Interacting pair', type: 'pair', name: 'An interacting pair with tidal tails', sub: 'Two disks after a close prograde pass, Antennae-like',
    Rd: 2.2, BT: 0.14, n: 1.5, re: 0.6, m: 2, pitch: 18, armAmp: 0.5, sharp: 2, tau: 0.9, lane: 1.2, young: 0.3, hii: 1.5, vflat: 200, incl: 30 },
];

// A random galaxy of one type. The ranges cover real galaxies of that type.
export function randomParams(type, seed) {
  const r = rng(seed * 7919 + 13), P = base();
  P.type = type; P.seed = seed;
  const t = TYPES.find(x => x.key === type) || TYPES[0];
  P.name = t.name; P.sub = 'seed ' + seed;
  P.Rd = r.range(2.2, 4.2); P.dustRd = P.Rd * r.range(1.1, 1.4); P.thickRd = P.Rd * 0.85;
  P.pitch = r.range(10, 26); P.vflat = r.range(170, 280); P.incl = r.range(20, 70); P.pa = r.range(0, 360);
  if (type === 'grand') { P.m = r() < 0.8 ? 2 : 3; P.armAmp = r.range(0.8, 0.98); P.sharp = r.range(2.6, 4); P.BT = r.range(0.06, 0.2); P.n = r.range(1.5, 3); P.hii = r.range(1, 1.6); P.tau = r.range(1, 1.8); }
  if (type === 'barred') { P.m = 2; P.bar = r.range(0.08, 0.2); P.barA = P.Rd * r.range(1.2, 1.9); P.barB = r.range(0.9, 1.4); P.barDust = r.range(0.8, 2.4); P.minor = r() < 0.5 ? r.range(0.3, 0.6) : 0; P.armAmp = r.range(0.75, 0.95); P.sharp = r.range(2.4, 3.6); P.BT = r.range(0.08, 0.2); P.n = r.range(1.1, 2); P.corot = P.barA / P.Rd * 1.15; }
  if (type === 'flocculent') { P.m = 4 + Math.floor(r() * 4); P.flocc = r.range(0.7, 0.95); P.armAmp = r.range(0.6, 0.85); P.BT = r.range(0.1, 0.25); P.filament = r.range(0.8, 1.1); }
  if (type === 'elliptical') { Object.assign(P, { BT: 1, n: r.range(3.2, 5.5), re: r.range(2.5, 8), q: r.range(0.55, 0.98), c: r.range(0.45, 0.85), tau: 0, young: 0, hii: 0, armAmp: 0, halo: 0.05, rh: r.range(8, 16), nGC: Math.floor(r.range(250, 1300)), vflat: r.range(60, 160), Rt: 3 }); P.c = Math.min(P.c, P.q); }
  if (type === 'lenticular') { Object.assign(P, { BT: r.range(0.35, 0.6), n: r.range(2.5, 4), re: r.range(0.8, 1.8), armAmp: 0, tau: r.range(0.05, 0.4), lane: 0, young: 0.02, hii: 0, nGC: Math.floor(r.range(100, 400)) }); }
  if (type === 'irregular') { Object.assign(P, { Rd: r.range(1.2, 2.2), BT: 0.02, n: 1, re: 0.5, armAmp: 0, irr: r.range(0.7, 1), young: r.range(0.35, 0.5), hii: r.range(1.6, 2.4), tau: r.range(0.3, 0.8), lane: 0, vflat: r.range(50, 90), Rt: 2, nGC: 20, hz: 0.45 }); P.dustRd = P.Rd * 1.2; P.thickRd = P.Rd; }
  if (type === 'pair') { Object.assign(P, PRESETS.find(p => p.key === 'antennae'), { seed, name: t.name, sub: 'seed ' + seed }); delete P.key; delete P.label; }
  return P;
}
export function presetParams(key) {
  const p = PRESETS.find(x => x.key === key) || PRESETS[0];
  const P = Object.assign(base(), p);
  delete P.key; delete P.label; P.preset = p.key; P.seed = P.seed || 1;
  return P;
}

// ── packing: one galaxy block ───────────────────────────────────────────────
// World -> local rotation rows from a disk normal and a position angle.
export function frameFromNormal(nrm, pa = 0) {
  const l = Math.hypot(nrm[0], nrm[1], nrm[2]) || 1, n = [nrm[0] / l, nrm[1] / l, nrm[2] / l];
  const ref = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let e1 = [ref[1] * n[2] - ref[2] * n[1], ref[2] * n[0] - ref[0] * n[2], ref[0] * n[1] - ref[1] * n[0]];
  const l1 = Math.hypot(...e1); e1 = e1.map(v => v / l1);
  let e2 = [n[1] * e1[2] - n[2] * e1[1], n[2] * e1[0] - n[0] * e1[2], n[0] * e1[1] - n[1] * e1[0]];
  const c = Math.cos(pa), s = Math.sin(pa);
  const a = e1.map((v, i) => c * v + s * e2[i]), b = e2.map((v, i) => -s * e1[i] + c * v);
  return [a, b, n];
}
const T_OLD = 4300, T_DISK = 5000, T_YOUNG = 14000;
const HII_RGB = [1.0, 0.30, 0.48];

// Light of each component, from the parameters. The volume carries the
// unresolved part (1 - resolved fraction); the sprites carry the rest.
export const RESOLVED = { disk: 0.14, thick: 0.1, bulge: 0.05, young: 0.55, bar: 0.08 };
export function components(P, Ltot = 1) {
  const Lb = Ltot * P.BT, Lbar = Ltot * (P.bar || 0), Ld = Math.max(0, Ltot - Lb - Lbar);
  const Lthick = Ld * P.thickFrac, Lyoung = (Ld - Lthick) * P.young, Lthin = Ld - Lthick - Lyoung;
  return { Lb, Lbar, Lthin, Lthick, Lyoung };
}

// gal: { P, rot (3 rows), centre [x,y,z], L (total light), scale }
export function packGalaxy(gal, out = new Float32Array(GAL_FLOATS), o = 0) {
  const P = gal.P, k = gal.scale || 1, L = gal.L ?? 1;
  const C = components(P, L);
  const Rd = P.Rd * k, hz = P.hz * k, re = P.re * k;
  const v = (i, a, b, c, d) => { out[o + i * 4] = a; out[o + i * 4 + 1] = b; out[o + i * 4 + 2] = c; out[o + i * 4 + 3] = d; };
  const R = gal.rot, c0 = gal.centre;
  v(0, R[0][0], R[0][1], R[0][2], c0[0]);
  v(1, R[1][0], R[1][1], R[1][2], c0[1]);
  v(2, R[2][0], R[2][1], R[2][2], c0[2]);
  // bulge: rho_0 from its light; 1/(4 pi) turns luminosity density into
  // emission per steradian.
  const n = P.n, b = sersicB(n), p = prugnielP(n);
  const rhoB = C.Lb * (1 - RESOLVED.bulge) / sersicRhoTotal(1, re, n, P.q, P.c);
  v(3, rhoB / (4 * Math.PI), re, 1 / n, b);
  v(4, 1 / P.q, 1 / P.c, p, P.vflat * KMS_KPC);
  const rhoD = C.Lthin * (1 - RESOLVED.disk) / diskTotal(1, Rd, hz);
  const thRd = P.thickRd * k, thHz = P.thickHz * k;
  const rhoT = C.Lthick * (1 - RESOLVED.thick) / diskTotal(1, thRd, thHz);
  const hzY = Math.max(0.06, hz * 0.45);
  const rhoY = C.Lyoung * (1 - RESOLVED.young) / diskTotal(1, Rd, hzY);
  const Rmax = Math.max(6 * Rd, 7 * re, (P.ringR || 0) * k * 1.4);
  v(5, rhoD / (4 * Math.PI), 1 / Rd, 1 / hz, Rmax);
  v(6, rhoT / (4 * Math.PI), 1 / thRd, 1 / thHz, rhoY / (4 * Math.PI));
  const R0 = (P.bar ? P.barA : P.R0) * k;
  v(7, P.m, 1 / Math.tan(P.pitch * Math.PI / 180), R0, P.armAmp);
  v(8, P.sharp, 0, P.flocc, 1 / hzY);
  // arms2.y (OFF.phase) is Omega_p t, written per frame.
  const omP = P.vflat / (P.corot * Rd) * KMS_KPC;
  // bar: Ferrers-like boxy ellipse in the bar frame.
  const barA = P.barA * k, barB = P.barB * k;
  const rhoBar = P.bar ? C.Lbar * (1 - RESOLVED.bar) / (barVolume(barA, barB, hz * 1.6)) : 0;
  v(9, rhoBar / (4 * Math.PI), 1 / barA, 1 / barB, P.barDust || 0);
  // dust: kappa_0 from the face-on optical depth through the centre,
  // tau = 2 kappa_0 h_d.
  const dHz = P.dustHz * k, dRd = P.dustRd * k;
  // DUST_LEGIBLE: the lanes read at page size (a shown, not hidden, effect)
  const DUST_LEGIBLE = 2.4;
  v(10, DUST_LEGIBLE * P.tau / (2 * dHz), 1 / dRd, 1 / dHz, P.lane);
  v(11, (P.ringR || 0) * k, 1 / Math.max(0.1, (P.ringW || 1) * k), (P.ringTau || 0) / (2 * dHz), P.filament);
  v(12, P.laneOff * 2, P.sharp * 1.5, (P.hole || 0) * k, omP);
  v(13, P.hii * rhoY / (4 * Math.PI) * 30, 1 / (0.9 * k), 0, P.Rt * k);
  v(14, (P.halo || 0) * L / (haloNorm(P.rh * k)) / (4 * Math.PI), 1 / (P.rh * k), P.irr || 0, (gal.seedOff ?? 0));
  const cB = blackbodyRGB(T_OLD), cD = blackbodyRGB(T_DISK), cY = blackbodyRGB(T_YOUNG);
  v(15, cB[0], cB[1], cB[2], 0);
  v(16, cD[0], cD[1], cD[2], 0);
  v(17, cY[0], cY[1], cY[2], 0);
  v(18, HII_RGB[0], HII_RGB[1], HII_RGB[2], 0);
  // box: half sizes of the bounding cylinder, the vertical step scale, on.
  const zBox = Math.max(5 * P.thickHz * k, 5 * re * P.c, 0.25 * Rmax, 1.5);
  const zStep = P.BT > 0.6 ? re * 0.5 : Math.max(0.12, hz * 0.8);
  v(19, Rmax, zBox, zStep, 1);
  v(20, P.minor || 0, P.bar ? 1 : 0, (P.pa || 0), 0);
  v(21, 0, 0, 0, 0); v(22, 0, 0, 0, 0); v(23, 0, 0, 0, 0);
  return out;
}
// Volume of the bar density exp(-(x^2/a^2 + y^2/b^2)^1.5) exp(-|z|/h):
// 2 h a b * 2 pi * Gamma(5/3)/3 ... integral of exp(-u^3) over the plane.
function barVolume(a, b, h) { return 2 * h * a * b * 2 * Math.PI * gammaFn(2 / 3) / 3; }
// Integral of 4 pi r^2 (1 + r/rh)^-3.5 out to infinity: 4 pi rh^3 * 16/15... B(3, 0.5).
function haloNorm(rh) { return 4 * Math.PI * rh ** 3 * (gammaFn(3) * gammaFn(0.5) / gammaFn(3.5)); }

// ── star sampling ───────────────────────────────────────────────────────────
// Radius from an exponential disk: R e^(-R/Rd) is Gamma(2): -Rd ln(u1 u2).
function diskR(r, Rd) { return -Rd * Math.log(Math.max(1e-9, r() * r())); }
function laplace(r, h) { return (r() < 0.5 ? -1 : 1) * -h * Math.log(Math.max(1e-9, r())); }
// Inverse CDF table of the deprojected Sersic profile, in units of r_e.
const SERSIC_CDF = new Map();
function sersicSampler(n) {
  const key = n.toFixed(2);
  if (SERSIC_CDF.has(key)) return SERSIC_CDF.get(key);
  const N = 2048, xs = new Float64Array(N), cdf = new Float64Array(N), xmax = 12;
  let acc = 0;
  for (let i = 0; i < N; i++) {
    const x = xmax * Math.pow(i / (N - 1), 2.2) + 1e-4;
    xs[i] = x;
    if (i) { const xm = (x + xs[i - 1]) / 2; acc += sersicRho(xm, 1, 1, n) * xm * xm * (x - xs[i - 1]); }
    cdf[i] = acc;
  }
  for (let i = 0; i < N; i++) cdf[i] /= acc;
  const f = u => { let lo = 0, hi = N - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cdf[m] < u) lo = m; else hi = m; } const t = (u - cdf[lo]) / Math.max(1e-12, cdf[hi] - cdf[lo]); return xs[lo] + t * (xs[hi] - xs[lo]); };
  SERSIC_CDF.set(key, f);
  return f;
}
function unitVec(r) { const z = r() * 2 - 1, a = r() * 6.283185307, s = Math.sqrt(1 - z * z); return [s * Math.cos(a), s * Math.sin(a), z]; }
// Temperature to [r, g, b] times a small saturation lift so tints read
// after additive blending and tone mapping.
// A log-spaced table of blackbodyRGB, 1000 K to 50000 K, read with linear
// interpolation (the full integral per star is slow).
const BB_N = 384, BB_T0 = Math.log(1000), BB_T1 = Math.log(50000);
let BB_TAB = null;
function bbFast(T) {
  if (!BB_TAB) { BB_TAB = []; for (let i = 0; i < BB_N; i++) BB_TAB.push(blackbodyRGB(Math.exp(BB_T0 + (BB_T1 - BB_T0) * i / (BB_N - 1)))); }
  const x = Math.min(BB_N - 1.0001, Math.max(0, (Math.log(T) - BB_T0) / (BB_T1 - BB_T0) * (BB_N - 1)));
  const i = Math.floor(x), f = x - i, a = BB_TAB[i], b = BB_TAB[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
function starRGB(T) {
  const c = bbFast(T), y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return c.map(v => Math.max(0, y + (v - y) * 1.25));
}
// 2D value noise for fragment selection (flocculent arms, irregular clumps).
function vnoise(x, y, seed) {
  const h = (i, j) => { let n = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 982451653); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v;
}

// Star record (STAR_FLOATS = 16):
//   a = [pop, p1, p2, p3]   b = [gal, q1, q2, q3]   c = [r, g, b, L]   d = [size, twinkle, radius, 0]
//   size scales the sprite in px; radius (kpc) gives it a real size
//   (HII regions, clusters, tail puffs), so it grows as the camera nears
//   pop 0 rotating   p = R, phi0, z           q = armBoost, omegaScale, twinklePhase
//   pop 2 young/HII  p = R, armPhase, z       q = life (Myr), birth offset 0..1, kind (0 star, 1 HII)
//   pop 3 bar        p = x_bar, y_bar, z      q = -, -, twinklePhase
//   pop 4 static     p = world x, y, z        q = -, -, twinklePhase
//   pop 5 sky        p = unit direction       q = elongation, position angle, twinklePhase; gal = kind (0 star, 1 galaxy)
class StarWriter {
  constructor(cap) { this.d = new Float32Array(cap * STAR_FLOATS); this.n = 0; this.cap = cap; }
  push(a, b, c, d) {
    if (this.n >= this.cap) return;
    const o = this.n++ * STAR_FLOATS, D = this.d;
    D[o] = a[0]; D[o + 1] = a[1]; D[o + 2] = a[2]; D[o + 3] = a[3];
    D[o + 4] = b[0]; D[o + 5] = b[1]; D[o + 6] = b[2]; D[o + 7] = b[3];
    D[o + 8] = c[0]; D[o + 9] = c[1]; D[o + 10] = c[2]; D[o + 11] = c[3];
    D[o + 12] = d[0]; D[o + 13] = d[1]; D[o + 14] = d[2]; D[o + 15] = d[3];
  }
}

// Fill the stars of one galaxy (index gi, scale k, light L) into W.
function fillStars(W, P, gi, budget, r, k = 1, L = 1, seedOff = 0) {
  const C = components(P, L);
  const Rd = P.Rd * k, hz = P.hz * k, re = P.re * k;
  const isE = P.BT > 0.95;
  // Share of sprites per population: weighted by light, with a floor so
  // young stars stay many in a spiral.
  const w = {
    bulge: C.Lb * 1.0, disk: C.Lthin * 1.1, thick: C.Lthick * 0.8,
    young: C.Lyoung * (P.irr ? 3 : 2.4), bar: C.Lbar * 0.7,
  };
  const sumW = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  const nGC = Math.round((P.nGC || 0) * Math.min(1, budget / 60000) * (k < 1 ? 0.3 : 1));
  const nHalo = Math.round(budget * (isE ? 0.05 : 0.02));
  const main = Math.max(0, budget - nGC - nHalo);
  const cnt = {}; for (const key in w) cnt[key] = Math.round(main * w[key] / sumW);
  const tw = () => r() * 6.283;
  const m = P.m, R0 = (P.bar ? P.barA : P.R0) * k, kk = 1 / Math.tan(P.pitch * Math.PI / 180);

  // bulge: deprojected Sersic, triaxial, slow rotation.
  const sb = sersicSampler(P.n);
  for (let i = 0; i < cnt.bulge; i++) {
    const rr = sb(r()) * re, u = unitVec(r);
    const x = u[0] * rr, y = u[1] * rr * P.q, z = u[2] * rr * P.c;
    const T = Math.max(3200, Math.min(5600, T_OLD + r.gauss() * 450));
    const c = starRGB(T), Ls = C.Lb * RESOLVED.bulge / cnt.bulge * (0.4 + 1.2 * r());
    pushRot(W, gi, x, y, z, 0, isE ? 0.12 : 0.45, tw(), c, Ls, 1);
  }
  // thin disk: old and intermediate stars, phases uniform; the arm boost
  // brightens them inside the density wave without winding them.
  for (let i = 0; i < cnt.disk; i++) {
    let R = diskR(r, Rd); if (R > 6.5 * Rd) R = r() * 6 * Rd;
    if (P.hole && R < P.hole * k * 0.7 && r() < 0.6) R = P.hole * k * (0.7 + 0.6 * r());
    const phi = r() * 6.283185307, z = laplace(r, hz);
    let x = R * Math.cos(phi), y = R * Math.sin(phi);
    if (P.irr) { const s = 1 + P.irr * 0.6 * (vnoise(x * 0.5 + 9, y * 0.5, P.seed + seedOff) - 0.5); x *= s; y *= s * 0.75; }
    const u = r(), T = u < 0.62 ? 3400 + 2200 * r() : u < 0.92 ? 5400 + 1800 * r() : 7200 + 2600 * r();
    const c = starRGB(T), Ls = C.Lthin * RESOLVED.disk / cnt.disk * Math.pow(T / 5200, 2.2) * (0.5 + r());
    pushRot(W, gi, x, y, z, P.armAmp * 0.9, 1, tw(), c, Ls, 1);
  }
  for (let i = 0; i < cnt.thick; i++) {
    const R = Math.min(diskR(r, P.thickRd * k), 7 * Rd), phi = r() * 6.283185307, z = laplace(r, P.thickHz * k);
    const c = starRGB(3800 + 1500 * r()), Ls = C.Lthick * RESOLVED.thick / cnt.thick * (0.5 + r());
    pushRot(W, gi, R * Math.cos(phi), R * Math.sin(phi), z, 0.1, 0.85, tw(), c, Ls, 1);
  }
  // young stars and HII regions: born in an arm, then they orbit at
  // Omega(R) while the arm turns at Omega_p, so they drift downstream.
  const nY = cnt.young, nH = Math.round(nY * 0.06 * (P.hii || 0));
  for (let i = 0; i < nY + nH; i++) {
    const hii = i >= nY;
    let R = diskR(r, Rd * 0.95), arm = Math.floor(r() * m), sc = r.gauss() * (0.16 + 0.35 / (P.sharp || 2));
    if (P.armAmp > 0 && !P.irr && R < R0 * 0.85) R = R0 * (0.85 + r() * 0.8);
    // flocculent: keep only stars in noise fragments along the arm.
    if (P.flocc > 0) {
      let tries = 0;
      while (tries++ < 8 && vnoise(Math.log(R + 0.5) * 3.2, arm * 7.1 + sc * 2, P.seed + seedOff) < 0.48 + 0.2 * P.flocc) { R = diskR(r, Rd); arm = Math.floor(r() * m); sc = r.gauss() * 0.25; }
    }
    let phase = arm * 6.283185307 / m + sc;
    if (P.minor && r() < 0.35) phase += Math.PI / m;
    if (P.irr || P.armAmp <= 0.05) phase = r() * 6.283185307;   // no arms: any azimuth
    let z = laplace(r, Math.max(0.05, hz * 0.45));
    let pop = 2, rec;
    const life = hii ? 3 + 5 * r() : 3 + 8 * r();
    const T = hii ? 0 : Math.exp(Math.log(8000) + r() * Math.log(36000 / 8000));
    const c = hii ? HII_RGB : starRGB(T);
    const Ls = hii ? C.Lyoung * 0.2 / Math.max(1, nH) * (P.hii || 0) * (0.5 + 1.5 * r() ** 2) : C.Lyoung * RESOLVED.young / nY * Math.pow(T / 12000, 1.6) * (0.3 + 1.4 * r() ** 2);
    if (P.irr) {
      // irregular: young stars in a few big clumps at random places.
      const nc = 7, ci = Math.floor(r() * nc), cr = rng(P.seed * 31 + ci + seedOff * 101);
      const cx = (cr() - 0.5) * 2.4 * Rd, cy = (cr() - 0.5) * 1.6 * Rd, s = Rd * (0.15 + 0.3 * cr());
      const x = cx + r.gauss() * s, y = cy + r.gauss() * s;
      R = Math.hypot(x, y); phase = Math.atan2(y, x);
      rec = [0, R, phase, z];
      W.push(rec, [gi, 0, 1, tw()], [c[0], c[1], c[2], Ls * (hii ? 1 : 1.5)], [1, 0.15, hii ? 0.08 + 0.1 * r() : 0, 0]);
      continue;
    }
    W.push([pop, R, phase, z], [gi, life, r(), hii ? 1 : 0], [c[0], c[1], c[2], Ls], [1, 0.12, hii ? 0.06 + 0.1 * r() : 0, 0]);
  }
  // bar stars: a boxy ellipse in the bar frame, turning with the pattern.
  for (let i = 0; i < cnt.bar; i++) {
    const a = P.barA * k, b = P.barB * k;
    let x, y; do { x = (r() * 2 - 1) * a; y = (r() * 2 - 1) * b; } while (Math.pow((x / a) ** 2 + (y / b) ** 2, 1.5) > -Math.log(Math.max(1e-6, r())));
    const c = starRGB(3800 + 1800 * r()), Ls = C.Lbar * RESOLVED.bar / cnt.bar * (0.5 + r());
    W.push([3, x, y, laplace(r, hz * 1.6)], [gi, 0, 0, tw()], [c[0], c[1], c[2], Ls], [1, 0.06, 0, 0]);
  }
  // halo stars and globular clusters: r^-3.5 power law, slow rotation.
  for (let i = 0; i < nHalo + nGC; i++) {
    const gc = i >= nHalo, rh = P.rh * k;
    // A concentrated power law, P(> r) = (1 + r/rh)^-1.5, cut at 14 rh.
    let rr; do { rr = rh * (Math.pow(Math.max(1e-6, r()), -1 / 1.5) - 1); } while (rr > 14 * rh);
    if (gc) rr = Math.max(rr, re * 0.6);
    const u = unitVec(r);
    const c = starRGB(gc ? 4700 + 900 * r() : 4200 + 1000 * r());
    const Ls = gc ? L * 6e-5 * (0.4 + 1.6 * r() ** 2) * (k < 1 ? 0.5 : 1) : L * (P.halo || 0.02) * 0.3 / Math.max(1, nHalo);
    pushRot(W, gi, u[0] * rr, u[1] * rr, u[2] * rr, 0, gc ? 0.25 : 0.15, tw(), c, Ls, gc ? 1.5 : 1, gc ? 0.004 : 0);
  }
}
function pushRot(W, gi, x, y, z, armBoost, omScale, tw, c, L, size, physR = 0) {
  W.push([0, Math.hypot(x, y), Math.atan2(y, x), z], [gi, armBoost, omScale, tw], [c[0], c[1], c[2], L], [size, 0.08, physR, 0]);
}

// Foreground stars of our own Galaxy and faint background galaxies, on
// the sky sphere (they do not move with the camera's position).
function fillSky(W, r, nStars, nGals) {
  for (let i = 0; i < nStars; i++) {
    const u = unitVec(r), T = r() < 0.7 ? 3600 + 2400 * r() : 6000 + 14000 * r() ** 2;
    const c = starRGB(T), L = 0.4 * Math.pow(r(), 6) + 0.004 * r();
    W.push([5, u[0], u[1], u[2]], [0, 1, 0, r() * 6.283], [c[0], c[1], c[2], L], [1, 0.5, 0, 0]);
  }
  for (let i = 0; i < nGals; i++) {
    const u = unitVec(r), red = r();
    const c = starRGB(3800 + 3500 * (1 - red)), L = 0.006 + 0.03 * r() ** 3;
    W.push([5, u[0], u[1], u[2]], [1, 0.25 + 0.75 * r(), r() * 3.1416, 0], [c[0], c[1], c[2], L], [1.6 + 3.5 * r() ** 2, 0, 0, 0]);
  }
}

// M87's jet: knots along a straight line, blue-white synchrotron.
function fillJet(W, gi, r, re) {
  const len = 2.6 + re * 0.1, dir = [0.62, 0.25, 0.74], l = Math.hypot(...dir);
  for (let i = 0; i < 220; i++) {
    const s = Math.pow(r(), 0.8) * len, knot = 0.6 + 0.8 * Math.max(0, Math.sin(s * 7.3)) ** 6;
    const sp = 0.02 + s * 0.03;
    const x = dir[0] / l * s + r.gauss() * sp, y = dir[1] / l * s + r.gauss() * sp, z = dir[2] / l * s + r.gauss() * sp;
    W.push([4, x, y, z], [gi, 0, 0, r() * 6.28], [0.55, 0.72, 1.0, 0.0016 * knot], [1.2, 0.1, 0.012 + 0.02 * r(), 0]);
  }
}

// ── interacting pair: restricted three-body ─────────────────────────────────
// Two softened point masses on a parabolic orbit; massless stars start on
// circular orbits in a disk round each mass. Units G = M1 = 1, length
// unit UL kpc. Returns centres, normals, and star positions (in kpc).
export function tidalPair(seed, { n = 12000, mass2 = 0.8, rp = 0.8, incl1 = 15, incl2 = 60, tEnd = 5.4, UL = 8 } = {}) {
  const r = rng(seed * 104729 + 7), eps2 = 0.04;
  const M = [1, mass2], Mt = 1 + mass2;
  // parabolic relative orbit, start at true anomaly f0 before pericentre.
  const f0 = -2.2, p = 2 * rp;
  const rr = p / (1 + Math.cos(f0)), h = Math.sqrt(Mt * p);
  const rel = [rr * Math.cos(f0), rr * Math.sin(f0), 0];
  const vrel = [-Mt / h * Math.sin(f0), Mt / h * (1 + Math.cos(f0)), 0];
  const B = [
    { x: rel.map(v => -v * mass2 / Mt), v: vrel.map(v => -v * mass2 / Mt) },
    { x: rel.map(v => v * 1 / Mt), v: vrel.map(v => v * 1 / Mt) },
  ];
  // disk normals: tilt from the orbit normal (prograde when small).
  const tilt = (deg, az) => { const a = deg * Math.PI / 180; return [Math.sin(a) * Math.cos(az), Math.sin(a) * Math.sin(az), Math.cos(a)]; };
  const N = [tilt(incl1, r() * 6.28), tilt(incl2, r() * 6.28)];
  const F = N.map(nn => frameFromNormal(nn));
  const np = n, X = new Float64Array(np * 3), V = new Float64Array(np * 3), host = new Uint8Array(np), R0 = new Float32Array(np);
  for (let i = 0; i < np; i++) {
    const g = i < np * 0.55 ? 0 : 1; host[i] = g;
    const Rg = 0.08 + 0.85 * Math.sqrt(r()) * (g ? 0.9 : 1);
    const ph = r() * 6.283185307, vc = Math.sqrt(M[g] * Rg * Rg / Math.pow(Rg * Rg + eps2, 1.5));
    const lx = Rg * Math.cos(ph), ly = Rg * Math.sin(ph), lz = r.gauss() * 0.012;
    const vx = -vc * Math.sin(ph), vy = vc * Math.cos(ph);
    const [e1, e2, nn] = F[g];
    for (let a = 0; a < 3; a++) {
      X[i * 3 + a] = B[g].x[a] + e1[a] * lx + e2[a] * ly + nn[a] * lz;
      V[i * 3 + a] = B[g].v[a] + e1[a] * vx + e2[a] * vy;
    }
    R0[i] = Rg;
  }
  const acc = (px, py, pz, out) => {
    out[0] = out[1] = out[2] = 0;
    for (let g = 0; g < 2; g++) {
      const dx = B[g].x[0] - px, dy = B[g].x[1] - py, dz = B[g].x[2] - pz;
      const d2 = dx * dx + dy * dy + dz * dz + eps2, f = M[g] / (d2 * Math.sqrt(d2));
      out[0] += f * dx; out[1] += f * dy; out[2] += f * dz;
    }
  };
  const dt = 0.008, steps = Math.round(tEnd / dt), a = [0, 0, 0];
  for (let s = 0; s < steps; s++) {
    // bodies: kick-drift-kick on the pair
    const kickB = (hh) => {
      const dx = B[1].x[0] - B[0].x[0], dy = B[1].x[1] - B[0].x[1], dz = B[1].x[2] - B[0].x[2];
      const d2 = dx * dx + dy * dy + dz * dz + eps2, f = 1 / (d2 * Math.sqrt(d2));
      B[0].v[0] += hh * f * M[1] * dx; B[0].v[1] += hh * f * M[1] * dy; B[0].v[2] += hh * f * M[1] * dz;
      B[1].v[0] -= hh * f * M[0] * dx; B[1].v[1] -= hh * f * M[0] * dy; B[1].v[2] -= hh * f * M[0] * dz;
    };
    for (let i = 0; i < np; i++) { acc(X[i * 3], X[i * 3 + 1], X[i * 3 + 2], a); V[i * 3] += 0.5 * dt * a[0]; V[i * 3 + 1] += 0.5 * dt * a[1]; V[i * 3 + 2] += 0.5 * dt * a[2]; }
    kickB(0.5 * dt);
    for (let g = 0; g < 2; g++) for (let c = 0; c < 3; c++) B[g].x[c] += dt * B[g].v[c];
    for (let i = 0; i < np * 3; i++) X[i] += dt * V[i];
    kickB(0.5 * dt);
    for (let i = 0; i < np; i++) { acc(X[i * 3], X[i * 3 + 1], X[i * 3 + 2], a); V[i * 3] += 0.5 * dt * a[0]; V[i * 3 + 1] += 0.5 * dt * a[1]; V[i * 3 + 2] += 0.5 * dt * a[2]; }
  }
  // centre of mass frame, then kpc.
  const cm = [0, 1, 2].map(c => (B[0].x[c] * M[0] + B[1].x[c] * M[1]) / Mt);
  const pos = new Float32Array(np * 3);
  for (let i = 0; i < np; i++) for (let c = 0; c < 3; c++) pos[i * 3 + c] = (X[i * 3 + c] - cm[c]) * UL;
  return {
    centres: B.map(b => b.x.map((v, c) => (v - cm[c]) * UL)),
    normals: N, frames: F, pos, host, R0, UL, n: np,
  };
}

// ── build ───────────────────────────────────────────────────────────────────
// P: parameters. opts.stars: sprite budget. opts.sky: foreground stars and
// background galaxies on or off.
export function buildGalaxy(P, { stars = 120000, sky = true, bg = true } = {}) {
  const r = rng((P.seed || 1) * 2654435761 + (P.type || '').length * 97 + 11);
  const nSky = sky ? Math.round(Math.min(5000, stars * 0.03)) : 0, nBg = bg ? Math.round(Math.min(700, stars * 0.005)) : 0;
  const W = new StarWriter(stars + nSky + nBg + 400);
  const gals = new Float32Array(GAL_FLOATS * 2);
  const list = [];
  const pa = (P.pa || 0) * Math.PI / 180;
  let meta = { R: P.Rd * 6, centre: [0, 0, 0] };

  if (P.type === 'pair') {
    const T = tidalPair(P.seed || 1, { n: Math.round(Math.min(16000, stars * 0.3)) });
    for (let g = 0; g < 2; g++) {
      const Pg = Object.assign({}, P, g ? { Rd: P.Rd * 0.85, BT: P.BT * 1.4, seed: (P.seed || 1) + 7 } : {});
      list.push({ P: Pg, rot: T.frames[g], centre: T.centres[g], L: g ? 0.7 : 1, scale: 1, seedOff: g * 3.7 });
    }
    // test stars: those still close to their host become rotating disk
    // stars of that host; the rest are the static tails and bridge.
    const C0 = components(P, 1);
    const Lper = (C0.Lthin + C0.Lyoung) * 0.35 / T.n;
    for (let i = 0; i < T.n; i++) {
      const g = T.host[i], c = T.centres[g], F = T.frames[g];
      const dx = T.pos[i * 3] - c[0], dy = T.pos[i * 3 + 1] - c[1], dz = T.pos[i * 3 + 2] - c[2];
      const lx = F[0][0] * dx + F[0][1] * dy + F[0][2] * dz, ly = F[1][0] * dx + F[1][1] * dy + F[1][2] * dz, lz = F[2][0] * dx + F[2][1] * dy + F[2][2] * dz;
      const young = r() < 0.3, T0 = young ? 9000 + 20000 * r() ** 2 : 3600 + 2600 * r();
      const col = starRGB(T0), L = Lper * (young ? 2.2 : 0.8) * (0.4 + r());
      const Rl = Math.hypot(lx, ly);
      if (Rl < T.R0[i] * T.UL * 1.25 + 1.5 && Math.abs(lz) < 1.2 && Rl < 9) {
        W.push([0, Rl, Math.atan2(ly, lx), lz], [g, young ? 0.3 : 0.1, 1, r() * 6.28], [col[0], col[1], col[2], L], [1, 0.08, 0, 0]);
      } else {
        // tail stars, plus diffuse puffs so the tails glow as a whole
        const puff = r() < 0.18;
        W.push([4, T.pos[i * 3], T.pos[i * 3 + 1], T.pos[i * 3 + 2]], [g, 0, 0, r() * 6.28], [col[0], col[1], col[2], L * (puff ? 7 : 1)], [1, 0.06, puff ? 0.3 + 0.45 * r() : 0, 0]);
      }
    }
    const rest = stars - W.n;
    fillStars(W, list[0].P, 0, Math.round(rest * 0.55), r, 1, 1, 0);
    fillStars(W, list[1].P, 1, Math.round(rest * 0.4), r, 1, 0.7, 3.7);
    // fit radius: the 92nd percentile of the star distances from the centre
    const ds = []; for (let i = 0; i < T.n; i++) ds.push(Math.hypot(T.pos[i * 3], T.pos[i * 3 + 1], T.pos[i * 3 + 2]));
    ds.sort((a, b) => a - b);
    meta = { R: ds[Math.floor(ds.length * 0.92)] + 3, centre: [0, 0, 0], centres: T.centres };
  } else {
    const rot = frameFromNormal([0, 0, 1], pa);
    list.push({ P, rot, centre: [0, 0, 0], L: 1, scale: 1, seedOff: 0 });
    const comp = P.companion;
    const nComp = comp ? Math.round(stars * 0.08) : 0;
    fillStars(W, P, 0, stars - nComp, r, 1, 1, 0);
    if (P.jet) fillJet(W, 0, r, P.re);
    if (comp) {
      const Pc = Object.assign(presetParams('m51'), { type: comp.kind, BT: 0.55, n: 2.5, re: 0.9, armAmp: 0, young: 0.03, hii: 0.1, tau: 0.9, lane: 0, filament: 1.1, irr: 0.6, nGC: 40, companion: null, seed: (P.seed || 1) + 3 });
      const a = comp.tilt * Math.PI / 180;
      const crot = frameFromNormal([Math.sin(a), 0.3, Math.cos(a)]);
      list.push({ P: Pc, rot: crot, centre: comp.at, L: comp.L, scale: comp.scale, seedOff: 5.1 });
      fillStars(W, Pc, 1, nComp, r, comp.scale, comp.L, 5.1);
    }
    meta = { R: Math.max(P.Rd * 5.5, P.re * 5, (P.ringR || 0) * 1.5), centre: [0, 0, 0] };
    if (comp) meta.R = Math.max(meta.R, Math.hypot(...comp.at) + 3);
  }
  list.forEach((g, i) => packGalaxy(g, gals, i * GAL_FLOATS));
  fillSky(W, r, nSky, nBg);
  return { gals, nGal: list.length, list, stars: W.d.subarray(0, W.n * STAR_FLOATS), count: W.n, meta, P };
}

// Surface brightness that sets the brightness scale (sky stars, the peak
// clamp): the disk at R = R_d, or the bulge at r_e when it dominates.
export function refSB(P) {
  const C = components(P, 1);
  if (P.BT > 0.6) return C.Lb / sersicTotal(1, P.re, P.n) * 1 / (4 * Math.PI);
  return C.Lthin / (2 * Math.PI * P.Rd * P.Rd) * Math.exp(-1) / (4 * Math.PI);
}

// Pattern speed of galaxy block g (rad/Myr), for the per-frame phase.
export function patternSpeed(gals, g) { return gals[g * GAL_FLOATS + 12 * 4 + 3]; }
