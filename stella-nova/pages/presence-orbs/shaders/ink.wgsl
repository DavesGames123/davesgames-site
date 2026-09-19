// Orb shader pack. WGSL, WebGPU.
// Derived from the Metal shaders of the MIT-licensed "murmur" package
// (c) Kris Puckett; ported function-for-function. MIT notice retained.
const M_PI_F: f32 = 3.14159265358979;

fn mi_hash(v: vec3u) -> u32 {
    var h: u32 = ((v.x * 1597334673u) ^ (v.y * 3812015801u)) ^ (v.z * 2798796415u);
    h ^= h >> 15u;
    h *= 2246822519u;
    h ^= h >> 13u;
    h *= 3266489917u;
    h ^= h >> 16u;
    return h;
}

fn mi_grad3(c: vec3i) -> vec3f {
    var h: u32 = mi_hash(vec3u(c + 4096));
    var z: f32 = fma(f32(h & 0xFFFFu), 2.0 / 65535.0, -1.0);
    var a: f32 = f32((h >> 16u) & 0xFFFFu) * (6.28318530718 / 65536.0);
    var r: f32 = sqrt(max(0.0, 1.0 - (z * z)));
    return vec3f(r * cos(a), r * sin(a), z);
}

fn mi_noised3(p: vec3f) -> vec4f {
    var i: vec3f = floor(p);
    var f: vec3f = p - i;
    var u: vec3f = ((f * f) * f) * ((f * ((f * 6.0) - 15.0)) + 10.0);
    var du: vec3f = ((30.0 * f) * f) * ((f * (f - 2.0)) + 1.0);
    var c: vec3i = vec3i(i);
    var ga: vec3f = mi_grad3(c + vec3i(0, 0, 0));
    var gb: vec3f = mi_grad3(c + vec3i(1, 0, 0));
    var gc: vec3f = mi_grad3(c + vec3i(0, 1, 0));
    var gd: vec3f = mi_grad3(c + vec3i(1, 1, 0));
    var ge: vec3f = mi_grad3(c + vec3i(0, 0, 1));
    var gf: vec3f = mi_grad3(c + vec3i(1, 0, 1));
    var gg: vec3f = mi_grad3(c + vec3i(0, 1, 1));
    var gh: vec3f = mi_grad3(c + vec3i(1, 1, 1));
    var va: f32 = dot(ga, f - vec3f(0.0, 0.0, 0.0));
    var vb: f32 = dot(gb, f - vec3f(1.0, 0.0, 0.0));
    var vc: f32 = dot(gc, f - vec3f(0.0, 1.0, 0.0));
    var vd: f32 = dot(gd, f - vec3f(1.0, 1.0, 0.0));
    var ve: f32 = dot(ge, f - vec3f(0.0, 0.0, 1.0));
    var vf: f32 = dot(gf, f - vec3f(1.0, 0.0, 1.0));
    var vg: f32 = dot(gg, f - vec3f(0.0, 1.0, 1.0));
    var vh: f32 = dot(gh, f - vec3f(1.0, 1.0, 1.0));
    var k1: f32 = vb - va;
    var k2: f32 = vc - va;
    var k3: f32 = ve - va;
    var k4: f32 = ((va - vb) - vc) + vd;
    var k5: f32 = ((va - vc) - ve) + vg;
    var k6: f32 = ((va - vb) - ve) + vf;
    var k7: f32 = ((((((-va + vb) + vc) - vd) + ve) - vf) - vg) + vh;
    var value: f32 = ((((((va + (k1 * u.x)) + (k2 * u.y)) + (k3 * u.z)) + ((k4 * u.x) * u.y)) + ((k5 * u.y) * u.z)) + ((k6 * u.z) * u.x)) + (((k7 * u.x) * u.y) * u.z);
    var grad: vec3f = (((((((ga + (u.x * (gb - ga))) + (u.y * (gc - ga))) + (u.z * (ge - ga))) + ((u.x * u.y) * (((ga - gb) - gc) + gd))) + ((u.y * u.z) * (((ga - gc) - ge) + gg))) + ((u.z * u.x) * (((ga - gb) - ge) + gf))) + (((u.x * u.y) * u.z) * (((((((-ga + gb) + gc) - gd) + ge) - gf) - gg) + gh))) + (du * vec3f(((k1 + (k4 * u.y)) + (k6 * u.z)) + ((k7 * u.y) * u.z), ((k2 + (k5 * u.z)) + (k4 * u.x)) + ((k7 * u.z) * u.x), ((k3 + (k6 * u.x)) + (k5 * u.y)) + ((k7 * u.x) * u.y)));
    return vec4f(value, grad);
}

fn mi_noise3(p: vec3f) -> f32 {
    var i: vec3f = floor(p);
    var f: vec3f = p - i;
    var u: vec3f = ((f * f) * f) * ((f * ((f * 6.0) - 15.0)) + 10.0);
    var c: vec3i = vec3i(i);
    var va: f32 = dot(mi_grad3(c + vec3i(0, 0, 0)), f - vec3f(0.0, 0.0, 0.0));
    var vb: f32 = dot(mi_grad3(c + vec3i(1, 0, 0)), f - vec3f(1.0, 0.0, 0.0));
    var vc: f32 = dot(mi_grad3(c + vec3i(0, 1, 0)), f - vec3f(0.0, 1.0, 0.0));
    var vd: f32 = dot(mi_grad3(c + vec3i(1, 1, 0)), f - vec3f(1.0, 1.0, 0.0));
    var ve: f32 = dot(mi_grad3(c + vec3i(0, 0, 1)), f - vec3f(0.0, 0.0, 1.0));
    var vf: f32 = dot(mi_grad3(c + vec3i(1, 0, 1)), f - vec3f(1.0, 0.0, 1.0));
    var vg: f32 = dot(mi_grad3(c + vec3i(0, 1, 1)), f - vec3f(0.0, 1.0, 1.0));
    var vh: f32 = dot(mi_grad3(c + vec3i(1, 1, 1)), f - vec3f(1.0, 1.0, 1.0));
    return mix(mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y), mix(mix(ve, vf, u.x), mix(vg, vh, u.x), u.y), u.z);
}

