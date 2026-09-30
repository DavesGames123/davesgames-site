// ═══════════════════════════════════════════════════════════════════════════
//  DOT FIELD TABLE  ·  one fragment shader per cell. Each cell draws a live
//  procedural field through a discrete mark: dots, square pixels, LEDs,
//  halftone screens or dither thresholds. Pitch snaps to whole device pixels,
//  so the marks keep a fixed CSS size. Brightness runs through ramp on the ink,
//  tone and cream swatches. Ordered dither after Bayer 1973; clustered dot and
//  blue-noise thresholds after Ulichney 1987; IGN after Jimenez 2014; distance
//  functions and domain warp after Quilez; cell patterns after The Book of
//  Shaders; pcg2d hash after Jarzynski and Olano 2020; Truchet after Smith
//  1987. The cell bodies are original.
// ═══════════════════════════════════════════════════════════════════════════
const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.283185307179586;

struct DotU {
    size: vec2f, time: f32, pixelScale: f32,
    ink: vec4f, tone: vec4f, cream: vec4f,
    exposure: f32, contrast: f32, pitch: f32, pad1: f32,
    k: vec4f,
};
@group(0) @binding(0) var<uniform> u: DotU;

@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(p[i], 0.0, 1.0);
}

// ── coordinates ─────────────────────────────────────────────────────────────
// CSS pixels, y down
fn px(fp: vec2f) -> vec2f { return fp / max(u.pixelScale, 0.001); }
// x centered, y up, the short side spans -0.5..0.5
fn uvOf(p: vec2f) -> vec2f {
    let n = (p - 0.5 * u.size) / max(min(u.size.x, u.size.y), 1.0);
    return vec2f(n.x, -n.y);
}
// one device pixel in CSS pixels (the antialias width)
fn aa() -> f32 { return 1.0 / max(u.pixelScale, 0.001); }
// snap a CSS length to whole device pixels, at least lo device pixels
fn snapPx(s: f32, lo: f32) -> f32 { return max(round(s * u.pixelScale), lo) / max(u.pixelScale, 0.001); }
// the cell pitch: base CSS px, scaled by a knob and the global pitch signal
fn pitchK(base: f32, kk: f32) -> f32 { return snapPx(base * mix(0.65, 1.5, kk) * u.pitch, 3.0); }
fn fmod(a: f32, b: f32) -> f32 { return a - b * floor(a / b); }
fn rot2(a: f32) -> mat2x2f { let c = cos(a); let s = sin(a); return mat2x2f(c, s, -s, c); }

// ── lattices: c is the cell center (CSS px), d = p - c, id the cell index ───
struct Cell { c: vec2f, d: vec2f, id: vec2f };
fn sqCell(p: vec2f, s: f32) -> Cell {
    let id = floor(p / s); let c = (id + 0.5) * s;
    return Cell(c, p - c, id);
}
fn hexCell(p: vec2f, s: f32) -> Cell {
    let r = vec2f(1.0, 1.7320508) * s; let h = 0.5 * r;
    let a = p - (floor(p / r) + 0.5) * r;
    let b = p - h - (floor((p - h) / r) + 0.5) * r;
    if (dot(a, a) < dot(b, b)) { return Cell(p - a, a, round((p - a) / h)); }
    return Cell(p - b, b, round((p - b) / h));
}
// a square screen turned by ang around the tile center; c comes back unturned
fn screenCell(p: vec2f, s: f32, ang: f32) -> Cell {
    let o = 0.5 * u.size;
    let q = rot2(ang) * (p - o);
    let id = floor(q / s); let cq = (id + 0.5) * s;
    let c = transpose(rot2(ang)) * cq + o;
    return Cell(c, rot2(ang) * (p - c), id);
}

// ── antialiased marks (IQ distance functions) ───────────────────────────────
fn discAA(d: vec2f, r: f32, w: f32) -> f32 { return clamp((r - length(d)) / w + 0.5, 0.0, 1.0); }
fn disc(d: vec2f, r: f32) -> f32 { return discAA(d, r, aa()); }
fn boxCov(d: vec2f, h: f32, rr: f32) -> f32 {
    let q = abs(d) - vec2f(h - rr);
    let sd = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - rr;
    return clamp(-sd / aa() + 0.5, 0.0, 1.0);
}
fn segDist(p: vec2f, a: vec2f, b: vec2f) -> vec2f {
    let pa = p - a; let ba = b - a;
    let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
    return vec2f(length(pa - ba * h), h);
}

// ── hashing and noise ───────────────────────────────────────────────────────
fn pcg2d(vin: vec2u) -> vec2u {
    var v = vin * 1664525u + 1013904223u;
    v.x += v.y * 1664525u; v.y += v.x * 1664525u;
    v = v ^ (v >> vec2u(16u));
    v.x += v.y * 1664525u; v.y += v.x * 1664525u;
    v = v ^ (v >> vec2u(16u));
    return v;
}
fn hash2(p: vec2f, seed: u32) -> vec2f {
    let q = pcg2d(vec2u(vec2i(floor(p)) + vec2i(32768)) ^ vec2u(seed * 747796405u, seed * 2891336453u + 1u));
    return vec2f(q) * (1.0 / 4294967295.0);
}
fn hash1(p: vec2f, seed: u32) -> f32 { return hash2(p, seed).x; }
fn gnoise(p: vec2f, seed: u32) -> f32 {
    let i = floor(p); let f = fract(p);
    let w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    let ga = hash2(i, seed) * 2.0 - 1.0;
    let gb = hash2(i + vec2f(1.0, 0.0), seed) * 2.0 - 1.0;
    let gc = hash2(i + vec2f(0.0, 1.0), seed) * 2.0 - 1.0;
    let gd = hash2(i + vec2f(1.0, 1.0), seed) * 2.0 - 1.0;
    let a = dot(ga, f); let b = dot(gb, f - vec2f(1.0, 0.0));
    let c = dot(gc, f - vec2f(0.0, 1.0)); let d = dot(gd, f - vec2f(1.0, 1.0));
    return mix(mix(a, b, w.x), mix(c, d, w.x), w.y) * 1.6;
}
fn fbm(p0: vec2f, oct: i32, seed: u32) -> f32 {
    var p = p0; var a = 0.5; var s = 0.0; var n = 0.0;
    for (var i: i32 = 0; i < 6; i++) { if (i >= oct) { break; } s += a * gnoise(p, seed + u32(i)); n += a; a *= 0.5; p = rot2(0.6) * p * 2.03; }
    return s / max(n, 1e-4);
}
fn fbm01(p: vec2f, oct: i32, seed: u32) -> f32 { return clamp(0.5 + 0.5 * fbm(p, oct, seed), 0.0, 1.0); }

