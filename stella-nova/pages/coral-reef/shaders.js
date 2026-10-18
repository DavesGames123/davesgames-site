// ============================================================================
//  CORAL REEF  ·  GLSL of the ROV dive (DOM-free strings, three.js r160)
// ----------------------------------------------------------------------------
//  three.js ShaderMaterial adds the version line, the precision, the
//  matrices (modelMatrix, viewMatrix, projectionMatrix, cameraPosition)
//  and position / normal / uv. The full-frame passes (VOL_*, COMP_*) and
//  the caustic pass are RawShaderMaterial: they declare all of it. The
//  tests wrap each program as Vulkan GLSL 450 and run naga on it
//  (glsl-check.mjs). No browser on this machine.
//
//  LIGHT. The water is dark. A surface gets:
//    downwell ... a faint blue light from above, less with depth, times
//                 the caustic factor on faces that look up
//    spots ...... up to 4 ROV spotlights (uSpotP / uSpotD / uSpotC): a
//                 soft cone, 1 / (1 + k d^2) fall-off and the water
//                 absorption on the path from the lamp (red goes first)
//    shadow ..... the main lamp of each ROV has a shadow map (three.js
//                 SpotLightShadow, RGBA depth packing; uShadow0 .. 3,
//                 uShadowM[i], uShadowOn[i]): 3 x 3 PCF taps. The coral
//                 and polyp depth passes (CORAL_DEPTH_VS, POLYP_DEPTH_VS,
//                 DEPTH_FS) move the vertices as the colour passes do
//  Then the path to the eye: absorption, and in-scatter to a near-black
//  blue fog. fadeAt() takes the plot to black between R and 1.3 R.
//
//  CAUSTICS. CAUSTIC_VS / CAUSTIC_FS fill a map over the plot with the
//  mesh-area method (water.js has the CPU copy). causticAt() warps the
//  look-up with fbm noise and scales the contrast by a large patch field,
//  so the net breaks up into patches that come and go. NOISE2 is the same
//  hash as water.js, so the tests measure what the screen shows.
//
//  VOLUME. VOL_FS marches each half-res pixel from the eye to the depth
//  of the frame: in-scatter from each spot cone (Henyey-Greenstein phase,
//  forward), with the shadow of each mapped lamp (one tap: light shafts
//  through gaps in the rock and the coral), a turbid density, and faint shafts of downwell light that
//  carry the caustic map down the water column. VOL_TAA_FS keeps a
//  history of it (reprojection, neighbourhood clip). COMP_FS adds the
//  volume to the frame with a joint bilateral upsample (volume.js has the
//  plan), tone-maps (ACES fit) and adds a vignette, a grain and a dither.
//
//  grep -n targets
//    noise ................. "export const NOISE"
//    2D noise (water.js) ... "export const NOISE2"
//    water and lights ...... "export const WATER"
//    surface light ......... "vec3 lightSurf"
//    caustic map ........... "export const CAUSTIC_VS"
//    shadow maps ........... "float shadowAt", "float shadowTap"
//    coral vertex .......... "const CORAL_POS"
//    coral surface ......... "export const CORAL_VS"
//    coral shadow depth .... "export const CORAL_DEPTH_VS", "export const DEPTH_FS"
//    polyp vertex .......... "const POLYP_POS"
//    polyps ................ "export const POLYP_VS"
//    polyp shadow depth .... "export const POLYP_DEPTH_VS"
//    rock .................. "export const ROCK_FS"
//    sand .................. "export const SAND_FS"
//    marine snow ........... "export const SNOW_VS" (lib/marine-snow.js + SNOW_LIGHT)
//    volume pass ........... "export const VOL_FS"
//    volume history ........ "export const VOL_TAA_FS"
//    composite ............. "export const COMP_FS"
//    luminance (exposure) .. "export const LUM_FS"
// ============================================================================
import { SURFACE_Y, FADE_K, N_WAVES } from './water.js';
import { ROCK_GLSL } from './rock/material.js';
import { marineSnowVS, MARINE_SNOW_FS } from '../../lib/marine-snow.js';

export { SURFACE_Y };
export const MAX_SPOTS = 4;
// One shadow map per spot at most (scene.js setLights gives one to the
// main lamp of each ROV). uShadowOn and uShadowTexel are vec4: 4 spots.
const SHADOW_IDS = Array.from({ length: MAX_SPOTS }, (_, i) => i);
const F1 = v => (Number.isInteger(v) ? v.toFixed(1) : String(v));

// 3D value noise, Worley, the brain groove and bump mapping (coral detail).
export const NOISE = /* glsl */`
float hashI(ivec3 c) {
  uint h = uint(c.x) * 374761393u + uint(c.y) * 668265263u + uint(c.z) * 2147483647u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return float(h ^ (h >> 16u)) / 4294967296.0;
}
float noise3(vec3 p) {
  vec3 fl = floor(p); ivec3 i = ivec3(fl); vec3 f = p - fl;
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hashI(i), b = hashI(i + ivec3(1, 0, 0)), c = hashI(i + ivec3(0, 1, 0)), d = hashI(i + ivec3(1, 1, 0));
  float e = hashI(i + ivec3(0, 0, 1)), g = hashI(i + ivec3(1, 0, 1)), h = hashI(i + ivec3(0, 1, 1)), k = hashI(i + ivec3(1, 1, 1));
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z);
}
vec3 hash33(vec3 p) {
  uvec3 q = uvec3(ivec3(floor(p))) * uvec3(1597334673u, 3812015801u, 2798796415u);
  q = (q.x ^ q.y ^ q.z) * uvec3(1597334673u, 3812015801u, 2798796415u);
  return vec3(q) / 4294967295.0;
}
vec2 worley(vec3 p) {
  vec3 i = floor(p), f = p - i;
  float d1 = 8.0, d2 = 8.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 o = vec3(float(x), float(y), float(z));
    vec3 r = o + hash33(i + o) - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return sqrt(vec2(d1, d2));
}
float groove(vec3 p) {
  float f = noise3(vec3(p.x * 0.16 + 3.1, p.y * 0.16, p.z * 0.16)) * 3.4 + noise3(vec3(p.x * 0.55, p.y * 0.55 + 5.0, p.z * 0.55)) * 0.35;
  float s = abs(sin(f * 6.2831853));
  float t = min(1.0, s / 0.42);
  return 1.0 - t * t * (3.0 - 2.0 * t);
}
vec3 bumpN(vec3 N, vec3 P, float h, float k) {
  vec3 dx = dFdx(P), dy = dFdy(P);
  float hx = dFdx(h), hy = dFdy(h);
  vec3 r1 = cross(dy, N), r2 = cross(N, dx);
  float det = dot(dx, r1);
  vec3 g = sign(det) * (hx * r1 + hy * r2);
  return normalize(abs(det) * N - g * k);
}`;

