// terrain.js — DLA terrain under the city: our glue between lib/dla-terrain.js
// and the vendored MapGenerator (LGPL-3.0, vendor/mapgenerator, unchanged).
//
// lib/dla-terrain.js grows a world from a seed (DLA ridges, branched-flow
// channels, erosion, rivers, biomes). This file puts the city on it:
//   1. libOptions(o): the city's terrain options (preset, seed, relief,
//      sea, river strength, erosion, world size, remix) -> LIB options.
//   2. buildTerrain(o, W, H): runs the LIB, keeps 7 stage snapshots, picks
//      a site for the city (coast, river, flat ground), and makes what the
//      upstream generators take, in map units, y down:
//        water  the sea and lakes, contour rings of the terrain sea level
//        block  water plus ground steeper than the street grade: upstream
//               reads it as its tensorField.sea, so no road or lot goes there
//        coast  the shore runs inside the view (coast roads)
//        river  the largest LIB river through the view: centreline, water
//               polygon and bank ring (jsts buffers, upstream PolygonUtil)
//      and the ground: a graded grid under the city (river bed carved,
//      a 0.8 m step at the shore) and a coarse grid of the whole world.
//   3. SlopeField: an upstream BasisField subclass that turns the streets
//      along the contour lines on steep ground (gen.js adds it last).
//   4. groundAt, slopeAt, underlay (2D hillshade raster), contours.
// No DOM. gen.js, mesh3d.js, terrain3d.js, draw2d.js and tests.mjs use it.
//
// FRAMES. Map: x right, y down, the view is [0, W] x [0, H]. Terrain (LIB):
// x, z in metres, origin -worldSize / 2. The view centre (W/2, H/2) sits on
// the site (sx, sz):  x = sx + mx - W/2,  z = sz + my - H/2.  Heights are
// metres above the sea (LIB seaLevel 0, or -100 for a world with no sea).
//
// GRIDS. The outer grid has G + 1 vertices a side, cell c = worldSize / G.
// The patch is the block of outer cells under the generator domain plus one
// cell all round, cut k times per cell (step s = c / k, about 6 m). Patch
// vertex (a, b) is map (x0 + a s, y0 + b s). Within one cell of the patch
// edge its heights blend to the outer cell, so the two meshes meet with no
// crack (terrain3d.js).
//
// grep: export const CITY_PRESETS  export function terrainDefaults  export function rollTerrain
//       export function libOptions  export async function buildTerrain  function pickSite
//       function mainRiver  function contourRings  function keyhole  export function makeSlopeField
//       export function groundAt  export function slopeAt  export function underlay
//       export function snapshotRaster  export function contourSegments  function carveRiver
//       function riverGeometry  function riverBanks  function nearLine

import * as LIB from '../../lib/dla-terrain.js';
import * as MG from '../../vendor/mapgenerator/mapgen.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ─── options ────────────────────────────────────────────────────────────────
// LIB presets that suit a city, with city-scale relief (m), sea fraction and
// world size (km). The LIB presets are for vast views; a city of 1 to 2 km
// needs less relief, or every street is too steep.
export const CITY_PRESETS = [
  ['river-delta', 'River delta', { tRelief: 220, tSea: 0.3, tWorld: 10 }],
  ['highlands', 'Highlands', { tRelief: 460, tSea: 0.12, tWorld: 8 }],
  ['archipelago', 'Archipelago', { tRelief: 260, tSea: 0.55, tWorld: 7, tSite: 'coast' }],
  ['fjords', 'Fjords', { tRelief: 620, tSea: 0.3, tWorld: 8, tSite: 'coast' }],
  ['canyonlands', 'Canyonlands', { tRelief: 360, tSea: 0, tWorld: 8 }],
  ['rift-valley', 'Rift valley', { tRelief: 700, tSea: 0.05, tWorld: 12 }],
  ['tropical-island', 'Tropical island', { tRelief: 480, tSea: 0.5, tWorld: 6, tSite: 'coast' }],
  ['tundra-coast', 'Tundra coast', { tRelief: 200, tSea: 0.4, tWorld: 9, tSite: 'coast' }],
  ['volcanic-isles', 'Volcanic isles', { tRelief: 640, tSea: 0.6, tWorld: 8, tSite: 'coast' }],
  ['great-range', 'Great range', { tRelief: 900, tSea: 0.3, tWorld: 16 }],
  ['mesa-desert', 'Mesa desert', { tRelief: 300, tSea: 0, tWorld: 8 }],
  ['alpine', 'Alpine', { tRelief: 1000, tSea: 0, tWorld: 9 }],
];
export const SITES = [['auto', 'Best'], ['coast', 'Coast'], ['river', 'River'], ['hills', 'Hills'], ['centre', 'Centre']];
export const TERRAIN_N = 512;

export function terrainDefaults() {
  return {
    terrain: false,       // off: the city as before (upstream coast and river)
    tPreset: 'river-delta',
    tSeed: 1,
    tRelief: 220,         // LIB heightScale (m)
    tSea: 0.3,            // LIB seaFraction
    tRiver: 0.5,          // river width, depth, carving
    tErosion: 0.5,        // stream power and passes
    tWorld: 10,           // LIB worldSize (km)
    tRemix: 0.3,          // share of the LIB dice in the ridge, shape and flow groups
    tSite: 'auto',
    tGrade: 0.22,         // the steepest street (rise over run)
    tContour: 0.7,        // how strongly streets follow the contours on slopes
  };
}
export const TERRAIN_NUM = ['tSeed', 'tRelief', 'tSea', 'tRiver', 'tErosion', 'tWorld', 'tRemix', 'tGrade', 'tContour'];
export const TERRAIN_STR = ['tPreset', 'tSite'];

export function presetValues(id) {
  const p = CITY_PRESETS.find((q) => q[0] === id) || CITY_PRESETS[0];
  return { tSite: 'auto', ...p[2] };
}

// The terrain dice. r is a 0..1 random source (seeded by the caller).
export function rollTerrain(r) {
  const p = CITY_PRESETS[Math.floor(r() * CITY_PRESETS.length) % CITY_PRESETS.length];
  const v = p[2];
  const sea = v.tSea > 0 ? clamp(v.tSea + (r() - 0.5) * 0.2, 0.04, 0.72) : (r() < 0.2 ? 0.15 : 0);
  const site = r();
  return {
    tPreset: p[0],
    tSeed: 1 + Math.floor(r() * 999998),
    tRelief: Math.round(v.tRelief * (0.6 + 0.9 * r()) / 10) * 10,
    tSea: +sea.toFixed(2),
    tWorld: +clamp(v.tWorld * (0.7 + 0.6 * r()), 4, 24).toFixed(1),
    tRiver: +(0.2 + 0.7 * r()).toFixed(2),
    tErosion: +(0.2 + 0.65 * r()).toFixed(2),
    tRemix: +(0.7 * r()).toFixed(2),
    tSite: site < 0.5 ? (v.tSite || 'auto') : SITES[1 + Math.floor((site - 0.5) * 2 * 4) % 4][0],
    tGrade: +(0.16 + 0.12 * r()).toFixed(2),
    tContour: +(0.4 + 0.6 * r()).toFixed(2),
  };
}

