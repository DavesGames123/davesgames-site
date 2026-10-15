// ============================================================================
//  WEATHER MAP  ·  render/fields.js — temperature fill, radar, isobars, wind,
//  and the H / L centres as data (package SKY)
// ----------------------------------------------------------------------------
//  createFields(core, opts) -> Promise<layer>
//    layer (order 20): radar mosaic, wind streaks, isobar lines.
//    layer.under (order 8, added to core by createFields): the temperature
//      fill, drawn below the cloud deck (clouds are order 10).
//    setGrid(grid)      data/grid.js loadGrid() result
//    setRadar(set)      data/radar.js loadRadar() result; frames load on demand
//    setFronts(set)     data/fronts.js loadFronts() result (H / L from WPC)
//    set({ temp, radar, isobars, wind, tempOpacity, radarOpacity, windOpacity,
//          isotherms, futurecast })   booleans and 0..1 values
//    labels() -> { isobars: [{ lat, lon, hPa, text }],
//                  centers: [{ type: 'H' | 'L', lat, lon, hPa, text, source }] }
//                  for the last isobar build (DIRECTOR's labels draw them)
//    marks() -> labels.js setMarks() list: isobar values (kind 'iso') and,
//                  without WPC fronts, the grid H / L. Same array until the
//                  next isobar build (every 15 min of map time).
//    radarState() -> { frame, frames, loaded, model, error }
//    destroy()          removes both layers
//
//  Temperature: Catmull-Rom t2m, TV palette TEMP_STOPS (°F), translucent
//  (less over water, from tex/water-2k.png), faint isotherms every 10 °F and
//  a stronger 32 °F line. Radar: RainViewer tiles (data/radar.js) stitched
//  into a Web Mercator mosaic, decoded from the Universal Blue colours back
//  to dBZ (UB_RAIN, UB_SNOW), resampled to an equirect rg8 texture
//  (r = dBZ / 85, g = snow), then coloured with the TV dBZ ramp RADAR_STOPS
//  (rain) and SNOW_STOPS (snow). Past the newest frame, and when there is
//  no radar (sample data), the model precipitation stands in ("futurecast":
//  Z = 200 R^1.6 with cell noise). Isobars: marching squares on the msl
//  field (Catmull-Rom upsampled 4x) every 4 hPa, Chaikin-smoothed, drawn as
//  anti-aliased screen-space strips.
//
//  grep -n targets: "export async function createFields", "export const TEMP_STOPS",
//  "export const RADAR_STOPS", "export function decodeUB", "export function decodeTileRGBA",
//  "export function mercToEquirect", "export function radarPlan", "export function radarPick",
//  "export function upsampleBicubic", "export function marchingSquares",
//  "export function joinSegments", "export function chaikin", "export function isobarLines",
//  "export function isobarLabels", "export function labelMarks", "export function findCenters", "export function pressureCenters",
//  "export function lineMesh", "export function packFields"
// ============================================================================
import { gridFrame } from '../data/grid.js';
import { tileUrl, lonLatToTile, MAX_ZOOM } from '../data/radar.js';
import { frontsAt } from '../data/fronts.js';
import { packGridGPU, gridSlices, fillNaN, DRIFT_H_PER_S } from './clouds.js';

export const FIELD_SHELL = 1.0022;
export const FIELD_FLOATS = 8 * 4 + 16 * 4 + 12 * 4 + 8 * 4;
export const LINE_FLOATS = 12;
export const RADAR_BOUNDS = Object.freeze({ lat0: 20, lat1: 54, lon0: -130, lon1: -60 });
export const ISOBAR_STEP = 4;

// ── palettes ────────────────────────────────────────────────────────────
// TV temperature palette, [°F, '#rrggbb']. TEMP_STOPS is the same table in
// °C, the form ui.js legend(stops) takes (main.js passes it on).
export const TEMP_STOPS_F = [
  [-40, '#e6d2f2'], [-20, '#b583d9'], [0, '#7d52c8'], [10, '#5161d6'], [20, '#3c8ee4'],
  [32, '#5cc6f2'], [40, '#46c4a5'], [50, '#62c95a'], [60, '#bcdc47'], [70, '#f5d544'],
  [80, '#f6a33b'], [90, '#ec5c2e'], [100, '#c9262c'], [110, '#8f1631'], [120, '#5e0d2c'],
];
// Radar reflectivity, [dBZ, '#rrggbb']: TV green, yellow, red, magenta.
export const RADAR_STOPS = [
  [12, '#7ee07a'], [20, '#2fb52f'], [28, '#13861a'], [34, '#f2ea2e'], [40, '#f5b120'],
  [45, '#ef7618'], [50, '#e0261c'], [55, '#b0101c'], [60, '#e03cc6'], [65, '#ffffff'],
];
export const fToC = f => (f - 32) / 1.8;
export const TEMP_STOPS = TEMP_STOPS_F.map(([f, h]) => [Math.round(fToC(f) * 100) / 100, h]);
export const SNOW_STOPS = [[10, '#d8ecff'], [20, '#9ccaff'], [30, '#5d97ff'], [40, '#2f60e6'], [50, '#ffffff']];
export const RADAR_MIN_DBZ = 12;

const hexRGB = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);

