// ============================================================================
//  DLA TERRAIN  ·  shaders/celestial.wgsl — the real starfield, the Milky
//  Way, the moons and the gas giant (package CELESTIAL). render/celestial.js
//  compiles it after the SKY library (shaders/sky.wgsl up to "@@SKY-ENTRY"),
//  so it has S (struct SkyU), the transmittance LUT and the sky-view LUT.
// ----------------------------------------------------------------------------
//  BIND GROUPS  0 CORE's globals, 1 SKY's small group (render/sky.js
//    L.shaft: uniform, LUTs, sampler), 2 this layer (CelU, the stars, maps).
//  PASS 1 (vsCelBg, fsCelBg) a full-screen triangle at depth 0 after fsSky,
//    premultiplied blend (one, one-minus-src-alpha). Out: the Milky Way and
//    the bodies through the air. Alpha = the cover of the bodies, so the sun
//    disc and the stars of fsSky behind a body go; the in-scatter of the
//    air in front of the body comes back from the sky-view LUT.
//  PASS 2 (vsStar, fsStar) one quad per catalogue star (Yale Bright Star
//    Catalogue, 9096 stars), additive. Each star is a PSF of Gaussian
//    width sigma >= C.star.y pixels: the smooth compact kernel
//    w = (1 - r^2 / R^2)^6, R = sigma sqrt(12), divided by its integral
//    pi R^2 / 7. Its sum over the pixels is the star flux at every
//    sub-pixel position within 0.03 % (no crawl, no flicker;
//    tests/celestial.test.mjs psfSum is the JS twin).
//  BODIES  spheres in Mm (1000 km) from the eye. Lit by G.sunDir: the lit
//    side faces the sun (the phase follows from the geometry). Rocky
//    bodies: Lommel-Seeliger (a flat full Moon); the giant: Lambert. Dark
//    side: earthshine or giantshine (C.b[i].x.x). Shadows: the other bodies
//    on the giant (transits), the rings on the giant, the giant on the
//    rings, the giant on its moons (C.b[i].s.x from the CPU).
//  LOOPS  constant bounds: CEL_MAX bodies, CEL_MAX shadow casters.
//
//  grep -n targets: "struct CelU", "fn cel_eq", "fn cel_milky",
//    "fn cel_mapColor", "fn cel_sphere", "fn cel_ring", "fn cel_body",
//    "fn fsCelBg", "fn vsStar", "fn fsStar", "const CEL_MAX"
// ============================================================================

const CEL_MAX: i32 = 5;
const CEL_PSF_RK: f32 = 3.4641016;  // R / sigma = sqrt(12) of the kernel (1 - r^2 / R^2)^6
const CEL_PSF_INT: f32 = 0.44879895; // integral / R^2 = pi / 7

struct CelBody {
  c: vec4f,   // xyz unit direction (world), w distance Mm
  p: vec4f,   // xyz pole (world), w radius Mm
  m: vec4f,   // xyz prime meridian axis (world), w map: -1 none, 0..3 moon layer, 9 the giant
  t: vec4f,   // rgb tint x albedo / mean of the map, w saturation
  x: vec4f,   // x dark side shine, y ring inner R, z ring outer R, w ring opacity (0 none)
  s: vec4f,   // x sunlight reach 0..1 (eclipse by the parent), y law 0 rocky 1 giant, z lod bias, w spare
}
struct CelU {
  eq0: vec4f, eq1: vec4f, eq2: vec4f,  // rows of the equatorial -> world rotation
  star: vec4f,   // x flux of a magnitude 0 star (HDR irradiance) x the slider x night, y sigma px floor, z time s, w star count
  mw: vec4f,     // x Milky Way radiance of the map 1.0, y light pollution 0..1, z night 0..1, w body radiance K (HDR per albedo)
  view: vec4f,   // x body count, y the giant index (-1 none), z map texel width moons, w giant
  b: array<CelBody, 5>,
}

