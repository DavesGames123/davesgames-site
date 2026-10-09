// ============================================================================
//  PLANET FORGE  ·  planet.wgsl — the view: one full-screen pass
//  (atmo-common.wgsl is prepended by render.js)
// ----------------------------------------------------------------------------
//  Everything is ray-traced in the planet's body frame (radius 1), so the
//  silhouette is exact and no mesh is needed:
//    1. ray from the camera; hits on the planet, the cloud shell, the
//       atmosphere shell (1 + H / R) and the ring plane (y = 0)
//    2. surface: PBR from the maps (GGX specular + Lambert, F0 = 0.08 s),
//       normal mapping in the east/north/up frame, AO, emissive (city
//       lights only at night), sun through the transmittance LUT, cloud
//       shadows (the sun ray meets the cloud shell), ring shadows, cast
//       shadows of the relief at a low sun (rocky worlds, fn terrainShadow)
//    3. clouds: the shell over the surface. One deck and one cirrus layer
//       from the evolving cloud map (clouds.wgsl, tDyn), sampled once each
//       (the old two-phase flow map drew every cloud twice). Lit by the
//       sun, self-shadowed toward the sun, shadows on the ground where the
//       sun ray meets the shell
//    4. atmosphere: single scattering ray-march from the camera to the
//       surface (aerial perspective) or through the limb, with the
//       multiple-scattering LUT and the planet shadow (terminator glow)
//    5. rings in front of or behind the planet, shadowed by the planet
//    6. the background (sky.wgsl: stars, Milky Way, the sun disc and
//       corona, all in the world frame), exposure, ACES, sRGB, dither
//  Texture coordinates come from the body-frame direction in the
//  THREE.SphereGeometry layout. Gradients for the mip level are taken in
//  uniform control flow, wrapped at the date line (no seam line) and
//  scaled by sin(colatitude) in u (fn poleGrad: no smeared pole cap).
//
//  TERMINATOR  the sun is a disc (V.bw0.w): sunVis is the share of it over
//  the horizon of a point, which dips with height, so the cloud deck keeps
//  the sun past the ground terminator and loses it by a red fade (sun rays
//  that graze the low air). Past the terminator the ground keeps a
//  twilight sky (fn twilightT); the shadow in the air has a penumbra.
//
//  GIANTS  no separate cloud field: the high haze is the band cirrus of the
//  maps (fn gasHaze), advected with the deck's flow, at the shell height;
//  zones and storms shade the lower belts near the terminator.
//
//  AURORAE  fn auroraMarch: an emission term marched through the shell
//  100-300 km up, bounded to the oval (aurora.js sets the uniforms; a
//  strength of 0 skips it).
//
//  grep -n targets: "struct View", "fn dirUV", "fn shadeSurface", "fn sunVis", "fn twilightT", "fn auroraMarch", "fn gasHaze",
//  "fn cloudsAt", "fn cloudShadow", "fn terrainShadow", "fn atmosphere", "fn ringAt", "@fragment"
// ============================================================================

struct View {
  camPos: vec4f,    // xyz camera (body frame), w time (s)
  camRight: vec4f,  // xyz, w tan(fov / 2)
  camUp: vec4f,     // xyz, w aspect
  camFwd: vec4f,    // xyz, w exposure
  sun: vec4f,       // xyz sun direction (body frame), w sun disc cos
  res: vec4f,       // width, height (px), principal point offset x, y (px)
  shell: vec4f,     // x atmosphere top (planet units), y cloud shell radius, z atmosphere steps, w emissive gain
  rings: vec4f,     // inner, outer, on, opacity
  flow: vec4f,      // x cloud drift (u per s), y gas giant flow speed, z clouds on, w gas (1) / rocky (0)
  cloudCol: vec4f,  // rgb cloud colour (linear), w ambient floor
  bw0: vec4f,       // xyz row 0 of the body -> world rotation, w sun angular radius (rad)
  bw1: vec4f,       // xyz row 1, w sun disc gain
  bw2: vec4f,       // xyz row 2, w quality (0 phone, 1 tablet, 2 desktop)
  sunW: vec4f,      // xyz sun direction (world frame), w star gain
  cloud2: vec4f,    // x deck u offset, y cirrus u offset (the slow solid drift), z cirrus opacity, w deck opacity max
  terr: vec4f,      // x relief (radii) x 0..1 height, y cast shadows on, z first march step (rad), w 0
  aur0: vec4f,      // aurora.js: xyz dipole axis (body frame), w strength (0 = off)
  aur1: vec4f,      // x oval colatitude (rad), y width (rad), z r0, w r1 (radii)
  aur2: vec4f,      // x activity, y time (sim minutes), z kind (0 oval, 1 giant, 2 crustal), w centre offset (radii)
  aurLo: vec4f,     // rgb lower edge (N2+ blue / violet)
  aurMid: vec4f,    // rgb curtain (O green / H magenta)
  aurTop: vec4f,    // rgb top (O red / violet)
}

@group(0) @binding(0) var<uniform> V: View;
@group(0) @binding(1) var<uniform> A: Atmo;
@group(0) @binding(2) var tAlbedo: texture_2d<f32>;
@group(0) @binding(3) var tNormal: texture_2d<f32>;
@group(0) @binding(4) var tMat: texture_2d<f32>;
@group(0) @binding(5) var tEmis: texture_2d<f32>;
@group(0) @binding(6) var tCloud: texture_2d<f32>;
@group(0) @binding(7) var tRing: texture_2d<f32>;
@group(0) @binding(8) var tTrans: texture_2d<f32>;
@group(0) @binding(9) var tMulti: texture_2d<f32>;
@group(0) @binding(10) var sMap: sampler;
@group(0) @binding(11) var sLut: sampler;
@group(0) @binding(12) var tDyn: texture_2d<f32>;   // clouds.wgsl: r deck, g cirrus

