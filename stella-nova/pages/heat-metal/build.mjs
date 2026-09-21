// ============================================================================
//  HEAT METAL TABLE  ·  build.mjs — the single source of truth for the page
// ────────────────────────────────────────────────────────────────────────────
//  60 cells of metal heating from underneath a surface. The color follows an
//  idealized blackbody curve (Tanner Helland's temperature-to-RGB fit): cold
//  steel, then dull red, cherry, orange, yellow and white as the energy rises.
//  Hot metal throws sparks. One family instead shows steel tempering (oxide)
//  colors. Run with:  node build.mjs
//
//  MODEL
//    A cell computes a heat field (0..1), a brushed-metal surface value and a
//    spark field, then calls metalPresent. metalPresent turns heat into a
//    temperature through the Energy generator, colors it by blackbody, blends
//    the cold metal out as it glows, and adds sparks that only appear once the
//    metal is hot. The heat fields fake the heat-equation sims single-pass:
//    diffusing hotspots, gradients, weld points and quench patterns.
//
//  GREP MAP (pack.wgsl)
//    struct MetalU .... uniform block  ·  fn blackbody .. temperature to RGB
//    fn temperColor ... steel tempering (oxide) ramp
//    fn brushed ....... anisotropic brushed-metal surface
//    fn diffuseHeat ... heat-equation-like spreading field
//    fn metalSparks ... rising sparks  ·  fn metalPresent .. the finisher
//    @fragment fs_* ... the 60 cells
// ============================================================================
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));

const FAM = {
  forge:     'rgba(255,120,40,0.14)',
  diffusion: 'rgba(255,150,60,0.13)',
  hotspot:   'rgba(255,90,40,0.14)',
  gradient:  'rgba(255,170,80,0.13)',
  quench:    'rgba(120,150,200,0.13)',
  brushed:   'rgba(180,190,205,0.12)',
  spark:     'rgba(255,220,140,0.14)',
  oxide:     'rgba(150,120,200,0.13)',
};

const HELPERS = `// ═══════════════════════════════════════════════════════════════════════════
//  HEAT METAL TABLE  ·  one fragment shader per cell. Metal heats from below a
//  surface. A cell computes a heat field, a brushed surface and a spark field,
//  then calls metalPresent. Color follows an idealized blackbody curve (Tanner
//  Helland fit): cold steel to dull red to cherry to orange to yellow to white.
//  Hot metal throws sparks. The oxide family uses a steel-tempering ramp
//  instead. Noise after Perlin (pcg3d hashing).
// ═══════════════════════════════════════════════════════════════════════════
const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.283185307179586;

struct MetalU {
    size: vec2f, time: f32, pixelScale: f32,
    ink: vec4f, tone: vec4f, cream: vec4f,
    energy: f32, glow: f32, pad0: f32, pad1: f32,
    k: vec4f,
};
@group(0) @binding(0) var<uniform> u: MetalU;

@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(p[i], 0.0, 1.0);
}
fn fuv(fp: vec2f) -> vec2f {
    let p = fp / max(u.pixelScale, 0.001);
    let n = (p - 0.5 * u.size) / max(min(u.size.x, u.size.y), 1.0);
    return vec2f(n.x, 0.5 - n.y);
}

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
fn fbm01(p: vec2f, oct: i32, seed: u32) -> f32 { return 0.5 + 0.5 * fbm(p, oct, seed); }

// ── blackbody: temperature (Kelvin) to approximate sRGB (Tanner Helland) ─────
fn blackbody(tk: f32) -> vec3f {
    let T = clamp(tk, 500.0, 12000.0) / 100.0;
    var r: f32; var g: f32; var b: f32;
    if (T <= 66.0) { r = 255.0; } else { r = 329.698727446 * pow(T - 60.0, -0.1332047592); }
    if (T <= 66.0) { g = 99.4708025861 * log(T) - 161.1195681661; } else { g = 288.1221695283 * pow(T - 60.0, -0.0755148492); }
    if (T >= 66.0) { b = 255.0; } else if (T <= 19.0) { b = 0.0; } else { b = 138.5177312231 * log(T - 10.0) - 305.0447927307; }
    return clamp(vec3f(r, g, b) / 255.0, vec3f(0.0), vec3f(1.0));
}
// steel tempering (oxide) colors: straw, bronze, purple, blue, grey-blue
fn temperColor(x: f32) -> vec3f {
    let s = clamp(x, 0.0, 1.0) * 5.0;
    let cs = array<vec3f, 6>(
        vec3f(0.66, 0.64, 0.56), vec3f(0.86, 0.66, 0.30), vec3f(0.55, 0.30, 0.18),
        vec3f(0.42, 0.24, 0.52), vec3f(0.22, 0.34, 0.74), vec3f(0.48, 0.58, 0.72));
    let i = i32(floor(s)); let f = fract(s);
    let a = cs[clamp(i, 0, 5)]; let b = cs[clamp(i + 1, 0, 5)];
    return mix(a, b, f);
}

// ── metal surface and heat fields ───────────────────────────────────────────
fn brushed(uv: vec2f, freq: f32, ang: f32, detail: f32) -> f32 {
    let p = rot2(ang) * uv;
    let lines = 0.5 + 0.5 * sin(p.y * freq + fbm(p * vec2f(2.0, 22.0), 3, 5u) * 3.0);
    let micro = fbm01(p * vec2f(4.0, 44.0), 2, 9u);
    return clamp(0.35 + 0.5 * lines * detail + 0.25 * micro, 0.0, 1.0);
}
fn diffuseHeat(uv: vec2f, t: f32, sc: f32, seed: u32) -> f32 {
    let p = uv * sc;
    let n = fbm(p, 5, seed);
    let n2 = fbm(p * 0.5 + vec2f(t * 0.05, -t * 0.04), 3, seed + 3u);
    return clamp(0.5 + 0.55 * n + 0.3 * n2, 0.0, 1.0);
}
fn hotspot(uv: vec2f, c: vec2f, r: f32) -> f32 { let d = uv - c; return exp(-dot(d, d) / max(r * r, 1e-4)); }
fn metalSparks(uv: vec2f, t: f32, density: f32, speed: f32, seed: u32) -> f32 {
    let scale = mix(7.0, 16.0, density);
    let q = vec2f(uv.x * scale, (uv.y - t * speed) * scale);
    let i = vec2i(floor(q)); let f = fract(q); var s = 0.0;
    for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) {
        let o = vec2i(x, y); let r = h3(vec3i(i + o, 0), seed);
        if (r.z < 0.6) { continue; }
        let life = fract(r.x + t * speed * 0.5);
        let d = f - vec2f(o) - vec2f(r.x, r.y * 0.4);
        let tw = 0.6 + 0.4 * sin(t * 7.0 + r.y * TAU);
        s += tw * (1.0 - life) * exp(-dot(d, d) * 45.0);
    } }
    return s;
}

// ── the finisher ────────────────────────────────────────────────────────────
fn metalPresent(heat: f32, surf: f32, uv: vec2f, sparkField: f32) -> vec4f {
    let T = clamp(heat * u.energy, 0.0, 1.4);
    let Tc = clamp(T, 0.0, 1.0);
    let tempK = mix(700.0, 6800.0, Tc);
    let emit = blackbody(tempK) * smoothstep(0.06, 0.42, T) * (0.12 + 1.5 * T);
    let cold = u.ink.rgb * (0.5 + 0.75 * surf);
    var col = cold * (1.0 - smoothstep(0.32, 0.95, T)) + emit;
    let sparkVis = sparkField * smoothstep(0.5, 0.85, T);
    col += blackbody(mix(2400.0, 6500.0, Tc)) * sparkVis * (0.8 + 1.1 * u.glow);
    return vec4f(clamp(col, vec3f(0.0), vec3f(1.7)), 1.0);
}
`;

