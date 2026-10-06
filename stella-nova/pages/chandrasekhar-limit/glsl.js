// ============================================================================
//  CHANDRASEKHAR LIMIT  ·  glsl.js — fragment shaders (WebGL 2, GLSL ES 3.00)
// ----------------------------------------------------------------------------
//  Each export is the source of one full-screen fragment shader. glkit.js
//  draws it with one triangle. The sources are strings in a module, so the
//  saver can show a real extract on its plate (saver.js).
//
//  SHADERS   (jump with grep -n "<anchor>" glsl.js)
//    COMMON ........ "export const COMMON"   hash, value noise, fbm, black
//                                            body colour, star field, sky
//    HERO .......... "export const HERO"     binary: donor star, stream,
//                                            disk, white dwarf; Type Ia
//                                            flash; collapse to a neutron
//                                            star or a black hole
//    HOLE .......... "export const HOLE"     Schwarzschild geodesic tracer
//                                            with a thin disk, Doppler and
//                                            gravitational shift
//    GEODESIC ...... "// GEODESIC STEP"       the integration loop in HOLE
//    NEBULA ........ "export const NEBULA"   a planetary nebula of our own,
//                                            ray-marched, with its dwarf
//    DWARF ......... "export const DWARF"    white-dwarf cutaway coloured by
//                                            the solved density profile,
//                                            next to the Earth for scale
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
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
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
    float b = pow(hash13(c + 7.0), l == 0 ? 20.0 : 30.0) * (l == 0 ? 9.0 : 4.0);
    col += b * blackbody(2800.0 + 9000.0 * h.z * h.z) * exp(-r2 * (l == 0 ? 260.0 : 420.0));
  }
  return col;
}

// A far emission nebula on the sky: domain-warped fbm. Red is H-alpha,
// teal is [O III]; dust lanes darken it.
vec3 nebulaSky(vec3 d){
  vec3 q = d * 2.1;
  vec3 w = vec3(fbm3(q), fbm3(q + vec3(5.2, 1.3, 2.8)), fbm3(q + vec3(2.1, 7.7, 4.4)));
  float n = fbm(q + 1.9 * w);
  float dust = fbm3(q * 2.6 + 2.0 * w);
  float m = smoothstep(0.42, 0.86, n);
  vec3 ha = vec3(0.95, 0.20, 0.34), o3 = vec3(0.12, 0.62, 0.78), gold = vec3(1.0, 0.62, 0.30);
  vec3 col = mix(o3, ha, smoothstep(0.32, 0.68, w.x)) * m * 0.50;
  col += gold * m * m * m * 0.30;
  col *= 1.0 - 0.75 * smoothstep(0.48, 0.80, dust);
  return col + vec3(0.006, 0.008, 0.016);
}
vec3 sky(vec3 d){ return nebulaSky(d) + starField(d); }

mat3 lookAt(vec3 ro, vec3 ta){
  vec3 f = normalize(ta - ro), r = normalize(cross(f, vec3(0.0, 1.0, 0.0))), u = cross(r, f);
  return mat3(r, u, f);
}
vec3 saturate3(vec3 c, float k){ float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); return max(vec3(0.0), mix(vec3(l), c, k)); }
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

