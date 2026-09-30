// ============================================================================
//  SDF SOLIDS TABLE  ·  build.mjs — the single source of truth for the page
// ────────────────────────────────────────────────────────────────────────────
//  One generator emits every file the page needs, so the cell names, the WGSL
//  entry points and the tile divs cannot drift apart. Run it with:
//      node build.mjs
//  It writes shaders/pack.wgsl, spec.json, page.js, main.js, index.html and
//  style.css into this folder. The shared table-engine drives the result; it
//  renders one fragment entry point fs_<name> per tile from a shared uniform.
//
//  MODEL
//    Every cell is a 3D solid, sphere traced in one fragment shader. A cell
//    declares one or more signed distance functions map_<m>(p) and a body.
//    The body reads uv, t (the hover clock), k (four knobs) and the camera ray
//    ro/rd, then returns finish(color, uv). The objects turn on t; there is no
//    pointer input. One procedural studio, fn env(dir), lights every cell: a
//    gradient room, a floor grid, two cream softboxes and two accent strips.
//    The ink, tone and cream swatches tint the studio, so the palette pickers
//    push every cell at once.
//
//  TEMPLATES
//    WGSL has no function pointers, so this script stamps the shared tracer
//    once per map: march_<m>, nrm_<m>, thru_<m>, ao_<m> and glass_<m>. Only
//    the templates a cell calls are emitted (glass pulls thru and nrm).
//
//  GREP MAP (pack.wgsl)
//    struct SolidU ..... the shared uniform block
//    fn suv/camO/camD .. pixel to uv, the shared camera
//    fn gnoise/fbm3 .... 3D gradient noise   ·  fn worley2 .. F1/F2 cells
//    fn smin/rbox ...... smooth union, rounded box
//    fn env/envDiff .... the studio and its diffuse lobes
//    fn film ........... thin-film interference   ·  fn schlick .. Fresnel
//    fn chrome/plastic . surface shaders          ·  fn finish ... tone map
//    fn march_<m> ...... sphere tracer   ·  fn nrm_<m> .... tetrahedron normal
//    fn thru_<m> ....... inside path     ·  fn glass_<m> .. dispersive glass
//    @fragment fs_* .... the 24 cells
// ============================================================================
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));

// ── families (legend order) ─────────────────────────────────────────────────
const FAM = {
  glass:    'rgba(150,215,255,0.15)',
  chrome:   'rgba(210,215,225,0.13)',
  blobs:    'rgba(255,160,90,0.14)',
  film:     'rgba(210,140,255,0.15)',
  interior: 'rgba(110,150,255,0.15)',
  emissive: 'rgba(255,110,170,0.15)',
};

