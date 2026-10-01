// ═══════════════════════════════════════════════════════════════════════════
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

// ── the 40 cells ──────────────────────────────────────────────────────────
@fragment fn fs_beam_segment(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let a = vec2f(-0.36, -0.15);
  let b = mix(a, vec2f(0.36, 0.15), mix(0.55, 1.0, k.z));
  let fl = 1.0 + 0.3 * k.w * vn1(t * 17.0, 5u);
  let ds = segDS(uv, a, b);
  let w = lw(mix(0.0015, 0.008, k.x)) * fl;
  var c = lightRGB(glowLine(ds.x, w), beamC(), mix(0.4, 1.8, k.y) * fl);
  c += (dotGlow(uv - a, 0.012) + dotGlow(uv - b, 0.007)) * mix(beamC(), vec3f(1.0), 0.5);
  return fin(spaceBg(uv), c);
}

@fragment fn fs_beam_filament(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let q = rot2(0.22) * uv;
  let a = vec2f(-0.38, 0.0); let b = vec2f(0.38, 0.0);
  let s = clamp((q.x - a.x) / (b.x - a.x), 0.0, 1.0);
  let ox = max(max(a.x - q.x, q.x - b.x), 0.0);
  let pin = pow(max(sin(PI * s), 0.0), 0.6);
  let amp = mix(0.02, 0.11, k.x);
  var c = lightRGB(glowLine(length(vec2f(ox, q.y)), lw(0.003)), beamC(), 0.8);
  let n = 2 + i32(k.y * 4.0);
  for (var i = 0; i < 6; i++) {
    if (i >= n) { break; }
    let fi = f32(i);
    let off = fbm1(s * mix(5.0, 14.0, k.x) - t * mix(1.5, 6.0, k.z) * (1.0 + 0.37 * fi) + fi * 7.1, u32(i) * 13u + 3u) * amp * pin;
    let d = length(vec2f(ox, q.y - off));
    c += lightRGB(glowLine(d, lw(mix(0.0006, 0.0025, k.w))), mix(beamC(), vec3f(0.85, 0.93, 1.0), 0.35), 0.5);
  }
  c += (dotGlow(q - a, 0.014) + dotGlow(q - b, 0.012)) * mix(beamC(), vec3f(1.0), 0.6);
  return fin(spaceBg(uv), c);
}

@fragment fn fs_beam_arrow(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 0.00;
  let k = u.k;
  let q = rot2(-0.18) * uv;
  let ax = -0.40; let bx = 0.40; let hw = mix(0.03, 0.07, k.y);
  let ux = (q.x - ax) / (bx - ax);
  let ox = max(max(ax - q.x, q.x - bx), 0.0);
  let base = lightRGB(glowLine(length(vec2f(ox, q.y)), lw(0.0022)), beamC(), 0.45);
  // ported: the transiting arrow; the span edges are smoothed here
  let travel = fract(t * mix(0.15, 0.6, k.x) + 0.2);
  let lx = (ux - travel) / max(0.02, mix(0.06, 0.22, k.z));
  let ly = q.y / hw;
  let halfW = clamp(0.5 - lx * 0.5, 0.0, 1.0);
  let edge = 1.0 - smoothstep(halfW - 0.25, halfW + 0.05, abs(ly));
  let span = smoothstep(-1.08, -0.94, lx) * smoothstep(1.03, 0.97, lx) * step(ox, 0.0);
  let arrow = edge * span;
  let pulse = 1.0 + mix(0.0, 2.0, k.w) * (1.0 - smoothstep(0.0, 0.18, travel));
  let moving = (mix(beamC(), vec3f(1.0), 0.8) * 0.8 + beamC() * 0.2) * arrow * 1.4;
  var c = (base + moving) * pulse;
  let tq = q - vec2f(bx, 0.0);
  c += lightRGB(glowLine(abs(length(tq) - 0.028), lw(0.0015)), beamC(), 0.8 * pulse) + dotGlow(tq, 0.006) * beamC();
  c += dotGlow(q - vec2f(ax, 0.0), 0.01) * mix(beamC(), vec3f(1.0), 0.5);
  return fin(spaceBg(uv), c);
}

@fragment fn fs_beam_twinkle(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let q = rot2(0.12) * uv;
  let ax = -0.40; let bx = 0.40; let hw = 0.065;
  let ux = (q.x - ax) / (bx - ax);
  let ox = max(max(ax - q.x, q.x - bx), 0.0);
  var c = lightRGB(glowLine(length(vec2f(ox, q.y)), lw(0.0025)), beamC(), 0.6);
  // ported: Hash21 cell, the on-gate and the phase; each cell lights a
  // jittered point instead of the whole cell block
  let tiling = mix(20.0, 64.0, k.x);
  let gp = vec2f(ux * tiling, (q.y / hw * 0.5 + 0.5) * 6.0);
  let cellp = floor(gp);
  let rr = hash21u(cellp); let rr2 = hash21u(cellp + 19.19);
  let ph = fract(t * (0.6 + 1.8 * rr2) * mix(0.4, 2.0, k.z) + rr);
  let on = step(1.0 - mix(0.15, 0.8, k.y), rr);
  let tw = pow(0.5 + 0.5 * sin(ph * TAU), 3.0);
  let jit = vec2f(fract(rr * 13.7), fract(rr2 * 7.9)) * 0.6 + 0.2;
  let f = (fract(gp) - jit) * vec2f((bx - ax) / tiling, hw / 3.0);
  let d = length(f);
  let env = exp(-pow(q.y / hw, 2.0) * 1.2) * step(ox, 0.0);
  let spark = on * tw * env * (exp(-d * d / 0.0000045) * 2.2 + exp(-abs(f.x) * 900.0 - abs(f.y) * 120.0) * 0.5 + exp(-abs(f.y) * 900.0 - abs(f.x) * 120.0) * 0.5);
  c += mix(beamC(), vec3f(1.0), 0.7) * spark;
  return fin(spaceBg(uv), c);
}

@fragment fn fs_beam_draw_on(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let cyc = fract(t * mix(0.12, 0.4, k.x) + 0.05);
  let rev = smoothstep(0.0, 0.55, cyc);
  let fade = 1.0 - smoothstep(0.82, 1.0, cyc);
  let amp = mix(0.04, 0.16, k.y);
  let w = waveDist(uv, amp);
  let px = pxw();
  let hp = wavePt(rev, amp);
  let dv = select(w.x, length(uv - hp), w.y > rev);
  var c = lightRGB(glowLine(dv, lw(0.0026)), beamC(), 1.0) * fade * step(0.001, rev);
  let hh = mix(0.5, 2.0, k.z) * (1.0 - smoothstep(0.5, 0.62, cyc) * 0.7) * fade;
  c += dotGlow(uv - hp, 0.008) * mix(beamC(), vec3f(1.0), 0.8) * hh;
  c += mix(beamC(), vec3f(1.0), 0.5) * exp(-length(uv - hp) * 30.0) * 0.6 * hh;
  c += dotGlow(uv - wavePt(0.0, amp), 0.01) * beamC() * 0.8;
  c += lightRGB(glowLine(abs(length(uv - wavePt(1.0, amp)) - 0.025), lw(0.0012)), beamC(), 0.4 + 0.6 * step(0.55, cyc) * fade);
  return fin(spaceBg(uv), c);
}

