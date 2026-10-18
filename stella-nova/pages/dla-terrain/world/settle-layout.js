// ============================================================================
//  DLA TERRAIN  ·  world/settle-layout.js — the streets, buildings, lamps
//  and far patches of the settlements (package CITIES). DOM-free, no GPU.
// ----------------------------------------------------------------------------
//  buildSettlements(t, opts) runs world/settle-place.js (sites and roads),
//  then lays out each site, and packs everything for render/settlements.js.
//
//  THE LOOK of the City Generator (pages/map-generator): the wall colour
//  ramp by height (draw2d.js heightColour), the roof colours (draw2d.js
//  ROOF_COL), hip roofs on low buildings, plant rooms and setback tiers on
//  tall ones, a ragged edge with lower buildings and gaps at the fringe
//  (the idea of map-generator/edge.js). Its street generator (MapGenerator,
//  tensor field streamlines) takes about 1.5 s for one city, so the layout
//  here is a lighter one:
//    - the roads into the site are its main streets (ribbon development
//      along them, out to 1.35 r)
//    - districts: angle sectors round the centre (city 4, town 3, village
//      1), each a street grid at its own angle and spacing, warped by noise
//    - a street point stays where it is inside the ragged edge
//      r * (0.78 + 0.4 fbm(angle)), dry and under MAX_STREET_SLOPE
//    - buildings line both sides of each street: a footprint goes in where
//      the ground is dry and gentle, no street or building is under it
//      (a 2.5 m occupancy raster), and a falloff with the distance keeps it
//    - heights: villages 1 to 2 floors, towns 1 to 5 and a church, cities
//      towers in the core
//  Bridges get piers and deck beams (instances of the building box).
//
//  INSTANCE (INST_FLOATS 12 floats, 48 bytes; render/settlements.js reads
//  it as vertex attributes, step mode 'instance'):
//    0 x  1 baseY  2 z  3 yaw   (base: the top of the plinth, m)
//    4 w  5 d  6 h  7 rise      (w along yaw, w >= d; h wall height over
//                                baseY; rise the hip roof height, 0 flat)
//    8 footY  9 seed            (the walls start at footY, under the ground)
//    10 wall rgba8 (a: 0 windows, 1 no windows, 2 church)  11 roof rgba8
//  The roof colour of a flat roof is the concrete grey.
//
//  RIBBON VERTEX (RIB_FLOATS 8): x, y, z, nx, ny, nz, u (m along), kind
//    kind 0 main road, 1 track, 2 street, 3 bridge deck; v (across) is the
//    vertex order (left, centre, right). Triangles in rib.idx.
//
//  buildSettlements(t, opts) -> {
//    sites, roads (settle-place.js), inst Float32Array, nInst,
//    ranges [{ site, first, count, pFirst, pCount, x, z, y, r, lFirst, lCount }],
//    patches Float32Array (INST_FLOATS each, the far LOD), nPatch,
//    lamps Float32Array (x, y, z, k each), nLamp,
//    rib { v Float32Array, idx Uint32Array }, mask { n, data Uint8Array },
//    stats { buildings, streets km, roads km, bridges, ms } }
//  opts = { mode, size, seed, profile, maskN }
//
//  grep -n targets: "export function buildSettlements", "function layoutSite",
//  "function placeAlong", "function ribbon", "function farPatches",
//  "function maskOf", "export const INST_FLOATS", "export function packRGBA"
// ============================================================================

import { terrainHeightAt } from '../../../lib/dla-terrain.js';
import { heightColour, ROOF_COL } from '../../map-generator/draw2d.js';
import { siteSettlements, classify, mulberry, capsFor } from './settle-place.js';

export const INST_FLOATS = 12;
export const RIB_FLOATS = 8;
export const MAX_STREET_SLOPE = 0.22;
export const MAX_PAD_DROP = 3.5;    // m: the most a footprint may fall over its corners
const OCC = 2.5;                     // m: the occupancy raster cell
const FLAT_ROOF = [0.42, 0.42, 0.41];
const MATERIAL = [[0.86, 0.82, 0.72], [0.66, 0.64, 0.60], [0.62, 0.40, 0.31], [0.80, 0.74, 0.60]];   // plaster, stone, brick, sandstone

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

