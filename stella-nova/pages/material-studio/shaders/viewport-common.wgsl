// ============================================================================
//  MATERIAL STUDIO  ·  shaders/viewport-common.wgsl — shared viewport WGSL
// ────────────────────────────────────────────────────────────────────────────
//  viewport.js puts this chunk, then a generated environment chunk (ENV
//  below), in front of pbr.wgsl and viewport-bg.wgsl. It holds the frame
//  uniform, the group 0 bindings that do not change with the environment
//  kind, and the shadow, color and procedural sky helpers.
//
//  GROUP 0  (frame; visible to vertex and fragment)
//      0 F ........ Frame uniform
//      1 tRad ..... radiance (generated: texture_2d or texture_cube)
//      2 tIrr ..... irradiance (generated: texture_2d or texture_cube)
//      3 sEnv ..... filtering sampler for the environment
//      4 tLut ..... BRDF LUT rgba16float: r = A, g = B (split sum), b = sheen E
//      5 tShadow .. key light shadow map (depth32float)
//      6 sShadow .. comparison sampler
//      7 sClamp ... linear clamp sampler (LUT)
//
//  THE GENERATED ENV CHUNK DEFINES
//      fn env_radiance(dir: vec3f, lod: f32) -> vec3f   world dir, rotation applied
//      fn env_irradiance(n: vec3f) -> vec3f             cosine-weighted mean radiance (E / PI),
//                                                       so diffuse = albedo * env_irradiance(n)
//      fn env_background(d: vec3f) -> vec3f             the background for a view ray
//  The generic and procedural chunks multiply by F.env.y (intensity); with
//  F.env.w == 0 they use sky_proc. The 'lib' chunk calls env.js envWGSL
//  functions (bindings 8..13), which apply the env.js grade themselves.
//
//  SECTIONS  (grep -n the name to jump)
//      struct Frame / Light
//      env_rot / env_uv ..... rotation around +Y and the equirect mapping
//      sky_proc ............. procedural studio sky (no environment yet)
//      sh_eval .............. 9-coefficient irradiance from F.sh
//      shadow_key ........... 3x3 PCF lookup in the key light shadow map
//      srgb_to_linear / luma
// ============================================================================

const PI: f32 = 3.14159265359;
const TAU: f32 = 6.28318530718;
const INV_PI: f32 = 0.31830988618;
const INV_TAU: f32 = 0.15915494309;

struct Light {
  pos: vec4f,    // xyz: direction toward the light (dir) or position (point); w: 0 off, 1 dir, 2 + range point
  color: vec4f,  // rgb: linear color * intensity; w: 1 when this light uses the shadow map
}

struct Frame {
  viewProj: mat4x4f,
  invViewProj: mat4x4f,
  shadowMat: mat4x4f,
  camPos: vec4f,     // xyz eye, w time in seconds
  env: vec4f,        // x rotation (rad), y intensity, z radiance mip count, w 1 = env textures, 0 = sky_proc
  bgA: vec4f,        // rgb solid color (linear), w mode: 0 env, 1 solid, 2 checker, 3 gradient
  bgB: vec4f,        // x background lod, y ground height, z ground on, w grid on
  params: vec4f,     // x debug id, y light count, z shadow strength, w specular occlusion amount
  viewport: vec4f,   // x width, y height, z 1/width, w 1/height
  keyDir: vec4f,     // xyz direction toward the key light, w 1 when the shadow map is valid
  lights: array<Light, 4>,
  sh: array<vec4f, 9>,
}

@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(3) var sEnv: sampler;
@group(0) @binding(4) var tLut: texture_2d<f32>;
@group(0) @binding(5) var tShadow: texture_depth_2d;
@group(0) @binding(6) var sShadow: sampler_comparison;
@group(0) @binding(7) var sClamp: sampler;

/** Rotate a world direction into environment space (around +Y). */
fn env_rot(d: vec3f) -> vec3f {
  let c = cos(F.env.x);
  let s = sin(F.env.x);
  return vec3f((c * d.x) + (s * d.z), d.y, (c * d.z) - (s * d.x));
}

