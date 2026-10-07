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
//  EARTH_*   the planet: DEM sampling (cubic B-spline over 1 deg cells,
//            blended between two frames), biome colour, ocean, clouds,
//            lights, map colour modes, hillshade, aerial perspective
//  SKY_*     the shell: in-scatter for rays that miss the planet
//  RIDE      plate rotation in a vertex shader (quaternion texture);
//            globe.js puts it before LINE_VERT, IDX_VERT and PTS_VERT
//  LINE_*    overlay lines that ride the plates
//  IDX_*     the paleo polygon index map, drawn as points per frame
//  STAR_*    the star field
//
//  grep -n targets
//    scattering march ...... "vec3 inscatter("
//    biome colour .......... "vec3 biome("
//    colour maps ........... "vec3 cmap("
//    earth main ............ "EARTH_FRAG"
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

export const EARTH_VERT = /* glsl */`
varying vec3 vObj;
varying vec3 vWorld;
void main() {
  vObj = normalize(position);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const EARTH_FRAG = /* glsl */`
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uDem;
uniform sampler2D uIdx, uPal, uLights, uLut;
uniform float uLayA, uLayB, uMix;
uniform vec3 uSun;            // world direction to the sun
uniform mat3 uRot;            // globe object -> world
uniform float uTime, uExag, uSea, uTeq, uDT, uVeg, uTall, uGrass, uLightsK, uClouds, uExposure;
uniform int uMode;            // 0 realistic, 1 hypsometric, 2 grey, 3 magma, 4 viridis, 5 inferno, 6 turbo, 7 outline
uniform int uTint;            // 0 none, 1 plates, 2 modern continent
uniform float uHill, uHillAz, uHillAlt, uTintK, uDetail, uQuality;
varying vec3 vObj;
varying vec3 vWorld;
${ATMOS}
${NOISE}

const vec2 DEM = vec2(360.0, 181.0);
vec2 bspline(float layer, vec2 uv) {
  vec2 p = uv * DEM - 0.5, f = fract(p); p -= f;
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 h0 = (w1 / g0) - 0.5 + p, h1 = (w3 / g1) + 1.5 + p;
  vec2 a = texture(uDem, vec3(vec2(h0.x, h0.y) / DEM, layer)).rg;
  vec2 b = texture(uDem, vec3(vec2(h1.x, h0.y) / DEM, layer)).rg;
  vec2 c = texture(uDem, vec3(vec2(h0.x, h1.y) / DEM, layer)).rg;
  vec2 d = texture(uDem, vec3(vec2(h1.x, h1.y) / DEM, layer)).rg;
  return mix(mix(a, b, g1.x), mix(c, d, g1.x), g1.y);
}
// RG = code, coast distance (0..1). Elevation in metres from the code.
float decodeZ(float c) {
  c *= 255.0;
  if (c < 127.5) { float s = (127.0 - c) / 127.0; return -9000.0 * s * s; }
  float s = max(0.0, c - 128.0) / 127.0; return 6000.0 * s * s;
}
// elevation (m) and inland distance (km) at a paleo point
vec2 sampleZ(vec2 uv) {
  vec2 a = bspline(uLayA, uv), b = bspline(uLayB, uv);
  float z = mix(decodeZ(a.r), decodeZ(b.r), uMix);
  return vec2(z, mix(a.g, b.g, uMix) * 255.0 * 16.0);
}

vec3 cmap(float x) { return texture(uLut, vec2(clamp(x, 0.0, 1.0) * 0.996 + 0.002, (float(uMode - 3) + 0.5) / 4.0)).rgb; }
float signedSqrt(float z) { return z < 0.0 ? 0.5 - 0.5 * sqrt(-z / 9000.0) : 0.5 + 0.5 * sqrt(z / 6000.0); }
vec3 srgb2lin(vec3 c) { return pow(c, vec3(2.2)); }
float sq(float x) { return x * x; }   // pow(x, 2.0) is undefined for x < 0 in GLSL

// Hypsometric tint: atlas colours, land and sea (linear RGB).
vec3 hypso(float z) {
  if (z < 0.0) {
    float d = -z;
    vec3 c = mix(vec3(0.62, 0.84, 0.94), vec3(0.36, 0.62, 0.85), smoothstep(0.0, 200.0, d));
    c = mix(c, vec3(0.16, 0.36, 0.66), smoothstep(200.0, 3000.0, d));
    return srgb2lin(mix(c, vec3(0.07, 0.17, 0.42), smoothstep(3000.0, 7000.0, d)));
  }
  vec3 c = mix(vec3(0.42, 0.66, 0.40), vec3(0.73, 0.80, 0.50), smoothstep(0.0, 400.0, z));
  c = mix(c, vec3(0.86, 0.76, 0.52), smoothstep(400.0, 1200.0, z));
  c = mix(c, vec3(0.67, 0.48, 0.32), smoothstep(1200.0, 2600.0, z));
  c = mix(c, vec3(0.92, 0.91, 0.90), smoothstep(2600.0, 4200.0, z));
  return srgb2lin(c);
}

