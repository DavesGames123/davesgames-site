// mesh3d.js — the 3D city as GPU buffers, and the STL export. No DOM, no
// GPU: worker.js, main.js and tests.mjs use it.
//
// buildMesh(city, tl) -> mesh = {
//   vertices: ArrayBuffer (STRIDE bytes per vertex), indices: Uint32Array,
//   ranges: { opaque: [first, count], buildings: [first, count], roads: [first, count] }
//     (index ranges: opaque = ground, water, parks, blocks, buildings;
//      buildings = the shadow casters; roads = drawn after, no depth write)
//   seaCentre, seaR, half: [hx, hy] of the city view, domain, ext, tallest, transfer }
// fieldLines(city, fieldAt) -> Float32Array line list of the field crosses
// The playback times of playback.js are in the vertices, so the shader
// grows the city with one uniform (the time T) and no re-upload.
//
// World frame: x east, y north, z up, metres; map (x, y down) -> (x - w/2, h/2 - y).
//
// VERTEX (STRIDE 52 bytes)
//   0  float32x3  position (kinds 2, 3: z is 0 at the foot, 1 at the top)
//  12  snorm8x4   normal xyz, 0
//  16  unorm8x4   albedo rgb, roof 1 / wall 0
//  20  float32x4  anim: t0, dur, s (road: share of length; wall: u along the wall), kind
//  36  float32x4  ext: building (h, t0 rise, dur rise, 0); sea (cx, cy, R, 0)
// KINDS 0 ground (static), 1 road, 2 block (rises to BLOCK_H), 3 building
//   (a pad when its lot shows, then it rises), 4 sea (a disc reveal from the
//   coast), 5 park (fades in), 6 river (fades in, water shading)
//
// FLAT LAYERS (z, m): ground 0, river 0.06, sea 0.08, park 0.12, road 0.2,
// field 0.3, block top 0.6, building roofs 0.6 + 0.5 or more. Each layer
// has its own z, so no two coplanar faces overlap (tests.mjs checks it).
// Building footprints are the lots scaled 0.35 m in about their centroid,
// so two buildings never share a wall plane.
//
// grep: export const STRIDE  export const Z  export function buildMesh  export function toSTL
//       export function earcut  export function fieldLines  function extendSea  function ribbon  function prism

import { heightColour } from './draw2d.js';
import { prog } from './playback.js';

export const STRIDE = 52;
export const Z = { ground: 0, river: 0.06, sea: 0.08, park: 0.12, road: 0.2, field: 0.3, block: 0.6, pad: 0.5 };
export const ROAD_W = { main: 10, major: 7, minor: 3.6, coast: 10, river: 7 };
const ROAD_COL = { main: [0.86, 0.72, 0.46], major: [0.66, 0.64, 0.60], minor: [0.44, 0.45, 0.47], coast: [0.86, 0.72, 0.46], river: [0.66, 0.64, 0.60] };
const COL = { ground: [0.25, 0.255, 0.26], block: [0.46, 0.46, 0.44], park: [0.24, 0.36, 0.19], sea: [0.07, 0.17, 0.22], river: [0.08, 0.20, 0.26] };
const INSET = 0.35;

// ─── triangulation ──────────────────────────────────────────────────────────
// Ear clipping for a simple polygon [[x, y], ..] in either winding.
// Returns triangle indices into the input (counter-clockwise in x/y).
function signedArea(p) {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] - p[i][0]) * (p[j][1] + p[i][1]);
  return a / 2;
}
export function earcut(p) {
  const n = p.length;
  if (n < 3) return [];
  const idx = [];
  const ccw = signedArea(p) > 0;
  const V = [];
  for (let i = 0; i < n; i++) V.push(ccw ? i : n - 1 - i);
  const cross = (a, b, c) => (p[b][0] - p[a][0]) * (p[c][1] - p[a][1]) - (p[b][1] - p[a][1]) * (p[c][0] - p[a][0]);
  const inTri = (a, b, c, q) => cross(a, b, q) >= 0 && cross(b, c, q) >= 0 && cross(c, a, q) >= 0;
  let guard = 0, m = V.length, i = 0;
  while (m > 3 && guard < 4 * n * n) {
    guard++;
    const a = V[(i + m - 1) % m], b = V[i % m], c = V[(i + 1) % m];
    const cr = cross(a, b, c);
    let ear = cr > 0;
    if (ear) {
      for (let k = 0; k < m; k++) {
        const q = V[k];
        if (q === a || q === b || q === c) continue;
        if ((p[q][0] === p[a][0] && p[q][1] === p[a][1]) || (p[q][0] === p[c][0] && p[q][1] === p[c][1])) continue;
        if (inTri(a, b, c, q)) { ear = false; break; }
      }
    } else if (Math.abs(cr) < 1e-12) {
      V.splice(i % m, 1); m--;   // a collinear or repeated point: drop it
      continue;
    }
    if (ear) {
      idx.push(a, b, c);
      V.splice(i % m, 1); m--;
      i = Math.max(0, (i - 1)) % m;
    } else i = (i + 1) % m;
  }
  if (m === 3) idx.push(V[0], V[1], V[2]);
  return idx;
}

