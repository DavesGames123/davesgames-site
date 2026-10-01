// ============================================================================
//  MATERIAL STUDIO  ·  shaders/env-common.wgsl — shared code for env passes
// ────────────────────────────────────────────────────────────────────────────
//  env.js puts this file in front of every env-*.wgsl module except
//  env-lib.wgsl (the consumer helper, which stands alone).
//
//  CONTENTS  (grep -n the name to jump)
//      vs_full ............ fullscreen triangle, no vertex buffer
//      uvToDir / dirToUV .. equirect mapping (see MAPPING)
//      hashU / hash2 ...... integer hash (PCG style) and a 2D cell hash
//      vnoise / fbm ....... value noise and 4-octave fractal noise
//      thumbTone .......... tone curve and sRGB encode for thumbnails
//
//  MAPPING
//      u in [0,1) goes once around the horizon, v=0 is straight up.
//      lon = (u - 0.5) * 2pi, lat = (0.5 - v) * pi
//      dir = (cos(lat) sin(lon), sin(lat), -cos(lat) cos(lon))
//      So u = 0.5 is -Z (the view direction of the default camera), and
//      u = 0 or 1 is +Z (behind the camera). +Y is up.
// ============================================================================

const PI: f32 = 3.14159265358979;
const TAU: f32 = 6.28318530717959;

@vertex
fn vs_full(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let x = f32((i << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(i & 2u) * 2.0 - 1.0;
  return vec4f(x, y, 0.0, 1.0);
}

fn uvToDir(uv: vec2f) -> vec3f {
  let lon = (uv.x - 0.5) * TAU;
  let lat = (0.5 - uv.y) * PI;
  let c = cos(lat);
  return vec3f(c * sin(lon), sin(lat), -(c * cos(lon)));
}

fn dirToUV(d: vec3f) -> vec2f {
  let lon = atan2(d.x, -d.z);
  let lat = asin(clamp(d.y, -1.0, 1.0));
  return vec2f(lon / TAU + 0.5, 0.5 - lat / PI);
}

fn hashU(x: u32) -> u32 {
  let v = (x * 747796405u) + 2891336453u;
  let w = ((v >> ((v >> 28u) + 4u)) ^ v) * 277803737u;
  return (w >> 22u) ^ w;
}

fn hash2(c: vec2f) -> f32 {
  let ix = bitcast<u32>(i32(c.x));
  let iy = bitcast<u32>(i32(c.y));
  let h = hashU((ix * 1597334677u) ^ hashU(iy + 374761393u));
  return f32(h >> 8u) * (1.0 / 16777216.0);
}

fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let s = f * f * (3.0 - (2.0 * f));
  let a = hash2(i);
  let b = hash2(i + vec2f(1.0, 0.0));
  let c = hash2(i + vec2f(0.0, 1.0));
  let d = hash2(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
}

fn fbm(p: vec2f) -> f32 {
  var q = p;
  var amp = 0.5;
  var sum = 0.0;
  for (var k = 0; k < 4; k++) {
    sum += amp * vnoise(q);
    q = (q * 2.03) + vec2f(17.1, 9.7);
    amp *= 0.5;
  }
  return sum / 0.9375;
}

fn thumbTone(c: vec3f) -> vec3f {
  let t = c / (vec3f(1.0) + c);
  let lo = t * 12.92;
  let hi = (1.055 * pow(t, vec3f(1.0 / 2.4))) - 0.055;
  return select(hi, lo, t <= vec3f(0.0031308));
}
