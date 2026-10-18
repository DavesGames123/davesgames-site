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
//    shadow ..... the lead lamp (spot 0) has a shadow map (three.js
//                 SpotLightShadow, RGBA depth packing): 3 x 3 PCF taps
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
//  forward), with the lead shadow (light shafts through gaps in the
//  rock), a turbid density, and faint shafts of downwell light that
//  carry the caustic map down the water column. COMP_FS adds the volume
//  to the frame (a 3 x 3 tent), tone-maps (ACES fit) and adds a vignette
//  and a fine grain.
//
//  grep -n targets
//    noise ................. "export const NOISE"
//    2D noise (water.js) ... "export const NOISE2"
//    water and lights ...... "export const WATER"
//    surface light ......... "vec3 lightSurf"
//    caustic map ........... "export const CAUSTIC_VS"
//    coral surface ......... "export const CORAL_VS"
//    polyps ................ "export const POLYP_VS"
//    rock .................. "export const ROCK_FS"
//    sand .................. "export const SAND_FS"
//    marine snow ........... "export const SNOW_VS"
//    volume pass ........... "export const VOL_FS"
//    composite ............. "export const COMP_FS"
// ============================================================================
import { SURFACE_Y, FADE_K, N_WAVES } from './water.js';
import { ROCK_GLSL } from './rock/material.js';

export { SURFACE_Y };
export const MAX_SPOTS = 4;
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
uniform float uTime, uCaust, uR, uDown, uSpotN, uShadowOn, uShadowBias, uShadowTexel, uCaustScale;
uniform vec3 uFogK, uFogCol, uSunXZ;
uniform vec4 uCaustBox;
uniform vec2 uCur;
uniform vec4 uSpotP[${MAX_SPOTS}], uSpotD[${MAX_SPOTS}], uSpotC[${MAX_SPOTS}];
uniform mat4 uShadowM;
uniform mediump sampler2D uCaustTex;
uniform highp sampler2D uShadow;
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
// The lead lamp shadow: 1 lit, 0 in shadow. 3 x 3 PCF.
float shadowAt(vec3 w, vec3 n) {
  if (uShadowOn < 0.5) return 1.0;
  vec4 sc = uShadowM * vec4(w + n * 0.05, 1.0);
  sc.xyz /= sc.w;
  if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0) return 1.0;
  float s = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(float(i), float(j)) * uShadowTexel * 1.6;
    s += step(sc.z + uShadowBias, unpackD(texture(uShadow, sc.xy + o)));
  }
  return s / 9.0;
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
    if (i == 0) R *= shadowAt(w, n);
    if (max(R.r, max(R.g, R.b)) < 1e-5) continue;
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
//  uPartB (rgba) = birth s, radius, sway level * 2 + tip, height over base
export const PART = /* glsl */`
uniform float uTime;
uniform vec2 uCur;
uniform highp sampler2D uPartA, uPartB;
uniform float uPartW;
ivec2 partCoord(float g) { float gg = max(g, 0.0); return ivec2(int(mod(gg, uPartW)), int(floor(gg / uPartW))); }`;

export const CORAL_VS = /* glsl */`
${PART}
in float aGid;
uniform float uSwayK, uCount, uMode;
out vec3 vN, vW, vL, vNat;
out float vT, vGlow, vTip;
void main() {
  ivec2 tc = partCoord(aGid);
  vec4 A = texelFetch(uPartA, tc, 0), B = texelFetch(uPartB, tc, 0);
  float age = uTime - B.x;
  float g = clamp(age / 1.4, 0.0, 1.0); g = g * g * (3.0 - 2.0 * g);
  vec3 p = position - normal * B.y * (1.0 - g) * 0.85;
  vec4 w = modelMatrix * vec4(p, 1.0);
  float lvl = floor(B.z * 0.5), tip = B.z - lvl * 2.0;
  float amp = lvl / 4.0, h = B.w;
  float ph = aGid * 0.0137;
  float wave = sin(uTime * 1.05 + ph - h * 1.1) + 0.35 * sin(uTime * 2.3 + ph * 1.7 - h * 1.7);
  vec2 dir = normalize(uCur + vec2(0.0001)) * 0.8 + vec2(cos(ph * 6.0), sin(ph * 6.0)) * 0.3;
  w.xz += dir * wave * amp * uSwayK * 0.04 * pow(max(h, 0.0), 1.5);
  vW = w.xyz; vL = position;
  vN = normalize(mat3(modelMatrix) * normal);
  vNat = pow(A.rgb, vec3(2.2));
  vT = (uMode > 0.5 && uMode < 1.5) ? max(aGid, 0.0) / max(1.0, uCount - 1.0) : A.a;
  vGlow = exp(-max(age, 0.0) / 1.6);
  vTip = tip;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const CORAL_FS = /* glsl */`
