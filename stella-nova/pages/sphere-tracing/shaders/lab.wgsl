// ═══════════════════════════════════════════════════════════════════════════
//  SPHERE TRACING LAB  ·  lab.wgsl — one field, two views
// ───────────────────────────────────────────────────────────────────────────
//  map(p) evaluates the scene from the uniform block: up to 8 primitives in
//  order, each joined to the result so far by its operator, after two space
//  folds (limited repetition in xz, twist about y). scene.js holds the same
//  field in JavaScript; keep the two in step.
//
//  fs_view .... the 3D view: a sphere tracer (plain, or over-relaxed after
//               Keinert et al. 2014) with seven debug modes
//  fs_slice ... the 2D cross-section of map on the slice plane, with signed
//               coloring and iso-contours
//
//  Sphere tracing after Hart 1996; primitives, smooth minimum, the
//  tetrahedron normal, ambient occlusion and the min(k h / t) soft shadow
//  after Inigo Quilez. The shading and the debug views are original.
//
//  GREP MAP
//    struct LabU ...... the uniform block (main.js writes it, see packUniforms)
//    fn sdPrim ........ one primitive          ·  fn map ...... the field
//    fn mapCol ........ color at a surface     ·  fn march .... the tracer
//    fn calcNormal / calcAO / softShadow       ·  fn fieldCol . slice coloring
//    bound ............ the shadow bound sphere (softShadow skips outside it)
//    fn fs_view ....... 3D view and modes      ·  fn fs_slice . slice view
// ═══════════════════════════════════════════════════════════════════════════
const PI: f32 = 3.141592653589793;
const EPS: f32 = 0.001;
const TMAX: f32 = 14.0;
const FLOOR_Y: f32 = -1.45;

struct Prim { a: vec4f, b: vec4f, c: vec4f };   // a: pos, type · b: size, op · c: k, color, rotY, pad
struct LabU {
    view: vec4f,    // 3D canvas w, h (device px), time, mode
    slice: vec4f,   // slice canvas w, h (device px), half extent, prim count
    eye: vec4f,     // camera position, focal length
    fwd: vec4f,     // forward, step scale
    right: vec4f,   // right, relax omega (1 = plain)
    up: vec4f,      // up, max steps
    pn: vec4f,      // plane normal, offset
    pu: vec4f,      // plane u axis, show plane in 3D (0 or 1)
    pv: vec4f,      // plane v axis, omega for the compare view
    scene: vec4f,   // twist, repeat period, repeat count, fade to black (screensaver; 0 = none)
    prims: array<Prim, 8>,
    bound: vec4f,   // shadow bound radius about the origin (scene.js shadowBound), pad
};
@group(0) @binding(0) var<uniform> u: LabU;

@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var v = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(v[i], 0.0, 1.0);
}

// ── palette ─────────────────────────────────────────────────────────────────
const INK = vec3f(0.035, 0.043, 0.078);
const TONE = vec3f(0.353, 0.553, 1.0);
const CREAM = vec3f(1.0, 0.831, 0.604);
fn primColor(i: i32) -> vec3f {
    switch i {
        case 0: { return vec3f(1.0, 0.831, 0.604); }
        case 1: { return vec3f(0.353, 0.553, 1.0); }
        case 2: { return vec3f(1.0, 0.541, 0.416); }
        case 3: { return vec3f(0.435, 0.89, 0.757); }
        case 4: { return vec3f(0.765, 0.635, 1.0); }
        default: { return vec3f(0.949, 0.757, 0.306); }
    }
}
fn ramp(x: f32) -> vec3f {
    let v = clamp(x, 0.0, 1.0);
    let a = mix(INK, TONE, smoothstep(0.0, 0.45, v));
    let b = mix(a, CREAM, smoothstep(0.4, 0.8, v));
    return mix(b, vec3f(1.0, 0.36, 0.3), smoothstep(0.82, 1.0, v));
}

// ── the field ───────────────────────────────────────────────────────────────
fn rot2(a: f32) -> mat2x2f { let c = cos(a); let s = sin(a); return mat2x2f(c, s, -s, c); }
fn sdBox(p: vec3f, b: vec3f) -> f32 { let q = abs(p) - b; return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0); }
fn sminP(a: f32, b: f32, k: f32) -> f32 { let h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }

fn sdPrim(i: i32, p0: vec3f) -> f32 {
    let pr = u.prims[i];
    var p = p0 - pr.a.xyz;
    let xz = rot2(pr.c.z) * p.xz; p = vec3f(xz.x, p.y, xz.y);
    let s = pr.b.xyz;
    switch i32(pr.a.w) {
        case 0: { return length(p) - s.x; }
        case 1: { return sdBox(p, s); }
        case 2: { let r = 0.25 * min(s.x, min(s.y, s.z)); return sdBox(p, s - r) - r; }
        case 3: { let q = vec2f(length(p.xz) - s.x, p.y); return length(q) - s.y; }
        case 4: { let d = vec2f(length(p.xz) - s.x, abs(p.y) - s.y); return min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0))); }
        case 5: { let q = vec3f(p.x, p.y - clamp(p.y, -s.y, s.y), p.z); return length(q) - s.x; }
        default: { return (abs(p.x) + abs(p.y) + abs(p.z) - s.x) * 0.57735027; }
    }
}
fn combine(d: f32, di: f32, op: i32, k: f32) -> f32 {
    switch op {
        case 0: { return min(d, di); }
        case 1: { return max(d, -di); }
        case 2: { return max(d, di); }
        case 3: { return sminP(d, di, k); }
        case 4: { return -sminP(-d, di, k); }
        default: { return -sminP(-d, -di, k); }
    }
}
fn domain(p0: vec3f) -> vec3f {
    var p = p0;
    let n = u.scene.z;
    if (n > 0.0) {
        let per = u.scene.y;
        let xz = p.xz - per * clamp(round(p.xz / per), vec2f(-n), vec2f(n));
        p = vec3f(xz.x, p.y, xz.y);
    }
    if (u.scene.x != 0.0) {
        let xz = rot2(u.scene.x * p.y) * p.xz;
        p = vec3f(xz.x, p.y, xz.y);
    }
    return p;
}
fn map(p0: vec3f) -> f32 {
    let p = domain(p0);
    let n = i32(u.slice.w);
    var d = 1e9;
    for (var i = 0; i < 8; i++) {
        if (i >= n) { break; }
        let di = sdPrim(i, p);
        if (i == 0) { d = di; } else { d = combine(d, di, i32(u.prims[i].b.w), max(u.prims[i].c.x, 0.001)); }
    }
    return d;
}
// color at a surface point: follow the op chain and blend the primitive colors
fn mapCol(p0: vec3f) -> vec3f {
    let p = domain(p0);
    let n = i32(u.slice.w);
    var d = 1e9;
    var col = vec3f(0.8);
    for (var i = 0; i < 8; i++) {
        if (i >= n) { break; }
        let di = sdPrim(i, p);
        let ci = primColor(i32(u.prims[i].c.y));
        let op = i32(u.prims[i].b.w);
        let k = max(u.prims[i].c.x, 0.001);
        if (i == 0) { col = ci; }
        else if (op == 0 || op == 3) {
            let h = select(select(0.0, 1.0, di < d), clamp(0.5 + 0.5 * (d - di) / k, 0.0, 1.0), op == 3);
            col = mix(col, ci, h);
        } else if (op == 1 || op == 4) {
            let h = select(select(0.0, 1.0, -di > d), clamp(0.5 + 0.5 * (-di - d) / k, 0.0, 1.0), op == 4);
            col = mix(col, ci, h);
        }
        if (i == 0) { d = di; } else { d = combine(d, di, op, k); }
    }
    return col;
}

// ── the tracer ──────────────────────────────────────────────────────────────
// returns (t, steps, hit 0/1, final d). w > 1 turns on over-relaxation: a
// step of w d; when the spheres at the old and the new point do not overlap,
// go back to the plain step and continue with w = 1 (Keinert et al. 2014).
// A relaxed step that lands inside (d < 0) also goes back.
fn march(ro: vec3f, rd: vec3f, w0: f32) -> vec4f {
    let scale = u.fwd.w;
    let maxSteps = i32(u.up.w);
    var w = w0;
    var t = 0.0; var prevR = 0.0; var stepLen = 0.0; var tPrev = 0.0;
    var d = 1e9;
    var n = 0;
    for (var i = 0; i < 400; i++) {
        if (i >= maxSteps) { break; }
        n = i + 1;
        d = map(ro + rd * t);
        let rad = abs(d) * scale;
        if (w > 1.0 && (rad + prevR < stepLen || d < 0.0)) {
            t = tPrev + prevR; w = 1.0; stepLen = prevR; prevR = 0.0;
            continue;
        }
        if (d < EPS) { return vec4f(t, f32(n), 1.0, d); }
        tPrev = t; prevR = rad; stepLen = w * d * scale;
        t += stepLen;
        if (t > TMAX) { break; }
    }
    return vec4f(t, f32(n), 0.0, d);
}
fn calcNormal(p: vec3f) -> vec3f {
    let e = vec2f(1.0, -1.0) * 0.0007;
    return normalize(e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) + e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));
}
fn calcAO(p: vec3f, n: vec3f) -> f32 {
    var occ = 0.0; var sca = 1.0;
    for (var i = 0; i < 5; i++) {
        let h = 0.012 + 0.16 * f32(i) / 4.0;
        occ += (h - map(p + h * n)) * sca;
        sca *= 0.9;
    }
    return clamp(1.0 - 2.4 * occ, 0.0, 1.0);
}
// Outside the sphere of radius u.bound.x about the origin, map > 0.84 and
// map > t / 12 for t <= 10 (scene.js shadowBound). A sample there does not
// change res, and its step is the full 0.3. So the march starts at the first
// sample in the sphere and stops where the ray leaves it. The samples it
// evaluates are the same as in a march from t = 0.02, so the result is the
// same. A ray that misses the sphere is lit (res = 1). k must be 12.
fn softShadow(ro: vec3f, rd: vec3f, k: f32) -> f32 {
    let b = dot(ro, rd);
    let disc = b * b - (dot(ro, ro) - u.bound.x * u.bound.x);
    if (disc <= 0.0) { return 1.0; }
    let tOut = -b + sqrt(disc);
    let tIn = -b - sqrt(disc);
    var res = 1.0; var t = 0.02; var i0 = 0;
    if (tIn > t) { i0 = i32(ceil((tIn - 0.02) / 0.3)); t = 0.02 + 0.3 * f32(i0); }
    if (t > tOut || t > 10.0) { return 1.0; }
    for (var i = i0; i < 64; i++) {
        let h = map(ro + rd * t);
        res = min(res, k * h / t);
        t += clamp(h, 0.01, 0.3);
        if (res < 0.002 || t > 10.0 || t > tOut) { break; }
    }
    res = clamp(res, 0.0, 1.0);
    return res * res * (3.0 - 2.0 * res);
}