// ── live fields, each 0..1 ──────────────────────────────────────────────────
// domain-warped fbm (Quilez)
fn warpF(uv: vec2f, t: f32) -> f32 {
    let p = uv * 2.2;
    let q = vec2f(fbm(p + vec2f(0.0, 0.1 * t), 4, 1u), fbm(p + vec2f(5.2, 1.3), 4, 2u));
    let r = vec2f(fbm(p + 3.0 * q + vec2f(1.7, 9.2) + 0.15 * t, 4, 3u), fbm(p + 3.0 * q + vec2f(8.3, 2.8) - 0.12 * t, 4, 4u));
    return clamp(0.5 + 0.8 * fbm(p + 3.0 * r, 4, 5u), 0.0, 1.0);
}
// a twisted vortex with a hot core
fn swirlF(uv: vec2f, t: f32, twist: f32) -> f32 {
    let r = length(uv);
    let a = atan2(uv.y, uv.x) + twist / (r + 0.25) - t * 0.6;
    let arms = 0.5 + 0.5 * sin(a * 3.0 + r * 9.0);
    let n = fbm01(rot2(a) * vec2f(r * 4.0, 0.0) + uv * 3.0, 3, 9u);
    return clamp(arms * smoothstep(0.62, 0.05, r) * (0.55 + 0.7 * n) + 0.35 * exp(-r * r * 30.0), 0.0, 1.0);
}
// a rising flame-like ramp
fn flameF(uv: vec2f, t: f32) -> f32 {
    let y = uv.y + 0.5;
    let q = vec2f(uv.x * 3.0, y * 2.6 - t * 1.4);
    let n = fbm01(q + vec2f(0.4 * fbm(q * 1.3, 3, 21u), 0.0), 5, 22u);
    let prof = 1.0 - smoothstep(0.0, 0.42 + 0.1 * y, abs(uv.x + 0.06 * sin(y * 5.0 + t * 2.0) * y));
    return clamp(prof * (1.25 - y) * (0.35 + 1.0 * n) - y * 0.15, 0.0, 1.0);
}
// classic sum-of-sines plasma
fn plasmaF(uv: vec2f, t: f32) -> f32 {
    let p = uv * 6.0;
    var v = sin(p.x + t) + sin(0.8 * p.y - 0.7 * t) + sin(0.6 * (p.x + p.y) + 0.9 * t);
    let c = p + vec2f(2.0 * sin(t * 0.33), 2.0 * cos(t * 0.41));
    v += sin(length(c) * 1.3 - t);
    return 0.5 + 0.125 * v;
}

// a heartbeat trace: P wave, QRS spike, T wave, repeated 1.6 times per unit
fn ecgY(x: f32, W: f32, tb: f32, noise: f32) -> f32 {
    let ph = fract((x + 0.5 * W) * 1.6);
    let e = 0.3 * exp(-pow((ph - 0.45) / 0.018, 2.0)) - 0.08 * exp(-pow((ph - 0.42) / 0.012, 2.0)) - 0.1 * exp(-pow((ph - 0.48) / 0.012, 2.0))
          + 0.06 * exp(-pow((ph - 0.25) / 0.03, 2.0)) + 0.09 * exp(-pow((ph - 0.7) / 0.05, 2.0));
    return 1.5 * e - 0.1 + mix(0.0, 0.03, noise) * gnoise(vec2f(x * 40.0, floor(tb * 2.0)), 77u);
}

// ── palette and finishers ───────────────────────────────────────────────────
fn ramp(v0: f32) -> vec3f {
    let v = clamp((v0 - 0.5) * u.contrast + 0.5, 0.0, 1.0);
    let a = mix(u.ink.rgb, u.tone.rgb, smoothstep(0.0, 0.55, v));
    return mix(a, u.cream.rgb, smoothstep(0.5, 1.0, v));
}
fn ground() -> vec3f { return u.ink.rgb; }
fn unlit() -> vec3f { return mix(u.ink.rgb, u.tone.rgb, 0.12); }
fn present(c: vec3f) -> vec4f { return vec4f(clamp(c * u.exposure, vec3f(0.0), vec3f(1.0)), 1.0); }
// a mark of coverage cov and brightness v on the ground
fn dotOn(cov: f32, v: f32) -> vec4f { return present(mix(ground(), ramp(v), cov)); }
// a square pixel: unlit pixels stay faint so the grid reads
fn pix(c: Cell, s: f32, v: f32) -> vec4f {
    let cov = boxCov(c.d, s * 0.42, s * 0.1);
    let lit = mix(unlit(), ramp(clamp(v, 0.0, 1.0)), clamp(v * 1.6, 0.0, 1.0));
    return present(mix(ground(), lit, cov));
}
// a round LED with a soft halo
fn led(c: Cell, s: f32, v: f32) -> vec3f {
    let r = length(c.d);
    let cov = disc(c.d, s * 0.36);
    let lit = mix(unlit(), ramp(v), clamp(v * 1.5, 0.0, 1.0));
    return mix(ground(), lit, cov) + ramp(v) * v * 0.35 * exp(-r * r / (s * s * 0.2));
}
// quantize v to n levels with threshold thr in 0..1
fn quant(v: f32, n: f32, thr: f32) -> f32 {
    let m = max(n - 1.0, 1.0);
    return clamp(floor(clamp(v, 0.0, 1.0) * m + thr) / m, 0.0, 1.0);
}

// ── dither thresholds ───────────────────────────────────────────────────────
// Bayer index built two bits per level: the 2x2 core is 0 2 / 3 1
fn bayer(ip: vec2u, levels: u32) -> f32 {
    var v = 0u;
    for (var i = 0u; i < levels; i++) {
        let bx = (ip.x >> i) & 1u; let by = (ip.y >> i) & 1u;
        v += (((bx ^ by) << 1u) | by) << (2u * (levels - 1u - i));
    }
    return (f32(v) + 0.5) / f32(1u << (2u * levels));
}
// interleaved gradient noise (Jimenez 2014)
fn ign(ip: vec2f) -> f32 { return fract(52.9829189 * fract(dot(ip, vec2f(0.06711056, 0.00583715)))); }
// a 4x4 clustered-dot matrix: the dot grows out from the center
var<private> CLUSTER: array<u32, 16> = array<u32, 16>(12u, 5u, 6u, 13u, 4u, 0u, 1u, 7u, 11u, 3u, 2u, 8u, 15u, 10u, 9u, 14u);

