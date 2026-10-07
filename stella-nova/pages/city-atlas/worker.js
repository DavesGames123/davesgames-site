// worker.js — loads a city off the main thread: fetch, inflate, decode
// (data.js), then the building mesh and the building height raster
// (mesh.js). It posts everything back as transferable buffers, so a city
// can preload during a saver shot without a dropped frame.
//
// message in:  { id, url, rasterN }
// message out: { id, ok, meta, arrays, mesh: { vertices, indices, count, tallest },
//                bRaster, bHalf, bN } or { id, ok: false, error }
//
// grep: onmessage

import { loadCity, buildingsOf } from './data.js';
import { buildMesh, heightRaster } from './mesh.js';

self.onmessage = async (e) => {
  const { id, url, rasterN } = e.data;
  try {
    const city = await loadCity(url);
    const b = buildingsOf(city);
    const mesh = buildMesh(b);
    const bHalf = city.meta.bHalf;
    const bN = rasterN || 1024;
    const bRaster = heightRaster(b, bHalf, bN);
    const transfer = [mesh.vertices, mesh.indices.buffer, bRaster.buffer];
    const arrays = {};
    for (const [k, a] of Object.entries(city.arrays)) {
      if (k.startsWith('b_')) continue;          // the mesh replaces them
      arrays[k] = { data: a, shape: a.shape };
      transfer.push(a.buffer);
    }
    self.postMessage({ id, ok: true, meta: city.meta, arrays, mesh, bRaster, bHalf, bN }, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
