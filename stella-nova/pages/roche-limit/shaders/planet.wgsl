// ============================================================================
//  ROCHE LIMIT  ·  shaders/planet.wgsl — sky, planet surface, atmosphere
// ----------------------------------------------------------------------------
//  Three passes on one full-screen triangle (vs_full). Each pixel casts its
//  own ray from the eye (cam.right, cam.up, cam.fwd, focal length in px).
//    fs_sky      stars, a faint galactic band, the sun disc and its glare.
//                Depth 1 (far).
//    fs_surface  the planet (radius 1, world units are planet radii):
//                banded cloud decks by style, a soft terminator, the shadow
//                of the ring (optical depth tau from ring.wgsl, sampled
//                where the sun ray crosses z = 0) and of the satellite.
//                Writes depth, so grains behind the planet are hidden.
//    fs_atmo     the atmosphere shell as additive light: optical path
//                through the shell, lit by the sun with a red sunset edge.
//                Depth test only, at the entry point of the ray, so grains
//                behind the thin limb glow through it.
//  Styles (cam.planet.z): 0 ice giant, 1 Saturn, 2 Jupiter, 3 Mars, 4 Earth,
//  5 a texture map (planetTex, equirectangular; Saturn in the default
//  story), and for the random runs (roll.js, 2026-10-11): 6 Uranus, 7 a
//  hot Jupiter (dark cloud decks, a dull red thermal glow on the night
//  side), 8 a brown dwarf (self-luminous bands), 9 a white dwarf, 10 a
//  neutron star. 9 and 10 are hot surfaces: emission only, no sunlight.
//  The planet is an oblate spheroid with flattening cam.extra.x:
//  each ray is intersected in a space stretched along z (fn hitPlanet).
//  Its radius is cam.extra.w world units (0 means 1): a compact star in
//  the world unit of roll.js is far smaller than 1 (fn planetR).
//  STAR GLARE (fs_sky, styles 9 and 10). A white dwarf or a neutron star
//  is often smaller than a pixel. The sky pass draws a core of at least
//  1.2 px and a short glare around the star's direction: an incandescent
//  source, so a restrained glare is real optics, not decoration. With
//  style 9 the distant sun is off: the white dwarf lights the scene
//  (particles.wgsl lights the grains from it).
//
//  grep -n targets: "fn rayDir", "fn fbm", "fn albedo", "fn fs_surface",
//  "fn fs_atmo", "fn fs_sky"
// ============================================================================

struct Cam {
  vp: mat4x4f, prevVp: mat4x4f, view: mat4x4f,
  eye: vec4f, sun: vec4f, vpSize: vec4f,
  right: vec4f, up: vec4f, fwd: vec4f,
  planet: vec4f, misc: vec4f, sat: vec4f, sat2: vec4f, field: vec4f, ringExt: vec4f,
  extra: vec4f,   // x flattening of the planet, y texture mip level (style 5), z real-ring overlay
};
@group(0) @binding(0) var<uniform> cam: Cam;
@group(0) @binding(1) var tauTex: texture_2d<f32>;
@group(0) @binding(2) var linSamp: sampler;
@group(0) @binding(3) var planetTex: texture_2d<f32>;

struct VOut { @builtin(position) pos: vec4f };
@vertex
fn vs_full(@builtin(vertex_index) vi: u32) -> VOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VOut;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  return o;
}
fn rayDir(fc: vec2f) -> vec3f {
  let px = vec2f(fc.x - 0.5 * cam.vpSize.x, 0.5 * cam.vpSize.y - fc.y);
  return normalize(cam.fwd.xyz * cam.misc.x + px.x * cam.right.xyz + px.y * cam.up.xyz);
}
fn depthOf(p: vec3f) -> f32 {
  let c = cam.vp * vec4f(p, 1.0);
  return clamp(c.z / c.w, 0.0, 1.0);
}
// ray-sphere at the origin: (near, far), or near > far for a miss
fn hitSphere(o: vec3f, d: vec3f, r: f32) -> vec2f {
  let b = dot(o, d);
  let c = dot(o, o) - r * r;
  let h = b * b - c;
  if (h < 0.0) { return vec2f(1.0, -1.0); }
  let s = sqrt(h);
  return vec2f(-b - s, -b + s);
}

