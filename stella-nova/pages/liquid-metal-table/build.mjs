// ============================================================================
//  LIQUID METAL TABLE  ·  build.mjs — the single source of truth for the page
// ────────────────────────────────────────────────────────────────────────────
//  One generator emits every file the page needs, so the cell names, the WGSL
//  entry points and the tile divs cannot drift apart. Run it with:
//      node build.mjs
//  It writes shaders/pack.wgsl, spec.json, page.js, main.js, index.html and
//  style.css into this folder. The shared table-engine drives the result; it
//  renders one fragment entry point fs_<name> per tile from a shared uniform.
//
//  MODEL
//    Every cell is fragment-only 2.5D shading. A cell body reads p (centered,
//    y up, about -0.5 .. 0.5), t (the hover clock) and k (four knobs). It makes
//    a height field, a tube profile or a blob field, gets a normal from it, and
//    reflects env(dir), a procedural studio (banded sky, hard horizon, softbox
//    strips) tinted by the ink, tone and cream swatches. present() applies the
//    exposure and contrast knobs and a soft shoulder. There is no pointer and
//    no texture: all motion comes from t and the knobs.
//
//  GREP MAP (pack.wgsl)
//    struct MetalU ..... the shared uniform block
//    fn cuv / fn px .... pixel to centered uv, one pixel in uv units
//    fn gnoise / fbm ... gradient noise and the fractal sum (max 5 octaves)
//    fn voronoi ........ Worley cells with exact edge distance and edge dir
//    fn env ............ the procedural studio   ·  fn chrome .. metal shading
//    fn present ........ exposure, contrast, soft shoulder
//    fn hWarp .......... domain-warped height    ·  fn silk .... ribbon stack
//    fn tubeShade ...... tube cross-section      ·  fn orbitField .. metaballs
//    fn film ........... thin-film interference  ·  fn lightField .. backlight
//    fn cmf / filmN .... color lobes, film with a free index
//    fn oxide .......... temper / anodize colors (complement of the film)
//    fn bragg .......... multilayer (Bragg stack) reflectance
//    fn grating ........ diffraction grating color (holographic foil)
//    fn kk ............. Kajiya-Kay strand highlight
//    fn hexCell ........ hex lattice cell: local offset and id
//    fn ballN / glowRamp sphere normal, molten emission ramp
//    per-cell helpers .. emitted just before their fs_* (the pre field in cells-*.mjs)
//    @fragment fs_* .... the cells
//
//  CELL FILES
//    cells.mjs ......... the first six families and the CELLS export
//    cells-alloys.mjs .. alloys     ·  cells-fluids.mjs .... fluids
//    cells-machined.mjs  machined   ·  cells-textiles.mjs .. textiles
//    cells-iridescent.mjs  iridescent · cells-kinetic.mjs . kinetic
// ============================================================================
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));

// ── families (legend order, cool metal hues) ─────────────────────────────────
const FAM = {
  chrome:  'rgba(190,205,225,0.14)',
  ribbons: 'rgba(210,180,235,0.13)',
  bands:   'rgba(160,190,220,0.14)',
  blobs:   'rgba(200,215,230,0.13)',
  cells:   'rgba(235,170,120,0.13)',
  glass:   'rgba(140,220,210,0.13)',
  alloys:  'rgba(240,200,120,0.14)',
  fluids:  'rgba(150,200,240,0.13)',
  machined:'rgba(185,190,200,0.14)',
  textiles:'rgba(235,150,190,0.13)',
  iridescent:'rgba(170,240,160,0.13)',
  kinetic: 'rgba(240,140,120,0.13)',
};

