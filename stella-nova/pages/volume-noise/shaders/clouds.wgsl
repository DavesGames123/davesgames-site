// ============================================================================
//  VOLUME NOISE  ·  shaders/clouds.wgsl — a ray-marched cloud layer
// ----------------------------------------------------------------------------
//  gpu.js compiles common.wgsl + this file. This is the use that the shape
//  and erosion textures of main.cpp were made for: the Schneider and
//  Hillaire cloud model (GPU Pro 7 "Real-Time Volumetric Cloudscapes",
//  SIGGRAPH 2016 Frostbite course). This code is this page's own; it is not
//  a port of a published shader.
//
//  MODEL  (units: km; y is up)
//    layer ........ a flat slab from H0 to H1 over flat ground
//    weather ...... tWeather R = coverage, G = cloud type, tiled every WEATHER_KM
//    base shape ... tShape: remap(R, -(1 - lowFreqFBM(GBA)), 1, 0, 1), the
//                   main.cpp "packed" formula, stretched from 0.62..1 to
//                   0..1, times a height profile
//    coverage ..... remap(base, 1 - c, 1, 0, 1) * c  (GPU Pro 7)
//    erosion ...... tDetail FBM, inverted near the cloud base, cuts the edge
//    light ........ 6 steps to the sun; Beer's law, a powder term, two
//                   Henyey-Greenstein lobes, and three octaves of the
//                   multiple-scattering approximation (Wrenninge, Hillaire)
//    integration .. energy-conserving step: S (1 - exp(-sigma dt)) per step
//    wind ......... u.wind moves the shape and the detail at their own speeds
//
//  grep -n: "fn cloud_density"  "fn sun_light"  "fn sky"  "fn fs_clouds"
// ============================================================================

const H0 = 1.5;
const H1 = 4.0;
const SHAPE_KM = 7.0;
const DETAIL_KM = 1.1;
const WEATHER_KM = 36.0;
const MAX_KM = 48.0;
const SIGMA = 36.0;   // extinction per km at density 1
const PACKED_LO = 0.62;

fn sun_color() -> vec3f {
  let k = smoothstep(0.0, 0.45, u.sun.y);
  return mix(vec3f(1.0, 0.42, 0.16), vec3f(1.0, 0.96, 0.9), k) * mix(2.5, 6.0, k);
}

fn sky(rd: vec3f) -> vec3f {
  let k = smoothstep(-0.05, 0.45, u.sun.y);
  let zenith = mix(vec3f(0.03, 0.05, 0.16), vec3f(0.04, 0.16, 0.52), k);
  let horizon = mix(vec3f(0.95, 0.48, 0.24), vec3f(0.48, 0.66, 0.92), k);
  let y = max(rd.y, 0.0);
  var c = mix(horizon, zenith, pow(y, 0.4)) * u.tint.rgb;
  let s = max(dot(rd, u.sun.xyz), 0.0);
  c += sun_color() * (0.01 * pow(s, 8.0) + 0.05 * pow(s, 90.0) + 6.0 * smoothstep(0.99994, 0.99998, s));
  if (rd.y < 0.0) {
    let ground = mix(vec3f(0.035, 0.03, 0.04), vec3f(0.05, 0.07, 0.09), k);
    c = mix(horizon * 0.6 * u.tint.rgb, ground, 1.0 - exp(rd.y * 24.0));
  }
  return c;
}

fn hg(g: f32, c: f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / (12.566371 * pow(1.0 + g2 - 2.0 * g * c, 1.5));
}

