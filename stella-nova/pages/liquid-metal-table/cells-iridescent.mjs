// ============================================================================
//  LIQUID METAL TABLE  ·  cells-iridescent.mjs — the iridescent family
// ────────────────────────────────────────────────────────────────────────────
//  Structural color. Three physical sources set every hue here: a thin film
//  (film, filmN: two-beam interference), a stack of many layers (bragg: a
//  narrow peak at 2 D cos = lam), and a ruled grating (grating: d (L+V).g =
//  m lam). None of them paint a hue from a palette, so each one shifts with
//  the surface angle the way the real material does.
//
//  GREP MAP
//    beetle_shell .. bragg on ellipsoid domes  ·  soap_film ...... drained film, two vortices
//    nacre ......... tablets and growth lines  ·  holo_foil ...... grating patches, moving lamp
//    oil_asphalt ... oil film on a rain puddle ·  bismuth ........ L-inf hopper terraces, fn bisCell
// ============================================================================
export const IRIDESCENT = [
  ['beetle_shell', 'iridescent', 'a jewel beetle: a Bragg stack goes green at the crown, violet at the rim', ['period', 'purity', 'turn', ''],
   N => `  let wob = 0.05 * sin(t * 0.4);
  let q0 = rot2(wob) * p;
  let D = mix(240.0, 300.0, k.x); let sh = mix(3.0, 12.0, k.y);
  let side = sign(q0.x + 1e-5);
  let eC = vec2f(side * 0.075, -0.07); let eR = vec2f(0.145, 0.31);
  let qe = (q0 - eC) / eR;
  let re = dot(qe, qe);
  let pC = vec2f(0.0, 0.27); let pR = vec2f(0.15, 0.085);
  let qp = (q0 - pC) / pR;
  let rp = dot(qp, qp);
  let hC = vec2f(0.0, 0.375); let hR = vec2f(0.07, 0.05);
  let qh = (q0 - hC) / hR;
  let rh = dot(qh, qh);
  var n = vec3f(0.0, 0.0, 1.0); var m = 0.0;
  let stri = sin((qe.x * 0.5 + 0.5) * 8.0 * PI) * 0.25;
  let pits = smoothstep(0.35, 0.0, length(fract(vec2f(qe.x * 5.0, qe.y * 28.0)) - 0.5));
  if (re < 1.2) { n = normalize(vec3f(qe.x / eR.x * 0.12 + stri * 0.5 * (1.0 - re), qe.y / eR.y * 0.12, sqrt(max(1.0 - re, 0.0)) * 1.2)); m = smoothstep(1.0, 1.0 - 3.0 * px() / eR.x, re); }
  if (rp < 1.0 && m < 0.5) { n = normalize(vec3f(qp / pR * 0.1, sqrt(max(1.0 - rp, 0.0)) * 0.9)); m = smoothstep(1.0, 1.0 - 3.0 * px() / pR.y, rp); }
  if (rh < 1.0 && m < 0.5) { n = normalize(vec3f(qh / hR * 0.08, sqrt(max(1.0 - rh, 0.0)))); m = smoothstep(1.0, 1.0 - 3.0 * px() / hR.y, rh); }
  let spin = 0.6 * sin(t * mix(0.1, 0.5, k.z));
  let e = env(reflect(-VIEW, n), spin);
  let lum = dot(e, vec3f(0.3, 0.5, 0.2));
  var c = bragg(D, n.z, sh) * (0.25 + 1.5 * lum);
  c *= 1.0 - 0.5 * pits * step(re, 1.0);
  c += e * fres(vec3f(0.04), n.z) * 0.6;
  c += u.cream.rgb * pow(max(dot(n, normalize(normalize(KEY) + VIEW)), 0.0), 160.0) * 1.2;
  let suture = smoothstep(0.004, 0.0, abs(q0.x)) * step(q0.y, 0.2);
  c *= 1.0 - 0.8 * suture;
  let leaf = u.ink.rgb + vec3f(0.02, 0.05, 0.03) * (0.6 + 0.4 * fbm(p * 5.0, 3, 321u)) * (1.0 - length(p));
  let lg = legs(vec2f(abs(q0.x), q0.y), t);
  let lc = bragg(D, 0.55 + 0.3 * lg.y, sh) * 0.5 + u.cream.rgb * 0.15 * lg.y;
  let bgc = mix(leaf * (1.0 - 0.5 * smoothstep(0.05, 0.0, lg.x - 0.01)), lc, smoothstep(px() * 1.5, -px(), lg.x));
  return present(mix(bgc, c, m));`,
   `fn segD(p: vec2f, a: vec2f, b: vec2f) -> vec2f {
    let ab = b - a; let h = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
    return vec2f(length(p - a - ab * h), h);
}
// three jointed legs and an antenna on one side (x mirrored by the caller);
// x = distance minus the limb radius, y = a 0..1 shade across the limb
fn legs(p: vec2f, t: f32) -> vec2f {
    var d = 9.0; var sh = 0.0;
    for (var i: i32 = 0; i < 3; i++) {
        let fi = f32(i);
        let y0 = 0.2 - fi * 0.13;
        let sw = 0.03 * sin(t * 2.0 + fi * 2.1);
        let a = vec2f(0.09, y0);
        let b = vec2f(0.25, y0 + 0.06 - fi * 0.07 + sw);
        let c = vec2f(0.31, y0 - 0.02 - fi * 0.11 + sw);
        let s1 = segD(p, a, b); let s2 = segD(p, b, c);
        let r1 = s1.x - 0.011; let r2 = s2.x - 0.007;
        if (r1 < d) { d = r1; sh = 1.0 - s1.x / 0.011; }
        if (r2 < d) { d = r2; sh = 1.0 - s2.x / 0.007; }
    }
    let an = segD(p, vec2f(0.03, 0.4), vec2f(0.1, 0.47 + 0.01 * sin(t)));
    let an2 = segD(p, vec2f(0.1, 0.47 + 0.01 * sin(t)), vec2f(0.12, 0.5));
    let ra = min(an.x, an2.x) - 0.004;
    if (ra < d) { d = ra; sh = 0.5; }
    return vec2f(d, clamp(sh, 0.0, 1.0));
}`],

  ['soap_film', 'iridescent', 'a flat soap film in a wire loop: drains black at the top, swirls below', ['swirl', 'thick', 'drain', ''],
   N => `  let R = 0.43;
  let r = length(p);
  let v1 = 0.16 * vec2f(sin(t * 0.31), cos(t * 0.23));
  let v2 = -0.18 * vec2f(cos(t * 0.27 + 1.0), sin(t * 0.19));
  let st = mix(1.0, 4.0, k.x);
  var q = p - v1; q = rot2(st * exp(-dot(q, q) * 18.0)) * q + v1;
  q = q - v2; q = rot2(-st * 0.8 * exp(-dot(q, q) * 14.0)) * q + v2;
  let turb = fbm(q * 3.0 + vec2f(0.0, 0.05 * t), 4, 331u);
  let drain = pow(clamp(0.5 - 0.5 * q.y / R, 0.0, 1.0), mix(0.5, 1.6, k.z));
  let d = mix(300.0, 1000.0, k.y) * drain + turb * 220.0 + 60.0 * sin(q.y * 40.0 + turb * 6.0);
  let fc = film(max(d, 0.0), 0.95);
  let band = 0.35 + 0.65 * smoothstep(0.3, -0.2, abs(p.x + 0.12 * p.y - 0.12));
  let black = smoothstep(40.0, 120.0, d);
  var c = u.ink.rgb * 0.8 + fc * (0.35 + 0.9 * band) * black;
  c += u.cream.rgb * 0.5 * smoothstep(0.03, 0.0, abs(p.x + 0.12 * p.y - 0.12)) * black * 0.4;
  let m = smoothstep(R, R - px(), r);
  let bg = u.ink.rgb + u.tone.rgb * 0.05 * (0.5 - p.y);
  c = mix(bg, c, m);
  let wire = tubeShade((r - R) / 0.012, p / max(r, 1e-4), metalF0(), 0.0);
  c = mix(c, wire, bandMask((r - R) / 0.012, 2.0 * px() / 0.012));
  return present(c);`],

  ['nacre', 'iridescent', 'abalone nacre: warped growth terraces in pastel interference on a pearl ground', ['bands', 'luster', 'shift', ''],
   N => `  let sc = mix(1.2, 2.6, k.x); let sh = t * mix(0.05, 0.3, k.z);
${N(q => `hNacre(${q}, sc)`, '1.0')}
  let B = nacreB(p, sc);
  let lines = 0.5 + 0.5 * sin(B * 70.0);
  let d = 330.0 + 230.0 * sin(B * 2.6 + sh) + 90.0 * fbm(p * 7.0, 3, 345u) + 25.0 * lines;
  let fc = film(d, n.z);
  let e = env(reflect(-VIEW, n), 0.2);
  let lum = dot(e, vec3f(0.3, 0.5, 0.2));
  let pearl = mix(u.cream.rgb, vec3f(0.9, 0.94, 1.0), 0.5) * 0.65;
  var c = mix(pearl, fc, mix(0.25, 0.6, k.y)) * (0.5 + 0.85 * lum);
  c *= 0.9 + 0.1 * lines;
  c += u.cream.rgb * pow(max(dot(n, normalize(normalize(KEY) + VIEW)), 0.0), 50.0) * 0.35;
  return present(c);`,
   `// growth phase: stripes along y pushed by two levels of warp, so the bands
// curl like the layers in an abalone shell
fn nacreB(p: vec2f, sc: f32) -> f32 {
    let q = p * sc;
    let w = vec2f(fbm(q, 3, 341u), fbm(q + vec2f(5.2, 1.3), 3, 342u));
    let w2 = vec2f(fbm(q + 1.8 * w + vec2f(1.7, 9.2), 3, 343u), fbm(q + 1.8 * w + vec2f(8.3, 2.8), 3, 344u));
    return dot(q + 2.2 * w2, vec2f(0.35, 1.0));
}
// terraces: each growth layer is a shallow step with a rounded lip
fn hNacre(p: vec2f, sc: f32) -> f32 {
    let B = nacreB(p, sc) * 4.0;
    let f = fract(B);
    return (floor(B) + smoothstep(0.75, 1.0, f)) * 0.0025 / sc;
}`],
  ['holo_foil', 'iridescent', 'holographic foil: grating patches throw spectra as the lamp circles', ['period', 'spread', 'lamp', ''],
   N => `  let v = voronoi(p * 3.2, 0.0, 0.9, 351u);
  let r = length(p) + 1e-4;
  let disc = smoothstep(0.17, 0.165, r);
  let ang = v.id.x * PI;
  var g = vec2f(cos(ang), sin(ang));
  g = normalize(mix(g, vec2f(-p.y, p.x) / r, disc));
  let lt = t * mix(0.15, 0.6, k.z);
  let lp = vec3f(0.55 * cos(lt), 0.55 * sin(lt) + 0.1, 0.9);
  let L = normalize(lp - vec3f(p, 0.0));
  let V = normalize(vec3f(-p * 0.7, 1.0));
  let hv = L + V;
  let dd = mix(900.0, 1800.0, k.x);
  let col = grating(hv, g, dd, mix(1.0, 0.15, k.y));
  let n = normalize(vec3f((v.id - 0.5) * 0.06, 1.0));
  var c = env(reflect(-VIEW, n), lt) * fres(vec3f(0.7), 1.0) * 0.3 + mix(u.tone.rgb, u.cream.rgb, 0.5) * 0.22;
  c += col * 1.4;
  let sp = rnd2(vec2i(floor(p * 90.0)), 352u);
  c += u.cream.rgb * step(0.985, sp.x) * pow(0.5 + 0.5 * sin(lt * 6.0 + sp.y * TAU), 8.0) * 1.2;
  let edge = smoothstep(0.0, 0.012, v.edge) * (1.0 - smoothstep(0.004, 0.0, abs(r - 0.17)));
  c *= 0.6 + 0.4 * edge;
  return present(c);`],

  ['oil_asphalt', 'iridescent', 'an oil sheen swirls on a rain puddle in wet asphalt under a street lamp', ['puddle', 'oil', 'rain', ''],
   N => `  let pc = (p - vec2f(0.02, -0.03)) * vec2f(1.0, 1.25);
  let pr = length(pc) + 0.12 * fbm(p * 2.5, 3, 361u);
  let R = mix(0.3, 0.48, k.x);
  let pm = smoothstep(R, R - 0.02, pr);
  let wet = smoothstep(R + 0.12, R, pr);
  let st = vorF1(p * 30.0, 362u);
  let sid = rnd2(vec2i(floor(p * 30.0)), 363u).x;
  let stone = smoothstep(0.4, 0.18, st);
  let base = vec3f(0.045, 0.045, 0.05) * (0.7 + 0.5 * fbm(p * 60.0, 2, 364u));
  var asph = mix(base, vec3f(0.13, 0.125, 0.12) * (0.5 + sid), stone * 0.8);
  let sq = p * 30.0 - floor(p * 30.0) - 0.5;
  let sn = normalize(vec3f(-sq / (length(sq) + 1e-3) * stone * 0.6, 1.0));
  asph += env(reflect(-VIEW, sn), 0.0) * (0.06 + 0.14 * wet) * stone;
  asph *= 1.0 - 0.4 * wet;
${N(q => `hRain(${q}, t * mix(0.3, 1.0, k.z), 6.0, 0.5, 0.6)`, '1.0')}
  let nb = normalize(n + vec3f(0.0, 0.5 * p.y + 0.12, 0.0));
  let rf = reflect(-VIEW, nb);
  let e = env(rf, 0.2);
  let lum = dot(e, vec3f(0.3, 0.5, 0.2));
  let lp = p + nb.xy * 0.08 - vec2f(-0.1, 0.12);
  let lamp = vec3f(1.0, 0.8, 0.5) * (exp(-dot(lp, lp) * 300.0) * 1.6 + exp(-dot(lp, lp) * 25.0) * 0.25);
  let w2 = vec2f(fbm(p * 2.0 + vec2f(0.02 * t, 0.0), 3, 365u), fbm(p * 2.0 + vec2f(4.0, -0.015 * t), 3, 366u));
  let sw = fbm(p * 2.2 + 0.9 * w2, 4, 367u);
  let d = 250.0 + 1100.0 * (0.5 + 0.5 * sw);
  let oil = smoothstep(-0.25, 0.1, sw + mix(-0.25, 0.25, k.y)) * smoothstep(0.0, 0.6, pm);
  var water = e * 0.16 * mix(vec3f(1.0), u.tone.rgb, 0.4) + lamp;
  water += film(d, nb.z) * (0.12 + 1.1 * lum + 0.8 * dot(lamp, vec3f(0.33))) * oil;
  return present(mix(asph, water, pm));`],
  ['bismuth', 'iridescent', 'bismuth hopper crystals: square stair-steps in oxide gold, magenta and blue', ['crystals', 'steps', 'oxide', ''],
   N => `  let sc = mix(2.2, 4.5, k.x); let S = floor(mix(4.0, 9.0, k.y));
  let b = bisCell(p * sc);
  let dC = b.x;
  let inside = smoothstep(1.0, 1.0 - 2.0 * px() * sc, dC);
  let si = floor(dC * S); let fr = fract(dC * S);
  let bev = smoothstep(0.78, 1.0, fr);
  let ax = vec2f(b.z, b.w);
  let n = normalize(vec3f(ax * bev * 1.3 + ax * 0.04, 1.0));
  let shift = t * mix(0.05, 0.3, k.z);
  let d = 160.0 + 70.0 * si + 120.0 * b.y + 40.0 * sin(shift + si * 0.7);
  let fc = filmN(d, n.z, 1.9);
  let e = env(reflect(-VIEW, n), shift);
  let lum = dot(e, vec3f(0.3, 0.5, 0.2));
  var c = pow(fc, vec3f(1.6)) * 1.3 * (0.3 + 1.1 * lum) + e * 0.1;
  c *= 1.0 - 0.45 * bev;
  c += u.cream.rgb * smoothstep(0.96, 1.0, fr) * 0.35 * (0.5 + 0.5 * ax.x);
  let gap = vec3f(0.05, 0.05, 0.06) * (0.6 + 0.4 * fbm(p * 30.0, 2, 371u));
  return present(mix(gap, c, inside));`,
   `// L-inf Worley: each site is a square crystal of its own size and turn;
// x = scaled square distance, y = crystal hash, zw = outward axis of the face
fn bisCell(g: vec2f) -> vec4f {
    let ip = floor(g);
    var best = vec4f(9.0, 0.0, 1.0, 0.0);
    for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) {
        let c = ip + vec2f(f32(x), f32(y));
        let r = rnd2(vec2i(c), 372u);
        let ctr = c + 0.5 + 0.5 * (r - 0.5);
        let th = 0.35 * (r.x - 0.5) + select(0.0, 0.785, r.y > 0.7);
        let q = rot2(th) * (g - ctr);
        let size = 0.5 + 0.45 * r.y;
        let dd = max(abs(q.x), abs(q.y)) / size;
        if (dd < best.x) {
            let axl = select(vec2f(0.0, sign(q.y)), vec2f(sign(q.x), 0.0), abs(q.x) > abs(q.y));
            let axw = rot2(-th) * axl;
            best = vec4f(dd, rnd1(r.x * 91.0), axw.x, axw.y);
        }
    } }
    return best;
}`],
];
