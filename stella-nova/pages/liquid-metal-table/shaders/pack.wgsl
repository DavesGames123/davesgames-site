// ═══════════════════════════════════════════════════════════════════════════
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

// ── the 73 cells ──────────────────────────────────────────────────────────
@fragment fn fs_quicksilver(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let sc = mix(1.4, 3.0, k.x); let amt = mix(1.2, 3.0, k.y); let tt = t * mix(0.5, 1.8, k.z);
  let e_ = 0.75 * px() + 0.001;
  let h_ = hWarp(p, tt, sc, amt, 3u);
  let n = normalize(vec3f(-(hWarp((p + vec2f(e_, 0.0)), tt, sc, amt, 3u) - h_) / e_ * 0.55, -(hWarp((p + vec2f(0.0, e_)), tt, sc, amt, 3u) - h_) / e_ * 0.55, 1.0));
  return present(chrome(n, metalF0(), 0.0));
}

@fragment fn fs_mercury_pool(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let rate = mix(0.12, 0.4, k.x); let amp = mix(0.0015, 0.005, k.y);
  let e_ = 0.75 * px() + 0.001;
  let h_ = hPool(p, t, rate, amp);
  let n = normalize(vec3f(-(hPool((p + vec2f(e_, 0.0)), t, rate, amp) - h_) / e_ * 1.0, -(hPool((p + vec2f(0.0, e_)), t, rate, amp) - h_) / e_ * 1.0, 1.0));
  let nb = normalize(n + vec3f(0.0, 0.5 * p.y + 0.12, 0.0));
  return present(chrome(nb, metalF0(), mix(-0.6, 0.6, k.z)));
}

@fragment fn fs_hammered(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let sc = mix(5.0, 12.0, k.x); let dep = mix(0.5, 1.4, k.y);
  let e_ = 0.75 * px() + 0.001;
  let h_ = hHammer(p, sc, dep);
  let n = normalize(vec3f(-(hHammer((p + vec2f(e_, 0.0)), sc, dep) - h_) / e_ * 1.0, -(hHammer((p + vec2f(0.0, e_)), sc, dep) - h_) / e_ * 1.0, 1.0));
  let spin = sin(t * 0.4) * mix(0.2, 1.2, k.z);
  return present(chrome(n, mix(metalF0(), u.cream.rgb, 0.15), spin));
}

@fragment fn fs_brushed_plate(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let g = gnoise(vec2f(p.x * 4.0, p.y * mix(250.0, 600.0, k.x)), 7u) * 0.6 + gnoise(vec2f(p.x * 9.0, p.y * 1100.0), 8u) * 0.4;
  let n = normalize(vec3f(p.x * 0.5, p.y * 0.5 + g * 0.03, 1.0));
  var c = env(reflect(-VIEW, n), 0.0) * fres(metalF0(), n.z) * (0.72 + 0.28 * g);
  let lx = 0.3 * sin(t * mix(0.3, 0.9, k.z));
  let dx = p.x - lx; let dx2 = p.x + lx * 0.6 + 0.12;
  let w = mix(700.0, 60.0, k.y);
  c += u.cream.rgb * exp(-dx * dx * w) * (0.7 + 0.3 * g) * 1.1;
  c += u.tone.rgb * exp(-dx2 * dx2 * w * 0.5) * (0.7 + 0.3 * g) * 0.5;
  return present(c);
}

@fragment fn fs_spun_disc(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let r = length(p) + 1e-4; let a = atan2(p.y, p.x); let R = 0.43;
  let g = gnoise(vec2f(r * mix(400.0, 1000.0, k.x), a * 2.0), 12u) * 0.6 + gnoise(vec2f(r * 1600.0, a * 5.0), 13u) * 0.4;
  let groove = 0.8 + 0.2 * smoothstep(0.0, 0.25, abs(fract(r * 22.0) - 0.5));
  let la = t * mix(0.2, 0.8, k.z);
  let lobe = pow(abs(cos(a - la)), mix(60.0, 6.0, k.y));
  let n = normalize(vec3f(p * 0.35, 1.0));
  var c = env(reflect(-VIEW, n), la) * fres(metalF0(), n.z) * 0.55 * (0.8 + 0.2 * g) * groove;
  c += mix(u.tone.rgb, u.cream.rgb, 0.7) * lobe * (0.25 + 0.9 * r / R) * (0.65 + 0.35 * g) * groove;
  let rim = smoothstep(R - 0.025, R, r);
  c = mix(c, tubeShade((r - (R - 0.0125)) / 0.0125, p / r, metalF0(), la), rim);
  let hub = smoothstep(0.055, 0.05, r);
  c = mix(c, chrome(normalize(vec3f(p / 0.055 * 0.8, 1.0)), metalF0(), la), hub);
  let m = smoothstep(R + px(), R - px(), r);
  let bg = u.ink.rgb + u.tone.rgb * 0.05 * exp(-r * 3.0);
  return present(mix(bg, c, m));
}

@fragment fn fs_liquid_gold(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let sc = mix(0.7, 1.5, k.x); let amt = mix(1.2, 2.6, k.y); let tt = t * mix(0.3, 1.2, k.z);
  let e_ = 0.75 * px() + 0.001;
  let h_ = hWarp(p * vec2f(1.0, 1.3), tt, sc, amt, 11u);
  let n = normalize(vec3f(-(hWarp((p + vec2f(e_, 0.0)) * vec2f(1.0, 1.3), tt, sc, amt, 11u) - h_) / e_ * 0.7, -(hWarp((p + vec2f(0.0, e_)) * vec2f(1.0, 1.3), tt, sc, amt, 11u) - h_) / e_ * 0.7, 1.0));
  return present(chrome(n, vec3f(1.0, 0.74, 0.32), 0.3));
}

@fragment fn fs_silk_ribbons(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let n = i32(mix(6.0, 14.0, k.x));
  let c = silk(p, t, n, mix(0.12, 0.3, k.z), 0.05, mix(0.4, 1.6, k.y), 1.0, 1.0);
  return present(u.ink.rgb + c);
}

@fragment fn fs_prism_ribbons(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let n = i32(mix(5.0, 8.0, k.z));
  let o = vec2f(0.0, mix(0.004, 0.03, k.x)); let tw = mix(0.5, 1.5, k.y);
  let lw = vec3f(0.33);
  let r = dot(silk(p + o, t, n, 0.22, 0.045, tw, 0.8, 4.0), lw);
  let g = dot(silk(p, t + 0.05, n, 0.22, 0.045, tw, 0.8, 4.0), lw);
  let b = dot(silk(p - o, t + 0.1, n, 0.22, 0.045, tw, 0.8, 4.0), lw);
  return present(u.ink.rgb + vec3f(r, g, b) * 1.6);
}

@fragment fn fs_cinched_silk(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let q = rot2(-0.7) * p;
  let waist = 1.0 - mix(0.6, 0.93, k.x) * exp(-q.x * q.x / 0.02);
  let c = silk(vec2f(q.x * 1.3, q.y / waist), t, i32(mix(7.0, 14.0, k.z)), 0.24, 0.05, mix(0.5, 1.8, k.y), 1.0, 7.0);
  return present(u.ink.rgb + c * mix(1.0, 1.35, 1.0 - waist));
}

@fragment fn fs_thread_veil(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let c = silk(p, t * 0.8, i32(mix(12.0, 24.0, k.x)), mix(0.14, 0.34, k.y), 0.006, mix(0.3, 1.2, k.z), 3.0, 13.0);
  return present(u.ink.rgb + c * 1.3);
}

@fragment fn fs_satin_drape(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let f = mix(12.0, 26.0, k.x); let tt = t * mix(0.4, 1.4, k.z);
  let e_ = 0.75 * px() + 0.001;
  let h_ = hDrape(p, tt, f);
  let n = normalize(vec3f(-(hDrape((p + vec2f(e_, 0.0)), tt, f) - h_) / e_ * 1.0, -(hDrape((p + vec2f(0.0, e_)), tt, f) - h_) / e_ * 1.0, 1.0));
  let l = normalize(vec3f(-0.45, 0.55, 0.7));
  let diff = max(dot(n, l), 0.0);
  let r = reflect(-VIEW, n);
  let sh = pow(max(dot(r, l), 0.0), mix(6.0, 30.0, k.y));
  let cloth = mix(u.tone.rgb, vec3f(0.55, 0.35, 0.75), 0.35);
  let hv = normalize(l + VIEW);
  let sat = pow(max(dot(n, hv), 0.0), mix(20.0, 90.0, k.y));
  var c = cloth * (0.03 + 0.7 * diff * diff) + mix(cloth, u.cream.rgb, 0.4) * sh * 0.5 + mix(cloth, u.cream.rgb, 0.7) * sat * 1.8;
  c += env(r, 0.0) * fres(vec3f(0.04), n.z) * 0.35;
  return present(c);
}

@fragment fn fs_chrome_rings(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let nr = mix(4.0, 11.0, k.x); let fl = mix(0.6, 0.95, k.z);
  let r = length(p) + 1e-4;
  let x = r * nr - t * mix(0.05, 0.5, k.y);
  let s = (fract(x) - 0.5) * 2.0 / fl;
  let m = bandMask(s, 2.0 * px() * nr / fl);
  let c = tubeShade(s, p / r, metalF0(), 0.0);
  return present(mix(u.ink.rgb, c, m));
}

@fragment fn fs_wavy_bands(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let nb = mix(5.0, 12.0, k.x); let a = mix(0.1, 0.6, k.y); let tt = t * mix(0.3, 1.2, k.z);
  let e = px();
  let f0 = p.y * nb + a * (sin(p.x * 5.0 + tt * 0.7) + 2.2 * fbm(p * 2.0 + vec2f(0.08 * tt, 0.0), 3, 31u));
  let fx = (p.y) * nb + a * (sin((p.x + e) * 5.0 + tt * 0.7) + 2.2 * fbm((p + vec2f(e, 0.0)) * 2.0 + vec2f(0.08 * tt, 0.0), 3, 31u));
  let fy = (p.y + e) * nb + a * (sin(p.x * 5.0 + tt * 0.7) + 2.2 * fbm((p + vec2f(0.0, e)) * 2.0 + vec2f(0.08 * tt, 0.0), 3, 31u));
  let g = vec2f(fx - f0, fy - f0) / e;
  let gl = max(length(g), 1e-3);
  let s = (fract(f0) - 0.5) * 2.0 / 0.86;
  let m = bandMask(s, 2.0 * px() * gl / 0.86);
  return present(mix(u.ink.rgb, tubeShade(s, g / gl, metalF0(), 0.0), m));
}

@fragment fn fs_twisted_wires(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  var c = u.ink.rgb + u.tone.rgb * 0.04 * (0.5 - p.y);
  let nw = i32(mix(3.0, 6.0, k.x));
  for (var i: i32 = 0; i < 6; i++) {
    if (i >= nw) { break; }
    let fi = f32(i);
    let om = 3.0 + fi * 0.7; let A = 0.1;
    let ph = p.x * om + t * mix(0.3, 1.2, k.z) * (0.7 + 0.2 * fi) + fi * 1.3;
    let cy = (fi / max(f32(nw) - 1.0, 1.0) - 0.5) * 0.7 + A * sin(ph);
    let dc = A * om * cos(ph);
    let sl = sqrt(1.0 + dc * dc);
    let R = 0.04;
    let s = (p.y - cy) / sl / R;
    let dir = vec2f(-dc, 1.0) / sl;
    let tg = vec2f(dir.y, -dir.x);
    let st = fract(p.x * sl * mix(12.0, 30.0, k.y) + asin(clamp(s, -1.0, 1.0)) / PI * 1.5) - 0.5;
    let n = normalize(vec3f(dir * s + tg * st * 0.9, sqrt(max(1.0 - s * s, 0.0))));
    let w = chrome(n, mix(metalF0(), u.cream.rgb, 0.1 * fi), 0.0) * (0.35 + 0.65 * (1.0 - 4.0 * st * st)) * (0.5 + 0.5 * sqrt(max(1.0 - s * s, 0.0)));
    let m = bandMask(s, 2.0 * px() / R);
    c = mix(c * (1.0 - 0.6 * exp(-s * s * 0.3) * step(1.0, abs(s))), w, m);
  }
  return present(c);
}

@fragment fn fs_spiral_coil(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let r = length(p) + 1e-4; let a = atan2(p.y, p.x);
  let K = mix(3.0, 8.0, k.x); let m = floor(mix(1.0, 5.0, k.z));
  let f = log(r) * K + a * m / TAU - t * mix(0.1, 0.6, k.y);
  let g = (K * p + (m / TAU) * vec2f(-p.y, p.x)) / (r * r);
  let gl = length(g);
  let s = (fract(f) - 0.5) * 2.0 / 0.85;
  let mk = bandMask(s, 2.0 * px() * gl / 0.85) * smoothstep(0.015, 0.07, r);
  return present(mix(u.ink.rgb, tubeShade(s, g / gl, metalF0(), 0.0), mk));
}

@fragment fn fs_hoop_weave(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let nr = mix(5.0, 10.0, k.x); let fl = mix(0.55, 0.85, k.z);
  let c1 = vec2f(-0.16, 0.0) + 0.1 * vec2f(sin(t * mix(0.2, 0.7, k.y)), cos(t * 0.3));
  let c2 = vec2f(0.16, 0.0) + 0.1 * vec2f(cos(t * 0.4), sin(t * mix(0.2, 0.7, k.y) + 1.0));
  let d1 = p - c1; let d2 = p - c2;
  let r1 = length(d1) + 1e-4; let r2 = length(d2) + 1e-4;
  let x1 = r1 * nr; let x2 = r2 * nr;
  let s1 = (fract(x1) - 0.5) * 2.0 / fl; let s2 = (fract(x2) - 0.5) * 2.0 / fl;
  let aa = 2.0 * px() * nr / fl;
  let m1 = bandMask(s1, aa); let m2 = bandMask(s2, aa);
  let A = tubeShade(s1, d1 / r1, metalF0(), 0.0);
  let B = tubeShade(s2, d2 / r2, vec3f(1.0, 0.78, 0.45), 0.0);
  let top1 = ((i32(floor(x1)) + i32(floor(x2))) & 1) == 0;
  let aOnTop = mix(mix(u.ink.rgb, B, m2), A, m1);
  let bOnTop = mix(mix(u.ink.rgb, A, m1), B, m2);
  return present(select(bOnTop, aOnTop, top1));
}

@fragment fn fs_organ_pipes(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let np = floor(mix(7.0, 14.0, k.x)); let fl = mix(0.7, 0.92, k.z);
  let xi = p.x * np; let id = floor(xi); let lx = fract(xi) - 0.5;
  let cx = (id + 0.5) / np;
  let top = 0.36 - 0.9 * cx * cx + 0.04 * rnd1(id + 3.0);
  let s = lx * 2.0 / fl;
  let spin = t * mix(0.1, 0.5, k.y);
  let f0 = select(metalF0(), vec3f(1.0, 0.74, 0.36), (i32(id) & 1) == 1);
  var c = tubeShade(s, vec2f(1.0, 0.0), f0, spin);
  let mouth = smoothstep(0.02, 0.0, abs(p.y + 0.22) - 0.02 * (1.0 - abs(s))) * step(abs(s), 0.6);
  c = mix(c, u.ink.rgb * 0.5, mouth);
  let ey = (p.y - top) / (0.03 * fl);
  let ell = s * s + ey * ey;
  let hole = smoothstep(0.75, 0.6, ell);
  let body = step(p.y, top) * step(-0.45, p.y) + smoothstep(1.0, 0.9, ell);
  c = mix(c, u.ink.rgb * 0.3, hole);
  let m = bandMask(s, 2.0 * px() * np / fl) * clamp(body, 0.0, 1.0);
  let bg = u.ink.rgb + u.tone.rgb * 0.06 * smoothstep(-0.5, 0.5, p.y);
  return present(mix(bg, c, m));
}

