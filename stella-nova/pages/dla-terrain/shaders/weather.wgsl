// ============================================================================
//  DLA TERRAIN  ·  shaders/weather.wgsl — volumetric haze, rain, snow,
//  lightning and rainbows (package SKY). render/weather.js joins:
//  common.wgsl + detail + the SKY library part of sky.wgsl + this file.
// ----------------------------------------------------------------------------
//  HAZE  a froxel volume (frustum voxels, 160 x 90 x 64 at full quality).
//    Slices are exponential in distance from S.vol0.x to S.vol0.y.
//    csFroxInject   per froxel: the medium (Rayleigh and Mie of the
//                   atmosphere at that height, ground haze with height
//                   falloff, noise banks that drift in G.wind, morning
//                   valley fog that pools under S.vol0.w over low ground,
//                   rain and snow) and its in-scatter: the sun through
//                   CORE's cascaded shadow map (sunShadow, group 2) and
//                   the cloud shadow (shafts through cloud gaps), the
//                   multiple-scattering LUT, sky ambient, the moon, the
//                   lightning flash. Jittered in depth each frame and
//                   blended with the reprojected last frame (G.prevViewProj).
//    csFroxIntegrate  front to back, energy conserving (Hillaire 2015,
//                   "Physically based and unified volumetric rendering in
//                   Frostbite"): rgb in-scatter, a transmittance.
//    fsHaze         applies the volume to the scene (and to water, which
//                   is in the scene colour by then). Sky pixels get the
//                   fog part only, by a closed form height-fog integral
//                   coloured by the far slice, and the shafts: the sky LUT
//                   has no shadows, so the in-scatter that shadows remove
//                   (outLoss, integrated into tLossSky) comes off the sky. Rainbows: primary at 42 deg
//                   and secondary at 51 deg round the anti-solar point,
//                   with Alexander's dark band, when S.misc.w > 0.
//    The height-fog idea and the sun in-scatter follow the city fog of
//    pages/city-atlas/shaders/sky.wgsl; the phase functions are those of
//    pages/forge/shaders/atmo-common.wgsl.
//  PRECIPITATION  vsPrecip / fsPrecip, instanced quads, no buffers:
//    instances [0, rain) are streaks, [rain, rain + splash) are splash
//    rings on terrainHeight, the rest are snow flakes. Each lives in a box
//    round the camera that wraps in world space, so the drops do not swim
//    with the camera. Streak length = speed x exposure (motion blur), at
//    least one pixel wide, with the alpha scaled to keep the energy.
//  LIGHTNING  vsBolt / fsBolt draw the segments of the bolt that
//    render/weather.js grows with lib/dla-engine.js (a DLA bolt). Each
//    segment is a core quad and a wide glow quad, additive HDR.
//
//  grep -n targets: "fn vol_sliceDist", "fn vol_medium", "fn csFroxInject",
//  "fn csFroxIntegrate", "fn vol_rainbow", "fn fsHaze", "fn vsPrecip",
//  "fn fsPrecip", "fn vsBolt", "fn fsBolt"
// ============================================================================

fn vol_grid() -> vec3u { return vec3u(S.vol2.xyz); }
fn vol_sliceDist(s: f32) -> f32 {
  return S.vol0.x * pow(S.vol0.y / S.vol0.x, s / S.vol2.z);
}
fn vol_distSlice(d: f32) -> f32 {
  return log(max(d, S.vol0.x) / S.vol0.x) / log(S.vol0.y / S.vol0.x) * S.vol2.z;
}

struct VolMedium { sR: vec3f, sM: f32, sF: f32, ext: f32 }

