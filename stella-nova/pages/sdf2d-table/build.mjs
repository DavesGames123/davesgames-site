// ============================================================================
//  SDF 2D TABLE  ·  build.mjs — the single source of truth for the page
// ────────────────────────────────────────────────────────────────────────────
//  One generator emits every file the page needs, so the cell names, the WGSL
//  entry points and the tile divs cannot drift apart. Run it with:
//      node build.mjs
//  It writes shaders/pack.wgsl, spec.json, page.js, main.js, index.html and
//  style.css into this folder. The shared table-engine drives the result; it
//  renders one fragment entry point fs_<name> per tile from a shared uniform.
//
//  MODEL
//    Every cell is a 2D signed distance field. A cell body reads p (the plane
//    point, y up, 1.0 = half of the short side), w (one device pixel in plane
//    units), t (the hover clock) and k (four knobs), then returns
//    present(color, p). fieldCol(d, w) is the shared distance view: the ink,
//    tone and cream swatches color the outside, the inside and the zero line,
//    so the palette pickers push every cell at once. The "Iso lines" signal
//    sets the band density of that view.
//
//  EXTRA FUNCTIONS
//    WGSL has no function pointers. A cell that needs a scene more than once
//    (a gradient, a march, an ambient-occlusion ring) declares its scene as a
//    top-level function in the sixth field of its row. The inspector finds it
//    through the call graph.
//
//  CREDITS
//    The exact 2D distance functions, the smooth minimum variants and the
//    domain operators follow Inigo Quilez (iquilezles.org, articles
//    "2D distance functions", "smooth minimum" and "domain repetition").
//    Sphere tracing after Hart 1996. Multi-channel distance after Chlumsky
//    2015. Soft shadows after the min(k h / t) penumbra estimate (Quilez).
//    The cell scenes, the glyphs, the icons and the coloring are original.
//
//  GREP MAP (pack.wgsl)
//    struct SdfU ....... the shared uniform block
//    fn suv / fn pxw ... pixel to plane, one pixel in plane units
//    fn fieldCol ....... the shared distance view   ·  fn present .. finish
//    fn ramp ........... ink to tone to cream ramp  ·  fn fill/stroke  coverage
//    fn sd<Name> ....... the primitive library      ·  fn smin* .... blends
//    fn op* ............ booleans and repetition    ·  fn glyph* ... letters
//    @fragment fs_* .... the cells
// ============================================================================
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));

// ── families (legend order) ─────────────────────────────────────────────────
const FAM = {
  primitives: 'rgba(120,160,255,0.15)',
  visualise:  'rgba(255,214,160,0.14)',
  operators:  'rgba(150,230,210,0.14)',
  rendering:  'rgba(255,150,120,0.14)',
  glyphs:     'rgba(210,170,255,0.15)',
};

