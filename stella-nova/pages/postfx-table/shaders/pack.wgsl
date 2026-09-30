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

// ═══════════════════════════════════════════════════════════ more operators
// —— more blur / focus ————————————————————————————————————————————————————
@fragment fn fs_box_blur(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let r = mix(0.5, 6.0, u.k.x); var c = vec3f(0.0);
    for (var y: i32 = -2; y <= 2; y++) { for (var x: i32 = -2; x <= 2; x++) { c += src(uv + vec2f(f32(x), f32(y)) * r * texel()); } }
    return done(uv, c / 25.0);
}
@fragment fn fs_spin_blur(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let d = uv - 0.5; let ang = mix(0.02, 0.3, u.k.x); var c = vec3f(0.0);
    for (var i: i32 = 0; i < 9; i++) { let a = (f32(i) - 4.0) / 4.0 * ang; c += src(0.5 + rot2(a) * d); }
    return done(uv, c / 9.0);
}
@fragment fn fs_zoom_blur(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let d = uv - 0.5; let amt = mix(0.02, 0.4, u.k.x); var c = vec3f(0.0);
    for (var i: i32 = 0; i < 9; i++) { let s = 1.0 - amt * f32(i) / 8.0; c += src(0.5 + d * s); }
    return done(uv, c / 9.0);
}
@fragment fn fs_bilateral(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let r = mix(1.0, 4.0, u.k.x); let sc = src(uv); var c = vec3f(0.0); var nrm = 0.0;
    for (var y: i32 = -2; y <= 2; y++) { for (var x: i32 = -2; x <= 2; x++) {
        let o = vec2f(f32(x), f32(y)); let s = src(uv + o * r * texel());
        let ws = exp(-dot(o, o) * 0.3); let dc = s - sc; let wc = exp(-dot(dc, dc) * mix(4.0, 40.0, u.k.y));
        let w = ws * wc; c += s * w; nrm += w; } }
    return done(uv, c / max(nrm, 1e-3));
}
@fragment fn fs_defocus(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let d = length(uv - 0.5); let r = smoothstep(mix(0.0, 0.4, u.k.y), 0.7, d) * mix(1.0, 8.0, u.k.x);
    return done(uv, gauss2d(uv, r + 0.001));
}
@fragment fn fs_soft_focus(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let sharp = src(uv); let soft = gauss2d(uv, mix(2.0, 8.0, u.k.x));
    let c = mix(sharp, max(sharp, soft), mix(0.3, 0.9, u.k.y)) + soft * 0.15 * u.k.z;
    return done(uv, c);
}

// —— more color ———————————————————————————————————————————————————————————
@fragment fn fs_levels(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let bl = mix(0.0, 0.4, u.k.x); let wh = mix(0.6, 1.0, u.k.y);
    return done(uv, clamp((src(uv) - bl) / max(wh - bl, 1e-3), vec3f(0.0), vec3f(1.0)));
}
@fragment fn fs_temperature(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let t = mix(-0.3, 0.3, u.k.x);
    return done(uv, clamp(src(uv) + vec3f(t, 0.0, -t), vec3f(0.0), vec3f(1.0)));
}
@fragment fn fs_vibrance(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let c = src(uv); let l = luma(c); let sat = length(c - vec3f(l));
    let boost = mix(0.0, 2.0, u.k.x) * (1.0 - smoothstep(0.0, 0.5, sat));
    return done(uv, mix(vec3f(l), c, 1.0 + boost));
}
@fragment fn fs_sepia(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let l = luma(src(uv)); let c = mix(u.ink.rgb, u.cream.rgb, l) * vec3f(1.07, 0.99, 0.82);
    return done(uv, mix(vec3f(l), c, mix(0.3, 1.0, u.k.x)));
}
@fragment fn fs_invert(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let c = src(uv); return done(uv, mix(c, 1.0 - c, u.k.x));
}
@fragment fn fs_solarize(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let c = src(uv); let th = mix(0.3, 0.7, u.k.x);
    return done(uv, select(c, 1.0 - c, c > vec3f(th)));
}

