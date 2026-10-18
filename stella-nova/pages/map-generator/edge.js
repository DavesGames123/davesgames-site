// edge.js — the ragged edge of the city: where the built area stops, and
// what the land past it holds. Ours. No DOM. gen.js calls urbanForm() after
// the lots and the building heights; mesh3d.js, terrain3d.js and draw2d.js
// read the result (city.farms, city.form).
//
// The user: "rougher edges on the city generator". Before this file, the
// city filled the whole map rectangle: every block to the view edge, so the
// built area was a rectangle with straight sides in 2D and in 3D.
//
// MECHANISM. A cost-distance field over a grid of CELL m cells. Growth
// starts at the city centre (the view centre: terrain.js puts the site
// there), at each radial field centre, and at a few outlying villages
// (they start with a cost offset, so they stay small). The cost of a cell
// is 1 m per m, times:
//   - fractal noise (fBm, 4 octaves, 240 m): the edge gets detail at all scales
//   - the slope (terrain): steep ground is slow, so the city runs up the
//     valleys and stops at the hills
//   - water (sea, river, lakes): 30 times, so the city stays on its banks
//     unless a road crosses
//   - roads: 0.3 on main and coast roads, 0.45 on major roads, so the
//     city runs out along them (ribbon development)
// Dijkstra on the 8-neighbour grid gives the cost distance cd. The urban
// level u = 1 / (1 + exp((cd - R) / (0.12 R))), with R the quantile of cd
// over the land cells of the view that sets the built share (1 - 0.7 edge).
//
// USE (per block, at its centroid, with a seeded jitter):
//   u > 0.5            urban: the block stays; at the fringe some lots
//                      stay empty (gardens, gaps), and buildings are lower
//   else               the block goes (wild land or fields)
// Fields: the large faces of the main and major roads (gen.js gives them)
// cut in strips along the longest side, at most about 220 m long, a crop
// each; a strip stays on dry, gentle farmland (0.03 < u < 0.5) with no
// urban block under its centre.
// Minor roads keep only their runs near urban blocks; major roads their runs
// near urban blocks or fields. Main, coast and river roads stay whole.
// opts.edge 0 keeps the old city exactly (every block, no fields).
//
// urbanForm(a) -> { keepBlock: Uint8Array (0 wild, 1 urban, 2 farm),
//   keepLot: Uint8Array, lotScale: Float32Array (height factor per lot),
//   farms: [{ poly, crop }], form: { R, cell, nuclei, edge, urbanShare } }
//   a = { W, H, dom, blocks, lots, lotBlock, roads, fields, T, sea, river,
//         edge, seed, grade, superBlocks }
// trimLines(lines, fam, near, minLen) -> { lines, fam }: the runs of each
//   line where near(x, y) is true (split at gaps), with their families
// farmLookup(farms) -> (mx, my) => crop index or -1
// CROPS: [r, g, b] 0..1 per crop (3D); draw2d.js CROP_CSS has the 2D colours
// boundaryStats(mask, nx, ny) -> { area, perimeter, ratio, dimension }: the
//   perimeter / area measure and the box-count dimension (tests.mjs)
//
// grep: export const CELL  export const CROPS  export function urbanForm  function costGrid
//       function dijkstra  function fbm  function stripes  export function trimLines
//       export function farmLookup  export function boundaryStats  export function rasterise

import { groundAt, slopeAt, riverAt } from './terrain.js';