${NOISE2}
${WATER}
${NOISE}
uniform sampler2D uLut;
uniform float uMode, uBleach, uSpecies, uDetail, uDetailK;
in vec3 vN, vW, vL, vNat;
in float vT, vGlow, vTip;
out vec4 oCol;
// species: 0 staghorn, 1 fan, 2 table, 3 boulder (brain), 4 finger
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 V = normalize(cameraPosition - vW);
  vec3 lutC = texture(uLut, vec2(clamp(vT, 0.0, 1.0) * 0.992 + 0.004, 0.5)).rgb;
  vec3 base = uMode < 0.5 ? vNat : lutC;
  float bl = uMode < 0.5 ? uBleach : uBleach * 0.35;
  base = mix(base, vec3(0.88, 0.88, 0.84), bl * 0.88);
  float h = 0.0, ao = 1.0, thin = 0.35, sheen = 0.0;
  float sp = uSpecies;
  vec3 q = vL * uDetailK;
  if (uDetail > 0.5) {
    if (sp < 0.5 || (sp > 1.5 && sp < 2.5)) {
      vec2 c = worley(q * (sp < 0.5 ? 4.2 : 5.0));
      float rim = smoothstep(0.12, 0.26, c.x) * (1.0 - smoothstep(0.30, 0.46, c.x));
      float pit = 1.0 - smoothstep(0.06, 0.2, c.x);
      h = rim * 0.6 - pit * 0.9 + (c.y - c.x) * 0.15;
      ao = 1.0 - pit * 0.55;
      base *= 0.86 + 0.28 * rim;
      thin = sp < 0.5 ? 0.3 + 0.6 * vTip : 0.35;
    } else if (sp < 1.5) {
      vec2 c = worley(q * 9.0);
      float pore = 1.0 - smoothstep(0.08, 0.22, c.x);
      h = -pore * 0.5; ao = 1.0 - pore * 0.35; thin = 1.0;
    } else if (sp < 3.5) {
      float gv = groove(q);
      float sep = 0.5 + 0.5 * sin(dot(q, vec3(7.1, 5.3, 6.7)) + noise3(q * 0.9) * 6.0);
      h = -gv * 1.2 + (1.0 - gv) * sep * 0.15;
      ao = 1.0 - gv * 0.5;
      base = mix(base, base * vec3(0.72, 0.82, 0.62), gv * 0.6);
      thin = 0.25;
    } else {
      float v = noise3(q * 7.0) * 0.6 + noise3(q * 15.0) * 0.4;
      h = v * 0.5; ao = 0.85 + 0.15 * v; thin = 0.6; sheen = 0.6;
    }
    n = bumpN(n, vW, h, sp > 2.5 && sp < 3.5 ? 0.9 : 0.55);
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
export const POLYP_VS = /* glsl */`
${PART}
in vec4 aT;
in vec3 iPos, iNrm;
in vec2 iData;
uniform float uSize, uKeep, uSwayK, uCount, uMode, uExtend;
out vec3 vW, vN, vNat;
out float vS, vT, vKind, vGlow;
void main() {
  vKind = aT.w; vS = aT.y;
  if (iData.y > uKeep) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  ivec2 tc = partCoord(iData.x);
  vec4 A = texelFetch(uPartA, tc, 0), B = texelFetch(uPartB, tc, 0);
  float age = uTime - B.x;
  float grow = clamp((age - 0.6) / 1.5, 0.0, 1.0);
  vec3 nn = normalize(iNrm);
  vec3 t = normalize(cross(nn, abs(nn.y) < 0.92 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(nn, t);
  float ph = iData.y * 71.0;
  float open = 0.5 + 0.5 * sin(uTime * 0.42 + ph) * 0.7 + 0.5 * sin(uTime * 0.17 + ph * 1.9) * 0.3;
  float e = uExtend * (0.18 + 0.82 * smoothstep(0.2, 0.8, open)) * grow;
  vec3 lp;
  float a = aT.x;
  vec2 d = vec2(cos(a), sin(a));
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
  vec4 w = modelMatrix * vec4(iPos + off, 1.0);
  float sw = aT.w > 1.5 ? aT.y * aT.y * e : 0.0;
  w.xz += (normalize(uCur + vec2(0.0001)) * (0.6 + 0.4 * sin(uTime * 1.3 + ph))) * sw * size * 0.9 * uSwayK;
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * (aT.w > 1.5 ? normalize(t * d.x + b * d.y + nn * 0.6) : (aT.w > 0.5 ? nn : t * d.x + b * d.y)));
  vNat = pow(A.rgb, vec3(2.2));
  vT = (uMode > 0.5 && uMode < 1.5) ? iData.x / max(1.0, uCount - 1.0) : A.a;
  vGlow = exp(-max(age, 0.0) / 2.0);
  gl_Position = projectionMatrix * viewMatrix * w;
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
// Flakes in a box that wraps round the eye. A flake shows only in a lamp
// beam (and a very little in the downwell): backscatter. Near flakes are
// large and soft (out of focus).
export const SNOW_VS = /* glsl */`
${NOISE2}
${WATER}
in float aSize;
uniform vec3 uOff, uBox;
uniform float uPx;
out vec3 vC;
out float vSoft;
void main() {
  vec3 q = cameraPosition - uBox * 0.5 + mod(position + uOff - (cameraPosition - uBox * 0.5), uBox);
  q.x += sin(uTime * 0.7 + position.y * 3.0) * 0.05; q.z += cos(uTime * 0.6 + position.x * 3.0) * 0.05;
  vec3 c = vec3(0.0);
  for (int i = 0; i < ${MAX_SPOTS}; i++) {
    if (float(i) >= uSpotN) break;
    vec3 L;
    vec3 R = spotRad(i, q, L);
    vec3 V = normalize(cameraPosition - q);
    float ph = 0.35 + 1.6 * pow(clamp(dot(-L, -V) * 0.5 + 0.5, 0.0, 1.0), 4.0);
    c += R * ph;
  }
  c += vec3(0.10, 0.30, 0.52) * uDown * 0.03;
  vec4 mv = viewMatrix * vec4(q, 1.0);
  float z = max(0.2, -mv.z);
  float px = aSize * uPx / z;
  vSoft = clamp((1.2 - z) / 1.0, 0.0, 1.0);
  gl_PointSize = clamp(px * (1.0 + vSoft * 3.0), 1.0, 48.0);
  float far = smoothstep(uBox.x * 0.5, uBox.x * 0.3, length(q - cameraPosition));
  vC = c * far * exp(-z * uFogK) * 0.6 / (1.0 + vSoft * 6.0);
  gl_Position = projectionMatrix * mv;
}`;
export const SNOW_FS = /* glsl */`
in vec3 vC;
in float vSoft;
out vec4 oCol;
void main() {
  vec2 c = gl_PointCoord - 0.5; float r = dot(c, c) * 4.0;
  if (r > 1.0) discard;
  float a = mix(1.0 - r, exp(-r * 2.5), vSoft);
  oCol = vec4(vC * a, 1.0);
}`;

// ── full-frame passes (RawShaderMaterial, GLSL3) ────────────────────────────
export const FULL_VS = /* glsl */`
precision highp float;
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// The volume: in-scatter along the eye ray, up to the depth of the frame.
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
uniform mat4 uProjInv, uCamW;
uniform float uSteps, uVolMax, uScatter, uShaft, uFrame;
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  float z = texture(uDepth, vUv).r;
  vec4 vp = uProjInv * vec4(vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
  vp /= vp.w;
  vec3 wp = (uCamW * vec4(vp.xyz, 1.0)).xyz;
  vec3 rd = wp - cameraPosition;
  float tMax = min(length(rd), uVolMax);
  rd = normalize(rd);
  float j = fract(ign(gl_FragCoord.xy) + uFrame * 0.61803);
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
      if (i == 0) R *= shadowAt(p, vec3(0.0));
      float c = dot(-L, -rd);                 // light goes from the lamp past p; c = 1 straight at the eye
      float g = 0.55, hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * c, 1.5);
      s += R * (0.08 + hg * 0.25);
    }
    // shafts of downwell light that carry the caustic net down the water
    vec3 cs = causticAt(p);
    s += vec3(0.10, 0.30, 0.52) * uDown * uShaft * exp(-(SURF_Y - p.y) * 0.03) * max(cs.g - 1.1, 0.0) * 0.004;
    acc += s * dens * exp(-t * uFogK) * dt;
  }
  oCol = vec4(acc * uScatter, 1.0);
}`;

// The frame: the scene, the volume (3 x 3 tent), ACES tone map, vignette, grain.
export const COMP_FS = /* glsl */`
precision highp float;
in vec2 vUv;
out vec4 oCol;
uniform sampler2D uScene, uVol;
uniform vec2 uVolTexel;
uniform float uExposure, uGrain, uTime, uVig;
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
void main() {
  vec3 c = texture(uScene, vUv).rgb;
  vec3 v = vec3(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    float w = (2.0 - abs(float(i))) * (2.0 - abs(float(j)));
    v += texture(uVol, vUv + vec2(float(i), float(j)) * uVolTexel).rgb * w;
  }
  c += v / 16.0;
  c = aces(c * uExposure);
  vec2 d = vUv - 0.5;
  c *= 1.0 - uVig * dot(d, d) * 1.6;
  c = toSRGB(c);
  c += (h12(gl_FragCoord.xy + fract(uTime * 7.3) * 113.0) - 0.5) * uGrain;
  oCol = vec4(c, 1.0);
}`;
