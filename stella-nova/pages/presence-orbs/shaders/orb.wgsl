// Orb shader pack. WGSL, WebGPU.
// Derived from the Metal shaders of the MIT-licensed "murmur" package
// (c) Kris Puckett; ported function-for-function. MIT notice retained.
const M_PI_F: f32 = 3.14159265358979;

fn mo_hash(v: vec3u) -> u32 {
    var h: u32 = ((v.x * 1597334673u) ^ (v.y * 3812015801u)) ^ (v.z * 2798796415u);
    h ^= h >> 15u;
    h *= 2246822519u;
    h ^= h >> 13u;
    h *= 3266489917u;
    h ^= h >> 16u;
    return h;
}

fn mo_grad3(c: vec3i) -> vec3f {
    var h: u32 = mo_hash(vec3u(c + 4096));
    var z: f32 = fma(f32(h & 0xFFFFu), 2.0 / 65535.0, -1.0);
    var a: f32 = f32((h >> 16u) & 0xFFFFu) * (6.28318530718 / 65536.0);
    var r: f32 = sqrt(max(0.0, 1.0 - (z * z)));
    return vec3f(r * cos(a), r * sin(a), z);
}

fn mo_noise3(p: vec3f) -> f32 {
    var i: vec3f = floor(p);
    var f: vec3f = p - i;
    var u: vec3f = ((f * f) * f) * ((f * ((f * 6.0) - 15.0)) + 10.0);
    var c: vec3i = vec3i(i);
    var va: f32 = dot(mo_grad3(c + vec3i(0, 0, 0)), f - vec3f(0.0, 0.0, 0.0));
    var vb: f32 = dot(mo_grad3(c + vec3i(1, 0, 0)), f - vec3f(1.0, 0.0, 0.0));
    var vc: f32 = dot(mo_grad3(c + vec3i(0, 1, 0)), f - vec3f(0.0, 1.0, 0.0));
    var vd: f32 = dot(mo_grad3(c + vec3i(1, 1, 0)), f - vec3f(1.0, 1.0, 0.0));
    var ve: f32 = dot(mo_grad3(c + vec3i(0, 0, 1)), f - vec3f(0.0, 0.0, 1.0));
    var vf: f32 = dot(mo_grad3(c + vec3i(1, 0, 1)), f - vec3f(1.0, 0.0, 1.0));
    var vg: f32 = dot(mo_grad3(c + vec3i(0, 1, 1)), f - vec3f(0.0, 1.0, 1.0));
    var vh: f32 = dot(mo_grad3(c + vec3i(1, 1, 1)), f - vec3f(1.0, 1.0, 1.0));
    return mix(mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y), mix(mix(ve, vf, u.x), mix(vg, vh, u.x), u.y), u.z);
}

fn mo_hash1(cell: f32, lane: f32) -> f32 {
    return f32(mo_hash(vec3u(u32(i32(cell) + 32768), u32(i32(lane) + 32768), 0x9E3779B9u)) >> 8u) * (1.0 / 16777216.0);
}

fn mo_vnoise1(x: f32, lane: f32) -> f32 {
    var i: f32 = floor(x);
    var f: f32 = x - i;
    var u: f32 = ((f * f) * f) * ((f * ((f * 6.0) - 15.0)) + 10.0);
    return (mix(mo_hash1(i, lane), mo_hash1(i + 1.0, lane), u) * 2.0) - 1.0;
}

fn mo_fbm1(x: f32, octaves: i32, lane: f32) -> f32 {
    var v: f32 = 0.0;
    var amp: f32 = 0.5;
    var f: f32 = 1.0;
    for (var i: i32 = 0; i < octaves; i++) {
        v += amp * mo_vnoise1(x * f, lane + (f32(i) * 37.0));
        amp *= 0.5;
        f *= 2.03;
    }
    return v;
}

fn mo_srgb_to_linear(c: vec3f) -> vec3f {
    var c_p: vec3f = c;
    c_p = max(c_p, vec3f(0.0));
    return select(c_p * (1.0 / 12.92), pow((c_p + 0.055) * (1.0 / 1.055), vec3f(2.4)), c_p > vec3f(0.04045));
}

fn mo_linear_to_srgb(c: vec3f) -> vec3f {
    var c_p: vec3f = c;
    c_p = max(c_p, vec3f(0.0));
    return select(c_p * 12.92, (1.055 * pow(c_p, vec3f(1.0 / 2.4))) - 0.055, c_p > vec3f(0.0031308));
}

fn mo_linear_to_oklab(c: vec3f) -> vec3f {
    var l: f32 = ((0.4122214708 * c.r) + (0.5363325363 * c.g)) + (0.0514459929 * c.b);
    var m: f32 = ((0.2119034982 * c.r) + (0.6806995451 * c.g)) + (0.1073969566 * c.b);
    var s: f32 = ((0.0883024619 * c.r) + (0.2817188376 * c.g)) + (0.6299787005 * c.b);
    var l_: f32 = pow(max(l, 0.0), 1.0 / 3.0);
    var m_: f32 = pow(max(m, 0.0), 1.0 / 3.0);
    var s_: f32 = pow(max(s, 0.0), 1.0 / 3.0);
    return vec3f(((0.2104542553 * l_) + (0.7936177850 * m_)) - (0.0040720468 * s_), ((1.9779984951 * l_) - (2.4285922050 * m_)) + (0.4505937099 * s_), ((0.0259040371 * l_) + (0.7827717662 * m_)) - (0.8086757660 * s_));
}

fn mo_oklab_to_linear(lab: vec3f) -> vec3f {
    var l_: f32 = (lab.x + (0.3963377774 * lab.y)) + (0.2158037573 * lab.z);
    var m_: f32 = (lab.x - (0.1055613458 * lab.y)) - (0.0638541728 * lab.z);
    var s_: f32 = (lab.x - (0.0894841775 * lab.y)) - (1.2914855480 * lab.z);
    var l: f32 = (l_ * l_) * l_;
    var m: f32 = (m_ * m_) * m_;
    var s: f32 = (s_ * s_) * s_;
    return vec3f(((4.0767416621 * l) - (3.3077115913 * m)) + (0.2309699292 * s), ((-1.2684380046 * l) + (2.6097574011 * m)) - (0.3413193965 * s), ((-0.0041960863 * l) - (0.7034186147 * m)) + (1.7076147010 * s));
}

fn mo_lch(L: f32, C: f32, h: f32) -> vec3f {
    return vec3f(L, C * cos(h), C * sin(h));
}

struct MOPalette {
    s0: vec3f,
    s1: vec3f,
    s2: vec3f,
    s3: vec3f
}

fn mo_palette(inkColor: vec4f, toneColor: vec4f, hueShift: f32, depth: f32) -> MOPalette {
    var ink: vec3f = mo_linear_to_oklab(mo_srgb_to_linear(vec3f(inkColor.rgb)));
    var tone: vec3f = mo_linear_to_oklab(mo_srgb_to_linear(vec3f(toneColor.rgb)));
    var L: f32 = tone.x;
    var C: f32 = length(tone.yz);
    var h: f32 = atan2(tone.z, tone.y) + hueShift;
    var d: f32 = clamp(depth, 0.30, 2.00);
    var p: MOPalette;
    p.s0 = ink;
    p.s1 = mo_lch(mix(ink.x, L, 0.30 / d), C * (0.52 + (0.10 * d)), h - 0.35);
    p.s2 = mo_lch(L, C, h);
    p.s3 = mo_lch(min(L * (1.20 + (0.12 * d)), 0.93), C * 0.55, h + 0.10);
    return p;
}

fn mo_shade(p: MOPalette, t: f32) -> vec3f {
    var t_p: f32 = t;
    t_p = clamp(t_p, 0.0, 1.0);
    var lab: vec3f;
    if (t_p < 0.40) {
        lab = mix(p.s0, p.s1, smoothstep(0.0, 1.0, t_p * 2.5));
    } else if (t_p < 0.78) {
        lab = mix(p.s1, p.s2, smoothstep(0.0, 1.0, (t_p - 0.40) * (1.0 / 0.38)));
    } else {
        lab = mix(p.s2, p.s3, smoothstep(0.0, 1.0, (t_p - 0.78) * (1.0 / 0.22)));
    }
    return mo_oklab_to_linear(lab);
}

fn mo_out(linearRGB: vec3f, pixel: vec2f) -> vec4f {
    var c: vec3f = mo_linear_to_srgb(linearRGB);
    var n: f32 = fract(52.9829189 * fract(dot(pixel, vec2f(0.06711056, 0.00583715))));
    var tri: f32 = select(1.0 - sqrt(max(0.0, 2.0 - (2.0 * n))), sqrt(2.0 * n) - 1.0, n < 0.5);
    c += vec3f(tri * (1.0 / 255.0));
    return vec4f(vec3f(saturate(c)), 1.0);
}

fn mo_knee(x: f32, knee: f32) -> f32 {
    return select(knee + ((1.0 - knee) * (1.0 - exp(-(x - knee) / max(1.0 - knee, 1e-3)))), x, x < knee);
}

fn mo_settle_law(tau: f32, settleTime: f32) -> vec3f {
    const HOLD: f32 = 0.055;
    var E: f32 = max(settleTime, 0.50);
    var k: f32 = 3.0 / E;
    var e: f32 = exp(-k * max(tau, 0.0));
    var v: f32 = HOLD + ((1.0 - HOLD) * e);
    var D: f32 = (HOLD * max(tau, 0.0)) + (((1.0 - HOLD) * (1.0 - e)) / k);
    return vec3f(v, D, e);
}

fn mo_tier(e: f32, K: f32, lo: f32, hi: f32) -> f32 {
    var x: f32 = clamp(e, 0.0, 1.0);
    var body: f32 = (x / K) * lo;
    var peak: f32 = lo + (((x - K) / (1.0 - K)) * (hi - lo));
    return mix(body, peak, smoothstep(K - 0.10, K + 0.10, x));
}

fn mo_flourish(t: f32, lane: f32) -> vec4f {
    const SLOT: f32 = 6.5;
    var slot: f32 = floor(t / SLOT);
    var local: f32 = t - (slot * SLOT);
    var start: f32 = 1.15 + (2.20 * mo_hash1(slot, lane));
    var dur: f32 = 1.60 + (1.40 * mo_hash1(slot + 811.0, lane));
    var u: f32 = (local - start) / dur;
    var sn: f32 = sin(3.14159265 * clamp(u, 0.0, 1.0));
    var env: f32 = select(sn * sn, 0.0, (u <= 0.0) || (u >= 1.0));
    return vec4f(env, clamp(u, 0.0, 1.0), mo_hash1(slot + 1607.0, lane), slot);
}

const MO_PHI: f32 = 1.6180339887498949;

const MO_INVP: f32 = 0.6180339887498949;

const MO_TAU: f32 = 6.2831853071795865;

const MO_R: f32 = 0.368;

const MO_KEY: vec3f = vec3f(-0.3983662, -0.5179150, 0.7570128);

const MO_SWEEP: vec3f = vec3f(-0.6550295, -0.6973379, 0.2909575);

fn mo_unit(v: vec3f) -> vec3f {
    var l: f32 = length(v);
    return select(vec3f(0.0, 0.0, 1.0), v / l, vec3<bool>(l > 1.0e-4));
}

fn mo_containment(uv: vec2f, reach: f32) -> f32 {
    var r: f32 = length(uv) * 2.0;
    return 1.0 - smoothstep(reach, reach + 0.16, r);
}

fn mo_finish(field: vec3f, inkLin: vec3f, containment: f32, position: vec2f, pixelScale: f32) -> vec4f {
    var rgb: vec3f = mix(inkLin, field, containment);
    rgb = vec3f(mo_knee(rgb.r, 0.90), mo_knee(rgb.g, 0.90), mo_knee(rgb.b, 0.90));
    return mo_out(rgb, position * pixelScale);
}

fn mo_drive_turn(tau: f32, T: f32) -> f32 {
    var u: f32 = clamp(max(tau, 0.0) / max(T, 1.0e-3), 0.0, 1.0);
    var below: f32 = T * (((u * u) * u) - ((((0.5 * u) * u) * u) * u));
    return select(below, max(tau, 0.0) - (0.5 * T), tau >= T);
}

struct MOState {
    crest: f32,
    wave: f32,
    accord: f32,
    settled: f32,
    drive: f32,
    turn: f32
}

fn mo_state(stateIndex: f32, stateTau: f32) -> MOState {
    var o: MOState;
    o.crest = 0.0;
    o.wave = 9.0;
    o.accord = 0.0;
    o.settled = 0.0;
    o.drive = 0.0;
    o.turn = 0.0;
    var tau: f32 = max(stateTau, 0.0);
    if ((stateIndex > 3.5) && (stateIndex < 4.5)) {
        var a: f32 = clamp(tau / 1.20, 0.0, 1.0);
        o.crest = smoothstep(0.0, 0.17, a) * (1.0 - smoothstep(0.46, 0.86, a));
        o.wave = 1.30 - (2.60 * smoothstep(0.0, 0.66, a));
        o.accord = smoothstep(0.06, 0.42, a) * (1.0 - smoothstep(0.66, 1.0, a));
        o.settled = smoothstep(0.30, 1.05, a);
    } else if ((stateIndex > 2.5) && (stateIndex < 3.5)) {
        o.drive = smoothstep(0.0, 0.55, tau);
        o.turn = mo_drive_turn(tau, 0.55);
    }
    return o;
}

fn mo_count(size: vec2f, formScale: f32) -> f32 {
    var pt: f32 = clamp(min(size.x, size.y), 12.0, 400.0);
    var n: f32 = mix(44.0, 158.0, smoothstep(18.0, 150.0, pt));
    var S: f32 = max(formScale, 0.10);
    return clamp(n / (S * S), 24.0, 320.0);
}

fn mo_madfrac(a: f32, b: f32) -> f32 {
    var x: f32 = a * b;
    return x - floor(x);
}

struct MOLattice {
    q: array<vec3f, 4>,
    i: array<f32, 4>
}

fn mo_lattice(p: vec3f, n: f32) -> MOLattice {
    var phi: f32 = min(atan2(p.y, p.x), M_PI_F);
    var cosT: f32 = clamp(p.z, -1.0, 1.0);
    var sin2: f32 = max(1.0 - (cosT * cosT), 1.0e-6);
    var k: f32 = max(2.0, floor(log(((n * M_PI_F) * 2.2360680) * sin2) / log(MO_PHI * MO_PHI)));
    var Fk: f32 = pow(MO_PHI, k) * 0.4472136;
    var F0: f32 = round(Fk);
    var F1: f32 = round(Fk * MO_PHI);
    var a0: f32 = MO_TAU * (mo_madfrac(F0 + 1.0, MO_INVP) - MO_INVP);
    var a1: f32 = MO_TAU * (mo_madfrac(F1 + 1.0, MO_INVP) - MO_INVP);
    var b0: f32 = (-2.0 * F0) / n;
    var b1: f32 = (-2.0 * F1) / n;
    var det: f32 = (a0 * b1) - (a1 * b0);
    var inv: f32 = 1.0 / (select(det, 1.0e-12, abs(det) < 1.0e-12));
    var rhs: vec2f = vec2f(phi, cosT - (1.0 - (1.0 / n)));
    var c: vec2f = floor(vec2f(((b1 * rhs.x) - (a1 * rhs.y)) * inv, ((-b0 * rhs.x) + (a0 * rhs.y)) * inv));
    var L: MOLattice;
    for (var s: i32 = 0; s < 4; s++) {
        var cell: vec2f = c + vec2f(f32(s & 1), f32(s >> 1u));
        var ct: f32 = ((b0 * cell.x) + (b1 * cell.y)) + (1.0 - (1.0 / n));
        ct = (clamp(ct, -1.0, 1.0) * 2.0) - ct;
        var idx: f32 = clamp(floor((n * 0.5) - ((ct * n) * 0.5)), 0.0, n - 1.0);
        var ph: f32 = MO_TAU * mo_madfrac(idx, MO_INVP);
        var cz: f32 = 1.0 - (((2.0 * idx) + 1.0) / n);
        var sz: f32 = sqrt(max(1.0 - (cz * cz), 0.0));
        L.q[s] = vec3f(cos(ph) * sz, sin(ph) * sz, cz);
        L.i[s] = idx;
    }
    return L;
}

fn mo_accent(index: f32, share: f32) -> f32 {
    var thr: f32 = clamp(share, 0.0, 1.0);
    var h: f32 = mo_hash1(index, 704.0);
    return (1.0 - smoothstep(thr - 0.035, thr + 0.035, h)) * smoothstep(0.0, 0.02, thr);
}

struct MOMaterial {
    m: f32,
    tierK: f32,
    tierLo: f32,
    tierHi: f32,
    accShare: f32,
    accLo: f32,
    accHi: f32,
    keyLo: f32,
    keyHi: f32,
    keyBLo: f32,
    keyBHi: f32,
    coreLo: f32,
    coreHi: f32,
    backMul: f32,
    bodyMul: f32,
    emis: f32
}

fn mo_material(dial: f32) -> MOMaterial {
    var m: f32 = clamp(dial, 0.0, 1.0);
    var o: MOMaterial;
    o.m = m;
    o.tierK = mix(0.42, 0.78, m);
    o.tierLo = 0.72;
    o.tierHi = mix(0.97, 1.00, m);
    o.accShare = mix(0.085, 0.200, m);
    o.accLo = mix(0.24, 0.30, m);
    o.accHi = mix(0.78, 0.80, m);
    o.keyLo = mix(0.72, 0.26, m);
    o.keyHi = mix(0.40, 0.98, m);
    o.keyBLo = mix(0.66, 0.44, m);
    o.keyBHi = mix(0.34, 0.60, m);
    o.coreLo = mix(0.88, 0.60, m);
    o.coreHi = mix(0.22, 0.72, m);
    o.backMul = mix(0.55, 1.00, m);
    o.bodyMul = mix(0.45, 1.00, m);
    o.emis = m;
    return o;
}

fn mo_lit(pal: MOPalette, e: f32, accentFrac: f32, glow: f32, emis: f32, mat: MOMaterial) -> vec3f {
    var G: f32 = max(glow, 0.0);
    var en: f32 = clamp(mo_knee(max(e, 0.0) * (0.35 + (0.65 * G)), 0.92), 0.0, 1.0);
    var tier: f32 = mo_tier(en, mat.tierK, mat.tierLo, mat.tierHi);
    var aF: f32 = clamp(accentFrac, 0.0, 1.0) * smoothstep(0.02, 0.24, en);
    var tRail: f32 = clamp(mix(tier, mat.accLo + ((mat.accHi - mat.accLo) * tier), aF), 0.0, 1.0);
    var col: vec3f = mo_shade(pal, tRail);
    var em: f32 = (emis * G) * (smoothstep(0.72, 1.0, tRail) + ((0.60 * aF) * smoothstep(0.44, 0.80, tRail)));
    return col * (1.0 + em);
}

struct MOSpec {
    kind: i32,
    n: f32,
    rad: f32,
    back: f32,
    key: f32,
    k0: f32,
    k1: f32,
    a0: f32,
    a1: f32,
    a2: f32,
    a3: f32,
    vec: vec3f,
    t: f32,
    act: f32,
    crest: f32,
    wave: f32,
    accord: f32,
    settled: f32,
    drive: f32
}

fn mo_warp(sp: MOSpec, p: vec3f) -> vec3f {
    if (sp.kind == 1) {
        var w: f32 = 0.55 + (0.45 * cos(((1.4 + (4.2 * sp.k0)) * M_PI_F) * p.z));
        var lane: f32 = (p.z - sp.a3) * 3.3;
        var ang: f32 = -((((sp.a0 * sp.t) + sp.a1) * w) + (sp.a2 * exp(-lane * lane)));
        var c: f32 = cos(ang);
        var s: f32 = sin(ang);
        return vec3f((c * p.x) - (s * p.y), (s * p.x) + (c * p.y), p.z);
    } else if (sp.kind == 3) {
        var u: f32 = clamp((clamp(p.z, -1.0, 1.0) + 1.0) * 0.5, 0.0, 1.0);
        var z0: f32 = clamp((2.0 * pow(u, 1.0 / max(sp.a0, 0.25))) - 1.0, -1.0, 1.0);
        var rxy: f32 = sqrt(max(1.0 - (z0 * z0), 0.0));
        var hl: f32 = length(p.xy);
        var h: vec2f = select(vec2f(1.0, 0.0), p.xy / hl, vec2<bool>(hl > 1.0e-5));
        var tw: f32 = -sp.a1 * (0.30 + (0.70 * u));
        var c: f32 = cos(tw);
        var s: f32 = sin(tw);
        return vec3f(((c * h.x) - (s * h.y)) * rxy, ((s * h.x) + (c * h.y)) * rxy, z0);
    } else if (sp.kind == 4) {
        var z: f32 = clamp(p.z, -1.0, 1.0);
        var z0: f32 = clamp(sign(z) * pow(abs(z), 1.0 / max(sp.a1, 0.20)), -1.0, 1.0);
        var rxy: f32 = sqrt(max(1.0 - (z0 * z0), 0.0));
        var hl: f32 = max(length(p.xy), 1.0e-5);
        var seat: vec3f = vec3f((p.xy / hl) * rxy, z0);
        var d: vec3f = (p * 2.55) + vec3f(sp.a2, sp.a2 * 0.73, -sp.a2 * 0.41);
        var nv: vec3f = vec3f(mo_noise3(d), mo_noise3(d + 31.7), mo_noise3(d + 77.3));
        return mo_unit(seat + (nv * (sp.a0 * (0.12 + (0.92 * sp.k0)))));
    } else if (sp.kind == 5) {
        var d: vec3f = (p * 3.35) + vec3f(sp.a2, sp.a2 * 0.61, -sp.a2 * 0.87);
        var nv: vec3f = vec3f(mo_noise3(d), mo_noise3(d + 19.1), mo_noise3(d + 53.9));
        return mo_unit(p + (nv * (sp.a0 * (0.040 + (0.135 * sp.k0)))));
    }
    return p;
}

fn mo_level(sp: MOSpec, q: vec3f, view: vec3f, index: f32) -> vec2f {
    var lvl: f32 = 1.0;
    var rs: f32 = 1.0;
    if (sp.kind == 0) {
        var br: f32 = 0.5 + (0.5 * sin((sp.t * 0.66) - (view.z * sp.a1)));
        rs = 1.0 + (sp.a0 * ((0.74 * br) - 0.35));
        lvl = 0.88 + ((0.30 * sp.a0) * br);
    } else if (sp.kind == 1) {
        var band: f32 = 0.5 + (0.5 * cos(((1.4 + (4.2 * sp.k0)) * M_PI_F) * q.z));
        var con: f32 = 0.52 + (0.40 * sp.act);
        lvl = (0.72 - (0.20 * sp.act)) + (con * band);
        rs = 0.92 + (0.17 * band);
    } else if (sp.kind == 2) {
        var u: f32 = sp.a0 - mo_hash1(index, 21.0);
        u -= floor(u);
        var spark: f32 = exp(sp.a1 * (cos(MO_TAU * u) - 1.0));
        var ch: f32 = (dot(view, MO_SWEEP) - sp.a3) * 3.7;
        var s: f32 = max(spark, sp.a2 * exp(-ch * ch));
        lvl = 0.44 + (1.06 * s);
        rs = 0.86 + (0.32 * s);
    } else if (sp.kind == 3) {
        var u0: f32 = clamp((q.z + 1.0) * 0.5, 1.0e-4, 1.0);
        var J: f32 = max(sp.a0 * pow(u0, sp.a0 - 1.0), 0.10);
        lvl = 0.64 + (0.36 * clamp(1.0 / J, 0.55, 2.60));
        rs = clamp(pow(J, 0.34), 0.60, 1.22);
    } else if (sp.kind == 4) {
        var az: f32 = max(abs(q.z), 1.0e-3);
        var za: f32 = sign(q.z) * pow(az, sp.a1);
        var ring: f32 = exp(-(za / 0.30) * (za / 0.30));
        var J: f32 = clamp(sp.a1 * pow(az, sp.a1 - 1.0), 0.06, 4.0);
        lvl = (0.56 + (0.26 * (1.0 - sp.a3))) + ((0.90 * ring) * sp.a3);
        rs = clamp(pow(J, 0.30), 0.58, 1.20);
    } else if (sp.kind == 5) {
        var air: f32 = sp.a0 * (0.30 + (0.70 * mo_hash1(index, 55.0)));
        lvl = 1.00 - (0.36 * air);
        rs = 1.00 - (0.24 * air);
    } else if (sp.kind == 6) {
        var x: f32 = dot(view, sp.vec);
        var day: f32 = smoothstep(-sp.a3 * 1.5, sp.a3 * 1.5, x);
        var dw: f32 = x / sp.a3;
        var dawn: f32 = exp(-dw * dw);
        lvl = (0.30 + (0.94 * day)) + ((0.58 * dawn) * sp.a0);
        rs = (0.90 + (0.22 * day)) + (0.16 * dawn);
    } else {
        var z: f32 = clamp(q.z, -1.0, 1.0);
        var lat: f32 = asin(z);
        var sinT: f32 = max(sqrt(max(1.0 - (z * z), 0.0)), 0.20);
        var s: f32 = (atan2(q.y, q.x) - (sp.a0 * lat)) - sp.a1;
        s -= MO_TAU * floor((s / MO_TAU) + 0.5);
        var dth: f32 = abs(s) / sqrt((1.0 / (sinT * sinT)) + (sp.a0 * sp.a0));
        var thr: f32 = 1.0 - smoothstep(sp.a3 * 0.45, sp.a3 * 1.70, dth);
        var bd: f32 = (lat - sp.a2) / ((0.24 + (0.52 * sp.k1)) + (0.42 * sp.act));
        var bead: f32 = exp(-bd * bd);
        lvl = (0.32 + (0.74 * thr)) + ((0.82 * thr) * bead);
        rs = (0.86 + (0.22 * thr)) + ((0.16 * thr) * bead);
    }
    var fr: f32 = (dot(view, MO_SWEEP) - sp.wave) * 3.33;
    lvl += (sp.crest * 1.35) * exp(-fr * fr);
    lvl = mix(lvl, 1.12, sp.accord * 0.72);
    rs = mix(rs, 1.05, sp.accord * 0.60);
    lvl *= 1.0 + (0.24 * sp.settled);
    return vec2f(max(lvl, 0.0), max(rs, 0.12));
}

struct MOHemi {
    cov: f32,
    energy: f32,
    accent: f32
}

fn mo_hemi(sp: MOSpec, mat: MOMaterial, L: MOLattice, look: vec3f, view: vec3f, radScale: f32, softFloor: f32, isBack: bool) -> MOHemi {
    var cov: f32 = 0.0;
    var wsum: f32 = 0.0;
    var coreW: f32 = 0.0;
    var accW: f32 = 0.0;
    var litW: f32 = 0.0;
    for (var s: i32 = 0; s < 4; s++) {
        var q: vec3f = L.q[s];
        var md: vec2f = mo_level(sp, q, view, L.i[s]);
        var rad: f32 = (sp.rad * radScale) * md.y;
        var soft: f32 = max(0.32 * rad, softFloor);
        var d: f32 = length(look - q);
        var c: f32 = 1.0 - smoothstep(max(rad - soft, 0.0), rad + soft, d);
        var u: f32 = clamp(1.0 - (d / max(rad, 1.0e-4)), 0.0, 1.0);
        cov = max(cov, c);
        wsum += c;
        coreW += c * smoothstep(0.34, 0.96, u);
        accW += c * mo_accent(L.i[s], mat.accShare);
        litW += c * md.x;
    }
    var inv: f32 = 1.0 / max(wsum, 1.0e-4);
    var core: f32 = coreW * inv;
    var o: MOHemi;
    o.cov = cov;
    o.accent = select(accW * inv, 0.0, isBack);
    o.energy = (cov * (litW * inv)) * (select(mat.coreLo + (mat.coreHi * core), 0.84 + (0.22 * core), isBack));
    return o;
}

fn mo_frame(spin: f32, tip: f32) -> mat3x3f {
    var c: f32 = cos(tip);
    var s: f32 = sin(tip);
    var C: f32 = cos(spin);
    var S: f32 = sin(spin);
    return mat3x3f(vec3f(C, -S, 0.0), vec3f(S * c, C * c, -s), vec3f(S * s, C * s, c));
}

fn mo_orb(sp: MOSpec, mat: MOMaterial, bodyFromView: mat3x3f, R: f32, position: vec2f, size: vec2f, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, depth: f32, glow: f32, emis: f32) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var inkLin: vec3f = mo_srgb_to_linear(vec3f(inkColor.rgb));
    var radiusPx: f32 = max((R * max(min(size.x, size.y), 1.0)) * max(pixelScale, 1.0), 2.0);
    var pxS: f32 = 1.0 / radiusPx;
    var sEdge: f32 = max(0.030, 2.4 * pxS);
    var s2: vec2f = uv / max(R, 1.0e-3);
    var rs2: f32 = length(s2);
    if (rs2 >= (1.0 + sEdge)) {
        return mo_out(inkLin, position * pixelScale);
    }
    const D: f32 = 6.0;
    const W: f32 = 1.0141851;
    var O: vec3f = vec3f(0.0, 0.0, D);
    var dir: vec3f = normalize(vec3f(s2 * W, 0.0) - O);
    var b: f32 = dot(O, dir);
    var sq: f32 = sqrt(max((b * b) - ((D * D) - 1.0), 0.0));
    var pNear: vec3f = normalize(O + (dir * (-b - sq)));
    var pFar: vec3f = normalize(O + (dir * (-b + sq)));
    var lamF: f32 = saturate(0.5 + (0.5 * dot(pNear, MO_KEY)));
    var lamB: f32 = saturate(0.5 + (0.5 * dot(pFar, MO_KEY)));
    var keyF: f32 = mix(1.0, mat.keyLo + (mat.keyHi * pow(lamF, 1.7)), sp.key);
    var keyB: f32 = mix(1.0, mat.keyBLo + (mat.keyBHi * pow(lamB, 1.7)), sp.key);
    var lookF: vec3f = mo_warp(sp, bodyFromView * pNear);
    var lookB: vec3f = mo_warp(sp, bodyFromView * pFar);
    var radF: f32 = 0.62 + (0.44 * (0.5 + (0.5 * pNear.z)));
    var radB: f32 = (0.62 + (0.44 * (0.5 + (0.5 * pFar.z)))) * 0.88;
    var fr: MOHemi = mo_hemi(sp, mat, mo_lattice(lookF, sp.n), lookF, pNear, radF, 1.5 * pxS, false);
    var bk: MOHemi = mo_hemi(sp, mat, mo_lattice(lookB, sp.n), lookB, pFar, radB, 1.5 * pxS, true);
    var body: f32 = (0.050 + (0.062 * keyF)) * mat.bodyMul;
    var sil: f32 = 1.0 - smoothstep(1.0 - sEdge, 1.0, rs2);
    var e: f32 = (((fr.energy * keyF) + ((((bk.energy * keyB) * sp.back) * mat.backMul) * (1.0 - fr.cov))) + body) * sil;
    var fw: f32 = (dot(pNear, MO_SWEEP) - sp.wave) * 3.33;
    var arrival: f32 = max((sp.crest * exp(-fw * fw)) * fr.cov, 0.22 * sp.settled);
    var emisNow: f32 = emis * (mat.emis + ((1.0 - mat.emis) * clamp(arrival, 0.0, 1.0)));
    var pal: MOPalette = mo_palette(inkColor, toneColor, hueShift, depth);
    var field: vec3f = mo_lit(pal, e, fr.accent * smoothstep(0.05, 0.35, fr.cov), glow, emisNow, mat);
    return mo_finish(field, inkLin, mo_containment(uv, 0.84), position, pixelScale);
}

fn mo_radius(n: f32, dotSize: f32) -> f32 {
    return ((0.34 + (0.52 * clamp(dotSize, 0.0, 1.0))) * 2.0) * inverseSqrt(max(n, 4.0));
}

fn mo_breathe(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32) -> vec4f {
    var t: f32 = time * max(speed, 0.0);
    var st: MOState = mo_state(stateIndex, stateTau);
    var fl: vec4f = mo_flourish(t, 5.0);
    var breath: f32 = clamp(c0, 0.0, 1.0);
    var depthFade: f32 = clamp(c1, 0.0, 1.0);
    var mat: MOMaterial = mo_material(c3);
    var sp: MOSpec;
    sp.kind = 0;
    sp.n = mo_count(size, formScale);
    sp.rad = mo_radius(sp.n, c2);
    sp.back = 0.72;
    sp.key = 1.0;
    sp.k0 = breath;
    sp.k1 = depthFade;
    var lv: f32 = clamp(level, 0.0, 1.0);
    sp.a0 = ((0.22 + (0.55 * breath)) * (1.0 + (0.62 * fl.x))) + (0.55 * lv);
    sp.a1 = (0.45 + (1.45 * depthFade)) * (1.0 - (0.85 * st.accord));
    sp.a2 = 0.0;
    sp.a3 = 0.0;
    sp.vec = vec3f(0.0, 0.0, 1.0);
    sp.t = t;
    sp.act = clamp(activity, 0.0, 1.0);
    sp.crest = st.crest;
    sp.wave = st.wave;
    sp.accord = st.accord;
    sp.settled = st.settled;
    sp.drive = st.drive;
    var spin: f32 = ((t * 0.32) + (0.085 * mo_fbm1(t * 0.115, 2, 5.0))) + (0.50 * st.turn);
    var tip: f32 = 1.2708 + (0.055 * sin(t * 0.083));
    var R: f32 = min(MO_R * ((1.0 + ((0.042 * sp.a0) * (0.5 + (0.5 * sin(t * 0.66))))) + (0.055 * lv)), 0.408);
    return mo_orb(sp, mat, mo_frame(spin, tip), R, position, size, pixelScale, inkColor, toneColor, hueShift, depth, glow, 0.32);
}

fn mo_orbit(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32) -> vec4f {
    var t: f32 = time * max(speed, 0.0);
    var st: MOState = mo_state(stateIndex, stateTau);
    var fl: vec4f = mo_flourish(t, 12.0);
    var bands: f32 = clamp(c0, 0.0, 1.0);
    var flow: f32 = clamp(c1, 0.0, 1.0);
    var rate: f32 = 0.16 + (0.40 * flow);
    var mat: MOMaterial = mo_material(c3);
    var sp: MOSpec;
    sp.kind = 1;
    sp.n = mo_count(size, formScale);
    sp.rad = mo_radius(sp.n, c2);
    sp.back = 0.72;
    sp.key = 1.0;
    sp.k0 = bands;
    sp.k1 = flow;
    sp.a0 = rate;
    sp.a1 = (rate * 1.35) * st.turn;
    sp.a2 = fl.x * 0.95;
    sp.a3 = (fl.z - 0.5) * 1.70;
    sp.vec = vec3f(0.0, 0.0, 1.0);
    sp.t = t;
    sp.act = clamp(activity, 0.0, 1.0);
    sp.crest = st.crest;
    sp.wave = st.wave;
    sp.accord = st.accord;
    sp.settled = st.settled;
    sp.drive = st.drive;
    var spin: f32 = ((t * 0.30) + (0.075 * mo_fbm1(t * 0.109, 2, 12.0))) + (0.44 * st.turn);
    var tip: f32 = 1.2708 + (0.050 * sin(t * 0.071));
    return mo_orb(sp, mat, mo_frame(spin, tip), MO_R, position, size, pixelScale, inkColor, toneColor, hueShift, depth, glow, 0.32);
}

fn mo_glimmer(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32) -> vec4f {
    var t: f32 = time * max(speed, 0.0);
    var st: MOState = mo_state(stateIndex, stateTau);
    var fl: vec4f = mo_flourish(t, 21.0);
    var sparkle: f32 = clamp(c0, 0.0, 1.0);
    var spread: f32 = clamp(c1, 0.0, 1.0);
    var rate: f32 = 0.13 + (0.26 * sparkle);
    var mat: MOMaterial = mo_material(c3);
    var sp: MOSpec;
    sp.kind = 2;
    sp.n = mo_count(size, formScale);
    sp.rad = mo_radius(sp.n, c2);
    sp.back = 0.66;
    sp.key = 1.0;
    sp.k0 = sparkle;
    sp.k1 = spread;
    sp.a0 = (t * rate) + ((rate * 1.10) * st.turn);
    sp.a1 = mix(mix(mix(24.0, 5.0, spread), 1.9, 0.55 * clamp(activity, 0.0, 1.0)), 0.9, st.accord);
    sp.a2 = fl.x;
    sp.a3 = 1.15 - (2.30 * fl.y);
    sp.vec = vec3f(0.0, 0.0, 1.0);
    sp.t = t;
    sp.act = clamp(activity, 0.0, 1.0);
    sp.crest = st.crest;
    sp.wave = st.wave;
    sp.accord = st.accord;
    sp.settled = st.settled;
    sp.drive = st.drive;
    var spin: f32 = ((t * 0.34) + (0.090 * mo_fbm1(t * 0.121, 2, 21.0))) + (0.46 * st.turn);
    var tip: f32 = 1.2708 + (0.060 * sin((t * 0.091) + 2.1));
    return mo_orb(sp, mat, mo_frame(spin, tip), MO_R, position, size, pixelScale, inkColor, toneColor, hueShift, depth, glow, 0.36);
}

fn mo_vortex(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32) -> vec4f {
    var t: f32 = time * max(speed, 0.0);
    var st: MOState = mo_state(stateIndex, stateTau);
    var fl: vec4f = mo_flourish(t, 34.0);
    var swirl: f32 = clamp(c0, 0.0, 1.0);
    var pole: f32 = clamp(c1, 0.0, 1.0);
    var beat: f32 = (((0.5 + (0.5 * sin((t * 0.187) - 1.10))) * (1.0 - (0.82 * st.accord))) + (0.26 * fl.x)) + (0.32 * clamp(level, 0.0, 1.0));
    beat = clamp(beat, 0.0, 1.15);
    var mat: MOMaterial = mo_material(c3);
    var sp: MOSpec;
    sp.kind = 3;
    sp.n = mo_count(size, formScale);
    sp.rad = mo_radius(sp.n, c2);
    sp.back = 0.70;
    sp.key = 1.0;
    sp.k0 = swirl;
    sp.k1 = pole;
    sp.a0 = mix(1.0, 0.50, clamp(pole * beat, 0.0, 1.0));
    sp.a1 = ((0.80 + (3.40 * swirl)) * beat) * (1.0 + (0.55 * st.drive));
    sp.a2 = 0.0;
    sp.a3 = 0.0;
    sp.vec = vec3f(0.0, 0.0, 1.0);
    sp.t = t;
    sp.act = clamp(activity, 0.0, 1.0);
    sp.crest = st.crest;
    sp.wave = st.wave;
    sp.accord = st.accord;
    sp.settled = st.settled;
    sp.drive = st.drive;
    var spin: f32 = ((t * 0.36) + (0.070 * mo_fbm1(t * 0.104, 2, 34.0))) + (0.48 * st.turn);
    var tip: f32 = 1.1900 + (0.055 * sin((t * 0.079) + 0.7));
    return mo_orb(sp, mat, mo_frame(spin, tip), MO_R, position, size, pixelScale, inkColor, toneColor, hueShift, depth, glow, 0.33);
}

fn mo_gather(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32) -> vec4f {
    var t: f32 = time * max(speed, 0.0);
    var st: MOState = mo_state(stateIndex, stateTau);
    var fl: vec4f = mo_flourish(t, 47.0);
    var pull: f32 = clamp(c0, 0.0, 1.0);
    var ring: f32 = clamp(c1, 0.0, 1.0);
    var tau: f32 = max(time - epoch, 0.0);
    var law: vec3f = mo_settle_law(tau, 5.50);
    var arc: f32 = clamp(max(1.0 - law.z, st.accord), 0.0, 1.0);
    var mat: MOMaterial = mo_material(c3);
    var sp: MOSpec;
    sp.kind = 4;
    sp.n = mo_count(size, formScale);
    sp.rad = mo_radius(sp.n, c2);
    sp.back = 0.72;
    sp.key = 1.0;
    sp.k0 = pull;
    sp.k1 = ring;
    sp.a0 = ((law.z * (1.0 - (0.92 * st.accord))) + 0.045) * (1.0 + (0.30 * fl.x));
    sp.a1 = 1.0 + (((0.60 + (2.00 * ring)) * arc) * ((1.0 + (0.35 * st.drive)) + (0.45 * clamp(level, 0.0, 1.0))));
    sp.a2 = (law.y * 0.95) + (0.55 * fl.x);
    sp.a3 = arc;
    sp.vec = vec3f(0.0, 0.0, 1.0);
    sp.t = t;
    sp.act = clamp(activity, 0.0, 1.0);
    sp.crest = st.crest;
    sp.wave = st.wave;
    sp.accord = st.accord;
    sp.settled = st.settled;
    sp.drive = st.drive;
    var spin: f32 = ((t * 0.33) + (0.080 * mo_fbm1(t * 0.113, 2, 47.0))) + (0.46 * st.turn);
    var tip: f32 = 1.2708 + (0.050 * sin(t * 0.087));
    var R: f32 = MO_R * (1.0 + (0.085 * law.z));
    return mo_orb(sp, mat, mo_frame(spin, tip), R, position, size, pixelScale, inkColor, toneColor, hueShift, depth, glow, 0.34);
}

fn mo_stir(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32) -> vec4f {
    var t: f32 = time * max(speed, 0.0);
    var st: MOState = mo_state(stateIndex, stateTau);
    var fl: vec4f = mo_flourish(t, 58.0);
    var jitter: f32 = clamp(c0, 0.0, 1.0);
    var settle: f32 = clamp(c1, 0.0, 1.0);
    var env: f32 = pow(fl.x, mix(0.75, 2.20, settle));
    var mat: MOMaterial = mo_material(c3);
    var sp: MOSpec;
    sp.kind = 5;
    sp.n = mo_count(size, formScale);
    sp.rad = mo_radius(sp.n, c2);
    sp.back = 0.72;
    sp.key = 1.0;
    sp.k0 = jitter;
    sp.k1 = settle;
    sp.a0 = (min((0.16 + (0.36 * clamp(activity, 0.0, 1.0))) + (0.84 * env), 1.20) * (1.0 - (0.90 * st.accord))) * (1.0 - (0.35 * st.drive));
    sp.a1 = 0.0;
    sp.a2 = (t * 0.185) + (0.62 * fl.x);
    sp.a3 = 0.0;
    sp.vec = vec3f(0.0, 0.0, 1.0);
    sp.t = t;
    sp.act = clamp(activity, 0.0, 1.0);
    sp.crest = st.crest;
    sp.wave = st.wave;
    sp.accord = st.accord;
    sp.settled = st.settled;
    sp.drive = st.drive;
    var spin: f32 = ((t * 0.35) + (0.095 * mo_fbm1(t * 0.127, 2, 58.0))) + (0.50 * st.turn);
    var tip: f32 = 1.2708 + (0.065 * sin((t * 0.095) + 1.4));
    return mo_orb(sp, mat, mo_frame(spin, tip), MO_R, position, size, pixelScale, inkColor, toneColor, hueShift, depth, glow, 0.32);
}

fn mo_daybreak(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32) -> vec4f {
    var t: f32 = time * max(speed, 0.0);
    var st: MOState = mo_state(stateIndex, stateTau);
    var fl: vec4f = mo_flourish(t, 66.0);
    var sweep: f32 = clamp(c0, 0.0, 1.0);
    var softness: f32 = clamp(c1, 0.0, 1.0);
    var rate: f32 = 0.15 + (0.26 * sweep);
    var sa: f32 = (t * rate) + ((rate * 1.25) * st.turn);
    var mat: MOMaterial = mo_material(c3);
    var sp: MOSpec;
    sp.kind = 6;
    sp.n = mo_count(size, formScale);
    sp.rad = mo_radius(sp.n, c2);
    sp.back = 0.58;
    sp.key = 0.28;
    sp.k0 = sweep;
    sp.k1 = softness;
    var lv: f32 = clamp(level, 0.0, 1.0);
    sp.a0 = (0.55 + (0.95 * fl.x)) + (0.75 * lv);
    sp.a1 = 0.0;
    sp.a2 = 0.0;
    sp.a3 = (0.10 + (0.30 * softness)) * ((1.0 + (3.4 * st.accord)) + (0.40 * lv));
    sp.vec = normalize(vec3f(cos(sa) * 0.94, -0.32, 0.34 + (0.60 * sin(sa))));
    sp.t = t;
    sp.act = clamp(activity, 0.0, 1.0);
    sp.crest = st.crest;
    sp.wave = st.wave;
    sp.accord = st.accord;
    sp.settled = st.settled;
    sp.drive = st.drive;
    var spin: f32 = ((t * 0.24) + (0.070 * mo_fbm1(t * 0.101, 2, 66.0))) + (0.40 * st.turn);
    var tip: f32 = 1.2708 + (0.045 * sin(t * 0.067));
    return mo_orb(sp, mat, mo_frame(spin, tip), MO_R, position, size, pixelScale, inkColor, toneColor, hueShift, depth, glow, 0.35);
}

fn mo_skein(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32) -> vec4f {
    var t: f32 = time * max(speed, 0.0);
    var st: MOState = mo_state(stateIndex, stateTau);
    var fl: vec4f = mo_flourish(t, 79.0);
    var winding: f32 = clamp(c0, 0.0, 1.0);
    var trail: f32 = clamp(c1, 0.0, 1.0);
    var rate: f32 = 0.28 + (0.40 * trail);
    var mat: MOMaterial = mo_material(c3);
    var sp: MOSpec;
    sp.kind = 7;
    sp.n = mo_count(size, formScale);
    sp.rad = mo_radius(sp.n, c2);
    sp.back = 0.70;
    sp.key = 1.0;
    sp.k0 = winding;
    sp.k1 = trail;
    sp.a0 = (3.0 + (6.0 * winding)) * (1.0 + (0.20 * sin(t * 0.128)));
    sp.a1 = ((t * rate) + ((rate * 1.30) * st.turn)) + (2.60 * fl.x);
    sp.a2 = 1.92 * sin((t * 0.117) + 1.30);
    sp.a3 = (0.095 + (0.070 * (1.0 - trail))) * (1.0 + (11.0 * st.accord));
    sp.vec = vec3f(0.0, 0.0, 1.0);
    sp.t = t;
    sp.act = clamp(activity, 0.0, 1.0);
    sp.crest = st.crest;
    sp.wave = st.wave;
    sp.accord = st.accord;
    sp.settled = st.settled;
    sp.drive = st.drive;
    var spin: f32 = ((t * 0.31) + (0.085 * mo_fbm1(t * 0.119, 2, 79.0))) + (0.46 * st.turn);
    var tip: f32 = 1.2708 + (0.055 * sin((t * 0.073) + 0.4));
    return mo_orb(sp, mat, mo_frame(spin, tip), MO_R, position, size, pixelScale, inkColor, toneColor, hueShift, depth, glow, 0.34);
}

struct OrbU {
    size: vec2f, origin: vec2f,
    ink: vec4f, tone: vec4f, tone2: vec4f,
    tilt: vec2f, time: f32, pixelScale: f32,
    hueShift: f32, formScale: f32, speed: f32, depth: f32,
    glow: f32, c0: f32, c1: f32, c2: f32,
    c3: f32, epoch: f32, stateIndex: f32, stateTau: f32,
    level: f32, activity: f32, voiceT: f32, paceT: f32,
    driveT: f32, vdT: f32, pdT: f32, levelT: f32,
    activityT: f32, pad0: f32, pad1: f32, pad2: f32,
}
@group(0) @binding(0) var<uniform> u: OrbU;

@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(p[i], 0.0, 1.0);
}

// Circle clip with a one-pixel soft edge, premultiplied so the orb sits on
// whatever ground the page paints behind it.
fn orb_clip(pos: vec2f, rgb: vec3f) -> vec4f {
    let uv = (pos - 0.5 * u.size) / max(min(u.size.x, u.size.y), 1.0);
    let r = length(uv) * 2.0;
    let px = 2.0 / (min(u.size.x, u.size.y) * u.pixelScale);
    let a = 1.0 - smoothstep(1.0 - px, 1.0 + px, r);
    return vec4f(rgb * a, a);
}

@fragment fn fs_breathe(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mo_breathe(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_orbit(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mo_orbit(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_glimmer(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mo_glimmer(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_vortex(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mo_vortex(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_gather(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mo_gather(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_stir(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mo_stir(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_daybreak(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mo_daybreak(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_skein(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mo_skein(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity);
    return orb_clip(pos, c.rgb);
}
