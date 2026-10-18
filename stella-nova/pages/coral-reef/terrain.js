// ============================================================================
//  CORAL REEF  ·  terrain (DOM-free: page, worker, node tests)
// ----------------------------------------------------------------------------
//  V3: THE ROCK MOVED TO rock/ (rock/index.js createRock, CONTRACT-V3.md).
//  This file is now a compatibility layer. It re-exports the ROCK API and
//  keeps the v2 exports below (lidar seabed, knoll rocks) only until SCENE
//  (scene.js, main.js, tests.mjs, thumb.mjs) and CORAL (reef.js,
//  coral-sdf.js, mesh-worker.js, assets.js) import from rock/. Do not add
//  to the v2 part. When no file imports it, delete it and seabed-data.js.
//
//  v2 description (kept for the importers that still use it): the seabed
//  is real. seabed-data.js holds a 160 x 160 crop of NOAA NCEI lidar
//  bathymetry (CUDEM 1/9 arc-second, about 3.3 m a sample) of the lagoon
//  of Buck Island Reef, St. Croix. This module turns it into scene units:
//    - one sample is SCALE.xz units across
//    - the depth splits into a regional trend (a wide blur) and the local
//      relief (depth minus trend), scaled by SCALE.trend and SCALE.local
//    - Catmull-Rom interpolation between samples, mirror repeat past the
//      crop, and a far ring that fades to a flat sand plain.
//  Procedural detail on top: sand ripples, rubble bumps on the knolls, and
//  rock SDFs (noisy boulders with overhangs and holes).
//
//  FRAMES. x east, z south, y up, scene units. groundY(x, z) is the
//  heightfield. rockSdf(rk, x, y, z) is negative inside a rock.
//  solidAt(x, y, z, rocks) is true in the ground or in a rock.
//
//  grep -n targets
//    v3 rock API ................ "export { createRock"
//    scale of the real data ..... "export const SCALE"
//    trend and relief grids ..... "function buildGrids"
//    height of the ground ....... "export function groundY"
//    rock mask (knolls) ......... "export function rockMask"
//    knoll sites ................ "export function knollSites"
//    noise ...................... "export function noise3"
//    a rock ..................... "export function makeRock"
//    rock distance .............. "export function rockSdf"
//    top of a rock .............. "export function rockTopY"
//    the solid test ............. "export function solidAt"
//    push out of the solid ...... "export function pushOut"
//    ground mesh grid ........... "export function groundGrid"
//    rock mesh .................. "export function meshRock"
// ============================================================================
export { createRock, createRockAsync } from './rock/index.js';
import { SEABED_CM, SEABED_META } from './seabed-data.js';
import { meshField } from '../../lib/dla-sdf.js';

export const SCALE = Object.freeze({
  xz: 2.0,        // scene units per lidar sample (about 3.3 m)
  local: 1.25,    // scene units per metre of local relief (knolls)
  trend: 1.0,     // scene units per metre of the regional trend
  blur: 9,        // box blur radius (samples) of the trend, three passes
  far: 165,       // past this radius the real relief fades out
  plain: 300,     // and this is all sand plain
});

const W = SEABED_META.w, H = SEABED_META.h;
let LOC = null, TR = null, TR0 = 0, LMAX = 1;

function boxBlur(src, r) {
  const out = new Float32Array(src.length), tmp = new Float32Array(src.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0; for (let k = -r; k <= r; k++) s += src[y * W + Math.min(W - 1, Math.max(0, x + k))];
    tmp[y * W + x] = s / (2 * r + 1);
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0; for (let k = -r; k <= r; k++) s += tmp[Math.min(H - 1, Math.max(0, y + k)) * W + x];
    out[y * W + x] = s / (2 * r + 1);
  }
  return out;
}

// The trend (three box blurs, about a Gaussian) and the local relief, in metres.
function buildGrids() {
  const d = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) d[i] = SEABED_CM[i] / 100;
  let t = d;
  for (let p = 0; p < 3; p++) t = boxBlur(t, SCALE.blur);
  LOC = new Float32Array(W * H); TR = t;
  for (let i = 0; i < W * H; i++) { LOC[i] = d[i] - t[i]; if (LOC[i] > LMAX) LMAX = LOC[i]; }
  TR0 = sampleGrid(TR, (W - 1) / 2, (H - 1) / 2);
}