// ── HERO ───────────────────────────────────────────────────────────────────
export const HERO = COMMON + `
uniform vec3 uCamPos, uCamTgt;
uniform float uZoom;
uniform float uPhase;     // orbital phase, rad
uniform float uWDr;       // white-dwarf radius, scene units (log-scaled from the model)
uniform float uMass;      // M / M_Ch
uniform float uFlash;     // s since the Type Ia flash, < 0: none
uniform float uColl;      // s since the core collapse, < 0: none
uniform int uMode;        // 0 Type Ia, 1 neutron star, 2 black hole
uniform float uFlow;      // stream brightness 0..1

const float SEP = 3.0;    // separation; the donor fills its Roche lobe
vec3 donorPos(){ return SEP * vec3(-cos(uPhase), 0.0, -sin(uPhase)); }

float sdDonor(vec3 p, vec3 c){
  vec3 q = p - c; float r = length(q);
  float tip = max(0.0, dot(q / max(r, 1e-4), -normalize(c)));
  return (r - 1.05 * (1.0 + 0.30 * pow(tip, 5.0))) * 0.8;
}
// Ballistic stream from L1 to the disk rim, in the frame that turns with
// the binary: u points from the dwarf to the donor, v along the motion.
vec2 bez(vec2 a, vec2 b, vec2 c, float t){ return mix(mix(a, b, t), mix(b, c, t), t); }
float streamDist(vec2 p, out float s){
  vec2 A = vec2(1.78, 0.0), B = vec2(0.95, 0.72), C = vec2(-0.20, 0.97);
  float best = 1e9; s = 0.0; vec2 prev = A;
  for (int i = 1; i <= 12; i++){
    float t = float(i) / 12.0; vec2 cur = bez(A, B, C, t);
    vec2 pa = p - prev, ba = cur - prev; float hh = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    float d = length(pa - ba * hh);
    if (d < best){ best = d; s = (float(i) - 1.0 + hh) / 12.0; }
    prev = cur;
  }
  return best;
}
float collR(){ // radius of the collapsing core
  if (uColl < 0.0) return uWDr;
  return mix(uWDr, 0.012, smoothstep(0.0, 0.35, uColl));
}
float holeR(){ return uMode == 2 ? 0.07 * smoothstep(2.6, 3.1, uColl) : 0.0; }

void main(){
  vec2 uv = screenUV();
  vec3 ro = uCamPos;
  vec3 rd = normalize(lookAt(ro, uCamTgt) * vec3(uv, uZoom));
  vec3 C = donorPos(), eu = normalize(C), ev = normalize(vec3(-eu.z, 0.0, eu.x));
  float rs = holeR();
  float boom = uFlash >= 0.0 ? 1.0 : 0.0;
  float wdR = collR();

  // Closest approach to the centre (impact parameter b, along-ray t).
  float tc = -dot(ro, rd); float b = length(ro + rd * tc);

  // Bend the background rays around a black hole (weak field, 2 rs / b).
  vec3 rdSky = rd;
  bool shadow = false;
  if (rs > 0.0 && tc > 0.0){
    if (b < 2.598 * rs) shadow = true;
    vec3 toC = normalize(-(ro + rd * tc));
    rdSky = normalize(rd + toC * min(1.6, 2.0 * rs / b) * smoothstep(1.4, 0.25, b));
  }
  vec3 col = sky(rdSky) * 0.75 * (1.0 - 0.5 * boom * exp(-uFlash * 0.4));

  // Opaque things: donor (sphere-traced inside its bound), dwarf, shadow.
  float tOp = 1e9; vec3 nrm = vec3(0.0); int what = 0;
  float tb = sphereHit(ro, rd, C, 1.45);
  if (tb >= 0.0){
    float t = tb;
    for (int i = 0; i < 48; i++){
      float d = sdDonor(ro + rd * t, C);
      if (d < 0.002){ tOp = t; what = 1; break; }
      t += d; if (t > tb + 3.0) break;
    }
    if (what == 1){
      vec3 p = ro + rd * tOp; vec2 e = vec2(0.002, 0.0);
      nrm = normalize(vec3(sdDonor(p + e.xyy, C) - sdDonor(p - e.xyy, C), sdDonor(p + e.yxy, C) - sdDonor(p - e.yxy, C), sdDonor(p + e.yyx, C) - sdDonor(p - e.yyx, C)));
    }
  }
  bool wdAlive = uFlash < 0.05;
  float tw = wdAlive && rs <= 0.0 ? sphereHit(ro, rd, vec3(0.0), wdR) : -1.0;
  if (tw >= 0.0 && tw < tOp){ tOp = tw; what = 2; nrm = normalize(ro + rd * tw); }
  if (shadow && tc < tOp){ tOp = tc; what = 3; }

  if (what == 1){
    vec3 p = ro + rd * tOp;
    float mu = max(0.0, dot(nrm, -rd));
    float gran = fbm(nrm * 9.0 + vec3(0.0, uTime * 0.05, 0.0));
    vec3 base = vec3(1.0, 0.26, 0.06) * (0.08 + 0.92 * pow(mu, 0.8)) * (0.45 + 1.0 * gran * gran) * 0.8;
    base += vec3(1.0, 0.55, 0.2) * pow(mu, 4.0) * 0.18;
    vec3 toWD = normalize(-p);
    float lit = max(0.0, dot(nrm, toWD));
    base += blackbody(9000.0) * lit * 0.25 * uFlow;
    if (uFlash >= 0.0) base += vec3(1.0, 0.85, 0.7) * lit * 6.0 * exp(-uFlash * 1.2);
    col = base * 1.1;
  } else if (what == 2){
    float mu = max(0.0, dot(nrm, -rd));
    col = blackbody(26000.0) * (2.2 + 1.2 * mu);
    if (uColl >= 0.0) col *= 1.0 + 6.0 * smoothstep(0.0, 0.35, uColl);
  } else if (what == 3){
    col = vec3(0.0);
  }

  // Disk and stream, both in the orbital plane y = 0.
  if (abs(rd.y) > 1e-4 && (uFlash < 0.05)){
    float tp = -ro.y / rd.y;
    if (tp > 0.0 && tp < tOp){
      vec3 P = ro + rd * tp; float r = length(P.xz);
      float rIn = rs > 0.0 ? 3.0 * rs : max(wdR * 1.25, 0.05), rOut = 1.0;
      float slant = 1.0 / max(abs(rd.y), 0.07);
      vec3 em = vec3(0.0); float tau = 0.0;
      if (r > rIn * 0.7 && r < rOut * 1.15){
        float ang = atan(P.z, P.x);
        // Kepler shear, cross-faded so the pattern never winds up for good.
        float om = 0.9 * pow(r, -1.5);
        float k = fract(uTime / 24.0), w1 = abs(1.0 - 2.0 * k);
        float t1 = mod(uTime, 24.0), t2 = mod(uTime + 12.0, 24.0);
        float n1 = fbm3(vec3(log(r) * 5.0, cos(ang - om * t1) * 2.5, sin(ang - om * t1) * 2.5));
        float n2 = fbm3(vec3(log(r) * 5.0, cos(ang - om * t2) * 2.5, sin(ang - om * t2) * 2.5) + 9.0);
        float n = mix(n2, n1, w1);
        float x = rIn / r;
        float T = 42000.0 * pow(x, 0.75) * pow(max(0.0, 1.0 - sqrt(x)), 0.25);
        float edge = smoothstep(rIn * 0.75, rIn * 1.1, r) * (1.0 - smoothstep(rOut * 0.75, rOut * 1.12, r));
        float dens = edge * (0.2 + 1.6 * n * n);
        tau += dens * 0.35 * slant;
        em += saturate3(blackbody(max(T * 0.55, 1500.0)), 1.9) * dens * (0.12 + 1.8 * pow(T / 16000.0, 2.5)) * (0.5 + 0.5 * uFlow);
        if (rs > 0.0) em *= 0.45;
      }
      vec2 q = vec2(dot(P, eu), dot(P, ev));
      float s; float d = streamDist(q, s);
      float wdt = 0.025 + 0.03 * s;
      if (d < wdt * 3.0 && uColl < 0.0){
        float blob = 0.55 + 0.45 * vnoise(vec3(s * 22.0 - uTime * 4.0, d * 30.0, 0.0));
        float st = exp(-d * d / (wdt * wdt)) * blob * uFlow;
        float hot = smoothstep(0.85, 1.0, s);
        em += (mix(vec3(1.0, 0.32, 0.42), vec3(1.0, 0.9, 0.75), hot) * (1.2 + 3.0 * hot)) * st;
        tau += st * 0.5 * slant;
      }
      float a = 1.0 - exp(-tau);
      col = col * (1.0 - a) + em * min(slant, 4.0) * 0.45;
    }
  }

  // Glows: the dwarf (it brightens and simmers near M_Ch), the new
  // neutron star, the black hole's photon ring.
  if (tc > 0.0 && tc < tOp + 0.01){
    if (wdAlive && rs <= 0.0){
      float sim = smoothstep(0.96, 1.0, uMass) * (0.6 + 0.4 * sin(uTime * 23.0) * sin(uTime * 7.3));
      col += blackbody(22000.0) * (0.25 * exp(-b / 0.3) + 2.0 * exp(-b / (wdR * 2.5))) * (1.0 + 1.5 * sim);
    }
    if (uColl >= 0.0 && rs <= 0.0){
      col += vec3(0.75, 0.85, 1.0) * exp(-b / 0.05) * 3.0;
    }
    if (rs > 0.0){
      col += vec3(1.0, 0.8, 0.55) * exp(-pow((b - 2.6 * rs) / (0.08 * rs), 2.0)) * 1.4;
    }
  }

  // Pulsar beams from the neutron star (mode 1, and mode 2 before the hole).
  if (uColl > 0.4 && (uMode == 1 || uColl < 2.8)){
    float spin = uTime * 3.2;
    vec3 ax = normalize(vec3(sin(0.5) * cos(spin), cos(0.5), sin(0.5) * sin(spin)));
    for (int k = 0; k < 2; k++){
      vec3 a = k == 0 ? ax : -ax;
      // Closest approach between the ray and the beam line through 0.
      vec3 w0 = ro; float bb = dot(rd, a), dd = dot(rd, w0), ee = dot(a, w0);
      float den = 1.0 - bb * bb; if (den < 1e-4) continue;
      float tr = (bb * ee - dd) / den, sa = (ee - bb * dd) / den;
      if (sa <= 0.0 || tr <= 0.0 || tr > tOp) continue;
      float dist = length((ro + rd * tr) - a * sa);
      float wdth = 0.015 + 0.10 * sa;
      col += vec3(0.55, 0.75, 1.0) * exp(-dist * dist / (wdth * wdth)) * exp(-sa / 2.2) * 0.9 * smoothstep(0.4, 0.9, uColl);
    }
  }
  // Neutrino-driven bounce: one fast thin shell after the collapse.
  if (uColl >= 0.0 && uColl < 1.6){
    float Rb = uColl * 4.0;
    float sh = exp(-pow((b - Rb) / 0.06, 2.0)) * step(0.0, tc);
    col += vec3(0.6, 0.8, 1.0) * sh * (1.0 - uColl / 1.6) * 1.5;
    col += vec3(1.0) * exp(-uColl * 9.0) * 0.8;
  }

  // Type Ia: a flash, then an ejecta shell that cools and thins.
  if (uFlash >= 0.0){
    float Rs = 0.12 + 0.75 * uFlash / (1.0 + 0.12 * uFlash);
    vec3 ro0 = ro;
    float t0 = sphereHit(ro0, rd, vec3(0.0), Rs * 1.15);
    if (t0 >= 0.0){
      vec3 oc = ro0; float bq = dot(oc, rd), h = sqrt(max(0.0, bq * bq - dot(oc, oc) + Rs * Rs * 1.3225));
      float t1 = min(-bq + h, tOp);
      float dt = (t1 - t0) / 28.0; vec3 acc = vec3(0.0);
      float cool = smoothstep(0.0, 4.0, uFlash);
      for (int i = 0; i < 28; i++){
        vec3 p = ro0 + rd * (t0 + (float(i) + 0.5) * dt);
        float r = length(p) / Rs;
        vec3 nd = p / max(length(p), 1e-4);
        float fil = fbm(nd * 4.0 + vec3(uFlash * 0.05) + 0.6 * vnoise(p * 3.0 / Rs));
        float knot = smoothstep(0.45, 0.75, fil);
        float shell = exp(-pow((r - 0.88) / 0.09, 2.0)) * (0.1 + 2.2 * knot * knot) + 0.12 * smoothstep(0.95, 0.4, r) * knot;
        vec3 hotc = mix(vec3(1.0, 0.92, 0.75), vec3(1.0, 0.42, 0.14), cool);
        // Late: knots in the false colours of X-ray images (iron red, silicon gold, rim blue).
        float hue = fbm3(nd * 6.0 + 3.0);
        vec3 xr = mix(mix(vec3(1.0, 0.18, 0.12), vec3(1.0, 0.75, 0.2), smoothstep(0.35, 0.6, hue)), vec3(0.3, 0.55, 1.0), smoothstep(0.8, 0.97, r));
        acc += mix(hotc, xr * 1.4, smoothstep(2.0, 5.0, uFlash)) * shell * dt;
      }
      col += acc * (2.2 * exp(-uFlash * 0.45) + 0.35) / max(Rs, 0.3);
    }
    col += vec3(1.0, 0.95, 0.9) * (exp(-b / (0.08 + 0.3 * uFlash)) * 10.0 * exp(-uFlash * 1.8));
    col += vec3(1.0) * exp(-uFlash * 4.0) * 1.0;
  }

  vec2 v = gl_FragCoord.xy / uRes - 0.5;
  col *= 1.0 - 0.35 * dot(v, v);
  fragColor = vec4(tonemap(col, 1.15), 1.0);
}`;

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
  float I = 0.9 * pow(Tobs / 7500.0, 4.0) * (0.25 + 1.5 * n * n);
  float edge = smoothstep(uRin, uRin * 1.08, r) * (1.0 - smoothstep(uRout * 0.8, uRout, r));
  float a = clamp(edge * (0.55 + 0.6 * n), 0.0, 1.0);
  return vec4(saturate3(blackbody(Tobs * 0.6), 1.8) * I * edge, a);
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
  if (!captured && trans > 0.02){ vec3 d = normalize(v); col += trans * (nebulaSky(d) * 0.22 + starField(d)); }
  vec2 q = gl_FragCoord.xy / uRes - 0.5;
  col *= 1.0 - 0.3 * dot(q, q);
  fragColor = vec4(tonemap(col, 0.9), 1.0);
}`;

// ── NEBULA ─────────────────────────────────────────────────────────────────
// A planetary nebula: the shed envelope of a giant around its hot core.
// The density is a thick shell, pinched at the waist (bipolar), broken
// by ridged fbm into filaments and knots. Inner gas glows in [O III]
// (teal), outer gas in H-alpha and [N II] (red). The core is the dwarf.
export const NEBULA = COMMON + `
uniform vec3 uCamPos, uCamTgt;
uniform float uZoom;
uniform float uAge;      // 0..1: shell radius and thinning
uniform float uPinch;    // 0 round .. 1 bipolar