export const CELL = 12;
export const CROPS = [
  [0.56, 0.48, 0.27],   // ripe grain
  [0.31, 0.41, 0.19],   // green crop
  [0.37, 0.29, 0.21],   // ploughed soil
  [0.37, 0.45, 0.25],   // pasture
  [0.47, 0.43, 0.31],   // stubble, fallow
  [0.60, 0.56, 0.22],   // rapeseed (few)
];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(i, j, s) {
  let h = (Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(i, j, s), b = hash2(i + 1, j, s), c = hash2(i, j + 1, s), d = hash2(i + 1, j + 1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
// fBm 0..1, base wavelength L m, 4 octaves (gain 0.55, lacunarity 2.03)
function fbm(x, y, L, s) {
  let v = 0, amp = 0.5, f = 1 / L, tot = 0;
  for (let o = 0; o < 4; o++) { v += amp * vnoise(x * f, y * f, s + o * 101); tot += amp; amp *= 0.55; f *= 2.03; }
  return v / tot;
}

function insidePoly(x, y, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const cen = (p) => { let x = 0, y = 0; for (const q of p) { x += q[0]; y += q[1]; } return [x / p.length, y / p.length]; };
function areaOf(p) {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] - p[i][0]) * (p[j][1] + p[i][1]);
  return a / 2;
}

// Mark the grid cells within r m of a line.
function stamp(mark, val, l, g, r) {
  const { x0, y0, nx, ny } = g, s = CELL;
  for (let i = 1; i < l.length; i++) {
    const [ax, ay] = l[i - 1], [bx, by] = l[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (s * 0.5)));
    for (let k = 0; k <= n; k++) {
      const x = ax + (bx - ax) * k / n, y = ay + (by - ay) * k / n;
      const ci = Math.round((x - x0) / s), cj = Math.round((y - y0) / s), rc = Math.ceil(r / s);
      for (let dj = -rc; dj <= rc; dj++) for (let di = -rc; di <= rc; di++) {
        const a = ci + di, b = cj + dj;
        if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
        if ((a * s + x0 - x) ** 2 + (b * s + y0 - y) ** 2 > r * r + s * s * 0.25) continue;
        const q = b * nx + a;
        if (mark[q] > val || mark[q] === 0) mark[q] = val;
      }
    }
  }
}

// COST GRID (see the header). Returns { g, cost, water, slope }.
function costGrid(a, seed) {
  const { dom, T, sea, river, roads, edge } = a;
  const x0 = dom.x, y0 = dom.y;
  const nx = Math.ceil(dom.w / CELL) + 1, ny = Math.ceil(dom.h / CELL) + 1;
  const g = { x0, y0, nx, ny };
  const N = nx * ny;
  const cost = new Float32Array(N), water = new Uint8Array(N), slope = new Float32Array(N);
  const grade = a.grade || 0.22;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const q = j * nx + i, x = x0 + i * CELL, y = y0 + j * CELL;
    let wet = false, sl = 0;
    if (T) {
      const gr = groundAt(T, x, y);
      if (T.hasSea && gr < T.seaLevel) wet = true;
      const rv = riverAt(T, x, y);
      if (rv && rv.d < T.river.halfW) wet = true;
      const { x0: gx, y0: gy, s, nx: gnx, ny: gny, lakeLevel, h } = T.grid;
      const a2 = Math.round((x - gx) / s), b2 = Math.round((y - gy) / s);
      if (lakeLevel && a2 >= 0 && b2 >= 0 && a2 < gnx && b2 < gny && lakeLevel[b2 * gnx + a2] > h[b2 * gnx + a2] + 0.1) wet = true;
      sl = slopeAt(T, x, y);
    } else {
      if (sea && sea.length > 2 && insidePoly(x, y, sea)) wet = true;
      if (river && river.length > 2 && insidePoly(x, y, river)) wet = true;
    }
    water[q] = wet ? 1 : 0;
    slope[q] = sl;
    // noise: exp of a centred fBm, so the cost varies by about e^(+-1.6 edge)
    const n = fbm(x, y, 240, seed) - 0.5;
    let c = Math.exp(3.2 * edge * n);
    c *= 1 + 9 * smooth(0.25 * grade, 1.1 * grade, sl);
    if (wet) c *= 30;
    cost[q] = c;
  }
  // roads: lower cost (the city runs out along them), over water too (bridges)
  const mark = new Float32Array(N);
  for (const l of roads.main || []) stamp(mark, 0.3, l, g, CELL * 0.8);
  for (const l of roads.coast || []) stamp(mark, 0.3, l, g, CELL * 0.8);
  for (const l of roads.river || []) stamp(mark, 0.4, l, g, CELL * 0.8);
  for (const l of roads.major || []) stamp(mark, 0.45, l, g, CELL * 0.8);
  for (let q = 0; q < N; q++) if (mark[q] > 0) cost[q] = Math.min(cost[q], mark[q] * (water[q] ? 1.5 : 1) * Math.max(0.6, Math.min(cost[q], 3)));
  return { g, cost, water, slope };
}

