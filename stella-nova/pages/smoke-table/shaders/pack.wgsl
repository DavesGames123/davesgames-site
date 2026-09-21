// ═══════════════════════════════════════════════════════════════════════════
//  SMOKE TABLE  ·  one fragment shader per cell, procedural smoke each. Every
//  cell reads uv (x centered, y 0 floor .. 1 top), the hover clock t and four
//  knobs k, then returns smokePresent(density, uv). Density runs through
//  smokeCol, a ramp from the smoke swatch to the lit swatch over a dark
//  backdrop, so the palette drives all cells. Noise after Perlin (pcg3d
//  hashing); billow is 1 - turbulence; the swirl is a curl of fbm; the sheets
//  follow the caustics idea. The plume, fog, drift, ring and diffusion cores
//  are single-pass fakes of the compute smoke sims.
// ═══════════════════════════════════════════════════════════════════════════
const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.283185307179586;

struct SmokeU {
    size: vec2f, time: f32, pixelScale: f32,
    ink: vec4f, tone: vec4f, cream: vec4f,
    exposure: f32, contrast: f32, glow: f32, pad1: f32,
    k: vec4f,
};
@group(0) @binding(0) var<uniform> u: SmokeU;

@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(p[i], 0.0, 1.0);
}

// x centered, y 0 at the floor and 1 at the top (square cells)
fn fuv(fp: vec2f) -> vec2f {
    let p = fp / max(u.pixelScale, 0.001);
    let n = (p - 0.5 * u.size) / max(min(u.size.x, u.size.y), 1.0);
    return vec2f(n.x, 0.5 - n.y);
}

