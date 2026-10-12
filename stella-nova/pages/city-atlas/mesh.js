// mesh.js — building mesh and building height raster from the decoded city
// (data.js buildingsOf). No DOM, no GPU: worker.js and tests.mjs use it.
//
// buildMesh(b, opts) -> { vertices: ArrayBuffer (24 bytes per vertex),
// indices: Uint32Array, count, tallest, lod, forms } in the layout of
// shaders/buildings.wgsl. opts = { detail: 1 (desktop) or 0 (coarse
// pointer: no rooftop units and no tiers), lat: city latitude (warm cities
// get render and stone, not brick), debug: also return tris, per triangle
// (building, part, cx, cy) for tests.mjs }.
// The buildings go into the buffers largest first, so the renderer can draw
// a prefix of the index buffer when the small ones are under 2 px (lod).
//
// Vertex layout:
//   0  int16 x, y            0.5 m units
//   4  int16 z above base    0.1 m
//   6  int16 top             0.1 m: top of the facade (roof or eave), for the floors
//   8  int16 base            0.1 m
//  10  int16 height          0.1 m
//  12  int8  normal x, y, z, 0   (snorm)
//  16  uint8 use, random, part, style
//  20  uint16 u, run         0.25 m: distance along the facade run, run length
// part: 0 wall, 1 flat roof or ledge, 2 pitched roof, 3 rooftop unit wall,
//       4 rooftop unit top.
// style: material (low 3 bits: 0 glass, 1 concrete, 2 brick, 3 stone,
//        4 render) + 16 shopfront ground floor + 32 x pitched roof tone
//        (0 terracotta, 1 slate, 2 brown, 3 dark grey) + 128 height estimated.
//
// Forms, from the footprint, height and use only (the data has no roof tags):
//   flat    all walls rise to a parapet above the roof; the stored roof
//           triangles; rooftop units (boxes in the incircle of the largest
//           roof triangles, or one plant room at the centroid of a convex
//           roof), so every unit is inside the footprint
//   pitched one ring of 4 corners near 90 deg, 30..900 m2, up to 22 m:
//           a gable or a hip roof on the exact corners (the ridge on the
//           long axis); the building height is the ridge height
//   tiered  a convex tower of 70 m or more with no part on top: two or
//           three tiers, each a copy of the footprint scaled about its
//           centroid, so each tier is inside the one below
// A facade run is a part of a ring between corners (turn over 25 deg):
// u goes along the run, so the shader puts whole window bays in each run
// and corner trim at its ends. A curved wall is one run.
//
// heightRaster(b, half, n) -> Float32Array n * n, row 0 south: the tallest
// building height (m) over each cell, 0 where there is none. Even-odd
// scanline fill of all rings, so courtyards stay open. wind.js gives it to
// the fine lattice as walls.
//
// grep: function buildMesh  function heightRaster  const STRIDE  LOD_SIZES
//       function styleOf  function pitchOf  function walls  function unitBox
//       function rectOf  function snapIn  const PART

export const STRIDE = 24;
export const PART = { wall: 0, roof: 1, pitched: 2, unitWall: 3, unitTop: 4 };
export const MAT = { glass: 0, concrete: 1, brick: 2, stone: 3, render: 4 };

function rnd(i) {
  let x = (i + 1) * 2654435761 >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return (x & 0xffff) / 65535;
}
const rndK = (i, k) => rnd(i * 13 + k * 7919 + 101);

// LOD size steps (m): mesh.lod[k] is the index count that draws every
// building of size >= LOD_SIZES[k]. Size = max(footprint diagonal, height).
export const LOD_SIZES = [400, 200, 100, 50, 25, 12, 6, 0];

