// ═══════════════════════════════════════════════════════════════════════════
//  FIRE TABLE  ·  one fragment shader per cell, a procedural fire each. Every
//  cell reads uv (x centered, y 0 floor .. 1 top), the hover clock t and four
//  knobs k, then returns a color through firePresent(heat) or builds one. heat
//  runs through fireCol, a ramp on the ink, tone and cream swatches, so the
//  palette drives all cells. Smoke, fronts and haze are single-pass fakes of
//  the compute sims. Noise after Perlin (pcg3d hashing); sum-of-sines after
//  Finch; phasor after Tricard 2019; the flame/coal/haze cores are original.
// ═══════════════════════════════════════════════════════════════════════════
const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.283185307179586;

struct FireU {
    size: vec2f, time: f32, pixelScale: f32,
    ink: vec4f, tone: vec4f, cream: vec4f,
    exposure: f32, contrast: f32, glow: f32, pad1: f32,
    k: vec4f,
};
@group(0) @binding(0) var<uniform> u: FireU;

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

fn sumSines(p: vec2f, sharp: f32, sp: f32, tt: f32) -> f32 {
    var s = 0.0; var amp = 1.0; var f = 3.0; var nrm = 0.0;
    for (var i: i32 = 0; i < 5; i++) {
        let d = vec2f(cos(f32(i) * 1.9), sin(f32(i) * 1.9));
        s += amp * pow(0.5 + 0.5 * sin(dot(d, p) * f + tt * sp * (1.0 + 0.3 * f32(i))), sharp);
        nrm += amp; amp *= 0.6; f *= 1.6;
    }
    return s / max(nrm, 1e-4);
}
fn spots(p: vec2f, w: f32, seed: u32) -> f32 {
    let i = vec2i(floor(p)); let f = fract(p); var s = 0.0;
    for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) {
        let o = vec2i(x, y); let r = h3(vec3i(i + o, 0), seed); let d = f - vec2f(o) - r.xy;
        s += r.z * exp(-dot(d, d) / max(w * w, 1e-4));
    } }
    return s;
}
fn phasorField(p: vec2f, f0: f32, w0: f32, seed: u32) -> f32 {
    let i = vec2i(floor(p)); let f = fract(p); var z = vec2f(0.0);
    for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) {
        let o = vec2i(x, y);
        for (var n: i32 = 0; n < 2; n++) {
            let r = h3(vec3i(i + o, n), seed); let q = f - vec2f(o) - r.xy;
            let w = mix(w0, r.z * TAU, 0.5); let env = exp(-PI * dot(q, q));
            let ph = TAU * f0 * (q.x * cos(w) + q.y * sin(w));
            z += env * vec2f(cos(ph), sin(ph));
        }
    } }
    return 0.5 + 0.5 * sin(atan2(z.y, z.x));
}

// ── the fire palette and the finisher ───────────────────────────────────────
fn fireCol(hh: f32) -> vec3f {
    let h = clamp(hh, 0.0, 1.0);
    let lo = mix(u.ink.rgb, u.tone.rgb, smoothstep(0.04, 0.5, h));
    let hi = mix(lo, u.cream.rgb, smoothstep(0.42, 0.82, h));
    return mix(hi, vec3f(1.0), smoothstep(0.85, 1.0, h) * 0.92);
}
fn firePresent(heat: f32) -> vec4f {
    var hv = (heat - 0.5) * u.contrast + 0.5;
    hv = max(hv, 0.0) * u.exposure;
    let hc = clamp(hv, 0.0, 1.0);
    var col = fireCol(hc);
    col += fireCol(hc) * hc * 0.16 * u.glow;
    let over = max(hv - 1.0, 0.0);
    col += vec3f(1.0, 0.86, 0.6) * over * 0.55 * u.glow;
    return vec4f(clamp(col, vec3f(0.0), vec3f(1.7)), 1.0);
}
fn posth(h: f32, n: f32) -> f32 { return floor(h * n + 0.5) / n; }