// The same hash, value noise and fbm as water.js (hash2, vnoise2, fbm2).
export const NOISE2 = /* glsl */`
float hash2(ivec2 c) {
  uint h = uint(c.x) * 374761393u + uint(c.y) * 668265263u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return float(h ^ (h >> 16u)) / 4294967296.0;
}
float vnoise2(vec2 p) {
  vec2 fl = floor(p); ivec2 i = ivec2(fl); vec2 f = p - fl;
  vec2 s = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash2(i), b = hash2(i + ivec2(1, 0)), c = hash2(i + ivec2(0, 1)), d = hash2(i + ivec2(1, 1));
  return a + (b - a) * s.x + (c - a) * s.y + (a - b - c + d) * s.x * s.y;
}
float fbm2(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int o = 0; o < 4; o++) {
    s += a * vnoise2(p);
    p = vec2(0.7986 * p.x - 0.6018 * p.y, 0.6018 * p.x + 0.7986 * p.y) * 2.03 + vec2(17.1, 3.7);
    a *= 0.5;
  }
  return s / 0.9375;
}`;

// Water, lights, caustics, shadow, fog. Needs NOISE2 before it.
export const WATER = /* glsl */`
uniform float uTime, uCaust, uR, uDown, uSpotN, uShadowBias, uCaustScale;
uniform vec4 uShadowOn, uShadowTexel;
uniform vec3 uFogK, uFogCol, uSunXZ;
uniform vec4 uCaustBox;
uniform vec2 uCur;
uniform vec4 uSpotP[${MAX_SPOTS}], uSpotD[${MAX_SPOTS}], uSpotC[${MAX_SPOTS}];
uniform mat4 uShadowM[${MAX_SPOTS}];
uniform mediump sampler2D uCaustTex;
uniform highp sampler2D ${SHADOW_IDS.map(i => 'uShadow' + i).join(', ')};
const float SURF_Y = ${F1(SURFACE_Y)};
// 1 inside the plot, 0 past ${FADE_K} R (water.js fadeAt).
float fadeAt(vec3 w) {
  float s = clamp((length(w.xz) - uR) / (${(FADE_K - 1).toFixed(2)} * uR), 0.0, 1.0);
  return 1.0 - s * s * (3.0 - 2.0 * s);
}
float causticMap(vec2 q) {
  vec2 uv = (q - uCaustBox.xy) / uCaustBox.z;
  return texture(uCaustTex, uv).r * uCaustScale;
}
// The caustic light factor (mean about 1): water.js causticPattern.
vec3 causticAt(vec3 w) {
  if (uCaust <= 0.0) return vec3(1.0);
  vec2 q = w.xz + uSunXZ.xy * (w.y - uSunXZ.z);
  float t = uTime;
  vec2 wp = (vec2(fbm2(q * 0.11 + vec2(t * 0.021, 0.0)), fbm2(q * 0.11 + vec2(31.7, -t * 0.017))) - 0.5) * 4.4;
  float pt = fbm2(q * 0.026 + vec2(t * 0.006, -t * 0.004 + 9.1));
  float s = clamp((pt - 0.32) / 0.4, 0.0, 1.0);
  float pch = 0.12 + 0.88 * s * s * (3.0 - 2.0 * s);
  vec2 qq = q + wp, dq = vec2(0.045, 0.028);
  vec3 e = min(log2(1.0 + vec3(causticMap(qq - dq), causticMap(qq), causticMap(qq + dq))), vec3(3.2));
  float deep = clamp(0.55 + w.y * 0.035, 0.35, 1.0);
  return 1.0 + (e - 1.0) * pch * uCaust * deep;
}
// The faint light from above: blue, less with depth; caustics on the faces that look up.
vec3 downwell(vec3 w, vec3 n) {
  float up = clamp(n.y, 0.0, 1.0);
  vec3 sky = vec3(0.10, 0.30, 0.52) * uDown * exp(-(SURF_Y - w.y) * 0.03);
  vec3 c = causticAt(w);
  return sky * (0.12 + 0.18 * (n.y * 0.5 + 0.5) + up * 0.9 * c * c);
}
float unpackD(vec4 v) { return dot(v, vec4(255.0 / 256.0) / vec4(16777216.0, 65536.0, 256.0, 1.0)); }
// The shadow of spot i (the main lamp of each ROV has a map): 1 lit, 0
// in shadow. uShadowOn[i] 1: the map is there. GLSL ES 3.00 indexes a
// sampler array only with a constant, so each map has its own sampler and
// its own PCF function (pcf0 .. pcf3, tap0 .. tap3).
bool shadowCoord(int i, vec3 w, vec3 n, out vec3 sc) {
  vec4 h = uShadowM[i] * vec4(w + n * 0.05, 1.0);
  sc = h.xyz / max(h.w, 1e-6);
  return h.w > 0.0 && sc.x >= 0.0 && sc.x <= 1.0 && sc.y >= 0.0 && sc.y <= 1.0 && sc.z <= 1.0;
}
${SHADOW_IDS.map(i => `float pcf${i}(vec3 sc, float tx) {
  float s = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) s += step(sc.z + uShadowBias, unpackD(textureLod(uShadow${i}, sc.xy + vec2(float(i), float(j)) * tx * 1.6, 0.0)));
  return s / 9.0;
}
float tap${i}(vec3 sc) { return step(sc.z + uShadowBias, unpackD(textureLod(uShadow${i}, sc.xy, 0.0))); }`).join('\n')}
// 3 x 3 PCF, for the surfaces
float shadowAt(int i, vec3 w, vec3 n) {
  if (i > ${MAX_SPOTS - 1} || uShadowOn[i] < 0.5) return 1.0;
  vec3 sc;
  if (!shadowCoord(i, w, n, sc)) return 1.0;
  float tx = uShadowTexel[i];
  ${SHADOW_IDS.slice(0, -1).map(i => `if (i == ${i}) return pcf${i}(sc, tx);`).join('\n  ')}
  return pcf${MAX_SPOTS - 1}(sc, tx);
}
// one tap, for the volume march (the jitter and the history smooth it)
float shadowTap(int i, vec3 w) {
  if (i > ${MAX_SPOTS - 1} || uShadowOn[i] < 0.5) return 1.0;
  vec3 sc;
  if (!shadowCoord(i, w, vec3(0.0), sc)) return 1.0;
  ${SHADOW_IDS.slice(0, -1).map(i => `if (i == ${i}) return tap${i}(sc);`).join('\n  ')}
  return tap${MAX_SPOTS - 1}(sc);
}
// The light of spot i at w: radiance (after the water on its path) and
// the unit vector to the lamp.
vec3 spotRad(int i, vec3 w, out vec3 L) {
  vec3 d = uSpotP[i].xyz - w;
  float dist = max(length(d), 0.05);
  L = d / dist;
  float ca = dot(-L, uSpotD[i].xyz);
  float cone = smoothstep(uSpotD[i].w, uSpotC[i].w, ca);
  cone *= 0.8 + 0.2 * smoothstep(uSpotC[i].w, 1.0, ca);     // a hot core
  float range = uSpotP[i].w;
  float att = cone / (1.0 + 0.06 * dist * dist) * smoothstep(range, range * 0.55, dist);
  return uSpotC[i].rgb * att * exp(-dist * uFogK);
}
// Light on a surface: base albedo, normal n, view V. wrap: diffuse wrap
// (0 hard, 0.5 soft), spec and rough: wet specular, trans: light through
// thin parts, ao: cavity.
vec3 lightSurf(vec3 base, vec3 w, vec3 n, vec3 V, float wrap, float spec, float rough, float trans, float ao) {
  vec3 col = base * downwell(w, n) * ao;
  float a2 = rough * rough * rough * rough;
  for (int i = 0; i < ${MAX_SPOTS}; i++) {
    if (float(i) >= uSpotN) break;
    vec3 L;
    vec3 R = spotRad(i, w, L);
    if (max(R.r, max(R.g, R.b)) < 1e-5) continue;
    R *= shadowAt(i, w, n);
    float ndl = dot(n, L);
    col += base * R * clamp((ndl + wrap) / (1.0 + wrap), 0.0, 1.0) * mix(1.0, ao, 0.5);
    vec3 H = normalize(L + V);
    float nh = max(dot(n, H), 0.0), dd = nh * nh * (a2 - 1.0) + 1.0;
    float D = a2 / (3.14159 * dd * dd);
    float F = 0.04 + 0.96 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
    col += R * spec * D * F * max(ndl, 0.0) * 0.25;
    col += base * base * R * trans * (pow(clamp(dot(V, -L), 0.0, 1.0), 3.0) * 1.4 + clamp(-ndl, 0.0, 1.0) * 0.35);
  }
  return col;
}
// The path from w to the eye: absorption and in-scatter.
vec3 fogCol(vec3 dir) { return uFogCol * (0.55 + 0.9 * clamp(dir.y * 0.5 + 0.5, 0.0, 1.0)); }
vec3 underwater(vec3 col, vec3 w) {
  vec3 d = w - cameraPosition;
  float dist = length(d);
  vec3 tr = exp(-dist * uFogK);
  return col * tr + fogCol(d / max(dist, 1e-3)) * (1.0 - tr);
}`;

