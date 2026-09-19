// ═══════════════════════════════════════════════════════════════════════════
//  COLOR & TONE TABLE  ·  one color function per cell, applied to a shared
//  scalar field v in 0..1 (the same field for every cell so the mappings can
//  be compared). The field is exposed as HDR for the tonemappers: hdr = v * exposure.
//
//  References: Quilez cosine palettes; viridis/magma/turbo polynomial fits
//  (Mikhailov's turbo fit, Garnier's viridis family fit); OKLab/OKLCH — Björn
//  Ottosson 2020; ACES fit — Narkowicz 2015; Uncharted 2 — Hable 2010; AgX —
//  Troy Sobotka / the Blender AgX sigmoid fit (Benjamin Wrensch); PBR Neutral
//  — Khronos 2023; Planckian locus fit — Kang et al. 2002; protanopia matrix —
//  Machado, Oliveira & Fernandes 2009; Bayer/IGN dithering as in the post table.
// ═══════════════════════════════════════════════════════════════════════════

struct ColorU {
    size: vec2f, time: f32, pixelScale: f32,
    ink: vec4f, tone: vec4f, cream: vec4f,
    exposure: f32, contrast: f32, pad0: f32, pad1: f32,
    k: vec4f,
}
@group(0) @binding(0) var<uniform> u: ColorU;
@group(0) @binding(1) var fieldTex: texture_2d<f32>;
@group(0) @binding(2) var fieldSmp: sampler;

const PI: f32 = 3.14159265358979;
const TAU: f32 = 6.28318530717959;

@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(p[i], 0.0, 1.0);
}
fn cell_uv(fp: vec2f) -> vec2f { let pos = fp / u.pixelScale; return (pos - 0.5 * u.size) / max(min(u.size.x, u.size.y), 1.0) + 0.5; }
// the field, contrast-adjusted around 0.5
fn field(uv: vec2f) -> f32 { let v = textureSampleLevel(fieldTex, fieldSmp, uv, 0.0).r; return clamp((v - 0.5) * u.contrast + 0.5, 0.0, 1.0); }
fn out(c: vec3f) -> vec4f { return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), 1.0); }
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
fn srgb_to_linear(c: vec3f) -> vec3f { return select(c / 12.92, pow((c + 0.055) / 1.055, vec3f(2.4)), c > vec3f(0.04045)); }
fn linear_to_srgb(c: vec3f) -> vec3f { return select(c * 12.92, 1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c > vec3f(0.0031308)); }
fn hsv2rgb(h: f32, s: f32, v: f32) -> vec3f { let k = fract(vec3f(h, h + 2.0 / 3.0, h + 1.0 / 3.0)) * 6.0; let p = abs(k - 3.0) - 1.0; return v * mix(vec3f(1.0), clamp(p, vec3f(0.0), vec3f(1.0)), s); }
// OKLab (Ottosson): linear sRGB ↔ Lab
fn linear_to_oklab(c: vec3f) -> vec3f {
    let l = pow(0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b, 1.0 / 3.0);
    let m = pow(0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b, 1.0 / 3.0);
    let s = pow(0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b, 1.0 / 3.0);
    return vec3f(0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s);
}
fn oklab_to_linear(lab: vec3f) -> vec3f {
    let l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z; let m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z; let s_ = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
    let l = l_ * l_ * l_; let m = m_ * m_ * m_; let s = s_ * s_ * s_;
    return vec3f(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}
fn oklch(L: f32, C: f32, h: f32) -> vec3f { return clamp(linear_to_srgb(oklab_to_linear(vec3f(L, C * cos(h), C * sin(h)))), vec3f(0.0), vec3f(1.0)); }
fn rail(v: f32) -> vec3f { let lo = mix(u.ink.rgb, u.tone.rgb, smoothstep(0.0, 0.62, v)); return mix(lo, u.cream.rgb, smoothstep(0.62, 1.0, v)); }
fn hash21(p: vec2f) -> f32 { var q = fract(p * vec2f(123.34, 456.21)); q += dot(q, q + 45.32); return fract(q.x * q.y); }
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }

