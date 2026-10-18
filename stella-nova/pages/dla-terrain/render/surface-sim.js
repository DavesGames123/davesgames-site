// ============================================================================
//  DLA TERRAIN  ·  render/surface-sim.js — ground material fields (GROUND)
// ----------------------------------------------------------------------------
//  DOM-free. simulateSurface(terrain) derives the material fields of the
//  ground from the history of the terrain (the LIB Terrain: height, flow,
//  sediment, water, river, moisture, temperature, opts). ground.js uploads
//  them as one rgba8unorm 2D array texture (4 layers) and shaders/ground.wgsl
//  shades them. The same seed and options give the same bytes.
//
//  THE FIELDS (layer.channel, all 0..1)
//    0.r regolith   soil depth: production less transport. Thin on steep
//                   ground (1 - (S / Sc)^2), thick in hollows (curvature),
//                   stripped by stream power, thick on LIB sediment; frost
//                   and arid ground thin it. 1 - regolith = bare bedrock.
//    0.g scree      talus deposits. Rock fall from faces steeper than the
//                   talus angle (more in the frost band, -12..+4 C) runs
//                   down the slope, split over the lower neighbours (MFD,
//                   so it fans out), and settles at the angle of repose.
//                   Rivers carry it away.
//    0.b alluvium   LIB sediment (fans, flood plains, deltas), 1 - e^-s/1.5
//    0.a wet        wet banks: distance to rivers, lakes and the sea
//    1.r drift      wind-blown snow: 0.5 neutral, > 0.5 lee (Winstral Sx,
//                   the upwind horizon angle over 300 m), < 0.5 scoured
//                   (exposed convex crests)
//    1.g cornice    sharp crests with a steep lee side under the wind
//    1.b age        exposure age: low stream power, no fresh scree or
//                   deposit (lichen, moss, desert varnish grow with it)
//    1.a playa      dry, flat, closed basins with fines: mud cracks
//    2.r strata     the phase warp of the rock layers (0.5 = none, the
//                   phase is 6 x (r - 0.5)): the LIB hardness bands of
//                   erodeGrid (0.35 fbm) plus a fold warp where the LIB has
//                   no strata
//    2.g glacial    ice-polished rock in the big glacial valleys
//    2.b iceDir     valley axis angle / PI (striations run along it)
//    2.a scar       bare soil: slips on near-critical soil slopes, gullies
//    3.r dir        D8 receiver code x 28 / 255 (code 8 = none): drainage lines
//    3.g chan       log10 upstream area: (log10 A km2 + 2.5) / 5
//    3.b coarse     grain of deposits: 1 gravel (steep fans, beds), 0 silt
//    3.a erosion    stream power index sqrt(A) S, log scaled
//
//  The fields live on a grid of min(n, res) (1024 at most, 512 on Low and
//  phones). The shader adds the detail under one texel (strata bands,
//  drainage lines from the dir field, dunes, cracks).
//
//  JS twins of shader functions (the tests use them): dune (fn dune),
//  snowAmount (fn snowAmount), drainLine (fn drainLine), strataPhase.
//
//  grep -n targets: "export function surfRes", "export function windOf",
//  "export async function simulateSurface", "function d8", "function scree",
//  "function windExposure", "export function packSurface",
//  "export function dune", "export function snowAmount",
//  "export function drainLine", "export function strataParams"
// ============================================================================

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const D2R = Math.PI / 180;
export const SURF_LAYERS = 4;
// D8 neighbour order (code k): the same as the LIB routeD8
export const DXS = [1, -1, 0, 0, 1, 1, -1, -1];
export const DZS = [0, 0, 1, -1, 1, -1, 1, -1];
const DIST = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

// field grid size: the terrain n, capped at 1024 (512 on Low and phones)
export function surfRes(n, quality = 1, coarse = false) {
  return Math.min(n, coarse || quality < 0.45 ? 512 : 1024);
}

// the prevailing wind of LIB climate: the direction it blows toward (0 deg
// is +x, 90 is +z, as LIB OPTIONS windAngle)
export function windOf(o) {
  const a = ((o && o.windAngle != null) ? o.windAngle : 20) * D2R;
  return [Math.round(Math.cos(a) * 1e9) / 1e9, Math.round(Math.sin(a) * 1e9) / 1e9];
}