// ── the WGSL helper library (shared by every cell) ──────────────────────────
const HELPERS = `// ═══════════════════════════════════════════════════════════════════════════
//  SDF 2D TABLE  ·  one fragment shader per cell, a 2D signed distance field
//  each. A cell reads p (plane point, y up), w (one pixel in plane units), the
//  hover clock t and four knobs k, then returns present(color, p). fieldCol
//  is the shared distance view; the ink, tone and cream swatches color it.
//  Exact distance functions, smooth minimum and domain operators after Inigo
//  Quilez; sphere tracing after Hart 1996; multi-channel distance after
//  Chlumsky 2015. Scenes, glyphs, icons and coloring are original.
// ═══════════════════════════════════════════════════════════════════════════
const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.283185307179586;

struct SdfU {
    size: vec2f, time: f32, pixelScale: f32,
    ink: vec4f, tone: vec4f, cream: vec4f,
    exposure: f32, lines: f32, glow: f32, pad1: f32,
    k: vec4f,
};
@group(0) @binding(0) var<uniform> u: SdfU;

@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var v = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(v[i], 0.0, 1.0);
}

// pixel to plane: centered, y up, 1.0 = half of the short side
fn suv(fp: vec2f) -> vec2f {
    let s = u.size * u.pixelScale;
    let n = (2.0 * fp - s) / max(min(s.x, s.y), 1.0);
    return vec2f(n.x, -n.y);
}
// one device pixel in plane units
fn pxw() -> f32 { return 2.0 / max(min(u.size.x, u.size.y) * u.pixelScale, 1.0); }

// ── small math ──────────────────────────────────────────────────────────────
fn dot2(v: vec2f) -> f32 { return dot(v, v); }
fn ndot(a: vec2f, b: vec2f) -> f32 { return a.x * b.x - a.y * b.y; }
fn rot(a: f32) -> mat2x2f { let c = cos(a); let s = sin(a); return mat2x2f(c, s, -s, c); }
fn cs(a: f32) -> vec2f { return vec2f(sin(a), cos(a)); }
fn hash21(p: vec2f) -> f32 { var q = fract(p * vec2f(123.34, 456.21)); q += dot(q, q + 45.32); return fract(q.x * q.y); }
fn fill(d: f32, w: f32) -> f32 { return 1.0 - smoothstep(-0.5 * w, 0.5 * w, d); }
fn stroke(d: f32, r: f32, w: f32) -> f32 { return fill(abs(d) - r, w); }

// ── color ───────────────────────────────────────────────────────────────────
// ink -> tone -> cream -> white
fn ramp(x: f32) -> vec3f {
    let v = clamp(x, 0.0, 1.0);
    let a = mix(u.ink.rgb, u.tone.rgb, smoothstep(0.0, 0.5, v));
    let b = mix(a, u.cream.rgb, smoothstep(0.42, 0.86, v));
    return mix(b, vec3f(1.0), smoothstep(0.86, 1.0, v) * 0.55);
}
fn hot() -> vec3f { return mix(u.cream.rgb, vec3f(1.0), 0.6); }

// The shared distance view. Outside fades from tone into ink with distance,
// inside glows cream; a dark gap hugs the edge, soft bands mark the distance,
// a crisp major line sits every fourth band and the zero line is near white.
fn fieldCol(d: f32, w: f32) -> vec3f {
    let a = abs(d);
    let f = max(u.lines, 1.0);
    let outer = mix(u.ink.rgb, u.tone.rgb, 0.16 + 0.84 * exp(-1.9 * a)) * (1.0 - 0.72 * exp(-a * f * 0.55));
    let deep = mix(u.ink.rgb, u.cream.rgb, 0.42);
    let inner = mix(u.cream.rgb * 0.96, deep, smoothstep(0.0, 0.4, a)) * (1.0 - 0.55 * exp(-a * f * 1.3));
    var col = select(outer, inner, d < 0.0);
    col *= select(0.80 + 0.20 * cos(TAU * f * d), 0.90 + 0.10 * cos(TAU * f * d), d < 0.0);
    let m = abs(fract(d * f * 0.25 + 0.5) - 0.5) * 4.0 / f;
    col = mix(col, min(col * 1.7 + 0.05, vec3f(1.0)), (1.0 - smoothstep(0.4 * w, 1.4 * w, m)) * 0.45);
    col += u.cream.rgb * 0.22 * exp(-a * 22.0) * u.glow;
    col = mix(col, hot(), 1.0 - smoothstep(0.5 * w, 1.6 * w, a));
    return col;
}
// a thin outline of another field, laid over a color
fn ghost(col: vec3f, d: f32, w: f32, c: vec3f, a: f32) -> vec3f { return mix(col, c, stroke(d, 0.6 * w, w) * a); }
// a disc marker
fn dotc(col: vec3f, p: vec2f, c: vec2f, r: f32, w: f32, k: vec3f) -> vec3f { return mix(col, k, fill(length(p - c) - r, w)); }

fn present(c: vec3f, p: vec2f) -> vec4f {
    var col = c * u.exposure;
    col *= 1.0 - 0.10 * dot(p, p);
    col = col / (1.0 + 0.25 * max(col - vec3f(0.8), vec3f(0.0)));
    col += (hash21(p * 913.7 + u.time) - 0.5) / 255.0;
    return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}

// ── exact 2D distance functions (after Quilez) ──────────────────────────────
fn sdCircle(p: vec2f, r: f32) -> f32 { return length(p) - r; }
fn sdBox(p: vec2f, b: vec2f) -> f32 {
    let d = abs(p) - b;
    return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0);
}
// r = radii of the corners (x: top right, y: bottom right, z: top left, w: bottom left)
fn sdRoundBox(p: vec2f, b: vec2f, r: vec4f) -> f32 {
    let rr = select(r.zw, r.xy, p.x > 0.0);
    let rad = select(rr.y, rr.x, p.y > 0.0);
    let q = abs(p) - b + rad;
    return min(max(q.x, q.y), 0.0) + length(max(q, vec2f(0.0))) - rad;
}
fn sdOrientedBox(p: vec2f, a: vec2f, b: vec2f, th: f32) -> f32 {
    let l = length(b - a);
    let d = (b - a) / l;
    var q = p - (a + b) * 0.5;
    q = vec2f(d.x * q.x + d.y * q.y, -d.y * q.x + d.x * q.y);
    q = abs(q) - vec2f(l, th) * 0.5;
    return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0);
}
fn sdSegment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
    let pa = p - a; let ba = b - a;
    let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}
fn sdRhombus(p0: vec2f, b: vec2f) -> f32 {
    let p = abs(p0);
    let h = clamp(ndot(b - 2.0 * p, b) / dot(b, b), -1.0, 1.0);
    let d = length(p - 0.5 * b * vec2f(1.0 - h, 1.0 + h));
    return d * sign(p.x * b.y + p.y * b.x - b.x * b.y);
}
fn sdTrapezoid(p0: vec2f, r1: f32, r2: f32, he: f32) -> f32 {
    let k1 = vec2f(r2, he);
    let k2 = vec2f(r2 - r1, 2.0 * he);
    let p = vec2f(abs(p0.x), p0.y);
    let ca = vec2f(p.x - min(p.x, select(r2, r1, p.y < 0.0)), abs(p.y) - he);
    let cb = p - k1 + k2 * clamp(dot(k1 - p, k2) / dot2(k2), 0.0, 1.0);
    let s = select(1.0, -1.0, cb.x < 0.0 && ca.y < 0.0);
    return s * sqrt(min(dot2(ca), dot2(cb)));
}
fn sdParallelogram(p0: vec2f, wi: f32, he: f32, sk: f32) -> f32 {
    let e = vec2f(sk, he);
    var p = select(p0, -p0, p0.y < 0.0);
    var w = p - e; w.x -= clamp(w.x, -wi, wi);
    var d = vec2f(dot(w, w), -w.y);
    let s = p.x * e.y - p.y * e.x;
    p = select(p, -p, s < 0.0);
    var v = p - vec2f(wi, 0.0); v -= e * clamp(dot(v, e) / dot(e, e), -1.0, 1.0);
    d = min(d, vec2f(dot(v, v), wi * he - abs(s)));
    return sqrt(d.x) * sign(-d.y);
}
fn sdEquilateralTriangle(p0: vec2f, r: f32) -> f32 {
    let k = sqrt(3.0);
    var p = vec2f(abs(p0.x) - r, p0.y + r / k);
    if (p.x + k * p.y > 0.0) { p = vec2f(p.x - k * p.y, -k * p.x - p.y) / 2.0; }
    p.x -= clamp(p.x, -2.0 * r, 0.0);
    return -length(p) * sign(p.y);
}
// apex at the origin, base at y = q.y, half width q.x
fn sdTriangleIsosceles(p0: vec2f, q: vec2f) -> f32 {
    let p = vec2f(abs(p0.x), p0.y);
    let a = p - q * clamp(dot(p, q) / dot(q, q), 0.0, 1.0);
    let b = p - q * vec2f(clamp(p.x / q.x, 0.0, 1.0), 1.0);
    let s = -sign(q.y);
    let d = min(vec2f(dot(a, a), s * (p.x * q.y - p.y * q.x)), vec2f(dot(b, b), s * (p.y - q.y)));
    return -sqrt(d.x) * sign(d.y);
}
fn sdTriangle(p: vec2f, p0: vec2f, p1: vec2f, p2: vec2f) -> f32 {
    let e0 = p1 - p0; let e1 = p2 - p1; let e2 = p0 - p2;
    let v0 = p - p0; let v1 = p - p1; let v2 = p - p2;
    let pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
    let pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
    let pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
    let s = sign(e0.x * e2.y - e0.y * e2.x);
    let d = min(min(vec2f(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                    vec2f(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
                    vec2f(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
    return -sqrt(d.x) * sign(d.y);
}
fn sdUnevenCapsule(p0: vec2f, r1: f32, r2: f32, h: f32) -> f32 {
    let p = vec2f(abs(p0.x), p0.y);
    let b = (r1 - r2) / h;
    let a = sqrt(1.0 - b * b);
    let k = dot(p, vec2f(-b, a));
    if (k < 0.0) { return length(p) - r1; }
    if (k > a * h) { return length(p - vec2f(0.0, h)) - r2; }
    return dot(p, vec2f(a, b)) - r1;
}
fn sdPentagon(p0: vec2f, r: f32) -> f32 {
    let k = vec3f(0.809016994, 0.587785252, 0.726542528);
    var p = vec2f(abs(p0.x), p0.y);
    p -= 2.0 * min(dot(vec2f(-k.x, k.y), p), 0.0) * vec2f(-k.x, k.y);
    p -= 2.0 * min(dot(vec2f(k.x, k.y), p), 0.0) * vec2f(k.x, k.y);
    p -= vec2f(clamp(p.x, -r * k.z, r * k.z), r);
    return length(p) * sign(p.y);
}
fn sdHexagon(p0: vec2f, r: f32) -> f32 {
    let k = vec3f(-0.866025404, 0.5, 0.577350269);
    var p = abs(p0);
    p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
    p -= vec2f(clamp(p.x, -k.z * r, k.z * r), r);
    return length(p) * sign(p.y);
}
fn sdOctagon(p0: vec2f, r: f32) -> f32 {
    let k = vec3f(-0.9238795325, 0.3826834323, 0.4142135623);
    var p = abs(p0);
    p -= 2.0 * min(dot(vec2f(k.x, k.y), p), 0.0) * vec2f(k.x, k.y);
    p -= 2.0 * min(dot(vec2f(-k.x, k.y), p), 0.0) * vec2f(-k.x, k.y);
    p -= vec2f(clamp(p.x, -k.z * r, k.z * r), r);
    return length(p) * sign(p.y);
}
fn sdHexagram(p0: vec2f, r: f32) -> f32 {
    let k = vec4f(-0.5, 0.8660254038, 0.5773502692, 1.7320508076);
    var p = abs(p0);
    p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
    p -= 2.0 * min(dot(k.yx, p), 0.0) * k.yx;
    p -= vec2f(clamp(p.x, r * k.z, r * k.w), r);
    return length(p) * sign(p.y);
}
fn sdStar5(p0: vec2f, r: f32, rf: f32) -> f32 {
    let k1 = vec2f(0.809016994375, -0.587785252292);
    let k2 = vec2f(-k1.x, k1.y);
    var p = vec2f(abs(p0.x), p0.y);
    p -= 2.0 * max(dot(k1, p), 0.0) * k1;
    p -= 2.0 * max(dot(k2, p), 0.0) * k2;
    p.x = abs(p.x);
    p.y -= r;
    let ba = rf * vec2f(-k1.y, k1.x) - vec2f(0.0, 1.0);
    let h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
    return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
// n points, m in [2, n] sets how sharp the points are
fn sdStar(p0: vec2f, r: f32, n: f32, m: f32) -> f32 {
    let an = PI / n;
    let en = PI / m;
    let acs = vec2f(cos(an), sin(an));
    let ecs = vec2f(cos(en), sin(en));
    let ang = atan2(p0.x, p0.y);
    let bn = ang - 2.0 * an * floor(ang / (2.0 * an)) - an;
    var p = length(p0) * vec2f(cos(bn), abs(sin(bn)));
    p -= r * acs;
    p += ecs * clamp(-dot(p, ecs), 0.0, r * acs.y / ecs.y);
    return length(p) * sign(p.x);
}
// c = (sin, cos) of the half aperture
fn sdPie(p0: vec2f, c: vec2f, r: f32) -> f32 {
    let p = vec2f(abs(p0.x), p0.y);
    let l = length(p) - r;
    let m = length(p - c * clamp(dot(p, c), 0.0, r));
    return max(l, m * sign(c.y * p.x - c.x * p.y));
}
fn sdArc(p0: vec2f, sc: vec2f, ra: f32, rb: f32) -> f32 {
    let p = vec2f(abs(p0.x), p0.y);
    let d = select(abs(length(p) - ra), length(p - sc * ra), sc.y * p.x > sc.x * p.y);
    return d - rb;
}
fn sdRing(p0: vec2f, n: vec2f, r: f32, th: f32) -> f32 {
    var p = vec2f(abs(p0.x), p0.y);
    p = mat2x2f(n.x, n.y, -n.y, n.x) * p;
    return max(abs(length(p) - r) - th * 0.5, length(vec2f(p.x, max(0.0, abs(r - p.y) - th * 0.5))) * sign(p.x));
}
fn sdHorseshoe(p0: vec2f, c: vec2f, r: f32, w: vec2f) -> f32 {
    var p = vec2f(abs(p0.x), p0.y);
    let l = length(p);
    p = mat2x2f(-c.x, c.y, c.y, c.x) * p;
    p = vec2f(select(l * sign(-c.x), p.x, p.y > 0.0 || p.x > 0.0), select(l, p.y, p.x > 0.0));
    p = vec2f(p.x, abs(p.y - r)) - w;
    return length(max(p, vec2f(0.0))) + min(0.0, max(p.x, p.y));
}
// two circles of radius r whose centers sit d apart from the axis (r > d)
fn sdVesica(p0: vec2f, r: f32, d: f32) -> f32 {
    let p = abs(p0);
    let b = sqrt(r * r - d * d);
    return select(length(p - vec2f(-d, 0.0)) - r, length(p - vec2f(0.0, b)), (p.y - b) * d > p.x * b);
}
fn sdMoon(p0: vec2f, d: f32, ra: f32, rb: f32) -> f32 {
    let p = vec2f(p0.x, abs(p0.y));
    let a = (ra * ra - rb * rb + d * d) / (2.0 * d);
    let b = sqrt(max(ra * ra - a * a, 0.0));
    if (d * (p.x * b - p.y * a) > d * d * max(b - p.y, 0.0)) { return length(p - vec2f(a, b)); }
    return max(length(p) - ra, -(length(p - vec2f(d, 0.0)) - rb));
}
fn sdEgg(p0: vec2f, ra: f32, rb: f32) -> f32 {
    let k = sqrt(3.0);
    let p = vec2f(abs(p0.x), p0.y);
    let r = ra - rb;
    var d: f32;
    if (p.y < 0.0) { d = length(p) - r; }
    else if (k * (p.x + r) < p.y) { d = length(vec2f(p.x, p.y - k * r)); }
    else { d = length(vec2f(p.x + r, p.y)) - 2.0 * r; }
    return d - rb;
}
fn sdHeart(p0: vec2f) -> f32 {
    let p = vec2f(abs(p0.x), p0.y);
    if (p.y + p.x > 1.0) { return sqrt(dot2(p - vec2f(0.25, 0.75))) - sqrt(2.0) / 4.0; }
    return sqrt(min(dot2(p - vec2f(0.0, 1.0)), dot2(p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
}
fn sdCross(p0: vec2f, b: vec2f, r: f32) -> f32 {
    var p = abs(p0);
    p = select(p.xy, p.yx, p.y > p.x);
    let q = p - b;
    let k = max(q.y, q.x);
    let w = select(vec2f(b.y - p.x, -k), q, k > 0.0);
    return sign(k) * length(max(w, vec2f(0.0))) + r;
}
fn sdRoundedX(p0: vec2f, w: f32, r: f32) -> f32 {
    let p = abs(p0);
    return length(p - min(p.x + p.y, w) * 0.5) - r;
}
// a closed polygon of 7 vertices (the even-odd sign test after Quilez)
fn sdPolygon7(v: array<vec2f, 7>, p: vec2f) -> f32 {
    var d = dot(p - v[0], p - v[0]);
    var s = 1.0;
    var j = 6;
    for (var i = 0; i < 7; i++) {
        let e = v[j] - v[i];
        let w = p - v[i];
        let b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
        d = min(d, dot(b, b));
        let c = vec3<bool>((p.y >= v[i].y), (p.y < v[j].y), (e.x * w.y > e.y * w.x));
        if (all(c) || !any(c)) { s = -s; }
        j = i;
    }
    return s * sqrt(d);
}
// ellipse by Newton iteration on the angle (robust in f32)
fn sdEllipse(p0: vec2f, ab: vec2f) -> f32 {
    let p = abs(p0);
    let q = ab * (p - ab);
    var w = select(0.0, 1.570796327, q.x < q.y);
    for (var i = 0; i < 5; i++) {
        let c = vec2f(cos(w), sin(w));
        let a = ab * c;
        let b = ab * vec2f(-c.y, c.x);
        w = w + dot(p - a, b) / (dot(p - a, a) + dot(b, b));
    }
    let d = length(p - ab * vec2f(cos(w), sin(w)));
    return select(-d, d, dot(p / ab, p / ab) > 1.0);
}
fn sdParabola(p0: vec2f, k: f32) -> f32 {
    let pos = vec2f(abs(p0.x), p0.y);
    let ik = 1.0 / k;
    let p = ik * (pos.y - 0.5 * ik) / 3.0;
    let q = 0.25 * ik * ik * pos.x;
    let h = q * q - p * p * p;
    let r = sqrt(abs(h));
    var x: f32;
    if (h > 0.0) { x = pow(q + r, 1.0 / 3.0) - pow(abs(q - r), 1.0 / 3.0) * sign(r - q); }
    else { x = 2.0 * cos(atan2(r, q) / 3.0) * sqrt(max(p, 0.0)); }
    return length(pos - vec2f(x, k * x * x)) * select(1.0, -1.0, pos.y > k * pos.x * pos.x);
}
fn sdBezier(pos: vec2f, A: vec2f, B: vec2f, C: vec2f) -> f32 {
    let a = B - A;
    let b = A - 2.0 * B + C;
    let c = a * 2.0;
    let d = A - pos;
    let kk = 1.0 / dot(b, b);
    let kx = kk * dot(a, b);
    let ky = kk * (2.0 * dot(a, a) + dot(d, b)) / 3.0;
    let kz = kk * dot(d, a);
    let p = ky - kx * kx;
    let p3 = p * p * p;
    let q = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
    var h = q * q + 4.0 * p3;
    var res: f32;
    if (h >= 0.0) {
        h = sqrt(h);
        let x = (vec2f(h, -h) - q) / 2.0;
        let uv = sign(x) * pow(abs(x), vec2f(1.0 / 3.0));
        let t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
        res = dot2(d + (c + b * t) * t);
    } else {
        let z = sqrt(-p);
        let v = acos(clamp(q / (p * z * 2.0), -1.0, 1.0)) / 3.0;
        let m = cos(v);
        let n = sin(v) * 1.732050808;
        let t = clamp(vec3f(m + m, -n - m, n - m) * z - kx, vec3f(0.0), vec3f(1.0));
        res = min(dot2(d + (c + b * t.x) * t.x), dot2(d + (c + b * t.y) * t.y));
    }
    return sqrt(res);
}
fn sdBlobbyCross(p0: vec2f, he: f32) -> f32 {
    var pos = abs(p0);
    pos = vec2f(abs(pos.x - pos.y), 1.0 - pos.x - pos.y) / sqrt(2.0);
    let p = (he - pos.y - 0.25 / he) / (6.0 * he);
    let q = pos.x / (he * he * 16.0);
    let h = q * q - p * p * p;
    var x: f32;
    if (h > 0.0) { let r = sqrt(h); x = pow(q + r, 1.0 / 3.0) - pow(abs(q - r), 1.0 / 3.0) * sign(r - q); }
    else { let r = sqrt(p); x = 2.0 * r * cos(acos(clamp(q / (p * r), -1.0, 1.0)) / 3.0); }
    x = min(x, sqrt(2.0) / 2.0);
    let z = vec2f(x, he * (1.0 - 2.0 * x * x)) - pos;
    return length(z) * sign(z.y);
}
fn sdTunnel(p0: vec2f, wh: vec2f) -> f32 {
    let p = vec2f(abs(p0.x), -p0.y);
    var q = p - wh;
    let d1 = dot2(vec2f(max(q.x, 0.0), q.y));
    q.x = select(length(p) - wh.x, q.x, p.y > 0.0);
    let d2 = dot2(vec2f(q.x, max(q.y, 0.0)));
    let d = sqrt(min(d1, d2));
    return select(d, -d, max(q.x, q.y) < 0.0);
}
fn sdStairs(p0: vec2f, wh: vec2f, n: f32) -> f32 {
    var p = p0;
    let ba = wh * n;
    var d = min(dot2(p - vec2f(clamp(p.x, 0.0, ba.x), 0.0)), dot2(p - vec2f(ba.x, clamp(p.y, 0.0, ba.y))));
    var s = sign(max(-p.y, p.x - ba.x));
    let dia = length(wh);
    p = mat2x2f(wh.x, -wh.y, wh.y, wh.x) * p / dia;
    let id = clamp(round(p.x / dia), 0.0, n - 1.0);
    p.x = p.x - id * dia;
    p = mat2x2f(wh.x, wh.y, -wh.y, wh.x) * p / dia;
    let hh = wh.y / 2.0;
    p.y -= hh;
    if (p.y > hh * sign(p.x)) { s = 1.0; }
    p = select(-p, p, id < 0.5 || p.x > 0.0);
    d = min(d, dot2(p - vec2f(0.0, clamp(p.y, -hh, hh))));
    d = min(d, dot2(p - vec2f(clamp(p.x, 0.0, wh.x), hh)));
    return sqrt(d) * s;
}

// ── blends and booleans (after Quilez) ──────────────────────────────────────
fn sminP(a: f32, b: f32, k: f32) -> f32 { let h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }
fn sminE(a: f32, b: f32, k: f32) -> f32 { let r = exp2(-a / k) + exp2(-b / k); return -k * log2(r); }
fn sminC(a: f32, b: f32, k0: f32) -> f32 {
    let k = k0 * (1.0 / (1.0 - sqrt(0.5)));
    let h = max(k - abs(a - b), 0.0) / k;
    return min(a, b) - k * 0.5 * (1.0 + h - sqrt(1.0 - h * (h - 2.0)));
}
fn smaxP(a: f32, b: f32, k: f32) -> f32 { return -sminP(-a, -b, k); }
fn opSub(a: f32, b: f32) -> f32 { return max(a, -b); }
fn opXor(a: f32, b: f32) -> f32 { return max(min(a, b), -max(a, b)); }
fn opRepeat(p: vec2f, s: f32) -> vec2f { return p - s * round(p / s); }
fn opRepeatLim(p: vec2f, s: f32, l: vec2f) -> vec2f { return p - s * clamp(round(p / s), -l, l); }
fn opPolar(p: vec2f, n: f32) -> vec2f {
    let an = TAU / n;
    let a = atan2(p.y, p.x) + an * 0.5;
    let b = a - an * floor(a / an) - an * 0.5;
    return length(p) * vec2f(cos(b), sin(b));
}
fn opBend(p: vec2f, k: f32) -> vec2f { let c = cos(k * p.x); let s = sin(k * p.x); return mat2x2f(c, s, -s, c) * p; }

// ── glyphs: a stroke alphabet of segments and arcs (original) ───────────────
// arc of radius r around c, centered on angle th (radians from +x), half span hs
fn arcAt(p: vec2f, c: vec2f, r: f32, th: f32, hs: f32) -> f32 {
    return sdArc(rot(PI * 0.5 - th) * (p - c), cs(hs), r, 0.0);
}
fn glyphS(p: vec2f) -> f32 {
    let r = 0.16;
    return min(arcAt(p, vec2f(0.0, r), r, 2.618, 2.0944), arcAt(p, vec2f(0.0, -r), r, -0.5236, 2.0944));
}
fn glyphD(p: vec2f) -> f32 {
    let x0 = -0.2; let r = 0.32; let cx = 0.0;
    var d = sdSegment(p, vec2f(x0, -r), vec2f(x0, r));
    d = min(d, sdSegment(p, vec2f(x0, r), vec2f(cx, r)));
    d = min(d, sdSegment(p, vec2f(x0, -r), vec2f(cx, -r)));
    return min(d, arcAt(p, vec2f(cx, 0.0), r, 0.0, 1.5708));
}
fn glyphF(p: vec2f) -> f32 {
    let x0 = -0.12;
    var d = sdSegment(p, vec2f(x0, -0.32), vec2f(x0, 0.32));
    d = min(d, sdSegment(p, vec2f(x0, 0.32), vec2f(0.2, 0.32)));
    return min(d, sdSegment(p, vec2f(x0, 0.02), vec2f(0.12, 0.02)));
}
// the word SDF, centerline distance (subtract a stroke radius for a weight)
fn wordSDF(p: vec2f) -> f32 {
    return min(min(glyphS(p - vec2f(-0.62, 0.0)), glyphD(p - vec2f(0.0, 0.0))), glyphF(p - vec2f(0.56, 0.0)));
}
`;

