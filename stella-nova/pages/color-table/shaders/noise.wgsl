// ═══════════════════════════════════════════════════════════════════════════
//  NOISE TABLE  ·  a taxonomy of the functions used to compose procedural
//  textures, one WGSL function per cell.
//
//  Every cell is  fn n_<name>(p: vec2f, t: f32, k: vec4f) -> f32  returning a
//  value in 0..1. p is the centered, aspect-corrected, globally scaled domain
//  (about ±2 across a cell), t the animated phase, k the four cell knobs (0..1).
//
//  References (the kit is assembled from these, not invented):
//    hash        Jarzynski & Olano, "Hash Functions for GPU Rendering", JCGT 2020 (pcg3d)
//    IGN         Jorge Jimenez, "Next Generation Post Processing in Call of Duty", 2014
//    value/perlin Perlin 1985/2002 (quintic fade), gradients from the hash
//    simplex     Gustavson / McEwan et al., webgl-noise (MIT), snoise 2D
//    worley      Worley, "A Cellular Texture Basis Function", SIGGRAPH 1996
//    fbm/warp    Quilez, "fbm" and "Domain warping" articles (iquilezles.org)
//    voronoise   Quilez, "Voronoise" (iquilezles.org)
//    smooth voronoi  Quilez, "Smooth Voronoi"
//    sdf         Quilez, "2D distance functions"
//    gabor       Lagae et al., "Procedural Noise using Sparse Gabor Convolution", 2009
//    phasor      Tricard et al., "Procedural Phasor Noise", SIGGRAPH 2019
//    spot/sparse Lewis, "Algorithms for Solid Noise Synthesis", 1989 (sparse convolution)
//    sum of sines Finch, "Effective Water Simulation", GPU Gems 1
// ═══════════════════════════════════════════════════════════════════════════

const PI: f32 = 3.14159265358979;
const TAU: f32 = 6.28318530717959;

