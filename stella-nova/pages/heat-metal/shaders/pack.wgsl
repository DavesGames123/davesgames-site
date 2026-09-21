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
fn diffuseHeat(uv: vec2f, t: f32, sc: f32, seed: u32) -> f32 {
    let p = uv * sc;
    let n = fbm(p, 5, seed);
    let n2 = fbm(p * 0.5 + vec2f(t * 0.05, -t * 0.04), 3, seed + 3u);
    return clamp(0.5 + 0.55 * n + 0.3 * n2, 0.0, 1.0);
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
@fragment fn fs_billet(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(30.0, 70.0, k.x), 0.1, 0.8);
  let heat = 0.55 + 0.35 * fbm(uv * 3.0, 4, 3u) * mix(0.3, 1.0, k.y);
  return metalPresent(heat, surf, uv, metalSparks(uv, t, 0.5, 0.9, 71u));
}

@fragment fn fs_forge_pulse(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(30.0, 70.0, k.x), 0.1, 0.8);
  let pulse = 0.5 + 0.5 * sin(t * mix(0.6, 1.8, k.y) - 1.0);
  let heat = 0.35 + 0.6 * pulse + 0.1 * fbm(uv * 3.0, 4, 3u);
  return metalPresent(heat, surf, uv, metalSparks(uv, t, 0.6, 1.0, 71u));
}

@fragment fn fs_bar_stock(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(40.0, 80.0, k.x), 1.5708, 0.9);
  let bar = smoothstep(0.35, 0.0, abs(uv.y)) * (0.6 + 0.4 * fbm(uv * 4.0, 4, 3u) * mix(0.4, 1.0, k.y));
  return metalPresent(bar + 0.15, surf, uv, metalSparks(uv, t, 0.4, 0.9, 61u));
}

@fragment fn fs_anvil_face(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.05, 0.7);
  let heat = hotspot(uv, vec2f(0.0, 0.0), mix(0.2, 0.4, k.y)) * 1.1 + 0.1 * fbm(uv * 3.0, 4, 3u);
  return metalPresent(heat, surf, uv, metalSparks(uv, t, 0.5, 1.0, 71u));
}

@fragment fn fs_crucible(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(20.0, 50.0, k.x), 0.0, 0.5);
  var p = uv * 3.0; p += vec2f(fbm(p + t * 0.2, 3, 5u), fbm(p + 5.0 - t * 0.15, 3, 9u)) * mix(0.3, 1.0, k.y);
  let heat = 0.7 + 0.4 * fbm(p, 4, 3u);
  return metalPresent(heat, surf, uv, metalSparks(uv, t, 0.6, 1.1, 71u));
}

@fragment fn fs_ingot(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.8);
  let core = 1.0 - smoothstep(0.1, mix(0.4, 0.6, k.y), length(uv));
  return metalPresent(core * 0.9 + 0.15, surf, uv, metalSparks(uv, t, 0.35, 0.8, 61u));
}

@fragment fn fs_reheat(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(35.0, 70.0, k.x), 0.1, 0.8);
  let front = smoothstep(0.5, -0.5, uv.x - (fract(t * 0.15) * 2.0 - 1.0) * mix(0.5, 1.0, k.y));
  let heat = front * (0.7 + 0.3 * fbm(uv * 3.0, 4, 3u));
  return metalPresent(heat, surf, uv, metalSparks(uv, t, 0.4, 0.9, 71u));
}

@fragment fn fs_white_hot(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(30.0, 70.0, k.x), 0.1, 0.7);
  let heat = 0.85 + 0.3 * fbm(uv * 3.5, 4, 3u) * mix(0.3, 1.0, k.y);
  return metalPresent(heat, surf, uv, metalSparks(uv, t, 0.8, 1.2, 71u));
}

@fragment fn fs_spreading(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.7);
  return metalPresent(diffuseHeat(uv, t, mix(2.0, 4.0, k.x), 7u) * mix(0.8, 1.2, k.y), surf, uv, metalSparks(uv, t, 0.4, 0.9, 61u));
}