struct VOut { @builtin(position) pos: vec4f }

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: VOut;
  o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  return o;
}

const TAU: f32 = 6.2831853;

fn dirUV(p: vec3f) -> vec2f {
  let u = fract(atan2(p.z, -p.x) / TAU + 1.0);
  let v = acos(clamp(p.y, -1.0, 1.0)) / PI;
  return vec2f(u, v);
}

// Seam-safe gradient: a jump of about 1 in u across the date line is a wrap.
fn wrapGrad(g: vec2f) -> vec2f { return vec2f(g.x - round(g.x), g.y); }

// The gradient for the mip level at body direction p. The u step is the
// wrapped one, times sin(colatitude): near a pole a texel row is a small
// ring, the map is oversampled in u, and the raw u step (up to 0.5 across
// the pole) chose a very blurred mip and smeared the cap into radial
// streaks. The floor keeps one row of texels at the pole itself.
fn poleGrad(g: vec2f, p: vec3f, rows: f32) -> vec2f {
  let s = max(length(p.xz), 3.14159265 / rows);
  return vec2f((g.x - round(g.x)) * s, g.y);
}

// ring: x the half width in u of the pole ring average, y its weight
// (fn capRing; 0 below about 70 deg latitude)
struct Grad { dx: vec2f, dy: vec2f, ring: vec2f }

// Near a pole a map texel is a thin wedge: the u rows hold far more
// samples than the v columns, so a plain sample draws radial streaks.
// There sampleG averages 5 taps along u over the ground width of one v
// texel (at the current mip), which makes the cap isotropic.
fn sampleG(t: texture_2d<f32>, uv: vec2f, g: Grad) -> vec4f {
  let c = textureSampleGrad(t, sMap, uv, g.dx, g.dy);
  if (g.ring.y <= 0.0) { return c; }
  let d = g.ring.x;
  var a = c;
  a += textureSampleGrad(t, sMap, uv + vec2f(-d, 0.0), g.dx, g.dy);
  a += textureSampleGrad(t, sMap, uv + vec2f(d, 0.0), g.dx, g.dy);
  a += textureSampleGrad(t, sMap, uv + vec2f(-0.5 * d, 0.0), g.dx, g.dy);
  a += textureSampleGrad(t, sMap, uv + vec2f(0.5 * d, 0.0), g.dx, g.dy);
  return mix(c, a * 0.2, g.ring.y);
}

// The pole ring for body direction p, map rows H and the v gradient:
// half width 0.4 x (one v texel at the mip) / (2 sin(colatitude)) in u,
// weight 1 above 78 deg latitude, 0 below 70 deg.
fn capRing(p: vec3f, rows: f32, g: Grad) -> vec2f {
  let sT = max(length(p.xz), 3.14159265 / rows);
  let fv = max(1.0, max(abs(g.dx.y), abs(g.dy.y)) * rows);
  return vec2f(min(0.4 * fv / (2.0 * rows * sT), 0.25), smoothstep(0.35, 0.2, sT));
}

// Cubic B-spline sample of level 0 in 4 bilinear taps (Sigg and Hadwiger
// 2005). Used where the view magnifies the map past one texel per pixel:
// bilinear normals then show square facets on crater walls.
fn sampleCubic(t: texture_2d<f32>, uv: vec2f) -> vec4f {
  let sz = vec2f(textureDimensions(t, 0));
  let st = uv * sz - 0.5;
  let i = floor(st);
  let f = st - i;
  let f2 = f * f;
  let f3 = f2 * f;
  let w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  let w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  let w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  let w3 = f3 / 6.0;
  let g0 = w0 + w1;
  let g1 = w2 + w3;
  let h0 = (i - 0.5 + w1 / g0) / sz;
  let h1 = (i + 1.5 + w3 / g1) / sz;
  let a = textureSampleLevel(t, sMap, vec2f(h0.x, h0.y), 0.0);
  let b = textureSampleLevel(t, sMap, vec2f(h1.x, h0.y), 0.0);
  let c = textureSampleLevel(t, sMap, vec2f(h0.x, h1.y), 0.0);
  let d = textureSampleLevel(t, sMap, vec2f(h1.x, h1.y), 0.0);
  return g0.y * (g0.x * a + g1.x * b) + g1.y * (g0.x * c + g1.x * d);
}

// How far the view magnifies texture t at this pixel: 1 when a texel
// covers 1.5 px or more (use the cubic sample), 0 at 1 px or less.
fn magnify(t: texture_2d<f32>, g: Grad) -> f32 {
  let sz = vec2f(textureDimensions(t, 0));
  let fp = max(length(g.dx * sz), length(g.dy * sz));
  return smoothstep(1.0, 0.67, fp);
}

fn transmittance(r: f32, mu: f32) -> vec3f {
  return textureSampleLevel(tTrans, sLut, transUV(A, r, mu), 0.0).rgb;
}
fn multiScat(r: f32, muS: f32) -> vec3f {
  let uv = vec2f(muS * 0.5 + 0.5, clamp((r - A.radii.x) / (A.radii.y - A.radii.x), 0.0, 1.0));
  return textureSampleLevel(tMulti, sLut, uv, 0.0).rgb;
}

