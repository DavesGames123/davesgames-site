// ============================================================================
//  DLA TERRAIN  ·  shaders/post.wgsl — TAA, exposure, bloom, AgX, grade (CORE)
// ----------------------------------------------------------------------------
//  render/post.js runs these passes on the HDR scene (gpu.loadWGSL joins
//  common.wgsl in front, so G is group 0):
//    fs_taa       reprojects the history with the depth (G.invViewProj, then
//                 G.prevViewProj), clips it to the 3x3 YCoCg colour box of
//                 the new frame (variance clip), and mixes P.p2.x of the new
//                 frame in. Luma weights cut the flicker of hot pixels.
//    fs_lum       log2 luminance with a centre weight, into a 256 x 256 rg
//                 target (r = w log2 L, g = w); fs_down2 halves it to 1 x 1
//    fs_expo      1 x 1: exposure = key / 2^(mean log2 L), eased with dt
//                 (faster up than down, like an eye)
//    fs_bdown     dual filter down (Bjorge 2015): centre x 4 + 4 corners
//    fs_bup       dual filter up: an 8-tap tent, added by the blend state
//    fs_composite scene + bloom, x exposure, white balance, AgX (Sobotka,
//                 the polynomial fit of Wrensch, as in
//                 pages/color-table/shaders/pack.wgsl, here with the full
//                 inset and outset matrices), look (slope, power,
//                 saturation), vignette, grain, dither
//    fs_fxaa      FXAA (Lottes 2009, the lite form) for quality Low (no TAA)
//  grep -n targets: "fn fs_taa", "fn fs_lum", "fn fs_expo", "fn fs_bdown",
//  "fn fs_bup", "fn fs_composite", "fn fs_fxaa", "fn agx"
// ============================================================================

struct PostU {
  p0: vec4f,   // bloom mix, exposure comp EV, auto key, adapt rate (1/s)
  p1: vec4f,   // vignette, grain, contrast, saturation
  p2: vec4f,   // taa new-frame weight, history valid 0/1, min exposure, max exposure
  p3: vec4f,   // white balance gain rgb, manual exposure (0 = auto)
  p4: vec4f,   // lift rgb, dt s
  p5: vec4f,   // gain rgb, look power
  p6: vec4f,   // x 1 / bloom levels (the up chain sums the levels), y exposure (last readback), output size px zw
};
@group(1) @binding(0) var<uniform> P: PostU;
@group(1) @binding(1) var tA: texture_2d<f32>;
@group(1) @binding(2) var tB: texture_2d<f32>;
@group(1) @binding(3) var tD: texture_depth_2d;
@group(1) @binding(4) var sL: sampler;
@group(1) @binding(5) var tC: texture_2d<f32>;

struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs_post(@builtin(vertex_index) i: u32) -> VOut {
  let xy = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return VOut(vec4f(xy * 2.0 - 1.0, 0.0, 1.0), vec2f(xy.x, 1.0 - xy.y));
}

