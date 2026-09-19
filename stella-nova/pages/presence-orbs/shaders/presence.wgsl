// Orb shader pack. WGSL, WebGPU.
// Derived from the Metal shaders of the MIT-licensed "murmur" package
// (c) Kris Puckett; ported function-for-function. MIT notice retained.
const M_PI_F: f32 = 3.14159265358979;

fn mq_hash(v: vec3u) -> u32 {
    var h: u32 = ((v.x * 1597334673u) ^ (v.y * 3812015801u)) ^ (v.z * 2798796415u);
    h ^= h >> 15u;
    h *= 2246822519u;
    h ^= h >> 13u;
    h *= 3266489917u;
    h ^= h >> 16u;
    return h;
}

fn mq_grad3(c: vec3i) -> vec3f {
    var h: u32 = mq_hash(vec3u(c + 4096));
    var z: f32 = fma(f32(h & 0xFFFFu), 2.0 / 65535.0, -1.0);
    var a: f32 = f32((h >> 16u) & 0xFFFFu) * (6.28318530718 / 65536.0);
    var r: f32 = sqrt(max(0.0, 1.0 - (z * z)));
    return vec3f(r * cos(a), r * sin(a), z);
}

fn mq_noise3(p: vec3f) -> f32 {
    var i: vec3f = floor(p);
    var f: vec3f = p - i;
    var u: vec3f = ((f * f) * f) * ((f * ((f * 6.0) - 15.0)) + 10.0);
    var c: vec3i = vec3i(i);
    var va: f32 = dot(mq_grad3(c + vec3i(0, 0, 0)), f - vec3f(0.0, 0.0, 0.0));
    var vb: f32 = dot(mq_grad3(c + vec3i(1, 0, 0)), f - vec3f(1.0, 0.0, 0.0));
    var vc: f32 = dot(mq_grad3(c + vec3i(0, 1, 0)), f - vec3f(0.0, 1.0, 0.0));
    var vd: f32 = dot(mq_grad3(c + vec3i(1, 1, 0)), f - vec3f(1.0, 1.0, 0.0));
    var ve: f32 = dot(mq_grad3(c + vec3i(0, 0, 1)), f - vec3f(0.0, 0.0, 1.0));
    var vf: f32 = dot(mq_grad3(c + vec3i(1, 0, 1)), f - vec3f(1.0, 0.0, 1.0));
    var vg: f32 = dot(mq_grad3(c + vec3i(0, 1, 1)), f - vec3f(0.0, 1.0, 1.0));
    var vh: f32 = dot(mq_grad3(c + vec3i(1, 1, 1)), f - vec3f(1.0, 1.0, 1.0));
    return mix(mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y), mix(mix(ve, vf, u.x), mix(vg, vh, u.x), u.y), u.z);
}

const MQ_ROT: mat3x3f = mat3x3f(vec3f(0.00, 0.80, 0.60), vec3f(-0.80, 0.36, -0.48), vec3f(-0.60, -0.48, 0.64));

fn mq_fbm3(p: vec3f, octaves: i32, lacunarity: f32, gain: f32) -> f32 {
    var q: vec3f = p;
    var amp: f32 = 0.5;
    var value: f32 = 0.0;
    for (var i: i32 = 0; i < octaves; i++) {
        value += amp * mq_noise3(q);
        amp *= gain;
        q = lacunarity * (MQ_ROT * q);
    }
    return value;
}

fn mq_hash1(cell: f32, lane: f32) -> f32 {
    return f32(mq_hash(vec3u(u32(i32(cell) + 32768), u32(i32(lane) + 32768), 0x9E3779B9u)) >> 8u) * (1.0 / 16777216.0);
}

fn mq_vnoise1(x: f32, lane: f32) -> f32 {
    var i: f32 = floor(x);
    var f: f32 = x - i;
    var u: f32 = ((f * f) * f) * ((f * ((f * 6.0) - 15.0)) + 10.0);
    return (mix(mq_hash1(i, lane), mq_hash1(i + 1.0, lane), u) * 2.0) - 1.0;
}

fn mq_fbm1(x: f32, octaves: i32, lane: f32) -> f32 {
    var v: f32 = 0.0;
    var amp: f32 = 0.5;
    var f: f32 = 1.0;
    for (var i: i32 = 0; i < octaves; i++) {
        v += amp * mq_vnoise1(x * f, lane + (f32(i) * 37.0));
        amp *= 0.5;
        f *= 2.03;
    }
    return v;
}

fn mq_srgb_to_linear(c: vec3f) -> vec3f {
    var c_p: vec3f = c;
    c_p = max(c_p, vec3f(0.0));
    return select(c_p * (1.0 / 12.92), pow((c_p + 0.055) * (1.0 / 1.055), vec3f(2.4)), c_p > vec3f(0.04045));
}

fn mq_linear_to_srgb(c: vec3f) -> vec3f {
    var c_p: vec3f = c;
    c_p = max(c_p, vec3f(0.0));
    return select(c_p * 12.92, (1.055 * pow(c_p, vec3f(1.0 / 2.4))) - 0.055, c_p > vec3f(0.0031308));
}

fn mq_linear_to_oklab(c: vec3f) -> vec3f {
    var l: f32 = ((0.4122214708 * c.r) + (0.5363325363 * c.g)) + (0.0514459929 * c.b);
    var m: f32 = ((0.2119034982 * c.r) + (0.6806995451 * c.g)) + (0.1073969566 * c.b);
    var s: f32 = ((0.0883024619 * c.r) + (0.2817188376 * c.g)) + (0.6299787005 * c.b);
    var l_: f32 = pow(max(l, 0.0), 1.0 / 3.0);
    var m_: f32 = pow(max(m, 0.0), 1.0 / 3.0);
    var s_: f32 = pow(max(s, 0.0), 1.0 / 3.0);
    return vec3f(((0.2104542553 * l_) + (0.7936177850 * m_)) - (0.0040720468 * s_), ((1.9779984951 * l_) - (2.4285922050 * m_)) + (0.4505937099 * s_), ((0.0259040371 * l_) + (0.7827717662 * m_)) - (0.8086757660 * s_));
}

fn mq_oklab_to_linear(lab: vec3f) -> vec3f {
    var l_: f32 = (lab.x + (0.3963377774 * lab.y)) + (0.2158037573 * lab.z);
    var m_: f32 = (lab.x - (0.1055613458 * lab.y)) - (0.0638541728 * lab.z);
    var s_: f32 = (lab.x - (0.0894841775 * lab.y)) - (1.2914855480 * lab.z);
    var l: f32 = (l_ * l_) * l_;
    var m: f32 = (m_ * m_) * m_;
    var s: f32 = (s_ * s_) * s_;
    return vec3f(((4.0767416621 * l) - (3.3077115913 * m)) + (0.2309699292 * s), ((-1.2684380046 * l) + (2.6097574011 * m)) - (0.3413193965 * s), ((-0.0041960863 * l) - (0.7034186147 * m)) + (1.7076147010 * s));
}

