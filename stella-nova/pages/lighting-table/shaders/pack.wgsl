// ═══════════════════════════════════════════════════════════════════════════
//  LIGHTING TABLE  ·  one shading model per cell, on an analytic sphere lit by
//  a key light that orbits while hovered plus a hemisphere ambient. All math in
//  linear light; base color is the site tone, the light is the cream.
//
//  References: Lambert; Valve half-Lambert (Mitchell et al. 2007); wrap
//  lighting (Green, GPU Gems 2005); Oren–Nayar 1994 (qualitative model);
//  Burley 2012 (Disney diffuse, clearcoat, GTR, sheen, subsurface approx.);
//  Minnaert 1941; Lommel–Seeliger (lunar); Phong 1975; Blinn 1977; Beckmann
//  1963 / Cook–Torrance 1982; Trowbridge–Reitz 1975 / Walter et al. 2007 (GGX,
//  Smith G); Ward 1992; Ashikhmin–Shirley 2000; Kelemen–Szirmay-Kalos 2001;
//  Schlick 1994; Estevez & Kulla 2017 (Charlie sheen); Belcour & Barla 2017
//  (thin-film, simplified); Gooch et al. 1998; Lake et al. 2000 (cel shading);
//  Praun et al. 2001 (tonal art maps / hatching). The gem, glint and skin
//  cells are original: per-channel Blinn lobes, hashed micro-facet glints,
//  and fbm, starfield and hologram skins.
// ═══════════════════════════════════════════════════════════════════════════

struct LightU {
    size: vec2f, time: f32, pixelScale: f32,
    ink: vec4f, tone: vec4f, cream: vec4f,
    exposure: f32, ambient: f32, lx: f32, ly: f32,   // key light direction (x, y); z follows
    k: vec4f,
}
@group(0) @binding(0) var<uniform> u: LightU;

const PI: f32 = 3.14159265358979;
const TAU: f32 = 6.28318530717959;

@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(p[i], 0.0, 1.0);
}
fn srgb_to_linear(c: vec3f) -> vec3f { return select(c / 12.92, pow((c + 0.055) / 1.055, vec3f(2.4)), c > vec3f(0.04045)); }
fn linear_to_srgb(c: vec3f) -> vec3f { return select(c * 12.92, 1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c > vec3f(0.0031308)); }
fn sq(x: f32) -> f32 { return x * x; }

// —— the sphere and its lights ————————————————————————————————————————————
struct Surf { n: vec3f, v: vec3f, l: vec3f, h: vec3f, t: vec3f, b: vec3f, ndl: f32, ndv: f32, ndh: f32, vdh: f32, ldh: f32, mask: f32, uv: vec2f }
fn setup(fp: vec2f) -> Surf {
    let pos = fp / u.pixelScale; let px = 1.0 / max(min(u.size.x, u.size.y), 1.0);
    let uv = (pos - 0.5 * u.size) * px * 2.0;   // -1..1 across the short side
    let r2 = dot(uv, uv); let R = 0.92;
    var s: Surf; s.uv = uv;
    s.mask = 1.0 - smoothstep(R * R - 3.0 * px, R * R + px, r2);
    let z = sqrt(max(R * R - r2, 0.0));
    s.n = normalize(vec3f(uv.x, -uv.y, z + 1e-4));
    s.v = vec3f(0.0, 0.0, 1.0);
    let lz = sqrt(max(1.0 - (u.lx * u.lx + u.ly * u.ly), 0.0));   // (lx, ly) is the unit light direction's xy
    s.l = normalize(vec3f(u.lx, u.ly, lz + 1e-3));
    s.h = normalize(s.l + s.v);
    // tangent frame for the anisotropic lobes: brushed around the y axis
    let up = vec3f(0.0, 1.0, 0.0);
    s.t = normalize(cross(up, s.n) + vec3f(1e-4, 0.0, 0.0)); s.b = cross(s.n, s.t);
    s.ndl = max(dot(s.n, s.l), 0.0); s.ndv = max(dot(s.n, s.v), 1e-4); s.ndh = max(dot(s.n, s.h), 0.0);
    s.vdh = max(dot(s.v, s.h), 0.0); s.ldh = max(dot(s.l, s.h), 0.0);
    return s;
}
fn albedo() -> vec3f { return srgb_to_linear(u.tone.rgb); }
fn light() -> vec3f { return srgb_to_linear(u.cream.rgb) * 2.2; }
// hemisphere ambient: sky is the tone, ground is the ink
fn ambient(n: vec3f) -> vec3f { return mix(srgb_to_linear(u.ink.rgb) * 0.6, srgb_to_linear(u.tone.rgb) * 0.7, 0.5 + 0.5 * n.y) * u.ambient; }
// composite radiance to the cell: sphere over ink, exposure, sRGB
fn out(s: Surf, c: vec3f) -> vec4f {
    let bg = srgb_to_linear(u.ink.rgb);
    let col = mix(bg, max(c, vec3f(0.0)) * u.exposure, s.mask);
    return vec4f(clamp(linear_to_srgb(col), vec3f(0.0), vec3f(1.0)), 1.0);
}
fn shade(s: Surf, diffuse: vec3f, spec: vec3f) -> vec4f { return out(s, (diffuse + spec) * light() * s.ndl + albedo() * ambient(s.n)); }
fn rough() -> f32 { return mix(0.06, 1.0, u.k.x); }
// the microfacet denominator, with n·v floored so the silhouette doesn't blow up where no G term tames it
fn denom(s: Surf) -> f32 { return 4.0 * max(s.ndv, 0.08) * max(s.ndl, 1e-3); }

