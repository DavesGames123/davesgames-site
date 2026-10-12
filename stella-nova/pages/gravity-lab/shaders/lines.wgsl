// ============================================================================
//  GRAVITY LAB  ·  shaders/lines.wgsl — trails, the predicted path, guides
// ----------------------------------------------------------------------------
//  One instanced quad per segment, a fixed width in device px. Segment
//  (render.js setSegments, 12 floats):
//    a   xyz (frame coordinates), width in device px
//    b   xyz, alpha at b
//    c   rgb, alpha at a
//  A segment with an end behind the eye is cut at the near plane in clip
//  space. The quad has one px of anti-aliasing across its width.
//  Blend: premultiplied over. Depth test against the bodies, no write.
//
//  grep -n targets: "fn vs_main", "fn fs_main"
// ============================================================================

struct Cam {
  vp: mat4x4f,
  eye: vec4f, right: vec4f, up: vec4f, fwd: vec4f, vpSize: vec4f,
  frame: vec4f, l0: vec4f, l1: vec4f, c0: vec4f, c1: vec4f,
  p0: vec4f, p1: vec4f, vref: vec4f,
};
struct Seg { a: vec4f, b: vec4f, c: vec4f };

@group(0) @binding(0) var<uniform> cam: Cam;
@group(0) @binding(1) var<storage, read> segs: array<Seg>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) col: vec4f,
  @location(1) v: f32,
  @location(2) hw: f32,
};
@vertex
fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let s = segs[ii];
  var ca = cam.vp * vec4f(s.a.xyz, 1.0);
  var cb = cam.vp * vec4f(s.b.xyz, 1.0);
  var o: VOut;
  let wmin = 1e-7;
  if (ca.w <= wmin && cb.w <= wmin) {
    o.pos = vec4f(0.0, 0.0, -2.0, 1.0);
    o.col = vec4f(0.0);
    o.v = 0.0;
    o.hw = 1.0;
    return o;
  }
  if (ca.w <= wmin) { ca = mix(ca, cb, (wmin - ca.w) / (cb.w - ca.w) + 1e-4); }
  if (cb.w <= wmin) { cb = mix(cb, ca, (wmin - cb.w) / (ca.w - cb.w) + 1e-4); }
  let half = vec2f(0.5 * cam.vpSize.x, 0.5 * cam.vpSize.y);
  let sa = ca.xy / ca.w * half;
  let sb = cb.xy / cb.w * half;
  var dir = sb - sa;
  let L = length(dir);
  if (L < 1e-4) { dir = vec2f(1.0, 0.0); } else { dir = dir / L; }
  let nrm = vec2f(-dir.y, dir.x);
  let hw = 0.5 * s.a.w + 1.0;
  // 0, 1, 2, 0, 2, 3 over the corners (a-, b-, b+, a+)
  var endB = array<f32, 6>(0.0, 1.0, 1.0, 0.0, 1.0, 0.0);
  var side = array<f32, 6>(-1.0, -1.0, 1.0, -1.0, 1.0, 1.0);
  let e = endB[vi];
  let sd = side[vi];
  var c = select(ca, cb, e > 0.5);
  let sp = select(sa, sb, e > 0.5) + nrm * (sd * hw);
  c = vec4f(sp / half * c.w, c.z, c.w);
  o.pos = c;
  o.col = vec4f(s.c.rgb, select(s.c.w, s.b.w, e > 0.5));
  o.v = sd * hw;
  o.hw = hw;
  return o;
}
@fragment
fn fs_main(i: VOut) -> @location(0) vec4f {
  let a = i.col.a * clamp(i.hw - abs(i.v), 0.0, 1.0);
  if (a <= 0.0) { discard; }
  return vec4f(i.col.rgb * a, a);
}
