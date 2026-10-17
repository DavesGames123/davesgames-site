// ============================================================================
//  DLA TERRAIN  ·  water.wgsl — the ocean, the rivers, the lakes, waterfall
//  mist. CORE joins shaders/common.wgsl + lib/dla-terrain-detail.wgsl in
//  front of this file (Globals G, the terrain textures, terrainHeight).
//  render/water.js owns every pipeline that uses this file.
//
//  Passes:
//    csWaves   compute: three tileable wave cascades (600, 83 and 13 m).
//              The CPU (water.js waveModes) picks lattice wave vectors from
//              a Phillips spectrum (Tessendorf 2001) driven by G.wind and
//              writes amplitudes and phases. This shader sums them directly
//              (no FFT pass) into displacement, slope and Jacobian terms.
//    vsOcean   a polar grid around the camera out to the horizon, Gerstner
//              displacement from the cascades, waves shrink in shallow water,
//              shore breakers move toward the beach on the depth isolines.
//    fsOcean   slopes per pixel with a footprint fade (the removed slope
//              variance goes into the roughness, LEADR style), whitecaps from
//              the Jacobian, shore foam from the water depth.
//    vsSurface / fsSurface  river ribbons (two-phase flow-map normals along
//              the ribbon, rapids, waterfall sheets) and flat lakes (calm).
//    vsMist / fsMist  soft spray sprites at the base of each waterfall.
//  Shared shading (wShade): refraction of the scene copy with depth-based
//  Beer-Lambert absorption and in-scatter, caustics on the shallow bed,
//  Fresnel reflection (screen-space march, then the sky pixels of the scene
//  copy, then an analytic sky), GGX sun glitter, moon glitter, rain rings.
//
//  Reuse (our own pages, ideas and maths ported to WGSL):
//    caustic lattice ........ pages/coral-reef/scene.js "float caustic"
//    analytic sky shape ..... pages/city-atlas/shaders/sky.wgsl (horizon and
//                             zenith mix, sun glow, hashed stars)
//    Cornette-Shanks phase .. pages/forge/shaders/atmo-common.wgsl phaseM
//    hash, value noise ...... the sampling and noise shader tables
//  Never ported: pages/height-field-water (upstream script, all rights kept).
//
//  Group 2 is CORE's shadow sample group (sunShadow in common.wgsl).
//
//  Tint rule: every mixed * / ^ and && / || expression has parentheses.
//  Identifiers carry a w / W prefix so that they cannot collide with CORE's
//  common.wgsl names.
//
//  grep -n targets: "struct WaterU", "fn csWaves", "fn wWaves", "fn wSky",
//  "fn wReflect", "fn wShade", "fn vsOcean", "fn fsOcean", "fn vsSurface",
//  "fn fsSurface", "fn wRiver", "fn wFall", "fn vsMist", "fn fsMist",
//  "fn wRain", "fn wCaustic", "fn wLinDepth"
// ============================================================================

struct WaterU {
  misc: vec4f,     // x time s (wrapped), y sea level m, z ocean on, w quality
  casc: vec4f,     // xyz cascade tile sizes m, w choppiness
  snap: vec4f,     // xy snapped grid centre xz, z grid radius m, w radians per pixel
  slopeVar: vec4f, // xyz slope variance per cascade, w significant wave height m
  oceanAbs: vec4f, // rgb absorption 1/m, w whitecap amount
  oceanSca: vec4f, // rgb in-scatter albedo, w shore foam amount
  riverAbs: vec4f, // rgb absorption 1/m, w turbidity
  riverSca: vec4f, // rgb in-scatter albedo, w flow-map period s
  lakeAbs: vec4f,  // rgb absorption 1/m, w lake ripple scale
  lakeSca: vec4f,  // rgb in-scatter albedo, w unused
  windS: vec4f,    // xy smoothed wind unit, z wind speed m/s, w storminess
  flags: vec4f,    // x ssr on, y caustics on, z rain 0..1, w night 0..1
  comp: vec4f,     // x modes per cascade, y texture size, z mist sprites per fall, w debug view (setDebug)
  cloudR: vec4f,   // xy cloud shadow rect origin xz, z rect size m, w cloud base world y
  skyV: vec4f,     // x sky-view LUT scale, y LUT on, z cloud shadow on, w unused
};

@group(1) @binding(0) var<uniform> WU: WaterU;
@group(1) @binding(1) var wScene: texture_2d<f32>;
@group(1) @binding(2) var wDepth: texture_depth_2d;
@group(1) @binding(3) var wWaveA: texture_2d_array<f32>;
@group(1) @binding(4) var wWaveB: texture_2d_array<f32>;
@group(1) @binding(5) var wRepeat: sampler;
@group(1) @binding(6) var wCloudTex: texture_2d<f32>;   // SKY cloud shadow (r = sun transmittance)
@group(1) @binding(7) var wCloudS: sampler;
@group(1) @binding(8) var wSkyView: texture_2d<f32>;    // SKY Hillaire sky-view LUT
@group(1) @binding(9) var wSkyS: sampler;

@group(3) @binding(0) var<uniform> WC: WaterU;
@group(3) @binding(1) var<storage, read> wModes: array<vec4f>;
@group(3) @binding(2) var wOutA: texture_storage_2d_array<rgba16float, write>;
@group(3) @binding(3) var wOutB: texture_storage_2d_array<rgba16float, write>;

const W_PI: f32 = 3.14159265;
const W_F0: f32 = 0.02;

