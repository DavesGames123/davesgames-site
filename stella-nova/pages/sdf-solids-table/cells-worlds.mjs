// ============================================================================
//  SDF SOLIDS TABLE  ·  cells-worlds.mjs — mechanisms, fractals, organic, scenes
// ────────────────────────────────────────────────────────────────────────────
//  The same cell rows as cells.mjs: [name, family, species, knobs, decl, body,
//  opts]. build.mjs reads CELLS_WORLDS from here. Fractal distance estimates
//  follow the published methods: Menger and Apollonian after Quilez, the
//  Sierpinski fold and KIFS after Knighty and Syntopia, the Mandelbox after
//  Lowe, the quaternion Julia bound after Hart, Sandin and Kauffman 1989.
//  Phyllotaxis uses the golden angle on a lattice of 8 and 13 parastichies.
//  The layouts, the shading and the motion are original.
//
//  GREP MAP
//    // ---- mechanisms .. Borromean rings, gears, bearing, cradle, gimbal, cube
//    // ---- fractals .... Menger, Sierpinski, Mandelbox, Julia, Apollonian, KIFS
//    // ---- organic ..... gyroid lattice, nautilus, coral, mushrooms, pine
//                          cone, melting chocolate
//    // ---- scenes ...... glass sphere on granite, cairn, floating island,
//                          colonnade
// ============================================================================
import { hit, onStage, glassBody } from './cells.mjs';