// Multi-source Dijkstra (binary heap) on the 8-neighbour grid.
function dijkstra(g, cost, sources) {
  const { nx, ny } = g, N = nx * ny;
  const d = new Float32Array(N).fill(Infinity);
  const heap = [], hd = [];
  const push = (q, v) => {
    heap.push(q); hd.push(v);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hd[p] <= hd[i]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]]; [hd[p], hd[i]] = [hd[i], hd[p]];
      i = p;
    }
  };
  const pop = () => {
    const q = heap[0], v = hd[0];
    const lq = heap.pop(), lv = hd.pop();
    if (heap.length) {
      heap[0] = lq; hd[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && hd[l] < hd[m]) m = l;
        if (r < heap.length && hd[r] < hd[m]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; [hd[m], hd[i]] = [hd[i], hd[m]];
        i = m;
      }
    }
    return [q, v];
  };
  for (const [q, v] of sources) if (v < d[q]) { d[q] = v; push(q, v); }
  const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  let guard = 0;
  while (heap.length && guard++ < 8 * N) {
    const [q, v] = pop();
    if (v > d[q]) continue;
    const i = q % nx, j = (q - i) / nx;
    for (const [di, dj, w] of D) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const r = b * nx + a;
      const nv = v + w * CELL * 0.5 * (cost[q] + cost[r]);
      if (nv < d[r]) { d[r] = nv; push(r, nv); }
    }
  }
  return d;
}

function sampleGrid(g, f, x, y) {
  const px = clamp((x - g.x0) / CELL, 0, g.nx - 1), py = clamp((y - g.y0) / CELL, 0, g.ny - 1);
  const i = Math.min(Math.floor(px), g.nx - 2), j = Math.min(Math.floor(py), g.ny - 2), fx = px - i, fy = py - j;
  const a = f[j * g.nx + i], b = f[j * g.nx + i + 1], c = f[(j + 1) * g.nx + i], d = f[(j + 1) * g.nx + i + 1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

// A block cut in strips (fields) along its longest side, each strip
// clipped from the polygon (Sutherland-Hodgman against two half-planes).
function stripes(poly, rnd) {
  let best = 0, ux = 1, uy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (L > best) { best = L; ux = (q[0] - p[0]) / L; uy = (q[1] - p[1]) / L; }
  }
  // strips run along the long side: cut across the perpendicular
  const vx = -uy, vy = ux;
  let t0 = Infinity, t1 = -Infinity;
  for (const p of poly) { const t = p[0] * vx + p[1] * vy; t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
  const clip = (pts, nx2, ny2, c) => {   // keep nx2 * x + ny2 * y >= c
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const da = a[0] * nx2 + a[1] * ny2 - c, db = b[0] * nx2 + b[1] * ny2 - c;
      if (da >= 0) out.push(a);
      if ((da >= 0) !== (db >= 0)) { const k = da / (da - db); out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]); }
    }
    return out;
  };
  let s0 = Infinity, s1 = -Infinity;
  for (const p of poly) { const t = p[0] * ux + p[1] * uy; s0 = Math.min(s0, t); s1 = Math.max(s1, t); }
  const out = [];
  let t = t0, guard = 0;
  while (t < t1 - 4 && guard++ < 64) {
    const w = 24 + 34 * rnd();
    const tb = Math.min(t1, t + w);
    let st = clip(poly, vx, vy, t);
    st = clip(st, -vx, -vy, -tb);
    // and across: a field is at most about 90 .. 220 m long
    let s = s0, g2 = 0;
    while (st.length >= 3 && s < s1 - 4 && g2++ < 32) {
      const sb = Math.min(s1, s + 90 + 130 * rnd());
      let f = clip(st, ux, uy, s);
      f = clip(f, -ux, -uy, -sb);
      if (f.length >= 3 && Math.abs(areaOf(f)) > 150) out.push(f.map((p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]));
      s = sb;
    }
    t = tb;
  }
  return out;
}

