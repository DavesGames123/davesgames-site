// ═══════════════════════════════════════════════════════════════════════════
//  CORRUPTION  ·  a system-corruption material for any geometry
// ───────────────────────────────────────────────────────────────────────────
//  gpu.js puts the library section of pages/sdf-solids-table/shaders/pack.wgsl
//  (camera helpers, hashing, gradient noise, Worley cells, the distance
//  primitives, the studio, the optics and the finisher) in front of this
//  file at load time. This file declares struct U with the names that the
//  library reads (size, pixelScale, ink, tone, cream, exposure, studio).
//
//  THE MATERIAL (any geometry: it reads only a world point and a normal)
//    corruptField(p) . signed: > 0 inside the infection. A sphere from the
//                      origin u.src that grows with the spread, broken by
//                      gradient noise
//    shadeCorrupt() .. the clean colour ahead of the front (with cracks that
//                      run ahead of it), a glowing red front, and behind it
//                      a charred voxel crust with red sparks and red code
//
//  PASSES (gpu.js)
//    cs_sample ... points on the SDF model surface for the particles
//    cs_pick ..... one ray against the SDF scene (click to set the origin)
//    fs_scene .... the ray march: floor, SDF model, voxel crust, tendrils,
//                  shards; writes colour and frag_depth into the HDR target
//    vs_mesh ..... the raster pass for mesh models: voxel snap, crust push,
//                  stutter; fs_mesh shades with the same shadeCorrupt
//    vs_part ..... instanced polyhedra (tetra, cube, octa, icosa) shed from
//                  the infected surface
//    vs_glyph .... instanced red 0 and 1 digits (distance-field glyphs)
//    fs_post ..... tear bands, colour split, bloom taps, scan lines, finish
//
//  GREP MAP
//    grep -n 'struct U'           the uniform block (params.js UNIFORM_FIELDS)
//    grep -n 'fn corruptField'    the infection field
//    grep -n 'fn shadeCorrupt'    the material
//    grep -n 'fn sdModel'         the four SDF models
//    grep -n 'fn mapScene'        the scene distance with the voxel crust
//    grep -n 'fn sdDigit'         the 0 and 1 glyphs
// ═══════════════════════════════════════════════════════════════════════════
const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.283185307179586;