// City options -> LIB options. Deterministic: the remix uses the LIB dice
// with the terrain seed, so the URL keys give the whole world.
const REMIX_GROUPS = ['DLA ridges', 'Shape', 'Branched flow'];
export function libOptions(o) {
  const base = (LIB.PRESETS[o.tPreset] || LIB.PRESETS['river-delta']).opts;
  const lib = { ...LIB.defaults(), ...base };
  const mix = clamp(+o.tRemix || 0, 0, 1);
  if (mix > 0) {
    REMIX_GROUPS.forEach((g, gi) => {
      const rolled = LIB.randomOptions((o.tSeed >>> 0) + 7919 * (gi + 1), lib, g);
      for (const d of LIB.OPTIONS) {
        if (d.group !== g) continue;
        if (d.type === 'range') lib[d.key] = lerp(lib[d.key], rolled[d.key], mix);
        else if (mix > 0.7 && d.key !== 'mask' && d.key !== 'bfOn') lib[d.key] = rolled[d.key];
      }
    });
  }
  const river = clamp(+o.tRiver || 0, 0, 1), ero = clamp(+o.tErosion || 0, 0, 1);
  Object.assign(lib, {
    seed: (o.tSeed >>> 0) || 1,
    n: TERRAIN_N,
    worldSize: clamp(+o.tWorld || 10, 4, 24) * 1000,
    heightScale: clamp(+o.tRelief || 200, 40, 2500),
    seaFraction: clamp(+o.tSea || 0, 0, 0.8),
    riverWidth: 0.6 + 2 * river, riverDepth: 0.3 + 0.6 * river, bfCarve: 0.2 + 0.7 * river, riverDensity: 0.35 + 0.4 * river,
    erosionStrength: 0.15 + 0.75 * ero, erosionIters: Math.round(4 + 18 * ero), deposition: 0.3 + 0.5 * ero,
    droplets: 0,
  });
  return LIB.normalizeOptions(lib);
}

// ─── small geometry ─────────────────────────────────────────────────────────
function ringArea(p) {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]);
  return a / 2;
}
function insideRing(x, y, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
// Douglas-Peucker on an open polyline (the ends stay).
function simplifyDP(pts, tol) {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const st = [[0, n - 1]], t2 = tol * tol;
  while (st.length) {
    const [a, b] = st.pop();
    const ax = pts[a][0], ay = pts[a][1], dx = pts[b][0] - ax, dy = pts[b][1] - ay, L2 = dx * dx + dy * dy || 1e-12;
    let best = -1, bd = t2;
    for (let i = a + 1; i < b; i++) {
      const t = clamp(((pts[i][0] - ax) * dx + (pts[i][1] - ay) * dy) / L2, 0, 1);
      const ex = pts[i][0] - ax - t * dx, ey = pts[i][1] - ay - t * dy, d = ex * ex + ey * ey;
      if (d > bd) { bd = d; best = i; }
    }
    if (best > 0) { keep[best] = 1; st.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function simplifyRing(r, tol) {
  if (r.length < 6) return r;
  let far = 0, fd = -1;
  for (let i = 1; i < r.length; i++) { const d = (r[i][0] - r[0][0]) ** 2 + (r[i][1] - r[0][1]) ** 2; if (d > fd) { fd = d; far = i; } }
  const a = simplifyDP(r.slice(0, far + 1), tol), b = simplifyDP(r.slice(far).concat([r[0]]), tol);
  return a.concat(b.slice(1, -1));
}
function resampleLine(l, step) {
  const out = [l[0]];
  let left = step;
  for (let i = 1; i < l.length; i++) {
    let [ax, ay] = l[i - 1];
    const [bx, by] = l[i];
    let seg = Math.hypot(bx - ax, by - ay);
    while (seg >= left) {
      const t = left / seg;
      ax += (bx - ax) * t; ay += (by - ay) * t;
      out.push([ax, ay]);
      seg -= left; left = step;
    }
    left -= seg;
  }
  const e = l[l.length - 1], q = out[out.length - 1];
  if (Math.hypot(e[0] - q[0], e[1] - q[1]) > step * 0.3) out.push([e[0], e[1]]);
  return out;
}
const lineLen = (l) => { let s = 0; for (let i = 1; i < l.length; i++) s += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]); return s; };
const R2 = (p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100];

// Bilinear on a LIB array (texel centres, header WORLD FRAME).
function libSample(arr, n, ws, x, z) {
  const tx = ws / n, o = -ws / 2;
  const px = clamp((x - o) / tx - 0.5, 0, n - 1), pz = clamp((z - o) / tx - 0.5, 0, n - 1);
  const i = Math.min(Math.floor(px), n - 2), j = Math.min(Math.floor(pz), n - 2), fx = px - i, fz = pz - j;
  const a = arr[j * n + i], b = arr[j * n + i + 1], c = arr[(j + 1) * n + i], d = arr[(j + 1) * n + i + 1];
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
}
function libNearest(arr, n, ws, x, z) {
  const tx = ws / n, o = -ws / 2;
  const i = clamp(Math.floor((x - o) / tx), 0, n - 1), j = clamp(Math.floor((z - o) / tx), 0, n - 1);
  return arr[j * n + i];
}
function blur3(a, nx, ny, passes) {
  let src = Float32Array.from(a), dst = new Float32Array(a.length);
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      let s = 0, w = 0;
      for (let dj = -1; dj <= 1; dj++) { const jj = j + dj; if (jj < 0 || jj >= ny) continue; for (let di = -1; di <= 1; di++) { const ii = i + di; if (ii < 0 || ii >= nx) continue; s += src[jj * nx + ii]; w++; } }
      dst[j * nx + i] = s / w;
    }
    [src, dst] = [dst, src];
  }
  return src;
}