@fragment fn fs_orbit_blobs(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let fd = orbitField(p, t * mix(0.4, 1.6, k.z), i32(mix(5.0, 10.0, k.x)), 0.22, mix(0.07, 0.12, k.y), 1.0);
  let w = fwidth(fd.f);
  let m = smoothstep(1.0 - w, 1.0 + w, fd.f);
  let c = chrome(blobN(fd, 0.04), metalF0(), 0.0);
  let bg = u.ink.rgb + u.tone.rgb * 0.1 * min(fd.f, 1.0) * min(fd.f, 1.0);
  return present(mix(bg, c, m));
}

@fragment fn fs_contour_blobs(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let fd = orbitField(p, t * 0.8, i32(mix(4.0, 8.0, k.x)), 0.26, 0.085, 3.0);
  let v = fd.f * mix(3.0, 9.0, k.y);
  let fw = fwidth(v);
  let dl = abs(fract(v + 0.5) - 0.5);
  let line = 1.0 - smoothstep(0.0, fw * 1.2, dl);
  let wf = fwidth(fd.f);
  let m = smoothstep(1.0 - wf, 1.0 + wf, fd.f);
  let n = blobN(fd, 0.04);
  let core = smoothstep(mix(2.0, 5.0, k.z), mix(2.4, 6.0, k.z), fd.f);
  var inside = chrome(n, metalF0(), 0.0);
  inside = mix(inside, u.ink.rgb * 0.6, core);
  let outside = u.ink.rgb + u.tone.rgb * 0.05 * fd.f;
  var c = mix(outside, inside, m);
  let rim = exp(-pow((fd.f - 1.0) / max(4.0 * wf, 0.02), 2.0));
  c += u.cream.rgb * rim * 0.9;
  c += mix(u.tone.rgb, u.cream.rgb, 0.5) * line * mix(0.35, 0.12, m) * (1.0 - core);
  return present(c);
}

@fragment fn fs_mercury_drops(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  var fd: Fld; fd.f = 0.0; fd.g = vec2f(0.0);
  let nd = i32(mix(5.0, 10.0, k.x));
  for (var i: i32 = 0; i < 10; i++) {
    if (i >= nd) { break; }
    let fi = f32(i);
    let h = rnd1(fi * 4.7 + 1.0); let h2 = rnd1(fi * 8.3 + 2.0);
    let ph = fract(t * mix(0.08, 0.3, k.z) * (0.7 + 0.6 * h2) + h);
    let c = vec2f((h - 0.5) * 0.75 + 0.03 * sin(t + fi), 0.6 - ph * ph * 1.0);
    addBall(&fd, p, c, mix(0.03, 0.06, k.y) * (0.6 + 0.7 * h2));
  }
  let dy = max(p.y + 0.3, 0.004);
  let pr = 0.05;
  fd.f += pr * pr / (dy * dy);
  fd.g += vec2f(0.0, -2.0 * pr * pr / (dy * dy * dy)) * step(0.0045, p.y + 0.3);
  let w = fwidth(fd.f);
  let m = smoothstep(1.0 - w, 1.0 + w, fd.f);
  let pool = smoothstep(-0.27, -0.31, p.y);
  let nb = normalize(blobN(fd, 0.035) + vec3f(0.0, mix(0.5 * p.y + 0.1, 0.3 + 2.2 * (p.y + 0.3), pool), 0.0));
  let c = chrome(nb, metalF0(), 0.0);
  let bg = u.ink.rgb + u.tone.rgb * 0.08 * min(fd.f, 1.0);
  return present(mix(bg, c, m));
}

@fragment fn fs_lava_lamp(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  var fd: Fld; fd.f = 0.0; fd.g = vec2f(0.0);
  let nb = i32(mix(4.0, 8.0, k.x));
  for (var i: i32 = 0; i < 8; i++) {
    if (i >= nb) { break; }
    let fi = f32(i);
    let h = rnd1(fi * 2.9 + 5.0);
    let c = vec2f((h - 0.5) * 0.3 + 0.05 * sin(t * 0.3 + fi), 0.38 * sin(t * mix(0.1, 0.4, k.z) * (0.6 + 0.8 * h) + fi * 2.1));
    addBall(&fd, p, c, mix(0.06, 0.1, k.y) * (0.7 + 0.5 * rnd1(fi + 11.0)));
  }
  let dy = max(p.y + 0.46, 0.004); let pr = 0.06;
  fd.f += pr * pr / (dy * dy); fd.g += vec2f(0.0, -2.0 * pr * pr / (dy * dy * dy)) * step(0.0045, p.y + 0.46);
  let w = fwidth(fd.f);
  let m = smoothstep(1.0 - w, 1.0 + w, fd.f);
  let n = blobN(fd, 0.05);
  let l = normalize(vec3f(0.0, -0.6, 0.8));
  let wax = mix(u.tone.rgb, vec3f(1.0, 0.42, 0.22), 0.65);
  var c = wax * (0.15 + 0.7 * max(dot(n, l), 0.0));
  c += wax * 1.1 * pow(1.0 - n.z, 2.0) * smoothstep(0.3, -0.5, p.y);
  c += u.cream.rgb * pow(max(dot(n, normalize(normalize(KEY) + VIEW)), 0.0), 80.0) * 1.2;
  let glowBg = u.ink.rgb + u.tone.rgb * 0.22 * smoothstep(0.6, -0.5, p.y) * (1.0 - 1.6 * abs(p.x));
  return present(mix(max(glowBg, u.ink.rgb), c, m));
}

@fragment fn fs_ferro_crown(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let dens = mix(9.0, 18.0, k.x);
  let pulse = 0.5 + 0.5 * sin(t * mix(0.4, 1.4, k.y));
  let tt = t * mix(0.2, 1.0, k.z);
  let e_ = 0.75 * px() + 0.001;
  let h_ = hFerro(p, tt, dens, pulse);
  let n = normalize(vec3f(-(hFerro((p + vec2f(e_, 0.0)), tt, dens, pulse) - h_) / e_ * 1.0, -(hFerro((p + vec2f(0.0, e_)), tt, dens, pulse) - h_) / e_ * 1.0, 1.0));
  var c = chrome(n, vec3f(0.16), 0.2 * sin(t * 0.3));
  c *= 1.4;
  let plate = u.ink.rgb + u.tone.rgb * 0.05 * (1.0 - length(p));
  let m = smoothstep(0.004, 0.012, h_);
  return present(mix(plate, c, m));
}

@fragment fn fs_chrome_tubes(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let sc = mix(3.0, 6.5, k.x);
  let v = voronoi(p * sc, t * mix(0.2, 1.0, k.y), 0.85, 51u);
  let w = mix(0.06, 0.16, k.z);
  let s = v.edge / w;
  let m = smoothstep(1.0, 1.0 - 1.5 * px() * sc / w, s);
  let c = tubeShade(s, -v.dir, metalF0(), 0.0);
  let bg = u.ink.rgb + u.tone.rgb * 0.04 * (1.0 - v.f1);
  return present(mix(bg, c, m));
}

@fragment fn fs_stained_glass(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let sc = mix(3.0, 6.0, k.x);
  let v = voronoi(p * sc, 0.0, 0.85, 61u);
  let glass = mix(pal(v.id.x), u.tone.rgb * 1.2, 0.2) * (0.25 + 0.75 * v.id.y);
  let L = 0.32 * vec2f(sin(t * mix(0.15, 0.6, k.z)), cos(t * mix(0.12, 0.5, k.z) + 0.7));
  let d = p - L;
  let I = 0.1 + 1.7 * exp(-dot(d, d) / mix(0.02, 0.12, k.y)) + 0.25 / (1.0 + dot(d, d) * 30.0);
  let tex = 0.8 + 0.35 * fbm(p * sc * 3.0 + v.id * 20.0, 3, 63u);
  var c = glass * I * tex * (0.6 + 0.4 * smoothstep(0.0, 0.2, v.edge));
  let lw = 0.06;
  let s = v.edge / lw;
  let lead = tubeShade(s, -v.dir, vec3f(0.25), 0.0) * 0.5 + u.cream.rgb * 0.05 * I;
  let lm = smoothstep(1.0, 1.0 - 1.5 * px() * sc / lw, s);
  return present(mix(c, lead, lm));
}

@fragment fn fs_crack_glow(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let sc = mix(3.0, 6.0, k.x);
  let wp = p + 0.015 * vec2f(fbm(p * 9.0, 3, 2u), fbm(p * 9.0 + 4.0, 3, 3u));
  let v1 = voronoi(wp * sc, 0.0, 0.9, 71u);
  let v2 = voronoi(wp * sc * 2.4 + 7.0, 0.0, 0.9, 72u);
  let c1 = 1.0 - smoothstep(0.0, 0.035 + 1.5 * px() * sc, v1.edge);
  let c2 = (1.0 - smoothstep(0.0, 0.03 + 1.5 * px() * sc * 2.4, v2.edge)) * smoothstep(0.0, 0.3, fbm(p * 3.0, 3, 5u));
  let crack = max(c1, c2 * 0.8);
  let L = 0.28 * vec2f(sin(t * 0.37), sin(t * 0.29 + 1.0));
  let d = p - L;
  let T = mix(0.7, 1.3, k.z) * exp(-dot(d, d) / mix(0.015, 0.09, k.y));
  let x = 0.12 + T;
  let bb = vec3f(smoothstep(0.0, 0.35, x), smoothstep(0.25, 0.85, x) * 0.85, smoothstep(0.7, 1.2, x) * 0.95);
  var c = u.ink.rgb * 0.8 + vec3f(0.05, 0.045, 0.045) * (0.5 + 0.5 * fbm(p * 14.0, 3, 9u)) * smoothstep(0.0, 0.25, v1.edge);
  c += vec3f(1.0, 0.4, 0.12) * T * 0.12 * smoothstep(0.0, 0.3, v1.edge);
  c += bb * crack * (0.35 + 1.4 * T);
  c += bb * T * 0.35 * exp(-v1.edge / 0.08);
  return present(c);
}

@fragment fn fs_hex_chrome(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let sc = mix(3.5, 8.0, k.x);
  let q = p * sc;
  let s2 = vec2f(1.0, 1.7320508); let hs = 0.5 * s2;
  let a = q - s2 * floor(q / s2) - hs;
  let b = (q - hs) - s2 * floor((q - hs) / s2) - hs;
  let gv = select(b, a, dot(a, a) < dot(b, b));
  let ag = abs(gv);
  let dd = dot(ag, vec2f(0.5, 0.8660254));
  let hd = max(ag.x, dd);
  let edge = 0.5 - hd;
  let dir = select(vec2f(0.5 * sign(gv.x), 0.8660254 * sign(gv.y)), vec2f(sign(gv.x), 0.0), ag.x >= dd);
  let wave = 0.5 + 0.5 * sin(p.x * 5.0 + p.y * 3.0 - t * mix(0.6, 2.4, k.z));
  let w = mix(0.05, 0.1, k.y) * (0.45 + 0.55 * wave) + 0.02;
  let s = edge / w;
  let m = smoothstep(1.0, 1.0 - 1.5 * px() * sc / w, s);
  let c = tubeShade(s, -dir, metalF0(), 0.0);
  let bg = u.ink.rgb + u.tone.rgb * 0.12 * wave * smoothstep(0.1, 0.5, edge);
  return present(mix(bg, c, m));
}

@fragment fn fs_bubble_raft(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let sc = mix(4.0, 9.0, k.x);
  let v = voronoi(p * sc, t * mix(0.1, 0.7, k.y), 0.8, 81u);
  let x = v.f1 / max(v.f1 + v.edge, 1e-3);
  let E = 1.0 - x;
  let n = normalize(vec3f(-v.rel / max(v.f1, 1e-4) * pow(x, 2.0) * 1.8, 1.0));
  var c = chrome(n, mix(metalF0(), vec3f(0.5), 0.3), 0.0);
  let fc = film(250.0 + 700.0 * E + 200.0 * v.id.x, n.z);
  c *= mix(vec3f(1.0), fc * 1.6, mix(0.0, 0.8, k.z));
  let seam = smoothstep(0.0, 0.02 + 1.5 * px() * sc, v.edge);
  return present(mix(u.ink.rgb, c, seam));
}

@fragment fn fs_tile_ring(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let nt = floor(mix(5.0, 11.0, k.x));
  let g = p * nt; let id = floor(g); let q = fract(g) - 0.5;
  let cc = (id + 0.5) / nt;
  let rc = length(cc) + 1e-4;
  let wv = rc * mix(10.0, 24.0, k.y) - t * 2.2;
  let tilt = cc / rc * cos(wv) * mix(0.15, 0.6, k.z);
  let rad = 0.14; let bnd = 0.5 - 0.06 - rad;
  let dq = abs(q) - vec2f(bnd);
  let sd = length(max(dq, vec2f(0.0))) + min(max(dq.x, dq.y), 0.0) - rad;
  let mq = max(dq, vec2f(0.0));
  var gd = select(vec2f(0.0, sign(q.y)), vec2f(sign(q.x), 0.0), dq.x > dq.y);
  if (mq.x > 0.0 && mq.y > 0.0) { gd = normalize(mq) * sign(q); }
  let bev = smoothstep(-0.09, 0.0, sd);
  let n = normalize(vec3f(-tilt + q * 0.35 + gd * bev * 1.4, 1.0));
  let c = chrome(n, metalF0(), 0.0) * (1.0 - 0.3 * bev);
  let m = smoothstep(0.0, -1.5 * px() * nt, sd);
  return present(mix(u.ink.rgb, c, m));
}

@fragment fn fs_slat_wave(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let ns = floor(mix(9.0, 20.0, k.x));
  let gy = p.y * ns; let id = floor(gy); let ly = fract(gy) - 0.5;
  let th = mix(0.4, 1.25, k.y) * sin(p.x * 3.5 - t * mix(0.6, 2.2, k.z) + id * 0.35);
  let ch = cos(th);
  let s = ly / (0.47 * ch);
  let g = gnoise(vec2f(p.x * 6.0, (id + 0.5 + s * 0.4) * 60.0), 17u);
  let n = normalize(vec3f(0.0, sin(th) + s * 0.25, ch));
  var c = chrome(n, mix(metalF0(), u.cream.rgb, 0.1), 0.0) * (0.85 + 0.15 * g);
  let m = bandMask(s, 2.0 * px() * ns / (0.47 * ch));
  let leak = u.ink.rgb + mix(u.tone.rgb, u.cream.rgb, 0.4) * 0.6 * (1.0 - ch) * (0.6 + 0.4 * sin(p.x * 2.0 + 1.0));
  return present(mix(leak, c, m));
}

@fragment fn fs_fluted_glass(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let nf = floor(mix(6.0, 16.0, k.x));
  let xi = p.x * nf; let id = floor(xi); let lx = fract(xi) - 0.5;
  let cx = (id + 0.5) / nf;
  let mag = mix(1.5, 5.0, k.y);
  let tt = t * mix(0.4, 1.6, k.z);
  let yo = 0.03 * sin(id * 1.7);
  let r = lightField(vec2f(cx - lx * mag / nf, p.y + yo), tt).r;
  let gc = lightField(vec2f(cx - lx * mag * 1.06 / nf, p.y + yo), tt).g;
  let b = lightField(vec2f(cx - lx * mag * 1.12 / nf, p.y + yo), tt).b;
  var c = vec3f(r, gc, b) * (1.0 - 0.7 * pow(abs(lx) * 2.0, 5.0));
  c += u.cream.rgb * 0.35 * exp(-pow((lx + 0.22) * 22.0, 2.0));
  c *= smoothstep(0.5, 0.5 - 1.5 * px() * nf, abs(lx)) * 0.6 + 0.4;
  return present(c);
}

