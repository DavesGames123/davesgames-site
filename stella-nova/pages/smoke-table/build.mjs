// ============================================================================
//  SMOKE TABLE  ·  build.mjs — the single source of truth for the page
// ────────────────────────────────────────────────────────────────────────────
//  One generator emits every file the page needs, so the cell names, the WGSL
//  entry points and the tile divs cannot drift apart. Run it with:
//      node build.mjs
//  It writes shaders/pack.wgsl, spec.json, page.js, main.js, index.html and
//  style.css into this folder. The shared table-engine drives the result; it
//  renders one fragment entry point fs_<name> per tile from a shared uniform.
//
//  MODEL
//    Every cell is procedural smoke. A cell body reads uv (x centered, y 0 at
//    the floor and 1 at the top), t (the hover clock) and k (four knobs), then
//    returns smokePresent(density, uv). Density runs through smokeCol, a ramp
//    from the smoke swatch to the lit swatch, over a dark backdrop from the
//    ground swatch. The palette pickers push every cell at once. The cores fake
//    the compute smoke sims single-pass: billow noise, curl-of-noise swirl,
//    rising plumes with dissipation, drift, fog bands, rings and diffusion.
//
//  GREP MAP (pack.wgsl)
//    struct SmokeU ..... the shared uniform block
//    fn fuv ............ pixel to smoke uv
//    fn pnoise/fbm ..... Perlin base and the fractal sums
//    fn billow ......... 1 - turbulence (puffy)   ·  fn curl .... curl of fbm
//    fn smokeCol ....... the smoke ramp           ·  fn smokePresent finisher
//    fn plumeD ......... rising plume   ·  fn billowD/fogD/driftD/wispD cores
//    fn ringD .......... smoke ring     ·  fn diffuseD/sheets .. ink and light
//    @fragment fs_* .... the 60 cells
// ============================================================================
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));

// ── families (legend order, cool smoke hues) ─────────────────────────────────
const FAM = {
  plumes:   'rgba(150,160,175,0.14)',
  billows:  'rgba(175,180,190,0.13)',
  wisps:    'rgba(130,145,168,0.14)',
  drift:    'rgba(140,158,172,0.12)',
  fog:      'rgba(165,172,182,0.12)',
  rings:    'rgba(120,152,178,0.14)',
  diffuse:  'rgba(158,142,190,0.14)',
  stylized: 'rgba(168,158,146,0.13)',
};