/** Equirect mapping: u = 0.5 looks down -Z, v = 0 is straight up. */
fn env_uv(d: vec3f) -> vec2f {
  let u = 0.5 + (atan2(d.x, -d.z) * INV_TAU);
  let v = acos(clamp(d.y, -1.0, 1.0)) * INV_PI;
  return vec2f(u, v);
}

/** A neutral studio: soft top light, a warm key panel, a cool rim panel, a
 *  dark floor. `blur` 0..1 widens the panels (roughness proxy). */
fn sky_proc(d: vec3f, blur: f32) -> vec3f {
  let b = clamp(blur, 0.0, 1.0);
  let up = d.y;
  let sky = mix(vec3f(0.16, 0.17, 0.19), vec3f(0.55, 0.58, 0.62), smoothstep(-0.05, 0.9, up));
  let ground = vec3f(0.07, 0.065, 0.06) * (0.6 + (0.4 * smoothstep(-1.0, -0.1, up)));
  var c = select(ground, sky, up > -0.02 - (0.1 * b));
  c = mix(ground, c, smoothstep(-0.12 - (0.3 * b), 0.08 + (0.3 * b), up));
  let w = mix(0.0025, 0.5, b * b);
  let key = normalize(vec3f(0.55, 0.62, 0.56));
  let rim = normalize(vec3f(-0.7, 0.3, -0.65));
  let kd = 1.0 - dot(d, key);
  let rd = 1.0 - dot(d, rim);
  c += vec3f(5.0, 4.6, 4.1) * (exp(-kd / w) * mix(1.0, 0.25, b));
  c += vec3f(1.4, 1.7, 2.2) * (exp(-rd / (w * 2.0)) * mix(1.0, 0.3, b));
  return c;
}

/** Irradiance from 9 SH coefficients (F.sh[i].rgb), already convolved with
 *  the cosine lobe and divided by PI by the producer. */
fn sh_eval(n: vec3f) -> vec3f {
  let x = n.x; let y = n.y; let z = n.z;
  var r = F.sh[0].rgb * 0.282095;
  r += F.sh[1].rgb * (0.488603 * y);
  r += F.sh[2].rgb * (0.488603 * z);
  r += F.sh[3].rgb * (0.488603 * x);
  r += F.sh[4].rgb * (1.092548 * (x * y));
  r += F.sh[5].rgb * (1.092548 * (y * z));
  r += F.sh[6].rgb * (0.315392 * ((3.0 * z * z) - 1.0));
  r += F.sh[7].rgb * (1.092548 * (x * z));
  r += F.sh[8].rgb * (0.546274 * ((x * x) - (y * y)));
  return max(r, vec3f(0.0));
}

/** Key light visibility at a world point: 3x3 PCF. 1 = lit. */
fn shadow_key(world: vec3f, n: vec3f) -> f32 {
  if (F.keyDir.w < 0.5) { return 1.0; }
  let ndl = clamp(dot(n, F.keyDir.xyz), 0.0, 1.0);
  let offs = n * (0.012 + (0.02 * (1.0 - ndl)));
  let p = F.shadowMat * vec4f(world + offs, 1.0);
  let q = p.xyz / p.w;
  let uv = vec2f((q.x * 0.5) + 0.5, 0.5 - (q.y * 0.5));
  let dims = vec2f(textureDimensions(tShadow));
  let texel = 1.0 / dims;
  var s = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let o = vec2f(f32(i), f32(j)) * (texel * 1.5);
      s += textureSampleCompareLevel(tShadow, sShadow, uv + o, q.z - 0.0015);
    }
  }
  let inside = (uv.x > 0.0) && (uv.x < 1.0) && (uv.y > 0.0) && (uv.y < 1.0) && (q.z < 1.0);
  return select(1.0, s / 9.0, inside);
}

fn srgb_to_linear(c: vec3f) -> vec3f {
  let lo = c / 12.92;
  let hi = pow((c + vec3f(0.055)) / 1.055, vec3f(2.4));
  return select(hi, lo, c <= vec3f(0.04045));
}

fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