// The medium at world point p, per m. sR Rayleigh, sM Mie (aerosol), sF
// fog-like (ground haze, valley fog, rain and snow).
fn vol_medium(p: vec3f) -> VolMedium {
  var m: VolMedium;
  let hSea = max(p.y - G.terrain.z, 0.0);
  let hKm = hSea * 0.001;
  m.sR = S.rayleigh.xyz * 0.001 * exp(-hKm / S.rayleigh.w);
  m.sM = S.mieS.x * 0.001 * exp(-hKm / S.mieS.w);
  let gnd = terrainHeight(p.xz);
  let hG = max(p.y - gnd, 0.0);
  // noise banks that drift with the wind
  let wind = vec3f(G.wind.x, 0.0, G.wind.y) * G.camPos.w;
  let n1 = textureSampleLevel(tNoiseBase, sRepeat, (p - wind) / 1400.0, 0.0);
  let n2 = textureSampleLevel(tNoiseDetail, sRepeat, (p - wind * 1.7) / 260.0, 0.0);
  let bank = clamp(n1.r * 1.3 - 0.25 + (n2.a - 0.5) * 0.4, 0.0, 1.5);
  // ground haze: a thin layer on the ground and a deep layer above the sea
  let haze = S.vol1.z * (0.45 * exp(-hG / 140.0) + 0.55 * exp(-hSea / 1300.0)) * (0.55 + 0.6 * bank);
  // valley fog: a lake of fog under the fog top, ragged top edge
  let top = S.vol0.w + (n1.g - 0.5) * 70.0 + (n2.r - 0.5) * 25.0;
  let valley = S.precip.w * S.vol0.z * sk_ss(top + 20.0, top - 60.0, p.y) * (0.5 + 0.8 * bank) * sk_ss(-2.0, 6.0, hG);
  // rain and snow under the cloud base
  let below = sk_ss(S.cloud0.x + 200.0, S.cloud0.x - 300.0, p.y);
  let precip = (S.vol1.x * 1.2e-4 + S.vol1.y * 3.5e-4) * below;
  m.sF = haze + valley + precip;
  m.ext = dot(m.sR, vec3f(0.2126, 0.7152, 0.0722)) + m.sM * 1.11 + m.sF;
  return m;
}

@group(3) @binding(0) var outInject: texture_storage_3d<rgba16float, write>;
@group(3) @binding(1) var histInject: texture_3d<f32>;
// the sun in-scatter that the shadows take away (rgb), for the shafts
// across the sky: the sky LUT has no shadows, so fsHaze takes this off it
@group(3) @binding(4) var outLoss: texture_storage_3d<rgba16float, write>;
@group(3) @binding(5) var histLoss: texture_3d<f32>;

// in-scatter and extinction are stored per km (x 1000) so fp16 keeps them
const VOL_K: f32 = 1000.0;

@compute @workgroup_size(8, 8, 1)
fn csFroxInject(@builtin(global_invocation_id) id: vec3u) {
  let gd = vol_grid();
  if (id.x >= gd.x || id.y >= gd.y || id.z >= gd.z) { return; }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(gd.xy);
  let rd = viewRay(uv);
  let jz = fract(S.vol1.w + 0.25 * cm_ign(vec2f(id.xy) + vec2f(f32(id.z) * 3.1, 0.0)));
  let d = vol_sliceDist(f32(id.z) + jz);
  let p = G.camPos.xyz + rd * d;
  let m = vol_medium(p);

  let cosT = dot(rd, G.sunDir.xyz);
  let pR = sk_phaseR(cosT);
  let pM = sk_phaseM(cosT, S.mieA.w);
  // fog droplets: forward peak plus a broad part
  let pF = mix(sk_hg(cosT, 0.72), 1.0 / (4.0 * SK_PI), 0.35);
  let sun = sk_sunRadiance(p);
  let cvis = cloudShadow(p);
  var vis = cvis;
  if (vis > 0.001 && G.sunDir.y > -0.05) { vis *= sunShadow(p, vec3f(0.0)); }
  // the loss counts the air only (the Rayleigh and Mie of the sky LUT);
  // under a full deck there is no clear-sky shaft to take away
  var loss = sun * (1.0 - vis) * (m.sR * pR + vec3f(m.sM * pM)) * (1.0 - S.cloud0.z * 0.8);
  let rKm = sk_rKm(p.y);
  let ms = sk_multi(rKm, G.sunDir.y) * S.sun.y;
  var Ls = sun * vis * (m.sR * pR + vec3f(m.sM * pM + m.sF * pF)) + ms * (m.sR + vec3f(m.sM + m.sF * 0.5));
  // sky ambient (G.ambient is irradiance: radiance = E / pi)
  Ls += G.ambient.rgb * (1.0 / SK_PI) * (m.sF + m.sM * 0.5) * 0.85;
  // moon
  let cm = dot(rd, S.moon.xyz);
  Ls += sk_moonRadiance(p) * (m.sR * sk_phaseR(cm) + vec3f((m.sM + m.sF) * sk_hg(cm, 0.7)));
  // lightning: the whole air lights up, most near the bolt
  let bd = length(p - S.bolt.xyz);
  Ls += S.bolt.w * vec3f(0.7, 0.78, 1.0) * (m.sF + m.sM + 2e-5) * (0.6 + 30.0 * exp(-bd / 1200.0));
  var cur = vec4f(Ls * VOL_K, m.ext * VOL_K);
  var curLoss = vec4f(loss * VOL_K, 1.0);

  // temporal reprojection
  let pc = G.prevViewProj * vec4f(p, 1.0);
  if (pc.w > 0.0 && S.vol2.w > 0.0) {
    let puv = vec2f(pc.x / pc.w * 0.5 + 0.5, 0.5 - pc.y / pc.w * 0.5);
    let pd = length(p - S.prevCam.xyz);
    let pz = (vol_distSlice(pd) + 0.0) / S.vol2.z;
    if (all(puv > vec2f(0.0)) && all(puv < vec2f(1.0)) && pz > 0.0 && pz < 1.0) {
      let h = textureSampleLevel(histInject, sClamp, vec3f(puv, pz), 0.0);
      cur = mix(cur, h, S.vol2.w);
      let hl = textureSampleLevel(histLoss, sClamp, vec3f(puv, pz), 0.0);
      curLoss = mix(curLoss, hl, S.vol2.w);
    }
  }
  textureStore(outInject, id, cur);
  textureStore(outLoss, id, curLoss);
}

