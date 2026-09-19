// Orb shader pack. WGSL, WebGPU.
// Derived from the Metal shaders of the MIT-licensed "murmur" package
// (c) Kris Puckett; ported function-for-function. MIT notice retained.
const M_PI_F: f32 = 3.14159265358979;

fn ms_hash(v: vec3u) -> u32 {
    var h: u32 = ((v.x * 1597334673u) ^ (v.y * 3812015801u)) ^ (v.z * 2798796415u);
    h ^= h >> 15u;
    h *= 2246822519u;
    h ^= h >> 13u;
    h *= 3266489917u;
    h ^= h >> 16u;
    return h;
}

fn ms_grad3(c: vec3i) -> vec3f {
    var h: u32 = ms_hash(vec3u(c + 4096));
    var z: f32 = fma(f32(h & 0xFFFFu), 2.0 / 65535.0, -1.0);
    var a: f32 = f32((h >> 16u) & 0xFFFFu) * (6.28318530718 / 65536.0);
    var r: f32 = sqrt(max(0.0, 1.0 - (z * z)));
    return vec3f(r * cos(a), r * sin(a), z);
}

fn ms_noise3(p: vec3f) -> f32 {
    var i: vec3f = floor(p);
    var f: vec3f = p - i;
    var u: vec3f = ((f * f) * f) * ((f * ((f * 6.0) - 15.0)) + 10.0);
    var c: vec3i = vec3i(i);
    var va: f32 = dot(ms_grad3(c + vec3i(0, 0, 0)), f - vec3f(0.0, 0.0, 0.0));
    var vb: f32 = dot(ms_grad3(c + vec3i(1, 0, 0)), f - vec3f(1.0, 0.0, 0.0));
    var vc: f32 = dot(ms_grad3(c + vec3i(0, 1, 0)), f - vec3f(0.0, 1.0, 0.0));
    var vd: f32 = dot(ms_grad3(c + vec3i(1, 1, 0)), f - vec3f(1.0, 1.0, 0.0));
    var ve: f32 = dot(ms_grad3(c + vec3i(0, 0, 1)), f - vec3f(0.0, 0.0, 1.0));
    var vf: f32 = dot(ms_grad3(c + vec3i(1, 0, 1)), f - vec3f(1.0, 0.0, 1.0));
    var vg: f32 = dot(ms_grad3(c + vec3i(0, 1, 1)), f - vec3f(0.0, 1.0, 1.0));
    var vh: f32 = dot(ms_grad3(c + vec3i(1, 1, 1)), f - vec3f(1.0, 1.0, 1.0));
    return mix(mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y), mix(mix(ve, vf, u.x), mix(vg, vh, u.x), u.y), u.z);
}

const MS_ROT: mat3x3f = mat3x3f(vec3f(0.00, 0.80, 0.60), vec3f(-0.80, 0.36, -0.48), vec3f(-0.60, -0.48, 0.64));

fn ms_fbm3(p: vec3f, octaves: i32, lacunarity: f32, gain: f32) -> f32 {
    var q: vec3f = p;
    var amp: f32 = 0.5;
    var value: f32 = 0.0;
    for (var i: i32 = 0; i < octaves; i++) {
        value += amp * ms_noise3(q);
        amp *= gain;
        q = lacunarity * (MS_ROT * q);
    }
    return value;
}

fn ms_hash1(cell: f32, lane: f32) -> f32 {
    return f32(ms_hash(vec3u(u32(i32(cell) + 32768), u32(i32(lane) + 32768), 0x9E3779B9u)) >> 8u) * (1.0 / 16777216.0);
}

fn ms_vnoise1(x: f32, lane: f32) -> f32 {
    var i: f32 = floor(x);
    var f: f32 = x - i;
    var u: f32 = ((f * f) * f) * ((f * ((f * 6.0) - 15.0)) + 10.0);
    return (mix(ms_hash1(i, lane), ms_hash1(i + 1.0, lane), u) * 2.0) - 1.0;
}

fn ms_fbm1(x: f32, octaves: i32, lane: f32) -> f32 {
    var v: f32 = 0.0;
    var amp: f32 = 0.5;
    var f: f32 = 1.0;
    for (var i: i32 = 0; i < octaves; i++) {
        v += amp * ms_vnoise1(x * f, lane + (f32(i) * 37.0));
        amp *= 0.5;
        f *= 2.03;
    }
    return v;
}

fn ms_srgb_to_linear(c: vec3f) -> vec3f {
    var c_p: vec3f = c;
    c_p = max(c_p, vec3f(0.0));
    return select(c_p * (1.0 / 12.92), pow((c_p + 0.055) * (1.0 / 1.055), vec3f(2.4)), c_p > vec3f(0.04045));
}

fn ms_linear_to_srgb(c: vec3f) -> vec3f {
    var c_p: vec3f = c;
    c_p = max(c_p, vec3f(0.0));
    return select(c_p * 12.92, (1.055 * pow(c_p, vec3f(1.0 / 2.4))) - 0.055, c_p > vec3f(0.0031308));
}

fn ms_linear_to_oklab(c: vec3f) -> vec3f {
    var l: f32 = ((0.4122214708 * c.r) + (0.5363325363 * c.g)) + (0.0514459929 * c.b);
    var m: f32 = ((0.2119034982 * c.r) + (0.6806995451 * c.g)) + (0.1073969566 * c.b);
    var s: f32 = ((0.0883024619 * c.r) + (0.2817188376 * c.g)) + (0.6299787005 * c.b);
    var l_: f32 = pow(max(l, 0.0), 1.0 / 3.0);
    var m_: f32 = pow(max(m, 0.0), 1.0 / 3.0);
    var s_: f32 = pow(max(s, 0.0), 1.0 / 3.0);
    return vec3f(((0.2104542553 * l_) + (0.7936177850 * m_)) - (0.0040720468 * s_), ((1.9779984951 * l_) - (2.4285922050 * m_)) + (0.4505937099 * s_), ((0.0259040371 * l_) + (0.7827717662 * m_)) - (0.8086757660 * s_));
}

