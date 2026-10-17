// ============================================================================
//  DLA TERRAIN  ·  ground.wgsl — the terrain surface (GROUND package)
//  CORE joins shaders/common.wgsl + lib/dla-terrain-detail.wgsl in front.
// ----------------------------------------------------------------------------
//  MESH  CDLOD (Strugar 2010). render/ground.js selects quadtree nodes on the
//  CPU and draws one instanced grid patch per node. Instance a = (x0, z0,
//  size, grid N), b = (morph start, morph end, level, 0). The vertex shader
//  lifts each grid vertex by terrainHeight(), then morphs the odd vertices
//  onto their even neighbours as the LOD distance goes from morph start
//  to morph end. At morph end a patch has the vertices of the next coarser
//  level, so neighbour patches of two levels meet with no crack and no pop.
//
//  MATERIAL  eight layers: rock, cliff, grass, forest floor, sand, snow,
//  mud, gravel. Base weights come from the biome texture (bilinear of the
//  four nearest ids, so cells do not show), then rules move them by slope,
//  height, moisture, flow and the river mask. The layers blend by height
//  (each layer has a height field; the higher one shows through at the
//  edges). The procedural layers are 3D noise of the world position with
//  analytic gradients, so cliffs do not stretch and the bump needs one
//  noise call. Each octave fades out when it gets smaller than two pixels
//  (no shimmer); far terrain falls to the layer mean plus a macro colour.
//  When ASSETS lists ground textures (assets/nature/manifest.json, kind
//  "ground texture"), ground.js loads them into texture arrays and the
//  layers sample them (triplanar on rock and cliff), tinted by the same
//  macro terms. Weather: wet darkening and puddles in low ground from
//  G.weather2.x and near water, rain ripples from G.weather.y, snow cover
//  from G.weather2.y with height, slope and aspect.
//
//  LIGHT  sun (GGX + Lambert) with CORE's cascaded shadow map (common.wgsl
//  fn sunShadow, group 2) and
//  a height-field march toward the sun for long ridge shadows past the
//  cascades; moon; hemisphere sky ambient G.ambient with tNormal.w ambient
//  occlusion; sky reflection on wet rock, puddles and snow; aerial
//  perspective from G.fog with height falloff and a sun lobe.
//
//  Sources (ideas and maths, our own code; see the paths):
//    pages/city-atlas/shaders/terrain.wgsl   grid patch from vertex_index,
//                                            cell jitter of class colours
//    pages/forge/shaders/planet.wgsl         fn terrainShadow (march toward
//                                            the sun), shore wet sand
//    pages/forge/rocky.js                    the biome macro colours
//    pages/lighting-table/shaders/pack.wgsl  GGX, Smith G, Schlick
//    pages/noise-table, pages/sampling-table value noise and footprint fade
//    pages/sdf-solids-table/shaders/pack.wgsl pcg hash family
//  Literature: Strugar 2010 (CDLOD); Quilez (value noise with analytic
//  derivatives); Lagarde 2013 (wet surfaces); Mikkelsen 2020 (surface
//  gradient bump); Hillaire 2020 (aerial perspective idea).
//
//  grep -n targets: "struct GroundU", "fn vs", "fn vsShadow", "fn vnoised",
//  "fn fbmd", "fn biomeMix", "fn layerRock", "fn layerGrass", "fn layerSand",
//  "fn layerGravel", "fn marchShadow", "fn aerial", "fn fs"
// ============================================================================

struct GroundU {
  lod: vec4f,     // x grid N (full patch), y LOD 0 range m, z level count, w detail pad m
  mat: vec4f,     // x textures on (0/1), y meadow set layer (255: none), z debug view, w quality 0..1
  shadow: vec4f,  // x aerial perspective on (0/1), y height march on (0/1), z march length m, w cloud shadow on (0/1)
  misc: vec4f,    // x time s, y min height m, z terrain top m (max + pad, LOD metric), w ripple strength
  tiles: array<vec4f, 4>,  // tile size m of texture array layer k: tiles[k / 4][k % 4]
  map: array<vec4f, 4>,    // [0..7] primary layer of logical layer l, [8..15] alternate (255: none)
  cloud: vec4f,   // SKY cloud shadow: xy rect origin (world xz), z rect size m, w cloud base y m
};
@group(1) @binding(0) var<uniform> U: GroundU;
@group(1) @binding(1) var tLayerAlb: texture_2d_array<f32>;  // ASSETS ground sets, rgba8unorm-srgb
@group(1) @binding(2) var tLayerNrm: texture_2d_array<f32>;  // rgba8unorm, OpenGL normal (+y)
@group(1) @binding(3) var tLayerOrm: texture_2d_array<f32>;  // r AO, g roughness, b height
@group(1) @binding(4) var sRepeat: sampler;                  // linear, repeat, anisotropic
@group(1) @binding(5) var tCloudSh: texture_2d<f32>;         // SKY module.cloudShadow.view (r: sun transmittance)
@group(1) @binding(6) var sCloudSh: sampler;

const GPI: f32 = 3.14159265;

// Layer ids
const L_ROCK: u32 = 0u;
const L_CLIFF: u32 = 1u;
const L_GRASS: u32 = 2u;
const L_FOREST: u32 = 3u;
const L_SAND: u32 = 4u;
const L_SNOW: u32 = 5u;
const L_MUD: u32 = 6u;
const L_GRAVEL: u32 = 7u;

// ---------------------------------------------------------------- vertex --

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) level: f32,
  @location(2) morph: f32,
};

struct Inst {
  @location(0) a: vec4f,   // x0, z0, size, grid N
  @location(1) b: vec4f,   // morph start, morph end, level, 0
};

fn worldClamp(xz: vec2f) -> vec2f {
  let o = G.terrainOrigin.xy;
  return clamp(xz, o, o + vec2f(G.terrain.x));
}

// The morphed vertex: xz (world), morph factor.
fn cdlodVertex(vid: u32, inst: Inst) -> vec3f {
  let n = u32(inst.a.w);
  let gi = vec2f(f32(vid % (n + 1u)), f32(vid / (n + 1u)));
  let spacing = inst.a.z / inst.a.w;
  let xz0 = inst.a.xy + gi * spacing;
  // LOD distance: horizontal, plus the camera height over the terrain top
  // (U.misc.z); ground.js lodDistance is the twin
  let dy = max(G.camPos.y - U.misc.z, 0.0);
  let dxz = G.camPos.xz - xz0;
  let d = sqrt(dot(dxz, dxz) + (dy * dy));
  let k = clamp((d - inst.b.x) / max(inst.b.y - inst.b.x, 1e-3), 0.0, 1.0);
  let fr = fract(gi * 0.5) * 2.0;
  let xz = worldClamp(xz0 - (fr * spacing) * k);
  return vec3f(xz, k);
}

@vertex
fn vs(@builtin(vertex_index) vid: u32, inst: Inst) -> VOut {
  let m = cdlodVertex(vid, inst);
  let h = terrainHeight(m.xy);
  var o: VOut;
  o.world = vec3f(m.x, h, m.y);
  o.pos = G.viewProj * vec4f(o.world, 1.0);
  o.level = inst.b.z;
  o.morph = m.z;
  return o;
}

// Shadow pass: CORE sets group 2 = SP, the cascade of this pass.
@vertex
fn vsShadow(@builtin(vertex_index) vid: u32, inst: Inst) -> @builtin(position) vec4f {
  let m = cdlodVertex(vid, inst);
  let h = terrainHeight(m.xy);
  return SP.viewProj * vec4f(m.x, h, m.y, 1.0);
}

// ----------------------------------------------------------------- noise --

