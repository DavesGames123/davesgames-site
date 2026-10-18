// ============================================================================
//  PLANET COLLISION  ·  shaders/fluid.wgsl — the splat passes of the
//  screen-space fluid surface (after common.wgsl)
// ----------------------------------------------------------------------------
//  The method is screen-space fluid rendering (van der Laan, Green and
//  Sainz 2009): draw each particle as a sphere into a depth image, smooth
//  that depth image (smooth.wgsl), take normals from it and light it
//  (shade.wgsl fs_surface). The surface is the front of the particle
//  spheres, not a blur: the smoothing keeps depth edges (bilateral).
//
//    vs_sphere + fs_depth   pass 1: one camera-facing quad per fluid
//                           particle OUTSIDE the density volume (inside
//                           it, march.wgsl draws the iso surface in the
//                           same pass), ray-sphere hit per pixel, writes
//                           the view depth + cut flag (rg32float), the
//                           normal (rgba16float) and the reversed-Z depth.
//                           The cutaway plane cuts the spheres: a pixel
//                           behind the plane takes the plane hit, so the
//                           cut face is flat.
//    vs_sphereWide + fs_attr  pass 2: quads 1.6 x the sphere for every
//                           fluid and debris particle, add the particle
//                           fields (T, material, start position,
//                           body, speed, mixing) weighted by a kernel and by
//                           the distance to the front depth of pass 1 (only
//                           the front layer counts; where pass 1 drew
//                           nothing, the kernel only). Three rgba16float
//                           targets, additive:
//                             a0  w, w log2(T) / 16, w iron, w ice
//                             a1  w o.x, w o.y, w o.z, w body 1
//                             a2  w speed, w mixing, w cut, w
//    (the vapour is a volume now: smoke.wgsl)
//
//  grep -n targets: "fn vs_sphere", "fn hitSphere", "fn fs_depth",
//  "fn fs_attr"
// ============================================================================

@group(2) @binding(0) var frontZ: texture_2d<f32>;

struct SOut {
  @builtin(position) pos: vec4f,
  @location(0) @interpolate(flat) centre: vec4f,  // xyz, radius
  @location(1) @interpolate(flat) f0: vec4f,      // T, iron, ice, body1
  @location(2) @interpolate(flat) f1: vec4f,      // origin xyz, speed
  @location(3) @interpolate(flat) f2: vec4f,      // mixing, -, -, -
  @location(4) corner: vec2f,
};