fn toYCoCg(c: vec3f) -> vec3f {
  return vec3f(dot(c, vec3f(0.25, 0.5, 0.25)), dot(c, vec3f(0.5, 0.0, -0.5)), dot(c, vec3f(-0.25, 0.5, -0.25)));
}
fn fromYCoCg(c: vec3f) -> vec3f { return vec3f(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
// tonemap-style weight: bright pixels count less in the resolve
fn tmw(c: vec3f) -> vec3f { return c / (1.0 + cm_luminance(c)); }
fn itmw(c: vec3f) -> vec3f { return c / max(1.0 - cm_luminance(c), 1e-4); }

// the history with a 5-tap Catmull-Rom filter (Jimenez 2016): a bilinear
// fetch blurs the image a little more on each frame of camera motion
fn historyCR(uv: vec2f, size: vec2f) -> vec3f {
  let sp = uv * size;
  let tc1 = floor(sp - vec2f(0.5)) + vec2f(0.5);
  let f = sp - tc1;
  let w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  let w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  let w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  let w3 = f * f * (-0.5 + 0.5 * f);
  let w12 = w1 + w2;
  let tc0 = (tc1 - vec2f(1.0)) / size;
  let tc3 = (tc1 + vec2f(2.0)) / size;
  let tc12 = (tc1 + w2 / w12) / size;
  var c = textureSampleLevel(tB, sL, vec2f(tc12.x, tc0.y), 0.0).rgb * (w12.x * w0.y);
  c += textureSampleLevel(tB, sL, vec2f(tc0.x, tc12.y), 0.0).rgb * (w0.x * w12.y);
  c += textureSampleLevel(tB, sL, vec2f(tc12.x, tc12.y), 0.0).rgb * (w12.x * w12.y);
  c += textureSampleLevel(tB, sL, vec2f(tc3.x, tc12.y), 0.0).rgb * (w3.x * w12.y);
  c += textureSampleLevel(tB, sL, vec2f(tc12.x, tc3.y), 0.0).rgb * (w12.x * w3.y);
  let wsum = (w12.x * w0.y) + (w0.x * w12.y) + (w12.x * w12.y) + (w3.x * w12.y) + (w12.x * w3.y);
  return c / max(wsum, 1e-4);
}

// ── TAA ── tA = this frame (HDR), tB = the history, tD = the depth
@fragment fn fs_taa(v: VOut) -> @location(0) vec4f {
  let dims = vec2i(textureDimensions(tA));
  let ip = vec2i(v.pos.xy);
  let uv = (vec2f(ip) + vec2f(0.5)) / vec2f(dims);
  var m1 = vec3f(0.0);
  var m2 = vec3f(0.0);
  var cmin = vec3f(1e9);
  var cmax = vec3f(-1e9);
  var cur = vec3f(0.0);
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let q = clamp(ip + vec2i(x, y), vec2i(0), dims - vec2i(1));
      let c = toYCoCg(tmw(max(textureLoad(tA, q, 0).rgb, vec3f(0.0))));
      if (x == 0 && y == 0) { cur = c; }
      m1 += c; m2 += c * c;
      cmin = min(cmin, c); cmax = max(cmax, c);
    }
  }
  let d = textureLoad(tD, ip, 0);
  var prevClip: vec4f;
  if (d <= 0.0) {
    // the sky: reproject the view direction only
    let dir = worldFromDepth(uv, 1.0) - G.camPos.xyz;
    prevClip = G.prevViewProj * vec4f(normalize(dir), 0.0);
  } else {
    prevClip = G.prevViewProj * vec4f(worldFromDepth(uv, d), 1.0);
  }
  let puv = prevClip.xy / prevClip.w * vec2f(0.5, -0.5) + vec2f(0.5);
  var a = P.p2.x;
  if (P.p2.y < 0.5 || prevClip.w <= 0.0 || any(puv < vec2f(0.0)) || any(puv > vec2f(1.0))) { a = 1.0; }
  let hist = toYCoCg(tmw(max(historyCR(puv, vec2f(textureDimensions(tB))), vec3f(0.0))));
  // variance clip toward the mean, inside the min/max box
  let mu = m1 / 9.0;
  let sig = sqrt(max(m2 / 9.0 - mu * mu, vec3f(0.0)));
  let bmin = max(cmin, mu - sig * 1.25);
  let bmax = min(cmax, mu + sig * 1.25);
  let hc = clamp(hist, bmin, bmax);
  let out = itmw(fromYCoCg(mix(hc, cur, a)));
  return vec4f(max(out, vec3f(0.0)), 1.0);
}
// plain copy for the frames with no TAA
@fragment fn fs_copy(v: VOut) -> @location(0) vec4f {
  return vec4f(max(textureLoad(tA, vec2i(v.pos.xy), 0).rgb, vec3f(0.0)), 1.0);
}

// ── exposure ──
@fragment fn fs_lum(v: VOut) -> @location(0) vec4f {
  let c = textureSampleLevel(tA, sL, v.uv, 0.0).rgb;
  let l = max(cm_luminance(c), 1e-5);
  let r = v.uv - vec2f(0.5, 0.55);
  let w = exp(-dot(r, r) * 6.0) + 0.15;
  return vec4f(w * clamp(log2(l), -16.0, 16.0), w, 0.0, 1.0);
}
@fragment fn fs_down2(v: VOut) -> @location(0) vec4f {
  return textureSampleLevel(tA, sL, v.uv, 0.0);
}
@fragment fn fs_expo(v: VOut) -> @location(0) vec4f {
  let s = textureLoad(tA, vec2i(0), 0);
  let avg = s.x / max(s.y, 1e-6);
  let tgt = clamp(P.p0.z / exp2(avg), P.p2.z, P.p2.w);
  let prev = textureLoad(tB, vec2i(0), 0).r;
  var e = tgt;
  if (prev > 0.0 && P.p2.y > 0.5) {
    // brighter scene (target down): adapt fast; darker: slower
    let rate = select(P.p0.w * 0.6, P.p0.w * 1.6, tgt < prev);
    e = exp(mix(log(prev), log(tgt), 1.0 - exp(-P.p4.w * rate)));
  }
  return vec4f(e, avg, 0.0, 1.0);
}

