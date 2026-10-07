// ============================================================================
//  ANCIENT EARTH  ·  surface.js  ·  GLSL for the baked surface and the planet
// ----------------------------------------------------------------------------
//  The surface is baked into equirectangular targets when the age, the
//  colour mode or the data change (globe.js "bake("). The planet shader
//  then reads them each frame and only lights them. Before this split,
//  every pixel of every frame ran the DEM B-spline (up to 56 taps near the
//  poles), the biome model, the cloud noise and 30 noise octaves.
//
//  HEIGHT_FRAG  pass 1: the surface height with detail noise, 16 bits in
//               rg ((z + 9000) / 15000), inland km / 4080 in b
//  BAKE_FRAG    pass 2 (two outputs), reads pass 1 at three texels:
//    out0 rgb  surface colour, square-root encoded (linear = rgb^2)
//    out0 a    0 on land; on water the sun-glint weight (1 - sea ice)
//    out1 rg   east and north slope, 0.5 + slope / 400 (metres per km)
//    out1 b    1 on land (where the present-day night lights may show)
//  CLOUD_FRAG  two fbm cloud fields (r, g) on the sphere, baked once
//  PLANET      lighting: sun through the atmosphere, bump normal from the
//              slopes, ocean GGX glint and Fresnel, clouds drifting with
//              zonal winds (flow-map with two phases, so the shear never
//              grows), cloud shadows, city lights, aerial perspective.
//              It mixes two bakes (uA/uB and uA2/uB2) by uK: the cached
//              bakes of the two DEM frames around the age while it moves.
//
//  grep -n targets
//    surface height ........ "vec2 heightAt"
//    land colour ........... "vec3 landColour"
//    bake main ............. "BAKE_FRAG"
//    cloud flow ............ "float cloudAt"
//    planet main ........... "PLANET_FRAG"
// ============================================================================
import { ATMOS, NOISE } from './shaders.js';

