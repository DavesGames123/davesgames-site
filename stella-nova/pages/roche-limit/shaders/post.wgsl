// ============================================================================
//  ROCHE LIMIT  ·  shaders/post.wgsl — bloom and the final image
// ----------------------------------------------------------------------------
//  The scene is HDR (rgba16float). Bloom: a chain of half-size levels.
//    fs_down   13-tap downsample (the Call of Duty filter); level 0 has a
//              soft threshold, so only bright light (the sun, the lit
//              limb, hot grains) blooms
//    fs_up     3x3 tent upsample of the smaller level, added into the
//              larger one
//    fs_final  scene + bloom, exposure, ACES fit, vignette, a little
//              grain, then the sRGB curve (the canvas is bgra8unorm)
//  P.texel = (1/w, 1/h of the source, threshold, knee);
//  P.params = (bloom strength, exposure, vignette, time).
//
//  grep -n targets: "fn fs_down", "fn fs_up", "fn fs_final", "fn aces"
// ============================================================================

struct Post { texel: vec4f, params: vec4f };
@group(0) @binding(0) var<uniform> P: Post;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var bloomTex: texture_2d<f32>;

struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex
fn vs_post(@builtin(vertex_index) vi: u32) -> VOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VOut;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  o.uv = vec2f(0.5 * p[vi].x + 0.5, 0.5 - 0.5 * p[vi].y);
  return o;
}
fn tap(uv: vec2f, o: vec2f) -> vec3f { return textureSampleLevel(src, samp, uv + o * P.texel.xy, 0.0).rgb; }

@fragment
fn fs_down(in: VOut) -> @location(0) vec4f {
  let uv = in.uv;
  let a = tap(uv, vec2f(-2.0, -2.0)); let b = tap(uv, vec2f(0.0, -2.0)); let c = tap(uv, vec2f(2.0, -2.0));
  let d = tap(uv, vec2f(-1.0, -1.0)); let e = tap(uv, vec2f(1.0, -1.0));
  let f = tap(uv, vec2f(-2.0, 0.0)); let g = tap(uv, vec2f(0.0, 0.0)); let h = tap(uv, vec2f(2.0, 0.0));
  let i = tap(uv, vec2f(-1.0, 1.0)); let j = tap(uv, vec2f(1.0, 1.0));
  let k = tap(uv, vec2f(-2.0, 2.0)); let l = tap(uv, vec2f(0.0, 2.0)); let m = tap(uv, vec2f(2.0, 2.0));
  var col = (d + e + i + j) * 0.125 + (a + c + k + m) * 0.03125 + (b + f + h + l) * 0.0625 + g * 0.125;
  if (P.texel.z > 0.0) {
    let br = max(col.r, max(col.g, col.b));
    let knee = P.texel.w;
    var soft = br - P.texel.z + knee;
    soft = clamp(soft, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-5);
    let contrib = max(soft, br - P.texel.z) / max(br, 1e-5);
    col = col * contrib;
  }
  return vec4f(min(col, vec3f(200.0)), 1.0);
}
@fragment
fn fs_up(in: VOut) -> @location(0) vec4f {
  let uv = in.uv;
  var col = tap(uv, vec2f(0.0, 0.0)) * 4.0;
  col = col + (tap(uv, vec2f(-1.0, 0.0)) + tap(uv, vec2f(1.0, 0.0)) + tap(uv, vec2f(0.0, -1.0)) + tap(uv, vec2f(0.0, 1.0))) * 2.0;
  col = col + tap(uv, vec2f(-1.0, -1.0)) + tap(uv, vec2f(1.0, -1.0)) + tap(uv, vec2f(-1.0, 1.0)) + tap(uv, vec2f(1.0, 1.0));
  return vec4f(col / 16.0, 1.0);
}
fn aces(x: vec3f) -> vec3f {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}
fn srgb(c: vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3f(0.0031308));
}
@fragment
fn fs_final(in: VOut) -> @location(0) vec4f {
  let uv = in.uv;
  let sc = textureSampleLevel(src, samp, uv, 0.0).rgb;
  let bl = textureSampleLevel(bloomTex, samp, uv, 0.0).rgb;
  var col = (sc + bl * P.params.x) * P.params.y;
  col = aces(col);
  let q = uv - 0.5;
  col = col * (1.0 - P.params.z * dot(q, q) * 1.6);
  let g = fract(sin(dot(in.pos.xy + vec2f(P.params.w * 61.0, P.params.w * 17.0), vec2f(12.9898, 78.233))) * 43758.5453);
  col = srgb(max(col, vec3f(0.0))) + (g - 0.5) / 255.0;
  return vec4f(col, 1.0);
}
