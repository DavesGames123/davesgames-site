// jfa.wgsl — stage 2 of the bake: shape field to signed distance field.
//
// The upstream VolumeToSDF kernel does a brute-force search in a sphere of
// fixed radius around each voxel. This port uses a 3D jump flood instead,
// which gives the same nearest-surface answer in log2(N) + 1 passes and has no
// search radius cap.
//
//   init     every voxel next to a sign change becomes a seed. The seed is the
//            sub-voxel zero crossing, found by linear interpolation of f.
//   jump     each voxel reads 26 neighbours at distance k and keeps the
//            nearest seed. engine.js runs k = N/2 .. 1, then k = 1 again.
//   resolve  distance to the kept seed, signed by f, clamped, in world units.
//
// seedIn / seedOut hold vec4f(seed xyz in voxel space, valid flag).

@group(0) @binding(1) var fieldIn : texture_3d<f32>;
@group(0) @binding(2) var seedIn  : texture_3d<f32>;
@group(0) @binding(3) var seedOut : texture_storage_3d<rgba32float, write>;
@group(0) @binding(4) var<uniform> J : vec4f;   // x = jump distance k
@group(0) @binding(5) var sdfOut  : texture_storage_3d<rgba16float, write>;

fn inVol(p: vec3i) -> bool {
  let res = vec3i(P.volRes.xyz);
  return all(p >= vec3i(0)) && all(p < res);
}

@compute @workgroup_size(4, 4, 4)
fn init(@builtin(global_invocation_id) id: vec3u) {
  let p = vec3i(id);
  if (!inVol(p)) { return; }
  let f0 = textureLoad(fieldIn, p, 0).r;
  var best = vec4f(0.0);
  var bt = 2.0;
  let dirs = array<vec3i, 6>(vec3i(1, 0, 0), vec3i(-1, 0, 0), vec3i(0, 1, 0),
                             vec3i(0, -1, 0), vec3i(0, 0, 1), vec3i(0, 0, -1));
  for (var i = 0; i < 6; i++) {
    let n = p + dirs[i];
    if (!inVol(n)) { continue; }
    let f1 = textureLoad(fieldIn, n, 0).r;
    if ((f0 > 0.0) != (f1 > 0.0)) {
      let t = clamp(f0 / (f0 - f1), 0.0, 1.0);
      if (t < bt) {
        bt = t;
        best = vec4f(vec3f(p) + vec3f(dirs[i]) * t, 1.0);
      }
    }
  }
  textureStore(seedOut, p, best);
}

@compute @workgroup_size(4, 4, 4)
fn jump(@builtin(global_invocation_id) id: vec3u) {
  let p = vec3i(id);
  if (!inVol(p)) { return; }
  let k = i32(J.x);
  let fp = vec3f(p);
  var best = textureLoad(seedIn, p, 0);
  var bd = 1e18;
  if (best.w > 0.5) { let v = best.xyz - fp; bd = dot(v, v); }
  for (var z = -1; z <= 1; z++) {
    for (var y = -1; y <= 1; y++) {
      for (var x = -1; x <= 1; x++) {
        if (x == 0 && y == 0 && z == 0) { continue; }
        let n = p + vec3i(x, y, z) * k;
        if (!inVol(n)) { continue; }
        let s = textureLoad(seedIn, n, 0);
        if (s.w > 0.5) {
          let v = s.xyz - fp;
          let d = dot(v, v);
          if (d < bd) { bd = d; best = s; }
        }
      }
    }
  }
  textureStore(seedOut, p, best);
}

@compute @workgroup_size(4, 4, 4)
fn resolve(@builtin(global_invocation_id) id: vec3u) {
  let p = vec3i(id);
  if (!inVol(p)) { return; }
  let f0 = textureLoad(fieldIn, p, 0).r;
  let s = textureLoad(seedIn, p, 0);
  let clampW = P.boxMax.w;
  var d = clampW;
  if (s.w > 0.5) { d = min(distance(s.xyz, vec3f(p)) * P.boxMin.w, clampW); }
  let sd = select(d, -d, f0 > 0.0);
  textureStore(sdfOut, p, vec4f(sd, clamp(f0, -4.0, 4.0), 0.0, 0.0));
}
