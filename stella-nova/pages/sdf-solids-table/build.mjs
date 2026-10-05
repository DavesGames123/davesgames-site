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
//    push every cell at once. Glass looks through envT, the same studio with
//    a lit back wall and a floor bounce, so clear glass reads clear. Standing
//    solids sit on stageFloor and take a soft shadow from the key softbox.
//
//  FILES
//    build.mjs ......... this generator: helpers, templates, page shell
//    cells.mjs ......... the body builders and the first six families
//    cells-forms.mjs ... primitives, operators, materials, lathe
//    cells-worlds.mjs .. mechanisms, fractals, organic, scenes
//
//  TEMPLATES
//    WGSL has no function pointers, so this script stamps the shared tracer
//    once per map: march_<m>, nrm_<m>, thru_<m>, ao_<m>, glass_<m> and shd_<m>.
//    Only the templates a cell calls are emitted (glass pulls thru and nrm).
//    Step caps: 64 for march, 40 for thru, 32 for shd, 5 taps for ao.
//
//  GREP MAP (pack.wgsl)
//    struct SolidU ..... the shared uniform block
//    fn suv/camO/camD .. pixel to uv, the shared camera
//    fn gnoise/fbm3 .... 3D gradient noise   ·  fn worley2 .. F1/F2 cells
//    fn smin/smax/rbox . smooth union and intersection, rounded box
//    fn sdTorus/sdCyl/sdCapsule/sdTrap/sdEllipsoid/extrude/pmod .. primitives
//    fn env/envDiff .... the studio and its diffuse lobes
//    fn envT ........... the studio as glass sees it
//    fn envDiffS/envRough/dielectric/metal .. shadowed and rough shading
//    fn stageFloor ..... the floor under standing solids
//    fn ghostSph/ghostBox .. operand outlines for the operator cells
//    fn film ........... thin-film interference   ·  fn schlick .. Fresnel
//    fn chrome/plastic . surface shaders          ·  fn finish ... tone map
//    fn march_<m> ...... sphere tracer   ·  fn nrm_<m> .... tetrahedron normal
//    fn thru_<m> ....... inside path     ·  fn glass_<m> .. dispersive glass
//    fn shd_<m> ........ soft shadow     ·  fn ao_<m> ..... five-tap occlusion
//    @fragment fs_* .... one entry per cell, in legend order
// ============================================================================
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CELLS_CORE } from './cells.mjs';
import { CELLS_FORMS } from './cells-forms.mjs';
import { CELLS_WORLDS } from './cells-worlds.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));

// ── families (legend order) ─────────────────────────────────────────────────
const FAM = {
  glass:    'rgba(150,215,255,0.15)',
  chrome:   'rgba(210,215,225,0.13)',
  blobs:    'rgba(255,160,90,0.14)',
  film:     'rgba(210,140,255,0.15)',
  interior: 'rgba(110,150,255,0.15)',
  emissive: 'rgba(255,110,170,0.15)',
  primitives: 'rgba(255,205,120,0.15)',
  operators: 'rgba(120,235,200,0.14)',
  materials: 'rgba(200,170,130,0.15)',
  lathe:    'rgba(240,235,225,0.13)',
  mechanisms: 'rgba(170,190,210,0.15)',
  fractals: 'rgba(255,130,110,0.15)',
  organic:  'rgba(140,220,120,0.15)',
  scenes:   'rgba(120,200,255,0.15)',
};

