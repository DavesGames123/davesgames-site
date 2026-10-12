// ============================================================================
//  GRAVITY LAB  ·  shaders/points.wgsl — the particles and the impact flashes
// ----------------------------------------------------------------------------
//  One instanced quad per particle row, read straight from the Lab's GPU
//  buffers (engine.js bufBody and bufDiag): nothing goes through the CPU.
//    rows    pos.xyz radius · vel.xyz mass (0 = gone) · spin (impact)
//    diag    live: |a|, the index of the body with the strongest pull
//            gone: |a|, body, impact speed, body index + 1
//    colors  one packed RGBA8 per row (render.js setColors: the group
//            colour, or the colour of the body a debris row came from)
//
//  A live row is a disc of at least cam.p0.y px. A disc smaller than that
//  keeps its light: the brightness falls with its area, not to zero, so a
//  far dust lane stays a faint lane and does not vanish. The edge is one
//  px of anti-aliasing: crisp, no soft sprite.
//  Colour modes (cam.p0.w): 0 the group, 1 the speed against the frame
//  centre (cam.vref), 2 the body with the strongest pull (diag.y).
//
//  IMPACT FLASH. A row that hit a body has mass 0 and keeps the impact
//  point (relative to the body centre) and time in spin. For cam.p0.z of
//  sim time it draws a flash on that body's surface: white, then orange,
//  then dull red, 3 to 10 px. Light of a hot impact plume, so it may bloom.
//
//  Blend: additive (one, one), depth test against the bodies, no depth
//  write.
//
//  WGSL NOTE: no mixed * and ^, no mixed && and || without parentheses.
//
//  grep -n targets: "fn vs_main", "fn fs_main", "fn toFrame", "fn ramp"
// ============================================================================

struct Cam {
  vp: mat4x4f,
  eye: vec4f, right: vec4f, up: vec4f, fwd: vec4f, vpSize: vec4f,
  frame: vec4f, l0: vec4f, l1: vec4f, c0: vec4f, c1: vec4f,
  p0: vec4f, p1: vec4f, vref: vec4f,
};
struct BI { pos: vec4f, col: vec4f, ext: vec4f };
struct Row { pos: vec4f, vel: vec4f, spin: vec4f };

@group(0) @binding(0) var<uniform> cam: Cam;
@group(0) @binding(1) var<storage, read> bodies: array<BI>;
@group(0) @binding(2) var<storage, read> rows: array<Row>;
@group(0) @binding(3) var<storage, read> diag: array<vec4f>;
@group(0) @binding(4) var<storage, read> colors: array<u32>;

fn toFrame(p: vec3f) -> vec3f {
  let d = p - cam.frame.xyz;
  let c = cos(cam.frame.w);
  let s = sin(cam.frame.w);
  return vec3f(c * d.x + s * d.y, -s * d.x + c * d.y, d.z);
}
fn rotFrame(d: vec3f) -> vec3f {
  let c = cos(cam.frame.w);
  let s = sin(cam.frame.w);
  return vec3f(c * d.x + s * d.y, -s * d.x + c * d.y, d.z);
}
fn unpack(u: u32) -> vec3f {
  return vec3f(f32(u & 255u), f32((u >> 8u) & 255u), f32((u >> 16u) & 255u)) / 255.0;
}
// speed ramp: slow deep blue, through teal and white, to hot amber
fn ramp(x: f32) -> vec3f {
  let t = clamp(x, 0.0, 1.0);
  let a = vec3f(0.16, 0.28, 0.85);
  let b = vec3f(0.3, 0.85, 0.9);
  let c = vec3f(0.95, 0.95, 0.9);
  let d = vec3f(1.0, 0.55, 0.18);
  if (t < 0.33) { return mix(a, b, t / 0.33); }
  if (t < 0.66) { return mix(b, c, (t - 0.33) / 0.33); }
  return mix(c, d, (t - 0.66) / 0.34);
}

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) col: vec3f,
  @location(2) pr: f32,
};
fn cull() -> VOut {
  var o: VOut;
  o.pos = vec4f(0.0, 0.0, -2.0, 1.0);
  o.uv = vec2f(0.0);
  o.col = vec3f(0.0);
  o.pr = 1.0;
  return o;
}
@vertex
fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var corner = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let r = rows[ii];
  var P: vec3f;
  var px: f32;
  var col: vec3f;
  let focal = cam.right.w;
  if (r.vel.w > 0.0) {
    P = toFrame(r.pos.xyz);
    let z = dot(P - cam.eye.xyz, cam.fwd.xyz);
    if (z <= 0.0) { return cull(); }
    let pr0 = r.pos.w * focal / z;
    px = max(pr0, cam.p0.y);
    // a disc under the minimum keeps the light of its area (floor 0.2)
    let k = clamp(pr0 / cam.p0.y, 0.2, 1.0);
    let mode = cam.p0.w;
    var base = unpack(colors[ii]);
    if (mode > 0.5 && mode < 1.5) {
      base = ramp(length(r.vel.xyz - cam.vref.xyz) * cam.p1.y);
    } else if (mode > 1.5) {
      let j = u32(diag[ii].y);
      if (j < u32(cam.p1.z)) { base = bodies[j].col.rgb; }
    }
    col = base * (cam.p1.x * k);
  } else {
    let d = diag[ii];
    let age = cam.eye.w - r.spin.w;
    if (r.spin.w <= 0.0 || d.w < 0.5 || age < 0.0 || age > cam.p0.z) { return cull(); }
    let j = u32(d.w) - 1u;
    if (j >= u32(cam.p1.z)) { return cull(); }
    let u = age / cam.p0.z;
    let B = bodies[j];
    // no flash on a black hole or on a body that is gone
    if (B.col.w < 0.0 || abs(B.col.w - 8.0) < 0.5) { return cull(); }
    // the surface point, lifted 1% so the body's own depth keeps it on
    // the near side only
    P = B.pos.xyz + rotFrame(r.spin.xyz) * 1.01 * (B.pos.w / max(length(r.spin.xyz), 1e-30));
    let z = dot(P - cam.eye.xyz, cam.fwd.xyz);
    if (z <= 0.0) { return cull(); }
    px = mix(3.0, 10.0, sqrt(u)) * cam.up.w;
    let hot = mix(vec3f(1.0, 0.95, 0.85) * 6.0, vec3f(1.0, 0.5, 0.15) * 2.0, smoothstep(0.0, 0.35, u));
    col = mix(hot, vec3f(0.6, 0.12, 0.04), smoothstep(0.35, 1.0, u)) * (1.0 - u) * (1.0 - u);
  }
  let k2 = corner[vi];
  var clip = cam.vp * vec4f(P, 1.0);
  let off = k2 * (px + 1.0) * 2.0 * vec2f(cam.vpSize.z, cam.vpSize.w);
  clip = vec4f(clip.xy + off * clip.w, clip.z, clip.w);
  var o: VOut;
  o.pos = clip;
  o.uv = k2 * (px + 1.0);
  o.col = col;
  o.pr = px;
  return o;
}

@fragment
fn fs_main(i: VOut) -> @location(0) vec4f {
  // uv in px from the centre; one px of edge
  let d = length(i.uv);
  let a = clamp(i.pr + 0.5 - d, 0.0, 1.0);
  if (a <= 0.0) { discard; }
  return vec4f(i.col * a, 0.0);
}