// ── the WGSL helper library (shared by every cell) ──────────────────────────
const HELPERS = `// ═══════════════════════════════════════════════════════════════════════════
//  SMOKE TABLE  ·  one fragment shader per cell, procedural smoke each. Every
//  cell reads uv (x centered, y 0 floor .. 1 top), the hover clock t and four
//  knobs k, then returns smokePresent(density, uv). Density runs through
//  smokeCol, a ramp from the smoke swatch to the lit swatch over a dark
//  backdrop, so the palette drives all cells. Noise after Perlin (pcg3d
//  hashing); billow is 1 - turbulence; the swirl is a curl of fbm; the sheets
//  follow the caustics idea. The plume, fog, drift, ring and diffusion cores
//  are single-pass fakes of the compute smoke sims.
// ═══════════════════════════════════════════════════════════════════════════
const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.283185307179586;

struct SmokeU {
    size: vec2f, time: f32, pixelScale: f32,
    ink: vec4f, tone: vec4f, cream: vec4f,
    exposure: f32, contrast: f32, glow: f32, pad1: f32,
    k: vec4f,
};
@group(0) @binding(0) var<uniform> u: SmokeU;

@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(p[i], 0.0, 1.0);
}

// x centered, y 0 at the floor and 1 at the top (square cells)
fn fuv(fp: vec2f) -> vec2f {
    let p = fp / max(u.pixelScale, 0.001);
    let n = (p - 0.5 * u.size) / max(min(u.size.x, u.size.y), 1.0);
    return vec2f(n.x, 0.5 - n.y);
}

// ── hashing and Perlin noise ────────────────────────────────────────────────
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
fn fbm01(p: vec2f, oct: i32, seed: u32) -> f32 { return 0.5 + 0.5 * fbm(p, oct, seed); }
fn turb(p0: vec2f, oct: i32, seed: u32) -> f32 {
    var p = p0; var a = 0.5; var s = 0.0; var nrm = 0.0;
    for (var i: i32 = 0; i < 8; i++) { if (i >= oct) { break; } s += a * abs(pnoise(p, seed + u32(i))); nrm += a; a *= 0.5; p = rot2(0.5) * p * 2.0; }
    return s / max(nrm, 1e-4);
}
fn ridged(p: vec2f, oct: i32, seed: u32) -> f32 { let v = 1.0 - turb(p, oct, seed); return v * v; }
fn billow(p: vec2f, oct: i32, seed: u32) -> f32 { return clamp(1.0 - turb(p, oct, seed), 0.0, 1.0); }

// curl of an fbm scalar field: a smooth, divergence-free swirl
fn curl(p: vec2f, seed: u32) -> vec2f {
    let e = 0.01;
    let n1 = fbm(p + vec2f(0.0, e), 4, seed); let n2 = fbm(p - vec2f(0.0, e), 4, seed);
    let n3 = fbm(p + vec2f(e, 0.0), 4, seed); let n4 = fbm(p - vec2f(e, 0.0), 4, seed);
    return vec2f(n1 - n2, -(n3 - n4)) / (2.0 * e);
}
fn sheets(p0: vec2f, t: f32, iters: i32) -> f32 {
    var q = p0; var s = 0.0;
    for (var i: i32 = 0; i < 6; i++) { if (i >= iters) { break; }
        q = rot2(0.9) * q + vec2f(sin(t * 0.7 + f32(i)), cos(t * 0.5 - f32(i))) * 0.4;
        s += abs(sin(q.x * 2.0 + t) + sin(q.y * 2.3 - t * 0.8));
    }
    return pow(clamp(1.0 - s * 0.1, 0.0, 1.0), 2.0);
}

// ── the smoke palette and the finisher ──────────────────────────────────────
fn smokeCol(d: f32) -> vec3f { return mix(u.tone.rgb, u.cream.rgb, smoothstep(0.15, 1.0, clamp(d, 0.0, 1.0))); }
fn smokePresent(density: f32, uv: vec2f) -> vec4f {
    var dd = (density - 0.5) * u.contrast + 0.5;
    dd = max(dd, 0.0) * u.exposure;
    let bg = u.ink.rgb * (0.75 + 0.9 * clamp(uv.y, 0.0, 1.0));
    let a = smoothstep(0.03, 0.55, dd);
    var col = mix(bg, smokeCol(dd), a);
    col += u.cream.rgb * max(dd - 1.0, 0.0) * 0.3 * u.glow;
    return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}
fn posth(v: f32, n: f32) -> f32 { return floor(v * n + 0.5) / n; }

// ── smoke cores ─────────────────────────────────────────────────────────────
fn plumeD(uv: vec2f, t: f32, wid: f32, rise: f32, curls: f32) -> f32 {
    let spread = 0.2 + 0.95 * uv.y;
    let sx = wid * spread + 0.04;
    var p = vec2f(uv.x / sx, uv.y * 1.7 - t * rise);
    p += curl(p * 0.8 + vec2f(0.0, t * 0.1), 71u) * curls;
    let d = billow(p, 5, 3u);
    let prof = exp(-(uv.x * uv.x) / (sx * sx * 1.6));
    let taper = smoothstep(1.35, -0.05, uv.y);
    return clamp(prof * (0.28 + 1.15 * d) * taper - uv.y * 0.06, 0.0, 1.6);
}
fn billowD(uv: vec2f, t: f32, sc: f32, drift: f32, oct: i32) -> f32 {
    let p = vec2f(uv.x * sc, uv.y * sc - t * drift);
    return billow(p, oct, 8u) * 1.15;
}
fn fogD(uv: vec2f, t: f32, height: f32, soft: f32) -> f32 {
    let n = fbm01(vec2f(uv.x * 2.2 - t * 0.15, uv.y * 3.0 + t * 0.05), 5, 8u);
    let band = smoothstep(height + soft, height - soft, uv.y);
    return clamp(band * (0.4 + 0.9 * n), 0.0, 1.4);
}
fn driftD(uv: vec2f, t: f32, sp: f32, sc: f32) -> f32 {
    var p = vec2f(uv.x * sc - t * sp, uv.y * sc * 0.8);
    p += curl(p * 0.6, 51u) * 0.4;
    return clamp(billow(p, 5, 17u) * 1.1, 0.0, 1.4);
}
fn wispD(uv: vec2f, t: f32, sc: f32, sharp: f32) -> f32 {
    var p = vec2f(uv.x * sc, uv.y * sc - t * 0.6);
    p += curl(p * 0.9 + vec2f(0.0, t * 0.15), 61u) * 0.8;
    let r = ridged(p, 5, 13u);
    let taper = smoothstep(1.3, -0.05, uv.y);
    return clamp(pow(r, sharp) * taper * 1.7, 0.0, 1.5);
}
fn ringD(uv: vec2f, t: f32, speed: f32, thick: f32) -> f32 {
    let life = fract(t * speed);
    let c = uv - vec2f(0.0, 0.15 + life * 0.7);
    let rr = length(c * vec2f(1.0, 1.3));
    let n = fbm01(uv * 4.0 + vec2f(0.0, t * 0.1), 4, 8u);
    let ring = smoothstep(thick, 0.0, abs(rr - 0.16));
    return clamp(ring * (0.5 + 0.8 * n) * (1.0 - life * 0.7), 0.0, 1.4);
}
fn diffuseD(uv: vec2f, t: f32, amt: f32) -> f32 {
    var p = uv * 3.0;
    p += curl(p * 0.7 + vec2f(0.0, t * 0.08), 91u) * (0.6 + amt);
    let d = fbm01(p, 5, 21u);
    return clamp(smoothstep(0.35, 0.75, d) * 1.3, 0.0, 1.5);
}
`;

