// ═══════════════════════════════════════════════════════════════════════════
//  HEAT METAL TABLE  ·  one fragment shader per cell. Metal heats from below a
//  surface. A cell computes a heat field, a brushed surface and a spark field,
//  then calls metalPresent. Color follows an idealized blackbody curve (Tanner
//  Helland fit): cold steel to dull red to cherry to orange to yellow to white.
//  Hot metal throws sparks. The oxide family uses a steel-tempering ramp
//  instead. Noise after Perlin (pcg3d hashing).
// ═══════════════════════════════════════════════════════════════════════════
const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.283185307179586;

struct MetalU {
    size: vec2f, time: f32, pixelScale: f32,
    ink: vec4f, tone: vec4f, cream: vec4f,
    energy: f32, glow: f32, pad0: f32, pad1: f32,
    k: vec4f,
};
@group(0) @binding(0) var<uniform> u: MetalU;

@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(p[i], 0.0, 1.0);
}
fn fuv(fp: vec2f) -> vec2f {
    let p = fp / max(u.pixelScale, 0.001);
    let n = (p - 0.5 * u.size) / max(min(u.size.x, u.size.y), 1.0);
    return vec2f(n.x, 0.5 - n.y);
}

// ── Perlin noise and fractal sums ───────────────────────────────────────────
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

// ── blackbody: temperature (Kelvin) to approximate sRGB (Tanner Helland) ─────
fn blackbody(tk: f32) -> vec3f {
    let T = clamp(tk, 500.0, 12000.0) / 100.0;
    var r: f32; var g: f32; var b: f32;
    if (T <= 66.0) { r = 255.0; } else { r = 329.698727446 * pow(T - 60.0, -0.1332047592); }
    if (T <= 66.0) { g = 99.4708025861 * log(T) - 161.1195681661; } else { g = 288.1221695283 * pow(T - 60.0, -0.0755148492); }
    if (T >= 66.0) { b = 255.0; } else if (T <= 19.0) { b = 0.0; } else { b = 138.5177312231 * log(T - 10.0) - 305.0447927307; }
    return clamp(vec3f(r, g, b) / 255.0, vec3f(0.0), vec3f(1.0));
}
// steel tempering (oxide) colors: straw, bronze, purple, blue, grey-blue
fn temperColor(x: f32) -> vec3f {
    let s = clamp(x, 0.0, 1.0) * 5.0;
    let cs = array<vec3f, 6>(
        vec3f(0.66, 0.64, 0.56), vec3f(0.86, 0.66, 0.30), vec3f(0.55, 0.30, 0.18),
        vec3f(0.42, 0.24, 0.52), vec3f(0.22, 0.34, 0.74), vec3f(0.48, 0.58, 0.72));
    let i = i32(floor(s)); let f = fract(s);
    let a = cs[clamp(i, 0, 5)]; let b = cs[clamp(i + 1, 0, 5)];
    return mix(a, b, f);
}

// ── metal surface and heat fields ───────────────────────────────────────────
fn brushed(uv: vec2f, freq: f32, ang: f32, detail: f32) -> f32 {
    let p = rot2(ang) * uv;
    let lines = 0.5 + 0.5 * sin(p.y * freq + fbm(p * vec2f(2.0, 22.0), 3, 5u) * 3.0);
    let micro = fbm01(p * vec2f(4.0, 44.0), 2, 9u);
    return clamp(0.35 + 0.5 * lines * detail + 0.25 * micro, 0.0, 1.0);
}
// top-left corner as the origin: (0,0) at top-left, (1,1) at bottom-right
fn corner(uv: vec2f) -> vec2f { return vec2f(uv.x + 0.5, 1.0 - uv.y); }
// pointwise conduction from the corner: temperature falls off with distance.
// cond is the conduction length (how far heat reaches); aniso stretches the
// spread along y (>1 reaches further down, <1 stays tight).
fn diffCorner(c: vec2f, cond: f32, aniso: f32) -> f32 {
    let d = c * vec2f(1.0, 1.0 / max(aniso, 0.05));
    return exp(-length(d) / max(cond, 0.02));
}
fn hotspot(uv: vec2f, c: vec2f, r: f32) -> f32 { let d = uv - c; return exp(-dot(d, d) / max(r * r, 1e-4)); }
fn metalSparks(uv: vec2f, t: f32, density: f32, speed: f32, seed: u32) -> f32 {
    let scale = mix(7.0, 16.0, density);
    let q = vec2f(uv.x * scale, (uv.y - t * speed) * scale);
    let i = vec2i(floor(q)); let f = fract(q); var s = 0.0;
    for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) {
        let o = vec2i(x, y); let r = h3(vec3i(i + o, 0), seed);
        if (r.z < 0.6) { continue; }
        let life = fract(r.x + t * speed * 0.5);
        let d = f - vec2f(o) - vec2f(r.x, r.y * 0.4);
        let tw = 0.6 + 0.4 * sin(t * 7.0 + r.y * TAU);
        s += tw * (1.0 - life) * exp(-dot(d, d) * 45.0);
    } }
    return s;
}