@group(3) @binding(2) var inInject: texture_3d<f32>;
@group(3) @binding(3) var outVolume: texture_storage_3d<rgba16float, write>;
@group(3) @binding(6) var inLoss: texture_3d<f32>;
@group(3) @binding(7) var outLossSky: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn csFroxIntegrate(@builtin(global_invocation_id) id: vec3u) {
  let gd = vol_grid();
  if (id.x >= gd.x || id.y >= gd.y) { return; }
  var L = vec3f(0.0);
  var Lo = vec3f(0.0);
  var T = 1.0;
  var dPrev = 0.0;
  for (var z = 0u; z < gd.z; z++) {
    let v = textureLoad(inInject, vec3u(id.xy, z), 0) / VOL_K;
    let lo = textureLoad(inLoss, vec3u(id.xy, z), 0).rgb / VOL_K;
    let dEnd = vol_sliceDist(f32(z) + 1.0);
    let dt = dEnd - dPrev;
    dPrev = dEnd;
    let ext = max(v.a, 1e-9);
    let Ts = exp(-ext * dt);
    L += T * (v.rgb - v.rgb * Ts) / ext;
    Lo += T * (lo - lo * Ts) / ext;
    T *= Ts;
    textureStore(outVolume, vec3u(id.xy, z), vec4f(L, T));
  }
  textureStore(outLossSky, vec2u(id.xy), vec4f(Lo, T));
}

// ── apply ────────────────────────────────────────────────────────────────────
// draw bindings: group 1 of the draw pipelines is the SKY read set plus these
// (10 scene depth, 11 and 12 the cloud targets of clouds.wgsl, 13, 14)
@group(1) @binding(10) var tDepth: texture_depth_2d;
@group(1) @binding(13) var tVolume: texture_3d<f32>;
@group(1) @binding(15) var tLossSky: texture_2d<f32>;

struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f }

@vertex
fn vsHaze(@builtin(vertex_index) vi: u32) -> VOut {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o: VOut;
  o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}

// A spectral band: hue from x (0 red edge .. 1 violet edge).
fn vol_spectrum(x: f32) -> vec3f {
  let r = sk_ss(0.55, 0.0, x) + 0.25 * sk_ss(0.85, 1.0, x);
  let g = sk_ss(0.0, 0.4, x) * sk_ss(0.85, 0.45, x);
  let b = sk_ss(0.45, 0.9, x);
  return vec3f(r, g, b);
}
fn vol_rainbow(rd: vec3f) -> vec3f {
  if (S.misc.w <= 0.0) { return vec3f(0.0); }
  let anti = -G.sunDir.xyz;
  let a = acos(clamp(dot(rd, anti), -1.0, 1.0)) * (180.0 / SK_PI);
  // primary 40.6 (violet) .. 42.4 (red); secondary 50.3 (red) .. 53.6 (violet)
  let p1 = clamp((42.4 - a) / 1.8, -0.5, 1.5);
  let b1 = vol_spectrum(clamp(p1, 0.0, 1.0)) * sk_ss(-0.5, 0.0, p1) * sk_ss(1.5, 1.0, p1);
  let p2 = clamp((a - 50.3) / 3.3, -0.5, 1.5);
  let b2 = vol_spectrum(clamp(p2, 0.0, 1.0)) * sk_ss(-0.5, 0.0, p2) * sk_ss(1.5, 1.0, p2) * 0.35;
  // supernumerary glow inside the bow
  let inner = sk_ss(42.0, 30.0, a) * 0.12;
  let bow = (b1 + b2 + vec3f(inner)) * sk_ss(-0.02, 0.06, rd.y + 0.04);
  return bow * S.misc.w * G.sunColor.rgb * 0.011;
}