// Mirror repeat: ... 2 1 0 1 2 ... W-2 W-1 W-2 ...
function mirror(i, n) {
  const p = 2 * (n - 1);
  i = ((i % p) + p) % p;
  return i < n ? i : p - i;
}

function cr(a, b, c, d, t) {
  return b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
}

// Catmull-Rom sample of grid g at (u, v) in sample units.
function sampleGrid(g, u, v) {
  const iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
  const row = (j) => {
    const r = mirror(j, H) * W;
    return cr(g[r + mirror(iu - 1, W)], g[r + mirror(iu, W)], g[r + mirror(iu + 1, W)], g[r + mirror(iu + 2, W)], fu);
  };
  return cr(row(iv - 1), row(iv), row(iv + 1), row(iv + 2), fv);
}

const toU = x => x / SCALE.xz + (W - 1) / 2;
const toV = z => z / SCALE.xz + (H - 1) / 2;

// How much of the real relief shows at radius r: 1 near, 0 on the plain.
function nearK(x, z) {
  const r = Math.hypot(x, z);
  if (r <= SCALE.far) return 1;
  const t = Math.min(1, (r - SCALE.far) / (SCALE.plain - SCALE.far));
  return 1 - t * t * (3 - 2 * t);
}

// ── noise ───────────────────────────────────────────────────────────────────
function hash3(x, y, z) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Value noise in 0..1, smooth (quintic fade).
export function noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10), uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hash3(ix, iy, iz), b = hash3(ix + 1, iy, iz), c = hash3(ix, iy + 1, iz), d = hash3(ix + 1, iy + 1, iz);
  const e = hash3(ix, iy, iz + 1), f = hash3(ix + 1, iy, iz + 1), g = hash3(ix, iy + 1, iz + 1), h = hash3(ix + 1, iy + 1, iz + 1);
  const x1 = a + (b - a) * ux, x2 = c + (d - c) * ux, x3 = e + (f - e) * ux, x4 = g + (h - g) * ux;
  const y1 = x1 + (x2 - x1) * uy, y2 = x3 + (x4 - x3) * uy;
  return y1 + (y2 - y1) * uz;
}

export function fbm3(x, y, z, oct = 3) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let o = 0; o < oct; o++) { s += a * noise3(x * f, y * f, z * f); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}

// ── the ground ──────────────────────────────────────────────────────────────
// Sand ripples: crests across the main current (x), wavelength about 3.2
// units, bent by noise so they do not look ruled.
function ripples(x, z) {
  const w = noise3(x * 0.03, 0.5, z * 0.03) * 6;
  const ph = x * 1.95 + z * 0.35 + w;
  const s = Math.sin(ph);
  return 0.16 * (s * Math.abs(s) * 0.5 + 0.5 * s) * (0.6 + 0.4 * noise3(x * 0.08, 2.5, z * 0.08));
}

// The rock mask: 0 on sand, 1 on a knoll (local relief over 0.9 m).
export function rockMask(x, z) {
  if (!LOC) buildGrids();
  const k = nearK(x, z);
  if (k <= 0) return 0;
  const l = sampleGrid(LOC, toU(x), toV(z));
  const t = Math.min(1, Math.max(0, (l - 0.5) / 0.9));
  return t * t * (3 - 2 * t) * k;
}

// The local relief in metres (positive on knolls), for the shader mask.
export function localRelief(x, z) {
  if (!LOC) buildGrids();
  return sampleGrid(LOC, toU(x), toV(z)) * nearK(x, z);
}

// The ground height: the real trend and relief (scaled), ripples on the
// sand, rubble on the knolls.
export function groundY(x, z) {
  if (!LOC) buildGrids();
  const k = nearK(x, z);
  const u = toU(x), v = toV(z);
  let y = 0;
  if (k > 0) {
    const loc = sampleGrid(LOC, u, v), tr = sampleGrid(TR, u, v) - TR0;
    y = (loc * SCALE.local + tr * SCALE.trend) * k;
  }
  const m = rockMask(x, z);
  y += ripples(x, z) * (1 - m);
  y += (fbm3(x * 0.45, 1.7, z * 0.45, 2) - 0.5) * 1.1 * m;   // rubble
  y += (noise3(x * 0.012, 9.1, z * 0.012) - 0.5) * 3 * (1 - k); // plain swell
  return y;
}

