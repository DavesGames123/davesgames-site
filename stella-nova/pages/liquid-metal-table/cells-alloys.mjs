// ============================================================================
//  LIQUID METAL TABLE  ·  cells-alloys.mjs — the alloys family
// ────────────────────────────────────────────────────────────────────────────
//  Distinct metals, each with a base reflectance (F0) near its measured
//  color: gold (1.00 0.71 0.29), copper (0.95 0.64 0.54), bronze, titanium,
//  steel, rose gold and gunmetal. Each metal gets its own surface so the
//  tiles do not read as one height field in eight colors. Oxide colors come
//  from oxide(), the complement of filmN with an oxide index (TiO2 near
//  2.4, copper and iron oxides near 2.6).
//
//  GREP MAP
//    gold_leaf ...... fn hLeaf    ·  copper_tarnish .. fn hRidge
//    bronze_patina .. fn hBoss    ·  anodized_ti ..... fn hTi
//    blued_steel .... tempered bar ·  rose_facets ..... brilliant-cut rings
//    gunmetal ....... fn hCrease  ·  damascus ........ fn dmF
// ============================================================================
export const ALLOYS = [
  ['gold_leaf', 'alloys', 'gold leaf laid in offset sheets, each sheet tilted and crinkled', ['sheets', 'crinkle', 'sweep', ''],
   N => `  let ns = floor(mix(2.0, 4.0, k.x)); let cr = mix(0.4, 1.6, k.y);
${N(q => `hLeaf(${q}, ns, cr, t)`, '1.0')}
  let spin = 0.6 * sin(t * mix(0.15, 0.6, k.z)) - 0.3;
  var c = chrome(n, vec3f(1.0, 0.71, 0.29), spin);
  let g = leafG(p, ns); let row = floor(g.y);
  let gx = g.x + 0.5 * (row - 2.0 * floor(row * 0.5));
  let sq = abs(vec2f(fract(gx), fract(g.y)) - 0.5);
  let seam = smoothstep(0.5 - 1.5 * px() * ns, 0.5, max(sq.x, sq.y));
  c = mix(c, c * 0.45 + vec3f(0.3, 0.06, 0.02) * 0.2, seam);
  return present(c);`,
   `// a gilded panel: square leaves in offset rows, each one tilted, lifted at
// its rim and crinkled by fbm; the ridges between leaves give the seams
fn leafG(p: vec2f, ns: f32) -> vec2f {
    return p * ns + 0.06 * vec2f(fbm(p * 5.0, 2, 31u), fbm(p * 5.0 + 3.0, 2, 32u));
}
fn hLeaf(p: vec2f, ns: f32, cr: f32, t: f32) -> f32 {
    let g = leafG(p, ns);
    let row = floor(g.y);
    let gx = g.x + 0.5 * (row - 2.0 * floor(row * 0.5));
    let id = vec2f(floor(gx), row);
    let q = vec2f(fract(gx), fract(g.y)) - 0.5;
    let r = rnd2(vec2i(id), 3u) - vec2f(0.5);
    let tilt = dot(q, r) * 0.22;
    let lift = 0.04 * smoothstep(0.3, 0.5, max(abs(q.x), abs(q.y)));
    let breath = 0.04 * sin(t * 0.7 + r.x * 6.0) * dot(q, q);
    let wr = rot2(r.x * 3.0) * (p * 9.0 + r * 7.0);
    let crease = 1.0 - abs(gnoise(wr, 34u));
    let crink = cr * (0.006 * crease * crease * crease + 0.002 * fbm(p * 14.0 + r * 9.0, 3, 33u));
    return (tilt + lift + breath) / ns + crink + 0.02 * fbm(p * 1.2, 2, 35u);
}`],

  ['copper_tarnish', 'alloys', 'folded copper; a thin cuprite film blooms red and violet in the valleys', ['scale', 'tarnish', 'flow', ''],
   N => `  let sc = mix(1.2, 2.6, k.x); let tt = t * mix(0.3, 1.2, k.z);
${N(q => `hRidge(${q}, tt, sc)`, '0.8')}
  let low = smoothstep(0.012, -0.03, h_ * sc);
  let d = mix(5.0, 75.0, low * mix(0.5, 1.2, k.y)) + 12.0 * fbm(p * 6.0, 3, 61u);
  let ox = oxide(max(d, 0.0), n.z, 2.6);
  var c = chrome(n, vec3f(0.95, 0.64, 0.54), 0.2);
  c *= ox;
  return present(c);`,
   `// ridged warp: 1 - |fbm| folds the sheet into sharp crests and soft valleys
fn hRidge(p: vec2f, t: f32, sc: f32) -> f32 {
    let q = p * sc;
    let w = vec2f(fbm(q + vec2f(0.0, 0.09 * t), 3, 71u), fbm(q + vec2f(4.1, 2.3) - vec2f(0.07 * t, 0.0), 3, 72u));
    let f = fbm(q * 1.3 + 1.8 * w, 4, 73u);
    let r = 1.0 - abs(f);
    return (0.05 * r * r - 0.025) / sc;
}`],

  ['bronze_patina', 'alloys', 'cast bronze bosses; verdigris creeps from the recesses and recedes', ['bosses', 'patina', 'creep', ''],
   N => `  let sc = mix(3.0, 7.0, k.x);
${N(q => `hBoss(${q}, sc)`, '1.0')}
  let lvl = h_ * sc / 0.075;
  let creep = 0.5 + 0.5 * sin(t * mix(0.1, 0.5, k.z));
  let mott = fbm(p * 9.0, 4, 81u);
  let pat = smoothstep(mix(0.15, 0.55, k.y) * (0.6 + 0.5 * creep), 0.05, lvl + 0.25 * mott);
  let metal = chrome(n, vec3f(0.80, 0.55, 0.32), 0.3 * sin(t * 0.2));
  let l = normalize(KEY);
  let crust = mix(vec3f(0.10, 0.42, 0.36), vec3f(0.42, 0.72, 0.60), 0.5 + 0.5 * fbm(p * 30.0, 3, 82u));
  let warm = vec3f(0.55, 0.36, 0.18) * (0.08 + 0.45 * max(dot(n, l), 0.0));
  let ver = crust * (0.18 + 0.75 * max(dot(n, l), 0.0)) * (0.8 + 0.3 * mott);
  return present(mix(metal * 1.15 + warm, ver, pat));`,
   `// raised domes on Worley sites with a cast pitting on top
fn hBoss(p: vec2f, sc: f32) -> f32 {
    let f = vorF1(p * sc, 47u);
    let dome = sqrt(max(1.0 - (f / 0.62) * (f / 0.62), 0.0));
    return (0.075 * dome) / sc + 0.0004 * fbm(p * 40.0, 2, 48u);
}`],

  ['anodized_ti', 'alloys', 'anodized titanium; oxide thickness follows the height, so contours run in rainbow', ['scale', 'voltage', 'flow', ''],
   N => `  let sc = mix(1.0, 2.2, k.x); let tt = t * mix(0.25, 1.0, k.z);
${N(q => `hTi(${q}, tt, sc)`, '0.9')}
  let d = mix(20.0, 50.0, k.y) + mix(120.0, 260.0, k.y) * clamp(0.5 + 0.5 * h_ * 45.0 * sc, 0.0, 1.0);
  let ox = oxide(d, n.z, 2.4);
  let base = chrome(n, vec3f(0.62, 0.60, 0.58), 0.0);
  let lum = dot(base, vec3f(0.3, 0.5, 0.2));
  var c = ox * ox * (0.1 + 1.25 * lum);
  let h = normalize(normalize(KEY) + VIEW);
  c += u.cream.rgb * pow(max(dot(n, h), 0.0), 180.0) * 1.2;
  return present(c);`,
   `fn hTi(p: vec2f, t: f32, sc: f32) -> f32 {
    let q = p * sc;
    let w = vec2f(fbm(q + vec2f(0.05 * t, 0.0), 3, 111u), fbm(q + vec2f(3.7, 8.1) + vec2f(0.0, 0.04 * t), 3, 112u));
    return 0.04 * fbm(q + 1.3 * w, 4, 113u) / sc;
}`],

  ['blued_steel', 'alloys', 'ground steel tempered from one end: straw, bronze, purple, blue, as the torch moves', ['heat', 'spread', 'torch', ''],
   N => `  let g = gnoise(vec2f(p.x * 3.0, p.y * 420.0), 121u) * 0.6 + gnoise(vec2f(p.x * 8.0, p.y * 1300.0), 122u) * 0.4;
  let n = normalize(vec3f(0.0, 0.2 * p.y + 0.12 + g * 0.03, 1.0));
  let xc = 0.18 * sin(t * mix(0.15, 0.6, k.z));
  let w = mix(0.35, 0.8, k.y);
  let T = smoothstep(-w, w, p.x - xc + 0.25 * p.y * p.y + 0.06 * fbm(p * 3.0, 3, 123u));
  let d = 4.0 + mix(70.0, 110.0, k.x) * T;
  let ox0 = oxide(d, n.z, 2.6);
  let ox = max(mix(vec3f(dot(ox0, vec3f(0.3, 0.5, 0.2))), ox0, 1.8), vec3f(0.0));
  let r = reflect(-VIEW, n);
  let steel = env(r, 0.0) * fres(vec3f(0.56, 0.57, 0.58), n.z) * (0.75 + 0.25 * g);
  var c = (steel + vec3f(0.06)) * ox * 1.1;
  let lx = p.x + 0.33;
  c += u.cream.rgb * exp(-lx * lx * 260.0) * (0.6 + 0.4 * g) * ox * 0.7;
  return present(c);`],

  ['rose_facets', 'alloys', 'a rose gold brilliant cut: rings of flat facets flash in turn as the light circles', ['table', 'crown', 'turn', ''],
   N => `  let r = length(p) + 1e-4; let a = atan2(p.y, p.x); let R = 0.44;
  let spin = t * mix(0.1, 0.6, k.z);
  let s8 = TAU / 8.0; let s16 = TAU / 16.0;
  let a8 = a - s8 * round(a / s8);
  let rp = r * cos(a8);
  let R0 = mix(0.1, 0.18, k.x); let R1 = R0 + 0.11; let R2 = R1 + 0.09;
  let cr = mix(0.6, 1.4, k.y);
  var ac = 0.0; var tl = 0.0; var eg = 1.0;
  if (rp < R0) { tl = 0.0; eg = R0 - rp; }
  else if (rp < R1) {
    ac = s8 * (floor(a / s8) + 0.5); tl = 0.28 * cr;
    eg = min(min(rp - R0, R1 - rp), r * abs(sin(a - s8 * round(a / s8))));
  } else if (rp < R2) {
    ac = s8 * round(a / s8); tl = 0.5 * cr;
    eg = min(min(rp - R1, R2 - rp), r * abs(sin(a - s8 * (floor(a / s8) + 0.5))));
  } else {
    ac = s16 * (floor(a / s16) + 0.5); tl = 0.8 * cr;
    eg = min(rp - R2, r * abs(sin(a - s16 * round(a / s16))));
  }
  let n = normalize(vec3f(cos(ac) * tl + p.x * 0.2, sin(ac) * tl + p.y * 0.2 + 0.08, 1.0));
  var c = chrome(n, vec3f(0.97, 0.74, 0.65), spin) * 1.1 + vec3f(0.08, 0.05, 0.04);
  c += vec3f(1.0, 0.85, 0.78) * smoothstep(0.004, 0.0, eg) * 0.35;
  c *= 0.85 + 0.15 * smoothstep(0.0, 0.006, eg);
  let m = smoothstep(R, R - px() * 1.5, r * cos(a - s16 * round(a / s16)));
  let bg = u.ink.rgb + vec3f(0.12, 0.07, 0.06) * exp(-r * 4.0);
  return present(mix(bg, c, m));`],
  ['gunmetal', 'alloys', 'dark gunmetal with knife-edge creases catching thin white lines', ['scale', 'crease', 'flow', ''],
   N => `  let sc = mix(1.5, 3.2, k.x); let tt = t * mix(0.3, 1.2, k.z);
${N(q => `hCrease(${q}, tt, sc, mix(1.0, 2.2, k.y))`, '0.8')}
  var c = chrome(n, vec3f(0.33, 0.35, 0.40), 0.4);
  let h = normalize(normalize(KEY) + VIEW);
  c += mix(u.tone.rgb, u.cream.rgb, 0.6) * pow(max(dot(n, h), 0.0), 60.0) * 0.5;
  c *= 1.1;
  return present(c);`,
   `// sum of ridged octaves; the ridge (1 - |n|)^3 makes sharp knife creases
fn hCrease(p: vec2f, t: f32, sc: f32, sharp: f32) -> f32 {
    var q = p * sc + 0.4 * vec2f(fbm(p * sc * 0.7 + vec2f(0.0, 0.06 * t), 2, 141u), fbm(p * sc * 0.7 + vec2f(5.0, -0.05 * t), 2, 142u));
    var h = 0.0; var a = 1.0;
    for (var i: i32 = 0; i < 3; i++) {
        let r = 1.0 - abs(gnoise(q, 143u + u32(i)));
        h += a * pow(r, 2.0 + sharp);
        a *= 0.45; q = rot2(0.9) * q * 2.1;
    }
    return 0.03 * h / sc;
}`],

  ['damascus', 'alloys', 'pattern-welded steel: etched nickel and carbon layers folded into a ladder', ['layers', 'drops', 'flow', ''],
   N => `  let L = mix(14.0, 30.0, k.x); let dr = mix(0.0, 2.2, k.y); let tt = t * mix(0.1, 0.5, k.z);
  let e = px();
  let f0 = dmF(p, L, dr, tt);
  let fx = dmF(p + vec2f(e, 0.0), L, dr, tt);
  let fy = dmF(p + vec2f(0.0, e), L, dr, tt);
  let g = vec2f(fx - f0, fy - f0) / e;
  let gl = max(length(g), 1e-3);
  let ph = fract(f0);
  let aa = gl * px() * 1.5;
  let bright = smoothstep(0.35 - aa, 0.35 + aa, ph) * smoothstep(0.95 + aa, 0.95 - aa, ph);
  let ridge = sin(ph * TAU);
  let n = normalize(vec3f(-g / gl * ridge * 0.22, 1.0) + vec3f(p * 0.5, 0.0));
  let nickel = chrome(n, vec3f(0.86, 0.85, 0.82), 0.25);
  let carbon = chrome(n, vec3f(0.16, 0.16, 0.18), 0.25) * (0.7 + 0.3 * fbm(p * 60.0, 2, 151u));
  return present(mix(carbon, nickel, bright));`,
   `// layer phase: stacked along y, folded by a ladder of sine bumps, pushed
// round by raindrop dimples and warped by fbm, as a forged billet would be
fn dmF(p: vec2f, L: f32, dr: f32, t: f32) -> f32 {
    let w = vec2f(fbm(p * 2.2 + vec2f(t, 0.0), 3, 152u), fbm(p * 2.2 + vec2f(3.3, 1.1 - t), 3, 153u));
    let q = p + 0.08 * w;
    let ladder = 0.5 * sin(q.x * 22.0) * smoothstep(0.2, 0.9, sin(q.x * 3.0 + 1.0));
    let f1 = vorF1(q * 5.0, 154u);
    let drop = dr * exp(-f1 * f1 * 9.0);
    return q.y * L + ladder * 3.0 + drop * 3.0 + 1.5 * fbm(q * 4.0, 3, 155u);
}`],
];