// ── the 3D view ─────────────────────────────────────────────────────────────
const LIGHT = vec3f(0.55, 0.78, 0.32);
fn sky(rd: vec3f) -> vec3f {
    let g = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
    return mix(INK * 1.4 + vec3f(0.01, 0.015, 0.03), INK * 0.6 + TONE * 0.12, g);
}
// fw = the pixel footprint on the floor (no derivatives: this runs after the tracer)
fn floorCol(p: vec3f, fw: f32) -> vec3f {
    let g = abs(fract(p.xz + 0.5) - 0.5);
    let ln = 1.0 - smoothstep(0.0, fw * 1.5, min(g.x, g.y));
    let line = ln * (1.0 - smoothstep(0.08, 0.3, fw));
    let fade = exp(-0.04 * dot(p.xz, p.xz));
    return (INK * 2.2 + TONE * 0.05 + TONE * 0.18 * line) * (0.4 + 0.6 * fade);
}
fn shade(p: vec3f, n: vec3f, rd: vec3f, base: vec3f) -> vec3f {
    let l = normalize(LIGHT);
    let dif = max(dot(n, l), 0.0) * softShadow(p + n * 0.003, l, 12.0);
    let ao = calcAO(p, n);
    let hv = normalize(l - rd);
    let spe = pow(max(dot(n, hv), 0.0), 48.0) * dif;
    let fre = pow(clamp(1.0 + dot(n, rd), 0.0, 1.0), 3.0);
    var col = base * (0.10 + 0.9 * dif) * CREAM * 1.05;
    col += base * TONE * 0.22 * (0.5 + 0.5 * n.y) * ao;
    col += vec3f(0.9) * spe * 0.6;
    col += TONE * fre * 0.25 * ao;
    return col * (0.4 + 0.6 * ao);
}
// signed coloring for the slice, also painted on the plane in 3D
fn fieldCol(d: f32, w: f32) -> vec3f {
    let a = abs(d);
    let f = 5.0;
    let outer = mix(INK, TONE, 0.14 + 0.86 * exp(-1.1 * a)) * (1.0 - 0.7 * exp(-a * 4.0));
    let deep = mix(INK, CREAM, 0.42);
    let inner = mix(CREAM * 0.95, deep, smoothstep(0.0, 0.6, a)) * (1.0 - 0.5 * exp(-a * 10.0));
    var col = select(outer, inner, d < 0.0);
    col *= select(0.80 + 0.20 * cos(2.0 * PI * f * d), 0.9 + 0.1 * cos(2.0 * PI * f * d), d < 0.0);
    let m = abs(fract(d * f * 0.5 + 0.5) - 0.5) * 2.0 / f;
    col = mix(col, min(col * 1.7 + 0.05, vec3f(1.0)), (1.0 - smoothstep(0.4 * w, 1.4 * w, m)) * 0.5);
    col += CREAM * 0.2 * exp(-a * 14.0);
    col = mix(col, vec3f(1.0, 0.97, 0.92), 1.0 - smoothstep(0.6 * w, 1.8 * w, a));
    return col;
}

