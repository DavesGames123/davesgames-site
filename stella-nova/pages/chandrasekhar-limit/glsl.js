// ============================================================================
//  CHANDRASEKHAR LIMIT  ·  glsl.js — the black-hole shader (WebGL 2, GLSL ES 3.00)
// ----------------------------------------------------------------------------
//  One full-screen fragment shader, drawn with one triangle by glkit.js.
//  The source is a string in a module, so the saver can show a real
//  extract on its plate (saver.js).
//
//  SHADERS   (jump with grep -n "<anchor>" glsl.js)
//    COMMON ........ "export const COMMON"   hash, value noise, black-body
//                                            colour, a sparse star field
//    HOLE .......... "export const HOLE"     Schwarzschild geodesic tracer
//                                            with a thin disk, Doppler and
//                                            gravitational shift
//    GEODESIC ...... "// GEODESIC STEP"       the integration loop in HOLE
//
//  Shared uniforms: uRes (buffer px), uOff (centre offset, buffer px; the
//  saver sets it to frame the subject in the plate band), uTime (s).
// ============================================================================

export const VERT = `#version 300 es
void main(){
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const COMMON = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform vec2 uOff;
uniform float uTime;
out vec4 fragColor;
#define PI 3.14159265359

float hash13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec3 hash33(vec3 p3){ p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
float vnoise(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm3(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++){ s += a * vnoise(p); p = p * 2.07 + vec3(4.1, 1.3, 7.7); a *= 0.5; } return s; }

// Black-body colour, max channel 1 (a fit to the Planck locus, 1000-40000 K).
vec3 blackbody(float T){
  float t = clamp(T, 1000.0, 40000.0) / 100.0;
  float r = t <= 66.0 ? 1.0 : clamp(1.29293618606 * pow(t - 60.0, -0.1332047592), 0.0, 1.0);
  float g = t <= 66.0 ? clamp(0.39008157876 * log(t) - 0.63184144378, 0.0, 1.0)
                      : clamp(1.12989086089 * pow(t - 60.0, -0.0755148492), 0.0, 1.0);
  float b = t >= 66.0 ? 1.0 : (t <= 19.0 ? 0.0 : clamp(0.54320678911 * log(t - 10.0) - 1.19625408914, 0.0, 1.0));
  return vec3(r, g, b);
}

// Point stars on the sky, two layers of jittered cells.
vec3 starField(vec3 d){
  vec3 col = vec3(0.0);
  for (int l = 0; l < 2; l++){
    float sc = l == 0 ? 55.0 : 130.0;
    vec3 p = d * sc, c = floor(p), h = hash33(c);
    vec3 sp = c + 0.2 + 0.6 * h;
    float r2 = dot(p - sp, p - sp);
    float b = pow(hash13(c + 7.0), l == 0 ? 26.0 : 36.0) * (l == 0 ? 5.0 : 2.0);
    col += b * mix(vec3(1.0, 0.9, 0.8), vec3(0.85, 0.9, 1.0), h.z) * exp(-r2 * (l == 0 ? 420.0 : 600.0));
  }
  return col;
}

mat3 lookAt(vec3 ro, vec3 ta){
  vec3 f = normalize(ta - ro), r = normalize(cross(f, vec3(0.0, 1.0, 0.0))), u = cross(r, f);
  return mat3(r, u, f);
}
vec3 tonemap(vec3 c, float e){ c = 1.0 - exp(-c * e); return pow(c, vec3(1.0 / 2.2)); }
// Screen point: aspect-safe, the long axis spans about 1.6 units.
vec2 screenUV(){
  vec2 fc = gl_FragCoord.xy - 0.5 * uRes - uOff;
  return fc / min(uRes.x / 1.6, uRes.y / 0.82);
}
float sphereHit(vec3 ro, vec3 rd, vec3 c, float r){
  vec3 oc = ro - c; float b = dot(oc, rd), q = dot(oc, oc) - r * r, h = b * b - q;
  if (h < 0.0) return -1.0; h = sqrt(h);
  float t = -b - h; return t > 0.0 ? t : (-b + h > 0.0 ? 0.0 : -1.0);
}
`;