// Material and shopfront per building: a stable hash, the height class and
// the use. Warm cities (|lat| < 30) take render in place of brick.
const { glass: MG, concrete: MC, brick: MB, stone: MS, render: MR } = MAT;
// [material, share] pairs per class, flat
const W_TALL = [MG, 0.6, MC, 0.25, MS, 0.15];
const W_MID_OFFICE = [MG, 0.45, MC, 0.35, MS, 0.2];
const W_MID_HOME = [MC, 0.4, MB, 0.3, MR, 0.15, MG, 0.15];
const W_MID = [MC, 0.45, MB, 0.25, MS, 0.2, MG, 0.1];
const W_WORKS = [MC, 0.8, MB, 0.2];
const W_CIVIC = [MS, 0.65, MB, 0.35];
const W_SHOPS = [MB, 0.3, MC, 0.3, MG, 0.2, MS, 0.2];
const W_LOW = [MB, 0.45, MR, 0.35, MS, 0.2];
export function styleOf(i, hM, kind, lat = 45) {
  const r = rndK(i, 1);
  const w = hM >= 45 ? W_TALL
    : hM >= 18 ? (kind === 2 ? W_MID_OFFICE : kind === 1 ? W_MID_HOME : W_MID)
      : kind === 3 || kind === 6 ? W_WORKS : kind === 4 || kind === 5 ? W_CIVIC : kind === 2 || kind === 7 ? W_SHOPS : W_LOW;
  let m = w[w.length - 2], acc = 0;
  for (let k = 0; k < w.length; k += 2) { acc += w[k + 1]; if (r < acc) { m = w[k]; break; } }
  if (m === MB && Math.abs(lat) < 30) m = MR;
  const shop = kind === 2 || kind === 7 || ((kind === 0 || kind === 1) && hM >= 12 && rndK(i, 2) < 0.55);
  // pitched roof tone: 0 terracotta, 1 slate, 2 brown, 3 dark grey;
  // terracotta leads under 45 deg of latitude, slate north of it
  const t = rndK(i, 14);
  const tone = Math.abs(lat) < 45 ? (t < 0.6 ? 0 : t < 0.8 ? 2 : t < 0.95 ? 1 : 3) : (t < 0.5 ? 1 : t < 0.75 ? 2 : t < 0.9 ? 0 : 3);
  return { mat: m, shop, tone };
}

// A ring of 4 corners near 90 deg (|cos| < 0.26), convex: the corners in
// order with the long sides first (p0 p1 and p2 p3), else null.
export function rectOf(xs) {
  if (xs.length !== 4) return null;
  let sgn = 0;
  for (let k = 0; k < 4; k++) {
    const a = xs[(k + 3) % 4], p = xs[k], c = xs[(k + 1) % 4];
    const e1 = [p[0] - a[0], p[1] - a[1]], e2 = [c[0] - p[0], c[1] - p[1]];
    const l1 = Math.hypot(...e1), l2 = Math.hypot(...e2);
    if (l1 < 1.5 || l2 < 1.5) return null;
    if (Math.abs((e1[0] * e2[0] + e1[1] * e2[1]) / (l1 * l2)) > 0.26) return null;
    const cr = Math.sign(e1[0] * e2[1] - e1[1] * e2[0]);
    if (sgn && cr !== sgn) return null;
    sgn = cr;
  }
  const len = (k) => Math.hypot(xs[(k + 1) % 4][0] - xs[k][0], xs[(k + 1) % 4][1] - xs[k][1]);
  const s = len(0) + len(2) >= len(1) + len(3) ? 0 : 1;
  return [xs[s], xs[(s + 1) % 4], xs[(s + 2) % 4], xs[(s + 3) % 4]];
}

// Pitched roof or not, and which: 0 none, 1 gable, 2 hip.
export function pitchOf(i, hM, kind, area, lat = 45) {
  if (hM > 22 || area < 30 || area > 900) return 0;
  let p = kind === 0 || kind === 1 ? 0.75 : kind === 3 ? 0.35 : kind === 6 ? 0 : 0.25;
  if (Math.abs(lat) < 26) p *= 0.3;
  if (rndK(i, 3) >= p) return 0;
  return rndK(i, 4) < 0.5 ? 1 : 2;
}

