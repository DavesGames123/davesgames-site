// ============================================================================
//  POLAR & LATTICE TABLE  ·  build.mjs — the single source of truth
// ────────────────────────────────────────────────────────────────────────────
//  One generator writes every file the page needs, so the cell names, the WGSL
//  entry points and the tile divs cannot drift apart. Run it with:
//      node build.mjs
//  It writes shaders/pack.wgsl, spec.json, page.js, main.js, index.html and
//  style.css into this folder. The shared table-engine drives the result; it
//  renders one fragment entry point fs_<name> per tile from a shared uniform.
//
//  MODEL
//    Every cell is a closed-form pattern in one fragment pass. A cell body
//    reads uv (centered, y up, the short side spans -0.5..0.5), t (the hover
//    clock) and k (four knobs), then returns present(color, uv). The color
//    comes from the ink, tone and cream swatches (pal is the three-stop ramp),
//    so the palette pickers push every cell at once. Line widths come from the
//    analytic pixel size (pxw, and pxw / r in log-polar space), so the lines
//    stay one screen width at every depth. No cell reads a texture or a
//    pointer; motion comes from t and the knobs only.
//
//  GREP MAP (pack.wgsl)
//    struct PolarU ..... the shared uniform block
//    fn puv / pxw ...... pixel to uv, and the uv size of one device pixel
//    fn pcg / hashi .... integer hash       ·  fn vnoise / fbm .. value noise
//    fn pal / present .. palette ramp and the finisher
//    fn sqwave ......... antialiased +-1 square wave (checkers and bands)
//    fn lines .......... constant-width lines at the integers of a field
//    fn hexCell ........ hex tiling (local xy, center)  ·  fn hexRing
//    fn bayer8 ......... 8x8 ordered-dither threshold
//    var GLYPHS ........ sixteen 4x6 glyphs in u32  ·  fn glyph
//    fn sdHeart ........ heart distance     ·  fn gearD ..... gear distance
//    @fragment fs_* .... the 36 cells
// ============================================================================
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));

// ── families (legend order) ─────────────────────────────────────────────────
const FAM = {
  'log-polar': 'rgba(120,170,255,0.15)',
  spirals:     'rgba(150,130,255,0.14)',
  moire:       'rgba(200,210,230,0.12)',
  hex:         'rgba(90,200,200,0.14)',
  corridors:   'rgba(255,170,90,0.13)',
  glyphs:      'rgba(120,230,150,0.13)',
  ornament:    'rgba(245,215,150,0.14)',
};
const famLabel = { moire: 'moiré' };

// ── glyph art: sixteen 4x6 bitmaps, packed below into u32 constants ─────────
const GLYPH_ART = [
  ['.XX.', 'X..X', 'X.XX', 'XX.X', 'X..X', '.XX.'],
  ['.X..', 'XX..', '.X..', '.X..', '.X..', 'XXX.'],
  ['.XX.', 'X..X', '...X', '..X.', '.X..', 'XXXX'],
  ['XXX.', '...X', '.XX.', '...X', '...X', 'XXX.'],
  ['X..X', 'X..X', 'XXXX', '...X', '...X', '...X'],
  ['XXXX', 'X...', 'XXX.', '...X', '...X', 'XXX.'],
  ['.XX.', 'X...', 'XXX.', 'X..X', 'X..X', '.XX.'],
  ['XXXX', '...X', '..X.', '.X..', '.X..', '.X..'],
  ['.XX.', 'X..X', '.XX.', 'X..X', 'X..X', '.XX.'],
  ['.XX.', 'X..X', 'X..X', '.XXX', '...X', '.XX.'],
  ['.XX.', 'X..X', 'X..X', 'XXXX', 'X..X', 'X..X'],
  ['XXXX', '..X.', '.XX.', 'X.X.', '..X.', '.X..'],
  ['X.X.', 'XXXX', 'X.X.', 'X.X.', '..X.', '.X..'],
  ['.X..', 'XXXX', '.X.X', '.X.X', 'X..X', '..X.'],
  ['XXXX', 'X..X', 'XXXX', 'X..X', 'XXXX', 'X..X'],
  ['....', 'XXXX', '....', 'XXXX', '....', 'XXXX'],
];
const packGlyph = rows => rows.reduce((acc, row, ri) =>
  acc | [...row].reduce((a, ch, ci) => a | ((ch === 'X' ? 1 : 0) << (ri * 4 + 3 - ci)), 0), 0) >>> 0;