// ---- seeded gradient noise: a twin of the LIB gnoise / fbm (lib/dla-terrain.js
// "function gnoise"), so the strata phase follows the LIB hardness bands
const GRAD = new Float64Array(32);
for (let k = 0; k < 16; k++) {
  const a = (k + 0.5) / 16 * Math.PI * 2;
  GRAD[2 * k] = Math.round(Math.cos(a) * 1e9) / 1e9; GRAD[2 * k + 1] = Math.round(Math.sin(a) * 1e9) / 1e9;
}
function ihash(x, y, s) {
  let h = (Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(s, 0xcb1ab31f)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
function gnoise(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const a = (ihash(ix, iy, s) & 15) << 1, b = (ihash(ix + 1, iy, s) & 15) << 1;
  const c = (ihash(ix, iy + 1, s) & 15) << 1, d = (ihash(ix + 1, iy + 1, s) & 15) << 1;
  const n00 = GRAD[a] * fx + GRAD[a + 1] * fy, n10 = GRAD[b] * (fx - 1) + GRAD[b + 1] * fy;
  const n01 = GRAD[c] * fx + GRAD[c + 1] * (fy - 1), n11 = GRAD[d] * (fx - 1) + GRAD[d + 1] * (fy - 1);
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const x0 = n00 + (n10 - n00) * ux, x1 = n01 + (n11 - n01) * ux;
  return 1.6 * (x0 + (x1 - x0) * uy);
}
function fbm(x, y, s, oct, gain = 0.5, lac = 2.03) {
  let a = 1, f = 1, sum = 0, norm = 0;
  for (let k = 0; k < oct; k++) {
    sum += a * gnoise(x * f + k * 17.31, y * f - k * 9.71, s + k * 101);
    norm += a; a *= gain; f *= lac;
  }
  return sum / norm;
}
// LIB subSeed twin
function subSeed(seed, salt) {
  let h = Math.imul((seed >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f);
  return ((h ^ (h >>> 16)) >>> 0) || 1;
}

// ---- grid helpers
function downAvg(src, n, m) {
  if (n === m) return Float32Array.from(src);
  const f = n / m, out = new Float32Array(m * m), inv = 1 / (f * f);
  for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
    let s = 0;
    for (let j = 0; j < f; j++) { const r = (y * f + j) * n + x * f; for (let i = 0; i < f; i++) s += src[r + i]; }
    out[y * m + x] = s * inv;
  }
  return out;
}
function downMax(src, n, m) {
  if (n === m) return Float32Array.from(src);
  const f = n / m, out = new Float32Array(m * m);
  for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
    let s = -Infinity;
    for (let j = 0; j < f; j++) { const r = (y * f + j) * n + x * f; for (let i = 0; i < f; i++) if (src[r + i] > s) s = src[r + i]; }
    out[y * m + x] = s;
  }
  return out;
}
function blur(a, n, r, passes = 2) {
  if (r <= 0) return a;
  const tmp = new Float32Array(n * n), w = 1 / (2 * r + 1);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < n; y++) {
      const row = y * n; let s = 0;
      for (let i = -r; i <= r; i++) s += a[row + clamp(i, 0, n - 1)];
      for (let x = 0; x < n; x++) { tmp[row + x] = s * w; s += a[row + Math.min(x + r + 1, n - 1)] - a[row + Math.max(x - r, 0)]; }
    }
    for (let x = 0; x < n; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += tmp[clamp(i, 0, n - 1) * n + x];
      for (let y = 0; y < n; y++) { a[y * n + x] = s * w; s += tmp[Math.min(y + r + 1, n - 1) * n + x] - tmp[Math.max(y - r, 0) * n + x]; }
    }
  }
  return a;
}
// quantile of |a| (or a) on a stride sample, deterministic
function quantile(a, q, abs = false, onlyPos = false) {
  const stride = Math.max(1, Math.floor(a.length / 65536));
  const s = [];
  for (let i = 0; i < a.length; i += stride) { const v = abs ? Math.abs(a[i]) : a[i]; if (!onlyPos || v > 0) s.push(v); }
  if (!s.length) return 0;
  const f = Float32Array.from(s).sort();
  return f[clamp(Math.floor(q * (f.length - 1)), 0, f.length - 1)];
}
// chamfer distance in cells from src (1 = source)
function distField(src, n) {
  const N = n * n, d = new Float32Array(N), D2 = Math.SQRT2;
  for (let i = 0; i < N; i++) d[i] = src[i] ? 0 : 1e9;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x; let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + 1);
    if (y > 0) { v = Math.min(v, d[i - n] + 1); if (x > 0) v = Math.min(v, d[i - n - 1] + D2); if (x < n - 1) v = Math.min(v, d[i - n + 1] + D2); }
    d[i] = v;
  }
  for (let y = n - 1; y >= 0; y--) for (let x = n - 1; x >= 0; x--) {
    const i = y * n + x; let v = d[i];
    if (x < n - 1) v = Math.min(v, d[i + 1] + 1);
    if (y < n - 1) { v = Math.min(v, d[i + n] + 1); if (x < n - 1) v = Math.min(v, d[i + n + 1] + D2); if (x > 0) v = Math.min(v, d[i + n - 1] + D2); }
    d[i] = v;
  }
  return d;
}
// cells by height, high to low: a counting sort on 65536 bins (O(N), stable)
function orderDesc(h, N) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < N; i++) { if (h[i] < lo) lo = h[i]; if (h[i] > hi) hi = h[i]; }
  const B = 65536, k = (B - 1) / Math.max(hi - lo, 1e-6);
  const bin = new Uint16Array(N), cnt = new Uint32Array(B + 1);
  for (let i = 0; i < N; i++) { const b = (B - 1) - Math.floor((h[i] - lo) * k); bin[i] = b; cnt[b + 1]++; }
  for (let b = 0; b < B; b++) cnt[b + 1] += cnt[b];
  const ord = new Uint32Array(N);
  for (let i = 0; i < N; i++) ord[cnt[bin[i]]++] = i;
  return ord;
}

