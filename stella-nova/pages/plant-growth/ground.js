// ============================================================================
//  PLANT GROWTH  ·  the ground: height, micro-relief, flat pads (DOM-free)
// ----------------------------------------------------------------------------
//  The ground near the plants has a gentle micro-relief: six sine waves at
//  odd angles, with wavelengths of 2 to 17 m and an amplitude of about
//  +-0.12 m. It makes hollows (wet, where leaf litter piles up) and low
//  rises. Beyond FLAT_R, low hills rise to the horizon (no edge: the hills
//  start at zero slope).
//
//  PADS. The relief is zero on a pad: a disc round each plant base and the
//  soil cut-away, with a smooth rise to the full relief over PAD_RISE. So
//  a trunk stands on its own ground, and the cut-away top is level.
//  setPads() sets the pads in JavaScript; render.js puts the same list in
//  the uniforms uPads / uNPads, which GROUND_GLSL reads.
//
//  groundY() is the height in JavaScript (leaf landing in mesh.js, eco.js
//  placement, the tests) and GROUND_GLSL is the same function for the
//  shaders (the ground mesh, the grass, the props, falling leaves).
//
//  grep -n targets
//    micro-relief ....... "export function relief"
//    pads ............... "export function setPads"
//    height ............. "export function groundY"
//    GLSL copy .......... "export const GROUND_GLSL"
//    soil cut-away ...... "export function inCutaway"
// ============================================================================

export const FLAT_R = 16;          // the hills start here
export const PAD_RISE = 1.4;       // m from a pad edge to the full relief
export const MAX_PADS = 8;

// [kx, kz, phase, amplitude]: wave vectors in rad/m
const WAVES = [
  [0.369, 0.0, 0.0, 0.034],
  [0.130, 0.333, 1.9, 0.030],
  [-0.592, 0.454, 4.1, 0.020],
  [0.996, 1.513, 2.7, 0.012],
  [-1.210, 2.540, 0.6, 0.008],
  [0.214, -0.236, 5.3, 0.040],
];
export const RELIEF_AMP = WAVES.reduce((s, w) => s + w[3], 0);

export function relief(x, z) {
  let h = 0;
  for (const w of WAVES) h += w[3] * Math.sin(w[0] * x + w[1] * z + w[2]);
  return h;
}

let PADS = [];
// list: [{ x, z, r }] (at most MAX_PADS are used)
export function setPads(list) { PADS = (list || []).slice(0, MAX_PADS).map(p => ({ x: p.x, z: p.z, r: p.r })); }
export function getPads() { return PADS; }
function padMask(x, z) {
  let m = 1;
  for (const p of PADS) {
    const d = Math.hypot(x - p.x, z - p.z), k = Math.min(1, Math.max(0, (d - p.r) / PAD_RISE));
    m = Math.min(m, k * k * (3 - 2 * k));
  }
  return m;
}

function hills(x, z) {
  return 1.6 * Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.038 - 0.7)
    + 0.9 * Math.sin(x * 0.11 - z * 0.07 + 2.1)
    + 0.35 * Math.sin(x * 0.23 + z * 0.19);
}
export function groundY(x, z) {
  const r = Math.hypot(x, z);
  let y = relief(x, z) * padMask(x, z);
  if (r > FLAT_R) {
    const k = Math.min(1, (r - FLAT_R) / 30);
    const s = k * k * (3 - 2 * k);
    y += s * (hills(x, z) + 1.2 + 0.03 * (r - FLAT_R));
  }
  return y;
}

const f = v => (v < 0 ? '' : '') + v.toFixed(4);
export const GROUND_GLSL = /* glsl */`
const float FLAT_R = ${FLAT_R.toFixed(1)};
uniform vec4 uPads[${MAX_PADS}];
uniform float uNPads;
float relief(float x, float z) {
  return ${WAVES.map(w => `${f(w[3])} * sin(${f(w[0])} * x + ${f(w[1])} * z + ${f(w[2])})`).join('\n    + ')};
}
float padMask(float x, float z) {
  float m = 1.0;
  for (int k = 0; k < ${MAX_PADS}; k++) {
    if (float(k) >= uNPads) break;
    vec4 p = uPads[k];
    float d = length(vec2(x, z) - p.xy);
    m = min(m, smoothstep(0.0, 1.0, (d - p.z) / ${PAD_RISE.toFixed(2)}));
  }
  return m;
}
float groundY(float x, float z) {
  float r = length(vec2(x, z));
  float y = relief(x, z) * padMask(x, z);
  if (r > FLAT_R) {
    float k = min(1.0, (r - FLAT_R) / 30.0);
    float s = k * k * (3.0 - 2.0 * k);
    float h = 1.6 * sin(x * 0.045 + 1.3) * cos(z * 0.038 - 0.7) + 0.9 * sin(x * 0.11 - z * 0.07 + 2.1) + 0.35 * sin(x * 0.23 + z * 0.19);
    y += s * (h + 1.2 + 0.03 * (r - FLAT_R));
  }
  return y;
}
`;

// The soil cut-away (roots on): the quarter x > 0, z > 0 within radius R.
export function inCutaway(x, z, R) { return x > 0 && z > 0 && x * x + z * z < R * R; }
