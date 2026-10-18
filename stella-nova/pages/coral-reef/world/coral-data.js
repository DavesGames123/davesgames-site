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
  deepColours(co, M, nat);
  if (mode === 'height') {
    for (let g = 0; g < n; g++) t[g] = Math.min(1, Math.max(0, (M.py[g] - M.gy[g]) / HEIGHT_SCALE));
  } else t = colourT(M, mode, t, F);
  return { nat, t, rad, F };
}

// Deep-sea colours (the depth regions, CONTRACT-V4.md): below about 40 m
// the light has no red and the corals have no algae, so the natural
// colours give way to the pigments of deep corals, one per colony from
// the seed: bubblegum pink and red, orange, gold (Primnoa) and white for
// the fans; white Lophelia and black coral for the thickets; white
// bamboo and glass sponge. The tips stay lighter (the shading of
// colour.js naturalRGB is kept as a brightness).
const DEEP = {
  fan: [[0.86, 0.26, 0.36], [0.95, 0.46, 0.16], [0.86, 0.66, 0.3], [0.92, 0.9, 0.84], [0.98, 0.6, 0.62]],
  staghorn: [[0.93, 0.91, 0.86], [0.95, 0.82, 0.78], [0.16, 0.12, 0.1], [0.9, 0.55, 0.3]],
  finger: [[0.88, 0.85, 0.76], [0.94, 0.52, 0.2], [0.8, 0.78, 0.9]],
  boulder: [[0.9, 0.88, 0.8], [0.84, 0.74, 0.44], [0.86, 0.8, 0.86]],
  table: [[0.62, 0.5, 0.34], [0.86, 0.72, 0.5]],
};
export function deepColours(co, M, nat) {
  const d = co.depth ?? 0;
  const t = Math.min(1, Math.max(0, (d - 40) / 160));
  if (t <= 0) return nat;
  const pick = new Map();
  for (const c of co.colonies) {
    // the species of the SPECIES table carry their own deep colours: only
    // the five old ids (or a species that asks for it) get a palette here
    const sp = SPECIES[c.id];
    if ((sp && sp.deepColour === false) || !DEEP[c.id]) continue;
    const P = DEEP[c.id];
    let h = Math.imul((c.k + 1) * 2654435761, 0x9e3779b1) ^ Math.imul(co.ci | 0, 0x85ebca6b) ^ Math.imul(co.cj | 0, 0xc2b2ae35);
    h = (h ^ (h >>> 15)) >>> 0;
    pick.set(c.k, P[h % P.length]);
  }
  for (let g = 0; g < M.count; g++) {
    const pal = pick.get(M.col[g]); if (!pal) continue;
    const o = g * 3, lum = (nat[o] + nat[o + 1] + nat[o + 2]) / 3;
    const shade = 0.7 + 0.6 * Math.min(1, lum * 1.6);
    for (let q = 0; q < 3; q++) nat[o + q] += (Math.min(1, pal[q] * shade) - nat[o + q]) * t;
  }
  return nat;
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
