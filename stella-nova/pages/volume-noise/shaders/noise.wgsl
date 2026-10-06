// ============================================================================
//  VOLUME NOISE  ·  shaders/noise.wgsl — the tileable noise functions
// ----------------------------------------------------------------------------
//  A WGSL port of TileableVolumeNoise.cpp by Sebastien Hillaire (MIT, see
//  ../LICENSE-TileableVolumeNoise), part of "Physically Based Sky,
//  Atmosphere and Cloud Rendering in Frostbite" (SIGGRAPH 2016 course,
//  Physically Based Shading in Theory and Practice). gpu.js puts this file
//  in front of gen.wgsl and compiles the two as one module. The CPU twin
//  of each function is in ../noise-ref.js, and ../tests.mjs compares them.
//
//  PORTS  (C++ name -> WGSL name)
//    Tileable3dNoise::hash + noise ... lattice_hash (a table read, see HASH)
//    Tileable3dNoise::Cells .......... worley_cells
//    Tileable3dNoise::WorleyNoise .... worley_cells (WorleyNoise only calls Cells)
//    Tileable3dNoise::PerlinNoise .... perlin_fbm
//    glm::perlin(vec4, vec4) ......... perlin4_periodic (GLM gtc/noise.inl, from
//                                      the webgl-noise of Stefan Gustavson and
//                                      Ashima Arts; MIT)
//    main.cpp remap .................. remap
//
//  HASH. The C++ hash is fract(sin(n + 1.951) * 43758.5453) in float. A GPU
//  sin() near n = 20000 is not accurate enough for that product, so the
//  page computes the hash on the CPU in float steps (noise-ref.js hashTable)
//  and uploads it. HASH[n] holds hash(n + seed * 1000) for the lattice
//  number n = x + 57 y + 113 z. Cells calls noise() only at integer points,
//  where the smoothstep weights are 0, so noise() is HASH[n] there.
//
//  EXACT FLOORS. floor(x / 289), floor(x / 7) and the mod of an integer x
//  add 0.5 before they divide. For an integer x that gives the same value
//  as exact division, and a fast GPU reciprocal cannot move floor() across
//  an integer.
// ============================================================================

@group(0) @binding(0) var<storage, read> HASH: array<f32>;

// Tileable3dNoise::noise at a lattice point c (all components integers).
fn lattice_hash(c: vec3f) -> f32 {
  return HASH[u32(c.x + c.y * 57.0 + c.z * 113.0)];
}

// glm::mod for integer-valued x and a positive integer period y.
fn mod_int3(x: vec3f, y: f32) -> vec3f { return x - y * floor((x + 0.5) / y); }
fn mod_int4(x: vec4f, y: vec4f) -> vec4f { return x - y * floor((x + 0.5) / y); }

// Tileable3dNoise::Cells: squared distance to the nearest feature point.
fn worley_cells(p: vec3f, cellCount: f32) -> f32 {
  let pCell = p * cellCount;
  var d = 1.0e10;
  for (var xo = -1; xo <= 1; xo++) {
    for (var yo = -1; yo <= 1; yo++) {
      for (var zo = -1; zo <= 1; zo++) {
        let tp = floor(pCell) + vec3f(f32(xo), f32(yo), f32(zo));
        let q = pCell - tp - lattice_hash(mod_int3(tp, cellCount));
        d = min(d, dot(q, q));
      }
    }
  }
  return clamp(d, 0.0, 1.0);
}