@fragment fn fs_beam_path(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  // each segment glows on its own with its own arclength, so the packet
  // halos are not cut where the closest segment changes at a corner
  let per = mix(0.16, 0.05, k.y);
  var c = vec3f(0.0); var acc = 0.0;
  for (var i = 0; i < 4; i++) {
    let a = pathPt(i); let b = pathPt(i + 1); let L = distance(a, b);
    let ds = segDS(uv, a, b);
    let ph = fract((acc + ds.y * L) / per - t * mix(0.5, 3.0, k.x));
    let pk = exp(-pow((ph - 0.5) * 5.0, 2.0));
    c = max(c, lightRGB(glowLine(ds.x, lw(0.0022)), beamC(), 0.7));
    c += lightRGB(glowLine(ds.x, lw(0.0035) * (0.6 + pk)), mix(beamC(), vec3f(1.0), 0.4), pk * 0.6);
    acc += L;
  }
  for (var i = 0; i < 5; i++) {
    let q = uv - pathPt(i);
    c += dotGlow(q, mix(0.004, 0.012, k.z)) * mix(beamC(), vec3f(1.0), 0.5) * 0.8;
    c += lightRGB(glowLine(abs(length(q) - mix(0.012, 0.03, k.z)), lw(0.001)), beamC(), 0.45);
  }
  return fin(spaceBg(uv), c);
}

@fragment fn fs_beam_impact(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let a = vec2f(-0.46, 0.2); let hp = vec2f(0.2, -0.07);
  let dir = normalize(hp - a); let nrm = vec2f(-dir.y, dir.x);
  let fl = 0.85 + 0.15 * vn1(t * 23.0, 9u);
  let ds = segDS(uv, a, hp);
  var c = lightRGB(glowLine(ds.x, lw(0.0035) * fl), beamC(), fl);
  let q = uv - hp; let r = length(q); let ang = atan2(q.y, q.x);
  let wall = abs(dot(q, dir)) ;
  c += vec3f(0.35, 0.45, 0.6) * 0.35 * smoothstep(pxw() * 1.5, 0.0, abs(dot(q, dir) - 0.004)) * exp(-abs(dot(q, nrm)) * 4.0);
  let fg = mix(0.6, 1.8, k.x) * fl;
  c += mix(beamC(), vec3f(1.0), 0.7) * (0.02 / (r + 0.02)) * exp(-r * 7.0) * 2.2 * fg;
  c += mix(beamC(), vec3f(1.0), 0.4) * exp(-wall * 260.0) * exp(-abs(dot(q, nrm)) * 9.0) * 1.2 * fg;
  let rays = pow(max(cos(ang * 4.0 + t * 0.6), 0.0), 26.0) + 0.7 * pow(max(cos(ang * 7.0 - t * 0.45 + 1.0), 0.0), 40.0);
  c += beamC() * rays * exp(-r * mix(18.0, 7.0, k.z)) * 1.3 * fg;
  for (var i = 0; i < 16; i++) {
    let h = hi1(i, 31u); let h2 = hi1(i, 37u);
    let life = fract(t * (0.7 + 0.9 * h2) + h);
    let sa = atan2(-dir.y, -dir.x) + (h - 0.5) * 2.6;
    let sd = vec2f(cos(sa), sin(sa));
    let g = vec2f(0.0, -0.35) * life * life;
    let pp = hp + sd * life * mix(0.15, 0.32, h2) + g;
    let pt = hp + sd * max(life - 0.08, 0.0) * mix(0.15, 0.32, h2) + g * 0.7;
    let d = segDS(uv, pt, pp);
    c += lightRGB(glowLine(d.x, lw(0.0011)), heatC(), (1.0 - life) * (0.3 + 0.7 * d.y) * mix(0.3, 1.6, k.y));
  }
  return fin(spaceBg(uv), c);
}

@fragment fn fs_beam_charge(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let cyc = fract(t * mix(0.15, 0.45, k.x) + 0.3);
  let a = vec2f(-0.33, 0.02); let b = vec2f(0.44, 0.02);
  let charge = smoothstep(0.0, 0.6, cyc);
  let fire = step(0.6, cyc) * exp(-(cyc - 0.6) * mix(4.0, 12.0, k.y));
  let chg = 1.0 - step(0.6, cyc);
  let r0 = mix(0.006, 0.03, charge) * (1.0 + 0.3 * fire);
  let jit = 1.0 + 0.12 * sin(t * 40.0 * charge) * chg;
  var c = dotGlow(uv - a, r0 * jit) * mix(beamC(), vec3f(1.0), 0.6) * (0.5 + charge + 2.0 * fire);
  c += beamC() * (0.05 / (length(uv - a) + 0.05)) * exp(-length(uv - a) * 5.0) * (0.3 * charge + fire);
  for (var i = 0; i < 14; i++) {
    let h = hi1(i, 3u); let h2 = hi1(i, 7u);
    let life = fract(t * (0.6 + 0.8 * h2) + h);
    let rad = (1.0 - life) * (0.3 - 0.1 * h2);
    let an = h * TAU + life * 2.4;
    let pp = a + vec2f(cos(an), sin(an)) * rad;
    let an2 = an - 0.25;
    let pt = a + vec2f(cos(an2), sin(an2)) * min(rad + 0.04, 0.34);
    let d = segDS(uv, pt, pp);
    c += lightRGB(glowLine(d.x, lw(0.0009)), beamC(), life * chg * (0.3 + 0.7 * charge) * (0.2 + 0.8 * d.y));
  }
  let ds = segDS(uv, a, b);
  let wid = lw(mix(0.004, 0.016, k.z)) * (0.3 + 0.7 * fire);
  c += lightRGB(glowLine(ds.x, wid), beamC(), 1.8 * fire);
  let sr = (cyc - 0.6) * 0.8;
  c += lightRGB(glowLine(abs(length(uv - a) - sr), lw(0.0015)), beamC(), step(0.6, cyc) * exp(-(cyc - 0.6) * 10.0));
  return fin(spaceBg(uv), c);
}