// —— ramps ————————————————————————————————————————————————————————————————
@fragment fn fs_rail(@builtin(position) fp: vec4f) -> @location(0) vec4f { return out(rail(pow(field(cell_uv(fp.xy)), mix(0.5, 2.0, u.k.x)))); }
// Quilez cosine palette: a + b·cos(2π(c·t + d))
@fragment fn fs_cosine(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let t = field(cell_uv(fp.xy));
    let c = vec3f(1.0, 1.0, mix(0.5, 1.5, u.k.x)); let d = vec3f(0.0, mix(0.1, 0.5, u.k.y), mix(0.2, 0.8, u.k.z)) + u.time * 0.05;
    return out(0.5 + 0.5 * cos(TAU * (c * t + d)));
}
// viridis: 6th-order polynomial fit
@fragment fn fs_viridis(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let t = field(cell_uv(fp.xy));
    let c0 = vec3f(0.2777273272, 0.0054073300, 0.3340998053); let c1 = vec3f(0.1050930431, 1.4046131342, 1.3845286306); let c2 = vec3f(-0.3308618287, 0.2148947200, 0.0949446630);
    let c3 = vec3f(-4.6340841254, -5.7991871849, -19.3324280802); let c4 = vec3f(6.2286184776, 14.1795006218, 56.6905242584); let c5 = vec3f(4.7763455540, -13.7450495836, -65.3530313040); let c6 = vec3f(-5.4351969443, 4.6456735644, 26.3124352495);
    return out(c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * (c5 + t * c6))))));
}
@fragment fn fs_magma(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let t = field(cell_uv(fp.xy));
    let c0 = vec3f(-0.0021817, -0.0015213, -0.0197099); let c1 = vec3f(0.2510302, 0.6775232, 2.4948767); let c2 = vec3f(8.3536635, -3.5773625, 0.3144381);
    let c3 = vec3f(-27.6689007, 14.2669531, -13.6492152); let c4 = vec3f(52.1761199, -27.9309623, 12.9440516); let c5 = vec3f(-50.7679459, 29.0465191, 4.2334519); let c6 = vec3f(18.6556262, -11.4897209, -5.6017913);
    return out(c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * (c5 + t * c6))))));
}
// turbo: Mikhailov's polynomial fit of Google's turbo colormap
@fragment fn fs_turbo(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let t = field(cell_uv(fp.xy));
    let kR = vec4f(0.13572138, 4.61539260, -42.66032258, 132.13108234); let kG = vec4f(0.09140261, 2.19418839, 4.84296658, -14.18503333); let kB = vec4f(0.10667330, 12.64194608, -60.58204836, 110.36276771);
    let kR2 = vec2f(-152.94239396, 59.28637943); let kG2 = vec2f(4.27729857, 2.82956604); let kB2 = vec2f(-89.90310912, 27.34824973);
    let v4 = vec4f(1.0, t, t * t, t * t * t); let v2 = vec2f(t * t * t * t, t * t * t * t * t);
    return out(vec3f(dot(v4, kR) + dot(v2, kR2), dot(v4, kG) + dot(v2, kG2), dot(v4, kB) + dot(v2, kB2)));
}
@fragment fn fs_grey_gamma(@builtin(position) fp: vec4f) -> @location(0) vec4f { let t = field(cell_uv(fp.xy)); return out(vec3f(pow(t, mix(0.3, 3.0, u.k.x)))); }

// —— spaces ————————————————————————————————————————————————————————————————
@fragment fn fs_hsv_sweep(@builtin(position) fp: vec4f) -> @location(0) vec4f { let t = field(cell_uv(fp.xy)); return out(hsv2rgb(t + u.time * 0.03, mix(0.5, 1.0, u.k.x), mix(0.6, 1.0, u.k.y))); }
// the same hue sweep at constant OKLCH lightness and chroma — no dark blue / bright yellow bias
@fragment fn fs_oklch_sweep(@builtin(position) fp: vec4f) -> @location(0) vec4f { let t = field(cell_uv(fp.xy)); return out(oklch(mix(0.5, 0.85, u.k.y), mix(0.05, 0.2, u.k.x), t * TAU + u.time * 0.2)); }
// OKLab interpolation between the tone and the cream (left: OKLab, right: sRGB)
@fragment fn fs_oklab_mix(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let t = field(uv);
    let a = srgb_to_linear(u.tone.rgb); let b = srgb_to_linear(u.cream.rgb);
    let lab = mix(linear_to_oklab(a), linear_to_oklab(b), t);
    let ok = linear_to_srgb(oklab_to_linear(lab)); let srgb = mix(u.tone.rgb, u.cream.rgb, t);
    return out(select(ok, srgb, uv.x > 0.5 + 0.02 * sin(u.time)));
}
// gradient interpolation in sRGB (top) vs linear light (bottom): the linear one has no dark seam
@fragment fn fs_linear_vs_srgb(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let t = field(uv); let a = vec3f(0.9, 0.2, 0.1); let b = vec3f(0.1, 0.3, 0.95);
    let s = mix(a, b, t); let l = linear_to_srgb(mix(srgb_to_linear(a), srgb_to_linear(b), t));
    return out(select(s, l, uv.y > 0.5));
}
// black-body: Kang et al. fit of the Planckian locus, 1000–12000 K
@fragment fn fs_blackbody(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let t = field(cell_uv(fp.xy)); let T = mix(1000.0, 12000.0, t);
    var x = 0.0;
    if (T < 4000.0) { x = -0.2661239e9 / (T * T * T) - 0.2343589e6 / (T * T) + 0.8776956e3 / T + 0.179910; }
    else { x = -3.0258469e9 / (T * T * T) + 2.1070379e6 / (T * T) + 0.2226347e3 / T + 0.240390; }
    var y = 0.0;
    if (T < 2222.0) { y = -1.1063814 * x * x * x - 1.34811020 * x * x + 2.18555832 * x - 0.20219683; }
    else if (T < 4000.0) { y = -0.9549476 * x * x * x - 1.37418593 * x * x + 2.09137015 * x - 0.16748867; }
    else { y = 3.0817580 * x * x * x - 5.87338670 * x * x + 3.75112997 * x - 0.37001483; }
    let Y = 1.0; let X = Y * x / y; let Z = Y * (1.0 - x - y) / y;
    let rgb = vec3f(3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.2040 * Y + 1.0570 * Z);
    let n = rgb / max(max(rgb.r, rgb.g), rgb.b);
    return out(linear_to_srgb(max(n, vec3f(0.0)) * mix(0.3, 1.0, u.k.x)));
}
@fragment fn fs_lab_lightness(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let t = field(cell_uv(fp.xy)); let lab = linear_to_oklab(srgb_to_linear(u.tone.rgb));
    return out(linear_to_srgb(oklab_to_linear(vec3f(mix(0.1, 0.98, t), lab.y * mix(0.3, 1.5, u.k.x), lab.z * mix(0.3, 1.5, u.k.x)))));
}