fn ms_oklab_to_linear(lab: vec3f) -> vec3f {
    var l_: f32 = (lab.x + (0.3963377774 * lab.y)) + (0.2158037573 * lab.z);
    var m_: f32 = (lab.x - (0.1055613458 * lab.y)) - (0.0638541728 * lab.z);
    var s_: f32 = (lab.x - (0.0894841775 * lab.y)) - (1.2914855480 * lab.z);
    var l: f32 = (l_ * l_) * l_;
    var m: f32 = (m_ * m_) * m_;
    var s: f32 = (s_ * s_) * s_;
    return vec3f(((4.0767416621 * l) - (3.3077115913 * m)) + (0.2309699292 * s), ((-1.2684380046 * l) + (2.6097574011 * m)) - (0.3413193965 * s), ((-0.0041960863 * l) - (0.7034186147 * m)) + (1.7076147010 * s));
}

fn ms_lch(L: f32, C: f32, h: f32) -> vec3f {
    return vec3f(L, C * cos(h), C * sin(h));
}

struct MSPalette {
    s0: vec3f,
    s1: vec3f,
    s2: vec3f,
    s3: vec3f
}

fn ms_palette(inkColor: vec4f, toneColor: vec4f, hueShift: f32, depth: f32) -> MSPalette {
    var ink: vec3f = ms_linear_to_oklab(ms_srgb_to_linear(vec3f(inkColor.rgb)));
    var tone: vec3f = ms_linear_to_oklab(ms_srgb_to_linear(vec3f(toneColor.rgb)));
    var L: f32 = tone.x;
    var C: f32 = length(tone.yz);
    var h: f32 = atan2(tone.z, tone.y) + hueShift;
    var d: f32 = clamp(depth, 0.30, 2.00);
    var p: MSPalette;
    p.s0 = ink;
    p.s1 = ms_lch(mix(ink.x, L, 0.30 / d), C * (0.52 + (0.10 * d)), h - 0.35);
    p.s2 = ms_lch(L, C, h);
    p.s3 = ms_lch(min(L * (1.20 + (0.12 * d)), 0.93), C * 0.55, h + 0.10);
    return p;
}

fn ms_shade(p: MSPalette, t: f32) -> vec3f {
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
    return ms_oklab_to_linear(lab);
}

fn ms_out(linearRGB: vec3f, pixel: vec2f) -> vec4f {
    var c: vec3f = ms_linear_to_srgb(linearRGB);
    var n: f32 = fract(52.9829189 * fract(dot(pixel, vec2f(0.06711056, 0.00583715))));
    var tri: f32 = select(1.0 - sqrt(max(0.0, 2.0 - (2.0 * n))), sqrt(2.0 * n) - 1.0, n < 0.5);
    c += vec3f(tri * (1.0 / 255.0));
    return vec4f(vec3f(saturate(c)), 1.0);
}

fn ms_knee(x: f32, knee: f32) -> f32 {
    return select(knee + ((1.0 - knee) * (1.0 - exp(-(x - knee) / max(1.0 - knee, 1e-3)))), x, x < knee);
}

fn ms_settle_law(tau: f32, settleTime: f32) -> vec3f {
    const HOLD: f32 = 0.055;
    var E: f32 = max(settleTime, 0.50);
    var k: f32 = 3.0 / E;
    var e: f32 = exp(-k * max(tau, 0.0));
    var v: f32 = HOLD + ((1.0 - HOLD) * e);
    var D: f32 = (HOLD * max(tau, 0.0)) + (((1.0 - HOLD) * (1.0 - e)) / k);
    return vec3f(v, D, e);
}

fn ms_containment(uv: vec2f, reach: f32) -> f32 {
    var r: f32 = length(uv) * 2.0;
    return 1.0 - smoothstep(reach, reach + 0.31, r);
}

fn ms_tier(e: f32) -> f32 {
    var x: f32 = clamp(e, 0.0, 1.0);
    const K: f32 = 0.78;
    var body: f32 = (x / K) * 0.72;
    var peak: f32 = 0.72 + (((x - K) / (1.0 - K)) * 0.28);
    return mix(body, peak, smoothstep(K - 0.10, K + 0.10, x));
}

fn ms_lit(pal: MSPalette, e: f32, glow: f32, base: f32, span: f32, emis: f32) -> vec3f {
    var G: f32 = max(glow, 0.0);
    var en: f32 = clamp(ms_knee(max(e, 0.0) * (0.35 + (0.65 * G)), 0.92), 0.0, 1.0);
    var tRail: f32 = clamp(base + (span * ms_tier(en)), 0.0, 1.0);
    var col: vec3f = ms_shade(pal, tRail);
    return col * (1.0 + ((emis * G) * smoothstep(0.72, 1.0, tRail)));
}

fn ms_aa(cycles: f32, size: vec2f, pixelScale: f32) -> f32 {
    var px: f32 = max(min(size.x, size.y), 1.0) * max(pixelScale, 1.0);
    var perPixel: f32 = max(cycles, 0.0) / (6.2831853 * px);
    return 1.0 - smoothstep(0.16, 0.36, perPixel);
}


// Integrated live signals, supplied by the runtime (∫ over the shader's own
// clock). voiceT/paceT are ∫ of the mh_live/mq_live-shaped signals, vdT/pdT
// their products with the responding drive, levelT/activityT the raw signals.
struct LiveSig {
    voiceT: f32, paceT: f32, driveT: f32, vdT: f32, pdT: f32, levelT: f32, activityT: f32
}
struct MSState {
    complete: f32,
    settled: f32,
    drive: f32
}

