// ============================================================================
//  SDF SOLIDS TABLE  ·  cells-forms.mjs — primitives, operators, materials, lathe
// ────────────────────────────────────────────────────────────────────────────
//  The same cell rows as cells.mjs: [name, family, species, knobs, decl, body,
//  opts]. build.mjs reads CELLS_FORMS from here. The distance functions follow
//  the Quilez catalog of primitives and operators; the shading, the layouts
//  and the animation are original.
//
//  GREP MAP
//    // ---- primitives .. Quilez primitives as hero objects, one finish each
//    // ---- operators ... union, carving, intersection, onion, twist, bend,
//                          repetition, elongation, displacement, with ghosts
//    // ---- materials ... jade, wax, crackle glaze, velvet, brushed metal,
//                          carbon weave, turned wood, marble
//    // ---- lathe ....... revolved profiles: chess, wine glass, hourglass,
//                          teacup, bowling pin, spinning top
// ============================================================================
import { hit, onStage } from './cells.mjs';

// the thin-glass walk shared by the wine glass and the hourglass: up to five
// surface events. A glass wall refracts in, crosses the wall and refracts
// out. CONTENT is WGSL that runs when the ray meets the content; it must set
// done = true when the ray stops there. CMAP is the content distance at p.
const glassWalk = (m, gmap, content, fy, cmap) => `  var pos = ro; var dir = rd;
  var thr = vec3f(1.0); var col = vec3f(0.0);
  var done = false; var first = true;
  for (var b = 0; b < 5; b++) {
      let h = march_${m}(pos, dir);
      if (h < 0.0) { break; }
      let p = pos + dir * h;
      let n = nrm_${m}(p);
      if (map_${gmap}(p) < ${cmap}) {
          let fr = schlick(abs(dot(dir, n)), 0.04);
          col += thr * envT(reflect(dir, n)) * max(fr, 0.05) * 1.3;
          thr *= (1.0 - fr) * vec3f(0.97, 0.985, 0.98);
          let din = refract(dir, n, 1.0 / 1.5);
          let pin = p - n * 0.003;
          let L = thru_${gmap}(pin, din);
          let pe = pin + din * L;
          let ne = -nrm_${gmap}(pe);
          var dout = refract(din, ne, 1.5);
          if (dot(dout, dout) == 0.0) { dout = reflect(din, ne); }
          dir = dout; pos = pe + dir * 0.004;
      } else {
${content}
          if (done) { break; }
      }
      first = false;
  }
  if (!done) {
      if (dir.y < 0.0) {
          let pf = pos + dir * ((${fy} - pos.y) / dir.y);
          let fsh = shd_${m}(pf, normalize(KEY));
          col += thr * stageFloor(dir, pf, mix(0.55, 1.0, fsh), 1.0);
      } else {
          col += thr * select(envT(dir), backdrop(dir), first);
      }
  }`;

