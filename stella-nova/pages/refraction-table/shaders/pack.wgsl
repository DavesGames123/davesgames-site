// ═══════════════════════════════════════════════════════════════════════════
//  LIQUID GLASS  ·  WGSL port of the optics of quick-liquid (MIT, amarnath3003):
//  a solid glass slab of index n and thickness T on the backdrop, flat in the
//  centre, rolling off through a convex circular-arc bezel of width B. The
//  library rasterizes an SVG displacement map from an analytic SDF and an
//  exact vector-Snell profile, then composes frost, tint, two conic light
//  rings, a depth shadow and grain as DOM layers. Here it is one fragment
//  shader: the same SDF branch, the same Snell trace per pixel (no LUT), the
//  same per-channel dispersion scales, and the layers as the engine writes
//  them (rim + sheen conic stops, box-shadow stack, tint gradient).
//  Sources: PHYSICS.md §1–6, core/optics.ts, core/engine.ts, core/config.ts.
// ═══════════════════════════════════════════════════════════════════════════

struct LiquidU {
    size: vec2f, time: f32, pixelScale: f32,
    ink: vec4f, tone: vec4f, cream: vec4f,
    p: array<vec4f, 8>,   // the resolved config, packed by P_* index
    k: vec4f,
}
@group(0) @binding(0) var<uniform> u: LiquidU;
@group(0) @binding(1) var backdrop: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;

const PI: f32 = 3.14159265358979;
// config slots
const P_cx = 0; const P_cy = 1; const P_hw = 2; const P_hh = 3; const P_radius = 4; const P_bezel = 5; const P_thickness = 6; const P_ior = 7;
const P_strength = 8; const P_blur = 9; const P_saturation = 10; const P_tintOp = 11; const P_tintR = 12; const P_tintG = 13; const P_tintB = 14; const P_ca = 15;
const P_lightAngle = 16; const P_edgeHighlight = 17; const P_specular = 18; const P_fresnelPower = 19; const P_elevation = 20; const P_noiseOp = 21; const P_noiseScale = 22; const P_luma = 23;
const P_dark = 24; const P_hoverGlow = 25; const P_peak = 26; const P_tintBlend = 27; const P_reduce = 28; const P_showMap = 29;
fn cfg(i: i32) -> f32 { return u.p[i / 4][i % 4]; }

@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(p[i], 0.0, 1.0);
}

// —— math/sdf.ts · rounded rectangle, with the analytic gradient of optics.ts ——
struct Sdf { d: f32, m: vec2f }   // d: signed distance, negative INSIDE (sdf.ts convention); m: outward unit normal
fn sdfRoundedRect(p: vec2f, c: vec2f, half: vec2f, radius: f32) -> Sdf {
    let q = abs(p - c) - (half - vec2f(radius));
    let outside = length(max(q, vec2f(0.0))); let inside = min(max(q.x, q.y), 0.0);
    var s: Sdf; s.d = outside + inside - radius;
    let sg = sign(p - c);
    // corner-circle branch or edge branch — the gradient is exact, no finite-difference probes
    if (q.x > 0.0 && q.y > 0.0) { s.m = sg * normalize(q); }
    else if (q.x > q.y) { s.m = vec2f(sg.x, 0.0); }
    else { s.m = vec2f(0.0, sg.y); }
    return s;
}

// —— core/optics.ts · exact vector-Snell displacement for a convex circular bezel ——
// s = d/B ∈ (0,1): height z(s) = T√(s(2−s)), slope σ = (T/B)(1−s)/√(s(2−s)); an orthographic ray
// refracts at the tilted face (η = 1/n) and crosses depth z to the flat bottom: Δ = z·|t_xy/t_z|.
fn snellDisplacement(s: f32, ratio: f32, eta: f32) -> f32 {
    let root = sqrt(s * (2.0 - s));
    let slope = ratio * (1.0 - s) / max(root, 1e-6);
    let cosI = 1.0 / sqrt(1.0 + slope * slope); let sinI = slope * cosI;
    let k = eta * cosI - sqrt(max(0.0, 1.0 - eta * eta * sinI * sinI));
    return root * abs(k * sinI / (-eta + k * cosI));
}