// ── 5x7 glyphs: bit (row * 5 + col) of a 35-bit word split into a vec2u ─────
var<private> GLYPHS: array<vec2u, 32> = array<vec2u, 32>(
    vec2u(2738546222u, 3u),
    vec2u(2286031044u, 3u),
    vec2u(3292807726u, 7u),
    vec2u(3775349263u, 3u),
    vec2u(301246856u, 2u),
    vec2u(2735225919u, 3u),
    vec2u(2736227374u, 3u),
    vec2u(2216829471u, 0u),
    vec2u(2736211502u, 3u),
    vec2u(2702132782u, 3u),
    vec2u(0u, 0u),
    vec2u(131072u, 0u),
    vec2u(138416256u, 0u),
    vec2u(1663026734u, 4u),
    vec2u(3809986095u, 3u),
    vec2u(2718991918u, 3u),
    vec2u(3810051631u, 3u),
    vec2u(3256321087u, 7u),
    vec2u(1108837439u, 0u),
    vec2u(2736686638u, 7u),
    vec2u(1663026737u, 4u),
    vec2u(2286030990u, 3u),
    vec2u(3255862305u, 7u),
    vec2u(1662703473u, 4u),
    vec2u(1662834289u, 4u),
    vec2u(2736309806u, 3u),
    vec2u(1381484079u, 4u),
    vec2u(3775333438u, 3u),
    vec2u(138547359u, 1u),
    vec2u(353945137u, 1u),
    vec2u(2874852913u, 2u),
    vec2u(1654794801u, 4u));
var<private> MSG0: array<u32, 32> = array<u32, 32>(27u, 28u, 17u, 22u, 22u, 13u, 10u, 24u, 25u, 29u, 13u, 10u, 11u, 10u, 16u, 25u, 28u, 10u, 18u, 21u, 17u, 22u, 16u, 10u, 28u, 13u, 14u, 22u, 17u, 10u, 11u, 10u);
var<private> MSG1: array<u32, 31> = array<u32, 31>(30u, 19u, 27u, 22u, 10u, 11u, 10u, 3u, 6u, 10u, 15u, 17u, 22u, 22u, 27u, 10u, 11u, 10u, 7u, 10u, 18u, 13u, 23u, 21u, 22u, 21u, 17u, 27u, 10u, 11u, 10u);
var<private> MSG2: array<u32, 29> = array<u32, 29>(20u, 13u, 22u, 18u, 28u, 25u, 24u, 17u, 10u, 11u, 10u, 16u, 21u, 28u, 20u, 17u, 26u, 10u, 11u, 10u, 23u, 13u, 28u, 26u, 21u, 31u, 10u, 11u, 10u);
fn glyphBit(g: u32, col: i32, row: i32) -> f32 {
    if (col < 0 || col > 4 || row < 0 || row > 6) { return 0.0; }
    let b = u32(row * 5 + col); let w = GLYPHS[g];
    let bit = select((w.y >> (b - 32u)) & 1u, (w.x >> b) & 1u, b < 32u);
    return f32(bit);
}

// ── the 36 cells ─────────────────────────────────────────────────────────────
@fragment fn fs_breath_hex(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let s = pitchK(8.0, k.x);
  let c = hexCell(p, s);
  let r = length(uvOf(c.c));
  let ph = t * mix(0.3, 0.9, k.w) - r * mix(0.8, 3.0, k.y);
  let w = clamp(sin(ph * TAU) * mix(1.5, 8.0, k.z), -1.0, 1.0) * 0.5 + 0.5;
  return dotOn(disc(c.d, s * mix(0.1, 0.47, w)), 0.3 + 0.7 * w);
}

@fragment fn fs_ripple_hex(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let s = pitchK(6.5, k.x);
  let c = hexCell(p, s);
  let r = length(uvOf(c.c));
  let wv = sin(r * mix(50.0, 18.0, k.y) - t * mix(2.0, 6.0, k.z));
  let a = 0.5 + 0.5 * wv * exp(-r * mix(0.3, 3.0, k.w));
  return dotOn(disc(c.d, s * 0.5 * mix(0.12, 0.98, a)), a);
}

@fragment fn fs_cross_waves(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let s = pitchK(7.0, k.x);
  let c = sqCell(p, s);
  let cu = uvOf(c.c);
  let a1 = mix(0.1, 1.2, k.y) + 0.1 * sin(t * 0.3);
  let d1 = vec2f(cos(a1), sin(a1)); let d2 = vec2f(cos(a1 + 2.1), sin(a1 + 2.1));
  let f = mix(10.0, 28.0, k.z);
  let w = 0.25 * (2.0 + sin(dot(cu, d1) * f - t * 2.3) + sin(dot(cu, d2) * f * 1.3 - t * 1.7));
  let h = s * 0.5 * mix(0.12, 0.96, w);
  return dotOn(boxCov(c.d, h, h * mix(0.1, 0.9, k.w)), 0.15 + 0.85 * w);
}

@fragment fn fs_standing_nodes(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let s = pitchK(7.0, k.x);
  let c = sqCell(p, s);
  let q = uvOf(c.c) + 0.5;
  let m = floor(mix(2.0, 6.0, k.y)); let n = m + 1.0;
  let w = t * mix(1.2, 3.5, k.z); let b = mix(0.45, 1.0, k.w);
  let a = sin(m * PI * q.x) * sin(n * PI * q.y) * cos(w) + b * sin(n * PI * q.x) * sin(m * PI * q.y) * sin(w);
  let v = clamp(a / max(abs(cos(w)) + b * abs(sin(w)), 0.5), -1.0, 1.0);
  return dotOn(disc(c.d, s * 0.5 * mix(0.1, 1.0, abs(v))), 0.5 + 0.5 * v);
}

@fragment fn fs_dot_lens(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let s = pitchK(6.0, k.x);
  let mn = min(u.size.x, u.size.y);
  let sp = mix(0.3, 1.0, k.w);
  let f = 0.5 * u.size + mn * 0.26 * vec2f(sin(t * 0.7 * sp + 0.6), sin(t * 1.1 * sp + 2.0));
  let rr = mn * mix(0.18, 0.36, k.z);
  let dd = p - f;
  let bump = exp(-dot(dd, dd) / (rr * rr));
  let sc = mix(1.0, mix(0.55, 0.25, k.y), bump);
  let q = f + dd * sc;
  let c = hexCell(q, s);
  let cov = discAA(c.d, s * mix(0.24, 0.42, bump), aa() * sc);
  return dotOn(cov, 0.25 + 0.75 * bump);
}

@fragment fn fs_parabola_band(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let s = pitchK(5.0, k.x);
  let c = sqCell(p, s);
  let cu = uvOf(c.c);
  let a = mix(1.0, 3.5, k.y);
  let f = a * cu.x * cu.x - 0.32 + 0.05 * sin(t * 0.9);
  let d = (cu.y - f) / sqrt(1.0 + 4.0 * a * a * cu.x * cu.x);
  let w = mix(0.015, 0.07, k.z);
  let shim = 0.55 + 0.45 * sin(t * 6.0 + hash1(c.id, 3u) * TAU);
  let band = exp(-d * d / (w * w)) * mix(1.0, shim, k.w);
  let inner = 0.28 * exp(-max(d, 0.0) * 7.0) * step(0.0, d) * (0.6 + 0.4 * hash1(c.id + floor(t * 3.0), 5u));
  return pix(c, s, band + inner);
}