// ─── contours ───────────────────────────────────────────────────────────────
// The closed rings of the region f > 0 on a grid (row length nx), vertex
// (a, b) at (x0 + a s, y0 + b s), over the vertices a0..a1, b0..b1. Past that
// box f counts as -1, so every ring closes just outside it. Marching squares;
// a saddle cell takes the centre average. Each ring keeps the region on the
// same side, and two rings never cross, so the rings joined by keyhole() are
// one even-odd polygon.
function contourRings(f, nx, x0, y0, s, a0, a1, b0, b1) {
  const NX = a1 - a0 + 3, NY = b1 - b0 + 3;
  const F = (i, j) => {
    if (i <= 0 || j <= 0 || i >= NX - 1 || j >= NY - 1) return -1;
    const v = f[(b0 + j - 1) * nx + a0 + i - 1];
    return v === 0 ? -1e-6 : v;
  };
  const X = (i) => x0 + (a0 + i - 1) * s, Y = (j) => y0 + (b0 + j - 1) * s;
  const pt = new Map();
  const hId = (i, j) => (j * NX + i) * 2, vId = (i, j) => (j * NX + i) * 2 + 1;
  const point = (id) => {
    let p = pt.get(id);
    if (p) return p;
    const k = id >> 1, i = k % NX, j = (k - i) / NX;
    if (id & 1) { const a = F(i, j), b = F(i, j + 1), t = a / (a - b); p = [X(i), Y(j) + t * s]; }
    else { const a = F(i, j), b = F(i + 1, j), t = a / (a - b); p = [X(i) + t * s, Y(j)]; }
    pt.set(id, p);
    return p;
  };
  const next = new Map();
  const ADJ = [[3, 0], [0, 1], [1, 2], [2, 3]];   // the two edges at corner v0..v3
  for (let j = 0; j < NY - 1; j++) {
    for (let i = 0; i < NX - 1; i++) {
      const fv = [F(i, j), F(i + 1, j), F(i + 1, j + 1), F(i, j + 1)];
      const inn = fv.map((v) => v > 0);
      const cs = inn[0] | (inn[1] << 1) | (inn[2] << 2) | (inn[3] << 3);
      if (cs === 0 || cs === 15) continue;
      const E = [hId(i, j), vId(i + 1, j), hId(i, j + 1), vId(i, j)];
      const C = [[X(i), Y(j)], [X(i + 1), Y(j)], [X(i + 1), Y(j + 1)], [X(i), Y(j + 1)]];
      const segs = [];   // [edgeA, edgeB, ref corner]
      if (cs === 5 || cs === 10) {
        const centre = (fv[0] + fv[1] + fv[2] + fv[3]) / 4 > 0;
        // isolate the corners that differ from the centre
        for (let c = 0; c < 4; c++) if (inn[c] !== centre) segs.push([ADJ[c][0], ADJ[c][1], c]);
      } else {
        const cross = [];
        for (let e = 0; e < 4; e++) if (inn[e] !== inn[(e + 1) % 4]) cross.push(e);
        const [ea, eb] = cross;
        let ref = 0;
        if ((eb - ea) % 2 === 1) ref = (ea === 0 && eb === 3) ? 0 : eb;   // the shared corner
        segs.push([ea, eb, ref]);
      }
      for (const [ea, eb, ref] of segs) {
        let A = E[ea], Bq = E[eb];
        const pa = point(A), pb = point(Bq), R = C[ref];
        const cr = (pb[0] - pa[0]) * (R[1] - pa[1]) - (pb[1] - pa[1]) * (R[0] - pa[0]);
        const want = inn[ref] ? cr : -cr;
        if (want < 0) [A, Bq] = [Bq, A];
        next.set(A, Bq);
      }
    }
  }
  const rings = [];
  const used = new Set();
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const ring = [];
    let e = start, guard = 0;
    while (!used.has(e) && guard++ < 1e7) {
      used.add(e);
      ring.push(point(e));
      e = next.get(e);
      if (e === undefined) break;
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

// Rings -> one polygon for an even-odd test: each ring, closed, then back
// along the bridges between the ring starts, so each bridge runs twice and
// cancels (upstream PolygonUtil.insidePolygon is an even-odd ray test).
function keyhole(rings) {
  const out = [];
  for (const r of rings) { for (const p of r) out.push(p); out.push(r[0]); }
  for (let k = rings.length - 2; k >= 0; k--) out.push(rings[k][0]);
  return out;
}
function cleanRings(rings, tol, minArea) {
  return rings.map((r) => simplifyRing(r, tol)).filter((r) => r.length >= 3 && Math.abs(ringArea(r)) >= minArea).map((r) => r.map(R2));
}

// ─── site ───────────────────────────────────────────────────────────────────
// The view centre on the world: coast, the big river, flat ground, by mode.
function pickSite(t, W, H, o, grade) {
  const ws = t.worldSize, org = -ws / 2, sea = t.seaLevel, hasSea = t.stats.hasSea;
  const hx = 0.6 * W + 2.5 * ws / 200, hy = 0.6 * H + 2.5 * ws / 200;
  const lo = [org + hx, org + hy], hi = [org + ws - hx, org + ws - hy];
  if (o.tSite === 'centre' || lo[0] >= hi[0] || lo[1] >= hi[1]) return { x: 0, z: 0, score: 0 };
  // river vertices with flow, for the in-view test
  let fmax = 1e-6;
  const rv = [];
  for (const r of t.rivers) for (let k = 0; k < r.flow.length; k++) { rv.push(r.pts[2 * k], r.pts[2 * k + 1], r.flow[k]); if (r.flow[k] > fmax) fmax = r.flow[k]; }
  const step = Math.min(W, H) / 3;
  const rnd = (i, j) => { let h = Math.imul(i * 73856093 ^ j * 19349663 ^ (o.tSeed >>> 0), 0x27d4eb2d); h ^= h >>> 15; return ((h >>> 0) % 1000) / 1000; };
  let best = null;
  for (let cz = lo[1], j = 0; cz <= hi[1]; cz += step, j++) {
    for (let cx = lo[0], i = 0; cx <= hi[0]; cx += step, i++) {
      let land = 0, n = 0, slope = 0, steep = 0, nl = 0, build = 0;
      for (let b = 0; b < 9; b++) for (let a = 0; a < 13; a++) {
        const x = cx + (a / 12 - 0.5) * W, z = cz + (b / 8 - 0.5) * H;
        const h = LIB.sampleHeight(t, x, z);
        n++;
        if (h >= sea) {
          land++;
          const gx = (LIB.sampleHeight(t, x + 20, z) - LIB.sampleHeight(t, x - 20, z)) / 40;
          const gz = (LIB.sampleHeight(t, x, z + 20) - LIB.sampleHeight(t, x, z - 20)) / 40;
          const s = Math.hypot(gx, gz);
          slope += s; nl++;
          if (s > grade) steep++; else build++;
        }
      }
      const lf = land / n;
      slope = nl ? slope / nl : 1;
      let fl = 0;
      for (let k = 0; k < rv.length; k += 3) {
        if (Math.abs(rv[k] - cx) < W * 0.42 && Math.abs(rv[k + 1] - cz) < H * 0.42 && rv[k + 2] > fl) fl = rv[k + 2];
      }
      const riverS = Math.sqrt(fl / fmax);
      const coastS = hasSea ? 1 - Math.min(1, Math.abs(lf - 0.68) / 0.32) : 0;
      const flatS = 1 - clamp(slope / (grade * 1.4), 0, 1);
      const hillS = clamp(slope / grade, 0, 1) * (1 - steep / Math.max(1, nl));
      const centreS = 1 - Math.hypot(cx, cz) / (ws * 0.7);
      const bf = build / n, bS = smooth(0.3, 0.75, bf);
      let sc;
      if (o.tSite === 'coast') sc = 3 * coastS + 0.5 * riverS + 0.5 * flatS + 1.2 * bS;
      else if (o.tSite === 'river') sc = 3 * riverS + 0.3 * coastS + 0.5 * flatS + 1.2 * bS;
      else if (o.tSite === 'hills') sc = 2 * hillS + 0.5 * riverS + 0.4 * coastS + 0.8 * bS;
      else sc = 1.7 * coastS + 1.4 * riverS + 0.5 * flatS + 0.3 * centreS + 1.3 * bS;
      sc += 0.15 * rnd(i, j);
      if (bf < 0.35) sc -= 2 * (0.35 - bf) + 0.5;
      if (lf < 0.3) sc -= 3 * (0.3 - lf) + 1;
      if (nl && steep / nl > 0.5) sc -= 1;
      if (!best || sc > best.score) best = { x: cx, z: cz, score: sc };
    }
  }
  return best;
}

// The largest LIB river through the view (map units): the piece with the
// most flow inside the view, followed on down through its joins.
function mainRiver(t, toM, W, H) {
  const inView = (x, y) => x > 0 && y > 0 && x < W && y < H;
  let best = null, bf = 0;
  t.rivers.forEach((r, ri) => {
    for (let k = 0; k < r.flow.length; k++) {
      const [x, y] = toM(r.pts[2 * k], r.pts[2 * k + 1]);
      if (inView(x, y) && r.flow[k] > bf) { bf = r.flow[k]; best = ri; }
    }
  });
  if (best == null) return null;
  const pts = [], width = [], flow = [];
  let r = t.rivers[best], from = 0;
  const seen = new Set();
  for (let hop = 0; hop < 8 && r && !seen.has(r); hop++) {
    seen.add(r);
    for (let k = from; k < r.flow.length; k++) { pts.push(toM(r.pts[2 * k], r.pts[2 * k + 1])); width.push(r.width[k]); flow.push(r.flow[k]); }
    if (r.end !== 'join') break;
    // the piece this one joins: the nearest point on another piece
    const ex = r.pts[r.pts.length - 2], ez = r.pts[r.pts.length - 1];
    let nr = null, nk = 0, nd = Infinity;
    for (const q of t.rivers) {
      if (seen.has(q)) continue;
      for (let k = 0; k < q.flow.length; k++) {
        const d = (q.pts[2 * k] - ex) ** 2 + (q.pts[2 * k + 1] - ez) ** 2;
        if (d < nd) { nd = d; nr = q; nk = k; }
      }
    }
    if (!nr || nd > (t.texel * 4) ** 2) break;
    r = nr; from = nk + 1;
  }
  return { pts, width, flow, maxFlow: bf };
}

// ─── the build ──────────────────────────────────────────────────────────────
const SNAP_N = 160;         // snapshot grid over the world (3D morph)
export const SNAP_COUNT = 8; // 7 LIB stages + the graded city ground
export const LIFT = 0.5;    // city layers sit this far over the ground (3D)
export const RIVER_BANK = 8;

export async function buildTerrain(o, W, H, onStage = null) {
  const lib = libOptions(o);
  const grade = clamp(+o.tGrade || 0.22, 0.08, 0.5);
  const events = [];
  const t = await LIB.generateTerrain(lib, async (p) => {
    if (p.snapshot && p.snapshot.height) events.push({ stage: p.stage, label: p.label, snap: p.snapshot });
    if (onStage) await onStage(p);
  });
  const ws = t.worldSize, org = -ws / 2, sea = t.seaLevel, hasSea = !!t.stats.hasSea;
  const site = pickSite(t, W, H, o, grade);
  const sx = site.x, sz = site.z;
  const toT = (mx, my) => [sx + mx - W / 2, sz + my - H / 2];
  const toM = (x, z) => [x - sx + W / 2, z - sz + H / 2];

  // grids
  const G = clamp(Math.round(ws / 40), 128, 320), c = ws / G, k = Math.max(2, Math.round(c / 6)), s = c / k;
  const dom = { x: -0.1 * W, y: -0.1 * H, w: 1.2 * W, h: 1.2 * H };
  const [tx0, tz0] = toT(dom.x, dom.y), [tx1, tz1] = toT(dom.x + dom.w, dom.y + dom.h);
  const i0 = clamp(Math.floor((tx0 - org) / c) - 1, 0, G - 1), i1 = clamp(Math.ceil((tx1 - org) / c) + 1, i0 + 1, G);
  const j0 = clamp(Math.floor((tz0 - org) / c) - 1, 0, G - 1), j1 = clamp(Math.ceil((tz1 - org) / c) + 1, j0 + 1, G);
  const nx = (i1 - i0) * k + 1, ny = (j1 - j0) * k + 1;
  const [x0, y0] = toM(org + i0 * c, org + j0 * c);

  // outer grid: final LIB heights with the shore step, colours, water surface
  const NO = G + 1;
  const oh = new Float32Array(NO * NO), owater = new Float32Array(NO * NO).fill(-1e4), ocol = new Uint8Array(NO * NO * 3);
  // the shore step: 0.8 m away from the sea level on each side, but
  // continuous through it (a hard step would put every shore crossing at a
  // cell middle, a staircase coast)
  const step = (h) => (!hasSea ? h : sea + shoreStep(h - sea));
  for (let j = 0; j < NO; j++) for (let i = 0; i < NO; i++) {
    const x = org + i * c, z = org + j * c, q = j * NO + i;
    const h = LIB.sampleHeight(t, x, z);
    oh[q] = step(h);
    const wd = libSample(t.water, t.n, ws, x, z);
    if (wd > 0.3 && h + wd > sea + 0.5) owater[q] = h + wd;
  }
  for (let j = 0; j < NO; j++) for (let i = 0; i < NO; i++) {
    const q = j * NO + i;
    const gx = (oh[j * NO + Math.min(NO - 1, i + 1)] - oh[j * NO + Math.max(0, i - 1)]) / (2 * c);
    const gz = (oh[Math.min(NO - 1, j + 1) * NO + i] - oh[Math.max(0, j - 1) * NO + i]) / (2 * c);
    const col = natural(t, org + i * c, org + j * c, Math.hypot(gx, gz), oh[q], sea);
    ocol[3 * q] = col[0]; ocol[3 * q + 1] = col[1]; ocol[3 * q + 2] = col[2];
  }

  // patch grid: g0 the true ground (terrainHeightAt), the lake indicator
  const N = nx * ny;
  const g0 = new Float32Array(N), lake = new Float32Array(N), lakeLvl = new Float32Array(N).fill(-1e4);
  const lakeInd = new Float32Array(t.n * t.n);
  for (let q = 0; q < lakeInd.length; q++) lakeInd[q] = t.biome[q] === 13 ? 1 : 0;
  for (let b = 0; b < ny; b++) for (let a = 0; a < nx; a++) {
    const [x, z] = toT(x0 + a * s, y0 + b * s), q = b * nx + a;
    g0[q] = LIB.terrainHeightAt(t, x, z);
    const li = libSample(lakeInd, t.n, ws, x, z);
    lake[q] = li;
    if (li > 0.3) lakeLvl[q] = LIB.sampleHeight(t, x, z) + Math.max(0.5, libSample(t.water, t.n, ws, x, z));
  }
  // water: the sea below the sea level, and lakes. block: water or too steep.
  const gs = blur3(g0, nx, ny, 2);
  const slope = new Float32Array(N);
  for (let b = 0; b < ny; b++) for (let a = 0; a < nx; a++) {
    const gx = (gs[b * nx + Math.min(nx - 1, a + 1)] - gs[b * nx + Math.max(0, a - 1)]) / ((Math.min(nx - 1, a + 1) - Math.max(0, a - 1)) * s);
    const gy = (gs[Math.min(ny - 1, b + 1) * nx + a] - gs[Math.max(0, b - 1) * nx + a]) / ((Math.min(ny - 1, b + 1) - Math.max(0, b - 1)) * s);
    slope[b * nx + a] = Math.hypot(gx, gy);
  }
  // grid lookups on the patch (map units)
  const gridAt = (arr, mx, my) => {
    const px = clamp((mx - x0) / s, 0, nx - 1), py = clamp((my - y0) / s, 0, ny - 1);
    const a = Math.min(Math.floor(px), nx - 2), b = Math.min(Math.floor(py), ny - 2), fx = px - a, fy = py - b;
    return lerp(lerp(arr[b * nx + a], arr[b * nx + a + 1], fx), lerp(arr[(b + 1) * nx + a], arr[(b + 1) * nx + a + 1], fx), fy);
  };
  const inDom = (p, m = 0) => p[0] > dom.x + m && p[1] > dom.y + m && p[0] < dom.x + dom.w - m && p[1] < dom.y + dom.h - m;

  // the river centreline first: the water rings leave its corridor out
  let river = null;
  if (o.river !== false) river = riverGeometry(t, toT, toM, W, H, dom, g0, gridAt, o, sea, hasSea);

  const wv = new Float32Array(N), bv = new Float32Array(N);
  for (let q = 0; q < N; q++) wv[q] = Math.max(hasSea ? sea - g0[q] : -50, (lake[q] - 0.5) * 4);
  if (river) {
    // LIB beds can lie under the sea level for a long way up a delta. Where
    // both banks of the city river are land, its corridor is land too, so
    // no shore (and no coast road) runs up the river.
    const { line, halfW } = river;
    const landAt = line.map((p, i) => {
      if (!hasSea) return true;
      const q = line[Math.min(i + 1, line.length - 1)], o2 = line[Math.max(i - 1, 0)];
      let dx = q[0] - o2[0], dy = q[1] - o2[1];
      const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
      const d = halfW + 18;
      return gridAt(g0, p[0] - dy * d, p[1] + dx * d) >= sea && gridAt(g0, p[0] + dy * d, p[1] - dx * d) >= sea;
    });
    nearLine(nx, ny, x0, y0, s, line, halfW + RIVER_BANK + 4, (q, d, i) => {
      if (landAt[i] && landAt[Math.min(i + 1, line.length - 1)]) wv[q] = Math.min(wv[q], -0.3);
    });
  }
  for (let q = 0; q < N; q++) bv[q] = Math.max(wv[q], (slope[q] - grade) * 40);
  const a0 = clamp(Math.floor((dom.x - x0) / s), 0, nx - 1), a1 = clamp(Math.ceil((dom.x + dom.w - x0) / s), 0, nx - 1);
  const b0 = clamp(Math.floor((dom.y - y0) / s), 0, ny - 1), b1 = clamp(Math.ceil((dom.y + dom.h - y0) / s), 0, ny - 1);
  // one tolerance and one least area for both, so the block rings hold the
  // water rings where the shore is not steep (the same contour points)
  const waterRings = cleanRings(contourRings(wv, nx, x0, y0, s, a0, a1, b0, b1), 1.5, 600);
  const blockRings = cleanRings(contourRings(bv, nx, x0, y0, s, a0, a1, b0, b1), 1.5, 600);
  const waterPoly = waterRings.length ? keyhole(waterRings) : [];
  const blockPoly = blockRings.length ? keyhole(blockRings) : [];

  // coast: the shore runs inside the domain on ground a street can take
  const coast = [];
  if (o.coast !== false) {
    for (const r of waterRings) {
      const ok = r.map((p) => inDom(p, 1) && gridAt(slope, p[0], p[1]) <= grade);
      let start = ok.indexOf(false);
      if (start < 0) { coast.push(r.concat([r[0]])); continue; }
      let run = [];
      for (let k2 = 1; k2 <= r.length; k2++) {
        const i = (start + k2) % r.length;
        if (ok[i]) run.push(r[i]);
        else { if (run.length > 1 && lineLen(run) > 80) coast.push(run); run = []; }
      }
      if (run.length > 1 && lineLen(run) > 80) coast.push(run);
    }
  }

  // river banks: the roads off the water
  if (river) river.banks = riverBanks(river, waterPoly, dom);

  // the graded ground: river bed and levees, the shore step, the patch edge
  const g = Float32Array.from(g0);
  if (river) carveRiver(g, g0, nx, ny, x0, y0, s, river);
  if (hasSea) {
    // the shore step follows the water polygon itself inside the ring box
    // (a pond too small to keep becomes land), the sign of g0 outside it
    for (let b = 0; b < ny; b++) for (let a = 0; a < nx; a++) {
      const q = b * nx + a;
      if (river && river.carved[q]) continue;
      let wet = g0[q] < sea;
      if (Math.abs(g0[q] - sea) < 6 && a >= a0 && a <= a1 && b >= b0 && b <= b1) wet = waterPoly.length > 0 && insideRing(x0 + a * s, y0 + b * s, waterPoly) && g0[q] < sea + 1;
      let d = g[q] - sea;
      if (wet && d > -0.05) d = -0.05;
      if (!wet && d < 0.05) d = 0.05;
      g[q] = sea + shoreStep(d);
    }
  }
  for (let b = 0; b < ny; b++) for (let a = 0; a < nx; a++) {
    const de = Math.min(a, b, nx - 1 - a, ny - 1 - b) * s;
    const w = clamp(de / c, 0, 1);
    if (w >= 1) continue;
    const ia = Math.min(Math.floor(a / k), i1 - i0 - 1), jb = Math.min(Math.floor(b / k), j1 - j0 - 1);
    const fx = (a - ia * k) / k, fy = (b - jb * k) / k;
    const oi = i0 + ia, oj = j0 + jb;
    const O = lerp(lerp(oh[oj * NO + oi], oh[oj * NO + oi + 1], fx), lerp(oh[(oj + 1) * NO + oi], oh[(oj + 1) * NO + oi + 1], fx), fy);
    g[b * nx + a] = lerp(O, g[b * nx + a], w);
  }
  qArr(g, 1000);

  // patch colours
  const pcol = new Uint8Array(N * 3);
  for (let b = 0; b < ny; b++) for (let a = 0; a < nx; a++) {
    const q = b * nx + a, [x, z] = toT(x0 + a * s, y0 + b * s);
    const col = natural(t, x, z, slope[q], g[q], sea);
    pcol[3 * q] = col[0]; pcol[3 * q + 1] = col[1]; pcol[3 * q + 2] = col[2];
  }

  // snapshots: 7 LIB stages, each on a SNAP_N grid over the world (3D) and
  // over the domain (2D)
  const pick = [];
  const byStage = (st) => events.filter((e) => e.stage === st);
  const dla = byStage('dla'), ero = byStage('erosion').filter((e) => e.snap.n === t.n);
  pick.push(dla[0] || events[0], dla[dla.length - 1] || events[0], byStage('upscale').pop() || events[0], byStage('shape').pop() || events[0],
    byStage('flow').pop() || byStage('shape').pop() || events[0], ero[Math.floor(ero.length / 2)] || events[events.length - 1], events[events.length - 1]);
  const cw = 160, ch = Math.max(2, Math.round(cw * dom.h / dom.w));
  const snaps = pick.map((e, si) => {
    const sn = e.snap, n = sn.n;
    const world = new Float32Array(SNAP_N * SNAP_N);
    for (let j = 0; j < SNAP_N; j++) for (let i = 0; i < SNAP_N; i++) world[j * SNAP_N + i] = libSample(sn.height, n, ws, org + i * ws / (SNAP_N - 1), org + j * ws / (SNAP_N - 1));
    const crop = new Float32Array(cw * ch);
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
      const [x, z] = toT(dom.x + (i + 0.5) * dom.w / cw, dom.y + (j + 0.5) * dom.h / ch);
      crop[j * cw + i] = libSample(sn.height, n, ws, x, z);
    }
    qArr(world, 100); qArr(crop, 100);
    const label = si === 6 ? 'Rivers, climate and biomes' : e.label;
    return { stage: e.stage, label, world, crop };
  });

  // home view: look toward the high ground behind the city
  let hx = 0, hz = 0;
  for (let j = 0; j < NO; j += 4) for (let i = 0; i < NO; i += 4) {
    const x = org + i * c - sx, z = org + j * c - sz, d = Math.hypot(x, z);
    if (d < 300 || d > ws * 0.45) continue;
    const w = Math.max(0, oh[j * NO + i] - sea) / Math.max(200, d);
    hx += x / d * w; hz += z / d * w;
  }

  const T = {
    v: 1,
    preset: o.tPreset, opts: lib, grade, contour: clamp(+o.tContour || 0, 0, 1),
    worldSize: ws, seaLevel: sea, hasSea, heightScale: t.heightScale,
    site: { x: sx, z: sz, score: +site.score.toFixed(3) },
    grid: { x0, y0, s, nx, ny, h: g, slope: qArr(slope, 1e4), lakeLevel: lakeLvl },
    patch: { i0, j0, i1, j1, k },
    outer: { G, c, origin: org, h: qArr(oh, 1000), water: qArr(owater, 100), col: ocol },
    col: pcol,
    water: waterPoly, waterRings, block: blockPoly, coast,
    river,
    snaps,
    crop: { w: cw, h: ch, m: dom.w / cw },
    home: { x: hx, y: -hz },     // 3D frame: y north = -z
    stats: {
      relief: Math.round(t.stats.maxHeight - Math.max(sea, t.stats.minHeight)),
      riverCount: t.stats.riverCount, lakeCount: t.stats.lakeCount, landFraction: +t.stats.landFraction.toFixed(3),
      ms: t.stats.ms,
    },
  };
  // the 2D underlay and contours (the finished map)
  T.under = underlay(T, t, W, H);
  T.contours = contourSegments(T, dom);
  return T;
}

// d (m above the sea) -> d pushed 0.8 m away from 0, steep but continuous
// within 0.3 m of it, so the sea plane never meets the ground in a flat band.
function shoreStep(d) { return d + 0.8 * clamp(d / 0.3, -1, 1); }

function qArr(a, k) { for (let i = 0; i < a.length; i++) a[i] = Math.round(a[i] * k) / k; return a; }

// A muted natural colour for the 3D ground (sRGB bytes): LIB biome colour,
// rock on steep ground, a wet sea floor. The city view keeps a low key.
const ROCK = [0.36, 0.34, 0.32], FLOOR = [0.24, 0.27, 0.25], STREAM = [0.17, 0.29, 0.34];
// Biome colour, a soft blend of the 4 x 4 nearest texels (quadratic
// B-spline weights), so the biome edges have no steps. LIB rivers and lakes
// take a stream colour.
const bsp = (u) => { u = Math.abs(u); return u < 0.5 ? 0.75 - u * u : u < 1.5 ? 0.5 * (1.5 - u) ** 2 : 0; };
function biomeColour(t, x, z) {
  const n = t.n, tx = t.worldSize / n, o = -t.worldSize / 2;
  const px = (x - o) / tx - 0.5, pz = (z - o) / tx - 0.5;
  const i0 = Math.round(px), j0 = Math.round(pz);
  const out = [0, 0, 0];
  let ws = 0;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const i = clamp(i0 + di, 0, n - 1), j = clamp(j0 + dj, 0, n - 1);
    const w = bsp(i0 + di - px) * bsp(j0 + dj - pz);
    if (w <= 0) continue;
    const bi = t.biome[j * n + i];
    const c = bi === 12 || bi === 13 ? STREAM : LIB.BIOMES[bi].color;
    out[0] += c[0] * w; out[1] += c[1] * w; out[2] += c[2] * w; ws += w;
  }
  return out.map((v) => v / (ws || 1));
}
function natural(t, x, z, slope, h, sea) {
  let cc = biomeColour(t, x, z);
  const gr = (cc[0] + cc[1] + cc[2]) / 3;
  cc = cc.map((v) => (v * 0.72 + gr * 0.28) * 0.7);
  const rk = smooth(0.32, 0.85, slope);
  cc = cc.map((v, i) => lerp(v, ROCK[i], rk));
  if (h < sea) cc = FLOOR;
  return cc.map((v) => Math.round(clamp(v, 0, 1) * 255));
}

