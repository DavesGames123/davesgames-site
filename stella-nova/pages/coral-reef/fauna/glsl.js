// ============================================================================
//  CORAL REEF  ·  fauna/glsl.js  ·  the creature shaders (GLSL ES 3.00)
// ----------------------------------------------------------------------------
//  three.js ShaderMaterial with glslVersion GLSL3 on an InstancedMesh. The
//  fragment shaders use the water light of shaders.js WATER (the ROV lamps
//  with their shadow maps, the downwelling light with caustics, the fog),
//  so a creature is lit and fogged like the rock and the coral.
//
//  ATTRIBUTES
//    position, normal (three), uv (scans), aCol (vec3, linear albedo),
//    aAnim (vec4: s, w, ph, f; fauna/gen/mesh.js), aGlow (vec3 emissive),
//    aPho (vec4: the photophore map a, b, kind, wave; gen/mesh.js)
//    instanceMatrix (three), iAnim (vec4: phase, rate, amp, kind),
//    iTint (vec4: albedo factor rgb, unused), iGlow (vec4: steady, counter,
//    flash, wave phase; fauna/glow.js)
//  BIOLUMINESCENCE. The light comes from the body: aGlow (colour and the
//  area that can glow) times phoMask (round dots in the cells of the map,
//  or a solid organ), times the levels of iGlow: steady + counter x the
//  ventral share (world normal down) + flash x a wave that runs along the
//  wave coordinate. The bloom pass of scene.js spreads the bright dots.
//  KINDS (species.js ANIM): 0 still (sway with height), 1 fish, 2 eel,
//    3 flap (rays, turtles, chimaera fins), 4 bell (medusae), 5 cephalopod,
//    6 walk (legs), 7 arms (sea stars, brittle stars), 8 drift
//    (siphonophores, comb jellies), 9 crawl (worms, sea cucumbers)
//
//  PROGRAMS
//    FAUNA_VS + FAUNA_FS ... opaque animals (uMap: the scan texture)
//    FAUNA_VS + GEL_FS ..... see-through animals (jellies, comb jellies,
//                            siphonophores, Enypniastes, the snailfish): a
//                            bright rim, the comb rows diffract the lamps
//                            into a rainbow (comb rows have f = 2)
//    HALO_VS + HALO_FS ..... the far glow sprite: a small camera-facing quad,
//                            added, only for a glowing animal with no mesh
//                            drawn (lod 2); the bloom pass spreads its core
//
//  grep -n targets: "vec3 swim(", "float phoMask(", "export const FAUNA_VS", "export const FAUNA_FS",
//  "export const GEL_FS", "export const HALO_VS"
// ============================================================================
import { WATER, NOISE2 } from '../shaders.js';

// the photophore mask of fauna/gen/mesh.js (PHOTOPHORE MAP); P = aPho
const PHO = /* glsl */`
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float phoMask(vec4 P) {
  if (P.z < 0.5) return 1.0;
  float rows = floor(P.z + 1e-3), sparse = clamp(P.z - rows, 0.0, 0.95);
  // round dots: the radius is 0.3 of the smaller cell side on the screen
  vec2 ga = vec2(length(vec2(dFdx(P.x), dFdy(P.x))), length(vec2(dFdx(P.y), dFdy(P.y))));
  vec2 rad = max(0.3 * ga / max(max(ga.x, ga.y), 1e-6), vec2(0.02));
  vec2 cell = floor(P.xy), f = fract(P.xy) - 0.5;
  float on = (cell.y >= 0.0 && cell.y < rows && h21(cell) >= sparse) ? 1.0 : 0.0;
  float d = length(f / rad), px = max(length(ga / rad), 1e-4);
  float m = on * (1.0 - smoothstep(1.0 - px, 1.0 + px, d));
  // dots under a pixel: the mean cover of the cells (no shimmer, the same light)
  float far = clamp(max(ga.x, ga.y) * 2.0 - 0.5, 0.0, 1.0);
  float rowOn = (P.y >= 0.0 && P.y < rows) ? 1.0 : 0.0;
  return mix(m, (1.0 - sparse) * 3.14159 * rad.x * rad.y * rowOn, far);
}
// the level of the photophores: steady, counter on the belly, flash wave
float phoLevel(vec4 G, vec4 P, float ny) {
  float ventral = smoothstep(0.15, 0.75, -ny);
  float wv = pow(0.5 + 0.5 * cos(6.2831853 * (P.w - G.w)), 8.0);
  return G.x + G.y * ventral + G.z * (0.3 + 0.7 * wv);
}`;

