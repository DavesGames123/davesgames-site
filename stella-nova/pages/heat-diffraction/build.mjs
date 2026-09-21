// ============================================================================
//  HEAT DIFFRACTION TABLE  ·  build.mjs — the single source of truth
// ────────────────────────────────────────────────────────────────────────────
//  60 heat-shimmer and refraction operators applied to a background image, the
//  same source-picker machinery as the post-process table. Each cell warps the
//  chosen photo the way hot air bends light, so you can compare how each heat
//  diffraction looks over a real scene. Run with:  node build.mjs
//
//  MODEL
//    A cell reads the shared source texture through src(uv) and returns a
//    color. The Energy generator (u.energy) scales the displacement, so it
//    stands in for the fire's energy level: low energy is a faint shimmer, high
//    energy tears the image. Zoom crops the source. The cores are single-pass:
//    rising haze shimmer, mirage reflection, schlieren gradient reveal, hot
//    plumes and cores, chromatic dispersion, turbulent curl-noise air.
//
//  SOURCE IMAGES
//    main.js reuses ../postfx-table/photos.json (no copy), plus an upload/drop.
//
//  GREP MAP (pack.wgsl)
//    struct HeatU ..... uniform block  ·  fn cell_uv/src .. source sampling
//    fn hazeD/curlD ... displacement fields  ·  fn heatGrad .. schlieren
//    fn warp/chroma ... sampling modes  ·  fn ramp .. thermal false color
//    @fragment fs_* ... the 60 cells
// ============================================================================
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));

const FAM = {
  haze:      'rgba(255,140,60,0.13)',
  mirage:    'rgba(255,180,90,0.12)',
  schlieren: 'rgba(150,200,255,0.13)',
  plume:     'rgba(255,110,50,0.14)',
  radial:    'rgba(255,90,60,0.14)',
  chroma:    'rgba(200,120,255,0.13)',
  turbulent: 'rgba(120,210,200,0.13)',
  stylized:  'rgba(255,200,120,0.13)',
};

const HELPERS = `// ═══════════════════════════════════════════════════════════════════════════
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
`;

// helper to build a cell record
const cells = [];
const C = (name, family, species, knobs, body) => cells.push([name, family, species, knobs, body]);

// ---------------------------------------------------------------- haze
C('rising_haze', 'haze', 'a rising heat shimmer, stronger up the frame', ['scale', 'strength', '', ''],
 `  let d = hazeD(uv, t, mix(0.6, 1.4, k.x)) * (0.012 + 0.05 * k.y) * E;
  return out(warp(uv, d));`);
C('dense_haze', 'haze', 'a heavy, coarse heat distortion', ['scale', 'strength', '', ''],
 `  let d = hazeD(uv, t, mix(0.4, 0.9, k.x)) * (0.03 + 0.06 * k.y) * E;
  return out(warp(uv, d));`);
C('fine_haze', 'haze', 'a fine high-frequency shimmer', ['scale', 'strength', '', ''],
 `  let d = hazeD(uv, t, mix(1.4, 2.6, k.x)) * (0.008 + 0.03 * k.y) * E;
  return out(warp(uv, d));`);
C('haze_chroma', 'haze', 'rising haze with a chromatic split', ['scale', 'split', '', ''],
 `  let d = hazeD(uv, t, mix(0.6, 1.4, k.x)) * 0.03 * E;
  return out(chroma(uv, d, mix(0.1, 0.5, k.y)));`);
C('ground_haze', 'haze', 'shimmer off a hot floor, fading upward', ['scale', 'strength', '', ''],
 `  let m = smoothstep(0.7, 0.0, uv.y);
  let d = hazeD(vec2f(uv.x, 1.0 - uv.y), t, mix(0.6, 1.4, k.x)) * (0.02 + 0.05 * k.y) * E * m;
  return out(warp(uv, d));`);
C('wall_haze', 'haze', 'a uniform shimmer across the whole frame', ['scale', 'strength', '', ''],
 `  let x = sin(uv.y * mix(8.0, 20.0, k.x) + t * 3.0) + fbm(uv * mix(3.0, 6.0, k.x) - vec2f(0.0, t), 3, 7u);
  let d = vec2f(x, 0.0) * (0.01 + 0.03 * k.y) * E;
  return out(warp(uv, d));`);
C('gusty_haze', 'haze', 'haze shoved by slow gusts', ['scale', 'gust', '', ''],
 `  let g = vec2f(sin(t * 0.7 + uv.y * 3.0) * mix(0.0, 0.02, k.y), 0.0);
  let d = hazeD(uv, t, mix(0.6, 1.3, k.x)) * 0.025 * E + g * E;
  return out(warp(uv, d));`);
C('layered_haze', 'haze', 'two shimmer layers at different scales', ['scale', 'strength', '', ''],
 `  let d = (hazeD(uv, t, mix(0.5, 1.0, k.x)) + hazeD(uv, t * 1.3 + 4.0, mix(1.5, 2.5, k.x)) * 0.5) * (0.015 + 0.04 * k.y) * E;
  return out(warp(uv, d));`);