// ── the cells ────────────────────────────────────────────────────────────────
// [name, family, species, knobs, body, extra]
const F = 'return present(fieldCol(d, w), p);';
const CELLS = [
  // ── primitives ──────────────────────────────────────────────────────────
  ['circle', 'primitives', 'length(p) - r: the one exact field every other shape starts from', ['radius', '', '', ''],
   `let r = 0.22 + 0.5 * k.x + 0.03 * sin(t * 1.4);
  let d = sdCircle(p - vec2f(0.05 * sin(t * 0.7), 0.04 * cos(t * 0.9)), r);
  ${F}`],
  ['box', 'primitives', 'axis box: outside corners round off, inside stays square', ['width', 'height', 'spin', ''],
   `let q = rot(0.25 * t + (k.z - 0.5) * 1.5) * p;
  let d = sdBox(q, vec2f(0.2 + 0.7 * k.x, 0.12 + 0.5 * k.y));
  ${F}`],
  ['round_box', 'primitives', 'a box with four independent corner radii', ['width', 'radius', '', ''],
   `let r = vec4f(0.05, 0.32, 0.18, 0.02 + 0.2 * (0.5 + 0.5 * sin(t))) * (0.4 + 1.2 * k.y);
  let d = sdRoundBox(p, vec2f(0.3 + 0.6 * k.x, 0.38), r);
  ${F}`],
  ['oriented_box', 'primitives', 'a box between two end points with a thickness', ['length', 'thickness', '', ''],
   `let a = rot(0.35 * t) * vec2f(-0.2 - 0.6 * k.x, -0.18);
  let b = rot(0.35 * t) * vec2f(0.2 + 0.6 * k.x, 0.18);
  let d = sdOrientedBox(p, a, b, 0.1 + 0.5 * k.y);
  ${F}`],
  ['segment', 'primitives', 'distance to a line segment, thickened by k0', ['thickness', '', '', ''],
   `let a = vec2f(-0.5, -0.3) + 0.1 * vec2f(sin(t), cos(t * 1.3));
  let b = vec2f(0.5, 0.34) + 0.1 * vec2f(cos(t * 0.8), sin(t));
  let d = sdSegment(p, a, b) - 0.12 * k.x;
  ${F}`],
  ['rhombus', 'primitives', 'exact rhombus from one projection onto the side', ['width', 'height', '', ''],
   `let d = sdRhombus(p, vec2f(0.3 + 0.6 * k.x, 0.2 + 0.4 * k.y + 0.08 * sin(t)));
  ${F}`],
  ['trapezoid', 'primitives', 'isosceles trapezoid with two half widths and a half height', ['base', 'top', '', ''],
   `let d = sdTrapezoid(p, 0.2 + 0.6 * k.x, 0.08 + 0.4 * k.y + 0.06 * sin(t), 0.4);
  ${F}`],
  ['parallelogram', 'primitives', 'a skewed box; the skew rocks with the clock', ['width', 'skew', '', ''],
   `let d = sdParallelogram(p, 0.2 + 0.4 * k.x, 0.34, (k.y - 0.5) * 0.8 + 0.2 * sin(t * 0.8));
  ${F}`],
  ['equilateral_tri', 'primitives', 'equilateral triangle by folding into one sixth', ['size', '', '', ''],
   `let d = sdEquilateralTriangle(rot(0.3 * t) * (p + vec2f(0.0, 0.05)), 0.3 + 0.5 * k.x);
  ${F}`],
  ['isosceles_tri', 'primitives', 'isosceles triangle, apex on top', ['width', 'height', '', ''],
   `let hgt = 0.5 + 0.7 * k.y;
  let d = sdTriangleIsosceles(p - vec2f(0.0, hgt * 0.5), vec2f(0.2 + 0.5 * k.x + 0.05 * sin(t), -hgt));
  ${F}`],
  ['uneven_capsule', 'primitives', 'two circles of different radii joined by tangents', ['bottom', 'top', '', ''],
   `let d = sdUnevenCapsule(rot(0.25 * sin(t * 0.7)) * (p + vec2f(0.0, 0.3)), 0.12 + 0.3 * k.x, 0.06 + 0.2 * k.y, 0.62);
  ${F}`],
  ['pentagon', 'primitives', 'regular pentagon by two reflections', ['radius', '', '', ''],
   `let d = sdPentagon(rot(0.2 * t) * vec2f(p.x, -p.y), 0.25 + 0.4 * k.x);
  ${F}`],
  ['hexagon', 'primitives', 'regular hexagon by one reflection', ['radius', '', '', ''],
   `let d = sdHexagon(rot(0.2 * t) * p, 0.25 + 0.4 * k.x);
  ${F}`],
  ['octagon', 'primitives', 'regular octagon by two reflections', ['radius', '', '', ''],
   `let d = sdOctagon(rot(0.2 * t) * p, 0.25 + 0.4 * k.x);
  ${F}`],
  ['hexagram', 'primitives', 'six point star of two triangles', ['radius', '', '', ''],
   `let d = sdHexagram(rot(0.2 * t) * p, 0.16 + 0.26 * k.x);
  ${F}`],
  ['star', 'primitives', 'n-point star; k0 sets the points, k1 the sharpness', ['points', 'sharpness', '', ''],
   `let n = floor(4.0 + 6.0 * k.x);
  let m = mix(2.0, n, clamp(k.y * 0.8 + 0.1 + 0.08 * sin(t), 0.0, 1.0));
  let d = sdStar(rot(0.15 * t) * p, 0.68, n, m);
  ${F}`],
  ['pie', 'primitives', 'a circular sector with an opening angle', ['aperture', '', '', ''],
   `let ap = 0.3 + 2.6 * k.x * (0.85 + 0.15 * sin(t));
  let d = sdPie(p + vec2f(0.0, 0.1), cs(ap), 0.6);
  ${F}`],
  ['arc', 'primitives', 'a thick arc with round caps', ['aperture', 'thickness', '', ''],
   `let ap = 0.4 + 2.6 * k.x;
  let d = sdArc(rot(0.4 * t) * p, cs(ap), 0.48, 0.03 + 0.16 * k.y);
  ${F}`],
  ['ring', 'primitives', 'a cut ring with square ends', ['cut', 'thickness', '', ''],
   `let d = sdRing(rot(0.3 * t) * p, cs(0.2 + 1.4 * k.x), 0.46, 0.06 + 0.24 * k.y);
  ${F}`],
  ['horseshoe', 'primitives', 'a ring with straight legs', ['opening', 'leg', '', ''],
   `let an = 0.6 + 1.6 * k.x + 0.15 * sin(t);
  let d = sdHorseshoe(p - vec2f(0.0, 0.08), vec2f(cos(an), sin(an)), 0.42, vec2f(0.12 + 0.4 * k.y, 0.07));
  ${F}`],
  ['vesica', 'primitives', 'the lens where two equal circles overlap', ['width', '', '', ''],
   `let d = sdVesica(rot(0.2 * sin(t * 0.6)) * p, 0.8, 0.2 + 0.5 * k.x);
  ${F}`],
  ['moon', 'primitives', 'a crescent: one circle minus another', ['offset', '', '', ''],
   `let d = sdMoon(rot(0.25 * sin(t * 0.5)) * p, 0.1 + 0.4 * k.x + 0.05 * sin(t), 0.6, 0.5);
  ${F}`],
  ['egg', 'primitives', 'egg of three circle arcs, exact', ['top', '', '', ''],
   `let d = sdEgg(p + vec2f(0.0, 0.2), 0.48, 0.05 + 0.3 * k.x);
  ${F}`],
  ['heart', 'primitives', 'heart of two arcs and two lines, exact', ['size', '', '', ''],
   `let s = 0.75 + 0.6 * k.x + 0.05 * sin(t * 3.0) * sin(t * 3.0);
  let d = sdHeart((p + vec2f(0.0, 0.5 * s)) / s) * s;
  ${F}`],
  ['cross', 'primitives', 'a plus sign with an optional outer rounding', ['arm', 'round', '', ''],
   `let d = sdCross(rot(0.2 * t) * p, vec2f(0.3 + 0.4 * k.x, 0.16), -0.12 * k.y + 0.06);
  ${F}`],
  ['rounded_x', 'primitives', 'two crossed capsules, exact', ['length', 'thickness', '', ''],
   `let d = sdRoundedX(rot(0.2 * t) * p, 0.4 + 0.8 * k.x, 0.04 + 0.16 * k.y);
  ${F}`],
  ['polygon', 'primitives', 'any closed polygon: edge distance plus an even-odd sign', ['wobble', '', '', ''],
   `var v = array<vec2f, 7>();
  for (var i = 0; i < 7; i++) {
    let a = TAU * f32(i) / 7.0 + 0.3;
    let r = select(0.62, 0.3, (i & 1) == 1) + 0.12 * k.x * sin(t * 1.3 + f32(i) * 2.1);
    v[i] = r * vec2f(cos(a), sin(a));
  }
  let d = sdPolygon7(v, p);
  ${F}`],
  ['ellipse', 'primitives', 'exact ellipse by Newton steps on the angle', ['ratio', '', '', ''],
   `let d = sdEllipse(rot(0.2 * t) * p, vec2f(0.68, 0.16 + 0.4 * k.x));
  ${F}`],
  ['parabola', 'primitives', 'y = k x²; the cubic root gives the foot point', ['curvature', '', '', ''],
   `let d = sdParabola(p + vec2f(0.0, 0.45), 1.0 + 3.0 * k.x + 0.4 * sin(t));
  ${F}`],
  ['bezier', 'primitives', 'quadratic Bézier: closest point by a cubic, thickened', ['thickness', '', '', ''],
   `let A = vec2f(-0.6, -0.4); let C = vec2f(0.6, -0.3);
  let B = vec2f(0.4 * sin(t * 0.7), 0.9 + 0.2 * cos(t));
  let d = sdBezier(p, A, B, C) - 0.02 - 0.12 * k.x;
  ${F}`],
  ['blobby_cross', 'primitives', 'a soft four-lobed cross from a parabola fold', ['lobes', '', '', ''],
   `let s = 0.62;
  let d = sdBlobbyCross(rot(0.2 * t) * p / s, 0.12 + 0.36 * k.x) * s;
  ${F}`],
  ['tunnel', 'primitives', 'an arch: a box with a round top', ['width', 'height', '', ''],
   `let d = sdTunnel(p + vec2f(0.0, 0.1), vec2f(0.2 + 0.4 * k.x, 0.3 + 0.4 * k.y));
  ${F}`],
  ['stairs', 'primitives', 'a staircase of n steps, exact', ['steps', '', '', ''],
   `let n = floor(3.0 + 6.0 * k.x);
  let wh = vec2f(1.1, 0.9) / n;
  let d = sdStairs(p + vec2f(0.55, 0.45), wh, n);
  ${F}`],

  // ── visualise ───────────────────────────────────────────────────────────
  ['signed_field', 'visualise', 'the raw signed value: tone brightness outside, cream inside, no bands', ['gain', '', '', ''],
   `let d = shapeV(p, t);
  let g = 1.0 + 3.0 * k.x;
  let a = 1.0 - exp(-abs(d) * g * 2.0);
  var col = select(mix(u.tone.rgb * 1.2, u.ink.rgb, a), mix(u.cream.rgb, u.ink.rgb * 0.6 + u.cream.rgb * 0.15, a), d < 0.0);
  col = mix(col, hot(), stroke(d, 0.8 * w, w));
  return present(col, p);`, 'V'],
  ['iso_bands', 'visualise', 'contour map: one flat band per distance step, shaded like terrain', ['step', '', '', ''],
   `let d = shapeV(p, t);
  let st = 0.035 + 0.08 * k.x;
  let lv = floor(d / st);
  let x = clamp(0.5 + lv * st * 0.9, 0.0, 1.0);
  var col = select(mix(u.tone.rgb, u.ink.rgb, smoothstep(0.0, 1.2, d)) * (0.75 + 0.25 * fract(lv * 0.5) * 2.0),
                   mix(u.cream.rgb, u.ink.rgb, smoothstep(0.0, 0.5, -d) * 0.7) * (0.8 + 0.2 * fract(lv * 0.5) * 2.0), d < 0.0);
  let e = abs(fract(d / st + 0.5) - 0.5) * st;
  col = mix(col, u.ink.rgb * 0.5, stroke(e, 0.5 * w, w) * 0.8 * x);
  col = mix(col, hot(), stroke(d, 1.0 * w, w));
  return present(col, p);`, 'V'],
  ['gradient_dirs', 'visualise', 'the gradient on a grid: unit arrows point away from the edge', ['grid', '', '', ''],
   `let g = 0.1 + 0.1 * k.x;
  let c = (floor(p / g) + 0.5) * g;
  let n = gradV(c, t);
  let d = shapeV(p, t);
  var col = fieldCol(d, w) * 0.45;
  let tip = c + n * g * 0.36; let tail = c - n * g * 0.36;
  let sh = sdSegment(p, tail, tip) - 0.12 * g * 0.5;
  let side = vec2f(-n.y, n.x);
  let hd = sdTriangle(p, tip + n * g * 0.12, tip - n * g * 0.12 + side * g * 0.16, tip - n * g * 0.12 - side * g * 0.16);
  let ang = 0.5 + 0.5 * atan2(n.y, n.x) / PI;
  let ac = mix(u.tone.rgb * 1.3, u.cream.rgb, 0.5 + 0.5 * cos(TAU * ang));
  col = mix(col, ac * 0.85, fill(min(sh, hd), w) * 0.9);
  return present(col, p);`, 'V'],
  ['grad_length', 'visualise', '|∇d| shows exact versus bound: left exact ellipse, right the cheap scaled circle', ['ratio', '', '', ''],
   `let ab = vec2f(0.38, 0.18 + 0.18 * k.x + 0.04 * sin(t));
  let left = p.x < 0.0;
  let c = select(vec2f(0.5, 0.0), vec2f(-0.5, 0.0), left);
  let q = rot(0.3) * (p - c);
  let e = 0.002;
  var d: f32; var gx: f32; var gy: f32;
  if (left) {
    d = sdEllipse(q, ab);
    gx = sdEllipse(q + vec2f(e, 0.0), ab) - sdEllipse(q - vec2f(e, 0.0), ab);
    gy = sdEllipse(q + vec2f(0.0, e), ab) - sdEllipse(q - vec2f(0.0, e), ab);
  } else {
    d = (length(q / ab) - 1.0) * min(ab.x, ab.y);
    gx = (length((q + vec2f(e, 0.0)) / ab) - length((q - vec2f(e, 0.0)) / ab)) * min(ab.x, ab.y);
    gy = (length((q + vec2f(0.0, e)) / ab) - length((q - vec2f(0.0, e)) / ab)) * min(ab.x, ab.y);
  }
  let gl = length(vec2f(gx, gy)) / (2.0 * e);
  let dev = clamp((gl - 1.0) * 3.0, -1.0, 1.0);
  var col = mix(u.ink.rgb * 2.0 + u.tone.rgb * 0.18, u.tone.rgb * 1.3, clamp(-dev, 0.0, 1.0));
  col = mix(col, mix(u.cream.rgb, vec3f(1.0, 0.4, 0.3), 0.6), clamp(dev, 0.0, 1.0));
  col *= 0.55 + 0.45 * smoothstep(0.0, 0.04, abs(fract(d * 10.0 + 0.5) - 0.5) / 10.0 + 0.004);
  col = mix(col, hot(), stroke(d, 0.9 * w, w));
  col = mix(col, u.ink.rgb, stroke(p.x, 1.5 * w, w));
  return present(col, p);`],
  ['lipschitz', 'visualise', 'a warped field: hot hatching marks |∇d| > 1, where a tracer oversteps', ['warp', '', '', ''],
   `let e = 0.002;
  let d = warpV(p, t, k.x);
  let gx = warpV(p + vec2f(e, 0.0), t, k.x) - warpV(p - vec2f(e, 0.0), t, k.x);
  let gy = warpV(p + vec2f(0.0, e), t, k.x) - warpV(p - vec2f(0.0, e), t, k.x);
  let gl = length(vec2f(gx, gy)) / (2.0 * e);
  var col = fieldCol(d, w);
  let over = smoothstep(1.0, 1.25, gl);
  let hatch = stroke(abs(fract((p.x + p.y) * 18.0) - 0.5) / 18.0, 0.9 * w, w);
  col = mix(col, vec3f(1.0, 0.38, 0.28), over * (0.12 + 0.6 * hatch));
  col = mix(col, u.tone.rgb * 0.6, smoothstep(1.0, 0.7, gl) * 0.35);
  return present(col, p);`, 'W'],
  ['probe', 'visualise', 'a probe point and its circle of radius |d|: it touches the nearest edge', ['speed', '', '', ''],
   `let d = shapeV(p, 0.0);
  var col = fieldCol(d, w) * 0.7;
  let tt = t * (0.4 + 0.8 * k.x);
  let q = vec2f(0.62 * cos(tt * 0.9 + 2.2), 0.55 * sin(tt * 1.3 + 0.7));
  let dq = shapeV(q, 0.0);
  let n = gradV(q, 0.0);
  let foot = q - dq * n;
  let ring = abs(length(p - q) - abs(dq));
  col = mix(col, select(u.tone.rgb * 1.5, u.ink.rgb, dq < 0.0), fill(length(p - q) - abs(dq), w) * 0.25);
  col = mix(col, hot(), stroke(ring, 0.9 * w, w));
  col = mix(col, u.cream.rgb, stroke(sdSegment(p, q, foot), 0.6 * w, w) * 0.8);
  col = dotc(col, p, q, 3.0 * w, w, hot());
  col = dotc(col, p, foot, 3.5 * w, w, vec3f(1.0, 0.5, 0.35));
  return present(col, p);`, 'V'],
  ['medial_axis', 'visualise', 'the skeleton: where the gradient folds, the Laplacian spikes', ['spread', '', '', ''],
   `let h = 2.5 * w;
  let d = axisV(p, t);
  let lap = (axisV(p + vec2f(h, 0.0), t) + axisV(p - vec2f(h, 0.0), t) + axisV(p + vec2f(0.0, h), t) + axisV(p - vec2f(0.0, h), t) - 4.0 * d) / h;
  let sk = smoothstep(0.08, 0.6 + 1.2 * k.x, lap);
  var col = fieldCol(d, w) * 0.75;
  col = mix(col, select(u.tone.rgb * 1.6, hot(), d < 0.0), sk);
  return present(col, p);`, 'A'],
  ['march_2d', 'visualise', 'sphere tracing in 2D: each circle is a safe step, each ends on the edge', ['spread', '', '', ''],
   `let d = shapeV(p, t);
  var col = fieldCol(d, w) * 0.55;
  let o = vec2f(-0.86, -0.62);
  for (var r = 0; r < 4; r++) {
    let a = 0.62 + (f32(r) / 3.0 - 0.5) * (0.3 + 0.6 * k.x) + 0.1 * sin(t * 0.5);
    let dir = vec2f(cos(a), sin(a));
    var s = 0.0;
    var hit = false;
    for (var i = 0; i < 20; i++) {
      let c = o + dir * s;
      let h = shapeV(c, t);
      let tint = mix(u.tone.rgb * 1.5, u.cream.rgb, f32(i) / 12.0);
      col = mix(col, tint, stroke(length(p - c) - h, 0.5 * w, w) * 0.7);
      col = dotc(col, p, c, 2.2 * w, w, tint);
      if (h < 0.004) { hit = true; break; }
      s += h;
      if (s > 2.6) { break; }
    }
    col = mix(col, u.cream.rgb, stroke(sdSegment(p, o, o + dir * s), 0.4 * w, w) * 0.6);
    if (hit) { col = dotc(col, p, o + dir * s, 4.0 * w, w, vec3f(1.0, 0.45, 0.32)); }
  }
  col = dotc(col, p, o, 4.0 * w, w, hot());
  return present(col, p);`, 'V'],

  // ── operators ───────────────────────────────────────────────────────────
  ['op_union', 'operators', 'min(a, b): exact outside, a bound inside', ['gap', '', '', ''],
   `let a = opA(p, t); let b = opB(p, t, k.x);
  var col = fieldCol(min(a, b), w);
  col = ghost(col, a, w, u.cream.rgb, 0.35); col = ghost(col, b, w, u.cream.rgb, 0.35);
  return present(col, p);`, 'O'],
  ['op_subtract', 'operators', 'max(a, -b): the circle cuts the box; only a bound', ['gap', '', '', ''],
   `let a = opA(p, t); let b = opB(p, t, k.x);
  var col = fieldCol(opSub(a, b), w);
  col = ghost(col, a, w, u.cream.rgb, 0.35); col = ghost(col, b, w, u.cream.rgb, 0.35);
  return present(col, p);`, 'O'],
  ['op_intersect', 'operators', 'max(a, b): the overlap of both shapes', ['gap', '', '', ''],
   `let a = opA(p, t); let b = opB(p, t, k.x);
  var col = fieldCol(max(a, b), w);
  col = ghost(col, a, w, u.cream.rgb, 0.35); col = ghost(col, b, w, u.cream.rgb, 0.35);
  return present(col, p);`, 'O'],
  ['smooth_poly', 'operators', 'quadratic smooth minimum: a fillet of width k', ['k', '', '', ''],
   `let a = opA(p, t); let b = opB(p, t, 0.5);
  let kk = 0.02 + 0.4 * k.x;
  var col = fieldCol(sminP(a, b, kk), w);
  col = ghost(col, min(a, b), w, u.cream.rgb, 0.4);
  return present(col, p);`, 'O'],
  ['smooth_exp', 'operators', 'exponential smooth minimum: never exact, never sharp', ['k', '', '', ''],
   `let a = opA(p, t); let b = opB(p, t, 0.5);
  let kk = 0.005 + 0.06 * k.x;
  var col = fieldCol(sminE(a, b, kk), w);
  col = ghost(col, min(a, b), w, u.cream.rgb, 0.4);
  return present(col, p);`, 'O'],
  ['smooth_circ', 'operators', 'circular smooth minimum: a true circular fillet', ['k', '', '', ''],
   `let a = opA(p, t); let b = opB(p, t, 0.5);
  let kk = 0.02 + 0.3 * k.x;
  var col = fieldCol(sminC(a, b, kk), w);
  col = ghost(col, min(a, b), w, u.cream.rgb, 0.4);
  return present(col, p);`, 'O'],
  ['op_xor', 'operators', 'exclusive or: union minus intersection', ['gap', '', '', ''],
   `let a = opA(p, t); let b = opB(p, t, k.x);
  var col = fieldCol(opXor(a, b), w);
  return present(col, p);`, 'O'],
  ['op_round', 'operators', 'd - r: rounding grows the shape and rounds every corner', ['radius', '', '', ''],
   `let s = sdStar5(rot(0.2 * t) * p, 0.42, 0.45);
  let r = 0.02 + 0.2 * k.x * (0.6 + 0.4 * sin(t));
  var col = fieldCol(s - r, w);
  col = ghost(col, s, w, u.cream.rgb, 0.45);
  return present(col, p);`],
  ['op_onion', 'operators', 'abs(d) - r, three times: rings of rings', ['thickness', 'layers', '', ''],
   `var d = sdHexagon(rot(0.15 * t) * p, 0.42);
  let th = 0.012 + 0.03 * k.x;
  d = abs(d) - th * 4.0;
  d = abs(d) - th * 2.0;
  if (k.y > 0.5) { d = abs(d) - th; }
  return present(fieldCol(d, w), p);`],
  ['repeat_inf', 'operators', 'p - s round(p/s): one shape, infinite copies, one evaluation', ['period', '', '', ''],
   `let s = 0.22 + 0.25 * k.x;
  let pp = p + vec2f(0.1 * t, 0.06 * t);
  let id = round(pp / s);
  let q = opRepeat(pp, s);
  let d = sdRoundBox(rot(0.4) * q, vec2f(s * 0.26, s * 0.12), vec4f(s * 0.08));
  var col = fieldCol(d, w);
  col *= 0.9 + 0.1 * hash21(id);
  return present(col, p);`],
  ['repeat_limited', 'operators', 'repetition clamped to a 5 by 3 block', ['period', '', '', ''],
   `let s = 0.26 + 0.12 * k.x;
  let q = opRepeatLim(p, s, vec2f(2.0, 1.0));
  let d = sdCircle(q, s * 0.3 + 0.02 * sin(t * 2.0 + p.x * 4.0));
  return present(fieldCol(d, w), p);`],
  ['repeat_mirror', 'operators', 'mirrored repetition: odd cells flip, so the seams match', ['period', '', '', ''],
   `let s = 0.4 + 0.3 * k.x;
  let pp = p + vec2f(0.08 * t, 0.0);
  let id = round(pp / s);
  var q = pp - s * id;
  q = q * vec2f(select(1.0, -1.0, fract(id.x * 0.5) > 0.25), select(1.0, -1.0, fract(id.y * 0.5) > 0.25));
  let d = sdMoon(q - vec2f(-0.04, 0.03) * s, 0.12 * s, 0.36 * s, 0.3 * s);
  return present(fieldCol(d, w), p);`],
  ['domain_warp', 'operators', 'warp the input point: the field bends but is no longer exact', ['amount', '', '', ''],
   `let a = 0.02 + 0.14 * k.x;
  let q = p + a * vec2f(sin(5.0 * p.y + 1.3 * t), sin(5.0 * p.x - 1.1 * t + 1.0));
  let d = sdBox(rot(0.3) * q, vec2f(0.46, 0.3)) - 0.05;
  return present(fieldCol(d, w), p);`],
  ['morph', 'operators', 'mix(a, b, s): a linear blend of two fields morphs the shapes', ['bias', '', '', ''],
   `let s = clamp(0.5 + 0.5 * sin(t * 0.8) + (k.x - 0.5), 0.0, 1.0);
  let a = sdStar5(p, 0.6, 0.4);
  let b = sdRoundBox(p, vec2f(0.38), vec4f(0.12));
  var col = fieldCol(mix(a, b, s), w);
  col = ghost(col, a, w, u.cream.rgb, 0.25 * (1.0 - s)); col = ghost(col, b, w, u.cream.rgb, 0.25 * s);
  return present(col, p);`],
  ['bend', 'operators', 'rotate p by an angle that grows with x: a bent bar', ['bend', '', '', ''],
   `let kb = (k.x - 0.2) * 3.0 + 0.6 * sin(t * 0.7);
  let q = opBend(p + vec2f(0.0, 0.1), kb);
  let d = sdRoundBox(q, vec2f(0.7, 0.1), vec4f(0.06));
  return present(fieldCol(d, w), p);`],

  // ── rendering ───────────────────────────────────────────────────────────
  ['aa_fwidth', 'rendering', 'left: hard step; right: smoothstep over fwidth(d), one pixel wide', ['spokes', '', '', ''],
   `let n = floor(10.0 + 30.0 * k.x);
  let a = atan2(p.y, p.x) + 0.08 * t;
  let r = length(p);
  let d = (abs(fract(a * n / TAU + r * 1.5) - 0.5) / n * TAU * r - 0.004 - 0.02 * r) * 0.8;
  let fw = fwidth(d);
  let soft = 1.0 - smoothstep(-fw, fw, d);
  let hard = select(0.0, 1.0, d < 0.0);
  let cov = select(soft, hard, p.x < 0.0);
  let disc = 1.0 - smoothstep(0.86, 0.87, r);
  var col = mix(u.ink.rgb, mix(u.tone.rgb * 0.5, u.ink.rgb, r), disc);
  col = mix(col, mix(u.cream.rgb, u.tone.rgb, r), cov * disc);
  col = mix(col, hot(), stroke(p.x, 0.8 * w, w) * 0.7);
  return present(col, p);`],
  ['outline', 'rendering', 'fill, gap and two strokes from one field: a sticker', ['stroke', '', '', ''],
   `let d = sdHeart((rot(0.1 * sin(t)) * p + vec2f(0.0, 0.48)) / 1.05) * 1.05;
  let sw = 0.02 + 0.04 * k.x;
  var col = mix(u.ink.rgb, u.tone.rgb * 0.18, smoothstep(1.2, 0.0, length(p)));
  col = mix(col, u.tone.rgb, fill(d - 3.0 * sw, w));
  col = mix(col, u.ink.rgb, fill(d - 2.0 * sw, w));
  col = mix(col, u.cream.rgb, fill(d - sw, w));
  col = mix(col, mix(u.tone.rgb, u.cream.rgb, 0.25 + 0.4 * smoothstep(-0.4, 0.4, p.y)), fill(d, w));
  return present(col, p);`],
  ['inner_glow', 'rendering', 'exp(k d) inside the shape: light pooled along the edge', ['spread', '', '', ''],
   `let d = sdRoundBox(rot(0.15 * sin(t * 0.6)) * p, vec2f(0.55, 0.38), vec4f(0.16));
  let sp = 6.0 + 30.0 * (1.0 - k.x);
  var col = u.ink.rgb * 1.3;
  let inside = fill(d, w);
  let g = exp(d * sp) * (0.8 + 0.2 * sin(t * 2.0));
  col = mix(col, u.ink.rgb * 0.6 + mix(u.tone.rgb, u.cream.rgb, g) * g * 1.4, inside);
  col = mix(col, hot(), stroke(d, 0.6 * w, w) * 0.8);
  return present(col, p);`],
  ['outer_glow', 'rendering', 'neon: a thin core and a 1 / (1 + (d/s)^2) halo', ['halo', '', '', ''],
   `let d1 = abs(sdCircle(p - vec2f(-0.22, 0.04), 0.36)) - 0.006;
  let d2 = abs(sdEquilateralTriangle(rot(0.3 * t) * (p - vec2f(0.24, -0.04)), 0.36)) - 0.006;
  let s = 0.01 + 0.04 * k.x;
  let g1 = 1.0 / (1.0 + (d1 / s) * (d1 / s));
  let g2 = 1.0 / (1.0 + (d2 / s) * (d2 / s));
  var col = u.ink.rgb * 0.8;
  col += u.tone.rgb * g1 * 0.9 + u.cream.rgb * g2 * 0.75;
  col = mix(col, vec3f(1.0), fill(min(d1, d2) - 0.004, w) * 0.9);
  return present(col, p);`],
  ['drop_shadow', 'rendering', 'the same field, offset and widened, is a soft shadow', ['blur', '', '', ''],
   `let off = vec2f(0.05 + 0.03 * sin(t * 0.7), -0.08);
  let blur = 0.02 + 0.2 * k.x;
  let a = sdRoundBox(p - vec2f(-0.14, 0.12), vec2f(0.42, 0.28), vec4f(0.08));
  let b = sdRoundBox(p - vec2f(0.18, -0.2), vec2f(0.4, 0.26), vec4f(0.08));
  let sa = sdRoundBox(p - off - vec2f(-0.14, 0.12), vec2f(0.42, 0.28), vec4f(0.08));
  let sb = sdRoundBox(p - off - vec2f(0.18, -0.2), vec2f(0.4, 0.26), vec4f(0.08));
  var col = mix(u.tone.rgb * 0.35, u.tone.rgb * 0.16, smoothstep(-1.0, 1.0, p.y));
  col *= 1.0 - 0.75 * (1.0 - smoothstep(-blur, blur, sa));
  col = mix(col, mix(u.cream.rgb, u.tone.rgb, 0.55), fill(a, w));
  col *= 1.0 - 0.65 * (1.0 - smoothstep(-blur, blur, sb)) * (1.0 - fill(b, w));
  col = mix(col, u.cream.rgb * mix(1.0, 0.82, smoothstep(0.1, -0.5, p.y)), fill(b, w));
  return present(col, p);`],
  ['bevel', 'rendering', 'emboss: a height ramp from d, a normal from its gradient, a turning light', ['bevel', '', '', ''],
   `let bw = 0.03 + 0.12 * k.x;
  let e = 0.004;
  let h0 = bevH(p, bw);
  let hx = bevH(p + vec2f(e, 0.0), bw) - bevH(p - vec2f(e, 0.0), bw);
  let hy = bevH(p + vec2f(0.0, e), bw) - bevH(p - vec2f(0.0, e), bw);
  let n = normalize(vec3f(-hx, -hy, 2.0 * e * 6.0 * bw));
  let l = normalize(vec3f(cos(t * 0.6 + 2.2), sin(t * 0.6 + 2.2), 0.9));
  let dif = max(dot(n, l), 0.0);
  let spec = pow(max(dot(reflect(-l, n), vec3f(0.0, 0.0, 1.0)), 0.0), 24.0);
  let d = bevS(p);
  var col = u.ink.rgb * 1.4 * (1.0 - 0.6 * (1.0 - smoothstep(-0.02, 0.12, bevS(p + vec2f(-0.03, 0.05)))));
  let base = mix(u.tone.rgb, u.cream.rgb, 0.35 + 0.3 * h0);
  col = mix(col, base * (0.25 + 0.85 * dif) + vec3f(spec * 0.8), fill(d, w));
  return present(col, p);`, 'B'],
  ['soft_shadow_2d', 'rendering', 'march from each pixel to the light; min(k h / s) is the penumbra', ['softness', '', '', ''],
   `let lp = vec2f(0.6 * cos(t * 0.45 + 2.4), 0.55 * sin(t * 0.6 + 1.0));
  let d0 = shScene(p);
  let tl = lp - p; let dist = length(tl); let dir = tl / max(dist, 1e-4);
  let kk = 4.0 + 28.0 * (1.0 - k.x);
  var res = 1.0; var s = 0.01;
  for (var i = 0; i < 56; i++) {
    let h = shScene(p + dir * s);
    res = min(res, kk * h / s);
    s += clamp(h, 0.004, 0.12);
    if (res < 0.001 || s > dist) { break; }
  }
  res = clamp(res, 0.0, 1.0); res = res * res * (3.0 - 2.0 * res);
  let li = 0.9 / (1.0 + 5.0 * dist * dist);
  var col = u.ink.rgb * 0.7 + mix(u.tone.rgb, u.cream.rgb, li * res * 0.8) * li * res * 1.3;
  col += u.cream.rgb * 0.03 / (dist * dist + 0.003);
  col = mix(col, mix(u.tone.rgb * 0.45, u.cream.rgb * 0.6, smoothstep(0.0, -0.08, d0)), fill(d0, w));
  col = mix(col, hot(), stroke(d0, 0.5 * w, w) * 0.4);
  return present(col, p);`, 'S'],
  ['ao_2d', 'rendering', 'ambient occlusion: how open the field is on a ring of probes', ['radius', '', '', ''],
   `let d0 = aoScene(p, t);
  let rr = 0.05 + 0.15 * k.x;
  var occ = 0.0;
  for (var i = 0; i < 12; i++) {
    let a = TAU * f32(i) / 12.0;
    let dir = vec2f(cos(a), sin(a));
    occ += clamp(aoScene(p + dir * rr, t) / rr, 0.0, 1.0) * 0.5;
    occ += clamp(aoScene(p + dir * rr * 2.2, t) / (rr * 2.2), 0.0, 1.0) * 0.5;
  }
  occ /= 12.0;
  let ao = smoothstep(0.1, 0.95, occ);
  var col = mix(u.ink.rgb, mix(u.tone.rgb * 0.55, u.cream.rgb * 0.8, smoothstep(-0.8, 0.9, p.y)), ao);
  col = mix(col, mix(u.ink.rgb * 1.6, u.tone.rgb * 0.5, 0.35 + 0.65 * smoothstep(-0.06, 0.0, d0)), fill(d0, w));
  return present(col, p);`, 'C'],
  ['metaballs', 'rendering', 'seven balls merged by exponential smin, lit as a gooey bulge', ['goo', '', '', ''],
   `let kk = 0.03 + 0.08 * k.x;
  let e = 0.004;
  let d = blobs(p, t, kk);
  let gx = blobs(p + vec2f(e, 0.0), t, kk) - blobs(p - vec2f(e, 0.0), t, kk);
  let gy = blobs(p + vec2f(0.0, e), t, kk) - blobs(p - vec2f(0.0, e), t, kk);
  let g = normalize(vec2f(gx, gy) + 1e-6);
  let hgt = sqrt(clamp(-d / 0.16, 0.0, 1.0));
  let n = normalize(vec3f(g * (1.0 - hgt), hgt + 0.15));
  let l = normalize(vec3f(-0.5, 0.6, 0.7));
  let dif = max(dot(n, l), 0.0);
  let spec = pow(max(dot(reflect(-l, n), vec3f(0.0, 0.0, 1.0)), 0.0), 30.0);
  var col = u.ink.rgb + u.tone.rgb * 0.25 * exp(-max(d, 0.0) * 14.0);
  let body = mix(u.tone.rgb * 0.8, u.cream.rgb, 0.2 + 0.6 * dif) + vec3f(spec);
  col = mix(col, body, fill(d, w));
  return present(col, p);`, 'M'],

  // ── glyphs & UI ─────────────────────────────────────────────────────────
  ['glyph_sdf', 'glyphs', 'a stroke font from segments and arcs; the weight is one subtraction', ['weight', '', '', ''],
   `let s = 1.15;
  let c = wordSDF(p * s) / s;
  let wt = 0.02 + 0.05 * k.x + 0.01 * sin(t);
  let d = c - wt;
  var col = mix(u.ink.rgb, u.tone.rgb * 0.22, smoothstep(0.9, -0.4, p.y));
  col += u.tone.rgb * 0.35 * exp(-max(d, 0.0) * 18.0);
  col = mix(col, mix(u.cream.rgb, vec3f(1.0), smoothstep(0.0, -wt, d) * 0.5), fill(d, w));
  col = mix(col, u.tone.rgb * 1.2, stroke(c, 0.35 * w, w) * 0.4 * fill(d, w));
  return present(col, p);`],
  ['glyph_effects', 'glyphs', 'one glyph field, four looks: shadow, outline, glow and fill', ['offset', '', '', ''],
   `let s = 1.15;
  let c = wordSDF(p * s) / s;
  let d = c - 0.045;
  let sh = wordSDF((p - vec2f(0.03, -0.04) * (0.5 + k.x)) * s) / s - 0.045;
  var col = u.ink.rgb * 1.2;
  col = mix(col, u.ink.rgb * 0.3, (1.0 - smoothstep(-0.03, 0.05, sh)) * 0.9);
  col += u.tone.rgb * 0.5 * exp(-abs(d - 0.05) * 30.0) * (0.7 + 0.3 * sin(t * 2.0));
  col = mix(col, u.tone.rgb, stroke(d - 0.04, 0.012, w));
  col = mix(col, mix(u.cream.rgb, u.tone.rgb, 0.5 + 0.5 * sin(p.x * 3.0 + t)), fill(d, w));
  return present(col, p);`],
  ['msdf_corners', 'glyphs', 'left: one channel, bilinear from a coarse grid, rounds the corners. right: median of three keeps them', ['grid', '', '', ''],
   `let g = 0.09 + 0.12 * k.x;
  let left = p.x < 0.0;
  let c = select(vec2f(0.46, 0.0), vec2f(-0.46, 0.0), left);
  let q = rot(0.15 * sin(t * 0.5)) * (p - c);
  let gp = q / g - 0.5;
  let i0 = floor(gp); let f = fract(gp);
  let c00 = (i0 + vec2f(0.5, 0.5)) * g; let c10 = (i0 + vec2f(1.5, 0.5)) * g;
  let c01 = (i0 + vec2f(0.5, 1.5)) * g; let c11 = (i0 + vec2f(1.5, 1.5)) * g;
  var d: f32;
  if (left) {
    d = mix(mix(triTrue(c00), triTrue(c10), f.x), mix(triTrue(c01), triTrue(c11), f.x), f.y);
  } else {
    let m = mix(mix(triMsdf(c00), triMsdf(c10), f.x), mix(triMsdf(c01), triMsdf(c11), f.x), f.y);
    d = max(min(m.x, m.y), min(max(m.x, m.y), m.z));
  }
  var col = mix(u.ink.rgb, u.tone.rgb * 0.25, 1.0 - smoothstep(0.0, 0.9, length(p - c)));
  col = mix(col, u.tone.rgb * 0.9, stroke(length(fract(q / g) - 0.5) * g, 1.4 * w, w) * 0.8);
  col = mix(col, select(u.cream.rgb, mix(u.cream.rgb, u.tone.rgb, 0.25), left), fill(d, w) * 0.92);
  col = mix(col, vec3f(1.0, 0.45, 0.35), stroke(triTrue(q), 0.5 * w, w) * 0.9);
  col = mix(col, u.ink.rgb, stroke(p.x, 1.5 * w, w));
  return present(col, p);`, 'T'],
  ['ui_panels', 'glyphs', 'a card built from rounded boxes: shadow, header, avatar, text and a button', ['radius', '', '', ''],
   `let r = 0.02 + 0.1 * k.x;
  var col = mix(u.ink.rgb * 1.2, u.tone.rgb * 0.18, smoothstep(-1.0, 1.0, p.x + p.y));
  let card = sdRoundBox(p, vec2f(0.62, 0.72), vec4f(r));
  col *= 1.0 - 0.7 * (1.0 - smoothstep(-0.04, 0.14, sdRoundBox(p - vec2f(0.03, -0.07), vec2f(0.62, 0.72), vec4f(r))));
  col = mix(col, mix(u.ink.rgb * 2.2 + u.tone.rgb * 0.12, u.ink.rgb * 1.6, smoothstep(0.7, -0.7, p.y)), fill(card, w));
  let head = max(card, -(p.y - 0.36));
  col = mix(col, mix(u.tone.rgb * 0.8, u.tone.rgb * 0.45, smoothstep(-0.6, 0.6, p.x)), fill(head, w));
  col = mix(col, u.cream.rgb, fill(sdCircle(p - vec2f(-0.38, 0.36), 0.13), w));
  col = mix(col, u.tone.rgb * 0.55, fill(sdCircle(p - vec2f(-0.38, 0.36), 0.1), w));
  for (var i = 0; i < 3; i++) {
    let y = 0.12 - f32(i) * 0.13;
    let ln = sdRoundBox(p - vec2f(-0.1 + 0.08 * f32(i == 2), y), vec2f(0.42 - 0.08 * f32(i == 2), 0.025), vec4f(0.025));
    col = mix(col, u.cream.rgb * 0.45, fill(ln, w));
  }
  let pulse = 0.5 + 0.5 * sin(t * 2.0);
  let btn = sdRoundBox(p - vec2f(0.22, -0.48), vec2f(0.28, 0.09), vec4f(0.09));
  col += u.tone.rgb * 0.4 * exp(-max(btn, 0.0) * (30.0 - 12.0 * pulse)) * (1.0 - fill(card, w) * 0.4);
  col = mix(col, mix(u.cream.rgb, u.tone.rgb, 0.2), fill(btn, w));
  col = mix(col, hot(), stroke(card, 0.4 * w, w) * 0.35);
  return present(col, p);`],
  ['icon_set', 'glyphs', 'nine icons, each a few primitives and booleans', ['weight', '', '', ''],
   `let g = 0.62;
  let id = clamp(round(p / g), vec2f(-1.0), vec2f(1.0));
  let q = p - id * g;
  let n = i32(id.x + 1.0 + (1.0 - id.y) * 3.0);
  let tile = sdRoundBox(q, vec2f(0.26), vec4f(0.08));
  var col = u.ink.rgb;
  col *= 1.0 - 0.6 * (1.0 - smoothstep(-0.02, 0.08, sdRoundBox(q - vec2f(0.015, -0.03), vec2f(0.26), vec4f(0.08))));
  col = mix(col, mix(u.ink.rgb * 2.0 + u.tone.rgb * 0.1, u.ink.rgb * 1.4, smoothstep(0.26, -0.26, q.y)), fill(tile, w));
  let wt = 0.006 + 0.02 * k.x;
  let ic = icon(q * (1.0 + 0.06 * sin(t * 2.0 + f32(n))), n, wt);
  let ac = select(u.cream.rgb, u.tone.rgb * 1.3, n == 3 || n == 7);
  col = mix(col, ac, fill(ic, w));
  return present(col, p);`, 'I'],
  ['progress_rings', 'glyphs', 'three arcs with round caps on their tracks', ['progress', '', '', ''],
   `var col = u.ink.rgb * 1.1;
  for (var i = 0; i < 3; i++) {
    let rr = 0.66 - f32(i) * 0.2;
    let fr = clamp(fract(0.15 + 0.3 * f32(i) + 0.6 * k.x + 0.06 * t * (1.0 + 0.4 * f32(i))), 0.02, 0.98);
    let track = abs(length(p) - rr) - 0.07;
    let arc = sdArc(rot(PI * fr) * p, cs(PI * fr), rr, 0.07);
    let c = select(select(mix(u.tone.rgb, u.cream.rgb, 0.5), u.cream.rgb, i == 2), u.tone.rgb * 1.25, i == 0);
    col = mix(col, c * 0.2, fill(track, w));
    col += c * 0.25 * exp(-max(arc, 0.0) * 26.0);
    col = mix(col, c, fill(arc, w));
  }
  return present(col, p);`],
  ['ui_controls', 'glyphs', 'a toggle, a slider, a checkbox and radio buttons, all fields', ['value', '', '', ''],
   `let on = 0.5 + 0.5 * sin(t * 1.5);
  var col = mix(u.ink.rgb * 1.3, u.ink.rgb, smoothstep(-1.0, 1.0, p.y));
  // toggle
  let tg = sdRoundBox(p - vec2f(-0.35, 0.48), vec2f(0.24, 0.12), vec4f(0.12));
  col = mix(col, mix(u.ink.rgb * 2.4, u.tone.rgb, on), fill(tg, w));
  let kb = sdCircle(p - vec2f(-0.47 + 0.24 * on, 0.48), 0.095);
  col *= 1.0 - 0.4 * (1.0 - smoothstep(-0.02, 0.05, kb + 0.01));
  col = mix(col, u.cream.rgb, fill(kb, w));
  // checkbox
  let cb = sdRoundBox(p - vec2f(0.42, 0.48), vec2f(0.12), vec4f(0.04));
  col = mix(col, select(u.ink.rgb * 2.4, u.tone.rgb, on > 0.5), fill(cb, w));
  let ck = min(sdSegment(p, vec2f(0.36, 0.48), vec2f(0.41, 0.42)), sdSegment(p, vec2f(0.41, 0.42), vec2f(0.5, 0.55))) - 0.022;
  col = mix(col, u.cream.rgb, fill(ck, w) * step(0.5, on));
  // slider
  let v = clamp(k.x + 0.25 * sin(t * 0.9), 0.0, 1.0);
  let x0 = -0.6; let x1 = 0.6; let xv = mix(x0, x1, v);
  col = mix(col, u.ink.rgb * 2.4, fill(sdSegment(p, vec2f(x0, 0.0), vec2f(x1, 0.0)) - 0.03, w));
  col = mix(col, u.tone.rgb, fill(sdSegment(p, vec2f(x0, 0.0), vec2f(xv, 0.0)) - 0.03, w));
  let sk = sdCircle(p - vec2f(xv, 0.0), 0.08);
  col += u.tone.rgb * 0.35 * exp(-max(sk, 0.0) * 20.0);
  col = mix(col, u.cream.rgb, fill(sk, w));
  // radio
  for (var i = 0; i < 3; i++) {
    let c = vec2f(-0.4 + 0.4 * f32(i), -0.48);
    let sel = i32(floor(fract(t * 0.25) * 3.0)) == i;
    col = mix(col, select(u.ink.rgb * 2.6, u.tone.rgb, sel), stroke(sdCircle(p - c, 0.1), 0.02, w));
    col = mix(col, u.cream.rgb, fill(sdCircle(p - c, 0.05), w) * f32(sel));
  }
  return present(col, p);`],
];