@fragment
fn fsHaze(i: VOut) -> @location(0) vec4f {
  let ij = vec2i(i.pos.xy);
  let dz = textureLoad(tDepth, ij, 0);
  let rd = viewRay(i.uv);
  let n = S.vol2.z;
  if (dz > 0.0) {
    let wp = worldFromDepth(i.uv, dz);
    let dist = length(wp - G.camPos.xyz);
    let w = clamp((vol_distSlice(dist) - 0.5) / n, 0.5 / n, 1.0 - 0.5 / n);
    let v = textureSampleLevel(tVolume, sClamp, vec3f(i.uv, w), 0.0);
    var L = v.rgb;
    if (dist > 150.0) { L += vol_rainbow(rd) * (1.0 - v.a * 0.5) * sk_ss(150.0, 600.0, dist); }
    // past the far slice: keep the far transmittance
    return vec4f(L, 1.0 - v.a);
  }
  // sky: the fog part only, closed form exponential height fog to infinity
  let far = textureSampleLevel(tVolume, sClamp, vec3f(i.uv, 1.0 - 0.5 / n), 0.0);
  let fogCol = far.rgb / max(1.0 - far.a, 1e-3);
  let h0 = max(G.camPos.y - G.terrain.z, 0.0);
  let H = 1300.0;
  let dy = max(rd.y, 0.0);
  let path = min(H / max(dy, 1e-3), 120000.0);
  let tauHaze = S.vol1.z * 0.55 * exp(-h0 / H) * path * (1.0 - exp(-path * dy / H)) / max(path * dy / H, 1e-3);
  let tauPrec = (S.vol1.x * 1.2e-4 + S.vol1.y * 3.5e-4) * min(max(S.cloud0.x - G.camPos.y, 0.0) / max(dy, 0.05), 6000.0);
  let Tf = exp(-(tauHaze * 0.6 + tauPrec));
  var L = fogCol * (1.0 - Tf);
  // shafts across the sky: take off the in-scatter that ridges and cloud
  // shadows remove (at most most of the sky radiance there)
  let skyL = textureSampleLevel(tSkyView, sClamp, sk_skyViewUV(S.radii.w, rd, G.sunDir.xyz), 0.0).rgb * S.sun.y;
  let lossSky = min(textureSampleLevel(tLossSky, sClamp, i.uv, 0.0).rgb, skyL * 0.8) * Tf;
  L -= lossSky;
  L += vol_rainbow(rd);
  L += S.bolt.w * vec3f(0.5, 0.55, 0.7) * 0.2 * sk_ss(-0.1, 0.4, rd.y);
  return vec4f(L, 1.0 - Tf);
}

// ── rain, splashes and snow ──────────────────────────────────────────────────
struct POut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) col: vec4f,
  @location(2) @interpolate(flat) kind: u32,
}

fn vol_h3(i: u32) -> vec3f { return vec3f(sk_pcg3d(vec3u(i, i * 7u + 3u, 0x9e37u))) * (1.0 / 4294967295.0); }

fn vol_wrap(x: vec2f, c: vec2f, r: f32) -> vec2f {
  return c + (fract((x - c) / (2.0 * r) + 0.5) - 0.5) * 2.0 * r;
}