fn ms_state(stateIndex: f32, stateTau: f32) -> MSState {
    var o: MSState;
    o.complete = 0.0;
    o.settled = 0.0;
    o.drive = 0.0;
    var tau: f32 = max(stateTau, 0.0);
    if ((stateIndex > 3.5) && (stateIndex < 4.5)) {
        var a: f32 = clamp(tau / 1.20, 0.0, 1.0);
        o.complete = smoothstep(0.0, 0.30, a) * (1.0 - smoothstep(0.36, 1.0, a));
        o.settled = smoothstep(0.30, 1.05, a);
    } else if ((stateIndex > 2.5) && (stateIndex < 3.5)) {
        o.drive = smoothstep(0.0, 0.55, tau);
    }
    return o;
}

fn ms_flourish(t: f32, lane: f32) -> vec4f {
    const SLOT: f32 = 6.5;
    var slot: f32 = floor(t / SLOT);
    var local: f32 = t - (slot * SLOT);
    var start: f32 = 1.15 + (2.20 * ms_hash1(slot, lane));
    var dur: f32 = 1.60 + (1.40 * ms_hash1(slot + 811.0, lane));
    var u: f32 = (local - start) / dur;
    var sn: f32 = sin(3.14159265 * clamp(u, 0.0, 1.0));
    var env: f32 = select(sn * sn, 0.0, (u <= 0.0) || (u >= 1.0));
    return vec4f(env, clamp(u, 0.0, 1.0), ms_hash1(slot + 1607.0, lane), slot);
}

struct MSOrb {
    s: vec2f,
    z: f32,
    p: vec3f,
    m: f32,
    limb: f32,
    lit: f32
}

fn ms_orb(uv: vec2f, centre: vec2f, R: f32) -> MSOrb {
    var o: MSOrb;
    o.s = (uv - centre) / max(R, 1e-3);
    var r2: f32 = dot(o.s, o.s);
    o.z = sqrt(max(1.0 - min(r2, 1.0), 0.0));
    o.p = vec3f(o.s, o.z);
    o.m = 1.0 - smoothstep(0.93, 1.02, sqrt(r2));
    o.limb = pow(clamp(o.z, 0.0, 1.0), 0.55);
    o.lit = 0.42 + (0.58 * clamp(dot(o.p, vec3f(-0.40, 0.47, 0.79)), 0.0, 1.0));
    return o;
}

fn ms_spin(p: vec3f, ay: f32, ax: f32) -> vec3f {
    var ca: f32 = cos(ay);
    var sa: f32 = sin(ay);
    var q: vec3f = vec3f((ca * p.x) + (sa * p.z), p.y, (-sa * p.x) + (ca * p.z));
    var cb: f32 = cos(ax);
    var sb: f32 = sin(ax);
    return vec3f(q.x, (cb * q.y) - (sb * q.z), (sb * q.y) + (cb * q.z));
}

fn ms_finish(field: vec3f, inkLin: vec3f, containment: f32, position: vec2f, pixelScale: f32) -> vec4f {
    var rgb: vec3f = mix(inkLin, field, containment);
    rgb = vec3f(ms_knee(rgb.r, 0.90), ms_knee(rgb.g, 0.90), ms_knee(rgb.b, 0.90));
    return ms_out(rgb, position * pixelScale);
}

fn ms_murmuration(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var flock: f32 = clamp(c0, 0.0, 1.0);
    var turn: f32 = clamp(c1, 0.0, 1.0);
    var cohesion: f32 = clamp(c2, 0.0, 1.0);
    var sky: f32 = clamp(c3, 0.0, 1.0);
    var st: MSState = ms_state(stateIndex, stateTau);
    var bank: f32 = (turn * ((0.62 * sin(t * 0.214)) + (0.31 * sin((t * 0.362) + 1.7)))) * (1.0 + (0.60 * clamp(level, 0.0, 1.0)));
    var orb: MSOrb = ms_orb(uv, vec2f(0.0), 0.335);
    var spin: f32 = ((t * 0.235) * (1.0 + (0.75 * st.drive))) + (bank * 0.55);
    var P: vec3f = ms_spin(orb.p, spin, 0.20 + (bank * 0.34));
    var fSplit: vec4f = ms_flourish(t, 3.0);
    var seam: f32 = fSplit.z * 6.2831853;
    var sn3: vec3f = vec3f(cos(seam), sin(seam), 0.0);
    P += sn3 * ((((2.0 * smoothstep(-0.14, 0.14, dot(P, sn3))) - 1.0) * fSplit.x) * 0.24);
    var warp: f32 = ms_fbm3((P * 1.35) + vec3f(9.7, 3.1, t * 0.088), 2, 2.00, 0.50);
    var PW: vec3f = P + (vec3f(-P.y, P.x, 0.0) * (warp * (0.22 + (0.30 * flock))));
    var n: f32 = ms_fbm3((PW * (2.85 / S)) + vec3f(0.0, 0.0, t * 0.115), 3, 2.03, 0.52);
    n = mix(n, 0.42 * sin((dot(P, vec3f(0.72, 0.41, 0.56)) * 7.6) - (t * 1.15)), st.complete * 0.88);
    var folds: f32 = 1.8 + (1.5 * flock);
    var k: f32 = mix(0.30, 1.30, cohesion);
    var sheet: f32 = exp(k * (cos((6.2831853 * n) * folds) - 1.0));
    var grain: f32 = exp((k * 1.40) * (cos(((6.2831853 * n) * folds) * 2.60) - 1.0));
    sheet *= 0.72 + (0.42 * grain);
    var lead: f32 = smoothstep(-0.30, 0.80, dot(P, vec3f(0.58, 0.40, 0.71)));
    var dens: f32 = (((((orb.m * orb.limb) * orb.lit) * (0.34 + (0.66 * sheet))) * (0.52 + (0.48 * flock))) * (0.52 + (0.95 * lead))) * 1.70;
    var haloZ: f32 = (length(uv) - 0.345) / 0.085;
    var skyN: f32 = ms_fbm3((orb.p * 0.75) + vec3f(0.0, 0.0, t * 0.047), 2, 2.00, 0.50);
    var dusk: f32 = (sky * (0.10 + (0.16 * (0.5 + skyN)))) * exp(-haloZ * haloZ);
    var eM: f32 = (dens + dusk) * ((1.0 + (0.62 * st.complete)) + (0.16 * st.settled));
    var pal: MSPalette = ms_palette(inkColor, toneColor, hueShift, depth);
    var field: vec3f = ms_lit(pal, eM, glow, 0.0, 1.0, 0.30);
    var inkLin: vec3f = ms_srgb_to_linear(vec3f(inkColor.rgb));
    return ms_finish(field, inkLin, ms_containment(uv, 0.60), position, pixelScale);
}

