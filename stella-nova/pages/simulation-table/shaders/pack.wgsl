// ═══════════════════════════════════════════════════════════════════════════
//  SIMULATION TABLE  ·  cellular automata and PDEs, one compute kernel per cell.
//
//  Each cell owns two rgba32float state textures (ping-pong). Every step the
//  kernel reads `src`, writes `dst`; the present pass colors `dst`. State is
//  four floats per texel whose meaning is per-simulation (noted on each).
//  Hover runs the simulation; the inspector's knobs are the kernel parameters.
//
//  References: Conway 1970 (Life); Brian's Brain, Wireworld (Silverman);
//  Greenberg–Hastings 1978; cyclic CA (Griffeath); Gray–Scott (Pearson 1993);
//  FitzHugh–Nagumo; Turing/Schnakenberg; heat and wave equations (explicit
//  FTCS / leapfrog); Reiter 2005 snowflake; Bak–Tang–Wiesenfeld sandpile;
//  forest fire (Drossel–Schwabl); Ising (checkerboard Metropolis); Lenia
//  (Chan 2019); SmoothLife (Rafler 2011); rock–paper–scissors (Reichenbach
//  2007); LBM D2Q9 (Chen & Doolen 1998); Schelling 1971 (density version);
//  DLA (Witten–Sander, walker field version); reaction wave (Belousov CA,
//  Hodgepodge, Gerhardt–Schuster–Tyson 1990); Langton loops omitted.
// ═══════════════════════════════════════════════════════════════════════════

struct SimU {
    size: vec2f, time: f32, pixelScale: f32,
    ink: vec4f, tone: vec4f, cream: vec4f,
    k: vec4f,
    frame: f32, seed: f32, dt: f32, reset: f32,
}
@group(0) @binding(0) var<uniform> u: SimU;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba32float, write>;

const N: i32 = 128;               // simulation grid, square
const PI: f32 = 3.14159265358979;

fn pcg(vin: vec3u) -> vec3u { var v = vin * 1664525u + 1013904223u; v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y; v ^= v >> vec3u(16u); v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y; return v; }
fn rnd(p: vec2i, s: f32) -> f32 { return f32(pcg(vec3u(u32(p.x + 65536), u32(p.y + 65536), u32(s * 1000.0) + 7u)).x) / 4294967295.0; }
fn rnd3(p: vec2i, s: f32) -> vec3f { return vec3f(pcg(vec3u(u32(p.x + 65536), u32(p.y + 65536), u32(s * 1000.0) + 7u))) / 4294967295.0; }
fn wrap(p: vec2i) -> vec2i { return ((p % N) + N) % N; }
fn ld(p: vec2i) -> vec4f { return textureLoad(src, wrap(p), 0); }
fn lap(p: vec2i) -> vec4f { return ld(p + vec2i(1, 0)) + ld(p - vec2i(1, 0)) + ld(p + vec2i(0, 1)) + ld(p - vec2i(0, 1)) - 4.0 * ld(p); }
fn lap8(p: vec2i) -> vec4f {
    return 0.2 * (ld(p + vec2i(1, 0)) + ld(p - vec2i(1, 0)) + ld(p + vec2i(0, 1)) + ld(p - vec2i(0, 1)))
         + 0.05 * (ld(p + vec2i(1, 1)) + ld(p - vec2i(1, 1)) + ld(p + vec2i(1, -1)) + ld(p - vec2i(1, -1))) - ld(p);
}
fn moore(p: vec2i, ch: i32) -> f32 {  // sum of channel over the 8 neighbours
    var s = 0.0;
    for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) { if (x == 0 && y == 0) { continue; } s += ld(p + vec2i(x, y))[ch]; } }
    return s;
}
fn cen(p: vec2i) -> vec2f { return (vec2f(p) + 0.5) / f32(N) - 0.5; }