@vertex
fn vsPrecip(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> POut {
  var o: POut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);   // culled unless set below
  o.uv = vec2f(0.0);
  o.col = vec4f(0.0);
  let corner = array<vec2f, 6>(vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0));
  let c = corner[vi];
  let h = vol_h3(ii);
  let h2 = vol_h3(ii + 1000003u);
  let t = G.camPos.w;
  let cam = G.camPos.xyz;
  let nRain = u32(S.counts.x);
  let nSplash = u32(S.counts.y);
  let wv = vec3f(G.wind.x, 0.0, G.wind.y);
  let px = 2.0 / G.screen.y / G.proj[1][1];  // radians per pixel
  let light = G.ambient.rgb * (1.0 / SK_PI);
  let sunL = G.sunColor.rgb;
  let flash = vec3f(0.8, 0.85, 1.0) * G.weather.w * 3.0;

  if (ii < nRain) {
    o.kind = 0u;
    let R = S.precip.x;
    let speed = 8.5 + 2.0 * h2.x;
    let vel = vec3f(wv.x * 0.9, -speed, wv.z * 0.9);
    let span = 2.0 * R;
    // world anchored: drift with the wind, fall, wrap round the camera
    let base = h.xz * span * 8.0 + vec2f(vel.x, vel.z) * t;
    let xz = vol_wrap(base, cam.xz, R);
    let yy = h.y * span - speed * t;
    let y = cam.y + (fract((yy - cam.y) / span + 0.5) - 0.5) * span;
    let p = vec3f(xz.x, y, xz.y);
    if (y < terrainHeight(xz)) { return o; }
    let tail = p - vel * S.precip.z;
    let pa = G.viewProj * vec4f(p, 1.0);
    let pb = G.viewProj * vec4f(tail, 1.0);
    if (pa.w < 0.15 || pb.w < 0.15) { return o; }
    let sa = pa.xy / pa.w;
    let sb = pb.xy / pb.w;
    var ax = sb - sa;
    let asp = G.screen.x * G.screen.zw.y;
    ax.x *= asp;
    let l = length(ax);
    if (l < 1e-6) { return o; }
    let dir = ax / l;
    var nrm = vec2f(-dir.y, dir.x);
    nrm.x /= asp;
    // width: 1.2 mm drop, at least 1 px; energy kept by the alpha
    let dist = pa.w;
    let wPx = max(0.0012 / (dist * px), 1.0);
    let cov = min(0.0012 / (dist * px), 1.0) * 0.5 + 0.5;
    let half = nrm * wPx * G.screen.zw.y * 1.0;
    let q = mix(sa, sb, c.y) + half * c.x;
    let z = mix(pa.z / pa.w, pb.z / pb.w, c.y);
    o.pos = vec4f(q, z, 1.0);
    o.uv = vec2f(c.x, c.y);
    let fade = sk_ss(0.4, 1.5, dist) * sk_ss(R, R * 0.6, length(p - cam));
    let fwd = pow(max(dot(normalize(vel), -G.sunDir.xyz) * 0.5 + 0.5, 0.0), 6.0);
    let col = light * 0.55 + sunL * (0.01 + 0.06 * fwd) + flash;
    o.col = vec4f(col, 0.3 * fade * cov * S.vol1.x);
    return o;
  }
  if (ii < nRain + nSplash) {
    o.kind = 1u;
    let R = 18.0;
    let life = 0.32;
    let ph = fract(t / life + h.z);
    let cyc = floor(t / life + h.z);
    let hc = vol_h3(ii * 31u + u32(cyc) * 977u);
    let xz = cam.xz + (hc.xy - 0.5) * 2.0 * R;
    let y = terrainHeight(xz) + 0.02;
    let r = mix(0.02, 0.14, sqrt(ph));
    let p = vec3f(xz.x + c.x * r, y, xz.y + (c.y * 2.0 - 1.0) * r);
    let pc = G.viewProj * vec4f(p, 1.0);
    if (pc.w < 0.2) { return o; }
    o.pos = pc;
    o.uv = vec2f(c.x, c.y * 2.0 - 1.0);
    let fade = (1.0 - ph) * sk_ss(R, R * 0.5, length(xz - cam.xz));
    o.col = vec4f(light * 0.8 + sunL * 0.03 + flash, 0.35 * fade * S.vol1.x);
    return o;
  }
  // snow
  o.kind = 2u;
  let R = S.precip.y;
  let span = 2.0 * R;
  let fall = 0.8 + 0.6 * h2.x;
  let flutter = vec2f(sin(t * (1.1 + h2.y) + h.x * 40.0), cos(t * (0.9 + h2.z) + h.y * 40.0)) * 0.35;
  let base = h.xz * span * 8.0 + vec2f(wv.x, wv.z) * t * 0.85 + flutter;
  let xz = vol_wrap(base, cam.xz, R);
  let yy = h.y * span - fall * t;
  let y = cam.y + (fract((yy - cam.y) / span + 0.5) - 0.5) * span;
  let p = vec3f(xz.x, y, xz.y);
  if (y < terrainHeight(xz)) { return o; }
  let pc = G.viewProj * vec4f(p, 1.0);
  if (pc.w < 0.2) { return o; }
  let size = mix(0.008, 0.02, h2.y);
  let sPx = max(size / (pc.w * px), 1.3);
  let cov = min(size / (pc.w * px * 1.3), 1.0);
  let off = (c * vec2f(1.0, 2.0) - vec2f(0.0, 1.0)) * sPx * G.screen.zw * vec2f(2.0, 2.0) * 0.5;
  o.pos = vec4f(pc.xy + off * pc.w, pc.z, pc.w);
  o.uv = vec2f(c.x, c.y * 2.0 - 1.0);
  let fade = sk_ss(0.3, 1.2, pc.w) * sk_ss(R, R * 0.55, length(p - cam));
  o.col = vec4f(light * 0.9 + sunL * 0.25 + flash, 0.85 * fade * mix(cov, 1.0, 0.4) * clamp(S.vol1.y * 1.5, 0.0, 1.0));
  return o;
}

