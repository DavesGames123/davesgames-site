// ============================================================================
//  CORAL REEF  ·  the deep water: waves, caustics, the plot fade (DOM-free)
// ----------------------------------------------------------------------------
//  scene.js and shaders.js use these numbers on the GPU. tests/scene.test.mjs
//  uses the CPU copies to measure the caustic pattern (no browser here).
//
//  WAVES. waveSpectrum(seed) gives a random, multi-scale wave surface: a
//  long swell (25 to 60 m), wind sea (4 to 20 m) and short chop (0.9 to
//  4 m). Each wave has its own direction, length and phase, from a log
//  spread of lengths and a wide spread of directions. No wave number is a
//  multiple of a tile, so the surface does not repeat. omega = sqrt(g k).
//
//  CAUSTICS. The mesh-area method of pages/photon-caustics: a grid of sun
//  rays refracts at the surface and falls a focal depth D. The light at a
//  floor point is the ratio of the cell area before and after the fall.
//  causticField() is the CPU form of the same method (rays binned to a
//  grid), for the tests and the node renders. The GPU pass is in scene.js
//  (makeCaustics) with CAUSTIC_VS / CAUSTIC_FS of shaders.js.
//
//  BREAK UP. causticAt() of shaders.js does not use the map as it is. It
//  warps the look-up point with slow fbm noise (about 2 m), and it scales
//  the contrast by a large patch field (about 40 m) that drifts. So the
//  net breaks into patches that come and go. patchAt() and warpAt() here
//  are the same noise as the GLSL (the same integer hash), so the CPU
//  copy (causticPattern) matches the screen.
//
//  PLOT. One circular reef plot of radius R. fadeAt(r, R) is 1 inside R
//  and goes to 0 at FADE_K * R with a smooth step, so the rock, the sand
//  and the corals go into the black water with no edge.
//
//  grep -n targets
//    the spectrum ......... "export function waveSpectrum"
//    the surface .......... "export function surfaceAt"
//    CPU caustic map ...... "export function causticField"
//    warp and patches ..... "export function warpAt"
//    the final pattern .... "export function causticPattern"
//    the map round the eye  "export function causticView" (mips, fades,
//                           "export function noiseOffsets", "export function wavePhases")
//    plot fade ............ "export function fadeAt"
//    autocorrelation ...... "export function autocorrPeak"
// ============================================================================

export const FADE_K = 1.3;           // the plot fades out between R and 1.3 R
export const SURFACE_Y = 55;         // the sea surface, m over the plot datum
export const CAUSTIC_D = 24;         // focal depth of the caustic pass, m (the short chop focuses near it)
export const N_WAVES = 28;           // waves in the spectrum (the GPU uniform array size)
const G = 9.81, TAU = Math.PI * 2;