// ─────────────────────────────────────────────── cellular automata (state.x = cell)
@compute @workgroup_size(8, 8) fn cs_life(@builtin(global_invocation_id) id: vec3u) {
    let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
    if (u.reset > 0.5) { textureStore(dst, p, vec4f(select(0.0, 1.0, rnd(p, u.seed) < mix(0.1, 0.6, u.k.x)), 0.0, 0.0, 1.0)); return; }
    let a = ld(p).x; let n = moore(p, 0);
    let born = select(0.0, 1.0, n == 3.0); let live = select(0.0, 1.0, n == 2.0 || n == 3.0);
    let v = select(born, live, a > 0.5);
    let age = select(0.0, ld(p).y + 1.0, v > 0.5);
    textureStore(dst, p, vec4f(v, age, 0.0, 1.0));
}
// Brian's Brain: firing → refractory → off
@compute @workgroup_size(8, 8) fn cs_brain(@builtin(global_invocation_id) id: vec3u) {
    let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
    if (u.reset > 0.5) { let r = rnd(p, u.seed); textureStore(dst, p, vec4f(select(0.0, 1.0, r < mix(0.05, 0.4, u.k.x)), 0.0, 0.0, 1.0)); return; }
    let s = ld(p); var firing = 0.0; var refr = 0.0;
    if (s.x > 0.5) { refr = 1.0; }
    else if (s.y > 0.5) { }
    else { var n = 0.0; for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) { if (x == 0 && y == 0) { continue; } n += ld(p + vec2i(x, y)).x; } } firing = select(0.0, 1.0, n == 2.0); }
    textureStore(dst, p, vec4f(firing, refr, 0.0, 1.0));
}
// Greenberg–Hastings excitable medium: rest → excited → refractory (n states), spirals
@compute @workgroup_size(8, 8) fn cs_excitable(@builtin(global_invocation_id) id: vec3u) {
    let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
    let states = floor(mix(4.0, 12.0, u.k.y));
    if (u.reset > 0.5) { let r = rnd(p, u.seed); textureStore(dst, p, vec4f(select(0.0, floor(r * states), r < mix(0.05, 0.5, u.k.x)), 0.0, 0.0, 1.0)); return; }
    let s = ld(p).x; var v = s;
    if (s == 0.0) { var ex = 0.0; for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) { if (ld(p + vec2i(x, y)).x == 1.0) { ex += 1.0; } } } v = select(0.0, 1.0, ex >= mix(1.0, 3.0, u.k.z)); }
    else { v = select(s + 1.0, 0.0, s + 1.0 >= states); }
    textureStore(dst, p, vec4f(v, states, 0.0, 1.0));
}
// cyclic CA: k colours, a cell is eaten by the next colour
@compute @workgroup_size(8, 8) fn cs_cyclic(@builtin(global_invocation_id) id: vec3u) {
    let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
    let kk = floor(mix(3.0, 16.0, u.k.x));
    if (u.reset > 0.5) { textureStore(dst, p, vec4f(floor(rnd(p, u.seed) * kk), kk, 0.0, 1.0)); return; }
    let s = ld(p).x; let nx = select(s + 1.0, 0.0, s + 1.0 >= kk); var eaten = 0.0;
    for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) { if (abs(x) + abs(y) != 1) { continue; } if (ld(p + vec2i(x, y)).x == nx) { eaten = 1.0; } } }
    textureStore(dst, p, vec4f(select(s, nx, eaten > 0.5), kk, 0.0, 1.0));
}
// forest fire (Drossel–Schwabl): empty → tree with p, tree → fire if a neighbour burns or with f
@compute @workgroup_size(8, 8) fn cs_forest(@builtin(global_invocation_id) id: vec3u) {
    let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
    if (u.reset > 0.5) { textureStore(dst, p, vec4f(select(0.0, 1.0, rnd(p, u.seed) < 0.5), 0.0, 0.0, 1.0)); return; }
    let s = ld(p).x; let r = rnd(p, u.seed + u.frame * 0.001); var v = s;
    if (s == 0.0) { v = select(0.0, 1.0, r < mix(0.002, 0.05, u.k.x)); }
    else if (s == 1.0) { var burn = 0.0; for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) { if (abs(x) + abs(y) != 1) { continue; } if (ld(p + vec2i(x, y)).x == 2.0) { burn = 1.0; } } } v = select(select(1.0, 2.0, r < mix(0.00005, 0.002, u.k.y)), 2.0, burn > 0.5); }
    else { v = 0.0; }
    textureStore(dst, p, vec4f(v, 0.0, 0.0, 1.0));
}
// Ising model, checkerboard Metropolis so neighbours never update together
@compute @workgroup_size(8, 8) fn cs_ising(@builtin(global_invocation_id) id: vec3u) {
    let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
    if (u.reset > 0.5) { textureStore(dst, p, vec4f(select(-1.0, 1.0, rnd(p, u.seed) < 0.5), 0.0, 0.0, 1.0)); return; }
    let s = ld(p).x; let parity = (p.x + p.y + i32(u.frame)) & 1;
    if (parity == 1) { textureStore(dst, p, vec4f(s, 0.0, 0.0, 1.0)); return; }
    let nb = ld(p + vec2i(1, 0)).x + ld(p - vec2i(1, 0)).x + ld(p + vec2i(0, 1)).x + ld(p - vec2i(0, 1)).x;
    let dE = 2.0 * s * (nb + mix(-1.0, 1.0, u.k.y) * 0.5); let T = mix(1.0, 4.0, u.k.x);
    let r = rnd(p, u.seed + u.frame * 0.001);
    let flip = dE <= 0.0 || r < exp(-dE / T);
    textureStore(dst, p, vec4f(select(s, -s, flip), 0.0, 0.0, 1.0));
}
// rock–paper–scissors: three species, each beaten by the next, on a random neighbour
@compute @workgroup_size(8, 8) fn cs_rps(@builtin(global_invocation_id) id: vec3u) {
    let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
    if (u.reset > 0.5) { textureStore(dst, p, vec4f(floor(rnd(p, u.seed) * 3.0), 0.0, 0.0, 1.0)); return; }
    let s = ld(p); let r = rnd3(p, u.seed + u.frame * 0.001);
    let o = vec2i(i32(floor(r.x * 3.0)) - 1, i32(floor(r.y * 3.0)) - 1); let nb = ld(p + o).x;
    let beaten = nb == select(s.x + 1.0, 0.0, s.x >= 2.0);
    let v = select(s.x, nb, beaten && r.z < mix(0.3, 1.0, u.k.x));
    let h = select(0.0, s.y + 1.0, v == s.x);
    textureStore(dst, p, vec4f(v, min(h, 60.0), 0.0, 1.0));
}
// Schelling segregation, density version: two groups, a cell flips to its majority neighbour when unhappy
@compute @workgroup_size(8, 8) fn cs_schelling(@builtin(global_invocation_id) id: vec3u) {
    let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
    if (u.reset > 0.5) { textureStore(dst, p, vec4f(select(-1.0, 1.0, rnd(p, u.seed) < 0.5), 0.0, 0.0, 1.0)); return; }
    let s = ld(p).x; let same = (moore(p, 0) * s + 8.0) / 16.0;      // fraction of neighbours like me
    let tol = mix(0.2, 0.6, u.k.x); let r = rnd(p, u.seed + u.frame * 0.001);
    let v = select(s, -s, same < tol && r < mix(0.05, 0.5, u.k.y));
    textureStore(dst, p, vec4f(v, 0.0, 0.0, 1.0));
}
// sandpile (Bak–Tang–Wiesenfeld): topple at 4, grains dropped at the center
@compute @workgroup_size(8, 8) fn cs_sandpile(@builtin(global_invocation_id) id: vec3u) {
    let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
    if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
    var h = ld(p).x; if (h >= 4.0) { h -= 4.0; }
    for (var i: i32 = 0; i < 4; i++) { let o = vec2i(select(select(1, -1, i == 1), 0, i >= 2), select(select(1, -1, i == 3), 0, i < 2)); let q = p + o; if (q.x < 0 || q.y < 0 || q.x >= N || q.y >= N) { continue; } if (ld(q).x >= 4.0) { h += 1.0; } }
    let c = vec2i(N / 2); if (p.x == c.x && p.y == c.y) { h += floor(mix(1.0, 8.0, u.k.x)); }
    textureStore(dst, p, vec4f(h, 0.0, 0.0, 1.0));
}
// DLA with a walker field: y = walker density, x = aggregate; walkers diffuse and stick
@compute @workgroup_size(8, 8) fn cs_dla(@builtin(global_invocation_id) id: vec3u) {
    let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
    if (u.reset > 0.5) { let c = length(cen(p)); textureStore(dst, p, vec4f(select(0.0, 1.0, c < 0.015), select(0.0, 1.0, rnd(p, u.seed) < mix(0.05, 0.3, u.k.x)), 0.0, 1.0)); return; }
    let s = ld(p); let r = rnd3(p, u.seed + u.frame * 0.001);
    if (s.x > 0.5) { textureStore(dst, p, vec4f(1.0, 0.0, s.z, 1.0)); return; }
    // a walker moves to a random neighbour: this cell gets whichever neighbour walks here
    let o = vec2i(i32(floor(r.x * 3.0)) - 1, i32(floor(r.y * 3.0)) - 1);
    var w = ld(p + o).y;
    let touching = moore(p, 0) > 0.0;
    if (w > 0.5 && touching && r.z < mix(0.2, 1.0, u.k.y)) { textureStore(dst, p, vec4f(1.0, 0.0, u.frame, 1.0)); return; }
    // replenish walkers at the rim so the cluster keeps growing
    if (w < 0.5 && length(cen(p)) > 0.46 && r.z < 0.05) { w = 1.0; }
    textureStore(dst, p, vec4f(0.0, w, 0.0, 1.0));
}