fn ms_loom(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var threads: f32 = clamp(c0, 0.0, 1.0);
    var tension: f32 = clamp(c1, 0.0, 1.0);
    var sheen: f32 = clamp(c2, 0.0, 1.0);
    var angleK: f32 = clamp(c3, 0.0, 1.0);
    var orb: MSOrb = ms_orb(uv, vec2f(0.0), 0.335);
    var st: MSState = ms_state(stateIndex, stateTau);
    var a: f32 = ((angleK - 0.5) * 1.30) + 0.32;
    var D1: vec3f = normalize(vec3f(cos(a), sin(a), 0.32));
    var D2: vec3f = normalize(cross(D1, vec3f(0.14, -0.22, 0.96)));
    var K: f32 = mix(9.0, 22.0, threads) / S;
    var aa: f32 = ms_aa(K * 1.6, size, pixelScale);
    var beat: f32 = 0.5 + (0.5 * sin(t * 0.1828));
    var taut: f32 = clamp(max(tension * (0.42 + (0.58 * beat)), st.complete), 0.0, 1.0);
    var wander: f32 = mix(1.15, 0.20, taut) * (1.0 - (0.85 * st.complete));
    var feed: f32 = (1.0 + (1.30 * st.drive)) + (0.85 * clamp(activity, 0.0, 1.0));
    var P: vec3f = ms_spin(orb.p, (t * 0.17) * feed, 0.18);
    var dq: vec3f = (P * 0.85) + vec3f(0.0, 0.0, t * 0.042);
    var drapeA: f32 = ms_fbm3(dq, 2, 2.00, 0.50);
    var drapeB: f32 = ms_fbm3(dq + 21.7, 2, 2.00, 0.50);
    var Pd: vec3f = P + (vec3f(drapeA, drapeB, 0.0) * 0.16);
    var qd: vec2f = vec2f(dot(Pd, D1), dot(Pd, D2));
    var d1: vec2f = vec2f(1.0, 0.0);
    var d2: vec2f = vec2f(0.0, 1.0);
    var w1: f32 = ms_fbm1((dot(qd, d2) * 1.9) + (t * 0.083), 3, 4.0);
    var w2: f32 = ms_fbm1((dot(qd, d1) * 1.9) - (t * 0.062), 3, 61.0);
    var br1: f32 = ms_fbm1((dot(qd, d2) * 0.50) - (t * 0.035), 2, 91.0);
    var br2: f32 = ms_fbm1((dot(qd, d1) * 0.50) + (t * 0.029), 2, 137.0);
    var fPull: vec4f = ms_flourish(t, 12.0);
    var pz: f32 = (dot(qd, d2) - ((fPull.z - 0.5) * 0.70)) / 0.075;
    var pull: f32 = fPull.x * exp(-pz * pz);
    var ph1: f32 = ((((dot(qd, d1) * K) + (((w1 * wander) * 5.5) * (1.0 - (0.65 * pull)))) + (br1 * 7.0)) - ((t * 0.68) * feed)) + (pull * 5.20);
    var ph2: f32 = (((dot(qd, d2) * K) + ((w2 * wander) * 5.5)) + (br2 * 7.0)) + ((t * 0.54) * feed);
    var warp: f32 = mix(0.5, 0.5 + (0.5 * sin(ph1)), aa);
    var weft: f32 = mix(0.5, 0.5 + (0.5 * sin(ph2)), aa);
    var cloth: f32 = ((0.32 + (0.50 * warp)) + (0.26 * weft)) - (((taut * 0.26) * warp) * weft);
    var bolt: f32 = 0.62 + (0.55 * (0.5 + drapeA));
    var slope: f32 = ((0.78 * cos(ph1)) * aa) - ((0.46 * cos(ph2)) * aa);
    var spec: f32 = pow(clamp(0.5 + (0.5 * slope), 0.0, 1.0), 5.0);
    var patch_: f32 = (orb.m * orb.limb) * orb.lit;
    var e: f32 = (((((cloth * bolt) * (0.56 + (0.26 * taut))) + (((sheen * 1.05) * spec) * cloth)) * patch_) * 1.55) * ((1.0 + (0.58 * st.complete)) + (0.15 * st.settled));
    var pal: MSPalette = ms_palette(inkColor, toneColor, hueShift, depth);
    var field: vec3f = ms_lit(pal, e, glow, 0.0, 1.0, 0.34);
    var inkLin: vec3f = ms_srgb_to_linear(vec3f(inkColor.rgb));
    return ms_finish(field, inkLin, ms_containment(uv, 0.58), position, pixelScale);
}

