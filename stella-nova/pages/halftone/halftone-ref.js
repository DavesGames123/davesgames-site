// ============================================================================
//  HALFTONE  ·  halftone-ref.js — the CPU twin of shaders/halftone.wgsl
// ----------------------------------------------------------------------------
//  A JavaScript port of glsl-halftone (stackgl, MIT) and of the simplex
//  noise of glsl-noise / webgl-noise (Ian McEwan, Ashima Arts, MIT). The
//  page does not use it to draw. tests.mjs uses it as the reference that the
//  WGSL output must match.
//
//  FLOAT32. Every step rounds to float32 (Math.fround), in the order of the
//  GLSL source, so the result follows a GPU and not float64. A GPU can fuse
//  a multiply and an add, so a small difference stays possible.
//
//  DERIVATIVES. aastep needs dFdx and dFdy of its value. A GPU computes
//  them in 2 x 2 pixel quads. halftonePixel takes the value at the other
//  pixels of the quad and returns two results: 'fine' (the difference on
//  the pixel's own row and column) and 'coarse' (the difference at the top
//  left pixel of the quad, for all four pixels). The WebGPU spec lets the
//  GPU use either one for dpdx and dpdy.
//
//  COORDINATES (as the upstream README example): pixel (x, y) from the top
//  left of a W x H image, uv = (x + 0.5, y + 0.5) / (W, H), st = (uv.x W/H,
//  1 - uv.y). The y flip gives the GL origin (bottom left) of the upstream
//  demo, so the screen angles look as they do there.
//
//  grep -n: "export function snoise"  "export function screenValues"
//           "export function compose"  "export function halftonePixel"
// ============================================================================
const f = Math.fround;
const floor = x => f(Math.floor(x));
const fract = x => f(x - Math.floor(x));
const INV289 = f(1 / 289);

const mod289 = x => f(x - f(floor(f(x * INV289)) * 289));
const permute = x => mod289(f(f(f(x * 34) + 1) * x));

const C = [f(0.211324865405187), f(0.366025403784439), f(-0.577350269189626), f(0.024390243902439)];

/** glsl-noise simplex/2d snoise(vec2), in float32 steps. Range about -1..1. */
export function snoise(vx, vy) {
  vx = f(vx); vy = f(vy);
  // First corner
  const dvy = f(f(vx * C[1]) + f(vy * C[1]));
  let ix = floor(f(vx + dvy)), iy = floor(f(vy + dvy));
  const dix = f(f(ix * C[0]) + f(iy * C[0]));
  const x0x = f(f(vx - ix) + dix), x0y = f(f(vy - iy) + dix);
  // Other corners
  const i1x = x0x > x0y ? 1 : 0, i1y = x0x > x0y ? 0 : 1;
  const x12 = [f(f(x0x + C[0]) - i1x), f(f(x0y + C[0]) - i1y), f(x0x + C[2]), f(x0y + C[2])];
  // Permutations
  ix = mod289(ix); iy = mod289(iy);
  const p0 = permute(f(permute(f(iy + 0)) + f(ix + 0)));
  const p1 = permute(f(permute(f(iy + i1y)) + f(ix + i1x)));
  const p2 = permute(f(permute(f(iy + 1)) + f(ix + 1)));
  const d0 = f(f(x0x * x0x) + f(x0y * x0y));
  const d1 = f(f(x12[0] * x12[0]) + f(x12[1] * x12[1]));
  const d2 = f(f(x12[2] * x12[2]) + f(x12[3] * x12[3]));
  const m = [d0, d1, d2].map(d => { let q = Math.max(f(0.5 - d), 0); q = f(q * q); return f(q * q); });
  // Gradients: 41 points uniformly over a line, mapped onto a diamond.
  const g = [0, 0, 0];
  const px = [p0, p1, p2], X = [[x0x, x0y], [x12[0], x12[1]], [x12[2], x12[3]]];
  let sum = 0;
  for (let j = 0; j < 3; j++) {
    const x = f(f(2 * fract(f(px[j] * C[3]))) - 1);
    const h = f(Math.abs(x) - 0.5);
    const ox = floor(f(x + 0.5));
    const a0 = f(x - ox);
    const mj = f(m[j] * f(f(1.79284291400159) - f(f(0.85373472095314) * f(f(a0 * a0) + f(h * h)))));
    g[j] = f(f(a0 * X[j][0]) + f(h * X[j][1]));
    sum = f(sum + f(mj * g[j]));
  }
  return f(130 * sum);
}

