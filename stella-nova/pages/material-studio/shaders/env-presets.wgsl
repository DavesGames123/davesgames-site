// ============================================================================
//  MATERIAL STUDIO  ·  shaders/env-presets.wgsl — procedural HDRI presets
// ────────────────────────────────────────────────────────────────────────────
//  One fragment shader draws one preset into an equirect target. Values are
//  linear radiance. The sun and the lamps are much brighter than the sky, so
//  the specular highlights read after the prefilter. Needs env-common.wgsl.
//
//  MODES  (pu.mode)
//      0  HDR out: rgba16float target, linear radiance, clamped to 60000
//      1  thumbnail: rgba8unorm target, pu.exposure, then thumbTone
//
//  CONTENTS  (grep -n the name to jump)
//      PU ................ uniform: target size, preset index, mode, exposure
//      fromAz ............ direction from azimuth/elevation in degrees
//      sunDisk / rectLight / tube   light shapes
//      skyDome ........... gradient sky, sun glow, horizon haze, ground
//      pStudio ........ 0  pStudioRim ..... 1  pOvercast ...... 2
//      pClearNoon ..... 3  pGoldenHour .... 4  pBlueHour ...... 5
//      pNightCity ..... 6  pWarehouse ..... 7  pForest ........ 8
//      pNeon .......... 9  pSnowField .... 10  pDesert ....... 11
//      presetRadiance .... index -> preset function
//      fs_preset ......... the entry point
//
//  AZIMUTH  fromAz(0, el) points toward +Z, that is toward the default
//  camera, so az 0 is a front light. az 180 is behind the object.
// ============================================================================

struct PU {
  size: vec2f,
  preset: u32,
  mode: u32,
  exposure: f32,
  p1: f32,
  p2: f32,
  p3: f32,
};
@group(0) @binding(0) var<uniform> pu: PU;

fn fromAz(azDeg: f32, elDeg: f32) -> vec3f {
  let lon = radians(azDeg + 180.0);
  let lat = radians(elDeg);
  let c = cos(lat);
  return vec3f(c * sin(lon), sin(lat), -(c * cos(lon)));
}

// A disk of angular radius `rad` (radians) that gives irradiance E at normal
// incidence. Soft limb, so the mip chain stays stable.
fn sunDisk(d: vec3f, s: vec3f, rad: f32, E: f32, col: vec3f) -> vec3f {
  let a = acos(clamp(dot(d, s), -1.0, 1.0));
  if (a > rad * 1.2) { return vec3f(0.0); }
  let r = min(a / rad, 1.0);
  let edge = 1.0 - smoothstep(0.85, 1.2, a / rad);
  let limb = 1.0 - (0.3 * (1.0 - sqrt(max(1.0 - (r * r), 0.0))));
  let L = E / (PI * rad * rad);
  return col * (L * edge * limb);
}

// A soft rectangle around direction c. hw/hh are half sizes on the tangent
// plane at distance 1 (about radians for small sizes). ang turns the rect.
fn rectLight(d: vec3f, c: vec3f, hw: f32, hh: f32, ang: f32, soft: f32) -> f32 {
  let t = dot(d, c);
  if (t <= 0.0) { return 0.0; }
  var right = cross(c, vec3f(0.0, 1.0, 0.0));
  if (dot(right, right) < 1e-6) { right = vec3f(1.0, 0.0, 0.0); }
  right = normalize(right);
  let up = cross(right, c);
  let p = d / t;
  let x0 = dot(p, right);
  let y0 = dot(p, up);
  let ca = cos(ang);
  let sa = sin(ang);
  let x = abs((ca * x0) + (sa * y0)) / hw;
  let y = abs((ca * y0) - (sa * x0)) / hh;
  return (1.0 - smoothstep(1.0 - soft, 1.0, x)) * (1.0 - smoothstep(1.0 - soft, 1.0, y));
}