// ─── river ──────────────────────────────────────────────────────────────────
function riverGeometry(t, toT, toM, W, H, dom, g0, gridAt, o, sea, hasSea) {
  const mr = mainRiver(t, toM, W, H);
  if (!mr) return null;
  const lib = mr.pts.map(R2);
  // the part inside the domain (plus 30 m), the longest run
  const inD = (p) => p[0] > dom.x - 30 && p[1] > dom.y - 30 && p[0] < dom.x + dom.w + 30 && p[1] < dom.y + dom.h + 30;
  let runs = [], cur = [];
  mr.pts.forEach((p, i) => { if (inD(p)) cur.push(i); else { if (cur.length) runs.push(cur); cur = []; } });
  if (cur.length) runs.push(cur);
  if (!runs.length) return null;
  runs.sort((a, b) => b.length - a.length);
  let idx = runs[0];
  // stop where it has run well into the sea
  if (hasSea) {
    let wet = 0, cut = idx.length;
    for (let k = 0; k < idx.length; k++) {
      const p = mr.pts[idx[k]];
      const h = gridAt(g0, p[0], p[1]);
      if (h < sea - 0.5) { wet++; if (wet * t.texel > 40) { cut = k; break; } } else wet = 0;
    }
    idx = idx.slice(0, cut);
  }
  if (idx.length < 3) return null;
  let line = idx.map((i) => mr.pts[i]);
  if (lineLen(line) < 0.35 * Math.min(W, H)) return null;
  // smooth: resample, three [1 2 1] passes, resample
  line = resampleLine(line, 6);
  for (let p = 0; p < 3; p++) line = line.map((q, i) => (i === 0 || i === line.length - 1 ? q : [(line[i - 1][0] + 2 * q[0] + line[i + 1][0]) / 4, (line[i - 1][1] + 2 * q[1] + line[i + 1][1]) / 4]));
  line = resampleLine(line, 8).map(R2);
  const ws = idx.map((i) => mr.width[i]).sort((a, b) => a - b);
  const halfW = Math.round(clamp(ws[ws.length >> 1] / 2 * (0.8 + 1.6 * clamp(+o.tRiver || 0, 0, 1)), 9, 42) * 10) / 10;
  // the water surface along it: LIB ground + water depth, never rising downstream
  const surf = line.map((p) => {
    const [x, z] = toT(p[0], p[1]);
    return LIB.sampleHeight(t, x, z) + Math.max(0.4, libSample(t.water, t.n, t.worldSize, x, z));
  });
  for (let i = 1; i < surf.length; i++) surf[i] = Math.min(surf[i], surf[i - 1]);
  if (hasSea) for (let i = 0; i < surf.length; i++) surf[i] = Math.max(surf[i], sea + 0.25);
  const sm = surf.map((v, i) => { let a = 0, n = 0; for (let d = -3; d <= 3; d++) { const j = i + d; if (j >= 0 && j < surf.length) { a += surf[j]; n++; } } return a / n; });
  for (let i = 1; i < sm.length; i++) sm[i] = Math.min(sm[i], sm[i - 1]);
  const V = line.map((p) => new MG.Vector(p[0], p[1]));
  const poly = MG.PolygonUtil.resizeGeometry(V, halfW, false).map((v) => [v.x, v.y]);
  const bank = MG.PolygonUtil.resizeGeometry(V, halfW + RIVER_BANK, false).map((v) => [v.x, v.y]);
  if (poly.length < 4 || bank.length < 4) return null;
  return {
    line, halfW, surf: Float32Array.from(sm.map((v) => Math.round(v * 100) / 100)), lib,
    poly: poly.map(R2), bank: bank.map(R2), banks: [], maxFlow: +mr.maxFlow.toFixed(2), carved: null,
  };
}

