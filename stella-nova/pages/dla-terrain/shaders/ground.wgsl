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
//  SURFACE FIELDS  render/surface-sim.js (tSurf, 4 layers): bedrock shows
//  where the regolith is thin, plants need soil, scree aprons lie under
//  cliffs (the parent rock colour), alluvium is gravel or silt by grain,
//  playas crack, wet banks darken, snow follows drift, shade and slope with
//  cornices on lee crests, rock carries the LIB strata (hard bands as
//  ledges, a colour per layer), lichen, moss and desert varnish by age and
//  climate, glacial polish and striations. Under one field texel: the D8
//  drainage lines (fn drainLine), couloirs from the log-area field, dunes
//  across the prevailing wind (fn dune), rock facets, a macro scan of the
//  cliff set at 34 m and 122 m tiles (fn macroRock), gully cavity light.
//
//  ROCK (2 m to 500 m)  fn rockField: a lattice of three fracture sets that
//  follow the strata (bedding, dip joints, strike joints; U.rock from
//  surface-sim rockFrame) at two scales (blocks of H0, buttresses of
//  7 x H0). Bedded rock (U.rock.w high: sandstone) steps into ledges and
//  stairs; massive rock (granite, gneiss) has long joints and broken faces
//  (fn facet3, continuous cones of a 3D Worley F1). Open joints are cracks
//  (filtered by the footprint, chipped edges); block edges are rounded;
//  weathering rinds, iron stain, varnish and water streaks that run down
//  from the ledge lips, lichen rosettes (fn lichen) and moss. Close up:
//  vertex relief (fn groundDisp: the stairs on bare rock and the talus
//  blocks of fn talus, within U.fx.w m, desktop quality 0.8 and up),
//  parallax occlusion (fn pom, POM_MAX steps within U.fx.z m) and its
//  micro shadow (fn pomShadow). The pattern position is the surface
//  before the vertex relief (VOut.base). The rock scans: one per buttress
//  (fn rockPick: layered beds in sandstone, else the cliff and rock faces).
//  TILING  every texture layer is hex tiled (fn tex3Hex, Mikkelsen 2022);
//  the macro rock reads the aerial outcrop set (50 m tile). Soil close up:
//  small stones (fn grit) and roots (fn roots); a ragged band of stony
//  soil where turf meets rock.
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
//  FAR RING  fn vsRing draws render/ground.js farRingMesh. Past the world
//  square every lookup folds into the world (fn foldXZ, a mirror), and fn
//  ringHeight flattens the mirrored land to U.ring over U.ring.y metres.
//  SNOW LINE  U.snow = the fit T = a + b h of the LIB temperature: the line
//  is where T reaches -7 C (summer) .. +1 C (winter).
//
//  grep -n targets: "struct GroundU", "fn vs", "fn vsShadow", "fn vsRing",
//  "fn foldXZ", "fn ringHeight", "climate snow line", "fn vnoised",
//  "fn fbmd", "fn biomeMix", "fn layerRock", "fn layerGrass", "fn layerSand",
//  "fn layerGravel", "fn marchShadow", "fn aerial", "fn fs", "fn surfAt",
//  "fn drainLine", "fn dune", "fn snowAmount", "fn strataAt", "fn strataCol",
//  "fn facets", "fn macroRock", "struct RockGeo", "fn groundDisp",
//  "fn rockSet", "fn rockField", "fn facet3", "fn rockFine", "fn talus",
//  "fn hexGrid", "fn hexSharp", "fn tex3Hex", "fn pomSteps", "fn pom",
//  "fn pomShadow", "fn rockPick", "fn grit", "fn roots", "fn lichen"
// ============================================================================

struct GroundU {
  lod: vec4f,     // x grid N (full patch), y LOD 0 range m, z level count, w detail pad m
  mat: vec4f,     // x textures on (0/1), y meadow set layer (255: none), z debug view, w quality 0..1
  shadow: vec4f,  // x aerial perspective on (0/1), y height march on (0/1), z march length m, w cloud shadow on (0/1)
  misc: vec4f,    // x time s, y min height m, z terrain top m (max + pad, LOD metric), w ripple strength
  tiles: array<vec4f, 4>,  // tile size m of texture array layer k: tiles[k / 4][k % 4]
  map: array<vec4f, 4>,    // [0..7] primary layer of logical layer l, [8..15] alternate (255: none)
  cloud: vec4f,   // SKY cloud shadow: xy rect origin (world xz), z rect size m, w cloud base y m
  snow: vec4f,    // climate: x T at 0 m (C), y lapse dT/dh (C per m, < 0), z fit valid (0/1), w 0
  ring: vec4f,    // far ring: x floor height m, y fade length m, z floor relief m, w 0
  surf: vec4f,    // surface fields: x on (0/1), y grid m (cells per side), zw prevailing wind (unit, toward)
  geo: vec4f,     // LIB strata: x hmin m, y hspan m, z layers, w strength 0..1
  geo2: vec4f,    // x glacier 0..1, y hemisphere (1 north, -1 south), z dune wavelength m, w 0
  rock: vec4f,    // joint frame: xy set 1 normal (unit xz, the strata dip direction), z bed spacing H0 m, w stair strength
  fx: vec4f,      // x POM on (0/1), y vertex relief on (0/1), z POM range m, w vertex relief range m
  rsets: vec4f,   // array layers of the extra sets: x layered rock, y blocky rock, z outcrop (50 m), w stony soil (255: none)
};
@group(1) @binding(0) var<uniform> U: GroundU;
@group(1) @binding(1) var tLayerAlb: texture_2d_array<f32>;  // ASSETS ground sets, rgba8unorm-srgb
@group(1) @binding(2) var tLayerNrm: texture_2d_array<f32>;  // rgba8unorm, OpenGL normal (+y)
@group(1) @binding(3) var tLayerOrm: texture_2d_array<f32>;  // r AO, g roughness, b height
@group(1) @binding(4) var sRepeat: sampler;                  // linear, repeat, anisotropic
@group(1) @binding(5) var tCloudSh: texture_2d<f32>;         // SKY module.cloudShadow.view (r: sun transmittance)
@group(1) @binding(6) var sCloudSh: sampler;
@group(1) @binding(7) var tSurf: texture_2d_array<f32>;      // render/surface-sim.js fields, 4 layers rgba8unorm (vertex + fragment)

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
  @location(3) base: vec3f,   // the surface before the vertex relief (the pattern position)
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

// The vertex relief of bare rock and talus near the camera (U.fx.y, within
// U.fx.w m): the block stairs of fn rockField (no cracks: they are finer
// than the 0.5 m grid) and the talus blocks of fn talus, along the base
// normal. A function of xz and the camera alone, so the CDLOD seams stay
// closed. The mask keeps it off soil: grass and props stay on
// terrainHeight (NOTES.md GROUND to VEG).
fn groundDisp(xz: vec2f, y: f32) -> vec3f {
  if (U.fx.y < 0.5) { return vec3f(0.0); }
  let dxz = G.camPos.xz - xz;
  let dy = max(G.camPos.y - y, 0.0);
  let d = sqrt(dot(dxz, dxz) + (dy * dy));
  let fade = 1.0 - smoothstep(U.fx.w * 0.6, U.fx.w, d);
  if (fade <= 0.0) { return vec3f(0.0); }
  let nb = normalize(nrmAt(xz).xyz + vec3f(0.0, 1e-4, 0.0));
  let slope = 1.0 - nb.y;
  var reg = 0.3;
  var scree = 0.0;
  var warp = 0.5;
  if (U.surf.x > 0.5) {
    let uv = gUV(xz);
    let a = textureSampleLevel(tSurf, sLinear, uv, 0, 0.0);
    reg = a.x; scree = a.y;
    warp = textureSampleLevel(tSurf, sLinear, uv, 2, 0.0).x;
  }
  let rock = rockMaskOf(slope, reg, scree);
  var h = 0.0;
  if (rock > 0.01) {
    let p = vec3f(xz.x, y, xz.y);
    let r = rockField(p, bedCoord(p, warp), vec3f(0.0, 1.0, 0.0), nb, 0.12, 1.0);
    h = clamp(r.h - r.hf, -1.5, 0.8) * rock;
  }
  h += talus(xz, talusAmt(scree, slope), 0.0).x;
  return nb * (h * fade);
}

@vertex
fn vs(@builtin(vertex_index) vid: u32, inst: Inst) -> VOut {
  let m = cdlodVertex(vid, inst);
  let h = terrainHeight(m.xy);
  var o: VOut;
  o.base = vec3f(m.x, h, m.y);
  o.world = o.base + groundDisp(m.xy, h);
  o.pos = G.viewProj * vec4f(o.world, 1.0);
  o.level = inst.b.z;
  o.morph = m.z;
  return o;
}

// Far ring height: the mirrored world (with a slow warp, so the mirror line
// does not read as a fold) that flattens to a low floor with soft relief
// (no-sea worlds) or sinks under the sea (worlds with a sea).
fn ringHeight(xz: vec2f) -> f32 {
  let d = outsideDist(xz);
  let ws = G.terrain.x;
  let wk = smoothstep(0.0, ws * 0.1, d);
  let wq = xz / (ws * 0.18);
  let warp = vec2f(fbm2(wq, 3), fbm2(wq + vec2f(41.3, 7.9), 3)) * (ws * 0.09 * wk);
  let f = foldXZ(xz + warp);
  let h = terrainHeight(f.xy);
  let k = ringFade(xz);
  let relief = fbm2(xz / (ws * 0.22), 4) * U.ring.z;
  let flo = U.ring.x + relief + (abs(relief) * 0.6);
  return mix(h, flo, k);
}

// The far ring mesh: a = (x, z, skirt drop m). Level -1 marks it in fs.
@vertex
fn vsRing(@location(0) a: vec3f) -> VOut {
  var o: VOut;
  o.world = vec3f(a.x, ringHeight(a.xy) - a.z, a.y);
  o.base = o.world;
  o.pos = G.viewProj * vec4f(o.world, 1.0);
  o.level = -1.0;
  o.morph = 0.0;
  return o;
}

