// terrain3d.js — the 3D ground of a terrain city: GPU buffers from
// city.terrain (terrain.js). No DOM, no GPU: mesh3d.js calls it, in the
// worker or on the main thread, and tests.mjs checks it.
//
// buildTerrainMesh(city, tl) -> {
//   vertices: ArrayBuffer (TSTRIDE bytes a vertex), indices: Uint32Array,
//   K: the number of heights a vertex carries (8), half: [W/2, H/2] }
// The view (view3d.js, city.wgsl vsTerrain) morphs each vertex through its
// K heights over the terrain phase: 7 LIB stages (DLA, upscale, shape,
// branched flow, erosion, the finished LIB world) and the graded city
// ground last. So the 3D view shows the world forming, then the city
// grows on the last one.
//
// TERRAIN VERTEX (TSTRIDE 56 bytes)
//   0  float32x2  x, y (world frame of mesh3d.js: x east, y north, metres)
//   8  float32x4  heights 0..3 (m above the sea)
//  24  float32x4  heights 4..7 (7 = the final ground)
//  40  snorm8x4   normal of the final ground
//  44  unorm8x4   albedo rgb (terrain.js natural colour), a 255
//  48  float32x2  park: t0, dur of the park this vertex lies in (dur 0: none)
//
// MESHES. The outer grid covers the world, less the cells under the patch.
// The patch covers the city with cells c / k (about 6 m). Within one outer
// cell of its edge the patch heights blend to the outer cell (terrain.js),
// so the edge vertices sit on the outer edges and no crack opens. A skirt
// runs from the world edge out to three times its distance, down toward the
// sea, for the horizon.
//
// grep: export const TSTRIDE  export function buildTerrainMesh  function snapAt  export function waterQuads

import { groundAt } from './terrain.js';

