// ============================================================================
//  PLANET COLLISION  ·  shaders/smooth.wgsl — the bilateral depth filter
//  (after common.wgsl)
// ----------------------------------------------------------------------------
//  One axis per dispatch (cs_smoothX, cs_smoothY); render.js runs X, Y
//  two times. A pixel with no fluid stays empty, so the silhouette does
//  not grow or blur: only the bumps of the particle spheres go. The range
//  term exp(-(dz / band)^2) keeps a depth step (a body in front of
//  another, a clump in front of the surface) as a step.
//  The filter radius is the projected size of one particle sphere:
//  U.surf.z * U.surf.y * focal / z pixels, 1 to 12 on each side.
//
//  grep -n targets: "fn smooth1", "fn cs_smoothX", "fn cs_smoothY"
// ============================================================================

@group(2) @binding(0) var srcZ: texture_2d<f32>;
@group(2) @binding(1) var dstZ: texture_storage_2d<r32float, write>;

fn smooth1(p: vec2i, axis: vec2i) {
  let size = vec2i(textureDimensions(srcZ));
  if (p.x >= size.x || p.y >= size.y) { return; }
  let z0 = textureLoad(srcZ, p, 0).x;
  if (z0 <= 0.0) { textureStore(dstZ, p, vec4f(0.0)); return; }
  let rpx = clamp(U0.surf.z * U0.surf.y * U0.fwd.w / z0, 1.0, 12.0);
  let n = i32(ceil(rpx));
  let inv2s2 = 1.0 / (2.0 * (0.5 * rpx) * (0.5 * rpx));
  let band = U0.surf.y;
  var sum = 0.0;
  var wsum = 0.0;
  for (var k = -n; k <= n; k++) {
    let q = clamp(p + axis * k, vec2i(0), size - vec2i(1));
    let z = textureLoad(srcZ, q, 0).x;
    if (z <= 0.0) { continue; }
    let dz = (z - z0) / band;
    let w = exp(-f32(k * k) * inv2s2 - dz * dz);
    sum += w * z;
    wsum += w;
  }
  textureStore(dstZ, p, vec4f(sum / max(wsum, 1e-8), 0.0, 0.0, 0.0));
}
@compute @workgroup_size(8, 8)
fn cs_smoothX(@builtin(global_invocation_id) g: vec3u) { smooth1(vec2i(g.xy), vec2i(1, 0)); }
@compute @workgroup_size(8, 8)
fn cs_smoothY(@builtin(global_invocation_id) g: vec3u) { smooth1(vec2i(g.xy), vec2i(0, 1)); }
