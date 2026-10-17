// ============================================================================
//  DLA TERRAIN  ·  gpu/terrain.wgsl — snapshot blend, normals and AO (CORE)
// ----------------------------------------------------------------------------
//  Not joined with common.wgsl: it writes the textures that common.wgsl
//  reads. gpu/terrain-gpu.js runs it.
//    blend    the new snapshot (a storage buffer of nSrc x nSrc, any size)
//             is resampled bilinear onto the nDst x nDst textures and mixed
//             with the copy of the old state: height and aux. P.t eases 0..1
//             over about 0.6 s, so the 3D view shows the terrain form.
//    normals  central differences on the blended height, and a horizon
//             ambient occlusion: 8 directions x 6 radii (2..64 texels),
//             the mean sine of the highest elevation angle.
//  grep -n targets: "fn blend", "fn normals", "fn horizonAO"
// ============================================================================

struct Prep {
  nDst: f32, nSrc: f32, t: f32, texel: f32,     // texel m of the dst grid
  hasAux: f32, aoScale: f32, pad0: f32, pad1: f32,
};
@group(0) @binding(0) var<uniform> P: Prep;
@group(0) @binding(1) var<storage, read> srcH: array<f32>;
@group(0) @binding(2) var<storage, read> srcA: array<vec4f>;
@group(0) @binding(3) var prevH: texture_2d<f32>;
@group(0) @binding(4) var prevA: texture_2d<f32>;
@group(0) @binding(5) var outH: texture_storage_2d<r32float, write>;
@group(0) @binding(6) var outA: texture_storage_2d<rgba16float, write>;

fn srcIdx(i: i32, j: i32) -> u32 {
  let n = i32(P.nSrc);
  return u32(clamp(j, 0, n - 1) * n + clamp(i, 0, n - 1));
}
fn sampleSrc(uv: vec2f) -> vec2f { // returns (height, -)
  let p = uv * P.nSrc - vec2f(0.5);
  let i = vec2i(floor(p));
  let f = p - floor(p);
  let a = srcH[srcIdx(i.x, i.y)];
  let b = srcH[srcIdx(i.x + 1, i.y)];
  let c = srcH[srcIdx(i.x, i.y + 1)];
  let d = srcH[srcIdx(i.x + 1, i.y + 1)];
  return vec2f(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), 0.0);
}
fn sampleSrcA(uv: vec2f) -> vec4f {
  let p = uv * P.nSrc - vec2f(0.5);
  let i = vec2i(floor(p));
  let f = p - floor(p);
  let a = srcA[srcIdx(i.x, i.y)];
  let b = srcA[srcIdx(i.x + 1, i.y)];
  let c = srcA[srcIdx(i.x, i.y + 1)];
  let d = srcA[srcIdx(i.x + 1, i.y + 1)];
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

@compute @workgroup_size(8, 8)
fn blend(@builtin(global_invocation_id) id: vec3u) {
  let n = u32(P.nDst);
  if (id.x >= n || id.y >= n) { return; }
  let uv = (vec2f(id.xy) + vec2f(0.5)) / P.nDst;
  let t = P.t * P.t * (3.0 - 2.0 * P.t);
  let h0 = textureLoad(prevH, vec2i(id.xy), 0).r;
  let h1 = sampleSrc(uv).x;
  textureStore(outH, vec2i(id.xy), vec4f(mix(h0, h1, t), 0.0, 0.0, 1.0));
  let a0 = textureLoad(prevA, vec2i(id.xy), 0);
  var a1 = a0;
  if (P.hasAux > 0.5) { a1 = sampleSrcA(uv); }
  textureStore(outA, vec2i(id.xy), mix(a0, a1, t));
}

// ── normals and AO: a second bind group ──
@group(1) @binding(0) var inH: texture_2d<f32>;
@group(1) @binding(1) var outN: texture_storage_2d<rgba16float, write>;

fn hAt(p: vec2i) -> f32 {
  let n = i32(P.nDst);
  return textureLoad(inH, clamp(p, vec2i(0), vec2i(n - 1)), 0).r;
}
fn horizonAO(p: vec2i, h: f32) -> f32 {
  var occ = 0.0;
  for (var d = 0; d < 8; d++) {
    let a = f32(d) * 0.785398 + 0.39;
    let dir = vec2f(cos(a), sin(a));
    var best = 0.0;
    var r = 2.0;
    for (var k = 0; k < 6; k++) {
      let q = p + vec2i(round(dir * r));
      let dh = hAt(q) - h;
      let dist = r * P.texel;
      best = max(best, dh / sqrt(dh * dh + dist * dist));
      r = r * 2.0;
    }
    occ += best;
  }
  return clamp(1.0 - (occ / 8.0) * P.aoScale, 0.0, 1.0);
}

@compute @workgroup_size(8, 8)
fn normals(@builtin(global_invocation_id) id: vec3u) {
  let n = u32(P.nDst);
  if (id.x >= n || id.y >= n) { return; }
  let p = vec2i(id.xy);
  let hl = hAt(p - vec2i(1, 0));
  let hr = hAt(p + vec2i(1, 0));
  let hd = hAt(p - vec2i(0, 1));
  let hu = hAt(p + vec2i(0, 1));
  let s = 2.0 * P.texel;
  let nrm = normalize(vec3f(-(hr - hl) / s, 1.0, -(hu - hd) / s));
  let ao = horizonAO(p, hAt(p));
  textureStore(outN, p, vec4f(nrm, ao));
}
