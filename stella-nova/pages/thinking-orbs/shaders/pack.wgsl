// ═══════════════════════════════════════════════════════════════════════════
//  THINKING ORBS  ·  WGSL port of the six dotted thought-orb modes from
//  RareFormLabs' thinking-orbs (MIT), itself descended from inkform /
//  PlotterLab's HalftoneSphere: honestly 3D — rotated, depth-shaded, with
//  depth carried by dot size and ink weight alone.
//
//  The library computes every dot on the CPU from its index and paints
//  z-sorted 2D canvas arcs. Here each dot is an instanced sprite: the vertex
//  shader evaluates the same per-dot math from instance_index, a depth buffer
//  replaces the sort (opaque dots first, translucent ghosts after), and the
//  fragment draws an anti-aliased disc. Ported function-for-function; the
//  option names are the library's own.
// ═══════════════════════════════════════════════════════════════════════════

struct ThinkU {
    size: vec2f, time: f32, pixelScale: f32,
    ink: vec4f, tone: vec4f, cream: vec4f,
    o: array<vec4f, 8>,        // the resolved ModeOpts, packed by OPT_* index
    zoom: f32, layer: f32, pad0: f32, pad1: f32,   // zoom: cell px per preset px; layer: 0 opaque pass, 1 translucent pass
}
@group(0) @binding(0) var<uniform> u: ThinkU;

const PI: f32 = 3.14159265358979;
const TAU: f32 = 6.28318530717959;

// ModeOpts slots (packed by the page in this order)
const OPT_latRings = 0; const OPT_lonDensity = 1; const OPT_rBase = 2; const OPT_rDepth = 3; const OPT_rBoost = 4; const OPT_inkFar = 5; const OPT_inkSpan = 6; const OPT_rsPow = 7;
const OPT_orbitN = 8; const OPT_ghostN = 9; const OPT_ghostR = 10; const OPT_ghostA = 11; const OPT_particles = 12; const OPT_partR = 13; const OPT_partRDepth = 14; const OPT_moveCount = 15;
const OPT_rActive = 16; const OPT_rings = 17; const OPT_lanes = 18; const OPT_segs = 19; const OPT_rDot = 20; const OPT_iconD = 21; const OPT_scanMul = 22; const OPT_dimBase = 23;
const OPT_spin = 24; const OPT_bandMul = 25; const OPT_wobMul = 26; const OPT_spread = 27; const OPT_rSizeMul = 28; const OPT_rMin = 29; const OPT_size = 30; const OPT_waveAmp = 31;
fn opt(i: i32) -> f32 { return u.o[i / 4][i % 4]; }

struct Dot { x: f32, y: f32, z: f32, r: f32, white: f32, a: f32 }

// —— core.ts ————————————————————————————————————————————————————————————————
/** Deterministic hash in [0, 1). */
fn hashD(a: f32, b: f32) -> f32 { let h = sin(a * 12.9898 + b * 78.233) * 43758.5453; return h - floor(h); }
/** Stable directions on a unit sphere (Fibonacci lattice). */
fn fibDir(i: f32, n: f32) -> vec3f {
    let golden = PI * (3.0 - sqrt(5.0));
    let y = 1.0 - (2.0 * (i + 0.5)) / n; let rad = sqrt(1.0 - y * y); let a = i * golden;
    return vec3f(rad * cos(a), y, rad * sin(a));
}
/** Shortest signed angular distance, wrapped to (-π, π]. */
fn angleDelta(a: f32, b: f32) -> f32 { return atan2(sin(a - b), cos(a - b)); }
/** Shared spin + tilt + orthographic projection (makeProj). */
fn proj(p: vec3f, yaw: f32, tilt: f32, cx: f32, cy: f32, scale: f32) -> vec3f {
    let st = sin(tilt); let ct = cos(tilt); let sy = sin(yaw); let cyw = cos(yaw);
    let x1 = p.x * cyw + p.z * sy; let z1 = -p.x * sy + p.z * cyw;
    let y1 = p.y * ct - z1 * st; let z2 = p.y * st + z1 * ct;
    return vec3f(cx + x1 * scale, cy - y1 * scale, z2);
}
/** Dot radii were tuned for a 300pt frame; sub-linear scaling keeps small spinners legible. */
fn radiusScale(size: f32, pw: f32) -> f32 { return pow(size / 300.0, pw); }
fn mkdot(p: vec3f, r: f32, white: f32, a: f32) -> Dot { var d: Dot; d.x = p.x; d.y = p.y; d.z = p.z; d.r = r; d.white = white; d.a = a; return d; }