// ---------------------------------------------------------------- mirage
C('mirage_floor', 'mirage', 'a hot floor mirages the scene into a reflection', ['line', 'shimmer', '', ''],
 `  let y0 = mix(0.3, 0.55, k.x);
  var s = uv;
  if (uv.y < y0) { s.y = y0 + (y0 - uv.y) * 0.7; }
  let m = smoothstep(y0 + 0.15, y0 - 0.1, uv.y);
  s += hazeD(uv, t, 1.0) * (0.02 + 0.05 * k.y) * E * m;
  return out(warp(s, vec2f(0.0)));`);
C('mirage_road', 'mirage', 'road-mirage: strong shimmer along a horizon', ['line', 'shimmer', '', ''],
 `  let y0 = mix(0.35, 0.6, k.x);
  let m = exp(-abs(uv.y - y0) * 7.0);
  let d = vec2f(sin(uv.x * 20.0 + t * 4.0) + fbm(uv * 5.0 - vec2f(0.0, t), 3, 7u), 0.0) * (0.02 + 0.06 * k.y) * E * m;
  return out(warp(uv, d));`);
C('mirage_pool', 'mirage', 'a shimmering false pool of reflected sky', ['line', 'shimmer', '', ''],
 `  let y0 = mix(0.3, 0.5, k.x);
  var s = uv;
  if (uv.y < y0) { s.y = y0 + (y0 - uv.y) * 0.5; }
  let m = smoothstep(y0, 0.0, uv.y);
  s += hazeD(uv, t, 1.2) * 0.04 * E * m;
  let c = mix(warp(s, vec2f(0.0)), u.cream.rgb, m * 0.15 * E);
  return out(c);`);
C('mirage_chroma', 'mirage', 'a mirage with dispersion at the seam', ['line', 'split', '', ''],
 `  let y0 = mix(0.35, 0.55, k.x);
  var s = uv;
  if (uv.y < y0) { s.y = y0 + (y0 - uv.y) * 0.7; }
  let m = exp(-abs(uv.y - y0) * 6.0);
  let d = hazeD(uv, t, 1.0) * 0.03 * E * (0.3 + m);
  return out(chroma(s, d, mix(0.1, 0.5, k.y)));`);
C('mirage_inverted', 'mirage', 'an inversion mirage hanging from a hot ceiling', ['line', 'shimmer', '', ''],
 `  let y0 = mix(0.5, 0.7, k.x);
  var s = uv;
  if (uv.y > y0) { s.y = y0 - (uv.y - y0) * 0.7; }
  let m = smoothstep(y0 - 0.15, y0 + 0.1, uv.y);
  s += hazeD(uv, t, 1.0) * (0.02 + 0.05 * k.y) * E * m;
  return out(warp(s, vec2f(0.0)));`);
C('mirage_double', 'mirage', 'two stacked mirage bands', ['gap', 'shimmer', '', ''],
 `  let g = mix(0.15, 0.3, k.x);
  let m1 = exp(-abs(uv.y - (0.5 - g)) * 8.0); let m2 = exp(-abs(uv.y - (0.5 + g)) * 8.0);
  let d = vec2f(sin(uv.x * 18.0 + t * 3.5), 0.0) * (0.02 + 0.05 * k.y) * E * (m1 + m2);
  return out(warp(uv, d));`);
C('mirage_soft', 'mirage', 'a gentle mirage, barely bending the scene', ['line', 'shimmer', '', ''],
 `  let y0 = mix(0.35, 0.55, k.x);
  let m = exp(-abs(uv.y - y0) * 4.0);
  let d = hazeD(uv, t, 0.8) * (0.008 + 0.02 * k.y) * E * (0.3 + m);
  return out(warp(uv, d));`);

// ---------------------------------------------------------------- schlieren
C('schlieren_h', 'schlieren', 'horizontal density gradient reveal', ['scale', 'gain', '', ''],
 `  let g = heatGrad(uv, t, mix(2.0, 5.0, k.x), 7u);
  let sh = clamp(0.5 + g.x * mix(0.2, 0.6, k.y) * E, 0.0, 1.0);
  return out(warp(uv, g * 0.006 * E) * mix(0.5, 1.5, sh));`);
C('schlieren_v', 'schlieren', 'vertical density gradient reveal', ['scale', 'gain', '', ''],
 `  let g = heatGrad(uv, t, mix(2.0, 5.0, k.x), 11u);
  let sh = clamp(0.5 + g.y * mix(0.2, 0.6, k.y) * E, 0.0, 1.0);
  return out(warp(uv, g * 0.006 * E) * mix(0.5, 1.5, sh));`);
C('schlieren_edge', 'schlieren', 'gradient magnitude as bright shock edges', ['scale', 'gain', '', ''],
 `  let g = heatGrad(uv, t, mix(2.0, 5.0, k.x), 7u);
  let mag = length(g) * mix(0.1, 0.4, k.y) * E;
  return out(warp(uv, g * 0.005 * E) * (1.0 + mag));`);
C('schlieren_color', 'schlieren', 'density gradient tinted through the palette', ['scale', 'gain', '', ''],
 `  let g = heatGrad(uv, t, mix(2.0, 5.0, k.x), 13u);
  let s = clamp(0.5 + g.x * 0.4 * E, 0.0, 1.0);
  return out(mix(warp(uv, g * 0.006 * E), ramp(s), mix(0.2, 0.7, k.y)));`);