// —— microfacet building blocks ————————————————————————————————————————————
fn f_schlick(f0: vec3f, c: f32) -> vec3f { let m = pow(1.0 - c, 5.0); return f0 + (1.0 - f0) * m; }
fn d_ggx(ndh: f32, a: f32) -> f32 { let a2 = a * a; let d = ndh * ndh * (a2 - 1.0) + 1.0; return a2 / (PI * d * d + 1e-6); }
fn d_beckmann(ndh: f32, a: f32) -> f32 { let c2 = max(ndh * ndh, 1e-4); let t2 = (1.0 - c2) / c2; return exp(-t2 / (a * a)) / (PI * a * a * c2 * c2); }
fn d_gtr(ndh: f32, a: f32, g: f32) -> f32 { let a2 = a * a; let d = ndh * ndh * (a2 - 1.0) + 1.0; return select((g - 1.0) * (a2 - 1.0) / (PI * (1.0 - pow(a2, 1.0 - g))) / pow(d, g), a2 / (PI * d * d), abs(g - 1.0) < 1e-3 || abs(a2 - 1.0) < 1e-4); }
fn g1_smith_ggx(ndx: f32, a: f32) -> f32 { let a2 = a * a; return 2.0 * ndx / (ndx + sqrt(a2 + (1.0 - a2) * ndx * ndx)); }
fn g_smith_ggx(ndl: f32, ndv: f32, a: f32) -> f32 { return g1_smith_ggx(ndl, a) * g1_smith_ggx(ndv, a); }
fn d_ggx_aniso(s: Surf, ax: f32, ay: f32) -> f32 {
    let hx = dot(s.h, s.t) / ax; let hy = dot(s.h, s.b) / ay; let d = hx * hx + hy * hy + s.ndh * s.ndh;
    return 1.0 / (PI * ax * ay * d * d + 1e-6);
}
fn d_charlie(ndh: f32, a: f32) -> f32 { let inv = 1.0 / max(a, 1e-3); let s2 = 1.0 - ndh * ndh; return (2.0 + inv) * pow(s2, inv * 0.5) / TAU; }

// ═══ DIFFUSE ═════════════════════════════════════════════════════════════════
@fragment fn fs_lambert(@builtin(position) fp: vec4f) -> @location(0) vec4f { let s = setup(fp.xy); return shade(s, albedo() / PI, vec3f(0.0)); }

