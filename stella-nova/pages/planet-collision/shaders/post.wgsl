// ============================================================================
//  PLANET COLLISION  ·  shaders/post.wgsl — bloom, exposure and the final image
// ----------------------------------------------------------------------------
//  The scene is HDR (rgba16float). Bloom: a chain of half-size levels.
//    fs_down   13-tap downsample (the Call of Duty filter); level 0 has a
//              soft threshold, so only bright light (the sun, the lit
//              limb, hot grains) blooms
//    fs_up     3x3 tent upsample of the smaller level, added into the
//              larger one
//    cs_expose one workgroup: the luminance-weighted mean luminance of the
//              lit pixels (sum l^2 / sum l on a 64 x 64 grid, the centre
//              weighs more, the sky does not count): the bright parts set
//              it, so a hot core pulls the exposure down before it blows
//              out. Then the exposure moves toward key / mean
//              (held to min..max) at the rate of the frame time
//              (optics.js adaptExposure is the CPU twin)
//    fs_final  scene + bloom, x the adapted exposure x P.params.y, the
//              tone map (fn toneMap, the twin of optics.js toneMap: the
//              ACES fit on the brightest channel with the hue kept,
//              blended toward the per-channel fit near white, then sRGB),
//              vignette, a little grain (the canvas is bgra8unorm)
//  The bloom chain (fs_down, fs_up) is the roche-limit copy.
//  P.texel = (1/w, 1/h of the source, threshold, knee);
//  P.params = (bloom strength, exposure, vignette, time).
//
//  grep -n targets: "fn fs_down", "fn fs_up", "fn fs_final", "fn toneMap",
//  "fn cs_expose"
// ============================================================================

struct Post { texel: vec4f, params: vec4f };
@group(0) @binding(0) var<uniform> P: Post;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var bloomTex: texture_2d<f32>;
@group(0) @binding(4) var<storage, read> expo: array<vec4f>;          // x exposure, y mean lum
// cs_expose (its own layout)
struct Expose { key: f32, lo: f32, hi: f32, rate: f32, litLum: f32, p0: f32, p1: f32, p2: f32 };
@group(0) @binding(5) var hdrIn: texture_2d<f32>;
@group(0) @binding(6) var<storage, read_write> expoRW: array<vec4f>;
@group(0) @binding(7) var<uniform> E: Expose;

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
// optics.js toneMap: the ACES fit (Narkowicz 2015) on the brightest
// channel with the ratios kept, toward the per-channel fit near white
fn aces(x: vec3f) -> vec3f {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}
fn srgb(c: vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3f(0.0031308));
}
const TONE_WHITE: f32 = 0.6;
fn toneMap(c0: vec3f) -> vec3f {
  let c = max(c0, vec3f(0.0));
  let v = max(max(c.x, c.y), max(c.z, 1e-10));
  let y = aces(vec3f(v)).x;
  let w = TONE_WHITE * smoothstep(0.8, 1.0, y);
  return srgb((1.0 - w) * c * (y / v) + w * aces(c));
}
var<workgroup> wsum: array<vec2f, 256>;
@compute @workgroup_size(16, 16)
fn cs_expose(@builtin(local_invocation_index) li: u32, @builtin(local_invocation_id) lid: vec3u) {
  let sz = vec2f(textureDimensions(hdrIn));
  var acc = vec2f(0.0);
  for (var k = 0u; k < 16u; k++) {
    let g = vec2f(f32(lid.x * 4u + (k & 3u)), f32(lid.y * 4u + (k >> 2u))) + 0.5;
    let uv = g / 64.0;
    let c = textureLoad(hdrIn, vec2i(uv * sz), 0).rgb;
    let l = dot(c, vec3f(0.2126, 0.7152, 0.0722));
    if (l > E.litLum) {
      let q = uv - 0.5;
      let w = 1.0 - 1.2 * dot(q, q);
      acc += vec2f(w * l * l, w * l);
    }
  }
  wsum[li] = acc;
  workgroupBarrier();
  for (var st = 128u; st > 0u; st = st >> 1u) {
    if (li < st) { wsum[li] = wsum[li] + wsum[li + st]; }
    workgroupBarrier();
  }
  if (li == 0u) {
    let tot = wsum[0];
    // too few lit pixels: aim at exposure 1
    let mean = select(E.key, tot.x / max(tot.y, 1e-9), tot.y > 0.05);
    let aim = clamp(E.key / max(mean, 1e-6), E.lo, E.hi);
    let prev = expoRW[0].x;
    let next = select(prev + (aim - prev) * E.rate, aim, prev <= 0.0);
    expoRW[0] = vec4f(next, mean, aim, 0.0);
  }
}
@fragment
fn fs_final(in: VOut) -> @location(0) vec4f {
  let uv = in.uv;
  let sc = textureSampleLevel(src, samp, uv, 0.0).rgb;
  let bl = textureSampleLevel(bloomTex, samp, uv, 0.0).rgb;
  var col = (sc + bl * P.params.x) * (P.params.y * expo[0].x);
  col = toneMap(col);
  let q = uv - 0.5;
  col = col * (1.0 - P.params.z * dot(q, q) * 1.6);
  let g = fract(sin(dot(in.pos.xy + vec2f(P.params.w * 61.0, P.params.w * 17.0), vec2f(12.9898, 78.233))) * 43758.5453);
  col = max(col, vec3f(0.0)) + (g - 0.5) / 255.0;
  return vec4f(col, 1.0);
}