@fragment fn fs_glass_blocks(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let nb = floor(mix(3.0, 6.0, k.x));
  let g = p * nb; let q = fract(g) - 0.5;
  let ax = 2.0 * abs(q.x); let ay = 2.0 * abs(q.y);
  let a = 1.0 - pow(ax, 4.0); let b = 1.0 - pow(ay, 4.0);
  let gx = -8.0 * pow(ax, 3.0) * sign(q.x) * b;
  let gy = -8.0 * pow(ay, 3.0) * sign(q.y) * a;
  let rip = 0.25 * sin(length(q) * 40.0);
  let gr = vec2f(gx, gy) * 0.12 + normalize(q + 1e-4) * rip * 0.1;
  let n = normalize(vec3f(-gr, 1.0));
  let sp = p + n.xy * mix(0.04, 0.2, k.y) / nb * 3.0;
  var c = lightField(sp, t * mix(0.4, 1.6, k.z)) * 0.72;
  c += chrome(n, vec3f(0.04), 0.0) * 0.7;
  let mortar = smoothstep(0.455, 0.47, max(abs(q.x), abs(q.y)));
  return present(mix(c, u.ink.rgb * 1.2 + u.tone.rgb * 0.04, mortar));
}

@fragment fn fs_oil_slick(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let sc = mix(1.0, 2.4, k.x); let tt = t * mix(0.2, 0.9, k.z);
  let e_ = 0.75 * px() + 0.001;
  let h_ = hSlick(p, tt, sc);
  let n = normalize(vec3f(-(hSlick((p + vec2f(e_, 0.0)), tt, sc) - h_) / e_ * 1.0, -(hSlick((p + vec2f(0.0, e_)), tt, sc) - h_) / e_ * 1.0, 1.0));
  let d = mix(160.0, 620.0, 0.5 + 0.5 * sin(h_ * mix(40.0, 120.0, k.y) + 0.2 * tt));
  let r = reflect(-VIEW, n);
  let lum = dot(env(r, 0.0), vec3f(0.3, 0.5, 0.2));
  let slick = smoothstep(-0.3, 0.1, fbm(p * 1.4 + vec2f(0.03 * tt, 0.0), 3, 95u));
  let water = u.ink.rgb + env(r, 0.0) * 0.08;
  let fc = film(d, n.z);
  let oil = fc * (0.3 + 1.1 * lum);
  return present(mix(water, oil, slick));
}

@fragment fn fs_soap_bubble(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let R = mix(0.3, 0.43, k.x);
  let c0 = p - vec2f(0.0, 0.015 * sin(t * 0.7));
  let a = atan2(c0.y, c0.x);
  let Rw = R * (1.0 + 0.012 * sin(a * 3.0 + t * 1.3));
  let q = c0 / Rw; let rr = dot(q, q);
  let nz = sqrt(max(1.0 - rr, 0.0));
  let n = vec3f(q, nz);
  let sw = fbm(rot2(0.2 * t) * q * 2.2 + vec2f(0.0, 0.1 * t), 4, 97u);
  let d = mix(60.0, 900.0, pow(0.5 - 0.5 * q.y, mix(0.6, 1.8, k.z))) + sw * mix(80.0, 400.0, k.y);
  let fc = film(max(d, 20.0), nz);
  let refl = 0.12 + 0.85 * pow(1.0 - nz, 2.0);
  let r = reflect(-VIEW, n);
  let e = env(r, 0.3);
  let bgc = u.ink.rgb + u.tone.rgb * 0.07 * smoothstep(0.6, -0.6, p.y);
  var c = bgc * 0.9 + fc * (0.2 + 0.9 * e) * refl * 1.6;
  c += u.cream.rgb * pow(max(dot(n, normalize(normalize(KEY) + VIEW)), 0.0), 300.0) * 1.5;
  let m = smoothstep(1.0, 1.0 - 3.0 * px() / R, rr);
  return present(mix(bgc, c, m));
}

// a gilded panel: square leaves in offset rows, each one tilted, lifted at
// its rim and crinkled by fbm; the ridges between leaves give the seams
fn leafG(p: vec2f, ns: f32) -> vec2f {
    return p * ns + 0.06 * vec2f(fbm(p * 5.0, 2, 31u), fbm(p * 5.0 + 3.0, 2, 32u));
}
fn hLeaf(p: vec2f, ns: f32, cr: f32, t: f32) -> f32 {
    let g = leafG(p, ns);
    let row = floor(g.y);
    let gx = g.x + 0.5 * (row - 2.0 * floor(row * 0.5));
    let id = vec2f(floor(gx), row);
    let q = vec2f(fract(gx), fract(g.y)) - 0.5;
    let r = rnd2(vec2i(id), 3u) - vec2f(0.5);
    let tilt = dot(q, r) * 0.22;
    let lift = 0.04 * smoothstep(0.3, 0.5, max(abs(q.x), abs(q.y)));
    let breath = 0.04 * sin(t * 0.7 + r.x * 6.0) * dot(q, q);
    let wr = rot2(r.x * 3.0) * (p * 9.0 + r * 7.0);
    let crease = 1.0 - abs(gnoise(wr, 34u));
    let crink = cr * (0.006 * crease * crease * crease + 0.002 * fbm(p * 14.0 + r * 9.0, 3, 33u));
    return (tilt + lift + breath) / ns + crink + 0.02 * fbm(p * 1.2, 2, 35u);
}
@fragment fn fs_gold_leaf(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let ns = floor(mix(2.0, 4.0, k.x)); let cr = mix(0.4, 1.6, k.y);
  let e_ = 0.75 * px() + 0.001;
  let h_ = hLeaf(p, ns, cr, t);
  let n = normalize(vec3f(-(hLeaf((p + vec2f(e_, 0.0)), ns, cr, t) - h_) / e_ * 1.0, -(hLeaf((p + vec2f(0.0, e_)), ns, cr, t) - h_) / e_ * 1.0, 1.0));
  let spin = 0.6 * sin(t * mix(0.15, 0.6, k.z)) - 0.3;
  var c = chrome(n, vec3f(1.0, 0.71, 0.29), spin);
  let g = leafG(p, ns); let row = floor(g.y);
  let gx = g.x + 0.5 * (row - 2.0 * floor(row * 0.5));
  let sq = abs(vec2f(fract(gx), fract(g.y)) - 0.5);
  let seam = smoothstep(0.5 - 1.5 * px() * ns, 0.5, max(sq.x, sq.y));
  c = mix(c, c * 0.45 + vec3f(0.3, 0.06, 0.02) * 0.2, seam);
  return present(c);
}

// ridged warp: 1 - |fbm| folds the sheet into sharp crests and soft valleys
fn hRidge(p: vec2f, t: f32, sc: f32) -> f32 {
    let q = p * sc;
    let w = vec2f(fbm(q + vec2f(0.0, 0.09 * t), 3, 71u), fbm(q + vec2f(4.1, 2.3) - vec2f(0.07 * t, 0.0), 3, 72u));
    let f = fbm(q * 1.3 + 1.8 * w, 4, 73u);
    let r = 1.0 - abs(f);
    return (0.05 * r * r - 0.025) / sc;
}
@fragment fn fs_copper_tarnish(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let sc = mix(1.2, 2.6, k.x); let tt = t * mix(0.3, 1.2, k.z);
  let e_ = 0.75 * px() + 0.001;
  let h_ = hRidge(p, tt, sc);
  let n = normalize(vec3f(-(hRidge((p + vec2f(e_, 0.0)), tt, sc) - h_) / e_ * 0.8, -(hRidge((p + vec2f(0.0, e_)), tt, sc) - h_) / e_ * 0.8, 1.0));
  let low = smoothstep(0.012, -0.03, h_ * sc);
  let d = mix(5.0, 75.0, low * mix(0.5, 1.2, k.y)) + 12.0 * fbm(p * 6.0, 3, 61u);
  let ox = oxide(max(d, 0.0), n.z, 2.6);
  var c = chrome(n, vec3f(0.95, 0.64, 0.54), 0.2);
  c *= ox;
  return present(c);
}

// raised domes on Worley sites with a cast pitting on top
fn hBoss(p: vec2f, sc: f32) -> f32 {
    let f = vorF1(p * sc, 47u);
    let dome = sqrt(max(1.0 - (f / 0.62) * (f / 0.62), 0.0));
    return (0.075 * dome) / sc + 0.0004 * fbm(p * 40.0, 2, 48u);
}
@fragment fn fs_bronze_patina(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let sc = mix(3.0, 7.0, k.x);
  let e_ = 0.75 * px() + 0.001;
  let h_ = hBoss(p, sc);
  let n = normalize(vec3f(-(hBoss((p + vec2f(e_, 0.0)), sc) - h_) / e_ * 1.0, -(hBoss((p + vec2f(0.0, e_)), sc) - h_) / e_ * 1.0, 1.0));
  let lvl = h_ * sc / 0.075;
  let creep = 0.5 + 0.5 * sin(t * mix(0.1, 0.5, k.z));
  let mott = fbm(p * 9.0, 4, 81u);
  let pat = smoothstep(mix(0.15, 0.55, k.y) * (0.6 + 0.5 * creep), 0.05, lvl + 0.25 * mott);
  let metal = chrome(n, vec3f(0.80, 0.55, 0.32), 0.3 * sin(t * 0.2));
  let l = normalize(KEY);
  let crust = mix(vec3f(0.10, 0.42, 0.36), vec3f(0.42, 0.72, 0.60), 0.5 + 0.5 * fbm(p * 30.0, 3, 82u));
  let warm = vec3f(0.55, 0.36, 0.18) * (0.08 + 0.45 * max(dot(n, l), 0.0));
  let ver = crust * (0.18 + 0.75 * max(dot(n, l), 0.0)) * (0.8 + 0.3 * mott);
  return present(mix(metal * 1.15 + warm, ver, pat));
}

fn hTi(p: vec2f, t: f32, sc: f32) -> f32 {
    let q = p * sc;
    let w = vec2f(fbm(q + vec2f(0.05 * t, 0.0), 3, 111u), fbm(q + vec2f(3.7, 8.1) + vec2f(0.0, 0.04 * t), 3, 112u));
    return 0.04 * fbm(q + 1.3 * w, 4, 113u) / sc;
}
@fragment fn fs_anodized_ti(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let sc = mix(1.0, 2.2, k.x); let tt = t * mix(0.25, 1.0, k.z);
  let e_ = 0.75 * px() + 0.001;
  let h_ = hTi(p, tt, sc);
  let n = normalize(vec3f(-(hTi((p + vec2f(e_, 0.0)), tt, sc) - h_) / e_ * 0.9, -(hTi((p + vec2f(0.0, e_)), tt, sc) - h_) / e_ * 0.9, 1.0));
  let d = mix(20.0, 50.0, k.y) + mix(120.0, 260.0, k.y) * clamp(0.5 + 0.5 * h_ * 45.0 * sc, 0.0, 1.0);
  let ox = oxide(d, n.z, 2.4);
  let base = chrome(n, vec3f(0.62, 0.60, 0.58), 0.0);
  let lum = dot(base, vec3f(0.3, 0.5, 0.2));
  var c = ox * ox * (0.1 + 1.25 * lum);
  let h = normalize(normalize(KEY) + VIEW);
  c += u.cream.rgb * pow(max(dot(n, h), 0.0), 180.0) * 1.2;
  return present(c);
}

@fragment fn fs_blued_steel(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let g = gnoise(vec2f(p.x * 3.0, p.y * 420.0), 121u) * 0.6 + gnoise(vec2f(p.x * 8.0, p.y * 1300.0), 122u) * 0.4;
  let n = normalize(vec3f(0.0, 0.2 * p.y + 0.12 + g * 0.03, 1.0));
  let xc = 0.18 * sin(t * mix(0.15, 0.6, k.z));
  let w = mix(0.35, 0.8, k.y);
  let T = smoothstep(-w, w, p.x - xc + 0.25 * p.y * p.y + 0.06 * fbm(p * 3.0, 3, 123u));
  let d = 4.0 + mix(70.0, 110.0, k.x) * T;
  let ox0 = oxide(d, n.z, 2.6);
  let ox = max(mix(vec3f(dot(ox0, vec3f(0.3, 0.5, 0.2))), ox0, 1.8), vec3f(0.0));
  let r = reflect(-VIEW, n);
  let steel = env(r, 0.0) * fres(vec3f(0.56, 0.57, 0.58), n.z) * (0.75 + 0.25 * g);
  var c = (steel + vec3f(0.06)) * ox * 1.1;
  let lx = p.x + 0.33;
  c += u.cream.rgb * exp(-lx * lx * 260.0) * (0.6 + 0.4 * g) * ox * 0.7;
  return present(c);
}

@fragment fn fs_rose_facets(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let r = length(p) + 1e-4; let a = atan2(p.y, p.x); let R = 0.44;
  let spin = t * mix(0.1, 0.6, k.z);
  let s8 = TAU / 8.0; let s16 = TAU / 16.0;
  let a8 = a - s8 * round(a / s8);
  let rp = r * cos(a8);
  let R0 = mix(0.1, 0.18, k.x); let R1 = R0 + 0.11; let R2 = R1 + 0.09;
  let cr = mix(0.6, 1.4, k.y);
  var ac = 0.0; var tl = 0.0; var eg = 1.0;
  if (rp < R0) { tl = 0.0; eg = R0 - rp; }
  else if (rp < R1) {
    ac = s8 * (floor(a / s8) + 0.5); tl = 0.28 * cr;
    eg = min(min(rp - R0, R1 - rp), r * abs(sin(a - s8 * round(a / s8))));
  } else if (rp < R2) {
    ac = s8 * round(a / s8); tl = 0.5 * cr;
    eg = min(min(rp - R1, R2 - rp), r * abs(sin(a - s8 * (floor(a / s8) + 0.5))));
  } else {
    ac = s16 * (floor(a / s16) + 0.5); tl = 0.8 * cr;
    eg = min(rp - R2, r * abs(sin(a - s16 * round(a / s16))));
  }
  let n = normalize(vec3f(cos(ac) * tl + p.x * 0.2, sin(ac) * tl + p.y * 0.2 + 0.08, 1.0));
  var c = chrome(n, vec3f(0.97, 0.74, 0.65), spin) * 1.1 + vec3f(0.08, 0.05, 0.04);
  c += vec3f(1.0, 0.85, 0.78) * smoothstep(0.004, 0.0, eg) * 0.35;
  c *= 0.85 + 0.15 * smoothstep(0.0, 0.006, eg);
  let m = smoothstep(R, R - px() * 1.5, r * cos(a - s16 * round(a / s16)));
  let bg = u.ink.rgb + vec3f(0.12, 0.07, 0.06) * exp(-r * 4.0);
  return present(mix(bg, c, m));
}

// sum of ridged octaves; the ridge (1 - |n|)^3 makes sharp knife creases
fn hCrease(p: vec2f, t: f32, sc: f32, sharp: f32) -> f32 {
    var q = p * sc + 0.4 * vec2f(fbm(p * sc * 0.7 + vec2f(0.0, 0.06 * t), 2, 141u), fbm(p * sc * 0.7 + vec2f(5.0, -0.05 * t), 2, 142u));
    var h = 0.0; var a = 1.0;
    for (var i: i32 = 0; i < 3; i++) {
        let r = 1.0 - abs(gnoise(q, 143u + u32(i)));
        h += a * pow(r, 2.0 + sharp);
        a *= 0.45; q = rot2(0.9) * q * 2.1;
    }
    return 0.03 * h / sc;
}
@fragment fn fs_gunmetal(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let sc = mix(1.5, 3.2, k.x); let tt = t * mix(0.3, 1.2, k.z);
  let e_ = 0.75 * px() + 0.001;
  let h_ = hCrease(p, tt, sc, mix(1.0, 2.2, k.y));
  let n = normalize(vec3f(-(hCrease((p + vec2f(e_, 0.0)), tt, sc, mix(1.0, 2.2, k.y)) - h_) / e_ * 0.8, -(hCrease((p + vec2f(0.0, e_)), tt, sc, mix(1.0, 2.2, k.y)) - h_) / e_ * 0.8, 1.0));
  var c = chrome(n, vec3f(0.33, 0.35, 0.40), 0.4);
  let h = normalize(normalize(KEY) + VIEW);
  c += mix(u.tone.rgb, u.cream.rgb, 0.6) * pow(max(dot(n, h), 0.0), 60.0) * 0.5;
  c *= 1.1;
  return present(c);
}