export function packRGBA(c, a = 0) {
  return (Math.round(clamp(c[0], 0, 1) * 255) | (Math.round(clamp(c[1], 0, 1) * 255) << 8) | (Math.round(clamp(c[2], 0, 1) * 255) << 16) | ((a & 255) << 24)) >>> 0;
}

function hash1(i, s) {
  let h = Math.imul((i | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(s | 0, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}
// 1D periodic fbm over an angle (the ragged edge of a site)
function fbmAngle(a, s) {
  let v = 0, amp = 0.5, tot = 0;
  for (let o = 0; o < 4; o++) {
    const f = 3 << o, x = (a / (2 * Math.PI)) * f;
    const i = Math.floor(x), u = x - i, w = u * u * (3 - 2 * u);
    const h0 = hash1(((i % f) + f) % f, s + o * 31), h1 = hash1((((i + 1) % f) + f) % f, s + o * 31);
    v += amp * (h0 + (h1 - h0) * w); tot += amp; amp *= 0.55;
  }
  return v / tot;
}
// 2D value noise (street warp)
function vnoise(x, z, s) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const h = (a, b) => hash1(a * 7919 + b * 104729, s);
  const a = h(i, j), b = h(i + 1, j), c = h(i, j + 1), d = h(i + 1, j + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

// ── the occupancy raster of one site ────────────────────────────────────
function occGrid(cx, cz, R) {
  const n = Math.ceil((2 * R) / OCC) + 2;
  return { x0: cx - R, z0: cz - R, n, a: new Uint8Array(n * n) };
}
const occIdx = (g, x, z) => {
  const i = Math.floor((x - g.x0) / OCC), j = Math.floor((z - g.z0) / OCC);
  return i < 0 || j < 0 || i >= g.n || j >= g.n ? -1 : j * g.n + i;
};
function occLine(g, pts, hw) {
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
    const m = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (OCC * 0.5)));
    for (let s = 0; s <= m; s++) {
      const x = ax + (bx - ax) * s / m, z = az + (bz - az) * s / m;
      const r = Math.ceil(hw / OCC);
      const ci = Math.floor((x - g.x0) / OCC), cj = Math.floor((z - g.z0) / OCC);
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= g.n || j >= g.n) continue;
        const px = g.x0 + (i + 0.5) * OCC, pz = g.z0 + (j + 0.5) * OCC;
        if ((px - x) ** 2 + (pz - z) ** 2 <= hw * hw) g.a[j * g.n + i] = 2;
      }
    }
  }
}
// an oriented rectangle: free (all cells 0 and in the grid), or mark it
function occRect(g, x, z, ux, uz, w, d, mark) {
  // a test looks at the inside (less 0.9 m), a mark covers 0.4 m more
  const m = mark ? 0.4 : -0.9;
  const vx = -uz, vz = ux, hw = w / 2 + m, hd = d / 2 + m;
  const ex = Math.abs(ux) * hw + Math.abs(vx) * hd, ez = Math.abs(uz) * hw + Math.abs(vz) * hd;
  const i0 = Math.floor((x - ex - g.x0) / OCC), i1 = Math.floor((x + ex - g.x0) / OCC);
  const j0 = Math.floor((z - ez - g.z0) / OCC), j1 = Math.floor((z + ez - g.z0) / OCC);
  if (i0 < 0 || j0 < 0 || i1 >= g.n || j1 >= g.n) return false;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const px = g.x0 + (i + 0.5) * OCC - x, pz = g.z0 + (j + 0.5) * OCC - z;
    const a = px * ux + pz * uz, b = px * vx + pz * vz;
    if (Math.abs(a) > hw || Math.abs(b) > hd) continue;
    if (mark) g.a[j * g.n + i] = 1; else if (g.a[j * g.n + i]) return false;
  }
  return true;
}

