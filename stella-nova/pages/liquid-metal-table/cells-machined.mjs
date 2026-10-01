// ============================================================================
//  LIQUID METAL TABLE  ·  cells-machined.mjs — the machined family
// ────────────────────────────────────────────────────────────────────────────
//  Cut, rolled and turned metal. Each cell builds a normal from the tool
//  geometry: a knurl from two crossed triangle waves on a cylinder, a rose
//  engine groove from r + A sin(N a), fly-cut arcs from the last tool pass
//  that covers the pixel, tread lozenges from a capsule distance, a grille
//  from a hex lattice of holes, fins from an angle folded to one sector, and
//  gear teeth from a polar profile. Tool marks give the grain direction, and
//  the highlight runs across the grain, as on real machined metal.
//
//  GREP MAP
//    knurled_grip .. crossed triangle waves  ·  guilloche_dial .. fn rose
//    face_mill ..... last covering pass      ·  diamond_plate ... fn hTread
//    speaker_grille  hex holes over a cone   ·  heat_sink ....... folded fins
//    gear_train .... fn gearSd
// ============================================================================
export const MACHINED = [
  ['knurled_grip', 'machined', 'a diamond-knurled rod turning on its axis between plain turned shoulders', ['pitch', 'depth', 'turn', ''],
   N => `  let R = 0.3; let s = p.y / R;
  let inRod = smoothstep(1.0, 1.0 - 2.0 * px() / R, abs(s));
  let sc = clamp(s, -0.995, 0.995);
  let cz = sqrt(1.0 - sc * sc);
  let th = asin(sc);
  let K = mix(14.0, 30.0, k.x);
  let v = th * R + t * mix(0.02, 0.12, k.z);
  let u1 = (p.x + v) * K; let u2 = (p.x - v) * K;
  let a1 = abs(fract(u1) - 0.5); let a2 = abs(fract(u2) - 0.5);
  let d1 = sign(fract(u1) - 0.5); let d2 = sign(fract(u2) - 0.5);
  let first = a1 < a2;
  let gx = select(d2, d1, first);
  let gv = select(-d2, d1, first);
  let knurl = smoothstep(0.32, 0.3, abs(p.x));
  let dep = mix(0.6, 1.4, k.y) * knurl;
  let base = vec3f(0.0, sc, cz);
  let tv = vec3f(0.0, cz, -sc);
  var n = normalize(base - (vec3f(1.0, 0.0, 0.0) * gx + tv * gv) * 0.5 * dep);
  let lathe = gnoise(vec2f(p.x * 900.0, 0.5), 222u) * (1.0 - knurl);
  let cham = (1.0 - knurl) * sign(p.x) * 0.8 * smoothstep(0.03, 0.0, abs(abs(p.x) - 0.34));
  n = normalize(n + vec3f(lathe * 0.04 + cham, 0.0, 0.0));
  var c = chrome(n, metalF0(), 0.4) * (0.45 + 0.55 * cz);
  let tip = min(a1, a2);
  c *= mix(1.0, 0.7 + 0.6 * tip, knurl);
  let bg = u.ink.rgb + u.tone.rgb * 0.05 * (1.0 - abs(p.y));
  return present(mix(bg, c, inRod));`],

  ['guilloche_dial', 'machined', 'an engine-turned rosette dial with sunburst chapter ring and blued hands', ['petals', 'depth', 'hands', ''],
   N => `  let r = length(p) + 1e-4; let a = atan2(p.y, p.x); let R = 0.45;
  let np = floor(mix(8.0, 18.0, k.x)); let dep = mix(0.5, 1.5, k.y);
  let e = px();
  let f0 = rose(p, np); let fx = rose(p + vec2f(e, 0.0), np); let fy = rose(p + vec2f(0.0, e), np);
  let g = vec2f(fx - f0, fy - f0) / e;
  let tri = fract(f0) - 0.5;
  let inner = smoothstep(0.3, 0.29, r);
  var n = normalize(vec3f(-g * sign(tri) * 0.0028 * dep * inner, 1.0));
  let sun = (1.0 - inner) * smoothstep(R, R - 0.01, r);
  let rg = gnoise(vec2f(a * 120.0, r * 3.0), 221u);
  n = normalize(n + vec3f(vec2f(-p.y, p.x) / r * rg * 0.15 * sun, 0.0));
  let tone = mix(vec3f(0.92, 0.80, 0.72), metalF0(), 0.4);
  var c = chrome(n, tone, 0.0);
  let lo = PI * 0.5 - t * mix(0.02, 0.2, k.z);
  let la = (a - lo) - TAU * floor((a - lo) / TAU + 0.5);
  c += u.cream.rgb * sun * pow(max(cos(la), 0.0), 8.0) * (0.3 + 0.4 * abs(rg)) * 0.5;
  let ang = TAU / 12.0;
  let ai = a - ang * floor(a / ang + 0.5);
  let idx = vec2f(r * cos(ai) - 0.37, r * sin(ai));
  let bd = max(abs(idx.x) - 0.035, abs(idx.y) - 0.007);
  let bm = smoothstep(px(), -px(), bd);
  c = mix(c, tubeShade(idx.y / 0.007, vec2f(0.0, 1.0), metalF0(), 0.3), bm);
  let hm = t * mix(0.05, 0.5, k.z);
  let hb = vec3f(0.12, 0.2, 0.55);
  for (var i: i32 = 0; i < 2; i++) {
    let fi = f32(i);
    let ha = PI * 0.5 - hm * select(1.0, 1.0 / 12.0, i == 0) - 1.1 * fi;
    let hd = vec2f(cos(ha), sin(ha));
    let L = select(0.36, 0.24, i == 0);
    let along = dot(p, hd);
    let across = dot(p, vec2f(-hd.y, hd.x));
    let wd = mix(0.014, 0.004, clamp(along / L, 0.0, 1.0)) + 0.006 * select(1.0, 1.5, i == 0);
    let hs = across / wd;
    let hmask = bandMask(hs, 2.0 * px() / wd) * step(-0.05, along) * step(along, L);
    let hc0 = clamp(hs, -1.0, 1.0);
    let hn = vec3f(vec2f(-hd.y, hd.x) * hc0 * 0.7, sqrt(1.0 - 0.49 * hc0 * hc0));
    let hc = chrome(hn, hb, 0.4) * 1.3 + hb * 0.2;
    c = mix(c * (1.0 - 0.4 * smoothstep(0.02, 0.0, abs(across - 0.008) - wd) * step(0.0, along) * step(along, L)), hc, hmask);
  }
  c = mix(c, chrome(ballN(p, 0.018), metalF0(), 0.0), smoothstep(0.018, 0.016, r));
  let rim = smoothstep(R - 0.02, R, r);
  c = mix(c, tubeShade((r - (R + 0.0)) / 0.02, p / r, vec3f(1.0, 0.78, 0.45), 0.0), rim * smoothstep(R + 0.02, R + 0.018, r));
  let bg = u.ink.rgb + u.tone.rgb * 0.05 * exp(-r * 3.0);
  return present(mix(bg, c, smoothstep(R + 0.02, R + 0.02 - px(), r)));`,
   `// rose engine phase: rings pushed in and out by petals, the petals twisting
// a little with radius; the groove is the triangle wave of this phase
fn rose(p: vec2f, np: f32) -> f32 {
    let r = length(p) + 1e-4; let a = atan2(p.y, p.x);
    return r * 60.0 + 1.1 * sin(np * a + r * 14.0) + 0.35 * sin(np * 2.0 * a - r * 24.0);
}`],

  ['face_mill', 'machined', 'fly-cut rows of overlapping arcs; the grain glints across each tool pass', ['step', 'spread', 'turn', ''],
   N => `  let rows = 3.0; let rh = 1.0 / rows;
  let R = rh * 0.62;
  let st = mix(0.06, 0.15, k.x);
  let gy = p.y / rh + 0.5 * rows;
  var best = vec2f(0.0);
  for (var j: i32 = 0; j < 2; j++) {
    let row = floor(gy) - f32(j);
    let cy = (row + 0.5) * rh - 0.5;
    let dy = p.y - cy;
    if (abs(dy) < R) {
      let hw = sqrt(R * R - dy * dy);
      let i = floor((p.x + hw) / st);
      best = vec2f(i * st, cy);
    }
  }
  let d = p - best;
  let dl = max(length(d), 1e-4);
  let tg = vec2f(-d.y, d.x) / dl;
  let g = gnoise(vec2f(dl * 900.0, 0.0), 231u) * 0.6 + gnoise(vec2f(dl * 2600.0, 3.0), 232u) * 0.4;
  let la = t * mix(0.1, 0.5, k.z) + 0.6;
  let L = normalize(vec3f(cos(la), sin(la), 0.35));
  let n = normalize(vec3f(d / dl * g * 0.02, 1.0));
  var c = env(reflect(-VIEW, n), la) * fres(metalF0(), 1.0) * 0.4 * (0.85 + 0.15 * g);
  let an = kk(vec3f(tg, 0.0), L, VIEW, mix(60.0, 8.0, k.y));
  c += mix(u.tone.rgb, u.cream.rgb, 0.7) * an * (0.55 + 0.45 * g) * 1.1;
  let nx = best + vec2f(st, 0.0);
  let dn = length(p - nx) - R;
  c *= 0.7 + 0.3 * smoothstep(0.0, 0.004, abs(dn));
  c += u.cream.rgb * 0.15 * smoothstep(0.003, 0.0, abs(dn + 0.002));
  return present(c);`],

  ['diamond_plate', 'machined', 'aluminium tread plate: lozenges raised in alternate directions', ['scale', 'raise', 'sweep', ''],
   N => `  let sc = mix(3.0, 6.0, k.x); let ra = mix(0.5, 1.5, k.y);
${N(q => `hTread(${q}, sc, ra)`, '1.0')}
  let spin = 0.7 * sin(t * mix(0.15, 0.6, k.z));
  let g = gnoise(vec2f(p.x * 6.0, p.y * 500.0), 241u);
  var c = chrome(normalize(n + vec3f(0.0, g * 0.02, 0.0)), vec3f(0.91, 0.92, 0.93), spin) * (0.88 + 0.12 * g);
  let lx = p.x + p.y - 0.6 * sin(t * mix(0.15, 0.6, k.z));
  c += u.cream.rgb * 0.25 * exp(-lx * lx * 18.0) * smoothstep(0.002, 0.012, h_);
  return present(c);`,
   `// each cell holds one lozenge (a capsule pinched at the ends), turned +45 or
// -45 degrees in a checker; the plateau has a rounded shoulder
fn hTread(p: vec2f, sc: f32, ra: f32) -> f32 {
    let g = p * sc; let id = floor(g); let q = fract(g) - 0.5;
    let par = (i32(id.x) + i32(id.y)) & 1;
    let ang = select(-0.785, 0.785, par == 0);
    let lq = rot2(ang) * q;
    let x = clamp(lq.x, -0.3, 0.3);
    let w = 0.16 * (1.0 - pow(abs(x) / 0.33, 2.0));
    let d = length(vec2f(lq.x - x, lq.y)) - w;
    let bump = smoothstep(0.03, -0.13, d);
    return ra * 0.03 * bump * bump * (3.0 - 2.0 * bump) / sc;
}`],

  ['speaker_grille', 'machined', 'a perforated grille; through the holes a backlit woofer cone pumps', ['holes', 'size', 'beat', ''],
   N => `  let sc = mix(8.0, 18.0, k.x);
  let hx = hexCell(p * sc);
  let q = hx.q;
  let rh = mix(0.26, 0.42, k.y);
  let ql = length(q) + 1e-4;
  let beat = pow(0.5 + 0.5 * sin(t * mix(2.0, 7.0, k.z)), 4.0);
  let sh = p * (0.96 - 0.03 * beat);
  let r = length(sh) + 1e-4;
  let rad = sh / r;
  let cone = 0.06 * smoothstep(0.42, 0.1, r) + 0.004 * sin(r * 90.0) * step(0.14, r);
  let slope = (r - 0.1) * 0.6;
  var cn = normalize(vec3f(rad * (slope + 0.12 * cos(r * 90.0) * step(0.14, r)), 1.0));
  if (r < 0.12) { cn = ballN(sh, 0.12 + 0.02 * beat); }
  let cl = max(dot(cn, normalize(vec3f(-0.4, 0.5, 0.8))), 0.0);
  var inside = mix(u.ink.rgb, u.tone.rgb, 0.45) * (0.2 + 1.2 * cl) * (0.7 + 0.6 * beat) + u.cream.rgb * pow(cl, 30.0) * 0.6;
  inside *= smoothstep(0.0, rh * 0.9, rh - ql) * 0.6 + 0.4;
  inside += mix(u.tone.rgb, vec3f(1.0, 0.55, 0.25), 0.6) * (0.25 + 0.75 * beat) * exp(-r * r * 9.0) * 0.5;
  let bev = smoothstep(rh, rh + 0.12, ql);
  let sheetN = normalize(vec3f(-q / ql * (1.0 - bev) * 0.9 + p * 0.25, 1.0));
  let sheet = chrome(sheetN, vec3f(0.62, 0.64, 0.68), 0.2 * sin(t * 0.3)) * (0.7 + 0.3 * bev);
  let m = smoothstep(rh, rh + 1.5 * px() * sc, ql);
  return present(mix(inside, sheet, m));`],

  ['heat_sink', 'machined', 'a radial heat sink: fins round a copper core, light sweeping the grain', ['fins', 'thick', 'sweep', ''],
   N => `  let r = length(p) + 1e-4; let a = atan2(p.y, p.x);
  let nf = floor(mix(24.0, 48.0, k.x));
  let sec = TAU / nf;
  let af = a - sec * floor(a / sec + 0.5);
  let lat = r * sin(af);
  let w = mix(0.3, 0.7, k.y) * 0.5 * r * sec;
  let s = lat / w;
  let fin = bandMask(s, 2.0 * px() / w) * smoothstep(0.45, 0.445, r) * step(0.13, r);
  let la = t * mix(0.1, 0.5, k.z);
  let rad = p / r;
  let tg = vec3f(rad, 0.0);
  let L = normalize(vec3f(cos(la) * 0.6, sin(la) * 0.6, 0.8));
  let ch = smoothstep(0.55, 1.0, abs(s));
  let fn0 = normalize(vec3f(vec2f(-rad.y, rad.x) * sign(s) * ch * 0.9, 1.0));
  var fc = chrome(fn0, vec3f(0.85, 0.87, 0.9), la) * 0.6;
  fc += mix(u.tone.rgb, u.cream.rgb, 0.8) * kk(tg, L, VIEW, 12.0) * 0.8 * (0.8 + 0.2 * gnoise(vec2f(r * 900.0, a * 3.0), 251u));
  let gapLight = abs(lat) / (r * sec * 0.5);
  let gap = u.ink.rgb + mix(u.tone.rgb, u.cream.rgb, 0.3) * 0.25 * (1.0 - gapLight) * (1.0 - gapLight) * smoothstep(0.47, 0.15, r) * max(dot(vec3f(-rad * sign(af), 0.4), L), 0.0);
  var c = mix(gap, fc, fin);
  let core = smoothstep(0.13, 0.13 - px(), r);
  let cg = gnoise(vec2f(r * 700.0, 0.0), 252u);
  let cn = normalize(vec3f(p * 1.5 + rad * cg * 0.03, 1.0));
  var cc = chrome(cn, vec3f(0.95, 0.64, 0.54), la) * (0.85 + 0.15 * cg);
  cc += vec3f(1.0, 0.7, 0.55) * kk(vec3f(-rad.y, rad.x, 0.0), L, VIEW, 30.0) * 0.5;
  let screw = smoothstep(0.03, 0.028, r);
  cc = mix(cc, chrome(ballN(p, 0.03), metalF0(), la) * (1.0 - 0.8 * smoothstep(0.006, 0.0, abs(p.x)) * step(abs(p.y), 0.022)), screw);
  c = mix(c, cc, core);
  return present(c);`],

  ['gear_train', 'machined', 'a steel gear and a brass gear in mesh, bevelled teeth catching the light', ['teeth', 'bevel', 'speed', ''],
   N => `  let nA = floor(mix(12.0, 20.0, k.x)); let nB = floor(nA * 0.6);
  let mdl = 0.5 / (nA + nB);
  let RA = mdl * nA; let RB = mdl * nB;
  let cA = vec2f(-0.16, -0.1); let cB = cA + rot2(0.6) * vec2f(RA + RB, 0.0);
  let wA = t * mix(0.1, 0.6, k.z);
  let wB = -wA * nA / nB + PI / nB - 0.6 * (1.0 + nA / nB) - PI;
  let bv = mix(0.01, 0.03, k.y);
  let e = px();
  let sA = gearSd(p - cA, RA, nA, wA, mdl);
  let sB = gearSd(p - cB, RB, nB, wB, mdl);
  let gA = vec2f(gearSd(p - cA + vec2f(e, 0.0), RA, nA, wA, mdl) - sA, gearSd(p - cA + vec2f(0.0, e), RA, nA, wA, mdl) - sA) / e;
  let gB = vec2f(gearSd(p - cB + vec2f(e, 0.0), RB, nB, wB, mdl) - sB, gearSd(p - cB + vec2f(0.0, e), RB, nB, wB, mdl) - sB) / e;
  let bA = smoothstep(-bv, 0.0, sA); let bB = smoothstep(-bv, 0.0, sB);
  let rA = length(p - cA); let rB = length(p - cB);
  let tA = gnoise(vec2f(rA * 800.0, 0.0), 261u); let tB = gnoise(vec2f(rB * 800.0, 0.0), 262u);
  let nAv = normalize(vec3f(gA * bA * 1.2 + (p - cA) / max(rA, 1e-3) * tA * 0.02, 1.0));
  let nBv = normalize(vec3f(gB * bB * 1.2 + (p - cB) / max(rB, 1e-3) * tB * 0.02, 1.0));
  var A = chrome(nAv, metalF0(), 0.3 * sin(t * 0.2));
  var B = chrome(nBv, vec3f(1.0, 0.78, 0.42), 0.3 * sin(t * 0.2));
  let la = t * 0.2;
  A += u.cream.rgb * kk(vec3f(-(p - cA).y, (p - cA).x, 0.0), normalize(vec3f(cos(la), sin(la), 1.0)), VIEW, 30.0) * 0.25 * (1.0 - bA);
  B += vec3f(1.0, 0.8, 0.5) * kk(vec3f(-(p - cB).y, (p - cB).x, 0.0), normalize(vec3f(cos(la), sin(la), 1.0)), VIEW, 30.0) * 0.25 * (1.0 - bB);
  let shadowA = smoothstep(0.03, 0.0, sA - 0.01) * 0.6;
  let shadowB = smoothstep(0.03, 0.0, sB - 0.01) * 0.6;
  var c = (u.ink.rgb + u.tone.rgb * 0.06 * (0.5 - p.y)) * (1.0 - max(shadowA, shadowB));
  c = mix(c, B, smoothstep(px(), -px(), sB));
  c = mix(c, A, smoothstep(px(), -px(), sA));
  return present(c);`,
   `// gear distance: a disc of pitch radius R with trapezoid teeth from a clamped
// cosine, a hub bore, and five round lightening holes in the web
fn gearSd(q0: vec2f, R: f32, nt: f32, w: f32, mdl: f32) -> f32 {
    let q = rot2(w) * q0;
    let r = length(q); let a = atan2(q.y, q.x);
    let tooth = clamp(cos(nt * a) * 1.6, -1.0, 1.0);
    var d = r - (R + mdl * 0.85 * tooth);
    d = max(d, -(r - 0.12 * R));
    let ha = TAU / 5.0;
    let a5 = a - ha * floor(a / ha + 0.5);
    let hq = vec2f(r * cos(a5) - 0.55 * R, r * sin(a5));
    d = max(d, -(length(hq) - 0.2 * R));
    return d * 0.8;
}`],
];
