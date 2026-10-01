// ═══════════════════════════════════════════════════════════════════════════
//  SDF SOLIDS TABLE  ·  one fragment shader per cell, a sphere-traced solid
//  each. Every cell reads uv, the hover clock t, four knobs k and the camera
//  ray, then returns finish(color, uv). One procedural studio, fn env, lights
//  all cells and takes its tint from the ink, tone and cream swatches.
//  Sphere tracing after Hart 1996; distance primitives, smooth-min, the
//  tetrahedron normal, domain warping, the primitive catalog (box frame, hex
//  prism, link, octahedron, capped cone, rounded cylinder, death star, solid
//  angle, pyramid, ellipsoid), the operators (smooth min, onion, twist, bend,
//  limited repetition, elongation) and soft shadows after Quilez; Fresnel
//  after Schlick 1994; refraction by Snell's law with a three-index split for
//  dispersion; thin-film color from two-beam interference; gradient noise
//  after Perlin (pcg3d hashing, Jarzynski and Olano 2020); cells after Worley
//  1996; the Menger sponge and Apollonian packing after Quilez; the Sierpinski
//  fold after Knighty and Syntopia; the Mandelbox after Lowe 2010; the
//  quaternion Julia bound after Hart, Sandin and Kauffman 1989. The studio,
//  the cell layouts and the shading are original.
// ═══════════════════════════════════════════════════════════════════════════
const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.283185307179586;

struct SolidU {
    size: vec2f, time: f32, pixelScale: f32,
    ink: vec4f, tone: vec4f, cream: vec4f,
    exposure: f32, studio: f32, glow: f32, pad1: f32,
    k: vec4f,
};
@group(0) @binding(0) var<uniform> u: SolidU;

@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(p[i], 0.0, 1.0);
}

// ── pixel, camera, rotation ─────────────────────────────────────────────────
// uv: x right, y up, the short side spans -0.5 .. 0.5
fn suv(fp: vec2f) -> vec2f {
    let p = fp / max(u.pixelScale, 0.001);
    let n = (p - 0.5 * u.size) / max(min(u.size.x, u.size.y), 1.0);
    return vec2f(n.x, -n.y + 0.02);
}
fn camO() -> vec3f { return vec3f(0.0, 1.15, 4.4); }
fn camRt() -> vec3f { return normalize(cross(normalize(-camO()), vec3f(0.0, 1.0, 0.0))); }
fn camUp() -> vec3f { return cross(camRt(), normalize(-camO())); }
fn camD(uv: vec2f) -> vec3f { return normalize(normalize(-camO()) * 1.6 + camRt() * uv.x + camUp() * uv.y); }

fn rotY(a: f32) -> mat3x3f { let c = cos(a); let s = sin(a); return mat3x3f(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
fn rotX(a: f32) -> mat3x3f { let c = cos(a); let s = sin(a); return mat3x3f(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
fn rot2(a: f32) -> mat2x2f { let c = cos(a); let s = sin(a); return mat2x2f(c, s, -s, c); }
// turn a point into object space: yaw a, then pitch b
fn spin(p: vec3f, a: f32, b: f32) -> vec3f { return rotX(b) * (rotY(a) * p); }

// ── palette (swatches arrive as sRGB, the shading runs linear) ──────────────
fn cInk() -> vec3f { return pow(u.ink.rgb, vec3f(2.2)); }
fn cTone() -> vec3f { return pow(u.tone.rgb, vec3f(2.2)); }
fn cCream() -> vec3f { return pow(u.cream.rgb, vec3f(2.2)); }
fn hue(h: f32) -> vec3f { return 0.5 + 0.5 * cos(TAU * (h + vec3f(0.0, 0.33, 0.67))); }

// ── hashing, gradient noise, cells ──────────────────────────────────────────
fn pcg3d(vin: vec3u) -> vec3u {
    var v = vin * 1664525u + 1013904223u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    v ^= v >> vec3u(16u);
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    return v;
}
fn hash3(p: vec3f) -> vec3f { return vec3f(pcg3d(bitcast<vec3u>(vec3i(floor(p))))) * (1.0 / 4294967295.0); }
fn gcorner(i: vec3f, f: vec3f, o: vec3f) -> f32 { return dot(hash3(i + o) * 2.0 - 1.0, f - o); }
fn gnoise(p: vec3f) -> f32 {
    let i = floor(p); let f = fract(p);
    let w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    let a = mix(gcorner(i, f, vec3f(0.0, 0.0, 0.0)), gcorner(i, f, vec3f(1.0, 0.0, 0.0)), w.x);
    let b = mix(gcorner(i, f, vec3f(0.0, 1.0, 0.0)), gcorner(i, f, vec3f(1.0, 1.0, 0.0)), w.x);
    let c = mix(gcorner(i, f, vec3f(0.0, 0.0, 1.0)), gcorner(i, f, vec3f(1.0, 0.0, 1.0)), w.x);
    let d = mix(gcorner(i, f, vec3f(0.0, 1.0, 1.0)), gcorner(i, f, vec3f(1.0, 1.0, 1.0)), w.x);
    return mix(mix(a, b, w.y), mix(c, d, w.y), w.z) * 1.3;
}
fn fbm3(p0: vec3f, oct: i32) -> f32 {
    var p = p0; var a = 0.5; var s = 0.0; var n = 0.0;
    for (var i = 0; i < 6; i++) {
        if (i >= oct) { break; }
        s += a * gnoise(p); n += a; a *= 0.5;
        p = p * 2.03 + vec3f(1.7, -3.1, 2.3);
    }
    return s / max(n, 1e-4);
}
fn worley2(p: vec3f) -> vec2f {
    let i = floor(p); let f = fract(p);
    var d1 = 8.0; var d2 = 8.0;
    for (var z = -1; z <= 1; z++) { for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
        let o = vec3f(f32(x), f32(y), f32(z));
        let r = o + hash3(i + o) - f;
        let d = dot(r, r);
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    } } }
    return sqrt(vec2f(d1, d2));
}

// ── distance helpers ────────────────────────────────────────────────────────
fn smin(a: f32, b: f32, k0: f32) -> f32 {
    let k = max(k0, 1e-4);
    let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}
fn rbox(p: vec3f, b: vec3f, r: f32) -> f32 {
    let q = abs(p) - b + r;
    return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}
fn sphHit(ro: vec3f, rd: vec3f, r: f32) -> vec2f {
    let b = dot(ro, rd); let c = dot(ro, ro) - r * r; let h = b * b - c;
    if (h < 0.0) { return vec2f(-1.0); }
    let s = sqrt(h);
    return vec2f(-b - s, -b + s);
}

// ── more distance primitives and operators (after Quilez) ───────────────────
fn sdBox2(p: vec2f, b: vec2f) -> f32 { let d = abs(p) - b; return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0); }
fn sdTorus(p: vec3f, R: f32, r: f32) -> f32 { return length(vec2f(length(p.xz) - R, p.y)) - r; }
// capped cylinder on the y axis: half height h, radius r
fn sdCyl(p: vec3f, h: f32, r: f32) -> f32 {
    let d = abs(vec2f(length(p.xz), p.y)) - vec2f(r, h);
    return min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0)));
}
fn sdCapsule(p: vec3f, a: vec3f, b: vec3f, r: f32) -> f32 {
    let pa = p - a; let ba = b - a;
    let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
}
fn sdSeg2(p: vec2f, a: vec2f, b: vec2f) -> f32 {
    let pa = p - a; let ba = b - a;
    return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}
// 2D trapezoid (a capped cone in profile): bottom radius r1, top r2, half height he
fn sdTrap(p0: vec2f, r1: f32, r2: f32, he: f32) -> f32 {
    let k1 = vec2f(r2, he);
    let k2 = vec2f(r2 - r1, 2.0 * he);
    let p = vec2f(abs(p0.x), p0.y);
    let ca = vec2f(p.x - min(p.x, select(r2, r1, p.y < 0.0)), abs(p.y) - he);
    let cb = p - k1 + k2 * clamp(dot(k1 - p, k2) / dot(k2, k2), 0.0, 1.0);
    let s = select(1.0, -1.0, cb.x < 0.0 && ca.y < 0.0);
    return s * sqrt(min(dot(ca, ca), dot(cb, cb)));
}
fn sdEllipsoid(p: vec3f, r: vec3f) -> f32 {
    let k0 = length(p / r); let k1 = length(p / (r * r));
    return k0 * (k0 - 1.0) / max(k1, 1e-5);
}
// extrude a 2D distance d2 along z to half depth h
fn extrude(d2: f32, z: f32, h: f32) -> f32 {
    let w = vec2f(d2, abs(z) - h);
    return min(max(w.x, w.y), 0.0) + length(max(w, vec2f(0.0)));
}
fn smax(a: f32, b: f32, k: f32) -> f32 { return -smin(-a, -b, k); }
// fold a 2D point into the first of n equal sectors around the origin
fn pmod(p: vec2f, n: f32) -> vec2f {
    let s = TAU / n;
    let b = (fract(atan2(p.y, p.x) / s + 0.5) - 0.5) * s;
    return length(p) * vec2f(cos(b), sin(b));
}

// ── the studio ──────────────────────────────────────────────────────────────
// a soft-edged rectangle of light seen in direction ax, half size hw (tangent)
fn softRect(d: vec3f, ax: vec3f, hw: vec2f, soft: f32) -> f32 {
    let c = dot(d, ax);
    if (c <= 0.0) { return 0.0; }
    let r = normalize(cross(vec3f(0.0, 1.0, 0.0), ax));
    let up = cross(ax, r);
    let e = abs(vec2f(dot(d, r), dot(d, up)) / c) - hw;
    return 1.0 - smoothstep(-soft, soft, max(e.x, e.y));
}
const KEY: vec3f = vec3f(-0.66, 0.56, 0.5);
const STRIP: vec3f = vec3f(0.95, 0.12, 0.28);
const RIM: vec3f = vec3f(0.42, 0.34, -0.84);
fn env(d0: vec3f) -> vec3f {
    let d = normalize(d0);
    let ink = cInk(); let tone = cTone(); let cream = cCream();
    let s = u.studio;
    var c = mix(ink * 0.55, ink * 1.7 + tone * 0.05, smoothstep(-0.3, 0.7, d.y));
    c += tone * 0.07 * exp(-abs(d.y - 0.03) * 16.0);
    if (d.y < -0.02) {
        let q = d.xz / -d.y * 2.4;
        let g = abs(fract(q) - 0.5);
        let line = smoothstep(0.47, 0.5, max(g.x, g.y)) * exp(-length(q) * 0.35);
        c += cream * 0.02 * line * s;
        c += cream * 0.05 * s * exp(-length(q - vec2f(-1.2, 1.4)) * 0.5);
        c += mix(cream, tone, 0.3) * 0.22 * s * smoothstep(-0.35, -0.9, d.y);
    }
    let back = max(-d.z, 0.0);
    c += mix(tone, cream, 0.55) * 0.16 * s * pow(back, 24.0) * smoothstep(-0.35, 0.05, d.y);
    c += cream * 4.2 * s * softRect(d, normalize(KEY), vec2f(0.36, 0.25), 0.035);
    c += cream * 2.6 * s * softRect(d, normalize(STRIP), vec2f(0.05, 0.55), 0.015);
    c += tone * 3.8 * s * softRect(d, normalize(RIM), vec2f(0.09, 0.55), 0.02);
    c += tone * 2.0 * s * softRect(d, normalize(vec3f(-0.9, -0.05, -0.42)), vec2f(0.32, 0.04), 0.02);
    c += cream * 1.4 * s * smoothstep(0.9, 0.95, d.y);
    return c;
}
// the same studio as broad lobes, for rough and diffuse surfaces
fn envDiff(n: vec3f) -> vec3f {
    let s = u.studio;
    var c = mix(cInk() * 0.9, cInk() * 2.2 + cTone() * 0.05, n.y * 0.5 + 0.5);
    c += cCream() * 0.95 * s * max(dot(n, normalize(KEY)), 0.0);
    c += cCream() * 0.35 * s * max(dot(n, normalize(STRIP)), 0.0);
    c += cTone() * 0.45 * s * max(dot(n, normalize(RIM)), 0.0);
    c += cCream() * 0.12 * s * max(n.y, 0.0);
    return c;
}
fn backdrop(rd: vec3f) -> vec3f { return env(rd); }

// ── optics ──────────────────────────────────────────────────────────────────
fn schlick(c: f32, f0: f32) -> f32 { return f0 + (1.0 - f0) * pow(clamp(1.0 - c, 0.0, 1.0), 5.0); }
// thin film of index nf and thickness th (nm): reflectance per channel from
// the phase between the two reflected beams, with a half-wave shift at the top
fn film(th: f32, cosI: f32, nf: f32) -> vec3f {
    let cosT = sqrt(max(1.0 - (1.0 - cosI * cosI) / (nf * nf), 0.0));
    let opd = 2.0 * nf * th * cosT;
    let i = 0.5 + 0.5 * cos(TAU * opd / vec3f(650.0, 532.0, 450.0) + PI);
    return mix(vec3f(0.5), i, exp(-th / 2600.0));
}
fn chrome(rd: vec3f, n: vec3f, tint: vec3f, occ: f32) -> vec3f {
    let f = schlick(clamp(-dot(rd, n), 0.0, 1.0), 0.0);
    return (env(reflect(rd, n)) * mix(tint, vec3f(1.0), f) + envDiff(n) * tint * 0.05) * occ;
}
fn plastic(rd: vec3f, n: vec3f, alb: vec3f, occ: f32) -> vec3f {
    let f = schlick(clamp(-dot(rd, n), 0.0, 1.0), 0.04);
    return (envDiff(n) * alb * (1.0 - f) + env(reflect(rd, n)) * f) * occ;
}
// the broad lobes with the key lobe dimmed by a shadow term sh (1 = lit)
fn envDiffS(n: vec3f, sh: f32) -> vec3f {
    return envDiff(n) - cCream() * 0.95 * u.studio * max(dot(n, normalize(KEY)), 0.0) * (1.0 - sh);
}
// a rough reflection: blend the sharp studio toward its broad lobes
fn envRough(r: vec3f, rough: f32) -> vec3f { return mix(env(r), envDiff(r) * 1.3, rough); }
// a coated dielectric: albedo alb, roughness rough, occlusion occ, shadow sh
fn dielectric(rd: vec3f, n: vec3f, alb: vec3f, rough: f32, occ: f32, sh: f32) -> vec3f {
    let f = schlick(clamp(-dot(rd, n), 0.0, 1.0), 0.04) * (1.0 - 0.6 * rough);
    return (envDiffS(n, sh) * alb * (1.0 - f) + envRough(reflect(rd, n), rough) * f * mix(0.4, 1.0, sh)) * occ;
}
// a conductor: the reflection takes the tint, white at grazing angles
fn metal(rd: vec3f, n: vec3f, tint: vec3f, rough: f32, occ: f32) -> vec3f {
    let f = schlick(clamp(-dot(rd, n), 0.0, 1.0), 0.0);
    return (envRough(reflect(rd, n), rough) * mix(tint, vec3f(1.0), f * (1.0 - rough)) + envDiff(n) * tint * 0.12) * occ;
}
// the pale studio floor under a standing solid: lit by the room and the key,
// darkened by the shadow sh and the contact term occ, faded into the room
fn stageFloor(rd: vec3f, pf: vec3f, sh: f32, occ: f32) -> vec3f {
    let s = u.studio;
    let base = mix(vec3f(0.30), cCream() * 0.42, 0.5);
    let pool = 0.55 + 0.75 * exp(-dot(pf.xz, pf.xz) * 0.22);
    let amb = cInk() * 2.4 + cCream() * 0.14 * s + cTone() * 0.03 * s;
    let key = cCream() * 0.6 * s * sh;
    var c = base * (amb + key) * pool * occ;
    c += env(reflect(rd, vec3f(0.0, 1.0, 0.0))) * 0.04 * occ;
    return mix(c, backdrop(rd), smoothstep(3.5, 9.0, length(pf.xz)));
}
// ghost operands for the operator cells: a rim glow where the ray crosses a
// sphere (center c, radius r), dimmed past tmax (behind the solid)
fn ghostSph(ro: vec3f, rd: vec3f, c: vec3f, r: f32, tmax: f32) -> f32 {
    let hs = sphHit(ro - c, rd, r);
    if (hs.y < 0.0) { return 0.0; }
    var g = 0.0;
    for (var s = 0; s < 2; s++) {
        let th = select(hs.x, hs.y, s == 1);
        if (th > 0.0) {
            let n = normalize(ro + rd * th - c);
            g += (pow(1.0 - abs(dot(n, rd)), 5.0) + 0.04) * select(1.0, 0.25, th > tmax);
        }
    }
    return g;
}
// the twelve edges of a box (half size b) for a ray o, d already in box space
fn ghostBox(o: vec3f, d: vec3f, b: vec3f, tmax: f32) -> f32 {
    let dd = select(d, vec3f(1e-5), abs(d) < vec3f(1e-5));
    let t1 = (-b - o) / dd; let t2 = (b - o) / dd;
    let tn = max(max(min(t1.x, t2.x), min(t1.y, t2.y)), min(t1.z, t2.z));
    let tf = min(min(max(t1.x, t2.x), max(t1.y, t2.y)), max(t1.z, t2.z));
    if (tn > tf || tf < 0.0) { return 0.0; }
    var g = 0.0;
    for (var s = 0; s < 2; s++) {
        let th = select(tn, tf, s == 1);
        if (th > 0.0) {
            let e = b - abs(o + d * th);
            let mid = e.x + e.y + e.z - min(e.x, min(e.y, e.z)) - max(e.x, max(e.y, e.z));
            g += (smoothstep(0.03, 0.0, mid) + 0.03) * select(1.0, 0.25, th > tmax);
        }
    }
    return g;
}
// what glass sees through itself: the studio plus a lit back wall and a
// bright floor bounce, so clear glass reads clear and not as the dark room
fn envT(d0: vec3f) -> vec3f {
    let d = normalize(d0);
    let s = u.studio;
    var c = env(d);
    let wall = smoothstep(-0.35, 0.25, d.y) * (1.0 - smoothstep(0.55, 0.95, d.y));
    c += mix(cCream(), cTone(), 0.3) * 0.5 * s * wall * (0.35 + 0.65 * max(-d.z, 0.0));
    if (d.y < 0.0) {
        let q = d.xz / max(-d.y, 0.05);
        c += cCream() * s * (0.3 * smoothstep(0.0, -0.5, d.y) + 1.3 * exp(-dot(q, q) * 5.0));
    }
    return c;
}

// ── the finisher: exposure, ACES fit (Narkowicz), vignette, gamma, dither ───
fn finish(c0: vec3f, uv: vec2f) -> vec4f {
    var c = max(c0, vec3f(0.0)) * u.exposure;
    c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
    c *= 1.0 - 0.5 * dot(uv, uv);
    c = pow(clamp(c, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2));
    let dn = hash3(vec3f(uv * 3000.0, 7.0)).x - 0.5;
    return vec4f(c + dn / 255.0, 1.0);
}

// ── the 78 cells ─────────────────────────────────────────────────────────────