// ── the WGSL helper library (shared by every cell) ──────────────────────────
const HELPERS = `// ═══════════════════════════════════════════════════════════════════════════
//  SDF SOLIDS TABLE  ·  one fragment shader per cell, a sphere-traced solid
//  each. Every cell reads uv, the hover clock t, four knobs k and the camera
//  ray, then returns finish(color, uv). One procedural studio, fn env, lights
//  all cells and takes its tint from the ink, tone and cream swatches.
//  Sphere tracing after Hart 1996; distance primitives, smooth-min, the
//  tetrahedron normal and domain warping after Quilez; Fresnel after Schlick
//  1994; refraction by Snell's law with a three-index split for dispersion;
//  thin-film color from two-beam interference; gradient noise after Perlin
//  (pcg3d hashing, Jarzynski and Olano 2020); cells after Worley 1996. The
//  studio, the cell shapes and the shading are original.
// ═══════════════════════════════════════════════════════════════════════════
const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.283185307179586;

struct SolidU {
    size: vec2f, time: f32, pixelScale: f32,
    ink: vec4f, tone: vec4f, cream: vec4f,
    exposure: f32, studio: f32, glow: f32, pad1: f32,
    k: vec4f,
};
@group(0) @binding(0) var<uniform> u: SolidU;

@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(p[i], 0.0, 1.0);
}

// ── pixel, camera, rotation ─────────────────────────────────────────────────
// uv: x right, y up, the short side spans -0.5 .. 0.5
fn suv(fp: vec2f) -> vec2f {
    let p = fp / max(u.pixelScale, 0.001);
    let n = (p - 0.5 * u.size) / max(min(u.size.x, u.size.y), 1.0);
    return vec2f(n.x, -n.y + 0.02);
}
fn camO() -> vec3f { return vec3f(0.0, 1.15, 4.4); }
fn camRt() -> vec3f { return normalize(cross(normalize(-camO()), vec3f(0.0, 1.0, 0.0))); }
fn camUp() -> vec3f { return cross(camRt(), normalize(-camO())); }
fn camD(uv: vec2f) -> vec3f { return normalize(normalize(-camO()) * 1.6 + camRt() * uv.x + camUp() * uv.y); }

fn rotY(a: f32) -> mat3x3f { let c = cos(a); let s = sin(a); return mat3x3f(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
fn rotX(a: f32) -> mat3x3f { let c = cos(a); let s = sin(a); return mat3x3f(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
fn rot2(a: f32) -> mat2x2f { let c = cos(a); let s = sin(a); return mat2x2f(c, s, -s, c); }
// turn a point into object space: yaw a, then pitch b
fn spin(p: vec3f, a: f32, b: f32) -> vec3f { return rotX(b) * (rotY(a) * p); }

// ── palette (swatches arrive as sRGB, the shading runs linear) ──────────────
fn cInk() -> vec3f { return pow(u.ink.rgb, vec3f(2.2)); }
fn cTone() -> vec3f { return pow(u.tone.rgb, vec3f(2.2)); }
fn cCream() -> vec3f { return pow(u.cream.rgb, vec3f(2.2)); }
fn hue(h: f32) -> vec3f { return 0.5 + 0.5 * cos(TAU * (h + vec3f(0.0, 0.33, 0.67))); }

// ── hashing, gradient noise, cells ──────────────────────────────────────────
fn pcg3d(vin: vec3u) -> vec3u {
    var v = vin * 1664525u + 1013904223u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    v ^= v >> vec3u(16u);
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    return v;
}
fn hash3(p: vec3f) -> vec3f { return vec3f(pcg3d(bitcast<vec3u>(vec3i(floor(p))))) * (1.0 / 4294967295.0); }
fn gcorner(i: vec3f, f: vec3f, o: vec3f) -> f32 { return dot(hash3(i + o) * 2.0 - 1.0, f - o); }
fn gnoise(p: vec3f) -> f32 {
    let i = floor(p); let f = fract(p);
    let w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    let a = mix(gcorner(i, f, vec3f(0.0, 0.0, 0.0)), gcorner(i, f, vec3f(1.0, 0.0, 0.0)), w.x);
    let b = mix(gcorner(i, f, vec3f(0.0, 1.0, 0.0)), gcorner(i, f, vec3f(1.0, 1.0, 0.0)), w.x);
    let c = mix(gcorner(i, f, vec3f(0.0, 0.0, 1.0)), gcorner(i, f, vec3f(1.0, 0.0, 1.0)), w.x);
    let d = mix(gcorner(i, f, vec3f(0.0, 1.0, 1.0)), gcorner(i, f, vec3f(1.0, 1.0, 1.0)), w.x);
    return mix(mix(a, b, w.y), mix(c, d, w.y), w.z) * 1.3;
}
fn fbm3(p0: vec3f, oct: i32) -> f32 {
    var p = p0; var a = 0.5; var s = 0.0; var n = 0.0;
    for (var i = 0; i < 6; i++) {
        if (i >= oct) { break; }
        s += a * gnoise(p); n += a; a *= 0.5;
        p = p * 2.03 + vec3f(1.7, -3.1, 2.3);
    }
    return s / max(n, 1e-4);
}
fn worley2(p: vec3f) -> vec2f {
    let i = floor(p); let f = fract(p);
    var d1 = 8.0; var d2 = 8.0;
    for (var z = -1; z <= 1; z++) { for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
        let o = vec3f(f32(x), f32(y), f32(z));
        let r = o + hash3(i + o) - f;
        let d = dot(r, r);
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    } } }
    return sqrt(vec2f(d1, d2));
}

// ── distance helpers ────────────────────────────────────────────────────────
fn smin(a: f32, b: f32, k0: f32) -> f32 {
    let k = max(k0, 1e-4);
    let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}
fn rbox(p: vec3f, b: vec3f, r: f32) -> f32 {
    let q = abs(p) - b + r;
    return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}
fn sphHit(ro: vec3f, rd: vec3f, r: f32) -> vec2f {
    let b = dot(ro, rd); let c = dot(ro, ro) - r * r; let h = b * b - c;
    if (h < 0.0) { return vec2f(-1.0); }
    let s = sqrt(h);
    return vec2f(-b - s, -b + s);
}

// ── the studio ──────────────────────────────────────────────────────────────
// a soft-edged rectangle of light seen in direction ax, half size hw (tangent)
fn softRect(d: vec3f, ax: vec3f, hw: vec2f, soft: f32) -> f32 {
    let c = dot(d, ax);
    if (c <= 0.0) { return 0.0; }
    let r = normalize(cross(vec3f(0.0, 1.0, 0.0), ax));
    let up = cross(ax, r);
    let e = abs(vec2f(dot(d, r), dot(d, up)) / c) - hw;
    return 1.0 - smoothstep(-soft, soft, max(e.x, e.y));
}
const KEY: vec3f = vec3f(-0.66, 0.56, 0.5);
const STRIP: vec3f = vec3f(0.95, 0.12, 0.28);
const RIM: vec3f = vec3f(0.42, 0.34, -0.84);
fn env(d0: vec3f) -> vec3f {
    let d = normalize(d0);
    let ink = cInk(); let tone = cTone(); let cream = cCream();
    let s = u.studio;
    var c = mix(ink * 0.55, ink * 1.7 + tone * 0.05, smoothstep(-0.3, 0.7, d.y));
    c += tone * 0.07 * exp(-abs(d.y - 0.03) * 16.0);
    if (d.y < -0.02) {
        let q = d.xz / -d.y * 2.4;
        let g = abs(fract(q) - 0.5);
        let line = smoothstep(0.47, 0.5, max(g.x, g.y)) * exp(-length(q) * 0.35);
        c += cream * 0.02 * line * s;
        c += cream * 0.05 * s * exp(-length(q - vec2f(-1.2, 1.4)) * 0.5);
        c += mix(cream, tone, 0.3) * 0.22 * s * smoothstep(-0.35, -0.9, d.y);
    }
    let back = max(-d.z, 0.0);
    c += mix(tone, cream, 0.55) * 0.16 * s * pow(back, 24.0) * smoothstep(-0.35, 0.05, d.y);
    c += cream * 4.2 * s * softRect(d, normalize(KEY), vec2f(0.36, 0.25), 0.035);
    c += cream * 2.6 * s * softRect(d, normalize(STRIP), vec2f(0.05, 0.55), 0.015);
    c += tone * 3.8 * s * softRect(d, normalize(RIM), vec2f(0.09, 0.55), 0.02);
    c += tone * 2.0 * s * softRect(d, normalize(vec3f(-0.9, -0.05, -0.42)), vec2f(0.32, 0.04), 0.02);
    c += cream * 1.4 * s * smoothstep(0.9, 0.95, d.y);
    return c;
}
// the same studio as broad lobes, for rough and diffuse surfaces
fn envDiff(n: vec3f) -> vec3f {
    let s = u.studio;
    var c = mix(cInk() * 0.9, cInk() * 2.2 + cTone() * 0.05, n.y * 0.5 + 0.5);
    c += cCream() * 0.95 * s * max(dot(n, normalize(KEY)), 0.0);
    c += cCream() * 0.35 * s * max(dot(n, normalize(STRIP)), 0.0);
    c += cTone() * 0.45 * s * max(dot(n, normalize(RIM)), 0.0);
    c += cCream() * 0.12 * s * max(n.y, 0.0);
    return c;
}
fn backdrop(rd: vec3f) -> vec3f { return env(rd); }

// ── optics ──────────────────────────────────────────────────────────────────
fn schlick(c: f32, f0: f32) -> f32 { return f0 + (1.0 - f0) * pow(clamp(1.0 - c, 0.0, 1.0), 5.0); }
// thin film of index nf and thickness th (nm): reflectance per channel from
// the phase between the two reflected beams, with a half-wave shift at the top
fn film(th: f32, cosI: f32, nf: f32) -> vec3f {
    let cosT = sqrt(max(1.0 - (1.0 - cosI * cosI) / (nf * nf), 0.0));
    let opd = 2.0 * nf * th * cosT;
    let i = 0.5 + 0.5 * cos(TAU * opd / vec3f(650.0, 532.0, 450.0) + PI);
    return mix(vec3f(0.5), i, exp(-th / 2600.0));
}
fn chrome(rd: vec3f, n: vec3f, tint: vec3f, occ: f32) -> vec3f {
    let f = schlick(clamp(-dot(rd, n), 0.0, 1.0), 0.0);
    return (env(reflect(rd, n)) * mix(tint, vec3f(1.0), f) + envDiff(n) * tint * 0.05) * occ;
}
fn plastic(rd: vec3f, n: vec3f, alb: vec3f, occ: f32) -> vec3f {
    let f = schlick(clamp(-dot(rd, n), 0.0, 1.0), 0.04);
    return (envDiff(n) * alb * (1.0 - f) + env(reflect(rd, n)) * f) * occ;
}

// ── the finisher: exposure, ACES fit (Narkowicz), vignette, gamma, dither ───
fn finish(c0: vec3f, uv: vec2f) -> vec4f {
    var c = max(c0, vec3f(0.0)) * u.exposure;
    c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
    c *= 1.0 - 0.5 * dot(uv, uv);
    c = pow(clamp(c, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2));
    let dn = hash3(vec3f(uv * 3000.0, 7.0)).x - 0.5;
    return vec4f(c + dn / 255.0, 1.0);
}
`;

// ── per-map templates (MAP is the map name, BR the bounding radius) ─────────
const TPL = {
  march: (m, br) => `// sphere trace map_${m} inside its bounding sphere; -1 on a miss
fn march_${m}(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, ${br});
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_${m}(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_${m}(ro + rd * t) < 0.02);
}`,
  nrm: m => `// tetrahedron normal of map_${m}
fn nrm_${m}(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_${m}(p + e.xyy) + e.yyx * map_${m}(p + e.yyx) + e.yxy * map_${m}(p + e.yxy) + e.xxx * map_${m}(p + e.xxx));
}`,
  thru: m => `// path length from an inside point p along rd to the far wall of map_${m}
fn thru_${m}(p: vec3f, rd: vec3f) -> f32 {
    var t = 0.01;
    for (var i = 0; i < 40; i++) {
        let d = -map_${m}(p + rd * t);
        if (d < 0.0008) { break; }
        t += max(d, 0.002);
    }
    return t;
}`,
  ao: m => `// five-tap ambient occlusion along the normal of map_${m}
fn ao_${m}(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_${m}(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}`,
  glass: m => `// dispersive glass on map_${m}: reflect, refract in, up to two internal
// reflections, then refract out at ior - spread, ior, ior + spread (R, G, B)
fn glass_${m}(p0: vec3f, rd0: vec3f, n0: vec3f, ior: f32, spread: f32, absorb: vec3f) -> vec3f {
    let fr = schlick(clamp(-dot(rd0, n0), 0.0, 1.0), pow((ior - 1.0) / (ior + 1.0), 2.0));
    var col = env(reflect(rd0, n0)) * fr;
    var dir = refract(rd0, n0, 1.0 / ior);
    var pos = p0 - n0 * 0.004;
    var thr = vec3f(1.0 - fr);
    for (var b = 0; b < 3; b++) {
        let d = thru_${m}(pos, dir);
        pos += dir * d;
        thr *= exp(-absorb * d);
        let ne = -nrm_${m}(pos);
        let eg = refract(dir, ne, ior);
        if (dot(eg, eg) > 0.0 || b == 2) {
            let rf = env(reflect(dir, ne));
            let er = refract(dir, ne, ior - spread);
            let eb = refract(dir, ne, ior + spread);
            let cr = select(rf.r, env(er).r, dot(er, er) > 0.0);
            let cg = select(rf.g, env(eg).g, dot(eg, eg) > 0.0);
            let cb = select(rf.b, env(eb).b, dot(eb, eb) > 0.0);
            return col + thr * vec3f(cr, cg, cb);
        }
        dir = reflect(dir, ne);
        pos += ne * 0.004;
    }
    return col;
}`,
};
const DEPS = { glass: ['thru', 'nrm'] };