// ─── writer ─────────────────────────────────────────────────────────────────
function writer(capV) {
  let buf = new ArrayBuffer(capV * STRIDE);
  let f32 = new Float32Array(buf), i8 = new Int8Array(buf), u8 = new Uint8Array(buf);
  let idx = new Uint32Array(capV * 2);
  let nv = 0, ni = 0;
  const grow = (v, i) => {
    if (v > buf.byteLength / STRIDE) {
      const nb = new ArrayBuffer(Math.max(v, (buf.byteLength / STRIDE) * 2) * STRIDE);
      new Uint8Array(nb).set(u8);
      buf = nb; f32 = new Float32Array(buf); i8 = new Int8Array(buf); u8 = new Uint8Array(buf);
    }
    if (i > idx.length) { const ni2 = new Uint32Array(Math.max(i, idx.length * 2)); ni2.set(idx); idx = ni2; }
  };
  return {
    get nv() { return nv; }, get ni() { return ni; },
    reserve(v, i) { grow(nv + v, ni + i); },
    v(x, y, z, nx, ny, nz, col, roof, a0, a1, a2, kind, e0 = 0, e1 = 0, e2 = 0) {
      const o = nv * STRIDE, f = o / 4;
      f32[f] = x; f32[f + 1] = y; f32[f + 2] = z;
      i8[o + 12] = Math.round(nx * 127); i8[o + 13] = Math.round(ny * 127); i8[o + 14] = Math.round(nz * 127); i8[o + 15] = 0;
      u8[o + 16] = Math.round(col[0] * 255); u8[o + 17] = Math.round(col[1] * 255); u8[o + 18] = Math.round(col[2] * 255); u8[o + 19] = roof ? 255 : 0;
      f32[f + 5] = a0; f32[f + 6] = a1; f32[f + 7] = a2; f32[f + 8] = kind;
      f32[f + 9] = e0; f32[f + 10] = e1; f32[f + 11] = e2; f32[f + 12] = 0;
      return nv++;
    },
    t(a, b, c) { idx[ni++] = a; idx[ni++] = b; idx[ni++] = c; },
    done() { return { vertices: buf.slice(0, nv * STRIDE), indices: idx.slice(0, ni) }; },
  };
}

// a flat polygon at height z (pts already in world x, y)
function flat(W, pts, z, col, kind, t0, dur, e = [0, 0, 0]) {
  const tri = earcut(pts);
  if (!tri.length) return;
  W.reserve(pts.length, tri.length);
  const base = W.nv;
  for (const q of pts) W.v(q[0], q[1], z, 0, 0, 1, col, 1, t0, dur, 0, kind, e[0], e[1], e[2]);
  for (let i = 0; i < tri.length; i += 3) W.t(base + tri[i], base + tri[i + 1], base + tri[i + 2]);
}

// a prism over pts (counter-clockwise); z of the vertices is 0 (foot) or 1
// (top): the shader scales it (kinds 2 and 3)
function prism(W, pts, col, kind, t0, dur, e = [0, 0, 0]) {
  const tri = earcut(pts);
  if (!tri.length) return 0;
  const n = pts.length;
  W.reserve(n + 4 * n, tri.length + 6 * n);
  const base = W.nv;
  for (const q of pts) W.v(q[0], q[1], 1, 0, 0, 1, col, 1, t0, dur, 0, kind, e[0], e[1], e[2]);
  for (let i = 0; i < tri.length; i += 3) W.t(base + tri[i], base + tri[i + 1], base + tri[i + 2]);
  let u = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    const nx = dy / L, ny = -dx / L;    // outward for a counter-clockwise ring
    const q0 = W.v(a[0], a[1], 0, nx, ny, 0, col, 0, t0, dur, u, kind, e[0], e[1], e[2]);
    const q1 = W.v(b[0], b[1], 0, nx, ny, 0, col, 0, t0, dur, u + L, kind, e[0], e[1], e[2]);
    const q2 = W.v(b[0], b[1], 1, nx, ny, 0, col, 0, t0, dur, u + L, kind, e[0], e[1], e[2]);
    const q3 = W.v(a[0], a[1], 1, nx, ny, 0, col, 0, t0, dur, u, kind, e[0], e[1], e[2]);
    W.t(q0, q1, q2); W.t(q0, q2, q3);
    u += L;
  }
  return 1;
}

