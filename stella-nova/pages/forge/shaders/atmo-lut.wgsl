// ============================================================================
//  PLANET FORGE  ·  atmo-lut.wgsl — the two atmosphere LUT passes
//  (atmo-common.wgsl is prepended by atmo.js).
//    csTrans  256 x 64: T(r, mu) = exp(-integral of extinction to the top)
//    csMulti  32 x 32, one workgroup of 64 directions per texel:
//             Psi_ms(mu_s, h) = L2 / (1 - f_ms) (Hillaire 2020, sec. 5.5)
// ============================================================================

@group(0) @binding(0) var<uniform> A: Atmo;
@group(0) @binding(1) var outTrans: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var transTex: texture_2d<f32>;
@group(0) @binding(3) var lutSamp: sampler;
@group(0) @binding(4) var outMulti: texture_storage_2d<rgba16float, write>;

fn opticalDepth(ro: vec3f, rd: vec3f, tMax: f32, n: i32) -> vec3f {
  let dt = tMax / f32(n);
  var tau = vec3f(0.0);
  for (var i = 0; i < n; i++) {
    let x = ro + rd * ((f32(i) + 0.5) * dt);
    tau += medium(A, length(x) - A.radii.x).ext * dt;
  }
  return tau;
}

@compute @workgroup_size(8, 8)
fn csTrans(@builtin(global_invocation_id) id: vec3u) {
  let sz = textureDimensions(outTrans);
  if (id.x >= sz.x || id.y >= sz.y) { return; }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(sz);
  let rm = uvTrans(A, uv);
  let ro = vec3f(0.0, rm.x, 0.0);
  let rd = vec3f(sqrt(max(0.0, 1.0 - rm.y * rm.y)), rm.y, 0.0);
  let t = raySphere(ro, rd, A.radii.y).y;
  let tau = opticalDepth(ro, rd, max(t, 0.0), 40);
  textureStore(outTrans, id.xy, vec4f(exp(-tau), 1.0));
}

fn sunT(r: f32, mu: f32) -> vec3f {
  return textureSampleLevel(transTex, lutSamp, transUV(A, r, mu), 0.0).rgb;
}

var<workgroup> shL: array<vec3f, 64>;
var<workgroup> shF: array<vec3f, 64>;

@compute @workgroup_size(64)
fn csMulti(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let sz = textureDimensions(outMulti);
  let uv = (vec2f(wg.xy) + 0.5) / vec2f(sz);
  let muS = uv.x * 2.0 - 1.0;
  let r = A.radii.x + uv.y * (A.radii.y - A.radii.x) + 0.01;
  let ro = vec3f(0.0, r, 0.0);
  let sun = vec3f(sqrt(max(0.0, 1.0 - muS * muS)), muS, 0.0);
  // the li-th of 64 directions on a Fibonacci sphere
  let fi = f32(li) + 0.5;
  let z = 1.0 - 2.0 * fi / 64.0;
  let a = fi * 2.39996323;
  let rs = sqrt(max(0.0, 1.0 - z * z));
  let rd = vec3f(rs * cos(a), z, rs * sin(a));
  let tTop = raySphere(ro, rd, A.radii.y).y;
  let tGnd = raySphere(ro, rd, A.radii.x);
  let hitG = tGnd.x > 0.0;
  let tMax = select(tTop, tGnd.x, hitG);
  let n = 20;
  let dt = tMax / f32(n);
  var T = vec3f(1.0);
  var L = vec3f(0.0);
  var F = vec3f(0.0);
  for (var i = 0; i < n; i++) {
    let x = ro + rd * ((f32(i) + 0.5) * dt);
    let rx = length(x);
    let m = medium(A, rx - A.radii.x);
    let mu = dot(x / rx, sun);
    let shadow = select(1.0, 0.0, raySphere(x, sun, A.radii.x).x > 0.0);
    let S = sunT(rx, mu) * shadow * (m.sR + m.sM) / (4.0 * PI);
    let ext = max(m.ext, vec3f(1e-7));
    let Ts = exp(-ext * dt);
    L += T * (S - S * Ts) / ext;
    let ms = m.sR + m.sM;
    F += T * (ms - ms * Ts) / ext;
    T *= Ts;
  }
  if (hitG) {
    let xg = ro + rd * tMax;
    let up = normalize(xg);
    let mu = dot(up, sun);
    L += T * sunT(A.radii.x, mu) * max(mu, 0.0) * A.ground.xyz / PI;
  }
  shL[li] = L / 64.0;
  shF[li] = F / 64.0;
  workgroupBarrier();
  var s = 32u;
  loop {
    if (s == 0u) { break; }
    if (li < s) { shL[li] += shL[li + s]; shF[li] += shF[li + s]; }
    workgroupBarrier();
    s = s / 2u;
  }
  if (li == 0u) {
    let psi = shL[0] / max(vec3f(1.0) - shF[0], vec3f(1e-3));
    textureStore(outMulti, wg.xy, vec4f(psi, 1.0));
  }
}