// ── shared cell bodies ──────────────────────────────────────────────────────
const glassBody = (m, ior, spread, absorb) => `  let h = march_${m}(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_${m}(p);
  return finish(glass_${m}(p, rd, n, ${ior}, ${spread}, ${absorb}), uv);`;
const chromeBody = (m, tint) => `  let h = march_${m}(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_${m}(p);
  return finish(chrome(rd, n, ${tint}, ao_${m}(p, n)), uv);`;

// ── the cells: name, family, species, knobs, decl, body, opts ───────────────
//   decl .... module-scope WGSL (the map_<m> functions and any helpers)
//   body .... the fragment body; uv, t, k, ro, rd are already bound
//   opts .... { br: bounding radius per map, def: knob defaults }
const CELLS = [
  // ---------------------------------------------------------------- glass
  ['brilliant', 'glass', 'a round brilliant: a faceted gem lathed from a cut profile, split into R, G, B at the exit',
   ['facets', 'fire', 'tint', ''],
   `fn map_brilliant(p0: vec3f) -> f32 {
    let t = u.time; let k = u.k;
    var p = spin(p0, t * 0.45 + 0.5, -0.62) / 0.92;
    p.y -= 0.36;
    let n = floor(mix(6.0, 14.0, k.x) + 0.5);
    let sec = TAU / n;
    let a = atan2(p.z, p.x);
    let r = length(p.xz);
    let x1 = r * cos((fract(a / sec + 0.5) - 0.5) * sec);
    let x2 = r * cos((fract(a / sec) - 0.5) * sec);
    var d = x1 - 1.0;
    d = max(d, p.y - 0.32);
    d = max(d, dot(vec2f(x1, p.y), normalize(vec2f(0.55, 1.0))) - 0.62);
    d = max(d, dot(vec2f(x2, p.y), normalize(vec2f(0.9, 1.0))) - 0.78);
    d = max(d, dot(vec2f(x1, -p.y), normalize(vec2f(1.0, 0.95))) - 0.72);
    d = max(d, dot(vec2f(x2, -p.y), normalize(vec2f(1.0, 0.8))) - 0.76);
    return d * 0.92;
}`,
   glassBody('brilliant', '2.15', 'mix(0.02, 0.16, k.y)', '(1.0 - cTone()) * mix(0.0, 0.6, k.z)'),
   { def: [0.25, 0.5, 0.15, 0.5] }],

  ['prism_bar', 'glass', 'an n-sided glass bar: a regular polygon extruded, strong dispersion throws spectra',
   ['sides', 'girth', 'dispersion', ''],
   `fn sdPoly(p: vec2f, n: f32, a: f32) -> f32 {
    let sec = TAU / n;
    let f = (fract(atan2(p.y, p.x) / sec + 0.5) - 0.5) * sec;
    let q = length(p) * vec2f(cos(f), abs(sin(f)));
    if (q.x < a) { return q.x - a; }
    return length(vec2f(q.x - a, max(q.y - a * tan(sec * 0.5), 0.0)));
}
fn map_prism_bar(p0: vec3f) -> f32 {
    let t = u.time; let k = u.k;
    let p = spin(p0, t * 0.35 + 0.45, 0.3 + 0.25 * sin(t * 0.4) + t * 0.3);
    let n = 3.0 + floor(k.x * 5.99);
    let d2 = sdPoly(p.yz, n, mix(0.2, 0.42, k.y)) + 0.04;
    let w = vec2f(d2, abs(p.x) - 1.0);
    return min(max(w.x, w.y), 0.0) + length(max(w, vec2f(0.0))) - 0.06;
}`,
   glassBody('prism_bar', '1.62', 'mix(0.03, 0.2, k.z)', 'vec3f(0.02)'),
   { def: [0.0, 0.5, 0.6, 0.5] }],

  ['ring_torus', 'glass', 'a rounded torus of colored glass; the tone swatch sets the dye',
   ['tube', 'dye', 'dispersion', ''],
   `fn map_ring_torus(p0: vec3f) -> f32 {
    let t = u.time; let k = u.k;
    let p = spin(p0, t * 0.5 + 0.2, 1.05 + 0.35 * sin(t * 0.37));
    return length(vec2f(length(p.xz) - 0.7, p.y)) - mix(0.16, 0.36, k.x);
}`,
   glassBody('ring_torus', '1.5', 'mix(0.0, 0.1, k.z)', '(1.0 - cTone()) * mix(0.2, 2.5, k.y)'),
   { def: [0.55, 0.5, 0.3, 0.5] }],

  ['soft_cube', 'glass', 'a superellipsoid cube in aqua glass: |x|^e + |y|^e + |z|^e = 1',
   ['squareness', 'aqua', 'dispersion', ''],
   `fn map_soft_cube(p0: vec3f) -> f32 {
    let t = u.time; let k = u.k;
    let p = spin(p0, t * 0.4 + 0.75, 0.6 + 0.2 * sin(t * 0.3));
    let e = mix(2.4, 12.0, k.x);
    let q = max(abs(p) / 0.74, vec3f(1e-4));
    let s = pow(pow(q.x, e) + pow(q.y, e) + pow(q.z, e), 1.0 / e);
    return (s - 1.0) * 0.74 * 0.7;
}`,
   glassBody('soft_cube', '1.52', 'mix(0.0, 0.1, k.z)', 'vec3f(0.9, 0.22, 0.12) * mix(0.0, 1.6, k.y)'),
   { def: [0.35, 0.5, 0.4, 0.5] }],

  ['glass_glyph', 'glass', 'a glass letter S: two Quilez arcs extruded and rounded, in amber',
   ['stroke', 'amber', 'depth', ''],
   `fn sdArc(p: vec2f, sc: vec2f, ra: f32, rb: f32) -> f32 {
    let q = vec2f(abs(p.x), p.y);
    if (sc.y * q.x > sc.x * q.y) { return length(q - sc * ra) - rb; }
    return abs(length(q) - ra) - rb;
}
fn map_glass_glyph(p0: vec3f) -> f32 {
    let t = u.time; let k = u.k;
    let p = spin(p0, 0.55 * sin(t * 0.6) + 0.35, 0.12) / 1.45;
    let w = mix(0.06, 0.13, k.x);
    let sc = vec2f(sin(2.25), cos(2.25));
    let c = vec2f(0.0, 0.3);
    let s2 = min(sdArc(rot2(-0.96) * (p.xy - c), sc, 0.3, w), sdArc(rot2(-0.96) * (-p.xy - c), sc, 0.3, w)) + 0.03;
    let wv = vec2f(s2, abs(p.z) - mix(0.08, 0.22, k.z));
    return (min(max(wv.x, wv.y), 0.0) + length(max(wv, vec2f(0.0))) - 0.03) * 1.45;
}`,
   glassBody('glass_glyph', '1.55', '0.05', 'vec3f(0.08, 0.4, 1.1) * mix(0.3, 3.0, k.y)'),
   { br: 1.4, def: [0.6, 0.5, 0.45, 0.5] }],

  // ---------------------------------------------------------------- chrome
  ['morph_solid', 'chrome', 'polished steel looping cube → sphere → octahedron → torus by blending distances',
   ['rate', '', '', ''],
   `fn morphShape(p: vec3f, i: i32) -> f32 {
    if (i == 0) { return rbox(p, vec3f(0.7), 0.08); }
    if (i == 1) { return length(p) - 0.9; }
    if (i == 2) { return (abs(p.x) + abs(p.y) + abs(p.z) - 1.3) * 0.57735; }
    return length(vec2f(length(p.xz) - 0.68, p.y)) - 0.28;
}
fn map_morph_solid(p0: vec3f) -> f32 {
    let t = u.time; let k = u.k;
    let p = spin(p0, t * 0.5 + 0.6, 0.5 + t * 0.23);
    let s = fract(t * mix(0.05, 0.25, k.x) + 0.6) * 4.0;
    let i = i32(floor(s));
    return mix(morphShape(p, i), morphShape(p, (i + 1) % 4), smoothstep(0.2, 0.8, fract(s)));
}`,
   chromeBody('morph_solid', 'vec3f(0.93, 0.94, 0.96)')],

  ['cube_jack', 'chrome', 'seven rounded gold cubes in a 3D plus, breathing apart and together',
   ['spread', 'bevel', '', ''],
   `fn map_cube_jack(p0: vec3f) -> f32 {
    let t = u.time; let k = u.k;
    let p = spin(p0, t * 0.4 + 0.55, 0.62 + 0.3 * sin(t * 0.25));
    let s = 0.24;
    let g = mix(0.5, 0.66, k.x) + 0.04 * sin(t * 1.5);
    let r = mix(0.015, 0.11, k.y);
    let a = abs(p);
    var d = rbox(p, vec3f(s), r);
    d = min(d, rbox(a - vec3f(g, 0.0, 0.0), vec3f(s), r));
    d = min(d, rbox(a - vec3f(0.0, g, 0.0), vec3f(s), r));
    d = min(d, rbox(a - vec3f(0.0, 0.0, g), vec3f(s), r));
    return d;
}`,
   chromeBody('cube_jack', 'vec3f(1.0, 0.74, 0.34)')],

  ['chamfer_dodeca', 'chrome', 'a copper dodecahedron, its twenty corners cut by the vertex planes',
   ['chamfer', '', '', ''],
   `fn map_chamfer_dodeca(p0: vec3f) -> f32 {
    let t = u.time; let k = u.k;
    let p = spin(p0, t * 0.35 + 0.3, 0.4 + t * 0.17);
    let g = 1.618034;
    let a = abs(p);
    let dd = max(dot(a, normalize(vec3f(0.0, 1.0, g))), max(dot(a, normalize(vec3f(1.0, g, 0.0))), dot(a, normalize(vec3f(g, 0.0, 1.0))))) - 0.8;
    let dv = max(max(dot(a, vec3f(0.57735)), dot(a, normalize(vec3f(0.0, 1.0 / g, g)))),
                 max(dot(a, normalize(vec3f(1.0 / g, g, 0.0))), dot(a, normalize(vec3f(g, 0.0, 1.0 / g))))) - 0.8 * mix(1.03, 1.2, k.x);
    return max(dd, dv);
}`,
   chromeBody('chamfer_dodeca', 'vec3f(0.96, 0.6, 0.46)')],

  ['gyroid_core', 'chrome', 'a steel sphere carved to a gyroid sheet, a hot core glowing through the channels',
   ['cells', 'sheet', 'core', ''],
   `fn map_gyroid_core(p0: vec3f) -> f32 {
    let t = u.time; let k = u.k;
    let p = spin(p0, t * 0.3 + 0.2, 0.3);
    let sc = mix(3.0, 6.5, k.x);
    let q = p * sc + vec3f(0.0, t * 0.4, 0.0);
    let gy = dot(sin(q), cos(q.zxy)) / sc;
    let body = max(length(p) - 0.95, (abs(gy) - mix(0.025, 0.08, k.y)) * 0.6);
    return min(body, length(p) - 0.36);
}`,
   `  let h = march_gyroid_core(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_gyroid_core(p);
  let heat = mix(cTone(), vec3f(1.0, 0.55, 0.2), 0.6) * mix(1.0, 6.0, k.z);
  if (length(p) < 0.39) { return finish(heat * (1.2 + 0.8 * cCream()), uv); }
  let occ = ao_gyroid_core(p, n);
  let bleed = heat * 0.3 * exp(-(length(p) - 0.36) * 3.5) * (0.3 + 0.7 * max(dot(n, -normalize(p)), 0.0));
  return finish(chrome(rd, n, vec3f(0.9, 0.91, 0.94), occ) + bleed, uv);`,
   { def: [0.35, 0.5, 0.5, 0.5] }],

  // ---------------------------------------------------------------- blobs
  ['bead_chain', 'blobs', 'candy beads on a helix spring; smooth-min necks form and snap as k breathes',
   ['necks', 'spin', '', ''],
   `fn map_bead_chain(p0: vec3f) -> f32 {
    let t = u.time; let k = u.k;
    let p = spin(p0, 0.3, 0.12);
    let kk = mix(0.04, 0.34, k.x) * (0.55 + 0.45 * sin(t * 1.3));
    var d = 1e5;
    for (var i = 0; i < 8; i++) {
        let fi = f32(i);
        let a = fi * 0.95 + t * mix(0.3, 1.6, k.y);
        let c = vec3f(cos(a) * 0.55, -0.95 + fi * 0.27, sin(a) * 0.55);
        d = smin(d, length(p - c) - (0.18 + 0.03 * sin(fi * 1.7 + t * 2.0)), kk);
    }
    return d;
}`,
   `  let h = march_bead_chain(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_bead_chain(p);
  let alb = mix(hue(0.55 + p.y * 0.28), cTone(), 0.2) * 0.75;
  return finish(plastic(rd, n, alb, ao_bead_chain(p, n)), uv);`,
   { def: [0.6, 0.5, 0.5, 0.5], br: 1.3 }],

  ['lava_lamp', 'blobs', 'wax rising and merging by smooth-min inside a tapered glass vessel, glowing hot at the base',
   ['pace', 'glow', '', ''],
   `fn map_lava_lamp(p: vec3f) -> f32 {
    let r = 0.5 - 0.1 * p.y;
    let q = vec2f(length(p.xz) - r, abs(p.y) - 1.02);
    return (min(max(q.x, q.y), 0.0) + length(max(q, vec2f(0.0)))) * 0.95 - 0.05;
}
fn map_lava_wax(p: vec3f) -> f32 {
    let t = u.time * mix(0.35, 1.2, u.k.x) + 1.7;
    var d = p.y + 0.86;
    for (var i = 0; i < 5; i++) {
        let fi = f32(i);
        let y = -0.2 - 0.72 * cos(t * (0.34 + 0.07 * fi) + fi * 2.1);
        let c = vec3f(0.14 * sin(fi * 3.1 + t * 0.3), y, 0.12 * cos(fi * 1.7 + t * 0.25));
        d = smin(d, length(p - c) - (0.14 + 0.05 * sin(fi * 2.3)), 0.24);
    }
    return max(d, map_lava_lamp(p) + 0.05);
}`,
   `  let h = march_lava_lamp(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_lava_lamp(p);
  let fr = schlick(clamp(-dot(rd, n), 0.0, 1.0), 0.04);
  let dir = refract(rd, n, 1.0 / 1.4);
  let pin = p - n * 0.004;
  let len = thru_lava_lamp(pin, dir);
  let wax = mix(vec3f(1.0, 0.2, 0.04), cCream(), 0.1);
  let liquid = mix(cInk() * 2.0, cTone(), 0.12);
  var tw = 0.0; var glow = 0.0; var hit = false;
  for (var i = 0; i < 48; i++) {
      let d = map_lava_wax(pin + dir * tw);
      glow += exp(-max(d, 0.0) * 10.0) * 0.012;
      if (d < 0.002) { hit = true; break; }
      tw += max(d, 0.004);
      if (tw > len) { break; }
  }
  var inner = vec3f(0.0);
  if (hit) {
      let pw = pin + dir * tw;
      let nw = nrm_lava_wax(pw);
      let rim = pow(1.0 - clamp(-dot(dir, nw), 0.0, 1.0), 2.0);
      let heat = smoothstep(1.0, -1.0, pw.y);
      inner = wax * (0.06 + 0.9 * heat * heat + 0.6 * rim) * mix(0.5, 1.6, k.y) + envDiff(nw) * wax * 0.35;
  } else {
      let pe = pin + dir * len;
      let ne = -nrm_lava_lamp(pe);
      var ex = refract(dir, ne, 1.4);
      if (dot(ex, ex) == 0.0) { ex = reflect(dir, ne); }
      inner = env(ex) * 0.2 * vec3f(1.0, 0.62, 0.5) + liquid * 0.3;
  }
  inner += wax * glow * mix(0.3, 1.2, k.y) * smoothstep(1.2, -1.0, p.y);
  return finish(env(reflect(rd, n)) * fr + inner * (1.0 - fr), uv);`,
   { br: { lava_lamp: 1.2, lava_wax: 1.2 } }],

  ['oil_drops', 'blobs', 'five amber oil drops orbiting and fusing by smooth-min, lit through their bodies',
   ['fusion', 'amber', '', ''],
   `fn map_oil_drops(p0: vec3f) -> f32 {
    let t = u.time + 2.0; let k = u.k;
    let p = spin(p0, 0.2, 0.2);
    var d = 1e5;
    for (var i = 0; i < 5; i++) {
        let fi = f32(i);
        let w = 0.45 + 0.13 * fi;
        let c = vec3f(cos(t * w + fi * 1.3) * 0.55, sin(t * (0.37 + 0.09 * fi) + fi * 2.2) * 0.45, sin(t * w + fi * 1.3) * 0.35);
        d = smin(d, length(p - c) - (0.36 - 0.04 * fi), mix(0.1, 0.45, k.x));
    }
    return d;
}`,
   glassBody('oil_drops', '1.47', '0.02', 'vec3f(0.05, 0.3, 1.0) * mix(0.15, 1.8, k.y)'),
   { def: [0.55, 0.5, 0.5, 0.5], br: 1.4 }],

  ['mercury', 'blobs', 'a liquid-metal blob wobbling in its own pool while two drops bounce and rejoin',
   ['wobble', 'ripples', '', ''],
   `fn map_mercury(p0: vec3f) -> f32 {
    let t = u.time + 0.6; let k = u.k;
    let p = spin(p0, 0.4, 0.0);
    let rr = length(p.xz);
    let ripple = 0.018 * mix(0.0, 2.0, k.y) * sin(rr * 16.0 - t * 5.0) * exp(-rr * 1.2);
    let q = vec2f(rr - 1.05, abs(p.y + 0.84 + ripple) - 0.015);
    let pool = min(max(q.x, q.y), 0.0) + length(max(q, vec2f(0.0))) - 0.06;
    let wob = mix(0.0, 0.14, k.x) * sin(p.x * 5.0 + t * 2.3) * sin(p.z * 4.3 - t * 1.9) * sin(p.y * 4.0 + t * 1.3);
    let body = (length(vec3f(p.x, (p.y + 0.3) * 1.25, p.z)) - 0.52) * 0.8 + wob;
    let d1 = length(p - vec3f(0.55 * cos(t * 0.8), -0.2 + 0.5 * abs(sin(t * 1.6)), 0.45 * sin(t * 0.8))) - 0.14;
    let d2 = length(p - vec3f(-0.5 * cos(t * 0.6), -0.3 + 0.45 * abs(sin(t * 1.9 + 1.0)), -0.4 * sin(t * 0.6))) - 0.11;
    return smin(smin(pool, body, 0.3), min(d1, d2), 0.2);
}`,
   chromeBody('mercury', 'vec3f(0.8, 0.82, 0.86)'),
   { br: 1.4 }],

  // ---------------------------------------------------------------- film
  ['soap_bubble', 'film', 'a soap bubble: film thickness swirls and drains, both walls interfere',
   ['thickness', 'swirl', 'drain', ''],
   ``,
   `  let hs = sphHit(ro, rd, 0.95);
  let bg = backdrop(rd);
  if (hs.x < 0.0) { return finish(bg, uv); }
  var c = bg * 0.93;
  for (var s = 0; s < 2; s++) {
      let n = normalize(ro + rd * select(hs.x, hs.y, s == 1));
      let nf = select(n, -n, s == 1);
      let q = rotY(mix(0.5, 4.0, k.y) * n.y + t * 0.35) * n;
      let th = mix(150.0, 950.0, k.x) * (0.6 + 0.7 * fbm3(q * 2.3 + vec3f(0.0, t * 0.12, 0.0), 4))
             + mix(0.0, 900.0, k.z) * smoothstep(0.3, -1.0, n.y);
      let ci = clamp(-dot(rd, nf), 0.0, 1.0);
      let fr = 0.06 + 0.94 * pow(1.0 - ci, 3.0);
      c += (env(reflect(rd, nf)) + 0.05) * film(th, ci, 1.33) * fr * select(1.5, 0.8, s == 1);
  }
  return finish(c, uv);`],

  ['iris_blob', 'film', 'a tumbling noise-warped blob under a fixed film: the hue follows the view angle',
   ['warp', 'film', '', ''],
   `fn map_iris_blob(p0: vec3f) -> f32 {
    let t = u.time; let k = u.k;
    let p = spin(p0, t * 0.6 + 0.4, t * 0.37 + 0.3);
    return (length(p) - 0.78 - mix(0.05, 0.3, k.x) * gnoise(p * 1.7 + vec3f(t * 0.2))) * 0.75;
}`,
   `  let h = march_iris_blob(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_iris_blob(p);
  let ci = clamp(-dot(rd, n), 0.0, 1.0);
  let fl = film(mix(280.0, 560.0, k.y) + 120.0 * gnoise(p * 2.0), ci, 1.6);
  let fls = fl * 1.3;
  let occ = ao_iris_blob(p, n);
  let c = envDiff(n) * cInk() * 0.6 + (env(reflect(rd, n)) + 0.07) * fls * (0.4 + 0.6 * schlick(ci, 0.1));
  return finish(c * occ, uv);`,
   { br: 1.3 }],

  ['oil_slick', 'film', 'a black glass sphere wearing an oil film that flows in contour bands',
   ['thickness', 'bands', '', ''],
   ``,
   `  let hs = sphHit(ro, rd, 0.9);
  if (hs.x < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * hs.x;
  let n = normalize(p);
  let q = spin(n, t * 0.2 + 0.4, 0.3);
  let flow = fbm3(q * 1.1 + vec3f(0.0, t * 0.08, 0.0), 3);
  let th = 180.0 + mix(300.0, 1400.0, k.x) * (0.5 + 0.5 * sin(flow * mix(3.0, 10.0, k.y) + t * 0.5));
  let ci = clamp(-dot(rd, n), 0.0, 1.0);
  let fl = film(th, ci, 1.47);
  let r = env(reflect(rd, n));
  let c = r * schlick(ci, 0.04) * 0.5 + (r * 0.6 + 0.1) * fl * fl * 1.6 * (0.3 + 0.7 * schlick(ci, 0.05));
  return finish(c, uv);`],

  ['nacre', 'film', 'a baroque pearl: soft body light plus pastel orient from thin nacre platelets',
   ['orient', 'luster', '', ''],
   `fn map_nacre(p0: vec3f) -> f32 {
    let t = u.time; let k = u.k;
    let p = spin(p0, t * 0.3 + 0.3, 0.2);
    return (length(p * vec3f(1.0, 1.1, 1.0)) - 0.8 - 0.035 * gnoise(p * 2.4)) * 0.9;
}`,
   `  let h = march_nacre(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_nacre(p);
  let q = spin(p, t * 0.3 + 0.3, 0.2);
  let ci = clamp(-dot(rd, n), 0.0, 1.0);
  let th = mix(260.0, 560.0, k.x) + 90.0 * fbm3(q * 9.0, 3);
  let orient = mix(vec3f(1.0), film(th, ci, 1.53) * 1.8, 0.45);
  let body = mix(vec3f(0.9, 0.88, 0.85), cCream(), 0.35);
  let wrap = 0.25 * pow(1.0 - ci, 2.0);
  let c = envDiff(n) * body * orient * 0.85 + body * wrap * cCream()
        + env(reflect(rd, n)) * schlick(ci, 0.05) * mix(0.4, 1.4, k.y) * orient;
  return finish(c, uv);`],

  // ---------------------------------------------------------------- interior
  ['ink_block', 'interior', 'two dyes domain-warped through a glass block, marched in 24 steps',
   ['warp', 'density', '', ''],
   `fn inkLocal(p: vec3f) -> vec3f { return spin(p, u.time * 0.3 + 0.55, 0.28); }
fn map_ink_block(p: vec3f) -> f32 { return rbox(inkLocal(p), vec3f(0.62, 0.85, 0.36), 0.1); }
fn inkField(q: vec3f, t: f32, wk: f32) -> vec2f {
    var w = q * 1.5;
    w += wk * vec3f(gnoise(w + vec3f(0.0, t * 0.25, 0.0)), gnoise(w + vec3f(5.2, 1.3, t * 0.2)), gnoise(w + vec3f(2.1, 7.7, -t * 0.2)));
    let n = fbm3(w, 3);
    return vec2f(smoothstep(-0.02, 0.35, n), 0.5 + 0.9 * gnoise(w * 0.6 + 3.0));
}`,
   `  let h = march_ink_block(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_ink_block(p);
  let fr = schlick(clamp(-dot(rd, n), 0.0, 1.0), 0.04);
  let dir = refract(rd, n, 1.0 / 1.5);
  let pin = p - n * 0.004;
  let len = thru_ink_block(pin, dir);
  let dt = len / 24.0;
  let sig = mix(3.0, 16.0, k.y);
  var T = 1.0; var acc = vec3f(0.0);
  for (var i = 0; i < 24; i++) {
      let q = inkLocal(pin + dir * (dt * (f32(i) + 0.5)));
      let f = inkField(q, t, mix(0.4, 2.2, k.x));
      let dye = mix(cTone() * 1.2, vec3f(1.0, 0.18, 0.4), clamp(f.y, 0.0, 1.0));
      let lit = 0.35 + 0.9 * smoothstep(-0.9, 0.9, q.y);
      let a = 1.0 - exp(-f.x * sig * dt);
      acc += T * a * dye * lit;
      T *= 1.0 - a;
  }
  let pe = pin + dir * len;
  let ne = -nrm_ink_block(pe);
  var ex = refract(dir, ne, 1.5);
  if (dot(ex, ex) == 0.0) { ex = reflect(dir, ne); }
  acc += T * env(ex);
  return finish(env(reflect(rd, n)) * fr + acc * (1.0 - fr), uv);`,
   { br: 1.25 }],

  ['cat_eye', 'interior', 'a glass marble with three twisted color vanes, traced as a solid inside the sphere',
   ['twist', 'vanes', '', ''],
   `fn vaneSD(p0: vec3f, t: f32, tw: f32, nv: f32) -> vec2f {
    let p = spin(p0, t * 0.4 + 0.3, 0.35);
    let a = atan2(p.z, p.x) - p.y * tw;
    let sec = TAU / nv;
    let id = floor(a / sec + 0.5);
    let r = length(p.xz);
    let blade = abs(r * sin(a - id * sec)) - 0.03 * (1.0 - r * 1.6);
    let cap = length(p * vec3f(1.0, 0.7, 1.0)) - 0.46;
    return vec2f(max(blade, cap) * 0.45, id);
}`,
   `  let hs = sphHit(ro, rd, 0.92);
  if (hs.x < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * hs.x;
  let n = normalize(p);
  let fr = schlick(clamp(-dot(rd, n), 0.0, 1.0), 0.04);
  let dir = refract(rd, n, 1.0 / 1.5);
  let len = sphHit(p - n * 0.002, dir, 0.92).y;
  let tw = mix(0.5, 4.0, k.x);
  let nv = 2.0 + floor(k.y * 3.99);
  var tr = 0.0; var hit = false; var id = 0.0;
  for (var i = 0; i < 48; i++) {
      let v = vaneSD(p + dir * tr, t, tw, nv);
      if (v.x < 0.0015) { hit = true; id = v.y; break; }
      tr += max(v.x, 0.003);
      if (tr > len) { break; }
  }
  var inner = vec3f(0.0);
  if (hit) {
      let pv = p + dir * tr;
      let e = vec2f(0.002, 0.0);
      let nn = normalize(vec3f(vaneSD(pv + e.xyy, t, tw, nv).x - vaneSD(pv - e.xyy, t, tw, nv).x,
                               vaneSD(pv + e.yxy, t, tw, nv).x - vaneSD(pv - e.yxy, t, tw, nv).x,
                               vaneSD(pv + e.yyx, t, tw, nv).x - vaneSD(pv - e.yyx, t, tw, nv).x));
      let alb = mix(hue(id / nv + 0.05), cTone(), 0.15);
      inner = alb * (envDiff(nn) * 1.1 + 0.15) + env(reflect(dir, nn)) * 0.08;
  } else {
      let pe = p + dir * len;
      var ex = refract(dir, -normalize(pe), 1.5);
      if (dot(ex, ex) == 0.0) { ex = reflect(dir, -normalize(pe)); }
      inner = env(ex) * vec3f(0.85, 0.95, 1.0);
  }
  return finish(env(reflect(rd, n)) * fr + inner * (1.0 - fr), uv);`,
   { def: [0.45, 0.5, 0.5, 0.5] }],

  ['nebula_orb', 'interior', 'an emission nebula and a star field held inside a clear glass orb',
   ['density', 'warp', '', ''],
   ``,
   `  let hs = sphHit(ro, rd, 0.95);
  if (hs.x < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * hs.x;
  let n = normalize(p);
  let fr = schlick(clamp(-dot(rd, n), 0.0, 1.0), 0.04);
  let dir = refract(rd, n, 1.0 / 1.45);
  let len = sphHit(p - n * 0.002, dir, 0.95).y;
  let dt = len / 24.0;
  var T = 1.0; var acc = vec3f(0.0);
  for (var i = 0; i < 24; i++) {
      let q = spin(p + dir * (dt * (f32(i) + 0.5)), t * 0.15 + 0.7, 0.3);
      let w = q * 1.7 + mix(0.3, 1.6, k.y) * vec3f(gnoise(q * 1.3 + vec3f(t * 0.1, 0.0, 0.0)), gnoise(q * 1.3 + 4.1), gnoise(q * 1.3 - 2.7));
      let f = fbm3(w, 4);
      let dens = max(f + 0.08, 0.0) * mix(1.5, 6.0, k.x) * smoothstep(0.95, 0.35, length(q));
      let em = mix(cTone() * 1.4, vec3f(1.0, 0.25, 0.55), smoothstep(-0.2, 0.3, gnoise(w * 0.7 + 9.0))) + cCream() * smoothstep(0.2, 0.5, f) * 1.5;
      acc += T * em * dens * dt;
      T *= exp(-dens * dt * 0.9);
  }
  let g = dir * 70.0;
  let hc = hash3(g);
  let star = step(0.975, hc.x) * smoothstep(0.45, 0.1, length(fract(g) - 0.5 - (hc.yzx - 0.5) * 0.3)) * (0.5 + 2.0 * hc.y);
  acc += T * (cCream() * star * 1.5 + cInk() * 0.4);
  return finish(env(reflect(rd, n)) * fr + acc * (1.0 - fr), uv);`,
   { def: [0.5, 0.5, 0.5, 0.5] }],

  // ---------------------------------------------------------------- emissive
  ['rainbow_knot', 'emissive', 'a torus-knot filament of light; the hue runs along the curve and loops',
   ['knot', 'width', 'flow', ''],
   `fn knotD(p: vec3f, P: f32, Q: f32) -> vec2f {
    let a = atan2(p.z, p.x);
    let lp = vec2f(length(p.xz) - 0.6, p.y);
    var best = vec2f(1e5, 0.0);
    for (var i = 0; i < 2; i++) {
        let s = (a + TAU * f32(i)) / P;
        let d = length(lp - 0.3 * vec2f(cos(Q * s), sin(Q * s)));
        if (d < best.x) { best = vec2f(d, s / TAU); }
    }
    return best;
}`,
   `  var c = backdrop(rd) * 0.3;
  let hs = sphHit(ro, rd, 1.0);
  if (hs.y > 0.0) {
      let Q = 3.0 + 2.0 * floor(k.x * 2.99);
      let w = mix(0.015, 0.06, k.y);
      var tr = max(hs.x, 0.0);
      for (var i = 0; i < 64; i++) {
          let pos = ro + rd * tr;
          let kd = knotD(spin(pos, t * 0.5 + 0.3, 0.95), 2.0, Q);
          let st = clamp(kd.x * 0.5, 0.006, 0.05);
          let col = hue(fract(kd.y - t * mix(0.05, 0.4, k.z)));
          c += col * (exp(-kd.x * kd.x / (w * w)) * 30.0 + exp(-kd.x * 14.0) * 0.8) * st;
          tr += st;
          if (tr > hs.y) { break; }
      }
  }
  return finish(c, uv);`],

  ['granule_star', 'emissive', 'a star with Worley granulation, limb darkening and a warped corona gathered along the ray',
   ['cells', 'corona', 'spots', ''],
   ``,
   `  let R = 0.6;
  var c = backdrop(rd) * 0.2;
  let hs = sphHit(ro, rd, R);
  let ho = sphHit(ro, rd, 1.35);
  if (ho.y > 0.0) {
      let t0 = max(ho.x, 0.0);
      let t1 = select(ho.y, hs.x, hs.x > 0.0);
      let dt = (t1 - t0) / 24.0;
      for (var i = 0; i < 24; i++) {
          let pos = ro + rd * (t0 + dt * (f32(i) + 0.5));
          let r = length(pos);
          let q = spin(pos / r, t * 0.08, 0.25);
          let streak = fbm3(q * 3.2 + vec3f(0.0, 0.0, t * 0.15), 3);
          let dens = exp(-(r - R) * mix(12.0, 4.0, k.y)) * (0.3 + 1.6 * max(streak + 0.15, 0.0));
          c += mix(vec3f(1.0, 0.45, 0.12), cCream(), 0.3) * dens * dt * 2.2;
      }
  }
  if (hs.x > 0.0) {
      let p = ro + rd * hs.x;
      let n = normalize(p);
      let q = spin(n, t * 0.08, 0.25);
      let w = worley2(q * mix(5.0, 16.0, k.x) + vec3f(t * 0.1));
      let gran = smoothstep(0.0, 0.5, w.y - w.x);
      let spot = smoothstep(0.25, 0.45, fbm3(q * 2.0 + 11.0, 3)) * k.z;
      let mu = clamp(-dot(rd, n), 0.0, 1.0);
      let limb = 0.3 + 0.7 * pow(mu, 0.55);
      let hot = mix(vec3f(1.0, 0.36, 0.06), mix(vec3f(1.0, 0.82, 0.5), cCream(), 0.4), gran * limb);
      c = hot * (1.2 + 2.6 * gran) * limb * (1.0 - 0.8 * spot);
  }
  return finish(c, uv);`,
   { def: [0.5, 0.5, 0.35, 0.5] }],

  ['plasma_ring', 'emissive', 'a wireframe sphere drawn only near its silhouette, ringed by a flickering plasma',
   ['ring', 'rim', '', ''],
   ``,
   `  let R = 0.85;
  var c = backdrop(rd) * 0.22;
  let tc = -dot(ro, rd);
  let cp = ro + rd * tc;
  let b = length(cp);
  let ang = atan2(dot(cp, camUp()), dot(cp, camRt()));
  let fl = fbm3(vec3f(cos(ang) * 2.2, sin(ang) * 2.2, t * 0.9), 4);
  let wd = mix(0.012, 0.05, k.x) * (0.6 + 1.2 * max(fl + 0.3, 0.0));
  let ring = exp(-abs(b - R) / wd);
  let haze = exp(-abs(b - R) * 5.0) * 0.25;
  c += (mix(cTone(), cCream(), ring * 0.8) * ring * 3.0 + cTone() * haze) * (0.6 + 0.9 * max(fl + 0.3, 0.0));
  let hs = sphHit(ro, rd, R);
  if (hs.x > 0.0) {
      for (var s = 0; s < 2; s++) {
          let n = normalize(ro + rd * select(hs.x, hs.y, s == 1));
          let q = spin(n, t * 0.3 + 0.2, 0.45);
          let lat = acos(clamp(q.y, -1.0, 1.0)) / PI * 10.0;
          let lon = (atan2(q.z, q.x) / TAU + 0.5) * 20.0;
          let dl = min(abs(fract(lat + 0.5) - 0.5), abs(fract(lon + 0.5) - 0.5) * (0.3 + 0.7 * sqrt(max(1.0 - q.y * q.y, 0.0))));
          let line = smoothstep(0.09, 0.0, dl);
          let sil = pow(1.0 - abs(dot(n, rd)), mix(1.5, 5.0, k.y));
          c += mix(cTone(), cCream(), 0.3) * line * sil * select(2.4, 1.1, s == 1);
      }
  }
  return finish(c, uv);`],

  ['neon_shell', 'emissive', 'a warped sphere shell with no surface, only glow gathered where the ray grazes it',
   ['warp', 'sharpness', '', ''],
   `fn map_neon_shell(p0: vec3f) -> f32 {
    let t = u.time; let k = u.k;
    let p = spin(p0, t * 0.4, 0.3 + t * 0.2);
    return length(p) - 0.78 - mix(0.05, 0.28, k.x) * gnoise(p * 2.0 + vec3f(0.0, t * 0.5, 0.0));
}`,
   `  var c = backdrop(rd) * 0.25;
  let hs = sphHit(ro, rd, 1.15);
  if (hs.y > 0.0) {
      let sh = mix(12.0, 50.0, k.y);
      var tr = max(hs.x, 0.0);
      for (var i = 0; i < 64; i++) {
          let pos = ro + rd * tr;
          let d = map_neon_shell(pos);
          let st = clamp(abs(d) * 0.6, 0.008, 0.06);
          let col = mix(hue(0.62 + 0.22 * pos.y + 0.08 * sin(t * 0.7)), cTone(), 0.25);
          c += col * exp(-abs(d) * sh) * st * 5.0;
          tr += st;
          if (tr > hs.y) { break; }
      }
  }
  return finish(c, uv);`],
];