// ── flame cores ─────────────────────────────────────────────────────────────
fn colFlame(uv: vec2f, t: f32, width: f32, rise: f32, detail: f32) -> f32 {
    let sway = (0.08 + 0.12 * width) * sin(uv.y * 3.3 + t * 2.1) * clamp(uv.y, 0.0, 1.0);
    let x = (uv.x + sway) / max(width, 0.05);
    let q = vec2f(x * 1.8, uv.y * 2.3 - t * rise);
    let w = turb(q * 1.2, 4, 21u);
    let n = fbm01(q + vec2f(w * 0.5 * detail, 0.0), 5, 3u);
    let prof = 1.0 - smoothstep(0.0, 1.0, abs(x));
    let taper = smoothstep(1.1, 0.0, uv.y) * smoothstep(-0.2, 0.1, uv.y);
    let h = prof * taper * (0.4 + 1.2 * n) - uv.y * 0.32;
    return clamp(h, 0.0, 2.0);
}
fn plume(uv: vec2f, t: f32, wid: f32, rise: f32) -> f32 {
    let spread = 0.25 + 0.9 * uv.y;
    let x = uv.x / (wid * spread + 0.05);
    var q = vec2f(x * 1.4, uv.y * 1.6 - t * rise);
    let w = fbm(q * 1.1, 3, 44u);
    q += vec2f(w * 0.6, w * 0.3);
    let n = fbm01(q, 5, 8u);
    let prof = exp(-x * x * 1.3);
    let taper = smoothstep(1.25, -0.05, uv.y);
    return clamp(prof * taper * (0.35 + 1.3 * n) - uv.y * 0.15, 0.0, 2.0);
}
fn tongue(uv: vec2f, t: f32, sharp: f32, sp: f32) -> f32 {
    let s = sumSines(vec2f(uv.x * 3.0, uv.y * 2.0 - t * sp), mix(1.0, 4.0, sharp), 2.0, t);
    let taper = smoothstep(1.1, -0.05, uv.y) * smoothstep(-0.1, 0.15, uv.y);
    let prof = 1.0 - smoothstep(0.0, 0.7, abs(uv.x));
    return clamp(s * taper * prof * 1.7 - uv.y * 0.25, 0.0, 2.0);
}
fn coals(uv: vec2f, t: f32) -> f32 {
    let bed = fbm01(vec2f(uv.x * 4.0, uv.y * 5.0 + t * 0.1), 4, 12u);
    let pulse = 0.6 + 0.4 * sin(t * 1.5 + bed * TAU);
    let mask = smoothstep(0.5, 0.0, uv.y);
    return clamp(smoothstep(0.5, 0.86, bed) * pulse * mask * 1.5, 0.0, 2.0);
}
fn sparks(uv: vec2f, t: f32, density: f32, speed: f32, seed: u32) -> f32 {
    let scale = mix(6.0, 15.0, density);
    let q = vec2f(uv.x * scale, (uv.y - t * speed) * scale);
    let i = vec2i(floor(q)); let f = fract(q); var s = 0.0;
    for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) {
        let o = vec2i(x, y); let r = h3(vec3i(i + o, 0), seed);
        if (r.z < 0.55) { continue; }
        let life = fract(r.x + t * speed * 0.5);
        let d = f - vec2f(o) - vec2f(r.x, r.y * 0.4);
        let tw = 0.6 + 0.4 * sin(t * 6.0 + r.y * TAU);
        s += tw * (1.0 - life) * exp(-dot(d, d) * 40.0);
    } }
    return s * smoothstep(1.1, -0.1, uv.y);
}
fn frontF(uv: vec2f, t: f32, edge: f32, w: f32) -> f32 {
    let n = fbm01(uv * 3.0 + vec2f(0.0, t * 0.05), 5, 17u);
    return smoothstep(edge + w, edge - w, uv.y + 0.3 * n);
}
fn hazeUV(uv: vec2f, t: f32, amt: f32) -> vec2f {
    let w = fbm(vec2f(uv.x * 4.0, uv.y * 4.0 - t * 1.2), 3, 33u);
    let w2 = fbm(vec2f(uv.x * 7.0 + 3.0, uv.y * 6.0 - t * 1.8), 2, 51u);
    return uv + vec2f(w * 0.7 + w2 * 0.3, w * 0.4) * amt * smoothstep(0.0, 1.0, uv.y);
}

// ── the 60 cells ─────────────────────────────────────────────────────────────
@fragment fn fs_candle(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let h = colFlame(vec2f(uv.x, uv.y * 1.15 - 0.04), t, mix(0.09, 0.18, k.x), mix(1.3, 2.2, k.y), 0.5 + 0.8 * k.z);
  return firePresent(h);
}

@fragment fn fs_torch(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let lean = uv + vec2f((0.15 + 0.4 * k.y) * uv.y * uv.y, 0.0);
  let h = colFlame(lean, t, mix(0.18, 0.34, k.x), mix(1.4, 2.4, k.z), 1.0);
  return firePresent(h);
}

@fragment fn fs_bonfire(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let sp = mix(0.18, 0.32, k.x);
  var h = colFlame(uv + vec2f(sp, 0.0), t, 0.2, mix(1.4, 2.2, k.y), k.z);
  h = max(h, colFlame(uv, t + 3.1, 0.24, mix(1.4, 2.2, k.y), k.z));
  h = max(h, colFlame(uv - vec2f(sp, 0.0), t + 6.3, 0.2, mix(1.4, 2.2, k.y), k.z));
  return firePresent(h + coals(uv, t) * 0.5);
}

