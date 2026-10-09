// ============================================================================
//  PLANET FORGE  ·  planet.wgsl — the view: one full-screen pass
//  (atmo-common.wgsl is prepended by render.js)
// ----------------------------------------------------------------------------
//  Everything is ray-traced in the planet's body frame (radius 1), so the
//  silhouette is exact and no mesh is needed:
//    1. ray from the camera; hits on the planet, the cloud shell, the
//       atmosphere shell (1 + H / R) and the ring plane (y = 0)
//    2. surface: PBR from the maps (GGX specular + Lambert, F0 = 0.08 s),
//       normal mapping in the east/north/up frame, AO, emissive (city
//       lights only at night), sun through the transmittance LUT, cloud
//       shadows (the sun ray meets the cloud shell), ring shadows
//    3. clouds: the shell over the surface, lit by the same sun, with a
//       flow-map drift (two phases, cross-faded)
//    4. atmosphere: single scattering ray-march from the camera to the
//       surface (aerial perspective) or through the limb, with the
//       multiple-scattering LUT and the planet shadow (terminator glow)
//    5. rings in front of or behind the planet, shadowed by the planet
//    6. the background (sky.wgsl: stars, Milky Way, the sun disc and
//       corona, all in the world frame), exposure, ACES, sRGB, dither
//  Texture coordinates come from the body-frame direction in the
//  THREE.SphereGeometry layout. Gradients for the mip level are taken in
//  uniform control flow and wrapped at the date line (no seam line).
//
//  grep -n targets: "struct View", "fn dirUV", "fn shadeSurface",
//  "fn cloudAt", "fn atmosphere", "fn ringAt", "@fragment"
// ============================================================================

struct View {
  camPos: vec4f,    // xyz camera (body frame), w time (s)
  camRight: vec4f,  // xyz, w tan(fov / 2)
  camUp: vec4f,     // xyz, w aspect
  camFwd: vec4f,    // xyz, w exposure
  sun: vec4f,       // xyz sun direction (body frame), w sun disc cos
  res: vec4f,       // width, height (px), principal point offset x, y (px)
  shell: vec4f,     // x atmosphere top (planet units), y cloud shell radius, z atmosphere steps, w emissive gain
  rings: vec4f,     // inner, outer, on, opacity
  flow: vec4f,      // x cloud drift (u per s), y gas giant flow speed, z clouds on, w gas (1) / rocky (0)
  cloudCol: vec4f,  // rgb cloud colour (linear), w ambient floor
  bw0: vec4f,       // xyz row 0 of the body -> world rotation, w sun angular radius (rad)
  bw1: vec4f,       // xyz row 1, w sun disc gain
  bw2: vec4f,       // xyz row 2, w quality (0 phone, 1 tablet, 2 desktop)
  sunW: vec4f,      // xyz sun direction (world frame), w star gain
}

@group(0) @binding(0) var<uniform> V: View;
@group(0) @binding(1) var<uniform> A: Atmo;
@group(0) @binding(2) var tAlbedo: texture_2d<f32>;
@group(0) @binding(3) var tNormal: texture_2d<f32>;
@group(0) @binding(4) var tMat: texture_2d<f32>;
@group(0) @binding(5) var tEmis: texture_2d<f32>;
@group(0) @binding(6) var tCloud: texture_2d<f32>;
@group(0) @binding(7) var tRing: texture_2d<f32>;
@group(0) @binding(8) var tTrans: texture_2d<f32>;
@group(0) @binding(9) var tMulti: texture_2d<f32>;
@group(0) @binding(10) var sMap: sampler;
@group(0) @binding(11) var sLut: sampler;

struct VOut { @builtin(position) pos: vec4f }

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: VOut;
  o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  return o;
}

const TAU: f32 = 6.2831853;

fn dirUV(p: vec3f) -> vec2f {
  let u = fract(atan2(p.z, -p.x) / TAU + 1.0);
  let v = acos(clamp(p.y, -1.0, 1.0)) / PI;
  return vec2f(u, v);
}

