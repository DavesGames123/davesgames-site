// ============================================================================
//  DLAF PAGE  ·  surface-shaders.js — GLSL ES 3.00 and the material presets
// ----------------------------------------------------------------------------
//  DOM-free (strings and numbers), so tests.mjs and glsl-check.mjs can read
//  it. surface-render.js compiles the programs.
//
//  Programs
//    SURF   the SDF mesh: per-vertex particle id -> colour value (a R32F
//           texture of values, texelFetch) -> gradient LUT. Shading: GGX
//           key light with soft PCF shadows (12 Poisson taps on a hardware
//           2x2 compare), wrap diffuse and a back-light term for subsurface,
//           sky and ground ambient times the per-vertex SDF occlusion, a
//           sky reflection with a soft box, a clear coat, a rim, emission,
//           and the age glow of the growth front. ACES tone map at the end.
//    GROUND the floor (3D) or the slab under the relief (2D): the same
//           BRDF with a flat normal, the key shadow, and a contact shadow
//           from the "below" depth map: the height of the lowest surface
//           over each ground point, sampled on a disc. It fades out by
//           alpha over the backdrop.
//    DEPTH  depth only, for the shadow map and the below map.
//    BACK   a full-screen backdrop: a vertical gradient and a vignette.
//
//  Every stage says "precision highp int" and "highp float": GLSL ES 3.00
//  does not link a uniform that two stages declare with two precisions.
//
//  grep -n targets
//    materials ............. "export const MATERIALS"
//    shared BRDF ........... "const BRDF"
//    surface shaders ....... "export const SURF_VS"
//    ground shaders ........ "export const GROUND_VS"
//    depth shaders ......... "export const DEPTH_VS"
//    backdrop .............. "export const BACK_VS"
// ============================================================================

// A material: base colour (linear), metal, rough, sss (wrap and back
// light), lutMix (how much the heatmap colour replaces the base), emissive,
// rim, coat, glass (a tinted see-through look from a refracted sky). The
// heatmap always enters: as the albedo (porcelain), the metal tint
// (copper), the body tint (glass) or the light (bioluminescent).
// g2 and g3 are the ground in 2D (the relief slab) and in 3D (the floor).
export const MATERIALS = Object.freeze([
  { id: 'porcelain', label: 'Porcelain', base: [0.93, 0.91, 0.87], metal: 0, rough: 0.42, sss: 0.6, lutMix: 0.82, emissive: 0, rim: 0.16, coat: 0.7, glass: 0,
    g2: { base: [0.46, 0.45, 0.43], metal: 0, rough: 0.7, lutMix: 0 }, g3: { base: [0.035, 0.034, 0.038], metal: 0, rough: 0.9, lutMix: 0 } },
  { id: 'glass', label: 'Glass', base: [0.02, 0.022, 0.026], metal: 0, rough: 0.05, sss: 0, lutMix: 1, emissive: 0.1, rim: 0.4, coat: 0, glass: 1,
    g2: { base: [0.03, 0.032, 0.04], metal: 0, rough: 0.3, lutMix: 0 }, g3: { base: [0.03, 0.03, 0.036], metal: 0, rough: 0.45, lutMix: 0 } },
  { id: 'copper', label: 'Copper', base: [0.955, 0.637, 0.538], metal: 1, rough: 0.3, sss: 0, lutMix: 0.4, emissive: 0, rim: 0.05, coat: 0, glass: 0,
    g2: { base: [0.5, 0.3, 0.21], metal: 1, rough: 0.42, lutMix: 0 }, g3: { base: [0.05, 0.045, 0.042], metal: 0, rough: 0.7, lutMix: 0 } },
  { id: 'bio', label: 'Bioluminescent', base: [0.012, 0.016, 0.024], metal: 0, rough: 0.5, sss: 0.3, lutMix: 0.15, emissive: 1.5, rim: 0.9, coat: 0.3, glass: 0,
    g2: { base: [0.015, 0.018, 0.025], metal: 0, rough: 0.7, lutMix: 0 }, g3: { base: [0.012, 0.014, 0.02], metal: 0, rough: 0.8, lutMix: 0 } },
]);
export const MATERIAL_IDS = MATERIALS.map(m => m.id);

