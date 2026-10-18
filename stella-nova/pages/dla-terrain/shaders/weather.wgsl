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
//                   lightning flash. The valley fog (its density and its
//                   top) and the rain and snow shafts under the cloud bases
//                   come from the weather model (wx_tile). Jittered in depth each frame and
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
//    with the camera. Their drift and fall come from phases that
//    render/weather.js precipPhases works out in double precision (no
//    wind x time and no speed x time in f32, which made the rain judder
//    and sweep as the gusts changed). Drop k of each kind shows when the
//    amount is over k / max, so drops come and go one by one. Streak length = speed x exposure (motion blur), at
//    least one pixel wide, with the alpha scaled to keep the energy.
//  LIGHTNING  vsBolt / fsBolt draw the segments of the bolt that
//    render/weather.js grows with lib/dla-engine.js (a DLA bolt). Each
//    segment is a core quad and a wide glow quad, additive HDR.
//
//  grep -n targets: "fn vol_sliceDist", "fn vol_medium", "fn csFroxInject",
//  "fn csFroxIntegrate", "fn vol_rainbow", "fn fsHaze", "fn vsPrecip",
//  "fn fsPrecip", "fn vsBolt", "fn fsBolt"
// ============================================================================

const HAZE_DEEP_MAX: f32 = 1.4e-4;   // per m: the cap of the deep haze layer
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
  // noise banks that drift with the wind (S.anim1.xy: the drift summed
  // frame by frame in render/sky.js, never wind x time)
  let n1 = textureSampleLevel(tNoiseBase, sRepeat, (p - vec3f(S.anim1.x, 0.0, S.anim1.y)) / 1400.0, 0.0);
  // no detail tile here: its 32-texel cells read as a dotted grid of
  // circles over the fog sea in far aerial views, even large and weak
  let bank = clamp(n1.r * 1.3 - 0.25, 0.0, 1.5);
  // ground haze: a thin layer on the ground and a deep layer above the sea
  // the deep layer is capped: thick weather (fog, storms, blizzards) is
  // thick near the ground and in the valleys, while ridges and the far
  // land stay readable through it, and a far view is not one grey wall
  let deep = min(S.vol1.z, HAZE_DEEP_MAX);
  let haze = ((S.vol1.z * 0.45 * exp(-hG / 140.0)) + (deep * 0.55 * exp(-hSea / 1700.0))) * (0.55 + 0.6 * bank);
  // the weather model here: A cover, type, top, precip; B storm, fog,
  // base, cirrus; C fog top, wind, freezing level
  let wa = wx_tile(p.xz, 0.0);
  let wb = wx_tile(p.xz, 1.0);
  let wc = wx_tile(p.xz, 2.0);
  // valley fog: a lake of fog under the model's fog top, which forms on
  // clear calm nights in low ground and burns off after sunrise
  let top = wc.x + (n1.g - 0.5) * 80.0 + (n1.b - 0.5) * 25.0;
  let valley = S.precip.w * sk_ss(0.0, 0.5, wb.y) * sk_ss(top + 20.0, top - 60.0, p.y) * (0.5 + 0.8 * bank) * sk_ss(-2.0, 6.0, hG);
  // rain shafts under the cloud base of this place: grey curtains that
  // read from far away. In broken, dry air (low cover) the rain dries
  // as it falls: the shaft fades toward the ground (virga). Snow above
  // the freezing level is denser and whiter.
  let pr = clamp(wa.w, 0.0, 1.0);
  var precip = 0.0;
  if (pr > 0.002) {
    let base = wb.z;
    let below = sk_ss(base + 150.0, base - 250.0, p.y);
    let fall = clamp((p.y - gnd) / max(base - gnd, 50.0), 0.0, 1.0);
    let dry = 1.0 - sk_ss(0.35, 0.9, wa.x);
    let virga = mix(1.0, fall * fall, dry * 0.9);
    let snowy = sk_ss(wc.w - 120.0, wc.w + 120.0, p.y);
    let curtain = 0.55 + 0.9 * n1.g;
    precip = pr * mix(1.1e-4, 3.0e-4, snowy) * (1.0 + 0.8 * clamp(wb.x, 0.0, 1.0)) * below * virga * curtain;
  }
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
// SHAFTS: the sun in-scatter with no shadow (rgb per km), a = the share of
// the clear air (Rayleigh and Mie) in it; csShaftMarch reads it
@group(3) @binding(8) var outSun: texture_storage_3d<rgba16float, write>;