struct U {
    size: vec2f, time: f32, pixelScale: f32,
    ink: vec4f, tone: vec4f, cream: vec4f,
    exposure: f32, studio: f32, glow: f32, amount: f32,
    k: vec4f,
    viewProj: mat4x4f,
    cam: vec4f,
    camR: vec4f,
    camU: vec4f,
    camF: vec4f,
    src: vec4f,
    shape: vec4f,
    surf: vec4f,
    grow: vec4f,
    emis: vec4f,
    sdfx: vec4f,
    fx: vec4f,
    bound: vec4f,
    part: vec4f,
    part2: vec4f,
    mat: vec4f,
    mat2: vec4f,
    pick: vec4f,
    pickD: vec4f,
    pts: array<vec4f, 52>,
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> samples: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> samplesRW: array<vec4f>;
@group(0) @binding(3) var hdrTex: texture_2d<f32>;
@group(0) @binding(4) var hdrSamp: sampler;
@group(0) @binding(5) var<storage, read_write> pickOut: array<vec4f>;

// ── small helpers ───────────────────────────────────────────────────────────
fn seedF() -> f32 { return u.cam.w; }
fn redE() -> vec3f { return u.emis.rgb; }
fn sdBox3(p: vec3f, b: vec3f) -> f32 {
    let q = abs(p) - b;
    return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}
fn sdOcta(p: vec3f, s: f32) -> f32 { let q = abs(p); return (q.x + q.y + q.z - s) * 0.57735027; }
fn sdBoxFrame(p0: vec3f, b: vec3f, e: f32) -> f32 {
    let p = abs(p0) - b;
    let q = abs(p + vec3f(e)) - vec3f(e);
    return min(min(
        length(max(vec3f(p.x, q.y, q.z), vec3f(0.0))) + min(max(p.x, max(q.y, q.z)), 0.0),
        length(max(vec3f(q.x, p.y, q.z), vec3f(0.0))) + min(max(q.x, max(p.y, q.z)), 0.0)),
        length(max(vec3f(q.x, q.y, p.z), vec3f(0.0))) + min(max(q.x, max(q.y, p.z)), 0.0));
}
fn sdTetra(p: vec3f, s: f32) -> f32 {
    return (max(abs(p.x + p.y) - p.z, abs(p.x - p.y) + p.z) - s) * 0.57735027;
}
// the axis that the normal points along most (a voxel face)
fn axisN(n: vec3f) -> vec3f {
    let a = abs(n);
    if (a.x > a.y && a.x > a.z) { return vec3f(sign(n.x), 0.0, 0.0); }
    if (a.y > a.z) { return vec3f(0.0, sign(n.y), 0.0); }
    return vec3f(0.0, 0.0, sign(n.z));
}
fn rodrigues(v: vec3f, k: vec3f, a: f32) -> vec3f {
    let c = cos(a); let s = sin(a);
    return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}

// ── the infection field ─────────────────────────────────────────────────────
fn spreadR() -> f32 {
    let pul = 1.0 + u.grow.w * 0.14 * sin(u.time * 2.1);
    return u.src.w * u.amount * pul;
}
fn corruptFieldOct(p: vec3f, oct: i32) -> f32 {
    let d = length(p - u.src.xyz);
    // outside the noise envelope the sign is known: skip the noise. (The
    // value is not an upper bound; mapScene adds the envelope back for its
    // safe step. An upper bound here crosses zero at the envelope edge and
    // drew the front band as a ring.)
    let env0 = u.shape.z * 1.6 + 0.02;
    if (spreadR() - d < -env0) { return spreadR() - d; }
    let n = fbm3(p * u.shape.y + vec3f(seedF() * 0.37, u.time * 0.05, seedF() * 0.11), oct);
    let fade = clamp(u.amount * 5.0, 0.0, 1.0);
    return spreadR() - d + n * u.shape.z * 1.6 * fade;
}
fn corruptField(p: vec3f) -> f32 { return corruptFieldOct(p, 4); }

// ── the 0 and 1 glyphs: q in cell units (the digit spans y -0.34 .. 0.34) ──
fn sdDigit(q: vec2f, one: bool) -> f32 {
    if (one) {
        let stem = sdSeg2(q, vec2f(0.02, -0.32), vec2f(0.02, 0.34));
        let flag = sdSeg2(q, vec2f(0.02, 0.34), vec2f(-0.13, 0.2));
        let base = sdSeg2(q, vec2f(-0.13, -0.32), vec2f(0.17, -0.32));
        return min(stem, min(flag, base)) - 0.05;
    }
    let e = q / vec2f(0.2, 0.32);
    return abs(length(e) - 1.0) * 0.2 - 0.045;
}

// red code on the crust: columns of digits that scroll down (code rain),
// drawn on the plane that the normal faces most
fn surfaceCode(p: vec3f, n: vec3f) -> f32 {
    let a = abs(n);
    var uv = p.xy;
    if (a.x > a.y && a.x > a.z) { uv = p.zy; } else if (a.y > a.z) { uv = p.xz; }
    let gs = max(u.shape.x * 1.5, 0.035);
    let colI = floor(uv.x / gs);
    let hc = hash3(vec3f(colI, 3.0, seedF())).x;
    let v = uv.y / gs + u.time * (0.6 + 2.4 * hc);
    let cell = vec2f(colI, floor(v));
    let h = hash3(vec3f(cell, 17.0 + seedF()));
    let q = vec2f(fract(uv.x / gs) - 0.5, fract(v) - 0.5);
    let flipT = floor(u.time * u.part2.y * (0.3 + h.z) + h.y * 9.0);
    let one = hash3(vec3f(cell, flipT)).x > 0.5;
    let d = sdDigit(q, one);
    let on = step(1.0 - u.surf.z * 0.8, h.x);
    let trail = pow(fract(-v * 0.09 + hc * 7.0), 3.0);
    return (1.0 - smoothstep(0.0, 0.05, d)) * on * (0.3 + 0.7 * trail);
}

// ── lights: the library studio plus a deck lamp and a cyan back fill, so
//    the void backdrop still shows the forms ────────────────────────────────
fn lamps(p: vec3f, n: vec3f, rd: vec3f, alb: vec3f, rough: f32, occ: f32) -> vec3f {
    let lp = vec3f(1.2, 4.2, 2.4);
    let L = normalize(lp - p);
    let dist2 = dot(lp - p, lp - p);
    let diff = max(dot(n, L), 0.0);
    let hv = normalize(L - rd);
    let sp = pow(max(dot(n, hv), 0.0), mix(160.0, 12.0, rough)) * (1.0 - rough * 0.7);
    var c = (alb * diff + vec3f(sp) * 0.5) * cCream() * 11.0 / dist2;
    let F = normalize(vec3f(-0.6, 0.35, -0.75));
    c += (alb * max(dot(n, F), 0.0) * 0.25 + vec3f(pow(max(dot(n, normalize(F - rd)), 0.0), 40.0)) * 0.12) * cTone() * 0.6;
    return c * occ;
}
fn cleanLit(p: vec3f, n: vec3f, rd: vec3f, alb: vec3f, metalness: f32, rough: f32, occ: f32) -> vec3f {
    let d = dielectric(rd, n, alb, rough, occ, 1.0);
    let m = metal(rd, n, alb, rough, occ);
    return mix(d, m, metalness) * mix(0.35, 1.0, u.studio) + lamps(p, n, rd, alb, rough, occ);
}
// panel seams and a cyan light strip for the mesh models (triplanar)
fn panelLines(p: vec3f, n: vec3f) -> vec2f {
    let a = abs(n);
    var uv = p.xy;
    if (a.x > a.y && a.x > a.z) { uv = p.zy; } else if (a.y > a.z) { uv = p.xz; }
    let g = abs(fract(uv * vec2f(3.0, 4.0)) - 0.5);
    let seam = smoothstep(0.47, 0.49, max(g.x, g.y));
    let strip = smoothstep(0.02, 0.0, abs(fract(p.y * 1.3 + 0.1) - 0.5) - 0.012);
    return vec2f(seam, strip);
}

// ── the material ────────────────────────────────────────────────────────────
// clean: the lit colour of the clean surface. minF lifts the field (voxel
// crust cells are always corrupt even where the field crosses zero).
fn shadeCorrupt(p: vec3f, n0: vec3f, rd: vec3f, clean: vec3f, minF: f32) -> vec3f {
    let f = max(corruptField(p), minF);
    let v = u.shape.x;
    let cell = floor(p / v);
    let h = hash3(cell + vec3f(seedF() * 7.0));
    // the charred crust: faceted to the voxel axes, a value per voxel
    let nq = normalize(mix(n0, axisN(n0), 0.6));
    let charA = mix(vec3f(0.07, 0.068, 0.072), vec3f(0.016, 0.014, 0.016), u.surf.w) * (0.45 + 1.1 * h.x);
    var crust = plastic(rd, nq, charA, 1.0) * mix(0.9, 0.45, u.surf.w) + lamps(p, nq, rd, charA, 0.5, 1.0) * 0.6;
    let fl = 0.5 + 0.5 * sin(u.time * (3.0 + 9.0 * h.z) + h.y * 40.0);
    crust += redE() * step(1.0 - u.surf.x, h.y) * (0.35 + 0.65 * fl) * 1.5;
    crust += redE() * surfaceCode(p, n0) * u.surf.z * 1.6;
    let deep = smoothstep(0.05, 0.6, f / max(u.src.w * 0.3, 0.01));
    crust *= mix(1.0, 0.5, deep);

    // ahead of the front: cracks that run into the clean surface
    var cl = clean;
    let ahead = clamp(-f / (0.5 * u.surf.y + 0.05), 0.0, 1.0);
    if (u.surf.y > 0.001 && ahead < 1.0) {
        let w = worley2(p * 7.5 + vec3f(seedF()));
        let edge = w.y - w.x;
        let reach = (1.0 - ahead) * u.surf.y;
        let line = 1.0 - smoothstep(0.0, 0.035 + 0.06 * (1.0 - ahead), edge);
        cl = mix(cl, cl * 0.06, line * reach);
        cl += redE() * line * reach * reach * 1.8;
    }
    // the front: a red band that flickers
    let band = 1.0 - smoothstep(0.0, u.shape.w, abs(f));
    let flick = 0.75 + 0.25 * sin(u.time * 11.0 + h.x * 30.0);
    var c = mix(cl, crust, smoothstep(-0.008, 0.008, f));
    c += redE() * band * band * u.emis.w * flick;
    return c;
}

// ── the SDF models (model units: floor y = 0, about 2 m tall) ──────────────
// each returns (distance, material id). Materials: 1 armour, 2 suit,
// 3 red trim, 4 visor, 5 reactor metal, 6 reactor core, 7 crate, 8 stone,
// 10 shard, 11 voxel crust
fn opU(a: vec2f, b: vec2f) -> vec2f { return select(a, b, b.x < a.x); }
fn sdTrooper(p0: vec3f) -> vec2f {
    let p = vec3f(abs(p0.x), p0.y, p0.z);            // mirror for the limbs
    var r = vec2f(1e3, 1.0);
    // legs and boots
    r = opU(r, vec2f(sdCapsule(p, vec3f(0.13, 0.93, 0.0), vec3f(0.15, 0.52, 0.04), 0.085), 1.0));
    r = opU(r, vec2f(sdCapsule(p, vec3f(0.15, 0.52, 0.04), vec3f(0.15, 0.13, 0.0), 0.07), 2.0));
    r = opU(r, vec2f(rbox(p - vec3f(0.15, 0.065, 0.04), vec3f(0.075, 0.065, 0.13), 0.025), 1.0));
    r = opU(r, vec2f(length(p - vec3f(0.15, 0.53, 0.07)) - 0.08, 3.0));
    // pelvis, torso, chest
    r = opU(r, vec2f(rbox(p0 - vec3f(0.0, 0.98, 0.0), vec3f(0.17, 0.09, 0.12), 0.04), 2.0));
    let torso = smin(rbox(p0 - vec3f(0.0, 1.3, 0.0), vec3f(0.22, 0.24, 0.13), 0.08),
                     sdEllipsoid(p0 - vec3f(0.0, 1.38, 0.06), vec3f(0.24, 0.2, 0.14)), 0.06);
    r = opU(r, vec2f(torso, 1.0));
    r = opU(r, vec2f(rbox(p0 - vec3f(0.0, 1.32, -0.19), vec3f(0.17, 0.22, 0.08), 0.03), 2.0));
    // head: helmet and visor
    r = opU(r, vec2f(sdEllipsoid(p0 - vec3f(0.0, 1.72, 0.0), vec3f(0.15, 0.17, 0.16)), 1.0));
    r = opU(r, vec2f(sdEllipsoid(p0 - vec3f(0.0, 1.71, 0.09), vec3f(0.115, 0.055, 0.08)), 4.0));
    // shoulders and arms (both hands on the rifle)
    r = opU(r, vec2f(length(p - vec3f(0.29, 1.5, 0.0)) - 0.105, 3.0));
    r = opU(r, vec2f(sdCapsule(p0, vec3f(0.3, 1.47, 0.0), vec3f(0.32, 1.2, 0.1), 0.065), 2.0));
    r = opU(r, vec2f(sdCapsule(p0, vec3f(0.32, 1.2, 0.1), vec3f(0.08, 1.14, 0.32), 0.055), 1.0));
    r = opU(r, vec2f(sdCapsule(p0, vec3f(-0.3, 1.47, 0.0), vec3f(-0.3, 1.22, 0.14), 0.065), 2.0));
    r = opU(r, vec2f(sdCapsule(p0, vec3f(-0.3, 1.22, 0.14), vec3f(-0.02, 1.16, 0.5), 0.055), 1.0));
    // rifle
    r = opU(r, vec2f(rbox(p0 - vec3f(0.02, 1.17, 0.42), vec3f(0.035, 0.05, 0.34), 0.015), 2.0));
    r = opU(r, vec2f(sdCyl((p0 - vec3f(0.02, 1.19, 0.82)).xzy, 0.08, 0.018), 2.0));
    return r;
}
fn sdReactor(p: vec3f) -> vec2f {
    var r = vec2f(sdCyl(p - vec3f(0.0, 0.14, 0.0), 0.14, 0.75), 5.0);
    r = opU(r, vec2f(sdCyl(p - vec3f(0.0, 0.34, 0.0), 0.06, 0.6), 5.0));
    r = opU(r, vec2f(sdCyl(p - vec3f(0.0, 1.12, 0.0), 0.78, 0.24), 6.0));
    for (var i = 0; i < 3; i++) {
        let y = 0.55 + f32(i) * 0.55;
        r = opU(r, vec2f(sdTorus(p - vec3f(0.0, y, 0.0), 0.42, 0.045), 5.0));
    }
    let q = pmod(p.xz, 6.0);
    r = opU(r, vec2f(rbox(vec3f(q.x - 0.44, p.y - 1.12, q.y), vec3f(0.05, 0.82, 0.06), 0.015), 5.0));
    r = opU(r, vec2f(sdCyl(p - vec3f(0.0, 1.98, 0.0), 0.07, 0.52), 5.0));
    r = opU(r, vec2f(sdCyl(p - vec3f(0.0, 2.1, 0.0), 0.05, 0.2), 5.0));
    return r;
}
fn rotYv(p: vec3f, a: f32) -> vec3f { return rotY(a) * p; }
fn sdCrates(p: vec3f) -> vec2f {
    var r = vec2f(rbox(p - vec3f(-0.42, 0.4, 0.0), vec3f(0.4), 0.03), 7.0);
    r = opU(r, vec2f(rbox(rotYv(p - vec3f(0.48, 0.33, 0.12), 0.35), vec3f(0.33), 0.03), 7.0));
    r = opU(r, vec2f(rbox(rotYv(p - vec3f(-0.3, 1.1, 0.04), -0.28), vec3f(0.3), 0.03), 7.0));
    r = opU(r, vec2f(rbox(p - vec3f(0.5, 0.75, 0.1), vec3f(0.2, 0.09, 0.14), 0.02), 5.0));
    return r;
}
fn sdRelic(p: vec3f) -> vec2f {
    let c = p - vec3f(0.0, 1.15, 0.0);
    let q = c * 5.2;
    let gy = abs(dot(sin(q), cos(q.zxy))) / 5.2 - 0.045;
    let shell = max(length(c) - 0.8, gy * 0.7);
    var r = vec2f(shell, 8.0);
    r = opU(r, vec2f(length(c) - 0.3, 6.0));
    r = opU(r, vec2f(sdCyl(p - vec3f(0.0, 0.12, 0.0), 0.12, 0.5), 5.0));
    r = opU(r, vec2f(sdCyl(p - vec3f(0.0, 0.3, 0.0), 0.08, 0.16), 5.0));
    return r;
}
fn sdModel(p: vec3f) -> vec2f {
    if (u.k.x > 0.5) { return vec2f(1e3, 0.0); }
    let b = length(p - u.bound.xyz) - u.bound.w - 0.1;
    if (b > 0.25) { return vec2f(b, 1.0); }          // outside the bound
    let id = i32(u.k.y + 0.5);
    if (id == 0) { return sdTrooper(p); }
    if (id == 1) { return sdReactor(p); }
    if (id == 2) { return sdCrates(p); }
    return sdRelic(p);
}

// ── tendrils of voxels that rise from the deck round the model ─────────────
// params.js scenePoints() writes, each frame: pts[0..29] 6 tendrils x 5
// points (xyz, w radius); pts[30..35] a bounding sphere per tendril;
// pts[36..51] 8 shards x (centre xyz, size; yaw, pitch, kind, -)
fn sdTendrils(p: vec3f) -> f32 {
    let n = i32(u.sdfx.x + 0.5);
    if (n == 0 || u.amount < 0.01) { return 1e3; }
    // a cylinder round all of them first
    let rr = length(p.xz - u.bound.xz) - (u.bound.w * 1.7 + 0.5);
    let hb = max(rr, max(-p.y - 0.1, p.y - u.sdfx.y * 1.2 - 0.4));
    if (hb > 0.3) { return hb; }
    var d = 1e3;
    for (var i = 0; i < 6; i++) {
        if (i >= n) { break; }
        let bs = u.pts[30 + i];
        if (length(p - bs.xyz) - bs.w > d) { continue; }
        for (var s = 0; s < 4; s++) {
            let a = u.pts[i * 5 + s];
            let b = u.pts[i * 5 + s + 1];
            d = min(d, sdCapsule(p, a.xyz, b.xyz, b.w));
        }
    }
    return d;
}

// ── data shards: SDF polyhedra that orbit the model ─────────────────────────
fn sdShards(p: vec3f) -> f32 {
    let n = i32(u.sdfx.z + 0.5);
    if (n == 0) { return 1e3; }
    let rc = length(p - u.bound.xyz);
    let shell = max(rc - (u.bound.w * 1.6 + 0.75), (u.bound.w * 1.25 - 0.45) - rc);
    if (shell > 0.3) { return shell; }
    var d = 1e3;
    for (var i = 0; i < 8; i++) {
        if (i >= n) { break; }
        let c = u.pts[36 + i * 2];
        let r = u.pts[37 + i * 2];
        let dc = length(p - c.xyz);
        if (dc - c.w * 1.5 > d) { continue; }
        let q = spin(p - c.xyz, r.x, r.y);
        let s = c.w;
        var e = 0.0;
        let kind = i32(r.z + 0.5);
        if (kind == 0) { e = sdOcta(q, s * 1.4); }
        else if (kind == 1) { e = sdBoxFrame(q, vec3f(s), s * 0.14); }
        else { e = sdTetra(q, s * 0.9); }
        d = min(d, e);
    }
    return d;
}

// the deck: an infinite floor in the studio, a round platform in the void
fn sdDeck(p: vec3f) -> f32 {
    if (u.k.z > 0.5) { return p.y; }
    return sdCyl(p - vec3f(0.0, -0.2, 0.0), 0.2, 4.6);
}

// ── the scene: (distance, material, safe step) ─────────────────────────────
// The voxel crust is found by testing the cell centre q of the cell that p
// is in, so its distance is right only inside that cell. The safe step is
// the distance to the nearest place where a crust cell can be (a lower
// bound from the model, the deck, the tendrils and the field), never less
// than half a voxel, so the march cannot jump over a cell.
fn mapScene(p: vec3f, full: bool) -> vec3f {
    let v = u.shape.x;
    var res = vec2f(sdDeck(p), 0.0);
    let mdl = sdModel(p);
    let fc = corruptFieldOct(p, 2);
    let cm = smoothstep(0.0, 0.1, fc);
    res = opU(res, vec2f(mdl.x + v * 0.9 * cm, mdl.y));
    let td = sdTendrils(p);
    if (full) { res = opU(res, vec2f(sdShards(p), 10.0)); }
    if (u.amount < 0.005) { return vec3f(res, res.x); }

    let lip = 1.0 + u.shape.z * u.shape.y * 2.0;
    let lc = -(fc + u.shape.z * 1.6 + 0.02) / lip - v * 0.9;
    let crustMax = v * (0.3 + 2.5 * u.grow.x);
    let layersMax = 1.0 + 4.0 * u.grow.x;
    let lm = mdl.x - crustMax - v * 1.8;
    let lf = p.y - layersMax * v - v * 0.9;
    let lt = td - v * 2.0;
    let lb = max(lc, min(lm, min(lf, lt)));
    var stepS = min(res.x, max(lb, v * 0.5));
    if (lb > v * 0.5) { return vec3f(res, stepS); }

    let ci = floor(p / v);
    let q = (ci + 0.5) * v;
    let fq = corruptFieldOct(q, 2);
    if (fq > 0.0) {
        let hq = hash3(ci + vec3f(seedF() * 7.0));
        let mq = sdModel(q).x;
        var occ = false;
        // the crust on the model, with holes where the hash is low
        if (mq < v * 0.3 && mq > -v * 2.5 && hq.x > u.grow.y * smoothstep(0.0, 0.25, fq)) { occ = true; }
        // blocks that grow out of it
        if (mq >= v * 0.3 && mq < crustMax && hq.z > 1.0 - u.grow.x * 0.55) { occ = true; }
        // columns on the deck
        let hcol = hash3(vec3f(ci.x, 0.0, ci.z) + vec3f(seedF() * 3.0, 1.0, 0.0));
        let fcol = corruptFieldOct(vec3f(q.x, 0.0, q.z), 2);
        let layers = floor(hcol.x * layersMax * smoothstep(0.0, 0.5, fcol) + 0.35);
        if (q.y > 0.0 && q.y < layers * v && sdDeck(vec3f(q.x, 0.01, q.z)) < 0.0) { occ = true; }
        // the tendrils, voxelised (td at p bounds td at q: |p - q| < 0.87 v)
        if (td < v * 1.15) { if (sdTendrils(q) < v * 0.25) { occ = true; } }
        if (occ) {
            let bx = sdBox3(p - q, vec3f(v * 0.5 * mix(0.8, 0.97, hq.y)));
            res = opU(res, vec2f(bx, 11.0));
        }
    }
    stepS = min(res.x, v * 0.5);
    return vec3f(res, max(min(stepS, res.x), 0.0));
}

fn sceneNormal(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0015;
    return normalize(e.xyy * mapScene(p + e.xyy, true).x + e.yyx * mapScene(p + e.yyx, true).x +
                     e.yxy * mapScene(p + e.yxy, true).x + e.xxx * mapScene(p + e.xxx, true).x);
}
fn sceneAO(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 4; i++) {
        let h = 0.03 + 0.09 * f32(i);
        o += (h - mapScene(p + n * h, false).x) * w;
        w *= 0.6;
    }
    return clamp(1.0 - 2.2 * o, 0.0, 1.0);
}
// (t, material); t < 0 is a miss
fn marchScene(ro: vec3f, rd: vec3f, tmax: f32) -> vec2f {
    var t = 0.02;
    for (var i = 0; i < 200; i++) {
        let r = mapScene(ro + rd * t, true);
        if (r.x < 0.0008 * t + 0.0004) { return vec2f(t, r.y); }
        t += max(r.z, 0.0006 * t + 0.0003);
        if (t > tmax) { break; }
    }
    return vec2f(-1.0, 0.0);
}