// layer phase: stacked along y, folded by a ladder of sine bumps, pushed
// round by raindrop dimples and warped by fbm, as a forged billet would be
fn dmF(p: vec2f, L: f32, dr: f32, t: f32) -> f32 {
    let w = vec2f(fbm(p * 2.2 + vec2f(t, 0.0), 3, 152u), fbm(p * 2.2 + vec2f(3.3, 1.1 - t), 3, 153u));
    let q = p + 0.08 * w;
    let ladder = 0.5 * sin(q.x * 22.0) * smoothstep(0.2, 0.9, sin(q.x * 3.0 + 1.0));
    let f1 = vorF1(q * 5.0, 154u);
    let drop = dr * exp(-f1 * f1 * 9.0);
    return q.y * L + ladder * 3.0 + drop * 3.0 + 1.5 * fbm(q * 4.0, 3, 155u);
}
@fragment fn fs_damascus(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let L = mix(14.0, 30.0, k.x); let dr = mix(0.0, 2.2, k.y); let tt = t * mix(0.1, 0.5, k.z);
  let e = px();
  let f0 = dmF(p, L, dr, tt);
  let fx = dmF(p + vec2f(e, 0.0), L, dr, tt);
  let fy = dmF(p + vec2f(0.0, e), L, dr, tt);
  let g = vec2f(fx - f0, fy - f0) / e;
  let gl = max(length(g), 1e-3);
  let ph = fract(f0);
  let aa = gl * px() * 1.5;
  let bright = smoothstep(0.35 - aa, 0.35 + aa, ph) * smoothstep(0.95 + aa, 0.95 - aa, ph);
  let ridge = sin(ph * TAU);
  let n = normalize(vec3f(-g / gl * ridge * 0.22, 1.0) + vec3f(p * 0.5, 0.0));
  let nickel = chrome(n, vec3f(0.86, 0.85, 0.82), 0.25);
  let carbon = chrome(n, vec3f(0.16, 0.16, 0.18), 0.25) * (0.7 + 0.3 * fbm(p * 60.0, 2, 151u));
  return present(mix(carbon, nickel, bright));
}

// Gerstner sea: move the sample back by the trochoid displacement once,
// then sum the wave heights there, so crests come out sharp and troughs flat.
// fp is the pixel footprint in plane units; waves shorter than it fade out.
fn seaH(w: vec2f, t: f32, Q: f32, A: f32, fp: f32) -> f32 {
    var disp = vec2f(0.0);
    for (var i: i32 = 0; i < 6; i++) {
        let fi = f32(i);
        let L = 2.6 * pow(0.62, fi);
        let a = 0.9 * sin(fi * 2.4 + 0.5);
        let dv = vec2f(sin(a), cos(a));
        let kk0 = TAU / L;
        let ph = dot(dv, w) * kk0 + sqrt(9.8 * kk0) * t * 0.35 + fi * 1.3;
        let amp = A * 0.045 * L * smoothstep(L * 0.6, L * 0.15, fp);
        disp += dv * Q * amp * cos(ph);
    }
    let x = w - disp;
    var h = 0.0;
    for (var i: i32 = 0; i < 6; i++) {
        let fi = f32(i);
        let L = 2.6 * pow(0.62, fi);
        let a = 0.9 * sin(fi * 2.4 + 0.5);
        let dv = vec2f(sin(a), cos(a));
        let kk0 = TAU / L;
        let ph = dot(dv, x) * kk0 + sqrt(9.8 * kk0) * t * 0.35 + fi * 1.3;
        h += A * 0.045 * L * smoothstep(L * 0.6, L * 0.15, fp) * sin(ph);
    }
    return h;
}
@fragment fn fs_chrome_sea(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let hz = 0.24; let H = 0.5;
  let Q = mix(0.2, 1.0, k.x); let A = mix(0.9, 2.0, k.y);
  let spin = 1.0 + 0.5 * sin(t * mix(0.05, 0.3, k.z));
  let dy = max(hz - p.y, 0.003);
  let z = H / dy;
  let w = vec2f(p.x * z, z);
  let fw = z * z * px() / H;
  let e = max(fw, 0.003);
  let h0 = seaH(w, t, Q, A, fw);
  let hx = seaH(w + vec2f(e, 0.0), t, Q, A, fw);
  let hzz = seaH(w + vec2f(0.0, e), t, Q, A, fw);
  let n = normalize(vec3f(-(hx - h0) / e, 1.0, (hzz - h0) / e));
  let d = normalize(vec3f(p.x, p.y - hz, -1.0));
  let r = reflect(d, n);
  var sea = env(r, spin) * fres(metalF0(), dot(-d, n)) * mix(vec3f(1.0), u.tone.rgb, 0.25);
  let hh = normalize(normalize(vec3f(0.3, 0.25, -1.0)) - d);
  sea += u.cream.rgb * pow(max(dot(n, hh), 0.0), 400.0) * 3.0;
  let fog = 1.0 - exp(-z * 0.08);
  let horizon = env(vec3f(d.x, 0.02, -1.0), spin);
  sea = mix(sea, horizon * 0.8, fog);
  let sky = env(normalize(vec3f(p.x, p.y - hz, -1.0)), spin) * 0.8;
  let m = smoothstep(hz + px(), hz - px(), p.y);
  return present(mix(sky, sea, m));
}

// each grid cell owns one drop per cycle at a hashed spot; the ring grows to
// one cell radius and fades, so the 3 x 3 cell window holds every ring
fn hRain(p: vec2f, t: f32, dens: f32, rate: f32, amp: f32) -> f32 {
    let g = p * dens; let ip = floor(g);
    var h = 0.004 * fbm(p * 3.0 + vec2f(0.03 * t, 0.0), 2, 171u);
    for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) {
        let c = ip + vec2f(f32(x), f32(y));
        let r = rnd2(vec2i(c), 172u);
        let cyc = t * rate * (0.6 + 0.8 * r.x) + r.y * 7.0;
        let ph = fract(cyc);
        let cid = floor(cyc);
        let o = vec2f(rnd1(cid * 3.7 + r.x * 91.0), rnd1(cid * 5.3 + r.y * 57.0));
        let ctr = c + 0.15 + 0.7 * o;
        let d = length(g - ctr);
        let x0 = d - ph * 1.0;
        let fade = (1.0 - ph) * (1.0 - ph);
        h += amp * 0.012 / dens * sin(x0 * 28.0) * exp(-x0 * x0 * 40.0) * fade * smoothstep(1.0, 0.7, d);
        h += amp * 0.02 / dens * exp(-d * d * 300.0) * smoothstep(0.12, 0.0, ph);
    } }
    return h;
}
@fragment fn fs_mercury_rain(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let dens = mix(4.0, 9.0, k.x); let rate = mix(0.3, 1.0, k.y); let amp = mix(0.5, 1.4, k.z);
  let e_ = 0.75 * px() + 0.001;
  let h_ = hRain(p, t, dens, rate, amp);
  let n = normalize(vec3f(-(hRain((p + vec2f(e_, 0.0)), t, dens, rate, amp) - h_) / e_ * 1.0, -(hRain((p + vec2f(0.0, e_)), t, dens, rate, amp) - h_) / e_ * 1.0, 1.0));
  let nb = normalize(n + vec3f(0.0, 0.45 * p.y + 0.15, 0.0));
  var c = chrome(nb, metalF0(), 0.35);
  c *= 0.9 + 0.1 * smoothstep(-0.5, 0.5, p.y);
  return present(c);
}

// a mound under the magnet, plus a hex field of cones whose tips lean toward
// it; cone height falls off with distance from the magnet
fn hMag(p: vec2f, m: vec2f, dens: f32, reach: f32) -> f32 {
    let dm = m - p;
    let r2 = dot(dm, dm);
    let mound = exp(-r2 * reach);
    let lean = dm * 0.5 * mound;
    let d = hexNear((p + lean) * dens);
    let cone = pow(max(1.0 - d * 1.9, 0.0), 1.4);
    let grow = smoothstep(0.08, 0.7, mound);
    return mound * 0.06 + cone * grow * 0.11 * (0.3 + 0.7 * mound) / (dens * 0.08) + 0.003 * gnoise(p * 5.0, 181u);
}
@fragment fn fs_ferro_magnet(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let dens = mix(9.0, 17.0, k.x); let reach = mix(5.0, 14.0, k.y);
  let tt = t * mix(0.2, 0.8, k.z);
  let m = vec2f(0.24 * sin(tt * 1.1), 0.2 * sin(tt * 0.7 + 1.0));
  let e_ = 0.75 * px() + 0.001;
  let h_ = hMag(p, m, dens, reach);
  let n = normalize(vec3f(-(hMag((p + vec2f(e_, 0.0)), m, dens, reach) - h_) / e_ * 1.0, -(hMag((p + vec2f(0.0, e_)), m, dens, reach) - h_) / e_ * 1.0, 1.0));
  var c = chrome(n, vec3f(0.1), 0.3 * sin(t * 0.2) + 0.5);
  c *= 2.2;
  let dm = p - m;
  c += u.tone.rgb * 0.08 * exp(-dot(dm, dm) * 30.0);
  return present(c);
}

// the pool: rings run out from the impact point, squashed in y for the
// low view angle, over a slow fbm swell
fn hPour(p: vec2f, t: f32, py: f32) -> f32 {
    let q = vec2f(p.x, (p.y - py) * 3.2);
    let r = length(q);
    let ring = sin(r * 70.0 - t * 9.0) * exp(-r * 4.0) * 0.004;
    let crown = 0.01 * exp(-pow((r - 0.07) * 40.0, 2.0)) * (0.7 + 0.3 * sin(t * 6.0));
    return ring + crown + 0.004 * fbm(q * 3.0 + vec2f(0.0, 0.1 * t), 3, 192u);
}
@fragment fn fs_pour_stream(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let tt = t * mix(0.5, 1.6, k.x);
  let py = -0.2;
  let cx = 0.025 * sin(p.y * 7.0 + tt * 1.3) * smoothstep(-0.3, 0.5, p.y);
  let neck = mix(0.0, 0.35, k.y);
  let w = (0.04 + 0.03 * smoothstep(0.0, py, p.y)) * (1.0 + neck * sin(p.y * 38.0 + tt * 9.0));
  let s0 = (p.x - cx) / w;
  let fl = 0.1 * gnoise(vec2f(s0 * 2.0, p.y * 14.0 + tt * 5.0), 191u);
  let spin = mix(-0.5, 0.5, k.z);
  let stream = tubeShade(s0 + fl, vec2f(1.0, 0.0), metalF0(), spin);
  let e_ = 0.75 * px() + 0.001;
  let h_ = hPour(p, tt, py);
  let n = normalize(vec3f(-(hPour((p + vec2f(e_, 0.0)), tt, py) - h_) / e_ * 1.0, -(hPour((p + vec2f(0.0, e_)), tt, py) - h_) / e_ * 1.0, 1.0));
  let nb = normalize(n + vec3f(0.0, 1.2 * (p.y - py) + 0.35, 0.0));
  var pool = chrome(nb, metalF0(), spin);
  let below = smoothstep(py + 0.012, py - 0.006, p.y + 0.012 * sin(p.x * 30.0 + tt * 4.0) * exp(-p.x * p.x * 30.0));
  let bg = u.ink.rgb + u.tone.rgb * 0.08 * smoothstep(-0.2, 0.5, p.y) * (1.0 - abs(p.x));
  var c = mix(bg, pool, below);
  let sm = bandMask(s0 + fl, 2.0 * px() / w) * smoothstep(py - 0.03, py + 0.01, p.y);
  c = mix(c, stream, sm);
  return present(c);
}

@fragment fn fs_molten_river(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let tt = t * mix(0.03, 0.12, k.z);
  let sc = mix(4.0, 8.0, k.x);
  let bank = 0.3 + 0.05 * sin(p.x * 4.0 + 1.0);
  let inR = smoothstep(bank, bank - 0.04, abs(p.y + 0.04 * sin(p.x * 3.0)));
  let flow = vec2f(p.x - tt * (1.0 + 2.0 * inR), p.y);
  let wp = flow + 0.03 * vec2f(fbm(flow * 5.0, 3, 201u), fbm(flow * 5.0 + 3.0, 3, 202u));
  let v = voronoi(wp * sc, 0.0, 0.9, 203u);
  let heat = mix(0.5, 1.3, k.y) * (0.55 + 0.45 * smoothstep(0.4, -0.5, p.x)) * inR;
  let gap = 0.008 + 0.07 * heat * heat * heat;
  let crust = smoothstep(gap, gap + 0.03 + 1.5 * px() * sc, v.edge);
  let x = v.f1 / max(v.f1 + v.edge, 1e-3);
  let wr = sin(dot(v.rel, vec2f(1.0, 0.3)) * 70.0 + v.id.x * 20.0) * 0.25;
  let n = normalize(vec3f(-v.rel / max(v.f1, 1e-4) * pow(x, 2.0) * 1.4 + vec2f(wr, 0.0), 1.0));
  var cr = chrome(n, vec3f(0.3, 0.28, 0.27), 0.3) * (0.7 + 0.3 * fbm(p * 30.0, 2, 204u));
  cr += glowRamp(heat * 0.7) * exp(-(v.edge - gap) / 0.035) * 0.35;
  cr += vec3f(0.5, 0.1, 0.02) * heat * 0.08;
  let T = heat * (0.85 + 0.25 * gnoise(wp * 9.0 + vec2f(0.0, t * 0.3), 205u));
  let melt = glowRamp(T * mix(0.55, 1.05, smoothstep(gap, 0.0, v.edge)));
  var c = mix(melt, cr, crust);
  let shore = vec3f(0.035, 0.03, 0.03) * (0.5 + 0.5 * fbm(p * 12.0, 3, 206u)) + glowRamp(0.6) * 0.15 * exp(-abs(abs(p.y) - bank) * 30.0);
  c = mix(shore, c, inR);
  return present(c);
}

// top-down crown: a wall at radius R (ph), a crater inside, rings outside, a
// droplet at each of nl lobes (angle folded to one sector) and a late jet
fn hCrown(p: vec2f, ph: f32, nl: f32) -> f32 {
    let r = length(p) + 1e-4; let a = atan2(p.y, p.x);
    let R = 0.04 + 0.26 * sqrt(ph);
    let life = 1.0 - ph;
    let lob = 1.0 + 0.4 * cos(nl * a);
    var h = 0.05 * life * exp(-pow((r - R) / (0.016 + 0.01 * ph), 2.0)) * lob;
    h -= 0.03 * life * smoothstep(R, 0.0, r);
    h += 0.004 * sin((r - R) * 90.0) * exp(-max(r - R, 0.0) * 12.0) * step(R, r) * life;
    let sec = TAU / nl;
    let af = a - (floor(a / sec) + 0.5) * sec;
    let dr = R + 0.025 + 0.05 * ph;
    let q = vec2f(r * cos(af) - dr, r * sin(af));
    let rd = 0.016 * (1.0 - ph * 0.6) * smoothstep(0.0, 0.08, ph);
    h += 0.6 * sqrt(max(rd * rd - dot(q, q), 0.0));
    let jet = smoothstep(0.35, 0.6, ph) * smoothstep(1.0, 0.8, ph);
    let jr = 0.035 * jet;
    h += 0.8 * sqrt(max(jr * jr - r * r, 0.0));
    return h + 0.002 * fbm(p * 4.0, 2, 211u);
}
@fragment fn fs_splash_crown(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let nl = floor(mix(10.0, 20.0, k.x));
  let ph = fract(t * mix(0.12, 0.4, k.y));
  let e_ = 0.75 * px() + 0.001;
  let h_ = hCrown(p, ph, nl);
  let n = normalize(vec3f(-(hCrown((p + vec2f(e_, 0.0)), ph, nl) - h_) / e_ * 1.0, -(hCrown((p + vec2f(0.0, e_)), ph, nl) - h_) / e_ * 1.0, 1.0));
  let nb = normalize(n + vec3f(0.0, 0.4 * p.y + 0.1, 0.0));
  var c = chrome(nb, metalF0(), mix(-0.6, 0.6, k.z));
  return present(c);
}