@fragment fn fs_horizon_arc(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let s = pitchK(5.0, k.x);
  let c = sqCell(p, s);
  let cu = uvOf(c.c);
  let R = 1.4;
  let r = length(cu - vec2f(0.0, -R - mix(0.35, 0.05, k.y)));
  let d = r - R;
  var v = exp(-d * d / 0.0006) + mix(0.2, 0.55, k.w) * exp(-max(d, 0.0) * 9.0) * step(0.0, d);
  let n = floor(mix(2.0, 5.0, k.z));
  for (var i = 0.0; i < 5.0; i += 1.0) {
    if (i >= n) { break; }
    let a = fract(t * 0.35 + i / n);
    let pd = d - a * 0.9;
    v += (1.0 - a) * (1.0 - a) * exp(-pd * pd / 0.0012);
  }
  let below = step(d, 0.0) * 0.12 * fbm01(cu * 9.0 + vec2f(t * 0.1, 0.0), 3, 7u);
  return pix(c, s, v + below);
}

@fragment fn fs_sine_band(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let s = pitchK(5.0, k.x);
  let c = sqCell(p, s);
  let cu = uvOf(c.c);
  let sp = mix(0.4, 1.4, k.w);
  let x = cu.x * 8.0 + t * sp;
  let A = mix(0.08, 0.2, k.y);
  let f = A * sin(x) + A * 0.45 * sin(2.7 * x - t * 1.3 * sp);
  let g = A * 8.0 * cos(x) + A * 0.45 * 2.7 * 8.0 * cos(2.7 * x - t * 1.3 * sp);
  let d = (cu.y - f) / sqrt(1.0 + g * g);
  let w = mix(0.02, 0.07, k.z) * (0.8 + 0.3 * sin(t * 1.7 + cu.x * 3.0));
  let d2 = cu.y + f * 0.6 + 0.02;
  return pix(c, s, exp(-d * d / (w * w)) + 0.35 * exp(-d2 * d2 / (w * w * 0.5)));
}

@fragment fn fs_nested_arches(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let s = pitchK(5.0, k.x);
  let c = sqCell(p, s);
  let cu = uvOf(c.c);
  let a = mix(1.2, 3.0, k.z);
  let sp = mix(0.045, 0.1, 1.0 - k.y);
  let y = cu.y + 0.45 + a * cu.x * cu.x;
  let i = floor(y / sp + 0.5);
  let dl = (y / sp - i) * sp / sqrt(1.0 + 4.0 * a * a * cu.x * cu.x);
  let roll = 0.5 + 0.5 * sin(i * 0.9 - t * mix(1.5, 4.0, k.w));
  let band = exp(-dl * dl / 0.00018) * (0.25 + 0.85 * roll * roll) * step(0.5, i) * step(i, 9.5);
  return pix(c, s, band);
}

@fragment fn fs_lissajous_trace(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let s = pitchK(4.0, k.x);
  let c = sqCell(p, s);
  let cu = uvOf(c.c);
  let fa = 3.0; let fb = floor(mix(2.0, 5.0, k.y));
  let tail = mix(1.2, 3.5, k.z);
  let head = t * mix(0.4, 1.2, k.w) + 0.7;
  var v = 0.0;
  var prev = 0.38 * vec2f(sin(fa * (head - tail) + 0.5), sin(fb * (head - tail)));
  for (var i = 1; i <= 48; i++) {
    let ph = head - tail + tail * f32(i) / 48.0;
    let q = 0.38 * vec2f(sin(fa * ph + 0.5), sin(fb * ph));
    let sd = segDist(cu, prev, q);
    let age = 1.0 - f32(i) / 48.0;
    v = max(v, exp(-sd.x * sd.x / 0.0004) * pow(1.0 - age, 1.6));
    prev = q;
  }
  return pix(c, s, v * 1.15);
}

@fragment fn fs_trace_grid(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let s = pitchK(4.0, k.x);
  let c = sqCell(p, s);
  let L = 4.0;
  let onH = fmod(c.id.y, L) < 0.5; let onV = fmod(c.id.x, L) < 0.5;
  var v = 0.0; var base = 0.0;
  let busy = mix(0.25, 0.8, k.y); let sp = mix(0.4, 1.3, k.z);
  for (var dir = 0; dir < 2; dir++) {
    let on = select(onV, onH, dir == 0);
    if (!on) { continue; }
    let along = select(c.id.y, c.id.x, dir == 0);
    let line = select(c.id.x, c.id.y, dir == 0) / L;
    let slot = floor(along / 24.0); let lx = along - slot * 24.0;
    let h = hash2(vec2f(slot, line), 11u + u32(dir) * 7u);
    let h2 = hash2(vec2f(line, slot), 29u + u32(dir) * 5u);
    let a0 = floor(h.x * 10.0); let b0 = min(a0 + 5.0 + floor(h.y * 16.0), 23.0);
    base = max(base, 0.07);
    if (h2.x > busy) { continue; }
    let e = fract(t * sp / (1.5 + 2.5 * h2.y) + h2.x * 7.1);
    let headP = a0 + (b0 - a0) * clamp(e / 0.3, 0.0, 1.0);
    let hold = mix(0.35, 0.65, k.w);
    let life = select(1.0, exp(-(e - hold) * 9.0), e > hold);
    let inSeg = step(a0, lx) * step(lx, headP);
    let tip = exp(-abs(lx - headP) * 1.5) * step(e, 0.3);
    v = max(v, inSeg * life * 0.8 + tip * 0.6);
  }
  let pad = select(0.0, 0.18, onH && onV);
  return pix(c, s, max(v, base + pad));
}