// ── the finisher ────────────────────────────────────────────────────────────
fn metalPresent(heat: f32, surf: f32, uv: vec2f, sparkField: f32) -> vec4f {
    let T = clamp(heat * u.energy, 0.0, 1.4);
    let Tc = clamp(T, 0.0, 1.0);
    let tempK = mix(700.0, 6800.0, Tc);
    let emit = blackbody(tempK) * smoothstep(0.06, 0.42, T) * (0.12 + 1.5 * T);
    let cold = u.ink.rgb * (0.5 + 0.75 * surf);
    var col = cold * (1.0 - smoothstep(0.32, 0.95, T)) + emit;
    let sparkVis = sparkField * smoothstep(0.5, 0.85, T);
    col += blackbody(mix(2400.0, 6500.0, Tc)) * sparkVis * (0.8 + 1.1 * u.glow);
    return vec4f(clamp(col, vec3f(0.0), vec3f(1.7)), 1.0);
}

// ── the 60 metal cells ───────────────────────────────────────────────────────
@fragment fn fs_point_source(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, mix(30.0, 70.0, k.x), 0.1, 0.8);
  return metalPresent(diffCorner(c, mix(0.15, 0.55, k.x), mix(0.6, 1.6, k.y)), surf, uv, metalSparks(uv, t, 0.5, 0.9, 71u));
}

@fragment fn fs_slow_conductor(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, mix(40.0, 80.0, k.y), 0.1, 0.8);
  return metalPresent(diffCorner(c, mix(0.08, 0.2, k.x), 1.0), surf, uv, metalSparks(uv, t, 0.4, 0.9, 61u));
}

@fragment fn fs_fast_conductor(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, mix(30.0, 60.0, k.y), 0.1, 0.7);
  return metalPresent(diffCorner(c, mix(0.4, 0.9, k.x), 1.0), surf, uv, metalSparks(uv, t, 0.35, 0.8, 61u));
}

@fragment fn fs_aniso_down(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, mix(30.0, 60.0, k.x), 1.5708, 0.8);
  return metalPresent(diffCorner(c, mix(0.2, 0.45, k.x), mix(1.6, 3.0, k.y)), surf, uv, metalSparks(uv, t, 0.4, 0.9, 61u));
}

@fragment fn fs_aniso_right(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.0, 0.8);
  return metalPresent(diffCorner(c, mix(0.2, 0.45, k.x), mix(0.6, 0.35, k.y)), surf, uv, metalSparks(uv, t, 0.4, 0.9, 61u));
}

@fragment fn fs_sharp_core(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, mix(35.0, 70.0, k.y), 0.1, 0.8);
  let r = length(c); let h = 1.0 / (1.0 + r * r / mix(0.02, 0.1, k.x));
  return metalPresent(h, surf, uv, metalSparks(uv, t, 0.5, 1.0, 71u));
}

@fragment fn fs_broad_soak(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, mix(30.0, 60.0, k.y), 0.1, 0.7);
  return metalPresent(diffCorner(c, mix(0.6, 1.1, k.x), 1.0) * 1.05, surf, uv, metalSparks(uv, t, 0.3, 0.8, 61u));
}

@fragment fn fs_bimetal(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.8);
  let side = step(mix(0.3, 0.7, k.y), c.x);
  let cond = mix(0.15, 0.5, side);
  return metalPresent(diffCorner(c, cond, 1.0), surf, uv, metalSparks(uv, t, 0.35, 0.9, 61u));
}

