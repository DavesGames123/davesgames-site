// ============================================================================
//  STORM GLOBE  ·  shaders/globe.wgsl  ·  the Earth, the flow colour, the sky
// ----------------------------------------------------------------------------
//  One full-screen triangle. Each pixel casts a ray from the eye and hits
//  the unit sphere analytically, so the globe has no mesh and no depth
//  buffer, and nothing drawn on its surface can z-fight: the flow colour,
//  the dye, the coast and the forecast cone fill are all texture layers
//  that this one shader mixes at the same point (the cone outline is a
//  crisp line in overlay.wgsl). (Tracks, particles and markers
//  are drawn after it in overlay.wgsl, at fixed small heights, with a
//  horizon test instead of a depth test.)
//
//  Layers, bottom up: ocean and land lit by the real sun at the slider
//  time (terminator), the field (speed | cyclonic vorticity | pressure
//  with 4 hPa isobars) through the LUT, the land tint again on top (so
//  land stays lighter than water under strong colour), the dye, the
//  cones (cone.r fill, cone.g the selected storm), the graticule
//  (analytic, every 30 deg, 1 px wide from the pixel footprint), then the
//  atmosphere rim. Rays that miss get stars and the limb glow.
//  The land mask (landT.r) is a one-channel texture; "landMask" sharpens
//  its 0.5 contour with fwidth, so the land edge stays crisp under
//  magnification and falls back to the plain filtered mask when the
//  texture is minified. The coastline itself is a vector line drawn
//  after this pass (overlay.wgsl "fn cvs").
//
//  grep -n targets: "struct Frame", "fn surface", "fn sky", "fn fs"
// ============================================================================
struct Frame {
  eye: vec4f,     // xyz, w = time (s)
  right: vec4f,   // xyz, w = tan(fov x / 2)
  up: vec4f,      // xyz, w = tan(fov y / 2)
  fwd: vec4f,     // xyz, w = device pixel ratio
  view: vec4f,    // principal point offset x, y (NDC), width, height (px)
  sun: vec4f,     // xyz, w = night floor
  look: vec4f,    // field mode (0 speed, 1 vorticity, 2 pressure, 3 off), field strength, dye, cones
  look2: vec4f,   // graticule, unused, unused, fade (0..1)
};
@group(0) @binding(0) var<uniform> FR: Frame;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var diagT: texture_2d<f32>;
@group(0) @binding(3) var landT: texture_2d<f32>;
@group(0) @binding(4) var coneT: texture_2d<f32>;
@group(0) @binding(5) var lutT: texture_2d<f32>;

const PI: f32 = 3.14159265358979;