@fragment fn fs_conduction(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(40.0, 70.0, k.x), 0.0, 0.8);
  let h = diffuseHeat(uv, t * 0.5, mix(2.5, 4.5, k.x), 17u);
  return metalPresent(smoothstep(0.3, 0.9, h) * mix(0.8, 1.2, k.y), surf, uv, metalSparks(uv, t, 0.35, 0.8, 61u));
}

@fragment fn fs_hot_veins(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.7);
  let v = 1.0 - abs(fbm(uv * mix(2.5, 5.0, k.x), 5, 21u));
  return metalPresent(pow(v, mix(2.0, 5.0, k.y)) * 1.2, surf, uv, metalSparks(uv, t, 0.4, 0.9, 61u));
}

@fragment fn fs_marbled_heat(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.7);
  var p = uv * mix(2.0, 4.0, k.x); p += vec2f(fbm(p + t * 0.05, 4, 33u), fbm(p + 5.2, 4, 41u)) * mix(0.4, 1.2, k.y);
  return metalPresent(fbm01(p, 5, 3u), surf, uv, metalSparks(uv, t, 0.3, 0.8, 61u));
}

@fragment fn fs_creeping_heat(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.7);
  let n = fbm01(vec2f(uv.x * mix(2.0, 5.0, k.x) - t * mix(0.2, 0.6, k.y), uv.y * 3.0), 5, 17u);
  let front = smoothstep(0.4, 0.7, n);
  return metalPresent(front * 1.1, surf, uv, metalSparks(uv, t, 0.35, 0.9, 61u));
}

@fragment fn fs_cell_diffuse(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(35.0, 65.0, k.x), 0.0, 0.7);
  let a = diffuseHeat(uv, t, mix(3.0, 5.0, k.x), 5u); let b = diffuseHeat(uv, t + 4.0, mix(3.0, 5.0, k.x) * 1.7, 9u);
  return metalPresent(mix(a, b, mix(0.3, 0.7, k.y)), surf, uv, metalSparks(uv, t, 0.3, 0.8, 61u));
}

@fragment fn fs_thermal_wave(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(40.0, 70.0, k.x), 1.5708, 0.8);
  let n = fbm(uv * 2.0, 4, 7u);
  let w = 0.5 + 0.5 * sin(uv.x * mix(4.0, 10.0, k.x) - t * mix(1.5, 3.5, k.y) + n * 3.0);
  return metalPresent(smoothstep(0.4, 0.95, w), surf, uv, metalSparks(uv, t, 0.35, 0.9, 61u));
}

@fragment fn fs_flux(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(25.0, 55.0, k.x), 0.1, 0.6);
  var p = uv * mix(2.5, 4.5, k.x); p += vec2f(fbm(p + t * 0.2, 3, 5u), fbm(p - t * 0.15 + 5.0, 3, 9u)) * mix(0.4, 1.2, k.y);
  return metalPresent(0.5 + 0.6 * fbm(p, 4, 3u), surf, uv, metalSparks(uv, t, 0.4, 1.0, 71u));
}

@fragment fn fs_weld_point(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(35.0, 65.0, k.x), 0.1, 0.7);
  let h = hotspot(uv, vec2f(0.0, 0.0), mix(0.06, 0.15, k.x)) * 1.6;
  let sp = metalSparks(uv, t, 0.8, 1.4, 71u) * mix(0.6, 1.3, k.y);
  return metalPresent(h + 0.1, surf, uv, sp + hotspot(uv, vec2f(0.0), 0.2) * sp);
}

@fragment fn fs_torch(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.7);
  let c = vec2f(sin(t * 0.7), cos(t * 0.5)) * mix(0.0, 0.25, k.y);
  return metalPresent(hotspot(uv, c, mix(0.1, 0.2, k.x)) * 1.4 + 0.08, surf, uv, metalSparks(uv, t, 0.5, 1.1, 71u));
}

@fragment fn fs_twin_welds(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(35.0, 65.0, k.x), 0.1, 0.7);
  let g = mix(0.15, 0.3, k.y);
  let h = hotspot(uv, vec2f(-g, 0.0), 0.1) + hotspot(uv, vec2f(g, 0.0), 0.1);
  return metalPresent(h * 1.4 + 0.08, surf, uv, metalSparks(uv, t, 0.6, 1.2, 71u));
}