@fragment fn fs_heating_up(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, mix(30.0, 65.0, k.x), 0.1, 0.8);
  let grow = smoothstep(0.0, 0.75, fract(t * mix(0.08, 0.22, k.y)));
  return metalPresent(diffCorner(c, mix(0.06, 0.6, k.x) * grow, 1.0), surf, uv, metalSparks(uv, t, 0.5, 1.0, 71u));
}

@fragment fn fs_reheat_pulse(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, mix(30.0, 65.0, k.x), 0.1, 0.8);
  let g = 0.4 + 0.6 * (0.5 + 0.5 * sin(t * mix(0.8, 2.2, k.y)));
  return metalPresent(diffCorner(c, mix(0.15, 0.5, k.x) * g, 1.0), surf, uv, metalSparks(uv, t, 0.5, 1.0, 71u));
}

@fragment fn fs_torch_hold(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.7);
  let fl = 0.85 + 0.15 * sin(t * 7.0 + fbm(uv * 5.0, 2, 9u) * 4.0) * mix(0.3, 1.0, k.y);
  return metalPresent(diffCorner(c, mix(0.18, 0.5, k.x), 1.0) * fl, surf, uv, metalSparks(uv, t, 0.6, 1.2, 71u));
}

@fragment fn fs_front_advance(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, mix(30.0, 65.0, k.x), 0.1, 0.8);
  let rad = fract(t * mix(0.1, 0.3, k.y)) * 1.6;
  let front = smoothstep(rad, rad - 0.4, length(c));
  return metalPresent(front * diffCorner(c, mix(0.3, 0.7, k.x), 1.0) * 1.3, surf, uv, metalSparks(uv, t, 0.4, 0.9, 61u));
}

@fragment fn fs_ramp_soak(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.8);
  let ph = fract(t * mix(0.05, 0.15, k.y)); let grow = smoothstep(0.0, 0.5, ph) * (1.0 - smoothstep(0.85, 1.0, ph));
  return metalPresent(diffCorner(c, mix(0.1, 0.55, k.x) * (0.3 + 0.7 * grow), 1.0), surf, uv, metalSparks(uv, t, 0.45, 0.9, 71u));
}

@fragment fn fs_flicker_source(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.8);
  let gate = 0.5 + 0.5 * sin(t * mix(2.0, 5.0, k.y) + fbm(vec2f(t * 0.8, 0.0), 2, 9u) * 4.0);
  return metalPresent(diffCorner(c, mix(0.15, 0.5, k.x), 1.0) * mix(0.4, 1.0, gate), surf, uv, metalSparks(uv, t, 0.5, 1.0, 71u));
}

@fragment fn fs_surge(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.8);
  let s = pow(0.5 + 0.5 * sin(t * mix(1.0, 3.0, k.y)), 3.0);
  return metalPresent(diffCorner(c, mix(0.15, 0.4, k.x) * (0.6 + 1.0 * s), 1.0), surf, uv, metalSparks(uv, t, 0.5, 1.1, 71u));
}

@fragment fn fs_breathing(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.8);
  let g = 0.5 + 0.5 * sin(t * mix(0.6, 1.6, k.y));
  return metalPresent(diffCorner(c, mix(0.12, 0.55, k.x) * (0.5 + g), 1.0), surf, uv, metalSparks(uv, t, 0.4, 0.9, 61u));
}

@fragment fn fs_grain_flow(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ang = mix(0.2, 1.3, k.x); let surf = brushed(uv, 70.0, ang, 0.9);
  let c = rot2(ang) * corner(uv);
  return metalPresent(diffCorner(c, mix(0.25, 0.5, k.y), 2.2), surf, uv, metalSparks(uv, t, 0.35, 0.9, 61u));
}

@fragment fn fs_diagonal_conduct(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ang = 0.785; let surf = brushed(uv, 60.0, ang, 0.8);
  let c = rot2(ang) * corner(uv);
  return metalPresent(diffCorner(c, mix(0.2, 0.5, k.y), mix(1.8, 3.2, k.x)), surf, uv, metalSparks(uv, t, 0.35, 0.9, 61u));
}

@fragment fn fs_laminated(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = 0.4 + 0.4 * (0.5 + 0.5 * sin(uv.y * mix(20.0, 44.0, k.x)));
  let c = corner(uv);
  return metalPresent(diffCorner(c, mix(0.25, 0.5, k.y), 0.35) * (0.6 + 0.5 * surf), surf, uv, metalSparks(uv, t, 0.3, 0.8, 61u));
}

