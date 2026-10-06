// ============================================================================
//  VOLUME NOISE  ·  shaders/common.wgsl — uniforms, textures, channel read
// ----------------------------------------------------------------------------
//  gpu.js puts this file in front of views.wgsl and of clouds.wgsl. Each
//  view is one full-screen triangle (vs_main) and one fragment entry point.
//  The uniform layout matches gpu.js "UNI" (13 vec4f, written each frame).
//
//  CHANNELS  (u.view.x, the index into gpu.js CHANNELS)
//    0..3   shape  R PerlinWorley, G B A worleyFBM0..2   (128^3, main.cpp)
//    4..7   parts  R perlin FBM, G PW Worley FBM, B 1 - Worley, A packed shape
//    8..11  detail R G B worleyFBM0..2, A packed detail   (32^3, main.cpp)
//
//  The sampler repeats on all axes, so a coordinate past 1 reads the other
//  side of the texture. That is how the tiled view and the clouds tile.
// ============================================================================

struct Uni {
  res: vec4f,    // x, y canvas px; z time s; w fade (0 black .. 1 full)
  rect: vec4f,   // the clear area in canvas px: x, y, w, h
  view: vec4f,   // x channel; y slice z (0..1); z tile span (1..3); w seam lines (0..1)
  eye: vec4f,    // xyz eye position; w focal length in px
  right: vec4f,  // camera basis (xyz)
  up: vec4f,
  fwd: vec4f,
  sun: vec4f,    // xyz direction to the sun; w sun height factor (0 low .. 1 high)
  cloud: vec4f,  // x coverage; y density; z erosion; w march steps
  wind: vec4f,   // xy wind offset of the shape (km); zw offset of the detail (km)
  vol: vec4f,    // x threshold; y gain; z colour ramp (0 grey, 1 ice); w shape res
  misc: vec4f,   // x 1 = draw the cube edges; y ambient; z exposure; w unused
  tint: vec4f,   // rgb sky tint of the time of day; w unused
}

@group(0) @binding(0) var<uniform> u: Uni;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tShape: texture_3d<f32>;
@group(0) @binding(3) var tParts: texture_3d<f32>;
@group(0) @binding(4) var tDetail: texture_3d<f32>;
@group(0) @binding(5) var tWeather: texture_2d<f32>;

@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

// One channel of one texture at p (texture space, repeats).
fn channel(c: i32, p: vec3f) -> f32 {
  var v: vec4f;
  if (c < 4) {
    v = textureSampleLevel(tShape, samp, p, 0.0);
  } else if (c < 8) {
    v = textureSampleLevel(tParts, samp, p, 0.0);
  } else {
    v = textureSampleLevel(tDetail, samp, p, 0.0);
  }
  let k = c % 4;
  if (k == 0) { return v.x; }
  if (k == 1) { return v.y; }
  if (k == 2) { return v.z; }
  return v.w;
}

// Grey, or an ice ramp (deep blue, cyan, white) for u.vol.z = 1.
fn ramp(v: f32) -> vec3f {
  if (u.vol.z < 0.5) { return vec3f(v); }
  let a = vec3f(0.02, 0.03, 0.09);
  let b = vec3f(0.10, 0.36, 0.62);
  let c = vec3f(0.55, 0.86, 0.95);
  let d = vec3f(1.0, 0.98, 0.92);
  if (v < 0.4) { return mix(a, b, v / 0.4); }
  if (v < 0.75) { return mix(b, c, (v - 0.4) / 0.35); }
  return mix(c, d, (v - 0.75) / 0.25);
}

// A cheap per-pixel hash for the ray start jitter.
fn pix_hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453);
}

// The page background behind a framed subject: dark, with a faint grid.
fn backdrop(px: vec2f) -> vec3f {
  let g = abs(fract(px / 48.0) - 0.5);
  let line = 1.0 - smoothstep(0.0, 0.02, min(g.x, g.y));
  return vec3f(0.035, 0.045, 0.07) + vec3f(0.02, 0.03, 0.05) * line;
}

// The camera ray through pixel px. The clear-area centre is the optical axis.
fn camera_ray(px: vec2f) -> vec3f {
  let c = u.rect.xy + 0.5 * u.rect.zw;
  let d = px - c;
  return normalize(u.fwd.xyz * u.eye.w + u.right.xyz * d.x - u.up.xyz * d.y);
}