// Flow-map drift: two phases half a period apart, cross-faded, so the
// texture moves along vel without shearing without bound.
struct Flow { a: vec2f, b: vec2f, w: f32 }
fn flowUV(uv: vec2f, vel: vec2f, t: f32, period: f32) -> Flow {
  let ph0 = fract(t / period);
  let ph1 = fract(t / period + 0.5);
  var f: Flow;
  f.a = uv - vel * ph0 * period;
  f.b = uv - vel * ph1 * period;
  f.w = abs(2.0 * ph0 - 1.0);
  return f;
}

// Sun light reaching body-frame point p (radius ~1): transmittance and the
// planet's own soft shadow.
// The sun is a disc of radius V.bw0.w (rad), not a point: sunVis is the
// share of the disc above the planet's horizon seen from p. The horizon
// dips below the local level by acos(1 / |p|), so a cloud deck or the
// air above the ground keeps the sun after the ground has lost it.
fn horizonMu(p: vec3f) -> f32 {
  let r = max(length(p), 1.0);
  return -sqrt(max(1.0 - 1.0 / (r * r), 0.0));
}
fn sunVis(p: vec3f) -> f32 {
  let mu = clamp(dot(normalize(p), V.sun.xyz), -1.0, 1.0);
  let a = max(V.bw0.w, 0.0047);
  return smoothstep(-a, a, asin(mu) - asin(horizonMu(p)));
}

// Sun light reaching body-frame point p (radius ~1): transmittance and the
// planet's own penumbral shadow. Below the horizon the sun ray is taken
// at its grazing angle (the LUT has no ground hit).
fn sunLight(p: vec3f) -> vec3f {
  let L = V.sun.xyz;
  let up = normalize(p);
  let mu = dot(up, L);
  let vis = sunVis(p);
  if (A.ground.w < 0.5) { return vec3f(vis); }
  let r = max(length(p) * A.radii.x, A.radii.x + 0.01);
  // a sun ray that passes the ground at a tangent height ht (km) crosses
  // the dense, dusty low air: it fades out before ht reaches 0, so a high
  // cloud loses the sun by a long red fade, not at a line
  let ht = r * sqrt(max(1.0 - mu * mu, 0.0)) - A.radii.x;
  let low = select(1.0, smoothstep(0.0, 1.5 * A.rayleigh.w, ht), mu < 0.0);
  return transmittance(r, max(mu, horizonMu(p) + 0.002)) * vis * low;
}

// Twilight: past the terminator the ground still sees the air above it
// lit by the sun. The earth's shadow stands hs = R (1 / cos(d) - 1) high
// for a sun d below the horizon; the sunlit air above hs scatters with
// the column density exp(-hs / H), and its light came along the grazing
// path at hs (transmittance at mu = 0, so it is red at first, then blue
// through the ozone at depth). At d = 0 this equals the day value of
// transmittance(R, 0), so the day and the twilight join.
fn twilightT(mu: f32) -> vec3f {
  let R = A.radii.x;
  let d = max(-asin(clamp(mu, -1.0, 1.0)), 0.0);
  let hs = min(R * (1.0 / cos(min(d, 1.2)) - 1.0), A.radii.y - R);
  let col = exp(-hs / max(A.rayleigh.w, 0.1)) * 0.85 + exp(-hs / max(A.mieS.w, 0.1)) * 0.15;
  return transmittance(R + hs + 0.01, 0.0) * col;
}

fn ringAt(r: f32) -> vec4f {
  let u = (r - V.rings.x) / max(V.rings.y - V.rings.x, 1e-3);
  if (u < 0.0 || u > 1.0 || V.rings.z < 0.5) { return vec4f(0.0); }
  return textureSampleLevel(tRing, sMap, vec2f(u, 0.5), 0.0);
}

// Ring shadow on a point p: the sun ray meets the ring plane.
fn ringShadow(p: vec3f) -> f32 {
  let L = V.sun.xyz;
  if (V.rings.z < 0.5 || abs(L.y) < 1e-4) { return 1.0; }
  let t = -p.y / L.y;
  if (t <= 0.0) { return 1.0; }
  let q = p + L * t;
  return 1.0 - ringAt(length(q.xz)).a * 0.9;
}

// The deck cover (clouds.wgsl, 0..1) to the rendered opacity: thin cloud
// lets most of the ground through, the thickest stays V.cloud2.w opaque.
fn cloudOpacity(a: f32) -> f32 { return V.cloud2.w * pow(clamp(a, 0.0, 1.0), 1.5); }

// The evolving cloud map at body-frame direction q: x deck, y cirrus.
// The u offsets carry the slow solid drift of each layer.
fn cloudsAt(q: vec3f) -> vec2f {
  let uv = dirUV(q);
  let d = textureSampleLevel(tDyn, sMap, uv + vec2f(V.cloud2.x, 0.0), 0.0).r;
  let c = textureSampleLevel(tDyn, sMap, uv + vec2f(V.cloud2.y, 0.0), 0.0).g;
  return vec2f(d, c);
}

// Giants: the high haze (the band cirrus in tCloud.r, gas.js / gasx.js),
// advected by the same flow map and phases as the deck (shadeSurface),
// so it stays on its band and never slides over the belts as a copy.
// The haze is soft: it is sampled 4 times wider than the deck (a
// coarser mip), so thin streaks read as a veil, not as bright threads.
fn gasHaze(uv: vec2f, g: Grad) -> f32 {
  let fl = sampleG(tCloud, uv, g);
  let vel = vec2f((fl.g - 0.5) * 2.0, (fl.b - 0.5) * 2.0) * V.flow.y;
  let f = flowUV(uv, vel, V.camPos.w, 30.0);
  var gw = g;
  gw.dx = g.dx * 4.0;
  gw.dy = g.dy * 4.0;
  return mix(sampleG(tCloud, f.a, gw).r, sampleG(tCloud, f.b, gw).r, f.w);
}
fn gasHazeL(q: vec3f) -> f32 {
  let uv = dirUV(q);
  let fl = textureSampleLevel(tCloud, sMap, uv, 1.0);
  let vel = vec2f((fl.g - 0.5) * 2.0, (fl.b - 0.5) * 2.0) * V.flow.y;
  let f = flowUV(uv, vel, V.camPos.w, 30.0);
  return mix(textureSampleLevel(tCloud, sMap, f.a, 1.0).r, textureSampleLevel(tCloud, sMap, f.b, 1.0).r, f.w);
}