// —— more texture —————————————————————————————————————————————————————————
@fragment fn fs_scanlines(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let s = 0.5 + 0.5 * sin(uv.y * mix(80.0, 400.0, u.k.x) * PI);
    return done(uv, src(uv) * mix(1.0, s, mix(0.2, 0.9, u.k.y)));
}
@fragment fn fs_stipple(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let sc = mix(120.0, 400.0, u.k.x); let g = floor(uv * sc);
    let l = luma(src((g + 0.5) / sc)); let ink = step(hash21(g), 1.0 - l);
    return done(uv, mix(u.cream.rgb, u.ink.rgb, ink));
}
@fragment fn fs_mosaic(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let sc = mix(10.0, 50.0, u.k.x); let g = uv * sc;
    let cell = floor(g); var best = 1e9; var pick = cell;
    for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) {
        let o = cell + vec2f(f32(x), f32(y)); let jit = vec2f(hash21(o), hash21(o + 7.0)); let cc = o + jit;
        let d = distance(g, cc); if (d < best) { best = d; pick = cc; } } }
    return done(uv, src(pick / sc));
}
@fragment fn fs_crosshatch(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let l = luma(src(uv)); let sc = mix(40.0, 120.0, u.k.x); let th = 0.25; var ink = 0.0;
    if (l < 0.75) { ink = max(ink, step(fract((uv.x + uv.y) * sc), th)); }
    if (l < 0.5) { ink = max(ink, step(fract((uv.x - uv.y) * sc), th)); }
    if (l < 0.25) { ink = max(ink, step(fract(uv.y * sc * 1.4), th)); }
    return done(uv, mix(u.cream.rgb, u.ink.rgb, ink * mix(0.6, 1.0, u.k.y)));
}
@fragment fn fs_dot_screen(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let sc = mix(30.0, 120.0, u.k.x); let ang = u.k.y * PI * 0.5;
    let q = rot2(ang) * (uv - 0.5) * sc; let g = fract(q) - 0.5;
    let l = luma(src(uv)); let r = sqrt(max(1.0 - l, 0.0)) * 0.7; let dotm = 1.0 - smoothstep(r - 0.1, r + 0.1, length(g));
    return done(uv, src(uv) * mix(1.0, mix(0.4, 1.0, dotm), mix(0.5, 1.0, u.k.z)));
}
@fragment fn fs_engrave(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let l = luma(src(uv)); let sc = mix(60.0, 220.0, u.k.x);
    let line = step(1.0 - l, fract(uv.y * sc));
    return done(uv, mix(u.ink.rgb, u.cream.rgb, line));
}

// —— more edges ———————————————————————————————————————————————————————————
@fragment fn fs_laplacian(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let e = texel() * mix(1.0, 3.0, u.k.x);
    let c = luma(src(uv)) * 4.0 - luma(src(uv + vec2f(e, 0.0))) - luma(src(uv - vec2f(e, 0.0))) - luma(src(uv + vec2f(0.0, e))) - luma(src(uv - vec2f(0.0, e)));
    let edge = clamp(abs(c) * mix(2.0, 8.0, u.k.y), 0.0, 1.0);
    return done(uv, mix(u.cream.rgb, u.ink.rgb, edge));
}
@fragment fn fs_prewitt(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let e = texel() * mix(1.0, 3.0, u.k.x); var gx = 0.0; var gy = 0.0;
    for (var i: i32 = -1; i <= 1; i++) {
        gx += luma(src(uv + vec2f(e, f32(i) * e))) - luma(src(uv + vec2f(-e, f32(i) * e)));
        gy += luma(src(uv + vec2f(f32(i) * e, e))) - luma(src(uv + vec2f(f32(i) * e, -e))); }
    let g = clamp(sqrt(gx * gx + gy * gy) * mix(1.0, 4.0, u.k.y), 0.0, 1.0);
    return done(uv, mix(u.ink.rgb, u.cream.rgb, g));
}
@fragment fn fs_cartoon(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let e = texel() * 1.5;
    let ed = abs(luma(src(uv + vec2f(e, 0.0))) - luma(src(uv - vec2f(e, 0.0)))) + abs(luma(src(uv + vec2f(0.0, e))) - luma(src(uv - vec2f(0.0, e))));
    let edge = 1.0 - smoothstep(0.05, 0.2, ed * mix(1.0, 4.0, u.k.y));
    let n = mix(3.0, 8.0, u.k.x); let c = floor(src(uv) * n) / n;
    return done(uv, c * edge);
}

