// ============================================================================
//  PLANET COLLISION  ·  shaders/common.wgsl — the prelude of the render shaders
// ----------------------------------------------------------------------------
//  render.js puts this text in front of fluid.wgsl, smooth.wgsl, shade.wgsl
//  and debris.wgsl before it compiles them (WGSL has no include). The
//  tests and the naga check do the same concatenation.
//
//  BIND GROUP 0 (every render pass and the smooth compute)
//    0 U          the frame uniform (render.js "writeFrame", 576 bytes)
//    1 centres    vec4f per body: the mean particle position, the count
//                 (centres.wgsl writes it each frame)
//    2 maps       texture_2d_array: equirectangular surface maps
//                 (render.js "setMaps"; 1 x 1 grey until they load)
//    3 linSamp    a linear sampler (repeat on u, clamp on v)
//  VOLUME (U.vol0, U.vol1; render.js "_volume"): a cube of G^3 cells round
//  the framed bodies. vol.wgsl adds a smooth kernel (1 - r^2/Rk^2)^3 of
//  each particle (Rk = U.vol1.z spacing0) to it; march.wgsl marches the
//  rays to the iso level U.vol1.y. Where kernels overlap the field joins:
//  two bodies, a neck and a splash merge as one liquid surface. A lone
//  particle (peak 1) stays under the iso level 1.1: debris.wgsl draws it.
//  BIND GROUP 1 (the particle passes): the solver buffers of engine.js,
//  read only, and orig, the render buffer of start positions
//    0 pos   x y z h            1 vel   vx vy vz m
//    2 aux   T hNext nOther xv  3 tag   material | body << 4
//    4 orig  start position over the body radius (body frame), body R
//    5 th    rho P c Balsara (the summed density is the debris test)
//
//  PARTICLE CLASSES (fn klass). One particle is in one class:
//    vapour  aux.xv > U.vap.z (the Tillotson blend weight, not a phase)
//    debris  rho < rho0 / q^3, q = U.surf.w (1.6: rho < 0.24 rho0). This is
//            the test h > q h0 with h = eta_H (m / rho)^(1/3) and
//            h0 = eta_H (m / rho0)^(1/3), but on the summed density, so the
//            clamp of h at h_max does not change it. A particle with few
//            neighbours has a low summed density: a free fragment. The
//            surface layer of a settled body stays over 0.8 rho0 (moon-earth,
//            49k). A test on h itself took the whole surface layer of Earth
//            for debris: its h sits at the h_max clamp.
//    fluid   all other particles (the bodies, the melt, the big clumps)
//
//  Precedence: every mix of * with ^, or of && with ||, has parentheses
//  (Chrome's Tint rejects WGSL that naga accepts).
//
//  grep -n targets: "struct U", "fn klass", "fn spacing0", "fn blackbody",
//  "fn glow", "fn skinT", "fn crustShare", "fn lavaSkin", "fn warped", "fn drift", "fn planetAlbedo", "fn matAlbedo", "fn modeColor", "fn rayAt",
//  "fn depthOf", "fn removed", "fn toGrid", "fn inVolume", "fn kernelCells"
// ============================================================================

struct U {
  vp: mat4x4f,
  eye: vec4f,       // xyz, w wall time (s)
  right: vec4f,
  up: vec4f,
  fwd: vec4f,       // xyz, w focal length (px)
  vpSize: vec4f,    // W H 1/W 1/H
  sun: vec4f,       // direction to the sun, intensity
  mode: vec4f,      // x colour mode, y cutaway 0/1, z streak time (code), w droplets per debris particle
  cut: vec4f,       // plane normal, d: dot(n, x) > d is cut away
  surf: vec4f,      // x sphere radius / spacing0, y depth band (world), z filter px per world px, w debris h / h0
  vap: vec4f,       // x extinction per world unit, y xv where vapour starts, z xv of the class, w vapour glow
  view: vec4f,      // x near, y speed of the colour scale (code), z glow gain, w ambient
  mats: array<vec4f, 4>,    // rho0 (code), Tmelt (K), eta_H, specular
  bodies: array<vec4f, 4>,  // style, drawn radius, atmosphere 0..1, shadow 0..1
  atm: array<vec4f, 4>,     // atmosphere colour, shell thickness (share of R)
  flash: array<vec4f, 4>,   // position, intensity
  flashR: vec4f,            // flash radius (world), per flash
  flashT: vec4f,            // flash colour temperature (K), per flash
  extra: vec4f,             // x h_max of the solver (code), y view depth of the target, z sim hours since contact (< 0 before)
  vol0: vec4f,              // the density volume: origin xyz (world, cell 0), w cell size (world; 0 = no volume)
  vol1: vec4f,              // x cells per side G, y iso level, z kernel radius over spacing0, w -
};
@group(0) @binding(0) var<uniform> U0: U;
@group(0) @binding(1) var<storage, read> centres: array<vec4f>;
@group(0) @binding(2) var maps: texture_2d_array<f32>;
@group(0) @binding(3) var linSamp: sampler;