// ── the backdrop: the studio, or a void with stars and a red haze ─────────
fn backdropC(rd: vec3f) -> vec3f {
    if (u.k.z > 0.5) { return env(rd) * mix(0.35, 1.0, u.studio); }
    let cell = floor(rd * 220.0);
    let h = hash3(cell);
    var c = vec3f(0.004, 0.004, 0.007);
    c += vec3f(0.8, 0.85, 1.0) * step(0.9975, h.x) * pow(h.y, 4.0) * 3.0;
    let hz = fbm3(rd * 2.4 + vec3f(seedF() * 0.1), 3);
    c += redE() * 0.025 * smoothstep(0.0, 0.6, hz) * (1.0 - abs(rd.y));
    return c;
}

// ── deck plates (albedo) ────────────────────────────────────────────────────
fn deckAlb(p: vec3f) -> vec3f {
    let s = 1.15;
    let tile = floor(p.xz / s);
    let f = fract(p.xz / s);
    let h = hash3(vec3f(tile, 3.0));
    var alb = vec3f(mix(0.05, 0.085, h.x));
    let e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
    alb *= mix(0.2, 1.0, smoothstep(0.004, 0.012, e));
    if (h.y > 0.8 && e > 0.12) {
        alb *= mix(0.3, 1.0, step(0.45, fract(select(p.x, p.z, h.z > 0.5) * 22.0)));
    }
    let bolt = length(abs(f - 0.5) - vec2f(0.44));
    alb = mix(alb, vec3f(0.3), smoothstep(0.012, 0.006, bolt));
    let hz = abs(abs(p.x) - 2.6);
    if (hz < 0.075) {
        let st = step(0.5, fract((p.z + p.x) * 2.6));
        alb = mix(vec3f(0.02), vec3f(0.5, 0.36, 0.04), st);
    }
    return alb;
}

