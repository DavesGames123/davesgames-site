// Orb shader pack. WGSL, WebGPU.
// Derived from the Metal shaders of the MIT-licensed "murmur" package
// (c) Kris Puckett; ported function-for-function. MIT notice retained.
const M_PI_F: f32 = 3.14159265358979;

fn mh_hash(v: vec3u) -> u32 {
    var h: u32 = ((v.x * 1597334673u) ^ (v.y * 3812015801u)) ^ (v.z * 2798796415u);
    h ^= h >> 15u;
    h *= 2246822519u;
    h ^= h >> 13u;
    h *= 3266489917u;
    h ^= h >> 16u;
    return h;
}

fn mh_grad3(c: vec3i) -> vec3f {
    var h: u32 = mh_hash(vec3u(c + 4096));
    var z: f32 = fma(f32(h & 0xFFFFu), 2.0 / 65535.0, -1.0);
    var a: f32 = f32((h >> 16u) & 0xFFFFu) * (6.28318530718 / 65536.0);
    var r: f32 = sqrt(max(0.0, 1.0 - (z * z)));
    return vec3f(r * cos(a), r * sin(a), z);
}

fn mh_noise3(p: vec3f) -> f32 {
    var i: vec3f = floor(p);
    var f: vec3f = p - i;
    var u: vec3f = ((f * f) * f) * ((f * ((f * 6.0) - 15.0)) + 10.0);
    var c: vec3i = vec3i(i);
    var va: f32 = dot(mh_grad3(c + vec3i(0, 0, 0)), f - vec3f(0.0, 0.0, 0.0));
    var vb: f32 = dot(mh_grad3(c + vec3i(1, 0, 0)), f - vec3f(1.0, 0.0, 0.0));
    var vc: f32 = dot(mh_grad3(c + vec3i(0, 1, 0)), f - vec3f(0.0, 1.0, 0.0));
    var vd: f32 = dot(mh_grad3(c + vec3i(1, 1, 0)), f - vec3f(1.0, 1.0, 0.0));
    var ve: f32 = dot(mh_grad3(c + vec3i(0, 0, 1)), f - vec3f(0.0, 0.0, 1.0));
    var vf: f32 = dot(mh_grad3(c + vec3i(1, 0, 1)), f - vec3f(1.0, 0.0, 1.0));
    var vg: f32 = dot(mh_grad3(c + vec3i(0, 1, 1)), f - vec3f(0.0, 1.0, 1.0));
    var vh: f32 = dot(mh_grad3(c + vec3i(1, 1, 1)), f - vec3f(1.0, 1.0, 1.0));
    return mix(mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y), mix(mix(ve, vf, u.x), mix(vg, vh, u.x), u.y), u.z);
}

fn mh_srgb_to_linear(c: vec3f) -> vec3f {
    var c_p: vec3f = c;
    c_p = max(c_p, vec3f(0.0));
    return select(c_p * (1.0 / 12.92), pow((c_p + 0.055) * (1.0 / 1.055), vec3f(2.4)), c_p > vec3f(0.04045));
}

fn mh_linear_to_srgb(c: vec3f) -> vec3f {
    var c_p: vec3f = c;
    c_p = max(c_p, vec3f(0.0));
    return select(c_p * 12.92, (1.055 * pow(c_p, vec3f(1.0 / 2.4))) - 0.055, c_p > vec3f(0.0031308));
}

fn mh_linear_to_oklab(c: vec3f) -> vec3f {
    var l: f32 = ((0.4122214708 * c.r) + (0.5363325363 * c.g)) + (0.0514459929 * c.b);
    var m: f32 = ((0.2119034982 * c.r) + (0.6806995451 * c.g)) + (0.1073969566 * c.b);
    var s: f32 = ((0.0883024619 * c.r) + (0.2817188376 * c.g)) + (0.6299787005 * c.b);
    var l_: f32 = pow(max(l, 0.0), 1.0 / 3.0);
    var m_: f32 = pow(max(m, 0.0), 1.0 / 3.0);
    var s_: f32 = pow(max(s, 0.0), 1.0 / 3.0);
    return vec3f(((0.2104542553 * l_) + (0.7936177850 * m_)) - (0.0040720468 * s_), ((1.9779984951 * l_) - (2.4285922050 * m_)) + (0.4505937099 * s_), ((0.0259040371 * l_) + (0.7827717662 * m_)) - (0.8086757660 * s_));
}

fn mh_oklab_to_linear(lab: vec3f) -> vec3f {
    var l_: f32 = (lab.x + (0.3963377774 * lab.y)) + (0.2158037573 * lab.z);
    var m_: f32 = (lab.x - (0.1055613458 * lab.y)) - (0.0638541728 * lab.z);
    var s_: f32 = (lab.x - (0.0894841775 * lab.y)) - (1.2914855480 * lab.z);
    var l: f32 = (l_ * l_) * l_;
    var m: f32 = (m_ * m_) * m_;
    var s: f32 = (s_ * s_) * s_;
    return vec3f(((4.0767416621 * l) - (3.3077115913 * m)) + (0.2309699292 * s), ((-1.2684380046 * l) + (2.6097574011 * m)) - (0.3413193965 * s), ((-0.0041960863 * l) - (0.7034186147 * m)) + (1.7076147010 * s));
}

fn mh_lch(L: f32, C: f32, h: f32) -> vec3f {
    return vec3f(L, C * cos(h), C * sin(h));
}

fn mh_paper(inkColor: vec4f) -> f32 {
    var L: f32 = mh_linear_to_oklab(mh_srgb_to_linear(vec3f(inkColor.rgb))).x;
    return smoothstep(0.50, 0.72, L);
}

struct MHPalette {
    s0: vec3f,
    s1: vec3f,
    s2: vec3f,
    s3: vec3f,
    paper: f32,
    duo: f32,
    dHue: f32,
    dC: f32,
    dL: f32
}

fn mh_palette(inkColor: vec4f, toneColor: vec4f, tone2Color: vec4f, hueShift: f32, depth: f32) -> MHPalette {
    var ink: vec3f = mh_linear_to_oklab(mh_srgb_to_linear(vec3f(inkColor.rgb)));
    var tone: vec3f = mh_linear_to_oklab(mh_srgb_to_linear(vec3f(toneColor.rgb)));
    var L: f32 = tone.x;
    var C: f32 = length(tone.yz);
    var h: f32 = atan2(tone.z, tone.y) + hueShift;
    var d: f32 = clamp(depth, 0.30, 2.00);
    var p: MHPalette;
    p.paper = mh_paper(inkColor);
    var tone2: vec3f = mh_linear_to_oklab(mh_srgb_to_linear(vec3f(tone2Color.rgb)));
    var C2: f32 = length(tone2.yz);
    var h2: f32 = atan2(tone2.z, tone2.y) + hueShift;
    var dh: f32 = h2 - (atan2(tone.z, tone.y) + hueShift);
    p.dHue = dh - (6.2831853 * floor((dh / 6.2831853) + 0.5));
    p.dC = C2 / max(length(tone.yz), 1e-4);
    p.dL = tone2.x / max(tone.x, 1e-4);
    p.duo = smoothstep(0.004, 0.035, length(tone2 - tone));
    var d0: vec3f = ink;
    var d1: vec3f = mh_lch(mix(ink.x, L, 0.30 / d), C * (0.52 + (0.10 * d)), h - 0.35);
    var d2: vec3f = mh_lch(L, C, h);
    var d3: vec3f = mh_lch(min(L * (1.20 + (0.12 * d)), 0.93), C * 0.55, h + 0.10);
    var Lp: f32 = ink.x;
    var l0: vec3f = ink;
    var l1: vec3f = mh_lch(mix(Lp, L, 0.42 / d), C * (0.34 + (0.10 * d)), h + 0.05);
    var l2: vec3f = mh_lch(L * (0.82 - (0.06 * d)), C * (1.20 + (0.14 * d)), h);
    var l3: vec3f = mh_lch(max(L * (0.52 - (0.05 * d)), 0.18), C * (1.05 + (0.10 * d)), h - 0.08);
    p.s0 = mix(d0, l0, p.paper);
    p.s1 = mix(d1, l1, p.paper);
    p.s2 = mix(d2, l2, p.paper);
    p.s3 = mix(d3, l3, p.paper);
    return p;
}

const MH_SPREAD: f32 = 0.50;

fn mh_shade(p: MHPalette, t: f32, hue: f32) -> vec3f {
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
    var a: f32 = hue * (1.0 / MH_SPREAD);
    var pos: f32 = max(a, 0.0);
    var neg: f32 = max(-a, 0.0);
    var rot: f32 = (-neg * MH_SPREAD) + (pos * mix(MH_SPREAD, p.dHue, p.duo));
    var w: f32 = min(pos, 1.0) * p.duo;
    var cS: f32 = 1.0 + (w * (p.dC - 1.0));
    var lS: f32 = 1.0 + (w * (p.dL - 1.0));
    var ch: f32 = cos(rot);
    var sh: f32 = sin(rot);
    { let _sw1 = vec2f((lab.y * ch) - (lab.z * sh), (lab.y * sh) + (lab.z * ch)) * cS;
      lab.y = _sw1.x;
      lab.z = _sw1.y;
    }
    lab.x *= lS;
    return mh_oklab_to_linear(lab);
}

fn mh_out(linearRGB: vec3f, pixel: vec2f) -> vec4f {
    var c: vec3f = mh_linear_to_srgb(linearRGB);
    var n: f32 = fract(52.9829189 * fract(dot(pixel, vec2f(0.06711056, 0.00583715))));
    var tri: f32 = select(1.0 - sqrt(max(0.0, 2.0 - (2.0 * n))), sqrt(2.0 * n) - 1.0, n < 0.5);
    c += vec3f(tri * (1.0 / 255.0));
    return vec4f(vec3f(saturate(c)), 1.0);
}

fn mh_knee(x: f32, knee: f32) -> f32 {
    return select(knee + ((1.0 - knee) * (1.0 - exp(-(x - knee) / max(1.0 - knee, 1e-3)))), x, x < knee);
}

fn mh_tier(e: f32) -> f32 {
    var x: f32 = clamp(e, 0.0, 1.0);
    const K: f32 = 0.78;
    var body: f32 = (x / K) * 0.72;
    var peak: f32 = 0.72 + (((x - K) / (1.0 - K)) * 0.28);
    return mix(body, peak, smoothstep(K - 0.10, K + 0.10, x));
}

fn mh_lit(pal: MHPalette, e: f32, glow: f32, base: f32, span: f32, emis: f32, hue: f32) -> vec3f {
    var G: f32 = max(glow, 0.0);
    var en: f32 = clamp(mh_knee(max(e, 0.0) * (0.35 + (0.65 * G)), 0.92), 0.0, 1.0);
    var tRail: f32 = clamp(base + (span * mh_tier(en)), 0.0, 1.0);
    var col: vec3f = mh_shade(pal, tRail, hue);
    return col * (1.0 + (((emis * G) * (1.0 - pal.paper)) * smoothstep(0.72, 1.0, tRail)));
}

fn mh_aa(cycles: f32, size: vec2f, pixelScale: f32) -> f32 {
    var px: f32 = max(min(size.x, size.y), 1.0) * max(pixelScale, 1.0);
    var perPixel: f32 = max(cycles, 0.0) / (6.2831853 * px);
    return 1.0 - smoothstep(0.16, 0.36, perPixel);
}

fn mh_containment(uv: vec2f, reach: f32) -> f32 {
    var r: f32 = length(uv) * 2.0;
    return 1.0 - smoothstep(reach, reach + 0.26, r);
}

fn mh_spin(p: vec3f, ay: f32, ax: f32) -> vec3f {
    var ca: f32 = cos(ay);
    var sa: f32 = sin(ay);
    var q: vec3f = vec3f((ca * p.x) + (sa * p.z), p.y, (-sa * p.x) + (ca * p.z));
    var cb: f32 = cos(ax);
    var sb: f32 = sin(ax);
    return vec3f(q.x, (cb * q.y) - (sb * q.z), (sb * q.y) + (cb * q.z));
}

fn mh_roll(p: vec3f, a: f32) -> vec3f {
    var c: f32 = cos(a);
    var s: f32 = sin(a);
    return vec3f((c * p.x) - (s * p.y), (s * p.x) + (c * p.y), p.z);
}


// Integrated live signals, supplied by the runtime (∫ over the shader's own
// clock). voiceT/paceT are ∫ of the mh_live/mq_live-shaped signals, vdT/pdT
// their products with the responding drive, levelT/activityT the raw signals.
struct LiveSig {
    voiceT: f32, paceT: f32, driveT: f32, vdT: f32, pdT: f32, levelT: f32, activityT: f32
}
struct MHLive {
    voice: f32,
    pace: f32
}

fn mh_live(level: f32, activity: f32, stateIndex: f32) -> MHLive {
    var o: MHLive;
    var L: f32 = clamp(level, 0.0, 1.0);
    var A: f32 = clamp(activity, 0.0, 1.0);
    var listening: f32 = select(0.0, 1.0, (stateIndex > 0.5) && (stateIndex < 1.5));
    var working: f32 = select(0.0, 1.0, (stateIndex > 1.5) && (stateIndex < 3.5));
    o.voice = pow(L, 0.65) * mix(0.55, 1.00, listening);
    o.pace = pow(A, 0.85) * mix(0.60, 1.00, working);
    return o;
}

fn mh_small(size: vec2f) -> f32 {
    return 1.0 - smoothstep(16.0, 88.0, max(min(size.x, size.y), 1.0));
}

struct MHState {
    complete: f32,
    sweep: f32,
    settled: f32,
    drive: f32
}

