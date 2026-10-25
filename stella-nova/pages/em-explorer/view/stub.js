// ============================================================================
//  VIEW STUB  ·  a synthetic Volume with the DATA API shape (tests, offline)
// ----------------------------------------------------------------------------
//  stubVolume(opts) -> { id, scales, dtype, bounds, getChunk, getSlice }
//  The voxel value is a pure function of the nm position: cell walls from a
//  3D jittered-grid Voronoi field, small dark vesicles, a light grain. All
//  scales sample the same function, so a coarse tile and a fine tile of one
//  place agree. It is not real data; the page uses DATA. Tests use it to
//  check the chunk assembler and the tile pipeline with no network.
//
//  GREP MAP
//    grep -n 'export function stubVolume'
//    grep -n 'export function stubValue'
// ============================================================================
import { PLANES } from './camera.js';

function hash3(x, y, z, k) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + k * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const CELL = 1800, VES = 160;
export function stubValue(x, y, z) {
  const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL), gz = Math.floor(z / CELL);
  let d1 = 1e30, d2 = 1e30, id = 0;
  for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = gx + i, cy = gy + j, cz = gz + k;
    const px = (cx + hash3(cx, cy, cz, 1)) * CELL, py = (cy + hash3(cx, cy, cz, 2)) * CELL, pz = (cz + hash3(cx, cy, cz, 3)) * CELL;
    const d = (x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2;
    if (d < d1) { d2 = d1; d1 = d; id = cx * 7 + cy * 13 + cz * 31; } else if (d < d2) d2 = d;
  }
  const wall = Math.sqrt(d2) - Math.sqrt(d1);
  let v = 150 + (id % 5) * 6;
  if (wall < 40) v -= 95 * (1 - wall / 40);
  // vesicles in some cells
  if ((id & 3) === 0) {
    const vx = Math.floor(x / VES), vy = Math.floor(y / VES), vz = Math.floor(z / VES);
    const h = hash3(vx, vy, vz, 9);
    if (h < 0.35) {
      const cx = (vx + 0.5) * VES, cy = (vy + 0.5) * VES, cz = (vz + 0.5) * VES;
      const r = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2);
      if (r < 22) v = 60; else if (r < 30) v -= 25;
    }
  }
  v += (hash3(Math.floor(x / 8), Math.floor(y / 8), Math.floor(z / 8), 5) - 0.5) * 24;
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

export function stubVolume(o = {}) {
  const size0 = o.size || [16384, 16384, 4096];
  const res0 = o.resolution || [8, 8, 8];
  const chunk = o.chunk || [64, 64, 64];
  const levels = o.levels || 7;
  const delay = o.delay ?? 0;
  const scales = [];
  for (let s = 0; s < levels; s++) {
    const f = [2 ** s, 2 ** s, o.anisoZ ? Math.max(1, 2 ** (s - 2)) : 2 ** s];
    scales.push({ key: `s${s}`, size: size0.map((n, i) => Math.max(1, Math.ceil(n / f[i]))),
      resolution: res0.map((r, i) => r * f[i]), chunk: chunk.slice(), encoding: 'raw' });
  }
  const wait = (signal) => new Promise((res, rej) => {
    if (!delay) return res();
    const t = setTimeout(res, delay);
    if (signal && signal.addEventListener) signal.addEventListener('abort', () => { clearTimeout(t); rej(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
  });
  const vol = {
    id: o.id || 'stub', dtype: 'uint8', bounds: size0.map((n, i) => n * res0[i]), scales, stub: true,
    calls: { chunk: 0, slice: 0 },
    async getChunk(s, cc, { signal } = {}) {
      vol.calls.chunk++;
      await wait(signal);
      const sc = scales[s];
      const org = cc.map((c, i) => c * sc.chunk[i]);
      const sh = sc.chunk.map((c, i) => Math.max(0, Math.min(c, sc.size[i] - org[i])));
      const data = new Uint8Array(sh[0] * sh[1] * sh[2]);
      let p = 0;
      for (let z = 0; z < sh[2]; z++) for (let y = 0; y < sh[1]; y++) for (let x = 0; x < sh[0]; x++) {
        data[p++] = stubValue((org[0] + x + 0.5) * sc.resolution[0], (org[1] + y + 0.5) * sc.resolution[1], (org[2] + z + 0.5) * sc.resolution[2]);
      }
      return { data, shape: sh };
    },
    async getSlice(s, plane, index, rect, { signal } = {}) {
      vol.calls.slice++;
      await wait(signal);
      const sc = scales[s], a = PLANES[plane];
      const [u0, v0, u1, v1] = rect, w = u1 - u0, h = v1 - v0;
      const data = new Uint8Array(w * h);
      const p = [0, 0, 0];
      p[a.n] = (index + 0.5) * sc.resolution[a.n];
      for (let v = 0; v < h; v++) {
        p[a.v] = (v0 + v + 0.5) * sc.resolution[a.v];
        for (let u = 0; u < w; u++) {
          p[a.u] = (u0 + u + 0.5) * sc.resolution[a.u];
          data[v * w + u] = stubValue(p[0], p[1], p[2]);
        }
      }
      return { data, width: w, height: h };
    },
  };
  if (o.noSlice) delete vol.getSlice;
  return vol;
}