// ── the WGSL helper library (shared by every cell) ──────────────────────────
const HELPERS = `// ═══════════════════════════════════════════════════════════════════════════
//  LIQUID METAL TABLE  ·  one fragment shader per cell, fragment-only 2.5D
//  shading. Every cell reads p (centered, y up), the hover clock t and four
//  knobs k. It builds a height field, tube profile or blob field, takes a
//  normal from it and reflects env, a procedural studio tinted by the ink,
//  tone and cream swatches. Domain warping and finite-difference normals
//  after Quilez; metaballs after Blinn 1982; cellular noise after Worley 1996
//  with the Quilez exact edge distance; Fresnel after Schlick 1994; thin-film
//  color from two-beam interference; cosine palette after Quilez. Gerstner
//  (trochoidal) waves after Gerstner 1802 and Tessendorf 2001; strand light
//  after Kajiya and Kay 1989; multilayer color from the Bragg condition;
//  foil color from the grating equation; rain rings from a hashed cell grid.
//  The studio, ribbon, tube, glass and every cell core are original.
// ═══════════════════════════════════════════════════════════════════════════
const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.283185307179586;

struct MetalU {
    size: vec2f, time: f32, pixelScale: f32,
    ink: vec4f, tone: vec4f, cream: vec4f,
    exposure: f32, contrast: f32, glow: f32, pad1: f32,
    k: vec4f,
};
@group(0) @binding(0) var<uniform> u: MetalU;

@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var q = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(q[i], 0.0, 1.0);
}

// centered uv, y up, the short side spans -0.5 .. 0.5
fn cuv(fp: vec2f) -> vec2f {
    let q = fp / max(u.pixelScale, 0.001);
    let n = (q - 0.5 * u.size) / max(min(u.size.x, u.size.y), 1.0);
    return vec2f(n.x, -n.y);
}
// one pixel in uv units
fn px() -> f32 { return 1.0 / max(min(u.size.x, u.size.y), 1.0); }

// ── hashing and gradient noise ──────────────────────────────────────────────
fn pcg2(v0: vec2u) -> vec2u {
    var v = v0 * 1664525u + 1013904223u;
    v.x += v.y * 1664525u; v.y += v.x * 1664525u;
    v ^= v >> vec2u(16u);
    v.x += v.y * 1664525u; v.y += v.x * 1664525u;
    v ^= v >> vec2u(16u);
    return v;
}
fn rnd2(i: vec2i, s: u32) -> vec2f {
    return vec2f(pcg2(vec2u(i + vec2i(4096)) ^ vec2u(s, s * 7u + 3u))) * (1.0 / 4294967295.0);
}
fn rnd1(x: f32) -> f32 { return fract(sin(x * 127.1 + 311.7) * 43758.5453); }
fn rot2(a: f32) -> mat2x2f { let c = cos(a); let s = sin(a); return mat2x2f(c, s, -s, c); }

fn gnoise(p: vec2f, s: u32) -> f32 {
    let i = vec2i(floor(p)); let f = fract(p);
    let w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    let g00 = rnd2(i, s) * 2.0 - 1.0;
    let g10 = rnd2(i + vec2i(1, 0), s) * 2.0 - 1.0;
    let g01 = rnd2(i + vec2i(0, 1), s) * 2.0 - 1.0;
    let g11 = rnd2(i + vec2i(1, 1), s) * 2.0 - 1.0;
    let a = dot(g00, f); let b = dot(g10, f - vec2f(1.0, 0.0));
    let c = dot(g01, f - vec2f(0.0, 1.0)); let d = dot(g11, f - vec2f(1.0, 1.0));
    return mix(mix(a, b, w.x), mix(c, d, w.x), w.y) * 1.6;
}
fn fbm(p0: vec2f, oct: i32, s: u32) -> f32 {
    var p = p0; var a = 0.5; var sum = 0.0; var nrm = 0.0;
    for (var i: i32 = 0; i < 5; i++) {
        if (i >= oct) { break; }
        sum += a * gnoise(p, s + u32(i)); nrm += a; a *= 0.5;
        p = rot2(0.6) * p * 2.03;
    }
    return sum / max(nrm, 1e-4);
}
fn pal(x: f32) -> vec3f { return 0.5 + 0.5 * cos(TAU * (x + vec3f(0.0, 0.33, 0.67))); }

// ── Worley cells: nearest site, exact edge distance, direction to the edge ──
struct Vor { f1: f32, edge: f32, dir: vec2f, id: vec2f, rel: vec2f };
fn vsite(c: vec2i, t: f32, jit: f32, s: u32) -> vec2f {
    let r = rnd2(c, s);
    return vec2f(0.5) + jit * 0.5 * sin(t * (0.35 + 0.5 * r.yx) + TAU * r);
}
fn voronoi(p: vec2f, t: f32, jit: f32, s: u32) -> Vor {
    let ip = vec2i(floor(p)); let fp = fract(p);
    var md = 8.0; var mr = vec2f(0.0); var mc = vec2i(0);
    for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) {
        let c = vec2i(x, y);
        let r = vec2f(c) + vsite(ip + c, t, jit, s) - fp;
        let d = dot(r, r);
        if (d < md) { md = d; mr = r; mc = c; }
    } }
    var me = 8.0; var ed = vec2f(1.0, 0.0);
    for (var y: i32 = -2; y <= 2; y++) { for (var x: i32 = -2; x <= 2; x++) {
        let c = mc + vec2i(x, y);
        let r = vec2f(c) + vsite(ip + c, t, jit, s) - fp;
        let dd = r - mr;
        if (dot(dd, dd) > 1e-5) {
            let nd = normalize(dd);
            let e = dot(0.5 * (mr + r), nd);
            if (e < me) { me = e; ed = nd; }
        }
    } }
    var o: Vor; o.f1 = sqrt(md); o.edge = me; o.dir = ed; o.id = rnd2(ip + mc, s + 101u); o.rel = mr;
    return o;
}
// nearest-site distance only (cheap, for height fields)
fn vorF1(p: vec2f, s: u32) -> f32 {
    let ip = vec2i(floor(p)); let fp = fract(p); var md = 8.0;
    for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) {
        let c = vec2i(x, y);
        let r = vec2f(c) + vec2f(0.5) + 0.42 * (rnd2(ip + c, s) * 2.0 - 1.0) - fp;
        md = min(md, dot(r, r));
    } }
    return sqrt(md);
}

// ── the studio environment and metal shading ────────────────────────────────
// env: dir is a reflected ray (y up, z toward the viewer). spin turns the
// studio about the vertical axis. A flat face sees a point just over the
// horizon, so the hard horizon line crosses every tilted surface.
fn env(d0: vec3f, spin: f32) -> vec3f {
    let d = normalize(d0);
    let rx = d.x * cos(spin) + d.z * sin(spin);
    let e = d.y * 0.85 + 0.14;
    var sky = mix(u.tone.rgb * 0.55, u.cream.rgb * 0.95, smoothstep(0.05, 0.95, e));
    sky *= 0.22 + 0.78 * smoothstep(0.0, 0.24, e);
    sky += u.cream.rgb * 1.5 * smoothstep(0.035, 0.0, abs(e - 0.55));
    sky += u.cream.rgb * 0.8 * smoothstep(0.05, 0.0, abs(e - 0.82));
    let side = smoothstep(0.07, 0.0, abs(rx + 0.6)) + 0.6 * smoothstep(0.03, 0.0, abs(rx - 0.45));
    sky += u.cream.rgb * 1.1 * side * smoothstep(0.0, 0.12, e);
    let ground = mix(u.ink.rgb, u.tone.rgb * 0.16, smoothstep(-0.9, 0.0, e));
    var c = mix(ground, sky, smoothstep(-0.006, 0.006, e));
    c += u.tone.rgb * 0.5 * exp(-abs(e) * 60.0);
    return c;
}
fn fres(f0: vec3f, c: f32) -> vec3f { return f0 + (vec3f(1.0) - f0) * pow(1.0 - clamp(c, 0.0, 1.0), 5.0); }
fn metalF0() -> vec3f { return mix(vec3f(0.94), u.tone.rgb, 0.28); }
const VIEW: vec3f = vec3f(0.0, 0.0, 1.0);
const KEY: vec3f = vec3f(-0.5, 0.63, 0.6);
fn chrome(n: vec3f, f0: vec3f, spin: f32) -> vec3f {
    let r = reflect(-VIEW, n);
    var c = env(r, spin) * fres(f0, n.z);
    let h = normalize(normalize(KEY) + VIEW);
    c += u.cream.rgb * pow(max(dot(n, h), 0.0), 220.0) * 2.0 * u.glow;
    return c;
}
// exposure, contrast about mid grey, then a soft shoulder above 0.75
fn present(c0: vec3f) -> vec4f {
    var c = max(c0, vec3f(0.0)) * u.exposure;
    c = 0.2 * pow(c / 0.2, vec3f(u.contrast));
    let knee = 0.75;
    let over = max(c - vec3f(knee), vec3f(0.0));
    c = min(c, vec3f(knee)) + (1.0 - knee) * (vec3f(1.0) - exp(-over / (1.0 - knee)));
    return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), 1.0);
}

// ── height fields ───────────────────────────────────────────────────────────
// Quilez domain warp: fbm(q + amt * fbm(q + amt * fbm(q)))
fn hWarp(p: vec2f, t: f32, sc: f32, amt: f32, seed: u32) -> f32 {
    let q = p * sc;
    let a = vec2f(fbm(q + vec2f(0.0, 0.13 * t), 3, seed), fbm(q + vec2f(5.2, 1.3) - vec2f(0.11 * t, 0.0), 3, seed + 7u));
    let b = vec2f(fbm(q + amt * a + vec2f(1.7, 9.2) + 0.06 * t, 3, seed + 13u), fbm(q + amt * a + vec2f(8.3, 2.8) - 0.05 * t, 3, seed + 19u));
    return fbm(q + amt * b, 4, seed + 29u) / sc;
}
// falling drips on a pool: damped rings that spread and fade
fn hPool(p: vec2f, t: f32, rate: f32, amp: f32) -> f32 {
    var h = 0.01 * fbm(p * 2.0 + vec2f(0.05 * t, 0.0), 3, 5u);
    for (var i: i32 = 0; i < 4; i++) {
        let fi = f32(i);
        let cyc = t * rate + fi * 0.25;
        let ph = fract(cyc); let id = floor(cyc);
        let c = vec2f(rnd1(id * 3.1 + fi) - 0.5, rnd1(id * 5.7 + fi * 2.3) - 0.5) * 0.6;
        let x = length(p - c) - ph * 0.8;
        h += amp * sin(x * 60.0) * exp(-x * x * 70.0) * (1.0 - ph) * (1.0 - ph);
    }
    return h;
}
// a gentle warped swell for a liquid surface under an oil film
fn hSlick(p: vec2f, t: f32, sc: f32) -> f32 {
    let q = p * sc;
    let w = vec2f(fbm(q + vec2f(0.0, 0.1 * t), 3, 91u), fbm(q + vec2f(3.1, 1.7) - vec2f(0.08 * t, 0.0), 3, 92u));
    return 0.04 * fbm(q + 1.6 * w, 3, 93u);
}
fn hHammer(p: vec2f, sc: f32, dep: f32) -> f32 {
    let f = vorF1(p * sc, 41u);
    return dep * f * f / sc + 0.0015 * fbm(p * 40.0, 2, 9u);
}
fn hDrape(p: vec2f, t: f32, f: f32) -> f32 {
    let a = p.x * f + 1.3 * sin(p.y * 1.7 + p.x * 2.0 + 0.4 * t) + 1.2 * fbm(p * 1.8 + vec2f(0.0, 0.05 * t), 3, 21u);
    return (0.9 / f) * (sin(a) + 0.35 * sin(2.0 * a + 1.0 + 0.3 * t));
}
// a hex lattice of cones on a mound, the spikes of a ferrofluid
fn hexNear(p: vec2f) -> f32 {
    let s = vec2f(1.0, 1.7320508); let hs = 0.5 * s;
    let a = p - s * floor(p / s) - hs;
    let b = (p - hs) - s * floor((p - hs) / s) - hs;
    return sqrt(min(dot(a, a), dot(b, b)));
}
fn hFerro(p: vec2f, t: f32, dens: f32, pulse: f32) -> f32 {
    let r2 = dot(p, p);
    let mound = exp(-r2 * 10.0);
    let q = rot2(0.1 * t) * p * dens;
    let d = hexNear(q);
    let cone = pow(max(1.0 - d * 1.8, 0.0), 1.6);
    let grow = mix(0.6, 1.0, pulse) * smoothstep(0.02, 0.5, mound);
    return mound * 0.06 + cone * grow * 0.07 * mound;
}

// ── ribbon stack: warped sine folds added per pixel ─────────────────────────
// Each layer is a ribbon along x. Its centerline is two sines, its width
// follows the cosine of a twist angle, so it pinches to a knife edge where
// the ribbon turns side-on. Layers add, so the stack glows.
fn silk(p: vec2f, t: f32, n: i32, amp: f32, wid: f32, twist: f32, haze: f32, seed: f32) -> vec3f {
    var acc = vec3f(0.0);
    let nf = f32(n);
    for (var i: i32 = 0; i < 24; i++) {
        if (i >= n) { break; }
        let fi = f32(i);
        let h = rnd1(fi * 7.31 + seed);
        let h2 = rnd1(fi * 3.17 + seed + 9.0);
        let c = amp * (0.7 * sin(p.x * (2.0 + 1.6 * h) + t * (0.35 + 0.35 * h2) + fi * 0.9)
                     + 0.3 * sin(p.x * (4.5 + 2.0 * h2) - t * 0.5 + fi * 2.1))
              + (fi / max(nf - 1.0, 1.0) - 0.5) * amp * 0.9;
        let th = p.x * (1.2 + 2.2 * h) * twist + t * (0.3 + 0.4 * h2) + fi * 1.7;
        let ct = cos(th);
        let w = wid * (0.06 + 0.94 * abs(ct));
        let dy = p.y - c;
        let body = max(1.0 - (dy / w) * (dy / w), 0.0);
        let sheen = pow(1.0 - abs(ct), 2.0);
        let ed = abs(abs(dy) - w);
        let edge = exp(-ed * ed / 6e-6) * step(0.0, body + 0.01);
        let col = mix(u.tone.rgb, u.cream.rgb, 0.25 + 0.5 * h);
        acc += col * body * (0.05 + 0.1 * h + 0.75 * sheen);
        acc += u.cream.rgb * edge * (0.12 + 0.6 * sheen);
        acc += col * haze * exp(-abs(dy) / 0.03) * 0.04;
    }
    return acc;
}

// ── tubes: a cross-section coordinate s in -1 .. 1 across the tube ──────────
fn tubeShade(s0: f32, d: vec2f, f0: vec3f, spin: f32) -> vec3f {
    let s = clamp(s0, -0.995, 0.995);
    let cz = sqrt(max(1.0 - s * s, 0.0));
    let n = vec3f(d * s, cz);
    var c = chrome(n, f0, spin);
    c *= 0.5 + 0.5 * cz;
    c += u.cream.rgb * 0.45 * exp(-pow((abs(s) - 0.9) * 16.0, 2.0)) * u.glow;
    return c;
}
fn bandMask(s: f32, aa: f32) -> f32 { return smoothstep(1.0, 1.0 - max(aa, 1e-3), abs(s)); }

// ── metaballs: summed field and its analytic gradient ───────────────────────
struct Fld { f: f32, g: vec2f };
fn addBall(o: ptr<function, Fld>, p: vec2f, c: vec2f, r: f32) {
    let d = p - c; let d2 = dot(d, d) + 1e-5;
    (*o).f += r * r / d2;
    (*o).g += -2.0 * r * r * d / (d2 * d2);
}
fn orbitField(p: vec2f, t: f32, n: i32, spread: f32, sz: f32, seed: f32) -> Fld {
    var o: Fld; o.f = 0.0; o.g = vec2f(0.0);
    for (var i: i32 = 0; i < 10; i++) {
        if (i >= n) { break; }
        let fi = f32(i);
        let h = rnd1(fi * 5.3 + seed); let h2 = rnd1(fi * 9.1 + seed + 2.0);
        let c = spread * vec2f(sin(t * (0.3 + 0.5 * h) + fi * 2.4), cos(t * (0.25 + 0.45 * h2) + fi * 1.1 + h * TAU));
        addBall(&o, p, c, sz * (0.6 + 0.6 * h2));
    }
    return o;
}
// the blob surface height is sqrt(F - 1), so the normal turns over at the rim
fn blobN(fd: Fld, S: f32) -> vec3f {
    let h = sqrt(max(fd.f - 1.0, 1e-3));
    return normalize(vec3f(-fd.g / (2.0 * h) * S, 1.0));
}

// ── thin film and backlight ─────────────────────────────────────────────────
// two-beam interference: film index 1.4, thickness d in nanometres. Seven
// wavelengths from 400 to 700 nm, each weighted into rgb by rough gaussian
// color matching lobes, so the colors follow the pastel interference chart.
fn cmf(lam: f32) -> vec3f {
    return vec3f(exp(-pow((lam - 600.0) / 50.0, 2.0)) + 0.3 * exp(-pow((lam - 440.0) / 25.0, 2.0)),
                 exp(-pow((lam - 545.0) / 45.0, 2.0)),
                 exp(-pow((lam - 450.0) / 35.0, 2.0)));
}
// the same film with a free index nf (oxides on metal run near 2.0 .. 2.6)
fn filmN(d: f32, ct: f32, nf: f32) -> vec3f {
    let opd = 2.0 * nf * d * max(ct, 0.2);
    var c = vec3f(0.0); var wsum = vec3f(0.0);
    for (var i: i32 = 0; i < 7; i++) {
        let lam = 400.0 + 50.0 * f32(i);
        let w = cmf(lam);
        c += w * (0.5 - 0.5 * cos(TAU * opd / lam));
        wsum += w;
    }
    return c / wsum * 1.2;
}
fn film(d: f32, ct: f32) -> vec3f { return filmN(d, ct, 1.4); }
// oxide on metal: the film reflects the complement of the two-beam color, so
// a growing oxide runs bare metal, straw, bronze, purple, blue, pale blue and
// then a second order; this is the temper and anodize color sequence. The
// seven-sample lobes make the mid orders too dark, so the hue is kept and the
// brightness is pulled toward 0.8.
fn oxide(d: f32, ct: f32, nf: f32) -> vec3f {
    let o = clamp(vec3f(1.1) - filmN(d, ct, nf) * 0.8, vec3f(0.04), vec3f(1.2));
    let l = dot(o, vec3f(0.3, 0.5, 0.2));
    return o / max(l, 0.05) * mix(l, 0.8, 0.6);
}
// a Bragg stack of period D (optical nm): reflectance peaks where 2 D cos = m lam.
// A higher sharp means more layers and a purer color. The peak moves to blue
// as the surface turns away, so domes go green at the crown, violet at the rim.
fn bragg(D: f32, ct: f32, sharp: f32) -> vec3f {
    var c = vec3f(0.0); var wsum = vec3f(0.0);
    for (var i: i32 = 0; i < 16; i++) {
        let lam = 400.0 + 20.0 * f32(i);
        let w = cmf(lam);
        let x = cos(PI * 2.0 * D * max(ct, 0.15) / lam);
        c += w * pow(x * x, sharp);
        wsum += w;
    }
    return c / wsum * 2.2;
}
// grating equation: a grating of period d (nm) along unit g sends order m of
// wavelength lam where d * (L + V).g = m lam. hv is L + V. Across the grating
// the light must still reflect, so the cross term gates the color.
fn grating(hv: vec3f, g: vec2f, d: f32, tight: f32) -> vec3f {
    let ut = abs(dot(hv.xy, g));
    let ub = dot(hv.xy, vec2f(-g.y, g.x));
    let gate = exp(-ub * ub * tight);
    var c = vec3f(0.0);
    for (var m: i32 = 1; m <= 3; m++) {
        let lam = d * ut / f32(m);
        c += cmf(lam) * smoothstep(380.0, 420.0, lam) * smoothstep(720.0, 680.0, lam) / f32(m);
    }
    return c * gate;
}
// Kajiya-Kay: a strand along tg glints where sin(tg, half vector) is near 1
fn kk(tg: vec3f, l: vec3f, v: vec3f, pw: f32) -> f32 {
    let th = dot(normalize(tg), normalize(l + v));
    return pow(sqrt(max(1.0 - th * th, 0.0)), pw);
}
// hex lattice of unit spacing: q is the offset from the nearest center
struct Hex { q: vec2f, id: vec2f };
fn hexCell(p: vec2f) -> Hex {
    let s = vec2f(1.0, 1.7320508); let hs = 0.5 * s;
    let ia = floor(p / s); let a = p - s * ia - hs;
    let ib = floor((p - hs) / s); let b = p - s * ib - s;
    var o: Hex;
    if (dot(a, a) < dot(b, b)) { o.q = a; o.id = ia * 2.0; } else { o.q = b; o.id = ib * 2.0 + 1.0; }
    return o;
}
// sphere normal for an offset q in a disc of radius r (z toward the viewer).
// Outside the disc it clamps to the rim, so the normal stays unit length: a
// long normal would blow pow(dot(n, h), 220) up to inf, and mix(x, inf, 0)
// is NaN, which paints the whole half-plane black.
fn ballN(q: vec2f, r: f32) -> vec3f {
    let s0 = q / r;
    let l = length(s0);
    let s = select(s0, s0 / max(l, 1e-4), l > 1.0);
    return vec3f(s, sqrt(max(1.0 - dot(s, s), 0.0)));
}
// molten metal emission: dull red, orange, yellow, white as x rises past 1
fn glowRamp(x: f32) -> vec3f {
    let r = smoothstep(0.0, 0.4, x);
    let g = smoothstep(0.2, 0.9, x) * 0.8;
    let b = smoothstep(0.65, 1.3, x) * 0.75;
    return vec3f(r, g, b) * (0.3 + 1.7 * x);
}
// a drifting field of soft colored lights behind glass
fn lightField(p: vec2f, t: f32) -> vec3f {
    var c = u.ink.rgb * 0.7 + u.tone.rgb * 0.05;
    for (var i: i32 = 0; i < 5; i++) {
        let fi = f32(i);
        let q = 0.38 * vec2f(sin(t * (0.21 + 0.07 * fi) + fi * 1.7), cos(t * (0.17 + 0.05 * fi) + fi * 2.9));
        let d = p - q;
        let col = mix(pal(fi * 0.21 + 0.55), u.tone.rgb, 0.45);
        c += col * exp(-dot(d, d) * 16.0) * 0.95;
    }
    c += u.cream.rgb * 0.9 * exp(-pow((p.x * 0.7 + p.y * 0.7 - 0.25 * sin(t * 0.3)) * 8.0, 2.0));
    return c;
}
`;

