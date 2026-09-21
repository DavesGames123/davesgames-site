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
//    Every cell heats from a point source at the TOP-LEFT CORNER. The heat
//    field is a pointwise conduction function: temperature falls off with
//    distance from the corner (diffCorner), so a tile reads white-hot at the
//    corner and fades to cold steel across the plate. A cell also computes a
//    brushed surface and a spark field, then calls metalPresent, which turns
//    heat into a temperature through the Energy generator, colors it by
//    blackbody, blends the cold metal out as it glows, and adds sparks that
//    appear only where the metal is hot. The 60 cells differ in HOW the heat
//    conducts from that corner: conductivity, anisotropy, transient growth,
//    defects that reroute it, sparks, quench and tempering.
//
//  GREP MAP (pack.wgsl)
//    struct MetalU .... uniform block  ·  fn blackbody .. temperature to RGB
//    fn temperColor ... steel tempering (oxide) ramp
//    fn brushed ....... anisotropic brushed-metal surface
//    fn corner ........ top-left origin  ·  fn diffCorner .. pointwise conduction
//    fn metalSparks ... rising sparks  ·  fn metalPresent .. the finisher
//    @fragment fs_* ... the 60 cells
// ============================================================================
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));

const FAM = {
  conduction:  'rgba(255,120,40,0.14)',
  transient:   'rgba(255,150,60,0.13)',
  anisotropic: 'rgba(255,90,40,0.14)',
  defect:      'rgba(255,170,80,0.13)',
  spark:       'rgba(255,220,140,0.14)',
  quench:      'rgba(120,150,200,0.13)',
  oxide:       'rgba(150,120,200,0.13)',
  surface:     'rgba(180,190,205,0.12)',
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
// top-left corner as the origin: (0,0) at top-left, (1,1) at bottom-right
fn corner(uv: vec2f) -> vec2f { return vec2f(uv.x + 0.5, 1.0 - uv.y); }
// pointwise conduction from the corner: temperature falls off with distance.
// cond is the conduction length (how far heat reaches); aniso stretches the
// spread along y (>1 reaches further down, <1 stays tight).
fn diffCorner(c: vec2f, cond: f32, aniso: f32) -> f32 {
    let d = c * vec2f(1.0, 1.0 / max(aniso, 0.05));
    return exp(-length(d) / max(cond, 0.02));
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

// ---------------------------------------------------------------- conduction (pointwise from top-left)
C('point_source', 'conduction', 'a point heat source at the top-left, conducting outward', ['conductivity', 'aniso', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, mix(30.0, 70.0, k.x), 0.1, 0.8);
  return metalPresent(diffCorner(c, mix(0.15, 0.55, k.x), mix(0.6, 1.6, k.y)), surf, uv, metalSparks(uv, t, 0.5, 0.9, 71u));`);
C('slow_conductor', 'conduction', 'a poor conductor: heat stays clamped to the corner', ['conductivity', 'grain', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, mix(40.0, 80.0, k.y), 0.1, 0.8);
  return metalPresent(diffCorner(c, mix(0.08, 0.2, k.x), 1.0), surf, uv, metalSparks(uv, t, 0.4, 0.9, 61u));`);
C('fast_conductor', 'conduction', 'a good conductor: heat reaches deep across the plate', ['conductivity', 'grain', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, mix(30.0, 60.0, k.y), 0.1, 0.7);
  return metalPresent(diffCorner(c, mix(0.4, 0.9, k.x), 1.0), surf, uv, metalSparks(uv, t, 0.35, 0.8, 61u));`);
C('aniso_down', 'conduction', 'heat conducting further down than across', ['conductivity', 'aniso', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, mix(30.0, 60.0, k.x), 1.5708, 0.8);
  return metalPresent(diffCorner(c, mix(0.2, 0.45, k.x), mix(1.6, 3.0, k.y)), surf, uv, metalSparks(uv, t, 0.4, 0.9, 61u));`);
C('aniso_right', 'conduction', 'heat conducting further across than down', ['conductivity', 'aniso', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.0, 0.8);
  return metalPresent(diffCorner(c, mix(0.2, 0.45, k.x), mix(0.6, 0.35, k.y)), surf, uv, metalSparks(uv, t, 0.4, 0.9, 61u));`);
C('sharp_core', 'conduction', 'a sharp hot core with a steep falloff', ['conductivity', 'grain', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, mix(35.0, 70.0, k.y), 0.1, 0.8);
  let r = length(c); let h = 1.0 / (1.0 + r * r / mix(0.02, 0.1, k.x));
  return metalPresent(h, surf, uv, metalSparks(uv, t, 0.5, 1.0, 71u));`);
C('broad_soak', 'conduction', 'heat soaked broadly and evenly from the corner', ['conductivity', 'grain', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, mix(30.0, 60.0, k.y), 0.1, 0.7);
  return metalPresent(diffCorner(c, mix(0.6, 1.1, k.x), 1.0) * 1.05, surf, uv, metalSparks(uv, t, 0.3, 0.8, 61u));`);
C('bimetal', 'conduction', 'a seam where conductivity changes across the plate', ['conductivity', 'seam', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.8);
  let side = step(mix(0.3, 0.7, k.y), c.x);
  let cond = mix(0.15, 0.5, side);
  return metalPresent(diffCorner(c, cond, 1.0), surf, uv, metalSparks(uv, t, 0.35, 0.9, 61u));`);

// ---------------------------------------------------------------- transient (the front grows in time)
C('heating_up', 'transient', 'the metal heating up: the front advances from the corner', ['conductivity', 'rate', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, mix(30.0, 65.0, k.x), 0.1, 0.8);
  let grow = smoothstep(0.0, 0.75, fract(t * mix(0.08, 0.22, k.y)));
  return metalPresent(diffCorner(c, mix(0.06, 0.6, k.x) * grow, 1.0), surf, uv, metalSparks(uv, t, 0.5, 1.0, 71u));`);
C('reheat_pulse', 'transient', 'the source pulsing: heat breathing out and back', ['conductivity', 'rate', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, mix(30.0, 65.0, k.x), 0.1, 0.8);
  let g = 0.4 + 0.6 * (0.5 + 0.5 * sin(t * mix(0.8, 2.2, k.y)));
  return metalPresent(diffCorner(c, mix(0.15, 0.5, k.x) * g, 1.0), surf, uv, metalSparks(uv, t, 0.5, 1.0, 71u));`);
C('torch_hold', 'transient', 'a torch held on the corner, flickering hot', ['conductivity', 'flicker', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.7);
  let fl = 0.85 + 0.15 * sin(t * 7.0 + fbm(uv * 5.0, 2, 9u) * 4.0) * mix(0.3, 1.0, k.y);
  return metalPresent(diffCorner(c, mix(0.18, 0.5, k.x), 1.0) * fl, surf, uv, metalSparks(uv, t, 0.6, 1.2, 71u));`);
C('front_advance', 'transient', 'a visible diffusion front sweeping from the corner', ['conductivity', 'rate', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, mix(30.0, 65.0, k.x), 0.1, 0.8);
  let rad = fract(t * mix(0.1, 0.3, k.y)) * 1.6;
  let front = smoothstep(rad, rad - 0.4, length(c));
  return metalPresent(front * diffCorner(c, mix(0.3, 0.7, k.x), 1.0) * 1.3, surf, uv, metalSparks(uv, t, 0.4, 0.9, 61u));`);
C('ramp_soak', 'transient', 'a slow ramp up to a held soak temperature', ['conductivity', 'rate', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.8);
  let ph = fract(t * mix(0.05, 0.15, k.y)); let grow = smoothstep(0.0, 0.5, ph) * (1.0 - smoothstep(0.85, 1.0, ph));
  return metalPresent(diffCorner(c, mix(0.1, 0.55, k.x) * (0.3 + 0.7 * grow), 1.0), surf, uv, metalSparks(uv, t, 0.45, 0.9, 71u));`);
C('flicker_source', 'transient', 'an unsteady source, its output guttering', ['conductivity', 'gutter', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.8);
  let gate = 0.5 + 0.5 * sin(t * mix(2.0, 5.0, k.y) + fbm(vec2f(t * 0.8, 0.0), 2, 9u) * 4.0);
  return metalPresent(diffCorner(c, mix(0.15, 0.5, k.x), 1.0) * mix(0.4, 1.0, gate), surf, uv, metalSparks(uv, t, 0.5, 1.0, 71u));`);
C('surge', 'transient', 'periodic surges pushing the heat further each beat', ['conductivity', 'rate', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.8);
  let s = pow(0.5 + 0.5 * sin(t * mix(1.0, 3.0, k.y)), 3.0);
  return metalPresent(diffCorner(c, mix(0.15, 0.4, k.x) * (0.6 + 1.0 * s), 1.0), surf, uv, metalSparks(uv, t, 0.5, 1.1, 71u));`);
C('breathing', 'transient', 'the conduction length breathing in and out', ['conductivity', 'rate', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.8);
  let g = 0.5 + 0.5 * sin(t * mix(0.6, 1.6, k.y));
  return metalPresent(diffCorner(c, mix(0.12, 0.55, k.x) * (0.5 + g), 1.0), surf, uv, metalSparks(uv, t, 0.4, 0.9, 61u));`);

// ---------------------------------------------------------------- anisotropic (grain-directed conduction)
C('grain_flow', 'anisotropic', 'heat following the brushed grain out of the corner', ['angle', 'reach', '', ''],
 `  let ang = mix(0.2, 1.3, k.x); let surf = brushed(uv, 70.0, ang, 0.9);
  let c = rot2(ang) * corner(uv);
  return metalPresent(diffCorner(c, mix(0.25, 0.5, k.y), 2.2), surf, uv, metalSparks(uv, t, 0.35, 0.9, 61u));`);
C('diagonal_conduct', 'anisotropic', 'conduction stretched along a diagonal', ['angle', 'reach', '', ''],
 `  let ang = 0.785; let surf = brushed(uv, 60.0, ang, 0.8);
  let c = rot2(ang) * corner(uv);
  return metalPresent(diffCorner(c, mix(0.2, 0.5, k.y), mix(1.8, 3.2, k.x)), surf, uv, metalSparks(uv, t, 0.35, 0.9, 61u));`);
C('laminated', 'anisotropic', 'a laminated sheet conducting along its layers', ['pitch', 'reach', '', ''],
 `  let surf = 0.4 + 0.4 * (0.5 + 0.5 * sin(uv.y * mix(20.0, 44.0, k.x)));
  let c = corner(uv);
  return metalPresent(diffCorner(c, mix(0.25, 0.5, k.y), 0.35) * (0.6 + 0.5 * surf), surf, uv, metalSparks(uv, t, 0.3, 0.8, 61u));`);
C('fiber', 'anisotropic', 'fibrous conduction, streaky along the grain', ['scale', 'reach', '', ''],
 `  let c = corner(uv); let streak = fbm01(corner(uv) * vec2f(3.0, mix(14.0, 30.0, k.x)), 3, 13u);
  let surf = clamp(0.3 + 0.6 * streak, 0.0, 1.0);
  return metalPresent(diffCorner(c, mix(0.2, 0.45, k.y), 1.0) * (0.6 + 0.7 * streak), surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));`);
C('crystal', 'anisotropic', 'crystalline directional conduction in facets', ['facets', 'reach', '', ''],
 `  let c = corner(uv); let a = atan2(c.y, c.x); let fac = floor(a * mix(2.0, 5.0, k.x) / PI * 4.0);
  let dir = 0.7 + 0.3 * sin(fac);
  let surf = brushed(uv, 55.0, 0.4, 0.7);
  return metalPresent(diffCorner(c, mix(0.2, 0.45, k.y) * dir, 1.0), surf, uv, metalSparks(uv, t, 0.35, 0.9, 61u));`);
C('rolled_dir', 'anisotropic', 'rolled steel: heat runs fast in the roll direction', ['reach', 'grain', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, mix(30.0, 60.0, k.y), 0.0, 0.7);
  return metalPresent(diffCorner(c, mix(0.25, 0.5, k.x), 0.4), surf, uv, metalSparks(uv, t, 0.3, 0.8, 61u));`);
C('weld_haz', 'anisotropic', 'an elongated heat-affected zone from the corner', ['reach', 'aniso', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, 60.0, 0.6, 0.8);
  return metalPresent(diffCorner(rot2(0.6) * c, mix(0.2, 0.45, k.x), mix(2.0, 3.5, k.y)), surf, uv, metalSparks(uv, t, 0.4, 1.0, 71u));`);
C('vane', 'anisotropic', 'vane-like directional spread with a hard edge', ['spread', 'reach', '', ''],
 `  let c = corner(uv); let a = atan2(c.y, c.x);
  let vane = smoothstep(mix(0.9, 1.4, k.x), 0.2, a);
  let surf = brushed(uv, 60.0, 0.3, 0.8);
  return metalPresent(diffCorner(c, mix(0.25, 0.5, k.y), 1.0) * (0.4 + 0.8 * vane), surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));`);

// ---------------------------------------------------------------- defect (heat rerouted by material)
C('inclusions', 'defect', 'heat conducting around cold inclusions', ['scale', 'block', '', ''],
 `  let c = corner(uv); let block = smoothstep(0.45, 0.6, fbm01(c * mix(4.0, 8.0, k.x), 4, 5u)) * mix(1.0, 3.0, k.y);
  let surf = brushed(uv, 55.0, 0.1, 0.8);
  return metalPresent(exp(-length(c) * (1.0 + block) / 0.4), surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));`);
C('hot_veins', 'defect', 'veins that conduct heat faster out of the corner', ['scale', 'sharp', '', ''],
 `  let c = corner(uv); let vein = pow(1.0 - abs(fbm(c * mix(3.0, 6.0, k.x), 5, 21u)), mix(2.0, 5.0, k.y));
  let surf = brushed(uv, 55.0, 0.1, 0.7);
  return metalPresent(exp(-length(c) / (0.25 + 0.5 * vein)) , surf, uv, metalSparks(uv, t, 0.35, 0.9, 61u));`);
C('porous', 'defect', 'porous metal with patchy, broken conduction', ['scale', 'pore', '', ''],
 `  let c = corner(uv); let pore = fbm01(c * mix(4.0, 9.0, k.x), 4, 8u);
  let surf = brushed(uv, 45.0, 0.1, 0.7);
  return metalPresent(diffCorner(c, 0.4, 1.0) * smoothstep(mix(0.3, 0.5, k.y), 0.7, pore) * 1.3, surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));`);
C('cracked', 'defect', 'cracks that block heat, throwing dark shadows', ['scale', 'sharp', '', ''],
 `  let c = corner(uv); let crack = smoothstep(0.02, 0.0, abs(fbm(c * mix(3.0, 6.0, k.x), 5, 31u)));
  let surf = brushed(uv, 50.0, 0.1, 0.8);
  return metalPresent(diffCorner(c, 0.45, 1.0) * (1.0 - crack * mix(0.6, 1.0, k.y)), surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));`);
C('grainy', 'defect', 'a noisy conductivity field, mottling the falloff', ['scale', 'noise', '', ''],
 `  let c = corner(uv); let n = 0.7 + 0.6 * fbm(c * mix(3.0, 7.0, k.x), 4, 5u) * mix(0.4, 1.2, k.y);
  let surf = brushed(uv, 55.0, 0.1, 0.8);
  return metalPresent(exp(-length(c) * n / 0.4), surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));`);
C('marbled_conduct', 'defect', 'marbled conduction warping the heat path', ['scale', 'flow', '', ''],
 `  var c = corner(uv); c += vec2f(fbm(c * mix(2.0, 4.0, k.x) + t * 0.03, 4, 33u), fbm(c * 2.0 + 5.2, 4, 41u)) * mix(0.1, 0.35, k.y);
  let surf = brushed(uv, 50.0, 0.1, 0.7);
  return metalPresent(diffCorner(c, 0.4, 1.0), surf, uv, metalSparks(uv, t, 0.3, 0.8, 61u));`);
C('dendritic', 'defect', 'heat branching in dendrites from the corner', ['scale', 'sharp', '', ''],
 `  let c = corner(uv); let a = atan2(c.y, c.x);
  let branch = pow(0.5 + 0.5 * sin(a * mix(6.0, 14.0, k.x) + length(c) * 8.0), mix(2.0, 5.0, k.y));
  let surf = brushed(uv, 55.0, 0.1, 0.7);
  return metalPresent(diffCorner(c, 0.45, 1.0) * (0.4 + 0.9 * branch), surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));`);
C('mottled', 'defect', 'mottled heat pockets budding off the corner', ['scale', 'flow', '', ''],
 `  let c = corner(uv); let pock = fbm01(c * mix(3.0, 6.0, k.x) - vec2f(0.0, t * 0.1), 4, 8u);
  let surf = brushed(uv, 50.0, 0.1, 0.7);
  return metalPresent(diffCorner(c, 0.4, 1.0) * (0.5 + pock * mix(0.6, 1.0, k.y)), surf, uv, metalSparks(uv, t, 0.3, 0.8, 61u));`);

// ---------------------------------------------------------------- spark (hot corner throwing sparks)
C('corner_sparks', 'spark', 'the hot corner throwing a scatter of sparks', ['conductivity', 'density', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, 60.0, 0.1, 0.7);
  let sp = metalSparks(uv + vec2f(0.5, 0.0), t, mix(0.6, 1.0, k.y), 1.3, 71u);
  return metalPresent(diffCorner(c, mix(0.2, 0.4, k.x), 1.0) * 1.1, surf, uv, sp * 1.3);`);
C('grinding_corner', 'spark', 'a grinder biting the corner, fanning sparks', ['conductivity', 'density', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, 80.0, t * 3.0, 0.8);
  let sp = metalSparks(uv + vec2f(0.5, 0.0), t, mix(0.7, 1.0, k.y), 1.9, 71u) + metalSparks(uv + vec2f(0.5, 0.0), t + 5.0, 0.8, 2.1, 88u);
  return metalPresent(diffCorner(c, mix(0.18, 0.35, k.x), 1.0) * 1.3, surf, uv, sp * 1.4);`);
C('welding_corner', 'spark', 'an arc struck at the corner, spitting bright', ['conductivity', 'density', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, 60.0, 0.1, 0.7);
  let sp = metalSparks(uv + vec2f(0.5, 0.0), t, mix(0.7, 1.0, k.y), 1.6, 71u);
  return metalPresent(diffCorner(c, mix(0.14, 0.3, k.x), 1.0) * 1.5, surf, uv, sp * 1.6);`);
C('spark_shower_corner', 'spark', 'a dense shower streaming off the corner', ['conductivity', 'density', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, 55.0, 0.1, 0.6);
  let sp = metalSparks(uv + vec2f(0.5, 0.0), t, 0.9, mix(1.4, 2.2, k.y), 71u) + metalSparks(uv + vec2f(0.5, 0.0), t + 3.0, 0.9, 2.0, 88u);
  return metalPresent(diffCorner(c, mix(0.2, 0.4, k.x), 1.0) * 1.2, surf, uv, sp * 1.3);`);
C('cutting_corner', 'spark', 'a cutting torch at the corner, dripping slag', ['conductivity', 'density', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, 60.0, 0.1, 0.7);
  let sp = metalSparks(uv + vec2f(0.5, -0.2), t, mix(0.7, 1.0, k.y), 2.2, 71u);
  return metalPresent(diffCorner(c, mix(0.14, 0.3, k.x), 1.4) * 1.4, surf, uv, sp * 1.4);`);
C('burst_corner', 'spark', 'the corner spitting sparks in periodic bursts', ['conductivity', 'rate', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, 60.0, 0.1, 0.7);
  let burst = pow(0.5 + 0.5 * sin(t * mix(1.5, 4.0, k.y)), 4.0);
  let sp = metalSparks(uv + vec2f(0.5, 0.0), t, 0.8, 1.7, 71u) * (0.3 + burst);
  return metalPresent(diffCorner(c, mix(0.16, 0.34, k.x), 1.0) * 1.3, surf, uv, sp * 1.5);`);
C('fountain_corner', 'spark', 'a fountain of sparks rising from the corner', ['conductivity', 'density', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, 50.0, 0.1, 0.6);
  var sp = 0.0;
  for (var i: i32 = 0; i < 3; i++) { let a = f32(i) * 0.5 - 0.5; sp += metalSparks(rot2(a) * (uv + vec2f(0.5, -0.5)) + vec2f(0.0, -0.5), t + f32(i) * 3.0, mix(0.7, 1.0, k.y), 1.8, 71u + u32(i)); }
  return metalPresent(diffCorner(c, mix(0.18, 0.36, k.x), 1.0) * 1.2, surf, uv, sp * 1.2);`);
C('slag_corner', 'spark', 'molten slag beading and sparking at the corner', ['conductivity', 'density', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, 45.0, 0.1, 0.6);
  let sp = metalSparks(uv + vec2f(0.5, 0.0), t, mix(0.5, 0.9, k.y), 1.3, 71u);
  return metalPresent(diffCorner(c, mix(0.16, 0.32, k.x), 1.2) * 1.25, surf, uv, sp * 1.2);`);

// ---------------------------------------------------------------- quench (source pulled, heat recedes to the corner)
C('quench', 'quench', 'the source pulled away, the glow shrinking to the corner', ['conductivity', 'rate', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, 60.0, 0.1, 0.8);
  let cool = 0.4 + 0.5 * (0.5 + 0.5 * sin(t * mix(0.3, 0.9, k.y) - 1.5));
  return metalPresent(diffCorner(c, mix(0.1, 0.5, k.x) * cool, 1.0), surf, uv, 0.0);`);
C('cooling_front', 'quench', 'a cool front advancing from the far edge toward the corner', ['conductivity', 'rate', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, 60.0, 0.1, 0.8);
  let front = 1.5 - fract(t * mix(0.1, 0.3, k.y)) * 1.6;
  let mask = smoothstep(front - 0.3, front, length(c));
  return metalPresent(diffCorner(c, mix(0.25, 0.5, k.x), 1.0) * (1.0 - mask), surf, uv, 0.0);`);
C('receding_glow', 'quench', 'the last glow receding into the corner', ['conductivity', 'rate', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, 60.0, 0.1, 0.8);
  let g = mix(0.35, 0.6, k.x) * (0.4 + 0.6 * abs(sin(t * mix(0.3, 0.8, k.y))));
  return metalPresent(diffCorner(c, g, 1.0), surf, uv, 0.0);`);
C('oxide_cooling', 'quench', 'cooling metal skinning over with oxide', ['scale', 'rate', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, 45.0, 0.1, 0.6);
  var p = c * mix(2.0, 4.0, k.x); p += vec2f(fbm(p + t * 0.04, 4, 33u), fbm(p + 5.2, 4, 41u)) * 0.4;
  let cool = 0.5 + 0.4 * sin(t * mix(0.3, 0.7, k.y));
  return metalPresent(diffCorner(c, 0.4, 1.0) * (0.5 + 0.5 * fbm01(p, 4, 3u)) * cool, surf, uv, 0.0);`);
C('steam_quench', 'quench', 'quench steam pocking the hot corner', ['scale', 'patch', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, 60.0, 0.1, 0.8);
  let steam = smoothstep(mix(0.4, 0.6, k.y), 0.75, fbm01(c * mix(4.0, 8.0, k.x) - vec2f(0.0, t), 4, 8u));
  return metalPresent(diffCorner(c, 0.4, 1.0) * (1.0 - steam), surf, uv, 0.0);`);
C('flash_cool', 'quench', 'a flash quench: the corner darkening in pulses', ['conductivity', 'rate', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, 60.0, 0.1, 0.8);
  let flash = 1.0 - pow(0.5 + 0.5 * sin(t * mix(1.5, 4.0, k.y)), 3.0) * 0.7;
  return metalPresent(diffCorner(c, mix(0.2, 0.45, k.x), 1.0) * flash, surf, uv, 0.0);`);
C('uneven_quench', 'quench', 'patchy quenching, cold streaks eating the glow', ['scale', 'rate', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, 55.0, 0.1, 0.8);
  let patchN = fbm01(c * mix(3.0, 6.0, k.x) + vec2f(0.0, t * 0.1), 4, 8u);
  return metalPresent(diffCorner(c, 0.4, 1.0) * smoothstep(mix(0.3, 0.5, k.y), 0.7, patchN), surf, uv, 0.0);`);
C('residual', 'quench', 'only a faint residual warmth left at the corner', ['conductivity', 'level', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, 65.0, 0.1, 0.8);
  return metalPresent(diffCorner(c, mix(0.08, 0.2, k.x), 1.0) * mix(0.3, 0.7, k.y), surf, uv, 0.0);`);

// ---------------------------------------------------------------- oxide (tempering colors from the corner)
C('temper_rings', 'oxide', 'tempering rings radiating from the hot corner', ['reach', 'noise', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, mix(40.0, 80.0, k.y), 0.1, 0.8);
  let x = clamp(1.0 - length(c) / mix(0.4, 1.0, k.x), 0.0, 1.0) * u.energy;
  return vec4f(clamp(temperColor(x) * (0.5 + 0.7 * surf), vec3f(0.0), vec3f(1.0)), 1.0);`);
C('temper_grow', 'oxide', 'temper colors climbing outward as it heats', ['reach', 'rate', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, 60.0, 0.1, 0.8);
  let grow = 0.4 + 0.6 * (0.5 + 0.5 * sin(t * mix(0.3, 0.9, k.y)));
  let x = clamp(1.0 - length(c) / (mix(0.4, 0.9, k.x) * grow), 0.0, 1.0);
  return vec4f(clamp(temperColor(x) * (0.5 + 0.7 * surf), vec3f(0.0), vec3f(1.0)), 1.0);`);
C('heat_tint_corner', 'oxide', 'a weld heat-tint fanning from the corner', ['reach', 'width', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, 60.0, 0.6, 0.8);
  let x = clamp(1.0 - length(c) * mix(1.5, 3.0, k.y), 0.0, 1.0);
  return vec4f(clamp(temperColor(x) * (0.5 + 0.7 * surf), vec3f(0.0), vec3f(1.0)), 1.0);`);
C('bluing_corner', 'oxide', 'gun-bluing deepening toward the hot corner', ['reach', 'depth', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, mix(50.0, 80.0, k.x), 0.1, 0.8);
  let x = clamp(1.0 - length(c) / mix(0.5, 1.1, k.y), 0.0, 1.0) * 0.9 + 0.1;
  return vec4f(clamp(temperColor(x) * (0.4 + 0.6 * surf), vec3f(0.0), vec3f(1.0)), 1.0);`);
C('temper_grain', 'oxide', 'tempering colors following the grain from the corner', ['reach', 'angle', '', ''],
 `  let ang = mix(0.0, 1.2, k.y); let surf = brushed(uv, 70.0, ang, 0.9);
  let c = rot2(ang) * corner(uv) * vec2f(1.0, 0.45);
  let x = clamp(1.0 - length(c) / mix(0.4, 0.9, k.x), 0.0, 1.0);
  return vec4f(clamp(temperColor(x) * (0.5 + 0.7 * surf), vec3f(0.0), vec3f(1.0)), 1.0);`);
C('temper_marble', 'oxide', 'oxide tempering marbled around the corner', ['scale', 'flow', '', ''],
 `  var c = corner(uv); c += vec2f(fbm(c * mix(2.0, 4.0, k.x) + t * 0.03, 4, 33u), fbm(c * 2.0 + 5.2, 4, 41u)) * mix(0.15, 0.4, k.y);
  let surf = brushed(uv, 55.0, 0.1, 0.8);
  let x = clamp(1.0 - length(c) / 0.7, 0.0, 1.0);
  return vec4f(clamp(temperColor(x) * (0.5 + 0.7 * surf), vec3f(0.0), vec3f(1.0)), 1.0);`);
C('temper_bands', 'oxide', 'banded tempering colors stepping out from the corner', ['reach', 'bands', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, 70.0, 0.1, 0.9);
  let x = clamp(1.0 - length(c) / mix(0.5, 1.0, k.x), 0.0, 1.0);
  let banded = floor(x * mix(4.0, 8.0, k.y)) / mix(4.0, 8.0, k.y);
  return vec4f(clamp(temperColor(banded) * (0.5 + 0.7 * surf), vec3f(0.0), vec3f(1.0)), 1.0);`);

// ---------------------------------------------------------------- surface (metal finishes, corner heat glowing through)
C('brushed_finish', 'surface', 'brushed steel with the corner glowing through the grain', ['freq', 'reach', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, mix(40.0, 90.0, k.x), 0.0, 1.0);
  return metalPresent(diffCorner(c, mix(0.25, 0.5, k.y), 1.0) * (0.7 + 0.5 * surf), surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));`);
C('damascus_finish', 'surface', 'a damascus billet, its pattern warmed from the corner', ['freq', 'reach', '', ''],
 `  let p = vec2f(uv.x, uv.y + 0.15 * sin(uv.x * mix(6.0, 14.0, k.x)));
  let surf = 0.4 + 0.5 * (0.5 + 0.5 * sin(p.y * mix(20.0, 50.0, k.x) + fbm(p * 4.0, 3, 5u) * 4.0));
  let c = corner(uv);
  return metalPresent(diffCorner(c, mix(0.25, 0.5, k.y), 1.0) * (0.7 + 0.5 * surf), surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));`);
C('scratched_finish', 'surface', 'a scratched plate, heat pooling in the grooves', ['freq', 'reach', '', ''],
 `  let scr = fbm01(uv * vec2f(mix(3.0, 6.0, k.x), 60.0), 3, 13u);
  let surf = clamp(0.3 + 0.7 * scr, 0.0, 1.0);
  let c = corner(uv);
  return metalPresent(diffCorner(c, mix(0.25, 0.5, k.y), 1.0) * (0.6 + 0.7 * scr), surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));`);
C('mesh_finish', 'surface', 'a grate heating, the bars nearest the corner first', ['pitch', 'reach', '', ''],
 `  let g = mix(6.0, 16.0, k.x);
  let bars = max(abs(fract(uv.x * g) - 0.5), abs(fract(uv.y * g) - 0.5));
  let surf = smoothstep(0.2, 0.45, bars);
  let c = corner(uv);
  return metalPresent(diffCorner(c, mix(0.3, 0.55, k.y), 1.0) * surf, surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));`);
C('mill_finish', 'surface', 'a rolled mill finish warmed from the corner', ['freq', 'reach', '', ''],
 `  let c = corner(uv); let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.05, 0.6);
  return metalPresent(diffCorner(c, mix(0.25, 0.5, k.y), 1.0) * (0.7 + 0.4 * fbm01(uv * vec2f(2.0, 6.0), 3, 3u)), surf, uv, metalSparks(uv, t, 0.25, 0.8, 61u));`);

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