fn pcg3(v0: vec3u) -> vec3u {
  var v = (v0 * 1664525u) + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v = v ^ (v >> vec3u(16u));
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
// scalar PCG on a mixed key: a quarter of the work of pcg3 when one value
// is all that is needed (value noise)
fn pcg1(v: u32) -> u32 {
  let st = (v * 747796405u) + 2891336453u;
  let w = ((st >> ((st >> 28u) + 4u)) ^ st) * 277803737u;
  return (w >> 22u) ^ w;
}
fn hash31(p: vec3i) -> f32 {
  let q = bitcast<vec3u>(p);
  return f32(pcg1((q.x * 73856093u) ^ (q.y * 19349663u) ^ (q.z * 83492791u))) * (1.0 / 4294967296.0);
}
fn hash21(p: vec2i, k: u32) -> f32 {
  let q = bitcast<vec2u>(p);
  return f32(pcg1((q.x * 73856093u) ^ (q.y * 19349663u) ^ (k * 83492791u))) * (1.0 / 4294967296.0);
}
fn hash33(p: vec3i) -> vec3f { return vec3f(pcg3(bitcast<vec3u>(p))) * (1.0 / 4294967296.0); }
fn hash22(p: vec2i) -> vec2f { return hash33(vec3i(p, 917)).xy; }

// Value noise with its analytic gradient (Quilez): x value in -1..1, yzw d/dp.
fn vnoised(x: vec3f) -> vec4f {
  let fl = floor(x);
  let i = vec3i(fl);
  let w = x - fl;
  let u = w * w * w * (w * (w * 6.0 - 15.0) + 10.0);
  let du = 30.0 * w * w * (w * (w - 2.0) + 1.0);
  let a = hash31(i);
  let b = hash31(i + vec3i(1, 0, 0));
  let c = hash31(i + vec3i(0, 1, 0));
  let d = hash31(i + vec3i(1, 1, 0));
  let e = hash31(i + vec3i(0, 0, 1));
  let f = hash31(i + vec3i(1, 0, 1));
  let g = hash31(i + vec3i(0, 1, 1));
  let h = hash31(i + vec3i(1, 1, 1));
  let k1 = b - a; let k2 = c - a; let k3 = e - a;
  let k4 = a - b - c + d; let k5 = a - c - e + g; let k6 = a - b - e + f;
  let k7 = -a + b + c - d + e - f - g + h;
  let v = a + (k1 * u.x) + (k2 * u.y) + (k3 * u.z) + (k4 * u.x * u.y) + (k5 * u.y * u.z) + (k6 * u.z * u.x) + (k7 * u.x * u.y * u.z);
  let dv = du * vec3f(k1 + (k4 * u.y) + (k6 * u.z) + (k7 * u.y * u.z),
                      k2 + (k5 * u.z) + (k4 * u.x) + (k7 * u.z * u.x),
                      k3 + (k6 * u.x) + (k5 * u.y) + (k7 * u.x * u.y));
  return vec4f(v * 2.0 - 1.0, dv * 2.0);
}

// 2D value noise (cheap macro terms, no gradient)
fn vnoise2(p: vec2f) -> f32 {
  let fl = floor(p);
  let i = vec2i(fl);
  let f = p - fl;
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash21(i, 3u);
  let b = hash21(i + vec2i(1, 0), 3u);
  let c = hash21(i + vec2i(0, 1), 3u);
  let d = hash21(i + vec2i(1, 1), 3u);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}
fn fbm2(p0: vec2f, oct: i32) -> f32 {
  var p = p0; var a = 0.5; var s = 0.0;
  for (var i = 0; i < oct; i++) {
    s += a * vnoise2(p);
    p = vec2f((p.x * 1.6) - (p.y * 1.2), (p.x * 1.2) + (p.y * 1.6)) + vec2f(17.3, 9.1);
    a *= 0.5;
  }
  return s;
}

// fbm with gradient. freq in 1/m, fp the pixel footprint in m. An octave
// fades out between 4 and 2 pixels per wavelength. Returns (value, grad).
fn fbmd(p: vec3f, freq: f32, oct: i32, gain: f32, fp: f32) -> vec4f {
  var f = freq; var a = 1.0; var s = vec4f(0.0); var norm = 0.0;
  for (var i = 0; i < oct; i++) {
    let fade = 1.0 - smoothstep(0.25, 0.5, f * fp);
    if (fade <= 0.0) { break; }
    let n = vnoised((p * f) + vec3f(f32(i) * 13.7, f32(i) * 7.3, f32(i) * 3.1));
    s += vec4f(n.x, n.yzw * f) * (a * fade);
    norm += a;
    f *= 2.03; a *= gain;
  }
  return s / max(norm, 1e-4);
}

// Voronoi on xz: x distance to the nearest site / cell, yz site offset, w cell hash
fn voronoi2(p: vec2f) -> vec4f {
  let fl = floor(p);
  let i = vec2i(fl);
  let f = p - fl;
  var best = vec4f(8.0, 0.0, 0.0, 0.0);
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let c = vec2i(x, y);
      let h = hash22(i + c);
      let r = vec2f(c) + (h * 0.8 + 0.1) - f;
      let d = dot(r, r);
      if (d < best.x) { best = vec4f(d, r, hash33(vec3i(i + c, 41)).x); }
    }
  }
  best.x = sqrt(best.x);
  return best;
}

// ------------------------------------------------------------ sampling --

fn gUV(xz: vec2f) -> vec2f { return (xz - G.terrainOrigin.xy) / G.terrain.x; }

fn auxAt(xz: vec2f) -> vec4f { return textureSampleLevel(tAux, sLinear, gUV(xz), 0.0); }
fn nrmAt(xz: vec2f) -> vec4f { return textureSampleLevel(tNormal, sLinear, gUV(xz), 0.0); }