const cells = [];
const C = (name, family, species, knobs, body) => cells.push([name, family, species, knobs, body]);

// ---------------------------------------------------------------- forge (whole billet heats)
C('billet', 'forge', 'a billet heating evenly, color climbing the blackbody curve', ['grain', 'noise', '', ''],
 `  let surf = brushed(uv, mix(30.0, 70.0, k.x), 0.1, 0.8);
  let heat = 0.55 + 0.35 * fbm(uv * 3.0, 4, 3u) * mix(0.3, 1.0, k.y);
  return metalPresent(heat, surf, uv, metalSparks(uv, t, 0.5, 0.9, 71u));`);
C('forge_pulse', 'forge', 'the forge pumping: temperature surges with the bellows', ['grain', 'rate', '', ''],
 `  let surf = brushed(uv, mix(30.0, 70.0, k.x), 0.1, 0.8);
  let pulse = 0.5 + 0.5 * sin(t * mix(0.6, 1.8, k.y) - 1.0);
  let heat = 0.35 + 0.6 * pulse + 0.1 * fbm(uv * 3.0, 4, 3u);
  return metalPresent(heat, surf, uv, metalSparks(uv, t, 0.6, 1.0, 71u));`);
C('bar_stock', 'forge', 'a heated bar, hotter along its length', ['grain', 'noise', '', ''],
 `  let surf = brushed(uv, mix(40.0, 80.0, k.x), 1.5708, 0.9);
  let bar = smoothstep(0.35, 0.0, abs(uv.y)) * (0.6 + 0.4 * fbm(uv * 4.0, 4, 3u) * mix(0.4, 1.0, k.y));
  return metalPresent(bar + 0.15, surf, uv, metalSparks(uv, t, 0.4, 0.9, 61u));`);
C('anvil_face', 'forge', 'a work-piece on the anvil, hottest in the middle', ['grain', 'spread', '', ''],
 `  let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.05, 0.7);
  let heat = hotspot(uv, vec2f(0.0, 0.0), mix(0.2, 0.4, k.y)) * 1.1 + 0.1 * fbm(uv * 3.0, 4, 3u);
  return metalPresent(heat, surf, uv, metalSparks(uv, t, 0.5, 1.0, 71u));`);
C('crucible', 'forge', 'a crucible glowing near melt, roiling', ['grain', 'roil', '', ''],
 `  let surf = brushed(uv, mix(20.0, 50.0, k.x), 0.0, 0.5);
  var p = uv * 3.0; p += vec2f(fbm(p + t * 0.2, 3, 5u), fbm(p + 5.0 - t * 0.15, 3, 9u)) * mix(0.3, 1.0, k.y);
  let heat = 0.7 + 0.4 * fbm(p, 4, 3u);
  return metalPresent(heat, surf, uv, metalSparks(uv, t, 0.6, 1.1, 71u));`);
C('ingot', 'forge', 'a cast ingot cooling at the edges, hot at the core', ['grain', 'edge', '', ''],
 `  let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.8);
  let core = 1.0 - smoothstep(0.1, mix(0.4, 0.6, k.y), length(uv));
  return metalPresent(core * 0.9 + 0.15, surf, uv, metalSparks(uv, t, 0.35, 0.8, 61u));`);
