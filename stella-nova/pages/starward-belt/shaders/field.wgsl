// field.wgsl — the Starward Belt background, one fullscreen triangle.
//
// The fragment shader turns each device pixel into a world point with the
// camera map from main.js, then paints the layers back to front:
//
//   layer     function      what it draws
//   ground    fs            flat #0b0b0b
//   rails     rails         thin grey lines along the belt axis
//   dust      dust          tiny filled dots from a jittered world grid
//   rocks     rocks         sparse hollow circles, few large ones
//   contours  fs            dashed isoline of smoothDensity where the dust is dense
//   hatch     hatchSdf      smooth-min union of discs, diagonal stripes
//
// Lines and dots use widths in device pixels, so they stay crisp and keep
// the same screen width at every zoom. World features (stripes, hollow
// circles) scale with the zoom.
//
// grep: struct Frame  struct Scene  fn vs  fn fs  fn rails  fn dust  fn rocks
//       fn clouds  fn warp  fn smoothDensity  fn hatchSdf  fn pcg3  fn vnoise  fn fbm

struct Frame {
  cam: vec4f,     // cx, cy, zoom (css px per world unit), scale (device px per css px)
  vp: vec4f,      // css w, css h, time s, fit zoom
  hover: vec4f,   // x, y, 1 when a station is hovered, 0
  pad: vec4f,
};

struct Scene {
  rail: vec4f,                  // a.x, a.y, axis unit x, axis unit y
  info: vec4f,                  // axis length, rail spacing, cloud count, region count
  clouds: array<vec4f, 24>,     // pairs: (x, y, rx, ry), (w, 0, 0, 0)
  regions: array<vec4f, 4>,     // first disc, disc count, smooth k, 0
  discs: array<vec4f, 16>,      // x, y, r, 0
};

@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var<uniform> S: Scene;

const GROUND = vec3f(0.043);
const RAIL_C = vec3f(0.60);
const DUST_C = vec3f(0.478);          // #7a7a7a
const ROCK_C = vec3f(0.50);
const LINE_C = vec3f(0.74);
const HATCH_C = vec3f(0.541);         // #8a8a8a
const TAU = 6.2831853;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

// ── hash and noise ─────────────────────────────────────────────────────────

fn pcg3(c: vec2i, seed: u32) -> vec3f {
  var v = vec3u(bitcast<u32>(c.x), bitcast<u32>(c.y), seed);
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v = v ^ (v >> vec3u(16u));
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return vec3f(v >> vec3u(8u)) * (1.0 / 16777216.0);
}