// ───────────────────────────────────────────────────────────── hashing
fn pcg3d(vin: vec3u) -> vec3u {
    var v = vin * 1664525u + 1013904223u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    v ^= v >> vec3u(16u);
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    return v;
}
fn h3(p: vec3i, seed: u32) -> vec3f {
    let q = pcg3d(vec3u(p + vec3i(32768)) ^ vec3u(seed, seed * 3u + 1u, seed * 7u + 5u));
    return vec3f(q) * (1.0 / 4294967295.0);
}
fn h21(p: vec2i, seed: u32) -> f32 { return h3(vec3i(p, 0), seed).x; }
fn h22(p: vec2i, seed: u32) -> vec2f { return h3(vec3i(p, 0), seed).xy; }
fn h11(x: i32, seed: u32) -> f32 { return h3(vec3i(x, 0, 0), seed).x; }
fn fade(t: vec2f) -> vec2f { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
fn fade3(t: vec3f) -> vec3f { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
fn rot2(a: f32) -> mat2x2f { let c = cos(a); let s = sin(a); return mat2x2f(c, s, -s, c); }

// ───────────────────────────────────────────────────────────── lattice noises
// Value noise: random values at lattice points, quintic-smoothed bilinear blend.
fn vnoise(p: vec2f, seed: u32) -> f32 {
    let i = vec2i(floor(p)); let f = fade(fract(p));
    let a = h21(i, seed); let b = h21(i + vec2i(1, 0), seed);
    let c = h21(i + vec2i(0, 1), seed); let d = h21(i + vec2i(1, 1), seed);
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// Cubic value noise: 4x4 Catmull-Rom instead of quintic bilinear.
fn cubic4(a: f32, b: f32, c: f32, d: f32, t: f32) -> f32 {
    return b + 0.5 * t * (c - a + t * (2.0 * a - 5.0 * b + 4.0 * c - d + t * (3.0 * (b - c) + d - a)));
}
fn vnoise_cubic(p: vec2f, seed: u32) -> f32 {
    let i = vec2i(floor(p)); let f = fract(p);
    var rows: array<f32, 4>;
    for (var y: i32 = -1; y <= 2; y++) {
        rows[y + 1] = cubic4(h21(i + vec2i(-1, y), seed), h21(i + vec2i(0, y), seed), h21(i + vec2i(1, y), seed), h21(i + vec2i(2, y), seed), f.x);
    }
    return clamp(cubic4(rows[0], rows[1], rows[2], rows[3], f.y), 0.0, 1.0);
}
// Perlin gradient noise, 2D: unit gradients from the hash, dot with the offset, quintic blend. Returns ~-1..1.
fn grad2(i: vec2i, seed: u32) -> vec2f { let a = h21(i, seed) * TAU; return vec2f(cos(a), sin(a)); }
fn pnoise(p: vec2f, seed: u32) -> f32 {
    let i = vec2i(floor(p)); let f = fract(p); let u = fade(f);
    let a = dot(grad2(i, seed), f); let b = dot(grad2(i + vec2i(1, 0), seed), f - vec2f(1.0, 0.0));
    let c = dot(grad2(i + vec2i(0, 1), seed), f - vec2f(0.0, 1.0)); let d = dot(grad2(i + vec2i(1, 1), seed), f - vec2f(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.414;
}
// Periodic Perlin: the lattice wraps every `period` cells, so the texture tiles.
fn pnoise_tiled(p: vec2f, period: vec2i, seed: u32) -> f32 {
    let i = vec2i(floor(p)); let f = fract(p); let u = fade(f);
    let i00 = ((i % period) + period) % period; let i11 = (((i + 1) % period) + period) % period;
    let a = dot(grad2(i00, seed), f); let b = dot(grad2(vec2i(i11.x, i00.y), seed), f - vec2f(1.0, 0.0));
    let c = dot(grad2(vec2i(i00.x, i11.y), seed), f - vec2f(0.0, 1.0)); let d = dot(grad2(i11, seed), f - vec2f(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.414;
}
// Perlin 3D, for animated slices: random unit gradients on the sphere.
fn grad3(i: vec3i, seed: u32) -> vec3f {
    let r = h3(i, seed); let z = r.x * 2.0 - 1.0; let a = r.y * TAU; let s = sqrt(max(1.0 - z * z, 0.0));
    return vec3f(s * cos(a), s * sin(a), z);
}
fn pnoise3(p: vec3f, seed: u32) -> f32 {
    let i = vec3i(floor(p)); let f = fract(p); let u = fade3(f);
    var v: array<f32, 8>;
    for (var n: i32 = 0; n < 8; n++) {
        let o = vec3i(n & 1, (n >> 1u) & 1, (n >> 2u) & 1);
        v[n] = dot(grad3(i + o, seed), f - vec3f(o));
    }
    return mix(mix(mix(v[0], v[1], u.x), mix(v[2], v[3], u.x), u.y), mix(mix(v[4], v[5], u.x), mix(v[6], v[7], u.x), u.y), u.z) * 1.15;
}
// Simplex noise 2D (Gustavson / McEwan, webgl-noise). Returns ~-1..1.
fn mod289v3(x: vec3f) -> vec3f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn mod289v2(x: vec2f) -> vec2f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn permute3(x: vec3f) -> vec3f { return mod289v3(((x * 34.0) + 1.0) * x); }
fn snoise(v: vec2f) -> f32 {
    let C = vec4f(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    var i = floor(v + dot(v, C.yy));
    let x0 = v - i + dot(i, C.xx);
    var i1 = vec2f(0.0, 1.0);
    if (x0.x > x0.y) { i1 = vec2f(1.0, 0.0); }
    var x12 = x0.xyxy + C.xxzz;
    x12 = vec4f(x12.xy - i1, x12.zw);
    i = mod289v2(i);
    let p = permute3(permute3(i.y + vec3f(0.0, i1.y, 1.0)) + i.x + vec3f(0.0, i1.x, 1.0));
    var m = max(vec3f(0.5) - vec3f(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), vec3f(0.0));
    m = m * m; m = m * m;
    let x = 2.0 * fract(p * C.www) - 1.0;
    let h = abs(x) - 0.5;
    let ox = floor(x + 0.5);
    let a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    let g = vec3f(a0.x * x0.x + h.x * x0.y, a0.yz * x12.xz + h.yz * x12.yw);
    return 130.0 * dot(m, g);
}

// ───────────────────────────────────────────────────────────── fractal sums
fn fbm(pin: vec2f, oct: i32, lac: f32, gain: f32, seed: u32) -> f32 {
    var p = pin; var a = 0.5; var s = 0.0; var nrm = 0.0;
    for (var i: i32 = 0; i < 8; i++) {
        if (i >= oct) { break; }
        s += a * pnoise(p, seed + u32(i)); nrm += a; a *= gain; p = rot2(0.5) * p * lac;
    }
    return s / nrm;                 // ~-1..1
}
fn fbm01(p: vec2f, oct: i32, lac: f32, gain: f32, seed: u32) -> f32 { return 0.5 + 0.5 * fbm(p, oct, lac, gain, seed); }
fn turbulence(pin: vec2f, oct: i32, lac: f32, gain: f32, seed: u32) -> f32 {
    var p = pin; var a = 0.5; var s = 0.0; var nrm = 0.0;
    for (var i: i32 = 0; i < 8; i++) {
        if (i >= oct) { break; }
        s += a * abs(pnoise(p, seed + u32(i))); nrm += a; a *= gain; p = rot2(0.5) * p * lac;
    }
    return s / nrm;
}
fn ridged(pin: vec2f, oct: i32, lac: f32, gain: f32, sharp: f32, seed: u32) -> f32 {
    var p = pin; var a = 0.5; var s = 0.0; var nrm = 0.0; var w = 1.0;
    for (var i: i32 = 0; i < 8; i++) {
        if (i >= oct) { break; }
        var r = 1.0 - abs(pnoise(p, seed + u32(i))); r = pow(r, sharp) * w; w = clamp(r * 2.0, 0.0, 1.0);
        s += a * r; nrm += a; a *= gain; p = rot2(0.5) * p * lac;
    }
    return s / nrm;
}

// ───────────────────────────────────────────────────────────── cellular
// Worley: nearest and second-nearest jittered feature points in the 3x3 neighborhood.
// metric 0 euclidean, 1 manhattan, 2 chebyshev. Returns (F1, F2, cell id).
fn worley(p: vec2f, jitter: f32, metric: i32, seed: u32) -> vec3f {
    let i = vec2i(floor(p)); let f = fract(p);
    var f1 = 8.0; var f2 = 8.0; var id = 0.0;
    for (var y: i32 = -1; y <= 1; y++) {
        for (var x: i32 = -1; x <= 1; x++) {
            let o = vec2i(x, y);
            let r = vec2f(o) + mix(vec2f(0.5), h22(i + o, seed), jitter) - f;
            var d = dot(r, r);
            if (metric == 1) { let m = abs(r.x) + abs(r.y); d = m * m; }
            if (metric == 2) { let m = max(abs(r.x), abs(r.y)); d = m * m; }
            if (d < f1) { f2 = f1; f1 = d; id = h21(i + o, seed + 9u); }
            else if (d < f2) { f2 = d; }
        }
    }
    return vec3f(sqrt(f1), sqrt(f2), id);
}
// Smooth Voronoi (Quilez): exponential soft-min of the distances, no cell edges.
fn worley_smooth(p: vec2f, k: f32, seed: u32) -> f32 {
    let i = vec2i(floor(p)); let f = fract(p); var res = 0.0;
    for (var y: i32 = -1; y <= 1; y++) {
        for (var x: i32 = -1; x <= 1; x++) {
            let o = vec2i(x, y); let r = vec2f(o) + h22(i + o, seed) - f;
            res += exp2(-k * length(r));
        }
    }
    return -log2(res) / k;
}
// Voronoise (Quilez): one function that morphs between value noise and Voronoi cells.
fn voronoise(p: vec2f, u: f32, v: f32, seed: u32) -> f32 {
    let kk = 1.0 + 63.0 * pow(1.0 - v, 6.0);
    let i = vec2i(floor(p)); let f = fract(p);
    var a = vec2f(0.0);
    for (var y: i32 = -2; y <= 2; y++) {
        for (var x: i32 = -2; x <= 2; x++) {
            let g = vec2f(f32(x), f32(y));
            let o = h3(vec3i(i + vec2i(x, y), 0), seed) * vec3f(u, u, 1.0);
            let d = g - f + o.xy;
            let w = pow(1.0 - smoothstep(0.0, 1.414, length(d)), kk);
            a += vec2f(o.z * w, w);
        }
    }
    return a.x / a.y;
}

// ───────────────────────────────────────────────────────────── distance fields (Quilez)
fn sdCircle(p: vec2f, r: f32) -> f32 { return length(p) - r; }
fn sdBox(p: vec2f, b: vec2f) -> f32 { let d = abs(p) - b; return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0); }
fn sdSegment(p: vec2f, a: vec2f, b: vec2f) -> f32 { let pa = p - a; let ba = b - a; let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
fn sdNgon(p: vec2f, r: f32, n: f32) -> f32 {
    let an = PI / n; let a = atan2(p.y, p.x);
    let b = (((a % (2.0 * an)) + 2.0 * an) % (2.0 * an)) - an;
    return length(p) * cos(b) - r;
}
fn sdStar5(pin: vec2f, r: f32, rf: f32) -> f32 {
    let k1 = vec2f(0.809016994375, -0.587785252292); let k2 = vec2f(-k1.x, k1.y);
    var p = vec2f(abs(pin.x), pin.y);
    p -= 2.0 * max(dot(k1, p), 0.0) * k1;
    p -= 2.0 * max(dot(k2, p), 0.0) * k2;
    p.x = abs(p.x); p.y -= r;
    let ba = rf * vec2f(-k1.y, k1.x) - vec2f(0.0, 1.0);
    let h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
    return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
fn fill(d: f32, aa: f32) -> f32 { return 1.0 - smoothstep(-aa, aa, d); }

// ───────────────────────────────────────────────────────────── kernels
// One Gabor kernel: gaussian envelope times a cosine grating (Lagae 2009).
fn gabor(p: vec2f, a: f32, f0: f32, w0: f32) -> f32 {
    return exp(-PI * a * a * dot(p, p)) * cos(TAU * f0 * (p.x * cos(w0) + p.y * sin(w0)));
}
// Sparse Gabor convolution: jittered kernels in each of 3x3 cells; iso in [0,1] blends isotropic vs one orientation.
fn gabor_noise(p: vec2f, a: f32, f0: f32, w0: f32, iso: f32, per: i32, seed: u32) -> f32 {
    let i = vec2i(floor(p)); let f = fract(p); var s = 0.0;
    for (var y: i32 = -1; y <= 1; y++) {
        for (var x: i32 = -1; x <= 1; x++) {
            let o = vec2i(x, y);
            for (var n: i32 = 0; n < 4; n++) {
                if (n >= per) { break; }
                let r = h3(vec3i(i + o, n), seed);
                let q = f - vec2f(o) - r.xy;
                let w = mix(w0, r.z * TAU, iso);
                s += (h3(vec3i(i + o, n + 8), seed).x * 2.0 - 1.0) * gabor(q, a, f0, w);
            }
        }
    }
    return s;
}
// Phasor noise (Tricard 2019): track the kernels as complex numbers, output the phase → strict oscillation.
fn phasor(p: vec2f, a: f32, f0: f32, w0: f32, iso: f32, seed: u32) -> vec2f {
    let i = vec2i(floor(p)); let f = fract(p); var z = vec2f(0.0);
    for (var y: i32 = -1; y <= 1; y++) {
        for (var x: i32 = -1; x <= 1; x++) {
            let o = vec2i(x, y);
            for (var n: i32 = 0; n < 3; n++) {
                let r = h3(vec3i(i + o, n), seed);
                let q = f - vec2f(o) - r.xy;
                let w = mix(w0, r.z * TAU, iso);
                let env = exp(-PI * a * a * dot(q, q));
                let ph = TAU * f0 * (q.x * cos(w) + q.y * sin(w));
                z += env * vec2f(cos(ph), sin(ph));
            }
        }
    }
    return z;
}

// ═══════════════════════════════════════════════════════════════ THE CELLS
// knobs: k.x k.y k.z k.w, each 0..1; the meaning is named in the table.

// —— hash ————————————————————————————————————————————————————————————————
// white: an independent random value per lattice cell of the current scale.
fn n_white(p: vec2f, t: f32, k: vec4f) -> f32 {
    let cells = mix(8.0, 80.0, k.x);
    let frame = floor(t * mix(0.0, 24.0, k.y));
    return h21(vec2i(floor(p * cells)), 1u + u32(frame));
}
// bayer: the 8x8 ordered-dither matrix thresholding a moving gradient.
const BAYER8 = array<u32, 64>(0u,32u,8u,40u,2u,34u,10u,42u, 48u,16u,56u,24u,50u,18u,58u,26u, 12u,44u,4u,36u,14u,46u,6u,38u, 60u,28u,52u,20u,62u,30u,54u,22u,
    3u,35u,11u,43u,1u,33u,9u,41u, 51u,19u,59u,27u,49u,17u,57u,25u, 15u,47u,7u,39u,13u,45u,5u,37u, 63u,31u,55u,23u,61u,29u,53u,21u);
fn n_bayer(p: vec2f, t: f32, k: vec4f) -> f32 {
    let cells = mix(8.0, 64.0, k.x);
    let c = vec2i(floor(p * cells));
    let thr = (f32(BAYER8[(c.y & 7) * 8 + (c.x & 7)]) + 0.5) / 64.0;
    let g = 0.5 + 0.5 * sin(p.x * mix(1.0, 4.0, k.z) + t * k.y);
    return select(0.0, 1.0, g > thr);
}
// ign: interleaved gradient noise (Jimenez), the screen-space dither used in games.
fn n_ign(p: vec2f, t: f32, k: vec4f) -> f32 {
    let px = floor(p * mix(20.0, 160.0, k.x)) + floor(t * 6.0 * k.y);
    return fract(52.9829189 * fract(dot(px, vec2f(0.06711056, 0.00583715))));
}
// cells: a random grey per grid cell, with random cell aspect.
fn n_hash_cells(p: vec2f, t: f32, k: vec4f) -> f32 {
    let g = vec2f(mix(2.0, 24.0, k.x), mix(2.0, 24.0, k.y));
    let i = vec2i(floor(p * g + vec2f(t * k.z, 0.0)));
    return h21(i, 3u);
}
// sparkle: a hashed threshold that twinkles by sampling a second hash on time.
fn n_sparkle(p: vec2f, t: f32, k: vec4f) -> f32 {
    let i = vec2i(floor(p * mix(10.0, 60.0, k.x)));
    let r = h3(vec3i(i, 0), 5u);
    let ph = fract(t * mix(0.2, 2.0, k.y) + r.y);
    let on = step(1.0 - mix(0.02, 0.4, k.z), r.x);
    return on * (0.5 + 0.5 * sin(ph * TAU)) * mix(0.5, 1.0, r.z);
}
// dust: one jittered dot per cell, radius from the hash.
fn n_dust(p: vec2f, t: f32, k: vec4f) -> f32 {
    let q = p * mix(4.0, 24.0, k.x) + vec2f(0.0, t * 0.4 * k.w);
    let i = vec2i(floor(q)); let f = fract(q); var v = 0.0;
    for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) {
        let o = vec2i(x, y); let r = h3(vec3i(i + o, 0), 7u);
        let d = length(f - vec2f(o) - r.xy);
        v = max(v, fill(d - mix(0.05, 0.4, k.y) * r.z, mix(0.01, 0.3, k.z)));
    } }
    return v;
}

// r2: Roberts' R2 quasi-random sequence — evenly spread points from a plastic-constant recurrence.
fn n_r2(p: vec2f, t: f32, k: vec4f) -> f32 {
    let n = i32(mix(10.0, 200.0, k.x)); var v = 0.0; let rad = mix(0.01, 0.08, k.y);
    let q = fract(p * 0.25 + 0.5);
    for (var i: i32 = 0; i < 400; i++) { if (i >= n) { break; }
        let fi = f32(i) + t * 2.0 * k.z;
        let pt = fract(vec2f(0.7548776662, 0.5698402910) * fi + 0.5);
        var d = abs(q - pt); d = min(d, 1.0 - d);
        v = max(v, fill(length(d) - rad, 0.005)); }
    return v;
}

// —— lattice —————————————————————————————————————————————————————————————
fn n_value(p: vec2f, t: f32, k: vec4f) -> f32 { return vnoise(p * mix(1.0, 12.0, k.x) + vec2f(t * 0.3 * k.y, 0.0), 11u); }
fn n_value_cubic(p: vec2f, t: f32, k: vec4f) -> f32 { return vnoise_cubic(p * mix(1.0, 12.0, k.x) + vec2f(t * 0.3 * k.y, 0.0), 11u); }
fn n_perlin(p: vec2f, t: f32, k: vec4f) -> f32 { return 0.5 + 0.5 * pnoise(p * mix(1.0, 12.0, k.x) + vec2f(t * 0.3 * k.y, 0.0), 13u); }
fn n_simplex(p: vec2f, t: f32, k: vec4f) -> f32 { return 0.5 + 0.5 * snoise(p * mix(1.0, 12.0, k.x) + vec2f(t * 0.3 * k.y, 0.0)); }
fn n_perlin3d(p: vec2f, t: f32, k: vec4f) -> f32 { return 0.5 + 0.5 * pnoise3(vec3f(p * mix(1.0, 12.0, k.x), t * mix(0.05, 1.0, k.y)), 17u); }
// tiled: periodic gradient noise; the outline shows the tile that repeats.
fn n_tiled(p: vec2f, t: f32, k: vec4f) -> f32 {
    let per = i32(mix(2.0, 8.0, k.x));
    let q = (p + vec2f(t * 0.2 * k.y, 0.0)) * 2.0;
    let v = 0.5 + 0.5 * pnoise_tiled(q, vec2i(per), 19u);
    let cell = fract(q / f32(per)); let edge = min(min(cell.x, 1.0 - cell.x), min(cell.y, 1.0 - cell.y));
    return mix(v, 1.0, k.z * (1.0 - smoothstep(0.0, 0.02, edge)));
}

// —— fractal ——————————————————————————————————————————————————————————————
fn n_fbm(p: vec2f, t: f32, k: vec4f) -> f32 { return fbm01(p * mix(0.5, 6.0, k.x) + vec2f(t * 0.2 * k.w, 0.0), i32(mix(1.0, 8.0, k.y)), 2.0, mix(0.3, 0.8, k.z), 23u); }
fn n_turbulence(p: vec2f, t: f32, k: vec4f) -> f32 { return turbulence(p * mix(0.5, 6.0, k.x) + vec2f(t * 0.2 * k.w, 0.0), i32(mix(1.0, 8.0, k.y)), 2.0, mix(0.3, 0.8, k.z), 23u) * 1.6; }
fn n_ridged(p: vec2f, t: f32, k: vec4f) -> f32 { return ridged(p * mix(0.5, 6.0, k.x) + vec2f(t * 0.2 * k.w, 0.0), i32(mix(1.0, 8.0, k.y)), 2.0, 0.5, mix(1.0, 4.0, k.z), 29u) * 1.5; }
// billow: fbm of |noise|, inverted — the puffy cloud look.
fn n_billow(p: vec2f, t: f32, k: vec4f) -> f32 { return 1.0 - turbulence(p * mix(0.5, 6.0, k.x) + vec2f(t * 0.2 * k.w, 0.0), i32(mix(1.0, 8.0, k.y)), 2.0, mix(0.3, 0.8, k.z), 31u) * 1.6; }
// multifractal: octaves multiply rather than add, so rough stays rough only where the base is rough.
fn n_multifractal(p: vec2f, t: f32, k: vec4f) -> f32 {
    var q = p * mix(0.5, 6.0, k.x) + vec2f(t * 0.2 * k.w, 0.0); var v = 1.0; var a = 1.0;
    let oct = i32(mix(1.0, 8.0, k.y)); let off = mix(0.4, 1.2, k.z);
    for (var i: i32 = 0; i < 8; i++) { if (i >= oct) { break; }
        v *= (pnoise(q, 37u + u32(i)) * a + off); a *= 0.5; q = rot2(0.5) * q * 2.0; }
    return clamp(v * 0.8, 0.0, 1.0);
}
// warp: Quilez domain warping, f(p + 4 f(p + 4 f(p))).
fn n_warp(p: vec2f, t: f32, k: vec4f) -> f32 {
    let s = mix(0.5, 4.0, k.x); let amt = mix(0.0, 4.0, k.y); let oct = i32(mix(2.0, 6.0, k.z));
    let q = vec2f(fbm(p * s, oct, 2.0, 0.5, 41u), fbm(p * s + vec2f(5.2, 1.3), oct, 2.0, 0.5, 43u));
    let r = vec2f(fbm(p * s + amt * q + vec2f(1.7, 9.2) + t * 0.1 * k.w, oct, 2.0, 0.5, 47u), fbm(p * s + amt * q + vec2f(8.3, 2.8) + t * 0.08 * k.w, oct, 2.0, 0.5, 53u));
    return fbm01(p * s + amt * r, oct, 2.0, 0.5, 59u);
}
// warp_self: a single noise displaced by its own gradient, iterated — flow-like folds.
fn n_warp_self(p: vec2f, t: f32, k: vec4f) -> f32 {
    var q = p * mix(0.5, 4.0, k.x); let amt = mix(0.0, 1.5, k.y); let n = i32(mix(1.0, 5.0, k.z));
    for (var i: i32 = 0; i < 5; i++) { if (i >= n) { break; }
        let e = 0.01; let v = pnoise(q + t * 0.1 * k.w, 61u);
        let g = vec2f(pnoise(q + vec2f(e, 0.0) + t * 0.1 * k.w, 61u) - v, pnoise(q + vec2f(0.0, e) + t * 0.1 * k.w, 61u) - v) / e;
        q += amt * 0.1 * vec2f(-g.y, g.x); }
    return fbm01(q, 4, 2.0, 0.5, 61u);
}
// octave_rotate: fbm whose octaves each rotate with time at their own rate — the swirl in "noise-y" clouds.
fn n_octave_rotate(p: vec2f, t: f32, k: vec4f) -> f32 {
    var q = p * mix(0.5, 5.0, k.x); var a = 0.5; var s = 0.0; var nrm = 0.0; let oct = i32(mix(2.0, 8.0, k.y));
    for (var i: i32 = 0; i < 8; i++) { if (i >= oct) { break; }
        s += a * pnoise(rot2(t * mix(0.0, 0.4, k.z) * f32(i + 1)) * q, 67u + u32(i)); nrm += a; a *= 0.5; q *= 2.0; }
    return 0.5 + 0.5 * s / nrm;
}

// fbm_value: the same octave sum built on value noise — blockier lows than the gradient version.
fn n_fbm_value(p: vec2f, t: f32, k: vec4f) -> f32 {
    var q = p * mix(0.5, 6.0, k.x) + vec2f(t * 0.2 * k.w, 0.0); var a = 0.5; var s = 0.0; var nrm = 0.0; let oct = i32(mix(1.0, 8.0, k.y));
    for (var i: i32 = 0; i < 8; i++) { if (i >= oct) { break; }
        s += a * vnoise(q, 211u + u32(i)); nrm += a; a *= mix(0.3, 0.8, k.z); q = rot2(0.5) * q * 2.0; }
    return s / nrm;
}

// —— cellular —————————————————————————————————————————————————————————————
fn n_worley_f1(p: vec2f, t: f32, k: vec4f) -> f32 { return worley(p * mix(1.0, 10.0, k.x) + t * 0.3 * k.w, k.y, 0, 71u).x; }
fn n_worley_f2(p: vec2f, t: f32, k: vec4f) -> f32 { return worley(p * mix(1.0, 10.0, k.x) + t * 0.3 * k.w, k.y, 0, 71u).y * 0.7; }
fn n_worley_edge(p: vec2f, t: f32, k: vec4f) -> f32 { let w = worley(p * mix(1.0, 10.0, k.x) + t * 0.3 * k.w, k.y, 0, 71u); return smoothstep(0.0, mix(0.05, 0.6, k.z), w.y - w.x); }
fn n_voronoi_id(p: vec2f, t: f32, k: vec4f) -> f32 { let w = worley(p * mix(1.0, 10.0, k.x) + t * 0.3 * k.w, k.y, 0, 71u); return mix(w.z, 0.0, smoothstep(mix(0.2, 0.0, k.z), 0.0, w.y - w.x)); }
fn n_worley_manhattan(p: vec2f, t: f32, k: vec4f) -> f32 { return worley(p * mix(1.0, 10.0, k.x) + t * 0.3 * k.w, k.y, 1, 73u).x * 0.8; }
fn n_worley_chebyshev(p: vec2f, t: f32, k: vec4f) -> f32 { return worley(p * mix(1.0, 10.0, k.x) + t * 0.3 * k.w, k.y, 2, 73u).x; }
fn n_worley_smooth(p: vec2f, t: f32, k: vec4f) -> f32 { return worley_smooth(p * mix(1.0, 10.0, k.x) + t * 0.3 * k.w, mix(2.0, 40.0, k.y), 79u) * 1.1; }
fn n_voronoise(p: vec2f, t: f32, k: vec4f) -> f32 { return voronoise(p * mix(1.0, 10.0, k.x) + t * 0.3 * k.w, k.y, k.z, 83u); }
// cracks: the Worley edge distance warped by fbm, thresholded thin — dried mud.
fn n_cracks(p: vec2f, t: f32, k: vec4f) -> f32 {
    let q = p * mix(1.0, 8.0, k.x) + 0.35 * k.y * vec2f(fbm(p * 3.0 + t * 0.05, 3, 2.0, 0.5, 89u), fbm(p * 3.0 + 4.1, 3, 2.0, 0.5, 97u));
    let w = worley(q, 1.0, 0, 101u);
    return 1.0 - smoothstep(0.0, mix(0.02, 0.2, k.z), w.y - w.x);
}

// worley_fbm: F1 summed over octaves — the cellular fbm behind scales, foam and lava.
fn n_worley_fbm(p: vec2f, t: f32, k: vec4f) -> f32 {
    var q = p * mix(1.0, 6.0, k.x) + t * 0.2 * k.w; var a = 0.5; var s = 0.0; var nrm = 0.0; let oct = i32(mix(1.0, 5.0, k.y));
    for (var i: i32 = 0; i < 5; i++) { if (i >= oct) { break; }
        s += a * worley(q, k.z, 0, 223u + u32(i)).x; nrm += a; a *= 0.5; q = rot2(0.6) * q * 2.0; }
    return s / nrm;
}

// —— periodic ——————————————————————————————————————————————————————————————
fn n_sine(p: vec2f, t: f32, k: vec4f) -> f32 { let q = rot2(k.y * PI) * p; return 0.5 + 0.5 * sin(q.x * mix(2.0, 40.0, k.x) + t * mix(0.0, 4.0, k.z)); }
fn n_plaid(p: vec2f, t: f32, k: vec4f) -> f32 { let f = mix(2.0, 30.0, k.x); return 0.5 + 0.5 * sin(p.x * f + t * k.z) * sin(p.y * f * mix(0.5, 2.0, k.y) + t * k.z); }
// interference: two gratings at a small angle → moiré beats.
fn n_interference(p: vec2f, t: f32, k: vec4f) -> f32 {
    let f = mix(10.0, 60.0, k.x); let a = mix(0.0, 0.3, k.y) + 0.02 * sin(t * k.z);
    let s1 = sin(p.x * f); let s2 = sin((rot2(a) * p).x * f);
    return 0.5 + 0.25 * (s1 + s2);
}
fn n_rings(p: vec2f, t: f32, k: vec4f) -> f32 { return 0.5 + 0.5 * sin(length(p) * mix(4.0, 60.0, k.x) - t * mix(0.0, 6.0, k.y)); }
fn n_spiral(p: vec2f, t: f32, k: vec4f) -> f32 { let a = atan2(p.y, p.x); return 0.5 + 0.5 * sin(a * floor(mix(1.0, 12.0, k.y)) + length(p) * mix(4.0, 40.0, k.x) - t * mix(0.0, 4.0, k.z)); }
fn n_checker(p: vec2f, t: f32, k: vec4f) -> f32 { let q = rot2(k.y * PI * 0.5) * p * mix(1.0, 16.0, k.x) + vec2f(t * k.z, 0.0); let c = floor(q); return f32((i32(c.x) + i32(c.y)) & 1); }
fn n_stripes_wave(p: vec2f, t: f32, k: vec4f) -> f32 { let x = p.x * mix(4.0, 40.0, k.x) + mix(0.0, 4.0, k.y) * sin(p.y * 3.0 + t * k.z); return smoothstep(0.4, 0.6, 0.5 + 0.5 * sin(x)); }
// hex: hexagonal lattice distance, the honeycomb.
fn n_hex(p: vec2f, t: f32, k: vec4f) -> f32 {
    let q = p * mix(1.0, 10.0, k.x) + vec2f(t * 0.3 * k.z, 0.0);
    let s = vec2f(1.0, 1.7320508); let a = (fract(q / s) - 0.5) * s; let b = (fract(q / s + 0.5) - 0.5) * s;
    var g = a; if (dot(a, a) > dot(b, b)) { g = b; }
    let d = max(abs(g.x) * 0.8660254 + abs(g.y) * 0.5, abs(g.y));
    return smoothstep(mix(0.5, 0.2, k.y), 0.5, d);
}
// sum of sines: Finch's water — directional sine waves of decreasing size, sharpened by pow.
fn n_sum_sines(p: vec2f, t: f32, k: vec4f) -> f32 {
    var s = 0.0; var amp = 1.0; var f = mix(2.0, 8.0, k.x); var nrm = 0.0;
    for (var i: i32 = 0; i < 6; i++) {
        let d = vec2f(cos(f32(i) * 1.9), sin(f32(i) * 1.9));
        s += amp * pow(0.5 + 0.5 * sin(dot(d, p) * f + t * mix(0.0, 3.0, k.z) * (1.0 + 0.3 * f32(i))), mix(1.0, 4.0, k.y));
        nrm += amp; amp *= 0.6; f *= 1.6;
    }
    return s / nrm;
}
// plasma: the demoscene classic — sines of x, y, the sum, and the distance.
fn n_plasma(p: vec2f, t: f32, k: vec4f) -> f32 {
    let q = p * mix(1.0, 6.0, k.x); let tt = t * mix(0.0, 2.0, k.y);
    let v = sin(q.x + tt) + sin(q.y + tt * 0.7) + sin(q.x + q.y + tt * 1.3) + sin(length(q + vec2f(sin(tt * 0.5), cos(tt * 0.4)) * 2.0) + tt);
    return 0.5 + 0.5 * sin(v * mix(0.5, 3.0, k.z));
}

// hatch: two thresholded gratings, the engraver's cross-hatch, density from a noise field.
fn n_hatch(p: vec2f, t: f32, k: vec4f) -> f32 {
    let f = mix(10.0, 60.0, k.x); let dens = fbm01(p * 1.5 + t * 0.1 * k.z, 3, 2.0, 0.5, 227u);
    let a = step(mix(0.2, 0.9, k.y) * dens, 0.5 + 0.5 * sin(p.x * f + p.y * f * 0.3));
    let b = step(mix(0.2, 0.9, k.y) * (dens - 0.3), 0.5 + 0.5 * sin(p.y * f - p.x * f * 0.3));
    return a * b;
}

// —— domain ——————————————————————————————————————————————————————————————
// polar: fbm sampled in (angle, radius) — rings and spokes.
fn n_polar(p: vec2f, t: f32, k: vec4f) -> f32 {
    let a = atan2(p.y, p.x); let r = length(p);
    return fbm01(vec2f(a * mix(1.0, 6.0, k.x) / PI, r * mix(1.0, 8.0, k.y) - t * 0.4 * k.z), 4, 2.0, 0.5, 103u);
}
// log-polar: the zoom-invariant remap; scrolling the log axis zooms forever.
fn n_logpolar(p: vec2f, t: f32, k: vec4f) -> f32 {
    let a = atan2(p.y, p.x); let r = log(length(p) + 1e-4);
    return fbm01(vec2f(a * mix(1.0, 6.0, k.x) / PI, r * mix(1.0, 4.0, k.y) - t * 0.3 * k.z), 4, 2.0, 0.5, 107u);
}
// kaleidoscope: fold the plane into a wedge, mirror it — n-fold symmetry from any noise.
fn n_kaleido(p: vec2f, t: f32, k: vec4f) -> f32 {
    let n = floor(mix(2.0, 12.0, k.x)); var a = atan2(p.y, p.x) + t * 0.1 * k.z; let r = length(p);
    let w = TAU / n; a = abs(fract(a / w) - 0.5) * w;
    return fbm01(vec2f(cos(a), sin(a)) * r * mix(1.0, 6.0, k.y) + 3.0, 4, 2.0, 0.5, 109u);
}
// twist: rotate by an angle that grows with radius.
fn n_twist(p: vec2f, t: f32, k: vec4f) -> f32 {
    let q = rot2(length(p) * mix(0.0, 6.0, k.x) + t * 0.3 * k.z) * p;
    return smoothstep(0.4, 0.6, 0.5 + 0.5 * sin(q.x * mix(4.0, 30.0, k.y)));
}
// zoom cascade: the same pattern at several scales, blended by a zoom that never ends.
fn n_zoom_cascade(p: vec2f, t: f32, k: vec4f) -> f32 {
    let z = fract(t * mix(0.0, 0.3, k.y)); var s = 0.0; var nrm = 0.0;
    for (var i: i32 = 0; i < 4; i++) {
        let sc = exp2(f32(i) + z) * mix(0.5, 2.0, k.x);
        let w = sin(PI * fract((f32(i) + z) / 4.0));
        s += w * pnoise(p * sc, 113u + u32(i)); nrm += w;
    }
    return 0.5 + 0.5 * s / max(nrm, 1e-3);
}
// repeat: domain repetition with a per-tile hashed rotation and offset.
fn n_repeat(p: vec2f, t: f32, k: vec4f) -> f32 {
    let q = p * mix(1.0, 8.0, k.x); let i = vec2i(floor(q)); let r = h3(vec3i(i, 0), 127u);
    let f = rot2(floor(r.x * 4.0) * PI * 0.5 * k.y) * (fract(q) - 0.5);
    return 1.0 - smoothstep(0.0, mix(0.1, 0.5, k.z), abs(sdCircle(f, 0.3 + 0.1 * sin(t + r.y * TAU))));
}
// sin-warp: displace the domain by sines before sampling — the marble/curtain warp.
fn n_sinwarp(p: vec2f, t: f32, k: vec4f) -> f32 {
    let q = p * mix(1.0, 6.0, k.x);
    let w = q + mix(0.0, 1.5, k.y) * vec2f(sin(q.y * 2.0 + t * 0.5 * k.z), sin(q.x * 2.0 - t * 0.4 * k.z));
    return fbm01(w, 4, 2.0, 0.5, 131u);
}
// reflect: mirror the domain in a moving line — the symmetric double.
fn n_mirror(p: vec2f, t: f32, k: vec4f) -> f32 {
    let n = vec2f(cos(t * 0.2 * k.z), sin(t * 0.2 * k.z)); var q = p;
    let d = dot(q, n) - mix(-0.6, 0.6, k.y); q -= 2.0 * max(d, 0.0) * n;
    return fbm01(q * mix(1.0, 6.0, k.x) + 7.0, 4, 2.0, 0.5, 137u);
}

// —— shaping ————————————————————————————————————————————————————————————————
fn n_contour(p: vec2f, t: f32, k: vec4f) -> f32 { let v = fbm01(p * mix(0.5, 4.0, k.x) + t * 0.1 * k.w, 4, 2.0, 0.5, 139u); let n = mix(2.0, 24.0, k.y); return 1.0 - smoothstep(0.0, mix(0.05, 0.5, k.z), abs(fract(v * n) - 0.5) * 2.0); }
fn n_posterize(p: vec2f, t: f32, k: vec4f) -> f32 { let v = fbm01(p * mix(0.5, 4.0, k.x) + t * 0.1 * k.w, 4, 2.0, 0.5, 139u); let n = floor(mix(2.0, 12.0, k.y)); return floor(v * n) / (n - 1.0); }
fn n_threshold(p: vec2f, t: f32, k: vec4f) -> f32 { let v = fbm01(p * mix(0.5, 4.0, k.x) + t * 0.1 * k.w, 4, 2.0, 0.5, 139u); return step(mix(0.3, 0.7, k.y), v); }
fn n_bands(p: vec2f, t: f32, k: vec4f) -> f32 { let v = fbm01(p * mix(0.5, 4.0, k.x) + t * 0.1 * k.w, 4, 2.0, 0.5, 139u); let w = mix(0.02, 0.3, k.z); return smoothstep(0.5 - w, 0.5 + w, 0.5 + 0.5 * sin(v * mix(6.0, 40.0, k.y))); }
// marble: sin(x + turbulence) — Perlin's original demo.
fn n_marble(p: vec2f, t: f32, k: vec4f) -> f32 { let q = p * mix(0.5, 4.0, k.x); return 0.5 + 0.5 * sin(q.x * mix(2.0, 10.0, k.y) + mix(0.0, 8.0, k.z) * turbulence(q + t * 0.05 * k.w, 5, 2.0, 0.5, 149u)); }
// wood: rings of a distance plus low-frequency noise, sharpened.
fn n_wood(p: vec2f, t: f32, k: vec4f) -> f32 { let q = p * mix(0.5, 3.0, k.x); let r = length(q + vec2f(0.6, 0.2)) + mix(0.0, 0.6, k.z) * fbm(q * 2.0 + t * 0.05 * k.w, 3, 2.0, 0.5, 151u); return pow(fract(r * mix(3.0, 16.0, k.y)), 0.5); }
// edges: finite-difference gradient magnitude of fbm — where the slope is.
fn n_edges(p: vec2f, t: f32, k: vec4f) -> f32 {
    let q = p * mix(0.5, 4.0, k.x) + t * 0.1 * k.w; let e = 0.002;
    let v = fbm(q, 4, 2.0, 0.5, 157u);
    let g = vec2f(fbm(q + vec2f(e, 0.0), 4, 2.0, 0.5, 157u) - v, fbm(q + vec2f(0.0, e), 4, 2.0, 0.5, 157u) - v) / e;
    return clamp(length(g) * mix(0.05, 0.6, k.y), 0.0, 1.0);
}
// gamma: the same fbm through a power curve and a bias/gain (Schlick) — the response curve as a knob.
fn n_gamma(p: vec2f, t: f32, k: vec4f) -> f32 {
    let v = fbm01(p * mix(0.5, 4.0, k.x) + t * 0.1 * k.w, 4, 2.0, 0.5, 139u);
    let g = mix(0.3, 3.0, k.y); let b = mix(0.2, 0.8, k.z);
    let bias = v / ((1.0 / b - 2.0) * (1.0 - v) + 1.0);
    return pow(clamp(bias, 0.0, 1.0), g);
}

// —— distance fields ———————————————————————————————————————————————————————
fn n_sdf_circles(p: vec2f, t: f32, k: vec4f) -> f32 { let q = fract(p * mix(0.5, 5.0, k.x)) - 0.5; let d = sdCircle(q, mix(0.1, 0.45, k.y) + 0.03 * sin(t * 2.0 * k.w)); return fill(d, mix(0.005, 0.2, k.z)); }
fn n_sdf_boxes(p: vec2f, t: f32, k: vec4f) -> f32 { let q = rot2(t * 0.3 * k.w) * (fract(p * mix(0.5, 5.0, k.x)) - 0.5); let d = sdBox(q, vec2f(mix(0.1, 0.4, k.y))) - mix(0.0, 0.15, k.z); return fill(d, 0.01); }
fn n_sdf_lines(p: vec2f, t: f32, k: vec4f) -> f32 { let q = fract(p * mix(0.5, 5.0, k.x)) - 0.5; let a = t * 0.5 * k.w; let d = sdSegment(q, vec2f(-0.4, 0.0) * rot2(a), vec2f(0.4, 0.0) * rot2(a)); return fill(d - mix(0.01, 0.15, k.y), mix(0.005, 0.1, k.z)); }
fn n_sdf_rings(p: vec2f, t: f32, k: vec4f) -> f32 { let q = fract(p * mix(0.5, 5.0, k.x)) - 0.5; let d = abs(sdCircle(q, mix(0.15, 0.45, k.y))) - mix(0.005, 0.08, k.z); return fill(d, 0.01) * (0.6 + 0.4 * sin(t * k.w * 3.0 + p.x)); }
fn n_sdf_star(p: vec2f, t: f32, k: vec4f) -> f32 { let q = rot2(t * 0.4 * k.w) * (fract(p * mix(0.5, 4.0, k.x)) - 0.5); return fill(sdStar5(q, mix(0.15, 0.45, k.y), mix(0.3, 0.9, k.z)), 0.01); }
fn n_sdf_ngon(p: vec2f, t: f32, k: vec4f) -> f32 { let q = rot2(t * 0.3 * k.w) * (fract(p * mix(0.5, 4.0, k.x)) - 0.5); return fill(abs(sdNgon(q, mix(0.15, 0.4, k.y), floor(mix(3.0, 9.0, k.z)))) - 0.02, 0.01); }
// blob: a circle whose boundary is displaced by fbm — the organic silhouette.
fn n_sdf_blob(p: vec2f, t: f32, k: vec4f) -> f32 { let d = sdCircle(p, mix(0.4, 1.2, k.x)) + mix(0.0, 0.6, k.y) * fbm(p * mix(1.0, 4.0, k.z) + t * 0.15 * k.w, 4, 2.0, 0.5, 163u); return fill(d, 0.01); }
// gyroid: a slice through the triply-periodic minimal surface, sin·cos terms.
fn n_gyroid(p: vec2f, t: f32, k: vec4f) -> f32 {
    let q = vec3f(p * mix(2.0, 12.0, k.x), t * mix(0.0, 2.0, k.w));
    let g = dot(sin(q), cos(q.zxy));
    return 1.0 - smoothstep(0.0, mix(0.1, 1.0, k.y), abs(g - mix(-1.0, 1.0, k.z)));
}

// —— convolution ————————————————————————————————————————————————————————————
fn n_gabor_kernel(p: vec2f, t: f32, k: vec4f) -> f32 { return 0.5 + 0.5 * gabor(p * 0.9, mix(0.4, 2.0, k.x), mix(0.5, 6.0, k.y), k.z * PI + t * 0.2 * k.w); }
fn n_gabor_noise(p: vec2f, t: f32, k: vec4f) -> f32 { return 0.5 + 0.35 * gabor_noise(p * mix(1.0, 4.0, k.x) + t * 0.2 * k.w, 1.0, mix(1.0, 6.0, k.y), 0.6, k.z, 4, 167u); }
fn n_gabor_aniso(p: vec2f, t: f32, k: vec4f) -> f32 { return 0.5 + 0.35 * gabor_noise(p * mix(1.0, 4.0, k.x) + t * 0.2 * k.w, mix(0.5, 2.0, k.z), mix(1.0, 6.0, k.y), 0.8, 0.0, 4, 173u); }
fn n_phasor(p: vec2f, t: f32, k: vec4f) -> f32 { let z = phasor(p * mix(1.0, 4.0, k.x) + t * 0.2 * k.w, 1.0, mix(1.0, 6.0, k.y), 0.6, k.z, 179u); return 0.5 + 0.5 * sin(atan2(z.y, z.x)); }
fn n_phasor_profile(p: vec2f, t: f32, k: vec4f) -> f32 { let z = phasor(p * mix(1.0, 4.0, k.x) + t * 0.2 * k.w, 1.0, mix(1.0, 6.0, k.y), 0.4, 0.0, 179u); let ph = fract(atan2(z.y, z.x) / TAU); let duty = mix(0.2, 0.8, k.z); return smoothstep(duty - 0.03, duty + 0.03, ph); }
// spot noise: sparse gaussian blobs with random sign (Lewis).
fn n_spot(p: vec2f, t: f32, k: vec4f) -> f32 {
    let q = p * mix(1.0, 6.0, k.x) + t * 0.15 * k.w; let i = vec2i(floor(q)); let f = fract(q); var s = 0.0;
    let w = mix(0.1, 0.6, k.y); let n = i32(mix(1.0, 4.0, k.z));
    for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) { for (var m: i32 = 0; m < 4; m++) { if (m >= n) { break; }
        let o = vec2i(x, y); let r = h3(vec3i(i + o, m), 181u); let d = f - vec2f(o) - r.xy;
        s += (r.z * 2.0 - 1.0) * exp(-dot(d, d) / (w * w)); } } }
    return clamp(0.5 + 0.5 * s, 0.0, 1.0);
}
// sparse convolution: random-amplitude cosine kernels (Lewis 1989).
fn n_sparse_conv(p: vec2f, t: f32, k: vec4f) -> f32 {
    let q = p * mix(1.0, 6.0, k.x) + t * 0.15 * k.w; let i = vec2i(floor(q)); let f = fract(q); var s = 0.0;
    let R = mix(0.4, 1.0, k.y);
    for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) { for (var m: i32 = 0; m < 2; m++) {
        let o = vec2i(x, y); let r = h3(vec3i(i + o, m), 191u); let d = length(f - vec2f(o) - r.xy);
        if (d < R) { s += (r.z * 2.0 - 1.0) * (0.5 + 0.5 * cos(PI * d / R)); } } } }
    return clamp(0.5 + s * mix(0.3, 1.0, k.z), 0.0, 1.0);
}
// caustics: overlapping sine sheets in absolute value, sharpened — the pool-floor look.
fn n_caustics(p: vec2f, t: f32, k: vec4f) -> f32 {
    var q = p * mix(1.0, 6.0, k.x); var s = 0.0; let tt = t * mix(0.0, 1.5, k.w);
    for (var i: i32 = 0; i < 4; i++) {
        q = rot2(0.9) * q + vec2f(sin(tt * 0.7 + f32(i)), cos(tt * 0.5 - f32(i))) * mix(0.0, 0.8, k.y);
        s += abs(sin(q.x * 2.0 + tt) + sin(q.y * 2.3 - tt * 0.8));
    }
    return pow(clamp(1.0 - s * 0.1, 0.0, 1.0), mix(1.0, 6.0, k.z));
}
// truchet: quarter-circle arcs in each cell, orientation from the hash — continuous curves from randomness.
fn n_truchet(p: vec2f, t: f32, k: vec4f) -> f32 {
    let q = p * mix(0.5, 5.0, k.x) + t * 0.2 * k.w; let i = vec2i(floor(q)); var f = fract(q);
    if (h21(i, 193u) < 0.5) { f.x = 1.0 - f.x; }
    let d = min(abs(length(f) - 0.5), abs(length(f - 1.0) - 0.5));
    return fill(d - mix(0.02, 0.2, k.y), mix(0.005, 0.1, k.z));
}
// stars: hashed points with sizes and a glow falloff.
fn n_stars(p: vec2f, t: f32, k: vec4f) -> f32 {
    let q = p * mix(2.0, 10.0, k.x); let i = vec2i(floor(q)); let f = fract(q); var v = 0.0;
    for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) {
        let o = vec2i(x, y); let r = h3(vec3i(i + o, 0), 197u);
        if (r.z < mix(0.3, 0.9, k.y)) { continue; }
        let d = length(f - vec2f(o) - r.xy); let tw = 0.7 + 0.3 * sin(t * 3.0 * k.w + r.x * TAU);
        v += tw * pow(max(1.0 - d / mix(0.25, 0.9, k.z), 0.0), 2.5); } }
    return clamp(v * 1.6, 0.0, 1.0);
}
// flow lines: stripes aligned with the gradient of a noise field — hair, brushed metal, LIC-like.
fn n_flow_lines(p: vec2f, t: f32, k: vec4f) -> f32 {
    let q = p * mix(0.5, 3.0, k.x) + t * 0.05 * k.w; let e = 0.01;
    let v = fbm(q, 3, 2.0, 0.5, 199u);
    let g = vec2f(fbm(q + vec2f(e, 0.0), 3, 2.0, 0.5, 199u) - v, fbm(q + vec2f(0.0, e), 3, 2.0, 0.5, 199u) - v);
    let a = atan2(g.y, g.x);
    return 0.5 + 0.5 * sin(dot(p, vec2f(cos(a), sin(a))) * mix(20.0, 120.0, k.y) + v * mix(0.0, 40.0, k.z));
}

struct NoiseU {
    size: vec2f, time: f32, pixelScale: f32,
    ink: vec4f, tone: vec4f, cream: vec4f,
    scale: f32, gain: f32, pad0: f32, pad1: f32,
    k: vec4f,
}
@group(0) @binding(0) var<uniform> u: NoiseU;

@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(p[i], 0.0, 1.0);
}
// The palette rail: ink → tone → cream, applied after the contrast gain.
fn present(v0: f32) -> vec4f {
    let v = clamp((clamp(v0, 0.0, 1.0) - 0.5) * u.gain + 0.5, 0.0, 1.0);
    let lo = mix(u.ink.rgb, u.tone.rgb, smoothstep(0.0, 0.62, v));
    let hi = mix(lo, u.cream.rgb, smoothstep(0.62, 1.0, v));
    return vec4f(hi, 1.0);
}
fn domain(fp: vec2f) -> vec2f {
    let pos = fp / u.pixelScale;
    return (pos - 0.5 * u.size) / max(min(u.size.x, u.size.y), 1.0) * 3.0 * u.scale;
}