@group(2) @binding(0) var<uniform> C: CelU;
@group(2) @binding(1) var<storage, read> stars: array<vec4f>;
@group(2) @binding(2) var tMilky: texture_2d<f32>;
@group(2) @binding(3) var tMoons: texture_2d_array<f32>;
@group(2) @binding(4) var tGiant: texture_2d<f32>;
@group(2) @binding(5) var tRing: texture_2d<f32>;
@group(2) @binding(6) var sCel: sampler;

const CEL_TAU: f32 = 6.2831853;

// world -> equatorial (the transpose of the rows)
fn cel_eq(d: vec3f) -> vec3f {
  return (C.eq0.xyz * d.x) + (C.eq1.xyz * d.y) + (C.eq2.xyz * d.z);
}
fn cel_world(e: vec3f) -> vec3f {
  return vec3f(dot(C.eq0.xyz, e), dot(C.eq1.xyz, e), dot(C.eq2.xyz, e));
}
fn cel_pxAng() -> f32 { return 2.0 / (G.proj[1][1] * G.screen.y); }

// The Milky Way map (NASA SVS Deep Star Maps 2020, milkyway_2020: the sky
// with the Hipparcos and Tycho stars taken out): u = 0.5 - RA / 2 pi,
// v = 0.5 - Dec / pi. The map is sRGB-free: encoded^2.2 is linear.
fn cel_milky(d: vec3f, pxAng: f32) -> vec3f {
  let e = cel_eq(d);
  let ra = atan2(e.y, e.x);
  let dec = asin(clamp(e.z, -1.0, 1.0));
  let uv = vec2f(fract(0.5 - (ra / CEL_TAU)), 0.5 - (dec / 3.14159265));
  let w = f32(textureDimensions(tMilky).x);
  let lod = max(log2(max((w * pxAng) / CEL_TAU, 1e-4)), 0.0);
  let enc = textureSampleLevel(tMilky, sCel, uv, lod).rgb;
  return pow(enc, vec3f(2.2)) * C.mw.x;
}

// The colour of a body map at unit normal n (world), body i.
fn cel_mapColor(i: i32, n: vec3f, lod: f32) -> vec3f {
  let B = C.b[i];
  let pole = B.p.xyz;
  let pm = B.m.xyz;
  let q = cross(pole, pm);
  let lat = asin(clamp(dot(n, pole), -1.0, 1.0));
  let lon = atan2(dot(n, q), dot(n, pm));
  let uv = vec2f(fract(0.5 + (lon / CEL_TAU)), 0.5 - (lat / 3.14159265));
  var c = vec3f(0.5);
  if (B.m.w > 8.5) {
    c = textureSampleLevel(tGiant, sCel, uv, lod).rgb;
  } else if (B.m.w > -0.5) {
    c = textureSampleLevel(tMoons, sCel, uv, i32(B.m.w + 0.5), lod).rgb;
  }
  let y = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  return mix(vec3f(y), c, B.t.w) * B.t.rgb;
}

// Ray d from the eye against sphere i: x = t of the near hit (Mm), y the
// angular distance from the centre over the angular radius (1 at the rim),
// z the drawn angular radius (at least 1.2 px), w the cover 0..1.
fn cel_sphere(i: i32, d: vec3f, pxAng: f32) -> vec4f {
  let B = C.b[i];
  let rho = asin(clamp(B.p.w / B.c.w, 0.0, 1.0));
  let re = max(rho, 1.2 * pxAng);
  let ang = atan2(length(cross(d, B.c.xyz)), dot(d, B.c.xyz));
  let cov = clamp(((re - ang) / pxAng) + 0.5, 0.0, 1.0);
  let Re = B.c.w * sin(re);
  let s = B.c.w * sin(min(ang, re));
  let t = (B.c.w * cos(min(ang, re))) - sqrt(max((Re * Re) - (s * s), 0.0));
  return vec4f(t, ang / re, re, cov);
}

