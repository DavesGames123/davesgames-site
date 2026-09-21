// ═══════════════════════════════════════════════════════════════════════════
//  HEAT DIFFRACTION TABLE  ·  one fragment operator per cell. Every cell reads
//  the shared source image through src(uv) and returns the image as hot air
//  bends it. u.energy scales the displacement (the fire's energy level); u.zoom
//  crops the source. Displacement fields: rising haze shimmer, curl-of-fbm
//  turbulent air, a schlieren gradient, hot plumes and radial cores. Noise
//  after Perlin (pcg3d hashing).
// ═══════════════════════════════════════════════════════════════════════════
struct HeatU {
    size: vec2f, time: f32, pixelScale: f32,
    ink: vec4f, tone: vec4f, cream: vec4f,
    energy: f32, zoom: f32, pad0: f32, pad1: f32,
    k: vec4f,
}
@group(0) @binding(0) var<uniform> u: HeatU;
@group(0) @binding(1) var srcTex: texture_2d<f32>;
@group(0) @binding(2) var srcSmp: sampler;

const PI: f32 = 3.14159265358979;
const TAU: f32 = 6.28318530717959;

@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(p[i], 0.0, 1.0);
}
fn cell_uv(fp: vec2f) -> vec2f {
    let pos = fp / max(u.pixelScale, 0.001);
    let c = (pos - 0.5 * u.size) / max(min(u.size.x, u.size.y), 1.0);
    return c / u.zoom + 0.5;
}
fn src(uv: vec2f) -> vec3f { return textureSampleLevel(srcTex, srcSmp, uv, 0.0).rgb; }
fn out(c: vec3f) -> vec4f { return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), 1.0); }
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
fn ramp(v: f32) -> vec3f { let lo = mix(u.ink.rgb, u.tone.rgb, smoothstep(0.0, 0.6, v)); return mix(lo, u.cream.rgb, smoothstep(0.6, 1.0, v)); }