@fragment fn fs_cr_overshoot(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let q = uv - vec2f(0.0, 0.03);
  let cr = crDist(q, 0.0);
  let hs = hullSd(q);
  let px = pxw();
  var c = vec3f(0.5, 0.6, 0.8) * 0.06 * smoothstep(px, -px, hs);
  c += vec3f(0.5, 0.6, 0.8) * 0.22 * smoothstep(px * 1.4, 0.0, abs(hs));
  let out = smoothstep(0.008, 0.02, hullSd(gNear)) * k.z * 2.0;
  let col = mix(heatC(), vec3f(1.0, 0.16, 0.2), clamp(out, 0.0, 1.0));
  c += lightRGB(curveGlow(cr.x, lw(mix(0.0012, 0.004, k.x))), col, 1.0);
  c += ctlLayer(q, 1.0) * 0.8;
  let bs = fract(t * mix(0.05, 0.3, k.y) + 0.35) * cr.z;
  c += dotGlow(q - crAt(bs, 0.0), 0.007) * vec3f(1.0, 0.95, 0.9);
  return fin(spaceBg(uv), c);
}

@fragment fn fs_chaikin_hull(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let q = uv - vec2f(0.0, 0.03);
  let hs = hullSd(q);
  let px = pxw();
  var c = beamC() * 0.09 * mix(0.3, 1.6, k.z) * smoothstep(px, -px, hs);
  c += beamC() * 0.5 * mix(0.3, 1.6, k.z) * smoothstep(px * 1.4, 0.0, abs(hs));
  let ch = chaikin(q, 1 + i32(k.y * 4.99));
  c += lightRGB(curveGlow(ch.x, lw(mix(0.0012, 0.004, k.x))), beamC(), 1.0);
  c += ctlLayer(q, 1.0) * 0.7;
  return fin(spaceBg(uv), c);
}

@fragment fn fs_curve_side_by_side(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let s = 0.84;
  let qt = (uv - vec2f(0.0, 0.215)) / s - vec2f(0.0, 0.03);
  let qb = (uv - vec2f(0.0, -0.255)) / s - vec2f(0.0, 0.03);
  let cr = crDist(qt, 0.0);
  let col = mix(heatC(), vec3f(1.0, 0.16, 0.2), clamp(smoothstep(0.008, 0.02, hullSd(gNear)) * k.y * 2.0, 0.0, 1.0));
  let ch = chaikin(qb, 4);
  let wv = lw(mix(0.0012, 0.004, k.x));
  var c = lightRGB(curveGlow(cr.x * s, wv), col, 1.0);
  c += lightRGB(curveGlow(ch.x * s, wv), beamC(), 1.0);
  c += ctlLayer(qt, s) * 0.6 + ctlLayer(qb, s) * 0.6;
  c += vec3f(0.3, 0.36, 0.45) * 0.4 * smoothstep(pxw(), 0.0, abs(uv.y + 0.02)) * step(abs(uv.x), 0.45);
  return fin(spaceBg(uv), c);
}

@fragment fn fs_curve_overlay(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let q = uv - vec2f(0.0, 0.03);
  let hs = hullSd(q);
  let px = pxw();
  var c = vec3f(0.5, 0.6, 0.8) * 0.07 * mix(0.3, 1.6, k.z) * smoothstep(px, -px, hs);
  c += vec3f(0.5, 0.6, 0.8) * 0.25 * mix(0.3, 1.6, k.z) * smoothstep(px * 1.4, 0.0, abs(hs));
  let cr = crDist(q, 0.0);
  let out = smoothstep(0.008, 0.02, hullSd(gNear));
  let ch = chaikin(q, 1 + i32(k.y * 4.99));
  let wv = lw(mix(0.0012, 0.004, k.x));
  c += lightRGB(curveGlow(cr.x, wv), mix(heatC(), vec3f(1.0, 0.16, 0.2), out), 1.0);
  c += lightRGB(curveGlow(ch.x, wv), beamC(), 1.0);
  c += ctlLayer(q, 1.0) * 0.6;
  return fin(spaceBg(uv), c);
}

@fragment fn fs_chaikin_levels(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 0.00;
  let k = u.k;
  let q = uv - vec2f(0.0, 0.05);
  let lvl = i32(floor(fract(t * mix(0.06, 0.3, k.y) + k.x * 0.999) * 6.0));
  let ch = chaikin(q, lvl);
  let px = pxw();
  var c = ctlLayer(q, 1.0) * 0.45;
  c += lightRGB(curveGlow(ch.x, lw(0.0022)), beamC(), 1.0);
  let vr = mix(0.0065, 0.0028, f32(lvl) / 5.0) * mix(0.4, 1.6, k.z);
  c += vec3f(1.0) * smoothstep(vr + px, vr - px, ch.y) * 0.9;
  for (var i = 0; i < 6; i++) {
    let pq = uv - vec2f(-0.125 + f32(i) * 0.05, -0.33);
    let on = select(0.25, 1.0, i <= lvl);
    c += beamC() * on * smoothstep(0.009 + px, 0.009 - px, length(pq)) * 1.2;
  }
  return fin(spaceBg(uv), c);
}

@fragment fn fs_cr_alpha(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 0.00;
  let k = u.k;
  let q = uv - vec2f(0.0, 0.03);
  let al = clamp(k.x + k.y * 0.6 * sin(t * 0.7), 0.0, 1.0);
  let cu = crDist(q, 0.0);
  let cc = crDist(q, al);
  var c = lightRGB(curveGlow(cu.x, lw(0.0012)), vec3f(1.0, 0.22, 0.28), 0.55);
  c += lightRGB(curveGlow(cc.x, lw(mix(0.0015, 0.004, k.z))), beamC(), 1.1);
  c += ctlLayer(q, 1.0) * 0.6;
  let bx = -0.4 + 0.8 * al;
  c += beamC() * smoothstep(pxw() * 1.2, 0.0, abs(uv.y + 0.34)) * step(abs(uv.x), 0.4) * 0.4;
  c += dotGlow(uv - vec2f(bx, -0.34), 0.007) * mix(beamC(), vec3f(1.0), 0.5);
  return fin(spaceBg(uv), c);
}

@fragment fn fs_curve_dashed(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let q = uv - vec2f(0.0, 0.03);
  let cc = crDist(q, 0.5);
  let per = mix(0.02, 0.07, k.x);
  let fd = fract(cc.y / per - t * mix(0.5, 3.0, k.y));
  let duty = mix(0.2, 0.7, k.z);
  let along = max(min(fd, duty - fd), fd - 1.0) * per;
  let dd = length(vec2f(max(-along, 0.0), cc.x));
  var c = lightRGB(curveGlow(cc.x, lw(0.0008)), beamC(), 0.18);
  c += lightRGB(curveGlow(dd, lw(0.0028)), beamC(), 1.0);
  c += ctlLayer(q, 1.0) * 0.25;
  return fin(spaceBg(uv), c);
}