fn ms_cipher(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var reveal: f32 = clamp(c0, 0.0, 1.0);
    var structure: f32 = clamp(c1, 0.0, 1.0);
    var dwell: f32 = clamp(c2, 0.0, 1.0);
    var scatter: f32 = clamp(c3, 0.0, 1.0);
    var orb: MSOrb = ms_orb(uv, vec2f(0.0), 0.335);
    var st: MSState = ms_state(stateIndex, stateTau);
    var P: vec3f = ms_spin(orb.p, t * 0.085, 0.16);
    var lat: f32 = ms_fbm3((P * (2.60 / S)) + vec3f(0.0, 0.0, t * 0.072), 4, 2.03, 0.52);
    var lobes: f32 = clamp(0.5 + (1.15 * lat), 0.0, 1.0);
    var crease: f32 = 1.0 - clamp(abs(lat) * 2.30, 0.0, 1.0);
    var psi: f32 = mix(lobes, crease, structure);
    var rate: f32 = mix(1.05, 0.38, dwell) * ((1.0 + (0.70 * st.drive)) + (0.55 * clamp(activity, 0.0, 1.0)));
    var tr: f32 = mix(1.05, 0.38, dwell) * ((t + (0.70 * sig.driveT)) + (0.55 * sig.activityT));
    var fLook: vec4f = ms_flourish(t, 21.0);
    var lookA: f32 = fLook.z * 6.2831853;
    var axA: f32 = (tr * 0.55) + ((fLook.x * 0.55) * cos(lookA));
    var axB: f32 = (0.55 + (0.42 * sin(tr * 0.31))) + ((fLook.x * 0.35) * sin(lookA));
    var A: vec3f = normalize(vec3f(cos(axA) * cos(axB), sin(axA) * cos(axB), sin(axB)));
    var arcW: f32 = mix(0.150, 0.230, dwell);
    var ad: f32 = dot(P, A) / arcW;
    var att: f32 = exp(-ad * ad) * orb.limb;
    var thr: f32 = mix(0.72, 0.30, clamp(((reveal * att) + (scatter * 0.18)) + (st.complete * 0.95), 0.0, 1.0));
    var e: f32 = smoothstep(thr, thr + 0.34, psi);
    e = max(e, (0.10 + (0.30 * scatter)) * smoothstep(0.38, 0.92, psi));
    e = max(e, (att * (0.52 + (0.62 * reveal))) * (0.55 + (0.45 * psi)));
    var pal: MSPalette = ms_palette(inkColor, toneColor, hueShift, depth);
    e *= orb.m * (0.55 + (0.45 * orb.lit));
    var field: vec3f = ms_lit(pal, (e * 1.30) * ((1.0 + (0.42 * st.complete)) + (0.14 * st.settled)), glow, 0.0, 1.0, 0.30);
    var inkLin: vec3f = ms_srgb_to_linear(vec3f(inkColor.rgb));
    return ms_finish(field, inkLin, ms_containment(uv, 0.60), position, pixelScale);
}

fn ms_tuning(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var band: f32 = clamp(c0, 0.0, 1.0);
    var lock: f32 = clamp(c1, 0.0, 1.0);
    var hiss: f32 = clamp(c2, 0.0, 1.0);
    var drift: f32 = clamp(c3, 0.0, 1.0);
    var st: MSState = ms_state(stateIndex, stateTau);
    var tau: f32 = max(time - epoch, 0.0);
    var law: vec3f = ms_settle_law(tau, 6.0);
    var arc: f32 = clamp(max(1.0 - law.z, st.complete), 0.0, 1.0);
    var scroll: f32 = ((law.y * 1.90) * max(speed, 0.0)) * (1.0 + (0.85 * st.drive));
    var orb: MSOrb = ms_orb(uv, vec2f(0.0), 0.335);
    var P: vec3f = ms_spin(orb.p, (t * 0.14) * (1.0 + (0.9 * st.drive)), 0.0);
    var pole: vec3f = normalize(vec3f(0.16, 0.97, 0.18));
    var pe1: vec3f = normalize(cross(pole, vec3f(0.0, 0.0, 1.0)));
    var pe2: vec3f = cross(pole, pe1);
    var lon: f32 = atan2(dot(P, pe2), dot(P, pe1));
    var needle: f32 = (ms_fbm1((lon * 1.30) + (t * (0.170 + (0.30 * st.drive))), 3, 17.0) * (0.030 + (0.085 * drift))) * (1.0 - (0.95 * st.complete));
    var across: f32 = dot(P, pole) - needle;
    var fSlip: vec4f = ms_flourish(t, 30.0);
    var slip: f32 = fSlip.x;
    across += ((slip * ((fSlip.z * 2.0) - 1.0)) * 0.085) * (1.0 - st.complete);
    var sigma: f32 = (mix(0.62, mix(0.165, 0.062, lock), arc) * (1.0 + (0.60 * slip))) * (1.0 - (0.45 * st.complete));
    var prof: f32 = exp(-(across * across) / (sigma * sigma)) * orb.limb;
    var centre: f32 = 0.20 + (1.70 * band);
    var width: f32 = mix(2.30, 0.52, arc);
    var xs: f32 = mix(1.0, 0.08, arc);
    var f0: f32 = mix(2.2, 5.2, band);
    var acc: f32 = 0.0;
    var wsum: f32 = 0.0;
    for (var i: i32 = 0; i < 4; i++) {
        var oct: f32 = exp2(f32(i));
        var d: f32 = (f32(i) - centre) / width;
        var w: f32 = exp(-d * d) * ms_aa(((6.2831853 * f0) * oct) / S, size, pixelScale);
        var sp: vec3f = vec3f(dot(P, pe1) * xs, dot(P, pole), dot(P, pe2) * xs) * ((f0 * oct) / S);
        acc += w * ms_noise3(sp + vec3f(0.0, 0.0, (scroll * (0.42 + (0.30 * f32(i)))) + (f32(i) * 19.0)));
        wsum += w;
    }
    var v: f32 = acc / max(wsum, 1e-4);
    var v01: f32 = clamp(0.5 + (1.30 * v), 0.0, 1.0);
    var station: f32 = ((prof * (0.58 + (0.42 * v01))) * orb.lit) * (1.0 + (0.55 * clamp(level, 0.0, 1.0)));
    var spread: f32 = (mix(1.0, mix(0.30, 0.12, lock), arc) * 0.42) * v01;
    var hz: f32 = ms_noise3((P * (8.5 / S)) + vec3f(0.0, 0.0, (scroll * 1.7) + 41.0));
    var floorHiss: f32 = ((hiss * mix(0.42, 0.27, arc)) * (0.12 + (0.88 * (0.5 + hz)))) * ms_aa((6.2831853 * 8.5) / S, size, pixelScale);
    var bodyAmb: f32 = ((0.20 * orb.limb) * orb.lit) * (0.55 + (0.45 * v01));
    var e: f32 = (((((station * mix(0.42, 0.98, arc)) + bodyAmb) + (((spread + floorHiss) * orb.limb) * orb.lit)) * orb.m) * 1.20) * ((1.0 + (0.40 * st.complete)) + (0.15 * st.settled));
    var pal: MSPalette = ms_palette(inkColor, toneColor, hueShift, depth);
    var field: vec3f = ms_lit(pal, e, glow, 0.0, 1.0, 0.34);
    var inkLin: vec3f = ms_srgb_to_linear(vec3f(inkColor.rgb));
    return ms_finish(field, inkLin, ms_containment(uv, 0.58), position, pixelScale);
}