export const TSTRIDE = 56;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function insidePoly(x, y, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// Bilinear on a snapshot world grid (n x n vertices over the world).
function snapAt(arr, n, ws, x, z) {
  const u = clamp((x + ws / 2) / ws * (n - 1), 0, n - 1), v = clamp((z + ws / 2) / ws * (n - 1), 0, n - 1);
  const i = Math.min(Math.floor(u), n - 2), j = Math.min(Math.floor(v), n - 2), fx = u - i, fz = v - j;
  return lerp(lerp(arr[j * n + i], arr[j * n + i + 1], fx), lerp(arr[(j + 1) * n + i], arr[(j + 1) * n + i + 1], fx), fz);
}

export function buildTerrainMesh(city, tl) {
  const T = city.terrain;
  const W = city.view.w, H = city.view.h, cx = W / 2, cy = H / 2;
  const { G, c, origin, h: oh, col: ocol } = T.outer, NO = G + 1;
  const { x0, y0, s, nx, ny, h: gh } = T.grid;
  const { i0, j0, i1, j1, k } = T.patch;
  const ws = T.worldSize, sea = T.seaLevel;
  const K = T.snaps.length + 1;
  const SN = Math.round(Math.sqrt(T.snaps[0].world.length));
  // map x, y of the terrain origin; terrain x = mx - ox + origin
  const ox = x0 - i0 * c, oy = y0 - j0 * c;
  const toTx = (mx) => mx - ox + origin, toTz = (my) => my - oy + origin;

  const nOuter = NO * NO, nPatch = nx * ny, nSkirt = 4 * G;
  const nv = nOuter + nPatch + nSkirt;
  const buf = new ArrayBuffer(nv * TSTRIDE);
  const f32 = new Float32Array(buf), i8 = new Int8Array(buf), u8 = new Uint8Array(buf);
  const put = (v, mx, my, hs, n, col, park) => {
    const o = v * TSTRIDE, f = o / 4;
    f32[f] = mx - cx; f32[f + 1] = cy - my;
    for (let q = 0; q < 8; q++) f32[f + 2 + q] = hs[Math.min(q, K - 1)];
    // the normal: map y is down, world y is north
    i8[o + 40] = Math.round(n[0] * 127); i8[o + 41] = Math.round(-n[1] * 127); i8[o + 42] = Math.round(n[2] * 127); i8[o + 43] = 0;
    u8[o + 44] = col[0]; u8[o + 45] = col[1]; u8[o + 46] = col[2]; u8[o + 47] = 255;
    f32[f + 12] = park ? park[0] : -1; f32[f + 13] = park ? park[1] : 0;
  };
  const norm = (gx, gy) => { const L = Math.hypot(gx, gy, 1); return [-gx / L, -gy / L, 1 / L]; };

  // outer heights per stage
  const oH = [];
  for (let q = 0; q < K - 1; q++) {
    const a = new Float32Array(nOuter), sn = T.snaps[q].world;
    for (let j = 0; j < NO; j++) for (let i = 0; i < NO; i++) a[j * NO + i] = snapAt(sn, SN, ws, origin + i * c, origin + j * c);
    oH.push(a);
  }
  oH.push(oh);
  const hs = new Float32Array(8);
  for (let j = 0; j < NO; j++) for (let i = 0; i < NO; i++) {
    const q = j * NO + i;
    for (let st = 0; st < K; st++) hs[st] = oH[st][q];
    const gx = (oh[j * NO + Math.min(G, i + 1)] - oh[j * NO + Math.max(0, i - 1)]) / ((Math.min(G, i + 1) - Math.max(0, i - 1)) * c);
    const gy = (oh[Math.min(G, j + 1) * NO + i] - oh[Math.max(0, j - 1) * NO + i]) / ((Math.min(G, j + 1) - Math.max(0, j - 1)) * c);
    put(q, ox + i * c, oy + j * c, hs, norm(gx, gy), [ocol[3 * q], ocol[3 * q + 1], ocol[3 * q + 2]], null);
  }

  // patch: stages from the outer cells, the final ground from the grid
  const parks = city.parks.map((p, pi) => {
    let a = Infinity, b = Infinity, cc = -Infinity, d = -Infinity;
    for (const q of p) { a = Math.min(a, q[0]); b = Math.min(b, q[1]); cc = Math.max(cc, q[0]); d = Math.max(d, q[1]); }
    return { p, box: [a, b, cc, d], t: [tl.parks[2 * pi], tl.parks[2 * pi + 1]] };
  });
  for (let b = 0; b < ny; b++) for (let a = 0; a < nx; a++) {
    const q = b * nx + a, mx = x0 + a * s, my = y0 + b * s;
    const ia = Math.min(Math.floor(a / k), i1 - i0 - 1), jb = Math.min(Math.floor(b / k), j1 - j0 - 1);
    const fx = (a - ia * k) / k, fy = (b - jb * k) / k, oi = i0 + ia, oj = j0 + jb;
    for (let st = 0; st < K - 1; st++) {
      const A = oH[st];
      hs[st] = lerp(lerp(A[oj * NO + oi], A[oj * NO + oi + 1], fx), lerp(A[(oj + 1) * NO + oi], A[(oj + 1) * NO + oi + 1], fx), fy);
    }
    hs[K - 1] = gh[q];
    const gx = (gh[b * nx + Math.min(nx - 1, a + 1)] - gh[b * nx + Math.max(0, a - 1)]) / ((Math.min(nx - 1, a + 1) - Math.max(0, a - 1)) * s);
    const gy = (gh[Math.min(ny - 1, b + 1) * nx + a] - gh[Math.max(0, b - 1) * nx + a]) / ((Math.min(ny - 1, b + 1) - Math.max(0, b - 1)) * s);
    let park = null;
    for (const pk of parks) {
      if (mx < pk.box[0] || my < pk.box[1] || mx > pk.box[2] || my > pk.box[3]) continue;
      if (insidePoly(mx, my, pk.p)) { park = pk.t; break; }
    }
    put(nOuter + q, mx, my, hs, norm(gx, gy), [T.col[3 * q], T.col[3 * q + 1], T.col[3 * q + 2]], park);
  }

  // skirt: the world edge, out to three times its distance, sloping down
  const ring = [];
  for (let i = 0; i < G; i++) ring.push(i);                       // top row, left to right
  for (let j = 0; j < G; j++) ring.push(j * NO + G);              // right column
  for (let i = G; i > 0; i--) ring.push(G * NO + i);              // bottom row
  for (let j = G; j > 0; j--) ring.push(j * NO);                  // left column
  const wcx = ox - origin, wcy = oy - origin;                     // map x, y of the world centre
  const low = T.hasSea ? sea - 40 : Math.min(...oh) - 20;
  ring.forEach((q, r) => {
    const i = q % NO, j = (q - i) / NO;
    const mx = ox + i * c, my = oy + j * c;
    const X = wcx + (mx - wcx) * 3, Y = wcy + (my - wcy) * 3;
    for (let st = 0; st < K; st++) hs[st] = lerp(oH[st][q], low, 0.75);
    put(nOuter + nPatch + r, X, Y, hs, [0, 0, 1], [Math.round(ocol[3 * q] * 0.85), Math.round(ocol[3 * q + 1] * 0.85), Math.round(ocol[3 * q + 2] * 0.85)], null);
  });

  // indices
  const idx = [];
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    if (i >= i0 && i < i1 && j >= j0 && j < j1) continue;
    const a = j * NO + i;
    idx.push(a, a + 1, a + NO + 1, a, a + NO + 1, a + NO);
  }
  for (let b = 0; b < ny - 1; b++) for (let a = 0; a < nx - 1; a++) {
    const q = nOuter + b * nx + a;
    idx.push(q, q + 1, q + nx + 1, q, q + nx + 1, q + nx);
  }
  const nR = ring.length;
  for (let r = 0; r < nR; r++) {
    const a = ring[r], b = ring[(r + 1) % nR], sa = nOuter + nPatch + r, sb = nOuter + nPatch + (r + 1) % nR;
    idx.push(a, b, sb, a, sb, sa);
  }
  return { vertices: buf, indices: Uint32Array.from(idx), K, stride: TSTRIDE };
}

