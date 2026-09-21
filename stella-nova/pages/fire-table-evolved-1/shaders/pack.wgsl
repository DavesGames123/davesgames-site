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

// ── the 60 evolved cells ─────────────────────────────────────────────────────
@fragment fn fs_firestorm_01(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var q = vec2f(uv.x * 3.092 * (0.7 + 0.6 * k.x), uv.y * 2.077 - t * 2.218 * (0.6 + 0.8 * k.z));
  q = rot2(uv.y * 1.713) * q;
  let m = ridged(q, 5, 21415u) * (0.5 + fbm01(q * 1.988, 5, 18259u));
  var sh = 1.0;
  var h = m * sh * smoothstep(1.251, -0.05, uv.y) * (1.0 + 1.222 * k.y) - uv.y * 0.161;
  return firePresent(clamp(h, 0.0, 2.0));
}

@fragment fn fs_firestorm_02(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var q = vec2f(uv.x * 2.376 * (0.7 + 0.6 * k.x), uv.y * 1.702 - t * 2.221 * (0.6 + 0.8 * k.z));
  q = rot2(uv.y * 1.794) * q;
  let m = ridged(q, 3, 56541u) * (0.5 + fbm01(q * 2.216, 5, 74258u));
  var sh = 1.0;
  sh = exp(-uv.x * uv.x * 2.883);
  var h = m * sh * smoothstep(1.125, -0.05, uv.y) * (1.0 + 1.021 * k.y) - uv.y * 0.082;
  h += coals(uv, t) * 0.4;
  return firePresent(clamp(h, 0.0, 2.0));
}

@fragment fn fs_firestorm_03(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var q = vec2f(uv.x * 3.438 * (0.7 + 0.6 * k.x), uv.y * 2.032 - t * 1.347 * (0.6 + 0.8 * k.z));
  let m = ridged(q, 5, 40532u) * (0.5 + fbm01(q * 2.537, 4, 24276u));
  var sh = 1.0;
  sh = exp(-uv.x * uv.x * 2.147);
  var h = m * sh * smoothstep(1.224, -0.05, uv.y) * (1.0 + 1.098 * k.y) - uv.y * 0.148;
  h += coals(uv, t) * 0.4;
  return firePresent(clamp(h, 0.0, 2.0));
}

@fragment fn fs_firestorm_04(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var q = vec2f(uv.x * 2.604 * (0.7 + 0.6 * k.x), uv.y * 2.496 - t * 1.927 * (0.6 + 0.8 * k.z));
  q = rot2(uv.y * 1.014) * q;
  let m = ridged(q, 5, 51046u) * (0.5 + fbm01(q * 2.045, 5, 81014u));
  var sh = 1.0;
  sh = exp(-uv.x * uv.x * 1.640);
  var h = m * sh * smoothstep(1.187, -0.05, uv.y) * (1.0 + 1.108 * k.y) - uv.y * 0.121;
  return firePresent(clamp(h, 0.0, 2.0));
}

@fragment fn fs_firestorm_05(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var q = vec2f(uv.x * 3.710 * (0.7 + 0.6 * k.x), uv.y * 1.677 - t * 1.658 * (0.6 + 0.8 * k.z));
  q = rot2(uv.y * 2.433) * q;
  let m = ridged(q, 4, 38022u) * (0.5 + fbm01(q * 1.945, 5, 78017u));
  var sh = 1.0;
  var h = m * sh * smoothstep(1.269, -0.05, uv.y) * (1.0 + 0.926 * k.y) - uv.y * 0.138;
  h += coals(uv, t) * 0.4;
  return firePresent(clamp(h, 0.0, 2.0));
}

@fragment fn fs_firestorm_06(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var q = vec2f(uv.x * 2.412 * (0.7 + 0.6 * k.x), uv.y * 2.348 - t * 2.460 * (0.6 + 0.8 * k.z));
  let m = ridged(q, 5, 65721u) * (0.5 + fbm01(q * 1.745, 4, 86448u));
  var sh = 1.0;
  var h = m * sh * smoothstep(1.072, -0.05, uv.y) * (1.0 + 0.941 * k.y) - uv.y * 0.157;
  h += coals(uv, t) * 0.4;
  return firePresent(clamp(h, 0.0, 2.0));
}