// A thin glowing tube: a rect with a core and a wide halo.
fn tube(d: vec3f, c: vec3f, len: f32, ang: f32, col: vec3f, core: f32) -> vec3f {
  let k = rectLight(d, c, len, 0.012, ang, 0.35);
  let h = rectLight(d, c, len * 1.15, 0.09, ang, 0.95);
  return col * ((k * core) + (h * h * 0.6));
}

fn skyDome(d: vec3f, s: vec3f, zen: vec3f, hor: vec3f, grd: vec3f, hzExp: f32, glow: vec3f) -> vec3f {
  let up = max(d.y, 0.0);
  var sky = mix(hor, zen, pow(up, hzExp));
  let cs = max(dot(d, s), 0.0);
  sky += glow * ((0.5 * pow(cs, 5.0)) + (2.5 * pow(cs, 60.0)));
  sky += hor * (0.3 * exp(-up * 16.0));
  let gnd = grd * (0.65 + (0.35 * exp(min(d.y, 0.0) * 5.0)));
  return mix(gnd, sky, smoothstep(-0.02, 0.01, d.y));
}

fn lonLat(d: vec3f) -> vec2f {
  return vec2f(atan2(d.x, -d.z), asin(clamp(d.y, -1.0, 1.0)));
}

// 0 · Studio Softbox: dark cyclorama, a large warm key, a cool fill, a top strip.
fn pStudio(d: vec3f) -> vec3f {
  let g = 0.03 + (0.05 * smoothstep(-0.2, 0.6, d.y));
  var c = vec3f(g * 0.95, g, g * 1.08);
  c = mix(vec3f(0.035, 0.034, 0.033), c, smoothstep(-0.08, 0.0, d.y));
  c += vec3f(1.0, 0.96, 0.9) * (14.0 * rectLight(d, fromAz(-50.0, 28.0), 0.42, 0.3, 0.0, 0.25));
  c += vec3f(0.85, 0.92, 1.0) * (3.5 * rectLight(d, fromAz(65.0, 8.0), 0.3, 0.45, 0.0, 0.4));
  c += vec3f(1.0, 1.0, 1.0) * (9.0 * rectLight(d, fromAz(0.0, 78.0), 0.7, 0.1, 0.0, 0.3));
  c += vec3f(1.0, 0.98, 0.95) * (1.6 * rectLight(d, fromAz(170.0, 20.0), 0.6, 0.35, 0.0, 0.6));
  return c;
}

// 1 · Studio Rim: near black room, two hard strips behind, weak front fill.
fn pStudioRim(d: vec3f) -> vec3f {
  var c = vec3f(0.006, 0.007, 0.009) + (vec3f(0.01) * max(d.y, 0.0));
  c += vec3f(0.9, 0.95, 1.0) * (30.0 * rectLight(d, fromAz(145.0, 12.0), 0.07, 0.65, 0.0, 0.2));
  c += vec3f(1.0, 0.92, 0.85) * (30.0 * rectLight(d, fromAz(-145.0, 12.0), 0.07, 0.65, 0.0, 0.2));
  c += vec3f(1.0) * (1.2 * rectLight(d, fromAz(0.0, -5.0), 0.5, 0.25, 0.0, 0.8));
  c += vec3f(1.0) * (6.0 * rectLight(d, fromAz(180.0, 70.0), 0.25, 0.04, 0.0, 0.3));
  return c;
}

// 2 · Overcast: bright grey dome, brighter at the zenith, a soft hidden-sun patch.
fn pOvercast(d: vec3f) -> vec3f {
  let up = max(d.y, 0.0);
  var sky = vec3f(0.92, 0.95, 1.0) * (1.1 * (1.0 + (2.0 * up)) / 3.0) * 2.6;
  let s = fromAz(-40.0, 50.0);
  sky += vec3f(1.0, 0.98, 0.94) * (0.9 * pow(max(dot(d, s), 0.0), 6.0));
  let gnd = vec3f(0.32, 0.31, 0.28) * (0.8 + (0.2 * vnoise(d.xz / max(-d.y, 0.05) * 3.0)));
  return mix(gnd, sky, smoothstep(-0.04, 0.02, d.y));
}