function ramp(stops, v) {
  if (v <= stops[0][0]) return hexRGB(stops[0][1]);
  for (let i = 0; i + 1 < stops.length; i++) {
    const [v0, c0] = stops[i], [v1, c1] = stops[i + 1];
    if (v <= v1) {
      const u = (v - v0) / (v1 - v0), a = hexRGB(c0), b = hexRGB(c1);
      return a.map((x, k) => x + (b[k] - x) * u);
    }
  }
  return hexRGB(stops[stops.length - 1][1]);
}
// sRGB 0..1 colour of a temperature in °C (the shader uses the same ramp)
export const tempColor = c => ramp(TEMP_STOPS_F, c * 1.8 + 32);
export function radarAlpha(dbz) {
  const s = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  return s(RADAR_MIN_DBZ - 3, RADAR_MIN_DBZ + 6, dbz) * (0.72 + 0.28 * s(20, 45, dbz));
}
export const radarColor = (dbz, snow = false) => ramp(snow ? SNOW_STOPS : RADAR_STOPS, dbz);
// Marshall-Palmer: Z = 200 R^1.6 (R mm per hour)
export const precipToDbz = mmh => (mmh > 0.02 ? 10 * Math.log10(200 * Math.pow(mmh, 1.6)) : 0);

// ── RainViewer Universal Blue decode ────────────────────────────────────
// The public API now returns colour scheme 2 (Universal Blue) for every
// colour value. Table from rainviewer_api_colors_table.csv: rain dBZ -10..95
// and snow dBZ -9..95, 'rrggbbaa' per dBZ step.
export const UB_RAIN = { from: -10, hex: '6361591466635a1969665c1e6c685d246f6b5f29726e612e75706234787364397c75653e7f786744827b6949857d6a4e88806c548b826d598e856f5e928871649e93756eaa9e7978b6a97e82c2b4828ccec08796d2c48ba0d6c88faadacc93b4ded097be88ddeeff6cd1ebff51c5e8ff36bae5ff1baee2ff00a3e0ff009ad5ff0091caff0088bfff007fb4ff0077aaff0070a3ff00699cff006295ff005b8eff005588ff005180ff004e78ff004a70ff004768ffffee00ffffe000ffffd200ffffc500ffffb700ffffaa00ffff9f00ffff9500ffff8b00ffff8100ffff4400fff23600ffe62800ffd91b00ffcd0d00ffc10000ffa80000ff8f0000ff760000ff5d0000ffffaaffffff9fffffff95ffffff8bffffff81ffffff77ffffff6cffffff62ffffff58ffffff4effffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff' };
export const UB_SNOW = { from: -9, hex: 'ceffff0ccdffff19ccffff26cbffff33cbffff3fcaffff4cc9ffff59c8ffff66c7ffff72c7ffff7fc6ffff8cc5ffff99c4ffffa5c3ffffb2c3ffffbfc2ffffccc1ffffd8c0ffffe5bffffff2bfffffffb8f8ffffb2f2ffffabebffffa5e5ffff9fdfffff98d8ffff92d2ffff8bcbffff85c5ffff7fbfffff78b8ffff72b2ffff6babffff65a5ffff5f9fffff5b9bffff5898ffff5595ffff5292ffff4f8fffff4b8bffff4888ffff4585ffff4282ffff3f7fffff3b7bffff3878ffff3575ffff3272ffff2f6fffff2b6bffff2868ffff2565ffff2262ffff1f5fffff1b5bffff1858ffff1555ffff1252ffff0f4fffff0c4bffff0948ffff0645ffff0242ffff003fffff003bffff0038ffff0035ffff0032ffff002fffff002bffff0028ffff0025ffff0022ffff001fffff001bffff0018ffff0015ffff0012ffff000fffff000cffff0009ffff0006ffff0002ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff' };

let UB = null;
function ubTable() {
  if (UB) return UB;
  const exact = new Map(), list = [];
  for (const [tab, snow] of [[UB_RAIN, false], [UB_SNOW, true]]) {
    for (let k = 0; k * 8 < tab.hex.length; k++) {
      const v = parseInt(tab.hex.slice(k * 8, k * 8 + 8), 16) >>> 0;
      let dbz = tab.from + k;
      // 75 dBZ and up is a flat green test band in the table: clip to 75
      if (dbz > 75) dbz = 75;
      const e = { dbz, snow, r: v >>> 24, g: (v >>> 16) & 255, b: (v >>> 8) & 255, a: v & 255 };
      if (!exact.has(v)) exact.set(v, e);
      list.push(e);
    }
  }
  UB = { exact, list, near: new Map() };
  return UB;
}

// { dbz, snow } for one RGBA pixel, or null for no echo. Exact table hit
// first; a canvas round trip can shift translucent colours by a step, so a
// miss takes the nearest table colour (cached).
export function decodeUB(r, g, b, a) {
  if (a < 8) return null;
  const T = ubTable();
  const key = (((r << 24) | (g << 16) | (b << 8) | a) >>> 0);
  const hit = T.exact.get(key) || T.near.get(key);
  if (hit) return hit;
  let best = null, bd = Infinity;
  for (const e of T.list) {
    const d = (e.r - r) ** 2 + (e.g - g) ** 2 + (e.b - b) ** 2 + 0.5 * (e.a - a) ** 2;
    if (d < bd) { bd = d; best = e; }
  }
  if (T.near.size < 65536) T.near.set(key, best);
  return best;
}

// RGBA mosaic -> rg bytes per pixel: r = dBZ * 3 (0 = none, below 1 dBZ
// counts as none), g = 255 for snow.
export function decodeTileRGBA(rgba, w, h) {
  const out = new Uint8Array(w * h * 2);
  for (let p = 0, n = w * h; p < n; p++) {
    const o = p * 4;
    if (rgba[o + 3] < 8) continue;
    const e = decodeUB(rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]);
    if (!e || e.dbz < 1) continue;
    out[p * 2] = Math.min(255, Math.round(e.dbz * 3));
    out[p * 2 + 1] = e.snow ? 255 : 0;
  }
  return out;
}