// Bank roads: the two sides of the bank ring, off the water, in the domain.
function riverBanks(rv, waterPoly, dom) {
  const { bank, line, halfW } = rv;
  return splitBanks(bank, line, halfW + RIVER_BANK).flatMap((side) => {
    const out = [];
    let run = [];
    for (const p of side) {
      const ok = p[0] > dom.x && p[1] > dom.y && p[0] < dom.x + dom.w && p[1] < dom.y + dom.h && !(waterPoly.length && insideRing(p[0], p[1], waterPoly));
      if (ok) run.push(p);
      else { if (run.length > 1 && lineLen(run) > 40) out.push(run); run = []; }
    }
    if (run.length > 1 && lineLen(run) > 40) out.push(run);
    return out.map((l) => simplifyDP(l, 0.8).map(R2));
  });
}

// The nearest point of a polyline: [distance, index of the segment, t, side].
function nearestOnLine(line, x, y) {
  let bd = Infinity, bi = 0, bt = 0, side = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const ax = line[i][0], ay = line[i][1], dx = line[i + 1][0] - ax, dy = line[i + 1][1] - ay;
    const L2 = dx * dx + dy * dy || 1e-9;
    const tt = clamp(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1);
    const ex = x - ax - tt * dx, ey = y - ay - tt * dy, d = ex * ex + ey * ey;
    if (d < bd) { bd = d; bi = i; bt = tt; side = dx * ey - dy * ex; }
  }
  return [Math.sqrt(bd), bi, bt, side];
}
function splitBanks(ring, line, d) {
  // cap vertices (beyond the ends) out, then the runs of each side
  const n = ring.length - (ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? 1 : 0);
  const sideOf = [];
  for (let i = 0; i < n; i++) {
    const [dist, si, tt, side] = nearestOnLine(line, ring[i][0], ring[i][1]);
    const cap = (si === 0 && tt <= 0) || (si === line.length - 2 && tt >= 1) || dist < d * 0.7;
    sideOf.push(cap ? 0 : side > 0 ? 1 : -1);
  }
  let start = sideOf.indexOf(0);
  if (start < 0) {
    start = 0;
    for (let i = 0; i < n; i++) if (sideOf[i] !== sideOf[(i + n - 1) % n]) { start = (i + n - 1) % n; break; }
  }
  const runs = [];
  let cur = [], cs = 0;
  for (let k = 1; k <= n; k++) {
    const i = (start + k) % n, sd = sideOf[i];
    if (sd !== cs) { if (cur.length > 1) runs.push(cur); cur = []; cs = sd; }
    if (sd) cur.push(ring[i]);
  }
  if (cur.length > 1) runs.push(cur);
  return runs;
}

