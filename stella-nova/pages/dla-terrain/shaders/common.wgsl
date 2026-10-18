// ============================================================================
//  DLA TERRAIN  ·  shaders/common.wgsl — shared GPU state (package CORE)
// ----------------------------------------------------------------------------
//  CORE joins this file + lib/dla-terrain-detail.wgsl in front of every
//  package shader (gpu.loadWGSL(url) returns the joined text). The Globals
//  block is the one in CONTRACT.md, field for field. gpu/globals.js packs
//  it on the CPU; tests/core.test.mjs checks that the two offsets agree.
//
//  CONVENTIONS
//    World units are metres, y up. The terrain covers x, z in
//    [G.terrainOrigin.xy, G.terrainOrigin.xy + G.terrain.x].
//    Height texel (i, j) holds the height at the CENTRE of cell (i, j):
//    x = origin.x + (i + 0.5) * G.terrain.w, with G.terrain.w = size / n.
//    That is the same rule that a linear sampler uses, so tNormal and tAux
//    samples line up with terrainHeight.
//    Reverse-Z: depth32float, clear 0, compare greater, infinite far.
//    The sky is at depth 0. linearDepth(d) gives the view distance in m.
//    The scene target is rgba16float HDR. CORE does exposure and tonemap.
//    G.viewProj holds the TAA jitter. G.prevViewProj is the last frame
//    with no jitter, for reprojection.
//
//  GROUP 2 (CORE owns the sun shadow map)
//    drawOpaque, drawWater and drawVolumetric passes: bindings 0, 1, 2
//      (gpu.shadowSampleLayout, CORE sets the bind group).
//    drawShadow passes: binding 3 only, SP = the cascade of this pass
//      (gpu.shadowPassLayout, CORE sets the bind group per cascade).
//      Write clip = SP.viewProj * world. The shadow map is reverse-Z too:
//      clear 0, compare greater (gpu.shadowDepthState).
//
//  GREP MAP
//    grep -n 'struct Globals'      the per frame uniform
//    grep -n 'struct CascadeInfo'  the cascade matrices and splits
//    grep -n 'struct ShadowPass'   the cascade of one shadow pass
//    grep -n 'fn terrainHeight'    the height in m at a world xz
//    grep -n 'fn sunShadow'        PCF sun shadow, 0 shadow .. 1 lit
//    grep -n 'fn sunShadowSoft'    PCSS sun shadow (blocker search + disc
//                                  PCF), the near-field surfaces use it
//    grep -n 'fn shadowBiasZ'      the receiver bias of a cascade
//    grep -n 'fn linearDepth'      reverse-Z depth to view distance
//    grep -n 'fn worldFromDepth'   a screen uv + depth to a world point
//    grep -n 'fn cm_'              small shared maths (hash, luminance)
// ============================================================================

struct Globals {
  viewProj: mat4x4f, invViewProj: mat4x4f, view: mat4x4f, proj: mat4x4f,
  prevViewProj: mat4x4f,
  camPos: vec4f,        // xyz camera, w time s
  sunDir: vec4f,        // xyz unit toward the sun, w sun illuminance scale
  sunColor: vec4f,      // rgb sun radiance at ground (after atmosphere), w time of day 0..1 (0.5 noon)
  moonDir: vec4f,       // xyz, w moon illuminance scale
  ambient: vec4f,       // rgb sky irradiance (hemisphere), w exposure
  fog: vec4f,           // rgb in-scatter colour, w density per m
  wind: vec4f,          // xy wind direction * speed m/s, z gust 0..1, w wind phase s
  weather: vec4f,       // x cloud cover, y rain, z snow, w lightning flash 0..1
  weather2: vec4f,      // x ground wetness, y snow cover, z storminess, w season 0..1 (0 spring)
  terrain: vec4f,       // x world size m, y height scale m, z sea level m, w texel size m
  terrainOrigin: vec4f, // xy world xz origin, z min height m, w max height m
  screen: vec4f,        // xy size px, zw 1 / size
  frame: vec4f,         // x frame index, y dt s, z quality 0..1, w is coarse pointer
};
@group(0) @binding(0) var<uniform> G: Globals;
@group(0) @binding(1) var tHeight: texture_2d<f32>;   // r32float, metres, textureLoad only
@group(0) @binding(2) var tNormal: texture_2d<f32>;   // rgba16float: xyz normal, w ambient occlusion
@group(0) @binding(3) var tAux: texture_2d<f32>;      // rgba16float: r log flow, g river 0..1, b moisture, a water depth m
@group(0) @binding(4) var tBiome: texture_2d<u32>;    // r8uint biome id (lib BIOMES)
@group(0) @binding(5) var sLinear: sampler;           // linear, clamp