// The tile block and output equirect size for a radar mosaic at zoom z.
export function radarPlan(bounds = RADAR_BOUNDS, z = 5) {
  const zz = Math.max(0, Math.min(MAX_ZOOM, z | 0));
  const a = lonLatToTile(bounds.lon0, bounds.lat1, zz), c = lonLatToTile(bounds.lon1, bounds.lat0, zz);
  const x0 = Math.floor(a.x), y0 = Math.floor(a.y), x1 = Math.floor(c.x - 1e-9), y1 = Math.floor(c.y - 1e-9);
  const nx = x1 - x0 + 1, ny = y1 - y0 + 1, n = 2 ** zz;
  const tiles = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.push({ z: zz, x, y });
  const lon0 = x0 / n * 360 - 180, lon1 = (x1 + 1) / n * 360 - 180;
  const outBounds = { lat0: bounds.lat0, lat1: bounds.lat1, lon0, lon1 };
  const outW = nx * 256;
  const outH = Math.max(2, Math.round(outW * (bounds.lat1 - bounds.lat0) / (lon1 - lon0) * 1.25));
  return { z: zz, x0, y0, nx, ny, w: nx * 256, h: ny * 256, tiles, outBounds, outW, outH };
}

// Mercator rg mosaic (radarPlan block at zoom z) -> equirect rg over
// outBounds, nearest sample. Row 0 = north (lat1).
export function mercToEquirect(src, outBounds, outW, outH) {
  const out = new Uint8Array(outW * outH * 2);
  const n = 2 ** src.z, R = Math.PI / 180;
  for (let row = 0; row < outH; row++) {
    const lat = outBounds.lat1 - (row + 0.5) / outH * (outBounds.lat1 - outBounds.lat0);
    const ty = (1 - Math.log(Math.tan(lat * R) + 1 / Math.cos(lat * R)) / Math.PI) / 2 * n;
    const sy = Math.floor((ty - src.y0) * 256);
    if (sy < 0 || sy >= src.h) continue;
    for (let col = 0; col < outW; col++) {
      const lon = outBounds.lon0 + (col + 0.5) / outW * (outBounds.lon1 - outBounds.lon0);
      const sx = Math.floor(((lon + 180) / 360 * n - src.x0) * 256);
      if (sx < 0 || sx >= src.w) continue;
      const si = (sy * src.w + sx) * 2, oi = (row * outW + col) * 2;
      out[oi] = src.data[si]; out[oi + 1] = src.data[si + 1];
    }
  }
  return out;
}

// Which radar frames to show at time t: { a, b, u, model } with a, b
// indices into frames (or -1) and model 0..1 the futurecast weight (1
// before the first frame by 30 min, rising over 60 min past the newest).
export function radarPick(frames, t) {
  const n = frames ? frames.length : 0;
  if (!n) return { a: -1, b: -1, u: 0, model: 1 };
  const s = (x) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };
  const first = frames[0].time, last = frames[n - 1].time;
  const model = Math.max(1 - s((t - (first - 30 * 60e3)) / (30 * 60e3)), s((t - last) / (60 * 60e3)));
  if (t <= first) return { a: 0, b: 0, u: 0, model };
  if (t >= last) return { a: n - 1, b: n - 1, u: 0, model };
  let i = 0;
  while (i + 1 < n && frames[i + 1].time <= t) i++;
  const gap = frames[i + 1].time - frames[i].time;
  const u = (t - frames[i].time) / gap;
  // a gap over 20 min (a missing frame) holds the nearer frame
  if (gap > 20 * 60e3) { const k = u < 0.5 ? i : i + 1; return { a: k, b: k, u: 0, model }; }
  return { a: i, b: i + 1, u, model };
}

// ── isobars ─────────────────────────────────────────────────────────────
function crw(t) {
  return [t * ((2 - t) * t - 1) * 0.5, (t * t * (3 * t - 5) + 2) * 0.5, t * ((4 - 3 * t) * t + 1) * 0.5, (t - 1) * t * t * 0.5];
}
// Catmull-Rom upsample by k: output (nI - 1) k + 1 by (nJ - 1) k + 1.
export function upsampleBicubic(a, nI, nJ, k) {
  const mI = (nI - 1) * k + 1, mJ = (nJ - 1) * k + 1;
  const out = new Float32Array(mI * mJ);
  // one ghost row and column past each edge, extrapolated linearly, so the
  // edge cells stay as smooth as the interior
  const raw = (i, j) => a[i * nJ + j];
  const col = (i, j) => (i < 0 ? 2 * raw(0, j) - raw(1, j) : i >= nI ? 2 * raw(nI - 1, j) - raw(nI - 2, j) : raw(i, j));
  const at = (i, j) => (j < 0 ? 2 * col(i, 0) - col(i, 1) : j >= nJ ? 2 * col(i, nJ - 1) - col(i, nJ - 2) : col(i, j));
  for (let I = 0; I < mI; I++) {
    const fi = I / k, i0 = Math.min(nI - 2, Math.floor(fi)), wi = crw(fi - i0);
    for (let J = 0; J < mJ; J++) {
      const fj = J / k, j0 = Math.min(nJ - 2, Math.floor(fj)), wj = crw(fj - j0);
      let s = 0;
      for (let di = 0; di < 4; di++) for (let dj = 0; dj < 4; dj++) s += wi[di] * wj[dj] * at(i0 - 1 + di, j0 - 1 + dj);
      out[I * mJ + J] = s;
    }
  }
  return { data: out, nI: mI, nJ: mJ };
}