@fragment fn fs_curve_pulse(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let q = uv - vec2f(0.0, 0.03);
  let cc = crDist(q, 0.5);
  let head = fract(t * mix(0.08, 0.35, k.x) + 0.25) * cc.z;
  let behind = head - cc.y;
  let bb = select(behind + cc.z, behind, behind >= 0.0);
  let tail = exp(-bb / mix(0.05, 0.4, k.y));
  var c = lightRGB(curveGlow(cc.x, lw(0.0012)), beamC(), 0.3);
  let g = curveGlow(cc.x, lw(0.0032) * (0.5 + 0.8 * tail));
  c += (mix(beamC(), vec3f(1.0), 0.72 * tail) * g.x * 2.4 + beamC() * g.y * exp(-cc.x * 60.0) * 1.6) * mix(0.8, 2.2, k.z) * tail;
  let hp = crAt(head, 0.5);
  c += mix(beamC(), vec3f(1.0), 0.7) * dotGlow(uv - vec2f(0.0, 0.03) - hp, 0.007) * mix(0.8, 1.6, k.z);
  return fin(spaceBg(uv), c);
}

@fragment fn fs_tracer_lit(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let dir = normalize(vec2f(1.0, 0.3));
  let r = mix(0.04, 0.085, k.x);
  let lb = litBody(uv, -dir * 0.2, dir * 0.2, r, r, heatC(), edgeC(), t * mix(0.2, 1.4, k.w) + 2.2, mix(1.2, 5.0, k.y), mix(0.3, 3.0, k.z), t);
  return fin(floorBg(uv, 0.1), lb.rgb);
}

@fragment fn fs_tracer_streak(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let q = rot2(-0.12) * uv;
  var c = vec3f(0.0);
  for (var i = 0; i < 3; i++) {
    let fi = f32(i); let h = hi1(i, 21u);
    let spd = mix(0.3, 0.55, h) * mix(0.5, 1.8, k.y);
    let x = fract(t * spd + h) * 1.5 - 0.62;
    let len = mix(0.1, 0.28, k.x) * (1.0 + mix(0.0, 0.8, k.z) * fbm1(t * 3.0 + fi * 5.0, 31u + u32(i)));
    let head = vec2f(x, -0.24 + fi * 0.24);
    let ds = segDS(q, head - vec2f(max(len, 0.02), 0.0), head);
    let rad = mix(0.15, 1.0, ds.y) * lw(0.008);
    let d = max(ds.x - rad, 0.0);
    let sc = 0.65 + 0.35 * vn1(ds.y * len * 70.0 - t * 22.0, 17u + u32(i));
    c += lightRGB(glowLine(d, lw(0.0012)), heatC(), (0.15 + 0.85 * ds.y * ds.y) * sc * 1.1);
    c += dotGlow(q - head, lw(0.004)) * vec3f(1.0, 0.95, 0.85) * 0.6;
  }
  return fin(spaceBg(uv), c);
}

@fragment fn fs_tracer_fan(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let m = vec2f(-0.40, -0.2);
  let spread = mix(0.2, 0.9, k.x);
  var c = vec3f(0.0);
  for (var i = 0; i < 10; i++) {
    let h = hi1(i, 41u); let h2 = hi1(i, 43u);
    let ang = 0.42 + (h - 0.5) * spread;
    let dr = vec2f(cos(ang), sin(ang));
    let life = fract(t * mix(0.35, 0.7, h2) * mix(0.5, 1.8, k.y) + h * 3.1);
    let dist = life * 1.1;
    let hd = m + dr * dist;
    let tl = m + dr * max(dist - mix(0.05, 0.16, k.z), 0.0);
    let ds = segDS(uv, tl, hd);
    let fade = 1.0 - smoothstep(0.7, 1.0, life);
    c += lightRGB(glowLine(ds.x, lw(0.0016)), heatC(), fade * (0.2 + 0.9 * ds.y));
  }
  let mf = 0.6 + 0.4 * vn1(t * 25.0, 7u);
  let q = rot2(-0.42) * (uv - m);
  c += vec3f(1.0, 0.9, 0.7) * dotGlow(uv - m, 0.012) * mf;
  c += heatC() * exp(-abs(q.y) * 120.0 - max(q.x, 0.0) * 18.0 - max(-q.x, 0.0) * 90.0) * 1.6 * mf;
  c += heatC() * exp(-abs(q.x) * 140.0 - abs(q.y) * 30.0) * 0.8 * mf;
  return fin(floorBg(uv, 0.1), c);
}

@fragment fn fs_tracer_ricochet(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let p0 = vec2f(-0.46, 0.32); let hit = vec2f(-0.02, -0.2); let p1 = vec2f(0.46, 0.1);
  let L0 = distance(p0, hit); let L1 = distance(hit, p1); let L = L0 + L1;
  let cyc = fract(t * mix(0.25, 0.7, k.x) + 0.84);
  let head = cyc * L * 1.35;
  let tl = mix(0.05, 0.25, k.y);
  // each leg draws only its lit part [head - 5 tl, head], so no halo is cut
  let a0 = clamp(head - 5.0 * tl, 0.0, L0); let e0 = clamp(head, 0.0, L0);
  let a1 = clamp(head - 5.0 * tl - L0, 0.0, L1); let e1 = clamp(head - L0, 0.0, L1);
  let s0 = segDS(uv, mix(p0, hit, a0 / L0), mix(p0, hit, e0 / L0));
  let s1 = segDS(uv, mix(hit, p1, a1 / L1), mix(hit, p1, e1 / L1));
  let g0 = exp(-(head - mix(a0, e0, s0.y)) / tl) * step(0.001, e0 - a0);
  let g1 = exp(-(head - L0 - mix(a1, e1, s1.y)) / tl) * step(0.001, e1 - a1);
  var c = lightRGB(glowLine(s0.x, lw(0.0022)), heatC(), g0 * 1.4);
  c += lightRGB(glowLine(s1.x, lw(0.0022)), heatC(), g1 * 1.4);
  let hs = clamp(head, 0.0, L);
  let hp = select(mix(hit, p1, (hs - L0) / L1), mix(p0, hit, hs / L0), hs < L0);
  c += dotGlow(uv - hp, lw(0.004)) * vec3f(1.0, 0.95, 0.85) * step(head, L) * 0.8;
  let age = (head - L0) / L;
  let on = step(0.0, age);
  for (var i = 0; i < 12; i++) {
    let h = hi1(i, 51u); let h2 = hi1(i, 57u);
    let sa = mix(0.25, PI - 0.25, h);
    let sd = vec2f(cos(sa), sin(sa));
    let life = clamp(age * (2.0 + 2.0 * h2), 0.0, 1.0);
    let pp = hit + sd * life * mix(0.08, 0.2, h2) + vec2f(0.0, -0.15) * life * life;
    let pt = hit + sd * max(life - 0.1, 0.0) * mix(0.08, 0.2, h2);
    let ds = segDS(uv, pt, pp);
    c += lightRGB(glowLine(ds.x, lw(0.0009)), heatC(), on * (1.0 - life) * mix(0.3, 1.5, k.z));
  }
  let sq = (uv - hit) * vec2f(1.0, 3.0);
  c += heatRamp(clamp(age * 1.5, 0.0, 1.0)) * exp(-dot(sq, sq) * 900.0) * on * exp(-age * 1.5) * 1.5;
  c += vec3f(0.4, 0.48, 0.6) * 0.35 * smoothstep(pxw() * 1.5, 0.0, abs(uv.y - hit.y + 0.004));
  return fin(spaceBg(uv), c);
}

