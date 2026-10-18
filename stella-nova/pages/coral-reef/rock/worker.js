// ============================================================================
//  CORAL REEF  ·  rock/worker.js  ·  meshes rock chunks off the main thread
// ----------------------------------------------------------------------------
//  Module worker for rock/index.js createRockAsync. Message in:
//    { seed, radius, detail, quality, chunks: [[i, j, k], ...] }
//  Message out: { meshes: [{ key, positions, normals, cavity, band, indices }], ms }
//  (array buffers are transferred). The worker makes the same plan from the
//  seed, so the main thread sends no grids. work(msg) is exported for node.
// ============================================================================
import { makeGeology } from './geology.js';
import { meshLayout, meshChunk } from './mesh.js';

export function work(msg) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const geo = makeGeology({ seed: msg.seed, radius: msg.radius, detail: msg.detail, quality: msg.quality });
  const lay = meshLayout(geo, msg.quality);
  const meshes = [], transfer = [];
  for (const [i, j, k] of msg.chunks) {
    const m = meshChunk(geo, lay, i, j, k);
    if (!m || m.empty) continue;
    meshes.push({ key: m.key, positions: m.positions, normals: m.normals, cavity: m.cavity, band: m.band, indices: m.indices });
    transfer.push(m.positions.buffer, m.normals.buffer, m.cavity.buffer, m.band.buffer, m.indices.buffer);
  }
  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return { out: { meshes, ms }, transfer };
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof window === 'undefined') {
  self.onmessage = e => {
    const { out, transfer } = work(e.data);
    self.postMessage(out, transfer);
  };
}
