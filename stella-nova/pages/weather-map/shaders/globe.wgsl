// ============================================================================
//  WEATHER MAP  ·  globe.wgsl — the Earth: ground, night lights, ocean glint,
//  atmosphere, stars. render/globe.js joins frame.wgsl + forge
//  atmo-common.wgsl + forge sky.wgsl + this file into one module.
// ----------------------------------------------------------------------------
//  fsGlobe is one full-screen pass, ray-traced against the unit sphere (an
//  exact silhouette, no mesh). It writes the tone-mapped sRGB colour and the
//  depth of the ground hit (@builtin(frag_depth), 1 for the sky), so the
//  overlay layers that follow test against the real globe.
//    1. ground: Blue Marble day albedo (tDay, and the high-resolution US crop
//       tDetail inside G.detail), terrain normal from the height map
//       (tHeight, exaggerated), Lambert sun through the transmittance LUT
//       (forge atmo.js), sky ambient, cloud shadows and wet ground from the
//       cloud map (tCloud, r optical depth, g precip, inside G.cloudB)
//    2. ocean (tWater mask): GGX glint with Schlick Fresnel (F0 0.02) and a
//       noisy wave roughness, a Fresnel sky reflection
//    3. night lights (tNight) where the sun is down, warm near the
//       terminator, dimmed under thick cloud
//    4. atmosphere: single scattering along the view ray with forge's
//       multiple-scattering LUT and planet shadow (adapted from forge
//       planet.wgsl fn atmosphere), ground clarity for legibility
//    5. background: forge sky.wgsl stars and Milky Way (turned by the
//       sidereal angle, G.stars.xy), the sun disc in the real light mode
//    6. exposure, ACES, sRGB, dither
//  fsVeil runs after the overlay layers: a thin display-space haze at the
//  limb (premultiplied), so overlays fade into the edge like the ground.
//  mipBlit (separate module in globe.js) makes the texture mip chains.
//
//  Equirect textures: u = (lon + 180) / 360, v = (90 - lat) / 180. Crops and
//  the cloud map use the same orientation (v = 0 at the north edge lat1).
//  Gradients for the mip level are taken in uniform control flow for every
//  pixel and wrapped at the date line (no seam line).
//
//  grep -n targets: "struct Globe", "fn gl_uv", "fn gl_sunLight", "fn gl_skyIrr",
//  "fn gl_cloudAt", "fn gl_shade", "fn gl_atmos", "fn fsGlobe", "fn fsVeil"
// ============================================================================

struct Globe {
  detail: vec4f,   // lat0, lat1, lon0, lon1 of tDetail (deg)
  cloudB: vec4f,   // lat0, lat1, lon0, lon1 of tCloud (deg)
  has: vec4f,      // 1 when loaded: x day, y detail, z night, w height
  has2: vec4f,     // x water mask loaded, y cloud map set, z sun disc on, w ground clarity
  look: vec4f,     // x relief (radii per unit height), y night gain, z albedo gain, w atmosphere steps
  stars: vec4f,    // x cos(gmst), y sin(gmst), z star gain, w sun angular radius (rad)
}

@group(1) @binding(0) var<uniform> A: Atmo;
@group(1) @binding(1) var<uniform> G: Globe;
@group(1) @binding(2) var tDay: texture_2d<f32>;
@group(1) @binding(3) var tDetail: texture_2d<f32>;
@group(1) @binding(4) var tNight: texture_2d<f32>;
@group(1) @binding(5) var tHeight: texture_2d<f32>;
@group(1) @binding(6) var tWater: texture_2d<f32>;
@group(1) @binding(7) var tCloud: texture_2d<f32>;
@group(1) @binding(8) var tTrans: texture_2d<f32>;
@group(1) @binding(9) var tMulti: texture_2d<f32>;
@group(1) @binding(10) var sWrap: sampler;
@group(1) @binding(11) var sClamp: sampler;

struct VOut { @builtin(position) pos: vec4f }

