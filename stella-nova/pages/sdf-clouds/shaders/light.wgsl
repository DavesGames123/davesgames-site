// light.wgsl — stage 3 of the bake: the transmittance volume.
//
// One secondary ray per voxel of the light map, toward the sun
// (TransmittanceMap3D.compute). The view march then reads T_light from this
// volume instead of a nested march per sample, so a pixel costs O(N) and not
// O(N * M). The bake reruns only when the sun, the shape or the density
// changes, or every frame when erosion moves and light erosion is on.
//
//   r  T_light = exp(-tau) * AO term
//   g  tau (optical depth to the sun)
//   b  AO term alone
//
// AO follows calculateAO: mean normalised density in the 26 neighbours at
// P.shape3.z, then map = 1 - saturate(mean * intensity)^2.

@group(0) @binding(7) var lightOut : texture_storage_3d<rgba16float, write>;

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let res = vec3u(P.litRes.xyz);
  if (any(id >= res)) { return; }
  let q = (vec3f(id) + 0.5) / vec3f(res);
  let w = mix(P.boxMin.xyz, P.boxMax.xyz, q);
  let erode = P.misc.x > 0.5;
  let tau = lightDepth(w, i32(P.misc2.w), erode).x;
  var ao = 1.0;
  if (P.litRes.w > 0.5) {
    var sum = 0.0;
    for (var z = -1; z <= 1; z++) {
      for (var y = -1; y <= 1; y++) {
        for (var x = -1; x <= 1; x++) {
          if (x == 0 && y == 0 && z == 0) { continue; }
          let p = w + vec3f(f32(x), f32(y), f32(z)) * P.shape3.z;
          sum += density(p, sdfAt(p), erode).d;
        }
      }
    }
    let mean = sum / (26.0 * max(P.dens.x, 1e-3));
    let occ = clamp(mean * P.shape3.y, 0.0, 1.0);
    ao = 1.0 - occ * occ;
  }
  textureStore(lightOut, id, vec4f(exp(-tau) * ao, tau, ao, 1.0));
}