// ── streets of one site ─────────────────────────────────────────────────
function streetsOf(t, site, incoming, rnd, seed) {
  const { x: cx, z: cz, r, kind } = site;
  const edgeR = (ang) => r * (0.78 + 0.4 * fbmAngle(ang, seed));
  const nearIn = (x, z) => {
    let best = Infinity;
    for (const l of incoming) for (let k = 0; k < l.length; k += 2) best = Math.min(best, (l[k][0] - x) ** 2 + (l[k][1] - z) ** 2);
    return Math.sqrt(best);
  };
  const inside = (x, z) => {
    const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz);
    const lim = edgeR(Math.atan2(dz, dx));
    if (d > lim) {
      // ribbon development: out along the roads into the site
      if (d > 1.35 * r || nearIn(x, z) > 70) return false;
    }
    const c = classify(t, x, z);
    return !c.water && c.slope < MAX_STREET_SLOPE;
  };
  // the main direction: the first road into the site, else east
  let th0 = rnd() * Math.PI;
  if (incoming.length && incoming[0].length > 3) {
    const l = incoming[0], a = l[0], b = l[Math.min(3, l.length - 1)];
    th0 = Math.atan2(b[1] - a[1], b[0] - a[0]);
  }
  const nD = kind === 'city' ? 4 : kind === 'town' ? 3 : 1;
  const sp0 = kind === 'city' ? 74 : kind === 'town' ? 52 : 40;
  const streets = [];
  const a0 = rnd() * Math.PI * 2;
  for (let dI = 0; dI < nD; dI++) {
    const s0 = a0 + (dI / nD) * Math.PI * 2 + (rnd() - 0.5) * 0.4, s1 = a0 + ((dI + 1) / nD) * Math.PI * 2;
    const th = th0 + (nD > 1 ? (rnd() - 0.5) * 0.7 : 0);
    const sp = sp0 * (0.85 + 0.3 * rnd());
    const ux = Math.cos(th), uz = Math.sin(th), vx = -uz, vz = ux;
    const inSector = (x, z) => {
      if (nD === 1) return true;
      let a = Math.atan2(z - cz, x - cx) - s0;
      a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      return a < s1 - s0;
    };
    const ext = 1.4 * r;
    // a village: two or three lanes across the main road only
    const lanes = kind === 'village' ? [[0, -1], [1, -1], [1, 1]] : null;
    for (const dir of [0, 1]) {
      const K = Math.ceil(ext / sp);
      for (let k = -K; k <= K; k++) {
        if (lanes && !(dir === 1 && Math.abs(k) <= 1)) continue;
        if (rnd() < (kind === 'city' ? 0.06 : 0.14)) continue;
        const off = k * sp + (rnd() - 0.5) * sp * 0.2;
        let run = [];
        const flush = () => {
          if (run.length > 3) {
            let L = 0;
            for (let q = 1; q < run.length; q++) L += Math.hypot(run[q][0] - run[q - 1][0], run[q][1] - run[q - 1][1]);
            if (L > 30) streets.push({ pts: run, w: kind === 'city' && k % 3 === 0 ? 9 : kind === 'village' ? 4.5 : 6.5, kind: 2 });
          }
          run = [];
        };
        for (let s = -ext; s <= ext; s += 8) {
          const a = dir === 0 ? s : off, b = dir === 0 ? off : s;
          // warp: a gentle bend, more in villages
          const wa = (vnoise((cx + a) / 260, (cz + b) / 260, seed) - 0.5) * sp * (kind === 'village' ? 0.5 : 0.25);
          const x = cx + ux * a + vx * (b + (dir === 0 ? wa : 0)) + (dir === 1 ? ux * wa : 0);
          const z = cz + uz * a + vz * (b + (dir === 0 ? wa : 0)) + (dir === 1 ? uz * wa : 0);
          if (inSector(x, z) && inside(x, z)) run.push([x, z]); else flush();
        }
        flush();
      }
    }
  }
  return { streets, edgeR };
}

