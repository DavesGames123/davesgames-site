// ============================================================================
//  STORM GLOBE  ·  grib.js  ·  NOAA GFS winds: GRIB2 decode, regrid, pack
// ----------------------------------------------------------------------------
//  No DOM. The GFS (public domain) is on AWS open data
//  (noaa-gfs-bdp-pds), which sends CORS headers and accepts Range
//  requests. Each file has a .idx text index, so one field is one small
//  range request (about 80 KB at 1 degree).
//
//  decodeGrib2 reads one message: grid template 3.0 (regular lat-lon) and
//  data templates 5.0 (simple packing) and 5.3 (complex packing with
//  spatial differencing, what GFS uses). Other templates throw.
//
//  fetchGfsFrames(opt) picks the newest cycle that has the last forecast
//  hour, fetches 10 m u, 10 m v and mean sea-level pressure for each frame
//  (analyses of earlier cycles for the past, forecast hours of the newest
//  cycle for the future), and regrids them to a small grid.
//
//  Frame pack (winds.bin): int8 per value, frame by frame, and in each
//  frame u[ny*nx], v[ny*nx], p[ny*nx]. Rows go south to north, columns
//  east from longitude 0. u, v: QUV m/s per step. p: hPa - 1000.
//
//  grep -n targets
//    decoder ........ "export function decodeGrib2"
//    idx ............ "export function parseIdx"
//    regrid ......... "export function regrid"
//    pack ........... "export function packFrames"
//    frame fetch .... "export async function fetchGfsFrames"
// ============================================================================

export const GFS_BASE = 'https://noaa-gfs-bdp-pds.s3.amazonaws.com';
export const QUV = 0.5;            // m/s per int8 step
const H = 3600e3;

// GRIB2 signed integers are sign and magnitude, not two's complement.
function sm16(v) { return v & 0x8000 ? -(v & 0x7fff) : v; }
function smN(v, bytes) { const top = 2 ** (8 * bytes - 1); return v >= top ? -(v - top) : v; }

class Bits {
  constructor(b, o) { this.b = b; this.p = o * 8; }
  read(n) {
    let v = 0;
    for (let i = 0; i < n; i++) { const p = this.p++; v = v * 2 + ((this.b[p >> 3] >> (7 - (p & 7))) & 1); }
    return v;
  }
  align() { this.p = (this.p + 7) & ~7; }
}