@fragment fn fs_firestorm_07(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var q = vec2f(uv.x * 2.790 * (0.7 + 0.6 * k.x), uv.y * 2.263 - t * 1.955 * (0.6 + 0.8 * k.z));
  let m = ridged(q, 3, 17307u) * (0.5 + fbm01(q * 1.754, 5, 23316u));
  var sh = 1.0;
  var h = m * sh * smoothstep(1.176, -0.05, uv.y) * (1.0 + 0.637 * k.y) - uv.y * 0.081;
  h += coals(uv, t) * 0.4;
  return firePresent(clamp(h, 0.0, 2.0));
}

@fragment fn fs_firestorm_08(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var q = vec2f(uv.x * 3.525 * (0.7 + 0.6 * k.x), uv.y * 2.191 - t * 2.059 * (0.6 + 0.8 * k.z));
  q = rot2(uv.y * 1.120) * q;
  let m = ridged(q, 5, 1097u) * (0.5 + fbm01(q * 1.762, 4, 83712u));
  var sh = 1.0;
  var h = m * sh * smoothstep(1.177, -0.05, uv.y) * (1.0 + 0.675 * k.y) - uv.y * 0.195;
  return firePresent(clamp(h, 0.0, 2.0));
}

@fragment fn fs_curtain_01(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let q = vec2f(uv.x * 3.273 * (0.6 + 0.8 * k.x), uv.y * 2.451 - t * 1.988 * (0.6 + 0.8 * k.z));
  let w = q + 0.556 * (0.4 + 1.2 * k.y) * vec2f(sin(q.y * 1.789 + t * 1.279), sin(q.x * 2.086 - t * 1.279));
  var n = fbm01(w, 5, 72566u);
  n = pow(n, 1.8);
  return firePresent(clamp(n * smoothstep(1.15, -0.05, uv.y) * 1.635 - uv.y * 0.255, 0.0, 2.0));
}

@fragment fn fs_curtain_02(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let q = vec2f(uv.x * 4.150 * (0.6 + 0.8 * k.x), uv.y * 2.067 - t * 1.462 * (0.6 + 0.8 * k.z));
  let w = q + 1.109 * (0.4 + 1.2 * k.y) * vec2f(sin(q.y * 1.840 + t * 0.716), sin(q.x * 2.275 - t * 0.716));
  var n = fbm01(w, 4, 56784u);
  return firePresent(clamp(n * smoothstep(1.15, -0.05, uv.y) * 1.494 - uv.y * 0.274, 0.0, 2.0));
}

@fragment fn fs_curtain_03(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let q = vec2f(uv.x * 4.663 * (0.6 + 0.8 * k.x), uv.y * 2.203 - t * 1.577 * (0.6 + 0.8 * k.z));
  let w = q + 1.227 * (0.4 + 1.2 * k.y) * vec2f(sin(q.y * 2.051 + t * 0.782), sin(q.x * 2.135 - t * 0.782));
  var n = fbm01(w, 4, 51491u);
  return firePresent(clamp(n * smoothstep(1.15, -0.05, uv.y) * 1.804 - uv.y * 0.189, 0.0, 2.0));
}

@fragment fn fs_curtain_04(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let q = vec2f(uv.x * 3.808 * (0.6 + 0.8 * k.x), uv.y * 2.415 - t * 1.330 * (0.6 + 0.8 * k.z));
  let w = q + 1.204 * (0.4 + 1.2 * k.y) * vec2f(sin(q.y * 2.542 + t * 0.789), sin(q.x * 1.706 - t * 0.789));
  var n = fbm01(w, 5, 9407u);
  return firePresent(clamp(n * smoothstep(1.15, -0.05, uv.y) * 1.819 - uv.y * 0.260, 0.0, 2.0));
}

@fragment fn fs_curtain_05(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let q = vec2f(uv.x * 3.293 * (0.6 + 0.8 * k.x), uv.y * 2.357 - t * 1.728 * (0.6 + 0.8 * k.z));
  let w = q + 1.136 * (0.4 + 1.2 * k.y) * vec2f(sin(q.y * 1.601 + t * 0.987), sin(q.x * 2.101 - t * 0.987));
  var n = fbm01(w, 4, 55413u);
  return firePresent(clamp(n * smoothstep(1.15, -0.05, uv.y) * 1.859 - uv.y * 0.181, 0.0, 2.0));
}

