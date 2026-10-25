// 2D slice assembly for the em-explorer DATA package.
//
// Plane axes (VIEW convention, NOTES.md): (u, v, normal) =
//   xy: (x, y, z)   xz: (x, z, y)   yz: (z, y, x)
// rect = [u0, v0, u1, v1) in voxels of the scale. The output is row-major
// with rows along v. Voxels outside the volume stay 0.

export const PLANES = {
  xy: [0, 1, 2],
  xz: [0, 2, 1],
  yz: [2, 1, 0],
};

export function planeAxes(plane) {
  const p = PLANES[plane];
  if (!p) throw new Error('em-explorer DATA: plane must be xy, xz or yz (got ' + plane + ')');
  return p;
}

// Chunk grid positions that a slice needs, nearest to the rect centre first.
export function sliceChunks(scale, plane, index, rect) {
  const [ua, va, na] = planeAxes(plane);
  const { size, chunk } = scale;
  if (!(index >= 0 && index < size[na])) return [];
  const u0 = Math.max(0, rect[0]), v0 = Math.max(0, rect[1]);
  const u1 = Math.min(size[ua], rect[2]), v1 = Math.min(size[va], rect[3]);
  if (u1 <= u0 || v1 <= v0) return [];
  const cn = Math.floor(index / chunk[na]);
  const out = [];
  const cu0 = Math.floor(u0 / chunk[ua]), cu1 = Math.floor((u1 - 1) / chunk[ua]);
  const cv0 = Math.floor(v0 / chunk[va]), cv1 = Math.floor((v1 - 1) / chunk[va]);
  const mu = (u0 + u1) / 2, mv = (v0 + v1) / 2;
  for (let cv = cv0; cv <= cv1; cv++) {
    for (let cu = cu0; cu <= cu1; cu++) {
      const c = [0, 0, 0];
      c[ua] = cu; c[va] = cv; c[na] = cn;
      const du = (cu + 0.5) * chunk[ua] - mu, dv = (cv + 0.5) * chunk[va] - mv;
      out.push({ c, d: du * du + dv * dv });
    }
  }
  out.sort((a, b) => a.d - b.d);
  return out.map((o) => o.c);
}

// Copies the part of one chunk that lies in the slice into out.
export function copyChunkPlane(out, scale, plane, index, rect, c, data, shape) {
  const [ua, va, na] = planeAxes(plane);
  const { chunk, size } = scale;
  const w = rect[2] - rect[0];
  const stride = [1, shape[0], shape[0] * shape[1]];
  const ln = index - c[na] * chunk[na];
  if (ln < 0 || ln >= shape[na]) return;
  const ou = c[ua] * chunk[ua], ov = c[va] * chunk[va];
  const ua0 = Math.max(rect[0], ou, 0), ua1 = Math.min(rect[2], ou + shape[ua], size[ua]);
  const va0 = Math.max(rect[1], ov, 0), va1 = Math.min(rect[3], ov + shape[va], size[va]);
  if (ua1 <= ua0 || va1 <= va0) return;
  const su = stride[ua], sv = stride[va];
  const base = ln * stride[na];
  const n = ua1 - ua0;
  for (let v = va0; v < va1; v++) {
    const src = base + (v - ov) * sv + (ua0 - ou) * su;
    const dst = (v - rect[1]) * w + (ua0 - rect[0]);
    if (su === 1) out.set(data.subarray(src, src + n), dst);
    else for (let i = 0, s = src; i < n; i++, s += su) out[dst + i] = data[s];
  }
}

// getChunk(c) -> Promise<{ data, shape }>
export async function assembleSlice(scale, plane, index, rect, getChunk) {
  const w = rect[2] - rect[0], h = rect[3] - rect[1];
  if (!(w > 0 && h > 0)) throw new Error('em-explorer DATA: empty rect');
  const out = new Uint8Array(w * h);
  const cs = sliceChunks(scale, plane, index, rect);
  await Promise.all(cs.map((c) => getChunk(c).then((r) =>
    copyChunkPlane(out, scale, plane, index, rect, c, r.data, r.shape))));
  return { data: out, width: w, height: h };
}