export const QUAD_VERT = /* glsl */`
out vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const SPHERE = /* glsl */`
vec3 sphere(vec2 uv) {
  float lat = (uv.y - 0.5) * 3.14159265, lon = (uv.x - 0.5) * 6.2831853;
  return vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
}
`;

export const HEIGHT_FRAG = /* glsl */`
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uDem;
uniform float uLayA, uLayB, uMix, uDetail;
in vec2 vUv;
layout(location = 0) out highp vec4 outH;
${NOISE}
${SPHERE}
const vec2 DEM = vec2(360.0, 181.0);
vec2 bspline(float layer, vec2 uv) {
  vec2 p = uv * DEM - 0.5, f = fract(p); p -= f;
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0, w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0, w3 = f3 / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3, h0 = (w1 / g0) - 0.5 + p, h1 = (w3 / g1) + 1.5 + p;
  vec2 a = texture(uDem, vec3(h0 / DEM, layer)).rg, b = texture(uDem, vec3(vec2(h1.x, h0.y) / DEM, layer)).rg;
  vec2 c = texture(uDem, vec3(vec2(h0.x, h1.y) / DEM, layer)).rg, d = texture(uDem, vec3(h1 / DEM, layer)).rg;
  return mix(mix(a, b, g1.x), mix(c, d, g1.x), g1.y);
}
float decodeZ(float c) {
  c *= 255.0;
  if (c < 127.5) { float s = (127.0 - c) / 127.0; return -9000.0 * s * s; }
  float s = max(0.0, c - 128.0) / 127.0; return 6000.0 * s * s;
}
// paleo elevation (m) and inland distance (km) at a texture point
vec2 paleoZ(vec2 uv) {
  vec2 q = vec2(uv.x + 0.5 / 360.0, (uv.y * 180.0 + 0.5) / 181.0);
  vec2 a = bspline(uLayA, q);
  if (uMix < 0.001) return vec2(decodeZ(a.r), a.g * 4080.0);
  vec2 b = bspline(uLayB, q);
  return vec2(mix(decodeZ(a.r), decodeZ(b.r), uMix), mix(a.g, b.g, uMix) * 4080.0);
}
// Toward a pole the 1 deg columns get narrow and the grid shows as radial
// streaks: average along the parallel over about one cell height.
vec2 paleoZs(vec2 uv) {
  vec2 zs = paleoZ(uv);
  float cl = cos((uv.y - 0.5) * 3.14159265);
  if (cl < 0.55) {
    float du = min(0.5, (1.0 / max(cl, 0.002) - 1.0) / 360.0);
    vec2 acc = zs;
    for (int k = 1; k <= 3; k++) { float o = du * float(k) / 3.0; acc += paleoZ(uv + vec2(o, 0.0)) + paleoZ(uv - vec2(o, 0.0)); }
    zs = mix(zs, acc / 7.0, smoothstep(0.55, 0.35, cl));
  }
  return zs;
}
// surface height (m) with detail; x = height, y = inland km
vec2 heightAt(vec2 uv) {
  vec2 zs = paleoZs(uv);
  vec3 p = sphere(uv);
  float amp = mix(90.0, 450.0, smoothstep(0.0, 2500.0, abs(zs.x))) * uDetail;
  zs.x += (fbm(p * 38.0, 4) - 0.5) * amp + (fbm(p * 150.0 + 3.0, 2) - 0.5) * amp * 0.35;
  return zs;
}
void main() {
  vec2 zs = heightAt(vUv);
  float h = clamp((zs.x + 9000.0) / 15000.0, 0.0, 1.0) * 65535.0;
  float hi = floor(h / 256.0);
  outH = vec4(hi / 255.0, (h - hi * 256.0) / 255.0, clamp(zs.y / 4080.0, 0.0, 1.0), 1.0);
}
`;

export const BAKE_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uH, uIdx, uPal, uCmap;
uniform float uTeq, uDT, uSea, uVeg, uTall, uGrass, uTintK;
uniform int uMode, uTint;
in vec2 vUv;
layout(location = 0) out highp vec4 out0;
layout(location = 1) out highp vec4 out1;
${NOISE}
${SPHERE}
float sq(float x) { return x * x; }
vec2 hAt(ivec2 c, ivec2 sz) {
  c.x = (c.x + sz.x) % sz.x; c.y = clamp(c.y, 0, sz.y - 1);
  vec4 h = texelFetch(uH, c, 0);
  return vec2((h.r * 255.0 * 256.0 + h.g * 255.0) / 65535.0 * 15000.0 - 9000.0, h.b * 4080.0);
}
vec3 srgb2lin(vec3 c) { return pow(c, vec3(2.2)); }
float signedSqrt(float z) { return z < 0.0 ? 0.5 - 0.5 * sqrt(-z / 9000.0) : 0.5 + 0.5 * sqrt(z / 6000.0); }
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
  return srgb2lin(mix(c, vec3(0.92, 0.91, 0.90), smoothstep(2600.0, 4200.0, z)));
}
// Land colour from the climate estimate (linear RGB), ice in ice.
vec3 landColour(float latd, float z, float inland, vec3 p, out float ice) {
  float n = 0.6 * fbm(p * 9.0 + 5.0, 3) + 0.4 * fbm(p * 31.0 + 2.0, 2);
  // the belts wander a few degrees, so they do not read as stripes
  latd += (n - 0.5) * 9.0;
  float s = sin(radians(latd));
  float T = uTeq - uDT * s * s - 6.5 * max(z, 0.0) / 1000.0 + (n - 0.5) * 3.0;
  float al = abs(latd);
  // moisture: wet in the rising air at the equator and at 45-65 deg,
  // dry under the subtropical highs (20-32 deg) and far from the sea;
  // warm poles (greenhouse worlds) were wet enough for polar forests
  float wet = 0.85 * exp(-sq(al / 11.0)) + 0.55 * exp(-sq((al - 52.0) / 13.0)) + 0.28 - 0.55 * exp(-sq((al - 25.0) / 8.0));
  wet -= inland / 3600.0;
  wet += 0.4 * smoothstep(0.0, 14.0, T) * smoothstep(55.0, 75.0, al);
  wet = clamp(wet + (n - 0.5) * 0.25, 0.0, 1.0);
  vec3 rock = mix(vec3(0.14, 0.10, 0.075), vec3(0.24, 0.18, 0.13), n);
  vec3 sand = vec3(0.42, 0.30, 0.17), redbed = vec3(0.36, 0.16, 0.08);
  vec3 forestTrop = vec3(0.024, 0.058, 0.016), forestTemp = vec3(0.034, 0.066, 0.02), boreal = vec3(0.022, 0.04, 0.022);
  vec3 grass = vec3(0.16, 0.17, 0.06), shrub = vec3(0.13, 0.13, 0.07), tundra = vec3(0.17, 0.16, 0.12);
  vec3 bare = mix(rock, mix(sand, redbed, smoothstep(22.0, 30.0, uTeq - uDT / 3.0) * 0.6), smoothstep(0.45, 0.1, wet));
  float warm = smoothstep(-6.0, 8.0, T);
  vec3 veg = mix(boreal, forestTemp, smoothstep(2.0, 12.0, T));
  veg = mix(veg, forestTrop, smoothstep(18.0, 25.0, T));
  veg = mix(mix(shrub, grass, uGrass), veg, mix(0.25, 1.0, uTall) * smoothstep(0.3, 0.65, wet));
  veg = mix(tundra, veg, warm);
  float cover = uVeg * smoothstep(0.08, 0.4, wet) * smoothstep(-12.0, -2.0, T);
  vec3 col = mix(bare, veg, cover);
  if (uTall < 0.01) col = mix(bare, vec3(0.12, 0.13, 0.07), cover * 0.6);
  ice = smoothstep(-7.0, -11.0, T);
  return mix(col, vec3(0.80, 0.84, 0.88), ice);
}
void main() {
  ivec2 sz = textureSize(uH, 0), c = ivec2(gl_FragCoord.xy);
  vec2 uv = vUv;
  vec3 p = sphere(uv);
  float latd = (uv.y - 0.5) * 180.0;
  vec2 zs = hAt(c, sz);
  float z = zs.x, inland = zs.y, zl = z - uSea;
  bool land = zl > 0.0;
  // slopes in metres per km, from the next texels east and north
  float coslat = max(cos(radians(latd)), 0.02);
  float ze = hAt(c + ivec2(1, 0), sz).x, zn = hAt(c + ivec2(0, 1), sz).x;
  float dxkm = 360.0 * 111.2 * coslat / float(sz.x), dykm = 180.0 * 111.2 / float(sz.y);
  vec2 slope = land ? vec2((ze - z) / dxkm, (zn - z) / dykm) : vec2(0.0);
  vec3 col; float glint = 0.0;
  float ii = floor(texture(uIdx, uv).r * 255.0 + 0.5);
  vec3 tintC = srgb2lin(texture(uPal, vec2((ii + 0.5) / 256.0, uTint == 2 ? 0.75 : 0.25)).rgb);
  float tintOn = (uTint > 0 && ii < 254.5 && land) ? uTintK : 0.0;
  if (uMode == 0) {
    if (land) {
      float ice;
      col = landColour(latd, zl, inland, p, ice);
      col = mix(col, tintC * 0.6, tintOn);
    } else {
      float d = -zl;
      float s = sin(radians(latd));
      float Ts = uTeq - uDT * s * s + (fbm(p * 12.0, 3) - 0.5) * 5.0;
      float seaIce = smoothstep(-3.0, -8.0, Ts);
      col = mix(vec3(0.08, 0.26, 0.22), vec3(0.020, 0.120, 0.120), smoothstep(0.0, 60.0, d));
      col = mix(col, vec3(0.004, 0.014, 0.040), smoothstep(80.0, 1800.0, d));
      col = mix(col, vec3(0.70, 0.76, 0.80), seaIce * 0.9);
      glint = max(0.02, 1.0 - seaIce);
    }
  } else {
    float zm = land ? max(zl, 1.0) : min(zl, -1.0);
    if (uMode == 1) col = hypso(zm);
    else if (uMode == 2) { float g = signedSqrt(zm); col = vec3(g * g * 0.9 + 0.02); }
    else if (uMode == 7) {
      // the coastline: a texel whose east or north neighbour is across sea level
      float edge = ((ze - uSea > 0.0) != land || (zn - uSea > 0.0) != land) ? 1.0 : 0.0;
      col = land ? vec3(0.055, 0.065, 0.075) : vec3(0.010, 0.016, 0.028);
      col = mix(col, vec3(0.75, 0.86, 0.95), edge);
    } else col = srgb2lin(texture(uCmap, vec2(clamp(signedSqrt(zm), 0.0, 1.0) * 0.996 + 0.002, (float(uMode - 3) + 0.5) / 4.0)).rgb);
    if (land) col = mix(col, tintC, tintOn * (uMode == 7 ? 0.5 : 0.55));
    glint = land ? 0.0 : 0.02;
  }
  out0 = vec4(sqrt(clamp(col, 0.0, 1.0)), glint);
  out1 = vec4(clamp(0.5 + slope / 400.0, 0.0, 1.0), land ? 1.0 : 0.0, 1.0);
}
`;