@fragment fn fs_curtain_06(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let q = vec2f(uv.x * 3.536 * (0.6 + 0.8 * k.x), uv.y * 2.114 - t * 2.086 * (0.6 + 0.8 * k.z));
  let w = q + 1.001 * (0.4 + 1.2 * k.y) * vec2f(sin(q.y * 2.156 + t * 0.785), sin(q.x * 2.527 - t * 0.785));
  var n = fbm01(w, 5, 61892u);
  n = abs(n - 0.5) * 2.0;
  n = pow(n, 1.8);
  return firePresent(clamp(n * smoothstep(1.15, -0.05, uv.y) * 1.605 - uv.y * 0.226, 0.0, 2.0));
}

@fragment fn fs_licks_01(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let pp = vec2f(uv.x * 3.149 * (0.7 + 0.6 * k.z), uv.y * 1.856 - t * 2.611 * (0.6 + 0.8 * k.y));
  var s = sumSines(pp, 2.540 + 2.0 * k.x, 2.0, t);
  let taper = smoothstep(1.1, -0.05, uv.y) * smoothstep(-0.1, 0.15, uv.y);
  let prof = 1.0 - smoothstep(0.0, 0.697, abs(uv.x));
  return firePresent(clamp(s * taper * prof * 1.823 - uv.y * 0.205, 0.0, 2.0));
}

@fragment fn fs_licks_02(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let pp = vec2f(uv.x * 3.043 * (0.7 + 0.6 * k.z), uv.y * 2.303 - t * 2.232 * (0.6 + 0.8 * k.y));
  var s = sumSines(pp, 2.996 + 2.0 * k.x, 2.0, t);
  let taper = smoothstep(1.1, -0.05, uv.y) * smoothstep(-0.1, 0.15, uv.y);
  let prof = 1.0 - smoothstep(0.0, 0.654, abs(uv.x));
  return firePresent(clamp(s * taper * prof * 1.793 - uv.y * 0.201, 0.0, 2.0));
}

@fragment fn fs_licks_03(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let pp = vec2f(uv.x * 2.746 * (0.7 + 0.6 * k.z), uv.y * 1.865 - t * 2.512 * (0.6 + 0.8 * k.y));
  var s = sumSines(pp, 3.196 + 2.0 * k.x, 2.0, t);
  let taper = smoothstep(1.1, -0.05, uv.y) * smoothstep(-0.1, 0.15, uv.y);
  let prof = 1.0 - smoothstep(0.0, 0.730, abs(uv.x));
  return firePresent(clamp(s * taper * prof * 1.509 - uv.y * 0.222, 0.0, 2.0));
}

@fragment fn fs_licks_04(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let pp = vec2f(uv.x * 3.402 * (0.7 + 0.6 * k.z), uv.y * 1.976 - t * 1.701 * (0.6 + 0.8 * k.y));
  var s = sumSines(pp, 2.998 + 2.0 * k.x, 2.0, t);
  s = max(s, sumSines(vec2f(-pp.x, pp.y), 2.998 + 2.0 * k.x, 2.0, t + 4.0));
  let taper = smoothstep(1.1, -0.05, uv.y) * smoothstep(-0.1, 0.15, uv.y);
  let prof = 1.0 - smoothstep(0.0, 0.750, abs(uv.x));
  return firePresent(clamp(s * taper * prof * 1.805 - uv.y * 0.275, 0.0, 2.0));
}

@fragment fn fs_licks_05(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let pp = vec2f(uv.x * 3.260 * (0.7 + 0.6 * k.z), uv.y * 2.277 - t * 1.685 * (0.6 + 0.8 * k.y));
  var s = sumSines(pp, 1.511 + 2.0 * k.x, 2.0, t);
  s = max(s, sumSines(vec2f(-pp.x, pp.y), 1.511 + 2.0 * k.x, 2.0, t + 4.0));
  let taper = smoothstep(1.1, -0.05, uv.y) * smoothstep(-0.1, 0.15, uv.y);
  let prof = 1.0 - smoothstep(0.0, 0.797, abs(uv.x));
  return firePresent(clamp(s * taper * prof * 1.740 - uv.y * 0.257, 0.0, 2.0));
}

@fragment fn fs_licks_06(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let pp = vec2f(uv.x * 2.850 * (0.7 + 0.6 * k.z), uv.y * 2.374 - t * 2.776 * (0.6 + 0.8 * k.y));
  var s = sumSines(pp, 1.775 + 2.0 * k.x, 2.0, t);
  let taper = smoothstep(1.1, -0.05, uv.y) * smoothstep(-0.1, 0.15, uv.y);
  let prof = 1.0 - smoothstep(0.0, 0.745, abs(uv.x));
  return firePresent(clamp(s * taper * prof * 1.594 - uv.y * 0.250, 0.0, 2.0));
}

