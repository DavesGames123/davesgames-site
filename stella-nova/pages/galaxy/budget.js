// ============================================================================
//  GALAXY  ·  budget.js — the GPU memory budget and the quality levels
// ----------------------------------------------------------------------------
//  No DOM and no GPU, so tests.mjs can check the arithmetic. The same
//  pattern as pages/hopf-fibration/budget.js: a page there crashed Safari
//  with full-size multisample HalfFloat targets at DPR 2.
//
//  Targets per frame (no MSAA anywhere; the sprites are soft):
//    stars     rgba16float at the render size        8 B/px
//    volume    rgba16float at volScale^2 of it       8 B/px x volScale^2
//    bloom     rgba16float, 1/2 .. 1/2^L per side    8 B/px x sum 4^-i
//    canvas    two swap buffers and one in flight    12 B/px
//  Fixed: the 3D noise tile (N^3 x 4 B) and the star buffer (64 B a star).
//
//  galaxyBudget(cssW, cssH, dpr, { phone, quality }) gives the pixel ratio,
//  the target sizes, the ray steps and the star count. The pixel ratio
//  falls until the render size is at most maxPx and all bytes fit.
//
//  EXPORTS  QUALITY, LIMITS, NOISE_N, bloomLevels, galaxyBudget
// ============================================================================

export const NOISE_N = 96;
export const QUALITY = {
  low: { pr: 1, vol: 0.4, steps: 30, stars: 45000, detail: 0.6 },
  medium: { pr: 1.5, vol: 0.45, steps: 46, stars: 95000, detail: 0.85 },
  high: { pr: 2, vol: 0.5, steps: 64, stars: 160000, detail: 1 },
};
export const LIMITS = {
  desktop: { maxPx: 2560 * 1600, bytes: 150e6 },
  phone: { maxPx: 1300 * 900, bytes: 56e6 },
};

// Bloom levels: halve until the short side is under 24 px, at most 6.
export function bloomLevels(w, h) {
  const out = []; let x = w, y = h;
  for (let i = 0; i < 6; i++) { x = Math.max(1, Math.ceil(x / 2)); y = Math.max(1, Math.ceil(y / 2)); out.push([x, y]); if (Math.min(x, y) < 24) break; }
  return out;
}

export function frameBytes(w, h, vol) {
  const px = w * h, vw = Math.max(1, Math.round(w * vol)), vh = Math.max(1, Math.round(h * vol));
  let bloom = 0; for (const [x, y] of bloomLevels(w, h)) bloom += x * y * 8;
  return { stars: px * 8, volume: vw * vh * 8, bloom, canvas: px * 12, exposure: 2 * 8 };
}

export function galaxyBudget(cssW, cssH, dpr = 1, { phone = false, quality } = {}) {
  const Q = QUALITY[quality || (phone ? 'low' : 'high')] || QUALITY.medium;
  const lim = phone ? LIMITS.phone : LIMITS.desktop;
  const area = Math.max(1, cssW * cssH);
  const stars = Q.stars, fixed = NOISE_N ** 3 * 4 + stars * 1.06 * 64;
  let pr = Math.min(dpr || 1, Q.pr, Math.sqrt(lim.maxPx / area));
  pr = Math.max(0.25, Math.floor(pr * 1000) / 1000);
  let w, h, b, total;
  for (let i = 0; i < 40; i++) {
    w = Math.max(1, Math.round(cssW * pr)); h = Math.max(1, Math.round(cssH * pr));
    b = frameBytes(w, h, Q.vol);
    total = b.stars + b.volume + b.bloom + b.canvas + b.exposure + fixed;
    if (total <= lim.bytes || pr <= 0.25) break;
    pr = Math.max(0.25, pr * 0.92);
  }
  return {
    pr, w, h, vol: Q.vol, vw: Math.max(1, Math.round(w * Q.vol)), vh: Math.max(1, Math.round(h * Q.vol)),
    steps: Q.steps, stars, detail: Q.detail, bytes: Object.assign(b, { fixed }), total, limit: lim.bytes,
  };
}