// The light rig of each material: key light, sky and ground light (linear),
// exposure, and the backdrop gradient (top, base). The bioluminescent rig is
// dim, so the emission carries the picture.
export const RIGS = Object.freeze({
  porcelain: { key: [2.9, 2.75, 2.5], sky: [0.34, 0.37, 0.44], gnd: [0.12, 0.1, 0.09], exposure: 1.0, bgTop: [0.055, 0.05, 0.07], bgBot: [0.018, 0.014, 0.024] },
  glass: { key: [3.2, 3.1, 3.0], sky: [0.3, 0.36, 0.48], gnd: [0.05, 0.05, 0.06], exposure: 1.05, bgTop: [0.04, 0.05, 0.07], bgBot: [0.01, 0.012, 0.02] },
  copper: { key: [3.4, 3.15, 2.85], sky: [0.075, 0.08, 0.09], gnd: [0.03, 0.025, 0.02], exposure: 1.05, bgTop: [0.05, 0.038, 0.032], bgBot: [0.016, 0.011, 0.01] },
  bio: { key: [0.35, 0.4, 0.55], sky: [0.05, 0.07, 0.11], gnd: [0.01, 0.012, 0.02], exposure: 1.15, bgTop: [0.012, 0.02, 0.035], bgBot: [0.003, 0.004, 0.01] },
});
export function rigFor(id) { return RIGS[materialById(id).id]; }
export function materialById(id) { return MATERIALS.find(m => m.id === id) || MATERIALS[0]; }

const HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DShadow;
`;

// Shared lighting: GGX, the sky and the soft PCF shadow.
const BRDF = `
const float PI = 3.14159265;
uniform vec3 u_L;          // to the key light (unit)
uniform vec3 u_up;         // world up (unit)
uniform vec3 u_keyCol, u_skyCol, u_gndCol;
uniform float u_shadowTexel;
uniform int u_shadowOn;
uniform sampler2DShadow u_shadow;

float dGGX(float NoH, float a) { float a2 = a * a; float d = NoH * NoH * (a2 - 1.0) + 1.0; return a2 / (PI * d * d); }
float vSmith(float NoV, float NoL, float a) {
  float a2 = a * a;
  float gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2), gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
  return 0.5 / max(gv + gl, 1e-5);
}
vec3 fSchlick(vec3 f0, float c) { return f0 + (1.0 - f0) * pow(1.0 - c, 5.0); }
vec3 fRough(vec3 f0, float NoV, float r) { return f0 + (max(vec3(1.0 - r), f0) - f0) * pow(1.0 - NoV, 5.0); }

// The sky: ground colour below the horizon, sky colour above, a soft box
// round the key light (sharper for a smooth surface) and a horizon band.
vec3 sky(vec3 r, float rough) {
  float u = dot(r, u_up);
  vec3 c = mix(u_gndCol, u_skyCol, smoothstep(-0.3, 0.7, u));
  float e = mix(260.0, 6.0, rough);
  float box = pow(max(dot(r, u_L), 0.0), e) * (e + 2.0) / 40.0;
  c += u_keyCol * box * mix(1.0, 0.35, rough);
  c += u_skyCol * 0.5 * exp(-abs(u) * 7.0);
  return c;
}

const vec2 PD[12] = vec2[12](
  vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
  vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893),
  vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598));