// Vichniac twisted majority: a cell joins the majority of its 3x3 block, with the 4/5 case swapped — the "voting" CA
@compute @workgroup_size(8, 8) fn cs_majority(@builtin(global_invocation_id) id: vec3u) {
    let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
    if (u.reset > 0.5) { textureStore(dst, p, vec4f(select(-1.0, 1.0, rnd(p, u.seed) < mix(0.35, 0.65, u.k.x)), 0.0, 0.0, 1.0)); return; }
    let s = ld(p).x; let n = moore(p, 0) + s;   // -9..9
    var v = select(-1.0, 1.0, n > 0.0);
    if (u.k.y > 0.5 && (n == 1.0 || n == -1.0)) { v = -v; }   // the twist: 4-5 votes flip, which keeps the boundaries moving
    let r = rnd(p, u.seed + u.frame * 0.001); v = select(v, s, r > mix(0.3, 1.0, u.k.z));
    textureStore(dst, p, vec4f(v, 0.0, 0.0, 1.0));
}

// ─────────────────────────────────────────────── reaction–diffusion (state.xy = u, v)
@compute @workgroup_size(8, 8) fn cs_gray_scott(@builtin(global_invocation_id) id: vec3u) {
    let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
    if (u.reset > 0.5) { let c = cen(p); let seed = select(0.0, 1.0, (abs(c.x) < 0.05 && abs(c.y) < 0.05) || rnd(p, u.seed) > 0.995); textureStore(dst, p, vec4f(1.0 - 0.5 * seed, 0.25 * seed, 0.0, 1.0)); return; }
    let s = ld(p); let L = lap8(p);
    let f = mix(0.010, 0.070, u.k.x); let kk = mix(0.045, 0.070, u.k.y); let Du = 0.2097; let Dv = 0.105;
    let uvv = s.x * s.y * s.y;
    let un = s.x + (Du * L.x - uvv + f * (1.0 - s.x)) * 1.0;
    let vn = s.y + (Dv * L.y + uvv - (f + kk) * s.y) * 1.0;
    textureStore(dst, p, vec4f(clamp(un, 0.0, 1.0), clamp(vn, 0.0, 1.0), 0.0, 1.0));
}
@compute @workgroup_size(8, 8) fn cs_fitzhugh(@builtin(global_invocation_id) id: vec3u) {
    let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
    if (u.reset > 0.5) { let r = rnd(p, u.seed); textureStore(dst, p, vec4f(r * 2.0 - 1.0, 0.0, 0.0, 1.0)); return; }
    let s = ld(p); let L = lap8(p);
    let a = mix(-0.1, 0.2, u.k.x); let eps = mix(0.01, 0.1, u.k.y); let Du = 1.0; let Dv = mix(5.0, 60.0, u.k.z);
    let un = s.x + (Du * L.x + s.x - s.x * s.x * s.x - s.y) * 0.1;
    let vn = s.y + (Dv * 0.02 * L.y + eps * (s.x - a - 0.5 * s.y)) * 0.1;
    textureStore(dst, p, vec4f(clamp(un, -2.0, 2.0), clamp(vn, -2.0, 2.0), 0.0, 1.0));
}
// Gray–Scott in the "mitosis" regime (f≈0.0367, k≈0.0649): spots that split like cells
@compute @workgroup_size(8, 8) fn cs_mitosis(@builtin(global_invocation_id) id: vec3u) {
    let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
    if (u.reset > 0.5) { let r = rnd(p, u.seed); let c = cen(p); let seed = select(0.0, 1.0, length(c) < 0.03 || r > 0.995); textureStore(dst, p, vec4f(1.0 - 0.5 * seed, 0.25 * seed, 0.0, 1.0)); return; }
    let s = ld(p); let L = lap8(p);
    let f = mix(0.030, 0.045, u.k.x); let kk = mix(0.060, 0.068, u.k.y); let Du = 0.2097; let Dv = 0.105;
    let uvv = s.x * s.y * s.y;
    let un = s.x + (Du * L.x - uvv + f * (1.0 - s.x));
    let vn = s.y + (Dv * L.y + uvv - (f + kk) * s.y);
    textureStore(dst, p, vec4f(clamp(un, 0.0, 1.0), clamp(vn, 0.0, 1.0), 0.0, 1.0));
}
// Belousov-style "hodgepodge" reaction wave (Gerhardt–Schuster–Tyson CA)
@compute @workgroup_size(8, 8) fn cs_hodgepodge(@builtin(global_invocation_id) id: vec3u) {
    let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
    let nmax = 100.0;
    if (u.reset > 0.5) { textureStore(dst, p, vec4f(floor(rnd(p, u.seed) * nmax), 0.0, 0.0, 1.0)); return; }
    let s = ld(p).x; var v = 0.0;
    if (s == 0.0) { var a = 0.0; var b = 0.0; for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) { if (x == 0 && y == 0) { continue; } let q = ld(p + vec2i(x, y)).x; if (q > 0.0 && q < nmax) { a += 1.0; } if (q >= nmax) { b += 1.0; } } }
        v = floor(a / mix(1.0, 4.0, u.k.x)) + floor(b / mix(1.0, 4.0, u.k.y)); }
    else if (s < nmax) { var sum = s; var cnt = 1.0; for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) { if (x == 0 && y == 0) { continue; } let q = ld(p + vec2i(x, y)).x; if (q > 0.0) { sum += q; cnt += 1.0; } } }
        v = floor(sum / cnt) + mix(5.0, 40.0, u.k.z); }
    else { v = 0.0; }
    textureStore(dst, p, vec4f(min(v, nmax), nmax, 0.0, 1.0));
}
// Lenia (Chan 2019): a continuous Life with a ring kernel and a bell growth function
@compute @workgroup_size(8, 8) fn cs_lenia(@builtin(global_invocation_id) id: vec3u) {
    let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
    if (u.reset > 0.5) { let c = cen(p) * 6.0; let r = rnd(p, u.seed); textureStore(dst, p, vec4f(select(0.0, r, length(c) < 1.2), 0.0, 0.0, 1.0)); return; }
    let R = 6; var acc = 0.0; var nrm = 0.0;
    for (var y: i32 = -6; y <= 6; y++) { for (var x: i32 = -6; x <= 6; x++) {
        let d = length(vec2f(f32(x), f32(y))) / f32(R); if (d > 1.0) { continue; }
        let w = exp(-((d - 0.5) * (d - 0.5)) / (2.0 * 0.15 * 0.15)); acc += w * ld(p + vec2i(x, y)).x; nrm += w; } }
    let m = mix(0.10, 0.20, u.k.x); let sg = mix(0.010, 0.030, u.k.y);
    let g = 2.0 * exp(-((acc / nrm - m) * (acc / nrm - m)) / (2.0 * sg * sg)) - 1.0;
    let v = clamp(ld(p).x + g * 0.1, 0.0, 1.0);
    textureStore(dst, p, vec4f(v, 0.0, 0.0, 1.0));
}
// SmoothLife (Rafler): inner disc / outer ring sums with sigmoid birth and death
@compute @workgroup_size(8, 8) fn cs_smoothlife(@builtin(global_invocation_id) id: vec3u) {
    let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
    if (u.reset > 0.5) { let r = rnd(p, u.seed); let c = cen(p) * 4.0; textureStore(dst, p, vec4f(select(0.0, step(0.5, r), fract(c.x * 2.0) < 0.7 && fract(c.y * 2.0) < 0.7), 0.0, 0.0, 1.0)); return; }
    var inner = 0.0; var innerN = 0.0; var outer = 0.0; var outerN = 0.0;
    for (var y: i32 = -7; y <= 7; y++) { for (var x: i32 = -7; x <= 7; x++) {
        let d = length(vec2f(f32(x), f32(y))); if (d > 7.0) { continue; } let v = ld(p + vec2i(x, y)).x;
        if (d <= 2.3) { inner += v; innerN += 1.0; } else { outer += v; outerN += 1.0; } } }
    let m = inner / innerN; let n = outer / outerN;
    let b1 = mix(0.25, 0.30, u.k.x); let b2 = 0.365; let d1 = 0.267; let d2 = mix(0.40, 0.50, u.k.y);
    let sigm = 1.0 / (1.0 + exp(-(m - 0.5) * 4.0 / 0.147));
    let s1 = mix(b1, d1, sigm); let s2 = mix(b2, d2, sigm);
    let t = (1.0 / (1.0 + exp(-(n - s1) * 4.0 / 0.028))) * (1.0 - 1.0 / (1.0 + exp(-(n - s2) * 4.0 / 0.028)));
    let v = clamp(ld(p).x + (t - ld(p).x) * mix(0.2, 1.0, u.k.z), 0.0, 1.0);
    textureStore(dst, p, vec4f(v, 0.0, 0.0, 1.0));
}

