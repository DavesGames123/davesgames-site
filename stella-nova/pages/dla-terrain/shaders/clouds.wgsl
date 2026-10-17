// ============================================================================
//  DLA TERRAIN  ·  shaders/clouds.wgsl — volumetric clouds (package SKY)
//  render/sky.js joins: common.wgsl + detail + the SKY library part of
//  sky.wgsl (struct SkyU, the atmosphere, the cloud layer) + this file.
// ----------------------------------------------------------------------------
//  NOISE (compute, once)
//    csNoiseBase    128^3 rgba8: Perlin-Worley, Worley FBM x 3 (shape)
//    csNoiseDetail   32^3 rgba8: Worley FBM x 3 + packed (erosion)
//    csNoise2D      512^2 rgba8: coverage, type, cirrus streaks, variation
//    The recipes, the periodic Perlin noise (perlin4_periodic) and the
//    tileable Worley cells follow pages/volume-noise/shaders/noise.wgsl and
//    gen.wgsl, which port TileableVolumeNoise by Sebastien Hillaire (MIT,
//    notice below). The changes: the lattice hash is the integer PCG hash
//    sk_hash3 (no hash table), and each cell has a 3D feature offset.
//    The cloud model is after Schneider, "Real-time volumetric
//    cloudscapes" (GPU Pro 7) and Hillaire 2016 (Frostbite).
//  CLOUDS (compute, each frame, at half resolution)
//    csCloudShadow  512^2: sun transmittance through the layer, read by
//                   cloudShadow(p) in sky.wgsl (ground, water, haze, grass)
//    csClouds       the raymarch: cumulus / stratus by the cumulus mix,
//                   storm towers with anvils, cirrus at 8.5 km. Light
//                   march of 6 cone steps to the sun (or the moon),
//                   dual-lobe HG with a silver lining lobe, powder,
//                   3 octave multiple scattering (Wrenninge 2013),
//                   lightning glow round the bolt, aerial perspective.
//                   Out: rgba (in-scatter, transmittance), depth (front
//                   distance, mean distance).
//    csCloudResolve temporal reprojection with G.prevViewProj and a 3x3
//                   neighbourhood clamp, into the history.
//  COMPOSITE (draw, in drawVolumetric)
//    fsCloudComp    bilinear up-sample, hidden behind nearer terrain,
//                   premultiplied (blend one, one-minus-src-alpha).
//
//  grep -n targets: "fn cl_worleyCells", "fn cl_perlin", "fn csNoiseBase",
//  "fn csNoiseDetail", "fn csNoise2D", "fn cl_coverage", "fn cl_density",
//  "fn cl_lightMarch", "fn cl_scatter", "fn cl_cirrus", "fn csCloudShadow",
//  "fn csClouds", "fn csCloudResolve", "fn fsCloudComp"
//
//  TileableVolumeNoise: The MIT License (MIT), Copyright(c) 2017 Sebastien
//  Hillaire. Permission is hereby granted, free of charge, to any person
//  obtaining a copy of this software and associated documentation files
//  (the "Software"), to deal in the Software without restriction, including
//  without limitation the rights to use, copy, modify, merge, publish,
//  distribute, sublicense, and/or sell copies of the Software, and to
//  permit persons to whom the Software is furnished to do so, subject to
//  the following conditions: The above copyright notice and this permission
//  notice shall be included in all copies or substantial portions of the
//  Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
//  EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
//  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
//  NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
//  DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
//  OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
//  USE OR OTHER DEALINGS IN THE SOFTWARE.
// ============================================================================

// ── tileable noise (after pages/volume-noise, MIT, Hillaire) ────────────────
fn cl_modi3(x: vec3f, y: f32) -> vec3f { return x - y * floor((x + 0.5) / y); }
fn cl_modi4(x: vec4f, y: vec4f) -> vec4f { return x - y * floor((x + 0.5) / y); }

