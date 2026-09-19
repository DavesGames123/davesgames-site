// Orb shader pack. WGSL, WebGPU.
// Derived from the Metal shaders of the MIT-licensed "murmur" package
// (c) Kris Puckett; ported function-for-function. MIT notice retained.
const M_PI_F: f32 = 3.14159265358979;

fn mg_hash(v: vec3u) -> u32 {
    var h: u32 = ((v.x * 1597334673u) ^ (v.y * 3812015801u)) ^ (v.z * 2798796415u);
    h ^= h >> 15u;
    h *= 2246822519u;
    h ^= h >> 13u;
    h *= 3266489917u;
    h ^= h >> 16u;
    return h;
}

fn mg_grad3(c: vec3i) -> vec3f {
    var h: u32 = mg_hash(vec3u(c + 4096));
    var z: f32 = fma(f32(h & 0xFFFFu), 2.0 / 65535.0, -1.0);
    var a: f32 = f32((h >> 16u) & 0xFFFFu) * (6.28318530718 / 65536.0);
    var r: f32 = sqrt(max(0.0, 1.0 - (z * z)));
    return vec3f(r * cos(a), r * sin(a), z);
}

fn mg_noised3(p: vec3f) -> vec4f {
    var i: vec3f = floor(p);
    var f: vec3f = p - i;
    var u: vec3f = ((f * f) * f) * ((f * ((f * 6.0) - 15.0)) + 10.0);
    var du: vec3f = ((30.0 * f) * f) * ((f * (f - 2.0)) + 1.0);
    var c: vec3i = vec3i(i);
    var ga: vec3f = mg_grad3(c + vec3i(0, 0, 0));
    var gb: vec3f = mg_grad3(c + vec3i(1, 0, 0));
    var gc: vec3f = mg_grad3(c + vec3i(0, 1, 0));
    var gd: vec3f = mg_grad3(c + vec3i(1, 1, 0));
    var ge: vec3f = mg_grad3(c + vec3i(0, 0, 1));
    var gf: vec3f = mg_grad3(c + vec3i(1, 0, 1));
    var gg: vec3f = mg_grad3(c + vec3i(0, 1, 1));
    var gh: vec3f = mg_grad3(c + vec3i(1, 1, 1));
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

fn mg_noise3(p: vec3f) -> f32 {
    var i: vec3f = floor(p);
    var f: vec3f = p - i;
    var u: vec3f = ((f * f) * f) * ((f * ((f * 6.0) - 15.0)) + 10.0);
    var c: vec3i = vec3i(i);
    var va: f32 = dot(mg_grad3(c + vec3i(0, 0, 0)), f - vec3f(0.0, 0.0, 0.0));
    var vb: f32 = dot(mg_grad3(c + vec3i(1, 0, 0)), f - vec3f(1.0, 0.0, 0.0));
    var vc: f32 = dot(mg_grad3(c + vec3i(0, 1, 0)), f - vec3f(0.0, 1.0, 0.0));
    var vd: f32 = dot(mg_grad3(c + vec3i(1, 1, 0)), f - vec3f(1.0, 1.0, 0.0));
    var ve: f32 = dot(mg_grad3(c + vec3i(0, 0, 1)), f - vec3f(0.0, 0.0, 1.0));
    var vf: f32 = dot(mg_grad3(c + vec3i(1, 0, 1)), f - vec3f(1.0, 0.0, 1.0));
    var vg: f32 = dot(mg_grad3(c + vec3i(0, 1, 1)), f - vec3f(0.0, 1.0, 1.0));
    var vh: f32 = dot(mg_grad3(c + vec3i(1, 1, 1)), f - vec3f(1.0, 1.0, 1.0));
    return mix(mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y), mix(mix(ve, vf, u.x), mix(vg, vh, u.x), u.y), u.z);
}

const MG_ROT: mat3x3f = mat3x3f(vec3f(0.00, 0.80, 0.60), vec3f(-0.80, 0.36, -0.48), vec3f(-0.60, -0.48, 0.64));

fn mg_fbmd3(p: vec3f, octaves: i32, lacunarity: f32, gain: f32) -> vec4f {
    var rotT: mat3x3f = transpose(MG_ROT);
    var mt: mat3x3f = mat3x3f(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, 1.0));
    var q: vec3f = p;
    var amp: f32 = 0.5;
    var value: f32 = 0.0;
    var grad: vec3f = vec3f(0.0);
    for (var i: i32 = 0; i < octaves; i++) {
        var n: vec4f = mg_noised3(q);
        value += amp * n.x;
        grad += amp * (mt * n.yzw);
        amp *= gain;
        q = lacunarity * (MG_ROT * q);
        mt = lacunarity * (mt * rotT);
    }
    return vec4f(value, grad);
}

fn mg_fbm3(p: vec3f, octaves: i32, lacunarity: f32, gain: f32) -> f32 {
    var q: vec3f = p;
    var amp: f32 = 0.5;
    var value: f32 = 0.0;
    for (var i: i32 = 0; i < octaves; i++) {
        value += amp * mg_noise3(q);
        amp *= gain;
        q = lacunarity * (MG_ROT * q);
    }
    return value;
}

fn mg_srgb_to_linear(c: vec3f) -> vec3f {
    var c_p: vec3f = c;
    c_p = max(c_p, vec3f(0.0));
    return select(c_p * (1.0 / 12.92), pow((c_p + 0.055) * (1.0 / 1.055), vec3f(2.4)), c_p > vec3f(0.04045));
}

fn mg_linear_to_srgb(c: vec3f) -> vec3f {
    var c_p: vec3f = c;
    c_p = max(c_p, vec3f(0.0));
    return select(c_p * 12.92, (1.055 * pow(c_p, vec3f(1.0 / 2.4))) - 0.055, c_p > vec3f(0.0031308));
}

