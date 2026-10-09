// ============================================================================
//  PLANET FORGE  ·  sky.wgsl — the background: stars, the Milky Way, the sun
//  (render.js joins atmo-common.wgsl, this file, then planet.wgsl)
// ----------------------------------------------------------------------------
//  All directions here are in the WORLD frame (planet.wgsl turns the view
//  ray out of the spinning body frame first), so the stars stay fixed in
//  direction while the planet turns and the camera orbits.
//
//  STARS  two layers of cells on the six faces of a cube (180 and 520 cells
//  per face edge). Each cell holds one star at a seeded point in the middle
//  half of the cell. Its magnitude comes from N(<m) ~ 10^(0.45 m), so most
//  stars are faint: m = M_MAX + log10(u) / 0.45. Flux 10^(-0.4 m). The colour
//  is a black body at a seeded temperature (most stars cool and orange, a
//  few hot and blue). The star is a Gaussian 0.6 device px wide in angle
//  (pxAng), so it stays crisp at any canvas size and does not alias.
//  MILKY WAY  a faint band on a fixed great circle with a bulge, noise and
//  dark dust lanes. The faint star layer is denser near the band.
//  SUN  a disc of angular radius sunR, so the camera lens sets its size on
//  screen. The disc shading is adapted from the "granule_star" cell of
//  pages/sdf-solids-table/cells.mjs (Worley granulation, limb darkening
//  0.3 + 0.7 mu^0.55, dark spots, a warped corona). Its noise helpers
//  (pcg3d, gnoise, fbm3, worley2) are adapted from
//  pages/sdf-solids-table/shaders/pack.wgsl. Here the corona is a 2D
//  streak field round the disc (no volume), plus a lens glare 1 / (1 + x^2)^1.5.
//
//  grep -n targets: "fn sky_pcg3d", "fn sky_gnoise", "fn sky_fbm",
//  "fn sky_worley", "fn sky_blackbody", "fn sky_starLayer", "fn sky_milkyWay",
//  "fn sky_sun", "fn skyColor"
// ============================================================================

fn sky_pcg3d(vin: vec3u) -> vec3u {
  var v = vin * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v = v ^ (v >> vec3u(16u));
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
fn sky_hash(p: vec3f) -> vec3f { return vec3f(sky_pcg3d(bitcast<vec3u>(vec3i(floor(p))))) * (1.0 / 4294967295.0); }
fn sky_corner(i: vec3f, f: vec3f, o: vec3f) -> f32 { return dot(sky_hash(i + o) * 2.0 - 1.0, f - o); }
fn sky_gnoise(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let a = mix(sky_corner(i, f, vec3f(0.0, 0.0, 0.0)), sky_corner(i, f, vec3f(1.0, 0.0, 0.0)), w.x);
  let b = mix(sky_corner(i, f, vec3f(0.0, 1.0, 0.0)), sky_corner(i, f, vec3f(1.0, 1.0, 0.0)), w.x);
  let c = mix(sky_corner(i, f, vec3f(0.0, 0.0, 1.0)), sky_corner(i, f, vec3f(1.0, 0.0, 1.0)), w.x);
  let d = mix(sky_corner(i, f, vec3f(0.0, 1.0, 1.0)), sky_corner(i, f, vec3f(1.0, 1.0, 1.0)), w.x);
  return mix(mix(a, b, w.y), mix(c, d, w.y), w.z) * 1.3;
}
fn sky_fbm(p0: vec3f, oct: i32) -> f32 {
  var p = p0;
  var a = 0.5;
  var s = 0.0;
  var n = 0.0;
  for (var i = 0; i < 6; i++) {
    if (i >= oct) { break; }
    s += a * sky_gnoise(p);
    n += a;
    a *= 0.5;
    p = p * 2.03 + vec3f(1.7, -3.1, 2.3);
  }
  return s / max(n, 1e-4);
}
fn sky_worley(p: vec3f) -> vec2f {
  let i = floor(p);
  let f = fract(p);
  var d1 = 8.0;
  var d2 = 8.0;
  for (var z = -1; z <= 1; z++) { for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let o = vec3f(f32(x), f32(y), f32(z));
    let r = o + sky_hash(i + o) - f;
    let d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  } } }
  return sqrt(vec2f(d1, d2));
}