// in-scatter and extinction are stored per km (x 1000) so fp16 keeps them
const VOL_K: f32 = 1000.0;
// SHAFTS: the weight of the per-pixel march at distance d (1 near, 0 past
// the shaft range S.anim1.w); 0 everywhere when the mode is not volumetric
fn shaftNear(d: f32) -> f32 {
  if ((S.shadow.w < 0.5) || (S.shadow.w > 1.5)) { return 0.0; }
  let R = max(S.anim1.w, 1.0);
  return 1.0 - sk_ss(R * 0.75, R, d);
}
// the most depth slices of the froxel grid (render/weather.js: 64 at full quality)
const VOL_ZMAX: u32 = 128u;

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
  // SHAFTS (volumetric mode, S.shadow.w = 1): inside the shaft range the
  // per-pixel march of csShaftMarch gives the shadowed sun in-scatter, so
  // the froxel keeps only the part past it (no light counted two times)
  let far = 1.0 - shaftNear(d);
  let sunAir = sun * (m.sR * pR + vec3f(m.sM * pM));
  let sunAll = sun * (m.sR * pR + vec3f(m.sM * pM + m.sF * pF));
  textureStore(outSun, id, vec4f(sunAll * VOL_K, cm_luminance(sunAir) / max(cm_luminance(sunAll), 1e-12)));
  var loss = sunAir * (1.0 - vis) * (1.0 - S.cloud0.z * 0.8) * far;
  let rKm = sk_rKm(p.y);
  let ms = sk_multi(rKm, G.sunDir.y) * S.sun.y;
  var Ls = sunAll * (vis * far) + ms * (m.sR + vec3f(m.sM + m.sF * 0.5));
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
  // the slice count is a uniform: VOL_ZMAX is the constant cap
  let nz = min(gd.z, VOL_ZMAX);
  for (var z = 0u; z < nz; z++) {
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
// the cloud accumulation of clouds.wgsl (a = transmittance through the clouds)
@group(1) @binding(11) var tCloudAcc: texture_2d<f32>;
// SHAFTS: the resolved shaft target (rgb add, a mist transmittance)
@group(1) @binding(17) var tShaft: texture_2d<f32>;

// the shaft target at full pixel ij: the 4 nearest texels, bilinear
// weights times a depth weight (a texel of another surface counts little)
fn shaftAt(ij: vec2i, dz: f32) -> vec4f {
  if (S.shadow.w < 0.5) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  let sz = vec2i(textureDimensions(tShaft));
  let full = vec2i(textureDimensions(tDepth));
  let k = max(i32(round(f32(full.x) / f32(sz.x))), 1);
  let c = (vec2f(ij) / f32(k));
  let q0 = vec2i(floor(c));
  let f = c - floor(c);
  let me = linearDepth(max(dz, 1e-9));
  var sum = vec4f(0.0);
  var ws = 0.0;
  for (var y = 0; y <= 1; y++) {
    for (var x = 0; x <= 1; x++) {
      let q = clamp(q0 + vec2i(x, y), vec2i(0), sz - vec2i(1));
      let dq = textureLoad(tDepth, clamp(q * k, vec2i(0), full - vec2i(1)), 0);
      let bw = select(1.0 - f.x, f.x, x == 1) * select(1.0 - f.y, f.y, y == 1);
      var dw = 1.0;
      if ((dz > 0.0) != (dq > 0.0)) { dw = 0.02; }
      else if (dz > 0.0) { dw = 1.0 / (1.0 + (40.0 * abs(linearDepth(dq) - me) / me)); }
      let wgt = (bw * dw) + 1e-5;
      sum += textureLoad(tShaft, q, 0) * wgt;
      ws += wgt;
    }
  }
  return sum / ws;
}

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

// the froxel volume with a small 5-tap tent (0.75 froxel): in thick
// weather each froxel's jittered sample differs, and one bilinear tap
// showed that as a fixed dot pattern over the haze
fn hazeTap(uv: vec2f, w: f32) -> vec4f {
  let o = vec2f(0.75) / vec2f(S.vol2.xy);
  var v = textureSampleLevel(tVolume, sClamp, vec3f(uv, w), 0.0) * 0.4;
  v += textureSampleLevel(tVolume, sClamp, vec3f(uv + vec2f(o.x, o.y), w), 0.0) * 0.15;
  v += textureSampleLevel(tVolume, sClamp, vec3f(uv + vec2f(-o.x, o.y), w), 0.0) * 0.15;
  v += textureSampleLevel(tVolume, sClamp, vec3f(uv + vec2f(o.x, -o.y), w), 0.0) * 0.15;
  v += textureSampleLevel(tVolume, sClamp, vec3f(uv + vec2f(-o.x, -o.y), w), 0.0) * 0.15;
  return v;
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
    let v = hazeTap(i.uv, w);
    // SHAFTS: the near sun in-scatter with sharp shadows and the mist
    let sh = shaftAt(ij, dz);
    var L = v.rgb + max(sh.rgb, vec3f(0.0));
    if (dist > 150.0) { L += vol_rainbow(rd) * (1.0 - v.a * 0.5) * sk_ss(150.0, 600.0, dist); }
    // past the far slice: keep the far transmittance
    return vec4f(L, 1.0 - (v.a * sh.a));
  }
  // sky: the fog part only, closed form exponential height fog to infinity
  let far = textureSampleLevel(tVolume, sClamp, vec3f(i.uv, 1.0 - 0.5 / n), 0.0);
  let fogCol = far.rgb / max(1.0 - far.a, 1e-3);
  let h0 = max(G.camPos.y - G.terrain.z, 0.0);
  let H = 1700.0;
  let dy = max(rd.y, 0.0);
  let path = min(H / max(dy, 1e-3), 120000.0);
  let tauHaze = min(S.vol1.z, HAZE_DEEP_MAX) * 0.55 * exp(-h0 / H) * path * (1.0 - exp(-path * dy / H)) / max(path * dy / H, 1e-3);
  let tauPrec = (S.vol1.x * 1.2e-4 + S.vol1.y * 3.5e-4) * min(max(S.cloud0.x - G.camPos.y, 0.0) / max(dy, 0.05), 6000.0);
  let Tf = exp(-(tauHaze * 0.6 + tauPrec));
  var L = fogCol * (1.0 - Tf);
  // shafts across the sky: take off the in-scatter that ridges and cloud
  // shadows remove (at most most of the sky radiance there)
  let skyL = textureSampleLevel(tSkyView, sClamp, sk_skyViewUV(S.radii.w, rd, G.sunDir.xyz), 0.0).rgb * S.sun.y;
  // only the clear sky part of the pixel loses it: a cloud in front is a
  // grey surface, and the blue part taken off it would turn it olive
  let clearSky = textureSampleLevel(tCloudAcc, sClamp, i.uv, 0.0).a;
  let lossSky = min(textureSampleLevel(tLossSky, sClamp, i.uv, 0.0).rgb, skyL * 0.8) * Tf * clearSky;
  L -= lossSky;
  // SHAFTS: the mist, less the near in-scatter that shadows take off the
  // sky (at most most of the sky radiance there)
  let sh = shaftAt(ij, 0.0);
  L += max(sh.rgb, -(skyL * 0.8 * Tf * clearSky) + lossSky);
  L += vol_rainbow(rd);
  L += S.bolt.w * vec3f(0.5, 0.55, 0.7) * 0.2 * sk_ss(-0.1, 0.4, rd.y);
  return vec4f(L, 1.0 - (Tf * sh.a));
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
    // drop k of the rain list: the same drop whatever the other counts
    let k = ii;
    let h = vol_h3(k);
    let h2 = vol_h3(k + 1000003u);
    // drop k shows when the rain is over k / max: drops come and go one
    // by one as the rain changes, no pop
    let thr = f32(k) / max(S.anim4.z, 1.0);
    let vis = sk_ss(thr, thr + 0.06, S.vol1.x);
    if (vis <= 0.0) { return o; }
    let R = S.precip.x;
    let span = 2.0 * R;
    // 8 speed classes, so the fall phase comes from S.anim3 exactly
    // (render/weather.js precipPhases): no speed x large time here
    let cls = f32(k % 8u);
    let speed = 8.5 + 0.25 * cls;
    let vel = vec3f(wv.x * 0.9, -speed, wv.z * 0.9);
    // world anchored: drift with the wind (S.anim2.xy), fall, wrap round the camera
    let base = h.xz * span * 8.0 + S.anim2.xy;
    let xz = vol_wrap(base, cam.xz, R);
    let y = cam.y + (fract(h.y - S.anim3.x - cls * S.anim3.y - cam.y / span + 0.5) - 0.5) * span;
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
    o.col = vec4f(col, 0.3 * fade * cov * vis * min(S.vol1.x * 2.0 + 0.3, 1.0));
    return o;
  }
  if (ii < nRain + nSplash) {
    o.kind = 1u;
    let k = ii - nRain;
    let h = vol_h3(k + 2000003u);
    let thr = f32(k) / max(S.anim1.z, 1.0);
    let vis = sk_ss(thr, thr + 0.06, S.vol1.x);
    if (vis <= 0.0) { return o; }
    let R = 18.0;
    let life = 0.32;
    let t = S.anim4.x;
    let ph = fract(t / life + h.z);
    let cyc = floor(t / life + h.z);
    let hc = vol_h3(k * 31u + u32(cyc) * 977u);
    let xz = cam.xz + (hc.xy - 0.5) * 2.0 * R;
    let y = terrainHeight(xz) + 0.02;
    let r = mix(0.02, 0.14, sqrt(ph));
    let p = vec3f(xz.x + c.x * r, y, xz.y + (c.y * 2.0 - 1.0) * r);
    let pc = G.viewProj * vec4f(p, 1.0);
    if (pc.w < 0.2) { return o; }
    o.pos = pc;
    o.uv = vec2f(c.x, c.y * 2.0 - 1.0);
    let fade = (1.0 - ph) * sk_ss(R, R * 0.5, length(xz - cam.xz));
    o.col = vec4f(light * 0.8 + sunL * 0.03 + flash, 0.35 * fade * vis * min(S.vol1.x * 2.0 + 0.3, 1.0));
    return o;
  }
  // snow
  o.kind = 2u;
  let k = ii - nRain - nSplash;
  let h = vol_h3(k + 3000017u);
  let h2 = vol_h3(k + 4000037u);
  let thr = f32(k) / max(S.anim4.w, 1.0);
  let vis = sk_ss(thr, thr + 0.06, S.vol1.y);
  if (vis <= 0.0) { return o; }
  let R = S.precip.y;
  let span = 2.0 * R;
  let cls = f32(k % 8u);
  // flutter: whole multiples of 0.01 rad/s, so the wrap of S.anim4.y
  // (t mod 200 pi) is seamless
  let tf = S.anim4.y;
  let f1 = round((1.1 + h2.y) * 100.0) / 100.0;
  let f2 = round((0.9 + h2.z) * 100.0) / 100.0;
  let flutter = vec2f(sin(tf * f1 + h.x * 40.0), cos(tf * f2 + h.y * 40.0)) * 0.35;
  let base = h.xz * span * 8.0 + S.anim2.zw + flutter;
  let xz = vol_wrap(base, cam.xz, R);
  let y = cam.y + (fract(h.y - S.anim3.z - cls * S.anim3.w - cam.y / span + 0.5) - 0.5) * span;
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
  o.col = vec4f(light * 0.9 + sunL * 0.25 + flash, 0.85 * fade * mix(cov, 1.0, 0.4) * vis * clamp(S.vol1.y * 1.5 + 0.3, 0.0, 1.0));
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