@fragment fn fs_firefly_01(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let uw = uv - vec2f(0.0, t * 0.261);
  let g = 10.311 * (0.6 + 0.8 * k.x);
  let q = uw * g; let i = vec2i(floor(q)); let f = fract(q); var v = 0.0;
  for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) {
    let o = vec2i(x, y); let r = h3(vec3i(i + o, 0), 27307u);
    if (r.z < 0.611) { continue; }
    let d = length(f - vec2f(o) - r.xy);
    let tw = 0.6 + 0.4 * sin(t * 1.017 * (0.5 + k.y) + r.x * TAU);
    v += tw * pow(max(1.0 - d / 0.433, 0.0), 2.823);
  } }
  return firePresent(clamp(v * (1.2 + 0.8 * k.z), 0.0, 1.6));
}

@fragment fn fs_firefly_02(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let uw = uv - vec2f(0.0, t * 0.217);
  let g = 8.451 * (0.6 + 0.8 * k.x);
  let q = uw * g; let i = vec2i(floor(q)); let f = fract(q); var v = 0.0;
  for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) {
    let o = vec2i(x, y); let r = h3(vec3i(i + o, 0), 90813u);
    if (r.z < 0.735) { continue; }
    let d = length(f - vec2f(o) - r.xy);
    let tw = 0.6 + 0.4 * sin(t * 1.033 * (0.5 + k.y) + r.x * TAU);
    v += tw * pow(max(1.0 - d / 0.566, 0.0), 2.038);
  } }
  return firePresent(clamp(v * (1.2 + 0.8 * k.z), 0.0, 1.6));
}

@fragment fn fs_firefly_03(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let uw = uv - vec2f(0.0, t * 0.211);
  let g = 7.579 * (0.6 + 0.8 * k.x);
  let q = uw * g; let i = vec2i(floor(q)); let f = fract(q); var v = 0.0;
  for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) {
    let o = vec2i(x, y); let r = h3(vec3i(i + o, 0), 27654u);
    if (r.z < 0.706) { continue; }
    let d = length(f - vec2f(o) - r.xy);
    let tw = 0.6 + 0.4 * sin(t * 3.267 * (0.5 + k.y) + r.x * TAU);
    v += tw * pow(max(1.0 - d / 0.452, 0.0), 2.906);
  } }
  return firePresent(clamp(v * (1.2 + 0.8 * k.z), 0.0, 1.6));
}

@fragment fn fs_firefly_04(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let uw = uv - vec2f(0.0, t * 0.0);
  let g = 7.292 * (0.6 + 0.8 * k.x);
  let q = uw * g; let i = vec2i(floor(q)); let f = fract(q); var v = 0.0;
  for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) {
    let o = vec2i(x, y); let r = h3(vec3i(i + o, 0), 25473u);
    if (r.z < 0.630) { continue; }
    let d = length(f - vec2f(o) - r.xy);
    let tw = 0.6 + 0.4 * sin(t * 1.553 * (0.5 + k.y) + r.x * TAU);
    v += tw * pow(max(1.0 - d / 0.590, 0.0), 2.558);
  } }
  return firePresent(clamp(v * (1.2 + 0.8 * k.z), 0.0, 1.6));
}

@fragment fn fs_firefly_05(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let uw = uv - vec2f(0.0, t * 0.0);
  let g = 8.376 * (0.6 + 0.8 * k.x);
  let q = uw * g; let i = vec2i(floor(q)); let f = fract(q); var v = 0.0;
  for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) {
    let o = vec2i(x, y); let r = h3(vec3i(i + o, 0), 3049u);
    if (r.z < 0.709) { continue; }
    let d = length(f - vec2f(o) - r.xy);
    let tw = 0.6 + 0.4 * sin(t * 1.163 * (0.5 + k.y) + r.x * TAU);
    v += tw * pow(max(1.0 - d / 0.496, 0.0), 2.873);
  } }
  return firePresent(clamp(v * (1.2 + 0.8 * k.z), 0.0, 1.6));
}