fn vnoise(p: vec2f, seed: u32) -> f32 {
  let i = vec2i(floor(p));
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = pcg3(i, seed).x;
  let b = pcg3(i + vec2i(1, 0), seed).x;
  let c = pcg3(i + vec2i(0, 1), seed).x;
  let d = pcg3(i + vec2i(1, 1), seed).x;
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(p0: vec2f) -> f32 {
  var p = p0;
  var s = 0.0;
  var a = 0.5;
  for (var o = 0u; o < 4u; o++) {
    s += a * vnoise(p, 11u + o);
    p = mat2x2f(1.6, 1.2, -1.2, 1.6) * p;
    a *= 0.5;
  }
  return s / 0.9375;
}

// ── belt frame ─────────────────────────────────────────────────────────────

fn axisU() -> vec2f { return S.rail.zw; }
fn axisV() -> vec2f { return vec2f(-S.rail.w, S.rail.z); }

// Coverage of a line of width w (device px) at distance d (device px).
fn lineCov(d: f32, w: f32) -> f32 {
  return clamp(0.5 * w + 0.5 - abs(d), 0.0, 1.0);
}

// ── rails ──────────────────────────────────────────────────────────────────

fn rails(p: vec2f, devPerWorld: f32) -> f32 {
  let q = p - S.rail.xy;
  let u = dot(q, axisU());
  let v = dot(q, axisV());
  let sp = S.info.y;
  let k = round(v / sp);
  if (abs(k) > 4.0) { return 0.0; }
  let d = (v - k * sp) * devPerWorld;
  // Each rail starts and ends at its own hashed point past the belt ends.
  let h = pcg3(vec2i(i32(k), 7), 3u);
  let u0 = -40.0 - h.x * 170.0;
  let u1 = S.info.x + 30.0 + h.y * 190.0;
  let fade = smoothstep(u0, u0 + 90.0, u) * (1.0 - smoothstep(u1 - 90.0, u1, u));
  let edge = 1.0 - 0.35 * step(3.5, abs(k));
  return lineCov(d, 1.0 * F.cam.w) * fade * edge * 0.28;
}

// ── dust density ───────────────────────────────────────────────────────────

// Smooth density: the sum of the anisotropic cloud gaussians. rx runs
// along the belt axis and ry across it.
fn clouds(p: vec2f) -> f32 {
  var d = 0.0;
  let n = u32(S.info.z);
  for (var i = 0u; i < n; i++) {
    let a = S.clouds[2u * i];
    let w = S.clouds[2u * i + 1u].x;
    let q = p - a.xy;
    let u = dot(q, axisU()) / a.z;
    let v = dot(q, axisV()) / a.w;
    d += w * exp(-0.5 * (u * u + v * v));
  }
  return d;
}

// Band of faint stray rocks around the whole belt.
fn band(p: vec2f) -> f32 {
  let q = p - S.rail.xy;
  let u = dot(q, axisU());
  let v = dot(q, axisV());
  let along = smoothstep(-260.0, 0.0, u) * (1.0 - smoothstep(S.info.x, S.info.x + 260.0, u));
  return along * exp(-0.5 * (v * v) / (330.0 * 330.0));
}

// Low-frequency warp so the contours are not perfect ellipses. Three sine
// waves at unrelated angles, not value noise: value noise has grid-aligned
// ridges, and the old warp gave the contour a long straight vertical run.
fn warp(p: vec2f) -> f32 {
  return 0.5 + 0.3 * sin(dot(p, vec2f(0.62, 0.78)) / 140.0 + 1.7)
             + 0.2 * sin(dot(p, vec2f(-0.91, 0.41)) / 90.0 + 4.2)
             + 0.14 * sin(dot(p, vec2f(0.28, -0.96)) / 55.0 + 0.6);
}

fn smoothDensity(p: vec2f) -> f32 {
  return clouds(p) * (0.78 + 0.44 * warp(p));
}

// ── asteroids ──────────────────────────────────────────────────────────────

// One layer of tiny filled dots. prob is the smooth density at the pixel;
// the ragged speckle comes from noise at each dot center.
fn dust(p: vec2f, cell: f32, seed: u32, prob: f32, rDev: f32, devPerWorld: f32) -> f32 {
  let g = p / cell;
  let c0 = vec2i(floor(g));
  var cov = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let c = c0 + vec2i(i, j);
      let h = pcg3(c, seed);
      if (h.x > prob) { continue; }
      let ctr = (vec2f(c) + 0.1 + 0.8 * vec2f(h.y, h.z)) * cell;
      let sp = vnoise(ctr / 34.0, 21u) * 0.6 + vnoise(ctr / 13.0, 22u) * 0.4;
      if (h.x > prob * smoothstep(0.22, 0.72, sp) * 1.6) { continue; }
      let r = rDev * (0.8 + 0.45 * fract(h.y * 7.31));
      let d = length(p - ctr) * devPerWorld;
      cov = max(cov, clamp(r + 0.5 - d, 0.0, 1.0));
    }
  }
  return cov;
}

// One layer of sparse hollow circles. Radius comes from a steep power law:
// most are small, a few are large.
fn rocks(p: vec2f, cell: f32, seed: u32, prob: f32, rMin: f32, rSpan: f32, powK: f32,
         devPerWorld: f32) -> f32 {
  let c = vec2i(floor(p / cell));
  let h = pcg3(c, seed);
  if (h.x > prob) { return 0.0; }
  let ctr = (vec2f(c) + 0.3 + 0.4 * vec2f(h.y, fract(h.y * 13.7 + h.z))) * cell;
  let r = rMin + rSpan * pow(h.z, powK);
  let rDev = max(r * devPerWorld, 1.7 * F.cam.w);
  let d = length(p - ctr) * devPerWorld;
  return lineCov(d - rDev, 0.9 * F.cam.w);
}

// ── hatch ──────────────────────────────────────────────────────────────────