export function urbanForm(a) {
  const { W, H, blocks, lots, lotBlock } = a;
  const edge = clamp(+a.edge || 0, 0, 1);
  const nB = blocks.length, nL = lots.length;
  const keepBlock = new Uint8Array(nB).fill(1), keepLot = new Uint8Array(nL).fill(1), lotScale = new Float32Array(nL).fill(1);
  if (edge <= 0 || !nB) return { keepBlock, keepLot, lotScale, farms: [], form: { edge: 0, R: 0, cell: CELL, nuclei: [], urbanShare: 1 } };
  const seed = (a.seed >>> 0) ^ 0x51ed27;
  const rnd = mulberry(seed);
  const { g, cost, water, slope } = costGrid({ ...a, edge }, seed);
  const { nx, ny } = g;
  const cell = (x, y) => clamp(Math.round((y - g.y0) / CELL), 0, ny - 1) * nx + clamp(Math.round((x - g.x0) / CELL), 0, nx - 1);
  // the nearest dry cell to a point (a centre may fall in the water)
  const dry = (x, y) => {
    let q = cell(x, y);
    if (!water[q]) return q;
    let bd = Infinity, bq = q;
    for (let r = 0; r < nx * ny; r++) if (!water[r]) {
      const i = r % nx, j = (r - i) / nx;
      const d = (g.x0 + i * CELL - x) ** 2 + (g.y0 + j * CELL - y) ** 2;
      if (d < bd) { bd = d; bq = r; }
    }
    return bq;
  };
  const nuclei = [[W / 2, H / 2, 0]];
  for (const f of a.fields || []) if (f.type === 'radial') nuclei.push([f.x, f.y, 0.08 * Math.max(W, H)]);
  // outlying villages: on a main or major road, land, gentle, 0.32 .. 0.5
  // of the view diagonal from the centre; they start with a cost offset
  const diag = Math.hypot(W, H);
  const cands = [];
  for (const l of [...(a.roads.main || []), ...(a.roads.major || [])]) {
    for (let i = 0; i < l.length; i += Math.max(1, l.length >> 3)) {
      const [x, y] = l[i];
      const r = Math.hypot(x - W / 2, y - H / 2) / diag;
      const q = cell(x, y);
      if (r < 0.3 || r > 0.52 || water[q] || slope[q] > 0.6 * (a.grade || 0.22)) continue;
      cands.push([x, y]);
    }
  }
  const nV = Math.round(1 + 3.5 * edge * rnd());
  for (let k = 0; k < nV && cands.length; k++) {
    const c = cands.splice(Math.floor(rnd() * cands.length), 1)[0];
    if (nuclei.some((n) => Math.hypot(n[0] - c[0], n[1] - c[1]) < 0.18 * diag)) continue;
    nuclei.push([c[0], c[1], (0.18 + 0.1 * rnd()) * diag]);
  }
  const cd = dijkstra(g, cost, nuclei.map(([x, y, off]) => [dry(x, y), off]));
  // R: the quantile of cd over the dry cells of the view (the built share)
  const share = 1 - 0.7 * edge;
  const vals = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = g.x0 + i * CELL, y = g.y0 + j * CELL, q = j * nx + i;
    if (x < 0 || y < 0 || x > W || y > H || water[q] || !isFinite(cd[q])) continue;
    vals.push(cd[q]);
  }
  vals.sort((p, q) => p - q);
  const R = Math.max(CELL * 4, vals.length ? vals[Math.min(vals.length - 1, Math.floor(share * vals.length))] : diag * 0.4);
  const U = new Float32Array(nx * ny);
  for (let q = 0; q < nx * ny; q++) U[q] = isFinite(cd[q]) ? 1 / (1 + Math.exp((cd[q] - R) / (0.12 * R))) : 0;
  const uAt = (x, y) => sampleGrid(g, U, x, y);
  const grade = a.grade || 0.22;
  // blocks
  const farms = [];
  const bu = new Float32Array(nB);
  for (let b = 0; b < nB; b++) {
    const p = blocks[b];
    const c = cen(p);
    let u = uAt(c[0], c[1]);
    // the corners pull it a little: a block half in the city counts
    let uc = 0;
    for (const q of p) uc += uAt(q[0], q[1]);
    u = 0.6 * u + 0.4 * uc / p.length;
    u += (rnd() - 0.5) * 0.16 * edge;
    bu[b] = u;
    keepBlock[b] = u > 0.5 ? 1 : 0;
  }
  // lots: gaps and lower buildings at the fringe
  for (let i = 0; i < nL; i++) {
    const b = lotBlock[i];
    if (keepBlock[b] !== 1) { keepLot[i] = 0; continue; }
    const c = cen(lots[i]);
    const u = Math.max(uAt(c[0], c[1]), bu[b]);
    const pKeep = 1 - edge * 0.55 * (1 - smooth(0.5, 0.85, u));
    keepLot[i] = rnd() < pKeep ? 1 : 0;
    lotScale[i] = 1 - edge * 0.6 * (1 - smooth(0.45, 0.95, u));
  }
  // a block with no lot left: wild (its frame of roads stays)
  const has = new Uint8Array(nB);
  for (let i = 0; i < nL; i++) if (keepLot[i]) has[lotBlock[i]] = 1;
  let urban = 0;
  for (let b = 0; b < nB; b++) { if (keepBlock[b] === 1 && !has[b]) keepBlock[b] = 0; if (keepBlock[b] === 1) urban++; }
  // fields: the large faces of the main and major roads (a.superBlocks)
  // cut in strips; a strip stays where the land is farmland (0.03 < u <
  // 0.5, dry, gentle) and no urban block lies under its centre
  const urbanNear = nearPolys(blocks.filter((_, b) => keepBlock[b] === 1), 6);
  // a 6 m raster of the land the fields take, so no two fields overlap
  const FS = 6, fx0 = g.x0, fy0 = g.y0, fnx = Math.ceil(a.dom.w / FS) + 1, fny = Math.ceil(a.dom.h / FS) + 1;
  const taken = new Uint8Array(fnx * fny);
  const cellsOf = (p) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of p) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
    const out = [];
    for (let j = Math.max(0, Math.floor((y0 - fy0) / FS)); j <= Math.min(fny - 1, Math.ceil((y1 - fy0) / FS)); j++) {
      for (let i = Math.max(0, Math.floor((x0 - fx0) / FS)); i <= Math.min(fnx - 1, Math.ceil((x1 - fx0) / FS)); i++) {
        if (insidePoly(fx0 + i * FS, fy0 + j * FS, p)) out.push(j * fnx + i);
      }
    }
    return out;
  };
  for (const p of a.superBlocks || []) {
    if (p.length < 3 || Math.abs(areaOf(p)) < 2000) continue;
    for (const s of stripes(p, rnd)) {
      const c = cen(s), q = cell(c[0], c[1]);
      const u = uAt(c[0], c[1]) + (rnd() - 0.5) * 0.1;
      if (u <= 0.03 || u >= 0.5 || water[q] || slope[q] > 0.7 * grade || urbanNear(c[0], c[1])) continue;
      if (s.some((v) => { const qq = cell(v[0], v[1]); return water[qq] || slope[qq] > grade; })) continue;
      const cs = cellsOf(s);
      if (cs.some((k) => taken[k])) continue;
      for (const k of cs) taken[k] = 1;
      const r = rnd();
      farms.push({ poly: s, crop: r < 0.04 ? 5 : Math.floor(r * 5) % 5 });
    }
  }
  return {
    keepBlock, keepLot, lotScale, farms,
    form: { edge, R: Math.round(R), cell: CELL, nuclei: nuclei.map(([x, y]) => [Math.round(x), Math.round(y)]), urbanShare: +(urban / nB).toFixed(3) },
  };
}