// ── extra top-level functions, keyed by the last field of a cell row ────────
const EXTRA = {
  V: `// visualise: a box and a circle, smoothly joined, with a round hole
fn shapeV(p: vec2f, t: f32) -> f32 {
    let b = sdRoundBox(rot(0.12 * sin(t * 0.5)) * (p - vec2f(-0.2, -0.1)), vec2f(0.36, 0.26), vec4f(0.1));
    let c = sdCircle(p - vec2f(0.3 + 0.04 * sin(t * 0.8), 0.18), 0.28);
    let h = sdCircle(p - vec2f(-0.24, -0.12), 0.1);
    return max(sminP(b, c, 0.14), -h);
}
fn gradV(p: vec2f, t: f32) -> vec2f {
    let e = 0.0015;
    let g = vec2f(shapeV(p + vec2f(e, 0.0), t) - shapeV(p - vec2f(e, 0.0), t), shapeV(p + vec2f(0.0, e), t) - shapeV(p - vec2f(0.0, e), t));
    return normalize(g + 1e-7);
}`,
  W: `// lipschitz: a hexagon with a sine warp of amplitude set by k
fn warpV(p: vec2f, t: f32, k: f32) -> f32 {
    let a = 0.01 + 0.12 * k;
    let q = p + a * vec2f(sin(7.0 * p.y + t), cos(6.0 * p.x - 0.8 * t));
    return sdHexagon(q, 0.5);
}`,
  A: `// medial axis: a star and a bar, so the skeleton has branches
fn axisV(p: vec2f, t: f32) -> f32 {
    let s = sdStar5(rot(0.1 * t) * (p - vec2f(0.0, 0.08)), 0.62, 0.48);
    let b = sdRoundBox(p - vec2f(0.0, -0.62), vec2f(0.6, 0.08), vec4f(0.04));
    return min(s, b);
}`,
  O: `// operators: a rounded box and a circle that slides across it
fn opA(p: vec2f, t: f32) -> f32 { return sdRoundBox(rot(0.2 * sin(t * 0.4)) * (p + vec2f(0.12, 0.06)), vec2f(0.4, 0.28), vec4f(0.06)); }
fn opB(p: vec2f, t: f32, k: f32) -> f32 { return sdCircle(p - vec2f(0.22 + 0.25 * (k - 0.5) + 0.12 * sin(t * 0.7), 0.16 + 0.05 * cos(t * 0.9)), 0.3); }`,
  B: `// bevel: a star joined to a ring
fn bevS(p: vec2f) -> f32 {
    let s = sdStar5(p, 0.42, 0.5);
    return min(s - 0.02, abs(sdCircle(p, 0.62)) - 0.07);
}
fn bevH(p: vec2f, bw: f32) -> f32 { let x = clamp(-bevS(p) / bw, 0.0, 1.0); return sqrt(1.0 - (1.0 - x) * (1.0 - x)); }`,
  S: `// soft shadow 2D: a few solid blockers
fn shScene(p: vec2f) -> f32 {
    var d = sdBox(rot(0.4) * (p - vec2f(-0.3, 0.25)), vec2f(0.12, 0.06));
    d = min(d, sdCircle(p - vec2f(0.28, 0.22), 0.1));
    d = min(d, sdRoundBox(p - vec2f(0.05, -0.35), vec2f(0.24, 0.05), vec4f(0.03)));
    d = min(d, sdEquilateralTriangle(p - vec2f(-0.45, -0.32), 0.08));
    d = min(d, sdCircle(p - vec2f(0.62, -0.45), 0.06));
    return d;
}`,
  C: `// ao 2D: a room with a floor, two walls and a few objects
fn aoScene(p: vec2f, t: f32) -> f32 {
    var d = -sdBox(p - vec2f(0.0, 0.05), vec2f(0.82, 0.74));
    d = min(d, sdRoundBox(p - vec2f(-0.4, -0.5), vec2f(0.16, 0.2), vec4f(0.03)));
    d = min(d, sdCircle(p - vec2f(0.12 + 0.1 * sin(t * 0.6), -0.56), 0.14));
    d = min(d, sdRoundBox(p - vec2f(0.55, -0.36), vec2f(0.1, 0.34), vec4f(0.03)));
    d = min(d, sdBox(p - vec2f(-0.2, 0.3), vec2f(0.3, 0.03)));
    return d;
}`,
  M: `// metaballs: seven moving circles, merged with exponential smin
fn blobs(p: vec2f, t: f32, k: f32) -> f32 {
    var d = sdCircle(p, 0.2);
    for (var i = 0; i < 6; i++) {
        let fi = f32(i);
        let c = vec2f(0.5 * cos(t * (0.4 + 0.11 * fi) + fi * 1.7), 0.45 * sin(t * (0.5 + 0.07 * fi) + fi * 2.3));
        d = sminE(d, sdCircle(p - c, 0.09 + 0.025 * f32(i % 3)), k);
    }
    return d;
}`,
  T: `// msdf: a triangle, its true field and three channels of edge distances
fn triLines(p: vec2f) -> vec3f {
    let v0 = vec2f(-0.3, -0.28); let v1 = vec2f(0.34, -0.12); let v2 = vec2f(-0.12, 0.36);
    let n0 = normalize(vec2f((v1 - v0).y, -(v1 - v0).x));
    let n1 = normalize(vec2f((v2 - v1).y, -(v2 - v1).x));
    let n2 = normalize(vec2f((v0 - v2).y, -(v0 - v2).x));
    return vec3f(dot(p - v0, n0), dot(p - v1, n1), dot(p - v2, n2));
}
fn triTrue(p: vec2f) -> f32 { return sdTriangle(p, vec2f(-0.3, -0.28), vec2f(0.34, -0.12), vec2f(-0.12, 0.36)); }
// edge colors: e0 = red+green, e1 = green+blue, e2 = red+blue
fn triMsdf(p: vec2f) -> vec3f {
    let l = triLines(p);
    return vec3f(max(l.x, l.z), max(l.x, l.y), max(l.y, l.z));
}`,
  I: `// icon set: n = 0..8, row major from the top left
fn icon(q: vec2f, n: i32, wt: f32) -> f32 {
    switch n {
        case 0: { return sdEquilateralTriangle(rot(-1.5708) * (q + vec2f(0.02, 0.0)), 0.12) - wt; }
        case 1: { return min(sdRoundBox(q - vec2f(-0.06, 0.0), vec2f(0.035, 0.13), vec4f(0.02)), sdRoundBox(q - vec2f(0.06, 0.0), vec2f(0.035, 0.13), vec4f(0.02))) - wt; }
        case 2: { return sdHeart((q + vec2f(0.0, 0.13)) / 0.26) * 0.26 - wt; }
        case 3: { return sdStar5(q, 0.16, 0.45) - wt; }
        case 4: {
            let teeth = sdBox(opPolar(q, 8.0) - vec2f(0.14, 0.0), vec2f(0.035, 0.03));
            return opSub(min(sdCircle(q, 0.12), teeth), sdCircle(q, 0.05)) - wt;
        }
        case 5: { return min(sdSegment(q, vec2f(-0.12, 0.0), vec2f(-0.04, -0.09)), sdSegment(q, vec2f(-0.04, -0.09), vec2f(0.13, 0.1))) - 0.025 - wt; }
        case 6: { return sdRoundedX(q, 0.24, 0.025) - wt; }
        case 7: {
            let roof = sdTriangleIsosceles(q - vec2f(0.0, 0.15), vec2f(0.17, -0.13));
            let body = sdBox(q - vec2f(0.0, -0.06), vec2f(0.11, 0.09));
            return opSub(min(roof, body), sdRoundBox(q - vec2f(0.0, -0.09), vec2f(0.035, 0.06), vec4f(0.02))) - wt;
        }
        default: {
            return min(abs(sdCircle(q - vec2f(-0.03, 0.03), 0.085)) - 0.025, sdSegment(q, vec2f(0.04, -0.04), vec2f(0.13, -0.13)) - 0.03) - wt;
        }
    }
}`,
};