// ---------------------------------------------------------------- hashes ----
fn wHash21(p: vec2f) -> f32 {
  var q = fract(p * vec2f(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}
fn wHash22(p: vec2f) -> vec2f {
  let a = wHash21(p);
  return vec2f(a, wHash21(p + a + 17.13));
}
fn wHash31(p: vec3f) -> f32 {
  var q = fract(p * vec3f(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yxz + 33.33);
  return fract((q.x + q.y) * q.z);
}
fn wNoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * (3.0 - 2.0 * f);
  let a = wHash21(i);
  let b = wHash21(i + vec2f(1.0, 0.0));
  let c = wHash21(i + vec2f(0.0, 1.0));
  let d = wHash21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn wFbm(p: vec2f) -> f32 {
  var s = 0.0;
  var a = 0.5;
  var q = p;
  for (var i = 0; i < 4; i++) {
    s += a * wNoise(q);
    q = q * 2.03 + vec2f(1.7, 9.2);
    a *= 0.5;
  }
  return s;
}

// --------------------------------------------------------- wave cascades ----
// One invocation per texel and cascade. Mode = (kx, kz, amplitude, phase);
// the phase already holds -omega t (wrapped on the CPU in double precision).
@compute @workgroup_size(8, 8, 1)
fn csWaves(@builtin(global_invocation_id) id: vec3u) {
  let N = u32(WC.comp.y);
  if (id.x >= N || id.y >= N || id.z >= 3u) { return; }
  let c = id.z;
  let L = WC.casc[c];
  let x = (vec2f(id.xy) + 0.5) / f32(N) * L;
  let count = u32(WC.comp.x);
  let chop = WC.casc.w;
  var D = vec3f(0.0);
  var sx = 0.0;
  var sz = 0.0;
  var dxdx = 0.0;
  var dzdz = 0.0;
  var dxdz = 0.0;
  for (var i = 0u; i < count; i++) {
    let m = wModes[c * count + i];
    if (m.z <= 0.0) { continue; }
    let kl = max(length(m.xy), 1e-4);
    let th = dot(m.xy, x) + m.w;
    let s = sin(th);
    let co = cos(th);
    let a = m.z;
    let ca = chop * a / kl;
    D.y += a * co;
    D.x -= ca * m.x * s;
    D.z -= ca * m.y * s;
    sx -= m.x * a * s;
    sz -= m.y * a * s;
    dxdx -= ca * m.x * m.x * co;
    dzdz -= ca * m.y * m.y * co;
    dxdz -= ca * m.x * m.y * co;
  }
  textureStore(wOutA, vec2i(id.xy), i32(c), vec4f(D, dxdz));
  textureStore(wOutB, vec2i(id.xy), i32(c), vec4f(sx, sz, dxdx, dzdz));
}

struct WSample { d: vec3f, sx: f32, sz: f32, dxdx: f32, dzdz: f32, dxdz: f32 };

fn wWaves(xz: vec2f, f: vec3f) -> WSample {
  var o: WSample;
  o.d = vec3f(0.0);
  o.sx = 0.0; o.sz = 0.0; o.dxdx = 0.0; o.dzdz = 0.0; o.dxdz = 0.0;
  for (var c = 0; c < 3; c++) {
    let k = f[c];
    if (k <= 0.001) { continue; }
    let uv = xz / WU.casc[c];
    let A = textureSampleLevel(wWaveA, wRepeat, uv, c, 0.0);
    let B = textureSampleLevel(wWaveB, wRepeat, uv, c, 0.0);
    o.d += A.xyz * k;
    o.dxdz += A.w * k;
    o.sx += B.x * k;
    o.sz += B.y * k;
    o.dxdx += B.z * k;
    o.dzdz += B.w * k;
  }
  return o;
}

fn wJacobian(s: WSample) -> f32 {
  return (1.0 + s.dxdx) * (1.0 + s.dzdz) - (s.dxdz * s.dxdz);
}

fn wWaveNormal(s: WSample) -> vec3f {
  return normalize(vec3f(-s.sx / max(1.0 + s.dxdx, 0.2), 1.0, -s.sz / max(1.0 + s.dzdz, 0.2)));
}

// ------------------------------------------------------------ depth utils ----
// Linear view distance from a reverse-Z depth (finite or infinite far).
fn wLinDepth(d: f32) -> f32 {
  return G.proj[3][2] / max(d + G.proj[2][2], 1e-7);
}
fn wWorldAt(uv: vec2f, d: f32) -> vec3f {
  let ndc = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, max(d, 1e-7), 1.0);
  let w = G.invViewProj * ndc;
  return w.xyz / w.w;
}
fn wDepthAt(uv: vec2f) -> f32 {
  let sz = vec2i(textureDimensions(wDepth));
  let p = clamp(vec2i(uv * vec2f(sz)), vec2i(0), sz - 1);
  return textureLoad(wDepth, p, 0);
}

// -------------------------------------------------------------- the sky ----
fn wPhaseM(c: f32, g: f32) -> f32 {
  let g2 = g * g;
  let k = 3.0 / (8.0 * W_PI) * (1.0 - g2) / (2.0 + g2);
  return k * (1.0 + c * c) / pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5);
}

fn wMoonColor() -> vec3f { return vec3f(0.62, 0.70, 0.86) * G.moonDir.w; }

// SKY's cloud shadow (NOTES.md SKY -> ALL): the sun transmittance through the
// moving clouds above p. 1 when SKY has not given the map.
fn wCloudShadow(p: vec3f) -> f32 {
  if (WU.skyV.z < 0.5) { return 1.0; }
  let sd = G.sunDir.xyz;
  let lit = smoothstep(-0.04, 0.03, sd.y);
  let t = max(WU.cloudR.w - p.y, 0.0) / max(sd.y, 0.08);
  let q = p.xz + sd.xz * t;
  let uv = (q - WU.cloudR.xy) / max(WU.cloudR.z, 1.0);
  let inside = all(uv > vec2f(0.0)) && all(uv < vec2f(1.0));
  let T = select(1.0 - 0.7 * G.weather.x, textureSampleLevel(wCloudTex, wCloudS, uv, 0.0).r, inside);
  return mix(1.0, T, lit);
}

// The clear-sky radiance from SKY's sky-view LUT (fn sk_skyViewUV in
// shaders/sky.wgsl; radiance per unit sun, times skyV.x).
fn wSkyLUT(dir: vec3f) -> vec3f {
  let rg = 6360.0;
  let r = rg + max(G.camPos.y - WU.misc.y, 2.0) / 1000.0;
  let vh = sqrt(max(r * r - rg * rg, 0.0));
  let beta = acos(clamp(vh / r, -1.0, 1.0));
  let zha = W_PI - beta;
  let vz = acos(clamp(dir.y, -1.0, 1.0));
  var v: f32;
  if (vz < zha) {
    let c = vz / zha;
    v = 0.5 * (1.0 - sqrt(max(1.0 - c, 0.0)));
  } else {
    v = 0.5 + 0.5 * sqrt(clamp((vz - zha) / beta, 0.0, 1.0));
  }
  let vxz = dir.xz;
  let sxz = G.sunDir.xz;
  let lv = length(vxz) * length(sxz);
  let cosAz = select(1.0, dot(vxz, sxz) / lv, lv > 1e-6);
  let u = sqrt(clamp(0.5 - 0.5 * cosAz, 0.0, 1.0));
  return textureSampleLevel(wSkyView, wSkyS, vec2f(u, v), 0.0).rgb * WU.skyV.x;
}

// Analytic sky radiance for a direction. Scale comes from G.ambient (the sky
// irradiance: radiance ~ E / pi), tint from G.fog and G.sunColor, so that the
// look follows SKY's state even with no sky texture. disc: draw the sun disc.
fn wSky(dirIn: vec3f, disc: bool) -> vec3f {
  let dir = normalize(dirIn);
  let L = normalize(G.sunDir.xyz);
  let y = max(dir.y, 0.0);
  let cover = clamp(G.weather.x, 0.0, 1.0);
  let base = G.ambient.rgb / W_PI;
  let zen = base * vec3f(0.52, 0.78, 1.30);
  let fogTint = G.fog.rgb / max(max(G.fog.r, max(G.fog.g, G.fog.b)), 1e-4);
  let hor = base * mix(vec3f(1.25, 1.22, 1.18), fogTint * 1.25, 0.45);
  var col = mix(hor, zen, pow(y, 0.45));
  let cs = dot(dir, L);
  let sunUp = smoothstep(-0.12, 0.05, L.y);
  // forward Mie glow and the warm band toward the low sun
  col += G.sunColor.rgb * ((wPhaseM(cs, 0.78) * 0.05 + (pow(max(cs, 0.0), 6.0) * 0.12 * pow(1.0 - y, 3.0))) * sunUp * (1.0 - (cover * 0.75)));
  if (WU.skyV.y > 0.5) {
    // SKY's real atmosphere (above the horizon only: the LUT holds the
    // ground below it)
    col = wSkyLUT(vec3f(dir.x, max(dir.y, 0.015), dir.z));
  }
  // clouds: grey the sky toward the overcast radiance (G.ambient / pi)
  let lum = dot(col, vec3f(0.2126, 0.7152, 0.0722));
  let grey = mix(lum, dot(base, vec3f(0.2126, 0.7152, 0.0722)) * 1.15, 0.5);
  col = mix(col, vec3f(grey) * vec3f(0.96, 0.98, 1.02), cover * 0.85);
  // stars and the moon glow after dusk
  let night = 1.0 - smoothstep(-0.18, 0.02, L.y);
  if (night > 0.0 && dir.y > 0.0) {
    let cell = floor(dir * 380.0);
    let h = wHash31(cell);
    let tw = 0.75 + 0.25 * sin(WU.misc.x * 3.0 + h * 40.0);
    col += vec3f(0.85, 0.9, 1.0) * (smoothstep(0.9975, 1.0, h) * tw * night * (1.0 - cover) * smoothstep(0.0, 0.2, dir.y) * 0.6);
  }
  let M = normalize(G.moonDir.xyz);
  let cm = max(dot(dir, M), 0.0);
  col += wMoonColor() * ((pow(cm, 40.0) * 0.06) + (pow(cm, 4.0) * 0.01)) * (1.0 - (cover * 0.6));
  if (disc) {
    col += G.sunColor.rgb * (smoothstep(0.99996, 0.99999, cs) * 400.0 * (1.0 - cover));
    col += wMoonColor() * (smoothstep(0.99995, 0.99998, cm) * 40.0 * (1.0 - cover));
  }
  if (dir.y < 0.0) {
    col = col * (0.55 + 0.45 * exp(dir.y * 6.0));
  }
  return col;
}

// ------------------------------------------------------------ reflection ----
// Screen-space march of the reflected ray against the depth copy. Returns the
// hit colour and a confidence. The water writes no depth, so the depth copy
// holds only terrain, vegetation and sky.
fn wSSR(P: vec3f, R: vec3f, dist: f32) -> vec4f {
  if (WU.flags.x < 0.5 || R.y > 0.9) { return vec4f(0.0); }
  let steps = i32(10.0 + 18.0 * WU.misc.w);
  var t = 0.6 + dist * 0.015;
  var prevT = 0.0;
  for (var i = 0; i < steps; i++) {
    let Q = P + R * t;
    let clip = G.viewProj * vec4f(Q, 1.0);
    if (clip.w <= 0.01) { break; }
    let ndc = clip.xyz / clip.w;
    let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { break; }
    let dS = wDepthAt(uv);
    let sLin = wLinDepth(dS);
    let qLin = clip.w;
    if (dS > 0.0 && qLin > sLin && (qLin - sLin) < (t - prevT) * 1.6 + 0.5) {
      // refine between prevT and t
      var a = prevT;
      var b = t;
      var huv = uv;
      for (var j = 0; j < 5; j++) {
        let m = 0.5 * (a + b);
        let Qm = P + R * m;
        let cm = G.viewProj * vec4f(Qm, 1.0);
        let nm = cm.xyz / cm.w;
        let uvm = vec2f(nm.x * 0.5 + 0.5, 0.5 - nm.y * 0.5);
        if (cm.w > wLinDepth(wDepthAt(uvm))) { b = m; huv = uvm; } else { a = m; }
      }
      let hit = wWorldAt(huv, wDepthAt(huv));
      if (hit.y < P.y - 0.4) { return vec4f(0.0); }
      let edge = smoothstep(0.0, 0.08, huv.x) * (1.0 - smoothstep(0.92, 1.0, huv.x)) * smoothstep(0.0, 0.08, huv.y) * (1.0 - smoothstep(0.9, 1.0, huv.y));
      let fadeI = 1.0 - smoothstep(0.6, 1.0, f32(i) / f32(steps));
      let c = textureSampleLevel(wScene, sLinear, huv, 0.0).rgb;
      return vec4f(c, edge * fadeI);
    }
    prevT = t;
    t = t * 1.32 + 0.4;
  }
  return vec4f(0.0);
}

// The sky seen in the scene copy, where the reflected direction lands on a
// sky pixel (depth 0). This puts SKY's real clouds in the water.
fn wSkyFromScene(R: vec3f) -> vec4f {
  let clip = G.viewProj * vec4f(R, 0.0);
  if (clip.w <= 1e-4) { return vec4f(0.0); }
  let ndc = clip.xy / clip.w;
  let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return vec4f(0.0); }
  if (wDepthAt(uv) > 0.0) { return vec4f(0.0); }
  let edge = smoothstep(0.0, 0.1, uv.x) * (1.0 - smoothstep(0.9, 1.0, uv.x)) * smoothstep(0.0, 0.1, uv.y) * (1.0 - smoothstep(0.9, 1.0, uv.y));
  return vec4f(textureSampleLevel(wScene, sLinear, uv, 0.0).rgb, edge * 0.85);
}