C('reheat', 'forge', 'metal reheating, the glow sweeping in from a face', ['grain', 'front', '', ''],
 `  let surf = brushed(uv, mix(35.0, 70.0, k.x), 0.1, 0.8);
  let front = smoothstep(0.5, -0.5, uv.x - (fract(t * 0.15) * 2.0 - 1.0) * mix(0.5, 1.0, k.y));
  let heat = front * (0.7 + 0.3 * fbm(uv * 3.0, 4, 3u));
  return metalPresent(heat, surf, uv, metalSparks(uv, t, 0.4, 0.9, 71u));`);
C('white_hot', 'forge', 'a billet driven to white heat, near sparks', ['grain', 'noise', '', ''],
 `  let surf = brushed(uv, mix(30.0, 70.0, k.x), 0.1, 0.7);
  let heat = 0.85 + 0.3 * fbm(uv * 3.5, 4, 3u) * mix(0.3, 1.0, k.y);
  return metalPresent(heat, surf, uv, metalSparks(uv, t, 0.8, 1.2, 71u));`);

// ---------------------------------------------------------------- diffusion
C('spreading', 'diffusion', 'heat spreading through the plate like the heat equation', ['scale', 'flow', '', ''],
 `  let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.7);
  return metalPresent(diffuseHeat(uv, t, mix(2.0, 4.0, k.x), 7u) * mix(0.8, 1.2, k.y), surf, uv, metalSparks(uv, t, 0.4, 0.9, 61u));`);
C('conduction', 'diffusion', 'slow conduction blooming from seeds', ['scale', 'flow', '', ''],
 `  let surf = brushed(uv, mix(40.0, 70.0, k.x), 0.0, 0.8);
  let h = diffuseHeat(uv, t * 0.5, mix(2.5, 4.5, k.x), 17u);
  return metalPresent(smoothstep(0.3, 0.9, h) * mix(0.8, 1.2, k.y), surf, uv, metalSparks(uv, t, 0.35, 0.8, 61u));`);
C('hot_veins', 'diffusion', 'heat running along veins in the metal', ['scale', 'sharp', '', ''],
 `  let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.7);
  let v = 1.0 - abs(fbm(uv * mix(2.5, 5.0, k.x), 5, 21u));
  return metalPresent(pow(v, mix(2.0, 5.0, k.y)) * 1.2, surf, uv, metalSparks(uv, t, 0.4, 0.9, 61u));`);
C('marbled_heat', 'diffusion', 'heat marbled into the surface', ['scale', 'flow', '', ''],
 `  let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.7);
  var p = uv * mix(2.0, 4.0, k.x); p += vec2f(fbm(p + t * 0.05, 4, 33u), fbm(p + 5.2, 4, 41u)) * mix(0.4, 1.2, k.y);
  return metalPresent(fbm01(p, 5, 3u), surf, uv, metalSparks(uv, t, 0.3, 0.8, 61u));`);
C('creeping_heat', 'diffusion', 'a heat front creeping across cold metal', ['scale', 'speed', '', ''],
 `  let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.7);
  let n = fbm01(vec2f(uv.x * mix(2.0, 5.0, k.x) - t * mix(0.2, 0.6, k.y), uv.y * 3.0), 5, 17u);
  let front = smoothstep(0.4, 0.7, n);
  return metalPresent(front * 1.1, surf, uv, metalSparks(uv, t, 0.35, 0.9, 61u));`);
C('cell_diffuse', 'diffusion', 'cellular heat pockets that merge', ['scale', 'flow', '', ''],
 `  let surf = brushed(uv, mix(35.0, 65.0, k.x), 0.0, 0.7);
  let a = diffuseHeat(uv, t, mix(3.0, 5.0, k.x), 5u); let b = diffuseHeat(uv, t + 4.0, mix(3.0, 5.0, k.x) * 1.7, 9u);
  return metalPresent(mix(a, b, mix(0.3, 0.7, k.y)), surf, uv, metalSparks(uv, t, 0.3, 0.8, 61u));`);
C('thermal_wave', 'diffusion', 'a traveling thermal wave through the bar', ['freq', 'speed', '', ''],
 `  let surf = brushed(uv, mix(40.0, 70.0, k.x), 1.5708, 0.8);
  let n = fbm(uv * 2.0, 4, 7u);
  let w = 0.5 + 0.5 * sin(uv.x * mix(4.0, 10.0, k.x) - t * mix(1.5, 3.5, k.y) + n * 3.0);
  return metalPresent(smoothstep(0.4, 0.95, w), surf, uv, metalSparks(uv, t, 0.35, 0.9, 61u));`);
C('flux', 'diffusion', 'roiling heat flux across the surface', ['scale', 'roil', '', ''],
 `  let surf = brushed(uv, mix(25.0, 55.0, k.x), 0.1, 0.6);
  var p = uv * mix(2.5, 4.5, k.x); p += vec2f(fbm(p + t * 0.2, 3, 5u), fbm(p - t * 0.15 + 5.0, 3, 9u)) * mix(0.4, 1.2, k.y);
  return metalPresent(0.5 + 0.6 * fbm(p, 4, 3u), surf, uv, metalSparks(uv, t, 0.4, 1.0, 71u));`);