@fragment fn fs_fiber(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let streak = fbm01(corner(uv) * vec2f(3.0, mix(14.0, 30.0, k.x)), 3, 13u);
  let surf = clamp(0.3 + 0.6 * streak, 0.0, 1.0);
  return metalPresent(diffCorner(c, mix(0.2, 0.45, k.y), 1.0) * (0.6 + 0.7 * streak), surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));
}

@fragment fn fs_crystal(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let a = atan2(c.y, c.x); let fac = floor(a * mix(2.0, 5.0, k.x) / PI * 4.0);
  let dir = 0.7 + 0.3 * sin(fac);
  let surf = brushed(uv, 55.0, 0.4, 0.7);
  return metalPresent(diffCorner(c, mix(0.2, 0.45, k.y) * dir, 1.0), surf, uv, metalSparks(uv, t, 0.35, 0.9, 61u));
}

@fragment fn fs_rolled_dir(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, mix(30.0, 60.0, k.y), 0.0, 0.7);
  return metalPresent(diffCorner(c, mix(0.25, 0.5, k.x), 0.4), surf, uv, metalSparks(uv, t, 0.3, 0.8, 61u));
}

@fragment fn fs_weld_haz(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, 60.0, 0.6, 0.8);
  return metalPresent(diffCorner(rot2(0.6) * c, mix(0.2, 0.45, k.x), mix(2.0, 3.5, k.y)), surf, uv, metalSparks(uv, t, 0.4, 1.0, 71u));
}

@fragment fn fs_vane(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let a = atan2(c.y, c.x);
  let vane = smoothstep(mix(0.9, 1.4, k.x), 0.2, a);
  let surf = brushed(uv, 60.0, 0.3, 0.8);
  return metalPresent(diffCorner(c, mix(0.25, 0.5, k.y), 1.0) * (0.4 + 0.8 * vane), surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));
}

@fragment fn fs_inclusions(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let block = smoothstep(0.45, 0.6, fbm01(c * mix(4.0, 8.0, k.x), 4, 5u)) * mix(1.0, 3.0, k.y);
  let surf = brushed(uv, 55.0, 0.1, 0.8);
  return metalPresent(exp(-length(c) * (1.0 + block) / 0.4), surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));
}

@fragment fn fs_hot_veins(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let vein = pow(1.0 - abs(fbm(c * mix(3.0, 6.0, k.x), 5, 21u)), mix(2.0, 5.0, k.y));
  let surf = brushed(uv, 55.0, 0.1, 0.7);
  return metalPresent(exp(-length(c) / (0.25 + 0.5 * vein)) , surf, uv, metalSparks(uv, t, 0.35, 0.9, 61u));
}

@fragment fn fs_porous(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let pore = fbm01(c * mix(4.0, 9.0, k.x), 4, 8u);
  let surf = brushed(uv, 45.0, 0.1, 0.7);
  return metalPresent(diffCorner(c, 0.4, 1.0) * smoothstep(mix(0.3, 0.5, k.y), 0.7, pore) * 1.3, surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));
}

@fragment fn fs_cracked(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let crack = smoothstep(0.02, 0.0, abs(fbm(c * mix(3.0, 6.0, k.x), 5, 31u)));
  let surf = brushed(uv, 50.0, 0.1, 0.8);
  return metalPresent(diffCorner(c, 0.45, 1.0) * (1.0 - crack * mix(0.6, 1.0, k.y)), surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));
}

@fragment fn fs_grainy(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let n = 0.7 + 0.6 * fbm(c * mix(3.0, 7.0, k.x), 4, 5u) * mix(0.4, 1.2, k.y);
  let surf = brushed(uv, 55.0, 0.1, 0.8);
  return metalPresent(exp(-length(c) * n / 0.4), surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));
}

@fragment fn fs_marbled_conduct(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var c = corner(uv); c += vec2f(fbm(c * mix(2.0, 4.0, k.x) + t * 0.03, 4, 33u), fbm(c * 2.0 + 5.2, 4, 41u)) * mix(0.1, 0.35, k.y);
  let surf = brushed(uv, 50.0, 0.1, 0.7);
  return metalPresent(diffCorner(c, 0.4, 1.0), surf, uv, metalSparks(uv, t, 0.3, 0.8, 61u));
}