// a road ribbon of width w along line l (world x, y), s = share of length
function ribbon(W, l, w, col, t0, dur) {
  const n = l.length;
  if (n < 2) return;
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]));
  const L = cum[n - 1] || 1;
  W.reserve(2 * n, 6 * (n - 1));
  const base = W.nv;
  const h = w / 2;
  for (let i = 0; i < n; i++) {
    const p = l[Math.max(0, i - 1)], q = l[Math.min(n - 1, i + 1)];
    let dx = q[0] - p[0], dy = q[1] - p[1];
    const d = Math.hypot(dx, dy) || 1;
    dx /= d; dy /= d;
    let nx = -dy, ny = dx, k = 1;
    if (i > 0 && i < n - 1) {
      // miter: the offset grows as 1 / cos(half the turn), at most 2x
      const ax = l[i][0] - l[i - 1][0], ay = l[i][1] - l[i - 1][1], al = Math.hypot(ax, ay) || 1;
      const c = (-ay / al) * nx + (ax / al) * ny;
      k = 1 / Math.max(0.5, c);
    }
    nx *= h * k; ny *= h * k;
    const s = cum[i] / L;
    W.v(l[i][0] + nx, l[i][1] + ny, Z.road, 0, 0, 1, col, 1, t0, dur, s, 1);
    W.v(l[i][0] - nx, l[i][1] - ny, Z.road, 0, 0, 1, col, 1, t0, dur, s, 1);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = base + 2 * i;
    W.t(a, a + 1, a + 3); W.t(a, a + 3, a + 2);
  }
}

// The sea polygon reaches the edge of the generated area. Its points on the
// edge move far out, so the sea runs to the horizon as the land does.
function extendSea(sea, d, ext) {
  const eps = 0.6;
  return sea.map(([x, y]) => {
    let X = x, Y = y;
    if (x <= d.x + eps) X = x - ext;
    if (x >= d.x + d.w - eps) X = x + ext;
    if (y <= d.y + eps) Y = y - ext;
    if (y >= d.y + d.h - eps) Y = y + ext;
    return [X, Y];
  });
}

const cen = (p) => { let x = 0, y = 0; for (const q of p) { x += q[0]; y += q[1]; } return [x / p.length, y / p.length]; };
function inset(p, d) {
  const c = cen(p);
  let r = 0;
  for (const q of p) r = Math.max(r, Math.hypot(q[0] - c[0], q[1] - c[1]));
  const k = r > 3 * d ? 1 - d / r : 0.85;
  return p.map((q) => [c[0] + (q[0] - c[0]) * k, c[1] + (q[1] - c[1]) * k]);
}
const ccwOf = (p) => (signedArea(p) > 0 ? p : p.slice().reverse());

export function buildMesh(city, tl) {
  const cx = city.view.w / 2, cy = city.view.h / 2;
  const T = (p) => [p[0] - cx, cy - p[1]];
  const d = city.domain;
  const dW = { x: d.x - cx, y: cy - (d.y + d.h), w: d.w, h: d.h };   // domain in world x, y
  const ext = Math.max(d.w, d.h) * 3;
  const W = writer(1 << 16);

  // ── opaque: ground, water, parks, blocks ──
  const g = [[dW.x - ext, dW.y - ext], [dW.x + dW.w + ext, dW.y - ext], [dW.x + dW.w + ext, dW.y + dW.h + ext], [dW.x - ext, dW.y + dW.h + ext]];
  flat(W, g, Z.ground, COL.ground, 0, 0, 0);
  if (city.river.length > 2 && tl.river) flat(W, ccwOf(city.river.map(T)), Z.river, COL.river, 6, tl.river[0], tl.river[1]);
  let seaCentre = [0, 0], seaR = 1;
  if (city.sea.length > 2 && tl.coast) {
    const mid = city.coastline.length ? T(city.coastline[city.coastline.length >> 1]) : [0, 0];
    seaCentre = mid; seaR = Math.hypot(d.w, d.h);
    const dMap = { x: d.x, y: d.y, w: d.w, h: d.h };
    flat(W, ccwOf(extendSea(city.sea, dMap, ext).map(T)), Z.sea, COL.sea, 4, tl.coast[0], tl.coast[1], [mid[0], mid[1], seaR]);
  }
  city.parks.forEach((p, i) => flat(W, ccwOf(p.map(T)), Z.park, COL.park, 5, tl.parks[2 * i], tl.parks[2 * i + 1]));
  city.blocks.forEach((b, i) => prism(W, ccwOf(b.map(T)), COL.block, 2, tl.blocks[2 * i], tl.blocks[2 * i + 1]));
  // ── buildings (the shadow casters) ──
  const bFirst = W.ni;
  let tallest = 0;
  city.lots.forEach((l, i) => {
    const h = city.buildings[i].h;
    tallest = Math.max(tallest, h);
    const col = heightColour(h);
    prism(W, ccwOf(inset(l.map(T), INSET)), col, 3, tl.lots[2 * i], tl.lots[2 * i + 1], [h, tl.buildings[2 * i], tl.buildings[2 * i + 1]]);
  });
  const bEnd = W.ni;
  // ── roads, minor first, so the main roads draw on top ──
  for (const cls of ['minor', 'river', 'major', 'coast', 'main']) {
    const a = tl.roads[cls] || [];
    city.roads[cls].forEach((l, i) => ribbon(W, l.map(T), ROAD_W[cls], ROAD_COL[cls], a[2 * i] || 0, a[2 * i + 1] || 1e-3));
  }
  const rEnd = W.ni;
  const out = W.done();

  return {
    vertices: out.vertices, indices: out.indices,
    ranges: { opaque: [0, bEnd], buildings: [bFirst, bEnd - bFirst], roads: [bEnd, rEnd - bEnd] },
    seaCentre, seaR, half: [cx, cy], domain: dW, ext, tallest,
    transfer: [out.vertices, out.indices.buffer],
  };
}

