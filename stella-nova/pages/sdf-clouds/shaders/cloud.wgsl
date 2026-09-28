// cloud.wgsl — cloud sampling shared by light.wgsl and march.wgsl.
//
// Holds the density model, the box intersection and the secondary light
// march. The density model follows CloudsLib.cginc sampleDensity:
//
//   depth    = iso - sdf                 distance inside the surface
//   base     = min(depth / edgeRamp, 1)  soft ramp in from the surface
//   erosion  applied only when depth < band, weighted by
//            (1 - depth / band) ^ exponent, so the cost stays on the edges
//   sigma_t  = base * density
//
// grep: fn sdfAt  fn density  fn boxRange  fn lightDepth

@group(0) @binding(1) var samp    : sampler;          // linear, clamp
@group(0) @binding(2) var sdfTex  : texture_3d<f32>;  // r SDF (world), g field
@group(0) @binding(3) var eroTex  : texture_3d<f32>;  // r tiling billow
@group(0) @binding(6) var sampRep : sampler;          // linear, repeat

fn boxUVW(w: vec3f) -> vec3f { return (w - P.boxMin.xyz) / (P.boxMax.xyz - P.boxMin.xyz); }

fn sdfAt(w: vec3f) -> f32 { return textureSampleLevel(sdfTex, samp, boxUVW(w), 0.0).r; }

fn erosionAt(w: vec3f) -> f32 {
  let uvw = w / P.ero.w + P.ero2.xyz * P.camPos.w;
  return textureSampleLevel(eroTex, sampRep, uvw, 0.0).r;
}

struct Dens { d: f32, ew: f32 };   // extinction sigma_t, erosion weight

fn density(w: vec3f, s: f32, erode: bool) -> Dens {
  let depth = P.march.w - s;
  if (depth <= 0.0) { return Dens(0.0, 0.0); }
  var base = min(depth / max(P.dens.y, 1e-3), 1.0);
  var ew = 0.0;
  if (erode && P.ero.x > 0.5 && depth < P.ero.z) {
    let n = erosionAt(w);
    ew = pow(1.0 - depth / P.ero.z, P.ero2.w);
    let cut = clamp((n - (1.0 - P.ero.y)) / max(P.ero.y, 1e-3), 0.0, 1.0);
    base = max(base - cut * ew, 0.0);
  }
  return Dens(base * P.dens.x, ew);
}

// Entry and exit distance of a ray through the cloud box. x >= 0; the ray
// misses when y <= x.
fn boxRange(ro: vec3f, rd: vec3f) -> vec2f {
  let r = select(rd, vec3f(1e-6), abs(rd) < vec3f(1e-6));
  let inv = 1.0 / r;
  let t0 = (P.boxMin.xyz - ro) * inv;
  let t1 = (P.boxMax.xyz - ro) * inv;
  let tmin = min(t0, t1);
  let tmax = max(t0, t1);
  let a = max(max(tmin.x, tmin.y), tmin.z);
  let b = min(min(tmax.x, tmax.y), tmax.z);
  return vec2f(max(a, 0.0), b);
}

// Optical depth from w toward the sun (lightMarch_sdf). Steps are fixed
// inside the cloud; outside, SDF skip takes the distance to the surface.
// Returns tau already scaled by the light absorption. n is the step budget.
fn lightDepth(w: vec3f, n: i32, erode: bool) -> vec2f {
  let L = P.sun.xyz;
  let tEnd = boxRange(w, L).y;
  let ls = P.dens.w;
  var t = ls * 0.5;
  var tau = 0.0;
  var k = 0;
  for (var i = 0; i < 512; i++) {
    if (i >= n || t >= tEnd) { break; }
    let p = w + L * t;
    let s = sdfAt(p);
    var dt = ls;
    if (s > P.march.w) {
      if (P.march2.x > 0.5) { dt = max(s - P.march.w, ls); }
    } else {
      tau += density(p, s, erode).d * dt;
    }
    k++;
    if (tau * P.dens.z > 6.0) { break; }
    t += dt;
  }
  return vec2f(tau * P.dens.z, f32(k));
}