// Does the reflected ray hit the banks? A short march against the coarse
// terrain (no detail). Returns 1 for open sky, 0 for a bank. Rivers and lakes
// lie in valleys: their banks, not the bright horizon, fill the low reflection.
fn wBankOpen(P: vec3f, R: vec3f, reach: f32) -> f32 {
  var open = 1.0;
  var t = 4.0;
  for (var i = 0; i < 7; i++) {
    let Q = P + R * t;
    let h = baseHeight(Q.xz);
    open = min(open, clamp((Q.y - h) / max(t * 0.06, 0.5) + 0.5, 0.0, 1.0));
    t *= 2.0;
    if (t > reach) { break; }
  }
  return open;
}

fn wReflect(P: vec3f, Rin: vec3f, dist: f32, rough: f32, banks: f32) -> vec3f {
  var R = Rin;
  if (R.y < 0.02) { R = normalize(vec3f(R.x, abs(R.y) * 0.5 + 0.02, R.z)); }
  var col = wSky(R, false);
  if (banks > 0.0) {
    // the bank colour: the ground lit by the sky and a little of the sun
    let ao = terrainAO(P.xz);
    let bank = (G.ambient.rgb / W_PI * 0.10 + G.sunColor.rgb * 0.012) * vec3f(0.85, 1.0, 0.7);
    let open = wBankOpen(P, R, banks);
    col = mix(bank, col * mix(0.55, 1.0, ao), open);
  }
  let ss = wSkyFromScene(R);
  col = mix(col, ss.rgb, ss.a * (1.0 - smoothstep(0.15, 0.5, rough)));
  let ssr = wSSR(P, R, dist);
  col = mix(col, ssr.rgb, ssr.a * (1.0 - smoothstep(0.2, 0.6, rough)));
  return col;
}