@vertex
fn vsFull(@builtin(vertex_index) i: u32) -> VOut {
  var o: VOut;
  let x = f32((i << 1u) & 2u);
  let y = f32(i & 2u);
  o.pos = vec4f(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
  return o;
}

// The view ray through device pixel px.
fn gl_ray(px: vec2f) -> vec3f {
  let ndc = vec2f(px.x / F.viewport.x * 2.0 - 1.0, 1.0 - px.y / F.viewport.y * 2.0);
  let f = F.invViewProj * vec4f(ndc, 1.0, 1.0);
  return normalize(f.xyz / f.w - F.eye.xyz);
}

// Equirect uv of a unit vector.
fn gl_uv(p: vec3f) -> vec2f {
  let lon = atan2(-p.z, p.x);
  let lat = asin(clamp(p.y, -1.0, 1.0));
  return vec2f(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI);
}

// uv of a lat/lon crop with bounds b (lat0, lat1, lon0, lon1) from the
// global uv; outside = values outside 0..1.
fn gl_cropUV(uv: vec2f, b: vec4f) -> vec2f {
  let lon = uv.x * 360.0 - 180.0;
  let lat = 90.0 - uv.y * 180.0;
  return vec2f((lon - b.z) / max(b.w - b.z, 1e-3), (b.y - lat) / max(b.y - b.x, 1e-3));
}

fn gl_wrapGrad(g: vec2f) -> vec2f { return vec2f(g.x - round(g.x), g.y); }

fn gl_transmittance(r: f32, mu: f32) -> vec3f {
  return textureSampleLevel(tTrans, sClamp, transUV(A, r, mu), 0.0).rgb;
}
fn gl_multiScat(r: f32, muS: f32) -> vec3f {
  let uv = vec2f(muS * 0.5 + 0.5, clamp((r - A.radii.x) / (A.radii.y - A.radii.x), 0.0, 1.0));
  return textureSampleLevel(tMulti, sClamp, uv, 0.0).rgb;
}

// Share of the sun disc over the horizon of point p (radius ~1), times the
// transmittance of the air on the sun ray (forge planet.wgsl fn sunLight).
fn gl_sunLight(p: vec3f) -> vec3f {
  let L = F.sunDir.xyz;
  let up = normalize(p);
  let mu = dot(up, L);
  let r = max(length(p), 1.0);
  let hMu = -sqrt(max(1.0 - 1.0 / (r * r), 0.0));
  let a = max(G.stars.w, 0.0047);
  let vis = smoothstep(-a, a, asin(clamp(mu, -1.0, 1.0)) - asin(hMu));
  let rk = max(r * A.radii.x, A.radii.x + 0.01);
  let ht = rk * sqrt(max(1.0 - mu * mu, 0.0)) - A.radii.x;
  let low = select(1.0, smoothstep(0.0, 1.5 * A.rayleigh.w, ht), mu < 0.0);
  return gl_transmittance(rk, max(mu, hMu + 0.002)) * vis * low;
}

// Twilight light on the ground past the terminator (forge fn twilightT).
fn gl_twilight(mu: f32) -> vec3f {
  let R = A.radii.x;
  let d = max(-asin(clamp(mu, -1.0, 1.0)), 0.0);
  let hs = min(R * (1.0 / cos(min(d, 1.2)) - 1.0), A.radii.y - R);
  let col = exp(-hs / max(A.rayleigh.w, 0.1)) * 0.85 + exp(-hs / max(A.mieS.w, 0.1)) * 0.15;
  return gl_transmittance(R + hs + 0.01, 0.0) * col;
}

// Sky irradiance on the ground (forge fn skyIrradiance), for the ambient.
fn gl_skyIrr(p: vec3f) -> vec3f {
  let up = normalize(p);
  let mu = dot(up, F.sunDir.xyz);
  let tauS = A.rayleigh.xyz * A.rayleigh.w + A.mieS.xyz * A.mieS.w;
  let Ts = select(gl_twilight(mu) * mix(1.0, 6.0, smoothstep(0.0, -0.03, mu)), gl_transmittance(A.radii.x + 0.01, mu), mu > 0.0);
  let ms = gl_multiScat(A.radii.x + 0.01, mu);
  return A.radii.w * tauS * (Ts * 2.5 / (4.0 * PI) + ms * 2.0) + vec3f(0.0015);
}

// The cloud map at unit vector q: r optical depth 0..1, g precip; 0 outside.
fn gl_cloudAt(q: vec3f) -> vec4f {
  if (G.has2.y < 0.5) { return vec4f(0.0); }
  let c = gl_cropUV(gl_uv(q), G.cloudB);
  if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0) { return vec4f(0.0); }
  let edge = smoothstep(0.0, 0.02, min(min(c.x, 1.0 - c.x), min(c.y, 1.0 - c.y)));
  return clamp(textureSampleLevel(tCloud, sClamp, c, 0.0), vec4f(0.0), vec4f(1.0)) * edge;
}