@fragment fn fs_tracer_heat_trail(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let hx = fract(t * mix(0.12, 0.35, k.x) + 0.45) * 1.35 - 0.52;
  let tl = mix(0.3, 0.95, k.y);
  let age = (hx - uv.x) / tl;
  let cy = 0.12 * uv.x - 0.02;
  let wob = fbm2(vec2f(uv.x * 7.0 - t * 0.2, t * 0.6), 5u) * 0.05 * clamp(age, 0.0, 1.0) * mix(0.2, 2.0, k.z);
  let dy = abs(uv.y - cy - wob);
  let m = smoothstep(-0.005, 0.01, age) * (1.0 - smoothstep(0.75, 1.0, age));
  let a = clamp(age, 0.0, 1.0);
  let wid = lw(mix(0.002, 0.02, a));
  let g = glowLine(dy, wid);
  var c = heatRamp(a) * (g.y * 1.4 + g.x * 1.2) * pow(1.0 - a, 1.3) * m * 1.6;
  let hp = vec2f(hx, 0.12 * hx - 0.02);
  let ds = segDS(uv, hp - vec2f(0.05, 0.006), hp);
  c += lightRGB(glowLine(ds.x, lw(0.004)), vec3f(1.0, 0.92, 0.75), 1.0);
  return fin(spaceBg(uv), c);
}

@fragment fn fs_tracer_volley(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let q = rot2(-0.5) * uv;
  let N = 16.0;
  let lane = floor(q.y * N);
  let ly = (fract(q.y * N) - 0.5) / N;
  let li = i32(lane);
  let h = hi1(li, 61u); let h2 = hi1(li, 63u);
  let on = step(1.0 - mix(0.3, 0.95, k.x), h2);
  let per = mix(0.6, 1.3, h);
  let len = mix(0.06, 0.2, k.z) * mix(0.7, 1.3, h2);
  let local = fract((q.x - t * mix(0.5, 1.6, h) * mix(0.5, 1.6, k.y)) / per + h * 7.0) * per;
  let ox = max(local - len, 0.0);
  let d = length(vec2f(ox, ly));
  let br = clamp(local / len, 0.0, 1.0);
  var c = lightRGB(glowLine(d, lw(0.0014)), heatC(), on * (0.15 + 0.9 * br * br) * (1.0 - step(len, local) * 0.9));
  return fin(spaceBg(uv), c);
}

@fragment fn fs_tracer_plasma(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let dir = normalize(vec2f(1.0, -0.22));
  let wob = vec2f(0.0, sin(t * 7.0) * 0.01 * k.z);
  let r = mix(0.045, 0.09, k.x);
  let a = -dir * 0.24 + wob * 2.0; let b = dir * 0.16 + wob;
  let lb = litBody(uv, a, b, r * 0.2, r, mix(beamC(), vec3f(1.0), 0.25), beamC(), t * mix(0.2, 1.4, k.w) + 1.0, mix(1.0, 4.0, k.y), 3.0, t);
  var c = lb.rgb;
  c += beamC() * (0.06 / (length(uv - b) + 0.06)) * exp(-length(uv - b) * 5.0) * 0.6 * (1.0 - lb.a);
  return fin(floorBg(uv, 0.1), c);
}

@fragment fn fs_tracer_chain(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let rate = mix(2.0, 6.0, k.x);
  let gap = 0.1;
  let ph = t * rate;
  let base = floor(ph); let fr = fract(ph);
  let dir = normalize(vec2f(1.0, 0.14));
  let every = 2 + i32(k.z * 4.0);
  var c = vec3f(0.0);
  for (var j = 0; j < 11; j++) {
    let n = i32(base) - j;
    let x = (f32(j) + fr) * gap;
    let jit = (hi1(n, 71u) - 0.5) * 0.06 * k.y * x * 1.5;
    let pos = vec2f(-0.46, -0.08) + dir * x + vec2f(0.0, jit);
    let isT = ((n % every) + every) % every == 0;
    if (isT) {
      let ds = segDS(uv, pos - dir * 0.08, pos);
      c += lightRGB(glowLine(ds.x, lw(0.0024) * mix(0.4, 1.0, ds.y)), heatC(), 0.2 + 1.0 * ds.y);
      c += dotGlow(uv - pos, lw(0.004)) * vec3f(1.0, 0.95, 0.85) * 0.6;
    } else {
      let ds = segDS(uv, pos - dir * 0.02, pos);
      let px = pxw();
      c += vec3f(0.5, 0.42, 0.34) * smoothstep(lw(0.004) + px, lw(0.004) - px, ds.x) * 0.9;
    }
  }
  c += vec3f(1.0, 0.85, 0.6) * dotGlow(uv - vec2f(-0.46, -0.08), 0.01) * (0.4 + 0.6 * fr);
  return fin(floorBg(uv, 0.1), c);
}

@fragment fn fs_tg_disc(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let cyc = fract(t * mix(0.12, 0.45, k.x) + 0.35);
  let R = mix(0.2, 0.42, k.y);
  let d = length(uv) - R;
  let aa = max(fwidth(d), 1e-5);
  let blink = 1.0 + step(0.8, cyc) * 0.8 * (0.5 + 0.5 * sin(t * 40.0));
  let g = 0.5 + 0.5 * smoothstep(-R, 0.0, d);
  var c = heatC() * tgFill(d, aa) * mix(0.06, 0.3, cyc) * g * mix(0.4, 1.6, k.z);
  c += dangerC() * (tgRim(d, aa, lw(0.003)) * 1.6 + tgHalo(d, lw(0.004)) * 0.7) * blink;
  return fin(floorBg(uv, 0.1), c);
}

@fragment fn fs_tg_cone(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let cyc = fract(t * mix(0.12, 0.45, k.x) + 0.3);
  let o = vec2f(0.0, -0.38);
  let q = uv - o;
  let ha = mix(0.25, 1.2, k.y);
  let R = mix(0.45, 0.8, k.z);
  let d = sdPie(q, vec2f(sin(ha), cos(ha)), R);
  let aa = max(fwidth(d), 1e-5);
  let r = length(q);
  let front = R * cyc;
  let inside = tgFill(d, aa);
  var c = heatC() * inside * (0.07 + 0.22 * smoothstep(front + 0.01, front - 0.01, r));
  c += heatC() * inside * exp(-pow((r - front) / 0.012, 2.0)) * 1.2;
  c += dangerC() * (tgRim(d, aa, lw(0.0028)) * 1.5 + tgHalo(d, lw(0.004)) * 0.6);
  c += dangerC() * dotGlow(q, 0.018) * 0.8;
  return fin(floorBg(uv, 0.1), c);
}