// ---------------------------------------------------------------- hotspot
C('weld_point', 'hotspot', 'a welding arc point, blindingly hot and sparking', ['size', 'spark', '', ''],
 `  let surf = brushed(uv, mix(35.0, 65.0, k.x), 0.1, 0.7);
  let h = hotspot(uv, vec2f(0.0, 0.0), mix(0.06, 0.15, k.x)) * 1.6;
  let sp = metalSparks(uv, t, 0.8, 1.4, 71u) * mix(0.6, 1.3, k.y);
  return metalPresent(h + 0.1, surf, uv, sp + hotspot(uv, vec2f(0.0), 0.2) * sp);`);
C('torch', 'hotspot', 'a torch playing over one spot', ['size', 'wander', '', ''],
 `  let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.7);
  let c = vec2f(sin(t * 0.7), cos(t * 0.5)) * mix(0.0, 0.25, k.y);
  return metalPresent(hotspot(uv, c, mix(0.1, 0.2, k.x)) * 1.4 + 0.08, surf, uv, metalSparks(uv, t, 0.5, 1.1, 71u));`);
C('twin_welds', 'hotspot', 'two weld points bridging heat between them', ['size', 'gap', '', ''],
 `  let surf = brushed(uv, mix(35.0, 65.0, k.x), 0.1, 0.7);
  let g = mix(0.15, 0.3, k.y);
  let h = hotspot(uv, vec2f(-g, 0.0), 0.1) + hotspot(uv, vec2f(g, 0.0), 0.1);
  return metalPresent(h * 1.4 + 0.08, surf, uv, metalSparks(uv, t, 0.6, 1.2, 71u));`);
C('drill_point', 'hotspot', 'friction heat under a drill, throwing swarf sparks', ['size', 'spark', '', ''],
 `  let surf = brushed(uv, mix(40.0, 80.0, k.x), t * 2.0, 0.8);
  let h = hotspot(uv, vec2f(0.0, 0.0), mix(0.05, 0.12, k.x)) * 1.5;
  return metalPresent(h + 0.1, surf, uv, metalSparks(uv, t, 0.9, 1.6, 71u) * mix(0.6, 1.4, k.y));`);
C('plasma_cut', 'hotspot', 'a plasma cut streaking a hot line', ['size', 'speed', '', ''],
 `  let surf = brushed(uv, mix(35.0, 65.0, k.x), 0.1, 0.7);
  let cx = (fract(t * mix(0.1, 0.3, k.y)) * 2.0 - 1.0) * 0.6;
  let line = exp(-(uv.x - cx) * (uv.x - cx) / mix(0.004, 0.02, k.x));
  return metalPresent(line * 1.5, surf, uv, metalSparks(uv, t, 0.9, 1.8, 71u) * line);`);
C('rivet', 'hotspot', 'a rivet heated cherry-red in the middle', ['size', 'noise', '', ''],
 `  let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.7);
  let ring = smoothstep(mix(0.15, 0.3, k.x), 0.0, length(uv));
  return metalPresent(ring * (0.7 + 0.3 * fbm(uv * 4.0, 4, 3u) * mix(0.3, 1.0, k.y)), surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));`);
C('wandering_arc', 'hotspot', 'an arc wandering and leaving a warm trail', ['size', 'speed', '', ''],
 `  let surf = brushed(uv, mix(35.0, 65.0, k.x), 0.1, 0.7);
  let c = vec2f(sin(t * mix(0.6, 1.6, k.y)), sin(t * mix(0.4, 1.1, k.y) * 1.3)) * 0.3;
  let trail = fbm01(uv * 3.0 - vec2f(t * 0.2, 0.0), 4, 5u) * 0.25;
  return metalPresent(hotspot(uv, c, mix(0.06, 0.13, k.x)) * 1.5 + trail, surf, uv, metalSparks(uv, t, 0.7, 1.3, 71u));`);
C('cluster', 'hotspot', 'a cluster of hot pits pulsing', ['size', 'rate', '', ''],
 `  let surf = brushed(uv, mix(35.0, 65.0, k.x), 0.1, 0.7);
  var h = 0.0;
  for (var i: i32 = 0; i < 4; i++) { let fi = f32(i); let c = vec2f(sin(fi * 2.1), cos(fi * 1.7)) * 0.28; h += hotspot(uv, c, mix(0.05, 0.1, k.x)) * (0.6 + 0.4 * sin(t * mix(1.0, 3.0, k.y) + fi)); }
  return metalPresent(h * 1.3 + 0.08, surf, uv, metalSparks(uv, t, 0.5, 1.1, 71u));`);

// ---------------------------------------------------------------- gradient
C('edge_heat', 'gradient', 'one edge hot, cooling across to the other', ['grain', 'falloff', '', ''],
 `  let surf = brushed(uv, mix(35.0, 70.0, k.x), 0.1, 0.8);
  let g = smoothstep(0.5, -0.5, uv.x) * mix(0.9, 1.2, k.y) + 0.08 * fbm(uv * 4.0, 3, 3u);
  return metalPresent(g, surf, uv, metalSparks(uv, t, 0.35, 0.9, 61u));`);
C('bottom_heat', 'gradient', 'heat rising from the hot base of the plate', ['grain', 'falloff', '', ''],
 `  let surf = brushed(uv, mix(35.0, 70.0, k.x), 1.5708, 0.8);
  let g = smoothstep(0.5, -0.3, uv.y) * mix(0.9, 1.2, k.y) + 0.08 * fbm(uv * 4.0, 3, 3u);
  return metalPresent(g, surf, uv, metalSparks(uv, t, 0.4, 1.0, 61u));`);