@fragment fn fs_matchstick(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let h = colFlame(vec2f(uv.x, uv.y * 1.4 - 0.05), t, mix(0.06, 0.12, k.x), mix(2.2, 3.4, k.y), 0.8);
  return firePresent(h);
}

@fragment fn fs_gas_jet(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let h = colFlame(uv, t, mix(0.07, 0.14, k.x), mix(2.4, 3.6, k.y), 0.3);
  let core = (1.0 - smoothstep(0.0, mix(0.04, 0.1, k.z), abs(uv.x))) * smoothstep(0.6, 0.0, uv.y);
  return firePresent(h + core * 0.6);
}

@fragment fn fs_pilot(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let g = mix(0.1, 0.24, k.x);
  var h = colFlame(uv + vec2f(g, 0.0), t, 0.08, mix(1.6, 2.6, k.y), 0.6);
  h = max(h, colFlame(uv - vec2f(g, 0.0), t + 2.0, 0.08, mix(1.6, 2.6, k.y), 0.6));
  return firePresent(h);
}

@fragment fn fs_wildfire_wall(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let sway = 0.06 * sin(uv.x * 9.0 + t * 3.0);
  let q = vec2f((uv.x + sway) * 3.0, uv.y * 2.4 - t * mix(1.5, 2.6, k.z));
  let n = fbm01(q + turb(q, 4, 21u) * 0.6, 5, 3u);
  let base = mix(0.5, 0.95, k.x);
  let h = smoothstep(1.0, 0.0, uv.y / base) * (0.3 + 1.3 * n) - uv.y * 0.2 - mix(0.0, 0.3, k.y) * abs(sin(uv.x * 20.0));
  return firePresent(clamp(h, 0.0, 2.0));
}

@fragment fn fs_furnace(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let h = colFlame(uv, t, mix(0.35, 0.55, k.x), mix(1.6, 2.6, k.z), 1.0 + k.y);
  return firePresent(h * 1.15 + coals(uv, t) * 0.4);
}

@fragment fn fs_sputter(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let gate = smoothstep(0.2, 0.6, 0.5 + 0.5 * sin(t * mix(2.0, 5.0, k.y) + fbm(vec2f(t * 0.7, 0.0), 2, 9u) * 4.0));
  let h = colFlame(uv, t, mix(0.1, 0.2, k.x), mix(1.6, 2.6, k.z), 0.8);
  return firePresent(h * mix(0.25, 1.0, gate));
}

@fragment fn fs_pyre(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let h = colFlame(uv, t, mix(0.16, 0.3, k.x), mix(1.6, 2.8, k.y), 1.0);
  let s = sparks(uv, t, 0.5, mix(0.5, 1.1, k.z), 71u);
  return firePresent(h + s * 1.2 + coals(uv, t) * 0.5);
}

@fragment fn fs_billow(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  return firePresent(plume(uv, t, mix(0.3, 0.55, k.x), mix(1.2, 2.2, k.z)));
}

@fragment fn fs_mushroom(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let stem = plume(uv, t, mix(0.14, 0.24, k.x), mix(1.2, 2.0, k.z));
  let cy = uv.y - mix(0.5, 0.8, k.y);
  let cap = exp(-(uv.x * uv.x * 3.0 + cy * cy * 14.0)) * (0.6 + 0.6 * fbm01(uv * 4.0 - vec2f(0.0, t), 4, 6u));
  return firePresent(max(stem, cap * 1.3));
}

@fragment fn fs_rollup(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let q0 = vec2f(uv.x * 2.0, uv.y * 1.8 - t * mix(1.2, 2.0, k.z));
  let q = rot2(uv.y * mix(1.5, 4.0, k.y)) * q0;
  let n = fbm01(q + turb(q, 4, 5u) * 0.7, 5, 3u);
  let prof = exp(-uv.x * uv.x / (mix(0.1, 0.3, k.x) + 0.5 * uv.y));
  return firePresent(clamp(prof * smoothstep(1.2, -0.05, uv.y) * (0.3 + 1.4 * n) - uv.y * 0.15, 0.0, 2.0));
}

@fragment fn fs_backdraft(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let burst = 0.6 + 0.9 * pow(0.5 + 0.5 * sin(t * mix(1.5, 4.0, k.y)), 3.0);
  return firePresent(plume(uv, t, mix(0.3, 0.5, k.x), mix(1.2, 2.0, k.z)) * burst);
}

