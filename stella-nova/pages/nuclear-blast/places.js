// ============================================================================
//  NUCLEAR BLAST  ·  places.js — real places for the map and the scene
// ----------------------------------------------------------------------------
//  Loads, by relative URL, data that other pages of the site already ship
//  (nothing is copied into this folder):
//    ../ancient-earth/data/cities.json    Natural Earth populated places
//                                         (public domain): name, country,
//                                         lat, lon, pop, rank
//    ../ancient-earth/data/overlays.json  Natural Earth 50m coastlines and
//                                         land borders (public domain),
//                                         runs of [plate, lon*100, lat*100 ...]
//    ../city-atlas/data/index.json        the 21 City Atlas cities
//    ../city-atlas/data/<id>.bin          one city: building footprints and
//                                         heights, water and land cover
//                                         rasters. Overture Maps / OSM, ODbL
//                                         1.0; ESA WorldCover, CC BY 4.0.
//                                         Decoded by ../city-atlas/data.js.
//
//  The population field orders the search results only; the page never
//  shows it. Two places are left out of the search and the labels (OMIT,
//  by coordinates).
//
//  A City Atlas city gives the map two raster images (water and land cover
//  over 64 km, the inner 12 km sharper) and a footprint image of its
//  buildings, and gives the 3D scene oriented boxes for the buildings and
//  the rasters as textures. Frames: city metres x east, y north, origin at
//  the city centre (meta.lat, meta.lon).
//
//  GREP MAP
//    function loadPlaces ....... the gazetteer, coastlines, the atlas index
//    function search ........... ranked name search
//    function atlasNear ........ the City Atlas city around a point
//    function loadAtlasCity .... decode one city, make its images and boxes
//    function mendSeams ........ remove one-pixel water lines at tile edges
//    const LC_COLORS ........... map colours of the WorldCover classes
// ============================================================================
import { loadCity, buildingsOf } from '../city-atlas/data.js';
import { distance } from './geo.js';

const BASE = new URL('../', import.meta.url);
const url = p => new URL(p, BASE).href;
const OMIT = [[34.39, 132.46], [32.77, 129.87]];
const omitted = (lat, lon) => OMIT.some(([a, b]) => Math.abs(lat - a) < 0.25 && Math.abs(lon - b) < 0.25);

let placesP = null;
export function loadPlaces() {
  if (!placesP) placesP = (async () => {
    const [cj, oj, aj] = await Promise.all([
      fetch(url('ancient-earth/data/cities.json')).then(r => r.json()),
      fetch(url('ancient-earth/data/overlays.json')).then(r => r.json()),
      fetch(url('city-atlas/data/index.json')).then(r => r.json()).catch(() => []),
    ]);
    const cities = cj.rows.filter(r => !omitted(r[2], r[3])).map(r => ({ name: r[0], country: r[1], lat: r[2], lon: r[3], pop: Math.max(0, r[4]), key: (r[0] + ' ' + r[1]).toLowerCase() }));
    cities.sort((a, b) => b.pop - a.pop);
    const runs = k => oj[k].map(a => {
      const n = (a.length - 1) >> 1, p = new Float32Array(n * 2);
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (let i = 0; i < n; i++) { const lon = a[1 + 2 * i] / 100, lat = a[2 + 2 * i] / 100; p[2 * i] = lon; p[2 * i + 1] = lat; x0 = Math.min(x0, lon); x1 = Math.max(x1, lon); y0 = Math.min(y0, lat); y1 = Math.max(y1, lat); }
      return { p, x0, x1, y0, y1 };
    });
    const atlas = (Array.isArray(aj) ? aj : []).map(e => ({ ...e, key: (e.title + ' ' + e.country).toLowerCase(), atlas: true }));
    return { cities, coast: runs('coast'), borders: runs('borders'), atlas };
  })();
  return placesP;
}

// Ranked search: whole-word and prefix matches first, then substrings; the
// City Atlas cities first among equals (they have buildings in 3D).
export function search(P, q, n = 8) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const score = e => { const name = (e.title || e.name).toLowerCase(); return name === q ? 0 : name.startsWith(q) ? 1 : e.key.includes(' ' + q) ? 2 : e.key.includes(q) ? 3 : 9; };
  const out = [];
  for (const e of P.atlas) { const s = score(e); if (s < 9) out.push({ s: s - 0.5, e }); }
  for (const e of P.cities) { if (out.length > 400) break; const s = score(e); if (s < 9 && !P.atlas.some(a => distance(a.lon, a.lat, e.lon, e.lat) < 15000)) out.push({ s, e }); }
  out.sort((a, b) => a.s - b.s || (b.e.pop || 1e12) - (a.e.pop || 1e12));
  return out.slice(0, n).map(o => ({ name: o.e.title || o.e.name, country: o.e.country, lat: o.e.lat, lon: o.e.lon, atlas: o.e.atlas ? o.e.id : null }));
}

// The City Atlas city whose rasters cover (lon, lat): within 30 km.
export function atlasNear(P, lon, lat) {
  let best = null, bd = 3e4;
  for (const e of P.atlas) { const d = distance(e.lon, e.lat, lon, lat); if (d < bd) { bd = d; best = e; } }
  return best;
}

// WorldCover classes -> muted map colours (RGB 0..255)
export const LC_COLORS = { 10: [38, 58, 40], 20: [64, 70, 48], 30: [58, 66, 46], 40: [72, 70, 52], 50: [92, 92, 96], 60: [96, 88, 72], 70: [200, 206, 214], 80: [22, 40, 62], 90: [40, 60, 58], 95: [36, 60, 46], 100: [70, 76, 64] };

