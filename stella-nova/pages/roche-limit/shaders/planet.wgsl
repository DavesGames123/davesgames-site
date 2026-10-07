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
//  Styles (cam.planet.z): 0 ice giant, 1 Saturn, 2 Jupiter, 3 Mars, 4 Earth.
//
//  grep -n targets: "fn rayDir", "fn fbm", "fn albedo", "fn fs_surface",
//  "fn fs_atmo", "fn fs_sky"
// ============================================================================

struct Cam {
  vp: mat4x4f, prevVp: mat4x4f, view: mat4x4f,
  eye: vec4f, sun: vec4f, vpSize: vec4f,
  right: vec4f, up: vec4f, fwd: vec4f,
  planet: vec4f, misc: vec4f, sat: vec4f, sat2: vec4f, field: vec4f, ringExt: vec4f,
};
@group(0) @binding(0) var<uniform> cam: Cam;
@group(0) @binding(1) var tauTex: texture_2d<f32>;
@group(0) @binding(2) var linSamp: sampler;

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
  let c = bands(lat, w * 0.9, vec3f(0.22, 0.46, 0.58), vec3f(0.48, 0.70, 0.76), vec3f(0.16, 0.30, 0.48), 16.0);
  return c * (0.88 + 0.22 * fine);
}
fn atmColor() -> vec3f {
  let style = i32(cam.planet.z + 0.5);
  if (style == 1) { return vec3f(0.95, 0.80, 0.55); }
  if (style == 2) { return vec3f(0.85, 0.75, 0.62); }
  if (style == 3) { return vec3f(0.90, 0.55, 0.40); }
  if (style == 4) { return vec3f(0.35, 0.60, 1.00); }
  return vec3f(0.45, 0.80, 1.00);
}

struct FOut { @location(0) color: vec4f, @builtin(frag_depth) depth: f32 };

@fragment
fn fs_surface(in: VOut) -> FOut {
  var o: FOut;
  let d = rayDir(in.pos.xy);
  let e = cam.eye.xyz;
  let h = hitSphere(e, d, 1.0);
  if (h.x > h.y || h.y < 0.0) { discard; }
  let t = max(h.x, 0.0);
  let p = e + t * d;
  let n = normalize(p);
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
  o.color = vec4f(col, 1.0);
  o.depth = depthOf(p);
  return o;
}

@fragment
fn fs_atmo(in: VOut) -> FOut {
  var o: FOut;
  let d = rayDir(in.pos.xy);
  let e = cam.eye.xyz;
  let Ra = 1.0 + cam.planet.x;
  let ha = hitSphere(e, d, Ra);
  if (ha.x > ha.y || ha.y < 0.0) { discard; }
  let t0 = max(ha.x, 0.0);
  var t1 = ha.y;
  let hp = hitSphere(e, d, 1.0);
  if (hp.x <= hp.y && hp.x > 0.0) { t1 = hp.x; }
  // closest approach to the centre along the ray segment
  let tc = clamp(-dot(e, d), t0, t1);
  let pc = e + tc * d;
  let b = length(pc);
  let H = cam.planet.x * 0.33;
  let dens = exp(-(max(b, 1.0) - 1.0) / H);
  let chord = (t1 - t0) / cam.planet.x;
  let L = cam.sun.xyz;
  let ill = smoothstep(-0.35, 0.35, dot(pc / b, L));
  let sunset = smoothstep(0.35, -0.05, dot(pc / b, L)) * ill;
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
  let neb = fbm(d * 3.0 + vec3f(2.0));
  col = col + band * (0.010 + 0.022 * neb) * mix(vec3f(0.55, 0.45, 0.70), vec3f(0.40, 0.55, 0.75), neb);
  // the sun
  let cs = dot(d, cam.sun.xyz);
  col = col + vec3f(1.0, 0.92, 0.80) * (smoothstep(0.99996, 0.99999, cs) * 60.0 + pow(max(cs, 0.0), 900.0) * 1.5 + pow(max(cs, 0.0), 40.0) * 0.04);
  return vec4f(col, 1.0);
}
