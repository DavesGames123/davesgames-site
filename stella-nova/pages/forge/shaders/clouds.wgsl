// ============================================================================
//  PLANET FORGE  ·  clouds.wgsl — the evolving cloud map (one compute pass)
// ----------------------------------------------------------------------------
//  A port of clouds.js cloudField: the same deck, cyclones, fronts and
//  cirrus, on a seeded simplex noise that copies noise.js simplex3 (the
//  same integer hash in u32, so the GPU field is the CPU field up to f32
//  rounding). render.js runs csClouds on a W x W/2 equirect map (the
//  texelDir layout of noise.js) when the simulated hour changes.
//  Output rgba8unorm: r deck cover, g cirrus cover, b 0, a 1.
//
//  grep -n targets: "struct CloudU", "fn n_hash", "fn simplex",
//  "fn frontBand", "fn deckAt", "fn cirrusAt", "fn csClouds"
// ============================================================================

struct CloudU {
  a: vec4f,                // hours, cover, freq, swirl
  b: vec4f,                // cirrus, deck on, cyclone count, 0
  s: vec4i,                // deck seed, cirrus seed
  pad: vec4f,
  cyc: array<vec4f, 24>,   // per cyclone: (cx, cy, cz, r), (twist, front, sign, intensity)
}

@group(0) @binding(0) var<uniform> U: CloudU;
@group(0) @binding(1) var outMap: texture_storage_2d<rgba8unorm, write>;

fn n_hash(i: i32, j: i32, k: i32, s: i32) -> u32 {
  var h = (bitcast<u32>(i) * 0x8da6b343u) ^ (bitcast<u32>(j) * 0xd8163841u) ^ (bitcast<u32>(k) * 0xcb1ab31fu) ^ bitcast<u32>(s);
  h = (h ^ (h >> 16u)) * 0x7feb352du;
  h = (h ^ (h >> 15u)) * 0x846ca68bu;
  return h ^ (h >> 16u);
}

fn n_grad(h: u32) -> vec3f {
  var g = array<vec3f, 16>(
    vec3f(1.0, 1.0, 0.0), vec3f(-1.0, 1.0, 0.0), vec3f(1.0, -1.0, 0.0), vec3f(-1.0, -1.0, 0.0),
    vec3f(1.0, 0.0, 1.0), vec3f(-1.0, 0.0, 1.0), vec3f(1.0, 0.0, -1.0), vec3f(-1.0, 0.0, -1.0),
    vec3f(0.0, 1.0, 1.0), vec3f(0.0, -1.0, 1.0), vec3f(0.0, 1.0, -1.0), vec3f(0.0, -1.0, -1.0),
    vec3f(1.0, 1.0, 0.0), vec3f(-1.0, 1.0, 0.0), vec3f(0.0, -1.0, 1.0), vec3f(0.0, -1.0, -1.0));
  return g[h & 15u];
}

// 3D simplex noise, kernel r^2 = 0.5, range about [-1, 1] (noise.js simplex3).
fn simplex(p: vec3f, seed: i32) -> f32 {
  let s = (p.x + p.y + p.z) / 3.0;
  let ijk = floor(p + s);
  let t = (ijk.x + ijk.y + ijk.z) / 6.0;
  let x0 = p - ijk + t;
  var i1 = vec3f(0.0);
  var i2 = vec3f(0.0);
  if (x0.x >= x0.y) {
    if (x0.y >= x0.z) { i1 = vec3f(1.0, 0.0, 0.0); i2 = vec3f(1.0, 1.0, 0.0); }
    else if (x0.x >= x0.z) { i1 = vec3f(1.0, 0.0, 0.0); i2 = vec3f(1.0, 0.0, 1.0); }
    else { i1 = vec3f(0.0, 0.0, 1.0); i2 = vec3f(1.0, 0.0, 1.0); }
  } else {
    if (x0.y < x0.z) { i1 = vec3f(0.0, 0.0, 1.0); i2 = vec3f(0.0, 1.0, 1.0); }
    else if (x0.x < x0.z) { i1 = vec3f(0.0, 1.0, 0.0); i2 = vec3f(0.0, 1.0, 1.0); }
    else { i1 = vec3f(0.0, 1.0, 0.0); i2 = vec3f(1.0, 1.0, 0.0); }
  }
  let ii = vec3i(ijk);
  var n = 0.0;
  for (var c = 0; c < 4; c++) {
    var o = vec3f(0.0);
    if (c == 1) { o = i1; } else if (c == 2) { o = i2; } else if (c == 3) { o = vec3f(1.0); }
    let d = x0 - o + f32(c) / 6.0;
    let r = 0.5 - dot(d, d);
    if (r <= 0.0) { continue; }
    let oi = vec3i(o);
    let g = n_grad(n_hash(ii.x + oi.x, ii.y + oi.y, ii.z + oi.z, seed));
    let r2 = r * r;
    n += r2 * r2 * dot(g, d);
  }
  return n * 75.4;
}

fn rotAbout(v: vec3f, k: vec3f, a: f32) -> vec3f {
  let c = cos(a);
  let s = sin(a);
  return v * c + cross(k, v) * s + k * (dot(k, v) * (1.0 - c));
}

