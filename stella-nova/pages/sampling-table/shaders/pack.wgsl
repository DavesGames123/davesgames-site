// ═══════════════════════════════════════════════════════════════════════════
//  SAMPLING TABLE  ·  one point pattern per cell. Every pattern is a pure
//  function sample_<name>(i, n, k) -> vec2f giving the i-th of n points in the
//  unit square (or a sentinel off-square for a rejected slot). The cell draws
//  the first n points, colored by index, and hovering breathes the count so
//  the order of a sequence is visible.
//
//  References: stratified / N-rooks / multi-jittered — Shirley 1991, Chiu,
//  Shirley & Wang 1994; correlated multi-jittered — Kensler 2013 (permute);
//  Poisson disc by grid dominance — after Bridson 2007 / Wei 2008;
//  Halton 1960; Hammersley 1960; Sobol 1967 (first two dimensions);
//  Cranley–Patterson rotation 1976; R2 — Roberts 2018; Vogel 1979 (sunflower);
//  Fibonacci and rank-1 lattices — Niederreiter 1992; Bayer 1973 (ordered
//  dither); concentric disc map — Shirley & Chiu 1997; Box–Muller 1958;
//  spherical Fibonacci — González 2010; PCG hash — Jarzynski & Olano 2020.
// ═══════════════════════════════════════════════════════════════════════════

struct SampU {
    size: vec2f, time: f32, pixelScale: f32,
    ink: vec4f, tone: vec4f, cream: vec4f,
    count: f32, radius: f32, pad0: f32, pad1: f32,
    k: vec4f,
}
@group(0) @binding(0) var<uniform> u: SampU;

const PI: f32 = 3.14159265358979;
const TAU: f32 = 6.28318530717959;
const PHI: f32 = 1.61803398874989;
const OFF: vec2f = vec2f(-10.0, -10.0);   // a rejected slot
const SEED: u32 = 7u;

@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(p[i], 0.0, 1.0);
}