@fragment fn fs_half_lambert(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy); let hl = sq(0.5 * dot(s.n, s.l) + 0.5);
    return out(s, albedo() / PI * light() * hl + albedo() * ambient(s.n));
}
@fragment fn fs_wrap(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy); let w = mix(0.0, 1.0, u.k.x); let d = max((dot(s.n, s.l) + w) / (1.0 + w), 0.0);
    return out(s, albedo() / PI * light() * d + albedo() * ambient(s.n));
}
@fragment fn fs_oren_nayar(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy); let sg = rough(); let s2 = sg * sg;
    let A = 1.0 - 0.5 * s2 / (s2 + 0.33); let B = 0.45 * s2 / (s2 + 0.09);
    let tl = acos(clamp(dot(s.n, s.l), -1.0, 1.0)); let tv = acos(clamp(s.ndv, -1.0, 1.0));
    let pl = normalize(s.l - s.n * dot(s.n, s.l) + vec3f(1e-5)); let pv = normalize(s.v - s.n * s.ndv + vec3f(1e-5));
    let cosd = max(dot(pl, pv), 0.0);
    let f = A + B * cosd * sin(max(tl, tv)) * tan(min(tl, tv));
    return shade(s, albedo() / PI * f, vec3f(0.0));
}
@fragment fn fs_burley(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy); let r = rough();
    let fd90 = 0.5 + 2.0 * r * s.ldh * s.ldh;
    let fl = 1.0 + (fd90 - 1.0) * pow(1.0 - s.ndl, 5.0); let fv = 1.0 + (fd90 - 1.0) * pow(1.0 - s.ndv, 5.0);
    return shade(s, albedo() / PI * fl * fv, vec3f(0.0));
}
@fragment fn fs_minnaert(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy); let kk = mix(0.5, 2.0, u.k.x);
    let f = pow(max(s.ndl * s.ndv, 1e-4), kk - 1.0);
    return shade(s, albedo() / PI * f, vec3f(0.0));
}
@fragment fn fs_lommel_seeliger(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy); let f = 1.0 / (s.ndl + s.ndv + 1e-3);
    return shade(s, albedo() / PI * f * 0.5, vec3f(0.0));
}
@fragment fn fs_hemisphere(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy);   // ambient only: the sky/ground hemisphere, the key light off
    return out(s, albedo() * ambient(s.n) * mix(2.0, 6.0, u.k.x));
}

// ═══ SPECULAR ════════════════════════════════════════════════════════════════
@fragment fn fs_phong(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy); let r = reflect(-s.l, s.n); let n = mix(4.0, 200.0, u.k.x * u.k.x);
    let sp = pow(max(dot(r, s.v), 0.0), n) * (n + 2.0) / TAU;
    return shade(s, albedo() / PI, vec3f(sp) * mix(0.1, 1.0, u.k.y));
}
@fragment fn fs_blinn_phong(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy); let n = mix(4.0, 400.0, u.k.x * u.k.x);
    let sp = pow(s.ndh, n) * (n + 8.0) / (8.0 * PI);
    return shade(s, albedo() / PI, vec3f(sp) * mix(0.1, 1.0, u.k.y));
}
@fragment fn fs_beckmann(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy); let a = rough();
    let sp = d_beckmann(s.ndh, a) * f_schlick(vec3f(0.04), s.vdh) / denom(s);
    return shade(s, albedo() / PI, sp);
}
@fragment fn fs_ggx(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy); let a = rough() * rough();
    let sp = d_ggx(s.ndh, a) * f_schlick(vec3f(0.04), s.vdh) / denom(s);
    return shade(s, albedo() / PI, sp);
}
@fragment fn fs_gtr(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy); let a = rough() * rough(); let g = mix(0.5, 3.0, u.k.y);   // γ: 1 = Berry, 2 = GGX
    let sp = d_gtr(s.ndh, a, g) * f_schlick(vec3f(0.04), s.vdh) / denom(s);
    return shade(s, albedo() / PI, sp);
}
@fragment fn fs_cook_torrance(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy); let a = rough() * rough(); let metal = u.k.y;
    let f0 = mix(vec3f(0.04), albedo(), metal); let F = f_schlick(f0, s.vdh);
    let sp = d_ggx(s.ndh, a) * g_smith_ggx(s.ndl, s.ndv, a) * F / denom(s);
    let kd = (1.0 - F) * (1.0 - metal);
    return shade(s, kd * albedo() / PI, sp);
}
@fragment fn fs_ward(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy); let ax = mix(0.05, 0.6, u.k.x); let ay = mix(0.05, 0.6, u.k.y);
    let hx = dot(s.h, s.t) / ax; let hy = dot(s.h, s.b) / ay;
    let e = exp(-(hx * hx + hy * hy) / max(s.ndh * s.ndh, 1e-4));
    let sp = e / (4.0 * PI * ax * ay * sqrt(max(s.ndl * s.ndv, 1e-4)));
    return shade(s, albedo() / PI, vec3f(sp) * 0.3);
}
@fragment fn fs_ashikhmin_shirley(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy); let nu = mix(10.0, 1000.0, u.k.x * u.k.x); let nv = mix(10.0, 1000.0, u.k.y * u.k.y);
    let hu = dot(s.h, s.t); let hv = dot(s.h, s.b); let denom = max(1.0 - s.ndh * s.ndh, 1e-4);
    let ex = (nu * hu * hu + nv * hv * hv) / denom;
    let sp = sqrt((nu + 1.0) * (nv + 1.0)) / (8.0 * PI) * pow(s.ndh, ex) / (s.vdh * max(max(s.ndl, s.ndv), 1e-3));
    let rs = 0.1; let F = rs + (1.0 - rs) * pow(1.0 - s.vdh, 5.0);
    let dif = 28.0 * albedo() / (23.0 * PI) * (1.0 - rs) * (1.0 - pow(1.0 - s.ndl * 0.5, 5.0)) * (1.0 - pow(1.0 - s.ndv * 0.5, 5.0));
    return shade(s, dif, vec3f(sp * F));
}
@fragment fn fs_ggx_aniso(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy); let a = rough() * rough(); let an = mix(-0.9, 0.9, u.k.y);
    let ax = max(a * (1.0 + an), 1e-3); let ay = max(a * (1.0 - an), 1e-3);
    let sp = d_ggx_aniso(s, ax, ay) * g_smith_ggx(s.ndl, s.ndv, a) * f_schlick(vec3f(0.04), s.vdh) / denom(s);
    return shade(s, albedo() / PI, sp);
}
@fragment fn fs_kelemen(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy); let a = rough() * rough();
    // Kelemen–Szirmay-Kalos: G/(4 n·l n·v) ≈ 1/(v·h)²
    let sp = d_ggx(s.ndh, a) * f_schlick(vec3f(0.04), s.vdh) / (4.0 * max(s.vdh * s.vdh, 1e-3));
    return shade(s, albedo() / PI, sp);
}
@fragment fn fs_gaussian(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy); let m = rough() * 0.8; let ang = acos(clamp(s.ndh, 0.0, 1.0));
    let sp = exp(-sq(ang / m)) / (PI * m * m);
    return shade(s, albedo() / PI, vec3f(sp) * 0.5);
}