C('shadowgraph', 'schlieren', 'a shadowgraph: dark where the air bends most', ['scale', 'gain', '', ''],
 `  let g = heatGrad(uv, t, mix(2.5, 6.0, k.x), 7u);
  let d2 = length(heatGrad(uv + vec2f(0.01, 0.0), t, mix(2.5, 6.0, k.x), 7u) - g);
  return out(warp(uv, g * 0.005 * E) * (1.0 - clamp(d2 * mix(1.0, 4.0, k.y) * E, 0.0, 0.8)));`);
C('schlieren_plume', 'schlieren', 'schlieren confined to a rising plume', ['scale', 'width', '', ''],
 `  let m = exp(-(uv.x - 0.5) * (uv.x - 0.5) / (mix(0.02, 0.08, k.y)));
  let g = heatGrad(vec2f(uv.x, uv.y - t * 0.3), t, mix(3.0, 6.0, k.x), 7u);
  let sh = clamp(0.5 + g.x * 0.5 * E, 0.0, 1.0);
  return out(warp(uv, g * 0.006 * E * m) * mix(1.0, mix(0.5, 1.5, sh), m));`);
C('schlieren_radial', 'schlieren', 'radial schlieren around a hot point', ['scale', 'gain', '', ''],
 `  let pc = vec2f(0.5, mix(0.35, 0.6, k.x));
  let g = heatGrad(uv, t, 4.0, 7u);
  let r = length(uv - pc);
  let m = exp(-r * r * 6.0);
  let sh = clamp(0.5 + dot(g, normalize(uv - pc + 1e-4)) * mix(0.3, 0.7, k.y) * E, 0.0, 1.0);
  return out(warp(uv, g * 0.006 * E * m) * mix(0.6, 1.4, sh * m + (1.0 - m) * 0.5));`);

// ---------------------------------------------------------------- plume
C('hot_column', 'plume', 'a hot column shimmering up the middle', ['width', 'strength', '', ''],
 `  let m = exp(-(uv.x - 0.5) * (uv.x - 0.5) / mix(0.02, 0.1, k.x));
  let d = hazeD(uv, t, 1.2) * (0.02 + 0.06 * k.y) * E * m;
  return out(warp(uv, d));`);
C('twin_columns', 'plume', 'two hot updraft columns', ['gap', 'strength', '', ''],
 `  let g = mix(0.15, 0.3, k.x);
  let m = exp(-(uv.x - 0.5 - g) * (uv.x - 0.5 - g) / 0.02) + exp(-(uv.x - 0.5 + g) * (uv.x - 0.5 + g) / 0.02);
  let d = hazeD(uv, t, 1.3) * (0.02 + 0.05 * k.y) * E * m;
  return out(warp(uv, d));`);
C('candle_heat', 'plume', 'a thin candle-thread of rising heat', ['width', 'strength', '', ''],
 `  let m = exp(-(uv.x - 0.5) * (uv.x - 0.5) / mix(0.006, 0.03, k.x));
  let d = hazeD(uv, t, 1.6) * (0.02 + 0.06 * k.y) * E * m;
  return out(warp(uv, d));`);
C('chimney_heat', 'plume', 'heat spreading wider as it rises', ['width', 'strength', '', ''],
 `  let w = mix(0.02, 0.08, k.x) * (0.4 + uv.y);
  let m = exp(-(uv.x - 0.5) * (uv.x - 0.5) / w);
  let d = hazeD(uv, t, 1.1) * (0.02 + 0.05 * k.y) * E * m;
  return out(warp(uv, d));`);
C('plume_chroma', 'plume', 'a hot column with dispersion', ['width', 'split', '', ''],
 `  let m = exp(-(uv.x - 0.5) * (uv.x - 0.5) / mix(0.02, 0.08, k.x));
  let d = hazeD(uv, t, 1.2) * 0.04 * E * m;
  return out(chroma(uv, d, mix(0.1, 0.5, k.y)));`);
C('plume_lean', 'plume', 'a column of heat leaning on the wind', ['width', 'lean', '', ''],
 `  let cx = 0.5 + mix(0.0, 0.25, k.y) * uv.y;
  let m = exp(-(uv.x - cx) * (uv.x - cx) / mix(0.02, 0.08, k.x));
  let d = hazeD(uv, t, 1.2) * 0.04 * E * m;
  return out(warp(uv, d));`);
C('plume_blur', 'plume', 'a hot column that defocuses the scene behind it', ['width', 'blur', '', ''],
 `  let m = exp(-(uv.x - 0.5) * (uv.x - 0.5) / mix(0.02, 0.1, k.x));
  let d = hazeD(uv, t, 1.2) * 0.03 * E * m;
  let b = blurSample(uv + d, mix(1.0, 4.0, k.y) * m * E / 512.0);
  return out(mix(warp(uv, d), b, m));`);
C('plume_pulse', 'plume', 'a column pulsing with heat surges', ['width', 'pulse', '', ''],
 `  let pulse = 0.6 + 0.5 * sin(uv.y * 6.0 - t * mix(2.0, 5.0, k.y));
  let m = exp(-(uv.x - 0.5) * (uv.x - 0.5) / mix(0.02, 0.08, k.x));
  let d = hazeD(uv, t, 1.2) * 0.04 * E * m * pulse;
  return out(warp(uv, d));`);