// The runs of each line where near() holds, split at gaps; each run keeps
// the family of its line. Runs shorter than minLen m are dropped.
export function trimLines(lines, fam, near, minLen = 10) {
  const out = [], of = [];
  lines.forEach((l, li) => {
    if (l.length < 2) return;
    let run = [];
    const flush = () => {
      let L = 0;
      for (let i = 1; i < run.length; i++) L += Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]);
      if (run.length >= 2 && L >= minLen) { out.push(run); of.push(fam ? fam[li] : 0); }
      run = [];
    };
    for (let i = 0; i < l.length; i++) {
      const p = l[i];
      if (near(p[0], p[1])) {
        // the cut point between a far point and this one
        if (!run.length && i > 0) run.push(cutTo(l[i - 1], p, near));
        run.push(p);
      } else if (run.length) {
        run.push(cutTo(p, l[i - 1], near));
        flush();
      }
    }
    flush();
  });
  return { lines: out, fam: of };
}
// the point on segment far -> in nearest to far where near() holds (bisection)
function cutTo(far, inn, near) {
  let a = 0, b = 1;   // t along far -> inn: at a false, at b true
  for (let k = 0; k < 12; k++) {
    const m = (a + b) / 2;
    if (near(far[0] + (inn[0] - far[0]) * m, far[1] + (inn[1] - far[1]) * m)) b = m; else a = m;
  }
  return [Math.round((far[0] + (inn[0] - far[0]) * b) * 100) / 100, Math.round((far[1] + (inn[1] - far[1]) * b) * 100) / 100];
}