// ── the 60 cells. body reads uv, t, k and returns a vec4f. ───────────────────
const CELLS = [
  // ---------------------------------------------------------------- plumes
  ['chimney', 'plumes', 'a narrow plume drawn straight up a flue', ['width', 'curl', 'rise', ''],
   `  return smokePresent(plumeD(uv, t, mix(0.08, 0.14, k.x), mix(1.0, 1.8, k.z), 0.3 + 0.6 * k.y), uv);`],
  ['column', 'plumes', 'a steady medium smoke column', ['width', 'curl', 'rise', ''],
   `  return smokePresent(plumeD(uv, t, mix(0.14, 0.24, k.x), mix(0.9, 1.7, k.z), 0.4 + 0.7 * k.y), uv);`],
  ['billow_stack', 'plumes', 'a plume stacked with rolling billows', ['width', 'roll', 'rise', ''],
   `  var d = plumeD(uv, t, mix(0.16, 0.3, k.x), mix(0.9, 1.6, k.z), 0.5);
  d = max(d, billowD(uv, t, mix(3.0, 5.0, k.y), 0.8, 5) * smoothstep(1.2, 0.0, uv.y) * 0.8);
  return smokePresent(d, uv);`],
  ['wispy_plume', 'plumes', 'a plume that frays into wisps as it rises', ['width', 'fray', 'rise', ''],
   `  let d = plumeD(uv, t, mix(0.12, 0.22, k.x), mix(1.0, 1.8, k.z), 0.8 + 0.8 * k.y);
  return smokePresent(d, uv);`],
  ['twin_plume', 'plumes', 'two plumes leaning together', ['gap', 'curl', 'rise', ''],
   `  let g = mix(0.12, 0.28, k.x);
  var d = plumeD(uv + vec2f(g, 0.0), t, 0.13, mix(1.0, 1.7, k.z), 0.5 + 0.5 * k.y);
  d = max(d, plumeD(uv - vec2f(g, 0.0), t + 3.0, 0.13, mix(1.0, 1.7, k.z), 0.5 + 0.5 * k.y));
  return smokePresent(d, uv);`],
  ['industrial', 'plumes', 'a dense dark plume of soot', ['width', 'soot', 'rise', ''],
   `  let d = plumeD(uv, t, mix(0.2, 0.34, k.x), mix(0.8, 1.5, k.z), 0.5);
  return smokePresent(d * (1.1 + 0.4 * k.y) - 0.05, uv);`],
  ['steam', 'plumes', 'a thin pale steam that thins fast', ['width', 'curl', 'rise', ''],
   `  let d = plumeD(uv, t, mix(0.07, 0.13, k.x), mix(1.4, 2.4, k.z), 0.6 + 0.7 * k.y);
  return smokePresent(d * 0.7 + 0.05, uv);`],
  ['backpuff', 'plumes', 'a plume that rises in pulsing puffs', ['width', 'pulse', 'rise', ''],
   `  let puff = 0.7 + 0.5 * sin(uv.y * 5.0 - t * mix(2.0, 5.0, k.y));
  return smokePresent(plumeD(uv, t, mix(0.14, 0.26, k.x), mix(0.9, 1.6, k.z), 0.5) * puff, uv);`],
  ['lazy', 'plumes', 'a slow low plume that barely lifts', ['width', 'curl', 'rise', ''],
   `  return smokePresent(plumeD(vec2f(uv.x, uv.y * 1.3), t, mix(0.16, 0.28, k.x), mix(0.4, 0.9, k.z), 0.6 + 0.8 * k.y), uv);`],

  // ---------------------------------------------------------------- billows
  ['puff', 'billows', 'a field of puffy billow cloud', ['scale', 'octaves', 'drift', ''],
   `  return smokePresent(billowD(uv, t, mix(2.0, 5.0, k.x), mix(0.3, 1.0, k.z), i32(mix(4.0, 6.0, k.y))), uv);`],
  ['cauliflower', 'billows', 'tight cauliflower billows, high detail', ['scale', 'drift', '', ''],
   `  var d = billowD(uv, t, mix(3.0, 6.0, k.x), mix(0.4, 1.0, k.y), 6);
  d = d * (0.6 + 0.6 * billowD(uv, t + 4.0, mix(6.0, 10.0, k.x), 0.5, 4));
  return smokePresent(d * 1.2, uv);`],
  ['rolling', 'billows', 'billows rolling as they climb', ['scale', 'roll', 'drift', ''],
   `  let p = rot2(uv.y * mix(1.0, 3.0, k.y)) * vec2f(uv.x, uv.y);
  return smokePresent(billow(vec2f(p.x * mix(2.5, 5.0, k.x), p.y * mix(2.5, 5.0, k.x) - t * mix(0.4, 1.0, k.z)), 5, 8u) * 1.15, uv);`],
  ['thunderhead', 'billows', 'a big dark low-frequency billow head', ['scale', 'mass', 'drift', ''],
   `  let d = billowD(uv, t, mix(1.4, 3.0, k.x), mix(0.2, 0.7, k.z), 5);
  return smokePresent(d * (1.2 + 0.5 * k.y) * smoothstep(-0.1, 0.6, uv.y), uv);`],
  ['cotton', 'billows', 'soft light cotton billows', ['scale', 'soft', 'drift', ''],
   `  let d = billowD(uv, t, mix(2.0, 4.0, k.x), mix(0.3, 0.8, k.z), 4);
  return smokePresent(smoothstep(0.1, 0.9, d) * 0.9 + 0.06, uv);`],
  ['turbulent', 'billows', 'churning turbulent billows', ['scale', 'octaves', 'drift', ''],
   `  return smokePresent(billowD(uv, t, mix(3.0, 6.0, k.x), mix(0.6, 1.4, k.z), i32(mix(6.0, 8.0, k.y))), uv);`],
  ['boil', 'billows', 'billows that boil in place', ['scale', 'churn', '', ''],
   `  var p = vec2f(uv.x, uv.y) * mix(3.0, 6.0, k.x);
  p += curl(p * 0.7 + vec2f(0.0, t * mix(0.3, 1.0, k.y)), 71u) * 0.7;
  return smokePresent(billow(p, 5, 8u) * 1.2, uv);`],
  ['mushroom_cap', 'billows', 'a billowing cap over a thin stem', ['cap', 'stem', 'rise', ''],
   `  let stem = plumeD(uv, t, mix(0.08, 0.16, k.y), mix(0.9, 1.6, k.z), 0.4);
  let cy = uv.y - mix(0.55, 0.8, k.x);
  let cap = exp(-(uv.x * uv.x * 2.5 + cy * cy * 12.0)) * (0.6 + 0.7 * billowD(uv, t, 4.0, 0.5, 5));
  return smokePresent(max(stem, cap * 1.2), uv);`],

  // ---------------------------------------------------------------- wisps
  ['curl_wisp', 'wisps', 'curling wisps from a curl-noise field', ['scale', 'sharp', '', ''],
   `  return smokePresent(wispD(uv, t, mix(2.5, 5.0, k.x), mix(1.0, 3.0, k.y)), uv);`],
  ['tendrils', 'wisps', 'thin ridged tendrils reaching up', ['scale', 'sharp', 'rise', ''],
   `  var p = vec2f(uv.x * mix(3.0, 6.0, k.x), uv.y * mix(3.0, 6.0, k.x) - t * mix(0.5, 1.2, k.z));
  p += curl(p * 0.8, 61u) * 0.6;
  return smokePresent(pow(ridged(p, 6, 13u), mix(1.5, 3.5, k.y)) * smoothstep(1.3, -0.05, uv.y) * 1.8, uv);`],
  ['smoke_trail', 'wisps', 'a trail drifting off at an angle', ['scale', 'lean', 'rise', ''],
   `  let lean = uv + vec2f(mix(0.1, 0.5, k.y) * uv.y, 0.0);
  return smokePresent(wispD(lean, t, mix(2.5, 5.0, k.x), 2.0), uv);`],
  ['incense', 'wisps', 'a single thin incense ribbon', ['wander', 'sharp', 'rise', ''],
   `  let path = mix(0.1, 0.3, k.x) * sin(uv.y * 3.5 + t * 1.2);
  let x = (uv.x - path) / 0.06;
  var p = vec2f(x, uv.y * 4.0 - t * mix(0.8, 1.6, k.z));
  let d = (1.0 - smoothstep(0.0, 1.2, abs(x))) * pow(billow(p, 5, 3u), mix(1.0, 2.5, k.y));
  return smokePresent(d * smoothstep(1.2, -0.05, uv.y) * 1.6, uv);`],
  ['ribbon', 'wisps', 'a broad ribbon of smoke folding over', ['scale', 'fold', 'rise', ''],
   `  var p = vec2f(uv.x * mix(2.0, 4.0, k.x), uv.y * 2.5 - t * mix(0.6, 1.3, k.z));
  p += vec2f(sin(p.y * 1.5 + t) * mix(0.3, 1.0, k.y), 0.0);
  return smokePresent(billow(p, 5, 8u) * smoothstep(1.3, -0.05, uv.y) * 1.2, uv);`],
  ['lace', 'wisps', 'fine lacy filaments of smoke', ['scale', 'sharp', '', ''],
   `  return smokePresent(wispD(uv, t, mix(5.0, 9.0, k.x), mix(2.0, 4.0, k.y)), uv);`],
  ['serpentine', 'wisps', 'an S-curving serpent of smoke', ['wander', 'width', 'rise', ''],
   `  let path = mix(0.12, 0.32, k.x) * sin(uv.y * 3.0 + t * 1.4) + 0.08 * sin(uv.y * 7.0 - t);
  let x = (uv.x - path) / mix(0.1, 0.2, k.y);
  var p = vec2f(x, uv.y * 3.0 - t * mix(0.6, 1.3, k.z));
  let d = (1.0 - smoothstep(0.0, 1.3, abs(x))) * billow(p, 5, 3u);
  return smokePresent(d * smoothstep(1.2, -0.05, uv.y) * 1.5, uv);`],
  ['vanishing', 'wisps', 'wisps that dissolve halfway up', ['scale', 'sharp', 'fade', ''],
   `  let d = wispD(uv, t, mix(3.0, 6.0, k.x), mix(1.5, 3.0, k.y));
  return smokePresent(d * smoothstep(mix(0.5, 0.9, k.z), 0.0, uv.y), uv);`],

  // ---------------------------------------------------------------- drift
  ['sidewind', 'drift', 'smoke pushed sideways on a steady wind', ['speed', 'scale', '', ''],
   `  return smokePresent(driftD(uv, t, mix(0.3, 1.0, k.x), mix(2.0, 4.0, k.y)), uv);`],
  ['gust', 'drift', 'drifting smoke shoved by gusts', ['speed', 'gust', 'scale', ''],
   `  let g = 1.0 + mix(0.0, 0.8, k.y) * sin(t * 1.5 + uv.x * 3.0);
  return smokePresent(driftD(uv, t * g, mix(0.4, 1.0, k.x), mix(2.0, 4.0, k.z)), uv);`],
  ['crosswind', 'drift', 'smoke shearing on a diagonal wind', ['speed', 'shear', 'scale', ''],
   `  let sh = uv + vec2f(0.0, mix(0.1, 0.5, k.y) * uv.x);
  return smokePresent(driftD(sh, t, mix(0.3, 0.9, k.x), mix(2.0, 4.0, k.z)), uv);`],
  ['slow_haze', 'drift', 'a slow wide haze creeping across', ['speed', 'scale', '', ''],
   `  return smokePresent(driftD(uv, t, mix(0.1, 0.4, k.x), mix(1.2, 2.5, k.y)) * 0.9, uv);`],
  ['sweep', 'drift', 'fast smoke sweeping through the frame', ['speed', 'scale', '', ''],
   `  return smokePresent(driftD(uv, t, mix(0.8, 1.8, k.x), mix(2.5, 5.0, k.y)), uv);`],
  ['layered_drift', 'drift', 'two smoke layers drifting at odds', ['speed', 'split', 'scale', ''],
   `  var d = driftD(uv, t, mix(0.3, 0.9, k.x), mix(2.0, 4.0, k.z));
  d = max(d, driftD(uv + vec2f(0.0, 0.2), -t * (0.5 + 0.5 * k.y), 0.6, mix(1.5, 3.0, k.z)) * 0.8);
  return smokePresent(d, uv);`],
  ['smog_bank', 'drift', 'a dense low smog bank rolling by', ['speed', 'scale', 'top', ''],
   `  let d = driftD(uv, t, mix(0.2, 0.7, k.x), mix(2.0, 4.0, k.y));
  return smokePresent(d * smoothstep(mix(0.5, 0.9, k.z), 0.0, uv.y) * 1.3, uv);`],

  // ---------------------------------------------------------------- fog
  ['ground_fog', 'fog', 'fog pooled low across the floor', ['height', 'soft', '', ''],
   `  return smokePresent(fogD(uv, t, mix(0.2, 0.4, k.x), mix(0.1, 0.3, k.y)), uv);`],
  ['mist', 'fog', 'a light high mist, barely there', ['height', 'soft', '', ''],
   `  return smokePresent(fogD(uv, t, mix(0.4, 0.7, k.x), mix(0.2, 0.4, k.y)) * 0.7 + 0.05, uv);`],
  ['valley_fog', 'fog', 'thick fog filling the lower frame', ['height', 'soft', '', ''],
   `  return smokePresent(fogD(uv, t, mix(0.35, 0.6, k.x), mix(0.05, 0.2, k.y)) * 1.3, uv);`],
  ['rolling_fog', 'fog', 'fog rolling in on a slow wind', ['height', 'speed', 'scale', ''],
   `  let d = fogD(uv, t, mix(0.3, 0.55, k.x), 0.2) * 0.7 + driftD(uv, t, mix(0.2, 0.6, k.y), mix(2.0, 3.5, k.z)) * smoothstep(0.6, 0.0, uv.y) * 0.6;
  return smokePresent(d, uv);`],
  ['haze_layer', 'fog', 'a thin uniform haze with faint texture', ['density', 'scale', '', ''],
   `  let n = fbm01(uv * mix(2.0, 5.0, k.y) + vec2f(t * 0.1, 0.0), 4, 8u);
  return smokePresent(mix(0.1, 0.5, k.x) * (0.6 + 0.6 * n), uv);`],
  ['marsh', 'fog', 'patchy marsh fog in torn clumps', ['patch', 'scale', '', ''],
   `  let n = fbm01(vec2f(uv.x * mix(2.0, 4.0, k.y) - t * 0.1, uv.y * 3.0), 5, 8u);
  let d = smoothstep(mix(0.4, 0.6, k.x), 0.75, n) * smoothstep(0.6, 0.0, uv.y);
  return smokePresent(d * 1.3, uv);`],
  ['dawn_mist', 'fog', 'mist that brightens toward the top', ['height', 'lift', '', ''],
   `  let d = fogD(uv, t, mix(0.4, 0.7, k.x), 0.3);
  return smokePresent(d * (0.7 + mix(0.0, 0.8, k.y) * uv.y), uv);`],

  // ---------------------------------------------------------------- rings
  ['smoke_ring', 'rings', 'a single ring lifting and spreading', ['speed', 'thick', '', ''],
   `  return smokePresent(ringD(uv, t, mix(0.15, 0.4, k.x), mix(0.05, 0.13, k.y)), uv);`],
  ['ring_train', 'rings', 'a train of rings puffed one after another', ['speed', 'thick', '', ''],
   `  var d = ringD(uv, t, mix(0.2, 0.5, k.x), mix(0.05, 0.12, k.y));
  d = max(d, ringD(uv, t + 1.7, mix(0.2, 0.5, k.x), mix(0.05, 0.12, k.y)));
  d = max(d, ringD(uv, t + 3.4, mix(0.2, 0.5, k.x), mix(0.05, 0.12, k.y)));
  return smokePresent(d, uv);`],
  ['vortex', 'rings', 'a slow smoke vortex winding around', ['spin', 'scale', '', ''],
   `  let c = uv - vec2f(0.0, 0.4);
  let ang = atan2(c.y, c.x); let r = length(c);
  var p = vec2f(ang * 1.5 + r * 3.0 - t * mix(0.3, 1.0, k.x), r * mix(3.0, 6.0, k.y));
  p += curl(p * 0.5, 71u) * 0.6;
  return smokePresent(billow(p, 5, 8u) * smoothstep(0.85, 0.05, r) * 1.2, uv);`],
  ['puff_ring', 'rings', 'a ring with a billowing filled core', ['speed', 'fill', '', ''],
   `  let ring = ringD(uv, t, mix(0.15, 0.4, k.x), 0.12);
  let fill = billowD(uv, t, 4.0, 0.6, 5) * mix(0.3, 0.8, k.y) * smoothstep(1.1, 0.0, uv.y);
  return smokePresent(max(ring, fill * 0.8), uv);`],
  ['halo', 'rings', 'a wide ring dilating into a halo', ['speed', 'thick', '', ''],
   `  return smokePresent(ringD(uv * 0.8 + vec2f(0.0, 0.1), t, mix(0.1, 0.3, k.x), mix(0.08, 0.18, k.y)), uv);`],
  ['double_ring', 'rings', 'two rings crossing as they rise', ['speed', 'gap', '', ''],
   `  var d = ringD(uv + vec2f(mix(0.05, 0.15, k.y), 0.0), t, mix(0.2, 0.4, k.x), 0.1);
  d = max(d, ringD(uv - vec2f(mix(0.05, 0.15, k.y), 0.0), t + 0.8, mix(0.2, 0.4, k.x), 0.1));
  return smokePresent(d, uv);`],

  // ---------------------------------------------------------------- diffuse
  ['ink_water', 'diffuse', 'ink blooming and folding in water', ['warp', 'scale', '', ''],
   `  return smokePresent(diffuseD(uv, t, mix(0.2, 1.2, k.x)), uv);`],
  ['dye_swirl', 'diffuse', 'dye pulled around a slow swirl', ['spin', 'warp', '', ''],
   `  let c = uv - vec2f(0.0, 0.45);
  let p = rot2(length(c) * mix(2.0, 6.0, k.x) - t * 0.4) * c + 0.5;
  return smokePresent(diffuseD(p, t, mix(0.3, 1.0, k.y)), uv);`],
  ['bloom', 'diffuse', 'a plume of dye blooming from the base', ['warp', 'rise', '', ''],
   `  var p = vec2f(uv.x * 3.0, uv.y * 3.0 - t * mix(0.3, 0.9, k.y));
  p += curl(p * 0.7, 91u) * (0.6 + mix(0.0, 0.8, k.x));
  let d = smoothstep(0.35, 0.75, fbm01(p, 5, 21u)) * smoothstep(1.3, -0.05, uv.y);
  return smokePresent(d * 1.3, uv);`],
  ['dispersion', 'diffuse', 'ink dispersing into fine threads', ['warp', 'scale', '', ''],
   `  var p = uv * mix(3.0, 6.0, k.y);
  p += curl(p * 0.8 + vec2f(0.0, t * 0.1), 91u) * (1.0 + mix(0.0, 1.0, k.x));
  return smokePresent(pow(fbm01(p, 6, 21u), 1.6) * 1.4, uv);`],
  ['marble', 'diffuse', 'smoke marbled by overlapping sheets', ['scale', 'flow', '', ''],
   `  var p = uv * mix(2.0, 4.0, k.x);
  p += vec2f(fbm(p + t * 0.05, 4, 33u), fbm(p + 5.2, 4, 41u)) * mix(0.4, 1.2, k.y);
  return smokePresent(fbm01(p, 5, 21u) * 1.2, uv);`],
  ['caustic_smoke', 'diffuse', 'light sheeting through drifting smoke', ['scale', 'iters', 'flow', ''],
   `  let s = sheets(uv * mix(1.5, 4.0, k.x), t * mix(0.3, 1.2, k.z), i32(mix(3.0, 6.0, k.y)));
  return smokePresent(s * 1.2, uv);`],
  ['tendril_ink', 'diffuse', 'sharp ink tendrils threading out', ['warp', 'sharp', '', ''],
   `  var p = uv * 4.0;
  p += curl(p * 0.7 + vec2f(0.0, t * 0.08), 91u) * (0.8 + mix(0.0, 0.8, k.x));
  return smokePresent(pow(ridged(p, 6, 21u), mix(1.5, 3.0, k.y)) * 1.5, uv);`],
  ['cloud_deck', 'diffuse', 'a wide soft deck of diffuse cloud', ['scale', 'soft', '', ''],
   `  let d = diffuseD(vec2f(uv.x, uv.y * 0.7 + 0.15), t, mix(0.2, 0.8, k.x));
  return smokePresent(smoothstep(0.1, 0.9, d) * (0.9 + 0.3 * k.y), uv);`],

  // ---------------------------------------------------------------- stylized
  ['poster_smoke', 'stylized', 'a plume flattened into poster bands', ['width', 'bands', 'rise', ''],
   `  let d = plumeD(uv, t, mix(0.16, 0.3, k.x), mix(0.9, 1.6, k.z), 0.5);
  return smokePresent(posth(d, mix(3.0, 6.0, k.y)), uv);`],
  ['contour_smoke', 'stylized', 'smoke drawn as iso-density contours', ['scale', 'lines', 'drift', ''],
   `  let d = billowD(uv, t, mix(2.5, 5.0, k.x), mix(0.4, 1.0, k.z), 5);
  let band = abs(fract(d * mix(4.0, 9.0, k.y)) - 0.5);
  let line = smoothstep(0.08, 0.0, band);
  return smokePresent(posth(d, 4.0) * 0.6 + line * d, uv);`],
  ['pixel_smoke', 'stylized', 'blocky pixel smoke, low resolution', ['pixels', 'bands', 'drift', ''],
   `  let g = mix(16.0, 40.0, k.x);
  let cell = (floor(uv * g) + 0.5) / g;
  let d = billow(vec2f(cell.x * mix(3.0, 6.0, k.y), cell.y * 4.0 - t * mix(0.4, 1.0, k.z)), 4, 8u);
  return smokePresent(posth(d, 5.0), uv);`],
  ['cel_smoke', 'stylized', 'cel-shaded billows in flat steps', ['scale', 'steps', 'drift', ''],
   `  let d = billowD(uv, t, mix(2.5, 5.0, k.x), mix(0.4, 1.0, k.z), 5);
  return smokePresent(posth(d, mix(3.0, 6.0, k.y)), uv);`],
  ['threshold_puff', 'stylized', 'hard-edged puffs from a threshold', ['scale', 'cut', 'drift', ''],
   `  let d = billowD(uv, t, mix(2.5, 5.0, k.x), mix(0.4, 1.0, k.z), 5);
  return smokePresent(smoothstep(mix(0.45, 0.7, k.y), mix(0.55, 0.8, k.y), d), uv);`],
  ['hatch_smoke', 'stylized', 'billows shaded with diagonal hatching', ['scale', 'hatch', 'drift', ''],
   `  let d = billowD(uv, t, mix(2.5, 5.0, k.x), mix(0.4, 1.0, k.z), 5);
  let hatch = 0.5 + 0.5 * sin((uv.x + uv.y) * mix(30.0, 70.0, k.y));
  return smokePresent(d * mix(0.5, 1.0, smoothstep(0.15, 0.7, d) * hatch), uv);`],
  ['duotone_smoke', 'stylized', 'smoke split hard into ground and lit', ['scale', 'cut', 'drift', ''],
   `  let d = billowD(uv, t, mix(2.5, 5.0, k.x), mix(0.4, 1.0, k.z), 5);
  let s = smoothstep(mix(0.4, 0.65, k.y), mix(0.5, 0.75, k.y), d);
  return vec4f(clamp(mix(u.ink.rgb, u.cream.rgb, s), vec3f(0.0), vec3f(1.0)), 1.0);`],
];