// Shadow pass: CORE sets group 2 = SP, the cascade of this pass.
@vertex
fn vsShadow(@builtin(vertex_index) vid: u32, inst: Inst) -> @builtin(position) vec4f {
  let m = cdlodVertex(vid, inst);
  let h = terrainHeight(m.xy);
  return SP.viewProj * vec4f(vec3f(m.x, h, m.y) + groundDisp(m.xy, h), 1.0);
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
  // at most 10 octaves (a constant cap; callers pass 2 to 6)
  for (var i = 0; i < 10; i++) {
    if (i >= oct) { break; }
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
  // at most 10 octaves: at distance 0 the footprint fp is 0 and the fade
  // stops no octave, so the constant cap is the bound
  for (var i = 0; i < 10; i++) {
    if (i >= oct) { break; }
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

// FAR RING: past the world square the ground mirrors the world (a
// triangle wave in each axis), so the land goes on to the horizon with no
// cut edge. foldXZ: xy the point folded into the square, zw the sign of
// each axis (-1 where the fold mirrors it). Inside the square it is the
// identity, so every lookup below is unchanged there.
fn foldXZ(xz: vec2f) -> vec4f {
  let ws = G.terrain.x;
  let u = (xz - G.terrainOrigin.xy) / ws;
  let t = u - (floor(u * 0.5) * 2.0);          // 0..2
  let m = t > vec2f(1.0);
  let f = select(t, vec2f(2.0) - t, m);
  return vec4f(G.terrainOrigin.xy + (f * ws), select(vec2f(1.0), vec2f(-1.0), m));
}
// distance (m) of xz outside the world square (0 inside)
fn outsideDist(xz: vec2f) -> f32 {
  let half = G.terrain.x * 0.5;
  let c = G.terrainOrigin.xy + vec2f(half);
  return length(max(abs(xz - c) - vec2f(half), vec2f(0.0)));
}
// the flattening of the far ring: 0 at the world edge, 1 at U.ring.y out
fn ringFade(xz: vec2f) -> f32 { return smoothstep(0.0, max(U.ring.y, 1.0), outsideDist(xz)); }

fn gUV(xz: vec2f) -> vec2f { return (foldXZ(xz).xy - G.terrainOrigin.xy) / G.terrain.x; }

fn auxAt(xz: vec2f) -> vec4f { return textureSampleLevel(tAux, sLinear, gUV(xz), 0.0); }
fn nrmAt(xz: vec2f) -> vec4f {
  let f = foldXZ(xz);
  let s = textureSampleLevel(tNormal, sLinear, (f.xy - G.terrainOrigin.xy) / G.terrain.x, 0.0);
  return vec4f(s.x * f.z, s.y, s.z * f.w, s.w);
}

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
    case 3u: { b.w0 = vec4f(0.04, 0.0, 0.95, 0.0); b.w1 = vec4f(0.12, 0.0, 0.0, 0.05);
               b.grass = vec3f(0.215, 0.185, 0.072); }
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
// streak noise (crests where |n| is small), 210 m down to 18 m. Returns the
// slope (dh/dx, dh/dz) to add to the ground, faded per octave by the
// footprint, and the rib / gully value (colour: debris and snow in the
// gullies, bare rock on the ribs).
fn macroErosion(p: vec3f, down: vec2f, steep: f32, fp: f32) -> vec3f {
  if (steep <= 0.0) { return vec3f(0.0); }
  var g = vec2f(0.0);
  var hv = 0.0;
  var hw = 0.0;
  var wl = 160.0;
  var amp = 200.0;
  let octs = select(select(3, 4, U.mat.w >= 0.95), 2, U.mat.w < 0.45);
  for (var i = 0; i < 4; i++) {
    if (i >= octs) { break; }
    let fade = 1.0 - smoothstep(wl * 0.12, wl * 0.3, fp);
    if (fade <= 0.0) { break; }
    let n = streakNoise(p, down, 1.0 / wl, 0.22, f32(i) * 17.1);
    // smooth |n| = sqrt(n^2 + e): a hard sign() draws crease lines
    let r = sqrt((n.x * n.x) + 0.04);
    let s = -(n.x / r);
    g += vec2f(n.y, n.w) * (s * amp * fade);
    // the relief itself: -|n| is high on the ribs, low in the gullies
    let wt = select(select(0.25, 0.7, i == 1), 1.0, i == 0) * fade;
    hv += (0.42 - r) * wt;
    hw += wt;
    wl *= 0.44; amp *= 0.38;
  }
  // x, y: the slope to add; z: -1 in a gully .. 1 on a rib
  return vec3f(g * steep, clamp((hv / max(hw, 1e-3)) * 3.5, -1.0, 1.0) * steep);
}

// ------------------------------------------------------ surface fields --
// render/surface-sim.js derives the fields from the terrain history; the
// functions here read them and add the detail under one field texel. JS
// twins in surface-sim.js: dune, snowAmount, drainLine, cellJitter.

struct Surf {
  a: vec4f,  // regolith, scree, alluvium, wet bank
  b: vec4f,  // snow drift (0.5 neutral), cornice, exposure age, playa
  c: vec4f,  // strata warp (0.5 none), glacial, ice direction / PI, scar
  d: vec4f,  // D8 code x 28 / 255, log area (log10 A km2 + 2.5) / 5, coarse grain, erosion
};

// The fields at xz (bilinear). Off (no fields yet): neutral values, and
// a.x < 0 tells fs to use its slope rules alone.
fn surfAt(xz: vec2f) -> Surf {
  var s: Surf;
  if (U.surf.x < 0.5) {
    s.a = vec4f(-1.0, 0.0, 0.0, 0.0);
    s.b = vec4f(0.5, 0.0, 0.5, 0.0);
    s.c = vec4f(0.5, 0.0, 0.0, 0.0);
    s.d = vec4f(1.0, 0.0, 0.0, 0.0);
    return s;
  }
  let uv = gUV(xz);
  s.a = textureSampleLevel(tSurf, sLinear, uv, 0, 0.0);
  s.b = textureSampleLevel(tSurf, sLinear, uv, 1, 0.0);
  s.c = textureSampleLevel(tSurf, sLinear, uv, 2, 0.0);
  s.d = textureSampleLevel(tSurf, sLinear, uv, 3, 0.0);
  return s;
}

// Broken rock faces: planar facets (Voronoi cells on two vertical planes,
// blended by which way the face looks), each with its own tilt, 26 m and
// 8.6 m. nh: the horizontal normal (xz). -> xy the slope to add, z a tone
// -0.5..0.5 per facet (fresh and weathered planes).
fn facets(p: vec3f, nh: vec2f, fp: f32) -> vec3f {
  var g = vec2f(0.0);
  var tone = 0.0;
  let wx = smoothstep(0.3, 0.7, abs(nh.x) / max(abs(nh.x) + abs(nh.y), 1e-4));
  var cell = 26.0;
  for (var o = 0; o < 2; o++) {
    let fade = 1.0 - smoothstep(cell * 0.08, cell * 0.25, fp);
    if (fade <= 0.0) { break; }
    var hA = vec3f(0.5);
    var hB = vec3f(0.5);
    if (wx > 0.01) {
      let v = voronoi2((vec2f(p.z, p.y * 0.8) / cell) + vec2f(f32(o) * 7.1));
      hA = hash33(vec3i(i32(v.w * 65535.0), o, 19));
    }
    if (wx < 0.99) {
      let v = voronoi2((vec2f(p.x, p.y * 0.8) / cell) + vec2f(f32(o) * 3.7));
      hB = hash33(vec3i(i32(v.w * 65535.0), o, 23));
    }
    let h = mix(hB, hA, wx);
    g += (h.xy - 0.5) * (select(1.0, 0.6, o == 1) * fade);
    tone += (h.z - 0.5) * fade * select(1.0, 0.5, o == 1);
    cell *= 0.33;
  }
  return vec3f(g, tone);
}

// one layer of the fields at xz
fn surfLayer(xz: vec2f, k: i32) -> vec4f { return textureSampleLevel(tSurf, sLinear, gUV(xz), k, 0.0); }

// a hashed offset of a field cell centre (+-0.25 cell), so the drainage
// lines meander and do not follow the grid (twin: surface-sim cellJitter)
fn cellJit(c: vec2i) -> vec2f {
  var h = (bitcast<u32>(c.x) * 73856093u) ^ (bitcast<u32>(c.y) * 19349663u);
  h = (h ^ (h >> 15u)) * 0x2c1b3c6du;
  h = (h ^ (h >> 12u)) * 0x297a2d39u;
  h = h ^ (h >> 15u);
  return ((vec2f(f32(h & 0xffffu), f32(h >> 16u)) / 65535.0) - 0.5) * 0.5;
}
fn d8Off(k: u32) -> vec2i {
  var ox = array<i32, 8>(1, -1, 0, 0, 1, 1, -1, -1);
  var oz = array<i32, 8>(0, 0, 1, -1, 1, -1, 1, -1);
  return vec2i(ox[k], oz[k]);
}

// The drainage network under one texel: each cell with a log area over thr
// draws a segment from its (jittered) centre to its D8 receiver. Returns
// x distance m to the nearest line, y its log area (0..1), zw the unit
// offset from the line to xz (the gully wall gradient).
fn drainLine(xz: vec2f, thr: f32) -> vec4f {
  let m = i32(U.surf.y);
  let cs = G.terrain.x / f32(m);
  let pc = worldToUV(xz) * f32(m);
  let ci = vec2i(floor(pc));
  var best = vec4f(9.0, 0.0, 0.0, 0.0);
  for (var dj = -1; dj <= 1; dj++) {
    for (var di = -1; di <= 1; di++) {
      let c = ci + vec2i(di, dj);
      if (any(c < vec2i(0)) || any(c >= vec2i(m))) { continue; }
      let t = textureLoad(tSurf, c, 3, 0);
      let k = u32(round((t.r * 255.0) / 28.0));
      if ((k >= 8u) || (t.g < thr)) { continue; }
      let r = c + d8Off(k);
      let a = vec2f(c) + 0.5 + cellJit(c);
      let b = vec2f(r) + 0.5 + cellJit(r);
      let e = b - a;
      let tt = clamp(dot(pc - a, e) / max(dot(e, e), 1e-4), 0.0, 1.0);
      let q = pc - (a + (e * tt));
      let d = length(q);
      if (d < best.x) { best = vec4f(d, t.g, q / max(d, 1e-4)); }
    }
  }
  return vec4f(best.x * cs, best.yzw);
}

// Transverse dunes across the prevailing wind wd (unit, toward): gentle
// stoss slope upwind, steep slip face downwind, sinuous crests. lam: the
// wavelength m. -> (h m, dh/dx, dh/dz). Twin: surface-sim dune.
fn dune(xz: vec2f, wd: vec2f, lam: f32) -> vec3f {
  let ac = vec2f(-wd.y, wd.x);
  let along = dot(xz, wd);
  let across = dot(xz, ac);
  let s1 = across / (lam * 2.7);
  let s2 = (across / (lam * 1.1)) + 1.3;
  let s = (along / lam) + (0.35 * sin(s1)) + (0.25 * sin(s2));
  let dsA = 1.0 / lam;
  let dsC = ((0.35 * cos(s1)) / (lam * 2.7)) + ((0.25 * cos(s2)) / (lam * 1.1));
  let f = fract(s);
  let c = 0.72;
  var p = 0.0;
  var dp = 0.0;
  if (f < c) {
    p = 0.5 - (0.5 * cos(GPI * f / c));
    dp = (0.5 * GPI / c) * sin(GPI * f / c);
  } else {
    let g = (f - c) / (1.0 - c);
    p = 0.5 + (0.5 * cos(GPI * g));
    dp = -(0.5 * GPI / (1.0 - c)) * sin(GPI * g);
  }
  let A = 0.07 * lam;
  let gr = (A * dp) * ((wd * dsA) + (ac * dsC));
  return vec3f(A * p, gr);
}

// Snow cover at height y with the snow line `line`: it holds on low slopes
// (slope = 1 - n.y), in shade (shade -1 sunny .. 1 shaded) and in the lee
// (drift > 0.5). Twin: surface-sim snowAmount.
fn snowAmount(y: f32, line: f32, slope: f32, shade: f32, drift: f32) -> f32 {
  var a = smoothstep(line - 160.0, line + 80.0, y + (shade * 120.0) + ((drift - 0.5) * 260.0));
  a *= 1.0 - smoothstep(0.30, 0.52, slope);
  return a;
}

// The rock layers (LIB erodeGrid strata): phase at height y with the warp
// of the fields; one period (2) holds a hard band and a soft band.
// -> x phase, y hard 0..1, z layer index
fn strataAt(y: f32, warp: f32) -> vec3f {
  let ph = (((y - U.geo.x) / max(U.geo.y, 1.0)) * U.geo.z * 2.0) + ((warp - 0.5) * 6.0);
  let band = 0.5 + (0.5 * cos(ph * GPI));
  return vec3f(ph, smoothstep(0.55, 0.8, band), floor((ph + 1.0) * 0.5));
}

// The colour of rock layer idx: a sedimentary palette (red and buff
// sandstone, limestone, grey shale, chocolate mudstone) for the sandstone
// region, a grey tone shift for granite and gneiss.
fn strataCol(idx: f32, region: vec3f) -> vec3f {
  let k = vec2i(i32(idx), 0);
  let h0 = hash21(k, 11u);
  let h1 = hash21(k, 5u);
  var sc = vec3f(0.36, 0.165, 0.085);
  if (h0 > 0.30) { sc = vec3f(0.46, 0.31, 0.19); }
  if (h0 > 0.52) { sc = vec3f(0.54, 0.46, 0.36); }
  if (h0 > 0.70) { sc = vec3f(0.27, 0.25, 0.22); }
  if (h0 > 0.86) { sc = vec3f(0.30, 0.18, 0.14); }
  sc *= 0.88 + (0.24 * h1);
  // granite / gneiss: light and dark bands (felsic and mafic)
  let gc = vec3f(0.136, 0.131, 0.124) * mix(0.72, 1.3, h0) * mix(vec3f(1.04, 1.0, 0.95), vec3f(0.96, 1.0, 1.05), h1);
  let bc = vec3f(0.078, 0.073, 0.068) * mix(0.85, 1.15, h0);
  return (gc * region.x) + (sc * region.y) + (bc * region.z);
}

// ------------------------------------------------------- rock structure --
// Blocky rock (2 m to 500 m). Three fracture sets follow the strata:
//   set 0, the bedding: planes of equal bedding coordinate bc (fn bedCoord:
//     the LIB strata height with the warp of the fields, so the beds follow
//     the layer colours of fn strataAt),
//   set 1, the dip joints: vertical planes with the normal U.rock.xy (the
//     regional dip direction of the strata, surface-sim rockFrame),
//   set 2, the strike joints: vertical planes normal to set 1.
// The joint spacing follows the bed thickness (thick beds, big blocks).
// Set 1 joints stop at the bedding planes and set 2 joints at set 1
// joints (staggered T junctions), as in jointed sandstone and granite.
// The relief is in metres along the surface normal. Each set steps the
// face: one asymmetric triangle per cell (a steep riser, a flat tread, the
// lip stands out), so a slope cut across the planes becomes a stair of
// blocks. Each block has its own offset; edges are rounded; open joints
// are cracks. Two lattices: the blocks (H0, about 1 to 4 m) and the
// buttresses (7 x H0), so a face has structure from 2 m to 500 m.
// JS twin of the joint frame: surface-sim.js rockFrame / jointFrame.

struct RockF {
  h: f32,      // relief m: steps + block offset + bevel + crack
  hf: f32,     // fine relief m (bevel + crack, <= 0): the POM height
  g: vec3f,    // gradient of h (world)
  e: f32,      // distance m to the nearest joint or bedding plane
  crack: f32,  // 0..1 open crack (filtered by the footprint)
  id: vec3f,   // block hashes 0..1
  bedF: f32,   // place in the bed: 0 bottom .. 1 top
  bedT: f32,   // bed thickness m
  tread: f32,  // 0..1 on the flat tread of a step (a ledge top)
  eo: f32,     // distance m to the nearest open joint
  idB: vec3f,  // the hashes of the buttress block (the texture choice)
};

fn rkH(a: i32, b: i32, c: u32) -> f32 { return hash21(vec2i(a, b), c); }

// boundary k of the bedding (spacing H0, jittered +-0.21 H0)
fn bedB(k: i32, H0: f32, s: u32) -> f32 { return H0 * (f32(k) + (0.42 * (rkH(k, 17, s) - 0.5))); }

// the bedding coordinate m: the height with the strata warp (the same
// phase as fn strataAt, in metres) and a slow 6 m wave
fn bedCoord(p: vec3f, warp: f32) -> f32 {
  let A = max((U.geo.z * 2.0) / max(U.geo.y, 1.0), 1e-4);
  return p.y + (fbm2(p.xz * 0.01, 2) * 6.0) + (((warp - 0.5) * 6.0) / A);
}

// asymmetric triangle: value 0..1 (peak at 1 - tau) and its slope d/df
fn rkTri(f: f32, tau: f32) -> vec2f {
  if (f < 1.0 - tau) { return vec2f(f / (1.0 - tau), 1.0 / (1.0 - tau)); }
  return vec2f((1.0 - f) / tau, -1.0 / tau);
}

// smoothstep(0, w, e) and its derivative d/de
fn rkSS(w: f32, e: f32) -> vec2f {
  let t = clamp(e / max(w, 1e-5), 0.0, 1.0);
  return vec2f(t * t * (3.0 - (2.0 * t)), (6.0 * t * (1.0 - t)) / max(w, 1e-5));
}

// boundary j of a jittered 1D lattice (unit spacing, +-0.17): -> position
fn jitB(j: i32, k: i32, s: u32) -> f32 { return f32(j) + (0.34 * (rkH(j, k, s) - 0.5)); }
// the cell of u in that lattice -> (index, start, width)
fn jitCell(u: f32, k: i32, s: u32) -> vec3f {
  let j0 = i32(floor(u));
  var j = j0;
  if (u < jitB(j0, k, s)) { j = j0 - 1; }
  else if (u >= jitB(j0 + 1, k, s)) { j = j0 + 1; }
  let a = jitB(j, k, s);
  return vec3f(f32(j), a, max(jitB(j + 1, k, s) - a, 0.2));
}
fn rkRot(d: vec2f, a: f32) -> vec2f { return vec2f((d.x * cos(a)) - (d.y * sin(a)), (d.x * sin(a)) + (d.y * cos(a))); }

// One lattice. p: pattern position, bc: bedding coordinate, gb: its
// gradient, n: surface normal, H0: bed spacing m, fp: pixel footprint m,
// s: seed, stepK: stair strength, crackK: crack width factor. The rock
// kind sed (U.rock.w: 0 massive granite and gneiss, 1 bedded sandstone)
// sets the style: thick sheeting joints, few open planes and round blocks
// (granite), or thin beds that split and stand out as ledges (sandstone).
// The planes are not ideal: the beds wave, set 1 turns per bed (+-14 deg)
// and set 2 per set 1 cell (+-20 deg), each plane is jittered and wavy.
fn rockSet(p: vec3f, bc0: f32, gb: vec3f, n: vec3f, H0in: f32, fp: f32, s: u32, stepK: f32, crackK: f32, tiltK: f32) -> RockF {
  var r: RockF;
  let sed = clamp((U.rock.w - 0.8) / 0.5, 0.0, 1.0);
  let H0 = H0in * mix(2.6, 1.0, sed);
  // set 0: the bed of bc (wavy)
  let bc = bc0 + (vnoise2((p.xz / (H0 * 6.0)) + vec2f(f32(s) * 0.37, 1.3)) * 0.2 * H0);
  let kf = i32(floor(bc / H0));
  var k = kf;
  if (bc < bedB(kf, H0, s)) { k = kf - 1; }
  else if (bc >= bedB(kf + 1, H0, s)) { k = kf + 1; }
  let b0 = bedB(k, H0, s);
  let tB = max(bedB(k + 1, H0, s) - b0, 0.05 * H0);
  let fB = clamp((bc - b0) / tB, 0.0, 1.0);
  // set 1 in bed k: turned per bed, spacing from the bed (sandstone) or
  // from H0 (granite), jittered and wavy planes
  // (granite has no beds: its joints run on through the sheeting zones,
  // kj = 0; bedded rock staggers its joints per bed, kj = k)
  let kj = select(k, 0, sed < 0.5);
  let d1 = rkRot(U.rock.xy, (rkH(kj, 41, s) - 0.5) * mix(0.5, 0.18, sed));
  let S1 = clamp(mix(H0 * mix(0.8, 1.9, rkH(kj, 3, s + 1u)), tB * mix(1.0, 2.4, rkH(k, 3, s + 1u)), sed), 0.4 * H0, 6.0 * H0);
  let u1 = (dot(p.xz, d1) / S1) + rkH(kj, 5, s + 2u) + (vnoise2((p.xz / (S1 * 3.0)) + vec2f(f32(kj) * 1.7, 3.1)) * 0.2);
  let c1 = jitCell(u1, kj, s + 14u);
  let i1 = i32(c1.x);
  let f1 = clamp((u1 - c1.y) / c1.z, 0.0, 1.0);
  let W1 = c1.z * S1;
  // set 2 in (bed, set 1 cell): in bedded rock turned and offset per
  // cell (the joints stagger and end at set 1 joints: T junctions); in
  // granite one long set (ki = 0)
  let ki = select(i1, i32(floor(f32(i1) / 3.0)), sed < 0.5);
  let d2 = rkRot(vec2f(-d1.y, d1.x), (rkH(kj, ki + 77, s) - 0.5) * mix(0.3, 0.35, sed));
  let S2 = S1 * mix(0.9, 1.8, rkH(kj, 7, s + 3u));
  let u2 = (dot(p.xz, d2) / S2) + rkH(kj, ki, s + 4u) + (vnoise2((p.xz / (S2 * 3.0)) + vec2f(f32(ki) * 2.3, f32(kj))) * 0.2);
  let c2 = jitCell(u2, kj * 131 + ki, s + 15u);
  let i2 = i32(c2.x);
  let f2 = clamp((u2 - c2.y) / c2.z, 0.0, 1.0);
  let W2 = c2.z * S2;
  r.id = vec3f(rkH(k, i1 * 7 + i2, s + 5u), rkH(i1, i2, s + 6u), rkH(k + i2, i1, s + 7u));
  r.bedF = fB; r.bedT = tB;
  // distances to the six planes of the block (m) and their gradients
  let eB = min(fB, 1.0 - fB) * tB;
  let e1 = min(f1, 1.0 - f1) * W1;
  let e2 = min(f2, 1.0 - f2) * W2;
  let gB = gb * select(-1.0, 1.0, fB < 0.5);
  let g1 = vec3f(d1.x, 0.0, d1.y) * select(-1.0, 1.0, f1 < 0.5);
  let g2 = vec3f(d2.x, 0.0, d2.y) * select(-1.0, 1.0, f2 < 0.5);
  // which planes are open joints (sandstone splits on its beds; granite
  // on few sheeting planes)
  let gran = 1.0 - smoothstep(0.35, 0.65, sed);
  let oB = step(mix(0.8, 0.55, sed), rkH(select(k + 1, k, fB < 0.5), 23, s + 8u)) * (1.0 - gran);
  let o1 = step(mix(0.7, 0.3, sed), rkH(kj, select(i1 + 1, i1, f1 < 0.5), s + 9u));
  let o2 = step(mix(0.8, 0.5, sed), rkH(kj * 31 + ki, select(i2 + 1, i2, f2 < 0.5), s + 10u));
  // the stairs: each set steps a face that cuts its planes at an angle
  // (the lattice fades out where a bed is under about 12 px)
  let fade = 1.0 - smoothstep(0.04 * H0, 0.16 * H0, fp);
  let stK = stepK * mix(0.55, 1.0, sed);
  var h = 0.0;
  var g = vec3f(0.0);
  var tread = 0.0;
  {
    let nb = normalize(gb);
    let c = dot(n, nb);
    let kk = 1.6 * abs(c) * sqrt(max(1.0 - (c * c), 0.0)) * stK * fade * mix(0.5, 1.0, oB) * (1.0 - gran);
    let sg = select(-1.0, 1.0, c >= 0.0);
    let t = rkTri(select(1.0 - fB, fB, c >= 0.0), 0.38);
    h += kk * tB * (t.x - 0.5);
    g += gb * (kk * t.y * sg);
    tread = max(tread, select(0.0, kk, t.y < 0.0));
  }
  {
    let d = vec3f(d1.x, 0.0, d1.y);
    let c = dot(n, d);
    let kk = 1.6 * abs(c) * sqrt(max(1.0 - (c * c), 0.0)) * stK * 0.6 * fade * sed * o1;
    let sg = select(-1.0, 1.0, c >= 0.0);
    let t = rkTri(select(1.0 - f1, f1, c >= 0.0), 0.3);
    h += kk * W1 * (t.x - 0.5);
    g += d * (kk * t.y * sg);
  }
  {
    let d = vec3f(d2.x, 0.0, d2.y);
    let c = dot(n, d);
    let kk = 1.6 * abs(c) * sqrt(max(1.0 - (c * c), 0.0)) * stK * 0.4 * fade * o2 * sed;
    let sg = select(-1.0, 1.0, c >= 0.0);
    let t = rkTri(select(1.0 - f2, f2, c >= 0.0), 0.3);
    h += kk * W2 * (t.x - 0.5);
    g += d * (kk * t.y * sg);
  }
  r.tread = clamp(tread * 2.0, 0.0, 1.0);
  // each block its own offset (hidden at the joints by the bevel and
  // crack), and its face is not a plane: a slow wave per block
  let bw = min(min(tB, W1), W2);
  h += (r.id.x - 0.5) * 0.1 * min(tB, W1) * fade * sed;
  // (stepK 0: the POM height alone, fn rockFine: no face waves)
  if (stepK > 0.0) {
    let un = vnoised((p * (1.6 / bw)) + (r.id * 31.0));
    h += un.x * 0.035 * bw * fade;
    g += un.yzw * (0.056 * fade);
  }
  // each block face is a plane of its own tilt: broken faces (the facets
  // of granite, the tilted blocks of sandstone)
  let tilt = (vec3f(r.id.y, r.id.z, rkH(i2, k, s + 18u)) - 0.5) * (mix(0.5, 0.22, sed) * fade * tiltK);
  g += tilt;
  // rounded edges: the nearest plane of the block; closed planes round a
  // little, open ones more (granite blocks weather round)
  var e = select(eB, 9.0, gran > 0.5);
  var ge = gB;
  var oe = oB;
  if (e1 < e) { e = e1; ge = g1; oe = o1; }
  if (e2 < e) { e = e2; ge = g2; oe = o2; }
  r.e = e;
  // (a closed joint of granite does not show; bedded rock rounds its
  // closed bed joints a little)
  let R = clamp(mix(0.26, 0.15, sed) * min(tB, W1), 0.03, min(0.5 * H0, 0.6)) * mix(0.35 * sed, 1.0, oe);
  var hf = 0.0;
  if (e < R) {
    let q = 1.0 - (e / R);
    hf -= R * 0.5 * q * q;
    g += ge * (q * fade);
  }
  // open cracks, each its own width; the width grows to the footprint and
  // the depth and darkness fall with it (filtered)
  let wB = mix(0.004, 0.03, rkH(k, 29, s + 11u)) * crackK * H0;
  let w1 = mix(0.004, 0.03, rkH(k, i1, s + 12u)) * crackK * H0;
  let w2 = mix(0.003, 0.022, rkH(i1, i2, s + 13u)) * crackK * H0;
  let D = clamp(0.25 * min(tB, W1), 0.04, 0.6 * H0);
  var crack = 0.0;
  var eo = 9.0;
  // chipped edges: the crack widths wander along the joint (close up)
  let chip = select(0.0, vnoised(p * (2.5 / H0)).x * (0.5 * (1.0 - smoothstep(0.01, 0.04, fp))), (fade > 0.0) && (stepK > 0.0));
  for (var j = 0; j < 3; j++) {
    let w = select(select(w2, w1, j == 1), wB, j == 0);
    let o = select(select(o2, o1, j == 1), oB, j == 0);
    let ej = select(select(e2, e1, j == 1), eB, j == 0);
    let gj = select(select(g2, g1, j == 1), gB, j == 0);
    if (o < 0.5) { continue; }
    eo = min(eo, ej);
    let wf = max(w * (1.0 + chip), fp * 1.2);
    let ss = rkSS(wf, ej);
    crack = max(crack, (1.0 - ss.x) * (w / wf));
    hf -= D * (1.0 - ss.x) * (w / wf);
    g += gj * (D * ss.y * (w / wf) * fade);
  }
  r.eo = eo;
  r.crack = crack * fade;
  r.hf = hf * fade;
  r.h = h + r.hf;
  r.g = g;
  r.idB = r.id;
  return r;
}

// Broken faces at mid range: the cones of the 3D Worley F1 distance (cell
// m, slope A). The surface stays continuous (no steps): planar-looking
// faces meet at sharp ridges on the cell borders, as on frost-shattered
// granite and gneiss. -> x h m, yzw gradient
fn facet3(p: vec3f, cell: f32, A: f32) -> vec4f {
  let q = p / cell;
  let fl = floor(q);
  let i = vec3i(fl);
  let f = q - fl;
  var d1 = 9.0;
  var r1 = vec3f(0.0);
  for (var z = -1; z <= 1; z++) {
    for (var y = -1; y <= 1; y++) {
      for (var x = -1; x <= 1; x++) {
        let c = vec3i(x, y, z);
        let h = hash33(i + c);
        let r = vec3f(c) + (h * 0.8) + 0.1 - f;
        let d = dot(r, r);
        if (d < d1) { d1 = d; r1 = r; }
      }
    }
  }
  let d = sqrt(d1);
  // h = A cell F1 rises away from the site: the ridges on the cell borders
  return vec4f(A * cell * d, (-r1 / max(d, 1e-4)) * A);
}

// Both lattices at p: the blocks and the buttresses (7 x H0, wider joints).
// big: weight of the buttress lattice (0: blocks only, the cheap path).
// idB: the hashes of the buttress block (the rock scan and its offset
// change only at the big open joints, not at every block).
fn rockField(p: vec3f, bc: f32, gb: vec3f, n: vec3f, fp: f32, big: f32) -> RockF {
  let H0 = max(U.rock.z, 0.3);
  var r = rockSet(p, bc, gb, n, H0, fp, 101u, 0.55, 1.0, 0.0);
  if (big > 0.01) {
    let b = rockSet(p, bc + 3.7, gb, n, H0 * 7.0, fp, 211u, 0.5, 0.3, 0.0);
    // (the buttress bevels and cracks are relief, not the cavity of fs)
    r.h += b.h * big;
    r.g += b.g * big;
    r.crack = max(r.crack, b.crack * big);
    r.tread = max(r.tread, b.tread * big);
    r.eo = min(r.eo, b.eo);
    r.idB = b.id;
    // granite and gneiss: broken faces at 12 and 45 m (normals only)
    let gran = 1.0 - smoothstep(0.35, 0.65, clamp((U.rock.w - 0.8) / 0.5, 0.0, 1.0));
    let fK = mix(0.12, 0.6, gran) * big;
    // (the 12 m facets fade in past about 10 m: close up, their straight
    // creases read as folded paper)
    let fa = facet3(p + vec3f(31.0, 0.0, 17.0), 12.0, 0.45 * fK * smoothstep(0.004, 0.02, fp) * (1.0 - smoothstep(1.5, 4.0, fp)));
    let fb = facet3(p, 45.0, 0.5 * fK * (1.0 - smoothstep(6.0, 15.0, fp)));
    r.g += fa.yzw + fb.yzw;
  }
  return r;
}

// the fine relief alone (the POM height, <= 0): bevels and cracks of the
// block lattice
fn rockFine(p: vec3f, bc: f32, gb: vec3f, n: vec3f, fp: f32) -> f32 {
  return rockSet(p, bc, gb, n, max(U.rock.z, 0.3), fp, 101u, 0.0, 1.0, 0.0).hf;
}

// Talus at the foot of a face: blocks 0.4 to 1.6 m lie on the scree (one
// Voronoi cell each, a faceted dome). amt: the scree share 0..1. -> x
// height m (>= 0), yz d/dxz, w the contact shade 0..1 (1 at a block foot)
fn talus(xz: vec2f, amt: f32, fp: f32) -> vec4f {
  if (amt < 0.02) { return vec4f(0.0); }
  let cell = 1.7;
  let v = voronoi2(xz / cell);
  let hsh = hash33(vec3i(i32(v.w * 65535.0), 5, 77));
  let present = step(1.0 - (amt * 0.85), hsh.x);
  let r = cell * mix(0.18, 0.42, hsh.y);
  let d = v.x * cell;
  let fade = 1.0 - smoothstep(0.08 * r, 0.3 * r, fp);
  if ((present < 0.5) || (fade <= 0.0)) { return vec4f(0.0); }
  // a dome cut by two tilted planes (facets)
  let q = clamp(1.0 - ((d * d) / (r * r)), 0.0, 1.0);
  let top = r * 0.7;
  var hh = top * sqrt(q);
  let off = -vec2f(v.y, v.z) * cell;     // xz minus the site (m)
  let a = (hsh.z - 0.5) * 3.0;
  let pl = vec2f(cos(a), sin(a));
  hh = min(hh, (top * 0.8) + (dot(off, pl) * 0.6));
  hh = min(hh, (top * 0.9) - (dot(off, vec2f(-pl.y, pl.x)) * 0.5));
  hh = max(hh, 0.0);
  // gradient by the dome (facet tops are flatter)
  let gd = select(vec2f(0.0), -(off / max(r * r, 1e-4)) * (top / max(sqrt(q), 0.05)), q > 0.0);
  let foot = (1.0 - smoothstep(r * 0.9, r * 1.35, d)) * (1.0 - smoothstep(0.0, 0.08, hh)) * step(r * 0.7, d);
  return vec4f(hh, gd * step(1e-4, hh), foot) * fade;
}

// ------------------------------------------------------------ hex tiling --
// Hex tiling (Mikkelsen 2022, "Practical Real-Time Hex-Tiling", JCGT
// 11(3)): three samples of a texture on a triangle grid, each vertex with
// its own random offset (and turn, rot > 0), blended by barycentric
// weights sharpened by the sample luminance. The tile grid does not
// repeat. JS twin of the weights: ground.js hexWeights.
// -> the three weights (sum 1) and the three vertex ids.
struct HexW { w: vec3f, v1: vec2i, v2: vec2i, v3: vec2i };
fn hexGrid(uv: vec2f) -> HexW {
  let st = uv * 3.4641016;   // 2 sqrt(3)
  let sk = vec2f(st.x - (0.57735027 * st.y), 1.15470054 * st.y);
  let b = vec2i(floor(sk));
  let fr = fract(sk);
  let tz = 1.0 - fr.x - fr.y;
  let s = step(0.0, -tz);
  let s2 = (2.0 * s) - 1.0;
  var o: HexW;
  o.w = vec3f(-tz * s2, s - (fr.y * s2), s - (fr.x * s2));
  let si = i32(s);
  o.v1 = b + vec2i(si, si);
  o.v2 = b + vec2i(si, 1 - si);
  o.v3 = b + vec2i(1 - si, si);
  return o;
}
// the uv transform of hex vertex v: a turn (rot 0..1 of a full turn) and
// an offset -> (cos, sin, offset)
fn hexXf(v: vec2i, rot: f32) -> vec4f {
  let h = hash33(vec3i(v, 613));
  let a = (h.x - 0.5) * 6.2831853 * rot;
  return vec4f(cos(a), sin(a), h.yz * 7.0);
}
fn hexUV(uv: vec2f, x: vec4f) -> vec2f { return vec2f((x.x * uv.x) - (x.y * uv.y), (x.y * uv.x) + (x.x * uv.y)) + x.zw; }
fn hexRot(g: vec2f, x: vec4f) -> vec2f { return vec2f((x.x * g.x) - (x.y * g.y), (x.y * g.x) + (x.x * g.y)); }
// a normal map xy turned back by the vertex turn (the map was sampled turned)
fn hexNrm(t: vec4f, x: vec4f) -> vec4f {
  let m = (t.xy * 2.0) - 1.0;
  let r = vec2f((x.x * m.x) + (x.y * m.y), (-x.y * m.x) + (x.x * m.y));
  return vec4f((r * 0.5) + 0.5, t.zw);
}
// weights sharpened (Mikkelsen: an even blend of three samples loses the
// contrast; leaf litter turned to mush), a little toward the brighter
// sample, then normalised to sum 1. A strong luminance term picks the
// brightest sample everywhere: a speckled granite scan then turned into
// salt and pepper, so the luminance power stays small.
fn hexSharp(w: vec3f, lum: vec3f) -> vec3f {
  // max(w, 0): a weight a hair under 0 (float) makes pow() NaN in WGSL
  let ww = max(w, vec3f(0.0)) * pow(max(lum, vec3f(1e-3)), vec3f(0.3));
  let p = pow(ww, vec3f(6.0));
  return p / max(p.x + p.y + p.z, 1e-12);
}
fn tex3Hex(k: u32, uv: vec2f, gu: vec2f, gv: vec2f, rot: f32) -> array<vec4f, 3> {
  let hx = hexGrid(uv);
  let x1 = hexXf(hx.v1, rot);
  let x2 = hexXf(hx.v2, rot);
  let x3 = hexXf(hx.v3, rot);
  let a = tex3(k, hexUV(uv, x1), hexRot(gu, x1), hexRot(gv, x1));
  let b = tex3(k, hexUV(uv, x2), hexRot(gu, x2), hexRot(gv, x2));
  let c = tex3(k, hexUV(uv, x3), hexRot(gu, x3), hexRot(gv, x3));
  let L = vec3f(0.3, 0.59, 0.11);
  let w = hexSharp(hx.w, vec3f(dot(a[0].rgb, L), dot(b[0].rgb, L), dot(c[0].rgb, L)));
  return array<vec4f, 3>(
    (a[0] * w.x) + (b[0] * w.y) + (c[0] * w.z),
    (hexNrm(a[1], x1) * w.x) + (hexNrm(b[1], x2) * w.y) + (hexNrm(c[1], x3) * w.z),
    (a[2] * w.x) + (b[2] * w.y) + (c[2] * w.z));
}

// ------------------------------------------------------------------ POM --
// Parallax occlusion on rock within U.fx.z metres (high quality, not on
// phones): march the view ray into the fine relief (bevels, cracks) of
// the block lattice. JS twin of the step count: ground.js pomSteps.
const POM_MAX: i32 = 12;
const POM_DEPTH: f32 = 0.35;
fn pomSteps(dist: f32, ndv: f32) -> i32 {
  if ((U.fx.x < 0.5) || (dist >= U.fx.z)) { return 0; }
  let k = 1.0 - smoothstep(U.fx.z * 0.6, U.fx.z, dist);
  let n = mix(4.0, f32(POM_MAX), clamp(1.0 - ndv, 0.0, 1.0)) * k;
  if (n < 2.0) { return 0; }
  return min(i32(ceil(n)), POM_MAX);
}
// -> the offset position (moved along -V into the relief)
fn pom(pb: vec3f, V: vec3f, n: vec3f, bc0: f32, gb: vec3f, fp: f32, steps: i32) -> vec3f {
  let ndv = max(dot(n, V), 0.2);
  let dt = (POM_DEPTH / ndv) / f32(steps);
  var t = 0.0;
  var prev = 0.0;
  for (var i = 0; i < POM_MAX; i++) {
    if (i >= steps) { break; }
    t += dt;
    let q = pb - (V * t);
    // the bedding coordinate moves with q (gb: its gradient)
    let hf = rockFine(q, bc0 + dot(gb, q - pb), gb, n, fp);
    let diff = (t * ndv) + hf;
    if (diff >= 0.0) {
      t -= dt * (diff / max(diff - prev, 1e-5));
      break;
    }
    prev = diff;
  }
  return pb - (V * t);
}
// micro shadow of the fine relief toward the sun: 4 steps; 1 = lit
fn pomShadow(pb: vec3f, L: vec3f, n: vec3f, bc0: f32, gb: vec3f, fp: f32) -> f32 {
  let ndl = dot(n, L);
  if (ndl <= 0.02) { return 1.0; }
  let h0 = rockFine(pb, bc0, gb, n, fp);
  var vis = 1.0;
  for (var i = 1; i <= 4; i++) {
    let t = f32(i) * 0.06;
    let q = pb + (L * t);
    let ray = h0 + (t * ndl);
    let hs = rockFine(q, bc0 + dot(gb, q - pb), gb, n, fp);
    vis = min(vis, clamp(((ray - hs) / 0.03) + 0.5, 0.0, 1.0));
  }
  return vis;
}

// the bare rock share of the vertex relief (fs uses its layer weights)
fn rockMaskOf(slope: f32, reg: f32, scree: f32) -> f32 {
  return smoothstep(0.2, 0.36, slope) * (1.0 - smoothstep(0.1, 0.4, reg)) * (1.0 - smoothstep(0.3, 0.7, scree));
}
// the talus share: scree on moderate slopes (the foot of a face)
fn talusAmt(scree: f32, slope: f32) -> f32 {
  return smoothstep(0.15, 0.6, scree) * (1.0 - smoothstep(0.45, 0.7, slope));
}

// The rock scan of a block: layered beds (U.rsets.x) in the sandstone
// region, else the jointed blocks (U.rsets.y), the cliff face or the rock
// face of the layer map, by the block hash. kP: the rock layer set.
fn rockPick(id: vec3f, region: vec3f, kP: u32) -> u32 {
  let kL = u32(U.rsets.x + 0.5);
  let kB = u32(U.rsets.y + 0.5);
  let kC = mapIdx(1u);
  let h = id.z;
  // massive rock: one scan (a change of scan at every buttress drew seams
  // in a grid on granite slabs)
  if ((U.rock.w < 1.05) && (kC < 64u)) { return kC; }
  if ((kL < 64u) && (region.y > (h * 2.0))) { return kL; }
  if ((kB < 64u) && (h < 0.25) && (region.y > 0.3)) { return kB; }
  if ((kC < 64u) && (h < 0.6)) { return kC; }
  return kP;
}

// Small stones on soil, 6 mm to 3 cm, seen within about 10 m: two Voronoi
// scales of domes with a dark contact ring. dens: the share of cells with
// a stone. -> x albedo factor, yz slope to add (d/dxz), w cover
fn grit(xz: vec2f, fp: f32, dens: f32) -> vec4f {
  var f = 1.0;
  var g = vec2f(0.0);
  var cov = 0.0;
  for (var o = 0; o < 2; o++) {
    let sc = select(85.0, 32.0, o == 0);
    let fade = 1.0 - smoothstep(0.12 / sc, 0.4 / sc, fp);
    if (fade <= 0.0) { continue; }
    let v = voronoi2((xz * sc) + vec2f(f32(o) * 17.3));
    let hs = hash33(vec3i(i32(v.w * 65535.0), o, 31));
    if (hs.x > dens) { continue; }
    let r = mix(0.22, 0.44, hs.y);
    let q = 1.0 - ((v.x * v.x) / (r * r));
    if (q > 0.0) {
      f *= mix(1.0, mix(0.62, 1.4, hs.z), fade);
      // the dome: d h / d xz = (site - x) * 2 k / r^2, k = 0.4 r (cells)
      g += vec2f(v.y, v.z) * ((0.8 / r) * fade);
      cov = max(cov, fade);
    } else {
      f *= 1.0 - (0.3 * (1.0 - smoothstep(r, r * 1.35, v.x)) * fade);
    }
  }
  return vec4f(f, g, cov);
}

// Thin roots and twigs in the forest floor and turf, within about 8 m: the
// zero lines of a warped noise. -> 0..1 cover
fn roots(xz: vec2f, fp: f32) -> f32 {
  let fade = 1.0 - smoothstep(0.004, 0.012, fp);
  if (fade <= 0.0) { return 0.0; }
  let w = vec2f(vnoise2(xz * 1.3), vnoise2((xz * 1.3) + 7.1)) * 0.6;
  let n = vnoise2((xz * 2.2) + w);
  let width = 0.035 + (fp * 2.0);
  let mask = smoothstep(0.1, 0.5, vnoise2((xz * 0.6) + 3.3));
  return (1.0 - smoothstep(0.0, width, abs(n))) * mask * fade;
}

// --------------------------------------------------------------- layers --

struct Mat { alb: vec3f, h: vec4f, rough: f32, tn: vec3f, ao: f32 };
// h: x height 0..1, yzw gradient (1/m); tn: texture normal offset (world, in
// the tangent plane); ao: texture occlusion

// What the surface fields tell the rock at a point.
struct RockGeo {
  warp: f32,   // strata warp field (0.5 none)
  vis: f32,    // how much the layers show (LIB strata strength, sandstone region)
  age: f32,    // exposure age 0..1 (lichen, moss, varnish)
  glac: f32,   // glacial polish 0..1
  ice: f32,    // ice flow direction / PI
  shade: f32,  // -1 sunny face .. 1 shaded face
  arid: f32,   // 1 dry climate
  facet: f32,  // the tone of the rock facet (fn facets)
};

// Lichen rosettes on old rock, seen within about 25 m: round crusts with
// lobed edges (one Voronoi cell each, 4 to 10 cm), on the plane of the
// face. dens: the share of cells with a crust. -> rgb colour, a cover.
fn lichen(p: vec3f, n: vec3f, fp: f32, dens: f32) -> vec4f {
  let sc = 5.0;
  let fade = 1.0 - smoothstep(0.02, 0.05, fp);
  if ((dens < 0.02) || (fade <= 0.0)) { return vec4f(0.0); }
  let an = abs(n);
  var uv = p.xz;
  if ((an.x > an.y) && (an.x > an.z)) { uv = p.zy; }
  else if (an.z > an.y) { uv = p.xy; }
  let v = voronoi2(uv * sc);
  let hs = hash33(vec3i(i32(v.w * 65535.0), 9, 4));
  if (hs.x > dens) { return vec4f(0.0); }
  let r = mix(0.22, 0.46, hs.y);
  let ang = atan2(v.z, v.y);
  let re = r * (1.0 + (0.16 * sin((ang * 7.0) + (hs.z * 6.28))) + (0.07 * sin((ang * 13.0) + (hs.y * 4.0))));
  let aa = fp * sc;
  let cov = 1.0 - smoothstep(re - 0.03 - aa, re + aa, v.x);
  // yellow-green map lichen, grey-green crust, orange on perches, pale grey
  var col = vec3f(0.36, 0.38, 0.11);
  if (hs.z > 0.35) { col = vec3f(0.27, 0.29, 0.23); }
  if (hs.z > 0.70) { col = vec3f(0.36, 0.34, 0.30); }
  if (hs.z > 0.90) { col = vec3f(0.52, 0.24, 0.05); }
  // the centre is older and paler, the rim fresh
  col *= mix(1.08, 0.86, smoothstep(0.0, re, v.x));
  return vec4f(col, cov * fade);
}

// Rock: the LIB strata (hard bands in lighter, thicker beds, a colour per
// layer), the block lattice of fn rockField (rk: stairs, block tones,
// weathering rinds on the edges, iron stain, cracks), varnish and water
// streaks that run down from the ledge lips, lichen crusts, moss on wet
// shaded rock, glacial polish and striations. region: x granite / gneiss,
// y sandstone (deserts), z basalt. down: the downhill direction (xz).
fn layerRock(p: vec3f, fp: f32, cliff: f32, moist: f32, region: vec3f, down: vec2f, slope: f32, geo: RockGeo, rk: RockF, nG: vec3f) -> Mat {
  var m: Mat;
  let big = fbmd(p, 0.07, 3, 0.5, fp);
  let polish = 1.0 - (0.7 * geo.glac);
  // grain: 4 octaves with the ASSETS textures on (they bring the fine grain)
  let fine = fbmd(p, 0.9, select(6, 4, U.mat.x > 0.5), 0.5, fp);
  // one mid-scale field for the mottle, the lichen and the weathering
  let midN = fbmd(p, 0.3, 3, 0.55, fp).x;
  let ridged = fine.x * 0.5 + 0.5;
  // the layer height: block tops stand up, cracks and bed joints sink
  // (rock pokes through soil and scree at its blocks)
  // (only the bevels and cracks: a whole block lower than its neighbours
  // let a thin soil weight win the blend there, in block-shaped patches)
  var h = 0.5 + (0.1 * big.x) + (0.08 * fine.x * polish) + clamp(rk.hf * 1.5, -0.3, 0.0) + clamp(rk.h * 0.1, -0.06, 0.06) - (rk.crack * 0.2);
  // the fine grain bump; the block relief is rk.g (fs adds it)
  var g = (big.yzw * 0.10) + (fine.yzw * (0.12 * polish));
  let warpY = (big.x * 4.0) + (fbm2(p.xz * 0.01, 2) * 6.0);
  let st = strataAt(p.y + warpY, geo.warp);
  let hard = st.y;
  // gullies: streaks down the slope, a few metres apart (seen from afar)
  let gu = streakNoise(p, down, 0.06, 0.12, 3.7).x;
  let fadeG = 1.0 - smoothstep(1.5, 5.0, fp * 0.35);
  let gully = smoothstep(0.1, 0.7, gu) * (0.4 + (0.6 * cliff)) * fadeG * polish;
  // glacial striations: fine scratches along the ice flow, close up only
  let ia = geo.ice * GPI;
  let perp = vec2f(-sin(ia), cos(ia));
  let stri = sin((dot(p.xz, perp) * 23.0) + (fbm2(p.xz * 0.7, 2) * 3.0));
  let fadeS = geo.glac * (1.0 - smoothstep(0.02, 0.08, fp));
  g += vec3f(perp.x, 0.0, perp.y) * (cos((dot(p.xz, perp) * 23.0)) * 0.025 * fadeS);
  m.h = vec4f(clamp(h, 0.0, 1.0), g);
  // colour: the layer of the strata, fine laminations close up
  let lam = sin(st.x * GPI * 7.0) * (1.0 - smoothstep(0.4, 1.5, fp));
  var c = strataCol(st.z, region) * (1.0 + (0.06 * lam));
  let mott = (big.x * 0.6) + (midN * 0.4) + 0.5;
  let regionCol = rockMean(region) * mix(0.85, 1.15, mott);
  c = mix(regionCol, c * mix(0.92, 1.08, mott), geo.vis);
  c *= mix(0.9, 1.1, hard * geo.vis);
  // hue by rock body (0.5..2 km) and tone at 50..400 m
  let body = fbm2((p.xz * 0.0011) + vec2f(p.y * 0.0004, 3.1), 3);
  c *= mix(vec3f(1.22, 1.0, 0.78), vec3f(0.86, 0.96, 1.10), smoothstep(-0.35, 0.35, body));
  let tone = fbm2((p.xz * 0.006) + vec2f(p.y * 0.004, 7.7), 3);
  c *= mix(vec3f(0.80, 0.78, 0.76), vec3f(1.14, 1.07, 0.98), smoothstep(-0.45, 0.45, tone));
  // ---- the blocks: each its own tone and hue (fresh and weathered
  // faces), a pale weathering rind along the edges, iron stain on some
  let blockF = 1.0 - smoothstep(0.06, 0.25, fp / max(rk.bedT, 0.3));
  c *= mix(1.0, mix(0.95, 1.04, rk.id.y), blockF * polish);
  c *= mix(vec3f(1.0), mix(vec3f(1.05, 1.0, 0.94), vec3f(0.95, 0.99, 1.05), rk.idB.z), polish);
  c *= mix(0.95, 1.04, rk.idB.y);
  let rind = (1.0 - smoothstep(0.015, 0.14, rk.eo)) * (1.0 - rk.crack) * blockF;
  c = mix(c, (c * vec3f(1.16, 1.07, 0.94)) + vec3f(0.012, 0.009, 0.005), rind * 0.55 * polish);
  let iron = smoothstep(0.7, 0.95, rk.id.x) * smoothstep(-0.3, 0.4, midN) * (1.0 - geo.glac) * mix(0.6, 1.0, region.y);
  c = mix(c, c * vec3f(1.38, 0.90, 0.58), iron * 0.6 * blockF);
  // ---- streaks that run down the faces from the ledge lips and joints:
  // desert varnish (manganese, black-brown) in dry climates, water and
  // algae stains (dark grey-green) in wet ones; strongest just under a lip
  let streak = vnoised(vec3f(p.x * 1.3, p.y * 0.07, p.z * 1.3)).x;
  let streakF = vnoised(vec3f(p.x * 5.0, p.y * 0.3, p.z * 5.0)).x * (1.0 - smoothstep(0.02, 0.08, fp));
  let below = (1.0 - rk.bedF) * rk.bedT;
  let sedK = clamp((U.rock.w - 0.8) / 0.5, 0.0, 1.0);
  let run = mix(0.55 * smoothstep(-0.2, 0.5, midN), exp(-below / max(rk.bedT * 0.8, 0.4)), sedK) * smoothstep(0.35, 0.65, slope) * (1.0 - rk.tread);
  let sK = smoothstep(0.05, 0.6, streak + (streakF * 0.35));
  let varnish = geo.arid * smoothstep(0.3, 0.8, geo.age) * smoothstep(0.35, 0.7, slope) * max(sK * run, smoothstep(0.3, 0.85, streak + (midN * 0.4)) * 0.5);
  c = mix(c, vec3f(0.048, 0.034, 0.024), varnish * 0.78);
  let wetStain = (1.0 - geo.arid) * sK * max(run, cliff * 0.4) * smoothstep(0.35, 0.65, slope);
  c *= 1.0 - (wetStain * 0.42);
  c = mix(c, c * vec3f(0.8, 0.9, 0.78), wetStain * moist * 0.5);
  c *= 1.0 - (gully * 0.35);
  // dust and grit on the ledge treads
  c = mix(c, c * vec3f(1.1, 1.04, 0.95), rk.tread * 0.35 * blockF);
  // ---- lichen: crusts on old, moist, shaded or upward faces; far away a
  // mottle of the same colours; moss on wet shaded old rock
  let lichK = (midN * 0.8) + (fine.x * 0.3) + (moist - 0.45) + (0.2 * geo.shade) + (0.6 * (geo.age - 0.5)) - (0.5 * geo.arid) + (0.25 * max(nG.y, 0.0));
  let lichFar = smoothstep(0.1, 0.55, lichK) * (1.0 - rk.crack);
  let lc = lichen(p, nG, fp, clamp(smoothstep(0.0, 0.8, lichK) * 0.45, 0.0, 0.45) * (1.0 - rk.crack));
  let near = 1.0 - smoothstep(0.02, 0.05, fp);
  let farCol = mix(vec3f(0.16, 0.17, 0.11), vec3f(0.30, 0.25, 0.10), smoothstep(0.3, 0.7, midN));
  c = mix(c, farCol, lichFar * 0.4 * (1.0 - near) * (1.0 - (region.y * 0.6)));
  c = mix(c, lc.rgb, lc.a * 0.9 * (1.0 - (region.y * 0.4)));
  let moss = smoothstep(0.55, 0.85, moist) * smoothstep(-0.1, 0.6, geo.shade + (midN * 0.4)) * smoothstep(0.3, 0.8, geo.age) * (1.0 - smoothstep(0.75, 1.0, slope));
  c = mix(c, vec3f(0.040, 0.068, 0.022) * (0.8 + (0.4 * fine.x)), moss * 0.85 * (0.6 + (0.4 * rk.tread)));
  // weathering: tone patches at 1..6 m, so a face is not one flat grey
  c *= mix(0.72, 1.14, smoothstep(-0.55, 0.55, midN));
  // the cracks: dark, deeper with the open width
  c *= mix(1.0, 0.45, rk.crack);
  c *= mix(0.88, 1.05, clamp(h, 0.0, 1.0));
  // each rock facet its own tone (fresh breaks lighter)
  c *= 1.0 + (0.12 * geo.facet);
  // ice polish: lighter, smoother, pale striations
  c = mix(c, c * (1.12 + (0.06 * stri)), geo.glac * 0.8);
  m.alb = c;
  m.rough = mix(mix(0.86, 0.66, ridged * (1.0 - rk.crack)), 0.42, geo.glac * 0.8);
  m.rough = mix(m.rough, 0.55, varnish * 0.5);
  m.rough = mix(m.rough, 0.95, lc.a * 0.8);
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
  // the prevailing wind of LIB climate (the fields), else the weather wind
  let wd = select(normalize(G.wind.xy + vec2f(0.6, 0.3)), U.surf.zw, U.surf.x > 0.5);
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

// Mud and bare soil: dark and smooth when wet, lighter and crumbly when
// dry; on a playa (dry closed basin, surface field) a pale crust that
// cracks into curled polygons with salt in the cracks.
fn layerMud(p: vec3f, fp: f32, moist: f32, playa: f32) -> Mat {
  var m: Mat;
  let n = fbmd(p, 0.9, 4, 0.5, fp);
  let dry = 1.0 - smoothstep(0.3, 0.7, moist);
  // desiccation polygons: 0.4..1.2 m, two scales (big plates, small cracks)
  let cr = voronoi2((p.xz * 1.6) + vec2f(fbm2(p.xz * 0.9, 2) * 0.35));
  let cr2 = voronoi2((p.xz * 4.1) + 3.7);
  let fadeC = 1.0 - smoothstep(0.08, 0.3, fp);
  let e1 = 1.0 - smoothstep(0.0, 0.08, abs(cr.x - 0.5) * 0.5);
  let e2 = (1.0 - smoothstep(0.0, 0.05, abs(cr2.x - 0.5) * 0.5)) * 0.6;
  let crack = max(e1, e2 * playa) * fadeC * max(dry, playa);
  // the plates curl up at their edges
  let curl = smoothstep(0.25, 0.48, abs(cr.x - 0.5)) * playa * fadeC;
  m.h = vec4f(0.25 + (0.15 * n.x) - (0.2 * crack) + (0.08 * curl), n.yzw * 0.15);
  let wetC = mix(vec3f(0.085, 0.065, 0.045), vec3f(0.12, 0.095, 0.065), n.x * 0.5 + 0.5);
  let dryC = mix(vec3f(0.17, 0.13, 0.085), vec3f(0.23, 0.18, 0.12), n.x * 0.5 + 0.5);
  let crust = mix(vec3f(0.44, 0.40, 0.34), vec3f(0.58, 0.55, 0.50), smoothstep(-0.3, 0.6, fbm2(p.xz * 0.05, 3) + (cr.w * 0.3)));
  var c = mix(wetC, dryC, dry);
  c = mix(c, crust, playa);
  c *= 1.0 - (crack * mix(0.45, 0.55, playa));
  m.alb = c;
  m.rough = mix(mix(0.62, 0.85, dry), 0.9, playa);
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
  let stoneA = mix(vec3f(0.21, 0.195, 0.175), vec3f(0.36, 0.25, 0.17), region.y);
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

// one projection: uv from the plane coordinates, two scales mixed by far.
// rot >= 0: hex tiling (fn tex3Hex, rot = the share of a full turn per
// tile: 1 for soil and grass, small for sand ripples); rot < 0: one plain
// sample
fn texProj(k: u32, q: vec2f, gq: vec2f, hq: vec2f, s: f32, far: f32, rot: f32) -> array<vec4f, 3> {
  var a: array<vec4f, 3>;
  if ((rot >= 0.0) && (U.mat.w >= 0.5)) { a = tex3Hex(k, q * s, gq * s, hq * s, rot); }
  else { a = tex3(k, q * s, gq * s, hq * s); }
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

fn texSet(k: u32, p: vec3f, n: vec3f, tri: bool, gx: vec3f, gy: vec3f, far: f32, rot: f32) -> TexS {
  let s = 1.0 / texTile(k);
  var o: TexS;
  if (!tri) {
    let t = texProj(k, p.xz, gx.xz, gy.xz, s, far, rot);
    o.alb = t[0].rgb; o.orm = t[2].rgb;
    let m = t[1].xy * 2.0 - 1.0;
    let off = vec3f(m.x, 0.0, -m.y);
    o.nrm = off - (dot(off, n) * n);
    return o;
  }
  var w = pow(abs(n), vec3f(4.0));
  w /= (w.x + w.y + w.z);
  // vertical planes: v = -y, so the image is upright on a cliff
  // a projection with a small weight is skipped (explicit gradients, so
  // the branch is safe)
  var tx = array<vec4f, 3>(vec4f(0.0), vec4f(0.5, 0.5, 1.0, 1.0), vec4f(0.0));
  var ty = tx;
  var tz = tx;
  if (w.x > 0.02) { tx = texProj(k, vec2f(p.z, -p.y), vec2f(gx.z, -gx.y), vec2f(gy.z, -gy.y), s, far, rot); }
  if (w.y > 0.02) { ty = texProj(k, p.xz, gx.xz, gy.xz, s, far, rot); }
  if (w.z > 0.02) { tz = texProj(k, vec2f(p.x, -p.y), vec2f(gx.x, -gx.y), vec2f(gy.x, -gy.y), s, far, rot); }
  w = select(vec3f(0.0), w, w > vec3f(0.02));
  w /= max(w.x + w.y + w.z, 1e-4);
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
fn texSetCal(k: u32, tgt: vec3f, p: vec3f, n: vec3f, tri: bool, gx: vec3f, gy: vec3f, far: f32, texF: f32, rot: f32) -> TexS {
  var t: TexS;
  let mean = max(textureSampleLevel(tLayerAlb, sRepeat, vec2f(0.5), k, 16.0).rgb, vec3f(0.01));
  t.alb = tgt;
  t.orm = textureSampleLevel(tLayerOrm, sRepeat, vec2f(0.5), k, 16.0).rgb;
  t.nrm = vec3f(0.0);
  if (texF > 0.01) {
    let tn = texSet(k, p, n, tri, gx, gy, far, rot);
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

// Macro rock: two windows of a rock scan as detail relative to its mean
// (triplanar). Window 0 (20 m to 1.6 km): the aerial outcrop set at its
// true 50 m tile (U.rsets.z), else the cliff scan at 34 m. Window 1 (0.7
// to 9 km): the cliff scan at 122 m (rock is self-similar). The outcrops,
// slabs and ribs of the scans read as buttresses and ledges at mid range.
// -> xyz normal offset (in the tangent plane of n), w albedo factor.
fn macroRock(kC: u32, p: vec3f, n: vec3f, gx: vec3f, gy: vec3f, dist: f32) -> vec4f {
  let kO = u32(U.rsets.z + 0.5);
  let hasO = kO < 64u;
  var w = pow(abs(n), vec3f(4.0));
  w /= (w.x + w.y + w.z);
  var off = vec3f(0.0);
  var lum = 0.0;
  var ws = 0.0;
  for (var o = 0; o < 2; o++) {
    // two windows that overlap only from 700 to 1600 m (cost)
    let fo = select(smoothstep(20.0, 80.0, dist) * (1.0 - smoothstep(900.0, 1600.0, dist)),
                    smoothstep(700.0, 1600.0, dist) * (1.0 - smoothstep(6000.0, 9000.0, dist)), o == 1);
    if (fo > 0.01) {
      let k = select(kC, select(kC, kO, hasO), o == 0);
      let T = select(122.0, select(34.0, texTile(kO), hasO), o == 0);
      let mean = max(textureSampleLevel(tLayerAlb, sRepeat, vec2f(0.5), k, 16.0).rgb, vec3f(0.01));
      let ml = dot(mean, vec3f(0.3, 0.59, 0.11));
      let s = 1.0 / T;
      let sh = vec2f(0.37, 0.71) * f32(o);
      let ux = (vec2f(p.z, -p.y) * s) + sh;
      let uy = (p.xz * s) + sh;
      let uz = (vec2f(p.x, -p.y) * s) + sh;
      // hex tiled (the 50 m outcrop tile repeated in rows at 300 m)
      var tX = array<vec4f, 3>(vec4f(0.5), vec4f(0.5, 0.5, 1.0, 1.0), vec4f(1.0));
      var tY = tX;
      var tZ = tX;
      if (w.x > 0.02) { tX = tex3Hex(k, ux, vec2f(gx.z, -gx.y) * s, vec2f(gy.z, -gy.y) * s, 1.0); }
      if (w.y > 0.02) { tY = tex3Hex(k, uy, gx.xz * s, gy.xz * s, 1.0); }
      if (w.z > 0.02) { tZ = tex3Hex(k, uz, vec2f(gx.x, -gx.y) * s, vec2f(gy.x, -gy.y) * s, 1.0); }
      let ax = tX[0].rgb;
      let ay = tY[0].rgb;
      let az = tZ[0].rgb;
      let nx = tX[1].xy * 2.0 - 1.0;
      let ny = tY[1].xy * 2.0 - 1.0;
      let nz = tZ[1].xy * 2.0 - 1.0;
      let a = (ax * w.x) + (ay * w.y) + (az * w.z);
      lum += (dot(a, vec3f(0.3, 0.59, 0.11)) / ml) * fo;
      off += ((vec3f(0.0, nx.y, nx.x * sign(n.x)) * w.x) + (vec3f(ny.x, 0.0, -ny.y) * w.y) + (vec3f(nz.x * sign(n.z), nz.y, 0.0) * w.z)) * fo;
      ws += fo;
    }
  }
  if (ws < 0.01) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  off = off - (dot(off, n) * n);
  return vec4f(off / max(ws, 1.0), mix(1.0, clamp(lum / ws, 0.4, 1.8), min(ws, 1.0)));
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
  return (vec3f(0.136, 0.131, 0.124) * region.x) + (vec3f(0.345, 0.2, 0.115) * region.y) + (vec3f(0.078, 0.073, 0.068) * region.z);
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
  // p: the pattern position (the surface before the vertex relief), pW:
  // the drawn surface (the view, the shadows and the haze use it)
  let p = v.base;
  let pW = v.world;
  let xz = p.xz;
  let cam = G.camPos.xyz;
  let viewV = cam - pW;
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
  // the far ring (level -1) flattens the mirrored world: so does its slope
  let outside = v.level < -0.5;
  let rFade = select(0.0, ringFade(xz), outside);
  let gB = (-nb.xz / max(nb.y, 0.08)) * (1.0 - rFade);
  // (detailHeight costs ~30 texel loads: four calls only where its slope
  // shows, at quality 0.5 and up within 900 m)
  var gD = gB;
  if ((q >= 0.5) && (dist < 900.0) && !outside) {
    // forward differences: three calls, not four
    let e = clamp(fp * 0.6, 0.08, G.terrain.w * 0.4);
    let d0 = detailHeight(xz);
    let dx = detailHeight(xz + vec2f(e, 0.0)) - d0;
    let dz = detailHeight(xz + vec2f(0.0, e)) - d0;
    gD += (vec2f(dx, dz) / e) * (1.0 - smoothstep(600.0, 900.0, dist));
  }
  let aux = auxAt(xz);
  let flow = aux.r;
  let river = clamp(aux.g, 0.0, 1.0);
  let moist = clamp(aux.b, 0.0, 1.0);
  let wdepth = max(aux.a, 0.0);
  var bw = biomeMix(xz);
  // ---- surface fields (render/surface-sim.js); hasSurf false: none yet
  let sf = surfAt(xz);
  let hasSurf = sf.a.x >= 0.0;
  let down0 = normalize(gD + vec2f(1e-5, 0.0));
  let steep0 = smoothstep(0.18, 0.7, length(gB));
  // rills: soft ground under high stream power cuts more, ice-polished
  // rock less
  let erod = select(1.0, mix(0.55, 1.35, sf.d.w) * (1.0 - (0.6 * sf.c.y)), hasSurf);
  let mE = macroErosion(p, down0, steep0 * (0.5 + (0.5 * q)) * erod, fp);
  let gE = mE.xy;
  let gully = clamp(-mE.z, 0.0, 1.0);
  // gullies at the field texel scale: the log-area field carves the
  // drainage lines of steep faces into the shading at every distance
  // (couloirs and ribs seen from the air); the D8 lines below add the
  // close-up detail
  var gC = vec2f(0.0);
  var couloir = 0.0;
  let csF = G.terrain.x / max(U.surf.y, 1.0);
  if (hasSurf && !outside) {
    let e = csF * 0.6;
    let cx = surfLayer(xz + vec2f(e, 0.0), 3).y;
    let cz = surfLayer(xz + vec2f(0.0, e), 3).y;
    let vis = (1.0 - smoothstep(csF * 0.5, csF * 1.6, fp)) * smoothstep(0.1, 0.5, length(gB));
    gC = -(vec2f(cx - sf.d.y, cz - sf.d.y) / e) * (csF * 1.2 * vis);
    couloir = smoothstep(0.2, 0.42, sf.d.y) * smoothstep(0.25, 0.7, length(gB));
  }
  // gullies and rills of the drainage network, under one field texel: a V
  // section along each D8 line, as wide as its upstream area allows
  var gL = vec2f(0.0);
  var lineK = 0.0;
  var lineA = 0.0;
  let cs = csF;
  if (hasSurf && (q >= 0.45) && !outside && (dist < select(1200.0, 2500.0, q >= 0.95))) {
    let dl = drainLine(xz, 0.2);
    let W = clamp(mix(0.9, 0.38 * cs, smoothstep(0.2, 0.75, dl.y)), 0.6, 0.45 * cs);
    let vis = smoothstep(0.6, 2.0, W / fp) * (1.0 - smoothstep(0.3, 0.8, river));
    if ((dl.x < W) && (vis > 0.0)) {
      let u = 1.0 - (dl.x / W);
      let D = W * mix(0.22, 0.12, dl.y);
      gL = dl.zw * ((2.0 * D * u / W) * vis);
      lineK = smoothstep(0.35, 0.9, u) * vis;
      lineA = dl.y;
    }
  }
  // dunes in the sand seas of desert biomes: transverse to the prevailing
  // wind of LIB climate
  var gU = vec2f(0.0);
  var duneM = 0.0;
  if (hasSurf && !outside) {
    let erg = smoothstep(-0.2, 0.3, fbm2((xz * 0.00035) + 11.0, 3));
    duneM = clamp(bw.kind.y * 1.3, 0.0, 1.0) * (1.0 - smoothstep(0.05, 0.16, length(gB))) * erg * (1.0 - sf.b.w) * (1.0 - smoothstep(0.0, 0.5, wdepth));
    if (duneM > 0.01) { gU = dune(xz, U.surf.zw, U.geo2.z).yz * duneM; }
  }
  // broken rock: planar facets on steep bare faces (the bedrock field)
  var facetT = 0.0;
  var gF = vec2f(0.0);
  let rockMask = steep0 * select(0.6, 1.0 - smoothstep(0.12, 0.4, sf.a.x), hasSurf) * (1.0 - smoothstep(0.3, 0.7, sf.a.y));
  if ((rockMask > 0.01) && (q >= 0.95) && !outside && (dist < 3000.0)) {
    let fc = facets(p, normalize(gB + vec2f(1e-5, 0.0)), fp);
    gF = fc.xy * (rockMask * 0.45);
    facetT = fc.z * rockMask;
  }
  let gS = gE + gL + gU + gC + gF;
  let nGeo = normalize(vec3f(-(gD.x + gS.x), 1.0, -(gD.y + gS.y)));
  let aoT = clamp(nA.w, 0.0, 1.0);

  let slope = 1.0 - nGeo.y;
  let sea = G.terrain.z;
  let hAbove = p.y - sea;
  let hMin = G.terrainOrigin.z;
  let hMax = max(G.terrainOrigin.w, hMin + 1.0);
  let hRel = clamp((p.y - sea) / max(hMax - sea, 1.0), 0.0, 1.0);

  // region of the rock type: granite, sandstone, basalt (macro noise + biome)
  let rn = fbm2(xz * 0.00025, 3);
  let desertish = clamp(bw.w1.x * (1.0 - smoothstep(0.0, 3.0, wdepth)) * 0.8, 0.0, 1.0);
  var region = vec3f(0.0);
  // a dry world with LIB strata is a sandstone plateau country
  region.y = clamp(desertish + (bw.w0.z * smoothstep(0.2, 0.6, rn) * 0.25) + (U.geo.w * (1.0 - smoothstep(0.3, 0.65, moist)) * select(0.0, 0.85, U.surf.x > 0.5)), 0.0, 1.0);
  region.z = clamp(smoothstep(0.3, 0.7, -rn), 0.0, 1.0) * (1.0 - region.y) * 0.8;
  region.x = max(1.0 - region.y - region.z, 0.0);
  let down = normalize(nGeo.xz + vec2f(1e-5, 0.0));

  // ---- weights by rule
  var w0 = bw.w0;   // rock, cliff, grass, forest
  var w1 = bw.w1;   // sand, snow, mud, gravel
  // the LIB river biome (12) marks its D8 channel cells, in straight runs
  // over flat plains: its mud is dark wet ground only in a wet climate; in
  // a dry one it is a pale sand wash (these were the dark straight lines on
  // the canyonlands plains)
  // (the regional moisture, 400 m round: LIB moisture is high along every
  // channel, so the local value calls a desert wash wet)
  let moistR = 0.25 * (auxAt(xz + vec2f(400.0, 0.0)).b + auxAt(xz - vec2f(400.0, 0.0)).b + auxAt(xz + vec2f(0.0, 400.0)).b + auxAt(xz - vec2f(0.0, 400.0)).b);
  let wetClim = smoothstep(0.3, 0.55, min(moist, moistR));
  w1.x += w1.z * (1.0 - wetClim) * 0.8;
  w1.z *= mix(0.2, 1.0, wetClim);
  let jit = (fbm2(xz * 0.03, 3) * 1.4) + (fbm2((xz * 0.21) + 7.7, 2) * 0.6);
  // slope: grass and soil slide off, rock shows, cliffs above ~45 deg
  // (alpine turf holds on to ~40 deg: grass gives way from 37 to 50 deg)
  let rockS = smoothstep(0.20 + (jit * 0.05), 0.36 + (jit * 0.05), slope);
  let cliffS = smoothstep(0.40 + (jit * 0.06), 0.55 + (jit * 0.06), slope);
  let soft = 1.0 - rockS;
  w0 = vec4f(w0.x + (rockS * 1.4), cliffS * 2.5, w0.z * soft, w0.w * soft);
  w1 = vec4f(w1.x * soft, w1.y, w1.z * soft, w1.w * (1.0 - (cliffS * 0.8)));
  // height: above the tree line rock and scree take over
  let tree = 1.0 - smoothstep(0.62 + (jit * 0.08), 0.80 + (jit * 0.08), hRel);
  w0.w *= tree;
  w0.z *= mix(0.55, 1.0, tree);
  w0.x += (1.0 - tree) * 0.4;
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
  // a channel carries water all year only with a big flow in a wet
  // climate; a dry wash (most channels of an arid plain) is pale sand and
  // gravel. (The LIB river mask runs in straight D8 lines over flat
  // plains; as dark wet mud they drew dark straight lines there.)
  let perennial = wetClim * smoothstep(1.6, 3.2, flow);
  w1.w += (bed * 2.0) + (chan * 0.3);
  w1.x += (bed * mix(1.2, 0.6, perennial)) + (fan * 0.9);
  w1.z += (bank * 1.2 * moist * perennial) + (fan * 0.4 * perennial);
  w0.z *= 1.0 - (bed * 0.95);
  w0.w *= 1.0 - (bed * 0.95);
  // lake and sea floor: silt
  let under = smoothstep(0.05, 0.6, wdepth) + (1.0 - smoothstep(-0.5, 0.2, hAbove));
  w1.z += under * 1.2;
  w1.x += under * 0.6;
  w0.z *= 1.0 - clamp(under, 0.0, 1.0);
  // moisture: dry ground shows gravel and sand through thin grass
  w1.x += (1.0 - smoothstep(0.08, 0.3, moist)) * w0.z * 0.5;

  // crumbly soil where turf meets rock: a ragged band of bare stony soil
  // (the mud layer: the stony soil set) between the two
  let edgeRG = (4.0 * w0.x * w0.z) / max((w0.x + w0.z) * (w0.x + w0.z), 1e-4);
  w1.z += edgeRG * (w0.x + w0.z) * 0.5 * smoothstep(-0.25, 0.35, fbm2(xz * 0.8, 2) + (jit * 0.3));

  // ---- the simulated surface (render/surface-sim.js)
  var scr = 0.0;
  var alv = 0.0;
  let playa = select(0.0, sf.b.w, hasSurf);
  if (hasSurf) {
    let reg = sf.a.x;
    // bare bedrock where the soil is thin, at any slope; plants need soil
    let bedrock = 1.0 - smoothstep(0.08, 0.45, reg + (jit * 0.06));
    let soilOK = smoothstep(0.1, 0.45, reg);
    w0.x += bedrock * 1.3 * (1.0 - cliffS);
    w0.z *= mix(0.12, 1.0, soilOK) * (1.0 - (0.9 * sf.c.w));
    w0.w *= mix(0.1, 1.0, soilOK);
    // slips, gullied soil and thin cover: bare soil (the mud layer, dry)
    w1.z += ((sf.c.w * 1.4) + ((1.0 - soilOK) * (1.0 - bedrock) * 0.5)) * soft;
    // scree aprons under the cliffs (talus, angular, of the rock above)
    scr = smoothstep(0.06, 0.55, sf.a.y + (jit * 0.04) + (couloir * 0.35) + (gully * 0.4)) * (1.0 - (cliffS * (1.0 - (max(couloir, gully) * 0.6))));
    w1.w += scr * 2.6;
    // a thin stony mantle (regolith too thin for soil, too thick for bare
    // rock): broken debris over the bedrock
    let mantle = smoothstep(0.04, 0.18, reg) * (1.0 - smoothstep(0.3, 0.55, reg)) * (1.0 - cliffS);
    w1.w += mantle * 1.1;
    w0.x *= 1.0 - (mantle * 0.5);
    w0.x *= 1.0 - (scr * 0.75);
    w0.z *= 1.0 - scr;
    w0.w *= 1.0 - scr;
    // alluvial fans, gravel bars and flood plains: bare where active (near a
    // channel) or dry; coarse on steep fans and beds, fine on the plains
    let act = clamp(max(smoothstep(0.55, 0.8, sf.d.y) * sf.a.w, 1.0 - smoothstep(0.15, 0.35, moist)), 0.0, 1.0);
    alv = sf.a.z * act * soft;
    w1.w += alv * sf.d.z * 1.4;
    w1.x += alv * (1.0 - sf.d.z) * 0.9 * (1.0 - moist);
    w1.z += alv * (1.0 - sf.d.z) * 0.9 * moist;
    w0.z *= 1.0 - (alv * 0.7);
    // playa: a dry closed basin cracks (the mud layer with crust)
    w1.z += playa * 3.0;
    w0.z *= 1.0 - playa;
    w1.x *= 1.0 - (playa * 0.8);
    // channel floors of the drainage lines: gravel and sand washes
    // (light sand and gravel washes in dry land, wet gravel in wet land)
    let aridL = 1.0 - smoothstep(0.2, 0.45, moist);
    w1.w += lineK * smoothstep(0.25, 0.6, lineA) * 1.5;
    w1.x += lineK * aridL * 1.2;
    w0.z *= 1.0 - (lineK * aridL * 0.8);
    // dune sand
    w1.x += duneM * 1.5;
  }

  // snow: snow line from the cover uniform, lower on north faces (world
  // frame: +z is south, so a north face has n.z < 0), less on steep
  // slopes; plus the snow biome
  let cover = clamp(G.weather2.y, 0.0, 1.0);
  // the climate snow line: the height where the LIB temperature (a linear
  // fit T = a + b h, ground.js) falls to the season's limit: -7 C in
  // summer, -3 C in spring and autumn, +1 C in winter (season 0 spring)
  let tSnow = -3.0 + (4.0 * cos(6.2831853 * (G.weather2.w - 0.75)));
  let fitOk = (U.snow.z > 0.5) && (U.snow.y < -1e-5);
  let climLine = select(hMax + 300.0, (tSnow - U.snow.x) / min(U.snow.y, -1e-5), fitOk);
  // weather cover pulls the line down: 0.5 the upper slopes, 1 to the sea
  let snowLine = mix(min(climLine, hMax + 300.0), sea - 150.0, pow(cover, 0.7));
  // shade: 1 on faces away from the sun's side of the sky (north in the
  // northern hemisphere, U.geo2.y = -1 flips it), -1 on sunny faces
  let aspect = clamp(-nGeo.z * 2.0, -1.0, 1.0);
  let shade = aspect * select(1.0, U.geo2.y, hasSurf);
  // the snow edge is ragged at every scale: 250 m tongues, 30 m patches
  let snowN = (fbm2(xz * 0.004, 4) * 160.0) + (fbm2((xz * 0.03) + 5.3, 3) * 70.0);
  // snow holds on low slopes, in shade and in the wind's lee (drift); steep
  // faces shed it, scoured crests stay bare
  let drift = clamp(sf.b.x + (couloir * 0.3) + (gully * 0.35) - (clamp(mE.z, 0.0, 1.0) * 0.2), 0.0, 1.0);
  let slopeJ = slope - (jit * 0.04) + 0.02;
  // couloirs and gullies hold snow on steeper ground than open faces
  var snow = snowAmount(p.y + snowN, snowLine, slopeJ - (max(gully, couloir) * 0.12), shade, drift);
  // fresh snowfall dusts everything that is not too steep, deeper in the lee
  snow = max(snow, smoothstep(0.1, 0.8, G.weather.z) * 0.55 * mix(0.5, 1.3, drift) * (1.0 - smoothstep(0.30, 0.52, slopeJ)));
  // cornices on the lee edge of sharp crests near and above the line
  let corn = sf.b.y * smoothstep(snowLine - 250.0, snowLine + 50.0, p.y + snowN);
  snow = max(snow, corn);
  snow = max(snow, w1.y * (1.0 - cliffS * 0.6) * smoothstep(0.12, 0.42, drift));
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
  // the parent rock: talus, desert sand and dry soil take the colour of
  // the layer they came from
  let stP = strataAt(p.y + 6.0, sf.c.x);
  let parent = mix(rockMean(region), strataCol(stP.z, region), select(0.0, mix(0.45, 1.0, max(U.geo.w, region.y)), hasSurf));
  // what the fields tell the rock
  var geo: RockGeo;
  geo.warp = sf.c.x;
  geo.vis = select(0.3 * region.y, mix(0.45, 1.0, max(U.geo.w, region.y)), hasSurf);
  geo.age = sf.b.z;
  geo.glac = sf.c.y;
  geo.ice = sf.c.z;
  geo.shade = shade;
  geo.arid = 1.0 - smoothstep(0.15, 0.4, moist);
  geo.facet = facetT;
  // ---- blocky rock: the joint lattice of fn rockField at the parallax
  // point (fn pom, close up), its micro shadow, the block textures
  let rockW0 = (wa[0] + wa[1]) / wsum;
  var rk: RockF;
  rk.h = 0.0; rk.hf = 0.0; rk.g = vec3f(0.0); rk.e = 9.0; rk.crack = 0.0;
  rk.id = vec3f(0.5); rk.bedF = 0.5; rk.bedT = 1.0; rk.tread = 0.0; rk.eo = 9.0; rk.idB = vec3f(0.5);
  var prk = p;
  var pomSh = 1.0;
  let gbU = vec3f(0.0, 1.0, 0.0);
  if ((rockW0 > 0.02) && !outside && (dist < 3000.0)) {
    let bc0 = bedCoord(p, sf.c.x);
    let ps = pomSteps(dist, max(dot(nGeo, V), 0.0));
    if (ps > 0) { prk = pom(p, V, nGeo, bc0, gbU, fp, ps); }
    let bcR = bc0 + (prk.y - p.y);
    let bigK = smoothstep(0.12, 0.45, slope) * (1.0 - smoothstep(1800.0, 3000.0, dist));
    rk = rockField(prk, bcR, gbU, nGeo, fp, bigK);
    if (ps > 0) { pomSh = pomShadow(prk, normalize(G.sunDir.xyz), nGeo, bcR, gbU, fp); }
  }
  var rockT: TexS;
  var rockTDone = false;
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
        case 0u: { rockM = layerRock(prk, fp, cliffShare, moist, region, down, slope, geo, rk, nGeo); rockDone = true; m = rockM; }
        case 1u: {
          if (!rockDone) { rockM = layerRock(prk, fp, cliffShare, moist, region, down, slope, geo, rk, nGeo); rockDone = true; }
          m = rockM;
        }
        case 2u: { m = layerGrass(p, fp, bw.grass, moist); }
        case 3u: { m = layerForest(p, fp, bw.litter, moist); }
        case 4u: { m = layerSand(p, fp, region, slope); }
        case 6u: { m = layerMud(p, fp, moist, playa); }
        default: { m = layerGravel(p, fp, region); }
      }
    } else {
      m.alb = vec3f(0.2); m.h = vec4f(0.5, 0.0, 0.0, 0.0); m.rough = 0.8;
    }
    m.tn = vec3f(0.0);
    m.ao = 1.0;
    if (hasSet) {
      // rock and cliff triplanar on slopes (a planar map stretches there)
      let tri = ((i == 1u) && triOn) || ((i == 0u) && (slope > 0.22));
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
        case 4u: {
          // sand is sorted and bleached: a little of the parent rock hue
          let pSand = mix(vec3f(dot(parent, vec3f(0.33))), parent, 0.6) * 1.15;
          tgtP = mix(mix(vec3f(0.46, 0.39, 0.28), vec3f(0.50, 0.33, 0.19), region.y), pSand, region.y * 0.25);
          tgtA = mix(vec3f(0.40, 0.30, 0.19), pSand, region.y * 0.3);
          rmin = 0.75;
        }
        case 5u: { tgtP = vec3f(0.82, 0.85, 0.90); rmin = 0.35; }
        case 6u: {
          // (dry bare soil of an arid region is pale, near its parent rock)
          let drySoil = mix(vec3f(0.19, 0.145, 0.10), parent * 0.95, (1.0 - wetClim) * 0.7);
          tgtP = mix(mix(vec3f(0.085, 0.066, 0.045), drySoil, 1.0 - smoothstep(0.3, 0.7, moist * mix(0.5, 1.0, wetClim))), vec3f(0.50, 0.46, 0.40), playa);
          rmin = mix(0.45, 0.85, playa);
        }
        // gravel: river pebbles; scree: the broken rock of the cliff above,
        // lighter than its face (fresh fractures)
        // (a dry wash is pale: dark grey river gravel drew dark lines
        // along the drainage of arid plains)
        case 7u: { tgtP = mix(vec3f(0.19, 0.172, 0.152), parent * 1.15, max(region.y * 0.8, (1.0 - wetClim) * 0.7)); tgtA = mix(parent, vec3f(dot(parent, vec3f(0.33))), 0.25) * 1.3; }
        default: {}
      }
      // hex tiling turns: free for soil, grass, snow; small for sand ripples
      let rot = select(1.0, 0.12, i == 4u);
      var t: TexS;
      if (i <= 1u) {
        // rock: each block takes one of the rock scans (layered beds in the
        // sandstone region, jointed blocks and the two faces elsewhere) at
        // its own offset; one evaluation for rock and cliff (unit target)
        if (!rockTDone) {
          let kB = rockPick(rk.idB, region, kP);
          rockT = texSetCal(kB, vec3f(1.0), prk, nGeo, slope > 0.22, dpx, dpy, farMix, texF, 0.0);
          rockTDone = true;
        }
        t = rockT;
        // the scan contrast (calibrated detail around 1) a little up
        t.alb = pow(max(t.alb, vec3f(0.0)), vec3f(1.3)) * tgtP;
      } else {
        t = texSetCal(kP, tgtP, pw, nGeo, tri, dpx, dpy, farMix, texF, rot);
      }
      // the alternate set of this layer and how much of it
      var af = 0.0;
      switch (i) {
        case 2u: { af = clamp((1.0 - smoothstep(0.18, 0.42, moist)) + (smoothstep(0.1, 0.5, fbm2(xz * 0.013, 3)) * 0.5), 0.0, 1.0); }
        case 3u: { af = bw.kind.x; }
        case 4u: { af = bw.kind.y; }
        case 7u: { af = max(1.0 - tree, scr); }
        default: {}
      }
      let kA = mapIdx(i + 8u);
      if ((af > 0.02) && (kA < 64u) && (kA != kP)) {
        t = mixTex(t, texSetCal(kA, tgtA, pw, nGeo, tri, dpx, dpy, farMix, texF, rot), af);
      }
      // damp grass: the meadow set in wet ground (U.mat.y)
      if (i == 2u) {
        let kM = u32(U.mat.y + 0.5);
        let wf = smoothstep(0.6, 0.85, moist) * (1.0 - af);
        if ((wf > 0.02) && (kM < 64u)) { t = mixTex(t, texSetCal(kM, vec3f(0.075, 0.115, 0.035), pw, nGeo, false, dpx, dpy, farMix, texF, 1.0), wf); }
      }
      // the procedural modulation: rock keeps its cracks, lichen, strata
      // and weathering; the other layers get a mid-scale tone and hue
      var ratio = vec3f(0.84 + (0.32 * vm));
      if (i <= 1u) {
        // near, the scan carries the grain: the procedural rock keeps its
        // strata colour, lichen, varnish and broad tone, less of its fine mottle
        ratio = clamp(m.alb / rockMean(region), vec3f(0.25), vec3f(2.8));
        let rl = dot(ratio, vec3f(0.3, 0.59, 0.11));
        ratio = mix(ratio, ratio / max(rl, 0.05) * mix(rl, 1.0, 0.45), texF * 0.7);
      }
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
  // height blend (the classic splat trick): the higher layer shows
  // through at the edges. Near the camera the blend depth is small, so the
  // edges are sharp and natural: rock blocks poke through the soil, scree
  // lies over the turf
  let depthB = mix(0.1, 0.9, smoothstep(0.05, 8.0, fp));
  var alb = vec3f(0.0); var hg = vec4f(0.0); var rough = 0.0; var tw = 0.0;
  var tnS = vec3f(0.0); var aoS = 0.0; var rb = 0.0;
  for (var i = 0u; i < 8u; i++) {
    let wi = wa[i];
    if (wi < 0.02) { continue; }
    let b = max((mats[i].h.x + wi) - (hmax - depthB), 0.0);
    alb += mats[i].alb * b; hg += mats[i].h * b; rough += mats[i].rough * b; tw += b;
    tnS += mats[i].tn * b; aoS += mats[i].ao * b;
    if (i <= 1u) { rb += b; }
  }
  let itw = 1.0 / max(tw, 1e-4);
  alb *= itw; hg *= itw; rough *= itw; tnS *= itw; aoS *= itw;
  // the share of the rock layers after the blend (block relief, cavities)
  let rockB = rb * itw;

  // ---- normal: geometry + material bump (surface gradient)
  let bumpFade = 1.0 - smoothstep(30.0, 250.0, dist);
  // the grain bump of the rock layer reaches out to ~900 m on bare rock
  let rockRel = clamp(wa[0] + wa[1], 0.0, 1.0) * mix(0.06, 0.12, q) * (1.0 - smoothstep(150.0, 900.0, dist));
  let bumpK = (mix(0.035, 0.07, q) * bumpFade) + rockRel;
  let gt = hg.yzw - (dot(hg.yzw, nGeo) * nGeo);
  var n = normalize(nGeo - (gt * bumpK) + tnS);
  // the block relief of the rock in true metres (stairs, bevels, crack
  // walls: fn rockField), where the blend shows rock
  let gR = rk.g - (dot(rk.g, nGeo) * nGeo);
  n = normalize(n - (gR * rockB));
  // talus blocks on the scree at the foot of a face, and small stones and
  // roots on soil, close up
  let slopeB = 1.0 - nb.y;
  let tl = talus(xz, select(0.0, talusAmt(sf.a.y, slopeB), hasSurf && !outside), fp);
  if (tl.x > 0.0) {
    let tcol = mix(parent, vec3f(dot(parent, vec3f(0.33))), 0.3) * mix(0.75, 1.25, fract(tl.x * 37.0 + (tl.y * 3.1)));
    let tk = smoothstep(0.0, 0.04, tl.x);
    alb = mix(alb, tcol * (0.85 + (0.3 * smoothstep(0.0, 0.5, tl.x))), tk);
    rough = mix(rough, 0.8, tk);
    n = normalize(n - (vec3f(tl.y, 0.0, tl.z) - (dot(vec3f(tl.y, 0.0, tl.z), nGeo) * nGeo)) * tk);
  }
  let soilW = clamp(wa[6] + wa[7] + (wa[4] * 0.6) + (wa[3] * 0.5) + (wa[2] * 0.25), 0.0, 1.0) * (1.0 - rockB);
  if ((soilW > 0.05) && (fp < 0.012) && !outside) {
    let gr = grit(xz, fp, mix(0.25, 0.7, clamp(wa[7] + wa[6], 0.0, 1.0)));
    alb *= mix(1.0, gr.x, soilW);
    n = normalize(n - (vec3f(gr.y, 0.0, gr.z) * soilW));
    let rt = roots(xz, fp) * clamp((wa[3] * 1.2) + (wa[2] * 0.3), 0.0, 1.0);
    alb = mix(alb, vec3f(0.07, 0.045, 0.028), rt * 0.7);
  }
  // the macro rock scan on bare rock (high quality, textures on)
  let rockW = clamp(wa[0] + wa[1], 0.0, 1.0);
  let kC = mapIdx(1u);
  if ((rockW > 0.05) && (U.mat.x > 0.5) && (kC < 64u) && (q >= 0.45) && !outside) {
    let mr = macroRock(kC, p, nGeo, dpx, dpy, dist);
    alb *= mix(1.0, mr.w, rockW * 0.85);
    n = normalize(n + (mr.xyz * (rockW * 0.7)));
  }

  // ---- snow on top (height blended: crevices fill first)
  let snowM = layerSnow(p, fp);
  // rock ribs poke through, gullies fill first
  let snowCov = clamp((snow * 1.7) - (hg.x * 0.7) - (clamp(mE.z, 0.0, 1.0) * 0.5) + (gully * 0.3), 0.0, 1.0);
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
  // ---- far forest canopy: VEG streams trees to about 7 km (the scatter
  // stream maxDist); past that the forest biomes show their crowns here,
  // a clumped green with dark gaps, tinted by the season (deciduous only)
  // (in a dry climate the riparian woods are open: a far band of full
  // canopy read as a dark straight line along a plains river)
  let canopyF = wa[3] * smoothstep(4500.0, 7000.0, dist) * (1.0 - snowF) * mix(0.4, 1.0, wetClim);
  if (canopyF > 0.01) {
    let cl = fbm2(xz * 0.045, 3);
    let cl2 = fbm2((xz * 0.011) + 9.1, 3);
    var cc = mix(vec3f(0.030, 0.052, 0.020), vec3f(0.062, 0.092, 0.034), clamp(0.5 + (cl * 0.8), 0.0, 1.0));
    cc = mix(cc, cc * vec3f(0.85, 0.95, 1.1), clamp(bw.kind.x, 0.0, 1.0));       // boreal: bluer
    let autumn = smoothstep(0.38, 0.5, G.weather2.w) * (1.0 - smoothstep(0.62, 0.72, G.weather2.w));
    cc = mix(cc, cc * vec3f(2.4, 1.3, 0.6), autumn * (1.0 - bw.kind.x) * clamp(0.5 + cl2, 0.0, 1.0) * 0.7);
    cc *= 0.8 + (0.4 * clamp(0.5 + cl2, 0.0, 1.0));
    alb = mix(alb, cc, canopyF);
    rough = mix(rough, 0.9, canopyF);
  }
  let farT = smoothstep(2500.0, 14000.0, dist);
  let lum = dot(alb, vec3f(0.3, 0.59, 0.11));
  alb = mix(alb, mix(vec3f(lum), alb, 0.8), farT);

  // ---- wetness and puddles
  let rain = clamp(G.weather.y, 0.0, 1.0);
  // wet banks (the field: distance to water) and wet gully floors
  let wetF = max(sf.a.w * 0.9, lineK * smoothstep(0.35, 0.7, max(moist, rain)) * 0.7 * (1.0 - playa));
  let nearW = max(max(max(1.0 - smoothstep(0.3, 2.5, hAbove), max(bank, bed) * mix(0.15, 1.0, perennial)), smoothstep(0.0, 0.3, wdepth)), wetF);
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
  // cavity: the gullies of the macro relief and the drainage couloirs see
  // less sky and less low sun; the ribs a little more
  let cav = clamp(max(gully * 0.8, couloir * 0.5), 0.0, 1.0) * (1.0 - snowF * 0.5) * smoothstep(40.0, 400.0, dist);
  let L = normalize(G.sunDir.xyz);
  // SKY: sunColor.rgb is the full sun irradiance at the ground (sunDir.w
  // repeats its scale, so it is not applied again)
  let sunE = G.sunColor.rgb;
  let f0 = mix(vec3f(0.035), vec3f(0.02), wet);
  var sh = 1.0;
  var shM = 1.0;
  if (L.y > -0.05) {
    // soft shadows (PCSS, common.wgsl): the penumbra widens with the
    // distance to the caster, so a trunk foot is sharp and a crown is soft
    sh = sunShadowSoft(pW, nGeo, v.pos.xy);
    // the march starts on the base surface: detail relief under the base
    // would shadow itself in the bilinear field
    // the cascades hold the terrain casters out to their far split; the
    // march covers the ground past them (or all of it with no cascades)
    let nc = i32(cascades.params.x);
    let cFar = select(0.0, cascades.splits[max(nc - 1, 0)], nc > 0);
    if ((dist > cFar * 0.75) && !outside) {
      let ms = marchShadow(vec3f(pW.x, max(pW.y, baseH(xz)) + 0.5, pW.z), L, fp);
      sh = min(sh, mix(1.0, ms, smoothstep(cFar * 0.75, cFar * 0.95 + 1.0, dist)));
    }
    // the ground's own normal turns away from the sun
    sh *= smoothstep(-0.02, 0.08, dot(nGeo, L) + 0.03);
    sh *= cloudShadowAt(pW);
    // the fine rock relief shadows itself (POM micro shadow), and the
    // cracks and bed joints get little low sun
    sh *= mix(1.0, pomSh * (1.0 - (rk.crack * 0.35)), rockB);
  }
  // micro-shadowing (Chan 2018): the texture and crevice occlusion also
  // shadow the sun, where the surface turns from the light
  let aoMs = clamp(aoS * mix(1.0, clamp(hg.x * 1.6, 0.35, 1.0), bumpFade), 0.0, 1.0);
  let microSh = clamp(abs(dot(n, L)) + (2.0 * aoMs * aoMs) - 1.0, 0.0, 1.0);
  // a low sun leaves the gully floors in the shadow of their walls
  let gullySh = 1.0 - (cav * 0.55 * (1.0 - smoothstep(0.1, 0.6, L.y)));
  var col = brdf(n, V, L, alb, rough, f0) * sunE * (sh * microSh * gullySh);
  // snow subsurface: a soft wrap and blue tint in shadow
  col += alb * sunE * (snowF * 0.08 * max(dot(n, L) + 0.4, 0.0));
  // moon
  let M = normalize(G.moonDir.xyz);
  if (M.y > 0.0) {
    col += brdf(n, V, M, alb, rough, f0) * vec3f(0.55, 0.62, 0.80) * G.moonDir.w;
  }
  // sky ambient (hemisphere), occlusion from tNormal.w and the crevices
  let microAO = mix(0.55, 1.0, clamp(hg.x * 1.2, 0.0, 1.0));
  // the baked terrain AO is soft-limited at 0.45: a deep valley still sees
  // a band of sky and the lit far wall (at full strength it went black)
  // rock cavities: the cracks and the re-entrant corners of the blocks
  // see little sky; talus blocks shade the scree at their foot
  let aoRock = mix(1.0, clamp(1.0 + (max(rk.hf, -0.3) * 2.0) - (rk.crack * 0.3), 0.35, 1.0), rockB) * (1.0 - (0.55 * tl.w));
  let ao = mix(0.45, 1.0, aoT) * mix(1.0, microAO, bumpFade * (1.0 - texF)) * mix(1.0, aoS, 0.8) * mix(1.0, 0.55, cav) * (1.0 + (0.12 * clamp(mE.z, 0.0, 1.0))) * aoRock;
  // the sky is brighter toward the sun: a mild sun-side bias keeps the
  // form of slopes in shadow at a low sun
  let sunSide = normalize(vec3f(L.x, 0.35, L.z));
  let hemi = mix(0.35, 1.0, (n.y * 0.5) + 0.5) * (0.8 + (0.35 * dot(n, sunSide)));
  let bounce = alb * 0.25 * (1.0 - ((n.y * 0.5) + 0.5));
  col += alb * (G.ambient.rgb / GPI) * (hemi + bounce) * ao;
  // terrain bounce: sunlit slopes across a valley light the shaded side
  // (a fixed fraction: the mean ground albedo times the view of lit land)
  col += alb * sunE * (clamp(L.y + 0.1, 0.0, 1.0) * 0.07 * (1.0 - (0.5 * n.y)) * ao);
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

  // ---- debug views (ground.js setDebug): 10 rock crack, tread, stony
  // soil; 11 rock share, rock cavity, AO; 12 soil, forest, gravel weights;
  // 13 moisture, regional moisture, flow
  let dbg = u32(U.mat.z + 0.5);
  if (dbg == 1u) { col = vec3f(wa[0] + wa[1], wa[2] + wa[3] * 0.5, wa[4] + wa[7]) * (G.ambient.w + 1.0); }
  else if (dbg == 2u) { col = (n * 0.5) + 0.5; }
  else if (dbg == 3u) { col = vec3f(fract(v.level * 0.37), fract(v.level * 0.61), v.morph); }
  else if (dbg == 4u) { col = vec3f(sh) * (G.ambient.w + 1.0); }
  else if (dbg == 5u) { col = alb * (G.ambient.w + 1.0) * 2.0; }
  else if (dbg == 6u) { col = (nGeo * 0.5) + 0.5; }
  else if (dbg == 7u) { col = vec3f(1.0 - max(sf.a.x, 0.0), sf.a.y, max(sf.a.z, lineK)) * (G.ambient.w + 1.0); }
  else if (dbg == 9u) { col = vec3f(sf.d.y, couloir, length(gC)) * (G.ambient.w + 1.0); }
  else if (dbg == 10u) { col = vec3f(rk.crack, rk.tread, wa[6]) * (G.ambient.w + 1.0); }
  else if (dbg == 11u) { col = vec3f(rockB, aoRock, ao) * (G.ambient.w + 1.0); }
  else if (dbg == 12u) { col = vec3f(wa[6], wa[3], wa[7]) * (G.ambient.w + 1.0); }
  else if (dbg == 13u) { col = vec3f(moist, moistR, flow * 0.25) * (G.ambient.w + 1.0); }
  else if (dbg == 8u) { col = vec3f(sf.b.x, sf.b.y + sf.c.y, sf.b.z) * (G.ambient.w + 1.0); }

  if (U.shadow.x > 0.5) { col = aerial(col, pW); }
  return vec4f(col, 1.0);
}