// Seam-safe gradient: a jump of about 1 in u across the date line is a wrap.
fn wrapGrad(g: vec2f) -> vec2f { return vec2f(g.x - round(g.x), g.y); }

struct Grad { dx: vec2f, dy: vec2f }

fn sampleG(t: texture_2d<f32>, uv: vec2f, g: Grad) -> vec4f {
  return textureSampleGrad(t, sMap, uv, g.dx, g.dy);
}

fn transmittance(r: f32, mu: f32) -> vec3f {
  return textureSampleLevel(tTrans, sLut, transUV(A, r, mu), 0.0).rgb;
}
fn multiScat(r: f32, muS: f32) -> vec3f {
  let uv = vec2f(muS * 0.5 + 0.5, clamp((r - A.radii.x) / (A.radii.y - A.radii.x), 0.0, 1.0));
  return textureSampleLevel(tMulti, sLut, uv, 0.0).rgb;
}

// Flow-map drift: two phases half a period apart, cross-faded, so the
// texture moves along vel without shearing without bound.
struct Flow { a: vec2f, b: vec2f, w: f32 }
fn flowUV(uv: vec2f, vel: vec2f, t: f32, period: f32) -> Flow {
  let ph0 = fract(t / period);
  let ph1 = fract(t / period + 0.5);
  var f: Flow;
  f.a = uv - vel * ph0 * period;
  f.b = uv - vel * ph1 * period;
  f.w = abs(2.0 * ph0 - 1.0);
  return f;
}

// Sun light reaching body-frame point p (radius ~1): transmittance and the
// planet's own soft shadow.
fn sunLight(p: vec3f) -> vec3f {
  let L = V.sun.xyz;
  let up = normalize(p);
  let mu = dot(up, L);
  if (A.ground.w < 0.5) { return vec3f(smoothstep(-0.01, 0.01, mu)); }
  let r = max(length(p) * A.radii.x, A.radii.x + 0.01);
  return transmittance(r, mu) * smoothstep(-0.02, 0.01, mu);
}

fn ringAt(r: f32) -> vec4f {
  let u = (r - V.rings.x) / max(V.rings.y - V.rings.x, 1e-3);
  if (u < 0.0 || u > 1.0 || V.rings.z < 0.5) { return vec4f(0.0); }
  return textureSampleLevel(tRing, sMap, vec2f(u, 0.5), 0.0);
}

// Ring shadow on a point p: the sun ray meets the ring plane.
fn ringShadow(p: vec3f) -> f32 {
  let L = V.sun.xyz;
  if (V.rings.z < 0.5 || abs(L.y) < 1e-4) { return 1.0; }
  let t = -p.y / L.y;
  if (t <= 0.0) { return 1.0; }
  let q = p + L * t;
  return 1.0 - ringAt(length(q.xz)).a * 0.9;
}

// The cloud map (0..1 coverage, also an exported PBR map) to the rendered
// opacity: thin cloud lets most of the ground through, and the thickest
// cloud stays at most CLOUD_MAX opaque, as real cloud decks do from orbit.
const CLOUD_MAX: f32 = 0.75;
fn cloudOpacity(a: f32) -> f32 { return CLOUD_MAX * pow(clamp(a, 0.0, 1.0), 1.6); }

fn cloudAlpha(uv: vec2f, g: Grad, lat: f32) -> f32 {
  let drift = V.flow.x * (0.55 + 0.45 * cos(2.0 * lat));
  let f = flowUV(uv, vec2f(drift, 0.0), V.camPos.w, 40.0);
  let a = sampleG(tCloud, f.a, g).r;
  let b = sampleG(tCloud, f.b, g).r;
  return cloudOpacity(mix(a, b, f.w)) * V.flow.z;
}