// ── caustic map ─────────────────────────────────────────────────────────────
// A grid of rays over the map square and a margin. Each vertex refracts at
// the random wave surface (uWave: kx, kz, amp, phase) and falls uD. The
// fragment gets the cell area before (vOld) and after (vNew) the fall.
export const CAUSTIC_VS = /* glsl */`
precision highp float;
in vec2 aUv;
uniform vec4 uWave[${N_WAVES}];
uniform vec4 uBox;
uniform float uD, uT;
uniform vec3 uSunDir;
out vec2 vOld, vNew;
vec3 hg(vec2 p) {
  vec3 r = vec3(0.0);
  for (int i = 0; i < ${N_WAVES}; i++) {
    vec4 w = uWave[i];
    float a = dot(w.xy, p) - sqrt(9.81 * length(w.xy)) * uT + w.w;
    r.x += w.z * sin(a); r.yz += w.z * cos(a) * w.xy;
  }
  return r;
}
void main() {
  vec2 p = uBox.xy + (aUv * (1.0 + 2.0 * uBox.w) - uBox.w) * uBox.z;
  vec3 s = hg(p);
  vec3 N = normalize(vec3(-s.y, 1.0, -s.z));
  vec3 T = refract(uSunDir, N, 1.0 / 1.333), T0 = refract(uSunDir, vec3(0.0, 1.0, 0.0), 1.0 / 1.333);
  vec2 sh = T0.xz * (uD / -T0.y);
  vec2 Q = p + T.xz * ((uD + s.x) / -T.y) - sh;
  vOld = p; vNew = Q;
  gl_Position = vec4((Q - uBox.xy) / uBox.z * 2.0 - 1.0, 0.0, 1.0);
}`;
export const CAUSTIC_FS = /* glsl */`
precision highp float;
in vec2 vOld, vNew;
uniform float uGain;
out vec4 oCol;
float area(vec2 a, vec2 b) { return abs(a.x * b.y - a.y * b.x); }
void main() {
  float a0 = area(dFdx(vOld), dFdy(vOld)), a1 = area(dFdx(vNew), dFdy(vNew));
  float E = min(24.0, a0 / max(a1, 1e-9));
  oCol = vec4(vec3(E * uGain), 1.0);
}`;

// ── coral ───────────────────────────────────────────────────────────────────
//  uPartA (rgba) = natural r g b, colour t
//  uPartB (rgba) = birth s, radius (negative: a focus colony), sway level
//                  * 2 + tip, height over base
//  uPartC (rgba) = the parent of the particle minus the particle (m, xyz;
//                  0 for a root), base height of the colony (m)
//
//  SWAY. The user said (2026-10-18): "late evolution sea fans have wayt oo
//  much dispersion in their top layers, the 3d structure starts to stretch
//  and break down in the current". The old sway had a phase per particle
//  (gid), so two near particles moved apart and the mesh between them
//  stretched. coralSway is a smooth function of the vertex position and the
//  colony base height only: whole branches move together, a colony bends
//  as one, and two near points never move apart by more than about 0.12 x
//  their distance (tests/form.test.mjs, coralSwayJS is the CPU copy).
// the sway constants (coralSway in GLSL and coralSwayJS)
export const SWAY = { hMax: 6, kx: 0.05, kz: 0.035, w1: 1.05, b1: 0.45, a2: 0.35, w2: 2.3, b2: 0.7, amp: 0.02 };
export const PART = /* glsl */`
uniform float uTime, uSwayK;
uniform vec2 uCur;
uniform highp sampler2D uPartA, uPartB, uPartC;
uniform float uPartW;
ivec2 partCoord(float g) { float gg = max(g, 0.0); return ivec2(int(mod(gg, uPartW)), int(floor(gg / uPartW))); }
vec3 coralSway(vec3 p, float gy, float lvl) {
  if (lvl < 0.5) return vec3(0.0);
  float h = clamp(p.y - gy, 0.0, ${F1(SWAY.hMax)});
  float ph = dot(p.xz, vec2(${F1(SWAY.kx)}, ${F1(SWAY.kz)}));
  float wave = sin(uTime * ${F1(SWAY.w1)} + ph - h * ${F1(SWAY.b1)}) + ${F1(SWAY.a2)} * sin(uTime * ${F1(SWAY.w2)} + ph * 1.7 - h * ${F1(SWAY.b2)});
  vec2 d = normalize(uCur + vec2(0.0001));
  return vec3(d.x, 0.0, d.y) * wave * lvl * 0.25 * uSwayK * ${F1(SWAY.amp)} * pow(h, 1.5);
}`;

// The sway in JS (the same sums as coralSway in PART): the offset (m) of a
// point (x, y, z) of a colony with base height gy and sway level lvl
// (SPECIES sway x 4) at time t, current direction cur [x, z].
export function coralSwayJS(x, y, z, gy, lvl, t, cur = [1, 0], swayK = 1, out = [0, 0, 0]) {
  out[0] = out[1] = out[2] = 0;
  if (lvl < 0.5) return out;
  const h = Math.min(SWAY.hMax, Math.max(0, y - gy)), ph = x * SWAY.kx + z * SWAY.kz;
  const wave = Math.sin(t * SWAY.w1 + ph - h * SWAY.b1) + SWAY.a2 * Math.sin(t * SWAY.w2 + ph * 1.7 - h * SWAY.b2);
  const l = Math.hypot(cur[0] + 0.0001, cur[1] + 0.0001);
  const k = wave * lvl * 0.25 * swayK * SWAY.amp * Math.pow(h, 1.5);
  out[0] = (cur[0] + 0.0001) / l * k; out[2] = (cur[1] + 0.0001) / l * k;
  return out;
}