// ── HOLE ───────────────────────────────────────────────────────────────────
// Units G = c = M = 1, so r_s = 2. A photon path in Schwarzschild obeys
// x'' = -(3/2) r_s h^2 x / r^5 with h = |x cross x'| (Binet's equation
// written in Cartesian form). RK4 with a step that grows with r.
export const HOLE = COMMON + `
uniform vec3 uCamPos, uCamTgt;
uniform float uZoom;
uniform float uDiskOn, uShiftOn, uLensOn;
uniform float uRin, uRout;

vec3 accel(vec3 x, float h2){ float r2 = dot(x, x); return -3.0 * h2 * x / (r2 * r2 * sqrt(r2)); }

// Disk colour at radius r for a photon of angular momentum lz (about +y).
vec4 diskEmit(vec3 p, float lz){
  float r = length(p.xz);
  if (r < uRin || r > uRout) return vec4(0.0);
  float x = uRin / r;
  float T = 7500.0 * pow(x, 0.75) * pow(max(0.0, 1.0 - sqrt(x)), 0.25) / 0.488;
  // g = sqrt(1 - 3/r) / (1 - Omega lz): emitter on a circular orbit,
  // Omega = r^(-3/2); the first factor is time dilation and gravity.
  float g = sqrt(max(0.0, 1.0 - 3.0 / r)) / (1.0 - pow(r, -1.5) * lz);
  g = mix(1.0, g, uShiftOn);
  float ang = atan(p.z, p.x), om = pow(r, -1.5);
  float k = fract(uTime / 30.0), w1 = abs(1.0 - 2.0 * k);
  float a1 = ang - om * mod(uTime, 30.0) * 6.0, a2 = ang - om * mod(uTime + 15.0, 30.0) * 6.0;
  float n = mix(fbm3(vec3(log(r) * 6.0, cos(a2) * 3.0, sin(a2) * 3.0) + 5.0), fbm3(vec3(log(r) * 6.0, cos(a1) * 3.0, sin(a1) * 3.0)), w1);
  float Tobs = T * g;
  float I = 0.6 * pow(Tobs / 7500.0, 4.0) * (0.75 + 0.5 * n);
  float edge = smoothstep(uRin, uRin * 1.08, r) * (1.0 - smoothstep(uRout * 0.8, uRout, r));
  float a = clamp(edge * (0.8 + 0.2 * n), 0.0, 1.0);
  return vec4(blackbody(Tobs * 0.8) * I * edge, a);
}

void main(){
  vec2 uv = screenUV();
  vec3 x = uCamPos;
  vec3 v = normalize(lookAt(x, uCamTgt) * vec3(uv, uZoom));
  vec3 L = cross(x, v); float h2 = dot(L, L);
  float lz = -L.y;            // the photon runs the other way: from disk to us
  vec3 col = vec3(0.0); float trans = 1.0;
  bool captured = false;
  // GEODESIC STEP
  for (int i = 0; i < 260; i++){
    float r = length(x);
    if (r < 2.0){ captured = true; break; }
    if (r > 60.0 && dot(x, v) > 0.0) break;
    float dt = clamp(0.07 * r, 0.03, 1.6);
    vec3 x0 = x;
    if (uLensOn > 0.5){
      vec3 k1v = accel(x, h2),                       k1x = v;
      vec3 k2v = accel(x + 0.5 * dt * k1x, h2),      k2x = v + 0.5 * dt * k1v;
      vec3 k3v = accel(x + 0.5 * dt * k2x, h2),      k3x = v + 0.5 * dt * k2v;
      vec3 k4v = accel(x + dt * k3x, h2),            k4x = v + dt * k3v;
      x += dt / 6.0 * (k1x + 2.0 * k2x + 2.0 * k3x + k4x);
      v += dt / 6.0 * (k1v + 2.0 * k2v + 2.0 * k3v + k4v);
    } else {
      x += v * dt;
    }
    // Disk crossing: the sign of y changes inside this step.
    if (uDiskOn > 0.5 && x0.y * x.y < 0.0){
      vec3 p = mix(x0, x, x0.y / (x0.y - x.y));
      vec4 e = diskEmit(p, lz);
      col += trans * e.rgb; trans *= 1.0 - e.a;
      if (trans < 0.02) break;
    }
  }
  if (!captured && trans > 0.02){ vec3 d = normalize(v); col += trans * starField(d); }
  fragColor = vec4(tonemap(col, 0.4), 1.0);
}`;