// Cloud shadow at surface point p: the sun ray meets the cloud shell.
fn cloudShadow(p: vec3f) -> f32 {
  if (V.flow.z < 0.5) { return 1.0; }
  let L = V.sun.xyz;
  let t = raySphere(p, L, V.shell.y).y;
  if (t <= 0.0) { return 1.0; }
  let q = normalize(p + L * t);
  let uv = dirUV(q);
  let drift = V.flow.x * (0.55 + 0.45 * cos(2.0 * asin(q.y)));
  let f = flowUV(uv, vec2f(drift, 0.0), V.camPos.w, 40.0);
  let a = mix(textureSampleLevel(tCloud, sMap, f.a, 2.0).r, textureSampleLevel(tCloud, sMap, f.b, 2.0).r, f.w);
  return 1.0 - 0.8 * cloudOpacity(a) / CLOUD_MAX;
}

// Sky irradiance on the ground (a cheap fit: scattered sun over one scale
// height plus the multiple-scattering term), for the ambient light.
fn skyIrradiance(p: vec3f) -> vec3f {
  if (A.ground.w < 0.5) { return vec3f(V.cloudCol.w); }
  let up = normalize(p);
  let mu = dot(up, V.sun.xyz);
  let tauS = A.rayleigh.xyz * A.rayleigh.w + A.mieS.xyz * A.mieS.w;
  let Ts = transmittance(A.radii.x + 0.01, mu) * smoothstep(-0.1, 0.1, mu);
  let ms = multiScat(A.radii.x + 0.01, mu);
  return A.radii.w * tauS * (Ts * 2.5 / (4.0 * PI) + ms * 2.0) + vec3f(V.cloudCol.w);
}

fn ggx(n: vec3f, v: vec3f, l: vec3f, rough: f32, f0: vec3f) -> vec3f {
  let h = normalize(v + l);
  let nl = max(dot(n, l), 0.0);
  let nv = max(dot(n, v), 1e-3);
  let nh = max(dot(n, h), 0.0);
  let vh = max(dot(v, h), 0.0);
  let a = max(rough * rough, 0.002);
  let a2 = a * a;
  let d = a2 / (PI * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0));
  let k = a * 0.5;
  let g = (nv / (nv * (1.0 - k) + k)) * (nl / (nl * (1.0 - k) + k));
  let f = f0 + (vec3f(1.0) - f0) * pow(1.0 - vh, 5.0);
  return d * g * f / (4.0 * nv * max(nl, 1e-3));
}

fn shadeSurface(p: vec3f, rd: vec3f, uvIn: vec2f, g: Grad) -> vec3f {
  var uv = uvIn;
  var alb: vec3f;
  var nT: vec3f;
  var mat: vec4f;
  if (V.flow.w > 0.5) {
    // gas giant: the cloud deck flows along the zonal wind of the flow map
    let fl = sampleG(tCloud, uv, g);
    let vel = vec2f((fl.g - 0.5) * 2.0, (fl.b - 0.5) * 2.0) * V.flow.y;
    let f = flowUV(uv, vel, V.camPos.w, 30.0);
    alb = mix(sampleG(tAlbedo, f.a, g).rgb, sampleG(tAlbedo, f.b, g).rgb, f.w);
    nT = mix(sampleG(tNormal, f.a, g).xyz, sampleG(tNormal, f.b, g).xyz, f.w) * 2.0 - 1.0;
    mat = sampleG(tMat, uv, g);
  } else {
    alb = sampleG(tAlbedo, uv, g).rgb;
    nT = sampleG(tNormal, uv, g).xyz * 2.0 - 1.0;
    mat = sampleG(tMat, uv, g);
  }
  let emis = sampleG(tEmis, uv, g);
  let up = normalize(p);
  var east = vec3f(up.z, 0.0, -up.x);
  if (dot(east, east) < 1e-8) { east = vec3f(1.0, 0.0, 0.0); }
  east = normalize(east);
  let north = cross(up, east);
  let n = normalize(east * nT.x + north * nT.y + up * nT.z);
  let L = V.sun.xyz;
  let v = -rd;
  let ao = mat.r;
  let rough = clamp(mat.g, 0.03, 1.0);
  let metal = mat.b;
  let f0 = mix(vec3f(0.08 * mat.a), alb, metal);
  let light = sunLight(p) * cloudShadow(p) * ringShadow(p) * A.radii.w;
  let nl = max(dot(n, L), 0.0) * smoothstep(-0.05, 0.05, dot(up, L));
  let fd = (1.0 - f0) * (1.0 - metal) * alb / PI;
  var col = (fd + ggx(n, v, L, rough, f0)) * light * nl;
  let sky = skyIrradiance(p);
  col += sky * alb / PI * ao * (0.6 + 0.4 * dot(n, up));
  // glossy surfaces reflect the sky
  let fr = f0 + (1.0 - f0) * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  col += fr * sky / PI * (1.0 - rough) * 0.5;
  // emission: city lights fade in at dusk; lava and glow always
  let night = smoothstep(0.08, -0.12, dot(up, L));
  let e = emis.rgb * select(1.0, night, emis.a > 0.5);
  col += e * V.shell.w;
  return col;
}

