// ============================================================================
//  HALFTONE  ·  shaders/scene.wgsl — the procedural source images
// ----------------------------------------------------------------------------
//  This page's own scenes (not upstream). gpu.js draws one into the source
//  texture each frame while it is the selected input, so the halftone of an
//  animated image is live. Both scenes are smooth colour fields, which show
//  the four screens and their rosettes well.
//    scene 0  Orbs ...... six glossy spheres on two orbits over a gradient,
//                         with soft shadows on the floor
//    scene 1  Spectrum .. a turning hue wheel (saturation to the rim) and
//                         ramps: grey, R, G, B, C, M, Y, and a skin tone
//
//  grep -n: "fn orbs"  "fn spectrum"  "fn fs_scene"
// ============================================================================

struct SU {
  size: vec4f,     // w, h, time (s), scene id
}
@group(0) @binding(0) var<uniform> su: SU;

@vertex fn vs_scene(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn hsv(h: f32, s: f32, v: f32) -> vec3f {
  let k = vec3f(5.0, 3.0, 1.0);
  let p = abs(fract(vec3f(h) + k / 6.0) * 6.0 - 3.0);
  return v * mix(vec3f(1.0), clamp(p - 1.0, vec3f(0.0), vec3f(1.0)), s);
}

// x right, y up, both in units of the image height; centre (0, 0).
fn orbs(q: vec2f, t: f32) -> vec3f {
  // Backdrop: warm floor below the horizon, teal to cream wall above it.
  let horizon = -0.18;
  let wall = mix(vec3f(1.0, 0.96, 0.86), vec3f(0.6, 0.84, 1.0), smoothstep(-0.2, 0.5, q.y));
  let floor_c = mix(vec3f(0.98, 0.8, 0.58), vec3f(0.94, 0.62, 0.44), smoothstep(-0.2, -0.5, q.y));
  var col = select(wall, floor_c, q.y < horizon);
  col *= 1.0 - 0.18 * smoothstep(0.55, 1.1, length(q * vec2f(0.75, 1.0)));

  var colors = array<vec3f, 6>(
    vec3f(1.0, 0.22, 0.18), vec3f(1.0, 0.85, 0.15), vec3f(0.1, 0.85, 0.85),
    vec3f(0.62, 0.38, 1.0), vec3f(1.0, 0.55, 0.15), vec3f(0.38, 0.92, 0.3));
  let L = normalize(vec3f(-0.5, 0.7, 0.6));

  // Shadows first (on the floor), then spheres far to near.
  var cx: array<vec3f, 6>;   // x, y, depth
  var rad: array<f32, 6>;
  for (var i = 0; i < 6; i++) {
    let fi = f32(i);
    let ring = select(0.62, 0.34, i >= 3);
    let w = select(0.23, -0.31, i >= 3);
    let a = t * w + fi * 2.094 + select(0.0, 1.05, i >= 3);
    let x = ring * cos(a) * 1.25;
    let z = ring * sin(a);
    let bob = 0.05 * sin(t * 0.9 + fi * 1.7);
    let r = (0.13 + 0.025 * f32(i % 3)) * (1.0 - 0.25 * z);
    cx[i] = vec3f(x, -0.02 + 0.16 * z + bob, z);
    rad[i] = r;
    let sp = vec2f(x + 0.1, -0.3 + 0.1 * z) - q;
    let sh = exp(-dot(sp * vec2f(1.0, 3.2), sp * vec2f(1.0, 3.2)) / (r * r * 1.1));
    col *= 1.0 - 0.45 * sh * f32(q.y < horizon + 0.02);
  }
  for (var step = 0; step < 6; step++) {
    // pick the farthest sphere not drawn yet: draw order by depth z (far = +z)
    var best = -1;
    var bz = -1e9;
    for (var j = 0; j < 6; j++) {
      let z = cx[j].z;
      if (rad[j] > 0.0 && z > bz) { bz = z; best = j; }
    }
    if (best < 0) { break; }
    let c = cx[best];
    let r = rad[best];
    rad[best] = -1.0;
    let d = (q - c.xy) / r;
    let d2 = dot(d, d);
    if (d2 < 1.0) {
      let N = vec3f(d, sqrt(1.0 - d2));
      let base = colors[best];
      let dif = max(dot(N, L), 0.0);
      let H = normalize(L + vec3f(0.0, 0.0, 1.0));
      let spec = pow(max(dot(N, H), 0.0), 48.0);
      let rim = pow(1.0 - N.z, 3.0);
      let s = base * (0.18 + 0.85 * dif) + vec3f(0.9) * spec + vec3f(0.35, 0.45, 0.55) * rim * 0.5;
      let aa = smoothstep(1.0, 0.97, d2);
      col = mix(col, s, aa);
    }
  }
  return col;
}

fn spectrum(q: vec2f, t: f32, aspect: f32) -> vec3f {
  var col = vec3f(0.96, 0.95, 0.92);
  // The hue wheel on the left half.
  let wc = vec2f(-aspect * 0.5 + 0.5, 0.0);
  let d = q - wc;
  let r = length(d);
  let hue = fract(atan2(d.y, d.x) / 6.2831853 + t * 0.02);
  let wheel = hsv(hue, clamp(r / 0.42, 0.0, 1.0), 1.0);
  col = mix(col, wheel, smoothstep(0.425, 0.42, r));
  // Ramps on the right: eight bars, dark to light (or white to colour).
  let x0 = -aspect * 0.5 + 1.08;
  let x1 = aspect * 0.5 - 0.06;
  let u = clamp((q.x - x0) / (x1 - x0), 0.0, 1.0);
  let row = floor((0.44 - q.y) / 0.11);
  let in_bar = (q.x > x0) & (q.x < x1) & (row >= 0.0) & (row < 8.0) & (fract((0.44 - q.y) / 0.11) < 0.82);
  var bars = array<vec3f, 8>(
    vec3f(u), vec3f(u, 0.0, 0.0), vec3f(0.0, u, 0.0), vec3f(0.0, 0.0, u),
    mix(vec3f(1.0), vec3f(0.0, 1.0, 1.0), u), mix(vec3f(1.0), vec3f(1.0, 0.0, 1.0), u),
    mix(vec3f(1.0), vec3f(1.0, 1.0, 0.0), u), mix(vec3f(0.25, 0.14, 0.1), vec3f(0.98, 0.84, 0.74), u));
  let bi = u32(clamp(row, 0.0, 7.0));
  col = select(col, bars[bi], in_bar);
  return col;
}

@fragment fn fs_scene(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let aspect = su.size.x / su.size.y;
  let q = vec2f((pos.x / su.size.y) - aspect * 0.5, 0.5 - pos.y / su.size.y);
  let t = su.size.z;
  var col: vec3f;
  if (su.size.w > 0.5) { col = spectrum(q, t, aspect); } else { col = orbs(q, t); }
  return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}