// Tensor field crosses for the 3D view: a line list (x, y, z per end) of a
// cross every `step` m along the two field directions, off the sea.
// fieldAt is gen.js fieldSampler(city) (map coordinates, y down).
export function fieldLines(city, fieldAt, step = 24) {
  const cx = city.view.w / 2, cy = city.view.h / 2, d = city.domain;
  const out = [];
  const hl = step * 0.36;
  for (let y = d.y + step / 2; y < d.y + d.h; y += step) {
    for (let x = d.x + step / 2; x < d.x + d.w; x += step) {
      const v = fieldAt(x, y);
      if (!v) continue;
      const X = x - cx, Y = cy - y, ux = v[0], uy = -v[1];
      out.push(X - ux * hl, Y - uy * hl, Z.field, X + ux * hl, Y + uy * hl, Z.field);
      out.push(X + uy * hl, Y - ux * hl, Z.field, X - uy * hl, Y + ux * hl, Z.field);
    }
  }
  return new Float32Array(out);
}

// ─── STL ────────────────────────────────────────────────────────────────────
// Binary STL of the finished city: a base plate (2 m), the blocks and the
// buildings, in metres, z up.
export function toSTL(city) {
  const cx = city.view.w / 2, cy = city.view.h / 2;
  const T = (p) => [p[0] - cx, cy - p[1]];
  const tris = [];
  const solid = (pts, z0, z1) => {
    const p = ccwOf(pts);
    const t = earcut(p);
    for (let i = 0; i < t.length; i += 3) {
      const a = p[t[i]], b = p[t[i + 1]], c = p[t[i + 2]];
      tris.push([0, 0, 1, a[0], a[1], z1, b[0], b[1], z1, c[0], c[1], z1]);
      tris.push([0, 0, -1, a[0], a[1], z0, c[0], c[1], z0, b[0], b[1], z0]);
    }
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      const nx = dy / L, ny = -dx / L;
      tris.push([nx, ny, 0, a[0], a[1], z0, b[0], b[1], z0, b[0], b[1], z1]);
      tris.push([nx, ny, 0, a[0], a[1], z0, b[0], b[1], z1, a[0], a[1], z1]);
    }
  };
  const v = city.view;
  solid([T([0, 0]), T([v.w, 0]), T([v.w, v.h]), T([0, v.h])], -2, 0);
  for (const b of city.blocks) solid(b.map(T), 0, Z.block);
  city.lots.forEach((l, i) => solid(inset(l.map(T), INSET), Z.block, Z.block + city.buildings[i].h));
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const dv = new DataView(buf);
  const head = 'City Generator, davesgames.io. Streets and lots: MapGenerator by ProbableTrain, LGPL-3.0';
  for (let i = 0; i < 80; i++) dv.setUint8(i, i < head.length ? head.charCodeAt(i) : 32);
  dv.setUint32(80, tris.length, true);
  let o = 84;
  for (const t of tris) {
    for (let k = 0; k < 12; k++) { dv.setFloat32(o, t[k], true); o += 4; }
    dv.setUint16(o, 0, true); o += 2;
  }
  return buf;
}

// For the tests: the visible state of building i at time T.
export function buildingAt(tl, i, T, h) {
  const shown = prog(tl.lots, i, T) > 0;
  const p = prog(tl.buildings, i, T);
  const e = p * p * (3 - 2 * p);
  return { shown, top: Z.block + (shown ? Z.pad + (h - Z.pad) * e : 0) };
}
