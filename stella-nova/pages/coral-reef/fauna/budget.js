// ============================================================================
//  CORAL REEF  ·  fauna/budget.js  ·  creature budgets per device profile
// ----------------------------------------------------------------------------
//  DOM-free. The profile ids are those of budget.js (desktop, laptop-low,
//  phone, phone-min). Phones get fewer animals, a smaller ring, the far
//  model (LOD 1) of each scan as their near model, 256 px textures and no
//  creature shadows.
//
//    ring ......... m, chunks with their centre nearer than this get animals
//    unload ....... m, a chunk farther than this drops its animals
//    maxAgents .... animals alive at most (all chunks)
//    maxPerChunk .. animals in one chunk at most
//    groupK ....... the group size factor (schools are smaller on phones)
//    lod0, lod1 ... m, the near model up to lod0, the far model up to lod1,
//                   beyond that up to `draw` only the glow halo (if any)
//    draw ......... m, nothing past this (the dark water hides it)
//    tex .......... the scan texture size (512 or 256)
//    scanLod ...... the scan file for the near model: 0 (<id>.glb) or 1
//                   (<id>-lod1.glb)
//    scanSlots .... scan species loaded at once (the least used is freed)
//    shadows ...... the near creatures cast into the lamp shadow maps
//    halos ........ far glow sprites at most (lod 2 glowing animals only)
//    simEvery ..... frames between the rock checks of one animal
//    assetMB ...... MB of scan files a profile may fetch (tests check it)
//
//  grep -n targets: "export const FAUNA_BUDGET", "export function faunaBudget"
// ============================================================================

export const FAUNA_BUDGET = {
  desktop: { ring: 80, unload: 104, maxAgents: 2600, maxPerChunk: 240, groupK: 1, lod0: 22, lod1: 70, draw: 100, tex: 512, scanLod: 0, scanSlots: 40, shadows: true, halos: 200, simEvery: 3, assetMB: 8 },
  'laptop-low': { ring: 64, unload: 84, maxAgents: 1500, maxPerChunk: 150, groupK: 0.7, lod0: 15, lod1: 52, draw: 78, tex: 512, scanLod: 0, scanSlots: 28, shadows: false, halos: 120, simEvery: 4, assetMB: 6 },
  phone: { ring: 48, unload: 64, maxAgents: 720, maxPerChunk: 80, groupK: 0.45, lod0: 9, lod1: 36, draw: 56, tex: 256, scanLod: 1, scanSlots: 14, shadows: false, halos: 60, simEvery: 5, assetMB: 2 },
  'phone-min': { ring: 40, unload: 54, maxAgents: 360, maxPerChunk: 45, groupK: 0.3, lod0: 7, lod1: 28, draw: 46, tex: 256, scanLod: 1, scanSlots: 8, shadows: false, halos: 30, simEvery: 6, assetMB: 1.2 },
};

export function faunaBudget(profileId) { return FAUNA_BUDGET[profileId] || FAUNA_BUDGET['phone-min']; }