float ridged(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * (1.0 - abs(2.0 * vnoise(p) - 1.0)); p = p * 2.1 + 3.7; a *= 0.5; } return s; }
float dens(vec3 p, out float rr){
  float pinch = 1.0 + uPinch * 1.4 * (1.0 - abs(p.y) / max(length(p), 1e-3));
  vec3 q = p * vec3(pinch, 1.0, pinch);
  float r = length(q); rr = r;
  float R = 0.55 + 0.55 * uAge, w = 0.09 + 0.07 * uAge;
  float shell = exp(-pow((r - R) / w, 2.0));
  float inner = 0.55 * smoothstep(R * 0.95, R * 0.3, r);
  float halo = 0.05 * exp(-pow((r - R * 1.5) / (w * 2.5), 2.0));
  float fil = ridged(p * 3.2 + vec3(0.0, 0.0, uTime * 0.01));
  float knots = smoothstep(0.62, 0.9, fbm3(p * 7.0));
  float f3 = fil * fil * fil;
  return (shell * (0.08 + 2.4 * f3) + halo * f3 + inner * (0.3 + fil)) * (1.0 - 0.7 * knots);
}

void main(){
  vec2 uv = screenUV();
  vec3 ro = uCamPos;
  vec3 rd = normalize(lookAt(ro, uCamTgt) * vec3(uv, uZoom));
  vec3 col = (nebulaSky(rd) * 0.2 + starField(rd));
  float R = 0.55 + 0.55 * uAge, Rb = R * 2.4;
  vec3 oc = ro; float bq = dot(oc, rd), c = dot(oc, oc) - Rb * Rb, h = bq * bq - c;
  float tc = -bq, b = length(ro + rd * tc);
  if (h > 0.0){
    h = sqrt(h);
    float t0 = max(0.0, -bq - h), t1 = -bq + h;
    const int N = 64;
    float dt = (t1 - t0) / float(N);
    float jit = hash13(vec3(gl_FragCoord.xy, uTime));
    vec3 acc = vec3(0.0); float tr = 1.0;
    for (int i = 0; i < N; i++){
      vec3 p = ro + rd * (t0 + (float(i) + jit) * dt);
      float rr; float d = dens(p, rr);
      float ion = smoothstep(R * 0.97, R * 0.75, rr);
      vec3 em = mix(vec3(1.0, 0.1, 0.16), vec3(0.02, 0.85, 0.72), ion) + vec3(0.9, 0.35, 0.1) * smoothstep(R * 1.2, R * 1.6, rr) * 0.5;
      acc += tr * em * d * dt * (1.0 + 0.6 * ion);
      tr *= exp(-d * dt * 0.9 * smoothstep(0.55, 0.85, fbm3(p * 5.0)));
    }
    col = col * tr + acc;
  }
  // The hot core: the new white dwarf, with a blue-white glow.
  if (tc > 0.0) col += blackbody(90000.0) * (exp(-b / 0.012) * 4.0 + exp(-b / 0.08) * 0.35);
  vec2 q = gl_FragCoord.xy / uRes - 0.5;
  col *= 1.0 - 0.35 * dot(q, q);
  fragColor = vec4(tonemap(saturate3(col, 1.25), 1.1), 1.0);
}`;

// ── DWARF ──────────────────────────────────────────────────────────────────
// A white dwarf with a quarter cut away, beside the Earth (radius 1 =
// 6371 km). The cut faces show rho(r) / rho_c from the solved model
// (uRho, 48 samples from centre to surface). A cyan ring marks x = 1:
// inside it the electrons at the top of the Fermi sea move faster than
// 0.7 c. The speckle moves at the Fermi speed v_F / c (uVf).
export const DWARF = COMMON + `
uniform vec3 uCamPos, uCamTgt;
uniform float uZoom;
uniform float uR;          // dwarf radius in Earth radii
uniform vec3 uWD;          // dwarf centre
uniform vec3 uEarth;       // Earth centre
uniform float uRel;        // r / R where x = 1 (0 if none)
uniform float uRho[48];
uniform float uVf[48];