@fragment fn fs_smolder(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let sm = fbm01(vec2f(uv.x * 2.2, uv.y * 2.0 - t * mix(0.8, 1.6, k.z)), 5, 8u);
  let smoke = smoothstep(0.55, 1.0, sm) * smoothstep(1.2, 0.1, uv.y);
  let glow = coals(uv, t) * mix(0.6, 1.3, k.x);
  return firePresent(glow - smoke * mix(0.3, 0.8, k.y));
}

@fragment fn fs_chimney(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let q = vec2f(uv.x * mix(5.0, 8.0, k.x), uv.y * 1.6 - t * mix(1.4, 2.4, k.z));
  let n = fbm01(q + turb(q, 4, 5u) * (0.4 + 0.6 * k.y), 5, 3u);
  let prof = exp(-uv.x * uv.x * mix(20.0, 50.0, k.x));
  return firePresent(clamp(prof * smoothstep(1.2, -0.05, uv.y) * (0.3 + 1.3 * n), 0.0, 2.0));
}

@fragment fn fs_ash_cloud(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let p = plume(uv, t, mix(0.3, 0.5, k.x), mix(1.0, 1.8, k.z)) * 0.6;
  let ash = spots(vec2f(uv.x * 10.0, (uv.y - t * 0.5) * 10.0), 0.12, 61u) * mix(0.4, 1.0, k.y);
  return firePresent(p + ash * smoothstep(0.1, 0.9, uv.y));
}

@fragment fn fs_firestorm(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let q = vec2f(uv.x * mix(2.0, 4.0, k.x), uv.y * 2.0 - t * mix(1.5, 2.8, k.z));
  let m = ridged(q, 4, 7u) * (0.5 + fbm01(q * 2.0, 5, 3u));
  let h = m * smoothstep(1.2, -0.05, uv.y) * (1.0 + k.y) - uv.y * 0.1;
  return firePresent(clamp(h, 0.0, 2.0));
}

@fragment fn fs_licks(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  return firePresent(tongue(uv * vec2f(1.0 / (0.6 + k.z), 1.0), t, k.x, mix(1.5, 3.0, k.y)));
}

@fragment fn fs_phasor_flame(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let q = vec2f(uv.x * mix(2.0, 5.0, k.x), uv.y * 3.0 - t * mix(1.5, 3.0, k.y));
  let p = phasorField(q, mix(1.0, 3.0, k.x), 1.5708, 179u);
  let taper = smoothstep(1.1, -0.05, uv.y) * (1.0 - smoothstep(0.0, 0.8, abs(uv.x)));
  return firePresent(clamp(p * taper * 1.8 - uv.y * 0.2, 0.0, 2.0));
}

@fragment fn fs_gabor_flame(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ang = mix(0.0, 0.6, k.z);
  let d = vec2f(sin(ang), cos(ang));
  let g = 0.5 + 0.5 * sin(dot(vec2f(uv.x, uv.y - t * mix(1.0, 2.4, k.y)), d) * mix(8.0, 20.0, k.x));
  let base = colFlame(uv, t, 0.35, 2.0, 1.0);
  return firePresent(base * (0.4 + 0.9 * g));
}

@fragment fn fs_curtain(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let q = vec2f(uv.x * mix(2.0, 5.0, k.x), uv.y * 2.2 - t * mix(1.2, 2.2, k.z));
  let w = q + mix(0.3, 1.4, k.y) * vec2f(sin(q.y * 2.0 + t), sin(q.x * 2.0 - t));
  let n = fbm01(w, 4, 11u);
  return firePresent(clamp(n * smoothstep(1.15, -0.05, uv.y) * 1.7 - uv.y * 0.2, 0.0, 2.0));
}

@fragment fn fs_ribbons(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let s = sumSines(vec2f(uv.x * mix(3.0, 7.0, k.x), uv.y * 2.5 - t * mix(1.8, 3.2, k.y)), mix(3.0, 7.0, k.z), 2.5, t);
  let taper = smoothstep(1.1, -0.05, uv.y) * (1.0 - smoothstep(0.0, 0.85, abs(uv.x)));
  return firePresent(clamp(s * taper * 1.9 - uv.y * 0.2, 0.0, 2.0));
}

@fragment fn fs_forks(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let fx = abs(uv.x) - mix(0.05, 0.2, k.x) * uv.y;
  let q = vec2f(fx * 3.0, uv.y * 2.2 - t * mix(1.5, 2.6, k.y));
  let n = fbm01(q + turb(q, 4, 5u) * 0.5, 5, 3u);
  let prof = 1.0 - smoothstep(0.0, 0.25, fx);
  return firePresent(clamp(prof * smoothstep(1.15, -0.05, uv.y) * (0.4 + 1.2 * n), 0.0, 2.0));
}

