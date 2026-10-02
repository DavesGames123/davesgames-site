// ============================================================================
//  BEAM, LINE & DECAL TABLE  ·  build.mjs — the single source of truth
// ────────────────────────────────────────────────────────────────────────────
//  One generator emits every file the page needs, so the cell names, the WGSL
//  entry points and the tile divs cannot drift apart. Run it with:
//      node build.mjs
//  It writes shaders/pack.wgsl, spec.json, page.js, main.js, index.html and
//  style.css into this folder. cells.mjs holds the cell list. The shared
//  table-engine drives the result; it renders one fragment entry point
//  fs_<name> per tile from a shared uniform buffer.
//
//  MODEL
//    The site has no line primitive, so every line here is a distance field in
//    one full-screen fragment pass. A cell measures the distance from the pixel
//    to a segment, a sampled curve or a decal shape, then turns the distance
//    into light: glowLine gives a crisp core (anti-aliased to one device pixel)
//    and a 1/distance halo. Colors add in HDR, and fin() tone-maps them over a
//    dark space or floor ground. Beams and shields use the Beam swatch,
//    tracers and telegraphs use the Heat swatch.
//
//  ORIGINS
//    ported ...... BulletTracer.shader (lit body, emissive core, Fresnel rim,
//                  scrolled streak) and ObjectiveBeam.shader (transiting soft
//                  arrowhead, hashed twinkle); the draw-on reveal follows
//                  ObjectiveGuideBeam.cs. All three are the user's own files.
//    original .... the beam core (1/distance glow to a segment), the noise
//                  filament, the curve evaluators, the telegraph decals and
//                  the shields. No Shadertoy code is in this pack.
//
//  GREP MAP (pack.wgsl)
//    struct BeamU ...... the shared uniform block
//    fn buv / pxw ...... pixel to cell uv, one device pixel in uv
//    fn pcg / hi1 / vn1  hashing and value noise   ·   fn hash21u .. port
//    fn segDS .......... distance and parameter to a segment
//    fn glowLine ....... crisp core plus 1/distance halo   ·   fn lightRGB
//    fn fin ............ tone map over the ground   ·   fn floorBg / spaceBg
//    fn ctlP / crPt .... control polygon, Catmull-Rom (Barry-Goldman)
//    fn crDist ......... distance to a sampled Catmull-Rom (60 segments)
//    fn chaikin ........ distance to a Chaikin polygon at level 0..5
//    fn hullSd ......... union of the corner triangles (the local hull)
//    fn litBody ........ the ported lit tracer body
//    fn hexCoords ...... hex grid for the shields   ·   fn vor .. Voronoi
//    @fragment fs_* .... the cells (grep "fs_beam_", "fs_tg_", and so on)
// ============================================================================
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CELLS } from './cells.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));

// ── families (legend order) ─────────────────────────────────────────────────
const FAM = {
  beam:      'rgba(80,190,255,0.15)',
  curve:     'rgba(170,200,255,0.13)',
  tracer:    'rgba(255,160,70,0.15)',
  telegraph: 'rgba(255,90,60,0.15)',
  shield:    'rgba(90,230,255,0.14)',
};