// —— more lens ————————————————————————————————————————————————————————————
@fragment fn fs_pincushion(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let d = uv - 0.5; let r2 = dot(d, d); let k = mix(0.0, 0.8, u.k.x);
    return done(uv, src(0.5 + d * (1.0 - k * r2)));
}
@fragment fn fs_fisheye(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let d = uv - 0.5; let r = length(d) * 2.0; let k = mix(0.5, 2.0, u.k.x);
    let rr = pow(r, k) * 0.5; let dir = normalize(d + vec2f(1e-5));
    return done(uv, src(0.5 + dir * rr));
}
@fragment fn fs_chromatic_zoom(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let d = uv - 0.5; let amt = mix(0.0, 0.06, u.k.x) * length(d) * 2.0;
    let r = src(0.5 + d * (1.0 + amt)).r; let g = src(uv).g; let b = src(0.5 + d * (1.0 - amt)).b;
    return done(uv, vec3f(r, g, b));
}
@fragment fn fs_bleach_bypass(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let c = src(uv); let l = luma(c);
    let blend = mix(c * vec3f(l) * 2.0, 1.0 - 2.0 * (1.0 - c) * (1.0 - vec3f(l)), step(0.5, l));
    return done(uv, mix(c, blend, mix(0.3, 1.0, u.k.x)));
}
@fragment fn fs_dreamy(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let c = src(uv); let soft = gauss2d(uv, mix(3.0, 10.0, u.k.x)); let l = luma(c);
    return done(uv, mix(c, max(c, soft), 0.6) + soft * smoothstep(0.5, 1.0, l) * mix(0.0, 0.4, u.k.y));
}
@fragment fn fs_vhs(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let jit = (hash21(vec2f(floor(uv.y * 200.0), floor(u.time * 12.0))) - 0.5) * mix(0.0, 0.03, u.k.x);
    let r = src(uv + vec2f(jit + 0.004, 0.0)).r; let g = src(uv + vec2f(jit, 0.0)).g; let b = src(uv + vec2f(jit - 0.004, 0.0)).b;
    return done(uv, vec3f(r, g, b) * (0.9 + 0.1 * sin(uv.y * 300.0)));
}
@fragment fn fs_tonemap(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let c = src(uv) * mix(0.5, 3.0, u.k.x);
    let m = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
    return done(uv, clamp(m, vec3f(0.0), vec3f(1.0)));
}
@fragment fn fs_thin_film(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let c = src(uv); let l = luma(c); let ph = l * mix(4.0, 16.0, u.k.x) + u.time * 0.4;
    let tint = 0.5 + 0.5 * cos(vec3f(ph, ph + 2.09, ph + 4.19));
    return done(uv, mix(c, c * tint * 1.4, mix(0.2, 0.8, u.k.y)));
}

// —— game-lab operators: soft-knee bloom, comic bloom, hex bokeh, IGN tilt shift,
//    status vignettes, alpha outline, hex transition ————————————————————————
// tile-space coordinate: 0..1 over the visible cell, not over the source
fn tile_uv(fp: vec2f) -> vec2f { return (fp / u.pixelScale) / max(u.size, vec2f(1.0)); }
fn vnoise(p: vec2f) -> f32 {
    let i = floor(p); let f = fract(p); let w = f * f * (3.0 - 2.0 * f);
    let a = hash21(i); let b = hash21(i + vec2f(1.0, 0.0));
    let c = hash21(i + vec2f(0.0, 1.0)); let d = hash21(i + vec2f(1.0, 1.0));
    return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}