@fragment fn fs_white(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_white(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_bayer(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_bayer(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_ign(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_ign(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_hash_cells(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_hash_cells(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_sparkle(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_sparkle(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_dust(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_dust(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_r2(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_r2(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_value(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_value(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_value_cubic(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_value_cubic(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_perlin(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_perlin(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_simplex(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_simplex(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_perlin3d(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_perlin3d(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_tiled(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_tiled(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_fbm(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_fbm(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_turbulence(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_turbulence(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_ridged(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_ridged(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_billow(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_billow(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_multifractal(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_multifractal(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_warp(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_warp(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_warp_self(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_warp_self(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_octave_rotate(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_octave_rotate(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_fbm_value(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_fbm_value(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_worley_f1(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_worley_f1(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_worley_f2(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_worley_f2(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_worley_edge(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_worley_edge(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_voronoi_id(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_voronoi_id(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_worley_manhattan(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_worley_manhattan(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_worley_chebyshev(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_worley_chebyshev(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_worley_smooth(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_worley_smooth(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_voronoise(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_voronoise(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_cracks(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_cracks(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_worley_fbm(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_worley_fbm(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_sine(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_sine(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_plaid(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_plaid(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_interference(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_interference(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_rings(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_rings(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_spiral(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_spiral(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_checker(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_checker(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_stripes_wave(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_stripes_wave(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_hex(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_hex(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_sum_sines(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_sum_sines(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_plasma(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_plasma(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_hatch(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_hatch(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_polar(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_polar(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_logpolar(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_logpolar(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_kaleido(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_kaleido(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_twist(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_twist(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_zoom_cascade(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_zoom_cascade(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_repeat(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_repeat(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_sinwarp(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_sinwarp(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_mirror(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_mirror(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_contour(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_contour(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_posterize(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_posterize(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_threshold(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_threshold(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_bands(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_bands(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_marble(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_marble(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_wood(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_wood(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_edges(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_edges(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_gamma(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_gamma(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_sdf_circles(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_sdf_circles(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_sdf_boxes(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_sdf_boxes(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_sdf_lines(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_sdf_lines(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_sdf_rings(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_sdf_rings(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_sdf_star(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_sdf_star(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_sdf_ngon(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_sdf_ngon(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_sdf_blob(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_sdf_blob(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_gyroid(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_gyroid(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_gabor_kernel(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_gabor_kernel(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_gabor_noise(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_gabor_noise(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_gabor_aniso(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_gabor_aniso(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_phasor(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_phasor(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_phasor_profile(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_phasor_profile(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_spot(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_spot(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_sparse_conv(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_sparse_conv(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_caustics(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_caustics(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_truchet(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_truchet(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_stars(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_stars(domain(fp.xy), u.time, u.k));
}

@fragment fn fs_flow_lines(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return present(n_flow_lines(domain(fp.xy), u.time, u.k));
}