// Base height (no detail): bilinear of tHeight. Used by the shadow march.
fn baseH(xz: vec2f) -> f32 {
  let n = vec2i(textureDimensions(tHeight));
  let g = (gUV(xz) * vec2f(n)) - 0.5;
  let fl = floor(g);
  let i = vec2i(fl);
  let f = g - fl;
  let a = textureLoad(tHeight, clamp(i, vec2i(0), n - 1), 0).r;
  let b = textureLoad(tHeight, clamp(i + vec2i(1, 0), vec2i(0), n - 1), 0).r;
  let c = textureLoad(tHeight, clamp(i + vec2i(0, 1), vec2i(0), n - 1), 0).r;
  let d = textureLoad(tHeight, clamp(i + vec2i(1, 1), vec2i(0), n - 1), 0).r;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// --------------------------------------------------------------- biomes --
// lib BIOMES ids: 0 ocean, 1 beach, 2 desert, 3 savanna, 4 grassland,
// 5 temperate forest, 6 rainforest, 7 boreal forest, 8 tundra, 9 bare rock,
// 10 snow, 11 wetland, 12 river, 13 lake, 14 scree, 15 alpine meadow.

struct BW { w0: vec4f, w1: vec4f, grass: vec3f, litter: vec3f, kind: vec2f };
// kind: x boreal (pine floor), y desert (cracked dry ground)
// w0 = rock, cliff, grass, forest floor; w1 = sand, snow, mud, gravel

fn biomeBase(id: u32) -> BW {
  var b: BW;
  b.w0 = vec4f(0.0, 0.0, 1.0, 0.0); b.w1 = vec4f(0.0);
  b.grass = vec3f(0.092, 0.118, 0.044); b.litter = vec3f(0.090, 0.068, 0.042);
  b.kind = vec2f(0.0);
  switch (id) {
    case 0u: { b.w0 = vec4f(0.1, 0.0, 0.0, 0.0); b.w1 = vec4f(0.7, 0.0, 0.35, 0.2); }
    case 1u: { b.w0 = vec4f(0.0); b.w1 = vec4f(1.0, 0.0, 0.0, 0.08); }
    case 2u: { b.w0 = vec4f(0.18, 0.0, 0.0, 0.0); b.w1 = vec4f(1.0, 0.0, 0.0, 0.25); b.kind = vec2f(0.0, 1.0);
               b.grass = vec3f(0.30, 0.22, 0.11); }
    case 3u: { b.w0 = vec4f(0.04, 0.0, 0.85, 0.0); b.w1 = vec4f(0.30, 0.0, 0.0, 0.05);
               b.grass = vec3f(0.26, 0.205, 0.085); }
    case 4u: { b.w0 = vec4f(0.0, 0.0, 1.0, 0.0); b.w1 = vec4f(0.0, 0.0, 0.04, 0.02);
               b.grass = vec3f(0.098, 0.128, 0.043); }
    case 5u: { b.w0 = vec4f(0.0, 0.0, 0.35, 1.0); b.w1 = vec4f(0.0, 0.0, 0.08, 0.0);
               b.grass = vec3f(0.068, 0.100, 0.034); b.litter = vec3f(0.105, 0.070, 0.038); }
    case 6u: { b.w0 = vec4f(0.0, 0.0, 0.30, 1.0); b.w1 = vec4f(0.0, 0.0, 0.22, 0.0);
               b.grass = vec3f(0.048, 0.098, 0.028); b.litter = vec3f(0.070, 0.062, 0.032); }
    case 7u: { b.w0 = vec4f(0.05, 0.0, 0.25, 1.0); b.w1 = vec4f(0.0, 0.0, 0.05, 0.05);
               b.grass = vec3f(0.080, 0.105, 0.045); b.litter = vec3f(0.085, 0.072, 0.050); b.kind = vec2f(1.0, 0.0); }
    case 8u: { b.w0 = vec4f(0.25, 0.0, 0.7, 0.0); b.w1 = vec4f(0.0, 0.0, 0.10, 0.25);
               b.grass = vec3f(0.150, 0.130, 0.072); }
    case 9u: { b.w0 = vec4f(1.0, 0.0, 0.0, 0.0); b.w1 = vec4f(0.0, 0.0, 0.0, 0.3); }
    case 10u: { b.w0 = vec4f(0.1, 0.0, 0.0, 0.0); b.w1 = vec4f(0.0, 1.0, 0.0, 0.0); }
    case 11u: { b.w0 = vec4f(0.0, 0.0, 0.6, 0.0); b.w1 = vec4f(0.0, 0.0, 1.0, 0.0);
                b.grass = vec3f(0.090, 0.130, 0.045); }
    case 12u: { b.w0 = vec4f(0.0, 0.0, 0.6, 0.0); b.w1 = vec4f(0.1, 0.0, 0.6, 0.25); }
    case 13u: { b.w0 = vec4f(0.0); b.w1 = vec4f(0.35, 0.0, 1.0, 0.3); }
    case 14u: { b.w0 = vec4f(0.4, 0.0, 0.0, 0.0); b.w1 = vec4f(0.0, 0.0, 0.0, 1.0); }
    case 15u: { b.w0 = vec4f(0.15, 0.0, 1.0, 0.0); b.w1 = vec4f(0.0, 0.0, 0.0, 0.1);
                b.grass = vec3f(0.108, 0.130, 0.050); }
    default: {}
  }
  return b;
}

// Bilinear mix of the four nearest biome ids. The lookup point is jittered
// by noise, so the texel grid does not show as straight edges.
fn biomeMix(xz: vec2f) -> BW {
  let n = vec2i(textureDimensions(tBiome));
  let tex = G.terrain.x / f32(n.x);
  let j = vec2f(fbm2(xz / (tex * 2.3), 2), fbm2((xz / (tex * 2.3)) + 31.7, 2)) * (tex * 0.9);
  let g = (gUV(xz + j) * vec2f(n)) - 0.5;
  let fl = floor(g);
  let i = vec2i(fl);
  let f = g - fl;
  var r: BW;
  r.w0 = vec4f(0.0); r.w1 = vec4f(0.0); r.grass = vec3f(0.0); r.litter = vec3f(0.0); r.kind = vec2f(0.0);
  for (var k = 0; k < 4; k++) {
    let o = vec2i(k & 1, k >> 1u);
    let id = textureLoad(tBiome, clamp(i + o, vec2i(0), n - 1), 0).r;
    let wx = select(1.0 - f.x, f.x, o.x == 1);
    let wy = select(1.0 - f.y, f.y, o.y == 1);
    let w = wx * wy;
    let b = biomeBase(id);
    r.w0 += b.w0 * w; r.w1 += b.w1 * w; r.grass += b.grass * w; r.litter += b.litter * w; r.kind += b.kind * w;
  }
  return r;
}

// Season tint for living plants: 0 spring, 0.25 summer, 0.5 autumn, 0.75 winter.
fn seasonGrass(c: vec3f, season: f32, dry: f32) -> vec3f {
  let s = fract(season);
  let autumn = smoothstep(0.30, 0.50, s) * (1.0 - smoothstep(0.62, 0.75, s));
  let winter = smoothstep(0.58, 0.75, s) * (1.0 - smoothstep(0.92, 1.0, s));
  let spring = 1.0 - smoothstep(0.0, 0.18, s) + smoothstep(0.94, 1.0, s);
  var g = c;
  g = mix(g, g * vec3f(1.15, 1.18, 0.85), spring * 0.5);
  g = mix(g, vec3f(0.24, 0.17, 0.065), clamp(autumn * 0.6 + dry * 0.55, 0.0, 1.0));
  g = mix(g, vec3f(0.135, 0.115, 0.075), winter * 0.7);
  return g;
}

// ------------------------------------------------------ macro erosion --
// Noise stretched down the slope. A frame that turns with the local
// downhill direction is not usable: dot(p.xz, across) moves by metres per
// degree of turn far from the origin, which drew swirls. So four fields
// in fixed directions (0, 45, 90, 135 deg) are blended by how well each
// one lines up with the downhill direction. f: 1 / wavelength across,
// st: stretch along. Returns (value, d/dp).
fn streakNoise(p: vec3f, down: vec2f, f: f32, st: f32, seed: f32) -> vec4f {
  var acc = vec4f(0.0);
  var ws = 0.0;
  // the two fixed directions on each side of the downhill line (an axis:
  // angle mod pi), blended smoothly
  var a0 = atan2(down.y, down.x);
  a0 = a0 - (floor(a0 / 3.14159265) * 3.14159265);
  let fk = a0 / 0.78539816;
  let k0 = floor(fk);
  let tb = smoothstep(0.0, 1.0, fk - k0);
  for (var j = 0; j < 2; j++) {
    let kk = k0 + f32(j);
    let k = i32(kk) % 4;
    // the angle of the wrapped index: k = 4 is the same field as k = 0
    let ang = f32(k) * 0.78539816;
    let d = vec2f(cos(ang), sin(ang));
    let w = select(1.0 - tb, tb, j == 1);
    if (w < 0.01) { continue; }
    let a = vec2f(-d.y, d.x);
    let q = vec3f(dot(p.xz, a) * f, dot(p.xz, d) * f * st, (p.y * f * 0.25) + seed + (f32(k) * 5.3));
    let n = vnoised(q);
    let gxz = (a * (n.y * f)) + (d * (n.z * f * st));
    acc += vec4f(n.x, gxz.x, n.w * f * 0.25, gxz.y) * w;
    ws += w;
  }
  return acc / max(ws, 1e-4);
}

// Gullies and spurs on steep ground, in metres, at every distance: ridged
// streak noise (crests where |n| is small). Returns the slope (dh/dx,
// dh/dz) to add to the ground, faded per octave by the footprint.
fn macroErosion(p: vec3f, down: vec2f, steep: f32, fp: f32) -> vec2f {
  if (steep <= 0.0) { return vec2f(0.0); }
  var g = vec2f(0.0);
  var wl = 90.0;
  var amp = 26.0;
  let octs = select(3, 1, U.mat.w < 0.45);
  for (var i = 0; i < 3; i++) {
    if (i >= octs) { break; }
    let fade = 1.0 - smoothstep(wl * 0.12, wl * 0.3, fp);
    if (fade <= 0.0) { break; }
    let n = streakNoise(p, down, 1.0 / wl, 0.12, f32(i) * 17.1);
    // smooth |n| = sqrt(n^2 + e): a hard sign() draws crease lines
    let s = -(n.x / sqrt((n.x * n.x) + 0.04));
    g += vec2f(n.y, n.w) * (s * amp * fade);
    wl *= 0.42; amp *= 0.42;
  }
  return g * steep;
}

// --------------------------------------------------------------- layers --

struct Mat { alb: vec3f, h: vec4f, rough: f32, tn: vec3f, ao: f32 };
// h: x height 0..1, yzw gradient (1/m); tn: texture normal offset (world, in
// the tangent plane); ao: texture occlusion

// 3D Worley: x F1, y F2 (distances in cells), and the gradient of F2 - F1
// (in cells), for crack lines between blocks.
struct Cell3 { f1: f32, f2: f32, g: vec3f, id: f32 };
fn worley3(p: vec3f) -> Cell3 {
  let fl = floor(p);
  let i = vec3i(fl);
  let f = p - fl;
  var d1 = 9.0; var d2 = 9.0;
  var r1 = vec3f(0.0); var r2 = vec3f(0.0);
  var id = 0.0;
  for (var z = -1; z <= 1; z++) {
    for (var y = -1; y <= 1; y++) {
      for (var x = -1; x <= 1; x++) {
        let c = vec3i(x, y, z);
        let h = hash33(i + c);
        let r = vec3f(c) + h - f;
        let d = dot(r, r);
        if (d < d1) { d2 = d1; r2 = r1; d1 = d; r1 = r; id = h.x; }
        else if (d < d2) { d2 = d; r2 = r; }
      }
    }
  }
  var o: Cell3;
  o.f1 = sqrt(d1); o.f2 = sqrt(d2); o.id = id;
  // d|p - c|/dp = (p - c) / |p - c| = -r / |r|
  o.g = (-r2 / max(o.f2, 1e-4)) - (-r1 / max(o.f1, 1e-4));
  return o;
}

// Rock: jointed blocks (3D Worley cracks), bedding ledges on cliffs,
// gullies down the slope, lichen in moist air. region: x granite / gneiss,
// y sandstone (deserts), z basalt. down: the downhill direction (xz).
fn layerRock(p: vec3f, fp: f32, cliff: f32, moist: f32, region: vec3f, down: vec2f, slope: f32) -> Mat {
  var m: Mat;
  let big = fbmd(p, 0.07, 3, 0.5, fp);
  // grain: 4 octaves with the ASSETS textures on (they bring the fine grain)
  let fine = fbmd(p, 0.9, select(6, 4, U.mat.x > 0.5), 0.5, fp);
  // one mid-scale field for the mottle, the lichen and the weathering
  let midN = fbmd(p, 0.3, 3, 0.55, fp).x;
  // plain fbm for the grain (a ridged |n| drew worm lines all over)
  let ridged = fine.x * 0.5 + 0.5;
  var h = 0.42 + (0.24 * big.x) + (0.16 * fine.x);
  var g = (big.yzw * 0.24) + (fine.yzw * 0.16);
  // joints: blocks 2.5..5 m, cracks fade out past ~1 m footprint
  // joints: big blocks, only some joints open (a noise mask), so the rock
  // does not read as paving
  let bs = mix(9.0, 5.0, cliff);
  let wq = (p / bs) + vec3f(big.x * 0.6, big.x * 0.3, -big.x * 0.5);
  let open = smoothstep(-0.05, 0.35, fbm2((p.xz * 0.11) + (p.y * 0.07), 3) + (cliff * 0.25));
  let fadeJ = (1.0 - smoothstep(0.08 * bs, 0.3 * bs, fp)) * open;
  // the 27-cell Worley only where joints show
  var cw: Cell3;
  cw.f1 = 0.0; cw.f2 = 1.0; cw.g = vec3f(0.0); cw.id = 0.5;
  if (fadeJ > 0.001) { cw = worley3(wq * vec3f(1.0, mix(1.0, 1.6, cliff), 1.0)); }
  let edge = cw.f2 - cw.f1;
  let cwid = 0.07;
  let crack = (1.0 - smoothstep(0.0, cwid, edge)) * fadeJ;
  let dcrack = -select(0.0, 1.0 / cwid, edge < cwid) * fadeJ;
  h -= crack * 0.38;
  g -= (cw.g / bs) * (dcrack * 0.38) * vec3f(1.0, mix(1.0, 1.8, cliff), 1.0);
  // block faces tilt a little each (the joints are not flat)
  let tilt = (hash33(vec3i(i32(cw.id * 7919.0), 3, 5)) - 0.5) * 0.25 * fadeJ;
  g += tilt / bs;
  // bedding ledges on cliffs: a step every ledge metres in y
  let lh = 5.5;
  let warpY = (big.x * 4.0) + (fbm2(p.xz * 0.01, 2) * 6.0);
  let sy = (p.y + warpY) / lh;
  let fr = fract(sy);
  let fadeL = (1.0 - smoothstep(0.2 * lh, 0.6 * lh, fp)) * cliff * smoothstep(0.5, 0.7, slope) * mix(0.12, 1.0, region.y);
  let step = smoothstep(0.62, 0.92, fr);
  h += (step - 0.5) * 0.3 * fadeL;
  let dstep = select(0.0, 6.0 * (fr - 0.62) * (0.92 - fr) / (0.3 * 0.3 * 0.3), (fr > 0.62) && (fr < 0.92));
  g += vec3f(0.0, (dstep / lh) * 0.3 * fadeL, 0.0);
  // gullies: streaks down the slope, a few metres apart (seen from afar)
  let gu = streakNoise(p, down, 0.06, 0.12, 3.7).x;
  let fadeG = 1.0 - smoothstep(1.5, 5.0, fp * 0.35);
  let gully = smoothstep(0.1, 0.7, gu) * (0.4 + (0.6 * cliff)) * fadeG;
  m.h = vec4f(clamp(h, 0.0, 1.0), g);
  // colour: strata bands fade with the footprint (no stripes far away)
  // strata show on steep faces only (on gentle ground the bands would
  // trace the contour lines)
  let strat = smoothstep(0.5, 0.7, slope) * mix(0.2, 1.0, region.y);
  let bandA = (1.0 - smoothstep(1.5, 4.0, fp)) * strat;
  let band = mix(0.5, sin((p.y + warpY) * 0.55) * 0.5 + 0.5, bandA);
  let mott = (big.x * 0.6) + (midN * 0.4) + 0.5;
  let band2 = mix(mott, sin((p.y + warpY * 1.7) * 1.3) * 0.5 + 0.5, (1.0 - smoothstep(0.5, 1.5, fp)) * strat * 0.7);
  let blockTint = mix(0.92, 1.08, cw.id);
  let granite = mix(vec3f(0.155, 0.150, 0.142), vec3f(0.235, 0.226, 0.212), band2) * mix(1.0, blockTint, fadeJ);
  let sandst = mix(vec3f(0.290, 0.150, 0.080), vec3f(0.400, 0.255, 0.150), band) * mix(1.0, blockTint, fadeJ);
  let basalt = mix(vec3f(0.060, 0.058, 0.056), vec3f(0.095, 0.088, 0.080), band2);
  var c = (granite * region.x) + (sandst * region.y) + (basalt * region.z);
  c = mix(c, c * mix(0.88, 1.1, band), cliff * 0.6);
  // water stains and desert varnish run down the cliffs
  let streak = vnoised(vec3f(p.x * 0.8, p.y * 0.05, p.z * 0.8)).x;
  c *= 1.0 - (cliff * 0.30 * smoothstep(0.1, 0.8, streak));
  c *= 1.0 - (gully * 0.35);
  // lichen: grey-green and ochre crusts on the block tops
  let lichN = (midN * 0.8) + (fine.x * 0.3);
  let lich = smoothstep(0.1, 0.55, lichN + (moist - 0.45)) * (1.0 - crack);
  c = mix(c, mix(vec3f(0.16, 0.17, 0.11), vec3f(0.30, 0.25, 0.10), smoothstep(0.3, 0.7, lichN)), lich * 0.4 * (1.0 - (region.y * 0.8)));
  // cracks dark, block tops a little lighter
  // weathering: tone patches at 1..6 m, so a face is not one flat grey
  let wz = midN;
  c *= mix(0.68, 1.18, smoothstep(-0.55, 0.55, wz));
  c *= mix(1.0, 0.5, crack) * mix(0.86, 1.06, clamp(h, 0.0, 1.0));
  // ledge undercuts shade dark, ledge tops catch light
  c *= mix(1.0, mix(0.7, 1.1, step), fadeL);
  m.alb = c;
  m.rough = mix(0.85, 0.65, ridged * (1.0 - crack));
  return m;
}

// Grass: green by biome and season, dry patches, a fine fibre texture.
fn layerGrass(p: vec3f, fp: f32, tint: vec3f, moist: f32) -> Mat {
  var m: Mat;
  let n = fbmd(p, 2.5, 5, 0.6, fp);
  let patchy = fbm2(p.xz * 0.045, 4);
  let clump = fbmd(p, 0.35, 3, 0.5, fp);
  m.h = vec4f(0.35 + (0.25 * n.x) + (0.2 * clump.x), (n.yzw * 0.25) + (clump.yzw * 0.2));
  let dry = clamp(0.35 - moist + (patchy * 0.6), 0.0, 1.0);
  var c = seasonGrass(tint, G.weather2.w, dry * 0.6);
  c = mix(vec3f(dot(c, vec3f(0.3, 0.59, 0.11))), c, 0.78);
  // hue drift at 5..40 m: blue-green lush hollows, yellow-green tops
  let hue = fbm2((p.xz * 0.06) + 3.3, 3);
  c = mix(c, c * vec3f(0.80, 0.95, 1.05), smoothstep(0.0, 0.5, hue) * 0.6);
  c = mix(c, c * vec3f(1.25, 1.12, 0.80), smoothstep(0.0, 0.5, -hue) * 0.5);
  c *= 0.80 + (0.30 * n.x) + (0.22 * clump.x);
  // tussocks: darker, bluer hollows between them (seen to ~60 m)
  let tus = voronoi2(p.xz * 0.9);
  let tf = 1.0 - smoothstep(0.15, 0.6, fp);
  c *= mix(1.0, mix(0.72, 1.08, smoothstep(0.1, 0.6, 1.0 - tus.x)), tf);
  // little bare soil between clumps
  c = mix(c, vec3f(0.11, 0.085, 0.06), smoothstep(0.25, 0.65, -clump.x) * 0.45);
  // small flowers in spring meadows (only close)
  let fl = voronoi2(p.xz * 1.7);
  let bloom = (1.0 - smoothstep(0.0, 0.09, fl.x)) * step(0.86, fl.w) * (1.0 - smoothstep(0.08, 0.25, fp));
  let spring = 1.0 - smoothstep(0.1, 0.3, abs(fract(G.weather2.w + 0.5) - 0.62));
  c = mix(c, mix(vec3f(0.75, 0.70, 0.18), vec3f(0.62, 0.30, 0.55), fract(fl.w * 7.0)), bloom * spring * moist);
  m.alb = c;
  m.rough = 0.92;
  return m;
}

// Forest floor: leaf litter, needles, moss and roots.
fn layerForest(p: vec3f, fp: f32, litter: vec3f, moist: f32) -> Mat {
  var m: Mat;
  let n = fbmd(p, 1.8, 5, 0.55, fp);
  let leaves = voronoi2(p.xz * 6.0);
  let moss = smoothstep(0.0, 0.5, fbm2(p.xz * 0.08, 3) + (moist - 0.5));
  let leafEdge = smoothstep(0.0, 0.35, leaves.x);
  m.h = vec4f(0.4 + (0.3 * n.x) + (0.12 * leafEdge), n.yzw * 0.3);
  let leafCol = mix(vec3f(0.17, 0.085, 0.030), vec3f(0.23, 0.15, 0.055), leaves.w);
  var c = mix(litter, leafCol, (1.0 - smoothstep(0.15, 0.4, fp)) * 0.55 * leafEdge);
  c = mix(c, vec3f(0.060, 0.095, 0.030), moss * 0.7);
  c *= 0.75 + (0.35 * n.x);
  m.alb = c;
  m.rough = 0.88;
  return m;
}

// Sand: wind ripples across the wind direction, darker heavy minerals in
// the troughs.
fn layerSand(p: vec3f, fp: f32, region: vec3f, slope: f32) -> Mat {
  var m: Mat;
  let wd = normalize(G.wind.xy + vec2f(0.6, 0.3));
  // wind ripples: 0.35 m apart, nearly parallel, a little sinuous
  let warp = (fbm2(p.xz * 0.35, 3) * 1.3) + (fbm2(p.xz * 0.04, 2) * 3.0);
  let kr = 18.0;
  let ph = (dot(p.xz, wd) * kr) + warp;
  let rip = (sin(ph) * 0.7) + (sin((ph * 2.0) + 1.0) * 0.15);
  let fade = (1.0 - smoothstep(0.03, 0.08, fp)) * (1.0 - smoothstep(0.06, 0.2, slope));
  let n = fbmd(p, 3.0, 4, 0.5, fp);
  let dunes = fbmd(p, 0.05, 3, 0.5, fp);
  let gr = vec3f(wd.x, 0.0, wd.y) * (cos(ph) * kr * 0.7 * 0.03 * fade);
  m.h = vec4f(0.45 + (0.03 * rip * fade) + (0.1 * n.x) + (0.15 * dunes.x),
              gr + (n.yzw * 0.1) + (dunes.yzw * 0.15));
  let warm = mix(vec3f(0.50, 0.42, 0.30), vec3f(0.58, 0.38, 0.22), region.y);
  var c = mix(warm, vec3f(0.30, 0.29, 0.27), region.z * 0.6);
  c *= 0.92 + (0.12 * rip * fade) + (0.08 * n.x);
  m.alb = c;
  m.rough = 0.86;
  return m;
}

// Snow: soft drifts, fine sparkle grains.
fn layerSnow(p: vec3f, fp: f32) -> Mat {
  var m: Mat;
  let n = fbmd(p, 0.25, 5, 0.5, fp);
  m.h = vec4f(0.7 + (0.2 * n.x), n.yzw * 0.25);
  m.alb = vec3f(0.86, 0.89, 0.93) * (0.96 + (0.04 * n.x));
  m.rough = 0.42;
  return m;
}

// Mud: smooth, dark, with drying cracks in low moisture.
fn layerMud(p: vec3f, fp: f32, moist: f32) -> Mat {
  var m: Mat;
  let n = fbmd(p, 0.9, 4, 0.5, fp);
  let cr = voronoi2(p.xz * 0.9);
  let crack = (1.0 - smoothstep(0.0, 0.06, abs(cr.x - 0.5) * 0.5)) * (1.0 - smoothstep(0.1, 0.3, fp)) * (1.0 - smoothstep(0.3, 0.7, moist));
  m.h = vec4f(0.25 + (0.15 * n.x) - (0.15 * crack), n.yzw * 0.15);
  m.alb = mix(vec3f(0.085, 0.065, 0.045), vec3f(0.12, 0.095, 0.065), n.x * 0.5 + 0.5) * (1.0 - crack * 0.4);
  m.rough = 0.62;
  return m;
}

// Gravel: rounded pebbles (Voronoi domes) of mixed stone colours.
fn layerGravel(p: vec3f, fp: f32, region: vec3f) -> Mat {
  var m: Mat;
  let s = 7.0;
  let v = voronoi2(p.xz * s);
  let v2 = voronoi2((p.xz * s * 2.3) + 5.1);
  let fade = 1.0 - smoothstep(0.03, 0.1, fp);
  let r = 0.55;
  let dome = max(1.0 - ((v.x * v.x) / (r * r)), 0.0);
  let dome2 = max(1.0 - ((v2.x * v2.x) / (r * r)), 0.0);
  // gradient of the dome: -2 (p - c) s / r^2, with r = site - frac (so + sign)
  let g = vec3f(v.y, 0.0, v.z) * (2.0 * s / (r * r)) * step(0.0, 1.0 - ((v.x * v.x) / (r * r)));
  let n = fbmd(p, 0.6, 3, 0.5, fp);
  m.h = vec4f(mix(0.5, (0.35 * dome) + (0.25 * dome2) + 0.2, fade) + (0.1 * n.x), (g * 0.04 * fade) + (n.yzw * 0.1));
  let stoneA = mix(vec3f(0.30, 0.28, 0.25), vec3f(0.36, 0.25, 0.17), region.y);
  let stoneB = mix(vec3f(0.16, 0.15, 0.14), vec3f(0.42, 0.40, 0.37), v.w);
  var c = mix(stoneA, stoneB, fade * 0.7);
  c *= mix(1.0, mix(0.55, 1.1, dome), fade);
  m.alb = c;
  m.rough = 0.75;
  return m;
}

// ------------------------------------------------------ texture layers --

// One ASSETS ground set (texture array layer k) at p: planar on xz, or
// triplanar on steep ground. Two scales (the tile and 3.7 tiles, turned)
// mix past 10 m, so the repeat does not show. gx, gy: dp/dx, dp/dy.
// nrm is an offset in the tangent plane of n (OpenGL maps: +y is up in the
// image).
struct TexS { alb: vec3f, nrm: vec3f, orm: vec3f };

fn texTile(k: u32) -> f32 { return max(U.tiles[k >> 2u][k & 3u], 0.25); }

fn tex3(k: u32, uv: vec2f, gu: vec2f, gv: vec2f) -> array<vec4f, 3> {
  return array<vec4f, 3>(
    textureSampleGrad(tLayerAlb, sRepeat, uv, k, gu, gv),
    textureSampleGrad(tLayerNrm, sRepeat, uv, k, gu, gv),
    textureSampleGrad(tLayerOrm, sRepeat, uv, k, gu, gv));
}

// No visible repeat (after Quilez, "texture repetition", technique 3): a
// slow noise picks one of eight uv offsets; two samples blend across the
// step, so the tile grid does not line up. High quality only.
fn tex3NoTile(k: u32, uv: vec2f, gu: vec2f, gv: vec2f) -> array<vec4f, 3> {
  if (U.mat.w < 0.5) { return tex3(k, uv, gu, gv); }
  let v = (vnoise2(uv * 0.31) * 0.5) + 0.5;
  let l = v * 8.0;
  let i = floor(l);
  let f = l - i;
  let oa = sin(vec2f(3.0, 7.0) * i);
  let ob = sin(vec2f(3.0, 7.0) * (i + 1.0));
  let a = tex3(k, uv + oa, gu, gv);
  let b = tex3(k, uv + ob, gu, gv);
  let d = a[0].rgb - b[0].rgb;
  let w = smoothstep(0.2, 0.8, f - (0.1 * (d.x + d.y + d.z)));
  return array<vec4f, 3>(mix(a[0], b[0], w), mix(a[1], b[1], w), mix(a[2], b[2], w));
}

// one projection: uv from the plane coordinates, two scales mixed by far
fn texProj(k: u32, q: vec2f, gq: vec2f, hq: vec2f, s: f32, far: f32) -> array<vec4f, 3> {
  var a = tex3NoTile(k, q * s, gq * s, hq * s);
  if (far > 0.01) {
    let r = mat2x2f(0.8, 0.6, -0.6, 0.8);
    let s2 = s * 0.27;
    let b = tex3(k, (r * q) * s2 + vec2f(0.37, 0.71), (r * gq) * s2, (r * hq) * s2);
    // keep the colour of the near scale: mix the detail only
    a[0] = vec4f(mix(a[0].rgb, b[0].rgb, far), 1.0);
    a[1] = mix(a[1], b[1], far);
    a[2] = mix(a[2], b[2], far);
  }
  return a;
}

fn texSet(k: u32, p: vec3f, n: vec3f, tri: bool, gx: vec3f, gy: vec3f, far: f32) -> TexS {
  let s = 1.0 / texTile(k);
  var o: TexS;
  if (!tri) {
    let t = texProj(k, p.xz, gx.xz, gy.xz, s, far);
    o.alb = t[0].rgb; o.orm = t[2].rgb;
    let m = t[1].xy * 2.0 - 1.0;
    let off = vec3f(m.x, 0.0, -m.y);
    o.nrm = off - (dot(off, n) * n);
    return o;
  }
  var w = pow(abs(n), vec3f(4.0));
  w /= (w.x + w.y + w.z);
  // vertical planes: v = -y, so the image is upright on a cliff
  let tx = texProj(k, vec2f(p.z, -p.y), vec2f(gx.z, -gx.y), vec2f(gy.z, -gy.y), s, far);
  let ty = texProj(k, p.xz, gx.xz, gy.xz, s, far);
  let tz = texProj(k, vec2f(p.x, -p.y), vec2f(gx.x, -gx.y), vec2f(gy.x, -gy.y), s, far);
  o.alb = (tx[0].rgb * w.x) + (ty[0].rgb * w.y) + (tz[0].rgb * w.z);
  o.orm = (tx[2].rgb * w.x) + (ty[2].rgb * w.y) + (tz[2].rgb * w.z);
  let mx = tx[1].xy * 2.0 - 1.0;
  let my = ty[1].xy * 2.0 - 1.0;
  let mz = tz[1].xy * 2.0 - 1.0;
  let off = (vec3f(0.0, mx.y, mx.x * sign(n.x)) * w.x) + (vec3f(my.x, 0.0, -my.y) * w.y) + (vec3f(mz.x * sign(n.z), mz.y, 0.0) * w.z);
  o.nrm = off - (dot(off, n) * n);
  return o;
}

// Set k at p, calibrated: the scanned sets differ a lot in mean colour
// (a red cliff, a dark sand, a grey snow), so a set gives only its detail
// relative to its own mean (the 1 x 1 mip), times the target colour of
// its role. Far away (texF 0) that is the target alone, so the colour does
// not change where the texture fades out.
fn texSetCal(k: u32, tgt: vec3f, p: vec3f, n: vec3f, tri: bool, gx: vec3f, gy: vec3f, far: f32, texF: f32) -> TexS {
  var t: TexS;
  let mean = max(textureSampleLevel(tLayerAlb, sRepeat, vec2f(0.5), k, 16.0).rgb, vec3f(0.01));
  t.alb = tgt;
  t.orm = textureSampleLevel(tLayerOrm, sRepeat, vec2f(0.5), k, 16.0).rgb;
  t.nrm = vec3f(0.0);
  if (texF > 0.01) {
    let tn = texSet(k, p, n, tri, gx, gy, far);
    // detail: mostly luminance, a little of the hue
    let rel = tn.alb / mean;
    let lr = dot(rel, vec3f(0.3, 0.59, 0.11));
    let det = clamp(mix(vec3f(lr), rel, 0.35), vec3f(0.0), vec3f(3.0));
    t.alb = tgt * mix(vec3f(1.0), det, texF);
    t.orm = mix(t.orm, tn.orm, texF);
    t.nrm = tn.nrm * texF;
  }
  return t;
}

fn mixTex(a: TexS, b: TexS, f: f32) -> TexS {
  var o: TexS;
  o.alb = mix(a.alb, b.alb, f); o.nrm = mix(a.nrm, b.nrm, f); o.orm = mix(a.orm, b.orm, f);
  return o;
}

fn mapIdx(i: u32) -> u32 { return u32(U.map[i >> 2u][i & 3u] + 0.5); }

// mean albedo of the procedural rock palette (the ratio carries the cracks,
// lichen, strata and weathering of the procedural rock onto the texture)
fn rockMean(region: vec3f) -> vec3f {
  return (vec3f(0.195, 0.188, 0.177) * region.x) + (vec3f(0.345, 0.2, 0.115) * region.y) + (vec3f(0.078, 0.073, 0.068) * region.z);
}

// ---------------------------------------------------------------- light --

fn dGGX(ndh: f32, a: f32) -> f32 { let a2 = a * a; let d = (ndh * ndh * (a2 - 1.0)) + 1.0; return a2 / ((GPI * d * d) + 1e-6); }
fn gSmith(ndl: f32, ndv: f32, a: f32) -> f32 {
  let k = (a + 1.0) * (a + 1.0) / 8.0;
  return (ndl / ((ndl * (1.0 - k)) + k)) * (ndv / ((ndv * (1.0 - k)) + k));
}
fn fSchlick(f0: vec3f, c: f32) -> vec3f { return f0 + ((1.0 - f0) * pow(1.0 - c, 5.0)); }

fn brdf(n: vec3f, v: vec3f, l: vec3f, alb: vec3f, rough: f32, f0: vec3f) -> vec3f {
  let ndl = max(dot(n, l), 0.0);
  if (ndl <= 0.0) { return vec3f(0.0); }
  let h = normalize(v + l);
  let ndv = max(dot(n, v), 1e-3);
  let ndh = max(dot(n, h), 0.0);
  let a = max(rough * rough, 0.002);
  let F = fSchlick(f0, max(dot(h, v), 0.0));
  let spec = F * (dGGX(ndh, a) * gSmith(ndl, ndv, a) / (4.0 * ndv * ndl + 1e-4));
  let diff = (1.0 - F) * alb / GPI;
  return (diff + spec) * ndl;
}

// Sky radiance in direction d, from the ambient and fog colours (no probe).
fn skyColour(d: vec3f) -> vec3f {
  let up = clamp(d.y, -0.2, 1.0);
  let zen = G.ambient.rgb / GPI;
  let hor = max(G.fog.rgb, zen * 0.6);
  return mix(hor, zen, smoothstep(0.0, 0.6, up)) * select(1.0, 0.4, up < 0.0);
}

// March the height field toward the sun (after forge planet.wgsl
// fn terrainShadow). Soft penumbra from the closest miss. 1 = lit.
fn marchShadow(world: vec3f, l: vec3f, fp: f32) -> f32 {
  if (U.shadow.y < 0.5 || l.y <= -0.05) { return select(1.0, 0.0, l.y <= -0.05); }
  let steps = select(12, 22, U.mat.w > 0.5);
  var t = max(G.terrain.w * 1.5, 4.0);
  let tmax = U.shadow.z;
  let grow = pow(tmax / t, 1.0 / f32(steps));
  var vis = 1.0;
  for (var i = 0; i < 28; i++) {
    if (i >= steps) { break; }
    let q = world + (l * t);
    let h = baseH(q.xz);
    let dh = q.y - h;
    vis = min(vis, clamp(((dh + (t * 0.012)) / (t * 0.07)) + 0.5, 0.0, 1.0));
    if (vis <= 0.0) { break; }
    t *= grow;
  }
  return smoothstep(0.0, 1.0, vis);
}

// SKY's moving cloud shadows (NOTES.md 2026-10-17 SKY -> ALL): project p
// along the sun to the cloud base and read the transmittance map. 1 = lit.
fn cloudShadowAt(p: vec3f) -> f32 {
  if (U.shadow.w < 0.5) { return 1.0; }
  let t = max(U.cloud.w - p.y, 0.0) / max(G.sunDir.y, 0.08);
  let q = p.xz + (G.sunDir.xz * t);
  let uv = (q - U.cloud.xy) / max(U.cloud.z, 1.0);
  let inside = all(uv > vec2f(0.0)) && all(uv < vec2f(1.0));
  let T = select(1.0 - (0.7 * G.weather.x), textureSampleLevel(tCloudSh, sCloudSh, uv, 0.0).r, inside);
  let lit = smoothstep(-0.04, 0.03, G.sunDir.y);
  return mix(1.0, T, lit);
}

// Aerial perspective: height-falloff fog from G.fog, plus a sun lobe.
fn aerial(col: vec3f, world: vec3f) -> vec3f {
  let cam = G.camPos.xyz;
  let dv = world - cam;
  let dist = length(dv);
  let rd = dv / max(dist, 1e-3);
  let hf = 900.0;
  let y0 = cam.y - G.terrain.z;
  let dy = dv.y;
  let k = dy / hf;
  let integ = select((1.0 - exp(-k)) / k, 1.0 - (0.5 * k), abs(k) < 1e-3);
  let od = G.fog.w * exp(-max(y0, -200.0) / hf) * dist * integ;
  let tr = exp(-od * vec3f(0.85, 1.0, 1.25));
  let mu = dot(rd, normalize(G.sunDir.xyz));
  let g = 0.72;
  let hg = (1.0 - (g * g)) / (4.0 * GPI * pow(1.0 + (g * g) - (2.0 * g * mu), 1.5));
  let ins = G.fog.rgb + (G.sunColor.rgb * hg * 0.02 * smoothstep(-0.1, 0.1, G.sunDir.y));
  return (col * tr) + (ins * (1.0 - tr));
}

// Rain ripples: expanding rings in hashed cells (puddles only).
fn ripples(xz: vec2f, t: f32) -> vec2f {
  var g = vec2f(0.0);
  for (var l = 0; l < 2; l++) {
    let sc = 2.6 + (f32(l) * 1.7);
    let p = (xz * sc) + vec2f(f32(l) * 7.3);
    let fl = floor(p);
    let c = hash33(vec3i(vec2i(fl), 77 + l));
    let ph = fract(t * 0.9 + c.z);
    let o = (fl + 0.2 + (c.xy * 0.6)) - p;
    let d = length(o);
    let r = ph * 0.5;
    let ring = sin((d - r) * 40.0) * (1.0 - ph) * (1.0 - smoothstep(0.0, 0.1, abs(d - r)));
    g += (o / max(d, 1e-3)) * ring;
  }
  return g;
}

// ------------------------------------------------------------- fragment --

@fragment
fn fs(v: VOut) -> @location(0) vec4f {
  let p = v.world;
  let xz = p.xz;
  let cam = G.camPos.xyz;
  let viewV = cam - p;
  let dist = length(viewV);
  let V = viewV / max(dist, 1e-3);
  let q = U.mat.w;

  // derivatives first (uniform control flow)
  let dpx = dpdx(p);
  let dpy = dpdy(p);
  // footprint: between the geometric mean and the max of the two pixel
  // axes. The max alone blurs the ground at a grazing view (it is set by
  // the long axis); TAA hides the small rest of the aliasing.
  let lx = length(dpx);
  let ly = length(dpy);
  let fp = max(mix(sqrt(lx * ly), max(lx, ly), 0.3), 1e-3);

  // per-pixel normal: the base slope from tNormal (bilinear of the texel
  // normals: smooth, where differences of the bilinear height show facets)
  // plus the slope of detailHeight by central differences; the step grows
  // with the footprint so far relief does not alias
  let nA = nrmAt(xz);
  let nb = normalize(nA.xyz + vec3f(0.0, 1e-4, 0.0));
  let gB = -nb.xz / max(nb.y, 0.08);
  // (detailHeight costs ~30 texel loads: four calls only where its slope
  // shows, at quality 0.5 and up within 900 m)
  var gD = gB;
  if ((q >= 0.5) && (dist < 900.0)) {
    // forward differences: three calls, not four
    let e = clamp(fp * 0.6, 0.08, G.terrain.w * 0.4);
    let d0 = detailHeight(xz);
    let dx = detailHeight(xz + vec2f(e, 0.0)) - d0;
    let dz = detailHeight(xz + vec2f(0.0, e)) - d0;
    gD += (vec2f(dx, dz) / e) * (1.0 - smoothstep(600.0, 900.0, dist));
  }
  let down0 = normalize(gD + vec2f(1e-5, 0.0));
  let steep0 = smoothstep(0.18, 0.7, length(gB));
  let gE = macroErosion(p, down0, steep0 * (0.5 + (0.5 * q)), fp);
  let nGeo = normalize(vec3f(-(gD.x + gE.x), 1.0, -(gD.y + gE.y)));
  let aoT = clamp(nA.w, 0.0, 1.0);
  let aux = auxAt(xz);
  let flow = aux.r;
  let river = clamp(aux.g, 0.0, 1.0);
  let moist = clamp(aux.b, 0.0, 1.0);
  let wdepth = max(aux.a, 0.0);

  let slope = 1.0 - nGeo.y;
  let sea = G.terrain.z;
  let hAbove = p.y - sea;
  let hMin = G.terrainOrigin.z;
  let hMax = max(G.terrainOrigin.w, hMin + 1.0);
  let hRel = clamp((p.y - sea) / max(hMax - sea, 1.0), 0.0, 1.0);

  // region of the rock type: granite, sandstone, basalt (macro noise + biome)
  var bw = biomeMix(xz);
  let rn = fbm2(xz * 0.00025, 3);
  let desertish = clamp(bw.w1.x * (1.0 - smoothstep(0.0, 3.0, wdepth)) * 0.8, 0.0, 1.0);
  var region = vec3f(0.0);
  region.y = clamp(desertish + (bw.w0.z * smoothstep(0.2, 0.6, rn) * 0.25), 0.0, 1.0);
  region.z = clamp(smoothstep(0.3, 0.7, -rn), 0.0, 1.0) * (1.0 - region.y) * 0.8;
  region.x = max(1.0 - region.y - region.z, 0.0);
  let down = normalize(nGeo.xz + vec2f(1e-5, 0.0));

  // ---- weights by rule
  var w0 = bw.w0;   // rock, cliff, grass, forest
  var w1 = bw.w1;   // sand, snow, mud, gravel
  let jit = (fbm2(xz * 0.03, 3) * 1.4) + (fbm2((xz * 0.21) + 7.7, 2) * 0.6);
  // slope: grass and soil slide off, rock shows, cliffs above ~45 deg
  let rockS = smoothstep(0.16 + (jit * 0.05), 0.30 + (jit * 0.05), slope);
  let cliffS = smoothstep(0.34 + (jit * 0.06), 0.48 + (jit * 0.06), slope);
  let soft = 1.0 - rockS;
  w0 = vec4f(w0.x + (rockS * 1.4), cliffS * 2.5, w0.z * soft, w0.w * soft);
  w1 = vec4f(w1.x * soft, w1.y, w1.z * soft, w1.w * (1.0 - (cliffS * 0.8)));
  // height: above the tree line rock and scree take over
  let tree = 1.0 - smoothstep(0.62 + (jit * 0.08), 0.80 + (jit * 0.08), hRel);
  w0.w *= tree;
  w0.z *= mix(0.35, 1.0, tree);
  w0.x += (1.0 - tree) * 0.6;
  w1.w += (1.0 - tree) * 0.4 * soft;
  // beaches near the sea: sand on low flat ground, wet sand below the
  // swash line (forge planet.wgsl shore idea)
  let beach = (1.0 - smoothstep(1.5, max(5.0 + (jit * 3.0), 2.5), hAbove)) * soft;
  w1.x += beach * 2.0;
  w0.z *= 1.0 - (beach * 0.9);
  w0.w *= 1.0 - beach;
  // river beds: gravel in the channel, sand and silt at the edges, mud on
  // the banks; sediment fans where a big flow reaches flat ground
  let rj = river + (fbm2(xz * 0.09, 3) * 0.22);
  let bed = smoothstep(0.3, 0.7, rj);
  let bank = smoothstep(0.05, 0.3, rj) * (1.0 - bed);
  let chan = smoothstep(0.8, 2.8, flow) * soft;
  let fan = chan * (1.0 - smoothstep(0.02, 0.10, slope)) * (1.0 - bed);
  w1.w += (bed * 2.0) + (chan * 0.3);
  w1.x += (bed * 0.6) + (fan * 0.9);
  w1.z += (bank * 1.2 * moist) + (fan * 0.4);
  w0.z *= 1.0 - (bed * 0.95);
  w0.w *= 1.0 - (bed * 0.95);
  // lake and sea floor: silt
  let under = smoothstep(0.05, 0.6, wdepth) + (1.0 - smoothstep(-0.5, 0.2, hAbove));
  w1.z += under * 1.2;
  w1.x += under * 0.6;
  w0.z *= 1.0 - clamp(under, 0.0, 1.0);
  // moisture: dry ground shows gravel and sand through thin grass
  w1.x += (1.0 - smoothstep(0.08, 0.3, moist)) * w0.z * 0.5;

  // snow: snow line from the cover uniform, lower on north faces (world
  // frame: +z is south, so a north face has n.z < 0), less on steep
  // slopes; plus the snow biome
  let cover = clamp(G.weather2.y, 0.0, 1.0);
  // cover 0: no snow; 0.5: the upper slopes; 1: down to the sea
  let snowLine = mix(hMax + 300.0, sea - 150.0, pow(cover, 0.7));
  let aspect = clamp(-nGeo.z * 2.0, -1.0, 1.0);
  let snowN = fbm2(xz * 0.004, 4) * 120.0;
  var snow = smoothstep(snowLine - 140.0, snowLine + 60.0, p.y + snowN + (aspect * 90.0));
  // fresh snowfall dusts everything that is not too steep
  snow = max(snow, smoothstep(0.1, 0.8, G.weather.z) * 0.55);
  snow *= 1.0 - smoothstep(0.30, 0.55, slope);
  snow = max(snow, w1.y * (1.0 - cliffS * 0.6));
  snow *= 1.0 - clamp(under + bed, 0.0, 1.0);

  // ---- evaluate the layers that matter
  var wa = array<f32, 8>(w0.x, w0.y, w0.z, w0.w, w1.x, w1.y * 0.0, w1.z, w1.w);
  var wsum = 0.0;
  for (var i = 0; i < 8; i++) { wsum += wa[i]; }
  wsum = max(wsum, 1e-3);
  var mats = array<Mat, 8>();
  var hmax = -10.0;
  var rockM: Mat;
  var rockDone = false;
  let cliffShare = wa[1] / max(wa[0] + wa[1], 1e-4);
  // asset textures: full near, gone past ~260 m (the procedural layers and
  // the macro terms carry the far ground)
  let texF = U.mat.x * (1.0 - smoothstep(110.0, 260.0, dist));
  let farMix = smoothstep(10.0, 45.0, dist) * 0.5;
  let triOn = slope > 0.4;
  let sg = seasonGrass(bw.grass, G.weather2.w, 0.0);
  // texture position with a slow warp (in m): the tile rows do not line up
  let pw = p + vec3f(fbm2(xz * 0.045, 2), 0.0, fbm2((xz * 0.045) + 19.1, 2)) * 1.6;
  // mid-scale tone and hue (10..60 m) for the textured layers
  let vm = fbm2(xz * 0.035, 3);
  let vh = fbm2((xz * 0.06) + 3.3, 2);
  for (var i = 0u; i < 8u; i++) {
    let wi = wa[i] / wsum;
    wa[i] = wi;
    if (wi < 0.02) { continue; }
    var m: Mat;
    // the procedural layer: always for rock and cliff (their cracks, ledges
    // and lichen tint the texture), else only where the texture fades out
    let kP = mapIdx(i);
    let hasSet = (U.mat.x > 0.5) && (kP < 64u);
    let hasTex = hasSet && (texF > 0.01);
    if ((i <= 1u) || !hasSet) {
      switch (i) {
        // rock and cliff share one evaluation (cliff share = the blend of
        // the two weights): it is the most costly layer
        case 0u: { rockM = layerRock(p, fp, cliffShare, moist, region, down, slope); rockDone = true; m = rockM; }
        case 1u: {
          if (!rockDone) { rockM = layerRock(p, fp, cliffShare, moist, region, down, slope); rockDone = true; }
          m = rockM;
        }
        case 2u: { m = layerGrass(p, fp, bw.grass, moist); }
        case 3u: { m = layerForest(p, fp, bw.litter, moist); }
        case 4u: { m = layerSand(p, fp, region, slope); }
        case 6u: { m = layerMud(p, fp, moist); }
        default: { m = layerGravel(p, fp, region); }
      }
    } else {
      m.alb = vec3f(0.2); m.h = vec4f(0.5, 0.0, 0.0, 0.0); m.rough = 0.8;
    }
    m.tn = vec3f(0.0);
    m.ao = 1.0;
    if (hasSet) {
      let tri = triOn && (i == 1u);
      // far: the mean of the set (its 1 x 1 mip), so the colour does not
      // change where the texture fades out
      // target colours of the roles (tuned with the procedural palettes)
      var tgtP = rockMean(region);
      var tgtA = vec3f(0.23, 0.22, 0.20);
      var rmin = 0.72;
      switch (i) {
        case 1u: { tgtP = rockMean(region) * 0.9; tgtA = rockMean(region); }
        case 2u: { tgtP = sg; tgtA = seasonGrass(vec3f(0.20, 0.155, 0.075), G.weather2.w, 0.0); rmin = 0.8; }
        case 3u: { tgtP = bw.litter; tgtA = vec3f(0.10, 0.075, 0.05); rmin = 0.8; }
        case 4u: { tgtP = mix(vec3f(0.46, 0.39, 0.28), vec3f(0.50, 0.33, 0.19), region.y); tgtA = vec3f(0.40, 0.30, 0.19); rmin = 0.75; }
        case 5u: { tgtP = vec3f(0.82, 0.85, 0.90); rmin = 0.35; }
        case 6u: { tgtP = vec3f(0.085, 0.066, 0.045); rmin = 0.45; }
        case 7u: { tgtP = vec3f(0.24, 0.215, 0.19); tgtA = vec3f(0.23, 0.22, 0.20); }
        default: {}
      }
      var t = texSetCal(kP, tgtP, pw, nGeo, tri, dpx, dpy, farMix, texF);
      // the alternate set of this layer and how much of it
      var af = 0.0;
      switch (i) {
        case 0u: { af = (1.0 - smoothstep(0.22, 0.42, slope)) * 0.85; }
        case 1u: { af = smoothstep(-0.1, 0.5, fbm2(xz * 0.02, 2)) * 0.5; }
        case 2u: { af = clamp((1.0 - smoothstep(0.18, 0.42, moist)) + (smoothstep(0.1, 0.5, fbm2(xz * 0.013, 3)) * 0.5), 0.0, 1.0); }
        case 3u: { af = bw.kind.x; }
        case 4u: { af = bw.kind.y; }
        case 7u: { af = 1.0 - tree; }
        default: {}
      }
      let kA = mapIdx(i + 8u);
      if ((af > 0.02) && (kA < 64u) && (kA != kP)) {
        t = mixTex(t, texSetCal(kA, tgtA, pw, nGeo, tri, dpx, dpy, farMix, texF), af);
      }
      // damp grass: the meadow set in wet ground (U.mat.y)
      if (i == 2u) {
        let kM = u32(U.mat.y + 0.5);
        let wf = smoothstep(0.6, 0.85, moist) * (1.0 - af);
        if ((wf > 0.02) && (kM < 64u)) { t = mixTex(t, texSetCal(kM, vec3f(0.075, 0.115, 0.035), pw, nGeo, false, dpx, dpy, farMix, texF), wf); }
      }
      // the procedural modulation: rock keeps its cracks, lichen, strata
      // and weathering; the other layers get a mid-scale tone and hue
      var ratio = vec3f(0.84 + (0.32 * vm));
      if (i <= 1u) { ratio = clamp(m.alb / rockMean(region), vec3f(0.3), vec3f(1.8)); }
      else if (i == 2u) { ratio *= mix(vec3f(1.0), vec3f(1.12, 1.04, 0.82), smoothstep(0.0, 0.6, vh)); }
      m.alb = t.alb * ratio;
      m.h = vec4f(mix(m.h.x, t.orm.b, max(texF, 0.5)), m.h.yzw * (1.0 - (texF * 0.6)));
      m.rough = max(mix(m.rough, t.orm.g, max(texF, 0.5)), rmin);
      m.tn = t.nrm;
      m.ao = mix(1.0, t.orm.r, texF);
    }
    mats[i] = m;
    hmax = max(hmax, m.h.x + wi);
  }
  // height blend: depth 0.2 of the layer height (the classic splat trick)
  let depthB = mix(0.26, 0.9, smoothstep(0.3, 8.0, fp));
  var alb = vec3f(0.0); var hg = vec4f(0.0); var rough = 0.0; var tw = 0.0;
  var tnS = vec3f(0.0); var aoS = 0.0;
  for (var i = 0u; i < 8u; i++) {
    let wi = wa[i];
    if (wi < 0.02) { continue; }
    let b = max((mats[i].h.x + wi) - (hmax - depthB), 0.0);
    alb += mats[i].alb * b; hg += mats[i].h * b; rough += mats[i].rough * b; tw += b;
    tnS += mats[i].tn * b; aoS += mats[i].ao * b;
  }
  let itw = 1.0 / max(tw, 1e-4);
  alb *= itw; hg *= itw; rough *= itw; tnS *= itw; aoS *= itw;

  // ---- normal: geometry + material bump (surface gradient)
  let bumpFade = 1.0 - smoothstep(30.0, 250.0, dist);
  let bumpK = mix(0.035, 0.07, q) * bumpFade;
  let gt = hg.yzw - (dot(hg.yzw, nGeo) * nGeo);
  var n = normalize(nGeo - (gt * bumpK) + tnS);

  // ---- snow on top (height blended: crevices fill first)
  let snowM = layerSnow(p, fp);
  let snowCov = clamp((snow * 1.7) - (hg.x * 0.7), 0.0, 1.0);
  let snowF = smoothstep(0.05, 0.6, snowCov);
  alb = mix(alb, snowM.alb, snowF);
  rough = mix(rough, snowM.rough, snowF);
  let gs = snowM.h.yzw - (dot(snowM.h.yzw, nGeo) * nGeo);
  n = normalize(mix(n, normalize(nGeo - (gs * bumpK * 0.6)), snowF));

  // ---- macro variation and distance colour
  let mac = fbm2(xz * 0.0018, 4);
  let mac2 = fbm2((xz * 0.011) + 4.7, 3);
  alb *= 0.86 + (0.22 * mac) + (0.10 * mac2 * (1.0 - snowF));
  alb = mix(alb, alb * vec3f(1.06, 0.98, 0.90), clamp(mac2, 0.0, 1.0) * 0.3 * (1.0 - snowF));
  let farT = smoothstep(2500.0, 14000.0, dist);
  let lum = dot(alb, vec3f(0.3, 0.59, 0.11));
  alb = mix(alb, mix(vec3f(lum), alb, 0.8), farT);

  // ---- wetness and puddles
  let rain = clamp(G.weather.y, 0.0, 1.0);
  let nearW = max(max(1.0 - smoothstep(0.3, 2.5, hAbove), bank), max(smoothstep(0.0, 0.3, wdepth), bed));
  var wet = clamp(max(G.weather2.x, nearW * 0.85), 0.0, 1.0) * (1.0 - snowF);
  let porous = 1.0 - clamp((w0.x + w0.y) / max(wsum * 0.5, 1e-3), 0.0, 1.0);
  alb *= mix(1.0, mix(0.65, 0.38, porous), wet);
  rough = mix(rough, mix(0.12, 0.35, porous), wet);
  // puddles fill the low points of the material height on flat ground
  let flat = 1.0 - smoothstep(0.015, 0.06, slope);
  let pn = fbm2(xz * 0.35, 3) * 0.25;
  let level = (G.weather2.x * 0.55) + (rain * 0.15) - 0.1;
  let puddle = smoothstep(0.0, 0.04, level - (hg.x + pn)) * flat * (1.0 - snowF) * (1.0 - bed) * (1.0 - smoothstep(60.0, 220.0, dist));
  var nP = vec3f(0.0, 1.0, 0.0);
  if (rain > 0.01 && puddle > 0.01 && dist < 60.0) {
    let rg = ripples(xz, G.camPos.w) * (rain * 0.35 * U.misc.w);
    nP = normalize(vec3f(rg.x, 1.0, rg.y));
  }
  n = normalize(mix(n, nP, puddle));
  alb = mix(alb, alb * 0.6, puddle);
  rough = mix(rough, 0.03, puddle);

  // ---- lighting
  let L = normalize(G.sunDir.xyz);
  // SKY: sunColor.rgb is the full sun irradiance at the ground (sunDir.w
  // repeats its scale, so it is not applied again)
  let sunE = G.sunColor.rgb;
  let f0 = mix(vec3f(0.035), vec3f(0.02), wet);
  var sh = 1.0;
  var shM = 1.0;
  if (L.y > -0.05) {
    sh = sunShadow(p, nGeo);
    // the march starts on the base surface: detail relief under the base
    // would shadow itself in the bilinear field
    // the cascades hold the terrain casters out to their far split; the
    // march covers the ground past them (or all of it with no cascades)
    let nc = i32(cascades.params.x);
    let cFar = select(0.0, cascades.splits[max(nc - 1, 0)], nc > 0);
    if (dist > cFar * 0.75) {
      let ms = marchShadow(vec3f(p.x, max(p.y, baseH(xz)) + 0.5, p.z), L, fp);
      sh = min(sh, mix(1.0, ms, smoothstep(cFar * 0.75, cFar * 0.95 + 1.0, dist)));
    }
    // the ground's own normal turns away from the sun
    sh *= smoothstep(-0.02, 0.08, dot(nGeo, L) + 0.03);
    sh *= cloudShadowAt(p);
  }
  var col = brdf(n, V, L, alb, rough, f0) * sunE * sh;
  // snow subsurface: a soft wrap and blue tint in shadow
  col += alb * sunE * (snowF * 0.08 * max(dot(n, L) + 0.4, 0.0));
  // moon
  let M = normalize(G.moonDir.xyz);
  if (M.y > 0.0) {
    col += brdf(n, V, M, alb, rough, f0) * vec3f(0.55, 0.62, 0.80) * G.moonDir.w;
  }
  // sky ambient (hemisphere), occlusion from tNormal.w and the crevices
  let microAO = mix(0.55, 1.0, clamp(hg.x * 1.2, 0.0, 1.0));
  let ao = aoT * mix(1.0, microAO, bumpFade * (1.0 - texF)) * mix(1.0, aoS, 0.8);
  // the sky is brighter toward the sun: a mild sun-side bias keeps the
  // form of slopes in shadow at a low sun
  let sunSide = normalize(vec3f(L.x, 0.35, L.z));
  let hemi = mix(0.35, 1.0, (n.y * 0.5) + 0.5) * (0.8 + (0.35 * dot(n, sunSide)));
  let bounce = alb * 0.25 * (1.0 - ((n.y * 0.5) + 0.5));
  col += alb * (G.ambient.rgb / GPI) * (hemi + bounce) * ao;
  // sky reflection on wet ground, puddles and snow
  let R = reflect(-V, n);
  let ndv = max(dot(n, V), 0.0);
  let F = fSchlick(f0, ndv);
  let gloss = 1.0 - smoothstep(0.05, 0.6, rough);
  col += skyColour(R) * F * gloss * ao * mix(1.0, 3.0, puddle);
  // snow sparkle: tiny glints that turn on with the view
  if (snowF > 0.1 && dist < 80.0) {
    let cell = vec3i(vec3f(floor(p * 18.0)));
    let gl = hash33(cell);
    let gn = normalize((gl * 2.0) - 1.0 + (n * 1.2));
    let hv = normalize(L + V);
    let gp = pow(max(dot(gn, hv), 0.0), 600.0) * step(0.8, gl.x);
    col += sunE * gp * snowF * sh * 2.0 * (1.0 - smoothstep(20.0, 80.0, dist));
  }

  // ---- debug views
  let dbg = u32(U.mat.z + 0.5);
  if (dbg == 1u) { col = vec3f(wa[0] + wa[1], wa[2] + wa[3] * 0.5, wa[4] + wa[7]) * (G.ambient.w + 1.0); }
  else if (dbg == 2u) { col = (n * 0.5) + 0.5; }
  else if (dbg == 3u) { col = vec3f(fract(v.level * 0.37), fract(v.level * 0.61), v.morph); }
  else if (dbg == 4u) { col = vec3f(sh) * (G.ambient.w + 1.0); }
  else if (dbg == 5u) { col = alb * (G.ambient.w + 1.0) * 2.0; }
  else if (dbg == 6u) { col = (nGeo * 0.5) + 0.5; }

  if (U.shadow.x > 0.5) { col = aerial(col, p); }
  return vec4f(col, 1.0);
}