@fragment fn fs_drill_point(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(40.0, 80.0, k.x), t * 2.0, 0.8);
  let h = hotspot(uv, vec2f(0.0, 0.0), mix(0.05, 0.12, k.x)) * 1.5;
  return metalPresent(h + 0.1, surf, uv, metalSparks(uv, t, 0.9, 1.6, 71u) * mix(0.6, 1.4, k.y));
}

@fragment fn fs_plasma_cut(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(35.0, 65.0, k.x), 0.1, 0.7);
  let cx = (fract(t * mix(0.1, 0.3, k.y)) * 2.0 - 1.0) * 0.6;
  let line = exp(-(uv.x - cx) * (uv.x - cx) / mix(0.004, 0.02, k.x));
  return metalPresent(line * 1.5, surf, uv, metalSparks(uv, t, 0.9, 1.8, 71u) * line);
}

@fragment fn fs_rivet(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.7);
  let ring = smoothstep(mix(0.15, 0.3, k.x), 0.0, length(uv));
  return metalPresent(ring * (0.7 + 0.3 * fbm(uv * 4.0, 4, 3u) * mix(0.3, 1.0, k.y)), surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));
}

@fragment fn fs_wandering_arc(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(35.0, 65.0, k.x), 0.1, 0.7);
  let c = vec2f(sin(t * mix(0.6, 1.6, k.y)), sin(t * mix(0.4, 1.1, k.y) * 1.3)) * 0.3;
  let trail = fbm01(uv * 3.0 - vec2f(t * 0.2, 0.0), 4, 5u) * 0.25;
  return metalPresent(hotspot(uv, c, mix(0.06, 0.13, k.x)) * 1.5 + trail, surf, uv, metalSparks(uv, t, 0.7, 1.3, 71u));
}

@fragment fn fs_cluster(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(35.0, 65.0, k.x), 0.1, 0.7);
  var h = 0.0;
  for (var i: i32 = 0; i < 4; i++) { let fi = f32(i); let c = vec2f(sin(fi * 2.1), cos(fi * 1.7)) * 0.28; h += hotspot(uv, c, mix(0.05, 0.1, k.x)) * (0.6 + 0.4 * sin(t * mix(1.0, 3.0, k.y) + fi)); }
  return metalPresent(h * 1.3 + 0.08, surf, uv, metalSparks(uv, t, 0.5, 1.1, 71u));
}

@fragment fn fs_edge_heat(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(35.0, 70.0, k.x), 0.1, 0.8);
  let g = smoothstep(0.5, -0.5, uv.x) * mix(0.9, 1.2, k.y) + 0.08 * fbm(uv * 4.0, 3, 3u);
  return metalPresent(g, surf, uv, metalSparks(uv, t, 0.35, 0.9, 61u));
}

@fragment fn fs_bottom_heat(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(35.0, 70.0, k.x), 1.5708, 0.8);
  let g = smoothstep(0.5, -0.3, uv.y) * mix(0.9, 1.2, k.y) + 0.08 * fbm(uv * 4.0, 3, 3u);
  return metalPresent(g, surf, uv, metalSparks(uv, t, 0.4, 1.0, 61u));
}

@fragment fn fs_corner_heat(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(35.0, 65.0, k.x), 0.1, 0.8);
  let g = smoothstep(1.2, 0.0, length(uv - vec2f(-0.4, -0.4))) * mix(0.9, 1.2, k.y);
  return metalPresent(g, surf, uv, metalSparks(uv, t, 0.35, 0.9, 61u));
}

@fragment fn fs_band_gradient(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(35.0, 70.0, k.x), 0.1, 0.8);
  let g = exp(-uv.y * uv.y / mix(0.03, 0.15, k.y));
  return metalPresent(g * 1.1 + 0.05 * fbm(uv * 4.0, 3, 3u), surf, uv, metalSparks(uv, t, 0.4, 1.0, 61u));
}

@fragment fn fs_radial_gradient(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.8);
  let g = smoothstep(mix(0.3, 0.6, k.y), 0.0, length(uv));
  return metalPresent(g * 1.1, surf, uv, metalSparks(uv, t, 0.35, 0.9, 61u));
}

