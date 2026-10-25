// ============================================================================
//  STEREOGRAM MODELS  ·  models/index.js — the model library (no DOM)
// ----------------------------------------------------------------------------
//  Scans and models of real things for depth maps. Each GLB holds one
//  mesh: int16 positions (KHR_mesh_quantization) in a unit box at the
//  origin (the largest half side is 1), +y up, and an index buffer. No
//  normals, no UVs, no textures. models/build/build.mjs makes the files
//  and list.js; CREDITS.md (one folder up) gives every source and licence.
//
//  MODELS = [{ id, name, kind, file, credit, licence, url, view: { yaw,
//              pitch }, triangles }]
//    kind: statue, skull, fossil, animal, machine, tool, food, plant,
//    artefact, test. KINDS gives the order and the labels.
//    view: the default depth-map view in degrees (depth.js angles).
//  loadModel(id, opts?) -> Promise<{ id, record, positions: Float32Array,
//              indices: Uint32Array, triangleCount, bounds }>
//    opts.readBytes(url) -> Promise<ArrayBuffer> replaces fetch (node).
//    The promise is cached per id.
//  modelUrl(id) -> the absolute URL of the GLB.
//
//  grep -n targets: "export const MODELS", "export function loadModel"
// ============================================================================
import { parseGLB } from '../../../lib/glb-lite.js';
import { MODEL_LIST } from './list.js';

export const KINDS = [
  { id: 'statue', name: 'Statues and busts' }, { id: 'skull', name: 'Skulls' }, { id: 'fossil', name: 'Fossils' },
  { id: 'animal', name: 'Animals and shells' }, { id: 'machine', name: 'Machines' }, { id: 'tool', name: 'Tools' },
  { id: 'food', name: 'Food' }, { id: 'plant', name: 'Plants' }, { id: 'artefact', name: 'Historical artefacts' },
  { id: 'test', name: 'Test models' },
];
export const MODELS = MODEL_LIST.map(m => Object.freeze(Object.assign({}, m, { view: Object.freeze(Object.assign({}, m.view)) })));
export const modelById = id => MODELS.find(m => m.id === id) || null;
export const modelUrl = id => new URL(modelById(id).file, import.meta.url).href;

const cache = new Map();
export function loadModel(id, opts = {}) {
  const record = modelById(id);
  if (!record) return Promise.reject(new Error('loadModel: unknown model ' + id));
  if (!opts.readBytes && cache.has(id)) return cache.get(id);
  const url = modelUrl(id);
  const read = opts.readBytes || (async u => { const r = await fetch(u); if (!r.ok) throw new Error('loadModel: ' + r.status + ' ' + u); return r.arrayBuffer(); });
  const p = read(url).then(buf => {
    const scene = parseGLB(buf);
    const m = scene.meshes[0];
    return { id, record, positions: m.positions, indices: m.indices, triangleCount: m.triangleCount, bounds: scene.bounds };
  });
  if (!opts.readBytes) { cache.set(id, p); p.catch(() => cache.delete(id)); }
  return p;
}