// Knoll tops near the centre: local maxima of the relief over 1.2 m,
// sorted by distance from (0, 0). Returns [{ x, z, h (metres) }].
export function knollSites(maxR = 70) {
  if (!LOC) buildGrids();
  const out = [];
  for (let v = 2; v < H - 2; v++) for (let u = 2; u < W - 2; u++) {
    const l = LOC[v * W + u];
    if (l < 1.2) continue;
    let top = true;
    for (let dv = -2; dv <= 2 && top; dv++) for (let du = -2; du <= 2; du++) if ((du || dv) && LOC[(v + dv) * W + u + du] > l) { top = false; break; }
    if (!top) continue;
    const x = (u - (W - 1) / 2) * SCALE.xz, z = (v - (H - 1) / 2) * SCALE.xz;
    if (Math.hypot(x, z) <= maxR) out.push({ x, z, h: l });
  }
  out.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
  return out;
}

// ── rocks ───────────────────────────────────────────────────────────────────
// A rock: a noisy ellipsoid on the ground, rotated about y, with a bulge
// above its middle (overhangs) and one or two holes. y is the centre of
// the ellipsoid, set so that its base is under the ground.
export function makeRock(rand, x, z, o = {}) {
  const r = o.r ?? 4 + rand() * 3, h = o.h ?? r * (0.5 + rand() * 0.25);
  const rk = {
    x, z, rx: r * (0.85 + rand() * 0.3), rz: r * (0.85 + rand() * 0.3), ry: h,
    rot: rand() * Math.PI * 2, seed: rand() * 100, ov: o.ov ?? 0.12 + rand() * 0.14,
    amp: o.amp ?? 0.9 + rand() * 0.6, holes: [], loose: !!o.loose,
  };
  rk.y = groundY(x, z) - h * (o.sink ?? 0.45);
  const nh = o.holes ?? (r > 4.5 ? 1 + (rand() < 0.5 ? 1 : 0) : 0);
  for (let i = 0; i < nh; i++) {
    const a = rand() * Math.PI * 2;
    rk.holes.push([Math.cos(a) * r * 0.9, h * (0.05 + rand() * 0.35), Math.sin(a) * r * 0.9, r * (0.22 + rand() * 0.12)]);
  }
  rk.R = Math.max(rk.rx, rk.rz) * (1 + rk.ov) + rk.amp + 1;   // bounding radius
  return rk;
}

// Signed distance to a rock (about; the noise makes it a bound, not exact).
export function rockSdf(rk, x, y, z) {
  let px = x - rk.x, py = y - rk.y, pz = z - rk.z;
  const d2 = px * px + pz * pz;
  if (d2 > rk.R * rk.R || py > rk.ry + rk.amp + 1 || py < -rk.ry - 2) {
    return Math.max(Math.sqrt(d2) - rk.R, py - rk.ry - rk.amp - 1, 0.5);
  }
  const c = Math.cos(rk.rot), s = Math.sin(rk.rot);
  const qx = px * c - pz * s, qz = px * s + pz * c;
  const ny = py / rk.ry;
  const bul = 1 + rk.ov * smooth(-0.15, 0.45, ny) * smooth(1.1, 0.5, ny);
  const ex = qx / (rk.rx * bul), ey = ny, ez = qz / (rk.rz * bul);
  const m = Math.min(rk.rx, rk.ry, rk.rz);
  let d = (Math.sqrt(ex * ex + ey * ey + ez * ez) - 1) * m;
  const sd = rk.seed;
  d += (fbm3(px * 0.32 + sd, py * 0.32, pz * 0.32, 3) - 0.5) * 2.2 * rk.amp;
  d += (noise3(px * 1.3 + sd, py * 1.3 + 7, pz * 1.3) - 0.5) * 0.35 * rk.amp;
  for (const hl of rk.holes) {
    const hx = qx - hl[0], hy = py - hl[1], hz = qz - hl[2];
    const dh = hl[3] - Math.sqrt(hx * hx + hy * hy + hz * hz);
    d = smax(d, dh, 0.8);
  }
  return d;
}

function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function smax(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; }