fn mq_lch(L: f32, C: f32, h: f32) -> vec3f {
    return vec3f(L, C * cos(h), C * sin(h));
}

struct MQPalette {
    s0: vec3f,
    s1: vec3f,
    s2: vec3f,
    s3: vec3f
}

fn mq_palette(inkColor: vec4f, toneColor: vec4f, hueShift: f32, depth: f32) -> MQPalette {
    var ink: vec3f = mq_linear_to_oklab(mq_srgb_to_linear(vec3f(inkColor.rgb)));
    var tone: vec3f = mq_linear_to_oklab(mq_srgb_to_linear(vec3f(toneColor.rgb)));
    var L: f32 = tone.x;
    var C: f32 = length(tone.yz);
    var h: f32 = atan2(tone.z, tone.y) + hueShift;
    var d: f32 = clamp(depth, 0.30, 2.00);
    var p: MQPalette;
    p.s0 = ink;
    p.s1 = mq_lch(mix(ink.x, L, 0.30 / d), C * (0.52 + (0.10 * d)), h - 0.35);
    p.s2 = mq_lch(L, C, h);
    p.s3 = mq_lch(min(L * (1.20 + (0.12 * d)), 0.93), C * 0.55, h + 0.10);
    return p;
}

fn mq_shade(p: MQPalette, t: f32) -> vec3f {
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
    return mq_oklab_to_linear(lab);
}

fn mq_out(linearRGB: vec3f, pixel: vec2f) -> vec4f {
    var c: vec3f = mq_linear_to_srgb(linearRGB);
    var n: f32 = fract(52.9829189 * fract(dot(pixel, vec2f(0.06711056, 0.00583715))));
    var tri: f32 = select(1.0 - sqrt(max(0.0, 2.0 - (2.0 * n))), sqrt(2.0 * n) - 1.0, n < 0.5);
    c += vec3f(tri * (1.0 / 255.0));
    return vec4f(vec3f(saturate(c)), 1.0);
}

fn mq_knee(x: f32, knee: f32) -> f32 {
    return select(knee + ((1.0 - knee) * (1.0 - exp(-(x - knee) / max(1.0 - knee, 1e-3)))), x, x < knee);
}

fn mq_containment(uv: vec2f, reach: f32) -> f32 {
    var r: f32 = length(uv) * 2.0;
    return 1.0 - smoothstep(reach, reach + 0.31, r);
}

fn mq_tier(e: f32) -> f32 {
    var x: f32 = clamp(e, 0.0, 1.0);
    const K: f32 = 0.78;
    var body: f32 = (x / K) * 0.72;
    var peak: f32 = 0.72 + (((x - K) / (1.0 - K)) * 0.28);
    return mix(body, peak, smoothstep(K - 0.10, K + 0.10, x));
}

fn mq_lit(pal: MQPalette, e: f32, glow: f32, base: f32, span: f32, emis: f32) -> vec3f {
    var G: f32 = max(glow, 0.0);
    var en: f32 = clamp(mq_knee(max(e, 0.0) * (0.35 + (0.65 * G)), 0.92), 0.0, 1.0);
    var tRail: f32 = clamp(base + (span * mq_tier(en)), 0.0, 1.0);
    var col: vec3f = mq_shade(pal, tRail);
    return col * (1.0 + ((emis * G) * smoothstep(0.72, 1.0, tRail)));
}

fn mq_aa(cycles: f32, size: vec2f, pixelScale: f32) -> f32 {
    var px: f32 = max(min(size.x, size.y), 1.0) * max(pixelScale, 1.0);
    var perPixel: f32 = max(cycles, 0.0) / (6.2831853 * px);
    return 1.0 - smoothstep(0.16, 0.36, perPixel);
}

struct MQBall {
    s: vec2f,
    z: f32,
    p: vec3f,
    m: f32,
    limb: f32,
    lit: f32
}

fn mq_ball(uv: vec2f, R: f32) -> MQBall {
    var o: MQBall;
    o.s = uv / max(R, 1e-3);
    var r2: f32 = dot(o.s, o.s);
    o.z = sqrt(max(1.0 - min(r2, 1.0), 0.0));
    o.p = vec3f(o.s, o.z);
    o.m = 1.0 - smoothstep(0.93, 1.02, sqrt(r2));
    o.limb = pow(clamp(o.z, 0.0, 1.0), 0.55);
    o.lit = 0.42 + (0.58 * clamp(dot(o.p, vec3f(-0.40, 0.47, 0.79)), 0.0, 1.0));
    return o;
}

fn mq_spin(p: vec3f, ay: f32, ax: f32) -> vec3f {
    var ca: f32 = cos(ay);
    var sa: f32 = sin(ay);
    var q: vec3f = vec3f((ca * p.x) + (sa * p.z), p.y, (-sa * p.x) + (ca * p.z));
    var cb: f32 = cos(ax);
    var sb: f32 = sin(ax);
    return vec3f(q.x, (cb * q.y) - (sb * q.z), (sb * q.y) + (cb * q.z));
}

fn mq_finish(field: vec3f, inkLin: vec3f, containment: f32, position: vec2f, pixelScale: f32) -> vec4f {
    var rgb: vec3f = mix(inkLin, field, containment);
    rgb = vec3f(mq_knee(rgb.r, 0.90), mq_knee(rgb.g, 0.90), mq_knee(rgb.b, 0.90));
    return mq_out(rgb, position * pixelScale);
}


// Integrated live signals, supplied by the runtime (∫ over the shader's own
// clock). voiceT/paceT are ∫ of the mh_live/mq_live-shaped signals, vdT/pdT
// their products with the responding drive, levelT/activityT the raw signals.
struct LiveSig {
    voiceT: f32, paceT: f32, driveT: f32, vdT: f32, pdT: f32, levelT: f32, activityT: f32
}
struct MQLive {
    voice: f32,
    pace: f32
}

fn mq_live(level: f32, activity: f32, stateIndex: f32) -> MQLive {
    var o: MQLive;
    var L: f32 = clamp(level, 0.0, 1.0);
    var A: f32 = clamp(activity, 0.0, 1.0);
    var listening: f32 = select(0.0, 1.0, (stateIndex > 0.5) && (stateIndex < 1.5));
    var working: f32 = select(0.0, 1.0, (stateIndex > 1.5) && (stateIndex < 3.5));
    o.voice = pow(L, 0.65) * mix(0.55, 1.00, listening);
    o.pace = pow(A, 0.85) * mix(0.60, 1.00, working);
    return o;
}