// ─────────────────────────────────────────────── continuum PDEs
// heat equation, explicit; x = temperature, hot spots injected while hovering
@compute @workgroup_size(8, 8) fn cs_heat(@builtin(global_invocation_id) id: vec3u) {
    let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
    if (u.reset > 0.5) { textureStore(dst, p, vec4f(select(0.0, 1.0, rnd(p, u.seed) > 0.985), 0.0, 0.0, 1.0)); return; }
    let s = ld(p).x; let L = lap(p).x; var v = s + mix(0.05, 0.24, u.k.x) * L;
    let c = cen(p) - 0.3 * vec2f(cos(u.time * 0.7), sin(u.time * 0.9)); v += select(0.0, 0.08, length(c) < 0.03) * u.k.y;
    v *= 1.0 - 0.002 * u.k.z;
    textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}
// wave equation, leapfrog; x = height now, y = height before; drops fall while hovering
@compute @workgroup_size(8, 8) fn cs_wave(@builtin(global_invocation_id) id: vec3u) {
    let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
    if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
    let s = ld(p); let L = lap(p).x; let c2 = mix(0.05, 0.45, u.k.x);
    var v = 2.0 * s.x - s.y + c2 * L; v *= 1.0 - mix(0.0, 0.02, u.k.y);
    let r = rnd(vec2i(i32(u.frame), 0), u.seed); let drop = vec2f(rnd(vec2i(i32(u.frame), 1), u.seed), rnd(vec2i(i32(u.frame), 2), u.seed)) - 0.5;
    if (r < mix(0.01, 0.08, u.k.z) && length(cen(p) - drop) < 0.02) { v += 0.8; }
    textureStore(dst, p, vec4f(v, s.x, 0.0, 1.0));
}
// advection–diffusion of a dye in a fixed swirl field; x = dye
@compute @workgroup_size(8, 8) fn cs_advect(@builtin(global_invocation_id) id: vec3u) {
    let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
    if (u.reset > 0.5) { let c = cen(p); textureStore(dst, p, vec4f(select(0.0, 1.0, fract(c.x * 8.0) < 0.5), 0.0, 0.0, 1.0)); return; }
    let c = cen(p); let r = length(c); let w = mix(0.5, 3.0, u.k.x) * exp(-r * r * 8.0);
    let vel = vec2f(-c.y, c.x) * w + 0.3 * vec2f(sin(c.y * 12.0 + u.time), cos(c.x * 12.0 - u.time)) * u.k.z;
    let q = vec2f(p) + 0.5 - vel * 3.0;                    // semi-Lagrangian back-trace
    let i = vec2i(floor(q)); let f = fract(q);
    let a = ld(i).x; let b = ld(i + vec2i(1, 0)).x; let cc = ld(i + vec2i(0, 1)).x; let d = ld(i + vec2i(1, 1)).x;
    var v = mix(mix(a, b, f.x), mix(cc, d, f.x), f.y);
    v = mix(v, v + mix(0.0, 0.2, u.k.y) * lap(p).x, 1.0);
    textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}