// ── buildings along a line ──────────────────────────────────────────────
function placeAlong(t, site, line, hw, occ, rnd, edgeR, out, seedBase, cap) {
  const { x: cx, z: cz, r, kind } = site;
  const city = kind === 'city', town = kind === 'town';
  let acc = 0;
  for (let k = 0; k < line.length - 1 && out.n < cap; k++) {
    const [ax, az] = line[k], [bx, bz] = line[k + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-3) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    acc += L;
    const dist0 = Math.hypot(ax - cx, az - cz);
    const core0 = Math.exp(-((dist0 / (0.38 * r)) ** 2));
    const front = city ? 11 + 9 * rnd() + 12 * core0 : town ? 10 + 6 * rnd() : 13 + 9 * rnd();
    if (acc < front) continue;
    acc = 0;
    for (const side of [-1, 1]) {
      if (out.n >= cap) break;
      const dist = dist0;
      const lim = edgeR(Math.atan2(az - cz, ax - cx));
      const core = core0;
      // the ragged fringe: fewer buildings past 0.55 of the edge
      const keep = 1 - 0.8 * smooth(0.55 * lim, 1.25 * lim, dist);
      if (rnd() > keep) continue;
      // w along the street (the frontage less a gap), d back from it
      let w = front - (city ? 1.0 + 1.5 * rnd() : 2.5 + 3 * rnd());
      let d = city ? 10 + 8 * rnd() + 14 * core : town ? 8 + 5 * rnd() : 7 + 4 * rnd();
      // a second, smaller try where the first does not fit (a corner, a
      // shallow block)
      for (let tryI = 0; tryI < 2; tryI++) {
      if (tryI === 1) { w *= 0.7; d *= 0.55; }
      const set = (city ? 2 : town ? 2.5 : 4) + (tryI ? 0 : rnd() * 2);
      const yx = ux, yz = uz, dd = d;
      const px = ax - ux * front * 0.5 + (-uz) * side * (hw + set + dd / 2), pz = az - uz * front * 0.5 + ux * side * (hw + set + dd / 2);
      // the ground under the corners
      const vx = -yz, vz = yx;
      let lo = Infinity, hi = -Infinity, wet = false;
      for (const [a, b] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5], [0, 0]]) {
        const qx = px + yx * a * w + vx * b * d, qz = pz + yz * a * w + vz * b * d;
        const c = classify(t, qx, qz);
        if (c.water || c.slope > MAX_STREET_SLOPE * 1.2) { wet = true; break; }
        const y = terrainHeightAt(t, qx, qz);
        lo = Math.min(lo, y); hi = Math.max(hi, y);
      }
      if (wet || hi - lo > MAX_PAD_DROP) continue;
      if (!occRect(occ, px, pz, yx, yz, w, d, false)) continue;
      occRect(occ, px, pz, yx, yz, w, d, true);
      tryI = 2;
      // height: floors by kind, the core of a city tall
      let floors;
      if (city) floors = 2 + Math.floor(rnd() * 3) + Math.floor(core * (6 + 26 * rnd() * rnd()));
      else if (town) floors = 1 + Math.floor(rnd() * 2) + Math.floor(core * 3 * rnd());
      else floors = 1 + (rnd() < 0.35 ? 1 : 0);
      const fringe = smooth(0.5 * lim, lim, dist);
      floors = Math.max(1, Math.round(floors * (1 - 0.5 * fringe)));
      const h = floors * 3.2 + 0.6 * rnd();
      const seed = seedBase + out.n;
      const mat = MATERIAL[Math.floor(hash1(seed, 3) * MATERIAL.length)];
      const wall = mix3(heightColour(h), mat, 0.55);
      const hip = h < 14;
      const roof = hip ? ROOF_COL[Math.floor(hash1(seed, 7) * ROOF_COL.length)] : FLAT_ROOF;
      // the ridge runs along the longer side: w >= d in the instance
      const swap = d > w;
      const W2 = swap ? d : w, D2 = swap ? w : d;
      const yaw = Math.atan2(yz, yx) + (swap ? Math.PI / 2 : 0);
      out.push(px, hi + 0.15, pz, yaw, W2, D2, h, hip ? Math.min(D2 * 0.5 * Math.tan((24 + 10 * hash1(seed, 5)) * Math.PI / 180), 5) : 0, lo - 1.5, seed, packRGBA(wall, 0), packRGBA(roof, 0));
      // tall: a setback tier (over 45 m) or a plant room (half of 14 .. 45 m)
      if (h > 45) {
        const f = 0.62 + 0.18 * hash1(seed, 9), k2 = 0.6 + 0.15 * hash1(seed, 11);
        out.data[out.n * INST_FLOATS - 6] = h * f;   // the body ends at f
        out.push(px, hi + 0.15 + h * f, pz, yaw, W2 * k2, D2 * k2, h * (1 - f), 0, hi + 0.15 + h * f - 0.2, seed + 1, packRGBA(wall, 0), packRGBA(FLAT_ROOF, 0));
      } else if (h >= 14 && hash1(seed, 13) < 0.5) {
        const k2 = 0.45 + 0.15 * hash1(seed, 15);
        out.push(px, hi + 0.15 + h, pz, yaw, W2 * k2, D2 * k2, 2.5 + 1.5 * hash1(seed, 17), 0, hi + 0.15 + h - 0.2, seed + 2, packRGBA(mix3(wall, [0, 0, 0], 0.2), 1), packRGBA(FLAT_ROOF, 0));
      }
      }
    }
  }
}

