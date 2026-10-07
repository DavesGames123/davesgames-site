// ============================================================================
//  ANCIENT EARTH  ·  data.js  ·  load and decode the shipped data (no THREE)
// ----------------------------------------------------------------------------
//  All files sit in ./data and come from build/build_data.py.
//  fetchBytes streams a body into chunks and joins them at the real size:
//  the live host gzips .bin files, so content-length is the compressed
//  size and must never size a buffer. It only drives the progress bar.
//
//  The DEM (data/dem/dem-NN.bin, 10 frames per file) is N frames of
//  360 x 181 uint8 codes, row 0 at 90 S, column 0 at 180 W, 1 deg cells.
//  Codes 0..127 are sea floor and 128..255 land, on a square-root scale
//  (decodeElev). prepareDem and dem-worker.js make the RG8 texture layers: R the code, G the distance from the coast inland
//  (km / 16, so 255 = 4080 km or more) for the aridity estimate.
//
//  grep -n targets
//    streamed fetch ........ "export async function fetchBytes"
//    elevation decode ...... "export function decodeElev"
//    coast distance ........ "function coastDistance"
//    first-frame data ...... "export async function loadCore"
//    later data ............ "export function loadLazy"
//    DEM chunks + worker ... "export class DemStream"
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
export function coastDistance(codes, W, H, out) {
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

// ── progressive loading ─────────────────────────────────────────────────────
// Core: what the first frame needs besides the DEM (about 120 KB).
export async function loadCore(base) {
  const u = f => new URL('data/' + f, base).href;
  const [meta, rot, poly] = await Promise.all([fetchJSON(u('meta.json')), fetchJSON(u('rotations.json')), fetchJSON(u('polygons.json'))]);
  if (!meta.dem.files) throw new Error('meta.json: no DEM chunk list');
  return { meta, rot, poly };
}
// The rest, each as a promise, started after the first frame.
export function loadLazy(base) {
  const u = f => new URL('data/' + f, base).href;
  return {
    raster: fetchBytes(u('plateidx.bin')),
    over: fetchJSON(u('overlays.json')),
    cities: fetchJSON(u('cities.json')),
    fossils: fetchJSON(u('fossils.json')),
    bounds: fetchJSON(u('boundaries.json')),
  };
}

// DEM chunks (data/dem/dem-NN.bin, meta.dem.chunk frames each), fetched
// in order of distance from the first age, one ahead of the decoder. The
// coast distance (the chamfer passes) runs in dem-worker.js, so the main
// thread never runs it; without module workers it runs here.
//   codes   all frames' raw codes (elevAt reads these)
//   rg      the RG8 texture layers [code, coast km / 16]
//   loaded  1 per frame that is in both arrays
//   first   a promise for the chunk of the first age
// onChunk(firstFrame, nFrames) runs on the main thread after each chunk.
export class DemStream {
  constructor(base, meta, firstAge, onChunk) {
    const M = meta.dem, n = M.w * M.h;
    this.M = M; this.n = n; this.onChunk = onChunk;
    this.codes = new Uint8Array(n * M.times.length);
    this.rg = new Uint8Array(n * 2 * M.times.length);
    this.loaded = new Uint8Array(M.times.length);
    const c0 = Math.floor(framesAt(M.times, firstAge).a / M.chunk);
    this.order = M.files.map((f, i) => i).sort((a, b) => Math.abs(a - c0) - Math.abs(b - c0) || b - a);
    this.urls = M.files.map(f => new URL('data/' + f, base).href);
    this.pending = new Map();
    try {
      this.worker = new Worker(new URL('dem-worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = e => { const r = this.pending.get(e.data.id); if (r) { this.pending.delete(e.data.id); r(e.data.rg); } };
      this.worker.onerror = () => { this.worker = null; for (const [id, r] of this.pending) r(null); this.pending.clear(); };
    } catch { this.worker = null; }
    let firstDone;
    this.first = new Promise((res, rej) => { firstDone = res; this.firstFail = rej; });
    this.done = this.run(firstDone).catch(e => { this.firstFail(e); throw e; });
  }
  decodeHere(bytes) {
    const { w, h } = this.M, n = this.n, k = bytes.length / n, rg = new Uint8Array(n * 2 * k), tmp = new Uint8Array(n);
    for (let f = 0; f < k; f++) {
      const codes = bytes.subarray(f * n, (f + 1) * n);
      coastDistance(codes, w, h, tmp);
      for (let i = 0; i < n; i++) { rg[(f * n + i) * 2] = codes[i]; rg[(f * n + i) * 2 + 1] = tmp[i]; }
    }
    return rg;
  }
  async decode(id, bytes) {
    if (this.worker) {
      const rg = await new Promise(res => { this.pending.set(id, res); this.worker.postMessage({ id, w: this.M.w, h: this.M.h, bytes: bytes.slice() }); });
      if (rg) return rg;
    }
    return this.decodeHere(bytes);
  }
  async run(firstDone) {
    const fetches = [];
    const get = k => (fetches[k] = fetches[k] || fetchBytes(this.urls[this.order[k]]));
    for (let k = 0; k < this.order.length; k++) {
      if (this.stopped) return;
      const c = this.order[k], f0 = c * this.M.chunk;
      const bytes = await get(k);
      if (k + 1 < this.order.length) get(k + 1);
      const nf = bytes.length / this.n;
      if (nf !== Math.min(this.M.chunk, this.M.times.length - f0)) throw new Error(this.M.files[c] + ': ' + bytes.length + ' bytes, expected ' + Math.min(this.M.chunk, this.M.times.length - f0) * this.n);
      const rg = await this.decode(c, bytes);
      if (this.stopped) return;
      this.codes.set(bytes, f0 * this.n);
      this.rg.set(rg, f0 * this.n * 2);
      for (let f = f0; f < f0 + nf; f++) this.loaded[f] = 1;
      this.onChunk && this.onChunk(f0, nf);
      if (k === 0) firstDone();
    }
    this.stop();
  }
  stop() { this.stopped = true; if (this.worker) { this.worker.terminate(); this.worker = null; } }
}