// —— tonemapping: the field as HDR light, exposure from the generator ————————
fn hdr(uv: vec2f) -> vec3f { let v = field(uv); return vec3f(v, pow(v, 1.4), pow(v, 2.2)) * u.exposure * 4.0 * mix(0.5, 2.0, u.k.x); }
@fragment fn fs_clip(@builtin(position) fp: vec4f) -> @location(0) vec4f { return out(linear_to_srgb(clamp(hdr(cell_uv(fp.xy)), vec3f(0.0), vec3f(1.0)))); }
@fragment fn fs_reinhard(@builtin(position) fp: vec4f) -> @location(0) vec4f { let c = hdr(cell_uv(fp.xy)); return out(linear_to_srgb(c / (1.0 + c))); }
@fragment fn fs_reinhard_ext(@builtin(position) fp: vec4f) -> @location(0) vec4f { let c = hdr(cell_uv(fp.xy)); let w = mix(2.0, 16.0, u.k.y); return out(linear_to_srgb(c * (1.0 + c / (w * w)) / (1.0 + c))); }
@fragment fn fs_aces(@builtin(position) fp: vec4f) -> @location(0) vec4f { let c = hdr(cell_uv(fp.xy)); let m = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14); return out(linear_to_srgb(clamp(m, vec3f(0.0), vec3f(1.0)))); }
fn hable(x: vec3f) -> vec3f { let A = 0.15; let B = 0.50; let C = 0.10; let D = 0.20; let E = 0.02; let F = 0.30; return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F; }
@fragment fn fs_hable(@builtin(position) fp: vec4f) -> @location(0) vec4f { let c = hdr(cell_uv(fp.xy)); let W = vec3f(11.2); return out(linear_to_srgb(hable(c * 2.0) / hable(W))); }
// AgX: the sigmoid fit of Blender's AgX base (Wrensch), inset/outset matrices omitted for the 1-D case
fn agx_curve(x: vec3f) -> vec3f { let x2 = x * x; let x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
@fragment fn fs_agx(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let c = hdr(cell_uv(fp.xy)); let minEv = -12.47393; let maxEv = 4.026069;
    let v = clamp((log2(max(c, vec3f(1e-5))) - minEv) / (maxEv - minEv), vec3f(0.0), vec3f(1.0));
    return out(agx_curve(v));
}
// Khronos PBR Neutral
@fragment fn fs_pbr_neutral(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    var c = hdr(cell_uv(fp.xy)); let startCompression = 0.8 - 0.04; let desaturation = 0.15;
    let x = min(c.r, min(c.g, c.b)); let offset = select(0.04, x - 6.25 * x * x, x < 0.08); c -= offset;
    let peak = max(c.r, max(c.g, c.b));
    if (peak >= startCompression) {
        let d = 1.0 - startCompression; let newPeak = 1.0 - d * d / (peak + d - startCompression); c *= newPeak / peak;
        let g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0); c = mix(c, vec3f(newPeak), g);
    }
    return out(linear_to_srgb(c));
}