C('corner_heat', 'gradient', 'heat pooling into one corner', ['grain', 'falloff', '', ''],
 `  let surf = brushed(uv, mix(35.0, 65.0, k.x), 0.1, 0.8);
  let g = smoothstep(1.2, 0.0, length(uv - vec2f(-0.4, -0.4))) * mix(0.9, 1.2, k.y);
  return metalPresent(g, surf, uv, metalSparks(uv, t, 0.35, 0.9, 61u));`);
C('band_gradient', 'gradient', 'a hot band graded into cool metal', ['grain', 'width', '', ''],
 `  let surf = brushed(uv, mix(35.0, 70.0, k.x), 0.1, 0.8);
  let g = exp(-uv.y * uv.y / mix(0.03, 0.15, k.y));
  return metalPresent(g * 1.1 + 0.05 * fbm(uv * 4.0, 3, 3u), surf, uv, metalSparks(uv, t, 0.4, 1.0, 61u));`);
C('radial_gradient', 'gradient', 'a hot center fading radially to cold', ['grain', 'radius', '', ''],
 `  let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.8);
  let g = smoothstep(mix(0.3, 0.6, k.y), 0.0, length(uv));
  return metalPresent(g * 1.1, surf, uv, metalSparks(uv, t, 0.35, 0.9, 61u));`);
C('diagonal_grade', 'gradient', 'a diagonal temperature grade', ['grain', 'angle', '', ''],
 `  let surf = brushed(uv, mix(35.0, 70.0, k.x), 0.1, 0.8);
  let d = dot(uv, normalize(vec2f(1.0, mix(-1.0, 1.0, k.y))));
  return metalPresent(smoothstep(0.5, -0.5, d) + 0.06 * fbm(uv * 4.0, 3, 3u), surf, uv, metalSparks(uv, t, 0.35, 0.9, 61u));`);
C('wavy_front', 'gradient', 'a rippling hot-cold boundary', ['grain', 'ripple', '', ''],
 `  let surf = brushed(uv, mix(35.0, 65.0, k.x), 0.1, 0.8);
  let edge = uv.x + mix(0.05, 0.25, k.y) * sin(uv.y * 6.0 + t);
  return metalPresent(smoothstep(0.3, -0.3, edge), surf, uv, metalSparks(uv, t, 0.4, 1.0, 61u));`);

// ---------------------------------------------------------------- quench
C('quench', 'quench', 'hot metal quenching, the glow fading from the rim in', ['grain', 'rate', '', ''],
 `  let surf = brushed(uv, mix(35.0, 65.0, k.x), 0.1, 0.8);
  let cool = fract(t * mix(0.1, 0.3, k.y));
  let h = smoothstep(cool, cool + 0.4, length(uv)) * 1.1;
  return metalPresent(1.2 - h, surf, uv, 0.0);`);
C('cooling_cracks', 'quench', 'cooling reveals a web of hot cracks', ['scale', 'sharp', '', ''],
 `  let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.8);
  let v = 1.0 - abs(fbm(uv * mix(3.0, 6.0, k.x), 5, 21u));
  let cool = 0.5 + 0.4 * sin(t * 0.4);
  return metalPresent(pow(v, mix(3.0, 6.0, k.y)) * cool * 1.3, surf, uv, 0.0);`);
C('oxide_swirl', 'quench', 'oxide swirling on a cooling surface', ['scale', 'flow', '', ''],
 `  let surf = brushed(uv, mix(25.0, 50.0, k.x), 0.1, 0.6);
  var p = uv * mix(2.0, 4.0, k.x); p += vec2f(fbm(p + t * 0.05, 4, 33u), fbm(p + 5.2 - t * 0.03, 4, 41u)) * mix(0.4, 1.0, k.y);
  return metalPresent((0.4 + 0.5 * fbm(p, 4, 3u)) * (0.6 + 0.3 * sin(t * 0.3)), surf, uv, 0.0);`);
C('receding_glow', 'quench', 'the last glow receding into the metal', ['grain', 'rate', '', ''],
 `  let surf = brushed(uv, mix(35.0, 65.0, k.x), 0.1, 0.8);
  let g = smoothstep(mix(0.2, 0.5, k.y) * (0.5 + 0.5 * sin(t * 0.4)), 0.0, length(uv));
  return metalPresent(g, surf, uv, 0.0);`);
C('steam_quench', 'quench', 'a hot spot pocked by quench-steam patches', ['scale', 'patch', '', ''],
 `  let surf = brushed(uv, mix(35.0, 65.0, k.x), 0.1, 0.8);
  let h = hotspot(uv, vec2f(0.0), 0.35);
  let steam = smoothstep(mix(0.4, 0.6, k.y), 0.75, fbm01(uv * mix(4.0, 8.0, k.x) - vec2f(0.0, t), 4, 8u));
  return metalPresent(h * (1.0 - steam) * 1.2, surf, uv, 0.0);`);
C('flame_hardening', 'quench', 'a surface flame-hardened in a moving band', ['grain', 'speed', '', ''],
 `  let surf = brushed(uv, mix(35.0, 70.0, k.x), 1.5708, 0.8);
  let cx = (fract(t * mix(0.08, 0.2, k.y)) * 2.0 - 1.0);
  let band = exp(-(uv.x - cx) * (uv.x - cx) / 0.02);
  let residual = smoothstep(cx, cx - 0.6, uv.x) * 0.3;
  return metalPresent(band * 1.3 + residual, surf, uv, 0.0);`);