fn gl_ggx(n: vec3f, v: vec3f, l: vec3f, rough: f32, f0: f32) -> f32 {
  let h = normalize(v + l);
  let nl = max(dot(n, l), 0.0);
  let nv = max(dot(n, v), 1e-3);
  let nh = max(dot(n, h), 0.0);
  let a2 = rough * rough * rough * rough;
  let d = a2 / (PI * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0));
  let k = rough * rough * 0.5;
  let vis = 1.0 / ((nl * (1.0 - k) + k) * (nv * (1.0 - k) + k));
  let fr = f0 + (1.0 - f0) * pow(1.0 - max(dot(h, v), 0.0), 5.0);
  return d * vis * fr * nl * 0.25;
}

struct Grad { dx: vec2f, dy: vec2f }

fn gl_sample(t: texture_2d<f32>, uv: vec2f, g: Grad) -> vec4f {
  return textureSampleGrad(t, sWrap, uv, g.dx, g.dy);
}

// Ground radiance at surface point p (unit) seen along rd.
fn gl_shade(p: vec3f, rd: vec3f, uv: vec2f, g: Grad) -> vec3f {
  let L = F.sunDir.xyz;
  let v = -rd;
  var east = vec3f(p.z, 0.0, -p.x);
  if (dot(east, east) < 1e-8) { east = vec3f(0.0, 0.0, -1.0); }
  east = normalize(east);
  let north = cross(p, east);

  // albedo: the global map, the US crop over it with a feathered edge
  var alb = vec3f(0.035, 0.07, 0.13);
  if (G.has.x > 0.5) { alb = gl_sample(tDay, uv, g).rgb; }
  if (G.has.y > 0.5) {
    let c = gl_cropUV(uv, G.detail);
    if (c.x > 0.0 && c.x < 1.0 && c.y > 0.0 && c.y < 1.0) {
      let sx = 360.0 / max(G.detail.w - G.detail.z, 1e-3);
      let sy = 180.0 / max(G.detail.y - G.detail.x, 1e-3);
      let d = textureSampleGrad(tDetail, sClamp, c, g.dx * vec2f(sx, sy), g.dy * vec2f(sx, sy)).rgb;
      let k = smoothstep(0.0, 0.03, min(min(c.x, 1.0 - c.x), min(c.y, 1.0 - c.y)));
      alb = mix(alb, d, k);
    }
  }
  alb *= G.look.z;
  var water = 1.0;
  if (G.has2.x > 0.5) { water = gl_sample(tWater, uv, g).r; }
  else if (G.has.x > 0.5) {
    // no mask: dark blue pixels of the day map are sea
    water = smoothstep(0.02, 0.0, max(alb.r, alb.g) - alb.b * 0.9) * smoothstep(0.09, 0.04, alb.g);
  }
  let land = 1.0 - water;

  // terrain normal from the height map, sampled at the pixel footprint
  var n = p;
  if (G.has.w > 0.5) {
    let dims = vec2f(textureDimensions(tHeight, 0));
    let du = max(1.0 / dims.x, abs(g.dx.x) + abs(g.dy.x));
    let dv = max(1.0 / dims.y, abs(g.dx.y) + abs(g.dy.y));
    // tex/manifest.json: metres ~ 6500 (v / 255)^(1 / 0.85)
    let hE = pow(gl_sample(tHeight, uv + vec2f(du, 0.0), g).r, 1.176);
    let hW = pow(gl_sample(tHeight, uv - vec2f(du, 0.0), g).r, 1.176);
    let hN = pow(gl_sample(tHeight, uv - vec2f(0.0, dv), g).r, 1.176);
    let hS = pow(gl_sample(tHeight, uv + vec2f(0.0, dv), g).r, 1.176);
    let cl = max(length(p.xz), 0.05);
    let dE = (hE - hW) * G.look.x / (2.0 * du * 2.0 * PI * cl);
    let dN = (hN - hS) * G.look.x / (2.0 * dv * PI);
    n = normalize(p - east * dE - north * dN);
  }

  // clouds above: shadow on the ground where the sun ray meets the deck,
  // and wet, darker ground under precipitation
  let mu = dot(p, L);
  let Lt = L - p * mu;
  let cs = gl_cloudAt(normalize(p + Lt * (0.0018 / max(mu, 0.15))));
  let here = gl_cloudAt(p);
  let shadow = 1.0 - 0.75 * clamp(cs.r, 0.0, 1.0);
  let wet = clamp(here.g, 0.0, 1.0) * land;
  alb *= mix(1.0, 0.6, wet);

  let sunC = gl_sunLight(p) * A.radii.w * shadow;
  let sky = gl_skyIrr(p);
  var c = alb / PI * (sunC * max(dot(n, L), 0.0) + sky * (0.5 + 0.5 * dot(n, p)));

  // ocean: sun glint and a Fresnel sky reflection; wet land gets a little
  let wave = sky_gnoise(p * 900.0) * 0.5 + sky_gnoise(p * 3100.0) * 0.25;
  let rough = mix(0.62, mix(0.13, 0.22, wave * 0.5 + 0.5), max(water, wet * 0.5));
  let spec = gl_ggx(normalize(p + (east * wave + north * wave * 0.7) * 0.02 * water), v, L, rough, 0.02);
  c += sunC * spec * max(water, wet * 0.4);
  let fv = 0.02 + 0.98 * pow(1.0 - max(dot(p, v), 0.0), 5.0);
  c += water * fv * sky * vec3f(0.55, 0.7, 1.0) * 0.25;

  // night lights: off by day (and in day mode), warm at the terminator
  if (G.has.z > 0.5 && F.sunDir.w < 0.5) {
    let night = smoothstep(0.06, -0.14, mu);
    if (night > 0.0) {
      let e = gl_sample(tNight, uv, g).rgb;
      let warm = mix(vec3f(1.0, 0.62, 0.32), vec3f(1.0, 0.82, 0.6), smoothstep(-0.02, -0.2, mu));
      c += e * warm * night * G.look.y * (1.0 - 0.85 * clamp(here.r, 0.0, 1.0));
    }
  }
  return c;
}