// D8 steepest descent: code 0..7 (DXS / DZS), 8 = no lower neighbour
function d8(h, m) {
  const dir = new Uint8Array(m * m).fill(8);
  for (let z = 0; z < m; z++) for (let x = 0; x < m; x++) {
    const i = z * m + x, h0 = h[i];
    let best = 0, bk = 8;
    for (let k = 0; k < 8; k++) {
      const xx = x + DXS[k], zz = z + DZS[k];
      if (xx < 0 || zz < 0 || xx >= m || zz >= m) continue;
      const s = (h0 - h[zz * m + xx]) / DIST[k];
      if (s > best) { best = s; bk = k; }
    }
    dir[i] = bk;
  }
  return dir;
}

// Talus: rock fall from cliffs runs down and settles at the angle of repose.
// src (debris made per cell), S (slope tan), chanK (0..1 river strength).
function scree(h, m, S, src, chanK, rep) {
  const N = m * m, ord = orderDesc(h, N);
  const carry = new Float32Array(N), dep = new Float32Array(N);
  const w = new Float32Array(8);
  for (let k = 0; k < N; k++) {
    const i = ord[k];
    const c = carry[i] + src[i];
    if (c <= 0) continue;
    const s = S[i];
    // falls through the faces, settles from the angle of repose down (rep:
    // the slope tan where it starts to settle); a river takes it away
    let r = s > rep ? 0 : 0.06 + (0.55 * (1 - sstep(rep * 0.3, rep, s)));
    const ch = chanK[i];
    r *= 1 - ch;
    const d = c * r;
    dep[i] += d;
    let rest = (c - d) * (1 - (0.85 * ch));
    if (rest <= 1e-9) continue;
    const x = i % m, z = (i / m) | 0, h0 = h[i];
    let sum = 0;
    for (let q = 0; q < 8; q++) {
      const xx = x + DXS[q], zz = z + DZS[q];
      w[q] = 0;
      if (xx < 0 || zz < 0 || xx >= m || zz >= m) continue;
      const dh = (h0 - h[zz * m + xx]) / DIST[q];
      if (dh > 0) { w[q] = dh * Math.sqrt(dh); sum += w[q]; }
    }
    if (sum <= 0) { dep[i] += rest; continue; }
    for (let q = 0; q < 8; q++) if (w[q] > 0) carry[(z + DZS[q]) * m + x + DXS[q]] += rest * w[q] / sum;
  }
  return dep;
}