@fragment fn fs_diagonal_grade(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(35.0, 70.0, k.x), 0.1, 0.8);
  let d = dot(uv, normalize(vec2f(1.0, mix(-1.0, 1.0, k.y))));
  return metalPresent(smoothstep(0.5, -0.5, d) + 0.06 * fbm(uv * 4.0, 3, 3u), surf, uv, metalSparks(uv, t, 0.35, 0.9, 61u));
}

@fragment fn fs_wavy_front(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(35.0, 65.0, k.x), 0.1, 0.8);
  let edge = uv.x + mix(0.05, 0.25, k.y) * sin(uv.y * 6.0 + t);
  return metalPresent(smoothstep(0.3, -0.3, edge), surf, uv, metalSparks(uv, t, 0.4, 1.0, 61u));
}

@fragment fn fs_quench(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(35.0, 65.0, k.x), 0.1, 0.8);
  let cool = fract(t * mix(0.1, 0.3, k.y));
  let h = smoothstep(cool, cool + 0.4, length(uv)) * 1.1;
  return metalPresent(1.2 - h, surf, uv, 0.0);
}

@fragment fn fs_cooling_cracks(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.8);
  let v = 1.0 - abs(fbm(uv * mix(3.0, 6.0, k.x), 5, 21u));
  let cool = 0.5 + 0.4 * sin(t * 0.4);
  return metalPresent(pow(v, mix(3.0, 6.0, k.y)) * cool * 1.3, surf, uv, 0.0);
}

@fragment fn fs_oxide_swirl(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(25.0, 50.0, k.x), 0.1, 0.6);
  var p = uv * mix(2.0, 4.0, k.x); p += vec2f(fbm(p + t * 0.05, 4, 33u), fbm(p + 5.2 - t * 0.03, 4, 41u)) * mix(0.4, 1.0, k.y);
  return metalPresent((0.4 + 0.5 * fbm(p, 4, 3u)) * (0.6 + 0.3 * sin(t * 0.3)), surf, uv, 0.0);
}

@fragment fn fs_receding_glow(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(35.0, 65.0, k.x), 0.1, 0.8);
  let g = smoothstep(mix(0.2, 0.5, k.y) * (0.5 + 0.5 * sin(t * 0.4)), 0.0, length(uv));
  return metalPresent(g, surf, uv, 0.0);
}

@fragment fn fs_steam_quench(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(35.0, 65.0, k.x), 0.1, 0.8);
  let h = hotspot(uv, vec2f(0.0), 0.35);
  let steam = smoothstep(mix(0.4, 0.6, k.y), 0.75, fbm01(uv * mix(4.0, 8.0, k.x) - vec2f(0.0, t), 4, 8u));
  return metalPresent(h * (1.0 - steam) * 1.2, surf, uv, 0.0);
}

@fragment fn fs_flame_hardening(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(35.0, 70.0, k.x), 1.5708, 0.8);
  let cx = (fract(t * mix(0.08, 0.2, k.y)) * 2.0 - 1.0);
  let band = exp(-(uv.x - cx) * (uv.x - cx) / 0.02);
  let residual = smoothstep(cx, cx - 0.6, uv.x) * 0.3;
  return metalPresent(band * 1.3 + residual, surf, uv, 0.0);
}

@fragment fn fs_cold_shut(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.8);
  let seam = exp(-abs(uv.x + mix(0.1, 0.3, k.y) * sin(uv.y * 4.0)) * 8.0) * (0.5 + 0.3 * sin(t * 0.5));
  return metalPresent(seam * 1.2 + 0.05, surf, uv, 0.0);
}

@fragment fn fs_brushed_glow(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(40.0, 90.0, k.x), 0.0, 1.0);
  let heat = (0.4 + 0.4 * surf) * (0.6 + 0.4 * fbm(uv * 3.0, 4, 3u) * mix(0.3, 1.0, k.y));
  return metalPresent(heat, surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));
}

@fragment fn fs_damascus(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let p = vec2f(uv.x, uv.y + 0.15 * sin(uv.x * mix(6.0, 14.0, k.y)));
  let surf = 0.4 + 0.5 * (0.5 + 0.5 * sin(p.y * mix(20.0, 50.0, k.x) + fbm(p * 4.0, 3, 5u) * 4.0));
  return metalPresent(0.55 + 0.35 * surf, surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));
}