// Cloud shadow at surface point p: the sun ray meets the cloud shell, one
// sample at that point (so the shadow is offset by the sun and the height).
fn cloudShadow(p: vec3f) -> f32 {
  if (V.flow.z < 0.5) { return 1.0; }
  let L = V.sun.xyz;
  let t = raySphere(p, L, V.shell.y).y;
  if (t <= 0.0) { return 1.0; }
  let q = normalize(p + L * t);
  if (V.flow.w > 0.5) { return 1.0 - 0.3 * gasHazeL(q) * V.cloud2.z; }
  let c = cloudsAt(q);
  return (1.0 - 0.85 * cloudOpacity(c.x) / max(V.cloud2.w, 1e-3)) * (1.0 - 0.3 * c.y * V.cloud2.z);
}

// Cast shadows of the relief on rocky worlds. From p the march goes toward
// the sun over the height map (the normal map alpha, 8 bits); the sun ray
// rises s tan(e) and the ground falls away s^2 / 2 (curvature), both in
// radii, so a low sun lays long shadows behind ridges, rims and shields.
// The band of -0.012..-0.002 (about 1..3 height steps) hides the 8-bit
// steps. Steps: 10 on a phone, 14 on a tablet, 18 on a desktop.
// mg (magnify): above 0 the start height and the first 4 steps use the
// cubic sample, so a magnified shadow edge is not a texel staircase.
fn terrainShadow(p: vec3f, uv: vec2f, mg: f32) -> f32 {
  if (V.terr.y < 0.5) { return 1.0; }
  let up = normalize(p);
  let L = V.sun.xyz;
  let mu = dot(up, L);
  if (mu <= -0.02 || mu > 0.45) { return 1.0; }
  let t = normalize(L - up * mu + vec3f(1e-6, 0.0, 0.0));
  let tanE = max(mu, 0.0) / sqrt(max(1.0 - mu * mu, 1e-6));
  var h0 = textureSampleLevel(tNormal, sMap, uv, 0.0).a;
  if (mg > 0.0) { h0 = mix(h0, sampleCubic(tNormal, uv).a, mg); }
  let n = 10 + 4 * i32(V.bw2.w);
  var s = V.terr.z;
  var lit = 1.0;
  for (var i = 0; i < 18; i++) {
    if (i >= n) { break; }
    let q = normalize(up + t * s);
    let uq = dirUV(q);
    var h = textureSampleLevel(tNormal, sMap, uq, 0.0).a;
    if (mg > 0.0 && i < 4) { h = mix(h, sampleCubic(tNormal, uq).a, mg); }
    let ray = h0 + (s * tanE + 0.5 * s * s) / V.terr.x;
    // penumbra: the sun disc (radius bw0.w) widens the shadow edge with
    // the distance s to the occluder, so edges far from a ridge are soft
    let pen = max(0.01, s * V.bw0.w / V.terr.x);
    lit = min(lit, smoothstep(-0.002 - pen, -0.002, ray - h));
    s *= 1.32;
  }
  return mix(1.0, lit, smoothstep(0.45, 0.3, mu));
}

// Sky irradiance on the ground (a cheap fit: scattered sun over one scale
// height plus the multiple-scattering term), for the ambient light.
fn skyIrradiance(p: vec3f) -> vec3f {
  if (A.ground.w < 0.5) { return vec3f(V.cloudCol.w); }
  let up = normalize(p);
  let mu = dot(up, V.sun.xyz);
  let tauS = A.rayleigh.xyz * A.rayleigh.w + A.mieS.xyz * A.mieS.w;
  // day: the sun through the air at mu; past the terminator: twilight
  // (the twilight gets a legibility gain of 6 past the terminator: at
  // the true level it is under one sRGB step at the page exposure)
  let Ts = select(twilightT(mu) * mix(1.0, 6.0, smoothstep(0.0, -0.03, mu)), transmittance(A.radii.x + 0.01, mu), mu > 0.0);
  let ms = multiScat(A.radii.x + 0.01, mu);
  return A.radii.w * tauS * (Ts * 2.5 / (4.0 * PI) + ms * 2.0) + vec3f(V.cloudCol.w);
}

fn ggx(n: vec3f, v: vec3f, l: vec3f, rough: f32, f0: vec3f) -> vec3f {
  let h = normalize(v + l);
  let nl = max(dot(n, l), 0.0);
  let nv = max(dot(n, v), 1e-3);
  let nh = max(dot(n, h), 0.0);
  let vh = max(dot(v, h), 0.0);
  let a = max(rough * rough, 0.002);
  let a2 = a * a;
  let d = a2 / (PI * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0));
  let k = a * 0.5;
  let g = (nv / (nv * (1.0 - k) + k)) * (nl / (nl * (1.0 - k) + k));
  let f = f0 + (vec3f(1.0) - f0) * pow(1.0 - vh, 5.0);
  return d * g * f / (4.0 * nv * max(nl, 1e-3));
}