export function decodeGrib2(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint32(0) !== 0x47524942) throw new Error('grib: no GRIB marker');
  if (b[7] !== 2) throw new Error('grib: edition ' + b[7]);
  let o = 16, grid = null, s5 = null, s5o = 0, s7o = 0, s7len = 0, bitmap = null, ref = 0, fh = 0, param = null;
  while (o < b.length - 4) {
    if (dv.getUint32(o) === 0x37373737) break;
    const len = dv.getUint32(o), n = b[o + 4];
    if (n === 1) ref = Date.UTC(dv.getUint16(o + 12), b[o + 14] - 1, b[o + 15], b[o + 16], b[o + 17], b[o + 18]);
    if (n === 3) {
      const t = dv.getUint16(o + 12);
      if (t !== 0) throw new Error('grib: grid template ' + t);
      const ni = dv.getUint32(o + 30), nj = dv.getUint32(o + 34);
      const la1 = smN(dv.getUint32(o + 46), 4) / 1e6, lo1 = smN(dv.getUint32(o + 50), 4) / 1e6;
      const la2 = smN(dv.getUint32(o + 55), 4) / 1e6, lo2 = smN(dv.getUint32(o + 59), 4) / 1e6;
      const di = dv.getUint32(o + 63) / 1e6, dj = dv.getUint32(o + 67) / 1e6, scan = b[o + 71];
      grid = { ni, nj, la1, lo1, la2, lo2, di, dj, scan };
    }
    if (n === 4) {
      param = { cat: b[o + 9], num: b[o + 10] };
      fh = dv.getUint32(o + 18);
    }
    if (n === 5) { s5 = { npts: dv.getUint32(o + 5), tmpl: dv.getUint16(o + 9) }; s5o = o; }
    if (n === 6 && b[o + 5] === 0) bitmap = b.subarray(o + 6, o + len);
    if (n === 7) { s7o = o + 5; s7len = len - 5; }
    o += len;
  }
  if (!grid || !s5) throw new Error('grib: missing sections');
  const R = dv.getFloat32(s5o + 11), E = sm16(dv.getUint16(s5o + 15)), D = sm16(dv.getUint16(s5o + 17)), nb = b[s5o + 19];
  const npts = s5.npts, ef = 2 ** E, df = 10 ** -D;
  const vals = new Float32Array(npts);
  if (s5.tmpl === 0) {
    const bits = new Bits(b, s7o);
    for (let i = 0; i < npts; i++) vals[i] = (R + (nb ? bits.read(nb) : 0) * ef) * df;
  } else if (s5.tmpl === 3 || s5.tmpl === 2) {
    const q = s5o;
    const miss = b[q + 22], ng = dv.getUint32(q + 31);
    const wref = b[q + 35], wbits = b[q + 36];
    const lref = dv.getUint32(q + 37), linc = b[q + 41], llast = dv.getUint32(q + 42), lbits = b[q + 46];
    const order = s5.tmpl === 3 ? b[q + 47] : 0, nd = s5.tmpl === 3 ? b[q + 48] : 0;
    const bits = new Bits(b, s7o);
    let iv1 = 0, iv2 = 0, minsd = 0;
    if (order > 0) {
      iv1 = smN(bits.read(8 * nd), nd);
      if (order === 2) iv2 = smN(bits.read(8 * nd), nd);
      minsd = smN(bits.read(8 * nd), nd);
    }
    const gref = new Float64Array(ng), gw = new Uint8Array(ng), gl = new Uint32Array(ng);
    for (let g = 0; g < ng; g++) gref[g] = nb ? bits.read(nb) : 0;
    bits.align();
    for (let g = 0; g < ng; g++) gw[g] = wref + (wbits ? bits.read(wbits) : 0);
    bits.align();
    for (let g = 0; g < ng; g++) gl[g] = lref + (lbits ? bits.read(lbits) : 0) * linc;
    gl[ng - 1] = llast;
    bits.align();
    const n = bitmap ? countBits(bitmap, npts) : npts;
    const X = new Float64Array(n), isMiss = miss ? new Uint8Array(n) : null;
    let k = 0;
    for (let g = 0; g < ng; g++) {
      const w = gw[g], allOnes = w ? 2 ** w - 1 : 0, refOnes = nb ? 2 ** nb - 1 : 0;
      for (let i = 0; i < gl[g] && k < n; i++, k++) {
        const v = w ? bits.read(w) : 0;
        if (miss && ((w && v === allOnes) || (!w && gref[g] === refOnes))) { isMiss[k] = 1; continue; }
        X[k] = gref[g] + v;
      }
    }
    // undo the spatial differencing over the values that are not missing
    if (order > 0) {
      let c = 0, f1 = 0, f2 = 0;
      for (let i = 0; i < n; i++) {
        if (isMiss && isMiss[i]) continue;
        let f;
        if (c === 0) f = iv1;
        else if (c === 1 && order === 2) f = iv2;
        else f = order === 1 ? X[i] + minsd + f1 : X[i] + minsd + 2 * f1 - f2;
        f2 = f1; f1 = f; X[i] = f; c++;
      }
    }
    let j = 0;
    for (let i = 0; i < npts; i++) {
      if (bitmap && !((bitmap[i >> 3] >> (7 - (i & 7))) & 1)) { vals[i] = NaN; continue; }
      vals[i] = isMiss && isMiss[j] ? NaN : (R + X[j] * ef) * df;
      j++;
    }
  } else throw new Error('grib: data template 5.' + s5.tmpl);
  return { grid, values: vals, ref, fh, param };
}
function countBits(bm, n) { let c = 0; for (let i = 0; i < n; i++) c += (bm[i >> 3] >> (7 - (i & 7))) & 1; return c; }

