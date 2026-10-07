// ============================================================================
//  ANCIENT EARTH  ·  shaders.js  ·  GLSL ES 3.0 source for globe.js
// ----------------------------------------------------------------------------
//  three.js r160 ShaderMaterial (WebGL 2) compiles these with its own
//  prefix (#version 300 es, varying, gl_FragColor). No WGSL here.
//
//  Units: the planet radius is 1. Atmosphere: single scattering, Rayleigh
//  (8 km scale height) + Mie (1.2 km), top at 100 km, sea-level
//  coefficients of the usual clear-sky model, scaled to planet radii.
//  ATMOS     ray-sphere, densities, the in-scatter march, sun transmittance
//  NOISE     value noise and fbm on the sphere (clouds, coast detail, waves)
//  (the surface bake and the planet shader are in surface.js)
//  SKY_*     the shell: in-scatter for rays that miss the planet
//  RIDE      plate rotation in a vertex shader (quaternion texture);
//            globe.js puts it before LINE_VERT, IDX_VERT and PTS_VERT
//  LINE_*    overlay lines that ride the plates
//  IDX_*     the paleo polygon index map, drawn as points per frame
//  STAR_*    the star field
//
//  grep -n targets
//    scattering march ...... "vec3 inscatter("
//    plate rotation in VS .. "vec3 rideQ("
// ============================================================================

export const ATMOS = /* glsl */`
const float RA = 1.0157;            // atmosphere top (100 km)
const float HR = 0.0012557;         // 8 km / 6371 km
const float HM = 0.00018835;        // 1.2 km
const vec3  BR = vec3(5.802e-6, 13.558e-6, 33.1e-6) * 6371000.0;
const float BM = 3.996e-6 * 6371000.0;
const float BMX = 4.40e-6 * 6371000.0;   // Mie extinction
const float G_MIE = 0.8;
const float PI = 3.14159265;
const float SUN = 6.0;            // sun irradiance (arbitrary units; uExposure scales the result)

vec2 raySphere(vec3 o, vec3 d, float r) {
  float b = dot(o, d), c = dot(o, o) - r * r, h = b * b - c;
  if (h < 0.0) return vec2(1e9, -1e9);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}
vec2 density(vec3 p) {
  float h = max(0.0, length(p) - 1.0);
  return vec2(exp(-h / HR), exp(-h / HM));
}
vec3 extinct(vec2 od) { return exp(-(BR * od.x + BMX * od.y)); }
// Optical depth from p toward the sun to the top of the atmosphere.
vec2 sunDepth(vec3 p, vec3 L, int n) {
  vec2 hit = raySphere(p, L, RA);
  float len = max(hit.y, 0.0), ds = len / float(n);
  vec2 od = vec2(0.0);
  for (int i = 0; i < 8; i++) {
    if (i >= n) break;
    od += density(p + L * (ds * (float(i) + 0.5))) * ds;
  }
  // a ray through the planet: no light
  vec2 g = raySphere(p, L, 0.999);
  if (g.x > 0.0) od += vec2(1e4);
  return od;
}
// In-scatter along o + d * [t0, t1], with the view transmittance in trans.
vec3 inscatter(vec3 o, vec3 d, float t0, float t1, vec3 L, int n, int nl, out vec3 trans) {
  float ds = (t1 - t0) / float(n);
  vec2 odv = vec2(0.0);
  vec3 sr = vec3(0.0), sm = vec3(0.0);
  for (int i = 0; i < 16; i++) {
    if (i >= n) break;
    vec3 p = o + d * (t0 + ds * (float(i) + 0.5));
    vec2 dn = density(p) * ds;
    odv += dn;
    vec3 tr = extinct(odv + sunDepth(p, L, nl));
    sr += dn.x * tr; sm += dn.y * tr;
  }
  trans = extinct(odv);
  float mu = dot(d, L);
  float pr = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float g2 = G_MIE * G_MIE;
  float pm = 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * G_MIE * mu, 1.5));
  return sr * BR * pr + sm * BM * pm;
}
vec3 tonemap(vec3 c, float exposure) {
  c *= exposure;
  // ACES fit (Narkowicz 2015)
  c = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
  // ACES greys out mid colours; give back a little saturation
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = clamp(mix(vec3(l), c, 1.18), 0.0, 1.0);
  return pow(c, vec3(1.0 / 2.2));
}
`;

