// ============================================================================
//  DLA TERRAIN  ·  shaders/sky.wgsl — the atmosphere, the sun, the moon and
//  the night sky (package SKY). gpu.loadWGSL joins common.wgsl and
//  lib/dla-terrain-detail.wgsl in front of it.
// ----------------------------------------------------------------------------
//  TWO PARTS. The part above the line "@@SKY-ENTRY" is the SKY library:
//  render/sky.js cuts it out and puts it in front of clouds.wgsl and
//  weather.wgsl too, so the three files share one uniform (struct SkyU),
//  one atmosphere and one cloud layer. The part below the line holds the
//  entry points of this file.
//
//  ATMOSPHERE  Hillaire 2020, "A Scalable and Production Ready Sky and
//    Atmosphere Rendering Technique" (EGSR). Rayleigh, Mie and ozone, km
//    units, planet radius 6360 km (sky-state.js ATMO has the same values:
//    Rayleigh 0.005802 0.013558 0.0331, Mie 0.003996 + 0.0044, ozone
//    0.00065 0.001881 0.000085, tests/sky.test.mjs checks them).
//      csTrans    256 x 64  transmittance T(r, mu) to the top
//      csMulti     32 x 32  multiple scattering Psi_ms(mu_s, h)
//      csSkyView  192 x 108 sky radiance round the camera, each frame
//    The medium, the (r, mu) mapping and the multiple-scattering pass are
//    adapted from pages/forge/shaders/atmo-common.wgsl and atmo-lut.wgsl.
//  NIGHT  stars, the Milky Way and the noise helpers are adapted from
//    pages/forge/shaders/sky.wgsl (which adapts the granule_star cell of
//    pages/sdf-solids-table). The star sphere turns round the celestial
//    pole with the sidereal time, so the stars wheel through the night.
//  SUN  a disc of 0.267 deg radius with limb darkening (Neckel and Labs,
//    u = 0.6) and granulation after forge sky_sun, reddened by the
//    transmittance LUT.
//  MOON  a sphere lit by the real sun direction: the phase follows from the
//    geometry. Maria from noise, earthshine on the dark part.
//  CLOUD LAYER and CLOUD SHADOW  cloud heights (sk_cloudBase, sk_cloudTop)
//    and cloudShadow(p) live here so that every SKY shader agrees.
//  WEATHER MODEL  wx_tile(xz, t) reads the 2D atmosphere of
//    weather-model.js (cloud cover, type, base and top, rain, storms, fog)
//    from tWx, blended in time between two snapshots. Other
//    packages: see "fn cloudShadow" and NOTES.md.
//
//  grep -n targets
//    "struct SkyU", "fn sk_medium", "fn sk_transmittance", "fn sk_multi",
//    "fn sk_skyViewUV", "fn sk_sunRadiance", "fn sk_hash3", "fn sk_fbm",
//    "fn sk_starLayer", "fn sk_milkyWay", "fn sk_moon", "fn sk_sunDisc",
//    "fn cloudShadow", "fn wx_tile", "@@SKY-ENTRY", "fn csTrans",
//    "fn csMulti", "fn csSkyView", "fn skyRadiance", "fn fsSky"
// ============================================================================

struct SkyU {
  rayleigh: vec4f,  // xyz beta_R 1/km, w H_R km
  mieS: vec4f,      // xyz beta_Ms 1/km (haze scale applied), w H_M km
  mieA: vec4f,      // xyz beta_Ma 1/km, w g
  ozone: vec4f,     // xyz beta_O 1/km, w centre km
  radii: vec4f,     // x bottom km, y top km, z ozone half width km, w camera altitude km
  sun: vec4f,       // x angular radius rad, y solar illuminance (clear), z sidereal angle rad, w night 0..1
  moon: vec4f,      // xyz moon dir, w moon illuminance scale
  cloud0: vec4f,    // x base m (world y), y top m, z cover 0..1, w cumulus 0..1
  cloud1: vec4f,    // x storm 0..1, y cirrus 0..1, zw wind offset of the cloud field m
  cloud2: vec4f,    // x density gain, y detail gain, z anvil top m, w march steps
  bolt: vec4f,      // xyz bolt top world m, w flash 0..1
  vol0: vec4f,      // x froxel near m, y froxel far m, z valley fog 0..1, w valley fog top m
  vol1: vec4f,      // x rain, y snow, z haze per m, w frame jitter 0..1
  vol2: vec4f,      // xyz froxel grid, w history weight
  shadow: vec4f,    // xy cloud shadow rect origin (world xz), z rect size m, w spare
  misc: vec4f,      // x latitude rad, y moon phase 0..1, z time s, w rainbow gain
  counts: vec4f,    // x rain streaks, y splashes, z snow flakes, w bolt segments
  precip: vec4f,    // x rain box radius m, y snow box radius m, z streak exposure s, w valley fog density per m
  prevCam: vec4f,   // xyz camera last frame, w resolution scale of the cloud target
  wx0: vec4f,       // weather model: x domain origin (x and z) m, y domain size m, z blend a -> b, w grid n
  wx1: vec4f,       // x lowest cloud base m, y highest cloud top m (the slab of the domain), zw upper wind unit vector
  anim0: vec4f,     // xy cloud motion of this frame m (reprojection), z shape evolution m, w detail evolution m
  anim1: vec4f,     // xy haze drift m (mod 1400), z splash count max, w spare
  anim2: vec4f,     // xy rain box drift m (mod 2R), zw snow box drift m (mod 2R)
  anim3: vec4f,     // rain fall phases a b, snow fall phases a b (render/weather.js precipPhases)
  anim4: vec4f,     // x splash time s, y flutter time s, z rain count max, w snow count max
}