@group(1) @binding(0) var<storage, read> pPos: array<vec4f>;
@group(1) @binding(1) var<storage, read> pVel: array<vec4f>;
@group(1) @binding(2) var<storage, read> pAux: array<vec4f>;
@group(1) @binding(3) var<storage, read> pTag: array<u32>;
@group(1) @binding(4) var<storage, read> pOrig: array<vec4f>;
@group(1) @binding(5) var<storage, read> pTh: array<vec4f>;

const K_FLUID: u32 = 0u;
const K_DEBRIS: u32 = 1u;
const K_VAPOUR: u32 = 2u;

fn matOf(i: u32) -> u32 { return pTag[i] & 15u; }
fn bodyOf(i: u32) -> u32 { return (pTag[i] >> 4u) & 15u; }
// the particle spacing at the reference density: (m / rho0)^(1/3)
fn spacing0(i: u32) -> f32 {
  let m = pVel[i].w;
  return pow(m / U0.mats[matOf(i) & 3u].x, 1.0 / 3.0);
}
fn klass(i: u32) -> u32 {
  if (pAux[i].w > U0.vap.z) { return K_VAPOUR; }
  let q = U0.surf.w;
  if (pTh[i].x * q * q * q < U0.mats[matOf(i) & 3u].x) { return K_DEBRIS; }
  return K_FLUID;
}
// ── the density volume (vol.wgsl fills it, march.wgsl draws its surface) ───
fn volOn() -> bool { return U0.vol0.w > 0.0; }
// world -> grid coordinates (cell centres at integers)
fn toGrid(p: vec3f) -> vec3f { return (p - U0.vol0.xyz) / U0.vol0.w; }
// the kernel radius of particle i in cells
fn kernelCells(i: u32) -> f32 { return U0.vol1.z * spacing0(i) / max(U0.vol0.w, 1e-9); }
// p is in the volume with margin cells to spare on each side
fn inVolume(p: vec3f, margin: f32) -> bool {
  let g = toGrid(p);
  let top = U0.vol1.x - 1.0 - margin;
  return all(g >= vec3f(margin)) && all(g <= vec3f(top));
}
fn removed(x: vec3f) -> bool {
  return U0.mode.y > 0.5 && dot(U0.cut.xyz, x) > U0.cut.w;
}

// ── camera ──────────────────────────────────────────────────────────────────
// the ray through pixel fc (frame coordinates), scaled so dot(D, fwd) = 1
fn rayAt(fc: vec2f) -> vec3f {
  let px = vec2f(fc.x - 0.5 * U0.vpSize.x, 0.5 * U0.vpSize.y - fc.y);
  return U0.fwd.xyz + (px.x * U0.right.xyz + px.y * U0.up.xyz) / U0.fwd.w;
}
// reversed-Z depth of a view depth z (infinite far plane)
fn depthOfZ(z: f32) -> f32 { return clamp(U0.view.x / max(z, 1e-6), 0.0, 1.0); }
fn depthOf(p: vec3f) -> f32 { return depthOfZ(dot(p - U0.eye.xyz, U0.fwd.xyz)); }

