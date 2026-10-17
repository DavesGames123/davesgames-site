// ============================================================================
//  PLANT GROWTH  ·  the ground: height, the grass field, the cut-away (DOM-free)
// ----------------------------------------------------------------------------
//  The garden is flat within FLAT_R of the origin, so the plants, the soil
//  cut-away and the leaf litter sit on y = 0. Beyond it, low hills rise to
//  the horizon. groundY() is the height in JavaScript (leaf landing in
//  mesh.js, the tests) and GROUND_GLSL is the same function for the
//  shaders (the ground mesh, the grass, falling leaves).
//
//  grassField() scatters grass tufts with a seed: dense near the plants,
//  thinner far off, none on a trunk or in the soil cut-away.
//
//  grep -n targets
//    height ............. "export function groundY"
//    GLSL copy .......... "export const GROUND_GLSL"
//    grass field ........ "export function grassField"
//    soil cut-away ...... "export function inCutaway"
// ============================================================================
import { rng } from '../../lib/dla-engine.js';

export const FLAT_R = 16;

function hills(x, z) {
  return 1.6 * Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.038 - 0.7)
    + 0.9 * Math.sin(x * 0.11 - z * 0.07 + 2.1)
    + 0.35 * Math.sin(x * 0.23 + z * 0.19);
}
export function groundY(x, z) {
  const r = Math.hypot(x, z);
  if (r <= FLAT_R) return 0;
  const k = Math.min(1, (r - FLAT_R) / 30);
  const s = k * k * (3 - 2 * k);
  return s * (hills(x, z) + 1.2 + 0.03 * (r - FLAT_R));
}

export const GROUND_GLSL = /* glsl */`
const float FLAT_R = ${FLAT_R.toFixed(1)};
float groundY(float x, float z) {
  float r = length(vec2(x, z));
  if (r <= FLAT_R) return 0.0;
  float k = min(1.0, (r - FLAT_R) / 30.0);
  float s = k * k * (3.0 - 2.0 * k);
  float h = 1.6 * sin(x * 0.045 + 1.3) * cos(z * 0.038 - 0.7) + 0.9 * sin(x * 0.11 - z * 0.07 + 2.1) + 0.35 * sin(x * 0.23 + z * 0.19);
  return s * (h + 1.2 + 0.03 * (r - FLAT_R));
}
`;

// The soil cut-away (roots on): the quarter x > 0, z > 0 within radius R.
export function inCutaway(x, z, R) { return x > 0 && z > 0 && x * x + z * z < R * R; }

// Grass tufts: Float32Array of [x, z, scale, rand] per tuft.
// opts: n, radius, seed, avoid ([{ x, z, r }]), cut (cut-away radius or 0)
export function grassField(opts = {}) {
  const n = opts.n ?? 60000, R = opts.radius ?? 26, r = rng(opts.seed ?? 5);
  const out = new Float32Array(n * 4);
  let k = 0, tries = 0;
  while (k < n && tries < n * 6) {
    tries++;
    // more tufts near the middle: radius from a mix of uniform disc and a core
    const u = r(), rr = R * (u < 0.55 ? Math.sqrt(r()) * 0.55 : Math.sqrt(r()));
    const a = r() * Math.PI * 2, x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (opts.cut && inCutaway(x, z, opts.cut + 0.05)) continue;
    let bad = false;
    if (opts.avoid) for (const p of opts.avoid) if ((x - p.x) ** 2 + (z - p.z) ** 2 < p.r * p.r) { bad = true; break; }
    if (bad) continue;
    out[k * 4] = x; out[k * 4 + 1] = z; out[k * 4 + 2] = 0.6 + 0.8 * r() * r(); out[k * 4 + 3] = r();
    k++;
  }
  return out.subarray(0, k * 4);
}