@fragment fn fs_lattice_sparks(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let s = pitchK(3.5, k.x);
  let c = hexCell(p, s);
  let cu = uvOf(c.c);
  let Ls = 0.11;
  let e1 = vec2f(Ls, 0.0); let e2 = vec2f(0.5 * Ls, 0.8660254 * Ls);
  let nv = array<vec2f, 3>(vec2f(0.0, 1.0), vec2f(0.8660254, -0.5), vec2f(0.8660254, 0.5));
  var ed = 1.0;
  for (var j = 0; j < 3; j++) { let pr = dot(cu, nv[j]) / (0.8660254 * Ls); ed = min(ed, abs(fract(pr + 0.5) - 0.5) * 0.8660254 * Ls); }
  var v = 0.16 * exp(-ed * ed / 0.00003);
  let dirs = array<vec2f, 6>(e1, e2, e2 - e1, -e1, -e2, e1 - e2);
  let ns = i32(mix(4.0, 10.0, k.y));
  let tau = t * mix(2.0, 6.0, k.z) + 40.0;
  let n = floor(tau); let fr = fract(tau);
  let trail = mix(2.0, 7.0, k.w);
  for (var sI = 0; sI < 10; sI++) {
    if (sI >= ns) { break; }
    let fs = f32(sI);
    let ep = floor((n + fs * 3.0) / 20.0) * 20.0 - fs * 3.0;
    let h0 = hash2(vec2f(fs, ep), 71u);
    var node = floor((h0 - 0.5) * 8.0).x * e1 + floor((h0.y - 0.5) * 8.0) * e2;
    for (var j = 0; j < 21; j++) {
      let jj = ep + f32(j);
      if (jj > n) { break; }
      let hd = u32(hash1(vec2f(fs, jj), 83u) * 6.0) % 6u;
      let nxt = node + dirs[hd];
      if (jj >= n - trail) {
        let last = jj == n;
        let b = select(nxt, mix(node, nxt, fr), last);
        let sd = segDist(cu, node, b);
        let age = tau - jj - sd.y * select(1.0, fr, last);
        v += (exp(-sd.x * sd.x / 0.00025) + 0.35 * exp(-sd.x * sd.x / 0.002)) * exp(-age * 4.0 / trail) * 1.2;
      }
      node = nxt;
    }
  }
  let rad = s * mix(0.18, 0.5, clamp(v, 0.0, 1.0));
  return dotOn(disc(c.d, rad), clamp(v, 0.0, 1.0));
}

@fragment fn fs_sweep_front(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let s = pitchK(4.0, k.x);
  let c = sqCell(p, s);
  let cu = uvOf(c.c);
  let L = floor(mix(3.0, 6.0, k.y));
  let onH = fmod(c.id.y, L) < 0.5; let onV = fmod(c.id.x, L) < 0.5;
  if (!(onH || onV)) { return present(ground()); }
  let node = onH && onV;
  var v = 0.0;
  for (var i = 0; i < 2; i++) {
    let fi = f32(i);
    let a = 0.6 + fi * 1.9 + 0.15 * sin(t * 0.2 + fi);
    let dir = vec2f(cos(a), sin(a));
    let front = fract(t * mix(0.15, 0.4, k.z) + fi * 0.5) * 2.2 - 1.1;
    let behind = front - dot(cu, dir);
    let glow = select(0.0, exp(-behind * mix(7.0, 1.5, k.w)), behind > 0.0);
    v = max(v, glow + exp(-behind * behind / 0.0004) * 0.6);
  }
  let hn = hash1(c.id, 13u);
  v = v * select(0.55, 1.0 + hn * 0.4, node);
  return pix(c, s, max(v, select(0.1, 0.22, node)));
}

@fragment fn fs_bus_lines(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let s = pitchK(4.0, k.x);
  let c = sqCell(p, s);
  let ix = c.id.x; let iy = c.id.y;
  let rows = floor(u.size.y / s);
  let nl = floor(mix(3.0, 7.0, k.y));
  var v = 0.0;
  for (var b = 0; b < 2; b++) {
    let fb = f32(b);
    let base = floor(rows * (0.22 + 0.42 * fb));
    let X1 = floor(u.size.x / s * (0.28 + 0.1 * fb)); let X2 = X1 + floor(u.size.x / s * 0.34);
    let D = select(8.0, -7.0, b == 1);
    let off = sign(D) * (clamp(ix - X1, 0.0, abs(D)) - clamp(ix - X2, 0.0, abs(D)));
    let rel = iy - base - off;
    if (rel < 0.0 || rel > (nl - 1.0) * 2.0 || fmod(rel, 2.0) > 0.5) { continue; }
    let lane = rel / 2.0;
    let hs = hash2(vec2f(lane, fb), 41u);
    let sp = mix(8.0, 26.0, k.z) * (0.6 + 0.8 * hs.x) * select(1.0, -1.0, b == 1);
    let per = mix(40.0, 14.0, k.w) + floor(hs.y * 10.0);
    let q = fmod(ix - t * sp + hs.y * 50.0, per);
    let pk = step(q, 5.0) * (0.5 + 0.5 * q / 5.0);
    v = max(v, max(0.22, pk));
  }
  return pix(c, s, v);
}

@fragment fn fs_truchet_flow(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let s = pitchK(3.5, k.x);
  let c = hexCell(p, s);
  let cu = uvOf(c.c);
  let M = mix(0.16, 0.34, k.y);
  let g = cu / M;
  let id = floor(g); var f = fract(g) - 0.5;
  let flip = hash1(id, 17u) > 0.5;
  if (flip) { f.x = -f.x; }
  let d1 = length(f - vec2f(0.5, 0.5)); let d2 = length(f + vec2f(0.5, 0.5));
  let dd = min(abs(d1 - 0.5), abs(d2 - 0.5));
  let q = select(f + vec2f(0.5), f - vec2f(0.5), d1 < d2);
  let ang = atan2(q.y, q.x);
  let par = fmod(id.x + id.y, 2.0);
  let flow = 0.5 + 0.5 * sin(ang * 2.0 * select(1.0, -1.0, par > 0.5) * select(1.0, -1.0, flip) + t * mix(2.0, 6.0, k.z) + (id.x + id.y) * 1.3);
  let w = mix(0.06, 0.16, k.w);
  let band = exp(-dd * dd / (w * w));
  let v = band * (0.3 + 0.7 * flow * flow) + 0.04;
  return dotOn(disc(c.d, s * mix(0.12, 0.48, v)), v);
}

@fragment fn fs_sonar_rings(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let s = pitchK(6.0, k.x);
  let c = hexCell(p, s);
  let cu = uvOf(c.c);
  let r = length(cu - vec2f(0.0, -0.78));
  let n = floor(mix(2.0, 6.0, k.y));
  let w = mix(0.02, 0.07, k.w);
  var v = 0.0;
  for (var i = 0.0; i < 6.0; i += 1.0) {
    if (i >= n) { break; }
    let a = fract(t * mix(0.12, 0.35, k.z) + i / n);
    let rr = 0.15 + a * 1.35;
    let d = r - rr;
    v += exp(-d * d / (w * w)) * (1.0 - a) * (1.0 - a) * 1.2 + exp(-max(-d, 0.0) * 18.0) * step(d, 0.0) * 0.15 * (1.0 - a);
  }
  v = clamp(v * 1.3 + 0.08, 0.0, 1.0);
  return dotOn(disc(c.d, s * mix(0.14, 0.48, v)), v);
}

