// ═══════════════════════════════════════════════════════════════════════════
//  HEAT METAL TABLE  ·  a heat-equation compute simulation, one kernel per cell.
//  Each cell owns two rgba32float textures (ping-pong). state.x is temperature
//  in 0..1. A kernel reads src, writes dst; the present pass colors dst through
//  a metal palette. Heat diffuses (v = T + D*laplacian), is injected from a
//  moving source, and cools everywhere so a trail fades behind the emitter.
//  Heat equation is explicit FTCS; the advected cells back-trace a swirl field.
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

const N: i32 = 128;
const PI: f32 = 3.14159265358979;
const TAU: f32 = 6.28318530717959;

fn pcg(vin: vec3u) -> vec3u { var v = vin * 1664525u + 1013904223u; v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y; v ^= v >> vec3u(16u); v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y; return v; }
fn rnd(p: vec2i, s: f32) -> f32 { return f32(pcg(vec3u(u32(p.x + 65536), u32(p.y + 65536), u32(s * 1000.0) + 7u)).x) / 4294967295.0; }
fn wrap(p: vec2i) -> vec2i { return ((p % N) + N) % N; }
fn ld(p: vec2i) -> vec4f { return textureLoad(src, wrap(p), 0); }
fn lap(p: vec2i) -> f32 { return ld(p + vec2i(1, 0)).x + ld(p - vec2i(1, 0)).x + ld(p + vec2i(0, 1)).x + ld(p - vec2i(0, 1)).x - 4.0 * ld(p).x; }
fn lapAniso(p: vec2i, ax: f32, ay: f32) -> f32 { return ax * (ld(p + vec2i(1, 0)).x + ld(p - vec2i(1, 0)).x) + ay * (ld(p + vec2i(0, 1)).x + ld(p - vec2i(0, 1)).x) - 2.0 * (ax + ay) * ld(p).x; }
fn cen(p: vec2i) -> vec2f { return (vec2f(p) + 0.5) / f32(N) - 0.5; }
fn emit(p: vec2i, ctr: vec2f, radius: f32) -> f32 { let d = length(cen(p) - ctr); return exp(-(d * d) / (radius * radius)); }
fn flick(p: vec2i, t: f32) -> f32 { return 0.55 + 0.45 * rnd(p, floor(t * 10.0)); }
fn swirl(c: vec2f, t: f32) -> vec2f { let r = length(c) + 0.08; return vec2f(-c.y, c.x) / r * 0.35 + 0.2 * vec2f(sin(c.y * 9.0 + t), cos(c.x * 9.0 - t)); }
fn advectT(p: vec2i, vel: vec2f) -> f32 {
    let q = vec2f(p) + 0.5 - vel; let i = vec2i(floor(q)); let f = fract(q);
    let a = ld(i).x; let b = ld(i + vec2i(1, 0)).x; let cc = ld(i + vec2i(0, 1)).x; let d = ld(i + vec2i(1, 1)).x;
    return mix(mix(a, b, f.x), mix(cc, d, f.x), f.y);
}