// ---------------------------------------------------------------- lights ----
fn wGGX(NdH: f32, a2: f32) -> f32 {
  let d = (NdH * NdH) * (a2 - 1.0) + 1.0;
  return a2 / (W_PI * d * d);
}
fn wSpec(N: vec3f, V: vec3f, L: vec3f, a2: f32) -> f32 {
  let H = normalize(V + L);
  let NdL = max(dot(N, L), 0.0);
  let NdV = max(dot(N, V), 1e-3);
  let NdH = max(dot(N, H), 0.0);
  let VdH = max(dot(V, H), 0.0);
  let F = W_F0 + (1.0 - W_F0) * pow(1.0 - VdH, 5.0);
  let k = a2 * 0.5;
  let Gv = NdV / (NdV * (1.0 - k) + k);
  let Gl = NdL / (NdL * (1.0 - k) + k);
  return min(wGGX(NdH, a2) * F * Gv * Gl / (4.0 * NdV), 60.0) ;
}

// Caustic lattice (after pages/coral-reef/scene.js): a sine lattice warped
// three times by itself; the light lines are where the product nears zero.
fn wCaustic(p: vec2f, t: f32) -> f32 {
  var c = 0.0;
  var q = p;
  for (var i = 0; i < 3; i++) {
    let fi = f32(i);
    q += vec2f(sin(q.y * 0.9 + t * (0.55 + 0.2 * fi) + fi * 1.7), cos(q.x * 0.8 - t * (0.5 + 0.15 * fi) + fi * 2.3)) * 0.55;
    let s = sin(q * (1.3 + 0.35 * fi));
    c += 0.07 / (abs(s.x * s.y) + 0.07);
  }
  c /= 3.0;
  return c * c;
}

// Rain rings: two hashed cell layers, each cell drops a ring at a random time.
// Returns a slope (x, z) to add to the surface slope.
fn wRain(xz: vec2f, t: f32, amount: f32) -> vec2f {
  var s = vec2f(0.0);
  for (var l = 0; l < 2; l++) {
    let fl = f32(l);
    let sc = 0.55 + fl * 0.27;
    let p = xz / sc + vec2f(fl * 7.3, fl * 3.1);
    for (var j = 0; j < 4; j++) {
      let o = vec2f(f32(j & 1), f32(j >> 1u)) - 0.5;
      let cc = floor(p + o);
      let h = wHash22(cc + fl * 13.0);
      if (h.x > amount) { continue; }
      let ctr = cc + 0.25 + 0.5 * h;
      let ph = fract(t * (0.9 + 0.4 * h.y) + h.x * 7.0);
      let r = ph * 0.9;
      let dv = p - ctr;
      let d = length(dv);
      let x = d - r;
      let ring = sin(x * 34.0) * exp(-abs(x) * 14.0) * (1.0 - ph) * (1.0 - ph);
      s += (dv / max(d, 1e-3)) * ring * 0.35;
    }
  }
  return s;
}