// The top of a rock (or the ground) at (x, z): march down from above.
export function rockTopY(rk, x, z) {
  let y = rk.y + rk.ry + rk.amp + 2;
  const g = groundY(x, z);
  for (let i = 0; i < 80 && y > g; i++) {
    const d = rockSdf(rk, x, y, z);
    if (d < 0.02) return y;
    y -= Math.max(0.05, d * 0.7);
  }
  return Math.max(g, y);
}

// True inside the ground or a rock. rocks: an array, or one rock.
export function solidAt(x, y, z, rocks) {
  if (y < groundY(x, z)) return true;
  if (!rocks) return false;
  if (Array.isArray(rocks)) { for (const rk of rocks) if (rockSdf(rk, x, y, z) < 0) return true; return false; }
  return rockSdf(rocks, x, y, z) < 0;
}

// Move p (array xyz) out of the solid: along the rock gradient, then up
// out of the ground, then straight up if it is still inside. Returns p.
export function pushOut(p, rocks, margin = 0.05) {
  const list = !rocks ? [] : Array.isArray(rocks) ? rocks : [rocks];
  for (let it = 0; it < 6; it++) {
    let moved = false;
    for (const rk of list) {
      const d = rockSdf(rk, p[0], p[1], p[2]);
      if (d >= margin) continue;
      const e = 0.08;
      let gx = rockSdf(rk, p[0] + e, p[1], p[2]) - rockSdf(rk, p[0] - e, p[1], p[2]);
      let gy = rockSdf(rk, p[0], p[1] + e, p[2]) - rockSdf(rk, p[0], p[1] - e, p[2]);
      let gz = rockSdf(rk, p[0], p[1], p[2] + e) - rockSdf(rk, p[0], p[1], p[2] - e);
      const gl = Math.hypot(gx, gy, gz) || 1;
      gx /= gl; gy /= gl; gz /= gl;
      const k = margin - d + 0.02;
      p[0] += gx * k; p[1] += gy * k; p[2] += gz * k;
      moved = true;
    }
    const g = groundY(p[0], p[2]) + margin;
    if (p[1] < g) { p[1] = g; moved = true; }
    if (!moved) break;
  }
  // still inside (under an overhang, or between two rocks): go up
  for (let i = 0; i < 80 && solidAt(p[0], p[1], p[2], list); i++) p[1] += 0.1;
  return p;
}

// A grid for the ground mesh: (n + 1)^2 vertices, fine in the middle and
// coarse at the edge (x = S * sign(u) * |u|^w for u in -1..1). Returns
// { positions, normals, mask (rock mask, per vertex), indices }.
export function groundGrid(n = 200, S = 600, w = 2.1) {
  const N1 = n + 1;
  const pos = new Float32Array(N1 * N1 * 3), nrm = new Float32Array(N1 * N1 * 3), mask = new Float32Array(N1 * N1);
  const coord = i => { const u = i / n * 2 - 1; return S * Math.sign(u) * Math.pow(Math.abs(u), w); };
  for (let j = 0; j < N1; j++) for (let i = 0; i < N1; i++) {
    const x = coord(i), z = coord(j), k = j * N1 + i;
    const y = groundY(x, z);
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
    const e = 0.35;
    const gx = groundY(x + e, z) - groundY(x - e, z), gz = groundY(x, z + e) - groundY(x, z - e);
    const l = Math.hypot(gx, 2 * e, gz);
    nrm[k * 3] = -gx / l; nrm[k * 3 + 1] = 2 * e / l; nrm[k * 3 + 2] = -gz / l;
    mask[k] = rockMask(x, z);
  }
  const idx = new Uint32Array(n * n * 6);
  for (let j = 0, q = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * N1 + i, b = a + 1, c = a + N1, d = c + 1;
    idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
  }
  return { positions: pos, normals: nrm, mask, indices: idx };
}

export { SEABED_META };

// A rock as a mesh: surface nets of rockSdf (lib/dla-sdf.js meshField).
export function meshRock(rk, cell = 0.4) {
  const R = rk.R + 1, y0 = rk.y - rk.ry - 2.5, y1 = rk.y + rk.ry * (1 + rk.ov) + rk.amp * 1.5 + 2;
  return meshField((x, y, z) => rockSdf(rk, x, y, z), {
    x0: rk.x - R, y0, z0: rk.z - R,
    nx: Math.ceil(2 * R / cell), ny: Math.ceil((y1 - y0) / cell), nz: Math.ceil(2 * R / cell), cell,
  });
}