// ── emit pack.wgsl ───────────────────────────────────────────────────────────
const usedExtra = [...new Set(CELLS.map(c => c[5]).filter(Boolean))];
const frag = ([name, , , , body]) =>
  `@fragment fn fs_${name}(@builtin(position) fp: vec4f) -> @location(0) vec4f {\n  let p = suv(fp.xy);\n  let w = pxw();\n  let t = u.time;\n  let k = u.k;\n  ${body}\n}`;
const pack = HELPERS + '\n// ── cell scenes ──────────────────────────────────────────────────────────────\n' +
  usedExtra.map(k => EXTRA[k]).join('\n\n') +
  `\n\n// ── the ${CELLS.length} cells ─────────────────────────────────────────────────────────────\n` +
  CELLS.map(frag).join('\n\n') + '\n';

// ── saver plate equations ───────────────────────────────────────────────────
// SAVER_EQ[name] goes into spec.json as cell.eq. The table-engine sends it to
// the screensaver plate (lib/table-engine.js, saverLabel). Plain Unicode text,
// written from the cell bodies above.
// d(p) is the signed distance: d < 0 inside, d = 0 on the edge.
const SAVER_EQ = {
  star: ['d = sdStar(R(0.15t)·p, r = 0.68, n, m)', 'n = 4…10 points,  m = 2…n (sharpness)', 'm swings by 0.08·sin t'],
  heart: ['d = s·sdHeart((p + (0, ½s))/s)', 'two arcs and two lines, exact', 's = 0.75…1.35 + 0.05 sin²3t (size)'],
  blobby_cross: ['q = (||x| − |y||,  1 − |x| − |y|)/√2', 'd = parabola distance in q,  he = 0.12…0.48', 'shape turns at 0.2t'],
  signed_field: ['d = max(smin(box, circle, 0.14), −hole)', 'a = 1 − e^(−2g|d|),  g = 1…4 (gain)', 'inside (d < 0) cream,  outside tone'],
  iso_bands: ['band = ⌊d/Δ⌋,  Δ = 0.035…0.115 (step)', 'contour where |fract(d/Δ + ½) − ½| = 0', 'd = max(smin(box, circle, 0.14), −hole)'],
  medial_axis: ['∇²d ≈ (d(p ± hx̂) + d(p ± hŷ) − 4d)/h,  h = 2.5 px', 'skeleton = smoothstep(0.08, 0.6…1.8, ∇²d)', 'd = min(star₅, bar):  the gradient folds on the axis'],
  smooth_poly: ['h = max(k − |a − b|, 0)/k', 'smin(a, b) = min(a, b) − h²·k/4', 'k = 0.02…0.42,  a = rounded box,  b = circle'],
  smooth_exp: ['smin(a, b) = −k·log₂(2^(−a/k) + 2^(−b/k))', 'k = 0.005…0.065', 'a = rounded box,  b = circle'],
  smooth_circ: ['k′ = k/(1 − √½),  h = max(k′ − |a − b|, 0)/k′', 'smin = min(a, b) − ½k′·(1 + h − √(1 − h(h − 2)))', 'k = 0.02…0.32 (a circular fillet)'],
  op_onion: ['d₀ = hexagon(R(0.15t)p, 0.42)', 'd = ||d₀| − 4τ| − 2τ  (and |d| − τ when layers > ½)', 'τ = 0.012…0.042 (thickness)'],
  repeat_inf: ['q = p′ − s·round(p′/s),  p′ = p + (0.1, 0.06)·t', 'd = roundBox(R(0.4)q, (0.26s, 0.12s), 0.08s)', 's = 0.22…0.47 (period)'],
  repeat_mirror: ['q = (p′ − s·id)·(±1, ±1),  odd cells flip', 'd = moon(q, 0.12s, 0.36s, 0.3s),  p′ = p + 0.08t·x̂', 's = 0.4…0.7 (period)'],
  domain_warp: ['q = p + a·(sin(5y + 1.3t), sin(5x − 1.1t + 1))', 'd = box(R(0.3)q, (0.46, 0.3)) − 0.05', 'a = 0.02…0.16:  no longer an exact distance'],
  morph: ['d = (1 − s)·star₅(p) + s·roundBox(p)', 's = clamp(½ + ½ sin 0.8t + (bias − ½), 0, 1)', 'a linear blend of two fields'],
  bend: ['q = R(κx)·p  (rotation grows with x)', 'd = roundBox(q, (0.7, 0.1), 0.06)', 'κ = 3(bend − 0.2) + 0.6 sin 0.7t'],
  inner_glow: ['g = e^(σd)·(0.8 + 0.2 sin 2t)  for d < 0', 'σ = 6…36 (spread)', 'd = roundBox(R(0.15 sin 0.6t)p, (0.55, 0.38), 0.16)'],
  outer_glow: ['g = 1/(1 + (d/s)²)  (neon halo)', 'd₁ = |circle| − 0.006,  d₂ = |triangle(R(0.3t))| − 0.006', 's = 0.01…0.05 (halo)'],
};

