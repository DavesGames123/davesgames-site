// ============================================================================
//  CORAL REEF  ·  world/coral-data.js  ·  the data texels of a coral chunk
// ----------------------------------------------------------------------------
//  scene.js keeps the per-particle data of every shown coral in float
//  textures (A natural rgb and colour t; B birth, radius, sway x 2 + tip,
//  height over the base; C parent minus particle, colony base height).
//  A coral chunk of world/stream.js owns one slab of slots: slot = base +
//  g (g, its particle id). This file fills them, DOM-free (tests read it).
//
//  NO GROWTH. The birth of every particle is BIRTH_PAST (s), far before
//  the page clock, so uTime - birth is far over the grow-in time of the
//  shaders (1.4 s): no colony shows a grow-in, it is just there. The user
//  said (2026-10-18): "we shouldn't grow corals, they should just grow
//  once adn be there".
//
//    const M = chunkMirror(co)        // reef.js createReefMirror of the chunk
//    const T = chunkColours(co, M, mode)   // { nat, t, rad, F } (colour.js)
//    writeChunk(setParticles, co, M, T, hidden)   // hidden: Set of colony k
//                                     // whose fine mesh shows (negative radius)
//    HEIGHT_SCALE: the height mode is over this many metres (the same scale
//    in every chunk, so the colours match across the chunk borders)
//
//  grep -n targets: "export function chunkMirror", "export function chunkColours",
//  "export function writeChunk"
// ============================================================================
import { createReefMirror, SPECIES, PARTICLE_FLOATS } from '../reef.js';
import { colourT, naturalRGB, radiiOf, fieldsOf } from '../colour.js';
import { BIRTH_PAST } from './corals.js';

export const HEIGHT_SCALE = 7;
const SWAY = id => Math.round(((SPECIES[id] && SPECIES[id].sway) || 0) * 4);

export function chunkMirror(co) {
  const n = co.particles.length / PARTICLE_FLOATS;
  const M = createReefMirror(Math.max(16, n));
  M.setColonies(co.colonies);
  if (n) M.addParticles(0, co.particles);
  M.env = { temp: 27 };
  return M;
}

// The colour mode t, the natural colours and the radii of a chunk.
export function chunkColours(co, M, mode, F) {
  const n = M.count;
  F = F || (n ? fieldsOf(M) : null);
  const rad = new Float32Array(Math.max(1, n)), nat = new Float32Array(Math.max(3, n * 3));
  let t = new Float32Array(Math.max(1, n));
  if (!n) return { nat, t, rad, F };
  radiiOf(M, rad, F); naturalRGB(M, nat, F);
  if (mode === 'height') {
    for (let g = 0; g < n; g++) t[g] = Math.min(1, Math.max(0, (M.py[g] - M.gy[g]) / HEIGHT_SCALE));
  } else t = colourT(M, mode, t, F);
  return { nat, t, rad, F };
}

// The texels of the chunk. setParticles(from, to, f(slot, A, B, o, C)) is
// scene.js setParticles. hidden: colony k with its fine mesh on.
export function writeChunk(setParticles, co, M, T, hidden = null) {
  const n = M.count, base = co.base, oy = co.oy;
  if (!n) return 0;
  setParticles(base, base + n, (slot, A, B, o, C) => {
    const g = slot - base, k = M.col[g], c = M.colonies[k];
    A[o] = T.nat[g * 3]; A[o + 1] = T.nat[g * 3 + 1]; A[o + 2] = T.nat[g * 3 + 2]; A[o + 3] = T.t[g];
    const tip = T.F ? Math.max(0, Math.min(0.999, 1 - Math.log2(T.F.sub[g]) / 5)) : 0.999;
    const r = T.rad[g] || 0.01;
    B[o] = BIRTH_PAST; B[o + 1] = hidden && hidden.has(k) ? -r : r; B[o + 2] = (c ? SWAY(c.id) : 0) * 2 + tip; B[o + 3] = M.py[g] - M.gy[g];
    if (C) {
      const p = M.parent[g];
      C[o] = p >= 0 ? M.px[p] - M.px[g] : 0; C[o + 1] = p >= 0 ? M.py[p] - M.py[g] : 0; C[o + 2] = p >= 0 ? M.pz[p] - M.pz[g] : 0;
      C[o + 3] = M.gy[g] + oy;           // the colony base height in world y (the sway)
    }
  });
  return n;
}
// Only the radius sign of one colony (a fine mesh on or off).
export function writeHidden(setParticles, co, M, T, k, hide) {
  const n = M.count, base = co.base;
  let lo = -1, hi = -1;
  for (let g = 0; g < n; g++) if (M.col[g] === k) { if (lo < 0) lo = g; hi = g; }
  if (lo < 0) return 0;
  setParticles(base + lo, base + hi + 1, (slot, A, B, o) => {
    const g = slot - base;
    if (M.col[g] !== k) return;
    const r = T.rad[g] || 0.01;
    B[o + 1] = hide ? -r : r;
  });
  return hi - lo + 1;
}