// The sun shadow cascades. viewProj[i] maps a world point to the clip
// space of cascade i (x, y in -1..1, z in 0..1, reverse-Z: 1 is nearest
// the sun). splits[i] is the far view distance (m) of cascade i.
struct CascadeInfo {
  viewProj: array<mat4x4f, 4>,
  splits: vec4f,  // far view distance m of cascades 0..3
  texel: vec4f,   // world size m of one shadow texel per cascade
  params: vec4f,  // x cascade count, y map size px, z depth bias, w normal bias (texels)
  depth: vec4f,   // x depth range m of the light box, y sun disc size (tan), zw 0
};
// One shadow pass draws one cascade.
struct ShadowPass {
  viewProj: mat4x4f,
  info: vec4f,    // x cascade index, y texel m, z cascade count, w map size px
};
@group(2) @binding(0) var tShadow: texture_depth_2d_array;
@group(2) @binding(1) var sShadow: sampler_comparison;   // compare greater-equal, linear
@group(2) @binding(2) var<uniform> cascades: CascadeInfo;
@group(2) @binding(3) var<uniform> SP: ShadowPass;

const CM_PI: f32 = 3.14159265358979;

// ── terrain ─────────────────────────────────────────────────────────────
fn worldToUV(xz: vec2f) -> vec2f { return (xz - G.terrainOrigin.xy) / G.terrain.x; }

fn heightAt(ij: vec2i) -> f32 {
  let n = vec2i(textureDimensions(tHeight));
  return textureLoad(tHeight, clamp(ij, vec2i(0), n - vec2i(1)), 0).r;
}
// The coarse height (manual bilinear: r32float is not filterable).
fn baseHeight(xz: vec2f) -> f32 {
  let n = vec2f(textureDimensions(tHeight));
  let p = worldToUV(xz) * n - vec2f(0.5);
  let i = vec2i(floor(p));
  let f = p - floor(p);
  let a = heightAt(i);
  let b = heightAt(i + vec2i(1, 0));
  let c = heightAt(i + vec2i(0, 1));
  let d = heightAt(i + vec2i(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// The full height: coarse map + the fractal detail of LIB under one texel.
fn terrainHeight(xz: vec2f) -> f32 { return baseHeight(xz) + detailHeight(xz); }
fn terrainNormal(xz: vec2f) -> vec3f {
  let s = textureSampleLevel(tNormal, sLinear, worldToUV(xz), 0.0);
  return normalize(s.xyz + vec3f(0.0, 1e-4, 0.0));
}
fn terrainAO(xz: vec2f) -> f32 { return textureSampleLevel(tNormal, sLinear, worldToUV(xz), 0.0).w; }
fn terrainAux(xz: vec2f) -> vec4f { return textureSampleLevel(tAux, sLinear, worldToUV(xz), 0.0); }
fn biomeAt(xz: vec2f) -> u32 {
  let n = vec2i(textureDimensions(tBiome));
  let ij = clamp(vec2i(floor(worldToUV(xz) * vec2f(n))), vec2i(0), n - vec2i(1));
  return textureLoad(tBiome, ij, 0).r;
}
fn insideTerrain(xz: vec2f) -> bool {
  let uv = worldToUV(xz);
  return all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0));
}

// ── camera and depth ────────────────────────────────────────────────────
// Infinite reverse-Z: depth = near / view distance. G.proj[3][2] is near.
fn linearDepth(d: f32) -> f32 { return G.proj[3][2] / max(d, 1e-9); }
fn worldFromDepth(uv: vec2f, d: f32) -> vec3f {
  let ndc = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, max(d, 1e-9), 1.0);
  let w = G.invViewProj * ndc;
  return w.xyz / w.w;
}
fn viewRay(uv: vec2f) -> vec3f { return normalize(worldFromDepth(uv, 1.0) - G.camPos.xyz); }
fn viewDistance(wp: vec3f) -> f32 { return -(G.view * vec4f(wp, 1.0)).z; }