// Land colour from the climate estimate (linear RGB). latd in degrees.
vec3 biome(float latd, float z, float inland, float n, out float ice) {
  // the belts wander a few degrees, so they do not read as stripes
  latd += (n - 0.5) * 9.0;
  float s = sin(radians(latd));
  float T = uTeq - uDT * s * s - 6.5 * max(z, 0.0) / 1000.0 + (n - 0.5) * 3.0;
  float al = abs(latd);
  // moisture: wet in the rising air at the equator and at 45-65 deg,
  // dry under the subtropical highs (20-32 deg) and far from the sea.
  float wet = 0.85 * exp(-sq(al / 11.0)) + 0.55 * exp(-sq((al - 52.0) / 13.0)) + 0.28;
  wet -= 0.55 * exp(-sq((al - 25.0) / 8.0));
  wet -= inland / 3600.0;
  // warm poles (greenhouse worlds) were wet enough for polar forests
  wet += 0.4 * smoothstep(0.0, 14.0, T) * smoothstep(55.0, 75.0, al);
  wet += (n - 0.5) * 0.25;
  wet = clamp(wet, 0.0, 1.0);
  vec3 rock = mix(vec3(0.14, 0.10, 0.075), vec3(0.24, 0.18, 0.13), n);        // bare rock and soil
  vec3 sand = vec3(0.42, 0.30, 0.17);
  vec3 redbed = vec3(0.36, 0.16, 0.08);
  vec3 forestTrop = vec3(0.024, 0.058, 0.016);
  vec3 forestTemp = vec3(0.034, 0.066, 0.02);
  vec3 boreal = vec3(0.022, 0.04, 0.022);
  vec3 grass = vec3(0.16, 0.17, 0.06);
  vec3 shrub = vec3(0.13, 0.13, 0.07);
  vec3 tundra = vec3(0.17, 0.16, 0.12);
  // barren land colour: deserts are sand in the dry belt, red beds in hot
  // worlds, rock elsewhere
  vec3 bare = mix(rock, mix(sand, redbed, smoothstep(22.0, 30.0, uTeq - uDT / 3.0) * 0.6), smoothstep(0.45, 0.1, wet));
  // vegetation
  float warm = smoothstep(-6.0, 8.0, T);
  vec3 veg = mix(boreal, forestTemp, smoothstep(2.0, 12.0, T));
  veg = mix(veg, forestTrop, smoothstep(18.0, 25.0, T));
  vec3 open = mix(shrub, grass, uGrass);
  veg = mix(open, veg, mix(0.25, 1.0, uTall) * smoothstep(0.3, 0.65, wet));
  veg = mix(tundra, veg, warm);
  float cover = uVeg * smoothstep(0.08, 0.4, wet) * smoothstep(-12.0, -2.0, T);
  vec3 col = mix(bare, veg, cover);
  // early land plants are thin mats: a green-brown film at most
  if (uTall < 0.01) col = mix(bare, vec3(0.12, 0.13, 0.07), cover * 0.6);
  // snow on high ground and ice where the yearly mean stays below -9 C
  ice = smoothstep(-7.0, -11.0, T);
  return col;
}