C('cold_shut', 'quench', 'cold metal with a fading warm seam', ['scale', 'seam', '', ''],
 `  let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.8);
  let seam = exp(-abs(uv.x + mix(0.1, 0.3, k.y) * sin(uv.y * 4.0)) * 8.0) * (0.5 + 0.3 * sin(t * 0.5));
  return metalPresent(seam * 1.2 + 0.05, surf, uv, 0.0);`);

// ---------------------------------------------------------------- brushed
C('brushed_glow', 'brushed', 'heat glowing along a brushed grain', ['freq', 'noise', '', ''],
 `  let surf = brushed(uv, mix(40.0, 90.0, k.x), 0.0, 1.0);
  let heat = (0.4 + 0.4 * surf) * (0.6 + 0.4 * fbm(uv * 3.0, 4, 3u) * mix(0.3, 1.0, k.y));
  return metalPresent(heat, surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));`);
C('damascus', 'brushed', 'folded damascus pattern heating up', ['freq', 'fold', '', ''],
 `  let p = vec2f(uv.x, uv.y + 0.15 * sin(uv.x * mix(6.0, 14.0, k.y)));
  let surf = 0.4 + 0.5 * (0.5 + 0.5 * sin(p.y * mix(20.0, 50.0, k.x) + fbm(p * 4.0, 3, 5u) * 4.0));
  return metalPresent(0.55 + 0.35 * surf, surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));`);
C('anisotropic', 'brushed', 'anisotropic surface catching the heat glow', ['freq', 'angle', '', ''],
 `  let surf = brushed(uv, mix(40.0, 90.0, k.x), mix(0.0, 1.5708, k.y), 1.0);
  return metalPresent(0.5 + 0.4 * fbm(uv * 3.0, 4, 3u), surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));`);
C('scratched', 'brushed', 'a scratched plate, heat pooling in the grooves', ['freq', 'depth', '', ''],
 `  let scr = fbm01(uv * vec2f(mix(3.0, 6.0, k.x), 60.0), 3, 13u);
  let surf = clamp(0.3 + 0.7 * scr, 0.0, 1.0);
  let heat = 0.5 + 0.4 * scr * mix(0.5, 1.2, k.y);
  return metalPresent(heat, surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));`);
C('rolled_steel', 'brushed', 'rolled steel sheet with a mill finish', ['freq', 'noise', '', ''],
 `  let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.05, 0.6);
  return metalPresent(0.55 + 0.3 * fbm(uv * vec2f(2.0, 6.0), 4, 3u) * mix(0.4, 1.0, k.y), surf, uv, metalSparks(uv, t, 0.25, 0.8, 61u));`);
C('mesh_grate', 'brushed', 'a grate heating, the bars glowing first', ['pitch', 'noise', '', ''],
 `  let g = mix(6.0, 16.0, k.x);
  let bars = max(abs(fract(uv.x * g) - 0.5), abs(fract(uv.y * g) - 0.5));
  let surf = smoothstep(0.2, 0.45, bars);
  let heat = surf * (0.7 + 0.3 * fbm(uv * 3.0, 3, 3u) * mix(0.3, 1.0, k.y));
  return metalPresent(heat, surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));`);
C('coil', 'brushed', 'a heating coil glowing along its windings', ['pitch', 'noise', '', ''],
 `  let surf = 0.4 + 0.5 * (0.5 + 0.5 * sin(uv.y * mix(14.0, 34.0, k.x)));
  let heat = surf * (0.7 + 0.3 * sin(t * 0.6)) * mix(0.8, 1.2, k.y);
  return metalPresent(heat, surf, uv, metalSparks(uv, t, 0.2, 0.8, 61u));`);

// ---------------------------------------------------------------- spark
C('grinder', 'spark', 'a grinding wheel throwing a fan of sparks', ['density', 'speed', '', ''],
 `  let surf = brushed(uv, mix(50.0, 90.0, k.x), t * 3.0, 0.8);
  let hot = hotspot(uv, vec2f(0.0, -0.2), 0.25) * 1.3;
  let sp = metalSparks(uv, t, mix(0.7, 1.0, k.x), mix(1.4, 2.2, k.y), 71u) + metalSparks(uv, t + 5.0, 0.8, 1.8, 88u);
  return metalPresent(hot + 0.3, surf, uv, sp * 1.4);`);
C('welding', 'spark', 'an arc weld spitting bright sparks', ['density', 'speed', '', ''],
 `  let surf = brushed(uv, mix(40.0, 70.0, k.x), 0.1, 0.7);
  let arc = hotspot(uv, vec2f(0.0, 0.0), 0.12) * 1.7;
  let sp = metalSparks(uv, t, mix(0.7, 1.0, k.x), mix(1.2, 2.0, k.y), 71u);
  return metalPresent(arc + 0.2, surf, uv, sp * 1.5);`);
C('spark_fountain', 'spark', 'a fountain of sparks off molten metal', ['density', 'speed', '', ''],
 `  let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.6);
  let pool = smoothstep(0.5, -0.2, uv.y) * 1.2;
  let sp = metalSparks(uv, t, mix(0.8, 1.0, k.x), mix(1.3, 2.2, k.y), 71u);
  return metalPresent(pool + 0.2, surf, uv, sp * 1.4);`);
C('cutting_torch', 'spark', 'a cutting torch and its shower of slag', ['density', 'speed', '', ''],
 `  let surf = brushed(uv, mix(40.0, 70.0, k.x), 0.1, 0.7);
  let cut = exp(-uv.x * uv.x / 0.01) * 1.5;
  let sp = metalSparks(vec2f(uv.x, uv.y), t, mix(0.7, 1.0, k.x), mix(1.5, 2.5, k.y), 71u);
  return metalPresent(cut + 0.2, surf, uv, sp * 1.4);`);
