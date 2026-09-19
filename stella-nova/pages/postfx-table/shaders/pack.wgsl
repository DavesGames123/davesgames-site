// ═══════════════════════════════════════════════════════════════════════════
//  POST-PROCESS TABLE  ·  image operators, one WGSL fragment function per cell.
//  Every cell reads the shared source texture through `src(uv)` and returns a
//  color. uv is 0..1 over the cell (aspect-corrected, zoomable), t the hover
//  clock, k the four knobs (0..1), amt the global strength.
//
//  References: Gaussian/bokeh/Kuwahara/DoG/unsharp — standard image-processing
//  formulations (Gonzalez & Woods); halftone/dither — Bayer ordered dithering,
//  interleaved gradient noise (Jimenez 2014); CRT — Lottes' "CRT shader" idea
//  (scanline + shadow mask + curvature); bloom — Jimenez 2014 bright-pass +
//  wide blur; barrel distortion — Brown–Conrady radial model; hue rotation in
//  YIQ (Ken Perlin's hue-shift matrix); OKLab — Björn Ottosson.
// ═══════════════════════════════════════════════════════════════════════════

struct PostU {
    size: vec2f, time: f32, pixelScale: f32,
    ink: vec4f, tone: vec4f, cream: vec4f,
    amt: f32, zoom: f32, pad0: f32, pad1: f32,
    k: vec4f,
}
@group(0) @binding(0) var<uniform> u: PostU;
@group(0) @binding(1) var srcTex: texture_2d<f32>;
@group(0) @binding(2) var srcSmp: sampler;

const PI: f32 = 3.14159265358979;
const TAU: f32 = 6.28318530717959;

@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(p[i], 0.0, 1.0);
}
fn cell_uv(fp: vec2f) -> vec2f {
    let pos = fp / u.pixelScale;
    let c = (pos - 0.5 * u.size) / max(min(u.size.x, u.size.y), 1.0);
    return c / u.zoom + 0.5;
}
fn src(uv: vec2f) -> vec3f { return textureSampleLevel(srcTex, srcSmp, uv, 0.0).rgb; }
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
fn texel() -> f32 { return 1.0 / 512.0; }
fn hash21(p: vec2f) -> f32 { var q = fract(p * vec2f(123.34, 456.21)); q += dot(q, q + 45.32); return fract(q.x * q.y); }
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }
fn rot2(a: f32) -> mat2x2f { let c = cos(a); let s = sin(a); return mat2x2f(c, s, -s, c); }
fn ramp(v: f32) -> vec3f { let lo = mix(u.ink.rgb, u.tone.rgb, smoothstep(0.0, 0.62, v)); return mix(lo, u.cream.rgb, smoothstep(0.62, 1.0, v)); }
fn out(c: vec3f) -> vec4f { return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), 1.0); }
// blend the operator result with the source by the global amount
fn done(uv: vec2f, c: vec3f) -> vec4f { return out(mix(src(uv), c, u.amt)); }

// —— blur / focus ————————————————————————————————————————————————————————
fn gauss9(uv: vec2f, dir: vec2f) -> vec3f {
    var w = array<f32, 5>(0.2270270270, 0.1945945946, 0.1216216216, 0.0540540541, 0.0162162162);
    var c = src(uv) * w[0];
    for (var i: i32 = 1; i < 5; i++) { c += (src(uv + dir * f32(i)) + src(uv - dir * f32(i))) * w[i]; }
    return c;
}
fn gauss2d(uv: vec2f, r: f32) -> vec3f {
    // 5x5 separable Gaussian sampled bilinearly, r in texels
    var c = vec3f(0.0); var nrm = 0.0;
    for (var y: i32 = -2; y <= 2; y++) { for (var x: i32 = -2; x <= 2; x++) {
        let o = vec2f(f32(x), f32(y)); let w = exp(-dot(o, o) * 0.35);
        c += src(uv + o * r * texel()) * w; nrm += w; } }
    return c / nrm;
}
@fragment fn fs_gaussian(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let r = mix(0.5, 8.0, u.k.x) * (1.0 + 0.15 * sin(u.time * 1.3));
    return done(uv, gauss2d(uv, r));
}
// bokeh: golden-angle spiral of taps on a disc, bright taps weighted up (the "cat's eye" look)
@fragment fn fs_bokeh(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let R = mix(2.0, 24.0, u.k.x) * texel(); let n = 48;
    var c = vec3f(0.0); var nrm = 0.0;
    for (var i: i32 = 0; i < 48; i++) {
        let r = sqrt((f32(i) + 0.5) / f32(n)); let a = f32(i) * 2.39996323;
        let s = src(uv + vec2f(cos(a), sin(a)) * r * R);
        let w = 1.0 + mix(0.0, 8.0, u.k.y) * pow(luma(s), 4.0);
        c += s * w; nrm += w; }
    return done(uv, c / nrm);
}
@fragment fn fs_radial_blur(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let d = (uv - 0.5) * mix(0.0, 0.25, u.k.x); var c = vec3f(0.0);
    for (var i: i32 = 0; i < 16; i++) { c += src(uv - d * (f32(i) / 16.0)); }
    return done(uv, c / 16.0);
}
@fragment fn fs_motion_blur(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let a = u.k.y * PI + 0.2 * sin(u.time); let d = vec2f(cos(a), sin(a)) * mix(0.0, 0.08, u.k.x); var c = vec3f(0.0);
    for (var i: i32 = 0; i < 16; i++) { c += src(uv + d * ((f32(i) / 15.0) - 0.5)); }
    return done(uv, c / 16.0);
}
@fragment fn fs_tilt_shift(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let focus = mix(0.2, 0.8, u.k.y) + 0.05 * sin(u.time * 0.7);
    let r = smoothstep(0.0, mix(0.1, 0.4, u.k.z), abs(uv.y - focus)) * mix(1.0, 8.0, u.k.x);
    return done(uv, gauss2d(uv, r));
}
@fragment fn fs_unsharp(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let b = gauss2d(uv, mix(1.0, 4.0, u.k.y)); let s = src(uv);
    return done(uv, s + (s - b) * mix(0.0, 4.0, u.k.x));
}

