// ============================================================================
//  MATERIAL STUDIO  ·  env.js — HDRI environment and lights   [STUB]
// ────────────────────────────────────────────────────────────────────────────
//  Owner: ENVIRONMENT agent. Loads HDRI presets, prefilters them for split-sum
//  IBL, and gives the viewport its bind group resources.
// ============================================================================

/** @param {object} ctx main.js module context */
export async function init(ctx) {}

/** @param {string} name preset id @returns {Promise<void>} */
export async function setPreset(name) {}

/** Load a user .hdr (Radiance RGBE) file. @param {File|Blob} file @returns {Promise<void>} */
export async function loadHDR(file) {}

/**
 * Resources for the viewport IBL. null before the first environment is ready.
 * @returns {null|{radiance:GPUTexture, irradiance:GPUTexture, brdfLut:GPUTexture,
 *                 sampler:GPUSampler, mipCount:number, rotation:number, intensity:number}}
 */
export function getEnvBindings() { return null; }