// ---------------------------------------------------------------- radial
C('hot_core', 'radial', 'a hot core that magnifies the scene like a lens', ['radius', 'strength', '', ''],
 `  let pc = vec2f(0.5, mix(0.4, 0.6, k.x));
  let v = uv - pc; let r = length(v);
  let bloom = exp(-r * r / mix(0.05, 0.2, k.x));
  let d = v * bloom * (0.1 + 0.3 * k.y) * E;
  return out(warp(uv, -d) + vec3f(0.1, 0.04, 0.0) * bloom * E * 0.3);`);
C('core_chroma', 'radial', 'a hot core with lens-like dispersion', ['radius', 'split', '', ''],
 `  let pc = vec2f(0.5, 0.5);
  let v = uv - pc; let r = length(v);
  let bloom = exp(-r * r / mix(0.05, 0.25, k.x));
  let d = v * bloom * 0.2 * E;
  return out(chroma(uv, -d, mix(0.1, 0.6, k.y)));`);
C('core_pulse', 'radial', 'a throbbing energy core', ['radius', 'rate', '', ''],
 `  let pc = vec2f(0.5, 0.5);
  let v = uv - pc; let r = length(v);
  let pulse = 0.6 + 0.4 * sin(t * mix(1.5, 4.0, k.y) - r * 12.0);
  let bloom = exp(-r * r / mix(0.05, 0.2, k.x));
  let d = v * bloom * 0.2 * E * pulse;
  return out(warp(uv, -d) + ramp(bloom * pulse) * bloom * 0.2 * E);`);
C('shock_ring', 'radial', 'a shock ring expanding from a hot point', ['speed', 'thick', '', ''],
 `  let pc = vec2f(0.5, 0.5);
  let v = uv - pc; let r = length(v);
  let rad = fract(t * mix(0.15, 0.4, k.x)) * 0.6;
  let ring = exp(-(r - rad) * (r - rad) / mix(0.001, 0.01, k.y));
  let d = normalize(v + 1e-4) * ring * 0.08 * E;
  return out(warp(uv, d) * (1.0 + ring * E));`);
C('core_blur', 'radial', 'heat blur radiating from the center', ['radius', 'blur', '', ''],
 `  let r = length(uv - vec2f(0.5));
  let m = smoothstep(mix(0.1, 0.4, k.x), 0.6, r);
  return out(mix(src(uv), blurSample(uv, mix(1.0, 6.0, k.y) * m * E / 512.0), m));`);
C('twin_cores', 'radial', 'two hot cores warping toward each other', ['gap', 'strength', '', ''],
 `  let g = mix(0.15, 0.3, k.x);
  let v1 = uv - vec2f(0.5 - g, 0.5); let v2 = uv - vec2f(0.5 + g, 0.5);
  let d = v1 * exp(-dot(v1, v1) / 0.05) * 0.15 * E + v2 * exp(-dot(v2, v2) / 0.05) * 0.15 * E;
  return out(warp(uv, -d));`);
C('core_schlieren', 'radial', 'radial density bands off a hot core', ['radius', 'gain', '', ''],
 `  let pc = vec2f(0.5, 0.5); let v = uv - pc; let r = length(v);
  let g = heatGrad(uv, t, 4.0, 7u);
  let band = 0.5 + 0.5 * sin(r * mix(20.0, 50.0, k.x) - t * 2.0);
  let m = exp(-r * r * 4.0);
  return out(warp(uv, g * 0.006 * E) * mix(1.0, mix(0.6, 1.4, band), m * mix(0.3, 1.0, k.y)));`);

// ---------------------------------------------------------------- chroma
C('prism_split', 'chroma', 'a heat prism splitting the scene into color', ['scale', 'split', '', ''],
 `  let d = hazeD(uv, t, mix(0.6, 1.4, k.x)) * 0.04 * E;
  return out(chroma(uv, d, mix(0.2, 0.8, k.y)));`);
C('heat_ca', 'chroma', 'radial chromatic aberration from heat', ['scale', 'split', '', ''],
 `  let v = uv - 0.5;
  let d = v * (0.02 + 0.05 * k.x) * E;
  return out(chroma(uv, d, mix(0.3, 1.0, k.y)));`);
C('spectral_haze', 'chroma', 'wide spectral fringing on rising haze', ['scale', 'split', '', ''],
 `  let d = hazeD(uv, t, mix(0.6, 1.2, k.x)) * 0.05 * E;
  let r = src(uv + d * 1.3).r; let g = src(uv + d).g; let b = src(uv + d * 0.7).b;
  return out(vec3f(r, g, b) * (1.0 + 0.2 * k.y));`);
C('dispersion_up', 'chroma', 'dispersion that widens as heat rises', ['scale', 'split', '', ''],
 `  let ca = mix(0.1, 0.7, k.y) * smoothstep(0.0, 1.0, uv.y);
  let d = hazeD(uv, t, mix(0.6, 1.3, k.x)) * 0.035 * E;
  return out(chroma(uv, d, ca));`);
C('edge_prism', 'chroma', 'color split along the density gradient', ['scale', 'split', '', ''],
 `  let g = heatGrad(uv, t, mix(2.0, 5.0, k.x), 7u) * 0.01 * E;
  return out(chroma(uv, g, mix(0.3, 1.0, k.y)));`);