@fragment fn fs_firefly_06(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let uw = uv - vec2f(0.0, t * 0.310);
  let g = 6.124 * (0.6 + 0.8 * k.x);
  let q = uw * g; let i = vec2i(floor(q)); let f = fract(q); var v = 0.0;
  for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) {
    let o = vec2i(x, y); let r = h3(vec3i(i + o, 0), 64332u);
    if (r.z < 0.754) { continue; }
    let d = length(f - vec2f(o) - r.xy);
    let tw = 0.6 + 0.4 * sin(t * 1.273 * (0.5 + k.y) + r.x * TAU);
    v += tw * pow(max(1.0 - d / 0.414, 0.0), 2.363);
  } }
  return firePresent(clamp(v * (1.2 + 0.8 * k.z), 0.0, 1.6));
}

@fragment fn fs_firefly_07(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let uw = uv - vec2f(0.0, t * 0.106);
  let g = 8.688 * (0.6 + 0.8 * k.x);
  let q = uw * g; let i = vec2i(floor(q)); let f = fract(q); var v = 0.0;
  for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) {
    let o = vec2i(x, y); let r = h3(vec3i(i + o, 0), 73729u);
    if (r.z < 0.779) { continue; }
    let d = length(f - vec2f(o) - r.xy);
    let tw = 0.6 + 0.4 * sin(t * 2.923 * (0.5 + k.y) + r.x * TAU);
    v += tw * pow(max(1.0 - d / 0.421, 0.0), 2.414);
  } }
  return firePresent(clamp(v * (1.2 + 0.8 * k.z), 0.0, 1.6));
}

@fragment fn fs_sparkshower_01(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let dn = 0.976 * (0.7 + 0.5 * k.x); let sp = 1.152 * (0.6 + 0.8 * k.y);
  let s = sparks(uv, t, dn, sp, 28938u) + sparks(uv, t + 5.0, dn, sp, 84764u);
  var h = s * 1.3 + colFlame(uv, t, 0.324, 1.756, 0.8) * (0.234 + 0.4 * k.z);
  h += coals(uv, t) * 0.4;
  return firePresent(h);
}

@fragment fn fs_sparkshower_02(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let dn = 0.850 * (0.7 + 0.5 * k.x); let sp = 1.366 * (0.6 + 0.8 * k.y);
  let s = sparks(uv, t, dn, sp, 88880u) + sparks(uv, t + 5.0, dn, sp, 27827u);
  var h = s * 1.3 + colFlame(uv, t, 0.336, 1.444, 0.8) * (0.411 + 0.4 * k.z);
  return firePresent(h);
}

@fragment fn fs_sparkshower_03(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let dn = 0.615 * (0.7 + 0.5 * k.x); let sp = 0.852 * (0.6 + 0.8 * k.y);
  let s = sparks(uv, t, dn, sp, 70211u) + sparks(uv, t + 5.0, dn, sp, 45802u);
  var h = s * 1.3 + colFlame(uv, t, 0.394, 1.706, 0.8) * (0.425 + 0.4 * k.z);
  h += coals(uv, t) * 0.4;
  return firePresent(h);
}

@fragment fn fs_sparkshower_04(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let dn = 0.718 * (0.7 + 0.5 * k.x); let sp = 1.452 * (0.6 + 0.8 * k.y);
  let s = sparks(uv, t, dn, sp, 80998u) + sparks(uv, t + 5.0, dn, sp, 60921u);
  var h = s * 1.3 + colFlame(uv, t, 0.336, 1.435, 0.8) * (0.374 + 0.4 * k.z);
  return firePresent(h);
}

@fragment fn fs_sparkshower_05(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let dn = 0.769 * (0.7 + 0.5 * k.x); let sp = 0.983 * (0.6 + 0.8 * k.y);
  let s = sparks(uv, t, dn, sp, 45353u) + sparks(uv, t + 5.0, dn, sp, 1686u);
  var h = s * 1.3 + colFlame(uv, t, 0.397, 1.920, 0.8) * (0.245 + 0.4 * k.z);
  h += coals(uv, t) * 0.4;
  return firePresent(h);
}

@fragment fn fs_sparkshower_06(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let dn = 0.706 * (0.7 + 0.5 * k.x); let sp = 0.881 * (0.6 + 0.8 * k.y);
  let s = sparks(uv, t, dn, sp, 3787u) + sparks(uv, t + 5.0, dn, sp, 70876u);
  var h = s * 1.3 + colFlame(uv, t, 0.257, 1.716, 0.8) * (0.355 + 0.4 * k.z);
  h += coals(uv, t) * 0.4;
  return firePresent(h);
}

