// ============================================================================
//  ROCHE LIMIT  ·  budget.js — the GPU memory budget of the page
// ----------------------------------------------------------------------------
//  No DOM and no GPU, so tests.mjs can check the arithmetic (the pattern of
//  pages/hopf-fibration/budget.js).
//
//  THE SCENE TARGET (render.js). Colour rgba16float (8 B/px) and depth32
//  (4 B/px). With MSAA each sample holds both, and a resolve texture holds
//  the result: samples * 12 + 8 B/px. With one sample the scene draws into
//  the resolve texture straight: 12 B/px. The bloom chain is 6 levels from
//  half size down (8 B/px each): about 2.67 B per full px. The canvas holds
//  about three 4 B/px buffers (swap chain): 12 B/px.
//
//  THE RULES. renderBudget() picks the pixel ratio and the sample count:
//    - the pixel ratio is at most PR_CAP (2 desktop, 1.5 touch) and keeps
//      the drawing buffer under the preset's pixel count (QUALITY maxPx in
//      app/env.js, times the governor's scale squared)
//    - 4x MSAA only at a pixel ratio of MSAA_PR_MAX (1.25) or less, and
//      only while the MSAA target fits MS_BYTES: never a full-res MSAA
//      half-float target at DPR 2. Above that the scene has one sample;
//      the pixels are small enough that the grains blend (render.js
//      fs_blend) in place of alpha-to-coverage.
//    - a touch screen never takes MSAA (tile GPUs, shared memory)
//
//  THE SIMULATION (engine.js makeBuffers): simBytes(N) adds up every
//  buffer of one SimGPU; ringBytes(gridN) the ring grid and its two tau
//  textures; partBytes(N) the renderer's per-moon tag and stress buffers.
//
//  EXPORTS  QUALITY, PR_CAP, MSAA_PR_MAX, MS_BYTES, LIMIT, renderBudget, sceneBytes,
//           simBytes, ringBytes, partBytes, pageBytes
// ============================================================================

// The quality presets (app/env.js re-exports them): grains, pixel budget,
// bloom, ring grid. Auto takes medium, or low on a touch screen.
export const QUALITY = {
  high:   { N: 16384, maxPx: 3.6e6, bloom: true, gridN: 1024 },
  medium: { N: 8192,  maxPx: 1.8e6, bloom: true, gridN: 512 },
  low:    { N: 4096,  maxPx: 0.9e6, bloom: false, gridN: 512 },
};
export const PR_CAP = { desktop: 2, touch: 1.5 };
export const MSAA_PR_MAX = 1.25;
export const MS_BYTES = 96e6;
// what tests.mjs holds each profile to (scene + bloom + canvas + sims + ring)
export const LIMIT = { desktop: 192e6, touch: 72e6 };

export function sceneBytes(px, samples) {
  const scene = samples > 1 ? px * (samples * 12 + 8) : px * 12;
  const bloom = px * 8 * (1 / 4) * (4 / 3) * (1 - Math.pow(1 / 4, 6));
  return { scene, bloom, canvas: px * 12, total: scene + bloom + px * 12 };
}

// cssW, cssH: the canvas in CSS px; dpr: devicePixelRatio; o.maxPx: the
// preset's pixel budget; o.scale: the governor's render scale; o.touch:
// a coarse pointer or a phone layout.
export function renderBudget(cssW, cssH, dpr, o = {}) {
  const area = Math.max(1, cssW * cssH), touch = !!o.touch;
  const maxPx = (o.maxPx || 1.8e6) * (o.scale || 1) ** 2;
  let pr = Math.min(dpr || 1, touch ? PR_CAP.touch : PR_CAP.desktop, Math.sqrt(maxPx / area));
  pr = Math.max(0.25, Math.floor(pr * 1000) / 1000);
  const w = Math.max(2, Math.round(cssW * pr)), h = Math.max(2, Math.round(cssH * pr)), px = w * h;
  const samples = !touch && pr <= MSAA_PR_MAX && px * 4 * 12 <= MS_BYTES ? 4 : 1;
  return { pr, w, h, px, samples, bytes: sceneBytes(px, samples) };
}

// One SimGPU (engine.js makeBuffers), NB = 24 slots, CAP = 16 per bucket.
export function simBytes(N, NB = 24, CAP = 16) {
  const np = Math.ceil(N / 256) * 256, H = 1 << Math.max(12, Math.ceil(Math.log2(8 * N)));
  const b = np * 48 + np * 64 + np * 32 + np * 16 + np * 16
    + 2 * (np * NB + np) * 4 + 2 * np * NB * 16 + (H * 4 + 16) + H * CAP * 4
    + np * 48 + np * 32 + np * 16 + 16 + 96 + 256 * 4096;
  return b;
}
export function ringBytes(gridN) { return gridN * gridN * 4 + 2 * gridN * gridN * 8; }
export function partBytes(N) { const np = Math.ceil(N / 256) * 256; return np * 4 + np * 8 + 96; }
// The whole page for a profile: { cssW, cssH, dpr, touch, maxPx, N, sats, gridN }
export function pageBytes(p) {
  const r = renderBudget(p.cssW, p.cssH, p.dpr, p);
  const sims = (p.sats || 1) * (simBytes(p.N) + partBytes(p.N));
  const total = r.bytes.total + sims + ringBytes(p.gridN || 512);
  return { r, sims, ring: ringBytes(p.gridN || 512), total };
}