const cityCache = new Map();
export function loadAtlasCity(id) {
  if (!cityCache.has(id)) cityCache.set(id, (async () => {
    const c = await loadCity(url(`city-atlas/data/${id}.bin`));
    const A = c.arrays, M = c.meta;
    for (const [k, n] of [['lc_out', 512], ['wf_out', 1024], ['lc_in', 1024], ['wf_in', 1024]]) if (A[k] && A[k].length === n * n) mendSeams(A[k], n, k.startsWith('lc') ? v => v === 80 : v => v > 0);
    // map image: land cover under water, over 64 km (outer) and 12 km (inner)
    const img = (lc, wf, n, nw) => {
      const cv = document.createElement('canvas'); cv.width = cv.height = nw;
      const g = cv.getContext('2d'), id2 = g.createImageData(nw, nw), d = id2.data, k = n / nw;
      for (let r = 0; r < nw; r++) for (let q = 0; q < nw; q++) {
        const cl = lc[Math.floor(r * k) * n + Math.floor(q * k)], w = wf[r * nw + q] / 255, C = LC_COLORS[cl] || LC_COLORS[30], W = LC_COLORS[80], o = (r * nw + q) * 4;
        d[o] = C[0] + (W[0] - C[0]) * w; d[o + 1] = C[1] + (W[1] - C[1]) * w; d[o + 2] = C[2] + (W[2] - C[2]) * w; d[o + 3] = 255;
      }
      g.putImageData(id2, 0, 0);
      return cv;
    };
    const outer = { canvas: img(A.lc_out, A.wf_out, 512, 1024), half: M.grid.outer.half };
    const inner = { canvas: img(A.lc_in, A.wf_in, 1024, 1024), half: M.grid.inner.half };
    // buildings: footprint image and oriented boxes
    const B = buildingsOf(c), half = (M.fHalf || M.bHalf || 2600) + 100, NPX = 2048, k = NPX / (2 * half);
    const fp = document.createElement('canvas'); fp.width = fp.height = NPX;
    const g = fp.getContext('2d'); g.fillStyle = '#d8d2c4';
    const boxes = [];
    let v = 0, rl = 0;
    for (let i = 0; i < B.n; i++) {
      const nr = B.rings[i];
      let first = null;
      g.beginPath();
      for (let r = 0; r < nr; r++) {
        const len = B.ringLen[rl++];
        for (let j = 0; j < len; j++) {
          const x = B.xy[2 * (v + j)] * 0.5, y = B.xy[2 * (v + j) + 1] * 0.5, px = (x + half) * k, py = (half - y) * k;
          j ? g.lineTo(px, py) : g.moveTo(px, py);
        }
        if (r === 0) first = [v, len];
        v += len;
      }
      g.fill('evenodd');
      if (first) boxes.push(obb(B.xy, first[0], first[1], B.h[i] / 10));
    }
    return { id, meta: M, outer, inner, foot: { canvas: fp, half }, boxes, wf: A.wf_out, lc: A.lc_out };
  })());
  return cityCache.get(id);
}
// The WorldCover tiles meet on whole degrees, and some City Atlas rasters
// hold a straight line of water there, one to three pixels wide (London at
// 0 deg E). Such a line (each pixel line more than 85% water, the lines on
// both sides less than 40% water) takes the values of the line before it.
// A real river is not straight and full length for 64 km.
export function mendSeams(a, n, wet) {
  const frac = (i, col) => { let k = 0; for (let j = 0; j < n; j++) k += wet(col ? a[j * n + i] : a[i * n + j]) ? 1 : 0; return k / n; };
  const copy = (i, from, col) => { for (let j = 0; j < n; j++) { if (col) a[j * n + i] = a[j * n + from]; else a[i * n + j] = a[from * n + j]; } };
  let mended = 0;
  for (const col of [true, false]) for (let i = 1; i < n - 4; i++) {
    if (frac(i - 1, col) > 0.4) continue;
    let w = 0;
    while (w < 4 && frac(i + w, col) >= 0.85) w++;
    if (w < 1 || w > 3 || frac(i + w, col) > 0.4) continue;
    for (let k = 0; k < w; k++) copy(i + k, i - 1, col);
    mended++;
  }
  return mended;
}
// an oriented box for one footprint ring: the axis of its longest edge
function obb(xy, v0, n, h) {
  let best = 0, ax = 1, ay = 0;
  for (let j = 0; j < n; j++) {
    const a = v0 + j, b = v0 + (j + 1) % n, dx = (xy[2 * b] - xy[2 * a]) * 0.5, dy = (xy[2 * b + 1] - xy[2 * a + 1]) * 0.5, l = dx * dx + dy * dy;
    if (l > best) { best = l; ax = dx; ay = dy; }
  }
  const L = Math.sqrt(best) || 1; ax /= L; ay /= L;
  let u0 = 1e9, u1 = -1e9, w0 = 1e9, w1 = -1e9;
  for (let j = 0; j < n; j++) {
    const x = xy[2 * (v0 + j)] * 0.5, y = xy[2 * (v0 + j) + 1] * 0.5, u = x * ax + y * ay, w = -x * ay + y * ax;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); w0 = Math.min(w0, w); w1 = Math.max(w1, w);
  }
  const uc = (u0 + u1) / 2, wc = (w0 + w1) / 2;
  // centre (east, north), size along the axis and across, height, axis angle from east
  return { x: uc * ax - wc * ay, y: uc * ay + wc * ax, w: Math.max(2, u1 - u0), d: Math.max(2, w1 - w0), h: Math.max(3, h), ang: Math.atan2(ay, ax) };
}