// ---------------------------------------------------------- shared shade ----
struct WMat {
  absorb: vec3f,  // 1/m
  scatter: vec3f, // in-scatter albedo
  a2: f32,        // GGX alpha^2
  foam: f32,      // 0..1
  refr: f32,      // refraction strength
  caust: f32,     // caustic gain
  banks: f32,     // reach m of the bank test in the reflection (0 = off)
};

fn wShade(P: vec3f, N: vec3f, fragPos: vec4f, m: WMat) -> vec4f {
  let cam = G.camPos.xyz;
  let toCam = cam - P;
  let dist = length(toCam);
  let V = toCam / max(dist, 1e-4);
  let L = normalize(G.sunDir.xyz);
  let sunE = G.sunColor.rgb;
  let amb = G.ambient.rgb;
  let uv0 = fragPos.xy * G.screen.zw;
  let surfD = fragPos.z;
  let NdV = max(dot(N, V), 1e-3);

  // refraction: bend the lookup by the view-space normal, reject samples in
  // front of the surface
  let d0 = wDepthAt(uv0);
  let behind0 = select(1e5, max(wLinDepth(d0) - wLinDepth(surfD), 0.0), d0 > 0.0);
  let vn = (G.view * vec4f(N, 0.0)).xyz;
  var uvR = uv0 + vec2f(vn.x, -vn.y) * (m.refr * clamp(behind0 / 3.0, 0.0, 1.0) / (1.0 + dist * 0.004));
  uvR = clamp(uvR, vec2f(0.001), vec2f(0.999));
  var dR = wDepthAt(uvR);
  if (dR > surfD) { uvR = uv0; dR = d0; }
  var bedCol = textureSampleLevel(wScene, sLinear, uvR, 0.0).rgb;
  var path = 1e5;
  var vdepth = 1e5;
  var bed = P - V * 1e5;
  if (dR > 0.0) {
    bed = wWorldAt(uvR, dR);
    path = distance(P, bed);
    vdepth = max(P.y - bed.y, 0.0);
  }
  let cloudT = wCloudShadow(P);
  let lit = sunShadow(P, vec3f(0.0, 1.0, 0.0)) * cloudT;
  // light reaching the bed comes down through vdepth of water
  let down = exp(-m.absorb * (vdepth / max(L.y, 0.2)));
  if (m.caust > 0.0 && WU.flags.y > 0.5 && vdepth < 30.0) {
    let ca = wCaustic(bed.xz * 0.45 + G.wind.xy * 0.02 * WU.misc.x, WU.misc.x * 0.9);
    let gain = m.caust * lit * smoothstep(0.05, 0.6, vdepth) * exp(-vdepth * 0.12) * smoothstep(-0.05, 0.25, L.y) * (1.0 - G.weather.x * 0.7);
    bedCol *= 1.0 + ca * gain * 1.6;
  }
  let T = exp(-m.absorb * path);
  let lightIn = sunE * (max(L.y, 0.0) * 0.55 * (0.35 + 0.65 * lit)) + amb * 0.35 + wMoonColor() * (max(G.moonDir.y, 0.0) * 0.4);
  let inscat = m.scatter * lightIn;
  var refr = bedCol * down * T + inscat * (1.0 - T);

  // sub-surface glow in backlit wave crests
  let crest = clamp((P.y - WU.misc.y) / max(WU.slopeVar.w, 0.2), 0.0, 1.5);
  let back = pow(max(dot(V, -L), 0.0), 4.0) * smoothstep(-0.05, 0.2, L.y);
  refr += m.scatter * sunE * (crest * back * 1.6 * lit) * vec3f(0.6, 1.25, 1.1);

  // reflection
  let rough = sqrt(sqrt(m.a2));
  let R = reflect(-V, N);
  let refl = wReflect(P, R, dist, rough, m.banks);
  var F = W_F0 + (1.0 - W_F0) * pow(1.0 - NdV, 5.0);
  F = F / (1.0 + rough * 3.0 * (1.0 - NdV));

  var col = mix(refr, refl, F);
  let dbg = i32(WU.comp.w);
  if (dbg > 0) {
    var o = vec3f(0.0);
    if (dbg == 1) { o = refr; } else if (dbg == 2) { o = refl; } else if (dbg == 3) { o = vec3f(F); }
    else if (dbg == 4) { o = vec3f(m.foam); } else if (dbg == 5) { o = bedCol; }
    else if (dbg == 6) { o = vec3f(path / 10.0, vdepth / 5.0, behind0 / 5.0); }
    return vec4f(o, 1.0);
  }
  // CORE's cascaded sun shadow (group 2): ridges shade the glitter and foam
  let shadowSun = lit * (1.0 - (G.weather.x * 0.85));
  col += sunE * (wSpec(N, V, L, m.a2) * max(dot(N, L), 0.0) * shadowSun);
  if (G.moonDir.y > 0.0) {
    col += wMoonColor() * (wSpec(N, V, normalize(G.moonDir.xyz), m.a2 * 0.6) * max(dot(N, normalize(G.moonDir.xyz)), 0.0) * (1.0 - G.weather.x));
  }

  // foam: a rough white layer, lit and slightly translucent
  if (m.foam > 0.0) {
    let fl = sunE * (max(dot(N, L), 0.0) * 0.8 + 0.15) * shadowSun + amb * 0.9 + wMoonColor() * 0.3;
    col = mix(col, vec3f(0.92, 0.95, 0.97) * fl * 0.85, clamp(m.foam, 0.0, 1.0));
  }

  // soft edge where the surface meets the ground
  let alpha = smoothstep(0.0, 0.35, behind0);
  return vec4f(col * alpha, alpha);
}