// GFS .idx lines "585:34787334:d=2026100612:UGRD:10 m above ground:anl:"
// -> [{ n, off, end, var, level, fcst }] (end = next offset - 1, or null)
export function parseIdx(text) {
  const rows = text.trim().split(/\r?\n/).map(l => l.split(':'));
  return rows.map((r, i) => ({ n: +r[0], off: +r[1], end: i + 1 < rows.length ? +rows[i + 1][1] - 1 : null, var: r[3], level: r[4], fcst: r[5] }));
}
export function findIdx(idx, v, level) { return idx.find(r => r.var === v && r.level === level) || null; }

// Value at (lat, lon) of a decoded GRIB grid, bilinear. Handles scan mode
// 0 (north to south) and 64 (south to north), and wraps longitude.
export function sampleGrid(g, vals, lat, lon) {
  const G = g.grid;
  const sn = (G.scan & 64) !== 0;
  let fy = sn ? (lat - G.la1) / G.dj : (G.la1 - lat) / G.dj;
  fy = Math.max(0, Math.min(G.nj - 1, fy));
  let fx = ((lon - G.lo1) % 360 + 360) % 360 / G.di;
  const j0 = Math.min(G.nj - 2, Math.floor(fy)), ty = fy - j0;
  const i0 = Math.floor(fx) % G.ni, tx = fx - Math.floor(fx), i1 = (i0 + 1) % G.ni;
  const a = vals[j0 * G.ni + i0], b = vals[j0 * G.ni + i1], c = vals[(j0 + 1) * G.ni + i0], d = vals[(j0 + 1) * G.ni + i1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

// Box-average a decoded GRIB field to the frame grid { nx, ny } (rows
// south to north at lat -90 + j*180/(ny-1), columns at lon i*360/nx).
export function regrid(g, grid) {
  const { nx, ny } = grid, out = new Float32Array(nx * ny);
  const dl = 360 / nx, dp = 180 / (ny - 1), G = g.grid;
  const k = Math.max(1, Math.round(dl / G.di));
  for (let j = 0; j < ny; j++) {
    const lat = -90 + j * dp;
    for (let i = 0; i < nx; i++) {
      const lon = i * dl;
      let s = 0, n = 0;
      for (let a = 0; a < k; a++) for (let c = 0; c < k; c++) {
        const la = Math.max(-90, Math.min(90, lat + (a + 0.5 - k / 2) * G.dj)), lo = lon + (c + 0.5 - k / 2) * G.di;
        const v = sampleGrid(g, g.values, la, lo);
        if (isFinite(v)) { s += v; n++; }
      }
      out[j * nx + i] = n ? s / n : 0;
    }
  }
  return out;
}

// frames: [{ u, v, p }] Float32Array (p in Pa) -> Int8Array
export function packFrames(frames, grid) {
  const n = grid.nx * grid.ny, out = new Int8Array(frames.length * 3 * n);
  const q = (x, lo, hi) => Math.max(lo, Math.min(hi, Math.round(x)));
  frames.forEach((f, k) => {
    const o = k * 3 * n;
    for (let i = 0; i < n; i++) {
      out[o + i] = q(f.u[i] / QUV, -127, 127);
      out[o + n + i] = q(f.v[i] / QUV, -127, 127);
      out[o + 2 * n + i] = q(f.p[i] / 100 - 1000, -128, 127);
    }
  });
  return out;
}
// Int8Array -> [{ u, v, p }] Float32Array (m/s, m/s, hPa)
export function unpackFrames(bytes, grid, count) {
  const n = grid.nx * grid.ny, a = bytes instanceof Int8Array ? bytes : new Int8Array(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength ?? bytes.length);
  const out = [];
  for (let k = 0; k < count; k++) {
    const o = k * 3 * n, u = new Float32Array(n), v = new Float32Array(n), p = new Float32Array(n);
    for (let i = 0; i < n; i++) { u[i] = a[o + i] * QUV; v[i] = a[o + n + i] * QUV; p[i] = a[o + 2 * n + i] + 1000; }
    out.push({ u, v, p });
  }
  return out;
}

// ── GFS frame fetch ──────────────────────────────────────────────────────
function cycleUrl(c, fh) {
  const d = new Date(c), ymd = d.toISOString().slice(0, 10).replace(/-/g, ''), hh = String(d.getUTCHours()).padStart(2, '0');
  return `${GFS_BASE}/gfs.${ymd}/${hh}/atmos/gfs.t${hh}z.pgrb2.1p00.f${String(fh).padStart(3, '0')}`;
}
export const GFS_FIELDS = [['UGRD', '10 m above ground', 'u'], ['VGRD', '10 m above ground', 'v'], ['PRMSL', 'mean sea level', 'p']];

// opt: { fetch, now, past: hours, ahead: hours, step: hours, grid, onProgress,
// concurrency }. Returns { cycle, times: [ms], kinds: ['anl'|'fcst'], frames }.
// A past frame comes from the analysis (f000) of that cycle. When an older
// analysis is missing, the frame falls back to a forecast hour of a
// later cycle; a frame that still fails is dropped.
export async function fetchGfsFrames(opt) {
  const f = opt.fetch || fetch, step = opt.step || 6, past = opt.past ?? 48, ahead = opt.ahead ?? 120;
  const now = opt.now || Date.now();
  let c = Math.floor(now / (6 * H)) * 6 * H, cycle = null;
  for (let k = 0; k < 6 && !cycle; k++, c -= 6 * H) {
    // a bucket listing (always 200, CORS) says whether the last file exists,
    // so a cycle still in production makes no 404 in the console
    try {
      const key = cycleUrl(c, ahead).slice(GFS_BASE.length + 1) + '.idx';
      const r = await f(`${GFS_BASE}/?list-type=2&max-keys=1&prefix=${encodeURIComponent(key)}`);
      if (r.ok && /<KeyCount>1<\/KeyCount>/.test(await r.text())) cycle = c;
    } catch (e) { /* next */ }
  }
  if (!cycle) throw new Error('gfs: no recent cycle with f' + ahead);
  const jobs = [];
  for (let h = -past; h <= ahead; h += step) {
    if (h < 0) jobs.push({ t: cycle + h * H, tries: [[cycle + h * H, 0], [cycle + (h - 6) * H, 6]], kind: 'anl' });
    else jobs.push({ t: cycle + h * H, tries: [[cycle, h]], kind: h === 0 ? 'anl' : 'fcst' });
  }
  const grabOne = async (cy, fh) => {
    const url = cycleUrl(cy, fh);
    const ir = await f(url + '.idx'); if (!ir.ok) throw new Error('idx ' + ir.status);
    const idx = parseIdx(await ir.text()), out = {};
    for (const [v, lev, key] of GFS_FIELDS) {
      const r = findIdx(idx, v, lev); if (!r) throw new Error('no ' + v);
      const rr = await f(url, { headers: { Range: `bytes=${r.off}-${r.end ?? ''}` } });
      if (!rr.ok) throw new Error(v + ' ' + rr.status);
      out[key] = regrid(decodeGrib2(new Uint8Array(await rr.arrayBuffer())), opt.grid);
    }
    return out;
  };
  let done = 0;
  const results = new Array(jobs.length);
  const work = async j => {
    const job = jobs[j];
    for (const [cy, fh] of job.tries) {
      try { results[j] = { ...job, frame: await grabOne(cy, fh), from: [cy, fh] }; break; } catch (e) { results[j] = null; }
    }
    done++; opt.onProgress && opt.onProgress(done / jobs.length);
  };
  const conc = opt.concurrency || 4;
  let next = 0;
  await Promise.all(Array.from({ length: conc }, async () => { while (next < jobs.length) await work(next++); }));
  const ok = results.filter(Boolean);
  if (ok.length < 2) throw new Error('gfs: fewer than two frames');
  return { cycle, times: ok.map(r => r.t), kinds: ok.map(r => r.kind), frames: ok.map(r => r.frame), from: ok.map(r => r.from) };
}