// The coral vertex in the world: the grow-in by age and the sway in the
// current. GROW-IN: the surface of a young particle slides out from its
// parent along the branch (position + C.xyz x (1 - g)), so a branch tip
// extends smoothly; it does not pop out along the normals (the user: "grows
// in a speckly-kind of way instead of an organic natural kind of way").
// False: the coarse mesh of a focus colony (B.y < 0) does not draw.
// CORAL_VS and the shadow depth pass (CORAL_DEPTH_VS) use the same
// function, so the shadow follows the surface that shows. ax: the branch
// direction (parent to particle, unit; 0 for a root).
const CORAL_POS = /* glsl */`
bool coralWorld(float gid, out vec4 w, out vec4 A, out vec4 B, out float age, out float tip, out vec3 ax) {
  ivec2 tc = partCoord(gid);
  A = texelFetch(uPartA, tc, 0); B = texelFetch(uPartB, tc, 0);
  vec4 C = texelFetch(uPartC, tc, 0);
  w = vec4(0.0); age = 0.0; tip = 0.0; ax = vec3(0.0);
  if (uCoarse > 0.5 && B.y < 0.0) return false;
  age = uTime - B.x;
  float g = clamp(age / 1.4, 0.0, 1.0); g = g * g * (3.0 - 2.0 * g);
  vec3 p = position + C.xyz * (1.0 - g);
  w = modelMatrix * vec4(p, 1.0);
  float lvl = floor(B.z * 0.5);
  tip = B.z - lvl * 2.0;
  w.xyz += coralSway(w.xyz, C.w, lvl);
  float l = length(C.xyz);
  ax = l > 1e-6 ? -C.xyz / l : vec3(0.0);
  return true;
}`;