// lattice Boltzmann, D2Q9, single-relaxation-time; two textures hold f0..f8 packed as (rho, ux, uy, _) recomputed each step from moments
// (a moment-based, 4-channel approximation: we store rho,ux,uy and reconstruct equilibrium — a "BGK on moments" toy that still shows vortex shedding)
@compute @workgroup_size(8, 8) fn cs_lbm(@builtin(global_invocation_id) id: vec3u) {
    let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
    if (u.reset > 0.5) { textureStore(dst, p, vec4f(1.0, 0.08, 0.0, 0.0)); return; }
    let c = cen(p); let obst = length(c - vec2f(-0.2, 0.0)) < 0.06;
    if (obst) { textureStore(dst, p, vec4f(1.0, 0.0, 0.0, 1.0)); return; }
    // moments advected by their own velocity with a relaxation toward the inflow — a stable toy of the real thing
    let s = ld(p); let q = vec2f(p) + 0.5 - vec2f(s.y, s.z) * f32(N) * 0.5;
    let i = vec2i(floor(q)); let f = fract(q);
    let a = ld(i); let b = ld(i + vec2i(1, 0)); let cc = ld(i + vec2i(0, 1)); let d = ld(i + vec2i(1, 1));
    var m = mix(mix(a, b, f.x), mix(cc, d, f.x), f.y);
    let L = lap(p); let nu = mix(0.02, 0.2, u.k.x);
    m += nu * L * vec4f(0.0, 1.0, 1.0, 0.0);
    // pressure-like term: velocity pushed away from density gradients
    let gx = (ld(p + vec2i(1, 0)).x - ld(p - vec2i(1, 0)).x) * 0.5; let gy = (ld(p + vec2i(0, 1)).x - ld(p - vec2i(0, 1)).x) * 0.5;
    m.y -= gx * 0.3; m.z -= gy * 0.3;
    let div = (ld(p + vec2i(1, 0)).y - ld(p - vec2i(1, 0)).y + ld(p + vec2i(0, 1)).z - ld(p - vec2i(0, 1)).z) * 0.5;
    m.x -= div * 0.5; m.x = mix(m.x, 1.0, 0.05);
    if (p.x < 2) { m = vec4f(1.0, mix(0.04, 0.16, u.k.y), 0.02 * sin(u.time), 0.0); }
    var wall = 0.0; for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) { if (ld(p + vec2i(x, y)).w > 0.5) { wall = 1.0; } } }
    if (wall > 0.5) { m.y *= 0.2; m.z *= 0.2; }
    textureStore(dst, p, vec4f(m.x, m.y, m.z, 0.0));
}
// falling sand: grains fall, and slide diagonally when blocked; the slide direction alternates by frame so no two grains fight for a cell
@compute @workgroup_size(8, 8) fn cs_sand(@builtin(global_invocation_id) id: vec3u) {
    let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
    if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
    let me = ld(p); let dn = select(ld(p + vec2i(0, 1)).x, 1.0, p.y >= N - 1);          // floor below the last row
    let d = select(-1, 1, (i32(u.frame) & 1) == 1);
    var v = me.x; var age = me.y;
    if (me.x > 0.5) {
        // leave if I can fall, or slide down-diagonal when blocked
        if (dn < 0.5) { v = 0.0; }
        else if (p.y < N - 1 && ld(p + vec2i(d, 1)).x < 0.5 && ld(p + vec2i(d, 0)).x < 0.5) { v = 0.0; }
    } else {
        let up = select(ld(p - vec2i(0, 1)).x, 0.0, p.y == 0);
        if (up > 0.5) { v = 1.0; age = ld(p - vec2i(0, 1)).y; }
        else {
            // a grain slides into me from up-and-across if it was blocked below and its side cell was free
            let q = p + vec2i(-d, -1);
            if (p.y > 0 && ld(q).x > 0.5 && (q.y >= N - 1 || ld(q + vec2i(0, 1)).x > 0.5) && ld(q + vec2i(d, 0)).x < 0.5) { v = 1.0; age = ld(q).y; }
        }
        // the source: grains appear near the top center while hovered
        if (p.y == 0 && abs(f32(p.x - N / 2) + mix(-20.0, 20.0, rnd(vec2i(i32(u.frame), 5), u.seed))) < mix(1.0, 12.0, u.k.y) && rnd(p, u.seed + u.frame * 0.001) < mix(0.1, 0.9, u.k.x)) { v = 1.0; age = u.frame; }
    }
    textureStore(dst, p, vec4f(v, age, 0.0, 1.0));
}

