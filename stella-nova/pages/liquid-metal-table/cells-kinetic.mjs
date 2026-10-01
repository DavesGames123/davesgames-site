// ============================================================================
//  LIQUID METAL TABLE  ·  cells-kinetic.mjs — the kinetic family
// ────────────────────────────────────────────────────────────────────────────
//  Metal objects in motion. Each cell moves rigid parts with t (slats turn,
//  pins push out, balls swing or roll, a record spins) and shades them with
//  the same studio. Lattice cells test the 3 x 3 neighbor slots so that a
//  part that moves out of its slot still draws.
//
//  GREP MAP
//    chrome_curtain .. fn hCurtain           ·  pin_art ......... pushed pin heads, 3 x 3 slots
//    venetian_blinds . turning slats, window ·  vinyl_record .... grooves, gaps, label, bowtie
//    mirror_pond ..... fn pondH, fn pondSky  ·  bearing_field ... rolling balls on a plate
//    newton_cradle ... fn cradle (mirrored in the base)
// ============================================================================
export const KINETIC = [
  ['chrome_curtain', 'kinetic', 'a mirror curtain on a rod; gusts roll through its folds', ['folds', 'gust', 'speed', ''],
   N => `  let f = mix(14.0, 30.0, k.x); let gu = mix(0.4, 1.6, k.y); let tt = t * mix(0.4, 1.4, k.z);
  let top = 0.4;
${N(q => `hCurtain(${q}, tt, f, gu, top)`, '1.0')}
  var c = chrome(n, metalF0(), 0.25 * sin(tt * 0.3));
  c *= 0.55 + 0.45 * smoothstep(-0.1, 0.4, n.z);
  let hang = smoothstep(top + 0.005, top - 0.005, p.y);
  let bg = u.ink.rgb + u.tone.rgb * 0.05;
  c = mix(bg, c, hang);
  let rs = (p.y - (top + 0.02)) / 0.016;
  c = mix(c, tubeShade(rs, vec2f(0.0, 1.0), vec3f(1.0, 0.78, 0.45), 0.0), bandMask(rs, 2.0 * px() / 0.016));
  return present(c);`,
   `// folds grow from the rod down; a gust is a phase wave running along x that
// swings the lower hem more than the top
fn hCurtain(p: vec2f, t: f32, f: f32, gu: f32, top: f32) -> f32 {
    let dn = max(top - p.y, 0.0);
    let a = p.x * f + gu * 1.8 * sin(t * 0.9 + p.x * 2.0 - p.y * 2.5) * dn + 0.6 * fbm(p * 2.0 + vec2f(0.1 * t, 0.0), 3, 381u);
    let amp = (0.3 + 1.5 * dn) / f;
    return amp * (sin(a) + 0.25 * sin(2.0 * a + 0.7)) + gu * 0.05 * sin(p.x * 3.0 - t * 1.2) * dn * dn;
}`],

  ['pin_art', 'kinetic', 'a pin-art wall: chrome pin heads pushed out by shapes passing behind', ['pins', 'push', 'speed', ''],
   N => `  let sc = mix(9.0, 17.0, k.x); let pu = mix(0.6, 1.4, k.y); let tt = t * mix(0.3, 1.0, k.z);
  let c1 = vec2f(0.22 * sin(tt * 0.7), 0.18 * cos(tt * 0.5));
  let c2 = vec2f(0.25 * cos(tt * 0.43 + 2.0), 0.22 * sin(tt * 0.61 + 1.0));
  let ip = floor(p * sc);
  var bh = -1.0; var bd = vec2f(9.0); var br = 1.0; var near = 9.0;
  for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) {
    let cc = (ip + vec2f(f32(x), f32(y)) + 0.5) / sc;
    let e1 = cc - c1; let e2 = cc - c2;
    let ring = abs(length(e2) - 0.12);
    let h = clamp(pu * max(exp(-dot(e1, e1) / 0.018), 0.85 * exp(-ring * ring / 0.0012)), 0.0, 1.0);
    let pos = cc + cc * h * 0.1;
    let rad = 0.42 / sc * (1.0 + 0.35 * h);
    let d = p - pos;
    near = min(near, length(p - cc));
    if (dot(d, d) < rad * rad && h > bh) { bh = h; bd = d; br = rad; }
  }}
  let hit = bh >= 0.0;
  let n = ballN(bd, br);
  var head = chrome(n, metalF0(), 0.3 * sin(t * 0.2)) * (0.35 + 0.9 * bh);
  head *= 0.6 + 0.4 * n.z;
  let edge = smoothstep(br, br - 1.5 * px(), length(bd));
  let plate = (u.ink.rgb + u.tone.rgb * 0.05) * (0.6 + 0.4 * smoothstep(0.0, 0.25 / sc, near));
  return present(select(plate, mix(plate, head, edge), hit));`],

  ['venetian_blinds', 'kinetic', 'chrome blinds turning in unison; a sunset city glows between slats', ['slats', 'open', 'speed', ''],
   N => `  let ns = floor(mix(6.0, 12.0, k.x));
  let th = mix(0.7, 1.5, k.y) * (0.75 + 0.25 * sin(t * mix(0.2, 0.8, k.z)));
  let ct = cos(th); let stn = sin(th);
  let gy = p.y * ns; let id = floor(gy); let ly = fract(gy) - 0.5;
  let hw = min(0.56 * ct, 0.5);
  let s = ly / hw;
  var sky = mix(vec3f(0.95, 0.45, 0.2), vec3f(0.25, 0.2, 0.45), smoothstep(-0.2, 0.5, p.y));
  let sd = p - vec2f(0.18, -0.05);
  sky += vec3f(1.0, 0.85, 0.6) * (smoothstep(0.07, 0.06, length(sd)) * 1.5 + 0.4 * exp(-dot(sd, sd) * 12.0));
  let bx = floor(p.x * 14.0);
  let bh = -0.2 + 0.22 * rnd1(bx * 3.3) + 0.08 * rnd1(bx * 7.1);
  let bld = step(p.y, bh);
  let win = step(0.82, rnd2(vec2i(floor(p * vec2f(56.0, 40.0))), 391u).x) * step(0.35, fract(p.x * 56.0)) * step(0.35, fract(p.y * 40.0));
  sky = mix(sky, vec3f(0.03, 0.025, 0.05) + vec3f(1.0, 0.8, 0.45) * win * 0.35, bld);
  let n = normalize(vec3f(0.0, stn * 0.6 + s * 0.6, ct));
  let win2 = mix(vec3f(1.0, 0.6, 0.3), sky, 0.5);
  var slat = chrome(n, vec3f(0.9, 0.91, 0.93), 0.0) * 0.6;
  slat += win2 * 0.55 * smoothstep(0.0, 1.0, stn) * smoothstep(-0.2, 1.0, s);
  slat += vec3f(1.0, 0.75, 0.5) * 0.5 * smoothstep(0.75, 1.0, s) * (0.3 + 0.7 * stn);
  slat *= 0.6 + 0.4 * smoothstep(-1.0, -0.3, s);
  let m = bandMask(s, 2.0 * px() * ns / hw);
  var c = mix(sky * (0.5 + 0.5 * stn), slat, m);
  let cord = smoothstep(0.004, 0.002, abs(abs(p.x) - 0.3));
  c = mix(c, vec3f(0.6, 0.58, 0.55) * (0.4 + 0.6 * m), cord * 0.9);
  return present(c);`],

  ['vinyl_record', 'kinetic', 'a spinning record: track gaps, a turning label and a white bowtie glint', ['tracks', 'glint', 'speed', ''],
   N => `  let r = length(p) + 1e-4; let a = atan2(p.y, p.x); let R = 0.46;
  let w = t * mix(0.5, 3.0, k.z);
  let aa = a + w;
  let ntr = floor(mix(3.0, 7.0, k.x));
  let tx = (r - 0.17) / (R - 0.02 - 0.17) * ntr;
  let gap = smoothstep(0.06, 0.02, abs(fract(tx) - 0.5) - 0.44) * step(0.17, r) * step(r, R - 0.02);
  let g = gnoise(vec2f(r * 1800.0, aa * 3.0), 401u) * 0.5 + gnoise(vec2f(r * 600.0, aa * 8.0), 402u) * 0.5;
  let la = 0.6 + 0.04 * sin(aa);
  let lobe = pow(abs(cos(a - la)), mix(200.0, 20.0, k.y));
  let n = normalize(vec3f(p * 0.3, 1.0));
  var c = u.ink.rgb * 0.3 + env(reflect(-VIEW, n), 0.0) * fres(vec3f(0.04), n.z) * 0.6;
  c += mix(u.tone.rgb, u.cream.rgb, 0.8) * lobe * (0.25 + 0.9 * r / R) * mix(0.5 + 0.5 * g, 1.3, gap);
  c *= mix(0.85 + 0.15 * g, 1.0, gap);
  let lab = smoothstep(0.15, 0.15 - px(), r);
  let lr = vec2f(cos(aa), sin(aa));
  let text = step(0.55, fract(aa * 40.0 / TAU)) * smoothstep(0.004, 0.0, abs(r - 0.125) - 0.008);
  let logo = smoothstep(0.03, 0.028, length(r * lr - vec2f(0.0, 0.07)));
  var lc = mix(vec3f(0.72, 0.1, 0.08), vec3f(0.95, 0.85, 0.65), max(text, logo * step(0.0, sin(aa * 1.0))));
  lc *= 0.7 + 0.3 * smoothstep(0.15, 0.0, r);
  c = mix(c, lc, lab);
  c = mix(c, chrome(ballN(p, 0.012), metalF0(), 0.0), smoothstep(0.012, 0.010, r));
  let edge = smoothstep(R, R - px(), r);
  let mat = u.ink.rgb + u.tone.rgb * 0.04 * (1.0 - r);
  return present(mix(mat, c, edge));`],

  ['mirror_pond', 'kinetic', 'a still mirror pond at night: drops ring out, a treeline and moon reflect', ['drops', 'rate', 'moon', ''],
   N => `  let hz = 0.06; let H = 0.35;
  let moonP = vec2f(mix(-0.3, 0.3, k.z), 0.24);
  let d = normalize(vec3f(p.x, p.y - hz, -1.0));
  let dy = max(hz - p.y, 0.003);
  let z = H / dy;
  let w = vec2f(p.x * z, z);
  let fw = z * z * px() / H;
  let e = max(fw, 0.002);
  let nd = i32(mix(3.0, 8.0, k.x)); let rate = mix(0.15, 0.5, k.y);
  let h0 = pondH(w, t, nd, rate, fw);
  let hx = pondH(w + vec2f(e, 0.0), t, nd, rate, fw);
  let hzz = pondH(w + vec2f(0.0, e), t, nd, rate, fw);
  let n = normalize(vec3f(-(hx - h0) / e, 1.0, (hzz - h0) / e));
  let r = reflect(d, n);
  var pond = pondSky(r, moonP) * fres(vec3f(0.55), dot(-d, n));
  pond = mix(pond, pondSky(vec3f(d.x, 0.004, -1.0), moonP) * 0.5, 1.0 - exp(-z * 0.04));
  let sky = pondSky(d, moonP);
  let m = smoothstep(hz + px(), hz - px(), p.y);
  return present(mix(sky, pond, m));`,
   `// night sky over the pond: the studio darkened, a moon disc and glow, and a
// treeline silhouette read by azimuth x / -z and elevation y / -z
fn pondSky(d0: vec3f, moonP: vec2f) -> vec3f {
    let d = normalize(d0);
    let iz = 1.0 / max(-d.z, 0.05);
    let sp = vec2f(d.x * iz, d.y * iz);
    var c = mix(u.tone.rgb * 0.22 + u.cream.rgb * 0.05, u.ink.rgb * 0.8 + u.tone.rgb * 0.03, smoothstep(0.0, 0.5, sp.y));
    let sg = sp * 90.0;
    let st = rnd2(vec2i(floor(sg)), 413u);
    c += u.cream.rgb * step(0.985, st.x) * smoothstep(0.25, 0.0, length(fract(sg) - 0.5)) * smoothstep(0.05, 0.2, sp.y) * 1.5;
    let md = length(sp - moonP);
    c += u.cream.rgb * (smoothstep(0.045, 0.04, md) * 2.0 + 0.25 * exp(-md * 9.0));
    let tree = 0.02 + 0.035 * fbm(vec2f(sp.x * 6.0, 0.0), 3, 411u) + 0.03 * abs(gnoise(vec2f(sp.x * 40.0, 0.0), 412u)) + 0.04 * smoothstep(0.15, 0.4, abs(sp.x + 0.1));
    c = mix(c, u.ink.rgb * 0.6, smoothstep(tree + 0.003, tree - 0.003, sp.y) * step(0.0, sp.y));
    return c;
}
// drop rings on the pond plane, each drop on its own cycle and spot
fn pondH(w: vec2f, t: f32, nd: i32, rate: f32, fw: f32) -> f32 {
    var h = 0.0015 * sin(w.x * 3.0 + w.y * 2.0 + t * 0.4) * smoothstep(0.5, 0.05, fw);
    for (var i: i32 = 0; i < 8; i++) {
        if (i >= nd) { break; }
        let fi = f32(i);
        let cyc = t * rate + fi * 0.37;
        let ph = fract(cyc); let id = floor(cyc);
        let c = vec2f((rnd1(id * 3.1 + fi * 1.7) - 0.5) * 3.0, 1.0 + 6.0 * rnd1(id * 5.9 + fi * 2.3));
        let x = length(w - c) - ph * 1.6;
        h += 0.02 * sin(x * 30.0) * exp(-x * x * 25.0) * (1.0 - ph) * (1.0 - ph) * smoothstep(0.25, 0.03, fw);
    }
    return h;
}`],

  ['bearing_field', 'kinetic', 'a tray of chrome ball bearings rolling on a travelling wave', ['balls', 'wave', 'speed', ''],
   N => `  let sc = mix(5.0, 10.0, k.x); let wa = mix(0.05, 0.25, k.y); let tt = t * mix(0.4, 1.6, k.z);
  let g = p * sc;
  let r0 = round(g.y / 0.866);
  var bd = 9.0; var bq = vec2f(0.0); var bph = 0.0; var shade = 0.0;
  for (var dj: i32 = -1; dj <= 1; dj++) {
    let row = r0 + f32(dj);
    let off = 0.5 * (row - 2.0 * floor(row * 0.5));
    let i0 = round(g.x - off);
    for (var di: i32 = -1; di <= 1; di++) {
      let c0 = vec2f(i0 + f32(di) + off, row * 0.866);
      let ph = dot(c0 / sc, vec2f(5.0, 3.0)) - tt * 2.0;
      let c = c0 + wa * vec2f(cos(ph), 0.5 * sin(ph)) * 2.0;
      let q = g - c;
      let dd = dot(q, q);
      shade += exp(-dd * 6.0);
      if (dd < bd) { bd = dd; bq = q; bph = ph; }
    }
  }
  let rad = 0.45;
  let n = ballN(bq, rad);
  var ball = chrome(n, metalF0(), 0.2 * sin(t * 0.2));
  ball *= 0.55 + 0.45 * n.z;
  let m = smoothstep(rad, rad - 1.5 * px() * sc, sqrt(bd));
  let gr = gnoise(vec2f(p.x * 5.0, p.y * 400.0), 421u);
  var plate = (u.ink.rgb + u.tone.rgb * 0.12 * (0.8 + 0.2 * gr)) * (1.0 - 0.55 * clamp(shade - 0.25, 0.0, 1.0));
  return present(mix(plate, ball, m));`],

  ['newton_cradle', 'kinetic', "a Newton's cradle swinging over its own mirror base", ['swing', 'balls', 'speed', ''],
   N => `  let A = mix(0.2, 0.45, k.x); let nb = i32(mix(4.0, 6.0, k.y)); let ph = t * mix(1.6, 3.6, k.z);
  let by = -0.36;
  let top = cradle(p, A, nb, ph);
  let mp = vec2f(p.x, 2.0 * by - p.y);
  let refl = cradle(mp, A, nb, ph);
  let bn = normalize(vec3f(0.0, 0.5, 1.0));
  var base = chrome(bn, vec3f(0.12), 0.0) * 0.5 + refl.rgb * refl.a * 0.45;
  base *= smoothstep(-0.5, by, p.y);
  let bg = u.ink.rgb + u.tone.rgb * 0.07 * smoothstep(-0.3, 0.5, p.y);
  var c = select(bg, base, p.y < by);
  c = mix(c, top.rgb, top.a);
  let lip = smoothstep(0.004, 0.0, abs(p.y - by));
  c += u.cream.rgb * lip * 0.4;
  return present(c);`,
   `// the cradle frame and balls: rgb color and a coverage mask. Only the end
// balls swing; one lifts on each half of the period.
fn cradle(p: vec2f, A: f32, nb: i32, ph: f32) -> vec4f {
    let py = 0.36; let L = 0.46; let rb = 0.07;
    var col = vec3f(0.0); var m = 0.0;
    let bar = (p.y - py) / 0.012;
    let fx = abs(p.x) < 0.46;
    if (abs(bar) < 1.0 && fx) { col = tubeShade(bar, vec2f(0.0, 1.0), metalF0(), 0.0); m = bandMask(bar, 2.0 * px() / 0.012); }
    let post = (abs(p.x) - 0.46) / 0.012;
    if (abs(post) < 1.0 && p.y < py + 0.012 && p.y > -0.36) { col = tubeShade(post, vec2f(1.0, 0.0), metalF0(), 0.0); m = bandMask(post, 2.0 * px() / 0.012); }
    let nf = f32(nb);
    let s = sin(ph);
    for (var i: i32 = 0; i < 6; i++) {
        if (i >= nb) { break; }
        let fi = f32(i);
        var th = 0.0;
        if (i == 0) { th = -A * max(-s, 0.0); }
        if (i == nb - 1) { th = A * max(s, 0.0); }
        let x0 = (fi - 0.5 * (nf - 1.0)) * 2.0 * rb;
        let piv = vec2f(x0, py);
        let ctr = piv + L * vec2f(sin(th), -cos(th));
        let ab = ctr - piv;
        let hq = clamp(dot(p - piv, ab) / dot(ab, ab), 0.0, 1.0);
        let sd = length(p - piv - ab * hq);
        let sm = smoothstep(0.0022, 0.0008, sd) * step(p.y, py);
        col = mix(col, vec3f(0.55, 0.55, 0.58), sm * (1.0 - m)); m = max(m, sm);
        let q = p - ctr;
        let bm = smoothstep(rb, rb - 1.5 * px(), length(q));
        if (bm > 0.0) {
            let n = ballN(q, rb);
            col = mix(col, chrome(n, metalF0(), th) * (0.6 + 0.4 * n.z), bm); m = max(m, bm);
        }
    }
    return vec4f(col, m);
}`],
];