// 3 · Clear Noon: high sun, deep blue zenith, white horizon, sunlit ground.
fn pClearNoon(d: vec3f) -> vec3f {
  let s = fromAz(-35.0, 62.0);
  var c = skyDome(d, s, vec3f(0.22, 0.42, 0.95) * 1.3, vec3f(0.8, 0.88, 1.0) * 2.4,
                  vec3f(0.34, 0.31, 0.26) * 1.6, 0.42, vec3f(1.0, 0.95, 0.85) * 1.5);
  c += sunDisk(d, s, 0.0175, 24.0, vec3f(1.0, 0.97, 0.92));
  return c;
}

// 4 · Golden Hour: low orange sun, warm horizon on the sun side, violet zenith.
fn pGoldenHour(d: vec3f) -> vec3f {
  let s = fromAz(70.0, 5.0);
  let side = max(dot(normalize(vec3f(d.x, 0.0, d.z) + vec3f(0.0, 1e-4, 0.0)), normalize(vec3f(s.x, 0.0, s.z))), 0.0);
  let hor = mix(vec3f(0.55, 0.5, 0.62), vec3f(1.6, 0.8, 0.38), side * side);
  var c = skyDome(d, s, vec3f(0.16, 0.22, 0.5) * 0.9, hor, vec3f(0.1, 0.07, 0.05), 0.5,
                  vec3f(1.0, 0.5, 0.2) * 2.2);
  c += sunDisk(d, s, 0.02, 9.0, vec3f(1.0, 0.55, 0.25));
  return c;
}

// 5 · Blue Hour: the sun is under the horizon. Deep blue dome, a warm band, stars.
fn pBlueHour(d: vec3f) -> vec3f {
  let s = fromAz(-100.0, -6.0);
  let up = max(d.y, 0.0);
  var c = mix(vec3f(0.22, 0.27, 0.5) * 0.9, vec3f(0.035, 0.06, 0.2), pow(up, 0.5));
  let side = max(dot(normalize(vec3f(d.x, 0.0, d.z) + vec3f(0.0, 1e-4, 0.0)), normalize(vec3f(s.x, 0.0, s.z))), 0.0);
  c += vec3f(0.9, 0.4, 0.16) * (pow(side, 3.0) * exp(-up * 9.0) * 1.4);
  let ll = lonLat(d) * vec2f(160.0, 160.0);
  let st = hash2(floor(ll));
  let star = step(0.9965, st) * smoothstep(0.15, 0.6, d.y) * (0.6 + (3.0 * hash2(floor(ll) + vec2f(7.0, 3.0))));
  c += vec3f(star);
  let gnd = vec3f(0.005, 0.006, 0.01);
  return mix(gnd, c, smoothstep(-0.02, 0.005, d.y));
}

// 6 · Night City: sodium sky glow, a skyline with lit windows, street lamps.
fn pNightCity(d: vec3f) -> vec3f {
  let ll = lonLat(d);
  let up = max(d.y, 0.0);
  var c = vec3f(0.006, 0.008, 0.022) + (vec3f(0.42, 0.2, 0.07) * exp(-up * 7.0) * 0.55);
  let cell = floor(ll.x * 40.0 / PI);
  let top = 0.015 + (0.2 * pow(hash2(vec2f(cell, 7.0)), 2.0));
  if ((ll.y < top) && (ll.y > -0.03)) {
    c = vec3f(0.008, 0.009, 0.012);
    let w = vec2f(ll.x * 520.0 / PI, ll.y * 300.0);
    let wi = floor(w);
    let f = fract(w);
    let inWin = step(0.22, f.x) * step(f.x, 0.78) * step(0.3, f.y) * step(f.y, 0.78);
    let on = step(0.64, hash2(wi + vec2f(cell * 3.0, 0.0)));
    let cool = step(0.86, hash2(wi + vec2f(13.0, 5.0)));
    let tint = mix(vec3f(1.0, 0.7, 0.38), vec3f(0.72, 0.85, 1.0), cool);
    c += tint * (inWin * on * (1.2 + (4.0 * hash2(wi + vec2f(5.0, 1.0)))));
  }
  if (ll.y <= -0.03) {
    let p = d.xz / max(-d.y, 0.02);
    let wet = 0.01 + (0.02 * vnoise(p * 1.5));
    c = vec3f(wet * 0.9, wet * 0.85, wet);
    let row = abs(fract((p.x * 0.125) + 0.5) - 0.5) * 8.0;
    c += vec3f(0.6, 0.35, 0.12) * (0.08 * exp(-row * 4.0));
  }
  for (var i = 0u; i < 18u; i++) {
    let h1 = hash2(vec2f(f32(i), 31.0));
    let h2 = hash2(vec2f(f32(i), 57.0));
    let ld = fromAz((h1 * 360.0) - 180.0, (h2 * 14.0) - 4.0);
    let warm = mix(vec3f(1.0, 0.62, 0.25), vec3f(0.85, 0.9, 1.0), step(0.75, hash2(vec2f(f32(i), 91.0))));
    c += sunDisk(d, ld, 0.009, 0.35, warm);
    c += warm * (0.6 * pow(max(dot(d, ld), 0.0), 900.0));
  }
  return c;
}