// —— hashing and sequences ——————————————————————————————————————————————————
fn pcg(v: u32) -> u32 { let s = v * 747796405u + 2891336453u; let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
fn pcg2(p: vec2u) -> vec2u { var v = p * 1664525u + 1013904223u; v.x += v.y * 1664525u; v.y += v.x * 1664525u; v ^= v >> vec2u(16u); v.x += v.y * 1664525u; v.y += v.x * 1664525u; v ^= v >> vec2u(16u); return v; }
fn rnd(i: u32, s: u32) -> f32 { return f32(pcg(i * 3u + s * 977u)) / 4294967296.0; }
fn rnd2(i: u32, s: u32) -> vec2f { return vec2f(pcg2(vec2u(i, s))) / 4294967296.0; }
fn radinv2(i0: u32) -> f32 { return f32(reverseBits(i0)) * 2.3283064365386963e-10; }
fn radinv(i0: u32, base: u32) -> f32 { var i = i0; var f = 1.0; var r = 0.0; let inv = 1.0 / f32(base); loop { if (i == 0u) { break; } f *= inv; r += f * f32(i % base); i /= base; } return r; }
fn sobol2(i0: u32) -> f32 { var r = 0u; var v = 1u << 31u; var i = i0; loop { if (i == 0u) { break; } if ((i & 1u) != 0u) { r ^= v; } i >>= 1u; v ^= v >> 1u; } return f32(r) * 2.3283064365386963e-10; }
// Kensler's permute: a random permutation of 0..l-1 evaluated at i without building it
fn permute(i0: u32, l: u32, p: u32) -> u32 {
    var w = l - 1u; w |= w >> 1u; w |= w >> 2u; w |= w >> 4u; w |= w >> 8u; w |= w >> 16u;
    var i = i0;
    loop {
        i ^= p; i *= 0xe170893du; i ^= p >> 16u; i ^= (i & w) >> 4u; i ^= p >> 8u; i *= 0x0929eb3fu; i ^= p >> 23u; i ^= (i & w) >> 1u;
        i *= 1u | (p >> 27u); i *= 0x6935fa69u; i ^= (i & w) >> 11u; i *= 0x74dcb303u; i ^= (i & w) >> 2u; i *= 0x9e501cc3u; i ^= (i & w) >> 2u; i *= 0xc860a3dfu; i &= w; i ^= i >> 5u;
        if (i < l) { break; }
    }
    return (i + p) % l;
}
fn sq_side(n: u32) -> u32 { return max(u32(floor(sqrt(f32(n)))), 1u); }
fn bayer_inv(v: u32, kb: u32) -> vec2u {   // the cell whose Bayer rank is v, for a 2^kb square
    var x = 0u; var y = 0u;
    for (var b = 0u; b < kb; b++) { let xb = (v >> (2u * (kb - 1u - b))) & 1u; let s = (v >> (2u * (kb - 1u - b) + 1u)) & 1u; x |= xb << b; y |= (s ^ xb) << b; }
    return vec2u(x, y);
}

// ═══ RANDOM ══════════════════════════════════════════════════════════════════
fn sample_uniform(i: u32, n: u32, k: vec4f) -> vec2f { return rnd2(i, SEED); }
fn sample_stratified(i: u32, n: u32, k: vec4f) -> vec2f {
    let m = sq_side(n); if (i >= m * m) { return OFF; }
    let c = vec2f(f32(i % m), f32(i / m)); return (c + rnd2(i, SEED)) / f32(m);
}
fn sample_nrooks(i: u32, n: u32, k: vec4f) -> vec2f {
    let j = permute(i, n, SEED * 0x51633e2du); let r = rnd2(i, SEED);
    return vec2f((f32(i) + r.x) / f32(n), (f32(j) + r.y) / f32(n));
}
fn sample_multijitter(i: u32, n: u32, k: vec4f) -> vec2f {
    let m = sq_side(n); let nn = m * m; if (i >= nn) { return OFF; }
    let s = permute(i, nn, SEED * 0x51633e2du);
    let sx = permute(s % m, m, SEED * 0xa511e9b3u); let sy = permute(s / m, m, SEED * 0x63d83595u);
    let r = rnd2(s, SEED);
    return vec2f((f32(s % m) + (f32(sy) + r.x) / f32(m)) / f32(m), (f32(s / m) + (f32(sx) + r.y) / f32(m)) / f32(m));
}
fn sample_poisson_disc(i: u32, n: u32, k: vec4f) -> vec2f {
    // one jittered candidate per grid cell; a candidate loses to any neighbour candidate closer than r with a lower rank
    let m = sq_side(n); if (i >= m * m) { return OFF; }
    let c = vec2i(i32(i % m), i32(i / m)); let p = (vec2f(c) + rnd2(i, SEED)) / f32(m);
    let rank = rnd(i, SEED + 3u); let r = mix(0.6, 1.15, k.z) / f32(m);
    for (var dy = -1; dy <= 1; dy++) { for (var dx = -1; dx <= 1; dx++) {
        if (dx == 0 && dy == 0) { continue; }
        let q = c + vec2i(dx, dy); if (q.x < 0 || q.y < 0 || q.x >= i32(m) || q.y >= i32(m)) { continue; }
        let j = u32(q.y) * m + u32(q.x); let pq = (vec2f(q) + rnd2(j, SEED)) / f32(m);
        if (distance(p, pq) < r && rnd(j, SEED + 3u) < rank) { return OFF; }
    } }
    return p;
}
fn sample_jittered_hex(i: u32, n: u32, k: vec4f) -> vec2f {
    let m = sq_side(n); if (i >= m * m) { return OFF; }
    let row = i / m; let col = i % m; let x = (f32(col) + 0.5 + 0.5 * f32(row % 2u)) / f32(m); let y = (f32(row) + 0.5) / f32(m);
    return vec2f(x, y) + (rnd2(i, SEED) - 0.5) * k.z * 0.9 / f32(m);
}
fn sample_gaussian_cloud(i: u32, n: u32, k: vec4f) -> vec2f {
    let r = rnd2(i, SEED); let rad = sqrt(-2.0 * log(max(r.x, 1e-6))); let sg = mix(0.08, 0.25, k.z);
    return vec2f(0.5) + sg * rad * vec2f(cos(TAU * r.y), sin(TAU * r.y));
}

// ═══ QUASI-RANDOM ════════════════════════════════════════════════════════════
fn sample_halton(i: u32, n: u32, k: vec4f) -> vec2f { return vec2f(radinv2(i), radinv(i, 3u)); }
fn sample_cp_rotation(i: u32, n: u32, k: vec4f) -> vec2f { return fract(vec2f(radinv2(i), radinv(i, 3u)) + rnd2(SEED, 11u)); }
fn sample_hammersley(i: u32, n: u32, k: vec4f) -> vec2f { return vec2f((f32(i) + 0.5) / f32(n), radinv2(i)); }
fn sample_sobol(i: u32, n: u32, k: vec4f) -> vec2f { return vec2f(radinv2(i), sobol2(i)); }
fn sample_r2(i: u32, n: u32, k: vec4f) -> vec2f { return fract(vec2f(0.5) + f32(i) * vec2f(0.7548776662, 0.5698402910)); }
fn sample_golden_spiral(i: u32, n: u32, k: vec4f) -> vec2f {
    let r = 0.5 * sqrt((f32(i) + 0.5) / f32(n)); let a = f32(i) * TAU / (PHI * PHI);
    return vec2f(0.5) + r * vec2f(cos(a), sin(a));
}
fn sample_fibonacci_lattice(i: u32, n: u32, k: vec4f) -> vec2f { return vec2f((f32(i) + 0.5) / f32(n), fract(f32(i) / PHI)); }
fn sample_rank1_lattice(i: u32, n: u32, k: vec4f) -> vec2f {
    let a = 1.0 + floor(k.z * 40.0); return fract(f32(i) / f32(n) * vec2f(1.0, a));
}
fn sample_bayer(i: u32, n: u32, k: vec4f) -> vec2f {
    // points in the order an ordered-dither matrix would turn them on: each new point lands as far as possible from the last
    let kb = max(u32(ceil(log2(sqrt(f32(n))))), 1u); let m = 1u << kb; if (i >= m * m) { return OFF; }
    return (vec2f(bayer_inv(i, kb)) + 0.5) / f32(m);
}

// ═══ LATTICES ════════════════════════════════════════════════════════════════
fn sample_grid(i: u32, n: u32, k: vec4f) -> vec2f { let m = sq_side(n); if (i >= m * m) { return OFF; } return (vec2f(f32(i % m), f32(i / m)) + 0.5) / f32(m); }
fn sample_hex(i: u32, n: u32, k: vec4f) -> vec2f {
    let m = sq_side(n); if (i >= m * m) { return OFF; }
    let row = i / m; let col = i % m; let x = (f32(col) + 0.5 + 0.5 * f32(row % 2u)) / f32(m); let y = (f32(row) + 0.5) / f32(m) * 0.8660254 + 0.067;
    return vec2f(x, y);
}
fn sample_brick(i: u32, n: u32, k: vec4f) -> vec2f {
    let m = sq_side(n); if (i >= m * m) { return OFF; }
    let row = i / m; let col = i % m; let shift = mix(0.0, 0.5, k.z) * f32(row % 2u);
    return vec2f(fract((f32(col) + 0.5 + shift) / f32(m)), (f32(row) + 0.5) / f32(m));
}
fn sample_quincunx(i: u32, n: u32, k: vec4f) -> vec2f {
    let m = sq_side(n / 2u); let nn = m * m; if (i >= 2u * nn) { return OFF; }
    let j = i % nn; let c = vec2f(f32(j % m), f32(j / m)) + 0.5; let off = select(vec2f(0.0), vec2f(0.5), i >= nn) - vec2f(0.25);
    return (c + off) / f32(m);
}
fn sample_rotated_grid(i: u32, n: u32, k: vec4f) -> vec2f {
    let m = sq_side(n); if (i >= m * m) { return OFF; }
    let a = mix(0.0, PI * 0.5, k.z) * 0.59;   // default knob lands near atan(1/2), the classic RGSS angle
    let p = (vec2f(f32(i % m), f32(i / m)) + 0.5) / f32(m) - 0.5;
    let c = cos(a); let s = sin(a); return fract(vec2f(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5);
}
fn sample_spiral(i: u32, n: u32, k: vec4f) -> vec2f {
    let t = (f32(i) + 0.5) / f32(n); let turns = mix(3.0, 14.0, k.z); let a = t * TAU * turns;
    return vec2f(0.5) + 0.48 * t * vec2f(cos(a), sin(a));
}

// ═══ WARPS ═══ each takes a stratified point and maps it somewhere ═══════════
fn strat(i: u32, n: u32) -> vec2f { let m = sq_side(n); let j = i % (m * m); return (vec2f(f32(j % m), f32(j / m)) + rnd2(i, SEED)) / f32(m); }
fn sample_disc_polar(i: u32, n: u32, k: vec4f) -> vec2f {   // the naive map: r = u — points crowd the centre
    let s = strat(i, n); let a = TAU * s.y; return vec2f(0.5) + 0.5 * s.x * vec2f(cos(a), sin(a));
}
fn sample_disc_sqrt(i: u32, n: u32, k: vec4f) -> vec2f {    // r = √u — uniform by area
    let s = strat(i, n); let a = TAU * s.y; return vec2f(0.5) + 0.5 * sqrt(s.x) * vec2f(cos(a), sin(a));
}
fn sample_disc_concentric(i: u32, n: u32, k: vec4f) -> vec2f {   // Shirley–Chiu: the square's strata stay strata on the disc
    let s = strat(i, n) * 2.0 - 1.0;
    if (s.x == 0.0 && s.y == 0.0) { return vec2f(0.5); }
    var r: f32; var a: f32;
    if (abs(s.x) > abs(s.y)) { r = s.x; a = (PI / 4.0) * (s.y / s.x); } else { r = s.y; a = (PI / 2.0) - (PI / 4.0) * (s.x / s.y); }
    return vec2f(0.5) + 0.5 * r * vec2f(cos(a), sin(a));
}
fn sample_annulus(i: u32, n: u32, k: vec4f) -> vec2f {
    let s = strat(i, n); let r0 = mix(0.1, 0.45, k.z); let r = sqrt(mix(r0 * r0, 0.25, s.x)); let a = TAU * s.y;
    return vec2f(0.5) + r * vec2f(cos(a), sin(a));
}
fn sample_gaussian_bm(i: u32, n: u32, k: vec4f) -> vec2f {   // Box–Muller on stratified input: the strata survive as rings
    let s = strat(i, n); let rad = sqrt(-2.0 * log(max(1.0 - s.x, 1e-6))); let sg = mix(0.08, 0.25, k.z);
    return vec2f(0.5) + sg * rad * vec2f(cos(TAU * s.y), sin(TAU * s.y));
}
fn sample_tent(i: u32, n: u32, k: vec4f) -> vec2f {   // jitter drawn from a tent filter: importance-sampled reconstruction
    let m = sq_side(n); if (i >= m * m) { return OFF; }
    let r = rnd2(i, SEED) * 2.0; let t = select(1.0 - sqrt(2.0 - r), sqrt(r) - 1.0, r < vec2f(1.0));
    return (vec2f(f32(i % m), f32(i / m)) + 0.5 + t * mix(0.3, 1.2, k.z)) / f32(m);
}
fn sample_sphere_fib(i: u32, n: u32, k: vec4f) -> vec2f {   // spherical Fibonacci points seen from above: density piles up at the limb
    let z = 1.0 - 2.0 * (f32(i) + 0.5) / f32(n); let r = sqrt(max(1.0 - z * z, 0.0)); let a = f32(i) * TAU / PHI;
    return vec2f(0.5) + 0.49 * r * vec2f(cos(a), sin(a));
}
fn sample_triangle(i: u32, n: u32, k: vec4f) -> vec2f {   // uniform in a triangle via the √ warp of barycentrics
    let s = strat(i, n); let su = sqrt(s.x); let b0 = 1.0 - su; let b1 = s.y * su;
    let A = vec2f(0.08, 0.1); let B = vec2f(0.92, 0.1); let C = vec2f(0.5, 0.9);
    return A * b0 + B * b1 + C * (1.0 - b0 - b1);
}

// ═══ drawing ═════════════════════════════════════════════════════════════════
fn cell_uv(fp: vec2f) -> vec2f { let pos = fp / u.pixelScale; return (pos - 0.5 * u.size) / max(min(u.size.x, u.size.y), 1.0) * 1.12 + 0.5; }
fn shown() -> u32 { return u32(round(u.count * (0.7 + 0.3 * cos(u.time * 0.45)))); }
fn draw(fp: vec2f, d0: f32, idx: u32, ncount: u32) -> vec4f {
    let px = 1.12 / max(min(u.size.x, u.size.y), 1.0) / u.pixelScale;   // one device pixel in uv units
    let r = u.radius * px; let e = 1.0 * px;
    let uv = cell_uv(fp);
    let inside = step(0.0, uv.x) * step(0.0, uv.y) * step(uv.x, 1.0) * step(uv.y, 1.0);
    let bg = mix(u.ink.rgb, mix(u.ink.rgb, u.tone.rgb, 0.08), inside);
    let cov = 1.0 - smoothstep(r - e, r + e, d0);
    let t = f32(idx) / max(f32(ncount), 1.0);
    let col = mix(u.tone.rgb, u.cream.rgb, t * t);
    return vec4f(mix(bg, col, cov), 1.0);
}

// ═══ entry points ═══ one per cell, the same loop over sample_<name> ═══════

@fragment fn fs_uniform(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let n = u32(u.count); let m = shown();
    var d0 = 1e9; var idx = 0u;
    for (var i = 0u; i < m; i++) { let p = sample_uniform(i, n, u.k); let d = distance(uv, p); if (d < d0) { d0 = d; idx = i; } }
    return draw(fp.xy, d0, idx, n);
}
@fragment fn fs_stratified(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let n = u32(u.count); let m = shown();
    var d0 = 1e9; var idx = 0u;
    for (var i = 0u; i < m; i++) { let p = sample_stratified(i, n, u.k); let d = distance(uv, p); if (d < d0) { d0 = d; idx = i; } }
    return draw(fp.xy, d0, idx, n);
}
@fragment fn fs_nrooks(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let n = u32(u.count); let m = shown();
    var d0 = 1e9; var idx = 0u;
    for (var i = 0u; i < m; i++) { let p = sample_nrooks(i, n, u.k); let d = distance(uv, p); if (d < d0) { d0 = d; idx = i; } }
    return draw(fp.xy, d0, idx, n);
}
@fragment fn fs_multijitter(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let n = u32(u.count); let m = shown();
    var d0 = 1e9; var idx = 0u;
    for (var i = 0u; i < m; i++) { let p = sample_multijitter(i, n, u.k); let d = distance(uv, p); if (d < d0) { d0 = d; idx = i; } }
    return draw(fp.xy, d0, idx, n);
}
@fragment fn fs_poisson_disc(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let n = u32(u.count); let m = shown();
    var d0 = 1e9; var idx = 0u;
    for (var i = 0u; i < m; i++) { let p = sample_poisson_disc(i, n, u.k); let d = distance(uv, p); if (d < d0) { d0 = d; idx = i; } }
    return draw(fp.xy, d0, idx, n);
}
@fragment fn fs_jittered_hex(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let n = u32(u.count); let m = shown();
    var d0 = 1e9; var idx = 0u;
    for (var i = 0u; i < m; i++) { let p = sample_jittered_hex(i, n, u.k); let d = distance(uv, p); if (d < d0) { d0 = d; idx = i; } }
    return draw(fp.xy, d0, idx, n);
}
@fragment fn fs_gaussian_cloud(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let n = u32(u.count); let m = shown();
    var d0 = 1e9; var idx = 0u;
    for (var i = 0u; i < m; i++) { let p = sample_gaussian_cloud(i, n, u.k); let d = distance(uv, p); if (d < d0) { d0 = d; idx = i; } }
    return draw(fp.xy, d0, idx, n);
}
@fragment fn fs_halton(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let n = u32(u.count); let m = shown();
    var d0 = 1e9; var idx = 0u;
    for (var i = 0u; i < m; i++) { let p = sample_halton(i, n, u.k); let d = distance(uv, p); if (d < d0) { d0 = d; idx = i; } }
    return draw(fp.xy, d0, idx, n);
}
@fragment fn fs_cp_rotation(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let n = u32(u.count); let m = shown();
    var d0 = 1e9; var idx = 0u;
    for (var i = 0u; i < m; i++) { let p = sample_cp_rotation(i, n, u.k); let d = distance(uv, p); if (d < d0) { d0 = d; idx = i; } }
    return draw(fp.xy, d0, idx, n);
}
@fragment fn fs_hammersley(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let n = u32(u.count); let m = shown();
    var d0 = 1e9; var idx = 0u;
    for (var i = 0u; i < m; i++) { let p = sample_hammersley(i, n, u.k); let d = distance(uv, p); if (d < d0) { d0 = d; idx = i; } }
    return draw(fp.xy, d0, idx, n);
}
@fragment fn fs_sobol(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let n = u32(u.count); let m = shown();
    var d0 = 1e9; var idx = 0u;
    for (var i = 0u; i < m; i++) { let p = sample_sobol(i, n, u.k); let d = distance(uv, p); if (d < d0) { d0 = d; idx = i; } }
    return draw(fp.xy, d0, idx, n);
}
@fragment fn fs_r2(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let n = u32(u.count); let m = shown();
    var d0 = 1e9; var idx = 0u;
    for (var i = 0u; i < m; i++) { let p = sample_r2(i, n, u.k); let d = distance(uv, p); if (d < d0) { d0 = d; idx = i; } }
    return draw(fp.xy, d0, idx, n);
}
@fragment fn fs_golden_spiral(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let n = u32(u.count); let m = shown();
    var d0 = 1e9; var idx = 0u;
    for (var i = 0u; i < m; i++) { let p = sample_golden_spiral(i, n, u.k); let d = distance(uv, p); if (d < d0) { d0 = d; idx = i; } }
    return draw(fp.xy, d0, idx, n);
}
@fragment fn fs_fibonacci_lattice(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let n = u32(u.count); let m = shown();
    var d0 = 1e9; var idx = 0u;
    for (var i = 0u; i < m; i++) { let p = sample_fibonacci_lattice(i, n, u.k); let d = distance(uv, p); if (d < d0) { d0 = d; idx = i; } }
    return draw(fp.xy, d0, idx, n);
}
@fragment fn fs_rank1_lattice(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let n = u32(u.count); let m = shown();
    var d0 = 1e9; var idx = 0u;
    for (var i = 0u; i < m; i++) { let p = sample_rank1_lattice(i, n, u.k); let d = distance(uv, p); if (d < d0) { d0 = d; idx = i; } }
    return draw(fp.xy, d0, idx, n);
}
@fragment fn fs_bayer(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let n = u32(u.count); let m = shown();
    var d0 = 1e9; var idx = 0u;
    for (var i = 0u; i < m; i++) { let p = sample_bayer(i, n, u.k); let d = distance(uv, p); if (d < d0) { d0 = d; idx = i; } }
    return draw(fp.xy, d0, idx, n);
}
@fragment fn fs_grid(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let n = u32(u.count); let m = shown();
    var d0 = 1e9; var idx = 0u;
    for (var i = 0u; i < m; i++) { let p = sample_grid(i, n, u.k); let d = distance(uv, p); if (d < d0) { d0 = d; idx = i; } }
    return draw(fp.xy, d0, idx, n);
}
@fragment fn fs_hex(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let n = u32(u.count); let m = shown();
    var d0 = 1e9; var idx = 0u;
    for (var i = 0u; i < m; i++) { let p = sample_hex(i, n, u.k); let d = distance(uv, p); if (d < d0) { d0 = d; idx = i; } }
    return draw(fp.xy, d0, idx, n);
}
@fragment fn fs_brick(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let n = u32(u.count); let m = shown();
    var d0 = 1e9; var idx = 0u;
    for (var i = 0u; i < m; i++) { let p = sample_brick(i, n, u.k); let d = distance(uv, p); if (d < d0) { d0 = d; idx = i; } }
    return draw(fp.xy, d0, idx, n);
}
@fragment fn fs_quincunx(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let n = u32(u.count); let m = shown();
    var d0 = 1e9; var idx = 0u;
    for (var i = 0u; i < m; i++) { let p = sample_quincunx(i, n, u.k); let d = distance(uv, p); if (d < d0) { d0 = d; idx = i; } }
    return draw(fp.xy, d0, idx, n);
}
@fragment fn fs_rotated_grid(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let n = u32(u.count); let m = shown();
    var d0 = 1e9; var idx = 0u;
    for (var i = 0u; i < m; i++) { let p = sample_rotated_grid(i, n, u.k); let d = distance(uv, p); if (d < d0) { d0 = d; idx = i; } }
    return draw(fp.xy, d0, idx, n);
}
@fragment fn fs_spiral(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let n = u32(u.count); let m = shown();
    var d0 = 1e9; var idx = 0u;
    for (var i = 0u; i < m; i++) { let p = sample_spiral(i, n, u.k); let d = distance(uv, p); if (d < d0) { d0 = d; idx = i; } }
    return draw(fp.xy, d0, idx, n);
}
@fragment fn fs_disc_polar(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let n = u32(u.count); let m = shown();
    var d0 = 1e9; var idx = 0u;
    for (var i = 0u; i < m; i++) { let p = sample_disc_polar(i, n, u.k); let d = distance(uv, p); if (d < d0) { d0 = d; idx = i; } }
    return draw(fp.xy, d0, idx, n);
}
@fragment fn fs_disc_sqrt(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let n = u32(u.count); let m = shown();
    var d0 = 1e9; var idx = 0u;
    for (var i = 0u; i < m; i++) { let p = sample_disc_sqrt(i, n, u.k); let d = distance(uv, p); if (d < d0) { d0 = d; idx = i; } }
    return draw(fp.xy, d0, idx, n);
}
@fragment fn fs_disc_concentric(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let n = u32(u.count); let m = shown();
    var d0 = 1e9; var idx = 0u;
    for (var i = 0u; i < m; i++) { let p = sample_disc_concentric(i, n, u.k); let d = distance(uv, p); if (d < d0) { d0 = d; idx = i; } }
    return draw(fp.xy, d0, idx, n);
}
@fragment fn fs_annulus(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let n = u32(u.count); let m = shown();
    var d0 = 1e9; var idx = 0u;
    for (var i = 0u; i < m; i++) { let p = sample_annulus(i, n, u.k); let d = distance(uv, p); if (d < d0) { d0 = d; idx = i; } }
    return draw(fp.xy, d0, idx, n);
}
@fragment fn fs_gaussian_bm(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let n = u32(u.count); let m = shown();
    var d0 = 1e9; var idx = 0u;
    for (var i = 0u; i < m; i++) { let p = sample_gaussian_bm(i, n, u.k); let d = distance(uv, p); if (d < d0) { d0 = d; idx = i; } }
    return draw(fp.xy, d0, idx, n);
}
@fragment fn fs_tent(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let n = u32(u.count); let m = shown();
    var d0 = 1e9; var idx = 0u;
    for (var i = 0u; i < m; i++) { let p = sample_tent(i, n, u.k); let d = distance(uv, p); if (d < d0) { d0 = d; idx = i; } }
    return draw(fp.xy, d0, idx, n);
}
@fragment fn fs_sphere_fib(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let n = u32(u.count); let m = shown();
    var d0 = 1e9; var idx = 0u;
    for (var i = 0u; i < m; i++) { let p = sample_sphere_fib(i, n, u.k); let d = distance(uv, p); if (d < d0) { d0 = d; idx = i; } }
    return draw(fp.xy, d0, idx, n);
}
@fragment fn fs_triangle(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let n = u32(u.count); let m = shown();
    var d0 = 1e9; var idx = 0u;
    for (var i = 0u; i < m; i++) { let p = sample_triangle(i, n, u.k); let d = distance(uv, p); if (d < d0) { d0 = d; idx = i; } }
    return draw(fp.xy, d0, idx, n);
}