// Wind exposure (Winstral Sx): the largest upwind horizon angle (deg) within
// dmax metres, and the lee drop and windward rise over two cells.
function windExposure(h, m, dx, wind, dmax = 300) {
  const N = m * m, sx = new Float32Array(N);
  const step = Math.max(dx, 20), K = Math.max(2, Math.ceil(dmax / step));
  const offs = [];
  const seen = new Set();
  for (let k = 1; k <= K; k++) {
    const d = k * step;
    const ox = Math.round(-wind[0] * d / dx), oz = Math.round(-wind[1] * d / dx);
    const key = ox + ',' + oz;
    if ((ox === 0 && oz === 0) || seen.has(key)) continue;
    seen.add(key);
    offs.push([ox, oz, Math.hypot(ox, oz) * dx]);
  }
  for (let z = 0; z < m; z++) for (let x = 0; x < m; x++) {
    const i = z * m + x, h0 = h[i];
    let best = -1e9;
    for (const [ox, oz, d] of offs) {
      const xx = clamp(x + ox, 0, m - 1), zz = clamp(z + oz, 0, m - 1);
      const t = (h[zz * m + xx] - h0) / d;
      if (t > best) best = t;
    }
    sx[i] = Math.atan(best) / D2R;
  }
  return sx;
}

// LIB strata: the phase of the rock bands at height y is
// (y - hmin) / hspan * layers * 2 + warp; band = 0.5 + 0.5 cos(phase PI);
// hard where band > 0.55 (lib erodeGrid). -> [hmin, hspan, layers, strength]
export function strataParams(o) {
  const hs = (o && o.heightScale) || 1000;
  return [-hs * 0.4, hs * 1.4, Math.max(2, (o && o.strataLayers) || 10), clamp((o && o.strata) || 0, 0, 1)];
}

// ---------------------------------------------------------------- main --

