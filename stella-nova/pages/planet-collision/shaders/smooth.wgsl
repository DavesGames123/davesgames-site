// ============================================================================
//  PLANET COLLISION  ·  shaders/smooth.wgsl — the bilateral depth filter and
//  the silhouette (after common.wgsl)
// ----------------------------------------------------------------------------
//  One axis per dispatch; render.js runs X, Y two times. The first X pass
//  reads the raw depth of fluid.wgsl (cs_smoothX0); the others read the
//  ping-pong images. Each image is rg32float: x the view depth, y the
//  coverage.
//
//  DEPTH. A covered pixel takes the bilateral mean of its covered
//  neighbours: the range term exp(-(dz / band)^2) keeps a depth step (a
//  body in front of another, a clump in front of the surface) as a step.
//  A pixel with no depth takes the plain mean of its covered neighbours,
//  so a pixel that the coverage adds below has a depth.
//  COVERAGE. 1 where a sphere covers the pixel, 0 elsewhere, then blurred
//  (Gaussian, sigma 0.35 of the filter radius per pass). shade.wgsl draws
//  the surface where the coverage is over 0.5: the edge of a union of
//  spheres has a bump per particle; the 0.5 line of the blurred coverage
//  is a smooth outline, and its gradient gives a one-pixel edge blend.
//  A single sphere keeps a centre coverage over 0.5 after two passes.
//
//  The filter radius is the projected size of one particle sphere:
//  U.surf.z * U.surf.y * focal / z pixels (z: the pixel's depth, or the
//  target distance U.extra.y for an empty pixel), 1 to 12 on each side.
//
//  grep -n targets: "fn smooth1", "fn cs_smoothX0", "fn cs_smoothX", "fn cs_smoothY"
// ============================================================================

@group(2) @binding(0) var srcZ: texture_2d<f32>;
@group(2) @binding(1) var dstZ: texture_storage_2d<rg32float, write>;

fn tapAt(q: vec2i, first: bool) -> vec2f {
  let t = textureLoad(srcZ, q, 0);
  if (first) { return vec2f(t.x, select(0.0, 1.0, t.x > 0.0)); }
  return t.xy;
}
fn smooth1(p: vec2i, axis: vec2i, first: bool) {
  let size = vec2i(textureDimensions(srcZ));
  if (p.x >= size.x || p.y >= size.y) { return; }
  let c0 = tapAt(p, first);
  let z0 = c0.x;
  let zr = select(U0.extra.y, z0, z0 > 0.0);
  let rpx = clamp(U0.surf.z * U0.surf.y * U0.fwd.w / max(zr, 1e-4), 1.0, 12.0);
  let n = i32(ceil(rpx));
  let sd = 0.5 * rpx;
  let sc = 0.35 * rpx;
  let invD = 1.0 / (2.0 * sd * sd);
  let invC = 1.0 / (2.0 * sc * sc);
  let band = U0.surf.y;
  var zs = 0.0;
  var zw = 0.0;
  var cs = 0.0;
  var cw = 0.0;
  for (var k = -n; k <= n; k++) {
    let q = clamp(p + axis * k, vec2i(0), size - vec2i(1));
    let t = tapAt(q, first);
    let kk = f32(k * k);
    let wc = exp(-kk * invC);
    cs += wc * t.y;
    cw += wc;
    if (t.x <= 0.0) { continue; }
    var w = exp(-kk * invD);
    if (z0 > 0.0) { let dz = (t.x - z0) / band; w = w * exp(-dz * dz); }
    zs += w * t.x;
    zw += w;
  }
  let z = select(0.0, zs / max(zw, 1e-12), zw > 1e-12);
  textureStore(dstZ, p, vec4f(z, cs / max(cw, 1e-12), 0.0, 0.0));
}
@compute @workgroup_size(8, 8)
fn cs_smoothX0(@builtin(global_invocation_id) g: vec3u) { smooth1(vec2i(g.xy), vec2i(1, 0), true); }
@compute @workgroup_size(8, 8)
fn cs_smoothX(@builtin(global_invocation_id) g: vec3u) { smooth1(vec2i(g.xy), vec2i(1, 0), false); }
@compute @workgroup_size(8, 8)
fn cs_smoothY(@builtin(global_invocation_id) g: vec3u) { smooth1(vec2i(g.xy), vec2i(0, 1), false); }