// A ray against the spheroid x^2 + y^2 + (z/c)^2 = r^2, c = 1 - flattening:
// the hit in a space stretched along z, mapped back to the ray parameter.
fn hitPlanet(o: vec3f, d: vec3f, r: f32) -> vec2f {
  let c = 1.0 - cam.extra.x;
  let ds = vec3f(d.x, d.y, d.z / c);
  let l = length(ds);
  let h = hitSphere(vec3f(o.x, o.y, o.z / c), ds / l, r);
  return h / l;
}
// the drawn radius of the primary (world units) and the style number
fn planetR() -> f32 { return select(1.0, cam.extra.w, cam.extra.w > 0.0); }
fn styleId() -> i32 { return i32(cam.planet.z + 0.5); }
// the colour of a hot surface (styles 9 and 10), linear, times its radiance
fn starColor(st: i32) -> vec3f {
  if (st == 10) { return vec3f(0.70, 0.80, 1.00) * 9.0; }
  return vec3f(0.82, 0.88, 1.00) * 6.0;
}
fn planetNormal(p: vec3f) -> vec3f {
  let c = 1.0 - cam.extra.x;
  return normalize(vec3f(p.x, p.y, p.z / (c * c)));
}

// ── noise ───────────────────────────────────────────────────────────────────
fn hash3(p: vec3f) -> f32 {
  let q = fract(p * 0.3183099 + vec3f(0.1, 0.17, 0.13)) * 17.0;
  return fract(q.x * q.y * q.z * (q.x + q.y + q.z));
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
  for (var i = 0; i < 5; i++) {
    s = s + a * vnoise(q);
    q = q * 2.03 + vec3f(1.7, 9.2, 3.1);
    a = a * 0.5;
  }
  return s;
}
fn ringTau(xy: vec2f) -> f32 {
  let e = cam.ringExt.x;
  let uv = xy / (2.0 * e) + 0.5;
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return 0.0; }
  return textureSampleLevel(tauTex, linSamp, uv, 0.0).r;
}

