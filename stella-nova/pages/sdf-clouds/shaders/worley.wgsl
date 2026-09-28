// worley.wgsl — erosion noise bake.
//
// Writes a tiling 3D billow texture (inverted Worley F1, three octaves). The
// view march and the light bake sample it with a repeat sampler to cut detail
// into the cloud edges. P.misc2.y sets the cell count of the base octave; the
// next octaves double it, so every octave tiles on the same period.

@group(0) @binding(1) var eroOut : texture_storage_3d<rgba16float, write>;

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let res = textureDimensions(eroOut);
  if (any(id >= res)) { return; }
  let q = (vec3f(id) + 0.5) / vec3f(res);
  let c = max(i32(P.misc2.y), 1);
  let w1 = 1.0 - clamp(worley(q * f32(c), c, 11u), 0.0, 1.0);
  let w2 = 1.0 - clamp(worley(q * f32(c * 2), c * 2, 23u), 0.0, 1.0);
  let w3 = 1.0 - clamp(worley(q * f32(c * 4), c * 4, 37u), 0.0, 1.0);
  let n = w1 * 0.625 + w2 * 0.25 + w3 * 0.125;
  textureStore(eroOut, id, vec4f(n, w1, w2, w3));
}