fn mq_small(size: vec2f) -> f32 {
    return 1.0 - smoothstep(16.0, 88.0, max(min(size.x, size.y), 1.0));
}

fn mq_tiny(size: vec2f) -> f32 {
    return 1.0 - smoothstep(20.0, 38.0, max(min(size.x, size.y), 1.0));
}

fn mq_ring_noise(ang: f32, freq: f32, drift: f32) -> f32 {
    return mq_noise3(vec3f(cos(ang) * freq, sin(ang) * freq, drift));
}

struct MQState {
    complete: f32,
    sweep: f32,
    settled: f32,
    drive: f32
}

fn mq_state(stateIndex: f32, stateTau: f32) -> MQState {
    var o: MQState;
    o.complete = 0.0;
    o.sweep = 0.0;
    o.settled = 0.0;
    o.drive = 0.0;
    var tau: f32 = max(stateTau, 0.0);
    if ((stateIndex > 3.5) && (stateIndex < 4.5)) {
        var a: f32 = clamp(tau / 1.20, 0.0, 1.0);
        o.complete = smoothstep(0.0, 0.30, a) * (1.0 - smoothstep(0.36, 1.0, a));
        o.settled = smoothstep(0.30, 1.05, a);
        o.sweep = smoothstep(0.0, 1.0, clamp(tau / 0.95, 0.0, 1.0));
    } else if ((stateIndex > 2.5) && (stateIndex < 3.5)) {
        o.drive = smoothstep(0.0, 0.55, tau);
    }
    return o;
}

fn mq_flourish(t: f32, lane: f32) -> vec4f {
    const SLOT: f32 = 6.5;
    var slot: f32 = floor(t / SLOT);
    var local: f32 = t - (slot * SLOT);
    var start: f32 = 1.15 + (2.20 * mq_hash1(slot, lane));
    var dur: f32 = 1.60 + (1.40 * mq_hash1(slot + 811.0, lane));
    var u: f32 = (local - start) / dur;
    var sn: f32 = sin(3.14159265 * clamp(u, 0.0, 1.0));
    var env: f32 = select(sn * sn, 0.0, (u <= 0.0) || (u >= 1.0));
    return vec4f(env, clamp(u, 0.0, 1.0), mq_hash1(slot + 1607.0, lane), dur);
}

fn mq_halo(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var tiltK: f32 = clamp(c0, 0.0, 1.0);
    var thickK: f32 = clamp(c1, 0.0, 1.0);
    var waviness: f32 = clamp(c2, 0.0, 1.0);
    var shimmerK: f32 = clamp(c3, 0.0, 1.0);
    var st: MQState = mq_state(stateIndex, stateTau);
    var live: MQLive = mq_live(level, activity, stateIndex);
    var small: f32 = mq_small(size);
    var fl: vec4f = mq_flourish(t, 5.0);
    var lean: f32 = mix(0.34, 0.88, tiltK) * mix(1.0, 0.45, small);
    var tilt: f32 = ((0.22 + (0.72 * lean)) + ((0.10 * lean) * sin(t * 0.191))) + ((fl.x * 0.16) * lean);
    var cosT: f32 = max(cos(tilt), 0.16);
    var sinT: f32 = sin(tilt);
    var prec: f32 = 0.155 * (((t + (1.30 * sig.paceT)) + (1.10 * sig.driveT)) + (1.43 * sig.pdT));
    var cp: f32 = cos(prec);
    var sp: f32 = sin(prec);
    var q: vec2f = vec2f((cp * uv.x) + (sp * uv.y), (-sp * uv.x) + (cp * uv.y));
    var R: f32 = 0.290 * mix(1.0, 0.92, small);
    var a: f32 = R;
    var b: f32 = R * cosT;
    var e: vec2f = vec2f(q.x / a, q.y / b);
    var k: f32 = length(e);
    var phi: f32 = atan2(e.y, e.x);
    var ehat: vec2f = select(vec2f(1.0, 0.0), e / k, vec2<bool>(k > 1e-5));
    var gr: vec2f = vec2f(ehat.x / a, ehat.y / b);
    var dist: f32 = (k - 1.0) / max(length(gr), 1e-4);
    var hiHarm: f32 = mix(1.0, 0.22, small);
    var ws: f32 = (1.0 + (1.05 * live.pace)) + (0.85 * st.drive);
    var wu: f32 = ((0.55 * sin((2.0 * phi) - ((t * 0.75) * ws))) + ((0.32 * sin(((3.0 * phi) - ((t * 1.15) * ws)) + 1.7)) * hiHarm)) + ((0.20 * sin(((5.0 * phi) - ((t * 0.60) * ws)) + 4.1)) * hiHarm);
    var vA: f32 = 0.12 + (0.88 * live.voice);
    var disp: f32 = ((wu * vA) * (0.028 + (0.052 * waviness))) * mix(1.0, 0.75, small);
    var dRing: f32 = dist - disp;
    var th: f32 = mix(0.021, 0.032, thickK) * mix(1.0, 2.55, small);
    var core: f32 = exp(-(dRing * dRing) / (th * th));
    var bs: f32 = min(th * 3.1, 0.072);
    var bloom: f32 = exp(-(dRing * dRing) / (bs * bs));
    var crest: f32 = 1.0 + ((0.35 + (0.95 * live.voice)) * max(wu, 0.0));
    var sh: f32 = mq_ring_noise(phi - (t * 0.21), 2.4 / S, t * 0.11);
    var shim: f32 = (1.0 - (shimmerK * 0.42)) + ((shimmerK * 0.84) * clamp(0.5 + (1.3 * sh), 0.0, 1.0));
    var front: f32 = 0.64 + ((0.36 * sin(phi)) * sinT);
    var glint: f32 = fl.x * exp(2.6 * (cos((phi - (fl.z * 6.2831853)) - (fl.y * 6.2831853)) - 1.0));
    var lap: f32 = st.complete * (0.45 + (1.45 * exp(3.2 * (cos((phi - (st.sweep * 6.2831853)) - 1.1) - 1.0))));
    var ring: f32 = ((((core * ((1.0 + (1.15 * glint)) + lap)) + (bloom * 0.30)) * crest) * shim) * front;
    var air: f32 = ((1.0 - smoothstep(0.42, 1.04, k)) * (0.12 + (0.05 * waviness))) * (0.75 + (0.45 * cosT));
    var en: f32 = ((ring * 1.22) + air) * (1.0 + (0.30 * st.settled));
    var pal: MQPalette = mq_palette(inkColor, toneColor, hueShift, depth);
    var field: vec3f = mq_lit(pal, en, glow, 0.0, 1.0, 0.32);
    var inkLin: vec3f = mq_srgb_to_linear(vec3f(inkColor.rgb));
    return mq_finish(field, inkLin, mq_containment(uv, 0.62), position, pixelScale);
}

