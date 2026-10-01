// ============================================================================
//  MATERIAL STUDIO  ·  export.js — engine packages   [STUB]
// ────────────────────────────────────────────────────────────────────────────
//  Owner: IO agent. Reads state.maps back from the GPU, packs channels per
//  target (contract EXPORT_TARGETS), and writes a zip with zip.js / glb.js.
// ============================================================================

/**
 * @param {string} target  an EXPORT_TARGETS id
 * @param {{res?:number, name?:string, format?:'png'|'tga', includeGraph?:boolean}} [opts]
 * @returns {Promise<Blob>} the zip (or .glb for 'gltf')
 */
export async function exportPackage(target, opts = {}) { throw new Error('exportPackage is not implemented yet'); }

/** @param {object} ctx main.js module context */
export async function init(ctx) {}
