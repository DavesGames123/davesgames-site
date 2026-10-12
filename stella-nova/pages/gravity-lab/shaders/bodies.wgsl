// ============================================================================
//  GRAVITY LAB  ·  shaders/bodies.wgsl — the sky and the bodies
// ----------------------------------------------------------------------------
//  Two pipelines in one module (render.js).
//    vs_full + fs_sky   one full-screen triangle: sharp stars from a hashed
//                       grid of directions (two layers) and a faint band of
//                       the galaxy. The sky turns with the inertial frame,
//                       so a rotating view (cam.frame.w) shows the turn.
//    vs_body + fs_body  one instanced quad per body. Each pixel casts its
//                       own ray and hits the exact sphere (no mesh), then
//                       writes the depth of the hit point (reversed Z).
//
//  FRAME COORDINATES. The CPU puts every body in frame coordinates:
//  p' = Rz(-theta) (p - c), c and theta in cam.frame. The camera lives in
//  the same coordinates. The particles (points.wgsl) do the same in their
//  vertex shader.
//
//  KINDS (bodies[i].col.w, -1 a body that is gone): 0 star, 1 rock, 2 gas giant, 3 ice giant,
//  4 earth, 5 comet nucleus, 6 probe, 7 galaxy core, 8 black hole.
//  Stars and cores are emissive: limb darkening and a fine granulation.
//  A star smaller than a pixel gets a core of cam.p0.x px and a short glare
//  (an incandescent point source, so a glare is real optics). Planets have
//  a hard terminator from up to two lights (cam.l0, cam.l1). A black hole
//  is a black disc with a thin photon ring. A comet gets a faint coma when
//  ext.z > 0 (render.js sets it from the distance to the nearest star).
//
//  GLOW WITHOUT ALPHA. The quad of a star is larger than the sphere. A
//  pixel off the sphere returns a premultiplied colour with alpha 0 and
//  the far depth: with the blend (one, one-minus-src-alpha) that adds
//  light and covers nothing, and a planet in front still hides it.
//
//  WGSL NOTE: no mixed * and ^, no mixed && and || without parentheses
//  (Tint rejects what naga allows).
//
//  grep -n targets: "fn fs_sky", "fn vs_body", "fn fs_body", "fn surface",
//  "fn fbm", "fn lightAt"
// ============================================================================

struct Cam {
  vp: mat4x4f,
  eye: vec4f,      // xyz, sim time
  right: vec4f,    // xyz, focal length in device px
  up: vec4f,       // xyz, device px per CSS px
  fwd: vec4f,      // xyz, exposure
  vpSize: vec4f,   // w, h, 1/w, 1/h (device px)
  frame: vec4f,    // c.xyz (world), theta
  l0: vec4f,       // light 0: xyz (frame), w 1 point / 0 direction
  l1: vec4f,       // light 1 (w 1 point, 0 none)
  c0: vec4f,       // light 0 colour, intensity
  c1: vec4f,       // light 1 colour, intensity
  p0: vec4f,       // min body px, min particle px, flash time, colour mode
  p1: vec4f,       // particle gain, speed scale, body count, sky gain
  vref: vec4f,     // velocity of the frame centre (world), 0
};
struct BI { pos: vec4f, col: vec4f, ext: vec4f };   // ext: seed, selected, glow, 0

@group(0) @binding(0) var<uniform> cam: Cam;
@group(0) @binding(1) var<storage, read> bodies: array<BI>;

// ── noise ───────────────────────────────────────────────────────────────────
fn hash3(p: vec3f) -> f32 {
  var q = fract(p * 0.1031);
  q = q + dot(q, q.zyx + 31.32);
  return fract((q.x + q.y) * q.z);
}
fn hash33(p: vec3f) -> vec3f {
  var q = fract(p * vec3f(0.1031, 0.1030, 0.0973));
  q = q + dot(q, q.yxz + 33.33);
  return fract((q.xxy + q.yxx) * q.zyx);
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
  for (var k = 0; k < 5; k++) {
    s = s + a * vnoise(q);
    q = q * 2.03 + vec3f(1.7, 9.2, 3.1);
    a = a * 0.5;
  }
  return s;
}