fn mg_linear_to_oklab(c: vec3f) -> vec3f {
    var l: f32 = ((0.4122214708 * c.r) + (0.5363325363 * c.g)) + (0.0514459929 * c.b);
    var m: f32 = ((0.2119034982 * c.r) + (0.6806995451 * c.g)) + (0.1073969566 * c.b);
    var s: f32 = ((0.0883024619 * c.r) + (0.2817188376 * c.g)) + (0.6299787005 * c.b);
    var l_: f32 = pow(max(l, 0.0), 1.0 / 3.0);
    var m_: f32 = pow(max(m, 0.0), 1.0 / 3.0);
    var s_: f32 = pow(max(s, 0.0), 1.0 / 3.0);
    return vec3f(((0.2104542553 * l_) + (0.7936177850 * m_)) - (0.0040720468 * s_), ((1.9779984951 * l_) - (2.4285922050 * m_)) + (0.4505937099 * s_), ((0.0259040371 * l_) + (0.7827717662 * m_)) - (0.8086757660 * s_));
}

fn mg_oklab_to_linear(lab: vec3f) -> vec3f {
    var l_: f32 = (lab.x + (0.3963377774 * lab.y)) + (0.2158037573 * lab.z);
    var m_: f32 = (lab.x - (0.1055613458 * lab.y)) - (0.0638541728 * lab.z);
    var s_: f32 = (lab.x - (0.0894841775 * lab.y)) - (1.2914855480 * lab.z);
    var l: f32 = (l_ * l_) * l_;
    var m: f32 = (m_ * m_) * m_;
    var s: f32 = (s_ * s_) * s_;
    return vec3f(((4.0767416621 * l) - (3.3077115913 * m)) + (0.2309699292 * s), ((-1.2684380046 * l) + (2.6097574011 * m)) - (0.3413193965 * s), ((-0.0041960863 * l) - (0.7034186147 * m)) + (1.7076147010 * s));
}

fn mg_lch(L: f32, C: f32, h: f32) -> vec3f {
    return vec3f(L, C * cos(h), C * sin(h));
}

struct MGPalette {
    s0: vec3f,
    s1: vec3f,
    s2: vec3f,
    s3: vec3f
}

fn mg_palette(inkColor: vec4f, toneColor: vec4f, hueShift: f32, depth: f32) -> MGPalette {
    var ink: vec3f = mg_linear_to_oklab(mg_srgb_to_linear(vec3f(inkColor.rgb)));
    var tone: vec3f = mg_linear_to_oklab(mg_srgb_to_linear(vec3f(toneColor.rgb)));
    var L: f32 = tone.x;
    var C: f32 = length(tone.yz);
    var h: f32 = atan2(tone.z, tone.y) + hueShift;
    var d: f32 = clamp(depth, 0.30, 2.00);
    var p: MGPalette;
    p.s0 = ink;
    p.s1 = mg_lch(mix(ink.x, L, 0.30 / d), C * (0.52 + (0.10 * d)), h - 0.35);
    p.s2 = mg_lch(L, C, h);
    p.s3 = mg_lch(min(L * (1.20 + (0.12 * d)), 0.93), C * 0.55, h + 0.10);
    return p;
}

fn mg_shade(p: MGPalette, t: f32) -> vec3f {
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
    return mg_oklab_to_linear(lab);
}

fn mg_out(linearRGB: vec3f, pixel: vec2f) -> vec4f {
    var c: vec3f = mg_linear_to_srgb(linearRGB);
    var n: f32 = fract(52.9829189 * fract(dot(pixel, vec2f(0.06711056, 0.00583715))));
    var tri: f32 = select(1.0 - sqrt(max(0.0, 2.0 - (2.0 * n))), sqrt(2.0 * n) - 1.0, n < 0.5);
    c += vec3f(tri * (1.0 / 255.0));
    return vec4f(vec3f(saturate(c)), 1.0);
}

fn mg_knee(x: f32, knee: f32) -> f32 {
    return select(knee + ((1.0 - knee) * (1.0 - exp(-(x - knee) / max(1.0 - knee, 1e-3)))), x, x < knee);
}

fn mg_hash1(cell: f32, lane: f32) -> f32 {
    return f32(mg_hash(vec3u(u32(i32(cell) + 32768), u32(i32(lane) + 32768), 0x9E3779B9u)) >> 8u) * (1.0 / 16777216.0);
}

fn mg_vnoise1(x: f32, lane: f32) -> f32 {
    var i: f32 = floor(x);
    var f: f32 = x - i;
    var u: f32 = ((f * f) * f) * ((f * ((f * 6.0) - 15.0)) + 10.0);
    return (mix(mg_hash1(i, lane), mg_hash1(i + 1.0, lane), u) * 2.0) - 1.0;
}

fn mg_fbm1(x: f32, octaves: i32, lane: f32) -> f32 {
    var v: f32 = 0.0;
    var amp: f32 = 0.5;
    var f: f32 = 1.0;
    for (var i: i32 = 0; i < octaves; i++) {
        v += amp * mg_vnoise1(x * f, lane + (f32(i) * 37.0));
        amp *= 0.5;
        f *= 2.03;
    }
    return v;
}

fn mg_hold(uv: vec2f, reach: f32) -> f32 {
    var r: f32 = length(uv) * 2.0;
    var a: f32 = clamp(reach, 0.30, 0.64);
    return 1.0 - smoothstep(a, a + 0.30, r);
}

struct MGOrb {
    r: f32,
    mask: f32,
    n: vec3f,
    thru: f32,
    wrap: vec2f
}

fn mg_orb(uv: vec2f, radius: f32) -> MGOrb {
    var o: MGOrb;
    var R: f32 = max(radius, 1e-4);
    var q: vec2f = uv / R;
    o.r = length(q);
    o.mask = 1.0 - smoothstep(0.94, 1.03, o.r);
    var qc: vec2f = select(q, q / o.r, vec2<bool>(o.r > 1.0));
    o.thru = sqrt(max(1.0 - dot(qc, qc), 0.0));
    o.n = vec3f(qc, o.thru);
    var dir: vec2f = select(vec2f(1.0, 0.0), q / o.r, vec2<bool>(o.r > 1e-5));
    o.wrap = dir * asin(clamp(o.r, 0.0, 1.0));
    return o;
}

fn mg_round(o: MGOrb, floorLift: f32) -> f32 {
    return (floorLift + ((1.0 - floorLift) * pow(clamp(o.thru, 0.0, 1.0), 0.70))) * o.mask;
}

const MG_ORB_R: f32 = 0.335;