// ── the WGSL helper library (shared by every cell) ──────────────────────────
const HELPERS = `// ═══════════════════════════════════════════════════════════════════════════
//  BEAM, LINE & DECAL TABLE  ·  one fragment shader per cell. Every line is a
//  distance field: a cell measures the distance from the pixel to a segment,
//  a sampled curve or a decal shape, and glowLine turns it into a crisp core
//  and a 1/distance halo. Colors add in HDR; fin() tone-maps them over the
//  ground. Ported from the user's BulletTracer.shader and ObjectiveBeam.shader
//  where a cell says so; the beam core, curves, decals and shields are
//  original. Catmull-Rom after Barry and Goldman 1988; Chaikin 1974.
// ═══════════════════════════════════════════════════════════════════════════
const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.283185307179586;

struct BeamU {
    size: vec2f, time: f32, pixelScale: f32,
    ink: vec4f, tone: vec4f, cream: vec4f,
    exposure: f32, weight: f32, glow: f32, pad1: f32,
    k: vec4f,
};
@group(0) @binding(0) var<uniform> u: BeamU;

@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(p[i], 0.0, 1.0);
}

// cell uv: centered, y up, the short side spans -0.5 .. 0.5
fn buv(fp: vec2f) -> vec2f {
    let p = fp / max(u.pixelScale, 0.001);
    let n = (p - 0.5 * u.size) / max(min(u.size.x, u.size.y), 1.0);
    return vec2f(n.x, -n.y);
}
// one device pixel in uv units (the anti-alias width)
fn pxw() -> f32 { return 1.0 / (max(min(u.size.x, u.size.y), 1.0) * max(u.pixelScale, 0.001)); }
// line width scaled by the Weight generator
fn lw(w: f32) -> f32 { return w * u.weight; }
fn rot2(a: f32) -> mat2x2f { let c = cos(a); let s = sin(a); return mat2x2f(c, s, -s, c); }

// ── hashing and value noise ─────────────────────────────────────────────────
fn pcg(v: u32) -> u32 {
    let s = v * 747796405u + 2891336453u;
    let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
    return (w >> 22u) ^ w;
}
fn hi1(i: i32, seed: u32) -> f32 { return f32(pcg(bitcast<u32>(i) ^ pcg(seed))) * (1.0 / 4294967295.0); }
fn hi2(p: vec2i, seed: u32) -> f32 { return f32(pcg(bitcast<u32>(p.x) ^ pcg(bitcast<u32>(p.y) ^ pcg(seed)))) * (1.0 / 4294967295.0); }
fn vn1(x: f32, seed: u32) -> f32 {
    let i = i32(floor(x)); let f = fract(x); let w = f * f * (3.0 - 2.0 * f);
    return mix(hi1(i, seed), hi1(i + 1, seed), w) * 2.0 - 1.0;
}
fn vn2(p: vec2f, seed: u32) -> f32 {
    let i = vec2i(floor(p)); let f = fract(p); let w = f * f * (3.0 - 2.0 * f);
    let a = hi2(i, seed); let b = hi2(i + vec2i(1, 0), seed);
    let c = hi2(i + vec2i(0, 1), seed); let d = hi2(i + vec2i(1, 1), seed);
    return mix(mix(a, b, w.x), mix(c, d, w.x), w.y) * 2.0 - 1.0;
}
fn fbm1(x: f32, seed: u32) -> f32 {
    var s = 0.0; var a = 0.5; var f = x;
    for (var i = 0; i < 4; i++) { s += a * vn1(f, seed + u32(i)); a *= 0.5; f *= 2.03; }
    return s / 0.9375;
}
fn fbm2(p0: vec2f, seed: u32) -> f32 {
    var s = 0.0; var a = 0.5; var p = p0;
    for (var i = 0; i < 4; i++) { s += a * vn2(p, seed + u32(i)); a *= 0.5; p = rot2(0.6) * p * 2.03; }
    return s / 0.9375;
}
// ported from ObjectiveBeam.shader (Hash21): a cheap 2D hash, 0..1
fn hash21u(p0: vec2f) -> f32 {
    var p = fract(p0 * vec2f(127.1, 311.7));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
}

// ── distance fields ─────────────────────────────────────────────────────────
// x: distance to segment ab, y: parameter 0..1 of the closest point
fn segDS(p: vec2f, a: vec2f, b: vec2f) -> vec2f {
    let pa = p - a; let ba = b - a;
    let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
    return vec2f(length(pa - ba * h), h);
}
fn sdBox(p: vec2f, b: vec2f) -> f32 { let d = abs(p) - b; return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0); }
fn sdRoundBox(p: vec2f, b: vec2f, r: f32) -> f32 { return sdBox(p, b - vec2f(r)) - r; }
// pie opening along +y; cs = (sin, cos) of the half angle
fn sdPie(p0: vec2f, cs: vec2f, r: f32) -> f32 {
    let p = vec2f(abs(p0.x), p0.y);
    let l = length(p) - r;
    let m = length(p - cs * clamp(dot(p, cs), 0.0, r));
    return max(l, m * sign(cs.y * p.x - cs.x * p.y));
}
// a fast ellipse bound, good near the edge (where the anti-alias acts)
fn sdEllipseA(p: vec2f, r: vec2f) -> f32 {
    let k0 = length(p / r); let k1 = length(p / (r * r));
    return k0 * (k0 - 1.0) / max(k1, 1e-6);
}
fn smin(a: f32, b: f32, k: f32) -> f32 { let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
fn sdTri(p: vec2f, a: vec2f, b: vec2f, c: vec2f) -> f32 {
    let e0 = b - a; let e1 = c - b; let e2 = a - c;
    let v0 = p - a; let v1 = p - b; let v2 = p - c;
    let pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
    let pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
    let pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
    let s = sign(e0.x * e2.y - e0.y * e2.x);
    let d = min(min(vec2f(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                    vec2f(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
                    vec2f(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
    return -sqrt(d.x) * sign(d.y);
}

// ── light: the beam core (original) ─────────────────────────────────────────
// x: a crisp core of half-width w, anti-aliased to one device pixel.
// y: a 1/distance halo, w / (d + w). The exp term ends the halo inside the
//    cell, so a line does not light the whole tile.
fn glowLine(d: f32, w: f32) -> vec2f {
    let px = pxw();
    let core = smoothstep(w + px, max(w - px, 0.0), d);
    let ww = max(w, px) * 1.5;
    let halo = ww / (d + ww) * exp(-d * 5.0);
    return vec2f(core, halo);
}
// a line glow with a shorter halo, for the curve cells. A sampled curve has
// sharp vertices, and a long halo shows their creases as faint wedges.
fn curveGlow(d: f32, w: f32) -> vec2f { let g = glowLine(d, w); return vec2f(g.x, g.y * exp(-d * 10.0)); }
// the halo takes the hue, the core goes toward white
fn lightRGB(g: vec2f, col: vec3f, gain: f32) -> vec3f {
    return (col * g.y * 1.6 + mix(col, vec3f(1.0), 0.72) * g.x * 2.4) * gain;
}
// a round glowing point of radius r
fn dotGlow(q: vec2f, r: f32) -> f32 {
    let d = length(q); let px = pxw();
    return smoothstep(r + px, max(r - px, 0.0), d) * 1.6 + (r * 1.2 / (d + r * 1.2)) * exp(-d * 9.0);
}
fn heatC() -> vec3f { return u.cream.rgb; }
fn beamC() -> vec3f { return u.tone.rgb; }
fn dangerC() -> vec3f { return mix(u.cream.rgb, vec3f(1.0, 0.16, 0.08), 0.55); }

// ── grounds and the finisher ────────────────────────────────────────────────
fn spaceBg(p: vec2f) -> vec3f {
    let v = clamp(1.0 - 1.4 * dot(p, p), 0.0, 1.0);
    return u.ink.rgb * (0.55 + 0.6 * v) + u.tone.rgb * 0.018 * v;
}
fn floorBg(p: vec2f, cell: f32) -> vec3f {
    let px = pxw();
    let g = abs(fract(p / cell + 0.5) - 0.5) * cell / px;
    let ln = 1.0 - min(min(g.x, g.y), 1.0);
    let v = clamp(1.0 - 1.4 * dot(p, p), 0.0, 1.0);
    return spaceBg(p) + mix(u.ink.rgb, vec3f(0.45, 0.6, 0.75), 0.5) * ln * 0.22 * v;
}
fn tmap(c: vec3f) -> vec3f { return 1.0 - exp(-max(c, vec3f(0.0)) * u.exposure); }
fn fin(bg: vec3f, c: vec3f) -> vec4f {
    let m = tmap(c * u.glow);
    let a = clamp(max(m.r, max(m.g, m.b)), 0.0, 1.0);
    return vec4f(bg * (1.0 - a) + m, 1.0);
}

// ── beam paths ──────────────────────────────────────────────────────────────
fn pathPt(i: i32) -> vec2f {
    var P = array<vec2f, 5>(vec2f(-0.41, -0.27), vec2f(-0.17, 0.17), vec2f(0.02, -0.12), vec2f(0.20, 0.25), vec2f(0.41, 0.03));
    return P[clamp(i, 0, 4)];
}
// x: distance, y: arclength at the closest point, z: total length
fn pathDist(p: vec2f) -> vec3f {
    var best = 1e9; var bs = 0.0; var acc = 0.0;
    for (var i = 0; i < 4; i++) {
        let a = pathPt(i); let b = pathPt(i + 1); let L = distance(a, b);
        let ds = segDS(p, a, b);
        if (ds.x < best) { best = ds.x; bs = acc + ds.y * L; }
        acc += L;
    }
    return vec3f(best, bs, acc);
}
fn wavePt(f: f32, amp: f32) -> vec2f { return vec2f(-0.40 + 0.80 * f, amp * sin(f * 5.0 - 0.9) + 0.05 * f - 0.02); }
// x: distance, y: parameter 0..1 of the closest point, z: unused
fn waveDist(p: vec2f, amp: f32) -> vec3f {
    var best = 1e9; var bf = 0.0; var prev = wavePt(0.0, amp);
    for (var i = 1; i <= 32; i++) {
        let f = f32(i) / 32.0; let c = wavePt(f, amp);
        let ds = segDS(p, prev, c);
        if (ds.x < best) { best = ds.x; bf = (f32(i - 1) + ds.y) / 32.0; }
        prev = c;
    }
    return vec3f(best, bf, 0.0);
}

// ── curves: one jagged control polygon ─────────────────────────────────────
// P2 -> P3 is a short span that steps back against the run of the polygon.
// Uniform Catmull-Rom takes its tangents from the long neighbours, so the
// span overshoots and ties a loop there; centripetal does not.
fn ctlP(i: i32) -> vec2f {
    var P = array<vec2f, 7>(vec2f(-0.41, -0.20), vec2f(-0.27, 0.25), vec2f(-0.03, -0.22),
                            vec2f(-0.10, -0.12), vec2f(0.13, 0.28), vec2f(0.28, -0.17), vec2f(0.41, 0.19));
    return P[clamp(i, 0, 6)];
}
// the ends get mirrored phantom points
fn ctlX(i: i32) -> vec2f {
    if (i < 0) { return 2.0 * ctlP(0) - ctlP(1); }
    if (i > 6) { return 2.0 * ctlP(6) - ctlP(5); }
    return ctlP(i);
}
// Catmull-Rom point on span p1..p2 (Barry-Goldman pyramid). alpha 0 is
// uniform, 0.5 centripetal, 1 chordal.
fn crPt(p0: vec2f, p1: vec2f, p2: vec2f, p3: vec2f, s: f32, alpha: f32) -> vec2f {
    let t1 = pow(max(distance(p0, p1), 1e-4), alpha);
    let t2 = t1 + pow(max(distance(p1, p2), 1e-4), alpha);
    let t3 = t2 + pow(max(distance(p2, p3), 1e-4), alpha);
    let tt = mix(t1, t2, s);
    let a1 = ((t1 - tt) * p0 + tt * p1) / t1;
    let a2 = ((t2 - tt) * p1 + (tt - t1) * p2) / (t2 - t1);
    let a3 = ((t3 - tt) * p2 + (tt - t2) * p3) / (t3 - t2);
    let b1 = ((t2 - tt) * a1 + tt * a2) / t2;
    let b2 = ((t3 - tt) * a2 + (tt - t1) * a3) / (t3 - t1);
    return ((t2 - tt) * b1 + (tt - t1) * b2) / (t2 - t1);
}
// the closest curve point of the last crDist call
var<private> gNear: vec2f;
// distance to the curve sampled as 6 spans x 10 = 60 segments.
// x: distance, y: arclength at the closest point, z: total length
fn crDist(p: vec2f, alpha: f32) -> vec3f {
    var best = 1e9; var bs = 0.0; var acc = 0.0; var prev = ctlP(0);
    var near = prev;
    for (var i = 0; i < 6; i++) {
        let p0 = ctlX(i - 1); let p1 = ctlX(i); let p2 = ctlX(i + 1); let p3 = ctlX(i + 2);
        for (var j = 1; j <= 10; j++) {
            let c = crPt(p0, p1, p2, p3, f32(j) * 0.1, alpha);
            let ds = segDS(p, prev, c); let L = distance(prev, c);
            if (ds.x < best) { best = ds.x; bs = acc + ds.y * L; near = mix(prev, c, ds.y); }
            acc += L; prev = c;
        }
    }
    gNear = near;
    return vec3f(best, bs, acc);
}
// the curve point at arclength s (the same 60 samples)
fn crAt(s: f32, alpha: f32) -> vec2f {
    var acc = 0.0; var prev = ctlP(0);
    for (var i = 0; i < 6; i++) {
        let p0 = ctlX(i - 1); let p1 = ctlX(i); let p2 = ctlX(i + 1); let p3 = ctlX(i + 2);
        for (var j = 1; j <= 10; j++) {
            let c = crPt(p0, p1, p2, p3, f32(j) * 0.1, alpha);
            let L = distance(prev, c);
            if (acc + L >= s) { return mix(prev, c, clamp((s - acc) / max(L, 1e-6), 0.0, 1.0)); }
            acc += L; prev = c;
        }
    }
    return prev;
}
// Chaikin corner cutting at level lvl (0 is the control polygon). Each
// interior corner refines its own three points A B C; the level-n polygon is
// the union of those chains, and each chain stays inside triangle ABC. A
// corner whose triangle is farther than the best hit so far is skipped.
// x: distance to the polygon, y: distance to its vertices
fn chaikin(p: vec2f, lvl: i32) -> vec2f {
    var best = min(segDS(p, ctlP(0), mix(ctlP(0), ctlP(1), 0.5)).x, segDS(p, mix(ctlP(5), ctlP(6), 0.5), ctlP(6)).x);
    var bv = min(length(p - ctlP(0)), length(p - ctlP(6)));
    for (var i = 1; i < 6; i++) {
        let A = ctlP(i - 1); let B = ctlP(i); let C = ctlP(i + 1);
        let td = sdTri(p, A, B, C);
        if (td > best && td > 0.05) { continue; }
        var q: array<vec2f, 34>; var r: array<vec2f, 34>;
        q[0] = A; q[1] = B; q[2] = C; var n = 3;
        for (var l = 0; l < 5; l++) {
            if (l >= lvl) { break; }
            var m = 0;
            for (var e = 0; e < 17; e++) {
                if (e >= n - 1) { break; }
                r[m] = mix(q[e], q[e + 1], 0.25); r[m + 1] = mix(q[e], q[e + 1], 0.75); m += 2;
            }
            q = r; n = m;
        }
        for (var e = 0; e < 33; e++) {
            if (e >= n - 1) { break; }
            best = min(best, segDS(p, q[e], q[e + 1]).x);
            bv = min(bv, length(p - q[e]));
        }
        bv = min(bv, length(p - q[n - 1]));
    }
    return vec2f(best, bv);
}
// signed distance to the union of the corner triangles (the local hull)
fn hullSd(p: vec2f) -> f32 {
    var d = 1e9;
    for (var i = 1; i < 6; i++) { d = min(d, sdTri(p, ctlP(i - 1), ctlP(i), ctlP(i + 1))); }
    return d;
}
// the control polygon and hollow rings at the control points. sc is the
// uv size of one curve unit, so the lines stay one pixel wide.
fn ctlLayer(p: vec2f, sc: f32) -> vec3f {
    var dp = 1e9; var dd = 1e9;
    for (var i = 0; i < 6; i++) { dp = min(dp, segDS(p, ctlP(i), ctlP(i + 1)).x); dd = min(dd, length(p - ctlP(i))); }
    dd = min(dd, length(p - ctlP(6)));
    let px = pxw() / sc;
    let line = smoothstep(px * 1.3, 0.0, dp);
    let ring = smoothstep(px * 1.2, 0.0, abs(dd - 0.011) - px * 0.4);
    return vec3f(0.55, 0.64, 0.82) * (line * 0.32 + ring * 0.9);
}

// ── tracers: ported from BulletTracer.shader ────────────────────────────────
// A capsule a..b read as a lit 3D rod: the cross-section gives the normal.
// LIT BODY: Lambert plus Blinn under an orbiting light (la), on a dim albedo
// tinted from the core color (the _BodyTint idea). EMISSIVE CORE: the
// centreline gradient squared times a streak noise scrolled along the length
// (_ScrollSpeed). FRESNEL RIM: pow(1 - n.z, rimP) in the edge color
// (_RimPower). r0 is the radius at a, r1 at b. rgb out, a is the coverage.
fn litBody(p: vec2f, a: vec2f, b: vec2f, r0: f32, r1: f32, core: vec3f, edge: vec3f,
           la: f32, rimP: f32, scroll: f32, t: f32) -> vec4f {
    let ds = segDS(p, a, b);
    let r = mix(r0, r1, ds.y);
    let px = pxw();
    let cov = smoothstep(r + px, r - px, ds.x);
    let x = clamp(ds.x / r, 0.0, 1.0);
    let side = (p - mix(a, b, ds.y)) / max(ds.x, 1e-6);
    let n = normalize(vec3f(side * x, sqrt(max(1.0 - x * x, 0.0)) + 1e-3));
    let L = normalize(vec3f(cos(la), sin(la), 0.8));
    let H = normalize(L + vec3f(0.0, 0.0, 1.0));
    let diff = max(dot(n, L), 0.0);
    let spec = pow(max(dot(n, H), 0.0), 48.0);
    let streak = 0.6 + 0.4 * vn2(vec2f(ds.y * 5.0 - t * scroll, x * 1.5), 11u);
    let centre = (1.0 - x) * (1.0 - x);
    let fres = pow(1.0 - n.z, rimP);
    let lit = core * 0.35 * (diff * 1.2 + 0.05) + vec3f(spec) * 0.7;
    let emis = core * centre * streak * 2.2 + edge * fres * 2.0;
    let outside = max(ds.x - r, 0.0);
    let bloom = edge * 0.9 * (r * 0.7 / (outside + r * 0.7)) * exp(-outside * 14.0);
    return vec4f((lit + emis) * cov + bloom * (1.0 - cov), cov);
}
fn edgeC() -> vec3f { return mix(u.cream.rgb, vec3f(1.0, 0.22, 0.05), 0.6); }
// age 0 is fresh and white-hot, 1 is cold
fn heatRamp(h0: f32) -> vec3f {
    let h = clamp(1.0 - h0, 0.0, 1.0);
    var c = mix(vec3f(0.35, 0.02, 0.01), vec3f(1.0, 0.18, 0.03), smoothstep(0.0, 0.4, h));
    c = mix(c, u.cream.rgb, smoothstep(0.35, 0.75, h));
    return mix(c, vec3f(1.0, 0.97, 0.9), smoothstep(0.8, 1.0, h));
}

// ── telegraph decals: fwidth anti-alias ─────────────────────────────────────
fn tgFill(d: f32, aa: f32) -> f32 { return clamp(0.5 - d / aa, 0.0, 1.0); }
fn tgRim(d: f32, aa: f32, w: f32) -> f32 { return clamp(1.0 - (abs(d) - w) / aa, 0.0, 1.0); }
fn tgHalo(d: f32, w: f32) -> f32 { return w / (abs(d) + w) * exp(-abs(d) * 18.0); }

// ── shields ─────────────────────────────────────────────────────────────────
// xy: position inside the hex, zw: the hex center (its id)
fn hexCoords(p: vec2f) -> vec4f {
    let r = vec2f(1.0, 1.7320508); let h = r * 0.5;
    let a = p - r * floor(p / r) - h;
    let b = (p - h) - r * floor((p - h) / r) - h;
    let gv = select(b, a, dot(a, a) < dot(b, b));
    return vec4f(gv, p - gv);
}
// 0 at the hex edge, 0.5 at the center
fn hexEdge(gv: vec2f) -> f32 { let q = abs(gv); return 0.5 - max(dot(q, vec2f(0.5, 0.8660254)), q.x); }
// the disc of radius R read as a sphere: the normal, and hex coords that
// crowd toward the rim as a sphere surface does
fn bubbleN(p: vec2f, R: f32) -> vec3f { let q = p / R; return vec3f(q, sqrt(max(1.0 - dot(q, q), 0.0))); }
fn sphereUV(p: vec2f, R: f32) -> vec2f { let q = p / R; let r = min(length(q), 0.999); return q * asin(r) / max(r, 1e-4); }
// x: F1, y: F2 of a jittered cell grid
fn vor(p: vec2f, seed: u32) -> vec2f {
    let i = vec2i(floor(p)); let f = fract(p); var f1 = 9.0; var f2 = 9.0;
    for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
        let o = vec2i(x, y);
        let j = vec2f(hi2(i + o, seed), hi2(i + o, seed + 9u));
        let d = length(vec2f(o) + j - f);
        if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    } }
    return vec2f(f1, f2);
}
fn shieldHalo(p: vec2f, R: f32) -> f32 { let d = max(length(p) - R, 0.0); return 0.02 / (d + 0.02) * exp(-d * 10.0); }
`;

