// ============================================================================
//  ROCHE LIMIT  ·  shaders/field.wgsl — the force field on the orbit plane
// ----------------------------------------------------------------------------
//  A quad on z = 0. Each pixel evaluates the field of the planet and of the
//  satellite's bound mass at its own point, in world units (planet radii):
//    mode 1  Roche potential in the frame that turns with the satellite,
//            Phi = -GM_p/r - GM_s/|r - c| - Omega^2 |r_xy|^2 / 2,
//            coloured by sign(Phi - Phi_L1) log(1 + |Phi - Phi_L1|/s).
//            The bright contour is Phi = Phi_L1: the Roche lobe, through
//            the inner Lagrange point L1. A grain outside the lobe is no
//            longer held by the satellite.
//    mode 2  tidal stretch: |a_tide| / |a_sat|, the tidal acceleration
//            relative to the satellite centre over the satellite's pull,
//            log colour from 0.01 to 100. The bright contour is 1.
//  Contours every quarter decade, antialiased with fwidth.
//  cam.sat = (centre c, radius R_s); cam.sat2 = (GM_s, GM_p, Omega,
//  Phi_L1); cam.field = (mode, half extent, scale s, opacity).
//
//  grep -n targets: "fn potential", "fn tideRatio", "fn fs_field", "fn ramp"
// ============================================================================

struct Cam {
  vp: mat4x4f, prevVp: mat4x4f, view: mat4x4f,
  eye: vec4f, sun: vec4f, vpSize: vec4f,
  right: vec4f, up: vec4f, fwd: vec4f,
  planet: vec4f, misc: vec4f, sat: vec4f, sat2: vec4f, field: vec4f, ringExt: vec4f,
};
@group(0) @binding(0) var<uniform> cam: Cam;

struct VOut { @builtin(position) pos: vec4f, @location(0) w: vec3f };
@vertex
fn vs_field(@builtin(vertex_index) vi: u32) -> VOut {
  var c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  var o: VOut;
  let p = vec3f(c[vi] * cam.field.y, 0.0);
  o.pos = cam.vp * vec4f(p, 1.0);
  o.w = p;
  return o;
}

fn potential(p: vec3f) -> f32 {
  let rp = max(length(p), 1.0);
  let rs = max(length(p - cam.sat.xyz), cam.sat.w);
  let om = cam.sat2.z;
  return -cam.sat2.y / rp - cam.sat2.x / rs - 0.5 * om * om * dot(p.xy, p.xy);
}
fn tideRatio(p: vec3f) -> f32 {
  let c = cam.sat.xyz;
  let rc = length(c);
  let rp = max(length(p), 0.5);
  let at = cam.sat2.y * (c / (rc * rc * rc) - p / (rp * rp * rp));
  let ds = max(length(p - c), cam.sat.w * 0.25);
  let asat = cam.sat2.x / (ds * ds);
  return length(at) / max(asat, 1e-20);
}
// deep teal (inside a lobe) - dark - amber/rose (outside)
fn ramp(s: f32) -> vec3f {
  let t = clamp(s, -1.0, 1.0);
  if (t < 0.0) {
    return mix(vec3f(0.03, 0.04, 0.07), vec3f(0.10, 0.55, 0.85), pow(-t, 0.7));
  }
  return mix(vec3f(0.03, 0.04, 0.07), mix(vec3f(0.85, 0.35, 0.25), vec3f(1.0, 0.82, 0.45), t), pow(t, 0.7));
}
fn heat(t0: f32) -> vec3f {
  let t = clamp(t0, 0.0, 1.0) * 4.0;
  let c0 = vec3f(0.02, 0.02, 0.10);
  let c1 = vec3f(0.30, 0.10, 0.55);
  let c2 = vec3f(0.85, 0.25, 0.35);
  let c3 = vec3f(1.00, 0.62, 0.15);
  let c4 = vec3f(1.00, 0.97, 0.75);
  if (t < 1.0) { return mix(c0, c1, t); }
  if (t < 2.0) { return mix(c1, c2, t - 1.0); }
  if (t < 3.0) { return mix(c2, c3, t - 2.0); }
  return mix(c3, c4, t - 3.0);
}
fn line(v: f32, w: f32) -> f32 {
  let f = abs(fract(v + 0.5) - 0.5);
  let fw = max(fwidth(v), 1e-5);
  return 1.0 - smoothstep(0.0, w * fw, f);
}

@fragment
fn fs_field(in: VOut) -> @location(0) vec4f {
  let p = in.w;
  let mode = i32(cam.field.x + 0.5);
  let edge = 1.0 - smoothstep(0.7, 1.0, length(p.xy) / cam.field.y);
  var col = vec3f(0.0);
  var a = cam.field.w * edge;
  if (mode == 1) {
    let v = potential(p) - cam.sat2.w;
    let s = sign(v) * log(1.0 + abs(v) / cam.field.z) / log(10.0);
    col = ramp(s * 0.5);
    let lv = s * 4.0;
    col = col + vec3f(0.55, 0.70, 0.85) * line(lv, 1.0) * 0.35;
    let lobe = line(v / cam.field.z * 6.0, 2.2) * (1.0 - smoothstep(0.0, 0.5, abs(s)));
    col = mix(col, vec3f(0.75, 1.0, 1.0) * 1.8, lobe);
    a = a * max(0.55, lobe);
  } else {
    let q = log(max(tideRatio(p), 1e-6)) / log(10.0);
    col = heat((q + 2.0) / 4.0) * 0.9;
    col = col + vec3f(1.0, 0.9, 0.8) * line(q * 4.0, 1.0) * 0.25;
    let one = line(q, 2.4) * (1.0 - smoothstep(0.0, 0.25, abs(q)));
    col = mix(col, vec3f(1.0, 1.0, 0.85) * 2.0, one);
    // far from the satellite the tide wins by orders of magnitude: fade
    // that part, so the map shows the satellite's own neighbourhood
    a = a * max(max(0.5, one) * (1.0 - 0.8 * smoothstep(0.6, 2.2, q)), one);
  }
  // the planet disc itself is drawn by planet.wgsl
  if (length(p.xy) < 1.0) { a = a * 0.15; }
  return vec4f(col * a, a);
}