// ── bloom (dual filter) ──
const BLOOM_KNEE: f32 = 300.0;   // exposed luminance where the soft clamp starts
@fragment fn fs_bdown(v: VOut) -> @location(0) vec4f {
  let px = 1.0 / vec2f(textureDimensions(tA));
  let h = px * 1.0;
  var c = textureSampleLevel(tA, sL, v.uv, 0.0).rgb * 4.0;
  c += textureSampleLevel(tA, sL, v.uv + vec2f(-h.x, -h.y), 0.0).rgb;
  c += textureSampleLevel(tA, sL, v.uv + vec2f(h.x, -h.y), 0.0).rgb;
  c += textureSampleLevel(tA, sL, v.uv + vec2f(-h.x, h.y), 0.0).rgb;
  c += textureSampleLevel(tA, sL, v.uv + vec2f(h.x, h.y), 0.0).rgb;
  // soft clamp in exposed units (P.p6.y = the exposure of the last
  // readback): a single hot pixel must not bloom a disc, but the sun
  // (about 3.7e4 before exposure) keeps enough energy for a soft glare.
  // The old clamp at 60 before exposure took almost all of the sun out.
  let o = c / 8.0;
  let ex = max(cm_luminance(o) * P.p6.y, 0.0);
  return vec4f(o * (1.0 / (1.0 + (max(0.0, ex - BLOOM_KNEE) / BLOOM_KNEE))), 1.0);
}
@fragment fn fs_bup(v: VOut) -> @location(0) vec4f {
  let px = 1.0 / vec2f(textureDimensions(tA));
  let h = px * 1.0;
  var c = textureSampleLevel(tA, sL, v.uv + vec2f(-h.x * 2.0, 0.0), 0.0).rgb;
  c += textureSampleLevel(tA, sL, v.uv + vec2f(h.x * 2.0, 0.0), 0.0).rgb;
  c += textureSampleLevel(tA, sL, v.uv + vec2f(0.0, -h.y * 2.0), 0.0).rgb;
  c += textureSampleLevel(tA, sL, v.uv + vec2f(0.0, h.y * 2.0), 0.0).rgb;
  c += textureSampleLevel(tA, sL, v.uv + vec2f(-h.x, -h.y), 0.0).rgb * 2.0;
  c += textureSampleLevel(tA, sL, v.uv + vec2f(h.x, -h.y), 0.0).rgb * 2.0;
  c += textureSampleLevel(tA, sL, v.uv + vec2f(-h.x, h.y), 0.0).rgb * 2.0;
  c += textureSampleLevel(tA, sL, v.uv + vec2f(h.x, h.y), 0.0).rgb * 2.0;
  return vec4f(c / 12.0, 1.0);
}