export const NOISE = /* glsl */`
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = hash13(i), b = hash13(i + vec3(1,0,0)), c = hash13(i + vec3(0,1,0)), d = hash13(i + vec3(1,1,0));
  float e = hash13(i + vec3(0,0,1)), f1 = hash13(i + vec3(1,0,1)), g = hash13(i + vec3(0,1,1)), h = hash13(i + vec3(1,1,1));
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, f1, u.x), mix(g, h, u.x), u.y), u.z);
}
float fbm(vec3 p, int oct) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 7; i++) {
    if (i >= oct) break;
    s += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5;
  }
  return s;
}
`;

export const SKY_VERT = /* glsl */`
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
export const SKY_FRAG = /* glsl */`
precision highp float;
uniform vec3 uSun;
uniform float uExposure, uQuality, uMap;
varying vec3 vWorld;
${ATMOS}
void main() {
  vec3 o = cameraPosition, d = normalize(vWorld - o);
  vec2 ha = raySphere(o, d, RA);
  vec2 hp = raySphere(o, d, 1.0);
  if (hp.x > 0.0 && hp.x < 1e8) discard;    // the planet shader draws these pixels
  float t0 = max(ha.x, 0.0), t1 = ha.y;
  if (t1 <= t0) discard;
  vec3 trans;
  vec3 L = normalize(uSun);
  vec3 ins = inscatter(o, d, t0, t1, L, uQuality > 0.5 ? 14 : 8, uQuality > 0.5 ? 5 : 3, trans);
  vec3 c = ins * SUN;
  if (uMap > 0.5) {
    // map modes: an even pale rim, not lit by the sun
    float h = clamp((length(o + d * (0.5 * (t0 + t1))) - 1.0) / (RA - 1.0), 0.0, 1.0);
    vec3 rim = vec3(0.35, 0.55, 0.9) * (1.0 - h) * 0.6;
    gl_FragColor = vec4(pow(rim, vec3(1.0 / 2.2)), 1.0);
    return;
  }
  gl_FragColor = vec4(tonemap(c, uExposure), 1.0);
}
`;

// Lines that ride plates. Attributes: ll (present lat, lon in radians), poly
// (polygon index; 255 = fixed to the paleo grid). uQ is a 256x1 RGBA float
// texture of rotation quaternions (x, y, z, w) per polygon, zero = absent.
export const RIDE = /* glsl */`
uniform sampler2D uQ;
vec3 qrot(vec4 q, vec3 v) { vec3 t = 2.0 * cross(q.xyz, v); return v + q.w * t + cross(q.xyz, t); }
// present lat/lon -> rotated unit vector in three.js axes, w = alive
vec4 rideQ(vec2 ll, float poly) {
  vec3 v = vec3(cos(ll.x) * cos(ll.y), cos(ll.x) * sin(ll.y), sin(ll.x));   // model axes, z north
  vec4 q = texelFetch(uQ, ivec2(int(poly + 0.5), 0), 0);
  float alive = dot(q, q) > 0.5 ? 1.0 : 0.0;
  v = qrot(q, v);
  return vec4(v.y, v.z, v.x, alive);
}
`;
export const LINE_VERT = /* glsl */`
attribute vec2 ll;
attribute float poly;
attribute vec3 color;
uniform float uR;
varying float vAlive;
varying vec3 vN;
varying vec3 vC;
void main() {
  vec4 r = rideQ(ll, poly);
  vAlive = r.w;
  vC = color;
  vec4 w = modelMatrix * vec4(r.xyz * uR, 1.0);
  vN = normalize(w.xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
  if (r.w < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;
export const LINE_FRAG = /* glsl */`
precision highp float;
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlive;
varying vec3 vN;
varying vec3 vC;
void main() {
  if (vAlive < 0.5) discard;
  float limb = smoothstep(0.0, 0.25, dot(vN, normalize(cameraPosition)));
  gl_FragColor = vec4(uColor * vC, uOpacity * (0.35 + 0.65 * limb));
}
`;

// Paleo index map: one point per present-day 0.5 deg land cell, placed at
// its reconstructed lat/lon in an equirectangular target. R = index / 255.
export const IDX_VERT = /* glsl */`
attribute vec2 ll;
attribute float poly;
varying float vPoly;
varying float vAlive;
void main() {
  vec4 r = rideQ(ll, poly);
  vec3 v = r.xyz;
  float lat = asin(clamp(v.y, -1.0, 1.0)), lon = atan(v.x, v.z);
  vPoly = poly; vAlive = r.w;
  gl_Position = vec4(lon / 3.14159265, lat / 1.5707963, 0.0, 1.0);
  gl_PointSize = 2.6;
  if (r.w < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;
export const IDX_FRAG = /* glsl */`
precision highp float;
varying float vPoly;
varying float vAlive;
void main() { gl_FragColor = vec4(vPoly / 255.0, 0.0, 0.0, 1.0); }
`;

// Points that ride plates (fossils). Attributes: ll, poly, age (max, min),
// grp (colour row). uT: the age now. A point shows inside its age range,
// widened by uWin.
export const PTS_VERT = /* glsl */`
attribute vec2 ll;
attribute float poly;
attribute vec2 age;
attribute vec3 color;
uniform float uT, uWin, uSize, uPix;
varying vec3 vColor;
varying float vA;
void main() {
  vec4 r = rideQ(ll, poly);
  float inAge = step(age.y - uWin, uT) * step(uT, age.x + uWin);
  vec4 w = modelMatrix * vec4(r.xyz * 1.003, 1.0);
  vec3 n = normalize(w.xyz);
  float face = dot(n, normalize(cameraPosition - w.xyz));
  vA = r.w * inAge * smoothstep(0.0, 0.2, face);
  vColor = color;
  gl_Position = projectionMatrix * viewMatrix * w;
  gl_PointSize = uSize * uPix;
  if (vA < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;
export const PTS_FRAG = /* glsl */`
precision highp float;
varying vec3 vColor;
varying float vA;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = length(c);
  if (r > 1.0) discard;
  float core = smoothstep(1.0, 0.55, r);
  float ring = smoothstep(0.62, 0.78, r) * (1.0 - smoothstep(0.86, 1.0, r));
  vec3 col = mix(vColor, vec3(0.03), ring * 0.8);
  gl_FragColor = vec4(col, vA * core);
}
`;

export const STAR_VERT = /* glsl */`
attribute float mag;
attribute vec3 color;
uniform float uPix;
varying vec3 vColor;
varying float vB;
void main() {
  vColor = color;
  vB = pow(10.0, -0.4 * (mag - 1.0));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(2.2 * uPix * sqrt(vB), 1.0, 4.0 * uPix);
}
`;
export const STAR_FRAG = /* glsl */`
precision highp float;
varying vec3 vColor;
varying float vB;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float a = exp(-dot(c, c) * 4.0);
  gl_FragColor = vec4(vColor * min(1.0, vB) * a, 1.0);
}
`;

// A pin's trail: its paleo position at each age (precomputed), brightest
// near the age now.
export const TRAIL_VERT = /* glsl */`
attribute float age;
varying float vAge;
void main() {
  vAge = age;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;
export const TRAIL_FRAG = /* glsl */`
precision highp float;
uniform vec3 uColor;
uniform float uT;
varying float vAge;
void main() {
  float near = exp(-abs(vAge - uT) / 25.0);
  float past = step(uT, vAge);            // ages older than now: the road already travelled
  gl_FragColor = vec4(uColor * (0.6 + 0.8 * near), 0.25 + 0.35 * past + 0.4 * near);
}
`;
