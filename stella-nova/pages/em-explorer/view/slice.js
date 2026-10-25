// ============================================================================
//  VIEW SLICE  ·  get one 2D tile from a Volume (DATA API or chunk fallback)
// ----------------------------------------------------------------------------
//  fetchSlice(vol, s, plane, index, rect, signal, priority) -> { data, width, height }
//  rect = [u0, v0, u1, v1) voxels of scale s on the plane axes (camera.js
//  PLANES). Rows run along v. The function uses vol.getSlice when the volume
//  has it. A volume with yzOrder 'yz' gives yz tiles with rows along z; the
//  function transposes them. Without getSlice it reads the chunks with
//  vol.getChunk and copies the plane out (assembleSlice).
//
//  Chunk layout: getChunk -> { data: Uint8Array, shape: [sx, sy, sz] },
//  x fastest; a chunk at the volume edge can be smaller than scale.chunk.
//
//  GREP MAP
//    grep -n 'export async function fetchSlice'
//    grep -n 'export async function assembleSlice'
//    grep -n 'export function transpose'
// ============================================================================
import { PLANES } from './camera.js';

export function transpose(data, w, h) {
  // data is h rows of w; result is w rows of h
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[x * h + y] = data[y * w + x];
  return out;
}

export async function fetchSlice(vol, s, plane, index, rect, signal, priority = 0) {
  const w = rect[2] - rect[0], h = rect[3] - rect[1];
  if (typeof vol.getSlice === 'function') {
    const r = await vol.getSlice(s, plane, index, rect, { signal, priority });
    if (!r) return { data: new Uint8Array(w * h), width: w, height: h };
    let data = r.data instanceof Uint8Array ? r.data : new Uint8Array(r.data.buffer || r.data);
    let width = r.width ?? w, height = r.height ?? h;
    if (plane === 'yz' && vol.yzOrder === 'yz') {
      // rows along z with width along y: turn into rows along y, width along z
      data = transpose(data, width, height);
      [width, height] = [height, width];
    }
    return { data, width, height };
  }
  return assembleSlice(vol, s, plane, index, rect, signal);
}

export async function assembleSlice(vol, s, plane, index, rect, signal) {
  const sc = vol.scales[s], a = PLANES[plane];
  const [u0, v0, u1, v1] = rect, w = u1 - u0, h = v1 - v0;
  const out = new Uint8Array(w * h);
  const cu = sc.chunk[a.u], cv = sc.chunk[a.v], cn = sc.chunk[a.n];
  const cnIdx = Math.floor(index / cn);
  const jobs = [];
  for (let c_v = Math.floor(v0 / cv); c_v * cv < v1; c_v++) {
    for (let c_u = Math.floor(u0 / cu); c_u * cu < u1; c_u++) {
      const cc = [0, 0, 0];
      cc[a.u] = c_u; cc[a.v] = c_v; cc[a.n] = cnIdx;
      jobs.push(Promise.resolve(vol.getChunk(s, cc, { signal })).then(ch => {
        if (!ch || !ch.data) return;
        const sh = ch.shape, d = ch.data;
        const org = [cc[0] * sc.chunk[0], cc[1] * sc.chunk[1], cc[2] * sc.chunk[2]];
        const ln = index - org[a.n];
        if (ln < 0 || ln >= sh[a.n]) return;
        const stride = [1, sh[0], sh[0] * sh[1]];
        const ou = org[a.u], ov = org[a.v];
        const uu0 = Math.max(u0, ou), uu1 = Math.min(u1, ou + sh[a.u]);
        const vv0 = Math.max(v0, ov), vv1 = Math.min(v1, ov + sh[a.v]);
        const base = ln * stride[a.n];
        for (let v = vv0; v < vv1; v++) {
          const rowSrc = base + (v - ov) * stride[a.v];
          const rowDst = (v - v0) * w - u0;
          if (stride[a.u] === 1) {
            out.set(d.subarray(rowSrc + (uu0 - ou), rowSrc + (uu1 - ou)), rowDst + uu0);
          } else {
            const su = stride[a.u];
            for (let u = uu0; u < uu1; u++) out[rowDst + u] = d[rowSrc + (u - ou) * su];
          }
        }
      }));
    }
  }
  await Promise.all(jobs);
  return { data: out, width: w, height: h };
}