@fragment fn fs_knurled_grip(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let R = 0.3; let s = p.y / R;
  let inRod = smoothstep(1.0, 1.0 - 2.0 * px() / R, abs(s));
  let sc = clamp(s, -0.995, 0.995);
  let cz = sqrt(1.0 - sc * sc);
  let th = asin(sc);
  let K = mix(14.0, 30.0, k.x);
  let v = th * R + t * mix(0.02, 0.12, k.z);
  let u1 = (p.x + v) * K; let u2 = (p.x - v) * K;
  let a1 = abs(fract(u1) - 0.5); let a2 = abs(fract(u2) - 0.5);
  let d1 = sign(fract(u1) - 0.5); let d2 = sign(fract(u2) - 0.5);
  let first = a1 < a2;
  let gx = select(d2, d1, first);
  let gv = select(-d2, d1, first);
  let knurl = smoothstep(0.32, 0.3, abs(p.x));
  let dep = mix(0.6, 1.4, k.y) * knurl;
  let base = vec3f(0.0, sc, cz);
  let tv = vec3f(0.0, cz, -sc);
  var n = normalize(base - (vec3f(1.0, 0.0, 0.0) * gx + tv * gv) * 0.5 * dep);
  let lathe = gnoise(vec2f(p.x * 900.0, 0.5), 222u) * (1.0 - knurl);
  let cham = (1.0 - knurl) * sign(p.x) * 0.8 * smoothstep(0.03, 0.0, abs(abs(p.x) - 0.34));
  n = normalize(n + vec3f(lathe * 0.04 + cham, 0.0, 0.0));
  var c = chrome(n, metalF0(), 0.4) * (0.45 + 0.55 * cz);
  let tip = min(a1, a2);
  c *= mix(1.0, 0.7 + 0.6 * tip, knurl);
  let bg = u.ink.rgb + u.tone.rgb * 0.05 * (1.0 - abs(p.y));
  return present(mix(bg, c, inRod));
}

// rose engine phase: rings pushed in and out by petals, the petals twisting
// a little with radius; the groove is the triangle wave of this phase
fn rose(p: vec2f, np: f32) -> f32 {
    let r = length(p) + 1e-4; let a = atan2(p.y, p.x);
    return r * 60.0 + 1.1 * sin(np * a + r * 14.0) + 0.35 * sin(np * 2.0 * a - r * 24.0);
}
@fragment fn fs_guilloche_dial(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let r = length(p) + 1e-4; let a = atan2(p.y, p.x); let R = 0.45;
  let np = floor(mix(8.0, 18.0, k.x)); let dep = mix(0.5, 1.5, k.y);
  let e = px();
  let f0 = rose(p, np); let fx = rose(p + vec2f(e, 0.0), np); let fy = rose(p + vec2f(0.0, e), np);
  let g = vec2f(fx - f0, fy - f0) / e;
  let tri = fract(f0) - 0.5;
  let inner = smoothstep(0.3, 0.29, r);
  var n = normalize(vec3f(-g * sign(tri) * 0.0028 * dep * inner, 1.0));
  let sun = (1.0 - inner) * smoothstep(R, R - 0.01, r);
  let rg = gnoise(vec2f(a * 120.0, r * 3.0), 221u);
  n = normalize(n + vec3f(vec2f(-p.y, p.x) / r * rg * 0.15 * sun, 0.0));
  let tone = mix(vec3f(0.92, 0.80, 0.72), metalF0(), 0.4);
  var c = chrome(n, tone, 0.0);
  let lo = PI * 0.5 - t * mix(0.02, 0.2, k.z);
  let la = (a - lo) - TAU * floor((a - lo) / TAU + 0.5);
  c += u.cream.rgb * sun * pow(max(cos(la), 0.0), 8.0) * (0.3 + 0.4 * abs(rg)) * 0.5;
  let ang = TAU / 12.0;
  let ai = a - ang * floor(a / ang + 0.5);
  let idx = vec2f(r * cos(ai) - 0.37, r * sin(ai));
  let bd = max(abs(idx.x) - 0.035, abs(idx.y) - 0.007);
  let bm = smoothstep(px(), -px(), bd);
  c = mix(c, tubeShade(idx.y / 0.007, vec2f(0.0, 1.0), metalF0(), 0.3), bm);
  let hm = t * mix(0.05, 0.5, k.z);
  let hb = vec3f(0.12, 0.2, 0.55);
  for (var i: i32 = 0; i < 2; i++) {
    let fi = f32(i);
    let ha = PI * 0.5 - hm * select(1.0, 1.0 / 12.0, i == 0) - 1.1 * fi;
    let hd = vec2f(cos(ha), sin(ha));
    let L = select(0.36, 0.24, i == 0);
    let along = dot(p, hd);
    let across = dot(p, vec2f(-hd.y, hd.x));
    let wd = mix(0.014, 0.004, clamp(along / L, 0.0, 1.0)) + 0.006 * select(1.0, 1.5, i == 0);
    let hs = across / wd;
    let hmask = bandMask(hs, 2.0 * px() / wd) * step(-0.05, along) * step(along, L);
    let hc0 = clamp(hs, -1.0, 1.0);
    let hn = vec3f(vec2f(-hd.y, hd.x) * hc0 * 0.7, sqrt(1.0 - 0.49 * hc0 * hc0));
    let hc = chrome(hn, hb, 0.4) * 1.3 + hb * 0.2;
    c = mix(c * (1.0 - 0.4 * smoothstep(0.02, 0.0, abs(across - 0.008) - wd) * step(0.0, along) * step(along, L)), hc, hmask);
  }
  c = mix(c, chrome(ballN(p, 0.018), metalF0(), 0.0), smoothstep(0.018, 0.016, r));
  let rim = smoothstep(R - 0.02, R, r);
  c = mix(c, tubeShade((r - (R + 0.0)) / 0.02, p / r, vec3f(1.0, 0.78, 0.45), 0.0), rim * smoothstep(R + 0.02, R + 0.018, r));
  let bg = u.ink.rgb + u.tone.rgb * 0.05 * exp(-r * 3.0);
  return present(mix(bg, c, smoothstep(R + 0.02, R + 0.02 - px(), r)));
}

@fragment fn fs_face_mill(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let rows = 3.0; let rh = 1.0 / rows;
  let R = rh * 0.62;
  let st = mix(0.06, 0.15, k.x);
  let gy = p.y / rh + 0.5 * rows;
  var best = vec2f(0.0);
  for (var j: i32 = 0; j < 2; j++) {
    let row = floor(gy) - f32(j);
    let cy = (row + 0.5) * rh - 0.5;
    let dy = p.y - cy;
    if (abs(dy) < R) {
      let hw = sqrt(R * R - dy * dy);
      let i = floor((p.x + hw) / st);
      best = vec2f(i * st, cy);
    }
  }
  let d = p - best;
  let dl = max(length(d), 1e-4);
  let tg = vec2f(-d.y, d.x) / dl;
  let g = gnoise(vec2f(dl * 900.0, 0.0), 231u) * 0.6 + gnoise(vec2f(dl * 2600.0, 3.0), 232u) * 0.4;
  let la = t * mix(0.1, 0.5, k.z) + 0.6;
  let L = normalize(vec3f(cos(la), sin(la), 0.35));
  let n = normalize(vec3f(d / dl * g * 0.02, 1.0));
  var c = env(reflect(-VIEW, n), la) * fres(metalF0(), 1.0) * 0.4 * (0.85 + 0.15 * g);
  let an = kk(vec3f(tg, 0.0), L, VIEW, mix(60.0, 8.0, k.y));
  c += mix(u.tone.rgb, u.cream.rgb, 0.7) * an * (0.55 + 0.45 * g) * 1.1;
  let nx = best + vec2f(st, 0.0);
  let dn = length(p - nx) - R;
  c *= 0.7 + 0.3 * smoothstep(0.0, 0.004, abs(dn));
  c += u.cream.rgb * 0.15 * smoothstep(0.003, 0.0, abs(dn + 0.002));
  return present(c);
}

// each cell holds one lozenge (a capsule pinched at the ends), turned +45 or
// -45 degrees in a checker; the plateau has a rounded shoulder
fn hTread(p: vec2f, sc: f32, ra: f32) -> f32 {
    let g = p * sc; let id = floor(g); let q = fract(g) - 0.5;
    let par = (i32(id.x) + i32(id.y)) & 1;
    let ang = select(-0.785, 0.785, par == 0);
    let lq = rot2(ang) * q;
    let x = clamp(lq.x, -0.3, 0.3);
    let w = 0.16 * (1.0 - pow(abs(x) / 0.33, 2.0));
    let d = length(vec2f(lq.x - x, lq.y)) - w;
    let bump = smoothstep(0.03, -0.13, d);
    return ra * 0.03 * bump * bump * (3.0 - 2.0 * bump) / sc;
}
@fragment fn fs_diamond_plate(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let sc = mix(3.0, 6.0, k.x); let ra = mix(0.5, 1.5, k.y);
  let e_ = 0.75 * px() + 0.001;
  let h_ = hTread(p, sc, ra);
  let n = normalize(vec3f(-(hTread((p + vec2f(e_, 0.0)), sc, ra) - h_) / e_ * 1.0, -(hTread((p + vec2f(0.0, e_)), sc, ra) - h_) / e_ * 1.0, 1.0));
  let spin = 0.7 * sin(t * mix(0.15, 0.6, k.z));
  let g = gnoise(vec2f(p.x * 6.0, p.y * 500.0), 241u);
  var c = chrome(normalize(n + vec3f(0.0, g * 0.02, 0.0)), vec3f(0.91, 0.92, 0.93), spin) * (0.88 + 0.12 * g);
  let lx = p.x + p.y - 0.6 * sin(t * mix(0.15, 0.6, k.z));
  c += u.cream.rgb * 0.25 * exp(-lx * lx * 18.0) * smoothstep(0.002, 0.012, h_);
  return present(c);
}

@fragment fn fs_speaker_grille(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let sc = mix(8.0, 18.0, k.x);
  let hx = hexCell(p * sc);
  let q = hx.q;
  let rh = mix(0.26, 0.42, k.y);
  let ql = length(q) + 1e-4;
  let beat = pow(0.5 + 0.5 * sin(t * mix(2.0, 7.0, k.z)), 4.0);
  let sh = p * (0.96 - 0.03 * beat);
  let r = length(sh) + 1e-4;
  let rad = sh / r;
  let cone = 0.06 * smoothstep(0.42, 0.1, r) + 0.004 * sin(r * 90.0) * step(0.14, r);
  let slope = (r - 0.1) * 0.6;
  var cn = normalize(vec3f(rad * (slope + 0.12 * cos(r * 90.0) * step(0.14, r)), 1.0));
  if (r < 0.12) { cn = ballN(sh, 0.12 + 0.02 * beat); }
  let cl = max(dot(cn, normalize(vec3f(-0.4, 0.5, 0.8))), 0.0);
  var inside = mix(u.ink.rgb, u.tone.rgb, 0.45) * (0.2 + 1.2 * cl) * (0.7 + 0.6 * beat) + u.cream.rgb * pow(cl, 30.0) * 0.6;
  inside *= smoothstep(0.0, rh * 0.9, rh - ql) * 0.6 + 0.4;
  inside += mix(u.tone.rgb, vec3f(1.0, 0.55, 0.25), 0.6) * (0.25 + 0.75 * beat) * exp(-r * r * 9.0) * 0.5;
  let bev = smoothstep(rh, rh + 0.12, ql);
  let sheetN = normalize(vec3f(-q / ql * (1.0 - bev) * 0.9 + p * 0.25, 1.0));
  let sheet = chrome(sheetN, vec3f(0.62, 0.64, 0.68), 0.2 * sin(t * 0.3)) * (0.7 + 0.3 * bev);
  let m = smoothstep(rh, rh + 1.5 * px() * sc, ql);
  return present(mix(inside, sheet, m));
}

@fragment fn fs_heat_sink(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let r = length(p) + 1e-4; let a = atan2(p.y, p.x);
  let nf = floor(mix(24.0, 48.0, k.x));
  let sec = TAU / nf;
  let af = a - sec * floor(a / sec + 0.5);
  let lat = r * sin(af);
  let w = mix(0.3, 0.7, k.y) * 0.5 * r * sec;
  let s = lat / w;
  let fin = bandMask(s, 2.0 * px() / w) * smoothstep(0.45, 0.445, r) * step(0.13, r);
  let la = t * mix(0.1, 0.5, k.z);
  let rad = p / r;
  let tg = vec3f(rad, 0.0);
  let L = normalize(vec3f(cos(la) * 0.6, sin(la) * 0.6, 0.8));
  let ch = smoothstep(0.55, 1.0, abs(s));
  let fn0 = normalize(vec3f(vec2f(-rad.y, rad.x) * sign(s) * ch * 0.9, 1.0));
  var fc = chrome(fn0, vec3f(0.85, 0.87, 0.9), la) * 0.6;
  fc += mix(u.tone.rgb, u.cream.rgb, 0.8) * kk(tg, L, VIEW, 12.0) * 0.8 * (0.8 + 0.2 * gnoise(vec2f(r * 900.0, a * 3.0), 251u));
  let gapLight = abs(lat) / (r * sec * 0.5);
  let gap = u.ink.rgb + mix(u.tone.rgb, u.cream.rgb, 0.3) * 0.25 * (1.0 - gapLight) * (1.0 - gapLight) * smoothstep(0.47, 0.15, r) * max(dot(vec3f(-rad * sign(af), 0.4), L), 0.0);
  var c = mix(gap, fc, fin);
  let core = smoothstep(0.13, 0.13 - px(), r);
  let cg = gnoise(vec2f(r * 700.0, 0.0), 252u);
  let cn = normalize(vec3f(p * 1.5 + rad * cg * 0.03, 1.0));
  var cc = chrome(cn, vec3f(0.95, 0.64, 0.54), la) * (0.85 + 0.15 * cg);
  cc += vec3f(1.0, 0.7, 0.55) * kk(vec3f(-rad.y, rad.x, 0.0), L, VIEW, 30.0) * 0.5;
  let screw = smoothstep(0.03, 0.028, r);
  cc = mix(cc, chrome(ballN(p, 0.03), metalF0(), la) * (1.0 - 0.8 * smoothstep(0.006, 0.0, abs(p.x)) * step(abs(p.y), 0.022)), screw);
  c = mix(c, cc, core);
  return present(c);
}

