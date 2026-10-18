// ============================================================================
//  DLA TERRAIN  ·  shaders/build.wgsl — the "Watch it build" overlay (CORE)
// ----------------------------------------------------------------------------
//  render/build.js draws one full-screen triangle in the water pass. The
//  fragment finds the ground point from the depth copy (before water) and
//  reads the overlay field of build.js at that point (world xz to uv). So
//  the overlay lies on the real ground, at any camera, with no mesh.
//  Output is premultiplied: rgb = glow + tint * a, blend one / 1 - a.
//    mode 1 tree      r reveal key, g light: the DLA branches glow (cyan,
//                     a white flash when a branch sticks), plus the walkers
//    mode 2 rays      r reveal key, g ray density (gold), b channel (blue)
//    mode 3 flow      r reveal key (trunks first), g log flow, b river mask
//    mode 4 erosion   g cut (blue tint), b deposit (sand tint)
//    mode 5 climate   g temperature (blue to red), b moisture (brown to teal)
//    veil             the scene goes grey by B.veil (the biome colour fades in)
//  The glow is divided by the exposure (G.ambient.w), so it reads the same
//  by day and at night.
//  grep -n targets: "struct BuildU", "fn walkerGlow", "fn fs_build"
// ============================================================================

struct BuildU {
  mode: f32, reveal: f32, amount: f32, amount2: f32,
  veil: f32, nWalk: f32, time: f32, dim: f32,
};
@group(1) @binding(0) var<uniform> B: BuildU;
@group(1) @binding(1) var tField: texture_2d<f32>;
@group(1) @binding(2) var sField: sampler;
@group(1) @binding(3) var tDepthCopy: texture_depth_2d;
@group(1) @binding(4) var tScene: texture_2d<f32>;
@group(1) @binding(5) var<storage, read> walk: array<vec4f>;

@vertex
fn vs_build(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - vec2f(1.0), 0.0, 1.0);
}

fn bss(a: f32, b: f32, x: f32) -> f32 {
  let t = clamp((x - a) / (b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// the walkers: soft dots on the ground, their size grows with the distance
fn walkerGlow(wp: vec3f) -> f32 {
  var g = 0.0;
  // MAX_WALK of render/build.js: a constant cap, whatever the uniform holds
  let n = min(u32(max(B.nWalk, 0.0)), 96u);
  let px = max(length(wp - G.camPos.xyz) * 0.0045, G.terrain.x * 0.0012);
  for (var k = 0u; k < n; k++) {
    let w = walk[k];
    if (w.z <= 0.0) { continue; }
    let d = length(wp.xz - w.xy) / px;
    g += w.z * exp(-d * d);
  }
  return g;
}

@fragment
fn fs_build(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let p = vec2i(fc.xy);
  let d = textureLoad(tDepthCopy, p, 0);
  if (d <= 0.0) { discard; }
  let uvS = fc.xy * G.screen.zw;
  let wp = worldFromDepth(uvS, d);
  let uv = worldToUV(wp.xz);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { discard; }
  let scene = textureLoad(tScene, p, 0).rgb;
  let lum = cm_luminance(scene);
  let ex = 1.0 / max(G.ambient.w, 1e-6);
  let land = bss(G.terrain.z - 3.0, G.terrain.z + 3.0, wp.y);
  let f = textureSampleLevel(tField, sField, uv, 0.0);
  var glow = vec3f(0.0);
  var tint = vec3f(0.0);
  var a = 0.0;
  let mode = i32(B.mode + 0.5);
  if (mode == 1) {
    // DLA tree: a branch shows when the reveal passes its key
    let age = B.reveal - f.r;
    let vis = bss(-0.002, 0.004, age);
    let fresh = exp(-max(age, 0.0) * 55.0);
    let col = mix(vec3f(0.35, 0.8, 1.0), vec3f(1.0, 0.97, 0.9), fresh);
    glow += col * f.g * vis * (0.9 + 2.6 * fresh) * B.amount;
    glow += vec3f(1.0, 0.86, 0.62) * walkerGlow(wp) * 1.6 * B.amount;
    tint = vec3f(0.01, 0.015, 0.03) * ex;
    a = B.dim * B.amount;
  } else if (mode == 2) {
    let age = B.reveal - f.r;
    let vis = bss(-0.003, 0.01, age);
    let front = exp(-max(age, 0.0) * 30.0) * vis;
    let dens = f.g * f.g;
    glow += vec3f(1.0, 0.72, 0.32) * (0.12 + 2.4 * dens + 2.0 * front * f.g) * vis * B.amount * land;
    let ch = bss(0.55, 1.0, f.b);
    glow += vec3f(0.22, 0.55, 1.0) * ch * ch * 1.3 * B.amount2 * land;
    tint = vec3f(0.02, 0.025, 0.04) * ex;
    a = B.dim * max(B.amount, B.amount2) * land;
  } else if (mode == 3) {
    let age = B.reveal - f.r;
    let vis = bss(-0.004, 0.01, age);
    let v = f.g;
    let lit = bss(0.25, 0.85, v);
    glow += mix(vec3f(0.15, 0.4, 1.0), vec3f(0.75, 0.95, 1.0), v) * lit * (0.6 + 2.4 * lit) * vis * B.amount * land;
    glow += vec3f(0.4, 0.9, 1.0) * f.b * 1.6 * B.amount2 * land;
    tint = vec3f(0.015, 0.02, 0.035) * ex;
    a = B.dim * B.amount * land;
  } else if (mode == 4) {
    let cut = f.g;
    let dep = f.b;
    let s = cut + dep;
    let col = (vec3f(0.25, 0.4, 1.0) * cut + vec3f(1.0, 0.74, 0.38) * dep) / max(s, 1e-4);
    a = clamp(s * 1.6, 0.0, 0.8) * B.amount * land;
    tint = col * (lum * 1.4 + 0.12 * ex);
    glow += vec3f(0.25, 0.45, 1.0) * pow(cut, 2.0) * 0.6 * B.amount * land;
  } else if (mode == 5) {
    let t = f.g;
    let cold = vec3f(0.18, 0.4, 1.0);
    let warm = vec3f(1.0, 0.32, 0.12);
    let tc = mix(mix(cold, vec3f(0.95, 0.85, 0.25), bss(0.15, 0.6, t)), warm, bss(0.6, 0.95, t));
    let mc = mix(vec3f(0.62, 0.46, 0.24), vec3f(0.08, 0.72, 0.66), f.b);
    let w = B.amount + B.amount2;
    let col = (tc * B.amount + mc * B.amount2) / max(w, 1e-4);
    a = 0.62 * clamp(w, 0.0, 1.0) * land;
    tint = col * (lum * 1.2 + 0.1 * ex);
  }
  // the grey veil (biomes: the colour fades in)
  var outC = glow * ex + tint * a;
  if (B.veil > 0.0) {
    let grey = vec3f(lum * 0.9);
    let v = B.veil * land;
    outC = outC * (1.0 - v) + grey * v;
    a = a + v * (1.0 - a);
  }
  return vec4f(outC, a);
}
