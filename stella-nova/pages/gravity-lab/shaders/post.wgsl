// ============================================================================
//  GRAVITY LAB  ·  shaders/post.wgsl — restrained bloom and the tone map
// ----------------------------------------------------------------------------
//  The scene is HDR (rgba16float). Only light far above white blooms: star
//  surfaces, galaxy cores and the impact flashes (incandescence), so the
//  bloom has a physical reason and planets and dust stay hard.
//    fs_down    the first level takes a threshold (soft knee) of the
//               scene; each next level halves the size (13 taps)
//    fs_up      a tent filter of the level below, added to this level
//    fs_final   scene + bloom * strength, exposure, ACES fit, a faint
//               vignette, sRGB, dithered to 8 bits
//  P (per pass): texel size of the source, threshold, strength, exposure.
//
//  grep -n targets: "fn fs_down", "fn fs_up", "fn fs_final", "fn aces"
// ============================================================================

struct PP { texel: vec2f, thr: f32, first: f32, strength: f32, exposure: f32, vig: f32, p0: f32 };
@group(0) @binding(0) var<uniform> P: PP;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var bloom: texture_2d<f32>;

struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex
fn vs_full(@builtin(vertex_index) vi: u32) -> VOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VOut;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  o.uv = vec2f(0.5 * p[vi].x + 0.5, 0.5 - 0.5 * p[vi].y);
  return o;
}
fn tap(uv: vec2f) -> vec3f { return textureSampleLevel(src, samp, uv, 0.0).rgb; }
fn knee(c: vec3f) -> vec3f {
  let l = max(max(c.r, c.g), c.b);
  let k = 0.5 * P.thr;
  var s = clamp(l - P.thr + k, 0.0, 2.0 * k);
  s = s * s / (4.0 * k + 1e-5);
  let w = max(s, l - P.thr) / max(l, 1e-5);
  return c * w;
}
@fragment
fn fs_down(i: VOut) -> @location(0) vec4f {
  let t = P.texel;
  let uv = i.uv;
  let a = tap(uv + t * vec2f(-2.0, -2.0));
  let b = tap(uv + t * vec2f(0.0, -2.0));
  let c = tap(uv + t * vec2f(2.0, -2.0));
  let d = tap(uv + t * vec2f(-2.0, 0.0));
  let e = tap(uv);
  let f = tap(uv + t * vec2f(2.0, 0.0));
  let g = tap(uv + t * vec2f(-2.0, 2.0));
  let h = tap(uv + t * vec2f(0.0, 2.0));
  let k = tap(uv + t * vec2f(2.0, 2.0));
  let l = tap(uv + t * vec2f(-1.0, -1.0));
  let m = tap(uv + t * vec2f(1.0, -1.0));
  let n = tap(uv + t * vec2f(-1.0, 1.0));
  let o = tap(uv + t * vec2f(1.0, 1.0));
  var s = e * 0.125 + (a + c + g + k) * 0.03125 + (b + d + f + h) * 0.0625 + (l + m + n + o) * 0.125;
  if (P.first > 0.5) { s = knee(s); }
  return vec4f(min(s, vec3f(200.0)), 1.0);
}
@fragment
fn fs_up(i: VOut) -> @location(0) vec4f {
  let t = P.texel;
  let uv = i.uv;
  var s = tap(uv) * 4.0;
  s = s + (tap(uv + t * vec2f(-1.0, 0.0)) + tap(uv + t * vec2f(1.0, 0.0)) + tap(uv + t * vec2f(0.0, -1.0)) + tap(uv + t * vec2f(0.0, 1.0))) * 2.0;
  s = s + tap(uv + t * vec2f(-1.0, -1.0)) + tap(uv + t * vec2f(1.0, -1.0)) + tap(uv + t * vec2f(-1.0, 1.0)) + tap(uv + t * vec2f(1.0, 1.0));
  return vec4f(s / 16.0, 1.0);
}
fn aces(x: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}
fn srgb(c: vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3f(0.0031308));
}
@fragment
fn fs_final(i: VOut) -> @location(0) vec4f {
  let s = textureSampleLevel(src, samp, i.uv, 0.0).rgb;
  let bl = textureSampleLevel(bloom, samp, i.uv, 0.0).rgb;
  var c = (s + bl * P.strength) * P.exposure;
  c = aces(c);
  let q = i.uv - 0.5;
  c = c * (1.0 - P.vig * dot(q, q));
  var o = srgb(c);
  // dither: half an 8-bit step of blue-ish noise against banding
  let n = fract(sin(dot(i.pos.xy, vec2f(12.9898, 78.233))) * 43758.5453);
  o = o + (n - 0.5) / 255.0;
  return vec4f(o, 1.0);
}