@fragment fn fs_anisotropic(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(40.0, 90.0, k.x), mix(0.0, 1.5708, k.y), 1.0);
  return metalPresent(0.5 + 0.4 * fbm(uv * 3.0, 4, 3u), surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));
}

@fragment fn fs_scratched(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let scr = fbm01(uv * vec2f(mix(3.0, 6.0, k.x), 60.0), 3, 13u);
  let surf = clamp(0.3 + 0.7 * scr, 0.0, 1.0);
  let heat = 0.5 + 0.4 * scr * mix(0.5, 1.2, k.y);
  return metalPresent(heat, surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));
}

@fragment fn fs_rolled_steel(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.05, 0.6);
  return metalPresent(0.55 + 0.3 * fbm(uv * vec2f(2.0, 6.0), 4, 3u) * mix(0.4, 1.0, k.y), surf, uv, metalSparks(uv, t, 0.25, 0.8, 61u));
}

@fragment fn fs_mesh_grate(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let g = mix(6.0, 16.0, k.x);
  let bars = max(abs(fract(uv.x * g) - 0.5), abs(fract(uv.y * g) - 0.5));
  let surf = smoothstep(0.2, 0.45, bars);
  let heat = surf * (0.7 + 0.3 * fbm(uv * 3.0, 3, 3u) * mix(0.3, 1.0, k.y));
  return metalPresent(heat, surf, uv, metalSparks(uv, t, 0.3, 0.9, 61u));
}

@fragment fn fs_coil(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = 0.4 + 0.5 * (0.5 + 0.5 * sin(uv.y * mix(14.0, 34.0, k.x)));
  let heat = surf * (0.7 + 0.3 * sin(t * 0.6)) * mix(0.8, 1.2, k.y);
  return metalPresent(heat, surf, uv, metalSparks(uv, t, 0.2, 0.8, 61u));
}

@fragment fn fs_grinder(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(50.0, 90.0, k.x), t * 3.0, 0.8);
  let hot = hotspot(uv, vec2f(0.0, -0.2), 0.25) * 1.3;
  let sp = metalSparks(uv, t, mix(0.7, 1.0, k.x), mix(1.4, 2.2, k.y), 71u) + metalSparks(uv, t + 5.0, 0.8, 1.8, 88u);
  return metalPresent(hot + 0.3, surf, uv, sp * 1.4);
}

@fragment fn fs_welding(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(40.0, 70.0, k.x), 0.1, 0.7);
  let arc = hotspot(uv, vec2f(0.0, 0.0), 0.12) * 1.7;
  let sp = metalSparks(uv, t, mix(0.7, 1.0, k.x), mix(1.2, 2.0, k.y), 71u);
  return metalPresent(arc + 0.2, surf, uv, sp * 1.5);
}

@fragment fn fs_spark_fountain(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.6);
  let pool = smoothstep(0.5, -0.2, uv.y) * 1.2;
  let sp = metalSparks(uv, t, mix(0.8, 1.0, k.x), mix(1.3, 2.2, k.y), 71u);
  return metalPresent(pool + 0.2, surf, uv, sp * 1.4);
}

@fragment fn fs_cutting_torch(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(40.0, 70.0, k.x), 0.1, 0.7);
  let cut = exp(-uv.x * uv.x / 0.01) * 1.5;
  let sp = metalSparks(vec2f(uv.x, uv.y), t, mix(0.7, 1.0, k.x), mix(1.5, 2.5, k.y), 71u);
  return metalPresent(cut + 0.2, surf, uv, sp * 1.4);
}

@fragment fn fs_sparkler(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.6);
  var sp = 0.0;
  for (var i: i32 = 0; i < 3; i++) { let a = f32(i) * 2.094; sp += metalSparks(rot2(a) * uv, t + f32(i) * 3.0, mix(0.7, 1.0, k.x), mix(1.2, 2.0, k.y), 71u + u32(i)); }
  return metalPresent(hotspot(uv, vec2f(0.0), 0.15) * 1.3 + 0.2, surf, uv, sp * 1.2);
}