fn mq_nucleus(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var coreK: f32 = clamp(c0, 0.0, 1.0);
    var shellK: f32 = clamp(c1, 0.0, 1.0);
    var circK: f32 = clamp(c2, 0.0, 1.0);
    var swellK: f32 = clamp(c3, 0.0, 1.0);
    var st: MQState = mq_state(stateIndex, stateTau);
    var live: MQLive = mq_live(level, activity, stateIndex);
    var small: f32 = mq_small(size);
    var r: f32 = length(uv);
    var Rc: f32 = mix(0.052, 0.092, coreK) * mix(1.0, 1.50, small);
    var swell: f32 = (0.10 + (0.90 * live.voice)) * (0.35 + (0.65 * swellK));
    var Rs: f32 = ((mix(0.140, 0.215, shellK) * (1.0 + (0.38 * swell))) * (1.0 - (0.16 * st.drive))) * (1.0 - (0.74 * st.complete));
    var shear: f32 = 1.0 + (0.95 * (1.0 - clamp(r / max(Rs, 1e-3), 0.0, 1.0)));
    var spin: f32 = ((0.20 + (0.52 * circK)) * shear) * (((t + (1.25 * sig.paceT)) + (1.05 * sig.driveT)) + (1.3125 * sig.pdT));
    var cs: f32 = cos(spin);
    var sn: f32 = sin(spin);
    var ruv: vec2f = vec2f((cs * uv.x) - (sn * uv.y), (sn * uv.x) + (cs * uv.y));
    var rr: f32 = r / max(Rs, 1e-3);
    var zz: f32 = sqrt(max(1.0 - min(rr * rr, 1.0), 0.0));
    var P: vec3f = vec3f(ruv / max(Rs, 1e-3), zz);
    var oct: i32 = select(3, 2, small > 0.55);
    var n: f32 = mq_fbm3((P * (2.35 / S)) + vec3f(0.0, 0.0, t * 0.085), oct, 2.03, 0.52);
    var mistN: f32 = clamp(0.5 + (1.30 * n), 0.0, 1.0);
    var inner: f32 = smoothstep(Rc * 0.50, Rc * 1.55, r);
    var outer: f32 = 1.0 - smoothstep(Rs * 0.74, Rs * 1.26, r);
    var mist: f32 = ((inner * outer) * (0.26 + (0.74 * mistN))) * (0.52 + (0.95 * swell));
    var fl: vec4f = mq_flourish(t, 7.0);
    var pr: f32 = Rc + ((Rs - Rc) * fl.y);
    var pz: f32 = (r - pr) / max(Rs * 0.24, 1e-3);
    mist += ((fl.x * exp(-pz * pz)) * 0.42) * outer;
    var cz: f32 = (r - mix(0.215, Rc, st.sweep)) / max(Rs * 0.20, 1e-3);
    mist += (st.complete * exp(-cz * cz)) * 1.15;
    var core: f32 = exp(-pow(r / max(Rc, 1e-4), 1.85));
    var coreTex: f32 = 0.88 + (0.24 * clamp(0.5 + (1.4 * mq_noise3(vec3f(uv * (7.0 / S), t * 0.23))), 0.0, 1.0));
    var coreE: f32 = (core * coreTex) * ((1.0 + (0.55 * st.complete)) + (0.18 * st.settled));
    var b: MQBall = mq_ball(uv, max(Rs, 1e-3));
    var lit: f32 = 0.58 + (0.42 * b.lit);
    var en: f32 = (coreE * 1.30) + ((mist * 1.05) * lit);
    var pal: MQPalette = mq_palette(inkColor, toneColor, hueShift, depth);
    var field: vec3f = mq_lit(pal, en, glow, 0.0, 1.0, 0.32);
    var inkLin: vec3f = mq_srgb_to_linear(vec3f(inkColor.rgb));
    return mq_finish(field, inkLin, mq_containment(uv, 0.60), position, pixelScale);
}

fn mq_iris(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var petalsK: f32 = clamp(c0, 0.0, 1.0);
    var openK: f32 = clamp(c1, 0.0, 1.0);
    var softK: f32 = clamp(c2, 0.0, 1.0);
    var twistK: f32 = clamp(c3, 0.0, 1.0);
    var st: MQState = mq_state(stateIndex, stateTau);
    var live: MQLive = mq_live(level, activity, stateIndex);
    var small: f32 = mq_small(size);
    var tiny: f32 = mq_tiny(size);
    var r: f32 = length(uv);
    var th: f32 = atan2(uv.y, uv.x);
    var fl: vec4f = mq_flourish(t, 11.0);
    var breath: f32 = 0.5 + (0.5 * sin(t * 0.287));
    var o: f32 = clamp(((((mix(0.09, 0.40, openK) * (0.70 + (0.30 * breath))) + (0.62 * live.voice)) + (0.50 * fl.x)) + (0.24 * st.drive)) + (0.85 * st.complete), 0.0, 1.0);
    var tw: f32 = ((0.055 + (0.135 * twistK)) * ((t + (1.20 * sig.paceT)) + (1.0 * sig.driveT))) + (((1.0 - o) * 1.05) * twistK);
    var sharp: f32 = mix(2.7, 1.15, softK);
    var ang: f32 = th - tw;
    var lobe9: f32 = pow(0.5 + (0.5 * cos(9.0 * ang)), sharp);
    var lobe5: f32 = pow(0.5 + (0.5 * cos(5.0 * ang)), sharp * 0.82);
    var lobe: f32 = mix(lobe9, lobe5, tiny);
    var nBlend: f32 = mix(9.0, 5.0, tiny);
    var trem: f32 = mq_ring_noise(ang, nBlend / 6.2831853, (1.5 * t) + (2.6 * sig.paceT));
    var tipJit: f32 = ((trem * (0.10 + (0.90 * live.pace))) * 0.016) * lobe;
    var sc: f32 = clamp(mix(1.0, S, 0.60), 0.62, 1.15);
    var rin: f32 = (mix(0.042, 0.205, o) + tipJit) * sc;
    var rout: f32 = (0.325 * mix(1.0, 0.94, small)) * sc;
    var bodyMask: f32 = smoothstep(rin - 0.030, rin + 0.055, r) * (1.0 - smoothstep(rout * 0.78, rout, r));
    var blade: f32 = (lobe * bodyMask) * (0.34 + (0.30 * petalsK));
    var tipz: f32 = (r - rin) / mix(0.026, 0.048, small);
    var tip: f32 = (lobe * exp(-tipz * tipz)) * (0.62 + (0.55 * petalsK));
    var aniso: f32 = mix(mix(0.16, 0.44, small), 1.0, smoothstep(0.02, 0.58, o));
    var ct: f32 = cos(tw * 0.35);
    var stt: f32 = sin(tw * 0.35);
    var gq: vec2f = vec2f((ct * uv.x) + (stt * uv.y), ((-stt * uv.x) + (ct * uv.y)) / max(aniso, 1e-3));
    var gw: f32 = ((0.048 + (0.115 * o)) * mix(1.0, 1.20, small)) * sc;
    var aperture: f32 = exp(-pow(length(gq) / gw, 1.7)) * (0.42 + (0.95 * o));
    var fz: f32 = (r - ((st.sweep * rout) * 1.05)) / 0.055;
    var flash: f32 = ((st.complete * exp(-fz * fz)) * (0.55 + (0.75 * lobe))) * 1.35;
    var b: MQBall = mq_ball(uv, 0.335);
    var shade: f32 = (0.62 + (0.38 * b.lit)) * (0.55 + (0.45 * b.limb));
    var en: f32 = (((((aperture * 1.20) + (tip * (0.72 + (0.55 * o)))) + blade) + flash) * shade) * (1.0 + (0.20 * st.settled));
    var pal: MQPalette = mq_palette(inkColor, toneColor, hueShift, depth);
    var field: vec3f = mq_lit(pal, en, glow, 0.0, 1.0, 0.32);
    var inkLin: vec3f = mq_srgb_to_linear(vec3f(inkColor.rgb));
    return mq_finish(field, inkLin, mq_containment(uv, 0.60), position, pixelScale);
}