// River bed and levees on the patch grid. Inside the water half width the
// ground goes under the surface; up to 15 m out it stays above it; then it
// blends back to the true ground.
function carveRiver(g, g0, nx, ny, x0, y0, s, rv) {
  const { line, halfW, surf } = rv;
  const carved = new Uint8Array(nx * ny);
  const R = halfW + 45;
  nearLine(nx, ny, x0, y0, s, line, R, (q, d, i, tt) => {
    const sf = lerp(surf[i], surf[i + 1], tt);
    if (d < halfW + 1) {
      const u = d / (halfW + 1);
      g[q] = Math.min(g0[q], sf - 0.9 - 2.4 * (1 - u * u));
      carved[q] = 1;
    } else {
      const levee = Math.max(g0[q], sf + 0.7 + (d - halfW) * 0.04);
      g[q] = lerp(levee, g0[q], smooth(halfW + 15, R, d));
      if (d < halfW + 15) carved[q] = 1;
    }
  });
  rv.carved = carved;
}

// Calls fn(q, d, i, t) for each patch vertex q within R of the polyline:
// d the distance, i the nearest segment, t the place along it. A coarse
// bucket of segments keeps it fast.
function nearLine(nx, ny, x0, y0, s, line, R, fn) {
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  for (const p of line) { mnx = Math.min(mnx, p[0]); mny = Math.min(mny, p[1]); mxx = Math.max(mxx, p[0]); mxy = Math.max(mxy, p[1]); }
  const aA = clamp(Math.floor((mnx - R - x0) / s), 0, nx - 1), aB = clamp(Math.ceil((mxx + R - x0) / s), 0, nx - 1);
  const bA = clamp(Math.floor((mny - R - y0) / s), 0, ny - 1), bB = clamp(Math.ceil((mxy + R - y0) / s), 0, ny - 1);
  const cell = 64, buck = new Map();
  for (let i = 0; i < line.length - 1; i++) {
    const xa = Math.min(line[i][0], line[i + 1][0]) - R, xb = Math.max(line[i][0], line[i + 1][0]) + R;
    const ya = Math.min(line[i][1], line[i + 1][1]) - R, yb = Math.max(line[i][1], line[i + 1][1]) + R;
    for (let cy = Math.floor(ya / cell); cy <= Math.floor(yb / cell); cy++) for (let cx = Math.floor(xa / cell); cx <= Math.floor(xb / cell); cx++) {
      const key = cx + ',' + cy; if (!buck.has(key)) buck.set(key, []); buck.get(key).push(i);
    }
  }
  for (let b = bA; b <= bB; b++) for (let a = aA; a <= aB; a++) {
    const x = x0 + a * s, y = y0 + b * s;
    const segs = buck.get(Math.floor(x / cell) + ',' + Math.floor(y / cell));
    if (!segs) continue;
    let bd = Infinity, bs = 0, bt = 0;
    for (const i of segs) {
      const ax = line[i][0], ay = line[i][1], dx = line[i + 1][0] - ax, dy = line[i + 1][1] - ay;
      const L2 = dx * dx + dy * dy || 1e-9, tt = clamp(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1);
      const d = (x - ax - tt * dx) ** 2 + (y - ay - tt * dy) ** 2;
      if (d < bd) { bd = d; bs = i; bt = tt; }
    }
    const d = Math.sqrt(bd);
    if (d <= R) fn(b * nx + a, d, bs, bt);
  }
}

