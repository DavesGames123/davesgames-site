// ============================================================================
//  CORAL REEF  ·  coral surfaces from the shared DLA tree (DOM-free)
// ----------------------------------------------------------------------------
//  One createTreeSdf of lib/dla-sdf.js per SPECIES, in the world frame
//  (metres). All colonies of a species write into the same field, so two
//  colonies of one species that touch fuse into one smooth surface (the
//  smooth minimum joins them). Colonies of two species have two fields:
//  where they meet, the contact terms (CONTACTS) make one fused surface
//  with a seam on the line where the two meet. Each field: round
//  cones along the parent links, radius from the subtree size (pipe rule),
//  joined with a smooth minimum, meshed brick by brick with surface nets,
//  only the bricks that changed. The species set the look with the cone
//  radii, the blend and a post term (a pure per-point shape term that
//  lib/dla-sdf.js applies at mesh time):
//    staghorn ... thin tapered branches (1.2 cm tips), round tips
//    fan ........ thin ribs, and a web: a slab in the fan plane where two
//                 ribs are near, so the fan is a fine webbed net
//    table ...... a stalk, then a flat plate: cones cut to a slab at the
//                 height of each plate particle
//    boulder .... (brain coral) fat cones and a wide blend give a smooth
//                 dome; a groove term cuts meandering valleys
//    finger ..... soft lobes with a wide blend
//  Every species of reef.js SPECIES has a SHAPES entry. The post term is
//  sh.post: 'web' (fans), 'plate' (the plate species, tilted by the colony
//  tilt), 'palmate' (elkhorn: a flat web at each particle height),
//  'groove' (the brain coral). sh.skin is the skin code of shaders.js
//  CORAL_FS (SKIN_CODE), sh.polyp the polyp density, size and look
//  (POLYP_LOOK: tentacle reach, tint, fluorescence; trunk and under: the
//  share kept on old trunks and on undersides; range: the tested polyps
//  per m^2).
//
//  Each vertex carries the global particle id (gid), so the page colours
//  the surface from per-particle data (no re-mesh on a colour change).
//
//  POLYPS. scatterPolyps() puts polyp cups on the triangles of a brick by
//  area: SHAPES[id].polyp.density per m^2 (x the quality scale), more at
//  the tips. Each polyp is 8 floats: x y z, nx ny nz (surface normal),
//  gid, rand. rand is uniform in 0..1 and independent of the place, so the
//  page can cull polyps by distance (LOD): draw a polyp when rand < keep(d).
//  SHAPES[id].polyp.size is the polyp radius (m) for the page template.
//
//  LOD. Each species has one coarse field (LOD_K x the cell, thin parts
//  made half a coarse cell thick) that holds every colony. Each FOCUS
//  colony (the nearest to the cameras, set by setFocus) has a fine field
//  of its own (the SHAPES cell, origin at the colony base). So the fine
//  triangles stay in the budget, and far colonies cost little. Polyps are
//  only on the fine bricks. A focus change touches only the fine field of
//  the colony that changed: a new focus colony gets a new field, a colony
//  that leaves the focus loses its field. The fine bricks of the other
//  colonies are not meshed again (the user said: "the corals get
//  reconstructed over and over in front of my very eyes instead of
//  staying totally locked in"). Fine-field events (M.takeEvents()):
//    { k, state: 'complete' }  every brick that the field had when it was
//                              made is meshed and out: the page can show
//                              the fine mesh and hide the coarse one
//    { k, state: 'drop' }      the field is gone: the page shows the
//                              coarse mesh, then removes the fine one
//    { k: -1, state: 'coarse' } (once) every coarse field is meshed
//  (no brick removals are sent for a dropped field). Two colonies of one
//  species fuse in the coarse field. With lod: false there is one fine
//  field per species (all colonies fuse).
//
//  CONTACTS (M.fuse, "function attachContact"). Where two fields meet (two
//  per-colony fine fields, two species, a guest colony), each field gets a
//  contact term from copies of the other near fields (guests): one fused
//  surface U = smin(own, other, fillet), cut on the wall where the two
//  cone folds are equal. Each colony meshes its part of U, closed by a
//  hidden wall; normals near a contact are grad U; polyps near the other
//  colony go. A guest colony (addColony { guest: true }) is not meshed:
//  only its particles go in, for the contact terms of the others.
//
//  ROOT AND ROCK. A colony with desc.foot (reef.js: the root height over
//  the rock site) and desc.normal gets a root cone down the normal into
//  the rock, so no colony floats; polyps on that foot under the base, and
//  (opts.solid) in the rock, go.
//
//  USE (the reef worker, node tests, thumbnails)
//    const M = createCoralMesher({ polyps, fine, radius, lod = true, gapMs = 250, clock, solid, frame });
//                                  // lod false: one fine field, all colonies
//                                  // solid(x, y, z): the rock distance (no polyp in it)
//                                  // frame: the world point of the mesher origin
//                                  // (the brain grooves of a colony in every mesher)
//                                  // gapMs: a growing field meshes at most once per gapMs
//                                  // (a brick that changes again goes out once);
//                                  // M.update(ms, out, true) skips the gap (growth over)
//    M.addColony({ k, id, base, plane, stalk, normal, foot, guest });   // colonyInfo() of reef.js
//    M.add(g, parent, x, y, z, k);                 // world metres, ids in order
//    M.bridge(g, j)                                // a fuse cone g -> j (reef.js R.bridges)
//    M.fuse()                                      // contact terms (all particles in; before meshAll)
//    M.fields: Map field key -> { id, lev, cell, origin, tree, SM (cone
//              ends, field frame), localOf (global id -> field id), ... }
//    M.setFocus([k, ...])                          // the fine-mesh colonies
//    M.takeEvents() -> [{ k, state: 'complete' | 'drop' }] (fine fields)
//    const out = M.update(ms);   // [{ sp, lod, field, k, key, chunk, bx, by, bz,
//                                //    cell, positions, normals, gids, indices,
//                                //    polyps, tris }]
//    M.meshAll(lev?) -> all brick results now (tests, thumbnails)
//    M.stats() -> { colonies, particles, bricks, tris, trisFine, trisCoarse,
//                   polyps, dirty, focus, fineDone }
//  k of a result: the colony of a per-colony fine field, else -1.
//
//  A result with no indices means "remove this brick". A brick is unique
//  by sp + lod + key (field: 'staghorn|0', 'staghorn|1', 'fan|0|12', ...;
//  the keys of a per-colony field are offset by a multiple of 2^30).
//  chunk is a CHUNK_M cube in world metres: the page draws one mesh per
//  sp + lod + chunk.
//
//  grep -n targets
//    species shapes ......... "export const SHAPES"
//    skin codes, polyp look . "export const SKIN_CODE", "export const POLYP_LOOK"
//    species scale .......... "export const SPECIES_SCALE"
//    the post terms ......... "function postFor"
//    brain groove ........... "export function groove"
//    polyp scatter .......... "export function scatterPolyps"
//    the mesher ............. "export function createCoralMesher"
//    chunk of a brick ....... "export function chunkKey"
//    smooth branch points ... "function smoothPoint"
//    the coarse field ....... "function makeField"
//    focus change ........... "function setFocus"
//    fuse bridges ........... "function bridge"
//    fine-field events ...... "function takeEvents"
//    contacts ............... "function fuse", "function attachContact", "function makeGuest"
//    seam normals, polyps ... "function contactNormals", "function keepPolyp"
//    root foot .............. "function footOf"
// ============================================================================
import { createSdf, pipeRadius, smin } from '../../lib/dla-sdf.js';