C('sparkler', 'spark', 'a sparkler crackling in all directions', ['density', 'speed', '', ''],
 `  let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.6);
  var sp = 0.0;
  for (var i: i32 = 0; i < 3; i++) { let a = f32(i) * 2.094; sp += metalSparks(rot2(a) * uv, t + f32(i) * 3.0, mix(0.7, 1.0, k.x), mix(1.2, 2.0, k.y), 71u + u32(i)); }
  return metalPresent(hotspot(uv, vec2f(0.0), 0.15) * 1.3 + 0.2, surf, uv, sp * 1.2);`);
C('slag', 'spark', 'molten slag dripping and sparking', ['density', 'drip', '', ''],
 `  let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.6);
  let drip = smoothstep(0.6, -0.4, uv.y) * (0.7 + 0.3 * fbm(uv * vec2f(6.0, 3.0), 4, 3u));
  let sp = metalSparks(uv, t, mix(0.6, 0.9, k.x), mix(1.0, 1.8, k.y), 71u);
  return metalPresent(drip * 1.2 + 0.15, surf, uv, sp * 1.2);`);
C('spark_burst', 'spark', 'periodic bursts of sparks from a hot seam', ['density', 'rate', '', ''],
 `  let surf = brushed(uv, mix(40.0, 70.0, k.x), 0.1, 0.7);
  let burst = pow(0.5 + 0.5 * sin(t * mix(1.5, 4.0, k.y)), 4.0);
  let seam = exp(-uv.y * uv.y / 0.02) * 1.2;
  let sp = metalSparks(uv, t, mix(0.7, 1.0, k.x), 1.6, 71u) * (0.4 + burst);
  return metalPresent(seam + 0.2, surf, uv, sp * 1.5);`);
C('foundry', 'spark', 'a foundry pour glowing white and spitting', ['density', 'speed', '', ''],
 `  let surf = brushed(uv, mix(25.0, 55.0, k.x), 0.1, 0.6);
  let pour = exp(-uv.x * uv.x / mix(0.02, 0.06, k.x)) * 1.4;
  let sp = metalSparks(uv, t, 0.9, mix(1.4, 2.4, k.y), 71u);
  return metalPresent(pour + 0.3, surf, uv, sp * 1.3);`);

// ---------------------------------------------------------------- oxide (tempering colors)
C('temper', 'oxide', 'steel tempering: straw to bronze to purple to blue', ['range', 'noise', '', ''],
 `  let surf = brushed(uv, mix(40.0, 80.0, k.x), 0.0, 0.8);
  let x = (0.5 + 0.5 * uv.x) * mix(0.6, 1.0, k.y) + 0.05 * fbm(uv * 3.0, 3, 3u);
  return vec4f(clamp(temperColor(x * u.energy) * (0.5 + 0.7 * surf), vec3f(0.0), vec3f(1.0)), 1.0);`);
C('temper_sweep', 'oxide', 'temper colors sweeping across as it heats', ['range', 'speed', '', ''],
 `  let surf = brushed(uv, mix(40.0, 80.0, k.x), 0.0, 0.8);
  let x = fract(t * mix(0.05, 0.2, k.y)) + uv.x * 0.5;
  return vec4f(clamp(temperColor(x) * (0.5 + 0.7 * surf), vec3f(0.0), vec3f(1.0)), 1.0);`);
C('temper_rings', 'oxide', 'tempering rings around a hot spot', ['range', 'rings', '', ''],
 `  let surf = brushed(uv, mix(40.0, 80.0, k.x), 0.0, 0.8);
  let x = clamp(1.0 - length(uv) * mix(1.2, 2.2, k.y), 0.0, 1.0);
  return vec4f(clamp(temperColor(x * u.energy) * (0.5 + 0.7 * surf), vec3f(0.0), vec3f(1.0)), 1.0);`);
C('temper_marble', 'oxide', 'oxide tempering marbled into the steel', ['scale', 'flow', '', ''],
 `  let surf = brushed(uv, mix(35.0, 70.0, k.x), 0.0, 0.8);
  var p = uv * mix(2.0, 4.0, k.x); p += vec2f(fbm(p + t * 0.03, 4, 33u), fbm(p + 5.2, 4, 41u)) * mix(0.4, 1.0, k.y);
  return vec4f(clamp(temperColor(fbm01(p, 4, 3u) * u.energy) * (0.5 + 0.7 * surf), vec3f(0.0), vec3f(1.0)), 1.0);`);
C('temper_bands', 'oxide', 'banded tempering colors across a blade', ['range', 'bands', '', ''],
 `  let surf = brushed(uv, mix(50.0, 90.0, k.x), 1.5708, 0.9);
  let x = clamp(0.5 + 0.5 * uv.y, 0.0, 1.0) * u.energy;
  let banded = floor(x * mix(4.0, 8.0, k.y)) / mix(4.0, 8.0, k.y);
  return vec4f(clamp(temperColor(banded) * (0.5 + 0.7 * surf), vec3f(0.0), vec3f(1.0)), 1.0);`);
C('bluing', 'oxide', 'gun-bluing deepening toward blue-black', ['scale', 'depth', '', ''],
 `  let surf = brushed(uv, mix(40.0, 80.0, k.x), 0.0, 0.8);
  let x = mix(0.6, 0.95, k.y) + 0.06 * fbm(uv * 4.0, 3, 3u);
  return vec4f(clamp(temperColor(x) * (0.4 + 0.6 * surf), vec3f(0.0), vec3f(1.0)), 1.0);`);