C('rgb_wobble', 'chroma', 'each channel shimmering out of phase', ['scale', 'split', '', ''],
 `  let sc = mix(0.6, 1.4, k.x); let a = 0.03 * E * mix(0.5, 1.5, k.y);
  let dr = hazeD(uv, t, sc) * a; let dg = hazeD(uv, t + 2.0, sc) * a; let db = hazeD(uv, t + 4.0, sc) * a;
  return out(vec3f(src(uv + dr).r, src(uv + dg).g, src(uv + db).b));`);
C('thermal_fringe', 'chroma', 'colored fringes where the air is hottest', ['scale', 'split', '', ''],
 `  let d = hazeD(uv, t, mix(0.7, 1.4, k.x)) * 0.03 * E;
  let heat = clamp(length(d) * 40.0, 0.0, 1.0);
  return out(mix(warp(uv, d), chroma(uv, d, 0.8), heat * mix(0.4, 1.0, k.y)));`);
C('chroma_turb', 'chroma', 'turbulent air with a chromatic tear', ['scale', 'split', '', ''],
 `  let d = curlD(uv, t, mix(2.0, 5.0, k.x), 31u) * 0.02 * E;
  return out(chroma(uv, d, mix(0.2, 0.7, k.y)));`);

// ---------------------------------------------------------------- turbulent
C('curl_air', 'turbulent', 'turbulent air advecting the scene', ['scale', 'strength', '', ''],
 `  let d = curlD(uv, t, mix(2.0, 5.0, k.x), 31u) * (0.01 + 0.03 * k.y) * E;
  return out(warp(uv, d));`);
C('vortex_air', 'turbulent', 'a slow vortex of hot air', ['spin', 'strength', '', ''],
 `  let v = uv - 0.5; let r = length(v);
  let ang = mix(1.0, 4.0, k.x) * exp(-r * r * 3.0);
  let s = rot2(ang - t * 0.3) * v + 0.5;
  let d = curlD(uv, t, 3.0, 31u) * 0.015 * E;
  return out(warp(s, d));`);
C('boiling_air', 'turbulent', 'air boiling in place', ['scale', 'churn', '', ''],
 `  let p = uv * mix(2.5, 5.0, k.x);
  let d = curlD(uv + vec2f(0.0, t * mix(0.0, 0.3, k.y)), t, mix(2.5, 5.0, k.x), 41u) * 0.02 * E;
  return out(warp(uv, d));`);
C('turb_chroma', 'turbulent', 'turbulent air with dispersion', ['scale', 'split', '', ''],
 `  let d = curlD(uv, t, mix(2.0, 5.0, k.x), 31u) * 0.02 * E;
  return out(chroma(uv, d, mix(0.2, 0.6, k.y)));`);
C('wind_shear', 'turbulent', 'turbulence sheared by a crosswind', ['scale', 'wind', '', ''],
 `  let d = curlD(uv, t, mix(2.0, 4.0, k.x), 31u) * 0.015 * E + vec2f(sin(t * 0.6 + uv.y * 4.0), 0.0) * mix(0.0, 0.02, k.y) * E;
  return out(warp(uv, d));`);
C('eddies', 'turbulent', 'nested eddies at two scales', ['scale', 'strength', '', ''],
 `  let d = (curlD(uv, t, mix(1.5, 3.0, k.x), 31u) + curlD(uv, t * 1.4, mix(4.0, 8.0, k.x), 47u) * 0.5) * (0.01 + 0.025 * k.y) * E;
  return out(warp(uv, d));`);
C('turb_blur', 'turbulent', 'turbulent air that smears the scene', ['scale', 'blur', '', ''],
 `  let d = curlD(uv, t, mix(2.0, 4.0, k.x), 31u) * 0.02 * E;
  return out(mix(warp(uv, d), blurSample(uv + d, mix(1.0, 4.0, k.y) * E / 512.0), 0.6));`);
C('heat_storm', 'turbulent', 'a full-field storm of hot air', ['scale', 'strength', '', ''],
 `  let d = curlD(uv, t, mix(3.0, 6.0, k.x), 31u) * (0.02 + 0.05 * k.y) * E;
  return out(warp(uv, d));`);

// ---------------------------------------------------------------- stylized
C('thermal_false', 'stylized', 'a thermal-camera false color of the scene', ['bias', 'shimmer', '', ''],
 `  let d = hazeD(uv, t, 1.0) * 0.015 * E;
  let heat = clamp(luma(src(uv + d)) * mix(0.7, 1.4, k.x), 0.0, 1.0);
  return out(ramp(heat));`);
C('heat_blur', 'stylized', 'defocus that grows with local heat', ['scale', 'blur', '', ''],
 `  let hf = fbm(vec2f(uv.x * mix(2.0, 5.0, k.x), uv.y * 4.0 - t * 1.2), 4, 7u) * 0.5 + 0.5;
  return out(blurSample(uv, hf * mix(1.0, 6.0, k.y) * E / 512.0));`);