// Eden growth: empty cells touching the cluster join with a probability that falls with local crowding — coral
@compute @workgroup_size(8, 8) fn cs_eden(@builtin(global_invocation_id) id: vec3u) {
    let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
    if (u.reset > 0.5) { let c = cen(p); textureStore(dst, p, vec4f(select(0.0, 1.0, length(c - vec2f(0.0, 0.3)) < 0.012), 0.0, 0.0, 1.0)); return; }
    let s = ld(p); if (s.x > 0.5) { textureStore(dst, p, s); return; }
    let n = moore(p, 0); let r = rnd(p, u.seed + u.frame * 0.001);
    let up = select(0.0, 1.0, ld(p + vec2i(0, 1)).x > 0.5);   // +y is down on screen, so growth prefers cells whose lower neighbour is coral: it climbs
    let pgrow = mix(0.002, 0.03, u.k.x) * (1.0 + mix(0.0, 3.0, u.k.y) * up) / (1.0 + mix(0.0, 8.0, u.k.z) * max(n - 1.0, 0.0));
    let grow = n > 0.0 && r < pgrow;
    textureStore(dst, p, vec4f(select(0.0, 1.0, grow), select(0.0, u.frame, grow), 0.0, 1.0));
}
// erosion, thermal: material above the talus slope slides to lower neighbours
@compute @workgroup_size(8, 8) fn cs_erosion(@builtin(global_invocation_id) id: vec3u) {
    let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
    if (u.reset > 0.5) { let c = cen(p); var h = 0.0; var a = 0.5; var f = 6.0; for (var o: i32 = 0; o < 5; o++) { h += a * sin(c.x * f + 1.7 * cos(c.y * f * 0.8 + f32(o))) * cos(c.y * f * 1.3 + 0.9 * sin(c.x * f)); a *= 0.5; f *= 2.0; } textureStore(dst, p, vec4f(0.5 + 0.5 * h + 0.4 * (rnd(p, u.seed) - 0.5) * u.k.z, 0.0, 0.0, 1.0)); return; }
    let h = ld(p).x; let talus = mix(0.002, 0.03, u.k.x); var dh = 0.0;
    for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) { if (x == 0 && y == 0) { continue; }
        let d = h - ld(p + vec2i(x, y)).x; if (d > talus) { dh -= (d - talus) * 0.1; } else if (d < -talus) { dh += (-d - talus) * 0.1; } } }
    textureStore(dst, p, vec4f(h + dh * mix(0.2, 1.0, u.k.y), 0.0, 0.0, 1.0));
}