@fragment fn fs_sparkshower_07(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let dn = 0.958 * (0.7 + 0.5 * k.x); let sp = 0.972 * (0.6 + 0.8 * k.y);
  let s = sparks(uv, t, dn, sp, 67139u) + sparks(uv, t + 5.0, dn, sp, 27734u);
  var h = s * 1.3 + colFlame(uv, t, 0.339, 1.791, 0.8) * (0.491 + 0.4 * k.z);
  return firePresent(h);
}

@fragment fn fs_cinders_01(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let q = vec2f(uv.x * 6.586 + sin(t * 0.5) * 0.5, (uv.y - t * 0.416 * (0.6 + 0.8 * k.y)) * 6.586);
  var s = spots(q, 0.106 * (0.7 + 0.6 * k.x), 20574u);
  var h = smoothstep(0.3, 0.9, s) * smoothstep(1.1, -0.1, uv.y) * 1.4;
  h *= 0.7 + 0.5 * sin(t * 3.0 + s * 6.0);
  return firePresent(h * (0.8 + 0.6 * k.z));
}

@fragment fn fs_cinders_02(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let q = vec2f(uv.x * 6.249 + sin(t * 0.5) * 0.5, (uv.y - t * 0.382 * (0.6 + 0.8 * k.y)) * 6.249);
  var s = spots(q, 0.212 * (0.7 + 0.6 * k.x), 61708u);
  var h = smoothstep(0.3, 0.9, s) * smoothstep(1.1, -0.1, uv.y) * 1.4;
  return firePresent(h * (0.8 + 0.6 * k.z));
}

@fragment fn fs_cinders_03(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let q = vec2f(uv.x * 7.974 + sin(t * 0.5) * 0.5, (uv.y - t * 0.432 * (0.6 + 0.8 * k.y)) * 7.974);
  var s = spots(q, 0.183 * (0.7 + 0.6 * k.x), 76775u);
  var h = smoothstep(0.3, 0.9, s) * smoothstep(1.1, -0.1, uv.y) * 1.4;
  return firePresent(h * (0.8 + 0.6 * k.z));
}

@fragment fn fs_cinders_04(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let q = vec2f(uv.x * 6.464 + sin(t * 0.5) * 0.5, (uv.y - t * 0.322 * (0.6 + 0.8 * k.y)) * 6.464);
  var s = spots(q, 0.214 * (0.7 + 0.6 * k.x), 7475u);
  s += spots(q * 1.3 + 3.0, 0.214 * 0.8, 15149u) * 0.7;
  var h = smoothstep(0.3, 0.9, s) * smoothstep(1.1, -0.1, uv.y) * 1.4;
  return firePresent(h * (0.8 + 0.6 * k.z));
}

@fragment fn fs_cinders_05(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let q = vec2f(uv.x * 5.415 + sin(t * 0.5) * 0.5, (uv.y - t * 0.152 * (0.6 + 0.8 * k.y)) * 5.415);
  var s = spots(q, 0.120 * (0.7 + 0.6 * k.x), 44861u);
  var h = smoothstep(0.3, 0.9, s) * smoothstep(1.1, -0.1, uv.y) * 1.4;
  return firePresent(h * (0.8 + 0.6 * k.z));
}

@fragment fn fs_cinders_06(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let q = vec2f(uv.x * 5.186 + sin(t * 0.5) * 0.5, (uv.y - t * 0.334 * (0.6 + 0.8 * k.y)) * 5.186);
  var s = spots(q, 0.196 * (0.7 + 0.6 * k.x), 73017u);
  s += spots(q * 1.3 + 3.0, 0.196 * 0.8, 12129u) * 0.7;
  var h = smoothstep(0.3, 0.9, s) * smoothstep(1.1, -0.1, uv.y) * 1.4;
  h *= 0.7 + 0.5 * sin(t * 3.0 + s * 6.0);
  return firePresent(h * (0.8 + 0.6 * k.z));
}

@fragment fn fs_cinders_07(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let q = vec2f(uv.x * 6.859 + sin(t * 0.5) * 0.5, (uv.y - t * 0.353 * (0.6 + 0.8 * k.y)) * 6.859);
  var s = spots(q, 0.182 * (0.7 + 0.6 * k.x), 74471u);
  var h = smoothstep(0.3, 0.9, s) * smoothstep(1.1, -0.1, uv.y) * 1.4;
  h *= 0.7 + 0.5 * sin(t * 3.0 + s * 6.0);
  return firePresent(h * (0.8 + 0.6 * k.z));
}