@fragment fn fs_tg_lane(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let q = rot2(-0.35) * uv;
  let hw = mix(0.05, 0.13, k.y);
  let d = sdBox(q, vec2f(0.4, hw));
  let aa = max(fwidth(d), 1e-5);
  let cv = (q.x - abs(q.y) * 1.3) * 9.0 - t * mix(0.5, 3.0, k.x);
  let caa = max(fwidth(cv), 1e-5);
  let chev = clamp((0.2 - abs(fract(cv) - 0.5)) / caa + 0.5, 0.0, 1.0);
  let inside = tgFill(d, aa);
  var c = heatC() * inside * (mix(0.05, 0.2, k.z) + chev * 0.45 * smoothstep(-0.4, 0.4, q.x));
  c += dangerC() * (tgRim(d, aa, lw(0.0025)) * 1.4 + tgHalo(d, lw(0.003)) * 0.5);
  return fin(floorBg(uv, 0.1), c);
}

@fragment fn fs_tg_annulus(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let r = length(uv);
  let R0 = mix(0.08, 0.24, k.y); let R1 = 0.42;
  let d = abs(r - (R0 + R1) * 0.5) - (R1 - R0) * 0.5;
  let aa = max(fwidth(d), 1e-5);
  let wave = pow(0.5 + 0.5 * sin(r * 40.0 - t * mix(1.0, 6.0, k.x)), 6.0);
  let inside = tgFill(d, aa);
  var c = heatC() * inside * (0.1 + wave * 0.25 * mix(0.2, 1.8, k.z));
  c += dangerC() * (tgRim(d, aa, lw(0.0025)) * 1.4 + tgHalo(d, lw(0.003)) * 0.5);
  let a = atan2(uv.y, uv.x) / TAU * 24.0 + t * 0.2;
  let tick = clamp((0.08 - abs(fract(a) - 0.5) + 0.42) * r * TAU / 24.0 / pxw(), 0.0, 1.0);
  c += beamC() * tick * step(abs(r - R0 + 0.025), 0.01) * 0.8;
  c += beamC() * 0.06 * smoothstep(R0 - 0.03, 0.0, r);
  return fin(floorBg(uv, 0.1), c);
}

@fragment fn fs_tg_sweep(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let cyc = fract(t * mix(0.15, 0.5, k.x) + 0.1);
  let R = mix(0.25, 0.43, k.y);
  let r = length(uv);
  let d = r - R;
  let aa = max(fwidth(d), 1e-5);
  let rr = R * cyc;
  let inside = tgFill(d, aa);
  let fw = mix(0.006, 0.025, k.z);
  var c = heatC() * inside * (0.05 + 0.2 * smoothstep(rr - 0.15, rr, r) * step(r, rr));
  c += mix(heatC(), vec3f(1.0), 0.3) * inside * exp(-pow((r - rr) / fw, 2.0)) * (0.8 + 0.8 * (1.0 - cyc));
  c += dangerC() * (tgRim(d, aa, lw(0.002)) * 1.1 + tgHalo(d, lw(0.003)) * 0.4);
  return fin(floorBg(uv, 0.1), c);
}

@fragment fn fs_tg_stripes(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let q = rot2(0.3) * uv;
  let hw = mix(0.09, 0.2, k.z);
  let d = sdBox(q, vec2f(0.4, hw));
  let aa = max(fwidth(d), 1e-5);
  let sv = (q.x + q.y) * mix(8.0, 22.0, k.x) - t * mix(0.3, 2.5, k.y);
  let saa = max(fwidth(sv), 1e-5);
  let band = clamp((0.25 - abs(fract(sv) - 0.5)) / saa + 0.5, 0.0, 1.0);
  let inner = sdBox(q, vec2f(0.4, hw) - vec2f(0.018));
  let tape = tgFill(d, aa) * (1.0 - tgFill(inner, aa));
  var c = heatC() * tgFill(inner, aa) * mix(0.04, 0.6, band);
  c += dangerC() * tape * 0.9;
  c += dangerC() * tgHalo(d, lw(0.003)) * 0.4;
  return fin(floorBg(uv, 0.1), c);
}

@fragment fn fs_tg_dashed(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let r = length(uv);
  let R = 0.38;
  let d = r - R;
  let aa = max(fwidth(d), 1e-5);
  let N = floor(mix(12.0, 40.0, k.x));
  let a = atan2(uv.y, uv.x) / TAU;
  let da = pxw() * N / (TAU * max(r, 1e-3));
  let s1 = fract(a * N + t * mix(0.1, 0.8, k.y));
  let dash1 = clamp((0.3 - abs(s1 - 0.5)) / da + 0.5, 0.0, 1.0);
  let N2 = floor(N * 0.6);
  let s2 = fract(a * N2 - t * mix(0.1, 0.8, k.y) * 0.7);
  let dash2 = clamp((0.22 - abs(s2 - 0.5)) / (da * N2 / N) + 0.5, 0.0, 1.0);
  let d2 = r - R * 0.72;
  var c = heatC() * tgFill(d, aa) * mix(0.03, 0.18, k.z);
  c += dangerC() * tgRim(d, aa, lw(0.003)) * dash1 * 1.6;
  c += heatC() * tgRim(d2, aa, lw(0.002)) * dash2 * 1.0;
  c += dangerC() * tgHalo(d, lw(0.003)) * 0.35;
  return fin(floorBg(uv, 0.1), c);
}

@fragment fn fs_tg_footprint(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let cyc = fract(t * mix(0.15, 0.5, k.x) + 0.72);
  let q = rot2(0.18) * (uv - vec2f(0.0, -0.02));
  let sole = sdEllipseA(q - vec2f(0.005, 0.03), vec2f(0.12, 0.17));
  let heel = sdEllipseA(q - vec2f(0.02, -0.19), vec2f(0.095, 0.085));
  let t1 = sdEllipseA(q - vec2f(-0.085, 0.235), vec2f(0.045, 0.058));
  let t2 = sdEllipseA(q - vec2f(-0.015, 0.275), vec2f(0.036, 0.046));
  let t3 = sdEllipseA(q - vec2f(0.045, 0.268), vec2f(0.031, 0.04));
  let t4 = sdEllipseA(q - vec2f(0.095, 0.24), vec2f(0.027, 0.034));
  let t5 = sdEllipseA(q - vec2f(0.132, 0.2), vec2f(0.023, 0.028));
  let kb = mix(0.005, 0.03, k.y);
  let toes = smin(smin(smin(smin(t1, t2, kb), t3, kb), t4, kb), t5, kb);
  let d = smin(smin(sole, heel, 0.07), toes, kb);
  let aa = max(fwidth(d), 1e-5);
  let inside = tgFill(d, aa);
  let charge = smoothstep(0.0, 0.85, cyc);
  var c = heatC() * inside * (0.05 + mix(0.1, 0.4, k.z) * charge * (0.6 + 0.4 * smoothstep(-0.08, 0.0, d)));
  c += dangerC() * (tgRim(d, aa, lw(0.0025)) * (1.0 + charge) + tgHalo(d, lw(0.003)) * 0.5);
  let hitA = step(0.85, cyc) * (cyc - 0.85) / 0.15;
  c += mix(dangerC(), vec3f(1.0), 0.3) * step(0.85, cyc) * exp(-pow((length(uv) - hitA * 0.5 - 0.05) / 0.012, 2.0)) * (1.0 - hitA) * 1.6;
  return fin(floorBg(uv, 0.1), c);
}