// frame direction -> inertial (world) direction
fn toWorldDir(d: vec3f) -> vec3f {
  let c = cos(cam.frame.w);
  let s = sin(cam.frame.w);
  return vec3f(c * d.x - s * d.y, s * d.x + c * d.y, d.z);
}

// ── sky ─────────────────────────────────────────────────────────────────────
struct FOut { @builtin(position) pos: vec4f };
@vertex
fn vs_full(@builtin(vertex_index) vi: u32) -> FOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: FOut;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  return o;
}
fn starLayer(d: vec3f, cells: f32, pxAng: f32, gain: f32) -> vec3f {
  let g = d * cells;
  let cid = floor(g);
  let h = hash33(cid);
  // one star per cell, kept off the cell edges
  let sp = normalize((cid + 0.2 + 0.6 * h) / cells);
  let ang = length(cross(sp, d));
  let px = ang / pxAng;
  let b = pow(hash3(cid + 7.1), 14.0) * gain;
  let w = exp(-px * px * 1.6);
  // colour temperature: red dwarfs to blue giants
  let t = hash3(cid + 3.3);
  let tint = mix(vec3f(1.0, 0.72, 0.52), vec3f(0.72, 0.82, 1.0), t);
  return tint * (b * w);
}
@fragment
fn fs_sky(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let px = vec2f(fc.x - 0.5 * cam.vpSize.x, 0.5 * cam.vpSize.y - fc.y);
  let dF = normalize(cam.fwd.xyz * cam.right.w + px.x * cam.right.xyz + px.y * cam.up.xyz);
  let d = toWorldDir(dF);
  let pxAng = 1.0 / cam.right.w;
  var c = starLayer(d, 90.0, pxAng, 2.2) + starLayer(d, 210.0, pxAng, 0.9);
  // the band of the galaxy: a great circle tilted 60 degrees to the orbit
  // plane, with dust lanes; very faint
  let nb = normalize(vec3f(0.0, -0.866, 0.5));
  let lat = dot(d, nb);
  let band = exp(-lat * lat * 26.0) * (0.55 + 0.45 * fbm(d * 7.0)) * (1.0 - 0.6 * smoothstep(0.45, 0.75, fbm(d * 15.0 + 4.0)));
  c = c + vec3f(0.55, 0.6, 0.75) * band * 0.035;
  return vec4f(c * cam.p1.w, 1.0);
}

