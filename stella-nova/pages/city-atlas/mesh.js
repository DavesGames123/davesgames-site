// mesh.js — building mesh and building height raster from the decoded city
// (data.js buildingsOf). No DOM, no GPU: worker.js and tests.mjs use it.
//
// buildMesh(b) -> { vertices: ArrayBuffer (20 bytes per vertex), indices:
// Uint32Array, count, tallest } in the layout of shaders/buildings.wgsl:
//   0  int16 x 2, y 2            (0.5 m units)
//   4  int16 z above base        (0.1 m)
//   6  int16 u along the wall    (0.5 m units, per ring)
//   8  int16 base                (0.1 m)
//  10  int16 height              (0.1 m)
//  12  int8  normal x, y, z, 0   (snorm)
//  16  uint8 use, random, roof, estimated
// Walls: one quad per ring edge, normal outward (outer rings are counter-
// clockwise, holes clockwise; build_city.py orients them). Roofs: the
// stored triangles at the building height.
//
// heightRaster(b, half, n) -> Float32Array n * n, row 0 south: the tallest
// building height (m) over each cell, 0 where there is none. Even-odd
// scanline fill of all rings, so courtyards stay open. wind.js gives it to
// the fine lattice as walls.
//
// grep: function buildMesh  function heightRaster  const STRIDE

export const STRIDE = 20;

function rnd(i) {
  let x = (i + 1) * 2654435761 >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return (x & 0xffff) / 65535;
}

export function buildMesh(b) {
  // count vertices and indices first
  let nv = 0, ni = 0;
  {
    let r = 0;
    for (let i = 0; i < b.n; i++) {
      let verts = 0;
      for (let k = 0; k < b.rings[i]; k++) verts += b.ringLen[r + k];
      r += b.rings[i];
      nv += verts * 4 + verts;     // wall quads + roof vertices
      ni += verts * 6 + b.ntri[i] * 3;
    }
  }
  const vb = new ArrayBuffer(nv * STRIDE);
  const i16 = new Int16Array(vb);
  const i8 = new Int8Array(vb);
  const u8 = new Uint8Array(vb);
  const idx = new Uint32Array(ni);
  let v = 0, ix = 0, ring = 0, pt = 0, tp = 0, tallest = 0;
  const put = (x, y, z, u, base, h, nx, ny, nz, kind, rr, roof, est) => {
    const o = v * (STRIDE / 2);
    i16[o] = x; i16[o + 1] = y; i16[o + 2] = z; i16[o + 3] = u;
    i16[o + 4] = base; i16[o + 5] = h;
    const ob = v * STRIDE;
    i8[ob + 12] = nx; i8[ob + 13] = ny; i8[ob + 14] = nz; i8[ob + 15] = 0;
    u8[ob + 16] = kind; u8[ob + 17] = rr; u8[ob + 18] = roof; u8[ob + 19] = est;
    return v++;
  };
  for (let i = 0; i < b.n; i++) {
    const h = b.h[i], hmin = b.hmin ? b.hmin[i] : 0, base = b.base[i];
    const kind = b.kind[i] & 15, est = b.kind[i] & 128 ? 255 : 0;
    const rr = Math.round(rnd(i) * 255);
    if (h / 10 > tallest && !est) tallest = h / 10;
    const ringStart = pt;
    const roofBase = v + 0;
    // roof vertices first, in ring order, so the stored triangle indices apply
    let cnt = 0;
    for (let k = 0; k < b.rings[i]; k++) cnt += b.ringLen[ring + k];
    for (let k = 0; k < cnt; k++) {
      put(b.xy[2 * (ringStart + k)], b.xy[2 * (ringStart + k) + 1], h, 0, base, h, 0, 0, 127, kind, rr, 255, est);
    }
    for (let t = 0; t < b.ntri[i] * 3; t++) idx[ix++] = roofBase + b.tri[tp + t];
    tp += b.ntri[i] * 3;
    // walls
    let p = ringStart;
    for (let k = 0; k < b.rings[i]; k++) {
      const len = b.ringLen[ring + k];
      let u = 0;
      for (let e = 0; e < len; e++) {
        const a = p + e, c = p + ((e + 1) % len);
        const ax = b.xy[2 * a], ay = b.xy[2 * a + 1], cx = b.xy[2 * c], cy = b.xy[2 * c + 1];
        const dx = cx - ax, dy = cy - ay;
        const L = Math.hypot(dx, dy) || 1;
        const nx = Math.round(dy / L * 127), ny = Math.round(-dx / L * 127);
        const u1 = u + L;
        const uu0 = Math.round(u) % 32000, uu1 = uu0 + Math.round(L);
        const q0 = put(ax, ay, hmin, uu0, base, h, nx, ny, 0, kind, rr, 0, est);
        const q1 = put(cx, cy, hmin, Math.min(uu1, 32767), base, h, nx, ny, 0, kind, rr, 0, est);
        const q2 = put(cx, cy, h, Math.min(uu1, 32767), base, h, nx, ny, 0, kind, rr, 0, est);
        const q3 = put(ax, ay, h, uu0, base, h, nx, ny, 0, kind, rr, 0, est);
        idx[ix++] = q0; idx[ix++] = q1; idx[ix++] = q2;
        idx[ix++] = q0; idx[ix++] = q2; idx[ix++] = q3;
        u = u1;
      }
      p += len;
    }
    pt += cnt;
    ring += b.rings[i];
  }
  return { vertices: vb, indices: idx.subarray(0, ix), count: v, tallest };
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