@fragment fn fs_raindrops(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let nb = floor(mix(3.0, 6.0, k.w));
  let bh = u.size.y / nb;
  let b = floor(p.y / bh);
  let s = pitchK(3.5 + 1.6 * (nb - 1.0 - b), k.x);
  let pl = vec2f(p.x, p.y - b * bh);
  let c = sqCell(pl, s);
  let cc = c.c + vec2f(0.0, b * bh);
  let edge = min(c.c.y - 0.5 * s, bh - c.c.y - 0.5 * s);
  if (edge < 0.0) { return present(ground()); }
  let cu = uvOf(cc);
  let M = 0.3; let g = cu / M; let gi = floor(g);
  var v = 0.05;
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let o = gi + vec2f(f32(x), f32(y));
    let h = hash2(o, 51u);
    if (h.x > mix(0.7, 1.01, k.y)) { continue; }
    let ctr = (o + 0.2 + 0.6 * h) * M;
    let a = fract(t * mix(0.25, 0.7, k.z) * (0.7 + 0.6 * h.y) + h.x * 5.0);
    let d = length(cu - ctr) - a * 0.42;
    v += exp(-d * d / 0.0006) * (1.0 - a) * 1.4 + exp(-dot(cu - ctr, cu - ctr) / 0.0004) * max(0.0, 1.0 - a * 8.0);
  } }
  v = clamp(v, 0.0, 1.0);
  return dotOn(disc(c.d, s * mix(0.16, 0.48, v)), v);
}

@fragment fn fs_ring_interference(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let s = pitchK(5.5, k.x);
  let c = hexCell(p, s);
  let cu = uvOf(c.c);
  let dsp = mix(0.08, 0.3, k.y);
  let s1 = vec2f(-dsp, 0.05 * sin(t * 0.4)); let s2 = vec2f(dsp, -0.05 * sin(t * 0.4));
  let kk = mix(60.0, 25.0, k.z); let w = t * mix(2.0, 6.0, k.w);
  let a = 0.5 * (cos(length(cu - s1) * kk - w) + cos(length(cu - s2) * kk - w));
  let v = 0.5 + 0.5 * a;
  return dotOn(disc(c.d, s * 0.5 * mix(0.08, 0.98, abs(a))), mix(0.25, 1.0, v));
}

@fragment fn fs_drop_pond(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let s = pitchK(6.0, k.x);
  let c = sqCell(p, s);
  let cu = uvOf(c.c);
  let e = 0.004;
  var hs = vec3f(0.0);
  let M = mix(0.6, 0.35, k.y);
  let gi = floor(cu / M);
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let o = gi + vec2f(f32(x), f32(y));
    let h = hash2(o, 61u);
    let ctr = (o + 0.15 + 0.7 * h) * M;
    let a = fract(t * mix(0.2, 0.55, k.z) + h.x * 3.7);
    let rr = a * 0.7;
    let amp = 1.4 * (1.0 - a);
    let q0 = length(cu - ctr) - rr; let qx = length(cu + vec2f(e, 0.0) - ctr) - rr; let qy = length(cu + vec2f(0.0, e) - ctr) - rr;
    hs += amp * vec3f(sin(q0 * 55.0) * exp(-q0 * q0 * 150.0), sin(qx * 55.0) * exp(-qx * qx * 150.0), sin(qy * 55.0) * exp(-qy * qy * 150.0));
  } }
  let gr = vec2f(hs.y - hs.x, hs.z - hs.x) / e * 0.01;
  let off = clamp(gr * s * mix(0.5, 2.5, k.w), vec2f(-0.3 * s), vec2f(0.3 * s));
  let lit = clamp(0.22 + hs.x * 0.7 + max(dot(gr, vec2f(-0.6, 0.8)), 0.0) * 2.5, 0.0, 1.0);
  return dotOn(disc(c.d + vec2f(off.x, -off.y), s * mix(0.14, 0.48, lit)), lit);
}

@fragment fn fs_warp_halftone(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let s = pitchK(6.0, k.x);
  let c = screenCell(p, s, mix(0.35, 1.22, k.y));
  let v = clamp((warpF(uvOf(c.c), t * mix(0.4, 1.6, k.w)) - 0.3) * mix(1.2, 2.4, k.z), 0.0, 1.0);
  return dotOn(disc(c.d, s * 0.7071 * sqrt(v)), 0.35 + 0.65 * v);
}

@fragment fn fs_cmy_rosette(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let s = pitchK(5.5, k.x);
  let tt = t * mix(0.3, 1.0, k.w);
  let tw = mix(1.0, 5.0, k.y);
  var col = mix(u.cream.rgb, vec3f(1.0), 0.3);
  let angs = array<f32, 3>(0.2618, 1.309, 0.0);
  let inks = array<vec3f, 3>(vec3f(0.0, 0.66, 0.9), vec3f(0.92, 0.16, 0.55), vec3f(1.0, 0.86, 0.05));
  let offs = array<f32, 3>(0.0, 2.1, 4.2);
  for (var i = 0; i < 3; i++) {
    let c = screenCell(p, s, angs[i]);
    let cu = uvOf(c.c);
    let v = swirlF(cu + 0.06 * vec2f(cos(offs[i] + tt), sin(offs[i] + tt)), tt + offs[i] * 0.2, tw) * mix(0.6, 1.1, k.z);
    let cov = disc(c.d, s * 0.62 * sqrt(clamp(v, 0.0, 1.0)));
    col *= mix(vec3f(1.0), inks[i], cov);
  }
  return present(col);
}

@fragment fn fs_band_halftone(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let s = pitchK(5.0, k.x);
  let c = screenCell(p, s, 0.5236);
  let cu = uvOf(c.c);
  let n = fbm(cu * 2.0 + vec2f(t * mix(0.05, 0.2, k.w), 0.0), 4, 31u);
  let f = n * mix(2.0, 6.0, k.y) + t * 0.2 + cu.y * 1.5;
  let v = pow(abs(fract(f) * 2.0 - 1.0), mix(0.6, 2.2, k.z));
  return dotOn(disc(c.d, s * 0.7071 * sqrt(v)), 0.2 + 0.8 * v);
}

@fragment fn fs_swirl_halftone(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let s = pitchK(5.5, k.x);
  let c = screenCell(p, s, 0.3 + t * mix(0.0, 0.25, k.z));
  let v = swirlF(uvOf(c.c), t, mix(0.5, 3.0, k.y));
  let r = s * mix(0.55, 0.78, k.w) * sqrt(v) + s * 0.05;
  return dotOn(disc(c.d, r), 0.2 + 0.8 * v);
}

