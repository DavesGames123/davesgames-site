// ============================================================================
//  NUCLEAR BLAST  ·  glsl.js — shared GLSL chunks and colour helpers
// ----------------------------------------------------------------------------
//  Light units: the sun at noon gives an irradiance of 1. The fireball gives
//  uFbPow / d^2 times the air transmittance e^(-d / uTauL), where uFbPow is
//  the radiated power / (4 pi x 1000 W/m^2): the same units, so a flash can
//  be hundreds of suns near the burst. stage.js adapts the exposure (uExpo).
//
//  GREP MAP
//    NOISE ........ hash, value noise, fbm
//    LIGHT ........ the shared uniforms and function light()
//    FOG .......... function fogMix()
//    blackbody() .. RGB of a black body at T kelvin (JS)
// ============================================================================

// NOISE
export const NOISE = /* glsl */`
float hash13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float hash12(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vnoise(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float vnoise2(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1,0)), f.x), mix(hash12(i + vec2(0,1)), hash12(i + vec2(1,1)), f.x), f.y);
}
float fbm3(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
float fbm2(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise2(p); p = p * 2.03 + 3.7; a *= 0.5; } return s; }
`;

// LIGHT: sun + sky + ground bounce + fireball
export const LIGHT = /* glsl */`
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uSkyAmb; uniform vec3 uGndAmb;
uniform vec3 uFbPos; uniform vec3 uFbCol; uniform float uFbPow; uniform float uTauL;
vec3 light(vec3 P, vec3 N, vec3 albedo){
  vec3 L = vec3(0.0);
  L += uSunCol * max(dot(N, uSunDir), 0.0);
  L += mix(uGndAmb, uSkyAmb, N.y * 0.5 + 0.5);
  vec3 d = uFbPos - P; float r2 = max(dot(d, d), 1.0), r = sqrt(r2);
  L += uFbCol * (uFbPow / r2) * exp(-r / uTauL) * max(dot(N, d / r), 0.0);
  return albedo * L;
}
// the fireball irradiance only (for scorch and glow)
float fbIrr(vec3 P){ vec3 d = uFbPos - P; float r2 = max(dot(d, d), 1.0); return uFbPow / r2 * exp(-sqrt(r2) / uTauL); }
`;

// FOG: exponential haze, brightened by the flash around the burst. outCol()
// applies the exposure in the material and caps the result at 10: the
// HalfFloat target stays finite, and the bloom of a far brighter point
// does not turn into the square of its truncated blur kernels.
export const FOG = /* glsl */`
uniform vec3 uFogCol; uniform float uFogDen; uniform vec3 uFogFlash; uniform float uExpo;
vec3 outCol(vec3 c){ return min(c * uExpo, vec3(10.0)); }
// The haze thins with height (scale height 2.5 km), so the path from a
// high camera down to the ground crosses less of it: the mean density on
// the straight path is H (e^(-y1/H) - e^(-y2/H)) / (y2 - y1).
vec3 fogMix(vec3 col, vec3 P, vec3 cam){
  float d = length(P - cam), H = 2500.0;
  float y1 = max(min(P.y, cam.y), 0.0), y2 = max(max(P.y, cam.y), 0.0), dy = y2 - y1;
  float rho = dy > 1.0 ? H * (exp(-y1 / H) - exp(-y2 / H)) / dy : exp(-y1 / H);
  float f = 1.0 - exp(-pow(d * rho * uFogDen, 1.25));
  return mix(col, uFogCol + uFogFlash, clamp(f, 0.0, 1.0));
}
`;

// RGB (linear, max channel 1) of a black body at T kelvin: a fit to the
// CIE colour of a Planck spectrum (after T. Helland), then linearised.
export function blackbody(T, out = [0, 0, 0]) {
  const t = Math.max(1000, Math.min(40000, T)) / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708 * Math.log(t) - 161.1196; b = t <= 19 ? 0 : 138.5177 * Math.log(t - 10) - 305.0448; }
  else { r = 329.6987 * Math.pow(t - 60, -0.1332); g = 288.1222 * Math.pow(t - 60, -0.0755); b = 255; }
  const lin = v => Math.pow(Math.max(0, Math.min(255, v)) / 255, 2.2);
  out[0] = lin(r); out[1] = lin(g); out[2] = lin(b);
  return out;
}