// ── noise ───────────────────────────────────────────────────────────────────
fn hash3(p: vec3f) -> f32 {
  let q = fract(p * 0.3183099 + vec3f(0.1, 0.17, 0.13)) * 17.0;
  return fract(q.x * q.y * q.z * (q.x + q.y + q.z));
}
fn hashU(n: u32) -> f32 {
  var x = n * 747796405u + 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  x = (x >> 22u) ^ x;
  return f32(x) / 4294967295.0;
}
fn vnoise(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = mix(mix(hash3(i), hash3(i + vec3f(1.0, 0.0, 0.0)), u.x), mix(hash3(i + vec3f(0.0, 1.0, 0.0)), hash3(i + vec3f(1.0, 1.0, 0.0)), u.x), u.y);
  let b = mix(mix(hash3(i + vec3f(0.0, 0.0, 1.0)), hash3(i + vec3f(1.0, 0.0, 1.0)), u.x), mix(hash3(i + vec3f(0.0, 1.0, 1.0)), hash3(i + vec3f(1.0, 1.0, 1.0)), u.x), u.y);
  return mix(a, b, u.z);
}
fn fbm(p: vec3f) -> f32 {
  var s = 0.0;
  var a = 0.5;
  var q = p;
  for (var i = 0; i < 4; i++) {
    s = s + a * vnoise(q);
    q = q * 2.03 + vec3f(1.7, 9.2, 3.1);
    a = a * 0.5;
  }
  return s;
}