fn render(ro: vec3f, rd: vec3f, mode: i32, w: f32, pixel: f32) -> vec3f {
    let m = march(ro, rd, w);
    let hit = m.z > 0.5;
    let tf = select(1e9, (FLOOR_Y - ro.y) / rd.y, rd.y < -1e-4);
    // log scale: 1 step is ink, the cap is red
    let steps = log2(1.0 + m.y) / log2(1.0 + max(u.up.w, 1.0));
    if (mode == 1 || mode == 6) {
        var col = ramp(steps);
        if (!hit) { col *= 0.75; }
        return col;
    }
    var col = sky(rd);
    var tHit = 1e9;
    if (hit) {
        tHit = m.x;
        let p = ro + rd * m.x;
        let n = calcNormal(p);
        if (mode == 2) { col = n * 0.5 + 0.5; col = col * col; }
        else if (mode == 3) {
            let bands = 0.75 + 0.25 * cos(2.0 * PI * m.x * 2.0);
            col = ramp(1.0 - m.x / 9.0) * bands * 0.9;
            col = mix(col, vec3f(1.0, 0.3, 0.25), smoothstep(-0.004, -0.04, m.w));
        }
        else if (mode == 4) { let ao = calcAO(p, n); col = mix(INK, CREAM, ao) * (0.6 + 0.4 * ao); }
        else if (mode == 5) {
            let l = normalize(LIGHT);
            let sh = softShadow(p + n * 0.003, l, 12.0) * step(0.0, dot(n, l));
            col = mix(INK * 1.5, CREAM, sh);
            col = mix(col, TONE * 1.2, (sh * (1.0 - sh)) * 2.4);
        }
        else { col = shade(p, n, rd, mapCol(p)); }
    } else if (tf < 1e8) {
        tHit = tf;
        let p = ro + rd * tf;
        let l = normalize(LIGHT);
        var c = floorCol(p, pixel * tf / max(abs(rd.y), 0.08));
        if (mode == 0 || mode == 5) {
            let sh = softShadow(p + vec3f(0.0, 0.002, 0.0), l, 12.0);
            c = select(c * (0.35 + 0.65 * sh), mix(INK * 1.5, CREAM * 0.8, sh) * (0.5 + 0.5 * exp(-0.04 * dot(p.xz, p.xz))), mode == 5);
        }
        col = mix(c, sky(rd), smoothstep(6.0, 14.0, tf));
    }
    // the slice plane, painted with the slice coloring where it lies in front
    if (u.pu.w > 0.5) {
        let dn = dot(rd, u.pn.xyz);
        if (abs(dn) > 1e-4) {
            let tp = (u.pn.w - dot(ro, u.pn.xyz)) / dn;
            if (tp > 0.0 && tp < tHit) {
                let q = ro + rd * tp;
                let a = dot(q, u.pu.xyz); let b = dot(q, u.pv.xyz);
                let ext = u.slice.z;
                if (abs(a) < ext && abs(b) < ext) {
                    let d = map(q);
                    let pc = fieldCol(d, pixel * tp * 1.5);
                    col = mix(col, pc, 0.32);
                }
            }
        }
    }
    return col;
}

@fragment fn fs_view(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let size = u.view.xy;
    let mode = i32(u.view.w);
    let mn = min(size.x, size.y);
    var uv = (2.0 * fp.xy - size) / mn;
    uv.y = -uv.y;
    let ro = u.eye.xyz;
    let rd = normalize(u.fwd.xyz * u.eye.w + u.right.xyz * uv.x + u.up.xyz * uv.y);
    let pixel = 2.0 / (mn * u.eye.w);
    var w = u.right.w;
    if (mode == 6) { w = select(1.0, max(u.pv.w, 1.0), fp.x > size.x * 0.5); }
    var col = render(ro, rd, mode, w, pixel);
    if (mode == 6) { col = mix(col, vec3f(1.0), 1.0 - smoothstep(0.0, 1.5, abs(fp.x - size.x * 0.5))); }
    col = pow(col, vec3f(0.92));
    let vig = 1.0 - 0.25 * dot(uv * 0.6, uv * 0.6);
    return vec4f(clamp(col * vig * (1.0 - u.scene.w), vec3f(0.0), vec3f(1.0)), 1.0);
}

// ── the slice view ──────────────────────────────────────────────────────────
@fragment fn fs_slice(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let size = u.slice.xy;
    let sc = min(size.x, size.y) / (2.0 * u.slice.z);
    let a = (fp.x - size.x * 0.5) / sc;
    let b = -(fp.y - size.y * 0.5) / sc;
    let q = u.pn.xyz * u.pn.w + u.pu.xyz * a + u.pv.xyz * b;
    let d = map(q);
    var col = fieldCol(d, 1.0 / sc);
    // a faint unit grid
    let g = abs(fract(vec2f(a, b) + 0.5) - 0.5) * sc;
    col = mix(col, col + vec3f(0.06), (1.0 - smoothstep(0.0, 1.0, min(g.x, g.y))) * 0.6);
    return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}