export const CELLS_FORMS = [
  // ---- primitives ------------------------------------------------------------
  ['box_frame', 'primitives', 'a brass box frame (Quilez sdBoxFrame) caging a glowing cube that turns against it',
   ['bar', 'glow', '', ''],
   `fn sdBoxFrame(p0: vec3f, b: vec3f, e: f32) -> f32 {
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
fn map_box_frame(p: vec3f) -> f32 { let d = bfParts(p); return min(d.x, d.y); }`,
   `  let glowC = mix(cTone(), vec3f(1.0, 0.5, 0.2), 0.6) * mix(1.0, 5.0, k.y);
  let bq = length(cross(ro, rd));
  let halo = glowC * 0.09 * exp(-bq * bq * 9.0);
${hit('box_frame', 'backdrop(rd) + halo')}
  let parts = bfParts(p);
  if (parts.y < parts.x) {
      let ci = clamp(-dot(rd, n), 0.0, 1.0);
      return finish(glowC * (1.2 + 1.0 * ci) + env(reflect(rd, n)) * 0.1, uv);
  }
  let lc = -normalize(p);
  let fall = 1.0 / (1.0 + 4.0 * dot(p, p));
  let c = metal(rd, n, vec3f(1.0, 0.76, 0.42), 0.16, occ) + glowC * (max(dot(n, lc), 0.0) * 0.9 + 0.1) * fall * occ;
  return finish(c + halo * 0.5, uv);`,
   { def: [0.4, 0.5, 0.5, 0.5] }],

  ['hex_nut', 'primitives', 'a chamfered hex nut (Quilez sdHexPrism) climbing a threaded rod in step with the helix',
   ['travel', 'zinc', '', ''],
   `fn sdHexPrism(p0: vec3f, h: vec2f) -> f32 {
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
fn map_hex_nut(p: vec3f) -> f32 { let d = nutParts(p); return min(d.x, d.y); }`,
   `${hit('hex_nut')}
  let parts = nutParts(p);
  let ci = clamp(-dot(rd, n), 0.0, 1.0);
  if (parts.y < parts.x) {
      let q = nutLocal(p);
      let th = 420.0 + 140.0 * fbm3(q * 1.3 + 4.0, 3) * mix(0.3, 1.6, k.y);
      let zinc = mix(vec3f(0.95, 0.84, 0.48), film(th, ci, 1.45) * 1.4, 0.38);
      return finish(metal(rd, n, zinc, 0.12, occ), uv);
  }
  return finish(metal(rd, n, vec3f(0.5, 0.52, 0.56), 0.28, occ), uv);`,
   { br: 1.45, def: [0.6, 0.5, 0.5, 0.5] }],

  ['chain_link', 'primitives', 'four interlocked chain links (Quilez sdLink), gold and gunmetal by turns, swinging',
   ['wire', 'swing', '', ''],
   `fn sdLink(p: vec3f, le: f32, r1: f32, r2: f32) -> f32 {
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
fn map_chain_link(p: vec3f) -> f32 { let d = chainParts(p); return min(d.x, d.y); }`,
   `${hit('chain_link')}
  let parts = chainParts(p);
  if (parts.x < parts.y) { return finish(metal(rd, n, vec3f(1.0, 0.72, 0.36), 0.1, occ), uv); }
  return finish(metal(rd, n, vec3f(0.3, 0.32, 0.36), 0.08, occ) + envDiff(n) * 0.02, uv);`,
   { def: [0.5, 0.5, 0.5, 0.5] }],

  ['octa_lacquer', 'primitives', 'an exact octahedron (Quilez) in vermilion lacquer with gold inlay along its edges',
   ['inlay', 'rounding', '', ''],
   `fn sdOcta(p0: vec3f, s: f32) -> f32 {
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
}`,
   `${hit('octa_lacquer')}
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
  return finish(mix(lac, inl, gold) * occ, uv);`,
   { def: [0.45, 0.3, 0.5, 0.5] }],

  ['cone_lamp', 'primitives', 'a table lamp: a capped-cone shade lit from inside, a rounded-cylinder base (Quilez)',
   ['dimmer', 'shade', '', ''],
   `fn sdRoundCyl(p: vec3f, ra: f32, rb: f32, h: f32) -> f32 {
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
fn map_cone_lamp(p: vec3f) -> f32 { let d = lampParts(p); return min(min(d.x, d.y), min(d.z, d.w)); }`,
   `  let warm = mix(vec3f(1.0, 0.6, 0.28), cCream(), 0.25) * mix(0.4, 2.2, k.x);
  let bp = vec3f(0.0, 0.3, 0.0);
${onStage('cone_lamp', '-0.99', 'stageFloor(rd, pf, fsh, fo) + warm * 0.35 * exp(-dot(pf.xz, pf.xz) * 1.6) * fo')}
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
  return finish(dielectric(rd, n, vec3f(0.025), 0.05, occ, sh) + lit * 0.15, uv);`,
   { br: 1.2, def: [0.6, 0.0, 0.5, 0.5] }],

  ['dish_moon', 'primitives', 'a panelled moon with a dish bitten out of it (Quilez death-star distance), lit on its night side',
   ['dish', 'lights', '', ''],
   `fn sdDeathStar(p2: vec3f, ra: f32, rb: f32, d: f32) -> f32 {
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
}`,
   `${hit('dish_moon')}
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
  return finish(c, uv);`,
   { def: [0.6, 0.5, 0.5, 0.5] }],

  ['sector_scoop', 'primitives', 'a Quilez solid angle opening from a waffle cone to a bitten sphere, its cap glazed',
   ['aperture', 'flavor', '', ''],
   `fn sdSolidAngle(p: vec3f, c: vec2f, ra: f32) -> f32 {
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
}`,
   `${hit('sector_scoop')}
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
  return finish(dielectric(rd, n, waffle, 0.6, occ, 1.0) * 1.3, uv);`,
   { br: 1.45, def: [0.46, 0.0, 0.5, 0.5] }],

  ['pyramid_strata', 'primitives', 'a Quilez pyramid laid in sandstone courses with a gold capstone, on the studio floor',
   ['courses', 'height', '', ''],
   `fn sdPyramid(p0: vec3f, h: f32) -> f32 {
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
fn map_pyramid_strata(p0: vec3f) -> f32 { return sdPyramid(pyrLocal(p0), mix(0.6, 0.95, u.k.y)) * 1.75; }`,
   `${onStage('pyramid_strata', '-0.98')}
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
  return finish(dielectric(rd, n, alb, 0.75, occ, sh), uv);`,
   { br: 1.45, def: [0.45, 0.6, 0.5, 0.5] }],

  // ---- operators -------------------------------------------------------------
  ['smooth_union', 'operators', 'smooth-min against plain min: a sphere and a box fuse, the neck takes both colors; ghosts show the operands',
   ['blend', 'gap', '', ''],
   `fn suM() -> mat3x3f { return rotX(0.25) * rotY(0.35 + 0.2 * sin(u.time * 0.3)); }
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
fn map_smooth_union(p: vec3f) -> f32 { return suParts(p).x; }`,
   `  let h0 = march_smooth_union(ro, rd);
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
  return finish(c + ghost * 0.6, uv);`,
   { def: [0.7, 0.4, 0.5, 0.5] }],

  ['smooth_carve', 'operators', 'smooth subtraction: an orbiting ghost sphere scoops a layered block and shows its strata',
   ['soft', 'size', '', ''],
   `fn scM() -> mat3x3f { return rotX(0.42) * rotY(0.62); }
fn scC() -> vec3f { let a = u.time * 0.5 + 0.9; return vec3f(0.72 * cos(a), 0.5 + 0.12 * sin(u.time * 0.7), 0.72 * sin(a)); }
fn scParts(p0: vec3f) -> vec2f {
    let p = scM() * p0;
    let box = rbox(p, vec3f(0.66), 0.05);
    let sph = length(p - scC()) - mix(0.35, 0.65, u.k.y);
    let kk = mix(0.01, 0.2, u.k.x);
    let h = clamp(0.5 + 0.5 * (sph + box) / kk, 0.0, 1.0);
    return vec2f(-(mix(sph, -box, h) - kk * h * (1.0 - h)), h);
}
fn map_smooth_carve(p: vec3f) -> f32 { return scParts(p).x; }`,
   `  let h0 = march_smooth_carve(ro, rd);
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
  return finish(c + ghost * 0.7, uv);`,
   { def: [0.5, 0.45, 0.5, 0.5] }],

  ['intersect_lens', 'operators', 'intersection: a cube and a breathing sphere keep only what both hold; the sphere parts turn gold',
   ['radius', 'bevel', '', ''],
   `fn ilM() -> mat3x3f { return rotX(0.5 + 0.1 * sin(u.time * 0.4)) * rotY(u.time * 0.3 + 0.62); }
fn ilR() -> f32 { return mix(0.78, 1.08, 0.5 + 0.5 * sin(u.time * 0.6 + mix(-1.5, 1.5, u.k.x))); }
fn ilParts(p0: vec3f) -> vec2f {
    let p = ilM() * p0;
    return vec2f(rbox(p, vec3f(0.68), mix(0.0, 0.1, u.k.y)), length(p) - ilR());
}
fn map_intersect_lens(p: vec3f) -> f32 { let d = ilParts(p); return max(d.x, d.y); }`,
   `  let h0 = march_intersect_lens(ro, rd);
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
  return finish(c + ghost * 0.4, uv);`,
   { def: [0.5, 0.3, 0.5, 0.5] }],

  ['onion_cutaway', 'operators', 'the onion operator: a rounded block grown into nested shells, a sliding wedge cut opens them',
   ['shells', 'cut', '', ''],
   `fn onM() -> mat3x3f { return rotX(0.32) * rotY(0.78 + 0.25 * sin(u.time * 0.3)); }
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
fn map_onion_cutaway(p: vec3f) -> f32 { return onParts(p).x; }`,
   `${hit('onion_cutaway')}
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
  return finish(dielectric(rd, n, alb, select(0.2, 0.6, onCutFace), occ, 1.0), uv);`,
   { def: [0.6, 0.5, 0.5, 0.5] }],

  ['twist_bar', 'operators', 'the twist operator: a striped square bar wrung about its axis, the straight bar as a ghost',
   ['twist', 'girth', '', ''],
   `fn twM() -> mat3x3f { return rotX(0.18) * rotY(0.5 + u.time * 0.2); }
fn twK() -> f32 { return mix(0.0, 3.2, u.k.x) * sin(u.time * 0.6 + 0.9); }
fn twLocal(p0: vec3f) -> vec3f {
    let p = twM() * p0;
    let xz = rot2(twK() * p.y) * p.xz;
    return vec3f(xz.x, p.y, xz.y);
}
fn map_twist_bar(p0: vec3f) -> f32 {
    let g = mix(0.2, 0.36, u.k.y);
    return rbox(twLocal(p0), vec3f(g, 1.0, g), 0.04) * 0.55;
}`,
   `  let h0 = march_twist_bar(ro, rd);
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
  return finish(dielectric(rd, n, alb, 0.2, occ, 1.0) + ghost * 0.4, uv);`,
   { def: [0.6, 0.55, 0.5, 0.5] }],

  ['bend_plank', 'operators', 'the bend operator: graph paper on a plank curls and flattens; the flat plank stays as a ghost',
   ['bend', 'grid', '', ''],
   `fn bnM() -> mat3x3f { return rotX(0.5) * rotY(-0.32); }
fn bnK() -> f32 { return mix(0.0, 1.5, u.k.x) * sin(u.time * 0.7 + 1.1); }
fn bnLocal(p0: vec3f) -> vec3f {
    let p = bnM() * p0;
    let kb = bnK();
    let c = cos(kb * p.x); let s = sin(kb * p.x);
    return vec3f(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
}
fn map_bend_plank(p0: vec3f) -> f32 { return rbox(bnLocal(p0), vec3f(1.05, 0.06, 0.48), 0.03) * 0.6; }`,
   `  let h0 = march_bend_plank(ro, rd);
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
  return finish(dielectric(rd, n, alb, 0.45, occ, 1.0) + ghost * 0.4, uv);`,
   { def: [0.6, 0.4, 0.5, 0.5] }],

  ['repeat_grid', 'operators', 'finite repetition: a lattice of beveled cubes grows and shrinks ring by ring, colored by cell id',
   ['spacing', 'turn', '', ''],
   `fn rgM() -> mat3x3f { return rotX(0.55) * rotY(u.time * 0.25 + 0.6); }
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
fn map_repeat_grid(p: vec3f) -> f32 { return rgParts(p).x; }`,
   `${hit('repeat_grid')}
  let id = rgParts(p).yzw;
  let alb = hue(dot(id, vec3f(0.11, 0.17, 0.07)) + 0.55) * 0.75 + 0.12;
  return finish(dielectric(rd, n, alb, 0.15, occ, 1.0), uv);`,
   { def: [0.5, 0.4, 0.5, 0.5] }],

  ['elongate_round', 'operators', 'elongation and rounding: an octahedron stretched along x and z, the inserted slab striped',
   ['round', 'stretch', '', ''],
   `fn elM() -> mat3x3f { return rotX(0.42) * rotY(u.time * 0.3 + 0.5); }
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
}`,
   `${hit('elongate_round')}
  let q = elM() * p;
  let he = elH();
  let inSlab = abs(q.x) < he.x || abs(q.z) < he.z;
  let stripe = step(0.5, fract((q.x + q.z) * 7.0));
  var alb = vec3f(0.95, 0.75, 0.2);
  if (inSlab) { alb = mix(vec3f(0.1, 0.55, 0.6), vec3f(0.92, 0.95, 0.95), stripe); }
  return finish(dielectric(rd, n, alb, 0.12, occ, 1.0), uv);`,
   { def: [0.5, 0.8, 0.5, 0.5] }],

  ['displace_wave', 'operators', 'displacement: a sphere plus a product of sines, peaks warm and troughs cool; the plain sphere ghosts',
   ['amplitude', 'frequency', '', ''],
   `fn dwM() -> mat3x3f { return rotX(0.3) * rotY(u.time * 0.3 + 0.2); }
fn dwParts(p0: vec3f) -> vec2f {
    let t = u.time;
    let p = dwM() * p0;
    let amp = mix(0.02, 0.16, u.k.x) * (0.55 + 0.45 * sin(t * 0.7 + 1.3));
    let f = mix(3.0, 8.0, u.k.y);
    let w = sin(f * p.x + t) * sin(f * p.y + t * 0.7) * sin(f * p.z - t * 0.5);
    return vec2f((length(p) - 0.8 + amp * w) / (1.0 + amp * f * 1.6), w);
}
fn map_displace_wave(p: vec3f) -> f32 { return dwParts(p).x; }`,
   `  let h0 = march_displace_wave(ro, rd);
  let tm = select(1e5, h0, h0 > 0.0);
  let M = dwM();
  let ghost = mix(cCream(), cTone(), 0.4) * ghostSph(M * ro, M * rd, vec3f(0.0), 0.8, tm) * 0.5;
  if (h0 < 0.0) { return finish(backdrop(rd) + ghost, uv); }
  let p = ro + rd * h0;
  let n = nrm_displace_wave(p);
  let occ = ao_displace_wave(p, n);
  let w = dwParts(p).y;
  let alb = mix(mix(vec3f(0.1, 0.25, 0.85), vec3f(0.9, 0.9, 0.88), smoothstep(-1.0, 0.0, -w)), vec3f(1.0, 0.4, 0.1), smoothstep(0.0, 1.0, -w));
  return finish(dielectric(rd, n, alb, 0.18, occ, 1.0) + ghost * 0.4, uv);`,
   { def: [0.6, 0.45, 0.5, 0.5] }],

  // ---- materials -------------------------------------------------------------
  ['jade_bi', 'materials', 'a jade bi disc with a raised grain pattern: light crosses the stone and comes out green',
   ['clouds', 'density', '', ''],
   `fn jadeLocal(p0: vec3f) -> vec3f { return spin(p0, 0.45 * sin(u.time * 0.3) + 0.3, 1.0 + 0.2 * sin(u.time * 0.4)) / 0.88; }
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
}`,
   `${hit('jade_bi')}
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
  return finish(c * mix(0.7, 1.0, occ), uv);`,
   { def: [0.5, 0.45, 0.5, 0.5] }],

  ['wax_candle', 'materials', 'a pillar candle with drips; the flame lights the wax from inside and the room from above',
   ['flame', 'melt', '', ''],
   `fn candleTop() -> f32 { return 0.42 - mix(0.0, 0.35, u.k.y) * fract(u.time * 0.01 + 0.2); }
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
}`,
   `  let fl = mix(0.4, 1.6, k.x) * (0.9 + 0.1 * sin(t * 13.0) * sin(t * 7.3));
  let top = candleTop();
  let fc = vec3f(0.02 * gnoise(vec3f(t * 2.0, 0.0, 0.0)), top + 0.2, 0.0);
  let flameC = vec3f(1.0, 0.55, 0.2) * fl;
${onStage('wax_candle', '-0.98', 'stageFloor(rd, pf, fsh, fo) + flameC * 0.12 * fo / (1.0 + dot(pf.xz, pf.xz) * 1.5)', 'candleFlame(ro, rd, 1e5, fc)')}
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
  return finish(c + candleFlame(ro, rd, h, fc), uv);`,
   { br: 1.45, def: [0.6, 0.3, 0.5, 0.5] }],

  ['crackle_vase', 'materials', 'a celadon vase with two crackle networks in its glaze: dark iron lines and fine gold threads',
   ['crackle', 'glaze', '', ''],
   `fn vaseR(y: f32) -> f32 { return 0.2 + 0.44 * exp(-pow((y + 0.25) / 0.42, 2.0)) + 0.11 * smoothstep(0.45, 0.85, y); }
fn vaseLocal(p0: vec3f) -> vec3f { return rotY(u.time * 0.25 + 0.4) * p0; }
fn map_crackle_vase(p0: vec3f) -> f32 {
    let p = vaseLocal(p0);
    let r = length(p.xz);
    let vr = vaseR(p.y);
    let wall = max(abs(r - vr + 0.035) - 0.035, abs(p.y + 0.07) - 0.89);
    let foot = max(r - vr, abs(p.y + 0.9) - 0.06);
    return min(wall, foot) * 0.72;
}`,
   `${onStage('crackle_vase', '-0.96')}
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
  return finish(dielectric(rd, n, alb, 0.05, occ, sh), uv);`,
   { br: 1.25, def: [0.5, 0.3, 0.5, 0.5] }],

  ['velvet_cushion', 'materials', 'a tufted velvet cushion with piping and gold tassels: dark at the face, bright sheen at the edge',
   ['sheen', 'pile', '', ''],
   `fn cushLocal(p0: vec3f) -> vec3f { return rotY(u.time * 0.3 + 0.75) * (rotX(-0.62) * p0); }
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
fn map_velvet_cushion(p: vec3f) -> f32 { let d = cushParts(p); return min(d.x, d.y); }`,
   `${hit('velvet_cushion')}
  let parts = cushParts(p);
  if (parts.y < parts.x) { return finish(metal(rd, n, vec3f(1.0, 0.74, 0.36), 0.3, occ), uv); }
  let q = cushLocal(p);
  let ci = clamp(-dot(rd, n), 0.0, 1.0);
  let pile = 1.0 + mix(0.0, 0.25, k.y) * fbm3(q * vec3f(30.0, 30.0, 30.0), 2);
  let alb = mix(vec3f(0.32, 0.015, 0.1), cTone() * 0.4, 0.15);
  let sheen = pow(1.0 - ci, 3.0) * mix(0.8, 2.6, k.x) + 0.12;
  let sheenC = mix(alb * 4.0, vec3f(1.0, 0.75, 0.85), 0.35);
  let c = (envDiff(n) * alb * 0.6 + envDiff(n) * sheenC * sheen * 0.55) * pile * occ;
  return finish(c, uv);`,
   { def: [0.6, 0.5, 0.5, 0.5] }],

  ['brushed_knob', 'materials', 'a brushed aluminium knob: seven tilted reflection samples streak the light round its face',
   ['brushing', 'turn', '', ''],
   `fn knobM() -> mat3x3f { return rotY(0.3 * sin(u.time * 0.7) * mix(0.5, 3.0, u.k.y) + 0.5) * rotX(-0.85) * rotY(0.3); }
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
fn map_brushed_knob(p: vec3f) -> f32 { let d = knobParts(p); return max(d.x, -d.y); }`,
   `${hit('brushed_knob')}
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
  return finish(c, uv);`,
   { def: [0.6, 0.4, 0.5, 0.5] }],

  ['carbon_egg', 'materials', 'a carbon-fibre egg: a 2x2 twill of fibre tows, each lit along its own grain, under a clear coat',
   ['weave', 'coat', '', ''],
   `fn carbM() -> mat3x3f { return rotX(0.3 + 0.2 * sin(u.time * 0.4)) * rotY(u.time * 0.35 + 0.5); }
fn map_carbon_egg(p0: vec3f) -> f32 {
    let p = carbM() * p0;
    return sdEllipsoid(p * vec3f(1.0, 1.0 + 0.12 * clamp(p.y, -1.0, 0.0), 1.0), vec3f(0.66, 0.92, 0.66));
}`,
   `${hit('carbon_egg')}
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
  return finish((fibre + vec3f(0.01) + coat) * occ, uv);`,
   { def: [0.25, 0.6, 0.5, 0.5] }],

  ['turned_bowl', 'materials', 'a turned wooden bowl: growth rings from a log axis cut across, pores, an oiled sheen',
   ['rings', 'oil', '', ''],
   `fn bowlLocal(p0: vec3f) -> vec3f { return rotY(u.time * 0.3 + 1.1) * p0; }
fn map_turned_bowl(p0: vec3f) -> f32 {
    let p = bowlLocal(p0);
    let c = vec3f(0.0, 0.32, 0.0);
    var d = abs(length(p - c) - 0.9) - 0.045;
    d = smax(d, p.y - 0.18, 0.03);
    let foot = sdCyl(p - vec3f(0.0, -0.58, 0.0), 0.035, 0.34) - 0.01;
    return min(d, foot);
}`,
   `${onStage('turned_bowl', '-0.63')}
  let q = bowlLocal(p);
  let warp = fbm3(q * vec3f(1.2, 3.0, 3.0), 3);
  let ring = length(q.yz - vec2f(-1.9, 0.2)) * mix(8.0, 22.0, k.x) + warp * 2.5;
  let band = smoothstep(0.2, 0.9, fract(ring)) * smoothstep(1.0, 0.85, fract(ring));
  let pores = smoothstep(0.55, 0.8, gnoise(q * vec3f(4.0, 90.0, 90.0)));
  var alb = mix(vec3f(0.62, 0.38, 0.19), vec3f(0.36, 0.18, 0.07), band);
  alb *= 1.0 - 0.3 * pores;
  return finish(dielectric(rd, n, alb, mix(0.6, 0.12, k.y), occ, sh), uv);`,
   { br: 1.3, def: [0.4, 0.6, 0.5, 0.5] }],

  ['marble_pair', 'materials', 'a green marble sphere resting on a white marble block, veins by turbulence, polished',
   ['veins', 'gold', '', ''],
   `fn marbleLocal(p0: vec3f) -> vec3f { return rotY(u.time * 0.25 + 0.7) * p0; }
fn marbleParts(p0: vec3f) -> vec2f {
    let p = marbleLocal(p0);
    return vec2f(rbox(p - vec3f(0.0, -0.45, 0.0), vec3f(0.56, 0.52, 0.56), 0.04), length(p - vec3f(0.0, 0.47, 0.0)) - 0.4);
}
fn map_marble_pair(p: vec3f) -> f32 { let d = marbleParts(p); return min(d.x, d.y); }
fn marbleVein(q: vec3f, f: f32) -> f32 {
    let tq = q + 0.9 * vec3f(fbm3(q * 1.3, 4), fbm3(q * 1.3 + 7.0, 4), fbm3(q * 1.3 + 13.0, 4));
    return pow(1.0 - abs(sin(dot(tq, vec3f(0.6, 1.0, 0.3)) * f)), 14.0);
}`,
   `${onStage('marble_pair', '-0.97')}
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
  return finish(dielectric(rd, n, alb, 0.03, occ, sh) + alb * 0.05 * occ, uv);`,
   { def: [0.5, 0.6, 0.5, 0.5] }],

  // ---- lathe -----------------------------------------------------------------
  ['ebony_pawn', 'lathe', 'a lathed pawn in ebony lacquer stepping one square on a board, its profile built from 2D shapes',
   ['step', 'gloss', '', ''],
   `fn pawnProf(q: vec2f) -> f32 {
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
}`,
   `${onStage('ebony_pawn', '-1.0', 'stageFloor(rd, pf, fsh, fo) * board(pf)')}
  let alb = vec3f(0.015, 0.012, 0.012);
  return finish(dielectric(rd, n, alb, mix(0.25, 0.0, k.y), occ, sh) * 1.2, uv);`,
   { br: 1.3, def: [0.5, 0.8, 0.5, 0.5] }],

  ['ivory_rook', 'lathe', 'a lathed rook in ivory with a crenellated crown cut by a six-fold angular fold',
   ['merlons', 'warmth', '', ''],
   `fn rookLocal(p0: vec3f) -> vec3f { return rotY(u.time * 0.4 + 0.3) * (p0 - vec3f(0.35 * sin(u.time * 0.5) - 0.1, 0.0, 0.0)); }
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
}`,
   `${onStage('ivory_rook', '-1.0', 'stageFloor(rd, pf, fsh, fo) * board(pf)')}
  let q = rookLocal(p);
  let grain = 0.94 + 0.06 * sin(q.y * 120.0 + gnoise(q * 6.0) * 4.0);
  let alb = mix(vec3f(0.86, 0.82, 0.7), vec3f(0.92, 0.78, 0.55), k.y) * grain;
  let ci = clamp(-dot(rd, n), 0.0, 1.0);
  let glow = vec3f(0.9, 0.6, 0.35) * 0.08 * pow(1.0 - ci, 2.0);
  return finish(dielectric(rd, n, alb, 0.12, occ, sh) + glow * occ, uv);`,
   { br: 1.35, def: [0.5, 0.4, 0.5, 0.5] }],

  ['wine_glass', 'lathe', 'a thin-walled wine glass with sloshing red wine: each wall refracts in and out, the wine absorbs',
   ['fill', 'slosh', '', ''],
   `fn wgLevel(p: vec3f) -> f32 { return mix(-0.25, 0.25, u.k.x) + mix(0.0, 0.1, u.k.y) * sin(u.time * 1.6) * (p.x * 0.8 + p.z * 0.3); }
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
fn map_wine_glass(p: vec3f) -> f32 { return min(map_wg_glass(p), map_wg_wine(p)); }`,
   glassWalk('wine_glass', 'wg_glass', `          let fr = schlick(abs(dot(dir, n)), 0.02);
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
          dir = dout; pos = pe + dir * 0.004;`, '-0.97', 'map_wg_wine(p)') + `
  if (first && rd.y < 0.0) {
      let pf = ro + rd * ((-0.97 - ro.y) / rd.y);
      let cq = pf.xz - vec2f(0.95, -0.7);
      col += (vec3f(0.9, 0.12, 0.15) * 0.5 * exp(-dot(cq, cq) * 6.0) + cCream() * 0.5 * exp(-dot(cq, cq) * 40.0)) * u.studio;
  }
  return finish(col, uv);`,
   { br: { wine_glass: 1.15, wg_glass: 1.15, wg_wine: 1.15 }, def: [0.5, 0.5, 0.5, 0.5] }],

  ['hourglass', 'lathe', 'an hourglass in a walnut and brass frame; the sand drains as a funnel and builds a cone below',
   ['time', 'sand', '', ''],
   `fn hgF() -> f32 { return fract(u.time * mix(0.02, 0.1, u.k.x) + 0.45); }
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
fn map_hourglass(p0: vec3f) -> f32 { return min(map_hg_glass(p0), hgContent(p0)); }`,
   glassWalk('hourglass', 'hg_glass', `          let q = rotY(t * 0.2 + 0.3) * p;
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
          done = true;`, '-0.88', 'hgContent(p)') + `
  return finish(col, uv);`,
   { br: { hourglass: 1.25, hg_glass: 1.25 }, def: [0.5, 0.5, 0.5, 0.5] }],
  ['teacup', 'lathe', 'a porcelain teacup and saucer, gold rims and a cobalt band, tea inside and steam rising',
   ['steam', 'band', '', ''],
   `fn cupLocal(p0: vec3f) -> vec3f { return rotY(u.time * 0.3 + 2.2) * p0 / 0.88; }
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
}`,
   `  let stc = cCream() * 0.9 * mix(0.0, 1.6, k.x);
${onStage('teacup', '-0.527', 'stageFloor(rd, pf, fsh, fo)', 'stc * cupSteam(ro, rd, 1e5)')}
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
  return finish(c + stc * cupSteam(ro, rd, h), uv);`,
   { br: 1.25, def: [0.6, 0.8, 0.5, 0.5] }],

  ['bowling_pin', 'lathe', 'a bowling pin rocking on its base beside a marbled ball; pin from blended ellipsoid, capsule and sphere',
   ['rock', 'swirl', '', ''],
   `fn pinLocal(p0: vec3f) -> vec3f {
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
fn map_bowling_pin(p: vec3f) -> f32 { let d = pinParts(p); return min(d.x, d.y); }`,
   `${onStage('bowling_pin', '-1.0')}
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
  return finish(dielectric(rd, n, alb, 0.05, occ, sh), uv);`,
   { br: 1.3, def: [0.5, 0.5, 0.5, 0.5] }],

  ['spinning_top', 'lathe', 'a lacquered spinning top: it spins, precesses and nutates on its tip, a painted spiral on its crown',
   ['tilt', 'spin', '', ''],
   `fn topLocal(p0: vec3f) -> vec3f {
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
}`,
   `${onStage('spinning_top', '-0.95')}
  let q = topLocal(p);
  let r = length(q.xz);
  let a = atan2(q.z, q.x);
  let sp = fract(a / TAU * 3.0 + r * 2.2 - q.y * 0.6);
  let band = floor(sp * 3.0);
  var alb = select(select(vec3f(0.05, 0.45, 0.5), vec3f(0.95, 0.88, 0.72), band > 0.5), vec3f(0.8, 0.08, 0.06), band > 1.5);
  if (q.y > 1.0 || q.y < 0.12) { alb = vec3f(0.62, 0.42, 0.22) * (0.9 + 0.1 * sin(q.y * 140.0)); }
  let rim = smoothstep(0.012, 0.0, abs(q.y - 0.82)) * step(0.5, r);
  alb = mix(alb, vec3f(0.9, 0.7, 0.3), rim);
  return finish(dielectric(rd, n, alb, 0.05, occ, sh), uv);`,
   { br: 1.4, def: [0.5, 0.4, 0.5, 0.5] }],
];