// ── light ───────────────────────────────────────────────────────────────────
// The colour of a black body at T (K), linear RGB, the brightest channel 1.
// A fit of the Planck locus in sRGB (T. Helland 2012), then decoded.
fn blackbody(T: f32) -> vec3f {
  let t = clamp(T, 800.0, 40000.0) / 100.0;
  var r = 1.0;
  var g = 0.0;
  var b = 1.0;
  if (t <= 66.0) {
    g = clamp(0.39008157 * log(t) - 0.63184144, 0.0, 1.0);
    if (t <= 19.0) { b = 0.0; } else { b = clamp(0.54320678 * log(t - 10.0) - 1.19625408, 0.0, 1.0); }
  } else {
    r = clamp(1.29293618 * pow(t - 60.0, -0.1332047592), 0.0, 1.0);
    g = clamp(1.12989086 * pow(t - 60.0, -0.0755148492), 0.0, 1.0);
  }
  return pow(vec3f(r, g, b), vec3f(2.2));
}
// The radiance of incandescent matter, in scene units. Three steps:
//  1 the skin temperature (fn skinT): SPH gives the mean T of a parcel
//    about 100 km wide, and wall heating puts tens of thousands of K on
//    the first contact surface (CONTRACT.md). A free melt surface radiates
//    sigma T^4 (2 MW/m^2 at 2500 K) and its skin cools in minutes, so the
//    visible skin is far cooler than the parcel. The cap starts at
//    4000 K and falls to 1700 K with the sim hours since contact
//    (U.extra.z). The solver has no radiative cooling: this is drawn.
//  2 T^4 (Stefan-Boltzmann) from the Draper point (about 750 K, the first
//    visible red), times U.view.z.
//  3 a soft limit at GLOW_MAX: the tone map keeps the colour of the
//    black body (orange stays orange) and does not clip to white.
// The temperature mode (fn modeColor) shows the values as they are.
const GLOW_MAX: f32 = 3.0;
// sim hours since the first contact (negative before it)
fn coolH() -> f32 { return U0.extra.z; }
// the highest skin temperature at this time; rate: the time constant (h).
// Small free pieces cool faster than the bulk (a smaller rate).
fn skinCap(rate: f32) -> f32 { return 1700.0 + 2300.0 * exp(-max(coolH(), 0.0) / rate); }
fn skinT(T: f32, rate: f32) -> f32 { return min(T, skinCap(rate)); }
fn glow(T: f32) -> vec3f {
  let on = smoothstep(750.0, 1100.0, T);
  let k = U0.view.z * max(pow(T / 1500.0, 4.0) - 0.0625, 0.0);
  return blackbody(T) * on * (GLOW_MAX * (1.0 - exp(-k / GLOW_MAX)));
}
// The share of a melt surface under a cooled crust: none before contact,
// it grows with the sim hours since contact (0.22 at 0.1 h, 0.71 at 1 h,
// 0.85 from 2.5 h).
fn crustShare() -> f32 {
  let h = coolH();
  if (h < 0.0) { return 0.0; }
  return clamp(1.1 * (1.0 - exp(-(h + 0.15) / 1.1)), 0.0, 0.85);
}
// ── molten rock (fn lavaSkin) ───────────────────────────────────────────────
// fbm of p bent by a second fbm (domain warp): soft, folded, never cells
fn warped(p: vec3f) -> f32 {
  let w = vec3f(fbm(p * 0.7 + vec3f(3.1, 7.4, 1.9)), fbm(p * 0.7 + vec3f(8.3, 2.8, 5.6)), fbm(p * 0.7 + vec3f(1.2, 6.1, 9.7))) - vec3f(0.5);
  return fbm(p + 2.2 * w);
}
// A slow swirl: the direction the melt drifts at p (a smooth field)
fn drift(p: vec3f) -> vec3f {
  return vec3f(fbm(p * 0.5 + vec3f(11.0, 0.0, 0.0)), fbm(p * 0.5 + vec3f(0.0, 13.0, 0.0)), fbm(p * 0.5 + vec3f(0.0, 0.0, 17.0))) - vec3f(0.5);
}
// The skin temperature of a melt surface at point o (world position over
// the target radius, from the target centre; SPH mixes the start
// positions at the particle scale, so a pattern on them is noise).
//  flow   two copies of the warped fbm, each carried along the drift by
//         a phase that runs 0..1 (wall time), half a period apart and
//         faded across, so the pattern flows and never stretches out
//  crust  where the flowing pattern is under the cover: the cover is the
//         time share (fn crustShare) less where the melt is hot, so hot
//         ground stays open and cool ground skins over
//  seams  the ridge lines of a second warped field crack the crust; they
//         are wider and hotter where the melt is hot, and the crust near
//         an edge (thin crust) is hotter than a thick plate
//  T      open melt at the skin temperature (fn skinT, which cools with
//         the hours since contact); thick crust at 0.42 of it, not under
//         700 K (a dull red at most). fn glow turns T into the black body
//         colour (dark red, orange, yellow-white) and its T^4 radiance:
//         hot seams pass the bloom threshold, the crust does not.
// x: skin T, y: crust 0..1.
fn lavaSkin(T: f32, o: vec3f, scale: f32) -> vec2f {
  let Ts = skinT(T, 0.6);
  let share = crustShare();
  if (share <= 0.0 || T < 1100.0) { return vec2f(Ts, 0.0); }
  let p = o * scale;
  let heat = clamp((Ts - 1000.0) / 1800.0, 0.0, 1.0);
  // flow advection: two phases of the drift, faded across
  let ph = fract(U0.eye.w * 0.05);
  let ph2 = fract(ph + 0.5);
  let v = 1.6 * drift(p);
  let n0 = warped(p - v * ph);
  let n1 = warped(p - v * ph2 + vec3f(4.7, 1.3, 2.9));
  let n = mix(n0, n1, abs(2.0 * ph - 1.0));
  // the crust cover: the flowing pattern under it is crust
  let cover = clamp(share * (1.3 - 0.75 * heat), 0.0, 0.92);
  let edge = cover - (n - 0.18) / 0.64;
  let crust = smoothstep(0.0, 0.08, edge);
  // seams: ridges of a second warped field, wider where hot
  let r = 1.0 - abs(2.0 * warped(p * 1.9 + vec3f(7.3, 3.1, 5.5) - 0.5 * v * ph) - 1.0);
  let width = 0.05 + 0.10 * heat;
  let seam = smoothstep(1.0 - width, 1.0 - 0.3 * width, r);
  let c = crust * (1.0 - seam);
  // thin crust (near the edge of a plate) is hotter than a thick plate
  let thick = smoothstep(0.0, 0.25, edge);
  let Tcrust = max(mix(0.75, 0.42, thick) * Ts, 700.0);
  let Topen = Ts * (0.93 + 0.07 * n);
  return vec2f(mix(Topen, Tcrust, c), c);
}