// ── SHAFTS: god rays and volumetric shadows ──────────────────────────────────
// render/weather.js runs these after CORE's water pass (module
// volumetricPrep), so the depth and the sun shadow map are of this frame.
//   csShaftMarch   (volumetric mode 1) per pixel of a half or quarter size
//                  target: march the view ray to min(depth, the shaft range
//                  R) in at most SHAFT_MAX steps (IGN jitter, steps dense
//                  near the eye). Each step takes one hardware 2 x 2 tap of
//                  CORE's cascaded sun shadow (fn shaftShadow) and the cloud
//                  shadow, and the unshadowed sun in-scatter and the haze
//                  transmittance from the froxels (outSun, tVolume). The
//                  froxels drop the same near term (fn shaftNear), so the
//                  mean light stays the same: only the shadows get sharp.
//                  A thin forward-scattering mist (Henyey-Greenstein, a
//                  strong forward lobe) near the ground makes the shafts
//                  read; it also takes light away (rgb in, a transmittance).
//                  Sky pixels: rgb is the mist minus the near in-scatter
//                  that the shadows take off the sky LUT.
//   csShaftRadial  (screen mode 2, phones and Low) a radial blur of the
//                  clear sky round the sun on screen, at most SHAFT_RADIAL
//                  taps; the cheap fallback.
//   csShaftResolve reprojects the last result with G.prevViewProj, clamps
//                  it to the 3 x 3 range of this frame, blends 0.88.
//   fsHaze         upsamples it with depth weights (fn shaftAt).
// Shaft uniform SH (render/weather.js shaftUniforms):
struct ShaftU {
  p0: vec4f,   // x range R m, y steps, z mist per m, w mist height m
  p1: vec4f,   // x mode, y frame index, z full width px, w full height px
  p2: vec4f,   // xyz sun radiance scale for the radial mode, w radial strength
  p3: vec4f,   // x history weight (0 = reset), yzw spare
};
const SHAFT_MAX: i32 = 32;      // the most march steps (a constant cap)
const SHAFT_RADIAL: i32 = 24;   // the most radial taps (a constant cap)
@group(3) @binding(20) var tDepthS: texture_depth_2d;
@group(3) @binding(21) var tVolS: texture_3d<f32>;
@group(3) @binding(22) var tSunS: texture_3d<f32>;
@group(3) @binding(23) var outShaft: texture_storage_2d<rgba16float, write>;
@group(3) @binding(24) var<uniform> SH: ShaftU;
@group(3) @binding(25) var tShaftRaw: texture_2d<f32>;
@group(3) @binding(26) var tShaftHist: texture_2d<f32>;
@group(3) @binding(27) var tCloudAccS: texture_2d<f32>;