C('heat_tint', 'oxide', 'a weld heat-tint rainbow beside the seam', ['range', 'width', '', ''],
 `  let surf = brushed(uv, mix(40.0, 80.0, k.x), 1.5708, 0.8);
  let x = clamp(1.0 - abs(uv.x) * mix(2.0, 4.0, k.y), 0.0, 1.0);
  return vec4f(clamp(temperColor(x) * (0.5 + 0.7 * surf), vec3f(0.0), vec3f(1.0)), 1.0);`);

const CELLS = cells;

// ── emit pack.wgsl ───────────────────────────────────────────────────────────
const frag = ([name, , , , body]) =>
  `@fragment fn fs_${name}(@builtin(position) fp: vec4f) -> @location(0) vec4f {\n  let uv = fuv(fp.xy);\n  let t = u.time;\n  let k = u.k;\n${body}\n}`;
const pack = HELPERS + '\n// ── the 60 metal cells ───────────────────────────────────────────────────────\n' +
  CELLS.map(frag).join('\n\n') + '\n';

// ── emit spec.json ───────────────────────────────────────────────────────────
const spec = {
  cols: 6,
  uniform_bytes: 96,
  cells: CELLS.map(([name, family, species, knobs]) => ({ name, family, species, knobs, defaults: [0.5, 0.5, 0.5, 0.5], fn: 'fs_' + name })),
  gens: [
    { id: 'energy', title: 'Energy · temperature', fn: 'flat', period: 12, amp: 0.4, bias: 0.55, phase: 0,
      map: 'y => 1.6 * y', unit: "v => (700 + v / 1.6 * 6100).toFixed(0) + ' K'" },
    { id: 'tempo', title: 'Tempo · hover speed', fn: 'flat', period: 8, amp: 0.0, bias: 0.5, phase: 0,
      map: 'y => 0.1 + 2.9 * y', unit: "v => v.toFixed(2) + 'x'" },
    { id: 'glow', title: 'Glow · spark bloom', fn: 'flat', period: 10, amp: 0.0, bias: 0.5, phase: 0,
      map: 'y => 1.5 * y', unit: "v => (v * 100).toFixed(0) + '%'" },
  ],
  swatches: [
    { id: 'ink', label: 'Cold steel', hex: '#22262e' },
    { id: 'tone', label: 'Patina', hex: '#8a5a2a' },
    { id: 'cream', label: 'Sheen', hex: '#d8dee8' },
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
<title>Heat Metal Table // Stella Nova</title>
<!--
  ════════════════════════════════════════════════════════════════════════════
   HEAT METAL TABLE  ·  page shell (GENERATED by build.mjs)
  ────────────────────────────────────────────────────────────────────────────
   ${CELLS.length} cells of metal heating under a surface. Color follows an idealized
   blackbody curve; hot metal throws sparks; the oxide family shows tempering.
  ════════════════════════════════════════════════════════════════════════════
-->
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=JetBrains+Mono:wght@300;400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="style.css">
</head>
<body>

<script>if(window!==window.top)document.documentElement.classList.add("in-frame")</script>
<div class="grid-bg"></div>
<div class="topbar">
  <div class="topbar-l"><span class="sys-name">Stella Nova</span><span class="sys-status">Heat Metal Table</span></div>
  <div class="topbar-r">SYS // <strong>WGSL SHADER LAB</strong></div>
</div>
<div id="side">
  <div class="side-head"><div class="big">metal</div><div class="sub">|${CELLS.length} cells · ${Object.keys(FAM).length} families⟩</div></div>
  <div class="legend">${legend}</div>
  <div id="gens"></div>
  <div class="sec"><div class="sec-lbl">Metal &amp; sheen</div><div class="swatches">${swatchHtml}</div></div>
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
//  HEAT METAL TABLE  ·  main.js — data load and boot (GENERATED)
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
//  HEAT METAL TABLE  ·  page.js — the per-page PAGE object (GENERATED)
// ────────────────────────────────────────────────────────────────────────────
//  ${CELLS.length} uniform-only cells; one fragment shader per cell. Same contract as the
//  fire tables. Energy is the master temperature; Glow scales spark bloom.
//  UNIFORM LAYOUT (96 bytes, struct MetalU in shaders/pack.wgsl)
//    0..1 size · 2 time · 3 pixelScale · 4..7 ink · 8..11 tone · 12..15 cream
//    16 energy · 17 glow · 18 pad · 19 pad · 20..23 k
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
    d[16] = G.energy; d[17] = G.glow; d[18] = 0; d[19] = 0; d.set(t.knobs, 20);
    device.queue.writeBuffer(surf.buf, 0, d);
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: surf.ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(t.pipeline); pass.setBindGroup(0, this.bind(surf)); pass.draw(3); pass.end();
  },
  source(t) { return this.ctx.fnSource('fs_' + t.s.name); },
};
`;

// ── emit style.css (clone color-table, append metal families) ────────────────
const famCss = Object.entries(FAM).map(([f, c]) =>
  `.f-${f}{--fam:${c};--fam-bg:${c.replace(/[\d.]+\)$/, '0.06)')}}`).join('\n');
const baseCss = readFileSync(join(DIR, '..', 'color-table', 'style.css'), 'utf8');
const css = baseCss + `
/* ── metal families (appended by build.mjs) ──────────────────────────────── */
${famCss}
.side-head .big{color:#ff8a3c}
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