struct Scat { L: vec3f, T: vec3f }

// Single scattering from ro (body frame, planet units) along rd up to tMax.
fn atmosphere(ro: vec3f, rd: vec3f, tMax: f32) -> Scat {
  var s: Scat;
  s.L = vec3f(0.0);
  s.T = vec3f(1.0);
  if (A.ground.w < 0.5) { return s; }
  let R = A.radii.x;
  let roK = ro * R;
  let hit = raySphere(roK, rd, A.radii.y);
  if (hit.y <= 0.0) { return s; }
  let t0 = max(hit.x, 0.0);
  let t1 = min(hit.y, tMax * R);
  if (t1 <= t0) { return s; }
  let n = i32(V.shell.z);
  let dt = (t1 - t0) / f32(n);
  let L = V.sun.xyz;
  let c = dot(rd, L);
  let pR = phaseR(c);
  let pM = phaseM(c, A.mieA.w);
  var T = vec3f(1.0);
  var acc = vec3f(0.0);
  for (var i = 0; i < n; i++) {
    let x = roK + rd * (t0 + (f32(i) + 0.5) * dt);
    let r = length(x);
    let m = medium(A, r - R);
    let muS = dot(x / r, L);
    // planet shadow, soft over a few km at the terminator
    let gs = raySphere(x, L, R);
    var sh = 1.0;
    if (gs.x > 0.0) {
      let b = dot(x, L);
      let dmin = sqrt(max(r * r - b * b, 0.0));
      sh = smoothstep(R - 4.0, R + 4.0, dmin);
    }
    let Ts = transmittance(r, muS) * sh;
    let ms = multiScat(r, muS);
    let S = A.radii.w * (m.sR * (pR * Ts + ms) + m.sM * (pM * Ts + ms));
    let ext = max(m.ext, vec3f(1e-7));
    let st = exp(-ext * dt);
    acc += T * (S - S * st) / ext;
    T *= st;
  }
  s.L = acc;
  s.T = T;
  return s;
}