// gear distance: a disc of pitch radius R with trapezoid teeth from a clamped
// cosine, a hub bore, and five round lightening holes in the web
fn gearSd(q0: vec2f, R: f32, nt: f32, w: f32, mdl: f32) -> f32 {
    let q = rot2(w) * q0;
    let r = length(q); let a = atan2(q.y, q.x);
    let tooth = clamp(cos(nt * a) * 1.6, -1.0, 1.0);
    var d = r - (R + mdl * 0.85 * tooth);
    d = max(d, -(r - 0.12 * R));
    let ha = TAU / 5.0;
    let a5 = a - ha * floor(a / ha + 0.5);
    let hq = vec2f(r * cos(a5) - 0.55 * R, r * sin(a5));
    d = max(d, -(length(hq) - 0.2 * R));
    return d * 0.8;
}
@fragment fn fs_gear_train(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let nA = floor(mix(12.0, 20.0, k.x)); let nB = floor(nA * 0.6);
  let mdl = 0.5 / (nA + nB);
  let RA = mdl * nA; let RB = mdl * nB;
  let cA = vec2f(-0.16, -0.1); let cB = cA + rot2(0.6) * vec2f(RA + RB, 0.0);
  let wA = t * mix(0.1, 0.6, k.z);
  let wB = -wA * nA / nB + PI / nB - 0.6 * (1.0 + nA / nB) - PI;
  let bv = mix(0.01, 0.03, k.y);
  let e = px();
  let sA = gearSd(p - cA, RA, nA, wA, mdl);
  let sB = gearSd(p - cB, RB, nB, wB, mdl);
  let gA = vec2f(gearSd(p - cA + vec2f(e, 0.0), RA, nA, wA, mdl) - sA, gearSd(p - cA + vec2f(0.0, e), RA, nA, wA, mdl) - sA) / e;
  let gB = vec2f(gearSd(p - cB + vec2f(e, 0.0), RB, nB, wB, mdl) - sB, gearSd(p - cB + vec2f(0.0, e), RB, nB, wB, mdl) - sB) / e;
  let bA = smoothstep(-bv, 0.0, sA); let bB = smoothstep(-bv, 0.0, sB);
  let rA = length(p - cA); let rB = length(p - cB);
  let tA = gnoise(vec2f(rA * 800.0, 0.0), 261u); let tB = gnoise(vec2f(rB * 800.0, 0.0), 262u);
  let nAv = normalize(vec3f(gA * bA * 1.2 + (p - cA) / max(rA, 1e-3) * tA * 0.02, 1.0));
  let nBv = normalize(vec3f(gB * bB * 1.2 + (p - cB) / max(rB, 1e-3) * tB * 0.02, 1.0));
  var A = chrome(nAv, metalF0(), 0.3 * sin(t * 0.2));
  var B = chrome(nBv, vec3f(1.0, 0.78, 0.42), 0.3 * sin(t * 0.2));
  let la = t * 0.2;
  A += u.cream.rgb * kk(vec3f(-(p - cA).y, (p - cA).x, 0.0), normalize(vec3f(cos(la), sin(la), 1.0)), VIEW, 30.0) * 0.25 * (1.0 - bA);
  B += vec3f(1.0, 0.8, 0.5) * kk(vec3f(-(p - cB).y, (p - cB).x, 0.0), normalize(vec3f(cos(la), sin(la), 1.0)), VIEW, 30.0) * 0.25 * (1.0 - bB);
  let shadowA = smoothstep(0.03, 0.0, sA - 0.01) * 0.6;
  let shadowB = smoothstep(0.03, 0.0, sB - 0.01) * 0.6;
  var c = (u.ink.rgb + u.tone.rgb * 0.06 * (0.5 - p.y)) * (1.0 - max(shadowA, shadowB));
  c = mix(c, B, smoothstep(px(), -px(), sB));
  c = mix(c, A, smoothstep(px(), -px(), sA));
  return present(c);
}

fn hSilk(p: vec2f, t: f32, f: f32) -> f32 {
    let q = rot2(0.5) * p;
    let a = q.x * f + 1.3 * sin(q.y * 1.7 + q.x * 2.0 + 0.4 * t) + 1.2 * fbm(q * 1.8 + vec2f(0.0, 0.05 * t), 3, 283u);
    return (0.9 / f) * (sin(a) + 0.35 * sin(2.0 * a + 1.0 + 0.3 * t));
}
@fragment fn fs_shot_silk(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let f = mix(18.0, 34.0, k.x); let tt = t * mix(0.3, 1.1, k.z);
  let e_ = 0.75 * px() + 0.001;
  let h_ = hSilk(p, tt, f);
  let n = normalize(vec3f(-(hSilk((p + vec2f(e_, 0.0)), tt, f) - h_) / e_ * 1.0, -(hSilk((p + vec2f(0.0, e_)), tt, f) - h_) / e_ * 1.0, 1.0));
  let ax = vec3f(0.8775826, 0.4794255, 0.0);
  let tg = normalize(ax - n * dot(n, ax));
  let L = normalize(vec3f(-0.25 + 0.3 * sin(t * 0.21), 0.65, 0.7));
  let warp = vec3f(0.02, 0.36, 0.34); let weft = vec3f(0.62, 0.05, 0.14);
  let shot = clamp(pow(1.0 - n.z, 0.8) * mix(0.5, 1.6, k.y) + 0.2 * dot(n.xy, vec2f(0.8, -0.5)), 0.0, 1.0);
  let col = mix(warp, weft, shot);
  let thr = 0.95 + 0.05 * gnoise(rot2(-0.5) * p * vec2f(600.0, 20.0), 281u);
  var c = col * (0.05 + 0.65 * max(dot(n, L), 0.0)) * thr;
  c += mix(col, u.cream.rgb, 0.7) * kk(normalize(tg + n * 0.25), L, VIEW, 160.0) * 1.2 * thr;
  c += col * 1.4 * kk(normalize(tg - n * 0.2), L, VIEW, 30.0) * 0.5;
  c += env(reflect(-VIEW, n), 0.0) * fres(vec3f(0.03), n.z) * 0.25;
  return present(c);
}

@fragment fn fs_crumpled_foil(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let sc = mix(3.0, 7.0, k.x); let cr = mix(0.1, 0.4, k.y);
  let wp = p + 0.03 * vec2f(fbm(p * 4.0, 2, 291u), fbm(p * 4.0 + 7.0, 2, 292u));
  let v1 = voronoi(wp * sc, 0.0, 0.95, 293u);
  let v2 = voronoi(wp * sc * 2.7 + 3.0, 0.0, 0.95, 294u);
  let a1 = TAU * v1.id.x; let a2 = TAU * v2.id.x;
  let tilt = vec2f(cos(a1), sin(a1)) * cr * (0.3 + 0.7 * v1.id.y) + vec2f(cos(a2), sin(a2)) * cr * 0.5 * v2.id.y + vec2f(0.0, 0.2);
  let n = normalize(vec3f(tilt + 0.05 * vec2f(fbm(p * 14.0, 2, 295u), fbm(p * 14.0 + 5.0, 2, 296u)) + p * 0.3, 1.0));
  let spin = t * mix(0.08, 0.4, k.z);
  var c = chrome(n, vec3f(0.93, 0.94, 0.95), spin) * 1.1;
  let e1 = smoothstep(0.0, 0.01 + 1.5 * px() * sc, v1.edge);
  let e2 = smoothstep(0.0, 0.008 + 1.5 * px() * sc * 2.7, v2.edge);
  let side = dot(v1.dir, vec2f(0.6, 0.8));
  c *= (0.7 + 0.3 * e1) * (0.88 + 0.12 * e2);
  c += u.cream.rgb * (1.0 - e1) * 0.5 * smoothstep(0.0, 0.8, side);
  return present(c);
}

@fragment fn fs_sequin_field(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let sc = mix(7.0, 14.0, k.x);
  let hx = hexCell(p * sc);
  let q = hx.q;
  let cc = (p * sc - q) / sc;
  let r = rnd2(vec2i(hx.id), 301u);
  let wv = sin(dot(cc, vec2f(0.8, 0.5)) * mix(3.0, 9.0, k.y) - t * mix(0.4, 1.6, k.z)) + (r.x - 0.5) * 0.6;
  let phi = PI * smoothstep(-0.35, 0.35, wv);
  let cphi = cos(phi);
  let qy = q.y / max(abs(cphi), 0.06);
  let ql = length(vec2f(q.x, qy));
  let rd = 0.49;
  let m = smoothstep(rd, rd - 1.5 * px() * sc / max(abs(cphi), 0.06), ql);
  let back = cphi < 0.0;
  let tl = (r - 0.5) * 0.35;
  let nd = normalize(vec3f(tl.x + q.x * 0.5, sin(phi) * select(1.0, -1.0, back) + tl.y + qy * 0.4 * abs(cphi), abs(cphi) + 0.05));
  let sA = chrome(nd, metalF0(), 0.2);
  let sB = chrome(nd, vec3f(0.95, 0.28, 0.58), 0.2) * 1.15;
  var s = select(sA, sB, back);
  s *= 0.75 + 0.25 * smoothstep(0.05, 0.1, ql);
  s = mix(s, u.ink.rgb, smoothstep(0.07, 0.05, ql) * smoothstep(0.3, 0.6, abs(cphi)));
  let cloth = u.ink.rgb + vec3f(0.08, 0.02, 0.05) * (0.5 + 0.5 * gnoise(p * 200.0, 302u));
  return present(mix(cloth, s, m));
}

@fragment fn fs_chainmail(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let sc = mix(3.5, 7.0, k.x); let tt = t * mix(0.3, 1.2, k.z);
  let sw = mix(0.005, 0.04, k.y);
  let pw = p + vec2f(sw * sin(p.y * 6.0 + tt * 1.3), sw * 0.6 * sin(p.x * 5.0 + tt * 1.7));
  let g = pw * sc;
  let R = 0.37; let w = 0.11;
  var bz = -1e9; var bs = 2.0; var bd = vec2f(1.0, 0.0); var brow = 0.0;
  let r0 = round(g.y / 0.5);
  for (var dj: i32 = -1; dj <= 1; dj++) {
    let row = r0 + f32(dj);
    let off = 0.5 * (row - 2.0 * floor(row * 0.5));
    let cy = row * 0.5;
    let i0 = floor(g.x - off);
    for (var di: i32 = 0; di <= 1; di++) {
      let c = vec2f(i0 + f32(di) + off, cy);
      let q = g - c;
      let tsgn = select(-1.0, 1.0, (i32(row) & 1) == 0);
      let qe = vec2f(q.x / 0.86, q.y);
      let rr = length(qe) + 1e-4;
      let s = (rr - R) / w;
      let z = tsgn * q.x * 0.6 + sqrt(max(1.0 - s * s, 0.0)) * w;
      if (abs(s) < 1.0 && z > bz) { bz = z; bs = s; bd = qe / rr; brow = row; }
    }
  }
  let m = bandMask(bs, 2.5 * px() * sc / w);
  let drape = 0.75 + 0.25 * sin(p.x * 6.0 + tt * 1.3 + p.y * 2.0);
  let f0 = mix(metalF0(), vec3f(0.85, 0.83, 0.8), 0.5);
  let ring = tubeShade(bs, bd, f0, 0.3 * sin(t * 0.2) + 0.4) * drape * 1.2;
  let bg = u.ink.rgb * 0.5 + u.tone.rgb * 0.03;
  return present(mix(bg, ring, m));
}

@fragment fn fs_satin_pleats(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let piv = vec2f(0.0, 0.85);
  let d = p - piv; let r = length(d); let a = atan2(d.x, -d.y);
  let np = mix(6.0, 14.0, k.x);
  let sway = 0.05 * sin(t * mix(0.3, 1.2, k.z) + r * 3.0);
  let uu = (a + sway) * np;
  let fu = fract(uu) - 0.5;
  let slope = fu / sqrt(fu * fu + 0.01) * mix(0.4, 1.0, k.y) * (0.7 + 0.6 * abs(fu) * 2.0);
  let ru = d / r; let tang = vec2f(-ru.y, ru.x);
  let n = normalize(vec3f(tang * slope * 0.8 + ru * 0.15 * sin(r * 6.0 - t * 0.5), 1.0));
  let L = normalize(vec3f(-0.4 + 0.2 * sin(t * 0.17), 0.6, 0.7));
  let wine = mix(vec3f(0.44, 0.03, 0.10), u.tone.rgb * 0.3, 0.15);
  let ao = 0.45 + 0.55 * (1.0 - abs(fu) * 2.0);
  var c = wine * (0.05 + 0.7 * max(dot(n, L), 0.0)) * ao;
  let hv = normalize(L + VIEW);
  c += vec3f(1.0, 0.45, 0.5) * pow(max(dot(n, hv), 0.0), 12.0) * 0.5 * ao;
  c += mix(wine, u.cream.rgb, 0.75) * pow(max(dot(n, hv), 0.0), 90.0) * 0.9;
  c *= 0.9 + 0.1 * gnoise(vec2f(uu * 3.0, r * 600.0), 311u);
  return present(c);
}

@fragment fn fs_lame_weave(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let sc = mix(22.0, 44.0, k.x); let f = mix(9.0, 18.0, k.y); let tt = t * 0.5;
  let e_ = 0.75 * px() + 0.001;
  let h_ = hDrape(p, tt, f);
  let n = normalize(vec3f(-(hDrape((p + vec2f(e_, 0.0)), tt, f) - h_) / e_ * 0.8, -(hDrape((p + vec2f(0.0, e_)), tt, f) - h_) / e_ * 0.8, 1.0));
  let g = p * sc; let id = floor(g); let fq = fract(g) - 0.5;
  let warpTop = ((i32(id.x) + i32(id.y)) & 3) < 3;
  let s = select(fq.y, fq.x, warpTop) / 0.45;
  let cz = sqrt(max(1.0 - min(s * s, 1.0), 0.0));
  let tw = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), warpTop);
  let nt = normalize(n + vec3f(select(vec2f(0.0, s), vec2f(s, 0.0), warpTop) * 0.12, 0.0));
  let la = t * mix(0.1, 0.6, k.z);
  let L = normalize(vec3f(0.5 * cos(la), 0.5 * sin(la) + 0.3, 0.8));
  let f0 = select(vec3f(0.86, 0.84, 0.80), vec3f(1.0, 0.76, 0.36), warpTop);
  var c = chrome(nt, f0, la * 0.5) * (0.75 + 0.25 * cz);
  c += f0 * kk(normalize(tw - n * dot(n, tw)), L, VIEW, 60.0) * 0.45 * cz;
  let gl = rnd2(vec2i(id), 313u);
  c += u.cream.rgb * step(0.97, gl.x) * pow(0.5 + 0.5 * sin(la * 9.0 + gl.y * TAU), 12.0) * 1.5 * cz;
  return present(c);
}