fn shadeSurface(p: vec3f, rd: vec3f, uvIn: vec2f, g: Grad) -> vec3f {
  var uv = uvIn;
  // no cubic sample on the pole caps (the ring average serves there)
  let mg = select(magnify(tNormal, g), 0.0, V.flow.w > 0.5) * (1.0 - g.ring.y);
  var alb: vec3f;
  var nT: vec3f;
  var mat: vec4f;
  var gfa = uv;
  var gfb = uv;
  var gfw = 0.0;
  var gh = 0.0;
  if (V.flow.w > 0.5) {
    // gas giant: the cloud deck flows along the zonal wind of the flow map
    let fl = sampleG(tCloud, uv, g);
    let vel = vec2f((fl.g - 0.5) * 2.0, (fl.b - 0.5) * 2.0) * V.flow.y;
    let f = flowUV(uv, vel, V.camPos.w, 30.0);
    alb = mix(sampleG(tAlbedo, f.a, g).rgb, sampleG(tAlbedo, f.b, g).rgb, f.w);
    let na = sampleG(tNormal, f.a, g);
    let nb = sampleG(tNormal, f.b, g);
    nT = mix(na.xyz, nb.xyz, f.w) * 2.0 - 1.0;
    gfa = f.a; gfb = f.b; gfw = f.w; gh = mix(na.a, nb.a, f.w);
    mat = sampleG(tMat, uv, g);
  } else {
    alb = sampleG(tAlbedo, uv, g).rgb;
    var nS = sampleG(tNormal, uv, g);
    // magnified: a cubic sample of the normals (no square facets)
    if (mg > 0.0) { nS = mix(nS, sampleCubic(tNormal, uv), mg); }
    nT = nS.xyz * 2.0 - 1.0;
    mat = sampleG(tMat, uv, g);
  }
  let emis = sampleG(tEmis, uv, g);
  let up = normalize(p);
  var east = vec3f(up.z, 0.0, -up.x);
  if (dot(east, east) < 1e-8) { east = vec3f(1.0, 0.0, 0.0); }
  east = normalize(east);
  let north = cross(up, east);
  let n = normalize(east * nT.x + north * nT.y + up * nT.z);
  let L = V.sun.xyz;
  let v = -rd;
  let ao = mat.r;
  let rough = clamp(mat.g, 0.03, 1.0);
  let metal = mat.b;
  let f0 = mix(vec3f(0.08 * mat.a), alb, metal);
  var light = sunLight(p) * cloudShadow(p) * ringShadow(p) * terrainShadow(p, uv, mg) * A.radii.w;
  // giants: zones and storms stand higher than the belts (the height in
  // the normal map alpha). Near the terminator a deck lower than the
  // cloud tops 0.5 deg toward the sun lies in their soft shadow.
  if (V.flow.w > 0.5) {
    let mu = dot(up, L);
    if (mu < 0.4) {
      let st = 0.009;
      let du = vec2f(dot(L, east) * st / (TAU * max(length(up.xz), 0.05)), -dot(L, north) * st / PI);
      let hs = mix(textureSampleLevel(tNormal, sMap, gfa + du, 1.0).a, textureSampleLevel(tNormal, sMap, gfb + du, 1.0).a, gfw);
      let occ = smoothstep(0.0, 0.06, hs - gh) * (1.0 - smoothstep(0.05, 0.4, mu));
      light *= 1.0 - 0.45 * occ;
    }
  }
  let nl = max(dot(n, L), 0.0) * smoothstep(-0.05, 0.05, dot(up, L));
  let fd = (1.0 - f0) * (1.0 - metal) * alb / PI;
  var col = (fd + ggx(n, v, L, rough, f0)) * light * nl;
  let sky = skyIrradiance(p);
  col += sky * alb / PI * ao * (0.6 + 0.4 * dot(n, up));
  // glossy surfaces reflect the sky
  let fr = f0 + (1.0 - f0) * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  col += fr * sky / PI * (1.0 - rough) * 0.5;
  // emission: city lights fade in at dusk; lava and glow always
  let night = smoothstep(0.08, -0.12, dot(up, L));
  let e = emis.rgb * select(1.0, night, emis.a > 0.5);
  col += e * V.shell.w;
  return col;
}

struct Scat { L: vec3f, T: vec3f }