void main() {
  vec3 p = normalize(vObj);
  float lat = asin(clamp(p.y, -1.0, 1.0)), lon = atan(p.x, p.z);
  float latd = degrees(lat), lond = degrees(lon);
  vec2 uv = vec2((lond + 180.0 + 0.5) / 360.0, (latd + 90.0 + 0.5) / 181.0);
  vec2 zs = sampleZ(uv);
  // Toward a pole the 1 deg columns get narrow, and the grid (and the
  // PaleoDEMs, which were regridded there) shows as radial streaks. Average
  // along the parallel over about the cell height (1/cos(lat) columns),
  // and over the whole ring at the pole itself.
  float cl = cos(lat);
  if (cl < 0.55) {
    float du = min(0.5, (1.0 / max(cl, 0.002) - 1.0) / 360.0);
    vec2 acc = zs;
    for (int k = 1; k <= 3; k++) {
      float o = du * float(k) / 3.0;
      acc += sampleZ(vec2(uv.x + o, uv.y)) + sampleZ(vec2(uv.x - o, uv.y));
    }
    zs = mix(zs, acc / 7.0, smoothstep(0.55, 0.35, cl));
  }
  float z = zs.x, inland = zs.y;
  // small-scale relief and coast detail (fbm), weaker where the screen is coarse
  float n1 = fbm(p * 38.0, uQuality > 0.5 ? 5 : 3);
  float n2 = fbm(p * 160.0 + 3.0, uQuality > 0.5 ? 3 : 2);
  float amp = mix(90.0, 450.0, smoothstep(0.0, 2500.0, abs(z))) * uDetail;
  float zd = z + (n1 - 0.5) * amp + (n2 - 0.5) * amp * 0.35;
  float zl = zd - uSea;           // height above the sea
  bool land = zl > 0.0;

  // normals: bump from the screen derivatives of the exaggerated height
  vec3 Nw = normalize(uRot * p);
  float hgt = max(zl, 0.0) / 6371000.0 * uExag;
  vec3 dpx = dFdx(vWorld), dpy = dFdy(vWorld);
  float dhx = dFdx(hgt), dhy = dFdy(hgt);
  vec3 r1 = cross(dpy, Nw), r2 = cross(Nw, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  vec3 N = land ? normalize(abs(det) * Nw - grad) : Nw;

  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = normalize(uSun);
  vec3 col;
  float alpha = 1.0;

  // tint from the paleo polygon index map
  vec4 idx = texture(uIdx, vec2(lond / 360.0 + 0.5, latd / 180.0 + 0.5));
  float ii = floor(idx.r * 255.0 + 0.5);
  vec3 tintC = texture(uPal, vec2((ii + 0.5) / 256.0, uTint == 2 ? 0.75 : 0.25)).rgb;
  float tintOn = (uTint > 0 && ii < 254.5) ? uTintK : 0.0;

  if (uMode == 0) {
    // ── realistic ────────────────────────────────────────────────────────
    float ice;
    vec3 alb;
    float n3 = 0.6 * fbm(p * 9.0 + 5.0, 3) + 0.4 * fbm(p * 31.0 + 2.0, 2);
    if (land) {
      alb = biome(latd, zl, inland, n3, ice);
      alb = mix(alb, vec3(0.80, 0.84, 0.88), ice);
      alb = mix(alb, srgb2lin(tintC) * 0.6, tintOn);
    } else {
      float d = -zl;
      // sea ice where the surface stays below about -2 C
      float s = sin(lat);
      float T = uTeq - uDT * s * s + (n1 - 0.5) * 4.0;
      ice = smoothstep(-3.0, -8.0, T);
      vec3 deep = vec3(0.004, 0.014, 0.040);
      vec3 shelf = vec3(0.020, 0.120, 0.120);
      vec3 shallow = vec3(0.08, 0.26, 0.22);
      alb = mix(shallow, shelf, smoothstep(0.0, 60.0, d));
      alb = mix(alb, deep, smoothstep(80.0, 1800.0, d));
      alb = mix(alb, vec3(0.70, 0.76, 0.80), ice * 0.9);
    }
    // clouds: latitude bands (ITCZ, storm tracks, clear subtropics)
    float al = abs(latd);
    float band = 0.55 * exp(-sq(al / 7.0)) + 0.6 * exp(-sq((al - 55.0) / 13.0)) + 0.2 - 0.25 * exp(-sq((al - 24.0) / 7.0));
    float tt = uTime * 0.004;
    vec3 q = p * 3.2 + vec3(tt, 0.0, -tt * 0.6);
    vec3 warp = vec3(fbm(q + 7.0, 3), fbm(q + 13.0, 3), fbm(q + 23.0, 3));
    float cn = fbm(p * 5.0 + warp * 1.6 + vec3(0.0, tt * 0.3, 0.0), uQuality > 0.5 ? 6 : 4);
    float clo = 0.6 - band * 0.12;
    float cloud = smoothstep(clo, clo + 0.2, cn) * uClouds;
    // cloud shadow, offset toward the sun
    vec3 ps = normalize(p + transpose(uRot) * L * 0.006);
    float cs = fbm(ps * 5.0 + warp * 1.6 + vec3(0.0, tt * 0.3, 0.0), 4);
    float shadow = smoothstep(clo, clo + 0.2, cs) * uClouds;

    float NL = max(dot(N, L), 0.0), NgL = dot(Nw, L);
    vec3 sunT = extinct(sunDepth(Nw * 1.0005, L, uQuality > 0.5 ? 6 : 4));
    vec3 sunC = vec3(SUN) * sunT;
    vec3 sky = vec3(0.10, 0.17, 0.32) * clamp(NgL + 0.25, 0.0, 1.0) * 1.2;
    vec3 surf = alb * (sunC * NL * (1.0 - 0.75 * shadow) + sky + vec3(0.012, 0.014, 0.02));   // + faint starlight and airglow
    if (!land) {
      // sun glint: GGX on a rippled sea, Schlick Fresnel, sky reflection
      vec3 wn = vec3(vnoise(p * 900.0 + uTime * 0.05), vnoise(p * 900.0 + 17.0), vnoise(p * 900.0 + 31.0)) - 0.5;
      vec3 Ns = normalize(Nw + wn * 0.05 * (1.0 - ice));
      vec3 H = normalize(L + V);
      float NH = max(dot(Ns, H), 0.0), NV = max(dot(Ns, V), 1e-3);
      float a2 = 0.012;
      float D = a2 / (PI * sq(NH * NH * (a2 - 1.0) + 1.0));
      float F = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
      float Fv = 0.02 + 0.98 * pow(1.0 - NV, 5.0);
      float Gs = 1.0 / (4.0 * NV * max(dot(Ns, L), 1e-3) + 1e-3);
      surf += (1.0 - ice) * (sunC * D * F * Gs * max(dot(Ns, L), 0.0) * 0.9 * (1.0 - shadow) + Fv * vec3(0.20, 0.33, 0.55) * clamp(NgL + 0.2, 0.0, 1.0));
    }
    // clouds over the surface
    vec3 cloudC = vec3(0.7) * (sunC * clamp(NgL * 0.8 + 0.2, 0.0, 1.0) + sky * 1.5);
    surf = mix(surf, cloudC, cloud * 0.92);
    // city lights at night (present day only)
    if (uLightsK > 0.001) {
      float night = smoothstep(0.05, -0.18, NgL);
      vec3 lt = texture(uLights, vec2(lond / 360.0 + 0.5, latd / 180.0 + 0.5)).rgb;
      surf += lt * vec3(1.0, 0.62, 0.30) * 1.6 * night * uLightsK * (land ? 1.0 : 0.0) * (1.0 - cloud * 0.8);
    }
    // aerial perspective between the camera and the ground
    vec3 o = cameraPosition, d = -V;
    vec2 ha = raySphere(o, d, RA);
    float t0 = max(ha.x, 0.0), t1 = length(vWorld - o);
    vec3 trans;
    vec3 ins = inscatter(o, d, t0, t1, L, uQuality > 0.5 ? 8 : 5, uQuality > 0.5 ? 4 : 3, trans);
    col = surf * trans + ins * SUN;
    gl_FragColor = vec4(tonemap(col, uExposure), 1.0);
    return;
  }

  // ── map modes ────────────────────────────────────────────────────────────
  // hillshade: a light at azimuth uHillAz (from north, clockwise) and
  // altitude uHillAlt in the local frame
  vec3 up = Nw;
  vec3 east = normalize(uRot * vec3(cos(lon), 0.0, -sin(lon)));
  vec3 north = cross(up, east);
  float az = radians(uHillAz), alt = radians(uHillAlt);
  vec3 Lh = normalize(east * sin(az) * cos(alt) + north * cos(az) * cos(alt) + up * sin(alt));
  float shade = clamp(dot(N, Lh) / max(sin(alt), 0.2), 0.0, 1.6);
  shade = mix(1.0, shade, uHill);
  float zm = land ? max(zl, 1.0) : min(zl, -1.0);
  if (uMode == 1) col = hypso(zm);
  else if (uMode == 2) { float g = signedSqrt(zm); col = vec3(g * g * 0.9 + 0.02); }
  else if (uMode == 7) {
    float edge = 1.0 - smoothstep(0.0, 1.5, abs(zl) / max(fwidth(zl), 1.0));
    col = land ? vec3(0.055, 0.065, 0.075) : vec3(0.010, 0.016, 0.028);
    col = mix(col, vec3(0.75, 0.86, 0.95), edge);
    shade = mix(1.0, shade, 0.4);
  }
  else col = srgb2lin(cmap(signedSqrt(zm)));
  if (land) col = mix(col, srgb2lin(tintC), tintOn * (uMode == 7 ? 0.5 : 0.55));
  col *= shade;
  // limb darkening and a thin sky rim, so the map still reads as a globe
  float mu = max(dot(Nw, V), 0.0);
  col *= 0.55 + 0.45 * pow(mu, 0.35);
  gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2)), alpha);
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