// t: the LIB Terrain. opts: { res (grid cap, default 1024), yieldFn (async,
// called between passes) }. -> { m, worldSize, data: Uint8Array (4 layers
// of m * m RGBA), fields (Float32Array by name), wind, strata, stats }
export async function simulateSurface(t, opts = {}) {
  const y = opts.yieldFn || null;
  const pause = async () => { if (y) await y(); };
  const n = t.n, ws = t.worldSize, o = t.opts || {};
  const m = Math.min(n, opts.res || 1024);
  const N = m * m, dx = ws / m, sea = t.seaLevel ?? 0;
  const seed = (o.seed ?? 1) >>> 0;
  const h = downAvg(t.height, n, m);
  const flow = t.flow ? downMax(t.flow, n, m) : new Float32Array(N);
  const sed = t.sediment ? downAvg(t.sediment, n, m) : new Float32Array(N);
  const water = t.water ? downMax(t.water, n, m) : new Float32Array(N);
  const river = t.river ? downMax(t.river, n, m) : new Float32Array(N);
  const moist = t.moisture ? downAvg(t.moisture, n, m) : new Float32Array(N).fill(0.5);
  const temp = t.temperature ? downAvg(t.temperature, n, m) : new Float32Array(N).fill(10);
  const wind = windOf(o);
  const S0 = () => {
    const out = new Float32Array(N);
    for (let z = 1; z < m - 1; z++) for (let x = 1; x < m - 1; x++) {
      const i = z * m + x;
      out[i] = Math.hypot(h[i + 1] - h[i - 1], h[i + m] - h[i - m]) / (2 * dx);
    }
    return out;
  };
  const talus = clamp(o.talus ?? 36, 25, 55);
  // soil holds below Sc. A LIB world can be steeper than real hillslopes
  // (few thermal passes on the full grid), so Sc is at least the 60th
  // percentile slope of this world: plants hold its mid slopes
  const Sq60 = quantile(S0(), 0.6);
  const Sc = Math.max(Math.tan(Math.min(talus, 40) * D2R), Math.min(Sq60, Math.tan(50 * D2R)));
  const Sf = Math.tan(Math.max(talus, 36) * D2R);       // rock faces shed above this

  // slope and curvature
  const S = new Float32Array(N), gX = new Float32Array(N), gZ = new Float32Array(N);
  for (let z = 0; z < m; z++) for (let x = 0; x < m; x++) {
    const i = z * m + x;
    const xl = Math.max(0, x - 1), xr = Math.min(m - 1, x + 1), zu = Math.max(0, z - 1), zd = Math.min(m - 1, z + 1);
    const gx = (h[z * m + xr] - h[z * m + xl]) / ((xr - xl) * dx), gz = (h[zd * m + x] - h[zu * m + x]) / ((zd - zu) * dx);
    gX[i] = gx; gZ[i] = gz; S[i] = Math.sqrt(gx * gx + gz * gz);
  }
  const hb = blur(Float32Array.from(h), m, Math.max(1, Math.round(45 / dx)), 2);
  const curv = new Float32Array(N);
  for (let z = 1; z < m - 1; z++) for (let x = 1; x < m - 1; x++) {
    const i = z * m + x;
    curv[i] = (hb[i - 1] + hb[i + 1] + hb[i - m] + hb[i + m] - 4 * hb[i]) / (dx * dx);
  }
  const cq = quantile(curv, 0.9, true) || 1e-6;
  for (let i = 0; i < N; i++) curv[i] = clamp(curv[i] / cq, -1.5, 1.5);   // > 0 concave (hollow)
  await pause();

  // drainage
  const dir = d8(h, m);
  const logA = new Float32Array(N), erosion = new Float32Array(N), chanK = new Float32Array(N);
  const cellKm2 = (dx / 1000) ** 2;
  for (let i = 0; i < N; i++) {
    const A = Math.max(flow[i], cellKm2);
    logA[i] = Math.log10(A);
    const spi = Math.sqrt(A * 1e6) * S[i];
    erosion[i] = clamp((Math.log10(spi + 1e-6) - 0.6) / 2.2, 0, 1);
    // rivers carry debris away: 1 on mapped rivers and lakes
    chanK[i] = Math.max(clamp(river[i] * 1.5, 0, 1), sstep(0.05, 0.5, water[i]), sstep(0.4, 1.4, logA[i]));
  }
  await pause();

  // regolith
  const regolith = new Float32Array(N), sedK = new Float32Array(N);
  const sR = subSeed(seed, 401);
  for (let z = 0; z < m; z++) for (let x = 0; x < m; x++) {
    const i = z * m + x;
    const r = S[i] / Sc;
    let reg = clamp(1 - r * r, 0, 1);
    reg += 0.3 * curv[i];
    // channels (not open hillslopes) with high stream power are stripped
    reg -= 0.7 * sstep(0.5, 0.85, erosion[i]) * sstep(-1.9, -0.9, logA[i]);
    // frost-shattered high ground and arid ground keep thin soils
    reg *= 1 - (0.5 * (1 - sstep(-9, -3, temp[i])));
    reg *= 0.65 + (0.35 * sstep(0.08, 0.3, moist[i]));
    reg += 0.12 * fbm((x + 0.5) / m * 18, (z + 0.5) / m * 18, sR, 3);
    sedK[i] = 1 - Math.exp(-Math.max(sed[i], 0) / 1.5);
    regolith[i] = clamp(Math.max(reg, sedK[i] * 0.95), 0, 1);
  }
  await pause();

  // scree: debris from faces over the shed angle, more in the frost band.
  // The angles follow the slopes of this terrain too: a LIB world can be
  // steeper than real talus (few thermal passes on the full grid), so the
  // faces are at least its steepest quarter and the debris settles on its
  // gentler half.
  const q60 = quantile(S, 0.6), q80 = quantile(S, 0.8);
  const Sface = Math.max(Sf * 0.92, Math.min(q80, Sf * 1.8));
  const rep = clamp(q60 * 1.1, 0.84, 1.5);
  const src = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const face = sstep(Sface, Sface * 1.7, S[i]);
    if (face <= 0) continue;
    const T = temp[i];
    const frost = 0.35 + (0.65 * Math.exp(-(((T + 4) / 7) ** 2)));
    src[i] = face * frost * (1 - regolith[i] * 0.7) * S[i];
  }
  const dep = scree(h, m, S, src, chanK, rep);
  const dq = quantile(dep, 0.6, false, true) || 1;
  const screeF = new Float32Array(N);
  for (let i = 0; i < N; i++) screeF[i] = (1 - Math.exp(-dep[i] / dq)) * (1 - sstep(rep, rep * 1.5, S[i]));
  blur(screeF, m, 1, 1);
  await pause();

  // wet banks: distance to water (rivers, lakes, sea)
  const wsrc = new Uint8Array(N);
  for (let i = 0; i < N; i++) wsrc[i] = (water[i] > 0.05 || river[i] > 0.3 || h[i] < sea) ? 1 : 0;
  const dw = distField(wsrc, m);
  // closed basins: the land under a wide mean
  const hw = blur(Float32Array.from(h), m, Math.max(2, Math.round(400 / dx)), 2);
  await pause();

  // wind exposure and cornices
  const sx = windExposure(h, m, dx, wind, 300);
  const wx = wind[0], wz = wind[1];
  const drift = new Float32Array(N), cornice = new Float32Array(N);
  for (let z = 0; z < m; z++) for (let x = 0; x < m; x++) {
    const i = z * m + x;
    let d = 0.5 + (0.5 * Math.tanh(sx[i] / 10));
    // scour on exposed convex crests
    d -= 0.45 * Math.min(1, Math.max(0, -curv[i])) * sstep(1, 8, -sx[i]);
    drift[i] = clamp(d, 0, 1);
    // a cornice: a convex crest with a steep drop downwind and a gentle
    // rise upwind (the snow overhangs the lee edge)
    const at = (ox, oz) => h[clamp(z + oz, 0, m - 1) * m + clamp(x + ox, 0, m - 1)];
    const r2 = 2;
    const lee = (h[i] - at(Math.round(wx * r2), Math.round(wz * r2))) / (r2 * dx);
    const wnd = (h[i] - at(Math.round(-wx * r2), Math.round(-wz * r2))) / (r2 * dx);
    cornice[i] = sstep(0.15, 0.6, -curv[i]) * sstep(0.45, 0.9, lee) * (1 - sstep(0.35, 0.8, wnd)) * sstep(-3, 2, -sx[i]);
  }
  await pause();

  // glacial polish along the big valleys, ice flow along the valley axis
  const glacier = clamp(o.glacier || 0, 0, 1);
  const glacial = new Float32Array(N), iceDir = new Float32Array(N);
  if (glacier > 0) {
    // the ice filled the big valleys up to a trim line: low ground against
    // a 1.5 km mean, near the big drainage lines
    const v = new Float32Array(N);
    for (let i = 0; i < N; i++) v[i] = sstep(-1.6, 0.4, logA[i]);
    blur(v, m, Math.max(1, Math.round(250 / dx)), 2);
    const hs = blur(Float32Array.from(h), m, Math.max(2, Math.round(500 / dx)), 2);
    const hv = blur(Float32Array.from(h), m, Math.max(2, Math.round(1500 / dx)), 2);
    const relief = Math.max(50, (o.heightScale || 1000) * 0.12);
    for (let z = 0; z < m; z++) for (let x = 0; x < m; x++) {
      const i = z * m + x;
      const low = sstep(-0.2 * relief, 0.5 * relief, hv[i] - h[i]);
      glacial[i] = clamp(glacier * 1.6 * Math.max(low * 0.8, sstep(0.05, 0.3, v[i])) * low, 0, 1) * (1 - screeF[i]) * (h[i] > sea ? 1 : 0);
      const xl = Math.max(0, x - 1), xr = Math.min(m - 1, x + 1), zu = Math.max(0, z - 1), zd = Math.min(m - 1, z + 1);
      const gx = hs[z * m + xr] - hs[z * m + xl], gz = hs[zd * m + x] - hs[zu * m + x];
      let a = Math.atan2(gz, gx);
      if (a < 0) a += Math.PI;
      iceDir[i] = a / Math.PI;
    }
  }
  await pause();

  // strata phase warp: the LIB hardness warp 0.35 fbm(uv 3) (erodeGrid), and
  // a fold warp where the LIB has no strata (metamorphic bands)
  const [, , , sStr] = strataParams(o);
  const sL = subSeed(seed, 71), sF = subSeed(seed, 409);
  const strata = new Float32Array(N), age = new Float32Array(N), playa = new Float32Array(N);
  const scar = new Float32Array(N), coarse = new Float32Array(N), wet = new Float32Array(N);
  const sS = subSeed(seed, 413);
  for (let z = 0; z < m; z++) for (let x = 0; x < m; x++) {
    const i = z * m + x, u = (x + 0.5) / m, v = (z + 0.5) / m;
    let w = 0.35 * fbm(u * 3, v * 3, sL, 2);
    w += (1 - sStr) * 0.9 * fbm(u * 1.7 + 5.1, v * 1.7, sF, 3);
    strata[i] = clamp(0.5 + w / 6, 0, 1);
    // exposure age
    age[i] = clamp(1 - (1.3 * erosion[i]) - (0.9 * screeF[i]) - (0.6 * sedK[i] * chanK[i]), 0, 1);
    // playa: arid, flat, low ground with fines and no water
    const arid = 1 - sstep(0.15, 0.4, moist[i]);
    const flat = 1 - sstep(0.012, 0.05, S[i]);
    const basin = Math.max(sstep(0.5, 8, hw[i] - h[i]), sstep(0.1, 1.2, sed[i]));
    playa[i] = arid * flat * basin * (1 - wsrc[i]);
    // erosion scars: slips on soil near the critical slope, gullied soil
    const risk = sstep(0.5 * Sc, 0.95 * Sc, S[i]) * sstep(0.1, 0.4, regolith[i]);
    const slip = sstep(0.2, 0.6, fbm(u * 70, v * 70, sS, 2));
    scar[i] = clamp((risk * slip) + (sstep(0.5, 0.8, erosion[i]) * sstep(0.2, 0.5, regolith[i]) * 0.7), 0, 1);
    // grain: steep fans and river beds coarse, flood plains fine
    coarse[i] = clamp(sstep(0.015, 0.12, S[i]) + (0.5 * sstep(0.5, 1.5, logA[i]) * sstep(0.004, 0.03, S[i])), 0, 1);
    wet[i] = Math.exp(-dw[i] * dx / 22) * (1 - sstep(0.2, 0.6, S[i]));
  }
  await pause();

  const fields = {
    regolith, scree: screeF, alluvium: sedK, wet, drift, cornice, age, playa,
    strata, glacial, iceDir, scar, dir, logA, coarse, erosion, slope: S, curv,
  };
  const data = packSurface(fields, m);
  let nScree = 0, nRock = 0, nPlaya = 0, nCorn = 0;
  for (let i = 0; i < N; i++) { if (screeF[i] > 0.4) nScree++; if (regolith[i] < 0.2) nRock++; if (playa[i] > 0.5) nPlaya++; if (cornice[i] > 0.5) nCorn++; }
  return {
    m, worldSize: ws, data, fields, wind, strata: strataParams(o), glacier,
    stats: { scree: nScree / N, bedrock: nRock / N, playa: nPlaya / N, cornice: nCorn / N },
  };
}