export const CLOUD_FRAG = /* glsl */`
precision highp float;
in vec2 vUv;
layout(location = 0) out highp vec4 outC;
${NOISE}
${SPHERE}
float field(vec3 p, float seed) {
  vec3 q = p * 3.0 + seed;
  vec3 w = vec3(fbm(q + 7.0, 4), fbm(q + 13.0, 4), fbm(q + 23.0, 4));
  return fbm(p * 5.5 + w * 1.7 + seed * 3.0, 6);
}
void main() {
  vec3 p = sphere(vUv);
  outC = vec4(field(p, 0.0), field(p, 17.3), 0.0, 1.0);
}
`;

export const PLANET_VERT = /* glsl */`
varying vec3 vObj;
varying vec3 vWorld;
void main() {
  vObj = normalize(position);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const PLANET_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uA, uB, uA2, uB2, uCloud, uLights;
uniform vec3 uSun;
uniform mat3 uRot;
uniform float uK, uExag, uExposure, uHill, uHillAz, uHillAlt, uCloudT, uClouds, uLightsK, uQuality, uTime, uWet, uStorm;
uniform int uMode;
varying vec3 vObj;
varying vec3 vWorld;
${ATMOS}
float sq(float x) { return x * x; }
// Zonal wind (cloud drift, radians of longitude per unit of uCloudT):
// easterly trades, westerlies at 35-60 deg, polar easterlies.
float wind(float al) { return -0.6 * exp(-sq(al / 18.0)) + 1.0 * exp(-sq((al - 47.0) / 13.0)) - 0.3 * exp(-sq((al - 75.0) / 9.0)); }
// Cloud cover at a point: two baked fields, each advected by the wind for
// its own phase of the flow cycle, cross-faded so the shear never builds.
float cloudAt(vec2 uv, float latd) {
  float al = abs(latd);
  float band = 0.55 * exp(-sq(al / 7.0)) + (0.45 + 0.25 * uStorm) * exp(-sq((al - 52.0 - 6.0 * uStorm) / 13.0)) + 0.18 - (0.3 - 0.1 * uWet) * exp(-sq((al - 24.0) / 7.0));
  // each phase drifts at most about 8 deg of longitude before it fades out
  float ph = fract(uCloudT / 6.0), u = wind(al) * 0.022;
  float f1 = texture(uCloud, vec2(uv.x + u * ph + 0.11, uv.y)).r;
  float f2 = texture(uCloud, vec2(uv.x + u * fract(ph + 0.5) + 0.57, uv.y)).g;
  float k = abs(2.0 * ph - 1.0);
  float f = mix(f1, f2, k);
  float lo = 0.585 - band * 0.13;
  return smoothstep(lo, lo + 0.17, f);
}
void main() {
  vec3 p = normalize(vObj);
  float lat = asin(clamp(p.y, -1.0, 1.0)), lon = atan(p.x, p.z);
  float latd = degrees(lat);
  vec2 uv = vec2(lon / 6.2831853 + 0.5, lat / 3.14159265 + 0.5);
  vec4 A = texture(uA, uv), B = texture(uB, uv);
  if (uK > 0.001) { A = mix(A, texture(uA2, uv), uK); B = mix(B, texture(uB2, uv), uK); }
  vec3 alb = A.rgb * A.rgb;
  float water = A.a;
  vec3 Nw = normalize(uRot * p);
  vec3 east = normalize(uRot * vec3(cos(lon), 0.0, -sin(lon)));
  vec3 north = cross(Nw, east);
  vec2 slope = (B.rg - 0.5) * 400.0 / 1000.0;     // metres per metre
  vec3 N = normalize(Nw - uExag * 0.05 * (slope.x * east + slope.y * north));
  vec3 V = normalize(cameraPosition - vWorld), L = normalize(uSun);
  if (uMode != 0) {
    float az = radians(uHillAz), alt = radians(uHillAlt);
    vec3 Lh = normalize(east * sin(az) * cos(alt) + north * cos(az) * cos(alt) + Nw * sin(alt));
    float shade = mix(1.0, clamp(dot(N, Lh) / max(sin(alt), 0.2), 0.0, 1.6), uHill * (uMode == 7 ? 0.4 : 1.0));
    vec3 col = alb * shade * (0.55 + 0.45 * pow(max(dot(Nw, V), 0.0), 0.35));
    gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
    return;
  }
  float cloud = cloudAt(uv, latd) * uClouds;
  vec3 Ls = transpose(uRot) * L;
  vec3 ps = normalize(p + Ls * 0.006);
  float slat = asin(clamp(ps.y, -1.0, 1.0));
  float shadow = cloudAt(vec2(atan(ps.x, ps.z) / 6.2831853 + 0.5, slat / 3.14159265 + 0.5), degrees(slat)) * uClouds;
  float NL = max(dot(N, L), 0.0), NgL = dot(Nw, L);
  vec3 sunT = extinct(sunDepth(Nw * 1.0005, L, uQuality > 0.5 ? 5 : 3));
  vec3 sunC = vec3(SUN) * sunT;
  vec3 sky = vec3(0.10, 0.17, 0.32) * clamp(NgL + 0.25, 0.0, 1.0) * 1.2;
  vec3 surf = alb * (sunC * NL * (1.0 - 0.7 * shadow) + sky + vec3(0.010, 0.012, 0.018));
  if (water > 0.0) {
    // GGX glint on a rippled sea, Schlick Fresnel, sky reflection
    // roughness: a smooth sea, rougher in the windy belts (no texel-scale
    // pattern, which showed as a checkerboard inside the glint)
    float rough = 0.10 + 0.05 * smoothstep(30.0, 55.0, abs(latd));
    vec3 H = normalize(L + V);
    float NH = max(dot(Nw, H), 0.0), NV = max(dot(Nw, V), 1e-3), NLs = max(NgL, 0.0);
    float a2 = rough * rough;
    float D = a2 / (PI * sq(NH * NH * (a2 - 1.0) + 1.0));
    float F = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
    float Fv = 0.02 + 0.98 * pow(1.0 - NV, 5.0);
    float G = 1.0 / (4.0 * NV * max(NLs, 1e-3) + 1e-3);
    surf += water * (sunC * D * F * G * NLs * (1.0 - shadow) + Fv * vec3(0.20, 0.33, 0.55) * clamp(NgL + 0.2, 0.0, 1.0));
  }
  vec3 cloudC = vec3(0.72) * (sunC * clamp(NgL * 0.85 + 0.15, 0.0, 1.0) + sky * 1.5);
  surf = mix(surf, cloudC, cloud * 0.93);
  if (uLightsK > 0.001 && B.b > 0.01) {
    float night = smoothstep(0.06, -0.16, NgL);
    vec3 lt = texture(uLights, uv).rgb;
    surf += vec3(1.0, 0.62, 0.30) * lt * 1.6 * night * uLightsK * B.b * (1.0 - cloud * 0.8);
  }
  vec3 o = cameraPosition, d = -V;
  vec2 ha = raySphere(o, d, RA);
  float t0 = max(ha.x, 0.0), t1 = length(vWorld - o);
  vec3 trans;
  vec3 ins = inscatter(o, d, t0, t1, L, uQuality > 0.5 ? 6 : 4, uQuality > 0.5 ? 3 : 2, trans);
  gl_FragColor = vec4(tonemap(surf * trans + ins * SUN, uExposure), 1.0);
}
`;