// ── emit pack.wgsl ───────────────────────────────────────────────────────────
const frag = ([name, , , , body]) =>
  `@fragment fn fs_${name}(@builtin(position) fp: vec4f) -> @location(0) vec4f {\n  let uv = fuv(fp.xy);\n  let t = u.time;\n  let k = u.k;\n${body}\n}`;
const pack = HELPERS + '\n// ── the 60 smoke cells ───────────────────────────────────────────────────────\n' +
  CELLS.map(frag).join('\n\n') + '\n';

// ── emit spec.json ───────────────────────────────────────────────────────────
const spec = {
  cols: 6,
  uniform_bytes: 96,
  cells: CELLS.map(([name, family, species, knobs]) => ({ name, family, species, knobs, defaults: [0.5, 0.5, 0.5, 0.5], fn: 'fs_' + name })),
  gens: [
    { id: 'exposure', title: 'Exposure · density', fn: 'flat', period: 10, amp: 0.4, bias: 0.5, phase: 0,
      map: 'y => Math.pow(2, (y - 0.5) * 4)', unit: "v => (Math.log2(v) >= 0 ? '+' : '') + Math.log2(v).toFixed(1) + ' ev'" },
    { id: 'tempo', title: 'Tempo · hover speed', fn: 'flat', period: 8, amp: 0.0, bias: 0.5, phase: 0,
      map: 'y => 0.1 + 2.9 * y', unit: "v => v.toFixed(2) + 'x'" },
    { id: 'contrast', title: 'Contrast · smoke edge', fn: 'flat', period: 10, amp: 0.3, bias: 0.5, phase: 0,
      map: 'y => 0.5 + 2.0 * y', unit: "v => v.toFixed(2) + 'x'" },
  ],
  swatches: [
    { id: 'ink', label: 'Ground', hex: '#0b0d11' },
    { id: 'tone', label: 'Smoke', hex: '#565c66' },
    { id: 'cream', label: 'Lit', hex: '#c9cdd4' },
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
<title>Smoke Table // Stella Nova</title>
<!--
  ════════════════════════════════════════════════════════════════════════════
   SMOKE TABLE  ·  page shell (GENERATED by build.mjs — do not edit by hand)
  ────────────────────────────────────────────────────────────────────────────
   Static markup only. main.js loads the data and hands it to the shared
   table-engine, which builds the sidebar and the frame loop and drives page.js.
   ${CELLS.length} procedural smoke effects, one fragment shader per cell.
  ════════════════════════════════════════════════════════════════════════════
-->
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=JetBrains+Mono:wght@300;400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="style.css">
</head>
<body>

<script>if(window!==window.top)document.documentElement.classList.add("in-frame")</script>
<div class="grid-bg"></div>
<div class="topbar">
  <div class="topbar-l"><span class="sys-name">Stella Nova</span><span class="sys-status">Smoke Table</span></div>
  <div class="topbar-r">SYS // <strong>WGSL SHADER LAB</strong></div>
</div>
<div id="side">
  <div class="side-head"><div class="big">smoke</div><div class="sub">|${CELLS.length} effects · ${Object.keys(FAM).length} families⟩</div></div>
  <div class="legend">${legend}</div>
  <div id="gens"></div>
  <div class="sec"><div class="sec-lbl">Palette</div><div class="swatches">${swatchHtml}</div></div>
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
//  SMOKE TABLE  ·  main.js — data load and boot (the entry module, GENERATED)
//  Regenerate with: node build.mjs
// ============================================================================
import { bootTable } from '../../lib/table-engine.js';
import { loadShaders } from '../../lib/shaders.js';
import { PAGE } from './page.js';

const SH = await loadShaders(import.meta.url, ['shaders/pack.wgsl']);
const spec = await (await fetch(new URL('spec.json', import.meta.url))).json();

bootTable(PAGE, { spec, pack: SH['shaders/pack.wgsl'] });
`;

const pageJs = `// ============================================================================
//  SMOKE TABLE  ·  page.js — the per-page PAGE object (GENERATED)
// ────────────────────────────────────────────────────────────────────────────
//  ${CELLS.length} procedural smokes; one fragment shader per cell, each reading only a
//  shared uniform buffer (no source texture). Same contract as the fire tables.
//  UNIFORM LAYOUT (96 bytes, struct SmokeU in shaders/pack.wgsl)
//    0..1 size · 2 time · 3 pixelScale · 4..7 ink · 8..11 tone · 12..15 cream
//    16 exposure · 17 contrast · 18 glow · 19 pad · 20..23 k
// ============================================================================
export const PAGE = {
  async init(ctx) {
    const { device, format, tiles, PACK } = ctx; this.ctx = ctx;
    this.bgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [this.bgl] });
    const module = device.createShaderModule({ code: PACK });
    module.getCompilationInfo().then(info => { const errs = info.messages.filter(m => m.type === 'error'); if (errs.length) for (const t of tiles) ctx.setStatus(t, errs[0].message.slice(0, 120), true); });
    for (const t of tiles) device.createRenderPipelineAsync({ layout, vertex: { module, entryPoint: 'vs_main' }, fragment: { module, entryPoint: 'fs_' + t.s.name, targets: [{ format }] }, primitive: { topology: 'triangle-list' } })
      .then(p => { t.pipeline = p; t.dirty = true; }).catch(e => ctx.setStatus(t, String(e.message || e).slice(0, 120), true));
  },
  bind(surf) { if (!surf.page.bind) surf.page.bind = this.ctx.device.createBindGroup({ layout: this.bgl, entries: [{ binding: 0, resource: { buffer: surf.buf } }] }); return surf.page.bind; },
  draw(enc, t, surf, rect, dpr, dt, now, moving) {
    const { device, G } = this.ctx; const d = surf.data;
    d[0] = rect.width; d[1] = rect.height; d[2] = t.phase; d[3] = dpr;
    d.set([G.ink[0], G.ink[1], G.ink[2], 1], 4); d.set([G.tone[0], G.tone[1], G.tone[2], 1], 8); d.set([G.cream[0], G.cream[1], G.cream[2], 1], 12);
    d[16] = G.exposure; d[17] = G.contrast; d[18] = 1.0; d[19] = 0;
    d.set(t.knobs, 20);
    device.queue.writeBuffer(surf.buf, 0, d);
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: surf.ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(t.pipeline); pass.setBindGroup(0, this.bind(surf)); pass.draw(3); pass.end();
  },
  source(t) { return this.ctx.fnSource('fs_' + t.s.name); },
};
`;

// ── emit style.css (clone color-table, append the smoke families) ────────────
const famCss = Object.entries(FAM).map(([f, c]) =>
  `.f-${f}{--fam:${c};--fam-bg:${c.replace(/[\d.]+\)$/, '0.06)')}}`).join('\n');
const baseCss = readFileSync(join(DIR, '..', 'color-table', 'style.css'), 'utf8');
const css = baseCss + `
/* ── smoke families (appended by build.mjs) ──────────────────────────────── */
${famCss}
.side-head .big{color:#9aa6b4}
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