fn mg_tier(v: f32) -> f32 {
    var v_p: f32 = v;
    v_p = clamp(v_p, 0.0, 1.0);
    if (v_p < 0.16) {
        return 0.34 * smoothstep(0.0, 0.16, v_p);
    }
    if (v_p < 0.60) {
        return 0.34 + (0.38 * smoothstep(0.0, 1.0, (v_p - 0.16) * (1.0 / 0.44)));
    }
    return 0.72 + (0.28 * smoothstep(0.0, 1.0, (v_p - 0.60) * (1.0 / 0.40)));
}

const MG_PEAK: f32 = 0.98;

struct MGState {
    drive: f32,
    settle: f32,
    tau: f32,
    flaring: f32
}

fn mg_state(stateIndex: f32, stateTau: f32) -> MGState {
    var s: MGState;
    s.tau = max(stateTau, 0.0);
    var responding: bool = (stateIndex > 2.5) && (stateIndex < 3.5);
    var success: bool = (stateIndex > 3.5) && (stateIndex < 4.5);
    s.drive = select(0.0, smoothstep(0.0, 0.40, s.tau), responding);
    s.settle = select(0.0, smoothstep(0.55, 1.60, s.tau), success);
    s.flaring = select(0.0, 1.0, success);
    return s;
}

fn mg_driveDist(s: MGState) -> f32 {
    if (s.drive <= 0.0) {
        return 0.0;
    }
    const T: f32 = 0.40;
    if (s.tau < T) {
        var k: f32 = s.tau / T;
        return T * (((k * k) * k) - ((((0.5 * k) * k) * k) * k));
    }
    return (T * 0.5) + (s.tau - T);
}

fn mg_flare(s: MGState, d: f32) -> f32 {
    if (s.flaring < 0.5) {
        return 0.0;
    }
    const C: f32 = 1.15;
    const W: f32 = 0.55;
    var u: f32 = (s.tau - (max(d, 0.0) / C)) / W;
    if ((u <= 0.0) || (u >= 1.0)) {
        return 0.0;
    }
    return smoothstep(0.0, 0.30, u) * (1.0 - smoothstep(0.30, 1.0, u));
}

struct MGBeat {
    env: f32,
    phase: f32,
    seed: f32
}

fn mg_beat(t: f32, lane: f32, period: f32, dur: f32) -> MGBeat {
    var L: f32 = clamp(period, 5.60, 7.40);
    var J: f32 = min(L - 4.05, 8.95 - L);
    var D: f32 = clamp(dur, 0.60, (L - J) - 0.15);
    var b: MGBeat;
    b.env = 0.0;
    b.phase = 0.0;
    b.seed = 0.0;
    var slot: f32 = floor(t / L);
    for (var i: i32 = -1; i <= 0; i++) {
        var k: f32 = slot + f32(i);
        var u: f32 = (t - ((k * L) + (mg_hash1(k, lane) * J))) / D;
        if ((u > 0.0) && (u < 1.0)) {
            b.phase = u;
            b.seed = mg_hash1(k, lane + 313.0);
            b.env = smoothstep(0.0, 0.34, u) * (1.0 - smoothstep(0.34, 1.0, u));
        }
    }
    return b;
}

fn mg_caustic(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32) -> vec4f {
    var res: vec2f = max(size, vec2f(1.0));
    var uv: vec2f = (position - (0.5 * res)) / min(res.x, res.y);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var web: f32 = clamp(c0, 0.0, 1.0);
    var deepK: f32 = clamp(c1, 0.0, 1.0);
    var swim: f32 = clamp(c2, 0.0, 1.0);
    var focus: f32 = clamp(c3, 0.0, 1.0);
    var orb: MGOrb = mg_orb(uv, MG_ORB_R * S);
    var sw: vec2f = orb.wrap;
    var f: f32 = (3.2 + (3.2 * web)) / S;
    var st: MGState = mg_state(stateIndex, stateTau);
    var drift: vec2f = (vec2f(0.150, 0.054) * t) * (0.30 + (1.55 * swim));
    var churn: f32 = t * (0.175 - (0.062 * swim));
    drift += vec2f(0.255, 0.062) * mg_driveDist(st);
    var g: MGBeat = mg_beat(t, 5.0, 6.7, 2.6);
    var ga: f32 = g.seed * 6.2831853;
    var g2: f32 = fract(g.seed * 7.31);
    var gp: vec2f = (vec2f(cos(ga), sin(ga)) * (0.09 + (0.16 * g2))) * S;
    var gsig: f32 = 0.20 * S;
    var gd: vec2f = sw - gp;
    var swell: f32 = g.env * exp(-dot(gd, gd) / (gsig * gsig));
    var uvw: vec2f = sw - (gd * (0.20 * swell));
    var p: vec3f = vec3f((uvw + drift) * f, churn);
    const e: f32 = 0.10;
    var s0: vec4f = mg_fbmd3(p, 2, 2.03, 0.5);
    var sx: vec4f = mg_fbmd3(p + vec3f(e, 0.0, 0.0), 2, 2.03, 0.5);
    var sy: vec4f = mg_fbmd3(p + vec3f(0.0, e, 0.0), 2, 2.03, 0.5);
    var inv: f32 = 1.0 / e;
    var hxx: f32 = (sx.y - s0.y) * inv;
    var hxy: f32 = (sx.z - s0.z) * inv;
    var hyy: f32 = (sy.z - s0.z) * inv;
    var flare: f32 = mg_flare(st, length(uv));
    var k: f32 = (((0.06 + (0.20 * deepK)) * (1.0 + (0.90 * swell))) * (1.0 + (1.25 * flare))) * (1.0 + (0.45 * clamp(activity, 0.0, 1.0)));
    var det: f32 = ((1.0 - (k * hxx)) * (1.0 - (k * hyy))) - (((k * k) * hxy) * hxy);
    var w: f32 = 0.42 - (0.30 * focus);
    var fold: f32 = w / (w + abs(det));
    fold = pow(fold, 1.0 + (0.9 * focus));
    var pool: f32 = mg_round(orb, 0.10) * (1.0 + (0.10 * s0.x));
    var floorLit: f32 = 0.42 + (0.10 * (0.5 + (0.5 * s0.x)));
    var v: f32 = pool * (floorLit + ((0.60 + (0.10 * deepK)) * pow(fold, 1.15)));
    v += (pool * ((0.40 * flare) + (0.13 * st.settle))) * (0.30 + (0.70 * fold));
    var pal: MGPalette = mg_palette(inkColor, toneColor, hueShift, depth);
    var inkLin: vec3f = mg_srgb_to_linear(vec3f(inkColor.rgb));
    var body: vec3f = mg_shade(pal, mg_tier(v));
    var em: vec3f = (mg_shade(pal, MG_PEAK) * (((0.30 * pool) * pow(fold, 3.0)) * (1.0 + (1.8 * flare)))) * max(glow, 0.0);
    var rgb: vec3f = mix(inkLin, body + em, mg_hold(uv, 0.64));
    rgb = vec3f(mg_knee(rgb.r, 0.88), mg_knee(rgb.g, 0.88), mg_knee(rgb.b, 0.88));
    return mg_out(rgb, position * pixelScale);
}

