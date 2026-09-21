// ═══════════════════════════════════════════════════════════════════════════
//  FIELD TABLE  ·  2-D vector fields, one function per cell, drawn by particles.
//
//  Each cell is  fn v_<name>(p: vec2f, t: f32, k: vec4f) -> vec2f  — the
//  velocity at p (domain about ±1). A compute pass moves 4096 particles along
//  the field and deposits them into a trail texture that fades; a present pass
//  colors the trail by speed. The same field function is also evaluated per
//  pixel for the background: a faint LIC-like streak so the structure reads
//  even when the cell is still.
//
//  References: potential-flow elements (source, vortex, doublet, uniform stream)
//  from Anderson's aerodynamics; Taylor–Green vortices; Rankine vortex; curl
//  noise — Bridson, Hourihan & Nordenstam 2007; phase portraits (pendulum,
//  van der Pol, Duffing, Lotka–Volterra, Hopf, saddle/spiral/node, Lorenz
//  projection) — Strogatz, Nonlinear Dynamics and Chaos; gravitational and
//  Coulomb fields from point masses/charges; magnetic dipole field.
// ═══════════════════════════════════════════════════════════════════════════

struct FieldU {
    size: vec2f, time: f32, pixelScale: f32,
    ink: vec4f, tone: vec4f, cream: vec4f,
    k: vec4f,
    speed: f32, fade: f32, frame: f32, seed: f32,
}
const PI: f32 = 3.14159265358979;
const TAU: f32 = 6.28318530717959;
const NP: u32 = 4096u;
const TS: i32 = 256;    // trail texture size