fn sdfClean(m: f32, p: vec3f, n: vec3f, rd: vec3f, occ: f32) -> vec3f {
    let id = i32(m + 0.5);
    if (id == 0) { return cleanLit(p, n, rd, deckAlb(p), 0.25, 0.42, occ); }
    if (id == 1) { return cleanLit(p, n, rd, vec3f(0.72, 0.73, 0.75), 0.0, 0.32, occ); }
    if (id == 2) { return cleanLit(p, n, rd, vec3f(0.07, 0.075, 0.08), 0.3, 0.5, occ); }
    if (id == 3) { return cleanLit(p, n, rd, vec3f(0.6, 0.05, 0.04), 0.0, 0.3, occ); }
    if (id == 4) { return cleanLit(p, n, rd, vec3f(0.05, 0.12, 0.14), 0.8, 0.1, occ) + cTone() * 0.8; }
    if (id == 5) {
        let pl = panelLines(p, n);
        return cleanLit(p, n, rd, vec3f(0.52, 0.54, 0.58) * (1.0 - 0.7 * pl.x), 0.85, 0.3, occ);
    }
    if (id == 6) {
        let pulse = 0.7 + 0.3 * sin(u.time * 2.0 + p.y * 9.0);
        return cleanLit(p, n, rd, vec3f(0.1), 0.0, 0.2, occ) + cTone() * 3.2 * pulse;
    }
    if (id == 7) {
        let pl = panelLines(p, n);
        return cleanLit(p, n, rd, vec3f(0.55, 0.38, 0.1) * (1.0 - 0.75 * pl.x), 0.1, 0.45, occ);
    }
    if (id == 8) { return cleanLit(p, n, rd, vec3f(0.36, 0.34, 0.31), 0.0, 0.6, occ); }
    if (id == 10) { return cleanLit(p, n, rd, vec3f(0.08, 0.085, 0.09), 0.9, 0.22, occ); }
    return vec3f(0.0);
}