// Marching squares at one level. Returns segments [ka, kb] of edge keys and
// a point map key -> [i, j] (fractional grid coordinates). Edge keys:
// 'h' i j = edge (i, j)-(i, j+1); 'v' i j = edge (i, j)-(i+1, j).
export function marchingSquares(d, nI, nJ, level) {
  const pts = new Map(), segs = [];
  const v = (i, j) => d[i * nJ + j];
  const put = (key, i, j) => { if (!pts.has(key)) pts.set(key, [i, j]); return key; };
  const eh = (i, j) => { const a = v(i, j), b = v(i, j + 1); return put(`h${i},${j}`, i, j + (level - a) / (b - a)); };
  const ev = (i, j) => { const a = v(i, j), b = v(i + 1, j); return put(`v${i},${j}`, i + (level - a) / (b - a), j); };
  for (let i = 0; i + 1 < nI; i++) for (let j = 0; j + 1 < nJ; j++) {
    const a = v(i, j), b = v(i, j + 1), c = v(i + 1, j + 1), e = v(i + 1, j);
    const code = (a >= level ? 1 : 0) | (b >= level ? 2 : 0) | (c >= level ? 4 : 0) | (e >= level ? 8 : 0);
    if (code === 0 || code === 15) continue;
    const S = () => eh(i, j), E = () => ev(i, j + 1), N = () => eh(i + 1, j), W = () => ev(i, j);
    switch (code) {
      case 1: case 14: segs.push([W(), S()]); break;
      case 2: case 13: segs.push([S(), E()]); break;
      case 3: case 12: segs.push([W(), E()]); break;
      case 4: case 11: segs.push([E(), N()]); break;
      case 6: case 9: segs.push([S(), N()]); break;
      case 7: case 8: segs.push([W(), N()]); break;
      case 5: case 10: {
        // saddle: the centre value decides which corners join
        const mid = (a + b + c + e) / 4;
        if ((mid >= level) === (code === 5)) { segs.push([W(), N()]); segs.push([S(), E()]); }
        else { segs.push([W(), S()]); segs.push([E(), N()]); }
        break;
      }
    }
  }
  return { segs, pts };
}

// Chain segments into polylines: [{ keys, closed }].
export function joinSegments(segs) {
  const adj = new Map();
  const link = (a, b, s) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push({ to: b, s }); };
  segs.forEach(([a, b], s) => { link(a, b, s); link(b, a, s); });
  const used = new Uint8Array(segs.length), out = [];
  const walk = (start, line) => {
    let cur = start;
    for (;;) {
      const next = (adj.get(cur) || []).find(e => !used[e.s]);
      if (!next) return;
      used[next.s] = 1; line.push(next.to); cur = next.to;
    }
  };
  // open lines first (ends have one neighbour), then the closed loops
  const order = [...adj.keys()].sort((x, y) => adj.get(x).length - adj.get(y).length);
  for (const k of order) {
    if ((adj.get(k) || []).every(e => used[e.s])) continue;
    const line = [k];
    walk(k, line);
    const closed = line.length > 2 && line[0] === line[line.length - 1];
    if (closed) line.pop();
    if (line.length > 1) out.push({ keys: line, closed });
  }
  return out;
}

// Chaikin corner cutting; open lines keep their end points.
export function chaikin(pts, iters = 2, closed = false) {
  let p = pts;
  for (let it = 0; it < iters; it++) {
    const q = [], n = p.length;
    if (n < 3) return p;
    if (!closed) q.push(p[0]);
    const m = closed ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const a = p[i], b = p[(i + 1) % n];
      q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) q.push(p[n - 1]);
    p = q;
  }
  return p;
}

// Isobars at time t: [{ hPa, pts: [[lat, lon], …], closed }].
// opts: { step 4, k 4 (upsample), smooth 2, minPts 4 }; msl may be passed
// in place of reading the grid at t.
export function isobarLines(grid, t, opts = {}) {
  const step = opts.step || ISOBAR_STEP, k = opts.k || 4;
  const raw = opts.msl || gridFrame(grid, 'msl', t);
  const filled = fillNaN(raw, grid.nLat, grid.nLon, 1013);
  const up = upsampleBicubic(filled, grid.nLat, grid.nLon, k);
  let lo = Infinity, hi = -Infinity;
  for (const x of up.data) { if (x < lo) lo = x; if (x > hi) hi = x; }
  const out = [];
  if (!Number.isFinite(lo) || hi - lo < 1e-6) return out;
  const dLat = grid.dLat / k, dLon = grid.dLon / k;
  for (let lev = Math.ceil(lo / step) * step; lev <= hi; lev += step) {
    // nudge the level off exact grid values so no vertex sits on a level
    const { segs, pts } = marchingSquares(up.data, up.nI, up.nJ, lev + 1e-4);
    for (const line of joinSegments(segs)) {
      if (line.keys.length < (opts.minPts || 4)) continue;
      const ll = line.keys.map(key => { const [i, j] = pts.get(key); return [grid.lat0 + i * dLat, grid.lon0 + j * dLon]; });
      out.push({ hPa: lev, pts: chaikin(ll, opts.smooth ?? 2, line.closed), closed: line.closed });
    }
  }
  return out;
}

// Distance (deg, longitude scaled by cos lat) from a point to the grid edge
// (negative outside).
export function edgeDistance(grid, lat, lon) {
  const lat1 = grid.lat0 + (grid.nLat - 1) * grid.dLat, lon1 = grid.lon0 + (grid.nLon - 1) * grid.dLon;
  const c = Math.cos(lat * Math.PI / 180);
  return Math.min(lat - grid.lat0, lat1 - lat, (lon - grid.lon0) * c, (lon1 - lon) * c);
}