// finite-difference normal for a height call. call(q) returns WGSL for h(q).
const NRM = (call, S) => `  let e_ = 0.75 * px() + 0.001;
  let h_ = ${call('p')};
  let n = normalize(vec3f(-(${call('(p + vec2f(e_, 0.0))')} - h_) / e_ * ${S}, -(${call('(p + vec2f(0.0, e_))')} - h_) / e_ * ${S}, 1.0));`;

import { CELLS } from './cells.mjs';

// ── emit pack.wgsl ───────────────────────────────────────────────────────────
const frag = ([name, , , , body, pre]) => (pre ? pre.trim() + '\n' : '') +
  `@fragment fn fs_${name}(@builtin(position) fp: vec4f) -> @location(0) vec4f {\n  let p = cuv(fp.xy);\n  let t = u.time + 6.0;\n  let k = u.k;\n${body(NRM)}\n}`;
const pack = HELPERS + `\n// ── the ${CELLS.length} cells ──────────────────────────────────────────────────────────\n` +
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
      map: 'y => Math.pow(2, (y - 0.5) * 4)', unit: "v => (Math.log2(v) >= 0 ? '+' : '') + Math.log2(v).toFixed(1) + ' ev'" },
    { id: 'tempo', title: 'Tempo · hover speed', fn: 'flat', period: 8, amp: 0.0, bias: 0.5, phase: 0,
      map: 'y => 0.1 + 2.9 * y', unit: "v => v.toFixed(2) + 'x'" },
    { id: 'contrast', title: 'Contrast · reflection', fn: 'flat', period: 10, amp: 0.3, bias: 0.5, phase: 0,
      map: 'y => 0.6 + 0.8 * y', unit: "v => v.toFixed(2) + 'x'" },
  ],
  swatches: [
    { id: 'ink', label: 'Void', hex: '#05070b' },
    { id: 'tone', label: 'Metal', hex: '#8fa5c2' },
    { id: 'cream', label: 'Light', hex: '#fff0dc' },
  ],
  // screensaver: calm cells and tempo for the table-engine hook (lib/table-engine.js)
  saver: { cells: ['quicksilver', 'mercury_pool', 'liquid_gold', 'silk_ribbons', 'satin_drape', 'shot_silk', 'cinched_silk', 'chrome_sea', 'molten_river', 'lava_lamp', 'oil_slick', 'soap_bubble', 'orbit_blobs', 'contour_blobs', 'ferro_crown', 'wavy_bands', 'prism_ribbons', 'anodized_ti'], tempo: [1, 0.3], dpr: 1.5 },
};