// ── planet albedo by style ──────────────────────────────────────────────────
fn bands(lat: f32, w: f32, c0: vec3f, c1: vec3f, c2: vec3f, freq: f32) -> vec3f {
  let s = sin(lat * freq + w * 2.2);
  let t = sin(lat * freq * 2.7 + w * 3.1 + 1.3);
  return mix(mix(c0, c1, smoothstep(-0.6, 0.6, s)), c2, smoothstep(0.35, 0.95, t) * 0.6);
}
fn albedo(nW: vec3f) -> vec3f {
  let a = cam.planet.y;
  let ca = cos(a);
  let sa = sin(a);
  let n = vec3f(ca * nW.x + sa * nW.y, -sa * nW.x + ca * nW.y, nW.z);
  let lat = asin(clamp(n.z, -1.0, 1.0));
  let style = i32(cam.planet.z + 0.5);
  if (style == 5) {
    let uv = vec2f(0.5 + atan2(n.y, n.x) / 6.2831853, 0.5 - lat / 3.14159265);
    // the map is sRGB in an rgba8unorm texture, and its rows only span
    // about 0.58 to 1.0 (the equator near white). Stretch 0.4..1 to 0..1 in
    // sRGB, then decode to linear; sampled as is, the disc reads flat white.
    let c = textureSampleLevel(planetTex, linSamp, uv, cam.extra.y).rgb;
    let k = clamp((c - vec3f(0.4)) / 0.6, vec3f(0.0), vec3f(1.0));
    return pow(k, vec3f(2.2)) * 0.8;
  }
  let w = fbm(n * vec3f(2.0, 2.0, 7.0)) - 0.5;
  let fine = fbm(n * 14.0 + vec3f(w * 3.0));
  if (style == 1) {
    let c = bands(lat, w, vec3f(0.80, 0.70, 0.50), vec3f(0.92, 0.85, 0.66), vec3f(0.66, 0.55, 0.38), 18.0);
    let pole = smoothstep(1.1, 1.45, abs(lat));
    return mix(c * (0.92 + 0.16 * fine), vec3f(0.55, 0.62, 0.70), pole * 0.5);
  }
  if (style == 2) {
    var c = bands(lat, w * 1.6, vec3f(0.78, 0.62, 0.48), vec3f(0.95, 0.90, 0.82), vec3f(0.55, 0.38, 0.28), 22.0);
    // a great red oval
    let sp = vec2f(atan2(n.y, n.x) - 0.8, lat + 0.38);
    let e = length(sp * vec2f(1.0, 2.2));
    c = mix(c, vec3f(0.78, 0.36, 0.22), smoothstep(0.16, 0.09, e + 0.04 * w));
    return c * (0.9 + 0.2 * fine);
  }
  if (style == 3) {
    let terr = fbm(n * 4.0);
    var c = mix(vec3f(0.62, 0.32, 0.18), vec3f(0.78, 0.48, 0.28), terr);
    c = mix(c, vec3f(0.30, 0.20, 0.16), smoothstep(0.55, 0.7, fbm(n * 2.5 + vec3f(5.0))));
    let cap = smoothstep(1.25, 1.38, abs(lat) + 0.05 * w);
    return mix(c * (0.85 + 0.3 * fine), vec3f(0.92, 0.92, 0.95), cap);
  }
  if (style == 4) {
    let land = smoothstep(0.52, 0.56, fbm(n * 2.2 + vec3f(3.0)));
    var c = mix(vec3f(0.04, 0.10, 0.22), mix(vec3f(0.22, 0.30, 0.14), vec3f(0.55, 0.45, 0.30), fine), land);
    let cloud = smoothstep(0.5, 0.75, fbm(n * vec3f(3.0, 3.0, 5.0) + vec3f(w * 4.0, 0.0, 0.0)));
    c = mix(c, vec3f(0.95), cloud * 0.85);
    return mix(c, vec3f(0.95), smoothstep(1.2, 1.35, abs(lat)));
  }
  if (style == 6) {
    // Uranus: a pale cyan haze with faint bands and a brighter pole
    let c = bands(lat, w * 0.4, vec3f(0.52, 0.78, 0.82), vec3f(0.62, 0.86, 0.88), vec3f(0.46, 0.72, 0.78), 10.0);
    return mix(c, vec3f(0.70, 0.90, 0.92), smoothstep(0.9, 1.4, lat) * 0.5) * (0.95 + 0.08 * fine);
  }
  if (style == 7) {
    // a hot Jupiter: dark, low-albedo cloud decks
    let c = bands(lat, w * 2.0, vec3f(0.10, 0.08, 0.09), vec3f(0.20, 0.15, 0.13), vec3f(0.06, 0.06, 0.08), 14.0);
    return c * (0.85 + 0.3 * fine);
  }
  if (style == 8) {
    // a brown dwarf: deep red-brown bands (it shines mostly in the infrared)
    let c = bands(lat, w * 1.8, vec3f(0.30, 0.12, 0.12), vec3f(0.45, 0.20, 0.16), vec3f(0.20, 0.07, 0.10), 20.0);
    return c * (0.85 + 0.3 * fine);
  }
  let c = bands(lat, w * 0.9, vec3f(0.22, 0.46, 0.58), vec3f(0.48, 0.70, 0.76), vec3f(0.16, 0.30, 0.48), 16.0);
  return c * (0.88 + 0.22 * fine);
}
// The light that a surface gives off by itself (linear): the night-side
// glow of a hot Jupiter (about 1,000-2,000 K) and the bands of a brown
// dwarf. n: the normal, ndl: the sun term, alb: the albedo.
fn selfGlow(st: i32, ndl: f32, alb: vec3f) -> vec3f {
  if (st == 7) { return vec3f(0.12, 0.02, 0.006) * smoothstep(0.2, -0.3, ndl) * (0.6 + 2.0 * alb.r); }
  if (st == 8) { return vec3f(0.30, 0.07, 0.03) * (0.35 + 1.6 * alb.r); }
  return vec3f(0.0);
}
fn atmColor() -> vec3f {
  let style = i32(cam.planet.z + 0.5);
  if (style == 1 || style == 5) { return vec3f(0.95, 0.82, 0.58); }
  if (style == 2) { return vec3f(0.85, 0.75, 0.62); }
  if (style == 3) { return vec3f(0.90, 0.55, 0.40); }
  if (style == 4) { return vec3f(0.35, 0.60, 1.00); }
  if (style == 6) { return vec3f(0.55, 0.88, 0.95); }
  if (style == 7) { return vec3f(0.70, 0.40, 0.30); }
  if (style == 8) { return vec3f(0.85, 0.30, 0.20); }
  return vec3f(0.45, 0.80, 1.00);
}

