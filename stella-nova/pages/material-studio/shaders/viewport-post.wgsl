// ============================================================================
//  MATERIAL STUDIO  ·  shaders/viewport-post.wgsl — exposure, tonemap, FXAA
// ────────────────────────────────────────────────────────────────────────────
//  Stand-alone module (no common chunk). The canvas format is not sRGB, so
//  fs_tonemap encodes sRGB itself. FXAA then runs on the encoded image.
//
//  ENTRY POINTS
//      vs_full ...... full-screen triangle
//      fs_tonemap ... HDR in, display-referred out: exposure, tonemapper,
//                     sRGB encode, blue-noise-like dither, compare divider
//      fs_fxaa ...... edge-directed anti-aliasing on the encoded image
//
//  TONEMAP IDS  (contract TONEMAPPERS order)
//      0 aces (Narkowicz fit)  1 agx-style log sigmoid  2 Khronos PBR Neutral
//      3 reinhard (luminance, white 6)  4 filmic (Hable curve)  5 linear
//
//  BINDINGS  (group 0)
//      0 tIn ... input texture (HDR for tonemap, LDR for FXAA)
//      1 sIn ... linear clamp sampler
//      2 P ..... Post uniform
// ============================================================================

struct Post {
  a: vec4f,   // x exposure multiplier, y tonemap id, z raw (debug view: no tonemap), w dither
  b: vec4f,   // x compare divider x in 0..1 (< 0 = none), y fxaa subpixel, z 1/width, w 1/height
}

@group(0) @binding(0) var tIn: texture_2d<f32>;
@group(0) @binding(1) var sIn: sampler;
@group(0) @binding(2) var<uniform> P: Post;

struct FsOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs_full(@builtin(vertex_index) i: u32) -> FsOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: FsOut;
  o.clip = vec4f((p * 2.0) - vec2f(1.0), 0.0, 1.0);
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}

fn lum(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }

fn tm_aces(x: vec3f) -> vec3f {
  let v = x * 0.6;
  return clamp((v * ((2.51 * v) + vec3f(0.03))) / ((v * ((2.43 * v) + vec3f(0.59))) + vec3f(0.14)), vec3f(0.0), vec3f(1.0));
}

/** AgX-style: pull the primaries in toward the white axis, encode log2 over
 *  a fixed exposure window, apply a smooth S-curve, then push the primaries
 *  back out by a smaller amount. */
fn tm_agx(x: vec3f) -> vec3f {
  let l = lum(x);
  let inset = mix(vec3f(l), x, 0.86);
  let lo = -10.0;
  let hi = 6.5;
  let e = clamp((log2(max(inset, vec3f(1e-10))) - vec3f(lo)) / (hi - lo), vec3f(0.0), vec3f(1.0));
  // S-curve: a logistic in the log domain, renormalized to 0..1
  let k = 7.5;
  // mid puts scene grey 0.18 (log position 0.456) at display 0.46, which
  // the 2.2 decode below returns as about 0.18 again
  let mid = 0.47;
  let s = vec3f(1.0) / (vec3f(1.0) + exp(-k * (e - vec3f(mid))));
  let s0 = 1.0 / (1.0 + exp(k * mid));
  let s1 = 1.0 / (1.0 + exp(-k * (1.0 - mid)));
  let y = (s - vec3f(s0)) / (s1 - s0);
  let ly = lum(y);
  let outset = mix(vec3f(ly), y, 1.08);
  // the curve output is display-referred with a 2.2-like encode; return linear
  return pow(clamp(outset, vec3f(0.0), vec3f(1.0)), vec3f(2.2));
}

/** Khronos PBR Neutral, written from the published formula. */
fn tm_neutral(c0: vec3f) -> vec3f {
  let start = 0.8 - 0.04;
  let desat = 0.15;
  let x = min(c0.r, min(c0.g, c0.b));
  let offset = select(0.04, x - (6.25 * x * x), x < 0.08);
  var c = c0 - vec3f(offset);
  let peak = max(c.r, max(c.g, c.b));
  if (peak < start) { return c; }
  let d = 1.0 - start;
  let newPeak = 1.0 - ((d * d) / ((peak + d) - start));
  c = c * (newPeak / peak);
  let g = 1.0 - (1.0 / ((desat * (peak - newPeak)) + 1.0));
  return mix(c, vec3f(newPeak), g);
}

fn tm_reinhard(c: vec3f) -> vec3f {
  let l = lum(c);
  let w2 = 36.0;
  let ln = (l * (1.0 + (l / w2))) / (1.0 + l);
  return c * (ln / max(l, 1e-6));
}

fn hable(x: vec3f) -> vec3f {
  let A = 0.15; let B = 0.50; let C = 0.10; let D = 0.20; let E = 0.02; let Fh = 0.30;
  return (((x * ((A * x) + vec3f(C * B))) + vec3f(D * E)) / ((x * ((A * x) + vec3f(B))) + vec3f(D * Fh))) - vec3f(E / Fh);
}
fn tm_filmic(c: vec3f) -> vec3f {
  let w = hable(vec3f(11.2));
  return hable(c * 2.0) / w;
}