float rhoAt(float s){ float f = clamp(s, 0.0, 1.0) * 47.0; int i = int(floor(f)); int j = min(i + 1, 47); return mix(uRho[i], uRho[j], fract(f)); }
float vfAt(float s){ float f = clamp(s, 0.0, 1.0) * 47.0; int i = int(floor(f)); int j = min(i + 1, 47); return mix(uVf[i], uVf[j], fract(f)); }
vec3 heat(float t){ // dark red -> orange -> yellow -> white-blue
  t = clamp(t, 0.0, 1.0);
  vec3 a = vec3(0.10, 0.01, 0.03), b2 = vec3(0.75, 0.10, 0.08), c = vec3(1.0, 0.55, 0.12), d = vec3(1.0, 0.95, 0.6), e = vec3(0.85, 0.95, 1.0);
  if (t < 0.25) return mix(a, b2, t / 0.25);
  if (t < 0.5) return mix(b2, c, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c, d, (t - 0.5) / 0.25);
  return mix(d, e, (t - 0.75) / 0.25);
}
// Sphere minus the wedge x > 0, z > 0 (in the dwarf's frame).
float sdCut(vec3 p, float R){ return max(length(p) - R, -max(-p.x, -p.z)); }

void main(){
  vec2 uv = screenUV();
  vec3 ro = uCamPos;
  vec3 rd = normalize(lookAt(ro, uCamTgt) * vec3(uv, uZoom));
  vec3 col = sky(rd) * 0.5;
  float tOp = 1e9;

  // Earth.
  float te = sphereHit(ro, rd, uEarth, 1.0);
  if (te > 0.0){
    tOp = te;
    vec3 n = normalize(ro + rd * te - uEarth);
    float ang = uTime * 0.05;
    vec3 m = vec3(n.x * cos(ang) - n.z * sin(ang), n.y, n.x * sin(ang) + n.z * cos(ang));
    float land = smoothstep(0.52, 0.56, fbm(m * 2.2));
    float cloud = smoothstep(0.55, 0.75, fbm(m * 4.0 + vec3(uTime * 0.02)));
    vec3 base = mix(vec3(0.03, 0.12, 0.32), mix(vec3(0.12, 0.30, 0.10), vec3(0.45, 0.38, 0.22), fbm3(m * 6.0)), land);
    base = mix(base, vec3(0.85), smoothstep(0.86, 0.93, abs(n.y)));
    base = mix(base, vec3(0.95), cloud * 0.8);
    vec3 Ldir = normalize(uWD - uEarth);
    float dif = max(0.0, dot(n, Ldir)) * 0.9 + 0.08;
    col = base * dif * vec3(0.85, 0.92, 1.1) * 1.4;
    col += vec3(0.3, 0.5, 1.0) * pow(1.0 - max(0.0, dot(n, -rd)), 3.0) * 0.6;
  }

  // Dwarf (sphere-traced, the cut makes it non-convex).
  vec3 lo = ro - uWD;
  float tb = sphereHit(lo, rd, vec3(0.0), uR * 1.01);
  if (tb >= 0.0){
    float t = tb; bool hit = false;
    for (int i = 0; i < 64; i++){
      float d = sdCut(lo + rd * t, uR);
      if (d < 1e-4 * max(uR, 0.1)){ hit = true; break; }
      t += d; if (t > tb + 2.2 * uR) break;
    }
    if (hit && t < tOp){
      tOp = t;
      vec3 p = lo + rd * t;
      float s = length(p) / uR;
      bool onCut = abs(length(p) - uR) > 2e-3 * uR;
      if (!onCut){
        vec3 n = normalize(p);
        float mu = max(0.0, dot(n, -rd));
        col = blackbody(25000.0) * (0.55 + 0.45 * mu) * 2.2 * (0.92 + 0.16 * fbm(n * 14.0 + uTime * 0.03));
      } else {
        float rho = rhoAt(s);
        float lt = clamp(1.0 + log(max(rho, 1e-6)) / log(3e3), 0.0, 1.0);   // 3.5 decades
        vec3 c = heat(pow(lt, 1.25));
        // Electron speckle: its scroll speed is the local Fermi speed.
        float vf = vfAt(s);
        float sp = vnoise(vec3(p / uR * 38.0 + vec3(0.0, uTime * 6.0 * vf, uTime * 4.0 * vf)));
        c *= 0.82 + 0.36 * sp;
        // The thin non-degenerate envelope (drawn 2 % thick).
        c = mix(c, vec3(0.35, 0.45, 0.9), smoothstep(0.975, 0.99, s) * 0.8);
        if (uRel > 0.0) c += vec3(0.25, 0.95, 1.0) * exp(-pow((s - uRel) / 0.008, 2.0)) * 1.6;
        float ring = 1.0 - smoothstep(0.0, 0.012, abs(fract(s * 5.0 + 0.5) - 0.5) / 5.0);
        c *= 1.0 - 0.12 * ring;
        col = c * 1.25;
      }
    }
  }
  // Soft glow of the dwarf.
  float tcw = -dot(lo, rd), bw = length(lo + rd * tcw);
  if (tcw > 0.0 && tcw < tOp + 0.01) col += blackbody(25000.0) * exp(-(bw - uR) / (0.15 * uR + 0.05)) * 0.25 * step(uR, bw);
  vec2 q = gl_FragCoord.xy / uRes - 0.5;
  col *= 1.0 - 0.3 * dot(q, q);
  fragColor = vec4(tonemap(col, 1.0), 1.0);
}`;