C('heat_pixel', 'stylized', 'the scene diced and jostled by heat cells', ['pixels', 'strength', '', ''],
 `  let g = mix(24.0, 80.0, k.x);
  let cell = (floor(uv * g) + 0.5) / g;
  let d = hazeD(cell, t, 1.5) * (0.01 + 0.04 * k.y) * E;
  return out(warp(cell, d));`);
C('caustic_light', 'stylized', 'hot-air caustics playing over the scene', ['scale', 'strength', '', ''],
 `  let s = sheets(uv * mix(2.0, 5.0, k.x), t);
  let d = hazeD(uv, t, 1.0) * 0.015 * E;
  return out(warp(uv, d) * (0.7 + s * mix(0.4, 1.2, k.y) * E));`);
C('heat_glow', 'stylized', 'bright regions bloom and shimmer with heat', ['scale', 'glow', '', ''],
 `  let d = hazeD(uv, t, 1.0) * 0.02 * E;
  let base = warp(uv, d);
  let bloom = blurSample(uv + d, mix(2.0, 6.0, k.y) / 512.0);
  let hi = max(luma(bloom) - 0.6, 0.0);
  return out(base + bloom * hi * mix(0.5, 1.5, k.y) * E);`);
C('banded_heat', 'stylized', 'quantized shimmer, a stepped heat warp', ['scale', 'bands', '', ''],
 `  let d0 = hazeD(uv, t, mix(0.6, 1.2, k.x)) * 0.04 * E;
  let n = mix(3.0, 8.0, k.y);
  let d = floor(d0 * n) / n;
  return out(warp(uv, d));`);
C('schlieren_mono', 'stylized', 'a monochrome shadowgraph of the hot air', ['scale', 'gain', '', ''],
 `  let g = heatGrad(uv, t, mix(2.5, 6.0, k.x), 7u);
  let s = clamp(0.5 + g.x * mix(0.3, 0.8, k.y) * E, 0.0, 1.0);
  return out(vec3f(s));`);

const CELLS = cells;

// ── emit pack.wgsl ───────────────────────────────────────────────────────────
const frag = ([name, , , , body]) =>
  `@fragment fn fs_${name}(@builtin(position) fp: vec4f) -> @location(0) vec4f {\n  let uv = cell_uv(fp.xy);\n  let t = u.time;\n  let k = u.k;\n  let E = u.energy;\n${body}\n}`;
const pack = HELPERS + '\n// ── the 60 heat operators ────────────────────────────────────────────────────\n' +
  CELLS.map(frag).join('\n\n') + '\n';

// ── emit spec.json ───────────────────────────────────────────────────────────
const spec = {
  cols: 6,
  uniform_bytes: 96,
  cells: CELLS.map(([name, family, species, knobs]) => ({ name, family, species, knobs, defaults: [0.5, 0.5, 0.5, 0.5], fn: 'fs_' + name })),
  gens: [
    { id: 'energy', title: 'Energy · heat level', fn: 'flat', period: 10, amp: 0.35, bias: 0.55, phase: 0,
      map: 'y => 1.6 * y', unit: "v => (v * 100).toFixed(0) + '%'" },
    { id: 'tempo', title: 'Tempo · hover speed', fn: 'flat', period: 8, amp: 0.0, bias: 0.5, phase: 0,
      map: 'y => 0.1 + 2.9 * y', unit: "v => v.toFixed(2) + 'x'" },
    { id: 'zoom', title: 'Zoom · source crop', fn: 'flat', period: 10, amp: 0.0, bias: 0.45, phase: 0,
      map: 'y => 0.7 + 1.1 * y', unit: "v => v.toFixed(2) + 'x'" },
  ],
  swatches: [
    { id: 'ink', label: 'Cold', hex: '#08080c' },
    { id: 'tone', label: 'Warm', hex: '#ff7a1e' },
    { id: 'cream', label: 'Hot', hex: '#ffe6b0' },
  ],
};

// ── emit index.html ──────────────────────────────────────────────────────────
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const legend = Object.keys(FAM).map(f => `<span class="f-${f}"><i></i>${f}</span>`).join('');
const tiles = CELLS.map(([name, family, species]) =>
  `<div class="cell f-${family}" role="button" tabindex="0" id="tile-${name}" aria-label="${esc(name.replace(/_/g, ' ') + ': ' + species)}"><canvas></canvas><span class="orb-status"></span><span class="tag">${name.replace(/_/g, ' ')}</span></div>`).join('');
const swatchHtml = spec.swatches.map(s => `<label class="swatch"><span>${s.label}</span><input type="color" id="sw-${s.id}" value="${s.hex}"></label>`).join('');

const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Heat Diffraction Table // Stella Nova</title>
<!--
  ════════════════════════════════════════════════════════════════════════════
   HEAT DIFFRACTION TABLE  ·  page shell (GENERATED by build.mjs)
  ────────────────────────────────────────────────────────────────────────────
   ${CELLS.length} heat-shimmer and refraction operators over a background image, the
   same source picker as the post-process table. Energy scales the distortion.
  ════════════════════════════════════════════════════════════════════════════
-->
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=JetBrains+Mono:wght@300;400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="style.css">
</head>
<body>

<script>if(window!==window.top)document.documentElement.classList.add("in-frame")</script>
<div class="grid-bg"></div>
<div class="topbar">
  <div class="topbar-l"><span class="sys-name">Stella Nova</span><span class="sys-status">Heat Diffraction Table</span></div>
  <div class="topbar-r">SYS // <strong>WGSL SHADER LAB</strong></div>