float shadowAt(vec4 lp, float NoL, float soft) {
  if (u_shadowOn == 0) return 1.0;
  vec3 p = lp.xyz / lp.w * 0.5 + 0.5;
  if (p.x <= 0.0 || p.y <= 0.0 || p.x >= 1.0 || p.y >= 1.0 || p.z >= 1.0) return 1.0;
  float bias = (1.5 + 3.0 * (1.0 - NoL)) * u_shadowTexel;
  float s = 0.0;
  float rad = soft * u_shadowTexel;
  for (int i = 0; i < 12; i++) s += texture(u_shadow, vec3(p.xy + PD[i] * rad, p.z - bias));
  return s / 12.0;
}

// ACES fit (Narkowicz 2015), then sRGB gamma.
vec3 toneMap(vec3 c) {
  c = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
  return pow(c, vec3(1.0 / 2.2));
}
`;

export const SURF_VS = HEAD + `
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_nrm;
layout(location=2) in float a_id;
layout(location=3) in float a_ao;
uniform mat4 u_mvp;
uniform mat4 u_light;
uniform sampler2D u_vals;
uniform float u_max, u_floor, u_gamma, u_count, u_glowN;
out vec3 v_pos;
out vec3 v_nrm;
out vec4 v_lpos;
out float v_t;
out float v_glow;
out float v_ao;
flat out float v_id;
void main() {
  int id = max(0, int(a_id + 0.5));
  int W = textureSize(u_vals, 0).x;
  float val = texelFetch(u_vals, ivec2(id % W, id / W), 0).r;
  float x = clamp(val / u_max, 0.0, 1.0);
  v_t = u_floor + (1.0 - u_floor) * pow(x, u_gamma);
  float g = clamp((a_id - (u_count - u_glowN)) / max(u_glowN, 1.0), 0.0, 1.0);
  v_glow = g * g;
  v_pos = a_pos;
  v_nrm = a_nrm;
  v_ao = a_ao;
  v_id = a_id;
  v_lpos = u_light * vec4(a_pos, 1.0);
  gl_Position = u_mvp * vec4(a_pos, 1.0);
}`;

export const SURF_FS = HEAD + BRDF + `
uniform sampler2D u_lut;
uniform vec3 u_eye;
uniform vec3 u_viewDir;
uniform int u_ortho;
uniform vec3 u_base;
uniform vec4 u_mat;        // metal, rough, sss, lutMix
uniform vec4 u_mat2;       // emissive, rim, coat, glass
uniform float u_glowStr, u_k, u_exposure;
in vec3 v_pos;
in vec3 v_nrm;
in vec4 v_lpos;
in float v_t;
in float v_glow;
in float v_ao;
flat in float v_id;
out vec4 o;
void main() {
  if (v_id >= u_k) discard;
  vec3 N = normalize(v_nrm);
  vec3 V = u_ortho == 1 ? u_viewDir : normalize(u_eye - v_pos);
  float NoV = dot(N, V);
  if (NoV < 0.0) { N = normalize(N - V * NoV * 1.01); NoV = dot(N, V); }
  NoV = max(NoV, 1e-3);
  vec3 L = u_L, H = normalize(V + L);
  float NoLr = dot(N, L), NoL = max(NoLr, 0.0), NoH = max(dot(N, H), 0.0), VoH = max(dot(V, H), 0.0);

  vec3 heat = pow(texture(u_lut, vec2(v_t, 0.5)).rgb, vec3(2.2));
  vec3 hot = pow(texture(u_lut, vec2(1.0, 0.5)).rgb, vec3(2.2));
  float metal = u_mat.x, rough = u_mat.y, sss = u_mat.z, lutMix = u_mat.w;
  float emis = u_mat2.x, rim = u_mat2.y, coat = u_mat2.z, glass = u_mat2.w;
  vec3 albedo = mix(u_base, heat, lutMix);
  if (metal > 0.5) albedo = mix(u_base, u_base * heat / max(max(heat.r, max(heat.g, heat.b)), 0.05), lutMix);
  float a = max(rough * rough, 0.002);
  vec3 f0 = mix(vec3(0.04), albedo, metal);
  vec3 diffC = albedo * (1.0 - metal) * (1.0 - glass);

  float ao = v_ao;
  float aoD = ao * ao * (3.0 - 2.0 * ao);          // a smooth step: crevices go dark
  float aoS = clamp(pow(NoV + ao, exp2(-16.0 * a - 1.0)) - 1.0 + ao, 0.0, 1.0);   // Lagarde: occlusion of the reflection
  float sh = shadowAt(v_lpos, NoL, 2.6);

  // key light: GGX, wrap diffuse (sss widens the lit side), a back light
  vec3 F = fSchlick(f0, VoH);
  vec3 spec = dGGX(NoH, a) * vSmith(NoV, NoL, a) * F;
  float w = sss * 0.6;
  float diffW = max((NoLr + w) / ((1.0 + w) * (1.0 + w)), 0.0);
  vec3 col = (diffC * diffW / PI * (1.0 - F) * mix(1.0, sh, 0.9) + spec * NoL * sh) * u_keyCol * PI;
  float back = pow(clamp(dot(V, -normalize(L + N * 0.45)), 0.0, 1.0), 3.0) * sss;
  col += back * albedo * albedo * u_keyCol * 0.55 * aoD;

  // sky: diffuse from the hemisphere, the reflection, a clear coat
  float hem = dot(N, u_up) * 0.5 + 0.5;
  vec3 amb = mix(u_gndCol, u_skyCol, hem);
  col += diffC * amb * aoD;
  vec3 R = reflect(-V, N);
  vec3 Fr = fRough(f0, NoV, rough);
  col += sky(R, rough) * Fr * aoS * (1.0 - glass * 0.3);
  if (coat > 0.0) {
    float Fc = 0.04 + 0.96 * pow(1.0 - NoV, 5.0);
    float ac = 0.012;
    col += coat * (dGGX(NoH, ac) * vSmith(NoV, NoL, ac) * Fc * NoL * sh * u_keyCol * PI + sky(R, 0.08) * Fc * aoS);
  }
  if (glass > 0.0) {
    // a thin tube of tinted glass: the path through it is long at the
    // edges (deep tint) and short at the centre (the sky shows through)
    vec3 T = refract(-V, N, 1.0 / 1.45);
    float Fg = 0.04 + 0.96 * pow(1.0 - NoV, 5.0);
    float path = 0.18 + 0.82 * pow(1.0 - NoV, 1.4);
    vec3 through = sky(T, 0.25) * 0.5;
    vec3 body = mix(through, heat * 1.6, path) * (0.3 + 0.7 * aoD);
    col += glass * (1.0 - Fg) * body;
    col += glass * sky(R, 0.02) * Fg * 1.6 * aoS;
  }
  // rim, emission and the growth front
  float fr = pow(1.0 - NoV, 3.0);
  col += rim * fr * mix(u_skyCol * 2.0, heat * 1.6, 0.65) * (0.4 + 0.6 * ao);
  col += emis * heat * (0.35 + 0.4 * fr + 0.25 * (1.0 - aoD));
  col += hot * v_glow * u_glowStr * (0.6 + 1.6 * fr);
  o = vec4(toneMap(col * u_exposure), 1.0);
}`;

export const GROUND_VS = HEAD + `
layout(location=0) in vec3 a_pos;
uniform mat4 u_mvp;
uniform mat4 u_light;
uniform mat4 u_below;
out vec3 v_pos;
out vec4 v_lpos;
out vec4 v_bpos;
void main() {
  v_pos = a_pos;
  v_lpos = u_light * vec4(a_pos, 1.0);
  v_bpos = u_below * vec4(a_pos, 1.0);
  gl_Position = u_mvp * vec4(a_pos, 1.0);
}`;

export const GROUND_FS = HEAD + BRDF + `
uniform sampler2D u_belowMap;
uniform vec3 u_eye;
uniform vec3 u_viewDir;
uniform int u_ortho;
uniform vec3 u_gbase;
uniform vec4 u_gmat;       // metal, rough, contact strength, contact radius (uv)
uniform vec3 u_center;
uniform vec2 u_fade;       // fade to the backdrop from fade.x to fade.y (world)
uniform float u_belowRange, u_exposure;
in vec3 v_pos;
in vec4 v_lpos;
in vec4 v_bpos;
out vec4 o;

