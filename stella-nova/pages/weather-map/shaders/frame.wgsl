// ============================================================================
//  WEATHER MAP  ·  frame.wgsl — the per-frame uniform that every layer shares
// ----------------------------------------------------------------------------
//  render/core.js writes struct Frame once per frame (packFrame) and binds
//  it at group(0) binding(0) for every pipeline (core.frameLayout,
//  core.frameGroup). Each layer prepends this file to its own shader text,
//  so a layer must not define the names below again. The globe module is
//  joined as frame.wgsl + forge atmo-common.wgsl + forge sky.wgsl +
//  globe.wgsl, so this file defines no PI and no fr_-less helpers.
//
//  Globe space: unit sphere, y up, x = cos(lat) cos(lon), y = sin(lat),
//  z = -cos(lat) sin(lon). Layer colours are display-referred (sRGB,
//  premultiplied alpha): the globe pass tone-maps before the layers draw.
//
//  grep -n targets: "struct Frame", "fn fr_dir", "fn fr_clip", "fn fr_screen",
//  "fn fr_pxSize", "fn fr_daylight", "fn fr_limbFade", "fn fr_toSRGB"
// ============================================================================

struct Frame {
  viewProj: mat4x4f,     // globe space -> clip (WebGPU depth 0..1)
  invViewProj: mat4x4f,  // clip -> globe space
  eye: vec4f,            // xyz eye (globe space), w animation time (s since boot)
  sunDir: vec4f,         // xyz unit vector to the sun, w light mode (0 real, 1 day)
  viewport: vec4f,       // x width, y height (device px), z dpr, w quality (0 phone, 1 tablet, 2 desktop)
  misc: vec4f,           // x exposure, y camera alt (radii), z focus lat (deg), w focus lon (deg)
  clock: vec4f,          // x forecast hours from wall-clock now, y UTC hour of day, z tan(fovY / 2), w aspect
}

@group(0) @binding(0) var<uniform> F: Frame;

// Globe-space unit vector at (lat, lon) in degrees.
fn fr_dir(latDeg: f32, lonDeg: f32) -> vec3f {
  let p = radians(latDeg);
  let l = radians(lonDeg);
  return vec3f(cos(p) * cos(l), sin(p), -cos(p) * sin(l));
}

fn fr_clip(p: vec3f) -> vec4f { return F.viewProj * vec4f(p, 1.0); }

// Device-pixel position of a globe-space point (y down, as @builtin(position)).
fn fr_screen(p: vec3f) -> vec2f {
  let c = fr_clip(p);
  let n = c.xy / c.w;
  return vec2f((n.x * 0.5 + 0.5) * F.viewport.x, (0.5 - n.y * 0.5) * F.viewport.y);
}

// Globe-space length of one device pixel at point p (for screen-sized symbols).
fn fr_pxSize(p: vec3f) -> f32 {
  return distance(p, F.eye.xyz) * 2.0 * F.clock.z / max(F.viewport.y, 1.0);
}

// 1 on the day side, 0 at night, a soft terminator (day mode is always lit).
fn fr_daylight(n: vec3f) -> f32 {
  return max(smoothstep(-0.12, 0.1, dot(normalize(n), F.sunDir.xyz)), F.sunDir.w);
}

// 1 where the surface faces the eye, falling to 0 at the limb: fade overlays
// into the edge of the disc.
fn fr_limbFade(p: vec3f) -> f32 {
  let v = normalize(F.eye.xyz - p);
  return smoothstep(0.0, 0.25, dot(normalize(p), v));
}

fn fr_toSRGB(c: vec3f) -> vec3f {
  return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308));
}