@fragment fn fs_flame_halftone(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let s = pitchK(5.5, k.x);
  let c = screenCell(p, s, 0.0);
  let v = clamp(flameF(uvOf(c.c), t * mix(0.5, 1.4, k.z)) * mix(0.9, 1.6, k.w), 0.0, 1.0);
  let st = mix(1.0, 1.8, k.y);
  let q = c.d * vec2f(st, 1.0 / st);
  let r = s * 0.6 * sqrt(v);
  return dotOn(discAA(q, r, aa() * st), 0.15 + 0.85 * v);
}

@fragment fn fs_line_screen(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let s = pitchK(5.0, k.x);
  let o = 0.5 * u.size;
  let pr = rot2(mix(-0.8, 0.8, k.y)) * (p - o);
  let yy = pr.y + mix(0.0, 4.0, k.z) * sin(pr.x * 0.05 + t * 0.8);
  let li = floor(yy / s);
  let dl = yy - (li + 0.5) * s;
  let cc = transpose(rot2(mix(-0.8, 0.8, k.y))) * vec2f(pr.x, (li + 0.5) * s) + o;
  let v = warpF(uvOf(cc), t * mix(0.4, 1.6, k.w));
  let hw = s * 0.5 * clamp(v * 1.3 - 0.1, 0.02, 1.0);
  let cov = clamp((hw - abs(dl)) / aa() + 0.5, 0.0, 1.0);
  return dotOn(cov, 0.3 + 0.7 * v);
}

@fragment fn fs_bayer4_plasma(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let dp = snapPx(mix(1.5, 4.0, k.x) * u.pitch, 1.0);
  let ip = floor(p / dp);
  let v = plasmaF(uvOf((ip + 0.5) * dp), t * mix(0.4, 1.4, k.z));
  let q = quant(v, round(mix(2.0, 6.0, k.y)), bayer(vec2u(ip), 2u));
  return present(ramp(q));
}

@fragment fn fs_bayer8_orbs(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let dp = snapPx(mix(1.5, 4.0, k.x) * u.pitch, 1.0);
  let ip = floor(p / dp);
  let cu = uvOf((ip + 0.5) * dp);
  let tt = t * mix(0.4, 1.2, k.z);
  var fld = 0.0; var grad = vec2f(0.0);
  for (var i = 0; i < 4; i++) {
    let fi = f32(i);
    let ctr = 0.24 * vec2f(sin(tt * (0.7 + 0.2 * fi) + fi * 1.7), cos(tt * (0.9 - 0.1 * fi) + fi * 2.3));
    let d = cu - ctr; let e = 0.012 / (dot(d, d) + 0.002);
    fld += e; grad += -2.0 * d * e * e / 0.012;
  }
  let inside = smoothstep(0.9, 1.1, fld);
  let nrm = normalize(vec3f(-grad * 0.03, 1.0));
  let L = normalize(vec3f(mix(-0.8, 0.8, k.w), 0.6, 0.7));
  let sh = inside * (0.15 + 0.85 * max(dot(nrm, L), 0.0)) + (1.0 - inside) * 0.08 * (0.5 + cu.y);
  let q = quant(sh, round(mix(2.0, 6.0, k.y)), bayer(vec2u(ip), 3u));
  return present(ramp(q));
}

@fragment fn fs_ign_clouds(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let dp = snapPx(mix(1.0, 3.5, k.x) * u.pitch, 1.0);
  let ip = floor(p / dp);
  let cu = uvOf((ip + 0.5) * dp);
  let n = fbm01(cu * 3.0 + vec2f(t * mix(0.05, 0.25, k.z), 0.02 * t), 5, 41u);
  let v = smoothstep(mix(0.6, 0.25, k.w), 0.85, n) * 0.85 + (0.5 - cu.y) * 0.15;
  let q = quant(v, round(mix(2.0, 5.0, k.y)), ign(ip));
  return present(ramp(q));
}

@fragment fn fs_diffusion_look(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let dp = snapPx(mix(1.0, 3.5, k.x) * u.pitch, 1.0);
  let ip = floor(p / dp);
  let cu = uvOf((ip + 0.5) * dp);
  let r2 = dot(cu, cu) / 0.16;
  var sh = 0.03 + 0.1 * (0.5 - cu.y);
  if (r2 < 1.0) {
    let n = vec3f(cu / 0.4, sqrt(1.0 - r2));
    let a = t * mix(0.3, 1.2, k.z);
    let L = normalize(vec3f(cos(a), 0.5, sin(a) + 0.6));
    let tex = fbm01(vec2f(atan2(n.x, n.z) * 1.6 + a * 0.5, n.y * 2.0), 4, 47u);
    sh = max(dot(n, L), 0.0) * (0.55 + 0.6 * tex) + 0.04;
  }
  let w0 = hash1(ip, 91u);
  let wn = 0.25 * (hash1(ip + vec2f(1.0, 0.0), 91u) + hash1(ip - vec2f(1.0, 0.0), 91u) + hash1(ip + vec2f(0.0, 1.0), 91u) + hash1(ip - vec2f(0.0, 1.0), 91u));
  let thr = clamp(0.5 + (w0 - wn) * mix(1.0, 1.8, k.w), 0.0, 1.0);
  let q = quant(sh, round(mix(2.0, 4.0, k.y)), thr);
  return present(ramp(q));
}

@fragment fn fs_two_vs_seven(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let dp = snapPx(mix(1.5, 4.0, k.x) * u.pitch, 1.0);
  let ip = floor(p / dp);
  let cu = uvOf((ip + 0.5) * dp);
  let tt = t * mix(0.3, 1.0, k.z);
  let v = clamp(0.5 + 0.5 * sin(length(cu - vec2f(0.1, 0.15)) * 9.0 - tt * 1.5) * 0.6 + fbm(cu * 2.5 + tt * 0.1, 3, 53u) * 0.45 + cu.y * 0.2, 0.0, 1.0);
  let bx = mix(-0.25, 0.25, k.y) + 0.12 * sin(cu.y * 5.0 + tt) + 0.1 * sin(tt * 0.6);
  let side = cu.x - bx;
  let q = quant(v, select(7.0, 2.0, side < 0.0), bayer(vec2u(ip), 3u));
  var col = ramp(q);
  let lw = abs(side) * min(u.size.x, u.size.y);
  col = mix(col, u.cream.rgb, clamp(1.5 - lw / max(dp, aa()), 0.0, 1.0) * 0.8);
  return present(col);
}

