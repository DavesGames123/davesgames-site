// ============================================================================
//  DIAMOND LAB  ·  optics.js — materials, dispersion and the ray maths
// ----------------------------------------------------------------------------
//  DOM-free ES module. main.js, saver.js and tests.mjs import it. The
//  shader (shaders/gem.wgsl) does the same maths per pixel; traceRay() is
//  the CPU copy of the shader loop, so node tests can check the optics.
//
//  Units: wavelength in micrometres (um). Angles in radians unless a name
//  ends in Deg.
//
//  Dispersion model: the Cauchy form n(l) = A + B / l^2. A and B come from
//  the refractive index n_d at the helium d line (587.6 nm) and the Abbe
//  number v_d = (n_d - 1) / (n_F - n_C). The "fire" factor scales the
//  spread about n_d: n = n_d + fire * (n(l) - n_d). fire = 1 is the real
//  stone.
//
//  Gemmologists quote dispersion as B-G: n(430.8 nm) - n(686.7 nm), the
//  Fraunhofer G and B lines. dispersionBG() gives it from A and B, and the
//  tests check it against the table values (diamond 0.044, and so on).
//
//  GREP MAP
//    const MATERIALS ........ the stones: n_d, Abbe number, absorption
//    function cauchy ........ A, B from n_d and v_d
//    function dispersionBG .. B-G dispersion
//    function criticalAngle . theta_c = asin(1 / n)
//    function fresnel ....... exact unpolarised reflectance
//    function refract ....... vector form of Snell's law (null on TIR)
//    function cie ........... CIE 1931 colour matching fit (Wyman 2013)
//    function spectralSamples  wavelengths and RGB weights for the shader
//    function traceRay ...... the shader's bounce loop on the CPU
// ============================================================================

export const LAMBDA = { F: 0.4861, d: 0.5876, C: 0.6563, G: 0.4308, B: 0.6867 };

// absorb is the Beer-Lambert coefficient per unit length in R, G, B. The
// gem is about 2 units across, so 1.0 takes a straight path to e^-2.
// Indices and dispersion: GIA and Gem-A reference tables (mean of the
// quoted range for the doubly refracting stones).
export const MATERIALS = {
  diamond:    { name: 'Diamond',          nd: 2.417, abbe: 55,  absorb: [0, 0, 0],          dot: '#e8f0ff', note: 'Cubic carbon. The high index traps light; the dispersion splits it into fire.' },
  moissanite: { name: 'Moissanite',       nd: 2.65,  abbe: 27,  absorb: [0.02, 0.01, 0.07], dot: '#e9f6e6', note: 'Silicon carbide. More index and more than twice the fire of diamond.' },
  cz:         { name: 'Cubic zirconia',   nd: 2.16,  abbe: 33,  absorb: [0, 0, 0],          dot: '#f4f4f4', note: 'Zirconium dioxide. More fire than diamond, but less brilliance.' },
  yellow:     { name: 'Yellow diamond',   nd: 2.417, abbe: 55,  absorb: [0.04, 0.16, 1.5],  dot: '#ffd34a', note: 'Diamond with nitrogen. The nitrogen absorbs blue.' },
  sapphire:   { name: 'Blue sapphire',    nd: 1.77,  abbe: 72,  absorb: [2.2, 1.1, 0.12],   dot: '#2f62ff', note: 'Corundum with iron and titanium. It absorbs red and yellow.' },
  ruby:       { name: 'Ruby',             nd: 1.77,  abbe: 72,  absorb: [0.08, 2.6, 1.5],   dot: '#ff2a55', note: 'Corundum with chromium. It absorbs green and violet.' },
  emerald:    { name: 'Emerald',          nd: 1.58,  abbe: 71,  absorb: [1.6, 0.12, 0.9],   dot: '#1fd17a', note: 'Beryl with chromium and vanadium. A low index: it glows, it does not sparkle.' },
  amethyst:   { name: 'Amethyst',         nd: 1.544, abbe: 70,  absorb: [0.5, 1.5, 0.25],   dot: '#a45cff', note: 'Quartz with iron. It absorbs green.' },
  glass:      { name: 'Crown glass',      nd: 1.517, abbe: 64,  absorb: [0.03, 0.01, 0.03], dot: '#cfe9e4', note: 'BK7 glass. The critical angle is 41°, so most light leaks out of the pavilion.' },
};
export const MATERIAL_KEYS = Object.keys(MATERIALS);