fn quadCorner(vi: u32) -> vec2f {
  var q = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  return q[vi];
}
fn culled() -> SOut {
  var o: SOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  return o;
}
// grow: the quad size over the sphere radius (1 for depth, 1.6 for
// fields). The depth quads: fluid particles outside the volume only. The
// field quads: fluid and debris (the iso surface holds both).
fn sphereVert(vi: u32, ii: u32, grow: f32) -> SOut {
  if (ii >= arrayLength(&pTag)) { return culled(); }
  let kl = klass(ii);
  if (kl == K_VAPOUR) { return culled(); }
  let x = pPos[ii].xyz;
  if (grow < 1.5) {
    if (kl != K_FLUID) { return culled(); }
    if (volOn() && inVolume(x, kernelCells(ii) + 1.0)) { return culled(); }
  }
  let r = U0.surf.x * spacing0(ii);
  // a whole sphere on the removed side of the cut plane is gone
  if (U0.mode.y > 0.5 && dot(U0.cut.xyz, x) - r > U0.cut.w) { return culled(); }
  let toEye = U0.eye.xyz - x;
  let dist = length(toEye);
  if (dot(-toEye, U0.fwd.xyz) < r) { return culled(); }
  // a quad facing the eye, sized to cover the silhouette of the sphere
  let n = toEye / dist;
  let side = normalize(cross(U0.up.xyz, n));
  let upv = cross(n, side);
  let c = quadCorner(vi % 6u);
  let s = grow * r * dist / sqrt(max(dist * dist - r * r, 1e-8));
  let w = x + (c.x * side + c.y * upv) * s + n * r;
  var o: SOut;
  o.pos = U0.vp * vec4f(w, 1.0);
  o.centre = vec4f(x, r);
  let a = pAux[ii];
  let mt = matOf(ii);
  o.f0 = vec4f(a.x, select(0.0, 1.0, mt == 0u), select(0.0, 1.0, mt == 3u), select(0.0, 1.0, bodyOf(ii) == 1u));
  o.f1 = vec4f(pOrig[ii].xyz, length(pVel[ii].xyz));
  o.f2 = vec4f(min(a.z / 8.0, 1.0), 0.0, 0.0, 0.0);
  o.corner = c;
  return o;
}
@vertex
fn vs_sphere(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SOut { return sphereVert(vi, ii, 1.0); }
@vertex
fn vs_sphereWide(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SOut { return sphereVert(vi, ii, 1.6); }

// The view depth of the visible point of a sphere on ray D (dot(D, fwd) = 1)
// and a flag: x depth (or -1, a miss), y 1 on the cut face.
fn hitSphere(D: vec3f, c: vec3f, r: f32) -> vec2f {
  let e = U0.eye.xyz;
  let oc = e - c;
  let a = dot(D, D);
  let b = dot(oc, D);
  let cc = dot(oc, oc) - r * r;
  let h = b * b - a * cc;
  if (h < 0.0) { return vec2f(-1.0, 0.0); }
  let sq = sqrt(h);
  let t0 = (-b - sq) / a;
  let t1 = (-b + sq) / a;
  if (U0.mode.y > 0.5) {
    let n = U0.cut.xyz;
    if (dot(n, e + t0 * D) > U0.cut.w) {
      let dn = dot(n, D);
      if (abs(dn) < 1e-6) { return vec2f(-1.0, 0.0); }
      let tp = (U0.cut.w - dot(n, e)) / dn;
      if (tp > t0 && tp < t1) { return vec2f(tp, 1.0); }
      return vec2f(-1.0, 0.0);
    }
  }
  return vec2f(t0, 0.0);
}

struct DOut { @location(0) z: vec4f, @location(1) n: vec4f, @builtin(frag_depth) depth: f32 };
@fragment
fn fs_depth(in: SOut) -> DOut {
  let D = rayAt(in.pos.xy);
  let h = hitSphere(D, in.centre.xyz, in.centre.w);
  if (h.x <= 0.0) { discard; }
  var o: DOut;
  o.z = vec4f(h.x, h.y, 0.0, 0.0);
  let P = U0.eye.xyz + h.x * D;
  var n = normalize(P - in.centre.xyz);
  if (h.y > 0.5) { n = select(-U0.cut.xyz, U0.cut.xyz, dot(U0.cut.xyz, U0.eye.xyz - P) > 0.0); }
  o.n = vec4f(n, 1.0);
  o.depth = depthOfZ(h.x);
  return o;
}

struct AOut { @location(0) a0: vec4f, @location(1) a1: vec4f, @location(2) a2: vec4f };
@fragment
fn fs_attr(in: SOut) -> AOut {
  let q2 = dot(in.corner, in.corner);
  if (q2 >= 1.0) { discard; }
  let zf = textureLoad(frontZ, vec2i(in.pos.xy), 0);
  // the particle's front, against the front of the surface here; a pixel
  // with no sphere (the smoothed outline can add it) takes the kernel only
  let zp = dot(in.centre.xyz - U0.eye.xyz, U0.fwd.xyz) - in.centre.w;
  let dz = select(0.0, (zp - zf.x) / U0.surf.y, zf.x > 0.0);
  let k = (1.0 - q2) * (1.0 - q2);
  let w = k * exp(-dz * dz) + 1e-7;
  var o: AOut;
  o.a0 = w * vec4f(1.0, log2(max(in.f0.x, 1.0)) / 16.0, in.f0.y, in.f0.z);
  o.a1 = w * vec4f(in.f1.xyz, in.f0.w);
  o.a2 = w * vec4f(in.f1.w, in.f2.x, zf.y, 1.0);
  return o;
}