// the full-size depth texel that a shaft texel stands for
fn shaftSrc(q: vec2i, full: vec2i, k: i32) -> vec2i { return clamp(q * k, vec2i(0), full - vec2i(1)); }

// one hardware compare tap of the sun shadow (no PCF: the march averages)
fn shaftShadow(p: vec3f, viewZ: f32) -> f32 {
  let n = clamp(i32(cascades.params.x), 0, 4);
  if (n <= 0) { return 1.0; }
  let c = cascadeOf(viewZ);
  let s = shadowTap(c, p);
  if (any(s.xy < vec2f(0.0)) || any(s.xy > vec2f(1.0)) || (s.z > 1.0)) { return 1.0; }
  let v = textureSampleCompareLevel(tShadow, sShadow, s.xy, c, s.z + cascades.params.z);
  return mix(v, 1.0, sk_ss(cascades.splits[n - 1] * 0.9, cascades.splits[n - 1], viewZ));
}

// the mist phase: a strong forward lobe and a broad part
fn shaftPhase(c: f32) -> f32 { return (0.55 * sk_hg(c, 0.8)) + (0.45 * sk_hg(c, 0.2)); }

@compute @workgroup_size(8, 8)
fn csShaftMarch(@builtin(global_invocation_id) id: vec3u) {
  let sz = textureDimensions(outShaft);
  if ((id.x >= sz.x) || (id.y >= sz.y)) { return; }
  let full = vec2i(textureDimensions(tDepthS));
  let k = max(i32(round(f32(full.x) / f32(sz.x))), 1);
  let src = shaftSrc(vec2i(id.xy), full, k);
  let uv = (vec2f(src) + 0.5) / vec2f(full);
  let dz = textureLoad(tDepthS, src, 0);
  let sky = dz <= 0.0;
  let ro = G.camPos.xyz;
  let rd = viewRay(uv);
  var dist = 1.0e9;
  if (!sky) { dist = length(worldFromDepth(uv, dz) - ro); }
  let R = max(SH.p0.x, 1.0);
  let tEnd = min(dist, R);
  let n = clamp(i32(SH.p0.y), 4, SHAFT_MAX);
  let jit = fract(cm_ign(vec2f(id.xy) + vec2f(f32(u32(SH.p1.y) % 64u) * 5.588238, 0.0)) + (f32(u32(SH.p1.y) % 16u) * 0.618034));
  let cosT = dot(rd, G.sunDir.xyz);
  let fwd = -(G.view * vec4f(rd, 0.0)).z;   // view z per m along the ray
  let gN = vec2f(S.vol2.z);
  // the mist: a layer over the ground, the ground taken as a line from
  // under the eye to under the ray end (two height reads per pixel)
  let hCam = terrainHeight(ro.xz);
  let pEnd = ro + (rd * tEnd);
  let hEnd = terrainHeight(pEnd.xz);
  let sunR = sk_sunRadiance(ro + (rd * (tEnd * 0.3)));
  let lit = sk_ss(-0.04, 0.03, G.sunDir.y);
  let ph = shaftPhase(cosT);
  let amb = G.ambient.rgb * (0.5 / SK_PI);
  var air = vec3f(0.0);    // the shadowed near in-scatter of the haze
  var unsh = vec3f(0.0);   // the same with no shadow (for the sky loss)
  var mist = vec3f(0.0);
  var Tm = 1.0;
  var ratio = 0.0;
  var tPrev = 0.0;
  for (var i = 0; i < SHAFT_MAX; i++) {
    if (i >= n) { break; }
    let u = (f32(i) + jit) / f32(n);
    let t = tEnd * (u * u);
    let dt = max(t - tPrev, 0.0) + ((tEnd / f32(n)) * 0.02);
    tPrev = t;
    let p = ro + (rd * t);
    let w = shaftNear(t);
    var vis = cloudShadow(p);
    if ((vis > 0.001) && (lit > 0.0)) { vis *= shaftShadow(p, t * fwd); }
    vis *= lit;
    // the froxel at this point: unshadowed sun in-scatter and the haze
    // transmittance from the eye
    let fz = clamp(vol_distSlice(t) / gN.x, 0.5 / gN.x, 1.0 - (0.5 / gN.x));
    let sIn = textureSampleLevel(tSunS, sClamp, vec3f(uv, fz), 0.0);
    let Tf = textureSampleLevel(tVolS, sClamp, vec3f(uv, fz), 0.0).a;
    let e = sIn.rgb * ((1.0 / VOL_K) * Tf * dt * w);
    air += e * (vis * Tm);
    unsh += e * Tm;
    ratio += sIn.a * w;
    // the mist layer
    let hRef = mix(hCam, hEnd, t / max(tEnd, 1.0));
    let sig = SH.p0.z * exp(-max(p.y - hRef, 0.0) / max(SH.p0.w, 1.0)) * w;
    let Ts = exp(-sig * dt);
    mist += ((sunR * (vis * ph)) + amb) * (Tm * Tf * (1.0 - Ts));
    Tm *= Ts;
  }
  ratio = ratio / f32(n);
  var o = mist + air;
  if (sky) { o = mist - ((unsh - air) * ratio); }
  textureStore(outShaft, vec2i(id.xy), vec4f(o, Tm));
}