// —— hash and value noise for the glint and skin cells (integer hash, no sin) ——
fn pcg(v: u32) -> u32 { let st = v * 747796405u + 2891336453u; let w = ((st >> ((st >> 28u) + 4u)) ^ st) * 277803737u; return (w >> 22u) ^ w; }
fn hash2(p: vec2f, k: u32) -> f32 { let q = bitcast<vec2u>(vec2i(floor(p))); return f32(pcg(q.x + pcg(q.y + pcg(k)))) / 4294967295.0; }
fn vnoise(p: vec2f) -> f32 {
    let i = floor(p); let f = fract(p); let w = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i, 0u), hash2(i + vec2f(1.0, 0.0), 0u), w.x), mix(hash2(i + vec2f(0.0, 1.0), 0u), hash2(i + vec2f(1.0, 1.0), 0u), w.x), w.y);
}
fn fbm(p0: vec2f) -> f32 {
    var p = p0; var a = 0.5; var v = 0.0;
    for (var i = 0; i < 5; i++) { v += a * vnoise(p); p = mat2x2f(1.6, 1.2, -1.2, 1.6) * p + vec2f(3.1, 1.7); a *= 0.5; }
    return v / 0.96875;
}
// chromatic gem specular: one Blinn lobe per channel. Red is wide, green is mid, blue is tight,
// so the white core fringes to yellow and then red at its edge, as a prism splits light.
@fragment fn fs_gem_prism(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy); let n = mix(12.0, 160.0, u.k.x * u.k.x);
    let pw = vec3f(n * 0.28, n, n * 3.6);
    let lobe = pow(vec3f(s.ndh), pw) * pow((pw + 8.0) / (8.0 * PI), vec3f(0.35));
    let fr = f_schlick(vec3f(0.06), s.ndv);
    let body = albedo() * albedo() * 0.9;   // a deep, saturated gem body
    let rim = pow(1.0 - s.ndv, 3.0) * srgb_to_linear(u.tone.rgb) * 0.9;
    let c = (body / PI + lobe * mix(0.3, 1.6, u.k.y)) * light() * s.ndl + body * ambient(s.n) * 2.0 + rim + fr * 0.08;
    return out(s, c);
}
// micro-facet glint: the surface is a grid of tiny facets. Each facet tilts its normal by a hash,
// and a hash gate lets only some facets carry a mirror. A tight lobe on the tilted normal flashes
// when that facet faces the half vector. Each flash breathes on a slow sine with its own rate and
// phase, so the glitter twinkles and does not strobe.
@fragment fn fs_facet_glint(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy); let N = mix(18.0, 54.0, u.k.x); let dens = mix(0.15, 0.75, u.k.y);
    var g = vec3f(0.0);
    let q = s.uv * N;
    for (var j = 0; j < 4; j++) {   // the facet and its three nearest neighbors, so a flare may cross a facet edge
        let id = floor(q - 0.5) + vec2f(f32(j & 1), f32(j >> 1));
        let gate = hash2(id, 1u);
        if (gate > dens) { continue; }
        let c = id + 0.2 + 0.6 * vec2f(hash2(id, 2u), hash2(id, 3u));
        let tilt = (vec3f(hash2(id, 4u), hash2(id, 5u), hash2(id, 6u)) - 0.5) * vec3f(1.3, 1.3, 0.4);
        let nf = normalize(s.n + tilt);
        let spec = pow(max(dot(nf, s.h), 0.0), 90.0) * step(0.0, dot(nf, s.l));
        let tw = pow(0.5 + 0.5 * sin(u.time * mix(0.8, 2.2, hash2(id, 7u)) + TAU * hash2(id, 8u)), 3.0);
        let dq = q - c; let r2 = dot(dq, dq);
        let flare = exp(-r2 * 12.0) + 0.45 * exp(-abs(dq.x) * 7.0 - dq.y * dq.y * 220.0) + 0.45 * exp(-abs(dq.y) * 7.0 - dq.x * dq.x * 220.0);
        let hue = mix(vec3f(1.0), vec3f(1.0, 0.85, 0.7) + vec3f(0.0, 0.1, 0.35) * hash2(id, 9u), 0.5);
        g += hue * spec * tw * flare;
    }
    let base = albedo() * 0.45;
    let bl = pow(s.ndh, 40.0) * 0.25;
    let c = (base / PI + vec3f(bl)) * light() * s.ndl + base * ambient(s.n) + g * srgb_to_linear(u.cream.rgb) * 9.0 * s.mask;
    return out(s, c);
}