struct Scat { L: vec3f, T: vec3f }

// Single scattering from ro (globe space) along rd up to tMax (radii),
// forge planet.wgsl fn atmosphere adapted to this frame.
fn gl_atmos(ro: vec3f, rd: vec3f, tMax: f32) -> Scat {
  var s: Scat;
  s.L = vec3f(0.0);
  s.T = vec3f(1.0);
  let R = A.radii.x;
  let roK = ro * R;
  let hit = raySphere(roK, rd, A.radii.y);
  if (hit.y <= 0.0) { return s; }
  let t0 = max(hit.x, 0.0);
  let t1 = min(hit.y, tMax * R);
  if (t1 <= t0) { return s; }
  let steps = G.look.w;
  let n = select(i32(steps), max(8, i32(steps) / 2), tMax < 1e8);
  let dt = (t1 - t0) / f32(n);
  let L = F.sunDir.xyz;
  let c = dot(rd, L);
  let pR = phaseR(c);
  let pM = phaseM(c, A.mieA.w);
  var T = vec3f(1.0);
  var acc = vec3f(0.0);
  for (var i = 0; i < 64; i++) {
    if (i >= n) { break; }
    let x = roK + rd * (t0 + (f32(i) + 0.5) * dt);
    let r = length(x);
    let m = medium(A, r - R);
    let muS = dot(x / r, L);
    let gs = raySphere(x, L, R);
    var sh = 1.0;
    if (gs.x > 0.0) {
      let b = dot(x, L);
      let dmin = sqrt(max(r * r - b * b, 0.0));
      let pw = 4.0 + max(-b, 0.0) * 0.0047;
      sh = smoothstep(R - pw, R + pw, dmin);
    }
    let Ts = gl_transmittance(r, muS) * sh;
    let ms = gl_multiScat(r, muS);
    let S = A.radii.w * (m.sR * (pR * Ts + ms) + m.sM * (pM * Ts + ms));
    let ext = max(m.ext, vec3f(1e-7));
    let st = exp(-ext * dt);
    acc += T * (S - S * st) / ext;
    T *= st;
  }
  if (tMax < 1e8 && G.has2.w < 0.999) {
    let pg = ro + rd * tMax;
    let mu = clamp(-dot(rd, normalize(pg)), 0.0, 1.0);
    let k = mix(G.has2.w, 1.0, pow(1.0 - mu, 3.0));
    acc *= k;
    T = pow(T, vec3f(k));
  }
  s.L = acc;
  s.T = T;
  return s;
}