// a growable float list of instances
function instList(cap) {
  return {
    data: new Float32Array(Math.max(16, cap) * INST_FLOATS), n: 0,
    push(...v) {
      if ((this.n + 1) * INST_FLOATS > this.data.length) { const d = new Float32Array(this.data.length * 2); d.set(this.data); this.data = d; }
      const o = this.n * INST_FLOATS, u = new Uint32Array(this.data.buffer);
      for (let i = 0; i < 10; i++) this.data[o + i] = v[i];
      u[o + 10] = v[10]; u[o + 11] = v[11];
      this.n++;
    },
  };
}

// ── ribbons ─────────────────────────────────────────────────────────────
// a polyline [[x, z, y?]] of width w to the ribbon lists; y per point given
// (a road with its decks) or from the ground; bridge: a flag per point
function ribbon(t, line, w, kind, V, I, bridge = null) {
  const n = line.length;
  if (n < 2) return;
  const base = V.length / RIB_FLOATS;
  let u = 0;
  for (let k = 0; k < n; k++) {
    const p = line[Math.max(0, k - 1)], q = line[Math.min(n - 1, k + 1)];
    let tx = q[0] - p[0], tz = q[1] - p[1];
    const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
    if (k > 0) u += Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]);
    const sx = -tz * w / 2, sz = tx * w / 2;
    const deck = bridge && bridge[k];
    const yc = line[k][2] !== undefined ? line[k][2] : terrainHeightAt(t, line[k][0], line[k][1]);
    const yl = deck ? yc : Math.max(terrainHeightAt(t, line[k][0] + sx, line[k][1] + sz), yc - 1);
    const yr = deck ? yc : Math.max(terrainHeightAt(t, line[k][0] - sx, line[k][1] - sz), yc - 1);
    // the normal of the cross-section and the slope along
    const ny = 1, nx = -(yl - yr) / w * (-tz), nz = -(yl - yr) / w * tx;
    const nl = Math.hypot(nx, ny, nz);
    const kd = deck ? 3 : kind;
    V.push(line[k][0] + sx, yl, line[k][1] + sz, nx / nl, ny / nl, nz / nl, u, kd);
    V.push(line[k][0], yc, line[k][1], nx / nl, ny / nl, nz / nl, u, kd);
    V.push(line[k][0] - sx, yr, line[k][1] - sz, nx / nl, ny / nl, nz / nl, u, kd);
  }
  for (let k = 0; k < n - 1; k++) {
    const a = base + 3 * k, b = a + 3;
    I.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
  }
}

// ── far patches: the buildings binned in 48 m cells ─────────────────────
function farPatches(inst, first, count, yaw, out) {
  const C = 48, cells = new Map();
  for (let i = first; i < first + count; i++) {
    const o = i * INST_FLOATS, d = inst;
    const k = Math.floor(d[o] / C) * 100003 + Math.floor(d[o + 2] / C);
    let c = cells.get(k);
    if (!c) { c = { x: 0, z: 0, by: 0, fy: Infinity, h: 0, a: 0, n: 0, wall: 0, roof: 0 }; cells.set(k, c); }
    const a = d[o + 4] * d[o + 5];
    c.x += d[o] * a; c.z += d[o + 2] * a; c.by += d[o + 1] * a; c.h += (d[o + 1] + d[o + 6]) * a; c.a += a; c.n++;
    c.fy = Math.min(c.fy, d[o + 8]);
    if (!c.wall) { const u = new Uint32Array(d.buffer); c.wall = u[o + 10]; c.roof = u[o + 11]; }
  }
  for (const c of cells.values()) {
    if (c.n < 2) continue;
    const x = c.x / c.a, z = c.z / c.a, by = c.by / c.a, top = c.h / c.a;
    const s = Math.min(44, Math.sqrt(c.a) * 1.15);
    out.push(x, by, z, yaw, s, s * 0.9, Math.max(3, top - by), 0, c.fy, c.n, c.wall, c.roof);
  }
}