// —— orbits.ts · particles on tilted orbits — "working" ———————————————————
fn dot_orbits(i: u32, size: f32, t: f32) -> Dot {
    let cx = size / 2.0; let cy = size / 2.0; let R = (size / 2.0) * 0.82;
    let rs = radiusScale(size, opt(OPT_rsPow));
    let ghostN = u32(opt(OPT_ghostN)); let particles = u32(opt(OPT_particles));
    let per = ghostN + particles; let orb = i / per; let k = i % per;
    let orbf = f32(orb);
    let h1 = hashD(orbf, 1.7); let h2 = hashD(orbf, 5.2); let h3 = hashD(orbf, 8.9);
    let ro = R * (0.45 + 0.52 * h1); let th = h1 * 2.0 * PI; let phi = acos(2.0 * h2 - 1.0);
    // orbit plane basis (u, v ⟂ normal n)
    let nx = sin(phi) * cos(th); let ny = cos(phi); let nz = sin(phi) * sin(th);
    var ux = -ny; var uy = nx; let uz = 0.0;
    let ul = max(1e-6, sqrt(ux * ux + uy * uy)); ux /= ul; uy /= ul;
    let vx = ny * uz - nz * uy; let vy = nz * ux - nx * uz; let vz = nx * uy - ny * ux;
    let speed = (0.25 + 0.55 * h3) * select(-1.0, 1.0, h3 > 0.5);
    if (k < ghostN) {   // ghost path
        let a = (f32(k) / f32(ghostN)) * 2.0 * PI;
        let p = proj(vec3f((ux * cos(a) + vx * sin(a)) * ro, (uy * cos(a) + vy * sin(a)) * ro, (uz * cos(a) + vz * sin(a)) * ro), t * 0.12, 0.3, cx, cy, 1.0);
        let depth = (p.z / ro + 1.0) / 2.0;
        return mkdot(p, opt(OPT_ghostR) * rs, 0.72, opt(OPT_ghostA) * (0.4 + 0.6 * depth));
    }
    // the particles doing the work
    let m = f32(k - ghostN);
    let a = t * speed + (m / f32(particles)) * 2.0 * PI + h2 * 6.0;
    let p = proj(vec3f((ux * cos(a) + vx * sin(a)) * ro, (uy * cos(a) + vy * sin(a)) * ro, (uz * cos(a) + vz * sin(a)) * ro), t * 0.12, 0.3, cx, cy, 1.0);
    let depth = (p.z / ro + 1.0) / 2.0;
    return mkdot(p, (opt(OPT_partR) + opt(OPT_partRDepth) * depth) * rs, 0.3 - 0.22 * depth, 1.0);
}

// —— lattice.ts · the lat/long field shared by globe, rubik and wave ————————
struct LatLon { lat: f32, lon: f32 }
/** dot index → (lat, lon) over rings of max(1, round(|cos lat| · lonDensity)) dots. */
fn latlon(i: u32, rings: u32, lonDensity: f32) -> LatLon {
    var rem = i; var out: LatLon;
    for (var li = 0u; li <= rings; li++) {
        let lat = -PI / 2.0 + (f32(li) / f32(rings)) * PI;
        let lonCount = max(1u, u32(round(abs(cos(lat)) * lonDensity)));
        if (rem < lonCount) { out.lat = lat; out.lon = (f32(rem) / f32(lonCount)) * 2.0 * PI; return out; }
        rem -= lonCount;
    }
    out.lat = 0.0; out.lon = 0.0; return out;
}