fn pcg(vin: vec3u) -> vec3u { var v = vin * 1664525u + 1013904223u; v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y; v ^= v >> vec3u(16u); v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y; return v; }
fn rnd3(i: u32, s: f32) -> vec3f { return vec3f(pcg(vec3u(i, u32(s * 1000.0) + 7u, 13u))) / 4294967295.0; }
fn rot2(a: f32) -> mat2x2f { let c = cos(a); let s = sin(a); return mat2x2f(c, s, -s, c); }
fn hash2(p: vec2i, seed: u32) -> vec2f { let q = pcg(vec3u(vec2u(p + vec2i(32768)), seed)); return vec2f(q.xy) / 4294967295.0; }
fn grad2(i: vec2i, seed: u32) -> vec2f { let a = hash2(i, seed).x * TAU; return vec2f(cos(a), sin(a)); }
fn fade(t: vec2f) -> vec2f { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
fn pnoise(p: vec2f, seed: u32) -> f32 {
    let i = vec2i(floor(p)); let f = fract(p); let u = fade(f);
    let a = dot(grad2(i, seed), f); let b = dot(grad2(i + vec2i(1, 0), seed), f - vec2f(1.0, 0.0));
    let c = dot(grad2(i + vec2i(0, 1), seed), f - vec2f(0.0, 1.0)); let d = dot(grad2(i + vec2i(1, 1), seed), f - vec2f(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.414;
}
fn fbm(pin: vec2f, seed: u32) -> f32 { var p = pin; var a = 0.5; var s = 0.0; for (var i: i32 = 0; i < 4; i++) { s += a * pnoise(p, seed + u32(i)); a *= 0.5; p = rot2(0.5) * p * 2.0; } return s; }
fn grad_fbm(p: vec2f, t: f32, seed: u32) -> vec2f { let e = 0.01; let v = fbm(p + t, seed); return vec2f(fbm(p + vec2f(e, 0.0) + t, seed) - v, fbm(p + vec2f(0.0, e) + t, seed) - v) / e; }

// ═══════════════════════════════════════════════════════════ the fields
// —— potential flow ————————————————————————————————————————————————————————
fn v_uniform(p: vec2f, t: f32, k: vec4f) -> vec2f { return rot2(k.x * TAU + 0.2 * sin(t * 0.3)) * vec2f(1.0, 0.0); }
fn v_source(p: vec2f, t: f32, k: vec4f) -> vec2f { let r2 = max(dot(p, p), 0.01); return p / r2 * mix(0.3, 1.5, k.x) * select(1.0, -1.0, k.y > 0.5); }
fn v_vortex(p: vec2f, t: f32, k: vec4f) -> vec2f { let r2 = max(dot(p, p), 0.01); return vec2f(-p.y, p.x) / r2 * mix(0.3, 1.5, k.x); }
fn v_rankine(p: vec2f, t: f32, k: vec4f) -> vec2f { let r = length(p); let a = mix(0.15, 0.6, k.x); let w = select(1.0 / max(r, 1e-3), r / (a * a), r < a); return vec2f(-p.y, p.x) / max(r, 1e-3) * w * a * mix(0.5, 2.0, k.y); }
fn v_doublet(p: vec2f, t: f32, k: vec4f) -> vec2f { let r2 = max(dot(p, p), 0.005); let r4 = r2 * r2; return vec2f((p.y * p.y - p.x * p.x), -2.0 * p.x * p.y) / r4 * 0.05 * mix(0.3, 2.0, k.x); }
// cylinder: uniform stream plus a doublet — the textbook flow around a circle
fn v_cylinder(p: vec2f, t: f32, k: vec4f) -> vec2f {
    let R = mix(0.2, 0.5, k.x); let r2 = max(dot(p, p), R * R * 0.999); let r4 = r2 * r2;
    let U = 1.0; let circ = mix(-2.0, 2.0, k.y);
    var v = vec2f(U, 0.0) + U * R * R * vec2f((p.y * p.y - p.x * p.x), -2.0 * p.x * p.y) / r4 + circ * vec2f(-p.y, p.x) / r2 * 0.3;
    return select(v, vec2f(0.0), dot(p, p) < R * R);
}
fn v_spiral_sink(p: vec2f, t: f32, k: vec4f) -> vec2f { let r2 = max(dot(p, p), 0.01); return (vec2f(-p.y, p.x) * mix(0.0, 1.5, k.x) - p * mix(0.1, 1.0, k.y)) / sqrt(r2); }
fn v_taylor_green(p: vec2f, t: f32, k: vec4f) -> vec2f { let f = mix(2.0, 8.0, k.x) * PI; let q = p * 0.5 + 0.5; return vec2f(sin(f * q.x) * cos(f * q.y), -cos(f * q.x) * sin(f * q.y)) * exp(-0.0 * t); }
fn v_shear(p: vec2f, t: f32, k: vec4f) -> vec2f { let w = mix(0.05, 0.3, k.y); return vec2f(tanh(p.y / w) * mix(0.5, 1.5, k.x) + 0.1 * sin(p.x * 10.0 + t), 0.05 * sin(p.x * 6.0 - t * 0.7) * k.z); }
fn v_dipole_pair(p: vec2f, t: f32, k: vec4f) -> vec2f {
    let a = vec2f(-0.4, 0.0); let b = vec2f(0.4, 0.0); let pa = p - a; let pb = p - b; let s = mix(0.3, 1.5, k.x);
    return s * (vec2f(-pa.y, pa.x) / max(dot(pa, pa), 0.01) - vec2f(-pb.y, pb.x) / max(dot(pb, pb), 0.01));
}

// —— physics ———————————————————————————————————————————————————————————————
// gravity of three fixed masses, the field itself (not orbits): particles fall in and get flung by the softening
fn v_gravity(p: vec2f, t: f32, k: vec4f) -> vec2f {
    var g = vec2f(0.0); let eps = mix(0.02, 0.2, k.y);
    for (var i: i32 = 0; i < 3; i++) { let a = f32(i) * 2.094 + t * 0.15; let c = vec2f(cos(a), sin(a)) * mix(0.0, 0.6, k.x); let d = c - p; g += d / pow(dot(d, d) + eps * eps, 1.5) * 0.05; }
    return g;
}
// electric field of two charges, sign from the knob
fn v_coulomb(p: vec2f, t: f32, k: vec4f) -> vec2f {
    let a = vec2f(-0.45, 0.0); let b = vec2f(0.45, 0.0); let qa = 1.0; let qb = select(-1.0, 1.0, k.y > 0.5);
    let pa = p - a; let pb = p - b; let eps = 0.03;
    return (qa * pa / pow(dot(pa, pa) + eps, 1.5) + qb * pb / pow(dot(pb, pb) + eps, 1.5)) * 0.08 * mix(0.5, 2.0, k.x);
}
// magnetic dipole in the plane: B ∝ (3(m·r̂)r̂ − m)/r³
fn v_magnetic_dipole(p: vec2f, t: f32, k: vec4f) -> vec2f {
    let m = rot2(k.x * TAU + t * 0.1) * vec2f(0.0, 1.0); let r = length(p); let rh = p / max(r, 1e-3);
    return (3.0 * dot(m, rh) * rh - m) / max(r * r * r, 0.01) * 0.05;
}
fn v_pendulum(p: vec2f, t: f32, k: vec4f) -> vec2f { let th = p.x * PI * 2.0; let w = p.y * 4.0; return vec2f(w / (PI * 2.0), (-sin(th) * mix(2.0, 8.0, k.x) - mix(0.0, 1.5, k.y) * w) / 4.0) * 0.5; }
fn v_vanderpol(p: vec2f, t: f32, k: vec4f) -> vec2f { let x = p.x * 3.0; let y = p.y * 3.0; let mu = mix(0.2, 2.5, k.x); return vec2f(y, mu * (1.0 - x * x) * y - x) / 3.0 * 0.4; }
fn v_duffing(p: vec2f, t: f32, k: vec4f) -> vec2f { let x = p.x * 2.0; let y = p.y * 2.0; let d = mix(0.0, 0.6, k.y); return vec2f(y, x - x * x * x - d * y + mix(0.0, 0.8, k.x) * cos(t * 1.2)) * 0.4; }
fn v_lotka(p: vec2f, t: f32, k: vec4f) -> vec2f { let x = (p.x + 1.0) * 2.0; let y = (p.y + 1.0) * 2.0; let a = mix(0.8, 1.6, k.x); return vec2f(a * x - x * y, x * y - a * y) * 0.25; }
fn v_hopf(p: vec2f, t: f32, k: vec4f) -> vec2f { let r2 = dot(p, p); let mu = mix(-0.3, 0.6, k.x); return (p * (mu - r2) + vec2f(-p.y, p.x) * mix(0.5, 2.0, k.y)) * 0.7; }
fn v_saddle(p: vec2f, t: f32, k: vec4f) -> vec2f { let a = k.x * PI; return rot2(a) * (vec2f(1.0, -1.0) * (rot2(-a) * p)) * mix(0.5, 1.5, k.y); }
fn v_node(p: vec2f, t: f32, k: vec4f) -> vec2f { let l1 = mix(-1.0, 1.0, k.x); let l2 = mix(-1.0, 1.0, k.y); return vec2f(l1 * p.x, l2 * p.y) * 0.8; }
// a projection of the Lorenz flow onto (x, z), y reconstructed from a knob — chaos as a field
fn v_lorenz(p: vec2f, t: f32, k: vec4f) -> vec2f { let x = p.x * 25.0; let z = p.y * 25.0 + 25.0; let y = x * mix(0.6, 1.4, k.x); let s = 10.0; let r = 28.0; let b = 8.0 / 3.0; return vec2f(s * (y - x), x * y - b * z) / 25.0 * 0.03; }

// —— noise-driven ———————————————————————————————————————————————————————————
fn v_curl(p: vec2f, t: f32, k: vec4f) -> vec2f { let g = grad_fbm(p * mix(1.0, 4.0, k.x), t * 0.1 * k.y, 31u); return vec2f(g.y, -g.x) * 0.3; }
fn v_gradient(p: vec2f, t: f32, k: vec4f) -> vec2f { return grad_fbm(p * mix(1.0, 4.0, k.x), t * 0.1 * k.y, 37u) * 0.3 * select(1.0, -1.0, k.z > 0.5); }
fn v_curl_plus_stream(p: vec2f, t: f32, k: vec4f) -> vec2f { let g = grad_fbm(p * mix(1.0, 4.0, k.x), t * 0.1, 41u); return vec2f(g.y, -g.x) * mix(0.0, 0.6, k.y) + vec2f(mix(0.2, 1.0, k.z), 0.0); }
fn v_wind(p: vec2f, t: f32, k: vec4f) -> vec2f { let g1 = grad_fbm(p * 1.5, t * 0.15, 43u); let g2 = grad_fbm(p * 5.0 + 3.0, t * 0.4, 47u); return vec2f(g1.y, -g1.x) * 0.5 + vec2f(g2.y, -g2.x) * 0.12 * mix(0.0, 2.0, k.x) + vec2f(0.3 + 0.2 * sin(t * 0.5), 0.0) * k.y; }
fn v_sine_flow(p: vec2f, t: f32, k: vec4f) -> vec2f { let a = mix(1.0, 4.0, k.x); return vec2f(sin(p.y * a * PI + t * 0.5), sin(p.x * a * PI - t * 0.4)) * 0.5; }
fn v_abc_slice(p: vec2f, t: f32, k: vec4f) -> vec2f { let A = 1.0; let B = mix(0.4, 1.2, k.x); let C = mix(0.4, 1.2, k.y); let z = t * 0.2; let q = p * PI; return vec2f(A * sin(z) + C * cos(q.y), B * sin(q.x) + A * cos(z)) * 0.3; }

// —— more potential flow ————————————————————————————————————————————————————
fn v_stagnation(p: vec2f, t: f32, k: vec4f) -> vec2f { return rot2(k.y * PI) * (vec2f(p.x, -p.y) * mix(0.4, 1.5, k.x)); }
fn v_source_vortex(p: vec2f, t: f32, k: vec4f) -> vec2f { let r = max(length(p), 0.05); return (p * mix(0.2, 1.0, k.x) + vec2f(-p.y, p.x) * mix(0.3, 1.5, k.y)) / r; }
fn v_vortex_street(p: vec2f, t: f32, k: vec4f) -> vec2f {
    var v = vec2f(0.0);
    for (var i: i32 = -2; i <= 2; i++) {
        let even = (i & 1) == 0;
        let cx = f32(i) * 0.5 - t * mix(0.0, 0.3, k.y);
        let dd = p - vec2f(cx, select(-0.16, 0.16, even));
        v += select(-1.0, 1.0, even) * vec2f(-dd.y, dd.x) / max(dot(dd, dd), 0.02);
    }
    return v * mix(0.05, 0.2, k.x) + vec2f(mix(0.0, 0.6, k.z), 0.0);
}
fn v_rankine_halfbody(p: vec2f, t: f32, k: vec4f) -> vec2f { let r2 = max(dot(p, p), 0.01); return vec2f(mix(0.3, 1.0, k.y), 0.0) + p / r2 * mix(0.2, 0.8, k.x); }
fn v_channel(p: vec2f, t: f32, k: vec4f) -> vec2f { return vec2f((1.0 - p.y * p.y) * mix(0.5, 1.6, k.x), 0.0); }
fn v_couette(p: vec2f, t: f32, k: vec4f) -> vec2f { return vec2f(p.y * mix(0.5, 1.6, k.x) + mix(0.0, 0.5, k.y), 0.0); }
fn v_stokeslet(p: vec2f, t: f32, k: vec4f) -> vec2f { let f = rot2(k.y * TAU) * vec2f(1.0, 0.0); let r = max(length(p), 0.06); let rh = p / r; return (f * (-log(r)) + rh * dot(f, rh)) * mix(0.1, 0.4, k.x); }
fn v_jet(p: vec2f, t: f32, k: vec4f) -> vec2f { let env = exp(-p.y * p.y * mix(3.0, 12.0, k.z)); return vec2f(mix(0.4, 1.4, k.x) * env, cos(p.x * mix(2.0, 6.0, k.y) * PI + t * 0.6) * 0.4 * env); }
fn v_double_vortex(p: vec2f, t: f32, k: vec4f) -> vec2f { let pa = p - vec2f(-0.35, 0.0); let pb = p - vec2f(0.35, 0.0); let s = mix(0.3, 1.2, k.x); return s * (vec2f(-pa.y, pa.x) / max(dot(pa, pa), 0.02) + vec2f(-pb.y, pb.x) / max(dot(pb, pb), 0.02)); }
fn v_source_sink(p: vec2f, t: f32, k: vec4f) -> vec2f { let pa = p - vec2f(-0.4, 0.0); let pb = p - vec2f(0.4, 0.0); return (pa / max(dot(pa, pa), 0.02) - pb / max(dot(pb, pb), 0.02)) * mix(0.1, 0.5, k.x); }

// —— more physics ————————————————————————————————————————————————————————————
fn v_orbit(p: vec2f, t: f32, k: vec4f) -> vec2f { let c = vec2f(cos(t * 0.3), sin(t * 0.3)) * mix(0.0, 0.4, k.y); let d = p - c; let r = max(length(d), 0.06); return (-d / (r * r * r) + vec2f(-d.y, d.x) / r * mix(0.0, 1.5, k.x)) * 0.1; }
fn v_charged_ring(p: vec2f, t: f32, k: vec4f) -> vec2f { let r = length(p); let R = mix(0.3, 0.6, k.x); return normalize(p + vec2f(1e-4)) * (r - R) * mix(1.0, 3.0, k.y); }
fn v_two_body(p: vec2f, t: f32, k: vec4f) -> vec2f { let ph = t * 0.4; let c1 = vec2f(cos(ph), sin(ph)) * 0.35; let d1 = c1 - p; let d2 = -c1 - p; let e = mix(0.02, 0.15, k.y); return (d1 / pow(dot(d1, d1) + e * e, 1.5) + d2 / pow(dot(d2, d2) + e * e, 1.5)) * 0.05 * mix(0.5, 1.5, k.x); }

// —— more phase portraits —————————————————————————————————————————————————————
fn v_spiral(p: vec2f, t: f32, k: vec4f) -> vec2f { let a = mix(-0.6, 0.3, k.x); let w = mix(0.5, 2.0, k.y); return vec2f(a * p.x - w * p.y, w * p.x + a * p.y); }
fn v_limit_cycle(p: vec2f, t: f32, k: vec4f) -> vec2f { let r = length(p); let R = mix(0.3, 0.7, k.x); let rh = p / max(r, 1e-3); return (rh * (R - r) * mix(1.0, 3.0, k.y) + vec2f(-rh.y, rh.x) * mix(0.5, 1.5, k.z)) * 0.8; }
fn v_selkov(p: vec2f, t: f32, k: vec4f) -> vec2f { let x = (p.x + 1.0) * 1.5; let y = (p.y + 1.0) * 1.5; let a = mix(0.05, 0.15, k.x); let b = mix(0.4, 1.0, k.y); return vec2f(-x + a * y + x * x * y, b - a * y - x * x * y) * 0.4; }
fn v_brusselator(p: vec2f, t: f32, k: vec4f) -> vec2f { let x = (p.x + 1.0) * 1.5; let y = (p.y + 1.0) * 1.5; let A = mix(0.5, 1.5, k.x); let B = mix(1.5, 3.5, k.y); return vec2f(A - (B + 1.0) * x + x * x * y, B * x - x * x * y) * 0.3; }
fn v_fitzhugh_ph(p: vec2f, t: f32, k: vec4f) -> vec2f { let vv = p.x * 2.0; let w = p.y * 2.0; let a = mix(0.5, 0.9, k.x); let eps = mix(0.05, 0.2, k.y); return vec2f(vv - vv * vv * vv / 3.0 - w, eps * (vv + a)) * 0.6; }
fn v_pitchfork(p: vec2f, t: f32, k: vec4f) -> vec2f { let r = mix(-0.5, 0.5, k.x); return vec2f(r * p.x - p.x * p.x * p.x, -p.y) * mix(0.5, 1.5, k.y); }

// —— more noise-driven ————————————————————————————————————————————————————————
fn v_perlin_curl(p: vec2f, t: f32, k: vec4f) -> vec2f { let g = grad_fbm(p * mix(0.8, 2.5, k.x), t * 0.05 * k.y, 53u); return vec2f(g.y, -g.x) * 0.5; }
fn v_turbulent(p: vec2f, t: f32, k: vec4f) -> vec2f { let g = grad_fbm(abs(p) * mix(1.0, 4.0, k.x), t * 0.1 * k.y, 59u); return vec2f(g.y, -g.x) * 0.4; }

// ═══════════════════════════════════════════════════════════ the runtime
struct Particle { p: vec2f, v: vec2f }
@group(0) @binding(0) var<uniform> u: FieldU;
@group(0) @binding(1) var<storage, read_write> parts: array<Particle>;
@group(0) @binding(2) var trailIn: texture_2d<f32>;
@group(0) @binding(3) var trailOut: texture_storage_2d<rgba16float, write>;

fn tex_of(p: vec2f) -> vec2i { return vec2i((p * 0.5 + 0.5) * f32(TS)); }

// FIELD_DISPATCH is generated per cell by the page: fn field(p, t, k) -> vec2f { return v_<name>(p, t, k); }
__FIELD_FN__

@compute @workgroup_size(64) fn cs_move(@builtin(global_invocation_id) id: vec3u) {
    let i = id.x; if (i >= NP) { return; }
    var pt = parts[i];
    if (u.frame < 0.5) { let r = rnd3(i, u.seed); pt.p = r.xy * 2.0 - 1.0; pt.v = vec2f(0.0); }
    // RK2 midpoint along the field
    let dt = 0.016 * u.speed;
    let v1 = field(pt.p, u.time, u.k); let mid = pt.p + v1 * dt * 0.5; let v2 = field(mid, u.time, u.k);
    pt.p += v2 * dt; pt.v = v2;
    // respawn when the particle leaves the domain or stalls, at a hashed point; a little of the swarm respawns anyway so sinks never empty the field
    let r = rnd3(i + u32(u.frame) * NP, u.seed);
    let out = any(abs(pt.p) > vec2f(1.05)) || length(pt.v) < 1e-4 || r.z < mix(0.001, 0.02, u.fade);
    if (out) { pt.p = r.xy * 2.0 - 1.0; pt.v = field(pt.p, u.time, u.k); }
    parts[i] = pt;
}
// fade the trail texture; particles are splatted by the draw pass
@compute @workgroup_size(8, 8) fn cs_fade(@builtin(global_invocation_id) id: vec3u) {
    let p = vec2i(id.xy); if (p.x >= TS || p.y >= TS) { return; }
    let c = textureLoad(trailIn, p, 0);
    textureStore(trailOut, p, c * (1.0 - mix(0.02, 0.2, u.fade)));
}

// particle splat: draw as points via instanced quads
struct VOut { @builtin(position) pos: vec4f, @location(0) spd: f32 }
@group(0) @binding(0) var<uniform> pu: FieldU;
@group(0) @binding(1) var<storage, read> partsR: array<Particle>;
@vertex fn vs_points(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
    let pt = partsR[ii];
    var corner = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
    let sz = 1.6 / f32(TS);
    var o: VOut; o.pos = vec4f(pt.p + corner[vi] * sz, 0.0, 1.0); o.spd = length(pt.v); return o;
}
@fragment fn fs_points(in: VOut) -> @location(0) vec4f { return vec4f(0.12, 0.12 * min(in.spd, 4.0), 0.0, 1.0); }

// present: the faint per-pixel field direction as a background, then the trail
@group(0) @binding(0) var<uniform> qu: FieldU;
@group(0) @binding(1) var trailTex: texture_2d<f32>;
@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(p[i], 0.0, 1.0);
}
fn rail(v: f32) -> vec3f { let lo = mix(qu.ink.rgb, qu.tone.rgb, smoothstep(0.0, 0.62, v)); return mix(lo, qu.cream.rgb, smoothstep(0.62, 1.0, v)); }
@fragment fn fs_present(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let pos = fp.xy / qu.pixelScale; let uv = (pos - 0.5 * qu.size) / max(min(qu.size.x, qu.size.y), 1.0) * 2.0;
    let v = field(uv, qu.time, qu.k); let a = atan2(v.y, v.x);
    // streak: a sine along the local flow direction, so the background is combed like iron filings
    let comb = 0.5 + 0.5 * sin(dot(uv, vec2f(-sin(a), cos(a))) * 90.0);
    let bg = mix(qu.ink.rgb, qu.tone.rgb, 0.10 + 0.10 * comb * smoothstep(0.0, 0.05, length(v)));
    let tp = vec2i(clamp((uv * 0.5 + 0.5) * f32(TS), vec2f(0.0), vec2f(f32(TS) - 1.0)));
    let tr = textureLoad(trailTex, tp, 0);
    let glow = 1.0 - exp(-tr.x * 1.2);
    let col = mix(bg, rail(0.55 + 0.45 * clamp(tr.y / max(tr.x, 1e-3) * 0.5, 0.0, 1.0)), glow);
    return vec4f(col, 1.0);
}
