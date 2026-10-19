// ============================================================================
//  CORAL REEF  ·  focus-light.js  ·  the inspection light of an orbit (DOM-free)
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "there's a problem that focusing on objects
//  does not light them up in deep water". Two lights answer it:
//    1. the squad: discoveries.js select() asks main.js to send one ROV
//       (the selected one, else the nearest free one) to the subject with
//       rov/squad.js S.inspect; its lamps then aim at the subject.
//    2. the key light (this file): a soft point light near the orbit eye,
//       with no shadow map, so the subject reads at once, before the ROV
//       is there and when no ROV can go. It fades in with the highlight
//       and fades out when the orbit ends (alpha of discoveries.js).
//  shaders.js WATER lightSurf adds KEY_GLSL keyRad (uniforms uKeyP: place
//  and range, uKeyC: colour x intensity x alpha). keyRadiance is the same
//  term in JS (tests/focus.test.mjs).
//
//    keyFrame(eye, p, r, alpha, fogK) -> { p [x, y, z], range, c [r, g, b] }
//        eye: the camera place, p: the subject centre (render space), r: its
//        radius, fogK: the water extinction [r, g, b] per m. The light is
//        KEY_UP of the eye distance above the eye, KEY_IN of the way to the
//        subject; its colour gives KEY_TARGET radiance at the subject.
//    keyRadiance(K, w, n) -> [r, g, b]  the key light on a surface (w, n)
//    spotRadiance(spot, w, fogK) -> [r, g, b]  shaders.js spotRad in JS
//
//  grep -n targets: "export function keyFrame", "export function keyRadiance",
//  "export const KEY_GLSL", "export function spotRadiance"
// ============================================================================

export const KEY_TARGET = 0.42;          // radiance at the subject (an ROV lamp at 5 m: about 0.6)
export const KEY_UP = 0.28, KEY_IN = 0.15, KEY_MAX = 6, KEY_ATT = 0.06, KEY_WRAP = 0.35;
export const KEY_COLOUR = [1, 0.96, 0.9];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export function keyFrame(eye, p, r = 1, alpha = 1, fogK = [0.07, 0.04, 0.03]) {
  const d0 = Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]) || 1;
  const q = [eye[0] + (p[0] - eye[0]) * KEY_IN, eye[1] + (p[1] - eye[1]) * KEY_IN + d0 * KEY_UP, eye[2] + (p[2] - eye[2]) * KEY_IN];
  const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  const a = clamp(alpha, 0, 1), c = [0, 0, 0];
  for (let k = 0; k < 3; k++) c[k] = Math.min(KEY_MAX, KEY_TARGET * (1 + KEY_ATT * d * d) * Math.exp(d * fogK[k])) * KEY_COLOUR[k] * a;
  return { p: q, range: d + 2 * r + 4, c, fogK };
}
// the GLSL term (needs uFogK of shaders.js WATER before it)
export const KEY_GLSL = /* glsl */`
uniform vec4 uKeyP, uKeyC;
vec3 keyRad(vec3 w, out vec3 L) {
  vec3 d = uKeyP.xyz - w;
  float dist = max(length(d), 0.05);
  L = d / dist;
  float att = smoothstep(uKeyP.w, uKeyP.w * 0.7, dist) / (1.0 + ${KEY_ATT.toFixed(3)} * dist * dist);
  return uKeyC.rgb * att * exp(-dist * uFogK);
}`;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export function keyRadiance(K, w, n) {
  const d = [K.p[0] - w[0], K.p[1] - w[1], K.p[2] - w[2]], dist = Math.max(Math.hypot(...d), 0.05);
  const L = d.map(v => v / dist), ndl = n[0] * L[0] + n[1] * L[1] + n[2] * L[2];
  const att = sstep(K.range, K.range * 0.7, dist) / (1 + KEY_ATT * dist * dist);
  const wrap = clamp((ndl + KEY_WRAP) / (1 + KEY_WRAP), 0, 1);
  return K.c.map((c, k) => c * att * Math.exp(-dist * K.fogK[k]) * wrap);
}
// spot: { p [x, y, z], range, dir (unit), cosOuter, cosInner, c [r, g, b] }
export function spotRadiance(S, w, fogK = [0.07, 0.04, 0.03]) {
  const d = [S.p[0] - w[0], S.p[1] - w[1], S.p[2] - w[2]], dist = Math.max(Math.hypot(...d), 0.05);
  const L = d.map(v => v / dist), ca = -(L[0] * S.dir[0] + L[1] * S.dir[1] + L[2] * S.dir[2]);
  let cone = sstep(S.cosOuter, S.cosInner, ca); cone *= 0.8 + 0.2 * sstep(S.cosInner, 1, ca);
  const att = cone / (1 + 0.06 * dist * dist) * sstep(S.range, S.range * 0.55, dist);
  return S.c.map((c, k) => c * att * Math.exp(-dist * fogK[k]));
}