// Black-body colour (fit of the CIE result, 1000 K .. 40000 K), max channel 1.
fn sky_blackbody(T: f32) -> vec3f {
  let t = T / 100.0;
  var r = 1.0;
  var g = 0.0;
  var b = 1.0;
  if (t <= 66.0) {
    g = clamp((99.4708 * log(t) - 161.1196) / 255.0, 0.0, 1.0);
    b = select(clamp((138.5177 * log(max(t - 10.0, 1.0)) - 305.0448) / 255.0, 0.0, 1.0), 0.0, t <= 19.0);
  } else {
    r = clamp(329.6987 * pow(t - 60.0, -0.1332) / 255.0, 0.0, 1.0);
    g = clamp(288.1222 * pow(t - 60.0, -0.0755) / 255.0, 0.0, 1.0);
  }
  return pow(vec3f(r, g, b), vec3f(2.2));
}

// Cube-face cell coordinates of direction d: face id and (u, v) in [0, 1].
fn sky_face(d: vec3f) -> vec3f {
  let a = abs(d);
  if (a.x >= a.y && a.x >= a.z) { return vec3f(select(1.0, 0.0, d.x > 0.0), d.y / a.x * 0.5 + 0.5, d.z / a.x * 0.5 + 0.5); }
  if (a.y >= a.z) { return vec3f(select(3.0, 2.0, d.y > 0.0), d.x / a.y * 0.5 + 0.5, d.z / a.y * 0.5 + 0.5); }
  return vec3f(select(5.0, 4.0, d.z > 0.0), d.x / a.z * 0.5 + 0.5, d.y / a.z * 0.5 + 0.5);
}
fn sky_faceDir(face: f32, uv: vec2f) -> vec3f {
  let q = uv * 2.0 - 1.0;
  let s = select(-1.0, 1.0, fract(face * 0.5) < 0.25);
  let f = u32(face) / 2u;
  if (f == 0u) { return normalize(vec3f(s, q.x, q.y)); }
  if (f == 1u) { return normalize(vec3f(q.x, s, q.y)); }
  return normalize(vec3f(q.x, q.y, s));
}

const SKY_MMAX: f32 = 9.5;

// One layer of stars. n cells per face edge; keep = chance a cell has a star;
// mBright = the brightest magnitude this layer may draw.
fn sky_starLayer(d: vec3f, n: f32, keep: f32, mBright: f32, pxAng: f32, salt: f32) -> vec3f {
  let fu = sky_face(d);
  let c = floor(fu.yz * n);
  let h = sky_hash(vec3f(c, fu.x * 17.0 + salt));
  if (h.z > keep) { return vec3f(0.0); }
  let h2 = sky_hash(vec3f(c.yx + 91.0, fu.x * 5.0 + salt + 3.0));
  let sd = sky_faceDir(fu.x, (c + 0.25 + 0.5 * h.xy) / n);
  let ang = length(cross(d, sd));
  let sig = 0.6 * pxAng;
  let m = max(mBright, SKY_MMAX + log(max(h2.x, 1e-6)) / (0.45 * 2.302585));
  let flux = 2.4 * pow(10.0, -0.4 * m);
  // temperature: most stars cool (K, M), a few hot (B, A)
  let T = mix(3100.0, 7200.0, h2.y * h2.y) + select(0.0, 14000.0 * h2.z, h2.y > 0.93);
  let tint = mix(vec3f(1.0), sky_blackbody(T), 0.75);
  return tint * flux * exp(-0.5 * ang * ang / (sig * sig));
}

const SKY_GAL_N: vec3f = vec3f(0.4885, 0.8507, -0.1937);   // band normal
const SKY_GAL_C: vec3f = vec3f(-0.8549, 0.4157, -0.3104);  // bulge direction (in the band)