@fragment fn fs_slag(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(30.0, 60.0, k.x), 0.1, 0.6);
  let drip = smoothstep(0.6, -0.4, uv.y) * (0.7 + 0.3 * fbm(uv * vec2f(6.0, 3.0), 4, 3u));
  let sp = metalSparks(uv, t, mix(0.6, 0.9, k.x), mix(1.0, 1.8, k.y), 71u);
  return metalPresent(drip * 1.2 + 0.15, surf, uv, sp * 1.2);
}

@fragment fn fs_spark_burst(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(40.0, 70.0, k.x), 0.1, 0.7);
  let burst = pow(0.5 + 0.5 * sin(t * mix(1.5, 4.0, k.y)), 4.0);
  let seam = exp(-uv.y * uv.y / 0.02) * 1.2;
  let sp = metalSparks(uv, t, mix(0.7, 1.0, k.x), 1.6, 71u) * (0.4 + burst);
  return metalPresent(seam + 0.2, surf, uv, sp * 1.5);
}

@fragment fn fs_foundry(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(25.0, 55.0, k.x), 0.1, 0.6);
  let pour = exp(-uv.x * uv.x / mix(0.02, 0.06, k.x)) * 1.4;
  let sp = metalSparks(uv, t, 0.9, mix(1.4, 2.4, k.y), 71u);
  return metalPresent(pour + 0.3, surf, uv, sp * 1.3);
}

@fragment fn fs_temper(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(40.0, 80.0, k.x), 0.0, 0.8);
  let x = (0.5 + 0.5 * uv.x) * mix(0.6, 1.0, k.y) + 0.05 * fbm(uv * 3.0, 3, 3u);
  return vec4f(clamp(temperColor(x * u.energy) * (0.5 + 0.7 * surf), vec3f(0.0), vec3f(1.0)), 1.0);
}

@fragment fn fs_temper_sweep(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(40.0, 80.0, k.x), 0.0, 0.8);
  let x = fract(t * mix(0.05, 0.2, k.y)) + uv.x * 0.5;
  return vec4f(clamp(temperColor(x) * (0.5 + 0.7 * surf), vec3f(0.0), vec3f(1.0)), 1.0);
}

@fragment fn fs_temper_rings(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(40.0, 80.0, k.x), 0.0, 0.8);
  let x = clamp(1.0 - length(uv) * mix(1.2, 2.2, k.y), 0.0, 1.0);
  return vec4f(clamp(temperColor(x * u.energy) * (0.5 + 0.7 * surf), vec3f(0.0), vec3f(1.0)), 1.0);
}

@fragment fn fs_temper_marble(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(35.0, 70.0, k.x), 0.0, 0.8);
  var p = uv * mix(2.0, 4.0, k.x); p += vec2f(fbm(p + t * 0.03, 4, 33u), fbm(p + 5.2, 4, 41u)) * mix(0.4, 1.0, k.y);
  return vec4f(clamp(temperColor(fbm01(p, 4, 3u) * u.energy) * (0.5 + 0.7 * surf), vec3f(0.0), vec3f(1.0)), 1.0);
}

@fragment fn fs_temper_bands(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(50.0, 90.0, k.x), 1.5708, 0.9);
  let x = clamp(0.5 + 0.5 * uv.y, 0.0, 1.0) * u.energy;
  let banded = floor(x * mix(4.0, 8.0, k.y)) / mix(4.0, 8.0, k.y);
  return vec4f(clamp(temperColor(banded) * (0.5 + 0.7 * surf), vec3f(0.0), vec3f(1.0)), 1.0);
}

@fragment fn fs_bluing(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(40.0, 80.0, k.x), 0.0, 0.8);
  let x = mix(0.6, 0.95, k.y) + 0.06 * fbm(uv * 4.0, 3, 3u);
  return vec4f(clamp(temperColor(x) * (0.4 + 0.6 * surf), vec3f(0.0), vec3f(1.0)), 1.0);
}

@fragment fn fs_heat_tint(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let t = u.time;
  let k = u.k;
  let surf = brushed(uv, mix(40.0, 80.0, k.x), 1.5708, 0.8);
  let x = clamp(1.0 - abs(uv.x) * mix(2.0, 4.0, k.y), 0.0, 1.0);
  return vec4f(clamp(temperColor(x) * (0.5 + 0.7 * surf), vec3f(0.0), vec3f(1.0)), 1.0);
}
