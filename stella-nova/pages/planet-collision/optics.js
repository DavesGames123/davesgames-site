// ============================================================================
//  PLANET COLLISION  ·  optics.js — the light and matter rules of the
//  renderer, on the CPU (no DOM and no GPU)
// ----------------------------------------------------------------------------
//  The render shaders use the same rules. This file is their reference:
//  render.js writes the constants below into the frame uniform and the
//  black-body table into a texture, and tests.mjs checks the functions
//  here (section 13) and compares the WGSL twins with them (section R).
//
//  BLACK BODY (fn blackbodyRGB, fn blackbodyLUT). The Planck spectrum at
//  T, weighed by the CIE 1931 colour matching functions (the multi-lobe
//  Gaussian fit of Wyman, Sloan and Shirley, JCGT 2(2), 2013) -> XYZ ->
//  linear sRGB (IEC 61966-2-1), negatives clipped, the brightest channel
//  1. The table holds BB_N rows from BB_T0 to BB_T1 K, spaced in log T.
//
//  PHASE (fn hg, fn phase). Henyey and Greenstein (1941). Two lobes: a
//  strong forward lobe (fine condensate and dust scatter forward) and a
//  weak back lobe. Each lobe and the mix integrate to 1 over the sphere.
//
//  SMOKE (fn smokeWeights). The share of a particle that the volume
//  renderer draws as gas or as dust. render.js splats it into the smoke
//  volume (shaders/smoke.wgsl fn smokeOf has the same rule):
//    gas    the Tillotson vapour weight xv (from xvLo to xvHi), or hot,
//           expanded matter: T over the boil range and rho under 0.6 rho0
//    dust   free debris (rho under rho0 / q^3) sheds DUST_SHED of its
//           mass as fine dust; vapour under the condensation range is dust
//    Tgas   the drawn gas temperature: SPH T, capped by a cap that falls
//           with the hours since contact (fn vapourCap); thin vapour
//           radiates and expands, so it cools far faster than the melt
//  The split of the gas into glowing vapour and condensate follows Tgas
//  (fn condensed): silicate vapour condenses from about 2400 K to 1800 K.
//
//  MATTER (fn skinT, fn crustShare, fn matterState, fn geotherm). The
//  temperature -> material map of the bodies and the drops: solid rock,
//  hot rock (dark), melt (glows, a black body at the skin temperature),
//  crust (melt under a cooled skin, with glowing seams), vapour. The cut
//  face shows a drawn geotherm (fn geotherm) where the solver has no heat:
//  the bodies start at 300 K, a real interior is hot.
//
//  EXPORTS  BB_N, BB_T0, BB_T1, cie1931, planck, blackbodyRGB,
//           blackbodyLUT, hg, phase, PHASE, SMOKE, smokeWeights, vapourCap,
//           condensed, skinCap, skinT, crustShare, glowRadiance,
//           matterState, geotherm, GEOTHERM
//
//  grep -n targets: "export function blackbodyRGB", "export function hg",
//  "export const PHASE", "export const SMOKE", "export function smokeWeights",
//  "export function matterState", "export function geotherm"
// ============================================================================

export const BB_N = 128, BB_T0 = 500, BB_T1 = 16000;