fn gl_aces(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}

fn gl_hash(p: vec3f) -> f32 {
  var q = fract(p * vec3f(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yxz + 33.33);
  return fract((q.x + q.y) * q.z);
}

struct GOut {
  @location(0) color: vec4f,
  @builtin(frag_depth) depth: f32,
}

@fragment
fn fsGlobe(in: VOut) -> GOut {
  let px = in.pos.xy;
  let ro = F.eye.xyz;
  let rd = gl_ray(px);
  let hp = raySphere(ro, rd, 1.0);
  let planetHit = hp.x > 0.0;
  let tca = max(-dot(ro, rd), 0.0);
  // the texture point for every pixel (closest approach on a miss), so the
  // gradients are in uniform control flow and smooth at the silhouette
  let pS = select(normalize(ro + rd * tca), normalize(ro + rd * hp.x), planetHit);
  let uv = gl_uv(pS);
  var g: Grad;
  g.dx = gl_wrapGrad(dpdx(uv));
  g.dy = gl_wrapGrad(dpdy(uv));

  let pxAngle = 2.0 * F.clock.z / F.viewport.y;
  let dEdge = (1.0 - length(ro + rd * tca)) / max(tca * pxAngle, 1e-6);
  let cover = select(0.0, clamp(dEdge + 0.5, 0.0, 1.0), tca > 0.0 && dot(ro, ro) > 1.0);

  var col = vec3f(0.0);
  if (cover < 1.0) {
    // stars in the inertial frame: turn the ray by the sidereal angle
    let rdW = vec3f(G.stars.x * rd.x - G.stars.y * rd.z, rd.y, G.stars.y * rd.x + G.stars.x * rd.z);
    col = skyColor(rdW, pxAngle, F.viewport.w) * G.stars.z;
    if (G.has2.z > 0.5) {
      let sun = sky_sun(rd, F.sunDir.xyz, G.stars.w, F.eye.w, 1.6, 0.35);
      col += sun.col;
    }
  }
  var tEnd = 1e9;
  if (cover > 0.0) {
    tEnd = select(1e9, hp.x, planetHit);
    col = mix(col, gl_shade(pS, rd, uv, g), cover);
  }
  let sc = gl_atmos(ro, rd, tEnd);
  col = col * sc.T + sc.L;

  var c = fr_toSRGB(gl_aces(col * F.misc.x));
  let dn = gl_hash(vec3f(px, fract(F.eye.w) * 61.0)) + gl_hash(vec3f(px.yx, 7.0)) - 1.0;
  c += dn / 255.0;

  var o: GOut;
  o.color = vec4f(c, 1.0);
  o.depth = 1.0;
  if (planetHit) {
    let cp = F.viewProj * vec4f(ro + rd * hp.x, 1.0);
    o.depth = clamp(cp.z / cp.w, 0.0, 1.0);
  }
  return o;
}

// The limb veil over the overlay layers: premultiplied display-space haze,
// strongest where the view ray grazes the ground, lit by the sun.
@fragment
fn fsVeil(in: VOut) -> @location(0) vec4f {
  let ro = F.eye.xyz;
  let rd = gl_ray(in.pos.xy);
  let hp = raySphere(ro, rd, 1.0);
  if (hp.x <= 0.0) { return vec4f(0.0); }
  let p = normalize(ro + rd * hp.x);
  let mu = clamp(-dot(rd, p), 0.0, 1.0);
  let lit = max(smoothstep(-0.15, 0.25, dot(p, F.sunDir.xyz)), F.sunDir.w);
  let a = pow(1.0 - mu, 4.0) * 0.4 * lit;
  return vec4f(vec3f(0.62, 0.76, 0.96) * a, a);
}