// Water surfaces off the city river (lakes, the other LIB rivers): quads per
// grid cell with a wet corner, wet corners at the water surface, dry corners
// under the ground. emit(x, y, z) per triangle corner, map coordinates.
export function waterQuads(city, emit) {
  const T = city.terrain;
  const { G, c, h: oh, water } = T.outer, NO = G + 1;
  const { x0, y0, s, nx, ny, h: gh, lakeLevel } = T.grid;
  const { i0, j0, i1, j1 } = T.patch;
  const ox = x0 - i0 * c, oy = y0 - j0 * c;
  const cell = (zs, pts) => {
    if (zs.every((z) => z === null)) return;
    const Z = zs.map((z, q) => (z === null ? pts[q][2] - 2 : z));
    const P = pts.map((p, q) => [p[0], p[1], Z[q]]);
    emit(P[0]); emit(P[1]); emit(P[2]); emit(P[0]); emit(P[2]); emit(P[3]);
  };
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    if (i >= i0 && i < i1 && j >= j0 && j < j1) continue;
    const qs = [j * NO + i, j * NO + i + 1, (j + 1) * NO + i + 1, (j + 1) * NO + i];
    const zs = qs.map((q) => (water[q] > -1e3 ? water[q] : null));
    if (zs.every((z) => z === null)) continue;
    cell(zs, [[ox + i * c, oy + j * c, oh[qs[0]]], [ox + (i + 1) * c, oy + j * c, oh[qs[1]]], [ox + (i + 1) * c, oy + (j + 1) * c, oh[qs[2]]], [ox + i * c, oy + (j + 1) * c, oh[qs[3]]]]);
  }
  for (let b = 0; b < ny - 1; b++) for (let a = 0; a < nx - 1; a++) {
    const qs = [b * nx + a, b * nx + a + 1, (b + 1) * nx + a + 1, (b + 1) * nx + a];
    const zs = qs.map((q) => (lakeLevel[q] > gh[q] + 0.1 ? lakeLevel[q] : null));
    if (zs.every((z) => z === null)) continue;
    cell(zs, [[x0 + a * s, y0 + b * s, gh[qs[0]]], [x0 + (a + 1) * s, y0 + b * s, gh[qs[1]]], [x0 + (a + 1) * s, y0 + (b + 1) * s, gh[qs[2]]], [x0 + a * s, y0 + (b + 1) * s, gh[qs[3]]]]);
  }
}

// The ground under a map point, for the city layers (re-exported for mesh3d).
export { groundAt };