// ── bodies ──────────────────────────────────────────────────────────────────
struct BOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) @interpolate(flat) id: u32,
  @location(2) @interpolate(flat) rr: f32,
};
fn quadSize(kind: f32, glow: f32) -> f32 {
  if (kind < 0.5 || abs(kind - 7.0) < 0.5) { return 3.2; }
  if (abs(kind - 8.0) < 0.5) { return 1.7; }
  if (abs(kind - 5.0) < 0.5 && glow > 0.0) { return 3.0; }
  return 1.25;
}
@vertex
fn vs_body(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> BOut {
  var corner = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let b = bodies[ii];
  var o: BOut;
  o.id = ii;
  let c = b.pos.xyz;
  let z = dot(c - cam.eye.xyz, cam.fwd.xyz);
  if (b.col.w < 0.0 || z <= 1e-6 * b.pos.w) {
    o.pos = vec4f(0.0, 0.0, -2.0, 1.0);
    o.wp = c;
    o.rr = 0.0;
    return o;
  }
  // at least cam.p0.x px across (a probe or a far planet stays visible)
  let rr = max(b.pos.w, cam.p0.x * z / cam.right.w);
  let s = rr * quadSize(b.col.w, b.ext.z) + 2.0 * z / cam.right.w;
  let k = corner[vi];
  let wp = c + (k.x * s) * cam.right.xyz + (k.y * s) * cam.up.xyz;
  o.pos = cam.vp * vec4f(wp, 1.0);
  o.wp = wp;
  o.rr = rr;
  return o;
}

// Light arriving at p (frame coordinates): direction and colour.
fn lightAt(p: vec3f, L: vec4f, C: vec4f) -> vec4f {
  if (C.w <= 0.0) { return vec4f(0.0, 0.0, 1.0, 0.0); }
  if (L.w > 0.5) {
    let d = L.xyz - p;
    return vec4f(normalize(d), C.w);
  }
  return vec4f(normalize(L.xyz), C.w);
}
fn lit(n: vec3f, p: vec3f, albedo: vec3f, wrap: f32) -> vec3f {
  let a = lightAt(p, cam.l0, cam.c0);
  let b = lightAt(p, cam.l1, cam.c1);
  // a hard terminator: a thin wrap of a few degrees only
  let da = clamp((dot(n, a.xyz) + wrap) / (1.0 + wrap), 0.0, 1.0);
  let db = clamp((dot(n, b.xyz) + wrap) / (1.0 + wrap), 0.0, 1.0);
  return albedo * (cam.c0.rgb * (a.w * da) + cam.c1.rgb * (b.w * db) + vec3f(0.018, 0.02, 0.026));
}

// The surface colour of a body at the unit normal n (body frame).
fn surface(kind: f32, n: vec3f, col: vec3f, seed: f32, p: vec3f, mu: f32) -> vec3f {
  let q = n * 2.2 + vec3f(seed * 17.0, seed * 5.3, seed * 11.1);
  if (abs(kind - 2.0) < 0.5) {
    // gas giant: zonal belts and zones, with turbulent edges
    let w = fbm(q * 1.5) * 0.9;
    let band = sin(n.z * 18.0 + w * 2.2 + seed * 6.0);
    let band2 = sin(n.z * 41.0 + w * 3.0);
    var a = col * (0.86 + 0.18 * band + 0.05 * band2);
    a = mix(a, col * vec3f(1.08, 0.92, 0.82), 0.25 * smoothstep(0.3, 0.9, band));
    let limb = 0.55 + 0.45 * pow(mu, 0.4);
    return lit(n, p, a * limb, 0.04);
  }
  if (abs(kind - 3.0) < 0.5) {
    let a = col * (0.92 + 0.08 * sin(n.z * 12.0 + fbm(q) * 1.5));
    let limb = 0.7 + 0.3 * pow(mu, 0.3);
    return lit(n, p, a * limb, 0.05);
  }
  if (abs(kind - 4.0) < 0.5) {
    // earth: ocean, land, ice caps, clouds
    let h = fbm(q * 1.3);
    var a = vec3f(0.05, 0.12, 0.32);
    if (h > 0.52) { a = mix(vec3f(0.22, 0.32, 0.14), vec3f(0.48, 0.4, 0.28), smoothstep(0.55, 0.7, h)); }
    a = mix(a, vec3f(0.92, 0.94, 0.97), smoothstep(0.82, 0.9, abs(n.z)));
    let cl = smoothstep(0.5, 0.75, fbm(q * 2.3 + 5.0));
    a = mix(a, vec3f(0.95), cl * 0.8);
    return lit(n, p, a, 0.06);
  }
  if (abs(kind - 5.0) < 0.5) {
    let a = col * 0.35 * (0.7 + 0.6 * fbm(q * 3.0));
    return lit(n, p, a, 0.0);
  }
  if (abs(kind - 6.0) < 0.5) {
    return lit(n, p, vec3f(0.85, 0.86, 0.9), 0.1) + vec3f(0.15);
  }
  // rock: maria, craters by value noise, a dusty regolith
  let m = fbm(q * 1.2);
  let cr = fbm(q * 6.0);
  let a = col * (0.62 + 0.55 * m) * (0.85 + 0.3 * smoothstep(0.45, 0.6, cr));
  return lit(n, p, a, 0.0);
}

struct FragOut { @location(0) c: vec4f, @builtin(frag_depth) depth: f32 };
@fragment
fn fs_body(i: BOut) -> FragOut {
  let b = bodies[i.id];
  let kind = b.col.w;
  let c = b.pos.xyz;
  let rr = i.rr;
  let ro = cam.eye.xyz;
  let rd = normalize(i.wp - ro);
  let oc = c - ro;
  let tb = dot(oc, rd);
  let q2 = max(dot(oc, oc) - tb * tb, 0.0);
  let q = sqrt(q2);
  let pxw = tb / cam.right.w;          // world size of one px at the body
  var o: FragOut;
  o.depth = 0.0;
  let isStar = (kind < 0.5) || (abs(kind - 7.0) < 0.5);
  let edge = (rr - q) / pxw;           // px inside the limb
  // selection ring: a thin line 4 px outside the limb
  var sel = vec3f(0.0);
  if (b.ext.y > 0.5) {
    let dpx = (q - rr) / pxw - 5.0;
    sel = vec3f(1.0, 0.72, 0.42) * 0.9 * clamp(1.2 - abs(dpx), 0.0, 1.0);
  }
  if (edge < -0.5) {
    // off the sphere: glow only (alpha 0, far depth)
    var g = sel;
    let x = q / rr;
    if (isStar) {
      // a short glare: falls as the inverse cube of the distance in radii,
      // and at least a few px for a star smaller than a pixel
      let gx = max(x - 1.0, 0.0);
      let pxd = (q - rr) / pxw;
      let em = select(5.0, 3.0, abs(kind - 7.0) < 0.5);
      g = g + b.col.rgb * em * (0.16 / ((1.0 + 3.0 * gx) * (1.0 + 3.0 * gx) * (1.0 + 3.0 * gx)) + 0.5 * exp(-pxd * pxd * 0.12));
    }
    if (abs(kind - 8.0) < 0.5) {
      // photon ring of the black hole
      let rx = (x - 1.16) / 0.035;
      let ring = exp(-rx * rx);
      g = g + vec3f(1.0, 0.86, 0.68) * ring * 1.8;
    }
    if (abs(kind - 5.0) < 0.5 && b.ext.z > 0.0) {
      let pxd = (q - rr) / pxw;
      g = g + vec3f(0.55, 0.8, 1.0) * b.ext.z * 0.5 * exp(-max(x - 1.0, 0.0) * 1.3) * (1.0 - exp(-pxd * 0.3));
    }
    o.c = vec4f(g * cam.fwd.w, 0.0);
    if (dot(g, g) < 1e-8) { discard; }
    return o;
  }
  let a = clamp(edge + 0.5, 0.0, 1.0);
  let th = sqrt(max(rr * rr - q2, 0.0));
  let P = ro + rd * (tb - th);
  let n = normalize(P - c);
  let mu = clamp(dot(n, -rd), 0.0, 1.0);
  var col: vec3f;
  if (isStar) {
    // emissive: limb darkening (Eddington, u = 0.6) and granulation
    let gr = 0.92 + 0.08 * fbm(n * 40.0 + vec3f(b.ext.x * 9.0, 0.0, 0.0));
    let em = select(5.0, 3.0, abs(kind - 7.0) < 0.5);
    col = b.col.rgb * em * (0.4 + 0.6 * mu) * gr;
  } else if (abs(kind - 8.0) < 0.5) {
    col = vec3f(0.0);
  } else {
    col = surface(kind, n, b.col.rgb, b.ext.x, P, mu);
  }
  let clip = cam.vp * vec4f(P, 1.0);
  o.depth = clip.z / clip.w;
  o.c = vec4f((col * a + sel) * cam.fwd.w, a);
  return o;
}