@fragment fn fs_dendritic(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let a = atan2(c.y, c.x);
  let branch = pow(0.5 + 0.5 * sin(a * mix(6.0, 14.0, k.x) + length(c) * 8.0), mix(2.0, 5.0, k.y));
  let surf = brushed(uv, 55.0, 0.1, 0.7);
  return metalPresent(diffCorner(c, 0.45, 1.0) * (0.4 + 0.9 * branch), surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));
}

@fragment fn fs_mottled(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let pock = fbm01(c * mix(3.0, 6.0, k.x) - vec2f(0.0, t * 0.1), 4, 8u);
  let surf = brushed(uv, 50.0, 0.1, 0.7);
  return metalPresent(diffCorner(c, 0.4, 1.0) * (0.5 + pock * mix(0.6, 1.0, k.y)), surf, uv, metalSparks(uv, t, 0.3, 0.8, 61u));
}

@fragment fn fs_corner_sparks(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, 60.0, 0.1, 0.7);
  let sp = metalSparks(uv + vec2f(0.5, 0.0), t, mix(0.6, 1.0, k.y), 1.3, 71u);
  return metalPresent(diffCorner(c, mix(0.2, 0.4, k.x), 1.0) * 1.1, surf, uv, sp * 1.3);
}

@fragment fn fs_grinding_corner(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, 80.0, t * 3.0, 0.8);
  let sp = metalSparks(uv + vec2f(0.5, 0.0), t, mix(0.7, 1.0, k.y), 1.9, 71u) + metalSparks(uv + vec2f(0.5, 0.0), t + 5.0, 0.8, 2.1, 88u);
  return metalPresent(diffCorner(c, mix(0.18, 0.35, k.x), 1.0) * 1.3, surf, uv, sp * 1.4);
}

@fragment fn fs_welding_corner(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, 60.0, 0.1, 0.7);
  let sp = metalSparks(uv + vec2f(0.5, 0.0), t, mix(0.7, 1.0, k.y), 1.6, 71u);
  return metalPresent(diffCorner(c, mix(0.14, 0.3, k.x), 1.0) * 1.5, surf, uv, sp * 1.6);
}

@fragment fn fs_spark_shower_corner(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, 55.0, 0.1, 0.6);
  let sp = metalSparks(uv + vec2f(0.5, 0.0), t, 0.9, mix(1.4, 2.2, k.y), 71u) + metalSparks(uv + vec2f(0.5, 0.0), t + 3.0, 0.9, 2.0, 88u);
  return metalPresent(diffCorner(c, mix(0.2, 0.4, k.x), 1.0) * 1.2, surf, uv, sp * 1.3);
}

@fragment fn fs_cutting_corner(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, 60.0, 0.1, 0.7);
  let sp = metalSparks(uv + vec2f(0.5, -0.2), t, mix(0.7, 1.0, k.y), 2.2, 71u);
  return metalPresent(diffCorner(c, mix(0.14, 0.3, k.x), 1.4) * 1.4, surf, uv, sp * 1.4);
}

@fragment fn fs_burst_corner(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, 60.0, 0.1, 0.7);
  let burst = pow(0.5 + 0.5 * sin(t * mix(1.5, 4.0, k.y)), 4.0);
  let sp = metalSparks(uv + vec2f(0.5, 0.0), t, 0.8, 1.7, 71u) * (0.3 + burst);
  return metalPresent(diffCorner(c, mix(0.16, 0.34, k.x), 1.0) * 1.3, surf, uv, sp * 1.5);
}

@fragment fn fs_fountain_corner(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, 50.0, 0.1, 0.6);
  var sp = 0.0;
  for (var i: i32 = 0; i < 3; i++) { let a = f32(i) * 0.5 - 0.5; sp += metalSparks(rot2(a) * (uv + vec2f(0.5, -0.5)) + vec2f(0.0, -0.5), t + f32(i) * 3.0, mix(0.7, 1.0, k.y), 1.8, 71u + u32(i)); }
  return metalPresent(diffCorner(c, mix(0.18, 0.36, k.x), 1.0) * 1.2, surf, uv, sp * 1.2);
}

