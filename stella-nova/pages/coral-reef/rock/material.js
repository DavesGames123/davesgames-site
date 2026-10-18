// ============================================================================
//  CORAL REEF  ·  rock/material.js  ·  the rock and sand material description
// ----------------------------------------------------------------------------
//  DOM-free data and GLSL text. SCENE's shader reads it; this file does not
//  touch three.js. Texture paths are relative to pages/coral-reef/.
//
//  Rock: Poly Haven "Rock 3" (Rob Tuytel, CC0), a pitted grey seaside rock
//  face, 1024 px WebP, real size about 1.5 m. Mapped triplanar (no UVs on
//  the rock mesh). Per vertex the mesh gives `cavity` (0 open .. 1 deep
//  crevice) and `band` (the strata bed coordinate). The shader:
//    albedo = triplanar(albedo) * bedTint(floor(band)) * hardBed(fract(band))
//    albedo = mix(albedo, encrust, encrust.amount * up * (1 - cavity))
//    albedo *= 1 - cavity.darken * cavity
//    normal = triplanar normal map, whiteout blend on the mesh normal
//    orm    = triplanar orm (r ao, g roughness, b metal)
//
//  grep -n targets
//    texture paths ........ "export const ROCK_TEXTURES"
//    material for a rock .. "export function rockMaterial"
//    GLSL helpers ......... "export const ROCK_GLSL"
// ============================================================================

export const ROCK_TEXTURES = Object.freeze({
  albedo: 'assets/tex/rock/reef_rock_albedo.webp',
  normal: 'assets/tex/rock/reef_rock_normal.webp',   // OpenGL (+y green)
  orm: 'assets/tex/rock/reef_rock_orm.webp',         // r ao, g roughness, b metal (Poly Haven "arm")
  size: 1024,
  metres: 1.5,                                       // real width of one tile
  licence: 'CC0-1.0',
  source: 'https://polyhaven.com/a/rock_3',
  author: 'Rob Tuytel (Poly Haven)',
});

export const SAND_TEXTURES = Object.freeze({
  albedo: 'assets/tex/sand_diff.jpg',
  normal: 'assets/tex/sand_nor.jpg',
  metres: 2.0,
  licence: 'CC0-1.0',
  source: 'https://polyhaven.com/a/sand_01',
  author: 'Rob Tuytel (Poly Haven)',
});

// Strata tints: a short cycle of limestone colours, picked per bed by a hash.
const BED_TINTS = [[1.0, 0.97, 0.92], [0.9, 0.86, 0.8], [1.06, 1.0, 0.9], [0.82, 0.8, 0.78], [0.96, 0.9, 0.86]];

export function rockMaterial(geo) {
  return {
    kind: 'rock',
    textures: ROCK_TEXTURES,
    triplanar: { scale: 1 / ROCK_TEXTURES.metres, sharpness: 4 },
    strata: { period: geo.strata.period, bedTints: BED_TINTS, hardBed: [0.0, 0.25], hardBedLift: 0.08 },
    cavity: { attribute: 'cavity', darken: 0.72 },
    encrust: { color: [0.62, 0.38, 0.46], amount: 0.32, upPower: 1.5 },  // coralline algae on open tops
    attributes: { cavity: 'Float32 per vertex, 0 open .. 1 deep crevice', band: 'Float32 per vertex, strata bed coordinate' },
    roughness: 0.9,
  };
}

export function sandMaterial() {
  return { kind: 'sand', textures: SAND_TEXTURES, scale: 1 / SAND_TEXTURES.metres, tint: [0.78, 0.72, 0.6], roughness: 1 };
}

// GLSL ES 3.00 helpers. Declare the uniforms yourself:
//   uniform sampler2D uRockAlbedo, uRockNormal, uRockOrm;
//   uniform float uRockScale;     // ROCK material triplanar.scale
// and pass the vertex attributes `cavity` and `band` as varyings.
export const ROCK_GLSL = /* glsl */`
vec3 rockTriW(vec3 n) {
  vec3 w = pow(abs(n), vec3(4.0));
  return w / max(w.x + w.y + w.z, 1e-4);
}
vec4 rockTri(sampler2D t, vec3 p, vec3 w, float s) {
  return texture(t, p.zy * s) * w.x + texture(t, p.xz * s) * w.y + texture(t, p.xy * s) * w.z;
}
// Whiteout blend of three tangent-space normal maps on the world normal n.
vec3 rockTriNormal(sampler2D t, vec3 p, vec3 n, vec3 w, float s) {
  vec3 tx = texture(t, p.zy * s).xyz * 2.0 - 1.0;
  vec3 ty = texture(t, p.xz * s).xyz * 2.0 - 1.0;
  vec3 tz = texture(t, p.xy * s).xyz * 2.0 - 1.0;
  tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
  ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
  tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
  return normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
}
float rockHash1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
vec3 rockBedTint(float band) {
  float b = floor(band), f = fract(band);
  float h = rockHash1(b);
  vec3 c = h < 0.2 ? vec3(1.0, 0.97, 0.92) : h < 0.4 ? vec3(0.9, 0.86, 0.8) : h < 0.6 ? vec3(1.06, 1.0, 0.9) : h < 0.8 ? vec3(0.82, 0.8, 0.78) : vec3(0.96, 0.9, 0.86);
  float hard = 1.0 - smoothstep(0.22, 0.32, f);
  return c * (1.0 + 0.08 * hard);
}
vec3 rockAlbedo(sampler2D alb, vec3 p, vec3 n, float s, float cavity, float band) {
  vec3 w = rockTriW(n);
  vec3 a = rockTri(alb, p, w, s).rgb * rockBedTint(band);
  float up = pow(clamp(n.y, 0.0, 1.0), 1.5) * (1.0 - cavity);
  a = mix(a, a * vec3(1.25, 0.8, 0.95) * 0.9 + vec3(0.06, 0.02, 0.04), 0.32 * up);
  return a * (1.0 - 0.72 * cavity);
}
`;