// the 4 layers as RGBA8 (layer-major, rows along z)
export function packSurface(f, m) {
  const N = m * m, out = new Uint8Array(N * 16);
  const q = (v) => Math.round(clamp(v, 0, 1) * 255);
  const L = (k) => k * N * 4;
  for (let i = 0; i < N; i++) {
    const o0 = L(0) + i * 4, o1 = L(1) + i * 4, o2 = L(2) + i * 4, o3 = L(3) + i * 4;
    out[o0] = q(f.regolith[i]); out[o0 + 1] = q(f.scree[i]); out[o0 + 2] = q(f.alluvium[i]); out[o0 + 3] = q(f.wet[i]);
    out[o1] = q(f.drift[i]); out[o1 + 1] = q(f.cornice[i]); out[o1 + 2] = q(f.age[i]); out[o1 + 3] = q(f.playa[i]);
    out[o2] = q(f.strata[i]); out[o2 + 1] = q(f.glacial[i]); out[o2 + 2] = q(f.iceDir[i]); out[o2 + 3] = q(f.scar[i]);
    out[o3] = f.dir[i] * 28; out[o3 + 1] = q((f.logA[i] + 2.5) / 5); out[o3 + 2] = q(f.coarse[i]); out[o3 + 3] = q(f.erosion[i]);
  }
  return out;
}