export const CELLS_WORLDS = [
  // ---- mechanisms ------------------------------------------------------------
  ['borromean', 'mechanisms', 'Borromean rings: three stadium rings (elongated tori) in gold, silver and copper; no two link',
   ['tube', 'stretch', '', ''],
   `fn borRing(q: vec3f, h: f32, r: f32) -> f32 {
    let e = vec3f(q.x - clamp(q.x, -h, h), q.y, q.z);
    return length(vec2f(length(e.xz) - 0.3, e.y)) - r;
}
fn borLocal(p0: vec3f) -> vec3f { return spin(p0, u.time * 0.3 + 0.62, 0.55 + 0.25 * sin(u.time * 0.23)); }
fn borParts(p0: vec3f) -> vec3f {
    let p = borLocal(p0);
    let h = mix(0.38, 0.6, u.k.y); let r = mix(0.05, 0.11, u.k.x);
    return vec3f(borRing(vec3f(p.x, p.z, p.y), h, r), borRing(vec3f(p.y, p.x, p.z), h, r), borRing(vec3f(p.z, p.y, p.x), h, r));
}
fn map_borromean(p: vec3f) -> f32 { let d = borParts(p); return min(d.x, min(d.y, d.z)); }`,
   `${hit('borromean')}
  let d = borParts(p);
  var tint = vec3f(1.0, 0.76, 0.38);
  if (d.y < d.x && d.y < d.z) { tint = vec3f(0.92, 0.93, 0.96); }
  if (d.z < d.x && d.z < d.y) { tint = vec3f(0.98, 0.55, 0.42); }
  return finish(metal(rd, n, tint, 0.1, occ), uv);`,
   { def: [0.5, 0.5, 0.5, 0.5] }],

  ['gear_train', 'mechanisms', 'three spur gears of 14, 9 and 7 teeth on a plate; each turns at the ratio of its tooth count',
   ['speed', 'tilt', '', ''],
   `fn gear2(p: vec2f, n: f32, r: f32) -> f32 {
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
fn map_gear_train(p: vec3f) -> f32 { let d = gearParts(p); return min(min(d.x, d.y), min(d.z, d.w)); }`,
   `${hit('gear_train')}
  let d = gearParts(p);
  let m = min(min(d.x, d.y), min(d.z, d.w));
  if (d.x == m) { return finish(metal(rd, n, vec3f(1.0, 0.78, 0.42), 0.14, occ), uv); }
  if (d.y == m) { return finish(metal(rd, n, vec3f(0.86, 0.88, 0.92), 0.08, occ), uv); }
  if (d.z == m) { return finish(metal(rd, n, vec3f(0.98, 0.56, 0.4), 0.14, occ), uv); }
  let q = gearM() * p;
  let brushed = 0.9 + 0.1 * sin(q.x * 300.0 + gnoise(q * 8.0) * 3.0);
  return finish(dielectric(rd, n, vec3f(0.05, 0.06, 0.08) * brushed, 0.35, occ, 1.0), uv);`,
   { def: [0.5, 0.5, 0.5, 0.5] }],

  ['ball_bearing', 'mechanisms', 'a deep-groove ball bearing: ten balls in a brass cage roll between turning races',
   ['speed', 'tilt', '', ''],
   `fn brgM() -> mat3x3f { return rotX(-mix(0.6, 1.2, u.k.y)) * rotY(0.3); }
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
fn map_ball_bearing(p: vec3f) -> f32 { let d = brgParts(p); return min(min(d.x, d.y), min(d.z, d.w)); }`,
   `${hit('ball_bearing')}
  let d = brgParts(p);
  let m = min(min(d.x, d.y), min(d.z, d.w));
  if (d.y == m) { return finish(metal(rd, n, vec3f(0.95, 0.96, 0.98), 0.02, occ), uv); }
  if (d.z == m) { return finish(metal(rd, n, vec3f(1.0, 0.74, 0.4), 0.2, occ), uv); }
  if (d.w == m) { return finish(metal(rd, n, vec3f(0.28, 0.3, 0.34), 0.3, occ), uv); }
  let q = brgM() * p;
  let lap = 0.92 + 0.08 * sin(length(q.xz) * 500.0);
  return finish(metal(rd, n, vec3f(0.8, 0.82, 0.86) * lap, 0.1, occ), uv);`,
   { def: [0.4, 0.4, 0.5, 0.5] }],

  ['newton_cradle', 'mechanisms', 'a Newton cradle of five chrome balls on V-strings; the end balls swing and pass the knock along',
   ['swing', 'pace', '', ''],
   `fn ncBall(i: i32) -> vec3f {
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
fn map_newton_cradle(p: vec3f) -> f32 { let d = ncParts(p); return min(d.x, min(d.y, d.z)); }`,
   `${onStage('newton_cradle', '-0.93')}
  let d = ncParts(p);
  if (d.x < d.y && d.x < d.z) { return finish(metal(rd, n, vec3f(0.94, 0.95, 0.97), 0.02, occ), uv); }
  if (d.y < d.z) { return finish(envDiff(n) * vec3f(0.85, 0.82, 0.75) * occ, uv); }
  return finish(dielectric(rd, n, vec3f(0.02), 0.08, occ, sh), uv);`,
   { br: 1.45, def: [0.5, 0.5, 0.5, 0.5] }],

  ['gimbal', 'mechanisms', 'a three-axis gimbal with degree ticks round each ring and a flywheel spinning at the centre',
   ['rate', 'ticks', '', ''],
   `fn gbRing(q: vec3f, R: f32) -> f32 { return sdBox2(vec2f(length(q.xy) - R, q.z), vec2f(0.035, 0.07)) - 0.01; }
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
fn map_gimbal(p: vec3f) -> f32 { let d = gbParts(p); return min(min(d.x, d.y), min(d.z, d.w)); }`,
   `${hit('gimbal')}
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
  return finish(metal(rd, n, tint * (1.0 - 0.8 * tick * step(0.065, abs(q.z) + 0.0001)), 0.14, occ) * (1.0 - 0.6 * tick), uv);`,
   { def: [0.5, 0.7, 0.5, 0.5] }],

  ['puzzle_cube', 'mechanisms', 'a three-by-three twisting puzzle cube: limited repetition per layer, one layer turning',
   ['turn', 'bevel', '', ''],
   `fn pcAng() -> f32 {
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
}`,
   `${hit('puzzle_cube')}
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
  return finish(dielectric(rd, n, alb, 0.1, occ, 1.0), uv);`,
   { def: [0.3, 0.4, 0.5, 0.5] }],

  // ---- fractals --------------------------------------------------------------
  ['menger_sponge', 'fractals', 'a level-three Menger sponge in porcelain, its tunnels glowing deeper the further in they run',
   ['glow', 'turn', '', ''],
   `fn mgLocal(p0: vec3f) -> vec3f { return spin(p0, u.time * 0.25 + 0.62, 0.6) / 0.78; }
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
}`,
   `${hit('menger_sponge')}
  let q = mgLocal(p);
  let depth = 1.0 - max(abs(q.x), max(abs(q.y), abs(q.z)));
  let glowC = mix(cTone(), vec3f(1.0, 0.35, 0.5), smoothstep(0.1, 0.6, depth)) * mix(0.5, 3.0, k.x);
  let c = dielectric(rd, n, vec3f(0.92, 0.9, 0.86), 0.25, occ, 1.0) * mix(1.0, 0.3, smoothstep(0.02, 0.4, depth)) + glowC * smoothstep(0.03, 0.7, depth) * (1.2 - occ * 0.6);
  return finish(c, uv);`,
   { def: [0.5, 0.5, 0.5, 0.5] }],

  ['sierpinski_tet', 'fractals', 'a Sierpinski tetrahedron by six reflective folds, in iridescent bismuth',
   ['depth', 'film', '', ''],
   `fn spLocal(p0: vec3f) -> vec3f { return rotY(0.78) * (rotX(-0.42) * (rotY(u.time * 0.3 + 0.2) * (p0 + vec3f(0.0, 0.05, 0.0)))) * 1.3; }
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
}`,
   `${hit('sierpinski_tet')}
  let q = spLocal(p);
  let ci = clamp(-dot(rd, n), 0.0, 1.0);
  let th = 300.0 + mix(120.0, 380.0, k.y) * (0.5 + 0.5 * sin(q.y * 2.2 + length(q.xz) * 1.5 + 0.8));
  let tint = mix(vec3f(1.0, 0.8, 0.5), film(th, ci, 2.1) * 1.5, 0.45);
  return finish(metal(rd, n, tint, 0.22, occ * occ) + envDiff(n) * tint * 0.1 * occ, uv);`,
   { def: [0.6, 0.5, 0.5, 0.5] }],

  ['mandelbox_slice', 'fractals', 'a slab cut from a Mandelbox: box fold, sphere fold, scale; chalk white with an orange orbit trap',
   ['scale', 'slab', '', ''],
   `fn mbLocal(p0: vec3f) -> vec3f { return spin(p0, 0.45 + 0.4 * sin(u.time * 0.25), 0.5 + 0.2 * sin(u.time * 0.31)); }
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
}`,
   `${hit('mandelbox_slice')}
  let q = mbLocal(p);
  let tr = mbox(q * 5.6).y;
  let cut = abs(q.z - mix(-0.5, 0.6, k.y) - 0.3 * sin(t * 0.4)) < 0.004;
  let alb = mix(vec3f(1.0, 0.5, 0.15), vec3f(0.92, 0.9, 0.86), smoothstep(0.0, 0.6, tr));
  var c = dielectric(rd, n, select(alb, alb * vec3f(0.85, 0.9, 1.0), cut), 0.5, occ, 1.0);
  c *= 0.5 + 0.5 * occ;
  return finish(c, uv);`,
   { br: 1.5, def: [0.5, 0.45, 0.5, 0.5] }],

  ['quat_julia', 'fractals', 'a quaternion Julia set sliced into 3D, its constant orbiting; colored by the orbit trap',
   ['orbit', 'gloss', '', ''],
   `fn qjC() -> vec4f { return vec4f(-0.291, -0.399, 0.339, 0.437) + 0.12 * sin(u.time * mix(0.1, 0.6, u.k.x) * vec4f(1.0, 1.3, 0.7, 1.7) + vec4f(0.0, 1.0, 2.0, 3.0)); }
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
fn map_quat_julia(p0: vec3f) -> f32 { return qj(qjLocal(p0)).x * 0.48; }`,
   `${hit('quat_julia')}
  let tr = qj(qjLocal(p)).y;
  let alb = mix(vec3f(0.95, 0.72, 0.38), mix(vec3f(0.2, 0.25, 0.75), cTone(), 0.3), smoothstep(0.15, 0.9, sqrt(tr)));
  return finish(dielectric(rd, n, alb * 0.85, mix(0.4, 0.02, k.y), occ, 1.0), uv);`,
   { br: 1.45, def: [0.5, 0.7, 0.5, 0.5] }],

  ['apollonian', 'fractals', 'an Apollonian packing by repeated sphere inversion, cut by a sphere like a geode',
   ['inversion', 'cut', '', ''],
   `fn apLocal(p0: vec3f) -> vec3f { return spin(p0, u.time * 0.2 + 0.4, 0.35); }
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
}`,
   `${hit('apollonian')}
  let q = apLocal(p);
  let o = apo(q * 3.0).y;
  let shell = abs(length(q) - mix(0.75, 1.0, k.y)) < 0.004;
  var alb = mix(vec3f(0.1, 0.25, 0.75), vec3f(0.95, 0.93, 0.88), smoothstep(0.1, 0.6, o));
  alb = mix(alb, vec3f(0.95, 0.65, 0.25), smoothstep(0.75, 1.0, o) * 0.8);
  if (shell) { alb = vec3f(0.92, 0.9, 0.86); }
  return finish(dielectric(rd, n, alb, 0.3, occ, 1.0) * (0.4 + 0.6 * occ), uv);`,
   { def: [0.5, 0.6, 0.5, 0.5] }],

  ['kifs_crystal', 'fractals', 'a quartz cluster folded kaleidoscopically: a five-fold and a mirror fold place hexagonal points, in dispersive glass',
   ['spread', 'fire', '', ''],
   `// one quartz point along +y: a hexagonal prism of half width w and length l with a six-sided tip
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
}`,
   glassBody('kifs_crystal', '1.55', 'mix(0.02, 0.12, k.y)', 'vec3f(0.12, 0.3, 0.05)'),
   { br: 1.45, def: [0.5, 0.6, 0.5, 0.5] }],

  // ---- organic ---------------------------------------------------------------
  ['gyroid_lattice', 'organic', 'a graded gyroid shell lattice in a rounded cube: thin at the top, dense at the base, matte nylon',
   ['cells', 'grade', '', ''],
   `fn gyLocal(p0: vec3f) -> vec3f { return spin(p0, u.time * 0.25 + 0.75, 0.55); }
fn map_gyroid_lattice(p0: vec3f) -> f32 {
    let p = gyLocal(p0);
    let sc = mix(4.0, 10.0, u.k.x);
    let q = p * sc;
    let g = dot(sin(q), cos(q.zxy)) / sc;
    let th = mix(0.02, 0.12, smoothstep(0.7, -0.7, p.y) * mix(0.2, 1.0, u.k.y) + 0.1);
    return max(rbox(p, vec3f(0.68), 0.08), (abs(g) - th) * 0.6);
}`,
   `${hit('gyroid_lattice')}
  let q = gyLocal(p);
  let grain = 0.94 + 0.06 * hash3(q * 600.0).x;
  let alb = vec3f(0.9, 0.88, 0.84) * grain;
  let bleed = mix(cTone(), vec3f(1.0, 0.45, 0.3), 0.5) * (1.0 - occ) * 0.25;
  let c = envDiff(n) * alb * (0.25 + 0.75 * occ) + bleed * envDiff(n) + env(reflect(rd, n)) * 0.02 * occ;
  return finish(c, uv);`,
   { def: [0.62, 0.8, 0.5, 0.5] }],

  ['nautilus', 'organic', 'a nautilus shell on a logarithmic spiral, a quarter cut away to show the chambers and septa in nacre',
   ['growth', 'stripes', '', ''],
   `fn ntLocal(p0: vec3f) -> vec3f { return spin(p0, 0.3 * sin(u.time * 0.3) - 0.7, -1.25) / 1.2 + vec3f(0.12, 0.0, 0.1); }
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
}`,
   `${hit('nautilus')}
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
  return finish(dielectric(rd, n, alb, 0.12, occ, 1.0), uv);`,
   { def: [0.6, 0.85, 0.5, 0.5] }],

  ['coral_branch', 'organic', 'branching coral grown by mirror folds: each step folds, turns, tilts and shrinks, swaying in a current',
   ['spread', 'sway', '', ''],
   `fn coralParts(p0: vec3f) -> vec2f {
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
fn map_coral_branch(p: vec3f) -> f32 { return coralParts(p).x; }`,
   `${onStage('coral_branch', '-0.98')}
  let cp = coralParts(p);
  let f = cp.y / 4.0;
  let polyp = smoothstep(0.3, 0.7, gnoise(p * 55.0));
  let alb = mix(mix(vec3f(0.35, 0.08, 0.3), vec3f(0.95, 0.3, 0.35), f), vec3f(1.0, 0.75, 0.55), smoothstep(0.7, 1.0, f));
  let ci = clamp(-dot(rd, n), 0.0, 1.0);
  let sss = alb * pow(1.0 - ci, 2.0) * 0.4 + alb * envDiff(-n) * 0.15;
  return finish(dielectric(rd, n, alb * (1.0 - 0.25 * polyp), 0.5, occ, sh) + sss * occ, uv);`,
   { br: 1.45, def: [0.5, 0.5, 0.5, 0.5] }],

  ['glow_mushrooms', 'organic', 'five mushrooms on a mossy mound: tan caps with pale spots, gills glowing with bioluminescence',
   ['glow', 'spots', '', ''],
   `fn msData(i: i32) -> vec4f {
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
fn map_glow_mushrooms(p: vec3f) -> f32 { let d = msParts(p); return min(min(d.x, d.y), min(d.z, d.w)) * 0.88; }`,
   `  let glowC = mix(vec3f(0.2, 1.0, 0.75), cTone(), 0.25) * mix(0.3, 2.5, k.x);
${hit('glow_mushrooms')}
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
  return finish(c, uv);`,
   { def: [0.6, 0.7, 0.5, 0.5] }],

  ['pine_cone', 'organic', 'a pine cone: scales placed by the golden angle, found through the 8 and 13 parastichy lattice',
   ['open', 'weather', '', ''],
   `fn pcR(y: f32) -> f32 {
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
fn map_pine_cone(p: vec3f) -> f32 { return pineParts(p).x; }`,
   `${hit('pine_cone')}
  let q = pineLocal(p);
  let pp = pineParts(p);
  let hv = hash3(vec3f(pp.y, 2.0, 5.0)).x;
  let tipv = smoothstep(0.2, 0.5, length(q.xz) - pcR(q.y) * 0.72);
  var alb = mix(vec3f(0.3, 0.16, 0.07), vec3f(0.55, 0.36, 0.2), tipv) * (0.8 + 0.4 * hv);
  alb = mix(alb, vec3f(0.62, 0.6, 0.55), smoothstep(0.55, 0.9, fbm3(q * 7.0, 3) + 0.3) * k.y);
  return finish(dielectric(rd, n, alb, 0.5, occ, 1.0), uv);`,
   { br: 1.3, def: [0.5, 0.4, 0.5, 0.5] }],

  ['melt_drip', 'organic', 'chocolate melting off a truffle on a plaster pedestal: drips stretch, bead and fall into a pool',
   ['flow', 'gloss', '', ''],
   `fn mdParts(p0: vec3f) -> vec2f {
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
fn map_melt_drip(p: vec3f) -> f32 { let d = mdParts(p); return min(d.x, d.y); }`,
   `${onStage('melt_drip', '-0.99')}
  let d = mdParts(p);
  if (d.x < d.y) { return finish(dielectric(rd, n, vec3f(0.9, 0.88, 0.84), 0.7, occ, sh), uv); }
  return finish(dielectric(rd, n, vec3f(0.11, 0.045, 0.02), mix(0.25, 0.02, k.y), occ, sh) * 1.2, uv);`,
   { def: [0.5, 0.8, 0.5, 0.5] }],

  // ---- scenes ----------------------------------------------------------------
  ['glass_on_granite', 'scenes', 'a glass sphere on polished black granite: it focuses the key light to a caustic in its shadow',
   ['orbit', 'polish', '', ''],
   `// the scene in closed form: a glass ball, a gold ball and a ruby ball on a plane
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
}`,
   `  let c = ggC();
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
  return finish(col, uv);`,
   { def: [0.5, 0.7, 0.5, 0.5] }],

  ['pebble_cairn', 'scenes', 'a cairn of five river pebbles in basalt, granite, quartz, jasper and serpentine, wet and gently rocking',
   ['wobble', 'wet', '', ''],
   `fn pbData(i: i32) -> vec4f {
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
fn map_pebble_cairn(p: vec3f) -> f32 { return pbParts(p).x; }`,
   `${onStage('pebble_cairn', '-0.98')}
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
  return finish(dielectric(rd, n, alb, mix(0.6, 0.06, k.y), occ, sh), uv);`,
   { def: [0.5, 0.6, 0.5, 0.5] }],

  ['floating_island', 'scenes', 'a floating island: grass on a cone of layered rock, one tree, a waterfall pouring off the edge',
   ['bob', 'falls', '', ''],
   `fn fiY() -> f32 { return 0.05 * sin(u.time * 0.8) * mix(0.0, 2.0, u.k.x); }
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
fn map_floating_island(p: vec3f) -> f32 { let d = fiParts(p); return min(min(d.x, d.y), min(d.z, d.w)); }`,
   `${hit('floating_island')}
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
  return finish(c, uv);`,
   { def: [0.5, 0.5, 0.5, 0.5] }],

  ['colonnade', 'scenes', 'an endless colonnade by domain repetition, walked through at dusk with soft column shadows and fog',
   ['walk', 'sun', '', ''],
   `fn colMap(p: vec3f) -> vec2f {
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
}`,
   `  let z0 = -t * mix(0.1, 0.8, k.x) * 1.4 + 0.7;
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
  return finish(c + sunGlow * fog, uv);`,
   { def: [0.4, 0.75, 0.5, 0.5] }],
];
