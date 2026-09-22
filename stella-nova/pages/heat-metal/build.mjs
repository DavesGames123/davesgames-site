// ============================================================================
//  HEAT METAL TABLE  ·  build.mjs — the single source of truth for the page
// ────────────────────────────────────────────────────────────────────────────
//  Reimagined around a real heat-equation compute simulation. Every cell owns
//  two rgba32float textures (ping-pong); a compute kernel diffuses temperature
//  and injects it from a moving source, and a present pass colors the field
//  through a magma/inferno metal palette with a white-hot core. Run with:
//      node build.mjs
//
//  MODEL
//    state.x is temperature in 0..1. A kernel reads the neighbourhood (ld/lap),
//    steps the heat equation v = T + D*laplacian, injects heat from a source,
//    and cools everywhere so a trail fades behind a moving emitter. The 60
//    cells vary the source (orbiting, drifting, twin, line, rain), the
//    diffusion (isotropic, anisotropic, advected by a swirl) and combustion
//    (autocatalytic fire fronts). Each cell picks one of eight palettes.
//    Simulations step only while hovered and reset when the pointer leaves.
//
//  GREP MAP (pack.wgsl)
//    struct SimU ...... uniform block  ·  const N .. 128 grid
//    fn ld/lap/lapAniso ... neighbourhood reads and diffusion stencils
//    fn emit/flick .... moving heat source  ·  fn swirl/advectT .. turbulence
//    fn inferno/pMagma/pForge/... the eight palettes
//    @compute cs_* .... the 60 heat kernels  ·  fn fs_present .. colorize
// ============================================================================
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));

const FAM = {
  wander:      'rgba(255,120,40,0.14)',
  forge:       'rgba(255,90,30,0.14)',
  emitters:    'rgba(255,160,60,0.13)',
  quench:      'rgba(200,90,60,0.13)',
  anisotropic: 'rgba(255,140,70,0.13)',
  turbulent:   'rgba(255,110,50,0.14)',
  reaction:    'rgba(255,70,30,0.14)',
};

// palette names -> present mode index (must match fs_present below)
const PAL = { inferno: 0, magma: 1, forge: 2, ember: 3, plasma: 4, copper: 5, steel: 6, gold: 7 };

const HELPERS = `// ═══════════════════════════════════════════════════════════════════════════
//  HEAT METAL TABLE  ·  a heat-equation compute simulation, one kernel per cell.
//  Each cell owns two rgba32float textures (ping-pong). state.x is temperature
//  in 0..1. A kernel reads src, writes dst; the present pass colors dst through
//  a metal palette. Heat diffuses (v = T + D*laplacian), is injected from a
//  moving source, and cools everywhere so a trail fades behind the emitter.
//  Heat equation is explicit FTCS; the advected cells back-trace a swirl field.
// ═══════════════════════════════════════════════════════════════════════════
struct SimU {
    size: vec2f, time: f32, pixelScale: f32,
    ink: vec4f, tone: vec4f, cream: vec4f,
    k: vec4f,
    frame: f32, seed: f32, dt: f32, reset: f32,
}
@group(0) @binding(0) var<uniform> u: SimU;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba32float, write>;

const N: i32 = 128;
const PI: f32 = 3.14159265358979;
const TAU: f32 = 6.28318530717959;

fn pcg(vin: vec3u) -> vec3u { var v = vin * 1664525u + 1013904223u; v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y; v ^= v >> vec3u(16u); v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y; return v; }
fn rnd(p: vec2i, s: f32) -> f32 { return f32(pcg(vec3u(u32(p.x + 65536), u32(p.y + 65536), u32(s * 1000.0) + 7u)).x) / 4294967295.0; }
fn wrap(p: vec2i) -> vec2i { return ((p % N) + N) % N; }
fn ld(p: vec2i) -> vec4f { return textureLoad(src, wrap(p), 0); }
fn lap(p: vec2i) -> f32 { return ld(p + vec2i(1, 0)).x + ld(p - vec2i(1, 0)).x + ld(p + vec2i(0, 1)).x + ld(p - vec2i(0, 1)).x - 4.0 * ld(p).x; }
fn lapAniso(p: vec2i, ax: f32, ay: f32) -> f32 { return ax * (ld(p + vec2i(1, 0)).x + ld(p - vec2i(1, 0)).x) + ay * (ld(p + vec2i(0, 1)).x + ld(p - vec2i(0, 1)).x) - 2.0 * (ax + ay) * ld(p).x; }
fn cen(p: vec2i) -> vec2f { return (vec2f(p) + 0.5) / f32(N) - 0.5; }
fn emit(p: vec2i, ctr: vec2f, radius: f32) -> f32 { let d = length(cen(p) - ctr); return exp(-(d * d) / (radius * radius)); }
fn flick(p: vec2i, t: f32) -> f32 { return 0.55 + 0.45 * rnd(p, floor(t * 10.0)); }
fn swirl(c: vec2f, t: f32) -> vec2f { let r = length(c) + 0.08; return vec2f(-c.y, c.x) / r * 0.35 + 0.2 * vec2f(sin(c.y * 9.0 + t), cos(c.x * 9.0 - t)); }
fn advectT(p: vec2i, vel: vec2f) -> f32 {
    let q = vec2f(p) + 0.5 - vel; let i = vec2i(floor(q)); let f = fract(q);
    let a = ld(i).x; let b = ld(i + vec2i(1, 0)).x; let cc = ld(i + vec2i(0, 1)).x; let d = ld(i + vec2i(1, 1)).x;
    return mix(mix(a, b, f.x), mix(cc, d, f.x), f.y);
}
`;

// ── the 60 heat kernels. body reads p, t, k and ends with a textureStore. ────
const cells = [];
const C = (name, family, species, knobs, pal, steps, body) => cells.push({ name, family, species, knobs, pal, steps, body });
const KHEAT = ['diffusion', 'source', 'cooling', ''];
// standard heat body: diffuse, inject at ctr, cool. ctr is a WGSL vec2f expr.
const heat = (ctr, opt = {}) => {
  const rad = opt.rad || 'mix(0.06, 0.13, k.y)';
  const wob = opt.wob === false ? '' : ` * (0.85 + 0.15 * sin(t * 5.0 + d * 40.0))`;
  const src = opt.src || '0.35';
  return `  let T = ld(p).x; let v0 = T + mix(0.05, 0.24, k.x) * lap(p);
  let ctr = ${ctr};
  let d = length(cen(p) - ctr);
  let radius = ${rad}${wob};
  let core = exp(-(d * d) / (radius * radius));
  var v = v0 + ${src} * core * flick(p, t) * (0.55 + k.y);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`;
};