// —— color ————————————————————————————————————————————————————————————————
@fragment fn fs_curves(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); var c = src(uv);
    let contrast = mix(0.5, 2.5, u.k.x); let gamma = mix(0.4, 2.5, u.k.y); let lift = mix(-0.2, 0.2, u.k.z);
    c = (c - 0.5) * contrast + 0.5 + lift; c = pow(clamp(c, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / gamma));
    return done(uv, c);
}
@fragment fn fs_saturation(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let c = src(uv); let l = luma(c);
    let sat = mix(0.0, 3.0, u.k.x); let vib = mix(0.0, 2.0, u.k.y) * (1.0 - max(max(c.r, c.g), c.b) + min(min(c.r, c.g), c.b));
    return done(uv, mix(vec3f(l), c, sat + vib));
}
// hue rotation in YIQ (Perlin's matrix), animated on hover
@fragment fn fs_hue_rotate(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let c = src(uv); let a = u.k.x * TAU + u.time * 0.6 * u.k.y;
    let toYIQ = mat3x3f(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
    let toRGB = mat3x3f(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
    var yiq = toYIQ * c; let h = atan2(yiq.z, yiq.y) + a; let ch = length(yiq.yz);
    yiq = vec3f(yiq.x, ch * cos(h), ch * sin(h));
    return done(uv, toRGB * yiq);
}
@fragment fn fs_gradient_map(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let l = pow(luma(src(uv)), mix(0.5, 2.0, u.k.x));
    return done(uv, ramp(l));
}
@fragment fn fs_posterize(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let n = floor(mix(2.0, 12.0, u.k.x));
    return done(uv, floor(src(uv) * n + 0.5) / n);
}
@fragment fn fs_duotone(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let l = luma(src(uv));
    let shadow = mix(u.ink.rgb, vec3f(0.35, 0.10, 0.25), u.k.x); let hi = mix(u.cream.rgb, vec3f(1.0, 0.85, 0.55), u.k.y);
    return done(uv, mix(shadow, hi, pow(l, mix(0.5, 2.0, u.k.z))));
}

// —— texture / print ————————————————————————————————————————————————————————
@fragment fn fs_grain(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let g = hash21(floor(fp.xy / mix(1.0, 4.0, u.k.y)) + floor(u.time * 24.0) * 0.37) - 0.5;
    let c = src(uv); let l = luma(c);
    return done(uv, c + g * mix(0.0, 0.6, u.k.x) * (1.0 - l * u.k.z));
}
// halftone: a rotated dot screen, dot radius from luminance
@fragment fn fs_halftone(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let cells = mix(20.0, 120.0, u.k.x); let ang = u.k.y * PI * 0.5 + 0.3;
    let q = rot2(ang) * (uv - 0.5) * cells; let cellc = floor(q) + 0.5; let center = rot2(-ang) * (cellc / cells) + 0.5;
    let l = luma(src(center)); let r = sqrt(1.0 - l) * 0.75;
    let d = length(q - cellc); let ink = 1.0 - smoothstep(r - 0.08, r + 0.08, d);
    return done(uv, mix(u.cream.rgb, u.ink.rgb, ink));
}
@fragment fn fs_hatching(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let f = mix(60.0, 220.0, u.k.x); let l = luma(src(uv)); var ink = 0.0;
    let q = uv * f;
    if (l < 0.75) { ink = max(ink, step(0.5, fract(q.x + q.y))); }
    if (l < 0.5) { ink = max(ink, step(0.5, fract(q.x - q.y))); }
    if (l < 0.3) { ink = max(ink, step(0.5, fract(q.y * 1.4))); }
    if (l < 0.12) { ink = 1.0; }
    return done(uv, mix(u.cream.rgb, u.ink.rgb, ink * mix(0.6, 1.0, u.k.y)));
}
@fragment fn fs_pixelate(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let n = mix(8.0, 96.0, u.k.x) * (1.0 + 0.1 * sin(u.time));
    let q = (floor(uv * n) + 0.5) / n; var c = src(q);
    if (u.k.y > 0.5) { let lv = floor(mix(2.0, 8.0, u.k.z)); c = floor(c * lv + 0.5) / lv; }
    return done(uv, c);
}
// Kuwahara: the mean of the lowest-variance quadrant — the oil-paint filter
@fragment fn fs_kuwahara(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let r = mix(1.0, 6.0, u.k.x) * texel(); var best = vec3f(0.0); var bestVar = 1e9;
    for (var q: i32 = 0; q < 4; q++) {
        let sgn = vec2f(select(-1.0, 1.0, (q & 1) == 1), select(-1.0, 1.0, (q & 2) == 2));
        var m = vec3f(0.0); var m2 = vec3f(0.0);
        for (var y: i32 = 0; y < 4; y++) { for (var x: i32 = 0; x < 4; x++) {
            let c = src(uv + sgn * vec2f(f32(x), f32(y)) * r * 0.75); m += c; m2 += c * c; } }
        m /= 16.0; m2 = m2 / 16.0 - m * m; let v = m2.r + m2.g + m2.b;
        if (v < bestVar) { bestVar = v; best = m; }
    }
    return done(uv, best);
}
@fragment fn fs_dither(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let px = floor(fp.xy / mix(1.0, 4.0, u.k.y));
    let n = ign(px) - 0.5; let l = luma(src(uv)) + n * mix(0.2, 1.0, u.k.x);
    let lv = floor(mix(1.0, 6.0, u.k.z)); let q = floor(l * lv + 0.5) / lv;
    return done(uv, mix(u.ink.rgb, u.cream.rgb, q));
}

// —— edges / structure —————————————————————————————————————————————————————
fn sobel(uv: vec2f, s: f32) -> vec2f {
    let e = texel() * s;
    let tl = luma(src(uv + vec2f(-e, -e))); let tc = luma(src(uv + vec2f(0.0, -e))); let tr = luma(src(uv + vec2f(e, -e)));
    let ml = luma(src(uv + vec2f(-e, 0.0)));                                        let mr = luma(src(uv + vec2f(e, 0.0)));
    let bl = luma(src(uv + vec2f(-e, e)));  let bc = luma(src(uv + vec2f(0.0, e)));  let br = luma(src(uv + vec2f(e, e)));
    return vec2f((tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl), (bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr));
}
@fragment fn fs_sobel(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let g = sobel(uv, mix(0.5, 3.0, u.k.y)); let m = clamp(length(g) * mix(0.5, 4.0, u.k.x), 0.0, 1.0);
    return done(uv, ramp(m));
}
@fragment fn fs_emboss(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let a = u.k.y * TAU + u.time * 0.5; let e = texel() * mix(1.0, 4.0, u.k.z) * vec2f(cos(a), sin(a));
    let d = luma(src(uv + e)) - luma(src(uv - e));
    return done(uv, vec3f(0.5 + d * mix(1.0, 6.0, u.k.x)));
}
@fragment fn fs_sharpen(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let e = texel(); let c = src(uv);
    let n = src(uv + vec2f(0.0, -e)) + src(uv + vec2f(0.0, e)) + src(uv + vec2f(-e, 0.0)) + src(uv + vec2f(e, 0.0));
    return done(uv, c + (c * 4.0 - n) * mix(0.0, 2.0, u.k.x));
}
// difference of Gaussians, thresholded — the pencil sketch
@fragment fn fs_dog_sketch(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let a = luma(gauss2d(uv, 1.0)); let b = luma(gauss2d(uv, mix(2.0, 5.0, u.k.x)));
    let d = (a - b) * mix(4.0, 20.0, u.k.y); let ink = smoothstep(0.0, 0.3, -d);
    return done(uv, mix(u.cream.rgb, u.ink.rgb, ink));
}
@fragment fn fs_edge_glow(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let g = length(sobel(uv, 1.5)); let c = src(uv);
    return done(uv, c * 0.5 + u.tone.rgb * g * mix(0.5, 3.0, u.k.x) + u.cream.rgb * pow(g, 3.0));
}

// —— lens / display ————————————————————————————————————————————————————————
@fragment fn fs_bloom(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let thr = mix(0.3, 0.9, u.k.y); var b = vec3f(0.0); var nrm = 0.0;
    for (var i: i32 = 0; i < 32; i++) {
        let r = sqrt((f32(i) + 0.5) / 32.0); let a = f32(i) * 2.39996323;
        let s = src(uv + vec2f(cos(a), sin(a)) * r * mix(0.02, 0.12, u.k.z)); let w = 1.0 - r;
        b += max(s - thr, vec3f(0.0)) * w; nrm += w; }
    return done(uv, src(uv) + b / nrm * mix(0.0, 4.0, u.k.x));
}
@fragment fn fs_vignette(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let d = length((uv - 0.5) * vec2f(1.0, mix(0.6, 1.4, u.k.z)));
    let v = 1.0 - smoothstep(mix(0.2, 0.6, u.k.y), 0.9, d) * u.k.x;
    return done(uv, src(uv) * v);
}
@fragment fn fs_aberration(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let d = (uv - 0.5) * mix(0.0, 0.06, u.k.x) * (1.0 + 0.3 * sin(u.time * 2.0) * u.k.y);
    return done(uv, vec3f(src(uv + d).r, src(uv).g, src(uv - d).b));
}
// Brown–Conrady radial distortion
@fragment fn fs_barrel(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let c = uv - 0.5; let r2 = dot(c, c); let k1 = mix(-0.6, 0.8, u.k.x) + 0.2 * sin(u.time * 0.8) * u.k.y;
    let q = c * (1.0 + k1 * r2) + 0.5;
    let inside = step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0);
    return done(uv, src(q) * inside);
}
@fragment fn fs_crt(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    var uv = cell_uv(fp.xy); let c = uv - 0.5; uv = c * (1.0 + mix(0.0, 0.25, u.k.z) * dot(c, c)) + 0.5;
    let inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    var col = src(uv) * inside;
    let lines = mix(120.0, 320.0, u.k.x); let scan = 0.75 + 0.25 * sin(uv.y * lines * PI * 2.0 + u.time * 6.0);
    let m = i32(fp.x) % 3; let mask = vec3f(select(0.6, 1.0, m == 0), select(0.6, 1.0, m == 1), select(0.6, 1.0, m == 2));
    col = col * scan * mix(vec3f(1.0), mask, u.k.y) * 1.25;
    return done(uv, col);
}
@fragment fn fs_glitch(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    var uv = cell_uv(fp.xy); let t = floor(u.time * 12.0);
    let row = floor(uv.y * mix(8.0, 40.0, u.k.y)); let h = hash21(vec2f(row, t));
    let on = step(1.0 - mix(0.05, 0.5, u.k.x), h);
    uv.x += on * (hash21(vec2f(t, row)) - 0.5) * 0.3;
    let block = step(0.97, hash21(floor(uv * 12.0) + t));
    var col = vec3f(src(uv + on * vec2f(0.01, 0.0)).r, src(uv).g, src(uv - on * vec2f(0.01, 0.0)).b);
    col = mix(col, u.tone.rgb, block * u.k.z);
    return done(uv, col);
}
@fragment fn fs_shimmer(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let q = uv * mix(3.0, 12.0, u.k.y);
    let d = vec2f(sin(q.y * 2.0 + u.time * 2.0) + sin(q.y * 3.7 - u.time * 1.3), cos(q.x * 2.3 + u.time * 1.7)) * mix(0.0, 0.03, u.k.x);
    return done(uv, src(uv + d));
}
@fragment fn fs_old_film(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); var c = src(uv); let l = luma(c);
    c = mix(vec3f(l), c, 0.3) * vec3f(1.0, 0.92, 0.78);
    let frame = floor(u.time * 18.0);
    c += (hash21(fp.xy + frame) - 0.5) * mix(0.05, 0.4, u.k.x);
    let sx = hash21(vec2f(frame, 3.0)); let scratch = step(0.995, 1.0 - abs(uv.x - sx) * 60.0 * hash21(vec2f(frame, floor(uv.y * 8.0))));
    c = mix(c, vec3f(0.9), scratch * step(0.5, hash21(vec2f(frame, 7.0))) * u.k.y);
    c *= 0.85 + 0.15 * hash21(vec2f(frame, 1.0));
    c *= 1.0 - smoothstep(0.3, 0.85, length(uv - 0.5)) * 0.7;
    return done(uv, c);
}