@fragment fn fs_slag_corner(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, 45.0, 0.1, 0.6);
  let sp = metalSparks(uv + vec2f(0.5, 0.0), t, mix(0.5, 0.9, k.y), 1.3, 71u);
  return metalPresent(diffCorner(c, mix(0.16, 0.32, k.x), 1.2) * 1.25, surf, uv, sp * 1.2);
}

@fragment fn fs_quench(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, 60.0, 0.1, 0.8);
  let cool = 0.4 + 0.5 * (0.5 + 0.5 * sin(t * mix(0.3, 0.9, k.y) - 1.5));
  return metalPresent(diffCorner(c, mix(0.1, 0.5, k.x) * cool, 1.0), surf, uv, 0.0);
}

@fragment fn fs_cooling_front(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, 60.0, 0.1, 0.8);
  let front = 1.5 - fract(t * mix(0.1, 0.3, k.y)) * 1.6;
  let mask = smoothstep(front - 0.3, front, length(c));
  return metalPresent(diffCorner(c, mix(0.25, 0.5, k.x), 1.0) * (1.0 - mask), surf, uv, 0.0);
}

@fragment fn fs_receding_glow(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, 60.0, 0.1, 0.8);
  let g = mix(0.35, 0.6, k.x) * (0.4 + 0.6 * abs(sin(t * mix(0.3, 0.8, k.y))));
  return metalPresent(diffCorner(c, g, 1.0), surf, uv, 0.0);
}

@fragment fn fs_oxide_cooling(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, 45.0, 0.1, 0.6);
  var p = c * mix(2.0, 4.0, k.x); p += vec2f(fbm(p + t * 0.04, 4, 33u), fbm(p + 5.2, 4, 41u)) * 0.4;
  let cool = 0.5 + 0.4 * sin(t * mix(0.3, 0.7, k.y));
  return metalPresent(diffCorner(c, 0.4, 1.0) * (0.5 + 0.5 * fbm01(p, 4, 3u)) * cool, surf, uv, 0.0);
}

@fragment fn fs_steam_quench(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, 60.0, 0.1, 0.8);
  let steam = smoothstep(mix(0.4, 0.6, k.y), 0.75, fbm01(c * mix(4.0, 8.0, k.x) - vec2f(0.0, t), 4, 8u));
  return metalPresent(diffCorner(c, 0.4, 1.0) * (1.0 - steam), surf, uv, 0.0);
}

@fragment fn fs_flash_cool(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, 60.0, 0.1, 0.8);
  let flash = 1.0 - pow(0.5 + 0.5 * sin(t * mix(1.5, 4.0, k.y)), 3.0) * 0.7;
  return metalPresent(diffCorner(c, mix(0.2, 0.45, k.x), 1.0) * flash, surf, uv, 0.0);
}

@fragment fn fs_uneven_quench(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, 55.0, 0.1, 0.8);
  let patchN = fbm01(c * mix(3.0, 6.0, k.x) + vec2f(0.0, t * 0.1), 4, 8u);
  return metalPresent(diffCorner(c, 0.4, 1.0) * smoothstep(mix(0.3, 0.5, k.y), 0.7, patchN), surf, uv, 0.0);
}

@fragment fn fs_residual(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, 65.0, 0.1, 0.8);
  return metalPresent(diffCorner(c, mix(0.08, 0.2, k.x), 1.0) * mix(0.3, 0.7, k.y), surf, uv, 0.0);
}

@fragment fn fs_temper_rings(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, mix(40.0, 80.0, k.y), 0.1, 0.8);
  let x = clamp(1.0 - length(c) / mix(0.4, 1.0, k.x), 0.0, 1.0) * u.energy;
  return vec4f(clamp(temperColor(x) * (0.5 + 0.7 * surf), vec3f(0.0), vec3f(1.0)), 1.0);
}

@fragment fn fs_temper_grow(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, 60.0, 0.1, 0.8);
  let grow = 0.4 + 0.6 * (0.5 + 0.5 * sin(t * mix(0.3, 0.9, k.y)));
  let x = clamp(1.0 - length(c) / (mix(0.4, 0.9, k.x) * grow), 0.0, 1.0);
  return vec4f(clamp(temperColor(x) * (0.5 + 0.7 * surf), vec3f(0.0), vec3f(1.0)), 1.0);
}