// ── the settlement mask (VEG, GROUND): 255 under streets and buildings,
// 110 on the settled ground inside the edge
function maskOf(t, M, sites, edgeFns, streetsAll, inst, nInst) {
  const a = new Uint8Array(M * M), ws = t.worldSize, o = -ws / 2, c = ws / M;
  const put = (x, z, v) => { const i = Math.floor((x - o) / c), j = Math.floor((z - o) / c); if (i >= 0 && j >= 0 && i < M && j < M && a[j * M + i] < v) a[j * M + i] = v; };
  sites.forEach((s, k) => {
    const e = edgeFns[k];
    const r = Math.ceil(1.1 * s.r / c);
    const ci = Math.floor((s.x - o) / c), cj = Math.floor((s.z - o) / c);
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const x = o + (ci + di + 0.5) * c, z = o + (cj + dj + 0.5) * c;
      if (Math.hypot(x - s.x, z - s.z) < 0.9 * e(Math.atan2(z - s.z, x - s.x))) put(x, z, 110);
    }
  });
  for (const st of streetsAll) for (const p of st.pts) put(p[0], p[1], 255);
  for (let i = 0; i < nInst; i++) put(inst[i * INST_FLOATS], inst[i * INST_FLOATS + 2], 255);
  return { n: M, data: a };
}