export const CORAL_VS = /* glsl */`
${PART}
in float aGid;
uniform float uCount, uMode, uCoarse;
out vec3 vN, vW, vL, vNat, vAx;
out float vT, vGlow, vTip;
${CORAL_POS}
void main() {
  vec4 w, A, B;
  float age, tip;
  vec3 ax;
  if (!coralWorld(aGid, w, A, B, age, tip, ax)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vN = vec3(0.0, 1.0, 0.0); vW = vec3(0.0); vL = vec3(0.0); vNat = vec3(0.0); vAx = vec3(0.0); vT = 0.0; vGlow = 0.0; vTip = 0.0; return; }
  vAx = ax;
  vW = w.xyz; vL = position;
  vN = normalize(mat3(modelMatrix) * normal);
  vNat = pow(A.rgb, vec3(2.2));
  vT = (uMode > 0.5 && uMode < 1.5) ? max(aGid, 0.0) / max(1.0, uCount - 1.0) : A.a;
  vGlow = exp(-max(age, 0.0) / 1.6);
  vTip = tip;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// The shadow depth of the coral (scene.js customDepthMaterial): the same
// vertex as CORAL_VS, the depth packed to RGBA as three.js packDepthToRGBA
// (RGBADepthPacking), so WATER unpackD reads it.
export const CORAL_DEPTH_VS = /* glsl */`
${PART}
in float aGid;
uniform float uCoarse;
out vec2 vZW;
${CORAL_POS}
void main() {
  vec4 w, A, B;
  float age, tip;
  vec3 ax;
  if (!coralWorld(aGid, w, A, B, age, tip, ax)) { vZW = vec2(1.0); gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec4 c = projectionMatrix * viewMatrix * w;
  vZW = c.zw;
  gl_Position = c;
}`;
export const DEPTH_FS = /* glsl */`
in vec2 vZW;
out vec4 oCol;
vec4 packD(float v) {
  vec4 r = vec4(fract(v * vec3(16777216.0, 65536.0, 256.0)), v);
  r.yzw -= r.xyz * (1.0 / 256.0);
  return r * (256.0 / 255.0);
}
void main() { oCol = packD(clamp(0.5 * vZW.x / vZW.y + 0.5, 0.0, 1.0)); }`;

export const CORAL_FS = /* glsl */`
${NOISE2}
${WATER}
${NOISE}
uniform sampler2D uLut;
uniform float uMode, uBleach, uSpecies, uDetail, uDetailK;
in vec3 vN, vW, vL, vNat, vAx;
in float vT, vGlow, vTip;
out vec4 oCol;
// skin (uSpecies): coral-sdf.js SHAPES[id].skin; 0 staghorn, 1 fan,
// 2 table, 3 brain, 4 finger, 5 pores, 6 cells, 7 fleshy, 8 concentric,
// 9 soft, 10 glass lattice, 11 sponge, 12 bamboo nodes, 13 knobs, 14 spines
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 V = normalize(cameraPosition - vW);
  vec3 lutC = texture(uLut, vec2(clamp(vT, 0.0, 1.0) * 0.992 + 0.004, 0.5)).rgb;
  vec3 base = uMode < 0.5 ? vNat : lutC;
  float bl = uMode < 0.5 ? uBleach : uBleach * 0.35;
  base = mix(base, vec3(0.88, 0.88, 0.84), bl * 0.88);
  float h = 0.0, ao = 1.0, thin = 0.35, sheen = 0.0, kb = 0.22;
  float sp = uSpecies;
  int si = int(sp + 0.5);
  vec3 q = vL * uDetailK;
  // the branch direction and a direction across it on the surface
  vec3 ax = length(vAx) > 0.5 ? normalize(vAx) : vec3(1.0, 0.0, 0.0);
  vec3 across = cross(ax, n);
  across = length(across) > 1e-3 ? normalize(across) : vec3(0.0, 0.0, 1.0);
  // Fine detail by species. The user said: "the surface texture of
  // growing corals along the normals is too rough". The bumps are small and
  // shallow now (kb 0.2 to 0.3, was 0.55), with no random noise term: a
  // smooth skin with the species mark on it. The skin code is
  // coral-sdf.js SHAPES[id].skin (0 to 14).
  if (uDetail > 0.5) {
    if (si == 0 || si == 4) {
      // staghorn and finger: a smooth skin with small corallite cups
      vec2 c = worley(q * (sp < 0.5 ? 9.0 : 11.0));
      float cup = 1.0 - smoothstep(0.05, 0.15, c.x);
      float rim = smoothstep(0.11, 0.18, c.x) * (1.0 - smoothstep(0.2, 0.3, c.x));
      h = rim * 0.25 - cup * 0.45;
      ao = 1.0 - cup * 0.3;
      base *= 0.94 + 0.1 * rim;
      thin = sp < 0.5 ? 0.3 + 0.6 * vTip : 0.6; sheen = sp > 3.5 ? 0.35 : 0.0;
    } else if (si == 1) {
      // sea fan: thin blades with fine pores in rows along each blade
      vec2 c = worley(q * 10.0);
      float pore = 1.0 - smoothstep(0.06, 0.16, c.x);
      h = -pore * 0.35; ao = 1.0 - pore * 0.25; thin = 1.0; kb = 0.25;
    } else if (si == 2) {
      // table: a flat plate with fine ridges along the radial branches
      // (vAx, the branch direction) and small cups between them
      float ridge = smoothstep(0.1, 0.9, 0.5 + 0.5 * sin(dot(q, across) * 18.0 + noise3(q * 1.5) * 1.5));
      vec2 c = worley(q * 12.0);
      float cup = 1.0 - smoothstep(0.05, 0.13, c.x);
      h = ridge * 0.3 - cup * 0.3;
      ao = 0.92 + 0.08 * ridge - cup * 0.2;
      base *= 0.94 + 0.1 * ridge;
      thin = 0.35; kb = 0.3;
    } else if (si == 3) {
      // brain coral: meandering valleys and ridges
      float gv = groove(q);
      float sep = 0.5 + 0.5 * sin(dot(q, vec3(7.1, 5.3, 6.7)) + noise3(q * 0.9) * 6.0);
      h = -gv * 1.2 + (1.0 - gv) * sep * 0.15;
      ao = 1.0 - gv * 0.5;
      base = mix(base, base * vec3(0.72, 0.82, 0.62), gv * 0.6);
      thin = 0.25; kb = 0.9;
    } else if (si == 5) {
      // Porites, Montipora, Turbinaria: many fine pores (a texture)
      vec2 c = worley(q * 17.0);
      float pore = 1.0 - smoothstep(0.04, 0.12, c.x);
      h = -pore * 0.3; ao = 1.0 - pore * 0.2; base *= 0.95 + 0.06 * (1.0 - pore);
      thin = 0.3; kb = 0.2;
    } else if (si == 6) {
      // Favites, Desmophyllum, Madrepora: walled cups that share walls
      vec2 c = worley(q * 7.0);
      float wall = 1.0 - smoothstep(0.02, 0.1, c.y - c.x);
      float pit = 1.0 - smoothstep(0.05, 0.25, c.x);
      h = wall * 0.4 - pit * 0.3;
      ao = 0.82 + 0.18 * wall - pit * 0.1;
      base *= 0.88 + 0.16 * wall;
      thin = 0.3; kb = 0.28;
    } else if (si == 7) {
      // Lobophyllia: fleshy lobes with soft valleys
      vec2 c = worley(q * 3.0);
      float val = 1.0 - smoothstep(0.08, 0.3, c.y - c.x);
      h = -val * 0.5;
      ao = 1.0 - val * 0.35;
      base = mix(base, base * vec3(0.7, 0.78, 0.7), val * 0.5);
      thin = 0.5; sheen = 0.45; kb = 0.3;
    } else if (si == 8) {
      // Pachyseris: fine ridges across the radial direction (concentric)
      float ridge = smoothstep(0.2, 0.8, 0.5 + 0.5 * sin(dot(q, ax) * 24.0 + noise3(q * 1.2) * 1.2));
      h = ridge * 0.3;
      ao = 0.88 + 0.12 * ridge;
      base *= 0.92 + 0.12 * ridge;
      thin = 0.4; kb = 0.3;
    } else if (si == 9) {
      // soft corals, sea pens, sea lilies: a smooth, waxy skin with
      // shallow polyp dimples and a speckle of spicules in the colour
      vec2 c = worley(q * 9.0);
      float dimple = 1.0 - smoothstep(0.05, 0.16, c.x);
      h = -dimple * 0.2; ao = 1.0 - dimple * 0.15;
      base *= 0.95 + 0.08 * noise3(q * 20.0);
      thin = 0.7; sheen = 0.45; kb = 0.15;
    } else if (si == 10) {
      // glass sponge: a lattice of silica strands, square and diagonal
      float u = dot(q, across) * 7.0, v = dot(q, ax) * 7.0;
      vec2 g = abs(fract(vec2(u, v)) - 0.5), d = abs(fract(vec2(u + v, u - v) * 0.5) - 0.5);
      float line = max(1.0 - smoothstep(0.04, 0.1, min(g.x, g.y)), 0.6 * (1.0 - smoothstep(0.03, 0.08, min(d.x, d.y))));
      h = line * 0.3 - (1.0 - line) * 0.2;
      ao = 0.7 + 0.3 * line;
      base *= 0.82 + 0.25 * line;
      thin = 0.9; sheen = 0.3; kb = 0.3;
    } else if (si == 11) {
      // demosponge and glass vase: a rough skin with small oscules
      vec2 c = worley(q * 5.0);
      float osc = 1.0 - smoothstep(0.03, 0.12, c.x);
      float rib = 0.5 + 0.5 * sin(dot(q, ax) * 9.0 + noise3(q * 2.0) * 2.0);
      h = rib * 0.2 - osc * 0.5;
      ao = 1.0 - osc * 0.45;
      base *= 0.9 + 0.12 * rib;
      thin = 0.3; kb = 0.3;
    } else if (si == 12) {
      // bamboo coral: white chalk joints and dark protein nodes
      float node = smoothstep(0.86, 0.94, fract(dot(q, ax) * 2.5));
      base = mix(base, base * vec3(0.22, 0.17, 0.14), node);
      h = node * 0.2; ao = 1.0 - node * 0.2;
      thin = 0.5; kb = 0.2;
    } else if (si == 13) {
      // Paragorgia, Primnoa, Pocillopora: knobs and warts (verrucae)
      vec2 c = worley(q * 8.0);
      float knob = 1.0 - smoothstep(0.0, 0.3, c.x);
      h = knob * 0.4;
      ao = 0.85 + 0.15 * knob;
      base *= 0.92 + 0.12 * knob;
      thin = 0.45; kb = 0.3;
    } else if (si == 14) {
      // black coral: fine spines on the skeleton
      vec2 c = worley(q * 22.0);
      float spine = 1.0 - smoothstep(0.0, 0.08, c.x);
      h = spine * 0.5; ao = 1.0 - spine * 0.1;
      thin = 0.5; kb = 0.25;
    }
    n = bumpN(n, vW, h, kb);
  }
  // subsurface: wrap light and light through the thin parts, a soft sheen
  vec3 col = lightSurf(base, vW, n, V, 0.5, 0.12 + sheen * 0.2, 0.55, thin, ao);
  float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  col += rim * (0.004 + sheen * 0.006) * base;
  vec3 hot = uMode < 0.5 ? mix(vNat, vec3(1.0, 0.92, 0.78), 0.6) : texture(uLut, vec2(0.995, 0.5)).rgb;
  col += hot * vGlow * 0.08 * (1.0 - uBleach);
  col *= fadeAt(vW);
  oCol = linearToOutputTexel(vec4(underwater(col, vW), 1.0));
}`;

// ── polyps ──────────────────────────────────────────────────────────────────
// Template attribute aT: x angle, y s along the tentacle (0..1), z side
// (-1, 1; the cup ring radius), w kind (0 cup wall, 1 cup top, 2 tentacle).
// The polyp vertex in the world (POLYP_VS and POLYP_DEPTH_VS). False: the
// LOD keep (uKeep) drops this polyp.
const POLYP_POS = /* glsl */`
bool polypWorld(out vec4 w, out vec4 A, out float age, out vec3 nn, out vec3 t, out vec3 b, out vec2 d, out float e) {
  w = vec4(0.0); A = vec4(0.0); age = 0.0; nn = vec3(0.0, 1.0, 0.0); t = vec3(1.0, 0.0, 0.0); b = vec3(0.0, 0.0, 1.0); d = vec2(1.0, 0.0); e = 0.0;
  if (iData.y > uKeep) return false;
  ivec2 tc = partCoord(iData.x);
  A = texelFetch(uPartA, tc, 0);
  vec4 B = texelFetch(uPartB, tc, 0), C = texelFetch(uPartC, tc, 0);
  age = uTime - B.x;
  float grow = clamp((age - 0.6) / 1.5, 0.0, 1.0);
  float g = clamp(age / 1.4, 0.0, 1.0); g = g * g * (3.0 - 2.0 * g);
  nn = normalize(iNrm);
  t = normalize(cross(nn, abs(nn.y) < 0.92 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  b = cross(nn, t);
  float ph = iData.y * 71.0;
  float open = 0.5 + 0.5 * sin(uTime * 0.42 + ph) * 0.7 + 0.5 * sin(uTime * 0.17 + ph * 1.9) * 0.3;
  e = uExtend * (0.18 + 0.82 * smoothstep(0.2, 0.8, open)) * grow;
  vec3 lp;
  float a = aT.x;
  d = vec2(cos(a), sin(a));
  if (aT.w < 0.5) {
    lp = vec3(d.x * aT.z, aT.y * 0.5, d.y * aT.z);
  } else if (aT.w < 1.5) {
    lp = vec3(d.x * aT.z, 0.5 - (1.0 - aT.z) * 0.15, d.y * aT.z);
  } else {
    float s = aT.y, len = 2.2 * e;
    float rad = 0.62 + s * len * 0.85, up = 0.5 + s * len * 0.8 - s * s * len * 0.35;
    vec2 pd = vec2(-d.y, d.x);
    float wdt = 0.13 * (1.0 - 0.8 * s) * (0.5 + 0.5 * e);
    lp = vec3(d.x * rad + pd.x * aT.z * wdt, up, d.y * rad + pd.y * aT.z * wdt);
  }
  float size = uSize * (0.75 + 0.5 * fract(ph)) * (0.25 + 0.75 * grow);
  vec3 off = (t * lp.x + nn * lp.y + b * lp.z) * size;
  // the polyp rides on the surface: the same grow-in and sway as the coral
  // vertex under it (coralWorld), so it never floats off a moving branch
  vec3 base = (modelMatrix * vec4(iPos + C.xyz * (1.0 - g), 1.0)).xyz;
  base += coralSway(base, C.w, floor(B.z * 0.5));
  w = vec4(base + mat3(modelMatrix) * off, 1.0);
  float sw = aT.w > 1.5 ? aT.y * aT.y * e : 0.0;
  w.xz += (normalize(uCur + vec2(0.0001)) * (0.6 + 0.4 * sin(uTime * 1.3 + ph))) * sw * size * 0.9 * uSwayK;
  return true;
}`;
export const POLYP_VS = /* glsl */`
${PART}
in vec4 aT;
in vec3 iPos, iNrm;
in vec2 iData;
uniform float uSize, uKeep, uCount, uMode, uExtend;
out vec3 vW, vN, vNat;
out float vS, vT, vKind, vGlow;
${POLYP_POS}
void main() {
  vKind = aT.w; vS = aT.y;
  vec4 w, A;
  vec3 nn, t, b;
  vec2 d;
  float age, e;
  if (!polypWorld(w, A, age, nn, t, b, d, e)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * (aT.w > 1.5 ? normalize(t * d.x + b * d.y + nn * 0.6) : (aT.w > 0.5 ? nn : t * d.x + b * d.y)));
  vNat = pow(A.rgb, vec3(2.2));
  vT = (uMode > 0.5 && uMode < 1.5) ? iData.x / max(1.0, uCount - 1.0) : A.a;
  vGlow = exp(-max(age, 0.0) / 2.0);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
export const POLYP_DEPTH_VS = /* glsl */`
${PART}
in vec4 aT;
in vec3 iPos, iNrm;
in vec2 iData;
uniform float uSize, uKeep, uExtend;
out vec2 vZW;
${POLYP_POS}
void main() {
  vec4 w, A;
  vec3 nn, t, b;
  vec2 d;
  float age, e;
  if (!polypWorld(w, A, age, nn, t, b, d, e)) { vZW = vec2(1.0); gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec4 c = projectionMatrix * viewMatrix * w;
  vZW = c.zw;
  gl_Position = c;
}`;

export const POLYP_FS = /* glsl */`
${NOISE2}
${WATER}
uniform sampler2D uLut;
uniform float uMode, uBleach, uFluor;
uniform vec3 uTint;
in vec3 vW, vN, vNat;
in float vS, vT, vKind, vGlow;
out vec4 oCol;
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 lutC = texture(uLut, vec2(clamp(vT, 0.0, 1.0) * 0.992 + 0.004, 0.5)).rgb;
  vec3 base = uMode < 0.5 ? mix(vNat, uTint, 0.45) : lutC;
  base = mix(base, vec3(0.9), uBleach * 0.85);
  if (vKind > 1.5) base = mix(base, vec3(1.0, 0.98, 0.92), vS * 0.55);
  if (vKind > 0.5 && vKind < 1.5) base *= 0.55;
  vec3 V = normalize(cameraPosition - vW);
  vec3 col = lightSurf(base, vW, n, V, 0.6, 0.05, 0.6, 0.9, 1.0);
  // green fluorescence at the tips: a blue ROV lamp makes it glow
  col += vec3(0.25, 1.0, 0.55) * uFluor * vS * 0.012 * (1.0 - uBleach);
  col += base * vGlow * 0.05;
  col *= fadeAt(vW);
  oCol = linearToOutputTexel(vec4(underwater(col, vW), 1.0));
}`;

// Triplanar sample helpers, shared by the rock and the sand.
const TRI = /* glsl */`
vec3 triW(vec3 n) { vec3 w = pow(abs(n), vec3(4.0)); return w / (w.x + w.y + w.z); }
vec3 triTex(sampler2D t, vec3 p, vec3 n, float s) {
  vec3 w = triW(n);
  return texture(t, p.zy * s).rgb * w.x + texture(t, p.xz * s).rgb * w.y + texture(t, p.xy * s).rgb * w.z;
}
vec3 triNrm(sampler2D t, vec3 p, vec3 n, float s, float k) {
  vec3 w = triW(n);
  vec3 tx = texture(t, p.zy * s).xyz * 2.0 - 1.0, ty = texture(t, p.xz * s).xyz * 2.0 - 1.0, tz = texture(t, p.xy * s).xyz * 2.0 - 1.0;
  tx.xy *= k; ty.xy *= k; tz.xy *= k;
  vec3 nx = vec3(0.0, tx.y, tx.x) * sign(n.x), ny = vec3(ty.x, 0.0, ty.y) * sign(n.y), nz = vec3(tz.x, tz.y, 0.0) * sign(n.z);
  return normalize(n + nx * w.x + ny * w.y + nz * w.z);
}`;

export const SURF_VS = /* glsl */`
out vec3 vW, vN;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// ── rock ────────────────────────────────────────────────────────────────────
// The ROCK material (rock/material.js ROCK_GLSL): triplanar CC0 stone with
// the strata bed tints, coralline crust on open tops and the cavity term
// of the mesh. Here: a second noise scale to break the tiling, turf algae,
// the ORM roughness as a wet specular, the plot fade.
export const ROCK_VS = /* glsl */`
in float cavity, band;
out vec3 vW, vN;
out float vCav, vBand;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
  vCav = cavity; vBand = band;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
export const ROCK_FS = /* glsl */`
${NOISE2}
${WATER}
${NOISE}
${ROCK_GLSL}
uniform sampler2D uAlb, uNrm, uOrm;
uniform float uTex, uTexS;
in vec3 vW, vN;
in float vCav, vBand;
out vec4 oCol;
void main() {
  vec3 n0 = normalize(vN), n = n0, tw = rockTriW(n0);
  vec3 base = vec3(0.36, 0.33, 0.29) * rockBedTint(vBand) * (1.0 - 0.72 * vCav);
  float occ = 1.0, rough = 0.9;
  if (uTex > 0.5) {
    base = rockAlbedo(uAlb, vW, n0, uTexS, vCav, vBand);
    n = rockTriNormal(uNrm, vW, n0, tw, uTexS);
    vec3 orm = rockTri(uOrm, vW, tw, uTexS).rgb;
    occ = orm.r; rough = orm.g;
  }
  base *= 0.82 + 0.36 * noise3(vW * 0.21 + 3.0);
  float up = smoothstep(0.5, 0.92, n0.y) * (1.0 - vCav);
  base = mix(base, vec3(0.16, 0.21, 0.10), up * smoothstep(0.45, 0.8, noise3(vW * 0.9)) * 0.55);
  vec3 V = normalize(cameraPosition - vW);
  vec3 col = lightSurf(base, vW, n, V, 0.08, 0.5, clamp(rough * 0.75, 0.2, 0.9), 0.0, occ * (1.0 - 0.5 * vCav));
  col *= fadeAt(vW);
  oCol = linearToOutputTexel(vec4(underwater(col, vW), 1.0));
}`;

// ── sand ────────────────────────────────────────────────────────────────────
export const SAND_FS = /* glsl */`
${NOISE2}
${WATER}
${NOISE}
${TRI}
uniform sampler2D uSand, uSandN;
uniform float uTex;
in vec3 vW, vN;
out vec4 oCol;
void main() {
  vec3 n = normalize(vN);
  vec3 base = vec3(0.56, 0.52, 0.44);
  if (uTex > 0.5) { base = triTex(uSand, vW, n, 0.5) * 0.95; n = triNrm(uSandN, vW, n, 0.5, 0.8); }
  // ripples across the current, and dark detritus
  float rp = sin(dot(vW.xz, vec2(3.1, 1.3)) + fbm2(vW.xz * 0.3) * 6.0);
  n = normalize(n + vec3(0.06 * rp, 0.0, 0.03 * rp));
  base *= 0.9 + 0.2 * fbm2(vW.xz * 0.7) - 0.25 * smoothstep(0.7, 0.9, vnoise2(vW.xz * 2.3));
  vec3 V = normalize(cameraPosition - vW);
  vec3 col = lightSurf(base, vW, n, V, 0.1, 0.08, 0.8, 0.0, 1.0);
  col *= fadeAt(vW);
  oCol = linearToOutputTexel(vec4(underwater(col, vW), 1.0));
}`;

// ── marine snow ─────────────────────────────────────────────────────────────
// lib/marine-snow.js: aggregates (motes, flocs, mucus strings and diatom
// chains, pellets) from a procedural atlas, world-locked in a box round the
// eye, a thin-lens bokeh disc near the eye, a motion streak. The light of
// this page: each ROV spot (spotRad, one shadow tap) and the light from
// above, through the two-lobe phase msPhase (forward bright: a flake shows
// most when you look toward the lamp).
export const SNOW_LIGHT = /* glsl */`
vec3 msLight(vec3 p, vec3 V) {
  vec3 c = vec3(0.0);
  for (int i = 0; i < ${MAX_SPOTS}; i++) {
    if (float(i) >= uSpotN) break;
    vec3 L;
    vec3 R = spotRad(i, p, L);
    if (max(R.r, max(R.g, R.b)) < 1e-6) continue;
    c += R * (shadowTap(i, p) * msPhase(dot(-L, V)));
  }
  // the light from above goes down: forward scatter when the eye looks up
  vec3 sky = vec3(0.10, 0.30, 0.52) * uDown * exp(-(SURF_Y - p.y) * 0.03);
  c += sky * (msPhase(-V.y) * 0.6);
  return c;
}
`;
export const SNOW_VS = marineSnowVS(SNOW_LIGHT, NOISE2 + WATER);
export const SNOW_FS = MARINE_SNOW_FS;

// ── full-frame passes (RawShaderMaterial, GLSL3) ────────────────────────────
export const FULL_VS = /* glsl */`
precision highp float;
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// The volume: in-scatter along the eye ray, up to the depth of the frame.
// volume.js has the plan (march, history, bilateral upsample). The ray
// start has a 64 x 64 blue-noise jitter (uBlue, volume.js blueNoise) that
// moves by the golden ratio each frame; the history pass averages it. The
// shadow tap of each step moves up to 1.2 map texels round the ray (a
// second blue-noise value), so the history gives soft shaft edges, not
// the steps of the map texels. a = the linear view depth (m).
export const VOL_FS = /* glsl */`
precision highp float;
precision highp int;
uniform vec3 uEye;
#define cameraPosition uEye
${NOISE2}
${WATER}
${NOISE}
in vec2 vUv;
out vec4 oCol;
uniform highp sampler2D uDepth;
uniform mediump sampler2D uBlue;
uniform mat4 uProjInv, uCamW;
uniform float uSteps, uVolMax, uScatter, uShaft, uFrame, uNearLamp;
void main() {
  float z = texture(uDepth, vUv).r;
  vec4 vp = uProjInv * vec4(vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
  vp /= vp.w;
  vec3 wp = (uCamW * vec4(vp.xyz, 1.0)).xyz;
  vec3 rd = wp - cameraPosition;
  float tMax = min(length(rd), uVolMax);
  rd = normalize(rd);
  ivec2 bq = ivec2(gl_FragCoord.xy) & ivec2(63);
  float g1 = 0.61803399 * uFrame;
  float j = fract(texelFetch(uBlue, bq, 0).r + g1);
  float j2 = fract(texelFetch(uBlue, (bq + ivec2(32, 17)) & ivec2(63), 0).r + g1 * 1.3247);
  vec3 acc = vec3(0.0);
  float dt = tMax / uSteps;
  for (int k = 0; k < 64; k++) {
    if (float(k) >= uSteps) break;
    float t = (float(k) + j) * dt;
    vec3 p = cameraPosition + rd * t;
    float dens = 0.55 + 0.9 * noise3(p * 0.45 + vec3(uTime * 0.05, -uTime * 0.03, 0.0)) * noise3(p * 1.3 - vec3(0.0, uTime * 0.04, 0.0));
    vec3 s = vec3(0.0);
    for (int i = 0; i < ${MAX_SPOTS}; i++) {
      if (float(i) >= uSpotN) break;
      vec3 L;
      vec3 R = spotRad(i, p, L);
      if (max(R.r, max(R.g, R.b)) < 1e-6) continue;
      // the jittered shadow tap: a disc round p, square to L, of 1.2 texels
      float dl = length(uSpotP[i].xyz - p);
      vec3 ax = normalize(cross(L, abs(L.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))), ay = cross(L, ax);
      float an = 6.2831853 * fract(j2 + float(k) * 0.7548777), rr = sqrt(fract(j + float(k) * 0.5698403));
      vec3 pj = p + (ax * cos(an) + ay * sin(an)) * rr * dl * uShadowTexel[i] * 1.2;
      R *= shadowTap(i, pj);
      // less in-scatter in the first uNearLamp metres: no hot ball at the lamp
      R *= smoothstep(0.0, uNearLamp, dl);
      float c = dot(-L, -rd);                 // light goes from the lamp past p; c = 1 straight at the eye
      float g = 0.55, hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * c, 1.5);
      s += R * (0.08 + hg * 0.25);
    }
    // shafts of downwell light that carry the caustic net down the water
    vec3 cs = causticAt(p);
    s += vec3(0.10, 0.30, 0.52) * uDown * uShaft * exp(-(SURF_Y - p.y) * 0.03) * max(cs.g - 1.1, 0.0) * 0.004;
    acc += s * dens * exp(-t * uFogK) * dt;
  }
  oCol = vec4(acc * uScatter, -vp.z);
}`;

// The history of the volume (volume.js step 2): reproject with the view-
// projection of the last frame, clip to the neighbourhood, blend.
export const VOL_TAA_FS = /* glsl */`
precision highp float;
in vec2 vUv;
out vec4 oCol;
uniform highp sampler2D uCur, uHist;
uniform mat4 uProjInv, uCamW, uPrevVP;
uniform vec2 uTexel;
uniform float uBlend, uReset, uClip, uReject;
bool bad4(vec4 c) { return any(isnan(c)) || any(isinf(c)); }
void main() {
  vec4 c = texture(uCur, vUv);
  vec3 m1 = vec3(0.0), m2 = vec3(0.0), mn = vec3(1e9), mx = vec3(-1e9);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec3 s = texture(uCur, vUv + vec2(float(i), float(j)) * uTexel).rgb;
    m1 += s; m2 += s * s; mn = min(mn, s); mx = max(mx, s);
  }
  m1 /= 9.0; m2 /= 9.0;
  vec3 sd = sqrt(max(m2 - m1 * m1, vec3(0.0)));
  vec3 lo = max(mn, m1 - uClip * sd), hi = min(mx, m1 + uClip * sd);
  // this pixel in the world, from its view depth (c.a)
  vec4 vr = uProjInv * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vr.xyz /= vr.w;
  vec3 pv = vr.xyz * (c.a / max(-vr.z, 1e-6));
  vec3 pw = (uCamW * vec4(pv, 1.0)).xyz;
  vec4 pc = uPrevVP * vec4(pw, 1.0);
  vec2 puv = pc.xy / max(pc.w, 1e-6) * 0.5 + 0.5;
  vec4 h = texture(uHist, puv);
  bool inside = pc.w > 0.0 && puv.x >= 0.0 && puv.x <= 1.0 && puv.y >= 0.0 && puv.y <= 1.0;
  bool agree = abs(h.a - pc.w) <= uReject * max(pc.w, 0.1);
  float a = (inside && agree && uReset < 0.5 && !bad4(h)) ? uBlend : 1.0;
  vec3 hc = clamp(h.rgb, lo, hi);
  vec3 o = mix(hc, c.rgb, a);
  oCol = vec4(bad4(vec4(o, 0.0)) ? c.rgb : o, c.a);
}`;

// The frame: the scene, the volume (a joint bilateral upsample with the
// full-res depth, volume.js step 3), ACES tone map, vignette, grain and a
// dither of 1 / 255 before the 8-bit canvas.
export const COMP_FS = /* glsl */`
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 oCol;
uniform sampler2D uScene;
uniform highp sampler2D uVol, uDepth;
uniform vec2 uVolTexel, uNearFar;
uniform float uExposure, uGrain, uTime, uVig, uDebugNaN, uSigRel, uSigAbs;
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
bool bad3(vec3 c) { return any(isnan(c)) || any(isinf(c)); }
float linZ(float z) { return uNearFar.x * uNearFar.y / (uNearFar.y - z * (uNearFar.y - uNearFar.x)); }
vec3 volUp() {
  float zf = linZ(texture(uDepth, vUv).r);
  vec2 sz = 1.0 / uVolTexel;
  vec2 st = vUv * sz - 0.5, i0 = floor(st), f = st - i0;
  ivec2 b = ivec2(i0), top = ivec2(sz) - 1;
  float sig = uSigRel * zf + uSigAbs;
  vec3 acc = vec3(0.0), nc = vec3(0.0);
  float ws = 0.0, nd = 1e9;
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    vec4 s = texelFetch(uVol, clamp(b + ivec2(i, j), ivec2(0), top), 0);
    float bw = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
    float r = (s.a - zf) / sig;
    float w = bw * exp(-r * r);
    acc += s.rgb * w; ws += w;
    float d = abs(s.a - zf);
    if (d < nd) { nd = d; nc = s.rgb; }
  }
  return ws > 1e-4 ? acc / ws : nc;
}
void main() {
  vec3 c = texture(uScene, vUv).rgb + volUp();
  // NaN guard: a NaN or an Inf (a half float overflow) gives magenta with
  // uDebugNaN (the ?debug URL), else black; the rest clamps to 0 .. 64
  if (bad3(c)) { oCol = uDebugNaN > 0.5 ? vec4(1.0, 0.0, 1.0, 1.0) : vec4(0.0, 0.0, 0.0, 1.0); return; }
  c = clamp(c, 0.0, 64.0);
  c = aces(c * uExposure);
  vec2 d = vUv - 0.5;
  c *= 1.0 - uVig * dot(d, d) * 1.6;
  c = toSRGB(c);
  vec2 gp = gl_FragCoord.xy + fract(uTime * 7.3) * 113.0;
  c += (h12(gp) - 0.5) * uGrain;
  // triangular dither of 1 LSB: no bands in the dark gradients of the cones
  c += (h12(gp + 17.31) + h12(gp + 41.7) - 1.0) / 255.0;
  oCol = vec4(c, 1.0);
}`;

// The luminance of the frame for the auto exposure: a small RGBA8 target,
// r = (log2 L + 16) / 20 (L of 2^-16 .. 2^4), 4 taps per texel.
export const LUM_FS = /* glsl */`
precision highp float;
in vec2 vUv;
out vec4 oCol;
uniform sampler2D uScene, uVol;
uniform vec2 uTap;
float lum(vec2 uv) {
  vec3 c = texture(uScene, uv).rgb + texture(uVol, uv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return (l >= 0.0 && l < 1e4) ? l : 0.0;
}
void main() {
  float l = 0.25 * (lum(vUv + uTap * vec2(-1.0, -1.0)) + lum(vUv + uTap * vec2(1.0, -1.0)) + lum(vUv + uTap * vec2(-1.0, 1.0)) + lum(vUv + uTap * vec2(1.0, 1.0)));
  float e = clamp((log2(max(l, 1.5e-5)) + 16.0) / 20.0, 0.0, 1.0);
  oCol = vec4(e, 0.0, 0.0, 1.0);
}`;