// A point query near a set of polygons: within r m of an edge, or inside.
export function nearPolys(polys, r) {
  const cellS = 32, grid = new Map();
  const key = (i, j) => i * 73856093 ^ j * 19349663;
  polys.forEach((p, k) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of p) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
    for (let i = Math.floor((x0 - r) / cellS); i <= Math.floor((x1 + r) / cellS); i++) for (let j = Math.floor((y0 - r) / cellS); j <= Math.floor((y1 + r) / cellS); j++) {
      const kk = key(i, j);
      if (!grid.has(kk)) grid.set(kk, []);
      grid.get(kk).push(k);
    }
  });
  const r2 = r * r;
  const segD2 = (x, y, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1;
    const t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / L, 0, 1);
    return (a[0] + dx * t - x) ** 2 + (a[1] + dy * t - y) ** 2;
  };
  return (x, y) => {
    const list = grid.get(key(Math.floor(x / cellS), Math.floor(y / cellS)));
    if (!list) return false;
    for (const k of list) {
      const p = polys[k];
      if (insidePoly(x, y, p)) return true;
      for (let i = 0; i < p.length; i++) if (segD2(x, y, p[i], p[(i + 1) % p.length]) <= r2) return true;
    }
    return false;
  };
}

// (mx, my) -> the crop of the farm strip there, or -1.
export function farmLookup(farms) {
  const cellS = 48, grid = new Map();
  const key = (i, j) => i * 73856093 ^ j * 19349663;
  farms.forEach((f, k) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of f.poly) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
    for (let i = Math.floor(x0 / cellS); i <= Math.floor(x1 / cellS); i++) for (let j = Math.floor(y0 / cellS); j <= Math.floor(y1 / cellS); j++) {
      const kk = key(i, j);
      if (!grid.has(kk)) grid.set(kk, []);
      grid.get(kk).push(k);
    }
  });
  return (x, y) => {
    const list = grid.get(key(Math.floor(x / cellS), Math.floor(y / cellS)));
    if (list) for (const k of list) if (insidePoly(x, y, farms[k].poly)) return farms[k].crop;
    return -1;
  };
}