@fragment fn fs_whisps(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let q = vec2f(uv.x * mix(3.0, 6.0, k.x), uv.y * 3.0 - t * mix(1.5, 3.0, k.y));
  let n = turb(q, 5, 13u);
  let h = smoothstep(0.35, 0.7, n) * smoothstep(1.2, -0.05, uv.y) * (1.0 - smoothstep(0.0, 0.9, abs(uv.x)));
  return firePresent(h * 1.4);
}

@fragment fn fs_serpent(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let path = mix(0.1, 0.32, k.x) * sin(uv.y * 3.0 + t * 1.5) + 0.1 * sin(uv.y * 7.0 - t);
  let x = (uv.x - path) / mix(0.1, 0.22, k.y);
  let q = vec2f(x * 1.5, uv.y * 2.0 - t * mix(1.2, 2.2, k.z));
  let n = fbm01(q, 5, 3u);
  let prof = 1.0 - smoothstep(0.0, 1.0, abs(x));
  return firePresent(clamp(prof * smoothstep(1.15, -0.05, uv.y) * (0.4 + 1.2 * n), 0.0, 2.0));
}

@fragment fn fs_ember_bed(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  return firePresent(coals(uv, t * mix(0.6, 1.6, k.y)) * mix(0.8, 1.6, k.x));
}

@fragment fn fs_sparks(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let s = sparks(uv, t, k.x, mix(0.5, 1.3, k.y), 71u);
  return firePresent(s * mix(1.0, 1.8, k.z) + coals(uv, t) * 0.4);
}

@fragment fn fs_firefly_coals(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let g = mix(4.0, 10.0, k.x);
  let q = uv * g; let i = vec2i(floor(q)); let f = fract(q); var v = 0.0;
  for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) {
    let o = vec2i(x, y); let r = h3(vec3i(i + o, 0), 197u);
    if (r.z < 0.6) { continue; }
    let d = length(f - vec2f(o) - r.xy); let tw = 0.6 + 0.4 * sin(t * mix(1.0, 4.0, k.y) + r.x * TAU);
    v += tw * pow(max(1.0 - d / 0.5, 0.0), 2.5);
  } }
  return firePresent(clamp(v * 1.6, 0.0, 1.5));
}

@fragment fn fs_spark_shower(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let s = sparks(uv, t, mix(0.7, 1.0, k.x), mix(0.8, 1.6, k.y), 71u) + sparks(uv, t + 5.0, mix(0.7, 1.0, k.x), mix(0.8, 1.6, k.y), 88u);
  let base = colFlame(uv, t, 0.3, 1.6, 0.8) * mix(0.2, 0.6, k.z);
  return firePresent(s * 1.3 + base);
}

@fragment fn fs_cinders(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let q = vec2f(uv.x * 6.0 + sin(t * 0.5) * 0.5, (uv.y - t * mix(0.15, 0.4, k.y)) * 6.0);
  let s = spots(q, mix(0.1, 0.22, k.x), 61u);
  return firePresent(smoothstep(0.3, 0.9, s) * smoothstep(1.1, -0.1, uv.y) * 1.4);
}

@fragment fn fs_crackle(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let bed = coals(uv, t) * mix(0.7, 1.2, k.x);
  let q = uv * 9.0; let i = vec2i(floor(q)); let f = fract(q); var pop = 0.0;
  for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) {
    let o = vec2i(x, y); let r = h3(vec3i(i + o, 0), 131u);
    let ph = fract(r.x + t * mix(0.5, 1.5, k.y));
    let flash = exp(-ph * 12.0) * step(0.7, r.z);
    pop += flash * exp(-dot(f - vec2f(o) - r.xy, f - vec2f(o) - r.xy) * 30.0);
  } }
  return firePresent(bed + pop * 1.6 * smoothstep(0.6, 0.0, uv.y));
}

@fragment fn fs_ember_glow_pulse(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let breath = 0.5 + 0.5 * sin(t * mix(0.6, 1.8, k.y));
  let bed = fbm01(uv * 5.0 + vec2f(0.0, t * 0.05), 4, 12u);
  let h = smoothstep(0.4, 0.9, bed) * smoothstep(0.7, 0.0, uv.y) * mix(0.6, 1.4, k.x) * (0.5 + 0.8 * breath);
  return firePresent(h);
}