// ── emit index.html ──────────────────────────────────────────────────────────
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const legend = Object.keys(FAM).map(f => `<span class="f-${f}"><i></i>${f}</span>`).join('');
const tiles = CELLS.map(([name, family, species]) =>
  `<div class="cell f-${family}" role="button" tabindex="0" id="tile-${name}" aria-label="${esc(name + ': ' + species)}"><canvas></canvas><span class="orb-status"></span><span class="tag">${name.replace(/_/g, ' ')}</span></div>`).join('');
const swatchHtml = spec.swatches.map(s => `<label class="swatch"><span>${s.label}</span><input type="color" id="sw-${s.id}" value="${s.hex}"></label>`).join('');

const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Liquid Metal Table // Stella Nova</title>
<!--
  ════════════════════════════════════════════════════════════════════════════
   LIQUID METAL TABLE  ·  page shell (GENERATED by build.mjs — do not edit by hand)
  ────────────────────────────────────────────────────────────────────────────
   Static markup only. main.js loads the data and hands it to the shared
   table-engine, which builds the sidebar and the frame loop and drives page.js.
   ${CELLS.length} chrome, ribbon, band, blob, cell, glass, alloy, fluid, machined,
   textile, iridescent and kinetic effects, one fragment shader per cell, all
   lit by one procedural studio.
  ════════════════════════════════════════════════════════════════════════════