fn mh_state(stateIndex: f32, stateTau: f32) -> MHState {
    var o: MHState;
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

fn mh_drift(t: f32, rate: f32, wobble: f32, lane: f32) -> f32 {
    var k: f32 = clamp(wobble, 0.0, 0.72);
    var w2: f32 = 0.137 + (0.0413 * lane);
    return (rate * t) + (((k * rate) / w2) * sin((w2 * t) + (lane * 1.71)));
}

// mh_drift with the live part of the rate already integrated: the static
// rate rides t, phL is b*∫signal, the wobble keeps the instantaneous rate.
fn mh_driftl(t: f32, rateS: f32, phL: f32, rateFull: f32, wobble: f32, lane: f32) -> f32 {
    var k: f32 = clamp(wobble, 0.0, 0.72);
    var w2: f32 = 0.137 + (0.0413 * lane);
    return (rateS * t) + phL + (((k * rateFull) / w2) * sin((w2 * t) + (lane * 1.71)));
}

// ∫ mh_flourish(...).x dt, continuous across slots: completed slots contribute
// half the mean duration each, the running one its sin² partial at that mean.
fn mh_flourish_int(t: f32, lane: f32, slotLen: f32) -> f32 {
    var SLOT: f32 = max(slotLen, 1.0);
    var slot: f32 = floor(t / SLOT);
    var local: f32 = t - (slot * SLOT);
    var start: f32 = 0.9 + ((SLOT * 0.28) * mh_hash1(slot, lane));
    var dur: f32 = SLOT * (0.24 + (0.16 * mh_hash1(slot + 811.0, lane)));
    var u: f32 = clamp((local - start) / dur, 0.0, 1.0);
    var avg: f32 = SLOT * 0.32;
    return (0.5 * avg * slot) + (avg * ((0.5 * u) - (sin(6.2831853 * u) / 12.5663706)));
}

fn mh_hash1(cell: f32, lane: f32) -> f32 {
    return f32(mh_hash(vec3u(u32(i32(cell) + 32768), u32(i32(lane) + 32768), 0x9E3779B9u)) >> 8u) * (1.0 / 16777216.0);
}

fn mh_flourish(t: f32, lane: f32, slotLen: f32) -> vec4f {
    var SLOT: f32 = max(slotLen, 1.0);
    var slot: f32 = floor(t / SLOT);
    var local: f32 = t - (slot * SLOT);
    var start: f32 = 0.9 + ((SLOT * 0.28) * mh_hash1(slot, lane));
    var dur: f32 = SLOT * (0.24 + (0.16 * mh_hash1(slot + 811.0, lane)));
    var u: f32 = (local - start) / dur;
    var sn: f32 = sin(3.14159265 * clamp(u, 0.0, 1.0));
    var env: f32 = select(sn * sn, 0.0, (u <= 0.0) || (u >= 1.0));
    return vec4f(env, clamp(u, 0.0, 1.0), mh_hash1(slot + 1607.0, lane), dur);
}

fn mh_breath(t: f32, lane: f32) -> f32 {
    var a: f32 = sin((t * 0.668) + lane);
    var b: f32 = sin(((t * 0.427) + (lane * 2.3)) + 1.1);
    return 0.5 + (0.5 * ((0.62 * a) + (0.38 * b)));
}

const MH_R: f32 = 0.300;

const MH_ETA: f32 = 1.0 / 1.20;

const MH_EXT: f32 = 0.55;

struct MHShape {
    amp: f32,
    hi: f32,
    gain: f32,
    flowDir: vec3f,
    flowAmp: f32,
    flowPhase: f32
}

fn mh_shape(amp: f32, hi: f32, gain: f32) -> MHShape {
    var s: MHShape;
    s.amp = amp;
    s.hi = hi;
    s.gain = gain;
    s.flowDir = vec3f(0.0, 0.0, 1.0);
    s.flowAmp = 0.0;
    s.flowPhase = 0.0;
    return s;
}

struct MHDeform {
    d: f32,
    g: vec3f
}

fn mh_deform(n: vec3f, t: f32, sh: MHShape) -> MHDeform {
    var a1: f32 = t * 0.083;
    var a2: f32 = (t * 0.061) + 2.10;
    var a3: f32 = (t * 0.047) + 4.37;
    var ax1: vec3f = normalize(vec3f(cos(a1), 0.62, sin(a1)));
    var ax2: vec3f = normalize(vec3f(0.55, cos(a2), sin(a2)));
    var ax3: vec3f = normalize(vec3f(sin(a3), -0.44, cos(a3)));
    const k1: f32 = 1.70;
    const k2: f32 = 2.60;
    const k3: f32 = 3.40;
    const w1: f32 = 0.55;
    const w2: f32 = 0.30;
    const w3: f32 = 0.18;
    let NORM: f32 = 1.0 / ((w1 + w2) + w3);
    var u1: f32 = dot(n, ax1);
    var u2: f32 = dot(n, ax2);
    var u3: f32 = dot(n, ax3);
    var d: f32 = (((w1 * sin(k1 * u1)) + (w2 * sin((k2 * u2) + 1.9))) + (w3 * sin((k3 * u3) + 4.1))) * NORM;
    var g: vec3f = (((((w1 * k1) * cos(k1 * u1)) * ax1) + (((w2 * k2) * cos((k2 * u2) + 1.9)) * ax2)) + (((w3 * k3) * cos((k3 * u3) + 4.1)) * ax3)) * NORM;
    if (sh.hi > 1e-4) {
        var a4: f32 = t * 0.63;
        var ax4: vec3f = normalize(vec3f(cos(a4) * 0.8, sin(a4 * 0.77), sin(a4)));
        const k4: f32 = 6.90;
        var u4: f32 = dot(n, ax4);
        d += sh.hi * sin(k4 * u4);
        g += ((sh.hi * k4) * cos(k4 * u4)) * ax4;
    }
    if (sh.flowAmp > 1e-4) {
        const kf: f32 = 3.20;
        var uf: f32 = dot(n, sh.flowDir);
        d += sh.flowAmp * sin((kf * uf) + sh.flowPhase);
        g += ((sh.flowAmp * kf) * cos((kf * uf) + sh.flowPhase)) * sh.flowDir;
    }
    var o: MHDeform;
    o.d = d;
    o.g = g;
    return o;
}

struct MHBody {
    m: f32,
    P: vec3f,
    N: vec3f,
    Rd: f32,
    rho: f32,
    fres: f32
}

fn mh_body(uv: vec2f, t: f32, px: f32, sh: MHShape) -> MHBody {
    var sh_p: MHShape = sh;
    var o: MHBody;
    sh_p.amp = clamp(sh_p.amp, 0.0, 0.085);
    var s: vec2f = uv / MH_R;
    o.rho = length(s);
    var z0: f32 = sqrt(max(1.0 - min(o.rho * o.rho, 1.0), 0.0));
    var n0: vec3f = normalize(vec3f(s, z0) + vec3f(0.0, 0.0, 1e-6));
    var R0: f32 = 1.0 + (mh_deform(n0, t, sh_p).d * sh_p.amp);
    var z1: f32 = sqrt(max((R0 * R0) - (o.rho * o.rho), 0.0));
    var n1: vec3f = normalize(vec3f(s, z1) + vec3f(0.0, 0.0, 1e-6));
    var d1: MHDeform = mh_deform(n1, t, sh_p);
    o.Rd = 1.0 + (d1.d * sh_p.amp);
    var z2: f32 = sqrt(max((o.Rd * o.Rd) - (o.rho * o.rho), 0.0));
    o.P = vec3f(s, z2);
    var gt: vec3f = d1.g * sh_p.amp;
    gt = gt - (dot(gt, n1) * n1);
    o.N = normalize(n1 - ((gt * sh_p.gain) / max(o.Rd, 1e-3)));
    var feather: f32 = max(0.018, 1.3 * px);
    o.m = 1.0 - smoothstep(o.Rd - feather, o.Rd + feather, o.rho);
    o.fres = 1.0 - clamp(o.N.z, 0.0, 1.0);
    return o;
}

fn mh_refract(V: vec3f, N: vec3f, eta: f32) -> vec3f {
    var ci: f32 = clamp(-dot(V, N), 0.0, 1.0);
    var k: f32 = 1.0 - ((eta * eta) * (1.0 - (ci * ci)));
    if (k <= 0.0) {
        return V;
    }
    return normalize((eta * V) + (((eta * ci) - sqrt(k)) * N));
}

const MH_TILT: f32 = 0.13;

fn mh_look(V: vec3f, N: vec3f, tilt: vec2f) -> vec3f {
    var rd: vec3f = mh_refract(V, N, MH_ETA);
    if ((tilt.x == 0.0) && (tilt.y == 0.0)) {
        return rd;
    }
    return normalize(rd + (vec3f(tilt.x, tilt.y, 0.0) * MH_TILT));
}

fn mh_exit(P: vec3f, rd: vec3f) -> f32 {
    var b: f32 = dot(P, rd);
    var c: f32 = dot(P, P) - 1.0;
    var disc: f32 = (b * b) - c;
    if (disc <= 0.0) {
        return 0.0;
    }
    return clamp(-b + sqrt(disc), 0.0, 2.2);
}

fn mh_haze(p: vec3f, t: f32, scale: f32) -> f32 {
    var q: vec3f = (p * scale) + vec3f(t * 0.051, -t * 0.033, t * 0.089);
    return clamp(0.5 + (0.85 * mh_noise3(q)), 0.0, 1.0);
}

fn mh_transmit(fres: f32) -> f32 {
    return 1.0 - (0.88 * pow(clamp(fres, 0.0, 1.0), 2.2));
}

const MH_SCATTER_K: f32 = 0.098;

fn mh_scatter(arg: f32, amp: f32) -> f32 {
    return amp * exp(-arg * MH_SCATTER_K);
}

fn mh_medium(p: vec3f, t: f32, scale: f32) -> f32 {
    var fog: f32 = 1.0 - smoothstep(0.05, 0.98, length(p));
    return fog * (0.55 + (0.45 * mh_haze(p, t, scale)));
}

fn mh_inside(p: vec3f) -> f32 {
    return 1.0 - smoothstep(0.76, 0.99, length(p));
}

struct MHSurface {
    rim: f32,
    spec: f32,
    glow: f32
}

fn mh_key(t: f32) -> vec3f {
    var dr: f32 = t * 0.21;
    return normalize(vec3f(-0.52 + (0.055 * sin(dr)), -0.60 + (0.045 * cos(dr * 0.83)), 0.61));
}

fn mh_surface(b: MHBody, t: f32, small: f32, inkColor: vec4f, tilt: vec2f, rimK: f32, specK: f32, glowK: f32) -> MHSurface {
    var rimK_p: f32 = rimK;
    var o: MHSurface;
    var paper: f32 = mh_paper(inkColor);
    rimK_p *= mix(1.0, 1.32, paper);
    var H: vec3f = normalize((mh_key(t) - (vec3f(tilt.x, tilt.y, 0.0) * (MH_TILT * 0.20))) + vec3f(0.0, 0.0, 1.0));
    var nh: f32 = clamp(dot(b.N, H), 0.0, 1.0);
    var tight: f32 = mix(96.0, 16.0, small);
    o.spec = (((pow(nh, tight) + (0.09 * pow(nh, 4.0))) * b.m) * specK) * mix(0.92, 1.08, 0.5 - (0.5 * clamp(b.N.y, -1.0, 1.0)));
    var wrap: f32 = 0.55 + (0.45 * clamp(dot(normalize(b.N.xy + vec2f(1e-4)), normalize(vec2f(0.42, 0.50))), 0.0, 1.0));
    wrap = mix(wrap, 0.88, paper);
    var sky: f32 = 0.5 - (0.5 * clamp(b.N.y, -1.0, 1.0));
    var envRim: f32 = mix(mix(0.86, 1.14, sky), mix(1.14, 0.86, sky), paper);
    o.rim = (((pow(b.fres, mix(3.9, 5.4, paper)) * b.m) * wrap) * rimK_p) * envRim;
    var outr: f32 = (b.rho - b.Rd) / 0.13;
    var pool: f32 = 0.55 + (0.55 * smoothstep(-0.25, 0.85, b.P.y));
    o.glow = ((exp(-outr * outr) * (1.0 - b.m)) * pool) * glowK;
    return o;
}

fn mh_present(body: f32, spec: f32, contact: f32, hue: f32, uv: vec2f, pal: MHPalette, glow: f32, inkColor: vec4f, position: vec2f, pixelScale: f32) -> vec4f {
    var paper: f32 = pal.paper;
    var dark: f32 = 1.0 - paper;
    var railE: f32 = body + ((spec + contact) * dark);
    var field: vec3f = mh_lit(pal, railE, glow, 0.0, 1.0, 0.34, hue);
    var inkLin: vec3f = mh_srgb_to_linear(vec3f(inkColor.rgb));
    var rgb: vec3f = mix(inkLin, field, mh_containment(uv, 0.72));
    if (paper > 0.002) {
        var lit: vec3f = mh_oklab_to_linear(mh_lch(min((pal.s0.x * 1.06) + 0.05, 1.02), 0.012, 0.9));
        rgb = mix(rgb, lit, smoothstep(0.34, 0.92, spec) * paper);
        var below: f32 = smoothstep(-0.10, 0.66, uv.y / MH_R);
        var shade: vec3f = inkLin * 0.55;
        rgb = mix(rgb, shade, (clamp(contact * 2.60, 0.0, 1.0) * (0.06 + (1.05 * below))) * paper);
    }
    var knee: f32 = mix(0.90, 0.96, paper);
    rgb = vec3f(mh_knee(rgb.r, knee), mh_knee(rgb.g, knee), mh_knee(rgb.b, knee));
    return mh_out(rgb, position * pixelScale);
}

fn mh_aura(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, tilt: vec2f, tone2: vec4f, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var ribbonK: f32 = clamp(c0, 0.0, 1.0);
    var swirlK: f32 = clamp(c1, 0.0, 1.0);
    var spreadK: f32 = clamp(c2, 0.0, 1.0);
    var d3K: f32 = clamp(c3, 0.0, 1.0);
    var st: MHState = mh_state(stateIndex, stateTau);
    var live: MHLive = mh_live(level, activity, stateIndex);
    var small: f32 = mh_small(size);
    var px: f32 = 1.0 / ((max(min(size.x, size.y), 1.0) * max(pixelScale, 1.0)) * MH_R);
    var sh: MHShape = mh_shape(0.022 + (0.008 * mh_breath(t, 0.4)), 0.0, 1.35);
    var b: MHBody = mh_body(uv, t, px, sh);
    var V: vec3f = vec3f(0.0, 0.0, -1.0);
    var rd: vec3f = mh_look(V, b.N, tilt);
    var L: f32 = mh_exit(b.P, rd);
    var third: f32 = smoothstep(0.55, 0.95, ribbonK) * (1.0 - smoothstep(0.22, 0.62, small));
    var second: f32 = mix(1.0, 0.34, smoothstep(0.52, 0.94, small));
    var w3: f32 = 0.55 + (0.45 * ribbonK);
    var wh: f32 = (0.105 - (0.020 * ribbonK)) * mix(1.0, 1.85, small);
    var bw: f32 = (0.400 - (0.070 * ribbonK)) * mix(1.0, 1.25, small);
    wh *= S;
    bw *= S;
    var rate: f32 = (0.17 + (0.24 * swirlK)) * (((1.0 + (0.85 * live.voice)) + (0.45 * live.pace)) + (1.05 * st.drive));
    var rateS: f32 = 0.17 + (0.24 * swirlK);
    var phL: f32 = rateS * (((0.85 * sig.voiceT) + (0.45 * sig.paceT)) + (1.05 * sig.driveT));
    var ph0: f32 = mh_driftl(t, rateS, phL, rate, 0.40, 1.0);
    var ph1: f32 = mh_driftl(t, rateS * 0.83, phL * 0.83, rate * 0.83, 0.52, 2.0) + 2.1;
    var ph2: f32 = mh_driftl(t, rateS * 1.17, phL * 1.17, rate * 1.17, 0.34, 3.0) + 4.3;
    var amp: f32 = ((0.098 + (0.130 * d3K)) * (1.0 + (0.55 * live.voice))) * mix(1.0, 0.78, small);
    var of0: f32 = mix(-0.26, -0.20, small);
    var of1: f32 = mix(0.24, 0.20, small);
    var of2: f32 = 0.02;
    var align: f32 = st.drive;
    var alignT: f32 = 0.5 * align;
    var ro0: f32 = 0.15 + (0.22 * sin(t * 0.031));
    var ro1: f32 = 2.05 + (0.26 * sin((t * 0.024) + 2.2));
    var ro2: f32 = 3.85 + (0.20 * sin((t * 0.019) + 4.6));
    var ay0: f32 = mix(mh_drift(t, 0.061, 0.5, 4.0), 0.30, alignT);
    var ax0: f32 = mix(0.62 + (0.16 * sin(t * 0.043)), 0.34, alignT);
    var ay1: f32 = mix(mh_drift(t, 0.047, 0.6, 5.0) + 2.4, 0.30, alignT);
    var ax1: f32 = mix(-0.78 + (0.14 * sin((t * 0.037) + 1.9)), 0.34, alignT);
    var ay2: f32 = mix(mh_drift(t, 0.039, 0.4, 6.0) + 4.7, 0.30, alignT);
    var ax2: f32 = mix(0.06 + (0.20 * sin((t * 0.029) + 3.4)), 0.34, alignT);
    var shimGate: f32 = mh_aa((6.2831853 * 7.2) / (MH_R * S), size, pixelScale) * (1.0 - small);
    var shimAmt: f32 = shimGate * (0.20 + (0.75 * live.pace));
    var acc: vec2f = vec2f(0.0);
    var trans: f32 = 1.0;
    var ds: f32 = L / f32(5);
    for (var i: i32 = 0; i < 5; i++) {
        var p: vec3f = b.P + (rd * ((f32(i) + 0.5) * ds));
        var fade: f32 = mh_inside(p);
        if (fade <= 0.001) {
            continue;
        }
        var q: vec3f = mh_spin(mh_roll(p, ro0), ay0, ax0) / S;
        var dh: f32 = (q.y - of0) - (amp * (sin((1.70 * q.x) + ph0) + (0.62 * sin(((1.10 * q.z) - (ph0 * 0.8)) + 2.1))));
        var a0: f32 = ((dh * dh) / (wh * wh)) + ((q.z * q.z) / (bw * bw));
        var g0: f32 = 0.58 + (0.42 * (0.5 + (0.5 * sin(((2.1 * q.x) - (t * 0.083)) + 0.7))));
        var e0: f32 = (exp(-a0) + mh_scatter(a0, 0.17)) * g0;
        q = mh_spin(mh_roll(p, ro1), ay1, ax1) / S;
        dh = (q.y - of1) - ((amp * 0.85) * (sin((1.30 * q.x) + ph1) + (0.58 * sin(((1.55 * q.z) - (ph1 * 0.7)) + 4.3))));
        var a1: f32 = ((dh * dh) / (wh * wh)) + ((q.z * q.z) / ((bw * bw) * 1.30));
        var g1: f32 = 0.58 + (0.42 * (0.5 + (0.5 * sin(((1.6 * q.x) - (t * 0.061)) + 3.9))));
        var e1: f32 = ((exp(-a1) + mh_scatter(a1, 0.17)) * g1) * second;
        var e2: f32 = 0.0;
        if (third > 0.002) {
            q = mh_spin(mh_roll(p, ro2), ay2, ax2) / S;
            dh = (q.y - of2) - ((amp * 1.15) * (sin((2.10 * q.x) + ph2) + (0.55 * sin(((0.90 * q.z) - (ph2 * 0.9)) + 1.4))));
            var a2: f32 = ((dh * dh) / (wh * wh)) + ((q.z * q.z) / ((bw * bw) * 0.80));
            var g2: f32 = 0.58 + (0.42 * (0.5 + (0.5 * sin(((1.3 * q.x) - (t * 0.047)) + 1.9))));
            e2 = ((exp(-a2) + mh_scatter(a2, 0.17)) * g2) * third;
        }
        var lap: f32 = 1.0;
        if (st.complete > 0.001) {
            var ang: f32 = atan2(p.z, p.x);
            lap += st.complete * (0.18 + (0.80 * exp(2.4 * (cos(ang - (st.sweep * 6.2831853)) - 1.0))));
        }
        var ribbons: f32 = (((e0 + e1) + e2) * w3) * lap;
        if (shimAmt > 0.002) {
            ribbons *= 1.0 + (shimAmt * mh_noise3((p * (7.2 / S)) + vec3f(0.0, 0.0, t * 0.9)));
        }
        var hueW: f32 = ((((e0 * -0.70) + (e1 * 0.55)) + (e2 * 1.0)) * w3) * lap;
        var med: f32 = mh_medium(p, t, 2.6 / S) * 0.075;
        var e: f32 = ((ribbons * 1.45) + med) * fade;
        acc.x += (e * trans) * ds;
        acc.y += (((hueW * 1.45) * fade) * trans) * ds;
        trans *= exp(-((4.50 * e) + MH_EXT) * ds);
    }
    var interior: f32 = (((((acc.x * 2.60) * mix(1.0, 0.92, small)) * b.m) * mh_transmit(b.fres)) * (1.0 + (0.45 * st.complete))) * (1.0 + (0.22 * st.settled));
    var hue: f32 = ((select(0.0, acc.y / acc.x, acc.x > 1e-4)) * spreadK) * MH_SPREAD;
    var sf: MHSurface = mh_surface(b, t, small, inkColor, tilt, 0.88 + (0.40 * live.voice), 0.52, 0.16);
    var e: f32 = ((interior + sf.rim) + sf.spec) + sf.glow;
    var hueMix: f32 = (hue * (interior + (sf.rim * 0.7))) / max(e, 1e-4);
    var pal: MHPalette = mh_palette(inkColor, toneColor, tone2, hueShift, depth);
    return mh_present((e - sf.spec) - sf.glow, sf.spec, sf.glow, hueMix, uv, pal, glow, inkColor, position, pixelScale);
}

fn mh_droplet(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, tilt: vec2f, tone2: vec4f, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var wobbleK: f32 = clamp(c0, 0.0, 1.0);
    var tensionK: f32 = clamp(c1, 0.0, 1.0);
    var sheenK: f32 = clamp(c2, 0.0, 1.0);
    var spreadK: f32 = clamp(c3, 0.0, 1.0);
    var st: MHState = mh_state(stateIndex, stateTau);
    var live: MHLive = mh_live(level, activity, stateIndex);
    var small: f32 = mh_small(size);
    var px: f32 = 1.0 / ((max(min(size.x, size.y), 1.0) * max(pixelScale, 1.0)) * MH_R);
    var br: f32 = mh_breath(t, 0.9);
    var swell: f32 = (0.22 + (0.78 * br)) * live.voice;
    var bodyScale: f32 = 1.0 + (0.050 * swell);
    var wob: f32 = (((0.052 + (0.040 * wobbleK)) * (1.0 - (0.22 * tensionK))) * (1.0 + (0.30 * swell))) * mix(1.0, 1.20, small);
    var tremGate: f32 = mh_aa((6.2831853 * 6.9) / MH_R, size, pixelScale) * (1.0 - small);
    var sh: MHShape = mh_shape(wob, (0.012 * live.pace) * tremGate, 3.30);
    if (st.drive > 0.002) {
        sh.flowDir = normalize(vec3f(0.92, 0.20, 0.34));
        sh.flowAmp = 0.30 * st.drive;
        sh.flowPhase = -mh_drift(t, 2.05, 0.30, 7.0);
    }
    var b: MHBody = mh_body(uv / bodyScale, t, px / bodyScale, sh);
    var V: vec3f = vec3f(0.0, 0.0, -1.0);
    var rd: vec3f = mh_look(V, b.N, tilt);
    var L: f32 = mh_exit(b.P, rd);
    var coreC: vec3f = vec3f(0.028 * sin((t * 0.213) + 0.6), 0.026 * sin((t * 0.167) + 2.4), 0.024 * sin((t * 0.139) + 4.1));
    var coreR: f32 = (((0.17 + (0.10 * (1.0 - tensionK))) * S) * mix(1.0, 1.55, small)) * (1.0 + (0.22 * swell));
    var coreBright: f32 = (1.0 + (0.85 * live.voice)) + (0.35 * st.settled);
    var acc: vec2f = vec2f(0.0);
    var trans: f32 = 1.0;
    var ds: f32 = L / f32(5);
    for (var i: i32 = 0; i < 5; i++) {
        var p: vec3f = b.P + (rd * ((f32(i) + 0.5) * ds));
        var fade: f32 = mh_inside(p);
        if (fade <= 0.001) {
            continue;
        }
        var shell: f32 = 0.0;
        if (st.complete > 0.001) {
            var sr: f32 = (length(p) - mix(0.05, 1.0, st.sweep)) / 0.20;
            shell = (st.complete * 0.34) * exp(-sr * sr);
        }
        var med: f32 = mh_medium(p, t, 2.1 / S) * 0.090;
        var e: f32 = (shell + med) * fade;
        acc.x += (e * trans) * ds;
        acc.y += (((e * fade) * clamp(p.z, -1.0, 1.0)) * trans) * ds;
        trans *= exp(-((2.40 * e) + MH_EXT) * ds);
    }
    var toC: vec3f = coreC - b.P;
    var sC: f32 = dot(toC, rd);
    var heart: f32 = 0.0;
    if ((sC > 0.0) && (sC < L)) {
        var dC2: f32 = max(dot(toC, toC) - (sC * sC), 0.0) / max(coreR * coreR, 1e-6);
        var vis: f32 = (mh_inside(b.P + (rd * sC)) * exp(-MH_EXT * sC)) * coreBright;
        heart = (((exp(-dC2) * 1.65) + mh_scatter(dC2, 0.34)) * vis) * (1.0 + (0.26 * st.complete));
    }
    var interior: f32 = (((acc.x * 4.20) + heart) * b.m) * mh_transmit(b.fres);
    var hue: f32 = ((select(0.0, acc.y / acc.x, acc.x > 1e-4)) * spreadK) * MH_SPREAD;
    var sf: MHSurface = mh_surface(b, t, small, inkColor, tilt, (1.05 + (0.55 * sheenK)) + (0.35 * live.voice), 0.42 + (0.30 * sheenK), 0.16);
    var e: f32 = ((interior + sf.rim) + sf.spec) + sf.glow;
    var hueMix: f32 = (hue * (interior + (sf.rim * 0.6))) / max(e, 1e-4);
    var pal: MHPalette = mh_palette(inkColor, toneColor, tone2, hueShift, depth);
    return mh_present((e - sf.spec) - sf.glow, sf.spec, sf.glow, hueMix, uv, pal, glow, inkColor, position, pixelScale);
}

fn mh_limn(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, tilt: vec2f, tone2: vec4f, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var widthK: f32 = clamp(c0, 0.0, 1.0);
    var travelK: f32 = clamp(c1, 0.0, 1.0);
    var hintK: f32 = clamp(c2, 0.0, 1.0);
    var spreadK: f32 = clamp(c3, 0.0, 1.0);
    var st: MHState = mh_state(stateIndex, stateTau);
    var live: MHLive = mh_live(level, activity, stateIndex);
    var small: f32 = mh_small(size);
    var px: f32 = 1.0 / ((max(min(size.x, size.y), 1.0) * max(pixelScale, 1.0)) * MH_R);
    var sh: MHShape = mh_shape(0.020, 0.0, 1.05);
    var b: MHBody = mh_body(uv, t, px, sh);
    var wobble: f32 = mix(0.62, 0.14, st.drive);
    var rate: f32 = ((0.34 + (0.40 * travelK)) * ((1.0 + (0.95 * live.pace)) + (0.30 * live.voice))) * (1.0 + (1.05 * st.drive));
    var rateS: f32 = 0.34 + (0.40 * travelK);
    var phL: f32 = rateS * ((((0.95 * sig.paceT) + (0.30 * sig.voiceT)) + (1.05 * sig.driveT)) + (1.05 * ((0.95 * sig.pdT) + (0.30 * sig.vdT))));
    var phi0: f32 = mh_driftl(t, rateS, phL, rate, wobble, 1.0);
    phi0 += st.sweep * 6.2831853;
    var phi: f32 = atan2(uv.y, uv.x);
    var aw: f32 = phi - phi0;
    aw = aw - (6.2831853 * floor((aw / 6.2831853) + 0.5));
    var kHead: f32 = mix(9.0, 2.2, small) / (1.0 + (0.60 * live.voice));
    var kTail: f32 = mix(1.6, 0.95, small) / ((1.0 + (0.35 * live.voice)) + (0.30 * st.drive));
    var offT: f32 = mix(-1.05, -1.25, small) - (0.30 * st.drive);
    var headLobe: f32 = exp(kHead * (cos(aw) - 1.0));
    var tailLobe: f32 = exp(kTail * (cos(aw - offT) - 1.0));
    var arc: f32 = headLobe + (0.52 * tailLobe);
    var bw: f32 = min((((0.070 + (0.055 * widthK)) * (1.0 + (0.55 * live.voice))) * mix(1.0, 2.10, small)) * S, 0.30);
    var dband: f32 = (b.rho - (b.Rd * 0.965)) / max(bw, 1e-3);
    var band: f32 = exp(-dband * dband) * b.m;
    var rimlight: f32 = band * (0.30 + (0.70 * pow(b.fres, 1.6)));
    var ringClose: f32 = (st.complete * band) * 1.20;
    var rimE: f32 = (((((rimlight * arc) * (1.70 + (1.15 * live.voice))) * mix(1.0, 1.15, small)) * (1.0 + (1.6 * st.complete))) * (1.0 + (0.30 * st.settled))) + ringClose;
    var arcDir: vec3f = vec3f(cos(phi0), sin(phi0), 0.0);
    var V: vec3f = vec3f(0.0, 0.0, -1.0);
    var rd: vec3f = mh_look(V, b.N, tilt);
    var L: f32 = mh_exit(b.P, rd);
    var hintAmt: f32 = ((0.22 + (0.38 * hintK)) * (1.0 + (0.9 * live.voice))) * mix(1.0, 0.28, small);
    var acc: vec2f = vec2f(0.0);
    var trans: f32 = 1.0;
    var ds: f32 = L / f32(5);
    for (var i: i32 = 0; i < 5; i++) {
        var p: vec3f = b.P + (rd * ((f32(i) + 0.5) * ds));
        var fade: f32 = mh_inside(p);
        if (fade <= 0.001) {
            continue;
        }
        var lit: f32 = pow(clamp(dot(normalize(p + 1e-5), arcDir), 0.0, 1.0), 2.2);
        var reach: f32 = smoothstep(0.10, 0.85, length(p));
        var haze: f32 = (mh_haze(p, t, 2.4 / S) * 0.55) + 0.45;
        var e: f32 = ((((lit * reach) * haze) * hintAmt) + (mh_medium(p, t, 2.4 / S) * 0.030)) * fade;
        acc.x += (e * trans) * ds;
        acc.y += ((e * fade) * trans) * ds;
        trans *= exp(-((1.80 * e) + MH_EXT) * ds);
    }
    var interior: f32 = (((acc.x * 3.00) * b.m) * mh_transmit(b.fres)) * (1.0 + (0.9 * st.complete));
    var tailShare: f32 = (0.52 * tailLobe) / max(headLobe + (0.52 * tailLobe), 1e-4);
    var hue: f32 = (-tailShare * spreadK) * MH_SPREAD;
    var sf: MHSurface = mh_surface(b, t, small, inkColor, tilt, 0.30, 0.78 + (0.35 * live.voice), 0.09);
    var e: f32 = (((interior + rimE) + sf.rim) + sf.spec) + sf.glow;
    var hueMix: f32 = (hue * (rimE + interior)) / max(e, 1e-4);
    var pal: MHPalette = mh_palette(inkColor, toneColor, tone2, hueShift, depth);
    return mh_present((e - sf.spec) - sf.glow, sf.spec, sf.glow, hueMix, uv, pal, glow, inkColor, position, pixelScale);
}

fn mh_comet(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, tilt: vec2f, tone2: vec4f, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var tiltK: f32 = clamp(c0, 0.0, 1.0);
    var trailK: f32 = clamp(c1, 0.0, 1.0);
    var pointK: f32 = clamp(c2, 0.0, 1.0);
    var spreadK: f32 = clamp(c3, 0.0, 1.0);
    var st: MHState = mh_state(stateIndex, stateTau);
    var live: MHLive = mh_live(level, activity, stateIndex);
    var small: f32 = mh_small(size);
    var px: f32 = 1.0 / ((max(min(size.x, size.y), 1.0) * max(pixelScale, 1.0)) * MH_R);
    var sh: MHShape = mh_shape(0.024, 0.0, 1.30);
    var b: MHBody = mh_body(uv, t, px, sh);
    var V: vec3f = vec3f(0.0, 0.0, -1.0);
    var rd: vec3f = mh_look(V, b.N, tilt);
    var L: f32 = mh_exit(b.P, rd);
    var tau: f32 = mix(0.30, 1.05, tiltK);
    var prec: f32 = mh_drift(t, 0.070, 0.45, 2.0);
    var e1: vec3f = mh_spin(vec3f(1.0, 0.0, 0.0), prec, 0.0);
    var e2: vec3f = mh_spin(vec3f(0.0, sin(tau), cos(tau)), prec, 0.0);
    var r0: f32 = (mix(0.54, 0.66, small) * (1.0 - (0.24 * live.pace))) * S;
    r0 = clamp(r0, 0.20, 0.70);
    var rate: f32 = 1.05 * ((1.0 + (0.85 * live.pace)) + (0.95 * st.drive));
    var psi: f32 = mh_driftl(t, 1.05, 1.05 * ((0.85 * sig.paceT) + (0.95 * sig.driveT)), rate, 0.38, 3.0);
    var head: vec3f = r0 * ((cos(psi) * e1) + (sin(psi) * e2));
    var hw: f32 = (((0.028 + (0.030 * pointK)) * (1.0 + (0.45 * live.voice))) * mix(1.0, 1.55, small)) * S;
    var tubeW: f32 = hw * 1.45;
    var decay: f32 = ((1.30 + (2.60 * trailK)) * (1.0 + (1.25 * st.drive))) * mix(1.0, 0.40, small);
    if (st.complete > 0.001) {
        decay = mix(decay, 9.0, st.sweep);
    }
    var headBright: f32 = ((1.0 + (1.30 * live.voice)) * (1.0 + (2.2 * st.complete))) * (1.0 + (0.25 * st.settled));
    var medAmt: f32 = mix(0.055, 0.028, small);
    var nrm: vec3f = cross(e1, e2);
    var acc: vec2f = vec2f(0.0);
    var trans: f32 = 1.0;
    var ds: f32 = L / f32(5);
    for (var i: i32 = 0; i < 5; i++) {
        var p: vec3f = b.P + (rd * ((f32(i) + 0.5) * ds));
        var fade: f32 = mh_inside(p);
        if (fade <= 0.001) {
            continue;
        }
        var u: f32 = dot(p, e1);
        var v: f32 = dot(p, e2);
        var w: f32 = dot(p, nrm);
        var q: f32 = sqrt((u * u) + (v * v));
        var dq: f32 = q - r0;
        var dist2: f32 = (dq * dq) + (w * w);
        var psiP: f32 = atan2(v, u);
        var age: f32 = psi - psiP;
        age = age - (6.2831853 * floor((age / 6.2831853) + 0.5));
        var fall: f32;
        if (age >= 0.0) {
            fall = exp(-age / max(decay, 1e-3)) * (1.0 - smoothstep(2.30, 3.1416, age));
        } else {
            fall = exp(age / 0.30);
        }
        var targ: f32 = dist2 / (tubeW * tubeW);
        var trail: f32 = (exp(-targ) + mh_scatter(targ, 0.22)) * fall;
        var med: f32 = mh_medium(p, t, 2.3 / S) * medAmt;
        var e: f32 = ((trail * 1.55) + med) * fade;
        acc.x += (e * trans) * ds;
        acc.y += ((((trail * 1.55) * fade) * clamp(age / 3.1416, 0.0, 1.0)) * trans) * ds;
        trans *= exp(-((4.20 * e) + MH_EXT) * ds);
    }
    var interior: f32 = (((acc.x * 4.20) * b.m) * mh_transmit(b.fres)) * (1.0 + (0.20 * st.settled));
    var hue: f32 = ((-(select(0.0, acc.y / acc.x, acc.x > 1e-4)) * spreadK) * MH_SPREAD) * 1.4;
    var toH: vec3f = head - b.P;
    var sH: f32 = dot(toH, rd);
    var dH2: f32 = max(dot(toH, toH) - (sH * sH), 0.0);
    var headE: f32 = 0.0;
    if ((sH > 0.0) && (sH < L)) {
        var harg: f32 = dH2 / (hw * hw);
        var vis: f32 = (mh_inside(b.P + (rd * sH)) * exp(-MH_EXT * sH)) * mh_transmit(b.fres);
        headE = ((((exp(-harg) * 0.92) + mh_scatter(harg, 0.30)) * headBright) * vis) * b.m;
    }
    var sf: MHSurface = mh_surface(b, t, small, inkColor, tilt, 0.80 + (0.35 * live.voice), 0.22, 0.15);
    var e: f32 = (((interior + headE) + sf.rim) + sf.spec) + sf.glow;
    var hueMix: f32 = (hue * (interior + (sf.rim * 0.7))) / max(e, 1e-4);
    var pal: MHPalette = mh_palette(inkColor, toneColor, tone2, hueShift, depth);
    return mh_present((e - sf.spec) - sf.glow, sf.spec, sf.glow, hueMix, uv, pal, glow, inkColor, position, pixelScale);
}

fn mh_nebula(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, tilt: vec2f, tone2: vec4f, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var densityK: f32 = clamp(c0, 0.0, 1.0);
    var foldK: f32 = clamp(c1, 0.0, 1.0);
    var glintK: f32 = clamp(c2, 0.0, 1.0);
    var spreadK: f32 = clamp(c3, 0.0, 1.0);
    var st: MHState = mh_state(stateIndex, stateTau);
    var live: MHLive = mh_live(level, activity, stateIndex);
    var small: f32 = mh_small(size);
    var px: f32 = 1.0 / ((max(min(size.x, size.y), 1.0) * max(pixelScale, 1.0)) * MH_R);
    var sh: MHShape = mh_shape(0.022 + (0.008 * mh_breath(t, 1.6)), 0.0, 1.25);
    var b: MHBody = mh_body(uv, t, px, sh);
    var V: vec3f = vec3f(0.0, 0.0, -1.0);
    var rd: vec3f = mh_look(V, b.N, tilt);
    var L: f32 = mh_exit(b.P, rd);
    var scale: f32 = (2.20 / S) * mix(1.0, 0.58, small);
    var warpScale: f32 = (1.30 / S) * mix(1.0, 0.60, small);
    var fold: f32 = ((0.30 + (0.70 * foldK)) * (1.0 + (0.75 * live.pace))) * mix(1.0, 0.55, small);
    var drB: f32 = 0.052 + (0.055 * foldK);
    var dr: f32 = (drB * (((t + (0.65 * sig.paceT)) + (0.35 * sig.voiceT)) + (0.90 * sig.driveT))) + ((mh_drift(t, drB, 0.45, 2.0) - (drB * t)) * (((1.0 + (0.65 * live.pace)) + (0.35 * live.voice)) + (0.90 * st.drive)));
    var adv: vec3f = vec3f(0.86, 0.24, -0.45) * ((st.drive * 0.42) * t);
    var absorb: f32 = 3.10 * (0.55 + (0.85 * densityK));
    var emit: f32 = 0.62 + (0.85 * densityK);
    var fl: vec4f = mh_flourish(t, 3.0, 7.2);
    var ga: f32 = fl.z * 6.2831853;
    var gp: vec3f = (0.46 * vec3f(cos(ga), 0.72 * sin((ga * 1.7) + 1.1), sin((ga * 0.9) + 2.7))) + (vec3f(0.0, -0.16, 0.06) * fl.y);
    var gw: f32 = ((0.130 + (0.045 * glintK)) * S) * mix(1.0, 1.65, small);
    var gAmp: f32 = (fl.x * (0.55 + (1.35 * glintK))) * mix(1.0, 1.55, small);
    var acc: vec2f = vec2f(0.0);
    var trans: f32 = 1.0;
    var ds: f32 = L / f32(5);
    for (var i: i32 = 0; i < 5; i++) {
        var p: vec3f = b.P + (rd * ((f32(i) + 0.5) * ds));
        var fade: f32 = mh_inside(p);
        if (fade <= 0.001) {
            continue;
        }
        var w: f32 = mh_noise3(((p * warpScale) + vec3f(0.0, dr * 0.70, dr)) - (adv * 0.5));
        var q: vec3f = (((p * scale) + ((w * fold) * vec3f(0.92, -0.58, 0.71))) + vec3f(0.0, 0.0, dr)) - adv;
        var n: f32 = mh_noise3(q);
        var dens: f32 = smoothstep(-0.20, 0.30, n) * fade;
        var glowIn: f32 = 0.30 + (0.95 * (1.0 - smoothstep(0.0, 0.88, length(p))));
        var e: f32 = ((dens * glowIn) * emit) * (1.0 + (0.75 * live.voice));
        if (st.complete > 0.001) {
            var sr: f32 = (length(p) - mix(0.02, 1.05, st.sweep)) / 0.24;
            e *= 1.0 + (0.65 * st.complete);
            e += ((st.complete * 0.50) * exp(-sr * sr)) * dens;
        }
        if (gAmp > 0.002) {
            var dg: vec3f = (p - gp) / max(gw, 1e-3);
            var garg: f32 = dot(dg, dg);
            e += gAmp * ((exp(-garg) * 0.75) + mh_scatter(garg, 0.22));
        }
        acc.x += (e * trans) * ds;
        acc.y += ((e * clamp(p.z, -1.0, 1.0)) * trans) * ds;
        trans *= exp(-((absorb * dens) + MH_EXT) * ds);
    }
    var interior: f32 = (((acc.x * 3.30) * b.m) * mh_transmit(b.fres)) * (1.0 + (0.20 * st.settled));
    var hue: f32 = ((select(0.0, acc.y / acc.x, acc.x > 1e-4)) * spreadK) * MH_SPREAD;
    var sf: MHSurface = mh_surface(b, t, small, inkColor, tilt, 0.78 + (0.35 * live.voice), 0.98, 0.15);
    var e: f32 = ((interior + sf.rim) + sf.spec) + sf.glow;
    var hueMix: f32 = (hue * (interior + (sf.rim * 0.7))) / max(e, 1e-4);
    var pal: MHPalette = mh_palette(inkColor, toneColor, tone2, hueShift, depth);
    return mh_present((e - sf.spec) - sf.glow, sf.spec, sf.glow, hueMix, uv, pal, glow, inkColor, position, pixelScale);
}

fn mh_prism(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, tilt: vec2f, tone2: vec4f, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var beamsK: f32 = clamp(c0, 0.0, 1.0);
    var splitK: f32 = clamp(c1, 0.0, 1.0);
    var driftK: f32 = clamp(c2, 0.0, 1.0);
    var spreadK: f32 = clamp(c3, 0.0, 1.0);
    var st: MHState = mh_state(stateIndex, stateTau);
    var live: MHLive = mh_live(level, activity, stateIndex);
    var small: f32 = mh_small(size);
    var px: f32 = 1.0 / ((max(min(size.x, size.y), 1.0) * max(pixelScale, 1.0)) * MH_R);
    var sh: MHShape = mh_shape(0.021 + (0.007 * mh_breath(t, 2.4)), 0.0, 1.20);
    var b: MHBody = mh_body(uv, t, px, sh);
    var V: vec3f = vec3f(0.0, 0.0, -1.0);
    var rd: vec3f = mh_look(V, b.N, tilt);
    var L: f32 = mh_exit(b.P, rd);
    var fl: vec4f = mh_flourish(t, 8.0, 9.1);
    var sw: f32 = mh_drift(t, 0.048 + (0.040 * driftK), 0.52, 4.0);
    var key: vec3f = mh_key(t);
    var O: vec3f = normalize(key + ((0.06 + (0.10 * driftK)) * vec3f(sin(sw), cos(sw * 0.83), sin(sw * 0.61)))) * 1.03;
    var axis: vec3f = normalize(vec3f(0.10, 0.62, 0.28) - O);
    var u1: vec3f = normalize(cross(axis, vec3f(0.0, 0.0, 1.0)) + vec3f(1e-4, 0.0, 0.0));
    var u2: vec3f = normalize(cross(axis, u1));
    var div: f32 = (((0.17 + (0.42 * splitK)) * mix(1.0, 1.35, small)) * (1.0 - (0.62 * st.drive))) * (1.0 + (0.55 * fl.x));
    var d0: vec3f = normalize((axis - (u1 * div)) + (u2 * (0.05 * sin(t * 0.071))));
    var d1: vec3f = normalize(axis + (u2 * (0.06 * sin((t * 0.043) + 1.1))));
    var d2: vec3f = normalize((axis + (u1 * div)) - (u2 * (0.05 * sin((t * 0.059) + 2.2))));
    var w0: f32 = (((0.038 + (0.035 * beamsK)) * S) * mix(1.0, 1.85, small)) * (1.0 + (0.30 * live.voice));
    var wGrow: f32 = 0.040 + (0.035 * beamsK);
    var third: f32 = 1.0 - smoothstep(0.30, 0.72, small);
    var bright: f32 = (0.76 + (0.65 * live.voice)) * (1.0 + (0.55 * st.drive));
    var shimGate: f32 = mh_aa((6.2831853 * 5.4) / (MH_R * S), size, pixelScale) * (1.0 - small);
    var shimAmt: f32 = (shimGate * 0.55) * live.pace;
    var medAmt: f32 = mix(0.058, 0.030, small);
    var acc: vec2f = vec2f(0.0);
    var trans: f32 = 1.0;
    var ds: f32 = L / f32(5);
    for (var i: i32 = 0; i < 5; i++) {
        var p: vec3f = b.P + (rd * ((f32(i) + 0.5) * ds));
        var fade: f32 = mh_inside(p);
        if (fade <= 0.001) {
            continue;
        }
        var v: vec3f = p - O;
        var vv: f32 = dot(v, v);
        var s0: f32 = dot(v, d0);
        var ww0: f32 = w0 + (wGrow * max(s0, 0.0));
        var a0: f32 = max(vv - (s0 * s0), 0.0) / (ww0 * ww0);
        var al0: f32 = smoothstep(0.12, 0.46, s0) * (1.0 - smoothstep(1.60, 2.35, s0));
        var e0: f32 = (exp(-a0) + mh_scatter(a0, 0.16)) * al0;
        var s1: f32 = dot(v, d1);
        var ww1: f32 = (w0 * 1.10) + (wGrow * max(s1, 0.0));
        var a1: f32 = max(vv - (s1 * s1), 0.0) / (ww1 * ww1);
        var al1: f32 = smoothstep(0.12, 0.46, s1) * (1.0 - smoothstep(1.60, 2.35, s1));
        var e1: f32 = (exp(-a1) + mh_scatter(a1, 0.16)) * al1;
        var e2: f32 = 0.0;
        var s2: f32 = 0.0;
        if (third > 0.002) {
            s2 = dot(v, d2);
            var ww2: f32 = w0 + (wGrow * max(s2, 0.0));
            var a2: f32 = max(vv - (s2 * s2), 0.0) / (ww2 * ww2);
            var al2: f32 = smoothstep(0.12, 0.46, s2) * (1.0 - smoothstep(1.60, 2.35, s2));
            e2 = ((exp(-a2) + mh_scatter(a2, 0.16)) * al2) * third;
        }
        var run: f32 = 1.0;
        if (shimAmt > 0.002) {
            run += shimAmt * sin((s1 * 5.4) - (t * 2.6));
        }
        var pulse: f32 = 0.0;
        if (fl.x > 0.002) {
            var pr: f32 = (s1 - (fl.y * 2.0)) / 0.28;
            pulse += (fl.x * 1.05) * exp(-pr * pr);
        }
        if (st.complete > 0.001) {
            var pr: f32 = (s1 - (st.sweep * 2.1)) / 0.26;
            pulse += (st.complete * 1.60) * exp(-pr * pr);
        }
        var beams: f32 = (((((e0 + e1) + e2) * bright) * run) * (1.0 + pulse)) * (1.0 + (1.10 * st.complete));
        var hueW: f32 = (((e0 * -1.0) + (e2 * 1.0)) * bright) * run;
        var med: f32 = mh_medium(p, t, 2.2 / S) * medAmt;
        var e: f32 = ((beams * 0.95) + med) * fade;
        acc.x += (e * trans) * ds;
        acc.y += (((hueW * 0.95) * fade) * trans) * ds;
        trans *= exp(-((2.60 * e) + MH_EXT) * ds);
    }
    var interior: f32 = (((acc.x * 2.45) * b.m) * mh_transmit(b.fres)) * (1.0 + (0.22 * st.settled));
    var hue: f32 = ((select(0.0, acc.y / acc.x, acc.x > 1e-4)) * spreadK) * MH_SPREAD;
    var sf: MHSurface = mh_surface(b, t, small, inkColor, tilt, 0.80 + (0.35 * live.voice), 0.62 + (0.25 * live.voice), 0.15);
    var e: f32 = ((interior + sf.rim) + sf.spec) + sf.glow;
    var hueMix: f32 = (hue * (interior + (sf.rim * 0.6))) / max(e, 1e-4);
    var pal: MHPalette = mh_palette(inkColor, toneColor, tone2, hueShift, depth);
    return mh_present((e - sf.spec) - sf.glow, sf.spec, sf.glow, hueMix, uv, pal, glow, inkColor, position, pixelScale);
}

fn mh_duet(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, tilt: vec2f, tone2: vec4f, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var sepK: f32 = clamp(c0, 0.0, 1.0);
    var orbitK: f32 = clamp(c1, 0.0, 1.0);
    var ratioK: f32 = clamp(c2, 0.0, 1.0);
    var spreadK: f32 = clamp(c3, 0.0, 1.0);
    var st: MHState = mh_state(stateIndex, stateTau);
    var live: MHLive = mh_live(level, activity, stateIndex);
    var small: f32 = mh_small(size);
    var px: f32 = 1.0 / ((max(min(size.x, size.y), 1.0) * max(pixelScale, 1.0)) * MH_R);
    var sh: MHShape = mh_shape(0.023 + (0.007 * mh_breath(t, 3.1)), 0.0, 1.25);
    var b: MHBody = mh_body(uv, t, px, sh);
    var V: vec3f = vec3f(0.0, 0.0, -1.0);
    var rd: vec3f = mh_look(V, b.N, tilt);
    var L: f32 = mh_exit(b.P, rd);
    var fl: vec4f = mh_flourish(t, 6.0, 8.3);
    var lean: f32 = 0.62 + (0.20 * sin(t * 0.037));
    var prec: f32 = mh_drift(t, 0.064, 0.45, 2.0);
    var e1: vec3f = mh_spin(vec3f(1.0, 0.0, 0.0), prec, 0.0);
    var e2: vec3f = mh_spin(vec3f(0.0, sin(lean), cos(lean)), prec, 0.0);
    var nrm: vec3f = cross(e1, e2);
    var r: f32 = (((((mix(0.30, 0.50, sepK) * mix(1.0, 1.36, small)) * S) * (1.0 - (0.14 * live.pace))) * (1.0 - (0.34 * st.drive))) * (1.0 - (0.30 * fl.x))) * (1.0 - (0.62 * st.complete));
    var rate: f32 = (0.40 + (0.55 * orbitK)) * (((1.0 + (0.55 * live.pace)) + (0.90 * st.drive)) + (0.85 * fl.x));
    var rateS: f32 = 0.40 + (0.55 * orbitK);
    var phL: f32 = rateS * (((0.55 * sig.paceT) + (0.90 * sig.driveT)) + (0.85 * mh_flourish_int(t, 6.0, 8.3)));
    var psi: f32 = mh_driftl(t, rateS, phL, rate, 0.40, 3.0);
    var braid: f32 = (((0.16 * st.drive) + (0.06 * fl.x)) * S) * sin(psi * 3.0);
    var spoke: vec3f = (cos(psi) * e1) + (sin(psi) * e2);
    var A: vec3f = (r * spoke) + (nrm * braid);
    var B: vec3f = (-r * spoke) - (nrm * braid);
    var wA: f32 = ((0.145 + (0.030 * sepK)) * S) * mix(1.0, 1.50, small);
    var wB: f32 = wA * mix(0.52, 1.0, mix(ratioK, 1.0, small * 0.65));
    var sway: f32 = 0.5 + (0.15 * sin(mh_drift(t, 0.21, 0.50, 7.0)));
    var bal: f32 = clamp(sway + (0.40 * live.voice), 0.06, 0.94);
    var brA: f32 = 2.0 * bal;
    var brB: f32 = 2.0 * (1.0 - bal);
    var toA: vec3f = A - b.P;
    var sA: f32 = dot(toA, rd);
    var argA: f32 = max(dot(toA, toA) - (sA * sA), 0.0) / max(wA * wA, 1e-6);
    var visA: f32 = select(0.0, mh_inside(b.P + (rd * sA)) * exp(-MH_EXT * sA), (sA > 0.0) && (sA < L));
    var coreA: f32 = exp(-argA) * visA;
    var toB: vec3f = B - b.P;
    var sB: f32 = dot(toB, rd);
    var argB: f32 = max(dot(toB, toB) - (sB * sB), 0.0) / max(wB * wB, 1e-6);
    var visB: f32 = select(0.0, mh_inside(b.P + (rd * sB)) * exp(-MH_EXT * sB), (sB > 0.0) && (sB < L));
    var coreB: f32 = exp(-argB) * visB;
    var occA: f32 = 1.0;
    var occB: f32 = 1.0;
    if (sA < sB) {
        occB = exp(-2.40 * coreA);
    } else {
        occA = exp(-2.40 * coreB);
    }
    var flare: f32 = 1.0 + (1.15 * st.complete);
    var eA: f32 = ((((coreA * 1.05) + (mh_scatter(argA, 0.30) * visA)) * brA) * occA) * flare;
    var eB: f32 = ((((coreB * 1.05) + (mh_scatter(argB, 0.30) * visB)) * brB) * occB) * flare;
    var medAmt: f32 = mix(0.085, 0.044, small);
    var acc: vec2f = vec2f(0.0);
    var trans: f32 = 1.0;
    var ds: f32 = L / f32(5);
    for (var i: i32 = 0; i < 5; i++) {
        var p: vec3f = b.P + (rd * ((f32(i) + 0.5) * ds));
        var fade: f32 = mh_inside(p);
        if (fade <= 0.001) {
            continue;
        }
        var med: f32 = mh_medium(p, t, 2.2 / S) * medAmt;
        var e: f32 = med;
        if (st.complete > 0.001) {
            var sr: f32 = (length(p) - mix(0.02, 1.0, st.sweep)) / 0.22;
            e += (st.complete * 0.26) * exp(-sr * sr);
        }
        acc.x += (e * trans) * ds;
        trans *= exp(-((2.20 * e) + MH_EXT) * ds);
    }
    var interior: f32 = (((((acc.x * 3.60) + eA) + eB) * b.m) * mh_transmit(b.fres)) * (1.0 + (0.20 * st.settled));
    var hueW: f32 = (eA * 0.85) - (eB * 1.0);
    var hue: f32 = ((select(0.0, hueW / max(eA + eB, 1e-4), interior > 1e-4)) * spreadK) * MH_SPREAD;
    var sf: MHSurface = mh_surface(b, t, small, inkColor, tilt, 0.80 + (0.35 * live.voice), 0.42, 0.15);
    var e: f32 = ((interior + sf.rim) + sf.spec) + sf.glow;
    var hueMix: f32 = (hue * (eA + eB)) / max(e, 1e-4);
    var pal: MHPalette = mh_palette(inkColor, toneColor, tone2, hueShift, depth);
    return mh_present((e - sf.spec) - sf.glow, sf.spec, sf.glow, hueMix, uv, pal, glow, inkColor, position, pixelScale);
}

fn mh_still(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, tilt: vec2f, tone2: vec4f, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var glintK: f32 = clamp(c0, 0.0, 1.0);
    var clarityK: f32 = clamp(c1, 0.0, 1.0);
    var presenceK: f32 = clamp(c2, 0.0, 1.0);
    var spreadK: f32 = clamp(c3, 0.0, 1.0);
    var st: MHState = mh_state(stateIndex, stateTau);
    var live: MHLive = mh_live(level, activity, stateIndex);
    var small: f32 = mh_small(size);
    var px: f32 = 1.0 / ((max(min(size.x, size.y), 1.0) * max(pixelScale, 1.0)) * MH_R);
    var sh: MHShape = mh_shape(0.018 + (0.006 * mh_breath(t, 4.2)), 0.0, 1.12);
    var b: MHBody = mh_body(uv, t, px, sh);
    var V: vec3f = vec3f(0.0, 0.0, -1.0);
    var rd: vec3f = mh_look(V, b.N, tilt);
    var L: f32 = mh_exit(b.P, rd);
    var slot: f32 = mix(11.5, 7.0, glintK) / ((1.0 + (0.30 * live.pace)) + (1.70 * st.drive));
    var fl: vec4f = mh_flourish(t, 5.0, slot);
    var ga: f32 = fl.z * 6.2831853;
    var dir: vec3f = normalize(mix(vec3f(cos(ga), 0.42 * sin(ga * 1.3), sin(ga)), vec3f(0.92, -0.18, 0.35), st.drive));
    var side: vec3f = normalize(cross(dir, vec3f(0.06, 1.0, 0.12)));
    var gp: vec3f = (side * ((0.34 * ((fl.z * 2.0) - 1.0)) * (1.0 - (0.7 * st.drive)))) + (dir * mix(-0.62, 0.62, smoothstep(0.0, 1.0, fl.y)));
    var gw: f32 = ((0.085 + (0.055 * glintK)) * S) * mix(1.0, 1.80, small);
    var gBright: f32 = (fl.x * (0.90 + (0.95 * live.voice))) * (1.0 + (0.85 * st.complete));
    var toG: vec3f = gp - b.P;
    var sG: f32 = dot(toG, rd);
    var glint: f32 = 0.0;
    if ((sG > 0.0) && (sG < L)) {
        var argG: f32 = max(dot(toG, toG) - (sG * sG), 0.0) / max(gw * gw, 1e-6);
        var visG: f32 = mh_inside(b.P + (rd * sG)) * exp(-MH_EXT * sG);
        glint = (((exp(-argG) * 1.05) + mh_scatter(argG, 0.38)) * visG) * gBright;
    }
    var floorAmt: f32 = (((0.016 + (0.085 * presenceK)) * (1.0 - (0.50 * clarityK))) * (1.0 + (0.55 * live.voice))) * mix(1.0, 1.50, small);
    var acc: vec2f = vec2f(0.0);
    var trans: f32 = 1.0;
    var ds: f32 = L / f32(5);
    for (var i: i32 = 0; i < 5; i++) {
        var p: vec3f = b.P + (rd * ((f32(i) + 0.5) * ds));
        var fade: f32 = mh_inside(p);
        if (fade <= 0.001) {
            continue;
        }
        var e: f32 = mh_medium(p, t, 1.9 / S) * floorAmt;
        if (st.complete > 0.001) {
            var sr: f32 = (length(p) - mix(0.02, 0.95, st.sweep)) / 0.26;
            e += (st.complete * 0.30) * exp(-sr * sr);
        }
        acc.x += (e * trans) * ds;
        acc.y += ((e * clamp(p.z, -1.0, 1.0)) * trans) * ds;
        trans *= exp(-((2.00 * e) + MH_EXT) * ds);
    }
    var interior: f32 = ((((acc.x * 3.40) + glint) * b.m) * mh_transmit(b.fres)) * (1.0 + (0.22 * st.settled));
    var hue: f32 = ((select(0.0, acc.y / acc.x, acc.x > 1e-4)) * spreadK) * MH_SPREAD;
    var sf: MHSurface = mh_surface(b, t, small, inkColor, tilt, 1.15 + (0.45 * live.voice), 1.30 + (0.35 * live.voice), 0.13);
    var e: f32 = ((interior + sf.rim) + sf.spec) + sf.glow;
    var hueMix: f32 = (hue * (interior + (sf.rim * 0.7))) / max(e, 1e-4);
    var pal: MHPalette = mh_palette(inkColor, toneColor, tone2, hueShift, depth);
    return mh_present((e - sf.spec) - sf.glow, sf.spec, sf.glow, hueMix, uv, pal, glow, inkColor, position, pixelScale);
}

fn mh_fathom(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, tilt: vec2f, tone2: vec4f, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var layersK: f32 = clamp(c0, 0.0, 1.0);
    var parallaxK: f32 = clamp(c1, 0.0, 1.0);
    var murkK: f32 = clamp(c2, 0.0, 1.0);
    var spreadK: f32 = clamp(c3, 0.0, 1.0);
    var st: MHState = mh_state(stateIndex, stateTau);
    var live: MHLive = mh_live(level, activity, stateIndex);
    var small: f32 = mh_small(size);
    var px: f32 = 1.0 / ((max(min(size.x, size.y), 1.0) * max(pixelScale, 1.0)) * MH_R);
    var sh: MHShape = mh_shape(0.021 + (0.007 * mh_breath(t, 5.3)), 0.0, 1.20);
    var b: MHBody = mh_body(uv, t, px, sh);
    var V: vec3f = vec3f(0.0, 0.0, -1.0);
    var rd: vec3f = mh_look(V, b.N, tilt);
    var L: f32 = mh_exit(b.P, rd);
    var fl: vec4f = mh_flourish(t, 9.0, 9.4);
    var key: vec3f = mh_key(t);
    var spanK: f32 = (1.0 + (0.22 * live.voice)) + (0.16 * fl.x);
    var R0: f32 = ((0.70 + (0.06 * layersK)) * spanK) * S;
    var R1: f32 = ((0.50 - (0.02 * layersK)) * spanK) * S;
    var R2: f32 = ((0.30 - (0.06 * layersK)) * spanK) * S;
    R0 = min(R0, 0.74);
    var third: f32 = 1.0 - smoothstep(0.28, 0.68, small);
    var thick: f32 = ((0.062 + (0.035 * layersK)) * S) * mix(1.0, 1.90, small);
    var foldAmp: f32 = (((0.055 + (0.055 * parallaxK)) * (1.0 + (0.55 * live.voice))) * mix(1.0, 0.50, small)) * S;
    var sp: f32 = (1.0 + (0.85 * live.pace)) + (1.10 * st.drive);
    var a0: f32 = mh_drift(t, 0.085 * sp, 0.45, 1.0);
    var a1: f32 = mix(mh_drift(t, -0.062 * sp, 0.50, 2.0), a0, st.drive * 0.7);
    var a2: f32 = mix(mh_drift(t, 0.108 * sp, 0.40, 3.0), a0, st.drive * 0.7);
    var bq: f32 = dot(b.P, rd);
    var PP: f32 = dot(b.P, b.P);
    var sN: array<f32, 3>;
    var sF: array<f32, 3>;
    var eN: array<f32, 3>;
    var eF: array<f32, 3>;
    var dN: array<vec3f, 3>;
    var dF: array<vec3f, 3>;
    for (var k: i32 = 0; k < 3; k++) {
        sN[k] = -1.0;
        sF[k] = -1.0;
        eN[k] = 0.0;
        eF[k] = 0.0;
        dN[k] = vec3f(0.0, 0.0, 1.0);
        dF[k] = vec3f(0.0, 0.0, 1.0);
    }
    var limbDir: vec3f = normalize(vec3f(b.P.xy, 0.02) + 1e-5);
    var RK: array<f32, 3>;
    {
        var axA: vec3f = normalize(vec3f(cos(a0), 0.42, sin(a0)));
        var axB: vec3f = normalize(vec3f(cos(a1), 0.42, sin(a1)));
        var axC: vec3f = normalize(vec3f(cos(a2), 0.42, sin(a2)));
        RK[0] = R0 + ((foldAmp * (R0 / max(R0, 1e-3))) * ((0.62 * sin((2.30 * dot(limbDir, axA)) + (a0 * 1.7))) + (0.38 * sin(((3.70 * dot(limbDir, axA.zxy)) - (a0 * 1.1)) + 2.1))));
        RK[1] = R1 + ((foldAmp * (R1 / max(R0, 1e-3))) * ((0.62 * sin((2.30 * dot(limbDir, axB)) + (a1 * 1.7))) + (0.38 * sin(((3.70 * dot(limbDir, axB.zxy)) - (a1 * 1.1)) + 2.1))));
        RK[2] = R2 + ((foldAmp * (R2 / max(R0, 1e-3))) * ((0.62 * sin((2.30 * dot(limbDir, axC)) + (a2 * 1.7))) + (0.38 * sin(((3.70 * dot(limbDir, axC.zxy)) - (a2 * 1.1)) + 2.1))));
    }
    var AK: array<f32, 3>;
    AK[0] = a0;
    AK[1] = a1;
    AK[2] = a2;
    var WK: array<f32, 3>;
    WK[0] = 1.0;
    WK[1] = 0.74;
    WK[2] = 0.52 * third;
    for (var k: i32 = 0; k < 3; k++) {
        if (WK[k] < 0.002) {
            continue;
        }
        var R: f32 = RK[k];
        var disc: f32 = ((bq * bq) - PP) + (R * R);
        if (disc <= 0.0) {
            continue;
        }
        var sq: f32 = sqrt(disc);
        var ss: array<f32, 2>;
        ss[0] = -bq - sq;
        ss[1] = -bq + sq;
        for (var h: i32 = 0; h < 2; h++) {
            var s: f32 = ss[h];
            if ((s <= 0.0) || (s >= L)) {
                continue;
            }
            var pt: vec3f = b.P + (rd * s);
            var dir: vec3f = normalize(pt + 1e-5);
            var ax: vec3f = vec3f(cos(AK[k]), 0.42, sin(AK[k]));
            ax = normalize(ax);
            var f: f32 = (0.62 * sin((2.30 * dot(dir, ax)) + (AK[k] * 1.7))) + (0.38 * sin(((3.70 * dot(dir, ax.zxy)) - (AK[k] * 1.1)) + 2.1));
            var g: f32 = dot(dir, rd);
            var graze: f32 = thick / max(abs(g), 0.26);
            var lit: f32 = 0.40 + (0.60 * clamp(dot(dir, key), 0.0, 1.0));
            var e: f32 = ((graze * (0.42 + (0.58 * (0.5 + (0.5 * f))))) * lit) * WK[k];
            if (st.complete > 0.001) {
                var turn: f32 = f32(2 - k) * 0.33;
                var w: f32 = 1.0 - smoothstep(0.0, 0.42, abs((st.sweep - turn) - 0.16));
                e *= 1.0 + (st.complete * (0.5 + (2.4 * w)));
            }
            if (h == 0) {
                sN[k] = s;
                eN[k] = e;
                dN[k] = dir;
            } else {
                sF[k] = s;
                eF[k] = e;
                dF[k] = dir;
            }
        }
    }
    var medAmt: f32 = (0.030 + (0.075 * murkK)) * mix(1.0, 0.70, small);
    var acc: vec2f = vec2f(0.0);
    var trans: f32 = 1.0;
    var ds: f32 = L / f32(5);
    for (var i: i32 = 0; i < 5; i++) {
        var p: vec3f = b.P + (rd * ((f32(i) + 0.5) * ds));
        var fade: f32 = mh_inside(p);
        if (fade <= 0.001) {
            continue;
        }
        var e: f32 = (mh_medium(p, t, 2.0 / S) * medAmt) * fade;
        acc.x += (e * trans) * ds;
        trans *= exp(-((1.80 * e) + MH_EXT) * ds);
    }
    var murkE: f32 = acc.x * 3.20;
    var shellE: f32 = 0.0;
    var shellH: f32 = 0.0;
    var tr: f32 = 1.0;
    var absorb: f32 = 1.05 + (1.55 * murkK);
    var order: array<i32, 6>;
    order[0] = 0;
    order[1] = 1;
    order[2] = 2;
    order[3] = 2;
    order[4] = 1;
    order[5] = 0;
    for (var i: i32 = 0; i < 6; i++) {
        var k: i32 = order[i];
        var nearHit: bool = i < 3;
        var s: f32 = select(sF[k], sN[k], nearHit);
        if (s < 0.0) {
            continue;
        }
        var e: f32 = (select(eF[k], eN[k], nearHit)) * exp(-MH_EXT * s);
        var dir: vec3f = select(dF[k], dN[k], vec3<bool>(nearHit));
        shellE += e * tr;
        shellH += (e * tr) * clamp(dir.z, -1.0, 1.0);
        tr *= exp(-absorb * e);
    }
    var interior: f32 = ((((shellE * 4.30) + murkE) * b.m) * mh_transmit(b.fres)) * (1.0 + (0.20 * st.settled));
    var hue: f32 = ((select(0.0, shellH / shellE, shellE > 1e-4)) * spreadK) * MH_SPREAD;
    var sf: MHSurface = mh_surface(b, t, small, inkColor, tilt, 0.78 + (0.35 * live.voice), 0.46, 0.14);
    var e: f32 = ((interior + sf.rim) + sf.spec) + sf.glow;
    var hueMix: f32 = (hue * (interior + (sf.rim * 0.7))) / max(e, 1e-4);
    var pal: MHPalette = mh_palette(inkColor, toneColor, tone2, hueShift, depth);
    return mh_present(interior + sf.rim, sf.spec, sf.glow, hueMix, uv, pal, glow, inkColor, position, pixelScale);
}

fn mh_arc(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, tilt: vec2f, tone2: vec4f, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var lengthK: f32 = clamp(c0, 0.0, 1.0);
    var swayK: f32 = clamp(c1, 0.0, 1.0);
    var pinK: f32 = clamp(c2, 0.0, 1.0);
    var spreadK: f32 = clamp(c3, 0.0, 1.0);
    var st: MHState = mh_state(stateIndex, stateTau);
    var live: MHLive = mh_live(level, activity, stateIndex);
    var small: f32 = mh_small(size);
    var px: f32 = 1.0 / ((max(min(size.x, size.y), 1.0) * max(pixelScale, 1.0)) * MH_R);
    var sh: MHShape = mh_shape(0.021 + (0.007 * mh_breath(t, 6.1)), 0.0, 1.20);
    var b: MHBody = mh_body(uv, t, px, sh);
    var V: vec3f = vec3f(0.0, 0.0, -1.0);
    var rd: vec3f = mh_look(V, b.N, tilt);
    var L: f32 = mh_exit(b.P, rd);
    var fl: vec4f = mh_flourish(t, 11.0, 8.1);
    var sway: f32 = (0.30 + (0.60 * swayK)) * (1.0 - (0.55 * st.drive));
    var ro: f32 = 0.55 + ((sway * 0.9) * sin(mh_drift(t, 0.052, 0.5, 1.0)));
    var ay: f32 = mh_drift(t, 0.041, 0.55, 2.0);
    var ax: f32 = 0.30 + ((sway * 0.5) * sin((t * 0.037) + 2.2));
    var pin: f32 = (mix(0.30, 0.05, pinK) * ((1.0 + (0.30 * live.voice)) + (0.35 * fl.x))) * (1.0 - (0.40 * st.drive));
    var Rc: f32 = (0.58 + (0.14 * lengthK)) * S;
    var span: f32 = (1.15 + (0.35 * lengthK)) * mix(1.0, 0.78, small);
    var cz: f32 = (pin * S) - Rc;
    var w: f32 = ((0.042 + (0.022 * lengthK)) * S) * mix(1.0, 1.90, small);
    var bright: f32 = (0.90 + (0.85 * live.voice)) * (1.0 + (0.45 * fl.x));
    var shimGate: f32 = mh_aa((6.2831853 * 4.2) / (MH_R * S), size, pixelScale) * (1.0 - small);
    var shimAmt: f32 = shimGate * ((0.55 * live.pace) + (0.75 * st.drive));
    var medAmt: f32 = mix(0.055, 0.030, small);
    var Pa: vec3f = mh_spin(mh_roll(b.P, ro), ay, ax);
    var Ra: vec3f = mh_spin(mh_roll(rd, ro), ay, ax);
    const NS: i32 = 20;
    var gv: array<f32, NS>;
    var tv: array<f32, NS>;
    var sv: array<f32, NS>;
    for (var i: i32 = 0; i < NS; i++) {
        var th: f32 = -span + ((2.0 * span) * (f32(i) / f32(NS - 1)));
        var C: vec3f = vec3f(Rc * sin(th), cz + (Rc * cos(th)), 0.0);
        var D: vec3f = C - Pa;
        var sc: f32 = dot(D, Ra);
        gv[i] = dot(D, D) - (sc * sc);
        tv[i] = th;
        sv[i] = sc;
    }
    var dth: f32 = (2.0 * span) / f32(NS - 1);
    var filE: f32 = 0.0;
    var filH: f32 = 0.0;
    var thPick: array<f32, 2>;
    thPick[0] = 0.0;
    thPick[1] = 0.0;
    var partE: array<f32, 2>;
    partE[0] = 0.0;
    partE[1] = 0.0;
    for (var hf: i32 = 0; hf < 2; hf++) {
        var lo: i32 = hf * 10;
        var hi: i32 = lo + 9;
        var bi: i32 = lo;
        for (var i: i32 = lo + 1; i <= hi; i++) {
            if (gv[i] < gv[bi]) {
                bi = i;
            }
        }
        var ci: i32 = clamp(bi, 1, NS - 2);
        var y0: f32 = gv[ci - 1];
        var y1: f32 = gv[ci];
        var y2: f32 = gv[ci + 1];
        var den: f32 = (y0 - (2.0 * y1)) + y2;
        var off: f32 = select(0.0, clamp((0.5 * (y0 - y2)) / den, -1.0, 1.0), abs(den) > 1e-7);
        var th: f32 = clamp(tv[ci] + (off * dth), -span, span);
        var C: vec3f = vec3f(Rc * sin(th), cz + (Rc * cos(th)), 0.0);
        var D: vec3f = C - Pa;
        var sc: f32 = dot(D, Ra);
        var perp2: f32 = max(dot(D, D) - (sc * sc), 0.0);
        thPick[hf] = th;
        if ((sc <= 0.0) || (sc >= L)) {
            continue;
        }
        var u: f32 = clamp(abs(th) / max(span, 1e-3), 0.0, 1.0);
        var prof: f32 = pow(max(1.0 - (u * u), 0.0), 0.85);
        var wl: f32 = w * (0.28 + (0.72 * prof));
        var T: vec3f = vec3f(cos(th), -sin(th), 0.0);
        var sinA: f32 = max(length(cross(Ra, T)), 0.58);
        var run: f32 = 1.0;
        if (shimAmt > 0.002) {
            run += shimAmt * sin((th * 4.2) - (t * 2.4));
        }
        var pulse: f32 = 0.0;
        if (fl.x > 0.002) {
            var pr: f32 = (th - mix(-span, span, fl.y)) / 0.34;
            pulse += (fl.x * 0.95) * exp(-pr * pr);
        }
        if (st.complete > 0.001) {
            var pr: f32 = (th - mix(-span, span, st.sweep)) / 0.30;
            pulse += (st.complete * 1.80) * exp(-pr * pr);
        }
        var ws: f32 = wl / sqrt(MH_SCATTER_K);
        const SQRTPI: f32 = 1.7724539;
        var core: f32 = ((wl * SQRTPI) / sinA) * exp(-perp2 / (wl * wl));
        var halo: f32 = (0.09 * ((ws * SQRTPI) / sinA)) * exp(-perp2 / (ws * ws));
        var vis: f32 = mh_inside(Pa + (Ra * sc)) * exp(-MH_EXT * sc);
        var e: f32 = (((((core + halo) * pow(prof, 1.35)) * bright) * run) * (1.0 + pulse)) * vis;
        partE[hf] = e;
        filH += e * clamp(th / max(span, 1e-3), -1.0, 1.0);
    }
    var sep: f32 = smoothstep(0.16, 0.44, abs(thPick[0] - thPick[1]));
    filE = partE[0] + (partE[1] * sep);
    filH = (partE[0] * clamp(thPick[0] / max(span, 1e-3), -1.0, 1.0)) + ((partE[1] * sep) * clamp(thPick[1] / max(span, 1e-3), -1.0, 1.0));
    var acc: vec2f = vec2f(0.0);
    var trans: f32 = 1.0;
    var ds: f32 = L / f32(5);
    for (var i: i32 = 0; i < 5; i++) {
        var p: vec3f = b.P + (rd * ((f32(i) + 0.5) * ds));
        var fade: f32 = mh_inside(p);
        if (fade <= 0.001) {
            continue;
        }
        var e: f32 = mh_medium(p, t, 2.0 / S) * medAmt;
        acc.x += (e * trans) * ds;
        trans *= exp(-((2.00 * e) + MH_EXT) * ds);
    }
    var interior: f32 = (((((acc.x * 3.40) + ((filE * 35.0) * mix(1.0, 0.52, small))) * b.m) * mh_transmit(b.fres)) * (1.0 + (0.9 * st.complete))) * (1.0 + (0.22 * st.settled));
    var hue: f32 = ((select(0.0, filH / filE, filE > 1e-5)) * spreadK) * MH_SPREAD;
    var sf: MHSurface = mh_surface(b, t, small, inkColor, tilt, 0.80 + (0.35 * live.voice), 0.30, 0.14);
    var e: f32 = ((interior + sf.rim) + sf.spec) + sf.glow;
    var hueMix: f32 = (hue * ((filE * 35.0) * mix(1.0, 0.52, small))) / max(e, 1e-4);
    var pal: MHPalette = mh_palette(inkColor, toneColor, tone2, hueShift, depth);
    return mh_present(interior + sf.rim, sf.spec, sf.glow, hueMix, uv, pal, glow, inkColor, position, pixelScale);
}

fn mh_opal(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, tilt: vec2f, tone2: vec4f, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var flashK: f32 = clamp(c0, 0.0, 1.0);
    var driftK: f32 = clamp(c1, 0.0, 1.0);
    var softK: f32 = clamp(c2, 0.0, 1.0);
    var spreadK: f32 = clamp(c3, 0.0, 1.0);
    var st: MHState = mh_state(stateIndex, stateTau);
    var live: MHLive = mh_live(level, activity, stateIndex);
    var small: f32 = mh_small(size);
    var px: f32 = 1.0 / ((max(min(size.x, size.y), 1.0) * max(pixelScale, 1.0)) * MH_R);
    var sh: MHShape = mh_shape(0.022 + (0.008 * mh_breath(t, 7.4)), 0.0, 1.22);
    var b: MHBody = mh_body(uv, t, px, sh);
    var V: vec3f = vec3f(0.0, 0.0, -1.0);
    var rd: vec3f = mh_look(V, b.N, tilt);
    var L: f32 = mh_exit(b.P, rd);
    var fl: vec4f = mh_flourish(t, 13.0, 10.6);
    var drift: f32 = (0.055 + (0.075 * driftK)) * ((1.0 + (0.75 * live.pace)) + (0.95 * st.drive));
    var driftT: f32 = (0.055 + (0.075 * driftK)) * ((t + (0.75 * sig.paceT)) + (0.95 * sig.driveT));
    var rad: f32 = (((0.135 + (0.095 * softK)) * S) * mix(1.0, 1.70, small)) * (1.0 + (0.30 * live.voice));
    var bright: f32 = (0.82 + (0.55 * flashK)) * (1.0 + (0.85 * live.voice));
    var pairB: f32 = 1.0 - smoothstep(0.30, 0.72, small);
    var spreadAmt: f32 = (spreadK * MH_SPREAD) * 1.30;
    var flashE: f32 = 0.0;
    var flashH: f32 = 0.0;
    for (var k: i32 = 0; k < 4; k++) {
        var w: f32 = select(pairB, 1.0, k < 2);
        if (w < 0.002) {
            continue;
        }
        var fk: f32 = f32(k);
        var per: f32 = 14.3 + (2.7 * fk);
        var ph: f32 = fk * 1.97;
        var sn: f32 = sin(((6.2831853 * t) / per) + ph);
        var life: f32 = 0.16 + ((0.84 * sn) * sn);
        life = mix(life, 0.30 + (0.70 * max(sin(((6.2831853 * t) / 5.2) - (fk * 1.4)), 0.0)), st.drive);
        life = mix(life, 1.0, st.complete * 0.85);
        var c: vec3f = vec3f(0.44 * sin((driftT * (0.83 + (0.11 * fk))) + (fk * 2.1)), 0.40 * sin(((driftT * (0.67 + (0.13 * fk))) + (fk * 3.7)) + 1.1), 0.42 * sin(((driftT * (0.95 + (0.09 * fk))) + (fk * 1.3)) + 2.6));
        c = mix(c, (c * 0.55) + (vec3f(0.42, -0.10, 0.18) * sin(((6.2831853 * t) / 5.2) - (fk * 1.4))), st.drive);
        var rk: f32 = (rad * (0.80 + (0.30 * fract((fk * 0.37) + 0.21)))) * (1.0 + ((0.35 * fl.x) * step(fk, 0.5)));
        var to: vec3f = c - b.P;
        var s: f32 = dot(to, rd);
        if ((s <= 0.0) || (s >= L)) {
            continue;
        }
        var arg: f32 = max(dot(to, to) - (s * s), 0.0) / max(rk * rk, 1e-6);
        var vis: f32 = mh_inside(b.P + (rd * s)) * exp(-MH_EXT * s);
        var e: f32 = (((((exp(-arg) * 0.55) + mh_scatter(arg, 0.46)) * vis) * life) * bright) * w;
        flashE += e;
        var hueK: f32 = (fk - 1.5) / 1.5;
        flashH += e * hueK;
    }
    var medAmt: f32 = mix(0.060, 0.032, small);
    var acc: vec2f = vec2f(0.0);
    var trans: f32 = 1.0;
    var ds: f32 = L / f32(5);
    for (var i: i32 = 0; i < 5; i++) {
        var p: vec3f = b.P + (rd * ((f32(i) + 0.5) * ds));
        var fade: f32 = mh_inside(p);
        if (fade <= 0.001) {
            continue;
        }
        var e: f32 = mh_medium(p, t, 2.1 / S) * medAmt;
        if (st.complete > 0.001) {
            var sr: f32 = (length(p) - mix(0.02, 1.0, st.sweep)) / 0.24;
            e += (st.complete * 0.30) * exp(-sr * sr);
        }
        acc.x += (e * trans) * ds;
        trans *= exp(-((2.00 * e) + MH_EXT) * ds);
    }
    var interior: f32 = ((((acc.x * 3.40) + flashE) * b.m) * mh_transmit(b.fres)) * (1.0 + (0.22 * st.settled));
    var hue: f32 = (select(0.0, flashH / flashE, flashE > 1e-4)) * spreadAmt;
    var sf: MHSurface = mh_surface(b, t, small, inkColor, tilt, 0.80 + (0.35 * live.voice), 0.52, 0.14);
    var e: f32 = ((interior + sf.rim) + sf.spec) + sf.glow;
    var hueMix: f32 = (hue * flashE) / max(e, 1e-4);
    var pal: MHPalette = mh_palette(inkColor, toneColor, tone2, hueShift, depth);
    return mh_present(interior + sf.rim, sf.spec, sf.glow, hueMix, uv, pal, glow, inkColor, position, pixelScale);
}

fn mh_flux(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, tilt: vec2f, tone2: vec4f, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var streamK: f32 = clamp(c0, 0.0, 1.0);
    var bendK: f32 = clamp(c1, 0.0, 1.0);
    var heightK: f32 = clamp(c2, 0.0, 1.0);
    var spreadK: f32 = clamp(c3, 0.0, 1.0);
    var st: MHState = mh_state(stateIndex, stateTau);
    var live: MHLive = mh_live(level, activity, stateIndex);
    var small: f32 = mh_small(size);
    var px: f32 = 1.0 / ((max(min(size.x, size.y), 1.0) * max(pixelScale, 1.0)) * MH_R);
    var sh: MHShape = mh_shape(0.022 + (0.008 * mh_breath(t, 8.6)), 0.0, 1.22);
    var b: MHBody = mh_body(uv, t, px, sh);
    var V: vec3f = vec3f(0.0, 0.0, -1.0);
    var rd: vec3f = mh_look(V, b.N, tilt);
    var L: f32 = mh_exit(b.P, rd);
    var fl: vec4f = mh_flourish(t, 15.0, 11.3);
    var ay: f32 = mix(mh_drift(t, 0.047, 0.50, 2.0), 0.42, st.drive * 0.6);
    var ax: f32 = 0.16 + (0.10 * sin(t * 0.033));
    var flB: f32 = 0.26 + (0.34 * streamK);
    var flow: f32 = (flB * ((t + (0.70 * sig.paceT)) + (0.95 * sig.driveT))) + ((mh_drift(t, flB, 0.45, 4.0) - (flB * t)) * ((1.0 + (0.70 * live.pace)) + (0.95 * st.drive)));
    var bend: f32 = ((0.30 + (0.42 * bendK)) * (1.0 + (0.45 * live.pace))) * mix(1.0, 0.50, small);
    var w: f32 = ((0.105 + (0.030 * bendK)) * S) * mix(1.0, 2.00, small);
    var hi: f32 = (0.42 + (0.46 * heightK)) * (1.0 + (0.45 * live.voice));
    var second: f32 = 1.0 - smoothstep(0.34, 0.76, small);
    var third: f32 = 1.0 - smoothstep(0.16, 0.54, small);
    var bright: f32 = (0.80 + (0.80 * live.voice)) * (1.0 + (0.35 * st.drive));
    var striGate: f32 = mh_aa((6.2831853 * 6.5) / (MH_R * S), size, pixelScale) * (1.0 - small);
    var medAmt: f32 = mix(0.055, 0.030, small);
    var acc: vec2f = vec2f(0.0);
    var trans: f32 = 1.0;
    var ds: f32 = L / f32(5);
    for (var i: i32 = 0; i < 5; i++) {
        var p: vec3f = b.P + (rd * ((f32(i) + 0.5) * ds));
        var fade: f32 = mh_inside(p);
        if (fade <= 0.001) {
            continue;
        }
        var q: vec3f = mh_spin(p, ay, ax) / S;
        var yy: f32 = -q.y;
        var foot: f32 = smoothstep(-0.92, -0.52, yy);
        var rise: f32 = exp(-max(yy + 0.52, 0.0) / max(hi, 1e-3));
        var vert: f32 = foot * rise;
        var d0: f32 = q.x - (-0.34 + (bend * ((0.55 * sin((1.10 * yy) + flow)) + (0.95 * sin(((1.15 * q.z) - (flow * 0.7)) + 2.1)))));
        var d1: f32 = q.x - (0.04 + (bend * ((0.55 * sin(((0.85 * yy) + (flow * 1.18)) + 2.4)) + (1.00 * sin(((1.55 * q.z) - (flow * 0.6)) + 4.3)))));
        var d2: f32 = q.x - (0.40 + (bend * ((0.55 * sin(((1.35 * yy) + (flow * 0.86)) + 4.7)) + (0.90 * sin(((0.95 * q.z) - (flow * 0.9)) + 1.4)))));
        var a0: f32 = (d0 * d0) / (w * w);
        var a1: f32 = (d1 * d1) / ((w * w) * 1.25);
        var a2: f32 = (d2 * d2) / ((w * w) * 0.85);
        var e0: f32 = exp(-a0) + mh_scatter(a0, 0.20);
        var e1: f32 = (exp(-a1) + mh_scatter(a1, 0.20)) * second;
        var e2: f32 = (exp(-a2) + mh_scatter(a2, 0.20)) * third;
        var stri: f32 = 1.0;
        if (striGate > 0.002) {
            stri += (striGate * 0.32) * sin(((q.z * 6.5) + (yy * 1.7)) - (flow * 1.4));
        }
        var surge: f32 = 0.0;
        if (fl.x > 0.002) {
            var sr: f32 = (q.x - mix(-0.9, 0.9, fl.y)) / 0.42;
            surge += (fl.x * 0.85) * exp(-sr * sr);
        }
        if (st.complete > 0.001) {
            var sr: f32 = (q.x - mix(-1.0, 1.0, st.sweep)) / 0.38;
            surge += (st.complete * 1.70) * exp(-sr * sr);
        }
        var curtains: f32 = (((((e0 + e1) + e2) * vert) * bright) * stri) * (1.0 + surge);
        var hueW: f32 = (((((e0 * -1.0) + (e1 * 0.15)) + (e2 * 1.0)) * vert) * bright) * stri;
        var med: f32 = mh_medium(p, t, 2.1 / S) * medAmt;
        var e: f32 = ((curtains * 0.85) + med) * fade;
        acc.x += (e * trans) * ds;
        acc.y += (((hueW * 0.85) * fade) * trans) * ds;
        trans *= exp(-((2.90 * e) + MH_EXT) * ds);
    }
    var interior: f32 = ((((acc.x * 2.40) * b.m) * mh_transmit(b.fres)) * (1.0 + (0.75 * st.complete))) * (1.0 + (0.22 * st.settled));
    var hue: f32 = ((select(0.0, acc.y / acc.x, acc.x > 1e-4)) * spreadK) * MH_SPREAD;
    var sf: MHSurface = mh_surface(b, t, small, inkColor, tilt, 0.80 + (0.35 * live.voice), 0.55, 0.14);
    var e: f32 = ((interior + sf.rim) + sf.spec) + sf.glow;
    var hueMix: f32 = (hue * (interior + (sf.rim * 0.7))) / max(e, 1e-4);
    var pal: MHPalette = mh_palette(inkColor, toneColor, tone2, hueShift, depth);
    return mh_present(interior + sf.rim, sf.spec, sf.glow, hueMix, uv, pal, glow, inkColor, position, pixelScale);
}

fn mh_tempest(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, tilt: vec2f, tone2: vec4f, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var stormK: f32 = clamp(c0, 0.0, 1.0);
    var churnK: f32 = clamp(c1, 0.0, 1.0);
    var flickerK: f32 = clamp(c2, 0.0, 1.0);
    var spreadK: f32 = clamp(c3, 0.0, 1.0);
    var st: MHState = mh_state(stateIndex, stateTau);
    var live: MHLive = mh_live(level, activity, stateIndex);
    var small: f32 = mh_small(size);
    var px: f32 = 1.0 / ((max(min(size.x, size.y), 1.0) * max(pixelScale, 1.0)) * MH_R);
    var think: f32 = select(0.0, 1.0, (stateIndex > 1.5) && (stateIndex < 2.5));
    var energy: f32 = clamp(((0.85 * live.pace) + (0.65 * think)) + (0.55 * st.drive), 0.0, 1.6);
    var sh: MHShape = mh_shape(0.023 + (0.009 * mh_breath(t, 9.2)), 0.0, 1.28);
    var b: MHBody = mh_body(uv, t, px, sh);
    var V: vec3f = vec3f(0.0, 0.0, -1.0);
    var rd: vec3f = mh_look(V, b.N, tilt);
    var L: f32 = mh_exit(b.P, rd);
    var scale: f32 = (2.55 / S) * mix(1.0, 0.55, small);
    var warpScale: f32 = (1.45 / S) * mix(1.0, 0.58, small);
    var fold: f32 = ((0.42 + (0.80 * churnK)) * (1.0 + (0.85 * energy))) * mix(1.0, 0.50, small);
    var dr: f32 = mh_drift(t, 0.070 + (0.075 * churnK), 0.42, 3.0) * (1.0 + (0.95 * energy));
    var adv: vec3f = vec3f(0.88, 0.20, -0.43) * ((st.drive * 0.50) * t);
    var absorb: f32 = 3.60 * (0.55 + (0.85 * stormK));
    var emit: f32 = 0.58 + (0.72 * stormK);
    var rate: f32 = 1.0 / (1.0 + (1.30 * energy));
    var f0: vec4f = mh_flourish(t, 21.0, mix(2.9, 5.2, small) * rate);
    var f1: vec4f = mh_flourish(t, 27.0, mix(4.3, 7.4, small) * rate);
    var fw: f32 = ((0.150 + (0.070 * flickerK)) * S) * mix(1.0, 1.65, small);
    var fAmp: f32 = (0.85 + (2.80 * flickerK)) * (1.0 + (0.45 * energy));
    var g0: vec3f = 0.40 * vec3f(cos(f0.z * 6.283), 0.75 * sin((f0.z * 9.1) + 1.1), sin((f0.z * 5.3) + 2.7));
    var g1: vec3f = 0.40 * vec3f(cos((f1.z * 7.7) + 2.2), 0.75 * sin((f1.z * 6.4) + 3.9), sin((f1.z * 8.8) + 0.4));
    var acc: vec2f = vec2f(0.0);
    var trans: f32 = 1.0;
    var ds: f32 = L / f32(5);
    for (var i: i32 = 0; i < 5; i++) {
        var p: vec3f = b.P + (rd * ((f32(i) + 0.5) * ds));
        var fade: f32 = mh_inside(p);
        if (fade <= 0.001) {
            continue;
        }
        var w: f32 = mh_noise3(((p * warpScale) + vec3f(0.0, dr * 0.65, dr)) - (adv * 0.5));
        var q: vec3f = (((p * scale) + ((w * fold) * vec3f(0.90, -0.62, 0.68))) + vec3f(0.0, 0.0, dr)) - adv;
        var n: f32 = mh_noise3(q);
        var dens: f32 = smoothstep(-0.12, 0.46, n) * fade;
        var glowIn: f32 = 0.26 + (0.72 * (1.0 - smoothstep(0.0, 0.90, length(p))));
        var e: f32 = ((dens * glowIn) * emit) * (1.0 + (0.85 * live.voice));
        var deep: f32 = 1.0 - smoothstep(0.35, 0.62, length(p));
        if (deep > 0.002) {
            var d0: vec3f = (p - g0) / max(fw, 1e-3);
            var d1: vec3f = (p - g1) / max(fw, 1e-3);
            var a0: f32 = dot(d0, d0);
            var a1: f32 = dot(d1, d1);
            var bolt: f32 = (f0.x * ((exp(-a0) * 0.42) + mh_scatter(a0, 0.62))) + (f1.x * ((exp(-a1) * 0.42) + mh_scatter(a1, 0.62)));
            e += ((bolt * fAmp) * deep) * (0.30 + (0.85 * dens));
        }
        if (st.complete > 0.001) {
            var sr: f32 = (length(p) - mix(0.02, 1.05, st.sweep)) / 0.24;
            e *= 1.0 + (0.70 * st.complete);
            e += ((st.complete * 0.55) * exp(-sr * sr)) * dens;
        }
        acc.x += (e * trans) * ds;
        acc.y += ((e * clamp(p.z, -1.0, 1.0)) * trans) * ds;
        trans *= exp(-((absorb * dens) + MH_EXT) * ds);
    }
    var interior: f32 = (((acc.x * 6.20) * b.m) * mh_transmit(b.fres)) * (1.0 + (0.20 * st.settled));
    var hue: f32 = ((select(0.0, acc.y / acc.x, acc.x > 1e-4)) * spreadK) * MH_SPREAD;
    var sf: MHSurface = mh_surface(b, t, small, inkColor, tilt, 0.80 + (0.35 * live.voice), 0.66, 0.15);
    var e: f32 = ((interior + sf.rim) + sf.spec) + sf.glow;
    var hueMix: f32 = (hue * (interior + (sf.rim * 0.7))) / max(e, 1e-4);
    var pal: MHPalette = mh_palette(inkColor, toneColor, tone2, hueShift, depth);
    return mh_present(interior + sf.rim, sf.spec, sf.glow, hueMix, uv, pal, glow, inkColor, position, pixelScale);
}

fn mh_helix(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, tilt: vec2f, tone2: vec4f, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var turnsK: f32 = clamp(c0, 0.0, 1.0);
    var riseK: f32 = clamp(c1, 0.0, 1.0);
    var glowK: f32 = clamp(c2, 0.0, 1.0);
    var spreadK: f32 = clamp(c3, 0.0, 1.0);
    var st: MHState = mh_state(stateIndex, stateTau);
    var live: MHLive = mh_live(level, activity, stateIndex);
    var small: f32 = mh_small(size);
    var px: f32 = 1.0 / ((max(min(size.x, size.y), 1.0) * max(pixelScale, 1.0)) * MH_R);
    var sh: MHShape = mh_shape(0.021 + (0.007 * mh_breath(t, 10.4)), 0.0, 1.20);
    var b: MHBody = mh_body(uv, t, px, sh);
    var V: vec3f = vec3f(0.0, 0.0, -1.0);
    var rd: vec3f = mh_look(V, b.N, tilt);
    var L: f32 = mh_exit(b.P, rd);
    var fl: vec4f = mh_flourish(t, 17.0, 9.3);
    var ay: f32 = mh_drift(t, 0.055, 0.50, 2.0);
    var ax: f32 = 0.06 + (0.05 * sin(t * 0.031));
    var turns: f32 = ((1.75 + (1.10 * turnsK)) * mix(1.0, 0.50, small)) * ((1.0 + (0.35 * st.drive)) + (0.20 * fl.x));
    var clB: f32 = (0.20 + (0.30 * riseK)) * mix(1.0, 0.70, small);
    var climb: f32 = (clB * ((t + (0.75 * sig.paceT)) + (0.85 * sig.driveT))) + ((mh_drift(t, clB, 0.44, 5.0) - (clB * t)) * ((1.0 + (0.75 * live.pace)) + (0.85 * st.drive)));
    var r0: f32 = ((0.42 + (0.10 * turnsK)) * S) * ((1.0 - (0.14 * st.drive)) - (0.10 * fl.x));
    var w: f32 = (((0.062 + (0.022 * glowK)) * S) * mix(1.0, 1.90, small)) * (1.0 + (0.25 * live.voice));
    var bright: f32 = (0.80 + (0.65 * glowK)) * (1.0 + (0.80 * live.voice));
    const TAPS: i32 = 20;
    var acc: vec2f = vec2f(0.0);
    var trans: f32 = 1.0;
    var ds: f32 = L / f32(TAPS);
    for (var i: i32 = 0; i < TAPS; i++) {
        var p: vec3f = b.P + (rd * ((f32(i) + 0.5) * ds));
        var fade: f32 = mh_inside(p);
        if (fade <= 0.001) {
            continue;
        }
        var q: vec3f = mh_spin(p, ay, ax) / S;
        var u: f32 = clamp(abs(q.y) / 0.88, 0.0, 1.0);
        var prof: f32 = pow(max(1.0 - (u * u), 0.0), 0.80);
        if (prof <= 0.002) {
            continue;
        }
        var wl: f32 = w * (0.30 + (0.70 * prof));
        var phi: f32 = ((turns * q.y) * 3.14159265) + climb;
        var cp: f32 = cos(phi);
        var sp: f32 = sin(phi);
        var c0p: vec2f = vec2f(r0 * cp, r0 * sp);
        var d0v: vec2f = q.xz - c0p;
        var d1v: vec2f = q.xz + c0p;
        var a0: f32 = dot(d0v, d0v) / (wl * wl);
        var a1: f32 = dot(d1v, d1v) / (wl * wl);
        var lift: f32 = 1.0;
        if (st.complete > 0.001) {
            var sr: f32 = (q.y - mix(-1.0, 1.0, st.sweep)) / 0.26;
            lift += st.complete * (0.35 + (2.10 * exp(-sr * sr)));
        }
        var e0: f32 = (exp(-a0) + mh_scatter(a0, 0.16)) * prof;
        var e1: f32 = (exp(-a1) + mh_scatter(a1, 0.16)) * prof;
        var strands: f32 = ((e0 + e1) * bright) * lift;
        var hueW: f32 = ((e1 - e0) * bright) * lift;
        var e: f32 = (strands * 0.80) * fade;
        acc.x += (e * trans) * ds;
        acc.y += (((hueW * 0.80) * fade) * trans) * ds;
        trans *= exp(-((3.00 * e) + MH_EXT) * ds);
    }
    var medAmt: f32 = mix(0.020, 0.012, small);
    var medE: f32 = 0.0;
    var mtrans: f32 = 1.0;
    var mds: f32 = L / f32(5);
    for (var i: i32 = 0; i < 5; i++) {
        var p: vec3f = b.P + (rd * ((f32(i) + 0.5) * mds));
        var fade: f32 = mh_inside(p);
        if (fade <= 0.001) {
            continue;
        }
        var e: f32 = mh_medium(p, t, 2.1 / S) * medAmt;
        medE += (e * mtrans) * mds;
        mtrans *= exp(-((2.00 * e) + MH_EXT) * mds);
    }
    acc.x += medE;
    var interior: f32 = (((acc.x * 5.60) * b.m) * mh_transmit(b.fres)) * (1.0 + (0.22 * st.settled));
    var hue: f32 = ((select(0.0, acc.y / acc.x, acc.x > 1e-4)) * spreadK) * MH_SPREAD;
    var sf: MHSurface = mh_surface(b, t, small, inkColor, tilt, 0.60 + (0.28 * live.voice), 0.38, 0.12);
    var e: f32 = ((interior + sf.rim) + sf.spec) + sf.glow;
    var hueMix: f32 = (hue * (interior + (sf.rim * 0.7))) / max(e, 1e-4);
    var pal: MHPalette = mh_palette(inkColor, toneColor, tone2, hueShift, depth);
    return mh_present(interior + sf.rim, sf.spec, sf.glow, hueMix, uv, pal, glow, inkColor, position, pixelScale);
}

fn mh_geode(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, tilt: vec2f, tone2: vec4f, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var facetK: f32 = clamp(c0, 0.0, 1.0);
    var glimK: f32 = clamp(c1, 0.0, 1.0);
    var depthK: f32 = clamp(c2, 0.0, 1.0);
    var spreadK: f32 = clamp(c3, 0.0, 1.0);
    var st: MHState = mh_state(stateIndex, stateTau);
    var live: MHLive = mh_live(level, activity, stateIndex);
    var small: f32 = mh_small(size);
    var px: f32 = 1.0 / ((max(min(size.x, size.y), 1.0) * max(pixelScale, 1.0)) * MH_R);
    var sh: MHShape = mh_shape(0.021 + (0.007 * mh_breath(t, 11.7)), 0.0, 1.22);
    var b: MHBody = mh_body(uv, t, px, sh);
    var V: vec3f = vec3f(0.0, 0.0, -1.0);
    var rd: vec3f = mh_look(V, b.N, tilt);
    var L: f32 = mh_exit(b.P, rd);
    var fl: vec4f = mh_flourish(t, 19.0, 10.2);
    var sp: f32 = (1.0 + (0.80 * live.pace)) + (1.00 * st.drive);
    var ay: f32 = mix(mh_drift(t, 0.088 * sp, 0.48, 2.0), (t * 0.30) * sp, st.drive * 0.7);
    var ax: f32 = mix(0.34 + (0.22 * sin(t * 0.041)), 0.30, st.drive * 0.7);
    var Pc: vec3f = mh_spin(b.P, ay, ax);
    var Rc: vec3f = mh_spin(rd, ay, ax);
    var A0: vec3f = normalize(vec3f(0.92, 0.30, 0.25));
    var A1: vec3f = normalize(vec3f(-0.26, 0.90, 0.35));
    var A2: vec3f = normalize(vec3f(0.20, -0.34, 0.92));
    var A3: vec3f = normalize(vec3f(0.58, -0.55, 0.60));
    var scale: f32 = ((0.34 + (0.12 * depthK)) * S) * mix(1.0, 1.20, small);
    var fourth: f32 = 1.0 - smoothstep(0.24, 0.66, small);
    var o4: f32 = mix(6.0, 1.02, fourth);
    var dp: array<f32, 4>;
    var dm: array<f32, 4>;
    dp[0] = 1.00 * scale;
    dm[0] = 0.86 * scale;
    dp[1] = 0.92 * scale;
    dm[1] = 1.04 * scale;
    dp[2] = 0.98 * scale;
    dm[2] = 0.88 * scale;
    dp[3] = o4 * scale;
    dm[3] = (o4 * 0.94) * scale;
    var tIn: f32 = -1e9;
    var tOut: f32 = 1e9;
    var tIn2: f32 = -1e9;
    var fN: vec3f = vec3f(0.0, 0.0, 1.0);
    var fN2: vec3f = vec3f(0.0, 0.0, 1.0);
    for (var k: i32 = 0; k < 4; k++) {
        var A: vec3f = select(select(select(A3, A2, vec3<bool>(k == 2)), A1, vec3<bool>(k == 1)), A0, vec3<bool>(k == 0));
        var na: f32 = dot(A, Rc);
        var pa: f32 = dot(A, Pc);
        if (abs(na) < 1e-5) {
            if ((pa > dp[k]) || (pa < -dm[k])) {
                tIn = 1e9;
                tOut = -1e9;
            }
            continue;
        }
        var t1: f32 = (dp[k] - pa) / na;
        var t2: f32 = (-dm[k] - pa) / na;
        var tn: f32 = min(t1, t2);
        var tf: f32 = max(t1, t2);
        var nIn: vec3f = select(-A, A, vec3<bool>(t1 < t2));
        if (tn > tIn) {
            tIn2 = tIn;
            fN2 = fN;
            tIn = tn;
            fN = nIn;
        } else if (tn > tIn2) {
            tIn2 = tn;
            fN2 = nIn;
        }
        tOut = min(tOut, tf);
    }
    var crystalE: f32 = 0.0;
    var crystalH: f32 = 0.0;
    var sEnter: f32 = max(tIn, 0.0);
    var chord: f32 = min(tOut, L) - sEnter;
    if ((chord > 0.0) && (sEnter < L)) {
        var soft: f32 = (0.10 - (0.055 * facetK)) * scale;
        var eMix: f32 = exp(-max(tIn - tIn2, 0.0) / max(soft, 1e-4));
        var nrm: vec3f = normalize(mix(fN, fN2, 0.5 * eMix) + 1e-5);
        var keyF: vec3f = mh_spin(mh_key(t), ay, ax);
        var sharp: f32 = (1.4 + (2.6 * facetK)) - (1.0 * live.voice);
        var face: f32 = pow(clamp(dot(nrm, keyF), 0.0, 1.0), max(sharp, 0.7));
        var lit: f32 = 0.10 + (1.25 * face);
        if (fl.x > 0.002) {
            lit += (fl.x * 1.70) * pow(clamp(dot(nrm, normalize(A0 + A2)), 0.0, 1.0), 3.0);
        }
        if (st.complete > 0.001) {
            lit += st.complete * 0.70;
        }
        var body: f32 = smoothstep(0.0, 0.34 * scale, chord);
        var vis: f32 = mh_inside(b.P + (rd * (sEnter + (chord * 0.4)))) * exp(-MH_EXT * sEnter);
        var edge: f32 = (((glimK * (1.0 - small)) * 0.85) * eMix) * (1.0 - (eMix * 0.4));
        crystalE = ((lit * body) + (edge * body)) * vis;
        crystalH = crystalE * clamp((nrm.x * 0.7) + (nrm.y * 0.5), -1.0, 1.0);
    }
    var medAmt: f32 = mix(0.048, 0.028, small);
    var acc: vec2f = vec2f(0.0);
    var trans: f32 = 1.0;
    var ds: f32 = L / f32(5);
    for (var i: i32 = 0; i < 5; i++) {
        var p: vec3f = b.P + (rd * ((f32(i) + 0.5) * ds));
        var fade: f32 = mh_inside(p);
        if (fade <= 0.001) {
            continue;
        }
        var e: f32 = mh_medium(p, t, 2.0 / S) * medAmt;
        acc.x += (e * trans) * ds;
        trans *= exp(-((2.00 * e) + MH_EXT) * ds);
    }
    var interior: f32 = ((((acc.x * 3.20) + (crystalE * 0.92)) * b.m) * mh_transmit(b.fres)) * (1.0 + (0.22 * st.settled));
    var hue: f32 = ((select(0.0, crystalH / crystalE, crystalE > 1e-5)) * spreadK) * MH_SPREAD;
    var sf: MHSurface = mh_surface(b, t, small, inkColor, tilt, 0.74 + (0.32 * live.voice), 0.62, 0.14);
    var e: f32 = ((interior + sf.rim) + sf.spec) + sf.glow;
    var hueMix: f32 = (hue * (crystalE * 0.92)) / max(e, 1e-4);
    var pal: MHPalette = mh_palette(inkColor, toneColor, tone2, hueShift, depth);
    return mh_present(interior + sf.rim, sf.spec, sf.glow, hueMix, uv, pal, glow, inkColor, position, pixelScale);
}

fn mh_sol(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, tilt: vec2f, tone2: vec4f, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var coronaK: f32 = clamp(c0, 0.0, 1.0);
    var promK: f32 = clamp(c1, 0.0, 1.0);
    var simmerK: f32 = clamp(c2, 0.0, 1.0);
    var spreadK: f32 = clamp(c3, 0.0, 1.0);
    var st: MHState = mh_state(stateIndex, stateTau);
    var live: MHLive = mh_live(level, activity, stateIndex);
    var small: f32 = mh_small(size);
    var px: f32 = 1.0 / ((max(min(size.x, size.y), 1.0) * max(pixelScale, 1.0)) * MH_R);
    var sh: MHShape = mh_shape(0.022 + (0.008 * mh_breath(t, 12.9)), 0.0, 1.24);
    var b: MHBody = mh_body(uv, t, px, sh);
    var V: vec3f = vec3f(0.0, 0.0, -1.0);
    var rd: vec3f = mh_look(V, b.N, tilt);
    var L: f32 = mh_exit(b.P, rd);
    var fl: vec4f = mh_flourish(t, 23.0, 12.4);
    var Rs: f32 = (((0.30 + (0.09 * coronaK)) * S) * mix(1.0, 1.42, small)) * ((1.0 + ((0.030 * (mh_breath(t, 2.7) - 0.5)) * 2.0)) + (0.035 * live.voice));
    var bq: f32 = dot(b.P, rd);
    var perp2: f32 = max(dot(b.P, b.P) - (bq * bq), 0.0);
    var perp: f32 = sqrt(perp2);
    var disc: f32 = smoothstep(Rs * 1.04, Rs * 0.86, perp);
    var sFront: f32 = -bq - sqrt(max((Rs * Rs) - perp2, 0.0));
    var simGate: f32 = mh_aa((6.2831853 * 8.5) / (MH_R * S), size, pixelScale) * (1.0 - small);
    var simAmt: f32 = (simGate * (0.30 + (0.55 * simmerK))) * (0.55 + (0.65 * live.pace));
    var gran: f32 = 1.0;
    if ((simAmt > 0.002) && (disc > 0.002)) {
        var sp3: vec3f = b.P + (rd * max(sFront, 0.0));
        gran += ((simAmt * 0.32) * smoothstep(0.55, 1.0, disc)) * mh_noise3((sp3 * (8.5 / S)) + vec3f(0.0, 0.0, (0.35 * t) + (0.75 * sig.paceT)));
    }
    var coreBright: f32 = ((1.20 + (0.45 * coronaK)) * (1.0 + (0.55 * live.voice))) * (1.0 + (0.55 * st.complete));
    var coreE: f32 = (disc * gran) * coreBright;
    var coronaW: f32 = ((0.16 + (0.15 * coronaK)) * S) * (1.0 + (0.25 * live.voice));
    var coronaE: f32 = (exp(-max(perp - Rs, 0.0) / max(coronaW, 1e-3)) * (1.0 - (disc * 0.60))) * (0.42 + (0.30 * coronaK));
    var pairB: f32 = 1.0 - smoothstep(0.28, 0.70, small);
    var promW: f32 = ((0.034 + (0.017 * promK)) * S) * mix(1.0, 1.75, small);
    var promE: f32 = 0.0;
    const SQRTPI: f32 = 1.7724539;
    for (var k: i32 = 0; k < 3; k++) {
        var wk: f32 = select(pairB, 1.0, k < 2);
        if (wk < 0.002) {
            continue;
        }
        var fk: f32 = f32(k);
        var per: f32 = 13.0 + (4.0 * fk);
        var sn: f32 = sin(((6.2831853 * t) / per) + (fk * 2.13));
        var lift: f32 = sn * sn;
        if ((fl.x > 0.002) && (k == i32(fl.z * 2.999))) {
            lift = max(lift, fl.x);
        }
        lift = mix(lift, 1.0, st.complete * 0.85);
        if (lift < 0.02) {
            continue;
        }
        var a1: f32 = (t * (0.048 + (0.011 * fk))) + (fk * 1.9);
        var a2: f32 = (t * (0.037 + (0.009 * fk))) + (fk * 3.1);
        var dir: vec3f = normalize(vec3f(cos(a1) * cos(a2), sin(a2), sin(a1) * cos(a2)));
        dir = normalize(mix(dir, normalize(vec3f(0.86, -0.32, 0.39)), st.drive * 0.70));
        var tang: vec3f = normalize(cross(dir, vec3f(0.13, 0.97, 0.21)) + 1e-4);
        var hk: f32 = (((0.24 + (0.28 * promK)) * S) * lift) * (1.0 + (0.45 * live.voice));
        var swp: f32 = 0.85 + (0.30 * promK);
        var bestG: f32 = 1e9;
        var bestU: f32 = 0.0;
        var bestS: f32 = 0.0;
        for (var i: i32 = 0; i < 9; i++) {
            var u: f32 = -1.0 + (2.0 * (f32(i) / 8.0));
            var an: f32 = swp * u;
            var C: vec3f = (Rs + (hk * (1.0 - (u * u)))) * ((cos(an) * dir) + (sin(an) * tang));
            var D: vec3f = C - b.P;
            var sc: f32 = dot(D, rd);
            var g: f32 = dot(D, D) - (sc * sc);
            if (g < bestG) {
                bestG = g;
                bestU = u;
                bestS = sc;
            }
        }
        if ((bestS <= 0.0) || (bestS >= L)) {
            continue;
        }
        var du: f32 = 2.0 / 8.0;
        var gm: f32 = 0.0;
        var gp: f32 = 0.0;
        for (var i: i32 = 0; i < 2; i++) {
            var u: f32 = clamp(bestU + (select(du, -du, i == 0)), -1.0, 1.0);
            var an: f32 = swp * u;
            var C: vec3f = (Rs + (hk * (1.0 - (u * u)))) * ((cos(an) * dir) + (sin(an) * tang));
            var D: vec3f = C - b.P;
            var sc: f32 = dot(D, rd);
            var g: f32 = dot(D, D) - (sc * sc);
            if (i == 0) {
                gm = g;
            } else {
                gp = g;
            }
        }
        var den: f32 = (gm - (2.0 * bestG)) + gp;
        var off: f32 = select(0.0, clamp((0.5 * (gm - gp)) / den, -1.0, 1.0), abs(den) > 1e-7);
        var uu: f32 = clamp(bestU + (off * du), -1.0, 1.0);
        var an: f32 = swp * uu;
        var C: vec3f = (Rs + (hk * (1.0 - (uu * uu)))) * ((cos(an) * dir) + (sin(an) * tang));
        var D: vec3f = C - b.P;
        var sc: f32 = dot(D, rd);
        var pp: f32 = max(dot(D, D) - (sc * sc), 0.0);
        if ((sc <= 0.0) || (sc >= L)) {
            continue;
        }
        var prof: f32 = pow(max(1.0 - ((uu * uu) * 0.85), 0.0), 0.70);
        var wl: f32 = promW * (0.42 + (0.58 * prof));
        var T: vec3f = normalize((((cross(dir, tang) * 0.0) + (((-sin(an) * dir) + (cos(an) * tang)) * (Rs + (hk * (1.0 - (uu * uu)))))) - (((2.0 * hk) * uu) * ((cos(an) * dir) + (sin(an) * tang)))) + 1e-5);
        var sinA: f32 = max(length(cross(rd, T)), 0.55);
        var hidden: f32 = select(0.0, disc, sc > sFront);
        var vis: f32 = (mh_inside(b.P + (rd * sc)) * exp(-MH_EXT * sc)) * (1.0 - (0.94 * hidden));
        var core: f32 = ((wl * SQRTPI) / sinA) * exp(-pp / (wl * wl));
        var halo: f32 = (0.10 * (((wl * 3.19) * SQRTPI) / sinA)) * exp(-pp / ((wl * wl) * 10.2));
        promE += ((((core + halo) * prof) * lift) * vis) * wk;
    }
    var medAmt: f32 = mix(0.030, 0.018, small);
    var acc: vec2f = vec2f(0.0);
    var trans: f32 = 1.0;
    var ds: f32 = L / f32(5);
    for (var i: i32 = 0; i < 5; i++) {
        var p: vec3f = b.P + (rd * ((f32(i) + 0.5) * ds));
        var fade: f32 = mh_inside(p);
        if (fade <= 0.001) {
            continue;
        }
        var e: f32 = mh_medium(p, t, 2.0 / S) * medAmt;
        acc.x += (e * trans) * ds;
        trans *= exp(-((2.00 * e) + MH_EXT) * ds);
    }
    var interior: f32 = ((((((acc.x * 3.00) + coreE) + coronaE) + (promE * 6.60)) * b.m) * mh_transmit(b.fres)) * (1.0 + (0.20 * st.settled));
    var outer: f32 = coronaE + (promE * 6.60);
    var hue: f32 = ((select(0.0, outer / max(coreE + outer, 1e-4), interior > 1e-4)) * spreadK) * MH_SPREAD;
    var sf: MHSurface = mh_surface(b, t, small, inkColor, tilt, 0.70 + (0.32 * live.voice), 0.52, 0.16);
    var e: f32 = ((interior + sf.rim) + sf.spec) + sf.glow;
    var hueMix: f32 = (hue * interior) / max(e, 1e-4);
    var pal: MHPalette = mh_palette(inkColor, toneColor, tone2, hueShift, depth);
    return mh_present(interior + sf.rim, sf.spec, sf.glow, hueMix, uv, pal, glow, inkColor, position, pixelScale);
}

fn mh_abyss(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, tilt: vec2f, tone2: vec4f, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var creatureK: f32 = clamp(c0, 0.0, 1.0);
    var rarityK: f32 = clamp(c1, 0.0, 1.0);
    var driftK: f32 = clamp(c2, 0.0, 1.0);
    var spreadK: f32 = clamp(c3, 0.0, 1.0);
    var st: MHState = mh_state(stateIndex, stateTau);
    var live: MHLive = mh_live(level, activity, stateIndex);
    var small: f32 = mh_small(size);
    var px: f32 = 1.0 / ((max(min(size.x, size.y), 1.0) * max(pixelScale, 1.0)) * MH_R);
    var sh: MHShape = mh_shape(0.019 + (0.006 * mh_breath(t, 14.1)), 0.0, 1.14);
    var b: MHBody = mh_body(uv, t, px, sh);
    var V: vec3f = vec3f(0.0, 0.0, -1.0);
    var rd: vec3f = mh_look(V, b.N, tilt);
    var L: f32 = mh_exit(b.P, rd);
    var base: f32 = mix(9.0, 26.0, rarityK) / (((1.0 + (0.55 * live.voice)) + (0.35 * live.pace)) + (1.60 * st.drive));
    base *= mix(1.0, 0.66, small);
    var c0f: vec4f = mh_flourish(t, 31.0, base);
    var c1f: vec4f = mh_flourish(t, 37.0, base * 1.37);
    var c2f: vec4f = mh_flourish(t, 41.0, base * 1.81);
    var thirdC: f32 = 1.0 - smoothstep(0.30, 0.72, small);
    var rad: f32 = ((0.155 + (0.075 * creatureK)) * S) * mix(1.0, 1.80, small);
    var bright: f32 = ((0.85 + (0.75 * creatureK)) * (1.0 + (0.95 * live.voice))) * mix(1.0, 1.45, small);
    var reach: f32 = 0.62 + (0.30 * driftK);
    var glowE: f32 = 0.0;
    var glowH: f32 = 0.0;
    for (var k: i32 = 0; k < 3; k++) {
        var f: vec4f = select(select(c2f, c1f, vec4<bool>(k == 1)), c0f, vec4<bool>(k == 0));
        var wk: f32 = select(thirdC, 1.0, k < 2);
        if ((f.x <= 0.002) || (wk < 0.002)) {
            continue;
        }
        var fk: f32 = f32(k);
        var ga: f32 = (f.z * 6.2831853) + (fk * 1.7);
        var dir: vec3f = normalize(mix(vec3f(cos(ga), 0.40 * sin((ga * 1.6) + fk), sin((ga * 0.8) + 1.3)), vec3f(0.90, -0.22, 0.37), st.drive * 0.80));
        var side: vec3f = normalize(cross(dir, vec3f(0.08, 1.0, 0.14)));
        var gp: vec3f = (side * ((0.42 * ((f.z * 2.0) - 1.0)) * (1.0 - (0.7 * st.drive)))) + (dir * mix(-reach, reach, smoothstep(0.0, 1.0, f.y)));
        var to: vec3f = gp - b.P;
        var s: f32 = dot(to, rd);
        if ((s <= 0.0) || (s >= L)) {
            continue;
        }
        var arg: f32 = max(dot(to, to) - (s * s), 0.0) / max(rad * rad, 1e-6);
        var vis: f32 = mh_inside(b.P + (rd * s)) * exp(-MH_EXT * s);
        var e: f32 = (((((exp(-arg) * 0.45) + mh_scatter(arg, 0.52)) * vis) * f.x) * bright) * wk;
        glowE += e;
        glowH += e * (fk - 1.0);
    }
    var medAmt: f32 = mix(0.022, 0.014, small) * (1.0 + (0.60 * live.voice));
    var acc: vec2f = vec2f(0.0);
    var trans: f32 = 1.0;
    var ds: f32 = L / f32(5);
    for (var i: i32 = 0; i < 5; i++) {
        var p: vec3f = b.P + (rd * ((f32(i) + 0.5) * ds));
        var fade: f32 = mh_inside(p);
        if (fade <= 0.001) {
            continue;
        }
        var e: f32 = mh_medium(p, t, 1.9 / S) * medAmt;
        if (st.complete > 0.001) {
            var sr: f32 = (length(p) - mix(0.02, 1.0, st.sweep)) / 0.26;
            e += (st.complete * 0.42) * exp(-sr * sr);
        }
        acc.x += (e * trans) * ds;
        trans *= exp(-((2.00 * e) + MH_EXT) * ds);
    }
    var interior: f32 = ((((acc.x * 3.20) + glowE) * b.m) * mh_transmit(b.fres)) * (1.0 + (0.26 * st.settled));
    var hue: f32 = ((select(0.0, glowH / glowE, glowE > 1e-5)) * spreadK) * MH_SPREAD;
    var sf: MHSurface = mh_surface(b, t, small, inkColor, tilt, 1.70 + (0.55 * live.voice), 0.38, 0.11);
    var e: f32 = ((interior + sf.rim) + sf.spec) + sf.glow;
    var hueMix: f32 = (hue * glowE) / max(e, 1e-4);
    var pal: MHPalette = mh_palette(inkColor, toneColor, tone2, hueShift, depth);
    return mh_present(interior + sf.rim, sf.spec, sf.glow, hueMix, uv, pal, glow, inkColor, position, pixelScale);
}

fn mh_chorus(position: vec2f, currentColor: vec4f, size: vec2f, time: f32, pixelScale: f32, inkColor: vec4f, toneColor: vec4f, hueShift: f32, formScale: f32, speed: f32, depth: f32, glow: f32, c0: f32, c1: f32, c2: f32, c3: f32, epoch: f32, stateIndex: f32, stateTau: f32, level: f32, activity: f32, tilt: vec2f, tone2: vec4f, sig: LiveSig) -> vec4f {
    var uv: vec2f = (position - (0.5 * size)) / max(min(size.x, size.y), 1.0);
    var S: f32 = max(formScale, 0.10);
    var t: f32 = time * max(speed, 0.0);
    var voicesK: f32 = clamp(c0, 0.0, 1.0);
    var syncK: f32 = clamp(c1, 0.0, 1.0);
    var depthK: f32 = clamp(c2, 0.0, 1.0);
    var spreadK: f32 = clamp(c3, 0.0, 1.0);
    var st: MHState = mh_state(stateIndex, stateTau);
    var live: MHLive = mh_live(level, activity, stateIndex);
    var small: f32 = mh_small(size);
    var px: f32 = 1.0 / ((max(min(size.x, size.y), 1.0) * max(pixelScale, 1.0)) * MH_R);
    var sh: MHShape = mh_shape(0.021 + (0.008 * mh_breath(t, 15.6)), 0.0, 1.20);
    var b: MHBody = mh_body(uv, t, px, sh);
    var V: vec3f = vec3f(0.0, 0.0, -1.0);
    var rd: vec3f = mh_look(V, b.N, tilt);
    var L: f32 = mh_exit(b.P, rd);
    var fl: vec4f = mh_flourish(t, 29.0, 11.1);
    var sync: f32 = clamp(((syncK * 0.75) + (0.85 * st.drive)) + (0.55 * st.complete), 0.0, 1.0);
    var per: f32 = 8.4 - (2.2 * (live.pace * 0.6));
    var breathe: f32 = (0.30 + (0.45 * depthK)) * mix(1.0, 1.35, small);
    var mid: f32 = 1.0 - smoothstep(0.26, 0.62, small);
    var far: f32 = 1.0 - smoothstep(0.10, 0.42, small);
    var rad: f32 = ((0.082 + (0.038 * voicesK)) * S) * mix(1.0, 1.75, small);
    var bright: f32 = 0.70 + (0.55 * voicesK);
    var turn: f32 = mh_drift(t, 0.048, 0.45, 2.0);
    var voiceE: f32 = 0.0;
    var voiceH: f32 = 0.0;
    for (var k: i32 = 0; k < 7; k++) {
        var fk: f32 = f32(k);
        var wk: f32 = select(select(far, mid, k < 5), 1.0, k < 3);
        if (wk < 0.002) {
            continue;
        }
        var zc: f32 = 1.0 - ((2.0 * (fk + 0.5)) / 7.0);
        var rc: f32 = sqrt(max(1.0 - (zc * zc), 0.0));
        var ang: f32 = (fk * 2.39996323) + turn;
        var dirk: vec3f = vec3f(rc * cos(ang), zc, rc * sin(ang));
        var c: vec3f = (dirk * (0.54 + (0.09 * sin((t * (0.061 + (0.009 * fk))) + (fk * 2.2))))) + vec3f(0.05 * sin((t * 0.043) + fk), 0.05 * sin((t * 0.037) + (fk * 1.7)), 0.0);
        c *= vec3f(S);
        var phase: f32 = mix(fk * 0.897, 0.0, sync) * 6.2831853;
        var sn: f32 = sin(((6.2831853 * t) / per) + phase);
        var life: f32 = (1.0 - breathe) + ((breathe * sn) * sn);
        if ((fl.x > 0.002) && (k == i32(fl.z * 6.999))) {
            life += fl.x * 0.85;
        }
        life = mix(life, 1.0 + (0.45 * st.complete), st.complete * 0.9);
        var to: vec3f = c - b.P;
        var s: f32 = dot(to, rd);
        if ((s <= 0.0) || (s >= L)) {
            continue;
        }
        var arg: f32 = max(dot(to, to) - (s * s), 0.0) / max(rad * rad, 1e-6);
        var vis: f32 = mh_inside(b.P + (rd * s)) * exp(-MH_EXT * s);
        var front: f32 = 0.5 + (0.5 * clamp(c.z, -1.0, 1.0));
        var lift: f32 = 1.0 + (live.voice * (0.25 + (1.15 * front)));
        var e: f32 = ((((((exp(-arg) * 0.60) + mh_scatter(arg, 0.42)) * vis) * life) * lift) * bright) * wk;
        voiceE += e;
        voiceH += e * ((fk - 3.0) / 3.0);
    }
    var medAmt: f32 = mix(0.048, 0.028, small);
    var acc: vec2f = vec2f(0.0);
    var trans: f32 = 1.0;
    var ds: f32 = L / f32(5);
    for (var i: i32 = 0; i < 5; i++) {
        var p: vec3f = b.P + (rd * ((f32(i) + 0.5) * ds));
        var fade: f32 = mh_inside(p);
        if (fade <= 0.001) {
            continue;
        }
        var e: f32 = mh_medium(p, t, 2.1 / S) * medAmt;
        acc.x += (e * trans) * ds;
        trans *= exp(-((2.00 * e) + MH_EXT) * ds);
    }
    var interior: f32 = ((((acc.x * 3.30) + voiceE) * b.m) * mh_transmit(b.fres)) * (1.0 + (0.22 * st.settled));
    var hue: f32 = ((select(0.0, voiceH / voiceE, voiceE > 1e-5)) * spreadK) * MH_SPREAD;
    var sf: MHSurface = mh_surface(b, t, small, inkColor, tilt, 0.80 + (0.35 * live.voice), 0.50, 0.14);
    var e: f32 = ((interior + sf.rim) + sf.spec) + sf.glow;
    var hueMix: f32 = (hue * voiceE) / max(e, 1e-4);
    var pal: MHPalette = mh_palette(inkColor, toneColor, tone2, hueShift, depth);
    return mh_present(interior + sf.rim, sf.spec, sf.glow, hueMix, uv, pal, glow, inkColor, position, pixelScale);
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

@fragment fn fs_aura(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mh_aura(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, u.tilt, u.tone2, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_droplet(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mh_droplet(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, u.tilt, u.tone2, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_nebula(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mh_nebula(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, u.tilt, u.tone2, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_prism(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mh_prism(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, u.tilt, u.tone2, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_limn(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mh_limn(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, u.tilt, u.tone2, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_duet(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mh_duet(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, u.tilt, u.tone2, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_fathom(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mh_fathom(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, u.tilt, u.tone2, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_arc(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mh_arc(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, u.tilt, u.tone2, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_opal(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mh_opal(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, u.tilt, u.tone2, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_comet(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mh_comet(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, u.tilt, u.tone2, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_still(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mh_still(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, u.tilt, u.tone2, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_flux(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mh_flux(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, u.tilt, u.tone2, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_tempest(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mh_tempest(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, u.tilt, u.tone2, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_helix(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mh_helix(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, u.tilt, u.tone2, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_geode(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mh_geode(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, u.tilt, u.tone2, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_sol(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mh_sol(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, u.tilt, u.tone2, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_abyss(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mh_abyss(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, u.tilt, u.tone2, sig);
    return orb_clip(pos, c.rgb);
}

@fragment fn fs_chorus(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let sig = LiveSig(u.voiceT, u.paceT, u.driveT, u.vdT, u.pdT, u.levelT, u.activityT);
    let pos = (fp.xy - u.origin) / u.pixelScale;
    let c = mh_chorus(pos, vec4f(0.0), u.size, u.time, u.pixelScale, u.ink, u.tone,
        u.hueShift, u.formScale, u.speed, u.depth, u.glow, u.c0, u.c1, u.c2, u.c3,
        u.epoch, u.stateIndex, u.stateTau, u.level, u.activity, u.tilt, u.tone2, sig);
    return orb_clip(pos, c.rgb);
}
