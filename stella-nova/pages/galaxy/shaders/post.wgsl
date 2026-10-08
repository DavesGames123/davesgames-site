// post.wgsl — bloom, auto exposure and the tone map (fragment passes).
//
//   down0     stars (full res) + volume (low res) -> bloom level 0 (1/2)
//   down      level i-1 -> level i, a 4-tap box on bilinear taps
//   up        level i+1 -> level i, a tent, added by the blend state
//   expo      1x1: log-average luminance of the smallest level over the
//             pixels that hold the subject, eased toward the last value
//   composite stars + volume + bloom, x exposure, ACES fit, sRGB, dither
//
//   The bloom is a small mix (U.look.y) of the blurred image, not a
//   threshold, so it acts like the wide wings of a real point-spread
//   function and keeps the total light.

struct Post {
  texel: vec4f,   // 1/w, 1/h of the source level; mix; -
  look: vec4f,    // exposure scale, bloom mix, auto key, auto rate
  misc: vec4f,    // frame, -, vignette, bloom levels
}

@group(0) @binding(0) var<uniform> P: Post;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var srcA: texture_2d<f32>;
@group(0) @binding(3) var srcB: texture_2d<f32>;

struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let xy = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return VOut(vec4f(xy * 2.0 - 1.0, 0.0, 1.0), vec2f(xy.x, 1.0 - xy.y));
}

fn box4(t: texture_2d<f32>, uv: vec2f, px: vec2f) -> vec3f {
  return (textureSampleLevel(t, smp, uv + vec2f(-px.x, -px.y), 0.0).rgb
        + textureSampleLevel(t, smp, uv + vec2f(px.x, -px.y), 0.0).rgb
        + textureSampleLevel(t, smp, uv + vec2f(-px.x, px.y), 0.0).rgb
        + textureSampleLevel(t, smp, uv + vec2f(px.x, px.y), 0.0).rgb) * 0.25;
}

// srcA = stars (full res), srcB = volume (low res)
@fragment fn down0(i: VOut) -> @location(0) vec4f {
  let c = box4(srcA, i.uv, P.texel.xy) + textureSampleLevel(srcB, smp, i.uv, 0.0).rgb;
  return vec4f(c, 1.0);
}
@fragment fn down(i: VOut) -> @location(0) vec4f {
  return vec4f(box4(srcA, i.uv, P.texel.xy), 1.0);
}
@fragment fn up(i: VOut) -> @location(0) vec4f {
  let px = P.texel.xy;
  var c = textureSampleLevel(srcA, smp, i.uv, 0.0).rgb * 4.0;
  c += (textureSampleLevel(srcA, smp, i.uv + vec2f(px.x, 0.0), 0.0).rgb + textureSampleLevel(srcA, smp, i.uv - vec2f(px.x, 0.0), 0.0).rgb
      + textureSampleLevel(srcA, smp, i.uv + vec2f(0.0, px.y), 0.0).rgb + textureSampleLevel(srcA, smp, i.uv - vec2f(0.0, px.y), 0.0).rgb) * 2.0;
  c += textureSampleLevel(srcA, smp, i.uv + px, 0.0).rgb + textureSampleLevel(srcA, smp, i.uv - px, 0.0).rgb
     + textureSampleLevel(srcA, smp, i.uv + vec2f(px.x, -px.y), 0.0).rgb + textureSampleLevel(srcA, smp, i.uv + vec2f(-px.x, px.y), 0.0).rgb;
  return vec4f(c / 16.0 * P.texel.z, 1.0);
}

fn lum(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }

// srcA = smallest bloom level, srcB = the last exposure (1x1)
@fragment fn expo(i: VOut) -> @location(0) vec4f {
  var mx = 0.0;
  for (var y = 0; y < 12; y++) {
    for (var x = 0; x < 12; x++) {
      let uv = (vec2f(f32(x), f32(y)) + 0.5) / 12.0;
      mx = max(mx, lum(textureSampleLevel(srcA, smp, uv, 0.0).rgb));
    }
  }
  var s = 0.0;
  var n = 0.0;
  for (var y = 0; y < 12; y++) {
    for (var x = 0; x < 12; x++) {
      let uv = (vec2f(f32(x), f32(y)) + 0.5) / 12.0;
      let l = lum(textureSampleLevel(srcA, smp, uv, 0.0).rgb);
      if (l > mx * 0.02) { s += log(l + 1e-12); n += 1.0; }
    }
  }
  let avg = exp(s / max(n, 1.0));
  // the subject's mean maps to the key; the peak may not go far past white
  var tgt = P.look.z / max(avg, 1e-12);
  tgt = min(tgt, 5.0 / max(mx, 1e-12));
  let last = textureLoad(srcB, vec2i(0, 0), 0).r;
  let e = select(exp(mix(log(max(last, 1e-12)), log(tgt), P.look.w)), tgt, last <= 0.0 || P.look.w >= 1.0);
  return vec4f(e, avg, mx, 1.0);
}

@group(1) @binding(0) var bloomT: texture_2d<f32>;
@group(1) @binding(1) var expoT: texture_2d<f32>;

fn aces(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}
fn toSrgb(c: vec3f) -> vec3f {
  return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308));
}

// srcA = stars, srcB = volume
@fragment fn composite(i: VOut) -> @location(0) vec4f {
  let st = textureSampleLevel(srcA, smp, i.uv, 0.0).rgb;
  let vo = textureSampleLevel(srcB, smp, i.uv, 0.0).rgb;
  let bl = textureSampleLevel(bloomT, smp, i.uv, 0.0).rgb / max(P.misc.w, 1.0);
  var c = mix(st + vo, bl, P.look.y);
  let e = textureLoad(expoT, vec2i(0, 0), 0).r * P.look.x;
  c *= e;
  // a little saturation back after the shoulder
  var m = aces(c);
  let y = lum(m);
  m = max(vec3f(0.0), mix(vec3f(y), m, 1.12));
  let q = i.uv - 0.5;
  m *= 1.0 - dot(q, q) * P.misc.z;
  var o = toSrgb(clamp(m, vec3f(0.0), vec3f(1.0)));
  // triangular dither, one 8-bit step
  let h = fract(sin(dot(i.pos.xy + P.misc.x * 0.618, vec2f(12.9898, 78.233))) * 43758.547);
  let h2 = fract(sin(dot(i.pos.xy + 17.0 + P.misc.x * 0.382, vec2f(39.346, 11.135))) * 24634.634);
  o += (h + h2 - 1.0) / 255.0;
  return vec4f(o, 1.0);
}