const MOTION = /* glsl */`
const float TAU = 6.2831853;
// the vertex motion in model space (length 1); t: the phase in cycles
vec3 swim(vec3 p, vec4 A, vec4 I) {
  float s = A.x, w = A.y, ph = A.z, f = A.w;
  float t = uTime * I.y + I.x, amp = I.z;
  int kind = int(I.w + 0.5);
  if (kind == 1) {
    float env = 0.12 + 0.88 * s * s;
    p.x += amp * 0.11 * env * sin(TAU * (s * 0.9 - t));
    p.x += w * 0.015 * amp * sin(TAU * (t * 2.3 + ph));
    p.y += w * step(0.2, abs(p.x)) * 0.02 * amp * sin(TAU * (t * 1.7 + ph));
  } else if (kind == 2) {
    p.x += amp * 0.07 * (0.25 + 0.75 * s) * sin(TAU * (s * 1.7 - t));
  } else if (kind == 3) {
    p.y += amp * 0.2 * w * w * sin(TAU * (t - s * 0.5) + ph * TAU);
    p.x += amp * 0.03 * s * s * sin(TAU * (s - t));
  } else if (kind == 4) {
    float pulse = pow(0.5 + 0.5 * sin(TAU * t), 3.0);
    float k = s < 0.01 ? w : 1.0;
    p.xz *= 1.0 - amp * 0.16 * k * pulse;
    p.y += amp * 0.05 * pulse * (1.0 - s);
    p.xz += vec2(sin(TAU * (t * 0.5 - s * 0.7) + ph * TAU), cos(TAU * (t * 0.43 - s * 0.6) + ph * TAU)) * 0.06 * s * amp;
  } else if (kind == 5) {
    float pulse = sin(TAU * t * 0.8);
    p *= 1.0 + (1.0 - min(w, 1.0)) * 0.025 * amp * pulse;
    p.y += amp * 0.07 * f * sin(TAU * (t - f * 0.8) + ph * TAU) * w;
    p.xz *= 1.0 + amp * 0.12 * f * w * sin(TAU * t * 0.5 + ph * TAU * 0.25);
  } else if (kind == 6) {
    float st = sin(TAU * (t + ph));
    p.y += amp * 0.045 * w * max(0.0, st);
    p.z += amp * 0.03 * w * cos(TAU * (t + ph));
    p.y += amp * 0.006 * sin(TAU * t * 2.0);
  } else if (kind == 7) {
    p.y += amp * 0.05 * f * f * sin(TAU * (t * 0.3 + ph));
    vec2 side = normalize(vec2(-p.z, p.x) + 1e-5);
    p.xz += side * amp * 0.035 * f * sin(TAU * (t * 0.45 + ph) - f * 3.0);
  } else if (kind == 8) {
    p.x += amp * 0.05 * sin(TAU * (t * 0.3 - s * 1.5));
    p.y += amp * 0.03 * cos(TAU * (t * 0.25 - s));
  } else if (kind == 9) {
    float b = sin(TAU * (s * 2.0 - t));
    p.xy *= 1.0 + amp * 0.07 * b;
    p.x += amp * 0.02 * sin(TAU * (s * 1.2 - t * 0.5));
  } else {
    p.x += amp * 0.02 * s * sin(TAU * t * 0.2 + ph * TAU);
    p.z += amp * 0.015 * s * cos(TAU * t * 0.17 + ph * TAU);
  }
  return p;
}`;

export const FAUNA_VS = /* glsl */`
uniform float uTime;
in vec3 aCol;
in vec4 aAnim;
in vec3 aGlow;
in vec4 aPho;
in vec4 iAnim;
in vec4 iTint;
in vec4 iGlow;
out vec3 vW, vN, vCol, vGlow;
out vec4 vPho, vGA;
out vec2 vUv;
out float vComb, vS;
${MOTION}
void main() {
  vec3 p = swim(position, aAnim, iAnim);
  mat4 m = modelMatrix * instanceMatrix;
  vec4 w = m * vec4(p, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(m) * normal);
  vCol = aCol * iTint.rgb;
  vGlow = aGlow;
  vPho = aPho;
  vGA = iGlow;
  vUv = uv;
  vComb = step(1.5, aAnim.w) * aAnim.z;
  vS = aAnim.x;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const FAUNA_FS = /* glsl */`