// ── hashing and Perlin noise ────────────────────────────────────────────────
fn fade2(t: vec2f) -> vec2f { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
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
fn grad2(i: vec2i, seed: u32) -> vec2f { let a = h21(i, seed) * TAU; return vec2f(cos(a), sin(a)); }
fn pnoise(p: vec2f, seed: u32) -> f32 {
    let i = vec2i(floor(p)); let f = fract(p); let w = fade2(f);
    let a = dot(grad2(i, seed), f);
    let b = dot(grad2(i + vec2i(1, 0), seed), f - vec2f(1.0, 0.0));
    let c = dot(grad2(i + vec2i(0, 1), seed), f - vec2f(0.0, 1.0));
    let d = dot(grad2(i + vec2i(1, 1), seed), f - vec2f(1.0, 1.0));
    return mix(mix(a, b, w.x), mix(c, d, w.x), w.y) * 1.414;
}
fn rot2(a: f32) -> mat2x2f { let c = cos(a); let s = sin(a); return mat2x2f(c, s, -s, c); }

fn fbm(p0: vec2f, oct: i32, seed: u32) -> f32 {
    var p = p0; var a = 0.5; var s = 0.0; var nrm = 0.0;
    for (var i: i32 = 0; i < 8; i++) { if (i >= oct) { break; } s += a * pnoise(p, seed + u32(i)); nrm += a; a *= 0.5; p = rot2(0.5) * p * 2.0; }
    return s / max(nrm, 1e-4);
}
fn fbm01(p: vec2f, oct: i32, seed: u32) -> f32 { return 0.5 + 0.5 * fbm(p, oct, seed); }
fn turb(p0: vec2f, oct: i32, seed: u32) -> f32 {
    var p = p0; var a = 0.5; var s = 0.0; var nrm = 0.0;
    for (var i: i32 = 0; i < 8; i++) { if (i >= oct) { break; } s += a * abs(pnoise(p, seed + u32(i))); nrm += a; a *= 0.5; p = rot2(0.5) * p * 2.0; }
    return s / max(nrm, 1e-4);
}
fn ridged(p: vec2f, oct: i32, seed: u32) -> f32 { let v = 1.0 - turb(p, oct, seed); return v * v; }
fn billow(p: vec2f, oct: i32, seed: u32) -> f32 { return clamp(1.0 - turb(p, oct, seed), 0.0, 1.0); }

// curl of an fbm scalar field: a smooth, divergence-free swirl
fn curl(p: vec2f, seed: u32) -> vec2f {
    let e = 0.01;
    let n1 = fbm(p + vec2f(0.0, e), 4, seed); let n2 = fbm(p - vec2f(0.0, e), 4, seed);
    let n3 = fbm(p + vec2f(e, 0.0), 4, seed); let n4 = fbm(p - vec2f(e, 0.0), 4, seed);
    return vec2f(n1 - n2, -(n3 - n4)) / (2.0 * e);
}
fn sheets(p0: vec2f, t: f32, iters: i32) -> f32 {
    var q = p0; var s = 0.0;
    for (var i: i32 = 0; i < 6; i++) { if (i >= iters) { break; }
        q = rot2(0.9) * q + vec2f(sin(t * 0.7 + f32(i)), cos(t * 0.5 - f32(i))) * 0.4;
        s += abs(sin(q.x * 2.0 + t) + sin(q.y * 2.3 - t * 0.8));
    }
    return pow(clamp(1.0 - s * 0.1, 0.0, 1.0), 2.0);
}

// ── the smoke palette and the finisher ──────────────────────────────────────
fn smokeCol(d: f32) -> vec3f { return mix(u.tone.rgb, u.cream.rgb, smoothstep(0.15, 1.0, clamp(d, 0.0, 1.0))); }
fn smokePresent(density: f32, uv: vec2f) -> vec4f {
    var dd = (density - 0.5) * u.contrast + 0.5;
    dd = max(dd, 0.0) * u.exposure;
    let bg = u.ink.rgb * (0.75 + 0.9 * clamp(uv.y, 0.0, 1.0));
    let a = smoothstep(0.03, 0.55, dd);
    var col = mix(bg, smokeCol(dd), a);
    col += u.cream.rgb * max(dd - 1.0, 0.0) * 0.3 * u.glow;
    return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}
fn posth(v: f32, n: f32) -> f32 { return floor(v * n + 0.5) / n; }

// ── smoke cores ─────────────────────────────────────────────────────────────
fn plumeD(uv: vec2f, t: f32, wid: f32, rise: f32, curls: f32) -> f32 {
    let spread = 0.2 + 0.95 * uv.y;
    let sx = wid * spread + 0.04;
    var p = vec2f(uv.x / sx, uv.y * 1.7 - t * rise);
    p += curl(p * 0.8 + vec2f(0.0, t * 0.1), 71u) * curls;
    let d = billow(p, 5, 3u);
    let prof = exp(-(uv.x * uv.x) / (sx * sx * 1.6));
    let taper = smoothstep(1.35, -0.05, uv.y);
    return clamp(prof * (0.28 + 1.15 * d) * taper - uv.y * 0.06, 0.0, 1.6);
}
fn billowD(uv: vec2f, t: f32, sc: f32, drift: f32, oct: i32) -> f32 {
    let p = vec2f(uv.x * sc, uv.y * sc - t * drift);
    return billow(p, oct, 8u) * 1.15;
}
fn fogD(uv: vec2f, t: f32, height: f32, soft: f32) -> f32 {
    let n = fbm01(vec2f(uv.x * 2.2 - t * 0.15, uv.y * 3.0 + t * 0.05), 5, 8u);
    let band = smoothstep(height + soft, height - soft, uv.y);
    return clamp(band * (0.4 + 0.9 * n), 0.0, 1.4);
}
fn driftD(uv: vec2f, t: f32, sp: f32, sc: f32) -> f32 {
    var p = vec2f(uv.x * sc - t * sp, uv.y * sc * 0.8);
    p += curl(p * 0.6, 51u) * 0.4;
    return clamp(billow(p, 5, 17u) * 1.1, 0.0, 1.4);
}
fn wispD(uv: vec2f, t: f32, sc: f32, sharp: f32) -> f32 {
    var p = vec2f(uv.x * sc, uv.y * sc - t * 0.6);
    p += curl(p * 0.9 + vec2f(0.0, t * 0.15), 61u) * 0.8;
    let r = ridged(p, 5, 13u);
    let taper = smoothstep(1.3, -0.05, uv.y);
    return clamp(pow(r, sharp) * taper * 1.7, 0.0, 1.5);
}
fn ringD(uv: vec2f, t: f32, speed: f32, thick: f32) -> f32 {
    let life = fract(t * speed);
    let c = uv - vec2f(0.0, 0.15 + life * 0.7);
    let rr = length(c * vec2f(1.0, 1.3));
    let n = fbm01(uv * 4.0 + vec2f(0.0, t * 0.1), 4, 8u);
    let ring = smoothstep(thick, 0.0, abs(rr - 0.16));
    return clamp(ring * (0.5 + 0.8 * n) * (1.0 - life * 0.7), 0.0, 1.4);
}
fn diffuseD(uv: vec2f, t: f32, amt: f32) -> f32 {
    var p = uv * 3.0;
    p += curl(p * 0.7 + vec2f(0.0, t * 0.08), 91u) * (0.6 + amt);
    let d = fbm01(p, 5, 21u);
    return clamp(smoothstep(0.35, 0.75, d) * 1.3, 0.0, 1.5);
}

// ── the 60 smoke cells ───────────────────────────────────────────────────────
@fragment fn fs_chimney(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  return smokePresent(plumeD(uv, t, mix(0.08, 0.14, k.x), mix(1.0, 1.8, k.z), 0.3 + 0.6 * k.y), uv);
}

@fragment fn fs_column(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  return smokePresent(plumeD(uv, t, mix(0.14, 0.24, k.x), mix(0.9, 1.7, k.z), 0.4 + 0.7 * k.y), uv);
}

@fragment fn fs_billow_stack(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var d = plumeD(uv, t, mix(0.16, 0.3, k.x), mix(0.9, 1.6, k.z), 0.5);
  d = max(d, billowD(uv, t, mix(3.0, 5.0, k.y), 0.8, 5) * smoothstep(1.2, 0.0, uv.y) * 0.8);
  return smokePresent(d, uv);
}

@fragment fn fs_wispy_plume(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let d = plumeD(uv, t, mix(0.12, 0.22, k.x), mix(1.0, 1.8, k.z), 0.8 + 0.8 * k.y);
  return smokePresent(d, uv);
}

@fragment fn fs_twin_plume(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let g = mix(0.12, 0.28, k.x);
  var d = plumeD(uv + vec2f(g, 0.0), t, 0.13, mix(1.0, 1.7, k.z), 0.5 + 0.5 * k.y);
  d = max(d, plumeD(uv - vec2f(g, 0.0), t + 3.0, 0.13, mix(1.0, 1.7, k.z), 0.5 + 0.5 * k.y));
  return smokePresent(d, uv);
}

@fragment fn fs_industrial(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let d = plumeD(uv, t, mix(0.2, 0.34, k.x), mix(0.8, 1.5, k.z), 0.5);
  return smokePresent(d * (1.1 + 0.4 * k.y) - 0.05, uv);
}

@fragment fn fs_steam(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let d = plumeD(uv, t, mix(0.07, 0.13, k.x), mix(1.4, 2.4, k.z), 0.6 + 0.7 * k.y);
  return smokePresent(d * 0.7 + 0.05, uv);
}

@fragment fn fs_backpuff(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let puff = 0.7 + 0.5 * sin(uv.y * 5.0 - t * mix(2.0, 5.0, k.y));
  return smokePresent(plumeD(uv, t, mix(0.14, 0.26, k.x), mix(0.9, 1.6, k.z), 0.5) * puff, uv);
}

@fragment fn fs_lazy(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  return smokePresent(plumeD(vec2f(uv.x, uv.y * 1.3), t, mix(0.16, 0.28, k.x), mix(0.4, 0.9, k.z), 0.6 + 0.8 * k.y), uv);
}

@fragment fn fs_puff(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  return smokePresent(billowD(uv, t, mix(2.0, 5.0, k.x), mix(0.3, 1.0, k.z), i32(mix(4.0, 6.0, k.y))), uv);
}

@fragment fn fs_cauliflower(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var d = billowD(uv, t, mix(3.0, 6.0, k.x), mix(0.4, 1.0, k.y), 6);
  d = d * (0.6 + 0.6 * billowD(uv, t + 4.0, mix(6.0, 10.0, k.x), 0.5, 4));
  return smokePresent(d * 1.2, uv);
}

@fragment fn fs_rolling(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let p = rot2(uv.y * mix(1.0, 3.0, k.y)) * vec2f(uv.x, uv.y);
  return smokePresent(billow(vec2f(p.x * mix(2.5, 5.0, k.x), p.y * mix(2.5, 5.0, k.x) - t * mix(0.4, 1.0, k.z)), 5, 8u) * 1.15, uv);
}

@fragment fn fs_thunderhead(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let d = billowD(uv, t, mix(1.4, 3.0, k.x), mix(0.2, 0.7, k.z), 5);
  return smokePresent(d * (1.2 + 0.5 * k.y) * smoothstep(-0.1, 0.6, uv.y), uv);
}

@fragment fn fs_cotton(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let d = billowD(uv, t, mix(2.0, 4.0, k.x), mix(0.3, 0.8, k.z), 4);
  return smokePresent(smoothstep(0.1, 0.9, d) * 0.9 + 0.06, uv);
}

@fragment fn fs_turbulent(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  return smokePresent(billowD(uv, t, mix(3.0, 6.0, k.x), mix(0.6, 1.4, k.z), i32(mix(6.0, 8.0, k.y))), uv);
}

@fragment fn fs_boil(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var p = vec2f(uv.x, uv.y) * mix(3.0, 6.0, k.x);
  p += curl(p * 0.7 + vec2f(0.0, t * mix(0.3, 1.0, k.y)), 71u) * 0.7;
  return smokePresent(billow(p, 5, 8u) * 1.2, uv);
}

@fragment fn fs_mushroom_cap(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let stem = plumeD(uv, t, mix(0.08, 0.16, k.y), mix(0.9, 1.6, k.z), 0.4);
  let cy = uv.y - mix(0.55, 0.8, k.x);
  let cap = exp(-(uv.x * uv.x * 2.5 + cy * cy * 12.0)) * (0.6 + 0.7 * billowD(uv, t, 4.0, 0.5, 5));
  return smokePresent(max(stem, cap * 1.2), uv);
}

@fragment fn fs_curl_wisp(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  return smokePresent(wispD(uv, t, mix(2.5, 5.0, k.x), mix(1.0, 3.0, k.y)), uv);
}

@fragment fn fs_tendrils(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var p = vec2f(uv.x * mix(3.0, 6.0, k.x), uv.y * mix(3.0, 6.0, k.x) - t * mix(0.5, 1.2, k.z));
  p += curl(p * 0.8, 61u) * 0.6;
  return smokePresent(pow(ridged(p, 6, 13u), mix(1.5, 3.5, k.y)) * smoothstep(1.3, -0.05, uv.y) * 1.8, uv);
}

@fragment fn fs_smoke_trail(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let lean = uv + vec2f(mix(0.1, 0.5, k.y) * uv.y, 0.0);
  return smokePresent(wispD(lean, t, mix(2.5, 5.0, k.x), 2.0), uv);
}

@fragment fn fs_incense(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let path = mix(0.1, 0.3, k.x) * sin(uv.y * 3.5 + t * 1.2);
  let x = (uv.x - path) / 0.06;
  var p = vec2f(x, uv.y * 4.0 - t * mix(0.8, 1.6, k.z));
  let d = (1.0 - smoothstep(0.0, 1.2, abs(x))) * pow(billow(p, 5, 3u), mix(1.0, 2.5, k.y));
  return smokePresent(d * smoothstep(1.2, -0.05, uv.y) * 1.6, uv);
}

@fragment fn fs_ribbon(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var p = vec2f(uv.x * mix(2.0, 4.0, k.x), uv.y * 2.5 - t * mix(0.6, 1.3, k.z));
  p += vec2f(sin(p.y * 1.5 + t) * mix(0.3, 1.0, k.y), 0.0);
  return smokePresent(billow(p, 5, 8u) * smoothstep(1.3, -0.05, uv.y) * 1.2, uv);
}

@fragment fn fs_lace(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  return smokePresent(wispD(uv, t, mix(5.0, 9.0, k.x), mix(2.0, 4.0, k.y)), uv);
}

@fragment fn fs_serpentine(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let path = mix(0.12, 0.32, k.x) * sin(uv.y * 3.0 + t * 1.4) + 0.08 * sin(uv.y * 7.0 - t);
  let x = (uv.x - path) / mix(0.1, 0.2, k.y);
  var p = vec2f(x, uv.y * 3.0 - t * mix(0.6, 1.3, k.z));
  let d = (1.0 - smoothstep(0.0, 1.3, abs(x))) * billow(p, 5, 3u);
  return smokePresent(d * smoothstep(1.2, -0.05, uv.y) * 1.5, uv);
}

@fragment fn fs_vanishing(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let d = wispD(uv, t, mix(3.0, 6.0, k.x), mix(1.5, 3.0, k.y));
  return smokePresent(d * smoothstep(mix(0.5, 0.9, k.z), 0.0, uv.y), uv);
}

@fragment fn fs_sidewind(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  return smokePresent(driftD(uv, t, mix(0.3, 1.0, k.x), mix(2.0, 4.0, k.y)), uv);
}

@fragment fn fs_gust(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let g = 1.0 + mix(0.0, 0.8, k.y) * sin(t * 1.5 + uv.x * 3.0);
  return smokePresent(driftD(uv, t * g, mix(0.4, 1.0, k.x), mix(2.0, 4.0, k.z)), uv);
}

@fragment fn fs_crosswind(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let sh = uv + vec2f(0.0, mix(0.1, 0.5, k.y) * uv.x);
  return smokePresent(driftD(sh, t, mix(0.3, 0.9, k.x), mix(2.0, 4.0, k.z)), uv);
}

@fragment fn fs_slow_haze(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  return smokePresent(driftD(uv, t, mix(0.1, 0.4, k.x), mix(1.2, 2.5, k.y)) * 0.9, uv);
}

@fragment fn fs_sweep(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  return smokePresent(driftD(uv, t, mix(0.8, 1.8, k.x), mix(2.5, 5.0, k.y)), uv);
}

@fragment fn fs_layered_drift(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var d = driftD(uv, t, mix(0.3, 0.9, k.x), mix(2.0, 4.0, k.z));
  d = max(d, driftD(uv + vec2f(0.0, 0.2), -t * (0.5 + 0.5 * k.y), 0.6, mix(1.5, 3.0, k.z)) * 0.8);
  return smokePresent(d, uv);
}

@fragment fn fs_smog_bank(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let d = driftD(uv, t, mix(0.2, 0.7, k.x), mix(2.0, 4.0, k.y));
  return smokePresent(d * smoothstep(mix(0.5, 0.9, k.z), 0.0, uv.y) * 1.3, uv);
}

@fragment fn fs_ground_fog(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  return smokePresent(fogD(uv, t, mix(0.2, 0.4, k.x), mix(0.1, 0.3, k.y)), uv);
}

@fragment fn fs_mist(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  return smokePresent(fogD(uv, t, mix(0.4, 0.7, k.x), mix(0.2, 0.4, k.y)) * 0.7 + 0.05, uv);
}

@fragment fn fs_valley_fog(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  return smokePresent(fogD(uv, t, mix(0.35, 0.6, k.x), mix(0.05, 0.2, k.y)) * 1.3, uv);
}

@fragment fn fs_rolling_fog(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let d = fogD(uv, t, mix(0.3, 0.55, k.x), 0.2) * 0.7 + driftD(uv, t, mix(0.2, 0.6, k.y), mix(2.0, 3.5, k.z)) * smoothstep(0.6, 0.0, uv.y) * 0.6;
  return smokePresent(d, uv);
}

@fragment fn fs_haze_layer(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let n = fbm01(uv * mix(2.0, 5.0, k.y) + vec2f(t * 0.1, 0.0), 4, 8u);
  return smokePresent(mix(0.1, 0.5, k.x) * (0.6 + 0.6 * n), uv);
}

@fragment fn fs_marsh(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let n = fbm01(vec2f(uv.x * mix(2.0, 4.0, k.y) - t * 0.1, uv.y * 3.0), 5, 8u);
  let d = smoothstep(mix(0.4, 0.6, k.x), 0.75, n) * smoothstep(0.6, 0.0, uv.y);
  return smokePresent(d * 1.3, uv);
}

@fragment fn fs_dawn_mist(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let d = fogD(uv, t, mix(0.4, 0.7, k.x), 0.3);
  return smokePresent(d * (0.7 + mix(0.0, 0.8, k.y) * uv.y), uv);
}

@fragment fn fs_smoke_ring(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  return smokePresent(ringD(uv, t, mix(0.15, 0.4, k.x), mix(0.05, 0.13, k.y)), uv);
}

@fragment fn fs_ring_train(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var d = ringD(uv, t, mix(0.2, 0.5, k.x), mix(0.05, 0.12, k.y));
  d = max(d, ringD(uv, t + 1.7, mix(0.2, 0.5, k.x), mix(0.05, 0.12, k.y)));
  d = max(d, ringD(uv, t + 3.4, mix(0.2, 0.5, k.x), mix(0.05, 0.12, k.y)));
  return smokePresent(d, uv);
}

@fragment fn fs_vortex(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = uv - vec2f(0.0, 0.4);
  let ang = atan2(c.y, c.x); let r = length(c);
  var p = vec2f(ang * 1.5 + r * 3.0 - t * mix(0.3, 1.0, k.x), r * mix(3.0, 6.0, k.y));
  p += curl(p * 0.5, 71u) * 0.6;
  return smokePresent(billow(p, 5, 8u) * smoothstep(0.85, 0.05, r) * 1.2, uv);
}

@fragment fn fs_puff_ring(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ring = ringD(uv, t, mix(0.15, 0.4, k.x), 0.12);
  let fill = billowD(uv, t, 4.0, 0.6, 5) * mix(0.3, 0.8, k.y) * smoothstep(1.1, 0.0, uv.y);
  return smokePresent(max(ring, fill * 0.8), uv);
}

@fragment fn fs_halo(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  return smokePresent(ringD(uv * 0.8 + vec2f(0.0, 0.1), t, mix(0.1, 0.3, k.x), mix(0.08, 0.18, k.y)), uv);
}

@fragment fn fs_double_ring(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var d = ringD(uv + vec2f(mix(0.05, 0.15, k.y), 0.0), t, mix(0.2, 0.4, k.x), 0.1);
  d = max(d, ringD(uv - vec2f(mix(0.05, 0.15, k.y), 0.0), t + 0.8, mix(0.2, 0.4, k.x), 0.1));
  return smokePresent(d, uv);
}

@fragment fn fs_ink_water(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  return smokePresent(diffuseD(uv, t, mix(0.2, 1.2, k.x)), uv);
}

@fragment fn fs_dye_swirl(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = uv - vec2f(0.0, 0.45);
  let p = rot2(length(c) * mix(2.0, 6.0, k.x) - t * 0.4) * c + 0.5;
  return smokePresent(diffuseD(p, t, mix(0.3, 1.0, k.y)), uv);
}

@fragment fn fs_bloom(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var p = vec2f(uv.x * 3.0, uv.y * 3.0 - t * mix(0.3, 0.9, k.y));
  p += curl(p * 0.7, 91u) * (0.6 + mix(0.0, 0.8, k.x));
  let d = smoothstep(0.35, 0.75, fbm01(p, 5, 21u)) * smoothstep(1.3, -0.05, uv.y);
  return smokePresent(d * 1.3, uv);
}

@fragment fn fs_dispersion(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var p = uv * mix(3.0, 6.0, k.y);
  p += curl(p * 0.8 + vec2f(0.0, t * 0.1), 91u) * (1.0 + mix(0.0, 1.0, k.x));
  return smokePresent(pow(fbm01(p, 6, 21u), 1.6) * 1.4, uv);
}

@fragment fn fs_marble(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var p = uv * mix(2.0, 4.0, k.x);
  p += vec2f(fbm(p + t * 0.05, 4, 33u), fbm(p + 5.2, 4, 41u)) * mix(0.4, 1.2, k.y);
  return smokePresent(fbm01(p, 5, 21u) * 1.2, uv);
}

@fragment fn fs_caustic_smoke(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let s = sheets(uv * mix(1.5, 4.0, k.x), t * mix(0.3, 1.2, k.z), i32(mix(3.0, 6.0, k.y)));
  return smokePresent(s * 1.2, uv);
}

@fragment fn fs_tendril_ink(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var p = uv * 4.0;
  p += curl(p * 0.7 + vec2f(0.0, t * 0.08), 91u) * (0.8 + mix(0.0, 0.8, k.x));
  return smokePresent(pow(ridged(p, 6, 21u), mix(1.5, 3.0, k.y)) * 1.5, uv);
}

@fragment fn fs_cloud_deck(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let d = diffuseD(vec2f(uv.x, uv.y * 0.7 + 0.15), t, mix(0.2, 0.8, k.x));
  return smokePresent(smoothstep(0.1, 0.9, d) * (0.9 + 0.3 * k.y), uv);
}

@fragment fn fs_poster_smoke(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let d = plumeD(uv, t, mix(0.16, 0.3, k.x), mix(0.9, 1.6, k.z), 0.5);
  return smokePresent(posth(d, mix(3.0, 6.0, k.y)), uv);
}

@fragment fn fs_contour_smoke(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let d = billowD(uv, t, mix(2.5, 5.0, k.x), mix(0.4, 1.0, k.z), 5);
  let band = abs(fract(d * mix(4.0, 9.0, k.y)) - 0.5);
  let line = smoothstep(0.08, 0.0, band);
  return smokePresent(posth(d, 4.0) * 0.6 + line * d, uv);
}

@fragment fn fs_pixel_smoke(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let g = mix(16.0, 40.0, k.x);
  let cell = (floor(uv * g) + 0.5) / g;
  let d = billow(vec2f(cell.x * mix(3.0, 6.0, k.y), cell.y * 4.0 - t * mix(0.4, 1.0, k.z)), 4, 8u);
  return smokePresent(posth(d, 5.0), uv);
}

@fragment fn fs_cel_smoke(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let d = billowD(uv, t, mix(2.5, 5.0, k.x), mix(0.4, 1.0, k.z), 5);
  return smokePresent(posth(d, mix(3.0, 6.0, k.y)), uv);
}

@fragment fn fs_threshold_puff(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let d = billowD(uv, t, mix(2.5, 5.0, k.x), mix(0.4, 1.0, k.z), 5);
  return smokePresent(smoothstep(mix(0.45, 0.7, k.y), mix(0.55, 0.8, k.y), d), uv);
}

@fragment fn fs_hatch_smoke(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let d = billowD(uv, t, mix(2.5, 5.0, k.x), mix(0.4, 1.0, k.z), 5);
  let hatch = 0.5 + 0.5 * sin((uv.x + uv.y) * mix(30.0, 70.0, k.y));
  return smokePresent(d * mix(0.5, 1.0, smoothstep(0.15, 0.7, d) * hatch), uv);
}

@fragment fn fs_duotone_smoke(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let d = billowD(uv, t, mix(2.5, 5.0, k.x), mix(0.4, 1.0, k.z), 5);
  let s = smoothstep(mix(0.4, 0.65, k.y), mix(0.5, 0.75, k.y), d);
  return vec4f(clamp(mix(u.ink.rgb, u.cream.rgb, s), vec3f(0.0), vec3f(1.0)), 1.0);
}