@fragment fn fs_sparks_01(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let dn = 0.425 * (0.6 + 0.8 * k.x); let sp = 1.090 * (0.6 + 0.8 * k.y);
  var s = sparks(uv, t, dn, sp, 50384u);
  s += sparks(uv, t + 7.0, dn * 0.8, sp * 1.2, 35528u) * 0.8;
  return firePresent(s * (1.572 * (0.7 + 0.6 * k.z)) + coals(uv, t) * 0.388);
}

@fragment fn fs_sparks_02(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let dn = 0.539 * (0.6 + 0.8 * k.x); let sp = 0.887 * (0.6 + 0.8 * k.y);
  var s = sparks(uv, t, dn, sp, 48330u);
  s += sparks(uv, t + 7.0, dn * 0.8, sp * 1.2, 70071u) * 0.8;
  return firePresent(s * (1.756 * (0.7 + 0.6 * k.z)) + coals(uv, t) * 0.338);
}

@fragment fn fs_sparks_03(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let dn = 0.572 * (0.6 + 0.8 * k.x); let sp = 0.758 * (0.6 + 0.8 * k.y);
  var s = sparks(uv, t, dn, sp, 47302u);
  return firePresent(s * (1.100 * (0.7 + 0.6 * k.z)) + coals(uv, t) * 0.437);
}

@fragment fn fs_sparks_04(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let dn = 0.661 * (0.6 + 0.8 * k.x); let sp = 0.642 * (0.6 + 0.8 * k.y);
  var s = sparks(uv, t, dn, sp, 6708u);
  return firePresent(s * (1.634 * (0.7 + 0.6 * k.z)) + coals(uv, t) * 0.456);
}

@fragment fn fs_sparks_05(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let dn = 0.621 * (0.6 + 0.8 * k.x); let sp = 0.817 * (0.6 + 0.8 * k.y);
  var s = sparks(uv, t, dn, sp, 90595u);
  return firePresent(s * (1.523 * (0.7 + 0.6 * k.z)) + coals(uv, t) * 0.493);
}

@fragment fn fs_sparks_06(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let dn = 0.468 * (0.6 + 0.8 * k.x); let sp = 0.891 * (0.6 + 0.8 * k.y);
  var s = sparks(uv, t, dn, sp, 48789u);
  return firePresent(s * (1.071 * (0.7 + 0.6 * k.z)) + coals(uv, t) * 0.493);
}

@fragment fn fs_sparks_07(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let dn = 0.690 * (0.6 + 0.8 * k.x); let sp = 1.201 * (0.6 + 0.8 * k.y);
  var s = sparks(uv, t, dn, sp, 27463u);
  s += sparks(uv, t + 7.0, dn * 0.8, sp * 1.2, 12283u) * 0.8;
  return firePresent(s * (1.118 * (0.7 + 0.6 * k.z)) + coals(uv, t) * 0.569);
}

@fragment fn fs_furnace_01(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var h = colFlame(uv, t, 0.519 * (0.7 + 0.5 * k.x), 2.759 * (0.6 + 0.8 * k.z), 1.957 + k.y);
  h = max(h, colFlame(uv + vec2f(0.125, 0.0), t + 3.0, 0.519 * 0.9, 2.759, 1.957));
  h = h * 1.15 + coals(uv, t) * 0.393;
  return firePresent(h);
}

@fragment fn fs_furnace_02(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var h = colFlame(uv, t, 0.428 * (0.7 + 0.5 * k.x), 2.746 * (0.6 + 0.8 * k.z), 1.737 + k.y);
  h = h * 1.15 + coals(uv, t) * 0.432;
  h += sparks(uv, t, 0.5, 1.0, 71u) * 0.8;
  return firePresent(h);
}

@fragment fn fs_furnace_03(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var h = colFlame(uv, t, 0.467 * (0.7 + 0.5 * k.x), 2.392 * (0.6 + 0.8 * k.z), 1.249 + k.y);
  h = max(h, colFlame(uv + vec2f(0.277, 0.0), t + 3.0, 0.467 * 0.9, 2.392, 1.249));
  h = h * 1.15 + coals(uv, t) * 0.359;
  return firePresent(h);
}