// ------------------------------------------------- shader twins (tests) --

// fn dune (ground.wgsl): transverse dunes across the wind. Gentle stoss
// face up the wind side, steep slip face (lee) downwind, sinuous crests.
// wd: unit wind (toward), lam: wavelength m. -> [h (m), dh/dx, dh/dz]
export function dune(x, z, wd, lam) {
  const ax = -wd[1], az = wd[0];
  const along = (x * wd[0]) + (z * wd[1]), across = (x * ax) + (z * az);
  const s1 = across / (lam * 2.7), s2 = (across / (lam * 1.1)) + 1.3;
  const s = (along / lam) + (0.35 * Math.sin(s1)) + (0.25 * Math.sin(s2));
  const dsA = 1 / lam, dsC = ((0.35 * Math.cos(s1)) / (lam * 2.7)) + ((0.25 * Math.cos(s2)) / (lam * 1.1));
  const f = s - Math.floor(s), c = 0.72;
  let p, dp;
  if (f < c) { p = 0.5 - (0.5 * Math.cos(Math.PI * f / c)); dp = (0.5 * Math.PI / c) * Math.sin(Math.PI * f / c); }
  else { const g = (f - c) / (1 - c); p = 0.5 + (0.5 * Math.cos(Math.PI * g)); dp = -(0.5 * Math.PI / (1 - c)) * Math.sin(Math.PI * g); }
  const A = 0.07 * lam;
  const gx = A * dp * ((dsA * wd[0]) + (dsC * ax)), gz = A * dp * ((dsA * wd[1]) + (dsC * az));
  return [A * p, gx, gz];
}