const arcDeg = (a, b) => {
  const R = Math.PI / 180;
  const s = Math.sin((b[0] - a[0]) * R / 2) ** 2 + Math.cos(a[0] * R) * Math.cos(b[0] * R) * Math.sin((b[1] - a[1]) * R / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(s))) / R;
};

// Label positions along isobars: the most interior point of each line, and
// one more per `every` degrees of length. [{ lat, lon, hPa, text }]
export function isobarLabels(lines, grid, opts = {}) {
  const every = opts.every || 18, minLen = opts.minLen || 4, margin = opts.margin ?? 2;
  const out = [];
  for (const L of lines) {
    let len = 0;
    for (let i = 1; i < L.pts.length; i++) len += arcDeg(L.pts[i - 1], L.pts[i]);
    if (len < minLen) continue;
    const n = Math.max(1, Math.min(4, Math.floor(len / every) + 1));
    // split the line into n parts; in each, the point farthest from the edge
    const per = Math.ceil(L.pts.length / n);
    for (let s = 0; s < n; s++) {
      let best = null, bd = -Infinity;
      for (let i = s * per; i < Math.min(L.pts.length, (s + 1) * per); i++) {
        const [la, lo] = L.pts[i], d = edgeDistance(grid, la, lo);
        if (d > bd) { bd = d; best = L.pts[i]; }
      }
      if (best && bd >= margin) out.push({ lat: best[0], lon: best[1], hPa: L.hPa, text: String(L.hPa) });
    }
  }
  return out;
}

// Local pressure extrema in an msl field (grid layout): [{ type, lat, lon,
// hPa }]. A centre must be the extreme within `radius` degrees and differ
// from the mean of the ring at that radius by `prominence` hPa.
export function findCenters(grid, msl, opts = {}) {
  const k = opts.k || 2, radius = opts.radius || 6, prom = opts.prominence ?? 2, margin = opts.margin ?? 2.5;
  const up = upsampleBicubic(fillNaN(msl, grid.nLat, grid.nLon, 1013), grid.nLat, grid.nLon, k);
  const dLat = grid.dLat / k, dLon = grid.dLon / k, out = [];
  const rI = Math.max(1, Math.round(radius / dLat));
  for (let i = 0; i < up.nI; i++) for (let j = 0; j < up.nJ; j++) {
    const lat = grid.lat0 + i * dLat, lon = grid.lon0 + j * dLon;
    if (edgeDistance(grid, lat, lon) < margin) continue;
    const c = up.data[i * up.nJ + j];
    const rJ = Math.max(1, Math.round(radius / (dLon * Math.max(0.3, Math.cos(lat * Math.PI / 180)))));
    let isMax = true, isMin = true, ring = 0, nRing = 0;
    for (let di = -rI; di <= rI && (isMax || isMin); di++) for (let dj = -rJ; dj <= rJ; dj++) {
      if (!di && !dj) continue;
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= up.nI || jj >= up.nJ) continue;
      const e = (di / rI) ** 2 + (dj / rJ) ** 2;
      if (e > 1) continue;
      const v = up.data[ii * up.nJ + jj];
      if (v >= c) isMax = false;
      if (v <= c) isMin = false;
      if (e > 0.6) { ring += v; nRing++; }
    }
    if (!nRing) continue;
    ring /= nRing;
    if (isMax && c - ring >= prom) out.push({ type: 'H', lat, lon, hPa: Math.round(c) });
    if (isMin && ring - c >= prom) out.push({ type: 'L', lat, lon, hPa: Math.round(c) });
  }
  return out;
}

// H and L centres for time t: the WPC analysis or forecast held at t when
// fronts are loaded (frontsAt), else the grid extrema.
export function pressureCenters(fronts, grid, t, opts = {}) {
  const box = opts.box || { lat0: 15, lat1: 62, lon0: -140, lon1: -52 };
  const inBox = c => c.lat >= box.lat0 && c.lat <= box.lat1 && c.lon >= box.lon0 && c.lon <= box.lon1;
  const set = fronts ? frontsAt(fronts, t) : null;
  if (set && ((set.highs && set.highs.length) || (set.lows && set.lows.length))) {
    const m = (list, type) => (list || []).filter(inBox).map(c => ({ type, lat: c.lat, lon: c.lon, hPa: c.hPa, text: type, source: 'wpc' }));
    return [...m(set.highs, 'H'), ...m(set.lows, 'L')];
  }
  if (!grid || !grid.fields || !grid.fields.msl) return [];
  return findCenters(grid, gridFrame(grid, 'msl', t), opts).filter(inBox).map(c => ({ ...c, text: c.type, source: 'grid' }));
}

// labels.js setMarks() form: isobar values, plus the grid H / L (labels.js
// draws the WPC H / L itself from the fronts set).
export function labelMarks(labels) {
  return [
    ...labels.isobars.map(l => ({ kind: 'iso', lat: l.lat, lon: l.lon, text: l.text })),
    ...labels.centers.filter(c => c.source === 'grid').map(c => ({ kind: c.type, lat: c.lat, lon: c.lon, text: String(c.hPa) })),
  ];
}