// A mask (Uint8Array nx * ny, 1 = inside) of the polygons on a grid of
// step m over [x0, x0 + nx step] x [y0, y0 + ny step].
export function rasterise(polys, x0, y0, nx, ny, step) {
  const m = new Uint8Array(nx * ny);
  for (const p of polys) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const q of p) { a = Math.min(a, q[0]); b = Math.min(b, q[1]); c = Math.max(c, q[0]); d = Math.max(d, q[1]); }
    for (let j = Math.max(0, Math.floor((b - y0) / step)); j <= Math.min(ny - 1, Math.ceil((d - y0) / step)); j++) {
      for (let i = Math.max(0, Math.floor((a - x0) / step)); i <= Math.min(nx - 1, Math.ceil((c - x0) / step)); i++) {
        if (insidePoly(x0 + (i + 0.5) * step, y0 + (j + 0.5) * step, p)) m[j * nx + i] = 1;
      }
    }
  }
  return m;
}

// The boundary of a mask after a closing of r cells (streets between the
// blocks are filled, so the measure is of the built area, not of each
// block) and a hole fill: area (cells), perimeter (cell edges), ratio = perimeter /
// (2 sqrt(pi area)) (1 for a disc, about 1.13 for a square), and the
// box-count dimension of the boundary cells over box sizes 1..16.
export function boundaryStats(mask0, nx, ny, r = 2) {
  const dil = (src, rr) => {
    const out = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (!src[j * nx + i]) continue;
      for (let dj = -rr; dj <= rr; dj++) for (let di = -rr; di <= rr; di++) {
        const a = i + di, b = j + dj;
        if (a >= 0 && b >= 0 && a < nx && b < ny && di * di + dj * dj <= rr * rr) out[b * nx + a] = 1;
      }
    }
    return out;
  };
  const inv = (m) => m.map((v) => 1 - v);
  const mask = inv(dil(inv(dil(mask0, r)), r));
  // fill the holes (parks, squares): what the outside cannot reach is in
  {
    const out = new Uint8Array(nx * ny), st = [];
    for (let i = 0; i < nx; i++) { st.push(i, (ny - 1) * nx + i); }
    for (let j = 0; j < ny; j++) { st.push(j * nx, j * nx + nx - 1); }
    while (st.length) {
      const q = st.pop();
      if (out[q] || mask[q]) continue;
      out[q] = 1;
      const i = q % nx, j = (q - i) / nx;
      if (i > 0) st.push(q - 1); if (i < nx - 1) st.push(q + 1); if (j > 0) st.push(q - nx); if (j < ny - 1) st.push(q + nx);
    }
    for (let q = 0; q < nx * ny; q++) if (!out[q]) mask[q] = 1;
  }
  let area = 0, per = 0;
  const bd = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const q = j * nx + i;
    if (!mask[q]) continue;
    area++;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= ny || !mask[b * nx + a]) { per++; bd[q] = 1; }
    }
  }
  const xs = [], ys = [];
  for (const s of [1, 2, 4, 8, 16]) {
    const seen = new Set();
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (bd[j * nx + i]) seen.add(Math.floor(i / s) * 100003 + Math.floor(j / s));
    if (seen.size) { xs.push(Math.log(1 / s)); ys.push(Math.log(seen.size)); }
  }
  const mx = xs.reduce((p, q) => p + q, 0) / xs.length, my = ys.reduce((p, q) => p + q, 0) / ys.length;
  let num = 0, den = 0;
  for (let k = 0; k < xs.length; k++) { num += (xs[k] - mx) * (ys[k] - my); den += (xs[k] - mx) ** 2; }
  return { area, perimeter: per, ratio: area ? per / (2 * Math.sqrt(Math.PI * area)) : 0, dimension: den ? num / den : 0 };
}