// Metres. cell: lattice spacing. k: blend. bend, hold: branch smoothing
// (the cone ends keep part of the parent direction, then move back toward
// the particle). rTip, pipe, rMax, sub0, quant: the pipe rule (lib/dla-sdf.js
// pipeRadius). rootScale: a root sphere is this much larger. band: stored
// field band (past the largest outward post term). polyp: density per m^2,
// tip (extra density at the tips), size (polyp radius, m), max per brick.
export const SHAPES = {
  staghorn: { cell: 0.0115, k: 0.026, bend: 0.5, hold: 0.25, rTip: 0.011, pipe: 4, rMax: 0.019, sub0: 3, quant: 0.16, rootScale: 1.4, band: 0.022, skin: 0,
    polyp: { density: 1900, tip: 2, size: 0.0032, max: 700, extend: 0.85, tint: [0.92, 0.86, 1.0], fluor: 0.7, range: [378, 1208] } },
  fan: { own: true, post: 'web', cell: 0.0055, k: 0.005, bend: 0.25, hold: 0.4, rTip: 0.0028, pipe: 3.5, rMax: 0.008, sub0: 3, quant: 0.2, rootScale: 2, band: 0.03, skin: 1,
    web: 0.011, half: 0.0028, polyp: { density: 6000, tip: 1, size: 0.0016, max: 900, extend: 1.0, tint: [1.0, 0.95, 0.92], fluor: 0.15, trunk: 0.35, range: [1600, 5118] } },
  table: { post: 'plate', cell: 0.016, k: 0.026, bend: 0.3, hold: 0.4, rTip: 0.015, pipe: 3, rMax: 0.05, sub0: 2, quant: 0.2, rootScale: 1.6, band: 0.034, skin: 2,
    inflate: 0.012, half: 0.011, polyp: { density: 2600, tip: 1.5, size: 0.003, max: 700, extend: 0.7, tint: [0.85, 1.0, 0.82], fluor: 0.9, range: [393, 1258] } },
  boulder: { post: 'groove', cell: 0.025, k: 0.1, chain: 1, rTip: 0.12, pipe: 4, rMax: 0.12, sub0: 3, quant: 0.25, rootScale: 1.3, band: 0.045, skin: 3,
    groove: 0.045, polyp: { density: 110, tip: 0, size: 0.006, max: 160, extend: 0.45, tint: [0.95, 0.9, 0.7], fluor: 0.5, trunk: 1, under: 0.5, range: [18, 56] } },
  finger: { cell: 0.012, k: 0.022, bend: 0.4, hold: 0.3, rTip: 0.019, pipe: 3.4, rMax: 0.04, sub0: 2, quant: 0.22, rootScale: 1.5, band: 0.03, skin: 4,
    polyp: { density: 2200, tip: 1, size: 0.0045, max: 700, extend: 1.0, tint: [1.0, 0.94, 0.96], fluor: 0.12, range: [464, 1483] } },

  // branching stony corals (cones along the branches; elkhorn: a flat web
  // between near branches at the height of each particle, so the branches
  // are broad and flat)
  elkhorn: { post: 'palmate', cell: 0.014, k: 0.03, bend: 0.45, hold: 0.3, rTip: 0.016, pipe: 3.6, rMax: 0.034, sub0: 2, quant: 0.18, rootScale: 1.5, band: 0.04, skin: 0,
    web: 0.022, half: 0.012, polyp: { density: 1200, tip: 1.5, size: 0.003, max: 700, extend: 0.6, tint: [0.96, 0.9, 0.8], fluor: 0.4, range: [227, 726] } },
  pocillopora: { cell: 0.01, k: 0.024, bend: 0.4, hold: 0.3, rTip: 0.012, pipe: 3.4, rMax: 0.026, sub0: 2, quant: 0.18, rootScale: 1.5, band: 0.026, skin: 13,
    polyp: { density: 1400, tip: 1, size: 0.0028, max: 700, extend: 0.5, tint: [1.0, 0.9, 0.9], fluor: 0.5, range: [336, 1074] } },
  stylophora: { cell: 0.012, k: 0.026, bend: 0.45, hold: 0.3, rTip: 0.017, pipe: 3.2, rMax: 0.03, sub0: 2, quant: 0.18, rootScale: 1.5, band: 0.03, skin: 5,
    polyp: { density: 1300, tip: 1.2, size: 0.003, max: 700, extend: 0.6, tint: [1.0, 0.92, 0.96], fluor: 0.4, range: [356, 1139] } },
  seriatopora: { cell: 0.0075, k: 0.016, bend: 0.4, hold: 0.3, rTip: 0.0065, pipe: 3.6, rMax: 0.014, sub0: 3, quant: 0.16, rootScale: 1.5, band: 0.018, skin: 0,
    polyp: { density: 1600, tip: 1.2, size: 0.0022, max: 700, extend: 0.5, tint: [1.0, 0.92, 0.94], fluor: 0.3, range: [441, 1411] } },
  pillar: { cell: 0.022, k: 0.06, bend: 0.5, hold: 0.3, rTip: 0.05, pipe: 4, rMax: 0.07, sub0: 2, quant: 0.2, rootScale: 1.6, band: 0.05, skin: 4,
    polyp: { density: 900, tip: 0.5, size: 0.004, max: 700, extend: 1.0, tint: [0.96, 0.92, 0.82], fluor: 0.2, range: [178, 570] } },

  // plating and foliose corals (cones cut to a plate that rises by the
  // colony tilt)
  montipora: { post: 'plate', cell: 0.013, k: 0.022, bend: 0.3, hold: 0.4, rTip: 0.012, pipe: 3, rMax: 0.034, sub0: 2, quant: 0.2, rootScale: 1.5, band: 0.03, skin: 5,
    inflate: 0.011, half: 0.008, polyp: { density: 2400, tip: 1, size: 0.0018, max: 800, extend: 0.35, tint: [0.96, 0.9, 0.86], fluor: 0.5, range: [400, 1282] } },
  turbinaria: { post: 'plate', cell: 0.013, k: 0.022, bend: 0.3, hold: 0.4, rTip: 0.013, pipe: 3, rMax: 0.036, sub0: 2, quant: 0.2, rootScale: 1.5, band: 0.032, skin: 5,
    inflate: 0.011, half: 0.009, polyp: { density: 1200, tip: 1, size: 0.003, max: 700, extend: 0.7, tint: [1.0, 0.98, 0.8], fluor: 0.6, range: [236, 757] } },
  pachyseris: { post: 'plate', cell: 0.013, k: 0.022, bend: 0.3, hold: 0.4, rTip: 0.012, pipe: 3, rMax: 0.03, sub0: 2, quant: 0.2, rootScale: 1.5, band: 0.03, skin: 8,
    inflate: 0.012, half: 0.006, polyp: { density: 300, tip: 0.5, size: 0.002, max: 400, extend: 0.2, tint: [0.92, 0.9, 0.8], fluor: 0.2, range: [42, 134] } },
  echinopora: { post: 'plate', cell: 0.013, k: 0.024, bend: 0.3, hold: 0.4, rTip: 0.013, pipe: 3, rMax: 0.034, sub0: 2, quant: 0.2, rootScale: 1.5, band: 0.032, skin: 0,
    inflate: 0.011, half: 0.009, polyp: { density: 1000, tip: 1, size: 0.003, max: 700, extend: 0.5, tint: [0.96, 0.96, 0.82], fluor: 0.5, range: [192, 616] } },
  merulina: { post: 'plate', cell: 0.013, k: 0.022, bend: 0.3, hold: 0.4, rTip: 0.013, pipe: 3, rMax: 0.034, sub0: 2, quant: 0.2, rootScale: 1.5, band: 0.032, skin: 2,
    inflate: 0.012, half: 0.009, polyp: { density: 700, tip: 1, size: 0.0028, max: 600, extend: 0.4, tint: [1.0, 0.94, 0.86], fluor: 0.4, range: [120, 386] } },

  // massive, encrusting and free-living corals (fat cones, a wide blend:
  // one smooth surface; the lobes come from the growth rule)
  porites: { cell: 0.024, k: 0.1, chain: 1, rTip: 0.11, pipe: 4, rMax: 0.11, sub0: 3, quant: 0.25, rootScale: 1.3, band: 0.04, skin: 5,
    polyp: { density: 900, tip: 0, size: 0.0016, max: 400, extend: 0.3, tint: [0.98, 0.94, 0.8], fluor: 0.3, trunk: 1, under: 0.5, range: [144, 462] } },
  favites: { cell: 0.02, k: 0.09, chain: 1, rTip: 0.1, pipe: 4, rMax: 0.1, sub0: 3, quant: 0.25, rootScale: 1.3, band: 0.04, skin: 6,
    polyp: { density: 150, tip: 0, size: 0.006, max: 200, extend: 0.45, tint: [0.9, 1.0, 0.8], fluor: 0.8, trunk: 1, under: 0.5, range: [37, 118] } },
  lobophyllia: { cell: 0.02, k: 0.09, chain: 1, rTip: 0.1, pipe: 4, rMax: 0.1, sub0: 3, quant: 0.25, rootScale: 1.3, band: 0.04, skin: 7,
    polyp: { density: 40, tip: 0, size: 0.012, max: 80, extend: 0.6, tint: [0.9, 1.0, 0.86], fluor: 0.6, trunk: 1, under: 0.5, range: [10, 32] } },
  encrusting: { cell: 0.018, k: 0.08, chain: 1, rTip: 0.08, pipe: 4, rMax: 0.08, sub0: 3, quant: 0.25, rootScale: 1.3, band: 0.035, skin: 5,
    polyp: { density: 1500, tip: 0, size: 0.0016, max: 500, extend: 0.3, tint: [0.96, 0.9, 0.96], fluor: 0.5, trunk: 1, under: 0.5, range: [292, 936] } },
  mushroom: { cell: 0.004, k: 0.016, chain: 1, rTip: 0.016, pipe: 4, rMax: 0.016, sub0: 3, quant: 0.25, rootScale: 1.3, band: 0.012, skin: 2,
    polyp: { density: 120, tip: 0, size: 0.004, max: 60, extend: 0.7, tint: [0.96, 1.0, 0.9], fluor: 0.6, trunk: 1, under: 0.2, range: [43, 138] } },

  // soft corals
  leather: { post: 'plate', cell: 0.012, k: 0.03, bend: 0.35, hold: 0.4, rTip: 0.02, pipe: 3, rMax: 0.05, sub0: 2, quant: 0.2, rootScale: 1.6, band: 0.04, skin: 9,
    inflate: 0.014, half: 0.016, polyp: { density: 600, tip: 0.5, size: 0.006, max: 600, extend: 1.0, tint: [1.0, 0.98, 0.9], fluor: 0.1, range: [120, 386] } },
  carnation: { cell: 0.008, k: 0.02, bend: 0.4, hold: 0.3, rTip: 0.008, pipe: 3.4, rMax: 0.03, sub0: 2, quant: 0.2, rootScale: 1.8, band: 0.024, skin: 9,
    polyp: { density: 500, tip: 4, size: 0.006, max: 600, extend: 0.9, tint: [1.0, 0.86, 0.9], fluor: 0.1, trunk: 0.05, range: [305, 976] } },
  xenia: { cell: 0.005, k: 0.012, bend: 0.4, hold: 0.3, rTip: 0.006, pipe: 3.4, rMax: 0.016, sub0: 2, quant: 0.2, rootScale: 1.6, band: 0.016, skin: 9,
    polyp: { density: 250, tip: 4, size: 0.009, max: 400, extend: 1.0, tint: [1.0, 1.0, 1.0], fluor: 0.1, trunk: 0.05, range: [240, 766] } },

  // gorgonians and sea fans
  seawhip: { cell: 0.007, k: 0.012, bend: 0.5, hold: 0.25, rTip: 0.006, pipe: 3.6, rMax: 0.012, sub0: 3, quant: 0.16, rootScale: 1.8, band: 0.018, skin: 1,
    polyp: { density: 1200, tip: 0.5, size: 0.003, max: 700, extend: 0.9, tint: [1.0, 0.92, 0.84], fluor: 0.1, range: [188, 603] } },
  searod: { cell: 0.009, k: 0.018, bend: 0.5, hold: 0.25, rTip: 0.011, pipe: 3.6, rMax: 0.02, sub0: 3, quant: 0.16, rootScale: 1.6, band: 0.024, skin: 9,
    polyp: { density: 1500, tip: 0.5, size: 0.0035, max: 700, extend: 1.0, tint: [0.96, 0.9, 0.8], fluor: 0.1, range: [392, 1254] } },
  annella: { own: true, post: 'web', cell: 0.005, k: 0.0045, bend: 0.25, hold: 0.4, rTip: 0.0025, pipe: 3.5, rMax: 0.007, sub0: 3, quant: 0.2, rootScale: 2, band: 0.028, skin: 1,
    web: 0.009, half: 0.0024, polyp: { density: 2000, tip: 1, size: 0.0016, max: 900, extend: 0.9, tint: [1.0, 0.96, 0.9], fluor: 0.1, trunk: 0.35, range: [483, 1547] } },

  // deep-sea corals, sponges, sea pens and sea lilies
  bubblegum: { cell: 0.016, k: 0.04, bend: 0.4, hold: 0.3, rTip: 0.022, pipe: 3.4, rMax: 0.05, sub0: 2, quant: 0.18, rootScale: 1.6, band: 0.04, skin: 13,
    polyp: { density: 400, tip: 3, size: 0.006, max: 600, extend: 0.8, tint: [1.0, 0.92, 0.92], fluor: 0, range: [104, 333] } },
  primnoa: { cell: 0.01, k: 0.022, bend: 0.4, hold: 0.3, rTip: 0.01, pipe: 3.4, rMax: 0.024, sub0: 2, quant: 0.18, rootScale: 1.6, band: 0.026, skin: 13,
    polyp: { density: 900, tip: 1, size: 0.005, max: 700, extend: 0.5, tint: [1.0, 0.9, 0.8], fluor: 0, range: [218, 698] } },
  blackcoral: { cell: 0.006, k: 0.012, bend: 0.45, hold: 0.3, rTip: 0.005, pipe: 3.6, rMax: 0.012, sub0: 3, quant: 0.16, rootScale: 1.8, band: 0.016, skin: 14,
    polyp: { density: 1500, tip: 1, size: 0.0025, max: 700, extend: 0.7, tint: [1.0, 0.96, 0.92], fluor: 0, range: [342, 1096] } },
  leiopathes: { cell: 0.009, k: 0.018, bend: 0.45, hold: 0.3, rTip: 0.009, pipe: 3.6, rMax: 0.02, sub0: 3, quant: 0.16, rootScale: 1.8, band: 0.022, skin: 14,
    polyp: { density: 1000, tip: 1, size: 0.003, max: 700, extend: 0.7, tint: [1.0, 0.96, 0.88], fluor: 0, range: [177, 566] } },
  bamboo: { cell: 0.009, k: 0.018, bend: 0.45, hold: 0.3, rTip: 0.009, pipe: 3.6, rMax: 0.022, sub0: 3, quant: 0.16, rootScale: 1.8, band: 0.022, skin: 12,
    polyp: { density: 500, tip: 1, size: 0.005, max: 600, extend: 0.8, tint: [1.0, 0.98, 0.96], fluor: 0, range: [108, 347] } },
  lophelia: { cell: 0.011, k: 0.026, bend: 0.3, hold: 0.4, rTip: 0.012, pipe: 3.4, rMax: 0.028, sub0: 2, quant: 0.18, rootScale: 1.5, band: 0.028, skin: 6,
    polyp: { density: 250, tip: 3, size: 0.006, max: 500, extend: 0.8, tint: [1.0, 0.98, 0.96], fluor: 0, range: [78, 248] } },
  madrepora: { cell: 0.007, k: 0.014, bend: 0.3, hold: 0.4, rTip: 0.006, pipe: 3.4, rMax: 0.014, sub0: 3, quant: 0.18, rootScale: 1.5, band: 0.018, skin: 6,
    polyp: { density: 300, tip: 2, size: 0.004, max: 500, extend: 0.7, tint: [1.0, 0.96, 0.94], fluor: 0, range: [99, 317] } },
  venus: { cell: 0.0035, k: 0.006, bend: 0.2, hold: 0.5, rTip: 0.0028, pipe: 3, rMax: 0.005, sub0: 3, quant: 0.2, rootScale: 2, band: 0.008, skin: 10,
    polyp: { density: 0, tip: 0, size: 0.002, max: 0, extend: 0, tint: [1, 1, 1], fluor: 0, range: [0, 0] } },
  glassvase: { cell: 0.008, k: 0.018, bend: 0.2, hold: 0.5, rTip: 0.009, pipe: 3, rMax: 0.014, sub0: 3, quant: 0.2, rootScale: 2, band: 0.02, skin: 11,
    polyp: { density: 0, tip: 0, size: 0.002, max: 0, extend: 0, tint: [1, 1, 1], fluor: 0, range: [0, 0] } },
  chimney: { cell: 0.007, k: 0.014, bend: 0.2, hold: 0.5, rTip: 0.007, pipe: 3, rMax: 0.012, sub0: 3, quant: 0.2, rootScale: 2, band: 0.018, skin: 10,
    polyp: { density: 0, tip: 0, size: 0.002, max: 0, extend: 0, tint: [1, 1, 1], fluor: 0, range: [0, 0] } },
  barrel: { cell: 0.01, k: 0.06, chain: 1, rTip: 0.022, pipe: 3, rMax: 0.03, sub0: 3, quant: 0.2, rootScale: 1.5, band: 0.035, skin: 11,
    polyp: { density: 0, tip: 0, size: 0.002, max: 0, extend: 0, tint: [1, 1, 1], fluor: 0, range: [0, 0] } },
  seapen: { cell: 0.005, k: 0.01, bend: 0.4, hold: 0.3, rTip: 0.0045, pipe: 3.4, rMax: 0.012, sub0: 2, quant: 0.18, rootScale: 1.6, band: 0.014, skin: 9,
    polyp: { density: 700, tip: 2, size: 0.003, max: 600, extend: 0.8, tint: [1.0, 0.94, 0.9], fluor: 0, trunk: 0.1, range: [348, 1114] } },
  crinoid: { cell: 0.0045, k: 0.008, bend: 0.4, hold: 0.3, rTip: 0.0035, pipe: 3.4, rMax: 0.009, sub0: 2, quant: 0.18, rootScale: 1.6, band: 0.012, skin: 9,
    polyp: { density: 1200, tip: 2, size: 0.0015, max: 700, extend: 1.0, tint: [1.0, 0.96, 0.86], fluor: 0, trunk: 0.05, range: [609, 1947] } },
};
export const SHAPE_IDS = Object.keys(SHAPES);
// The skin code of each species (scene.js uSpecies: the species branch of
// shaders.js CORAL_FS) and the polyp look (scene.js polyp materials).
export const SKIN_CODE = Object.fromEntries(SHAPE_IDS.map(id => [id, SHAPES[id].skin ?? 0]));
export const POLYP_LOOK = Object.fromEntries(SHAPE_IDS.map(id => {
  const p = SHAPES[id].polyp;
  return [id, { size: p.size, extend: p.extend ?? 0.7, tint: p.tint || [1, 1, 1], fluor: p.fluor ?? 0.2 }];
}));
// The blend of two cones of one branch (a particle and its parent), as a
// part of k. They meet on a shared end sphere, so the branch is smooth
// with a small blend; the full k there made a bead at every particle (the
// user: "the surface texture of growing corals along the normals is too
// rough"). The full k stays for forks, bridges and neighbours.
export const CHAIN_K = 0.15;