fn mg_aurora(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32) -> vec4f {
    var res: vec2f = max(size, vec2f(1.0));
    var uv: vec2f = (position - (0.5 * res)) / min(res.x, res.y);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var foldK: f32 = clamp(c0, 0.0, 1.0);
    var heightK: f32 = clamp(c1, 0.0, 1.0);
    var wander: f32 = clamp(c2, 0.0, 1.0);
    var thin: f32 = clamp(c3, 0.0, 1.0);
    var st: MGState = mg_state(stateIndex, stateTau);
    var orb: MGOrb = mg_orb(uv, MG_ORB_R * S);
    let pole: vec3f = vec3f(0.16, -0.80, 0.58);
    var lat: f32 = asin(clamp(dot(orb.n, pole), -1.0, 1.0));
    var e1: vec3f = normalize(cross(pole, vec3f(0.0, 0.0, 1.0)));
    var e2: vec3f = cross(pole, e1);
    var lon: f32 = atan2(dot(orb.n, e2), dot(orb.n, e1));
    var x: f32 = (lon * 0.42) - (0.32 * mg_driveDist(st));
    var up: f32 = lat;
    var arch: f32 = 0.93;
    var halfT: f32 = 0.052 + (0.062 * heightK);
    var lowEdge: f32 = 0.052 - (0.036 * thin);
    var topEdge: f32 = 0.070 - (0.042 * thin);
    var g: MGBeat = mg_beat(t, 17.0, 5.9, 2.8);
    var wdir: f32 = select(1.0, -1.0, g.seed < 0.5);
    var wtravel: f32 = mix(-0.62, 0.62, g.phase) * wdir;
    var wamp: f32 = (0.085 + (0.055 * fract(g.seed * 7.31))) * g.env;
    var sheet: f32 = 0.0;
    for (var i: i32 = 0; i < 3; i++) {
        var fi: f32 = f32(i);
        var lane: f32 = 4.0 + (13.0 * fi);
        var xi: f32 = x + (0.17 * fi);
        var rate: f32 = (0.110 + (0.230 * wander)) * (1.0 + (0.42 * fi));
        var big: f32 = mg_fbm1((xi * 3.4) + (t * rate), 2, lane) * 0.115;
        var fine: f32 = mg_fbm1((xi * 7.5) - ((t * rate) * 0.50), 2, lane + 7.0) * 0.030;
        var wd: f32 = xi - (wtravel - ((0.10 * fi) * wdir));
        var wave: f32 = wamp * exp(-(wd * wd) / (0.155 * 0.155));
        var centre: f32 = ((arch + (0.026 * (fi - 1.0))) + ((big + fine) * (0.35 + (1.30 * foldK)))) + wave;
        var h: f32 = up - centre;
        var prof: f32 = smoothstep(-halfT - lowEdge, -halfT + 0.004, h) * (1.0 - smoothstep(halfT - 0.004, halfT + topEdge, h));
        var warp: f32 = mg_fbm1((xi * 1.15) - ((t * rate) * 1.70), 2, lane + 5.0);
        var ph: f32 = ((xi * (2.6 + (2.2 * foldK))) + (h * 0.55)) + ((warp * (1.1 + (2.5 * foldK))) * (1.0 + (0.55 * clamp(level, 0.0, 1.0))));
        var pleat: f32 = pow(0.5 + (0.5 * cos(6.2831853 * ph)), 2.2);
        var ray: f32 = 0.55 + (0.85 * pleat);
        sheet += (prof * ray) * (1.0 - (0.24 * fi));
    }
    var pal: MGPalette = mg_palette(inkColor, toneColor, hueShift, depth);
    var inkLin: vec3f = mg_srgb_to_linear(vec3f(inkColor.rgb));
    var flare: f32 = mg_flare(st, length(uv));
    sheet *= (1.0 + (1.55 * flare)) + (0.30 * st.settle);
    var round_: f32 = mg_round(orb, 0.16);
    var v: f32 = ((0.030 + (sheet * 0.46)) * round_) + (0.045 * round_);
    var body: vec3f = mg_shade(pal, mg_tier(v));
    var em: vec3f = (mg_shade(pal, MG_PEAK) * ((0.30 * round_) * pow(clamp(sheet - 0.55, 0.0, 1.0), 2.0))) * max(glow, 0.0);
    var rgb: vec3f = mix(inkLin, body + em, mg_hold(uv, 0.64));
    rgb = vec3f(mg_knee(rgb.r, 0.88), mg_knee(rgb.g, 0.88), mg_knee(rgb.b, 0.88));
    return mg_out(rgb, position * pixelScale);
}