const MI_ROT: mat3x3f = mat3x3f(vec3f(0.00, 0.80, 0.60), vec3f(-0.80, 0.36, -0.48), vec3f(-0.60, -0.48, 0.64));

fn mi_fbmd3(p: vec3f, octaves: i32, lacunarity: f32, gain: f32) -> vec4f {
    var rotT: mat3x3f = transpose(MI_ROT);
    var mt: mat3x3f = mat3x3f(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, 1.0));
    var q: vec3f = p;
    var amp: f32 = 0.5;
    var value: f32 = 0.0;
    var grad: vec3f = vec3f(0.0);
    for (var i: i32 = 0; i < octaves; i++) {
        var n: vec4f = mi_noised3(q);
        value += amp * n.x;
        grad += amp * (mt * n.yzw);
        amp *= gain;
        q = lacunarity * (MI_ROT * q);
        mt = lacunarity * (mt * rotT);
    }
    return vec4f(value, grad);
}

fn mi_fbm3(p: vec3f, octaves: i32, lacunarity: f32, gain: f32) -> f32 {
    var q: vec3f = p;
    var amp: f32 = 0.5;
    var value: f32 = 0.0;
    for (var i: i32 = 0; i < octaves; i++) {
        value += amp * mi_noise3(q);
        amp *= gain;
        q = lacunarity * (MI_ROT * q);
    }
    return value;
}

fn mi_srgb_to_linear(c: vec3f) -> vec3f {
    var c_p: vec3f = c;
    c_p = max(c_p, vec3f(0.0));
    return select(c_p * (1.0 / 12.92), pow((c_p + 0.055) * (1.0 / 1.055), vec3f(2.4)), c_p > vec3f(0.04045));
}

fn mi_linear_to_srgb(c: vec3f) -> vec3f {
    var c_p: vec3f = c;
    c_p = max(c_p, vec3f(0.0));
    return select(c_p * 12.92, (1.055 * pow(c_p, vec3f(1.0 / 2.4))) - 0.055, c_p > vec3f(0.0031308));
}

fn mi_linear_to_oklab(c: vec3f) -> vec3f {
    var l: f32 = ((0.4122214708 * c.r) + (0.5363325363 * c.g)) + (0.0514459929 * c.b);
    var m: f32 = ((0.2119034982 * c.r) + (0.6806995451 * c.g)) + (0.1073969566 * c.b);
    var s: f32 = ((0.0883024619 * c.r) + (0.2817188376 * c.g)) + (0.6299787005 * c.b);
    var l_: f32 = pow(max(l, 0.0), 1.0 / 3.0);
    var m_: f32 = pow(max(m, 0.0), 1.0 / 3.0);
    var s_: f32 = pow(max(s, 0.0), 1.0 / 3.0);
    return vec3f(((0.2104542553 * l_) + (0.7936177850 * m_)) - (0.0040720468 * s_), ((1.9779984951 * l_) - (2.4285922050 * m_)) + (0.4505937099 * s_), ((0.0259040371 * l_) + (0.7827717662 * m_)) - (0.8086757660 * s_));
}

fn mi_oklab_to_linear(lab: vec3f) -> vec3f {
    var l_: f32 = (lab.x + (0.3963377774 * lab.y)) + (0.2158037573 * lab.z);
    var m_: f32 = (lab.x - (0.1055613458 * lab.y)) - (0.0638541728 * lab.z);
    var s_: f32 = (lab.x - (0.0894841775 * lab.y)) - (1.2914855480 * lab.z);
    var l: f32 = (l_ * l_) * l_;
    var m: f32 = (m_ * m_) * m_;
    var s: f32 = (s_ * s_) * s_;
    return vec3f(((4.0767416621 * l) - (3.3077115913 * m)) + (0.2309699292 * s), ((-1.2684380046 * l) + (2.6097574011 * m)) - (0.3413193965 * s), ((-0.0041960863 * l) - (0.7034186147 * m)) + (1.7076147010 * s));
}

fn mi_lch(L: f32, C: f32, h: f32) -> vec3f {
    return vec3f(L, C * cos(h), C * sin(h));
}

struct MIPalette {
    s0: vec3f,
    s1: vec3f,
    s2: vec3f,
    s3: vec3f
}

fn mi_palette(inkColor: vec4f, toneColor: vec4f, hueShift: f32, depth: f32) -> MIPalette {
    var ink: vec3f = mi_linear_to_oklab(mi_srgb_to_linear(vec3f(inkColor.rgb)));
    var tone: vec3f = mi_linear_to_oklab(mi_srgb_to_linear(vec3f(toneColor.rgb)));
    var L: f32 = tone.x;
    var C: f32 = length(tone.yz);
    var h: f32 = atan2(tone.z, tone.y) + hueShift;
    var d: f32 = clamp(depth, 0.30, 2.00);
    var p: MIPalette;
    p.s0 = ink;
    p.s1 = mi_lch(mix(ink.x, L, 0.30 / d), C * (0.52 + (0.10 * d)), h - 0.35);
    p.s2 = mi_lch(L, C, h);
    p.s3 = mi_lch(min(L * (1.20 + (0.12 * d)), 0.93), C * 0.55, h + 0.10);
    return p;
}

fn mi_shade(p: MIPalette, t: f32) -> vec3f {
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
    return mi_oklab_to_linear(lab);
}

fn mi_out(linearRGB: vec3f, pixel: vec2f) -> vec4f {
    var c: vec3f = mi_linear_to_srgb(linearRGB);
    var n: f32 = fract(52.9829189 * fract(dot(pixel, vec2f(0.06711056, 0.00583715))));
    var tri: f32 = select(1.0 - sqrt(max(0.0, 2.0 - (2.0 * n))), sqrt(2.0 * n) - 1.0, n < 0.5);
    c += vec3f(tri * (1.0 / 255.0));
    return vec4f(vec3f(saturate(c)), 1.0);
}