// ═══ FRESNEL & LAYERS ════════════════════════════════════════════════════════
@fragment fn fs_fresnel(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy); let ior = mix(1.0, 2.5, u.k.x); let f0 = sq((ior - 1.0) / (ior + 1.0));
    let F = f_schlick(vec3f(f0), s.ndv);   // the view-angle Fresnel term alone, over the ink
    return out(s, F * light() * 0.5 + albedo() * ambient(s.n) * 0.3);
}
@fragment fn fs_metal(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy); let a = rough() * rough(); let metal = smoothstep(-0.02, 0.02, s.uv.x);   // left dielectric, right metal
    let f0 = mix(vec3f(0.04), albedo(), metal); let F = f_schlick(f0, s.vdh);
    let sp = d_ggx(s.ndh, a) * g_smith_ggx(s.ndl, s.ndv, a) * F / denom(s);
    return shade(s, (1.0 - F) * (1.0 - metal) * albedo() / PI, sp + f0 * ambient(reflect(-s.v, s.n)) * 0.6);
}
@fragment fn fs_clearcoat(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy); let a = rough() * rough(); let cc = u.k.y; let ca = mix(0.001, 0.1, u.k.z);
    let base = d_ggx(s.ndh, a) * g_smith_ggx(s.ndl, s.ndv, a) * f_schlick(vec3f(0.04), s.vdh) / denom(s);
    let coat = d_gtr(s.ndh, sqrt(ca), 1.0) * 0.25 * f_schlick(vec3f(0.04), s.vdh).x * g_smith_ggx(s.ndl, s.ndv, 0.25) / denom(s);
    return shade(s, albedo() / PI, base + vec3f(coat) * cc);
}
@fragment fn fs_sheen(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy); let a = mix(0.1, 1.0, u.k.x);
    let sh = d_charlie(s.ndh, a) / (4.0 * (s.ndl + s.ndv - s.ndl * s.ndv) + 1e-3);   // Neubelt–Pettineo visibility
    return shade(s, albedo() / PI, srgb_to_linear(u.cream.rgb) * sh * u.k.y * 2.0);
}
@fragment fn fs_subsurface(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy); let r = rough();
    // Disney's subsurface approximation (Hanrahan–Krueger inspired), lerped against Burley diffuse
    let fss90 = s.ldh * s.ldh * r; let fl = pow(1.0 - s.ndl, 5.0); let fv = pow(1.0 - s.ndv, 5.0);
    let fss = mix(1.0, fss90, fl) * mix(1.0, fss90, fv);
    let ss = 1.25 * (fss * (1.0 / (s.ndl + s.ndv + 1e-3) - 0.5) + 0.5);
    let fd90 = 0.5 + 2.0 * r * s.ldh * s.ldh; let fd = mix(1.0, fd90, fl) * mix(1.0, fd90, fv);
    // wrapped transmission through the thin side so the terminator glows
    let trans = pow(max(dot(-s.v, s.l), 0.0), 3.0) * 0.4 * u.k.y;
    let d = albedo() / PI * mix(fd, ss, u.k.y);
    return out(s, (d * s.ndl + albedo() * trans) * light() + albedo() * ambient(s.n));
}
@fragment fn fs_thin_film(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy); let thick = mix(100.0, 700.0, u.k.x); let ior = mix(1.2, 2.0, u.k.y);
    // simplified thin-film interference: per-wavelength cosine of the optical path difference
    let ct = sqrt(max(1.0 - (1.0 - s.ndv * s.ndv) / (ior * ior), 0.0)); let opd = 2.0 * ior * thick * ct;
    let lam = vec3f(650.0, 550.0, 450.0); let irid = 0.5 + 0.5 * cos(TAU * opd / lam + PI);
    let a = 0.05; let sp = d_ggx(s.ndh, a) * irid * 0.06 / denom(s);
    return shade(s, albedo() / PI * 0.4, sp + irid * f_schlick(vec3f(0.04), s.ndv) * 0.6);
}

