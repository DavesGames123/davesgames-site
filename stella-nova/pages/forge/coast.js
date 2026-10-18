// ============================================================================
//  PLANET FORGE  ·  coast.js — coastline measures on a land mask (no DOM)
// ----------------------------------------------------------------------------
//  Real coasts are fractal (Richardson; Mandelbrot 1967): the measured
//  length grows as the ruler shrinks, L ~ s^(1 - D), with D about 1.25 for
//  rugged coasts (Britain west coast 1.25, Norway 1.52 with the fjords,
//  South Africa 1.02). The island sizes follow a power law,
//  N(area > a) ~ a^-k with k about 0.5-1 (Korcak).
//
//  landMask(M, sea)             1 where the height is over the sea level
//  boxDim(mask, W, H, o)        box-counting dimension of the coastline:
//                               the coast texels (land with a sea
//                               neighbour) in boxes of o.sizes texels
//                               (default 2..64; the tests use 2..32, the
//                               scales the coast relief adds to), in
//                               the band |lat| < o.lat (60 deg; nearer the
//                               poles an equirect box is no longer
//                               square); D = -slope of log N against log s.
//                               The u axis wraps, so a coast across the
//                               date line counts once.
//  islands(mask, W, H, o)       the islands (land components, 4-neighbour,
//                               wrapping in u, across the pole) with their
//                               area in texels at the equator; the largest
//                               (o.skip, default the 1 largest: the
//                               continents) are dropped; the exponent k of
//                               N(> a) from a least-squares fit on log-log
//                               over areas of minA..maxA texels
//
//  grep -n targets: "export function landMask", "export function boxDim",
//  "export function islands"
// ============================================================================

export function landMask(M, sea) {
  const n = M.W * M.H, m = new Uint8Array(n);
  for (let i = 0; i < n; i++) m[i] = M.height[i] > sea ? 1 : 0;
  return m;
}

const fitSlope = (xs, ys) => {
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  return sxx > 0 ? sxy / sxx : 0;
};

export function boxDim(mask, W, H, o = {}) {
  const lat = (o.lat ?? 60) * Math.PI / 180;
  const y0 = Math.ceil(H * (0.5 - lat / Math.PI)), y1 = Math.floor(H * (0.5 + lat / Math.PI));
  // coast texels: land with a 4-neighbour sea texel (u wraps)
  const coast = new Uint8Array(W * H);
  let nCoast = 0;
  for (let y = Math.max(1, y0); y < Math.min(H - 1, y1); y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!mask[i]) continue;
    if (!mask[y * W + (x + 1) % W] || !mask[y * W + (x + W - 1) % W] || !mask[i - W] || !mask[i + W]) { coast[i] = 1; nCoast++; }
  }
  const sizes = o.sizes || [2, 4, 8, 16, 32, 64], xs = [], ys = [], counts = [];
  for (const s of sizes) {
    const seen = new Set();
    for (let y = Math.max(1, y0); y < Math.min(H - 1, y1); y++) for (let x = 0; x < W; x++) if (coast[y * W + x]) seen.add(Math.floor(y / s) * 100000 + Math.floor(x / s));
    counts.push(seen.size); xs.push(Math.log(s)); ys.push(Math.log(Math.max(1, seen.size)));
  }
  return { D: -fitSlope(xs, ys), counts, sizes, nCoast };
}

export function islands(mask, W, H, o = {}) {
  const lab = new Int32Array(W * H).fill(-1), areas = [], stack = [];
  for (let s = 0; s < W * H; s++) {
    if (!mask[s] || lab[s] >= 0) continue;
    const id = areas.length; let a = 0;
    lab[s] = id; stack.push(s);
    while (stack.length) {
      const i = stack.pop(), x = i % W, y = (i - x) / W;
      a += Math.sin((y + 0.5) / H * Math.PI);   // area at the equator scale
      const nb = [y * W + (x + 1) % W, y * W + (x + W - 1) % W, y > 0 ? i - W : (x + W / 2) % W, y < H - 1 ? i + W : (H - 1) * W + (x + W / 2) % W];
      for (const j of nb) if (mask[j] && lab[j] < 0) { lab[j] = id; stack.push(j); }
    }
    areas.push(a);
  }
  areas.sort((p, q) => q - p);
  const kept = areas.slice(o.skip ?? 1), minA = o.minA ?? 2, maxA = o.maxA ?? 2000;
  // N(> a) at log-spaced a in [minA, maxA]
  const xs = [], ys = [];
  for (let a = minA; a <= maxA; a *= 1.6) {
    const n = kept.filter(v => v > a).length;
    if (n >= 3) { xs.push(Math.log(a)); ys.push(Math.log(n)); }
  }
  return { count: areas.length, kept: kept.length, k: xs.length >= 3 ? -fitSlope(xs, ys) : NaN, points: xs.length, largest: areas.slice(0, 3) };
}