fn sky_milkyWay(d: vec3f, oct: i32) -> vec3f {
  let b = dot(d, SKY_GAL_N);
  let band = exp(-b * b / 0.022);
  if (band < 0.01) { return vec3f(0.0); }
  let bulge = exp(-pow(acos(clamp(dot(d, SKY_GAL_C), -1.0, 1.0)) / 0.55, 2.0));
  let cloud = sky_fbm(d * 6.0, oct) * 0.5 + 0.5;
  let lane = smoothstep(0.08, 0.0, abs(b + 0.025 * sky_fbm(d * 9.0 + 4.0, oct))) * smoothstep(0.35, 0.65, sky_fbm(d * 13.0 + 9.0, oct) * 0.5 + 0.5);
  let glow = band * (0.35 + 0.9 * cloud * cloud) * (1.0 + 2.5 * bulge) * (1.0 - 0.8 * lane);
  return glow * mix(vec3f(0.62, 0.66, 0.8), vec3f(1.0, 0.84, 0.64), bulge) * 0.0045;
}

struct Sun { col: vec3f, disc: f32 }

// The sun at world direction s with angular radius r (rad), seen along d.
// t: time (s) for the granulation drift; gain: disc radiance scale.
fn sky_sun(d: vec3f, s: vec3f, r: f32, t: f32, gain: f32, spots: f32) -> Sun {
  var o: Sun;
  o.col = vec3f(0.0);
  o.disc = 0.0;
  let c = dot(d, s);
  let th = acos(clamp(c, -1.0, 1.0));
  let x = th / r;
  // lens glare: wide and faint, then the corona close to the disc
  o.col += vec3f(1.0, 0.9, 0.75) * 0.03 / pow(1.0 + x * x * 0.2, 1.5);
  if (x > 4.5) { return o; }
  // tangent frame on the sky round s
  var e = cross(s, vec3f(0.0, 1.0, 0.0));
  if (dot(e, e) < 1e-6) { e = vec3f(1.0, 0.0, 0.0); }
  e = normalize(e);
  let nn = cross(e, s);
  let lx = dot(d, e) / r;
  let ly = dot(d, nn) / r;
  let ang = atan2(ly, lx);
  if (x > 1.0) {
    let streak = sky_fbm(vec3f(cos(ang) * 3.2, sin(ang) * 3.2, t * 0.02 + x * 0.35), 3);
    let dens = exp(-(x - 1.0) * 2.6) * (0.3 + 1.6 * max(streak + 0.15, 0.0));
    o.col += mix(vec3f(1.0, 0.45, 0.12), vec3f(1.0, 0.86, 0.66), 0.35) * dens * 0.4;
    return o;
  }
  // the disc: the visible hemisphere of the sun, spun slowly
  let mu = sqrt(max(1.0 - x * x, 0.0));
  let q = normalize(e * lx + nn * ly + s * mu);
  let w = sky_worley(q * 11.0 + vec3f(t * 0.004));
  let gran = smoothstep(0.0, 0.5, w.y - w.x);
  let spot = smoothstep(0.25, 0.45, sky_fbm(q * 2.0 + 11.0, 3)) * spots;
  let limb = 0.3 + 0.7 * pow(mu, 0.55);
  let hot = mix(vec3f(1.0, 0.42, 0.1), vec3f(1.0, 0.84, 0.6), limb * (0.55 + 0.45 * gran));
  o.col += hot * (1.0 + 0.5 * gran) * limb * (1.0 - 0.75 * spot) * gain;
  o.disc = smoothstep(1.0, 0.97, x);
  return o;
}

// The whole background along world direction d. pxAng: radians per device
// pixel. q: quality (0 phone, 1 tablet, 2 desktop).
fn skyColor(d: vec3f, pxAng: f32, q: f32) -> vec3f {
  let oct = select(select(4, 3, q < 1.5), 2, q < 0.5);
  let mw = sky_milkyWay(d, oct);
  var c = mw;
  c += sky_starLayer(d, 180.0, 0.9, -1.0, pxAng, 1.0);
  let near = clamp(dot(mw, vec3f(160.0)), 0.0, 1.0);
  c += sky_starLayer(d, 520.0, 0.35 + 0.6 * near, 5.5, pxAng, 7.0);
  return c;
}