// Cauchy A and B (um^2) from n_d and the Abbe number.
export function cauchy(nd, abbe) {
  const B = (nd - 1) / abbe / (1 / LAMBDA.F ** 2 - 1 / LAMBDA.C ** 2);
  return { A: nd - B / LAMBDA.d ** 2, B };
}
export function indexAt(nd, abbe, lambda, fire = 1) {
  const { A, B } = cauchy(nd, abbe);
  return nd + fire * (A + B / (lambda * lambda) - nd);
}
export function dispersionBG(nd, abbe) {
  const { B } = cauchy(nd, abbe);
  return B * (1 / LAMBDA.G ** 2 - 1 / LAMBDA.B ** 2);
}
// The angle past which light inside a stone of index n cannot leave to air.
export function criticalAngle(n, outside = 1) { return Math.asin(outside / n); }
// Normal-incidence reflectance R0 = ((n - 1) / (n + 1))^2.
export function reflectance0(n, outside = 1) { return ((n - outside) / (n + outside)) ** 2; }

// Exact Fresnel reflectance for unpolarised light, from medium n1 into n2,
// with ci = cos of the angle of incidence (0..1). Total internal
// reflection gives 1.
export function fresnel(ci, n1, n2) {
  const s2 = (n1 / n2) ** 2 * (1 - ci * ci);
  if (s2 >= 1) return 1;
  const ct = Math.sqrt(1 - s2);
  const rs = (n1 * ci - n2 * ct) / (n1 * ci + n2 * ct);
  const rp = (n2 * ci - n1 * ct) / (n2 * ci + n1 * ct);
  return 0.5 * (rs * rs + rp * rp);
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const normalize = a => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));
export function reflect(d, n) { return add(d, n, -2 * dot(d, n)); }
// Snell in vector form. d is the unit ray, nrm the unit normal on the side
// the ray comes from (dot(d, nrm) < 0), eta = n1 / n2. null on TIR.
export function refract(d, nrm, eta) {
  const ci = -dot(d, nrm), k = 1 - eta * eta * (1 - ci * ci);
  if (k < 0) return null;
  return add(scale(d, eta), nrm, eta * ci - Math.sqrt(k));
}

// CIE 1931 2-degree colour matching functions, the multi-lobe Gaussian fit
// of Wyman, Sloan and Shirley (JCGT 2013). lambda in nm.
function g(x, mu, s1, s2) { const t = (x - mu) / (x < mu ? s1 : s2); return Math.exp(-0.5 * t * t); }
export function cie(nm) {
  const x = 1.056 * g(nm, 599.8, 37.9, 31.0) + 0.362 * g(nm, 442.0, 16.0, 26.7) - 0.065 * g(nm, 501.1, 20.4, 26.2);
  const y = 0.821 * g(nm, 568.8, 46.9, 40.5) + 0.286 * g(nm, 530.9, 16.3, 31.1);
  const z = 1.217 * g(nm, 437.0, 11.8, 36.0) + 0.681 * g(nm, 459.0, 26.0, 13.8);
  return [x, y, z];
}
export function xyzToLinearSRGB([x, y, z]) {
  return [3.2406 * x - 1.5372 * y - 0.4986 * z, -0.9689 * x + 1.8758 * y + 0.0415 * z, 0.0557 * x - 0.2040 * y + 1.0570 * z];
}