// 0 = open, 1 = a surface sits on this ground point
float contact(vec2 uv) {
  if (u_gmat.z <= 0.0) return 0.0;
  float occ = 0.0, wsum = 0.0;
  float R = u_gmat.w;
  for (int ring = 0; ring < 3; ring++) {
    float rr = R * (0.25 + 0.375 * float(ring));
    for (int i = 0; i < 12; i++) {
      vec2 q = uv + PD[i] * rr;
      float h = texture(u_belowMap, q).r * u_belowRange;   // height of the lowest surface over q
      float reach = u_belowRange * (0.12 + 0.3 * float(ring));
      float wgt = 1.0 / (1.0 + float(ring));
      occ += wgt * (1.0 - smoothstep(0.0, reach, h));
      wsum += wgt;
    }
  }
  return occ / wsum;
}

void main() {
  vec3 N = u_up;
  vec3 V = u_ortho == 1 ? u_viewDir : normalize(u_eye - v_pos);
  float NoV = max(dot(N, V), 1e-3);
  vec3 L = u_L, H = normalize(V + L);
  float NoL = max(dot(N, L), 0.0), NoH = max(dot(N, H), 0.0), VoH = max(dot(V, H), 0.0);
  float metal = u_gmat.x, rough = u_gmat.y, a = max(rough * rough, 0.002);
  vec3 f0 = mix(vec3(0.04), u_gbase, metal), diffC = u_gbase * (1.0 - metal);
  float sh = shadowAt(v_lpos, NoL, 4.5);
  vec2 buv = v_bpos.xy / v_bpos.w * 0.5 + 0.5;
  float c = contact(buv) * u_gmat.z;
  float ao = 1.0 - c;
  vec3 F = fSchlick(f0, VoH);
  vec3 col = (diffC / PI + dGGX(NoH, a) * vSmith(NoV, NoL, a) * F) * NoL * sh * u_keyCol * PI;
  col += diffC * u_skyCol * ao;
  col += sky(reflect(-V, N), rough) * fRough(f0, NoV, rough) * ao * (0.4 + 0.6 * sh);
  col = toneMap(col * u_exposure);
  // fade out over the backdrop (the ground pass blends by alpha)
  float d = length(v_pos - u_center);
  float f = smoothstep(u_fade.x, u_fade.y, d);
  o = vec4(col, 1.0 - f);
}`;

export const DEPTH_VS = HEAD + `
layout(location=0) in vec3 a_pos;
uniform mat4 u_mvp;
void main() { gl_Position = u_mvp * vec4(a_pos, 1.0); }`;

export const DEPTH_FS = HEAD + `
void main() { }`;

export const BACK_VS = HEAD + `
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.9999, 1.0);
}`;

export const BACK_FS = HEAD + `
uniform vec3 u_bgTop, u_bgBot;
in vec2 v_uv;
out vec4 o;
void main() {
  vec3 c = mix(u_bgBot, u_bgTop, smoothstep(0.0, 1.0, v_uv.y));
  vec2 q = v_uv - 0.5;
  c *= 1.0 - 0.55 * dot(q, q);
  o = vec4(c, 1.0);
}`;

export const PROGRAMS = Object.freeze([
  { name: 'surface', vs: SURF_VS, fs: SURF_FS },
  { name: 'ground', vs: GROUND_VS, fs: GROUND_FS },
  { name: 'depth', vs: DEPTH_VS, fs: DEPTH_FS },
  { name: 'backdrop', vs: BACK_VS, fs: BACK_FS },
]);
