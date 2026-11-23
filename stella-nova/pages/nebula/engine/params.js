// params.js: shared constants and the parallax and slab math of the star map (spec 3.1, 3.2, 7.4.2).
// Other rows import this module. Do not add state here. Every function is pure.
// Units: content px. p = parallax factor. z = depth in px, z = 0 is nearest the viewer.

export const CONTENT_W = 5760, CONTENT_H = 1080, DEPTH = 1920, P_NEAR = 1.1625, P_SPAN = 0.6;
export const VIEW_MIN = 1440, VIEW_MAX = 2600, SLAB_COUNT = 24, ROUTE_SLAB = 6, NEAR_FIRST = 6, NEAR_COUNT = 6;
export const TIERS = {
  W: { name: 'W', dims: [288, 54, 48], cell: [20, 20, 40], scale: 0.5, near: [2880, 540], far: [1440, 270] },
  U: { name: 'U', dims: [576, 108, 96], cell: [10, 10, 20], scale: 1.0, near: [5760, 1080], far: [2880, 540] },
};

// Slab k parallax. Slab 6 is the route plane and returns exactly 1.
export function slabP(k) { return k === ROUTE_SLAB ? 1 : 1 + 0.025 * (ROUTE_SLAB - k); }

// The compositor uses this width for the scroll range S only (3.1).
export function clampView(viewW) { return Math.min(VIEW_MAX, Math.max(VIEW_MIN, viewW)); }

// Slab k depth centre in px.
export function slabZc(k) { return 80 * k + 40; }

// Depth z (px) of parallax p.
export function depthOf(p) { return (P_NEAR - p) * 3200; }

// World span L_p that a slab of parallax p must hold. W_ext = VIEW_MAX for p <= 1, VIEW_MIN for p > 1.
export function slabSpan(p) { return CONTENT_W * p + (1 - p) * (p <= 1 ? VIEW_MAX : VIEW_MIN); }

// World x of the left slab edge.
export function slabX0(p) { return 0.5 * CONTENT_W - 0.5 * slabSpan(p); }

// Scroll range S, for the shear only.
export function scrollRange(viewW) { return CONTENT_W - clampView(viewW); }

// Screen x (canvas units) to world x at scroll s for parallax p.
export function worldX(xs, s, p, viewW) { const S = scrollRange(viewW); return xs + 0.5 * S + p * (s - 0.5 * S); }

// Storage tier and layer index of slab k.
export function tierOf(k) {
  return (k >= NEAR_FIRST && k < NEAR_FIRST + NEAR_COUNT)
    ? { tier: 'near', layer: k - NEAR_FIRST }
    : { tier: 'far', layer: k < NEAR_FIRST ? k : k - NEAR_COUNT };
}

// Tent weight of depth z (px) for slab k (2.11.5). Support [zc - 80, zc + 80].
// Slab 0 is flat (weight 1) in front of its centre, slab 23 is flat behind its centre.
// The weights of all slabs add to 1 at every z in [0, DEPTH].
export function tent(z, k) {
  const zc = slabZc(k);
  if (k === 0 && z <= zc) return 1;
  if (k === SLAB_COUNT - 1 && z >= zc) return 1;
  return Math.max(0, 1 - Math.abs(z - zc) / 80);
}