// ----------------------------------------------------------------- ocean ----
struct OceanOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) base: vec2f,
  @location(2) shore: vec2f,   // x water depth at rest m, y amplitude scale
};

fn wCascFadeR(r: f32) -> vec3f {
  return vec3f(1.0 - smoothstep(1800.0, 6000.0, r), 1.0 - smoothstep(160.0, 520.0, r), 1.0 - smoothstep(22.0, 70.0, r));
}

// Shore breakers: crests on the depth isolines that run toward the beach.
fn wBreaker(depth: f32, t: f32, xz: vec2f) -> f32 {
  let band = smoothstep(0.1, 0.8, depth) * (1.0 - smoothstep(2.5, 7.0, depth));
  let wobble = wNoise(xz * 0.015) * 6.0;
  let ph = depth * 1.15 + t * 0.9 + wobble;
  let s = 0.5 + 0.5 * sin(ph);
  return pow(s, 6.0) * band;
}

// the sea floor for the ocean: the terrain inside the world; past the
// edge it sinks to 50 m under the sea within 8% of the world size (as the
// GROUND far ring does), so the clamped edge texels do not make foam
// stripes and shallow bands out to the horizon
fn wSeaFloor(xz: vec2f) -> f32 {
  let ws = G.terrain.x;
  let c = G.terrainOrigin.xy + vec2f(ws * 0.5);
  let out = max(abs(xz.x - c.x), abs(xz.y - c.y)) - ws * 0.5;
  let h = terrainHeight(xz);
  if (out <= 0.0) { return h; }
  return mix(h, G.terrain.z - 50.0, smoothstep(0.0, ws * 0.08, out));
}

@vertex
fn vsOcean(@location(0) g: vec2f) -> OceanOut {
  let r = g.x;
  let dir = vec2f(cos(g.y), sin(g.y));
  let base = WU.snap.xy + dir * r;
  let ground = wSeaFloor(base);
  let depth = WU.misc.y - ground;
  let amp = mix(0.25, 1.0, smoothstep(0.0, 14.0, depth));
  let horiz = smoothstep(-1.0, 6.0, depth);
  let s = wWaves(base, wCascFadeR(r));
  var p = vec3f(base.x + s.d.x * (amp * horiz), WU.misc.y + s.d.y * amp, base.y + s.d.z * (amp * horiz));
  let br = wBreaker(depth, WU.misc.x, base);
  p.y += br * min(0.35 + WU.slopeVar.w * 0.25, 1.4) * smoothstep(0.0, 0.5, depth);
  var o: OceanOut;
  o.pos = G.viewProj * vec4f(p, 1.0);
  o.world = p;
  o.base = base;
  o.shore = vec2f(depth, amp);
  return o;
}

@fragment
fn fsOcean(v: OceanOut, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let P = v.world;
  let dist = distance(G.camPos.xyz, P);
  let fp = dist * WU.snap.w;
  let N0 = WU.comp.y;
  let fade = vec3f(
    1.0 - smoothstep(WU.casc.x / N0 * 1.0, WU.casc.x / N0 * 5.0, fp),
    1.0 - smoothstep(WU.casc.y / N0 * 1.0, WU.casc.y / N0 * 5.0, fp),
    1.0 - smoothstep(WU.casc.z / N0 * 1.0, WU.casc.z / N0 * 5.0, fp));
  var s = wWaves(v.base, fade);
  let amp = v.shore.y;
  s.sx *= amp; s.sz *= amp;
  var N = wWaveNormal(s);
  // filtered roughness: the slope variance that the fade removed
  let lost = dot(vec3f(1.0) - fade, WU.slopeVar.xyz);
  let rain = WU.flags.z;
  var a2 = 0.0016 + lost * 1.4 + rain * 0.01;
  if (rain > 0.01 && dist < 60.0) {
    let rs = wRain(P.xz, WU.misc.x, rain) * (1.0 - smoothstep(25.0, 60.0, dist));
    N = normalize(N + vec3f(-rs.x, 0.0, -rs.y));
  }
  // water depth under this point (displaced)
  let ground = wSeaFloor(P.xz);
  let depth = P.y - ground;
  // whitecaps from the folding of the surface (Jacobian below one)
  let J = wJacobian(s);
  let capN = wFbm(v.base * 0.35 + vec2f(WU.misc.x * 0.05, 0.0));
  var foam = (1.0 - smoothstep(0.35, 0.85, J + (capN - 0.5) * 0.4)) * WU.oceanAbs.w;
  // shore foam: a band that follows the water line plus breaker crests
  let shoreN = wFbm(P.xz * 0.6 + vec2f(0.0, WU.misc.x * 0.15));
  // distance to the water line ~ depth / bed slope: a band some metres wide
  // on a beach, almost none on a wide flat (no waves break there)
  let tn = terrainNormal(P.xz);
  let bedSlope = max(length(tn.xz) / max(tn.y, 0.05), 0.002);
  let dShore = max(depth, 0.0) / bedSlope;
  let band = (1.0 - smoothstep(0.0, 4.0 + WU.slopeVar.w * 5.0, dShore + (shoreN - 0.5) * 6.0)) * (1.0 - smoothstep(0.6, 1.4, depth));
  let br = wBreaker(v.shore.x, WU.misc.x - 0.25, v.base) * smoothstep(0.004, 0.025, bedSlope);
  foam = max(foam, (band * 0.9 + br * 0.85 * smoothstep(0.35, 0.75, shoreN + 0.2)) * WU.oceanSca.w);
  // lace: foam breaks into cells and threads as it thins
  let lace = wFbm(P.xz * 1.7 + vec2f(WU.misc.x * 0.07)) + 0.35 * wNoise(P.xz * 6.0 - vec2f(WU.misc.x * 0.2, 0.0));
  foam *= smoothstep(0.45, 0.75, lace + foam * 0.45);
  var m: WMat;
  m.absorb = WU.oceanAbs.rgb;
  m.scatter = WU.oceanSca.rgb;
  m.a2 = a2;
  m.foam = foam;
  m.refr = 0.045;
  m.caust = 1.0;
  m.banks = 0.0;
  if (!ff) { N = -N; }
  return wShade(P, N, v.pos, m);
}