// Globe: a scan meridian sweeps the field — "searching"
fn dot_globe(i: u32, size: f32, t: f32) -> Dot {
    let spin = 0.5; let cx = size / 2.0; let cy = size / 2.0; let radius = (size / 2.0) * 0.82;
    let tilt = 0.4 + 0.06 * sin(t * 0.35);
    let scan = t * (spin + (1.7 - spin) * opt(OPT_scanMul));
    let rs = radiusScale(size, opt(OPT_rsPow)); let dimBase = opt(OPT_dimBase);
    let ll = latlon(i, u32(opt(OPT_latRings)), opt(OPT_lonDensity));
    let cosLat = cos(ll.lat); let sinLat = sin(ll.lat);
    let p = proj(vec3f(cosLat * cos(ll.lon), sinLat, cosLat * sin(ll.lon)), t * spin, tilt, cx, cy, radius);
    let depth = (p.z + 1.0) / 2.0;
    // the scan: a moving meridian read as a size ripple, not a shine
    let d = angleDelta(ll.lon + t * spin, scan);
    let boost = exp(-(d * d) / 0.18) * max(0.0, p.z);
    return mkdot(p, (opt(OPT_rBase) + opt(OPT_rDepth) * depth + opt(OPT_rBoost) * boost) * rs, opt(OPT_inkFar) - opt(OPT_inkSpan) * depth, dimBase + (1.0 - dimBase) * min(1.0, boost));
}

// Rubik: bands twist in quarter turns, scramble → solve — "solving"
struct Cycle { slotAmount: f32, slot: i32, act: i32 }
/** Rapid eased moves scramble, then replay in reverse (palindrome), rest, repeat. */
fn solveCycle(time: f32, count: i32, slotDur: f32, rest: f32) -> Cycle {
    let cyc = 2.0 * f32(count) * slotDur + rest; let tc = time - floor(time / cyc) * cyc;
    var c: Cycle; c.act = -1; c.slot = -1; c.slotAmount = 0.0;
    if (tc < 2.0 * f32(count) * slotDur) {
        let slot = i32(floor(tc / slotDur)); let p = (tc - f32(slot) * slotDur) / slotDur;
        let cl = min(1.0, p / 0.7); let ep = 1.0 - pow(1.0 - cl, 3.0);   // machine ease-out
        if (slot < count) { c.slot = slot; c.slotAmount = ep; c.act = slot; }
        else { let uu = 2 * count - 1 - slot; c.slot = uu; c.slotAmount = 1.0 - ep; c.act = uu; }
    }
    return c;
}
fn moveAmount(i: i32, c: Cycle) -> f32 { if (c.slot < 0) { return 0.0; } if (i < c.slot) { return 1.0; } if (i == c.slot) { return c.slotAmount; } return 0.0; }
struct Moved { p: vec3f, inActive: bool }
fn applyMoves(p0: vec3f, count: i32, c: Cycle) -> Moved {
    var p = p0; var m: Moved; m.inActive = false;
    for (var i = 0; i < count; i++) {
        let amount = moveAmount(i, c); if (amount <= 0.0) { continue; }
        let fi = f32(i);
        let axis = min(2, i32(floor(hashD(fi, 2.3) * 3.0)));
        let lo = -1.0 + 0.5 * min(3.0, floor(hashD(fi, 5.9) * 4.0)); let hi = lo + 0.5;
        let dir = select(-1.0, 1.0, hashD(fi, 7.7) < 0.5);
        let coord = select(select(p.z, p.y, axis == 1), p.x, axis == 0);
        if (coord < lo || coord >= hi) { continue; }
        if (i == c.act) { m.inActive = true; }
        let a = dir * PI / 2.0 * amount; let ca = cos(a); let sa = sin(a);
        if (axis == 0) { let y2 = p.y * ca - p.z * sa; p.z = p.y * sa + p.z * ca; p.y = y2; }
        else if (axis == 1) { let x2 = p.x * ca + p.z * sa; p.z = -p.x * sa + p.z * ca; p.x = x2; }
        else { let x2 = p.x * ca - p.y * sa; p.y = p.x * sa + p.y * ca; p.x = x2; }
    }
    m.p = p; return m;
}
fn dot_rubik(i: u32, size: f32, t: f32) -> Dot {
    let cx = size / 2.0; let cy = size / 2.0; let R = (size / 2.0) * 0.82;
    let rs = radiusScale(size, opt(OPT_rsPow)); let moveCount = i32(opt(OPT_moveCount));
    let sc = solveCycle(t, moveCount, 0.42, 1.2);
    let ll = latlon(i, u32(opt(OPT_latRings)), opt(OPT_lonDensity));
    let cosLat = cos(ll.lat); let sinLat = sin(ll.lat);
    let mv = applyMoves(vec3f(cosLat * cos(ll.lon), sinLat, cosLat * sin(ll.lon)), moveCount, sc);
    let p = proj(mv.p, t * 0.55, 0.35 + 0.1 * sin(t * 0.9), cx, cy, R);
    let depth = (p.z + 1.0) / 2.0;
    // the band being turned inks a touch darker — the "hand"
    let act = select(0.0, 1.0, mv.inActive);
    return mkdot(p, (opt(OPT_rBase) + opt(OPT_rDepth) * depth + act * opt(OPT_rActive)) * rs, opt(OPT_inkFar) - opt(OPT_inkSpan) * depth - act * 0.14, 1.0);
}