fn mg_ember(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32) -> vec4f {
    var res: vec2f = max(size, vec2f(1.0));
    var uv: vec2f = (position - (0.5 * res)) / min(res.x, res.y);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var heat: f32 = clamp(c0, 0.0, 1.0);
    var shimmer: f32 = clamp(c1, 0.0, 1.0);
    var floorK: f32 = clamp(c2, 0.0, 1.0);
    var updraft: f32 = clamp(c3, 0.0, 1.0);
    var st: MGState = mg_state(stateIndex, stateTau);
    var orb: MGOrb = mg_orb(uv, MG_ORB_R * S);
    var x: f32 = orb.wrap.x - (0.30 * mg_driveDist(st));
    var h: f32 = 0.55 - (orb.wrap.y * (0.85 + (0.45 * floorK)));
    var wp: vec3f = vec3f(x * 2.1, (h * 1.7) - (t * (0.55 + (0.95 * updraft))), t * 0.30);
    var warp: f32 = mg_fbm3(wp, 2, 2.03, 0.5);
    var dx: f32 = (warp * (0.030 + (0.080 * shimmer))) * smoothstep(0.0, 0.32, h);
    var g: MGBeat = mg_beat(t, 29.0, 6.3, 2.5);
    var gdir: f32 = select(1.0, -1.0, g.seed < 0.5);
    var gust: f32 = (gdir * (0.048 + (0.032 * fract(g.seed * 7.31)))) * g.env;
    dx += gust * smoothstep(0.0, 0.34, h);
    var xs: f32 = x + dx;
    var bp: vec3f = vec3f(xs * 2.8, h * 1.2, t * 0.115);
    var bed: f32 = 0.5 + (0.5 * mg_fbm3(bp, 3, 2.03, 0.5));
    var lv: f32 = clamp(level, 0.0, 1.0);
    var bedMask: f32 = smoothstep((0.62 - (0.34 * floorK)) - (0.16 * lv), (0.94 - (0.24 * floorK)) - (0.10 * lv), bed);
    var spread: f32 = (1.0 + ((0.85 + (1.55 * updraft)) * max(h, 0.0))) * (1.0 + (0.34 * g.env));
    var pp: vec3f = vec3f(xs * (2.6 / spread), (h * (2.30 - (0.80 * updraft))) - (t * (0.94 + (1.55 * updraft))), t * 0.195);
    var plume: f32 = 0.5 + (0.5 * mg_fbm3(pp, 3, 2.03, 0.5));
    var column: f32 = exp(-max(h - 0.10, 0.0) / (0.34 + (0.55 * heat)));
    var rise: f32 = column * smoothstep(0.32, 0.86, plume);
    var pal: MGPalette = mg_palette(inkColor, toneColor, hueShift, depth);
    var inkLin: vec3f = mg_srgb_to_linear(vec3f(inkColor.rgb));
    var flare: f32 = mg_flare(st, length(uv));
    var coals: f32 = (bedMask * (0.30 + (0.62 * bed))) * ((1.0 + (1.45 * flare)) + (0.28 * st.settle));
    var round_: f32 = mg_round(orb, 0.22);
    var v: f32 = ((0.055 + (1.02 * coals)) + (((0.20 + (0.28 * heat)) * rise) * (1.0 + (1.15 * flare)))) * round_;
    var body: vec3f = mg_shade(pal, mg_tier(v));
    var em: vec3f = (mg_shade(pal, MG_PEAK) * ((0.30 * round_) * pow(coals, 2.6))) * max(glow, 0.0);
    var rgb: vec3f = mix(inkLin, body + em, mg_hold(uv, 0.64));
    rgb = vec3f(mg_knee(rgb.r, 0.88), mg_knee(rgb.g, 0.88), mg_knee(rgb.b, 0.88));
    return mg_out(rgb, position * pixelScale);
}

fn mg_fog(p: vec2f, flow: vec2f, ff: f32, fz: f32, fogK: f32, clearAt: vec2f, clearAmt: f32) -> f32 {
    var q: vec2f = (p + flow) * vec2f(ff / 2.2, ff);
    var n: f32 = 0.5 + (0.5 * mg_fbm3(vec3f(q, fz), 2, 2.03, 0.5));
    var rho: f32 = (0.16 + (0.30 * fogK)) + ((0.55 + (1.45 * fogK)) * smoothstep(0.40, 0.95, n));
    var d: f32 = length(p - clearAt);
    return rho * (1.0 - (clearAmt * smoothstep(0.055, 0.290, d)));
}

fn mg_lantern(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32) -> vec4f {
    var res: vec2f = max(size, vec2f(1.0));
    var uv: vec2f = (position - (0.5 * res)) / min(res.x, res.y);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var fogK: f32 = clamp(c0, 0.0, 1.0);
    var reach: f32 = clamp(c1, 0.0, 1.0);
    var driftK: f32 = clamp(c2, 0.0, 1.0);
    var offset: f32 = clamp(c3, 0.0, 1.0);
    var lamp: vec2f = (vec2f(-0.085, -0.062) * offset) * S;
    var st: MGState = mg_state(stateIndex, stateTau);
    var flow: vec2f = (vec2f(0.144, -0.052) * t) * (0.32 + (1.30 * driftK));
    flow += vec2f(0.245, -0.070) * mg_driveDist(st);
    var ff: f32 = 4.6 / S;
    var fz: f32 = t * (0.072 + (0.240 * driftK));
    var g: MGBeat = mg_beat(t, 41.0, 7.1, 2.9);
    var clearAmt: f32 = ((0.58 + (0.22 * fract(g.seed * 7.31))) * g.env) + (0.34 * clamp(level, 0.0, 1.0));
    clearAmt = min(clearAmt, 0.86);
    var rho0: f32 = mg_fog(uv, flow, ff, fz, fogK, lamp, clearAmt);
    var rhoL: f32 = mg_fog(lamp, flow, ff, fz, fogK, lamp, clearAmt);
    var ray: vec2f = lamp - uv;
    var len: f32 = length(ray);
    var tau: f32 = 0.0;
    for (var i: i32 = 1; i <= 4; i++) {
        var s: f32 = (f32(i) - 0.5) * 0.25;
        tau += mg_fog(uv + (ray * s), flow, ff, fz, fogK, lamp, clearAmt);
    }
    tau *= len * 0.25;
    var shade: f32 = exp(-(2.4 + (5.0 * fogK)) * tau);
    var sig: f32 = (0.075 + (0.150 * reach)) * S;
    var dLamp: vec2f = uv - lamp;
    var dist2: f32 = dot(dLamp, dLamp);
    var lampOrb: MGOrb = mg_orb(uv - lamp, (0.235 + (0.075 * reach)) * S);
    var lampL: f32 = (mg_round(lampOrb, 0.0) * 0.86) + ((0.34 * (sig * sig)) / (dist2 + (sig * sig)));
    var flare: f32 = mg_flare(st, length(dLamp));
    lampL *= (1.0 + (2.10 * flare)) + (0.34 * st.settle);
    var escape: f32 = exp(-(0.10 + (0.12 * fogK)) * rhoL);
    var lit: f32 = ((((rho0 * lampL) * escape) * (0.14 + (0.86 * shade))) * 1.30) + (((0.15 * lampL) * sqrt(lampL)) * (0.25 + (0.75 * rho0)));
    var pal: MGPalette = mg_palette(inkColor, toneColor, hueShift, depth);
    var inkLin: vec3f = mg_srgb_to_linear(vec3f(inkColor.rgb));
    var body: vec3f = mg_shade(pal, mg_tier(0.055 + (0.92 * lit)));
    var em: vec3f = (mg_shade(pal, MG_PEAK) * (0.30 * pow(clamp(lit, 0.0, 1.0), 2.2))) * max(glow, 0.0);
    var rgb: vec3f = mix(inkLin, body + em, mg_hold(uv, 0.64));
    rgb = vec3f(mg_knee(rgb.r, 0.88), mg_knee(rgb.g, 0.88), mg_knee(rgb.b, 0.88));
    return mg_out(rgb, position * pixelScale);
}