// ── AgX ──
fn agx_curve(x: vec3f) -> vec3f {
  let x2 = x * x;
  let x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
fn agx(c: vec3f) -> vec3f {
  let inset = mat3x3f(
    vec3f(0.842479062253094, 0.0423282422610123, 0.0423756549057051),
    vec3f(0.0784335999999992, 0.878468636469772, 0.0784336),
    vec3f(0.0792237451477643, 0.0791661274605434, 0.879142973793104));
  let minEv = -12.47393;
  let maxEv = 4.026069;
  var v = inset * max(c, vec3f(1e-10));
  v = clamp(log2(v), vec3f(minEv), vec3f(maxEv));
  v = (v - minEv) / (maxEv - minEv);
  return agx_curve(v);
}
fn agxOut(v: vec3f) -> vec3f {
  let outset = mat3x3f(
    vec3f(1.19687900512017, -0.0528968517574562, -0.0529716355144438),
    vec3f(-0.0980208811401368, 1.15190312990417, -0.0980434501171241),
    vec3f(-0.0990297440797205, -0.0989611768448433, 1.15107367264116));
  return outset * v;
}

// tA = the resolved scene, tB = bloom level 0, tC = exposure (1 x 1)
@fragment fn fs_composite(v: VOut) -> @location(0) vec4f {
  var c = textureSampleLevel(tA, sL, v.uv, 0.0).rgb;
  var ke = textureLoad(tC, vec2i(0), 0).r;
  if (P.p3.w > 0.0) { ke = P.p3.w; }
  ke = ke * exp2(P.p0.y);
  {
    // light sharpen (a cross unsharp mask in tonemapped space, clamped):
    // the TAA resolve and the render scale soften the image
    let px = 1.0 / vec2f(textureDimensions(tA));
    let n = tmw(ke * textureSampleLevel(tA, sL, v.uv + vec2f(0.0, -px.y), 0.0).rgb) + tmw(ke * textureSampleLevel(tA, sL, v.uv + vec2f(0.0, px.y), 0.0).rgb)
      + tmw(ke * textureSampleLevel(tA, sL, v.uv + vec2f(-px.x, 0.0), 0.0).rgb) + tmw(ke * textureSampleLevel(tA, sL, v.uv + vec2f(px.x, 0.0), 0.0).rgb);
    let tc = tmw(ke * c);
    let sharp = clamp(tc + (tc - n * 0.25) * 0.45, tc * 0.6, tc * 1.6 + vec3f(0.02));
    c = itmw(clamp(sharp, vec3f(0.0), vec3f(0.98))) / max(ke, 1e-6);
  }
  let b = textureSampleLevel(tB, sL, v.uv, 0.0).rgb * P.p6.x;
  c = mix(c, b, P.p0.x);
  var e = textureLoad(tC, vec2i(0), 0).r;
  if (P.p3.w > 0.0) { e = P.p3.w; }
  c = c * e * exp2(P.p0.y) * P.p3.rgb;
  // AgX base, then the look in the AgX log space (slope, power, saturation)
  var a = agx(c);
  let lum = cm_luminance(a);
  a = pow(max(a, vec3f(0.0)), vec3f(P.p5.w));
  a = vec3f(cm_luminance(a)) + (a - vec3f(cm_luminance(a))) * P.p1.w;
  a = agxOut(a);
  // grade: contrast round 0.18 grey in display space, lift and gain
  a = max(a, vec3f(0.0));
  a = (a - vec3f(0.42)) * P.p1.z + vec3f(0.42);
  a = a * P.p5.rgb + P.p4.rgb * (vec3f(1.0) - a);
  // vignette
  let r = (v.uv - vec2f(0.5)) * vec2f(P.p6.z / max(P.p6.w, 1.0), 1.0);
  a *= mix(1.0, 1.0 - smoothstep(0.25, 1.25, length(r)), P.p1.x);
  // grain: luma-weighted, fine, moving
  let g = cm_hash12(v.pos.xy + vec2f(fract(G.camPos.w * 7.13) * 917.0, fract(G.camPos.w * 3.7) * 413.0)) - 0.5;
  a += vec3f(g * P.p1.y * (0.35 + 0.65 * (1.0 - lum)));
  // 8-bit dither
  a += vec3f((cm_ign(v.pos.xy) - 0.5) / 255.0);
  return vec4f(clamp(a, vec3f(0.0), vec3f(1.0)), 1.0);
}

// ── FXAA (lite) on the display-space image: tA ──
fn fl(c: vec3f) -> f32 { return dot(c, vec3f(0.299, 0.587, 0.114)); }
@fragment fn fs_fxaa(v: VOut) -> @location(0) vec4f {
  let px = 1.0 / vec2f(textureDimensions(tA));
  let uv = v.uv;
  let cM = textureSampleLevel(tA, sL, uv, 0.0).rgb;
  let lNW = fl(textureSampleLevel(tA, sL, uv + vec2f(-1.0, -1.0) * px, 0.0).rgb);
  let lNE = fl(textureSampleLevel(tA, sL, uv + vec2f(1.0, -1.0) * px, 0.0).rgb);
  let lSW = fl(textureSampleLevel(tA, sL, uv + vec2f(-1.0, 1.0) * px, 0.0).rgb);
  let lSE = fl(textureSampleLevel(tA, sL, uv + vec2f(1.0, 1.0) * px, 0.0).rgb);
  let lM = fl(cM);
  let lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  let lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  var dir = vec2f(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  let red = max((lNW + lNE + lSW + lSE) * (0.25 * 0.125), 1.0 / 128.0);
  let rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
  dir = clamp(dir * rcp, vec2f(-8.0), vec2f(8.0)) * px;
  let rA = 0.5 * (textureSampleLevel(tA, sL, uv + dir * (1.0 / 3.0 - 0.5), 0.0).rgb + textureSampleLevel(tA, sL, uv + dir * (2.0 / 3.0 - 0.5), 0.0).rgb);
  let rB = rA * 0.5 + 0.25 * (textureSampleLevel(tA, sL, uv + dir * -0.5, 0.0).rgb + textureSampleLevel(tA, sL, uv + dir * 0.5, 0.0).rgb);
  let lB = fl(rB);
  if (lB < lMin || lB > lMax) { return vec4f(rA, 1.0); }
  return vec4f(rB, 1.0);
}