// The wavelengths the shader traces, and the RGB weight of each. count 1
// is plain refraction at n_d with weight (1, 1, 1). For count >= 2 the
// wavelengths span 410..690 nm evenly; each weight is the clamped sRGB
// colour of that wavelength, and each channel is then scaled so that the
// weights add to 1. So white light that takes the same path at every
// wavelength stays white.
export function spectralSamples(count) {
  if (count <= 1) return [{ lambda: LAMBDA.d, w: [1, 1, 1] }];
  const out = [];
  for (let k = 0; k < count; k++) {
    const nm = 410 + (k + 0.5) / count * 280;
    out.push({ lambda: nm / 1000, w: xyzToLinearSRGB(cie(nm)).map(v => Math.max(0, v)) });
  }
  for (let c = 0; c < 3; c++) {
    const s = out.reduce((a, o) => a + o.w[c], 0);
    for (const o of out) o.w[c] = s > 0 ? o.w[c] / s : 1 / count;
  }
  return out;
}

// Readouts for a material: the numbers the panel and the saver plate show.
export function materialStats(m) {
  return {
    nd: m.nd, abbe: m.abbe, bg: dispersionBG(m.nd, m.abbe),
    critDeg: criticalAngle(m.nd) * 180 / Math.PI, r0: reflectance0(m.nd),
  };
}

// ── CPU copy of the shader loop ─────────────────────────────────────────────
// planes: [{ n: [x,y,z], d }] with the gem inside n.x <= d. One wavelength
// of index n. Returns the exits: [{ dir, w, bounces }], the reflected part
// of the entry first. w is the energy share (no absorption here).
// The loop is the same as fs_gem in shaders/gem.wgsl: enter, then up to
// maxBounces internal hits; at each hit the transmitted part leaves, and
// the reflected part goes on (all of it on TIR). What is left after the
// last hit leaves along the last direction (the shader does the same, so
// that no pixel goes black).
export function enterGem(planes, o, d) {
  let tN = -Infinity, tF = Infinity, nN = null;
  for (const p of planes) {
    const den = dot(p.n, d), dist = p.d - dot(p.n, o);
    if (Math.abs(den) < 1e-9) { if (dist < 0) return null; continue; }
    const t = dist / den;
    if (den < 0) { if (t > tN) { tN = t; nN = p.n; } } else tF = Math.min(tF, t);
  }
  if (!nN || tN > tF || tF < 0) return null;
  return { t: tN, n: nN, p: add(o, d, tN) };
}
export function exitGem(planes, p, d) {
  let tm = Infinity, ne = null;
  for (const pl of planes) {
    const den = dot(pl.n, d);
    if (den > 1e-9) { const t = Math.max((pl.d - dot(pl.n, p)) / den, 0); if (t < tm) { tm = t; ne = pl.n; } }
  }
  return ne ? { t: tm, n: ne, p: add(p, d, tm) } : null;
}
export function traceRay(planes, o, d, n, maxBounces = 8) {
  const hit = enterGem(planes, o, d);
  if (!hit) return null;
  const ci = -dot(d, hit.n), R = fresnel(ci, 1, n);
  const exits = [{ dir: reflect(d, hit.n), w: R, bounces: 0 }];
  let dir = refract(d, hit.n, 1 / n), p = hit.p, thr = 1 - R;
  for (let b = 0; b < maxBounces; b++) {
    const ex = exitGem(planes, p, dir);
    if (!ex) break;
    p = ex.p;
    const c = dot(dir, ex.n), rdir = reflect(dir, ex.n);
    const out = refract(dir, scale(ex.n, -1), n);
    if (!out) { dir = rdir; if (b === maxBounces - 1) exits.push({ dir, w: thr, bounces: b + 1, left: true }); continue; }
    const Rf = fresnel(c, n, 1);
    exits.push({ dir: out, w: thr * (1 - Rf), bounces: b + 1 });
    thr *= Rf; dir = rdir;
    if (b === maxBounces - 1) exits.push({ dir, w: thr, bounces: b + 1, left: true });
  }
  return exits;
}
// Light return of a ray: the share of its energy that leaves upward (y > 0),
// the way a face-up stone sends light back to the eye.
export function lightReturn(exits) {
  return exits ? exits.filter(e => e.dir[1] > 0).reduce((a, e) => a + e.w, 0) : 0;
}