// ── Perlin noise and fractal sums ───────────────────────────────────────────
fn fade2(t: vec2f) -> vec2f { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
fn pcg3d(vin: vec3u) -> vec3u {
    var v = vin * 1664525u + 1013904223u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    v ^= v >> vec3u(16u);
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    return v;
}
fn h3(p: vec3i, seed: u32) -> vec3f {
    let q = pcg3d(vec3u(p + vec3i(32768)) ^ vec3u(seed, seed * 3u + 1u, seed * 7u + 5u));
    return vec3f(q) * (1.0 / 4294967295.0);
}
fn h21(p: vec2i, seed: u32) -> f32 { return h3(vec3i(p, 0), seed).x; }
fn grad2(i: vec2i, seed: u32) -> vec2f { let a = h21(i, seed) * TAU; return vec2f(cos(a), sin(a)); }
fn pnoise(p: vec2f, seed: u32) -> f32 {
    let i = vec2i(floor(p)); let f = fract(p); let w = fade2(f);
    let a = dot(grad2(i, seed), f);
    let b = dot(grad2(i + vec2i(1, 0), seed), f - vec2f(1.0, 0.0));
    let c = dot(grad2(i + vec2i(0, 1), seed), f - vec2f(0.0, 1.0));
    let d = dot(grad2(i + vec2i(1, 1), seed), f - vec2f(1.0, 1.0));
    return mix(mix(a, b, w.x), mix(c, d, w.x), w.y) * 1.414;
}
fn rot2(a: f32) -> mat2x2f { let c = cos(a); let s = sin(a); return mat2x2f(c, s, -s, c); }
fn fbm(p0: vec2f, oct: i32, seed: u32) -> f32 {
    var p = p0; var a = 0.5; var s = 0.0; var nrm = 0.0;
    for (var i: i32 = 0; i < 8; i++) { if (i >= oct) { break; } s += a * pnoise(p, seed + u32(i)); nrm += a; a *= 0.5; p = rot2(0.5) * p * 2.0; }
    return s / max(nrm, 1e-4);
}

// ── displacement fields ─────────────────────────────────────────────────────
// rising heat haze: horizontal shimmer that grows with height
fn hazeD(uv: vec2f, t: f32, sc: f32) -> vec2f {
    let h = smoothstep(0.0, 1.0, uv.y);
    let x = sin(uv.y * sc * 9.0 + t * 3.0) * 0.6 + sin(uv.y * sc * 15.0 - t * 2.0) * 0.4
          + fbm(vec2f(uv.x * sc * 4.0, uv.y * sc * 4.0 - t * 1.6), 3, 7u) * 0.7;
    let y = fbm(vec2f(uv.x * sc * 4.0 + 3.0, uv.y * sc * 4.0 - t * 1.6), 3, 13u) * 0.3;
    return vec2f(x, y) * h;
}
// curl of an fbm field: divergence-free turbulent air, rising
fn curlD(uv: vec2f, t: f32, sc: f32, seed: u32) -> vec2f {
    let p = uv * sc + vec2f(0.0, -t * 0.4);
    let e = 0.015;
    let n1 = fbm(p + vec2f(0.0, e), 4, seed); let n2 = fbm(p - vec2f(0.0, e), 4, seed);
    let n3 = fbm(p + vec2f(e, 0.0), 4, seed); let n4 = fbm(p - vec2f(e, 0.0), 4, seed);
    return vec2f(n1 - n2, -(n3 - n4)) / (2.0 * e);
}
// gradient of a slow heat field: the schlieren density gradient
fn heatGrad(uv: vec2f, t: f32, sc: f32, seed: u32) -> vec2f {
    let e = 0.01;
    let f0 = fbm(vec2f(uv.x * sc, uv.y * sc - t * 0.5), 4, seed);
    let fx = fbm(vec2f((uv.x + e) * sc, uv.y * sc - t * 0.5), 4, seed) - f0;
    let fy = fbm(vec2f(uv.x * sc, (uv.y + e) * sc - t * 0.5), 4, seed) - f0;
    return vec2f(fx, fy) / e;
}
fn sheets(p0: vec2f, t: f32) -> f32 {
    var q = p0; var s = 0.0;
    for (var i: i32 = 0; i < 4; i++) {
        q = rot2(0.9) * q + vec2f(sin(t * 0.7 + f32(i)), cos(t * 0.5 - f32(i))) * 0.4;
        s += abs(sin(q.x * 2.0 + t) + sin(q.y * 2.3 - t * 0.8));
    }
    return pow(clamp(1.0 - s * 0.1, 0.0, 1.0), 3.0);
}
fn warp(uv: vec2f, d: vec2f) -> vec3f { return src(uv + d); }
fn chroma(uv: vec2f, d: vec2f, ca: f32) -> vec3f {
    return vec3f(src(uv + d * (1.0 - ca)).r, src(uv + d).g, src(uv + d * (1.0 + ca)).b);
}
fn blurSample(uv: vec2f, r: f32) -> vec3f {
    var c = vec3f(0.0);
    for (var i: i32 = 0; i < 8; i++) { let a = f32(i) * 2.399963; let rr = sqrt((f32(i) + 0.5) / 8.0); c += src(uv + vec2f(cos(a), sin(a)) * rr * r); }
    return c / 8.0;
}

// ── the 60 heat operators ────────────────────────────────────────────────────
@fragment fn fs_rising_haze(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let d = hazeD(uv, t, mix(0.6, 1.4, k.x)) * (0.012 + 0.05 * k.y) * E;
  return out(warp(uv, d));
}

@fragment fn fs_dense_haze(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let d = hazeD(uv, t, mix(0.4, 0.9, k.x)) * (0.03 + 0.06 * k.y) * E;
  return out(warp(uv, d));
}

@fragment fn fs_fine_haze(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let d = hazeD(uv, t, mix(1.4, 2.6, k.x)) * (0.008 + 0.03 * k.y) * E;
  return out(warp(uv, d));
}

@fragment fn fs_haze_chroma(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let d = hazeD(uv, t, mix(0.6, 1.4, k.x)) * 0.03 * E;
  return out(chroma(uv, d, mix(0.1, 0.5, k.y)));
}

@fragment fn fs_ground_haze(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let m = smoothstep(0.7, 0.0, uv.y);
  let d = hazeD(vec2f(uv.x, 1.0 - uv.y), t, mix(0.6, 1.4, k.x)) * (0.02 + 0.05 * k.y) * E * m;
  return out(warp(uv, d));
}

@fragment fn fs_wall_haze(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let x = sin(uv.y * mix(8.0, 20.0, k.x) + t * 3.0) + fbm(uv * mix(3.0, 6.0, k.x) - vec2f(0.0, t), 3, 7u);
  let d = vec2f(x, 0.0) * (0.01 + 0.03 * k.y) * E;
  return out(warp(uv, d));
}

@fragment fn fs_gusty_haze(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let g = vec2f(sin(t * 0.7 + uv.y * 3.0) * mix(0.0, 0.02, k.y), 0.0);
  let d = hazeD(uv, t, mix(0.6, 1.3, k.x)) * 0.025 * E + g * E;
  return out(warp(uv, d));
}

@fragment fn fs_layered_haze(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let d = (hazeD(uv, t, mix(0.5, 1.0, k.x)) + hazeD(uv, t * 1.3 + 4.0, mix(1.5, 2.5, k.x)) * 0.5) * (0.015 + 0.04 * k.y) * E;
  return out(warp(uv, d));
}

@fragment fn fs_mirage_floor(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let y0 = mix(0.3, 0.55, k.x);
  var s = uv;
  if (uv.y < y0) { s.y = y0 + (y0 - uv.y) * 0.7; }
  let m = smoothstep(y0 + 0.15, y0 - 0.1, uv.y);
  s += hazeD(uv, t, 1.0) * (0.02 + 0.05 * k.y) * E * m;
  return out(warp(s, vec2f(0.0)));
}

@fragment fn fs_mirage_road(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let y0 = mix(0.35, 0.6, k.x);
  let m = exp(-abs(uv.y - y0) * 7.0);
  let d = vec2f(sin(uv.x * 20.0 + t * 4.0) + fbm(uv * 5.0 - vec2f(0.0, t), 3, 7u), 0.0) * (0.02 + 0.06 * k.y) * E * m;
  return out(warp(uv, d));
}

@fragment fn fs_mirage_pool(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let y0 = mix(0.3, 0.5, k.x);
  var s = uv;
  if (uv.y < y0) { s.y = y0 + (y0 - uv.y) * 0.5; }
  let m = smoothstep(y0, 0.0, uv.y);
  s += hazeD(uv, t, 1.2) * 0.04 * E * m;
  let c = mix(warp(s, vec2f(0.0)), u.cream.rgb, m * 0.15 * E);
  return out(c);
}

@fragment fn fs_mirage_chroma(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let y0 = mix(0.35, 0.55, k.x);
  var s = uv;
  if (uv.y < y0) { s.y = y0 + (y0 - uv.y) * 0.7; }
  let m = exp(-abs(uv.y - y0) * 6.0);
  let d = hazeD(uv, t, 1.0) * 0.03 * E * (0.3 + m);
  return out(chroma(s, d, mix(0.1, 0.5, k.y)));
}

@fragment fn fs_mirage_inverted(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let y0 = mix(0.5, 0.7, k.x);
  var s = uv;
  if (uv.y > y0) { s.y = y0 - (uv.y - y0) * 0.7; }
  let m = smoothstep(y0 - 0.15, y0 + 0.1, uv.y);
  s += hazeD(uv, t, 1.0) * (0.02 + 0.05 * k.y) * E * m;
  return out(warp(s, vec2f(0.0)));
}

@fragment fn fs_mirage_double(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let g = mix(0.15, 0.3, k.x);
  let m1 = exp(-abs(uv.y - (0.5 - g)) * 8.0); let m2 = exp(-abs(uv.y - (0.5 + g)) * 8.0);
  let d = vec2f(sin(uv.x * 18.0 + t * 3.5), 0.0) * (0.02 + 0.05 * k.y) * E * (m1 + m2);
  return out(warp(uv, d));
}

@fragment fn fs_mirage_soft(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let y0 = mix(0.35, 0.55, k.x);
  let m = exp(-abs(uv.y - y0) * 4.0);
  let d = hazeD(uv, t, 0.8) * (0.008 + 0.02 * k.y) * E * (0.3 + m);
  return out(warp(uv, d));
}

@fragment fn fs_schlieren_h(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let g = heatGrad(uv, t, mix(2.0, 5.0, k.x), 7u);
  let sh = clamp(0.5 + g.x * mix(0.2, 0.6, k.y) * E, 0.0, 1.0);
  return out(warp(uv, g * 0.006 * E) * mix(0.5, 1.5, sh));
}

@fragment fn fs_schlieren_v(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let g = heatGrad(uv, t, mix(2.0, 5.0, k.x), 11u);
  let sh = clamp(0.5 + g.y * mix(0.2, 0.6, k.y) * E, 0.0, 1.0);
  return out(warp(uv, g * 0.006 * E) * mix(0.5, 1.5, sh));
}

@fragment fn fs_schlieren_edge(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let g = heatGrad(uv, t, mix(2.0, 5.0, k.x), 7u);
  let mag = length(g) * mix(0.1, 0.4, k.y) * E;
  return out(warp(uv, g * 0.005 * E) * (1.0 + mag));
}

@fragment fn fs_schlieren_color(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let g = heatGrad(uv, t, mix(2.0, 5.0, k.x), 13u);
  let s = clamp(0.5 + g.x * 0.4 * E, 0.0, 1.0);
  return out(mix(warp(uv, g * 0.006 * E), ramp(s), mix(0.2, 0.7, k.y)));
}

@fragment fn fs_shadowgraph(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let g = heatGrad(uv, t, mix(2.5, 6.0, k.x), 7u);
  let d2 = length(heatGrad(uv + vec2f(0.01, 0.0), t, mix(2.5, 6.0, k.x), 7u) - g);
  return out(warp(uv, g * 0.005 * E) * (1.0 - clamp(d2 * mix(1.0, 4.0, k.y) * E, 0.0, 0.8)));
}

@fragment fn fs_schlieren_plume(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let m = exp(-(uv.x - 0.5) * (uv.x - 0.5) / (mix(0.02, 0.08, k.y)));
  let g = heatGrad(vec2f(uv.x, uv.y - t * 0.3), t, mix(3.0, 6.0, k.x), 7u);
  let sh = clamp(0.5 + g.x * 0.5 * E, 0.0, 1.0);
  return out(warp(uv, g * 0.006 * E * m) * mix(1.0, mix(0.5, 1.5, sh), m));
}

@fragment fn fs_schlieren_radial(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let pc = vec2f(0.5, mix(0.35, 0.6, k.x));
  let g = heatGrad(uv, t, 4.0, 7u);
  let r = length(uv - pc);
  let m = exp(-r * r * 6.0);
  let sh = clamp(0.5 + dot(g, normalize(uv - pc + 1e-4)) * mix(0.3, 0.7, k.y) * E, 0.0, 1.0);
  return out(warp(uv, g * 0.006 * E * m) * mix(0.6, 1.4, sh * m + (1.0 - m) * 0.5));
}

@fragment fn fs_hot_column(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let m = exp(-(uv.x - 0.5) * (uv.x - 0.5) / mix(0.02, 0.1, k.x));
  let d = hazeD(uv, t, 1.2) * (0.02 + 0.06 * k.y) * E * m;
  return out(warp(uv, d));
}

@fragment fn fs_twin_columns(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let g = mix(0.15, 0.3, k.x);
  let m = exp(-(uv.x - 0.5 - g) * (uv.x - 0.5 - g) / 0.02) + exp(-(uv.x - 0.5 + g) * (uv.x - 0.5 + g) / 0.02);
  let d = hazeD(uv, t, 1.3) * (0.02 + 0.05 * k.y) * E * m;
  return out(warp(uv, d));
}

@fragment fn fs_candle_heat(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let m = exp(-(uv.x - 0.5) * (uv.x - 0.5) / mix(0.006, 0.03, k.x));
  let d = hazeD(uv, t, 1.6) * (0.02 + 0.06 * k.y) * E * m;
  return out(warp(uv, d));
}

@fragment fn fs_chimney_heat(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let w = mix(0.02, 0.08, k.x) * (0.4 + uv.y);
  let m = exp(-(uv.x - 0.5) * (uv.x - 0.5) / w);
  let d = hazeD(uv, t, 1.1) * (0.02 + 0.05 * k.y) * E * m;
  return out(warp(uv, d));
}

@fragment fn fs_plume_chroma(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let m = exp(-(uv.x - 0.5) * (uv.x - 0.5) / mix(0.02, 0.08, k.x));
  let d = hazeD(uv, t, 1.2) * 0.04 * E * m;
  return out(chroma(uv, d, mix(0.1, 0.5, k.y)));
}

@fragment fn fs_plume_lean(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let cx = 0.5 + mix(0.0, 0.25, k.y) * uv.y;
  let m = exp(-(uv.x - cx) * (uv.x - cx) / mix(0.02, 0.08, k.x));
  let d = hazeD(uv, t, 1.2) * 0.04 * E * m;
  return out(warp(uv, d));
}

@fragment fn fs_plume_blur(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let m = exp(-(uv.x - 0.5) * (uv.x - 0.5) / mix(0.02, 0.1, k.x));
  let d = hazeD(uv, t, 1.2) * 0.03 * E * m;
  let b = blurSample(uv + d, mix(1.0, 4.0, k.y) * m * E / 512.0);
  return out(mix(warp(uv, d), b, m));
}

@fragment fn fs_plume_pulse(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let pulse = 0.6 + 0.5 * sin(uv.y * 6.0 - t * mix(2.0, 5.0, k.y));
  let m = exp(-(uv.x - 0.5) * (uv.x - 0.5) / mix(0.02, 0.08, k.x));
  let d = hazeD(uv, t, 1.2) * 0.04 * E * m * pulse;
  return out(warp(uv, d));
}

@fragment fn fs_hot_core(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let pc = vec2f(0.5, mix(0.4, 0.6, k.x));
  let v = uv - pc; let r = length(v);
  let bloom = exp(-r * r / mix(0.05, 0.2, k.x));
  let d = v * bloom * (0.1 + 0.3 * k.y) * E;
  return out(warp(uv, -d) + vec3f(0.1, 0.04, 0.0) * bloom * E * 0.3);
}

@fragment fn fs_core_chroma(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let pc = vec2f(0.5, 0.5);
  let v = uv - pc; let r = length(v);
  let bloom = exp(-r * r / mix(0.05, 0.25, k.x));
  let d = v * bloom * 0.2 * E;
  return out(chroma(uv, -d, mix(0.1, 0.6, k.y)));
}

@fragment fn fs_core_pulse(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let pc = vec2f(0.5, 0.5);
  let v = uv - pc; let r = length(v);
  let pulse = 0.6 + 0.4 * sin(t * mix(1.5, 4.0, k.y) - r * 12.0);
  let bloom = exp(-r * r / mix(0.05, 0.2, k.x));
  let d = v * bloom * 0.2 * E * pulse;
  return out(warp(uv, -d) + ramp(bloom * pulse) * bloom * 0.2 * E);
}

@fragment fn fs_shock_ring(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let pc = vec2f(0.5, 0.5);
  let v = uv - pc; let r = length(v);
  let rad = fract(t * mix(0.15, 0.4, k.x)) * 0.6;
  let ring = exp(-(r - rad) * (r - rad) / mix(0.001, 0.01, k.y));
  let d = normalize(v + 1e-4) * ring * 0.08 * E;
  return out(warp(uv, d) * (1.0 + ring * E));
}

@fragment fn fs_core_blur(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let r = length(uv - vec2f(0.5));
  let m = smoothstep(mix(0.1, 0.4, k.x), 0.6, r);
  return out(mix(src(uv), blurSample(uv, mix(1.0, 6.0, k.y) * m * E / 512.0), m));
}

@fragment fn fs_twin_cores(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let g = mix(0.15, 0.3, k.x);
  let v1 = uv - vec2f(0.5 - g, 0.5); let v2 = uv - vec2f(0.5 + g, 0.5);
  let d = v1 * exp(-dot(v1, v1) / 0.05) * 0.15 * E + v2 * exp(-dot(v2, v2) / 0.05) * 0.15 * E;
  return out(warp(uv, -d));
}

@fragment fn fs_core_schlieren(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let pc = vec2f(0.5, 0.5); let v = uv - pc; let r = length(v);
  let g = heatGrad(uv, t, 4.0, 7u);
  let band = 0.5 + 0.5 * sin(r * mix(20.0, 50.0, k.x) - t * 2.0);
  let m = exp(-r * r * 4.0);
  return out(warp(uv, g * 0.006 * E) * mix(1.0, mix(0.6, 1.4, band), m * mix(0.3, 1.0, k.y)));
}

@fragment fn fs_prism_split(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let d = hazeD(uv, t, mix(0.6, 1.4, k.x)) * 0.04 * E;
  return out(chroma(uv, d, mix(0.2, 0.8, k.y)));
}

@fragment fn fs_heat_ca(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let v = uv - 0.5;
  let d = v * (0.02 + 0.05 * k.x) * E;
  return out(chroma(uv, d, mix(0.3, 1.0, k.y)));
}

@fragment fn fs_spectral_haze(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let d = hazeD(uv, t, mix(0.6, 1.2, k.x)) * 0.05 * E;
  let r = src(uv + d * 1.3).r; let g = src(uv + d).g; let b = src(uv + d * 0.7).b;
  return out(vec3f(r, g, b) * (1.0 + 0.2 * k.y));
}

@fragment fn fs_dispersion_up(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let ca = mix(0.1, 0.7, k.y) * smoothstep(0.0, 1.0, uv.y);
  let d = hazeD(uv, t, mix(0.6, 1.3, k.x)) * 0.035 * E;
  return out(chroma(uv, d, ca));
}

@fragment fn fs_edge_prism(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let g = heatGrad(uv, t, mix(2.0, 5.0, k.x), 7u) * 0.01 * E;
  return out(chroma(uv, g, mix(0.3, 1.0, k.y)));
}

@fragment fn fs_rgb_wobble(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let sc = mix(0.6, 1.4, k.x); let a = 0.03 * E * mix(0.5, 1.5, k.y);
  let dr = hazeD(uv, t, sc) * a; let dg = hazeD(uv, t + 2.0, sc) * a; let db = hazeD(uv, t + 4.0, sc) * a;
  return out(vec3f(src(uv + dr).r, src(uv + dg).g, src(uv + db).b));
}

@fragment fn fs_thermal_fringe(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let d = hazeD(uv, t, mix(0.7, 1.4, k.x)) * 0.03 * E;
  let heat = clamp(length(d) * 40.0, 0.0, 1.0);
  return out(mix(warp(uv, d), chroma(uv, d, 0.8), heat * mix(0.4, 1.0, k.y)));
}

@fragment fn fs_chroma_turb(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let d = curlD(uv, t, mix(2.0, 5.0, k.x), 31u) * 0.02 * E;
  return out(chroma(uv, d, mix(0.2, 0.7, k.y)));
}

@fragment fn fs_curl_air(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let d = curlD(uv, t, mix(2.0, 5.0, k.x), 31u) * (0.01 + 0.03 * k.y) * E;
  return out(warp(uv, d));
}

@fragment fn fs_vortex_air(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let v = uv - 0.5; let r = length(v);
  let ang = mix(1.0, 4.0, k.x) * exp(-r * r * 3.0);
  let s = rot2(ang - t * 0.3) * v + 0.5;
  let d = curlD(uv, t, 3.0, 31u) * 0.015 * E;
  return out(warp(s, d));
}

@fragment fn fs_boiling_air(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let p = uv * mix(2.5, 5.0, k.x);
  let d = curlD(uv + vec2f(0.0, t * mix(0.0, 0.3, k.y)), t, mix(2.5, 5.0, k.x), 41u) * 0.02 * E;
  return out(warp(uv, d));
}

@fragment fn fs_turb_chroma(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let d = curlD(uv, t, mix(2.0, 5.0, k.x), 31u) * 0.02 * E;
  return out(chroma(uv, d, mix(0.2, 0.6, k.y)));
}

@fragment fn fs_wind_shear(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let d = curlD(uv, t, mix(2.0, 4.0, k.x), 31u) * 0.015 * E + vec2f(sin(t * 0.6 + uv.y * 4.0), 0.0) * mix(0.0, 0.02, k.y) * E;
  return out(warp(uv, d));
}

@fragment fn fs_eddies(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let d = (curlD(uv, t, mix(1.5, 3.0, k.x), 31u) + curlD(uv, t * 1.4, mix(4.0, 8.0, k.x), 47u) * 0.5) * (0.01 + 0.025 * k.y) * E;
  return out(warp(uv, d));
}

@fragment fn fs_turb_blur(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let d = curlD(uv, t, mix(2.0, 4.0, k.x), 31u) * 0.02 * E;
  return out(mix(warp(uv, d), blurSample(uv + d, mix(1.0, 4.0, k.y) * E / 512.0), 0.6));
}

@fragment fn fs_heat_storm(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let d = curlD(uv, t, mix(3.0, 6.0, k.x), 31u) * (0.02 + 0.05 * k.y) * E;
  return out(warp(uv, d));
}

@fragment fn fs_thermal_false(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let d = hazeD(uv, t, 1.0) * 0.015 * E;
  let heat = clamp(luma(src(uv + d)) * mix(0.7, 1.4, k.x), 0.0, 1.0);
  return out(ramp(heat));
}

@fragment fn fs_heat_blur(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let hf = fbm(vec2f(uv.x * mix(2.0, 5.0, k.x), uv.y * 4.0 - t * 1.2), 4, 7u) * 0.5 + 0.5;
  return out(blurSample(uv, hf * mix(1.0, 6.0, k.y) * E / 512.0));
}

@fragment fn fs_heat_pixel(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let g = mix(24.0, 80.0, k.x);
  let cell = (floor(uv * g) + 0.5) / g;
  let d = hazeD(cell, t, 1.5) * (0.01 + 0.04 * k.y) * E;
  return out(warp(cell, d));
}

@fragment fn fs_caustic_light(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let s = sheets(uv * mix(2.0, 5.0, k.x), t);
  let d = hazeD(uv, t, 1.0) * 0.015 * E;
  return out(warp(uv, d) * (0.7 + s * mix(0.4, 1.2, k.y) * E));
}

@fragment fn fs_heat_glow(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let d = hazeD(uv, t, 1.0) * 0.02 * E;
  let base = warp(uv, d);
  let bloom = blurSample(uv + d, mix(2.0, 6.0, k.y) / 512.0);
  let hi = max(luma(bloom) - 0.6, 0.0);
  return out(base + bloom * hi * mix(0.5, 1.5, k.y) * E);
}

@fragment fn fs_banded_heat(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let d0 = hazeD(uv, t, mix(0.6, 1.2, k.x)) * 0.04 * E;
  let n = mix(3.0, 8.0, k.y);
  let d = floor(d0 * n) / n;
  return out(warp(uv, d));
}

@fragment fn fs_schlieren_mono(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = cell_uv(fp.xy);
  let t = u.time;
  let k = u.k;
  let E = u.energy;
  let g = heatGrad(uv, t, mix(2.5, 6.0, k.x), 7u);
  let s = clamp(0.5 + g.x * mix(0.3, 0.8, k.y) * E, 0.0, 1.0);
  return out(vec3f(s));
}
