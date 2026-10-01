// ============================================================================
//  MATERIAL STUDIO  ·  shaders/viewport-lut.wgsl — BRDF LUT and map blit
// ────────────────────────────────────────────────────────────────────────────
//  Stand-alone module. viewport.js renders fs_lut once at init into a
//  128 x 128 rgba16float texture; fs_blit copies a baked map into a
//  viewport-owned texture (compare mode snapshots).
//
//  LUT LAYOUT  (x = n.v, y = perceptual roughness, texel centers)
//      r = A, g = B : split-sum scale and bias, F0 * A + B
//      b = E        : directional albedo of the Charlie sheen lobe
//      a = 1
//
//  ENTRY POINTS
//      vs_full ... full-screen triangle (uv origin top-left)
//      fs_lut .... GGX importance sampling, Hammersley points, 512 samples;
//                  uniform hemisphere sampling for the sheen lobe
//      fs_blit ... bilinear copy of tSrc (group 0: 0 tSrc, 1 sSrc)
// ============================================================================

const PI: f32 = 3.14159265359;
const LUT_SAMPLES: u32 = 512u;

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

fn hammersley(i: u32, n: u32) -> vec2f {
  return vec2f(f32(i) / f32(n), f32(reverseBits(i)) * 2.3283064365386963e-10);
}

fn v_smith(nv: f32, nl: f32, a: f32) -> f32 {
  let a2 = a * a;
  let gv = nl * sqrt((nv * nv * (1.0 - a2)) + a2);
  let gl = nv * sqrt((nl * nl * (1.0 - a2)) + a2);
  return 0.5 / max(gv + gl, 1e-7);
}

fn d_charlie(nh: f32, r: f32) -> f32 {
  let inv = 1.0 / max(r * r, 1e-3);
  let s2 = max(1.0 - (nh * nh), 1e-5);
  return (2.0 + inv) * pow(s2, inv * 0.5) / (2.0 * PI);
}

@fragment
fn fs_lut(v: FsOut) -> @location(0) vec4f {
  let nv = max(v.uv.x, 1e-3);
  let pr = max(v.uv.y, 0.02);
  let a = pr * pr;
  let V = vec3f(sqrt(1.0 - (nv * nv)), 0.0, nv);
  var A = 0.0;
  var B = 0.0;
  var E = 0.0;
  for (var i = 0u; i < LUT_SAMPLES; i++) {
    let xi = hammersley(i, LUT_SAMPLES);
    // GGX half vector
    let phi = 2.0 * PI * xi.x;
    let ct = sqrt((1.0 - xi.y) / (1.0 + (((a * a) - 1.0) * xi.y)));
    let st = sqrt(1.0 - (ct * ct));
    let H = vec3f(st * cos(phi), st * sin(phi), ct);
    let L = (2.0 * dot(V, H) * H) - V;
    let nl = L.z;
    let nh = max(H.z, 0.0);
    let vh = max(dot(V, H), 0.0);
    if (nl > 0.0) {
      let g = (v_smith(nv, nl, a) * 4.0 * nl * vh) / max(nh, 1e-6);
      let fc = pow(1.0 - vh, 5.0);
      A += (1.0 - fc) * g;
      B += fc * g;
    }
    // sheen: uniform hemisphere direction for L
    let z = xi.y;
    let r = sqrt(max(0.0, 1.0 - (z * z)));
    let Ls = vec3f(r * cos(phi), r * sin(phi), z);
    let Hs = normalize(Ls + V);
    let vis = 1.0 / max(4.0 * ((Ls.z + nv) - (Ls.z * nv)), 1e-4);
    E += d_charlie(Hs.z, pr) * vis * Ls.z * (2.0 * PI);
  }
  let n = f32(LUT_SAMPLES);
  return vec4f(A / n, B / n, clamp(E / n, 0.0, 1.0), 1.0);
}

@group(0) @binding(0) var tSrc: texture_2d<f32>;
@group(0) @binding(1) var sSrc: sampler;

@fragment
fn fs_blit(v: FsOut) -> @location(0) vec4f {
  return textureSampleLevel(tSrc, sSrc, v.uv, 0.0);
}