fn frontBand(p: vec3f, c: vec3f, r: f32, sg: f32) -> f32 {
  let e = normalize(vec3f(-c.z, 0.0, c.x) + vec3f(1e-6, 0.0, 0.0));
  let nn = normalize(vec3f(-c.x * c.y, 1.0 - c.y * c.y, -c.z * c.y) + vec3f(0.0, 1e-6, 0.0));
  let a = normalize(-0.6 * e - 0.8 * sg * nn);
  let d = p - c;
  let s = dot(d, a);
  let b = cross(c, a);
  let dp = dot(d, b) - 0.18 * s * s / r;
  let q = dp / (0.3 * r);
  return exp(-q * q) * smoothstep(0.0, 0.6 * r, s) * smoothstep(5.0 * r, 2.0 * r, s);
}

var<private> OCT_W: array<f32, 8> = array<f32, 8>(0.0, 0.002, -0.0015, 0.003, -0.0025, 0.004, -0.005, 0.006);
var<private> OCT_V: array<f32, 8> = array<f32, 8>(0.004, 0.006, 0.009, 0.013, 0.018, 0.025, 0.034, 0.045);

fn deckAt(p: vec3f, lat: f32) -> f32 {
  let t = U.a.x;
  var q = p;
  var storm = 0.0;
  var eye = 0.0;
  let nc = i32(U.b.z);
  for (var k = 0; k < 12; k++) {
    if (k >= nc) { break; }
    let c = U.cyc[k * 2].xyz;
    let r = U.cyc[k * 2].w;
    let m = U.cyc[k * 2 + 1];
    let dd = p - c;
    let d2 = dot(dd, dd) / (r * r);
    if (d2 > 30.0) { continue; }
    if (d2 < 9.0) { q = rotAbout(q, c, m.x * exp(-d2) * (1.0 - exp(-3.0 * d2))); }
    storm += m.w * exp(-d2 * 0.7);
    eye = max(eye, m.w * exp(-d2 * 60.0));
    if (m.y > 0.0) { storm += m.y * frontBand(p, c, r, m.z); }
  }
  let sd = U.s.x;
  let w = vec3f(
    simplex(vec3f(q.x * 1.6 + t * 0.004, q.y * 1.6, q.z * 1.6), sd + 1),
    simplex(vec3f(q.x * 1.6, q.y * 1.6 + t * 0.004, q.z * 1.6), sd + 2),
    simplex(vec3f(q.x * 1.6, q.y * 1.6, q.z * 1.6 + t * 0.004), sd + 3));
  let qq = q + 0.12 * w;
  var n = 0.0;
  var a = 1.0;
  var nrm = 0.0;
  var f = U.a.z * 1.3;
  for (var i = 0; i < 8; i++) {
    let ww = OCT_W[i] * t;
    let cw = cos(ww);
    let sw = sin(ww);
    let v = OCT_V[i] * t;
    let x = vec3f((qq.x * cw - qq.z * sw) * f + v, qq.y * f * 1.4 + 0.6 * v, (qq.x * sw + qq.z * cw) * f - 0.8 * v);
    n += a * simplex(x, sd + 11 + i * 1013);
    nrm += a;
    a *= 0.58;
    f *= 2.05;
  }
  n = n / (sqrt(nrm) * 1.1);
  let band = 0.12 * cos(6.0 * lat) + 0.08 * cos(2.0 * lat);
  let thr = 0.35 - U.a.y * 0.9 - band - 0.45 * min(storm, 1.2) + 0.6 * eye;
  let c0 = smoothstep(thr - 0.02, thr + 0.16, n);
  return clamp(c0 * (0.7 + 0.3 * smoothstep(thr + 0.1, thr + 0.5, n)), 0.0, 1.0);
}

fn cirrusAt(p: vec3f, lat: f32) -> f32 {
  let t = U.a.x;
  let cir = U.b.x;
  var n = 0.0;
  var a = 1.0;
  var nrm = 0.0;
  var f = U.a.z * 0.8;
  for (var i = 0; i < 4; i++) {
    let ww = -OCT_W[i + 1] * t * 2.0;
    let cw = cos(ww);
    let sw = sin(ww);
    let v = OCT_V[i + 1] * t * 1.5;
    let x = vec3f((p.x * cw - p.z * sw) * f - v, p.y * f * 3.0, (p.x * sw + p.z * cw) * f + v);
    n += a * (1.0 - abs(simplex(x, U.s.y + i * 977)));
    nrm += a;
    a *= 0.55;
    f *= 2.1;
  }
  n = n / nrm;
  let zone = 0.55 + 0.45 * smoothstep(0.15, 0.7, abs(sin(lat)));
  return clamp(smoothstep(0.8 - 0.2 * cir, 0.98, n) * zone * min(1.0, cir * 1.6), 0.0, 1.0);
}

@compute @workgroup_size(8, 8)
fn csClouds(@builtin(global_invocation_id) id: vec3u) {
  let sz = textureDimensions(outMap);
  if (id.x >= sz.x || id.y >= sz.y) { return; }
  let u = (f32(id.x) + 0.5) / f32(sz.x);
  let th = (f32(id.y) + 0.5) / f32(sz.y) * 3.14159265;
  let p = vec3f(-cos(6.2831853 * u) * sin(th), cos(th), sin(6.2831853 * u) * sin(th));
  let lat = asin(clamp(p.y, -1.0, 1.0));
  var deck = 0.0;
  if (U.b.y > 0.5 && U.a.y > 0.0) { deck = deckAt(p, lat); }
  var cir = 0.0;
  if (U.b.x > 0.0) { cir = cirrusAt(p, lat); }
  textureStore(outMap, id.xy, vec4f(deck, cir, 0.0, 1.0));
}