@fragment fn fs_heat_tint_corner(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, 60.0, 0.6, 0.8);
  let x = clamp(1.0 - length(c) * mix(1.5, 3.0, k.y), 0.0, 1.0);
  return vec4f(clamp(temperColor(x) * (0.5 + 0.7 * surf), vec3f(0.0), vec3f(1.0)), 1.0);
}

@fragment fn fs_bluing_corner(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, mix(50.0, 80.0, k.x), 0.1, 0.8);
  let x = clamp(1.0 - length(c) / mix(0.5, 1.1, k.y), 0.0, 1.0) * 0.9 + 0.1;
  return vec4f(clamp(temperColor(x) * (0.4 + 0.6 * surf), vec3f(0.0), vec3f(1.0)), 1.0);
}

@fragment fn fs_temper_grain(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ang = mix(0.0, 1.2, k.y); let surf = brushed(uv, 70.0, ang, 0.9);
  let c = rot2(ang) * corner(uv) * vec2f(1.0, 0.45);
  let x = clamp(1.0 - length(c) / mix(0.4, 0.9, k.x), 0.0, 1.0);
  return vec4f(clamp(temperColor(x) * (0.5 + 0.7 * surf), vec3f(0.0), vec3f(1.0)), 1.0);
}

@fragment fn fs_temper_marble(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  var c = corner(uv); c += vec2f(fbm(c * mix(2.0, 4.0, k.x) + t * 0.03, 4, 33u), fbm(c * 2.0 + 5.2, 4, 41u)) * mix(0.15, 0.4, k.y);
  let surf = brushed(uv, 55.0, 0.1, 0.8);
  let x = clamp(1.0 - length(c) / 0.7, 0.0, 1.0);
  return vec4f(clamp(temperColor(x) * (0.5 + 0.7 * surf), vec3f(0.0), vec3f(1.0)), 1.0);
}

@fragment fn fs_temper_bands(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, 70.0, 0.1, 0.9);
  let x = clamp(1.0 - length(c) / mix(0.5, 1.0, k.x), 0.0, 1.0);
  let banded = floor(x * mix(4.0, 8.0, k.y)) / mix(4.0, 8.0, k.y);
  return vec4f(clamp(temperColor(banded) * (0.5 + 0.7 * surf), vec3f(0.0), vec3f(1.0)), 1.0);
}

@fragment fn fs_brushed_finish(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, mix(40.0, 90.0, k.x), 0.0, 1.0);
  return metalPresent(diffCorner(c, mix(0.25, 0.5, k.y), 1.0) * (0.7 + 0.5 * surf), surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));
}

@fragment fn fs_damascus_finish(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let p = vec2f(uv.x, uv.y + 0.15 * sin(uv.x * mix(6.0, 14.0, k.x)));
  let surf = 0.4 + 0.5 * (0.5 + 0.5 * sin(p.y * mix(20.0, 50.0, k.x) + fbm(p * 4.0, 3, 5u) * 4.0));
  let c = corner(uv);
  return metalPresent(diffCorner(c, mix(0.25, 0.5, k.y), 1.0) * (0.7 + 0.5 * surf), surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));
}

@fragment fn fs_scratched_finish(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let scr = fbm01(uv * vec2f(mix(3.0, 6.0, k.x), 60.0), 3, 13u);
  let surf = clamp(0.3 + 0.7 * scr, 0.0, 1.0);
  let c = corner(uv);
  return metalPresent(diffCorner(c, mix(0.25, 0.5, k.y), 1.0) * (0.6 + 0.7 * scr), surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));
}

@fragment fn fs_mesh_finish(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let g = mix(6.0, 16.0, k.x);
  let bars = max(abs(fract(uv.x * g) - 0.5), abs(fract(uv.y * g) - 0.5));
  let surf = smoothstep(0.2, 0.45, bars);
  let c = corner(uv);
  return metalPresent(diffCorner(c, mix(0.3, 0.55, k.y), 1.0) * surf, surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));
}

@fragment fn fs_mill_finish(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let c = corner(uv); let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.05, 0.6);
  return metalPresent(diffCorner(c, mix(0.25, 0.5, k.y), 1.0) * (0.7 + 0.4 * fbm01(uv * vec2f(2.0, 6.0), 3, 3u)), surf, uv, metalSparks(uv, t, 0.25, 0.8, 61u));
}