// Line strips for the GPU: two vertices per point, LINE_FLOATS each
// (cur xyz, side, prev xyz, width px, next xyz, alpha). Indices: two
// triangles per segment. alphaAt(lat, lon) fades lines (grid edge).
export function lineMesh(lines, radius = FIELD_SHELL, opts = {}) {
  const width = opts.width || 1.4, alphaAt = opts.alphaAt || (() => 1);
  let nv = 0, ni = 0;
  for (const L of lines) {
    const n = L.pts.length + (L.closed ? 1 : 0);
    if (n < 2) continue;
    nv += n * 2; ni += (n - 1) * 6;
  }
  const verts = new Float32Array(nv * LINE_FLOATS), idx = new Uint32Array(ni);
  const R = Math.PI / 180;
  const xyz = ([la, lo]) => [Math.cos(la * R) * Math.cos(lo * R) * radius, Math.sin(la * R) * radius, -Math.cos(la * R) * Math.sin(lo * R) * radius];
  let v = 0, ix = 0;
  for (const L of lines) {
    const P = L.closed ? [...L.pts, L.pts[0]] : L.pts;
    const n = P.length;
    if (n < 2) continue;
    const X = P.map(xyz), A = P.map(p => alphaAt(p[0], p[1]));
    const base = v;
    for (let i = 0; i < n; i++) {
      const prev = i > 0 ? X[i - 1] : (L.closed ? X[n - 2] : X[i]);
      const next = i < n - 1 ? X[i + 1] : (L.closed ? X[1] : X[i]);
      for (const side of [-1, 1]) {
        verts.set([...X[i], side, ...prev, width, ...next, A[i]], v * LINE_FLOATS);
        v++;
      }
    }
    for (let i = 0; i + 1 < n; i++) {
      const a = base + i * 2;
      idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], ix);
      ix += 6;
    }
  }
  return { verts, idx, count: ni };
}

// Fields uniform (struct Fld in fields.wgsl).
// s: { grid, slices, hasGrid, flowH, quality, op: {temp, radar, wind, iso},
//      radB, radMix, model, hasRadar, hasWater, seaK, isotherms, lineW }
export function packFields(s, out = new Float32Array(FIELD_FLOATS)) {
  out.fill(0);
  const g = s.grid || { lat0: 0, dLat: 1, lon0: 0, dLon: 1, nLat: 1, nLon: 1 };
  const sl = s.slices || { u: 0, off0: 0, off1: 0 };
  const rb = s.radB || RADAR_BOUNDS, op = s.op || {};
  out.set([
    g.lat0, g.dLat, g.lon0, g.dLon,
    g.nLat, g.nLon, sl.off0, sl.off1,
    sl.u, s.hasGrid ? 1 : 0, s.flowH || 0, s.quality ?? 2,
    op.temp ?? 0, op.radar ?? 0, op.wind ?? 0, op.iso ?? 0,
    rb.lat0, rb.lat1, rb.lon0, rb.lon1,
    s.radMix || 0, s.model ?? 1, s.hasRadar ? 1 : 0, s.hasWater ? 1 : 0,
    s.seaK ?? 0.5, s.isotherms ?? 0.16, TEMP_STOPS.length, RADAR_STOPS.length,
    SNOW_STOPS.length, s.lineW ?? 1.4, RADAR_MIN_DBZ, 0,
  ], 0);
  let o = 32;
  TEMP_STOPS_F.forEach(([f, h]) => { out.set([...hexRGB(h), fToC(f)], o); o += 4; });
  o = 32 + 16 * 4;
  RADAR_STOPS.forEach(([d, h]) => { out.set([...hexRGB(h), d], o); o += 4; });
  o = 32 + 28 * 4;
  SNOW_STOPS.forEach(([d, h]) => { out.set([...hexRGB(h), d], o); o += 4; });
  return out;
}

// ── GPU layer ───────────────────────────────────────────────────────────
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { await fn(items[k]); } catch { /* one tile */ } }
  }));
}