// Wave: a waveform rolls through the rings — "listening"
fn dot_wave(i: u32, size: f32, t: f32) -> Dot {
    let cx = size / 2.0; let cy = size / 2.0;
    let R = (size / 2.0) * 0.874;   // 0.76 × 1.15: the undulation pulls the sphere inward, so it is scaled up to match the others
    let rs = radiusScale(size, opt(OPT_rsPow)); let rings = u32(opt(OPT_rings));
    let ll = latlon(i, rings, opt(OPT_lonDensity));
    let ri = round((ll.lat + PI / 2.0) / PI * f32(rings));
    let cosLat = cos(ll.lat); let sinLat = sin(ll.lat);
    // two waves, different tempi — organic, never quite repeating
    let w = (0.62 * sin(t * 2.1 - ri * 0.52) + 0.38 * sin(t * 1.27 + ri * 0.83)) * opt(OPT_waveAmp);
    let rr = R * (0.88 + 0.105 * w);
    let p = proj(vec3f(cosLat * cos(ll.lon) * rr, sinLat * rr, cosLat * sin(ll.lon) * rr), t * 0.18, 0.38, cx, cy, 1.0);
    let depth = (p.z / R + 1.0) / 2.0; let crest = max(0.0, w);
    return mkdot(p, (opt(OPT_rBase) + opt(OPT_rDepth) * depth) * (1.0 + 0.4 * crest) * rs, 0.66 - 0.56 * depth - 0.1 * crest, 1.0);
}

// —— ribbon.ts · an undulating sash rides a great circle — "composing" ———————
fn dot_ribbon(i: u32, size: f32, t: f32) -> Dot {
    let cx = size / 2.0; let cy = size / 2.0; let R = (size / 2.0) * 0.78;
    let spin = opt(OPT_spin); let rs = radiusScale(size, opt(OPT_rsPow));
    let ghostN = u32(opt(OPT_ghostN));
    if (i < ghostN) {
        let d = fibDir(f32(i), f32(ghostN));
        let p = proj(d * R, t * 0.1 * spin, 0.3, cx, cy, 1.0);
        let depth = (p.z / R + 1.0) / 2.0;
        return mkdot(p, 0.8 * rs, 0.78, 0.1 + 0.22 * depth);
    }
    // the band plane, precessing (frozen when spin=0)
    let ya = t * 0.24 * spin; let ta = 0.55 + 0.3 * sin(t * 0.18) * spin;
    let ux = cos(ya); let uy = 0.0; let uz = sin(ya);
    let vx = -uz * sin(ta); let vy = cos(ta); let vz = ux * sin(ta);
    let nx = uy * vz - uz * vy; let ny = uz * vx - ux * vz; let nz = ux * vy - uy * vx;   // plane normal n = u × v
    let segs = u32(opt(OPT_segs)); let lanes = max(1u, u32(round(opt(OPT_lanes) * opt(OPT_bandMul))));
    let j = i - ghostN; let w = f32(j / segs); let k = j % segs;
    let lanesf = f32(lanes);
    let laneOff = (w - (lanesf - 1.0) / 2.0) * 0.075;
    let edge = abs(w - (lanesf - 1.0) / 2.0) / max(1.0, (lanesf - 1.0) / 2.0);
    let a = (f32(k) / f32(segs)) * 2.0 * PI;
    // the undulation: two traveling waves along the band; wobMul scales the deformation — 0 is a clean band
    let wob = (0.16 * sin(a * 3.0 - t * 1.7 + w * 0.22) + 0.07 * sin(a * 5.0 + t * 1.1)) * opt(OPT_wobMul);
    let off = laneOff + wob;
    let x = ux * cos(a) + vx * sin(a) + nx * off; let y = uy * cos(a) + vy * sin(a) + ny * off; let z = uz * cos(a) + vz * sin(a) + nz * off;
    let l = sqrt(x * x + y * y + z * z);
    let p = proj(vec3f(x / l * R, y / l * R, z / l * R), t * 0.1 * spin, 0.3, cx, cy, 1.0);
    let depth = (p.z / R + 1.0) / 2.0;
    return mkdot(p, (opt(OPT_rBase) + opt(OPT_rDepth) * depth) * (1.0 - 0.25 * edge) * rs, 0.52 - 0.44 * depth + 0.18 * edge, 0.4 + 0.6 * depth);
}