fn srgb_encode(c: vec3f) -> vec3f {
  let x = clamp(c, vec3f(0.0), vec3f(1.0));
  let lo = x * 12.92;
  let hi = (1.055 * pow(x, vec3f(1.0 / 2.4))) - vec3f(0.055);
  return select(hi, lo, x <= vec3f(0.0031308));
}

/** Interleaved gradient noise, -0.5..0.5. */
fn ign(p: vec2f) -> f32 {
  return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))) - 0.5;
}

@fragment
fn fs_tonemap(v: FsOut) -> @location(0) vec4f {
  let px = vec2i(v.clip.xy);
  var c = max(textureLoad(tIn, px, 0).rgb, vec3f(0.0));
  if (P.a.z < 0.5) {
    c = c * P.a.x;
    let id = i32(P.a.y + 0.5);
    switch id {
      case 0: { c = tm_aces(c); }
      case 1: { c = tm_agx(c); }
      case 2: { c = tm_neutral(c); }
      case 3: { c = tm_reinhard(c); }
      case 4: { c = tm_filmic(c); }
      default: { c = clamp(c, vec3f(0.0), vec3f(1.0)); }
    }
  }
  var o = srgb_encode(c);
  o += vec3f(ign(v.clip.xy) * P.a.w / 255.0);
  if (P.b.x >= 0.0) {
    let dx = abs(v.clip.x - (P.b.x / P.b.z));
    if (dx < 1.0) { o = vec3f(1.0, 0.78, 0.2); }
  }
  return vec4f(o, 1.0);
}

/** Edge-directed AA: find the local edge from luma gradients, then blend two
 *  taps along it, and fall back to the center when the taps leave the range
 *  of the neighbors. */
@fragment
fn fs_fxaa(v: FsOut) -> @location(0) vec4f {
  let px = vec2i(v.clip.xy);
  let dims = vec2i(textureDimensions(tIn));
  let rc = P.b.zw;
  let uv = (vec2f(px) + vec2f(0.5)) * rc;
  let cM = textureLoad(tIn, px, 0).rgb;
  let lM = lum(cM);
  let lN = lum(textureLoad(tIn, clamp(px + vec2i(0, -1), vec2i(0), dims - vec2i(1)), 0).rgb);
  let lS = lum(textureLoad(tIn, clamp(px + vec2i(0, 1), vec2i(0), dims - vec2i(1)), 0).rgb);
  let lW = lum(textureLoad(tIn, clamp(px + vec2i(-1, 0), vec2i(0), dims - vec2i(1)), 0).rgb);
  let lE = lum(textureLoad(tIn, clamp(px + vec2i(1, 0), vec2i(0), dims - vec2i(1)), 0).rgb);
  let lNW = lum(textureLoad(tIn, clamp(px + vec2i(-1, -1), vec2i(0), dims - vec2i(1)), 0).rgb);
  let lNE = lum(textureLoad(tIn, clamp(px + vec2i(1, -1), vec2i(0), dims - vec2i(1)), 0).rgb);
  let lSW = lum(textureLoad(tIn, clamp(px + vec2i(-1, 1), vec2i(0), dims - vec2i(1)), 0).rgb);
  let lSE = lum(textureLoad(tIn, clamp(px + vec2i(1, 1), vec2i(0), dims - vec2i(1)), 0).rgb);
  let lo = min(lM, min(min(lN, lS), min(lW, lE)));
  let hi = max(lM, max(max(lN, lS), max(lW, lE)));
  let range = hi - lo;
  if (range < max(0.0312, hi * 0.125)) { return vec4f(cM, 1.0); }
  var dir = vec2f(
    -((lNW + lNE) - (lSW + lSE)),
    ((lNW + lSW) - (lNE + lSE)));
  let reduce = max((lNW + lNE + lSW + lSE) * (0.25 * 0.125), 1.0 / 128.0);
  let rcpMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
  dir = clamp(dir * rcpMin, vec2f(-8.0), vec2f(8.0)) * rc;
  let a = 0.5 * (textureSampleLevel(tIn, sIn, uv + (dir * (1.0 / 3.0 - 0.5)), 0.0).rgb
               + textureSampleLevel(tIn, sIn, uv + (dir * (2.0 / 3.0 - 0.5)), 0.0).rgb);
  let b = (a * 0.5) + (0.25 * (textureSampleLevel(tIn, sIn, uv + (dir * -0.5), 0.0).rgb
                             + textureSampleLevel(tIn, sIn, uv + (dir * 0.5), 0.0).rgb));
  let lB = lum(b);
  let outC = select(b, a, (lB < lo) || (lB > hi));
  // subpixel blend toward the 3x3 average for single-pixel features
  let avg = (lN + lS + lW + lE) * 0.25;
  let sub = clamp(abs(avg - lM) / range, 0.0, 1.0);
  let sw = (sub * sub) * P.b.y;
  return vec4f(mix(outC, (outC + cM) * 0.5, sw * 0.5), 1.0);
}