@compute @workgroup_size(8, 8)
fn csShaftRadial(@builtin(global_invocation_id) id: vec3u) {
  let sz = textureDimensions(outShaft);
  if ((id.x >= sz.x) || (id.y >= sz.y)) { return; }
  let full = vec2i(textureDimensions(tDepthS));
  let uv = (vec2f(id.xy) + 0.5) / vec2f(sz);
  // the sun on screen
  let sc = G.viewProj * vec4f(G.camPos.xyz + (G.sunDir.xyz * 1.0e5), 1.0);
  var o = vec3f(0.0);
  if ((sc.w > 0.0) && (G.sunDir.y > -0.05)) {
    let su = vec2f((sc.x / sc.w) * 0.5 + 0.5, 0.5 - ((sc.y / sc.w) * 0.5));
    let jit = cm_ign(vec2f(id.xy) + vec2f(f32(u32(SH.p1.y) % 64u) * 5.588238, 0.0));
    let stp = (su - uv) * (0.85 / f32(SHAFT_RADIAL));
    var q = uv + (stp * jit);
    var acc = 0.0;
    var wsum = 0.0;
    var decay = 1.0;
    for (var i = 0; i < SHAFT_RADIAL; i++) {
      let inside = all(q >= vec2f(0.0)) && all(q <= vec2f(1.0));
      var m = 0.0;
      if (inside) {
        let src = clamp(vec2i(q * vec2f(full)), vec2i(0), full - vec2i(1));
        let open = select(0.0, 1.0, textureLoad(tDepthS, src, 0) <= 0.0);
        // the bright sky round the sun only (about 6 deg): an open sky far
        // from the sun gives no streak, an occluder near it gives one
        let cq = dot(viewRay(q), G.sunDir.xyz);
        let near = pow(max(cq, 0.0), 900.0);
        m = open * near * textureSampleLevel(tCloudAccS, sClamp, q, 0.0).a;
      }
      acc += m * decay;
      wsum += decay;
      decay *= 0.93;
      q += stp;
    }
    let rd = viewRay(uv);
    let c = dot(rd, G.sunDir.xyz);
    // a forward lobe: the streaks fade away from the sun
    let glow = sk_hg(c, 0.75) * 0.02;
    o = G.sunColor.rgb * ((acc / max(wsum, 1e-4)) * glow * SH.p2.w * sk_ss(-0.05, 0.05, G.sunDir.y));
  }
  textureStore(outShaft, vec2i(id.xy), vec4f(o, 1.0));
}