@group(1) @binding(0) var<uniform> S: SkyU;
@group(1) @binding(1) var tTrans: texture_2d<f32>;
@group(1) @binding(2) var tMulti: texture_2d<f32>;
@group(1) @binding(3) var tSkyView: texture_2d<f32>;
@group(1) @binding(4) var sClamp: sampler;
@group(1) @binding(5) var tCloudShadow: texture_2d<f32>;
@group(1) @binding(6) var tNoiseBase: texture_3d<f32>;
@group(1) @binding(7) var tNoiseDetail: texture_3d<f32>;
@group(1) @binding(8) var sRepeat: sampler;
@group(1) @binding(9) var tNoise2D: texture_2d<f32>;
// the weather model (weather-model.js): 6 tiles of n x n stacked in y
@group(1) @binding(16) var tWx: texture_2d<f32>;

const SK_PI: f32 = 3.14159265;

// smoothstep that also works with a > b (falling edge). The built-in is
// undefined for a >= b on Metal, and the SKY shaders use falling edges.
fn sk_ss(a: f32, b: f32, x: f32) -> f32 {
  let t = clamp((x - a) / (b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
const SK_R: f32 = 6360000.0;   // planet radius m, for the curve of the cloud layer

// ── atmosphere (km) ─────────────────────────────────────────────────────────
struct SkMedium { sR: vec3f, sM: vec3f, ext: vec3f }

fn sk_medium(h: f32) -> SkMedium {
  let hh = max(h, 0.0);
  let dR = exp(-hh / S.rayleigh.w);
  let dM = exp(-hh / S.mieS.w);
  let dO = max(0.0, 1.0 - abs(hh - S.ozone.w) / max(S.radii.z, 0.001));
  var m: SkMedium;
  m.sR = S.rayleigh.xyz * dR;
  m.sM = S.mieS.xyz * dM;
  m.ext = m.sR + (S.mieS.xyz + S.mieA.xyz) * dM + S.ozone.xyz * dO;
  return m;
}

fn sk_raySphere(ro: vec3f, rd: vec3f, r: f32) -> vec2f {
  let b = dot(ro, rd);
  let c = dot(ro, ro) - r * r;
  let d = b * b - c;
  if (d < 0.0) { return vec2f(-1.0, -1.0); }
  let s = sqrt(d);
  return vec2f(-b - s, -b + s);
}

fn sk_transUV(r: f32, mu: f32) -> vec2f {
  let bot = S.radii.x;
  let top = S.radii.y;
  let H = sqrt(max(0.0, top * top - bot * bot));
  let rho = sqrt(max(0.0, r * r - bot * bot));
  let disc = r * r * (mu * mu - 1.0) + top * top;
  let d = max(0.0, -r * mu + sqrt(max(disc, 0.0)));
  let dMin = top - r;
  let dMax = rho + H;
  return vec2f((d - dMin) / max(dMax - dMin, 1e-4), rho / max(H, 1e-4));
}

fn sk_uvTrans(uv: vec2f) -> vec2f {
  let bot = S.radii.x;
  let top = S.radii.y;
  let H = sqrt(max(0.0, top * top - bot * bot));
  let rho = H * uv.y;
  let r = sqrt(rho * rho + bot * bot);
  let dMin = top - r;
  let dMax = rho + H;
  let d = dMin + uv.x * (dMax - dMin);
  var mu = 1.0;
  if (d > 0.0) { mu = (H * H - rho * rho - d * d) / (2.0 * r * d); }
  return vec2f(r, clamp(mu, -1.0, 1.0));
}

fn sk_phaseR(c: f32) -> f32 { return 3.0 / (16.0 * SK_PI) * (1.0 + c * c); }
// Cornette-Shanks
fn sk_phaseM(c: f32, g: f32) -> f32 {
  let g2 = g * g;
  let k = 3.0 / (8.0 * SK_PI) * (1.0 - g2) / (2.0 + g2);
  return k * (1.0 + c * c) / pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5);
}
fn sk_hg(c: f32, g: f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / (4.0 * SK_PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}

// Transmittance to the top from radius r (km), cos zenith mu. 0 below the
// horizon of the planet.
fn sk_transmittance(r: f32, mu: f32) -> vec3f {
  let T = textureSampleLevel(tTrans, sClamp, sk_transUV(r, mu), 0.0).rgb;
  // soft planet shadow edge (about 0.3 deg) so the sun sets smoothly
  let horizonMu = -sqrt(max(0.0, 1.0 - (S.radii.x / r) * (S.radii.x / r)));
  return T * sk_ss(horizonMu - 0.006, horizonMu + 0.002, mu);
}
fn sk_multi(r: f32, muS: f32) -> vec3f {
  let uv = vec2f(muS * 0.5 + 0.5, clamp((r - S.radii.x) / (S.radii.y - S.radii.x), 0.0, 1.0));
  return textureSampleLevel(tMulti, sClamp, uv, 0.0).rgb;
}

// Camera radius km from a world y in m.
fn sk_rKm(y: f32) -> f32 { return S.radii.x + max((y - G.terrain.z) * 0.001, 0.002); }

// Sun radiance (irradiance on a plane facing the sun) at world point p
// through the clear air. Cloud shadow and terrain shadow are separate.
fn sk_sunRadiance(p: vec3f) -> vec3f {
  return S.sun.y * sk_transmittance(sk_rKm(p.y), G.sunDir.y);
}
fn sk_moonRadiance(p: vec3f) -> vec3f {
  // the eye sees moonlight as a cool grey (Purkinje shift): keep only a
  // third of the reddening of a low moon, so a moonrise does not paint
  // the clouds and the haze orange
  let T = sk_transmittance(sk_rKm(p.y), S.moon.y);
  let Tl = dot(T, vec3f(0.2126, 0.7152, 0.0722));
  return S.moon.w * vec3f(0.85, 0.9, 1.0) * mix(vec3f(Tl), T, 0.35);
}

// Sky-view LUT mapping (Hillaire 2020, sec. 5.3): u from the azimuth to
// the sun, v non-linear in the zenith angle, dense at the horizon.
fn sk_skyViewUV(r: f32, viewDir: vec3f, sunDir: vec3f) -> vec2f {
  let vh = sqrt(max(r * r - S.radii.x * S.radii.x, 0.0));
  let beta = acos(clamp(vh / r, -1.0, 1.0));
  let zha = SK_PI - beta;
  let vz = acos(clamp(viewDir.y, -1.0, 1.0));
  var v: f32;
  if (vz < zha) {
    var c = vz / zha;
    c = 1.0 - sqrt(max(1.0 - c, 0.0));
    v = c * 0.5;
  } else {
    let c = sqrt(clamp((vz - zha) / beta, 0.0, 1.0));
    v = c * 0.5 + 0.5;
  }
  let vxz = viewDir.xz;
  let sxz = sunDir.xz;
  let lv = length(vxz) * length(sxz);
  let cosAz = select(1.0, dot(vxz, sxz) / lv, lv > 1e-6);
  let u = sqrt(clamp(0.5 - 0.5 * cosAz, 0.0, 1.0));
  return vec2f(u, v);
}

// ── noise (after pages/forge/shaders/sky.wgsl) ───────────────────────────────
fn sk_pcg3d(vin: vec3u) -> vec3u {
  var v = vin * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v = v ^ (v >> vec3u(16u));
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
fn sk_hash3(p: vec3f) -> vec3f { return vec3f(sk_pcg3d(bitcast<vec3u>(vec3i(floor(p))))) * (1.0 / 4294967295.0); }
fn sk_corner(i: vec3f, f: vec3f, o: vec3f) -> f32 { return dot(sk_hash3(i + o) * 2.0 - 1.0, f - o); }
fn sk_gnoise(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let a = mix(sk_corner(i, f, vec3f(0.0, 0.0, 0.0)), sk_corner(i, f, vec3f(1.0, 0.0, 0.0)), w.x);
  let b = mix(sk_corner(i, f, vec3f(0.0, 1.0, 0.0)), sk_corner(i, f, vec3f(1.0, 1.0, 0.0)), w.x);
  let c = mix(sk_corner(i, f, vec3f(0.0, 0.0, 1.0)), sk_corner(i, f, vec3f(1.0, 0.0, 1.0)), w.x);
  let d = mix(sk_corner(i, f, vec3f(0.0, 1.0, 1.0)), sk_corner(i, f, vec3f(1.0, 1.0, 1.0)), w.x);
  return mix(mix(a, b, w.y), mix(c, d, w.y), w.z) * 1.3;
}
fn sk_fbm(p0: vec3f, oct: i32) -> f32 {
  var p = p0;
  var a = 0.5;
  var s = 0.0;
  var n = 0.0;
  for (var i = 0; i < 6; i++) {
    if (i >= oct) { break; }
    s += a * sk_gnoise(p);
    n += a;
    a *= 0.5;
    p = p * 2.03 + vec3f(1.7, -3.1, 2.3);
  }
  return s / max(n, 1e-4);
}
fn sk_worley(p: vec3f) -> vec2f {
  let i = floor(p);
  let f = fract(p);
  var d1 = 8.0;
  var d2 = 8.0;
  for (var z = -1; z <= 1; z++) { for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let o = vec3f(f32(x), f32(y), f32(z));
    let r = o + sk_hash3(i + o) - f;
    let d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  } } }
  return sqrt(vec2f(d1, d2));
}
fn sk_remap(v: f32, a: f32, b: f32, c: f32, d: f32) -> f32 { return c + (v - a) / (b - a) * (d - c); }

// ── the cloud layer ──────────────────────────────────────────────────────────
// Height above the curved sea surface (parabolic planet, centre under the
// world origin): the layer bends down toward the horizon.
fn sk_layerH(p: vec3f) -> f32 { return p.y + dot(p.xz, p.xz) / (2.0 * SK_R); }
// Ray parameters (near, far) where the ray is between heights h0 and h1.
// The surface y + |xz|^2 / 2R = h is a paraboloid: a t^2 + b t + c = 0.
fn sk_layerHit(ro: vec3f, rd: vec3f, h: f32) -> vec2f {
  let a = dot(rd.xz, rd.xz) / (2.0 * SK_R);
  let b = rd.y + dot(ro.xz, rd.xz) / SK_R;
  let c = sk_layerH(ro) - h;
  if (a < 1e-12) {
    if (abs(b) < 1e-9) { return vec2f(-1.0, -1.0); }
    let t = -c / b;
    return vec2f(t, t);
  }
  let d = b * b - 4.0 * a * c;
  if (d < 0.0) { return vec2f(-1.0, -1.0); }
  let s = sqrt(d);
  let t0 = (-b - s) / (2.0 * a);
  let t1 = (-b + s) / (2.0 * a);
  return vec2f(min(t0, t1), max(t0, t1));
}
// [tEnter, tExit] of the slab between h0 and h1; tExit < tEnter: no hit.
fn sk_slab(ro: vec3f, rd: vec3f, h0: f32, h1: f32, tMax: f32) -> vec2f {
  let hr = sk_layerH(ro);
  let A = sk_layerHit(ro, rd, h0);   // the inside of paraboloid h0 is below it
  let B = sk_layerHit(ro, rd, h1);
  var t0 = 0.0;
  var t1 = tMax;
  if (hr < h0) {
    // below the slab: enter where the ray rises through h0
    if (A.y < 0.0) { return vec2f(1.0, -1.0); }
    t0 = max(A.y, 0.0);
    if (A.x > 0.0) { t0 = A.x; }
    t1 = select(tMax, B.y, B.y > t0);
    if (B.x > t0) { t1 = B.x; }
  } else if (hr > h1) {
    // above: enter through h1 going down
    if (B.x < 0.0 || B.y < 0.0) { return vec2f(1.0, -1.0); }
    t0 = max(B.x, 0.0);
    t1 = select(B.y, A.x, A.x > t0);
  } else {
    // inside the slab
    t0 = 0.0;
    var e = tMax;
    if (A.x > 0.0) { e = min(e, A.x); }
    if (B.y > 0.0) { e = min(e, B.y); }
    if (B.x > 0.0) { e = min(e, B.x); }
    t1 = e;
  }
  return vec2f(t0, min(t1, tMax));
}

fn sk_cloudBase() -> f32 { return S.cloud0.x; }
fn sk_cloudTop() -> f32 { return S.cloud0.y; }

// Cloud shadow: the transmittance of the sun light through the cloud layer
// above world point p (0 dark .. 1 clear). render/sky.js fills
// tCloudShadow (512 x 512, r = transmittance) over the square
// S.shadow.xy .. S.shadow.xy + S.shadow.z at the cloud base. Points that
// project out of the square get the mean cover.
fn cloudShadow(p: vec3f) -> f32 {
  let sd = G.sunDir.xyz;
  let lit = sk_ss(-0.04, 0.03, sd.y);
  let t = max(sk_cloudBase() - p.y, 0.0) / max(sd.y, 0.08);
  let q = p.xz + sd.xz * t;
  let uv = (q - S.shadow.xy) / S.shadow.z;
  let inside = all(uv > vec2f(0.0)) && all(uv < vec2f(1.0));
  var T = 1.0 - 0.7 * S.cloud0.z;
  if (inside) { T = textureSampleLevel(tCloudShadow, sClamp, uv, 0.0).r; }
  return mix(1.0, T, lit);
}

// ── the weather model ────────────────────────────────────────────────────────
// Tile t (0 A, 1 B, 2 C) at world xz, blended from snapshot a to b.
//   A: cover, type (0 deck .. 1 towers), top m, precipitation 0..1
//   B: storm 0..1, valley fog 0..1, base m, cirrus 0..1
//   C: fog top m, low wind x, low wind z, freezing level m
fn wx_tile(xz: vec2f, t: f32) -> vec4f {
  let n = S.wx0.w;
  var uv = (xz - vec2f(S.wx0.x)) / S.wx0.y;
  uv = clamp(uv, vec2f(0.5 / n), vec2f(1.0 - 0.5 / n));
  let a = textureSampleLevel(tWx, sClamp, vec2f(uv.x, (t + uv.y) / 6.0), 0.0);
  let b = textureSampleLevel(tWx, sClamp, vec2f(uv.x, (t + 3.0 + uv.y) / 6.0), 0.0);
  return mix(a, b, S.wx0.z);
}

// @@SKY-ENTRY  (render/sky.js cuts the library at this line)

@group(3) @binding(0) var outLut: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn csTrans(@builtin(global_invocation_id) id: vec3u) {
  let sz = textureDimensions(outLut);
  if (id.x >= sz.x || id.y >= sz.y) { return; }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(sz);
  let rm = sk_uvTrans(uv);
  let ro = vec3f(0.0, rm.x, 0.0);
  let rd = vec3f(sqrt(max(0.0, 1.0 - rm.y * rm.y)), rm.y, 0.0);
  let tTop = max(sk_raySphere(ro, rd, S.radii.y).y, 0.0);
  let n = 40;
  let dt = tTop / f32(n);
  var tau = vec3f(0.0);
  for (var i = 0; i < n; i++) {
    let x = ro + rd * ((f32(i) + 0.5) * dt);
    tau += sk_medium(length(x) - S.radii.x).ext * dt;
  }
  textureStore(outLut, id.xy, vec4f(exp(-tau), 1.0));
}

var<workgroup> shL: array<vec3f, 64>;
var<workgroup> shF: array<vec3f, 64>;

// Psi_ms (Hillaire 2020 sec. 5.5), adapted from pages/forge/shaders/atmo-lut.wgsl.
@compute @workgroup_size(64)
fn csMulti(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let sz = textureDimensions(outLut);
  let uv = (vec2f(wg.xy) + 0.5) / vec2f(sz);
  let muS = uv.x * 2.0 - 1.0;
  let r = S.radii.x + uv.y * (S.radii.y - S.radii.x) + 0.01;
  let ro = vec3f(0.0, r, 0.0);
  let sun = vec3f(sqrt(max(0.0, 1.0 - muS * muS)), muS, 0.0);
  let fi = f32(li) + 0.5;
  let z = 1.0 - 2.0 * fi / 64.0;
  let a = fi * 2.39996323;
  let rs = sqrt(max(0.0, 1.0 - z * z));
  let rd = vec3f(rs * cos(a), z, rs * sin(a));
  let tTop = sk_raySphere(ro, rd, S.radii.y).y;
  let tGnd = sk_raySphere(ro, rd, S.radii.x);
  let hitG = tGnd.x > 0.0;
  let tMax = select(tTop, tGnd.x, hitG);
  let n = 20;
  let dt = tMax / f32(n);
  var T = vec3f(1.0);
  var L = vec3f(0.0);
  var F = vec3f(0.0);
  for (var i = 0; i < n; i++) {
    let x = ro + rd * ((f32(i) + 0.5) * dt);
    let rx = length(x);
    let m = sk_medium(rx - S.radii.x);
    let mu = dot(x / rx, sun);
    let Ssun = sk_transmittance(rx, mu) * (m.sR + m.sM) / (4.0 * SK_PI);
    let ext = max(m.ext, vec3f(1e-7));
    let Ts = exp(-ext * dt);
    L += T * (Ssun - Ssun * Ts) / ext;
    let ms = m.sR + m.sM;
    F += T * (ms - ms * Ts) / ext;
    T *= Ts;
  }
  if (hitG) {
    let xg = ro + rd * tMax;
    let mu = dot(normalize(xg), sun);
    L += T * sk_transmittance(S.radii.x, mu) * max(mu, 0.0) * vec3f(0.12, 0.13, 0.1) / SK_PI;
  }
  shL[li] = L / 64.0;
  shF[li] = F / 64.0;
  workgroupBarrier();
  var s = 32u;
  // bounded: s halves from 32 to 0 (6 trips)
  loop {
    if (s == 0u) { break; }
    if (li < s) { shL[li] += shL[li + s]; shF[li] += shF[li + s]; }
    workgroupBarrier();
    s = s / 2u;
  }
  if (li == 0u) {
    let psi = shL[0] / max(vec3f(1.0) - shF[0], vec3f(1e-3));
    textureStore(outLut, wg.xy, vec4f(psi, 1.0));
  }
}

// The sky-view LUT: single scattering + Psi_ms along 32 steps, for the
// camera height and sun of this frame, per unit solar illuminance.
@compute @workgroup_size(8, 8)
fn csSkyView(@builtin(global_invocation_id) id: vec3u) {
  let sz = textureDimensions(outLut);
  if (id.x >= sz.x || id.y >= sz.y) { return; }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(sz);
  let r = S.radii.w;
  let vh = sqrt(max(r * r - S.radii.x * S.radii.x, 0.0));
  let beta = acos(clamp(vh / r, -1.0, 1.0));
  let zha = SK_PI - beta;
  var vz: f32;
  if (uv.y < 0.5) {
    let c = 1.0 - uv.y * 2.0;
    vz = zha * (1.0 - c * c);
  } else {
    let c = uv.y * 2.0 - 1.0;
    vz = zha + beta * c * c;
  }
  let cosAz = 1.0 - 2.0 * uv.x * uv.x;
  let sinAz = sqrt(max(0.0, 1.0 - cosAz * cosAz));
  let muS = G.sunDir.y;
  let sun = vec3f(sqrt(max(0.0, 1.0 - muS * muS)), muS, 0.0);
  let sv = sin(vz);
  let rd = vec3f(sv * cosAz, cos(vz), sv * sinAz);
  let ro = vec3f(0.0, r, 0.0);
  let tTop = sk_raySphere(ro, rd, S.radii.y);
  let tG = sk_raySphere(ro, rd, S.radii.x);
  if (tTop.y < 0.0) { textureStore(outLut, id.xy, vec4f(0.0)); return; }
  var tMax = tTop.y;
  if (tG.x > 0.0) { tMax = tG.x; }
  tMax = min(tMax, 900.0);
  let c = dot(rd, sun);
  let pR = sk_phaseR(c);
  let pM = sk_phaseM(c, S.mieA.w);
  let n = 32;
  var T = vec3f(1.0);
  var L = vec3f(0.0);
  var tPrev = 0.0;
  for (var i = 0; i < n; i++) {
    // quadratic step spacing, dense near the camera
    let f = (f32(i) + 0.3) / f32(n);
    let t = tMax * f * f;
    let dt = t - tPrev;
    tPrev = t;
    let x = ro + rd * t;
    let rx = length(x);
    let m = sk_medium(rx - S.radii.x);
    let mu = dot(x / rx, sun);
    let Ts = sk_transmittance(rx, mu);
    let ms = sk_multi(rx, mu);
    let Sc = (m.sR * pR + m.sM * pM) * Ts + (m.sR + m.sM) * ms;
    let ext = max(m.ext, vec3f(1e-7));
    let Tstep = exp(-ext * dt);
    L += T * (Sc - Sc * Tstep) / ext;
    T *= Tstep;
  }
  textureStore(outLut, id.xy, vec4f(L, 1.0));
}

// ── night sky (after pages/forge/shaders/sky.wgsl) ───────────────────────────
fn sk_blackbody(Tk: f32) -> vec3f {
  let t = Tk / 100.0;
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
fn sk_face(d: vec3f) -> vec3f {
  let a = abs(d);
  if (a.x >= a.y && a.x >= a.z) { return vec3f(select(1.0, 0.0, d.x > 0.0), d.y / a.x * 0.5 + 0.5, d.z / a.x * 0.5 + 0.5); }
  if (a.y >= a.z) { return vec3f(select(3.0, 2.0, d.y > 0.0), d.x / a.y * 0.5 + 0.5, d.z / a.y * 0.5 + 0.5); }
  return vec3f(select(5.0, 4.0, d.z > 0.0), d.x / a.z * 0.5 + 0.5, d.y / a.z * 0.5 + 0.5);
}
fn sk_faceDir(face: f32, uv: vec2f) -> vec3f {
  let q = uv * 2.0 - 1.0;
  let s = select(-1.0, 1.0, fract(face * 0.5) < 0.25);
  let f = u32(face) / 2u;
  if (f == 0u) { return normalize(vec3f(s, q.x, q.y)); }
  if (f == 1u) { return normalize(vec3f(q.x, s, q.y)); }
  return normalize(vec3f(q.x, q.y, s));
}
fn sk_starLayer(d: vec3f, n: f32, keep: f32, mBright: f32, pxAng: f32, salt: f32) -> vec3f {
  let fu = sk_face(d);
  let c = floor(fu.yz * n);
  let h = sk_hash3(vec3f(c, fu.x * 17.0 + salt));
  if (h.z > keep) { return vec3f(0.0); }
  let h2 = sk_hash3(vec3f(c.yx + 91.0, fu.x * 5.0 + salt + 3.0));
  let sd = sk_faceDir(fu.x, (c + 0.25 + 0.5 * h.xy) / n);
  let ang = length(cross(d, sd));
  let sig = 0.7 * pxAng;
  let m = max(mBright, 9.5 + log(max(h2.x, 1e-6)) / (0.45 * 2.302585));
  let flux = 0.5 * pow(10.0, -0.4 * m);
  let Tk = mix(3100.0, 7200.0, h2.y * h2.y) + select(0.0, 14000.0 * h2.z, h2.y > 0.93);
  let tint = mix(vec3f(1.0), sk_blackbody(Tk), 0.75);
  return tint * flux * exp(-0.5 * ang * ang / (sig * sig));
}
const SK_GAL_N: vec3f = vec3f(0.4885, 0.8507, -0.1937);
const SK_GAL_C: vec3f = vec3f(-0.8549, 0.4157, -0.3104);
fn sk_milkyWay(d: vec3f, oct: i32) -> vec3f {
  let b = dot(d, SK_GAL_N);
  let band = exp(-b * b / 0.022);
  if (band < 0.01) { return vec3f(0.0); }
  let bulge = exp(-pow(acos(clamp(dot(d, SK_GAL_C), -1.0, 1.0)) / 0.55, 2.0));
  let cloud = sk_fbm(d * 6.0, oct) * 0.5 + 0.5;
  let lane = sk_ss(0.08, 0.0, abs(b + 0.025 * sk_fbm(d * 9.0 + 4.0, oct))) * sk_ss(0.35, 0.65, sk_fbm(d * 13.0 + 9.0, oct) * 0.5 + 0.5);
  let glow = band * (0.35 + 0.9 * cloud * cloud) * (1.0 + 2.5 * bulge) * (1.0 - 0.8 * lane);
  return glow * mix(vec3f(0.62, 0.66, 0.8), vec3f(1.0, 0.84, 0.64), bulge) * 0.0011;
}
// The star sphere turns round the celestial pole: the pole is at the
// latitude above the north point (-z).
fn sk_celestial(d: vec3f) -> vec3f {
  let lat = S.misc.x;
  // tilt so the pole is +y, then spin by the sidereal angle
  let cl = cos(SK_PI * 0.5 - lat);
  let sl = sin(SK_PI * 0.5 - lat);
  let q = vec3f(d.x, d.y * cl - d.z * sl, d.y * sl + d.z * cl);
  let a = S.sun.z;
  return vec3f(q.x * cos(a) - q.z * sin(a), q.y, q.x * sin(a) + q.z * cos(a));
}

// The sun disc radiance along d (0 off the disc). Limb darkening and
// granulation after forge sky_sun.
fn sk_sunDisc(d: vec3f, s: vec3f) -> vec3f {
  let r = S.sun.x;
  let c = dot(d, s);
  let x = acos(clamp(c, -1.0, 1.0)) / r;
  if (x > 1.0) { return vec3f(0.0); }
  let mu = sqrt(max(1.0 - x * x, 0.0));
  let limb = 1.0 - 0.6 * (1.0 - mu);
  var e = cross(s, vec3f(0.0, 1.0, 0.0));
  if (dot(e, e) < 1e-6) { e = vec3f(1.0, 0.0, 0.0); }
  e = normalize(e);
  let nn = cross(e, s);
  let q = normalize(e * (dot(d, e) / r) + nn * (dot(d, nn) / r) + s * mu);
  let w = sk_worley(q * 14.0 + vec3f(S.misc.z * 0.004));
  let gran = sk_ss(0.0, 0.5, w.y - w.x);
  let edge = sk_ss(1.0, 0.92, x);
  return vec3f(1.0, 0.96, 0.9) * limb * (0.9 + 0.1 * gran) * edge * 900.0;
}

// The moon: a sphere of 0.26 deg lit by the sun direction.
fn sk_moon(d: vec3f, m: vec3f) -> vec4f {
  let r = 0.0047;
  let c = dot(d, m);
  let x = acos(clamp(c, -1.0, 1.0)) / r;
  if (x > 1.0) { return vec4f(0.0); }
  var e = cross(m, vec3f(0.0, 1.0, 0.0));
  if (dot(e, e) < 1e-6) { e = vec3f(1.0, 0.0, 0.0); }
  e = normalize(e);
  let nn = cross(e, m);
  let lx = dot(d, e) / r;
  let ly = dot(d, nn) / r;
  let mu = sqrt(max(1.0 - lx * lx - ly * ly, 0.0));
  // surface normal toward the viewer is -m
  let n = normalize(e * lx + nn * ly - m * mu);
  let lit = max(dot(n, G.sunDir.xyz), 0.0);
  let mare = sk_ss(0.1, 0.5, sk_fbm(n * 3.0 + vec3f(5.0), 4) * 0.5 + 0.5);
  let crater = sk_worley(n * 9.0).x;
  let albedo = (0.17 - 0.09 * mare) * (0.85 + 0.3 * sk_ss(0.05, 0.4, crater));
  let earthshine = 0.004;
  let edge = sk_ss(1.0, 0.9, x);
  return vec4f(vec3f(1.0, 0.97, 0.92) * albedo * (lit * 9.0 + earthshine) * edge, edge);
}

// ── the full sky radiance along world direction d from camera point ro ──
fn skyRadiance(d: vec3f, ro: vec3f, pxAng: f32) -> vec3f {
  let r = S.radii.w;
  let uv = sk_skyViewUV(r, d, G.sunDir.xyz);
  var L = textureSampleLevel(tSkyView, sClamp, uv, 0.0).rgb * S.sun.y;
  // moonlit sky: a faint blue Rayleigh glow
  let mc = dot(d, S.moon.xyz);
  L += S.moon.w * vec3f(0.12, 0.22, 0.5) * (0.3 + 0.7 * sk_ss(-0.2, 0.9, S.moon.y)) * (1.0 + 0.75 * mc * mc) * 0.15;
  // airglow at the horizon
  L += vec3f(0.0006, 0.0008, 0.0011) * (0.4 + 0.6 * exp(-max(d.y, 0.0) * 6.0));
  if (d.y > -0.02) {
    let Tv = sk_transmittance(r, max(d.y, 0.0));
    let night = S.sun.w;
    if (night > 0.001) {
      let cd = sk_celestial(d);
      let q = G.frame.z;
      let oct = select(4, 3, q < 0.6);
      var st = sk_milkyWay(cd, oct);
      st += sk_starLayer(cd, 180.0, 0.9, -1.0, pxAng, 1.0);
      let near = clamp(dot(st, vec3f(400.0)), 0.0, 1.0);
      st += sk_starLayer(cd, 520.0, 0.25 + 0.55 * near, 5.5, pxAng, 7.0);
      L += st * Tv * night * sk_ss(-0.02, 0.06, d.y);
    }
    let sunT = sk_transmittance(r, G.sunDir.y);
    L += sk_sunDisc(d, G.sunDir.xyz) * sunT * S.sun.y * 0.05;
    // the moon is behind the air: add it (it hides only the stars, which
    // are faint next to it)
    let mo = sk_moon(d, S.moon.xyz);
    if (mo.w > 0.0) {
      // dimmer than nature, so the maria read at a night exposure
      L += mo.rgb * Tv * 0.07 * sk_ss(-0.01, 0.02, S.moon.y);
    }
  }
  return L;
}

struct SkyVOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f }

@vertex
fn vsSky(@builtin(vertex_index) vi: u32) -> SkyVOut {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o: SkyVOut;
  o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}

@fragment
fn fsSky(i: SkyVOut) -> @location(0) vec4f {
  let d = viewRay(i.uv);
  let pxAng = 2.0 / (G.proj[1][1] * G.screen.y);
  let L = skyRadiance(d, G.camPos.xyz, pxAng);
  return vec4f(L, 1.0);
}