// ─── the slope field ────────────────────────────────────────────────────────
// An upstream BasisField whose tensor follows the contour lines, weighted by
// the slope: on steep ground the major roads run across the slope. Upstream
// TensorField.samplePoint sums the fields in order, and in its non-smooth
// mode each later add doubles the sum so far (Tensor.add, r = 2), so this
// field, added last, takes a weight of 2^(n + 1) to lead on a hillside.
export function makeSlopeField(T, nBefore, smoothField) {
  const { x0, y0, s, nx, ny, slope } = T.grid;
  const h = T.grid.h;
  const grade = T.grade, k = T.contour;
  const K = (smoothField ? 4 : 2 ** (nBefore + 1)) * k;
  class SlopeField extends MG.BasisField {
    constructor() { super(new MG.Vector(0, 0), 1, 0); this.FIELD_TYPE = -1; }
    grad(p) {
      const px = clamp((p.x - x0) / s, 1, nx - 2), py = clamp((p.y - y0) / s, 1, ny - 2);
      const a = Math.round(px), b = Math.round(py);
      return [(h[b * nx + a + 1] - h[b * nx + a - 1]) / (2 * s), (h[(b + 1) * nx + a] - h[(b - 1) * nx + a]) / (2 * s)];
    }
    getTensor(p) {
      const [gx, gy] = this.grad(p);
      const th = Math.atan2(gx, -gy);      // the contour direction (-gy, gx)
      return new MG.Tensor(1, [Math.cos(2 * th), Math.sin(2 * th)]);
    }
    getTensorWeight(p) {
      const px = clamp((p.x - x0) / s, 0, nx - 1), py = clamp((p.y - y0) / s, 0, ny - 1);
      const sl = slope[Math.round(py) * nx + Math.round(px)];
      return K * smooth(0.03, grade * 0.75, sl);
    }
  }
  return new SlopeField();
}

// ─── lookups ────────────────────────────────────────────────────────────────
// Ground height (m) at a map point: the patch grid, else the outer grid.
export function groundAt(T, mx, my) {
  const { x0, y0, s, nx, ny, h } = T.grid;
  const px = (mx - x0) / s, py = (my - y0) / s;
  if (px >= 0 && py >= 0 && px <= nx - 1 && py <= ny - 1) {
    const a = Math.min(Math.floor(px), nx - 2), b = Math.min(Math.floor(py), ny - 2), fx = px - a, fy = py - b;
    return lerp(lerp(h[b * nx + a], h[b * nx + a + 1], fx), lerp(h[(b + 1) * nx + a], h[(b + 1) * nx + a + 1], fx), fy);
  }
  return outerAt(T, mx, my);
}
export function outerAt(T, mx, my) {
  const { G, c, origin, h } = T.outer, NO = G + 1;
  // map -> terrain: x = sx + mx - W/2; the patch origin fixes W/2 - sx
  const ox = T.grid.x0 - T.patch.i0 * c, oy = T.grid.y0 - T.patch.j0 * c;   // map x of terrain origin
  const px = clamp((mx - ox) / c, 0, G), py = clamp((my - oy) / c, 0, G);
  const a = Math.min(Math.floor(px), G - 1), b = Math.min(Math.floor(py), G - 1), fx = px - a, fy = py - b;
  void origin;
  return lerp(lerp(h[b * NO + a], h[b * NO + a + 1], fx), lerp(h[(b + 1) * NO + a], h[(b + 1) * NO + a + 1], fx), fy);
}
export function slopeAt(T, mx, my) {
  const { x0, y0, s, nx, ny, slope } = T.grid;
  const a = clamp(Math.round((mx - x0) / s), 0, nx - 1), b = clamp(Math.round((my - y0) / s), 0, ny - 1);
  return slope[b * nx + a];
}
// The river water surface (m) at the nearest point of the centreline, and
// the distance to it.
export function riverAt(T, mx, my) {
  const rv = T.river;
  if (!rv) return null;
  const [d, i, tt] = nearestOnLine(rv.line, mx, my);
  return { d, surf: lerp(rv.surf[i], rv.surf[Math.min(i + 1, rv.surf.length - 1)], tt) };
}