fn fbm2(p: vec2f) -> f32 { return 0.65 * vnoise(p) + 0.35 * vnoise(p * 2.03 + vec2f(17.1, 9.4)); }
// soft-knee bright pass: the knee k blends the threshold t in quadratically,
// so the cutoff has no hard step. Scales the color by its bloom share.
fn soft_knee(c: vec3f, t: f32, k: f32) -> vec3f {
    let b = max(c.r, max(c.g, c.b));
    let q = clamp(b - t + k, 0.0, 2.0 * k);
    let w = q * q / (4.0 * k + 1e-4);
    return c * max(w, b - t) / max(b, 1e-4);
}
// bloom_softknee: k.x threshold, k.y knee, k.z intensity, k.w radius
@fragment fn fs_bloom_softknee(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let thr = mix(0.2, 0.95, u.k.x); let knee = mix(0.0, 0.5, u.k.y);
    let R = mix(0.01, 0.12, u.k.w) * (1.0 + 0.1 * sin(u.time * 0.9));
    var b = vec3f(0.0); var nrm = 0.0;
    for (var i: i32 = 0; i < 40; i++) {
        let r = sqrt((f32(i) + 0.5) / 40.0); let a = f32(i) * 2.39996323;
        let w = exp(-3.0 * r * r);
        b += soft_knee(src(uv + vec2f(cos(a), sin(a)) * r * R), thr, knee) * w; nrm += w; }
    return done(uv, src(uv) + b / nrm * mix(0.0, 6.0, u.k.z));
}
// bloom_comic: only saturated, bright pixels bloom (hard step on a
// saturation mask), and the halo is quantized to flat bands.
// k.x saturation cut, k.y band count, k.z intensity, k.w radius
fn comic_mask(c: vec3f, cut: f32) -> f32 {
    let mx = max(c.r, max(c.g, c.b)); let mn = min(c.r, min(c.g, c.b));
    let sat = (mx - mn) / max(mx, 1e-4);
    return step(cut, sat) * step(0.25, mx);
}
@fragment fn fs_bloom_comic(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let cut = mix(0.1, 0.8, u.k.x); let R = mix(0.02, 0.14, u.k.w);
    var h = vec3f(0.0); var nrm = 0.0;
    for (var i: i32 = 0; i < 40; i++) {
        let r = sqrt((f32(i) + 0.5) / 40.0); let a = f32(i) * 2.39996323;
        let s = src(uv + vec2f(cos(a), sin(a)) * r * R); let w = 1.0 - 0.7 * r;
        h += s * comic_mask(s, cut) * w; nrm += w; }
    h = h / nrm * mix(1.0, 5.0, u.k.z);
    let levels = floor(mix(2.0, 6.0, u.k.y));
    let m = max(h.r, max(h.g, h.b));
    let q = floor(m * levels + 0.35 + 0.15 * sin(u.time * 2.0)) / levels;
    let halo = h / max(m, 1e-4) * min(q, 1.0);
    let c = src(uv);
    // saturated source pixels get pushed up too, so the mask reads in the image
    let pop = c * (1.0 + 0.35 * comic_mask(c, cut));
    return done(uv, max(pop, pop + halo * (1.0 - luma(pop) * 0.5)));
}
// bokeh_hex: golden-angle disc taps, each radius remapped so the disc becomes
// a hexagon (boundary distance cos(30°)/cos(θ mod 60° − 30°)). The spiral
// turns per pixel by interleaved gradient noise and the radius jitters, so a
// point light fills a solid hexagon instead of printing the tap pattern.
// k.x radius, k.y highlights, k.z rotation
@fragment fn fs_bokeh_hex(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let R = mix(3.0, 30.0, u.k.x) * texel();
    let spin = mix(0.0, PI / 3.0, u.k.z) + u.time * 0.2;
    let jit = hash21(fp.xy); let jr = hash21(fp.xy + vec2f(7.3, 1.9));
    var c = vec3f(0.0);
    for (var i: i32 = 0; i < 96; i++) {
        let r = sqrt((f32(i) + jr) / 96.0); let a = f32(i) * 2.39996323 + jit * TAU;
        let sector = a - (PI / 3.0) * floor(a / (PI / 3.0));
        let hx = 0.8660254 / cos(sector - PI / 6.0);
        let s = src(uv + rot2(spin) * vec2f(cos(a), sin(a)) * r * hx * R);
        // bright taps count as HDR light: a plain mean of boosted taps spreads
        // each highlight into a flat hexagon that clips to white
        c += s * (1.0 + mix(0.0, 60.0, u.k.y) * smoothstep(0.88, 1.0, luma(s))); }
    return done(uv, c / 96.0);
}
// tilt_shift_ign: sunflower taps around each pixel. Left half: one fixed tap
// pattern for every pixel, so the few taps print as ghost copies (banding).
// Right half: the pattern turns per pixel by interleaved gradient noise
// (Jimenez 2014), and the ghosts break up into fine noise.
// k.x radius, k.y focus, k.z band width, k.w tap count
@fragment fn fs_tilt_shift_ign(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let tu = tile_uv(fp.xy);
    let focus = mix(0.2, 0.8, u.k.y) + 0.05 * sin(u.time * 0.7);
    let R = smoothstep(0.0, mix(0.1, 0.4, u.k.z), abs(uv.y - focus)) * mix(2.0, 20.0, u.k.x) * texel();
    let n = i32(mix(6.0, 24.0, u.k.w)); let right = tu.x > 0.5;
    let spin = select(0.0, ign(fp.xy) * TAU, right);
    var c = vec3f(0.0);
    for (var i: i32 = 0; i < n; i++) {
        let r = sqrt((f32(i) + 0.5) / f32(n)); let a = f32(i) * 2.39996323 + spin;
        c += src(uv + vec2f(cos(a), sin(a)) * r * R); }
    c /= f32(n);
    // split line and A/B marks
    let px = 1.0 / max(u.size.x, 1.0);
    let line = 1.0 - smoothstep(0.0, 1.5 * px, abs(tu.x - 0.5));
    return done(uv, mix(c, u.cream.rgb, line * 0.8));
}
// status vignette: a screen-edge front, warped by two octaves of noise.
// Returns x = coverage (1 at the edge), y = front glow, z = veins, w = sparkle.
fn status_front(fp: vec2f, reach: f32, t: f32) -> vec4f {
    let tu = tile_uv(fp); let asp = u.size.x / max(u.size.y, 1.0);
    let p = vec2f(tu.x * asp, tu.y) * 5.0;
    // two-octave domain warp
    let q = vec2f(fbm2(p + vec2f(0.0, t * 0.15)), fbm2(p + vec2f(5.2, 1.3)));
    let r2 = vec2f(fbm2(p + 3.0 * q + vec2f(1.7, 9.2)), fbm2(p + 3.0 * q + vec2f(8.3, 2.8 + t * 0.1)));
    let warp = fbm2(p + 3.5 * r2);
    let e = min(min(tu.x, 1.0 - tu.x), min(tu.y, 1.0 - tu.y));
    let f = e - reach - (warp - 0.5) * 0.22;
    let cover = 1.0 - smoothstep(-0.01, 0.01, f);
    let glow = exp(-abs(f) * 40.0);
    // fern-like veins: ridged noise along the warped field, two scales
    let v1 = 1.0 - abs(2.0 * vnoise(p * 2.2 + 4.0 * r2) - 1.0);
    let v2 = 1.0 - abs(2.0 * vnoise(p * 5.3 + 2.0 * q + vec2f(3.1, 7.7)) - 1.0);
    let veins = pow(v1, 14.0) + 0.6 * pow(v2, 18.0);
    // facet sparkle: one hashed point per grid facet, blinking with time
    let g = p * 6.0; let id = floor(g); let fc = fract(g) - 0.5;
    let h = hash21(id + floor(t * 1.5 + hash21(id) * 7.0));
    let spark = step(0.9, h) * smoothstep(0.18, 0.0, length(fc)) * (0.6 + 0.4 * sin(t * 6.0 + h * 40.0));
    return vec4f(cover, glow, veins, spark);
}
// vignette_frost: k.x reach, k.y vein strength, k.z sparkle
@fragment fn fs_vignette_frost(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let c = src(uv);
    let reach = mix(0.05, 0.35, u.k.x) + 0.02 * sin(u.time * 0.8);
    let s = status_front(fp.xy, reach, u.time);
    let ice = mix(vec3f(0.55, 0.72, 0.92), vec3f(0.92, 0.97, 1.0), s.z);
    let frosted = mix(mix(c, vec3f(luma(c)), 0.7) * vec3f(0.75, 0.88, 1.1), ice, 0.55 + 0.4 * s.z * u.k.y * 2.0);
    var o = mix(c * vec3f(0.92, 0.97, 1.05), frosted, s.x);
    o += vec3f(0.7, 0.85, 1.0) * s.y * 0.6 + vec3f(1.0) * s.w * s.x * mix(0.0, 2.0, u.k.z);
    return done(uv, o);
}
// vignette_molten: k.x reach, k.y crack strength, k.z ember sparkle
@fragment fn fs_vignette_molten(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let c = src(uv);
    let reach = mix(0.05, 0.35, u.k.x) + 0.02 * sin(u.time * 0.8);
    let s = status_front(fp.xy, reach, u.time * 0.7);
    let crust = vec3f(0.09, 0.04, 0.03) + c * 0.12;
    let lava = mix(vec3f(0.9, 0.18, 0.02), vec3f(1.0, 0.75, 0.2), s.z);
    let inner = mix(crust, lava, clamp(s.z * mix(0.0, 2.5, u.k.y), 0.0, 1.0));
    var o = mix(c * vec3f(1.05, 0.92, 0.85), inner, s.x);
    o += vec3f(1.0, 0.4, 0.06) * s.y * 1.1 + vec3f(1.0, 0.8, 0.4) * s.w * s.x * mix(0.0, 2.0, u.k.z);
    return done(uv, o);
}
// alpha_outline: an alpha mask from a chroma key against the backdrop color
// (the mean of three taps on the top edge), blurred over five taps, inside a
// soft circle. The outline is max − min of eight alpha taps around the pixel.
// Inside: desaturate, then tint with the tone swatch. Outside: dim.
// k.x key threshold, k.y width, k.z tint, k.w circle radius (max: no circle)
fn outline_alpha(uv: vec2f, bg: vec3f) -> f32 {
    let thr = mix(0.0, 0.4, u.k.x); let o = 3.0 * texel();
    let c = 0.4 * src(uv) + 0.15 * (src(uv + vec2f(o, 0.0)) + src(uv - vec2f(o, 0.0)) + src(uv + vec2f(0.0, o)) + src(uv - vec2f(0.0, o)));
    let key = smoothstep(thr, thr + 0.1, length(c - bg));
    let rc = mix(0.2, 0.75, u.k.w);
    let circ = 1.0 - smoothstep(rc - 0.02, rc + 0.02, length(uv - 0.5));
    return key * circ;
}
@fragment fn fs_alpha_outline(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let c = src(uv);
    let bg = (src(vec2f(0.35, 0.02)) + src(vec2f(0.5, 0.02)) + src(vec2f(0.65, 0.02))) / 3.0;
    let a = outline_alpha(uv, bg);
    let w = mix(1.0, 8.0, u.k.y) * texel() * (1.0 + 0.2 * sin(u.time * 3.0));
    var amin = a; var amax = a;
    for (var i: i32 = 0; i < 8; i++) {
        let ang = f32(i) * PI / 4.0; let s = outline_alpha(uv + vec2f(cos(ang), sin(ang)) * w, bg);
        amin = min(amin, s); amax = max(amax, s); }
    let edge = clamp(amax - amin, 0.0, 1.0);
    let tinted = mix(vec3f(luma(c)), vec3f(luma(c)) * u.tone.rgb * 1.8, mix(0.2, 1.0, u.k.z));
    var o = mix(c * 0.35, tinted, a);
    o = mix(o, vec3f(1.0, 0.86, 0.3), edge);
    return done(uv, o);
}
// hex_wipe: hex tiles flip between the photo and a gradient-mapped copy.
// Progress ping-pongs 0 → 1 → 0; each tile turns in order of its distance
// along a diagonal, with a hashed delay. k.x tile count, k.y spread, k.z edge
fn hex_cell(p: vec2f) -> vec4f {
    let r = vec2f(1.0, 1.7320508); let h = r * 0.5;
    let a = p - r * floor(p / r) - h;
    let pb = p - h; let b = pb - r * floor(pb / r) - h;
    let gv = select(b, a, dot(a, a) < dot(b, b));
    return vec4f(gv, p - gv);
}
@fragment fn fs_hex_wipe(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let tu = tile_uv(fp.xy);
    let n = mix(4.0, 16.0, u.k.x); let asp = u.size.x / max(u.size.y, 1.0);
    let hc = hex_cell(vec2f(tu.x * asp, tu.y) * n);
    let prog = 1.0 - abs(2.0 * fract(0.25 + u.time * 0.08) - 1.0);
    let order = clamp((hc.z / n / asp + hc.w / n) * 0.5, 0.0, 1.0) * 0.8 + hash21(hc.zw) * 0.2;
    let spread = mix(0.05, 0.4, u.k.y);
    let s = clamp((prog * (1.0 + spread) - order) / spread, 0.0, 1.0);
    let ag = abs(hc.xy); let hd = max(dot(ag, vec2f(0.5, 0.8660254)), ag.x);
    let inside = 1.0 - smoothstep(s * 0.5 - 0.02, s * 0.5, hd);
    let c = src(uv); let b = ramp(luma(c)) * 1.1;
    let rim = smoothstep(0.03, 0.0, abs(hd - s * 0.5)) * step(0.001, s) * step(s, 0.999) * mix(0.0, 1.0, u.k.z);
    return done(uv, mix(c, b, inside) + u.cream.rgb * rim);
}