// ═══ STYLIZED ════════════════════════════════════════════════════════════════
@fragment fn fs_toon(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy); let bands = floor(mix(2.0, 6.0, u.k.x));
    let d = floor(s.ndl * bands + 0.5) / bands; let sp = step(0.9 + 0.09 * u.k.y, s.ndh);
    let rim = step(1.0 - mix(0.1, 0.4, u.k.z), 1.0 - s.ndv);
    let c = albedo() * mix(0.25, 1.0, d) + srgb_to_linear(u.cream.rgb) * (sp + rim * 0.5);
    return out(s, c);
}
@fragment fn fs_gooch(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy); let t = 0.5 + 0.5 * dot(s.n, s.l);
    let cool = vec3f(0.0, 0.0, 0.55) + mix(0.1, 0.5, u.k.x) * albedo(); let warm = vec3f(0.3, 0.3, 0.0) + mix(0.1, 0.5, u.k.y) * albedo();
    let r = reflect(-s.l, s.n); let sp = pow(max(dot(r, s.v), 0.0), 32.0);
    return out(s, mix(cool, warm, t) + vec3f(sp) * 0.6);
}
@fragment fn fs_rim(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy); let p = mix(0.8, 4.0, u.k.x);
    let rim = pow(1.0 - s.ndv, p) * mix(0.5, 3.0, u.k.y);
    return out(s, albedo() * 0.06 + srgb_to_linear(u.tone.rgb) * rim + albedo() / PI * light() * s.ndl * 0.15);
}
@fragment fn fs_matcap(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy);
    // a procedural matcap: the view-space normal indexes a lit disc with a moving highlight
    let m = s.n.xy; let hl = normalize(vec2f(u.lx, u.ly) + vec2f(1e-4)) * 0.55 * min(length(vec2f(u.lx, u.ly)), 1.0);
    let d = length(m - hl); let ring = 0.5 + 0.5 * cos(length(m) * mix(4.0, 16.0, u.k.x));
    let c = mix(srgb_to_linear(u.ink.rgb), albedo(), 0.5 + 0.5 * m.y) + srgb_to_linear(u.cream.rgb) * (exp(-d * d * 12.0) + ring * 0.12 * u.k.y);
    return out(s, c);
}
@fragment fn fs_hatching(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy); let px = fp.xy / u.pixelScale; let sc = mix(3.0, 8.0, u.k.x);
    let shade_ = 1.0 - s.ndl;   // darkness → more hatch layers, like a tonal art map
    var h = 0.0;
    h += step(0.7, fract((px.x + px.y) / sc)) * step(0.2, shade_);
    h += step(0.7, fract((px.x - px.y) / sc)) * step(0.45, shade_);
    h += step(0.7, fract(px.x / sc)) * step(0.7, shade_);
    h += step(0.7, fract(px.y / sc)) * step(0.85, shade_);
    let paper = srgb_to_linear(u.cream.rgb); let ink = srgb_to_linear(u.ink.rgb);
    return out(s, mix(paper, ink, clamp(h, 0.0, 1.0) * mix(0.6, 1.0, u.k.y)));
}
@fragment fn fs_xray(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy); let e = pow(1.0 - s.ndv, mix(0.5, 3.0, u.k.x));
    let c = srgb_to_linear(u.tone.rgb) * e * 2.0 + srgb_to_linear(u.cream.rgb) * pow(e, 4.0);
    return out(s, c);
}