// ── emit spec.json ───────────────────────────────────────────────────────────
const spec = {
  cols: 6,
  uniform_bytes: 96,
  cells: CELLS.map(([name, family, species, knobs]) => ({
    name, family, species, knobs,
    defaults: [0.5, 0.5, 0.5, 0.5],
    fn: 'fs_' + name,
    ...(SAVER_EQ[name] ? { eq: SAVER_EQ[name] } : {}),
  })),
  gens: [
    { id: 'exposure', title: 'Exposure · brightness', fn: 'flat', period: 10, amp: 0.4, bias: 0.5, phase: 0,
      map: 'y => Math.pow(2, (y - 0.5) * 3)', unit: "v => (Math.log2(v) >= 0 ? '+' : '') + Math.log2(v).toFixed(1) + ' ev'" },
    { id: 'tempo', title: 'Tempo · hover speed', fn: 'flat', period: 8, amp: 0.0, bias: 0.5, phase: 0,
      map: 'y => 0.1 + 2.9 * y', unit: "v => v.toFixed(2) + 'x'" },
    { id: 'lines', title: 'Iso lines · bands per unit', fn: 'flat', period: 6, amp: 0.4, bias: 0.4, phase: 0,
      map: 'y => 4 + 40 * y', unit: "v => v.toFixed(1) + ' /u'" },
    { id: 'glow', title: 'Edge glow', fn: 'flat', period: 4, amp: 0.4, bias: 0.5, phase: 0,
      map: 'y => 2 * y', unit: "v => v.toFixed(2)" },
  ],
  swatches: [
    { id: 'ink', label: 'Ink', hex: '#090b14' },
    { id: 'tone', label: 'Outside', hex: '#5a8dff' },
    { id: 'cream', label: 'Inside', hex: '#ffd49a' },
  ],
  // screensaver: calm cells and tempo for the table-engine hook (lib/table-engine.js)
  saver: { cells: ['morph', 'domain_warp', 'smooth_poly', 'smooth_exp', 'smooth_circ', 'op_onion', 'iso_bands', 'repeat_mirror', 'repeat_inf', 'inner_glow', 'outer_glow', 'blobby_cross', 'signed_field', 'medial_axis', 'bend', 'heart', 'star'], tempo: [1, 0.35], dpr: 2 },
};