@fragment fn fs_furnace_04(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var h = colFlame(uv, t, 0.461 * (0.7 + 0.5 * k.x), 2.652 * (0.6 + 0.8 * k.z), 1.739 + k.y);
  h = h * 1.15 + coals(uv, t) * 0.596;
  h += sparks(uv, t, 0.5, 1.0, 71u) * 0.8;
  return firePresent(h);
}

@fragment fn fs_furnace_05(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var h = colFlame(uv, t, 0.378 * (0.7 + 0.5 * k.x), 2.154 * (0.6 + 0.8 * k.z), 1.443 + k.y);
  h = max(h, colFlame(uv + vec2f(0.174, 0.0), t + 3.0, 0.378 * 0.9, 2.154, 1.443));
  h = h * 1.15 + coals(uv, t) * 0.310;
  return firePresent(h);
}

@fragment fn fs_furnace_06(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var h = colFlame(uv, t, 0.534 * (0.7 + 0.5 * k.x), 2.598 * (0.6 + 0.8 * k.z), 1.414 + k.y);
  h = h * 1.15 + coals(uv, t) * 0.424;
  return firePresent(h);
}

@fragment fn fs_gasjet_01(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var h = colFlame(uv, t, 0.108 * (0.7 + 0.6 * k.x), 2.485 * (0.7 + 0.6 * k.y), 0.3);
  h *= 0.7 + 0.3 * sin(t * 9.586 + fbm(vec2f(t * 0.7, 0.0), 2, 9u) * 3.0);
  let core = (1.0 - smoothstep(0.0, 0.062, abs(uv.x))) * smoothstep(0.6, 0.0, uv.y);
  return firePresent(h + core * (0.5 + 0.4 * k.z));
}

@fragment fn fs_gasjet_02(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var h = colFlame(uv, t, 0.109 * (0.7 + 0.6 * k.x), 2.773 * (0.7 + 0.6 * k.y), 0.3);
  h *= 0.7 + 0.3 * sin(t * 8.344 + fbm(vec2f(t * 0.7, 0.0), 2, 9u) * 3.0);
  let core = (1.0 - smoothstep(0.0, 0.109, abs(uv.x))) * smoothstep(0.6, 0.0, uv.y);
  return firePresent(h + core * (0.5 + 0.4 * k.z));
}

@fragment fn fs_gasjet_03(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var h = colFlame(uv, t, 0.160 * (0.7 + 0.6 * k.x), 2.327 * (0.7 + 0.6 * k.y), 0.3);
  h *= 0.7 + 0.3 * sin(t * 7.419 + fbm(vec2f(t * 0.7, 0.0), 2, 9u) * 3.0);
  let core = (1.0 - smoothstep(0.0, 0.116, abs(uv.x))) * smoothstep(0.6, 0.0, uv.y);
  return firePresent(h + core * (0.5 + 0.4 * k.z));
}

@fragment fn fs_gasjet_04(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var h = colFlame(uv, t, 0.144 * (0.7 + 0.6 * k.x), 2.352 * (0.7 + 0.6 * k.y), 0.3);
  let core = (1.0 - smoothstep(0.0, 0.093, abs(uv.x))) * smoothstep(0.6, 0.0, uv.y);
  return firePresent(h + core * (0.5 + 0.4 * k.z));
}

@fragment fn fs_gasjet_05(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var h = colFlame(uv, t, 0.121 * (0.7 + 0.6 * k.x), 2.360 * (0.7 + 0.6 * k.y), 0.3);
  h *= 0.7 + 0.3 * sin(t * 9.283 + fbm(vec2f(t * 0.7, 0.0), 2, 9u) * 3.0);
  let core = (1.0 - smoothstep(0.0, 0.073, abs(uv.x))) * smoothstep(0.6, 0.0, uv.y);
  return firePresent(h + core * (0.5 + 0.4 * k.z));
}

@fragment fn fs_gasjet_06(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var h = colFlame(uv, t, 0.083 * (0.7 + 0.6 * k.x), 2.491 * (0.7 + 0.6 * k.y), 0.3);
  h *= 0.7 + 0.3 * sin(t * 9.471 + fbm(vec2f(t * 0.7, 0.0), 2, 9u) * 3.0);
  let core = (1.0 - smoothstep(0.0, 0.103, abs(uv.x))) * smoothstep(0.6, 0.0, uv.y);
  return firePresent(h + core * (0.5 + 0.4 * k.z));
}