fn hash3(p: vec3f) -> f32 {
  var q = fract(p * vec3f(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yxz + 33.33);
  return fract((q.x + q.y) * q.z);
}

fn aces(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}
fn toSRGB(c: vec3f) -> vec3f {
  return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308));
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let px = in.pos.xy;
  let ndc = vec2f((px.x - V.res.z) / V.res.x * 2.0 - 1.0, 1.0 - (px.y - V.res.w) / V.res.y * 2.0);
  let th = V.camRight.w;
  let rd = normalize(V.camFwd.xyz + V.camRight.xyz * ndc.x * th * V.camUp.w + V.camUp.xyz * ndc.y * th);
  let ro = V.camPos.xyz;

  // planet and cloud hits; the texture point is taken for every pixel
  // (closest approach when the ray misses), so the gradients below are in
  // uniform control flow and stay smooth at the silhouette
  let hp = raySphere(ro, rd, 1.0);
  let tca = max(-dot(ro, rd), 0.0);
  let pS = select(normalize(ro + rd * tca), normalize(ro + rd * hp.x), hp.x > 0.0);
  let uvS = dirUV(pS);
  var gS: Grad;
  gS.dx = wrapGrad(dpdx(uvS));
  gS.dy = wrapGrad(dpdy(uvS));
  let hc = raySphere(ro, rd, V.shell.y);
  let pC = select(normalize(ro + rd * tca), normalize(ro + rd * hc.x), hc.x > 0.0);
  let uvC = dirUV(pC);
  var gC: Grad;
  gC.dx = wrapGrad(dpdx(uvC));
  gC.dy = wrapGrad(dpdy(uvC));

  let L = V.sun.xyz;
  let cs = dot(rd, L);
  // the background in the world frame (sky.wgsl): stars stay fixed while
  // the planet spins; the sun disc has a true angular size
  let rdW = vec3f(dot(V.bw0.xyz, rd), dot(V.bw1.xyz, rd), dot(V.bw2.xyz, rd));
  let pxAngle = 2.0 * th / V.res.y;
  var col = skyColor(rdW, pxAngle, V.bw2.w) * V.sunW.w;
  let sun = sky_sun(rdW, V.sunW.xyz, V.bw0.w, V.camPos.w, V.bw1.w, 0.35);
  col += sun.col;

  // ring plane hit
  var ringT = -1.0;
  var ring = vec4f(0.0);
  if (V.rings.z > 0.5 && abs(rd.y) > 1e-5) {
    let t = -ro.y / rd.y;
    if (t > 0.0) {
      let q = ro + rd * t;
      let rr = length(q.xz);
      ring = ringAt(rr);
      if (ring.a > 0.002) {
        ringT = t;
        // planet shadow on the ring
        let b = dot(q, L);
        let dmin = sqrt(max(dot(q, q) - b * b, 0.0));
        let sh = select(1.0, smoothstep(0.97, 1.03, dmin), b < 0.0);
        let lit = select(0.25 * (1.0 - ring.a), 1.0, sign(L.y) == sign(ro.y));
        let ph = 0.6 + 0.8 * pow(max(-cs, 0.0), 3.0);
        ring = vec4f(ring.rgb * A.radii.w / PI * abs(L.y) * sh * lit * ph * 1.6 + ring.rgb * 0.004, ring.a * V.rings.w);
      }
    }
  }
  let topT = raySphere(ro, rd, V.shell.x);
  let planetHit = hp.x > 0.0;
  // ring behind the planet's atmosphere (or no planet in the way)
  if (ringT > 0.0 && !planetHit && (topT.y < 0.0 || ringT > topT.y)) { col = mix(col, ring.rgb, ring.a); }

  var tEnd = 1e9;
  if (planetHit) {
    tEnd = hp.x;
    var surf = shadeSurface(pS, rd, uvS, gS);
    // the cloud shell in front of the surface
    if (V.flow.z > 0.5 && hc.x > 0.0) {
      let a = cloudAlpha(uvC, gC, asin(pC.y));
      let up = pC;
      let lightC = sunLight(pC * V.shell.y) * ringShadow(pC * V.shell.y) * A.radii.w;
      let wrap = clamp(dot(up, L) * 0.7 + 0.3, 0.0, 1.0);
      let cl = V.cloudCol.rgb * (lightC * wrap / PI * 0.9 + skyIrradiance(pC) / PI * 0.6);
      surf = mix(surf, cl, a);
    }
    // a soft edge for airless bodies (anti-aliased silhouette)
    let pxAng = 2.0 * th / V.res.y;
    let dEdge = (1.0 - length(ro + rd * tca)) / max(tca * pxAng, 1e-5);
    col = mix(col, surf, clamp(dEdge + 0.5, 0.0, 1.0));
  }
  let sc = atmosphere(ro, rd, tEnd);
  col = col * sc.T + sc.L;
  // ring in front of the planet
  if (ringT > 0.0 && (!planetHit || ringT < hp.x) && !(!planetHit && (topT.y < 0.0 || ringT > topT.y))) { col = mix(col, ring.rgb, ring.a); }

  var c = aces(col * V.camFwd.w);
  c = toSRGB(c);
  // triangular dither against banding in the sky gradients
  let dn = hash3(vec3f(px, fract(V.camPos.w) * 61.0)) + hash3(vec3f(px.yx, 7.0)) - 1.0;
  c += dn / 255.0;
  return vec4f(c, 1.0);
}