// ─── 2D ─────────────────────────────────────────────────────────────────────
// The underlay of the finished map: RGBA bytes over the generator domain,
// 3 m a pixel: biome tint in the dark map palette, hillshade from the
// north-west, the sea and lakes by depth.
export const UNDER_M = 3;
const LAND = [0x2a / 255, 0x2d / 255, 0x31 / 255], SEA = [0x0e / 255, 0x2a / 255, 0x35 / 255], SHALLOW = [0x1a / 255, 0x45 / 255, 0x52 / 255];
export function underlay(T, t, W, H) {
  const dom = { x: -0.1 * W, y: -0.1 * H, w: 1.2 * W, h: 1.2 * H };
  const w = Math.round(dom.w / UNDER_M), h = Math.round(dom.h / UNDER_M);
  const data = new Uint8ClampedArray(w * h * 4);
  const sea = T.seaLevel;
  const ox = T.grid.x0 - T.patch.i0 * T.outer.c, oy = T.grid.y0 - T.patch.j0 * T.outer.c;
  const L = [-0.55, -0.62, 0.56];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const mx = dom.x + (i + 0.5) * UNDER_M, my = dom.y + (j + 0.5) * UNDER_M;
    const g = groundAt(T, mx, my);
    const gx = (groundAt(T, mx + 3, my) - groundAt(T, mx - 3, my)) / 6, gy = (groundAt(T, mx, my + 3) - groundAt(T, mx, my - 3)) / 6;
    const ez = 2.2, nl = Math.hypot(gx * ez, gy * ez, 1);
    const hs = (-gx * ez * L[0] - gy * ez * L[1] + L[2]) / nl;
    let col;
    const lk = T.grid.lakeLevel, G2 = T.grid;
    const la = clamp(Math.round((mx - G2.x0) / G2.s), 0, G2.nx - 1), lb = clamp(Math.round((my - G2.y0) / G2.s), 0, G2.ny - 1);
    const lakeHere = lk[lb * G2.nx + la] > g + 0.2;
    if ((T.hasSea && g < sea) || lakeHere) {
      const dep = lakeHere ? 2 : sea - g;
      col = SEA.map((v, k) => lerp(SHALLOW[k], v, smooth(0, 14, dep)));
      col = col.map((v) => v * (0.9 + 0.2 * hs));
    } else {
      const bc = biomeColour(t, mx - ox + T.outer.origin, my - oy + T.outer.origin);
      const gr = (bc[0] + bc[1] + bc[2]) / 3;
      const tint = bc.map((v) => (v * 0.75 + gr * 0.25) * 0.5);
      const up = smooth(sea, sea + Math.max(80, T.heightScale), g);
      col = LAND.map((v, k) => lerp(v, tint[k], 0.42) * (1 + 0.18 * up));
      col = col.map((v) => v * (0.55 + 0.75 * clamp(hs, 0, 1.2)));
    }
    const o = (j * w + i) * 4;
    data[o] = col[0] * 255; data[o + 1] = col[1] * 255; data[o + 2] = col[2] * 255; data[o + 3] = 255;
  }
  return { x: dom.x, y: dom.y, w, h, m: UNDER_M, data };
}

// A snapshot of the terrain forming (2D): hypsometric tint and hillshade of
// the crop heights. Returns RGBA bytes, crop size.
export function snapshotRaster(T, k) {
  const sn = T.snaps[k], { w, h, m } = T.crop, H2 = sn.crop;
  const data = new Uint8ClampedArray(w * h * 4);
  const sea = T.hasSea ? T.seaLevel : -Infinity, hs0 = Math.max(50, T.heightScale);
  const ez = 2.2 / (2 * m);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const v = H2[j * w + i];
    const gx = (H2[j * w + Math.min(w - 1, i + 1)] - H2[j * w + Math.max(0, i - 1)]) * ez;
    const gy = (H2[Math.min(h - 1, j + 1) * w + i] - H2[Math.max(0, j - 1) * w + i]) * ez;
    const hs = clamp((0.55 * gx + 0.62 * gy + 0.56) / Math.hypot(gx, gy, 1), 0, 1.2);
    let col;
    if (v < sea) col = SEA.map((c, q) => lerp(SHALLOW[q], c, smooth(0, 14, sea - v)) * (0.9 + 0.2 * hs));
    else {
      const u = clamp((v - Math.max(0, sea)) / hs0, 0, 1);
      const a = [0.18, 0.21, 0.19], b = [0.36, 0.34, 0.3], cc = [0.62, 0.6, 0.57];
      const base = u < 0.5 ? a.map((x, q) => lerp(x, b[q], u * 2)) : b.map((x, q) => lerp(x, cc[q], (u - 0.5) * 2));
      col = base.map((x) => x * (0.55 + 0.75 * hs));
    }
    const o = (j * w + i) * 4;
    data[o] = col[0] * 255; data[o + 1] = col[1] * 255; data[o + 2] = col[2] * 255; data[o + 3] = 255;
  }
  return { w, h, data };
}

// Contour lines of the graded ground over the domain, above the sea:
// Float32Array segments (x1, y1, x2, y2) for the minor and the major levels.
export function contourSegments(T, dom) {
  const { x0, y0, s, nx, ny, h } = T.grid;
  const a0 = clamp(Math.floor((dom.x - x0) / s), 0, nx - 2), a1 = clamp(Math.ceil((dom.x + dom.w - x0) / s), 1, nx - 1);
  const b0 = clamp(Math.floor((dom.y - y0) / s), 0, ny - 2), b1 = clamp(Math.ceil((dom.y + dom.h - y0) / s), 1, ny - 1);
  let lo = Infinity, hi = -Infinity;
  for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) { const v = h[b * nx + a]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - Math.max(lo, T.hasSea ? T.seaLevel : lo);
  const steps = [2, 5, 10, 20, 25, 50, 100, 200];
  const iv = steps.find((x) => span / x <= 24) || 200;
  const minor = [], major = [];
  const start = Math.ceil((Math.max(lo, T.hasSea ? T.seaLevel + 0.9 : lo)) / iv) * iv;
  for (let b = b0; b < b1; b++) for (let a = a0; a < a1; a++) {
    const q = [h[b * nx + a], h[b * nx + a + 1], h[(b + 1) * nx + a + 1], h[(b + 1) * nx + a]];
    const mn = Math.min(...q), mx = Math.max(...q);
    if (mx < start) continue;
    const X = [x0 + a * s, x0 + (a + 1) * s, x0 + (a + 1) * s, x0 + a * s], Y = [y0 + b * s, y0 + b * s, y0 + (b + 1) * s, y0 + (b + 1) * s];
    for (let L = Math.max(start, Math.ceil(mn / iv) * iv); L <= mx; L += iv) {
      const pts = [];
      for (let e = 0; e < 4; e++) {
        const u = q[e] - L, v = q[(e + 1) % 4] - L;
        if ((u < 0) !== (v < 0)) { const tt = u / (u - v); pts.push(X[e] + (X[(e + 1) % 4] - X[e]) * tt, Y[e] + (Y[(e + 1) % 4] - Y[e]) * tt); }
      }
      const tgt = Math.round(L / iv) % 5 === 0 ? major : minor;
      if (pts.length >= 4) tgt.push(pts[0], pts[1], pts[2], pts[3]);
      if (pts.length === 8) tgt.push(pts[4], pts[5], pts[6], pts[7]);
    }
  }
  return { interval: iv, minor: Float32Array.from(minor), major: Float32Array.from(major) };
}