// CIE 1931 2-degree colour matching functions, lambda in nm (Wyman et al.
// 2013, the multi-lobe fit, their equation 2 and table 1)
function g(x, mu, s1, s2) { const t = (x - mu) / (x < mu ? s1 : s2); return Math.exp(-0.5 * t * t); }
export function cie1931(l) {
  return [
    1.056 * g(l, 599.8, 37.9, 31.0) + 0.362 * g(l, 442.0, 16.0, 26.7) - 0.065 * g(l, 501.1, 20.4, 26.2),
    0.821 * g(l, 568.8, 46.9, 40.5) + 0.286 * g(l, 530.9, 16.3, 31.1),
    1.217 * g(l, 437.0, 11.8, 36.0) + 0.681 * g(l, 459.0, 26.0, 13.8),
  ];
}
// Planck spectral radiance at lambda (nm) and T (K), W / (m^2 sr m)
export function planck(lnm, T) {
  const h = 6.62607015e-34, c = 2.99792458e8, k = 1.380649e-23, l = lnm * 1e-9;
  return 2 * h * c * c / Math.pow(l, 5) / Math.expm1(h * c / (l * k * T));
}
// Linear sRGB of a black body at T, the brightest channel 1. Also Y (the
// luminance, W / (m^2 sr) weighed by y-bar) in .Y.
export function blackbodyRGB(T) {
  let X = 0, Y = 0, Z = 0;
  for (let l = 380; l <= 780; l += 2) { const w = planck(l, T), c = cie1931(l); X += w * c[0]; Y += w * c[1]; Z += w * c[2]; }
  const r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z, gg = -0.9689 * X + 1.8758 * Y + 0.0415 * Z, b = 0.0557 * X - 0.2040 * Y + 1.0570 * Z;
  const c = [Math.max(r, 0), Math.max(gg, 0), Math.max(b, 0)], m = Math.max(...c) || 1;
  const out = c.map(v => v / m);
  out.Y = Y * 2;
  return out;
}
// The table for the GPU: BB_N rows of linear RGB (brightest 1), row k at
// T = BB_T0 (BB_T1 / BB_T0)^(k / (BB_N - 1)). Float32Array of 4 BB_N.
export function blackbodyLUT() {
  const o = new Float32Array(4 * BB_N);
  for (let k = 0; k < BB_N; k++) {
    const T = BB_T0 * Math.pow(BB_T1 / BB_T0, k / (BB_N - 1)), c = blackbodyRGB(T);
    o.set([c[0], c[1], c[2], 1], 4 * k);
  }
  return o;
}

// Henyey-Greenstein phase function per steradian; c = cos of the angle
// between the light's travel and the view ray toward the eye's opposite
// (c = 1: straight on, forward scattering)
export function hg(gg, c) { const g2 = gg * gg; return (1 - g2) / (4 * Math.PI * Math.pow(1 + g2 - 2 * gg * c, 1.5)); }
// the two lobes: forward g1 with weight w, back g2 with 1 - w
export const PHASE = { g1: 0.62, g2: -0.22, w: 0.82 };
export function phase(c, p = PHASE) { return p.w * hg(p.g1, c) + (1 - p.w) * hg(p.g2, c); }

// The smoke rules (shaders/smoke.wgsl reads them from the uniform)
export const SMOKE = {
  boilLo: 2600, boilHi: 4200,   // K: hot, expanded matter counts as gas
  rhoLo: 0.25, rhoHi: 0.6,      // rho / rho0: the expanded range
  condLo: 1800, condHi: 2400,   // K: vapour condenses to dust under this
  // vapourCap: T0 at contact -> T1, e-fold capH hours. T1 is about the
  // photosphere of a silicate vapour cloud (2300 K, Lock and Stewart 2017)
  capT0: 5200, capT1: 2200, capH: 1.0,
  dustShed: 0.35,               // the share of a debris particle drawn as dust
};
// the highest drawn gas temperature, hours h after contact (h < 0: before)
export function vapourCap(h, s = SMOKE) { return s.capT1 + (s.capT0 - s.capT1) * Math.exp(-Math.max(h, 0) / s.capH); }
function sstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
// 0: hot vapour, 1: condensed to dust
export function condensed(Tg, s = SMOKE) { return 1 - sstep(s.condLo, s.condHi, Tg); }
// p: { xv, T, rhoRatio (rho / rho0), debris (bool), coolH, xvLo, xvHi }
// -> { gas, dust, Tgas }: the share of the particle drawn as gas and as
// dust (0..1 each) and the drawn gas temperature (K)
export function smokeWeights(p, s = SMOKE) {
  const xvLo = p.xvLo ?? 0.05, xvHi = p.xvHi ?? 0.5;
  const fromXv = sstep(xvLo, xvHi, p.xv);
  const hotExp = sstep(s.boilLo, s.boilHi, p.T) * (1 - sstep(s.rhoLo, s.rhoHi, p.rhoRatio));
  const vap = Math.max(fromXv, hotExp);
  const Tgas = Math.min(p.T, vapourCap(p.coolH ?? -1, s));
  const cond = condensed(Tgas, s);
  const shed = p.debris ? s.dustShed : 0;
  return { gas: vap * (1 - cond), dust: Math.min(1, vap * cond + shed * (1 - vap)), Tgas };
}