// ── species scale ───────────────────────────────────────────────────────────
// The user said (2026-10-18): "we should be able to simulate much large
// growing coral reef structures these are pathetically small for the size
// of seamount we're workign iwht". A species of scale s grows colonies s
// times larger with the same particle count: reef.js multiplies its
// particle spacing (and the other dlaf distances) by s. Here the lengths
// of its shape (cell, blend, radii, band, web, slab, groove) are
// multiplied by L = s^SDF_EXP (about 1.6 to 1.8), so the branches stay
// thinner than a plain copy x s would make them (the species look: thin
// branches on a large colony). Triangles per particle go up by s / L.
// Polyps: the density per m^2 goes down by L x sqrt(s) (the GPU holds
// every polyp), the polyp radius goes up by sqrt(L).
export const SPECIES_SCALE = {
  staghorn: 2.5, fan: 2, table: 2.3, boulder: 2.2, finger: 2.1,
  elkhorn: 2.4, pocillopora: 1.8, stylophora: 1.7, seriatopora: 1.7, pillar: 1.6,
  montipora: 2, turbinaria: 1.8, pachyseris: 2, echinopora: 1.9, merulina: 2,
  porites: 2.2, favites: 1.6, lobophyllia: 1.6, encrusting: 1.8, mushroom: 1,
  leather: 1.5, carnation: 1.4, xenia: 1,
  seawhip: 1.6, searod: 1.5, annella: 2.2,
  bubblegum: 2.4, primnoa: 1.8, blackcoral: 1.8, leiopathes: 2.2, bamboo: 1.8, lophelia: 2.2, madrepora: 1.6,
  venus: 1, glassvase: 1.3, chimney: 1.4, barrel: 1.4, seapen: 1.2, crinoid: 1.2,
};
export const SDF_EXP = 0.65;
const LEN_KEYS = ['cell', 'k', 'band', 'rTip', 'rMax', 'web', 'half', 'inflate', 'groove'];
// The user said (2026-10-18): "generally polyp density is too high". The
// densities of the table are about 0.35 to 0.45 x the old ones; fine
// stony corals (Porites, Montipora) keep many small polyps (a texture),
// large-polyp corals (Lobophyllia, Fungia, the soft corals) few large
// ones. polyp.trunk: the share kept on the old trunk (no tip), polyp.under:
// the share kept on faces that look down (scatterPolyps). polyp.range:
// the measured polyps per m^2 of the fine mesh that the tests accept.
for (const id of SHAPE_IDS) {
  const sh = SHAPES[id], sc = SPECIES_SCALE[id] || 1, L = Math.pow(sc, SDF_EXP);
  sh.scale = sc; sh.len = L;
  for (const k of LEN_KEYS) if (sh[k] !== undefined) sh[k] *= L;
  sh.polyp = Object.assign({}, sh.polyp, { density: sh.polyp.density / (L * Math.sqrt(sc)), size: sh.polyp.size * Math.sqrt(L), max: Math.ceil(sh.polyp.max * L) });
}
export const BRICK = 8;
export const CHUNK_M = 2;      // chunk edge (m): the page draws one mesh per chunk and species