// ── sun shadow ──────────────────────────────────────────────────────────
fn cascadeOf(viewZ: f32) -> i32 {
  // at most 4 cascades (gpu/shadows.js): the loop has a constant bound
  let n = clamp(i32(cascades.params.x), 1, 4);
  var c = n - 1;
  for (var i = 3; i >= 0; i--) { if ((i < n) && (viewZ < cascades.splits[i])) { c = i; } }
  return c;
}
fn shadowTap(c: i32, wp: vec3f) -> vec4f {
  let q = cascades.viewProj[c] * vec4f(wp, 1.0);
  return vec4f(q.xy * vec2f(0.5, -0.5) + vec2f(0.5), q.z, 1.0);
}
// The receiver bias of cascade c in clip depth: 1.5 texels of the cascade
// (in m) over the depth range of the light box, plus the constant part.
fn shadowBiasZ(c: i32) -> f32 {
  let range = max(cascades.depth.x, 1.0);
  return cascades.params.z + ((cascades.texel[c] * 1.5) / range);
}
// The offset receiver point: along the normal by the normal bias (more at
// grazing sun, where acne starts), and a half texel toward the sun.
fn shadowOffset(wp: vec3f, nrm: vec3f, c: i32) -> vec3f {
  let tx = cascades.texel[c];
  let L = normalize(G.sunDir.xyz);
  let ndl = clamp(dot(nrm, L), 0.0, 1.0);
  return wp + (nrm * (tx * cascades.params.w * (1.0 + (2.0 * (1.0 - ndl))))) + (L * (tx * 0.5));
}
// 0 = in shadow, 1 = lit. wp world point, nrm the surface normal (offset
// along it by the normal bias). 3x3 PCF on the hardware 2x2 compare.
fn sunShadowAt(wp: vec3f, nrm: vec3f, c: i32) -> f32 {
  let tx = cascades.texel[c];
  let p = wp + nrm * (tx * cascades.params.w);
  let s = shadowTap(c, p);
  if (any(s.xy < vec2f(0.0)) || any(s.xy > vec2f(1.0)) || s.z > 1.0) { return 1.0; }
  let zr = s.z + shadowBiasZ(c);
  let px = 1.0 / cascades.params.y;
  var sum = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      sum += textureSampleCompareLevel(tShadow, sShadow, s.xy + vec2f(f32(x), f32(y)) * px, c, zr);
    }
  }
  return sum / 9.0;
}
fn sunShadow(wp: vec3f, nrm: vec3f) -> f32 {
  let n = i32(cascades.params.x);
  if (n <= 0) { return 1.0; }
  let z = viewDistance(wp);
  let c = cascadeOf(z);
  var s = sunShadowAt(wp, nrm, c);
  // blend into the next cascade over the last 10% of this one
  let far = cascades.splits[c];
  let edge = far * 0.9;
  if (c + 1 < n && z > edge) {
    s = mix(s, sunShadowAt(wp, nrm, c + 1), (z - edge) / max(far - edge, 1e-3));
  }
  // past the last cascade the light is not shadowed (fade out)
  return mix(s, 1.0, smoothstep(cascades.splits[n - 1] * 0.9, cascades.splits[n - 1], z));
}