struct FOut { @location(0) color: vec4f, @builtin(frag_depth) depth: f32 };

@fragment
fn fs_surface(in: VOut) -> FOut {
  var o: FOut;
  let d = rayDir(in.pos.xy);
  let e = cam.eye.xyz;
  let h = hitPlanet(e, d, planetR());
  if (h.x > h.y || h.y < 0.0) { discard; }
  let t = max(h.x, 0.0);
  let p = e + t * d;
  let n = planetNormal(p);
  let st = styleId();
  if (st >= 9) {
    // a hot surface: emission with limb darkening, no sunlight
    let mu9 = max(dot(n, -d), 0.0);
    o.color = vec4f(starColor(st) * (0.45 + 0.55 * mu9), 1.0);
    o.depth = depthOf(p);
    return o;
  }
  let L = cam.sun.xyz;
  let ndl = dot(n, L);
  let lit = clamp(ndl * 0.92 + 0.08, 0.0, 1.0) * smoothstep(-0.10, 0.12, ndl);
  var shade = vec3f(lit);
  // the ring shadow: tau where the sun ray from p crosses z = 0
  if (abs(L.z) > 1e-3) {
    let s = -p.z / L.z;
    if (s > 0.0) {
      let tau = ringTau((p + s * L).xy);
      shade = shade * exp(-tau / max(abs(L.z), 0.05));
    }
  }
  // the satellite's shadow
  let cs = cam.sat.xyz - p;
  let along = dot(cs, L);
  if (along > 0.0 && cam.sat.w > 0.0) {
    let b = length(cs - along * L);
    shade = shade * mix(0.12, 1.0, smoothstep(cam.sat.w * 0.7, cam.sat.w * 1.4, b));
  }
  let alb = albedo(n) * 0.55;
  let mu = max(dot(n, -d), 0.0);
  // limb darkening on the lit side, and a cool night side
  var col = alb * shade * cam.sun.w * (0.55 + 0.45 * pow(mu, 0.35));
  col = col + alb * vec3f(0.010, 0.012, 0.020);
  // haze toward the limb (the atmosphere seen through its depth)
  let rim = pow(1.0 - mu, 4.0) * smoothstep(-0.25, 0.3, ndl);
  col = mix(col, atmColor() * cam.sun.w * 0.6, rim * 0.6);
  col = col + selfGlow(st, ndl, alb / 0.55);
  o.color = vec4f(col, 1.0);
  o.depth = depthOf(p);
  return o;
}

@fragment
fn fs_atmo(in: VOut) -> FOut {
  var o: FOut;
  let d = rayDir(in.pos.xy);
  let e = cam.eye.xyz;
  if (styleId() >= 9) { discard; }
  let R = planetR();
  let Ra = R * (1.0 + cam.planet.x);
  let ha = hitPlanet(e, d, Ra);
  if (ha.x > ha.y || ha.y < 0.0) { discard; }
  let t0 = max(ha.x, 0.0);
  var t1 = ha.y;
  let hp = hitPlanet(e, d, R);
  if (hp.x <= hp.y && hp.x > 0.0) { t1 = hp.x; }
  // closest approach to the centre along the ray segment
  let tc = clamp(-dot(e, d), t0, t1);
  let pc = e + tc * d;
  let bw = length(vec3f(pc.x, pc.y, pc.z / (1.0 - cam.extra.x)));
  let b = bw / R;
  let H = cam.planet.x * 0.33;
  let dens = exp(-(max(b, 1.0) - 1.0) / H);
  let chord = (t1 - t0) / (cam.planet.x * R);
  let L = cam.sun.xyz;
  let ill = smoothstep(-0.35, 0.35, dot(pc / bw, L));
  let sunset = smoothstep(0.35, -0.05, dot(pc / bw, L)) * ill;
  let fwd = pow(max(dot(d, L), 0.0), 8.0);
  let amount = (1.0 - exp(-0.6 * dens * chord)) * ill;
  let col = mix(atmColor(), vec3f(1.0, 0.45, 0.22), sunset) * amount * cam.sun.w * (0.9 + 2.5 * fwd);
  o.color = vec4f(col, 0.0);
  o.depth = depthOf(e + t0 * d);
  return o;
}