// Density at p (km). full = false skips the detail erosion (the light march).
fn cloud_density(p: vec3f, full: bool) -> f32 {
  let h = clamp((p.y - H0) / (H1 - H0), 0.0, 1.0);
  let w = textureSampleLevel(tWeather, samp, (p.xz + u.wind.xy) / WEATHER_KM, 0.0);
  let cov = clamp(u.cloud.x + (w.r - 0.5) * 0.7, 0.0, 1.0);
  if (cov <= 0.01) { return 0.0; }
  // Height profile: stratus is low and thin, cumulus fills the layer.
  let top = mix(0.35, 1.0, w.g);
  let prof = smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(top * 0.55, top, h));
  if (prof <= 0.0) { return 0.0; }
  let sp = vec3f(p.x + u.wind.x, p.y, p.z + u.wind.y) / SHAPE_KM;
  let s = textureSampleLevel(tShape, samp, sp, 0.0);
  let lowFreqFBM = s.g * 0.625 + s.b * 0.25 + s.a * 0.125;
  let packed = clamp(remap(s.r, -(1.0 - lowFreqFBM), 1.0, 0.0, 1.0), 0.0, 1.0);
  // The packed shape spans about 0.6 .. 1; stretch it so c = 0.5 is half cover.
  let base = clamp(remap(packed, PACKED_LO, 1.0, 0.0, 1.0), 0.0, 1.0) * prof;
  var d = clamp(remap(base, 1.0 - cov, 1.0, 0.0, 1.0), 0.0, 1.0) * cov;
  if (full && d > 0.0) {
    let dp = vec3f(p.x + u.wind.z, p.y, p.z + u.wind.w) / DETAIL_KM;
    let e = textureSampleLevel(tDetail, samp, dp, 0.0);
    let hf = e.r * 0.625 + e.g * 0.25 + e.b * 0.125;
    let hfMod = mix(hf, 1.0 - hf, clamp(h * 8.0, 0.0, 1.0));
    d = clamp(remap(d, hfMod * u.cloud.z, 1.0, 0.0, 1.0), 0.0, 1.0);
  }
  return d * u.cloud.y;
}

// Optical depth toward the sun from p, in density x km.
fn sun_light(p: vec3f) -> f32 {
  var od = 0.0;
  var len = 0.08;
  var q = p;
  for (var i = 0; i < 6; i++) {
    q += u.sun.xyz * len;
    od += cloud_density(q, false) * len;
    len *= 1.6;
  }
  return od;
}

fn remap(v: f32, a: f32, b: f32, c: f32, d: f32) -> f32 {
  return c + ((v - a) / (b - a)) * (d - c);
}

@fragment
fn fs_clouds(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let ro = u.eye.xyz;
  let rd = camera_ray(fc.xy);
  let bg = sky(rd);
  var col = bg;
  // The part of the ray inside the slab.
  var tin = 0.0;
  var tout = -1.0;
  if (abs(rd.y) > 1e-4) {
    let ta = (H0 - ro.y) / rd.y;
    let tb = (H1 - ro.y) / rd.y;
    tin = max(min(ta, tb), 0.0);
    tout = min(max(ta, tb), MAX_KM);
  } else if (ro.y > H0 && ro.y < H1) {
    tout = MAX_KM;
  }
  if (rd.y < 0.0 && ro.y < H0) { tout = -1.0; }
  tout = min(tout, tin + 22.0);
  if (tout > tin) {
    let n = i32(u.cloud.w);
    let dt = (tout - tin) / f32(n);
    var t = tin + dt * pix_hash(fc.xy + fract(u.res.z) * 97.0);
    var T = 1.0;
    var L = vec3f(0.0);
    let c = dot(rd, u.sun.xyz);
    let sunC = sun_color();
    let k = smoothstep(-0.05, 0.45, u.sun.y);
    let amb0 = mix(vec3f(0.35, 0.3, 0.4), vec3f(0.42, 0.55, 0.8), k) * u.misc.y;
    for (var i = 0; i < n; i++) {
      let p = ro + rd * t;
      let d = cloud_density(p, true);
      if (d > 0.001) {
        let st = d * SIGMA;
        let od = sun_light(p) * SIGMA;
        // Multiple scattering, three octaves (a = b = c = 0.5^i).
        var ms = 0.0;
        var a = 1.0;
        for (var o = 0; o < 3; o++) {
          ms += a * exp(-a * od) * mix(hg(0.8 * a, c), hg(-0.3 * a, c), 0.35);
          a *= 0.5;
        }
        // Powder: a dark rim where the cloud is thin, seen away from the sun.
        let powder = mix(1.0, 1.0 - exp(-2.0 * st * 0.12), 0.5 - 0.5 * c);
        let h = clamp((p.y - H0) / (H1 - H0), 0.0, 1.0);
        let S = sunC * ms * powder * 4.0 + amb0 * (0.35 + 0.65 * h);
        let e = exp(-st * dt);
        L += T * S * (1.0 - e);
        T *= e;
        if (T < 0.01) { break; }
      }
      t += dt;
    }
    // Aerial perspective: far clouds fade into the horizon colour.
    let haze = exp(-tin * 0.045) * (1.0 - smoothstep(0.55 * MAX_KM, MAX_KM, tin));
    col = mix(bg, bg * T + L, haze);
  }
  col = 1.0 - exp(-col * u.misc.z);
  col = pow(col, vec3f(1.0 / 2.2));
  return vec4f(col * u.res.w, 1.0);
}