// ------------------------------------------------------- rivers and lakes ----
struct SurfIn {
  @location(0) pos: vec3f,
  @location(1) uv: vec2f,     // x across -1..1 (lakes: inside 0..1), y metres along
  @location(2) dir: vec2f,    // downstream unit xz
  @location(3) a: vec4f,      // x speed m/s, y width m, z foam hint, w depth m
  @location(4) kind: f32,     // 0 river, 1 waterfall, 2 lake
};
struct SurfOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) uv: vec2f,
  @location(2) dir: vec2f,
  @location(3) a: vec4f,
  @location(4) kind: f32,
};

@vertex
fn vsSurface(i: SurfIn) -> SurfOut {
  var o: SurfOut;
  o.pos = G.viewProj * vec4f(i.pos, 1.0);
  o.world = i.pos;
  o.uv = i.uv;
  o.dir = i.dir;
  o.a = i.a;
  o.kind = i.kind;
  return o;
}

// Slope (across, along) of the small cascades at local ribbon coordinates,
// faded by the pixel footprint fp (no mips: fade, do not alias).
fn wLocalSlope(q: vec2f, c1: f32, c2: f32, fp: f32) -> vec2f {
  let N0 = WU.comp.y;
  let f2 = 1.0 - smoothstep(WU.casc.z / N0, WU.casc.z / N0 * 4.0, fp);
  let f1 = 1.0 - smoothstep(WU.casc.y / N0, WU.casc.y / N0 * 4.0, fp);
  var o = vec2f(0.0);
  if (f2 > 0.0) {
    let A = textureSampleLevel(wWaveB, wRepeat, q / WU.casc.z, 2, 0.0).xy;
    o += A * (c2 * f2 / sqrt(max(WU.slopeVar.z, 1e-5)));
  }
  if (f1 > 0.0) {
    let B = textureSampleLevel(wWaveB, wRepeat, q / WU.casc.y, 1, 0.0).xy;
    o += B * (c1 * f1 / sqrt(max(WU.slopeVar.y, 1e-5)));
  }
  return o;
}

// Two-phase flow map along the ribbon: two copies of the ripple slope move
// downstream half a period apart and cross-fade, so that the ripples flow but
// never stretch.
fn wRiver(v: SurfOut, P: vec3f, t: f32, fp: f32) -> vec4f {
  let tang = vec3f(v.dir.x, 0.0, v.dir.y);
  let bin = vec3f(-v.dir.y, 0.0, v.dir.x);
  let hw = v.a.y * 0.5;
  let q = vec2f(v.uv.x * hw, v.uv.y);
  let profile = clamp(1.0 - v.uv.x * v.uv.x, 0.0, 1.0);
  let speed = v.a.x * (0.35 + 0.65 * profile);
  let swirl = (wNoise(q * 0.07 + vec2f(0.0, -t * 0.05)) - 0.5) * 0.6 * speed;
  let flow = vec2f(swirl, speed);
  let per = WU.riverSca.w;
  let ph0 = fract(t / per);
  let ph1 = fract(t / per + 0.5);
  let w0 = 1.0 - abs(2.0 * ph0 - 1.0);
  let turb = 0.055 + 0.08 * v.a.z + min(speed, 5.0) * 0.012;
  let s0 = wLocalSlope(q - flow * (ph0 * per), 0.4, 1.0, fp);
  let s1 = wLocalSlope(q - flow * (ph1 * per) + vec2f(3.7, 1.9), 0.4, 1.0, fp);
  let sl = mix(s1, s0, w0) * turb;
  // rapids: foam advected with the flow, more where the bed is steep
  let fq = q * vec2f(0.55, 0.22) - vec2f(0.0, t * speed * 0.22);
  let fn0 = wFbm(fq);
  let fn1 = wFbm(fq * 2.3 + 5.0);
  let bank = smoothstep(0.75, 1.0, abs(v.uv.x)) * smoothstep(1.0, 3.0, speed) * 0.25;
  var foam = (1.0 - smoothstep(0.25, 0.75, fn0 + (1.0 - v.a.z) * 0.6)) * v.a.z;
  foam = max(foam, bank * smoothstep(0.45, 0.65, fn1));
  // streaks: thin lines of bubbles stretched along the current
  let sk = wFbm(vec2f(q.x * 0.9, q.y * 0.07 - t * speed * 0.07) + 11.0);
  foam = max(foam, smoothstep(0.62, 0.8, sk) * 0.18 * smoothstep(1.0, 3.5, speed));
  let nWorld = normalize(vec3f(0.0, 1.0, 0.0) - (bin * sl.x) - (tang * sl.y));
  return vec4f(nWorld, foam);
}

// A waterfall sheet: streaks that fall fast, white at the lip and the base.
fn wFall(v: SurfOut, P: vec3f, t: f32) -> vec4f {
  let hw = v.a.y * 0.5;
  let x = v.uv.x * hw;
  let streak = wFbm(vec2f(x * 0.9, v.uv.y * 0.05 - t * 1.6));
  let fine = wNoise(vec2f(x * 4.0, v.uv.y * 0.3 - t * 5.0));
  let dens = clamp(0.55 + 0.5 * streak + 0.2 * fine, 0.0, 1.0);
  return vec4f(dens, streak, fine, 0.0);
}

