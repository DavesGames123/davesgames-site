// common.wgsl — shared declarations for the City Atlas render shaders.
//
// renderer.js puts this file in front of terrain.wgsl, buildings.wgsl,
// sky.wgsl and tracers.wgsl. It declares bind group 0 (the scene: camera,
// light and the city rasters) and bind group 1 (the overlays: ocean and
// wind fields), and the helpers that every pass uses.
//
// World frame: metres east (x), north (y) and up (z) from the city centre.
// The city rasters are square, row 0 at the south edge (tools/geo.py):
//   inner  half G.grid.x m, G.grid.z cells   outer  half G.grid.y m, G.grid.w cells
// A height texel holds (r) the ground or sea floor height, (g) the surface
// height (water level on water, else r), (b) water fraction.
// The terrain overlay scales every height by G.skyZ.w, the exaggeration E.
// E = 0 is the flat map. Buildings, water, trails and the terrain all use
// the same surfaceZ(), so they stay seated on the same surface at every E.
//
// grep: struct Frame  struct Ov  fn heightAt  fn surfaceZ  fn fogMix  fn ramp  fn shadowAt

struct Frame {
  viewProj: mat4x4f,
  eye: vec4f,        // xyz camera, w time in s
  sun: vec4f,        // xyz unit vector to the sun, w night 0..1
  sunCol: vec4f,     // rgb sun light, w ambient strength
  skyH: vec4f,       // rgb horizon and fog, w fog distance (m)
  skyZ: vec4f,       // rgb zenith, w exaggeration E
  grid: vec4f,       // inner half, outer half, inner cells, outer cells
  res: vec4f,        // px width, px height, device px per CSS px, colour mode (0 height, 1 use)
  terr: vec4f,       // terrain overlay 0..1, contour step m, building radius m, ocean particle mask on
  invViewProj: mat4x4f,
  lightVP: mat4x4f,  // sun shadow map: orthographic, depth 0 near the sun
};

struct Ov {
  ocean: vec4f,      // on 0..1, layer (fractional hour), layers, m/s per unit (inner)
  oceanB: vec4f,     // m/s per unit (outer), colour top m/s, has inner field, 0
  wind: vec4f,       // on 0..1, heat map 0..1, flow-to dir x, dir y
  windB: vec4f,      // fine half m, coarse half m, m/s per lattice unit, slice height m
  windC: vec4f,      // colour top m/s, fine cells, coarse cells, 0
};

@group(0) @binding(0) var<uniform> G: Frame;
@group(0) @binding(1) var linS: sampler;
@group(0) @binding(2) var hIn: texture_2d<f32>;    // rgba32float, inner heights
@group(0) @binding(3) var hOut: texture_2d<f32>;   // rgba32float, outer heights
@group(0) @binding(4) var wIn: texture_2d<f32>;    // r8unorm, inner water fraction (2x the height grid)
@group(0) @binding(5) var wOut: texture_2d<f32>;   // r8unorm, outer water fraction
@group(0) @binding(6) var cIn: texture_2d<u32>;    // r8uint, inner land cover class (WorldCover code)
@group(0) @binding(7) var cOut: texture_2d<u32>;   // r8uint, outer land cover class
@group(0) @binding(8) var shadowMap: texture_depth_2d;   // building depth from the sun
@group(0) @binding(9) var shadowS: sampler_comparison;

@group(1) @binding(0) var<uniform> O: Ov;
@group(1) @binding(1) var windC: texture_2d<f32>;  // coarse lattice macro (ux, uy, rho - 1, solid)
@group(1) @binding(2) var windF: texture_2d<f32>;  // fine lattice macro
@group(1) @binding(3) var seaIn: texture_2d_array<f32>;   // rg8snorm, one layer per hour
@group(1) @binding(4) var seaOut: texture_2d_array<f32>;

const PI = 3.14159265;

fn exag() -> f32 { return G.skyZ.w; }