@compute @workgroup_size(8, 8)
fn csShaftResolve(@builtin(global_invocation_id) id: vec3u) {
  let sz = vec2i(textureDimensions(outShaft));
  let q = vec2i(id.xy);
  if ((q.x >= sz.x) || (q.y >= sz.y)) { return; }
  let cur = textureLoad(tShaftRaw, q, 0);
  var lo = cur;
  var hi = cur;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let v = textureLoad(tShaftRaw, clamp(q + vec2i(x, y), vec2i(0), sz - vec2i(1)), 0);
      lo = min(lo, v);
      hi = max(hi, v);
    }
  }
  // where this texel was last frame
  let full = vec2i(textureDimensions(tDepthS));
  let k = max(i32(round(f32(full.x) / f32(sz.x))), 1);
  let src = shaftSrc(q, full, k);
  let uv = (vec2f(src) + 0.5) / vec2f(full);
  let dz = textureLoad(tDepthS, src, 0);
  var wp = G.camPos.xyz + (viewRay(uv) * 1.0e5);
  if (dz > 0.0) { wp = worldFromDepth(uv, dz); }
  let pc = G.prevViewProj * vec4f(wp, 1.0);
  var o = cur;
  if ((pc.w > 0.0) && (SH.p3.x > 0.0)) {
    let puv = vec2f((pc.x / pc.w) * 0.5 + 0.5, 0.5 - ((pc.y / pc.w) * 0.5));
    if (all(puv > vec2f(0.0)) && all(puv < vec2f(1.0))) {
      let h = clamp(textureSampleLevel(tShaftHist, sClamp, puv, 0.0), lo, hi);
      o = mix(cur, h, SH.p3.x);
    }
  }
  textureStore(outShaft, q, o);
}