// ── emit pack.wgsl ───────────────────────────────────────────────────────────
const frag = ([name, , , , body, t0]) =>
  `@fragment fn fs_${name}(@builtin(position) fp: vec4f) -> @location(0) vec4f {\n  let uv = buv(fp.xy);\n  let t = u.time + ${(t0 ?? 1.3).toFixed(2)};\n  let k = u.k;\n${body}\n}`;
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
      map: 'y => 0.1 + 1.8 * y', unit: "v => v.toFixed(2) + 'x'" },
    { id: 'weight', title: 'Weight · line width', fn: 'flat', period: 6, amp: 0.4, bias: 0.5, phase: 0,
      map: 'y => Math.pow(2, (y - 0.5) * 3)', unit: "v => v.toFixed(2) + 'x'" },
  ],
  swatches: [
    { id: 'ink', label: 'Space', hex: '#05080f' },
    { id: 'tone', label: 'Beam', hex: '#3cb4ff' },
    { id: 'cream', label: 'Heat', hex: '#ffa046' },
  ],
  // screensaver: calm moving cells, tempo and cell cycle for the table-engine hook (lib/table-engine.js)
  saver: { cells: ['beam_filament', 'beam_draw_on', 'beam_path', 'beam_charge', 'curve_pulse', 'tracer_streak', 'tracer_fan', 'tracer_heat_trail', 'tracer_plasma', 'tracer_chain', 'tg_cone', 'tg_annulus', 'tg_sweep', 'sh_hex', 'sh_bubble', 'sh_multi', 'sh_wall'], tempo: [0.7, 0.3], dpr: 2, cycle: 4, minDwell: 12, fade: 1.5 },
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
<title>Beam, Line &amp; Decal Table // Stella Nova</title>
<!--
  ════════════════════════════════════════════════════════════════════════════
   BEAM, LINE & DECAL TABLE  ·  page shell (GENERATED by build.mjs — do not
   edit by hand)
  ────────────────────────────────────────────────────────────────────────────
   Static markup only. main.js loads the data and hands it to the shared
   table-engine, which builds the sidebar and the frame loop and drives page.js.
   ${CELLS.length} beams, curves, tracers, telegraph decals and shields, one fragment
   shader per cell.
  ════════════════════════════════════════════════════════════════════════════