fn ms_current(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var pathways: f32 = clamp(c0, 0.0, 1.0);
    var pulseRate: f32 = clamp(c1, 0.0, 1.0);
    var afterglow: f32 = clamp(c2, 0.0, 1.0);
    var branch: f32 = clamp(c3, 0.0, 1.0);
    var st: MSState = ms_state(stateIndex, stateTau);
    var orb: MSOrb = ms_orb(uv, vec2f(0.0), 0.335);
    var P: vec3f = ms_spin(orb.p, (t * 0.20) * (1.0 + (0.85 * st.drive)), 0.19);
    var bw: f32 = 0.052 + (0.030 * pathways);
    var N0: vec3f = normalize(vec3f(0.10, 0.96, 0.26));
    var N1: vec3f = normalize(vec3f(0.78, 0.42, 0.47));
    var N2: vec3f = normalize(vec3f(-0.62, 0.55, 0.56));
    var N3: vec3f = normalize(vec3f(0.30, -0.28, 0.91));
    var g0: f32 = 1.0 - smoothstep(bw * 0.35, bw * 1.30, abs(dot(P, N0)));
    var g1: f32 = 1.0 - smoothstep(bw * 0.30, bw * 0.95, abs(dot(P, N1)));
    var g2: f32 = 1.0 - smoothstep(bw * 0.28, bw * 0.88, abs(dot(P, N2)));
    var g3: f32 = 1.0 - smoothstep(bw * 0.26, bw * 0.80, abs(dot(P, N3)));
    var tree: f32 = max(max(g0, g1 * (0.72 + (0.28 * branch))), max(g2 * (0.60 + (0.40 * branch)), g3 * (0.50 + (0.50 * branch))));
    tree *= orb.limb;
    var fq: f32 = mix(1.70, 3.30, pathways);
    var pm: vec3f = (P * (fq / S)) + vec3f(0.0, 0.0, t * 0.068);
    var n: f32 = ms_fbm3(pm, 3, 2.03, 0.55);
    var chan: f32 = tree * (0.62 + (0.52 * clamp(0.5 + (1.30 * n), 0.0, 1.0)));
    var halo: f32 = clamp(0.5 + (1.15 * ms_fbm3((pm * 0.55) + 13.0, 2, 2.00, 0.50)), 0.0, 1.0);
    var bend: f32 = ms_fbm3((P * (1.15 / S)) + vec3f(0.0, 0.0, t * 0.045), 2, 2.00, 0.50);
    var straight: f32 = 4.20 * (1.0 + (1.05 * st.drive));
    var bendAmt: f32 = (9.00 * (1.0 - (0.45 * st.drive))) * (1.0 - (0.88 * st.complete));
    var e1: vec3f = normalize(cross(N0, vec3f(0.0, 0.0, 1.0)));
    var e2: vec3f = cross(N0, e1);
    var phase: f32 = ((atan2(dot(P, e2), dot(P, e1)) * straight) * 0.42) + (bend * bendAmt);
    var rate: f32 = mix(0.57, 2.35, pulseRate) * ((1.0 + (0.80 * st.drive)) + (0.90 * clamp(level, 0.0, 1.0)));
    var tr: f32 = mix(0.57, 2.35, pulseRate) * ((t + (0.80 * sig.driveT)) + (0.90 * sig.levelT));
    var fSurge: vec4f = ms_flourish(t, 44.0);
    var surgeA: f32 = fSurge.z * 6.2831853;
    var sc3: vec3f = normalize(vec3f(cos(surgeA) * 0.72, sin(surgeA) * 0.72, 0.50));
    var sz: f32 = length(P - sc3) / 0.62;
    var th: f32 = (phase - (tr * 2.0)) - ((fSurge.x * exp(-sz * sz)) * 3.40);
    var skew: f32 = th + (0.55 * sin(th));
    var k: f32 = mix(3.40, 1.50, afterglow);
    var pulse: f32 = exp(k * (cos(skew) - 1.0));
    var bodyAmb: f32 = (0.13 * orb.limb) * (0.55 + (0.45 * clamp(0.5 + (1.30 * n), 0.0, 1.0)));
    var e: f32 = ((((((bodyAmb + (chan * (0.26 + (0.34 * chan)))) + ((chan * pulse) * 1.15)) + ((((afterglow * 0.30) * halo) * pulse) * chan)) * 1.34) * orb.m) * orb.lit) * ((1.0 + (0.70 * st.complete)) + (0.16 * st.settled));
    var pal: MSPalette = ms_palette(inkColor, toneColor, hueShift, depth);
    var field: vec3f = ms_lit(pal, e, glow, 0.0, 1.0, 0.34);
    var inkLin: vec3f = ms_srgb_to_linear(vec3f(inkColor.rgb));
    return ms_finish(field, inkLin, ms_containment(uv, 0.60), position, pixelScale);
}