// ── the WGSL helper library (shared by every cell) ──────────────────────────
const HELPERS = `// ═══════════════════════════════════════════════════════════════════════════
//  SDF SOLIDS TABLE  ·  one fragment shader per cell, a sphere-traced solid
//  each. Every cell reads uv, the hover clock t, four knobs k and the camera
//  ray, then returns finish(color, uv). One procedural studio, fn env, lights
//  all cells and takes its tint from the ink, tone and cream swatches.
//  Sphere tracing after Hart 1996; distance primitives, smooth-min, the
//  tetrahedron normal, domain warping, the primitive catalog (box frame, hex
//  prism, link, octahedron, capped cone, rounded cylinder, death star, solid
//  angle, pyramid, ellipsoid), the operators (smooth min, onion, twist, bend,
//  limited repetition, elongation) and soft shadows after Quilez; Fresnel
//  after Schlick 1994; refraction by Snell's law with a three-index split for
//  dispersion; thin-film color from two-beam interference; gradient noise
//  after Perlin (pcg3d hashing, Jarzynski and Olano 2020); cells after Worley
//  1996; the Menger sponge and Apollonian packing after Quilez; the Sierpinski
//  fold after Knighty and Syntopia; the Mandelbox after Lowe 2010; the
//  quaternion Julia bound after Hart, Sandin and Kauffman 1989. The studio,
//  the cell layouts and the shading are original.
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

// ── more distance primitives and operators (after Quilez) ───────────────────
fn sdBox2(p: vec2f, b: vec2f) -> f32 { let d = abs(p) - b; return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0); }
fn sdTorus(p: vec3f, R: f32, r: f32) -> f32 { return length(vec2f(length(p.xz) - R, p.y)) - r; }
// capped cylinder on the y axis: half height h, radius r
fn sdCyl(p: vec3f, h: f32, r: f32) -> f32 {
    let d = abs(vec2f(length(p.xz), p.y)) - vec2f(r, h);
    return min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0)));
}
fn sdCapsule(p: vec3f, a: vec3f, b: vec3f, r: f32) -> f32 {
    let pa = p - a; let ba = b - a;
    let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
}
fn sdSeg2(p: vec2f, a: vec2f, b: vec2f) -> f32 {
    let pa = p - a; let ba = b - a;
    return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}
// 2D trapezoid (a capped cone in profile): bottom radius r1, top r2, half height he
fn sdTrap(p0: vec2f, r1: f32, r2: f32, he: f32) -> f32 {
    let k1 = vec2f(r2, he);
    let k2 = vec2f(r2 - r1, 2.0 * he);
    let p = vec2f(abs(p0.x), p0.y);
    let ca = vec2f(p.x - min(p.x, select(r2, r1, p.y < 0.0)), abs(p.y) - he);
    let cb = p - k1 + k2 * clamp(dot(k1 - p, k2) / dot(k2, k2), 0.0, 1.0);
    let s = select(1.0, -1.0, cb.x < 0.0 && ca.y < 0.0);
    return s * sqrt(min(dot(ca, ca), dot(cb, cb)));
}
fn sdEllipsoid(p: vec3f, r: vec3f) -> f32 {
    let k0 = length(p / r); let k1 = length(p / (r * r));
    return k0 * (k0 - 1.0) / max(k1, 1e-5);
}
// extrude a 2D distance d2 along z to half depth h
fn extrude(d2: f32, z: f32, h: f32) -> f32 {
    let w = vec2f(d2, abs(z) - h);
    return min(max(w.x, w.y), 0.0) + length(max(w, vec2f(0.0)));
}
fn smax(a: f32, b: f32, k: f32) -> f32 { return -smin(-a, -b, k); }
// fold a 2D point into the first of n equal sectors around the origin
fn pmod(p: vec2f, n: f32) -> vec2f {
    let s = TAU / n;
    let b = (fract(atan2(p.y, p.x) / s + 0.5) - 0.5) * s;
    return length(p) * vec2f(cos(b), sin(b));
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
// the broad lobes with the key lobe dimmed by a shadow term sh (1 = lit)
fn envDiffS(n: vec3f, sh: f32) -> vec3f {
    return envDiff(n) - cCream() * 0.95 * u.studio * max(dot(n, normalize(KEY)), 0.0) * (1.0 - sh);
}
// a rough reflection: blend the sharp studio toward its broad lobes
fn envRough(r: vec3f, rough: f32) -> vec3f { return mix(env(r), envDiff(r) * 1.3, rough); }
// a coated dielectric: albedo alb, roughness rough, occlusion occ, shadow sh
fn dielectric(rd: vec3f, n: vec3f, alb: vec3f, rough: f32, occ: f32, sh: f32) -> vec3f {
    let f = schlick(clamp(-dot(rd, n), 0.0, 1.0), 0.04) * (1.0 - 0.6 * rough);
    return (envDiffS(n, sh) * alb * (1.0 - f) + envRough(reflect(rd, n), rough) * f * mix(0.4, 1.0, sh)) * occ;
}
// a conductor: the reflection takes the tint, white at grazing angles
fn metal(rd: vec3f, n: vec3f, tint: vec3f, rough: f32, occ: f32) -> vec3f {
    let f = schlick(clamp(-dot(rd, n), 0.0, 1.0), 0.0);
    return (envRough(reflect(rd, n), rough) * mix(tint, vec3f(1.0), f * (1.0 - rough)) + envDiff(n) * tint * 0.12) * occ;
}
// the pale studio floor under a standing solid: lit by the room and the key,
// darkened by the shadow sh and the contact term occ, faded into the room
fn stageFloor(rd: vec3f, pf: vec3f, sh: f32, occ: f32) -> vec3f {
    let s = u.studio;
    let base = mix(vec3f(0.30), cCream() * 0.42, 0.5);
    let pool = 0.55 + 0.75 * exp(-dot(pf.xz, pf.xz) * 0.22);
    let amb = cInk() * 2.4 + cCream() * 0.14 * s + cTone() * 0.03 * s;
    let key = cCream() * 0.6 * s * sh;
    var c = base * (amb + key) * pool * occ;
    c += env(reflect(rd, vec3f(0.0, 1.0, 0.0))) * 0.04 * occ;
    return mix(c, backdrop(rd), smoothstep(3.5, 9.0, length(pf.xz)));
}
// ghost operands for the operator cells: a rim glow where the ray crosses a
// sphere (center c, radius r), dimmed past tmax (behind the solid)
fn ghostSph(ro: vec3f, rd: vec3f, c: vec3f, r: f32, tmax: f32) -> f32 {
    let hs = sphHit(ro - c, rd, r);
    if (hs.y < 0.0) { return 0.0; }
    var g = 0.0;
    for (var s = 0; s < 2; s++) {
        let th = select(hs.x, hs.y, s == 1);
        if (th > 0.0) {
            let n = normalize(ro + rd * th - c);
            g += (pow(1.0 - abs(dot(n, rd)), 5.0) + 0.04) * select(1.0, 0.25, th > tmax);
        }
    }
    return g;
}
// the twelve edges of a box (half size b) for a ray o, d already in box space
fn ghostBox(o: vec3f, d: vec3f, b: vec3f, tmax: f32) -> f32 {
    let dd = select(d, vec3f(1e-5), abs(d) < vec3f(1e-5));
    let t1 = (-b - o) / dd; let t2 = (b - o) / dd;
    let tn = max(max(min(t1.x, t2.x), min(t1.y, t2.y)), min(t1.z, t2.z));
    let tf = min(min(max(t1.x, t2.x), max(t1.y, t2.y)), max(t1.z, t2.z));
    if (tn > tf || tf < 0.0) { return 0.0; }
    var g = 0.0;
    for (var s = 0; s < 2; s++) {
        let th = select(tn, tf, s == 1);
        if (th > 0.0) {
            let e = b - abs(o + d * th);
            let mid = e.x + e.y + e.z - min(e.x, min(e.y, e.z)) - max(e.x, max(e.y, e.z));
            g += (smoothstep(0.03, 0.0, mid) + 0.03) * select(1.0, 0.25, th > tmax);
        }
    }
    return g;
}
// what glass sees through itself: the studio plus a lit back wall and a
// bright floor bounce, so clear glass reads clear and not as the dark room
fn envT(d0: vec3f) -> vec3f {
    let d = normalize(d0);
    let s = u.studio;
    var c = env(d);
    let wall = smoothstep(-0.35, 0.25, d.y) * (1.0 - smoothstep(0.55, 0.95, d.y));
    c += mix(cCream(), cTone(), 0.3) * 0.5 * s * wall * (0.35 + 0.65 * max(-d.z, 0.0));
    if (d.y < 0.0) {
        let q = d.xz / max(-d.y, 0.05);
        c += cCream() * s * (0.3 * smoothstep(0.0, -0.5, d.y) + 1.3 * exp(-dot(q, q) * 5.0));
    }
    return c;
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
    var col = envT(reflect(rd0, n0)) * max(fr, 0.07) * 1.3;
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
            let rf = envT(reflect(dir, ne));
            let er = refract(dir, ne, ior - spread);
            let eb = refract(dir, ne, ior + spread);
            let cr = select(rf.r, envT(er).r, dot(er, er) > 0.0);
            let cg = select(rf.g, envT(eg).g, dot(eg, eg) > 0.0);
            let cb = select(rf.b, envT(eb).b, dot(eb, eb) > 0.0);
            return col + thr * vec3f(cr, cg, cb);
        }
        dir = reflect(dir, ne);
        pos += ne * 0.004;
    }
    return col;
}`,
  shd: m => `// soft shadow of map_${m} toward the light l (after Quilez)
fn shd_${m}(p: vec3f, l: vec3f) -> f32 {
    var res = 1.0; var t = 0.02;
    for (var i = 0; i < 32; i++) {
        let d = map_${m}(p + l * t);
        res = min(res, 6.0 * d / t);
        t += clamp(d, 0.02, 0.3);
        if (res < 0.005 || t > 4.0) { break; }
    }
    return clamp(res, 0.0, 1.0);
}`,
};
const DEPS = { glass: ['thru', 'nrm'] };