@fragment
fn fs_sky(in: VOut) -> @location(0) vec4f {
  let d = rayDir(in.pos.xy);
  // stars on a direction grid
  var col = vec3f(0.004, 0.005, 0.009);
  for (var lv = 0; lv < 2; lv++) {
    let sc = select(90.0, 210.0, lv == 1);
    let q = d * sc;
    let cell = floor(q);
    let hsh = hash3(cell + vec3f(f32(lv) * 7.0));
    if (hsh > 0.985) {
      let off = vec3f(hash3(cell + vec3f(1.0, 0.0, 0.0)), hash3(cell + vec3f(0.0, 1.0, 0.0)), hash3(cell + vec3f(0.0, 0.0, 1.0)));
      let sp = cell + 0.2 + 0.6 * off;
      let dist = length(q - sp);
      let mag = pow((hsh - 0.985) / 0.015, 3.0);
      let temp = hash3(cell + vec3f(3.0, 5.0, 7.0));
      let tint = mix(vec3f(1.0, 0.75, 0.55), vec3f(0.7, 0.82, 1.0), temp);
      col = col + tint * mag * 2.2 * exp(-dist * dist * select(140.0, 260.0, lv == 1));
    }
  }
  // a faint galactic band
  let gn = normalize(vec3f(0.3, -0.5, 0.81));
  let band = exp(-pow(dot(d, gn) / 0.22, 2.0));
  // the band noise only where the band shows (it was the costliest part
  // of the sky: 5 octaves on every pixel); 3 octaves of value noise
  if (band > 0.02) {
    let q = d * 3.0 + vec3f(2.0);
    let neb = 0.5 * vnoise(q) + 0.25 * vnoise(q * 2.03 + vec3f(1.7, 9.2, 3.1)) + 0.125 * vnoise(q * 4.1 + vec3f(3.3, 1.1, 7.7));
    col = col + band * (0.010 + 0.022 * neb) * mix(vec3f(0.55, 0.45, 0.70), vec3f(0.40, 0.55, 0.75), neb);
  }
  // the sun (off when a white dwarf lights the scene)
  let st = styleId();
  let cs = dot(d, cam.sun.xyz);
  let sunOn = select(1.0, 0.0, st == 9);
  col = col + sunOn * vec3f(1.0, 0.92, 0.80) * (smoothstep(0.99996, 0.99999, cs) * 60.0 + pow(max(cs, 0.0), 900.0) * 1.5 + pow(max(cs, 0.0), 40.0) * 0.04);
  // a compact star: a core of at least 1.2 px and a short glare
  if (st >= 9) {
    let toS = -cam.eye.xyz;
    let dist = max(length(toS), 1e-6);
    let u = toS / dist;
    let sn = length(cross(d, u));
    let ang = select(3.14159265 - asin(min(sn, 1.0)), asin(min(sn, 1.0)), dot(d, u) > 0.0);
    let px = ang * cam.misc.x;
    let rpx = max(1.2, cam.misc.x * planetR() / dist);
    let core = smoothstep(rpx + 1.0, rpx - 0.5, px);
    let glare = 0.5 * exp(-px / (2.0 + 0.4 * rpx)) + 0.05 * exp(-px / 24.0);
    col = col + starColor(st) * (core + glare);
  }
  return vec4f(col, 1.0);
}