fn ms_veil(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var layers: f32 = clamp(c0, 0.0, 1.0);
    var parallax: f32 = clamp(c1, 0.0, 1.0);
    var legibility: f32 = clamp(c2, 0.0, 1.0);
    var drift: f32 = clamp(c3, 0.0, 1.0);
    var st: MSState = ms_state(stateIndex, stateTau);
    var orb: MSOrb = ms_orb(uv, vec2f(0.0), 0.335);
    var sep: f32 = 0.30 + (0.70 * layers);
    var base: f32 = (0.210 + (0.420 * drift)) * ((1.0 + (1.00 * st.drive)) + (0.70 * clamp(activity, 0.0, 1.0)));
    var baseT: f32 = (0.210 + (0.420 * drift)) * ((t + (1.00 * sig.driveT)) + (0.70 * sig.activityT));
    var fPart: vec4f = ms_flourish(t, 57.0);
    var r: f32 = length(uv);
    var acc: f32 = 0.0;
    var T: f32 = 1.0;
    for (var i: i32 = 0; i < 3; i++) {
        var fi: f32 = f32(i);
        var far: f32 = fi * 0.5;
        var Ri: f32 = (0.335 * (1.0 - ((0.280 * fi) * sep))) * (1.0 + ((fPart.x * 0.085) * (1.0 - fi)));
        var rr: f32 = r / Ri;
        var inside: f32 = 1.0 - smoothstep(0.94, 1.01, rr);
        var zz: f32 = sqrt(max(1.0 - min(rr * rr, 1.0), 0.0));
        var path: f32 = min(1.0 / sqrt(max(1.0 - min(rr * rr, 1.0), 0.045)), 4.7) / 4.7;
        var rate: f32 = base / (1.0 + ((2.10 * fi) * parallax));
        var Ps: vec3f = ms_spin(vec3f(uv / Ri, zz), ((baseT / (1.0 + ((2.10 * fi) * parallax))) * 2.6) + (fi * 1.7), 0.14 + (0.22 * fi));
        var f: f32 = (1.75 * (1.0 + ((0.85 * fi) * sep))) / S;
        var n: f32 = ms_fbm3((Ps * f) + vec3f(0.0, 0.0, (t * 0.030) + (fi * 7.3)), 2, 2.03, 0.50);
        var d: f32 = clamp(0.5 + (1.35 * n), 0.0, 1.0);
        var contrast: f32 = mix(0.55, 1.45 + (0.80 * legibility), far);
        var lum: f32 = mix(0.78, 0.44, far) * clamp(((d - 0.5) * contrast) + 0.5, 0.0, 1.0);
        var opacity: f32 = mix(0.72, 0.48, far) * (1.0 - (0.34 * legibility));
        var alpha: f32 = ((inside * opacity) * (0.30 + (0.70 * path))) * (0.55 + (0.45 * d));
        acc += ((lum * (0.55 + (1.35 * path))) * alpha) * T;
        T *= 1.0 - alpha;
    }
    var Pc: vec3f = ms_spin(orb.p, t * 0.11, 0.10);
    var cr: f32 = r / 0.150;
    var core: f32 = (1.0 - smoothstep(0.55, 1.05, cr)) * (0.62 + (0.38 * clamp(0.5 + (1.60 * ms_fbm3((Pc * (3.2 / S)) + vec3f(0.0, 0.0, t * 0.039), 2, 2.03, 0.50)), 0.0, 1.0)));
    var coreLight: f32 = core * (0.42 + (0.34 * legibility));
    acc += coreLight * T;
    acc += ((coreLight * (1.0 - T)) * st.complete) * 0.90;
    var e: f32 = ((acc * 2.35) * orb.lit) * ((1.0 + (0.34 * st.complete)) + (0.14 * st.settled));
    var pal: MSPalette = ms_palette(inkColor, toneColor, hueShift, depth);
    var field: vec3f = ms_lit(pal, e, glow, 0.0, 1.0, 0.34);
    var inkLin: vec3f = ms_srgb_to_linear(vec3f(inkColor.rgb));
    return ms_finish(field, inkLin, ms_containment(uv, 0.62), position, pixelScale);
}

fn ms_echo(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var repeats: f32 = clamp(c0, 0.0, 1.0);
    var decay: f32 = clamp(c1, 0.0, 1.0);
    var offset: f32 = clamp(c2, 0.0, 1.0);
    var blur: f32 = clamp(c3, 0.0, 1.0);
    var st: MSState = ms_state(stateIndex, stateTau);
    var phi: f32 = (t * 0.42) * (1.0 + (0.90 * st.drive));
    var wander: vec2f = 0.105 * vec2f(cos(phi), sin(phi));
    var dir: vec2f = vec2f(-sin(phi), cos(phi));
    var step_: f32 = (0.125 + (0.130 * offset)) * (1.0 - (0.92 * st.complete));
    var lag: f32 = 0.22 + (0.55 * offset);
    var live: f32 = (1.2 + (2.8 * repeats)) + (1.10 * clamp(level, 0.0, 1.0));
    var fNear: vec4f = ms_flourish(t, 66.0);
    var acc: f32 = 0.0;
    for (var i: i32 = 0; i < 4; i++) {
        var k: f32 = f32(i);
        var near: f32 = select(0.0, fNear.x, abs(k - (1.0 + floor(fNear.z * 3.0))) < 0.5);
        var c: vec2f = wander - (dir * ((step_ * k) * (1.0 - (0.55 * near))));
        var Rk: f32 = 0.205 * (1.0 - (0.070 * k));
        var gk: MSOrb = ms_orb(uv, c, Rk);
        var tk: f32 = t - (lag * k);
        var Pk: vec3f = ms_spin(gk.p, tk * 0.30, 0.17);
        var d: f32 = 0.5 + (1.35 * ms_fbm3((Pk * (2.35 / S)) + vec3f(0.0, 0.0, tk * 0.105), 2, 2.03, 0.55));
        var w: f32 = ((0.20 + ((0.24 + (0.52 * blur)) * k)) * (1.0 - (0.26 * near))) * (1.0 - (0.55 * st.complete));
        var mass: f32 = smoothstep(0.56 - w, 0.56 + w, d);
        acc += ((((((0.34 + (0.66 * mass)) * gk.m) * gk.limb) * gk.lit) * 1.42) * pow(mix(0.86, 0.46, decay), k)) * smoothstep(0.0, 1.0, live - k);
    }
    var pal: MSPalette = ms_palette(inkColor, toneColor, hueShift, depth);
    var field: vec3f = ms_lit(pal, acc * ((1.0 + (0.62 * st.complete)) + (0.16 * st.settled)), glow, 0.0, 1.0, 0.32);
    var inkLin: vec3f = ms_srgb_to_linear(vec3f(inkColor.rgb));
    return ms_finish(field, inkLin, ms_containment(uv, 0.60), position, pixelScale);
}