</div>
<div id="side">
  <div class="side-head"><div class="big">heat</div><div class="sub">|${CELLS.length} diffractions · ${Object.keys(FAM).length} families⟩</div></div>
  <div class="legend">${legend}</div>
  <div class="sec"><div class="sec-lbl">Source</div>
    <div class="thumbs" id="thumbs"></div>
    <div class="mini">click a thumbnail · drop an image here or <label style="color:var(--yellow);cursor:pointer">choose one<input type="file" id="upload" accept="image/*" hidden></label></div>
  </div>
  <div id="gens"></div>
  <div class="sec"><div class="sec-lbl">Thermal palette</div><div class="swatches">${swatchHtml}</div></div>
  <div class="sec"><button class="chip on" id="hoveronly" type="button" aria-pressed="true">◉ animate on hover only</button></div>
  <div class="fps" id="fps"></div>
</div>
<div id="nogpu" class="nogpu" hidden>WebGPU is not available in this browser, so the table cannot render. Chrome, Edge, and Safari 26 have it on by default; Firefox has it behind <code>dom.webgpu.enabled</code>.</div>
<div id="stage"><div id="table">${tiles}</div></div>
<div id="modal" role="dialog" aria-modal="true" aria-labelledby="m-name">
  <div class="sheet">
    <div class="sheet-side">
      <canvas id="m-orb" width="220" height="220"></canvas>
      <h3 id="m-name"></h3><div class="fn" id="m-fn"></div><p id="m-species"></p><div id="m-knobs"></div>
    </div>
    <div class="sheet-main">
      <div class="sheet-head"><span class="lbl" id="m-src-lbl">WGSL</span><button class="panel-btn" id="m-copy" type="button">Copy function</button><button class="panel-btn" id="m-copy-pack" type="button">Copy library</button><button class="panel-btn" id="m-close" type="button">Close ✕</button></div>
      <pre id="m-src" tabindex="0"></pre>
    </div>
  </div>
</div>

<script type="module" src="main.js"></script>

</body>
</html>
`;

// ── emit main.js and page.js ─────────────────────────────────────────────────
const mainJs = `// ============================================================================
//  HEAT DIFFRACTION TABLE  ·  main.js — data load and boot (GENERATED)
//  Reuses ../postfx-table/photos.json for the source images (no copy).
//  Regenerate with: node build.mjs
// ============================================================================
import { bootTable } from '../../lib/table-engine.js';
import { loadShaders } from '../../lib/shaders.js';
import { PAGE } from './page.js';

const SH = await loadShaders(import.meta.url, ['shaders/pack.wgsl']);
const spec = await (await fetch(new URL('spec.json', import.meta.url))).json();
const photos = await (await fetch(new URL('../postfx-table/photos.json', import.meta.url))).json();