// ---------------------------------------------------------------- wander (the hero: a hot emitter roams, leaving a cooling trail)
C('orbit', 'wander', 'a hot spot orbiting the centre, trailing a cooling wake', KHEAT, 'inferno', 4,
  heat('0.30 * vec2f(cos(t * 0.7), sin(t * 0.9))'));
C('orbit_fast', 'wander', 'a fast orbit that smears heat into a glowing ring', KHEAT, 'inferno', 4,
  heat('0.30 * vec2f(cos(t * 1.8), sin(t * 1.8))', { src: '0.4' }));
C('orbit_slow', 'wander', 'a slow orbit, a heavy molten pool dragging behind', KHEAT, 'magma', 5,
  heat('0.28 * vec2f(cos(t * 0.35), sin(t * 0.35))', { rad: 'mix(0.09, 0.18, k.y)' }));
C('lissajous', 'wander', 'the emitter tracing a lissajous knot of heat', KHEAT, 'magma', 4,
  heat('vec2f(0.32 * sin(t * 0.8), 0.30 * sin(t * 1.3 + 1.0))'));
C('drift', 'wander', 'a wandering drift that never repeats its path', KHEAT, 'inferno', 4,
  heat('0.30 * vec2f(sin(t * 0.4) + 0.4 * sin(t * 1.1), cos(t * 0.5))'));
C('figure8', 'wander', 'a figure-eight weld path', KHEAT, 'forge', 4,
  heat('vec2f(0.32 * sin(t * 0.9), 0.26 * sin(t * 1.8))'));
C('spiral', 'wander', 'the source spiralling in and flinging back out', KHEAT, 'magma', 4,
  heat('(0.06 + 0.26 * abs(sin(t * 0.3))) * vec2f(cos(t * 2.0), sin(t * 2.0))'));
C('comet', 'wander', 'a fast comet of heat with a long slow-cooling tail', ['diffusion', 'source', 'tail', ''], 'inferno', 5,
  heat('0.32 * vec2f(cos(t * 1.3), sin(t * 1.1))', { rad: 'mix(0.05, 0.09, k.y)', src: '0.5' }));
C('jitter', 'wander', 'a jittering source, sputtering like a bad torch', KHEAT, 'ember', 4,
  heat('0.28 * vec2f(cos(t * 0.6), sin(t * 0.8)) + 0.05 * vec2f(rnd(vec2i(i32(t * 20.0), 0), 1.0) - 0.5, rnd(vec2i(i32(t * 20.0), 7), 1.0) - 0.5)'));
C('wobble_ring', 'wander', 'the hot patch pulsing wide then tight as it circles', KHEAT, 'gold', 4,
  heat('0.30 * vec2f(cos(t * 0.7), sin(t * 0.9))', { rad: 'mix(0.05, 0.16, k.y) * (0.6 + 0.5 * sin(t * 2.0))' }));

// ---------------------------------------------------------------- forge (steady strong heating of a billet)
C('billet', 'forge', 'a billet soaking evenly to a bright working heat', KHEAT, 'forge', 5,
  heat('vec2f(0.0)', { rad: 'mix(0.2, 0.36, k.y)', wob: false, src: '0.4' }));