${NOISE2}
${WATER}
uniform sampler2D uMap;
uniform float uUseMap, uGlowK;
in vec3 vW, vN, vCol, vGlow;
in vec4 vPho, vGA;
in vec2 vUv;
in float vComb, vS;
out vec4 oCol;
${PHO}
void main() {
  vec3 n = normalize(vN);
  float ny = n.y;
  vec3 V = normalize(cameraPosition - vW);
  if (!gl_FrontFacing) n = -n;
  vec3 base = vCol;
  if (uUseMap > 0.5) base *= texture(uMap, vUv).rgb;
  // wet skin: a soft wrap, a glossy lobe, a little light through thin parts
  vec3 col = lightSurf(base, vW, n, V, 0.3, 0.55, 0.42, 0.25, 1.0);
  // the photophores: emissive dots on the body (the bloom pass spreads them)
  col += vGlow * uGlowK * phoMask(vPho) * phoLevel(vGA, vPho, ny);
  oCol = linearToOutputTexel(vec4(underwater(col, vW), 1.0));
}`;

export const GEL_FS = /* glsl */`
${NOISE2}
${WATER}
uniform float uGlowK;
in vec3 vW, vN, vCol, vGlow;
in vec4 vPho, vGA;
in vec2 vUv;
in float vComb, vS;
out vec4 oCol;
${PHO}
vec3 rainbow(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
void main() {
  vec3 n = normalize(vN);
  float ny = n.y;
  vec3 V = normalize(cameraPosition - vW);
  if (!gl_FrontFacing) n = -n;
  float fres = pow(1.0 - abs(dot(n, V)), 2.0);
  vec3 lit = lightSurf(vCol, vW, n, V, 0.8, 0.9, 0.25, 0.9, 1.0);
  vec3 col = lit * (0.35 + 1.4 * fres);
  // comb rows: the beating cilia diffract the lamp light into a moving rainbow
  if (vComb > 0.0) {
    vec3 white = lightSurf(vec3(1.0), vW, n, V, 0.8, 0.0, 0.5, 0.0, 1.0);
    col += white * rainbow(fract(vComb + vS * 2.0 - uTime * 0.9)) * 1.6;
  }
  // the photophores (Atolla's ring, Periphylla's spots, Nanomia's lures);
  // the comb rows above are reflected lamp light, not glow
  vec3 glow = vGlow * uGlowK * phoMask(vPho) * phoLevel(vGA, vPho, ny);
  col += glow;
  float a = clamp(0.14 + 0.75 * fres + dot(glow, vec3(0.3)) + (vComb > 0.0 ? 0.4 : 0.0), 0.0, 0.92);
  vec3 d = vW - cameraPosition;
  vec3 tr = exp(-length(d) * uFogK);
  oCol = linearToOutputTexel(vec4(col * tr, a * (tr.g * 0.7 + 0.3)));
}`;

// the glow halo: iHalo (vec4: xyz render-space centre, radius), iHaloC (rgb, intensity)
export const HALO_VS = /* glsl */`
uniform float uTime;
in vec4 iHalo;
in vec4 iHaloC;
out vec2 vQ;
out vec3 vC;
out float vI, vD;
void main() {
  vec3 c = iHalo.xyz;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 w = c + (right * position.x + up * position.y) * iHalo.w;
  vQ = position.xy;
  vC = iHaloC.rgb;
  vI = iHaloC.a;
  vD = length(c - cameraPosition);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
export const HALO_FS = /* glsl */`
uniform vec3 uFogK;
in vec2 vQ;
in vec3 vC;
in float vI, vD;
out vec4 oCol;
void main() {
  float r2 = dot(vQ, vQ);
  if (r2 > 1.0) discard;
  float g = exp(-r2 * 9.0);
  vec3 tr = exp(-vD * uFogK * 0.8);
  oCol = linearToOutputTexel(vec4(vC * vI * g * tr, 1.0));
}`;