struct MQThread {
    R0: f32,
    a: f32,
    m: f32,
    k2: f32,
    k3: f32,
    kz: f32,
    ph: f32,
    taut: f32,
    kinkU: f32,
    kinkAmp: f32
}

fn mq_thread_point(u: f32, p: MQThread) -> vec3f {
    var ang: f32 = u * 6.2831853;
    var ca: f32 = cos(ang);
    var sa: f32 = sin(ang);
    var cm: f32 = cos((p.m * ang) + (p.ph * 1.7));
    var sm: f32 = sin((p.m * ang) + (p.ph * 1.7));
    var du: f32 = u - p.kinkU;
    du -= floor(du + 0.5);
    var kick: f32 = p.kinkAmp * exp(-(du * du) / (0.055 * 0.055));
    var rad: f32 = ((p.R0 + (p.a * cm)) + ((p.k2 * p.R0) * sin((2.0 * ang) + (p.ph * 1.1)))) + (kick * 0.11);
    var xy: vec2f = (vec2f(ca, sa) * rad) + (vec2f(-sa, ca) * ((p.k3 * p.R0) * sin((3.0 * ang) + (p.ph * 1.4))));
    var z: f32 = ((p.a * sm) + ((p.kz * p.R0) * sin(((3.0 * ang) + (p.ph * 0.8)) + 1.4))) + (kick * 0.06);
    xy = vec2f(xy.x * (1.0 + (0.34 * p.taut)), xy.y * (1.0 - (0.30 * p.taut)));
    return vec3f(xy, z);
}

fn mq_filament(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var lenK: f32 = clamp(c0, 0.0, 1.0);
    var knotK: f32 = clamp(c1, 0.0, 1.0);
    var brightK: f32 = clamp(c2, 0.0, 1.0);
    var swayK: f32 = clamp(c3, 0.0, 1.0);
    var st: MQState = mq_state(stateIndex, stateTau);
    var live: MQLive = mq_live(level, activity, stateIndex);
    var small: f32 = mq_small(size);
    var tiny: f32 = mq_tiny(size);
    var fl: vec4f = mq_flourish(t, 19.0);
    var taut: f32 = st.drive;
    var Kn: f32 = clamp((mix(0.20, 0.80, knotK) * (0.40 + (1.05 * live.pace))) + (0.10 * swayK), 0.0, 1.0) * (1.0 - (0.72 * taut));
    var p: MQThread;
    p.m = select(5.0, 3.0, tiny > 0.5);
    p.R0 = ((0.196 + (0.030 * lenK)) * (1.0 + (0.10 * Kn))) * mix(1.0, 0.94, small);
    p.a = ((0.040 + (0.026 * lenK)) * (1.0 - (0.62 * Kn))) * (1.0 - (0.35 * taut));
    p.k2 = 0.30 * Kn;
    p.k3 = 0.26 * Kn;
    p.kz = (0.28 * Kn) + 0.06;
    var phA: f32 = 0.17 + (0.30 * swayK);
    p.ph = (((phA * t) + (0.55 * sig.paceT)) + ((0.8 * phA) * sig.driveT)) + (0.44 * sig.pdT);
    p.taut = taut;
    p.kinkU = fract(fl.z + (fl.y * 0.34));
    p.kinkAmp = fl.x;
    var w: f32 = (0.0155 * mix(1.0, 2.35, small)) * (1.0 - (0.22 * taut));
    var w2: f32 = w * w;
    var halo: f32 = 0.0;
    var bestE: f32 = 0.0;
    var bestU: f32 = 0.0;
    var A: vec3f = mq_thread_point(0.0, p);
    for (var i: i32 = 0; i < 32; i++) {
        var u1: f32 = f32(i + 1) * (1.0 / 32.0);
        var B: vec3f = mq_thread_point(u1, p);
        var pa: vec2f = uv - A.xy;
        var ba: vec2f = B.xy - A.xy;
        var h: f32 = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-7), 0.0, 1.0);
        var dv: vec2f = pa - (ba * h);
        var d2: f32 = dot(dv, dv);
        var zz: f32 = mix(A.z, B.z, h);
        var dw: f32 = 0.58 + (0.42 * clamp(zz / 0.090, -1.0, 1.0));
        var g: f32 = exp(-d2 / w2) * dw;
        if (g > bestE) {
            bestE = g;
            bestU = (f32(i) + h) * (1.0 / 32.0);
        }
        halo = max(halo, exp(-d2 / (w2 * 11.0)) * dw);
        A = B;
    }
    var wave: f32 = 0.5 + (0.5 * sin(6.2831853 * ((bestU * 3.0) - ((0.28 * t) + (0.62 * sig.voiceT)))));
    var cur: f32 = mix(0.62, 1.0, wave) * (1.0 + (((0.25 + (1.15 * live.voice)) * (0.35 + (0.65 * brightK))) * pow(wave, 3.0)));
    var su: f32 = bestU - st.sweep;
    su -= floor(su + 0.5);
    cur += st.complete * ((1.75 * exp(-(su * su) / (0.085 * 0.085))) + 0.45);
    var air: f32 = ((1.0 - smoothstep(0.30, 1.15, length(uv) / max(p.R0, 1e-3))) * 0.105) * (0.7 + (0.5 * clamp(0.5 + mq_noise3(vec3f(uv * (3.4 / S), t * 0.09)), 0.0, 1.0)));
    var en: f32 = ((((bestE * cur) * 1.15) + ((halo * 0.26) * cur)) + air) * (1.0 + (0.22 * st.settled));
    var pal: MQPalette = mq_palette(inkColor, toneColor, hueShift, depth);
    var field: vec3f = mq_lit(pal, en, glow, 0.0, 1.0, 0.34);
    var inkLin: vec3f = mq_srgb_to_linear(vec3f(inkColor.rgb));
    return mq_finish(field, inkLin, mq_containment(uv, 0.60), position, pixelScale);
}

