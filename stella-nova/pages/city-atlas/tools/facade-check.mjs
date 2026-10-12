// facade-check.mjs — the window pattern of shaders/buildings.wgsl in JS,
// and a measure of its aliasing.   node pages/city-atlas/tools/facade-check.mjs
//
// The page draws the facade windows procedurally in the fragment shader.
// This file has the same pattern as plain functions (pointPattern: one
// sample at the pixel centre, as the shader was before the filter;
// filteredPattern: the box filter and the far fade of fs), and renders a
// patch of one wall with a pinhole camera at several distances.
//
// Per distance it gives, for each method and for the truth (8 x 8
// samples per pixel of the point pattern, that is the ideal image):
//   pxCell   pixels per window cell along the wall
//   nbr      RMS difference between neighbour pixels (grain)
//   flicker  mean |change| of a pixel when the camera moves 0.3 px or
//            dollies 0.5 % (shimmer while the camera orbits)
//   err      RMS difference from the truth
// The value is the night emission (luminance) of the windows only: the
// part of fs that aliased. tests.mjs (section 7) calls measure().
//
// grep: function hash11  function pulseBox  function pointPattern
//       function filteredPattern  export function measure

const BAY = 3.0, FLOOR = 3.5;
const PX = [0.18, 0.82], PY = [0.25, 0.8];
const WARM = [1.0, 0.74, 0.42], COOL = [0.85, 0.92, 1.0];
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const LW = lum(WARM), LC = lum(COOL);

export function hash11(n) {
  let x = n >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return (x & 0xffffff) / 16777216;
}

const fract = (x) => x - Math.floor(x);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function pulseInt(x, a, b) { return Math.floor(x) * (b - a) + clamp(fract(x), a, b) - a; }
export function pulseBox(x, w, a, b) {
  const ww = Math.max(w, 0.001), xl = x - Math.floor(x);
  return (pulseInt(xl + 0.5 * ww, a, b) - pulseInt(xl - 0.5 * ww, a, b)) / ww;
}

function cellOf(u, z, rnd) {
  const fl = Math.floor(z / FLOOR), cl = Math.floor(u / BAY);
  const seed = ((Math.imul(Math.floor(rnd * 65535), 7919) + Math.imul(fl >>> 0, 104729) + Math.imul((cl + 4096) >>> 0, 31)) >>> 0);
  const thr = 0.58 - 0.25 * smooth(40, 0, z);
  return { on: hash11(seed) >= thr ? 1 : 0, L: hash11(seed + 17) >= 0.8 ? LC : LW, thr };
}

// The shader before the filter: hard step edges, one cell per pixel centre.
export function pointPattern(u, z, rnd) {
  const fx = fract(u / BAY), fy = fract(z / FLOOR);
  const pane = (fy >= PY[0] && fy <= PY[1] && fx >= PX[0] && fx <= PX[1]) ? 1 : 0;
  const c = cellOf(u, z, rnd);
  return pane * c.on * c.L * 0.85;
}

// The shader after the filter. fu, fz: pixel size in cells (fw in fs).
export function filteredPattern(u, z, rnd, fu, fz) {
  const pane = pulseBox(u / BAY, fu, PX[0], PX[1]) * pulseBox(z / FLOOR, fz, PY[0], PY[1]);
  const c = cellOf(u, z, rnd);
  const mean = (1 - c.thr) * (0.8 * LW + 0.2 * LC);
  const far = smooth(0.4, 0.7, Math.max(fu, fz));
  return pane * (c.on * c.L * (1 - far) + mean * far) * 0.85;
}

// Pinhole camera at distance d from the wall point (u0, z0), yaw th from the
// wall normal, pitch ph above it. Returns hit(i, j) -> [u, z] or null.
function camera(d, th, ph, fpx, shift = 0, dolly = 1) {
  const u0 = 1000.37, z0 = 60;
  const dd = d * dolly;
  // wall frame (u, n, z); the wall is n = 0, it faces +n
  const eye = [u0 - dd * Math.sin(th) * Math.cos(ph), dd * Math.cos(th) * Math.cos(ph), z0 + dd * Math.sin(ph)];
  const tgt = [u0, 0, z0];
  const f = tgt.map((t, k) => (t - eye[k]) / dd);
  let r = [f[1] * 1 - f[2] * 0, f[2] * 0 - f[0] * 1, 0];   // f x up(0,0,1)
  const rl = Math.hypot(...r); r = r.map((x) => x / rl);
  const up = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  // a sub-pixel pan moves the eye and the target together
  const s = shift * dd / fpx;
  for (let k = 0; k < 3; k++) eye[k] += r[k] * s;
  return (x, y) => {
    const dir = [0, 1, 2].map((k) => f[k] + r[k] * x / fpx + up[k] * y / fpx);
    if (dir[1] >= 0) return null;
    const t = -eye[1] / dir[1];
    const u = eye[0] + t * dir[0], z = eye[2] + t * dir[2];
    return z > 0 && z < 200 ? [u, z] : null;
  };
}