// Sunlight that reaches world point P (Mm from the eye) past the other
// bodies (soft: the sun is 0.2665 deg in radius) and the rings of the giant.
fn cel_shadowAt(P: vec3f, me: i32) -> f32 {
  let sd = G.sunDir.xyz;
  var lit = 1.0;
  let n = i32(C.view.x);
  for (var j = 0; j < CEL_MAX; j++) {
    if (j >= n) { break; }
    if (j == me) { continue; }
    let B = C.b[j];
    let v = (B.c.xyz * B.c.w) - P;
    let along = dot(v, sd);
    if (along <= 0.0) { continue; }
    let perp = length(v - (sd * along));
    let w = along * 0.00465;
    lit *= sk_ss(B.p.w - w, B.p.w + w, perp);
  }
  // the rings of the giant
  let gi = i32(C.view.y);
  if ((gi >= 0) && (gi != me)) {
    let B = C.b[gi];
    if (B.x.w > 0.0) {
      let ctr = B.c.xyz * B.c.w;
      let nr = B.p.xyz;
      let dn = dot(sd, nr);
      if (abs(dn) > 1e-4) {
        let x = dot(ctr - P, nr) / dn;
        if (x > 0.0) {
          let r = length((P + (sd * x)) - ctr) / B.p.w;
          lit *= 1.0 - cel_ringAlpha(gi, r, abs(dn));
        }
      }
    }
  }
  return lit;
}

fn cel_ringTex(gi: i32, r: f32) -> vec4f {
  let B = C.b[gi];
  let u = (r - B.x.y) / max(B.x.z - B.x.y, 1e-3);
  if ((u < 0.0) || (u > 1.0)) { return vec4f(0.0); }
  return textureSampleLevel(tRing, sCel, vec2f(u, 0.5), 0.0);
}
// The cover of the ring layer for a ray at |cos| mu to its plane: a slant
// path is thicker (optical depth / mu).
fn cel_ringAlpha(gi: i32, r: f32, mu: f32) -> f32 {
  let a = clamp(cel_ringTex(gi, r).a * C.b[gi].x.w, 0.0, 0.995);
  return 1.0 - pow(1.0 - a, 1.0 / max(mu, 0.03));
}