function mulberry(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// [kx, kz, amp, phase] per wave. The slope of each wave (k a) is small, so
// the sum stays a gentle sea; the short chop carries most of the slope.
export function waveSpectrum(seed = 1, n = N_WAVES) {
  const r = mulberry(seed * 2654435761 + 17);
  const wind = r() * TAU;
  const out = [];
  for (let i = 0; i < n; i++) {
    const band = i < 4 ? 0 : i < 13 ? 1 : 2;
    const [l0, l1, sl, spread] = band === 0 ? [25, 60, 0.012, 0.5] : band === 1 ? [4, 20, 0.028, 1.1] : [0.9, 4, 0.045, 1.7];
    const lam = l0 * Math.pow(l1 / l0, r());
    const k = TAU / lam;
    const a = wind + (r() - 0.5) * 2 * spread + (band === 0 && r() < 0.5 ? 0.9 : 0);
    const amp = sl * (0.5 + r()) / k;
    out.push([Math.cos(a) * k, Math.sin(a) * k, amp, r() * TAU]);
  }
  return out;
}

// Height and slope of the surface at (x, z), time t: [h, dh/dx, dh/dz].
export function surfaceAt(waves, x, z, t) {
  let h = 0, sx = 0, sz = 0;
  for (const [kx, kz, a, ph] of waves) {
    const om = Math.sqrt(G * Math.hypot(kx, kz));
    const q = kx * x + kz * z - om * t + ph;
    h += a * Math.sin(q);
    const c = a * Math.cos(q);
    sx += c * kx; sz += c * kz;
  }
  return [h, sx, sz];
}

// Snell refraction of unit d by unit normal n, index ratio eta (GLSL refract).
function refract(d, n, eta) {
  const c = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
  const k = 1 - eta * eta * (1 - c * c);
  if (k < 0) return null;
  const s = eta * c + Math.sqrt(k);
  return [eta * d[0] - s * n[0], eta * d[1] - s * n[1], eta * d[2] - s * n[2]];
}

// The CPU caustic map over a square: x0, z0, size (m), res (texels). Rays
// start on a grid sub x finer than the map, over the square and a margin,
// refract and fall D, and each ray adds to the texel that it hits. Returns
// { E (Float32Array, mean 1 inside), res, x0, z0, size }.
export function causticField({ waves, t = 0, x0 = -32, z0 = -32, size = 64, res = 256, sub = 4, D = CAUSTIC_D, sun = [0.18, -1, 0.1], margin = 4 } = {}) {
  const E = new Float32Array(res * res);
  const sl = Math.hypot(...sun), sd = sun.map(v => v / sl);
  const T0 = refract(sd, [0, 1, 0], 1 / 1.333);
  const ox = T0[0] * (D / -T0[1]), oz = T0[2] * (D / -T0[1]);   // the flat-sea shift: subtract it
  const n = res * sub, m = Math.ceil(margin / size * n), step = size / n;
  for (let j = -m; j < n + m; j++) {
    for (let i = -m; i < n + m; i++) {
      const x = x0 + (i + 0.5) * step, z = z0 + (j + 0.5) * step;
      const [h, sx, sz] = surfaceAt(waves, x, z, t);
      const L = Math.hypot(sx, 1, sz), N = [-sx / L, 1 / L, -sz / L];
      const T = refract(sd, N, 1 / 1.333); if (!T) continue;
      const f = (D + h) / -T[1];
      const qx = x + T[0] * f - ox, qz = z + T[2] * f - oz;
      const u = (qx - x0) / size * res - 0.5, v = (qz - z0) / size * res - 0.5;
      const iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
      const add = (a, b, w) => { if (a >= 0 && b >= 0 && a < res && b < res) E[b * res + a] += w; };
      add(iu, iv, (1 - fu) * (1 - fv)); add(iu + 1, iv, fu * (1 - fv)); add(iu, iv + 1, (1 - fu) * fv); add(iu + 1, iv + 1, fu * fv);
    }
  }
  const k = 1 / (sub * sub);
  for (let i = 0; i < E.length; i++) E[i] *= k;
  return { E, res, x0, z0, size };
}

// ── noise: the same integer hash and value noise as NOISE2 in shaders.js ─────
export function hash2(ix, iz) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise2(x, z) {
  const fx = Math.floor(x), fz = Math.floor(z), ix = fx | 0, iz = fz | 0;
  const u = x - fx, v = z - fz;
  const su = u * u * u * (u * (u * 6 - 15) + 10), sv = v * v * v * (v * (v * 6 - 15) + 10);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}
// 4 octaves, each turned 37 degrees and scaled 2.03, so no axis shows.
export function fbm2(x, z) {
  let s = 0, a = 0.5, px = x, pz = z;
  const c = 0.7986, sn = 0.6018;
  for (let o = 0; o < 4; o++) {
    s += a * vnoise2(px, pz);
    const nx = (c * px - sn * pz) * 2.03 + 17.1, nz = (sn * px + c * pz) * 2.03 + 3.7;
    px = nx; pz = nz; a *= 0.5;
  }
  return s / 0.9375;
}
// The warp of the look-up point (m), and the patch contrast (0..1).
export function warpAt(x, z, t) {
  return [
    (fbm2(x * 0.11 + t * 0.021, z * 0.11) - 0.5) * 4.4,
    (fbm2(x * 0.11 + 31.7, z * 0.11 - t * 0.017) - 0.5) * 4.4,
  ];
}
export function patchAt(x, z, t) {
  const p = fbm2(x * 0.026 + t * 0.006, z * 0.026 - t * 0.004 + 9.1);
  const s = Math.min(1, Math.max(0, (p - 0.32) / 0.4));
  return 0.12 + 0.88 * s * s * (3 - 2 * s);
}

// Bilinear look-up of a field (clamped at the edge).
function lookup(F, x, z) {
  const u = Math.min(F.res - 1.001, Math.max(0, (x - F.x0) / F.size * F.res - 0.5));
  const v = Math.min(F.res - 1.001, Math.max(0, (z - F.z0) / F.size * F.res - 0.5));
  const iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv, r = F.res, E = F.E;
  return E[iv * r + iu] * (1 - fu) * (1 - fv) + E[iv * r + iu + 1] * fu * (1 - fv) + E[(iv + 1) * r + iu] * (1 - fu) * fv + E[(iv + 1) * r + iu + 1] * fu * fv;
}

// The caustic light factor that a flat floor gets (mean about 1), as
// causticAt() of shaders.js: log-compressed map, warped, patch contrast.
export function causticPattern(F, x, z, t, strength = 1) {
  const w = warpAt(x, z, t);
  const e = Math.min(3.2, Math.log2(1 + lookup(F, x + w[0], z + w[1])));
  return 1 + (e - 1) * patchAt(x, z, t) * strength;
}

// ── the caustic map round the eye (shaders.js causticAtF) ───────────────────
// The world offsets of the caustic noise for a map centre (cx, cz) in world
// metres: for the warp (scale 0.11) and the patches (0.026), per octave the
// integer part and the fraction of the octave origin. The GPU adds them to
// small coordinates relative to the centre, so f32 keeps its precision and
// an origin shift does not move the pattern. 32 floats (uCausN[8]).
export function noiseOffsets(cx, cz, out = new Float64Array(32)) {
  const c = 0.7986, sn = 0.6018;
  [0.11, 0.026].forEach((sc, s) => {
    let wx = cx * sc, wz = cz * sc;
    for (let o = 0; o < 4; o++) {
      const ix = Math.floor(wx), iz = Math.floor(wz), k = (s * 4 + o) * 4;
      out[k] = ix; out[k + 1] = iz; out[k + 2] = wx - ix; out[k + 3] = wz - iz;
      const nx = (c * wx - sn * wz) * 2.03 + 17.1, nz = (sn * wx + c * wz) * 2.03 + 3.7;
      wx = nx; wz = nz;
    }
  });
  return out;
}
// The wave phases for a map centred on (cx, cz) world: phase + k . centre,
// mod 2 pi (the GPU pass then uses coordinates relative to the centre).
export function wavePhases(waves, cx, cz) {
  return waves.map(([kx, kz, a, ph]) => { const q = (ph + kx * cx + kz * cz) % TAU; return [kx, kz, a, q < 0 ? q + TAU : q]; });
}
const f32 = Math.fround;
// fbm2 with an offset set (the GLSL fbm2o, in f32 steps). p: local.
function fbm2o(px, pz, N, set) {
  let s = 0, a = 0.5;
  for (let o = 0; o < 4; o++) {
    const k = (set * 4 + o) * 4;
    const x = f32(px + N[k + 2]), z = f32(pz + N[k + 3]), fx = Math.floor(x), fz = Math.floor(z);
    const ix = (fx + N[k]) | 0, iz = (fz + N[k + 1]) | 0, u = f32(x - fx), v = f32(z - fz);
    const su = u * u * u * (u * (u * 6 - 15) + 10), sv = v * v * v * (v * (v * 6 - 15) + 10);
    const A = hash2(ix, iz), B = hash2(ix + 1, iz), C = hash2(ix, iz + 1), D = hash2(ix + 1, iz + 1);
    s += a * (A + (B - A) * su + (C - A) * sv + (A - B - C + D) * su * sv);
    const nx = f32((0.7986 * px - 0.6018 * pz) * 2.03), nz = f32((0.6018 * px + 0.7986 * pz) * 2.03);
    px = nx; pz = nz; a *= 0.5;
  }
  return s / 0.9375;
}
// The mips of a caustic field (box filter, as the GPU makes them).
export function causticMips(F) {
  const L = [F.E];
  for (let r = F.res; r > 1; r >>= 1) {
    const a = L[L.length - 1], h = r >> 1, b = new Float32Array(h * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < h; x++) b[y * h + x] = (a[2 * y * r + 2 * x] + a[2 * y * r + 2 * x + 1] + a[(2 * y + 1) * r + 2 * x] + a[(2 * y + 1) * r + 2 * x + 1]) / 4;
    L.push(b);
  }
  F.mips = L;
  return F;
}
function lookupLod(F, x, z, lod) {
  const at = (l) => {
    const E = F.mips[l], r = F.res >> l;
    const u = Math.min(r - 1.001, Math.max(0, (x - F.x0) / F.size * r - 0.5)), v = Math.min(r - 1.001, Math.max(0, (z - F.z0) / F.size * r - 0.5));
    if (r < 2) return E[0];
    const iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
    return E[iv * r + iu] * (1 - fu) * (1 - fv) + E[iv * r + iu + 1] * fu * (1 - fv) + E[(iv + 1) * r + iu] * (1 - fu) * fv + E[(iv + 1) * r + iu + 1] * fu * fv;
  };
  const l0 = Math.min(F.mips.length - 1, Math.floor(lod)), l1 = Math.min(F.mips.length - 1, l0 + 1), f = lod - Math.floor(lod);
  return at(l0) * (1 - f) + at(l1) * f;
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// The caustic factor of shaders.js causticAtF (the green tap), for a floor
// point. F: causticField over the map square, with causticMips. view: {
// origin [ox, oz], centre [cx, cz] (render space), x, y, z (render space),
// fp (m, the pixel footprint), t, depth (m), strength }. lod: false for the
// old look-up (mip 0, no fades) that the tests compare with.
export function causticView(F, v, lod = true) {
  const O = v.origin || [0, 0], C = v.centre;
  const N = noiseOffsets(C[0] + O[0], C[1] + O[1]);
  const qlx = f32(v.x - C[0]), qlz = f32(v.z - C[1]);
  const edge = Math.max(Math.abs(qlx), Math.abs(qlz)) / (0.5 * F.size);
  const L = lod ? Math.min(10, Math.max(0, Math.log2(Math.max(v.fp, 1e-5) / (F.size / F.res)))) : 0;
  const k = lod ? (1 - sstep(0.62, 0.9, edge)) * (1 - sstep(1.5, 4, L)) * sstep(90, 20, v.depth ?? 10) : 1;
  if (k <= 0) return 1;
  const t = v.t || 0;
  const wx = (fbm2o(f32(qlx * 0.11 + t * 0.021), f32(qlz * 0.11), N, 0) - 0.5) * 4.4;
  const wz = (fbm2o(f32(qlx * 0.11 + 31.7), f32(qlz * 0.11 - t * 0.017), N, 0) - 0.5) * 4.4;
  const pt = fbm2o(f32(qlx * 0.026 + t * 0.006), f32(qlz * 0.026 - t * 0.004 + 9.1), N, 1);
  const s = Math.min(1, Math.max(0, (pt - 0.32) / 0.4)), pch = 0.12 + 0.88 * s * s * (3 - 2 * s);
  // the field is in world metres: the map square is round C + O
  const e = Math.min(3.2, Math.log2(1 + lookupLod(F, qlx + wx + C[0] + O[0], qlz + wz + C[1] + O[1], L)));
  return 1 + (e - 1) * pch * (v.strength ?? 1) * k;
}

// 1 inside the plot, 0 past FADE_K R, smooth.
export function fadeAt(r, R) {
  const s = Math.min(1, Math.max(0, (r - R) / ((FADE_K - 1) * R)));
  return 1 - s * s * (3 - 2 * s);
}

// ── autocorrelation (tests) ─────────────────────────────────────────────────
function fft1(re, im, inv) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (inv ? 2 : -2) * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
function fft2(re, im, n, inv) {
  const r = new Float64Array(n), i = new Float64Array(n);
  for (let y = 0; y < n; y++) { for (let x = 0; x < n; x++) { r[x] = re[y * n + x]; i[x] = im[y * n + x]; } fft1(r, i, inv); for (let x = 0; x < n; x++) { re[y * n + x] = r[x]; im[y * n + x] = i[x]; } }
  for (let x = 0; x < n; x++) { for (let y = 0; y < n; y++) { r[y] = re[y * n + x]; i[y] = im[y * n + x]; } fft1(r, i, inv); for (let y = 0; y < n; y++) { re[y * n + x] = r[y]; im[y * n + x] = i[y]; } }
}
// img: n x n samples (n a power of 2). A Hann window, the mean removed,
// then the autocorrelation by FFT (Wiener-Khinchin), normalised to 1 at
// lag 0. Returns { peak, lag, corrLen, specPeak }: the highest value at a
// lag past the central lobe (past corrLen px and minLag px), its lag in px,
// the lag where the central lobe first drops under 0.2, and the largest
// share of the power that one frequency bin holds.
export function autocorrPeak(img, n, minLag = 4) {
  const re = new Float64Array(n * n), im = new Float64Array(n * n);
  let mean = 0; for (let i = 0; i < n * n; i++) mean += img[i]; mean /= n * n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const w = (0.5 - 0.5 * Math.cos(TAU * (x + 0.5) / n)) * (0.5 - 0.5 * Math.cos(TAU * (y + 0.5) / n));
    re[y * n + x] = (img[y * n + x] - mean) * w;
  }
  fft2(re, im, n, false);
  let tot = 0, top = 0;
  for (let i = 0; i < n * n; i++) { const p = re[i] * re[i] + im[i] * im[i]; re[i] = p; im[i] = 0; if (i) { tot += p; } }
  for (let i = 1; i < n * n; i++) top = Math.max(top, re[i] / tot);
  fft2(re, im, n, true);
  const a0 = re[0];
  const at = (dx, dy) => re[((dy + n) % n) * n + ((dx + n) % n)] / a0;
  let corrLen = 1;
  for (; corrLen < n / 2; corrLen++) {
    let s = 0; for (let k = 0; k < 16; k++) { const a = k / 16 * TAU; s += at(Math.round(Math.cos(a) * corrLen), Math.round(Math.sin(a) * corrLen)); }
    if (s / 16 < 0.2) break;
  }
  const r0 = Math.max(minLag, corrLen * 1.5);
  let peak = -1, lag = 0;
  for (let dy = -n / 4; dy <= n / 4; dy++) for (let dx = -n / 4; dx <= n / 4; dx++) {
    const d = Math.hypot(dx, dy); if (d < r0) continue;
    const v = at(dx, dy); if (v > peak) { peak = v; lag = d; }
  }
  return { peak, lag, corrLen, specPeak: top };
}