// ── fullscreen triangle ─────────────────────────────────────────────────────
@vertex fn vs_full(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    let x = f32((i << 1u) & 2u); let y = f32(i & 2u);
    return vec4f(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
}
fn pixelRay(fp: vec2f) -> vec3f {
    let ndc = vec2f(fp.x / u.size.x * 2.0 - 1.0, 1.0 - fp.y / u.size.y * 2.0 + u.camF.w);
    return normalize(u.camF.xyz + u.camR.xyz * (ndc.x * u.camU.w * u.camR.w) + u.camU.xyz * (ndc.y * u.camU.w));
}

struct SceneOut { @location(0) c: vec4f, @builtin(frag_depth) depth: f32 };
@fragment fn fs_scene(@builtin(position) fp: vec4f) -> SceneOut {
    let ro = u.cam.xyz;
    let rd = pixelRay(fp.xy);
    var o: SceneOut;
    let hit = marchScene(ro, rd, 40.0);
    if (hit.x < 0.0) {
        o.c = vec4f(backdropC(rd), 1.0);
        o.depth = 1.0;
        return o;
    }
    let p = ro + rd * hit.x;
    let n = sceneNormal(p);
    let occ = sceneAO(p, n);
    var c = vec3f(0.0);
    if (hit.y > 10.5) {
        c = shadeCorrupt(p, n, rd, vec3f(0.0), 0.02) * mix(0.55, 1.0, occ);
    } else {
        c = shadeCorrupt(p, n, rd, sdfClean(hit.y, p, n, rd, occ), -1e3);
    }
    // fade into the backdrop with distance
    c = mix(c, backdropC(rd), smoothstep(9.0, 26.0, hit.x));
    o.c = vec4f(c, 1.0);
    let clip = u.viewProj * vec4f(p, 1.0);
    o.depth = clamp(clip.z / clip.w, 0.0, 1.0);
    return o;
}

// ── points on the SDF model surface (for the particles and the digits) ─────
fn modelGrad(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.002;
    return normalize(e.xyy * sdModel(p + e.xyy).x + e.yyx * sdModel(p + e.yyx).x +
                     e.yxy * sdModel(p + e.yxy).x + e.xxx * sdModel(p + e.xxx).x);
}
@compute @workgroup_size(64) fn cs_sample(@builtin(global_invocation_id) gid: vec3u) {
    let i = gid.x;
    let n = u32(u.k.w);
    if (i >= n) { return; }
    let h = hash3(vec3f(f32(i), 1.0, 77.0));
    var p = u.bound.xyz + (h * 2.0 - 1.0) * u.bound.w;
    for (var k = 0; k < 14; k++) {
        let d = sdModel(p).x;
        p -= modelGrad(p) * d;
    }
    let ok = select(0.0, 1.0, abs(sdModel(p).x) < 0.01);
    samplesRW[i * 2u] = vec4f(p, ok);
    samplesRW[i * 2u + 1u] = vec4f(modelGrad(p), 0.0);
}

// ── the click: one ray against the SDF scene ───────────────────────────────
@compute @workgroup_size(1) fn cs_pick() {
    let hit = marchScene(u.pick.xyz, normalize(u.pickD.xyz), 40.0);
    pickOut[0] = vec4f(u.pick.xyz + normalize(u.pickD.xyz) * max(hit.x, 0.0), hit.x);
}

// ── the mesh pass ───────────────────────────────────────────────────────────
struct MOut {
    @builtin(position) pos: vec4f,
    @location(0) wp: vec3f,
    @location(1) n: vec3f,
    @location(2) c: f32,
};
@vertex fn vs_mesh(@location(0) pos: vec3f, @location(1) nrm: vec3f) -> MOut {
    let v = u.shape.x;
    let f = corruptFieldOct(pos, 3);
    let c = smoothstep(0.0, 0.08, f);
    let cell = floor(pos / v);
    let h = hash3(cell + vec3f(seedF() * 7.0));
    var p = mix(pos, (cell + 0.5) * v, c);
    // the crust grows out in whole voxels along the face axis
    let lift = floor(h.x * (1.0 + 3.0 * u.grow.x)) * v * u.grow.x * c;
    p += axisN(nrm) * lift;
    // stutter: a few cells jump for one frame in nine
    let tq = floor(u.time * 9.0);
    let hj = hash3(cell + vec3f(tq, 3.0, 1.0));
    p += (hj - 0.5) * v * 2.5 * u.grow.z * c * step(0.93, hj.x);
    var o: MOut;
    o.pos = u.viewProj * vec4f(p, 1.0);
    o.wp = p;
    o.n = nrm;
    o.c = c;
    return o;
}
@fragment fn fs_mesh(i: MOut) -> @location(0) vec4f {
    let fdx = dpdx(i.wp);
    let fdy = dpdy(i.wp);
    var n = normalize(i.n);
    // the inside shows through a hole: the vertex normal points away from
    // the eye (the winding of an imported mesh is not trusted)
    let ff = dot(n, i.wp - u.cam.xyz) < 0.0;
    if (!ff) { n = -n; }
    var nf = cross(fdx, fdy);
    nf = select(n, normalize(nf), dot(nf, nf) > 1e-14);
    if (dot(nf, n) < 0.0) { nf = -nf; }
    let nn = normalize(mix(n, nf, clamp(i.c, 0.0, 1.0)));
    let rd = normalize(i.wp - u.cam.xyz);
    let hh = hash3(floor(i.wp / u.shape.x) + vec3f(seedF() * 5.0, 9.0, 0.0));
    if (i.c > 0.6 && hh.x < u.grow.y * 0.75) { discard; }
    var alb = u.mat.rgb;
    var emit = vec3f(0.0);
    if (u.mat2.y > 0.5) {
        let pl = panelLines(i.wp, n);
        alb *= 1.0 - 0.7 * pl.x;
        emit = cTone() * pl.y * 1.6;
    }
    let occ = mix(0.55, 1.0, smoothstep(0.0, 0.5, i.wp.y));
    let clean = cleanLit(i.wp, nn, rd, alb, u.mat.w, u.mat2.x, occ) + emit;
    var c = shadeCorrupt(i.wp, nn, rd, clean, -1e3);
    if (!ff) { c = c * 0.12 + redE() * 0.25; }
    let fog = smoothstep(9.0, 26.0, length(i.wp - u.cam.xyz));
    return vec4f(mix(c, backdropC(rd), fog), 1.0);
}

// ── shed polyhedra ──────────────────────────────────────────────────────────
// a spawn point for particle i in cycle cyc: (position, alive) and normal
struct Spawn { p: vec3f, n: vec3f, ok: f32 };
fn spawnAt(i: f32, cyc: f32, salt: f32) -> Spawn {
    let hc = hash3(vec3f(i, cyc, salt + seedF()));
    var s: Spawn;
    let ns = u32(u.k.w);
    let fromDeck = hc.x < 0.3 || ns == 0u;
    if (fromDeck) {
        let a = hc.y * TAU;
        let r = sqrt(hc.z) * spreadR() * 0.95;
        s.p = vec3f(u.src.x + cos(a) * r, 0.01, u.src.z + sin(a) * r);
        s.n = vec3f(0.0, 1.0, 0.0);
        s.ok = 1.0;
    } else {
        let idx = min(u32(hc.y * f32(ns)), ns - 1u);
        let a = samples[idx * 2u];
        s.p = a.xyz;
        s.n = samples[idx * 2u + 1u].xyz;
        s.ok = a.w;
    }
    s.ok *= step(0.0, corruptFieldOct(s.p, 2));
    return s;
}
fn swarmAt(t: f32) -> vec3f {
    let R = u.bound.w * 1.7;
    return u.bound.xyz + vec3f(cos(t * 0.45) * R, 0.35 + 0.45 * sin(t * 0.8), sin(t * 0.37) * R);
}
struct POut {
    @builtin(position) pos: vec4f,
    @location(0) n: vec3f,
    @location(1) wp: vec3f,
    @location(2) glow: f32,
    @location(3) age: f32,
};
@vertex fn vs_part(@location(0) vp: vec3f, @location(1) vn: vec3f, @builtin(instance_index) ii: u32) -> POut {
    var o: POut;
    let i = f32(ii);
    let h0 = hash3(vec3f(i, 1.0, 31.0 + seedF()));
    let life = mix(1.8, 4.5, h0.x) / max(u.sdfx.w, 0.05);
    let tt = u.time / life + h0.y;
    let cyc = floor(tt);
    let a = fract(tt);
    let s = spawnAt(i, cyc, 2.0);
    let hc = hash3(vec3f(i, cyc, 41.0));
    var p = s.p + s.n * (0.04 + 0.5 * hc.z) * a + vec3f(0.0, 0.7 * a * a, 0.0);
    let w = vec3f(gnoise(s.p * 2.0 + vec3f(a * 1.5, 0.0, i * 0.01)),
                  gnoise(s.p * 2.0 + vec3f(5.2, a * 1.5, 0.0)),
                  gnoise(s.p * 2.0 + vec3f(0.0, 9.1, a * 1.5)));
    p += w * 0.45 * a;
    let lagT = u.time - a * (1.2 + 2.0 * hc.x);
    let sw = swarmAt(lagT) + (hc - 0.5) * 0.35 * (0.3 + a);
    p = mix(p, sw, u.part.w * smoothstep(0.05, 0.7, a));
    let alive = select(0.0, 1.0, i < u.part.x) * s.ok;
    let sz = u.part.z * mix(0.45, 1.7, hc.y * hc.y) * pow(sin(a * PI), 0.6) * alive;
    let ax = normalize(h0 - 0.5 + vec3f(1e-3));
    let ang = a * (2.0 + 7.0 * h0.z) + h0.x * TAU;
    let lp = rodrigues(vp, ax, ang) * sz;
    o.wp = p + lp;
    o.n = rodrigues(vn, ax, ang);
    o.pos = u.viewProj * vec4f(o.wp, 1.0);
    o.glow = step(0.9, hc.x);
    o.age = a;
    return o;
}
@fragment fn fs_part(i: POut) -> @location(0) vec4f {
    let n = normalize(i.n);
    let rd = normalize(i.wp - u.cam.xyz);
    let alb = vec3f(0.035, 0.034, 0.037);
    var c = plastic(rd, n, alb, 1.0) * 0.8 + lamps(i.wp, n, rd, alb, 0.35, 1.0);
    let fres = pow(1.0 - abs(dot(n, rd)), 3.0);
    c += redE() * (i.glow * (1.1 + 0.6 * fres) + fres * 0.06 + (1.0 - smoothstep(0.0, 0.12, i.age)) * 0.5);
    return vec4f(c, 1.0);
}

// ── red zeros and ones ─────────────────────────────────────────────────────
struct GOut {
    @builtin(position) pos: vec4f,
    @location(0) q: vec2f,
    @location(1) @interpolate(flat) bits: vec2f,
};
@vertex fn vs_glyph(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> GOut {
    var o: GOut;
    var corner = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
                                 vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
    let cq = corner[vi];
    let i = f32(ii);
    let h0 = hash3(vec3f(i, 2.0, 57.0 + seedF()));
    let life = mix(2.2, 5.5, h0.x) / (0.4 + 0.6 * u.sdfx.w);
    let tt = u.time / life + h0.y;
    let cyc = floor(tt);
    let a = fract(tt);
    let s = spawnAt(i, cyc, 9.0);
    let hc = hash3(vec3f(i, cyc, 63.0));
    var c = s.p + s.n * (0.03 + 0.22 * a * hc.z) + vec3f(0.0, 0.45 * a * hc.y, 0.0);
    // a third of them hang in the air round the front instead
    if (hc.x < 0.33) {
        let d = normalize(hash3(vec3f(i, cyc, 71.0)) - 0.5 + vec3f(1e-3));
        c = u.src.xyz + d * spreadR() * (0.7 + 0.5 * hc.y) + vec3f(0.0, 0.25 * a, 0.0);
    }
    let fade = smoothstep(0.0, 0.12, a) * (1.0 - smoothstep(0.7, 1.0, a));
    let alive = select(0.0, 1.0, i < u.part.y) * s.ok;
    let sz = u.part2.x * mix(0.7, 1.35, hc.z) * alive;
    let wp = c + (u.camR.xyz * cq.x * 0.5 + u.camU.xyz * cq.y * 0.75) * sz;
    o.pos = u.viewProj * vec4f(wp, 1.0);
    o.q = cq * vec2f(0.5, 0.75);
    let flipT = floor(u.time * u.part2.y * (0.4 + h0.z) + h0.x * 13.0);
    let one = select(0.0, 1.0, hash3(vec3f(i, flipT, 83.0)).x > 0.5);
    o.bits = vec2f(one, fade * (0.7 + 0.3 * sin(u.time * 17.0 + i)));
    return o;
}
@fragment fn fs_glyph(i: GOut) -> @location(0) vec4f {
    let d = sdDigit(i.q, i.bits.x > 0.5);
    let core = 1.0 - smoothstep(-0.015, 0.025, d);
    let halo = exp(-max(d, 0.0) * 14.0) * 0.4;
    let c = redE() * (core * 1.7 + halo * (0.35 + 0.5 * u.fx.w)) * i.bits.y;
    return vec4f(c, 1.0);
}

// ── post: glitch, colour split, bloom taps, scan lines, the finisher ──────
@fragment fn fs_post(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    var uv = fp.xy / u.size;
    let g = u.fx.x;
    let tq = floor(u.time * 14.0);
    let band = floor(uv.y * 38.0);
    let hb = hash3(vec3f(band, tq, 5.0));
    let tear = step(1.0 - g * 0.2, hb.x);
    uv.x += (hb.y - 0.5) * 0.08 * g * tear;
    if (tear > 0.5 && hb.z < g * 0.5) {
        let grid = vec2f(96.0, 54.0);
        uv = (floor(uv * grid) + 0.5) / grid;
    }
    let ch = u.fx.y * 0.0035 * (1.0 + 4.0 * tear);
    let cr = textureSampleLevel(hdrTex, hdrSamp, uv + vec2f(ch, 0.0), 0.0).r;
    let cg = textureSampleLevel(hdrTex, hdrSamp, uv, 0.0).g;
    let cb = textureSampleLevel(hdrTex, hdrSamp, uv - vec2f(ch, 0.0), 0.0).b;
    var c = vec3f(cr, cg, cb);
    // bloom: three rings of taps on the bright part
    var bl = vec3f(0.0);
    let asp = vec2f(u.size.y / u.size.x, 1.0);
    for (var r = 0; r < 3; r++) {
        let rad = 0.006 * pow(2.6, f32(r));
        for (var k = 0; k < 8; k++) {
            let a = (f32(k) + f32(r) * 0.5) * TAU / 8.0;
            let s = textureSampleLevel(hdrTex, hdrSamp, uv + vec2f(cos(a), sin(a)) * rad * asp, 0.0).rgb;
            bl += max(s - vec3f(0.8), vec3f(0.0)) * (1.0 - f32(r) * 0.25);
        }
    }
    c += bl / 24.0 * u.fx.w * 2.2;
    c *= 1.0 - u.fx.z * 0.3 * (0.5 + 0.5 * sin(fp.y * 2.1));
    let roll = fract(uv.y * 0.6 - u.time * 0.11);
    c *= 1.0 - u.fx.z * 0.18 * smoothstep(0.0, 0.03, roll) * (1.0 - smoothstep(0.03, 0.1, roll));
    let vu = (fp.xy - 0.5 * u.size) / max(min(u.size.x, u.size.y), 1.0);
    return finish(c, vu);
}
