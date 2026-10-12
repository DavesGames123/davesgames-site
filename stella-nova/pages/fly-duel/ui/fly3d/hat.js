// ============================================================================
//  FLY DUEL  ·  ui/fly3d/hat.js  ·  the fedora model (models/fedora.glb)
// ----------------------------------------------------------------------------
//  This module loads the fedora mesh that the competitor fly wears. The
//  mesh is "Fedora" by Poly by Google, CC BY 3.0, from Poly Pizza
//  (https://poly.pizza/m/8TpZrCG3aRf). ui/fly3d/HAT-CREDITS.md gives the
//  credit and the changes we made.
//
//  models/fedora.glb is in head-local units of ui/fly3d/fly.js. The origin
//  is the crown centre on the brim plane, +Y is up and the front pinch of
//  the crown points to +Z (the fly faces +Z). The brim is 0.51 wide, about
//  1.7 times the head capsule width. The file has three nodes:
//  fedora-crown, fedora-brim and fedora-band, two materials (felt and band)
//  and only POSITION, NORMAL and uint16 indices.
//
//  three r160 in vendor/ has no GLTFLoader, so parseFedoraGlb() reads the
//  GLB itself. The reader accepts only what the file holds: float32 VEC3
//  attributes, uint16 or uint32 indices, pbrMetallicRoughness factors.
//
//  loadFedora() fetches the file one time and keeps the result. Each hat
//  gets its own Mesh objects. The geometry and the materials are shared
//  and are not disposed with one hat. fly.js addFedora() shows its
//  procedural fedora at once and swaps in the model when the load is done.
//  In node, or when the fetch fails, the procedural fedora stays.
//
//  GREP MAP   (grep -n "^export" ui/fly3d/hat.js)
//    FEDORA_URL          URL of models/fedora.glb
//    parseFedoraGlb(ab)  ArrayBuffer -> { parts: [{ name, geometry, material }] }
//    loadFedora(opts)    fetch + parse, cached promise
//    fedoraModel()       the cached model or null
//    fedoraState()       'idle' | 'loading' | 'ready' | 'failed'
//    setFedoraModel(m)   put a parsed model in the cache (node tests)
//    fedoraMeshes(m)     new Mesh objects for one hat
// ============================================================================
import * as THREE from 'three';

export const FEDORA_URL = new URL('../../models/fedora.glb', import.meta.url);

let cache = null, pending = null, state = 'idle';

const COMP = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

export function parseFedoraGlb(ab) {
  const dv = new DataView(ab);
  if (dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(4, true) !== 2) throw new Error('fedora: not a glTF 2 binary');
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 20, jsonLen)));
  const binStart = 20 + jsonLen + 8;
  const read = (i) => {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView];
    const T = COMP[a.componentType], n = SIZE[a.type];
    if (!T || !n || (bv.byteStride && bv.byteStride !== n * T.BYTES_PER_ELEMENT)) throw new Error('fedora: accessor layout not handled');
    const start = binStart + (bv.byteOffset || 0) + (a.byteOffset || 0);
    return new T(ab.slice(start, start + a.count * n * T.BYTES_PER_ELEMENT));
  };
  const mats = (json.materials || []).map((m) => {
    const p = m.pbrMetallicRoughness || {}, c = p.baseColorFactor || [1, 1, 1, 1];
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(c[0], c[1], c[2]),      // linear factors, as glTF stores them
      roughness: p.roughnessFactor ?? 1, metalness: p.metallicFactor ?? 0,
      side: m.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    });
    mat.name = m.name || '';
    return mat;
  });
  const parts = [];
  for (const node of json.nodes || []) {
    if (node.mesh == null) continue;
    for (const prim of json.meshes[node.mesh].primitives) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(read(prim.attributes.POSITION), 3));
      if (prim.attributes.NORMAL != null) g.setAttribute('normal', new THREE.BufferAttribute(read(prim.attributes.NORMAL), 3));
      if (prim.indices != null) g.setIndex(new THREE.BufferAttribute(read(prim.indices), 1));
      if (!g.attributes.normal) g.computeVertexNormals();
      g.computeBoundingBox(); g.computeBoundingSphere();
      parts.push({ name: node.name || json.meshes[node.mesh].name, geometry: g, material: mats[prim.material ?? 0] || new THREE.MeshStandardMaterial() });
    }
  }
  return { parts, copyright: json.asset?.copyright || '' };
}

export function loadFedora(opts = {}) {
  if (cache) return Promise.resolve(cache);
  if (pending) return pending;
  const f = opts.fetch || globalThis.fetch;
  if (typeof f !== 'function') { state = 'failed'; return Promise.resolve(null); }
  state = 'loading';
  pending = Promise.resolve()
    .then(() => f(opts.url || FEDORA_URL))
    .then((r) => { if (!r.ok) throw new Error(`fedora: HTTP ${r.status}`); return r.arrayBuffer(); })
    .then((ab) => { cache = parseFedoraGlb(ab); state = 'ready'; return cache; })
    .catch(() => { state = 'failed'; pending = null; return null; });
  return pending;
}

export function fedoraModel() { return cache; }
export function fedoraState() { return state; }
export function setFedoraModel(m) { cache = m; state = m ? 'ready' : 'idle'; pending = null; return m; }

export function fedoraMeshes(model = cache) {
  if (!model) return [];
  return model.parts.map((p) => {
    const m = new THREE.Mesh(p.geometry, p.material);
    m.name = p.name; m.castShadow = true; m.receiveShadow = true;
    return m;
  });
}