export async function createFields(core, opts = {}) {
  const { device, format, frameLayout } = core;
  const code = core.frameWGSL + '\n' + await core.loadText('shaders/fields.wgsl');
  const module = device.createShaderModule({ label: 'weather fields', code });
  const quality = opts.quality ?? core.quality;
  const zoom = opts.radarZoom ?? (quality >= 1 ? 5 : 4);
  const cacheMax = quality >= 2 ? 10 : quality >= 1 ? 6 : 4;
  const V = GPUShaderStage.VERTEX, Fr = GPUShaderStage.FRAGMENT;

  const layout = device.createBindGroupLayout({ label: 'weather fields', entries: [
    { binding: 0, visibility: V | Fr, buffer: { type: 'uniform' } },
    { binding: 1, visibility: Fr, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: Fr, texture: { sampleType: 'float' } },
    { binding: 3, visibility: Fr, texture: { sampleType: 'float' } },
    { binding: 4, visibility: Fr, texture: { sampleType: 'float' } },
    { binding: 5, visibility: Fr, sampler: { type: 'filtering' } },
    { binding: 6, visibility: Fr, sampler: { type: 'filtering' } },
  ] });
  const pLayout = device.createPipelineLayout({ bindGroupLayouts: [frameLayout, layout] });
  const full = entry => device.createRenderPipelineAsync({
    label: 'weather fields ' + entry, layout: pLayout,
    vertex: { module, entryPoint: 'vsField' },
    fragment: { module, entryPoint: entry, targets: [{ format, blend: core.PREMUL_BLEND }] },
    primitive: { topology: 'triangle-list' }, depthStencil: core.LAYER_DEPTH,
  });
  const [tempPipe, radarPipe, windPipe, linePipe] = await Promise.all([full('fsTemp'), full('fsRadar'), full('fsWind'),
    device.createRenderPipelineAsync({
      label: 'weather isobars', layout: pLayout,
      vertex: { module, entryPoint: 'vsLine', buffers: [{ arrayStride: LINE_FLOATS * 4, attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x4' },
        { shaderLocation: 1, offset: 16, format: 'float32x4' },
        { shaderLocation: 2, offset: 32, format: 'float32x4' }] }] },
      fragment: { module, entryPoint: 'fsLine', targets: [{ format, blend: core.PREMUL_BLEND }] },
      primitive: { topology: 'triangle-list' }, depthStencil: core.LAYER_DEPTH,
    })]);

  const uBuf = device.createBuffer({ label: 'weather fields', size: FIELD_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const uPack = new Float32Array(FIELD_FLOATS);
  let gridBuf = device.createBuffer({ label: 'weather fields grid', size: 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const blank = device.createTexture({ size: [1, 1], format: 'rg8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: blank }, new Uint8Array(2), { bytesPerRow: 2 }, [1, 1]);
  let water = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: water }, new Uint8Array(4), { bytesPerRow: 4 }, [1, 1]);
  const sClamp = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const sWrap = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'clamp-to-edge' });
  let vBuf = null, iBuf = null, lineCount = 0;

  const st = {
    grid: null, fronts: null, radar: null, hasWater: false,
    show: { temp: true, radar: true, isobars: false, wind: false },
    op: { temp: 0.62, radar: 0.9, wind: 0.55, iso: 0.9 }, isotherms: 0.16, futurecast: true,
    isoKey: '', labels: { isobars: [], centers: [] }, marks: [],
    cache: new Map(), loading: null, failed: new Map(), useA: null, useB: null, pick: null, radErr: null,
  };
  let group = null, dead = false;
  const rebind = () => {
    const A = st.useA ? st.useA.view : blank.createView(), B = st.useB ? st.useB.view : A;
    group = device.createBindGroup({ label: 'weather fields', layout, entries: [
      { binding: 0, resource: { buffer: uBuf } }, { binding: 1, resource: { buffer: gridBuf } },
      { binding: 2, resource: A }, { binding: 3, resource: B }, { binding: 4, resource: water.createView() },
      { binding: 5, resource: sClamp }, { binding: 6, resource: sWrap }] });
  };
  rebind();

  // water mask (the same file the globe uses; the browser cache serves it)
  (async () => {
    try {
      const r = await fetch(new URL('tex/water-2k.png', core.baseUrl));
      if (!r.ok) return;
      const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      if (dead) { bmp.close(); return; }
      const t = device.createTexture({ label: 'weather fields water', size: [bmp.width, bmp.height], format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
      device.queue.copyExternalImageToTexture({ source: bmp }, { texture: t }, [bmp.width, bmp.height]);
      bmp.close();
      water.destroy(); water = t; st.hasWater = true; rebind();
    } catch { /* no mask: one opacity everywhere */ }
  })();

  // ── radar mosaics ──
  const plan = radarPlan(RADAR_BOUNDS, zoom);
  async function buildMosaic(frame) {
    const host = st.radar.host;
    const cv = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(plan.w, plan.h) : Object.assign(document.createElement('canvas'), { width: plan.w, height: plan.h });
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    let got = 0;
    await pool(plan.tiles, 6, async tl => {
      const r = await fetch(tileUrl(frame, tl.z, tl.x, tl.y, { host }));
      if (!r.ok) return;
      const bmp = await createImageBitmap(await r.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      ctx.drawImage(bmp, (tl.x - plan.x0) * 256, (tl.y - plan.y0) * 256);
      bmp.close(); got++;
    });
    if (!got) throw new Error('radar: no tiles');
    const img = ctx.getImageData(0, 0, plan.w, plan.h);
    const merc = decodeTileRGBA(img.data, plan.w, plan.h);
    const rg = mercToEquirect({ data: merc, w: plan.w, h: plan.h, z: plan.z, x0: plan.x0, y0: plan.y0 }, plan.outBounds, plan.outW, plan.outH);
    if (dead) return null;
    const tex = device.createTexture({ label: 'weather radar ' + frame.time, size: [plan.outW, plan.outH], format: 'rg8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: tex }, rg, { bytesPerRow: plan.outW * 2 }, [plan.outW, plan.outH]);
    return { tex, view: tex.createView(), time: frame.time, used: performance.now() };
  }
  function evict(keep) {
    while (st.cache.size > cacheMax) {
      let old = null;
      for (const e of st.cache.values()) if (!keep.includes(e) && (!old || e.used < old.used)) old = e;
      if (!old) return;
      st.cache.delete(old.time); old.tex.destroy();
    }
  }
  function want(frame) {
    if (!frame || st.loading || st.cache.has(frame.time) || dead) return;
    const f = st.failed.get(frame.time);
    if (f && performance.now() - f < 60e3) return;
    st.loading = buildMosaic(frame).then(e => {
      if (e) { st.cache.set(e.time, e); evict([st.useA, st.useB, e]); }
      st.radErr = null;
    }, err => { st.failed.set(frame.time, performance.now()); st.radErr = String(err && err.message || err); })
      .finally(() => { st.loading = null; });
  }

  function rebuildIsobars(t) {
    const g = st.grid;
    const key = Math.round(t / 9e5) + ':' + (st.fronts ? 1 : 0);
    if (key === st.isoKey) return;
    st.isoKey = key;
    const lines = isobarLines(g, t);
    st.labels = { isobars: isobarLabels(lines, g), centers: pressureCenters(st.fronts, g, t) };
    st.marks = labelMarks(st.labels);
    const mesh = lineMesh(lines, FIELD_SHELL, { alphaAt: (la, lo) => Math.min(1, Math.max(0, edgeDistance(g, la, lo) / 2.5)) });
    lineCount = mesh.count;
    if (!lineCount) return;
    if (!vBuf || vBuf.size < mesh.verts.byteLength) {
      if (vBuf) vBuf.destroy();
      vBuf = device.createBuffer({ label: 'weather isobars', size: Math.ceil(mesh.verts.byteLength * 1.5 / 4) * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    }
    if (!iBuf || iBuf.size < mesh.idx.byteLength) {
      if (iBuf) iBuf.destroy();
      iBuf = device.createBuffer({ label: 'weather isobars', size: Math.ceil(mesh.idx.byteLength * 1.5 / 4) * 4, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    }
    device.queue.writeBuffer(vBuf, 0, mesh.verts);
    device.queue.writeBuffer(iBuf, 0, mesh.idx);
  }

  const drawFull = (pass, pipe) => {
    pass.setPipeline(pipe);
    pass.setBindGroup(0, core.frameGroup);
    pass.setBindGroup(1, group);
    pass.draw(3);
  };

  const under = {
    name: 'fields-temp', order: 8,
    update() {},
    encode(pass) { if (st.grid && st.show.temp) drawFull(pass, tempPipe); },
    destroy() {},
  };

  const layer = {
    name: 'fields', order: 20, under, plan,
    setGrid(g) {
      if (!g || !g.times || !g.times.length || !g.fields) return;
      st.grid = g;
      const packed = packGridGPU(g);
      gridBuf.destroy();
      gridBuf = device.createBuffer({ label: 'weather fields grid', size: packed.data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(gridBuf, 0, packed.data);
      st.isoKey = '';
      rebind();
    },
    setRadar(set) {
      st.radar = set && Array.isArray(set.frames) ? set : null;
      const keepT = new Set((st.radar ? st.radar.frames : []).map(f => f.time));
      for (const [k, e] of st.cache) if (!keepT.has(k) && e !== st.useA && e !== st.useB) { st.cache.delete(k); e.tex.destroy(); }
      if (st.radar && st.radar.frames.length) want(st.radar.frames[st.radar.frames.length - 1]);
    },
    setFronts(set) { st.fronts = set || null; st.isoKey = ''; },
    set(o = {}) {
      for (const k of ['temp', 'radar', 'isobars', 'wind']) if (k in o) st.show[k] = !!o[k];
      const num = (k, d) => { if (Number.isFinite(o[k])) st.op[d] = Math.max(0, Math.min(1, o[k])); };
      num('tempOpacity', 'temp'); num('radarOpacity', 'radar'); num('windOpacity', 'wind'); num('isobarOpacity', 'iso');
      if (Number.isFinite(o.isotherms)) st.isotherms = Math.max(0, Math.min(1, o.isotherms));
      else if (o.isotherms === false) st.isotherms = 0;
      if ('futurecast' in o) st.futurecast = !!o.futurecast;
    },
    labels() { return st.labels; },
    marks() { return st.marks; },
    radarState() {
      const fr = st.radar ? st.radar.frames : [];
      return { frame: st.useA ? st.useA.time : null, frames: fr.length, loaded: st.cache.size, model: st.pick ? st.pick.model : 1, error: st.radErr };
    },
    update(frame, app) {
      if (dead) return;
      const t = (app && app.t) || frame.t;
      const g = st.grid;
      if (g) rebuildIsobars(t);
      // radar frames for t: use what is loaded, ask for what is missing
      const frames = st.radar ? st.radar.frames : [];
      const pk = radarPick(frames, t);
      let A = null, B = null, u = 0;
      if (pk.a >= 0 && st.show.radar) {
        const fa = frames[pk.a], fb = frames[pk.b];
        want(fa); if (fb !== fa) want(fb);
        A = st.cache.get(fa.time) || null;
        B = st.cache.get(fb.time) || null;
        if (A && B) u = pk.u;
        else if (A || B) { A = A || B; B = A; }
        else {
          // nearest loaded frame in time stands in
          let best = null;
          for (const e of st.cache.values()) if (!best || Math.abs(e.time - t) < Math.abs(best.time - t)) best = e;
          A = B = best;
        }
        if (A) A.used = B.used = performance.now();
      }
      if (A !== st.useA || B !== st.useB) { st.useA = A; st.useB = B; rebind(); }
      const model = A ? (st.futurecast ? pk.model : 0) : (st.futurecast ? 1 : 0);
      st.pick = { ...pk, model };
      device.queue.writeBuffer(uBuf, 0, packFields({
        grid: g, slices: g ? gridSlices(g, t) : null, hasGrid: !!g,
        flowH: g ? (t - g.times[0]) / 3.6e6 + frame.time * DRIFT_H_PER_S : 0, quality: frame.quality,
        op: { temp: st.op.temp, radar: st.op.radar, wind: st.op.wind, iso: st.op.iso },
        radB: plan.outBounds, radMix: u, model, hasRadar: !!A, hasWater: st.hasWater, isotherms: st.isotherms,
      }, uPack));
    },
    encode(pass) {
      if (st.show.radar && (st.useA || (st.grid && st.futurecast))) drawFull(pass, radarPipe);
      if (st.grid && st.show.wind) drawFull(pass, windPipe);
      if (st.grid && st.show.isobars && lineCount && vBuf) {
        pass.setPipeline(linePipe);
        pass.setBindGroup(0, core.frameGroup);
        pass.setBindGroup(1, group);
        pass.setVertexBuffer(0, vBuf);
        pass.setIndexBuffer(iBuf, 'uint32');
        pass.drawIndexed(lineCount);
      }
    },
    destroy() {
      dead = true;
      core.removeLayer(under); core.removeLayer(layer);
      for (const e of st.cache.values()) e.tex.destroy();
      st.cache.clear();
      uBuf.destroy(); gridBuf.destroy(); blank.destroy(); water.destroy();
      if (vBuf) vBuf.destroy();
      if (iBuf) iBuf.destroy();
    },
  };
  core.addLayer(under);
  return layer;
}