// ── brilliant (glass) ──
fn map_brilliant(p0: vec3f) -> f32 {
    let t = u.time; let k = u.k;
    var p = spin(p0, t * 0.45 + 0.5, -0.62) / 0.92;
    p.y -= 0.36;
    let n = floor(mix(6.0, 14.0, k.x) + 0.5);
    let sec = TAU / n;
    let a = atan2(p.z, p.x);
    let r = length(p.xz);
    let x1 = r * cos((fract(a / sec + 0.5) - 0.5) * sec);
    let x2 = r * cos((fract(a / sec) - 0.5) * sec);
    var d = x1 - 1.0;
    d = max(d, p.y - 0.32);
    d = max(d, dot(vec2f(x1, p.y), normalize(vec2f(0.55, 1.0))) - 0.62);
    d = max(d, dot(vec2f(x2, p.y), normalize(vec2f(0.9, 1.0))) - 0.78);
    d = max(d, dot(vec2f(x1, -p.y), normalize(vec2f(1.0, 0.95))) - 0.72);
    d = max(d, dot(vec2f(x2, -p.y), normalize(vec2f(1.0, 0.8))) - 0.76);
    return d * 0.92;
}
// sphere trace map_brilliant inside its bounding sphere; -1 on a miss
fn march_brilliant(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_brilliant(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_brilliant(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_brilliant
fn nrm_brilliant(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_brilliant(p + e.xyy) + e.yyx * map_brilliant(p + e.yyx) + e.yxy * map_brilliant(p + e.yxy) + e.xxx * map_brilliant(p + e.xxx));
}
// path length from an inside point p along rd to the far wall of map_brilliant
fn thru_brilliant(p: vec3f, rd: vec3f) -> f32 {
    var t = 0.01;
    for (var i = 0; i < 40; i++) {
        let d = -map_brilliant(p + rd * t);
        if (d < 0.0008) { break; }
        t += max(d, 0.002);
    }
    return t;
}
// dispersive glass on map_brilliant: reflect, refract in, up to two internal
// reflections, then refract out at ior - spread, ior, ior + spread (R, G, B)
fn glass_brilliant(p0: vec3f, rd0: vec3f, n0: vec3f, ior: f32, spread: f32, absorb: vec3f) -> vec3f {
    let fr = schlick(clamp(-dot(rd0, n0), 0.0, 1.0), pow((ior - 1.0) / (ior + 1.0), 2.0));
    var col = envT(reflect(rd0, n0)) * max(fr, 0.07) * 1.3;
    var dir = refract(rd0, n0, 1.0 / ior);
    var pos = p0 - n0 * 0.004;
    var thr = vec3f(1.0 - fr);
    for (var b = 0; b < 3; b++) {
        let d = thru_brilliant(pos, dir);
        pos += dir * d;
        thr *= exp(-absorb * d);
        let ne = -nrm_brilliant(pos);
        let eg = refract(dir, ne, ior);
        if (dot(eg, eg) > 0.0 || b == 2) {
            let rf = envT(reflect(dir, ne));
            let er = refract(dir, ne, ior - spread);
            let eb = refract(dir, ne, ior + spread);
            let cr = select(rf.r, envT(er).r, dot(er, er) > 0.0);
            let cg = select(rf.g, envT(eg).g, dot(eg, eg) > 0.0);
            let cb = select(rf.b, envT(eb).b, dot(eb, eb) > 0.0);
            return col + thr * vec3f(cr, cg, cb);
        }
        dir = reflect(dir, ne);
        pos += ne * 0.004;
    }
    return col;
}
@fragment fn fs_brilliant(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_brilliant(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_brilliant(p);
  return finish(glass_brilliant(p, rd, n, 2.15, mix(0.02, 0.16, k.y), (1.0 - cTone()) * mix(0.0, 0.6, k.z)), uv);
}

// ── prism_bar (glass) ──
fn sdPoly(p: vec2f, n: f32, a: f32) -> f32 {
    let sec = TAU / n;
    let f = (fract(atan2(p.y, p.x) / sec + 0.5) - 0.5) * sec;
    let q = length(p) * vec2f(cos(f), abs(sin(f)));
    if (q.x < a) { return q.x - a; }
    return length(vec2f(q.x - a, max(q.y - a * tan(sec * 0.5), 0.0)));
}
fn map_prism_bar(p0: vec3f) -> f32 {
    let t = u.time; let k = u.k;
    let p = spin(p0, t * 0.35 + 0.45, 0.3 + 0.25 * sin(t * 0.4) + t * 0.3);
    let n = 3.0 + floor(k.x * 5.99);
    let d2 = sdPoly(p.yz, n, mix(0.2, 0.42, k.y)) + 0.04;
    let w = vec2f(d2, abs(p.x) - 1.0);
    return min(max(w.x, w.y), 0.0) + length(max(w, vec2f(0.0))) - 0.06;
}
// sphere trace map_prism_bar inside its bounding sphere; -1 on a miss
fn march_prism_bar(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_prism_bar(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_prism_bar(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_prism_bar
fn nrm_prism_bar(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_prism_bar(p + e.xyy) + e.yyx * map_prism_bar(p + e.yyx) + e.yxy * map_prism_bar(p + e.yxy) + e.xxx * map_prism_bar(p + e.xxx));
}
// path length from an inside point p along rd to the far wall of map_prism_bar
fn thru_prism_bar(p: vec3f, rd: vec3f) -> f32 {
    var t = 0.01;
    for (var i = 0; i < 40; i++) {
        let d = -map_prism_bar(p + rd * t);
        if (d < 0.0008) { break; }
        t += max(d, 0.002);
    }
    return t;
}
// dispersive glass on map_prism_bar: reflect, refract in, up to two internal
// reflections, then refract out at ior - spread, ior, ior + spread (R, G, B)
fn glass_prism_bar(p0: vec3f, rd0: vec3f, n0: vec3f, ior: f32, spread: f32, absorb: vec3f) -> vec3f {
    let fr = schlick(clamp(-dot(rd0, n0), 0.0, 1.0), pow((ior - 1.0) / (ior + 1.0), 2.0));
    var col = envT(reflect(rd0, n0)) * max(fr, 0.07) * 1.3;
    var dir = refract(rd0, n0, 1.0 / ior);
    var pos = p0 - n0 * 0.004;
    var thr = vec3f(1.0 - fr);
    for (var b = 0; b < 3; b++) {
        let d = thru_prism_bar(pos, dir);
        pos += dir * d;
        thr *= exp(-absorb * d);
        let ne = -nrm_prism_bar(pos);
        let eg = refract(dir, ne, ior);
        if (dot(eg, eg) > 0.0 || b == 2) {
            let rf = envT(reflect(dir, ne));
            let er = refract(dir, ne, ior - spread);
            let eb = refract(dir, ne, ior + spread);
            let cr = select(rf.r, envT(er).r, dot(er, er) > 0.0);
            let cg = select(rf.g, envT(eg).g, dot(eg, eg) > 0.0);
            let cb = select(rf.b, envT(eb).b, dot(eb, eb) > 0.0);
            return col + thr * vec3f(cr, cg, cb);
        }
        dir = reflect(dir, ne);
        pos += ne * 0.004;
    }
    return col;
}
@fragment fn fs_prism_bar(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_prism_bar(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_prism_bar(p);
  return finish(glass_prism_bar(p, rd, n, 1.62, mix(0.03, 0.2, k.z), vec3f(0.02)), uv);
}

// ── ring_torus (glass) ──
fn map_ring_torus(p0: vec3f) -> f32 {
    let t = u.time; let k = u.k;
    let p = spin(p0, t * 0.5 + 0.2, 1.05 + 0.35 * sin(t * 0.37));
    return length(vec2f(length(p.xz) - 0.7, p.y)) - mix(0.16, 0.36, k.x);
}
// sphere trace map_ring_torus inside its bounding sphere; -1 on a miss
fn march_ring_torus(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_ring_torus(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_ring_torus(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_ring_torus
fn nrm_ring_torus(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_ring_torus(p + e.xyy) + e.yyx * map_ring_torus(p + e.yyx) + e.yxy * map_ring_torus(p + e.yxy) + e.xxx * map_ring_torus(p + e.xxx));
}
// path length from an inside point p along rd to the far wall of map_ring_torus
fn thru_ring_torus(p: vec3f, rd: vec3f) -> f32 {
    var t = 0.01;
    for (var i = 0; i < 40; i++) {
        let d = -map_ring_torus(p + rd * t);
        if (d < 0.0008) { break; }
        t += max(d, 0.002);
    }
    return t;
}
// dispersive glass on map_ring_torus: reflect, refract in, up to two internal
// reflections, then refract out at ior - spread, ior, ior + spread (R, G, B)
fn glass_ring_torus(p0: vec3f, rd0: vec3f, n0: vec3f, ior: f32, spread: f32, absorb: vec3f) -> vec3f {
    let fr = schlick(clamp(-dot(rd0, n0), 0.0, 1.0), pow((ior - 1.0) / (ior + 1.0), 2.0));
    var col = envT(reflect(rd0, n0)) * max(fr, 0.07) * 1.3;
    var dir = refract(rd0, n0, 1.0 / ior);
    var pos = p0 - n0 * 0.004;
    var thr = vec3f(1.0 - fr);
    for (var b = 0; b < 3; b++) {
        let d = thru_ring_torus(pos, dir);
        pos += dir * d;
        thr *= exp(-absorb * d);
        let ne = -nrm_ring_torus(pos);
        let eg = refract(dir, ne, ior);
        if (dot(eg, eg) > 0.0 || b == 2) {
            let rf = envT(reflect(dir, ne));
            let er = refract(dir, ne, ior - spread);
            let eb = refract(dir, ne, ior + spread);
            let cr = select(rf.r, envT(er).r, dot(er, er) > 0.0);
            let cg = select(rf.g, envT(eg).g, dot(eg, eg) > 0.0);
            let cb = select(rf.b, envT(eb).b, dot(eb, eb) > 0.0);
            return col + thr * vec3f(cr, cg, cb);
        }
        dir = reflect(dir, ne);
        pos += ne * 0.004;
    }
    return col;
}
@fragment fn fs_ring_torus(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_ring_torus(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_ring_torus(p);
  return finish(glass_ring_torus(p, rd, n, 1.5, mix(0.0, 0.1, k.z), (1.0 - cTone()) * mix(0.2, 2.5, k.y)), uv);
}

// ── soft_cube (glass) ──
fn map_soft_cube(p0: vec3f) -> f32 {
    let t = u.time; let k = u.k;
    let p = spin(p0, t * 0.4 + 0.75, 0.6 + 0.2 * sin(t * 0.3));
    let e = mix(2.4, 12.0, k.x);
    let q = max(abs(p) / 0.74, vec3f(1e-4));
    let s = pow(pow(q.x, e) + pow(q.y, e) + pow(q.z, e), 1.0 / e);
    return (s - 1.0) * 0.74 * 0.7;
}
// sphere trace map_soft_cube inside its bounding sphere; -1 on a miss
fn march_soft_cube(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_soft_cube(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_soft_cube(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_soft_cube
fn nrm_soft_cube(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_soft_cube(p + e.xyy) + e.yyx * map_soft_cube(p + e.yyx) + e.yxy * map_soft_cube(p + e.yxy) + e.xxx * map_soft_cube(p + e.xxx));
}
// path length from an inside point p along rd to the far wall of map_soft_cube
fn thru_soft_cube(p: vec3f, rd: vec3f) -> f32 {
    var t = 0.01;
    for (var i = 0; i < 40; i++) {
        let d = -map_soft_cube(p + rd * t);
        if (d < 0.0008) { break; }
        t += max(d, 0.002);
    }
    return t;
}
// dispersive glass on map_soft_cube: reflect, refract in, up to two internal
// reflections, then refract out at ior - spread, ior, ior + spread (R, G, B)
fn glass_soft_cube(p0: vec3f, rd0: vec3f, n0: vec3f, ior: f32, spread: f32, absorb: vec3f) -> vec3f {
    let fr = schlick(clamp(-dot(rd0, n0), 0.0, 1.0), pow((ior - 1.0) / (ior + 1.0), 2.0));
    var col = envT(reflect(rd0, n0)) * max(fr, 0.07) * 1.3;
    var dir = refract(rd0, n0, 1.0 / ior);
    var pos = p0 - n0 * 0.004;
    var thr = vec3f(1.0 - fr);
    for (var b = 0; b < 3; b++) {
        let d = thru_soft_cube(pos, dir);
        pos += dir * d;
        thr *= exp(-absorb * d);
        let ne = -nrm_soft_cube(pos);
        let eg = refract(dir, ne, ior);
        if (dot(eg, eg) > 0.0 || b == 2) {
            let rf = envT(reflect(dir, ne));
            let er = refract(dir, ne, ior - spread);
            let eb = refract(dir, ne, ior + spread);
            let cr = select(rf.r, envT(er).r, dot(er, er) > 0.0);
            let cg = select(rf.g, envT(eg).g, dot(eg, eg) > 0.0);
            let cb = select(rf.b, envT(eb).b, dot(eb, eb) > 0.0);
            return col + thr * vec3f(cr, cg, cb);
        }
        dir = reflect(dir, ne);
        pos += ne * 0.004;
    }
    return col;
}
@fragment fn fs_soft_cube(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_soft_cube(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_soft_cube(p);
  return finish(glass_soft_cube(p, rd, n, 1.52, mix(0.0, 0.1, k.z), vec3f(0.9, 0.22, 0.12) * mix(0.0, 1.6, k.y)), uv);
}

// ── glass_glyph (glass) ──
fn sdArc(p: vec2f, sc: vec2f, ra: f32, rb: f32) -> f32 {
    let q = vec2f(abs(p.x), p.y);
    if (sc.y * q.x > sc.x * q.y) { return length(q - sc * ra) - rb; }
    return abs(length(q) - ra) - rb;
}
fn map_glass_glyph(p0: vec3f) -> f32 {
    let t = u.time; let k = u.k;
    let p = spin(p0, 0.55 * sin(t * 0.6) + 0.35, 0.12) / 1.45;
    let w = mix(0.06, 0.13, k.x);
    let sc = vec2f(sin(2.25), cos(2.25));
    let c = vec2f(0.0, 0.3);
    let s2 = min(sdArc(rot2(-0.96) * (p.xy - c), sc, 0.3, w), sdArc(rot2(-0.96) * (-p.xy - c), sc, 0.3, w)) + 0.03;
    let wv = vec2f(s2, abs(p.z) - mix(0.08, 0.22, k.z));
    return (min(max(wv.x, wv.y), 0.0) + length(max(wv, vec2f(0.0))) - 0.03) * 1.45;
}
// sphere trace map_glass_glyph inside its bounding sphere; -1 on a miss
fn march_glass_glyph(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.40);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_glass_glyph(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_glass_glyph(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_glass_glyph
fn nrm_glass_glyph(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_glass_glyph(p + e.xyy) + e.yyx * map_glass_glyph(p + e.yyx) + e.yxy * map_glass_glyph(p + e.yxy) + e.xxx * map_glass_glyph(p + e.xxx));
}
// path length from an inside point p along rd to the far wall of map_glass_glyph
fn thru_glass_glyph(p: vec3f, rd: vec3f) -> f32 {
    var t = 0.01;
    for (var i = 0; i < 40; i++) {
        let d = -map_glass_glyph(p + rd * t);
        if (d < 0.0008) { break; }
        t += max(d, 0.002);
    }
    return t;
}
// dispersive glass on map_glass_glyph: reflect, refract in, up to two internal
// reflections, then refract out at ior - spread, ior, ior + spread (R, G, B)
fn glass_glass_glyph(p0: vec3f, rd0: vec3f, n0: vec3f, ior: f32, spread: f32, absorb: vec3f) -> vec3f {
    let fr = schlick(clamp(-dot(rd0, n0), 0.0, 1.0), pow((ior - 1.0) / (ior + 1.0), 2.0));
    var col = envT(reflect(rd0, n0)) * max(fr, 0.07) * 1.3;
    var dir = refract(rd0, n0, 1.0 / ior);
    var pos = p0 - n0 * 0.004;
    var thr = vec3f(1.0 - fr);
    for (var b = 0; b < 3; b++) {
        let d = thru_glass_glyph(pos, dir);
        pos += dir * d;
        thr *= exp(-absorb * d);
        let ne = -nrm_glass_glyph(pos);
        let eg = refract(dir, ne, ior);
        if (dot(eg, eg) > 0.0 || b == 2) {
            let rf = envT(reflect(dir, ne));
            let er = refract(dir, ne, ior - spread);
            let eb = refract(dir, ne, ior + spread);
            let cr = select(rf.r, envT(er).r, dot(er, er) > 0.0);
            let cg = select(rf.g, envT(eg).g, dot(eg, eg) > 0.0);
            let cb = select(rf.b, envT(eb).b, dot(eb, eb) > 0.0);
            return col + thr * vec3f(cr, cg, cb);
        }
        dir = reflect(dir, ne);
        pos += ne * 0.004;
    }
    return col;
}
@fragment fn fs_glass_glyph(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_glass_glyph(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_glass_glyph(p);
  return finish(glass_glass_glyph(p, rd, n, 1.55, 0.05, vec3f(0.08, 0.4, 1.1) * mix(0.3, 3.0, k.y)), uv);
}

// ── morph_solid (chrome) ──
fn morphShape(p: vec3f, i: i32) -> f32 {
    if (i == 0) { return rbox(p, vec3f(0.7), 0.08); }
    if (i == 1) { return length(p) - 0.9; }
    if (i == 2) { return (abs(p.x) + abs(p.y) + abs(p.z) - 1.3) * 0.57735; }
    return length(vec2f(length(p.xz) - 0.68, p.y)) - 0.28;
}
fn map_morph_solid(p0: vec3f) -> f32 {
    let t = u.time; let k = u.k;
    let p = spin(p0, t * 0.5 + 0.6, 0.5 + t * 0.23);
    let s = fract(t * mix(0.05, 0.25, k.x) + 0.6) * 4.0;
    let i = i32(floor(s));
    return mix(morphShape(p, i), morphShape(p, (i + 1) % 4), smoothstep(0.2, 0.8, fract(s)));
}
// sphere trace map_morph_solid inside its bounding sphere; -1 on a miss
fn march_morph_solid(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_morph_solid(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_morph_solid(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_morph_solid
fn nrm_morph_solid(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_morph_solid(p + e.xyy) + e.yyx * map_morph_solid(p + e.yyx) + e.yxy * map_morph_solid(p + e.yxy) + e.xxx * map_morph_solid(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_morph_solid
fn ao_morph_solid(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_morph_solid(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_morph_solid(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_morph_solid(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_morph_solid(p);
  return finish(chrome(rd, n, vec3f(0.93, 0.94, 0.96), ao_morph_solid(p, n)), uv);
}

// ── cube_jack (chrome) ──
fn map_cube_jack(p0: vec3f) -> f32 {
    let t = u.time; let k = u.k;
    let p = spin(p0, t * 0.4 + 0.55, 0.62 + 0.3 * sin(t * 0.25));
    let s = 0.24;
    let g = mix(0.5, 0.66, k.x) + 0.04 * sin(t * 1.5);
    let r = mix(0.015, 0.11, k.y);
    let a = abs(p);
    var d = rbox(p, vec3f(s), r);
    d = min(d, rbox(a - vec3f(g, 0.0, 0.0), vec3f(s), r));
    d = min(d, rbox(a - vec3f(0.0, g, 0.0), vec3f(s), r));
    d = min(d, rbox(a - vec3f(0.0, 0.0, g), vec3f(s), r));
    return d;
}
// sphere trace map_cube_jack inside its bounding sphere; -1 on a miss
fn march_cube_jack(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_cube_jack(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_cube_jack(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_cube_jack
fn nrm_cube_jack(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_cube_jack(p + e.xyy) + e.yyx * map_cube_jack(p + e.yyx) + e.yxy * map_cube_jack(p + e.yxy) + e.xxx * map_cube_jack(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_cube_jack
fn ao_cube_jack(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_cube_jack(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_cube_jack(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_cube_jack(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_cube_jack(p);
  return finish(chrome(rd, n, vec3f(1.0, 0.74, 0.34), ao_cube_jack(p, n)), uv);
}

// ── chamfer_dodeca (chrome) ──
fn map_chamfer_dodeca(p0: vec3f) -> f32 {
    let t = u.time; let k = u.k;
    let p = spin(p0, t * 0.35 + 0.3, 0.4 + t * 0.17);
    let g = 1.618034;
    let a = abs(p);
    let dd = max(dot(a, normalize(vec3f(0.0, 1.0, g))), max(dot(a, normalize(vec3f(1.0, g, 0.0))), dot(a, normalize(vec3f(g, 0.0, 1.0))))) - 0.8;
    let dv = max(max(dot(a, vec3f(0.57735)), dot(a, normalize(vec3f(0.0, 1.0 / g, g)))),
                 max(dot(a, normalize(vec3f(1.0 / g, g, 0.0))), dot(a, normalize(vec3f(g, 0.0, 1.0 / g))))) - 0.8 * mix(1.03, 1.2, k.x);
    return max(dd, dv);
}
// sphere trace map_chamfer_dodeca inside its bounding sphere; -1 on a miss
fn march_chamfer_dodeca(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_chamfer_dodeca(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_chamfer_dodeca(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_chamfer_dodeca
fn nrm_chamfer_dodeca(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_chamfer_dodeca(p + e.xyy) + e.yyx * map_chamfer_dodeca(p + e.yyx) + e.yxy * map_chamfer_dodeca(p + e.yxy) + e.xxx * map_chamfer_dodeca(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_chamfer_dodeca
fn ao_chamfer_dodeca(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_chamfer_dodeca(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_chamfer_dodeca(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_chamfer_dodeca(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_chamfer_dodeca(p);
  let occ = ao_chamfer_dodeca(p, n);
  // hammered copper: a Worley dent field tilts each flat face so it catches
  // more than one part of the studio, and a broad lobe keeps faces off black
  let M = rotX(0.4 + t * 0.17) * rotY(t * 0.35 + 0.3);
  let q = M * p;
  let e = 0.04;
  let w0 = worley2(q * 7.0).x;
  let g = vec3f(worley2(q * 7.0 + vec3f(e, 0.0, 0.0)).x - w0, worley2(q * 7.0 + vec3f(0.0, e, 0.0)).x - w0, worley2(q * 7.0 + vec3f(0.0, 0.0, e)).x - w0) / e;
  let gw = transpose(M) * g;
  let gt = gw - n * dot(gw, n);
  let nh = normalize(n - gt * mix(0.0, 0.11, k.y));
  let r = reflect(rd, nh);
  let tint = vec3f(0.95, 0.42, 0.22);
  let f = schlick(clamp(-dot(rd, nh), 0.0, 1.0), 0.0);
  let spec = env(r) * 1.25 + envDiff(r) * 0.32;
  let c = (spec * mix(tint * tint * 1.3, vec3f(1.0), f) + envDiff(nh) * tint * 0.1) * occ;
  return finish(c, uv);
}

// ── gyroid_core (chrome) ──
fn map_gyroid_core(p0: vec3f) -> f32 {
    let t = u.time; let k = u.k;
    let p = spin(p0, t * 0.3 + 0.2, 0.3);
    let sc = mix(3.0, 6.5, k.x);
    let q = p * sc + vec3f(0.0, t * 0.4, 0.0);
    let gy = dot(sin(q), cos(q.zxy)) / sc;
    let body = max(length(p) - 0.95, (abs(gy) - mix(0.025, 0.08, k.y)) * 0.6);
    return min(body, length(p) - 0.36);
}
// sphere trace map_gyroid_core inside its bounding sphere; -1 on a miss
fn march_gyroid_core(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_gyroid_core(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_gyroid_core(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_gyroid_core
fn nrm_gyroid_core(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_gyroid_core(p + e.xyy) + e.yyx * map_gyroid_core(p + e.yyx) + e.yxy * map_gyroid_core(p + e.yxy) + e.xxx * map_gyroid_core(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_gyroid_core
fn ao_gyroid_core(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_gyroid_core(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_gyroid_core(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_gyroid_core(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_gyroid_core(p);
  let heat = mix(cTone(), vec3f(1.0, 0.55, 0.2), 0.6) * mix(1.0, 6.0, k.z);
  if (length(p) < 0.39) { return finish(heat * (1.2 + 0.8 * cCream()), uv); }
  let occ = ao_gyroid_core(p, n);
  let bleed = heat * 0.3 * exp(-(length(p) - 0.36) * 3.5) * (0.3 + 0.7 * max(dot(n, -normalize(p)), 0.0));
  return finish(chrome(rd, n, vec3f(0.9, 0.91, 0.94), occ) + bleed, uv);
}

// ── bead_chain (blobs) ──
fn map_bead_chain(p0: vec3f) -> f32 {
    let t = u.time; let k = u.k;
    let p = spin(p0, 0.3, 0.12);
    let kk = mix(0.04, 0.34, k.x) * (0.55 + 0.45 * sin(t * 1.3));
    var d = 1e5;
    for (var i = 0; i < 8; i++) {
        let fi = f32(i);
        let a = fi * 0.95 + t * mix(0.3, 1.6, k.y);
        let c = vec3f(cos(a) * 0.55, -0.95 + fi * 0.27, sin(a) * 0.55);
        d = smin(d, length(p - c) - (0.18 + 0.03 * sin(fi * 1.7 + t * 2.0)), kk);
    }
    return d;
}
// sphere trace map_bead_chain inside its bounding sphere; -1 on a miss
fn march_bead_chain(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.30);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_bead_chain(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_bead_chain(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_bead_chain
fn nrm_bead_chain(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_bead_chain(p + e.xyy) + e.yyx * map_bead_chain(p + e.yyx) + e.yxy * map_bead_chain(p + e.yxy) + e.xxx * map_bead_chain(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_bead_chain
fn ao_bead_chain(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_bead_chain(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_bead_chain(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_bead_chain(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_bead_chain(p);
  let alb = mix(hue(0.55 + p.y * 0.28), cTone(), 0.2) * 0.75;
  return finish(plastic(rd, n, alb, ao_bead_chain(p, n)), uv);
}

// ── lava_lamp (blobs) ──
fn map_lava_lamp(p: vec3f) -> f32 {
    let r = 0.5 - 0.1 * p.y;
    let q = vec2f(length(p.xz) - r, abs(p.y) - 1.02);
    return (min(max(q.x, q.y), 0.0) + length(max(q, vec2f(0.0)))) * 0.95 - 0.05;
}
fn map_lava_wax(p: vec3f) -> f32 {
    let t = u.time * mix(0.35, 1.2, u.k.x) + 1.7;
    var d = p.y + 0.86;
    for (var i = 0; i < 5; i++) {
        let fi = f32(i);
        let y = -0.2 - 0.72 * cos(t * (0.34 + 0.07 * fi) + fi * 2.1);
        let c = vec3f(0.14 * sin(fi * 3.1 + t * 0.3), y, 0.12 * cos(fi * 1.7 + t * 0.25));
        d = smin(d, length(p - c) - (0.14 + 0.05 * sin(fi * 2.3)), 0.24);
    }
    return max(d, map_lava_lamp(p) + 0.05);
}
// sphere trace map_lava_lamp inside its bounding sphere; -1 on a miss
fn march_lava_lamp(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.20);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_lava_lamp(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_lava_lamp(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_lava_lamp
fn nrm_lava_lamp(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_lava_lamp(p + e.xyy) + e.yyx * map_lava_lamp(p + e.yyx) + e.yxy * map_lava_lamp(p + e.yxy) + e.xxx * map_lava_lamp(p + e.xxx));
}
// path length from an inside point p along rd to the far wall of map_lava_lamp
fn thru_lava_lamp(p: vec3f, rd: vec3f) -> f32 {
    var t = 0.01;
    for (var i = 0; i < 40; i++) {
        let d = -map_lava_lamp(p + rd * t);
        if (d < 0.0008) { break; }
        t += max(d, 0.002);
    }
    return t;
}
// tetrahedron normal of map_lava_wax
fn nrm_lava_wax(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_lava_wax(p + e.xyy) + e.yyx * map_lava_wax(p + e.yyx) + e.yxy * map_lava_wax(p + e.yxy) + e.xxx * map_lava_wax(p + e.xxx));
}
@fragment fn fs_lava_lamp(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_lava_lamp(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_lava_lamp(p);
  let fr = schlick(clamp(-dot(rd, n), 0.0, 1.0), 0.04);
  let dir = refract(rd, n, 1.0 / 1.4);
  let pin = p - n * 0.004;
  let len = thru_lava_lamp(pin, dir);
  let wax = mix(vec3f(1.0, 0.2, 0.04), cCream(), 0.1);
  let liquid = mix(cInk() * 2.0, cTone(), 0.12);
  var tw = 0.0; var glow = 0.0; var hit = false;
  for (var i = 0; i < 48; i++) {
      let d = map_lava_wax(pin + dir * tw);
      glow += exp(-max(d, 0.0) * 10.0) * 0.012;
      if (d < 0.002) { hit = true; break; }
      tw += max(d, 0.004);
      if (tw > len) { break; }
  }
  var inner = vec3f(0.0);
  if (hit) {
      let pw = pin + dir * tw;
      let nw = nrm_lava_wax(pw);
      let rim = pow(1.0 - clamp(-dot(dir, nw), 0.0, 1.0), 2.0);
      let heat = smoothstep(1.0, -1.0, pw.y);
      inner = wax * (0.06 + 0.9 * heat * heat + 0.6 * rim) * mix(0.5, 1.6, k.y) + envDiff(nw) * wax * 0.35;
  } else {
      let pe = pin + dir * len;
      let ne = -nrm_lava_lamp(pe);
      var ex = refract(dir, ne, 1.4);
      if (dot(ex, ex) == 0.0) { ex = reflect(dir, ne); }
      inner = env(ex) * 0.2 * vec3f(1.0, 0.62, 0.5) + liquid * 0.3;
  }
  inner += wax * glow * mix(0.3, 1.2, k.y) * smoothstep(1.2, -1.0, p.y);
  return finish(env(reflect(rd, n)) * fr + inner * (1.0 - fr), uv);
}

// ── oil_drops (blobs) ──
fn map_oil_drops(p0: vec3f) -> f32 {
    let t = u.time + 2.0; let k = u.k;
    let p = spin(p0, 0.2, 0.2);
    var d = 1e5;
    for (var i = 0; i < 5; i++) {
        let fi = f32(i);
        let w = 0.45 + 0.13 * fi;
        let c = vec3f(cos(t * w + fi * 1.3) * 0.55, sin(t * (0.37 + 0.09 * fi) + fi * 2.2) * 0.45, sin(t * w + fi * 1.3) * 0.35);
        d = smin(d, length(p - c) - (0.36 - 0.04 * fi), mix(0.1, 0.45, k.x));
    }
    return d;
}
// sphere trace map_oil_drops inside its bounding sphere; -1 on a miss
fn march_oil_drops(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.40);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_oil_drops(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_oil_drops(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_oil_drops
fn nrm_oil_drops(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_oil_drops(p + e.xyy) + e.yyx * map_oil_drops(p + e.yyx) + e.yxy * map_oil_drops(p + e.yxy) + e.xxx * map_oil_drops(p + e.xxx));
}
// path length from an inside point p along rd to the far wall of map_oil_drops
fn thru_oil_drops(p: vec3f, rd: vec3f) -> f32 {
    var t = 0.01;
    for (var i = 0; i < 40; i++) {
        let d = -map_oil_drops(p + rd * t);
        if (d < 0.0008) { break; }
        t += max(d, 0.002);
    }
    return t;
}
// dispersive glass on map_oil_drops: reflect, refract in, up to two internal
// reflections, then refract out at ior - spread, ior, ior + spread (R, G, B)
fn glass_oil_drops(p0: vec3f, rd0: vec3f, n0: vec3f, ior: f32, spread: f32, absorb: vec3f) -> vec3f {
    let fr = schlick(clamp(-dot(rd0, n0), 0.0, 1.0), pow((ior - 1.0) / (ior + 1.0), 2.0));
    var col = envT(reflect(rd0, n0)) * max(fr, 0.07) * 1.3;
    var dir = refract(rd0, n0, 1.0 / ior);
    var pos = p0 - n0 * 0.004;
    var thr = vec3f(1.0 - fr);
    for (var b = 0; b < 3; b++) {
        let d = thru_oil_drops(pos, dir);
        pos += dir * d;
        thr *= exp(-absorb * d);
        let ne = -nrm_oil_drops(pos);
        let eg = refract(dir, ne, ior);
        if (dot(eg, eg) > 0.0 || b == 2) {
            let rf = envT(reflect(dir, ne));
            let er = refract(dir, ne, ior - spread);
            let eb = refract(dir, ne, ior + spread);
            let cr = select(rf.r, envT(er).r, dot(er, er) > 0.0);
            let cg = select(rf.g, envT(eg).g, dot(eg, eg) > 0.0);
            let cb = select(rf.b, envT(eb).b, dot(eb, eb) > 0.0);
            return col + thr * vec3f(cr, cg, cb);
        }
        dir = reflect(dir, ne);
        pos += ne * 0.004;
    }
    return col;
}
@fragment fn fs_oil_drops(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_oil_drops(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_oil_drops(p);
  return finish(glass_oil_drops(p, rd, n, 1.47, 0.02, vec3f(0.05, 0.3, 1.0) * mix(0.15, 1.8, k.y)), uv);
}

// ── mercury (blobs) ──
fn map_mercury(p0: vec3f) -> f32 {
    let t = u.time + 0.6; let k = u.k;
    let p = spin(p0, 0.4, 0.0);
    let rr = length(p.xz);
    let ripple = 0.018 * mix(0.0, 2.0, k.y) * sin(rr * 16.0 - t * 5.0) * exp(-rr * 1.2);
    let q = vec2f(rr - 1.05, abs(p.y + 0.84 + ripple) - 0.015);
    let pool = min(max(q.x, q.y), 0.0) + length(max(q, vec2f(0.0))) - 0.06;
    let wob = mix(0.0, 0.14, k.x) * sin(p.x * 5.0 + t * 2.3) * sin(p.z * 4.3 - t * 1.9) * sin(p.y * 4.0 + t * 1.3);
    let body = (length(vec3f(p.x, (p.y + 0.3) * 1.25, p.z)) - 0.52) * 0.8 + wob;
    let d1 = length(p - vec3f(0.55 * cos(t * 0.8), -0.2 + 0.5 * abs(sin(t * 1.6)), 0.45 * sin(t * 0.8))) - 0.14;
    let d2 = length(p - vec3f(-0.5 * cos(t * 0.6), -0.3 + 0.45 * abs(sin(t * 1.9 + 1.0)), -0.4 * sin(t * 0.6))) - 0.11;
    return smin(smin(pool, body, 0.3), min(d1, d2), 0.2);
}
// sphere trace map_mercury inside its bounding sphere; -1 on a miss
fn march_mercury(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.40);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_mercury(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_mercury(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_mercury
fn nrm_mercury(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_mercury(p + e.xyy) + e.yyx * map_mercury(p + e.yyx) + e.yxy * map_mercury(p + e.yxy) + e.xxx * map_mercury(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_mercury
fn ao_mercury(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_mercury(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_mercury(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_mercury(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_mercury(p);
  return finish(chrome(rd, n, vec3f(0.8, 0.82, 0.86), ao_mercury(p, n)), uv);
}

// ── soap_bubble (film) ──
@fragment fn fs_soap_bubble(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let hs = sphHit(ro, rd, 0.95);
  let bg = backdrop(rd);
  if (hs.x < 0.0) { return finish(bg, uv); }
  var c = bg * 0.93;
  for (var s = 0; s < 2; s++) {
      let n = normalize(ro + rd * select(hs.x, hs.y, s == 1));
      let nf = select(n, -n, s == 1);
      let q = rotY(mix(0.5, 4.0, k.y) * n.y + t * 0.35) * n;
      let th = mix(150.0, 950.0, k.x) * (0.6 + 0.7 * fbm3(q * 2.3 + vec3f(0.0, t * 0.12, 0.0), 4))
             + mix(0.0, 900.0, k.z) * smoothstep(0.3, -1.0, n.y);
      let ci = clamp(-dot(rd, nf), 0.0, 1.0);
      let fr = 0.06 + 0.94 * pow(1.0 - ci, 3.0);
      c += (env(reflect(rd, nf)) + 0.05) * film(th, ci, 1.33) * fr * select(1.5, 0.8, s == 1);
  }
  return finish(c, uv);
}

// ── iris_blob (film) ──
fn map_iris_blob(p0: vec3f) -> f32 {
    let t = u.time; let k = u.k;
    let p = spin(p0, t * 0.6 + 0.4, t * 0.37 + 0.3);
    return (length(p) - 0.78 - mix(0.05, 0.3, k.x) * gnoise(p * 1.7 + vec3f(t * 0.2))) * 0.75;
}
// sphere trace map_iris_blob inside its bounding sphere; -1 on a miss
fn march_iris_blob(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.30);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_iris_blob(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_iris_blob(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_iris_blob
fn nrm_iris_blob(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_iris_blob(p + e.xyy) + e.yyx * map_iris_blob(p + e.yyx) + e.yxy * map_iris_blob(p + e.yxy) + e.xxx * map_iris_blob(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_iris_blob
fn ao_iris_blob(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_iris_blob(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_iris_blob(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_iris_blob(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_iris_blob(p);
  let ci = clamp(-dot(rd, n), 0.0, 1.0);
  let fl = film(mix(280.0, 560.0, k.y) + 120.0 * gnoise(p * 2.0), ci, 1.6);
  let fls = fl * 1.3;
  let occ = ao_iris_blob(p, n);
  let c = envDiff(n) * cInk() * 0.6 + (env(reflect(rd, n)) + 0.07) * fls * (0.4 + 0.6 * schlick(ci, 0.1));
  return finish(c * occ, uv);
}

// ── oil_slick (film) ──
@fragment fn fs_oil_slick(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let hs = sphHit(ro, rd, 0.9);
  if (hs.x < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * hs.x;
  let n = normalize(p);
  let q = spin(n, t * 0.2 + 0.4, 0.3);
  let flow = fbm3(q * 1.1 + vec3f(0.0, t * 0.08, 0.0), 3);
  let th = 180.0 + mix(300.0, 1400.0, k.x) * (0.5 + 0.5 * sin(flow * mix(3.0, 10.0, k.y) + t * 0.5));
  let ci = clamp(-dot(rd, n), 0.0, 1.0);
  let fl = film(th, ci, 1.47);
  let r = env(reflect(rd, n));
  let c = r * schlick(ci, 0.04) * 0.5 + (r * 0.6 + 0.1) * fl * fl * 1.6 * (0.3 + 0.7 * schlick(ci, 0.05));
  return finish(c, uv);
}

// ── nacre (film) ──
fn map_nacre(p0: vec3f) -> f32 {
    let t = u.time; let k = u.k;
    let p = spin(p0, t * 0.3 + 0.3, 0.2);
    return (length(p * vec3f(1.0, 1.1, 1.0)) - 0.8 - 0.035 * gnoise(p * 2.4)) * 0.9;
}
// sphere trace map_nacre inside its bounding sphere; -1 on a miss
fn march_nacre(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_nacre(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_nacre(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_nacre
fn nrm_nacre(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_nacre(p + e.xyy) + e.yyx * map_nacre(p + e.yyx) + e.yxy * map_nacre(p + e.yxy) + e.xxx * map_nacre(p + e.xxx));
}
@fragment fn fs_nacre(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_nacre(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_nacre(p);
  let q = spin(p, t * 0.3 + 0.3, 0.2);
  let ci = clamp(-dot(rd, n), 0.0, 1.0);
  let th = mix(260.0, 560.0, k.x) + 90.0 * fbm3(q * 9.0, 3);
  let orient = mix(vec3f(1.0), film(th, ci, 1.53) * 1.8, 0.45);
  let body = mix(vec3f(0.9, 0.88, 0.85), cCream(), 0.35);
  let wrap = 0.25 * pow(1.0 - ci, 2.0);
  let c = envDiff(n) * body * orient * 0.85 + body * wrap * cCream()
        + env(reflect(rd, n)) * schlick(ci, 0.05) * mix(0.4, 1.4, k.y) * orient;
  return finish(c, uv);
}

// ── ink_block (interior) ──
fn inkLocal(p: vec3f) -> vec3f { return spin(p, u.time * 0.3 + 0.55, 0.28); }
fn map_ink_block(p: vec3f) -> f32 { return rbox(inkLocal(p), vec3f(0.62, 0.85, 0.36), 0.1); }
fn inkField(q: vec3f, t: f32, wk: f32) -> vec2f {
    var w = q * 1.5;
    w += wk * vec3f(gnoise(w + vec3f(0.0, t * 0.25, 0.0)), gnoise(w + vec3f(5.2, 1.3, t * 0.2)), gnoise(w + vec3f(2.1, 7.7, -t * 0.2)));
    let n = fbm3(w, 3);
    return vec2f(smoothstep(-0.02, 0.35, n), 0.5 + 0.9 * gnoise(w * 0.6 + 3.0));
}
// sphere trace map_ink_block inside its bounding sphere; -1 on a miss
fn march_ink_block(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.25);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_ink_block(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_ink_block(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_ink_block
fn nrm_ink_block(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_ink_block(p + e.xyy) + e.yyx * map_ink_block(p + e.yyx) + e.yxy * map_ink_block(p + e.yxy) + e.xxx * map_ink_block(p + e.xxx));
}
// path length from an inside point p along rd to the far wall of map_ink_block
fn thru_ink_block(p: vec3f, rd: vec3f) -> f32 {
    var t = 0.01;
    for (var i = 0; i < 40; i++) {
        let d = -map_ink_block(p + rd * t);
        if (d < 0.0008) { break; }
        t += max(d, 0.002);
    }
    return t;
}
@fragment fn fs_ink_block(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_ink_block(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_ink_block(p);
  let fr = schlick(clamp(-dot(rd, n), 0.0, 1.0), 0.04);
  let dir = refract(rd, n, 1.0 / 1.5);
  let pin = p - n * 0.004;
  let len = thru_ink_block(pin, dir);
  let dt = len / 24.0;
  let sig = mix(3.0, 16.0, k.y);
  var T = 1.0; var acc = vec3f(0.0);
  for (var i = 0; i < 24; i++) {
      let q = inkLocal(pin + dir * (dt * (f32(i) + 0.5)));
      let f = inkField(q, t, mix(0.4, 2.2, k.x));
      let dye = mix(cTone() * 1.2, vec3f(1.0, 0.18, 0.4), clamp(f.y, 0.0, 1.0));
      let lit = 0.35 + 0.9 * smoothstep(-0.9, 0.9, q.y);
      let a = 1.0 - exp(-f.x * sig * dt);
      acc += T * a * dye * lit;
      T *= 1.0 - a;
  }
  let pe = pin + dir * len;
  let ne = -nrm_ink_block(pe);
  var ex = refract(dir, ne, 1.5);
  if (dot(ex, ex) == 0.0) { ex = reflect(dir, ne); }
  acc += T * env(ex);
  return finish(env(reflect(rd, n)) * fr + acc * (1.0 - fr), uv);
}

// ── cat_eye (interior) ──
fn vaneSD(p0: vec3f, t: f32, tw: f32, nv: f32) -> vec2f {
    let p = spin(p0, t * 0.4 + 0.3, 0.35);
    let a = atan2(p.z, p.x) - p.y * tw;
    let sec = TAU / nv;
    let id = floor(a / sec + 0.5);
    let r = length(p.xz);
    let blade = abs(r * sin(a - id * sec)) - 0.03 * (1.0 - r * 1.6);
    let cap = length(p * vec3f(1.0, 0.7, 1.0)) - 0.46;
    return vec2f(max(blade, cap) * 0.45, id);
}
@fragment fn fs_cat_eye(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let hs = sphHit(ro, rd, 0.92);
  if (hs.x < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * hs.x;
  let n = normalize(p);
  let fr = schlick(clamp(-dot(rd, n), 0.0, 1.0), 0.04);
  let dir = refract(rd, n, 1.0 / 1.5);
  let len = sphHit(p - n * 0.002, dir, 0.92).y;
  let tw = mix(0.5, 4.0, k.x);
  let nv = 2.0 + floor(k.y * 3.99);
  var tr = 0.0; var hit = false; var id = 0.0;
  for (var i = 0; i < 48; i++) {
      let v = vaneSD(p + dir * tr, t, tw, nv);
      if (v.x < 0.0015) { hit = true; id = v.y; break; }
      tr += max(v.x, 0.003);
      if (tr > len) { break; }
  }
  var inner = vec3f(0.0);
  if (hit) {
      let pv = p + dir * tr;
      let e = vec2f(0.002, 0.0);
      let nn = normalize(vec3f(vaneSD(pv + e.xyy, t, tw, nv).x - vaneSD(pv - e.xyy, t, tw, nv).x,
                               vaneSD(pv + e.yxy, t, tw, nv).x - vaneSD(pv - e.yxy, t, tw, nv).x,
                               vaneSD(pv + e.yyx, t, tw, nv).x - vaneSD(pv - e.yyx, t, tw, nv).x));
      let alb = mix(hue(id / nv + 0.05), cTone(), 0.15);
      inner = alb * (envDiff(nn) * 1.1 + 0.15) + env(reflect(dir, nn)) * 0.08;
  } else {
      let pe = p + dir * len;
      var ex = refract(dir, -normalize(pe), 1.5);
      if (dot(ex, ex) == 0.0) { ex = reflect(dir, -normalize(pe)); }
      inner = env(ex) * vec3f(0.85, 0.95, 1.0);
  }
  return finish(env(reflect(rd, n)) * fr + inner * (1.0 - fr), uv);
}

// ── nebula_orb (interior) ──
@fragment fn fs_nebula_orb(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let hs = sphHit(ro, rd, 0.95);
  if (hs.x < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * hs.x;
  let n = normalize(p);
  let fr = schlick(clamp(-dot(rd, n), 0.0, 1.0), 0.04);
  let dir = refract(rd, n, 1.0 / 1.45);
  let len = sphHit(p - n * 0.002, dir, 0.95).y;
  let dt = len / 24.0;
  var T = 1.0; var acc = vec3f(0.0);
  for (var i = 0; i < 24; i++) {
      let q = spin(p + dir * (dt * (f32(i) + 0.5)), t * 0.15 + 0.7, 0.3);
      let w = q * 1.7 + mix(0.3, 1.6, k.y) * vec3f(gnoise(q * 1.3 + vec3f(t * 0.1, 0.0, 0.0)), gnoise(q * 1.3 + 4.1), gnoise(q * 1.3 - 2.7));
      let f = fbm3(w, 4);
      let dens = max(f + 0.08, 0.0) * mix(1.5, 6.0, k.x) * smoothstep(0.95, 0.35, length(q));
      let em = mix(cTone() * 1.4, vec3f(1.0, 0.25, 0.55), smoothstep(-0.2, 0.3, gnoise(w * 0.7 + 9.0))) + cCream() * smoothstep(0.2, 0.5, f) * 1.5;
      acc += T * em * dens * dt;
      T *= exp(-dens * dt * 0.9);
  }
  let g = dir * 70.0;
  let hc = hash3(g);
  let star = step(0.975, hc.x) * smoothstep(0.45, 0.1, length(fract(g) - 0.5 - (hc.yzx - 0.5) * 0.3)) * (0.5 + 2.0 * hc.y);
  acc += T * (cCream() * star * 1.5 + cInk() * 0.4);
  return finish(env(reflect(rd, n)) * fr + acc * (1.0 - fr), uv);
}

// ── rainbow_knot (emissive) ──
fn knotD(p: vec3f, P: f32, Q: f32) -> vec2f {
    let a = atan2(p.z, p.x);
    let lp = vec2f(length(p.xz) - 0.6, p.y);
    var best = vec2f(1e5, 0.0);
    for (var i = 0; i < 2; i++) {
        let s = (a + TAU * f32(i)) / P;
        let d = length(lp - 0.3 * vec2f(cos(Q * s), sin(Q * s)));
        if (d < best.x) { best = vec2f(d, s / TAU); }
    }
    return best;
}
@fragment fn fs_rainbow_knot(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  var c = backdrop(rd) * 0.3;
  let hs = sphHit(ro, rd, 1.0);
  if (hs.y > 0.0) {
      let Q = 3.0 + 2.0 * floor(k.x * 2.99);
      let w = mix(0.015, 0.06, k.y);
      var tr = max(hs.x, 0.0);
      for (var i = 0; i < 64; i++) {
          let pos = ro + rd * tr;
          let kd = knotD(spin(pos, t * 0.5 + 0.3, 0.95), 2.0, Q);
          let st = clamp(kd.x * 0.5, 0.006, 0.05);
          let col = hue(fract(kd.y - t * mix(0.05, 0.4, k.z)));
          c += col * (exp(-kd.x * kd.x / (w * w)) * 30.0 + exp(-kd.x * 14.0) * 0.8) * st;
          tr += st;
          if (tr > hs.y) { break; }
      }
  }
  return finish(c, uv);
}

// ── granule_star (emissive) ──
@fragment fn fs_granule_star(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let R = 0.6;
  var c = backdrop(rd) * 0.2;
  let hs = sphHit(ro, rd, R);
  let ho = sphHit(ro, rd, 1.35);
  if (ho.y > 0.0) {
      let t0 = max(ho.x, 0.0);
      let t1 = select(ho.y, hs.x, hs.x > 0.0);
      let dt = (t1 - t0) / 24.0;
      for (var i = 0; i < 24; i++) {
          let pos = ro + rd * (t0 + dt * (f32(i) + 0.5));
          let r = length(pos);
          let q = spin(pos / r, t * 0.08, 0.25);
          let streak = fbm3(q * 3.2 + vec3f(0.0, 0.0, t * 0.15), 3);
          let dens = exp(-(r - R) * mix(12.0, 4.0, k.y)) * (0.3 + 1.6 * max(streak + 0.15, 0.0));
          c += mix(vec3f(1.0, 0.45, 0.12), cCream(), 0.3) * dens * dt * 2.2;
      }
  }
  if (hs.x > 0.0) {
      let p = ro + rd * hs.x;
      let n = normalize(p);
      let q = spin(n, t * 0.08, 0.25);
      let w = worley2(q * mix(5.0, 16.0, k.x) + vec3f(t * 0.1));
      let gran = smoothstep(0.0, 0.5, w.y - w.x);
      let spot = smoothstep(0.25, 0.45, fbm3(q * 2.0 + 11.0, 3)) * k.z;
      let mu = clamp(-dot(rd, n), 0.0, 1.0);
      let limb = 0.3 + 0.7 * pow(mu, 0.55);
      let hot = mix(vec3f(1.0, 0.36, 0.06), mix(vec3f(1.0, 0.82, 0.5), cCream(), 0.4), gran * limb);
      c = hot * (1.2 + 2.6 * gran) * limb * (1.0 - 0.8 * spot);
  }
  return finish(c, uv);
}

// ── plasma_ring (emissive) ──
@fragment fn fs_plasma_ring(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let R = 0.85;
  var c = backdrop(rd) * 0.22;
  let tc = -dot(ro, rd);
  let cp = ro + rd * tc;
  let b = length(cp);
  let ang = atan2(dot(cp, camUp()), dot(cp, camRt()));
  let fl = fbm3(vec3f(cos(ang) * 2.2, sin(ang) * 2.2, t * 0.9), 4);
  let wd = mix(0.012, 0.05, k.x) * (0.6 + 1.2 * max(fl + 0.3, 0.0));
  let ring = exp(-abs(b - R) / wd);
  let haze = exp(-abs(b - R) * 5.0) * 0.25;
  c += (mix(cTone(), cCream(), ring * 0.8) * ring * 3.0 + cTone() * haze) * (0.6 + 0.9 * max(fl + 0.3, 0.0));
  let hs = sphHit(ro, rd, R);
  if (hs.x > 0.0) {
      for (var s = 0; s < 2; s++) {
          let n = normalize(ro + rd * select(hs.x, hs.y, s == 1));
          let q = spin(n, t * 0.3 + 0.2, 0.45);
          let lat = acos(clamp(q.y, -1.0, 1.0)) / PI * 10.0;
          let lon = (atan2(q.z, q.x) / TAU + 0.5) * 20.0;
          let dl = min(abs(fract(lat + 0.5) - 0.5), abs(fract(lon + 0.5) - 0.5) * (0.3 + 0.7 * sqrt(max(1.0 - q.y * q.y, 0.0))));
          let line = smoothstep(0.09, 0.0, dl);
          let sil = pow(1.0 - abs(dot(n, rd)), mix(1.5, 5.0, k.y));
          c += mix(cTone(), cCream(), 0.3) * line * sil * select(2.4, 1.1, s == 1);
      }
  }
  return finish(c, uv);
}

// ── neon_shell (emissive) ──
fn map_neon_shell(p0: vec3f) -> f32 {
    let t = u.time; let k = u.k;
    let p = spin(p0, t * 0.4, 0.3 + t * 0.2);
    return length(p) - 0.78 - mix(0.05, 0.28, k.x) * gnoise(p * 2.0 + vec3f(0.0, t * 0.5, 0.0));
}
@fragment fn fs_neon_shell(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  var c = backdrop(rd) * 0.25;
  let hs = sphHit(ro, rd, 1.15);
  if (hs.y > 0.0) {
      let sh = mix(12.0, 50.0, k.y);
      var tr = max(hs.x, 0.0);
      for (var i = 0; i < 64; i++) {
          let pos = ro + rd * tr;
          let d = map_neon_shell(pos);
          let st = clamp(abs(d) * 0.6, 0.008, 0.06);
          let col = mix(hue(0.62 + 0.22 * pos.y + 0.08 * sin(t * 0.7)), cTone(), 0.25);
          c += col * exp(-abs(d) * sh) * st * 5.0;
          tr += st;
          if (tr > hs.y) { break; }
      }
  }
  return finish(c, uv);
}

// ── box_frame (primitives) ──
fn sdBoxFrame(p0: vec3f, b: vec3f, e: f32) -> f32 {
    let p = abs(p0) - b;
    let q = abs(p + e) - e;
    return min(min(
        length(max(vec3f(p.x, q.y, q.z), vec3f(0.0))) + min(max(p.x, max(q.y, q.z)), 0.0),
        length(max(vec3f(q.x, p.y, q.z), vec3f(0.0))) + min(max(q.x, max(p.y, q.z)), 0.0)),
        length(max(vec3f(q.x, q.y, p.z), vec3f(0.0))) + min(max(q.x, max(q.y, p.z)), 0.0));
}
fn bfParts(p0: vec3f) -> vec2f {
    let t = u.time; let k = u.k;
    let p = spin(p0, t * 0.35 + 0.6, 0.5 + 0.15 * sin(t * 0.4));
    let fr = sdBoxFrame(p, vec3f(0.68), mix(0.035, 0.1, k.x)) - 0.015;
    let c = rbox(spin(p0, -t * 0.9 + 0.3, t * 0.6 + 0.4), vec3f(0.25), 0.05);
    return vec2f(fr, c);
}
fn map_box_frame(p: vec3f) -> f32 { let d = bfParts(p); return min(d.x, d.y); }
// sphere trace map_box_frame inside its bounding sphere; -1 on a miss
fn march_box_frame(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_box_frame(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_box_frame(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_box_frame
fn nrm_box_frame(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_box_frame(p + e.xyy) + e.yyx * map_box_frame(p + e.yyx) + e.yxy * map_box_frame(p + e.yxy) + e.xxx * map_box_frame(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_box_frame
fn ao_box_frame(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_box_frame(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_box_frame(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let glowC = mix(cTone(), vec3f(1.0, 0.5, 0.2), 0.6) * mix(1.0, 5.0, k.y);
  let bq = length(cross(ro, rd));
  let halo = glowC * 0.09 * exp(-bq * bq * 9.0);
  let h = march_box_frame(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd) + halo, uv); }
  let p = ro + rd * h;
  let n = nrm_box_frame(p);
  let occ = ao_box_frame(p, n);
  let parts = bfParts(p);
  if (parts.y < parts.x) {
      let ci = clamp(-dot(rd, n), 0.0, 1.0);
      return finish(glowC * (1.2 + 1.0 * ci) + env(reflect(rd, n)) * 0.1, uv);
  }
  let lc = -normalize(p);
  let fall = 1.0 / (1.0 + 4.0 * dot(p, p));
  let c = metal(rd, n, vec3f(1.0, 0.76, 0.42), 0.16, occ) + glowC * (max(dot(n, lc), 0.0) * 0.9 + 0.1) * fall * occ;
  return finish(c + halo * 0.5, uv);
}

// ── hex_nut (primitives) ──
fn sdHexPrism(p0: vec3f, h: vec2f) -> f32 {
    let kk = vec3f(-0.8660254, 0.5, 0.57735);
    var p = abs(p0);
    let dd = 2.0 * min(dot(kk.xy, p.xy), 0.0) * kk.xy;
    p = vec3f(p.x - dd.x, p.y - dd.y, p.z);
    let d = vec2f(length(p.xy - vec2f(clamp(p.x, -kk.z * h.x, kk.z * h.x), h.x)) * sign(p.y - h.x), p.z - h.y);
    return min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0)));
}
// the thread: a triangle wave that winds once per pitch (0.13) along y
fn nutThread(p: vec3f) -> f32 { return abs(fract(atan2(p.z, p.x) / TAU + p.y / 0.13) - 0.5) * 4.0 - 1.0; }
fn nutLocal(p0: vec3f) -> vec3f { return spin(p0, u.time * 0.2 + 0.5, 0.5); }
fn nutY() -> f32 { return mix(0.2, 0.55, u.k.x) * sin(u.time * 0.6 + 0.4); }
fn nutParts(p0: vec3f) -> vec2f {
    let p = nutLocal(p0);
    let thr = nutThread(p);
    let rod = smax(length(p.xz) - 0.25 - 0.024 * thr, abs(p.y) - 1.2, 0.06) * 0.7;
    let y0 = nutY();
    let q = rotY(y0 / 0.13 * TAU) * (p - vec3f(0.0, y0, 0.0));
    var nut = sdHexPrism(vec3f(q.x, q.z, q.y), vec2f(0.5, 0.2));
    nut = max(nut, (length(q.xz) + abs(q.y) - 0.76) * 0.7071);
    nut = max(nut, -(length(p.xz) - 0.262 - 0.024 * thr) * 0.7);
    return vec2f(rod, nut);
}
fn map_hex_nut(p: vec3f) -> f32 { let d = nutParts(p); return min(d.x, d.y); }
// sphere trace map_hex_nut inside its bounding sphere; -1 on a miss
fn march_hex_nut(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.45);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_hex_nut(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_hex_nut(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_hex_nut
fn nrm_hex_nut(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_hex_nut(p + e.xyy) + e.yyx * map_hex_nut(p + e.yyx) + e.yxy * map_hex_nut(p + e.yxy) + e.xxx * map_hex_nut(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_hex_nut
fn ao_hex_nut(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_hex_nut(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_hex_nut(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_hex_nut(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_hex_nut(p);
  let occ = ao_hex_nut(p, n);
  let parts = nutParts(p);
  let ci = clamp(-dot(rd, n), 0.0, 1.0);
  if (parts.y < parts.x) {
      let q = nutLocal(p);
      let th = 420.0 + 140.0 * fbm3(q * 1.3 + 4.0, 3) * mix(0.3, 1.6, k.y);
      let zinc = mix(vec3f(0.95, 0.84, 0.48), film(th, ci, 1.45) * 1.4, 0.38);
      return finish(metal(rd, n, zinc, 0.12, occ), uv);
  }
  return finish(metal(rd, n, vec3f(0.5, 0.52, 0.56), 0.28, occ), uv);
}

// ── chain_link (primitives) ──
fn sdLink(p: vec3f, le: f32, r1: f32, r2: f32) -> f32 {
    let q = vec3f(p.x, max(abs(p.y) - le, 0.0), p.z);
    return length(vec2f(length(q.xy) - r1, q.z)) - r2;
}
fn chainParts(p0: vec3f) -> vec2f {
    let t = u.time; let k = u.k;
    var p = rotY(t * 0.3 + 0.5) * p0;
    let xy = rot2(0.75 + mix(0.05, 0.3, k.y) * sin(t * 1.1)) * p.xy;
    p = vec3f(xy.x, xy.y, p.z);
    let le = 0.22; let r1 = 0.19; let r2 = mix(0.045, 0.08, k.x);
    let D = 2.0 * le + r1;
    var ev = 1e5; var od = 1e5;
    for (var i = 0; i < 4; i++) {
        let fi = f32(i);
        let c = p - vec3f(0.0, (fi - 1.5) * D, 0.0);
        let w = rotY(0.25 * sin(t * 1.3 + fi * 1.7)) * c;
        if (i % 2 == 0) { ev = min(ev, sdLink(w, le, r1, r2)); }
        else { od = min(od, sdLink(vec3f(w.z, w.y, w.x), le, r1, r2)); }
    }
    return vec2f(ev, od);
}
fn map_chain_link(p: vec3f) -> f32 { let d = chainParts(p); return min(d.x, d.y); }
// sphere trace map_chain_link inside its bounding sphere; -1 on a miss
fn march_chain_link(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_chain_link(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_chain_link(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_chain_link
fn nrm_chain_link(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_chain_link(p + e.xyy) + e.yyx * map_chain_link(p + e.yyx) + e.yxy * map_chain_link(p + e.yxy) + e.xxx * map_chain_link(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_chain_link
fn ao_chain_link(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_chain_link(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_chain_link(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_chain_link(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_chain_link(p);
  let occ = ao_chain_link(p, n);
  let parts = chainParts(p);
  if (parts.x < parts.y) { return finish(metal(rd, n, vec3f(1.0, 0.72, 0.36), 0.1, occ), uv); }
  return finish(metal(rd, n, vec3f(0.3, 0.32, 0.36), 0.08, occ) + envDiff(n) * 0.02, uv);
}

// ── octa_lacquer (primitives) ──
fn sdOcta(p0: vec3f, s: f32) -> f32 {
    let p = abs(p0);
    let m = p.x + p.y + p.z - s;
    var q: vec3f;
    if (3.0 * p.x < m) { q = p.xyz; }
    else if (3.0 * p.y < m) { q = p.yzx; }
    else if (3.0 * p.z < m) { q = p.zxy; }
    else { return m * 0.57735027; }
    let kk = clamp(0.5 * (q.z - q.y + s), 0.0, s);
    return length(vec3f(q.x, q.y - s + kk, q.z - kk));
}
fn octaLocal(p0: vec3f) -> vec3f { return spin(p0, u.time * 0.35 + 0.45, 0.42 + 0.2 * sin(u.time * 0.3)); }
fn map_octa_lacquer(p0: vec3f) -> f32 {
    let r = mix(0.0, 0.12, u.k.y);
    return sdOcta(octaLocal(p0), 1.12 - r * 1.7) - r;
}
// sphere trace map_octa_lacquer inside its bounding sphere; -1 on a miss
fn march_octa_lacquer(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_octa_lacquer(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_octa_lacquer(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_octa_lacquer
fn nrm_octa_lacquer(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_octa_lacquer(p + e.xyy) + e.yyx * map_octa_lacquer(p + e.yyx) + e.yxy * map_octa_lacquer(p + e.yxy) + e.xxx * map_octa_lacquer(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_octa_lacquer
fn ao_octa_lacquer(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_octa_lacquer(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_octa_lacquer(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_octa_lacquer(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_octa_lacquer(p);
  let occ = ao_octa_lacquer(p, n);
  let q = abs(octaLocal(p));
  let mc = min(q.x, min(q.y, q.z));
  let w = mix(0.012, 0.045, k.x);
  let edge = smoothstep(w, w * 0.5, mc);
  let rings = smoothstep(0.012, 0.004, abs(fract(mc * 6.0 + 0.5) - 0.5) / 6.0) * step(0.08, mc);
  let gold = max(edge, rings * 0.85);
  let ci = clamp(-dot(rd, n), 0.0, 1.0);
  let red = vec3f(0.62, 0.05, 0.025);
  let coat = env(reflect(rd, n)) * schlick(ci, 0.05);
  let lac = envDiff(n) * red * 0.9 + coat * 1.2;
  let inl = metal(rd, n, vec3f(1.0, 0.75, 0.38), 0.18, 1.0);
  return finish(mix(lac, inl, gold) * occ, uv);
}

// ── cone_lamp (primitives) ──
fn sdRoundCyl(p: vec3f, ra: f32, rb: f32, h: f32) -> f32 {
    let d = vec2f(length(p.xz) - ra + rb, abs(p.y) - h + rb);
    return min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0))) - rb;
}
fn lampParts(p0: vec3f) -> vec4f {
    let p = rotY(u.time * 0.3 + 0.4) * p0;
    let q = vec2f(length(p.xz), p.y - 0.42);
    let cone = sdTrap(q, 0.62, 0.3, 0.33);
    let shade = max(abs(cone) - 0.012, abs(q.y) - 0.315);
    let bulb = length(p - vec3f(0.0, 0.3, 0.0)) - 0.13;
    let stem = min(sdCyl(p - vec3f(0.0, -0.38, 0.0), 0.5, 0.035), sdCyl(p - vec3f(0.0, 0.14, 0.0), 0.04, 0.06));
    let base = sdRoundCyl(p - vec3f(0.0, -0.9, 0.0), 0.42, 0.06, 0.09);
    return vec4f(shade, bulb, stem, base);
}
fn map_cone_lamp(p: vec3f) -> f32 { let d = lampParts(p); return min(min(d.x, d.y), min(d.z, d.w)); }
// sphere trace map_cone_lamp inside its bounding sphere; -1 on a miss
fn march_cone_lamp(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.20);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_cone_lamp(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_cone_lamp(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_cone_lamp
fn nrm_cone_lamp(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_cone_lamp(p + e.xyy) + e.yyx * map_cone_lamp(p + e.yyx) + e.yxy * map_cone_lamp(p + e.yxy) + e.xxx * map_cone_lamp(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_cone_lamp
fn ao_cone_lamp(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_cone_lamp(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
// soft shadow of map_cone_lamp toward the light l (after Quilez)
fn shd_cone_lamp(p: vec3f, l: vec3f) -> f32 {
    var res = 1.0; var t = 0.02;
    for (var i = 0; i < 32; i++) {
        let d = map_cone_lamp(p + l * t);
        res = min(res, 6.0 * d / t);
        t += clamp(d, 0.02, 0.3);
        if (res < 0.005 || t > 4.0) { break; }
    }
    return clamp(res, 0.0, 1.0);
}
@fragment fn fs_cone_lamp(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let warm = mix(vec3f(1.0, 0.6, 0.28), cCream(), 0.25) * mix(0.4, 2.2, k.x);
  let bp = vec3f(0.0, 0.3, 0.0);
  let h = march_cone_lamp(ro, rd);
  if (h < 0.0) {
      if (rd.y < 0.0) {
          let pf = ro + rd * ((-0.99 - ro.y) / rd.y);
          let fsh = shd_cone_lamp(pf, normalize(KEY));
          let fo = ao_cone_lamp(pf, vec3f(0.0, 1.0, 0.0));
          return finish(stageFloor(rd, pf, fsh, fo) + warm * 0.35 * exp(-dot(pf.xz, pf.xz) * 1.6) * fo, uv);
      }
      return finish(backdrop(rd), uv);
  }
  let p = ro + rd * h;
  let n = nrm_cone_lamp(p);
  let occ = ao_cone_lamp(p, n);
  let sh = shd_cone_lamp(p + n * 0.012, normalize(KEY));
  let parts = lampParts(p);
  let m = min(min(parts.x, parts.y), min(parts.z, parts.w));
  let lv = bp - p; let ld = length(lv); let l = lv / ld;
  let fall = 1.0 / (1.0 + 5.0 * ld * ld);
  if (parts.y == m) { return finish(warm * 5.0, uv); }
  if (parts.x == m) {
      let q = rotY(t * 0.3 + 0.4) * p;
      let weave = 0.9 + 0.1 * sin(atan2(q.z, q.x) * 160.0) * sin(q.y * 220.0);
      let linen = mix(vec3f(0.95, 0.9, 0.8), cTone(), mix(0.0, 0.5, k.y));
      let inside = max(dot(n, l), 0.0);
      let through = warm * linen * (0.55 + 0.6 * smoothstep(0.2, -0.1, q.y - 0.42)) * fall * 5.0;
      let c = select(through * weave + envDiffS(n, sh) * linen * 0.25 * occ, warm * linen * 2.4 * fall * 4.0, inside > 0.0);
      return finish(c, uv);
  }
  let lit = warm * max(dot(n, l), 0.0) * fall * 2.0;
  if (parts.z == m) { return finish(metal(rd, n, vec3f(1.0, 0.75, 0.42), 0.2, occ) + lit, uv); }
  return finish(dielectric(rd, n, vec3f(0.025), 0.05, occ, sh) + lit * 0.15, uv);
}

// ── dish_moon (primitives) ──
fn sdDeathStar(p2: vec3f, ra: f32, rb: f32, d: f32) -> f32 {
    let a = (ra * ra - rb * rb + d * d) / (2.0 * d);
    let b = sqrt(max(ra * ra - a * a, 0.0));
    let p = vec2f(p2.x, length(p2.yz));
    if (p.x * b - p.y * a > d * max(b - p.y, 0.0)) { return length(p - vec2f(a, b)); }
    return max(length(p) - ra, -(length(p - vec2f(d, 0.0)) - rb));
}
fn dmLocal(p0: vec3f) -> vec3f { return spin(p0, u.time * 0.2 - 1.0, 0.3); }
// the bite axis in the moon frame: the world direction up-left toward the camera
fn dmAxis() -> vec3f { return rotX(0.3) * (rotY(-1.0) * normalize(vec3f(-0.45, 0.4, 0.8))); }
fn map_dish_moon(p0: vec3f) -> f32 {
    let p = dmLocal(p0);
    let A = dmAxis();
    let ax = dot(p, A);
    let ds = sdDeathStar(vec3f(ax, length(p - A * ax), 0.0), 0.92, mix(0.25, 0.5, u.k.x), 0.98);
    return max(ds, -sdTorus(p, 0.92, 0.028));
}
// sphere trace map_dish_moon inside its bounding sphere; -1 on a miss
fn march_dish_moon(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_dish_moon(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_dish_moon(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_dish_moon
fn nrm_dish_moon(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_dish_moon(p + e.xyy) + e.yyx * map_dish_moon(p + e.yyx) + e.yxy * map_dish_moon(p + e.yxy) + e.xxx * map_dish_moon(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_dish_moon
fn ao_dish_moon(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_dish_moon(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_dish_moon(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_dish_moon(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_dish_moon(p);
  let occ = ao_dish_moon(p, n);
  let q = dmLocal(p);
  let A = dmAxis();
  let inDish = length(q - A * 0.98) < mix(0.25, 0.5, k.x) + 0.01;
  let nq = normalize(q);
  let lat = asin(clamp(nq.y, -1.0, 1.0)); let lon = atan2(nq.z, nq.x);
  let g = vec2f(lon * 9.0 / PI, lat * 9.0 / PI);
  let cell = floor(g);
  let fg = abs(fract(g) - 0.5);
  let seam = smoothstep(0.47, 0.5, max(fg.x, fg.y));
  let hc = hash3(vec3f(cell, 3.0));
  let alb = vec3f(0.42, 0.44, 0.47) * (0.75 + 0.35 * hc.x) * (1.0 - 0.55 * seam);
  let lit = clamp(dot(n, normalize(KEY)) * 2.0 + 0.3, 0.0, 1.0);
  let g2 = fract(g * 4.0) - 0.5;
  let hl = hash3(vec3f(floor(g * 4.0), 9.0));
  let lamp = step(0.86, hl.x) * smoothstep(0.2, 0.05, length(g2)) * (1.0 - lit) * mix(0.0, 3.0, k.y);
  var c = dielectric(rd, n, alb, 0.45, occ, 1.0) + mix(cCream(), vec3f(1.0, 0.7, 0.35), 0.5) * lamp;
  if (inDish) {
      let rr = length(q - A * dot(q, A));
      c = c * 0.6 + cTone() * 0.25 * smoothstep(0.012, 0.0, abs(fract(rr * 14.0) - 0.5) / 14.0) * occ;
      c += mix(cTone(), vec3f(0.4, 1.0, 0.6), 0.5) * 2.5 * exp(-rr * rr * 160.0);
  }
  return finish(c, uv);
}

// ── sector_scoop (primitives) ──
fn sdSolidAngle(p: vec3f, c: vec2f, ra: f32) -> f32 {
    let q = vec2f(length(p.xz), p.y);
    let l = length(q) - ra;
    let m = length(q - c * clamp(dot(q, c), 0.0, ra));
    return max(l, m * sign(c.y * q.x - c.x * q.y));
}
// the cone axis points up, left and away, and sways about the vertical
fn scoopLocal(p0: vec3f) -> vec3f {
    let A = rotY(0.25 * sin(u.time * 0.4)) * normalize(vec3f(-0.75, 0.3, -0.6));
    let X = normalize(cross(A, vec3f(0.0, 0.0, 1.0)));
    let Z = cross(X, A);
    let q = p0 + A * 0.3 + vec3f(0.12, 0.0, 0.0);
    return vec3f(dot(q, X), dot(q, A), dot(q, Z));
}
fn scoopAng() -> f32 { return mix(0.5, 2.25, smoothstep(0.0, 1.0, 0.5 - 0.5 * cos(u.time * 0.45 + u.k.x * 2.0))); }
fn map_sector_scoop(p0: vec3f) -> f32 {
    let a = scoopAng();
    return sdSolidAngle(scoopLocal(p0), vec2f(sin(a), cos(a)), 0.92) - 0.02;
}
// sphere trace map_sector_scoop inside its bounding sphere; -1 on a miss
fn march_sector_scoop(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.45);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_sector_scoop(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_sector_scoop(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_sector_scoop
fn nrm_sector_scoop(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_sector_scoop(p + e.xyy) + e.yyx * map_sector_scoop(p + e.yyx) + e.yxy * map_sector_scoop(p + e.yxy) + e.xxx * map_sector_scoop(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_sector_scoop
fn ao_sector_scoop(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_sector_scoop(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_sector_scoop(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_sector_scoop(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_sector_scoop(p);
  let occ = ao_sector_scoop(p, n);
  let q = scoopLocal(p);
  let onCap = abs(length(q) - 0.92) < 0.03;
  let ci = clamp(-dot(rd, n), 0.0, 1.0);
  if (onCap) {
      let glaze = mix(vec3f(1.0, 0.42, 0.55), mix(vec3f(0.55, 0.32, 0.18), vec3f(0.55, 0.85, 0.5), step(0.5, k.y)), smoothstep(0.3, 0.7, k.y) * 0.9);
      let speck = smoothstep(0.75, 0.9, gnoise(q * 18.0));
      return finish(dielectric(rd, n, glaze * (1.0 - 0.6 * speck), 0.12, occ, 1.0), uv);
  }
  let a2 = atan2(q.z, q.x); let r = length(q);
  let wv = vec2f(a2 * 3.0 + r * 9.0, a2 * 3.0 - r * 9.0);
  let gw = abs(fract(wv / PI) - 0.5);
  let ridge = smoothstep(0.42, 0.5, max(gw.x, gw.y));
  let waffle = mix(vec3f(0.92, 0.62, 0.3), vec3f(0.55, 0.3, 0.1), ridge);
  return finish(dielectric(rd, n, waffle, 0.6, occ, 1.0) * 1.3, uv);
}

// ── pyramid_strata (primitives) ──
fn sdPyramid(p0: vec3f, h: f32) -> f32 {
    let m2 = h * h + 0.25;
    var p = vec3f(abs(p0.x), p0.y, abs(p0.z));
    if (p.z > p.x) { p = vec3f(p.z, p.y, p.x); }
    p = vec3f(p.x - 0.5, p.y, p.z - 0.5);
    let q = vec3f(p.z, h * p.y - 0.5 * p.x, h * p.x + 0.5 * p.y);
    let s = max(-q.x, 0.0);
    let tt = clamp((q.y - 0.5 * p.z) / (m2 + 0.25), 0.0, 1.0);
    let a = m2 * (q.x + s) * (q.x + s) + q.y * q.y;
    let b = m2 * (q.x + 0.5 * tt) * (q.x + 0.5 * tt) + (q.y - m2 * tt) * (q.y - m2 * tt);
    let d2 = select(min(a, b), 0.0, min(q.y, -q.x * m2 - q.y * 0.5) > 0.0);
    return sqrt((d2 + q.z * q.z) / m2) * sign(max(q.z, -p.y));
}
fn pyrLocal(p0: vec3f) -> vec3f { return rotY(u.time * 0.25 + 0.6) * (p0 - vec3f(0.0, -0.98, 0.0)) / 1.75; }
fn map_pyramid_strata(p0: vec3f) -> f32 { return sdPyramid(pyrLocal(p0), mix(0.6, 0.95, u.k.y)) * 1.75; }
// sphere trace map_pyramid_strata inside its bounding sphere; -1 on a miss
fn march_pyramid_strata(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.45);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_pyramid_strata(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_pyramid_strata(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_pyramid_strata
fn nrm_pyramid_strata(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_pyramid_strata(p + e.xyy) + e.yyx * map_pyramid_strata(p + e.yyx) + e.yxy * map_pyramid_strata(p + e.yxy) + e.xxx * map_pyramid_strata(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_pyramid_strata
fn ao_pyramid_strata(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_pyramid_strata(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
// soft shadow of map_pyramid_strata toward the light l (after Quilez)
fn shd_pyramid_strata(p: vec3f, l: vec3f) -> f32 {
    var res = 1.0; var t = 0.02;
    for (var i = 0; i < 32; i++) {
        let d = map_pyramid_strata(p + l * t);
        res = min(res, 6.0 * d / t);
        t += clamp(d, 0.02, 0.3);
        if (res < 0.005 || t > 4.0) { break; }
    }
    return clamp(res, 0.0, 1.0);
}
@fragment fn fs_pyramid_strata(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_pyramid_strata(ro, rd);
  if (h < 0.0) {
      if (rd.y < 0.0) {
          let pf = ro + rd * ((-0.98 - ro.y) / rd.y);
          let fsh = shd_pyramid_strata(pf, normalize(KEY));
          let fo = ao_pyramid_strata(pf, vec3f(0.0, 1.0, 0.0));
          return finish(stageFloor(rd, pf, fsh, fo), uv);
      }
      return finish(backdrop(rd), uv);
  }
  let p = ro + rd * h;
  let n = nrm_pyramid_strata(p);
  let occ = ao_pyramid_strata(p, n);
  let sh = shd_pyramid_strata(p + n * 0.012, normalize(KEY));
  let q = pyrLocal(p);
  let hgt = mix(0.6, 0.95, k.y);
  let nc = floor(mix(8.0, 22.0, k.x));
  let cy = q.y / hgt * nc;
  let course = floor(cy);
  let along = select(q.z, q.x, abs(q.x) < abs(q.z)) * 7.0 + course * 0.5;
  let jv = smoothstep(0.46, 0.5, abs(fract(along) - 0.5));
  let jh = smoothstep(0.4, 0.5, abs(fract(cy) - 0.5));
  let hb = hash3(vec3f(floor(along), course, 1.0));
  let sand = mix(vec3f(0.78, 0.6, 0.38), vec3f(0.62, 0.42, 0.25), hb.x * 0.7 + 0.15 * fbm3(q * 14.0, 2));
  let alb = sand * (1.0 - 0.45 * max(jv, jh));
  if (q.y > hgt * 0.84) { return finish(metal(rd, n, vec3f(1.0, 0.78, 0.38), 0.12, occ) * mix(0.5, 1.0, sh), uv); }
  return finish(dielectric(rd, n, alb, 0.75, occ, sh), uv);
}

// ── smooth_union (operators) ──
fn suM() -> mat3x3f { return rotX(0.25) * rotY(0.35 + 0.2 * sin(u.time * 0.3)); }
fn suX() -> f32 { return mix(0.4, 0.62, u.k.y) + 0.1 * sin(u.time * 0.9); }
fn suK() -> f32 { return mix(0.0, 0.6, u.k.x) * (0.55 + 0.45 * sin(u.time * 0.7 + 1.2)); }
fn suParts(p0: vec3f) -> vec2f {
    let p = suM() * p0;
    let x = suX();
    let a = length(p - vec3f(-x, 0.05, 0.0)) - 0.5;
    let b = rbox(rotY(0.6) * (p - vec3f(x, 0.0, 0.0)), vec3f(0.36), 0.06);
    let kk = max(suK(), 1e-4);
    let h = clamp(0.5 + 0.5 * (b - a) / kk, 0.0, 1.0);
    return vec2f(mix(b, a, h) - kk * h * (1.0 - h), h);
}
fn map_smooth_union(p: vec3f) -> f32 { return suParts(p).x; }
// sphere trace map_smooth_union inside its bounding sphere; -1 on a miss
fn march_smooth_union(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_smooth_union(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_smooth_union(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_smooth_union
fn nrm_smooth_union(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_smooth_union(p + e.xyy) + e.yyx * map_smooth_union(p + e.yyx) + e.yxy * map_smooth_union(p + e.yxy) + e.xxx * map_smooth_union(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_smooth_union
fn ao_smooth_union(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_smooth_union(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_smooth_union(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h0 = march_smooth_union(ro, rd);
  let tm = select(1e5, h0, h0 > 0.0);
  let M = suM(); let x = suX();
  let gs = ghostSph(M * ro, M * rd, vec3f(-x, 0.05, 0.0), 0.5, tm);
  let B = rotY(0.6) * M;
  let gb = ghostBox(B * ro - rotY(0.6) * vec3f(x, 0.0, 0.0), B * rd, vec3f(0.36), tm);
  let ghost = mix(cCream(), cTone(), 0.4) * (gs + gb) * 0.55;
  if (h0 < 0.0) { return finish(backdrop(rd) + ghost, uv); }
  let p = ro + rd * h0;
  let n = nrm_smooth_union(p);
  let occ = ao_smooth_union(p, n);
  let hh = suParts(p).y;
  let alb = mix(vec3f(0.12, 0.45, 0.95), vec3f(1.0, 0.36, 0.22), hh);
  let neck = 4.0 * hh * (1.0 - hh);
  let c = dielectric(rd, n, alb * (1.0 + 0.35 * neck), 0.25, occ, 1.0) + cCream() * 0.12 * neck * occ;
  return finish(c + ghost * 0.6, uv);
}

// ── smooth_carve (operators) ──
fn scM() -> mat3x3f { return rotX(0.42) * rotY(0.62); }
fn scC() -> vec3f { let a = u.time * 0.5 + 0.9; return vec3f(0.72 * cos(a), 0.5 + 0.12 * sin(u.time * 0.7), 0.72 * sin(a)); }
fn scParts(p0: vec3f) -> vec2f {
    let p = scM() * p0;
    let box = rbox(p, vec3f(0.66), 0.05);
    let sph = length(p - scC()) - mix(0.35, 0.65, u.k.y);
    let kk = mix(0.01, 0.2, u.k.x);
    let h = clamp(0.5 + 0.5 * (sph + box) / kk, 0.0, 1.0);
    return vec2f(-(mix(sph, -box, h) - kk * h * (1.0 - h)), h);
}
fn map_smooth_carve(p: vec3f) -> f32 { return scParts(p).x; }
// sphere trace map_smooth_carve inside its bounding sphere; -1 on a miss
fn march_smooth_carve(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_smooth_carve(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_smooth_carve(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_smooth_carve
fn nrm_smooth_carve(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_smooth_carve(p + e.xyy) + e.yyx * map_smooth_carve(p + e.yyx) + e.yxy * map_smooth_carve(p + e.yxy) + e.xxx * map_smooth_carve(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_smooth_carve
fn ao_smooth_carve(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_smooth_carve(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_smooth_carve(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h0 = march_smooth_carve(ro, rd);
  let tm = select(1e5, h0, h0 > 0.0);
  let M = scM();
  let ghost = mix(cCream(), cTone(), 0.5) * ghostSph(M * ro, M * rd, scC(), mix(0.35, 0.65, k.y), tm) * 0.6;
  if (h0 < 0.0) { return finish(backdrop(rd) + ghost, uv); }
  let p = ro + rd * h0;
  let n = nrm_smooth_carve(p);
  let occ = ao_smooth_carve(p, n);
  let hh = scParts(p).y;
  let q = M * p;
  let band = floor(q.y * 5.0 + 4.0);
  let layer = hue(band * 0.13 + 0.52) * 0.7 + 0.15;
  let shell = vec3f(0.93, 0.91, 0.87);
  let alb = mix(layer, shell, hh);
  let c = dielectric(rd, n, alb, mix(0.15, 0.55, hh), occ, 1.0);
  return finish(c + ghost * 0.7, uv);
}

// ── intersect_lens (operators) ──
fn ilM() -> mat3x3f { return rotX(0.5 + 0.1 * sin(u.time * 0.4)) * rotY(u.time * 0.3 + 0.62); }
fn ilR() -> f32 { return mix(0.78, 1.08, 0.5 + 0.5 * sin(u.time * 0.6 + mix(-1.5, 1.5, u.k.x))); }
fn ilParts(p0: vec3f) -> vec2f {
    let p = ilM() * p0;
    return vec2f(rbox(p, vec3f(0.68), mix(0.0, 0.1, u.k.y)), length(p) - ilR());
}
fn map_intersect_lens(p: vec3f) -> f32 { let d = ilParts(p); return max(d.x, d.y); }
// sphere trace map_intersect_lens inside its bounding sphere; -1 on a miss
fn march_intersect_lens(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_intersect_lens(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_intersect_lens(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_intersect_lens
fn nrm_intersect_lens(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_intersect_lens(p + e.xyy) + e.yyx * map_intersect_lens(p + e.yyx) + e.yxy * map_intersect_lens(p + e.yxy) + e.xxx * map_intersect_lens(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_intersect_lens
fn ao_intersect_lens(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_intersect_lens(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_intersect_lens(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h0 = march_intersect_lens(ro, rd);
  let tm = select(1e5, h0, h0 > 0.0);
  let M = ilM();
  let ghost = mix(cCream(), cTone(), 0.35) * (ghostSph(M * ro, M * rd, vec3f(0.0), ilR(), tm) + ghostBox(M * ro, M * rd, vec3f(0.68), tm)) * 0.5;
  if (h0 < 0.0) { return finish(backdrop(rd) + ghost, uv); }
  let p = ro + rd * h0;
  let n = nrm_intersect_lens(p);
  let occ = ao_intersect_lens(p, n);
  let d = ilParts(p);
  var c: vec3f;
  if (d.y > d.x) { c = metal(rd, n, vec3f(1.0, 0.76, 0.4), 0.32, occ); }
  else { c = dielectric(rd, n, vec3f(0.05, 0.16, 0.6), 0.08, occ, 1.0); }
  return finish(c + ghost * 0.4, uv);
}

// ── onion_cutaway (operators) ──
fn onM() -> mat3x3f { return rotX(0.32) * rotY(0.78 + 0.25 * sin(u.time * 0.3)); }
fn onBase(p: vec3f) -> f32 { return mix(length(p) - 0.92, rbox(p, vec3f(0.7), 0.22), 0.55); }
fn onCut() -> f32 { return mix(-0.45, 0.2, 0.5 + 0.5 * sin(u.time * 0.55 + mix(-1.5, 1.5, u.k.y))); }
fn onParts(p0: vec3f) -> vec2f {
    let p = onM() * p0;
    let d0 = onBase(p);
    let step = mix(0.18, 0.3, u.k.x);
    var d = d0 + 3.0 * step;
    for (var i = 0; i < 3; i++) { d = min(d, abs(d0 + f32(i) * step) - 0.045); }
    let cut = min(p.x - onCut(), p.z - onCut());
    return vec2f(max(d, cut), cut);
}
fn map_onion_cutaway(p: vec3f) -> f32 { return onParts(p).x; }
// sphere trace map_onion_cutaway inside its bounding sphere; -1 on a miss
fn march_onion_cutaway(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_onion_cutaway(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_onion_cutaway(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_onion_cutaway
fn nrm_onion_cutaway(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_onion_cutaway(p + e.xyy) + e.yyx * map_onion_cutaway(p + e.yyx) + e.yxy * map_onion_cutaway(p + e.yxy) + e.xxx * map_onion_cutaway(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_onion_cutaway
fn ao_onion_cutaway(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_onion_cutaway(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_onion_cutaway(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_onion_cutaway(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_onion_cutaway(p);
  let occ = ao_onion_cutaway(p, n);
  let q = onM() * p;
  let d0 = onBase(q);
  let st = mix(0.18, 0.3, k.x);
  let layer = clamp(floor((-d0 + 0.05) / st), 0.0, 3.0);
  let parts = onParts(p);
  let onCutFace = abs(parts.y - parts.x) < 0.003;
  var alb = hue(0.08 + layer * 0.2) * 0.75 + 0.12;
  if (layer < 0.5) { alb = vec3f(0.92, 0.9, 0.86); }
  if (onCutFace) {
      let rings = 0.85 + 0.15 * sin(-d0 * 140.0);
      alb = mix(alb * 1.15, cCream(), 0.15) * rings;
  }
  return finish(dielectric(rd, n, alb, select(0.2, 0.6, onCutFace), occ, 1.0), uv);
}

// ── twist_bar (operators) ──
fn twM() -> mat3x3f { return rotX(0.18) * rotY(0.5 + u.time * 0.2); }
fn twK() -> f32 { return mix(0.0, 3.2, u.k.x) * sin(u.time * 0.6 + 0.9); }
fn twLocal(p0: vec3f) -> vec3f {
    let p = twM() * p0;
    let xz = rot2(twK() * p.y) * p.xz;
    return vec3f(xz.x, p.y, xz.y);
}
fn map_twist_bar(p0: vec3f) -> f32 {
    let g = mix(0.2, 0.36, u.k.y);
    return rbox(twLocal(p0), vec3f(g, 1.0, g), 0.04) * 0.55;
}
// sphere trace map_twist_bar inside its bounding sphere; -1 on a miss
fn march_twist_bar(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_twist_bar(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_twist_bar(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_twist_bar
fn nrm_twist_bar(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_twist_bar(p + e.xyy) + e.yyx * map_twist_bar(p + e.yyx) + e.yxy * map_twist_bar(p + e.yxy) + e.xxx * map_twist_bar(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_twist_bar
fn ao_twist_bar(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_twist_bar(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_twist_bar(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h0 = march_twist_bar(ro, rd);
  let tm = select(1e5, h0, h0 > 0.0);
  let M = twM(); let g = mix(0.2, 0.36, k.y);
  let ghost = mix(cCream(), cTone(), 0.4) * ghostBox(M * ro, M * rd, vec3f(g, 1.0, g), tm) * 0.5;
  if (h0 < 0.0) { return finish(backdrop(rd) + ghost, uv); }
  let p = ro + rd * h0;
  let n = nrm_twist_bar(p);
  let occ = ao_twist_bar(p, n);
  let q = twLocal(p);
  let ax = abs(q.xz) / g;
  let side = select(select(2.0, 3.0, q.z < 0.0), select(0.0, 1.0, q.x < 0.0), ax.x > ax.y);
  var alb = hue(side * 0.25 + 0.05) * 0.7 + 0.1;
  if (abs(q.y) > 0.98) { alb = vec3f(0.9); }
  let ring = smoothstep(0.035, 0.0, abs(fract(q.y * 5.0) - 0.5) - 0.44);
  alb *= 1.0 - 0.75 * ring;
  return finish(dielectric(rd, n, alb, 0.2, occ, 1.0) + ghost * 0.4, uv);
}

// ── bend_plank (operators) ──
fn bnM() -> mat3x3f { return rotX(0.5) * rotY(-0.32); }
fn bnK() -> f32 { return mix(0.0, 1.5, u.k.x) * sin(u.time * 0.7 + 1.1); }
fn bnLocal(p0: vec3f) -> vec3f {
    let p = bnM() * p0;
    let kb = bnK();
    let c = cos(kb * p.x); let s = sin(kb * p.x);
    return vec3f(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
}
fn map_bend_plank(p0: vec3f) -> f32 { return rbox(bnLocal(p0), vec3f(1.05, 0.06, 0.48), 0.03) * 0.6; }
// sphere trace map_bend_plank inside its bounding sphere; -1 on a miss
fn march_bend_plank(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_bend_plank(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_bend_plank(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_bend_plank
fn nrm_bend_plank(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_bend_plank(p + e.xyy) + e.yyx * map_bend_plank(p + e.yyx) + e.yxy * map_bend_plank(p + e.yxy) + e.xxx * map_bend_plank(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_bend_plank
fn ao_bend_plank(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_bend_plank(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_bend_plank(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h0 = march_bend_plank(ro, rd);
  let tm = select(1e5, h0, h0 > 0.0);
  let M = bnM();
  let ghost = mix(cCream(), cTone(), 0.4) * ghostBox(M * ro, M * rd, vec3f(1.05, 0.06, 0.48), tm) * 0.45;
  if (h0 < 0.0) { return finish(backdrop(rd) + ghost, uv); }
  let p = ro + rd * h0;
  let n = nrm_bend_plank(p);
  let occ = ao_bend_plank(p, n);
  let q = bnLocal(p);
  let sc = mix(4.0, 10.0, k.y);
  let gq = abs(fract(q.xz * sc) - 0.5);
  let minor = smoothstep(0.44, 0.5, max(gq.x, gq.y));
  let gM = abs(fract(q.xz * sc / 5.0) - 0.5);
  let major = smoothstep(0.47, 0.5, max(gM.x, gM.y));
  var alb = vec3f(0.95, 0.94, 0.9);
  alb = mix(alb, vec3f(0.35, 0.6, 0.95), minor * 0.6);
  alb = mix(alb, vec3f(0.1, 0.3, 0.85), major);
  if (abs(q.y) < 0.055) { alb = vec3f(1.0, 0.45, 0.15); }
  return finish(dielectric(rd, n, alb, 0.45, occ, 1.0) + ghost * 0.4, uv);
}

// ── repeat_grid (operators) ──
fn rgM() -> mat3x3f { return rotX(0.55) * rotY(u.time * 0.25 + 0.6); }
fn rgL() -> f32 { return 1.6 + 1.3 * sin(u.time * 0.4 + 0.3); }
fn rgParts(p0: vec3f) -> vec4f {
    let p = rgM() * p0;
    let s = mix(0.36, 0.46, u.k.x);
    let id = clamp(round(p / s), vec3f(-2.0), vec3f(2.0));
    let q = p - id * s;
    let ring = max(abs(id.x), max(abs(id.y), abs(id.z)));
    let sz = s * 0.36 * smoothstep(0.0, 1.0, rgL() - ring);
    let qr = rotY(u.time * mix(0.0, 2.0, u.k.y) + dot(id, vec3f(1.3, 0.7, 2.1))) * q;
    var d = rbox(qr, vec3f(sz), sz * 0.3);
    d = min(d, max(s * 0.5 - max(abs(q.x), max(abs(q.y), abs(q.z))), 0.0) + 0.02);
    return vec4f(d, id);
}
fn map_repeat_grid(p: vec3f) -> f32 { return rgParts(p).x; }
// sphere trace map_repeat_grid inside its bounding sphere; -1 on a miss
fn march_repeat_grid(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_repeat_grid(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_repeat_grid(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_repeat_grid
fn nrm_repeat_grid(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_repeat_grid(p + e.xyy) + e.yyx * map_repeat_grid(p + e.yyx) + e.yxy * map_repeat_grid(p + e.yxy) + e.xxx * map_repeat_grid(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_repeat_grid
fn ao_repeat_grid(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_repeat_grid(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_repeat_grid(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_repeat_grid(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_repeat_grid(p);
  let occ = ao_repeat_grid(p, n);
  let id = rgParts(p).yzw;
  let alb = hue(dot(id, vec3f(0.11, 0.17, 0.07)) + 0.55) * 0.75 + 0.12;
  return finish(dielectric(rd, n, alb, 0.15, occ, 1.0), uv);
}

// ── elongate_round (operators) ──
fn elM() -> mat3x3f { return rotX(0.42) * rotY(u.time * 0.3 + 0.5); }
fn elH() -> vec3f {
    let s = mix(0.2, 1.0, u.k.y);
    return vec3f(0.45 * s * (0.5 + 0.5 * sin(u.time * 0.6 + 1.0)), 0.0, 0.32 * s * (0.5 + 0.5 * sin(u.time * 0.45 + 2.4)));
}
fn elR() -> f32 { return mix(0.0, 0.2, u.k.x) * (0.5 + 0.5 * sin(u.time * 0.8 + 0.6)); }
fn map_elongate_round(p0: vec3f) -> f32 {
    let p = elM() * p0;
    let h = elH();
    let q = p - clamp(p, -h, h);
    let r = elR();
    return sdOcta(q, 0.62 - r) - r;
}
// sphere trace map_elongate_round inside its bounding sphere; -1 on a miss
fn march_elongate_round(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_elongate_round(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_elongate_round(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_elongate_round
fn nrm_elongate_round(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_elongate_round(p + e.xyy) + e.yyx * map_elongate_round(p + e.yyx) + e.yxy * map_elongate_round(p + e.yxy) + e.xxx * map_elongate_round(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_elongate_round
fn ao_elongate_round(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_elongate_round(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_elongate_round(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_elongate_round(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_elongate_round(p);
  let occ = ao_elongate_round(p, n);
  let q = elM() * p;
  let he = elH();
  let inSlab = abs(q.x) < he.x || abs(q.z) < he.z;
  let stripe = step(0.5, fract((q.x + q.z) * 7.0));
  var alb = vec3f(0.95, 0.75, 0.2);
  if (inSlab) { alb = mix(vec3f(0.1, 0.55, 0.6), vec3f(0.92, 0.95, 0.95), stripe); }
  return finish(dielectric(rd, n, alb, 0.12, occ, 1.0), uv);
}

// ── displace_wave (operators) ──
fn dwM() -> mat3x3f { return rotX(0.3) * rotY(u.time * 0.3 + 0.2); }
fn dwParts(p0: vec3f) -> vec2f {
    let t = u.time;
    let p = dwM() * p0;
    let amp = mix(0.02, 0.16, u.k.x) * (0.55 + 0.45 * sin(t * 0.7 + 1.3));
    let f = mix(3.0, 8.0, u.k.y);
    let w = sin(f * p.x + t) * sin(f * p.y + t * 0.7) * sin(f * p.z - t * 0.5);
    return vec2f((length(p) - 0.8 + amp * w) / (1.0 + amp * f * 1.6), w);
}
fn map_displace_wave(p: vec3f) -> f32 { return dwParts(p).x; }
// sphere trace map_displace_wave inside its bounding sphere; -1 on a miss
fn march_displace_wave(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_displace_wave(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_displace_wave(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_displace_wave
fn nrm_displace_wave(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_displace_wave(p + e.xyy) + e.yyx * map_displace_wave(p + e.yyx) + e.yxy * map_displace_wave(p + e.yxy) + e.xxx * map_displace_wave(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_displace_wave
fn ao_displace_wave(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_displace_wave(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_displace_wave(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h0 = march_displace_wave(ro, rd);
  let tm = select(1e5, h0, h0 > 0.0);
  let M = dwM();
  let ghost = mix(cCream(), cTone(), 0.4) * ghostSph(M * ro, M * rd, vec3f(0.0), 0.8, tm) * 0.5;
  if (h0 < 0.0) { return finish(backdrop(rd) + ghost, uv); }
  let p = ro + rd * h0;
  let n = nrm_displace_wave(p);
  let occ = ao_displace_wave(p, n);
  let w = dwParts(p).y;
  let alb = mix(mix(vec3f(0.1, 0.25, 0.85), vec3f(0.9, 0.9, 0.88), smoothstep(-1.0, 0.0, -w)), vec3f(1.0, 0.4, 0.1), smoothstep(0.0, 1.0, -w));
  return finish(dielectric(rd, n, alb, 0.18, occ, 1.0) + ghost * 0.4, uv);
}

// ── jade_bi (materials) ──
fn jadeLocal(p0: vec3f) -> vec3f { return spin(p0, 0.45 * sin(u.time * 0.3) + 0.3, 1.0 + 0.2 * sin(u.time * 0.4)) / 0.88; }
fn map_jade_bi(p0: vec3f) -> f32 {
    let p = jadeLocal(p0);
    let r = length(p.xz);
    var d = sdBox2(vec2f(r - 0.64, p.y), vec2f(0.32, 0.055)) - 0.035;
    let row = clamp(floor(r / 0.085), 4.0, 11.0);
    let rr = (row + 0.5) * 0.085;
    let cols = floor(TAU * rr / 0.085);
    let a = atan2(p.z, p.x) / TAU * cols + row * 0.5;
    let cell = vec2f(r - rr, (fract(a) - 0.5) * TAU * rr / cols);
    d -= 0.014 * smoothstep(0.034, 0.0, length(cell)) * smoothstep(0.38, 0.92, r) * smoothstep(0.98, 0.9, r);
    return d * 0.79;
}
// sphere trace map_jade_bi inside its bounding sphere; -1 on a miss
fn march_jade_bi(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_jade_bi(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_jade_bi(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_jade_bi
fn nrm_jade_bi(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_jade_bi(p + e.xyy) + e.yyx * map_jade_bi(p + e.yyx) + e.yxy * map_jade_bi(p + e.yxy) + e.xxx * map_jade_bi(p + e.xxx));
}
// path length from an inside point p along rd to the far wall of map_jade_bi
fn thru_jade_bi(p: vec3f, rd: vec3f) -> f32 {
    var t = 0.01;
    for (var i = 0; i < 40; i++) {
        let d = -map_jade_bi(p + rd * t);
        if (d < 0.0008) { break; }
        t += max(d, 0.002);
    }
    return t;
}
// five-tap ambient occlusion along the normal of map_jade_bi
fn ao_jade_bi(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_jade_bi(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_jade_bi(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_jade_bi(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_jade_bi(p);
  let occ = ao_jade_bi(p, n);
  let q = jadeLocal(p);
  let ci = clamp(-dot(rd, n), 0.0, 1.0);
  let fr = schlick(ci, 0.05);
  let din = refract(rd, n, 1.0 / 1.62);
  let L = min(thru_jade_bi(p - n * 0.004, din), 0.8);
  let cloud = fbm3(q * 2.6 + 3.0, 4);
  let sig = vec3f(3.4, 0.9, 2.4) * mix(0.8, 3.2, k.y) * (0.75 + mix(0.0, 1.2, k.x) * cloud);
  let back = envDiff(-n) * 0.9 + envT(din) * 0.3 + cCream() * 0.12;
  let trans = exp(-sig * (L * 3.0 + 0.15)) * back;
  let rind = smoothstep(0.25, 0.55, fbm3(q * 1.7 + 11.0, 3)) * 0.55;
  let body = mix(vec3f(0.06, 0.3, 0.14), vec3f(0.45, 0.28, 0.1), rind);
  let milk = smoothstep(0.1, 0.5, cloud) * envDiff(n) * vec3f(0.75, 0.88, 0.8) * 0.35;
  let c = mix(trans, trans * vec3f(1.0, 0.6, 0.35), rind) * (1.0 - fr) + body * envDiff(n) * 0.22 + milk + env(reflect(rd, n)) * fr * 1.2;
  return finish(c * mix(0.7, 1.0, occ), uv);
}

// ── wax_candle (materials) ──
fn candleTop() -> f32 { return 0.42 - mix(0.0, 0.35, u.k.y) * fract(u.time * 0.01 + 0.2); }
fn candleParts(p0: vec3f) -> vec2f {
    let p = rotY(0.4) * p0;
    let top = candleTop();
    let r = length(p.xz);
    var wax = max(r - 0.42, max(p.y - top, -0.98 - p.y));
    wax = smax(wax, -(length(p - vec3f(0.0, top + 0.5, 0.0)) - 0.56), 0.04);
    for (var i = 0; i < 4; i++) {
        let fi = f32(i);
        let a = fi * 1.9 + 0.6;
        let len = 0.18 + 0.32 * fract(fi * 0.618 + 0.3);
        let dir = vec3f(cos(a), 0.0, sin(a));
        wax = smin(wax, sdCapsule(p, dir * 0.4 + vec3f(0.0, top - 0.03, 0.0), dir * 0.415 + vec3f(0.0, top - len, 0.0), 0.04 + 0.012 * fi), 0.06);
    }
    let wick = sdCapsule(p, vec3f(0.0, top - 0.06, 0.0), vec3f(0.015, top + 0.11, 0.0), 0.014);
    return vec2f(wax, wick);
}
fn map_wax_candle(p: vec3f) -> f32 { let d = candleParts(p); return min(d.x, d.y); }
// the flame: an emissive teardrop gathered along the ray in 14 steps
fn candleFlame(ro: vec3f, rd: vec3f, tmax: f32, fc: vec3f) -> vec3f {
    let hs = sphHit(ro - fc, rd, 0.3);
    if (hs.y < 0.0) { return vec3f(0.0); }
    let t0 = max(hs.x, 0.0); let t1 = min(hs.y, tmax);
    let dt = (t1 - t0) / 14.0;
    var c = vec3f(0.0);
    for (var i = 0; i < 14; i++) {
        let q = ro + rd * (t0 + dt * (f32(i) + 0.5)) - fc;
        let w = q.y + 0.1;
        let rad = 0.075 * sqrt(clamp(1.0 - abs(w - 0.06) / 0.2, 0.0, 1.0)) * (1.0 - 0.3 * smoothstep(0.0, 0.25, w));
        let dd = length(q.xz) / max(rad, 0.005);
        let core = exp(-dd * dd * 2.0) * smoothstep(-0.12, -0.06, q.y);
        let blue = exp(-dd * dd * 3.0) * smoothstep(-0.02, -0.11, q.y) * smoothstep(-0.16, -0.1, q.y);
        c += (mix(vec3f(1.0, 0.45, 0.1), vec3f(1.0, 0.92, 0.7), smoothstep(-0.05, 0.08, -q.y + 0.02)) * core * 9.0 + vec3f(0.2, 0.35, 1.0) * blue * 3.0) * dt;
    }
    return c;
}
// sphere trace map_wax_candle inside its bounding sphere; -1 on a miss
fn march_wax_candle(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.45);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_wax_candle(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_wax_candle(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_wax_candle
fn nrm_wax_candle(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_wax_candle(p + e.xyy) + e.yyx * map_wax_candle(p + e.yyx) + e.yxy * map_wax_candle(p + e.yxy) + e.xxx * map_wax_candle(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_wax_candle
fn ao_wax_candle(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_wax_candle(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
// soft shadow of map_wax_candle toward the light l (after Quilez)
fn shd_wax_candle(p: vec3f, l: vec3f) -> f32 {
    var res = 1.0; var t = 0.02;
    for (var i = 0; i < 32; i++) {
        let d = map_wax_candle(p + l * t);
        res = min(res, 6.0 * d / t);
        t += clamp(d, 0.02, 0.3);
        if (res < 0.005 || t > 4.0) { break; }
    }
    return clamp(res, 0.0, 1.0);
}
@fragment fn fs_wax_candle(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let fl = mix(0.4, 1.6, k.x) * (0.9 + 0.1 * sin(t * 13.0) * sin(t * 7.3));
  let top = candleTop();
  let fc = vec3f(0.02 * gnoise(vec3f(t * 2.0, 0.0, 0.0)), top + 0.2, 0.0);
  let flameC = vec3f(1.0, 0.55, 0.2) * fl;
  let h = march_wax_candle(ro, rd);
  if (h < 0.0) {
      if (rd.y < 0.0) {
          let pf = ro + rd * ((-0.98 - ro.y) / rd.y);
          let fsh = shd_wax_candle(pf, normalize(KEY));
          let fo = ao_wax_candle(pf, vec3f(0.0, 1.0, 0.0));
          return finish(stageFloor(rd, pf, fsh, fo) + flameC * 0.12 * fo / (1.0 + dot(pf.xz, pf.xz) * 1.5) + candleFlame(ro, rd, 1e5, fc), uv);
      }
      return finish(backdrop(rd) + candleFlame(ro, rd, 1e5, fc), uv);
  }
  let p = ro + rd * h;
  let n = nrm_wax_candle(p);
  let occ = ao_wax_candle(p, n);
  let sh = shd_wax_candle(p + n * 0.012, normalize(KEY));
  let parts = candleParts(p);
  let lv = fc - p; let ld = length(lv);
  var c: vec3f;
  if (parts.y < parts.x) {
      c = vec3f(0.02) * envDiff(n) + vec3f(1.0, 0.3, 0.05) * smoothstep(top + 0.02, top + 0.1, p.y) * 2.0 * fl;
  } else {
      let wax = mix(vec3f(0.96, 0.86, 0.7), cCream(), 0.3);
      let wrap = envDiffS(n, sh) * 0.75 + envDiff(-n) * 0.08;
      let sss = flameC * exp(-max(top - p.y, 0.0) * 4.0) * (0.55 + 0.45 * smoothstep(0.42, 0.25, length(p.xz)));
      let direct = flameC * (max(dot(n, lv / ld), 0.0) * 0.7 + 0.15) / (1.0 + 6.0 * ld * ld);
      let ci = clamp(-dot(rd, n), 0.0, 1.0);
      c = wax * (wrap + sss * 1.8 + direct * 1.5) * occ + envRough(reflect(rd, n), 0.35) * schlick(ci, 0.03) * occ;
  }
  return finish(c + candleFlame(ro, rd, h, fc), uv);
}

// ── crackle_vase (materials) ──
fn vaseR(y: f32) -> f32 { return 0.2 + 0.44 * exp(-pow((y + 0.25) / 0.42, 2.0)) + 0.11 * smoothstep(0.45, 0.85, y); }
fn vaseLocal(p0: vec3f) -> vec3f { return rotY(u.time * 0.25 + 0.4) * p0; }
fn map_crackle_vase(p0: vec3f) -> f32 {
    let p = vaseLocal(p0);
    let r = length(p.xz);
    let vr = vaseR(p.y);
    let wall = max(abs(r - vr + 0.035) - 0.035, abs(p.y + 0.07) - 0.89);
    let foot = max(r - vr, abs(p.y + 0.9) - 0.06);
    return min(wall, foot) * 0.72;
}
// sphere trace map_crackle_vase inside its bounding sphere; -1 on a miss
fn march_crackle_vase(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.25);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_crackle_vase(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_crackle_vase(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_crackle_vase
fn nrm_crackle_vase(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_crackle_vase(p + e.xyy) + e.yyx * map_crackle_vase(p + e.yyx) + e.yxy * map_crackle_vase(p + e.yxy) + e.xxx * map_crackle_vase(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_crackle_vase
fn ao_crackle_vase(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_crackle_vase(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
// soft shadow of map_crackle_vase toward the light l (after Quilez)
fn shd_crackle_vase(p: vec3f, l: vec3f) -> f32 {
    var res = 1.0; var t = 0.02;
    for (var i = 0; i < 32; i++) {
        let d = map_crackle_vase(p + l * t);
        res = min(res, 6.0 * d / t);
        t += clamp(d, 0.02, 0.3);
        if (res < 0.005 || t > 4.0) { break; }
    }
    return clamp(res, 0.0, 1.0);
}
@fragment fn fs_crackle_vase(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_crackle_vase(ro, rd);
  if (h < 0.0) {
      if (rd.y < 0.0) {
          let pf = ro + rd * ((-0.96 - ro.y) / rd.y);
          let fsh = shd_crackle_vase(pf, normalize(KEY));
          let fo = ao_crackle_vase(pf, vec3f(0.0, 1.0, 0.0));
          return finish(stageFloor(rd, pf, fsh, fo), uv);
      }
      return finish(backdrop(rd), uv);
  }
  let p = ro + rd * h;
  let n = nrm_crackle_vase(p);
  let occ = ao_crackle_vase(p, n);
  let sh = shd_crackle_vase(p + n * 0.012, normalize(KEY));
  let q = vaseLocal(p);
  let inner = length(q.xz) < vaseR(q.y) - 0.035 && q.y > -0.8;
  let sc = mix(3.5, 7.0, k.x);
  let w1 = worley2(q * sc);
  let w2 = worley2(q * sc * 2.7 + 5.0);
  let iron = smoothstep(0.045, 0.012, w1.y - w1.x);
  let goldl = smoothstep(0.03, 0.008, w2.y - w2.x) * (1.0 - iron);
  let glaze = mix(vec3f(0.58, 0.74, 0.66), vec3f(0.78, 0.8, 0.74), k.y) * (0.92 + 0.12 * fbm3(q * 3.0, 3));
  var alb = mix(glaze, vec3f(0.12, 0.1, 0.09), iron * 0.85);
  alb = mix(alb, vec3f(0.78, 0.58, 0.25), goldl * 0.7);
  if (inner) { alb *= 0.45; }
  if (q.y < -0.92) { alb = vec3f(0.55, 0.4, 0.3); }
  return finish(dielectric(rd, n, alb, 0.05, occ, sh), uv);
}

// ── velvet_cushion (materials) ──
fn cushLocal(p0: vec3f) -> vec3f { return rotY(u.time * 0.3 + 0.75) * (rotX(-0.62) * p0); }
fn cushParts(p0: vec3f) -> vec2f {
    let p = cushLocal(p0);
    let cx = clamp(1.0 - pow(p.x / 0.86, 2.0), 0.0, 1.0);
    let cz = clamp(1.0 - pow(p.z / 0.86, 2.0), 0.0, 1.0);
    let th = 0.05 + 0.24 * sqrt(cx * cz);
    let sq = sdBox2(p.xz, vec2f(0.76)) - 0.1;
    var d = smax(sq, abs(p.y) - th, 0.12);
    d += 0.07 * exp(-dot(p.xz, p.xz) * 40.0);
    let pipe = length(vec2f(sq, p.y)) - 0.035;
    d = smin(d, pipe, 0.02) * 0.75;
    let cn = abs(p.xz) - vec2f(0.85);
    let tas = min(length(vec3f(cn.x, p.y, cn.y)) - 0.06, length(vec3f(cn.x - 0.04, p.y + 0.0, cn.y - 0.04) * vec3f(1.0, 0.45, 1.0)) - 0.045);
    let btn = length(vec3f(p.x, abs(p.y) - 0.21, p.z)) - 0.05;
    return vec2f(d, min(tas, btn));
}
fn map_velvet_cushion(p: vec3f) -> f32 { let d = cushParts(p); return min(d.x, d.y); }
// sphere trace map_velvet_cushion inside its bounding sphere; -1 on a miss
fn march_velvet_cushion(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_velvet_cushion(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_velvet_cushion(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_velvet_cushion
fn nrm_velvet_cushion(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_velvet_cushion(p + e.xyy) + e.yyx * map_velvet_cushion(p + e.yyx) + e.yxy * map_velvet_cushion(p + e.yxy) + e.xxx * map_velvet_cushion(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_velvet_cushion
fn ao_velvet_cushion(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_velvet_cushion(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_velvet_cushion(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_velvet_cushion(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_velvet_cushion(p);
  let occ = ao_velvet_cushion(p, n);
  let parts = cushParts(p);
  if (parts.y < parts.x) { return finish(metal(rd, n, vec3f(1.0, 0.74, 0.36), 0.3, occ), uv); }
  let q = cushLocal(p);
  let ci = clamp(-dot(rd, n), 0.0, 1.0);
  let pile = 1.0 + mix(0.0, 0.25, k.y) * fbm3(q * vec3f(30.0, 30.0, 30.0), 2);
  let alb = mix(vec3f(0.32, 0.015, 0.1), cTone() * 0.4, 0.15);
  let sheen = pow(1.0 - ci, 3.0) * mix(0.8, 2.6, k.x) + 0.12;
  let sheenC = mix(alb * 4.0, vec3f(1.0, 0.75, 0.85), 0.35);
  let c = (envDiff(n) * alb * 0.6 + envDiff(n) * sheenC * sheen * 0.55) * pile * occ;
  return finish(c, uv);
}

// ── brushed_knob (materials) ──
fn knobM() -> mat3x3f { return rotY(0.3 * sin(u.time * 0.7) * mix(0.5, 3.0, u.k.y) + 0.5) * rotX(-0.85) * rotY(0.3); }
fn knobParts(p0: vec3f) -> vec2f {
    let p = knobM() * p0;
    let r = length(p.xz);
    let a = atan2(p.z, p.x);
    let knurl = 0.012 * abs(sin(a * 40.0)) * smoothstep(0.1, 0.16, -p.y + 0.12);
    var d = rbox(vec3f(r - 0.42, p.y, 0.0), vec3f(0.42, 0.24, 1.0), 0.04);
    d = max(d, r - 0.84 + knurl);
    d = max(d, -(length(p - vec3f(0.0, 0.62, 0.0)) - 0.42));
    let dot0 = length(p - vec3f(0.62, 0.235, 0.0)) - 0.05;
    return vec2f(d * 0.9, dot0);
}
fn map_brushed_knob(p: vec3f) -> f32 { let d = knobParts(p); return max(d.x, -d.y); }
// sphere trace map_brushed_knob inside its bounding sphere; -1 on a miss
fn march_brushed_knob(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_brushed_knob(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_brushed_knob(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_brushed_knob
fn nrm_brushed_knob(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_brushed_knob(p + e.xyy) + e.yyx * map_brushed_knob(p + e.yyx) + e.yxy * map_brushed_knob(p + e.yxy) + e.xxx * map_brushed_knob(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_brushed_knob
fn ao_brushed_knob(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_brushed_knob(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_brushed_knob(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_brushed_knob(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_brushed_knob(p);
  let occ = ao_brushed_knob(p, n);
  let M = knobM();
  let q = M * p;
  let parts = knobParts(p);
  if (parts.y < 0.004) { return finish(mix(cTone(), vec3f(1.0, 0.3, 0.2), 0.5) * 4.0, uv); }
  let tl = normalize(vec3f(-q.z, 0.0, q.x) + vec3f(1e-4));
  let T = transpose(M) * tl;
  let tint = vec3f(0.86, 0.88, 0.92);
  let spread = mix(0.1, 0.6, k.x);
  var acc = vec3f(0.0);
  for (var i = 0; i < 7; i++) {
      let s = (f32(i) - 3.0) / 3.0;
      acc += env(reflect(rd, normalize(n + T * s * spread)));
  }
  acc /= 7.0;
  let rings = 0.9 + 0.1 * sin(length(q.xz) * 600.0);
  let ci = clamp(-dot(rd, n), 0.0, 1.0);
  let c = (acc * mix(tint, vec3f(1.0), schlick(ci, 0.0)) * rings + envDiff(n) * tint * 0.1) * occ;
  return finish(c, uv);
}

// ── carbon_egg (materials) ──
fn carbM() -> mat3x3f { return rotX(0.3 + 0.2 * sin(u.time * 0.4)) * rotY(u.time * 0.35 + 0.5); }
fn map_carbon_egg(p0: vec3f) -> f32 {
    let p = carbM() * p0;
    return sdEllipsoid(p * vec3f(1.0, 1.0 + 0.12 * clamp(p.y, -1.0, 0.0), 1.0), vec3f(0.66, 0.92, 0.66));
}
// sphere trace map_carbon_egg inside its bounding sphere; -1 on a miss
fn march_carbon_egg(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_carbon_egg(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_carbon_egg(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_carbon_egg
fn nrm_carbon_egg(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_carbon_egg(p + e.xyy) + e.yyx * map_carbon_egg(p + e.yyx) + e.yxy * map_carbon_egg(p + e.yxy) + e.xxx * map_carbon_egg(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_carbon_egg
fn ao_carbon_egg(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_carbon_egg(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_carbon_egg(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_carbon_egg(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_carbon_egg(p);
  let occ = ao_carbon_egg(p, n);
  let M = carbM();
  let q = M * p;
  let nl = M * n;
  let an = abs(nl);
  var uvp: vec2f; var ua: vec3f; var va: vec3f;
  if (an.x > an.y && an.x > an.z) { uvp = q.yz; ua = vec3f(0.0, 1.0, 0.0); va = vec3f(0.0, 0.0, 1.0); }
  else if (an.y > an.z) { uvp = q.zx; ua = vec3f(0.0, 0.0, 1.0); va = vec3f(1.0, 0.0, 0.0); }
  else { uvp = q.xy; ua = vec3f(1.0, 0.0, 0.0); va = vec3f(0.0, 1.0, 0.0); }
  let w = mix(0.05, 0.11, k.x);
  let g = uvp / w;
  let ij = floor(g);
  let f = fract(g);
  let over = ((i32(ij.x) + i32(ij.y)) % 4 + 4) % 4 < 2;
  let Fl = select(va, ua, over);
  let across = select(f.x, f.y, over) - 0.5;
  let F = transpose(M) * Fl;
  let nt = n;
  let seam = smoothstep(0.38, 0.5, abs(across));
  var acc = vec3f(0.0);
  for (var i = 0; i < 5; i++) {
      let s = (f32(i) - 2.0) / 2.0;
      acc += envDiff(reflect(rd, normalize(nt + F * s * 0.9))) * 0.6 + env(reflect(rd, normalize(nt + F * s * 0.9))) * 0.4;
  }
  let fibre = acc / 5.0 * vec3f(0.13, 0.135, 0.15) * (1.0 - 0.6 * seam);
  let ci = clamp(-dot(rd, n), 0.0, 1.0);
  let coat = env(reflect(rd, n)) * schlick(ci, 0.04) * mix(0.3, 1.6, k.y);
  return finish((fibre + vec3f(0.01) + coat) * occ, uv);
}

// ── turned_bowl (materials) ──
fn bowlLocal(p0: vec3f) -> vec3f { return rotY(u.time * 0.3 + 1.1) * p0; }
fn map_turned_bowl(p0: vec3f) -> f32 {
    let p = bowlLocal(p0);
    let c = vec3f(0.0, 0.32, 0.0);
    var d = abs(length(p - c) - 0.9) - 0.045;
    d = smax(d, p.y - 0.18, 0.03);
    let foot = sdCyl(p - vec3f(0.0, -0.58, 0.0), 0.035, 0.34) - 0.01;
    return min(d, foot);
}
// sphere trace map_turned_bowl inside its bounding sphere; -1 on a miss
fn march_turned_bowl(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.30);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_turned_bowl(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_turned_bowl(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_turned_bowl
fn nrm_turned_bowl(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_turned_bowl(p + e.xyy) + e.yyx * map_turned_bowl(p + e.yyx) + e.yxy * map_turned_bowl(p + e.yxy) + e.xxx * map_turned_bowl(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_turned_bowl
fn ao_turned_bowl(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_turned_bowl(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
// soft shadow of map_turned_bowl toward the light l (after Quilez)
fn shd_turned_bowl(p: vec3f, l: vec3f) -> f32 {
    var res = 1.0; var t = 0.02;
    for (var i = 0; i < 32; i++) {
        let d = map_turned_bowl(p + l * t);
        res = min(res, 6.0 * d / t);
        t += clamp(d, 0.02, 0.3);
        if (res < 0.005 || t > 4.0) { break; }
    }
    return clamp(res, 0.0, 1.0);
}
@fragment fn fs_turned_bowl(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_turned_bowl(ro, rd);
  if (h < 0.0) {
      if (rd.y < 0.0) {
          let pf = ro + rd * ((-0.63 - ro.y) / rd.y);
          let fsh = shd_turned_bowl(pf, normalize(KEY));
          let fo = ao_turned_bowl(pf, vec3f(0.0, 1.0, 0.0));
          return finish(stageFloor(rd, pf, fsh, fo), uv);
      }
      return finish(backdrop(rd), uv);
  }
  let p = ro + rd * h;
  let n = nrm_turned_bowl(p);
  let occ = ao_turned_bowl(p, n);
  let sh = shd_turned_bowl(p + n * 0.012, normalize(KEY));
  let q = bowlLocal(p);
  let warp = fbm3(q * vec3f(1.2, 3.0, 3.0), 3);
  let ring = length(q.yz - vec2f(-1.9, 0.2)) * mix(8.0, 22.0, k.x) + warp * 2.5;
  let band = smoothstep(0.2, 0.9, fract(ring)) * smoothstep(1.0, 0.85, fract(ring));
  let pores = smoothstep(0.55, 0.8, gnoise(q * vec3f(4.0, 90.0, 90.0)));
  var alb = mix(vec3f(0.62, 0.38, 0.19), vec3f(0.36, 0.18, 0.07), band);
  alb *= 1.0 - 0.3 * pores;
  return finish(dielectric(rd, n, alb, mix(0.6, 0.12, k.y), occ, sh), uv);
}

// ── marble_pair (materials) ──
fn marbleLocal(p0: vec3f) -> vec3f { return rotY(u.time * 0.25 + 0.7) * p0; }
fn marbleParts(p0: vec3f) -> vec2f {
    let p = marbleLocal(p0);
    return vec2f(rbox(p - vec3f(0.0, -0.45, 0.0), vec3f(0.56, 0.52, 0.56), 0.04), length(p - vec3f(0.0, 0.47, 0.0)) - 0.4);
}
fn map_marble_pair(p: vec3f) -> f32 { let d = marbleParts(p); return min(d.x, d.y); }
fn marbleVein(q: vec3f, f: f32) -> f32 {
    let tq = q + 0.9 * vec3f(fbm3(q * 1.3, 4), fbm3(q * 1.3 + 7.0, 4), fbm3(q * 1.3 + 13.0, 4));
    return pow(1.0 - abs(sin(dot(tq, vec3f(0.6, 1.0, 0.3)) * f)), 14.0);
}
// sphere trace map_marble_pair inside its bounding sphere; -1 on a miss
fn march_marble_pair(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_marble_pair(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_marble_pair(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_marble_pair
fn nrm_marble_pair(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_marble_pair(p + e.xyy) + e.yyx * map_marble_pair(p + e.yyx) + e.yxy * map_marble_pair(p + e.yxy) + e.xxx * map_marble_pair(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_marble_pair
fn ao_marble_pair(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_marble_pair(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
// soft shadow of map_marble_pair toward the light l (after Quilez)
fn shd_marble_pair(p: vec3f, l: vec3f) -> f32 {
    var res = 1.0; var t = 0.02;
    for (var i = 0; i < 32; i++) {
        let d = map_marble_pair(p + l * t);
        res = min(res, 6.0 * d / t);
        t += clamp(d, 0.02, 0.3);
        if (res < 0.005 || t > 4.0) { break; }
    }
    return clamp(res, 0.0, 1.0);
}
@fragment fn fs_marble_pair(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_marble_pair(ro, rd);
  if (h < 0.0) {
      if (rd.y < 0.0) {
          let pf = ro + rd * ((-0.97 - ro.y) / rd.y);
          let fsh = shd_marble_pair(pf, normalize(KEY));
          let fo = ao_marble_pair(pf, vec3f(0.0, 1.0, 0.0));
          return finish(stageFloor(rd, pf, fsh, fo), uv);
      }
      return finish(backdrop(rd), uv);
  }
  let p = ro + rd * h;
  let n = nrm_marble_pair(p);
  let occ = ao_marble_pair(p, n);
  let sh = shd_marble_pair(p + n * 0.012, normalize(KEY));
  let q = marbleLocal(p);
  let parts = marbleParts(p);
  let v1 = marbleVein(q, mix(2.0, 5.0, k.x));
  var alb: vec3f;
  if (parts.x < parts.y) {
      let v2 = marbleVein(q * 1.7 + 3.0, 3.0);
      alb = mix(vec3f(0.9, 0.89, 0.86), vec3f(0.36, 0.37, 0.4), v1 * 0.8);
      alb = mix(alb, vec3f(0.85, 0.6, 0.25), v2 * k.y);
  } else {
      alb = mix(vec3f(0.02, 0.2, 0.12), vec3f(0.8, 0.85, 0.8), v1);
  }
  return finish(dielectric(rd, n, alb, 0.03, occ, sh) + alb * 0.05 * occ, uv);
}

// ── ebony_pawn (lathe) ──
fn pawnProf(q: vec2f) -> f32 {
    var d = sdBox2(q - vec2f(0.0, -0.92), vec2f(0.46, 0.04)) - 0.04;
    d = smin(d, length(q - vec2f(0.38, -0.79)) - 0.07, 0.04);
    d = smin(d, sdTrap(q - vec2f(0.0, -0.32), 0.34, 0.13, 0.42), 0.08);
    d = smin(d, sdBox2(q - vec2f(0.0, 0.12), vec2f(0.24, 0.02)) - 0.025, 0.05);
    d = smin(d, length(q - vec2f(0.0, 0.42)) - 0.26, 0.06);
    return d;
}
fn pawnZ() -> f32 { return 0.5 * smoothstep(0.2, 0.8, 0.5 + 0.5 * sin(u.time * 0.8)) - 0.25; }
fn map_ebony_pawn(p: vec3f) -> f32 {
    let c = p - vec3f(0.0, 0.0, pawnZ());
    return pawnProf(vec2f(length(c.xz), c.y));
}
// an 8 x 8 board of 0.5 squares with a dark frame; plain floor past it
fn board(pf: vec3f) -> f32 {
    let c = floor(pf.xz / 0.5);
    let sq = select(0.42, 1.2, (i32(c.x + c.y) % 2 + 2) % 2 == 0);
    let e = max(abs(pf.x), abs(pf.z));
    return select(select(1.0, 0.25, e < 2.2), sq, e < 2.0);
}
// sphere trace map_ebony_pawn inside its bounding sphere; -1 on a miss
fn march_ebony_pawn(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.30);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_ebony_pawn(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_ebony_pawn(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_ebony_pawn
fn nrm_ebony_pawn(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_ebony_pawn(p + e.xyy) + e.yyx * map_ebony_pawn(p + e.yyx) + e.yxy * map_ebony_pawn(p + e.yxy) + e.xxx * map_ebony_pawn(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_ebony_pawn
fn ao_ebony_pawn(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_ebony_pawn(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
// soft shadow of map_ebony_pawn toward the light l (after Quilez)
fn shd_ebony_pawn(p: vec3f, l: vec3f) -> f32 {
    var res = 1.0; var t = 0.02;
    for (var i = 0; i < 32; i++) {
        let d = map_ebony_pawn(p + l * t);
        res = min(res, 6.0 * d / t);
        t += clamp(d, 0.02, 0.3);
        if (res < 0.005 || t > 4.0) { break; }
    }
    return clamp(res, 0.0, 1.0);
}
@fragment fn fs_ebony_pawn(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_ebony_pawn(ro, rd);
  if (h < 0.0) {
      if (rd.y < 0.0) {
          let pf = ro + rd * ((-1.0 - ro.y) / rd.y);
          let fsh = shd_ebony_pawn(pf, normalize(KEY));
          let fo = ao_ebony_pawn(pf, vec3f(0.0, 1.0, 0.0));
          return finish(stageFloor(rd, pf, fsh, fo) * board(pf), uv);
      }
      return finish(backdrop(rd), uv);
  }
  let p = ro + rd * h;
  let n = nrm_ebony_pawn(p);
  let occ = ao_ebony_pawn(p, n);
  let sh = shd_ebony_pawn(p + n * 0.012, normalize(KEY));
  let alb = vec3f(0.015, 0.012, 0.012);
  return finish(dielectric(rd, n, alb, mix(0.25, 0.0, k.y), occ, sh) * 1.2, uv);
}

// ── ivory_rook (lathe) ──
fn rookLocal(p0: vec3f) -> vec3f { return rotY(u.time * 0.4 + 0.3) * (p0 - vec3f(0.35 * sin(u.time * 0.5) - 0.1, 0.0, 0.0)); }
fn map_ivory_rook(p0: vec3f) -> f32 {
    let p = rookLocal(p0);
    let q = vec2f(length(p.xz), p.y);
    var d = sdBox2(q - vec2f(0.0, -0.92), vec2f(0.44, 0.04)) - 0.04;
    d = smin(d, length(q - vec2f(0.37, -0.79)) - 0.065, 0.04);
    d = smin(d, sdTrap(q - vec2f(0.0, -0.3), 0.33, 0.24, 0.42), 0.08);
    d = smin(d, sdBox2(q - vec2f(0.0, 0.14), vec2f(0.32, 0.025)) - 0.02, 0.04);
    d = smin(d, sdBox2(q - vec2f(0.0, 0.42), vec2f(0.3, 0.26)) - 0.02, 0.06);
    d = max(d, -(sdBox2(q - vec2f(0.0, 0.7), vec2f(0.21, 0.12))));
    let pm = pmod(p.xz, floor(mix(4.0, 8.0, u.k.x)) );
    let notch = sdBox2(vec2f(pm.y, p.y - 0.7), vec2f(0.06, 0.12));
    d = max(d, -notch);
    return d;
}
// sphere trace map_ivory_rook inside its bounding sphere; -1 on a miss
fn march_ivory_rook(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.35);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_ivory_rook(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_ivory_rook(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_ivory_rook
fn nrm_ivory_rook(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_ivory_rook(p + e.xyy) + e.yyx * map_ivory_rook(p + e.yyx) + e.yxy * map_ivory_rook(p + e.yxy) + e.xxx * map_ivory_rook(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_ivory_rook
fn ao_ivory_rook(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_ivory_rook(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
// soft shadow of map_ivory_rook toward the light l (after Quilez)
fn shd_ivory_rook(p: vec3f, l: vec3f) -> f32 {
    var res = 1.0; var t = 0.02;
    for (var i = 0; i < 32; i++) {
        let d = map_ivory_rook(p + l * t);
        res = min(res, 6.0 * d / t);
        t += clamp(d, 0.02, 0.3);
        if (res < 0.005 || t > 4.0) { break; }
    }
    return clamp(res, 0.0, 1.0);
}
@fragment fn fs_ivory_rook(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_ivory_rook(ro, rd);
  if (h < 0.0) {
      if (rd.y < 0.0) {
          let pf = ro + rd * ((-1.0 - ro.y) / rd.y);
          let fsh = shd_ivory_rook(pf, normalize(KEY));
          let fo = ao_ivory_rook(pf, vec3f(0.0, 1.0, 0.0));
          return finish(stageFloor(rd, pf, fsh, fo) * board(pf), uv);
      }
      return finish(backdrop(rd), uv);
  }
  let p = ro + rd * h;
  let n = nrm_ivory_rook(p);
  let occ = ao_ivory_rook(p, n);
  let sh = shd_ivory_rook(p + n * 0.012, normalize(KEY));
  let q = rookLocal(p);
  let grain = 0.94 + 0.06 * sin(q.y * 120.0 + gnoise(q * 6.0) * 4.0);
  let alb = mix(vec3f(0.86, 0.82, 0.7), vec3f(0.92, 0.78, 0.55), k.y) * grain;
  let ci = clamp(-dot(rd, n), 0.0, 1.0);
  let glow = vec3f(0.9, 0.6, 0.35) * 0.08 * pow(1.0 - ci, 2.0);
  return finish(dielectric(rd, n, alb, 0.12, occ, sh) + glow * occ, uv);
}

// ── wine_glass (lathe) ──
fn wgLevel(p: vec3f) -> f32 { return mix(-0.25, 0.25, u.k.x) + mix(0.0, 0.1, u.k.y) * sin(u.time * 1.6) * (p.x * 0.8 + p.z * 0.3); }
fn map_wg_glass(p0: vec3f) -> f32 {
    let p = rotY(u.time * 0.2) * p0;
    let q = vec2f(length(p.xz), p.y);
    let e = (length(vec2f(q.x / 0.46, (q.y - 0.18) / 0.62)) - 1.0) * 0.46;
    var d = max(abs(e) - 0.011, q.y - 0.62);
    d = min(d, sdBox2(q - vec2f(0.0, -0.955), vec2f(0.4, 0.008)) - 0.01);
    d = smin(d, sdTrap(q - vec2f(0.0, -0.68), 0.05, 0.03, 0.27), 0.06);
    return d;
}
fn map_wg_wine(p0: vec3f) -> f32 {
    let p = rotY(u.time * 0.2) * p0;
    let q = vec2f(length(p.xz), p.y);
    let e = (length(vec2f(q.x / 0.46, (q.y - 0.18) / 0.62)) - 1.0) * 0.46;
    return max(e + 0.013, p.y - wgLevel(p));
}
fn map_wine_glass(p: vec3f) -> f32 { return min(map_wg_glass(p), map_wg_wine(p)); }
// tetrahedron normal of map_wg_glass
fn nrm_wg_glass(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_wg_glass(p + e.xyy) + e.yyx * map_wg_glass(p + e.yyx) + e.yxy * map_wg_glass(p + e.yxy) + e.xxx * map_wg_glass(p + e.xxx));
}
// path length from an inside point p along rd to the far wall of map_wg_glass
fn thru_wg_glass(p: vec3f, rd: vec3f) -> f32 {
    var t = 0.01;
    for (var i = 0; i < 40; i++) {
        let d = -map_wg_glass(p + rd * t);
        if (d < 0.0008) { break; }
        t += max(d, 0.002);
    }
    return t;
}
// tetrahedron normal of map_wg_wine
fn nrm_wg_wine(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_wg_wine(p + e.xyy) + e.yyx * map_wg_wine(p + e.yyx) + e.yxy * map_wg_wine(p + e.yxy) + e.xxx * map_wg_wine(p + e.xxx));
}
// path length from an inside point p along rd to the far wall of map_wg_wine
fn thru_wg_wine(p: vec3f, rd: vec3f) -> f32 {
    var t = 0.01;
    for (var i = 0; i < 40; i++) {
        let d = -map_wg_wine(p + rd * t);
        if (d < 0.0008) { break; }
        t += max(d, 0.002);
    }
    return t;
}
// sphere trace map_wine_glass inside its bounding sphere; -1 on a miss
fn march_wine_glass(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.15);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_wine_glass(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_wine_glass(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_wine_glass
fn nrm_wine_glass(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_wine_glass(p + e.xyy) + e.yyx * map_wine_glass(p + e.yyx) + e.yxy * map_wine_glass(p + e.yxy) + e.xxx * map_wine_glass(p + e.xxx));
}
// soft shadow of map_wine_glass toward the light l (after Quilez)
fn shd_wine_glass(p: vec3f, l: vec3f) -> f32 {
    var res = 1.0; var t = 0.02;
    for (var i = 0; i < 32; i++) {
        let d = map_wine_glass(p + l * t);
        res = min(res, 6.0 * d / t);
        t += clamp(d, 0.02, 0.3);
        if (res < 0.005 || t > 4.0) { break; }
    }
    return clamp(res, 0.0, 1.0);
}
@fragment fn fs_wine_glass(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  var pos = ro; var dir = rd;
  var thr = vec3f(1.0); var col = vec3f(0.0);
  var done = false; var first = true;
  for (var b = 0; b < 5; b++) {
      let h = march_wine_glass(pos, dir);
      if (h < 0.0) { break; }
      let p = pos + dir * h;
      let n = nrm_wine_glass(p);
      if (map_wg_glass(p) < map_wg_wine(p)) {
          let fr = schlick(abs(dot(dir, n)), 0.04);
          col += thr * envT(reflect(dir, n)) * max(fr, 0.05) * 1.3;
          thr *= (1.0 - fr) * vec3f(0.97, 0.985, 0.98);
          let din = refract(dir, n, 1.0 / 1.5);
          let pin = p - n * 0.003;
          let L = thru_wg_glass(pin, din);
          let pe = pin + din * L;
          let ne = -nrm_wg_glass(pe);
          var dout = refract(din, ne, 1.5);
          if (dot(dout, dout) == 0.0) { dout = reflect(din, ne); }
          dir = dout; pos = pe + dir * 0.004;
      } else {
          let fr = schlick(abs(dot(dir, n)), 0.02);
          col += thr * envT(reflect(dir, n)) * fr;
          thr *= 1.0 - fr;
          let din = refract(dir, n, 1.0 / 1.34);
          let pin = p - n * 0.003;
          let L = thru_wg_wine(pin, din);
          thr *= exp(-vec3f(2.6, 34.0, 24.0) * L);
          col += thr * vec3f(0.5, 0.03, 0.06) * 0.25;
          let pe = pin + din * L;
          let ne = -nrm_wg_wine(pe);
          var dout = refract(din, ne, 1.34);
          if (dot(dout, dout) == 0.0) { dout = reflect(din, ne); }
          dir = dout; pos = pe + dir * 0.004;
          if (done) { break; }
      }
      first = false;
  }
  if (!done) {
      if (dir.y < 0.0) {
          let pf = pos + dir * ((-0.97 - pos.y) / dir.y);
          let fsh = shd_wine_glass(pf, normalize(KEY));
          col += thr * stageFloor(dir, pf, mix(0.55, 1.0, fsh), 1.0);
      } else {
          col += thr * select(envT(dir), backdrop(dir), first);
      }
  }
  if (first && rd.y < 0.0) {
      let pf = ro + rd * ((-0.97 - ro.y) / rd.y);
      let cq = pf.xz - vec2f(0.95, -0.7);
      col += (vec3f(0.9, 0.12, 0.15) * 0.5 * exp(-dot(cq, cq) * 6.0) + cCream() * 0.5 * exp(-dot(cq, cq) * 40.0)) * u.studio;
  }
  return finish(col, uv);
}

// ── hourglass (lathe) ──
fn hgF() -> f32 { return fract(u.time * mix(0.02, 0.1, u.k.x) + 0.45); }
fn hgInner(p: vec3f) -> f32 {
    let a = sdEllipsoid(p - vec3f(0.0, 0.39, 0.0), vec3f(0.4, 0.38, 0.4));
    let b = sdEllipsoid(p + vec3f(0.0, 0.39, 0.0), vec3f(0.4, 0.38, 0.4));
    return smin(a, b, 0.1);
}
fn map_hg_glass(p: vec3f) -> f32 { return max(abs(hgInner(p)) - 0.012, abs(p.y) - 0.76); }
fn hgParts(p: vec3f) -> vec3f {
    let f = hgF();
    let r = length(p.xz);
    let inner = hgInner(p) + 0.014;
    let lt = mix(0.62, 0.04, f);
    let top = max(inner, max(p.y - lt - 0.25 * r + 0.1 * (1.0 - f), 0.02 - p.y));
    let lb = mix(-0.78, -0.24, sqrt(f));
    let bot = max(inner, p.y - lb + 0.55 * r);
    let stream = max(length(p.xz) - 0.012 * step(f, 0.98), abs(p.y - 0.5 * lb) - max(-0.5 * lb, 0.0));
    let sand = min(min(top, bot), stream);
    let discs = sdCyl(vec3f(p.x, abs(p.y) - 0.82, p.z), 0.05, 0.56) - 0.012;
    let pm = pmod(p.xz, 3.0);
    let posts = sdCyl(vec3f(pm.x - 0.48, p.y, pm.y), 0.8, 0.032);
    return vec3f(sand, discs, posts);
}
// sand, discs and posts turn with the frame; the glass is round and needs no turn
fn hgContent(p0: vec3f) -> f32 { let s = hgParts(rotY(u.time * 0.2 + 0.3) * p0); return min(s.x, min(s.y, s.z)); }
fn map_hourglass(p0: vec3f) -> f32 { return min(map_hg_glass(p0), hgContent(p0)); }
// tetrahedron normal of map_hg_glass
fn nrm_hg_glass(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_hg_glass(p + e.xyy) + e.yyx * map_hg_glass(p + e.yyx) + e.yxy * map_hg_glass(p + e.yxy) + e.xxx * map_hg_glass(p + e.xxx));
}
// path length from an inside point p along rd to the far wall of map_hg_glass
fn thru_hg_glass(p: vec3f, rd: vec3f) -> f32 {
    var t = 0.01;
    for (var i = 0; i < 40; i++) {
        let d = -map_hg_glass(p + rd * t);
        if (d < 0.0008) { break; }
        t += max(d, 0.002);
    }
    return t;
}
// sphere trace map_hourglass inside its bounding sphere; -1 on a miss
fn march_hourglass(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.25);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_hourglass(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_hourglass(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_hourglass
fn nrm_hourglass(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_hourglass(p + e.xyy) + e.yyx * map_hourglass(p + e.yyx) + e.yxy * map_hourglass(p + e.yxy) + e.xxx * map_hourglass(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_hourglass
fn ao_hourglass(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_hourglass(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
// soft shadow of map_hourglass toward the light l (after Quilez)
fn shd_hourglass(p: vec3f, l: vec3f) -> f32 {
    var res = 1.0; var t = 0.02;
    for (var i = 0; i < 32; i++) {
        let d = map_hourglass(p + l * t);
        res = min(res, 6.0 * d / t);
        t += clamp(d, 0.02, 0.3);
        if (res < 0.005 || t > 4.0) { break; }
    }
    return clamp(res, 0.0, 1.0);
}
@fragment fn fs_hourglass(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  var pos = ro; var dir = rd;
  var thr = vec3f(1.0); var col = vec3f(0.0);
  var done = false; var first = true;
  for (var b = 0; b < 5; b++) {
      let h = march_hourglass(pos, dir);
      if (h < 0.0) { break; }
      let p = pos + dir * h;
      let n = nrm_hourglass(p);
      if (map_hg_glass(p) < hgContent(p)) {
          let fr = schlick(abs(dot(dir, n)), 0.04);
          col += thr * envT(reflect(dir, n)) * max(fr, 0.05) * 1.3;
          thr *= (1.0 - fr) * vec3f(0.97, 0.985, 0.98);
          let din = refract(dir, n, 1.0 / 1.5);
          let pin = p - n * 0.003;
          let L = thru_hg_glass(pin, din);
          let pe = pin + din * L;
          let ne = -nrm_hg_glass(pe);
          var dout = refract(din, ne, 1.5);
          if (dot(dout, dout) == 0.0) { dout = reflect(din, ne); }
          dir = dout; pos = pe + dir * 0.004;
      } else {
          let q = rotY(t * 0.2 + 0.3) * p;
          let s = hgParts(q);
          let ci = clamp(-dot(dir, n), 0.0, 1.0);
          if (s.x < min(s.y, s.z)) {
              let grain = 0.8 + 0.4 * hash3(q * 400.0).x;
              let sand = mix(vec3f(0.9, 0.72, 0.45), cCream(), 0.15) * mix(0.7, 1.2, k.y) * grain;
              col += thr * envDiff(n) * sand * 0.85 * ao_hourglass(p, n);
          } else if (s.y < s.z) {
              let g = fbm3(q * vec3f(2.0, 30.0, 2.0), 2);
              let wood = mix(vec3f(0.3, 0.15, 0.07), vec3f(0.5, 0.28, 0.12), 0.5 + 0.5 * sin(length(q.xz) * 60.0 + g * 6.0));
              col += thr * dielectric(dir, n, wood, 0.2, ao_hourglass(p, n), 1.0);
          } else {
              col += thr * metal(dir, n, vec3f(1.0, 0.76, 0.42), 0.15, ao_hourglass(p, n));
          }
          done = true;
          if (done) { break; }
      }
      first = false;
  }
  if (!done) {
      if (dir.y < 0.0) {
          let pf = pos + dir * ((-0.88 - pos.y) / dir.y);
          let fsh = shd_hourglass(pf, normalize(KEY));
          col += thr * stageFloor(dir, pf, mix(0.55, 1.0, fsh), 1.0);
      } else {
          col += thr * select(envT(dir), backdrop(dir), first);
      }
  }
  return finish(col, uv);
}

// ── teacup (lathe) ──
fn cupLocal(p0: vec3f) -> vec3f { return rotY(u.time * 0.3 + 2.2) * p0 / 0.88; }
fn cupParts(p0: vec3f) -> vec3f {
    let p = cupLocal(p0);
    let q = vec2f(length(p.xz), p.y);
    let saucer = min(sdSeg2(q, vec2f(0.0, -0.575), vec2f(0.55, -0.565)), sdSeg2(q, vec2f(0.55, -0.565), vec2f(0.95, -0.47))) - 0.022;
    var cup = min(min(sdSeg2(q, vec2f(0.0, -0.5), vec2f(0.26, -0.5)), sdSeg2(q, vec2f(0.26, -0.5), vec2f(0.42, -0.38))),
                  min(sdSeg2(q, vec2f(0.42, -0.38), vec2f(0.53, -0.12)), sdSeg2(q, vec2f(0.53, -0.12), vec2f(0.57, 0.12)))) - 0.022;
    cup = min(cup, sdCyl(p - vec3f(0.0, -0.53, 0.0), 0.03, 0.2));
    let hq = vec2f(length(vec2f(p.x - 0.6, p.y + 0.15)) - 0.16, p.z);
    let handle = max(length(hq) - 0.035, 0.53 - p.x);
    cup = smin(cup, handle, 0.03);
    let y = p.y;
    let wr = select(select(0.53 + (y + 0.12) / 0.24 * 0.04, 0.42 + (y + 0.38) / 0.26 * 0.11, y < -0.12), 0.26 + (y + 0.5) / 0.12 * 0.16, y < -0.38);
    let tea = max(max(p.y + 0.005, -0.47 - p.y), (q.x - wr + 0.022) * 0.8);
    return vec3f(saucer, cup, tea);
}
fn map_teacup(p: vec3f) -> f32 { let d = cupParts(p); return min(min(d.x, d.y), d.z) * 0.88; }
// steam: three twisting wisps of fbm above the cup, gathered in 12 steps
fn cupSteam(ro: vec3f, rd: vec3f, tmax: f32) -> f32 {
    let hs = sphHit(ro - vec3f(0.0, 0.55, 0.0), rd, 0.55);
    if (hs.y < 0.0) { return 0.0; }
    let t0 = max(hs.x, 0.0); let t1 = min(hs.y, tmax);
    if (t1 <= t0) { return 0.0; }
    let dt = (t1 - t0) / 12.0;
    var acc = 0.0;
    for (var i = 0; i < 12; i++) {
        let q = ro + rd * (t0 + dt * (f32(i) + 0.5));
        let w = rotY(q.y * 2.5 - u.time * 0.6) * (q - vec3f(0.0, 0.0, 0.0));
        let n = fbm3(vec3f(w.x * 3.0, q.y * 2.0 - u.time * 0.7, w.z * 3.0), 3);
        let col = smoothstep(0.38, 0.0, length(q.xz) - 0.08 * q.y) * smoothstep(0.02, 0.2, q.y) * smoothstep(1.1, 0.5, q.y);
        acc += max(n + 0.05, 0.0) * col * dt * 6.0;
    }
    return acc;
}
// sphere trace map_teacup inside its bounding sphere; -1 on a miss
fn march_teacup(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.25);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_teacup(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_teacup(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_teacup
fn nrm_teacup(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_teacup(p + e.xyy) + e.yyx * map_teacup(p + e.yyx) + e.yxy * map_teacup(p + e.yxy) + e.xxx * map_teacup(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_teacup
fn ao_teacup(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_teacup(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
// soft shadow of map_teacup toward the light l (after Quilez)
fn shd_teacup(p: vec3f, l: vec3f) -> f32 {
    var res = 1.0; var t = 0.02;
    for (var i = 0; i < 32; i++) {
        let d = map_teacup(p + l * t);
        res = min(res, 6.0 * d / t);
        t += clamp(d, 0.02, 0.3);
        if (res < 0.005 || t > 4.0) { break; }
    }
    return clamp(res, 0.0, 1.0);
}
@fragment fn fs_teacup(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let stc = cCream() * 0.9 * mix(0.0, 1.6, k.x);
  let h = march_teacup(ro, rd);
  if (h < 0.0) {
      if (rd.y < 0.0) {
          let pf = ro + rd * ((-0.527 - ro.y) / rd.y);
          let fsh = shd_teacup(pf, normalize(KEY));
          let fo = ao_teacup(pf, vec3f(0.0, 1.0, 0.0));
          return finish(stageFloor(rd, pf, fsh, fo) + stc * cupSteam(ro, rd, 1e5), uv);
      }
      return finish(backdrop(rd) + stc * cupSteam(ro, rd, 1e5), uv);
  }
  let p = ro + rd * h;
  let n = nrm_teacup(p);
  let occ = ao_teacup(p, n);
  let sh = shd_teacup(p + n * 0.012, normalize(KEY));
  let parts = cupParts(p);
  let q = cupLocal(p);
  let r = length(q.xz);
  var c: vec3f;
  if (parts.z < min(parts.x, parts.y)) {
      let nn = normalize(n + 0.04 * vec3f(sin(r * 60.0 - t * 4.0), 0.0, cos(r * 60.0 - t * 4.0)) * smoothstep(0.5, 0.2, r));
      c = dielectric(rd, nn, vec3f(0.22, 0.08, 0.015), 0.02, occ, sh);
  } else {
      var alb = vec3f(0.93, 0.92, 0.9);
      var gold = 0.0;
      if (parts.y < parts.x) {
          gold = step(0.1, q.y) * step(r, 0.62);
          let bandY = abs(q.y + 0.2) < 0.06 && r > 0.45;
          let scal = smoothstep(0.02, 0.0, abs(fract(atan2(q.z, q.x) * 18.0 / TAU) - 0.5) * 0.12 - abs(q.y + 0.2) + 0.03);
          if (bandY) { alb = mix(alb, vec3f(0.06, 0.15, 0.62), mix(0.0, 1.0, k.y) * max(scal, 0.4)); }
      } else {
          gold = smoothstep(0.88, 0.92, r);
      }
      c = mix(dielectric(rd, n, alb, 0.06, occ, sh), metal(rd, n, vec3f(1.0, 0.77, 0.4), 0.15, occ), gold);
  }
  return finish(c + stc * cupSteam(ro, rd, h), uv);
}

// ── bowling_pin (lathe) ──
fn pinLocal(p0: vec3f) -> vec3f {
    let a = mix(0.0, 0.2, u.k.x) * sin(u.time * 2.2);
    let piv = vec3f(-0.35 + 0.14 * sign(a), -1.0, 0.0);
    let q = p0 - piv;
    let xy = rot2(-a) * q.xy;
    return vec3f(xy.x, xy.y, q.z) + piv - vec3f(-0.35, 0.0, 0.0);
}
fn pinParts(p0: vec3f) -> vec2f {
    let p = pinLocal(p0);
    var d = sdEllipsoid(p - vec3f(0.0, -0.48, 0.0), vec3f(0.29, 0.52, 0.29));
    d = smin(d, sdCapsule(p, vec3f(0.0, -0.2, 0.0), vec3f(0.0, 0.32, 0.0), 0.1), 0.28);
    d = smin(d, length(p - vec3f(0.0, 0.5, 0.0)) - 0.17, 0.14);
    d = max(d, -0.99 - p.y);
    let bc = vec3f(0.62, -0.58, 0.28);
    let ball = length(p0 - bc) - 0.42;
    return vec2f(d, ball);
}
fn map_bowling_pin(p: vec3f) -> f32 { let d = pinParts(p); return min(d.x, d.y); }
// sphere trace map_bowling_pin inside its bounding sphere; -1 on a miss
fn march_bowling_pin(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.30);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_bowling_pin(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_bowling_pin(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_bowling_pin
fn nrm_bowling_pin(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_bowling_pin(p + e.xyy) + e.yyx * map_bowling_pin(p + e.yyx) + e.yxy * map_bowling_pin(p + e.yxy) + e.xxx * map_bowling_pin(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_bowling_pin
fn ao_bowling_pin(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_bowling_pin(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
// soft shadow of map_bowling_pin toward the light l (after Quilez)
fn shd_bowling_pin(p: vec3f, l: vec3f) -> f32 {
    var res = 1.0; var t = 0.02;
    for (var i = 0; i < 32; i++) {
        let d = map_bowling_pin(p + l * t);
        res = min(res, 6.0 * d / t);
        t += clamp(d, 0.02, 0.3);
        if (res < 0.005 || t > 4.0) { break; }
    }
    return clamp(res, 0.0, 1.0);
}
@fragment fn fs_bowling_pin(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_bowling_pin(ro, rd);
  if (h < 0.0) {
      if (rd.y < 0.0) {
          let pf = ro + rd * ((-1.0 - ro.y) / rd.y);
          let fsh = shd_bowling_pin(pf, normalize(KEY));
          let fo = ao_bowling_pin(pf, vec3f(0.0, 1.0, 0.0));
          return finish(stageFloor(rd, pf, fsh, fo), uv);
      }
      return finish(backdrop(rd), uv);
  }
  let p = ro + rd * h;
  let n = nrm_bowling_pin(p);
  let occ = ao_bowling_pin(p, n);
  let sh = shd_bowling_pin(p + n * 0.012, normalize(KEY));
  let parts = pinParts(p);
  if (parts.y < parts.x) {
      let q = spin(p - vec3f(0.62, -0.58, 0.28), t * 0.5 + 0.3, 0.6);
      let sw = fbm3(q * 2.2 + mix(0.5, 2.5, k.y) * vec3f(fbm3(q * 1.5, 3), fbm3(q * 1.5 + 5.0, 3), 0.0), 4);
      let alb = mix(vec3f(0.12, 0.02, 0.3), mix(vec3f(0.8, 0.25, 0.9), vec3f(0.2, 0.7, 1.0), smoothstep(-0.2, 0.3, sw)), smoothstep(-0.25, 0.25, sw));
      let holes = smoothstep(0.065, 0.055, min(length(q - vec3f(0.0, 0.38, 0.17) * 1.05), min(length(q - vec3f(0.1, 0.4, 0.0)), length(q - vec3f(-0.1, 0.4, 0.0)))));
      return finish(dielectric(rd, n, alb * (1.0 - holes * 0.95), 0.03, occ, sh), uv);
  }
  let q = pinLocal(p);
  let stripe = (step(abs(q.y - 0.19), 0.03) + step(abs(q.y - 0.29), 0.03));
  let alb = mix(vec3f(0.94, 0.93, 0.9), vec3f(0.8, 0.04, 0.05), stripe);
  return finish(dielectric(rd, n, alb, 0.05, occ, sh), uv);
}

// ── spinning_top (lathe) ──
fn topLocal(p0: vec3f) -> vec3f {
    let t = u.time;
    let tilt = mix(0.05, 0.35, u.k.x) + 0.03 * sin(t * 5.0);
    let pr = rotY(t * 1.1 + 0.7) * (p0 - vec3f(0.0, -0.95, 0.0));
    let xy = rot2(tilt) * pr.xy;
    return rotY(t * mix(1.0, 9.0, u.k.y) + 0.4) * vec3f(xy.x, xy.y, pr.z);
}
fn map_spinning_top(p0: vec3f) -> f32 {
    let p = topLocal(p0);
    let q = vec2f(length(p.xz), p.y);
    var d = sdTrap(q - vec2f(0.0, 0.42), 0.015, 0.6, 0.4);
    d = smin(d, sdEllipsoid(p - vec3f(0.0, 0.82, 0.0), vec3f(0.6, 0.26, 0.6)), 0.05);
    d = smin(d, sdCapsule(p, vec3f(0.0, 0.9, 0.0), vec3f(0.0, 1.4, 0.0), 0.05), 0.06);
    d = smin(d, length(p - vec3f(0.0, 1.42, 0.0)) - 0.075, 0.03);
    return d;
}
// sphere trace map_spinning_top inside its bounding sphere; -1 on a miss
fn march_spinning_top(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.40);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_spinning_top(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_spinning_top(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_spinning_top
fn nrm_spinning_top(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_spinning_top(p + e.xyy) + e.yyx * map_spinning_top(p + e.yyx) + e.yxy * map_spinning_top(p + e.yxy) + e.xxx * map_spinning_top(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_spinning_top
fn ao_spinning_top(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_spinning_top(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
// soft shadow of map_spinning_top toward the light l (after Quilez)
fn shd_spinning_top(p: vec3f, l: vec3f) -> f32 {
    var res = 1.0; var t = 0.02;
    for (var i = 0; i < 32; i++) {
        let d = map_spinning_top(p + l * t);
        res = min(res, 6.0 * d / t);
        t += clamp(d, 0.02, 0.3);
        if (res < 0.005 || t > 4.0) { break; }
    }
    return clamp(res, 0.0, 1.0);
}
@fragment fn fs_spinning_top(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_spinning_top(ro, rd);
  if (h < 0.0) {
      if (rd.y < 0.0) {
          let pf = ro + rd * ((-0.95 - ro.y) / rd.y);
          let fsh = shd_spinning_top(pf, normalize(KEY));
          let fo = ao_spinning_top(pf, vec3f(0.0, 1.0, 0.0));
          return finish(stageFloor(rd, pf, fsh, fo), uv);
      }
      return finish(backdrop(rd), uv);
  }
  let p = ro + rd * h;
  let n = nrm_spinning_top(p);
  let occ = ao_spinning_top(p, n);
  let sh = shd_spinning_top(p + n * 0.012, normalize(KEY));
  let q = topLocal(p);
  let r = length(q.xz);
  let a = atan2(q.z, q.x);
  let sp = fract(a / TAU * 3.0 + r * 2.2 - q.y * 0.6);
  let band = floor(sp * 3.0);
  var alb = select(select(vec3f(0.05, 0.45, 0.5), vec3f(0.95, 0.88, 0.72), band > 0.5), vec3f(0.8, 0.08, 0.06), band > 1.5);
  if (q.y > 1.0 || q.y < 0.12) { alb = vec3f(0.62, 0.42, 0.22) * (0.9 + 0.1 * sin(q.y * 140.0)); }
  let rim = smoothstep(0.012, 0.0, abs(q.y - 0.82)) * step(0.5, r);
  alb = mix(alb, vec3f(0.9, 0.7, 0.3), rim);
  return finish(dielectric(rd, n, alb, 0.05, occ, sh), uv);
}

// ── borromean (mechanisms) ──
fn borRing(q: vec3f, h: f32, r: f32) -> f32 {
    let e = vec3f(q.x - clamp(q.x, -h, h), q.y, q.z);
    return length(vec2f(length(e.xz) - 0.3, e.y)) - r;
}
fn borLocal(p0: vec3f) -> vec3f { return spin(p0, u.time * 0.3 + 0.62, 0.55 + 0.25 * sin(u.time * 0.23)); }
fn borParts(p0: vec3f) -> vec3f {
    let p = borLocal(p0);
    let h = mix(0.38, 0.6, u.k.y); let r = mix(0.05, 0.11, u.k.x);
    return vec3f(borRing(vec3f(p.x, p.z, p.y), h, r), borRing(vec3f(p.y, p.x, p.z), h, r), borRing(vec3f(p.z, p.y, p.x), h, r));
}
fn map_borromean(p: vec3f) -> f32 { let d = borParts(p); return min(d.x, min(d.y, d.z)); }
// sphere trace map_borromean inside its bounding sphere; -1 on a miss
fn march_borromean(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_borromean(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_borromean(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_borromean
fn nrm_borromean(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_borromean(p + e.xyy) + e.yyx * map_borromean(p + e.yyx) + e.yxy * map_borromean(p + e.yxy) + e.xxx * map_borromean(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_borromean
fn ao_borromean(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_borromean(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_borromean(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_borromean(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_borromean(p);
  let occ = ao_borromean(p, n);
  let d = borParts(p);
  var tint = vec3f(1.0, 0.76, 0.38);
  if (d.y < d.x && d.y < d.z) { tint = vec3f(0.92, 0.93, 0.96); }
  if (d.z < d.x && d.z < d.y) { tint = vec3f(0.98, 0.55, 0.42); }
  return finish(metal(rd, n, tint, 0.1, occ), uv);
}

// ── gear_train (mechanisms) ──
fn gear2(p: vec2f, n: f32, r: f32) -> f32 {
    let s = TAU / n;
    let b = (fract(atan2(p.y, p.x) / s + 0.5) - 0.5) * s;
    let q = length(p) * vec2f(cos(b), sin(b));
    let tooth = sdTrap(vec2f(q.y, q.x - r - 0.005), 0.062, 0.03, 0.05) - 0.006;
    var d = min(length(p) - (r - 0.035), tooth);
    let pm = pmod(p, 5.0);
    d = max(d, -(length(pm - vec2f(r * 0.56, 0.0)) - r * 0.2));
    d = max(d, -(length(p) - 0.05));
    return d;
}
fn gearM() -> mat3x3f { return rotX(-0.35 + mix(-0.3, 0.3, u.k.y)) * rotY(0.42 + 0.12 * sin(u.time * 0.3)); }
fn gearAng(i: i32) -> f32 {
    let tA = u.time * mix(0.2, 1.4, u.k.x) + 0.2;
    let fAB = -0.5; let fBC = 0.95;
    let tB = -(14.0 / 9.0) * tA + fAB * (1.0 + 14.0 / 9.0) + PI + PI / 9.0;
    let tC = -(9.0 / 7.0) * tB + fBC * (1.0 + 9.0 / 7.0) + PI + PI / 7.0;
    return select(select(tC, tB, i == 1), tA, i == 0);
}
fn gearParts(p0: vec3f) -> vec4f {
    let p = gearM() * p0;
    let cA = vec2f(-0.42, 0.2);
    let cB = cA + 0.92 * vec2f(cos(-0.5), sin(-0.5));
    let cC = cB + 0.64 * vec2f(cos(0.95), sin(0.95));
    let gA = extrude(gear2(rot2(-gearAng(0)) * (p.xy - cA), 14.0, 0.56) + 0.012, p.z, 0.055) - 0.012;
    let gB = extrude(gear2(rot2(-gearAng(1)) * (p.xy - cB), 9.0, 0.36) + 0.012, p.z, 0.055) - 0.012;
    let gC = extrude(gear2(rot2(-gearAng(2)) * (p.xy - cC), 7.0, 0.28) + 0.012, p.z, 0.055) - 0.012;
    let ax = min(min(length(p.xy - cA), length(p.xy - cB)), length(p.xy - cC));
    let axle = extrude(ax - 0.05, p.z + 0.06, 0.14) - 0.005;
    let plate = rbox(p - vec3f(0.12, 0.05, -0.22), vec3f(1.15, 0.95, 0.04), 0.04);
    return vec4f(gA, gB, gC, min(axle, plate));
}
fn map_gear_train(p: vec3f) -> f32 { let d = gearParts(p); return min(min(d.x, d.y), min(d.z, d.w)); }
// sphere trace map_gear_train inside its bounding sphere; -1 on a miss
fn march_gear_train(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_gear_train(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_gear_train(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_gear_train
fn nrm_gear_train(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_gear_train(p + e.xyy) + e.yyx * map_gear_train(p + e.yyx) + e.yxy * map_gear_train(p + e.yxy) + e.xxx * map_gear_train(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_gear_train
fn ao_gear_train(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_gear_train(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_gear_train(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_gear_train(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_gear_train(p);
  let occ = ao_gear_train(p, n);
  let d = gearParts(p);
  let m = min(min(d.x, d.y), min(d.z, d.w));
  if (d.x == m) { return finish(metal(rd, n, vec3f(1.0, 0.78, 0.42), 0.14, occ), uv); }
  if (d.y == m) { return finish(metal(rd, n, vec3f(0.86, 0.88, 0.92), 0.08, occ), uv); }
  if (d.z == m) { return finish(metal(rd, n, vec3f(0.98, 0.56, 0.4), 0.14, occ), uv); }
  let q = gearM() * p;
  let brushed = 0.9 + 0.1 * sin(q.x * 300.0 + gnoise(q * 8.0) * 3.0);
  return finish(dielectric(rd, n, vec3f(0.05, 0.06, 0.08) * brushed, 0.35, occ, 1.0), uv);
}

// ── ball_bearing (mechanisms) ──
fn brgM() -> mat3x3f { return rotX(-mix(0.6, 1.2, u.k.y)) * rotY(0.3); }
fn brgParts(p0: vec3f) -> vec4f {
    let p = brgM() * p0;
    let ti = u.time * mix(0.3, 2.0, u.k.x);
    let r = length(p.xz);
    let groove = length(vec2f(r - 0.62, p.y)) - 0.128;
    let outer = max(sdBox2(vec2f(r - 0.85, p.y), vec2f(0.13, 0.15)) - 0.02, -groove);
    let inner = max(sdBox2(vec2f(r - 0.45, p.y), vec2f(0.09, 0.15)) - 0.02, -groove);
    let pc = rotY(ti * 0.4) * p;
    let pm = pmod(pc.xz, 10.0);
    let ball = length(vec3f(pm.x - 0.62, p.y, pm.y)) - 0.12;
    let cage = max(max(abs(r - 0.62) - 0.014, abs(p.y) - 0.07), -(length(vec3f(pm.x - 0.62, p.y, pm.y)) - 0.135));
    let pi = rotY(ti) * p;
    let shaft = max(r - 0.335, abs(p.y) - 0.45);
    let key = sdBox2(vec2f(pi.x - 0.33, pi.z), vec2f(0.04, 0.035));
    return vec4f(min(outer, inner), ball, cage, max(shaft, -key));
}
fn map_ball_bearing(p: vec3f) -> f32 { let d = brgParts(p); return min(min(d.x, d.y), min(d.z, d.w)); }
// sphere trace map_ball_bearing inside its bounding sphere; -1 on a miss
fn march_ball_bearing(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_ball_bearing(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_ball_bearing(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_ball_bearing
fn nrm_ball_bearing(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_ball_bearing(p + e.xyy) + e.yyx * map_ball_bearing(p + e.yyx) + e.yxy * map_ball_bearing(p + e.yxy) + e.xxx * map_ball_bearing(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_ball_bearing
fn ao_ball_bearing(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_ball_bearing(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_ball_bearing(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_ball_bearing(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_ball_bearing(p);
  let occ = ao_ball_bearing(p, n);
  let d = brgParts(p);
  let m = min(min(d.x, d.y), min(d.z, d.w));
  if (d.y == m) { return finish(metal(rd, n, vec3f(0.95, 0.96, 0.98), 0.02, occ), uv); }
  if (d.z == m) { return finish(metal(rd, n, vec3f(1.0, 0.74, 0.4), 0.2, occ), uv); }
  if (d.w == m) { return finish(metal(rd, n, vec3f(0.28, 0.3, 0.34), 0.3, occ), uv); }
  let q = brgM() * p;
  let lap = 0.92 + 0.08 * sin(length(q.xz) * 500.0);
  return finish(metal(rd, n, vec3f(0.8, 0.82, 0.86) * lap, 0.1, occ), uv);
}

// ── newton_cradle (mechanisms) ──
fn ncBall(i: i32) -> vec3f {
    let s = sin(u.time * mix(1.6, 3.4, u.k.y) + 1.2);
    let A = mix(0.25, 0.7, u.k.x);
    var a = 0.0;
    if (i == 0) { a = min(s, 0.0) * A; }
    if (i == 4) { a = max(s, 0.0) * A; }
    let px = (f32(i) - 2.0) * 0.34;
    return vec3f(px + 1.12 * sin(a), 0.82 - 1.12 * cos(a), 0.0);
}
fn ncParts(p0: vec3f) -> vec3f {
    let p = rotY(0.3 + 0.15 * sin(u.time * 0.2)) * (p0 - vec3f(0.1, 0.0, 0.0)) / 0.8;
    var balls = 1e5; var strings = 1e5;
    for (var i = 0; i < 5; i++) {
        let c = ncBall(i);
        balls = min(balls, length(p - c) - 0.17);
        let px = (f32(i) - 2.0) * 0.34;
        strings = min(strings, min(sdCapsule(p, c, vec3f(px, 0.82, 0.38), 0.006), sdCapsule(p, c, vec3f(px, 0.82, -0.38), 0.006)));
    }
    let bar = min(sdCapsule(vec3f(p.x, p.y, abs(p.z)), vec3f(-0.95, 0.84, 0.4), vec3f(0.95, 0.84, 0.4), 0.025),
                  sdCapsule(vec3f(abs(p.x), p.y, abs(p.z)), vec3f(0.95, 0.84, 0.4), vec3f(0.95, -1.06, 0.4), 0.025));
    let base = rbox(p - vec3f(0.0, -1.1, 0.0), vec3f(1.05, 0.04, 0.5), 0.03);
    return vec3f(balls, strings, min(bar, base)) * 0.8;
}
fn map_newton_cradle(p: vec3f) -> f32 { let d = ncParts(p); return min(d.x, min(d.y, d.z)); }
// sphere trace map_newton_cradle inside its bounding sphere; -1 on a miss
fn march_newton_cradle(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.45);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_newton_cradle(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_newton_cradle(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_newton_cradle
fn nrm_newton_cradle(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_newton_cradle(p + e.xyy) + e.yyx * map_newton_cradle(p + e.yyx) + e.yxy * map_newton_cradle(p + e.yxy) + e.xxx * map_newton_cradle(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_newton_cradle
fn ao_newton_cradle(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_newton_cradle(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
// soft shadow of map_newton_cradle toward the light l (after Quilez)
fn shd_newton_cradle(p: vec3f, l: vec3f) -> f32 {
    var res = 1.0; var t = 0.02;
    for (var i = 0; i < 32; i++) {
        let d = map_newton_cradle(p + l * t);
        res = min(res, 6.0 * d / t);
        t += clamp(d, 0.02, 0.3);
        if (res < 0.005 || t > 4.0) { break; }
    }
    return clamp(res, 0.0, 1.0);
}
@fragment fn fs_newton_cradle(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_newton_cradle(ro, rd);
  if (h < 0.0) {
      if (rd.y < 0.0) {
          let pf = ro + rd * ((-0.93 - ro.y) / rd.y);
          let fsh = shd_newton_cradle(pf, normalize(KEY));
          let fo = ao_newton_cradle(pf, vec3f(0.0, 1.0, 0.0));
          return finish(stageFloor(rd, pf, fsh, fo), uv);
      }
      return finish(backdrop(rd), uv);
  }
  let p = ro + rd * h;
  let n = nrm_newton_cradle(p);
  let occ = ao_newton_cradle(p, n);
  let sh = shd_newton_cradle(p + n * 0.012, normalize(KEY));
  let d = ncParts(p);
  if (d.x < d.y && d.x < d.z) { return finish(metal(rd, n, vec3f(0.94, 0.95, 0.97), 0.02, occ), uv); }
  if (d.y < d.z) { return finish(envDiff(n) * vec3f(0.85, 0.82, 0.75) * occ, uv); }
  return finish(dielectric(rd, n, vec3f(0.02), 0.08, occ, sh), uv);
}

// ── gimbal (mechanisms) ──
fn gbRing(q: vec3f, R: f32) -> f32 { return sdBox2(vec2f(length(q.xy) - R, q.z), vec2f(0.035, 0.07)) - 0.01; }
// the three pivot angles: outer ring about y, middle about x, inner about y
fn gbAng() -> vec3f {
    let t = u.time * mix(0.3, 1.5, u.k.x);
    return vec3f(t * 0.4 + 0.75, 0.9 * sin(t * 0.5) + 0.7, t * 0.7 + 1.1);
}
fn gbParts(p0: vec3f) -> vec4f {
    let a = gbAng();
    let p = rotX(0.2) * p0;
    let p1 = rotY(a.x) * p;
    let p2 = rotX(a.y) * p1;
    let p3 = rotY(a.z) * p2;
    let r1 = min(gbRing(p1, 0.9), length(vec3f(p1.x, abs(p1.y) - 0.96, p1.z)) - 0.04);
    let r2 = min(gbRing(p2, 0.72), length(vec3f(abs(p2.x) - 0.78, p2.y, p2.z)) - 0.04);
    let r3 = min(gbRing(p3, 0.54), length(vec3f(p3.x, abs(p3.y) - 0.6, p3.z)) - 0.035);
    let p4 = rotY(u.time * 6.0) * p3;
    let fly = min(sdCyl(p4, 0.05, 0.36) - 0.01, sdCyl(p4, 0.5, 0.025));
    let stand = min(sdCapsule(p0, vec3f(0.0, -1.0, 0.0), vec3f(0.0, -1.32, 0.0), 0.04), sdCyl(p0 - vec3f(0.0, -1.35, 0.0), 0.03, 0.4));
    return vec4f(min(r1, stand), r2, r3, fly);
}
fn map_gimbal(p: vec3f) -> f32 { let d = gbParts(p); return min(min(d.x, d.y), min(d.z, d.w)); }
// sphere trace map_gimbal inside its bounding sphere; -1 on a miss
fn march_gimbal(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_gimbal(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_gimbal(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_gimbal
fn nrm_gimbal(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_gimbal(p + e.xyy) + e.yyx * map_gimbal(p + e.yyx) + e.yxy * map_gimbal(p + e.yxy) + e.xxx * map_gimbal(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_gimbal
fn ao_gimbal(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_gimbal(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_gimbal(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_gimbal(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_gimbal(p);
  let occ = ao_gimbal(p, n);
  let d = gbParts(p);
  let m = min(min(d.x, d.y), min(d.z, d.w));
  let a = gbAng();
  let q0 = rotX(0.2) * p;
  var q = rotY(a.x) * q0;
  var tint = vec3f(1.0, 0.76, 0.4);
  if (d.y == m) { q = rotX(a.y) * q; tint = vec3f(0.88, 0.9, 0.94); }
  if (d.z == m) { q = rotY(a.z) * (rotX(a.y) * q); tint = vec3f(0.98, 0.56, 0.4); }
  if (d.w == m) {
      let q4 = rotY(t * 6.0) * (rotY(a.z) * (rotX(a.y) * q));
      let sp = step(0.5, fract(atan2(q4.z, q4.x) / TAU * 6.0));
      return finish(dielectric(rd, n, mix(vec3f(0.03), vec3f(0.9, 0.2, 0.1), sp * step(0.2, length(q4.xz))), 0.05, occ, 1.0), uv);
  }
  let ang = atan2(q.y, q.x) / TAU * 72.0;
  let tick = smoothstep(0.12, 0.0, abs(fract(ang) - 0.5) - 0.38) * step(0.03, abs(q.z) + 0.04) * mix(0.0, 1.0, k.y);
  return finish(metal(rd, n, tint * (1.0 - 0.8 * tick * step(0.065, abs(q.z) + 0.0001)), 0.14, occ) * (1.0 - 0.6 * tick), uv);
}

// ── puzzle_cube (mechanisms) ──
fn pcAng() -> f32 {
    let x = fract(u.time * 0.18 + 0.3);
    let tri = 1.0 - abs(2.0 * x - 1.0);
    return 1.5707963 * smoothstep(0.1, 0.9, tri) * select(1.0, -1.0, u.k.x > 0.5);
}
fn pcM() -> mat3x3f { return rotX(0.55) * rotY(u.time * 0.25 + 0.72); }
fn pcSet(p: vec3f, lo: vec3f, hi: vec3f) -> vec4f {
    let id = clamp(round(p / 0.5), lo, hi);
    return vec4f(rbox(p - id * 0.5, vec3f(0.235), mix(0.02, 0.09, u.k.y)), id);
}
fn map_puzzle_cube(p0: vec3f) -> f32 {
    let p = pcM() * p0;
    let top = pcSet(rotY(pcAng()) * p, vec3f(-1.0, 1.0, -1.0), vec3f(1.0)).x;
    let rest = pcSet(p, vec3f(-1.0), vec3f(1.0, 0.0, 1.0)).x;
    return min(top, rest);
}
// sphere trace map_puzzle_cube inside its bounding sphere; -1 on a miss
fn march_puzzle_cube(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_puzzle_cube(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_puzzle_cube(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_puzzle_cube
fn nrm_puzzle_cube(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_puzzle_cube(p + e.xyy) + e.yyx * map_puzzle_cube(p + e.yyx) + e.yxy * map_puzzle_cube(p + e.yxy) + e.xxx * map_puzzle_cube(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_puzzle_cube
fn ao_puzzle_cube(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_puzzle_cube(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_puzzle_cube(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_puzzle_cube(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_puzzle_cube(p);
  let occ = ao_puzzle_cube(p, n);
  let M = pcM();
  let pl = M * p;
  let R = rotY(pcAng());
  let a = pcSet(R * pl, vec3f(-1.0, 1.0, -1.0), vec3f(1.0));
  let b = pcSet(pl, vec3f(-1.0), vec3f(1.0, 0.0, 1.0));
  var id = b.yzw; var ql = pl - b.yzw * 0.5; var nl = M * n;
  if (a.x < b.x) { id = a.yzw; ql = R * pl - a.yzw * 0.5; nl = R * (M * n); }
  let an = abs(nl);
  var face = -1;
  var uvf = vec2f(0.0);
  if (an.x > 0.9 && id.x * sign(nl.x) > 0.5) { face = select(1, 0, nl.x > 0.0); uvf = ql.yz; }
  if (an.y > 0.9 && id.y * sign(nl.y) > 0.5) { face = select(3, 2, nl.y > 0.0); uvf = ql.xz; }
  if (an.z > 0.9 && id.z * sign(nl.z) > 0.5) { face = select(5, 4, nl.z > 0.0); uvf = ql.xy; }
  var cols = array<vec3f, 6>(vec3f(0.85, 0.06, 0.05), vec3f(1.0, 0.42, 0.02), vec3f(0.95, 0.95, 0.93), vec3f(1.0, 0.82, 0.02), vec3f(0.02, 0.62, 0.22), vec3f(0.02, 0.22, 0.8));
  var alb = vec3f(0.015);
  if (face >= 0) {
      let e = sdBox2(uvf, vec2f(0.17)) - 0.03;
      alb = mix(cols[face], alb, smoothstep(-0.006, 0.006, e));
  }
  return finish(dielectric(rd, n, alb, 0.1, occ, 1.0), uv);
}

// ── menger_sponge (fractals) ──
fn mgLocal(p0: vec3f) -> vec3f { return spin(p0, u.time * 0.25 + 0.62, 0.6) / 0.78; }
fn map_menger_sponge(p0: vec3f) -> f32 {
    let p = mgLocal(p0);
    var d = rbox(p, vec3f(1.0), 0.0);
    var s = 1.0;
    for (var m = 0; m < 3; m++) {
        let a = fract(p * s * 0.5) * 2.0 - 1.0;
        s *= 3.0;
        let r = abs(1.0 - 3.0 * abs(a));
        let c = (min(max(r.x, r.y), min(max(r.y, r.z), max(r.z, r.x))) - 1.0) / s;
        d = max(d, c);
    }
    return d * 0.78;
}
// sphere trace map_menger_sponge inside its bounding sphere; -1 on a miss
fn march_menger_sponge(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_menger_sponge(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_menger_sponge(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_menger_sponge
fn nrm_menger_sponge(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_menger_sponge(p + e.xyy) + e.yyx * map_menger_sponge(p + e.yyx) + e.yxy * map_menger_sponge(p + e.yxy) + e.xxx * map_menger_sponge(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_menger_sponge
fn ao_menger_sponge(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_menger_sponge(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_menger_sponge(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_menger_sponge(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_menger_sponge(p);
  let occ = ao_menger_sponge(p, n);
  let q = mgLocal(p);
  let depth = 1.0 - max(abs(q.x), max(abs(q.y), abs(q.z)));
  let glowC = mix(cTone(), vec3f(1.0, 0.35, 0.5), smoothstep(0.1, 0.6, depth)) * mix(0.5, 3.0, k.x);
  let c = dielectric(rd, n, vec3f(0.92, 0.9, 0.86), 0.25, occ, 1.0) * mix(1.0, 0.3, smoothstep(0.02, 0.4, depth)) + glowC * smoothstep(0.03, 0.7, depth) * (1.2 - occ * 0.6);
  return finish(c, uv);
}

// ── sierpinski_tet (fractals) ──
fn spLocal(p0: vec3f) -> vec3f { return rotY(0.78) * (rotX(-0.42) * (rotY(u.time * 0.3 + 0.2) * (p0 + vec3f(0.0, 0.05, 0.0)))) * 1.3; }
fn map_sierpinski_tet(p0: vec3f) -> f32 {
    var z = spLocal(p0) + vec3f(0.0, 0.0, 0.0);
    let it = i32(mix(3.0, 6.99, u.k.x));
    var s = 1.0;
    for (var i = 0; i < 7; i++) {
        if (i >= it) { break; }
        if (z.x + z.y < 0.0) { z = vec3f(-z.y, -z.x, z.z); }
        if (z.x + z.z < 0.0) { z = vec3f(-z.z, z.y, -z.x); }
        if (z.y + z.z < 0.0) { z = vec3f(z.x, -z.z, -z.y); }
        z = z * 2.0 - vec3f(1.0);
        s *= 2.0;
    }
    let d = (max(abs(z.x + z.y) - z.z, abs(z.x - z.y) + z.z) - 1.0) * 0.57735;
    return d / s / 1.3;
}
// sphere trace map_sierpinski_tet inside its bounding sphere; -1 on a miss
fn march_sierpinski_tet(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_sierpinski_tet(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_sierpinski_tet(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_sierpinski_tet
fn nrm_sierpinski_tet(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_sierpinski_tet(p + e.xyy) + e.yyx * map_sierpinski_tet(p + e.yyx) + e.yxy * map_sierpinski_tet(p + e.yxy) + e.xxx * map_sierpinski_tet(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_sierpinski_tet
fn ao_sierpinski_tet(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_sierpinski_tet(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_sierpinski_tet(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_sierpinski_tet(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_sierpinski_tet(p);
  let occ = ao_sierpinski_tet(p, n);
  let q = spLocal(p);
  let ci = clamp(-dot(rd, n), 0.0, 1.0);
  let th = 300.0 + mix(120.0, 380.0, k.y) * (0.5 + 0.5 * sin(q.y * 2.2 + length(q.xz) * 1.5 + 0.8));
  let tint = mix(vec3f(1.0, 0.8, 0.5), film(th, ci, 2.1) * 1.5, 0.45);
  return finish(metal(rd, n, tint, 0.22, occ * occ) + envDiff(n) * tint * 0.1 * occ, uv);
}

// ── mandelbox_slice (fractals) ──
fn mbLocal(p0: vec3f) -> vec3f { return spin(p0, 0.45 + 0.4 * sin(u.time * 0.25), 0.5 + 0.2 * sin(u.time * 0.31)); }
fn mbox(p: vec3f) -> vec2f {
    let sc = mix(2.3, 2.7, u.k.x);
    var z = p; var dr = 1.0; var trap = 1e5;
    for (var i = 0; i < 7; i++) {
        z = clamp(z, vec3f(-1.0), vec3f(1.0)) * 2.0 - z;
        let r2 = dot(z, z);
        trap = min(trap, r2);
        if (r2 < 0.25) { z *= 4.0; dr *= 4.0; }
        else if (r2 < 1.0) { z /= r2; dr /= r2; }
        z = z * sc + p;
        dr = dr * abs(sc) + 1.0;
    }
    return vec2f(length(z) / abs(dr), trap);
}
fn map_mandelbox_slice(p0: vec3f) -> f32 {
    let p = mbLocal(p0);
    let d = mbox(p * 5.6).x / 5.6 * 0.7;
    return max(d, p.z - mix(-0.5, 0.6, u.k.y) - 0.3 * sin(u.time * 0.4));
}
// sphere trace map_mandelbox_slice inside its bounding sphere; -1 on a miss
fn march_mandelbox_slice(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_mandelbox_slice(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_mandelbox_slice(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_mandelbox_slice
fn nrm_mandelbox_slice(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_mandelbox_slice(p + e.xyy) + e.yyx * map_mandelbox_slice(p + e.yyx) + e.yxy * map_mandelbox_slice(p + e.yxy) + e.xxx * map_mandelbox_slice(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_mandelbox_slice
fn ao_mandelbox_slice(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_mandelbox_slice(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_mandelbox_slice(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_mandelbox_slice(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_mandelbox_slice(p);
  let occ = ao_mandelbox_slice(p, n);
  let q = mbLocal(p);
  let tr = mbox(q * 5.6).y;
  let cut = abs(q.z - mix(-0.5, 0.6, k.y) - 0.3 * sin(t * 0.4)) < 0.004;
  let alb = mix(vec3f(1.0, 0.5, 0.15), vec3f(0.92, 0.9, 0.86), smoothstep(0.0, 0.6, tr));
  var c = dielectric(rd, n, select(alb, alb * vec3f(0.85, 0.9, 1.0), cut), 0.5, occ, 1.0);
  c *= 0.5 + 0.5 * occ;
  return finish(c, uv);
}

// ── quat_julia (fractals) ──
fn qjC() -> vec4f { return vec4f(-0.291, -0.399, 0.339, 0.437) + 0.12 * sin(u.time * mix(0.1, 0.6, u.k.x) * vec4f(1.0, 1.3, 0.7, 1.7) + vec4f(0.0, 1.0, 2.0, 3.0)); }
fn qjLocal(p0: vec3f) -> vec3f { return spin(p0, u.time * 0.2 + 0.5, 0.3) / 0.68; }
fn qj(p: vec3f) -> vec2f {
    var z = vec4f(p, 0.0);
    let c = qjC();
    var dz2 = 1.0; var m2 = 0.0; var trap = 1e5;
    for (var i = 0; i < 11; i++) {
        dz2 *= 4.0 * dot(z, z);
        z = vec4f(z.x * z.x - dot(z.yzw, z.yzw), 2.0 * z.x * z.yzw) + c;
        m2 = dot(z, z);
        trap = min(trap, m2);
        if (m2 > 256.0) { break; }
    }
    return vec2f(0.25 * log(max(m2, 1e-6)) * sqrt(m2 / max(dz2, 1e-9)), trap);
}
fn map_quat_julia(p0: vec3f) -> f32 { return qj(qjLocal(p0)).x * 0.48; }
// sphere trace map_quat_julia inside its bounding sphere; -1 on a miss
fn march_quat_julia(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.45);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_quat_julia(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_quat_julia(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_quat_julia
fn nrm_quat_julia(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_quat_julia(p + e.xyy) + e.yyx * map_quat_julia(p + e.yyx) + e.yxy * map_quat_julia(p + e.yxy) + e.xxx * map_quat_julia(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_quat_julia
fn ao_quat_julia(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_quat_julia(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_quat_julia(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_quat_julia(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_quat_julia(p);
  let occ = ao_quat_julia(p, n);
  let tr = qj(qjLocal(p)).y;
  let alb = mix(vec3f(0.95, 0.72, 0.38), mix(vec3f(0.2, 0.25, 0.75), cTone(), 0.3), smoothstep(0.15, 0.9, sqrt(tr)));
  return finish(dielectric(rd, n, alb * 0.85, mix(0.4, 0.02, k.y), occ, 1.0), uv);
}

// ── apollonian (fractals) ──
fn apLocal(p0: vec3f) -> vec3f { return spin(p0, u.time * 0.2 + 0.4, 0.35); }
fn apo(p0: vec3f) -> vec2f {
    let s = mix(1.05, 1.3, u.k.x) + 0.04 * sin(u.time * 0.5);
    var p = p0; var scale = 1.0; var orb = 1e5;
    for (var i = 0; i < 8; i++) {
        p = -1.0 + 2.0 * fract(0.5 * p + 0.5);
        let r2 = dot(p, p);
        orb = min(orb, r2);
        let kk = s / r2;
        p *= kk; scale *= kk;
    }
    return vec2f(0.25 * abs(p.y) / scale, orb);
}
fn map_apollonian(p0: vec3f) -> f32 {
    let p = apLocal(p0);
    let d = apo(p * 3.0).x / 3.0;
    return max(d, length(p) - mix(0.75, 1.0, u.k.y));
}
// sphere trace map_apollonian inside its bounding sphere; -1 on a miss
fn march_apollonian(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_apollonian(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_apollonian(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_apollonian
fn nrm_apollonian(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_apollonian(p + e.xyy) + e.yyx * map_apollonian(p + e.yyx) + e.yxy * map_apollonian(p + e.yxy) + e.xxx * map_apollonian(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_apollonian
fn ao_apollonian(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_apollonian(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_apollonian(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_apollonian(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_apollonian(p);
  let occ = ao_apollonian(p, n);
  let q = apLocal(p);
  let o = apo(q * 3.0).y;
  let shell = abs(length(q) - mix(0.75, 1.0, k.y)) < 0.004;
  var alb = mix(vec3f(0.1, 0.25, 0.75), vec3f(0.95, 0.93, 0.88), smoothstep(0.1, 0.6, o));
  alb = mix(alb, vec3f(0.95, 0.65, 0.25), smoothstep(0.75, 1.0, o) * 0.8);
  if (shell) { alb = vec3f(0.92, 0.9, 0.86); }
  return finish(dielectric(rd, n, alb, 0.3, occ, 1.0) * (0.4 + 0.6 * occ), uv);
}

// ── kifs_crystal (fractals) ──
// one quartz point along +y: a hexagonal prism of half width w and length l with a six-sided tip
fn quartz(q: vec3f, w: f32, l: f32) -> f32 {
    let a = abs(q.xz);
    let hx = max(a.x * 0.866025 + a.y * 0.5, a.y);
    let prism = max(hx - w, -q.y);
    return max(prism, (hx + (q.y - l) * 0.55) * 0.876);
}
fn map_kifs_crystal(p0: vec3f) -> f32 {
    let p = spin(p0, u.time * 0.3 + 0.4, -0.2) / 1.22 + vec3f(0.0, 0.55, 0.0);
    let sp = mix(0.35, 0.8, u.k.x);
    var d = quartz(p, 0.2, 1.25);
    let pm = pmod(p.xz, 5.0);
    var q = vec3f(pm.x, p.y, abs(pm.y));
    let xy = rot2(sp) * q.xy;
    q = vec3f(xy.x, xy.y, q.z);
    d = min(d, quartz(rotY(0.3) * q, 0.14, 0.9));
    let pm2 = pmod(rot2(0.63) * p.xz, 5.0);
    var q2 = vec3f(pm2.x, p.y + 0.05, pm2.y);
    let xy2 = rot2(sp * 1.7) * q2.xy;
    q2 = vec3f(xy2.x, xy2.y, q2.z);
    d = min(d, quartz(q2, 0.1, 0.62));
    return d * 1.22;
}
// sphere trace map_kifs_crystal inside its bounding sphere; -1 on a miss
fn march_kifs_crystal(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.45);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_kifs_crystal(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_kifs_crystal(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_kifs_crystal
fn nrm_kifs_crystal(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_kifs_crystal(p + e.xyy) + e.yyx * map_kifs_crystal(p + e.yyx) + e.yxy * map_kifs_crystal(p + e.yxy) + e.xxx * map_kifs_crystal(p + e.xxx));
}
// path length from an inside point p along rd to the far wall of map_kifs_crystal
fn thru_kifs_crystal(p: vec3f, rd: vec3f) -> f32 {
    var t = 0.01;
    for (var i = 0; i < 40; i++) {
        let d = -map_kifs_crystal(p + rd * t);
        if (d < 0.0008) { break; }
        t += max(d, 0.002);
    }
    return t;
}
// dispersive glass on map_kifs_crystal: reflect, refract in, up to two internal
// reflections, then refract out at ior - spread, ior, ior + spread (R, G, B)
fn glass_kifs_crystal(p0: vec3f, rd0: vec3f, n0: vec3f, ior: f32, spread: f32, absorb: vec3f) -> vec3f {
    let fr = schlick(clamp(-dot(rd0, n0), 0.0, 1.0), pow((ior - 1.0) / (ior + 1.0), 2.0));
    var col = envT(reflect(rd0, n0)) * max(fr, 0.07) * 1.3;
    var dir = refract(rd0, n0, 1.0 / ior);
    var pos = p0 - n0 * 0.004;
    var thr = vec3f(1.0 - fr);
    for (var b = 0; b < 3; b++) {
        let d = thru_kifs_crystal(pos, dir);
        pos += dir * d;
        thr *= exp(-absorb * d);
        let ne = -nrm_kifs_crystal(pos);
        let eg = refract(dir, ne, ior);
        if (dot(eg, eg) > 0.0 || b == 2) {
            let rf = envT(reflect(dir, ne));
            let er = refract(dir, ne, ior - spread);
            let eb = refract(dir, ne, ior + spread);
            let cr = select(rf.r, envT(er).r, dot(er, er) > 0.0);
            let cg = select(rf.g, envT(eg).g, dot(eg, eg) > 0.0);
            let cb = select(rf.b, envT(eb).b, dot(eb, eb) > 0.0);
            return col + thr * vec3f(cr, cg, cb);
        }
        dir = reflect(dir, ne);
        pos += ne * 0.004;
    }
    return col;
}
@fragment fn fs_kifs_crystal(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_kifs_crystal(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_kifs_crystal(p);
  return finish(glass_kifs_crystal(p, rd, n, 1.55, mix(0.02, 0.12, k.y), vec3f(0.12, 0.3, 0.05)), uv);
}

// ── gyroid_lattice (organic) ──
fn gyLocal(p0: vec3f) -> vec3f { return spin(p0, u.time * 0.25 + 0.75, 0.55); }
fn map_gyroid_lattice(p0: vec3f) -> f32 {
    let p = gyLocal(p0);
    let sc = mix(4.0, 10.0, u.k.x);
    let q = p * sc;
    let g = dot(sin(q), cos(q.zxy)) / sc;
    let th = mix(0.02, 0.12, smoothstep(0.7, -0.7, p.y) * mix(0.2, 1.0, u.k.y) + 0.1);
    return max(rbox(p, vec3f(0.68), 0.08), (abs(g) - th) * 0.6);
}
// sphere trace map_gyroid_lattice inside its bounding sphere; -1 on a miss
fn march_gyroid_lattice(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_gyroid_lattice(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_gyroid_lattice(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_gyroid_lattice
fn nrm_gyroid_lattice(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_gyroid_lattice(p + e.xyy) + e.yyx * map_gyroid_lattice(p + e.yyx) + e.yxy * map_gyroid_lattice(p + e.yxy) + e.xxx * map_gyroid_lattice(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_gyroid_lattice
fn ao_gyroid_lattice(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_gyroid_lattice(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_gyroid_lattice(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_gyroid_lattice(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_gyroid_lattice(p);
  let occ = ao_gyroid_lattice(p, n);
  let q = gyLocal(p);
  let grain = 0.94 + 0.06 * hash3(q * 600.0).x;
  let alb = vec3f(0.9, 0.88, 0.84) * grain;
  let bleed = mix(cTone(), vec3f(1.0, 0.45, 0.3), 0.5) * (1.0 - occ) * 0.25;
  let c = envDiff(n) * alb * (0.25 + 0.75 * occ) + bleed * envDiff(n) + env(reflect(rd, n)) * 0.02 * occ;
  return finish(c, uv);
}

// ── nautilus (organic) ──
fn ntLocal(p0: vec3f) -> vec3f { return spin(p0, 0.3 * sin(u.time * 0.3) - 0.7, -1.25) / 1.2 + vec3f(0.12, 0.0, 0.1); }
fn ntParts(p0: vec3f) -> vec3f {
    let p = ntLocal(p0);
    let b = 0.1745;
    let r = max(length(p.xz), 1e-3);
    let a = atan2(p.z, p.x);
    let tmax = mix(11.0, 13.2, u.k.x);
    let n0 = floor((log(r / 0.066) / b - a) / TAU);
    var best = vec3f(1e5, 0.0, 0.0);
    for (var j = -1; j <= 1; j++) {
        let th = a + TAU * (n0 + f32(j));
        if (th < -6.0 || th > tmax) { continue; }
        let C = 0.066 * exp(b * th);
        let T = 0.56 * C;
        let dt = (length(vec2f(r - C, p.y / 0.85)) - T) * 0.8;
        let wall = abs(dt) - (0.05 * T + 0.004);
        let sg = TAU / 11.0;
        let ds = th - floor(th / sg + 0.5) * sg - 0.35 * (r - C) / C;
        let sept = max(abs(ds * r) - 0.025 * T - 0.002, dt);
        var d = wall;
        if (th < tmax - 2.2) { d = min(d, sept); }
        if (d < best.x) { best = vec3f(d, dt, th); }
    }
    return best;
}
fn map_nautilus(p0: vec3f) -> f32 {
    let p = ntLocal(p0);
    let cut = min(p.y, p.x + 0.25);
    return max(ntParts(p0).x * 0.75, cut) * 1.2;
}
// sphere trace map_nautilus inside its bounding sphere; -1 on a miss
fn march_nautilus(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_nautilus(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_nautilus(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_nautilus
fn nrm_nautilus(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_nautilus(p + e.xyy) + e.yyx * map_nautilus(p + e.yyx) + e.yxy * map_nautilus(p + e.yxy) + e.xxx * map_nautilus(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_nautilus
fn ao_nautilus(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_nautilus(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_nautilus(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_nautilus(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_nautilus(p);
  let occ = ao_nautilus(p, n);
  let q = ntLocal(p);
  let s = ntParts(p);
  let cutd = min(q.y, q.x + 0.25);
  let onCut = cutd > s.x * 0.75 - 0.002;
  let ci = clamp(-dot(rd, n), 0.0, 1.0);
  let nacre = mix(vec3f(0.95, 0.92, 0.88), film(330.0 + 90.0 * sin(s.z * 2.0), ci, 1.5) * 1.5, 0.3);
  if (onCut) {
      let c = envDiff(n) * vec3f(0.95, 0.9, 0.84) * 0.8 + env(reflect(rd, n)) * schlick(ci, 0.04);
      return finish(c * mix(0.5, 1.0, occ), uv);
  }
  if (s.y < 0.0) {
      let c = envDiff(n) * nacre * 0.7 + env(reflect(rd, n)) * schlick(ci, 0.04) * nacre;
      return finish(c * mix(0.45, 1.0, occ), uv);
  }
  let tmax = mix(11.0, 13.2, k.x);
  let fade = smoothstep(tmax - 1.0, tmax - 4.0, s.z);
  let fl = sin(s.z * 7.0 + 3.0 * sin(q.y * 6.0 + s.z)) * 0.5 + 0.5;
  let stripe = smoothstep(0.45, 0.6, fl) * fade * mix(0.0, 1.0, k.y);
  let alb = mix(vec3f(0.93, 0.87, 0.76), vec3f(0.55, 0.22, 0.08), stripe);
  return finish(dielectric(rd, n, alb, 0.12, occ, 1.0), uv);
}

// ── coral_branch (organic) ──
fn coralParts(p0: vec3f) -> vec2f {
    var p = rotY(u.time * 0.2 + 0.5) * (p0 - vec3f(0.0, -0.98, 0.0));
    var d = 1e5; var s = 1.0; var dep = 0.0;
    let sway = mix(0.0, 0.18, u.k.y) * sin(u.time * 0.9);
    let spread = mix(0.5, 0.95, u.k.x);
    for (var i = 0; i < 5; i++) {
        let seg = sdCapsule(p, vec3f(0.0), vec3f(0.0, select(0.62, 0.48, i == 0), 0.0), 0.12) / s;
        if (seg < d) { dep = f32(i); }
        d = smin(d, seg, 0.04 / s);
        p.y -= select(0.62, 0.48, i == 0);
        let pm = pmod((rotY(1.1) * p).xz, 3.0);
        p = vec3f(pm.x, p.y, pm.y);
        let xy = rot2(spread + sway * f32(i) * 0.3) * p.xy;
        p = vec3f(xy.x, xy.y, p.z) / 0.66;
        s /= 0.66;
    }
    return vec2f(d, dep);
}
fn map_coral_branch(p: vec3f) -> f32 { return coralParts(p).x; }
// sphere trace map_coral_branch inside its bounding sphere; -1 on a miss
fn march_coral_branch(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.45);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_coral_branch(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_coral_branch(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_coral_branch
fn nrm_coral_branch(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_coral_branch(p + e.xyy) + e.yyx * map_coral_branch(p + e.yyx) + e.yxy * map_coral_branch(p + e.yxy) + e.xxx * map_coral_branch(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_coral_branch
fn ao_coral_branch(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_coral_branch(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
// soft shadow of map_coral_branch toward the light l (after Quilez)
fn shd_coral_branch(p: vec3f, l: vec3f) -> f32 {
    var res = 1.0; var t = 0.02;
    for (var i = 0; i < 32; i++) {
        let d = map_coral_branch(p + l * t);
        res = min(res, 6.0 * d / t);
        t += clamp(d, 0.02, 0.3);
        if (res < 0.005 || t > 4.0) { break; }
    }
    return clamp(res, 0.0, 1.0);
}
@fragment fn fs_coral_branch(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_coral_branch(ro, rd);
  if (h < 0.0) {
      if (rd.y < 0.0) {
          let pf = ro + rd * ((-0.98 - ro.y) / rd.y);
          let fsh = shd_coral_branch(pf, normalize(KEY));
          let fo = ao_coral_branch(pf, vec3f(0.0, 1.0, 0.0));
          return finish(stageFloor(rd, pf, fsh, fo), uv);
      }
      return finish(backdrop(rd), uv);
  }
  let p = ro + rd * h;
  let n = nrm_coral_branch(p);
  let occ = ao_coral_branch(p, n);
  let sh = shd_coral_branch(p + n * 0.012, normalize(KEY));
  let cp = coralParts(p);
  let f = cp.y / 4.0;
  let polyp = smoothstep(0.3, 0.7, gnoise(p * 55.0));
  let alb = mix(mix(vec3f(0.35, 0.08, 0.3), vec3f(0.95, 0.3, 0.35), f), vec3f(1.0, 0.75, 0.55), smoothstep(0.7, 1.0, f));
  let ci = clamp(-dot(rd, n), 0.0, 1.0);
  let sss = alb * pow(1.0 - ci, 2.0) * 0.4 + alb * envDiff(-n) * 0.15;
  return finish(dielectric(rd, n, alb * (1.0 - 0.25 * polyp), 0.5, occ, sh) + sss * occ, uv);
}

// ── glow_mushrooms (organic) ──
fn msData(i: i32) -> vec4f {
    var d = array<vec4f, 5>(vec4f(-0.15, 0.0, 0.05, 1.0), vec4f(0.42, 0.0, -0.18, 0.72), vec4f(-0.55, 0.0, -0.3, 0.6), vec4f(0.22, 0.0, 0.42, 0.5), vec4f(-0.48, 0.0, 0.38, 0.42));
    return d[i];
}
fn msLocal(p0: vec3f) -> vec3f { return rotY(u.time * 0.2 + 0.3) * (rotX(0.4) * (p0 - vec3f(-0.06, 0.22, 0.0))) / 0.88; }
fn msParts(p0: vec3f) -> vec4f {
    let p = msLocal(p0);
    let mound = sdEllipsoid(p - vec3f(0.0, -1.0, 0.0), vec3f(1.15, 0.38, 1.0)) - 0.03 * gnoise(p * 6.0);
    var stem = 1e5; var cap = 1e5; var gill = 1e5;
    for (var i = 0; i < 5; i++) {
        let m = msData(i);
        let s = m.w;
        let base = vec3f(m.x, -0.68 - 0.1 * length(m.xz), m.z);
        let top = base + vec3f(0.06 * s * sin(f32(i) * 2.0), 0.95 * s, 0.05 * s * cos(f32(i) * 3.0));
        stem = min(stem, sdCapsule(p, base, top, 0.06 * s + 0.01 * (top.y - p.y)));
        let cq = p - top - vec3f(0.0, 0.02 * s, 0.0);
        let dome = sdEllipsoid(cq, vec3f(0.36, 0.24, 0.36) * s);
        let under = sdEllipsoid(cq + vec3f(0.0, 0.07 * s, 0.0), vec3f(0.34, 0.2, 0.34) * s);
        cap = min(cap, max(dome, -under));
        gill = min(gill, max(sdEllipsoid(cq + vec3f(0.0, 0.03 * s, 0.0), vec3f(0.33, 0.12, 0.33) * s), -cq.y - 0.08 * s));
    }
    return vec4f(mound, stem, cap, gill);
}
fn map_glow_mushrooms(p: vec3f) -> f32 { let d = msParts(p); return min(min(d.x, d.y), min(d.z, d.w)) * 0.88; }
// sphere trace map_glow_mushrooms inside its bounding sphere; -1 on a miss
fn march_glow_mushrooms(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_glow_mushrooms(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_glow_mushrooms(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_glow_mushrooms
fn nrm_glow_mushrooms(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_glow_mushrooms(p + e.xyy) + e.yyx * map_glow_mushrooms(p + e.yyx) + e.yxy * map_glow_mushrooms(p + e.yxy) + e.xxx * map_glow_mushrooms(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_glow_mushrooms
fn ao_glow_mushrooms(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_glow_mushrooms(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_glow_mushrooms(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let glowC = mix(vec3f(0.2, 1.0, 0.75), cTone(), 0.25) * mix(0.3, 2.5, k.x);
  let h = march_glow_mushrooms(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_glow_mushrooms(p);
  let occ = ao_glow_mushrooms(p, n);
  let d = msParts(p);
  let m = min(min(d.x, d.y), min(d.z, d.w));
  let q = msLocal(p);
  if (d.w == m) {
      let gl = 0.6 + 0.4 * sin(atan2(q.z, q.x) * 60.0);
      return finish(glowC * gl * 1.4 + envDiff(n) * 0.05, uv);
  }
  var c: vec3f;
  if (d.z == m) {
      let w = worley2(q * 9.0);
      let spot = smoothstep(0.22, 0.12, w.x) * mix(0.0, 1.0, k.y);
      let alb = mix(mix(vec3f(0.62, 0.32, 0.12), vec3f(0.85, 0.6, 0.35), smoothstep(-0.3, 0.3, n.y - 0.5)), vec3f(0.95, 0.92, 0.85), spot);
      c = dielectric(rd, n, alb, 0.45, occ, 1.0) + glowC * 0.15 * smoothstep(0.2, -0.6, n.y);
  } else if (d.y == m) {
      c = dielectric(rd, n, vec3f(0.85, 0.82, 0.72), 0.6, occ, 1.0) + glowC * 0.08;
  } else {
      let moss = fbm3(q * 9.0, 3);
      c = envDiff(n) * mix(vec3f(0.06, 0.2, 0.05), vec3f(0.2, 0.42, 0.1), smoothstep(-0.3, 0.4, moss)) * occ;
      c += glowC * 0.06 * occ;
  }
  return finish(c, uv);
}

// ── pine_cone (organic) ──
fn pcR(y: f32) -> f32 {
    let w = clamp((y + 0.92) / 1.82, 0.0, 1.0);
    return 0.5 * pow(sin(PI * pow(w, 0.75)), 0.7) + 0.02;
}
fn pineLocal(p0: vec3f) -> vec3f { return spin(p0, u.time * 0.3 + 0.2, 0.3); }
fn pineParts(p0: vec3f) -> vec2f {
    let p = pineLocal(p0);
    let th = atan2(p.z, p.x);
    let Y = p.y + 0.92;
    let e8 = vec2f(0.3501, 0.12);
    let e13 = vec2f(-0.2164, 0.195);
    let det = e8.x * e13.y - e13.x * e8.y;
    let A = (th * e13.y - e13.x * Y) / det;
    let B = (e8.x * Y - th * e8.y) / det;
    var d = sdEllipsoid(p - vec3f(0.0, 0.0, 0.0), vec3f(0.3, 0.86, 0.3));
    var id = 0.0;
    let op = mix(0.25, 0.75, u.k.x);
    for (var j = -1; j <= 1; j++) { for (var i = -1; i <= 1; i++) {
        let a = floor(A) + f32(i) + 0.5; let b = floor(B) + f32(j) + 0.5;
        let L = a * e8 + b * e13;
        let yi = L.y - 0.92;
        if (yi < -0.9 || yi > 0.92) { continue; }
        let R = pcR(yi);
        let er = vec3f(cos(L.x), 0.0, sin(L.x));
        let et = vec3f(-sin(L.x), 0.0, cos(L.x));
        let c = er * R * 0.72 + vec3f(0.0, yi, 0.0);
        let v = p - c;
        let lr = dot(v, er); let lt = dot(v, et); let ly = v.y;
        let rr = rot2(op) * vec2f(lr, ly);
        let sz = 0.55 + 0.6 * R;
        let ds = sdEllipsoid(vec3f(rr.x - 0.06 * sz, rr.y, lt), vec3f(0.15, 0.04, 0.11) * sz);
        if (ds < d) { id = a * 8.0 + b * 13.0; }
        d = smin(d, ds, 0.015);
    }}
    d = min(d, sdCapsule(p, vec3f(0.0, -0.9, 0.0), vec3f(0.0, -1.1, 0.02), 0.05));
    return vec2f(d * 0.85, id);
}
fn map_pine_cone(p: vec3f) -> f32 { return pineParts(p).x; }
// sphere trace map_pine_cone inside its bounding sphere; -1 on a miss
fn march_pine_cone(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.30);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_pine_cone(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_pine_cone(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_pine_cone
fn nrm_pine_cone(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_pine_cone(p + e.xyy) + e.yyx * map_pine_cone(p + e.yyx) + e.yxy * map_pine_cone(p + e.yxy) + e.xxx * map_pine_cone(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_pine_cone
fn ao_pine_cone(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_pine_cone(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
@fragment fn fs_pine_cone(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_pine_cone(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_pine_cone(p);
  let occ = ao_pine_cone(p, n);
  let q = pineLocal(p);
  let pp = pineParts(p);
  let hv = hash3(vec3f(pp.y, 2.0, 5.0)).x;
  let tipv = smoothstep(0.2, 0.5, length(q.xz) - pcR(q.y) * 0.72);
  var alb = mix(vec3f(0.3, 0.16, 0.07), vec3f(0.55, 0.36, 0.2), tipv) * (0.8 + 0.4 * hv);
  alb = mix(alb, vec3f(0.62, 0.6, 0.55), smoothstep(0.55, 0.9, fbm3(q * 7.0, 3) + 0.3) * k.y);
  return finish(dielectric(rd, n, alb, 0.5, occ, 1.0), uv);
}

// ── melt_drip (organic) ──
fn mdParts(p0: vec3f) -> vec2f {
    let t = u.time * mix(0.4, 1.6, u.k.x);
    let p = rotY(0.5) * p0;
    let ped = sdCyl(p - vec3f(0.0, -0.5, 0.0), 0.47, 0.36) - 0.02;
    var ch = length(p - vec3f(0.0, 0.33, 0.0)) - 0.36;
    ch = smin(ch, sdCyl(p - vec3f(0.0, 0.0, 0.0), 0.03, 0.39), 0.08);
    for (var i = 0; i < 6; i++) {
        let fi = f32(i);
        let a = fi * 1.047 + 0.3 + 0.2 * sin(fi * 3.0);
        let ph = fract(t * 0.12 + fi * 0.37);
        let len = 0.08 + 0.75 * ph * ph;
        let dir = vec3f(cos(a), 0.0, sin(a));
        let top = dir * 0.39 + vec3f(0.0, 0.0, 0.0);
        let tip = dir * 0.395 - vec3f(0.0, len, 0.0);
        ch = smin(ch, sdCapsule(p, top, tip, 0.035 * (1.0 - 0.5 * ph) + 0.01), 0.05);
        ch = smin(ch, length(p - tip) - (0.045 + 0.02 * ph), 0.05);
        let fall = fract(t * 0.12 + fi * 0.37 + 0.5);
        let drop = dir * 0.42 - vec3f(0.0, 0.85 + fall * fall * 0.2, 0.0);
        ch = min(ch, length(p - drop) - 0.03 * step(fall, 0.6));
    }
    let r = length(p.xz);
    let pool = sdBox2(vec2f(r - 0.2, p.y + 0.97), vec2f(0.55 + 0.03 * sin(atan2(p.z, p.x) * 5.0), 0.015)) - 0.02;
    ch = min(ch, pool);
    return vec2f(ped, ch);
}
fn map_melt_drip(p: vec3f) -> f32 { let d = mdParts(p); return min(d.x, d.y); }
// sphere trace map_melt_drip inside its bounding sphere; -1 on a miss
fn march_melt_drip(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_melt_drip(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_melt_drip(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_melt_drip
fn nrm_melt_drip(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_melt_drip(p + e.xyy) + e.yyx * map_melt_drip(p + e.yyx) + e.yxy * map_melt_drip(p + e.yxy) + e.xxx * map_melt_drip(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_melt_drip
fn ao_melt_drip(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_melt_drip(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
// soft shadow of map_melt_drip toward the light l (after Quilez)
fn shd_melt_drip(p: vec3f, l: vec3f) -> f32 {
    var res = 1.0; var t = 0.02;
    for (var i = 0; i < 32; i++) {
        let d = map_melt_drip(p + l * t);
        res = min(res, 6.0 * d / t);
        t += clamp(d, 0.02, 0.3);
        if (res < 0.005 || t > 4.0) { break; }
    }
    return clamp(res, 0.0, 1.0);
}
@fragment fn fs_melt_drip(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_melt_drip(ro, rd);
  if (h < 0.0) {
      if (rd.y < 0.0) {
          let pf = ro + rd * ((-0.99 - ro.y) / rd.y);
          let fsh = shd_melt_drip(pf, normalize(KEY));
          let fo = ao_melt_drip(pf, vec3f(0.0, 1.0, 0.0));
          return finish(stageFloor(rd, pf, fsh, fo), uv);
      }
      return finish(backdrop(rd), uv);
  }
  let p = ro + rd * h;
  let n = nrm_melt_drip(p);
  let occ = ao_melt_drip(p, n);
  let sh = shd_melt_drip(p + n * 0.012, normalize(KEY));
  let d = mdParts(p);
  if (d.x < d.y) { return finish(dielectric(rd, n, vec3f(0.9, 0.88, 0.84), 0.7, occ, sh), uv); }
  return finish(dielectric(rd, n, vec3f(0.11, 0.045, 0.02), mix(0.25, 0.02, k.y), occ, sh) * 1.2, uv);
}

// ── glass_on_granite (scenes) ──
// the scene in closed form: a glass ball, a gold ball and a ruby ball on a plane
fn ggGold() -> vec3f { let a = u.time * mix(0.2, 0.8, u.k.x) + 2.2; return vec3f(1.15 * cos(a), -0.6, 1.15 * sin(a) - 0.2); }
fn ggRuby() -> vec3f { let a = u.time * mix(0.2, 0.8, u.k.x) * 0.7 + 4.4; return vec3f(1.0 * cos(a), -0.66, 0.9 * sin(a) - 0.3); }
fn ggFloorY() -> f32 { return -0.8; }
fn ggC() -> vec3f { return vec3f(-0.1, -0.18, 0.0); }
const GGR: f32 = 0.62;
// shade a point on the floor: tiles, shadows, caustic (no reflection)
fn ggFloor(pf: vec3f) -> vec3f {
    let L = normalize(KEY);
    let g = abs(fract(pf.xz * 0.8) - 0.5);
    let seam = smoothstep(0.485, 0.5, max(g.x, g.y));
    let speck = hash3(floor(pf * 140.0)).x;
    let alb = mix(vec3f(0.3, 0.31, 0.33), vec3f(0.08), step(0.9, speck)) * (1.0 - 0.6 * seam) + vec3f(0.25, 0.2, 0.18) * step(0.97, speck);
    var sh = 1.0;
    let sg = sphHit(pf - ggC(), L, GGR);
    if (sg.y > 0.0) { sh = 0.55; }
    let gs = sphHit(pf - ggGold(), L, 0.2); if (gs.y > 0.0) { sh *= 0.25; }
    let rs = sphHit(pf - ggRuby(), L, 0.14); if (rs.y > 0.0) { sh *= 0.35; }
    let cc = pf.xz - (ggC().xz - L.xz / L.y * (ggC().y - ggFloorY()));
    let caus = exp(-dot(cc, cc) * 30.0) * 3.0 + exp(-dot(cc, cc) * 4.0) * 0.4;
    return alb * (cInk() * 3.0 + cCream() * 0.9 * u.studio * sh) + cCream() * caus * u.studio * 0.5;
}
// what a secondary ray sees: one of the small balls, the floor, or the room
fn ggSee(o: vec3f, d: vec3f) -> vec3f {
    let g = sphHit(o - ggGold(), d, 0.2);
    if (g.x > 0.0) { let n = normalize(o + d * g.x - ggGold()); return metal(d, n, vec3f(1.0, 0.76, 0.38), 0.05, 1.0); }
    let r = sphHit(o - ggRuby(), d, 0.14);
    if (r.x > 0.0) { let n = normalize(o + d * r.x - ggRuby()); return dielectric(d, n, vec3f(0.6, 0.02, 0.05), 0.02, 1.0, 1.0); }
    if (d.y < 0.0) { let pf = o + d * ((ggFloorY() - o.y) / d.y); return ggFloor(pf); }
    return envT(d);
}
// the glass ball: reflect, refract through the chord, refract out
fn ggGlass(o: vec3f, d: vec3f, th: f32) -> vec3f {
    let c = ggC();
    let p = o + d * th; let n = normalize(p - c);
    let fr = schlick(clamp(-dot(d, n), 0.0, 1.0), 0.04);
    let di = refract(d, n, 1.0 / 1.5);
    let ex = sphHit(p - c - n * 0.001, di, GGR).y;
    let pe = p + di * ex; let ne = -normalize(pe - c);
    var dout = refract(di, ne, 1.5);
    if (dot(dout, dout) == 0.0) { dout = reflect(di, ne); }
    return ggSee(o + d * th + di * ex, dout) * (1.0 - fr) * vec3f(0.96, 0.99, 0.98) + envT(reflect(d, n)) * max(fr, 0.05) * 1.3;
}
@fragment fn fs_glass_on_granite(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let c = ggC();
  let hg = sphHit(ro - c, rd, GGR);
  let hgo = sphHit(ro - ggGold(), rd, 0.2);
  let hr = sphHit(ro - ggRuby(), rd, 0.14);
  var best = 1e5; var kind = 0;
  if (hg.x > 0.0) { best = hg.x; kind = 1; }
  if (hgo.x > 0.0 && hgo.x < best) { best = hgo.x; kind = 2; }
  if (hr.x > 0.0 && hr.x < best) { best = hr.x; kind = 3; }
  let tf = (ggFloorY() - ro.y) / rd.y;
  if (rd.y < 0.0 && tf < best) { best = tf; kind = 4; }
  if (kind == 0) { return finish(backdrop(rd), uv); }
  if (kind == 1) { return finish(ggGlass(ro, rd, hg.x), uv); }
  if (kind == 2 || kind == 3) { return finish(ggSee(ro, rd), uv); }
  let pf = ro + rd * tf;
  let up = vec3f(0.0, 1.0, 0.0);
  let fr = schlick(clamp(-rd.y, 0.0, 1.0), 0.06) * mix(0.3, 1.0, k.y);
  let rr = reflect(rd, up);
  var refl: vec3f;
  let rg = sphHit(pf - c, rr, GGR);
  if (rg.x > 0.0) { refl = ggGlass(pf, rr, rg.x); } else { refl = ggSee(pf + up * 0.001, rr); }
  let fade = smoothstep(9.0, 3.5, length(pf.xz));
  let col = mix(backdrop(rd), ggFloor(pf) + refl * fr, fade);
  return finish(col, uv);
}

// ── pebble_cairn (scenes) ──
fn pbData(i: i32) -> vec4f {
    var d = array<vec4f, 5>(vec4f(0.74, 0.25, 0.6, -0.73), vec4f(0.58, 0.21, 0.48, -0.28), vec4f(0.46, 0.18, 0.38, 0.1), vec4f(0.34, 0.15, 0.28, 0.42), vec4f(0.23, 0.12, 0.19, 0.68));
    return d[i];
}
fn pbLocal(p0: vec3f, i: i32) -> vec3f {
    let s = pbData(i);
    let fi = f32(i);
    let wob = mix(0.0, 0.08, u.k.x) * fi * 0.4 * sin(u.time * 1.3 + fi);
    let q = rotY(fi * 1.7 + 0.3) * (p0 - vec3f(0.04 * sin(fi * 2.3), s.w, 0.03 * cos(fi * 1.9)));
    let xy = rot2(0.05 * sin(fi * 3.1) + wob) * q.xy;
    return vec3f(xy.x, xy.y, q.z);
}
fn pbOne(p0: vec3f, i: i32) -> f32 {
    let s = pbData(i);
    let q = pbLocal(p0, i);
    let e = sdEllipsoid(q, s.xyz);
    if (e > 0.08) { return e; }
    return e + 0.012 * gnoise(q * 5.0 + f32(i) * 3.0);
}
fn pbParts(p: vec3f) -> vec2f {
    var d = 1e5; var id = 0.0;
    for (var i = 0; i < 5; i++) {
        let di = pbOne(p, i);
        if (di < d) { d = di; id = f32(i); }
    }
    return vec2f(d * 0.9, id);
}
fn map_pebble_cairn(p: vec3f) -> f32 { return pbParts(p).x; }
// sphere trace map_pebble_cairn inside its bounding sphere; -1 on a miss
fn march_pebble_cairn(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_pebble_cairn(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_pebble_cairn(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_pebble_cairn
fn nrm_pebble_cairn(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_pebble_cairn(p + e.xyy) + e.yyx * map_pebble_cairn(p + e.yyx) + e.yxy * map_pebble_cairn(p + e.yxy) + e.xxx * map_pebble_cairn(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_pebble_cairn
fn ao_pebble_cairn(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_pebble_cairn(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
// soft shadow of map_pebble_cairn toward the light l (after Quilez)
fn shd_pebble_cairn(p: vec3f, l: vec3f) -> f32 {
    var res = 1.0; var t = 0.02;
    for (var i = 0; i < 32; i++) {
        let d = map_pebble_cairn(p + l * t);
        res = min(res, 6.0 * d / t);
        t += clamp(d, 0.02, 0.3);
        if (res < 0.005 || t > 4.0) { break; }
    }
    return clamp(res, 0.0, 1.0);
}
@fragment fn fs_pebble_cairn(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_pebble_cairn(ro, rd);
  if (h < 0.0) {
      if (rd.y < 0.0) {
          let pf = ro + rd * ((-0.98 - ro.y) / rd.y);
          let fsh = shd_pebble_cairn(pf, normalize(KEY));
          let fo = ao_pebble_cairn(pf, vec3f(0.0, 1.0, 0.0));
          return finish(stageFloor(rd, pf, fsh, fo), uv);
      }
      return finish(backdrop(rd), uv);
  }
  let p = ro + rd * h;
  let n = nrm_pebble_cairn(p);
  let occ = ao_pebble_cairn(p, n);
  let sh = shd_pebble_cairn(p + n * 0.012, normalize(KEY));
  let pp = pbParts(p);
  let i = i32(pp.y);
  let q = pbLocal(p, i);
  var alb: vec3f;
  if (i == 0) { alb = vec3f(0.06, 0.065, 0.07) * (0.8 + 0.4 * fbm3(q * 8.0, 3)); }
  else if (i == 1) {
      let sp = hash3(floor(q * 70.0));
      alb = mix(vec3f(0.55, 0.53, 0.5), vec3f(0.08), step(0.82, sp.x));
      alb = mix(alb, vec3f(0.85, 0.7, 0.62), step(0.9, sp.y));
  }
  else if (i == 2) { alb = vec3f(0.9, 0.88, 0.84) * (0.85 + 0.15 * fbm3(q * 5.0, 3)); }
  else if (i == 3) { alb = mix(vec3f(0.55, 0.14, 0.07), vec3f(0.8, 0.45, 0.25), 0.5 + 0.5 * sin(q.y * 50.0 + fbm3(q * 4.0, 3) * 5.0)); }
  else { alb = mix(vec3f(0.08, 0.25, 0.16), vec3f(0.35, 0.55, 0.42), smoothstep(-0.2, 0.4, fbm3(q * 6.0, 4))); }
  return finish(dielectric(rd, n, alb, mix(0.6, 0.06, k.y), occ, sh), uv);
}

// ── floating_island (scenes) ──
fn fiY() -> f32 { return 0.05 * sin(u.time * 0.8) * mix(0.0, 2.0, u.k.x); }
fn fiLocal(p0: vec3f) -> vec3f { return rotY(u.time * 0.15 + 0.6) * (p0 - vec3f(0.0, fiY(), 0.0)); }
fn fiParts(p0: vec3f) -> vec4f {
    let p = fiLocal(p0);
    let r = length(p.xz);
    let hills = 0.15 + 0.05 * gnoise(vec3f(p.xz * 2.5, 1.0)) - 0.12 * smoothstep(0.5, 0.95, r);
    let rr = 0.9 * clamp((p.y + 1.05) / 1.2, 0.0, 1.0);
    var rock = (r - rr - 0.1 * gnoise(p * 3.0) - 0.04 * gnoise(p * 9.0)) * 0.7;
    rock = max(rock, p.y - hills);
    rock = max(rock, -1.05 - p.y);
    let trunk = sdCapsule(p, vec3f(0.3, 0.1, -0.15), vec3f(0.33, 0.52, -0.15), 0.035);
    let crown = smin(length(p - vec3f(0.33, 0.66, -0.15)) - 0.2, length(p - vec3f(0.24, 0.56, -0.05)) - 0.14, 0.08) + 0.03 * gnoise(p * 12.0);
    let wq = p - vec3f(-0.8, 0.0, 0.25);
    let fallx = wq.x + 0.12 * clamp(-wq.y, 0.0, 1.2) * clamp(-wq.y, 0.0, 1.2);
    var water = max(length(vec2f(fallx, wq.z) * vec2f(1.0, 0.55)) - 0.045 - 0.02 * clamp(-wq.y, 0.0, 1.0), abs(wq.y + 0.5) - 0.62);
    water = min(water, max(length(vec2f(p.x + 0.55, p.z - 0.22) * vec2f(0.6, 1.0)) - 0.18, abs(p.y - 0.11) - 0.012));
    return vec4f(rock, min(trunk, 1e5), crown * 0.8, water);
}
fn map_floating_island(p: vec3f) -> f32 { let d = fiParts(p); return min(min(d.x, d.y), min(d.z, d.w)); }
// sphere trace map_floating_island inside its bounding sphere; -1 on a miss
fn march_floating_island(ro: vec3f, rd: vec3f) -> f32 {
    let bs = sphHit(ro, rd, 1.50);
    if (bs.y < 0.0) { return -1.0; }
    var t = max(bs.x, 0.0);
    for (var i = 0; i < 64; i++) {
        let d = map_floating_island(ro + rd * t);
        if (d < 0.0008 * t) { return t; }
        t += d;
        if (t > bs.y) { return -1.0; }
    }
    return select(-1.0, t, map_floating_island(ro + rd * t) < 0.02);
}
// tetrahedron normal of map_floating_island
fn nrm_floating_island(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0009;
    return normalize(e.xyy * map_floating_island(p + e.xyy) + e.yyx * map_floating_island(p + e.yyx) + e.yxy * map_floating_island(p + e.yxy) + e.xxx * map_floating_island(p + e.xxx));
}
// five-tap ambient occlusion along the normal of map_floating_island
fn ao_floating_island(p: vec3f, n: vec3f) -> f32 {
    var o = 0.0; var w = 1.0;
    for (var i = 1; i <= 5; i++) {
        let h = 0.03 + 0.07 * f32(i);
        o += (h - map_floating_island(p + n * h)) * w; w *= 0.65;
    }
    return clamp(1.0 - 1.6 * o, 0.0, 1.0);
}
// soft shadow of map_floating_island toward the light l (after Quilez)
fn shd_floating_island(p: vec3f, l: vec3f) -> f32 {
    var res = 1.0; var t = 0.02;
    for (var i = 0; i < 32; i++) {
        let d = map_floating_island(p + l * t);
        res = min(res, 6.0 * d / t);
        t += clamp(d, 0.02, 0.3);
        if (res < 0.005 || t > 4.0) { break; }
    }
    return clamp(res, 0.0, 1.0);
}
@fragment fn fs_floating_island(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let h = march_floating_island(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_floating_island(p);
  let occ = ao_floating_island(p, n);
  let d = fiParts(p);
  let m = min(min(d.x, d.y), min(d.z, d.w));
  let q = fiLocal(p);
  let sh = shd_floating_island(p + n * 0.01, normalize(KEY));
  var c: vec3f;
  if (d.w == m) {
      let fl = fbm3(vec3f(q.x * 20.0, q.y * 6.0 + t * 3.0 * mix(0.3, 1.5, k.y), q.z * 20.0), 3);
      c = mix(vec3f(0.3, 0.55, 0.85), vec3f(0.95, 0.98, 1.0), smoothstep(-0.1, 0.4, fl)) * (envDiff(n) * 0.6 + 0.2);
      c = mix(backdrop(rd), c, smoothstep(-1.12, -0.6, q.y));
  } else if (d.z == m) {
      c = dielectric(rd, n, mix(vec3f(0.05, 0.22, 0.06), vec3f(0.25, 0.5, 0.1), smoothstep(-0.3, 0.6, gnoise(q * 14.0))), 0.6, occ, sh);
  } else if (d.y == m) {
      c = dielectric(rd, n, vec3f(0.25, 0.14, 0.07), 0.7, occ, sh);
  } else {
      let grass = smoothstep(0.55, 0.85, n.y) * smoothstep(-0.12, 0.0, q.y);
      let strata = 0.5 + 0.5 * sin(q.y * 28.0 + gnoise(q * 4.0) * 2.0);
      let rockA = mix(vec3f(0.36, 0.27, 0.2), vec3f(0.52, 0.42, 0.32), strata);
      let gr = mix(vec3f(0.18, 0.42, 0.1), vec3f(0.42, 0.62, 0.15), gnoise(q * 10.0) * 0.5 + 0.5);
      c = dielectric(rd, n, mix(rockA, gr, grass), 0.75, occ, sh);
  }
  return finish(c, uv);
}

// ── colonnade (scenes) ──
fn colMap(p: vec3f) -> vec2f {
    let z = p.z - 1.4 * round(p.z / 1.4);
    let q = vec3f(abs(p.x) - 1.15, p.y, z);
    let r = length(q.xz);
    let flute = 0.006 * cos(atan2(q.z, q.x) * 18.0);
    var col = max(r - 0.16 - flute + 0.015 * smoothstep(0.0, 1.8, q.y), abs(q.y - 0.95) - 0.85);
    col = min(col, rbox(q - vec3f(0.0, 0.06, 0.0), vec3f(0.25, 0.06, 0.25), 0.01));
    col = min(col, rbox(q - vec3f(0.0, 1.86, 0.0), vec3f(0.26, 0.05, 0.26), 0.01));
    col = min(col, sdTorus(q - vec3f(0.0, 1.78, 0.0), 0.17, 0.035));
    let beam = rbox(vec3f(q.x, q.y - 2.02, 0.0), vec3f(0.3, 0.11, 10.0), 0.01);
    let xbeam = rbox(vec3f(p.x, p.y - 2.2, z), vec3f(1.5, 0.06, 0.12), 0.01);
    let ground = p.y;
    let d = min(min(col, beam), xbeam);
    return vec2f(min(d, ground), select(0.0, 1.0, ground < d));
}
@fragment fn fs_colonnade(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = suv(fp.xy);
  let t = u.time;
  let k = u.k;
  let ro = camO();
  let rd = camD(uv);
  let z0 = -t * mix(0.1, 0.8, k.x) * 1.4 + 0.7;
  let ro2 = vec3f(0.0, 0.62, z0);
  let yaw = 0.18 * sin(t * 0.2) + 0.12;
  let rd2 = rotY(-yaw) * normalize(vec3f(uv.x, uv.y + 0.12, -1.25));
  let sun = normalize(vec3f(mix(-0.9, 0.9, k.y), 0.45, -0.6));
  let sky = mix(mix(cCream(), vec3f(1.0, 0.55, 0.3), 0.55) * 1.0, cTone() * 0.5 + cInk(), smoothstep(-0.02, 0.45, rd2.y));
  var tt = 0.05; var hitd = -1.0; var mat = 0.0;
  for (var i = 0; i < 80; i++) {
      let r = colMap(ro2 + rd2 * tt);
      if (r.x < 0.001 * tt) { hitd = tt; mat = r.y; break; }
      tt += r.x;
      if (tt > 28.0) { break; }
  }
  let sunGlow = vec3f(1.0, 0.75, 0.45) * pow(max(dot(rd2, sun), 0.0), 40.0) * 2.0;
  if (hitd < 0.0) { return finish(sky + sunGlow, uv); }
  let p = ro2 + rd2 * hitd;
  let e = vec2f(0.002, 0.0);
  let n = normalize(vec3f(colMap(p + e.xyy).x - colMap(p - e.xyy).x, colMap(p + e.yxy).x - colMap(p - e.yxy).x, colMap(p + e.yyx).x - colMap(p - e.yyx).x));
  var sh = 1.0; var st = 0.03;
  for (var i = 0; i < 24; i++) {
      let d = colMap(p + n * 0.003 + sun * st).x;
      sh = min(sh, 8.0 * d / st);
      st += clamp(d, 0.03, 0.5);
      if (sh < 0.005 || st > 8.0) { break; }
  }
  sh = clamp(sh, 0.0, 1.0);
  var ao = 0.0;
  for (var i = 1; i <= 4; i++) { let hh = 0.06 * f32(i); ao += (hh - colMap(p + n * hh).x); }
  ao = clamp(1.0 - 2.5 * ao, 0.0, 1.0);
  var alb = vec3f(0.85, 0.8, 0.72) * (0.9 + 0.1 * gnoise(p * 6.0));
  if (mat > 0.5) {
      let ck = floor(p.xz / 0.7);
      let odd = (i32(ck.x + ck.y) % 2 + 2) % 2 == 1;
      alb = select(vec3f(0.82, 0.78, 0.7), vec3f(0.5, 0.3, 0.26), odd) * (0.85 + 0.15 * fbm3(p * 3.0, 3));
  }
  let sunC = vec3f(1.0, 0.7, 0.42) * 3.0;
  var c = alb * (sunC * max(dot(n, sun), 0.0) * sh + sky * 0.28 * (0.6 + 0.4 * n.y) * ao);
  if (mat > 0.5) { c += sky * schlick(clamp(-rd2.y, 0.0, 1.0), 0.04) * 0.4 * ao; }
  let fog = 1.0 - exp(-hitd * 0.055);
  c = mix(c, sky, fog);
  return finish(c + sunGlow * fog, uv);
}