fn mq_flare(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var discK: f32 = clamp(c0, 0.0, 1.0);
    var licksK: f32 = clamp(c1, 0.0, 1.0);
    var reachK: f32 = clamp(c2, 0.0, 1.0);
    var flickK: f32 = clamp(c3, 0.0, 1.0);
    var st: MQState = mq_state(stateIndex, stateTau);
    var live: MQLive = mq_live(level, activity, stateIndex);
    var small: f32 = mq_small(size);
    var r: f32 = length(uv);
    var th: f32 = atan2(uv.y, uv.x);
    var Rd: f32 = mix(0.140, 0.196, discK) * mix(1.0, 1.16, small);
    var b: MQBall = mq_ball(uv, Rd);
    var P: vec3f = mq_spin(b.p, 0.105 * ((t + (0.85 * sig.paceT)) + (0.9 * sig.driveT)), 0.17);
    var gf: f32 = 2.9 / S;
    var gran: f32 = mq_fbm3((P * gf) + vec3f(0.0, 0.0, (0.085 * t) + (0.24 * sig.paceT)), 3, 2.03, 0.53) * mq_aa(((6.2831853 * gf) / max(Rd, 1e-3)) * 0.25, size, pixelScale);
    var g01: f32 = clamp(0.5 + ((1.15 + (0.55 * live.pace)) * gran), 0.0, 1.0);
    var disc: f32 = (b.m * (0.52 + (0.62 * g01))) * (0.58 + (0.62 * pow(b.z, 0.70)));
    var curl: f32 = mq_ring_noise(th, 1.15 / S, (t * 0.043) + 31.0);
    var shear: f32 = (((curl * 2.6) + (st.drive * 0.85)) * (r - Rd)) * 8.5;
    var ths: f32 = th + shear;
    var lf: f32 = (mix(0.55, 1.25, licksK) * mix(1.0, 0.58, small)) / S;
    var n1: f32 = mq_ring_noise(ths - (t * 0.115), lf, t * 0.19);
    var n2: f32 = mq_ring_noise(ths + (t * 0.085), lf * 2.15, (t * 0.37) + 17.0);
    var tongue: f32 = pow(clamp(0.5 + (1.55 * n1), 0.0, 1.0), 1.7) * ((1.0 - (flickK * 0.45)) + ((flickK * 0.90) * clamp(0.5 + (1.4 * n2), 0.0, 1.0)));
    var fl: vec4f = mq_flourish(t, 13.0);
    var prom: f32 = fl.x * exp(3.0 * (cos(th - (fl.z * 6.2831853)) - 1.0));
    var reach: f32 = (((0.017 + (0.098 * live.voice)) * mix(0.62, 1.22, reachK)) * (1.0 + (1.30 * prom))) * (1.0 + (1.15 * st.complete));
    var h: f32 = min(reach * tongue, 0.16);
    var u: f32 = (r - (Rd * 0.93)) / max(h, 1e-4);
    var lick: f32 = (exp((-u * u) * 1.5) * smoothstep(Rd * 0.62, Rd * 0.99, r)) * (0.28 + (0.72 * tongue));
    var cz: f32 = (r - (Rd + (0.15 * st.sweep))) / 0.048;
    var corona: f32 = ((st.complete * exp(-cz * cz)) * (0.42 + (0.85 * tongue))) * 1.30;
    var en: f32 = (((disc * 1.16) + (lick * 1.05)) + corona) * (1.0 + (0.24 * st.settled));
    var pal: MQPalette = mq_palette(inkColor, toneColor, hueShift, depth);
    var field: vec3f = mq_lit(pal, en, glow, 0.0, 1.0, 0.34);
    var inkLin: vec3f = mq_srgb_to_linear(vec3f(inkColor.rgb));
    return mq_finish(field, inkLin, mq_containment(uv, 0.60), position, pixelScale);
}

fn mq_braid(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var strandK: f32 = clamp(c0, 0.0, 1.0);
    var twistK: f32 = clamp(c1, 0.0, 1.0);
    var sepK: f32 = clamp(c2, 0.0, 1.0);
    var balK: f32 = clamp(c3, 0.0, 1.0);
    var st: MQState = mq_state(stateIndex, stateTau);
    var live: MQLive = mq_live(level, activity, stateIndex);
    var small: f32 = mq_small(size);
    var tiny: f32 = mq_tiny(size);
    var r: f32 = max(length(uv), 1e-4);
    var th: f32 = atan2(uv.y, uv.x);
    var sc: f32 = clamp(mix(1.0, S, 0.60), 0.62, 1.15);
    var R: f32 = (0.205 * mix(1.0, 0.95, small)) * sc;
    var n: f32 = floor(mix(2.0, 5.0, twistK) + 0.5);
    n = select(n, max(n - 1.0, 2.0), tiny > 0.5);
    var tight: f32 = clamp((0.55 * live.pace) + (0.85 * st.drive), 0.0, 1.0);
    var sep: f32 = ((mix(0.038, 0.082, sepK) * sc) * (1.15 - (0.70 * tight))) * (1.0 - (0.88 * st.complete));
    var wind: f32 = (0.26 + (0.50 * twistK)) * (((t + (1.15 * sig.paceT)) + (1.20 * sig.driveT)) + (1.38 * sig.pdT));
    var fl: vec4f = mq_flourish(t, 23.0);
    var bump: f32 = fl.x * exp(3.2 * (cos((th - (fl.z * 6.2831853)) - (fl.y * 2.6)) - 1.0));
    var tw: f32 = mix(0.013, 0.024, strandK) * mix(1.0, 2.30, small);
    var tw2: f32 = tw * tw;
    var bal: f32 = clamp((balK + (0.60 * live.voice)) - (0.58 * st.drive), 0.0, 1.0);
    var e0: f32 = 0.0;
    var e1: f32 = 0.0;
    var h0: f32 = 0.0;
    var h1: f32 = 0.0;
    var front0: f32 = 0.0;
    var front1: f32 = 0.0;
    for (var k: i32 = 0; k < 2; k++) {
        var psi: f32 = ((n * th) + wind) + (f32(k) * 3.14159265);
        var sk: f32 = sep * (1.0 + (select(0.0, 1.45 * bump, k == 0)));
        var rk: f32 = R + (sk * cos(psi));
        var zk: f32 = sk * sin(psi);
        var drdth: f32 = (-sk * n) * sin(psi);
        var corr: f32 = clamp(sqrt(1.0 + ((drdth * drdth) / (r * r))), 1.0, 2.6);
        var d: f32 = (r - rk) / corr;
        var g: f32 = exp(-(d * d) / tw2);
        var hgl: f32 = exp(-(d * d) / (tw2 * 10.0));
        var fr: f32 = 0.56 + (0.44 * (zk / max(sep, 1e-4)));
        if (k == 0) {
            e0 = g;
            h0 = hgl;
            front0 = fr;
        } else {
            e1 = g;
            h1 = hgl;
            front1 = fr;
        }
    }
    var g0: f32 = (0.55 + (0.92 * bal)) * front0;
    var g1: f32 = (0.55 + (0.92 * (1.0 - bal))) * front1;
    var s0: f32 = e0 * g0;
    var s1: f32 = e1 * g1;
    var cord: f32 = max(s0, s1) + (0.28 * min(s0, s1));
    var bloom: f32 = ((h0 * g0) + (h1 * g1)) * 0.22;
    var flash: f32 = (st.complete * exp(2.8 * (cos((th - (st.sweep * 6.2831853)) - 0.9) - 1.0))) * 1.45;
    var air: f32 = (1.0 - smoothstep(0.25, 1.20, r / (R + sep))) * 0.11;
    var en: f32 = (((cord * (1.20 + flash)) + bloom) + air) * (1.0 + (0.22 * st.settled));
    var pal: MQPalette = mq_palette(inkColor, toneColor, hueShift, depth);
    var field: vec3f = mq_lit(pal, en, glow, 0.0, 1.0, 0.33);
    var inkLin: vec3f = mq_srgb_to_linear(vec3f(inkColor.rgb));
    return mq_finish(field, inkLin, mq_containment(uv, 0.60), position, pixelScale);
}