struct VO { @builtin(position) pos: vec4f, };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VO {
  let x = f32((i << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(i & 2u) * 2.0 - 1.0;
  var o: VO; o.pos = vec4f(x, y, 0.0, 1.0); return o;
}

fn lut(row: f32, x: f32) -> vec3f {
  return textureSampleLevel(lutT, samp, vec2f(clamp(x, 0.002, 0.998), (row + 0.5) / 4.0), 0.0).rgb;
}
fn hash3(p: vec3f) -> f32 {
  let q = fract(p * vec3f(0.1031, 0.1030, 0.0973));
  let r = q + dot(q, q.yzx + 33.33);
  return fract((r.x + r.y) * r.z);
}
fn sky(d: vec3f) -> vec3f {
  let g = floor(d * 260.0);
  let h = hash3(g);
  let c = fract(d * 260.0) - 0.5;
  let star = select(0.0, (1.0 - smoothstep(0.05, 0.32, length(c))) * pow(hash3(g + 7.0), 6.0), h > 0.985);
  return vec3f(0.006, 0.008, 0.016) + vec3f(0.85, 0.9, 1.0) * star * 0.9;
}

@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let W = FR.view.z; let Hh = FR.view.w;
  let ndc = vec2f(fc.x / W * 2.0 - 1.0, 1.0 - fc.y / Hh * 2.0);
  let d = normalize(FR.fwd.xyz + FR.right.xyz * (ndc.x - FR.view.x) * FR.right.w + FR.up.xyz * (ndc.y - FR.view.y) * FR.up.w);
  let o = FR.eye.xyz;
  let b = dot(o, d); let c = dot(o, o) - 1.0; let h = b * b - c;
  let hit = h >= 0.0;
  let t = -b - sqrt(max(h, 0.0));
  let n = normalize(o + d * t);
  // texture coordinates (computed for every pixel: derivatives below need
  // uniform control flow)
  let lon = atan2(n.y, n.x);
  let u = fract(lon / (2.0 * PI) + 1.0);
  let v = (asin(clamp(n.z, -1.0, 1.0)) + 0.5 * PI) / PI;
  let F = textureSampleLevel(diagT, samp, vec2f(u, v), 0.0);
  let L = textureSampleLevel(landT, samp, vec2f(u, 1.0 - v), 0.0);
  let K = textureSampleLevel(coneT, samp, vec2f(u, 1.0 - v), 0.0);
  let q = (F.z + 1000.0) / 4.0;
  let fw = max(fwidth(q), 1e-4);
  // landMask: the sharpened 0.5 contour of the filtered mask
  let lw = max(fwidth(L.r), 1e-3);
  let land = clamp((L.r - 0.5) / lw * 0.5 + 0.5, 0.0, 1.0);
  // graticule: degrees of arc to the nearest 30 deg line over the pixel
  // footprint (deg per px from the derivative of the surface normal)
  let pxDeg = max(length(fwidth(n)) * 57.29578, 1e-4);
  let latD = asin(clamp(n.z, -1.0, 1.0)) * 57.29578;
  let lonD = atan2(n.y, n.x) * 57.29578;
  let gLat = abs(fract(latD / 30.0 + 0.5) - 0.5) * 30.0;
  let gLon = abs(fract(lonD / 30.0 + 0.5) - 0.5) * 30.0 * cos(latD / 57.29578);
  let gLonOn = select(0.0, 1.0, abs(latD) < 75.0);
  let grat = max((1.0 - smoothstep(0.0, pxDeg * 1.1, gLat)) * select(0.0, 1.0, abs(latD) < 75.0),
                 (1.0 - smoothstep(0.0, pxDeg * 1.1, gLon)) * gLonOn);

  // ── surface ───────────────────────────────────────────────────────────
  let sunD = FR.sun.xyz;
  let ndl = dot(n, sunD);
  let day = smoothstep(-0.15, 0.25, ndl);
  let lit = mix(FR.sun.w, 1.0, day);
  let ocean = mix(vec3f(0.006, 0.014, 0.034), vec3f(0.018, 0.052, 0.112), day);
  let ground = mix(vec3f(0.062, 0.062, 0.068), vec3f(0.27, 0.26, 0.225) * (0.6 + 0.4 * max(ndl, 0.0)), day);
  var col = mix(ocean, ground, land);
  // sun glint on the water
  let rr = reflect(d, n);
  col = col + vec3f(1.0, 0.9, 0.75) * pow(max(dot(rr, sunD), 0.0), 60.0) * 0.35 * (1.0 - land) * day;

  // the field
  let mode = i32(FR.look.x + 0.5);
  let k = FR.look.y;
  if (mode == 0) {
    let x = sqrt(clamp(F.x / 75.0, 0.0, 1.0));
    let fc2 = lut(0.0, x);
    let a = k * (0.18 + 0.82 * smoothstep(0.12, 0.55, x)) * (1.0 - 0.3 * land);
    col = mix(col, fc2 * (0.62 + 0.38 * lit), a);
  } else if (mode == 1) {
    let x = 0.5 + 0.5 * sign(F.y) * sqrt(min(1.0, abs(F.y) / 40.0));
    let a = k * smoothstep(0.02, 0.3, abs(x - 0.5) * 2.0) * (1.0 - 0.3 * land);
    col = mix(col, lut(1.0, x) * (0.62 + 0.38 * lit), a);
  } else if (mode == 2) {
    let x = clamp((F.z + 1000.0 - 950.0) / 90.0, 0.0, 1.0);
    col = mix(col, lut(2.0, x) * (0.6 + 0.4 * lit), k * 0.78 * (1.0 - 0.25 * land));
    let iso = 1.0 - smoothstep(0.0, fw * 1.3, abs(fract(q + 0.5) - 0.5));
    col = mix(col, vec3f(0.92, 0.95, 1.0), iso * 0.45 * k);
  }
  // the land tint again, on top of the field: land lighter, water darker
  col = col * (1.0 - 0.08 * (1.0 - land)) + vec3f(0.050, 0.048, 0.040) * land * (0.7 + 0.3 * lit);
  // dye
  col = mix(col, vec3f(0.62, 0.93, 1.0) * (0.45 + 0.55 * lit), FR.look.z * F.w * 0.42);
  // cones
  col = mix(col, vec3f(1.0, 0.97, 0.93), FR.look.w * (K.r * 0.06 + K.g * 0.12));
  // graticule (the coastline is a vector line in overlay.wgsl)
  col = col + vec3f(0.5, 0.6, 0.8) * grat * FR.look2.x * 0.06;
  // atmosphere rim on the disc
  let rim = pow(1.0 - max(dot(n, -d), 0.0), 3.0);
  col = col + vec3f(0.22, 0.42, 0.95) * rim * (0.08 + 0.42 * day);

  // ── sky and limb glow ─────────────────────────────────────────────────
  let sc = max(-b, 0.0);
  let closest = length(o + d * sc);
  let glow = exp(-(max(closest, 1.0) - 1.0) / 0.022);
  let sunSide = 0.25 + 0.75 * smoothstep(-0.3, 0.4, dot(normalize(o + d * sc), sunD));
  let skyCol = sky(d) + vec3f(0.30, 0.52, 1.0) * glow * 0.55 * sunSide;
  var outc = select(skyCol, col, hit);
  outc = outc * FR.look2.w;
  return vec4f(outc, 1.0);
}
