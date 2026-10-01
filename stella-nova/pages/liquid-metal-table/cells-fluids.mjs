// ============================================================================
//  LIQUID METAL TABLE  ·  cells-fluids.mjs — the fluids family
// ────────────────────────────────────────────────────────────────────────────
//  Moving liquid metal. Two cells look at a horizontal plane in perspective:
//  a ray through pixel (x, y) with the horizon at y = hz meets the plane at
//  depth z = H / (hz - y), so the plane coordinate is (x z, z). The normal
//  comes from a finite difference in that plane, sized to the pixel
//  footprint z z px / H so far waves fade instead of aliasing. The others
//  are top-down height fields with the mercury_pool horizon tilt.
//
//  GREP MAP
//    chrome_sea ..... fn seaH (Gerstner)  ·  mercury_rain .. fn hRain
//    ferro_magnet ... fn hMag             ·  pour_stream ... fn hPour
//    molten_river ... Worley crust        ·  splash_crown .. fn hCrown
// ============================================================================
export const FLUIDS = [
  ['chrome_sea', 'fluids', 'a Gerstner sea of chrome rolling toward the eye under the studio sky', ['chop', 'swell', 'turn', ''],
   N => `  let hz = 0.24; let H = 0.5;
  let Q = mix(0.2, 1.0, k.x); let A = mix(0.9, 2.0, k.y);
  let spin = 1.0 + 0.5 * sin(t * mix(0.05, 0.3, k.z));
  let dy = max(hz - p.y, 0.003);
  let z = H / dy;
  let w = vec2f(p.x * z, z);
  let fw = z * z * px() / H;
  let e = max(fw, 0.003);
  let h0 = seaH(w, t, Q, A, fw);
  let hx = seaH(w + vec2f(e, 0.0), t, Q, A, fw);
  let hzz = seaH(w + vec2f(0.0, e), t, Q, A, fw);
  let n = normalize(vec3f(-(hx - h0) / e, 1.0, (hzz - h0) / e));
  let d = normalize(vec3f(p.x, p.y - hz, -1.0));
  let r = reflect(d, n);
  var sea = env(r, spin) * fres(metalF0(), dot(-d, n)) * mix(vec3f(1.0), u.tone.rgb, 0.25);
  let hh = normalize(normalize(vec3f(0.3, 0.25, -1.0)) - d);
  sea += u.cream.rgb * pow(max(dot(n, hh), 0.0), 400.0) * 3.0;
  let fog = 1.0 - exp(-z * 0.08);
  let horizon = env(vec3f(d.x, 0.02, -1.0), spin);
  sea = mix(sea, horizon * 0.8, fog);
  let sky = env(normalize(vec3f(p.x, p.y - hz, -1.0)), spin) * 0.8;
  let m = smoothstep(hz + px(), hz - px(), p.y);
  return present(mix(sky, sea, m));`,
   `// Gerstner sea: move the sample back by the trochoid displacement once,
// then sum the wave heights there, so crests come out sharp and troughs flat.
// fp is the pixel footprint in plane units; waves shorter than it fade out.
fn seaH(w: vec2f, t: f32, Q: f32, A: f32, fp: f32) -> f32 {
    var disp = vec2f(0.0);
    for (var i: i32 = 0; i < 6; i++) {
        let fi = f32(i);
        let L = 2.6 * pow(0.62, fi);
        let a = 0.9 * sin(fi * 2.4 + 0.5);
        let dv = vec2f(sin(a), cos(a));
        let kk0 = TAU / L;
        let ph = dot(dv, w) * kk0 + sqrt(9.8 * kk0) * t * 0.35 + fi * 1.3;
        let amp = A * 0.045 * L * smoothstep(L * 0.6, L * 0.15, fp);
        disp += dv * Q * amp * cos(ph);
    }
    let x = w - disp;
    var h = 0.0;
    for (var i: i32 = 0; i < 6; i++) {
        let fi = f32(i);
        let L = 2.6 * pow(0.62, fi);
        let a = 0.9 * sin(fi * 2.4 + 0.5);
        let dv = vec2f(sin(a), cos(a));
        let kk0 = TAU / L;
        let ph = dot(dv, x) * kk0 + sqrt(9.8 * kk0) * t * 0.35 + fi * 1.3;
        h += A * 0.045 * L * smoothstep(L * 0.6, L * 0.15, fp) * sin(ph);
    }
    return h;
}`],

  ['mercury_rain', 'fluids', 'rain on mercury: each cell of a hashed grid drops its own ring', ['drops', 'rate', 'ripple', ''],
   N => `  let dens = mix(4.0, 9.0, k.x); let rate = mix(0.3, 1.0, k.y); let amp = mix(0.5, 1.4, k.z);
${N(q => `hRain(${q}, t, dens, rate, amp)`, '1.0')}
  let nb = normalize(n + vec3f(0.0, 0.45 * p.y + 0.15, 0.0));
  var c = chrome(nb, metalF0(), 0.35);
  c *= 0.9 + 0.1 * smoothstep(-0.5, 0.5, p.y);
  return present(c);`,
   `// each grid cell owns one drop per cycle at a hashed spot; the ring grows to
// one cell radius and fades, so the 3 x 3 cell window holds every ring
fn hRain(p: vec2f, t: f32, dens: f32, rate: f32, amp: f32) -> f32 {
    let g = p * dens; let ip = floor(g);
    var h = 0.004 * fbm(p * 3.0 + vec2f(0.03 * t, 0.0), 2, 171u);
    for (var y: i32 = -1; y <= 1; y++) { for (var x: i32 = -1; x <= 1; x++) {
        let c = ip + vec2f(f32(x), f32(y));
        let r = rnd2(vec2i(c), 172u);
        let cyc = t * rate * (0.6 + 0.8 * r.x) + r.y * 7.0;
        let ph = fract(cyc);
        let cid = floor(cyc);
        let o = vec2f(rnd1(cid * 3.7 + r.x * 91.0), rnd1(cid * 5.3 + r.y * 57.0));
        let ctr = c + 0.15 + 0.7 * o;
        let d = length(g - ctr);
        let x0 = d - ph * 1.0;
        let fade = (1.0 - ph) * (1.0 - ph);
        h += amp * 0.012 / dens * sin(x0 * 28.0) * exp(-x0 * x0 * 40.0) * fade * smoothstep(1.0, 0.7, d);
        h += amp * 0.02 / dens * exp(-d * d * 300.0) * smoothstep(0.12, 0.0, ph);
    } }
    return h;
}`],

  ['ferro_magnet', 'fluids', 'a black ferrofluid film; spikes rise and lean toward a wandering magnet', ['spikes', 'reach', 'speed', ''],
   N => `  let dens = mix(9.0, 17.0, k.x); let reach = mix(5.0, 14.0, k.y);
  let tt = t * mix(0.2, 0.8, k.z);
  let m = vec2f(0.24 * sin(tt * 1.1), 0.2 * sin(tt * 0.7 + 1.0));
${N(q => `hMag(${q}, m, dens, reach)`, '1.0')}
  var c = chrome(n, vec3f(0.1), 0.3 * sin(t * 0.2) + 0.5);
  c *= 2.2;
  let dm = p - m;
  c += u.tone.rgb * 0.08 * exp(-dot(dm, dm) * 30.0);
  return present(c);`,
   `// a mound under the magnet, plus a hex field of cones whose tips lean toward
// it; cone height falls off with distance from the magnet
fn hMag(p: vec2f, m: vec2f, dens: f32, reach: f32) -> f32 {
    let dm = m - p;
    let r2 = dot(dm, dm);
    let mound = exp(-r2 * reach);
    let lean = dm * 0.5 * mound;
    let d = hexNear((p + lean) * dens);
    let cone = pow(max(1.0 - d * 1.9, 0.0), 1.4);
    let grow = smoothstep(0.08, 0.7, mound);
    return mound * 0.06 + cone * grow * 0.11 * (0.3 + 0.7 * mound) / (dens * 0.08) + 0.003 * gnoise(p * 5.0, 181u);
}`],

  ['pour_stream', 'fluids', 'a necking stream of liquid metal pours into a ringing pool', ['flow', 'neck', 'turn', ''],
   N => `  let tt = t * mix(0.5, 1.6, k.x);
  let py = -0.2;
  let cx = 0.025 * sin(p.y * 7.0 + tt * 1.3) * smoothstep(-0.3, 0.5, p.y);
  let neck = mix(0.0, 0.35, k.y);
  let w = (0.04 + 0.03 * smoothstep(0.0, py, p.y)) * (1.0 + neck * sin(p.y * 38.0 + tt * 9.0));
  let s0 = (p.x - cx) / w;
  let fl = 0.1 * gnoise(vec2f(s0 * 2.0, p.y * 14.0 + tt * 5.0), 191u);
  let spin = mix(-0.5, 0.5, k.z);
  let stream = tubeShade(s0 + fl, vec2f(1.0, 0.0), metalF0(), spin);
${N(q => `hPour(${q}, tt, py)`, '1.0')}
  let nb = normalize(n + vec3f(0.0, 1.2 * (p.y - py) + 0.35, 0.0));
  var pool = chrome(nb, metalF0(), spin);
  let below = smoothstep(py + 0.012, py - 0.006, p.y + 0.012 * sin(p.x * 30.0 + tt * 4.0) * exp(-p.x * p.x * 30.0));
  let bg = u.ink.rgb + u.tone.rgb * 0.08 * smoothstep(-0.2, 0.5, p.y) * (1.0 - abs(p.x));
  var c = mix(bg, pool, below);
  let sm = bandMask(s0 + fl, 2.0 * px() / w) * smoothstep(py - 0.03, py + 0.01, p.y);
  c = mix(c, stream, sm);
  return present(c);`,
   `// the pool: rings run out from the impact point, squashed in y for the
// low view angle, over a slow fbm swell
fn hPour(p: vec2f, t: f32, py: f32) -> f32 {
    let q = vec2f(p.x, (p.y - py) * 3.2);
    let r = length(q);
    let ring = sin(r * 70.0 - t * 9.0) * exp(-r * 4.0) * 0.004;
    let crown = 0.01 * exp(-pow((r - 0.07) * 40.0, 2.0)) * (0.7 + 0.3 * sin(t * 6.0));
    return ring + crown + 0.004 * fbm(q * 3.0 + vec2f(0.0, 0.1 * t), 3, 192u);
}`],

  ['molten_river', 'fluids', 'a river of molten metal; crust plates drift and wrinkle over glowing seams', ['plates', 'heat', 'flow', ''],
   N => `  let tt = t * mix(0.03, 0.12, k.z);
  let sc = mix(4.0, 8.0, k.x);
  let bank = 0.3 + 0.05 * sin(p.x * 4.0 + 1.0);
  let inR = smoothstep(bank, bank - 0.04, abs(p.y + 0.04 * sin(p.x * 3.0)));
  let flow = vec2f(p.x - tt * (1.0 + 2.0 * inR), p.y);
  let wp = flow + 0.03 * vec2f(fbm(flow * 5.0, 3, 201u), fbm(flow * 5.0 + 3.0, 3, 202u));
  let v = voronoi(wp * sc, 0.0, 0.9, 203u);
  let heat = mix(0.5, 1.3, k.y) * (0.55 + 0.45 * smoothstep(0.4, -0.5, p.x)) * inR;
  let gap = 0.008 + 0.07 * heat * heat * heat;
  let crust = smoothstep(gap, gap + 0.03 + 1.5 * px() * sc, v.edge);
  let x = v.f1 / max(v.f1 + v.edge, 1e-3);
  let wr = sin(dot(v.rel, vec2f(1.0, 0.3)) * 70.0 + v.id.x * 20.0) * 0.25;
  let n = normalize(vec3f(-v.rel / max(v.f1, 1e-4) * pow(x, 2.0) * 1.4 + vec2f(wr, 0.0), 1.0));
  var cr = chrome(n, vec3f(0.3, 0.28, 0.27), 0.3) * (0.7 + 0.3 * fbm(p * 30.0, 2, 204u));
  cr += glowRamp(heat * 0.7) * exp(-(v.edge - gap) / 0.035) * 0.35;
  cr += vec3f(0.5, 0.1, 0.02) * heat * 0.08;
  let T = heat * (0.85 + 0.25 * gnoise(wp * 9.0 + vec2f(0.0, t * 0.3), 205u));
  let melt = glowRamp(T * mix(0.55, 1.05, smoothstep(gap, 0.0, v.edge)));
  var c = mix(melt, cr, crust);
  let shore = vec3f(0.035, 0.03, 0.03) * (0.5 + 0.5 * fbm(p * 12.0, 3, 206u)) + glowRamp(0.6) * 0.15 * exp(-abs(abs(p.y) - bank) * 30.0);
  c = mix(shore, c, inR);
  return present(c);`],

  ['splash_crown', 'fluids', 'a drop strikes chrome: a crown of droplets throws out and settles', ['lobes', 'rate', 'turn', ''],
   N => `  let nl = floor(mix(10.0, 20.0, k.x));
  let ph = fract(t * mix(0.12, 0.4, k.y));
${N(q => `hCrown(${q}, ph, nl)`, '1.0')}
  let nb = normalize(n + vec3f(0.0, 0.4 * p.y + 0.1, 0.0));
  var c = chrome(nb, metalF0(), mix(-0.6, 0.6, k.z));
  return present(c);`,
   `// top-down crown: a wall at radius R (ph), a crater inside, rings outside, a
// droplet at each of nl lobes (angle folded to one sector) and a late jet
fn hCrown(p: vec2f, ph: f32, nl: f32) -> f32 {
    let r = length(p) + 1e-4; let a = atan2(p.y, p.x);
    let R = 0.04 + 0.26 * sqrt(ph);
    let life = 1.0 - ph;
    let lob = 1.0 + 0.4 * cos(nl * a);
    var h = 0.05 * life * exp(-pow((r - R) / (0.016 + 0.01 * ph), 2.0)) * lob;
    h -= 0.03 * life * smoothstep(R, 0.0, r);
    h += 0.004 * sin((r - R) * 90.0) * exp(-max(r - R, 0.0) * 12.0) * step(R, r) * life;
    let sec = TAU / nl;
    let af = a - (floor(a / sec) + 0.5) * sec;
    let dr = R + 0.025 + 0.05 * ph;
    let q = vec2f(r * cos(af) - dr, r * sin(af));
    let rd = 0.016 * (1.0 - ph * 0.6) * smoothstep(0.0, 0.08, ph);
    h += 0.6 * sqrt(max(rd * rd - dot(q, q), 0.0));
    let jet = smoothstep(0.35, 0.6, ph) * smoothstep(1.0, 0.8, ph);
    let jr = 0.035 * jet;
    h += 0.8 * sqrt(max(jr * jr - r * r, 0.0));
    return h + 0.002 * fbm(p * 4.0, 2, 211u);
}`],
];
