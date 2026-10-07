// worker.js — loads a city off the main thread: fetch, inflate, decode
// (data.js), then the building mesh and the building height raster
// (mesh.js). It posts the result in two stages as transferable buffers, so
// the terrain can draw before the buildings are built (low detail first),
// and a city can preload during a saver shot without a dropped frame.
//
// message in:   { id, url, rasterN }
// message out:  1. { id, ok, stage: 'base', meta, arrays, hInData, hOutData, timing }
//               2. { id, ok, stage: 'full', mesh: { vertices, indices, count, tallest, lod },
//                    bRaster, bHalf, bN, timing }
//               or { id, ok: false, error }
// hInData / hOutData are the packed height textures (packHeights); timing
// has the ms of each step, for the debug handle (main.js __cityAtlas.loads).
//
// grep: onmessage  function packHeights

import { inflate, parseCity, buildingsOf } from './data.js';
import { buildMesh, heightRaster } from './mesh.js';

// ground, surface (0.1 m int16) and water fraction (u8 at k x the grid) -> rgba32float
function packHeights(ground, surf, wf) {
  const n = ground.shape[0], wn = wf.shape[0], k = wn / n;
  const out = new Float32Array(n * n * 4);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const o = (j * n + i) * 4, s = j * n + i;
    out[o] = ground[s] * 0.1;
    out[o + 1] = surf[s] * 0.1;
    let w = 0;
    for (let b = 0; b < k; b++) for (let a = 0; a < k; a++) w += wf[(j * k + b) * wn + i * k + a];
    out[o + 2] = w / (k * k * 255);
  }
  return out;
}

self.onmessage = async (e) => {
  const { id, url, rasterN } = e.data;
  try {
    const T = [performance.now()];
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    T.push(performance.now());
    const raw = await inflate(bytes);
    T.push(performance.now());
    const city = parseCity(raw);
    T.push(performance.now());
    // the height textures (rgba32float), packed here so the main thread only uploads
    const A = city.arrays;
    const hInData = packHeights(A.t_in, A.s_in, A.wf_in);
    const hOutData = packHeights(A.t_out, A.s_out, A.wf_out);
    T.push(performance.now());
    // the building arrays stay here for the mesh; the rest goes now
    const b = buildingsOf(city);
    const arrays = {}, transfer = [hInData.buffer, hOutData.buffer];
    for (const [k, a] of Object.entries(A)) {
      if (k.startsWith('b_')) continue;
      arrays[k] = { data: a, shape: a.shape };
      transfer.push(a.buffer);
    }
    const timing = { bytes: bytes.length, fetchMs: T[1] - T[0], inflateMs: T[2] - T[1], parseMs: T[3] - T[2], packMs: T[4] - T[3] };
    self.postMessage({ id, ok: true, stage: 'base', meta: city.meta, arrays, hInData, hOutData, timing }, transfer);
    // stage 2: the merged building mesh (largest first, for the LOD) and the raster
    const t5 = performance.now();
    const mesh = buildMesh(b);
    const t6 = performance.now();
    const bHalf = city.meta.bHalf;
    const bN = rasterN || 1024;
    const bRaster = heightRaster(b, bHalf, bN);
    const t7 = performance.now();
    self.postMessage({ id, ok: true, stage: 'full', mesh, bRaster, bHalf, bN, timing: { meshMs: t6 - t5, rasterMs: t7 - t6 } },
      [mesh.vertices, mesh.indices.buffer, bRaster.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