bootTable(PAGE, { spec, pack: SH['shaders/pack.wgsl'], aux: { photos } });
`;

const pageJs = `// ============================================================================
//  HEAT DIFFRACTION TABLE  ·  page.js — the per-page PAGE object (GENERATED)
// ────────────────────────────────────────────────────────────────────────────
//  ${CELLS.length} heat operators over a shared source image. Same source-texture machinery
//  as the post-process table: a picked photo (or an uploaded/dropped image) is
//  drawn into a 512 texture that every cell samples through src(uv).
//  UNIFORM LAYOUT (96 bytes, struct HeatU in shaders/pack.wgsl)
//    0..1 size · 2 time · 3 pixelScale · 4..7 ink · 8..11 tone · 12..15 cream
//    16 energy · 17 zoom · 18 pad · 19 pad · 20..23 k
// ============================================================================
export const PAGE = {
  async init(ctx) {
    const PHOTOS = ctx.photos;
    const { device, format, tiles, PACK, $ } = ctx; this.ctx = ctx;
    this.tex = device.createTexture({ size: [512, 512], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    this.smp = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'mirror-repeat', addressModeV: 'mirror-repeat' });
    this.bgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} }, { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} }] });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [this.bgl] });
    const module = device.createShaderModule({ code: PACK });
    module.getCompilationInfo().then(info => { const errs = info.messages.filter(m => m.type === 'error'); if (errs.length) for (const t of tiles) ctx.setStatus(t, errs[0].message.slice(0, 120), true); });
    for (const t of tiles) device.createRenderPipelineAsync({ layout, vertex: { module, entryPoint: 'vs_main' }, fragment: { module, entryPoint: 'fs_' + t.s.name, targets: [{ format }] }, primitive: { topology: 'triangle-list' } })
      .then(p => { t.pipeline = p; t.dirty = true; }).catch(e => ctx.setStatus(t, String(e.message || e).slice(0, 120), true));
    const thumbs = $('thumbs'); this.work = document.createElement('canvas'); this.work.width = this.work.height = 512; this.wctx = this.work.getContext('2d');
    const add = id => { const b = document.createElement('button'); b.type = 'button'; b.title = id.replace(/_/g, ' '); const cv = document.createElement('canvas'); cv.width = cv.height = 96; b.appendChild(cv); thumbs.appendChild(b); return { b, cv }; };
    this.photos = {}; let first = null;
    for (const [id, uri] of Object.entries(PHOTOS)) { const { cv, b } = add(id); const img = new Image(); img.onload = () => { cv.getContext('2d').drawImage(img, 0, 0, 96, 96); }; img.src = uri; this.photos[id] = img; b.addEventListener('click', () => this.select(id, b)); if (!first) first = b; }
    const up = add('upload'); const uc = up.cv.getContext('2d'); uc.fillStyle = '#1c2436'; uc.fillRect(0, 0, 96, 96); uc.fillStyle = '#96c8ff'; uc.font = '40px sans-serif'; uc.fillText('+', 34, 62); this.upBtn = up;
    up.b.addEventListener('click', () => $('upload').click());
    $('upload').addEventListener('change', e => { const f = e.target.files[0]; if (f) this.loadImage(f); });
    const side = $('side'); side.addEventListener('dragover', e => e.preventDefault()); side.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && f.type.startsWith('image/')) this.loadImage(f); });
    const firstId = Object.keys(PHOTOS)[0]; this.select(firstId, first);
  },
  copyWork() { this.ctx.device.queue.copyExternalImageToTexture({ source: this.work }, { texture: this.tex }, [512, 512]); },
  tick() { if (!this.pending) return; const apply = this.pending; this.pending = null; apply(); return true; },
  select(id, btn) {
    this.ctx.$('thumbs').querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
    const img = this.photos[id]; if (!img) return;
    const put = () => { this.wctx.drawImage(img, 0, 0, 512, 512); this.pending = () => this.copyWork(); };
    if (img.complete && img.naturalWidth) put(); else img.addEventListener('load', put, { once: true });
  },
  loadImage(file) {
    const img = new Image(); img.onload = () => { const s = Math.max(512 / img.width, 512 / img.height); const w = img.width * s, h = img.height * s;
      this.wctx.fillStyle = '#000'; this.wctx.fillRect(0, 0, 512, 512); this.wctx.drawImage(img, (512 - w) / 2, (512 - h) / 2, w, h);
      this.pending = () => this.copyWork();
      this.upBtn.cv.getContext('2d').drawImage(this.work, 0, 0, 96, 96);
      this.ctx.$('thumbs').querySelectorAll('button').forEach(b => b.classList.toggle('active', b === this.upBtn.b));
      URL.revokeObjectURL(img.src); };
    img.src = URL.createObjectURL(file);
  },
  bind(surf) { if (!surf.page.bind) surf.page.bind = this.ctx.device.createBindGroup({ layout: this.bgl, entries: [{ binding: 0, resource: { buffer: surf.buf } }, { binding: 1, resource: this.tex.createView() }, { binding: 2, resource: this.smp }] }); return surf.page.bind; },
  draw(enc, t, surf, rect, dpr, dt, now, moving) {
    const { device, G } = this.ctx; const d = surf.data;
    d[0] = rect.width; d[1] = rect.height; d[2] = t.phase; d[3] = dpr;
    d.set([G.ink[0], G.ink[1], G.ink[2], 1], 4); d.set([G.tone[0], G.tone[1], G.tone[2], 1], 8); d.set([G.cream[0], G.cream[1], G.cream[2], 1], 12);
    d[16] = G.energy; d[17] = G.zoom; d[18] = 0; d[19] = 0; d.set(t.knobs, 20);
    device.queue.writeBuffer(surf.buf, 0, d);
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: surf.ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(t.pipeline); pass.setBindGroup(0, this.bind(surf)); pass.draw(3); pass.end();
  },
  source(t) { return this.ctx.fnSource('fs_' + t.s.name); },
};
`;

// ── emit style.css (clone postfx-table, append heat families) ────────────────
const famCss = Object.entries(FAM).map(([f, c]) =>
  `.f-${f}{--fam:${c};--fam-bg:${c.replace(/[\d.]+\)$/, '0.06)')}}`).join('\n');
const baseCss = readFileSync(join(DIR, '..', 'postfx-table', 'style.css'), 'utf8');
const css = baseCss + `
/* ── heat families (appended by build.mjs) ───────────────────────────────── */
${famCss}
.side-head .big{color:#ff9a4c}
.legend span{text-transform:capitalize}
`;

// ── write everything ─────────────────────────────────────────────────────────
mkdirSync(join(DIR, 'shaders'), { recursive: true });
writeFileSync(join(DIR, 'shaders', 'pack.wgsl'), pack);
writeFileSync(join(DIR, 'spec.json'), JSON.stringify(spec));
writeFileSync(join(DIR, 'index.html'), indexHtml);
writeFileSync(join(DIR, 'main.js'), mainJs);
writeFileSync(join(DIR, 'page.js'), pageJs);
writeFileSync(join(DIR, 'style.css'), css);

const fam = {}; for (const [, f] of CELLS) fam[f] = (fam[f] || 0) + 1;
console.log('cells       : ' + CELLS.length);
console.log('families    : ' + JSON.stringify(fam));
console.log('fs_ entries : ' + (pack.match(/@fragment fn fs_/g) || []).length);
console.log('names unique: ' + (new Set(CELLS.map(c => c[0])).size === CELLS.length));
console.log('wrote pack.wgsl, spec.json, index.html, main.js, page.js, style.css');