fn ms_glyph(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var marks: f32 = clamp(c0, 0.0, 1.0);
    var formation: f32 = clamp(c1, 0.0, 1.0);
    var dissolve: f32 = clamp(c2, 0.0, 1.0);
    var ink: f32 = clamp(c3, 0.0, 1.0);
    var st: MSState = ms_state(stateIndex, stateTau);
    var orb: MSOrb = ms_orb(uv, vec2f(0.0), 0.335);
    var P: vec3f = ms_spin(orb.p, t * (0.10 + (0.34 * st.drive)), 0.15);
    var ang: f32 = (2.80 * ms_fbm3((P * (0.55 / S)) + vec3f(0.0, 0.0, t * 0.052), 2, 2.00, 0.50)) + 0.50;
    var T1: vec3f = normalize(cross(P, vec3f(0.0, 0.0, 1.0)) + vec3f(1e-4, 0.0, 0.0));
    var T2: vec3f = cross(P, T1);
    var dirv: vec3f = (cos(ang) * T1) + (sin(ang) * T2);
    var perp: vec3f = (-sin(ang) * T1) + (cos(ang) * T2);
    var fWord: vec4f = ms_flourish(t, 73.0);
    var wordA: f32 = fWord.z * 6.2831853;
    var wc: vec3f = normalize(vec3f(cos(wordA) * 0.66, sin(wordA) * 0.66, 0.60));
    var wz: f32 = length(P - wc) / 0.62;
    var word: f32 = fWord.x * exp(-wz * wz);
    var scz: f32 = length(P - normalize(vec3f(-0.12, 0.06, 0.98))) / 0.60;
    var arrive: f32 = st.complete * exp(-scz * scz);
    var alongC: f32 = (0.14 * (1.0 - (0.45 * word))) * (1.0 - (0.52 * arrive));
    var fq: f32 = ((1.50 + (2.40 * marks)) * 1.15) / S;
    var sp: vec3f = P * fq;
    sp -= dirv * (dot(sp, dirv) * (1.0 - alongC));
    var m: f32 = ms_fbm3(sp + vec3f(0.0, 0.0, t * 0.115), 2, 2.03, 0.52);
    var K: f32 = (5.5 + (7.0 * marks)) / S;
    var band: f32 = 0.5 + (0.5 * sin((dot(P, perp) * K) + (m * 3.4)));
    var stroke: f32 = pow(band, mix(3.4, 1.9, ink));
    var core: f32 = pow(band, mix(11.0, 7.0, ink));
    var bleed: f32 = (pow(band, 1.35) * 0.20) * ink;
    var L: f32 = 0.5 + (1.90 * ms_fbm3((P * (1.60 / S)) + vec3f(0.0, 0.0, ((0.300 * t) + (0.34 * sig.driveT)) + (0.45 * sig.activityT)), 2, 2.00, 0.50));
    var peak: f32 = 0.30 + (0.30 * formation);
    var w2: f32 = mix(0.20, 0.12, dissolve);
    var rise: f32 = smoothstep(peak - 0.16, peak + 0.10, L);
    var fall: f32 = 1.0 - smoothstep(((peak - (w2 * 0.50)) + (0.060 * word)) + (0.110 * arrive), ((peak + w2) + (0.100 * word)) + (0.260 * arrive), L);
    var presence: f32 = max(rise * fall, 0.11 * smoothstep(0.10, 0.45, L));
    var bodyAmb: f32 = (0.15 * orb.limb) * (0.55 + (0.45 * band));
    var en: f32 = (((bodyAmb + ((((stroke * (0.62 + (0.48 * ink))) + (core * 0.75)) + bleed) * presence)) * orb.m) * orb.lit) * 1.85;
    var pal: MSPalette = ms_palette(inkColor, toneColor, hueShift, depth);
    var field: vec3f = ms_lit(pal, (en * 1.70) * ((1.0 + (0.26 * st.complete)) + (0.13 * st.settled)), glow, 0.0, 1.0, 0.32);
    var inkLin: vec3f = ms_srgb_to_linear(vec3f(inkColor.rgb));
    return ms_finish(field, inkLin, ms_containment(uv, 0.58), position, pixelScale);
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

@fragment fn fs_murmuration(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = ms_murmuration(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_loom(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = ms_loom(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_cipher(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = ms_cipher(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_tuning(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = ms_tuning(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_current(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = ms_current(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_veil(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = ms_veil(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_echo(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = ms_echo(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_glyph(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = ms_glyph(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, sig);
    return orb_clip(pos, c.rgb);
}
