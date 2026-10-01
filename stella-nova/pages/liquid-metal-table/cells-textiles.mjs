// ============================================================================
//  LIQUID METAL TABLE  ·  cells-textiles.mjs — the textiles family
// ────────────────────────────────────────────────────────────────────────────
//  Cloth and metal cloth. Fibre highlights use the Kajiya-Kay strand term
//  (kk): a thread along tangent tg glints where tg is at a right angle to the
//  half vector, so the glint runs across the thread direction and slides as
//  the folds turn. Foil and sequins are flat facets; chainmail is a ring
//  lattice where each pixel keeps the ring nearest the eye.
//
//  GREP MAP
//    shot_silk ..... fn hSilk, two shifted kk lobes  ·  crumpled_foil .. two Worley facet levels
//    sequin_field .. hex discs that flip on a wave   ·  chainmail ...... 4-in-1 ring lattice
//    satin_pleats .. fan of knife pleats             ·  lame_weave ..... plain weave of metal threads
// ============================================================================
export const TEXTILES = [
  ['shot_silk', 'textiles', 'shot silk: teal warp, crimson weft, two strand highlights sliding on folds', ['folds', 'shot', 'sway', ''],
   N => `  let f = mix(18.0, 34.0, k.x); let tt = t * mix(0.3, 1.1, k.z);
${N(q => `hSilk(${q}, tt, f)`, '1.0')}
  let ax = vec3f(0.8775826, 0.4794255, 0.0);
  let tg = normalize(ax - n * dot(n, ax));
  let L = normalize(vec3f(-0.25 + 0.3 * sin(t * 0.21), 0.65, 0.7));
  let warp = vec3f(0.02, 0.36, 0.34); let weft = vec3f(0.62, 0.05, 0.14);
  let shot = clamp(pow(1.0 - n.z, 0.8) * mix(0.5, 1.6, k.y) + 0.2 * dot(n.xy, vec2f(0.8, -0.5)), 0.0, 1.0);
  let col = mix(warp, weft, shot);
  let thr = 0.95 + 0.05 * gnoise(rot2(-0.5) * p * vec2f(600.0, 20.0), 281u);
  var c = col * (0.05 + 0.65 * max(dot(n, L), 0.0)) * thr;
  c += mix(col, u.cream.rgb, 0.7) * kk(normalize(tg + n * 0.25), L, VIEW, 160.0) * 1.2 * thr;
  c += col * 1.4 * kk(normalize(tg - n * 0.2), L, VIEW, 30.0) * 0.5;
  c += env(reflect(-VIEW, n), 0.0) * fres(vec3f(0.03), n.z) * 0.25;
  return present(c);`,
   `fn hSilk(p: vec2f, t: f32, f: f32) -> f32 {
    let q = rot2(0.5) * p;
    let a = q.x * f + 1.3 * sin(q.y * 1.7 + q.x * 2.0 + 0.4 * t) + 1.2 * fbm(q * 1.8 + vec2f(0.0, 0.05 * t), 3, 283u);
    return (0.9 / f) * (sin(a) + 0.35 * sin(2.0 * a + 1.0 + 0.3 * t));
}`],

  ['crumpled_foil', 'textiles', 'crumpled aluminium foil: two scales of flat facets with creases', ['crumple', 'tilt', 'turn', ''],
   N => `  let sc = mix(3.0, 7.0, k.x); let cr = mix(0.1, 0.4, k.y);
  let wp = p + 0.03 * vec2f(fbm(p * 4.0, 2, 291u), fbm(p * 4.0 + 7.0, 2, 292u));
  let v1 = voronoi(wp * sc, 0.0, 0.95, 293u);
  let v2 = voronoi(wp * sc * 2.7 + 3.0, 0.0, 0.95, 294u);
  let a1 = TAU * v1.id.x; let a2 = TAU * v2.id.x;
  let tilt = vec2f(cos(a1), sin(a1)) * cr * (0.3 + 0.7 * v1.id.y) + vec2f(cos(a2), sin(a2)) * cr * 0.5 * v2.id.y + vec2f(0.0, 0.2);
  let n = normalize(vec3f(tilt + 0.05 * vec2f(fbm(p * 14.0, 2, 295u), fbm(p * 14.0 + 5.0, 2, 296u)) + p * 0.3, 1.0));
  let spin = t * mix(0.08, 0.4, k.z);
  var c = chrome(n, vec3f(0.93, 0.94, 0.95), spin) * 1.1;
  let e1 = smoothstep(0.0, 0.01 + 1.5 * px() * sc, v1.edge);
  let e2 = smoothstep(0.0, 0.008 + 1.5 * px() * sc * 2.7, v2.edge);
  let side = dot(v1.dir, vec2f(0.6, 0.8));
  c *= (0.7 + 0.3 * e1) * (0.88 + 0.12 * e2);
  c += u.cream.rgb * (1.0 - e1) * 0.5 * smoothstep(0.0, 0.8, side);
  return present(c);`],

  ['sequin_field', 'textiles', 'sequins on a hex lattice flip silver to magenta as a brush wave passes', ['scale', 'wave', 'speed', ''],
   N => `  let sc = mix(7.0, 14.0, k.x);
  let hx = hexCell(p * sc);
  let q = hx.q;
  let cc = (p * sc - q) / sc;
  let r = rnd2(vec2i(hx.id), 301u);
  let wv = sin(dot(cc, vec2f(0.8, 0.5)) * mix(3.0, 9.0, k.y) - t * mix(0.4, 1.6, k.z)) + (r.x - 0.5) * 0.6;
  let phi = PI * smoothstep(-0.35, 0.35, wv);
  let cphi = cos(phi);
  let qy = q.y / max(abs(cphi), 0.06);
  let ql = length(vec2f(q.x, qy));
  let rd = 0.49;
  let m = smoothstep(rd, rd - 1.5 * px() * sc / max(abs(cphi), 0.06), ql);
  let back = cphi < 0.0;
  let tl = (r - 0.5) * 0.35;
  let nd = normalize(vec3f(tl.x + q.x * 0.5, sin(phi) * select(1.0, -1.0, back) + tl.y + qy * 0.4 * abs(cphi), abs(cphi) + 0.05));
  let sA = chrome(nd, metalF0(), 0.2);
  let sB = chrome(nd, vec3f(0.95, 0.28, 0.58), 0.2) * 1.15;
  var s = select(sA, sB, back);
  s *= 0.75 + 0.25 * smoothstep(0.05, 0.1, ql);
  s = mix(s, u.ink.rgb, smoothstep(0.07, 0.05, ql) * smoothstep(0.3, 0.6, abs(cphi)));
  let cloth = u.ink.rgb + vec3f(0.08, 0.02, 0.05) * (0.5 + 0.5 * gnoise(p * 200.0, 302u));
  return present(mix(cloth, s, m));`],

  ['chainmail', 'textiles', '4-in-1 chainmail: tilted steel rings, each pixel keeps the nearest ring', ['rings', 'sway', 'speed', ''],
   N => `  let sc = mix(3.5, 7.0, k.x); let tt = t * mix(0.3, 1.2, k.z);
  let sw = mix(0.005, 0.04, k.y);
  let pw = p + vec2f(sw * sin(p.y * 6.0 + tt * 1.3), sw * 0.6 * sin(p.x * 5.0 + tt * 1.7));
  let g = pw * sc;
  let R = 0.37; let w = 0.11;
  var bz = -1e9; var bs = 2.0; var bd = vec2f(1.0, 0.0); var brow = 0.0;
  let r0 = round(g.y / 0.5);
  for (var dj: i32 = -1; dj <= 1; dj++) {
    let row = r0 + f32(dj);
    let off = 0.5 * (row - 2.0 * floor(row * 0.5));
    let cy = row * 0.5;
    let i0 = floor(g.x - off);
    for (var di: i32 = 0; di <= 1; di++) {
      let c = vec2f(i0 + f32(di) + off, cy);
      let q = g - c;
      let tsgn = select(-1.0, 1.0, (i32(row) & 1) == 0);
      let qe = vec2f(q.x / 0.86, q.y);
      let rr = length(qe) + 1e-4;
      let s = (rr - R) / w;
      let z = tsgn * q.x * 0.6 + sqrt(max(1.0 - s * s, 0.0)) * w;
      if (abs(s) < 1.0 && z > bz) { bz = z; bs = s; bd = qe / rr; brow = row; }
    }
  }
  let m = bandMask(bs, 2.5 * px() * sc / w);
  let drape = 0.75 + 0.25 * sin(p.x * 6.0 + tt * 1.3 + p.y * 2.0);
  let f0 = mix(metalF0(), vec3f(0.85, 0.83, 0.8), 0.5);
  let ring = tubeShade(bs, bd, f0, 0.3 * sin(t * 0.2) + 0.4) * drape * 1.2;
  let bg = u.ink.rgb * 0.5 + u.tone.rgb * 0.03;
  return present(mix(bg, ring, m));`],

  ['satin_pleats', 'textiles', 'a fan of wine satin knife pleats swaying, sheen along the threads', ['pleats', 'depth', 'sway', ''],
   N => `  let piv = vec2f(0.0, 0.85);
  let d = p - piv; let r = length(d); let a = atan2(d.x, -d.y);
  let np = mix(6.0, 14.0, k.x);
  let sway = 0.05 * sin(t * mix(0.3, 1.2, k.z) + r * 3.0);
  let uu = (a + sway) * np;
  let fu = fract(uu) - 0.5;
  let slope = fu / sqrt(fu * fu + 0.01) * mix(0.4, 1.0, k.y) * (0.7 + 0.6 * abs(fu) * 2.0);
  let ru = d / r; let tang = vec2f(-ru.y, ru.x);
  let n = normalize(vec3f(tang * slope * 0.8 + ru * 0.15 * sin(r * 6.0 - t * 0.5), 1.0));
  let L = normalize(vec3f(-0.4 + 0.2 * sin(t * 0.17), 0.6, 0.7));
  let wine = mix(vec3f(0.44, 0.03, 0.10), u.tone.rgb * 0.3, 0.15);
  let ao = 0.45 + 0.55 * (1.0 - abs(fu) * 2.0);
  var c = wine * (0.05 + 0.7 * max(dot(n, L), 0.0)) * ao;
  let hv = normalize(L + VIEW);
  c += vec3f(1.0, 0.45, 0.5) * pow(max(dot(n, hv), 0.0), 12.0) * 0.5 * ao;
  c += mix(wine, u.cream.rgb, 0.75) * pow(max(dot(n, hv), 0.0), 90.0) * 0.9;
  c *= 0.9 + 0.1 * gnoise(vec2f(uu * 3.0, r * 600.0), 311u);
  return present(c);`],

  ['lame_weave', 'textiles', 'gold lamé: a 3/1 twill of gold warp over pale silver weft in soft folds, glinting', ['threads', 'folds', 'light', ''],
   N => `  let sc = mix(22.0, 44.0, k.x); let f = mix(9.0, 18.0, k.y); let tt = t * 0.5;
${N(q => `hDrape(${q}, tt, f)`, '0.8')}
  let g = p * sc; let id = floor(g); let fq = fract(g) - 0.5;
  let warpTop = ((i32(id.x) + i32(id.y)) & 3) < 3;
  let s = select(fq.y, fq.x, warpTop) / 0.45;
  let cz = sqrt(max(1.0 - min(s * s, 1.0), 0.0));
  let tw = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), warpTop);
  let nt = normalize(n + vec3f(select(vec2f(0.0, s), vec2f(s, 0.0), warpTop) * 0.12, 0.0));
  let la = t * mix(0.1, 0.6, k.z);
  let L = normalize(vec3f(0.5 * cos(la), 0.5 * sin(la) + 0.3, 0.8));
  let f0 = select(vec3f(0.86, 0.84, 0.80), vec3f(1.0, 0.76, 0.36), warpTop);
  var c = chrome(nt, f0, la * 0.5) * (0.75 + 0.25 * cz);
  c += f0 * kk(normalize(tw - n * dot(n, tw)), L, VIEW, 60.0) * 0.45 * cz;
  let gl = rnd2(vec2i(id), 313u);
  c += u.cream.rgb * step(0.97, gl.x) * pow(0.5 + 0.5 * sin(la * 9.0 + gl.y * TAU), 12.0) * 1.5 * cz;
  return present(c);`],
];