// ── the 60 heat kernels ──────────────────────────────────────────────────────
@compute @workgroup_size(8, 8) fn cs_orbit(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.05, 0.24, k.x) * lap(p);
  let ctr = 0.30 * vec2f(cos(t * 0.7), sin(t * 0.9));
  let d = length(cen(p) - ctr);
  let radius = mix(0.06, 0.13, k.y) * (0.85 + 0.15 * sin(t * 5.0 + d * 40.0));
  let core = exp(-(d * d) / (radius * radius));
  var v = v0 + 0.35 * core * flick(p, t) * (0.55 + k.y);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_orbit_fast(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.05, 0.24, k.x) * lap(p);
  let ctr = 0.30 * vec2f(cos(t * 1.8), sin(t * 1.8));
  let d = length(cen(p) - ctr);
  let radius = mix(0.06, 0.13, k.y) * (0.85 + 0.15 * sin(t * 5.0 + d * 40.0));
  let core = exp(-(d * d) / (radius * radius));
  var v = v0 + 0.4 * core * flick(p, t) * (0.55 + k.y);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_orbit_slow(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.05, 0.24, k.x) * lap(p);
  let ctr = 0.28 * vec2f(cos(t * 0.35), sin(t * 0.35));
  let d = length(cen(p) - ctr);
  let radius = mix(0.09, 0.18, k.y) * (0.85 + 0.15 * sin(t * 5.0 + d * 40.0));
  let core = exp(-(d * d) / (radius * radius));
  var v = v0 + 0.35 * core * flick(p, t) * (0.55 + k.y);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_lissajous(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.05, 0.24, k.x) * lap(p);
  let ctr = vec2f(0.32 * sin(t * 0.8), 0.30 * sin(t * 1.3 + 1.0));
  let d = length(cen(p) - ctr);
  let radius = mix(0.06, 0.13, k.y) * (0.85 + 0.15 * sin(t * 5.0 + d * 40.0));
  let core = exp(-(d * d) / (radius * radius));
  var v = v0 + 0.35 * core * flick(p, t) * (0.55 + k.y);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_drift(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.05, 0.24, k.x) * lap(p);
  let ctr = 0.30 * vec2f(sin(t * 0.4) + 0.4 * sin(t * 1.1), cos(t * 0.5));
  let d = length(cen(p) - ctr);
  let radius = mix(0.06, 0.13, k.y) * (0.85 + 0.15 * sin(t * 5.0 + d * 40.0));
  let core = exp(-(d * d) / (radius * radius));
  var v = v0 + 0.35 * core * flick(p, t) * (0.55 + k.y);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_figure8(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.05, 0.24, k.x) * lap(p);
  let ctr = vec2f(0.32 * sin(t * 0.9), 0.26 * sin(t * 1.8));
  let d = length(cen(p) - ctr);
  let radius = mix(0.06, 0.13, k.y) * (0.85 + 0.15 * sin(t * 5.0 + d * 40.0));
  let core = exp(-(d * d) / (radius * radius));
  var v = v0 + 0.35 * core * flick(p, t) * (0.55 + k.y);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_spiral(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.05, 0.24, k.x) * lap(p);
  let ctr = (0.06 + 0.26 * abs(sin(t * 0.3))) * vec2f(cos(t * 2.0), sin(t * 2.0));
  let d = length(cen(p) - ctr);
  let radius = mix(0.06, 0.13, k.y) * (0.85 + 0.15 * sin(t * 5.0 + d * 40.0));
  let core = exp(-(d * d) / (radius * radius));
  var v = v0 + 0.35 * core * flick(p, t) * (0.55 + k.y);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_comet(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.05, 0.24, k.x) * lap(p);
  let ctr = 0.32 * vec2f(cos(t * 1.3), sin(t * 1.1));
  let d = length(cen(p) - ctr);
  let radius = mix(0.05, 0.09, k.y) * (0.85 + 0.15 * sin(t * 5.0 + d * 40.0));
  let core = exp(-(d * d) / (radius * radius));
  var v = v0 + 0.5 * core * flick(p, t) * (0.55 + k.y);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_jitter(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.05, 0.24, k.x) * lap(p);
  let ctr = 0.28 * vec2f(cos(t * 0.6), sin(t * 0.8)) + 0.05 * vec2f(rnd(vec2i(i32(t * 20.0), 0), 1.0) - 0.5, rnd(vec2i(i32(t * 20.0), 7), 1.0) - 0.5);
  let d = length(cen(p) - ctr);
  let radius = mix(0.06, 0.13, k.y) * (0.85 + 0.15 * sin(t * 5.0 + d * 40.0));
  let core = exp(-(d * d) / (radius * radius));
  var v = v0 + 0.35 * core * flick(p, t) * (0.55 + k.y);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_wobble_ring(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.05, 0.24, k.x) * lap(p);
  let ctr = 0.30 * vec2f(cos(t * 0.7), sin(t * 0.9));
  let d = length(cen(p) - ctr);
  let radius = mix(0.05, 0.16, k.y) * (0.6 + 0.5 * sin(t * 2.0)) * (0.85 + 0.15 * sin(t * 5.0 + d * 40.0));
  let core = exp(-(d * d) / (radius * radius));
  var v = v0 + 0.35 * core * flick(p, t) * (0.55 + k.y);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_billet(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.05, 0.24, k.x) * lap(p);
  let ctr = vec2f(0.0);
  let d = length(cen(p) - ctr);
  let radius = mix(0.2, 0.36, k.y);
  let core = exp(-(d * d) / (radius * radius));
  var v = v0 + 0.4 * core * flick(p, t) * (0.55 + k.y);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_billet_pulse(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.06, 0.24, k.x) * lap(p);
  let pulse = 0.5 + 0.5 * sin(t * 1.2);
  var v = v0 + 0.45 * emit(p, vec2f(0.0), mix(0.2, 0.34, k.y)) * (0.4 + 0.9 * pulse);
  v *= 1.0 - mix(0.01, 0.05, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_soak(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.05, 0.24, k.x) * lap(p);
  let ctr = vec2f(0.0);
  let d = length(cen(p) - ctr);
  let radius = mix(0.25, 0.45, k.y);
  let core = exp(-(d * d) / (radius * radius));
  var v = v0 + 0.3 * core * flick(p, t) * (0.55 + k.y);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_blast(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.08, 0.24, k.x) * lap(p);
  let blast = pow(0.5 + 0.5 * sin(t * 0.8), 2.0);
  var v = v0 + 0.6 * emit(p, vec2f(0.0), mix(0.28, 0.5, k.y)) * (0.5 + blast) * flick(p, t);
  v *= 1.0 - mix(0.008, 0.04, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_even_glow(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.05, 0.24, k.x) * lap(p);
  let ctr = vec2f(0.0);
  let d = length(cen(p) - ctr);
  let radius = mix(0.35, 0.6, k.y);
  let core = exp(-(d * d) / (radius * radius));
  var v = v0 + 0.25 * core * flick(p, t) * (0.55 + k.y);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_core_bloom(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.05, 0.24, k.x) * lap(p);
  let ctr = vec2f(0.0);
  let d = length(cen(p) - ctr);
  let radius = mix(0.1, 0.28, k.y) * (0.7 + 0.4 * sin(t * 1.5));
  let core = exp(-(d * d) / (radius * radius));
  var v = v0 + 0.45 * core * flick(p, t) * (0.55 + k.y);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_ramp_soak(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.06, 0.24, k.x) * lap(p);
  let ramp = smoothstep(0.0, 0.5, fract(t * 0.1)) * (1.0 - smoothstep(0.85, 1.0, fract(t * 0.1)));
  var v = v0 + 0.4 * emit(p, vec2f(0.0), mix(0.2, 0.38, k.y)) * (0.3 + ramp);
  v *= 1.0 - mix(0.01, 0.05, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_white_hot(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.05, 0.24, k.x) * lap(p);
  let ctr = vec2f(0.0);
  let d = length(cen(p) - ctr);
  let radius = mix(0.22, 0.4, k.y);
  let core = exp(-(d * d) / (radius * radius));
  var v = v0 + 0.6 * core * flick(p, t) * (0.55 + k.y);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_twin(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.05, 0.24, k.x) * lap(p);
  let a = 0.28 * vec2f(cos(t * 0.7), sin(t * 0.9)); let b = -a;
  var v = v0 + 0.35 * (emit(p, a, mix(0.06, 0.11, k.y)) + emit(p, b, mix(0.06, 0.11, k.y))) * flick(p, t);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_triple(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.05, 0.24, k.x) * lap(p);
  var s = 0.0; for (var i: i32 = 0; i < 3; i++) { let a = f32(i) * 2.094 + t * 0.6; s += emit(p, 0.26 * vec2f(cos(a), sin(a)), mix(0.05, 0.1, k.y)); }
  var v = v0 + 0.34 * s * flick(p, t);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_line_sweep_h(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.05, 0.22, k.x) * lap(p);
  let xc = (fract(t * 0.15) * 2.0 - 1.0) * 0.45;
  let line = exp(-(cen(p).x - xc) * (cen(p).x - xc) / mix(0.001, 0.006, k.y));
  var v = v0 + 0.5 * line * flick(p, t);
  v *= 1.0 - mix(0.02, 0.07, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_line_sweep_v(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.05, 0.22, k.x) * lap(p);
  let yc = (fract(t * 0.13) * 2.0 - 1.0) * 0.45;
  let line = exp(-(cen(p).y - yc) * (cen(p).y - yc) / mix(0.001, 0.006, k.y));
  var v = v0 + 0.5 * line * flick(p, t);
  v *= 1.0 - mix(0.02, 0.07, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_rain(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.06, 0.2, k.x) * lap(p);
  var v = v0 + step(1.0 - mix(0.002, 0.02, k.y), rnd(p, floor(t * 8.0))) * 0.9;
  v *= 1.0 - mix(0.02, 0.07, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_scatter(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.05, 0.22, k.x) * lap(p);
  var s = 0.0; for (var i: i32 = 0; i < 5; i++) { let r = rnd(vec2i(i, 0), 3.0); let a = rnd(vec2i(i, 1), 3.0); s += emit(p, 0.35 * vec2f(cos(a * TAU), sin(a * TAU)) * r, mix(0.05, 0.1, k.y)); }
  var v = v0 + 0.3 * s * (0.5 + 0.5 * sin(t * 1.5));
  v *= 1.0 - mix(0.01, 0.05, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_chase(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.05, 0.24, k.x) * lap(p);
  let ctr = 0.36 * vec2f(cos(t * 2.2), sin(t * 2.2));
  let d = length(cen(p) - ctr);
  let radius = mix(0.04, 0.08, k.y) * (0.85 + 0.15 * sin(t * 5.0 + d * 40.0));
  let core = exp(-(d * d) / (radius * radius));
  var v = v0 + 0.5 * core * flick(p, t) * (0.55 + k.y);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_ring_source(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.05, 0.22, k.x) * lap(p);
  let rr = 0.2 + 0.12 * sin(t * 1.2);
  let ring = exp(-(length(cen(p)) - rr) * (length(cen(p)) - rr) / mix(0.001, 0.006, k.y));
  var v = v0 + 0.4 * ring * flick(p, t);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_pulse_grid(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.05, 0.2, k.x) * lap(p);
  let g = fract(cen(p) * mix(3.0, 6.0, k.y)) - 0.5;
  let dot = exp(-dot(g, g) * 30.0) * (0.5 + 0.5 * sin(t * 2.0 + length(cen(p)) * 12.0));
  var v = v0 + 0.35 * dot;
  v *= 1.0 - mix(0.02, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_quench_fade(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.06, 0.22, k.x) * lap(p);
  let on = smoothstep(0.5, 0.35, fract(t * 0.15));
  var v = v0 + 0.4 * emit(p, 0.2 * vec2f(cos(t * 0.7), sin(t * 0.9)), mix(0.08, 0.16, k.y)) * on;
  v *= 1.0 - mix(0.03, 0.1, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_hard_quench(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.05, 0.24, k.x) * lap(p);
  let ctr = 0.24 * vec2f(cos(t * 0.8), sin(t * 0.6));
  let d = length(cen(p) - ctr);
  let radius = mix(0.06, 0.13, k.y) * (0.85 + 0.15 * sin(t * 5.0 + d * 40.0));
  let core = exp(-(d * d) / (radius * radius));
  var v = v0 + 0.5 * core * flick(p, t) * (0.55 + k.y);
  v *= 1.0 - mix(0.06, 0.16, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_receding(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.05, 0.24, k.x) * lap(p);
  let ctr = vec2f(0.0);
  let d = length(cen(p) - ctr);
  let radius = mix(0.04, 0.24, k.y) * (0.4 + 0.6 * abs(sin(t * 0.4)));
  let core = exp(-(d * d) / (radius * radius));
  var v = v0 + 0.4 * core * flick(p, t) * (0.55 + k.y);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_flicker_die(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.05, 0.2, k.x) * lap(p);
  let gate = 0.5 + 0.5 * sin(t * 3.0 + rnd(vec2i(i32(t * 4.0), 0), 1.0) * 6.0);
  var v = v0 + 0.4 * emit(p, vec2f(0.0), mix(0.1, 0.2, k.y)) * gate * gate;
  v *= 1.0 - mix(0.03, 0.09, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_cool_wave(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.06, 0.22, k.x) * lap(p);
  var v = v0 + 0.4 * emit(p, vec2f(0.0), mix(0.15, 0.3, k.y));
  let cx = (fract(t * 0.12) * 2.0 - 1.0);
  v *= 1.0 - mix(0.02, 0.1, k.z) * (1.0 + 2.0 * smoothstep(cx + 0.2, cx - 0.2, cen(p).x));
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_ember_die(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.04, 0.16, k.x) * lap(p);
  var v = v0 + step(1.0 - mix(0.002, 0.01, k.y), rnd(p, floor(t * 4.0))) * 0.8;
  v *= 1.0 - mix(0.04, 0.12, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_gutter(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.05, 0.24, k.x) * lap(p);
  let ctr = 0.2 * vec2f(sin(t * 0.9), cos(t * 1.3));
  let d = length(cen(p) - ctr);
  let radius = mix(0.07, 0.15, k.y) * (0.85 + 0.15 * sin(t * 5.0 + d * 40.0));
  let core = exp(-(d * d) / (radius * radius));
  var v = v0 + 0.35 * core * flick(p, t) * (0.55 + k.y);
  v *= 1.0 - mix(0.04, 0.11, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_breathe(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.08, 0.24, k.x) * lap(p);
  let br = 0.5 + 0.5 * sin(t * mix(0.5, 1.5, k.y));
  var v = v0 + 0.4 * emit(p, vec2f(0.0), 0.3) * br;
  v *= 1.0 - mix(0.03, 0.08, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_grain_h(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.05, 0.2, k.x) * lapAniso(p, mix(1.0, 3.0, k.y), 0.3);
  var v = v0 + 0.35 * emit(p, 0.25 * vec2f(cos(t * 0.7), sin(t * 0.9)), 0.09) * flick(p, t);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_grain_v(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.05, 0.2, k.x) * lapAniso(p, 0.3, mix(1.0, 3.0, k.y));
  var v = v0 + 0.35 * emit(p, 0.25 * vec2f(cos(t * 0.7), sin(t * 0.9)), 0.09) * flick(p, t);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_weave(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let bias = select(vec2f(mix(1.0, 3.0, k.y), 0.4), vec2f(0.4, mix(1.0, 3.0, k.y)), (p.x / 8 + p.y / 8) % 2 == 0);
  let T = ld(p).x; let v0 = T + mix(0.05, 0.2, k.x) * lapAniso(p, bias.x, bias.y);
  var v = v0 + 0.35 * emit(p, vec2f(0.0), 0.2);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_streaky(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let ax = 0.4 + mix(0.0, 2.6, k.y) * (0.5 + 0.5 * sin(cen(p).y * 30.0));
  let T = ld(p).x; let v0 = T + mix(0.05, 0.2, k.x) * lapAniso(p, ax, 0.4);
  var v = v0 + 0.35 * emit(p, 0.22 * vec2f(cos(t * 0.6), sin(t * 0.8)), 0.1) * flick(p, t);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_fiber(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let ay = 0.4 + mix(0.0, 2.6, k.y) * (0.5 + 0.5 * sin(cen(p).x * 34.0));
  let T = ld(p).x; let v0 = T + mix(0.05, 0.2, k.x) * lapAniso(p, 0.4, ay);
  var v = v0 + 0.35 * emit(p, vec2f(0.0), 0.15);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_layered(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.05, 0.2, k.x) * lapAniso(p, mix(1.5, 3.0, k.y), 0.2);
  var v = v0 + 0.4 * emit(p, 0.2 * vec2f(cos(t * 0.5), 0.0) + vec2f(0.0, sin(t * 0.6) * 0.2), 0.08) * flick(p, t);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_rolled(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.06, 0.22, k.x) * lapAniso(p, mix(1.2, 3.2, k.y), 0.5);
  var v = v0 + 0.45 * emit(p, vec2f(-0.35, 0.0), mix(0.1, 0.2, k.y));
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_diagonal(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let ld0 = ld(p).x;
  let dg = ld(p + vec2i(1, 1)).x + ld(p - vec2i(1, 1)).x - 2.0 * ld0;
  let T = ld0; let v0 = T + mix(0.05, 0.2, k.x) * (lap(p) * 0.4 + dg * mix(0.5, 1.6, k.y));
  var v = v0 + 0.35 * emit(p, 0.25 * vec2f(cos(t * 0.7), sin(t * 0.7)), 0.1) * flick(p, t);
  v *= 1.0 - mix(0.01, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_advect_swirl(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let vel = swirl(cen(p), t) * mix(0.5, 3.0, k.w) * f32(N);
  let T = advectT(p, vel * 0.02); let v0 = T + mix(0.03, 0.12, k.x) * lap(p);
  var v = v0 + 0.35 * emit(p, 0.2 * vec2f(cos(t * 0.6), sin(t * 0.8)), mix(0.06, 0.12, k.y)) * flick(p, t);
  v *= 1.0 - mix(0.01, 0.05, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_vortex(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let c = cen(p); let vel = vec2f(-c.y, c.x) / (length(c) + 0.06) * mix(0.5, 2.5, k.w) * f32(N);
  let T = advectT(p, vel * 0.02); let v0 = T + mix(0.03, 0.1, k.x) * lap(p);
  var v = v0 + 0.35 * emit(p, vec2f(0.22, 0.0), mix(0.06, 0.12, k.y)) * flick(p, t);
  v *= 1.0 - mix(0.01, 0.05, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_boil(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let c = cen(p); let vel = vec2f(sin(c.y * 12.0 + t * mix(1.0, 3.0, k.w)), cos(c.x * 12.0 - t * mix(1.0, 3.0, k.w))) * f32(N);
  let T = advectT(p, vel * 0.015); let v0 = T + mix(0.03, 0.12, k.x) * lap(p);
  var v = v0 + 0.35 * emit(p, vec2f(0.0), mix(0.14, 0.3, k.y)) * flick(p, t);
  v *= 1.0 - mix(0.01, 0.05, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_curl_drift(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let vel = (swirl(cen(p), t) + vec2f(0.15, 0.0)) * mix(0.5, 2.5, k.w) * f32(N);
  let T = advectT(p, vel * 0.02); let v0 = T + mix(0.03, 0.12, k.x) * lap(p);
  var v = v0 + 0.35 * emit(p, vec2f(-0.3, 0.0), mix(0.07, 0.13, k.y)) * flick(p, t);
  v *= 1.0 - mix(0.01, 0.05, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_eddies(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let c = cen(p); let vel = (vec2f(-c.y, c.x) / (length(c) + 0.1) + 0.4 * vec2f(sin(c.y * 20.0 + t), cos(c.x * 20.0 - t))) * mix(0.5, 2.0, k.w) * f32(N);
  let T = advectT(p, vel * 0.018); let v0 = T + mix(0.03, 0.1, k.x) * lap(p);
  var v = v0 + 0.35 * emit(p, 0.2 * vec2f(cos(t * 0.5), sin(t * 0.7)), 0.1) * flick(p, t);
  v *= 1.0 - mix(0.01, 0.05, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_plume_rise(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let c = cen(p); let vel = (vec2f(0.0, mix(0.3, 1.2, k.w)) + 0.3 * vec2f(sin(c.y * 8.0 + t), 0.0)) * f32(N);
  let T = advectT(p, vel * 0.02); let v0 = T + mix(0.03, 0.12, k.x) * lap(p);
  var v = v0 + 0.4 * emit(p, vec2f(0.0, -0.35), mix(0.08, 0.16, k.y)) * flick(p, t);
  v *= 1.0 - mix(0.01, 0.05, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_convection(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let c = cen(p); let vel = vec2f(sin(c.x * 6.0) * cos(c.y * 6.0), -cos(c.x * 6.0) * sin(c.y * 6.0)) * mix(0.5, 2.5, k.w) * f32(N);
  let T = advectT(p, vel * 0.02); let v0 = T + mix(0.03, 0.12, k.x) * lap(p);
  var v = v0 + 0.35 * emit(p, vec2f(0.0, -0.3), mix(0.1, 0.2, k.y));
  v *= 1.0 - mix(0.01, 0.05, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_storm(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let c = cen(p); let vel = (swirl(c, t) + swirl(c * 2.3 + 4.0, t * 1.4) * 0.6) * mix(0.6, 3.0, k.w) * f32(N);
  let T = advectT(p, vel * 0.02); let v0 = T + mix(0.03, 0.1, k.x) * lap(p);
  var v = v0 + 0.35 * emit(p, 0.2 * vec2f(cos(t * 0.9), sin(t * 1.2)), 0.1) * flick(p, t);
  v *= 1.0 - mix(0.01, 0.05, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_smoke_heat(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let c = cen(p); let vel = (vec2f(0.0, mix(0.2, 0.9, k.w)) + 0.4 * swirl(c, t)) * f32(N);
  let T = advectT(p, vel * 0.02); let v0 = T + mix(0.03, 0.12, k.x) * lap(p);
  var v = v0 + 0.35 * emit(p, vec2f(sin(t * 0.5) * 0.2, -0.35), mix(0.08, 0.15, k.y)) * flick(p, t);
  v *= 1.0 - mix(0.02, 0.06, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_combustion(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.04, 0.12, k.x) * lap(p);
  var v = v0 + mix(0.5, 1.6, k.w) * v0 * (1.0 - v0) * step(0.12, v0);
  v += 0.5 * emit(p, vec2f(0.0), mix(0.03, 0.07, k.y)) * flick(p, t);
  v *= 1.0 - mix(0.02, 0.08, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_fire_front(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.04, 0.12, k.x) * lap(p);
  var v = v0 + mix(0.6, 1.8, k.w) * v0 * (1.0 - v0) * step(0.1, v0);
  v += 0.6 * emit(p, vec2f(-0.4, 0.0), mix(0.03, 0.06, k.y));
  v *= 1.0 - mix(0.02, 0.07, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_kpp_spread(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.05, 0.15, k.x) * lap(p);
  var v = v0 + mix(0.3, 1.2, k.w) * v0 * (1.0 - v0);
  v += 0.4 * emit(p, 0.25 * vec2f(cos(t * 0.4), sin(t * 0.5)), mix(0.03, 0.07, k.y)) * flick(p, t);
  v *= 1.0 - mix(0.02, 0.07, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_ignite_wander(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.04, 0.12, k.x) * lap(p);
  var v = v0 + mix(0.5, 1.5, k.w) * v0 * (1.0 - v0) * step(0.14, v0);
  v += 0.5 * emit(p, 0.3 * vec2f(cos(t * 0.7), sin(t * 0.9)), mix(0.03, 0.06, k.y)) * flick(p, t);
  v *= 1.0 - mix(0.03, 0.09, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_flare(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.04, 0.12, k.x) * lap(p);
  var v = v0 + mix(0.5, 1.6, k.w) * v0 * (1.0 - v0) * step(0.12, v0);
  v += 0.7 * emit(p, vec2f(0.0), 0.05) * pow(0.5 + 0.5 * sin(t * 1.5), 3.0);
  v *= 1.0 - mix(0.03, 0.09, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_autocatalytic(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.05, 0.14, k.x) * lap(p);
  var v = v0 + mix(0.8, 2.0, k.w) * v0 * (1.0 - v0);
  v += 0.4 * emit(p, vec2f(0.0), mix(0.04, 0.08, k.y)) * flick(p, t);
  v *= 1.0 - mix(0.01, 0.05, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_wildfire(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.04, 0.12, k.x) * lap(p);
  var v = v0 + mix(0.6, 1.8, k.w) * v0 * (1.0 - v0) * step(0.1, v0);
  v += step(1.0 - mix(0.001, 0.008, k.y), rnd(p, floor(t * 3.0))) * 0.8;
  v *= 1.0 - mix(0.02, 0.08, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn cs_chain(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy); if (p.x >= N || p.y >= N) { return; }
  if (u.reset > 0.5) { textureStore(dst, p, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let t = u.time; let k = u.k;
  let T = ld(p).x; let v0 = T + mix(0.05, 0.14, k.x) * lap(p);
  var v = v0 + mix(0.5, 1.6, k.w) * v0 * (1.0 - v0) * step(0.12, v0);
  let rr = fract(t * 0.2) * 0.6;
  v += 0.6 * exp(-(length(cen(p)) - rr) * (length(cen(p)) - rr) / mix(0.001, 0.005, k.y));
  v *= 1.0 - mix(0.02, 0.08, k.z);
  textureStore(dst, p, vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0));
}

// ─────────────────────────────────────────────── present: temperature → metal color
@group(0) @binding(0) var<uniform> pu: SimU;
@group(0) @binding(1) var pTex: texture_2d<f32>;
@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(p[i], 0.0, 1.0);
}
// Inferno colormap (matplotlib), 7th-order polynomial fit.
fn inferno(t: f32) -> vec3f {
    let x = clamp(t, 0.0, 1.0);
    return vec3f(0.00021894, 0.00165100, -0.01948090)
      + x * (vec3f(0.10651342, 0.56395644, 3.93271239)
      + x * (vec3f(11.60249308, -3.97285397, -15.94239411)
      + x * (vec3f(-41.70399613, 17.43639888, 44.35414520)
      + x * (vec3f(77.16293570, -33.40235894, -81.80730926)
      + x * (vec3f(-71.31942824, 32.62606426, 73.20951986)
      + x * (vec3f(25.13112622, -12.24266895, -23.07032500)))))));
}
fn pMagma(x: f32) -> vec3f {
    let t = clamp(x, 0.0, 1.0);
    var c = mix(vec3f(0.001, 0.0, 0.014), vec3f(0.12, 0.06, 0.28), smoothstep(0.0, 0.22, t));
    c = mix(c, vec3f(0.42, 0.11, 0.42), smoothstep(0.2, 0.42, t));
    c = mix(c, vec3f(0.78, 0.24, 0.36), smoothstep(0.4, 0.6, t));
    c = mix(c, vec3f(0.98, 0.55, 0.32), smoothstep(0.58, 0.78, t));
    c = mix(c, vec3f(0.99, 0.86, 0.62), smoothstep(0.76, 0.94, t));
    return mix(c, vec3f(1.0, 0.99, 0.9), smoothstep(0.92, 1.0, t));
}
fn pForge(x: f32) -> vec3f {
    let t = clamp(x, 0.0, 1.0);
    var c = mix(vec3f(0.02, 0.0, 0.0), vec3f(0.5, 0.03, 0.01), smoothstep(0.0, 0.2, t));
    c = mix(c, vec3f(0.92, 0.18, 0.02), smoothstep(0.18, 0.42, t));
    c = mix(c, vec3f(1.0, 0.55, 0.08), smoothstep(0.4, 0.62, t));
    c = mix(c, vec3f(1.0, 0.85, 0.35), smoothstep(0.6, 0.82, t));
    return mix(c, vec3f(1.0, 1.0, 0.95), smoothstep(0.82, 1.0, t));
}
fn pEmber(x: f32) -> vec3f {
    let t = clamp(x, 0.0, 1.0);
    var c = mix(vec3f(0.02, 0.0, 0.0), vec3f(0.35, 0.03, 0.01), smoothstep(0.0, 0.3, t));
    c = mix(c, vec3f(0.75, 0.14, 0.02), smoothstep(0.28, 0.55, t));
    c = mix(c, vec3f(0.98, 0.42, 0.08), smoothstep(0.52, 0.8, t));
    return mix(c, vec3f(1.0, 0.68, 0.28), smoothstep(0.8, 1.0, t));
}
fn pPlasma(x: f32) -> vec3f {
    let t = clamp(x, 0.0, 1.0);
    var c = mix(vec3f(0.05, 0.03, 0.53), vec3f(0.4, 0.0, 0.66), smoothstep(0.0, 0.28, t));
    c = mix(c, vec3f(0.72, 0.18, 0.53), smoothstep(0.26, 0.5, t));
    c = mix(c, vec3f(0.93, 0.47, 0.29), smoothstep(0.48, 0.72, t));
    c = mix(c, vec3f(0.98, 0.79, 0.19), smoothstep(0.7, 0.92, t));
    return mix(c, vec3f(0.99, 0.95, 0.6), smoothstep(0.9, 1.0, t));
}
fn pCopper(x: f32) -> vec3f {
    let t = clamp(x, 0.0, 1.0);
    var c = mix(vec3f(0.01, 0.0, 0.0), vec3f(0.24, 0.09, 0.04), smoothstep(0.0, 0.25, t));
    c = mix(c, vec3f(0.58, 0.27, 0.13), smoothstep(0.22, 0.5, t));
    c = mix(c, vec3f(0.87, 0.53, 0.3), smoothstep(0.48, 0.74, t));
    c = mix(c, vec3f(1.0, 0.82, 0.58), smoothstep(0.72, 0.92, t));
    return mix(c, vec3f(1.0, 0.96, 0.86), smoothstep(0.9, 1.0, t));
}
fn pSteel(x: f32) -> vec3f {
    let t = clamp(x, 0.0, 1.0);
    var c = mix(vec3f(0.0, 0.0, 0.0), vec3f(0.35, 0.03, 0.01), smoothstep(0.0, 0.2, t));
    c = mix(c, vec3f(0.95, 0.4, 0.1), smoothstep(0.18, 0.42, t));
    c = mix(c, vec3f(1.0, 0.9, 0.6), smoothstep(0.4, 0.62, t));
    c = mix(c, vec3f(0.85, 0.92, 1.0), smoothstep(0.62, 0.82, t));
    return mix(c, vec3f(0.7, 0.85, 1.0), smoothstep(0.82, 1.0, t));
}
fn pGold(x: f32) -> vec3f {
    let t = clamp(x, 0.0, 1.0);
    var c = mix(vec3f(0.02, 0.0, 0.0), vec3f(0.2, 0.1, 0.0), smoothstep(0.0, 0.22, t));
    c = mix(c, vec3f(0.55, 0.32, 0.03), smoothstep(0.2, 0.45, t));
    c = mix(c, vec3f(0.88, 0.64, 0.12), smoothstep(0.43, 0.68, t));
    c = mix(c, vec3f(1.0, 0.88, 0.45), smoothstep(0.66, 0.88, t));
    return mix(c, vec3f(1.0, 1.0, 0.9), smoothstep(0.86, 1.0, t));
}
fn palette(mode: i32, t: f32) -> vec3f {
    if (mode == 0) { return inferno(t); }
    else if (mode == 1) { return pMagma(t); }
    else if (mode == 2) { return pForge(t); }
    else if (mode == 3) { return pEmber(t); }
    else if (mode == 4) { return pPlasma(t); }
    else if (mode == 5) { return pCopper(t); }
    else if (mode == 6) { return pSteel(t); }
    return pGold(t);
}
fn cell_state(fp: vec2f) -> vec4f {
    let pos = fp / pu.pixelScale; let uv = (pos - 0.5 * pu.size) / max(min(pu.size.x, pu.size.y), 1.0) + 0.5;
    return textureLoad(pTex, clamp(vec2i(uv * f32(N)), vec2i(0), vec2i(N - 1)), 0);
}
@fragment fn fs_present(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = cell_state(fp.xy); let mode = i32(pu.reset);   // present reuses the reset slot as the palette mode
    let t = clamp(s.x, 0.0, 1.0);
    var c = palette(mode, t);
    // white-hot core: the hottest metal over-saturates toward white, like real emission
    c += vec3f(1.0, 0.92, 0.75) * smoothstep(0.72, 1.0, t) * 1.5;
    return vec4f(c, 1.0);
}
