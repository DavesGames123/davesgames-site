// ============================================================================
//  PLANET COLLISION  ·  shaders/march.wgsl — the iso surface of the density
//  volume (after common.wgsl)
// ----------------------------------------------------------------------------
//  vs_march + fs_march: one full-screen triangle in the depth pass (with
//  fluid.wgsl fs_depth, which draws the particles outside the volume as
//  spheres). Per pixel: the ray e + t D (t is the view depth) is clipped
//  to the cube, skips the bricks that vol.wgsl did not mark, and steps
//  half a cell at a time in the marked ones until the field (hardware
//  trilinear, volTex.w) reaches the iso level U.vol1.y; six bisection
//  steps then place the hit. The normal is the interpolated gradient
//  (volTex.xyz), so the surface has no facets at the cell faces.
//  The cutaway: a sample on the removed side has no field, so a ray that
//  enters the matter through the plane hits the plane (flag 1, the plane
//  normal).
//  Writes the same targets as fs_depth: view depth + cut flag (rg32float),
//  the normal (rgba16float, w 1), and the reversed-Z depth.
//
//  grep -n targets: "fn vs_march", "fn fs_march", "fn fieldAt"
// ============================================================================

@group(2) @binding(0) var volTex: texture_3d<f32>;
@group(2) @binding(1) var<storage, read> bricks: array<u32>;
@group(2) @binding(2) var clampSamp: sampler;

struct MV { @builtin(position) pos: vec4f };
@vertex
fn vs_march(@builtin(vertex_index) vi: u32) -> MV {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: MV;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  return o;
}
fn volAt(g: vec3f) -> vec4f {
  return textureSampleLevel(volTex, clampSamp, (g + vec3f(0.5)) / U0.vol1.x, 0.0);
}
// the field at e + t D (none on the removed side of the cut)
fn fieldAt(e: vec3f, D: vec3f, t: f32) -> f32 {
  let p = e + t * D;
  if (removed(p)) { return 0.0; }
  return volAt(toGrid(p)).w;
}

struct MOut { @location(0) z: vec4f, @location(1) n: vec4f, @builtin(frag_depth) depth: f32 };
@fragment
fn fs_march(in: MV) -> MOut {
  if (!volOn()) { discard; }
  let e = U0.eye.xyz;
  let D = rayAt(in.pos.xy);
  let G = U0.vol1.x;
  let ge = toGrid(e);
  let gd = D / U0.vol0.w;
  let sg = select(gd, vec3f(1e-9), abs(gd) < vec3f(1e-9));
  let inv = vec3f(1.0) / sg;
  let ta = (vec3f(0.0) - ge) * inv;
  let tb = (vec3f(G - 1.0) - ge) * inv;
  let tlo = min(ta, tb);
  let thi = max(ta, tb);
  let tmax = min(min(thi.x, thi.y), thi.z);
  var t = max(max(max(tlo.x, tlo.y), tlo.z), U0.view.x);
  if (tmax <= t) { discard; }
  let dt = 0.5 / length(gd);
  let NB = i32(G) / 8;
  let iso = U0.vol1.y;
  var tp = t;
  var hit = false;
  for (var i = 0; i < 480; i++) {
    if (t > tmax) { break; }
    let g = ge + t * gd;
    let c = clamp(vec3i(floor(g)), vec3i(0), vec3i(i32(G) - 2));
    let b = c / 8;
    if (bricks[u32(b.x + NB * (b.y + NB * b.z))] == 0u) {
      // to the exit of this brick
      let b0 = (vec3f(b * 8) - ge) * inv;
      let b1 = (vec3f(b * 8 + vec3i(8)) - ge) * inv;
      let bh = max(b0, b1);
      t = max(min(min(bh.x, bh.y), bh.z), t) + 0.02 * dt;
      tp = t;
      continue;
    }
    if (fieldAt(e, D, t) >= iso) { hit = true; break; }
    tp = t;
    t = t + dt;
  }
  if (!hit) { discard; }
  var a = tp;
  var z = t;
  for (var k = 0; k < 6; k++) {
    let m = 0.5 * (a + z);
    if (fieldAt(e, D, m) >= iso) { z = m; } else { a = m; }
  }
  let P = e + z * D;
  var o: MOut;
  var flag = 0.0;
  var n = vec3f(0.0, 0.0, 1.0);
  if (U0.mode.y > 0.5 && removed(e + a * D)) {
    // the ray came in through the cut plane: the flat cut face
    let cn = U0.cut.xyz;
    let dn = dot(cn, D);
    if (abs(dn) > 1e-6) { z = (U0.cut.w - dot(cn, e)) / dn; }
    n = select(-cn, cn, dot(cn, e - P) > 0.0);
    flag = 1.0;
  } else {
    let gr = volAt(toGrid(P)).xyz;
    n = -gr / max(length(gr), 1e-12);
  }
  o.z = vec4f(z, flag, 0.0, 0.0);
  o.n = vec4f(n, 1.0);
  o.depth = depthOfZ(z);
  return o;
}