// Bilinear textureLoad of an rgba32float raster (not filterable) at grid
// coordinates g (cell centres at integer + 0.5).
fn bilin(t: texture_2d<f32>, g: vec2f) -> vec4f {
  let n = vec2i(textureDimensions(t));
  let q = g - 0.5;
  let i = vec2i(floor(q));
  let f = q - floor(q);
  let a = textureLoad(t, clamp(i, vec2i(0), n - 1), 0);
  let b = textureLoad(t, clamp(i + vec2i(1, 0), vec2i(0), n - 1), 0);
  let c = textureLoad(t, clamp(i + vec2i(0, 1), vec2i(0), n - 1), 0);
  let d = textureLoad(t, clamp(i + vec2i(1, 1), vec2i(0), n - 1), 0);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Weight of the inner raster at p: 1 inside, 0 outside, a short blend at the edge.
fn innerW(p: vec2f) -> f32 {
  let e = max(abs(p.x), abs(p.y));
  let cell = 2.0 * G.grid.x / G.grid.z;
  return 1.0 - smoothstep(G.grid.x - 6.0 * cell, G.grid.x - 2.0 * cell, e);
}

// Heights at world xy (metres, not exaggerated): (ground, surface, water, 0).
fn heightAt(p: vec2f) -> vec4f {
  let gi = (p + G.grid.x) / (2.0 * G.grid.x) * G.grid.z;
  let go = (p + G.grid.y) / (2.0 * G.grid.y) * G.grid.w;
  let o = bilin(hOut, go);
  let w = innerW(p);
  if (w <= 0.0) { return o; }
  return mix(o, bilin(hIn, gi), w);
}

// Height of the drawn surface at p, with the exaggeration.
fn surfaceZ(p: vec2f) -> f32 { return heightAt(p).y * exag(); }

// Water fraction at p, filtered (the coast is twice as sharp as the heights).
fn waterAt(p: vec2f) -> f32 {
  let ui = (p + G.grid.x) / (2.0 * G.grid.x);
  let uo = (p + G.grid.y) / (2.0 * G.grid.y);
  let o = textureSampleLevel(wOut, linS, uo, 0.0).r;
  let w = innerW(p);
  if (w <= 0.0) { return o; }
  return mix(o, textureSampleLevel(wIn, linS, ui, 0.0).r, w);
}

fn coverAt(p: vec2f) -> u32 {
  if (innerW(p) > 0.5) {
    let n = vec2i(textureDimensions(cIn));
    let g = vec2i(floor((p + G.grid.x) / (2.0 * G.grid.x) * vec2f(n)));
    return textureLoad(cIn, clamp(g, vec2i(0), n - 1), 0).r;
  }
  let n = vec2i(textureDimensions(cOut));
  let g = vec2i(floor((p + G.grid.y) / (2.0 * G.grid.y) * vec2f(n)));
  return textureLoad(cOut, clamp(g, vec2i(0), n - 1), 0).r;
}

// Distance fog toward the horizon colour. d in metres.
fn fogMix(c: vec3f, d: f32, z: f32) -> vec3f {
  let k = d / max(G.skyH.w, 1.0);
  let f = 1.0 - exp(-k * k * 1.6);
  return mix(c, G.skyH.rgb, clamp(f, 0.0, 1.0));
}

// Ocean current at p in m/s, time-interpolated between hourly layers.
fn oceanAt(p: vec2f) -> vec2f {
  let layers = max(O.ocean.z, 1.0);
  let t = clamp(O.ocean.y, 0.0, layers - 1.0);
  let l0 = i32(floor(t));
  let l1 = min(l0 + 1, i32(layers) - 1);
  let f = t - f32(l0);
  let uo = (p + G.grid.y) / (2.0 * G.grid.y);
  var v = mix(textureSampleLevel(seaOut, linS, uo, l0, 0.0).xy, textureSampleLevel(seaOut, linS, uo, l1, 0.0).xy, f) * O.oceanB.x;
  if (O.oceanB.z > 0.5) {
    let w = innerW(p);
    if (w > 0.0) {
      let ui = (p + G.grid.x) / (2.0 * G.grid.x);
      let vi = mix(textureSampleLevel(seaIn, linS, ui, l0, 0.0).xy, textureSampleLevel(seaIn, linS, ui, l1, 0.0).xy, f) * O.ocean.w;
      v = mix(v, vi, w);
    }
  }
  return v;
}

// Wind at p, from the lattice fields: (east m/s, north m/s, solid 0..1, inside 0..1;
// inside fades to 0 at the rim of the disc of radius windB.y).
fn windAt(p: vec2f) -> vec4f {
  let d = O.wind.zw;
  let s = vec2f(dot(p, d), dot(p, vec2f(-d.y, d.x)));
  let uc = (s + O.windB.y) / (2.0 * O.windB.y);
  let uf = (s + O.windB.x) / (2.0 * O.windB.x);
  var m = textureSampleLevel(windC, linS, uc, 0.0);
  // 1 inside the disc that the turning coarse lattice always covers, fading
  // to 0 at its rim, so no square edge shows at any wind direction
  let rr = length(p) / O.windB.y;
  var inside = 1.0 - smoothstep(0.78, 0.98, rr);
  let ef = max(abs(uf.x - 0.5), abs(uf.y - 0.5));
  if (ef < 0.5) {
    let w = 1.0 - smoothstep(0.44, 0.49, ef);
    m = mix(m, textureSampleLevel(windF, linS, uf, 0.0), w);
  }
  let u = (m.x * d + m.y * vec2f(-d.y, d.x)) * O.windB.z;
  return vec4f(u, m.w, inside);
}

// Speed ramp for the overlays: deep blue, cyan, green, yellow, white.
fn ramp(t: f32) -> vec3f {
  let x = clamp(t, 0.0, 1.0);
  let c0 = vec3f(0.08, 0.16, 0.45);
  let c1 = vec3f(0.10, 0.55, 0.85);
  let c2 = vec3f(0.30, 0.85, 0.65);
  let c3 = vec3f(0.98, 0.86, 0.35);
  let c4 = vec3f(1.00, 0.97, 0.90);
  if (x < 0.25) { return mix(c0, c1, x / 0.25); }
  if (x < 0.5) { return mix(c1, c2, (x - 0.25) / 0.25); }
  if (x < 0.75) { return mix(c2, c3, (x - 0.5) / 0.25); }
  return mix(c3, c4, (x - 0.75) / 0.25);
}

fn hash11(n: u32) -> f32 {
  var x = n;
  x ^= x >> 16u; x *= 0x7feb352du;
  x ^= x >> 15u; x *= 0x846ca68bu;
  x ^= x >> 16u;
  return f32(x & 0xffffffu) / 16777216.0;
}

// Hash of an integer cell (negative cells too) and a salt.
fn hashCell(q: vec3f, salt: u32) -> f32 {
  let a = bitcast<vec3u>(vec3i(q));
  return hash11((a.x * 7919u) ^ (a.y * 104729u) ^ (a.z * 31337u) ^ salt);
}

// Sun shadow of the buildings at a world point, 0 (shadow) .. 1 (lit).
// renderer.js draws the buildings into shadowMap from the sun each frame
// (orthographic over the building disc). Four taps (PCF); the point moves
// 1.5 m along its normal first, so a surface does not shadow itself.
// Off at night, and outside the map.
fn shadowAt(world: vec3f, nrm: vec3f) -> f32 {
  if (G.sun.w > 0.6) { return 1.0; }
  let q = G.lightVP * vec4f(world + nrm * 1.5, 1.0);
  let uv = vec2f(q.x * 0.5 + 0.5, 0.5 - q.y * 0.5);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || q.z > 1.0) { return 1.0; }
  let px = 1.0 / f32(textureDimensions(shadowMap).x);
  let d = q.z - 0.0004;
  var s = 0.0;
  s += textureSampleCompareLevel(shadowMap, shadowS, uv + vec2f(-0.5, -0.5) * px, d);
  s += textureSampleCompareLevel(shadowMap, shadowS, uv + vec2f(0.5, -0.5) * px, d);
  s += textureSampleCompareLevel(shadowMap, shadowS, uv + vec2f(-0.5, 0.5) * px, d);
  s += textureSampleCompareLevel(shadowMap, shadowS, uv + vec2f(0.5, 0.5) * px, d);
  let edge = smoothstep(0.0, 0.04, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
  return mix(1.0, s * 0.25, edge);
}