// —— frost: backdrop blur + saturate (the lens layer's backdrop-filter) ————————
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
fn sampleBackdrop(uv: vec2f) -> vec3f { return textureSampleLevel(backdrop, smp, uv, 0.0).rgb; }
fn frosted(uv: vec2f, blurPx: f32, sat: f32) -> vec3f {
    var c = vec3f(0.0);
    if (blurPx < 0.25) { c = sampleBackdrop(uv); }
    else {
        // a 13-tap disc, Gaussian-weighted: the same energy a blur(px) spreads
        let r = blurPx * 1.5 / u.size; var wsum = 0.0;
        for (var i = 0; i < 13; i++) {
            let a = f32(i) * 2.399963; let rr = sqrt((f32(i) + 0.5) / 13.0);
            let o = vec2f(cos(a), sin(a)) * rr; let w = exp(-2.0 * rr * rr);
            c += sampleBackdrop(uv + o * r) * w; wsum += w;
        }
        c /= wsum;
    }
    return mix(vec3f(luma(c)), c, sat);
}

// —— the two conic light rings (engine.ts conicStops): I(θ) = base + peak·|cos(θ−θL)|^p − dark·sin²(θ−θL) ——
fn conic(rel: f32, power: f32, peakA: f32, baseA: f32, darkA: f32) -> f32 {
    let c = abs(cos(rel)); let sn = abs(sin(rel));
    return baseA + peakA * pow(c, power) - darkA * sn * sn;
}
fn ringColor(net: f32) -> vec4f { return select(vec4f(10.0 / 255.0, 14.0 / 255.0, 22.0 / 255.0, -net), vec4f(1.0, 1.0, 1.0, net), net >= 0.0); }
fn over(dst: vec3f, src: vec4f) -> vec3f { return mix(dst, src.rgb, clamp(src.a, 0.0, 1.0)); }
fn hash21(p: vec2f) -> f32 { var q = fract(p * vec2f(123.34, 456.21)); q += dot(q, q + 45.32); return fract(q.x * q.y); }