// Single scattering from ro (body frame, planet units) along rd up to tMax.
fn atmosphere(ro: vec3f, rd: vec3f, tMax: f32) -> Scat {
  var s: Scat;
  s.L = vec3f(0.0);
  s.T = vec3f(1.0);
  if (A.ground.w < 0.5) { return s; }
  let R = A.radii.x;
  let roK = ro * R;
  let hit = raySphere(roK, rd, A.radii.y);
  if (hit.y <= 0.0) { return s; }
  let t0 = max(hit.x, 0.0);
  let t1 = min(hit.y, tMax * R);
  if (t1 <= t0) { return s; }
  // a ray that ends on the ground crosses a short, smooth stretch of
  // air: half the steps (at least 10) change a pixel by at most 3 / 255
  let n = select(i32(V.shell.z), max(10, i32(V.shell.z) / 2), tMax < 1e8);
  let dt = (t1 - t0) / f32(n);
  let L = V.sun.xyz;
  let c = dot(rd, L);
  let pR = phaseR(c);
  let pM = phaseM(c, A.mieA.w);
  var T = vec3f(1.0);
  var acc = vec3f(0.0);
  for (var i = 0; i < n; i++) {
    let x = roK + rd * (t0 + (f32(i) + 0.5) * dt);
    let r = length(x);
    let m = medium(A, r - R);
    let muS = dot(x / r, L);
    // planet shadow, soft over a few km at the terminator
    let gs = raySphere(x, L, R);
    var sh = 1.0;
    if (gs.x > 0.0) {
      let b = dot(x, L);
      let dmin = sqrt(max(r * r - b * b, 0.0));
      // penumbra: the sun disc widens the shadow edge with the distance
      // to the limb that casts it
      let pw = 4.0 + max(-b, 0.0) * max(V.bw0.w, 0.0047);
      sh = smoothstep(R - pw, R + pw, dmin);
    }
    let Ts = transmittance(r, muS) * sh;
    let ms = multiScat(r, muS);
    // + the glow of a hot surface scattered by the haze (lava worlds)
    let S = A.radii.w * (m.sR * (pR * Ts + ms) + m.sM * (pM * Ts + ms)) + m.sM * A.extra.rgb;
    let ext = max(m.ext, vec3f(1e-7));
    let st = exp(-ext * dt);
    acc += T * (S - S * st) / ext;
    T *= st;
  }
  // Ground clarity (a legibility choice, A.extra.w): a ray that ends on
  // the ground keeps only part of its haze, most at the nadir, none at a
  // grazing angle, so the limb stays physical and continuous at the edge.
  if (tMax < 1e8 && A.extra.w < 0.999) {
    let pg = ro + rd * tMax;
    let mu = clamp(-dot(rd, normalize(pg)), 0.0, 1.0);
    let k = mix(A.extra.w, 1.0, pow(1.0 - mu, 3.0));
    acc *= k;
    T = pow(T, vec3f(k));
  }
  s.L = acc;
  s.T = T;
  return s;
}

// Aurorae (aurora.js gives the uniforms). An emission marched along the
// view ray through the shell r0..r1 (about 100-300 km), bounded to the
// oval: a sample farther than 4 widths from the oval costs one dot
// product. The curtains are thin sheets along the magnetic longitude:
// the oval centre folds with the longitude and drifts in time, rays are
// fine stripes across the sheet, patches pulse. Colour by height: the
// low-edge colour, the curtain colour peaking low in the shell, the top
// colour above. Thicker and brighter on the night side and round
// midnight; faint by day. Giants add a moon footprint and diffuse polar
// light; crustal fields give patches with no oval.
fn auroraMarch(ro: vec3f, rd: vec3f, tEnd: f32) -> vec3f {
  let r0 = V.aur1.z;
  let r1 = V.aur1.w;
  let hit = raySphere(ro, rd, r1);
  if (hit.y <= 0.0) { return vec3f(0.0); }
  let ta = max(hit.x, 0.0);
  let tb = min(hit.y, tEnd);
  if (tb <= ta) { return vec3f(0.0); }
  let ax = V.aur0.xyz;
  var perp = cross(ax, vec3f(0.0, 0.0, 1.0));
  if (dot(perp, perp) < 1e-6) { perp = vec3f(1.0, 0.0, 0.0); }
  let ctr = normalize(perp) * V.aur2.w;
  let e1 = normalize(cross(ax, normalize(perp)));
  let e2 = cross(ax, e1);
  let L = V.sun.xyz;
  let tm = V.aur2.y;
  let act = V.aur2.x;
  let kind = V.aur2.z;
  // bound: the largest |cos colatitude| at 5 points of the chord. A
  // chord that stays 4 widths (plus the folds and 0.08 rad of chord
  // curvature) equatorward of the oval has no oval light: skip it.
  // On giants the bound also takes in the moon footprint (1.45 x the
  // oval colatitude).
  let reach = max(V.aur1.x + 4.0 * V.aur1.y * 1.8, select(0.0, V.aur1.x * 1.45 + V.aur1.y, V.aur2.z > 0.5));
  var mMax = 0.0;
  var mLow = 1.0;
  for (var k = 0; k < 5; k++) {
    let xk = ro + rd * mix(ta, tb, f32(k) * 0.25);
    let mk = dot(normalize(xk - ctr), ax);
    mMax = max(mMax, abs(mk));
    mLow = min(mLow, mk);
  }
  if (V.aur2.z < 1.5 && acos(min(mMax, 1.0)) > reach + 0.11) { return vec3f(0.0); }
  // crustal patches lie on the southern magnetic hemisphere (m < 0.1)
  if (V.aur2.z > 1.5 && mLow > 0.2) { return vec3f(0.0); }
  // steps: 10 on a phone to 16 on a desktop; the soft crustal patches 6
  let n = select(10 + 3 * i32(V.bw2.w), 6, kind > 1.5);
  let dt = (tb - ta) / f32(n);
  // a sub-step jitter per pixel hides the march steps
  let jit = hash3(vec3f(rd * 917.0));
  var acc = vec3f(0.0);
  for (var i = 0; i < 16; i++) {
    if (i >= n) { break; }
    let x = ro + rd * (ta + (f32(i) + jit) * dt);
    let r = length(x);
    let h = (r - r0) / (r1 - r0);
    if (h < -0.08 || h > 1.0) { continue; }
    let q = normalize(x - ctr);
    let m = dot(q, ax);
    let colat = acos(clamp(abs(m), 0.0, 1.0));
    if (kind < 0.5 && abs(colat - V.aur1.x) > 4.0 * V.aur1.y * 1.8 + 0.05) { continue; }
    if (kind > 0.5 && kind < 1.5 && colat > reach + 0.05) { continue; }
    let phi = atan2(dot(q, e2), dot(q, e1));
    // night side and the midnight sector (the sun direction at the point)
    let sunUp = dot(normalize(x), L);
    let night = smoothstep(0.25, -0.35, sunUp);
    let w = V.aur1.y * (1.0 + 0.8 * night);
    // the oval centre folds with the longitude and drifts (curtain folds)
    let fold = 0.018 * sin(phi * 5.0 + tm * 0.11 + 2.0 * sin(phi * 2.0 - tm * 0.05)) + 0.009 * sin(phi * 13.0 - tm * 0.23);
    let c0 = V.aur1.x + fold + 0.02 * night;
    let d = (colat - c0) / w;
    var mask = 0.0;
    if (kind > 1.5) {
      // crustal fields: patches on one hemisphere, no oval
      let pn = sin(dot(q, vec3f(7.1, 3.3, 5.7)) + tm * 0.02) * sin(dot(q, vec3f(-4.3, 8.9, 2.1)) - tm * 0.015);
      mask = smoothstep(0.35, 0.8, pn) * smoothstep(0.1, -0.4, m) * 0.8;
    } else {
      if (abs(d) > 4.0 && !(kind > 0.5 && colat < c0)) { continue; }
      mask = exp(-d * d);
      if (kind > 0.5) {
        // giants: diffuse polar light inside the oval, and a moon
        // footprint spot with a trail, equatorward of the oval
        mask += 0.18 * smoothstep(c0, c0 * 0.4, colat) * (0.6 + 0.4 * sin(phi * 3.0 + tm * 0.07));
        let fl = tm * 0.004;
        let dphi = atan2(sin(phi - fl), cos(phi - fl));
        let fc = (colat - c0 * 1.45) / (0.25 * w);
        mask += 1.6 * exp(-fc * fc) * (exp(-dphi * dphi / 0.002) + 0.4 * exp(-max(dphi, 0.0) * 8.0) * step(0.0, dphi));
      }
    }
    // rays: fine stripes across the sheet that shimmer; pulsating patches
    let rays = 0.55 + 0.45 * pow(0.5 + 0.5 * sin(phi * 90.0 + 6.0 * sin(phi * 9.0 + tm * 0.3) + tm * 0.9), 3.0);
    let pulse = 0.75 + 0.25 * sin(tm * 0.6 + phi * 4.0 + 3.0 * sin(phi * 1.7));
    // the sheet: a sharp lower edge that wanders, a slow fade upward
    let edge = 0.03 * sin(phi * 31.0 + tm * 0.4);
    let lo = exp(-pow((h - 0.02 - edge) / 0.045, 2.0));
    let mid = exp(-pow((h - 0.16 - edge) / 0.14, 2.0)) * smoothstep(-0.05, 0.03, h - edge);
    let top = smoothstep(0.3, 0.6, h) * smoothstep(1.0, 0.75, h);
    let e = V.aurLo.rgb * (0.45 * lo) + V.aurMid.rgb * mid + V.aurTop.rgb * (0.4 * top * (0.6 + 0.6 * act));
    let lit = mix(0.12, 1.0, night);
    acc += e * (mask * rays * pulse * lit * dt / (r1 - r0));
  }
  return acc * V.aur0.w * 0.12;
}