function polyArea(xs) {
  let a = 0;
  for (let k = 0; k < xs.length; k++) { const p = xs[k], q = xs[(k + 1) % xs.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}
function isConvex(xs) {
  let sgn = 0;
  for (let k = 0; k < xs.length; k++) {
    const a = xs[k], p = xs[(k + 1) % xs.length], c = xs[(k + 2) % xs.length];
    const cr = (p[0] - a[0]) * (c[1] - p[1]) - (p[1] - a[1]) * (c[0] - p[0]);
    if (Math.abs(cr) < 1e-6) continue;
    if (sgn && Math.sign(cr) !== sgn) return false;
    sgn = Math.sign(cr);
  }
  return sgn !== 0;
}
function centroid(xs) {
  let cx = 0, cy = 0, a = 0;
  for (let k = 0; k < xs.length; k++) {
    const p = xs[k], q = xs[(k + 1) % xs.length], w = p[0] * q[1] - q[0] * p[1];
    a += w; cx += (p[0] + q[0]) * w; cy += (p[1] + q[1]) * w;
  }
  return [cx / (3 * a), cy / (3 * a)];
}
// distance from c to the nearest edge (c inside a convex ring)
function inDist(xs, c) {
  let d = Infinity;
  for (let k = 0; k < xs.length; k++) {
    const p = xs[k], q = xs[(k + 1) % xs.length];
    const ex = q[0] - p[0], ey = q[1] - p[1], L = Math.hypot(ex, ey);
    if (L < 1e-6) continue;
    d = Math.min(d, Math.abs((c[0] - p[0]) * ey - (c[1] - p[1]) * ex) / L);
  }
  return d;
}

// p (m) on the 0.5 m grid: the nearest of the 4 grid points around it that
// is inside the convex quad q or on its edge (else the plain rounding).
function snapIn(q, p, z) {
  const inQ = (x, y) => {
    let sgn = 0;
    for (let k = 0; k < 4; k++) {
      const a = q[k], c = q[(k + 1) % 4];
      const cr = (c[0] - a[0]) * (y - a[1]) - (c[1] - a[1]) * (x - a[0]);
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (Math.abs(cr) / L < 0.005) continue;
      if (sgn && Math.sign(cr) !== sgn) return false;
      sgn = Math.sign(cr);
    }
    return true;
  };
  const x0 = Math.floor(p[0] * 2) / 2, y0 = Math.floor(p[1] * 2) / 2;
  let best = null, bd = Infinity;
  for (const [x, y] of [[x0, y0], [x0 + 0.5, y0], [x0, y0 + 0.5], [x0 + 0.5, y0 + 0.5]]) {
    const d = Math.hypot(x - p[0], y - p[1]);
    if (d < bd && inQ(x, y)) { bd = d; best = [x, y, z]; }
  }
  return best || [Math.round(p[0] * 2) / 2, Math.round(p[1] * 2) / 2, z];
}

const snap = (p) => [Math.round(p[0] * 2) / 2, Math.round(p[1] * 2) / 2, Math.round(p[2] * 10) / 10];

// A roof face is fit when it is degenerate (upTri skips it) or its normal
// is 0.3 or more up (steeper than about 72 deg is a wall, not a roof).
function slopeOk(p, q, r) {
  const nx = (q[1] - p[1]) * (r[2] - p[2]) - (q[2] - p[2]) * (r[1] - p[1]);
  const ny = (q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2]);
  const nz = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const L = Math.hypot(nx, ny, nz);
  return L < 2e-3 || Math.abs(nz) / L >= 0.3;
}

// A growable vertex and index store.
function store(nv0, ni0) {
  const S = { cap: Math.max(nv0, 1024), icap: Math.max(ni0, 1024), v: 0, ix: 0 };
  const alloc = () => {
    S.buf = new ArrayBuffer(S.cap * STRIDE);
    S.i16 = new Int16Array(S.buf); S.i8 = new Int8Array(S.buf); S.u8 = new Uint8Array(S.buf); S.u16 = new Uint16Array(S.buf);
  };
  alloc();
  S.idx = new Uint32Array(S.icap);
  S.growV = (n) => {
    if (S.v + n <= S.cap) return;
    const old = S.u8;
    while (S.v + n > S.cap) S.cap *= 2;
    alloc(); S.u8.set(old.subarray(0, S.v * STRIDE));
  };
  S.growI = (n) => {
    if (S.ix + n <= S.icap) return;
    while (S.ix + n > S.icap) S.icap *= 2;
    const o = S.idx; S.idx = new Uint32Array(S.icap); S.idx.set(o.subarray(0, S.ix));
  };
  return S;
}

export function buildMesh(b, opts = {}) {
  const detail = opts.detail ?? 1, lat = opts.lat ?? 45, debug = !!opts.debug;
  // per building: first ring, first vertex, vertex count, size; then the
  // order largest first, so a prefix of the index buffer is a coarser city
  const ringOf = new Uint32Array(b.n), ptOf = new Uint32Array(b.n), cntOf = new Uint32Array(b.n), triOf = new Uint32Array(b.n);
  const size = new Float32Array(b.n);
  let nv = 0, ni = 0;
  const parts = [];   // buildings that stand on another: (x, y) of their first vertex in m, hmin m
  {
    let r = 0, p = 0, t = 0;
    for (let i = 0; i < b.n; i++) {
      let verts = 0;
      for (let k = 0; k < b.rings[i]; k++) verts += b.ringLen[r + k];
      ringOf[i] = r; ptOf[i] = p; cntOf[i] = verts; triOf[i] = t;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let k = 0; k < verts; k++) {
        const x = b.xy[2 * (p + k)], y = b.xy[2 * (p + k) + 1];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      size[i] = Math.max(Math.hypot(x1 - x0, y1 - y0) * 0.5, b.h[i] / 10);
      if (b.hmin && b.hmin[i] > 0) parts.push([b.xy[2 * p] * 0.5, b.xy[2 * p + 1] * 0.5, b.hmin[i] / 10]);
      r += b.rings[i]; p += verts; t += b.ntri[i] * 3;
      nv += verts * 4 + verts;
      ni += verts * 6 + b.ntri[i] * 3;
    }
  }
  const order = Array.from({ length: b.n }, (_, i) => i).sort((p, q) => size[q] - size[p]);
  const S = store(Math.ceil(nv * 1.5), Math.ceil(ni * 1.6));
  const dbg = debug ? [] : null;
  let tallest = 0;
  const forms = { flat: 0, gable: 0, hip: 0, tiered: 0, units: 0 };
  const lod = new Array(LOD_SIZES.length).fill(0);
  let li = 0;

  // building state for put()
  let B = { base: 0, h: 0, kind: 0, rr: 0, style: 0, i: 0 };
  const q2 = (m) => Math.round(m * 2);           // m -> 0.5 m units
  const q10 = (m) => Math.round(m * 10);         // m -> 0.1 m
  const q4 = (m) => Math.min(65535, Math.max(0, Math.round(m * 4)));   // m -> 0.25 m
  const put = (x, y, z, top, nx, ny, nz, part, u = 0, run = 0) => {
    S.growV(1);
    const v = S.v, o = v * (STRIDE / 2), ob = v * STRIDE;
    S.i16[o] = q2(x); S.i16[o + 1] = q2(y); S.i16[o + 2] = q10(z); S.i16[o + 3] = q10(top);
    S.i16[o + 4] = B.base; S.i16[o + 5] = B.h;
    S.i8[ob + 12] = Math.round(nx * 127); S.i8[ob + 13] = Math.round(ny * 127); S.i8[ob + 14] = Math.round(nz * 127); S.i8[ob + 15] = 0;
    S.u8[ob + 16] = B.kind; S.u8[ob + 17] = B.rr; S.u8[ob + 18] = part; S.u8[ob + 19] = B.style;
    S.u16[o + 10] = q4(u); S.u16[o + 11] = q4(run);
    return S.v++;
  };
  // a triangle under 0.001 m2 on the stored grid is skipped
  const tri = (a, c, d, part, cx = NaN, cy = NaN) => {
    const I = S.i16, oa = a * 12, oc = c * 12, od = d * 12;
    const ux = (I[oc] - I[oa]) * 0.5, uy = (I[oc + 1] - I[oa + 1]) * 0.5, uz = (I[oc + 2] - I[oa + 2]) * 0.1;
    const wx = (I[od] - I[oa]) * 0.5, wy = (I[od + 1] - I[oa + 1]) * 0.5, wz = (I[od + 2] - I[oa + 2]) * 0.1;
    const gx = uy * wz - uz * wy, gy = uz * wx - ux * wz, gz = ux * wy - uy * wx;
    if (gx * gx + gy * gy + gz * gz < 4e-6) return;
    S.growI(3);
    S.idx[S.ix++] = a; S.idx[S.ix++] = c; S.idx[S.ix++] = d;
    if (dbg) dbg.push(B.i, part, cx, cy);
  };
  // a flat-shaded triangle (own vertices), normal facing up (roofs)
  const upTri = (p0, q0, r0, part) => {
    const p = snap(p0), q = snap(q0), r = snap(r0);
    let nx = (q[1] - p[1]) * (r[2] - p[2]) - (q[2] - p[2]) * (r[1] - p[1]);
    let ny = (q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2]);
    let nz = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const L = Math.hypot(nx, ny, nz);
    if (L < 2e-3) return;   // twice the area: under 0.001 m2 is degenerate
    if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    nx /= L; ny /= L; nz /= L;
    tri(put(p[0], p[1], p[2], p[2], nx, ny, nz, part), put(q[0], q[1], q[2], q[2], nx, ny, nz, part), put(r[0], r[1], r[2], r[2], nx, ny, nz, part), part);
  };

  // Walls of one ring (m, outer counter-clockwise, holes clockwise), from z0
  // to z1, facade top 'top'. Facade runs between corners carry u and run.
  // cx, cy: centre of a convex solid (tiers), for the debug normal check.
  // scratch for walls(): edge dx, dy, length, run start u, run length
  let EX = new Float64Array(64), EY = new Float64Array(64), EL = new Float64Array(64), U0 = new Float64Array(64), RL = new Float64Array(64);
  let CO = new Uint8Array(64);
  function walls(xs, z0, z1, top, cx = NaN, cy = NaN) {
    const n = xs.length;
    if (z1 <= z0 + 0.05 || n < 3) return;
    if (n > EX.length) {
      const m = 2 * n;
      EX = new Float64Array(m); EY = new Float64Array(m); EL = new Float64Array(m); U0 = new Float64Array(m); RL = new Float64Array(m); CO = new Uint8Array(m);
    }
    for (let k = 0; k < n; k++) {
      const a = xs[k], c = xs[k + 1 === n ? 0 : k + 1];
      EX[k] = c[0] - a[0]; EY[k] = c[1] - a[1]; EL[k] = Math.hypot(EX[k], EY[k]);
    }
    let any = false;
    for (let k = 0; k < n; k++) {
      const k0 = k === 0 ? n - 1 : k - 1;
      CO[k] = 0;
      if (EL[k0] < 1e-6 || EL[k] < 1e-6) continue;
      if ((EX[k0] * EX[k] + EY[k0] * EY[k]) / (EL[k0] * EL[k]) < 0.906) { CO[k] = 1; any = true; }   // turn over 25 deg
    }
    if (!any) CO[0] = 1;
    let s = 0;
    while (!CO[s]) s++;
    let runStart = 0, u = 0;
    for (let j = 0; j < n; j++) {
      const k = (s + j) % n;
      if (CO[k] && j > 0) { for (let t = runStart; t < j; t++) RL[(s + t) % n] = u; runStart = j; u = 0; }
      U0[k] = u; u += EL[k];
    }
    for (let t = runStart; t < n; t++) RL[(s + t) % n] = u;
    // the vertices are written here, not by put(): walls are most of the mesh
    S.growV(4 * n); S.growI(6 * n);
    const I = S.i16, I8 = S.i8, U8 = S.u8, U16 = S.u16;
    const zq0 = q10(z0), zq1 = q10(z1), tq = q10(top), style = B.style;
    for (let k = 0; k < n; k++) {
      const L = EL[k];
      if (L < 0.05) continue;
      const a = xs[k], c = xs[k + 1 === n ? 0 : k + 1];
      const nx = Math.round(EY[k] / L * 127), ny = Math.round(-EX[k] / L * 127);
      const ua = q4(U0[k]), uc = q4(U0[k] + L), R = q4(RL[k]);
      const ax = q2(a[0]), ay = q2(a[1]), cx2 = q2(c[0]), cy2 = q2(c[1]);
      const v0 = S.v;
      for (let j = 0; j < 4; j++) {
        const v = v0 + j, o = v * 12, ob = v * STRIDE;
        const atC = j === 1 || j === 2;
        I[o] = atC ? cx2 : ax; I[o + 1] = atC ? cy2 : ay; I[o + 2] = j < 2 ? zq0 : zq1; I[o + 3] = tq;
        I[o + 4] = B.base; I[o + 5] = B.h;
        I8[ob + 12] = nx; I8[ob + 13] = ny; I8[ob + 14] = 0; I8[ob + 15] = 0;
        U8[ob + 16] = B.kind; U8[ob + 17] = B.rr; U8[ob + 18] = 0; U8[ob + 19] = style;
        U16[o + 10] = atC ? uc : ua; U16[o + 11] = R;
      }
      S.v += 4;
      tri(v0, v0 + 1, v0 + 2, 0, cx, cy); tri(v0, v0 + 2, v0 + 3, 0, cx, cy);
    }
  }

  // A rooftop unit: a box of half sides hx, hy at (cx, cy), turned by ang,
  // from z0 to z1. Four walls and a top; the floor is on the roof.
  function unitBox(cx, cy, hx, hy, ang, z0, z1) {
    const c = Math.cos(ang), s = Math.sin(ang);
    const P = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
    for (let k = 0; k < 4; k++) {
      const a = P[k], d = P[(k + 1) % 4];
      const dx = d[0] - a[0], dy = d[1] - a[1], L = Math.hypot(dx, dy);
      const nx = dy / L, ny = -dx / L;
      const p0 = put(a[0], a[1], z0, z1, nx, ny, 0, 3), p1 = put(d[0], d[1], z0, z1, nx, ny, 0, 3);
      const p2 = put(d[0], d[1], z1, z1, nx, ny, 0, 3), p3 = put(a[0], a[1], z1, z1, nx, ny, 0, 3);
      tri(p0, p1, p2, 3, cx, cy); tri(p0, p2, p3, 3, cx, cy);
    }
    const t = P.map((p) => put(p[0], p[1], z1, z1, 0, 0, 1, 4));
    tri(t[0], t[1], t[2], 4, cx, cy); tri(t[0], t[2], t[3], 4, cx, cy);
    forms.units++;
  }

  for (let oi = 0; oi < b.n; oi++) {
    const i = order[oi];
    while (li < LOD_SIZES.length && size[i] < LOD_SIZES[li]) lod[li++] = S.ix;
    const ring = ringOf[i], pt = ptOf[i], tp = triOf[i], cnt = cntOf[i];
    const hM = b.h[i] / 10, hminM = b.hmin ? b.hmin[i] / 10 : 0;
    const kind = b.kind[i] & 15, est = !!(b.kind[i] & 128);
    const st = styleOf(i, hM, kind, lat);
    B = { base: b.base[i], h: b.h[i], kind, rr: Math.round(rnd(i) * 255), style: st.mat | (st.shop && hminM < 0.5 ? 16 : 0) | (st.tone << 5) | (est ? 128 : 0), i };
    if (hM > tallest && !est) tallest = hM;
    // rings in metres
    const R = [];
    {
      let p = pt;
      for (let k = 0; k < b.rings[i]; k++) {
        const len = b.ringLen[ring + k], xs = [];
        for (let e = 0; e < len; e++) xs.push([b.xy[2 * (p + e)] * 0.5, b.xy[2 * (p + e) + 1] * 0.5]);
        R.push(xs); p += len;
      }
    }
    const outer = R[0];
    const area = Math.abs(polyArea(outer));
    const single = R.length === 1;
    // parapet: 0.3 m on a shed, up to 1.1 m on a tall roof
    const par = hM < 5 ? 0.3 : 0.6 + 0.5 * rndK(i, 5);

    // pitched
    const rect = single ? rectOf(outer) : null;
    const pk = rect ? pitchOf(i, hM, kind, area, lat) : 0;
    if (pk) {
      const [P0, P1, P2, P3] = rect;
      const M1 = [(P1[0] + P2[0]) / 2, (P1[1] + P2[1]) / 2], M3 = [(P3[0] + P0[0]) / 2, (P3[1] + P0[1]) / 2];
      const W = (Math.hypot(P2[0] - P1[0], P2[1] - P1[1]) + Math.hypot(P0[0] - P3[0], P0[1] - P3[1])) / 2;
      const Lr = Math.hypot(M1[0] - M3[0], M1[1] - M3[1]);
      const pitch = (28 + 14 * rndK(i, 6)) * Math.PI / 180;
      let rise = Math.tan(pitch) * W / 2;
      rise = Math.min(rise, hM - (hminM + 2.4));
      if (rise >= 0.8) {
        const eave = hM - rise;
        const hip = pk === 2 && W >= 6;
        const ax = [(M1[0] - M3[0]) / Lr, (M1[1] - M3[1]) / Lr];
        const ins = hip ? Math.min(W / 2, Lr / 2) : 0;
        // the ridge ends on the 0.5 m grid, inside the quad (or on its edge)
        let A = snapIn(rect, [M3[0] + ax[0] * ins, M3[1] + ax[1] * ins], hM), Bp = snapIn(rect, [M1[0] - ax[0] * ins, M1[1] - ax[1] * ins], hM);
        if (hip && Math.hypot(A[0] - Bp[0], A[1] - Bp[1]) < 0.75) { A = snapIn(rect, [(M1[0] + M3[0]) / 2, (M1[1] + M3[1]) / 2], hM); Bp = A; }
        const e = (p) => [p[0], p[1], eave];
        const faces = [[e(P0), e(P1), Bp], [e(P0), Bp, A], [e(P2), e(P3), A], [e(P2), A, Bp]];
        if (hip) faces.push([e(P1), e(P2), Bp], [e(P3), e(P0), A]);
        // a face that the grid made steep (a sliver quad): a flat roof instead
        if (faces.every(([p, q, r]) => slopeOk(snap(p), snap(q), snap(r)))) {
          walls(outer, hminM, eave, eave);
          for (const [p, q, r] of faces) upTri(p, q, r, 2);
          if (hip) forms.hip++;
          else {
            // gable ends: vertical wall triangles, facade top at the eave
            for (const [a, c, m] of [[P1, P2, Bp], [P3, P0, A]]) {
              const dx = c[0] - a[0], dy = c[1] - a[1], L = Math.hypot(dx, dy);
              const nx = dy / L, ny = -dx / L;
              tri(put(a[0], a[1], eave, eave, nx, ny, 0, 0, 0, L), put(c[0], c[1], eave, eave, nx, ny, 0, 0, L, L), put(m[0], m[1], hM, eave, nx, ny, 0, 0, L / 2, L), 0);
            }
            forms.gable++;
          }
          continue;
        }
      }
    }

    // tiered tower
    if (detail && single && hM >= 70 && outer.length >= 3 && isConvex(outer) && rndK(i, 7) < 0.65) {
      const c = centroid(outer);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of outer) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
      const onTop = parts.some(([x, y, hm]) => hm >= hM * 0.5 && x >= x0 && x <= x1 && y >= y0 && y <= y1);
      const d0 = inDist(outer, c);
      if (!onTop && d0 >= 8) {
        const three = hM >= 150;
        const tops = three ? [hM * (0.7 + 0.1 * rndK(i, 8)), hM * (0.88 + 0.05 * rndK(i, 9)), hM] : [hM * (0.74 + 0.1 * rndK(i, 8)), hM];
        const scales = three ? [1, 0.84, 0.68] : [1, 0.8];
        const rings = scales.map((k) => outer.map((p) => [c[0] + (p[0] - c[0]) * k, c[1] + (p[1] - c[1]) * k]));
        let z0 = hminM;
        for (let t = 0; t < rings.length; t++) {
          walls(rings[t], z0, tops[t] + par, tops[t], c[0], c[1]);
          if (t + 1 < rings.length) {
            // the ledge between this tier and the next, at the tier top
            const o = rings[t], n2 = rings[t + 1];
            for (let k = 0; k < o.length; k++) {
              const k1 = (k + 1) % o.length;
              const a = put(o[k][0], o[k][1], tops[t], tops[t], 0, 0, 1, 1), bb = put(o[k1][0], o[k1][1], tops[t], tops[t], 0, 0, 1, 1);
              const cc = put(n2[k1][0], n2[k1][1], tops[t], tops[t], 0, 0, 1, 1), dd = put(n2[k][0], n2[k][1], tops[t], tops[t], 0, 0, 1, 1);
              tri(a, bb, cc, 1); tri(a, cc, dd, 1);
            }
          }
          z0 = tops[t];
        }
        // top roof: a fan over the top tier (convex)
        const top = rings[rings.length - 1];
        const f = top.map((p) => put(p[0], p[1], hM, hM, 0, 0, 1, 1));
        for (let k = 1; k + 1 < f.length; k++) tri(f[0], f[k], f[k + 1], 1);
        // plant room at the centroid
        const dTop = d0 * scales[scales.length - 1];
        const hs = Math.min(dTop * 0.5, 12);
        if (hs >= 2) unitBox(c[0], c[1], hs * (0.7 + 0.3 * rndK(i, 10)), hs, Math.atan2(top[1][1] - top[0][1], top[1][0] - top[0][0]), hM, hM + 3.5 + 2.5 * rndK(i, 11));
        forms.tiered++;
        continue;
      }
    }

    // flat roof with a parapet
    forms.flat++;
    for (const xs of R) walls(xs, hminM, hM + par, hM);
    const roofBase = S.v;
    for (const xs of R) for (const p of xs) put(p[0], p[1], hM, hM, 0, 0, 1, 1);
    for (let t = 0; t < b.ntri[i]; t++) {
      const a = b.tri[tp + 3 * t], c = b.tri[tp + 3 * t + 1], d = b.tri[tp + 3 * t + 2];
      const A2 = (b.xy[2 * (pt + c)] - b.xy[2 * (pt + a)]) * (b.xy[2 * (pt + d) + 1] - b.xy[2 * (pt + a) + 1]) -
        (b.xy[2 * (pt + c) + 1] - b.xy[2 * (pt + a) + 1]) * (b.xy[2 * (pt + d)] - b.xy[2 * (pt + a)]);
      if (A2 !== 0) tri(roofBase + a, roofBase + c, roofBase + d, 1);
    }
    // rooftop units on a roof of 9 m or more and 120 m2 or more
    if (detail && hM >= 9 && area >= 120) {
      const all = [];
      for (const xs of R) for (const p of xs) all.push(p);
      const ang = (() => {   // along the longest outer edge
        let best = 0, a = 0;
        for (let k = 0; k < outer.length; k++) {
          const p = outer[k], q = outer[(k + 1) % outer.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (L > best) { best = L; a = Math.atan2(q[1] - p[1], q[0] - p[0]); }
        }
        return a;
      })();
      const want = 1 + (area > 600 ? 1 : 0) + (area > 2000 ? 1 : 0) + (hM >= 40 ? 1 : 0);
      if (single && hM >= 30 && isConvex(outer)) {
        // one plant room at the centroid, inside the inscribed circle
        const c = centroid(outer), d = inDist(outer, c);
        const hs = Math.min(d * 0.5, 10);
        if (hs >= 2) unitBox(c[0], c[1], hs * (0.6 + 0.4 * rndK(i, 12)), hs, ang, hM, hM + 3 + 2 * rndK(i, 13));
      } else {
        // boxes in the incircles of the largest roof triangles
        const cand = [];
        for (let t = 0; t < b.ntri[i]; t++) {
          const p = all[b.tri[tp + 3 * t]], q = all[b.tri[tp + 3 * t + 1]], r = all[b.tri[tp + 3 * t + 2]];
          const a = Math.hypot(q[0] - r[0], q[1] - r[1]), bb = Math.hypot(p[0] - r[0], p[1] - r[1]), cc = Math.hypot(p[0] - q[0], p[1] - q[1]);
          const per = a + bb + cc;
          const ar = Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) / 2;
          if (per <= 0) continue;
          const rIn = 2 * ar / per;
          if (rIn < 1.8) continue;
          cand.push([rIn, (a * p[0] + bb * q[0] + cc * r[0]) / per, (a * p[1] + bb * q[1] + cc * r[1]) / per]);
        }
        cand.sort((x, y) => y[0] - x[0]);
        for (let k = 0; k < Math.min(want, cand.length); k++) {
          const [rIn, cx, cy] = cand[k];
          // half side 0.55 r at most: the corners stay 0.2 r inside the
          // incircle, more than the 0.35 m rounding to the 0.5 m grid
          const hs = Math.min(rIn * 0.55, 1.2 + 2.6 * rndK(i, 20 + k));
          unitBox(cx, cy, hs * (0.6 + 0.4 * rndK(i, 30 + k)), hs, ang, hM, hM + 1.6 + 2.2 * rndK(i, 40 + k));
        }
      }
    }
  }
  while (li < LOD_SIZES.length) lod[li++] = S.ix;
  const out = { vertices: S.buf.slice(0, S.v * STRIDE), indices: S.idx.slice(0, S.ix), count: S.v, tallest, lod, forms };
  if (dbg) out.tris = Float64Array.from(dbg);
  return out;
}