// ── the cells (cells.mjs, cells-forms.mjs, cells-worlds.mjs) ────────────────
const CELLS = [...CELLS_CORE, ...CELLS_FORMS, ...CELLS_WORLDS];

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
const pack = HELPERS + `\n// ── the ${CELLS.length} cells ─────────────────────────────────────────────────────────────\n` +
  CELLS.map(c => `\n// ── ${c[name_]} (${c[fam_]}) ──\n` + [c[decl_], stamp(c), frag(c)].filter(Boolean).join('\n')).join('\n') + '\n';

// ── saver plate equations ───────────────────────────────────────────────────
// SAVER_EQ[name] goes into spec.json as cell.eq. The table-engine sends it to
// the screensaver plate (lib/table-engine.js, saverLabel). Plain Unicode text,
// written from the cell bodies above.
// Every solid is sphere traced: t += d(ro + t·rd) until d < 0.0008·t, at
// most 64 steps. smin(a, b, k) = mix(b, a, h) − k·h(1 − h), h = clamp(½ + (b − a)/2k).
const TRACE = 'sphere trace: t += d(ro + t·rd),  hit at d < 0.0008t';
const FILM = 'film: I = ½ + ½ cos(2π·2η·h·cos θₜ/λ + π),  λ = 650, 532, 450';
const SAVER_EQ = {
  lava_lamp: ['wax d = smin over 5 balls of r = 0.14 + 0.05 sin 2.3i,  k = 0.24', 'ball yᵢ = −0.2 − 0.72 cos(τ(0.34 + 0.07i) + 2.1i)', 'τ = (0.35…1.2)·t,  vessel r = 0.5 − 0.1y', TRACE],
  soap_bubble: ['film thickness h = (150…950)·(0.6 + 0.7 fbm(2.3q)) + (0…900)·drain', 'q = R_y(swirl·n_y + 0.35t)·n,  η = 1.33,  both walls', 'Fresnel = 0.06 + 0.94(1 − cos θ)³', FILM],
  nebula_orb: ['refract in at η = 1.45,  24 steps through the orb', 'σ = max(fbm(1.7q + warp·∇noise) + 0.08, 0)·(1.5…6)', 'C += T·emission·σ·Δs,  T *= e^(−0.9σΔs)'],
  mercury: ['body = 0.8(|(x, 1.25(y + 0.3), z)| − 0.52) + w·sin 5x·sin 4.3z·sin 4y', 'pool ripple = 0.018·(0…2)·sin(16r − 5t)·e^(−1.2r)', 'd = smin(smin(pool, body, 0.3), min(drop₁, drop₂), 0.2)', TRACE],
  oil_drops: ['d = smin over 5 drops, r = 0.36 − 0.04i,  k = 0.1…0.45 (fusion)', 'cᵢ = (0.55 cos(wᵢt + 1.3i), 0.45 sin(…), 0.35 sin(wᵢt + 1.3i)),  wᵢ = 0.45 + 0.13i', 'dispersive glass: η − s, η, η + s for R, G, B'],
  wine_glass: ['bowl: ellipse (q_x/0.46, (q_y − 0.18)/0.62) shell 0.011 thick', 'wine level y = (−0.25…0.25) + (0…0.1)·sin 1.6t·(0.8x + 0.3z)', 'light refracts in and out of each wall,  the wine absorbs'],
  hourglass: ['f = fract((0.02…0.1)·t + 0.45)  (fraction drained)', 'top sand level = mix(0.62, 0.04, f),  bottom cone = mix(−0.78, −0.24, √f)', 'two ellipsoid bulbs (0.4, 0.38, 0.4) joined by smin 0.1'],
  spinning_top: ['spin φ = (1…9)·t,  precession ψ = 1.1t', 'tilt θ = 0.05…0.35 + 0.03 sin 5t  (nutation)', 'body = smin(cone, ellipsoid, stem, knob)'],
  gear_train: ['N = 14, 9, 7 teeth,  R = 0.56, 0.36, 0.28', 'θ_B = −(14/9)θ_A + c,  θ_C = −(9/7)θ_B + c′', 'θ_A = (0.2…1.4)·t'],
  ball_bearing: ['10 balls r = 0.12 in a groove of radius 0.128 at r = 0.62', 'shaft key turns at ω = (0.3…2)·t,  balls and cage at 0.4ω', 'races: inner at r = 0.45,  outer at r = 0.85'],
  borromean: ['ring = |(|e_xz| − 0.3, e_y)| − r,  e = q − clamp(q_x, −h, h)x̂', 'three rings in the xz, yx and zy planes', 'r = 0.05…0.11 (tube),  h = 0.38…0.6 (stretch)'],
  rainbow_knot: ['(2, Q) torus knot: s = (θ + 2πi)/2', 'core at (0.6 + 0.3 cos Qs,  0.3 sin Qs),  Q = 3, 5, 7', 'glow = 30e^(−d²/w²) + 0.8e^(−14d),  hue = fract(s/2π − v·t)'],
  gyroid_core: ['g = (sin q·cos q_zxy)/s,  q = s·p + (0, 0.4t, 0)', 'd = min(max(|p| − 0.95, 0.6(|g| − w)), |p| − 0.36)', 's = 3…6.5 (cells),  w = 0.025…0.08 (sheet)'],
  morph_solid: ['d = mix(shapeᵢ, shapeᵢ₊₁, smoothstep(0.2, 0.8, fract s))', 's = 4·fract((0.05…0.25)·t + 0.6)', 'cube → sphere → octahedron → torus'],
  marble_pair: ['vein = (1 − |sin(f·(0.6, 1, 0.3)·q′)|)¹⁴', 'q′ = q + 0.9·(fbm(1.3q), fbm(1.3q + 7), fbm(1.3q + 13))', 'f = 2…5 (veins)'],
  teacup: ['lathe profile: segments in (r, y) around the y axis', 'tea level y = 0,  steam: three fbm wisps over 12 steps', 'cup turns at 0.3t'],
  plasma_ring: ['ring = e^(−|b − R|/w),  b = ray distance from the center,  R = 0.85', 'w = (0.012…0.05)·(0.6 + 1.2·max(fbm + 0.3, 0))', 'grid lines × (1 − |n·v|)^(1.5…5)  (silhouette)'],
  iris_blob: ['d = 0.75(|p| − 0.78 − (0.05…0.3)·noise(1.7p + 0.2t))', 'film h = 280…560 nm + 120·noise(2p),  η = 1.6', FILM],
};