@fragment fn fs_starfield_embers(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let uw = uv - vec2f(0.0, t * mix(0.0, 0.3, k.z));
  let g = mix(3.0, 9.0, k.x); let q = uw * g; let i = vec2i(floor(q)); let f = fract(q); var v = 0.0;
  for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) {
    let o = vec2i(x, y); let r = h3(vec3i(i + o, 0), 211u);
    if (r.z < 0.82) { continue; }
    let d = length(f - vec2f(o) - r.xy); let tw = 0.5 + 0.5 * sin(t * mix(1.0, 5.0, k.y) + r.y * TAU);
    v += tw * pow(max(1.0 - d / 0.4, 0.0), 3.0);
  } }
  return firePresent(clamp(v * 1.7, 0.0, 1.6));
}

@fragment fn fs_wildfire_front(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let edge = fract(t * mix(0.06, 0.18, k.y));
  let n = fbm01(uv * mix(2.0, 5.0, k.z), 5, 17u);
  let band = smoothstep(edge + mix(0.08, 0.2, k.x), edge, uv.y + 0.25 * n) * smoothstep(edge - 0.3, edge, uv.y + 0.25 * n);
  let char = smoothstep(edge, edge - 0.05, uv.y + 0.25 * n) * 0.15;
  return firePresent(band * 1.6 + char);
}

@fragment fn fs_spread_smoothlife(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let q = uv * mix(2.5, 5.0, k.x) + vec2f(0.0, t * mix(0.1, 0.3, k.y));
  let a = fbm01(q, 4, 5u); let b = fbm01(q * 2.3 + 4.0, 3, 9u);
  let cells = smoothstep(0.45, 0.55, a) * (1.0 - smoothstep(0.6, 0.7, b));
  return firePresent(cells * 1.5 * smoothstep(1.1, 0.0, uv.y));
}

@fragment fn fs_reaction_front(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let n = fbm(uv * mix(1.5, 3.0, k.x), 4, 7u);
  let wave = 0.5 + 0.5 * sin(dot(uv, vec2f(0.6, 4.0)) * mix(2.0, 5.0, k.z) - t * mix(1.5, 3.5, k.y) + n * 3.0);
  return firePresent(smoothstep(0.6, 0.95, wave) * 1.5 * smoothstep(1.15, 0.0, uv.y));
}

@fragment fn fs_burn_edge(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let edge = 1.0 - fract(t * mix(0.05, 0.15, k.y));
  let n = fbm01(uv * mix(3.0, 6.0, k.z), 5, 17u);
  let y = uv.y + 0.2 * n;
  let glow = smoothstep(edge + mix(0.06, 0.16, k.x), edge, y) * smoothstep(edge - 0.12, edge, y);
  let unburnt = smoothstep(edge - 0.02, edge + 0.04, y) * 0.04;
  return firePresent(glow * 1.8 + unburnt);
}

@fragment fn fs_lichen_fire(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let q = uv * mix(3.0, 6.0, k.x) + vec2f(0.0, t * 0.15);
  let a = fbm01(q, 4, 5u); let b = fbm01(q * 1.7 + 9.0, 3, 23u);
  let zone = floor(clamp(a * 3.0 + (b - 0.5) * mix(0.0, 2.0, k.y), 0.0, 2.999));
  let h = (zone * 0.5 + 0.2 + 0.3 * fbm01(q * 3.0, 3, 3u)) * smoothstep(1.1, 0.0, uv.y);
  return firePresent(h);
}

@fragment fn fs_flame_cells(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let s = spots(uv * mix(4.0, 9.0, k.x) + vec2f(0.0, t * 0.3), 0.16, 41u);
  let fl = 0.6 + 0.4 * sin(t * mix(2.0, 5.0, k.y) + s * 6.0);
  return firePresent(smoothstep(0.3, 0.8, s) * fl * 1.4 * smoothstep(1.15, 0.0, uv.y));
}

@fragment fn fs_creeping(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let n = fbm01(vec2f(uv.x * mix(3.0, 7.0, k.z) - t * mix(0.2, 0.6, k.y), uv.y * 4.0), 5, 17u);
  let top = mix(0.15, 0.4, k.x) * (0.6 + 0.8 * n);
  let h = smoothstep(top, 0.0, uv.y) * (0.4 + 1.2 * n);
  return firePresent(h);
}

@fragment fn fs_ring_of_fire(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let p = uv - vec2f(0.0, 0.4);
  let r = length(p * vec2f(1.0, 1.2));
  let n = fbm01(vec2f(atan2(p.y, p.x) * 2.0, r * 4.0), 4, 17u);
  let edge = fract(t * mix(0.1, 0.3, k.x));
  let ring = smoothstep(mix(0.04, 0.14, k.y), 0.0, abs(r - edge - 0.05 * n));
  return firePresent(ring * 1.7);
}