fn mg_mirage(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32) -> vec4f {
    var res: vec2f = max(size, vec2f(1.0));
    var uv: vec2f = (position - (0.5 * res)) / min(res.x, res.y);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var bands: f32 = clamp(c0, 0.0, 1.0);
    var bend: f32 = clamp(c1, 0.0, 1.0);
    var dist: f32 = clamp(c2, 0.0, 1.0);
    var haze: f32 = clamp(c3, 0.0, 1.0);
    var st: MGState = mg_state(stateIndex, stateTau);
    var x: f32 = uv.x / S;
    var d: f32 = uv.y / S;
    var bp: vec3f = vec3f(((x + (t * 0.170)) + (0.42 * mg_driveDist(st))) * 1.6, (d * (5.5 + (5.0 * bands))) + (t * 1.25), t * 0.255);
    var band: f32 = mg_fbm3(bp, 2, 2.03, 0.5);
    var m: f32 = 1.20 + (0.90 * dist);
    var mirror: f32 = smoothstep(0.010, 0.135, d);
    var yy: f32 = mix(d, (d * (2.0 - m)) + 0.045, mirror);
    var g: MGBeat = mg_beat(t, 53.0, 5.6, 2.4);
    var sdir: f32 = select(1.0, -1.0, g.seed < 0.5);
    var stravel: f32 = mix(-0.55, 0.55, g.phase) * sdir;
    var sd: f32 = x - stravel;
    var surge: f32 = g.env * exp(-(sd * sd) / (0.26 * 0.26));
    var grip: f32 = smoothstep(-0.16, 0.10, d);
    var ys: f32 = yy + (((band * (0.055 + (0.120 * bend))) * ((1.0 + (1.20 * surge)) + (0.60 * clamp(activity, 0.0, 1.0)))) * grip);
    var orb: MGOrb = mg_orb(vec2f(x, ys) * S, MG_ORB_R * S);
    var core: f32 = mg_round(orb, 0.06);
    var halo: f32 = exp((-0.85 * max(orb.r - 1.0, 0.0)) / 0.30) * (1.0 - (0.55 * orb.mask));
    var sp: vec3f = vec3f(x * 3.2, (ys * 3.2) + 5.7, t * 0.065);
    var grain: f32 = 0.5 + (0.5 * mg_fbm3(sp, 2, 2.03, 0.5));
    var pal: MGPalette = mg_palette(inkColor, toneColor, hueShift, depth);
    var inkLin: vec3f = mg_srgb_to_linear(vec3f(inkColor.rgb));
    var flare: f32 = mg_flare(st, length(uv));
    var img: f32 = (core * (0.42 + (0.78 * grain))) * ((1.0 + (1.60 * flare)) + (0.30 * st.settle));
    var veil: f32 = ((exp((-0.55 * max(orb.r - 0.55, 0.0)) / 0.42) * haze) * 0.24) * (0.45 + (0.55 * (0.5 + (0.5 * band))));
    var v: f32 = ((0.030 + (1.00 * img)) + (((0.26 * halo) * (0.40 + (0.60 * (0.5 + (0.5 * band))))) * (1.0 + (1.30 * flare)))) + (1.45 * veil);
    var body: vec3f = mg_shade(pal, mg_tier(v));
    var em: vec3f = (mg_shade(pal, MG_PEAK) * (0.30 * pow(clamp(img, 0.0, 1.0), 2.2))) * max(glow, 0.0);
    var rgb: vec3f = mix(inkLin, body + em, mg_hold(uv, 0.64));
    rgb = vec3f(mg_knee(rgb.r, 0.88), mg_knee(rgb.g, 0.88), mg_knee(rgb.b, 0.88));
    return mg_out(rgb, position * pixelScale);
}

fn mg_open_law(tau: f32, openTime: f32) -> vec3f {
    var T: f32 = max(openTime, 0.50);
    var k: f32 = 3.0 / T;
    var e: f32 = exp(-k * max(tau, 0.0));
    return vec3f(1.0 - e, k * e, e);
}