// The chunk of a brick: bricks whose lower corner (world metres, field
// origin O added) is in one CHUNK_M cube.
export function chunkKey(bx, by, bz, cell, O = [0, 0, 0]) {
  const B = BRICK * cell, c = v => Math.floor(v / CHUNK_M);
  return `${c(bx * B + O[0])},${c(by * B + O[1])},${c(bz * B + O[2])}`;
}

function smax(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; }

// value noise (own code), -1..1
function vh(i, j, k) { let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1440662683); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 2147483648 - 1; }
export function noise3(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const fx = x - i, fy = y - j, fz = z - k;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const a = vh(i, j, k) + (vh(i + 1, j, k) - vh(i, j, k)) * u, b = vh(i, j + 1, k) + (vh(i + 1, j + 1, k) - vh(i, j + 1, k)) * u;
  const c = vh(i, j, k + 1) + (vh(i + 1, j, k + 1) - vh(i, j, k + 1)) * u, d = vh(i, j + 1, k + 1) + (vh(i + 1, j + 1, k + 1) - vh(i, j + 1, k + 1)) * u;
  const e = a + (b - a) * v, f = c + (d - c) * v;
  return e + (f - e) * w;
}

// Brain coral valleys: stripes about 10 cm x s apart (s: the species
// scale), bent by two octaves of noise (domain warp), so the valleys run
// side by side and meander, as on a brain coral, with no closed rings.
// 0 on a ridge, 1 in a valley.
export function groove(x, y, z, sc = 1) {
  if (sc !== 1) { x /= sc; y /= sc; z /= sc; }
  const w = noise3(x * 1.7 + 3.1, y * 1.7, z * 1.7) * 2.6 + noise3(x * 4.3, y * 4.3 + 5, z * 4.3) * 0.8;
  const f = (0.62 * x + 0.35 * y + 0.7 * z) * 10 + w;
  const s = Math.abs(Math.sin(f * Math.PI));
  const t = Math.min(1, s / 0.42);
  return 1 - t * t * (3 - 2 * t);
}

// The post term of a species field: (x, y, z, d, id) -> d', id = the
// local prim id (the nearest cone). C: the colony of each prim.
function postFor(id, sh, S) {
  const u = sh.u || 1;          // the length unit of this field (species scale x quality)
  const kind = sh.post || null;
  if (kind === 'web') {
    // ribs: the tree field d; web: a slab in the plane of the colony where
    // the field inflated by sh.web is inside
    const W = sh.web, T = sh.half;
    return (x, y, z, d, pid) => {
      if (pid < 0 || d > W + 0.01 * u) return d;
      const c = S.cols.get(S.colOf[pid]);
      const pd = Math.abs((x - c.base[0]) * c.plane[0] + (z - c.base[2]) * c.plane[1]);
      const web = smax(d - W, pd - T, 0.006 * u);
      return smin(d, web, 0.005 * u);
    };
  }
  if (kind === 'plate') {
    // plate particles (depth >= stalk) are cut to a slab at their height;
    // a colony with a tilt t: the slab rises by t per metre of radius from
    // the colony axis (a whorl, a funnel, a vase)
    const I = sh.inflate, T = sh.half, O = S.origin;
    return (x, y, z, d, pid) => {
      if (pid < 0) return d;
      const c = S.cols.get(S.colOf[pid]);
      if (S.depth[pid] < (c.stalk || 7)) return d;
      const t = c.tilt || 0;
      let slab;
      if (!t) slab = Math.abs(y - S.Y[pid]) - T;
      else {
        const r = Math.hypot(x - c.base[0], z - c.base[2]);
        const rp = Math.hypot(S.X[pid * 3] + O[0] - c.base[0], S.X[pid * 3 + 2] + O[2] - c.base[2]);
        slab = Math.abs(y - S.Y[pid] - t * (r - rp)) / Math.sqrt(1 + t * t) - T;
      }
      return smax(d - I, slab, 0.012 * u);
    };
  }
  if (kind === 'palmate') {
    // elkhorn: a flat web at the height of each particle where the field
    // inflated by sh.web is inside, joined to the branch cones: broad,
    // flat branches
    const W = sh.web, T = sh.half;
    return (x, y, z, d, pid) => {
      if (pid < 0 || d > W + 0.01 * u) return d;
      const web = smax(d - W, Math.abs(y - S.Y[pid]) - T, 0.008 * u);
      return smin(d, web, 0.008 * u);
    };
  }
  if (kind === 'groove') {
    // the noise in the world frame (S.frame: the world point of the mesher
    // origin), so a colony has the same grooves in every mesher
    const A = sh.groove, D = 0.03 * u, gs = sh.len || 1, W = S.frame || [0, 0, 0];
    return (x, y, z, d) => d > D ? d : d + A * groove(x + W[0], y + W[1], z + W[2], gs) * Math.min(1, Math.max(0, 1 - d / D));
  }
  return null;
}

// Hash of two ints to 0..1 (deterministic polyp places).
function h01(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// Polyps on a brick mesh: about density x area x (1 + tip x tipness)
// per triangle. tipOf(local id) -> 0..1 (1 at a tip). gidOf(local id).
// keep(x, y, z, local id) -> false drops a polyp (the polyp under it in the
// other colony, in the rock); the other polyps keep their places and rand.
export function scatterPolyps(mesh, pol, tipOf, gidOf, seed, keep = null) {
  const trunk = pol.trunk ?? 0.25, under = pol.under ?? 0.3;
  const P = mesh.positions, N = mesh.normals, I = mesh.indices, ID = mesh.ids;
  const out = [];
  let n = 0;
  for (let t = 0; t < I.length && n < pol.max; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    const id = ID[a] >= 0 ? ID[a] : ID[b] >= 0 ? ID[b] : ID[c];
    if (id < 0) continue;
    const tip = tipOf(id);
    // live tissue: polyps on the young parts and on faces that look up or
    // to the side; few on the old trunk and on the shaded undersides
    const fy = (N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1]) / 3;
    const live = (trunk + (1 - trunk) * Math.min(1, tip * 3)) * (fy < -0.3 ? under : 1);
    const want = area * pol.density * (1 + pol.tip * tip) * live;
    const r0 = h01(seed, t);
    const k = Math.floor(want) + (r0 < want - Math.floor(want) ? 1 : 0);
    for (let q = 0; q < k && n < pol.max; q++) {
      let s1 = h01(seed + q * 7919, t + 1), s2 = h01(seed + q * 104729, t + 2);
      if (s1 + s2 > 1) { s1 = 1 - s1; s2 = 1 - s2; }
      const w0 = 1 - s1 - s2;
      const nx = N[a * 3] * w0 + N[b * 3] * s1 + N[c * 3] * s2;
      const ny = N[a * 3 + 1] * w0 + N[b * 3 + 1] * s1 + N[c * 3 + 1] * s2;
      const nz = N[a * 3 + 2] * w0 + N[b * 3 + 2] * s1 + N[c * 3 + 2] * s2;
      const l = Math.hypot(nx, ny, nz) || 1;
      const px = P[a * 3] * w0 + P[b * 3] * s1 + P[c * 3] * s2;
      const py = P[a * 3 + 1] * w0 + P[b * 3 + 1] * s1 + P[c * 3 + 1] * s2;
      const pz = P[a * 3 + 2] * w0 + P[b * 3 + 2] * s1 + P[c * 3 + 2] * s2;
      if (keep && !keep(px, py, pz, id)) continue;
      out.push(px, py, pz, nx / l, ny / l, nz / l, gidOf(id), h01(seed ^ 0x5bd1e995, t * 31 + q));
      n++;
    }
  }
  return new Float32Array(out);
}

export const LOD_K = 3;         // coarse cell = LOD_K x fine cell

