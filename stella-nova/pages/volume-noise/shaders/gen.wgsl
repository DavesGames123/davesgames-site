// ============================================================================
//  VOLUME NOISE  ·  shaders/gen.wgsl — the cloud textures of main.cpp
// ----------------------------------------------------------------------------
//  Compute entry points that fill the 3D textures. gpu.js compiles this file
//  after noise.wgsl (HASH, worley_cells, perlin_fbm, remap come from there).
//  Each entry point ports one loop of TileableVolumeNoise main.cpp (MIT,
//  Sebastien Hillaire). The constants are the main.cpp constants. The page
//  can change them through GP (gpu.js "function genParams").
//
//    gen_shape ..... main.cpp "cloud base shape" loop, 128^3
//                    shape = (PerlinWorley, worleyFBM0, worleyFBM1, worleyFBM2)
//                    parts = (perlin FBM, Worley FBM of the PW block,
//                             1 - Worley(gbaCells), packed shape)
//    gen_detail .... main.cpp "erosion" loop (the #if 1 branch), 32^3
//                    detail = (worleyFBM0, worleyFBM1, worleyFBM2, packed)
//    gen_weather ... not in main.cpp: this page's 2D coverage map for the
//                    cloud layer, from the same tileable functions
//
//  main.cpp writes unsigned char(255 v), which truncates. q8() writes
//  floor(255 v) / 255, so the rgba8unorm texel holds the same byte.
//  A dispatch fills the z slices GP.z0 .. GP.z0 + (z groups x 4) - 1, so a
//  slow GPU gets short submits.
// ============================================================================

struct GenParams {
  perlinFreq: f32,   // PerlinNoise frequency (main.cpp: 8)
  perlinOct: f32,    // PerlinNoise octaveCount (main.cpp: 3)
  pwCells: f32,      // Perlin-Worley cellCount (main.cpp: 4)
  gbaCells: f32,     // G, B, A Worley FBM cellCount (main.cpp: 4)
  detailCells: f32,  // erosion cellCount (main.cpp: 2)
  perlinW: f32,      // the fourth Perlin coordinate (0 in the original)
  res: f32,          // texture edge in texels
  z0: f32,           // first z slice of this dispatch
  offset: vec4f,     // xyz added to the texture coordinate (0 on the page;
                     // tests.mjs uses 0.5 to show that the noise repeats)
}
@group(0) @binding(1) var<uniform> GP: GenParams;
@group(0) @binding(2) var shapeOut: texture_storage_3d<rgba8unorm, write>;
@group(0) @binding(3) var partsOut: texture_storage_3d<rgba8unorm, write>;
@group(0) @binding(4) var detailOut: texture_storage_3d<rgba8unorm, write>;
@group(0) @binding(5) var weatherOut: texture_storage_2d<rgba8unorm, write>;

fn q8(v: vec4f) -> vec4f { return floor(255.0 * v) / 255.0; }

// main.cpp frequenceMul[0..2]; [3..5] feed values that main.cpp never uses.
const FREQ_MUL = vec3f(2.0, 8.0, 14.0);

@compute @workgroup_size(4, 4, 4)
fn gen_shape(@builtin(global_invocation_id) gid: vec3u) {
  let n = u32(GP.res);
  let id = vec3u(gid.x, gid.y, gid.z + u32(GP.z0));
  if (id.x >= n || id.y >= n || id.z >= n) { return; }
  let p = vec3f(id) / GP.res + GP.offset.xyz;

  let perlinNoise = perlin_fbm(p, GP.perlinW, GP.perlinFreq, i32(GP.perlinOct));
  let pw0 = 1.0 - worley_cells(p, GP.pwCells * FREQ_MUL.x);
  let pw1 = 1.0 - worley_cells(p, GP.pwCells * FREQ_MUL.y);
  let pw2 = 1.0 - worley_cells(p, GP.pwCells * FREQ_MUL.z);
  let worleyFBM = pw0 * 0.625 + pw1 * 0.25 + pw2 * 0.125;
  // GPU Pro 7 p.101: Perlin mapped between the Worley FBM and 1.
  let perlinWorley = remap(perlinNoise, 0.0, 1.0, worleyFBM, 1.0);

  let c = GP.gbaCells;
  let w0 = 1.0 - worley_cells(p, c);
  let w1 = 1.0 - worley_cells(p, c * 2.0);
  let w2 = 1.0 - worley_cells(p, c * 4.0);
  let w3 = 1.0 - worley_cells(p, c * 8.0);
  let w4 = 1.0 - worley_cells(p, c * 16.0);
  let fbm0 = w1 * 0.625 + w2 * 0.25 + w3 * 0.125;
  let fbm1 = w2 * 0.625 + w3 * 0.25 + w4 * 0.125;
  let fbm2 = w3 * 0.75 + w4 * 0.25;

  // noiseShapePacked.tga: the base shape cut by the low-frequency FBM.
  let lowFreqFBM = fbm0 * 0.625 + fbm1 * 0.25 + fbm2 * 0.125;
  let packed = clamp(remap(perlinWorley, -(1.0 - lowFreqFBM), 1.0, 0.0, 1.0), 0.0, 1.0);

  textureStore(shapeOut, id, q8(vec4f(perlinWorley, fbm0, fbm1, fbm2)));
  textureStore(partsOut, id, q8(vec4f(perlinNoise, worleyFBM, w0, packed)));
}

@compute @workgroup_size(4, 4, 4)
fn gen_detail(@builtin(global_invocation_id) gid: vec3u) {
  let n = u32(GP.res);
  if (gid.x >= n || gid.y >= n || gid.z >= n) { return; }
  let p = vec3f(gid) / GP.res + GP.offset.xyz;
  let c = GP.detailCells;
  let w0 = 1.0 - worley_cells(p, c);
  let w1 = 1.0 - worley_cells(p, c * 2.0);
  let w2 = 1.0 - worley_cells(p, c * 4.0);
  let w3 = 1.0 - worley_cells(p, c * 8.0);
  let fbm0 = w0 * 0.625 + w1 * 0.25 + w2 * 0.125;
  let fbm1 = w1 * 0.625 + w2 * 0.25 + w3 * 0.125;
  let fbm2 = w2 * 0.75 + w3 * 0.25;
  let packed = fbm0 * 0.625 + fbm1 * 0.25 + fbm2 * 0.125;
  textureStore(detailOut, gid, q8(vec4f(fbm0, fbm1, fbm2, packed)));
}

@compute @workgroup_size(8, 8, 1)
fn gen_weather(@builtin(global_invocation_id) gid: vec3u) {
  let n = u32(GP.res);
  if (gid.x >= n || gid.y >= n) { return; }
  let uv = vec2f(gid.xy) / GP.res + GP.offset.xy;
  let pn = perlin_fbm(vec3f(uv, 0.37), GP.perlinW, 4.0, 3);
  let wn = 1.0 - worley_cells(vec3f(uv, 0.37), 5.0);
  let cov = clamp(remap(pn * 0.65 + wn * 0.35, 0.35, 0.8, 0.0, 1.0), 0.0, 1.0);
  let kind = clamp(remap(perlin_fbm(vec3f(uv, 0.71), GP.perlinW, 2.0, 2), 0.3, 0.7, 0.0, 1.0), 0.0, 1.0);
  textureStore(weatherOut, vec2i(gid.xy), q8(vec4f(cov, kind, 0.0, 1.0)));
}