-->
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=JetBrains+Mono:wght@300;400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="style.css">
</head>
<body>

<script>if(window!==window.top)document.documentElement.classList.add("in-frame")</script>
<div class="grid-bg"></div>
<div class="topbar">
  <div class="topbar-l"><span class="sys-name">Stella Nova</span><span class="sys-status">Liquid Metal Table</span></div>
  <div class="topbar-r">SYS // <strong>WGSL SHADER LAB</strong></div>
</div>
<div id="side">
  <div class="side-head"><div class="big">metal</div><div class="sub">|${CELLS.length} surfaces · ${Object.keys(FAM).length} families⟩</div></div>
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
//  LIQUID METAL TABLE  ·  main.js — data load and boot (the entry module, GENERATED)
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
//  LIQUID METAL TABLE  ·  page.js — the per-page PAGE object (GENERATED)
// ────────────────────────────────────────────────────────────────────────────
//  ${CELLS.length} metal, glass, fabric and film surfaces; one fragment shader per cell, each reading
//  only a shared uniform buffer (no pointer, no texture). The shared
//  table-engine drives this object through its ctx. main.js fetches the data
//  and calls bootTable(PAGE, data); the engine calls PAGE.init and PAGE.draw.
//
//  UNIFORM LAYOUT (96 bytes, matches struct MetalU in shaders/pack.wgsl)
//    0..1 size · 2 time · 3 pixelScale · 4..7 ink · 8..11 tone · 12..15 cream
//    16 exposure · 17 contrast · 18 glow · 19 pad · 20..23 k (four knobs)
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

// ── emit style.css (clone color-table, append the metal families) ────────────
const famCss = Object.entries(FAM).map(([f, c]) =>
  `.f-${f}{--fam:${c};--fam-bg:${c.replace(/[\d.]+\)$/, '0.06)')}}`).join('\n');
const baseCss = readFileSync(join(DIR, '..', 'color-table', 'style.css'), 'utf8');
const css = baseCss + `
/* ── metal families (appended by build.mjs) ──────────────────────────────── */
${famCss}
.side-head .big{color:#c9d6e8}
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
for (const [, f] of CELLS) fam[f] = (fam[f] || 0) + 1;
console.log('cells       : ' + CELLS.length);
console.log('families    : ' + JSON.stringify(fam));
console.log('fs_ entries : ' + (pack.match(/@fragment fn fs_/g) || []).length);
console.log('names unique: ' + (new Set(CELLS.map(c => c[0])).size === CELLS.length));
console.log('wrote pack.wgsl, spec.json, index.html, main.js, page.js, style.css');