// ── emit pack.wgsl ───────────────────────────────────────────────────────────
const [name_, fam_, sp_, kn_, decl_, body_, opt_] = [0, 1, 2, 3, 4, 5, 6];
function stamp(cell) {
  const decl = cell[decl_] || '';
  const text = decl + '\n' + cell[body_];
  const opts = cell[opt_] || {};
  const out = [];
  for (const [, m] of decl.matchAll(/fn map_(\w+)\(/g)) {
    const br = typeof opts.br === 'object' ? (opts.br[m] ?? 1.5) : (opts.br ?? 1.5);
    const want = new Set(Object.keys(TPL).filter(kind => new RegExp(`\\b${kind}_${m}\\(`).test(text)));
    for (const kind of [...want]) for (const dep of DEPS[kind] || []) want.add(dep);
    for (const kind of Object.keys(TPL)) if (want.has(kind)) out.push(TPL[kind](m, br.toFixed(2)));
  }
  return out.join('\n');
}
const frag = cell =>
  `@fragment fn fs_${cell[name_]}(@builtin(position) fp: vec4f) -> @location(0) vec4f {\n  let uv = suv(fp.xy);\n  let t = u.time;\n  let k = u.k;\n  let ro = camO();\n  let rd = camD(uv);\n${cell[body_]}\n}`;
const pack = HELPERS + '\n// ── the 24 cells ─────────────────────────────────────────────────────────────\n' +
  CELLS.map(c => `\n// ── ${c[name_]} (${c[fam_]}) ──\n` + [c[decl_], stamp(c), frag(c)].filter(Boolean).join('\n')).join('\n') + '\n';

// ── emit spec.json ───────────────────────────────────────────────────────────
const spec = {
  cols: 6,
  uniform_bytes: 96,
  cells: CELLS.map(c => ({
    name: c[name_], family: c[fam_], species: c[sp_], knobs: c[kn_],
    defaults: (c[opt_] && c[opt_].def) || [0.5, 0.5, 0.5, 0.5],
    fn: 'fs_' + c[name_],
  })),
  gens: [
    { id: 'exposure', title: 'Exposure · brightness', fn: 'flat', period: 10, amp: 0.4, bias: 0.5, phase: 0,
      map: 'y => Math.pow(2, (y - 0.5) * 5)', unit: "v => (Math.log2(v) >= 0 ? '+' : '') + Math.log2(v).toFixed(1) + ' ev'" },
    { id: 'tempo', title: 'Tempo · hover speed', fn: 'flat', period: 8, amp: 0.0, bias: 0.5, phase: 0,
      map: 'y => 0.1 + 2.9 * y', unit: "v => v.toFixed(2) + 'x'" },
    { id: 'studio', title: 'Studio · softbox power', fn: 'flat', period: 10, amp: 0.3, bias: 0.5, phase: 0,
      map: 'y => Math.pow(2, (y - 0.5) * 3)', unit: "v => v.toFixed(2) + 'x'" },
  ],
  swatches: [
    { id: 'ink', label: 'Room', hex: '#0c0f16' },
    { id: 'tone', label: 'Accent', hex: '#5b7cff' },
    { id: 'cream', label: 'Light', hex: '#fff1dc' },
  ],
};

// ── emit index.html ──────────────────────────────────────────────────────────
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const legend = Object.keys(FAM).map(f => `<span class="f-${f}"><i></i>${f}</span>`).join('');
const tiles = CELLS.map(c =>
  `<div class="cell f-${c[fam_]}" role="button" tabindex="0" id="tile-${c[name_]}" aria-label="${esc(c[name_] + ': ' + c[sp_])}"><canvas></canvas><span class="orb-status"></span><span class="tag">${c[name_].replace(/_/g, ' ')}</span></div>`).join('');
const swatchHtml = spec.swatches.map(s => `<label class="swatch"><span>${s.label}</span><input type="color" id="sw-${s.id}" value="${s.hex}"></label>`).join('');

const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SDF Solids Table // Stella Nova</title>
<!--
  ════════════════════════════════════════════════════════════════════════════
   SDF SOLIDS TABLE  ·  page shell (GENERATED by build.mjs — do not edit by hand)
  ────────────────────────────────────────────────────────────────────────────
   Static markup only. main.js loads the data and hands it to the shared
   table-engine, which builds the sidebar and the frame loop and drives page.js.
   ${CELLS.length} sphere-traced solids, one fragment shader per cell.
  ════════════════════════════════════════════════════════════════════════════
-->
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=JetBrains+Mono:wght@300;400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="style.css">
</head>
<body>

<script>if(window!==window.top)document.documentElement.classList.add("in-frame")</script>
<div class="grid-bg"></div>
<div class="topbar">
  <div class="topbar-l"><span class="sys-name">Stella Nova</span><span class="sys-status">SDF Solids Table</span></div>
  <div class="topbar-r">SYS // <strong>WGSL SHADER LAB</strong></div>
</div>
<div id="side">
  <div class="side-head"><div class="big">solids</div><div class="sub">|${CELLS.length} solids · ${Object.keys(FAM).length} families⟩</div></div>
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
//  SDF SOLIDS TABLE  ·  main.js — data load and boot (the entry module, GENERATED)
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
//  SDF SOLIDS TABLE  ·  page.js — the per-page PAGE object (GENERATED)
// ────────────────────────────────────────────────────────────────────────────
//  ${CELLS.length} sphere-traced solids; one fragment shader per cell, each reading only
//  a shared uniform buffer (no texture, no pointer). The shared table-engine
//  drives this object through its ctx. main.js fetches the data and calls
//  bootTable(PAGE, data); the engine calls PAGE.init and PAGE.draw from there.
//
//  UNIFORM LAYOUT (96 bytes, matches struct SolidU in shaders/pack.wgsl)
//    0..1 size · 2 time · 3 pixelScale · 4..7 ink · 8..11 tone · 12..15 cream
//    16 exposure · 17 studio · 18 glow · 19 pad · 20..23 k (four knobs)
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
    d[16] = G.exposure; d[17] = G.studio; d[18] = 1.0; d[19] = 0;
    d.set(t.knobs, 20);
    device.queue.writeBuffer(surf.buf, 0, d);
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: surf.ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(t.pipeline); pass.setBindGroup(0, this.bind(surf)); pass.draw(3); pass.end();
  },
  source(t) { return this.ctx.fnSource('fs_' + t.s.name); },
};
`;

// ── emit style.css (clone color-table, append the solid families) ───────────
const famCss = Object.entries(FAM).map(([f, c]) =>
  `.f-${f}{--fam:${c};--fam-bg:${c.replace(/[\d.]+\)$/, '0.06)')}}`).join('\n');
const baseCss = readFileSync(join(DIR, '..', 'color-table', 'style.css'), 'utf8');
const css = baseCss + `
/* ── solid families (appended by build.mjs) ────────────────────────────── */
${famCss}
.side-head .big{color:#a9bcff}
.legend span{text-transform:capitalize}
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
for (const c of CELLS) fam[c[fam_]] = (fam[c[fam_]] || 0) + 1;
console.log('cells       : ' + CELLS.length);
console.log('families    : ' + JSON.stringify(fam));
console.log('fs_ entries : ' + (pack.match(/@fragment fn fs_/g) || []).length);
console.log('names unique: ' + (new Set(CELLS.map(c => c[0])).size === CELLS.length));
console.log('wrote pack.wgsl, spec.json, index.html, main.js, page.js, style.css');