@fragment fn fs_tg_countdown(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let cyc = fract(t * mix(0.1, 0.4, k.x) + 0.35);
  let r = length(uv);
  let R = 0.3;
  let d = abs(r - R) - 0.024;
  let aa = max(fwidth(d), 1e-5);
  let a = fract(0.25 - atan2(uv.y, uv.x) / TAU);
  let remain = 1.0 - cyc;
  let da = pxw() / (TAU * R);
  let arc = clamp((remain - a) / da + 0.5, 0.0, 1.0);
  let ring = tgFill(d, aa);
  var c = heatC() * ring * mix(0.06, 1.1, arc);
  c += dangerC() * tgRim(d, aa, lw(0.0015)) * 0.6;
  let hp = vec2f(sin(remain * TAU), cos(remain * TAU)) * R;
  c += vec3f(1.0, 0.9, 0.75) * dotGlow(uv - hp, 0.012) * 0.8;
  let nt = floor(mix(8.0, 24.0, k.y));
  let tk = abs(fract(a * nt + 0.5) - 0.5) * TAU * R / nt;
  c += dangerC() * clamp((lw(0.0025) - tk) / pxw() + 0.5, 0.0, 1.0) * step(abs(r - R - 0.055), 0.013) * 0.8;
  let beat = pow(0.5 + 0.5 * cos(t * mix(3.0, 20.0, cyc) * mix(0.5, 1.5, k.z)), 4.0);
  c += dangerC() * dotGlow(uv, 0.03 + 0.012 * beat) * (0.4 + 0.8 * beat);
  c += vec3f(1.0, 0.85, 0.7) * smoothstep(0.96, 1.0, cyc) * exp(-r * 4.0) * 1.5;
  return fin(floorBg(uv, 0.1), c);
}

@fragment fn fs_tg_line_sweep(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let cyc = fract(t * mix(0.15, 0.5, k.x) + 0.2);
  let q = rot2(-0.25) * uv;
  let x0 = -0.42; let L = 0.84;
  let hw = mix(0.035, 0.1, k.y);
  let len = L * smoothstep(0.0, 0.85, cyc);
  let lane = sdBox(q - vec2f(x0 + L * 0.5, 0.0), vec2f(L * 0.5, hw));
  let body = sdBox(q - vec2f(x0 + len * 0.5, 0.0), vec2f(max(len * 0.5, 1e-4), hw));
  let aa = max(fwidth(lane), 1e-5);
  var c = heatC() * tgFill(body, aa) * (0.12 + 0.35 * smoothstep(hw, 0.0, abs(q.y)));
  c += dangerC() * tgRim(lane, aa, lw(0.0015)) * 0.7;
  let hx = abs(q.x - x0 - len);
  c += mix(heatC(), vec3f(1.0), 0.4) * exp(-hx * mix(120.0, 40.0, k.z)) * step(abs(q.y), hw) * 1.4;
  let rails = tgRim(abs(q.y) - hw * 0.8, aa, lw(0.0012)) * step(q.x, x0 + len) * step(x0, q.x);
  c += heatC() * rails * 0.8;
  return fin(floorBg(uv, 0.1), c);
}

@fragment fn fs_sh_hex(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let R = 0.38;
  let n = bubbleN(uv, R);
  let px = pxw();
  let cov = smoothstep(R + px, R - px, length(uv));
  let hc = hexCoords(sphereUV(uv, R) * mix(4.0, 10.0, k.x));
  let e = hexEdge(hc.xy);
  let etch = smoothstep(0.07, 0.0, e);
  let cyc = fract(t * mix(0.2, 0.6, k.y) + 0.15);
  let ci = i32(floor(t * mix(0.2, 0.6, k.y) + 0.15));
  let ia = hi1(ci, 91u) * TAU;
  let I = vec2f(cos(ia), sin(ia)) * R * 0.6;
  let dI = length(uv - I);
  let ring = exp(-pow((dI - cyc * 0.8) / 0.03, 2.0)) * (1.0 - cyc) + 0.6 * exp(-pow((dI - cyc * 0.5) / 0.02, 2.0)) * (1.0 - cyc);
  let fres = pow(1.0 - n.z, 2.5);
  var c = beamC() * (0.03 + fres * 1.3) * cov;
  c += beamC() * etch * (mix(0.05, 0.3, k.z) + 0.25 * fres + ring * 2.5) * cov;
  c += mix(beamC(), vec3f(1.0), 0.6) * (ring * 0.5 + exp(-dI * 30.0) * exp(-cyc * 6.0) * 2.0) * cov;
  c += beamC() * shieldHalo(uv, R) * 0.5;
  return fin(spaceBg(uv), c);
}

@fragment fn fs_sh_bubble(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let R = 0.38;
  let n = bubbleN(uv, R);
  let px = pxw();
  let cov = smoothstep(R + px, R - px, length(uv));
  let fres = pow(1.0 - n.z, mix(1.5, 5.0, 1.0 - k.x));
  let sp = sphereUV(uv, R);
  let cz = 1.0 - abs(fbm2(sp * 3.0 + vec2f(t * 0.2, -t * 0.15) * mix(0.3, 2.0, k.z), 13u));
  let caustic = pow(cz, 8.0) * mix(0.1, 0.8, k.y) * n.z;
  let la = t * 0.3 + 2.2;
  let L = normalize(vec3f(cos(la), sin(la), 0.7));
  let H = normalize(L + vec3f(0.0, 0.0, 1.0));
  let spec = pow(max(dot(n, H), 0.0), 90.0);
  let back = pow(max(dot(n, -vec3f(L.xy, -L.z)), 0.0), 6.0) * fres;
  var c = beamC() * (0.02 + fres * 1.6 + caustic) * cov;
  c += vec3f(1.0) * spec * 1.2 * cov + mix(beamC(), vec3f(1.0), 0.5) * back * 0.8 * cov;
  c += beamC() * shieldHalo(uv, R) * 0.6;
  return fin(spaceBg(uv), c);
}