fn hash3(p: vec3f) -> f32 {
  var q = fract(p * vec3f(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yxz + 33.33);
  return fract((q.x + q.y) * q.z);
}

fn aces(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}
fn toSRGB(c: vec3f) -> vec3f {
  return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308));
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let px = in.pos.xy;
  let ndc = vec2f((px.x - V.res.z) / V.res.x * 2.0 - 1.0, 1.0 - (px.y - V.res.w) / V.res.y * 2.0);
  let th = V.camRight.w;
  let rd = normalize(V.camFwd.xyz + V.camRight.xyz * ndc.x * th * V.camUp.w + V.camUp.xyz * ndc.y * th);
  let ro = V.camPos.xyz;

  // planet and cloud hits; the texture point is taken for every pixel
  // (closest approach when the ray misses), so the gradients below are in
  // uniform control flow and stay smooth at the silhouette
  let hp = raySphere(ro, rd, 1.0);
  let tca = max(-dot(ro, rd), 0.0);
  let pS = select(normalize(ro + rd * tca), normalize(ro + rd * hp.x), hp.x > 0.0);
  let uvS = dirUV(pS);
  var gS: Grad;
  let rowsS = f32(textureDimensions(tAlbedo, 0).y);
  gS.dx = poleGrad(dpdx(uvS), pS, rowsS);
  gS.dy = poleGrad(dpdy(uvS), pS, rowsS);
  gS.ring = vec2f(0.0);
  gS.ring = capRing(pS, rowsS, gS);
  let hc = raySphere(ro, rd, V.shell.y);
  let pC = select(normalize(ro + rd * tca), normalize(ro + rd * hc.x), hc.x > 0.0);
  let uvC = dirUV(pC);
  var gC: Grad;
  let rowsC = f32(textureDimensions(tDyn, 0).y);
  gC.dx = poleGrad(dpdx(uvC), pC, rowsC);
  gC.dy = poleGrad(dpdy(uvC), pC, rowsC);
  gC.ring = vec2f(0.0);
  gC.ring = capRing(pC, rowsC, gC);

  let L = V.sun.xyz;
  let cs = dot(rd, L);
  // the background in the world frame (sky.wgsl): stars stay fixed while
  // the planet spins; the sun disc has a true angular size
  let rdW = vec3f(dot(V.bw0.xyz, rd), dot(V.bw1.xyz, rd), dot(V.bw2.xyz, rd));
  let pxAngle = 2.0 * th / V.res.y;
  let planetHit = hp.x > 0.0;
  // planet cover of this pixel (the soft silhouette edge below). Where the
  // planet covers the pixel fully, the background is not seen, so the
  // stars, the Milky Way and the sun are not computed (same pixels).
  // The cover is a box filter of one pixel across the edge, on both
  // sides: a pixel whose centre just misses the sphere is still part
  // covered. (It was 0 there, so the ramp was half a pixel wide and the
  // silhouette showed a 1-px staircase.)
  let dEdge = (1.0 - length(ro + rd * tca)) / max(tca * pxAngle, 1e-5);
  let cover = select(0.0, clamp(dEdge + 0.5, 0.0, 1.0), tca > 0.0 && dot(ro, ro) > 1.0);
  let edgeHit = cover > 0.0;
  var col = vec3f(0.0);
  if (cover < 1.0) {
    col = skyColor(rdW, pxAngle, V.bw2.w) * V.sunW.w;
    let sun = sky_sun(rdW, V.sunW.xyz, V.bw0.w, V.camPos.w, V.bw1.w, 0.35);
    col += sun.col;
  }

  // ring plane hit
  var ringT = -1.0;
  var ring = vec4f(0.0);
  if (V.rings.z > 0.5 && abs(rd.y) > 1e-5) {
    let t = -ro.y / rd.y;
    if (t > 0.0) {
      let q = ro + rd * t;
      let rr = length(q.xz);
      ring = ringAt(rr);
      if (ring.a > 0.002) {
        ringT = t;
        // planet shadow on the ring
        let b = dot(q, L);
        let dmin = sqrt(max(dot(q, q) - b * b, 0.0));
        let sh = select(1.0, smoothstep(0.97, 1.03, dmin), b < 0.0);
        let lit = select(0.25 * (1.0 - ring.a), 1.0, sign(L.y) == sign(ro.y));
        let ph = 0.6 + 0.8 * pow(max(-cs, 0.0), 3.0);
        ring = vec4f(ring.rgb * A.radii.w / PI * abs(L.y) * sh * lit * ph * 1.6 + ring.rgb * 0.004, ring.a * V.rings.w);
      }
    }
  }
  let topT = raySphere(ro, rd, V.shell.x);
  // ring behind the planet's atmosphere (or no planet in the way)
  if (ringT > 0.0 && !planetHit && (topT.y < 0.0 || ringT > topT.y)) { col = mix(col, ring.rgb, ring.a); }

  var tEnd = 1e9;
  if (edgeHit) {
    tEnd = select(1e9, hp.x, planetHit);
    var surf = shadeSurface(pS, rd, uvS, gS);
    // the cloud deck in front of the surface: one map sample (no flow
    // phases, so no double image), lit by the sun, darkened where the
    // cloud toward the sun is thick (self-shadow), then the thin cirrus
    if (V.flow.z > 0.5 && hc.x > 0.0) {
      let up = pC;
      var c = vec2f(0.0);
      var toSun = 0.0;
      if (V.flow.w > 0.5) {
        // giants: no separate cloud field. The high haze is the band
        // cirrus of the maps, advected by the deck's own flow, at the
        // shell height (parallax from the real altitude)
        c = vec2f(0.0, gasHaze(uvC, gC));
      } else {
        c = vec2f(sampleG(tDyn, uvC + vec2f(V.cloud2.x, 0.0), gC).r, sampleG(tDyn, uvC + vec2f(V.cloud2.y, 0.0), gC).g);
        let Lt = L - up * dot(L, up);
        toSun = cloudsAt(normalize(up + Lt * 0.03)).x;
      }
      let selfSh = mix(1.0, 0.5, smoothstep(0.25, 1.0, toSun) * smoothstep(0.0, 0.6, c.x));
      // the shell sits high for parallax; the sun is taken at a real
      // deck height (at most 12 km), so the clouds catch the sun past the
      // ground terminator over a band of a few degrees, not 6
      let hC = select(V.shell.y, 1.0 + min(V.shell.y - 1.0, 12.0 / max(A.radii.x, 1.0)), A.ground.w > 0.5);
      let lightC = sunLight(pC * hC) * ringShadow(pC * V.shell.y) * A.radii.w;
      let wrap = clamp(dot(up, L) * 0.7 + 0.3, 0.0, 1.0);
      let skyC = skyIrradiance(pC) / PI;
      let cl = V.cloudCol.rgb * (lightC * wrap / PI * 0.95 * selfSh * (0.8 + 0.2 * c.x) + skyC * 0.6);
      surf = mix(surf, cl, cloudOpacity(c.x));
      let ci = V.cloudCol.rgb * (lightC * wrap / PI + skyC * 0.5);
      surf = mix(surf, ci, c.y * V.cloud2.z);
    }
    // a soft edge for airless bodies (anti-aliased silhouette)
    col = mix(col, surf, cover);
  }
  let sc = atmosphere(ro, rd, tEnd);
  col = col * sc.T + sc.L;
  // aurorae: a uniform branch, skipped when the toggle is off
  if (V.aur0.w > 0.0) { col += auroraMarch(ro, rd, tEnd); }
  // ring in front of the planet
  if (ringT > 0.0 && (!planetHit || ringT < hp.x) && !(!planetHit && (topT.y < 0.0 || ringT > topT.y))) { col = mix(col, ring.rgb, ring.a); }

  var c = aces(col * V.camFwd.w);
  c = toSRGB(c);
  // triangular dither against banding in the sky gradients
  let dn = hash3(vec3f(px, fract(V.camPos.w) * 61.0)) + hash3(vec3f(px.yx, 7.0)) - 1.0;
  c += dn / 255.0;
  return vec4f(c, 1.0);
}