// ── emit index.html ──────────────────────────────────────────────────────────
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const legend = Object.keys(FAM).map(f => `<span class="f-${f}"><i></i>${f === 'glyphs' ? 'glyphs &amp; UI' : f}</span>`).join('');
const tiles = CELLS.map(([name, family, species]) =>
  `<div class="cell f-${family}" role="button" tabindex="0" id="tile-${name}" aria-label="${esc(name.replace(/_/g, ' ') + ': ' + species)}"><canvas></canvas><span class="orb-status"></span><span class="tag">${name.replace(/_/g, ' ')}</span></div>`).join('');
const swatchHtml = spec.swatches.map(s => `<label class="swatch"><span>${s.label}</span><input type="color" id="sw-${s.id}" value="${s.hex}"></label>`).join('');

const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="dark">
<title>SDF 2D Table // Stella Nova</title>
<!--
  ════════════════════════════════════════════════════════════════════════════
   SDF 2D TABLE  ·  page shell (GENERATED by build.mjs — do not edit by hand)
  ────────────────────────────────────────────────────────────────────────────
   Static markup only. main.js loads the data and hands it to the shared
   table-engine, which builds the sidebar and the frame loop and drives page.js.
   ${CELLS.length} two-dimensional signed distance fields, one fragment shader
   per cell. The page uses system fonts, and IBM Plex Mono for the WGSL panel.
  ════════════════════════════════════════════════════════════════════════════
