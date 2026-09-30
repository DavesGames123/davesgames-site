// ═══════════════════════════════════════════════════════════════════════════
//  LIQUID METAL TABLE  ·  one fragment shader per cell, fragment-only 2.5D
//  shading. Every cell reads p (centered, y up), the hover clock t and four
//  knobs k. It builds a height field, tube profile or blob field, takes a
//  normal from it and reflects env, a procedural studio tinted by the ink,
//  tone and cream swatches. Domain warping and finite-difference normals
//  after Quilez; metaballs after Blinn 1982; cellular noise after Worley 1996
//  with the Quilez exact edge distance; Fresnel after Schlick 1994; thin-film
//  color from two-beam interference; cosine palette after Quilez. The studio,
//  ribbon, tube and glass cores are original.
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
fn film(d: f32, ct: f32) -> vec3f {
    let opd = 2.0 * 1.4 * d * max(ct, 0.2);
    var c = vec3f(0.0); var wsum = vec3f(0.0);
    for (var i: i32 = 0; i < 7; i++) {
        let lam = 400.0 + 50.0 * f32(i);
        let w = vec3f(exp(-pow((lam - 600.0) / 50.0, 2.0)) + 0.3 * exp(-pow((lam - 440.0) / 25.0, 2.0)),
                      exp(-pow((lam - 545.0) / 45.0, 2.0)),
                      exp(-pow((lam - 450.0) / 35.0, 2.0)));
        c += w * (0.5 - 0.5 * cos(TAU * opd / lam));
        wsum += w;
    }
    return c / wsum * 1.2;
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

// ── the 33 cells ──────────────────────────────────────────────────────────
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
