// ============================================================================
//  MATERIAL STUDIO  ·  shaders/env-filter.wgsl — IBL precompute passes
// ────────────────────────────────────────────────────────────────────────────
//  All the passes that turn one equirect into split-sum IBL data. Needs
//  env-common.wgsl in front. Each entry point uses its own binding numbers
//  in group 0, so env.js builds each pipeline with layout 'auto'.
//
//  CONTENTS  (grep -n the name to jump)
//      fs_resample ....... any-size upload (rgba32float or 8-bit) -> 2048x1024
//      fs_down ........... 2x2 box mip of the equirect (energy-preserving)
//      fs_prefilter ...... GGX importance-sampled specular, one mip per roughness
//      fs_brdf ........... split-sum BRDF LUT, rg = (scale, bias)
//      cs_sh ............. SH9 projection, cosine-lobe convolved, divided by pi
//      fs_tone ........... tone-mapped 8-bit thumbnail of one source mip
//
//  BINDINGS (group 0)
//      0 RU uniform, 1 upload texture ............... fs_resample
//      2 source mip level ............................ fs_down
//      3 FU uniform, 4 source with mips, 5 sampler ... fs_prefilter
//      6 source mip level, 7 SH storage buffer ....... cs_sh
//      8 source mip level, 9 TU uniform .............. fs_tone
// ============================================================================

// ── resample ────────────────────────────────────────────────────────────────
struct RU {
  size: vec2f,      // target size
  srgb: u32,        // 1: the upload is 8-bit sRGB, decode to linear
  pad: u32,
  gain: f32,        // multiplier after decode
  maxVal: f32,      // clamp, keeps rgba16float finite
  p2: f32,
  p3: f32,
};
@group(0) @binding(0) var<uniform> ru: RU;
@group(0) @binding(1) var upTex: texture_2d<f32>;

fn upLoad(ix: i32, iy: i32, dim: vec2i) -> vec3f {
  let x = ((ix % dim.x) + dim.x) % dim.x;
  let y = clamp(iy, 0, dim.y - 1);
  return textureLoad(upTex, vec2i(x, y), 0).rgb;
}

@fragment
fn fs_resample(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let dim = vec2i(textureDimensions(upTex));
  let uv = pos.xy / ru.size;
  let p = (uv * vec2f(dim)) - 0.5;
  let i = vec2i(floor(p));
  let f = fract(p);
  let a = upLoad(i.x, i.y, dim);
  let b = upLoad(i.x + 1, i.y, dim);
  let c = upLoad(i.x, i.y + 1, dim);
  let d = upLoad(i.x + 1, i.y + 1, dim);
  var col = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  if (ru.srgb == 1u) {
    let lo = col / 12.92;
    let hi = pow((col + 0.055) / 1.055, vec3f(2.4));
    col = select(hi, lo, col <= vec3f(0.04045));
  }
  col = clamp(col * ru.gain, vec3f(0.0), vec3f(ru.maxVal));
  return vec4f(col, 1.0);
}

// ── mip down ────────────────────────────────────────────────────────────────
@group(0) @binding(2) var downSrc: texture_2d<f32>;

@fragment
fn fs_down(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let dim = vec2i(textureDimensions(downSrc));
  let o = vec2i(pos.xy) * 2;
  let m = dim - vec2i(1);
  let a = textureLoad(downSrc, min(o, m), 0).rgb;
  let b = textureLoad(downSrc, min(o + vec2i(1, 0), m), 0).rgb;
  let c = textureLoad(downSrc, min(o + vec2i(0, 1), m), 0).rgb;
  let d = textureLoad(downSrc, min(o + vec2i(1, 1), m), 0).rgb;
  return vec4f((a + b + c + d) * 0.25, 1.0);
}

// ── specular prefilter ──────────────────────────────────────────────────────
struct FU {
  size: vec2f,      // target mip size
  rough: f32,       // perceptual roughness of this mip
  texelSA: f32,     // mean solid angle of one source mip-0 texel
  srcMips: f32,     // source mip count
  samples: u32,
  baseLod: f32,     // lod for roughness 0 (target is smaller than the source)
  p3: f32,
};
@group(0) @binding(3) var<uniform> fu: FU;
@group(0) @binding(4) var preSrc: texture_2d<f32>;
@group(0) @binding(5) var preSamp: sampler;

fn hammersley(i: u32, n: u32) -> vec2f {
  return vec2f(f32(i) / f32(n), f32(reverseBits(i)) * 2.3283064365386963e-10);
}

fn ggxH(xi: vec2f, a: f32) -> vec3f {
  let phi = TAU * xi.x;
  let a2 = a * a;
  let ct = sqrt((1.0 - xi.y) / (1.0 + ((a2 - 1.0) * xi.y)));
  let st = sqrt(max(1.0 - (ct * ct), 0.0));
  return vec3f(st * cos(phi), st * sin(phi), ct);
}

fn ggxD(nh: f32, a: f32) -> f32 {
  let a2 = a * a;
  let k = ((nh * nh) * (a2 - 1.0)) + 1.0;
  return a2 / (PI * k * k);
}