fn mg_oculus(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32) -> vec4f {
    var res: vec2f = max(size, vec2f(1.0));
    var uv: vec2f = (position - (0.5 * res)) / min(res.x, res.y);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var apertureK: f32 = clamp(c0, 0.0, 1.0);
    var rimK: f32 = clamp(c1, 0.0, 1.0);
    var beamK: f32 = clamp(c2, 0.0, 1.0);
    var dustK: f32 = clamp(c3, 0.0, 1.0);
    var tau: f32 = max(time - epoch, 0.0);
    var law: vec3f = mg_open_law(tau, 2.6);
    var st: MGState = mg_state(stateIndex, stateTau);
    var orb: MGOrb = mg_orb(uv, MG_ORB_R * S);
    var r: f32 = length(uv);
    var ang: f32 = atan2(uv.y, uv.x);
    var Rrest: f32 = ((0.100 + (0.150 * apertureK)) * (1.0 + (0.30 * clamp(level, 0.0, 1.0)))) * S;
    var R: f32 = mix(0.022 * S, Rrest, law.x);
    var ring: vec2f = vec2f(cos(ang), sin(ang)) * 1.10;
    var tearN: f32 = mg_fbm3(vec3f(ring, t * 0.234), 2, 2.03, 0.5);
    var Ra: f32 = R * (1.0 + ((0.16 + (0.30 * law.z)) * tearN));
    var w: f32 = (0.050 + (0.085 * (1.0 - rimK))) * S;
    var pass_: f32 = 1.0 - smoothstep(Ra - w, Ra + w, r);
    let dir: vec2f = vec2f(-0.55, -0.835);
    var lean: f32 = 0.58 + (0.42 * smoothstep(-Rrest, Rrest, dot(uv, dir)));
    var ip: vec3f = vec3f((uv * (6.5 / S)) + vec2f(0.0, (-t * 0.170) - (0.55 * mg_driveDist(st))), t * 0.15);
    var inner: f32 = 0.5 + (0.5 * mg_fbm3(ip, 2, 2.03, 0.5));
    var g: MGBeat = mg_beat(t, 67.0, 6.9, 2.7);
    var ea: f32 = g.seed * 6.2831853;
    var e2: f32 = fract(g.seed * 7.31);
    var ep: vec2f = (vec2f(cos(ea), sin(ea)) * (0.085 + (0.100 * e2))) * S;
    var ed: vec2f = uv - ep;
    var esig: f32 = 0.130 * S;
    var turn: f32 = ((g.env * 1.35) * exp(-dot(ed, ed) / (esig * esig))) * (select(1.0, -1.0, e2 < 0.5));
    var ec: f32 = cos(turn);
    var es: f32 = sin(turn);
    var uvAir: vec2f = ep + vec2f((ec * ed.x) - (es * ed.y), (es * ed.x) + (ec * ed.y));
    var ap: vec3f = vec3f((uvAir * (7.0 / S)) + vec2f(t * 0.044, -t * 0.116), t * 0.285);
    var air: f32 = 0.5 + (0.5 * mg_fbm3(ap, 2, 2.03, 0.5));
    air = 1.0 - ((dustK * 0.55) * (1.0 - air));
    var beam: f32 = exp(-max(r - Ra, 0.0) / ((0.045 + (0.115 * beamK)) * S)) * air;
    var lipW: f32 = (0.028 + (0.040 * rimK)) * S;
    var lg: f32 = (r - (Ra * 1.05)) / lipW;
    var lip: f32 = (exp(-lg * lg) * rimK) * lean;
    var pal: MGPalette = mg_palette(inkColor, toneColor, hueShift, depth);
    var inkLin: vec3f = mg_srgb_to_linear(vec3f(inkColor.rgb));
    var flare: f32 = mg_flare(st, length(uv));
    var surge: f32 = (1.0 + (1.70 * flare)) + (0.30 * st.settle);
    var inLg: f32 = (r - (Ra * 0.84)) / (0.030 * S);
    var innerRim: f32 = (exp(-inLg * inLg) * pass_) * lean;
    var through: f32 = ((pass_ * lean) * (0.42 + (0.58 * inner))) * surge;
    var spill: f32 = (beam * (0.35 + (0.65 * lean))) * surge;
    var round_: f32 = mg_round(orb, 0.10);
    var v: f32 = ((0.030 + (0.66 * through)) + (((0.26 * spill) + ((0.30 * lip) * surge)) * round_)) + ((0.62 * innerRim) * surge);
    var body: vec3f = mg_shade(pal, mg_tier(v));
    var em: vec3f = (mg_shade(pal, MG_PEAK) * ((0.16 * pow(clamp(through, 0.0, 1.0), 2.0)) + ((0.30 * innerRim) * surge))) * max(glow, 0.0);
    var rgb: vec3f = mix(inkLin, body + em, mg_hold(uv, 0.64));
    rgb = vec3f(mg_knee(rgb.r, 0.88), mg_knee(rgb.g, 0.88), mg_knee(rgb.b, 0.88));
    return mg_out(rgb, position * pixelScale);
}

fn mg_dapple(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32) -> vec4f {
    var res: vec2f = max(size, vec2f(1.0));
    var uv: vec2f = (position - (0.5 * res)) / min(res.x, res.y);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var canopy: f32 = clamp(c0, 0.0, 1.0);
    var breeze: f32 = clamp(c1, 0.0, 1.0);
    var patch_: f32 = clamp(c2, 0.0, 1.0);
    var fall: f32 = clamp(c3, 0.0, 1.0);
    var soft: f32 = 0.10 + (0.30 * fall);
    var blur: f32 = 1.0 - (0.28 * fall);
    var st: MGState = mg_state(stateIndex, stateTau);
    var orb: MGOrb = mg_orb(uv, MG_ORB_R * S);
    var flare: f32 = mg_flare(st, length(uv));
    var g: MGBeat = mg_beat(t, 79.0, 6.1, 2.6);
    var ca: f32 = g.seed * 6.2831853;
    var chase: vec2f = (vec2f(cos(ca), sin(ca)) * (0.085 + (0.055 * fract(g.seed * 7.31)))) * g.env;
    var trans: f32 = 1.0;
    for (var i: i32 = 0; i < 2; i++) {
        var fi: f32 = f32(i);
        var freq: f32 = (((4.6 + (3.0 * canopy)) * blur) * (1.0 - (0.34 * fi))) / S;
        var dr: vec2f = ((mix(vec2f(0.135, 0.040), vec2f(0.088, 0.026), fi) * t) * (0.40 + (1.40 * breeze))) + ((vec2f(0.300, 0.085) * mg_driveDist(st)) * (1.0 - (0.25 * fi)));
        var gust: vec2f = (vec2f(sin((t * (0.83 - (0.21 * fi))) + (fi * 2.3)), cos((t * (0.61 + (0.17 * fi))) + (fi * 1.1))) * (0.012 + (0.045 * breeze))) * (1.0 + (0.85 * clamp(activity, 0.0, 1.0)));
        var q: vec3f = vec3f((((orb.wrap + dr) + gust) + (chase * (1.0 - (0.55 * fi)))) * freq, t * (0.17 - (0.05 * fi)));
        var n: f32 = mg_fbm3(q, 2, 2.03, 0.5);
        var cut: f32 = (0.16 - (0.26 * patch_)) - ((0.17 * flare) + (0.045 * st.settle));
        trans *= smoothstep(cut - soft, cut + soft, n);
    }
    var cq: vec3f = vec3f(((orb.wrap + ((vec2f(0.052, 0.016) * t) * (0.40 + (1.40 * breeze)))) + (vec2f(0.110, 0.032) * mg_driveDist(st))) * (1.35 / S), t * 0.075);
    var crown: f32 = 0.5 + (0.5 * mg_fbm3(cq, 2, 2.03, 0.5));
    var pal: MGPalette = mg_palette(inkColor, toneColor, hueShift, depth);
    var inkLin: vec3f = mg_srgb_to_linear(vec3f(inkColor.rgb));
    var poolAt: vec2f = vec2f(-0.055, 0.038);
    var pd: vec2f = orb.wrap - poolAt;
    var rp: f32 = length(pd) / 0.520;
    var pool: f32 = 1.0 - smoothstep(0.52, 1.34, rp);
    var lift: f32 = 0.20 + (0.92 * pool);
    var round_: f32 = mg_round(orb, 0.13);
    var v: f32 = (((0.045 + (0.100 * crown)) * (0.35 + (0.65 * pool))) + ((trans * lift) * (0.78 + (0.46 * crown)))) * round_;
    var body: vec3f = mg_shade(pal, mg_tier(v));
    var em: vec3f = (mg_shade(pal, MG_PEAK) * (((0.30 * pool) * round_) * pow(clamp(trans, 0.0, 1.0), 3.0))) * max(glow, 0.0);
    var rgb: vec3f = mix(inkLin, body + em, mg_hold(uv, 0.64));
    rgb = vec3f(mg_knee(rgb.r, 0.88), mg_knee(rgb.g, 0.88), mg_knee(rgb.b, 0.88));
    return mg_out(rgb, position * pixelScale);
}