@fragment fn fs_heat_haze(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let w = hazeUV(uv, t, mix(0.02, 0.09, k.y));
  let ground = smoothstep(0.6, -0.1, w.y) * (0.7 + 0.5 * fbm01(w * 4.0, 3, 3u));
  return firePresent(ground * mix(0.8, 1.5, k.x));
}

@fragment fn fs_mirage(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let w = hazeUV(uv, t, mix(0.03, 0.1, k.y));
  let line = mix(0.25, 0.55, k.x);
  let h = exp(-abs(w.y - line) * 8.0) * (0.7 + 0.5 * fbm01(w * 6.0, 2, 5u));
  return firePresent(h * 1.3);
}

@fragment fn fs_refraction_flame(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let w = hazeUV(uv, t, mix(0.02, 0.08, k.y));
  return firePresent(colFlame(w, t, mix(0.2, 0.4, k.x), mix(1.4, 2.4, k.z), 1.0));
}

@fragment fn fs_shimmer_wall(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let w = hazeUV(uv, t, mix(0.03, 0.1, k.y));
  let sheet = 0.5 + 0.5 * sin(w.x * mix(6.0, 16.0, k.x) + fbm(w * 3.0, 3, 5u) * 4.0);
  return firePresent(sheet * smoothstep(1.2, -0.1, uv.y) * 0.9);
}

@fragment fn fs_thermal(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let uw = hazeUV(uv, t, mix(0.02, 0.07, k.z));
  let q = vec2f(uw.x * mix(3.0, 6.0, k.x), (uw.y - t * mix(0.3, 0.7, k.y)) * mix(3.0, 6.0, k.x));
  let blobs = smoothstep(0.55, 0.85, fbm01(q, 4, 8u));
  return firePresent(blobs * smoothstep(1.15, -0.1, uv.y) * 1.4);
}

@fragment fn fs_emberglow_haze(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let w = hazeUV(uv, t, mix(0.02, 0.08, k.y));
  let glow = coals(w, t) * mix(0.8, 1.4, k.x);
  let air = fbm01(w * 5.0 - vec2f(0.0, t), 3, 5u) * smoothstep(0.1, 0.8, uv.y) * 0.3;
  return firePresent(glow + air);
}

@fragment fn fs_cel_fire(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let h = colFlame(uv, t, mix(0.2, 0.4, k.x), mix(1.4, 2.4, k.z), 1.0);
  return firePresent(posth(h, mix(3.0, 6.0, k.y)));
}

@fragment fn fs_pixel_fire(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let g = mix(16.0, 40.0, k.x);
  let cell = (floor(uv * g) + 0.5) / g;
  let n = fbm01(vec2f(cell.x * 4.0, cell.y * 6.0 - t * mix(1.2, 2.4, k.z)), 4, 5u);
  let h = n * smoothstep(1.0, -0.1, cell.y) * 1.6 - cell.y * 0.3;
  return firePresent(posth(clamp(h, 0.0, 2.0), mix(4.0, 8.0, k.y)));
}

@fragment fn fs_contour_fire(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let h = colFlame(uv, t, mix(0.2, 0.4, k.x), mix(1.4, 2.4, k.z), 1.0);
  let band = abs(fract(h * mix(4.0, 10.0, k.y)) - 0.5);
  let line = smoothstep(0.08, 0.0, band);
  return firePresent(posth(h, 4.0) * 0.7 + line * h);
}

@fragment fn fs_low_poly(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let q = vec2f(uv.x * 3.0, uv.y * 2.0 - t * mix(1.2, 2.0, k.y));
  let n = fbm01(q, 3, 3u);
  let h = n * smoothstep(1.1, -0.05, uv.y) * (1.0 - smoothstep(0.0, 0.8, abs(uv.x))) * 1.6;
  return firePresent(posth(clamp(h, 0.0, 2.0), mix(3.0, 5.0, k.x)));
}

@fragment fn fs_retro_fire(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let g = mix(20.0, 48.0, k.x);
  let cell = (floor(uv * vec2f(g, g * 0.7)) + 0.5) / vec2f(g, g * 0.7);
  let n = turb(vec2f(cell.x * 5.0, cell.y * 7.0 - t * mix(1.4, 2.8, k.y)), 4, 13u);
  let h = smoothstep(0.2, 0.7, n) * smoothstep(1.0, -0.1, cell.y) * 1.7;
  return firePresent(posth(h, mix(4.0, 7.0, k.z)));
}