C('billet_pulse', 'forge', 'the forge pumping heat with the bellows', KHEAT, 'forge', 5,
  `  let T = ld(p).x; let v0 = T + mix(0.06, 0.24, k.x) * lap(p);
  let pulse = 0.5 + 0.5 * sin(t * 1.2);
  var v = v0 + 0.45 * emit(p, vec2f(0.0), mix(0.2, 0.34, k.y)) * (0.4 + 0.9 * pulse);
  v *= 1.0 - mix(0.01, 0.05, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('soak', 'forge', 'a long soak, heat conducting evenly through the mass', KHEAT, 'gold', 6,
  heat('vec2f(0.0)', { rad: 'mix(0.25, 0.45, k.y)', wob: false, src: '0.3' }));
C('blast', 'forge', 'a furnace blast driving the whole face white-hot', KHEAT, 'steel', 5,
  `  let T = ld(p).x; let v0 = T + mix(0.08, 0.24, k.x) * lap(p);
  let blast = pow(0.5 + 0.5 * sin(t * 0.8), 2.0);
  var v = v0 + 0.6 * emit(p, vec2f(0.0), mix(0.28, 0.5, k.y)) * (0.5 + blast) * flick(p, t);
  v *= 1.0 - mix(0.008, 0.04, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('even_glow', 'forge', 'the plate glowing near-uniform at temperature', KHEAT, 'forge', 6,
  heat('vec2f(0.0)', { rad: 'mix(0.35, 0.6, k.y)', wob: false, src: '0.25' }));
C('core_bloom', 'forge', 'a central core blooming and breathing', KHEAT, 'magma', 5,
  heat('vec2f(0.0)', { rad: 'mix(0.1, 0.28, k.y) * (0.7 + 0.4 * sin(t * 1.5))', wob: false, src: '0.45' }));
C('ramp_soak', 'forge', 'a slow ramp up to a held soak temperature', KHEAT, 'forge', 5,
  `  let T = ld(p).x; let v0 = T + mix(0.06, 0.24, k.x) * lap(p);
  let ramp = smoothstep(0.0, 0.5, fract(t * 0.1)) * (1.0 - smoothstep(0.85, 1.0, fract(t * 0.1)));
  var v = v0 + 0.4 * emit(p, vec2f(0.0), mix(0.2, 0.38, k.y)) * (0.3 + ramp);
  v *= 1.0 - mix(0.01, 0.05, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('white_hot', 'forge', 'a billet driven past yellow into white heat', KHEAT, 'steel', 5,
  heat('vec2f(0.0)', { rad: 'mix(0.22, 0.4, k.y)', wob: false, src: '0.6' }));

// ---------------------------------------------------------------- emitters (multiple / structured sources)
C('twin', 'emitters', 'two orbiting torches bridging heat between them', KHEAT, 'inferno', 4,
  `  let T = ld(p).x; let v0 = T + mix(0.05, 0.24, k.x) * lap(p);
  let a = 0.28 * vec2f(cos(t * 0.7), sin(t * 0.9)); let b = -a;
  var v = v0 + 0.35 * (emit(p, a, mix(0.06, 0.11, k.y)) + emit(p, b, mix(0.06, 0.11, k.y))) * flick(p, t);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('triple', 'emitters', 'three sources rotating like a burner head', KHEAT, 'magma', 4,
  `  let T = ld(p).x; let v0 = T + mix(0.05, 0.24, k.x) * lap(p);
  var s = 0.0; for (var i: i32 = 0; i < 3; i++) { let a = f32(i) * 2.094 + t * 0.6; s += emit(p, 0.26 * vec2f(cos(a), sin(a)), mix(0.05, 0.1, k.y)); }
  var v = v0 + 0.34 * s * flick(p, t);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('line_sweep_h', 'emitters', 'a hot line sweeping left to right, a plasma cut', KHEAT, 'plasma', 4,
  `  let T = ld(p).x; let v0 = T + mix(0.05, 0.22, k.x) * lap(p);
  let xc = (fract(t * 0.15) * 2.0 - 1.0) * 0.45;
  let line = exp(-(cen(p).x - xc) * (cen(p).x - xc) / mix(0.001, 0.006, k.y));
  var v = v0 + 0.5 * line * flick(p, t);
  v *= 1.0 - mix(0.02, 0.07, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('line_sweep_v', 'emitters', 'a hot bar rising through the plate', KHEAT, 'forge', 4,
  `  let T = ld(p).x; let v0 = T + mix(0.05, 0.22, k.x) * lap(p);
  let yc = (fract(t * 0.13) * 2.0 - 1.0) * 0.45;
  let line = exp(-(cen(p).y - yc) * (cen(p).y - yc) / mix(0.001, 0.006, k.y));
  var v = v0 + 0.5 * line * flick(p, t);
  v *= 1.0 - mix(0.02, 0.07, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('rain', 'emitters', 'sparks raining down, each blooming a hot bloom', ['diffusion', 'density', 'cooling', ''], 'inferno', 4,
  `  let T = ld(p).x; let v0 = T + mix(0.06, 0.2, k.x) * lap(p);
  var v = v0 + step(1.0 - mix(0.002, 0.02, k.y), rnd(p, floor(t * 8.0))) * 0.9;
  v *= 1.0 - mix(0.02, 0.07, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('scatter', 'emitters', 'a scatter of fixed hot rivets pulsing together', KHEAT, 'copper', 4,
  `  let T = ld(p).x; let v0 = T + mix(0.05, 0.22, k.x) * lap(p);
  var s = 0.0; for (var i: i32 = 0; i < 5; i++) { let r = rnd(vec2i(i, 0), 3.0); let a = rnd(vec2i(i, 1), 3.0); s += emit(p, 0.35 * vec2f(cos(a * TAU), sin(a * TAU)) * r, mix(0.05, 0.1, k.y)); }
  var v = v0 + 0.3 * s * (0.5 + 0.5 * sin(t * 1.5));
  v *= 1.0 - mix(0.01, 0.05, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('chase', 'emitters', 'a source chasing fast around the rim', KHEAT, 'plasma', 4,
  heat('0.36 * vec2f(cos(t * 2.2), sin(t * 2.2))', { rad: 'mix(0.04, 0.08, k.y)', src: '0.5' }));
C('ring_source', 'emitters', 'an annulus of heat pumping in and out', KHEAT, 'gold', 4,
  `  let T = ld(p).x; let v0 = T + mix(0.05, 0.22, k.x) * lap(p);
  let rr = 0.2 + 0.12 * sin(t * 1.2);
  let ring = exp(-(length(cen(p)) - rr) * (length(cen(p)) - rr) / mix(0.001, 0.006, k.y));
  var v = v0 + 0.4 * ring * flick(p, t);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('pulse_grid', 'emitters', 'a grid of pilot flames pulsing in waves', KHEAT, 'inferno', 4,
  `  let T = ld(p).x; let v0 = T + mix(0.05, 0.2, k.x) * lap(p);
  let g = fract(cen(p) * mix(3.0, 6.0, k.y)) - 0.5;
  let dot = exp(-dot(g, g) * 30.0) * (0.5 + 0.5 * sin(t * 2.0 + length(cen(p)) * 12.0));
  var v = v0 + 0.35 * dot;
  v *= 1.0 - mix(0.02, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);

// ---------------------------------------------------------------- quench (heat builds then is pulled away)
C('quench_fade', 'quench', 'the torch lifts and the glow bleeds cooler', KHEAT, 'ember', 4,
  `  let T = ld(p).x; let v0 = T + mix(0.06, 0.22, k.x) * lap(p);
  let on = smoothstep(0.5, 0.35, fract(t * 0.15));
  var v = v0 + 0.4 * emit(p, 0.2 * vec2f(cos(t * 0.7), sin(t * 0.9)), mix(0.08, 0.16, k.y)) * on;
  v *= 1.0 - mix(0.03, 0.1, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('hard_quench', 'quench', 'a fierce quench, the heat sucked out fast', KHEAT, 'ember', 4,
  heat('0.24 * vec2f(cos(t * 0.8), sin(t * 0.6))', { src: '0.5' }).replace('mix(0.01, 0.06, k.z)', 'mix(0.06, 0.16, k.z)'));
C('receding', 'quench', 'a shrinking source, the pool receding to a point', KHEAT, 'copper', 4,
  heat('vec2f(0.0)', { rad: 'mix(0.04, 0.24, k.y) * (0.4 + 0.6 * abs(sin(t * 0.4)))', wob: false, src: '0.4' }));
C('flicker_die', 'quench', 'a guttering source dying out in fits', KHEAT, 'ember', 4,
  `  let T = ld(p).x; let v0 = T + mix(0.05, 0.2, k.x) * lap(p);
  let gate = 0.5 + 0.5 * sin(t * 3.0 + rnd(vec2i(i32(t * 4.0), 0), 1.0) * 6.0);
  var v = v0 + 0.4 * emit(p, vec2f(0.0), mix(0.1, 0.2, k.y)) * gate * gate;
  v *= 1.0 - mix(0.03, 0.09, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('cool_wave', 'quench', 'a cool front washing across the hot plate', KHEAT, 'copper', 4,
  `  let T = ld(p).x; let v0 = T + mix(0.06, 0.22, k.x) * lap(p);
  var v = v0 + 0.4 * emit(p, vec2f(0.0), mix(0.15, 0.3, k.y));
  let cx = (fract(t * 0.12) * 2.0 - 1.0);
  v *= 1.0 - mix(0.02, 0.1, k.z) * (1.0 + 2.0 * smoothstep(cx + 0.2, cx - 0.2, cen(p).x));
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('ember_die', 'quench', 'the last embers winking out across a dark plate', KHEAT, 'ember', 4,
  `  let T = ld(p).x; let v0 = T + mix(0.04, 0.16, k.x) * lap(p);
  var v = v0 + step(1.0 - mix(0.002, 0.01, k.y), rnd(p, floor(t * 4.0))) * 0.8;
  v *= 1.0 - mix(0.04, 0.12, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('gutter', 'quench', 'heat sloshing and guttering low', KHEAT, 'ember', 4,
  heat('0.2 * vec2f(sin(t * 0.9), cos(t * 1.3))', { rad: 'mix(0.07, 0.15, k.y)' }).replace('mix(0.01, 0.06, k.z)', 'mix(0.04, 0.11, k.z)'));
C('breathe', 'quench', 'the whole plate breathing between glow and dark', KHEAT, 'copper', 5,
  `  let T = ld(p).x; let v0 = T + mix(0.08, 0.24, k.x) * lap(p);
  let br = 0.5 + 0.5 * sin(t * mix(0.5, 1.5, k.y));
  var v = v0 + 0.4 * emit(p, vec2f(0.0), 0.3) * br;
  v *= 1.0 - mix(0.03, 0.08, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);

// ---------------------------------------------------------------- anisotropic (grain-directed conduction)
C('grain_h', 'anisotropic', 'heat conducting fast along a horizontal grain', ['diffusion', 'anisotropy', 'cooling', ''], 'forge', 4,
  `  let T = ld(p).x; let v0 = T + mix(0.05, 0.2, k.x) * lapAniso(p, mix(1.0, 3.0, k.y), 0.3);
  var v = v0 + 0.35 * emit(p, 0.25 * vec2f(cos(t * 0.7), sin(t * 0.9)), 0.09) * flick(p, t);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('grain_v', 'anisotropic', 'heat conducting fast along a vertical grain', ['diffusion', 'anisotropy', 'cooling', ''], 'forge', 4,
  `  let T = ld(p).x; let v0 = T + mix(0.05, 0.2, k.x) * lapAniso(p, 0.3, mix(1.0, 3.0, k.y));
  var v = v0 + 0.35 * emit(p, 0.25 * vec2f(cos(t * 0.7), sin(t * 0.9)), 0.09) * flick(p, t);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('weave', 'anisotropic', 'a woven plate, heat crossing at the tows', ['diffusion', 'anisotropy', 'cooling', ''], 'copper', 4,
  `  let bias = select(vec2f(mix(1.0, 3.0, k.y), 0.4), vec2f(0.4, mix(1.0, 3.0, k.y)), (p.x / 8 + p.y / 8) % 2 == 0);
  let T = ld(p).x; let v0 = T + mix(0.05, 0.2, k.x) * lapAniso(p, bias.x, bias.y);
  var v = v0 + 0.35 * emit(p, vec2f(0.0), 0.2);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('streaky', 'anisotropic', 'streaky conduction, hot lines pulling out', ['diffusion', 'anisotropy', 'cooling', ''], 'forge', 4,
  `  let ax = 0.4 + mix(0.0, 2.6, k.y) * (0.5 + 0.5 * sin(cen(p).y * 30.0));
  let T = ld(p).x; let v0 = T + mix(0.05, 0.2, k.x) * lapAniso(p, ax, 0.4);
  var v = v0 + 0.35 * emit(p, 0.22 * vec2f(cos(t * 0.6), sin(t * 0.8)), 0.1) * flick(p, t);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('fiber', 'anisotropic', 'fibrous metal, heat wicking along the fibres', ['diffusion', 'anisotropy', 'cooling', ''], 'gold', 4,
  `  let ay = 0.4 + mix(0.0, 2.6, k.y) * (0.5 + 0.5 * sin(cen(p).x * 34.0));
  let T = ld(p).x; let v0 = T + mix(0.05, 0.2, k.x) * lapAniso(p, 0.4, ay);
  var v = v0 + 0.35 * emit(p, vec2f(0.0), 0.15);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('layered', 'anisotropic', 'laminated sheet conducting along its layers', ['diffusion', 'anisotropy', 'cooling', ''], 'copper', 4,
  `  let T = ld(p).x; let v0 = T + mix(0.05, 0.2, k.x) * lapAniso(p, mix(1.5, 3.0, k.y), 0.2);
  var v = v0 + 0.4 * emit(p, 0.2 * vec2f(cos(t * 0.5), 0.0) + vec2f(0.0, sin(t * 0.6) * 0.2), 0.08) * flick(p, t);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('rolled', 'anisotropic', 'rolled steel, heat racing in the roll direction', ['diffusion', 'anisotropy', 'cooling', ''], 'forge', 4,
  `  let T = ld(p).x; let v0 = T + mix(0.06, 0.22, k.x) * lapAniso(p, mix(1.2, 3.2, k.y), 0.5);
  var v = v0 + 0.45 * emit(p, vec2f(-0.35, 0.0), mix(0.1, 0.2, k.y));
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('diagonal', 'anisotropic', 'heat drawn out along the diagonal grain', ['diffusion', 'anisotropy', 'cooling', ''], 'magma', 4,
  `  let ld0 = ld(p).x;
  let dg = ld(p + vec2i(1, 1)).x + ld(p - vec2i(1, 1)).x - 2.0 * ld0;
  let T = ld0; let v0 = T + mix(0.05, 0.2, k.x) * (lap(p) * 0.4 + dg * mix(0.5, 1.6, k.y));
  var v = v0 + 0.35 * emit(p, 0.25 * vec2f(cos(t * 0.7), sin(t * 0.7)), 0.1) * flick(p, t);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);

// ---------------------------------------------------------------- turbulent (heat advected by a swirl)
C('advect_swirl', 'turbulent', 'heat dragged around a swirling convection cell', ['diffusion', 'flow', 'cooling', 'swirl'], 'magma', 4,
  `  let vel = swirl(cen(p), t) * mix(0.5, 3.0, k.w) * f32(N);
  let T = advectT(p, vel * 0.02); let v0 = T + mix(0.03, 0.12, k.x) * lap(p);
  var v = v0 + 0.35 * emit(p, 0.2 * vec2f(cos(t * 0.6), sin(t * 0.8)), mix(0.06, 0.12, k.y)) * flick(p, t);
  v *= 1.0 - mix(0.01, 0.05, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('vortex', 'turbulent', 'a vortex winding the molten glow into a spiral', ['diffusion', 'flow', 'cooling', 'swirl'], 'inferno', 4,
  `  let c = cen(p); let vel = vec2f(-c.y, c.x) / (length(c) + 0.06) * mix(0.5, 2.5, k.w) * f32(N);
  let T = advectT(p, vel * 0.02); let v0 = T + mix(0.03, 0.1, k.x) * lap(p);
  var v = v0 + 0.35 * emit(p, vec2f(0.22, 0.0), mix(0.06, 0.12, k.y)) * flick(p, t);
  v *= 1.0 - mix(0.01, 0.05, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('boil', 'turbulent', 'molten metal boiling and roiling in place', ['diffusion', 'flow', 'cooling', 'churn'], 'magma', 4,
  `  let c = cen(p); let vel = vec2f(sin(c.y * 12.0 + t * mix(1.0, 3.0, k.w)), cos(c.x * 12.0 - t * mix(1.0, 3.0, k.w))) * f32(N);
  let T = advectT(p, vel * 0.015); let v0 = T + mix(0.03, 0.12, k.x) * lap(p);
  var v = v0 + 0.35 * emit(p, vec2f(0.0), mix(0.14, 0.3, k.y)) * flick(p, t);
  v *= 1.0 - mix(0.01, 0.05, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('curl_drift', 'turbulent', 'heat carried on a curling draught', ['diffusion', 'flow', 'cooling', 'swirl'], 'inferno', 4,
  `  let vel = (swirl(cen(p), t) + vec2f(0.15, 0.0)) * mix(0.5, 2.5, k.w) * f32(N);
  let T = advectT(p, vel * 0.02); let v0 = T + mix(0.03, 0.12, k.x) * lap(p);
  var v = v0 + 0.35 * emit(p, vec2f(-0.3, 0.0), mix(0.07, 0.13, k.y)) * flick(p, t);
  v *= 1.0 - mix(0.01, 0.05, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('eddies', 'turbulent', 'nested eddies shredding the hot streaks', ['diffusion', 'flow', 'cooling', 'swirl'], 'plasma', 4,
  `  let c = cen(p); let vel = (vec2f(-c.y, c.x) / (length(c) + 0.1) + 0.4 * vec2f(sin(c.y * 20.0 + t), cos(c.x * 20.0 - t))) * mix(0.5, 2.0, k.w) * f32(N);
  let T = advectT(p, vel * 0.018); let v0 = T + mix(0.03, 0.1, k.x) * lap(p);
  var v = v0 + 0.35 * emit(p, 0.2 * vec2f(cos(t * 0.5), sin(t * 0.7)), 0.1) * flick(p, t);
  v *= 1.0 - mix(0.01, 0.05, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('plume_rise', 'turbulent', 'a thermal plume of heat rising and mushrooming', ['diffusion', 'flow', 'cooling', 'lift'], 'inferno', 4,
  `  let c = cen(p); let vel = (vec2f(0.0, mix(0.3, 1.2, k.w)) + 0.3 * vec2f(sin(c.y * 8.0 + t), 0.0)) * f32(N);
  let T = advectT(p, vel * 0.02); let v0 = T + mix(0.03, 0.12, k.x) * lap(p);
  var v = v0 + 0.4 * emit(p, vec2f(0.0, -0.35), mix(0.08, 0.16, k.y)) * flick(p, t);
  v *= 1.0 - mix(0.01, 0.05, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('convection', 'turbulent', 'convection rolls carrying heat up and over', ['diffusion', 'flow', 'cooling', 'roll'], 'magma', 4,
  `  let c = cen(p); let vel = vec2f(sin(c.x * 6.0) * cos(c.y * 6.0), -cos(c.x * 6.0) * sin(c.y * 6.0)) * mix(0.5, 2.5, k.w) * f32(N);
  let T = advectT(p, vel * 0.02); let v0 = T + mix(0.03, 0.12, k.x) * lap(p);
  var v = v0 + 0.35 * emit(p, vec2f(0.0, -0.3), mix(0.1, 0.2, k.y));
  v *= 1.0 - mix(0.01, 0.05, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('storm', 'turbulent', 'a full storm of hot turbulence', ['diffusion', 'flow', 'cooling', 'swirl'], 'inferno', 4,
  `  let c = cen(p); let vel = (swirl(c, t) + swirl(c * 2.3 + 4.0, t * 1.4) * 0.6) * mix(0.6, 3.0, k.w) * f32(N);
  let T = advectT(p, vel * 0.02); let v0 = T + mix(0.03, 0.1, k.x) * lap(p);
  var v = v0 + 0.35 * emit(p, 0.2 * vec2f(cos(t * 0.9), sin(t * 1.2)), 0.1) * flick(p, t);
  v *= 1.0 - mix(0.01, 0.05, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('smoke_heat', 'turbulent', 'heat bleeding upward like smoke off the surface', ['diffusion', 'flow', 'cooling', 'lift'], 'copper', 4,
  `  let c = cen(p); let vel = (vec2f(0.0, mix(0.2, 0.9, k.w)) + 0.4 * swirl(c, t)) * f32(N);
  let T = advectT(p, vel * 0.02); let v0 = T + mix(0.03, 0.12, k.x) * lap(p);
  var v = v0 + 0.35 * emit(p, vec2f(sin(t * 0.5) * 0.2, -0.35), mix(0.08, 0.15, k.y)) * flick(p, t);
  v *= 1.0 - mix(0.02, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);

// ---------------------------------------------------------------- reaction (autocatalytic combustion fronts)
C('combustion', 'reaction', 'a fire front igniting and spreading through fuel', ['diffusion', 'ignition', 'burnout', 'spread'], 'inferno', 6,
  `  let T = ld(p).x; let v0 = T + mix(0.04, 0.12, k.x) * lap(p);
  var v = v0 + mix(0.5, 1.6, k.w) * v0 * (1.0 - v0) * step(0.12, v0);
  v += 0.5 * emit(p, vec2f(0.0), mix(0.03, 0.07, k.y)) * flick(p, t);
  v *= 1.0 - mix(0.02, 0.08, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('fire_front', 'reaction', 'a travelling combustion front sweeping the plate', ['diffusion', 'ignition', 'burnout', 'spread'], 'forge', 6,
  `  let T = ld(p).x; let v0 = T + mix(0.04, 0.12, k.x) * lap(p);
  var v = v0 + mix(0.6, 1.8, k.w) * v0 * (1.0 - v0) * step(0.1, v0);
  v += 0.6 * emit(p, vec2f(-0.4, 0.0), mix(0.03, 0.06, k.y));
  v *= 1.0 - mix(0.02, 0.07, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('kpp_spread', 'reaction', 'Fisher-KPP logistic spread of heat', ['diffusion', 'ignition', 'burnout', 'growth'], 'magma', 6,
  `  let T = ld(p).x; let v0 = T + mix(0.05, 0.15, k.x) * lap(p);
  var v = v0 + mix(0.3, 1.2, k.w) * v0 * (1.0 - v0);
  v += 0.4 * emit(p, 0.25 * vec2f(cos(t * 0.4), sin(t * 0.5)), mix(0.03, 0.07, k.y)) * flick(p, t);
  v *= 1.0 - mix(0.02, 0.07, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('ignite_wander', 'reaction', 'a wandering torch lighting fires as it goes', ['diffusion', 'ignition', 'burnout', 'spread'], 'inferno', 6,
  `  let T = ld(p).x; let v0 = T + mix(0.04, 0.12, k.x) * lap(p);
  var v = v0 + mix(0.5, 1.5, k.w) * v0 * (1.0 - v0) * step(0.14, v0);
  v += 0.5 * emit(p, 0.3 * vec2f(cos(t * 0.7), sin(t * 0.9)), mix(0.03, 0.06, k.y)) * flick(p, t);
  v *= 1.0 - mix(0.03, 0.09, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('flare', 'reaction', 'periodic flares igniting and burning out', ['diffusion', 'ignition', 'burnout', 'spread'], 'plasma', 6,
  `  let T = ld(p).x; let v0 = T + mix(0.04, 0.12, k.x) * lap(p);
  var v = v0 + mix(0.5, 1.6, k.w) * v0 * (1.0 - v0) * step(0.12, v0);
  v += 0.7 * emit(p, vec2f(0.0), 0.05) * pow(0.5 + 0.5 * sin(t * 1.5), 3.0);
  v *= 1.0 - mix(0.03, 0.09, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('autocatalytic', 'reaction', 'runaway autocatalytic heating, hard to quench', ['diffusion', 'ignition', 'burnout', 'spread'], 'steel', 6,
  `  let T = ld(p).x; let v0 = T + mix(0.05, 0.14, k.x) * lap(p);
  var v = v0 + mix(0.8, 2.0, k.w) * v0 * (1.0 - v0);
  v += 0.4 * emit(p, vec2f(0.0), mix(0.04, 0.08, k.y)) * flick(p, t);
  v *= 1.0 - mix(0.01, 0.05, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('wildfire', 'reaction', 'many ignition seeds racing into a wildfire', ['diffusion', 'seeds', 'burnout', 'spread'], 'inferno', 6,
  `  let T = ld(p).x; let v0 = T + mix(0.04, 0.12, k.x) * lap(p);
  var v = v0 + mix(0.6, 1.8, k.w) * v0 * (1.0 - v0) * step(0.1, v0);
  v += step(1.0 - mix(0.001, 0.008, k.y), rnd(p, floor(t * 3.0))) * 0.8;
  v *= 1.0 - mix(0.02, 0.08, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);
C('chain', 'reaction', 'a chain reaction rippling out in rings', ['diffusion', 'ignition', 'burnout', 'spread'], 'magma', 6,
  `  let T = ld(p).x; let v0 = T + mix(0.05, 0.14, k.x) * lap(p);
  var v = v0 + mix(0.5, 1.6, k.w) * v0 * (1.0 - v0) * step(0.12, v0);
  let rr = fract(t * 0.2) * 0.6;
  v += 0.6 * exp(-(length(cen(p)) - rr) * (length(cen(p)) - rr) / mix(0.001, 0.005, k.y));
  v *= 1.0 - mix(0.02, 0.08, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));`);

const CELLS = cells;
const MODES = {}; const STEPS = {};
for (const c of CELLS) { MODES[c.name] = PAL[c.pal]; STEPS[c.name] = c.steps; }

// ── emit pack.wgsl ───────────────────────────────────────────────────────────
const kernel = c =>
  `@compute @workgroup_size(8, 8) fn cs_${c.name}(@builtin(global_invocation_id) id: vec3u) {\n  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }\n  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }\n  let t = u.time; let k = u.k;\n${c.body}\n}`;

const PRESENT = `
// ─────────────────────────────────────────────── present: temperature → metal color
@group(0) @binding(0) var<uniform> pu: SimU;
@group(0) @binding(1) var pTex: texture_2d<f32>;
@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(p[i], 0.0, 1.0);
}
// Inferno colormap (matplotlib), 7th-order polynomial fit.
fn inferno(t: f32) -> vec3f {
    let x = clamp(t, 0.0, 1.0);
    return vec3f(0.00021894, 0.00165100, -0.01948090)
      + x * (vec3f(0.10651342, 0.56395644, 3.93271239)
      + x * (vec3f(11.60249308, -3.97285397, -15.94239411)
      + x * (vec3f(-41.70399613, 17.43639888, 44.35414520)
      + x * (vec3f(77.16293570, -33.40235894, -81.80730926)
      + x * (vec3f(-71.31942824, 32.62606426, 73.20951986)
      + x * (vec3f(25.13112622, -12.24266895, -23.07032500)))))));
}
fn pMagma(x: f32) -> vec3f {
    let t = clamp(x, 0.0, 1.0);
    var c = mix(vec3f(0.001, 0.0, 0.014), vec3f(0.12, 0.06, 0.28), smoothstep(0.0, 0.22, t));
    c = mix(c, vec3f(0.42, 0.11, 0.42), smoothstep(0.2, 0.42, t));
    c = mix(c, vec3f(0.78, 0.24, 0.36), smoothstep(0.4, 0.6, t));
    c = mix(c, vec3f(0.98, 0.55, 0.32), smoothstep(0.58, 0.78, t));
    c = mix(c, vec3f(0.99, 0.86, 0.62), smoothstep(0.76, 0.94, t));
    return mix(c, vec3f(1.0, 0.99, 0.9), smoothstep(0.92, 1.0, t));
}
fn pForge(x: f32) -> vec3f {
    let t = clamp(x, 0.0, 1.0);
    var c = mix(vec3f(0.02, 0.0, 0.0), vec3f(0.5, 0.03, 0.01), smoothstep(0.0, 0.2, t));
    c = mix(c, vec3f(0.92, 0.18, 0.02), smoothstep(0.18, 0.42, t));
    c = mix(c, vec3f(1.0, 0.55, 0.08), smoothstep(0.4, 0.62, t));
    c = mix(c, vec3f(1.0, 0.85, 0.35), smoothstep(0.6, 0.82, t));
    return mix(c, vec3f(1.0, 1.0, 0.95), smoothstep(0.82, 1.0, t));
}
fn pEmber(x: f32) -> vec3f {
    let t = clamp(x, 0.0, 1.0);
    var c = mix(vec3f(0.02, 0.0, 0.0), vec3f(0.35, 0.03, 0.01), smoothstep(0.0, 0.3, t));
    c = mix(c, vec3f(0.75, 0.14, 0.02), smoothstep(0.28, 0.55, t));
    c = mix(c, vec3f(0.98, 0.42, 0.08), smoothstep(0.52, 0.8, t));
    return mix(c, vec3f(1.0, 0.68, 0.28), smoothstep(0.8, 1.0, t));
}
fn pPlasma(x: f32) -> vec3f {
    let t = clamp(x, 0.0, 1.0);
    var c = mix(vec3f(0.05, 0.03, 0.53), vec3f(0.4, 0.0, 0.66), smoothstep(0.0, 0.28, t));
    c = mix(c, vec3f(0.72, 0.18, 0.53), smoothstep(0.26, 0.5, t));
    c = mix(c, vec3f(0.93, 0.47, 0.29), smoothstep(0.48, 0.72, t));
    c = mix(c, vec3f(0.98, 0.79, 0.19), smoothstep(0.7, 0.92, t));
    return mix(c, vec3f(0.99, 0.95, 0.6), smoothstep(0.9, 1.0, t));
}
fn pCopper(x: f32) -> vec3f {
    let t = clamp(x, 0.0, 1.0);
    var c = mix(vec3f(0.01, 0.0, 0.0), vec3f(0.24, 0.09, 0.04), smoothstep(0.0, 0.25, t));
    c = mix(c, vec3f(0.58, 0.27, 0.13), smoothstep(0.22, 0.5, t));
    c = mix(c, vec3f(0.87, 0.53, 0.3), smoothstep(0.48, 0.74, t));
    c = mix(c, vec3f(1.0, 0.82, 0.58), smoothstep(0.72, 0.92, t));
    return mix(c, vec3f(1.0, 0.96, 0.86), smoothstep(0.9, 1.0, t));
}
fn pSteel(x: f32) -> vec3f {
    let t = clamp(x, 0.0, 1.0);
    var c = mix(vec3f(0.0, 0.0, 0.0), vec3f(0.35, 0.03, 0.01), smoothstep(0.0, 0.2, t));
    c = mix(c, vec3f(0.95, 0.4, 0.1), smoothstep(0.18, 0.42, t));
    c = mix(c, vec3f(1.0, 0.9, 0.6), smoothstep(0.4, 0.62, t));
    c = mix(c, vec3f(0.85, 0.92, 1.0), smoothstep(0.62, 0.82, t));
    return mix(c, vec3f(0.7, 0.85, 1.0), smoothstep(0.82, 1.0, t));
}
fn pGold(x: f32) -> vec3f {
    let t = clamp(x, 0.0, 1.0);
    var c = mix(vec3f(0.02, 0.0, 0.0), vec3f(0.2, 0.1, 0.0), smoothstep(0.0, 0.22, t));
    c = mix(c, vec3f(0.55, 0.32, 0.03), smoothstep(0.2, 0.45, t));
    c = mix(c, vec3f(0.88, 0.64, 0.12), smoothstep(0.43, 0.68, t));
    c = mix(c, vec3f(1.0, 0.88, 0.45), smoothstep(0.66, 0.88, t));
    return mix(c, vec3f(1.0, 1.0, 0.9), smoothstep(0.86, 1.0, t));
}
fn palette(mode: i32, t: f32) -> vec3f {
    if (mode == 0) { return inferno(t); }
    else if (mode == 1) { return pMagma(t); }
    else if (mode == 2) { return pForge(t); }
    else if (mode == 3) { return pEmber(t); }
    else if (mode == 4) { return pPlasma(t); }
    else if (mode == 5) { return pCopper(t); }
    else if (mode == 6) { return pSteel(t); }
    return pGold(t);
}
fn cell_state(fp: vec2f) -> vec4f {
    let pos = fp / pu.pixelScale; let uv = (pos - 0.5 * pu.size) / max(min(pu.size.x, pu.size.y), 1.0) + 0.5;
    return textureLoad(pTex, clamp(vec2i(uv * f32(N)), vec2i(0), vec2i(N - 1)), 0);
}
@fragment fn fs_present(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = cell_state(fp.xy); let mode = i32(pu.reset);   // present reuses the reset slot as the palette mode
    let t = clamp(s.x, 0.0, 1.0);
    var c = palette(mode, t);
    // white-hot core: the hottest metal over-saturates toward white, like real emission
    c += vec3f(1.0, 0.92, 0.75) * smoothstep(0.72, 1.0, t) * 1.5;
    return vec4f(c, 1.0);
}
`;

const pack = HELPERS + '\n// ── the 60 heat kernels ──────────────────────────────────────────────────────\n' +
  CELLS.map(kernel).join('\n\n') + '\n' + PRESENT;

// ── emit spec.json ───────────────────────────────────────────────────────────
const spec = {
  cols: 6,
  uniform_bytes: 96,
  cells: CELLS.map(c => ({ name: c.name, family: c.family, species: c.species, knobs: c.knobs, defaults: [0.5, 0.5, 0.5, 0.5], fn: 'cs_' + c.name })),
  gens: [
    { id: 'tempo', title: 'Tempo · simulation speed', fn: 'flat', period: 8, amp: 0.0, bias: 0.5, phase: 0,
      map: 'y => 0.2 + 2.8 * y', unit: "v => v.toFixed(2) + 'x'" },
  ],
  swatches: [
    { id: 'ink', label: 'Ink', hex: '#0a0604' },
    { id: 'tone', label: 'Tone', hex: '#e2531a' },
    { id: 'cream', label: 'Cream', hex: '#ffd27a' },
  ],
};

// ── emit index.html ──────────────────────────────────────────────────────────
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const legend = Object.keys(FAM).map(f => `<span class="f-${f}"><i></i>${f}</span>`).join('');
const tiles = CELLS.map(c =>
  `<div class="cell f-${c.family}" role="button" tabindex="0" id="tile-${c.name}" aria-label="${esc(c.name.replace(/_/g, ' ') + ': ' + c.species)}"><canvas></canvas><span class="orb-status"></span><span class="tag">${c.name.replace(/_/g, ' ')}</span></div>`).join('');
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
   ${CELLS.length} heat-equation compute simulations. A wandering source diffuses heat
   through metal; the present pass colors temperature through a metal palette.
   Simulations step only while hovered and reset when the pointer leaves.
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
  <div class="topbar-r">SYS // <strong>WGSL COMPUTE LAB</strong></div>
</div>
<div id="side">
  <div class="side-head"><div class="big">heat metal</div><div class="sub">|${CELLS.length} sims · ${Object.keys(FAM).length} families⟩</div></div>
  <div class="legend">${legend}</div>
  <div id="gens"></div>
  <div class="sec"><button class="chip" id="resetall" type="button">↺ reset every simulation</button><div class="mini">sims step only while hovered and reset when the pointer leaves · tempo scales the step rate</div></div>
  <div class="sec"><div class="sec-lbl">Backdrop</div><div class="swatches">${swatchHtml}</div></div>
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
//  ${CELLS.length} heat-equation compute simulations; one compute kernel per cell,
//  ping-ponged across two rgba32float textures. The present pass colors the
//  temperature field through a metal palette (MODES picks it per cell). Same
//  runtime as the simulation table. Regenerate with: node build.mjs
// ============================================================================
const MODES = ${JSON.stringify(MODES)};
const STEPS = ${JSON.stringify(STEPS)};
export const PAGE = {
  async init(ctx) {
    const { device, format, tiles, PACK, $ } = ctx; this.ctx = ctx; const N = 128;
    const module = device.createShaderModule({ code: PACK });
    module.getCompilationInfo().then(info => { const errs = info.messages.filter(m => m.type === 'error'); if (errs.length) for (const t of tiles) ctx.setStatus(t, errs[0].message.slice(0, 120), true); });
    this.cbgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } }, { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { format: 'rgba32float', access: 'write-only' } }] });
    this.pbgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
    const clayout = device.createPipelineLayout({ bindGroupLayouts: [this.cbgl] }); const playout = device.createPipelineLayout({ bindGroupLayouts: [this.pbgl] });
    this.present = await device.createRenderPipelineAsync({ layout: playout, vertex: { module, entryPoint: 'vs_main' }, fragment: { module, entryPoint: 'fs_present', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
    for (const t of tiles) {
      const pg = t.page; pg.N = N; pg.frame = 0; pg.seed = Math.random() * 100; pg.reset = true; pg.cur = 0;
      pg.tex = [0, 1].map(() => device.createTexture({ size: [N, N], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING }));
      pg.ubufs = []; pg.cbind = []; pg.ring = 0; pg.udata = new Float32Array(24);
      for (let r = 0; r < 8; r++) { const b = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); pg.ubufs.push(b);
        pg.cbind.push([0, 1].map(i => device.createBindGroup({ layout: this.cbgl, entries: [{ binding: 0, resource: { buffer: b } }, { binding: 1, resource: pg.tex[i].createView() }, { binding: 2, resource: pg.tex[1 - i].createView() }] }))); }
      device.createComputePipelineAsync({ layout: clayout, compute: { module, entryPoint: 'cs_' + t.s.name } })
        .then(p => { pg.cpipe = p; t.pipeline = this.present; t.dirty = true; }).catch(e => ctx.setStatus(t, String(e.message || e).slice(0, 120), true));
    }
    const rb = $('resetall'); if (rb) rb.addEventListener('click', () => { for (const t of tiles) { t.page.reset = true; t.page.seed = Math.random() * 100; t.dirty = true; } });
  },
  leave(t) { t.page.pendingReset = true; t.page.acc = 0; },
  tick(dt, now) { for (const t of this.ctx.tiles) { const pg = t.page; if (pg.pendingReset && t.rate <= 0.002) { pg.pendingReset = false; pg.reset = true; t.dirty = true; } } },
  step(enc, t, reset) {
    const { device } = this.ctx; const pg = t.page; const d = pg.udata;
    d[0] = pg.N; d[1] = pg.N; d[2] = t.phase; d[3] = 1; d.set(t.knobs, 16); d[20] = pg.frame; d[21] = pg.seed; d[22] = 1 / 60; d[23] = reset ? 1 : 0;
    const r = pg.ring; pg.ring = (pg.ring + 1) % 8; device.queue.writeBuffer(pg.ubufs[r], 0, d);
    const pass = enc.beginComputePass(); pass.setPipeline(pg.cpipe); pass.setBindGroup(0, pg.cbind[r][pg.cur]); pass.dispatchWorkgroups(pg.N / 8, pg.N / 8); pass.end();
    pg.cur = 1 - pg.cur; pg.frame++;
  },
  pbind(surf, t) { const key = t.s.name + ':' + t.page.cur; if (surf.page.key !== key) { surf.page.key = key; surf.page.bind = this.ctx.device.createBindGroup({ layout: this.pbgl, entries: [{ binding: 0, resource: { buffer: surf.buf } }, { binding: 1, resource: t.page.tex[t.page.cur].createView() }] }); } return surf.page.bind; },
  draw(enc, t, surf, rect, dpr, dt, now, moving) {
    const { device, G } = this.ctx; const pg = t.page; if (!pg.cpipe) return;
    if (pg.lastFrame !== this.ctx.sigTime()) {
      pg.lastFrame = this.ctx.sigTime();
      if (pg.reset) { pg.reset = false; pg.frame = 0; this.step(enc, t, true); }
      else if (moving && !pg.pendingReset) { pg.acc = (pg.acc || 0) + dt * STEPS[t.s.name] * 12 * (G.tempo || 1) * t.rate; const n = Math.min(8, Math.floor(pg.acc)); pg.acc -= n; for (let i = 0; i < n; i++) this.step(enc, t, false); }
    }
    const d = surf.data;
    d[0] = rect.width; d[1] = rect.height; d[2] = t.phase; d[3] = dpr;
    d.set([G.ink[0], G.ink[1], G.ink[2], 1], 4); d.set([G.tone[0], G.tone[1], G.tone[2], 1], 8); d.set([G.cream[0], G.cream[1], G.cream[2], 1], 12);
    d.set(t.knobs, 16); d[20] = pg.frame; d[21] = pg.seed; d[22] = 0; d[23] = MODES[t.s.name];
    device.queue.writeBuffer(surf.buf, 0, d);
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: surf.ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(this.present); pass.setBindGroup(0, this.pbind(surf, t)); pass.draw(3); pass.end();
  },
  source(t) { return this.ctx.fnSource('cs_' + t.s.name); },
};
`;

// ── emit style.css (clone simulation-table, append metal families) ───────────
const famCss = Object.entries(FAM).map(([f, c]) =>
  `.f-${f}{--fam:${c};--fam-bg:${c.replace(/[\d.]+\)$/, '0.06)')}}`).join('\n');
const baseCss = readFileSync(join(DIR, '..', 'simulation-table', 'style.css'), 'utf8');
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

const fam = {}; for (const c of CELLS) fam[c.family] = (fam[c.family] || 0) + 1;
console.log('cells       : ' + CELLS.length);
console.log('families    : ' + JSON.stringify(fam));
console.log('cs_ kernels : ' + (pack.match(/@compute @workgroup_size\(8, 8\) fn cs_/g) || []).length);
console.log('names unique: ' + (new Set(CELLS.map(c => c.name)).size === CELLS.length));
console.log('palettes    : ' + JSON.stringify([...new Set(CELLS.map(c => c.pal))]));
console.log('wrote pack.wgsl, spec.json, index.html, main.js, page.js, style.css');