// Squared distance to the nearest feature point, period cellCount.
fn cl_worleyCells(p: vec3f, cellCount: f32) -> f32 {
  let pc = p * cellCount;
  let fl = floor(pc);
  var d = 1.0e10;
  for (var xo = -1; xo <= 1; xo++) {
    for (var yo = -1; yo <= 1; yo++) {
      for (var zo = -1; zo <= 1; zo++) {
        let tp = fl + vec3f(f32(xo), f32(yo), f32(zo));
        let q = pc - tp - sk_hash3(cl_modi3(tp, cellCount) + vec3f(cellCount * 31.0));
        d = min(d, dot(q, q));
      }
    }
  }
  return clamp(d, 0.0, 1.0);
}

fn cl_mod289(x: vec4f) -> vec4f { return x - floor((x + 0.5) / 289.0) * 289.0; }
fn cl_permute(x: vec4f) -> vec4f { return cl_mod289(((x * 34.0) + 1.0) * x); }
fn cl_corners(i: vec4f, px: vec4f, py: vec4f, pz: f32, pw: f32) -> vec4f {
  let q7 = floor((i + 0.5) / 7.0);
  let q49 = floor((q7 + 0.5) / 7.0);
  var gx = (i - 7.0 * q7) / 7.0 - 0.5;
  var gy = (q7 - 7.0 * q49) / 7.0 - 0.5;
  let gz = (q49 - 6.0 * floor((q49 + 0.5) / 6.0)) / 6.0 - 0.5;
  let gw = vec4f(0.75) - abs(gx) - abs(gy) - abs(gz);
  let sw = step(gw, vec4f(0.0));
  gx -= sw * (step(vec4f(0.0), gx) - 0.5);
  gy -= sw * (step(vec4f(0.0), gy) - 0.5);
  let k = 1.79284291400159 - 0.85373472095314 * (gx * gx + gy * gy + gz * gz + gw * gw);
  return k * (gx * px + gy * py + gz * pz + gw * pw);
}
// Periodic 4D Perlin noise (GLM / webgl-noise, MIT), about -1..1.
fn cl_perlin(P: vec4f, rep: vec4f) -> f32 {
  let Pi0 = cl_modi4(floor(P), rep);
  let Pi1 = cl_modi4(Pi0 + 1.0, rep);
  let Pf0 = fract(P);
  let Pf1 = Pf0 - 1.0;
  let ix = vec4f(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
  let iy = vec4f(Pi0.y, Pi0.y, Pi1.y, Pi1.y);
  let ixy = cl_permute(cl_permute(ix) + iy);
  let ixy0 = cl_permute(ixy + Pi0.z);
  let ixy1 = cl_permute(ixy + Pi1.z);
  let px = vec4f(Pf0.x, Pf1.x, Pf0.x, Pf1.x);
  let py = vec4f(Pf0.y, Pf0.y, Pf1.y, Pf1.y);
  let n00 = cl_corners(cl_permute(ixy0 + Pi0.w), px, py, Pf0.z, Pf0.w);
  let n01 = cl_corners(cl_permute(ixy0 + Pi1.w), px, py, Pf0.z, Pf1.w);
  let n10 = cl_corners(cl_permute(ixy1 + Pi0.w), px, py, Pf1.z, Pf0.w);
  let n11 = cl_corners(cl_permute(ixy1 + Pi1.w), px, py, Pf1.z, Pf1.w);
  let f = Pf0 * Pf0 * Pf0 * (Pf0 * (Pf0 * 6.0 - 15.0) + 10.0);
  let nzw = mix(mix(n00, n01, f.w), mix(n10, n11, f.w), f.z);
  let nyzw = mix(nzw.xy, nzw.zw, f.y);
  return 2.2 * mix(nyzw.x, nyzw.y, f.x);
}
fn cl_perlinFbm(p: vec3f, w: f32, f0: f32, octaves: i32) -> f32 {
  var fr = f0;
  var sum = 0.0;
  var ws = 0.0;
  var wt = 0.5;
  for (var o = 0; o < octaves; o++) {
    sum += cl_perlin(vec4f(p, w) * fr, vec4f(fr)) * wt;
    ws += wt;
    wt *= wt;
    fr *= 2.0;
  }
  return clamp((sum / ws) * 0.5 + 0.5, 0.0, 1.0);
}

@group(3) @binding(0) var outVol: texture_storage_3d<rgba8unorm, write>;
@group(3) @binding(1) var out2D: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(4, 4, 4)
fn csNoiseBase(@builtin(global_invocation_id) id: vec3u) {
  let n = textureDimensions(outVol).x;
  if (id.x >= n || id.y >= n || id.z >= n) { return; }
  let p = vec3f(id) / f32(n);
  let pn = cl_perlinFbm(p, 0.0, 8.0, 3);
  let pw0 = 1.0 - cl_worleyCells(p, 8.0);
  let pw1 = 1.0 - cl_worleyCells(p, 32.0);
  let pw2 = 1.0 - cl_worleyCells(p, 56.0);
  let wf = pw0 * 0.625 + pw1 * 0.25 + pw2 * 0.125;
  let perlinWorley = sk_remap(pn, 0.0, 1.0, wf, 1.0);
  let w1 = 1.0 - cl_worleyCells(p, 8.0);
  let w2 = 1.0 - cl_worleyCells(p, 16.0);
  let w3 = 1.0 - cl_worleyCells(p, 32.0);
  let w4 = 1.0 - cl_worleyCells(p, 64.0);
  let f0 = w1 * 0.625 + w2 * 0.25 + w3 * 0.125;
  let f1 = w2 * 0.625 + w3 * 0.25 + w4 * 0.125;
  let f2 = w3 * 0.75 + w4 * 0.25;
  textureStore(outVol, id, vec4f(perlinWorley, f0, f1, f2));
}

@compute @workgroup_size(4, 4, 4)
fn csNoiseDetail(@builtin(global_invocation_id) id: vec3u) {
  let n = textureDimensions(outVol).x;
  if (id.x >= n || id.y >= n || id.z >= n) { return; }
  let p = vec3f(id) / f32(n);
  let w0 = 1.0 - cl_worleyCells(p, 2.0);
  let w1 = 1.0 - cl_worleyCells(p, 4.0);
  let w2 = 1.0 - cl_worleyCells(p, 8.0);
  let w3 = 1.0 - cl_worleyCells(p, 16.0);
  let f0 = w0 * 0.625 + w1 * 0.25 + w2 * 0.125;
  let f1 = w1 * 0.625 + w2 * 0.25 + w3 * 0.125;
  let f2 = w2 * 0.75 + w3 * 0.25;
  textureStore(outVol, id, vec4f(f0, f1, f2, f0 * 0.625 + f1 * 0.25 + f2 * 0.125));
}

@compute @workgroup_size(8, 8)
fn csNoise2D(@builtin(global_invocation_id) id: vec3u) {
  let n = textureDimensions(out2D).x;
  if (id.x >= n || id.y >= n) { return; }
  let uv = vec2f(id.xy) / f32(n);
  let p = vec3f(uv, 0.37);
  // coverage: Perlin cut by Worley, cells about 1 / 6 of the tile
  let pn = cl_perlinFbm(p, 0.0, 4.0, 4);
  let wn = 1.0 - cl_worleyCells(p, 6.0);
  let wn2 = 1.0 - cl_worleyCells(p, 12.0);
  let cov = clamp(pn * 0.55 + wn * 0.3 + wn2 * 0.15, 0.0, 1.0);
  let kind = cl_perlinFbm(vec3f(uv, 0.71), 0.0, 2.0, 2);
  // cirrus: long streaks, stretched noise of high frequency
  let ci = cl_perlinFbm(vec3f(uv.x, uv.y, 0.13), 0.5, 8.0, 4);
  let ci2 = 1.0 - cl_worleyCells(vec3f(uv, 0.9), 16.0);
  let vari = cl_perlinFbm(vec3f(uv, 0.21), 0.3, 1.0, 2);
  textureStore(out2D, vec2i(id.xy), vec4f(cov, kind, clamp(ci * 0.7 + ci2 * 0.3, 0.0, 1.0), vari));
}

// ── the cloud field ──────────────────────────────────────────────────────────
const CL_MAP_M: f32 = 17000.0;     // one tile of the coverage map
const CL_SHAPE_M: f32 = 5200.0;    // one tile of the shape noise
const CL_DETAIL_M: f32 = 760.0;    // one tile of the detail noise
const CL_SIGMA: f32 = 0.045;       // extinction 1/m at density 1

struct ClLayer { h0: f32, h1: f32 }

fn cl_layer() -> ClLayer {
  var l: ClLayer;
  l.h0 = S.cloud0.x;
  l.h1 = mix(S.cloud0.y, S.cloud2.z, S.cloud1.x * S.cloud1.x);
  return l;
}

// Local coverage 0..1 at world xz (x: coverage, y: cumulus mix).
fn cl_coverage(xz: vec2f) -> vec2f {
  let q = (xz + S.cloud1.zw) / CL_MAP_M;
  let m = textureSampleLevel(tNoise2D, sRepeat, q, 0.0);
  let m2 = textureSampleLevel(tNoise2D, sRepeat, q * 0.23 + vec2f(0.31, 0.77), 0.0);
  let cover = S.cloud0.z;
  // the raw noise spans about 0.3 .. 0.85: stretch it to 0 .. 1
  let field = clamp((m.r - 0.36) / 0.44, 0.0, 1.0) * 0.8 + clamp((m2.a - 0.3) / 0.4, 0.0, 1.0) * 0.2;
  // cover 0 -> no cloud, 1 -> all cloud; the threshold moves through the field
  let lo = 1.0 - cover * 1.2 - 0.06;
  let c = sk_ss(lo, lo + 0.24, field) * sk_ss(0.0, 0.06, cover);
  let cum = clamp(S.cloud0.w + (m.g - 0.5) * 0.6, 0.0, 1.0);
  // a full deck keeps some texture: the shape noise always cuts a little
  return vec2f(min(c, 0.88 + 0.08 * field), cum);
}

// A ragged base: the base height moves by up to a fifth of the layer.
fn cl_baseOffset(xz: vec2f) -> f32 {
  let q = (xz + S.cloud1.zw) / 6500.0;
  let n = textureSampleLevel(tNoise2D, sRepeat, q, 0.0);
  return (n.r - 0.55) * 0.4 + (n.a - 0.5) * 0.25;
}

// Density 0..1 at world p. full: add the detail erosion.
fn cl_density(p: vec3f, full: bool) -> f32 {
  let L = cl_layer();
  let h = sk_layerH(p);
  var hf = (h - L.h0) / max(L.h1 - L.h0, 1.0);
  if (hf <= 0.0 || hf >= 1.0) { return 0.0; }
  // the ragged base: lift it where the offset noise is high
  let off = max(cl_baseOffset(p.xz), 0.0) * (0.35 + 0.65 * S.cloud0.z) * (1.0 - 0.75 * S.cloud1.x * sk_ss(0.5, 0.9, hf));
  hf = (hf - off) / max(1.0 - off, 0.05);
  if (hf <= 0.0) { return 0.0; }
  let cv = cl_coverage(p.xz);
  var cov = cv.x;
  if (cov < 0.01) { return 0.0; }
  let storm = S.cloud1.x;
  // the vertical profile: stratus thin and flat, cumulus round with a flat base
  let strat = sk_ss(0.0, 0.06, hf) * sk_ss(0.32, 0.12, hf);
  let cumTop = mix(0.45, 1.0, cov);
  let cum = sk_ss(0.0, 0.1, hf) * sk_ss(cumTop, cumTop * 0.55, hf);
  var grad = mix(strat, cum, cv.y);
  if (storm > 0.01) {
    // cumulonimbus: a tall tower, the anvil spreads at the top
    let tower = sk_ss(0.0, 0.04, hf) * sk_ss(1.0, 0.93, hf);
    let anvil = sk_ss(0.72, 0.9, hf);
    cov = mix(cov, pow(cov, mix(1.0, 0.25, anvil)), storm);
    grad = mix(grad, tower * (0.6 + 0.4 * anvil), storm * sk_ss(0.4, 0.8, cov));
  }
  // base shape
  let sp = (p + vec3f(S.cloud1.z, 0.0, S.cloud1.w) * 0.2 + vec3f(0.0, -G.camPos.w * 0.6, 0.0)) / CL_SHAPE_M;
  let n = textureSampleLevel(tNoiseBase, sRepeat, sp, 0.0);
  let fbm = n.g * 0.625 + n.b * 0.25 + n.a * 0.125;
  // the Perlin-Worley cut by the Worley FBM: billows of 300 .. 900 m
  let shape = clamp(sk_remap(n.r, fbm * 0.8, 1.0, 0.0, 1.0), 0.0, 1.0);
  var d = clamp(sk_remap(shape * grad, 1.0 - cov, 1.0, 0.0, 1.0), 0.0, 1.0) * sqrt(cov);
  if (d <= 0.0) { return 0.0; }
  if (full) {
    // detail: wispy at the base, billows at the top; drifts faster than the shape
    let dp = (p + vec3f(S.cloud1.z, G.camPos.w * 2.0, S.cloud1.w) * 0.5) / CL_DETAIL_M;
    let dn = textureSampleLevel(tNoiseDetail, sRepeat, dp, 0.0);
    let df = dn.r * 0.625 + dn.g * 0.25 + dn.b * 0.125;
    let m = mix(df, 1.0 - df, clamp(hf * 5.0, 0.0, 1.0));
    d = clamp(sk_remap(d, m * 0.55 * S.cloud2.y, 1.0, 0.0, 1.0), 0.0, 1.0);
  }
  // more mass in the core, softer near the base
  return d * sk_ss(0.0, 0.12, hf) * (0.45 + 0.55 * sk_ss(0.0, 0.45, hf)) * 2.2 * S.cloud2.x;
}

// The light source of the clouds: the sun by day, the moon by night.
struct ClLight { dir: vec3f, rad: vec3f }
fn cl_light(p: vec3f) -> ClLight {
  var l: ClLight;
  let sunUp = sk_ss(-0.12, -0.02, G.sunDir.y);
  if (sunUp > 0.0) {
    l.dir = G.sunDir.xyz;
    // the cloud is higher than the ground: it sees the sun longer
    l.rad = sk_sunRadiance(p);
  } else {
    l.dir = S.moon.xyz;
    l.rad = sk_moonRadiance(p);
  }
  return l;
}

// Optical depth (in units of density x m) toward the light, 6 cone steps.
fn cl_lightMarch(p: vec3f, ld: vec3f, n: i32) -> f32 {
  var od = 0.0;
  var t = 0.0;
  var step = 45.0;
  for (var i = 0; i < 6; i++) {
    if (i >= n) { break; }
    let q = p + ld * (t + step * 0.5);
    od += cl_density(q, i < 2) * step;
    t += step;
    step *= 1.85;
  }
  return od;
}

// In-scatter at one sample: sun with 3 octaves of multiple scattering,
// powder, ambient from above and below, lightning glow.
fn cl_scatter(p: vec3f, d: f32, cosT: f32, ld: vec3f, lrad: vec3f, hf: f32, steps: i32) -> vec3f {
  let od = cl_lightMarch(p, ld, steps) * CL_SIGMA;
  var ms = 0.0;
  var a = 1.0;
  var b = 1.0;
  var c = 1.0;
  for (var k = 0; k < 3; k++) {
    let ph = mix(sk_hg(cosT, 0.8 * c), sk_hg(cosT, -0.3 * c), 0.25) + 0.12 * sk_hg(cosT, 0.97 * c);
    ms += a * exp(-od * b) * ph;
    a *= 0.5;
    b *= 0.35;
    c *= 0.5;
  }
  let powder = mix(1.0 - exp(-d * CL_SIGMA * 60.0), 1.0, 0.5 + 0.5 * cosT);
  let lit = lrad * ms * mix(1.0, powder, 0.5) * 1.4;
  // ambient: sky from above (G.ambient is the clear-sky hemisphere), ground bounce below
  let skyA = G.ambient.rgb * (1.0 / SK_PI) * (0.55 + 0.45 * hf) * mix(1.0, 0.75, S.cloud0.z);
  let grndA = (G.sunColor.rgb * max(G.sunDir.y, 0.0) * 0.12 + G.ambient.rgb * 0.05) * (1.0 - hf) / SK_PI;
  // light from the sky above comes through the cloud over this point:
  // two coarse samples up give the variation of a thick deck's base
  var odUp = 0.0;
  if (S.cloud0.z > 0.55) {
    odUp = (cl_density(p + vec3f(0.0, 220.0, 0.0), false) * 220.0 + cl_density(p + vec3f(0.0, 700.0, 0.0), false) * 520.0) * CL_SIGMA;
  }
  // a deck that is too thick for the leak still has light and dark patches
  let patchy = sk_ss(-0.25, 0.3, cl_baseOffset(p.xz * 0.6 + vec2f(913.0, 211.0)));
  let skyLeak = max(exp(-odUp * 0.09), 0.1 + 0.32 * patchy);
  var amb = (skyA * skyLeak + grndA) * mix(0.55, 1.0, exp(-od * 0.3)) * (1.0 - 0.45 * S.cloud1.x * (1.0 - hf));
  // lightning inside the cloud
  let bd = length(p - S.bolt.xyz);
  let glow = S.bolt.w * vec3f(0.75, 0.82, 1.0) * (2.0 + 45.0 * exp(-bd / 1400.0));
  return lit + amb + glow;
}

// The thin cirrus deck at 8.5 km (alpha, colour).
fn cl_cirrus(ro: vec3f, rd: vec3f, cosT: f32) -> vec4f {
  if (S.cloud1.y < 0.01) { return vec4f(0.0); }
  let hit = sk_layerHit(ro, rd, 8500.0);
  var t = hit.y;
  if (sk_layerH(ro) > 8500.0) { t = hit.x; }
  if (t <= 0.0 || t > 160000.0) { return vec4f(0.0); }
  let p = ro + rd * t;
  // streaks along the wind: stretch the map along the wind direction
  let w = normalize(G.wind.xy + vec2f(1e-3, 0.0));
  let rot = mat2x2f(w.x, -w.y, w.y, w.x);
  let q = rot * (p.xz + S.cloud1.zw * 1.6);
  let uv = vec2f(q.x / 52000.0, q.y / 9000.0);
  let n = textureSampleLevel(tNoise2D, sRepeat, uv, 0.0).b;
  let n2 = textureSampleLevel(tNoise2D, sRepeat, uv * 3.1 + vec2f(0.4, 0.1), 0.0).b;
  // patches of cirrus, not a sheet: a large mask over the streaks
  let mask = sk_ss(0.35, 0.75, textureSampleLevel(tNoise2D, sRepeat, p.xz / 140000.0 + vec2f(0.17, 0.53), 0.0).a + 0.25 * S.cloud1.y);
  let a = clamp(sk_ss(0.62 - 0.2 * S.cloud1.y, 0.98, n * 0.6 + n2 * 0.4) * S.cloud1.y * 0.8 * mask, 0.0, 0.55);
  if (a <= 0.0) { return vec4f(0.0); }
  let li = cl_light(p);
  let ph = sk_hg(cosT, 0.6) * 0.8 + 0.2 / (4.0 * SK_PI);
  let col = li.rad * ph * 2.4 + G.ambient.rgb * (0.6 / SK_PI);
  let fade = sk_ss(160000.0, 60000.0, t);
  return vec4f(col, a * fade);
}

// ── cloud shadow map ─────────────────────────────────────────────────────────
@group(3) @binding(2) var outShadow: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn csCloudShadow(@builtin(global_invocation_id) id: vec3u) {
  let sz = textureDimensions(outShadow);
  if (id.x >= sz.x || id.y >= sz.y) { return; }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(sz);
  let xz = S.shadow.xy + uv * S.shadow.z;
  let L = cl_layer();
  let sd = normalize(vec3f(G.sunDir.x, max(G.sunDir.y, 0.08), G.sunDir.z));
  let p0 = vec3f(xz.x, L.h0, xz.y);
  let len = (L.h1 - L.h0) / sd.y;
  let n = 14;
  let dt = min(len, 14000.0) / f32(n);
  var od = 0.0;
  for (var i = 0; i < n; i++) {
    od += cl_density(p0 + sd * ((f32(i) + 0.5) * dt), false) * dt;
  }
  let T = exp(-od * CL_SIGMA * 0.6);
  textureStore(outShadow, vec2i(id.xy), vec4f(T, od, 0.0, 1.0));
}

// ── the raymarch ─────────────────────────────────────────────────────────────
@group(3) @binding(3) var outCloud: texture_storage_2d<rgba16float, write>;
@group(3) @binding(4) var outCloudZ: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn csClouds(@builtin(global_invocation_id) id: vec3u) {
  let sz = textureDimensions(outCloud);
  if (id.x >= sz.x || id.y >= sz.y) { return; }
  let jit = cm_ign(vec2f(id.xy) + vec2f(f32(u32(G.frame.x) % 64u) * 5.588238, 0.0));
  let uv = (vec2f(id.xy) + 0.5) / vec2f(sz);
  let ro = G.camPos.xyz;
  let rd = viewRay(uv);
  let L = cl_layer();
  let li0 = cl_light(ro);
  let cosT = dot(rd, li0.dir);
  var col = vec3f(0.0);
  var T = 1.0;
  var front = 1.0e6;
  var wsum = 0.0;
  var tsum = 0.0;
  let seg = sk_slab(ro, rd, L.h0, L.h1, 120000.0);
  if (seg.y > seg.x) {
    let nMax = i32(S.cloud2.w);
    let len = seg.y - seg.x;
    let base = max(len / f32(nMax), 40.0);
    var t = seg.x + base * jit;
    var zeroRun = 0;
    let lsteps = select(4, 6, G.frame.z > 0.5);
    for (var i = 0; i < 160; i++) {
      if (i >= nMax * 2 || t > seg.y || T < 0.01) { break; }
      // big steps in empty air, fine steps inside the cloud
      let p = ro + rd * t;
      let dc = cl_density(p, false);
      var dt = base;
      if (dc <= 0.0) {
        zeroRun++;
        dt = base * select(1.0, 2.0, zeroRun > 2);
      } else {
        zeroRun = 0;
        let d = cl_density(p, true);
        if (d > 0.0) {
          let hf = (sk_layerH(p) - L.h0) / max(L.h1 - L.h0, 1.0);
          let li = cl_light(p);
          let Sc = cl_scatter(p, d, cosT, li.dir, li.rad, hf, lsteps) * (d * CL_SIGMA);
          let ext = d * CL_SIGMA;
          let Ts = exp(-ext * dt);
          col += T * (Sc - Sc * Ts) / max(ext, 1e-6);
          let a = T * (1.0 - Ts);
          if (T > 0.9 && T * Ts <= 0.9) { front = t; }
          wsum += a;
          tsum += a * t;
          T *= Ts;
        }
      }
      t += dt;
    }
  }
  var mean = 1.0e6;
  if (wsum > 1e-4) {
    mean = tsum / wsum;
    if (front > 9.0e5) { front = mean; }
    // aerial perspective: the air between the camera and the cloud
    // the air in front is lit by the clear sky, or under a deck by the
    // grey light that comes through it
    let clearAir = textureSampleLevel(tSkyView, sClamp, sk_skyViewUV(S.radii.w, rd, G.sunDir.xyz), 0.0).rgb * S.sun.y;
    let skyBehind = mix(clearAir, G.ambient.rgb * (0.3 / SK_PI) + G.sunColor.rgb * 0.01, sk_ss(0.45, 0.95, S.cloud0.z));
    let hMid = max(0.5 * (G.camPos.y + (ro + rd * mean).y) - G.terrain.z, 0.0);
    let ext = 1.2e-5 * exp(-hMid / 8000.0) + (S.mieS.x * 1e-3) * exp(-hMid / 1200.0) + S.vol1.z * exp(-hMid / 1500.0);
    let Ta = exp(-ext * mean);
    col = col * Ta + skyBehind * (1.0 - Ta) * (1.0 - T) * 0.9;
  }
  // cirrus, behind the low deck when the camera is below it
  let ci = cl_cirrus(ro, rd, cosT);
  if (ci.a > 0.0) {
    col += T * ci.rgb * ci.a;
    T *= 1.0 - ci.a;
    if (mean > 9.0e5) { mean = 30000.0; front = 30000.0; }
  }
  textureStore(outCloud, vec2i(id.xy), vec4f(col, T));
  textureStore(outCloudZ, vec2i(id.xy), vec4f(front, mean, 0.0, 1.0));
}

// ── temporal resolve ─────────────────────────────────────────────────────────
@group(3) @binding(5) var inCloud: texture_2d<f32>;
@group(3) @binding(6) var inCloudZ: texture_2d<f32>;
@group(3) @binding(7) var histCloud: texture_2d<f32>;
@group(3) @binding(8) var outAccum: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn csCloudResolve(@builtin(global_invocation_id) id: vec3u) {
  let sz = textureDimensions(outAccum);
  if (id.x >= sz.x || id.y >= sz.y) { return; }
  let ij = vec2i(id.xy);
  let cur = textureLoad(inCloud, ij, 0);
  var lo = cur;
  var hi = cur;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let q = clamp(ij + vec2i(x, y), vec2i(0), vec2i(sz) - vec2i(1));
      let v = textureLoad(inCloud, q, 0);
      lo = min(lo, v);
      hi = max(hi, v);
    }
  }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(sz);
  let z = textureLoad(inCloudZ, ij, 0).y;
  let dist = min(z, 60000.0);
  let wp = G.camPos.xyz + viewRay(uv) * dist;
  let pc = G.prevViewProj * vec4f(wp, 1.0);
  var outv = cur;
  if (pc.w > 0.0 && S.vol2.w > 0.0) {
    let puv = vec2f(pc.x / pc.w * 0.5 + 0.5, 0.5 - pc.y / pc.w * 0.5);
    if (all(puv > vec2f(0.0)) && all(puv < vec2f(1.0))) {
      let hs = textureSampleLevel(histCloud, sClamp, puv, 0.0);
      let hc = clamp(hs, lo, hi);
      // keep more history when the camera is still
      let moved = length(G.camPos.xyz - S.prevCam.xyz);
      let k = mix(0.12, 0.35, sk_ss(0.5, 20.0, moved));
      outv = mix(hc, cur, k);
    }
  }
  textureStore(outAccum, ij, outv);
}