export function buildSettlements(t0, opts = {}) {
  const t = t0 && t0.cpu ? t0.cpu : t0;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const ms0 = now();
  const caps = capsFor(opts.profile || 'desktop');
  const placed = siteSettlements(t, opts);
  const { sites, roads } = placed;
  const rnd = mulberry(((opts.seed >>> 0) || 1) * 2654435761 + 17);
  const out = instList(4096), V = [], I = [], lamps = [], patches = instList(512);
  const ranges = [], edgeFns = [], streetsAll = [];
  // building budget per site by its area
  const areaSum = sites.reduce((a, s) => a + s.r * s.r, 0) || 1;
  for (const s of sites) {
    const seed = (s.id + 1) * 7919 + ((opts.seed >>> 0) || 1);
    // the roads into the site, as point lists near it
    const incoming = [];
    for (const rd of roads) {
      if (rd.a !== s.id && rd.b !== s.id) continue;
      const l = [];
      for (let k = 0; k < rd.pts.length; k += 3) {
        const x = rd.pts[k], z = rd.pts[k + 2];
        if (Math.hypot(x - s.x, z - s.z) < 1.35 * s.r) l.push([x, z]);
      }
      if (l.length > 2) incoming.push(rd.a === s.id ? l : l.reverse());
    }
    const { streets, edgeR } = streetsOf(t, s, incoming, rnd, seed);
    edgeFns.push(edgeR);
    const occ = occGrid(s.x, s.z, 1.5 * s.r + 60);
    for (const l of incoming) occLine(occ, l, 4.5);
    for (const st of streets) occLine(occ, st.pts, st.w / 2);
    const first = out.n;
    const cap = Math.min(caps.buildings, first + Math.ceil(caps.buildings * (s.r * s.r) / areaSum));
    // the main streets first (ribbon development), then the grid
    for (const l of incoming) placeAlong(t, s, l, 4, occ, rnd, edgeR, out, seed * 131, cap);
    for (const st of streets) placeAlong(t, s, st.pts, st.w / 2, occ, rnd, edgeR, out, seed * 131, cap);
    // a church near the centre of a town or a village
    if (s.kind !== 'city' && out.n < caps.buildings) {
      for (let k = 0; k < 40; k++) {
        const a = rnd() * Math.PI * 2, d = rnd() * 0.3 * s.r;
        const x = s.x + Math.cos(a) * d, z = s.z + Math.sin(a) * d, yaw = rnd() * Math.PI;
        const ux = Math.cos(yaw), uz = Math.sin(yaw);
        const c = classify(t, x, z);
        if (c.water || c.slope > 0.12 || classify(t, x + ux * 12, z + uz * 12).water || classify(t, x - ux * 10, z - uz * 10).water || !occRect(occ, x, z, ux, uz, 26, 12, false)) continue;
        occRect(occ, x, z, ux, uz, 26, 12, true);
        const y = terrainHeightAt(t, x, z), sd = seed * 977;
        out.push(x, y + 0.15, z, yaw, 20, 10, 9, 5, y - 2, sd, packRGBA(MATERIAL[1], 2), packRGBA(ROOF_COL[1], 0));
        const tx = x + ux * 12, tz = z + uz * 12;
        out.push(tx, y + 0.15, tz, yaw, 6.5, 6.5, 20 + 10 * rnd(), 7, y - 2, sd + 1, packRGBA(MATERIAL[1], 2), packRGBA(ROOF_COL[1], 0));
        break;
      }
    }
    streetsAll.push(...streets);
    for (const st of streets) ribbon(t, st.pts, st.w, 2, V, I);
    // lamps: along the streets and the main streets, 32 m apart
    const lFirst = lamps.length / 4;
    const lampCap = Math.ceil(caps.lamps * (s.r * s.r) / areaSum);
    let nl = 0;
    for (const l of [...incoming, ...streets.map((q) => q.pts)]) {
      for (let k = 0; k < l.length && nl < lampCap; k += 4) {
        const x = l[k][0], z = l[k][1];
        lamps.push(x, terrainHeightAt(t, x, z) + 5.5, z, s.kind === 'city' ? 1 : 0.7);
        nl++;
      }
    }
    const pFirst = patches.n;
    farPatches(out.data, first, out.n - first, Math.atan2(incoming.length && incoming[0].length > 1 ? incoming[0][1][1] - incoming[0][0][1] : 0, incoming.length && incoming[0].length > 1 ? incoming[0][1][0] - incoming[0][0][0] : 1), patches);
    ranges.push({ site: s.id, first, count: out.n - first, pFirst, pCount: patches.n - pFirst, lFirst, lCount: nl, x: s.x, z: s.z, y: s.y, r: s.r });
  }
  // the roads between the sites, with their bridges
  let bridges = 0, roadKm = 0, streetKm = 0;
  for (const rd of roads) {
    const n = rd.pts.length / 3;
    const line = [], deck = new Uint8Array(n);
    for (let k = 0; k < n; k++) line.push([rd.pts[3 * k], rd.pts[3 * k + 2], rd.pts[3 * k + 1]]);
    for (const [a, b] of rd.bridges) {
      bridges++;
      for (let k = a; k <= b; k++) deck[k] = 1;
      // piers and deck beams (box instances): a beam per step, a pier at
      // every second inner point
      for (let k = a; k < b; k++) {
        const p = line[k], q = line[k + 1];
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (L < 0.5) continue;
        const yaw = Math.atan2(q[1] - p[1], q[0] - p[0]);
        const ym = Math.min(p[2], q[2]);
        out.push((p[0] + q[0]) / 2, ym - 1.1, (p[1] + q[1]) / 2, yaw, L + 0.4, rd.w + 0.8, 1.0, 0, ym - 1.1, 0, packRGBA([0.55, 0.53, 0.50], 1), packRGBA([0.5, 0.49, 0.47], 0));
        if (k > a && k < b && (k - a) % 2 === 0) {
          const g = terrainHeightAt(t, p[0], p[1]);
          if (p[2] - g > 2) out.push(p[0], g - 3, p[1], yaw, 2.2, Math.min(rd.w, 4), p[2] - 1.1 - (g - 3), 0, g - 3, 0, packRGBA([0.52, 0.50, 0.47], 1), packRGBA([0.5, 0.49, 0.47], 0));
        }
      }
    }
    ribbon(t, line, rd.w, rd.kind === 'main' ? 0 : 1, V, I, deck);
    roadKm += rd.len / 1000;
  }
  for (const st of streetsAll) for (let k = 1; k < st.pts.length; k++) streetKm += Math.hypot(st.pts[k][0] - st.pts[k - 1][0], st.pts[k][1] - st.pts[k - 1][1]) / 1000;
  const nInst = out.n;
  const mask = maskOf(t, opts.maskN || 512, sites, edgeFns, streetsAll, out.data, nInst);
  return {
    sites, roads,
    inst: out.data.slice(0, nInst * INST_FLOATS), nInst,
    patches: patches.data.slice(0, patches.n * INST_FLOATS), nPatch: patches.n,
    lamps: new Float32Array(lamps), nLamp: lamps.length / 4,
    ranges,
    rib: { v: new Float32Array(V), idx: new Uint32Array(I) },
    streets: streetsAll.map((s) => ({ w: s.w, pts: s.pts })),
    mask,
    stats: { buildings: nInst, streetsKm: +streetKm.toFixed(1), roadsKm: +roadKm.toFixed(1), bridges, ms: Math.round(now() - ms0), placeMs: placed.ms },
  };
}