// ── surfaces ────────────────────────────────────────────────────────────────
// A body's surface colour at the unit direction n (body frame, z = the spin
// axis) and a gloss mask in w (oceans). Styles: render.js BODY_LOOK.
// Map layers: 0 Earth, 1 Earth clouds, 2 Moon, 3 Mars, 4 Mercury, 5 Venus
// clouds (Solar System Scope, CC BY 4.0; CREDITS.txt).
fn mapAt(layer: i32, n: vec3f, lod: f32) -> vec3f {
  let uv = vec2f(0.5 + atan2(n.y, n.x) / 6.2831853, 0.5 - asin(clamp(n.z, -1.0, 1.0)) / 3.14159265);
  return pow(textureSampleLevel(maps, linSamp, uv, layer, lod).rgb, vec3f(2.2));
}
fn planetAlbedo(style: i32, n: vec3f, lod: f32) -> vec4f {
  let w = fbm(n * 3.0) - 0.5;
  let fine = fbm(n * 16.0 + vec3f(w * 2.0));
  let lat = asin(clamp(n.z, -1.0, 1.0));
  if (style == 0) {
    let c = mapAt(0, n, lod);
    let cloud = mapAt(1, n, lod).r;
    // the ocean: blue, dark, glossy
    let sea = smoothstep(0.02, 0.0, c.g - c.b) * smoothstep(0.12, 0.02, c.r);
    return vec4f(mix(c * 0.9, vec3f(0.92), cloud * 0.9), sea * (1.0 - cloud));
  }
  if (style == 1) {
    // the proto-Earth: no map (it is a model body); a dark basalt crust
    // broken by cooling cracks
    let crack = smoothstep(0.47, 0.5, abs(vnoise(n * 22.0) - 0.5) + 0.48 * (1.0 - fine));
    return vec4f(mix(vec3f(0.11, 0.10, 0.10), vec3f(0.22, 0.19, 0.17), fine) * (1.0 - 0.5 * crack), 0.0);
  }
  if (style == 2) {
    // Theia (a model body): grey-brown highlands, darker plains
    let pl = smoothstep(0.5, 0.58, fbm(n * 2.4 + vec3f(4.0)));
    return vec4f(mix(vec3f(0.34, 0.31, 0.28), vec3f(0.17, 0.16, 0.16), pl) * (0.85 + 0.3 * fine), 0.0);
  }
  if (style == 3) { return vec4f(mapAt(2, n, lod), 0.0); }
  if (style == 4) { return vec4f(mapAt(3, n, lod), 0.0); }
  if (style == 5) { return vec4f(mapAt(5, n, lod), 0.0); }
  if (style == 6) { return vec4f(mapAt(4, n, lod), 0.0); }
  if (style == 8) {
    // Pluto: tan nitrogen-ice plains, dark red tholin belt, a bright heart
    var c = mix(vec3f(0.62, 0.50, 0.38), vec3f(0.80, 0.70, 0.58), fine);
    c = mix(c, vec3f(0.30, 0.14, 0.08), smoothstep(0.30, 0.0, abs(lat + 0.05)) * smoothstep(0.45, 0.6, fbm(n * 3.0)));
    let hrt = length((n - normalize(vec3f(0.6, -0.75, 0.25))) * vec3f(1.0, 1.4, 1.0));
    return vec4f(mix(c, vec3f(0.95, 0.92, 0.86), smoothstep(0.45, 0.35, hrt + 0.08 * w)), 0.0);
  }
  if (style == 9) {
    // Charon: grey water ice with a dark red pole cap (Mordor Macula)
    let c = mix(vec3f(0.42, 0.42, 0.43), vec3f(0.58, 0.57, 0.56), fine);
    return vec4f(mix(c, vec3f(0.28, 0.12, 0.08), smoothstep(1.05, 1.3, lat + 0.1 * w)), 0.0);
  }
  if (style == 10) {
    // Vesta: grey-brown basalt with bright and dark streaks
    return vec4f(mix(vec3f(0.30, 0.28, 0.25), vec3f(0.48, 0.45, 0.40), fine) * (0.8 + 0.4 * vnoise(n * 6.0)), 0.0);
  }
  // Ceres (style 7) and the default: dark carbonaceous grey, bright salt spots
  let c = mix(vec3f(0.09, 0.09, 0.09), vec3f(0.16, 0.16, 0.15), fine);
  let salt = smoothstep(0.985, 0.995, vnoise(n * 18.0));
  return vec4f(mix(c, vec3f(0.85), salt), 0.0);
}
// The cold albedo of a particle mix. o: the start position over the body
// radius (body frame), fIron and fIce shares, style: the body look.
fn matAlbedo(o: vec3f, fIron: f32, fIce: f32, style: i32, lod: f32) -> vec4f {
  let lo = max(length(o), 1e-4);
  let crust = smoothstep(0.86, 0.95, lo);
  let s = planetAlbedo(style, o / lo, lod);
  let deep = 1.0 - 0.45 * smoothstep(0.9, 0.3, lo);
  let rock = mix(vec3f(0.16, 0.13, 0.11), vec3f(0.30, 0.25, 0.20), vnoise(o * 14.0)) * deep;
  let ice = mix(vec3f(0.62, 0.70, 0.76), vec3f(0.82, 0.88, 0.92), vnoise(o * 10.0));
  let iron = vec3f(0.46, 0.40, 0.35);
  let fRock = max(1.0 - fIron - fIce, 0.0);
  let body = mix(fRock * rock + fIce * ice, s.rgb * (fRock + fIce), crust);
  return vec4f(body + fIron * iron, mix(0.0, s.w, crust) + fIron * 0.6);
}
// The melt point of a mix (K)
fn tMelt(fIron: f32, fIce: f32) -> f32 {
  let fRock = max(1.0 - fIron - fIce, 0.0);
  return fIron * U0.mats[0].y + fIce * U0.mats[3].y + fRock * 0.5 * (U0.mats[1].y + U0.mats[2].y);
}
// colour maps for the analysis modes (polynomial fits of matplotlib's
// inferno and viridis, CC0; CREDITS.txt)
fn inferno(t0: f32) -> vec3f {
  let t = clamp(t0, 0.0, 1.0);
  let c0 = vec3f(0.0002189, 0.0016510, -0.0194809); let c1 = vec3f(0.1065134, 0.5639564, 3.9327123);
  let c2 = vec3f(11.6024930, -3.9728537, -15.9423941); let c3 = vec3f(-41.7039961, 17.4363399, 44.3541452);
  let c4 = vec3f(77.1629356, -33.4023590, -81.8073092); let c5 = vec3f(-71.3194282, 32.6260660, 73.2095198);
  let c6 = vec3f(25.1311262, -12.2426605, -23.0703250);
  return max(c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * (c5 + t * c6))))), vec3f(0.0));
}
fn viridis(t0: f32) -> vec3f {
  let t = clamp(t0, 0.0, 1.0);
  let c0 = vec3f(0.2777273, 0.0054073, 0.3340998); let c1 = vec3f(0.1050930, 1.4046135, 1.3845901);
  let c2 = vec3f(-0.3308618, 0.2148476, 0.0950952); let c3 = vec3f(-4.6342305, -5.7991008, -19.3324409);
  let c4 = vec3f(6.2282699, 14.1799333, 56.6905526); let c5 = vec3f(4.7763850, -13.7451453, -65.3530326);
  let c6 = vec3f(-5.4354559, 4.6458521, 26.3124352);
  return max(c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * (c5 + t * c6))))), vec3f(0.0));
}
// The flat colour of an analysis mode (1 temperature, 2 origin body,
// 3 speed, 4 material), linear; the caller lights it.
fn modeColor(mode: i32, T: f32, b1: f32, mixw: f32, speed: f32, fIron: f32, fIce: f32) -> vec3f {
  if (mode == 1) { return pow(inferno((log2(max(T, 300.0)) - 8.23) / 5.0), vec3f(2.2)); }
  if (mode == 2) {
    let c = mix(vec3f(0.10, 0.36, 1.0), vec3f(1.0, 0.42, 0.06), b1);
    return mix(c, vec3f(0.95, 0.95, 0.95), 0.6 * mixw);
  }
  if (mode == 3) { return pow(viridis(speed / max(U0.view.y, 1e-6)), vec3f(2.2)); }
  let fRock = max(1.0 - fIron - fIce, 0.0);
  return fIron * vec3f(0.80, 0.30, 0.16) + fRock * vec3f(0.72, 0.62, 0.45) + fIce * vec3f(0.55, 0.82, 1.0);
}