// ─────────────────────────────────────────────── present: state → color, one per sim family
@group(0) @binding(0) var<uniform> pu: SimU;
@group(0) @binding(1) var pTex: texture_2d<f32>;
@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(p[i], 0.0, 1.0);
}
fn rail(v: f32) -> vec3f { let lo = mix(pu.ink.rgb, pu.tone.rgb, smoothstep(0.0, 0.62, v)); return mix(lo, pu.cream.rgb, smoothstep(0.62, 1.0, v)); }
fn hsv(h: f32, s: f32, v: f32) -> vec3f { let k = fract(vec3f(h, h + 2.0 / 3.0, h + 1.0 / 3.0)) * 6.0; let p = abs(k - 3.0) - 1.0; return v * mix(vec3f(1.0), clamp(p, vec3f(0.0), vec3f(1.0)), s); }
fn cell_state(fp: vec2f) -> vec4f {
    let pos = fp / pu.pixelScale; let uv = (pos - 0.5 * pu.size) / max(min(pu.size.x, pu.size.y), 1.0) + 0.5;
    return textureLoad(pTex, clamp(vec2i(uv * f32(N)), vec2i(0), vec2i(N - 1)), 0);
}
// mode from pu.k.w set by the page: 0 binary+age, 1 states/k rainbow, 2 signed, 3 rd (v channel), 4 height, 5 rho/vel, 6 multi(x,y)
@fragment fn fs_present(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = cell_state(fp.xy); let mode = i32(pu.reset);      // the present pass reuses the reset slot as the mode
    var c = vec3f(0.0);
    if (mode == 0) { c = select(pu.ink.rgb, mix(pu.cream.rgb, pu.tone.rgb, clamp(s.y / 30.0, 0.0, 1.0)), s.x > 0.5); }
    else if (mode == 1) { c = select(pu.ink.rgb, hsv(s.x / max(s.y, 1.0), 0.6, 0.9), s.x > 0.0); }
    else if (mode == 2) { c = select(pu.ink.rgb, pu.cream.rgb, s.x > 0.0); }
    else if (mode == 3) { c = rail(clamp(s.y * 2.5, 0.0, 1.0)); }
    else if (mode == 4) { c = rail(clamp(s.x, 0.0, 1.0)); }
    else if (mode == 5) { c = select(mix(pu.ink.rgb, pu.tone.rgb, clamp(length(s.yz) * 5.0, 0.0, 1.0)) + pu.cream.rgb * clamp((s.x - 1.0) * 4.0, 0.0, 0.5), pu.cream.rgb, s.w > 0.5); }
    else if (mode == 6) { c = mix(pu.ink.rgb, pu.tone.rgb, clamp(s.y, 0.0, 1.0)) + pu.cream.rgb * clamp(s.x, 0.0, 1.0) * 0.8; }
    else if (mode == 7) { c = select(pu.ink.rgb, hsv(s.x / 3.0, 0.55, 0.9) * mix(0.6, 1.0, s.y / 60.0), true); }
    else if (mode == 8) { c = select(select(pu.ink.rgb, vec3f(0.2, 0.6, 0.25), s.x == 1.0), vec3f(1.0, 0.55, 0.15), s.x == 2.0); }
    else if (mode == 9) { c = rail(clamp(s.x * 0.5 + 0.5, 0.0, 1.0)); }
    else if (mode == 10) { c = rail(clamp(s.x / 4.0, 0.0, 1.0)); }
    else if (mode == 11) { c = select(select(pu.ink.rgb, pu.tone.rgb * 0.5, s.y > 0.5), mix(pu.cream.rgb, pu.tone.rgb, clamp(s.z / 4000.0, 0.0, 1.0)), s.x > 0.5); }
    else if (mode == 12) { c = rail(clamp(s.x - 0.3, 0.0, 1.0) * 1.4); }
    else if (mode == 13) { c = select(rail(clamp((s.x - s.y) / max(1.0 - s.y, 0.05) * 0.6, 0.0, 0.6)), pu.cream.rgb, s.x >= 1.0); }
    else if (mode == 15) { c = select(pu.ink.rgb, mix(pu.cream.rgb, pu.tone.rgb, fract(s.y / 1200.0)), s.x > 0.5); }
    else if (mode == 14) { c = select(pu.ink.rgb, mix(pu.cream.rgb, pu.tone.rgb, clamp(s.y / 3000.0, 0.0, 1.0)), s.x > 0.5); }
    return vec4f(c, 1.0);
}