@fragment
fn fs_prefilter(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let N = uvToDir(pos.xy / fu.size);
  if (fu.rough < 0.002) {
    return vec4f(textureSampleLevel(preSrc, preSamp, dirToUV(N), fu.baseLod).rgb, 1.0);
  }
  let a = max(fu.rough * fu.rough, 0.002);
  var up = vec3f(0.0, 1.0, 0.0);
  if (abs(N.y) > 0.999) { up = vec3f(1.0, 0.0, 0.0); }
  let T = normalize(cross(up, N));
  let B = cross(N, T);
  var sum = vec3f(0.0);
  var wsum = 0.0;
  let n = fu.samples;
  // A per-texel rotation of the sequence turns banding into fine noise.
  let rot = hash2(floor(pos.xy));
  for (var i = 0u; i < n; i++) {
    var xi = hammersley(i, n);
    xi.x = fract(xi.x + rot);
    let h = ggxH(xi, a);
    let H = normalize((T * h.x) + (B * h.y) + (N * h.z));
    let vh = dot(N, H);
    let L = (2.0 * vh * H) - N;
    let nl = dot(N, L);
    if (nl > 0.0) {
      let pdf = ggxD(h.z, a) * 0.25;
      let sa = 1.0 / (f32(n) * pdf + 1e-6);
      let lod = clamp((0.5 * log2(sa / fu.texelSA)) + 1.0, fu.baseLod, fu.srcMips - 1.0);
      sum += textureSampleLevel(preSrc, preSamp, dirToUV(L), lod).rgb * nl;
      wsum += nl;
    }
  }
  return vec4f(sum / max(wsum, 1e-6), 1.0);
}

// ── BRDF LUT ────────────────────────────────────────────────────────────────
// x = N.V, y = perceptual roughness. Smith-GGX visibility (k = a/2), 512 samples.
@fragment
fn fs_brdf(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let nv = max(pos.x / 256.0, 1e-3);
  let r = pos.y / 256.0;
  let a = max(r * r, 1e-3);
  let V = vec3f(sqrt(1.0 - (nv * nv)), 0.0, nv);
  let k = a * 0.5;
  var A = 0.0;
  var Bv = 0.0;
  let n = 512u;
  for (var i = 0u; i < n; i++) {
    let H = ggxH(hammersley(i, n), a);
    let L = (2.0 * dot(V, H) * H) - V;
    let nl = max(L.z, 0.0);
    let nh = max(H.z, 0.0);
    let vh = max(dot(V, H), 0.0);
    if (nl > 0.0) {
      let gv = nv / ((nv * (1.0 - k)) + k);
      let gl = nl / ((nl * (1.0 - k)) + k);
      let gvis = (gv * gl * vh) / max(nh * nv, 1e-6);
      let fc = pow(1.0 - vh, 5.0);
      A += (1.0 - fc) * gvis;
      Bv += fc * gvis;
    }
  }
  return vec4f(A / f32(n), Bv / f32(n), 0.0, 1.0);
}

// ── SH9 ─────────────────────────────────────────────────────────────────────
// Out: 9 vec4f, coefficient k already times the cosine-lobe factor A_k / pi.
// Then sum_k out[k] * Y_k(n) is irradiance / pi, which multiplies albedo.
@group(0) @binding(6) var shSrc: texture_2d<f32>;
@group(0) @binding(7) var<storage, read_write> shOut: array<vec4f, 9>;

var<workgroup> shAcc: array<array<vec3f, 9>, 64>;

fn shBasis(d: vec3f) -> array<f32, 9> {
  return array<f32, 9>(
    0.282095,
    0.488603 * d.y, 0.488603 * d.z, 0.488603 * d.x,
    1.092548 * d.x * d.y, 1.092548 * d.y * d.z,
    0.315392 * ((3.0 * d.z * d.z) - 1.0),
    1.092548 * d.x * d.z, 0.546274 * ((d.x * d.x) - (d.y * d.y)));
}

@compute @workgroup_size(64)
fn cs_sh(@builtin(local_invocation_index) li: u32) {
  let dim = textureDimensions(shSrc);
  let count = dim.x * dim.y;
  var s: array<vec3f, 9>;
  for (var k = 0u; k < 9u; k++) { s[k] = vec3f(0.0); }
  let dPhi = TAU / f32(dim.x);
  let dTh = PI / f32(dim.y);
  for (var i = li; i < count; i += 64u) {
    let x = i % dim.x;
    let y = i / dim.x;
    let uv = (vec2f(f32(x), f32(y)) + 0.5) / vec2f(dim);
    let d = uvToDir(uv);
    let lat = (0.5 - uv.y) * PI;
    let c = textureLoad(shSrc, vec2i(i32(x), i32(y)), 0).rgb * (cos(lat) * dPhi * dTh);
    var Y = shBasis(d);
    for (var k = 0u; k < 9u; k++) { s[k] += c * Y[k]; }
  }
  for (var k = 0u; k < 9u; k++) { shAcc[li][k] = s[k]; }
  workgroupBarrier();
  for (var stride = 32u; stride > 0u; stride = stride >> 1u) {
    if (li < stride) {
      for (var k = 0u; k < 9u; k++) { shAcc[li][k] += shAcc[li + stride][k]; }
    }
    workgroupBarrier();
  }
  if (li == 0u) {
    var band = array<f32, 9>(1.0, 0.6666667, 0.6666667, 0.6666667, 0.25, 0.25, 0.25, 0.25, 0.25);
    for (var k = 0u; k < 9u; k++) { shOut[k] = vec4f(shAcc[0][k] * band[k], 0.0); }
  }
}

// ── tone (thumbnail of the live source) ─────────────────────────────────────
// Reads one mip level (256x128) of the source equirect, writes 8-bit sRGB.
struct TU {
  exposure: f32,
  p0: f32,
  p1: f32,
  p2: f32,
};
@group(0) @binding(8) var toneSrc: texture_2d<f32>;
@group(0) @binding(9) var<uniform> tu: TU;

@fragment
fn fs_tone(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let c = textureLoad(toneSrc, vec2i(pos.xy), 0).rgb;
  return vec4f(thumbTone(c * tu.exposure), 1.0);
}