// —— morph.ts · a dotted outline cycling circle → triangle → square — "shaping"
fn smoothE(x: f32) -> f32 { return x * x * (3.0 - 2.0 * x); }
/** A closed polygon parameterised by arc length (top-centre start, clockwise). */
fn polyPath(f: f32, V: i32, verts: array<vec2f, 5>) -> vec2f {
    var total = 0.0;
    for (var i = 0; i < V; i++) { total += distance(verts[i], verts[(i + 1) % V]); }
    var tgt = f * total; var i = 0;
    loop { let l = distance(verts[i], verts[(i + 1) % V]); if (tgt > l && i < V - 1) { tgt -= l; i++; } else { break; } }
    let a = verts[i]; let bb = verts[(i + 1) % V]; let l = distance(a, bb);
    let ff = select(0.0, min(1.0, tgt / l), l > 0.0);
    return a + (bb - a) * ff;
}
fn shapePath(k: i32, f: f32) -> vec2f {
    if (k == 0) { let a = -PI / 2.0 + f * 2.0 * PI; return vec2f(cos(a) * 0.24, sin(a) * 0.24); }   // CIRCLE
    if (k == 1) { return polyPath(f, 3, array<vec2f, 5>(vec2f(0.0, -0.26), vec2f(0.24, 0.16), vec2f(-0.24, 0.16), vec2f(0.0), vec2f(0.0))); }   // TRIANGLE
    // SQUARE: a 5-vertex walk so the path STARTS at top-centre like the other shapes
    return polyPath(f, 5, array<vec2f, 5>(vec2f(0.0, -0.2), vec2f(0.2, -0.2), vec2f(0.2, 0.2), vec2f(-0.2, 0.2), vec2f(-0.2, -0.2)));
}
const MORPH_HOLD: f32 = 1.4; const MORPH_MORPH: f32 = 0.9; const MORPH_M: i32 = 160;
fn blendedPt(k: i32, m: f32, sprd: f32, f: f32) -> vec2f { let a = shapePath(k, f); let b = shapePath((k + 1) % 3, f); return (a + (b - a) * m) * sprd; }
fn dot_morph(i: u32, size: f32, t: f32) -> Dot {
    let SEG = MORPH_HOLD + MORPH_MORPH; let K = 3;
    let tc = t - floor(t / (SEG * f32(K))) * (SEG * f32(K)); let k = i32(floor(tc / SEG)); let local = tc - f32(k) * SEG;
    let m = select(0.0, smoothE((local - MORPH_HOLD) / MORPH_MORPH), local > MORPH_HOLD);
    let sprd = opt(OPT_spread);
    // measure the blended outline, then lay dot i at its share of the total arc length
    var total = 0.0;
    for (var s = 0; s < MORPH_M; s++) { total += distance(blendedPt(k, m, sprd, f32(s) / f32(MORPH_M)), blendedPt(k, m, sprd, f32(s + 1) / f32(MORPH_M))); }
    let n = max(6.0, round(34.0 * opt(OPT_iconD)));
    let tgt = (f32(i) / n) * total;
    var acc = 0.0; var seg = 0; var segLen = 0.0;
    for (var s = 0; s < MORPH_M; s++) {
        segLen = distance(blendedPt(k, m, sprd, f32(s) / f32(MORPH_M)), blendedPt(k, m, sprd, f32(s + 1) / f32(MORPH_M)));
        if (acc + segLen < tgt && s < MORPH_M - 1) { acc += segLen; } else { seg = s; break; }
    }
    let a = blendedPt(k, m, sprd, f32(seg) / f32(MORPH_M)); let b = blendedPt(k, m, sprd, f32(seg + 1) / f32(MORPH_M));
    let f = select(0.0, min(1.0, (tgt - acc) / segLen), segLen > 0.0);
    // dot radius depends ONLY on rDot; formed shapes breathe a little (uniform pulse)
    let pulse = 1.0 + 0.02 * sin(local * 3.1);
    let re = opt(OPT_rDot) * 1.35 * sprd;
    let q = (a + (b - a) * f) * pulse; let c2 = size / 2.0;
    return mkdot(vec3f(c2 + q.x * size, c2 + q.y * size, 0.0), max(0.35, re * size), 0.1, 1.0);
}