@fragment
fn fsPrecip(i: POut) -> @location(0) vec4f {
  let sd = textureLoad(tDepth, vec2i(i.pos.xy), 0);
  if (sd > i.pos.z) { discard; }
  var a = i.col.a;
  if (i.kind == 0u) {
    // a streak: soft across, tapered at both ends
    a *= (1.0 - i.uv.x * i.uv.x) * sk_ss(0.0, 0.25, i.uv.y) * sk_ss(1.0, 0.7, i.uv.y);
  } else if (i.kind == 1u) {
    let r = length(i.uv);
    a *= sk_ss(1.0, 0.8, r) * sk_ss(0.45, 0.8, r);
  } else {
    let r = length(i.uv);
    a *= sk_ss(1.0, 0.2, r);
  }
  if (a < 0.002) { discard; }
  return vec4f(i.col.rgb * a, a);
}

// ── lightning bolt ───────────────────────────────────────────────────────────
struct BoltSeg { a: vec4f, b: vec4f }   // a: xyz, w width m; b: xyz, w brightness
@group(1) @binding(14) var<storage, read> bolt: array<BoltSeg>;

struct BOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) k: vec2f }

@vertex
fn vsBolt(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> BOut {
  var o: BOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  o.uv = vec2f(0.0);
  o.k = vec2f(0.0);
  let corner = array<vec2f, 6>(vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0));
  let c = corner[vi];
  let s = bolt[ii / 2u];
  let glow = (ii & 1u) == 1u;
  let pa = G.viewProj * vec4f(s.a.xyz, 1.0);
  let pb = G.viewProj * vec4f(s.b.xyz, 1.0);
  if (pa.w < 1.0 || pb.w < 1.0) { return o; }
  let sa = pa.xy / pa.w;
  let sb = pb.xy / pb.w;
  let asp = G.screen.x * G.screen.zw.y;
  var ax = sb - sa;
  ax.x *= asp;
  let l = max(length(ax), 1e-6);
  var nrm = vec2f(-ax.y, ax.x) / l;
  nrm.x /= asp;
  let px = 2.0 / G.screen.y / G.proj[1][1];
  // the glow quad: wide for the main channel, narrow for the branches
  let wPx = max(s.a.w / (pa.w * px), 1.0) * select(1.0, 3.0 + 6.0 * s.b.w, glow);
  let q = mix(sa, sb, c.y) + nrm * c.x * wPx * G.screen.zw.y;
  o.pos = vec4f(q, mix(pa.z / pa.w, pb.z / pb.w, c.y), 1.0);
  o.uv = c;
  o.k = vec2f(s.b.w, select(0.0, 1.0, glow));
  return o;
}

@fragment
fn fsBolt(i: BOut) -> @location(0) vec4f {
  let sd = textureLoad(tDepth, vec2i(i.pos.xy), 0);
  if (sd > i.pos.z) { discard; }
  let x = abs(i.uv.x);
  var e: f32;
  if (i.k.y > 0.5) { e = exp(-x * x * 6.0) * 0.05 * i.k.x; } else { e = sk_ss(1.0, 0.2, x); }
  let col = vec3f(0.78, 0.84, 1.0) * e * i.k.x * S.bolt.w * 900.0;
  return vec4f(col, 0.0);
}