// ── the bodies: the skin of the melt ────────────────────────────────────
// the highest skin temperature (K) h hours after contact; rate the time
// constant (0.6 h the bulk, 0.25 h free drops). Before contact: 4000 K.
export function skinCap(h, rate = 0.6) { return 1700 + 2300 * Math.exp(-Math.max(h, 0) / rate); }
export function skinT(T, h, rate = 0.6) { return Math.min(T, skinCap(h, rate)); }
// the share of a melt surface under crust, h hours after contact
export function crustShare(h) { return h < 0 ? 0 : Math.min(0.85, Math.max(0, 1.1 * (1 - Math.exp(-(h + 0.15) / 1.1)))); }
// the drawn radiance scale of incandescent matter (common.wgsl fn glow,
// without the colour): T^4 from the Draper point, a soft limit at 3
export function glowRadiance(T, gain = 0.6) {
  const on = sstep(750, 1100, T), k = gain * Math.max(Math.pow(T / 1500, 4) - 0.0625, 0);
  return on * 3 * (1 - Math.exp(-k / 3));
}
// T (K), Tmelt (K), h (hours since contact), xv -> the state the renderer
// draws: 'vapour' | 'melt' | 'crust' | 'hot' | 'solid', with the skin T
// and the radiance. A melt surface is 'crust' when the time share of crust
// is over one half (the median point of the surface).
export function matterState(T, Tmelt, h, xv = 0, xvHi = 0.5) {
  if (xv > xvHi) return { state: 'vapour', Ts: Math.min(T, vapourCap(h)), L: glowRadiance(Math.min(T, vapourCap(h))) };
  const Ts = skinT(T, h);
  if (T >= Tmelt) {
    const crust = crustShare(h) > 0.5 && T >= 1100;
    const Tvis = crust ? Math.max(0.42 * Ts, 700) : Ts;
    return { state: crust ? 'crust' : 'melt', Ts: Tvis, L: glowRadiance(Tvis) };
  }
  if (T >= 0.7 * Tmelt) return { state: 'hot', Ts, L: glowRadiance(Ts) };
  return { state: 'solid', Ts, L: glowRadiance(Ts) };
}
// The drawn temperature of the inside on the cut face (K), r: the radius
// share (0 centre, 1 surface), iron: 1 in the core. A smooth fit to the
// present Earth (about 5400 K at the centre, 4000 K at the core-mantle
// boundary, 1600 K under the lithosphere), drawn, not simulated.
export const GEOTHERM = { centre: 5400, cmb: 4000, mantle: 1600, surface: 300 };
export function geotherm(r, iron, G = GEOTHERM) {
  const x = Math.min(1, Math.max(0, r));
  if (iron > 0.5) return G.centre + (G.cmb - G.centre) * Math.min(1, (x / 0.55) ** 2);
  // the mantle: from the core boundary (0.55 R) to the base of the
  // lithosphere, then a steep fall through the outer 6 %
  const m = G.cmb + (G.mantle - G.cmb) * Math.min(1, Math.max(0, (x - 0.55) / 0.39));
  return x <= 0.94 ? m : G.mantle + (G.surface - G.mantle) * (x - 0.94) / 0.06;
}