@fragment fn fs_sh_hit_flash(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let R = 0.38;
  let n = bubbleN(uv, R);
  let px = pxw();
  let cov = smoothstep(R + px, R - px, length(uv));
  let rate = mix(0.3, 0.9, k.x);
  let ph = t * rate + 0.3;
  let ci = i32(floor(ph));
  let age = fract(ph) / rate;
  let ia = hi1(ci, 71u) * TAU;
  let I = vec2f(cos(ia), sin(ia)) * R * 0.88;
  let dI = length(uv - I);
  let flash = exp(-age * mix(3.0, 14.0, k.y));
  let spot = exp(-dI * mix(22.0, 8.0, k.z)) * exp(-age * 2.0);
  let hc = hexCoords(sphereUV(uv, R) * 7.0);
  let etch = smoothstep(0.08, 0.0, hexEdge(hc.xy));
  let fres = pow(1.0 - n.z, 2.5);
  let tint = mix(beamC(), vec3f(1.0), flash * 0.6);
  var c = tint * (0.03 + fres * (1.1 + 2.0 * flash) + flash * 0.25) * cov;
  c += tint * etch * (0.06 + spot * 3.0 + flash * 0.5) * cov;
  c += vec3f(1.0) * exp(-dI * 40.0) * flash * 2.0 * cov;
  for (var i = 0; i < 8; i++) {
    let h = hi1(i + ci * 8, 73u);
    let sa = ia + (h - 0.5) * 2.0;
    let life = clamp(age * 2.0, 0.0, 1.0);
    let pp = I + vec2f(cos(sa), sin(sa)) * life * 0.15;
    let pt = I + vec2f(cos(sa), sin(sa)) * max(life - 0.12, 0.0) * 0.15;
    c += lightRGB(glowLine(segDS(uv, pt, pp).x, lw(0.001)), mix(beamC(), vec3f(1.0), 0.5), (1.0 - life));
  }
  c += beamC() * shieldHalo(uv, R) * (0.4 + flash);
  return fin(spaceBg(uv), c);
}

@fragment fn fs_sh_cracked(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let R = 0.38;
  let n = bubbleN(uv, R);
  let px = pxw();
  let cov = smoothstep(R + px, R - px, length(uv));
  let sp = sphereUV(uv, R);
  let hc = hexCoords(sp * 7.0);
  let etch = smoothstep(0.08, 0.0, hexEdge(hc.xy));
  let dead = step(hi2(vec2i(floor(hc.zw * 2.0 + 0.5)), 83u), mix(0.1, 0.6, k.x));
  let fl = mix(1.0, 0.35 + 0.65 * step(0.3, hi1(i32(floor(t * 13.0)), 81u)), k.z);
  let vr = vor(sp * mix(2.0, 4.5, k.y) + 3.0, 87u);
  let crack = smoothstep(0.05, 0.0, vr.y - vr.x);
  let run = 0.5 + 0.5 * sin(vr.x * 30.0 - t * 5.0);
  let fres = pow(1.0 - n.z, 2.5);
  let col = mix(beamC(), heatC(), 0.35);
  var c = col * (0.02 + fres * 0.7) * cov * fl;
  c += col * etch * (1.0 - dead) * 0.18 * cov * fl;
  c += col * (1.0 - dead) * 0.05 * cov * fl;
  c += mix(col, vec3f(1.0), 0.5) * crack * (0.6 + 1.2 * run) * cov * (0.6 + 0.4 * fl);
  c += dangerC() * etch * dead * 0.15 * cov;
  c += col * shieldHalo(uv, R) * 0.3 * fl;
  return fin(spaceBg(uv), c);
}

@fragment fn fs_sh_multi(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let R = 0.38;
  let n = bubbleN(uv, R);
  let px = pxw();
  let cov = smoothstep(R + px, R - px, length(uv));
  let hc = hexCoords(sphereUV(uv, R) * mix(5.0, 11.0, k.y));
  let etch = smoothstep(0.08, 0.0, hexEdge(hc.xy));
  var ring = 0.0; var spot = 0.0;
  for (var i = 0; i < 3; i++) {
    let ph = t * mix(0.2, 0.55, k.x) + f32(i) / 3.0;
    let cyc = fract(ph);
    let ci = i32(floor(ph)) * 3 + i;
    let ia = hi1(ci, 97u) * TAU;
    let I = vec2f(cos(ia), sin(ia)) * R * mix(0.3, 0.8, hi1(ci, 99u));
    let dI = length(uv - I);
    ring += exp(-pow((dI - cyc * 0.7) / mix(0.015, 0.05, k.z), 2.0)) * (1.0 - cyc);
    spot += exp(-dI * 35.0) * exp(-cyc * 8.0);
  }
  let fres = pow(1.0 - n.z, 2.5);
  var c = beamC() * (0.03 + fres * 1.2 + ring * 0.25) * cov;
  c += beamC() * etch * (0.1 + ring * 2.2) * cov;
  c += mix(beamC(), vec3f(1.0), 0.7) * (spot * 2.0 + max(ring - 1.0, 0.0) * 1.5) * cov;
  c += beamC() * shieldHalo(uv, R) * 0.5;
  return fin(spaceBg(uv), c);
}

@fragment fn fs_sh_wall(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = buv(fp.xy);
  let t = u.time + 1.30;
  let k = u.k;
  let b = vec2f(0.3, 0.4);
  let d = sdRoundBox(uv, b, 0.05);
  let px = pxw();
  let cov = smoothstep(px, -px, d);
  let edge = exp(d * mix(15.0, 45.0, 1.0 - k.z));
  let hc = hexCoords(uv * 16.0);
  let etch = smoothstep(0.08, 0.0, hexEdge(hc.xy));
  let scan = pow(0.5 + 0.5 * sin(uv.y * 14.0 - t * mix(1.0, 5.0, k.x)), 12.0);
  var hit = 0.0; var ring = 0.0;
  for (var i = 0; i < 3; i++) {
    let ph = t * mix(0.3, 0.9, k.y) + f32(i) / 3.0;
    let cyc = fract(ph);
    let ci = i32(floor(ph)) * 3 + i;
    let I = (vec2f(hi1(ci, 101u), hi1(ci, 103u)) - 0.5) * b * 1.6;
    let dI = length(uv - I);
    ring += exp(-pow((dI - cyc * 0.3) / 0.012, 2.0)) * (1.0 - cyc);
    hit += exp(-dI * 50.0) * exp(-cyc * 8.0);
  }
  var c = beamC() * (0.04 + edge * 1.2 + scan * 0.12) * cov;
  c += beamC() * etch * (0.08 + scan * 0.35 + ring * 2.0) * cov;
  c += mix(beamC(), vec3f(1.0), 0.7) * (hit * 2.5 + ring * 0.4) * cov;
  c += beamC() * 0.5 * (0.012 / (max(d, 0.0) + 0.012)) * exp(-max(d, 0.0) * 12.0) * (1.0 - cov);
  return fin(spaceBg(uv), c);
}
