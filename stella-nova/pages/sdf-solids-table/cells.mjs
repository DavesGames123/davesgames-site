// ============================================================================
//  SDF SOLIDS TABLE  ·  cells.mjs — the first six families and the body builders
// ────────────────────────────────────────────────────────────────────────────
//  Each cell is [name, family, species, knob labels, decl, body, opts].
//    decl .... module-scope WGSL (the map_<m> functions and any helpers)
//    body .... the fragment body; uv, t, k, ro, rd are already bound
//    opts .... { br: bounding radius per map, def: knob defaults }
//  build.mjs reads CELLS_CORE from here, then cells-forms.mjs and
//  cells-worlds.mjs. Function names must be unique across all three files,
//  because every cell lands in one WGSL module.
//
//  GREP MAP
//    export const glassBody / chromeBody / hit / onStage .. body builders
//    // ---- glass ....... dispersive glass solids
//    // ---- chrome ...... mirror metals
//    // ---- blobs ....... smooth-min liquids
//    // ---- film ........ thin-film interference
//    // ---- interior .... volumes and solids inside glass
//    // ---- emissive .... light without a surface
// ============================================================================
// ── shared cell bodies ──────────────────────────────────────────────────────
export const glassBody = (m, ior, spread, absorb) => `  let h = march_${m}(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_${m}(p);
  return finish(glass_${m}(p, rd, n, ${ior}, ${spread}, ${absorb}), uv);`;
export const chromeBody = (m, tint) => `  let h = march_${m}(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_${m}(p);
  return finish(chrome(rd, n, ${tint}, ao_${m}(p, n)), uv);`;
// hit(m, miss): trace map_<m>; on a miss return miss, else bind p, n and occ
export const hit = (m, miss = 'backdrop(rd)') => `  let h = march_${m}(ro, rd);
  if (h < 0.0) { return finish(${miss}, uv); }
  let p = ro + rd * h;
  let n = nrm_${m}(p);
  let occ = ao_${m}(p, n);`;
// onStage(m, fy, floor): the solid stands on a studio floor at height fy. A
// miss that falls to the floor returns the floor expression, which can read pf
// (the floor point), fsh (the soft shadow) and fo (the contact term). add is
// WGSL added to both miss colors (a glow in front of the room). A hit
// binds p, n, occ and sh (the key-light shadow on the solid).
export const onStage = (m, fy, floor = 'stageFloor(rd, pf, fsh, fo)', add = '') => `  let h = march_${m}(ro, rd);
  if (h < 0.0) {
      if (rd.y < 0.0) {
          let pf = ro + rd * ((${fy} - ro.y) / rd.y);
          let fsh = shd_${m}(pf, normalize(KEY));
          let fo = ao_${m}(pf, vec3f(0.0, 1.0, 0.0));
          return finish(${floor}${add ? ' + ' + add : ''}, uv);
      }
      return finish(backdrop(rd)${add ? ' + ' + add : ''}, uv);
  }
  let p = ro + rd * h;
  let n = nrm_${m}(p);
  let occ = ao_${m}(p, n);
  let sh = shd_${m}(p + n * 0.012, normalize(KEY));`;

