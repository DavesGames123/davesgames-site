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
//                   storm towers with anvils, cirrus at 8.5 km. Cover,
//                   type, base, top and storms of each place come from
//                   the weather model (wx_tile, weather-model.js). Light
//                   march of 6 cone steps to the sun (or the moon),
//                   dual-lobe HG with a silver lining lobe, powder,
//                   3 octave multiple scattering (Wrenninge 2013),
//                   lightning glow round the bolt, aerial perspective.
//                   Out: rgba (in-scatter, transmittance), depth (front
//                   distance, mean distance).
//    csCloudResolve temporal reprojection with G.prevViewProj and the
//                   cloud motion of the frame (S.anim0.xy), variance
//                   clipping in the 3x3 neighbourhood, into the history.
//  COMPOSITE (draw, in drawVolumetric)
//    fsCloudComp    depth-aware up-sample (each of the 4 texels hidden
//                   or not by the full-resolution depth), behind terrain,
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
  for (var o = 0; o < 8; o++) {
    if (o >= octaves) { break; }
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
const CL_SHAPE_M: f32 = 6800.0;    // one tile of the shape noise
const CL_DETAIL_M: f32 = 560.0;    // one tile of the detail noise
const CL_SIGMA: f32 = 0.045;       // extinction 1/m at density 1

struct ClLayer { h0: f32, h1: f32 }

// The slab that holds every cloud of the model domain (render/sky.js
// takes the lowest base and the highest top of the two snapshots).
fn cl_layer() -> ClLayer {
  var l: ClLayer;
  l.h0 = S.wx1.x;
  l.h1 = S.wx1.y;
  return l;
}

// The model at world xz (weather-model.js through wx_tile): cover, type,
// base, top and storm of this place, not one number for the sky.
struct ClWx { cover: f32, kind: f32, top: f32, storm: f32, base: f32 }
fn cl_wx(xz: vec2f) -> ClWx {
  let a = wx_tile(xz, 0.0);
  let b = wx_tile(xz, 1.0);
  var w: ClWx;
  w.cover = clamp(a.x, 0.0, 1.0);
  w.kind = clamp(a.y, 0.0, 1.0);
  w.top = a.z;
  w.storm = clamp(b.x, 0.0, 1.0);
  w.base = b.z;
  return w;
}

// The cloud field at world xz for the model values w: x local coverage
// 0..1, y cloud type (0 stratus and stratocumulus decks .. 1 towering
// cumulus), z base lift m (the bases of separate cloud fields differ), w
// the dome 0..1 (the top). The model gives the cover of each place (about
// 0.6 km cells); three scales of noise give the shapes inside it: weather
// systems of about 90 km, the 17 km map, and cells of about 4 km (the
// clusters of a cumulus field). The type sets the grain: cumulus gather
// in cells, stratus spread in broad sheets.
fn cl_coverage(xz: vec2f, w: ClWx) -> vec4f {
  let q = (xz + S.cloud1.zw) / CL_MAP_M;
  let m = textureSampleLevel(tNoise2D, sRepeat, q, 0.0);
  let big = textureSampleLevel(tNoise2D, sRepeat, q * 0.19 + vec2f(0.31, 0.77), 0.0);
  let sm = textureSampleLevel(tNoise2D, sRepeat, q * 4.1 + vec2f(0.53, 0.11), 0.0);
  // the raw noise spans about 0.3 .. 0.85: stretch it to 0 .. 1
  let nb = clamp((big.r - 0.36) / 0.44, 0.0, 1.0);
  let nm = clamp((m.r - 0.36) / 0.44, 0.0, 1.0);
  let ns = clamp((sm.r - 0.36) / 0.44, 0.0, 1.0);
  let cover = w.cover;
  let cum = clamp(w.kind + (m.g - 0.5) * 0.3, 0.0, 1.0);
  let grain = mix(0.12, 0.42, cum);
  // the model already has the large scale: the noise only shapes it
  let field = nb * 0.25 + nm * (0.75 - grain) + ns * grain;
  // cover 0 -> no cloud, 1 -> all cloud; the threshold moves through the field
  let lo = 1.0 - cover * 1.15 - 0.05;
  let c = sk_ss(lo, lo + mix(0.3, 0.15, cum), field) * sk_ss(0.0, 0.06, cover);
  let lift = clamp((big.g - 0.3) / 0.55, 0.0, 1.0) * 300.0 * (1.0 - w.storm) * (1.0 - cum * 0.6);
  // the dome: a wider ramp of the same field. The top of a cumulus follows
  // it, so a cloud is low at its edge and tall at its core (a dome, not a
  // pillar with walls). A full deck keeps some texture.
  let dome = sk_ss(lo - 0.05, lo + 0.45, field);
  return vec4f(min(c, 0.9 + 0.08 * field), cum, lift, dome);
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
  if (h <= L.h0 || h >= L.h1) { return 0.0; }
  let w = cl_wx(p.xz);
  if (w.cover < 0.01) { return 0.0; }
  let cv = cl_coverage(p.xz, w);
  var cov = cv.x;
  if (cov < 0.01) { return 0.0; }
  let tq = cv.y;
  let storm = w.storm;
  // the layer of this place: the model's base and top
  let b0 = w.base + cv.z;
  let thick = max(w.top - b0, 150.0);
  var hf = (h - b0) / thick;
  if (hf <= 0.0 || hf >= 1.0) { return 0.0; }
  // the ragged base of the decks; cumulus keep a flat base
  let off = max(cl_baseOffset(p.xz), 0.0) * (0.35 + 0.65 * w.cover) * mix(1.0, 0.3, tq) * (1.0 - 0.75 * storm * sk_ss(0.5, 0.9, hf));
  hf = (hf - off) / max(1.0 - off, 0.05);
  if (hf <= 0.0) { return 0.0; }
  // the vertical profile by type. A deck: a layer with a soft top. A
  // cumulus: a flat base and a round top; the top grows in the cores of
  // the clusters (dense cover), so a field has small and tall clouds.
  let topF = mix(0.85, 1.0, tq) * mix(mix(0.6, 0.25, tq), 1.0, cv.w * cv.w);
  var grad = sk_ss(0.0, mix(0.12, 0.06, tq), hf) * (1.0 - sk_ss(topF * mix(0.55, 0.7, tq), topF, hf));
  if (storm > 0.01) {
    // cumulonimbus: a tall tower, the anvil spreads at the top
    let tower = sk_ss(0.0, 0.04, hf) * sk_ss(1.0, 0.93, hf);
    let anvil = sk_ss(0.72, 0.9, hf);
    cov = mix(cov, pow(cov, mix(1.0, 0.25, anvil)), storm);
    grad = mix(grad, tower * (0.6 + 0.4 * anvil), storm * sk_ss(0.4, 0.8, cov));
  }
  if (grad <= 0.0) { return 0.0; }
  // base shape: moves with the cloud field (S.cloud1.zw), evolves upward
  let sp = (p + vec3f(S.cloud1.z, -S.anim0.z, S.cloud1.w)) / CL_SHAPE_M;
  let n = textureSampleLevel(tNoiseBase, sRepeat, sp, 0.0);
  let fbm = n.g * 0.625 + n.b * 0.25 + n.a * 0.125;
  // the Perlin-Worley cut by the Worley FBM: billows of 300 .. 900 m;
  // decks take less of the cut, so they stay joined
  let shape = clamp(sk_remap(n.r, fbm * mix(0.55, 1.0, tq), 1.0, 0.0, 1.0), 0.0, 1.0);
  var d = clamp(sk_remap(shape * grad, 1.0 - cov, 1.0, 0.0, 1.0), 0.0, 1.0) * sqrt(cov);
  if (d <= 0.0) { return 0.0; }
  if (full) {
    // detail: wispy at the base, billows at the top
    let dp = (p + vec3f(S.cloud1.z, S.anim0.w, S.cloud1.w)) / CL_DETAIL_M;
    let dn = textureSampleLevel(tNoiseDetail, sRepeat, dp, 0.0);
    let df = dn.r * 0.625 + dn.g * 0.25 + dn.b * 0.125;
    let m = mix(df, 1.0 - df, clamp(hf * 5.0, 0.0, 1.0));
    d = clamp(sk_remap(d, m * 0.68 * S.cloud2.y, 1.0, 0.0, 1.0), 0.0, 1.0);
  }
  // more mass in the core, softer near the base; thin decks are lighter
  let gain = select(1.0, 0.8, w.cover > 0.85);
  return d * sk_ss(0.0, 0.12, hf) * (0.45 + 0.55 * sk_ss(0.0, 0.45, hf)) * 2.2 * gain;
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
  let hit = sk_layerHit(ro, rd, 8500.0);
  var t = hit.y;
  if (sk_layerH(ro) > 8500.0) { t = hit.x; }
  if (t <= 0.0 || t > 160000.0) { return vec4f(0.0); }
  let p = ro + rd * t;
  // the cirrus of this place (the air mass, anvils blown off storms, the
  // cirrus ahead of a front) from the model
  let ciL = clamp(wx_tile(p.xz, 1.0).w, 0.0, 1.0);
  if (ciL < 0.01) { return vec4f(0.0); }
  // streaks along the upper wind (S.wx1.zw, a unit vector that turns only
  // slowly, so far streaks do not swing round the world origin)
  let w = normalize(S.wx1.zw + vec2f(1e-4, 0.0));
  let rot = mat2x2f(w.x, -w.y, w.y, w.x);
  let q = rot * (p.xz + S.cloud1.zw * 1.6);
  let uv = vec2f(q.x / 52000.0, q.y / 9000.0);
  let n = textureSampleLevel(tNoise2D, sRepeat, uv, 0.0).b;
  let n2 = textureSampleLevel(tNoise2D, sRepeat, uv * 3.1 + vec2f(0.4, 0.1), 0.0).b;
  // patches of cirrus, not a sheet: a large mask over the streaks
  let mask = sk_ss(0.35, 0.75, textureSampleLevel(tNoise2D, sRepeat, p.xz / 140000.0 + vec2f(0.17, 0.53), 0.0).a + 0.25 * ciL);
  let streak = sk_ss(0.62 - 0.2 * ciL, 0.98, n * 0.6 + n2 * 0.4) * ciL * 0.8 * mask;
  // cirrostratus: a thin milky veil where the cirrus is thick (ahead of a
  // front, over anvils)
  let veil = sk_ss(0.5, 1.0, ciL) * (0.1 + 0.12 * n2) * (0.6 + 0.4 * mask);
  let a = clamp(max(streak, veil), 0.0, 0.55);
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
      // the step grows with the distance (2 % of it, 50 m near), so a
      // near cloud of 1 km gets many samples and the far deck few
      var dt = min(base, 50.0 + t * 0.02);
      if (dc <= 0.0) {
        zeroRun++;
        dt = dt * select(1.0, 2.0, zeroRun > 2);
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
  // the 3 x 3 neighbourhood of this frame: mean and spread (variance
  // clipping, Salvi 2016) and the range; the history is clipped to the
  // mean +- 1.25 sigma inside the range, so it keeps the cloud shape and
  // drops what moved or changed, with less flicker than a min-max clamp
  var lo = cur;
  var hi = cur;
  var m1 = vec4f(0.0);
  var m2 = vec4f(0.0);
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let q = clamp(ij + vec2i(x, y), vec2i(0), vec2i(sz) - vec2i(1));
      let v = textureLoad(inCloud, q, 0);
      lo = min(lo, v);
      hi = max(hi, v);
      m1 += v;
      m2 += v * v;
    }
  }
  m1 = m1 / 9.0;
  let sig = sqrt(max(m2 / 9.0 - m1 * m1, vec4f(0.0)));
  let blo = max(lo, m1 - 1.25 * sig);
  let bhi = min(hi, m1 + 1.25 * sig);
  let uv = (vec2f(id.xy) + 0.5) / vec2f(sz);
  let z = textureLoad(inCloudZ, ij, 0).y;
  let dist = min(z, 60000.0);
  // the motion vector: the camera moved, and the clouds moved with the
  // wind by S.anim0.xy this frame (sky or far points: the camera only)
  let wp = G.camPos.xyz + viewRay(uv) * dist;
  let cloudy = select(0.0, 1.0, z < 9.0e5);
  let wpPrev = wp - vec3f(S.anim0.x, 0.0, S.anim0.y) * cloudy;
  let pc = G.prevViewProj * vec4f(wpPrev, 1.0);
  var outv = cur;
  if (pc.w > 0.0 && S.vol2.w > 0.0) {
    let puv = vec2f(pc.x / pc.w * 0.5 + 0.5, 0.5 - pc.y / pc.w * 0.5);
    if (all(puv > vec2f(0.0)) && all(puv < vec2f(1.0))) {
      let hs = textureSampleLevel(histCloud, sClamp, puv, 0.0);
      let hc = clamp(hs, blo, bhi);
      // keep more history when the camera is still; take more of this
      // frame where the history was clipped hard (a change, not noise)
      let moved = length(G.camPos.xyz - S.prevCam.xyz);
      let clip = clamp(length(hs - hc) * 4.0, 0.0, 1.0);
      let k = mix(mix(0.08, 0.3, sk_ss(0.5, 20.0, moved)), 0.5, clip);
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
  // depth-aware up-sampling: the 4 cloud texels round this pixel, each
  // hidden or not by this pixel's own (full resolution) scene depth, so
  // the edge where a ridge cuts a cloud follows the ridge and not the
  // texel grid of the half-size cloud target (that gave stair steps)
  let csz = vec2f(textureDimensions(tAccum));
  let fp = i.uv * csz - 0.5;
  let b0 = floor(fp);
  let f = fp - b0;
  let dz = textureLoad(tSceneDepth, vec2i(i.pos.xy), 0);
  var ds = 1.0e7;
  if (dz > 0.0) { ds = length(worldFromDepth(i.uv, dz) - G.camPos.xyz); }
  var acc = vec4f(0.0);
  var wsum = 0.0;
  for (var k = 0; k < 4; k++) {
    let o = vec2f(f32(k & 1), f32(k >> 1));
    let q = clamp(vec2i(b0 + o), vec2i(0), vec2i(csz) - vec2i(1));
    let wb = mix(1.0 - f.x, f.x, o.x) * mix(1.0 - f.y, f.y, o.y);
    let c = textureLoad(tAccum, q, 0);
    let zc = textureLoad(tAccumZ, q, 0).x;
    // a = 1 - transmittance: how much cloud this texel has
    let vis = select(1.0, sk_ss(-200.0, 400.0, ds - zc), dz > 0.0);
    acc += vec4f(c.rgb, 1.0 - c.a) * (wb * vis);
    wsum += wb;
  }
  if (acc.a <= 0.001) { discard; }
  return acc / max(wsum, 1e-4);
}