// fn snowAmount (ground.wgsl): snow cover 0..1 at height y with the snow
// line `line` (m), slope (1 - n.y), shade (-1 sunny .. 1 shaded face) and
// drift (0.5 neutral). Snow holds on low slopes in shade and in the lee.
export function snowAmount(y, line, slope, shade, drift) {
  let a = sstep(line - 160, line + 80, y + (shade * 120) + ((drift - 0.5) * 260));
  a *= 1 - sstep(0.30, 0.52, slope);
  return a;
}

// fn drainLine (ground.wgsl): the drainage line network from the D8 field.
// Each cell with chan over thr draws a segment from its centre (jittered by
// a hash) to the centre of its receiver. get(i, j) -> { dir 0..8, chan 0..1 }.
// -> { d (cells), w (strength 0..1), tx, tz (unit line direction, downhill) }
export function cellJitter(i, j) {
  let hsh = (Math.imul(i, 73856093) ^ Math.imul(j, 19349663)) >>> 0;
  hsh = Math.imul(hsh ^ (hsh >>> 15), 0x2c1b3c6d) >>> 0;
  hsh = Math.imul(hsh ^ (hsh >>> 12), 0x297a2d39) >>> 0;
  hsh = (hsh ^ (hsh >>> 15)) >>> 0;
  return [((hsh & 0xffff) / 65535 - 0.5) * 0.5, ((hsh >>> 16) / 65535 - 0.5) * 0.5];
}
export function drainLine(px, pz, get, thr = 0.45) {
  const ci = Math.floor(px), cj = Math.floor(pz);
  let best = { d: 9, w: 0, tx: 0, tz: 0 };
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const i = ci + di, j = cj + dj;
    const c = get(i, j);
    if (!c || c.dir >= 8 || c.chan < thr) continue;
    const ja = cellJitter(i, j);
    const ri = i + DXS[c.dir], rj = j + DZS[c.dir];
    const jb = cellJitter(ri, rj);
    const ax = i + 0.5 + ja[0], az = j + 0.5 + ja[1], bx = ri + 0.5 + jb[0], bz = rj + 0.5 + jb[1];
    const ex = bx - ax, ez = bz - az, l2 = (ex * ex) + (ez * ez);
    const t = clamp((((px - ax) * ex) + ((pz - az) * ez)) / l2, 0, 1);
    const qx = ax + (ex * t) - px, qz = az + (ez * t) - pz;
    const d = Math.sqrt((qx * qx) + (qz * qz));
    if (d < best.d) { const l = Math.sqrt(l2); best = { d, w: c.chan, tx: ex / l, tz: ez / l }; }
  }
  return best;
}