@fragment fn fs_clustered_dot(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let dp = snapPx(mix(1.0, 3.0, k.x) * u.pitch, 1.0);
  let ip = floor(p / dp);
  let cu = uvOf((ip + 0.5) * dp);
  let a = t * mix(0.2, 0.8, k.z);
  let g = 0.5 + 0.9 * dot(cu, vec2f(cos(a), sin(a)));
  let v = clamp(g * (0.75 + 0.35 * fbm01(cu * 4.0 + a, 3, 57u)), 0.0, 1.0);
  let ix = u32(ip.x) % 4u; let iy = u32(ip.y) % 4u;
  let thr = (f32(CLUSTER[iy * 4u + ix]) + 0.5) / 16.0;
  let q = quant(v, round(mix(2.0, 4.0, k.y)), thr);
  return present(ramp(q));
}

@fragment fn fs_noise_matrix(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let s = pitchK(6.5, k.x);
  let c = sqCell(p, s);
  let cu = uvOf(c.c);
  let n = fbm01(cu * mix(1.5, 4.5, k.w) + vec2f(t * mix(0.1, 0.4, k.z), -t * 0.07), 4, 61u);
  let v = quant(smoothstep(0.3, 0.8, n), round(mix(3.0, 8.0, k.y)), 0.5);
  return present(led(c, s, v));
}

@fragment fn fs_marquee(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let s = pitchK(4.0, k.x);
  let c = sqCell(p, s);
  let rows = floor(u.size.y / s);
  let row0 = floor(rows * 0.5) - 13.0;
  let line = floor((c.id.y - row0) / 9.0);
  let ry = i32(c.id.y - row0 - line * 9.0) - 1;
  var v = 0.0;
  if (line >= 0.0 && line < 3.0) {
    let sp = mix(6.0, 20.0, k.y) * (1.0 + 0.3 * line) * select(1.0, -1.0, line == 1.0);
    let col = c.id.x + floor(t * sp) + 17.0 * line;
    let li = u32(line);
    var len = 32.0;
    if (li == 1u) { len = 31.0; } else if (li == 2u) { len = 29.0; }
    let ch = fmod(floor(col / 6.0), len);
    let cx = i32(fmod(col, 6.0));
    var g = MSG0[u32(ch) % 32u];
    if (li == 1u) { g = MSG1[u32(ch) % 31u]; } else if (li == 2u) { g = MSG2[u32(ch) % 29u]; }
    v = glyphBit(g, cx, ry) * (0.75 + 0.25 * line / 2.0);
  }
  return present(led(c, s, v));
}

@fragment fn fs_spectrum_bars(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let s = pitchK(5.0, k.x);
  let c = sqCell(p, s);
  let cols = floor(u.size.x / s); let rows = floor(u.size.y / s);
  let bw = floor(mix(2.0, 4.0, 1.0 - k.y));
  let band = floor(c.id.x / (bw + 1.0));
  let gap = fmod(c.id.x, bw + 1.0) > bw - 0.5;
  let hy = rows - 2.0 - c.id.y;
  if (gap || hy < 0.0 || c.id.y < 1.0) { return present(led(c, s, 0.0) * 0.6); }
  let nb = floor(cols / (bw + 1.0));
  let x = band / max(nb, 1.0);
  let tt = t * mix(1.0, 3.0, k.z);
  var peak = 0.0; var lvl = 0.0;
  for (var j = 0; j < 10; j++) {
    let tj = tt - f32(j) * 0.12;
    let beat = pow(0.5 + 0.5 * sin(tj * 2.2), 4.0);
    let l = clamp((0.85 - 0.6 * x) * (0.35 + 0.45 * fbm01(vec2f(band * 0.9, tj * 1.3), 3, 71u) + beat * (0.5 - 0.4 * x)), 0.0, 1.0);
    if (j == 0) { lvl = l; }
    peak = max(peak, l - f32(j) * f32(j) * mix(0.001, 0.006, k.w));
  }
  let top = rows - 3.0;
  let lit = hy < floor(lvl * top);
  let isPeak = abs(hy - floor(peak * top)) < 0.5;
  let v = select(0.0, 0.4 + 0.6 * hy / top, lit);
  return present(led(c, s, select(v, 1.0, isPeak && !lit)));
}

@fragment fn fs_led_clock(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let cols = 27.0;
  let s = snapPx(min(u.size.x / (cols + 2.0), 8.0 * u.pitch), 3.0);
  let c = sqCell(p - vec2f(0.5 * (u.size.x - cols * s), 0.5 * (u.size.y - 7.0 * s)), s);
  let secs = floor(t * mix(1.0, 30.0, k.x) + 754.0);
  let x = i32(c.id.x); let y = i32(c.id.y);
  var v = 0.0;
  if (y >= 0 && y < 7 && x >= 0 && x < 27) {
    let mm = u32(secs / 60.0) % 100u; let ss = u32(secs) % 60u;
    // column starts: digit 0, digit 6, colon 12 (glyph cols 1..3), digit 16, digit 22
    var g = 0u + mm / 10u; var gx = x; var slot = 0;
    if (x >= 6) { g = 0u + mm % 10u; gx = x - 6; }
    if (x >= 11) { g = 12u; gx = x - 11; slot = 2; }
    if (x >= 16) { g = 0u + ss / 10u; gx = x - 16; slot = 3; }
    if (x >= 22) { g = 0u + ss % 10u; gx = x - 22; }
    v = glyphBit(g, gx, y);
    if (slot == 2) { v *= mix(1.0, step(0.5, fract(t * mix(1.0, 30.0, k.x))), k.y) * 0.9 + 0.1 * (1.0 - k.y); }
  }
  return present(led(c, s, v));
}

@fragment fn fs_scope_trace(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = px(fp.xy);
  let uv = uvOf(p);
  let t = u.time;
  let k = u.k;
  let s = pitchK(4.0, k.x);
  let c = sqCell(p, s);
  let cu = uvOf(c.c);
  let W = u.size.x / min(u.size.x, u.size.y);
  let sweep = fract(t * mix(0.2, 0.6, k.y)) * W - 0.5 * W;
  let age = fract((sweep - cu.x) / W);
  let tb = t * mix(0.2, 0.6, k.y) - age;
  let hs = 0.5 * s / min(u.size.x, u.size.y);
  let y0 = ecgY(cu.x - hs, W, tb, k.w); let y1 = ecgY(cu.x + hs, W, tb, k.w);
  let d = max(max(min(y0, y1) - cu.y, cu.y - max(y0, y1)), 0.0);
  let tr = exp(-d * d / 0.0004) * exp(-age * mix(3.0, 0.6, k.z)) * 1.3 + exp(-d * d / 0.004) * exp(-age * 12.0) * 0.4;
  let grid = select(0.0, 0.05, fmod(c.id.x, 8.0) < 0.5 || fmod(c.id.y, 8.0) < 0.5);
  return present(led(c, s, clamp(tr * 1.2 + grid, 0.0, 1.0)));
}