export const CELLS_CORE = [
  // ---- glass -----------------------------------------------------------------
  ['brilliant', 'glass', 'a round brilliant: a faceted gem lathed from a cut profile, split into R, G, B at the exit',
   ['facets', 'fire', 'tint', ''],
   `fn map_brilliant(p0: vec3f) -> f32 {
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
}`,
   glassBody('brilliant', '2.15', 'mix(0.02, 0.16, k.y)', '(1.0 - cTone()) * mix(0.0, 0.6, k.z)'),
   { def: [0.25, 0.5, 0.15, 0.5] }],

  ['prism_bar', 'glass', 'an n-sided glass bar: a regular polygon extruded, strong dispersion throws spectra',
   ['sides', 'girth', 'dispersion', ''],
   `fn sdPoly(p: vec2f, n: f32, a: f32) -> f32 {
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
}`,
   glassBody('prism_bar', '1.62', 'mix(0.03, 0.2, k.z)', 'vec3f(0.02)'),
   { def: [0.0, 0.5, 0.6, 0.5] }],

  ['ring_torus', 'glass', 'a rounded torus of colored glass; the tone swatch sets the dye',
   ['tube', 'dye', 'dispersion', ''],
   `fn map_ring_torus(p0: vec3f) -> f32 {
    let t = u.time; let k = u.k;
    let p = spin(p0, t * 0.5 + 0.2, 1.05 + 0.35 * sin(t * 0.37));
    return length(vec2f(length(p.xz) - 0.7, p.y)) - mix(0.16, 0.36, k.x);
}`,
   glassBody('ring_torus', '1.5', 'mix(0.0, 0.1, k.z)', '(1.0 - cTone()) * mix(0.2, 2.5, k.y)'),
   { def: [0.55, 0.5, 0.3, 0.5] }],

  ['soft_cube', 'glass', 'a superellipsoid cube in aqua glass: |x|^e + |y|^e + |z|^e = 1',
   ['squareness', 'aqua', 'dispersion', ''],
   `fn map_soft_cube(p0: vec3f) -> f32 {
    let t = u.time; let k = u.k;
    let p = spin(p0, t * 0.4 + 0.75, 0.6 + 0.2 * sin(t * 0.3));
    let e = mix(2.4, 12.0, k.x);
    let q = max(abs(p) / 0.74, vec3f(1e-4));
    let s = pow(pow(q.x, e) + pow(q.y, e) + pow(q.z, e), 1.0 / e);
    return (s - 1.0) * 0.74 * 0.7;
}`,
   glassBody('soft_cube', '1.52', 'mix(0.0, 0.1, k.z)', 'vec3f(0.9, 0.22, 0.12) * mix(0.0, 1.6, k.y)'),
   { def: [0.35, 0.5, 0.4, 0.5] }],

  ['glass_glyph', 'glass', 'a glass letter S: two Quilez arcs extruded and rounded, in amber',
   ['stroke', 'amber', 'depth', ''],
   `fn sdArc(p: vec2f, sc: vec2f, ra: f32, rb: f32) -> f32 {
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
}`,
   glassBody('glass_glyph', '1.55', '0.05', 'vec3f(0.08, 0.4, 1.1) * mix(0.3, 3.0, k.y)'),
   { br: 1.4, def: [0.6, 0.5, 0.45, 0.5] }],

  // ---- chrome ----------------------------------------------------------------
  ['morph_solid', 'chrome', 'polished steel looping cube → sphere → octahedron → torus by blending distances',
   ['rate', '', '', ''],
   `fn morphShape(p: vec3f, i: i32) -> f32 {
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
}`,
   chromeBody('morph_solid', 'vec3f(0.93, 0.94, 0.96)')],

  ['cube_jack', 'chrome', 'seven rounded gold cubes in a 3D plus, breathing apart and together',
   ['spread', 'bevel', '', ''],
   `fn map_cube_jack(p0: vec3f) -> f32 {
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
}`,
   chromeBody('cube_jack', 'vec3f(1.0, 0.74, 0.34)')],

  ['chamfer_dodeca', 'chrome', 'a hammered copper dodecahedron, its twenty corners cut by the vertex planes',
   ['chamfer', 'hammer', '', ''],
   `fn map_chamfer_dodeca(p0: vec3f) -> f32 {
    let t = u.time; let k = u.k;
    let p = spin(p0, t * 0.35 + 0.3, 0.4 + t * 0.17);
    let g = 1.618034;
    let a = abs(p);
    let dd = max(dot(a, normalize(vec3f(0.0, 1.0, g))), max(dot(a, normalize(vec3f(1.0, g, 0.0))), dot(a, normalize(vec3f(g, 0.0, 1.0))))) - 0.8;
    let dv = max(max(dot(a, vec3f(0.57735)), dot(a, normalize(vec3f(0.0, 1.0 / g, g)))),
                 max(dot(a, normalize(vec3f(1.0 / g, g, 0.0))), dot(a, normalize(vec3f(g, 0.0, 1.0 / g))))) - 0.8 * mix(1.03, 1.2, k.x);
    return max(dd, dv);
}`,
   hit('chamfer_dodeca') + `
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
  return finish(c, uv);`,
   { def: [0.5, 0.55, 0.5, 0.5] }],

  ['gyroid_core', 'chrome', 'a steel sphere carved to a gyroid sheet, a hot core glowing through the channels',
   ['cells', 'sheet', 'core', ''],
   `fn map_gyroid_core(p0: vec3f) -> f32 {
    let t = u.time; let k = u.k;
    let p = spin(p0, t * 0.3 + 0.2, 0.3);
    let sc = mix(3.0, 6.5, k.x);
    let q = p * sc + vec3f(0.0, t * 0.4, 0.0);
    let gy = dot(sin(q), cos(q.zxy)) / sc;
    let body = max(length(p) - 0.95, (abs(gy) - mix(0.025, 0.08, k.y)) * 0.6);
    return min(body, length(p) - 0.36);
}`,
   `  let h = march_gyroid_core(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_gyroid_core(p);
  let heat = mix(cTone(), vec3f(1.0, 0.55, 0.2), 0.6) * mix(1.0, 6.0, k.z);
  if (length(p) < 0.39) { return finish(heat * (1.2 + 0.8 * cCream()), uv); }
  let occ = ao_gyroid_core(p, n);
  let bleed = heat * 0.3 * exp(-(length(p) - 0.36) * 3.5) * (0.3 + 0.7 * max(dot(n, -normalize(p)), 0.0));
  return finish(chrome(rd, n, vec3f(0.9, 0.91, 0.94), occ) + bleed, uv);`,
   { def: [0.35, 0.5, 0.5, 0.5] }],

  // ---- blobs -----------------------------------------------------------------
  ['bead_chain', 'blobs', 'candy beads on a helix spring; smooth-min necks form and snap as k breathes',
   ['necks', 'spin', '', ''],
   `fn map_bead_chain(p0: vec3f) -> f32 {
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
}`,
   `  let h = march_bead_chain(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_bead_chain(p);
  let alb = mix(hue(0.55 + p.y * 0.28), cTone(), 0.2) * 0.75;
  return finish(plastic(rd, n, alb, ao_bead_chain(p, n)), uv);`,
   { def: [0.6, 0.5, 0.5, 0.5], br: 1.3 }],

  ['lava_lamp', 'blobs', 'wax rising and merging by smooth-min inside a tapered glass vessel, glowing hot at the base',
   ['pace', 'glow', '', ''],
   `fn map_lava_lamp(p: vec3f) -> f32 {
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
}`,
   `  let h = march_lava_lamp(ro, rd);
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
  return finish(env(reflect(rd, n)) * fr + inner * (1.0 - fr), uv);`,
   { br: { lava_lamp: 1.2, lava_wax: 1.2 } }],

  ['oil_drops', 'blobs', 'five amber oil drops orbiting and fusing by smooth-min, lit through their bodies',
   ['fusion', 'amber', '', ''],
   `fn map_oil_drops(p0: vec3f) -> f32 {
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
}`,
   glassBody('oil_drops', '1.47', '0.02', 'vec3f(0.05, 0.3, 1.0) * mix(0.15, 1.8, k.y)'),
   { def: [0.55, 0.5, 0.5, 0.5], br: 1.4 }],

  ['mercury', 'blobs', 'a liquid-metal blob wobbling in its own pool while two drops bounce and rejoin',
   ['wobble', 'ripples', '', ''],
   `fn map_mercury(p0: vec3f) -> f32 {
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
}`,
   chromeBody('mercury', 'vec3f(0.8, 0.82, 0.86)'),
   { br: 1.4 }],

  // ---- film ------------------------------------------------------------------
  ['soap_bubble', 'film', 'a soap bubble: film thickness swirls and drains, both walls interfere',
   ['thickness', 'swirl', 'drain', ''],
   ``,
   `  let hs = sphHit(ro, rd, 0.95);
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
  return finish(c, uv);`],

  ['iris_blob', 'film', 'a tumbling noise-warped blob under a fixed film: the hue follows the view angle',
   ['warp', 'film', '', ''],
   `fn map_iris_blob(p0: vec3f) -> f32 {
    let t = u.time; let k = u.k;
    let p = spin(p0, t * 0.6 + 0.4, t * 0.37 + 0.3);
    return (length(p) - 0.78 - mix(0.05, 0.3, k.x) * gnoise(p * 1.7 + vec3f(t * 0.2))) * 0.75;
}`,
   `  let h = march_iris_blob(ro, rd);
  if (h < 0.0) { return finish(backdrop(rd), uv); }
  let p = ro + rd * h;
  let n = nrm_iris_blob(p);
  let ci = clamp(-dot(rd, n), 0.0, 1.0);
  let fl = film(mix(280.0, 560.0, k.y) + 120.0 * gnoise(p * 2.0), ci, 1.6);
  let fls = fl * 1.3;
  let occ = ao_iris_blob(p, n);
  let c = envDiff(n) * cInk() * 0.6 + (env(reflect(rd, n)) + 0.07) * fls * (0.4 + 0.6 * schlick(ci, 0.1));
  return finish(c * occ, uv);`,
   { br: 1.3 }],

  ['oil_slick', 'film', 'a black glass sphere wearing an oil film that flows in contour bands',
   ['thickness', 'bands', '', ''],
   ``,
   `  let hs = sphHit(ro, rd, 0.9);
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
  return finish(c, uv);`],

  ['nacre', 'film', 'a baroque pearl: soft body light plus pastel orient from thin nacre platelets',
   ['orient', 'luster', '', ''],
   `fn map_nacre(p0: vec3f) -> f32 {
    let t = u.time; let k = u.k;
    let p = spin(p0, t * 0.3 + 0.3, 0.2);
    return (length(p * vec3f(1.0, 1.1, 1.0)) - 0.8 - 0.035 * gnoise(p * 2.4)) * 0.9;
}`,
   `  let h = march_nacre(ro, rd);
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
  return finish(c, uv);`],

  // ---- interior --------------------------------------------------------------
  ['ink_block', 'interior', 'two dyes domain-warped through a glass block, marched in 24 steps',
   ['warp', 'density', '', ''],
   `fn inkLocal(p: vec3f) -> vec3f { return spin(p, u.time * 0.3 + 0.55, 0.28); }
fn map_ink_block(p: vec3f) -> f32 { return rbox(inkLocal(p), vec3f(0.62, 0.85, 0.36), 0.1); }
fn inkField(q: vec3f, t: f32, wk: f32) -> vec2f {
    var w = q * 1.5;
    w += wk * vec3f(gnoise(w + vec3f(0.0, t * 0.25, 0.0)), gnoise(w + vec3f(5.2, 1.3, t * 0.2)), gnoise(w + vec3f(2.1, 7.7, -t * 0.2)));
    let n = fbm3(w, 3);
    return vec2f(smoothstep(-0.02, 0.35, n), 0.5 + 0.9 * gnoise(w * 0.6 + 3.0));
}`,
   `  let h = march_ink_block(ro, rd);
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
  return finish(env(reflect(rd, n)) * fr + acc * (1.0 - fr), uv);`,
   { br: 1.25 }],

  ['cat_eye', 'interior', 'a glass marble with three twisted color vanes, traced as a solid inside the sphere',
   ['twist', 'vanes', '', ''],
   `fn vaneSD(p0: vec3f, t: f32, tw: f32, nv: f32) -> vec2f {
    let p = spin(p0, t * 0.4 + 0.3, 0.35);
    let a = atan2(p.z, p.x) - p.y * tw;
    let sec = TAU / nv;
    let id = floor(a / sec + 0.5);
    let r = length(p.xz);
    let blade = abs(r * sin(a - id * sec)) - 0.03 * (1.0 - r * 1.6);
    let cap = length(p * vec3f(1.0, 0.7, 1.0)) - 0.46;
    return vec2f(max(blade, cap) * 0.45, id);
}`,
   `  let hs = sphHit(ro, rd, 0.92);
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
  return finish(env(reflect(rd, n)) * fr + inner * (1.0 - fr), uv);`,
   { def: [0.45, 0.5, 0.5, 0.5] }],

  ['nebula_orb', 'interior', 'an emission nebula and a star field held inside a clear glass orb',
   ['density', 'warp', '', ''],
   ``,
   `  let hs = sphHit(ro, rd, 0.95);
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
  return finish(env(reflect(rd, n)) * fr + acc * (1.0 - fr), uv);`,
   { def: [0.5, 0.5, 0.5, 0.5] }],

  // ---- emissive --------------------------------------------------------------
  ['rainbow_knot', 'emissive', 'a torus-knot filament of light; the hue runs along the curve and loops',
   ['knot', 'width', 'flow', ''],
   `fn knotD(p: vec3f, P: f32, Q: f32) -> vec2f {
    let a = atan2(p.z, p.x);
    let lp = vec2f(length(p.xz) - 0.6, p.y);
    var best = vec2f(1e5, 0.0);
    for (var i = 0; i < 2; i++) {
        let s = (a + TAU * f32(i)) / P;
        let d = length(lp - 0.3 * vec2f(cos(Q * s), sin(Q * s)));
        if (d < best.x) { best = vec2f(d, s / TAU); }
    }
    return best;
}`,
   `  var c = backdrop(rd) * 0.3;
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
  return finish(c, uv);`],

  ['granule_star', 'emissive', 'a star with Worley granulation, limb darkening and a warped corona gathered along the ray',
   ['cells', 'corona', 'spots', ''],
   ``,
   `  let R = 0.6;
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
  return finish(c, uv);`,
   { def: [0.5, 0.5, 0.35, 0.5] }],

  ['plasma_ring', 'emissive', 'a wireframe sphere drawn only near its silhouette, ringed by a flickering plasma',
   ['ring', 'rim', '', ''],
   ``,
   `  let R = 0.85;
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
  return finish(c, uv);`],

  ['neon_shell', 'emissive', 'a warped sphere shell with no surface, only glow gathered where the ray grazes it',
   ['warp', 'sharpness', '', ''],
   `fn map_neon_shell(p0: vec3f) -> f32 {
    let t = u.time; let k = u.k;
    let p = spin(p0, t * 0.4, 0.3 + t * 0.2);
    return length(p) - 0.78 - mix(0.05, 0.28, k.x) * gnoise(p * 2.0 + vec3f(0.0, t * 0.5, 0.0));
}`,
   `  var c = backdrop(rd) * 0.25;
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
  return finish(c, uv);`],
];