@fragment fn fs_hatch_fire(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let h = colFlame(uv, t, mix(0.2, 0.4, k.x), mix(1.4, 2.4, k.z), 1.0);
  let hatch = 0.5 + 0.5 * sin((uv.x + uv.y) * mix(30.0, 70.0, k.y));
  let mask = smoothstep(0.15, 0.75, h);
  return firePresent(h * mix(0.5, 1.0, mask * hatch));
}

@fragment fn fs_firenado(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let p = uv - vec2f(0.0, 0.45);
  let r = length(p * vec2f(1.0 / (mix(0.3, 0.6, k.z)), 1.0));
  let a = atan2(p.x, -p.y);
  let q = vec2f(a * 1.5 + r * 3.0 - t * mix(1.5, 4.0, k.x), r * 3.0 - t * mix(1.0, 2.0, k.y));
  let n = fbm01(q, 5, 3u);
  let col = exp(-r * r * 2.0) + exp(-abs(p.x) * 6.0) * smoothstep(0.9, 0.0, uv.y);
  return firePresent(clamp(col * (0.4 + 1.2 * n), 0.0, 2.0));
}

@fragment fn fs_will_o_wisp(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var h = 0.0;
  for (var i: i32 = 0; i < 3; i++) {
    let fi = f32(i);
    let cx = 0.3 * sin(t * (0.4 + 0.2 * fi) + fi * 2.0);
    let cy = 0.5 + 0.25 * sin(t * (0.5 + 0.15 * fi) + fi);
    let d = uv - vec2f(cx, cy);
    let wob = 0.02 * fbm(uv * 6.0 + t, 3, 7u);
    h += exp(-(d.x * d.x * 18.0 + d.y * d.y * 10.0) + wob) * mix(0.7, 1.3, k.z);
  }
  return firePresent(h);
}

@fragment fn fs_phoenix(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let beat = 0.5 + 0.3 * sin(t * mix(1.0, 3.0, k.y));
  let body = colFlame(vec2f(uv.x, uv.y), t, 0.12, 2.0, 1.0);
  let wx = abs(uv.x) - mix(0.1, 0.25, k.x);
  let wy = uv.y - 0.45 - beat * 0.15 - (abs(uv.x) - 0.1) * 0.6;
  let wing = exp(-(wx * wx * 8.0 + wy * wy * 30.0)) * (0.6 + 0.6 * fbm01(uv * 6.0 - vec2f(0.0, t), 4, 6u));
  return firePresent(max(body, wing * 1.4));
}

@fragment fn fs_cold_fire(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let h = colFlame(uv, t, mix(0.14, 0.28, k.x), mix(1.6, 2.8, k.y), 0.8);
  let hc = clamp((h - 0.5) * u.contrast + 0.5, 0.0, 1.0) * u.exposure;
  let cc = clamp(hc, 0.0, 1.0);
  var col = mix(vec3f(0.0, 0.02, 0.06), vec3f(0.15, 0.55, 1.0), smoothstep(0.05, 0.6, cc));
  col = mix(col, vec3f(0.8, 0.95, 1.0), smoothstep(0.6, 1.0, cc));
  let core = (1.0 - smoothstep(0.0, mix(0.05, 0.12, k.z), abs(uv.x))) * smoothstep(0.6, 0.0, uv.y);
  col += vec3f(0.6, 0.85, 1.0) * core * 0.5;
  return vec4f(clamp(col, vec3f(0.0), vec3f(1.6)), 1.0);
}

@fragment fn fs_magma_cracks(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let q = uv * mix(2.5, 5.0, k.x) + vec2f(0.0, t * mix(0.05, 0.2, k.y));
  let cr = ridged(q, 5, 7u);
  let cracks = smoothstep(0.6, 0.95, cr) * mix(0.8, 1.6, k.z);
  let rock = fbm01(q * 1.5, 3, 3u) * 0.06;
  return firePresent(cracks + rock);
}

@fragment fn fs_plasma_flare(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let q = vec2f(uv.x * mix(2.0, 5.0, k.x), uv.y * 3.0 - t * mix(2.0, 4.0, k.y));
  let p = phasorField(q, mix(2.0, 4.0, k.x), 1.5708, 179u);
  let arc = pow(p, mix(2.0, 5.0, k.z));
  let taper = smoothstep(1.15, -0.05, uv.y) * (1.0 - smoothstep(0.0, 0.9, abs(uv.x)));
  let v = clamp(arc * taper * 2.0, 0.0, 1.5);
  var col = mix(vec3f(0.02, 0.0, 0.06), vec3f(0.6, 0.3, 1.0), smoothstep(0.1, 0.6, v));
  col = mix(col, vec3f(1.0, 0.95, 1.0), smoothstep(0.6, 1.0, v));
  return vec4f(clamp(col, vec3f(0.0), vec3f(1.7)), 1.0);
}
