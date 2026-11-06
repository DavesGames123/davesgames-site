// ============================================================================
//  COLLAPSE CITY  ·  shaders/common.wgsl — the frame uniform and the sky
// ----------------------------------------------------------------------------
//  gpu.js puts this text in front of city.wgsl and sky.wgsl (WGSL has no
//  include). tests.mjs checks each joined pair with naga.
//
//  Frame (608 bytes; gpu.js "const U_" has the float offsets):
//    viewProj, lightViewProj, invViewProj   mat4x4f
//    camPos      xyz eye (m), w time (s)
//    sunDir      xyz to the sun (or moon), w night 0..1
//    sunColor    rgb linear, w shadow strength
//    skyTop      rgb zenith, w sun disc size
//    skyHorizon  rgb horizon, w focus x (m)
//    groundColor rgb far ground, w ground plane y (m)
//    ambSky      rgb ambient from above, w focus z (m)
//    ambGround   rgb ambient from below
//    anim        x display clock, y drop span (counts), z drop height (m),
//                w shadow texel (m)
//    fog         x start, y end (m, horizontal distance from the focus,
//                the centre of generation), z haze per m, w exposure
//    palette     16 x rgba: rgb linear albedo, a gloss 0..1 (+2 emissive)
//
//  Reversed depth: near = 1, far = 0. The sky draws at depth 0.
//
//  GREP MAP
//    struct Frame ....... the uniform
//    fn skyColor ........ the sky gradient, the sun disc and the haze
//    fn fogMix .......... the distance fog toward the sky at the horizon
//    fn tonemap ......... filmic curve and the sRGB encode
// ============================================================================

struct Frame {
  viewProj: mat4x4f,
  lightViewProj: mat4x4f,
  invViewProj: mat4x4f,
  camPos: vec4f,
  sunDir: vec4f,
  sunColor: vec4f,
  skyTop: vec4f,
  skyHorizon: vec4f,
  groundColor: vec4f,
  ambSky: vec4f,
  ambGround: vec4f,
  anim: vec4f,
  fog: vec4f,
  palette: array<vec4f, 16>,
};

@group(0) @binding(0) var<uniform> frame: Frame;

// The sky in a view direction d (unit). The horizon band is wide and warm
// near the sun, so the fog colour and the sky meet with no seam.
fn skyColor(d: vec3f) -> vec3f {
  let up = clamp(d.y, -1.0, 1.0);
  let h = pow(1.0 - max(up, 0.0), 3.0);
  var c = mix(frame.skyTop.rgb, frame.skyHorizon.rgb, h);
  // under the horizon: fade to the far ground colour
  let below = clamp(-up * 6.0, 0.0, 1.0);
  c = mix(c, frame.skyHorizon.rgb * 0.75 + frame.groundColor.rgb * 0.25, below);
  let s = max(dot(d, normalize(frame.sunDir.xyz)), 0.0);
  let day = 1.0 - frame.sunDir.w;
  // the glow round the sun, wider near the horizon
  c = c + frame.sunColor.rgb * (pow(s, 8.0) * 0.12 + pow(s, 64.0) * 0.25) * (0.4 + 0.6 * day);
  // the disc
  let disc = smoothstep(1.0 - frame.skyTop.w, 1.0 - frame.skyTop.w * 0.6, s);
  c = c + frame.sunColor.rgb * disc * (2.0 + 6.0 * day) * clamp(up * 8.0 + 0.6, 0.0, 1.0);
  return c;
}

// Fog toward the sky colour at the horizon of the view ray. The edge term
// is the horizontal distance from the focus (the centre of generation), and
// it ends at the generation radius, so the edge never shows from any eye
// height. The haze term is the distance from the eye.
fn fogMix(c: vec3f, worldPos: vec3f) -> vec3f {
  let v = worldPos - frame.camPos.xyz;
  let dist = length(v);
  let d = v / max(dist, 0.001);
  let haze = 1.0 - exp(-dist * frame.fog.z);
  let focus = vec2f(frame.skyHorizon.w, frame.ambSky.w);
  let edge = smoothstep(frame.fog.x, frame.fog.y, length(worldPos.xz - focus));
  let f = clamp(max(haze, edge), 0.0, 1.0);
  let fc = skyColor(normalize(vec3f(d.x, max(d.y, 0.0) * 0.35, d.z)));
  return mix(c, fc, f);
}

// ACES fit (Narkowicz), then the sRGB curve: the canvas format is unorm.
fn tonemap(c: vec3f) -> vec3f {
  let x = c * frame.fog.w;
  let m = clamp((x * (2.51 * x + vec3f(0.03))) / (x * (2.43 * x + vec3f(0.59)) + vec3f(0.14)), vec3f(0.0), vec3f(1.0));
  let lo = m * 12.92;
  let hi = 1.055 * pow(m, vec3f(1.0 / 2.4)) - vec3f(0.055);
  return select(hi, lo, m <= vec3f(0.0031308));
}