fn mg_eclipse(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32) -> vec4f {
    var res: vec2f = max(size, vec2f(1.0));
    var uv: vec2f = (position - (0.5 * res)) / min(res.x, res.y);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var occK: f32 = clamp(c0, 0.0, 1.0);
    var coronaK: f32 = clamp(c1, 0.0, 1.0);
    var driftK: f32 = clamp(c2, 0.0, 1.0);
    var softK: f32 = clamp(c3, 0.0, 1.0);
    var lp: vec2f = vec2f(0.085, -0.052) * S;
    var lightOrb: MGOrb = mg_orb(uv - lp, MG_ORB_R * S);
    var lq: vec3f = vec3f((uv * (5.5 / S)) + vec2f(0.0, -t * 0.060), t * 0.12);
    var lgrain: f32 = 0.5 + (0.5 * mg_fbm3(lq, 2, 2.03, 0.5));
    var lightRaw: f32 = mg_round(lightOrb, 0.04) * (0.52 + (0.62 * lgrain));
    var g: MGBeat = mg_beat(t, 91.0, 7.4, 2.6);
    var scoot: f32 = (g.env * (0.42 + (0.30 * fract(g.seed * 7.31)))) * (select(1.0, -1.0, g.seed < 0.5));
    var st: MGState = mg_state(stateIndex, stateTau);
    var th: f32 = ((t * (0.26 + (0.44 * driftK))) + scoot) + (1.15 * mg_driveDist(st));
    var wander: f32 = (0.090 - (0.028 * occK)) * S;
    var breathe: f32 = 0.86 + (0.14 * sin((th * 0.41) + 1.7));
    var op: vec2f = (vec2f(cos(th), sin(th)) * wander) * breathe;
    var dO: vec2f = uv - op;
    var ro: f32 = length(dO);
    var angO: f32 = atan2(dO.y, dO.x);
    var ring: vec2f = vec2f(cos(angO), sin(angO)) * 1.25;
    var tearN: f32 = mg_fbm3(vec3f(ring, t * 0.26), 2, 2.03, 0.5);
    var Rocc: f32 = ((0.120 + (0.104 * occK)) * S) * (1.0 + ((0.09 + (0.11 * softK)) * tearN));
    var w: f32 = (0.018 + (0.034 * softK)) * S;
    var cover: f32 = 1.0 - smoothstep(Rocc - w, Rocc + w, ro);
    var cring: vec2f = (vec2f(cos(angO), sin(angO)) * 1.90) + vec2f(11.3, -7.1);
    var plumeN: f32 = 0.5 + (0.5 * mg_fbm3(vec3f(cring, t * 0.22), 2, 2.03, 0.5));
    var hC: f32 = (((0.022 + (0.070 * coronaK)) * S) * (0.35 + (1.45 * plumeN))) * (1.0 + (0.50 * clamp(level, 0.0, 1.0)));
    var limb: f32 = exp(-max(ro - Rocc, 0.0) / max(hC, 1e-4));
    var corona: f32 = ((limb * (1.0 - cover)) * lightRaw) * (0.40 + (0.75 * coronaK));
    var flare: f32 = mg_flare(st, length(uv - lp));
    corona *= (1.0 + (2.30 * flare)) + (0.34 * st.settle);
    var pal: MGPalette = mg_palette(inkColor, toneColor, hueShift, depth);
    var inkLin: vec3f = mg_srgb_to_linear(vec3f(inkColor.rgb));
    var v: f32 = ((0.026 + ((0.86 * lightRaw) * (1.0 - cover))) + (1.35 * corona)) + ((cover * 0.042) * (0.40 + (0.60 * lgrain)));
    var body: vec3f = mg_shade(pal, mg_tier(v));
    var em: vec3f = (mg_shade(pal, MG_PEAK) * (0.30 * pow(clamp(corona, 0.0, 1.0), 2.0))) * max(glow, 0.0);
    var rgb: vec3f = mix(inkLin, body + em, mg_hold(uv, 0.64));
    rgb = vec3f(mg_knee(rgb.r, 0.88), mg_knee(rgb.g, 0.88), mg_knee(rgb.b, 0.88));
    return mg_out(rgb, position * pixelScale);
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

@fragment fn fs_caustic(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mg_caustic(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_aurora(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mg_aurora(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_ember(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mg_ember(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_lantern(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mg_lantern(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_mirage(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mg_mirage(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_oculus(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mg_oculus(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_dapple(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mg_dapple(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_eclipse(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mg_eclipse(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity);
    return orb_clip(pos, c.rgb);
}