// —— the whole element, composed as the engine stacks its layers ————————————
@fragment fn fs_glass(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let pos = fp.xy / u.pixelScale;                       // CSS px in the cell
    let c = vec2f(cfg(P_cx), cfg(P_cy)); let half = vec2f(cfg(P_hw), cfg(P_hh));
    let radius = min(cfg(P_radius), min(half.x, half.y));
    let B = min(cfg(P_bezel), min(half.x, half.y));      // pill clamp: the bezel becomes a full dome
    let T = cfg(P_thickness); let n = cfg(P_ior);
    let s = sdfRoundedRect(pos, c, half, radius); let d = -s.d;   // distance inward from the boundary
    let dark = cfg(P_dark) > 0.5; let L = cfg(P_luma); let e = cfg(P_elevation);

    // LAYER −1 · box-shadow stack (outside the element only; CSS clips it under the box)
    var col = sampleBackdrop(pos / u.size);
    if (d < 0.0 && e > 0.0) {
        let t = max(1.0, T / 8.0);
        let sh = -d;   // distance outside
        // each shadow: offset dy, blur radius, alpha — Gaussian-ish falloff of the offset SDF
        let dOff = -sdfRoundedRect(pos - vec2f(0.0, 6.0 * t * e), c, half, radius).d; let dOff2 = -sdfRoundedRect(pos - vec2f(0.0, 1.5 * e), c, half, radius).d;
        let g1 = exp(-max(-dOff, 0.0) * max(-dOff, 0.0) / (2.0 * pow(max(select(22.0, 24.0, dark) * t * e, 1.0) * 0.5, 2.0)));
        let g2 = exp(-max(-dOff2, 0.0) * max(-dOff2, 0.0) / (2.0 * pow(max(5.0 * e, 1.0) * 0.5, 2.0)));
        if (dark) {
            let halo = exp(-sh * sh / (2.0 * pow(26.0 * t * e * 0.5, 2.0)));
            col = over(col, vec4f(148.0 / 255.0, 176.0 / 255.0, 224.0 / 255.0, 0.10 * e * halo));
            col = over(col, vec4f(0.0, 0.0, 0.0, 0.36 * e * g1)); col = over(col, vec4f(0.0, 0.0, 0.0, 0.24 * e * g2));
        } else {
            let sc = vec3f(16.0, 22.0, 34.0) / 255.0;
            col = over(col, vec4f(sc, 0.13 * e * g1)); col = over(col, vec4f(sc, 0.08 * e * g2));
        }
    }
    let cover = smoothstep(-0.7, 0.7, d);   // the element's anti-aliased edge
    if (cover <= 0.0) { return vec4f(col, 1.0); }

    // LAYER 0 · the lens: refraction (SVG displacement map ≡ this field) then frost
    var lens = vec3f(0.0);
    let ratio = T / max(B, 0.001); let eta = 1.0 / max(1.0, n);
    let sB = clamp(d / B, 0.0, 1.0);
    var disp = 0.0;
    if (n > 1.0 && T > 0.0 && sB > 0.0 && sB < 1.0) { disp = snellDisplacement(sB, ratio, eta) / max(cfg(P_peak), 1e-6) * cfg(P_strength); }
    let ca = cfg(P_ca);
    let blurPx = cfg(P_blur); let sat = cfg(P_saturation);
    if (cfg(P_showMap) > 0.5) {   // the displacement map itself, as the engine encodes it: R = dx, G = dy around 128
        let m = -s.m * disp / max(cfg(P_strength), 1e-6);
        lens = vec3f(0.5 + 0.5 * m.x, 0.5 + 0.5 * m.y, 0.5);
    } else if (ca > 0.01 && disp > 0.0) {
        // one field, three scales — dispersion is linear in the field; blue bends more (crown-glass order)
        let dR = -s.m * disp * (1.0 - ca * 0.10); let dG = -s.m * disp; let dB = -s.m * disp * (1.0 + ca * 0.14);
        lens = vec3f(frosted((pos + dR) / u.size, blurPx, sat).r, frosted((pos + dG) / u.size, blurPx, sat).g, frosted((pos + dB) / u.size, blurPx, sat).b);
    } else {
        lens = frosted((pos - s.m * disp) / u.size, blurPx, sat);
    }
    var g = lens;

    // LAYER 1 · tint: flat material tint + a whisper of vertical light falloff
    let op = cfg(P_tintOp); let tint = vec3f(cfg(P_tintR), cfg(P_tintG), cfg(P_tintB));
    let v = clamp((pos.y - (c.y - half.y)) / max(2.0 * half.y, 1.0), 0.0, 1.0);
    let tintA = mix(op * 1.2, op * 0.85, v);
    if (cfg(P_tintBlend) > 0.5) { g = mix(g, select(2.0 * g * tint, 1.0 - 2.0 * (1.0 - g) * (1.0 - tint), g > vec3f(0.5)), tintA); }   // adaptive: overlay
    else { g = over(g, vec4f(tint, tintA)); }

    // LAYERS 2+3 · conic light rings: the rim catches light in two lobes, at the light angle and its mirror
    let theta = atan2(pos.x - c.x, -(pos.y - c.y));   // CSS conic: 0 = up, clockwise
    let rel = theta - cfg(P_lightAngle) * PI / 180.0;
    let pw = cfg(P_fresnelPower); let ringOp = select(0.82 + 0.18 * cfg(P_hoverGlow), 0.0, cfg(P_reduce) > 0.5);
    let hi = cfg(P_edgeHighlight) * (0.65 + 0.44 * L);
    let rimMask = 1.0 - smoothstep(1.0, 2.3, d);   // .ql-rim — a crisp ~1.3 px ring
    let rim = ringColor(conic(rel, pw, hi * 0.86, hi * 0.075, hi * 0.035));
    g = over(g, vec4f(rim.rgb, rim.a * rimMask * ringOp));
    let sp = cfg(P_specular) * (0.4 + 0.65 * L);
    let sw = max(2.0, B * 0.45);
    let sheenMask = 1.0 - smoothstep(sw - 1.0, sw + 1.0, d);   // .ql-sheen — bezel-band-wide, soft lobes + dark flanks
    let sheen = ringColor(conic(rel, pw, sp * 0.23, 0.0, sp * 0.16));
    g = over(g, vec4f(sheen.rgb, sheen.a * sheenMask * ringOp));

    // NOISE · fractal grain, feTurbulence stand-in
    let no = cfg(P_noiseOp);
    if (no > 0.0) { let q = pos / max(cfg(P_noiseScale), 0.1); let nz = (hash21(floor(q)) * 0.5 + hash21(floor(q * 0.5)) * 0.3 + hash21(floor(q * 0.25)) * 0.2); g = over(g, vec4f(vec3f(nz), no * 0.6)); }

    return vec4f(mix(col, g, cover), 1.0);
}
