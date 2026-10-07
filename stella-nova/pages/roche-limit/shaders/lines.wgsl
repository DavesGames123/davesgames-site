// ============================================================================
//  ROCHE LIMIT  ·  shaders/lines.wgsl — the prediction and reference lines
// ----------------------------------------------------------------------------
//  One instanced quad per segment. render.js fills the segment buffer each
//  frame: the analytic Roche circles, the Hill sphere, the Kepler conic of
//  the satellite centre ahead in time, short conics for shed fragments.
//  Width is in CSS px times the device ratio; colour and alpha per end, so
//  a conic fades along its length. Depth test only: the planet hides a line
//  behind it.
//
//  grep -n targets: "fn vs_line", "fn fs_line"
// ============================================================================

struct Cam {
  vp: mat4x4f, prevVp: mat4x4f, view: mat4x4f,
  eye: vec4f, sun: vec4f, vpSize: vec4f,
  right: vec4f, up: vec4f, fwd: vec4f,
  planet: vec4f, misc: vec4f, sat: vec4f, sat2: vec4f, field: vec4f, ringExt: vec4f,
};
// a: start (xyz) and width in px; b: end; ca, cb: colours (premultiplied
// by nothing; alpha in w)
struct Seg { a: vec4f, b: vec4f, ca: vec4f, cb: vec4f };
@group(0) @binding(0) var<uniform> cam: Cam;
@group(1) @binding(0) var<storage, read> segs: array<Seg>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) col: vec4f,
  @location(1) side: f32,
  @location(2) @interpolate(flat) w: f32,
};
@vertex
fn vs_line(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let s = segs[ii];
  var o: VOut;
  let ca = cam.vp * vec4f(s.a.xyz, 1.0);
  let cb = cam.vp * vec4f(s.b.xyz, 1.0);
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  if (ca.w <= 0.01 || cb.w <= 0.01) { return o; }
  let half = 0.5 * cam.vpSize.xy;
  let pa = ca.xy / ca.w * half;
  let pb = cb.xy / cb.w * half;
  var d = pb - pa;
  let l = length(d);
  if (l < 1e-4) { d = vec2f(1.0, 0.0); } else { d = d / l; }
  let n = vec2f(-d.y, d.x);
  let w = s.a.w + 1.0;
  var ends = array<f32, 6>(0.0, 1.0, 1.0, 0.0, 1.0, 0.0);
  var sides = array<f32, 6>(-1.0, -1.0, 1.0, -1.0, 1.0, 1.0);
  let e = ends[vi];
  let sd = sides[vi];
  let c = mix(ca, cb, e);
  let sp = mix(pa, pb, e) + n * sd * w * 0.5;
  o.pos = vec4f(sp / half * c.w, c.z, c.w);
  o.col = mix(s.ca, s.cb, e);
  o.side = sd;
  o.w = w;
  return o;
}
@fragment
fn fs_line(in: VOut) -> @location(0) vec4f {
  let d = abs(in.side) * 0.5 * in.w;
  let a = clamp(0.5 * in.w - d + 0.5, 0.0, 1.0) * clamp(in.w - 1.0, 0.25, 1.0);
  let al = in.col.w * a;
  return vec4f(in.col.xyz * al, al);
}
