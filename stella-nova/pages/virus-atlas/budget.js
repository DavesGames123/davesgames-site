// ============================================================================
//  VIRUS ATLAS  ·  budget.js — the GPU memory budget of the 3D view
// ----------------------------------------------------------------------------
//  No DOM and no three.js: tests.mjs checks the arithmetic.
//
//  The view draws straight to the canvas: no render targets and no post
//  passes. The canvas holds two colour buffers (front and back, 4 B/px
//  each) and depth (4 B/px). With MSAA, the multisample buffer holds a
//  colour and a depth value per sample (8 B/px/sample).
//  A page crashed Safari when it allocated full-size multisample HalfFloat
//  targets at a device pixel ratio of 2. So:
//    - the pixel ratio falls until the drawing buffer is at most MAX_PX;
//    - MSAA is on only at a pixel ratio below 1.5 (at 2 the beads are
//      smooth without it) and only when its buffer fits in MS_BYTES.
//  The bead data on the GPU is small (textures of the asymmetric unit,
//  16 B per bead), and gpuBeadBytes() reports it.
//
//  maxInstances(coarse) is the instance budget per frame: the stride
//  (LOD) of a part is the smallest whole number that keeps it inside.
//
//  REPRESENTATIONS (view.js, reps.js). Each view has its own draw cap,
//  so a phone gets fewer instances and a lighter mesh:
//    beads, space, toon, glow  the bead quads (maxInstances)
//    tube    segments per frame (tubeCap); rings x sides per segment
//            (tubeMesh): 4 x 8 on a desktop, 4 x 6 on a phone
//    blob    ellipsoids per frame (blobCap); a box of 12 triangles each
//    cage    nodes and edges (cageCap), two triangles each
//  repGpuBytes(rep, sizes) is the data the GPU holds for one part in a
//  view; tests.mjs checks every view of the largest entry (the HIV cone)
//  against DATA_BUDGET on a phone and a desktop profile.
//
//  A touch device draws at most PHONE_PX pixels (canvasBudget opts.coarse).
//
//  EXPORTS  MAX_PX, PHONE_PX, MS_BYTES, canvasBudget, gpuBeadBytes, maxInstances,
//           strideFor, REPS, tubeCap, tubeMesh, blobCap, cageCap,
//           repStride, repGpuBytes, DATA_BUDGET
// ============================================================================
export const MAX_PX = 2560 * 1440;
export const MS_BYTES = 48e6;

// a touch device (opts.coarse) gets PHONE_PX: a tablet at 2x would
// otherwise fill 3 M pixels with large impostor quads
export const PHONE_PX = 2.2e6;
export function canvasBudget(cssW, cssH, dpr = 1, opts = {}) {
  const maxPx = opts.maxPx || (opts.coarse ? PHONE_PX : MAX_PX);
  const area = Math.max(1, cssW * cssH);
  let pr = Math.min(dpr || 1, 2, Math.sqrt(maxPx / area));
  pr = Math.max(0.25, Math.floor(pr * 1000) / 1000);
  const px = Math.round(cssW * pr) * Math.round(cssH * pr);
  const samples = pr < 1.5 && px * 4 * 8 <= (opts.msBytes || MS_BYTES) ? 4 : 0;
  const bytes = px * 12 + px * samples * 8;
  return { pr, px, samples, antialias: samples > 0, bytes };
}

// Bead, operator and unit textures of one part, in bytes (RGBA32F, rows of
// 2048 texels, padded to a whole row).
export function gpuBeadBytes(nBeads, nOps, nUnits) {
  const tex = n => Math.ceil(Math.max(1, n) / 2048) * 2048 * 16;
  return tex(nBeads) + tex(3 * nOps) + tex(2 * nUnits);
}

export function maxInstances(coarse) { return coarse ? 260000 : 900000; }

// The smallest stride that keeps beads * copies / stride under the cap.
export function strideFor(nBeads, nCopies, cap) {
  return Math.max(1, Math.ceil(nBeads * nCopies / Math.max(1, cap)));
}

// ── representations ───────────────────────────────────────────────────────
export const REPS = ['beads', 'space', 'tube', 'blob', 'cage', 'glow', 'toon'];
export const DATA_BUDGET = 32e6;
export function tubeCap(coarse) { return coarse ? 40000 : 140000; }
export function tubeMesh(coarse) { return coarse ? { rings: 4, sides: 6 } : { rings: 4, sides: 8 }; }
export function blobCap(coarse) { return coarse ? 80000 : 200000; }
export function cageCap(coarse) { return coarse ? 6000 : 20000; }
// the stride of a view: tube segments thin out like the beads
export function repStride(rep, nBeads, nCopies, coarse) {
  if (rep === 'tube') return strideFor(nBeads, nCopies, tubeCap(coarse));
  return strideFor(nBeads, nCopies, maxInstances(coarse));
}
// sizes: { nBeads, nOps, nUnits, nBlobs, nNodes, nEdges, coarse }
// Every view keeps the bead, operator and unit textures (16 B per texel),
// the aux texture (RGBA8) and the chain colours; each adds its own.
export function repGpuBytes(rep, z) {
  const row = n => Math.ceil(Math.max(1, n) / 2048) * 2048;
  let b = gpuBeadBytes(z.nBeads, z.nOps, z.nUnits) + row(z.nBeads) * 4 + row(z.nChains || 1) * 4;
  if (rep === 'tube') { const m = tubeMesh(z.coarse); b += m.rings * m.sides * 8 + (m.rings - 1) * m.sides * 6 * 2; }
  if (rep === 'blob') b += row(4 * z.nBlobs) * 16 + 8 * 12 + 36 * 2;
  if (rep === 'cage') b += (z.nNodes || 0) * 24 + (z.nEdges || 0) * 40 + 4 * 12;
  return b;
}