const GLYPH_U32 = GLYPH_ART.map(packGlyph);
const popc = v => v.toString(2).split('').filter(c => c === '1').length;
const byInk = GLYPH_U32.map((v, i) => [popc(v), i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(e => e[1]);
// the shade ramp: slot 0 is blank, slots 1..7 climb in lit pixels
const GRAMP = [0, ...[0, 2, 5, 7, 10, 12, 15].map(r => byInk[r])];
const hex32 = v => '0x' + v.toString(16).padStart(8, '0') + 'u';

// ── the WGSL helper library (shared by every cell) ──────────────────────────
const HELPERS = `// ═══════════════════════════════════════════════════════════════════════════
//  POLAR & LATTICE TABLE  ·  one fragment shader per cell, a closed-form
//  pattern each. Every cell reads uv (centered, y up, short side -0.5..0.5),
//  the hover clock t and four knobs k, then returns present(color, uv). The
//  colors come from the ink, tone and cream swatches, so the palette drives
//  all cells. Log-polar and 1/r corridor maps after the conformal-map and
//  tunnel articles of Quilez; distance functions after Quilez; hex tiling and
//  cell sampling after The Book of Shaders; ordered dither after Bayer 1973;
//  hashing after Jarzynski and Olano 2020 (pcg); phyllotaxis after Vogel
//  1979; guilloche curves after the rose-engine tradition. The cell code and
//  the glyph art are original.
// ═══════════════════════════════════════════════════════════════════════════
const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.283185307179586;
const GOLD: f32 = 2.399963229728653;

struct PolarU {
    size: vec2f, time: f32, pixelScale: f32,
    ink: vec4f, tone: vec4f, cream: vec4f,
    exposure: f32, weight: f32, glow: f32, pad1: f32,
    k: vec4f,
};
@group(0) @binding(0) var<uniform> u: PolarU;

@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(p[i], 0.0, 1.0);
}

// centered uv, y up, the short side spans -0.5 .. 0.5
fn puv(fp: vec2f) -> vec2f {
    let p = fp / max(u.pixelScale, 0.001);
    let n = (p - 0.5 * u.size) / max(min(u.size.x, u.size.y), 1.0);
    return vec2f(n.x, -n.y);
}
// the uv size of one device pixel
fn pxw() -> f32 { return 1.0 / max(min(u.size.x, u.size.y) * u.pixelScale, 1.0); }
fn rot(p: vec2f, a: f32) -> vec2f { let c = cos(a); let s = sin(a); return vec2f(c * p.x - s * p.y, s * p.x + c * p.y); }
fn wrap(x: f32, m: f32) -> f32 { return x - m * floor(x / m); }
fn wrap2(p: vec2f, m: vec2f) -> vec2f { return p - m * floor(p / m); }

// ── hashing and value noise ─────────────────────────────────────────────────
fn pcg(v: u32) -> u32 {
    let s = v * 747796405u + 2891336453u;
    let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
    return (w >> 22u) ^ w;
}
fn hashi(p: vec2i, seed: u32) -> f32 {
    let h = pcg(pcg(bitcast<u32>(p.x) ^ seed) + bitcast<u32>(p.y));
    return f32(h >> 8u) * (1.0 / 16777216.0);
}
fn hash2(p: vec2f, seed: u32) -> f32 { return hashi(vec2i(floor(p)), seed); }
fn vnoise(p: vec2f, seed: u32) -> f32 {
    let i = vec2i(floor(p)); let f = fract(p); let w = f * f * (3.0 - 2.0 * f);
    let a = hashi(i, seed); let b = hashi(i + vec2i(1, 0), seed);
    let c = hashi(i + vec2i(0, 1), seed); let d = hashi(i + vec2i(1, 1), seed);
    return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}
fn fbm(p: vec2f) -> f32 {
    var s = 0.0; var a = 0.5; var q = p;
    for (var i: i32 = 0; i < 4; i++) { s += a * vnoise(q, u32(i) + 3u); q = rot(q, 0.6) * 2.03 + 1.7; a *= 0.5; }
    return s / 0.9375;
}

// ── palette and finisher ────────────────────────────────────────────────────
fn pal(v: f32) -> vec3f {
    let x = clamp(v, 0.0, 1.0);
    let a = mix(u.ink.rgb, u.tone.rgb, smoothstep(0.0, 0.55, x));
    return mix(a, u.cream.rgb, smoothstep(0.45, 1.0, x));
}
fn present(c: vec3f, uv: vec2f) -> vec4f {
    let vig = 1.0 - 0.3 * smoothstep(0.3, 0.8, length(uv));
    return vec4f(clamp(c * vig * u.exposure, vec3f(0.0), vec3f(1.0)), 1.0);
}

// ── antialiased strokes ─────────────────────────────────────────────────────
// fill coverage of a uv-unit distance (negative inside)
fn fill(d: f32) -> f32 { return clamp(0.5 - d / pxw(), 0.0, 1.0); }
// +1 / -1 square wave with period 2, zero at the integers; fw = field units
// per pixel. Where the wave is finer than a pixel it fades to 0 (gray).
fn sqwave(x: f32, fw: f32) -> f32 {
    let tri = abs(fract(x * 0.5 + 0.25) - 0.5) * 4.0 - 1.0;
    return clamp(tri / max(fw * 2.0, 1e-5), -1.0, 1.0);
}
// lines wpx pixels wide at the integers of x; fades to the mean when dense
fn lines(x: f32, fw: f32, wpx: f32) -> f32 {
    let f = max(fw, 1e-6);
    let w = wpx * u.weight;
    let d = abs(fract(x + 0.5) - 0.5) / f;
    let c = 1.0 - smoothstep(0.5 * w - 0.5, 0.5 * w + 0.5, d);
    return mix(c, min(w * f, 1.0), smoothstep(0.25, 0.6, f));
}
// a bar of width duty (period units) centered on each half-integer
fn bar(x: f32, fw: f32, duty: f32) -> f32 {
    let d = abs(fract(x) - 0.5);
    return clamp((duty * 0.5 - d) / max(fw, 1e-6) + 0.5, 0.0, 1.0);
}

// ── hex tiling (after The Book of Shaders): xy local, zw center ─────────────
// pointy-top hexes, neighbor spacing 1, inradius 0.5
fn hexCell(p: vec2f) -> vec4f {
    let s = vec2f(1.0, 1.7320508);
    let a = wrap2(p, s) - 0.5 * s;
    let b = wrap2(p - 0.5 * s, s) - 0.5 * s;
    let g = select(b, a, dot(a, a) < dot(b, b));
    return vec4f(g, p - g);
}
fn hexDist(g: vec2f) -> f32 { let q = abs(g); return max(q.x, dot(q, vec2f(0.5, 0.8660254))); }
// ring number of a hex center around the origin
fn hexRing(c: vec2f) -> f32 {
    let m = max(max(abs(c.x * 0.8660254 + c.y * 0.5), abs(c.y)), abs(-c.x * 0.8660254 + c.y * 0.5));
    return floor(m / 0.8660254 + 0.5);
}

// ── ordered dither (after Bayer 1973) ───────────────────────────────────────
fn b2(x: u32, y: u32) -> u32 { return ((x ^ y) & 1u) * 2u + (y & 1u); }
fn bayer8(q: vec2i) -> f32 {
    let x = bitcast<u32>(q.x); let y = bitcast<u32>(q.y);
    let m = 16u * b2(x, y) + 4u * b2(x >> 1u, y >> 1u) + b2(x >> 2u, y >> 2u);
    return (f32(m) + 0.5) / 64.0;
}

// ── glyphs: 4x6 bitmaps, row 0 on top, bit = row * 4 + (3 - column) ────────
var<private> GLYPHS: array<u32, 16> = array<u32, 16>(${GLYPH_U32.map(hex32).join(', ')});
// the shade ramp: slot 0 is blank, slots 1..7 climb in lit pixels
var<private> GRAMP: array<u32, 8> = array<u32, 8>(${GRAMP.map(v => v + 'u').join(', ')});
// c spans one 5x7 cell (y up); the glyph fills columns 0..3 and rows 1..6
fn glyph(g: u32, c: vec2f) -> f32 {
    let q = vec2i(floor(c * vec2f(5.0, 7.0)));
    let inb = q.x >= 0 && q.x < 4 && q.y >= 1 && q.y < 7;
    let row = u32(clamp(6 - q.y, 0, 5));
    let col = u32(clamp(q.x, 0, 3));
    let bit = (GLYPHS[g & 15u] >> (row * 4u + 3u - col)) & 1u;
    return select(0.0, f32(bit), inb);
}

// ── distance functions (after Quilez) ───────────────────────────────────────
// heart with the tip at the origin and the lobes near y = 1
fn sdHeart(pin: vec2f) -> f32 {
    let p = vec2f(abs(pin.x), pin.y);
    if (p.y + p.x > 1.0) { return length(p - vec2f(0.25, 0.75)) - 0.35355339; }
    let a = p - vec2f(0.0, 1.0);
    let b = p - 0.5 * max(p.x + p.y, 0.0);
    return sqrt(min(dot(a, a), dot(b, b))) * sign(p.x - p.y);
}
// spur gear: pitch radius R, N teeth, turned by th, tooth height h, S spokes.
// The tooth wave bends the field, so callers antialias with fwidth.
fn gearD(p: vec2f, c: vec2f, R: f32, N: f32, th: f32, h: f32, S: f32) -> f32 {
    let q = p - c;
    let r = length(q);
    let a = atan2(q.y, q.x) - th;
    let tooth = clamp(cos(N * a) * 2.2, -1.0, 1.0);
    let rim = r - (R + h * tooth);
    let rin = R * 0.3; let rout = R - h * 2.6;
    let ann = abs(r - 0.5 * (rin + rout)) - 0.5 * (rout - rin);
    let sa = (wrap(a + PI / S, TAU / S) - PI / S) * r;
    let spoke = abs(sa) - R * 0.075;
    let win = max(ann, -spoke);
    let hole = R * 0.11 - r;
    return max(max(rim, -win), hole);
}
fn paintGear(col: vec3f, d: f32, base: vec3f, lit: f32) -> vec3f {
    let fw = max(fwidth(d), 1e-6);
    let cov = clamp(0.5 - d / fw, 0.0, 1.0);
    let edge = 1.0 - smoothstep(0.0, fw * 2.5, -d);
    let c = base * (0.95 + 0.3 * lit) * (1.0 - 0.4 * edge);
    let shade = 1.0 - 0.45 * (1.0 - smoothstep(0.0, 0.03, d));
    return mix(col * shade, c, cov);
}
`;

// ── the cells. body reads uv, t, k, fp and returns a vec4f. ─────────────────
const CELLS = [
  // ============================================================== log-polar
  ['eye_checker', 'log-polar', 'a checkerboard in (log r, θ) that spirals into an off-center eye', ['twist', 'cells', 'drift', 'offset'],
   `  let e = vec2f(0.15, 0.08) * (0.3 + 1.4 * k.w);
  let c = uv - e;
  let r = max(length(c), 1e-4);
  let a = atan2(c.y, c.x);
  let n = 2.0 * floor(mix(3.0, 8.99, k.y));
  let tw = floor(mix(0.0, 3.99, k.x));
  let q = vec2f(a, log(r)) * (n / TAU);
  let s = vec2f(q.x + q.y * tw, q.y - t * mix(0.15, 1.1, k.z));
  let fw = n / TAU * pxw() / r;
  let chk = sqwave(s.x, fw * (1.0 + tw)) * sqwave(s.y, fw);
  let depth = smoothstep(0.0, 0.32, r);
  let hi = mix(u.tone.rgb, u.cream.rgb, 0.1 + 0.5 * depth);
  var col = mix(u.ink.rgb + u.tone.rgb * 0.08, hi, 0.5 + 0.5 * chk) * (0.2 + 0.8 * depth);
  let iris = exp(-pow((r - 0.045) / 0.016, 2.0));
  col += u.cream.rgb * iris * 0.9 + u.tone.rgb * exp(-r * 18.0) * 0.5;
  col = mix(col, u.ink.rgb * 0.4, fill(r - 0.026));
  col += u.cream.rgb * fill(length(c - vec2f(-0.009, 0.009)) - 0.006) * 0.8;
  return present(col, uv);`],
  ['heart_spiral', 'log-polar', 'hearts tiled down an endless log spiral, pulsing on a beat that runs inward', ['beat', 'shear', 'size', 'hearts'],
   `  let r = max(length(uv), 1e-4);
  let a = atan2(uv.y, uv.x);
  let n = floor(mix(5.0, 11.99, k.w));
  let sh = mix(-0.8, 0.8, k.y);
  let q0 = vec2f(a, log(r)) * (n / TAU);
  let q = vec2f(q0.x + q0.y * sh, q0.y - t * 0.3);
  let id = floor(q);
  let f = q - id - 0.5;
  let fw = n / TAU * pxw() / r * (1.0 + abs(sh));
  let ph = fract(t * mix(0.6, 1.8, k.x) - id.y * 0.11 + 0.5);
  let pulse = 1.0 + 0.3 * exp(-ph * 6.0);
  let s = mix(0.45, 0.68, k.z) * pulse;
  let d = sdHeart(f / s + vec2f(0.0, 0.55)) * s;
  let cov = clamp(0.5 - d / fw, 0.0, 1.0);
  let par = wrap(id.y, 2.0);
  var body = mix(u.tone.rgb, u.cream.rgb, 0.1 + 0.55 * par);
  body = body * (0.65 + 0.9 * clamp(-d * 3.0, 0.0, 0.4)) + u.cream.rgb * (pulse - 1.0) * 1.2;
  let dens = smoothstep(0.08, 0.4, fw);
  var col = u.ink.rgb + u.tone.rgb * 0.07;
  col = mix(col, body, cov * (1.0 - dens));
  col = mix(col, mix(u.ink.rgb, u.tone.rgb, 0.45), dens);
  col *= 0.3 + 0.7 * smoothstep(0.0, 0.22, r);
  return present(col, uv);`],
  ['bayer_spiral', 'log-polar', 'a log spiral quantised to palette steps with an 8x8 Bayer dither on chunky pixels', ['arms', 'wind', 'pixel', 'levels'],
   `  let px = floor(mix(2.0, 6.99, k.z)) * u.pixelScale;
  let ci = vec2i(floor(fp.xy / px));
  let p = puv((vec2f(ci) + 0.5) * px);
  let r = max(length(p), 1e-4);
  let a = atan2(p.y, p.x);
  let arms = floor(mix(2.0, 6.99, k.x));
  let w = sin(a * arms + log(r) * mix(3.0, 9.0, k.y) - t * 1.6);
  var v = (0.5 + 0.5 * w) * smoothstep(0.0, 0.18, r) * (1.0 - 0.5 * smoothstep(0.2, 0.62, r));
  v += 0.95 * exp(-r * r * 160.0);
  let lv = floor(mix(2.0, 5.99, k.w));
  let qv = clamp(floor(v * lv + bayer8(ci)) / lv, 0.0, 1.0);
  return present(pal(qv), uv);`],
  ['droste_zoom', 'log-polar', 'square frames bent by the Escher log map so one turn is one zoom level', ['scale', 'arms', 'zoom', 'frames'],
   `  let r = max(length(uv), 1e-4);
  let a = atan2(uv.y, uv.x);
  let S = mix(2.2, 5.0, k.x); let lS = log(S);
  let m = floor(mix(1.0, 2.99, k.y));
  let th = atan(m * lS / TAU);
  let cs = cos(th); let sn = sin(th);
  let w0 = vec2f(log(r), a);
  let w = vec2f(w0.x * cs + w0.y * sn, w0.y * cs - w0.x * sn) / cs;
  let lz = wrap(w.x - t * mix(0.15, 0.9, k.z), lS);
  let z = exp(lz) * vec2f(cos(w.y), sin(w.y));
  let cd = max(abs(z.x), abs(z.y));
  let nf = 2.0 * floor(mix(1.0, 3.99, k.w));
  let fr = log(cd) / lS * nf;
  let fw = nf / lS * pxw() / (r * cs);
  let e = abs(fract(fr + 0.5) - 0.5) / fw;
  let line = 1.0 - smoothstep(0.7 * u.weight, 0.7 * u.weight + 1.0, e);
  let odd = wrap(floor(fr), 2.0) > 0.5;
  let sec = sqwave(w.y * 8.0 / PI, 8.0 / PI * pxw() / (r * cs));
  let dark = u.ink.rgb * 1.2 + u.tone.rgb * (0.05 + 0.25 * fract(fr));
  let lite = mix(u.tone.rgb * 0.6, u.tone.rgb * 1.05, 0.5 + 0.5 * sec);
  var col = select(dark, lite, odd);
  col = mix(col, u.cream.rgb, line);
  col = mix(col, mix(u.tone.rgb, u.cream.rgb, 0.55), smoothstep(0.25, 0.9, fw));
  return present(col, uv);`],
  ['conformal_hex', 'log-polar', 'a hex tiling laid in (log r, θ), so the cells shrink as they spiral into the center', ['cells', 'shear', 'flow', 'gap'],
   `  let r = max(length(uv), 1e-4);
  let a = atan2(uv.y, uv.x);
  let n = floor(mix(6.0, 14.99, k.x));
  let sh = mix(-0.7, 0.7, k.y);
  let q0 = vec2f(a, log(r)) * (n / TAU);
  let q = vec2f(q0.x + q0.y * sh, q0.y - t * mix(0.2, 1.0, k.z));
  let h = hexCell(q);
  let d = hexDist(h.xy);
  let fw = n / TAU * pxw() / r * (1.0 + abs(sh));
  let hv = hash2(vec2f(wrap(h.z, n), h.w) * 2.0 + 0.25, 7u);
  let pulse = 0.5 + 0.5 * sin(h.w * 1.3 - t * 2.5 + hv * 5.0);
  let fillc = pal(0.3 + 0.7 * hv * (0.45 + 0.55 * pulse));
  let gap = mix(0.02, 0.14, k.w);
  let inside = clamp((0.5 - gap - d) / fw + 0.5, 0.0, 1.0);
  let bev = 0.8 + 0.45 * h.y;
  var col = mix(u.ink.rgb, fillc * bev, inside);
  col = mix(col, mix(u.ink.rgb, u.tone.rgb, 0.4), smoothstep(0.1, 0.45, fw));
  col *= 0.3 + 0.7 * smoothstep(0.0, 0.25, r);
  return present(col, uv);`],

  // ================================================================ spirals
  ['twin_threads', 'spirals', 'two counter-wound spiral thread families woven over and under', ['threads', 'wind', 'width', 'drift'],
   `  let r = max(length(uv), 1e-4);
  let a = atan2(uv.y, uv.x);
  let lr = log(r);
  let n = floor(mix(6.0, 16.99, k.x));
  let w = mix(0.6, 2.5, k.y);
  let sp = t * mix(0.1, 0.8, k.w);
  let f1 = (a + w * lr) * n / TAU - sp;
  let f2 = (a - w * lr) * n / TAU + sp;
  let fw = n / TAU * pxw() / r * sqrt(1.0 + w * w);
  let wth = mix(0.22, 0.42, k.z);
  let d1 = abs(fract(f1) - 0.5); let d2 = abs(fract(f2) - 0.5);
  let c1 = clamp((wth - d1) / fw + 0.5, 0.0, 1.0);
  let c2 = clamp((wth - d2) / fw + 0.5, 0.0, 1.0);
  let s1 = sqrt(max(1.0 - (d1 / wth) * (d1 / wth), 0.0));
  let s2 = sqrt(max(1.0 - (d2 / wth) * (d2 / wth), 0.0));
  let col1 = mix(u.tone.rgb * 0.3, u.tone.rgb * 1.1, s1) + u.cream.rgb * pow(s1, 8.0) * 0.35;
  let col2 = mix(u.cream.rgb * 0.3, u.cream.rgb * 0.95, s2) + u.cream.rgb * pow(s2, 8.0) * 0.15;
  let top1 = wrap(floor(f1) + floor(f2), 2.0) < 0.5;
  let cU = select(col1, col2, top1); let aU = select(c1, c2, top1);
  let cT = select(col2, col1, top1); let aT = select(c2, c1, top1);
  let dT = select(d2, d1, top1);
  var col = u.ink.rgb;
  col = mix(col, cU * 0.7, aU);
  col *= 1.0 - 0.55 * clamp((wth * 1.4 - dT) / fw + 0.5, 0.0, 1.0);
  col = mix(col, cT, aT);
  col = mix(col, (u.tone.rgb + u.cream.rgb) * 0.3, smoothstep(0.12, 0.45, fw));
  col *= 0.35 + 0.65 * smoothstep(0.0, 0.2, r);
  return present(col, uv);`],
  ['petal_shear', 'spirals', 'florets in the lattice of two counter spirals, shearing as the winding breathes', ['petals', 'shear', 'size', 'spin'],
   `  let r = max(length(uv), 1e-4);
  let a = atan2(uv.y, uv.x);
  let lr = log(r);
  let n = floor(mix(8.0, 21.99, k.x));
  let sh = mix(0.8, 2.4, k.y) + 0.35 * sin(t * 0.8);
  let sp = t * mix(-0.4, 0.4, k.w);
  let f = vec2f(a + sh * lr, a - sh * lr) * (n / TAU) + sp;
  let g = fract(f) - 0.5;
  let fw = n / TAU * pxw() / r * sqrt(1.0 + sh * sh);
  let al = (g.x - g.y) * 0.70710678;
  let ac = (g.x + g.y) * 0.70710678;
  let L = mix(0.5, 0.66, k.z);
  let tip = clamp(al / L * 0.5 + 0.5, 0.0, 1.0);
  let wd = L * (0.28 + 0.26 * tip);
  let d = (length(vec2f(al / L, ac / wd)) - 1.0) * wd;
  let cov = clamp(0.5 - d / fw, 0.0, 1.0);
  let bloom = 0.5 + 0.5 * sin(lr * 3.0 - t * 2.0);
  var petal = pal(0.3 + 0.45 * tip + 0.25 * bloom);
  petal *= 1.0 - 0.4 * (1.0 - smoothstep(0.0, fw * 1.2, abs(ac))) * smoothstep(-0.5, 0.2, al / L);
  var col = u.ink.rgb + u.tone.rgb * 0.1 * (1.0 - tip);
  col = mix(col, petal, cov);
  col = mix(col, mix(u.tone.rgb, u.cream.rgb, 0.4) * 0.8, smoothstep(0.1, 0.4, fw));
  col += u.cream.rgb * exp(-r * 30.0) * 0.5;
  return present(col, uv);`],
  ['vortex_duo', 'spirals', 'a two-color vortex of ribbon arms around a glowing eye', ['arms', 'wind', 'swirl', 'glow'],
   `  let r = max(length(uv), 1e-4);
  let a = atan2(uv.y, uv.x);
  let arms = floor(mix(1.0, 4.99, k.x));
  let wd = mix(1.5, 6.0, k.y);
  let x = (a * arms + log(r) * wd + mix(0.0, 3.0, k.z) * exp(-r * 5.0) - t * 1.8) / PI;
  let fw = sqrt(arms * arms + wd * wd) / PI * pxw() / r;
  let sq = sqwave(x, fw);
  let rib = 0.5 + 0.5 * abs(sin(x * PI));
  var col = mix(u.tone.rgb, u.cream.rgb * 0.95, 0.5 + 0.5 * sq) * rib;
  col *= smoothstep(0.015, 0.1, r);
  col += u.cream.rgb * exp(-pow((r - 0.075) / 0.024, 2.0)) * mix(0.0, 1.0, k.w);
  col = mix(col, u.ink.rgb, smoothstep(0.3, 0.62, r) * 0.65);
  return present(col, uv);`],
  ['hairline_spiral', 'spirals', 'two spiral families of hairlines that stay one pixel wide at every depth', ['lines', 'wind', 'counter', 'drift'],
   `  let r = max(length(uv), 1e-4);
  let a = atan2(uv.y, uv.x);
  let lr = log(r);
  let n = 2.0 * floor(mix(8.0, 24.99, k.x));
  let wd = mix(0.6, 3.0, k.y);
  let dr = t * mix(0.05, 0.5, k.w);
  let f1 = (a + wd * lr) * n / TAU - dr;
  let f2 = (a - wd * 0.6 * lr) * (n * 0.5) / TAU + dr * 0.6;
  let fw1 = n / TAU * pxw() / r * sqrt(1.0 + wd * wd);
  let fw2 = n * 0.5 / TAU * pxw() / r * sqrt(1.0 + 0.36 * wd * wd);
  let l1 = lines(f1, fw1, 1.1);
  let l2 = lines(f2, fw2, 0.9);
  let rim = smoothstep(0.0, 0.45, r);
  var col = u.ink.rgb + u.tone.rgb * 0.1 * (1.0 - rim);
  col += mix(u.cream.rgb, u.tone.rgb * 1.2, rim) * l1 * 0.95;
  col += u.tone.rgb * l2 * mix(0.2, 0.9, k.z);
  col *= 0.35 + 0.65 * smoothstep(0.0, 0.1, r);
  return present(col, uv);`],
  ['record_groove', 'spirals', 'an Archimedean groove with an anisotropic sheen, spinning under a label', ['grooves', 'sheen', 'spin', ''],
   `  let r = max(length(uv), 1e-4);
  let a = atan2(uv.y, uv.x);
  let spin = t * mix(0.4, 2.0, k.z);
  let N = mix(36.0, 80.0, k.x);
  let ph = r * N - (a - spin) / TAU;
  let fw = N * pxw();
  let groove = lines(ph, fw, 1.0);
  let sheen = pow(abs(cos(a - 0.7)), mix(4.0, 24.0, k.y));
  var vin = u.ink.rgb * 1.3 + mix(u.tone.rgb, u.cream.rgb, 0.4) * sheen * 0.6 * smoothstep(0.15, 0.3, r);
  vin *= 1.0 - 0.6 * groove;
  vin += u.cream.rgb * (1.0 - smoothstep(0.0, pxw() * 1.5, abs(r - 0.465))) * 0.4;
  let la = a - spin;
  var lab = u.tone.rgb * (0.85 + 0.15 * sin(r * 120.0));
  lab = mix(lab, u.cream.rgb, fill(abs(r - 0.108) - 0.008) * step(0.2, cos(la)));
  lab = mix(lab, u.cream.rgb * 0.9, fill(length(uv - 0.07 * vec2f(cos(la + PI), sin(la + PI))) - 0.012));
  var col = u.ink.rgb * 0.7 + u.tone.rgb * 0.04;
  col = mix(col, vin, fill(r - 0.47));
  col = mix(col, lab, fill(r - 0.145));
  col = mix(col, u.ink.rgb * 0.3, fill(r - 0.012));
  return present(col, uv);`],

  // ================================================================== moire
  ['dot_drift', 'moire', 'two dot lattices, one turned by a fraction of a degree, beating into rosettes', ['pitch', 'angle', 'dot', 'sway'],
   `  let N = mix(16.0, 32.0, k.x);
  let th = radians(mix(0.4, 5.0, k.y) + 1.2 * sin(t * 0.35) * k.w * 2.0);
  let rad = mix(0.22, 0.42, k.z);
  let fw = N * pxw();
  let ga = fract(uv * N) - 0.5;
  let gb = fract(rot(uv, th) * N) - 0.5;
  let ca = clamp((rad - length(ga)) / fw + 0.5, 0.0, 1.0);
  let cb = clamp((rad - length(gb)) / fw + 0.5, 0.0, 1.0);
  var col = u.ink.rgb;
  col += u.tone.rgb * max(ca, cb) * 0.45;
  col += u.cream.rgb * ca * cb * 0.95;
  return present(col, uv);`],
  ['line_grating', 'moire', 'two bar gratings a few degrees apart, one wavering, as light through both', ['pitch', 'angle', 'duty', 'waver'],
   `  let N = mix(22.0, 44.0, k.x);
  let th = radians(mix(1.0, 8.0, k.y));
  let duty = mix(0.3, 0.6, k.z);
  let fw = N * pxw();
  let pb = rot(uv, th);
  let xb = pb.x + 0.02 * sin(pb.y * 9.0 + t * 1.3) * k.w * 2.0;
  let ba = bar(uv.x * N, fw, duty);
  let bb = bar(xb * N, fw, duty);
  let T = (1.0 - ba) * (1.0 - bb);
  var col = mix(u.ink.rgb, mix(u.tone.rgb, u.cream.rgb, 0.75), T);
  col += u.tone.rgb * 0.18 * ba * (1.0 - bb);
  return present(col, uv);`],
  ['ring_grating', 'moire', 'two circular gratings on orbiting centers, beating into hyperbolic fringes', ['pitch', 'spread', 'duty', 'orbit'],
   `  let N = mix(28.0, 60.0, k.x);
  let off = mix(0.03, 0.14, k.y);
  let duty = mix(0.3, 0.6, k.z);
  let ang = t * 0.6 * k.w;
  let o = vec2f(cos(ang), sin(ang)) * off;
  let fw = N * pxw();
  let c1 = bar(length(uv - o) * N, fw, duty);
  let c2 = bar(length(uv + o) * N, fw, duty);
  let xr = c1 + c2 - 2.0 * c1 * c2;
  var col = mix(u.ink.rgb, u.tone.rgb * 0.9, xr);
  col += u.cream.rgb * c1 * c2 * 0.85;
  return present(col, uv);`],
  ['hex_square', 'moire', 'a hex dot screen over a square dot screen, dark dots on light', ['pitch', 'angle', 'dot', 'scale'],
   `  let N = mix(14.0, 26.0, k.x);
  let th = radians(mix(0.0, 6.0, k.y) + 0.8 * sin(t * 0.3));
  let sc = mix(0.96, 1.08, k.w);
  let rad = mix(0.18, 0.36, k.z);
  let h = hexCell(rot(uv, th) * N * sc);
  let ch = clamp((rad - length(h.xy)) / (N * sc * pxw()) + 0.5, 0.0, 1.0);
  let gs = fract(uv * N) - 0.5;
  let cs = clamp((rad - length(gs)) / (N * pxw()) + 0.5, 0.0, 1.0);
  let T = (1.0 - ch) * (1.0 - cs);
  var col = mix(u.ink.rgb, u.cream.rgb * 0.92, T);
  col = mix(col, u.tone.rgb, ch * (1.0 - cs) * 0.55);
  return present(col, uv);`],
  ['radial_fan', 'moire', 'two radial spoke fans with offset centers, their product mapped through the palette', ['spokes', 'spread', 'sweep', ''],
   `  let N = floor(mix(24.0, 72.0, k.x));
  let off = mix(0.02, 0.12, k.y);
  let sw = sin(t * 0.4 * mix(0.2, 2.0, k.z)) * 0.03;
  let c1 = uv - vec2f(-off + sw, 0.0);
  let c2 = uv - vec2f(off, sw * 0.5);
  let f1 = sqwave(atan2(c1.y, c1.x) * N / PI, N / PI * pxw() / max(length(c1), 1e-4));
  let f2 = sqwave(atan2(c2.y, c2.x) * N / PI, N / PI * pxw() / max(length(c2), 1e-4));
  let v = 0.5 + 0.5 * f1 * f2;
  var col = pal(0.12 + 0.8 * v);
  col *= 0.55 + 0.45 * smoothstep(0.0, 0.08, min(length(c1), length(c2)));
  return present(col, uv);`],

  // ==================================================================== hex
  ['hex_wave', 'hex', 'three wave sources sampled once per hex, so the light steps cell by cell', ['size', 'wavenumber', 'speed', 'gap'],
   `  let sc = mix(7.0, 16.0, k.x);
  let h = hexCell(uv * sc);
  let c = h.zw / sc;
  let kw = mix(18.0, 46.0, k.y);
  let sp = t * mix(1.5, 5.0, k.z);
  var v = 0.0;
  for (var i: i32 = 0; i < 3; i++) {
    let an = f32(i) * TAU / 3.0 + 0.4 + t * 0.15;
    v += sin(length(c - 0.32 * vec2f(cos(an), sin(an))) * kw - sp);
  }
  v = 0.5 + v / 6.0;
  let fw = sc * pxw();
  let d = hexDist(h.xy);
  let gap = mix(0.03, 0.15, k.w);
  let inside = clamp((0.5 - gap - d) / fw + 0.5, 0.0, 1.0);
  let col = mix(u.ink.rgb * 0.8, pal(v) * (0.82 + 0.35 * h.y), inside);
  return present(col, uv);`],
  ['hex_terrain', 'hex', 'beveled hex tiles raised to the height of drifting noise at their centers', ['size', 'scale', 'drift', 'bevel'],
   `  let sc = mix(6.0, 14.0, k.x);
  let h = hexCell(uv * sc);
  let c = h.zw / sc;
  let v = fbm(c * mix(2.0, 6.0, k.y) + vec2f(t * 0.25, t * 0.12) * mix(0.3, 2.0, k.z));
  let vv = smoothstep(0.2, 0.8, v);
  let fw = sc * pxw();
  let d = hexDist(h.xy);
  let bw = mix(0.05, 0.2, k.w);
  let lit = dot(normalize(h.xy + vec2f(1e-5)), vec2f(-0.6, 0.8));
  let onBev = smoothstep(0.5 - bw - fw, 0.5 - bw + fw, d);
  let top = pal(0.15 + 0.85 * vv);
  var col = mix(top, top * (0.7 + 0.6 * lit), onBev);
  col = mix(u.ink.rgb, col, clamp((0.485 - d) / fw + 0.5, 0.0, 1.0));
  return present(col, uv);`],
  ['hex_rings', 'hex', 'concentric hex rings pulsing outward, each cell a stroked hex around a growing core', ['size', 'ring', 'speed', ''],
   `  let sc = mix(8.0, 18.0, k.x);
  let h = hexCell(uv * sc);
  let ring = hexRing(h.zw);
  let v = 0.5 + 0.5 * cos(ring * mix(0.5, 1.4, k.y) - t * mix(1.5, 5.0, k.z));
  let fw = sc * pxw();
  let d = hexDist(h.xy);
  let outline = clamp(1.0 - abs(d - 0.4) / (fw * 1.1 * u.weight), 0.0, 1.0);
  let core = clamp((0.1 + 0.22 * v - d) / fw + 0.5, 0.0, 1.0);
  let rc = select(u.tone.rgb, u.cream.rgb, wrap(ring, 2.0) > 0.5);
  var col = u.ink.rgb + u.tone.rgb * 0.05;
  col = mix(col, rc * (0.3 + 0.7 * v), outline);
  col = mix(col, mix(u.tone.rgb, u.cream.rgb, v) * (0.35 + 0.8 * v), core);
  return present(col, uv);`],
  ['hex_truchet', 'hex', 'hex Truchet tiles of three arcs each, turned at random, with dashes flowing along the tubes', ['size', 'band', 'flow', 'seed'],
   `  let sc = mix(4.0, 10.0, k.x);
  let h = hexCell(uv * sc);
  let flip = hash2(h.zw * 2.0 + 0.25, 11u + u32(k.w * 8.0)) > 0.5;
  let g = select(h.xy, rot(h.xy, PI / 3.0), flip);
  let R = 0.57735027;
  var dm = 1e3; var al = 0.0;
  for (var i: i32 = 0; i < 3; i++) {
    let an = PI / 6.0 + f32(i) * TAU / 3.0;
    let w = g - R * vec2f(cos(an), sin(an));
    let dd = abs(length(w) - R * 0.5);
    if (dd < dm) { dm = dd; al = atan2(w.y, w.x); }
  }
  let fw = sc * pxw();
  let bw = mix(0.06, 0.16, k.y);
  let cov = clamp((bw - dm) / fw + 0.5, 0.0, 1.0);
  let sh = clamp((bw + 0.06 - dm) / fw + 0.5, 0.0, 1.0);
  let tube = sqrt(max(1.0 - (dm / bw) * (dm / bw), 0.0));
  let dash = 0.5 + 0.5 * sin(al * 6.0 - t * mix(1.0, 5.0, k.z) * select(1.0, -1.0, flip));
  let tc = mix(u.tone.rgb, u.cream.rgb, 0.2 + 0.65 * dash) * (0.3 + 0.7 * tube) + u.cream.rgb * pow(tube, 10.0) * 0.3;
  var col = u.ink.rgb + u.tone.rgb * 0.12 * (1.0 - hexDist(h.xy) * 1.6);
  col *= 1.0 - 0.6 * sh;
  col = mix(col, tc, cov);
  return present(col, uv);`],
  ['hex_led', 'hex', 'a hex LED panel showing a turning spiral in four brightness steps', ['size', 'wind', 'speed', 'bloom'],
   `  let sc = mix(9.0, 18.0, k.x);
  let h = hexCell(uv * sc);
  let c = h.zw / sc;
  let rc = max(length(c), 1e-4);
  var v = 0.5 + 0.5 * sin(atan2(c.y, c.x) * 3.0 - log(rc) * mix(2.0, 6.0, k.y) - t * mix(1.0, 4.0, k.z));
  v = floor(v * 4.0 + 0.5) / 4.0;
  v *= 1.0 - smoothstep(0.3, 0.55, rc);
  v = max(v, 0.9 * exp(-rc * rc * 400.0));
  let fw = sc * pxw();
  let rr = length(h.xy);
  let led = clamp((0.3 - rr) / fw + 0.5, 0.0, 1.0);
  var col = u.ink.rgb + u.tone.rgb * 0.04;
  col += mix(u.tone.rgb, u.cream.rgb, v) * exp(-rr * rr * 9.0) * v * mix(0.2, 0.9, k.w);
  let lc = mix(u.ink.rgb + u.tone.rgb * 0.1, mix(u.tone.rgb, u.cream.rgb, v * v) * (0.3 + 0.9 * v), step(0.01, v));
  col = mix(col, lc, led);
  col += u.cream.rgb * 0.35 * exp(-dot(h.xy - vec2f(-0.1, 0.1), h.xy - vec2f(-0.1, 0.1)) * 220.0) * led;
  return present(col, uv);`],

  // ============================================================== corridors
  ['square_corridor', 'corridors', 'rounded-square outlines receding by 1/r, twisted into a spiral', ['spacing', 'twist', 'speed', 'square'],
   `  let r = max(length(uv), 1e-4);
  let pr = rot(uv, mix(0.0, 1.6, k.y) * log(r) + t * 0.12);
  let e = mix(2.5, 10.0, k.w);
  let q = max(abs(pr), vec2f(1e-5));
  let sq = max(pow(pow(q.x, e) + pow(q.y, e), 1.0 / e), 1e-4);
  let depth = mix(0.8, 2.0, k.x) / sq;
  let z = depth - t * mix(0.4, 1.6, k.z);
  let wz = fwidth(z);
  let ln = lines(z, wz, 1.6) * (1.0 - 0.9 * smoothstep(0.15, 0.7, wz));
  let fog = exp(-depth * 0.012);
  let rc = select(u.tone.rgb * 1.1, u.cream.rgb, wrap(floor(z + 0.5), 2.0) > 0.5);
  var col = u.ink.rgb + u.tone.rgb * 0.1 * fog;
  col += rc * ln * fog;
  col += u.cream.rgb * exp(-sq * sq * 500.0) * 0.8;
  return present(col, uv);`],
  ['star_corridor', 'corridors', 'two star corridors interleaved, counter-rotating as they rush past', ['points', 'inner', 'spin', 'speed'],
   `  let r = max(length(uv), 1e-4);
  let a = atan2(uv.y, uv.x);
  let P = floor(mix(4.0, 8.99, k.x));
  let spin = t * mix(0.1, 0.8, k.z);
  let inr = mix(0.4, 0.75, k.y);
  let tA = abs(fract(P * (a - spin) / TAU) - 0.5) * 2.0;
  let tB = abs(fract(P * (a + spin) / TAU + 0.5) - 0.5) * 2.0;
  let nA = r / mix(inr, 1.0, tA);
  let nB = r / mix(inr, 1.0, tB);
  let sp = t * mix(0.4, 1.6, k.w);
  let zA = 1.1 / nA - sp;
  let zB = 1.1 / nB - sp + 0.5;
  let fogA = exp(-0.05 / nA); let fogB = exp(-0.05 / nB);
  let wA = fwidth(zA); let wB = fwidth(zB);
  let lA = lines(zA, wA, 1.5) * (1.0 - 0.9 * smoothstep(0.15, 0.7, wA));
  let lB = lines(zB, wB, 1.5) * (1.0 - 0.9 * smoothstep(0.15, 0.7, wB));
  var col = u.ink.rgb;
  col += u.tone.rgb * 1.1 * lA * fogA;
  col += u.cream.rgb * lB * fogB;
  col += u.cream.rgb * exp(-r * r * 400.0) * 0.7;
  return present(col, uv);`],
  ['chevron_rings', 'corridors', 'chevron bands marching out of a tunnel in 1/r depth', ['chevrons', 'depth', 'speed', 'bend'],
   `  let r = max(length(uv), 1e-4);
  let a = atan2(uv.y, uv.x);
  let M = floor(mix(4.0, 12.99, k.x));
  let depth = mix(0.12, 0.3, k.y) / r;
  let chev = abs(fract(a / TAU * M) - 0.5);
  let z = depth * 22.0 + chev * mix(0.6, 2.0, k.w) - t * mix(0.6, 2.4, k.z);
  let fw = fwidth(z);
  let bnd = sqwave(z, fw);
  let fog = exp(-depth * 0.035);
  var col = mix(u.tone.rgb * 0.95, u.cream.rgb * 0.85, 0.5 + 0.5 * bnd) * fog;
  let dn = smoothstep(0.15, 0.6, fw);
  col = mix(col, u.ink.rgb, lines(z, fw, 1.4) * 0.8 * fog * (1.0 - dn));
  col = mix(col, u.ink.rgb + u.tone.rgb * 0.15, dn);
  col += u.tone.rgb * exp(-r * r * 300.0) * 0.6;
  return present(col, uv);`],
  ['hyper_throat', 'corridors', 'a wireframe throat with rings at geometric spacing flowing into a glowing neck', ['rings', 'meridians', 'flow', 'throat'],
   `  let r = length(uv);
  let a = atan2(uv.y, uv.x);
  let r0 = mix(0.05, 0.13, k.w);
  let rr = max(r, r0);
  let x = log(rr / r0);
  let nr = mix(3.0, 8.0, k.x);
  let ringf = x * nr - t * mix(0.3, 1.2, k.z);
  let nm = floor(mix(12.0, 36.99, k.y));
  let tw = 0.35 * sin(t * 0.5);
  let mer = (a + tw * x) * nm / TAU;
  let lr = lines(ringf, nr * pxw() / rr, 1.3);
  let lm = lines(mer, nm / TAU * pxw() / rr * (1.0 + abs(tw)), 1.0);
  let near = exp(-x * 0.9);
  var col = u.ink.rgb + u.tone.rgb * 0.12 * near;
  col += mix(u.tone.rgb, u.cream.rgb, near) * max(lr, lm * 0.7) * (0.35 + 0.65 * near) * step(r0, r);
  let neck = 1.0 - smoothstep(r0 * 0.5, r0, r);
  col = mix(col, mix(u.cream.rgb, u.tone.rgb, r / r0), neck);
  col += u.cream.rgb * exp(-pow((r - r0) / (r0 * 0.25), 2.0)) * 0.5;
  return present(col, uv);`],
  ['brick_tunnel', 'corridors', 'a brick-lined tunnel in (θ, 1/r) with a light at the far end', ['bricks', 'depth', 'speed', 'fog'],
   `  let r = max(length(uv), 1e-4);
  let a = atan2(uv.y, uv.x);
  let n = floor(mix(10.0, 24.99, k.x));
  let s = mix(0.12, 0.3, k.y);
  let dz = s / r;
  let v = dz * 3.0 + t * mix(0.5, 2.0, k.z);
  let row = floor(v);
  let uu = a / TAU * n + 0.5 * wrap(row, 2.0);
  let fu = n / TAU * pxw() / r;
  let fv = 3.0 * s * pxw() / (r * r);
  let mu = abs(fract(uu + 0.5) - 0.5);
  let mv = abs(fract(v + 0.5) - 0.5);
  let mort = max(1.0 - clamp((mu - 0.06) / fu + 0.5, 0.0, 1.0), 1.0 - clamp((mv - 0.08) / fv + 0.5, 0.0, 1.0));
  let hv = hash2(vec2f(wrap(floor(uu), n), row), 5u);
  let fog = exp(-dz * mix(0.1, 0.45, k.w));
  let bc = mix(u.tone.rgb * 0.5, mix(u.tone.rgb, u.cream.rgb, 0.35), hv);
  var col = mix(bc, u.ink.rgb * 0.8, mort) * fog;
  col = mix(col, (bc * 0.8 + u.ink.rgb) * 0.5 * fog, smoothstep(0.2, 0.6, max(fu, fv)));
  col += u.cream.rgb * exp(-r * r * 500.0) * 0.9;
  return present(col, uv);`],

  // ================================================================= glyphs
  ['glyph_rings', 'glyphs', 'rings of tiny bitmap glyphs, each ring turning against its neighbours', ['rings', 'density', 'spin', 'flicker'],
   `  let r = length(uv);
  let a = atan2(uv.y, uv.x);
  let nR = floor(mix(4.0, 8.99, k.x));
  let rw = 0.47 / (nR + 1.0);
  let ri = floor(r / rw);
  let dir = select(-1.0, 1.0, wrap(ri, 2.0) < 0.5);
  let circ = TAU * (ri + 0.5) * rw;
  let nC = max(floor(circ / (rw * mix(0.62, 0.9, 1.0 - k.y))), 4.0);
  let aa = a + dir * t * mix(0.15, 0.7, k.z) * (1.5 / (ri + 1.0));
  let x = wrap(aa / TAU, 1.0) * nC;
  let ci = floor(x);
  let cu = vec2f(1.0 - fract(x), fract(r / rw));
  let tick = floor(t * mix(0.5, 6.0, k.w) + hash2(vec2f(ci, ri), 3u) * 7.0);
  let g = u32(hash2(vec2f(ci + tick * 17.0, ri), 9u) * 16.0);
  let on = glyph(g, cu) * step(1.0, ri) * step(ri, nR);
  let bright = 0.45 + 0.55 * hash2(vec2f(ci, ri + tick * 5.0), 4u);
  let rc = select(u.tone.rgb * 1.15, u.cream.rgb, wrap(ri, 2.0) > 0.5);
  var col = u.ink.rgb + u.tone.rgb * 0.05;
  col += u.tone.rgb * 0.25 * lines(r / rw, pxw() / rw, 1.0) * step(r, (nR + 1.0) * rw);
  col += rc * on * bright;
  col += u.cream.rgb * exp(-r * r * 900.0) * 0.8;
  return present(col, uv);`],
  ['glyph_rain', 'glyphs', 'columns of falling glyphs with bright heads and fading trails', ['columns', 'speed', 'trail', 'churn'],
   `  let cols = floor(mix(10.0, 20.99, k.x));
  let x = (uv.x + 0.5) * cols;
  let ci = floor(x);
  let ch = 1.4 / cols;
  let y = (0.5 - uv.y) / ch;
  let ri = floor(y);
  let cu = vec2f(fract(x), 1.0 - fract(y));
  let h1 = hash2(vec2f(ci, 0.0), 21u);
  let h2 = hash2(vec2f(ci, 1.0), 22u);
  let sp = mix(3.0, 10.0, k.y) * (0.6 + 0.8 * h1);
  let trail = mix(5.0, 16.0, k.z);
  let span = 1.0 / ch + trail + 4.0;
  let d1 = wrap(t * sp + h2 * span, span) - ri;
  let d2 = wrap(t * sp * 0.7 + h1 * span + span * 0.5, span) - ri;
  let f1 = step(0.0, d1) * step(d1, trail) * pow(1.0 - clamp(d1 / trail, 0.0, 1.0), 1.5);
  let f2 = step(0.0, d2) * step(d2, trail) * pow(1.0 - clamp(d2 / trail, 0.0, 1.0), 1.5);
  let fade = max(f1, f2 * 0.8);
  let head = max(step(0.0, d1) * step(d1, 1.0), step(0.0, d2) * step(d2, 1.0));
  let tk = floor(t * mix(1.0, 9.0, k.w) + hash2(vec2f(ci, ri), 5u) * 9.0);
  let g = u32(hash2(vec2f(ci * 31.0 + ri, tk), 6u) * 16.0);
  let on = glyph(g, cu);
  var col = u.ink.rgb + u.tone.rgb * 0.03;
  col += u.tone.rgb * on * 0.08;
  col += (mix(u.tone.rgb, u.cream.rgb, fade * fade) * fade + u.cream.rgb * head) * on;
  return present(col, uv);`],
  ['glyph_spiral', 'glyphs', 'glyph cells laid on a log-polar lattice, spiralling into the center', ['cells', 'shear', 'drift', 'arms'],
   `  let r = max(length(uv), 1e-4);
  let a = atan2(uv.y, uv.x);
  let n = floor(mix(10.0, 22.99, k.x));
  let sh = mix(0.0, 1.0, k.y);
  let q0 = vec2f(a, log(r)) * (n / TAU);
  let q = vec2f(q0.x + q0.y * sh, q0.y * 0.714 + t * mix(0.2, 1.0, k.z));
  let id = floor(q);
  let cu = vec2f(1.0 - fract(q.x), fract(q.y));
  let hid = vec2f(wrap(id.x, n), id.y);
  let g = u32(hash2(hid, 13u) * 16.0);
  let fw = n / TAU * pxw() / r * (1.0 + sh);
  let on = mix(glyph(g, cu), 0.35, smoothstep(0.08, 0.3, fw));
  let arms = floor(mix(1.0, 4.99, k.w));
  let arm = 0.5 + 0.5 * cos((q0.x * TAU / n) * arms - q0.y * 1.2 + t * 1.5);
  var col = u.ink.rgb + u.tone.rgb * 0.05;
  col += mix(u.tone.rgb * 0.8, u.cream.rgb, arm * arm) * on * (0.3 + 0.7 * arm);
  col *= 0.3 + 0.7 * smoothstep(0.0, 0.2, r);
  col += u.cream.rgb * exp(-r * r * 700.0) * 0.6;
  return present(col, uv);`],
  ['glyph_tunnel', 'glyphs', 'glyphs on the walls of a 1/r tunnel, flying out past the viewer', ['cells', 'depth', 'speed', 'fog'],
   `  let r = max(length(uv), 1e-4);
  let a = atan2(uv.y, uv.x);
  let n = floor(mix(12.0, 24.99, k.x));
  let dz = mix(0.1, 0.22, k.y) / r;
  let uu = a / TAU * n;
  let v = dz * 3.0 + t * mix(0.5, 2.0, k.z);
  let id = vec2f(wrap(floor(uu), n), floor(v));
  let cu = vec2f(fract(uu), 1.0 - fract(v));
  let g = u32(hash2(id, 17u) * 16.0);
  let lit = hash2(id + vec2f(0.0, 99.0), 18u);
  let fog = exp(-dz * mix(0.15, 0.5, k.w));
  let fu = n / TAU * pxw() / r;
  let on = mix(glyph(g, cu), 0.3, smoothstep(0.07, 0.25, fu));
  let gc = select(u.tone.rgb * 0.9, u.cream.rgb, lit > 0.82);
  var col = u.ink.rgb + u.tone.rgb * 0.04;
  col += gc * on * fog;
  col += u.cream.rgb * exp(-r * r * 400.0) * 0.8;
  return present(col, uv);`],
  ['glyph_shade', 'glyphs', 'a lit sphere drawn in glyphs, each cell picking a glyph by its ink weight', ['cells', 'radius', 'orbit', 'ground'],
   `  let cols = floor(mix(14.0, 28.99, k.x));
  let ch = 1.4 / cols;
  let x = (uv.x + 0.5) * cols;
  let y = (uv.y + 0.5) / ch;
  let id = floor(vec2f(x, y));
  let cu = fract(vec2f(x, y));
  let c = vec2f((id.x + 0.5) / cols - 0.5, (id.y + 0.5) * ch - 0.5);
  let R = mix(0.26, 0.4, k.y);
  let lt = t * mix(0.3, 1.5, k.z) + 2.2;
  let L = normalize(vec3f(cos(lt), 0.55, sin(lt) * 0.8 + 0.5));
  let rr = length(c) / R;
  let nz = sqrt(max(1.0 - rr * rr, 0.0));
  let nd = max(dot(vec3f(c / R, nz), L), 0.0);
  let spec = pow(max(dot(reflect(-L, vec3f(c / R, nz)), vec3f(0.0, 0.0, 1.0)), 0.0), 16.0);
  let bg = mix(0.0, 0.26, k.w) * (0.5 + 0.5 * sin(c.y * 40.0 - c.x * 10.0 + t));
  let v = select(bg, clamp(0.06 + 0.8 * nd + 0.4 * spec, 0.0, 1.0), rr < 1.0);
  let gi = GRAMP[min(u32(v * 8.0), 7u)];
  let on = glyph(gi, cu) * step(0.125, v);
  var col = u.ink.rgb + u.tone.rgb * 0.04;
  col += select(u.tone.rgb * 0.45, pal(0.35 + 0.65 * v), rr < 1.0) * on;
  return present(col, uv);`],

  // =============================================================== ornament
  ['seigaiha', 'ornament', 'overlapping wave crescents of concentric arcs, a slow shimmer across the rows', ['scale', 'arcs', 'shimmer', 'tint'],
   `  let sc = mix(2.5, 6.0, k.x);
  let p = uv * sc * 2.0;
  let jc = floor(p.y / 0.5);
  var bd = 9.0; var bc = vec2f(0.0);
  for (var i: i32 = 0; i < 6; i++) {
    let j = jc + 3.0 - f32(i);
    let xoff = wrap(j, 2.0);
    let xc = round((p.x - xoff) * 0.5) * 2.0 + xoff;
    let cc = vec2f(xc, j * 0.5);
    let d = length(p - cc);
    if (d < 1.0) { bd = d; bc = cc; }
  }
  let nA = floor(mix(3.0, 6.99, k.y));
  let fw = sc * 2.0 * pxw();
  let rf = bd * nA;
  let wave = 0.5 + 0.5 * sin(bc.x * 0.8 + bc.y * 1.7 - t * mix(0.5, 3.0, k.z));
  let par = wrap(floor(rf), 2.0);
  let lo = mix(u.tone.rgb * 0.5, u.tone.rgb * 1.1, wave);
  let hi = mix(u.cream.rgb * 0.65, u.cream.rgb, wave);
  var col = mix(lo, hi, par * mix(0.4, 1.0, k.w));
  col = mix(col, u.ink.rgb, lines(rf, fw * nA, 1.2) * 0.7);
  col = mix(col, u.ink.rgb, clamp((bd - 0.93) / fw + 0.5, 0.0, 1.0));
  return present(col, uv);`],
  ['phyllotaxis', 'ornament', 'a golden-angle seed head, a pulse running outward through the seeds', ['seeds', 'size', 'pulse', 'spin'],
   `  let c = mix(0.024, 0.014, k.x);
  let pr = rot(uv, -t * mix(0.02, 0.2, k.w));
  let r = length(pr);
  let n0 = floor((r / c) * (r / c));
  var best = 1e3; var bn = 0.0;
  for (var i: i32 = -60; i <= 60; i++) {
    let nn = n0 + f32(i);
    let sp = c * sqrt(max(nn, 0.0)) * vec2f(cos(nn * GOLD), sin(nn * GOLD));
    let d = select(1e3, length(pr - sp), nn >= 0.0);
    if (d < best) { best = d; bn = nn; }
  }
  let sr = sqrt(bn);
  let rmax = 0.47 / c;
  let wpos = fract(t * mix(0.1, 0.4, k.z) + 0.35) * rmax * 1.4;
  let pulse = exp(-pow((sr - wpos) / 2.5, 2.0));
  let rad = c * mix(0.46, 0.64, k.y) * (1.0 + 0.4 * pulse) * (0.55 + 0.45 * smoothstep(0.0, 6.0, sr));
  let cov = clamp((rad - best) / pxw() + 0.5, 0.0, 1.0) * step(sr, rmax);
  let dome = sqrt(max(1.0 - (best / rad) * (best / rad), 0.0));
  let fam = wrap(bn, 21.0) / 21.0;
  let seedc = pal(0.4 + 0.4 * fam + 0.25 * pulse) * (0.55 + 0.6 * dome) + u.cream.rgb * pow(dome, 12.0) * 0.25;
  var col = u.ink.rgb + u.tone.rgb * 0.06;
  col = mix(col, seedc, cov);
  return present(col, uv);`],
  ['gear_train', 'ornament', 'four spur gears at true pitch-circle tangency, turning by tooth ratio', ['scale', 'speed', 'teeth', ''],
   `  let p = uv * mix(0.72, 1.0, k.x);
  let pc = 0.06;
  let NA = 20.0; let NB = 12.0; let NC = 8.0; let ND = 10.0;
  let RA = NA * pc / TAU; let RB = NB * pc / TAU; let RC = NC * pc / TAU; let RD = ND * pc / TAU;
  let h = mix(0.006, 0.013, k.z);
  let f1 = -0.35; let f2 = -1.6; let f3 = 2.4;
  let cA = vec2f(-0.05, 0.04);
  let cB = cA + (RA + RB) * vec2f(cos(f1), sin(f1));
  let cC = cB + (RB + RC) * vec2f(cos(f2), sin(f2));
  let cD = cA + (RA + RD) * vec2f(cos(f3), sin(f3));
  let tA = t * mix(0.2, 1.2, k.y);
  let tB = f1 + PI - PI / NB + (f1 - tA) * NA / NB;
  let tC = f2 + PI - PI / NC + (f2 - tB) * NB / NC;
  let tD = f3 + PI - PI / ND + (f3 - tA) * NA / ND;
  let dA = gearD(p, cA, RA, NA, tA, h, 6.0);
  let dB = gearD(p, cB, RB, NB, tB, h, 5.0);
  let dC = gearD(p, cC, RC, NC, tC, h, 4.0);
  let dD = gearD(p, cD, RD, ND, tD, h, 4.0);
  let gw = fwidth(p.x * 24.0);
  var col = u.ink.rgb + u.tone.rgb * 0.05;
  col += u.tone.rgb * 0.1 * max(lines(p.x * 24.0, gw, 1.0), lines(p.y * 24.0, gw, 1.0));
  col = paintGear(col, dA, u.tone.rgb, (p.y - cA.y) / RA);
  col = paintGear(col, dB, u.cream.rgb * 0.9, (p.y - cB.y) / RB);
  col = paintGear(col, dC, mix(u.tone.rgb, u.cream.rgb, 0.5), (p.y - cC.y) / RC);
  col = paintGear(col, dD, mix(u.tone.rgb, u.cream.rgb, 0.7), (p.y - cD.y) / RD);
  return present(col, uv);`],
  ['guilloche', 'ornament', 'rose-engine guilloche: phase-shifted lobed curves interlaced in two bands', ['lobes', 'strands', 'depth', 'drift'],
   `  let r = max(length(uv), 1e-4);
  let a = atan2(uv.y, uv.x);
  let n = floor(mix(5.0, 13.99, k.x));
  let M = floor(mix(5.0, 13.99, k.y));
  let A = mix(0.04, 0.09, k.z);
  let ph0 = t * mix(0.05, 0.4, k.w);
  let pw = pxw() * 0.8 * u.weight;
  let nc = max(floor(n * 0.5), 3.0);
  var o = 0.0; var m = 0.0; var ce = 0.0;
  for (var i: i32 = 0; i < 14; i++) {
    let fi = f32(i);
    let on = step(fi, M - 0.5);
    let ph = fi / M * TAU / n;
    let s1 = sin(n * (a + ph) + ph0);
    let k1 = A * n * cos(n * (a + ph) + ph0) / r;
    o = max(o, on * clamp(1.0 - abs(r - (0.36 + A * s1)) / sqrt(1.0 + k1 * k1) / pw, 0.0, 1.0));
    let s2 = sin(n * (a - ph) - ph0 * 1.5);
    let k2 = A * 0.6 * n * cos(n * (a - ph) - ph0 * 1.5) / r;
    m = max(m, on * clamp(1.0 - abs(r - (0.21 + A * 0.6 * s2)) / sqrt(1.0 + k2 * k2) / pw, 0.0, 1.0));
    let s3 = sin(nc * (a + ph * 2.0) + ph0 * 2.0);
    let k3 = 0.035 * nc * cos(nc * (a + ph * 2.0) + ph0 * 2.0) / r;
    ce = max(ce, on * clamp(1.0 - abs(r - (0.09 + 0.035 * s3)) / sqrt(1.0 + k3 * k3) / pw, 0.0, 1.0));
  }
  var col = u.ink.rgb + u.tone.rgb * 0.06;
  col = mix(col, u.tone.rgb * 1.15, o);
  col = mix(col, u.cream.rgb * 0.95, m);
  col = mix(col, mix(u.tone.rgb, u.cream.rgb, 0.6), ce);
  col += u.cream.rgb * 0.6 * lines(r * 40.0, 40.0 * pxw(), 1.0) * step(0.455, r) * step(r, 0.485);
  return present(col, uv);`],
  ['rosette', 'ornament', 'a folded rose window: four petal layers turning at their own rates', ['folds', 'width', 'spin', 'breathe'],
   `  let r = length(uv);
  let a = atan2(uv.y, uv.x);
  let S = floor(mix(6.0, 16.99, k.x));
  let sec = TAU / S;
  let pw = pxw();
  var col = u.ink.rgb + u.tone.rgb * 0.08 * (1.0 - 2.0 * r);
  for (var l: i32 = 0; l < 4; l++) {
    let fl = f32(l);
    let odd = (l & 1) == 1;
    let rl = 0.1 + fl * 0.105;
    let sp = t * mix(0.05, 0.4, k.z) * select(1.0, -1.0, odd) / (1.0 + fl * 0.5);
    let aa = a - sp + select(0.0, 0.5 * sec, odd);
    let af = abs(wrap(aa, sec) - 0.5 * sec);
    let q = r * vec2f(cos(af), sin(af));
    let len = (0.05 + 0.008 * fl) * (1.0 + 0.15 * sin(t * 1.5 + fl) * k.w * 2.0);
    let wid = rl * sec * 0.5 * mix(0.5, 1.0, k.y);
    let e = (q - vec2f(rl, 0.0)) / vec2f(len, wid);
    let d = (length(e) - 1.0) * min(len, wid);
    let cov = clamp(0.5 - d / pw, 0.0, 1.0);
    let edge = clamp(1.0 - abs(d) / (pw * 1.2 * u.weight), 0.0, 1.0);
    let lc = select(u.tone.rgb * 1.1, u.cream.rgb, odd) * (0.5 + 0.5 * (1.0 - clamp(length(e), 0.0, 1.0)));
    col = mix(col, lc, cov);
    col = mix(col, u.ink.rgb, edge * 0.85);
  }
  col = mix(col, u.cream.rgb, fill(r - 0.04));
  col = mix(col, u.tone.rgb, fill(r - 0.022));
  let dots = floor(S * 2.0);
  let ad = (wrap(a + t * 0.05, TAU / dots) - PI / dots) * r;
  col = mix(col, u.cream.rgb * 0.8, fill(length(vec2f(ad, r - 0.465)) - 0.008));
  return present(col, uv);`],
  ['star_lattice', 'ornament', 'an eight-point star lattice on a diagonal grid, the stars breathing in a wave', ['scale', 'size', 'wave', 'turn'],
   `  let sc = mix(3.0, 7.0, k.x);
  let p = uv * sc;
  let id = floor(p + 0.5);
  let g = p - id;
  let ph = t * mix(0.5, 2.0, k.z) - length(id) * 0.8;
  let s = mix(0.2, 0.3, k.y) + 0.04 * sin(ph);
  let dir = select(1.0, -1.0, wrap(id.x + id.y, 2.0) > 0.5);
  let q = rot(g, dir * t * 0.3 * k.w * 2.0);
  let aq = abs(q);
  let star = min(max(aq.x, aq.y) - s, (aq.x + aq.y) * 0.70710678 - s);
  let fw = sc * pxw();
  let cov = clamp(0.5 - star / fw, 0.0, 1.0);
  let rim = clamp(1.0 - abs(star) / (fw * 1.2 * u.weight), 0.0, 1.0);
  let inner = clamp(1.0 - abs(star + 0.06) / (fw * 1.0 * u.weight), 0.0, 1.0);
  let lat = max(lines(p.x + p.y + 0.5, fwidth(p.x + p.y), 1.2), lines(p.x - p.y + 0.5, fwidth(p.x - p.y), 1.2));
  let v = 0.5 + 0.5 * sin(ph);
  var col = u.ink.rgb + u.tone.rgb * 0.06;
  col += u.tone.rgb * 0.45 * lat;
  col = mix(col, pal(0.35 + 0.5 * v), cov);
  col = mix(col, u.ink.rgb, inner * 0.7 * cov);
  col = mix(col, u.cream.rgb, rim);
  return present(col, uv);`],
];

// ── emit pack.wgsl ───────────────────────────────────────────────────────────
const frag = ([name, , , , body]) =>
  `@fragment fn fs_${name}(@builtin(position) fp: vec4f) -> @location(0) vec4f {\n  let uv = puv(fp.xy);\n  let t = u.time;\n  let k = u.k;\n${body}\n}`;
const pack = HELPERS + `\n// ── the ${CELLS.length} cells ─────────────────────────────────────────────────────────────\n` +
  CELLS.map(frag).join('\n\n') + '\n';

// ── emit spec.json ───────────────────────────────────────────────────────────
const spec = {
  cols: 6,
  uniform_bytes: 96,
  cells: CELLS.map(([name, family, species, knobs]) => ({
    name, family, species, knobs,
    defaults: [0.5, 0.5, 0.5, 0.5],
    fn: 'fs_' + name,
  })),
  gens: [
    { id: 'exposure', title: 'Exposure · brightness', fn: 'flat', period: 10, amp: 0.4, bias: 0.5, phase: 0,
      map: 'y => Math.pow(2, (y - 0.5) * 3)', unit: "v => (Math.log2(v) >= 0 ? '+' : '') + Math.log2(v).toFixed(1) + ' ev'" },
    { id: 'tempo', title: 'Tempo · hover speed', fn: 'flat', period: 8, amp: 0.0, bias: 0.5, phase: 0,
      map: 'y => 0.1 + 2.9 * y', unit: "v => v.toFixed(2) + 'x'" },
    { id: 'weight', title: 'Weight · line width', fn: 'flat', period: 10, amp: 0.3, bias: 0.5, phase: 0,
      map: 'y => 0.25 + 1.5 * y', unit: "v => v.toFixed(2) + 'x'" },
  ],
  swatches: [
    { id: 'ink', label: 'Ground', hex: '#0a0c16' },
    { id: 'tone', label: 'Tone', hex: '#3a86c8' },
    { id: 'cream', label: 'Light', hex: '#f5dfa8' },
  ],
  // screensaver: calm cells and tempo for the table-engine hook (lib/table-engine.js)
  saver: { cells: ['phyllotaxis', 'guilloche', 'rosette', 'seigaiha', 'gear_train', 'record_groove', 'hex_terrain', 'hex_rings', 'star_lattice', 'petal_shear', 'heart_spiral', 'dot_drift', 'hex_wave'], tempo: [0.8, 0.2], dpr: 2 },
};

// ── emit index.html ──────────────────────────────────────────────────────────
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const legend = Object.keys(FAM).map(f => `<span class="f-${f}"><i></i>${famLabel[f] || f}</span>`).join('');
const tiles = CELLS.map(([name, family, species]) =>
  `<div class="cell f-${family}" role="button" tabindex="0" id="tile-${name}" aria-label="${esc(name + ': ' + species)}"><canvas></canvas><span class="orb-status"></span><span class="tag">${name.replace(/_/g, ' ')}</span></div>`).join('');
const swatchHtml = spec.swatches.map(s => `<label class="swatch"><span>${s.label}</span><input type="color" id="sw-${s.id}" value="${s.hex}"></label>`).join('');

const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Polar &amp; Lattice Table // Stella Nova</title>
<!--
  ════════════════════════════════════════════════════════════════════════════
   POLAR & LATTICE TABLE  ·  page shell (GENERATED by build.mjs — do not edit)
  ────────────────────────────────────────────────────────────────────────────
   Static markup only. main.js loads the data and hands it to the shared
   table-engine, which builds the sidebar and the frame loop and drives page.js.
   ${CELLS.length} closed-form polar, lattice and ornament patterns, one fragment
   shader per cell.
  ════════════════════════════════════════════════════════════════════════════
-->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=STIX+Two+Text:ital,wght@0,400;0,500;1,400&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="style.css">
</head>
<body>

<script>if(window!==window.top)document.documentElement.classList.add("in-frame")</script>
<div class="grid-bg"></div>
<div class="topbar">
  <div class="topbar-l"><span class="sys-name">Stella Nova</span><span class="sys-status">Polar &amp; Lattice Table</span></div>
  <div class="topbar-r">SYS // <strong>WGSL SHADER LAB</strong></div>
</div>
<div id="side">
  <div class="side-head"><div class="big">polar &amp; lattice</div><div class="sub">|${CELLS.length} patterns · ${Object.keys(FAM).length} families⟩</div></div>
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

// ── emit main.js ─────────────────────────────────────────────────────────────
const mainJs = `// ============================================================================
//  POLAR & LATTICE TABLE  ·  main.js — data load and boot (GENERATED)
// ────────────────────────────────────────────────────────────────────────────
//  Fetch the WGSL pack and the spec, then hand them to the shared table-engine
//  with this page's PAGE object. The engine builds the sidebar and the frame
//  loop; page.js owns the GPU work. Regenerate with: node build.mjs
// ============================================================================
import { bootTable } from '../../lib/table-engine.js';
import { loadShaders } from '../../lib/shaders.js';
import { PAGE } from './page.js';

const SH = await loadShaders(import.meta.url, ['shaders/pack.wgsl']);
const spec = await (await fetch(new URL('spec.json', import.meta.url))).json();

bootTable(PAGE, { spec, pack: SH['shaders/pack.wgsl'] });
`;

// ── emit page.js ─────────────────────────────────────────────────────────────
const pageJs = `// ============================================================================
//  POLAR & LATTICE TABLE  ·  page.js — the per-page PAGE object (GENERATED)
// ────────────────────────────────────────────────────────────────────────────
//  ${CELLS.length} closed-form patterns; one fragment shader per cell, each reading
//  only a shared uniform buffer (no source texture). The shared table-engine
//  drives this object through its ctx. main.js fetches the data and calls
//  bootTable(PAGE, data); the engine calls PAGE.init and PAGE.draw from there.
//
//  UNIFORM LAYOUT (96 bytes, matches struct PolarU in shaders/pack.wgsl)
//    0..1 size · 2 time · 3 pixelScale · 4..7 ink · 8..11 tone · 12..15 cream
//    16 exposure · 17 weight · 18 glow · 19 pad · 20..23 k (four knobs)
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
    d[16] = G.exposure; d[17] = G.weight; d[18] = 1.0; d[19] = 0;
    d.set(t.knobs, 20);
    device.queue.writeBuffer(surf.buf, 0, d);
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: surf.ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(t.pipeline); pass.setBindGroup(0, this.bind(surf)); pass.draw(3); pass.end();
  },
  source(t) { return this.ctx.fnSource('fs_' + t.s.name); },
};
`;

// ── emit style.css (clone color-table, swap the fonts, add the families) ────
const famCss = Object.entries(FAM).map(([f, c]) =>
  `.f-${f}{--fam:${c};--fam-bg:${c.replace(/[\d.]+\)$/, '0.06)')}}`).join('\n');
const baseCss = readFileSync(join(DIR, '..', 'color-table', 'style.css'), 'utf8')
  .replaceAll("'Cormorant Garamond',serif", "'STIX Two Text',Georgia,serif")
  .replaceAll("'JetBrains Mono',monospace", "'Inter',system-ui,-apple-system,sans-serif");
const css = baseCss + `
/* ── polar & lattice families (appended by build.mjs) ─────────────────────── */
${famCss}
.side-head .big{color:#f5dfa8}
.legend span{text-transform:capitalize}
#m-src,.fn{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.val,.fps{font-variant-numeric:tabular-nums}
`;

// ── write everything ─────────────────────────────────────────────────────────
mkdirSync(join(DIR, 'shaders'), { recursive: true });
writeFileSync(join(DIR, 'style.css'), css);
writeFileSync(join(DIR, 'shaders', 'pack.wgsl'), pack);
writeFileSync(join(DIR, 'spec.json'), JSON.stringify(spec));
writeFileSync(join(DIR, 'index.html'), indexHtml);
writeFileSync(join(DIR, 'main.js'), mainJs);
writeFileSync(join(DIR, 'page.js'), pageJs);

const fam = {};
for (const [, f] of CELLS) fam[f] = (fam[f] || 0) + 1;
console.log('cells       : ' + CELLS.length);
console.log('families    : ' + JSON.stringify(fam));
console.log('fs_ entries : ' + (pack.match(/@fragment fn fs_/g) || []).length);
console.log('names unique: ' + (new Set(CELLS.map(c => c[0])).size === CELLS.length));
console.log('wrote pack.wgsl, spec.json, index.html, main.js, page.js, style.css');