struct MQPath {
    c: vec2f,
    v: vec2f
}

fn mq_mote_path(ph: f32, w0: f32, rate: f32) -> MQPath {
    var o: MQPath;
    o.c = w0 * vec2f(cos(ph) + (0.30 * cos((2.0 * ph) + 1.1)), (0.86 * sin(ph)) + (0.22 * sin((3.0 * ph) + 0.5)));
    o.v = (w0 * rate) * vec2f(-sin(ph) - (0.60 * sin((2.0 * ph) + 1.1)), (0.86 * cos(ph)) + (0.66 * cos((3.0 * ph) + 0.5)));
    return o;
}

fn mq_mote(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var wanderK: f32 = clamp(c0, 0.0, 1.0);
    var leanK: f32 = clamp(c1, 0.0, 1.0);
    var sizeK: f32 = clamp(c2, 0.0, 1.0);
    var tailK: f32 = clamp(c3, 0.0, 1.0);
    var st: MQState = mq_state(stateIndex, stateTau);
    var live: MQLive = mq_live(level, activity, stateIndex);
    var small: f32 = mq_small(size);
    var w0: f32 = (0.085 + (0.055 * wanderK)) * mix(1.0, 0.86, small);
    var rate: f32 = ((0.30 + (0.34 * wanderK)) * (1.0 + (1.30 * live.pace))) * (1.0 + (1.05 * st.drive));
    var ph: f32 = (0.30 + (0.34 * wanderK)) * (((t + (1.30 * sig.paceT)) + (1.05 * sig.driveT)) + (1.365 * sig.pdT));
    var path: MQPath = mq_mote_path(ph, w0, rate);
    var c: vec2f = path.c;
    var v: vec2f = path.v;
    c += 0.030 * vec2f(mq_fbm1(t * 0.068, 2, 3.0), mq_fbm1((t * 0.068) + 11.0, 2, 29.0));
    var fl: vec4f = mq_flourish(t, 29.0);
    var dartDir: vec2f = vec2f(cos(fl.z * 6.2831853), sin(fl.z * 6.2831853));
    c += (dartDir * fl.x) * 0.052;
    v += (((dartDir * 0.052) * 3.14159265) * sin(6.2831853 * fl.y)) / max(fl.w, 0.5);
    var sp: f32 = max(length(v), 1e-5);
    var dh: vec2f = v / sp;
    var q: vec2f = uv - c;
    var al: f32 = dot(q, dh);
    var ac: f32 = dot(q, vec2f(-dh.y, dh.x));
    var s0: f32 = mix(0.030, 0.052, sizeK) * mix(1.0, 1.55, small);
    var lean: f32 = leanK * (0.20 + (0.95 * live.pace));
    al -= (lean * s0) * 0.80;
    var sa: f32 = s0 * (1.0 + (0.85 * live.voice));
    var sc: f32 = s0 * (1.0 - (0.16 * live.voice));
    var sAl: f32 = select(sa * (1.0 + (0.55 * lean)), sa * (1.0 - (0.34 * lean)), al > 0.0);
    var core: f32 = exp((-(al * al) / (sAl * sAl)) - ((ac * ac) / (sc * sc)));
    var back: f32 = smoothstep(0.0, s0 * 0.55, -al);
    var tail: f32 = (((0.20 + (0.75 * tailK)) * back) * exp(al / (s0 * (2.8 + (4.0 * tailK))))) * exp(-(ac * ac) / ((sc * sc) * 2.4));
    var fine: f32 = ((1.0 - small) * 0.26) * mq_fbm3(vec3f(q * (7.5 / S), t * 0.19), 2, 2.03, 0.50);
    var corona: f32 = exp(-dot(q, q) / ((s0 * s0) * 9.0)) * (0.13 + (0.10 * tailK));
    var en: f32 = (((core * (1.0 + fine)) * 1.22) + (tail * 0.55)) + corona;
    if (st.complete > 0.002) {
        var bestD: f32 = 1e9;
        var bestU: f32 = 0.0;
        var A: MQPath = mq_mote_path(ph, w0, rate);
        for (var i: i32 = 0; i < 24; i++) {
            var u1: f32 = f32(i + 1) * (1.0 / 24.0);
            var B: MQPath = mq_mote_path(ph + (u1 * 6.2831853), w0, rate);
            var pa: vec2f = uv - A.c;
            var ba: vec2f = B.c - A.c;
            var hh: f32 = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-7), 0.0, 1.0);
            var dv: vec2f = pa - (ba * hh);
            var d2: f32 = dot(dv, dv);
            if (d2 < bestD) {
                bestD = d2;
                bestU = (f32(i) + hh) * (1.0 / 24.0);
            }
            A = B;
        }
        var trw: f32 = 0.011 * mix(1.0, 1.9, small);
        var trace: f32 = exp(-bestD / (trw * trw));
        var su: f32 = bestU - st.sweep;
        su -= floor(su + 0.5);
        en += (st.complete * trace) * (0.40 + (1.45 * exp(-(su * su) / (0.075 * 0.075))));
    }
    en *= 1.0 + (0.24 * st.settled);
    var pal: MQPalette = mq_palette(inkColor, toneColor, hueShift, depth);
    var field: vec3f = mq_lit(pal, en, glow, 0.0, 1.0, 0.34);
    var inkLin: vec3f = mq_srgb_to_linear(vec3f(inkColor.rgb));
    return mq_finish(field, inkLin, mq_containment(uv, 0.60), position, pixelScale);
}