// ── glm::perlin(vec4 P, vec4 rep) ───────────────────────────────────────────
fn mod289(x: vec4f) -> vec4f { return x - floor((x + 0.5) / 289.0) * 289.0; }
fn permute(x: vec4f) -> vec4f { return mod289(((x * 34.0) + 1.0) * x); }
fn taylor_inv_sqrt(r: vec4f) -> vec4f { return 1.79284291400159 - 0.85373472095314 * r; }
fn fade4(t: vec4f) -> vec4f { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

// Four lattice corners at once (one per lane): GLM's gx, gy, gz, gw from
// the permuted index i, normalized, dotted with the corner offsets.
fn corner_dots(i: vec4f, px: vec4f, py: vec4f, pz: f32, pw: f32) -> vec4f {
  let q7 = floor((i + 0.5) / 7.0);
  let q49 = floor((q7 + 0.5) / 7.0);
  var gx = (i - 7.0 * q7) / 7.0 - 0.5;
  var gy = (q7 - 7.0 * q49) / 7.0 - 0.5;
  let gz = (q49 - 6.0 * floor((q49 + 0.5) / 6.0)) / 6.0 - 0.5;
  let gw = vec4f(0.75) - abs(gx) - abs(gy) - abs(gz);
  let sw = step(gw, vec4f(0.0));
  gx -= sw * (step(vec4f(0.0), gx) - 0.5);
  gy -= sw * (step(vec4f(0.0), gy) - 0.5);
  let k = taylor_inv_sqrt(gx * gx + gy * gy + gz * gz + gw * gw);
  return k * (gx * px + gy * py + gz * pz + gw * pw);
}

// Classic Perlin noise with period rep on each axis, about [-1, 1].
// Lanes hold the (x, y) corners in the order 00, 10, 01, 11, as in GLM.
fn perlin4_periodic(P: vec4f, rep: vec4f) -> f32 {
  let Pi0 = mod_int4(floor(P), rep);
  let Pi1 = mod_int4(Pi0 + 1.0, rep);
  let Pf0 = fract(P);
  let Pf1 = Pf0 - 1.0;
  let ix = vec4f(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
  let iy = vec4f(Pi0.y, Pi0.y, Pi1.y, Pi1.y);
  let ixy = permute(permute(ix) + iy);
  let ixy0 = permute(ixy + Pi0.z);
  let ixy1 = permute(ixy + Pi1.z);
  let px = vec4f(Pf0.x, Pf1.x, Pf0.x, Pf1.x);
  let py = vec4f(Pf0.y, Pf0.y, Pf1.y, Pf1.y);
  let n00 = corner_dots(permute(ixy0 + Pi0.w), px, py, Pf0.z, Pf0.w);
  let n01 = corner_dots(permute(ixy0 + Pi1.w), px, py, Pf0.z, Pf1.w);
  let n10 = corner_dots(permute(ixy1 + Pi0.w), px, py, Pf1.z, Pf0.w);
  let n11 = corner_dots(permute(ixy1 + Pi1.w), px, py, Pf1.z, Pf1.w);
  let f = fade4(Pf0);
  let n_zw = mix(mix(n00, n01, f.w), mix(n10, n11, f.w), f.z);
  let n_yzw = mix(n_zw.xy, n_zw.zw, f.y);
  return 2.2 * mix(n_yzw.x, n_yzw.y, f.x);
}

// Tileable3dNoise::PerlinNoise. The weight squares each octave, as in the
// original (0.5, 0.25, 0.0625); the frequency doubles and is the period.
fn perlin_fbm(p: vec3f, w: f32, frequency0: f32, octaves: i32) -> f32 {
  var frequency = frequency0;
  var sum = 0.0;
  var weightSum = 0.0;
  var weight = 0.5;
  for (var oct = 0; oct < octaves; oct++) {
    sum += perlin4_periodic(vec4f(p, w) * frequency, vec4f(frequency)) * weight;
    weightSum += weight;
    weight *= weight;
    frequency *= 2.0;
  }
  return clamp((sum / weightSum) * 0.5 + 0.5, 0.0, 1.0);
}

// main.cpp remap (GPU Pro 7).
fn remap(v: f32, a: f32, b: f32, c: f32, d: f32) -> f32 {
  return c + ((v - a) / (b - a)) * (d - c);
}