-->
<meta name="description" content="${CELLS.length} 2D signed distance fields in WGSL: exact primitives, distance views, operators, rendering tricks, glyphs and UI.">
<link href="../../vendor/fonts/ibm-plex-mono+ibm-plex-sans.0ec3f36e.css" rel="stylesheet">
<link rel="stylesheet" href="style.css">
</head>
<body>

<script>if(window!==window.top)document.documentElement.classList.add("in-frame")</script>
<div class="grid-bg"></div>
<div class="topbar">
  <div class="topbar-l"><span class="sys-name">Stella Nova</span><span class="sys-status">SDF 2D Table</span></div>
  <div class="topbar-r">SYS // <strong>WGSL SHADER LAB</strong></div>
</div>
<div id="side">
  <div class="side-head"><div class="big">d(p)</div><div class="sub">${CELLS.length} distance fields · ${Object.keys(FAM).length} families</div></div>
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
//  SDF 2D TABLE  ·  main.js — data load and boot (the entry module, GENERATED)
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
//  SDF 2D TABLE  ·  page.js — the per-page PAGE object (GENERATED)
// ────────────────────────────────────────────────────────────────────────────
//  ${CELLS.length} 2D distance fields; one fragment shader per cell, each reading only
//  a shared uniform buffer (no source texture). The shared table-engine drives
//  this object through its ctx. main.js fetches the data and calls
//  bootTable(PAGE, data); the engine calls PAGE.init and PAGE.draw from there.
//
//  UNIFORM LAYOUT (96 bytes, matches struct SdfU in shaders/pack.wgsl)
//    0..1 size · 2 time · 3 pixelScale · 4..7 ink · 8..11 tone · 12..15 cream
//    16 exposure · 17 lines · 18 glow · 19 pad · 20..23 k (four knobs)
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
    d[0] = rect.width; d[1] = rect.height; d[2] = t.phase; d[3] = surf.canvas.width / Math.max(rect.width, 1);
    d.set([G.ink[0], G.ink[1], G.ink[2], 1], 4); d.set([G.tone[0], G.tone[1], G.tone[2], 1], 8); d.set([G.cream[0], G.cream[1], G.cream[2], 1], 12);
    d[16] = G.exposure; d[17] = G.lines; d[18] = G.glow; d[19] = 0;
    d.set(t.knobs, 20);
    device.queue.writeBuffer(surf.buf, 0, d);
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: surf.ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(t.pipeline); pass.setBindGroup(0, this.bind(surf)); pass.draw(3); pass.end();
  },
  source(t) { return this.ctx.fnSource('fs_' + t.s.name); },
};
`;

// ── emit style.css (color-table base, system fonts, the SDF families) ───────
// The base sheet names Cormorant Garamond and JetBrains Mono. The build swaps
// both for system stacks. The one web font is IBM Plex Mono, for the WGSL
// source panel (#m-src) only.
const SANS = "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
const MONO = "ui-monospace,'SF Mono',Menlo,Consolas,monospace";
const famCss = Object.entries(FAM).map(([f, c]) =>
  `.f-${f}{--fam:${c};--fam-bg:${c.replace(/[\d.]+\)$/, '0.06)')}}`).join('\n');
const baseCss = readFileSync(join(DIR, '..', 'color-table', 'style.css'), 'utf8')
  .replace(/'Cormorant Garamond',serif/g, SANS)
  .replace(/'JetBrains Mono',monospace/g, MONO);
const css = `/* SDF 2D TABLE  ·  style.css (GENERATED by build.mjs from color-table/style.css,
   with system font stacks and the SDF families appended) */
` + baseCss + `
/* ── SDF families (appended by build.mjs) ────────────────────────────────── */
${famCss}
body .tm-fab{font-family:${MONO}}
#m-src{font-family:'IBM Plex Mono',${MONO}}
.side-head .big{color:#ffd49a;font-style:normal;font-weight:300;letter-spacing:0.02em}
.side-head .sub{font-style:normal;font-size:0.82rem;letter-spacing:0.04em}
.sheet-side h3{font-style:normal;font-weight:300;font-size:1.9rem}
.sys-name{font-weight:400;letter-spacing:0.18em;font-size:0.95rem}
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
console.log('extras      : ' + usedExtra.join(' '));
console.log('wrote pack.wgsl, spec.json, index.html, main.js, page.js, style.css');