// Body i along d: rgb radiance (premultiplied by the cover) and the cover.
fn cel_body(i: i32, d: vec3f, pxAng: f32) -> vec4f {
  let B = C.b[i];
  let sd = G.sunDir.xyz;
  let hit = cel_sphere(i, d, pxAng);
  var col = vec3f(0.0);
  var a = 0.0;
  var tS = 1e30;
  if (hit.w > 0.0) {
    tS = hit.x;
    let ctr = B.c.xyz * B.c.w;
    let Re = B.c.w * sin(hit.z);
    let P = d * hit.x;
    let n = normalize(P - ctr);
    let mu0 = dot(n, sd);
    let mu = max(dot(n, -d), 0.0);
    // the map LOD: texels across one pixel at the centre of the disc
    let tw = select(C.view.z, C.view.w, B.m.w > 8.5);
    let lod = max(log2(max((tw * pxAng) / (CEL_TAU * sin(hit.z)), 1e-4)) + (0.5 * log2(1.0 / max(mu, 0.2))) + B.s.z, 0.0);
    let alb = cel_mapColor(i, n, lod);
    var f = 0.0;
    if (mu0 > 0.0) {
      // rocky: Lommel-Seeliger (2 mu0 / (mu0 + mu), 1 over a full disc);
      // giant: Lambert with a little limb darkening
      f = select((2.0 * mu0) / (mu0 + max(mu, 0.02)), mu0 * (0.75 + (0.25 * sqrt(mu))), B.s.y > 0.5);
    }
    // the terminator over about a pixel of the disc (a small disc)
    f *= sk_ss(-0.02, 0.04, mu0);
    var light = f * B.s.x;
    if ((i == i32(C.view.y)) && (f > 0.0)) { light *= cel_shadowAt(ctr + (n * Re), i); }
    // a moon in the umbra of its parent turns dark red (light bent through
    // the air of the parent)
    let red = vec3f(1.0, 0.32, 0.12) * (1.0 - B.s.x) * 0.02 * sk_ss(0.0, 0.05, mu0);
    // dark side: earthshine or giantshine, Lambert toward the eye
    let dark = B.x.x * (0.6 + (0.4 * mu));
    // drawn larger than it is (under 1.2 px): keep the energy
    let kr = clamp(B.p.w / B.c.w, 0.0, 1.0) / sin(hit.z);
    let k = kr * kr;
    col = alb * ((vec3f(light) + red + vec3f(dark)) * (C.mw.w * k));
    a = hit.w;
  }
  // the rings (the giant only)
  if ((B.x.w > 0.0) && (i == i32(C.view.y))) {
    let ctr = B.c.xyz * B.c.w;
    let nr = B.p.xyz;
    let dn = dot(d, nr);
    if (abs(dn) > 1e-5) {
      let tR = dot(ctr, nr) / dn;
      if (tR > 0.0) {
        let Q = d * tR;
        let r = length(Q - ctr) / B.p.w;
        let tx = cel_ringTex(i, r);
        if (tx.a > 0.0) {
          let ra = cel_ringAlpha(i, r, abs(dn)) * clamp((r - 1.0) * 40.0, 0.0, 1.0);
          // lit face: the sun on the side of the eye; else light through
          let sn = dot(sd, nr);
          let same = (sn * dn) < 0.0;
          let face = select(0.25 * (1.0 - tx.a), 1.0, same) * clamp(abs(sn) * 8.0, 0.0, 1.0);
          // the giant's shadow on the rings
          let v = ctr - Q;
          let along = dot(v, sd);
          var sh = 1.0;
          if (along > 0.0) { sh = sk_ss(B.p.w * 0.98, B.p.w * 1.02, length(v - (sd * along))); }
          let rc = tx.rgb * (0.55 * face * sh * B.s.x * C.mw.w) * B.t.rgb / max(dot(B.t.rgb, vec3f(0.333)), 1e-3) * 0.5;
          if (tR < tS) {
            // ring in front of the planet
            col = (rc * ra) + (col * (1.0 - ra));
            a = ra + (a * (1.0 - ra));
          } else {
            // ring behind: seen only past the planet's cover
            col = col + ((rc * ra) * (1.0 - a));
            a = a + (ra * (1.0 - a));
          }
        }
      }
    }
  }
  return vec4f(col, a);
}

struct CelVOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f }

@vertex
fn vsCelBg(@builtin(vertex_index) vi: u32) -> CelVOut {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o: CelVOut;
  o.pos = vec4f((p * 2.0) - 1.0, 0.0, 1.0);
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}

@fragment
fn fsCelBg(i: CelVOut) -> @location(0) vec4f {
  let d = viewRay(i.uv);
  if (d.y < -0.06) { return vec4f(0.0); }
  let pxAng = cel_pxAng();
  let r = S.radii.w;
  let T = sk_transmittance(r, max(d.y, 0.0)) * sk_ss(-0.03, 0.01, d.y);
  // the bodies, front to back (render/celestial.js sorts them by distance)
  var col = vec3f(0.0);
  var a = 0.0;
  let n = i32(C.view.x);
  for (var k = 0; k < CEL_MAX; k++) {
    if (k >= n) { break; }
    if (a > 0.999) { break; }
    let b = cel_body(k, d, pxAng);
    col += b.rgb * (1.0 - a);
    a += b.a * (1.0 - a);
  }
  // the air in front of a body: the in-scatter of fsSky (the sky-view LUT
  // and the night glow terms), which the alpha takes out of the target
  var Lin = vec3f(0.0);
  if (a > 0.0) {
    let uv = sk_skyViewUV(r, d, G.sunDir.xyz);
    Lin = textureSampleLevel(tSkyView, sClamp, uv, 0.0).rgb * S.sun.y;
    let mc = dot(d, S.moon.xyz);
    Lin += S.moon.w * vec3f(0.12, 0.22, 0.5) * (0.3 + (0.7 * sk_ss(-0.2, 0.9, S.moon.y))) * (1.0 + (0.75 * mc * mc)) * 0.15;
    Lin += vec3f(0.0006, 0.0008, 0.0011) * (0.4 + (0.6 * exp(-max(d.y, 0.0) * 6.0)));
  }
  let mw = cel_milky(d, pxAng) * (C.mw.z * (1.0 - a));
  // light pollution (off by default): a warm glow low over the horizon
  let lp = C.mw.y * vec3f(0.006, 0.0042, 0.0026) * exp(-max(d.y, 0.0) * 7.0);
  let rgb = (T * (col + mw)) + (Lin * a) + lp;
  return vec4f(rgb, a);
}