// ── tree to cones ───────────────────────────────────────────────────────────
// A copy of createTreeSdf of lib/dla-sdf.js with one change: the radii are
// Float64. The lib keeps them in a Float32Array and compares the new
// pipeRadius (a double) with the stored one, so nearly every add sees a
// "change" on every ancestor and queues a recompute of its bricks. Here a
// radius changes only when its quantised step changes.
export function createTree(opts = {}) {
  // chain: the cones of one branch (a parent and its child) join with the
  // blend chainK x k, not k (lib/dla-sdf.js link): no bead at each joint
  const sdf = createSdf(opts.chain === undefined ? opts : Object.assign({}, opts, { link: (a, b) => par[b] === a || par[a] === b, chainK: opts.chain * (opts.k ?? 0) }));
  const rTip = opts.rTip ?? 0.5, pipe = opts.pipe ?? 3, rMax = opts.rMax ?? 4 * rTip, quant = opts.quant ?? 0.12, sub0 = opts.sub0 ?? 2;
  const rootScale = opts.rootScale ?? 1;
  // footOf(i) -> [nx, ny, nz, len] or null: a root cone goes down along -n
  // by len + its radius (into the rock), so the colony stands on the rock.
  // defer: no cones go into the field until flush(keep) (a contact guest:
  // only the cones near the host colony, with their final radii).
  const footOf = opts.footOf || null;
  let defer = !!opts.defer;
  let cap = 1024, n = 0;
  let X = new Float64Array(cap * 3), par = new Int32Array(cap), sub = new Int32Array(cap), rad = new Float64Array(cap);
  const kids = [];
  let mark = new Int32Array(cap), stamp = 0, CH = new Int32Array(4096);
  function grow() {
    cap *= 2;
    const x = new Float64Array(cap * 3); x.set(X); X = x;
    const p = new Int32Array(cap); p.set(par); par = p;
    const s = new Int32Array(cap); s.set(sub); sub = s;
    const r = new Float64Array(cap); r.set(rad); rad = r;
    const mk = new Int32Array(cap); mk.set(mark); mark = mk;
  }
  function cone(i) {
    if (defer) return;
    const p = par[i], ri = rad[i];
    if (p < 0) {
      const r = ri * rootScale, f = footOf && footOf(i), l = f ? f[3] + r : 0;
      sdf.setPrim(i, X[i * 3] - (f ? f[0] * l : 0), X[i * 3 + 1] - (f ? f[1] * l : 0), X[i * 3 + 2] - (f ? f[2] * l : 0), r, X[i * 3], X[i * 3 + 1], X[i * 3 + 2], r);
    } else sdf.setPrim(i, X[p * 3], X[p * 3 + 1], X[p * 3 + 2], rad[p], X[i * 3], X[i * 3 + 1], X[i * 3 + 2], ri);
  }
  function add(i, x, y, z, p) {
    if (i !== n) throw new Error(`coral-sdf: tree ids must come in order (got ${i}, want ${n})`);
    if (n === cap) grow();
    if (CH.length < n + 1) CH = new Int32Array(CH.length * 2);
    n++;
    X[i * 3] = x; X[i * 3 + 1] = y; X[i * 3 + 2] = z; par[i] = p; sub[i] = 1;
    rad[i] = pipeRadius(1, rTip, pipe, rMax, quant, sub0);
    kids.push(null);
    if (p >= 0) (kids[p] || (kids[p] = [])).push(i);
    cone(i);
    let nch = 0;
    for (let a = p; a >= 0; a = par[a]) {
      sub[a]++;
      const r = pipeRadius(sub[a], rTip, pipe, rMax, quant, sub0);
      if (Math.abs(r - rad[a]) > 1e-12 * rTip) { rad[a] = r; CH[nch++] = a; }
    }
    if (!nch) return;
    stamp++;
    for (let q = 0; q < nch; q++) {
      const a = CH[q];
      if (mark[a] !== stamp) { mark[a] = stamp; cone(a); }
      const K = kids[a];
      if (K) for (const c of K) if (mark[c] !== stamp) { mark[c] = stamp; cone(c); }
    }
  }
  return {
    sdf, add, update: (ms, out) => sdf.update(ms, out),
    flush(keep) { defer = false; for (let i = 0; i < n; i++) if (!keep || keep(i)) cone(i); },
    end: i => [X[i * 3], X[i * 3 + 1], X[i * 3 + 2]],
    radius: i => rad[i], sub: i => sub[i], parent: i => par[i],
    get count() { return n; },
  };
}