// ═══ SKINS ═══════════════════════════════════════════════════════════════════
// Skins are whole materials on the sphere. Each one keeps the key light for its shape cue.
// lava: flowing fbm, domain-warped, on the sphere's stereographic coordinates. The 0.5 contour
// splits dark crust (lit by the key light) from molten rock (emissive). A glow rides the contour.
@fragment fn fs_skin_lava(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy); let t = u.time;
    let p = s.n.xy / (1.0 + s.n.z) * mix(2.0, 4.5, u.k.x) + vec2f(0.0, t * 0.12);
    let w = vec2f(fbm(p + vec2f(0.0, t * 0.05)), fbm(p + vec2f(5.2, 1.3) - vec2f(t * 0.04, 0.0)));
    let f = fbm(p + 1.6 * w);
    let aa = max(fwidth(f), 1e-4);
    let crust = smoothstep(0.5 - aa, 0.5 + aa, f);
    let heat = clamp((0.5 - f) * 5.0, 0.0, 1.0);
    let molten = mix(vec3f(0.6, 0.05, 0.01), mix(vec3f(1.6, 0.45, 0.05), vec3f(2.2, 1.6, 0.6), heat * heat), sqrt(heat)) * mix(0.6, 1.6, u.k.y);
    let edge = exp(-abs(f - 0.5) * 45.0);
    let glow = vec3f(2.4, 0.7, 0.12) * edge * mix(0.6, 1.6, u.k.y);
    let rock = vec3f(0.035, 0.03, 0.03) * (0.7 + 0.6 * fbm(p * 5.0));
    let cool = rock / PI * light() * s.ndl + rock * ambient(s.n) * 2.0 + vec3f(pow(s.ndh, 30.0) * 0.05) * s.ndl;
    let hot = crust * smoothstep(0.5, 0.62, f);
    let c = mix(molten, cool + vec3f(1.2, 0.25, 0.04) * exp(-(f - 0.5) * 18.0) * 0.25, crust) + glow * (1.0 - hot);
    return out(s, c);
}
// galaxy: a window into space in screen space, clipped to the sphere. The nebula is fbm, the stars
// are hashed points in two layers. The layers shift with the normal for a little depth, and a rim
// and a soft highlight keep the sphere readable.
@fragment fn fs_skin_galaxy(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let s = setup(fp.xy); let t = u.time;
    let sp = (fp.xy / u.pixelScale) / max(min(u.size.x, u.size.y), 1.0);
    let q = sp * 3.0 + s.n.xy * 0.08 + vec2f(t * 0.015, 0.0);
    let warp = vec2f(fbm(q * 0.8 + 7.0), fbm(q * 0.8 + 3.0));
    let neb = fbm(q + 1.8 * warp);
    let neb2 = fbm(q * 2.1 - warp + 11.0);
    let tone = srgb_to_linear(u.tone.rgb);
    var c = vec3f(0.004, 0.003, 0.012);
    c += tone * pow(smoothstep(0.35, 0.9, neb), 2.0) * 1.1 * mix(0.4, 1.6, u.k.y);
    c += vec3f(0.55, 0.08, 0.45) * pow(smoothstep(0.45, 0.95, neb2), 2.5) * 0.9 * mix(0.4, 1.6, u.k.y);
    let dens = mix(0.03, 0.12, u.k.x);
    for (var L = 0; L < 2; L++) {
        let sc = select(90.0, 38.0, L == 1);
        let g = (sp + s.n.xy * select(0.02, 0.05, L == 1)) * sc;
        let id = floor(g); let fq = fract(g);
        if (hash2(id, 20u + u32(L)) < dens) {
            let c0 = 0.25 + 0.5 * vec2f(hash2(id, 22u), hash2(id, 23u));
            let d = length(fq - c0);
            let tw = 0.6 + 0.4 * sin(t * mix(0.7, 1.9, hash2(id, 24u)) + TAU * hash2(id, 25u));
            let b = exp(-d * d * select(900.0, 260.0, L == 1)) * tw * select(1.6, 3.0, L == 1);
            c += mix(vec3f(0.8, 0.9, 1.2), vec3f(1.2, 0.95, 0.75), hash2(id, 26u)) * b;
        }
    }
    let rim = pow(1.0 - s.ndv, 2.5) * tone * 1.4;
    let hl = pow(s.ndh, 60.0) * 0.5 * s.ndl;
    c = c * (0.55 + 0.45 * s.ndl + 0.2) + rim + srgb_to_linear(u.cream.rgb) * hl;
    return out(s, c);
}
// hologram: one sample of the hologram at a pixel offset. Scanlines, a Fresnel rim, a thin fill
// and a slow sweep band. The glitch calls it once per channel with different offsets.
fn holo_at(fp: vec2f, t: f32) -> vec3f {
    let s = setup(fp);
    let py = fp.y / u.pixelScale;
    let scan = 0.5 + 0.5 * sin(py * TAU / 3.2 - t * 5.0);
    let fr = pow(1.0 - s.ndv, 2.2);
    let sweepY = fract(t * 0.25) * 2.6 - 1.3;
    let sweep = exp(-sq((s.uv.y - sweepY) * 7.0));
    let tone = srgb_to_linear(u.tone.rgb); let cream = srgb_to_linear(u.cream.rgb);
    // a latitude and longitude wire grid, so the band split shows inside the silhouette too
    let lat = asin(clamp(s.n.y, -1.0, 1.0)) / PI * 12.0; let lon = atan2(s.n.x, s.n.z) / PI * 12.0;
    let wl = fwidth(lat) + fwidth(lon) + 1e-4;
    let grid = max(1.0 - smoothstep(0.0, 1.2 * wl, abs(fract(lat + 0.5) - 0.5)), 1.0 - smoothstep(0.0, 1.2 * wl, abs(fract(lon + 0.5) - 0.5)));
    let body = (tone * (0.03 + 0.08 * s.ndl) + tone * grid * 0.35 * (0.3 + 0.7 * s.ndv) + tone * fr * 1.6 + cream * pow(fr, 3.0) * 0.9) * (0.35 + 0.65 * scan) + tone * sweep * 0.3;
    return body * s.mask;
}
// hologram with a time-stepped band glitch: the clock is cut into steps, and in each step a hash
// picks a few horizontal bands. Inside a band, R and B sample at opposite offsets, so the channels split.
@fragment fn fs_skin_holo(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let t = u.time; let step_ = floor(t * mix(3.0, 10.0, u.k.y));
    let short = max(min(u.size.x, u.size.y), 1.0);
    let bandH = short * 0.07; let band = floor((fp.y / u.pixelScale) / bandH);
    let on = step(1.0 - mix(0.05, 0.35, u.k.x), hash2(vec2f(band, step_), 40u));
    let off = (hash2(vec2f(band, step_), 41u) - 0.5) * short * 0.12 * on * u.pixelScale;
    let r = holo_at(fp.xy + vec2f(off, 0.0), t).r;
    let g = holo_at(fp.xy + vec2f(off * 0.25, 0.0), t).g;
    let b = holo_at(fp.xy - vec2f(off, 0.0), t).b;
    let flick = 0.92 + 0.08 * hash2(vec2f(step_, 0.0), 42u);
    let bg = srgb_to_linear(u.ink.rgb);
    let col = bg + vec3f(r, g, b) * flick * u.exposure;
    return vec4f(clamp(linear_to_srgb(col), vec3f(0.0), vec3f(1.0)), 1.0);
}