-->
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=JetBrains+Mono:wght@300;400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="style.css">
</head>
<body>

<script>if(window!==window.top)document.documentElement.classList.add("in-frame")</script>
<div class="grid-bg"></div>
<div class="topbar">
  <div class="topbar-l"><span class="sys-name">Stella Nova</span><span class="sys-status">Beam, Line &amp; Decal Table</span></div>
  <div class="topbar-r">SYS // <strong>WGSL SHADER LAB</strong></div>
</div>
<div id="side">
  <div class="side-head"><div class="big">beam</div><div class="sub">|${CELLS.length} lines · ${Object.keys(FAM).length} families⟩</div></div>
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
//  BEAM, LINE & DECAL TABLE  ·  main.js — data load and boot (GENERATED)
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
//  BEAM, LINE & DECAL TABLE  ·  page.js — the per-page PAGE object (GENERATED)
// ────────────────────────────────────────────────────────────────────────────
//  ${CELLS.length} line and decal shaders; one fragment shader per cell, each reading
//  only a shared uniform buffer (no source texture). The shared table-engine
//  drives this object through its ctx. main.js fetches the data and calls
//  bootTable(PAGE, data); the engine calls PAGE.init and PAGE.draw from there.
//
//  UNIFORM LAYOUT (96 bytes, matches struct BeamU in shaders/pack.wgsl)
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

// ── emit style.css (clone color-table, append the families) ─────────────────
const famCss = Object.entries(FAM).map(([f, c]) =>
  `.f-${f}{--fam:${c};--fam-bg:${c.replace(/[\d.]+\)$/, '0.06)')}}`).join('\n');
const baseCss = readFileSync(join(DIR, '..', 'color-table', 'style.css'), 'utf8');
const css = baseCss + `
/* ── beam families (appended by build.mjs) ───────────────────────────────── */
${famCss}
.side-head .big{color:#5cc4ff}
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