function render(hit, N, method, rnd) {
  const out = new Float64Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = i - N / 2 + 0.5, y = j - N / 2 + 0.5;
    const p = hit(x, y);
    if (!p) { out[j * N + i] = NaN; continue; }
    if (method === 'point') { out[j * N + i] = pointPattern(p[0], p[1], rnd); continue; }
    if (method === 'filter') {
      // dpdx / dpdy as the GPU takes them: the next pixel minus this one
      const px = hit(x + 1, y), py = hit(x, y + 1);
      if (!px || !py) { out[j * N + i] = NaN; continue; }
      const du = [(px[0] - p[0]) / BAY, (py[0] - p[0]) / BAY], dz = [(px[1] - p[1]) / FLOOR, (py[1] - p[1]) / FLOOR];
      out[j * N + i] = filteredPattern(p[0], p[1], rnd, Math.hypot(du[0], du[1]), Math.hypot(dz[0], dz[1]));
      continue;
    }
    // truth: 8 x 8 point samples inside the pixel
    let s = 0, n = 0;
    for (let b = 0; b < 8; b++) for (let a = 0; a < 8; a++) {
      const q = hit(x - 0.5 + (a + 0.5) / 8, y - 0.5 + (b + 0.5) / 8);
      if (q) { s += pointPattern(q[0], q[1], rnd); n++; }
    }
    out[j * N + i] = n ? s / n : NaN;
  }
  return out;
}

function nbr(img, N) {
  let s = 0, n = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i + 1 < N; i++) {
    const a = img[j * N + i], b = img[j * N + i + 1];
    if (Number.isFinite(a) && Number.isFinite(b)) { s += (a - b) ** 2; n++; }
  }
  return Math.sqrt(s / Math.max(n, 1));
}
function diff(a, b, rms) {
  let s = 0, n = 0;
  for (let k = 0; k < a.length; k++) {
    if (Number.isFinite(a[k]) && Number.isFinite(b[k])) { s += rms ? (a[k] - b[k]) ** 2 : Math.abs(a[k] - b[k]); n++; }
  }
  return rms ? Math.sqrt(s / Math.max(n, 1)) : s / Math.max(n, 1);
}

// distances in m; a 1000 px tall view with the page's field of view (0.75 rad)
export function measure(distances = [150, 400, 1000, 2000, 4500, 9000], N = 48) {
  const fpx = 500 / Math.tan(0.75 / 2), th = 0.9, ph = 0.45, rnd = 0.37;
  const rows = [];
  for (const d of distances) {
    const row = { d, pxCell: 0 };
    const h0 = camera(d, th, ph, fpx);
    const c = h0(0, 0), c1 = h0(1, 0);
    row.pxCell = BAY / Math.hypot(c1[0] - c[0], c1[1] - c[1]);
    const truth = render(h0, N, 'truth', rnd);
    for (const m of ['point', 'filter', 'truth']) {
      const img = m === 'truth' ? truth : render(h0, N, m, rnd);
      let fl = 0;
      const moves = [[0.3, 1], [-0.3, 1], [0.6, 1], [0, 1.005], [0, 0.995]];
      if (m !== 'truth' || N <= 48) {
        for (const [sh, dl] of moves) fl += diff(img, render(camera(d, th, ph, fpx, sh, dl), N, m, rnd), false);
      }
      row[m] = { nbr: nbr(img, N), flicker: fl / moves.length, err: diff(img, truth, true) };
    }
    rows.push(row);
  }
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const f = (x) => x.toFixed(4);
  console.log('d m     px/cell  | point: nbr   flicker err    | filter: nbr  flicker err    | truth: nbr  flicker');
  for (const r of measure()) {
    console.log(`${String(r.d).padEnd(7)} ${r.pxCell.toFixed(2).padStart(6)}   | ${f(r.point.nbr)} ${f(r.point.flicker)} ${f(r.point.err)} | ${f(r.filter.nbr)} ${f(r.filter.flicker)} ${f(r.filter.err)} | ${f(r.truth.nbr)} ${f(r.truth.flicker)}`);
  }
}