export function createCoralMesher(opts = {}) {
  const polypScale = opts.polyps ?? 1;
  const fine = opts.fine ?? 1;
  const radius = opts.radius ?? 30;
  const useLod = opts.lod !== false;
  const solid = opts.solid || null;   // (x, y, z) -> rock distance: no polyp in the rock
  const frame = opts.frame || [0, 0, 0];
  const gap = opts.gapMs ?? 250;   // update(): a growing field meshes at most once per gap ms
  const now = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();
  const gapNow = opts.clock || now; // the clock of the gap (the reef worker passes its own)
  // the brick keys of lib/dla-sdf.js hold -512..511 bricks per axis: the
  // cell is at least (radius x 1.1) / (511 x BRICK), so the plot fits
  const minCell = radius * 1.1 / (511 * BRICK);
  const cols = new Map();          // k -> { k, id, base, plane, stalk, focus }
  const fields = new Map();        // id|lev -> F
  // every particle, in global order (to refill a fine field on a focus change)
  let cap = 4096, n = 0;
  let PX = new Float64Array(cap * 3), PAR = new Int32Array(cap), PCOL = new Int32Array(cap);
  const bridges = new Map();       // g -> [j]: bridge cones (reef.js R.bridges), replayed on a refill
  let turn = 0;
  let tris = [0, 0], polypN = 0, ownN = 0;

  // The key of the fine field of a colony: one per species, or one per
  // colony for a species with own: true (sea fans: they do not fuse, and a
  // field with its origin at the colony base can have a cell finer than
  // the plot-wide limit minCell).
  // With lod, every colony has its own fine field (a focus change then
  // touches one colony only).
  function ownFine(id) { return useLod || !!(SHAPES[id] || SHAPES.staghorn).own; }
  function fineKey(c) { return ownFine(c.id) ? `${c.id}|0|${c.k}` : `${c.id}|0`; }
  const events = [];               // fine-field events: { k, state }

  function makeField(id, lev, c) {
    const own = lev === 0 && ownFine(id) && c;
    const key = own ? fineKey(c) : id + '|' + lev;
    let F = fields.get(key);
    if (F) return F;
    F = buildField(id, lev, own ? c : null, key, false);
    fields.set(key, F);
    return F;
  }
  // A field of species id at lev; c: the colony of a per-colony field
  // (origin at its base), else null. guest: a contact guest (not meshed,
  // cones deferred, see fuse).
  function buildField(id, lev, c, key, guest) {
    const sh0 = SHAPES[id] || SHAPES.staghorn;
    const own = !!c;
    const cell0 = own ? sh0.cell * fine : Math.max(minCell, sh0.cell * fine);
    const r = cell0 / sh0.cell;                 // everything scales with the cell
    const sh = scaled(sh0, r);
    sh.u = (sh0.len || 1) * r;
    let cell = cell0;
    if (lev === 1) {
      // the coarse field: LOD_K x the cell; thin parts are made just thick
      // enough for the coarse lattice (half a cell), slabs too
      cell = cell0 * LOD_K;
      sh.rTip = Math.max(sh.rTip, 0.5 * cell); sh.rMax = Math.max(sh.rMax, sh.rTip * 1.25);
      sh.k = Math.max(sh.k, cell); sh.band = Math.max(sh.band, 2.2 * cell);
      if (sh.half !== undefined) sh.half = Math.max(sh.half, 0.55 * cell);
      if (sh.web !== undefined) sh.web = Math.max(sh.web, 1.5 * cell);
      if (sh.inflate !== undefined) sh.inflate = Math.max(sh.inflate, 0.5 * cell);
      sh.groove = 0;
    }
    const O = own ? c.base.slice() : [0, 0, 0];
    // brick keys of own fields are offset so that they are unique over all
    // fields (lib keys are under 2^30)
    const keyBase = own && !guest ? (++ownN) * 1073741824 : 0;
    const F = { key, id, lev, sh, cell, cols, n: 0, cap: 1024, live: new Map(), origin: O, keyBase, colK: own ? c.k : -1, wait: null, at: -1e9,
      X: new Float64Array(3 * 1024), Y: new Float64Array(1024), SM: new Float64Array(3 * 1024), DIR: new Float64Array(3 * 1024),
      depth: new Int32Array(1024), gid: new Int32Array(1024), colOf: new Int32Array(1024), localOf: new Map(), contact: null, frame };
    // the species post term, then (after fuse) the contact term
    const sp = wrapPost(postFor(id, sh, F), O);
    F.post = sp;
    F.tree = createTree({
      cell, brick: BRICK, k: sh.k, band: sh.band, rTip: sh.rTip, pipe: sh.pipe, rMax: sh.rMax,
      sub0: sh.sub0, quant: sh.quant, rootScale: sh.rootScale, maxPrims: 1 << 22, chain: sh.chain ?? CHAIN_K,
      footOf: i => footOf(F, i), defer: guest,
      post: guest ? sp : (x, y, z, v, pid) => {
        const d = sp ? sp(x, y, z, v, pid) : v;
        return F.contact ? F.contact(x, y, z, d, pid, v) : d;
      },
    });
    return F;
  }
  // the foot of a root (createTree footOf): down the colony normal to the rock
  function footOf(F, i) {
    if (F.depth[i] !== 0) return null;
    const c = cols.get(F.colOf[i]);
    if (!c || !(c.foot > 0)) return null;
    return [c.normal[0], c.normal[1], c.normal[2], c.foot];
  }
  // post terms work in world metres: add the field origin
  function wrapPost(f, O) {
    if (!f || (O[0] === 0 && O[1] === 0 && O[2] === 0)) return f;
    return (x, y, z, d, id) => f(x + O[0], y + O[1], z + O[2], d, id);
  }
  function scaled(sh, r) {
    const o = Object.assign({}, sh);
    for (const k of ['cell', 'k', 'band', 'rTip', 'rMax', 'web', 'half', 'inflate', 'groove']) if (o[k] !== undefined) o[k] *= r;
    return o;
  }

  // desc: colonyInfo() of reef.js { k, id, base, plane, stalk }
  function addColony(desc) {
    const c = { k: desc.k, id: desc.id, base: desc.base.slice(), plane: (desc.plane || [1, 0]).slice(), stalk: desc.stalk, tilt: desc.tilt || 0, focus: !desc.guest && (!useLod || !!desc.focus),
      normal: (desc.normal || [0, 1, 0]).slice(), foot: desc.foot || 0, guest: !!desc.guest };
    cols.set(desc.k, c);
    if (c.guest) return;
    if (c.focus) makeField(desc.id, 0, c);
    if (useLod) makeField(desc.id, 1);
  }

  function growF(F) {
    F.cap *= 2;
    for (const [k, T, w] of [['X', Float64Array, 3], ['Y', Float64Array, 1], ['SM', Float64Array, 3], ['DIR', Float64Array, 3], ['depth', Int32Array, 1], ['gid', Int32Array, 1], ['colOf', Int32Array, 1]]) {
      const a = new T(F.cap * w); a.set(F[k]); F[k] = a;
    }
  }

  // The cone end of particle i: a smoothed copy of the particle, so a DLA
  // chain that zig-zags becomes a smooth branch. The direction keeps part
  // of the parent's direction (sh.bend), then the point moves back toward
  // the particle (sh.hold), so the drift stays small.
  function smoothPoint(F, i, p, x, y, z) {
    const sh = F.sh, SM = F.SM, D = F.DIR, X = F.X;
    if (p < 0) { D[i * 3] = 0; D[i * 3 + 1] = 1; D[i * 3 + 2] = 0; SM[i * 3] = x; SM[i * 3 + 1] = y; SM[i * 3 + 2] = z; return; }
    let dx = x - X[p * 3], dy = y - X[p * 3 + 1], dz = z - X[p * 3 + 2];
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    if (sh.bend > 0) {
      dx = dx * (1 - sh.bend) + D[p * 3] * sh.bend; dy = dy * (1 - sh.bend) + D[p * 3 + 1] * sh.bend; dz = dz * (1 - sh.bend) + D[p * 3 + 2] * sh.bend;
      const m = Math.hypot(dx, dy, dz) || 1; dx /= m; dy /= m; dz /= m;
    }
    D[i * 3] = dx; D[i * 3 + 1] = dy; D[i * 3 + 2] = dz;
    let sx = SM[p * 3] + dx * l, sy = SM[p * 3 + 1] + dy * l, sz = SM[p * 3 + 2] + dz * l;
    const hold = sh.bend > 0 ? sh.hold : 1;
    sx += (x - sx) * hold; sy += (y - sy) * hold; sz += (z - sz) * hold;
    SM[i * 3] = sx; SM[i * 3 + 1] = sy; SM[i * 3 + 2] = sz;
  }

  function addTo(F, g, parent, wx, wy, wz, k) {
    const x = wx - F.origin[0], y = wy - F.origin[1], z = wz - F.origin[2];
    let p = -1;
    if (parent >= 0) { p = F.localOf.get(parent); if (p === undefined) return false; }
    if (F.n === F.cap) growF(F);
    const i = F.n++;
    F.X[i * 3] = x; F.X[i * 3 + 1] = y; F.X[i * 3 + 2] = z; F.Y[i] = wy;
    F.depth[i] = p < 0 ? 0 : F.depth[p] + 1; F.gid[i] = g; F.colOf[i] = k;
    F.localOf.set(g, i);
    smoothPoint(F, i, p, x, y, z);
    F.tree.add(i, F.SM[i * 3], F.SM[i * 3 + 1], F.SM[i * 3 + 2], p);
    return true;
  }

  // A bridge cone from particle g to particle j (a fuse of two colonies of
  // one species, reef.js R.bridges): a field point at j with parent g, in
  // every field that holds g. In a species field that holds both, the two
  // surfaces join; a per-colony fine field gets a branch that reaches the
  // other colony. j < g; call it after add(g).
  function addBridge(F, g, j) {
    const p = F.localOf.get(g); if (p === undefined) return;
    if (F.n === F.cap) growF(F);
    const i = F.n++, x = PX[j * 3] - F.origin[0], y = PX[j * 3 + 1] - F.origin[1], z = PX[j * 3 + 2] - F.origin[2];
    F.X[i * 3] = x; F.X[i * 3 + 1] = y; F.X[i * 3 + 2] = z; F.Y[i] = PX[j * 3 + 1];
    F.depth[i] = F.depth[p] + 1; F.gid[i] = g; F.colOf[i] = PCOL[g];
    F.SM[i * 3] = x; F.SM[i * 3 + 1] = y; F.SM[i * 3 + 2] = z;
    F.DIR[i * 3] = 0; F.DIR[i * 3 + 1] = 1; F.DIR[i * 3 + 2] = 0;
    F.tree.add(i, x, y, z, p);
  }
  function bridge(g, j) {
    if (g >= n || j >= g || j < 0) return false;
    const c = cols.get(PCOL[g]), d = cols.get(PCOL[j]); if (!c || !d || c.id !== d.id) return false;
    (bridges.get(g) || bridges.set(g, []).get(g)).push(j);
    if (c.guest) return true;
    if (useLod) addBridge(fields.get(c.id + '|1'), g, j);
    if (c.focus) { const F = fields.get(fineKey(c)); if (F) addBridge(F, g, j); }
    return true;
  }

  // Particle g (global id, in order) at world (x, y, z), parent (global id
  // or -1), colony k. Returns false for a particle out of order.
  function add(g, parent, x, y, z, k) {
    const c = cols.get(k); if (!c || g !== n) return false;
    if (n === cap) {
      cap *= 2;
      const a = new Float64Array(cap * 3); a.set(PX); PX = a;
      const b = new Int32Array(cap); b.set(PAR); PAR = b;
      const d = new Int32Array(cap); d.set(PCOL); PCOL = d;
    }
    PX[g * 3] = x; PX[g * 3 + 1] = y; PX[g * 3 + 2] = z; PAR[g] = parent; PCOL[g] = k; n++;
    if (c.guest) return true;
    if (useLod) addTo(fields.get(c.id + '|1'), g, parent, x, y, z, k);
    if (c.focus) addTo(makeField(c.id, 0, c), g, parent, x, y, z, k);
    return true;
  }

  // The focus colonies get a fine field of their own. A colony that comes
  // into the focus: a new field with all its particles; F.wait is true
  // until the field has no brick to recompute or mesh (the radius
  // recomputes make more bricks and mesh some bricks two times, so the
  // first pass over the bricks is not the end). A colony that leaves the
  // focus: its field goes, with one 'drop' event and no brick removals.
  // The fields of the other colonies do not change. With lod false: no-op.
  function setFocus(ks) {
    if (!useLod) return false;
    const want = new Set(ks);
    let changed = 0;
    for (const c of cols.values()) {
      const f = want.has(c.k) && !c.guest; if (f === c.focus) continue;
      c.focus = f; changed++;
      const key = fineKey(c), old = fields.get(key);
      if (old) {
        for (const b of old.live.values()) { tris[0] -= b[0]; polypN -= b[1]; }
        fields.delete(key);
      }
      if (!f) { if (old) events.push({ k: c.k, state: 'drop' }); continue; }
      const F = makeField(c.id, 0, c);
      for (let g = 0; g < n; g++) if (PCOL[g] === c.k) {
        addTo(F, g, PAR[g], PX[g * 3], PX[g * 3 + 1], PX[g * 3 + 2], c.k);
        const B = bridges.get(g); if (B) for (const j of B) addBridge(F, g, j);
      }
      if (fused) attachContact(F);
      F.wait = true;
      checkDone(F);
    }
    return changed > 0;
  }

  // ── contacts ──────────────────────────────────────────────────────────────
  // The user said: "the fused region where two corals intersect often looks
  // like it's covered in mesh errors considerably". Each colony (fine) or
  // species (coarse) has a field of its own, so two colonies that touch
  // were two closed surfaces through each other: faces inside the other
  // colony, shallow crossings that flicker, polyps through the other skin.
  // fuse() gives each field a contact term from GUESTS: copies of the near
  // other fields (same cones, radii, blends and post terms as their own
  // fields, deferred: only the cones near the host go into a guest). For a
  // host value d and the guest value N at a point:
  //   U = smin(d, N, kc)      one surface over both, a fillet of kc
  //   w = v - V - s           v, V: the cone folds of host and guest (no
  //                           post term: a smooth wall); s = +EPS when
  //                           the host wins a tie, else -EPS
  //   field = max(U, w)       the host keeps the part of U nearer to it
  // The guest does the same with the host as its guest, so the two meshes
  // are two parts of one surface U that meet on w = 0, and each part is
  // closed by a wall on w = 0 inside U (hidden; no face of one colony is
  // on or in the other). Vertex normals near a contact are the gradient
  // of U (no seam at the wall); polyps nearer than their size to the other
  // colony go. fine fields: a guest per other colony; coarse fields: a
  // guest per other species. Call fuse() when all particles are in (the
  // world chunk jobs: before meshAll); a field that setFocus makes later
  // gets its contact term at once.
  const EPS = 1e-4;
  let fused = false;
  const IDO = [0];
  function idsBy() {
    const by = new Map();
    for (let g = 0; g < n; g++) { const a = by.get(PCOL[g]); if (a) a.push(g); else by.set(PCOL[g], [g]); }
    return by;
  }
  // a pad round the particles of a field: the cone reach (rMax x root
  // scale, band, blend, web or inflate)
  function padOf(sh) { return sh.rMax * (sh.rootScale || 1) + sh.band + sh.k + (sh.web || 0) + (sh.inflate || 0) + (sh.half || 0); }
  function boxOf(ids, pad, c) {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const g of ids) for (let a = 0; a < 3; a++) { const v = PX[g * 3 + a]; if (v < b[a]) b[a] = v; if (v > b[a + 3]) b[a + 3] = v; }
    if (c && c.foot > 0) for (let a = 0; a < 3; a++) { const v = c.base[a] - c.normal[a] * (c.foot + pad); if (v < b[a]) b[a] = v; if (v > b[a + 3]) b[a + 3] = v; }
    for (let a = 0; a < 3; a++) { b[a] -= pad; b[a + 3] += pad; }
    return b;
  }
  const meets = (a, b) => a[0] <= b[3] && b[0] <= a[3] && a[1] <= b[4] && b[1] <= a[4] && a[2] <= b[5] && b[2] <= a[5];
  // the colonies in a field (its hosts)
  function hostsOf(F) {
    if (F.colK >= 0) return [cols.get(F.colK)];
    const out = [];
    for (const c of cols.values()) if (!c.guest && c.id === F.id && (F.lev === 1 || !ownFine(c.id))) out.push(c);
    return out;
  }
  // A guest field: the colonies cs (one colony at lev 0, a species at
  // lev 1), as their own field holds them, with the cones near grid only.
  function makeGuest(id, lev, cs, by, near) {
    const one = lev === 0 ? cs[0] : null;
    const G = buildField(id, lev, one && (useLod || ownFine(id)) ? one : null, 'guest', true);
    const ks = new Set(cs.map(c => c.k)), all = [];
    for (const c of cs) for (const g of by.get(c.k) || []) all.push(g);
    all.sort((a, b) => a - b);
    for (const g of all) {
      addTo(G, g, PAR[g], PX[g * 3], PX[g * 3 + 1], PX[g * 3 + 2], PCOL[g]);
      const B = bridges.get(g);
      // the bridges of a colony are in its fields: lev 1 all of them,
      // lev 0 those of a focus (or plot) field
      if (B) for (const j of B) if (lev === 1 || ks.has(PCOL[g])) addBridge(G, g, j);
    }
    const O = G.origin, T = G.tree;
    let kept = 0;
    const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], ends = [];
    T.flush(i => {
      const e = T.end(i), p = T.parent(i), f = p >= 0 ? T.end(p) : e;
      const ok = near(e[0] + O[0], e[1] + O[1], e[2] + O[2]) || near(f[0] + O[0], f[1] + O[1], f[2] + O[2]);
      if (ok) { kept++; ends.push(e[0] + O[0], e[1] + O[1], e[2] + O[2], f[0] + O[0], f[1] + O[1], f[2] + O[2]); }
      return ok;
    });
    if (!kept) return null;
    const pad = padOf(G.sh) + (one && one.foot > 0 ? one.foot + G.sh.rMax * G.sh.rootScale : 0);
    for (let q = 0; q < ends.length; q += 3) for (let a = 0; a < 3; a++) { const v = ends[q + a]; if (v - pad < box[a]) box[a] = v - pad; if (v + pad > box[a + 3]) box[a + 3] = v + pad; }
    // a grid of cells (edge pad) round the kept cone ends: a point out of
    // it is far from the guest (no distance call); one cell of margin
    const H = Math.max(pad, 1e-3), occ = new Set(), ck = (i, j, k) => (i * 73856093) ^ (j * 19349663) ^ (k * 83492791);
    const mark = (x, y, z) => {
      const i0 = Math.floor(x / H), j0 = Math.floor(y / H), k0 = Math.floor(z / H);
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) occ.add(ck(i0 + dx, j0 + dy, k0 + dz));
    };
    // each kept cone: its two ends and points along it (half a cell apart);
    // a root foot: down the colony normal
    for (let q = 0; q < ends.length; q += 6) {
      const ex = ends[q], ey = ends[q + 1], ez = ends[q + 2], fx = ends[q + 3], fy = ends[q + 4], fz = ends[q + 5];
      const m = Math.max(1, Math.ceil(Math.hypot(fx - ex, fy - ey, fz - ez) / (0.5 * H)));
      for (let t = 0; t <= m; t++) mark(ex + (fx - ex) * t / m, ey + (fy - ey) * t / m, ez + (fz - ez) * t / m);
    }
    for (const c of cs) if (c.foot > 0) {
      const L = c.foot + G.sh.rMax * G.sh.rootScale, m = Math.max(1, Math.ceil(L / (0.5 * H)));
      for (let t = 0; t <= m; t++) mark(c.base[0] - c.normal[0] * L * t / m, c.base[1] - c.normal[1] * L * t / m, c.base[2] - c.normal[2] * L * t / m);
    }
    G.box = box;
    G.occ = (x, y, z) => occ.has(ck(Math.floor(x / H), Math.floor(y / H), Math.floor(z / H)));
    return G;
  }
  // the value of guest G at world (x, y, z): the fold (RAW[0]) and the
  // post term
  const RAW = [0];
  function guestAt(G, x, y, z) {
    const O = G.origin, lx = x - O[0], ly = y - O[1], lz = z - O[2];
    let d = G.tree.sdf.distance(lx, ly, lz, IDO);
    RAW[0] = d;
    if (G.post) d = G.post(lx, ly, lz, d, IDO[0]);
    return d;
  }
  // the nearest guest at world (x, y, z): [N, guest, raw N] (N = Infinity:
  // none). raw: the cone fold with no post term (the wall: smooth, where
  // a brain groove would bend it inside a cell)
  const NG = [Infinity, null, Infinity];
  function nearest(F, x, y, z) {
    NG[0] = Infinity; NG[1] = null; NG[2] = Infinity;
    for (const G of F.guests) {
      const b = G.box;
      if (x < b[0] || x > b[3] || y < b[1] || y > b[4] || z < b[2] || z > b[5] || !G.occ(x, y, z)) continue;
      const d = guestAt(G, x, y, z), r = RAW[0];
      // a guest at its band is no guest here (its own field is outside)
      if (r >= G.sh.band - 1e-9 || r >= NG[2]) continue;
      NG[0] = d; NG[1] = G; NG[2] = r;
    }
    return NG;
  }
  // the host wins a tie: the lower colony k (fine), the lower species id
  // (coarse)
  function tieOf(F, G, pid) {
    if (F.lev === 1) return F.id < G.id ? EPS : -EPS;
    const hk = F.colK >= 0 ? F.colK : pid >= 0 ? F.colOf[pid] : 0;
    return hk < G.colK ? EPS : -EPS;
  }
  function attachContact(F) {
    F.contact = null; F.guests = [];
    const hosts = hostsOf(F); if (!hosts.length) return;
    const by = idsBy(), hk = new Set(hosts.map(c => c.k));
    const hid = [];
    for (const c of hosts) for (const g of by.get(c.k) || []) hid.push(g);
    if (!hid.length) return;
    const hpad = padOf(F.sh);
    const hbox = boxOf(hid, hpad, hosts.length === 1 ? hosts[0] : null);
    // the other colonies, in groups: one per colony (fine), per species (coarse)
    const groups = new Map();
    for (const c of cols.values()) {
      if (hk.has(c.k)) continue;
      if (F.lev === 1 && (c.id === F.id || c.guest)) continue;
      const ids = by.get(c.k); if (!ids || !ids.length) continue;
      const sh0 = SHAPES[c.id] || SHAPES.staghorn;
      const gpad = padOf(sh0) * fine * (F.lev === 1 ? LOD_K : 1) + 2 * sh0.cell * fine * (F.lev === 1 ? LOD_K : 1);
      if (!meets(hbox, boxOf(ids, gpad, c))) continue;
      const key = F.lev === 1 ? c.id : 'k' + c.k;
      const q = groups.get(key); if (q) q.cs.push(c); else groups.set(key, { id: c.id, cs: [c], gpad });
    }
    if (!groups.size) return;
    // a grid of the host particles: a guest cone is kept when one of its
    // ends is near a host particle
    for (const q of groups.values()) {
      const D = hpad + q.gpad, grid = new Map(), key = (i, j, k) => (i * 73856093) ^ (j * 19349663) ^ (k * 83492791);
      for (const g of hid) {
        const kk = key(Math.floor(PX[g * 3] / D), Math.floor(PX[g * 3 + 1] / D), Math.floor(PX[g * 3 + 2] / D));
        const a = grid.get(kk); if (a) a.push(g); else grid.set(kk, [g]);
      }
      // the root foot: points down the normal, so the foot is near too
      for (const c of hosts) if (c.foot > 0) {
        const kk = key(Math.floor((c.base[0] - c.normal[0] * c.foot) / D), Math.floor((c.base[1] - c.normal[1] * c.foot) / D), Math.floor((c.base[2] - c.normal[2] * c.foot) / D));
        const a = grid.get(kk); if (a) a.push(-1 - c.k); else grid.set(kk, [-1 - c.k]);
      }
      const D2 = D * D;
      const near = (x, y, z) => {
        const i = Math.floor(x / D), j = Math.floor(y / D), k = Math.floor(z / D);
        for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const a = grid.get(key(i + dx, j + dy, k + dz)); if (!a) continue;
          for (const g of a) {
            let px, py, pz;
            if (g >= 0) { px = PX[g * 3]; py = PX[g * 3 + 1]; pz = PX[g * 3 + 2]; }
            else { const c = cols.get(-1 - g); px = c.base[0] - c.normal[0] * c.foot; py = c.base[1] - c.normal[1] * c.foot; pz = c.base[2] - c.normal[2] * c.foot; }
            const ex = px - x, ey = py - y, ez = pz - z;
            if (ex * ex + ey * ey + ez * ez < D2) return true;
          }
        }
        return false;
      };
      const G = makeGuest(q.id, F.lev, q.cs, by, near);
      // the fillet: the smaller blend, and no more than the smaller band
      // (past its band a field is clamped: a larger blend would bend the
      // surface where the clamp starts)
      if (G) { G.colK = q.cs[0].k; G.kc = Math.min(F.sh.k, G.sh.k, F.sh.band, G.sh.band); F.guests.push(G); }
    }
    if (!F.guests.length) return;
    const O = F.origin;
    // d: the host value with its post term, v: the cone fold (raw)
    const T = F.sh.band - 1e-9;
    F.contact = (x, y, z, d, pid, v) => {
      // a point the host cones do not reach (at the band): outside both
      // the host part of U and the wall, so the value only needs its sign
      if (v >= T && d > 0) return d;
      const r = nearest(F, x + O[0], y + O[1], z + O[2]), G = r[1];
      if (!G) return d;
      const U = smin(d, r[0], G.kc), w = v - r[2] - tieOf(F, G, pid);
      return U > w ? U : w;
    };
  }
  // the host field value (fold, post terms, no contact) at local (x, y, z)
  const HRAW = [0];
  function hostAt(F, x, y, z) {
    let d = F.tree.sdf.distance(x, y, z, IDO);
    HRAW[0] = d;
    if (F.post) d = F.post(x, y, z, d, IDO[0]);
    return d;
  }
  // U (the fused surface) at local (x, y, z); NaN where no guest is near
  function unionAt(F, x, y, z) {
    const O = F.origin, r = nearest(F, x + O[0], y + O[1], z + O[2]);
    if (!r[1]) return NaN;
    return smin(hostAt(F, x, y, z), r[0], r[1].kc);
  }
  // Normals near a contact: the gradient of U at each vertex on the outer
  // surface (the meshes of the host and the guest then have the same
  // normal where they meet). m: a brick in field-local metres.
  function contactNormals(F, m) {
    const P = m.positions, Nn = m.normals, h = 0.5 * F.cell;
    for (let v = 0; v < P.length; v += 3) {
      const x = P[v], y = P[v + 1], z = P[v + 2];
      const u0 = unionAt(F, x, y, z);
      if (!(u0 > -F.cell)) continue;     // NaN (no guest) or a wall vertex inside U
      const gx = unionAt(F, x + h, y, z) - unionAt(F, x - h, y, z);
      const gy = unionAt(F, x, y + h, z) - unionAt(F, x, y - h, z);
      const gz = unionAt(F, x, y, z + h) - unionAt(F, x, y, z - h);
      const l = Math.hypot(gx, gy, gz);
      if (!(l > 1e-12)) continue;
      Nn[v] = gx / l; Nn[v + 1] = gy / l; Nn[v + 2] = gz / l;
    }
  }
  // fuse(): the contact terms of every field (see above). The bricks of a
  // field with a contact are meshed again (meshAll does every brick).
  function fuse() {
    fused = true;
    for (const F of fields.values()) attachContact(F);
    return [...fields.values()].reduce((a, F) => a + (F.guests ? F.guests.length : 0), 0);
  }

  function checkDone(F) {
    if (!F.wait || F.tree.sdf.dirtyCount) return;
    F.wait = null;
    events.push({ k: F.colK, state: 'complete' });
  }
  // A polyp at world (x, y, z) on the cone id of F stays when it is not on
  // the root foot under the base, not in the rock (opts.solid) and not
  // nearer than its size to a contact guest (the other colony).
  function keepPolyp(F, x, y, z, id) {
    const size = F.sh.polyp.size;
    if (F.depth[id] === 0) {
      const c = cols.get(F.colOf[id]);
      if (c && c.foot > 0 && (x - c.base[0]) * c.normal[0] + (y - c.base[1]) * c.normal[1] + (z - c.base[2]) * c.normal[2] < 0) return false;
    }
    if (solid && solid(x, y, z) < size) return false;
    if (F.contact && nearest(F, x, y, z)[0] < size) return false;
    return true;
  }
  function takeEvents() { return events.splice(0, events.length); }
  function focus() { const out = []; for (const c of cols.values()) if (c.focus) out.push(c.k); return out; }

  function result(F, m) {
    const pol = F.sh.polyp, O = F.origin;
    if (F.contact && m.indices.length) contactNormals(F, m);
    if (O[0] !== 0 || O[1] !== 0 || O[2] !== 0) {
      const P = m.positions;
      for (let v = 0; v < P.length; v += 3) { P[v] += O[0]; P[v + 1] += O[1]; P[v + 2] += O[2]; }
    }
    const tipOf = id => { const s = F.tree.sub(id); return s <= 1 ? 1 : Math.max(0, 1 - Math.log2(s) / 5); };
    const gidOf = id => F.gid[id];
    const gids = new Float32Array(m.ids.length);
    for (let v = 0; v < m.ids.length; v++) gids[v] = m.ids[v] >= 0 ? F.gid[m.ids[v]] : -1;
    const polyps = F.lev === 0 && m.indices.length && polypScale > 0
      ? scatterPolyps(m, { density: pol.density * polypScale, tip: pol.tip, trunk: pol.trunk, under: pol.under, max: Math.ceil(pol.max * Math.max(1, polypScale)) }, tipOf, gidOf, (m.key % 2147483647) ^ (F.id.length * 7919), (x, y, z, id) => keepPolyp(F, x, y, z, id))
      : new Float32Array(0);
    const nt = m.indices.length / 3;
    const chunk = chunkKey(m.bx, m.by, m.bz, F.cell, O);
    const bkey = m.key + F.keyBase;
    const old = F.live.get(bkey);
    if (!nt && !old) return null;          // an empty brick that never showed: nothing to send
    if (old) { tris[F.lev] -= old[0]; polypN -= old[1]; }
    if (nt) { F.live.set(bkey, [nt, polyps.length / 8, chunk]); tris[F.lev] += nt; polypN += polyps.length / 8; } else F.live.delete(bkey);
    return { sp: F.id, lod: F.lev, k: F.colK, key: bkey, field: F.key, chunk, bx: m.bx, by: m.by, bz: m.bz, cell: F.cell,
      positions: m.positions, normals: m.normals, gids, indices: m.indices, polyps, tris: nt };
  }

  // Mesh dirty bricks of all fields for about ms: the coarse fields first
  // (so the whole reef shows), then the fine fields that wait to show,
  // then the other fine fields in turn. The first time that every coarse
  // field has nothing to mesh, an event { k: -1, state: 'coarse' } goes
  // out (the page shows a restored reef at once, not brick by brick).
  let coarseDone = false;
  // settle: the growth is over (no new particles come), so the gap does
  // not hold a field back: each tick meshes for its whole budget
  function update(ms = 8, out = [], settle = false) {
    const t0 = now(), tg = gapNow();
    // the coarse fields first, then the fine fields that wait to show,
    // then the rest (in turn)
    const first = [], rest = [];
    for (const F of fields.values()) (F.lev === 1 ? first : rest).push(F);
    for (const F of rest) if (F.wait) first.push(F);
    const live = rest.filter(F => !F.wait);
    const list = first.concat(live.map((_, q) => live[(turn + q) % live.length]));
    if (!list.length) return out;
    for (let q = 0; q < list.length; q++) {
      const F = list[q];
      if (!F.tree.sdf.dirtyCount) { if (F.wait) checkDone(F); continue; }
      // a field meshed less than gap ms ago waits: its bricks that change
      // again (growth) are meshed and sent once per gap, not each tick
      if (!settle && !F.wait && gap > 0 && tg - F.at < gap) continue;
      const left = ms - (now() - t0);
      if (left <= 0) break;
      const share = Math.max(1, left / Math.max(1, list.length - q));
      for (const m of F.tree.update(share)) { const r = result(F, m); if (r) out.push(r); }
      F.at = tg;
      if (F.wait) checkDone(F);
    }
    turn++;
    if (!coarseDone && useLod && n > 0) {
      let busy = false;
      for (const F of first) if (F.lev === 1 && F.tree.sdf.dirtyCount) { busy = true; break; }
      if (!busy) { coarseDone = true; events.push({ k: -1, state: 'coarse' }); }
    }
    return out;
  }

  // Every brick now. lev: 0 fine, 1 coarse, undefined both.
  function meshAll(lev) {
    const out = [];
    for (const F of fields.values()) if (lev === undefined || F.lev === lev) {
      for (const m of F.tree.sdf.meshAll()) { const r = result(F, m); if (r) out.push(r); }
      if (F.wait) checkDone(F);
    }
    return out;
  }

  function dirty() { let d = 0; for (const F of fields.values()) d += F.tree.sdf.dirtyCount; return d; }

  return {
    addColony, add, bridge, update, meshAll, dirty, setFocus, focus, takeEvents, fuse, cols, fields, lod: useLod,
    // tests: at world (x, y, z) of field F: d the field of its own cones
    // (post terms), f the meshed field (with the contact term), u the
    // fused surface U (NaN: no guest near), n the nearest guest value, w
    // the wall term (host fold - guest fold; 0 on the wall)
    contactAt(F, x, y, z) {
      const O = F.origin, lx = x - O[0], ly = y - O[1], lz = z - O[2];
      const d = hostAt(F, lx, ly, lz), pid = IDO[0], v = HRAW[0];
      const f = F.contact ? F.contact(lx, ly, lz, d, pid, v) : d;
      const u = F.contact ? unionAt(F, lx, ly, lz) : NaN, r = F.contact ? nearest(F, x, y, z) : NG;
      return { d, f, u, n: F.contact ? r[0] : Infinity, w: F.contact && r[1] ? v - r[2] : Infinity };
    },
    // the cone radius of global particle g in the fine (or coarse) field
    radius(g) {
      const c = cols.get(PCOL[g]); if (!c) return 0;
      for (const key of [fineKey(c), c.id + '|1']) { const F = fields.get(key); const i = F && F.localOf.get(g); if (i !== undefined && F) return F.tree.radius(i); }
      return 0;
    },
    stats() {
      let b = 0;
      for (const F of fields.values()) b += F.tree.sdf.stats.bricks;
      let done = 0;
      for (const F of fields.values()) if (F.lev === 0 && F.colK >= 0 && !F.wait) done++;
      return { colonies: cols.size, particles: n, bricks: b, tris: tris[0] + tris[1], trisFine: tris[0], trisCoarse: tris[1], polyps: polypN, dirty: dirty(), focus: focus().length, fineDone: done };
    },
  };
}