fn mq_ripple(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var stillK: f32 = clamp(c0, 0.0, 1.0);
    var spdK: f32 = clamp(c1, 0.0, 1.0);
    var decayK: f32 = clamp(c2, 0.0, 1.0);
    var sheenK: f32 = clamp(c3, 0.0, 1.0);
    var st: MQState = mq_state(stateIndex, stateTau);
    var live: MQLive = mq_live(level, activity, stateIndex);
    var small: f32 = mq_small(size);
    var Rp: f32 = 0.300 * mix(1.0, 0.98, small);
    var r: f32 = length(uv);
    var b: MQBall = mq_ball(uv, Rp);
    var h: f32 = 0.0;
    var dh: vec2f = vec2f(0.0);
    var domeH: f32 = 0.020 * mix(1.0, 1.35, small);
    h += domeH * (1.0 - ((r * r) / (Rp * Rp)));
    dh += ((-2.0 * domeH) * uv) / (Rp * Rp);
    var trA: f32 = ((0.055 + (0.945 * live.voice)) * mix(0.45, 1.0, 1.0 - stillK)) * 0.0085;
    for (var i: i32 = 0; i < 3; i++) {
        var fi: f32 = f32(i);
        var a: f32 = (0.9 + (fi * 2.2)) + (t * (0.031 + (0.017 * fi)));
        var f: f32 = (21.0 + (13.0 * fi)) / S;
        var kv: vec2f = vec2f(cos(a), sin(a)) * f;
        var w: f32 = 1.35 + (0.45 * fi);
        var gate: f32 = mq_aa(f, size, pixelScale);
        var amp: f32 = (trA * (1.0 - (0.25 * fi))) * gate;
        var pz: f32 = dot(uv, kv) - (t * w);
        h += amp * sin(pz);
        dh += (amp * kv) * cos(pz);
    }
    const SLOT: f32 = 0.55;
    var p: f32 = (0.10 + (0.78 * live.pace)) + (0.55 * st.drive);
    var spd: f32 = mix(0.115, 0.235, spdK);
    var life: f32 = mix(0.65, 1.15, decayK);
    var ringW: f32 = 0.038 * mix(1.0, 1.85, small);
    var slot0: f32 = floor(t / SLOT);
    for (var i: i32 = 0; i < 5; i++) {
        var slot: f32 = slot0 - f32(i);
        var fire: f32 = step(mq_hash1(slot, 71.0), p);
        var onset: f32 = (slot * SLOT) + (SLOT * (0.12 + (0.66 * mq_hash1(slot, 137.0))));
        var age: f32 = t - onset;
        var alive: f32 = fire * step(0.0, age);
        var oa: f32 = mq_hash1(slot, 211.0) * 6.2831853;
        var orr: f32 = ((0.52 * Rp) * sqrt(mq_hash1(slot, 307.0))) * (1.0 - (0.85 * st.drive));
        var o: vec2f = vec2f(cos(oa), sin(oa)) * orr;
        var dvec: vec2f = uv - o;
        var dd: f32 = max(length(dvec), 1e-5);
        var rad: f32 = spd * age;
        var x: f32 = dd - rad;
        var w: f32 = ringW * (1.0 + (0.55 * age));
        var amp: f32 = (((alive * (0.016 + (0.008 * mq_hash1(slot, 401.0)))) * exp(-age / life)) * (1.0 - smoothstep(0.58, 1.0, rad / Rp))) / sqrt(1.0 + (rad / 0.09));
        var k: f32 = 2.2 / w;
        var env: f32 = exp(-(x * x) / (w * w));
        var cs: f32 = cos(k * x);
        var sni: f32 = sin(k * x);
        h += (amp * env) * cs;
        dh += ((amp * env) * ((((-2.0 * x) / (w * w)) * cs) - (k * sni))) * (dvec / dd);
    }
    var sr: f32 = (st.sweep * Rp) * 1.06;
    var sx: f32 = r - sr;
    var sw: f32 = 0.055;
    var sEnv: f32 = (exp(-(sx * sx) / (sw * sw)) * st.complete) * 0.030;
    h += sEnv;
    dh += (sEnv * ((-2.0 * sx) / (sw * sw))) * (uv / max(r, 1e-5));
    var fl: vec4f = mq_flourish(t, 37.0);
    var tiltDir: vec2f = vec2f(cos(fl.z * 6.2831853), sin(fl.z * 6.2831853));
    h += (fl.x * 0.014) * dot(uv, tiltDir);
    dh += (fl.x * 0.014) * tiltDir;
    var nrm: vec3f = normalize(vec3f(-dh, 1.0));
    var H: vec3f = normalize(vec3f(-0.216, 0.281, 1.945));
    var spec: f32 = pow(clamp(dot(nrm, H), 0.0, 1.0), mix(13.0, 32.0, sheenK));
    var diff: f32 = 0.5 + (0.5 * dot(nrm, normalize(vec3f(-0.40, 0.52, 0.75))));
    var body: f32 = (b.m * (0.26 + (0.30 * b.limb))) * (0.70 + (0.55 * diff));
    var en: f32 = ((body + (((b.m * spec) * (0.72 + (0.55 * sheenK))) * 1.30)) + ((b.m * max(h, 0.0)) * 6.0)) * ((1.0 + (0.30 * st.complete)) + (0.18 * st.settled));
    var pal: MQPalette = mq_palette(inkColor, toneColor, hueShift, depth);
    var field: vec3f = mq_lit(pal, en, glow, 0.0, 1.0, 0.32);
    var inkLin: vec3f = mq_srgb_to_linear(vec3f(inkColor.rgb));
    return mq_finish(field, inkLin, mq_containment(uv, 0.60), position, pixelScale);
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

@fragment fn fs_halo(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mq_halo(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_nucleus(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mq_nucleus(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_iris(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mq_iris(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_filament(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mq_filament(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_flare(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mq_flare(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_braid(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mq_braid(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_mote(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mq_mote(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_ripple(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mq_ripple(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, sig);
    return orb_clip(pos, c.rgb);
}