// ── soft sun shadow (PCSS) ───────────────────────────────────────────────
// Percentage-closer soft shadows (Fernando 2005) for the near field.
// 1 blocker search: SOFT_SEARCH texel loads on a golden-angle disc of
//   (sun size x 25 m) round the receiver; no blocker -> lit (early out).
// 2 penumbra: (receiver - mean blocker) m x sun size, in texels of the
//   cascade, clamped to 1 .. SOFT_MAX_R.
// 3 filter: SOFT_TAPS hardware 2x2 compare taps on a golden-angle disc of
//   that radius, turned by the per pixel noise r (0..1; TAA resolves it).
// The cascade choice dithers over the last 10 % of a cascade (one cascade
// a pixel, not two). Cost is constant: 8 loads + 12 compare taps at most.
const SOFT_SEARCH: i32 = 8;
const SOFT_TAPS: i32 = 12;
const SOFT_MAX_R: f32 = 14.0;
const SOFT_REACH: f32 = 25.0;   // m: the highest blocker that the search sees
fn sunShadowSoftAt(wp: vec3f, nrm: vec3f, c: i32, r: f32) -> f32 {
  let tx = cascades.texel[c];
  let s = shadowTap(c, shadowOffset(wp, nrm, c));
  if (any(s.xy < vec2f(0.0)) || any(s.xy > vec2f(1.0)) || s.z > 1.0) { return 1.0; }
  let range = max(cascades.depth.x, 1.0);
  let zr = s.z + shadowBiasZ(c);
  let size = max(cascades.params.y, 1.0);
  let px = 1.0 / size;
  let sunSz = max(cascades.depth.y, 0.002);
  let ang0 = r * 6.2831853;
  // 1 blocker search (texel loads, no filter)
  let searchT = clamp((sunSz * SOFT_REACH) / tx, 1.5, SOFT_MAX_R);
  var bSum = 0.0;
  var bN = 0.0;
  let maxI = vec2i(i32(size) - 1);
  for (var i = 0; i < SOFT_SEARCH; i++) {
    let fi = f32(i);
    let rad = sqrt((fi + 0.5) / f32(SOFT_SEARCH)) * searchT;
    let a = ang0 + (fi * 2.3999632);
    let q = s.xy * size + (vec2f(cos(a), sin(a)) * rad);
    let d = textureLoad(tShadow, clamp(vec2i(floor(q)), vec2i(0), maxI), c, 0);
    if (d > zr) { bSum += d; bN += 1.0; }
  }
  if (bN < 0.5) { return 1.0; }
  // 2 penumbra width in texels
  let distM = max(((bSum / bN) - zr) * range, 0.0);
  let penT = clamp((distM * sunSz) / tx, 1.0, SOFT_MAX_R);
  // 3 the filter
  var sum = 0.0;
  for (var i = 0; i < SOFT_TAPS; i++) {
    let fi = f32(i);
    let rad = sqrt((fi + 0.5) / f32(SOFT_TAPS)) * penT;
    let a = ang0 + 1.3 + (fi * 2.3999632);
    let uv = s.xy + ((vec2f(cos(a), sin(a)) * rad) * px);
    sum += textureSampleCompareLevel(tShadow, sShadow, uv, c, zr);
  }
  return sum / f32(SOFT_TAPS);
}
// fc = the fragment position (px) for the noise
fn sunShadowSoft(wp: vec3f, nrm: vec3f, fc: vec2f) -> f32 {
  let n = i32(cascades.params.x);
  if (n <= 0) { return 1.0; }
  let z = viewDistance(wp);
  var c = cascadeOf(z);
  let r = fract(cm_ign(fc) + (G.frame.x * 0.6180339));
  let far = cascades.splits[c];
  let edge = far * 0.9;
  if ((c + 1 < n) && (z > edge)) {
    let k = (z - edge) / max(far - edge, 1e-3);
    if (fract(r * 7.13 + 0.37) < k) { c = c + 1; }
  }
  let s = sunShadowSoftAt(wp, nrm, c, r);
  let lastF = cascades.splits[n - 1];
  return mix(s, 1.0, smoothstep(lastF * 0.9, lastF, z));
}

// ── small shared maths (prefix cm_ so that packages do not collide) ─────
fn cm_luminance(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
fn cm_hash12(p: vec2f) -> f32 {
  var q = fract(vec3f(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
fn cm_hash22(p: vec2f) -> vec2f {
  var q = fract(vec3f(p.xyx) * vec3f(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}
// interleaved gradient noise (Jimenez 2014), for dither in screen space
fn cm_ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }
