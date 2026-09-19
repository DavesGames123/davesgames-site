// Orb shader pack. WGSL, WebGPU.
// Derived from the Metal shaders of the MIT-licensed "murmur" package
// (c) Kris Puckett; ported function-for-function. MIT notice retained.
const M_PI_F: f32 = 3.14159265358979;

fn ml_hash(v: vec3u) -> u32 {
    var h: u32 = ((v.x * 1597334673u) ^ (v.y * 3812015801u)) ^ (v.z * 2798796415u);
    h ^= h >> 15u;
    h *= 2246822519u;
    h ^= h >> 13u;
    h *= 3266489917u;
    h ^= h >> 16u;
    return h;
}

fn ml_grad3(c: vec3i) -> vec3f {
    var h: u32 = ml_hash(vec3u(c + 4096));
    var z: f32 = fma(f32(h & 0xFFFFu), 2.0 / 65535.0, -1.0);
    var a: f32 = f32((h >> 16u) & 0xFFFFu) * (6.28318530718 / 65536.0);
    var r: f32 = sqrt(max(0.0, 1.0 - (z * z)));
    return vec3f(r * cos(a), r * sin(a), z);
}

fn ml_noise3(p: vec3f) -> f32 {
    var i: vec3f = floor(p);
    var f: vec3f = p - i;
    var u: vec3f = ((f * f) * f) * ((f * ((f * 6.0) - 15.0)) + 10.0);
    var c: vec3i = vec3i(i);
    var va: f32 = dot(ml_grad3(c + vec3i(0, 0, 0)), f - vec3f(0.0, 0.0, 0.0));
    var vb: f32 = dot(ml_grad3(c + vec3i(1, 0, 0)), f - vec3f(1.0, 0.0, 0.0));
    var vc: f32 = dot(ml_grad3(c + vec3i(0, 1, 0)), f - vec3f(0.0, 1.0, 0.0));
    var vd: f32 = dot(ml_grad3(c + vec3i(1, 1, 0)), f - vec3f(1.0, 1.0, 0.0));
    var ve: f32 = dot(ml_grad3(c + vec3i(0, 0, 1)), f - vec3f(0.0, 0.0, 1.0));
    var vf: f32 = dot(ml_grad3(c + vec3i(1, 0, 1)), f - vec3f(1.0, 0.0, 1.0));
    var vg: f32 = dot(ml_grad3(c + vec3i(0, 1, 1)), f - vec3f(0.0, 1.0, 1.0));
    var vh: f32 = dot(ml_grad3(c + vec3i(1, 1, 1)), f - vec3f(1.0, 1.0, 1.0));
    return mix(mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y), mix(mix(ve, vf, u.x), mix(vg, vh, u.x), u.y), u.z);
}

const ML_ROT: mat3x3f = mat3x3f(vec3f(0.00, 0.80, 0.60), vec3f(-0.80, 0.36, -0.48), vec3f(-0.60, -0.48, 0.64));

fn ml_fbm3(p: vec3f, octaves: i32, lacunarity: f32, gain: f32) -> f32 {
    var q: vec3f = p;
    var amp: f32 = 0.5;
    var value: f32 = 0.0;
    for (var i: i32 = 0; i < octaves; i++) {
        value += amp * ml_noise3(q);
        amp *= gain;
        q = lacunarity * (ML_ROT * q);
    }
    return value;
}

fn ml_hash1(cell: f32, lane: f32) -> f32 {
    return f32(ml_hash(vec3u(u32(i32(cell) + 32768), u32(i32(lane) + 32768), 0x9E3779B9u)) >> 8u) * (1.0 / 16777216.0);
}

fn ml_vnoise1(x: f32, lane: f32) -> f32 {
    var i: f32 = floor(x);
    var f: f32 = x - i;
    var u: f32 = ((f * f) * f) * ((f * ((f * 6.0) - 15.0)) + 10.0);
    return (mix(ml_hash1(i, lane), ml_hash1(i + 1.0, lane), u) * 2.0) - 1.0;
}

fn ml_fbm1(x: f32, octaves: i32, lane: f32) -> f32 {
    var v: f32 = 0.0;
    var amp: f32 = 0.5;
    var f: f32 = 1.0;
    for (var i: i32 = 0; i < octaves; i++) {
        v += amp * ml_vnoise1(x * f, lane + (f32(i) * 37.0));
        amp *= 0.5;
        f *= 2.03;
    }
    return v;
}

fn ml_srgb_to_linear(c: vec3f) -> vec3f {
    var c_p: vec3f = c;
    c_p = max(c_p, vec3f(0.0));
    return select(c_p * (1.0 / 12.92), pow((c_p + 0.055) * (1.0 / 1.055), vec3f(2.4)), c_p > vec3f(0.04045));
}

fn ml_linear_to_srgb(c: vec3f) -> vec3f {
    var c_p: vec3f = c;
    c_p = max(c_p, vec3f(0.0));
    return select(c_p * 12.92, (1.055 * pow(c_p, vec3f(1.0 / 2.4))) - 0.055, c_p > vec3f(0.0031308));
}

fn ml_linear_to_oklab(c: vec3f) -> vec3f {
    var l: f32 = ((0.4122214708 * c.r) + (0.5363325363 * c.g)) + (0.0514459929 * c.b);
    var m: f32 = ((0.2119034982 * c.r) + (0.6806995451 * c.g)) + (0.1073969566 * c.b);
    var s: f32 = ((0.0883024619 * c.r) + (0.2817188376 * c.g)) + (0.6299787005 * c.b);
    var l_: f32 = pow(max(l, 0.0), 1.0 / 3.0);
    var m_: f32 = pow(max(m, 0.0), 1.0 / 3.0);
    var s_: f32 = pow(max(s, 0.0), 1.0 / 3.0);
    return vec3f(((0.2104542553 * l_) + (0.7936177850 * m_)) - (0.0040720468 * s_), ((1.9779984951 * l_) - (2.4285922050 * m_)) + (0.4505937099 * s_), ((0.0259040371 * l_) + (0.7827717662 * m_)) - (0.8086757660 * s_));
}

fn ml_oklab_to_linear(lab: vec3f) -> vec3f {
    var l_: f32 = (lab.x + (0.3963377774 * lab.y)) + (0.2158037573 * lab.z);
    var m_: f32 = (lab.x - (0.1055613458 * lab.y)) - (0.0638541728 * lab.z);
    var s_: f32 = (lab.x - (0.0894841775 * lab.y)) - (1.2914855480 * lab.z);
    var l: f32 = (l_ * l_) * l_;
    var m: f32 = (m_ * m_) * m_;
    var s: f32 = (s_ * s_) * s_;
    return vec3f(((4.0767416621 * l) - (3.3077115913 * m)) + (0.2309699292 * s), ((-1.2684380046 * l) + (2.6097574011 * m)) - (0.3413193965 * s), ((-0.0041960863 * l) - (0.7034186147 * m)) + (1.7076147010 * s));
}

fn ml_lch(L: f32, C: f32, h: f32) -> vec3f {
    return vec3f(L, C * cos(h), C * sin(h));
}

struct MLPalette {
    s0: vec3f,
    s1: vec3f,
    s2: vec3f,
    s3: vec3f
}

fn ml_palette(inkColor: vec4f, toneColor: vec4f, hueShift: f32, depth: f32) -> MLPalette {
    var ink: vec3f = ml_linear_to_oklab(ml_srgb_to_linear(vec3f(inkColor.rgb)));
    var tone: vec3f = ml_linear_to_oklab(ml_srgb_to_linear(vec3f(toneColor.rgb)));
    var L: f32 = tone.x;
    var C: f32 = length(tone.yz);
    var h: f32 = atan2(tone.z, tone.y) + hueShift;
    var d: f32 = clamp(depth, 0.30, 2.00);
    var p: MLPalette;
    p.s0 = ink;
    p.s1 = ml_lch(mix(ink.x, L, 0.30 / d), C * (0.52 + (0.10 * d)), h - 0.35);
    p.s2 = ml_lch(L, C, h);
    p.s3 = ml_lch(min(L * (1.20 + (0.12 * d)), 0.93), C * 0.55, h + 0.10);
    return p;
}

fn ml_shade(p: MLPalette, t: f32) -> vec3f {
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
    return ml_oklab_to_linear(lab);
}

fn ml_knee(x: f32, knee: f32) -> f32 {
    return select(knee + ((1.0 - knee) * (1.0 - exp(-(x - knee) / max(1.0 - knee, 1e-3)))), x, x < knee);
}

fn ml_out(linearRGB: vec3f, pixel: vec2f) -> vec4f {
    var c: vec3f = ml_linear_to_srgb(linearRGB);
    var n: f32 = fract(52.9829189 * fract(dot(pixel, vec2f(0.06711056, 0.00583715))));
    var tri: f32 = select(1.0 - sqrt(max(0.0, 2.0 - (2.0 * n))), sqrt(2.0 * n) - 1.0, n < 0.5);
    c += vec3f(tri * (1.0 / 255.0));
    return vec4f(vec3f(saturate(c)), 1.0);
}

fn ml_bowl(uv: vec2f) -> f32 {
    var r: f32 = length(uv) * 2.0;
    return 1.0 - smoothstep(0.80, 0.96, r);
}

struct MLOrb {
    n: vec3f,
    z: f32,
    mask: f32,
    lam: f32,
    phi: f32,
    shade: f32
}

fn ml_orb(uv: vec2f, radius: f32) -> MLOrb {
    var o: MLOrb;
    var s: vec2f = uv / max(radius, 1e-4);
    var d: f32 = length(s);
    var dc: f32 = min(d, 1.0);
    var z: f32 = sqrt(max(1.0 - (dc * dc), 0.0));
    o.n = vec3f(s.x, s.y, z);
    o.z = z;
    o.mask = 1.0 - smoothstep(0.86, 1.02, d);
    o.lam = atan2(s.x, max(z, 1e-3));
    o.phi = asin(clamp(s.y, -1.0, 1.0));
    var key: f32 = 0.58 + (0.42 * saturate(dot(o.n, normalize(vec3f(-0.34, -0.46, 0.82)))));
    o.shade = mix(0.34, 1.0, pow(max(z, 0.0), 0.55)) * key;
    return o;
}

fn ml_write(pal: MLPalette, inkLin: vec3f, t: f32, hot: f32, emRail: f32, glow: f32, contain: f32, pixel: vec2f) -> vec4f {
    var lit: vec3f = ml_shade(pal, t);
    var em: vec3f = ml_shade(pal, emRail) * ((0.42 * clamp(hot, 0.0, 1.5)) * max(glow, 0.0));
    var rgb: vec3f = mix(inkLin, lit + em, contain);
    rgb = vec3f(ml_knee(rgb.r, 0.90), ml_knee(rgb.g, 0.90), ml_knee(rgb.b, 0.90));
    return ml_out(rgb, pixel);
}

fn ml_tier(body: f32, key: f32) -> f32 {
    var b: f32 = 0.74 * ml_knee(body / 0.74, 0.72);
    return b + (0.30 * clamp(key, 0.0, 1.0));
}

fn ml_uv(position: vec2f, size: vec2f) -> vec2f {
    return (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
}

struct MLState {
    surge: f32,
    front: f32,
    lift: f32,
    drive: f32,
    push: f32
}

fn ml_state(stateIndex: f32, stateTau: f32) -> MLState {
    var s: MLState;
    s.surge = 0.0;
    s.front = 0.0;
    s.lift = 0.0;
    s.drive = 0.0;
    s.push = 0.0;
    var tau: f32 = max(stateTau, 0.0);
    if (abs(stateIndex - 4.0) < 0.5) {
        const D: f32 = 1.20;
        var x: f32 = min(tau / D, 1.0);
        s.front = mix(-0.30, 1.30, x);
        s.surge = smoothstep(0.0, 0.13, x) * (1.0 - smoothstep(0.70, 1.0, x));
        s.lift = smoothstep(0.45, 1.0, x) * exp(-max(tau - D, 0.0) / 2.4);
    } else if (abs(stateIndex - 3.0) < 0.5) {
        var k: f32 = min(tau / 0.45, 1.0);
        s.drive = (k * k) * (3.0 - (2.0 * k));
        s.push = select(tau - 0.225, 0.45 * (((k * k) * k) - ((((0.5 * k) * k) * k) * k)), tau <= 0.45);
    }
    return s;
}

fn ml_crest(s01: f32, st: MLState, width: f32) -> f32 {
    var d: f32 = (s01 - st.front) / max(width, 1e-3);
    return st.surge * exp(-d * d);
}

fn ml_crest_wrap(s01: f32, st: MLState, width: f32) -> f32 {
    var d: f32 = s01 - st.front;
    d -= floor(d + 0.5);
    return st.surge * exp(-(d * d) / max(width * width, 1e-6));
}

fn ml_tic(t: f32, lane: f32, dur: f32) -> vec2f {
    const L: f32 = 6.5;
    const J: f32 = 1.25;
    var e: f32 = 0.0;
    var pick: f32 = 0.0;
    var best: f32 = 0.0;
    var k0: f32 = floor(t / L);
    for (var i: i32 = -1; i <= 1; i++) {
        var k: f32 = k0 + f32(i);
        var s: f32 = (k * L) + (((ml_hash1(k, lane) * 2.0) - 1.0) * J);
        var x: f32 = (t - s) / max(dur, 0.05);
        var b: f32 = select(0.0, smoothstep(0.0, 0.35, x) * (1.0 - smoothstep(0.35, 1.0, x)), (x > 0.0) && (x < 1.0));
        e += b;
        if (b > best) {
            best = b;
            pick = ml_hash1(k + 811.0, lane);
        }
    }
    return vec2f(min(e, 1.0), pick);
}

fn ml_eddy(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32) -> vec4f {
    var uv: vec2f = ml_uv(position, size);
    var S: f32 = max(formScale, 0.10);
    var T: f32 = time * max(speed, 0.0);
    var swirl: f32 = clamp(c0, 0.0, 1.0);
    var drift: f32 = clamp(c1, 0.0, 1.0);
    var grain: f32 = clamp(c2, 0.0, 1.0);
    var shear: f32 = clamp(c3, 0.0, 1.0);
    var st: MLState = ml_state(stateIndex, stateTau);
    var core: vec2f = (0.028 + (0.070 * drift)) * vec2f(sin(T * 0.199), cos((T * 0.155) + 1.7));
    var pc: vec2f = uv - core;
    var orb: MLOrb = ml_orb(pc, 0.38);
    var r: f32 = length(pc);
    const RC: f32 = 0.17;
    const R0: f32 = 0.25;
    var fall: f32 = mix(0.55, 1.45, shear);
    var prof: f32 = pow((R0 + RC) / (r + RC), fall);
    const PR_R: f32 = 0.677;
    const KMAX: f32 = 24.0;
    var PR: f32 = pow(PR_R, fall);
    var amp: f32 = 0.110 + (0.300 * swirl);
    var rigid: f32 = amp * (PR + 0.52);
    var diff: f32 = amp * max(prof - PR, 0.0);
    var TW: f32 = KMAX * ml_knee((T + 7.0) / KMAX, 0.70);
    var tic: vec2f = ml_tic(T + 0.0, 3.0, 2.3);
    var th: f32 = ((((rigid * (T + 7.0)) + ((amp * 0.95) * st.push)) + (diff * TW)) + ((tic.x * 0.50) * prof)) + ((clamp(level, 0.0, 1.0) * 1.35) * prof);
    var cs: f32 = cos(th);
    var sn: f32 = sin(th);
    var q3: vec3f = vec3f((cs * orb.n.x) - (sn * orb.n.y), (sn * orb.n.x) + (cs * orb.n.y), orb.n.z);
    var f: f32 = 2.8 / S;
    var dom: vec3f = (q3 * f) + vec3f(0.0, 0.0, (0.085 + (0.110 * drift)) * T);
    var n: f32 = ml_fbm3(dom, 3, 2.03, 0.5);
    var g: f32 = ml_noise3((dom * 2.85) + vec3f(11.3, 5.1, 0.0));
    var mass: f32 = (0.5 + (1.00 * n)) + ((0.17 * grain) * g);
    var dens: f32 = smoothstep(0.36 + (0.06 * st.drive), 0.88 - (0.10 * st.drive), mass) * orb.mask;
    var ang01: f32 = (atan2(q3.y, q3.x) * (1.0 / 6.2831853)) + 0.5;
    dens *= (1.0 + (1.00 * ml_crest_wrap(ang01, st, 0.26))) + (0.16 * st.lift);
    var armSel: f32 = 0.5 + (0.5 * cos(atan2(q3.y, q3.x) - (0.34 * T)));
    var key: f32 = smoothstep(0.72, 0.99, dens * (0.52 + (0.78 * armSel))) * orb.z;
    var pal: MLPalette = ml_palette(inkColor, toneColor, hueShift, depth);
    var inkLin: vec3f = ml_srgb_to_linear(vec3f(inkColor.rgb));
    var t: f32 = ml_tier(0.045 + ((0.94 * dens) * orb.shade), key);
    var hot: f32 = smoothstep(0.58, 1.00, dens) + (0.55 * key);
    return ml_write(pal, inkLin, t, hot, 0.88, glow, ml_bowl(uv), position * pixelScale);
}

fn ml_well(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32) -> vec4f {
    var uv: vec2f = ml_uv(position, size);
    var S: f32 = max(formScale, 0.10);
    var T: f32 = time * max(speed, 0.0);
    var pull: f32 = clamp(c0, 0.0, 1.0);
    var dglow: f32 = clamp(c1, 0.0, 1.0);
    var churn: f32 = clamp(c2, 0.0, 1.0);
    var offset: f32 = clamp(c3, 0.0, 1.0);
    var st: MLState = ml_state(stateIndex, stateTau);
    var ecc: f32 = 0.20 * offset;
    var ea: f32 = (0.065 * T) + 0.9;
    var core: vec2f = ecc * vec2f(cos(ea), sin(ea));
    var p: vec2f = uv - core;
    var orb: MLOrb = ml_orb(p, 0.38);
    var r: f32 = length(p);
    var dir: vec2f = p / max(r, 1e-5);
    var arcN: f32 = asin(clamp(r / 0.38, 0.0, 1.0)) * (1.0 / 1.5708);
    var rr: f32 = arcN * 0.45;
    const SC: f32 = 0.26;
    const KW: f32 = 20.0;
    var spinA: f32 = 0.026 + (0.096 * churn);
    var rigidS: f32 = spinA / (0.45 + SC);
    var diffS: f32 = max((spinA / (r + SC)) - rigidS, 0.0);
    var th: f32 = (rigidS * T) + (diffS * (KW * ml_knee(T / KW, 0.70)));
    var cs: f32 = cos(th);
    var sn: f32 = sin(th);
    var d2: vec2f = vec2f((cs * dir.x) - (sn * dir.y), (sn * dir.x) + (cs * dir.y));
    var warp: f32 = ml_noise3(vec3f(p * (2.2 / S), 51.0 + (0.045 * T)));
    const RC: f32 = 0.14;
    var tic: vec2f = ml_tic(T + 1.7, 11.0, 2.6);
    var aa: f32 = atan2(d2.y, d2.x) + (0.55 * warp);
    var travel: f32 = (((0.42 * (0.55 + (0.90 * pull))) * T) + ((0.60 * (0.55 + (0.90 * pull))) * st.push)) + (tic.x * 0.30);
    var Rc: f32 = 2.55 / S;
    var radial: f32 = (rr + RC) * (4.1 / S);
    var dom: vec3f = vec3f(cos(aa) * Rc, sin(aa) * Rc, radial - travel);
    var n: f32 = ml_fbm3(dom, 3, 2.03, 0.5);
    var env: f32 = 0.5 + (0.5 * ml_noise3(vec3f(p * (1.3 / S), 31.0 + (0.068 * T))));
    var streams: f32 = smoothstep(0.30 + (0.08 * st.drive), 0.92 - (0.09 * st.drive), 0.5 + (1.05 * n));
    var conv: f32 = smoothstep(0.48, 0.10, rr);
    var throat: f32 = smoothstep(0.025, (0.165 + (0.075 * warp)) + (0.100 * tic.x), rr);
    var floorLight: f32 = 0.20 + (0.22 * conv);
    var dens: f32 = (((floorLight + ((0.50 + (0.40 * conv)) * streams)) * throat) * (0.25 + (1.05 * env))) * orb.mask;
    var lum: f32 = 1.0 + ((((0.30 + (0.60 * dglow)) + (0.55 * clamp(level, 0.0, 1.0))) * conv) * throat);
    var crest: f32 = ml_crest(clamp(arcN, 0.0, 1.0), st, 0.30);
    dens *= (1.0 + (0.85 * crest)) + (0.14 * st.lift);
    var bright: f32 = ml_knee((dens * lum) * 0.62, 0.58);
    var pal: MLPalette = ml_palette(inkColor, toneColor, hueShift, depth);
    var inkLin: vec3f = ml_srgb_to_linear(vec3f(inkColor.rgb));
    var key: f32 = (smoothstep(0.62, 0.97, bright) * smoothstep(0.06, 0.42, conv)) * orb.z;
    var t: f32 = ml_tier(0.050 + ((0.80 * bright) * orb.shade), key);
    var hot: f32 = (smoothstep(0.66, 1.00, bright) * 0.70) + (0.50 * key);
    return ml_write(pal, inkLin, t, hot, 0.88, glow, ml_bowl(uv), position * pixelScale);
}

fn ml_tide(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32) -> vec4f {
    var uv: vec2f = ml_uv(position, size);
    var S: f32 = max(formScale, 0.10);
    var T: f32 = time * max(speed, 0.0);
    var reach: f32 = clamp(c0, 0.0, 1.0);
    var lean: f32 = clamp(c1, 0.0, 1.0);
    var foam: f32 = clamp(c2, 0.0, 1.0);
    var per: f32 = clamp(c3, 0.0, 1.0);
    var st: MLState = ml_state(stateIndex, stateTau);
    var orb: MLOrb = ml_orb(uv, 0.38);
    var P: f32 = mix(10.0, 4.0, per);
    var w: f32 = 6.2831853 / P;
    var ph: f32 = w * T;
    var tic: vec2f = ml_tic(T + 3.1, 19.0, 2.8);
    var A: f32 = (0.16 + (0.30 * reach)) * (((1.0 + (0.30 * tic.x)) + (0.28 * st.drive)) + (0.45 * clamp(activity, 0.0, 1.0)));
    var pos: f32 = -A * cos(ph);
    var vel: f32 = sin(ph);
    var sway: f32 = pos / max(A, 1e-4);
    var up: vec3f = normalize(vec3f((0.62 * lean) * sway, -1.0, 0.44));
    var hgt: f32 = dot(orb.n, up);
    var ripple: f32 = 0.055 * ml_fbm1((((orb.lam - (pos * 2.2)) * 1.9) / S) + (0.49 * T), 3, 5.0);
    var surge: f32 = ml_crest(clamp((orb.lam * 0.64) + 0.5, 0.0, 1.0), st, 0.32);
    var waterline: f32 = ((0.055 + ripple) - (0.115 * tic.x)) - (0.10 * surge);
    var below: f32 = waterline - hgt;
    var f: f32 = 2.6 / S;
    var dom: vec3f = (vec3f(orb.n.x - (pos * 0.55), orb.n.y, orb.n.z) * f) + vec3f(0.0, 0.0, 0.070 * T);
    var n: f32 = ml_fbm3(dom, 3, 2.03, 0.5);
    var body: f32 = smoothstep(-0.045, 0.075, below);
    var weight: f32 = 0.30 + (0.70 * exp(-max(below, 0.0) / 0.42));
    var dens: f32 = ((body * weight) * (0.30 + (1.05 * saturate(0.5 + (0.95 * n))))) * orb.mask;
    dens *= (1.0 + (1.25 * surge)) + (0.14 * st.lift);
    var edge: f32 = (below - 0.012) - (0.045 * n);
    var crest: f32 = (((exp(-(edge * edge) / (0.052 * 0.052)) * (foam + (0.55 * clamp(activity, 0.0, 1.0)))) * (0.30 + (0.70 * abs(vel)))) * orb.mask) * (1.0 + (2.6 * surge));
    var mist: f32 = (0.13 * exp(-max(-below, 0.0) / 0.20)) * orb.mask;
    var pal: MLPalette = ml_palette(inkColor, toneColor, hueShift, depth);
    var inkLin: vec3f = ml_srgb_to_linear(vec3f(inkColor.rgb));
    var lineT: f32 = exp(-(edge * edge) / (0.052 * 0.052)) * orb.mask;
    var key: f32 = ((smoothstep(0.45, 0.95, lineT) * (0.35 + (0.65 * foam))) * orb.z) * (1.0 + (1.5 * surge));
    var shell: f32 = orb.mask * (0.045 + (0.150 * pow(1.0 - orb.z, 3.0)));
    var t: f32 = ml_tier((0.045 + shell) + ((((0.62 * dens) + (0.18 * crest)) + mist) * orb.shade), key);
    var hot: f32 = ((smoothstep(0.60, 1.00, dens) * 0.40) + (crest * 0.70)) + (0.45 * key);
    return ml_write(pal, inkLin, t, hot, 0.88, glow, ml_bowl(uv), position * pixelScale);
}

fn ml_undertow(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32) -> vec4f {
    var uv: vec2f = ml_uv(position, size);
    var S: f32 = max(formScale, 0.10);
    var T: f32 = time * max(speed, 0.0);
    var contrast: f32 = clamp(c0, 0.0, 1.0);
    var slip: f32 = clamp(c1, 0.0, 1.0);
    var veil: f32 = clamp(c2, 0.0, 1.0);
    var bias: f32 = clamp(c3, 0.0, 1.0);
    var st: MLState = ml_state(stateIndex, stateTau);
    var orb: MLOrb = ml_orb(uv, 0.38);
    var sPhase: f32 = 0.085 * T;
    var iface: f32 = ((0.62 * (bias - 0.5)) + ((0.30 + (0.26 * clamp(activity, 0.0, 1.0))) * sin((orb.lam * 2.1) + sPhase))) + (0.08 * sin(T * 0.099));
    var across: f32 = orb.phi - iface;
    var mUp: f32 = 1.0 - smoothstep(-0.26, 0.26, across);
    var u: f32 = 0.030 + (0.095 * slip);
    var f: f32 = 2.7 / S;
    var tic: vec2f = ml_tic(T + 4.4, 29.0, 2.2);
    var kick: f32 = tic.x * 0.32;
    var lamA: f32 = ((orb.lam - ((u * T) * 2.6)) - kick) - ((2.0 * u) * st.push);
    var lamB: f32 = ((orb.lam + ((u * T) * 2.6)) + kick) + ((2.0 * u) * st.push);
    var nA: vec3f = vec3f(sin(lamA) * cos(orb.phi), sin(orb.phi), cos(lamA) * cos(orb.phi));
    var nB: vec3f = vec3f(sin(lamB) * cos(orb.phi), sin(orb.phi), cos(lamB) * cos(orb.phi));
    var na: f32 = ml_fbm3(((nA * f) * vec3f(0.62, 1.15, 0.62)) + vec3f(0.0, 0.0, 2.0 + (0.060 * T)), 2, 2.03, 0.5);
    var nb: f32 = ml_fbm3(((nB * f) * vec3f(0.66, 1.07, 0.66)) + vec3f(0.0, 0.0, 23.0 + (0.054 * T)), 2, 2.03, 0.5);
    var bodyA: f32 = 0.52 + (0.48 * smoothstep(0.24 + (0.09 * st.drive), 0.94 - (0.09 * st.drive), 0.5 + (0.95 * na)));
    var bodyB: f32 = 0.52 + (0.48 * smoothstep(0.24 + (0.09 * st.drive), 0.94 - (0.09 * st.drive), 0.5 + (0.95 * nb)));
    var base: f32 = ((mUp * bodyA) + (((1.0 - mUp) * bodyB) * 0.38)) * orb.mask;
    var crest: f32 = ml_crest(clamp((orb.lam * 0.64) + 0.5, 0.0, 1.0), st, 0.32);
    base *= (1.0 + (1.90 * crest)) + (0.22 * st.lift);
    var d: f32 = na - nb;
    var wid: f32 = (0.075 + (0.170 * (1.0 - contrast))) * (1.0 - (0.35 * clamp(activity, 0.0, 1.0)));
    var seam: f32 = (wid * wid) / ((wid * wid) + (d * d));
    var line: f32 = (((0.38 + (0.62 * seam)) * exp(-(across * across) / (0.17 * 0.17))) * orb.mask) * orb.z;
    var braid: f32 = (((((seam * 4.0) * mUp) * (1.0 - mUp)) * (0.30 + (0.55 * contrast))) * orb.mask) * orb.z;
    var pal: MLPalette = ml_palette(inkColor, toneColor, hueShift, depth);
    var inkLin: vec3f = ml_srgb_to_linear(vec3f(inkColor.rgb));
    var key: f32 = smoothstep(0.45, 0.95, line) * orb.z;
    var t: f32 = ml_tier(0.045 + ((((0.34 + (0.46 * veil)) * base) + (0.20 * braid)) * orb.shade), key);
    var hot: f32 = ((braid * 0.40) + (smoothstep(0.74, 1.00, base) * 0.16)) + (0.55 * key);
    return ml_write(pal, inkLin, t, hot, 0.80, glow, ml_bowl(uv), position * pixelScale);
}

fn ml_meander(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32) -> vec4f {
    var uv: vec2f = ml_uv(position, size);
    var S: f32 = max(formScale, 0.10);
    var T: f32 = time * max(speed, 0.0);
    var width: f32 = clamp(c0, 0.0, 1.0);
    var wander: f32 = clamp(c1, 0.0, 1.0);
    var bank: f32 = clamp(c2, 0.0, 1.0);
    var flow: f32 = clamp(c3, 0.0, 1.0);
    var st: MLState = ml_state(stateIndex, stateTau);
    var orb: MLOrb = ml_orb(uv, 0.38);
    var xa: f32 = orb.lam / S;
    var pth: f32 = 0.049 * T;
    const PF: f32 = 0.42;
    const DX: f32 = 0.150;
    var tic: vec2f = ml_tic(T + 2.2, 37.0, 3.0);
    var w0: f32 = ml_vnoise1((xa * PF) + pth, 7.0) + (0.24 * ml_vnoise1(((xa * PF) * 2.3) + (pth * 1.4), 23.0));
    var wA: f32 = ml_vnoise1(((xa - DX) * PF) + pth, 7.0) + (0.24 * ml_vnoise1((((xa - DX) * PF) * 2.3) + (pth * 1.4), 23.0));
    var wB: f32 = ml_vnoise1(((xa + DX) * PF) + pth, 7.0) + (0.24 * ml_vnoise1((((xa + DX) * PF) * 2.3) + (pth * 1.4), 23.0));
    var amp: f32 = (0.30 + (0.50 * wander)) * (1.0 + (0.38 * tic.x));
    var yc: f32 = amp * w0;
    var slope: f32 = ((amp * (wB - wA)) / (2.0 * DX)) / S;
    var dist: f32 = (orb.phi - yc) / sqrt(1.0 + (slope * slope));
    var wv: f32 = (((0.135 + (0.200 * width)) * S) * (1.0 - (0.16 * st.drive))) * (1.0 + (0.42 * clamp(level, 0.0, 1.0)));
    wv *= 0.80 + (0.36 * (0.5 + (0.5 * ml_vnoise1((xa * 0.55) + 3.3, 19.0))));
    var uu: f32 = dist / max(wv, 1e-4);
    var travel: f32 = ((0.50 + (1.30 * flow)) * T) + ((0.75 + (1.20 * flow)) * st.push);
    var qf: vec3f = vec3f((xa * 1.1) - travel, clamp(uu, -2.0, 2.0) * 0.42, 4.0 + (0.042 * T));
    var water: f32 = saturate(0.45 + (0.95 * ml_fbm3(qf, 3, 2.03, 0.5)));
    var surge: f32 = ml_crest(clamp((orb.lam * 0.64) + 0.5, 0.0, 1.0), st, 0.26);
    water = saturate((water * (1.0 + (2.4 * surge))) + (0.20 * st.lift));
    var k: f32 = uu / ((0.78 + (0.44 * water)) + (0.55 * surge));
    var g0: f32 = exp((-7.0 * k) * k) * orb.mask;
    var g1: f32 = exp((-1.55 * k) * k) * orb.mask;
    var g2: f32 = exp((-0.30 * k) * k) * orb.mask;
    var qm: vec3f = (orb.n * (2.4 / S)) + vec3f(0.0, 0.0, 30.0 + (0.063 * T));
    var ground: f32 = smoothstep(0.25, 0.95, 0.5 + (1.0 * ml_fbm3(qm, 2, 2.03, 0.5))) * orb.mask;
    var lip: f32 = abs(uu) - 1.90;
    var cut: f32 = 1.0 - ((0.78 * bank) * exp((-0.42 * lip) * lip));
    var pal: MLPalette = ml_palette(inkColor, toneColor, hueShift, depth);
    var inkLin: vec3f = ml_srgb_to_linear(vec3f(inkColor.rgb));
    var key: f32 = (g0 * smoothstep(0.30, 0.85, water)) * orb.z;
    var t: f32 = ml_tier(0.045 + (((((0.20 * ground) * cut) + (g1 * (0.14 + (0.42 * water)))) + (g2 * (0.05 + (0.07 * water)))) * orb.shade), key);
    var hot: f32 = ((g1 * (0.20 + (0.80 * water))) * 0.55) + (0.55 * key);
    return ml_write(pal, inkLin, t, hot, 0.88, glow, ml_bowl(uv), position * pixelScale);
}

fn ml_join_law(tau: f32, joinTime: f32) -> vec3f {
    const HOLD: f32 = 0.26;
    var E: f32 = max(joinTime, 0.50);
    var k: f32 = 3.0 / E;
    var e: f32 = exp(-k * max(tau, 0.0));
    var v: f32 = HOLD + ((1.0 - HOLD) * e);
    var D: f32 = (HOLD * max(tau, 0.0)) + (((1.0 - HOLD) * (1.0 - e)) / k);
    return vec3f(v, D, e);
}

fn ml_confluence(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32) -> vec4f {
    var uv: vec2f = ml_uv(position, size);
    var S: f32 = max(formScale, 0.10);
    var T: f32 = time * max(speed, 0.0);
    var approach: f32 = clamp(c0, 0.0, 1.0);
    var mingle: f32 = clamp(c1, 0.0, 1.0);
    var shimmer: f32 = clamp(c2, 0.0, 1.0);
    var angleK: f32 = clamp(c3, 0.0, 1.0);
    var st: MLState = ml_state(stateIndex, stateTau);
    var tau: f32 = max(time - epoch, 0.0);
    var law: vec3f = ml_join_law(tau, 3.6);
    var e: f32 = law.z;
    var travel: f32 = ((law.y * 1.53) * max(speed, 0.0)) + (1.20 * st.push);
    var orb: MLOrb = ml_orb(uv, 0.38);
    const OUT: f32 = 0.42;
    var o: vec2f = vec2f(cos(OUT), sin(OUT));
    var nrm: vec2f = vec2f(-o.y, o.x);
    var qv: vec2f = vec2f(orb.lam, orb.phi) - vec2f(-0.28, -0.18);
    var sAx: f32 = dot(qv, o);
    var nAx: f32 = dot(qv, nrm);
    var tic: vec2f = ml_tic(T + 5.3, 43.0, 2.5);
    var armB: f32 = step(0.5, tic.y);
    var spread: f32 = ((mix(0.34, 1.20, angleK) * (0.80 + (0.20 * e))) * (1.0 - (0.22 * st.drive))) * (1.0 - (0.30 * clamp(activity, 0.0, 1.0)));
    var sep: f32 = 0.045 + ((0.075 + (0.300 * approach)) * e);
    var sj: f32 = 0.55 * e;
    var conv: f32 = 1.0 - smoothstep(sj - 0.62, sj + 0.34, sAx);
    var su: f32 = max(sj - sAx, 0.0);
    var wig: f32 = 0.10 * S;
    var armN: f32 = (sep + (spread * su)) * conv;
    var cA: f32 = -armN + (wig * ml_fbm1(((sAx * 1.9) / S) - (travel * 0.55), 2, 13.0));
    var cB: f32 = armN + (wig * ml_fbm1(((sAx * 1.9) / S) - (travel * 0.55), 2, 47.0));
    var wBase: f32 = (0.105 * S) * (1.0 + (0.50 * (1.0 - conv)));
    var wvA: f32 = (wBase * (1.0 + ((0.72 * tic.x) * (1.0 - armB)))) * (0.90 + (0.44 * (0.5 + (0.5 * ml_vnoise1(((sAx * 1.1) / S) - (travel * 0.5), 63.0)))));
    var wvB: f32 = ((wBase * 1.18) * (1.0 + ((0.72 * tic.x) * armB))) * (0.90 + (0.44 * (0.5 + (0.5 * ml_vnoise1((((sAx * 1.1) / S) - (travel * 0.5)) + 5.7, 71.0)))));
    var ua: f32 = (nAx - cA) / max(wvA, 1e-4);
    var ub: f32 = (nAx - cB) / max(wvB, 1e-4);
    var qA: vec3f = vec3f(((sAx * 2.0) / S) - travel, clamp(ua, -2.0, 2.0) * 0.45, 3.0);
    var qB: vec3f = vec3f(((sAx * 2.0) / S) - travel, clamp(ub, -2.0, 2.0) * 0.45, 26.0);
    var wA: f32 = saturate(0.45 + (0.95 * ml_fbm3(qA, 3, 2.03, 0.5)));
    var wB: f32 = saturate(0.45 + (0.95 * ml_fbm3(qB, 3, 2.03, 0.5)));
    var ka: f32 = ua / (0.78 + (0.44 * wA));
    var kb: f32 = ub / (0.78 + (0.44 * wB));
    var gA1: f32 = exp((-1.45 * ka) * ka);
    var gA2: f32 = exp((-0.28 * ka) * ka);
    var gB1: f32 = exp((-1.45 * kb) * kb);
    var gB2: f32 = exp((-0.28 * kb) * kb);
    var lace: f32 = clamp(0.5 + (0.55 * ml_vnoise1(((sAx * 1.8) / S) - (travel * 0.8), 41.0)), 0.0, 1.0);
    var sA: f32 = mix(0.5, mix(0.5, lace, mingle), 1.0 - conv);
    var lightA: f32 = (gA1 * (0.14 + (0.46 * wA))) * (0.70 + (0.60 * sA));
    var lightB: f32 = (gB1 * (0.14 + (0.46 * wB))) * (0.70 + (0.60 * (1.0 - sA)));
    var chan: f32 = ((lightA + lightB) - (lightA * lightB)) * orb.mask;
    var surge: f32 = ml_crest(clamp((sAx * 0.62) + 0.42, 0.0, 1.0), st, 0.28);
    chan = saturate((chan * (1.0 + (2.3 * surge))) + ((0.16 * st.lift) * chan));
    var ds: f32 = sAx - sj;
    var mw: f32 = 0.20 * ((1.0 + (0.75 * tic.x)) + (0.55 * clamp(activity, 0.0, 1.0)));
    var meet: f32 = (exp(-(ds * ds) / (mw * mw)) * exp(-(nAx * nAx) / (0.18 * 0.18))) * orb.mask;
    var shN: f32 = ml_noise3(vec3f(((sAx * 3.0) / S) - (travel * 1.9), (nAx * 3.0) / S, 0.40 * travel));
    var churnUp: f32 = (((0.10 + (0.30 * shimmer)) + (0.26 * clamp(activity, 0.0, 1.0))) * meet) * (0.45 + (0.55 * (0.5 + (0.5 * shN))));
    var qh: vec3f = (orb.n * (2.2 / S)) + vec3f(0.0, 0.0, 40.0 + (0.049 * T));
    var haze: f32 = smoothstep(0.28, 0.96, 0.5 + (1.0 * ml_fbm3(qh, 2, 2.03, 0.5))) * orb.mask;
    var pal: MLPalette = ml_palette(inkColor, toneColor, hueShift, depth);
    var inkLin: vec3f = ml_srgb_to_linear(vec3f(inkColor.rgb));
    var key: f32 = (smoothstep(0.45, 0.95, chan) * (0.30 + (0.90 * meet))) * orb.z;
    var t: f32 = ml_tier(0.045 + (((((0.15 * haze) + (0.64 * chan)) + ((0.05 * (gA2 + gB2)) * orb.mask)) + churnUp) * orb.shade), key);
    var hot: f32 = (((chan * chan) * 0.75) + (churnUp * 0.70)) + (0.55 * key);
    return ml_write(pal, inkLin, t, hot, 0.88, glow, ml_bowl(uv), position * pixelScale);
}

fn ml_melt(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32) -> vec4f {
    var uv: vec2f = ml_uv(position, size);
    var S: f32 = max(formScale, 0.10);
    var T: f32 = time * max(speed, 0.0);
    var massK: f32 = clamp(c0, 0.0, 1.0);
    var visc: f32 = clamp(c1, 0.0, 1.0);
    var absorb: f32 = clamp(c2, 0.0, 1.0);
    var heat: f32 = clamp(c3, 0.0, 1.0);
    var st: MLState = ml_state(stateIndex, stateTau);
    var rate: f32 = mix(1.45, 0.62, visc);
    var tic: vec2f = ml_tic(T + 0.9, 53.0, 3.2);
    var heavyIdx: f32 = min(floor(tic.y * 3.0), 2.0);
    var wq: vec2f = uv * (2.4 / S);
    var wz: f32 = 70.0 + ((0.075 * rate) * T);
    var w1: f32 = ml_fbm3(vec3f(wq, wz), 2, 2.03, 0.5);
    var w2: f32 = ml_fbm3(vec3f(wq + vec2f(5.3, -2.1), wz + 17.0), 2, 2.03, 0.5);
    var p: vec2f = uv + ((vec2f(w1, w2) * ((0.030 + (0.050 * heat)) * (1.0 + (0.55 * tic.x)))) * S);
    var R: f32 = (0.245 + (0.055 * massK)) * S;
    var ring: f32 = 0.0;
    var lobes: f32 = 0.0;
    for (var i: i32 = 0; i < 3; i++) {
        var fi: f32 = f32(i);
        var cyc: f32 = ((rate * (T + (1.35 * st.push))) * (0.150 + (0.034 * fi))) + (fi * 0.37);
        var ph: f32 = fract(cyc);
        var g: f32 = select(1.0 - smoothstep(0.0, 1.0, (ph - 0.70) / 0.30), smoothstep(0.0, 1.0, ph / 0.70), ph < 0.70);
        ring += exp(-5.5 * ph) * sin(16.0 * ph);
        var lead: f32 = select(0.0, 1.0, fi < 0.5);
        var a: f32 = mix(((fi * 2.094) + ((0.09 * rate) * T)) + (2.4 * ml_vnoise1((floor(cyc) * 1.7) + (fi * 9.0), 5.0)), 1.5708 + (0.42 * ml_vnoise1(floor(cyc) * 1.3, 5.0)), lead);
        var dv: vec2f = vec2f(cos(a), sin(a));
        var heavy: f32 = select(0.0, tic.x, abs(fi - heavyIdx) < 0.5);
        var rr: f32 = R * (((0.20 + (0.15 * lead)) + (0.16 * heavy)) - ((0.12 * g) * (1.0 - (0.45 * visc))));
        var dp: vec2f = p - (dv * (((((0.260 + (0.180 * absorb)) * S) * g) * (0.34 + (0.66 * lead))) * (1.0 + (0.95 * heavy))));
        lobes += exp(-dot(dp, dp) / max(rr * rr, 1e-6));
    }
    var Rb: f32 = R * (1.0 + (((0.09 + (0.20 * absorb)) * ring) * (1.0 + (1.10 * tic.x))));
    var pb: vec2f = vec2f(p.x, p.y * 0.86);
    var body2: f32 = dot(pb, pb) / max(Rb * Rb, 1e-6);
    var field: f32 = exp(-body2) + lobes;
    var skin: f32 = smoothstep(0.38, 0.60, field);
    var deep: f32 = smoothstep(0.34, 1.02, field);
    var aura: f32 = exp(-body2 / 3.20);
    var mn: vec3f = normalize(vec3f(pb / max(Rb, 1e-4), sqrt(max(1.0 - min(body2, 1.0), 0.0)) + 0.25));
    var curve: f32 = mix(0.34, 1.0, pow(saturate(1.0 - min(body2, 1.0)), 0.30)) * (0.58 + (0.42 * saturate(dot(mn, normalize(vec3f(-0.34, -0.46, 0.82))))));
    var qi: vec3f = vec3f(p * (3.6 / S), 80.0 + ((0.16 * rate) * T));
    var vein: f32 = smoothstep(0.42, 0.93, 0.5 + (1.05 * ml_fbm3(qi, 3, 2.03, 0.5)));
    var cracks: f32 = ((skin * vein) * ((0.40 + (0.60 * heat)) + (0.50 * clamp(level, 0.0, 1.0)))) * (0.35 + (0.65 * deep));
    var surge: f32 = ml_crest(clamp(length(p) / (R * 2.3), 0.0, 1.0), st, 0.34);
    cracks *= 1.0 + (6.5 * surge);
    deep = saturate((deep * (1.0 + (1.7 * surge))) + (0.18 * st.lift));
    aura *= 1.0 + (2.6 * surge);
    var pal: MLPalette = ml_palette(inkColor, toneColor, hueShift, depth);
    var inkLin: vec3f = ml_srgb_to_linear(vec3f(inkColor.rgb));
    var key: f32 = smoothstep(0.26, 0.60, cracks) * smoothstep(0.30, 0.80, deep);
    var t: f32 = ((0.045 + (aura * (0.070 + (0.055 * heat)))) + ((skin * (0.115 + (0.225 * deep))) * curve)) + (cracks * 0.36);
    t = ml_tier(t, key);
    var hot: f32 = (cracks * 0.75) + (0.55 * key);
    return ml_write(pal, inkLin, t, hot, 0.84, glow, ml_bowl(uv), position * pixelScale);
}

fn ml_glaze(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32) -> vec4f {
    var uv: vec2f = ml_uv(position, size);
    var S: f32 = max(formScale, 0.10);
    var T: f32 = time * max(speed, 0.0);
    var sheetK: f32 = clamp(c0, 0.0, 1.0);
    var slide: f32 = clamp(c1, 0.0, 1.0);
    var sheenK: f32 = clamp(c2, 0.0, 1.0);
    var tilt: f32 = clamp(c3, 0.0, 1.0);
    var st: MLState = ml_state(stateIndex, stateTau);
    var tic: vec2f = ml_tic(T + 1.3, 61.0, 2.4);
    var orb: MLOrb = ml_orb(uv, 0.38);
    var th: f32 = mix(-1.00, -0.15, tilt) + (0.125 * tic.x);
    var dv: vec2f = vec2f(cos(th), sin(th));
    var ev: vec2f = vec2f(-dv.y, dv.x);
    var sc: vec2f = vec2f(orb.lam, orb.phi);
    var along: f32 = dot(sc, dv);
    var across: f32 = dot(sc, ev);
    var qf: vec3f = (orb.n * (2.1 / S)) + vec3f(0.0, 0.0, 60.0 + (0.020 * T));
    var relief: f32 = saturate(0.5 + (1.0 * ml_fbm3(qf, 2, 2.03, 0.5)));
    var dome: f32 = orb.mask;
    var turn: f32 = orb.shade;
    var travel: f32 = (((0.036 + (0.052 * slide)) * T) + (0.028 * tic.x)) + ((0.055 + (0.075 * slide)) * st.push);
    var qs: vec3f = vec3f((along - travel) * (1.6 / S), across * (0.85 / S), 40.0 + (0.022 * T));
    var wob: f32 = ml_fbm3(qs, 2, 2.03, 0.5);
    var surge: f32 = ml_crest(clamp((along * 1.15) + 0.5, 0.0, 1.0), st, 0.30);
    const RIB_P: f32 = 0.95;
    var phase: f32 = ((along + (0.085 * wob)) - travel) / RIB_P;
    var w: f32 = (phase - floor(phase)) - 0.5;
    var widthR: f32 = ((mix(0.155, 0.085, sheetK) * (1.0 - (0.10 * st.drive))) * (1.0 + (0.95 * surge))) * (1.0 + (0.55 * clamp(activity, 0.0, 1.0)));
    var rib: f32 = exp(-(w * w) / (widthR * widthR));
    var film: f32 = (rib * (0.80 + (0.34 * (1.0 - relief)))) * ((1.0 + (0.85 * surge)) + (0.20 * st.lift));
    var gl: f32 = ml_noise3(vec3f((along - (travel * 1.30)) * (4.0 / S), across * (1.9 / S), 55.0 + (0.045 * T)));
    var spec: f32 = film * smoothstep(0.38, 0.96, 0.5 + gl);
    var pal: MLPalette = ml_palette(inkColor, toneColor, hueShift, depth);
    var inkLin: vec3f = ml_srgb_to_linear(vec3f(inkColor.rgb));
    var onDome: f32 = dome * turn;
    var filmD: f32 = film * dome;
    var key: f32 = (smoothstep(0.52, 0.94, rib) * dome) * (0.55 + (0.60 * sheenK));
    var t: f32 = ml_tier((((0.045 + (onDome * (0.120 + (0.190 * smoothstep(0.18, 0.95, relief))))) + ((onDome * 0.050) * (1.0 - relief))) + ((filmD * (0.150 + (0.170 * sheenK))) * (1.0 + (0.45 * st.drive)))) + (((spec * dome) * (0.055 + (0.145 * sheenK))) * (1.0 + (0.70 * st.drive))), key);
    var hot: f32 = ((filmD * (0.22 + (0.30 * sheenK))) + ((spec * dome) * 0.45)) + (0.55 * key);
    return ml_write(pal, inkLin, t, hot, 0.86, glow, ml_bowl(uv), position * pixelScale);
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

@fragment fn fs_eddy(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = ml_eddy(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_well(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = ml_well(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_tide(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = ml_tide(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_undertow(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = ml_undertow(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_meander(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = ml_meander(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_confluence(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = ml_confluence(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_melt(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = ml_melt(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_glaze(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = ml_glaze(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity);
    return orb_clip(pos, c.rgb);
}