// ── stars ─────────────────────────────────────────────────────────────────
// stars[2 i] = equatorial unit vector, relative flux 10^(-0.4 m);
// stars[2 i + 1] = linear colour (luminance 1), a phase seed 0..1.
struct StarVOut {
  @builtin(position) pos: vec4f,
  @location(0) q: vec2f,              // pixel offset from the star centre
  @location(1) @interpolate(flat) rgb: vec3f,  // radiance scale of the PSF
  @location(2) @interpolate(flat) sig: f32,    // the kernel radius R px
}

@vertex
fn vsStar(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> StarVOut {
  var o: StarVOut;
  o.pos = vec4f(2.0, 2.0, 0.0, 1.0);
  o.q = vec2f(0.0);
  o.rgb = vec3f(0.0);
  o.sig = 1.0;
  let a = stars[2u * ii];
  let b = stars[(2u * ii) + 1u];
  let d = cel_world(a.xyz);
  if (d.y < -0.03) { return o; }
  let pxAng = cel_pxAng();
  // hidden behind a body (the alpha of pass 1 does not reach pass 2)
  var occ = 1.0;
  let n = i32(C.view.x);
  for (var k = 0; k < CEL_MAX; k++) {
    if (k >= n) { break; }
    let B = C.b[k];
    let rho = max(asin(clamp(B.p.w / B.c.w, 0.0, 1.0)), 1.2 * pxAng);
    let ang = atan2(length(cross(d, B.c.xyz)), dot(d, B.c.xyz));
    occ *= clamp(((ang - rho) / pxAng) + 0.5, 0.0, 1.0);
  }
  if (occ <= 0.0) { return o; }
  let T = sk_transmittance(S.radii.w, max(d.y, 0.0)) * sk_ss(-0.03, 0.01, d.y);
  // scintillation: slow and small, only near the horizon (thick air)
  let low = 1.0 - sk_ss(0.06, 0.45, d.y);
  let t = C.star.z;
  let tw = 1.0 + ((0.28 * low) * ((0.6 * sin((t * (0.9 + (0.8 * b.w))) + (b.w * 40.0))) + (0.4 * sin((t * (1.7 + (1.1 * fract(b.w * 7.0)))) + (b.w * 91.0)))));
  let E = a.w * C.star.x * occ * tw;
  if (E < 1e-9) { return o; }
  let R = C.star.y * CEL_PSF_RK;
  let clip = G.viewProj * vec4f(d, 0.0);
  if (clip.w <= 1e-6) { return o; }
  let corner = vec2f(f32(vi & 1u), f32((vi >> 1u) & 1u)) * 2.0 - 1.0;
  let hs = R;
  var p = clip;
  p.x += corner.x * hs * (2.0 * G.screen.z) * clip.w;
  p.y += corner.y * hs * (2.0 * G.screen.w) * clip.w;
  p.z = 0.0;
  o.pos = p;
  // y of the pixel offset points down the screen (clip y points up)
  o.q = vec2f(corner.x, -corner.y) * hs;
  o.rgb = b.rgb * T * (E / (CEL_PSF_INT * R * R * pxAng * pxAng));
  o.sig = R;
  return o;
}

@fragment
fn fsStar(i: StarVOut) -> @location(0) vec4f {
  let x = max(1.0 - (dot(i.q, i.q) / (i.sig * i.sig)), 0.0);
  let x2 = x * x;
  let w = x2 * x2 * x2;
  return vec4f(i.rgb * w, 0.0);
}