export function heightRaster(b, half, n) {
  const out = new Float32Array(n * n);
  const cell = (2 * half) / n;
  let ring = 0, pt = 0;
  const xs = [];
  for (let i = 0; i < b.n; i++) {
    const h = b.h[i] / 10;
    let cnt = 0;
    for (let k = 0; k < b.rings[i]; k++) cnt += b.ringLen[ring + k];
    // bbox in rows
    let y0 = Infinity, y1 = -Infinity;
    for (let k = 0; k < cnt; k++) {
      const y = b.xy[2 * (pt + k) + 1] * 0.5;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    const r0 = Math.max(0, Math.ceil((y0 + half) / cell - 0.5));
    const r1 = Math.min(n - 1, Math.floor((y1 + half) / cell - 0.5));
    for (let r = r0; r <= r1; r++) {
      const yc = -half + (r + 0.5) * cell;
      xs.length = 0;
      let p = pt;
      for (let k = 0; k < b.rings[i]; k++) {
        const len = b.ringLen[ring + k];
        for (let e = 0; e < len; e++) {
          const a = p + e, c = p + ((e + 1) % len);
          const ay = b.xy[2 * a + 1] * 0.5, cy = b.xy[2 * c + 1] * 0.5;
          if ((ay <= yc) === (cy <= yc)) continue;
          const ax = b.xy[2 * a] * 0.5, cx = b.xy[2 * c] * 0.5;
          xs.push(ax + (yc - ay) / (cy - ay) * (cx - ax));
        }
        p += len;
      }
      xs.sort((s, t) => s - t);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] + half) / cell - 0.5));
        const c1 = Math.min(n - 1, Math.floor((xs[k + 1] + half) / cell - 0.5));
        const row = r * n;
        for (let c = c0; c <= c1; c++) if (out[row + c] < h) out[row + c] = h;
      }
    }
    pt += cnt;
    ring += b.rings[i];
  }
  return out;
}