// 7 · Warehouse: dim interior, window bands on two walls, skylight strips.
fn pWarehouse(d: vec3f) -> vec3f {
  let ll = lonLat(d);
  var c = vec3f(0.16, 0.14, 0.12) * 0.35;
  if (d.y < -0.05) {
    let p = d.xz / -d.y;
    c = vec3f(0.12, 0.115, 0.105) * (0.45 + (0.25 * fbm(p * 0.8)));
  }
  if (d.y > 0.55) {
    let p = d.xz / d.y;
    c = vec3f(0.04, 0.04, 0.045);
    let strip = 1.0 - smoothstep(0.05, 0.07, abs(fract((p.y * 0.9) + 0.5) - 0.5));
    let span = 1.0 - smoothstep(0.95, 1.0, abs(p.x));
    c += vec3f(0.85, 0.92, 1.0) * (11.0 * strip * span);
  }
  let wall = abs(cos(ll.x));
  let band = smoothstep(0.26, 0.29, ll.y) * (1.0 - smoothstep(0.55, 0.58, ll.y));
  let mull = step(0.12, fract(ll.x * 30.0 / PI)) * step(0.15, fract(ll.y * 14.0));
  let win = band * mull * smoothstep(0.55, 0.62, wall);
  c = mix(c, vec3f(0.78, 0.88, 1.0) * 6.5, win);
  return c;
}

// 8 · Forest Canopy: leaves above with gaps of sky and sun, trunks in green haze.
fn pForest(d: vec3f) -> vec3f {
  let s = fromAz(-30.0, 58.0);
  let up = max(d.y, 0.0);
  let p = d.xz / (d.y + 0.35);
  let leaf = smoothstep(0.4, 0.52, fbm(p * 2.2));
  let back = pow(max(dot(d, s), 0.0), 4.0);
  let leafCol = vec3f(0.05, 0.11, 0.025) * (0.8 + (3.5 * back));
  var c = mix(vec3f(0.55, 0.75, 1.0) * 3.2, leafCol, leaf);
  let ps = s.xz / (s.y + 0.35);
  let sunVis = 1.0 - smoothstep(0.4, 0.52, fbm(ps * 2.2));
  c += sunDisk(d, s, 0.02, 14.0 * max(sunVis, 0.15), vec3f(1.0, 0.95, 0.82)) * (1.0 - leaf);
  let haze = vec3f(0.14, 0.19, 0.13) * 1.1;
  let ll = lonLat(d);
  let trunk = step(0.82, hash2(vec2f(floor(ll.x * 60.0 / PI), 3.0)));
  let band = vec3f(0.035, 0.03, 0.02) * trunk + (haze * (1.0 - trunk));
  c = mix(band, c, smoothstep(0.12, 0.45, up));
  let gnd = vec3f(0.055, 0.05, 0.03) * (0.6 + (0.5 * fbm(d.xz / max(-d.y, 0.05) * 1.3)));
  return mix(gnd, c, smoothstep(-0.03, 0.02, d.y));
}