// ── emit spec.json ───────────────────────────────────────────────────────────
const spec = {
  cols: 6,
  uniform_bytes: 96,
  cells: CELLS.map(c => ({
    name: c[name_], family: c[fam_], species: c[sp_], knobs: c[kn_],
    defaults: (c[opt_] && c[opt_].def) || [0.5, 0.5, 0.5, 0.5],
    fn: 'fs_' + c[name_],
    ...(SAVER_EQ[c[name_]] ? { eq: SAVER_EQ[c[name_]] } : {}),
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
  // screensaver: calm cells and tempo for the table-engine hook (lib/table-engine.js)
  saver: { cells: ['lava_lamp', 'soap_bubble', 'nebula_orb', 'mercury', 'oil_drops', 'wine_glass', 'hourglass', 'spinning_top', 'gear_train', 'ball_bearing', 'borromean', 'rainbow_knot', 'gyroid_core', 'morph_solid', 'marble_pair', 'teacup', 'plasma_ring', 'iris_blob'], tempo: [1, 0.35], dpr: 1, warmup: 1200 },
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
<link href="../../vendor/fonts/cormorant-garamond+jetbrains-mono.4dfdb2d4.css" rel="stylesheet">
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
//  loop; page.js owns the GPU work. saver.js is the screensaver (hand written,
//  not generated). Regenerate with: node build.mjs
// ============================================================================
import { bootTable } from '../../lib/table-engine.js';
import { loadShaders } from '../../lib/shaders.js';
import { PAGE } from './page.js';
import { SAVER } from './saver.js';

const SH = await loadShaders(import.meta.url, ['shaders/pack.wgsl']);
const spec = await (await fetch(new URL('spec.json', import.meta.url))).json();

// The build-up screensaver (saver.js) takes the GPU device from PAGE.init.
// install() runs after bootTable defines the engine's one-cell hook, so its
// window.snSaver replaces that hook. The table itself does not change.
const page = Object.create(PAGE);
page.init = function (ctx) { SAVER.setCtx(ctx); return PAGE.init.call(this, ctx); };
bootTable(page, { spec, pack: SH['shaders/pack.wgsl'] });
SAVER.install();
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