@fragment
fn fsSurface(v: SurfOut, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let P = v.world;
  let t = WU.misc.x;
  let dist = distance(G.camPos.xyz, P);
  let rain = WU.flags.z;
  var m: WMat;
  var N = vec3f(0.0, 1.0, 0.0);
  var edge = 1.0;
  if (v.kind > 1.5) {
    // lake: calm, wind ruffles fade with distance
    let ws = WU.lakeAbs.w * clamp(WU.windS.z / 8.0, 0.15, 1.2);
    let sl = wLocalSlope(P.xz + G.wind.xy * (t * 0.25), 0.25, 1.0, dist * WU.snap.w) * (0.02 * ws);
    N = normalize(vec3f(-sl.x, 1.0, -sl.y));
    m.absorb = WU.lakeAbs.rgb;
    m.scatter = WU.lakeSca.rgb;
    m.a2 = 0.0009 + (rain * 0.008) + (ws * 0.002);
    m.foam = 0.0;
    m.refr = 0.02;
    m.caust = 0.6;
    m.banks = 600.0;
    edge = smoothstep(0.05, 0.6, v.uv.x);
  } else if (v.kind > 0.5) {
    let f = wFall(v, P, t);
    let L = normalize(G.sunDir.xyz);
    let lit = G.sunColor.rgb * (0.35 + 0.45 * max(L.y, 0.0)) * (1.0 - G.weather.x * 0.7) + G.ambient.rgb * 0.9 + wMoonColor() * 0.3;
    let col = vec3f(0.86, 0.91, 0.94) * lit * (0.6 + 0.4 * f.y);
    // ragged sides: the sheet thins to threads at its edges
    let side = (1.0 - smoothstep(0.55, 1.0, abs(v.uv.x) + (f.z - 0.5) * 0.35));
    let a = clamp(f.x, 0.0, 1.0) * 0.92 * side;
    return vec4f(col * a, a);
  } else {
    let r = wRiver(v, P, t, dist * WU.snap.w);
    N = r.xyz;
    m.absorb = WU.riverAbs.rgb;
    m.scatter = WU.riverSca.rgb;
    m.a2 = 0.0025 + v.a.z * 0.02 + rain * 0.01 + smoothstep(0.02, 0.2, dist * WU.snap.w) * 0.01;
    m.foam = r.w;
    m.refr = 0.03;
    m.caust = 0.5;
    m.banks = 300.0;
    // fade in at the source, fade out where the river meets the sea
    edge = smoothstep(0.0, 30.0, v.uv.y);
    if (WU.misc.z > 0.5) { edge *= smoothstep(WU.misc.y - 0.4, WU.misc.y + 0.8, P.y); }
  }
  if (rain > 0.01 && dist < 60.0) {
    let rs = wRain(P.xz, t, rain) * (1.0 - smoothstep(25.0, 60.0, dist));
    N = normalize(N + vec3f(-rs.x, 0.0, -rs.y));
  }
  if (!ff) { N = -N; }
  let c = wShade(P, N, v.pos, m);
  return c * edge;
}

// ------------------------------------------------------------------ mist ----
struct MistIn {
  @location(0) base: vec3f,  // the foot of the fall
  @location(1) size: vec4f,  // x width m, y drop m, zw downstream unit xz
};
struct MistOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) a: vec2f,     // x opacity, y seed
  @location(2) world: vec3f,
};

@vertex
fn vsMist(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32, mi: MistIn) -> MistOut {
  let j = vi / 6u;
  let k = vi % 6u;
  let corner = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[k];
  let seed = wHash21(vec2f(f32(j) * 1.37, f32(ii) * 7.91));
  let seed2 = wHash21(vec2f(f32(j) * 5.11 + 3.0, f32(ii) * 1.3));
  let life = fract(WU.misc.x * (0.08 + 0.05 * seed2) + seed);
  let drop = max(mi.size.y, 1.0);
  let dirv = vec3f(mi.size.z, 0.0, mi.size.w);
  let side = vec3f(-mi.size.w, 0.0, mi.size.z);
  let across = (seed2 - 0.5) * mi.size.x * 1.1;
  var c = mi.base + side * across + dirv * (life * min(drop, 30.0) * 0.4 + 0.5);
  c.y += life * min(drop, 30.0) * (0.15 + 0.3 * seed) + 0.3;
  c += vec3f(G.wind.x, 0.0, G.wind.y) * (life * 1.5);
  let radius = (0.2 + 0.8 * life) * clamp(mi.size.x * 0.45 + drop * 0.05, 1.2, 12.0);
  let camR = vec3f(G.view[0][0], G.view[1][0], G.view[2][0]);
  let camU = vec3f(G.view[0][1], G.view[1][1], G.view[2][1]);
  let p = c + (camR * corner.x + camU * corner.y) * radius;
  var o: MistOut;
  o.pos = G.viewProj * vec4f(p, 1.0);
  o.uv = corner;
  o.a = vec2f(sin(life * W_PI) * 0.1 * clamp(drop / 12.0, 0.3, 1.0), seed);
  o.world = p;
  return o;
}

@fragment
fn fsMist(v: MistOut) -> @location(0) vec4f {
  let r = length(v.uv);
  if (r > 1.0) { discard; }
  let n = wFbm(v.uv * 1.8 + v.a.y * 30.0);
  var a = pow(1.0 - r * r, 2.0) * smoothstep(0.2, 0.75, n) * v.a.x;
  // soft against the ground
  let uv = v.pos.xy * G.screen.zw;
  let dS = wDepthAt(uv);
  if (dS > 0.0) { a *= clamp((wLinDepth(dS) - wLinDepth(v.pos.z)) / 2.0, 0.0, 1.0); }
  let V = normalize(G.camPos.xyz - v.world);
  let L = normalize(G.sunDir.xyz);
  let ph = wPhaseM(dot(-V, L), 0.6);
  let col = G.ambient.rgb * 0.8 + G.sunColor.rgb * ((0.25 + ph * 2.0) * max(L.y + 0.1, 0.0) * (1.0 - G.weather.x * 0.7)) + wMoonColor() * 0.2;
  return vec4f(col * a, a);
}