fn mi_knee(x: f32, knee: f32) -> f32 {
    return select(knee + ((1.0 - knee) * (1.0 - exp(-(x - knee) / max(1.0 - knee, 1e-3)))), x, x < knee);
}

fn mi_hash1(cell: f32, lane: f32) -> f32 {
    return f32(mi_hash(vec3u(u32(i32(cell) + 32768), u32(i32(lane) + 32768), 0x9E3779B9u)) >> 8u) * (1.0 / 16777216.0);
}

fn mi_uv(position: vec2f, size: vec2f) -> vec2f {
    return (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
}

fn mi_shore(uv: vec2f) -> f32 {
    return 1.0 - smoothstep(0.40, 0.49, length(uv));
}

struct MIOrb {
    r: f32,
    z: f32,
    p: vec3f,
    m: f32,
    limb: f32
}

fn mi_orb(uv: vec2f, R: f32) -> MIOrb {
    var o: MIOrb;
    var q: vec2f = uv / max(R, 1e-4);
    var d2: f32 = dot(q, q);
    o.r = sqrt(d2);
    o.z = sqrt(max(1.0 - min(d2, 1.0), 0.0));
    o.p = normalize(vec3f(q, o.z + 1e-5));
    o.m = 1.0 - smoothstep(0.90, 1.04, o.r);
    o.limb = 0.30 + (0.70 * pow(o.z, 0.62));
    return o;
}

fn mi_spin(p: vec3f, a: f32) -> vec3f {
    var c: f32 = cos(a);
    var s: f32 = sin(a);
    return vec3f((p.x * c) + (p.z * s), p.y, (-p.x * s) + (p.z * c));
}

fn mi_orb_radius(S: f32) -> f32 {
    return 0.355 * S;
}

struct MIBeat {
    e: f32,
    k: f32,
    id: f32
}

fn mi_beat(t: f32, lane: f32, dur: f32, rise: f32) -> MIBeat {
    const P: f32 = 6.5;
    const B: f32 = 2.5;
    var slot: f32 = floor(t / P);
    var start: f32 = (slot * P) + (mi_hash1(slot, lane) * B);
    var k: f32 = (t - start) / max(dur, 1e-3);
    var g: MIBeat;
    g.id = mi_hash1(slot, lane + 101.0);
    g.k = clamp(k, 0.0, 1.0);
    var up: f32 = smoothstep(0.0, 1.0, clamp(k / max(rise, 1e-3), 0.0, 1.0));
    var dn: f32 = 1.0 - smoothstep(0.0, 1.0, clamp((k - rise) / max(1.0 - rise, 1e-3), 0.0, 1.0));
    g.e = up * dn;
    return g;
}


// Integrated live signals, supplied by the runtime (∫ over the shader's own
// clock). voiceT/paceT are ∫ of the mh_live/mq_live-shaped signals, vdT/pdT
// their products with the responding drive, levelT/activityT the raw signals.
struct LiveSig {
    voiceT: f32, paceT: f32, driveT: f32, vdT: f32, pdT: f32, levelT: f32, activityT: f32
}
struct MIState {
    success: f32,
    sTau: f32,
    drive: f32,
    lean: f32,
    level: f32,
    activity: f32
}

fn mi_state(stateIndex: f32, stateTau: f32, level: f32, activity: f32) -> MIState {
    var s: MIState;
    var tau: f32 = max(stateTau, 0.0);
    var idx: i32 = i32(stateIndex + 0.5);
    s.sTau = tau;
    s.success = select(0.0, 1.0, idx == 4);
    var resp: f32 = select(0.0, 1.0, idx == 3);
    s.drive = resp * smoothstep(0.0, 0.45, tau);
    s.lean = resp * (1.0 - exp(-tau / 0.50));
    s.level = clamp(level, 0.0, 1.0);
    s.activity = clamp(activity, 0.0, 1.0);
    return s;
}

fn mi_drink(st: MIState, q: f32) -> f32 {
    if (st.success < 0.5) {
        return 0.0;
    }
    var d: f32 = (st.sTau * (1.0 / 0.70)) - clamp(q, 0.0, 1.0);
    var crest: f32 = exp(-(d * d) / 0.075);
    var held: f32 = smoothstep(0.0, 0.35, d);
    return smoothstep(0.0, 0.09, st.sTau) * (crest + (0.42 * held));
}

fn mi_finish(field: vec3f, inkLin: vec3f, shore: f32, glow: f32, pixel: vec2f) -> vec4f {
    var lit: vec3f = inkLin + ((field - inkLin) * max(glow, 0.0));
    var rgb: vec3f = mix(inkLin, lit, clamp(shore, 0.0, 1.0));
    rgb = vec3f(mi_knee(rgb.r, 0.90), mi_knee(rgb.g, 0.90), mi_knee(rgb.b, 0.90));
    return mi_out(rgb, pixel);
}

fn mi_bloom(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, sig: LiveSig) -> vec4f {
    var uv: vec2f = mi_uv(position, size);
    var S: f32 = max(formScale, 0.10);
    var spread: f32 = clamp(c0, 0.0, 1.0);
    var tearK: f32 = clamp(c1, 0.0, 1.0);
    var tailK: f32 = clamp(c2, 0.0, 1.0);
    var asym: f32 = clamp(c3, 0.0, 1.0);
    var st: MIState = mi_state(stateIndex, stateTau, level, activity);
    var tau: f32 = max(time - epoch, 0.0) * max(speed, 0.0);
    var o: MIOrb = mi_orb(uv, mi_orb_radius(S));
    const T: f32 = 1.25;
    var k: f32 = exp(-tau / T);
    var Rinf: f32 = ((0.62 + (0.55 * spread)) + (0.30 * st.activity)) * (1.0 + (0.13 * st.lean));
    var R: f32 = Rinf * sqrt(max(1.0 - k, 0.0));
    let GRAIN: vec3f = vec3f(0.7071, -0.4243, 0.5657);
    var seed: vec3f = GRAIN * (0.16 + (0.26 * asym));
    var sp: vec3f = mi_spin(o.p, tau * 0.045);
    var fromSeed: vec3f = sp - seed;
    var dseed: f32 = length(fromSeed);
    var dirS: vec3f = select(vec3f(1.0, 0.0, 0.0), fromSeed / dseed, vec3<bool>(dseed > 1e-5));
    var along: f32 = dot(dirS, GRAIN);
    var aniso: f32 = 1.0 + (asym * (((0.24 * along) * along) + (0.11 * along)));
    var ring: f32 = 1.6 + (1.9 * tearK);
    var fringe: f32 = mi_fbm3((dirS * ring) + vec3f(0.0, 0.0, tau * 0.32), 2, 2.03, 0.5);
    var gb: MIBeat = mi_beat(tau, 3.0, 2.2, 0.30);
    var ga: f32 = gb.id * 6.2831853;
    var gd: vec3f = normalize(vec3f(cos(ga), sin(ga) * 0.7, 0.55));
    var lobe: f32 = pow(max(dot(dirS, gd), 0.0), 3.0);
    var Rf: f32 = ((R * aniso) * (1.0 + (((0.10 + (0.42 * tearK)) * (1.0 + (0.45 * st.drive))) * fringe))) * (1.0 + ((gb.e * 0.17) * lobe));
    var sd: f32 = Rf - dseed;
    var w: f32 = 0.045 + (0.075 * Rinf);
    var core: f32 = smoothstep(-w, w, sd);
    var lt: f32 = 0.030 + (0.100 * tailK);
    var wash: f32 = exp(-max(-sd, 0.0) / lt) * (1.0 - core);
    var wr: f32 = 0.048 + (0.070 * Rinf);
    var tide: f32 = exp(-(sd * sd) / (wr * wr));
    var mott: f32 = mi_fbm3((sp * (4.2 / (1.0 + (0.62 * R)))) + vec3f(0.0, 0.0, (tau * 0.070) + 12.0), 3, 2.03, 0.5);
    var dens: f32 = (core * (0.62 + (0.26 * mott))) + (0.45 * wash);
    var body: f32 = clamp(dens, 0.0, 1.2) * o.limb;
    var tv: f32 = (0.045 + (0.70 * body)) + (((0.54 + (0.14 * tearK)) * tide) * o.limb);
    tv += (mi_drink(st, saturate(dseed / max(Rf, 1e-4))) * body) * 0.26;
    tv *= o.m;
    var pal: MIPalette = mi_palette(inkColor, toneColor, hueShift, depth);
    var inkLin: vec3f = mi_srgb_to_linear(vec3f(inkColor.rgb));
    return mi_finish(mi_shade(pal, tv), inkLin, mi_shore(uv), glow, position * pixelScale);
}

fn mi_rake3(p: vec3f, axis: vec3f, across: vec3f, freq: f32, amp: f32, phase: f32) -> vec3f {
    return normalize(p + (across * (amp * sin((dot(p, axis) * freq) + phase))));
}

fn mi_marbling(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, sig: LiveSig) -> vec4f {
    var uv: vec2f = mi_uv(position, size);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var folds: f32 = clamp(c0, 0.0, 1.0);
    var comb: f32 = clamp(c1, 0.0, 1.0);
    var contrast: f32 = clamp(c2, 0.0, 1.0);
    var driftK: f32 = clamp(c3, 0.0, 1.0);
    var st: MIState = mi_state(stateIndex, stateTau, level, activity);
    var o: MIOrb = mi_orb(uv, mi_orb_radius(S));
    var sp: vec3f = mi_spin(o.p, (t * 0.075) + ((driftK * t) * 0.10));
    let LAY: vec3f = vec3f(0.2588, 0.9659, 0.0);
    let AX1: vec3f = vec3f(0.9563, 0.2924, 0.0);
    let AX2: vec3f = vec3f(0.0, 0.4067, 0.9135);
    sp = normalize(sp - (LAY * (st.lean * 0.075)));
    var A: f32 = (0.085 + (0.130 * comb)) + (0.070 * st.level);
    sp = mi_rake3(sp, AX1, LAY, 3.1, A * (1.0 + (0.55 * st.drive)), t * 0.57);
    sp = mi_rake3(sp, LAY, AX2, 5.3, A * 0.28, (-t * 0.41) + 1.7);
    var gm: MIBeat = mi_beat(t, 11.0, 2.4, 0.28);
    var gAng: f32 = gm.id * 3.1415927;
    var gAx: vec3f = normalize(vec3f(cos(gAng), sin(gAng), 0.45));
    var gAc: vec3f = normalize(cross(gAx, vec3f(0.0, 0.0, 1.0)));
    sp = mi_rake3(sp, gAx, gAc, 4.2, (0.090 + (0.070 * comb)) * gm.e, (t * 0.44) + (gm.id * 6.2831853));
    var sheet: f32 = mi_fbm3((sp * 1.55) + vec3f(0.0, 0.0, (t * 0.046) + 21.0), 3, 2.03, 0.5);
    var count: f32 = 0.90 + (1.50 * folds);
    var u: f32 = ((sheet * 2.1) + (dot(sp, LAY) * 1.35)) * count;
    var wpx: f32 = max(fwidth(u), 1e-5);
    var att: f32 = exp((-4.9348 * wpx) * wpx);
    var sc: f32 = 0.5 + ((0.5 * cos(6.2831853 * u)) * att);
    var body: f32 = pow(sc, 1.0 + (2.4 * contrast));
    var dc: f32 = abs(fract(u + 0.5) - 0.5);
    var halfW: f32 = max(0.145, 1.8 * wpx);
    var vein: f32 = exp(-(dc * dc) / (halfW * halfW)) * att;
    var mass: f32 = (0.20 + (0.80 * mix(saturate(0.5 + (0.85 * sheet)), body, att))) * o.limb;
    var tv: f32 = (0.055 + (0.62 * mass)) + (((0.32 + (0.14 * contrast)) * vein) * o.limb);
    tv += (mi_drink(st, saturate(0.5 + (dot(sp, LAY) * 0.7))) * (mass + (0.6 * vein))) * 0.26;
    tv *= o.m;
    var pal: MIPalette = mi_palette(inkColor, toneColor, hueShift, depth);
    var inkLin: vec3f = mi_srgb_to_linear(vec3f(inkColor.rgb));
    return mi_finish(mi_shade(pal, tv), inkLin, mi_shore(uv), glow, position * pixelScale);
}

fn mi_wick(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, sig: LiveSig) -> vec4f {
    var uv: vec2f = mi_uv(position, size);
    var st: MIState = mi_state(stateIndex, stateTau, level, activity);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var climb: f32 = clamp(c0, 0.0, 1.0);
    var fiber: f32 = clamp(c1, 0.0, 1.0);
    var pooling: f32 = clamp(c2, 0.0, 1.0);
    var dry: f32 = clamp(c3, 0.0, 1.0);
    var o: MIOrb = mi_orb(uv, mi_orb_radius(S));
    var sp: vec3f = o.p;
    var lat: f32 = -sp.y;
    var lon: vec3f = normalize(vec3f(sp.x, 0.0, sp.z + 1e-5));
    var h0: f32 = (-0.42 + (0.92 * climb)) + (0.55 * st.level);
    var rag: f32 = mi_fbm3(vec3f(lon.x, lon.z, (t * 0.175) + 4.0) * (2.6 + (1.4 * fiber)), 3, 2.03, 0.5);
    var front: f32 = h0 + ((0.10 + (0.20 * fiber)) * rag);
    var gw: MIBeat = mi_beat(t, 23.0, 2.0, 0.26);
    var gAng: f32 = gw.id * 6.2831853;
    var dxg: f32 = (dot(lon, vec3f(cos(gAng), 0.0, sin(gAng))) - 1.0) / 0.10;
    front += (gw.e * (0.34 + (0.20 * climb))) * exp(-dxg * dxg);
    front += st.lean * 0.17;
    var sd: f32 = front - lat;
    var wEdge: f32 = 0.060 - (0.036 * dry);
    var wet: f32 = smoothstep(-wEdge, wEdge, sd);
    var gp: vec3f = (vec3f(lon.x, lon.z, 0.0) * (7.0 + (3.0 * fiber))) + vec3f(0.0, 0.0, (lat + (t * 0.085)) * 2.2);
    var grain: f32 = mi_fbm3(gp, 2, 2.03, 0.55);
    var conc: f32 = mix(0.52, 1.0, saturate(sd / 0.85));
    var wr: f32 = 0.048 + (0.060 * (1.0 - dry));
    var tide: f32 = exp(-(sd * sd) / (wr * wr));
    var src: f32 = 1.0 - smoothstep(-0.95, -0.30, lat);
    var dens: f32 = ((wet * conc) * (0.80 + ((0.85 * fiber) * grain))) + ((pooling * 0.42) * src);
    var tv: f32 = ((0.045 + ((0.64 * clamp(dens, 0.0, 1.3)) * o.limb)) + (((0.70 + (0.20 * dry)) * tide) * o.limb)) + (((0.15 + (0.10 * (0.5 + (0.5 * grain)))) * (1.0 - wet)) * o.limb);
    tv += ((mi_drink(st, saturate((lat + 1.0) / max(front + 1.0, 1e-3))) * wet) * conc) * 0.26;
    tv *= o.m;
    var pal: MIPalette = mi_palette(inkColor, toneColor, hueShift, depth);
    var inkLin: vec3f = mi_srgb_to_linear(vec3f(inkColor.rgb));
    return mi_finish(mi_shade(pal, tv), inkLin, mi_shore(uv), glow, position * pixelScale);
}

fn mi_strata(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, sig: LiveSig) -> vec4f {
    var uv: vec2f = mi_uv(position, size);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var layers: f32 = clamp(c0, 0.0, 1.0);
    var settle: f32 = clamp(c1, 0.0, 1.0);
    var disturb: f32 = clamp(c2, 0.0, 1.0);
    var tiltK: f32 = clamp(c3, 0.0, 1.0);
    var st: MIState = mi_state(stateIndex, stateTau, level, activity);
    var tau: f32 = max(time - epoch, 0.0) * max(speed, 0.0);
    var T: f32 = 1.6 / (0.55 + (0.90 * settle));
    var k: f32 = exp(-tau / T);
    var clear: f32 = 1.0 - k;
    var o: MIOrb = mi_orb(uv, mi_orb_radius(S));
    var rock: f32 = 1.0 - (0.55 * st.drive);
    var ang: f32 = ((tiltK - 0.5) * 0.40) + (rock * ((0.035 * sin(t * 0.31)) + (0.022 * sin((t * 0.19) + 2.1))));
    var ca: f32 = cos(ang);
    var sa: f32 = sin(ang);
    var sp: vec3f = o.p;
    var lat: f32 = -((sp.y * ca) - (sp.x * sa));
    var across: f32 = (sp.x * ca) + (sp.y * sa);
    var rip: f32 = mi_fbm3((sp * 2.2) + vec3f(0.0, 0.0, (t * 0.128) + 31.0), 2, 2.03, 0.5);
    var y: f32 = lat + (((disturb + (0.45 * st.activity)) * 0.085) * rip);
    var mound: f32 = exp(-(across * across) / 0.55);
    var wob: f32 = mi_noise3(vec3f(sp.x, sp.z, (tau * 0.05) + 51.0) * 2.4);
    var gs: MIBeat = mi_beat(t, 37.0, 2.4, 0.34);
    var xg: f32 = ((gs.id * 2.0) - 1.0) * 0.55;
    var dxs: f32 = (across - xg) / 0.30;
    var lens: f32 = (gs.e * 0.10) * exp(-dxs * dxs);
    var surfY: f32 = (mix(0.92, (-0.06 + (0.26 * mound)) + (0.07 * wob), clear) + lens) - (0.07 * st.drive);
    var below: f32 = surfY - y;
    var ws: f32 = mix(0.55, 0.045, clear);
    var inBed: f32 = smoothstep(-ws, ws, below);
    var bandN: f32 = ((2.6 + (2.4 * layers)) / 0.90) * (1.0 + (0.22 * st.drive));
    var nz: f32 = mi_fbm3(vec3f(across * 1.6, y * 1.5, (tau * 0.045) + 3.0), 2, 2.03, 0.5);
    var bp: f32 = (below * bandN) + (0.42 * nz);
    var wpx: f32 = max(fwidth(bp), 1e-5);
    var att: f32 = exp((-4.9348 * wpx) * wpx);
    var band: f32 = 0.5 + ((0.5 * cos(6.2831853 * bp)) * att);
    band = mix(0.5, pow(band, 1.0 + (1.6 * layers)), clear);
    var comp: f32 = 1.0 + (0.45 * saturate(below / 0.80));
    var dens: f32 = ((inBed * (0.40 + (0.60 * band))) * comp) * (0.72 + (0.28 * (0.5 + (0.8 * nz))));
    var haze: f32 = ((1.0 - inBed) * (0.30 + (0.70 * k))) * saturate(0.5 + (0.9 * nz));
    var line: f32 = exp(-(below * below) / (0.060 * 0.060)) * clear;
    var tv: f32 = ((((0.045 + ((0.52 * clamp(dens, 0.0, 1.4)) * o.limb)) + (((0.17 + (0.16 * haze)) * (1.0 - inBed)) * o.limb)) + ((0.10 * haze) * o.limb)) + ((0.72 * line) * o.limb)) * o.m;
    tv += ((mi_drink(st, 1.0 - saturate(below / 0.90)) * clamp(dens, 0.0, 1.4)) * 0.26) * o.m;
    var pal: MIPalette = mi_palette(inkColor, toneColor, hueShift, depth);
    var inkLin: vec3f = mi_srgb_to_linear(vec3f(inkColor.rgb));
    return mi_finish(mi_shade(pal, tv), inkLin, mi_shore(uv), glow, position * pixelScale);
}

fn mi_halation(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, sig: LiveSig) -> vec4f {
    var uv: vec2f = mi_uv(position, size);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var st: MIState = mi_state(stateIndex, stateTau, level, activity);
    var massK: f32 = clamp(c0, 0.0, 1.0);
    var corona: f32 = clamp(c1, 0.0, 1.0);
    var morph: f32 = clamp(c2, 0.0, 1.0);
    var offset: f32 = clamp(c3, 0.0, 1.0);
    var o: MIOrb = mi_orb(uv, mi_orb_radius(S));
    var spin: f32 = t * (0.075 + (0.14 * morph));
    var sp: vec3f = mi_spin(o.p, spin);
    var gh: MIBeat = mi_beat(t, 53.0, 2.3, 0.32);
    var gha: f32 = gh.id * 6.2831853;
    var off: vec2f = (vec2f(cos(gha), sin(gha)) * (gh.e * 0.052)) + (vec2f(0.80, -0.60) * (st.lean * 0.045));
    var uvc: vec2f = uv - (off * 1.6);
    var rc: f32 = length(uvc) / max(mi_orb_radius(S), 1e-4);
    var dir2: vec2f = select(vec2f(1.0, 0.0), uvc / max(length(uvc), 1e-5), vec2<bool>(rc > 1e-4));
    var lobeN: f32 = mi_fbm3(vec3f(dir2 * (1.35 + (0.9 * massK)), (spin * 0.55) + 6.0), 2, 2.03, 0.42);
    var bodyR: f32 = (((0.74 + (0.16 * massK)) + (0.12 * st.level)) / (1.0 + (0.18 * st.drive))) * (1.0 + (0.34 * lobeN));
    var d: f32 = (bodyR - rc) * mi_orb_radius(S);
    var inside: f32 = smoothstep(-0.004, 0.010, d);
    var nOut: vec2f = dir2;
    var a: f32 = offset * 6.2831853;
    var facing: f32 = 0.5 + (0.5 * dot(nOut, vec2f(cos(a), sin(a))));
    var w: f32 = 0.022 + (0.100 * corona);
    var halo: f32 = exp(-max(-d, 0.0) / w) * (1.0 - inside);
    var wr: f32 = 0.020 + (0.024 * corona);
    var rim: f32 = exp(-(d * d) / (wr * wr));
    var grain: f32 = mi_fbm3((sp * 2.6) + vec3f(0.0, 0.0, t * 0.05), 2, 2.03, 0.5);
    var core: f32 = ((0.26 * exp(-max(d, 0.0) / 0.30)) * o.limb) * (0.70 + (0.42 * (0.5 + (0.5 * grain))));
    var tv: f32 = ((0.040 + (inside * core)) + (((0.16 + (0.62 * corona)) * halo) * (0.35 + (0.65 * facing)))) + (((0.36 + (0.24 * corona)) * rim) * (0.35 + (0.65 * facing)));
    tv += (mi_drink(st, saturate(-d / 0.20)) * ((halo + (0.6 * rim)) + ((1.2 * inside) * core))) * 0.26;
    var pal: MIPalette = mi_palette(inkColor, toneColor, hueShift, depth);
    var inkLin: vec3f = mi_srgb_to_linear(vec3f(inkColor.rgb));
    return mi_finish(mi_shade(pal, tv), inkLin, mi_shore(uv), glow, position * pixelScale);
}

fn mi_pool(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, sig: LiveSig) -> vec4f {
    var uv: vec2f = mi_uv(position, size);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var st: MIState = mi_state(stateIndex, stateTau, level, activity);
    var tension: f32 = clamp(c0, 0.0, 1.0);
    var tremor: f32 = clamp(c1, 0.0, 1.0);
    var sheenK: f32 = clamp(c2, 0.0, 1.0);
    var tiltK: f32 = clamp(c3, 0.0, 1.0);
    var o: MIOrb = mi_orb(uv, mi_orb_radius(S));
    var lean: f32 = (tiltK - 0.5) * 2.0;
    var low: vec3f = normalize(vec3f(0.6428, 0.7660, 0.35)) * lean;
    var sp: vec3f = mi_spin(o.p, t * 0.026);
    const SF: f32 = 2.4;
    var trem: f32 = tremor + (0.55 * st.level);
    var Sf: vec4f = mi_fbmd3((sp * SF) + vec3f(0.0, 0.0, (t * (0.062 + (0.130 * trem))) + 41.0), 3, 2.03, 0.5);
    var ripple: vec3f = Sf.yzw * (0.055 + (0.150 * trem));
    var gp: MIBeat = mi_beat(t, 71.0, 2.4, 0.22);
    var rga: f32 = gp.id * 6.2831853;
    var touch: vec3f = normalize(vec3f(cos(rga) * 0.8, sin(rga) * 0.8, 0.62));
    var rg: f32 = length(sp - touch);
    var xr: f32 = (rg - (gp.k * 1.35)) / 0.16;
    var tdir: vec3f = select(vec3f(1.0, 0.0, 0.0), (sp - touch) / rg, vec3<bool>(rg > 1e-5));
    ripple += tdir * ((((2.33 * xr) * exp(-xr * xr)) * gp.e) * 0.16);
    var nrm: vec3f = normalize(o.p + (ripple * (1.0 - (0.30 * st.drive))));
    let LIGHT: vec3f = normalize(vec3f(-0.34, -0.46, 0.82));
    var spec: f32 = pow(saturate(dot(nrm, LIGHT)), 6.0 + (14.0 * sheenK));
    var h: f32 = o.limb * (1.0 + (0.28 * dot(o.p, low)));
    var lambda: f32 = 0.055 + (0.045 * tension);
    var dcr: f32 = (o.r - (0.80 - (0.05 * st.drive))) / lambda;
    var crown: f32 = exp(-dcr * dcr);
    var crownLit: f32 = 0.30 + (0.70 * saturate(dot(nrm, LIGHT) + 0.30));
    var tv: f32 = (((0.045 + (0.26 * h)) + ((0.22 + (0.28 * sheenK)) * spec)) + ((((0.52 + (0.18 * tension)) * crown) * crownLit) * o.limb)) * o.m;
    tv += ((mi_drink(st, saturate(o.r)) * (h + (0.7 * crown))) * 0.26) * o.m;
    var pal: MIPalette = mi_palette(inkColor, toneColor, hueShift, depth);
    var inkLin: vec3f = mi_srgb_to_linear(vec3f(inkColor.rgb));
    return mi_finish(mi_shade(pal, tv), inkLin, mi_shore(uv), glow, position * pixelScale);
}

fn mi_feather(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, sig: LiveSig) -> vec4f {
    var uv: vec2f = mi_uv(position, size);
    var S: f32 = max(formScale, 0.10);
    var st: MIState = mi_state(stateIndex, stateTau, level, activity);
    var bleed: f32 = clamp(c0, 0.0, 1.0);
    var fiber: f32 = clamp(c1, 0.0, 1.0);
    var dirK: f32 = clamp(c2, 0.0, 1.0);
    var dryness: f32 = clamp(c3, 0.0, 1.0);
    var tau: f32 = max(time - epoch, 0.0) * max(speed, 0.0);
    var o: MIOrb = mi_orb(uv, mi_orb_radius(S));
    var ang: f32 = (dirK * 6.2831853) + 0.45;
    var touch: vec3f = normalize(vec3f(-cos(ang) * 0.42, -sin(ang) * 0.42, 0.90));
    var gDir: vec3f = normalize(vec3f(cos(ang), sin(ang), 0.0));
    var grain: vec3f = normalize(gDir - (touch * dot(gDir, touch)));
    var side: vec3f = normalize(cross(touch, grain));
    var sp: vec3f = mi_spin(o.p, tau * 0.030);
    var rel: vec3f = sp - touch;
    var alo: f32 = dot(rel, grain);
    var acr: f32 = dot(rel, side);
    const T: f32 = 1.45;
    var L0: f32 = 0.10;
    var Linf: f32 = ((0.58 + (0.44 * bleed)) + (0.26 * st.activity)) * (1.0 + (0.15 * st.lean));
    var L: f32 = Linf + ((L0 - Linf) * exp(-tau / T));
    var u: f32 = alo + 0.12;
    var uN: f32 = saturate(u / max(Linf, 1e-4));
    var gf: MIBeat = mi_beat(tau, 5.0, 2.2, 0.30);
    acr -= (((((gf.id * 2.0) - 1.0) * gf.e) * 0.34) * uN) * uN;
    var Wref: f32 = 0.42 + (0.26 * bleed);
    var gr: f32 = mi_fbm3((((side * (acr * (12.0 + (9.0 * fiber)))) + (grain * (alo * 4.0))) + vec3f(0.0, 0.0, 21.0 + (tau * 0.050))) + (sp * 1.6), 2, 2.03, 0.55);
    var fibre: f32 = saturate(0.5 + (0.95 * gr));
    var W: f32 = (Wref * (1.22 - (0.86 * uN))) * (0.72 + (0.56 * fibre));
    var x2: f32 = (acr * acr) / max(W * W, 1e-8);
    var across: f32 = exp(-x2 * x2);
    var lateralFall: f32 = exp(-(acr * acr) / max((2.6 * Wref) * Wref, 1e-8));
    var reach: f32 = (L * (0.82 + (0.30 * fibre))) * (0.40 + (0.60 * lateralFall));
    var w: f32 = 0.10 + (0.16 * Linf);
    var front: f32 = smoothstep(-w, w, reach - u);
    var back: f32 = smoothstep(-0.22, 0.22, (u + 0.18) + (0.10 * fibre));
    var sat: f32 = mix(1.0, 0.82, uN);
    var dTip: f32 = reach - u;
    var wt: f32 = 0.055 + (0.075 * (1.0 - dryness));
    var tip: f32 = exp(-(dTip * dTip) / max(wt * wt, 1e-8)) * back;
    var ws: f32 = 0.30 * Wref;
    var spine: f32 = ((exp(-(acr * acr) / max(ws * ws, 1e-8)) * front) * back) * (0.34 + (0.66 * (1.0 - (0.75 * uN))));
    var dens: f32 = (((front * back) * across) * sat) * (0.30 + (0.85 * fibre));
    var dry: f32 = (0.15 + (0.09 * (0.5 + (0.5 * gr)))) * (1.0 - saturate(dens * 1.6));
    var tv: f32 = ((((0.045 + ((0.70 * clamp(dens, 0.0, 1.3)) * o.limb)) + (dry * o.limb)) + (((0.46 + (0.10 * bleed)) * spine) * o.limb)) + ((((0.13 + (0.15 * dryness)) * tip) * across) * o.limb)) * o.m;
    tv += ((mi_drink(st, uN) * clamp(dens, 0.0, 1.3)) * 0.26) * o.m;
    var pal: MIPalette = mi_palette(inkColor, toneColor, hueShift, depth);
    var inkLin: vec3f = mi_srgb_to_linear(vec3f(inkColor.rgb));
    return mi_finish(mi_shade(pal, tv), inkLin, mi_shore(uv), glow, position * pixelScale);
}

fn mi_palimpsest(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, sig: LiveSig) -> vec4f {
    var uv: vec2f = mi_uv(position, size);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var st: MIState = mi_state(stateIndex, stateTau, level, activity);
    var layers: f32 = clamp(c0, 0.0, 1.0);
    var legibility: f32 = clamp(c1, 0.0, 1.0);
    var surfacing: f32 = clamp(c2, 0.0, 1.0);
    var age: f32 = clamp(c3, 0.0, 1.0);
    var o: MIOrb = mi_orb(uv, mi_orb_radius(S));
    var sp: vec3f = mi_spin(o.p, t * 0.030);
    var sweep: vec3f = vec3f(-0.140, 0.100, 0.0) * ((t + (1.5 * sig.driveT)) + (0.9 * sig.activityT));
    var env: f32 = mi_noise3(((sp * 2.0) + sweep) + vec3f(0.0, 0.0, (t * 0.030) + 19.0));
    var lift: f32 = 0.30 + (0.70 * smoothstep(-0.24, 0.30, env));
    var gl: MIBeat = mi_beat(t, 89.0, 2.4, 0.30);
    var ghost: f32 = gl.e * exp(-pow((-sp.y - (((gl.id * 2.0) - 1.0) * 0.60)) / 0.13, 2.0));
    lift = min(1.0, lift + (0.55 * ghost));
    var sep: f32 = 0.10 + (0.26 * layers);
    var gate: f32 = smoothstep(-sep, sep, env);
    var reach: f32 = (0.52 + (0.52 * surfacing)) * lift;
    var visA: f32 = reach * gate;
    var visB: f32 = (reach * (1.0 - gate)) * (0.80 + (0.20 * layers));
    var px: f32 = max(fwidth(sp.x), 1e-5);
    var fine: f32 = 1.0 - smoothstep(0.012, 0.030, px);
    var writing: f32 = 0.0;
    for (var i: i32 = 0; i < 2; i++) {
        var fi: f32 = f32(i);
        var ha: f32 = 0.22 + (fi * (0.55 + (0.90 * layers)));
        var ca: f32 = cos(ha);
        var sa2: f32 = sin(ha);
        var e: vec3f = vec3f((sp.x * ca) + (sp.y * sa2), (-sp.x * sa2) + (sp.y * ca), sp.z);
        var lineFreq: f32 = 2.6 + ((1.2 * fi) * (0.4 + (0.6 * layers)));
        var yl: f32 = (-e.y + (0.055 * sin((e.x * 2.3) + (fi * 2.1)))) * lineFreq;
        var wl: f32 = max(fwidth(yl), 1e-5);
        var attl: f32 = exp((-4.9348 * wl) * wl);
        var row: f32 = 0.5 + ((0.5 * cos(6.2831853 * yl)) * attl);
        row = pow(row, 2.4);
        var scq: f32 = 1.0 - (0.28 * fi);
        var spn: vec3f = (vec3f(e.x * 5.4, (-e.y - (0.024 * lift)) * 2.6, e.z * 5.4) * scq) + vec3f(0.0, 0.0, 11.0 + (fi * 13.0));
        var ridge: f32 = saturate(1.0 - (abs(mi_fbm3(spn, 2, 2.03, 0.5)) * (1.0 / 0.55)));
        var aged: f32 = age * fi;
        var sharp: f32 = (((1.8 + (4.6 * legibility)) + (3.2 * aged)) + ((1.8 * ghost) * fi)) + (0.9 * st.drive);
        sharp = mix(1.5, sharp, fine);
        var stroke: f32 = pow(ridge, sharp) * row;
        writing += stroke * (select(visB, visA, i == 0));
    }
    var tooth: f32 = mi_noise3((sp * 13.0) + vec3f(0.0, 0.0, 3.0));
    var tv: f32 = ((0.048 + ((2.05 * clamp(writing, 0.0, 1.2)) * o.limb)) + ((0.045 * (0.5 + (0.5 * tooth))) * o.limb)) * o.m;
    tv += ((mi_drink(st, saturate(0.5 - (sp.y * 0.8))) * clamp(writing, 0.0, 1.2)) * 0.30) * o.m;
    var pal: MIPalette = mi_palette(inkColor, toneColor, hueShift, depth);
    var inkLin: vec3f = mi_srgb_to_linear(vec3f(inkColor.rgb));
    return mi_finish(mi_shade(pal, tv), inkLin, mi_shore(uv), glow, position * pixelScale);
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

@fragment fn fs_bloom(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mi_bloom(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_marbling(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mi_marbling(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_wick(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mi_wick(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_strata(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mi_strata(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_halation(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mi_halation(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_pool(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mi_pool(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_feather(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mi_feather(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_palimpsest(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mi_palimpsest(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, sig);
    return orb_clip(pos, c.rgb);
}