// 9 · Neon: a dark room lit by saturated tubes.
fn pNeon(d: vec3f) -> vec3f {
  var c = vec3f(0.006, 0.005, 0.01);
  if (d.y < -0.05) { c = vec3f(0.01, 0.008, 0.014) * (1.0 + vnoise(d.xz / -d.y * 4.0)); }
  c += tube(d, fromAz(125.0, 18.0), 0.6, 1.5708, vec3f(1.0, 0.08, 0.75), 45.0);
  c += tube(d, fromAz(-110.0, 8.0), 0.9, 0.0, vec3f(0.08, 0.9, 1.0), 45.0);
  c += tube(d, fromAz(25.0, 42.0), 0.7, 0.5, vec3f(1.0, 0.75, 0.1), 35.0);
  c += tube(d, fromAz(-30.0, -12.0), 0.5, 0.0, vec3f(0.5, 0.2, 1.0), 30.0);
  let ring = 1.0 - smoothstep(0.0, 0.02, abs(d.y - 0.93));
  c += vec3f(0.2, 0.35, 1.0) * (18.0 * ring);
  return c;
}

// 10 · Snow Field: very bright snow, pale blue sky, mid sun.
fn pSnowField(d: vec3f) -> vec3f {
  let s = fromAz(40.0, 34.0);
  let p = d.xz / max(-d.y, 0.03);
  let drift = 0.88 + (0.12 * fbm(p * 0.6));
  var c = skyDome(d, s, vec3f(0.2, 0.4, 0.92) * 1.15, vec3f(0.78, 0.86, 1.0) * 2.6,
                  vec3f(0.92, 0.95, 1.0) * 4.6 * drift, 0.4, vec3f(1.0, 0.97, 0.92) * 1.2);
  c += sunDisk(d, s, 0.0175, 22.0, vec3f(1.0, 0.98, 0.95));
  return c;
}

// 11 · Desert: hazy hot sky, high sun, sand dunes, red mesas on the horizon.
fn pDesert(d: vec3f) -> vec3f {
  let s = fromAz(-20.0, 70.0);
  let p = d.xz / max(-d.y, 0.03);
  let dune = 0.75 + (0.25 * sin((p.x * 0.7) + (2.0 * fbm(p * 0.2))));
  var c = skyDome(d, s, vec3f(0.45, 0.6, 0.86) * 1.6, vec3f(1.0, 0.92, 0.8) * 2.8,
                  vec3f(0.78, 0.56, 0.36) * 2.3 * dune, 0.55, vec3f(1.0, 0.9, 0.75) * 1.4);
  let ll = lonLat(d);
  let mesa = 0.012 + (0.05 * smoothstep(0.45, 0.75, fbm(vec2f(ll.x * 6.0, 1.0))));
  if ((ll.y > -0.005) && (ll.y < mesa)) { c = vec3f(0.55, 0.28, 0.16) * 1.1; }
  c += sunDisk(d, s, 0.0175, 26.0, vec3f(1.0, 0.95, 0.86));
  return c;
}

fn presetRadiance(id: u32, d: vec3f) -> vec3f {
  switch id {
    case 0u: { return pStudio(d); }
    case 1u: { return pStudioRim(d); }
    case 2u: { return pOvercast(d); }
    case 3u: { return pClearNoon(d); }
    case 4u: { return pGoldenHour(d); }
    case 5u: { return pBlueHour(d); }
    case 6u: { return pNightCity(d); }
    case 7u: { return pWarehouse(d); }
    case 8u: { return pForest(d); }
    case 9u: { return pNeon(d); }
    case 10u: { return pSnowField(d); }
    case 11u: { return pDesert(d); }
    default: { return vec3f(0.5); }
  }
}

@fragment
fn fs_preset(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let d = uvToDir(pos.xy / pu.size);
  var c = max(presetRadiance(pu.preset, d), vec3f(0.0));
  c = min(c, vec3f(60000.0));
  if (pu.mode == 1u) { c = thumbTone(c * pu.exposure); }
  return vec4f(c, 1.0);
}