/** st of pixel (x, y) in a W x H image (see COORDINATES). */
export function stAt(x, y, W, H) {
  const ux = f(f(x + 0.5) / W), uy = f(f(y + 0.5) / H);
  return [f(ux * f(W / H)), f(1 - uy)];
}

// The four screen matrices as GLSL mat2(a, b, c, d) (columns first):
// M * st = (a st.x + c st.y, b st.x + d st.y).
const MATS = {
  k: [0.707, -0.707, 0.707, 0.707],
  c: [0.966, -0.259, 0.259, 0.966],
  m: [0.966, 0.259, -0.259, 0.966],
};
function screenLen(mat, freq, sx, sy) {
  let qx, qy;
  if (mat) {
    const [a, b, c, d] = mat.map(f);
    // frequency * mat * st: GLSL scales the matrix first (scalar * mat2).
    qx = f(f(f(freq * a) * sx) + f(f(freq * c) * sy));
    qy = f(f(f(freq * b) * sx) + f(f(freq * d) * sy));
  } else { qx = f(freq * sx); qy = f(freq * sy); }
  const ux = f(f(2 * fract(qx)) - 1), uy = f(f(2 * fract(qy)) - 1);
  return f(Math.sqrt(f(f(ux * ux) + f(uy * uy))));
}

/**
 * The noise n and the four aastep values of glsl-halftone at one point:
 * { n, k, c, m, y }, where each plate value is sqrt(ink) - length(uv) + n.
 * tex is [r, g, b] in 0..1.
 */
export function screenValues(tex, st, freq = 30) {
  freq = f(freq);
  const [sx, sy] = st;
  let n = f(0.1 * snoise(f(sx * 200), f(sy * 200)));
  n = f(n + f(0.05 * snoise(f(sx * 400), f(sy * 400))));
  n = f(n + f(0.025 * snoise(f(sx * 800), f(sy * 800))));
  const cx = f(1 - tex[0]), cy = f(1 - tex[1]), cz = f(1 - tex[2]);
  const w = Math.min(cx, Math.min(cy, cz));
  const ink = [f(cx - w), f(cy - w), f(cz - w), w];
  const v = (i, mat) => f(f(f(Math.sqrt(ink[i])) - screenLen(mat, freq, sx, sy)) + n);
  return { n, k: v(3, MATS.k), c: v(0, MATS.c), m: v(1, MATS.m), y: v(2, null) };
}

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, f(f(x - e0) / f(e1 - e0))));
  return f(f(t * t) * f(3 - f(2 * t)));
}
/** glsl-aastep with the derivative path; dx and dy are dFdx and dFdy of value. */
export function aastep(threshold, value, dx, dy) {
  const afw = f(f(Math.sqrt(f(f(dx * dx) + f(dy * dy)))) * f(0.70710678118654757));
  return smoothstep(f(threshold - afw), f(threshold + afw), value);
}

/** The colour that glsl-halftone returns, from the noise and the four coverages. */
export function compose(n, k, c, m, y) {
  const black = f(n + 0.1);
  const t = f(f(0.85 * k) + f(0.3 * n));
  return [c, m, y].map(q => { const s = f(f(1 - f(0.9 * q)) + n); return f(s + f(f(black - s) * t)); });
}

/**
 * The upstream halftone at pixel (x, y) of a W x H image. tex(x, y) gives the
 * texel colour [r, g, b] in 0..1. Returns { fine: [r, g, b], coarse: [r, g, b] }.
 */
export function halftonePixel(tex, W, H, x, y, freq = 30) {
  const val = (px, py) => screenValues(tex(px, py), stAt(px, py, W, H), freq);
  const here = val(x, y);
  const qx = x & ~1, qy = y & ~1;
  const cache = new Map();
  const at = (px, py) => { const k = px + ',' + py; if (!cache.has(k)) cache.set(k, px === x && py === y ? here : val(px, py)); return cache.get(k); };
  const out = {};
  for (const mode of ['fine', 'coarse']) {
    // fine: dFdx on the pixel's row of the quad, dFdy on its column.
    const rx = mode === 'fine' ? y : qy, cx = mode === 'fine' ? x : qx;
    const a = at(qx, rx), b = at(qx + 1, rx), c = at(cx, qy), d = at(cx, qy + 1);
    const cov = key => aastep(0, here[key], f(b[key] - a[key]), f(d[key] - c[key]));
    out[mode] = compose(here.n, cov('k'), cov('c'), cov('m'), cov('y'));
  }
  return out;
}

/** Float to an 8-bit unorm byte, as a render target stores it. */
export const q8 = v => Math.round(Math.min(1, Math.max(0, v)) * 255);