fn segD(p: vec2f, a: vec2f, b: vec2f) -> vec2f {
    let ab = b - a; let h = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
    return vec2f(length(p - a - ab * h), h);
}
// three jointed legs and an antenna on one side (x mirrored by the caller);
// x = distance minus the limb radius, y = a 0..1 shade across the limb
fn legs(p: vec2f, t: f32) -> vec2f {
    var d = 9.0; var sh = 0.0;
    for (var i: i32 = 0; i < 3; i++) {
        let fi = f32(i);
        let y0 = 0.2 - fi * 0.13;
        let sw = 0.03 * sin(t * 2.0 + fi * 2.1);
        let a = vec2f(0.09, y0);
        let b = vec2f(0.25, y0 + 0.06 - fi * 0.07 + sw);
        let c = vec2f(0.31, y0 - 0.02 - fi * 0.11 + sw);
        let s1 = segD(p, a, b); let s2 = segD(p, b, c);
        let r1 = s1.x - 0.011; let r2 = s2.x - 0.007;
        if (r1 < d) { d = r1; sh = 1.0 - s1.x / 0.011; }
        if (r2 < d) { d = r2; sh = 1.0 - s2.x / 0.007; }
    }
    let an = segD(p, vec2f(0.03, 0.4), vec2f(0.1, 0.47 + 0.01 * sin(t)));
    let an2 = segD(p, vec2f(0.1, 0.47 + 0.01 * sin(t)), vec2f(0.12, 0.5));
    let ra = min(an.x, an2.x) - 0.004;
    if (ra < d) { d = ra; sh = 0.5; }
    return vec2f(d, clamp(sh, 0.0, 1.0));
}
@fragment fn fs_beetle_shell(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let wob = 0.05 * sin(t * 0.4);
  let q0 = rot2(wob) * p;
  let D = mix(240.0, 300.0, k.x); let sh = mix(3.0, 12.0, k.y);
  let side = sign(q0.x + 1e-5);
  let eC = vec2f(side * 0.075, -0.07); let eR = vec2f(0.145, 0.31);
  let qe = (q0 - eC) / eR;
  let re = dot(qe, qe);
  let pC = vec2f(0.0, 0.27); let pR = vec2f(0.15, 0.085);
  let qp = (q0 - pC) / pR;
  let rp = dot(qp, qp);
  let hC = vec2f(0.0, 0.375); let hR = vec2f(0.07, 0.05);
  let qh = (q0 - hC) / hR;
  let rh = dot(qh, qh);
  var n = vec3f(0.0, 0.0, 1.0); var m = 0.0;
  let stri = sin((qe.x * 0.5 + 0.5) * 8.0 * PI) * 0.25;
  let pits = smoothstep(0.35, 0.0, length(fract(vec2f(qe.x * 5.0, qe.y * 28.0)) - 0.5));
  if (re < 1.2) { n = normalize(vec3f(qe.x / eR.x * 0.12 + stri * 0.5 * (1.0 - re), qe.y / eR.y * 0.12, sqrt(max(1.0 - re, 0.0)) * 1.2)); m = smoothstep(1.0, 1.0 - 3.0 * px() / eR.x, re); }
  if (rp < 1.0 && m < 0.5) { n = normalize(vec3f(qp / pR * 0.1, sqrt(max(1.0 - rp, 0.0)) * 0.9)); m = smoothstep(1.0, 1.0 - 3.0 * px() / pR.y, rp); }
  if (rh < 1.0 && m < 0.5) { n = normalize(vec3f(qh / hR * 0.08, sqrt(max(1.0 - rh, 0.0)))); m = smoothstep(1.0, 1.0 - 3.0 * px() / hR.y, rh); }
  let spin = 0.6 * sin(t * mix(0.1, 0.5, k.z));
  let e = env(reflect(-VIEW, n), spin);
  let lum = dot(e, vec3f(0.3, 0.5, 0.2));
  var c = bragg(D, n.z, sh) * (0.25 + 1.5 * lum);
  c *= 1.0 - 0.5 * pits * step(re, 1.0);
  c += e * fres(vec3f(0.04), n.z) * 0.6;
  c += u.cream.rgb * pow(max(dot(n, normalize(normalize(KEY) + VIEW)), 0.0), 160.0) * 1.2;
  let suture = smoothstep(0.004, 0.0, abs(q0.x)) * step(q0.y, 0.2);
  c *= 1.0 - 0.8 * suture;
  let leaf = u.ink.rgb + vec3f(0.02, 0.05, 0.03) * (0.6 + 0.4 * fbm(p * 5.0, 3, 321u)) * (1.0 - length(p));
  let lg = legs(vec2f(abs(q0.x), q0.y), t);
  let lc = bragg(D, 0.55 + 0.3 * lg.y, sh) * 0.5 + u.cream.rgb * 0.15 * lg.y;
  let bgc = mix(leaf * (1.0 - 0.5 * smoothstep(0.05, 0.0, lg.x - 0.01)), lc, smoothstep(px() * 1.5, -px(), lg.x));
  return present(mix(bgc, c, m));
}

@fragment fn fs_soap_film(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let R = 0.43;
  let r = length(p);
  let v1 = 0.16 * vec2f(sin(t * 0.31), cos(t * 0.23));
  let v2 = -0.18 * vec2f(cos(t * 0.27 + 1.0), sin(t * 0.19));
  let st = mix(1.0, 4.0, k.x);
  var q = p - v1; q = rot2(st * exp(-dot(q, q) * 18.0)) * q + v1;
  q = q - v2; q = rot2(-st * 0.8 * exp(-dot(q, q) * 14.0)) * q + v2;
  let turb = fbm(q * 3.0 + vec2f(0.0, 0.05 * t), 4, 331u);
  let drain = pow(clamp(0.5 - 0.5 * q.y / R, 0.0, 1.0), mix(0.5, 1.6, k.z));
  let d = mix(300.0, 1000.0, k.y) * drain + turb * 220.0 + 60.0 * sin(q.y * 40.0 + turb * 6.0);
  let fc = film(max(d, 0.0), 0.95);
  let band = 0.35 + 0.65 * smoothstep(0.3, -0.2, abs(p.x + 0.12 * p.y - 0.12));
  let black = smoothstep(40.0, 120.0, d);
  var c = u.ink.rgb * 0.8 + fc * (0.35 + 0.9 * band) * black;
  c += u.cream.rgb * 0.5 * smoothstep(0.03, 0.0, abs(p.x + 0.12 * p.y - 0.12)) * black * 0.4;
  let m = smoothstep(R, R - px(), r);
  let bg = u.ink.rgb + u.tone.rgb * 0.05 * (0.5 - p.y);
  c = mix(bg, c, m);
  let wire = tubeShade((r - R) / 0.012, p / max(r, 1e-4), metalF0(), 0.0);
  c = mix(c, wire, bandMask((r - R) / 0.012, 2.0 * px() / 0.012));
  return present(c);
}

// growth phase: stripes along y pushed by two levels of warp, so the bands
// curl like the layers in an abalone shell
fn nacreB(p: vec2f, sc: f32) -> f32 {
    let q = p * sc;
    let w = vec2f(fbm(q, 3, 341u), fbm(q + vec2f(5.2, 1.3), 3, 342u));
    let w2 = vec2f(fbm(q + 1.8 * w + vec2f(1.7, 9.2), 3, 343u), fbm(q + 1.8 * w + vec2f(8.3, 2.8), 3, 344u));
    return dot(q + 2.2 * w2, vec2f(0.35, 1.0));
}
// terraces: each growth layer is a shallow step with a rounded lip
fn hNacre(p: vec2f, sc: f32) -> f32 {
    let B = nacreB(p, sc) * 4.0;
    let f = fract(B);
    return (floor(B) + smoothstep(0.75, 1.0, f)) * 0.0025 / sc;
}
@fragment fn fs_nacre(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let sc = mix(1.2, 2.6, k.x); let sh = t * mix(0.05, 0.3, k.z);
  let e_ = 0.75 * px() + 0.001;
  let h_ = hNacre(p, sc);
  let n = normalize(vec3f(-(hNacre((p + vec2f(e_, 0.0)), sc) - h_) / e_ * 1.0, -(hNacre((p + vec2f(0.0, e_)), sc) - h_) / e_ * 1.0, 1.0));
  let B = nacreB(p, sc);
  let lines = 0.5 + 0.5 * sin(B * 70.0);
  let d = 330.0 + 230.0 * sin(B * 2.6 + sh) + 90.0 * fbm(p * 7.0, 3, 345u) + 25.0 * lines;
  let fc = film(d, n.z);
  let e = env(reflect(-VIEW, n), 0.2);
  let lum = dot(e, vec3f(0.3, 0.5, 0.2));
  let pearl = mix(u.cream.rgb, vec3f(0.9, 0.94, 1.0), 0.5) * 0.65;
  var c = mix(pearl, fc, mix(0.25, 0.6, k.y)) * (0.5 + 0.85 * lum);
  c *= 0.9 + 0.1 * lines;
  c += u.cream.rgb * pow(max(dot(n, normalize(normalize(KEY) + VIEW)), 0.0), 50.0) * 0.35;
  return present(c);
}

@fragment fn fs_holo_foil(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let v = voronoi(p * 3.2, 0.0, 0.9, 351u);
  let r = length(p) + 1e-4;
  let disc = smoothstep(0.17, 0.165, r);
  let ang = v.id.x * PI;
  var g = vec2f(cos(ang), sin(ang));
  g = normalize(mix(g, vec2f(-p.y, p.x) / r, disc));
  let lt = t * mix(0.15, 0.6, k.z);
  let lp = vec3f(0.55 * cos(lt), 0.55 * sin(lt) + 0.1, 0.9);
  let L = normalize(lp - vec3f(p, 0.0));
  let V = normalize(vec3f(-p * 0.7, 1.0));
  let hv = L + V;
  let dd = mix(900.0, 1800.0, k.x);
  let col = grating(hv, g, dd, mix(1.0, 0.15, k.y));
  let n = normalize(vec3f((v.id - 0.5) * 0.06, 1.0));
  var c = env(reflect(-VIEW, n), lt) * fres(vec3f(0.7), 1.0) * 0.3 + mix(u.tone.rgb, u.cream.rgb, 0.5) * 0.22;
  c += col * 1.4;
  let sp = rnd2(vec2i(floor(p * 90.0)), 352u);
  c += u.cream.rgb * step(0.985, sp.x) * pow(0.5 + 0.5 * sin(lt * 6.0 + sp.y * TAU), 8.0) * 1.2;
  let edge = smoothstep(0.0, 0.012, v.edge) * (1.0 - smoothstep(0.004, 0.0, abs(r - 0.17)));
  c *= 0.6 + 0.4 * edge;
  return present(c);
}

@fragment fn fs_oil_asphalt(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let pc = (p - vec2f(0.02, -0.03)) * vec2f(1.0, 1.25);
  let pr = length(pc) + 0.12 * fbm(p * 2.5, 3, 361u);
  let R = mix(0.3, 0.48, k.x);
  let pm = smoothstep(R, R - 0.02, pr);
  let wet = smoothstep(R + 0.12, R, pr);
  let st = vorF1(p * 30.0, 362u);
  let sid = rnd2(vec2i(floor(p * 30.0)), 363u).x;
  let stone = smoothstep(0.4, 0.18, st);
  let base = vec3f(0.045, 0.045, 0.05) * (0.7 + 0.5 * fbm(p * 60.0, 2, 364u));
  var asph = mix(base, vec3f(0.13, 0.125, 0.12) * (0.5 + sid), stone * 0.8);
  let sq = p * 30.0 - floor(p * 30.0) - 0.5;
  let sn = normalize(vec3f(-sq / (length(sq) + 1e-3) * stone * 0.6, 1.0));
  asph += env(reflect(-VIEW, sn), 0.0) * (0.06 + 0.14 * wet) * stone;
  asph *= 1.0 - 0.4 * wet;
  let e_ = 0.75 * px() + 0.001;
  let h_ = hRain(p, t * mix(0.3, 1.0, k.z), 6.0, 0.5, 0.6);
  let n = normalize(vec3f(-(hRain((p + vec2f(e_, 0.0)), t * mix(0.3, 1.0, k.z), 6.0, 0.5, 0.6) - h_) / e_ * 1.0, -(hRain((p + vec2f(0.0, e_)), t * mix(0.3, 1.0, k.z), 6.0, 0.5, 0.6) - h_) / e_ * 1.0, 1.0));
  let nb = normalize(n + vec3f(0.0, 0.5 * p.y + 0.12, 0.0));
  let rf = reflect(-VIEW, nb);
  let e = env(rf, 0.2);
  let lum = dot(e, vec3f(0.3, 0.5, 0.2));
  let lp = p + nb.xy * 0.08 - vec2f(-0.1, 0.12);
  let lamp = vec3f(1.0, 0.8, 0.5) * (exp(-dot(lp, lp) * 300.0) * 1.6 + exp(-dot(lp, lp) * 25.0) * 0.25);
  let w2 = vec2f(fbm(p * 2.0 + vec2f(0.02 * t, 0.0), 3, 365u), fbm(p * 2.0 + vec2f(4.0, -0.015 * t), 3, 366u));
  let sw = fbm(p * 2.2 + 0.9 * w2, 4, 367u);
  let d = 250.0 + 1100.0 * (0.5 + 0.5 * sw);
  let oil = smoothstep(-0.25, 0.1, sw + mix(-0.25, 0.25, k.y)) * smoothstep(0.0, 0.6, pm);
  var water = e * 0.16 * mix(vec3f(1.0), u.tone.rgb, 0.4) + lamp;
  water += film(d, nb.z) * (0.12 + 1.1 * lum + 0.8 * dot(lamp, vec3f(0.33))) * oil;
  return present(mix(asph, water, pm));
}

// L-inf Worley: each site is a square crystal of its own size and turn;
// x = scaled square distance, y = crystal hash, zw = outward axis of the face
fn bisCell(g: vec2f) -> vec4f {
    let ip = floor(g);
    var best = vec4f(9.0, 0.0, 1.0, 0.0);
    for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) {
        let c = ip + vec2f(f32(x), f32(y));
        let r = rnd2(vec2i(c), 372u);
        let ctr = c + 0.5 + 0.5 * (r - 0.5);
        let th = 0.35 * (r.x - 0.5) + select(0.0, 0.785, r.y > 0.7);
        let q = rot2(th) * (g - ctr);
        let size = 0.5 + 0.45 * r.y;
        let dd = max(abs(q.x), abs(q.y)) / size;
        if (dd < best.x) {
            let axl = select(vec2f(0.0, sign(q.y)), vec2f(sign(q.x), 0.0), abs(q.x) > abs(q.y));
            let axw = rot2(-th) * axl;
            best = vec4f(dd, rnd1(r.x * 91.0), axw.x, axw.y);
        }
    } }
    return best;
}
@fragment fn fs_bismuth(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let sc = mix(2.2, 4.5, k.x); let S = floor(mix(4.0, 9.0, k.y));
  let b = bisCell(p * sc);
  let dC = b.x;
  let inside = smoothstep(1.0, 1.0 - 2.0 * px() * sc, dC);
  let si = floor(dC * S); let fr = fract(dC * S);
  let bev = smoothstep(0.78, 1.0, fr);
  let ax = vec2f(b.z, b.w);
  let n = normalize(vec3f(ax * bev * 1.3 + ax * 0.04, 1.0));
  let shift = t * mix(0.05, 0.3, k.z);
  let d = 160.0 + 70.0 * si + 120.0 * b.y + 40.0 * sin(shift + si * 0.7);
  let fc = filmN(d, n.z, 1.9);
  let e = env(reflect(-VIEW, n), shift);
  let lum = dot(e, vec3f(0.3, 0.5, 0.2));
  var c = pow(fc, vec3f(1.6)) * 1.3 * (0.3 + 1.1 * lum) + e * 0.1;
  c *= 1.0 - 0.45 * bev;
  c += u.cream.rgb * smoothstep(0.96, 1.0, fr) * 0.35 * (0.5 + 0.5 * ax.x);
  let gap = vec3f(0.05, 0.05, 0.06) * (0.6 + 0.4 * fbm(p * 30.0, 2, 371u));
  return present(mix(gap, c, inside));
}

// folds grow from the rod down; a gust is a phase wave running along x that
// swings the lower hem more than the top
fn hCurtain(p: vec2f, t: f32, f: f32, gu: f32, top: f32) -> f32 {
    let dn = max(top - p.y, 0.0);
    let a = p.x * f + gu * 1.8 * sin(t * 0.9 + p.x * 2.0 - p.y * 2.5) * dn + 0.6 * fbm(p * 2.0 + vec2f(0.1 * t, 0.0), 3, 381u);
    let amp = (0.3 + 1.5 * dn) / f;
    return amp * (sin(a) + 0.25 * sin(2.0 * a + 0.7)) + gu * 0.05 * sin(p.x * 3.0 - t * 1.2) * dn * dn;
}
@fragment fn fs_chrome_curtain(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let f = mix(14.0, 30.0, k.x); let gu = mix(0.4, 1.6, k.y); let tt = t * mix(0.4, 1.4, k.z);
  let top = 0.4;
  let e_ = 0.75 * px() + 0.001;
  let h_ = hCurtain(p, tt, f, gu, top);
  let n = normalize(vec3f(-(hCurtain((p + vec2f(e_, 0.0)), tt, f, gu, top) - h_) / e_ * 1.0, -(hCurtain((p + vec2f(0.0, e_)), tt, f, gu, top) - h_) / e_ * 1.0, 1.0));
  var c = chrome(n, metalF0(), 0.25 * sin(tt * 0.3));
  c *= 0.55 + 0.45 * smoothstep(-0.1, 0.4, n.z);
  let hang = smoothstep(top + 0.005, top - 0.005, p.y);
  let bg = u.ink.rgb + u.tone.rgb * 0.05;
  c = mix(bg, c, hang);
  let rs = (p.y - (top + 0.02)) / 0.016;
  c = mix(c, tubeShade(rs, vec2f(0.0, 1.0), vec3f(1.0, 0.78, 0.45), 0.0), bandMask(rs, 2.0 * px() / 0.016));
  return present(c);
}