// —— quantize / dither ——————————————————————————————————————————————————————
@fragment fn fs_posterize(@builtin(position) fp: vec4f) -> @location(0) vec4f { let t = field(cell_uv(fp.xy)); let n = floor(mix(2.0, 12.0, u.k.x)); return out(rail(floor(t * n + 0.5) / n)); }
@fragment fn fs_bayer(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let t = field(cell_uv(fp.xy)); let px = vec2i(floor(fp.xy / mix(1.0, 4.0, u.k.y)));
    let x = px.x & 3; let y = px.y & 3; let m = ((x ^ y) & 1) * 8 + (y & 1) * 4 + ((x ^ y) & 2) + ((y & 2) >> 1u);
    let thr = (f32(m) + 0.5) / 16.0; let n = floor(mix(1.0, 5.0, u.k.x));
    return out(rail(floor(t * n + thr) / n));
}
@fragment fn fs_ign_dither(@builtin(position) fp: vec4f) -> @location(0) vec4f { let t = field(cell_uv(fp.xy)); let n = floor(mix(1.0, 5.0, u.k.x)); return out(rail(floor(t * n + ign(floor(fp.xy / mix(1.0, 4.0, u.k.y)))) / n)); }
@fragment fn fs_noise_dither(@builtin(position) fp: vec4f) -> @location(0) vec4f { let t = field(cell_uv(fp.xy)); let n = floor(mix(1.0, 5.0, u.k.x)); return out(rail(floor(t * n + hash21(floor(fp.xy / mix(1.0, 4.0, u.k.y)) + floor(u.time * 20.0))) / n)); }
// snap to the nearest of eight fixed colors (a 3-bit palette)
@fragment fn fs_palette_snap(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let t = field(cell_uv(fp.xy)); let c = hsv2rgb(t, 0.8, 0.9) + (ign(fp.xy) - 0.5) * mix(0.0, 0.5, u.k.y);
    var best = vec3f(0.0); var bd = 1e9;
    for (var i: i32 = 0; i < 8; i++) { let p = vec3f(f32(i & 1), f32((i >> 1u) & 1), f32((i >> 2u) & 1)) * mix(0.7, 1.0, u.k.x); let d = distance(p, c); if (d < bd) { bd = d; best = p; } }
    return out(best);
}
@fragment fn fs_duotone(@builtin(position) fp: vec4f) -> @location(0) vec4f { let t = field(cell_uv(fp.xy)); return out(select(u.ink.rgb, u.cream.rgb, t + (ign(fp.xy) - 0.5) * u.k.y > mix(0.3, 0.7, u.k.x))); }

// —— effects ————————————————————————————————————————————————————————————————
@fragment fn fs_cycle(@builtin(position) fp: vec4f) -> @location(0) vec4f { let t = field(cell_uv(fp.xy)); return out(rail(fract(t * mix(1.0, 4.0, u.k.x) - u.time * 0.3))); }
@fragment fn fs_hue_spin(@builtin(position) fp: vec4f) -> @location(0) vec4f { let t = field(cell_uv(fp.xy)); let c = rail(t); let a = u.time * 0.6 * mix(0.2, 1.0, u.k.x);
    let toYIQ = mat3x3f(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312); let toRGB = mat3x3f(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
    var yiq = toYIQ * c; let h = atan2(yiq.z, yiq.y) + a; let ch = length(yiq.yz); yiq = vec3f(yiq.x, ch * cos(h), ch * sin(h)); return out(toRGB * yiq); }
// protanopia simulation (Machado 2009, severity 1.0) of a hue sweep
@fragment fn fs_protanopia(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let c = hsv2rgb(field(uv), 0.9, 0.9);
    let M = mat3x3f(0.152286, 0.114503, -0.003882, 1.052583, 0.786281, -0.048116, -0.204868, 0.099216, 1.051998);
    return out(select(M * c, c, uv.y > 0.5));
}
@fragment fn fs_deuteranopia(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = cell_uv(fp.xy); let c = hsv2rgb(field(uv), 0.9, 0.9);
    let M = mat3x3f(0.367322, 0.280085, -0.011820, 0.860646, 0.672501, 0.042940, -0.227968, 0.047413, 0.968881);
    return out(select(M * c, c, uv.y > 0.5));
}
@fragment fn fs_split_tone(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let t = field(cell_uv(fp.xy)); let sh = mix(vec3f(0.2, 0.3, 0.6), u.tone.rgb, u.k.x); let hi = mix(vec3f(1.0, 0.8, 0.5), u.cream.rgb, u.k.y);
    return out(mix(u.ink.rgb, mix(sh, hi, smoothstep(0.3, 0.8, t)), pow(t, 0.7)));
}
@fragment fn fs_contours(@builtin(position) fp: vec4f) -> @location(0) vec4f { let t = field(cell_uv(fp.xy)); let n = mix(4.0, 20.0, u.k.x); let f = fract(t * n); let line = 1.0 - smoothstep(0.0, 0.12, min(f, 1.0 - f)); return out(mix(rail(floor(t * n) / n), u.cream.rgb, line * u.k.y)); }