// —— the sprite pipeline ————————————————————————————————————————————————————
struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) r: f32, @location(2) g: f32, @location(3) a: f32 }
fn sprite(d: Dot, vi: u32, size: f32) -> VOut {
    var corner = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
    let r = max(opt(OPT_rMin), d.r) * u.zoom; let ext = r + 1.0;
    let px = vec2f(d.x, d.y) * u.zoom + corner[vi] * ext;
    let cell = u.size * u.pixelScale;
    // centre the preset frame in the cell
    let frame = size * u.zoom; let off = (cell - vec2f(frame)) * 0.5;
    let ndc = (px + off) / cell * 2.0 - 1.0;
    let zR = size / 2.0;
    let depth = clamp(1.0 - (d.z / zR + 1.0) / 2.0, 0.0, 1.0) * 0.98 + 0.01;
    var o: VOut; o.pos = vec4f(ndc.x, -ndc.y, depth, 1.0); o.uv = corner[vi] * ext; o.r = r; o.g = 1.0 - clamp(d.white, 0.0, 1.0); o.a = d.a;   // dark substrate: ink mirrored, near dots read bright
    // the pass this sprite belongs to: opaque dots write depth, translucent ghosts come after without writing
    let opaque = d.a >= 0.95;
    if ((u.layer < 0.5) != opaque) { o.pos = vec4f(0.0, 0.0, 2.0, 1.0); }
    return o;
}
@fragment fn fs_main(in: VOut) -> @location(0) vec4f {
    let dist = length(in.uv);
    let cov = 1.0 - smoothstep(in.r - 0.7, in.r + 0.7, dist);
    let alpha = in.a * cov; if (alpha < 0.01) { discard; }
    let col = mix(u.ink.rgb, u.cream.rgb, in.g);
    return vec4f(col * alpha, alpha);
}
@vertex fn vs_orbits(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut { let s = opt(OPT_size); return sprite(dot_orbits(ii, s, u.time), vi, s); }
@vertex fn vs_globe(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut { let s = opt(OPT_size); return sprite(dot_globe(ii, s, u.time), vi, s); }
@vertex fn vs_rubik(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut { let s = opt(OPT_size); return sprite(dot_rubik(ii, s, u.time), vi, s); }
@vertex fn vs_wave(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut { let s = opt(OPT_size); return sprite(dot_wave(ii, s, u.time), vi, s); }
@vertex fn vs_ribbon(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut { let s = opt(OPT_size); return sprite(dot_ribbon(ii, s, u.time), vi, s); }
@vertex fn vs_morph(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut { let s = opt(OPT_size); return sprite(dot_morph(ii, s, u.time), vi, s); }
// the shell needs a vs_main; the page builds its pipelines from vs_<mode>
@vertex fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut { let s = opt(OPT_size); return sprite(dot_orbits(ii, s, u.time), vi, s); }