// ── composite into the HDR scene ─────────────────────────────────────────────
// draw bindings: group 1 of the draw pipelines is the SKY read set plus these
@group(1) @binding(10) var tSceneDepth: texture_depth_2d;
@group(1) @binding(11) var tAccum: texture_2d<f32>;
@group(1) @binding(12) var tAccumZ: texture_2d<f32>;

struct ClVOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f }

@vertex
fn vsCloudComp(@builtin(vertex_index) vi: u32) -> ClVOut {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o: ClVOut;
  o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}

@fragment
fn fsCloudComp(i: ClVOut) -> @location(0) vec4f {
  let c = textureSampleLevel(tAccum, sClamp, i.uv, 0.0);
  if (c.a > 0.999) { discard; }
  let zc = textureSampleLevel(tAccumZ, sClamp, i.uv, 0.0).x;
  let dz = textureLoad(tSceneDepth, vec2i(i.pos.xy), 0);
  var w = 1.0;
  if (dz > 0.0) {
    let wp = worldFromDepth(i.uv, dz);
    let ds = length(wp - G.camPos.xyz);
    w = sk_ss(-200.0, 400.0, ds - zc);
  }
  if (w <= 0.0) { discard; }
  return vec4f(c.rgb * w, (1.0 - c.a) * w);
}
