// ============================================================================
//  PLANET FORGE  ·  atmo-common.wgsl — the atmosphere model shared by the
//  LUT passes (atmo-lut.wgsl) and the view (planet.wgsl). atmo.js prepends
//  this file to both. Units are km and 1/km.
//
//  Medium at height h above the ground (Hillaire 2020, Bruneton 2008):
//    Rayleigh   sigma_s = beta_R exp(-h / H_R)            (no absorption)
//    Mie        sigma_s = beta_Ms exp(-h / H_M), sigma_a = beta_Ma exp(-h / H_M)
//    absorber   sigma_a = beta_A max(0, 1 - |h - c| / w)   (ozone; methane)
//  Transmittance LUT (256 x 64): T(r, mu) to the top of the atmosphere, in
//  the Bruneton/Hillaire (r, mu) <-> uv mapping. Multiple-scattering LUT
//  (32 x 32): Psi_ms(mu_s, h), Hillaire's isotropic second-order term
//  L2 / (1 - f_ms).
//
//  grep -n targets: "struct Atmo", "fn medium", "fn transUV", "fn uvTrans",
//  "fn raySphere", "fn phaseR", "fn phaseM", "fn transmittance", "fn multiScat"
// ============================================================================

struct Atmo {
  rayleigh: vec4f,  // xyz beta_R (1/km), w H_R (km)
  mieS: vec4f,      // xyz beta_Ms, w H_M
  mieA: vec4f,      // xyz beta_Ma, w g
  absorb: vec4f,    // xyz beta_A, w centre (km)
  radii: vec4f,     // x bottom (km), y top (km), z absorber half-width (km), w sun illuminance
  ground: vec4f,    // xyz ground albedo, w on (1) or off (0)
}

struct Medium { sR: vec3f, sM: vec3f, ext: vec3f }

fn medium(A: Atmo, h: f32) -> Medium {
  let hh = max(h, 0.0);
  let dR = exp(-hh / A.rayleigh.w);
  let dM = exp(-hh / A.mieS.w);
  let dA = max(0.0, 1.0 - abs(hh - A.absorb.w) / max(A.radii.z, 0.001));
  var m: Medium;
  m.sR = A.rayleigh.xyz * dR;
  m.sM = A.mieS.xyz * dM;
  m.ext = m.sR + (A.mieS.xyz + A.mieA.xyz) * dM + A.absorb.xyz * dA;
  return m;
}

// Nearest and far hit of a ray with a sphere at the origin; y < 0 = miss.
fn raySphere(ro: vec3f, rd: vec3f, r: f32) -> vec2f {
  let b = dot(ro, rd);
  let c = dot(ro, ro) - r * r;
  let d = b * b - c;
  if (d < 0.0) { return vec2f(-1.0, -1.0); }
  let s = sqrt(d);
  return vec2f(-b - s, -b + s);
}

fn transUV(A: Atmo, r: f32, mu: f32) -> vec2f {
  let bot = A.radii.x;
  let top = A.radii.y;
  let H = sqrt(max(0.0, top * top - bot * bot));
  let rho = sqrt(max(0.0, r * r - bot * bot));
  let disc = r * r * (mu * mu - 1.0) + top * top;
  let d = max(0.0, -r * mu + sqrt(max(disc, 0.0)));
  let dMin = top - r;
  let dMax = rho + H;
  return vec2f((d - dMin) / max(dMax - dMin, 1e-4), rho / max(H, 1e-4));
}

fn uvTrans(A: Atmo, uv: vec2f) -> vec2f {
  let bot = A.radii.x;
  let top = A.radii.y;
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

const PI: f32 = 3.14159265;

fn phaseR(c: f32) -> f32 { return 3.0 / (16.0 * PI) * (1.0 + c * c); }

// Cornette-Shanks phase function
fn phaseM(c: f32, g: f32) -> f32 {
  let g2 = g * g;
  let k = 3.0 / (8.0 * PI) * (1.0 - g2) / (2.0 + g2);
  return k * (1.0 + c * c) / pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5);
}
