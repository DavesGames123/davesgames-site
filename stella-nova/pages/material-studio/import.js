// ============================================================================
//  MATERIAL STUDIO  ·  import.js — map, graph and image import   [STUB]
// ────────────────────────────────────────────────────────────────────────────
//  Owner: IO agent. Image files become image nodes wired to the Material
//  Output by filename. Also hosts the optional "Image to PBR (server)" import
//  that calls the material-lab server API.
// ============================================================================

/**
 * @param {FileList|File[]} files
 * @returns {Promise<{added:string[], skipped:string[]}>} node ids added, file names skipped
 */
export async function importMaps(files) { return { added: [], skipped: [...files].map(f => f.name) }; }

/** @param {object} ctx main.js module context */
export async function init(ctx) {}
