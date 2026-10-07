// ============================================================================
//  ANCIENT EARTH  ·  data.js  ·  load and decode the shipped data (no THREE)
// ----------------------------------------------------------------------------
//  All files sit in ./data and come from build/build_data.py.
//  fetchBytes streams a body into chunks and joins them at the real size:
//  the live host gzips .bin files, so content-length is the compressed
//  size and must never size a buffer. It only drives the progress bar.
//
//  The DEM (data/dem.bin) is N frames of 360 x 181 uint8 codes, row 0 at
//  90 S, column 0 at 180 W, 1 deg cells. Codes 0..127 are sea floor and
//  128..255 land, on a square-root scale (decodeElev). prepareDem makes the
//  RG8 texture layers: R the code, G the distance from the coast inland
//  (km / 16, so 255 = 4080 km or more) for the aridity estimate.
//
//  grep -n targets
//    streamed fetch ........ "export async function fetchBytes"
//    elevation decode ...... "export function decodeElev"
//    coast distance ........ "function coastDistance"
//    everything at once .... "export async function loadAll"
// ============================================================================

export async function fetchBytes(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + ': HTTP ' + res.status);
  const hint = +res.headers.get('content-length') || 0;
  if (!res.body || !res.body.getReader) {
    const b = new Uint8Array(await res.arrayBuffer()); onProgress && onProgress(1); return b;
  }
  const rd = res.body.getReader(), parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    parts.push(value); n += value.length;
    if (onProgress && hint) onProgress(Math.min(1, n / hint));
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  onProgress && onProgress(1);
  return out;
}
export async function fetchJSON(url, onProgress) {
  return JSON.parse(new TextDecoder().decode(await fetchBytes(url, onProgress)));
}

export function decodeElev(c, zmin = -9000, zmax = 6000) {
  if (c < 128) { const s = (127 - c) / 127; return zmin * s * s; }
  const s = (c - 128) / 127; return zmax * s * s;
}

// Distance from each land cell to the nearest sea cell, in km, by two
// chamfer passes on the 1 deg grid (east-west steps shrink with cos(lat)),
// run twice so the distance carries across the 180 deg seam.
function coastDistance(codes, W, H, out) {
  const INF = 1e9, d = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) d[i] = codes[i] >= 128 ? INF : 0;
  const dy = 111.2;
  for (let rep = 0; rep < 2; rep++) {
    for (let j = 0; j < H; j++) {
      const dx = Math.max(2, 111.2 * Math.cos((j - 90) * Math.PI / 180)), dd = Math.hypot(dx, dy);
      for (let i = 0; i < W; i++) {
        const k = j * W + i; if (d[k] === 0) continue;
        let v = d[k];
        const l = j * W + (i + W - 1) % W; v = Math.min(v, d[l] + dx);
        if (j > 0) {
          const u = k - W; v = Math.min(v, d[u] + dy, d[(j - 1) * W + (i + W - 1) % W] + dd, d[(j - 1) * W + (i + 1) % W] + dd);
        }
        d[k] = v;
      }
    }
    for (let j = H - 1; j >= 0; j--) {
      const dx = Math.max(2, 111.2 * Math.cos((j - 90) * Math.PI / 180)), dd = Math.hypot(dx, dy);
      for (let i = W - 1; i >= 0; i--) {
        const k = j * W + i; if (d[k] === 0) continue;
        let v = d[k];
        const r = j * W + (i + 1) % W; v = Math.min(v, d[r] + dx);
        if (j < H - 1) {
          const u = k + W; v = Math.min(v, d[u] + dy, d[(j + 1) * W + (i + W - 1) % W] + dd, d[(j + 1) * W + (i + 1) % W] + dd);
        }
        d[k] = v;
      }
    }
  }
  for (let i = 0; i < W * H; i++) out[i] = Math.min(255, Math.round(d[i] / 16));
}

// RG8 layers for a DataArrayTexture: [code, coast distance] per cell.
export function prepareDem(bytes, meta) {
  const { w, h, times } = meta, n = w * h, rg = new Uint8Array(n * 2 * times.length), tmp = new Uint8Array(n);
  for (let f = 0; f < times.length; f++) {
    const codes = bytes.subarray(f * n, (f + 1) * n);
    coastDistance(codes, w, h, tmp);
    const o = f * n * 2;
    for (let i = 0; i < n; i++) { rg[o + 2 * i] = codes[i]; rg[o + 2 * i + 1] = tmp[i]; }
  }
  return rg;
}

// The frame pair and blend for age t: frames a and b (a younger), f in 0..1.
export function framesAt(times, t) {
  if (t <= times[0]) return { a: 0, b: 0, f: 0 };
  for (let i = 0; i < times.length - 1; i++) {
    if (t >= times[i] && t <= times[i + 1]) return { a: i, b: i + 1, f: (t - times[i]) / (times[i + 1] - times[i]) };
  }
  const k = times.length - 1; return { a: k, b: k, f: 0 };
}

// Elevation (m) at a paleo point from the raw frames (bilinear in codes'
// decoded metres, blended between the two frames).
export function elevAt(bytes, meta, t, lat, lon) {
  const { w, h, times } = meta, n = w * h, fr = framesAt(times, t);
  const x = ((lon + 180) % 360 + 360) % 360, y = Math.max(0, Math.min(h - 1.001, lat + 90));
  const i0 = Math.floor(x), j0 = Math.floor(y), fx = x - i0, fy = y - j0, i1 = (i0 + 1) % w;
  const at = (f, i, j) => decodeElev(bytes[f * n + j * w + i], meta.zmin, meta.zmax);
  const bil = f => (at(f, i0, j0) * (1 - fx) + at(f, i1, j0) * fx) * (1 - fy) + (at(f, i0, j0 + 1) * (1 - fx) + at(f, i1, j0 + 1) * fx) * fy;
  return bil(fr.a) * (1 - fr.f) + bil(fr.b) * fr.f;
}

export async function loadAll(base, onProgress) {
  const parts = { meta: 0, rot: 0, poly: 0, raster: 0, dem: 0, over: 0, cities: 0, fossils: 0, bounds: 0 };
  const weight = { meta: 0.2, rot: 0.5, poly: 1, raster: 6, dem: 40, over: 3, cities: 3, fossils: 5, bounds: 2 };
  const total = Object.values(weight).reduce((a, b) => a + b, 0);
  const prog = k => v => { parts[k] = v; onProgress && onProgress(Object.keys(parts).reduce((s, q) => s + parts[q] * weight[q], 0) / total); };
  const u = f => new URL('data/' + f, base).href;
  const [meta, rot, poly, raster, dem, over, cities, fossils, bounds] = await Promise.all([
    fetchJSON(u('meta.json'), prog('meta')), fetchJSON(u('rotations.json'), prog('rot')), fetchJSON(u('polygons.json'), prog('poly')),
    fetchBytes(u('plateidx.bin'), prog('raster')), fetchBytes(u('dem.bin'), prog('dem')), fetchJSON(u('overlays.json'), prog('over')),
    fetchJSON(u('cities.json'), prog('cities')), fetchJSON(u('fossils.json'), prog('fossils')), fetchJSON(u('boundaries.json'), prog('bounds')),
  ]);
  const n = meta.dem.w * meta.dem.h * meta.dem.times.length;
  if (dem.length !== n) throw new Error('dem.bin: ' + dem.length + ' bytes, expected ' + n);
  if (raster.length !== meta.raster.w * meta.raster.h) throw new Error('plateidx.bin: wrong size ' + raster.length);
  return { meta, rot, poly, raster, dem, over, cities, fossils, bounds };
}