fn smin(a: f32, b: f32, k: f32) -> f32 {
  let h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

fn hatchSdf(p: vec2f) -> f32 {
  var best = 1e6;
  let nr = u32(S.info.w);
  for (var r = 0u; r < nr; r++) {
    let reg = S.regions[r];
    var d = 1e6;
    let first = u32(reg.x);
    let last = first + u32(reg.y);
    for (var i = first; i < last; i++) {
      let c = S.discs[i];
      d = smin(d, length(p - c.xy) - c.z, reg.z);
    }
    best = min(best, d);
  }
  return best;
}

// ── fragment ───────────────────────────────────────────────────────────────

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let scale = F.cam.w;
  let zoom = F.cam.z;
  let devPerWorld = zoom * scale;
  let css = pos.xy / scale;
  let p = (css - 0.5 * F.vp.xy) / zoom + F.cam.xy;

  // Everything that needs screen derivatives runs here, in uniform flow.
  let sd = smoothDensity(p);
  let gx = dpdx(sd);
  let gy = dpdy(sd);
  let gl = max(length(vec2f(gx, gy)), 1e-6);

  var col = GROUND;

  // Rails.
  col = mix(col, RAIL_C, rails(p, devPerWorld));

  // Hatch SDF first, the dust thins inside the hazard regions.
  let hs = hatchSdf(p);
  let inside = 1.0 - smoothstep(-6.0, 2.0, hs);

  // Dust dots drift slowly along the belt axis.
  let drift = axisU() * (F.vp.z * 0.35);
  let pd = p - drift;
  let rough = fbm(p / 60.0);
  let dens = sd * mix(0.15, 2.1, rough * rough);
  var hov = 1.0;
  if (F.hover.z > 0.5) {
    let hd = length(p - F.hover.xy);
    hov = 1.0 + 0.7 * (1.0 - smoothstep(30.0, 90.0, hd));
  }
  let zr = clamp(pow(zoom / F.vp.w, 0.3), 1.0, 1.8);
  let rDot = 0.72 * scale * zr;
  let dim = 1.0 - 0.5 * inside;
  let pr = clamp(dens * 0.72, 0.0, 0.85) * dim;
  var dc = dust(pd, 6.0, 1u, pr, rDot, devPerWorld);
  dc = max(dc, dust(pd + vec2f(3.1, 1.7), 8.5, 2u, pr * 0.8, rDot, devPerWorld));
  let stray = band(p);
  dc = max(dc, dust(pd, 23.0, 3u, stray * 0.10, rDot, devPerWorld));
  col = mix(col, DUST_C * min(hov, 1.4), dc * min(0.85 * hov, 1.0));

  // Hollow rocks: a common small layer and a rare large layer.
  let rp = clamp(0.05 * stray + 0.12 * sd, 0.0, 0.3) * dim;
  var rc = rocks(pd, 36.0, 4u, rp, 1.6, 5.5, 5.0, devPerWorld);
  rc = max(rc, rocks(pd + vec2f(17.0, 41.0), 105.0, 5u, 0.35 * stray, 3.5, 9.0, 3.0, devPerWorld));
  col = mix(col, ROCK_C * min(hov, 1.4), rc * 0.8);

  // Density contour: a thin dashed isoline at a high threshold. The dash
  // phase is a world coordinate along one of four fixed directions (0, 45,
  // 90, 135 degrees from the belt axis). The shader picks the direction
  // nearest the local tangent, so each dash is 1.0 to 1.08 periods long.
  let T = 1.5;
  let dl = (sd - T) / gl;
  let lc = lineCov(dl, 1.15 * scale);
  let tn = vec2f(-gy, gx) / gl;
  let q = p - S.rail.xy;
  let au = axisU();
  let av = axisV();
  let dirs = array<vec2f, 4>(au, normalize(au + av), av, normalize(av - au));
  var bestK = 0u;
  var bestC = 0.0;
  for (var k = 0u; k < 4u; k++) {
    let c = abs(dot(tn, dirs[k]));
    if (c > bestC) { bestC = c; bestK = k; }
  }
  let P = 12.0;
  let ph = abs(fract(dot(q, dirs[bestK]) / P) - 0.5) * P;   // 0 mid-dash
  let dash = clamp((0.29 * P - ph) * devPerWorld * bestC + 0.5, 0.0, 1.0);
  col = mix(col, LINE_C, lc * dash * 0.75 * (1.0 - inside));

  // Hatch fill: stripes at about 22 degrees below the horizontal.
  let n = vec2f(-0.3746, 0.9272);
  let s = dot(p, n) / 9.0;
  let sdist = (abs(fract(s) - 0.5) - 0.2) * 9.0 * devPerWorld;   // stripe = 40 %
  let stripe = clamp(0.5 - sdist, 0.0, 1.0);
  let fill = clamp(0.5 - hs * devPerWorld, 0.0, 1.0);
  col = mix(col, HATCH_C, stripe * fill * 0.75);
  col = mix(col, HATCH_C, lineCov(hs * devPerWorld, 1.1 * scale) * 0.85);

  return vec4f(col, 1.0);
}
