// ============================================================================
//  MATERIAL STUDIO  ·  mesh.js — procedural preview meshes   [STUB]
// ────────────────────────────────────────────────────────────────────────────
//  Owner: VIEWPORT agent. Imported by viewport.js and glb.js, not by main.js.
// ============================================================================

/**
 * @typedef {{positions:Float32Array, normals:Float32Array, uvs:Float32Array,
 *            tangents:Float32Array, indices:Uint32Array}} MeshData
 *   tangents are vec4 (xyz, w = bitangent sign)
 */

/** @param {string} name one of contract MESHES @param {{subdiv?:number}} [opts] @returns {MeshData} */
export function buildMesh(name, opts = {}) { throw new Error('buildMesh is not implemented yet'); }