@fragment fn fs_pin_art(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let sc = mix(9.0, 17.0, k.x); let pu = mix(0.6, 1.4, k.y); let tt = t * mix(0.3, 1.0, k.z);
  let c1 = vec2f(0.22 * sin(tt * 0.7), 0.18 * cos(tt * 0.5));
  let c2 = vec2f(0.25 * cos(tt * 0.43 + 2.0), 0.22 * sin(tt * 0.61 + 1.0));
  let ip = floor(p * sc);
  var bh = -1.0; var bd = vec2f(9.0); var br = 1.0; var near = 9.0;
  for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) {
    let cc = (ip + vec2f(f32(x), f32(y)) + 0.5) / sc;
    let e1 = cc - c1; let e2 = cc - c2;
    let ring = abs(length(e2) - 0.12);
    let h = clamp(pu * max(exp(-dot(e1, e1) / 0.018), 0.85 * exp(-ring * ring / 0.0012)), 0.0, 1.0);
    let pos = cc + cc * h * 0.1;
    let rad = 0.42 / sc * (1.0 + 0.35 * h);
    let d = p - pos;
    near = min(near, length(p - cc));
    if (dot(d, d) < rad * rad && h > bh) { bh = h; bd = d; br = rad; }
  }}
  let hit = bh >= 0.0;
  let n = ballN(bd, br);
  var head = chrome(n, metalF0(), 0.3 * sin(t * 0.2)) * (0.35 + 0.9 * bh);
  head *= 0.6 + 0.4 * n.z;
  let edge = smoothstep(br, br - 1.5 * px(), length(bd));
  let plate = (u.ink.rgb + u.tone.rgb * 0.05) * (0.6 + 0.4 * smoothstep(0.0, 0.25 / sc, near));
  return present(select(plate, mix(plate, head, edge), hit));
}

@fragment fn fs_venetian_blinds(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let ns = floor(mix(6.0, 12.0, k.x));
  let th = mix(0.7, 1.5, k.y) * (0.75 + 0.25 * sin(t * mix(0.2, 0.8, k.z)));
  let ct = cos(th); let stn = sin(th);
  let gy = p.y * ns; let id = floor(gy); let ly = fract(gy) - 0.5;
  let hw = min(0.56 * ct, 0.5);
  let s = ly / hw;
  var sky = mix(vec3f(0.95, 0.45, 0.2), vec3f(0.25, 0.2, 0.45), smoothstep(-0.2, 0.5, p.y));
  let sd = p - vec2f(0.18, -0.05);
  sky += vec3f(1.0, 0.85, 0.6) * (smoothstep(0.07, 0.06, length(sd)) * 1.5 + 0.4 * exp(-dot(sd, sd) * 12.0));
  let bx = floor(p.x * 14.0);
  let bh = -0.2 + 0.22 * rnd1(bx * 3.3) + 0.08 * rnd1(bx * 7.1);
  let bld = step(p.y, bh);
  let win = step(0.82, rnd2(vec2i(floor(p * vec2f(56.0, 40.0))), 391u).x) * step(0.35, fract(p.x * 56.0)) * step(0.35, fract(p.y * 40.0));
  sky = mix(sky, vec3f(0.03, 0.025, 0.05) + vec3f(1.0, 0.8, 0.45) * win * 0.35, bld);
  let n = normalize(vec3f(0.0, stn * 0.6 + s * 0.6, ct));
  let win2 = mix(vec3f(1.0, 0.6, 0.3), sky, 0.5);
  var slat = chrome(n, vec3f(0.9, 0.91, 0.93), 0.0) * 0.6;
  slat += win2 * 0.55 * smoothstep(0.0, 1.0, stn) * smoothstep(-0.2, 1.0, s);
  slat += vec3f(1.0, 0.75, 0.5) * 0.5 * smoothstep(0.75, 1.0, s) * (0.3 + 0.7 * stn);
  slat *= 0.6 + 0.4 * smoothstep(-1.0, -0.3, s);
  let m = bandMask(s, 2.0 * px() * ns / hw);
  var c = mix(sky * (0.5 + 0.5 * stn), slat, m);
  let cord = smoothstep(0.004, 0.002, abs(abs(p.x) - 0.3));
  c = mix(c, vec3f(0.6, 0.58, 0.55) * (0.4 + 0.6 * m), cord * 0.9);
  return present(c);
}

@fragment fn fs_vinyl_record(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let r = length(p) + 1e-4; let a = atan2(p.y, p.x); let R = 0.46;
  let w = t * mix(0.5, 3.0, k.z);
  let aa = a + w;
  let ntr = floor(mix(3.0, 7.0, k.x));
  let tx = (r - 0.17) / (R - 0.02 - 0.17) * ntr;
  let gap = smoothstep(0.06, 0.02, abs(fract(tx) - 0.5) - 0.44) * step(0.17, r) * step(r, R - 0.02);
  let g = gnoise(vec2f(r * 1800.0, aa * 3.0), 401u) * 0.5 + gnoise(vec2f(r * 600.0, aa * 8.0), 402u) * 0.5;
  let la = 0.6 + 0.04 * sin(aa);
  let lobe = pow(abs(cos(a - la)), mix(200.0, 20.0, k.y));
  let n = normalize(vec3f(p * 0.3, 1.0));
  var c = u.ink.rgb * 0.3 + env(reflect(-VIEW, n), 0.0) * fres(vec3f(0.04), n.z) * 0.6;
  c += mix(u.tone.rgb, u.cream.rgb, 0.8) * lobe * (0.25 + 0.9 * r / R) * mix(0.5 + 0.5 * g, 1.3, gap);
  c *= mix(0.85 + 0.15 * g, 1.0, gap);
  let lab = smoothstep(0.15, 0.15 - px(), r);
  let lr = vec2f(cos(aa), sin(aa));
  let text = step(0.55, fract(aa * 40.0 / TAU)) * smoothstep(0.004, 0.0, abs(r - 0.125) - 0.008);
  let logo = smoothstep(0.03, 0.028, length(r * lr - vec2f(0.0, 0.07)));
  var lc = mix(vec3f(0.72, 0.1, 0.08), vec3f(0.95, 0.85, 0.65), max(text, logo * step(0.0, sin(aa * 1.0))));
  lc *= 0.7 + 0.3 * smoothstep(0.15, 0.0, r);
  c = mix(c, lc, lab);
  c = mix(c, chrome(ballN(p, 0.012), metalF0(), 0.0), smoothstep(0.012, 0.010, r));
  let edge = smoothstep(R, R - px(), r);
  let mat = u.ink.rgb + u.tone.rgb * 0.04 * (1.0 - r);
  return present(mix(mat, c, edge));
}

// night sky over the pond: the studio darkened, a moon disc and glow, and a
// treeline silhouette read by azimuth x / -z and elevation y / -z
fn pondSky(d0: vec3f, moonP: vec2f) -> vec3f {
    let d = normalize(d0);
    let iz = 1.0 / max(-d.z, 0.05);
    let sp = vec2f(d.x * iz, d.y * iz);
    var c = mix(u.tone.rgb * 0.22 + u.cream.rgb * 0.05, u.ink.rgb * 0.8 + u.tone.rgb * 0.03, smoothstep(0.0, 0.5, sp.y));
    let sg = sp * 90.0;
    let st = rnd2(vec2i(floor(sg)), 413u);
    c += u.cream.rgb * step(0.985, st.x) * smoothstep(0.25, 0.0, length(fract(sg) - 0.5)) * smoothstep(0.05, 0.2, sp.y) * 1.5;
    let md = length(sp - moonP);
    c += u.cream.rgb * (smoothstep(0.045, 0.04, md) * 2.0 + 0.25 * exp(-md * 9.0));
    let tree = 0.02 + 0.035 * fbm(vec2f(sp.x * 6.0, 0.0), 3, 411u) + 0.03 * abs(gnoise(vec2f(sp.x * 40.0, 0.0), 412u)) + 0.04 * smoothstep(0.15, 0.4, abs(sp.x + 0.1));
    c = mix(c, u.ink.rgb * 0.6, smoothstep(tree + 0.003, tree - 0.003, sp.y) * step(0.0, sp.y));
    return c;
}
// drop rings on the pond plane, each drop on its own cycle and spot
fn pondH(w: vec2f, t: f32, nd: i32, rate: f32, fw: f32) -> f32 {
    var h = 0.0015 * sin(w.x * 3.0 + w.y * 2.0 + t * 0.4) * smoothstep(0.5, 0.05, fw);
    for (var i: i32 = 0; i < 8; i++) {
        if (i >= nd) { break; }
        let fi = f32(i);
        let cyc = t * rate + fi * 0.37;
        let ph = fract(cyc); let id = floor(cyc);
        let c = vec2f((rnd1(id * 3.1 + fi * 1.7) - 0.5) * 3.0, 1.0 + 6.0 * rnd1(id * 5.9 + fi * 2.3));
        let x = length(w - c) - ph * 1.6;
        h += 0.02 * sin(x * 30.0) * exp(-x * x * 25.0) * (1.0 - ph) * (1.0 - ph) * smoothstep(0.25, 0.03, fw);
    }
    return h;
}
@fragment fn fs_mirror_pond(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let hz = 0.06; let H = 0.35;
  let moonP = vec2f(mix(-0.3, 0.3, k.z), 0.24);
  let d = normalize(vec3f(p.x, p.y - hz, -1.0));
  let dy = max(hz - p.y, 0.003);
  let z = H / dy;
  let w = vec2f(p.x * z, z);
  let fw = z * z * px() / H;
  let e = max(fw, 0.002);
  let nd = i32(mix(3.0, 8.0, k.x)); let rate = mix(0.15, 0.5, k.y);
  let h0 = pondH(w, t, nd, rate, fw);
  let hx = pondH(w + vec2f(e, 0.0), t, nd, rate, fw);
  let hzz = pondH(w + vec2f(0.0, e), t, nd, rate, fw);
  let n = normalize(vec3f(-(hx - h0) / e, 1.0, (hzz - h0) / e));
  let r = reflect(d, n);
  var pond = pondSky(r, moonP) * fres(vec3f(0.55), dot(-d, n));
  pond = mix(pond, pondSky(vec3f(d.x, 0.004, -1.0), moonP) * 0.5, 1.0 - exp(-z * 0.04));
  let sky = pondSky(d, moonP);
  let m = smoothstep(hz + px(), hz - px(), p.y);
  return present(mix(sky, pond, m));
}

@fragment fn fs_bearing_field(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let sc = mix(5.0, 10.0, k.x); let wa = mix(0.05, 0.25, k.y); let tt = t * mix(0.4, 1.6, k.z);
  let g = p * sc;
  let r0 = round(g.y / 0.866);
  var bd = 9.0; var bq = vec2f(0.0); var bph = 0.0; var shade = 0.0;
  for (var dj: i32 = -1; dj <= 1; dj++) {
    let row = r0 + f32(dj);
    let off = 0.5 * (row - 2.0 * floor(row * 0.5));
    let i0 = round(g.x - off);
    for (var di: i32 = -1; di <= 1; di++) {
      let c0 = vec2f(i0 + f32(di) + off, row * 0.866);
      let ph = dot(c0 / sc, vec2f(5.0, 3.0)) - tt * 2.0;
      let c = c0 + wa * vec2f(cos(ph), 0.5 * sin(ph)) * 2.0;
      let q = g - c;
      let dd = dot(q, q);
      shade += exp(-dd * 6.0);
      if (dd < bd) { bd = dd; bq = q; bph = ph; }
    }
  }
  let rad = 0.45;
  let n = ballN(bq, rad);
  var ball = chrome(n, metalF0(), 0.2 * sin(t * 0.2));
  ball *= 0.55 + 0.45 * n.z;
  let m = smoothstep(rad, rad - 1.5 * px() * sc, sqrt(bd));
  let gr = gnoise(vec2f(p.x * 5.0, p.y * 400.0), 421u);
  var plate = (u.ink.rgb + u.tone.rgb * 0.12 * (0.8 + 0.2 * gr)) * (1.0 - 0.55 * clamp(shade - 0.25, 0.0, 1.0));
  return present(mix(plate, ball, m));
}

// the cradle frame and balls: rgb color and a coverage mask. Only the end
// balls swing; one lifts on each half of the period.
fn cradle(p: vec2f, A: f32, nb: i32, ph: f32) -> vec4f {
    let py = 0.36; let L = 0.46; let rb = 0.07;
    var col = vec3f(0.0); var m = 0.0;
    let bar = (p.y - py) / 0.012;
    let fx = abs(p.x) < 0.46;
    if (abs(bar) < 1.0 && fx) { col = tubeShade(bar, vec2f(0.0, 1.0), metalF0(), 0.0); m = bandMask(bar, 2.0 * px() / 0.012); }
    let post = (abs(p.x) - 0.46) / 0.012;
    if (abs(post) < 1.0 && p.y < py + 0.012 && p.y > -0.36) { col = tubeShade(post, vec2f(1.0, 0.0), metalF0(), 0.0); m = bandMask(post, 2.0 * px() / 0.012); }
    let nf = f32(nb);
    let s = sin(ph);
    for (var i: i32 = 0; i < 6; i++) {
        if (i >= nb) { break; }
        let fi = f32(i);
        var th = 0.0;
        if (i == 0) { th = -A * max(-s, 0.0); }
        if (i == nb - 1) { th = A * max(s, 0.0); }
        let x0 = (fi - 0.5 * (nf - 1.0)) * 2.0 * rb;
        let piv = vec2f(x0, py);
        let ctr = piv + L * vec2f(sin(th), -cos(th));
        let ab = ctr - piv;
        let hq = clamp(dot(p - piv, ab) / dot(ab, ab), 0.0, 1.0);
        let sd = length(p - piv - ab * hq);
        let sm = smoothstep(0.0022, 0.0008, sd) * step(p.y, py);
        col = mix(col, vec3f(0.55, 0.55, 0.58), sm * (1.0 - m)); m = max(m, sm);
        let q = p - ctr;
        let bm = smoothstep(rb, rb - 1.5 * px(), length(q));
        if (bm > 0.0) {
            let n = ballN(q, rb);
            col = mix(col, chrome(n, metalF0(), th) * (0.6 + 0.4 * n.z), bm); m = max(m, bm);
        }
    }
    return vec4f(col, m);
}
@fragment fn fs_newton_cradle(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let p = cuv(fp.xy);
  let t = u.time + 6.0;
  let k = u.k;
  let A = mix(0.2, 0.45, k.x); let nb = i32(mix(4.0, 6.0, k.y)); let ph = t * mix(1.6, 3.6, k.z);
  let by = -0.36;
  let top = cradle(p, A, nb, ph);
  let mp = vec2f(p.x, 2.0 * by - p.y);
  let refl = cradle(mp, A, nb, ph);
  let bn = normalize(vec3f(0.0, 0.5, 1.0));
  var base = chrome(bn, vec3f(0.12), 0.0) * 0.5 + refl.rgb * refl.a * 0.45;
  base *= smoothstep(-0.5, by, p.y);
  let bg = u.ink.rgb + u.tone.rgb * 0.07 * smoothstep(-0.3, 0.5, p.y);
  var c = select(bg, base, p.y < by);
  c = mix(c, top.rgb, top.a);
  let lip = smoothstep(0.004, 0.0, abs(p.y - by));
  c += u.cream.rgb * lip * 0.4;
  return present(c);
}
