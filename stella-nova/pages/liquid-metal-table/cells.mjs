// ============================================================================
//  LIQUID METAL TABLE  ·  cells.mjs — the cell list that build.mjs reads
// ────────────────────────────────────────────────────────────────────────────
//  Each cell is [name, family, species, knob labels, body]. body(NRM) returns
//  the WGSL body of fs_<name>. The body reads p, t and k and returns a vec4f.
//  NRM(call, S) emits a finite-difference normal n for a height call.
//
//  GREP MAP
//    // ---- chrome .... flowing chrome height fields
//    // ---- ribbons ... stacked warped silk folds
//    // ---- bands ..... tube cross-sections in bands, rings and wires
//    // ---- blobs ..... Blinn metaball fields
//    // ---- cells ..... Worley tubes, glass, cracks
//    // ---- glass ..... tiles, slats, fluted glass, thin film
// ============================================================================
export const CELLS = [
  // ---- chrome ------------------------------------------------------------
  ['quicksilver', 'chrome', 'domain-warped fbm read as flowing chrome', ['scale', 'warp', 'flow', ''],
   N => `  let sc = mix(1.4, 3.0, k.x); let amt = mix(1.2, 3.0, k.y); let tt = t * mix(0.5, 1.8, k.z);
${N(q => `hWarp(${q}, tt, sc, amt, 3u)`, '0.55')}
  return present(chrome(n, metalF0(), 0.0));`],

  ['mercury_pool', 'chrome', 'drips spread damped rings over a still mercury pool', ['rate', 'ripple', 'turn', ''],
   N => `  let rate = mix(0.12, 0.4, k.x); let amp = mix(0.0015, 0.005, k.y);
${N(q => `hPool(${q}, t, rate, amp)`, '1.0')}
  let nb = normalize(n + vec3f(0.0, 0.5 * p.y + 0.12, 0.0));
  return present(chrome(nb, metalF0(), mix(-0.6, 0.6, k.z)));`],

  ['hammered', 'chrome', 'Worley dimples beaten into pewter under a swinging light', ['dents', 'depth', 'sweep', ''],
   N => `  let sc = mix(5.0, 12.0, k.x); let dep = mix(0.5, 1.4, k.y);
${N(q => `hHammer(${q}, sc, dep)`, '1.0')}
  let spin = sin(t * 0.4) * mix(0.2, 1.2, k.z);
  return present(chrome(n, mix(metalF0(), u.cream.rgb, 0.15), spin));`],

  ['brushed_plate', 'chrome', 'linear brushed steel with an anisotropic streak highlight', ['grain', 'spread', 'sweep', ''],
   N => `  let g = gnoise(vec2f(p.x * 4.0, p.y * mix(250.0, 600.0, k.x)), 7u) * 0.6 + gnoise(vec2f(p.x * 9.0, p.y * 1100.0), 8u) * 0.4;
  let n = normalize(vec3f(p.x * 0.5, p.y * 0.5 + g * 0.03, 1.0));
  var c = env(reflect(-VIEW, n), 0.0) * fres(metalF0(), n.z) * (0.72 + 0.28 * g);
  let lx = 0.3 * sin(t * mix(0.3, 0.9, k.z));
  let dx = p.x - lx; let dx2 = p.x + lx * 0.6 + 0.12;
  let w = mix(700.0, 60.0, k.y);
  c += u.cream.rgb * exp(-dx * dx * w) * (0.7 + 0.3 * g) * 1.1;
  c += u.tone.rgb * exp(-dx2 * dx2 * w * 0.5) * (0.7 + 0.3 * g) * 0.5;
  return present(c);`],

  ['spun_disc', 'chrome', 'a lathe-spun disc; the bowtie highlight turns with the light', ['grain', 'lobe', 'turn', ''],
   N => `  let r = length(p) + 1e-4; let a = atan2(p.y, p.x); let R = 0.43;
  let g = gnoise(vec2f(r * mix(400.0, 1000.0, k.x), a * 2.0), 12u) * 0.6 + gnoise(vec2f(r * 1600.0, a * 5.0), 13u) * 0.4;
  let groove = 0.8 + 0.2 * smoothstep(0.0, 0.25, abs(fract(r * 22.0) - 0.5));
  let la = t * mix(0.2, 0.8, k.z);
  let lobe = pow(abs(cos(a - la)), mix(60.0, 6.0, k.y));
  let n = normalize(vec3f(p * 0.35, 1.0));
  var c = env(reflect(-VIEW, n), la) * fres(metalF0(), n.z) * 0.55 * (0.8 + 0.2 * g) * groove;
  c += mix(u.tone.rgb, u.cream.rgb, 0.7) * lobe * (0.25 + 0.9 * r / R) * (0.65 + 0.35 * g) * groove;
  let rim = smoothstep(R - 0.025, R, r);
  c = mix(c, tubeShade((r - (R - 0.0125)) / 0.0125, p / r, metalF0(), la), rim);
  let hub = smoothstep(0.055, 0.05, r);
  c = mix(c, chrome(normalize(vec3f(p / 0.055 * 0.8, 1.0)), metalF0(), la), hub);
  let m = smoothstep(R + px(), R - px(), r);
  let bg = u.ink.rgb + u.tone.rgb * 0.05 * exp(-r * 3.0);
  return present(mix(bg, c, m));`],

  ['liquid_gold', 'chrome', 'slow rolling domain warp poured as molten gold (own tint)', ['scale', 'warp', 'flow', ''],
   N => `  let sc = mix(0.7, 1.5, k.x); let amt = mix(1.2, 2.6, k.y); let tt = t * mix(0.3, 1.2, k.z);
${N(q => `hWarp(${q} * vec2f(1.0, 1.3), tt, sc, amt, 11u)`, '0.7')}
  return present(chrome(n, vec3f(1.0, 0.74, 0.32), 0.3));`],

  // ---- ribbons -----------------------------------------------------------
  ['silk_ribbons', 'ribbons', 'stacked warped sine folds glowing as silk ribbons', ['count', 'twist', 'spread', ''],
   N => `  let n = i32(mix(6.0, 14.0, k.x));
  let c = silk(p, t, n, mix(0.12, 0.3, k.z), 0.05, mix(0.4, 1.6, k.y), 1.0, 1.0);
  return present(u.ink.rgb + c);`],

  ['prism_ribbons', 'ribbons', 'the ribbon stack drawn three times, split per color channel', ['split', 'twist', 'count', ''],
   N => `  let n = i32(mix(5.0, 8.0, k.z));
  let o = vec2f(0.0, mix(0.004, 0.03, k.x)); let tw = mix(0.5, 1.5, k.y);
  let lw = vec3f(0.33);
  let r = dot(silk(p + o, t, n, 0.22, 0.045, tw, 0.8, 4.0), lw);
  let g = dot(silk(p, t + 0.05, n, 0.22, 0.045, tw, 0.8, 4.0), lw);
  let b = dot(silk(p - o, t + 0.1, n, 0.22, 0.045, tw, 0.8, 4.0), lw);
  return present(u.ink.rgb + vec3f(r, g, b) * 1.6);`],

  ['cinched_silk', 'ribbons', 'diagonal ribbons pulled through a gaussian waist to knife edges', ['pinch', 'twist', 'count', ''],
   N => `  let q = rot2(-0.7) * p;
  let waist = 1.0 - mix(0.6, 0.93, k.x) * exp(-q.x * q.x / 0.02);
  let c = silk(vec2f(q.x * 1.3, q.y / waist), t, i32(mix(7.0, 14.0, k.z)), 0.24, 0.05, mix(0.5, 1.8, k.y), 1.0, 7.0);
  return present(u.ink.rgb + c * mix(1.0, 1.35, 1.0 - waist));`],

  ['thread_veil', 'ribbons', 'a veil of fine silk threads, each with a soft halo', ['count', 'spread', 'twist', ''],
   N => `  let c = silk(p, t * 0.8, i32(mix(12.0, 24.0, k.x)), mix(0.14, 0.34, k.y), 0.006, mix(0.3, 1.2, k.z), 3.0, 13.0);
  return present(u.ink.rgb + c * 1.3);`],

  ['satin_drape', 'ribbons', 'a draped satin sheet with a broad sheen along the folds', ['folds', 'sheen', 'sway', ''],
   N => `  let f = mix(12.0, 26.0, k.x); let tt = t * mix(0.4, 1.4, k.z);
${N(q => `hDrape(${q}, tt, f)`, '1.0')}
  let l = normalize(vec3f(-0.45, 0.55, 0.7));
  let diff = max(dot(n, l), 0.0);
  let r = reflect(-VIEW, n);
  let sh = pow(max(dot(r, l), 0.0), mix(6.0, 30.0, k.y));
  let cloth = mix(u.tone.rgb, vec3f(0.55, 0.35, 0.75), 0.35);
  let hv = normalize(l + VIEW);
  let sat = pow(max(dot(n, hv), 0.0), mix(20.0, 90.0, k.y));
  var c = cloth * (0.03 + 0.7 * diff * diff) + mix(cloth, u.cream.rgb, 0.4) * sh * 0.5 + mix(cloth, u.cream.rgb, 0.7) * sat * 1.8;
  c += env(r, 0.0) * fres(vec3f(0.04), n.z) * 0.35;
  return present(c);`],

  // ---- bands -------------------------------------------------------------
  ['chrome_rings', 'bands', 'concentric bands shaded as tube cross-sections', ['rings', 'drift', 'fill', ''],
   N => `  let nr = mix(4.0, 11.0, k.x); let fl = mix(0.6, 0.95, k.z);
  let r = length(p) + 1e-4;
  let x = r * nr - t * mix(0.05, 0.5, k.y);
  let s = (fract(x) - 0.5) * 2.0 / fl;
  let m = bandMask(s, 2.0 * px() * nr / fl);
  let c = tubeShade(s, p / r, metalF0(), 0.0);
  return present(mix(u.ink.rgb, c, m));`],

  ['wavy_bands', 'bands', 'wavy chrome bands; the normal comes from the band gradient', ['bands', 'wave', 'flow', ''],
   N => `  let nb = mix(5.0, 12.0, k.x); let a = mix(0.1, 0.6, k.y); let tt = t * mix(0.3, 1.2, k.z);
  let e = px();
  let f0 = p.y * nb + a * (sin(p.x * 5.0 + tt * 0.7) + 2.2 * fbm(p * 2.0 + vec2f(0.08 * tt, 0.0), 3, 31u));
  let fx = (p.y) * nb + a * (sin((p.x + e) * 5.0 + tt * 0.7) + 2.2 * fbm((p + vec2f(e, 0.0)) * 2.0 + vec2f(0.08 * tt, 0.0), 3, 31u));
  let fy = (p.y + e) * nb + a * (sin(p.x * 5.0 + tt * 0.7) + 2.2 * fbm((p + vec2f(0.0, e)) * 2.0 + vec2f(0.08 * tt, 0.0), 3, 31u));
  let g = vec2f(fx - f0, fy - f0) / e;
  let gl = max(length(g), 1e-3);
  let s = (fract(f0) - 0.5) * 2.0 / 0.86;
  let m = bandMask(s, 2.0 * px() * gl / 0.86);
  return present(mix(u.ink.rgb, tubeShade(s, g / gl, metalF0(), 0.0), m));`],

  ['twisted_wires', 'bands', 'stranded wire ropes drifting through a sine', ['wires', 'twist', 'drift', ''],
   N => `  var c = u.ink.rgb + u.tone.rgb * 0.04 * (0.5 - p.y);
  let nw = i32(mix(3.0, 6.0, k.x));
  for (var i: i32 = 0; i < 6; i++) {
    if (i >= nw) { break; }
    let fi = f32(i);
    let om = 3.0 + fi * 0.7; let A = 0.1;
    let ph = p.x * om + t * mix(0.3, 1.2, k.z) * (0.7 + 0.2 * fi) + fi * 1.3;
    let cy = (fi / max(f32(nw) - 1.0, 1.0) - 0.5) * 0.7 + A * sin(ph);
    let dc = A * om * cos(ph);
    let sl = sqrt(1.0 + dc * dc);
    let R = 0.04;
    let s = (p.y - cy) / sl / R;
    let dir = vec2f(-dc, 1.0) / sl;
    let tg = vec2f(dir.y, -dir.x);
    let st = fract(p.x * sl * mix(12.0, 30.0, k.y) + asin(clamp(s, -1.0, 1.0)) / PI * 1.5) - 0.5;
    let n = normalize(vec3f(dir * s + tg * st * 0.9, sqrt(max(1.0 - s * s, 0.0))));
    let w = chrome(n, mix(metalF0(), u.cream.rgb, 0.1 * fi), 0.0) * (0.35 + 0.65 * (1.0 - 4.0 * st * st)) * (0.5 + 0.5 * sqrt(max(1.0 - s * s, 0.0)));
    let m = bandMask(s, 2.0 * px() / R);
    c = mix(c * (1.0 - 0.6 * exp(-s * s * 0.3) * step(1.0, abs(s))), w, m);
  }
  return present(c);`],

  ['spiral_coil', 'bands', 'a log-spiral coil of chrome tube winding into the dark', ['pitch', 'spin', 'arms', ''],
   N => `  let r = length(p) + 1e-4; let a = atan2(p.y, p.x);
  let K = mix(3.0, 8.0, k.x); let m = floor(mix(1.0, 5.0, k.z));
  let f = log(r) * K + a * m / TAU - t * mix(0.1, 0.6, k.y);
  let g = (K * p + (m / TAU) * vec2f(-p.y, p.x)) / (r * r);
  let gl = length(g);
  let s = (fract(f) - 0.5) * 2.0 / 0.85;
  let mk = bandMask(s, 2.0 * px() * gl / 0.85) * smoothstep(0.015, 0.07, r);
  return present(mix(u.ink.rgb, tubeShade(s, g / gl, metalF0(), 0.0), mk));`],

  ['hoop_weave', 'bands', 'two ring sets in steel and brass woven over and under', ['rings', 'drift', 'fill', ''],
   N => `  let nr = mix(5.0, 10.0, k.x); let fl = mix(0.55, 0.85, k.z);
  let c1 = vec2f(-0.16, 0.0) + 0.1 * vec2f(sin(t * mix(0.2, 0.7, k.y)), cos(t * 0.3));
  let c2 = vec2f(0.16, 0.0) + 0.1 * vec2f(cos(t * 0.4), sin(t * mix(0.2, 0.7, k.y) + 1.0));
  let d1 = p - c1; let d2 = p - c2;
  let r1 = length(d1) + 1e-4; let r2 = length(d2) + 1e-4;
  let x1 = r1 * nr; let x2 = r2 * nr;
  let s1 = (fract(x1) - 0.5) * 2.0 / fl; let s2 = (fract(x2) - 0.5) * 2.0 / fl;
  let aa = 2.0 * px() * nr / fl;
  let m1 = bandMask(s1, aa); let m2 = bandMask(s2, aa);
  let A = tubeShade(s1, d1 / r1, metalF0(), 0.0);
  let B = tubeShade(s2, d2 / r2, vec3f(1.0, 0.78, 0.45), 0.0);
  let top1 = ((i32(floor(x1)) + i32(floor(x2))) & 1) == 0;
  let aOnTop = mix(mix(u.ink.rgb, B, m2), A, m1);
  let bOnTop = mix(mix(u.ink.rgb, A, m1), B, m2);
  return present(select(bOnTop, aOnTop, top1));`],

  ['organ_pipes', 'bands', 'chrome and brass pipes; the studio turns so reflections slide', ['pipes', 'turn', 'fill', ''],
   N => `  let np = floor(mix(7.0, 14.0, k.x)); let fl = mix(0.7, 0.92, k.z);
  let xi = p.x * np; let id = floor(xi); let lx = fract(xi) - 0.5;
  let cx = (id + 0.5) / np;
  let top = 0.36 - 0.9 * cx * cx + 0.04 * rnd1(id + 3.0);
  let s = lx * 2.0 / fl;
  let spin = t * mix(0.1, 0.5, k.y);
  let f0 = select(metalF0(), vec3f(1.0, 0.74, 0.36), (i32(id) & 1) == 1);
  var c = tubeShade(s, vec2f(1.0, 0.0), f0, spin);
  let mouth = smoothstep(0.02, 0.0, abs(p.y + 0.22) - 0.02 * (1.0 - abs(s))) * step(abs(s), 0.6);
  c = mix(c, u.ink.rgb * 0.5, mouth);
  let ey = (p.y - top) / (0.03 * fl);
  let ell = s * s + ey * ey;
  let hole = smoothstep(0.75, 0.6, ell);
  let body = step(p.y, top) * step(-0.45, p.y) + smoothstep(1.0, 0.9, ell);
  c = mix(c, u.ink.rgb * 0.3, hole);
  let m = bandMask(s, 2.0 * px() * np / fl) * clamp(body, 0.0, 1.0);
  let bg = u.ink.rgb + u.tone.rgb * 0.06 * smoothstep(-0.5, 0.5, p.y);
  return present(mix(bg, c, m));`],

  // ---- blobs -------------------------------------------------------------
  ['orbit_blobs', 'blobs', 'orbiting metaballs thresholded into a chrome surface', ['count', 'size', 'speed', ''],
   N => `  let fd = orbitField(p, t * mix(0.4, 1.6, k.z), i32(mix(5.0, 10.0, k.x)), 0.22, mix(0.07, 0.12, k.y), 1.0);
  let w = fwidth(fd.f);
  let m = smoothstep(1.0 - w, 1.0 + w, fd.f);
  let c = chrome(blobN(fd, 0.04), metalF0(), 0.0);
  let bg = u.ink.rgb + u.tone.rgb * 0.1 * min(fd.f, 1.0) * min(fd.f, 1.0);
  return present(mix(bg, c, m));`],

  ['contour_blobs', 'blobs', 'a lit blob rim, hairline caustic contours and dark clamped cores', ['count', 'lines', 'core', ''],
   N => `  let fd = orbitField(p, t * 0.8, i32(mix(4.0, 8.0, k.x)), 0.26, 0.085, 3.0);
  let v = fd.f * mix(3.0, 9.0, k.y);
  let fw = fwidth(v);
  let dl = abs(fract(v + 0.5) - 0.5);
  let line = 1.0 - smoothstep(0.0, fw * 1.2, dl);
  let wf = fwidth(fd.f);
  let m = smoothstep(1.0 - wf, 1.0 + wf, fd.f);
  let n = blobN(fd, 0.04);
  let core = smoothstep(mix(2.0, 5.0, k.z), mix(2.4, 6.0, k.z), fd.f);
  var inside = chrome(n, metalF0(), 0.0);
  inside = mix(inside, u.ink.rgb * 0.6, core);
  let outside = u.ink.rgb + u.tone.rgb * 0.05 * fd.f;
  var c = mix(outside, inside, m);
  let rim = exp(-pow((fd.f - 1.0) / max(4.0 * wf, 0.02), 2.0));
  c += u.cream.rgb * rim * 0.9;
  c += mix(u.tone.rgb, u.cream.rgb, 0.5) * line * mix(0.35, 0.12, m) * (1.0 - core);
  return present(c);`],

  ['mercury_drops', 'blobs', 'mercury droplets fall, touch and merge into the pool below', ['drops', 'size', 'speed', ''],
   N => `  var fd: Fld; fd.f = 0.0; fd.g = vec2f(0.0);
  let nd = i32(mix(5.0, 10.0, k.x));
  for (var i: i32 = 0; i < 10; i++) {
    if (i >= nd) { break; }
    let fi = f32(i);
    let h = rnd1(fi * 4.7 + 1.0); let h2 = rnd1(fi * 8.3 + 2.0);
    let ph = fract(t * mix(0.08, 0.3, k.z) * (0.7 + 0.6 * h2) + h);
    let c = vec2f((h - 0.5) * 0.75 + 0.03 * sin(t + fi), 0.6 - ph * ph * 1.0);
    addBall(&fd, p, c, mix(0.03, 0.06, k.y) * (0.6 + 0.7 * h2));
  }
  let dy = max(p.y + 0.3, 0.004);
  let pr = 0.05;
  fd.f += pr * pr / (dy * dy);
  fd.g += vec2f(0.0, -2.0 * pr * pr / (dy * dy * dy)) * step(0.0045, p.y + 0.3);
  let w = fwidth(fd.f);
  let m = smoothstep(1.0 - w, 1.0 + w, fd.f);
  let pool = smoothstep(-0.27, -0.31, p.y);
  let nb = normalize(blobN(fd, 0.035) + vec3f(0.0, mix(0.5 * p.y + 0.1, 0.3 + 2.2 * (p.y + 0.3), pool), 0.0));
  let c = chrome(nb, metalF0(), 0.0);
  let bg = u.ink.rgb + u.tone.rgb * 0.08 * min(fd.f, 1.0);
  return present(mix(bg, c, m));`],

  ['lava_lamp', 'blobs', 'glossy wax blobs rising and sinking in a glowing lamp (own tint)', ['blobs', 'size', 'speed', ''],
   N => `  var fd: Fld; fd.f = 0.0; fd.g = vec2f(0.0);
  let nb = i32(mix(4.0, 8.0, k.x));
  for (var i: i32 = 0; i < 8; i++) {
    if (i >= nb) { break; }
    let fi = f32(i);
    let h = rnd1(fi * 2.9 + 5.0);
    let c = vec2f((h - 0.5) * 0.3 + 0.05 * sin(t * 0.3 + fi), 0.38 * sin(t * mix(0.1, 0.4, k.z) * (0.6 + 0.8 * h) + fi * 2.1));
    addBall(&fd, p, c, mix(0.06, 0.1, k.y) * (0.7 + 0.5 * rnd1(fi + 11.0)));
  }
  let dy = max(p.y + 0.46, 0.004); let pr = 0.06;
  fd.f += pr * pr / (dy * dy); fd.g += vec2f(0.0, -2.0 * pr * pr / (dy * dy * dy)) * step(0.0045, p.y + 0.46);
  let w = fwidth(fd.f);
  let m = smoothstep(1.0 - w, 1.0 + w, fd.f);
  let n = blobN(fd, 0.05);
  let l = normalize(vec3f(0.0, -0.6, 0.8));
  let wax = mix(u.tone.rgb, vec3f(1.0, 0.42, 0.22), 0.65);
  var c = wax * (0.15 + 0.7 * max(dot(n, l), 0.0));
  c += wax * 1.1 * pow(1.0 - n.z, 2.0) * smoothstep(0.3, -0.5, p.y);
  c += u.cream.rgb * pow(max(dot(n, normalize(normalize(KEY) + VIEW)), 0.0), 80.0) * 1.2;
  let glowBg = u.ink.rgb + u.tone.rgb * 0.22 * smoothstep(0.6, -0.5, p.y) * (1.0 - 1.6 * abs(p.x));
  return present(mix(max(glowBg, u.ink.rgb), c, m));`],

  ['ferro_crown', 'blobs', 'a ferrofluid mound raising a hex crown of spikes', ['spikes', 'pulse', 'turn', ''],
   N => `  let dens = mix(9.0, 18.0, k.x);
  let pulse = 0.5 + 0.5 * sin(t * mix(0.4, 1.4, k.y));
  let tt = t * mix(0.2, 1.0, k.z);
${N(q => `hFerro(${q}, tt, dens, pulse)`, '1.0')}
  var c = chrome(n, vec3f(0.16), 0.2 * sin(t * 0.3));
  c *= 1.4;
  let plate = u.ink.rgb + u.tone.rgb * 0.05 * (1.0 - length(p));
  let m = smoothstep(0.004, 0.012, h_);
  return present(mix(plate, c, m));`],

  // ---- cells -------------------------------------------------------------
  ['chrome_tubes', 'cells', 'Voronoi edge distance as a tube profile: chrome tubes on black', ['scale', 'drift', 'width', ''],
   N => `  let sc = mix(3.0, 6.5, k.x);
  let v = voronoi(p * sc, t * mix(0.2, 1.0, k.y), 0.85, 51u);
  let w = mix(0.06, 0.16, k.z);
  let s = v.edge / w;
  let m = smoothstep(1.0, 1.0 - 1.5 * px() * sc / w, s);
  let c = tubeShade(s, -v.dir, metalF0(), 0.0);
  let bg = u.ink.rgb + u.tone.rgb * 0.04 * (1.0 - v.f1);
  return present(mix(bg, c, m));`],

  ['stained_glass', 'cells', 'glass panes in a lead web, backlit by a drifting lamp', ['panes', 'lamp', 'drift', ''],
   N => `  let sc = mix(3.0, 6.0, k.x);
  let v = voronoi(p * sc, 0.0, 0.85, 61u);
  let glass = mix(pal(v.id.x), u.tone.rgb * 1.2, 0.2) * (0.25 + 0.75 * v.id.y);
  let L = 0.32 * vec2f(sin(t * mix(0.15, 0.6, k.z)), cos(t * mix(0.12, 0.5, k.z) + 0.7));
  let d = p - L;
  let I = 0.1 + 1.7 * exp(-dot(d, d) / mix(0.02, 0.12, k.y)) + 0.25 / (1.0 + dot(d, d) * 30.0);
  let tex = 0.8 + 0.35 * fbm(p * sc * 3.0 + v.id * 20.0, 3, 63u);
  var c = glass * I * tex * (0.6 + 0.4 * smoothstep(0.0, 0.2, v.edge));
  let lw = 0.06;
  let s = v.edge / lw;
  let lead = tubeShade(s, -v.dir, vec3f(0.25), 0.0) * 0.5 + u.cream.rgb * 0.05 * I;
  let lm = smoothstep(1.0, 1.0 - 1.5 * px() * sc / lw, s);
  return present(mix(c, lead, lm));`],

  ['crack_glow', 'cells', 'a Worley crack web glowing white-hot near a drifting source (own palette)', ['plates', 'reach', 'heat', ''],
   N => `  let sc = mix(3.0, 6.0, k.x);
  let wp = p + 0.015 * vec2f(fbm(p * 9.0, 3, 2u), fbm(p * 9.0 + 4.0, 3, 3u));
  let v1 = voronoi(wp * sc, 0.0, 0.9, 71u);
  let v2 = voronoi(wp * sc * 2.4 + 7.0, 0.0, 0.9, 72u);
  let c1 = 1.0 - smoothstep(0.0, 0.035 + 1.5 * px() * sc, v1.edge);
  let c2 = (1.0 - smoothstep(0.0, 0.03 + 1.5 * px() * sc * 2.4, v2.edge)) * smoothstep(0.0, 0.3, fbm(p * 3.0, 3, 5u));
  let crack = max(c1, c2 * 0.8);
  let L = 0.28 * vec2f(sin(t * 0.37), sin(t * 0.29 + 1.0));
  let d = p - L;
  let T = mix(0.7, 1.3, k.z) * exp(-dot(d, d) / mix(0.015, 0.09, k.y));
  let x = 0.12 + T;
  let bb = vec3f(smoothstep(0.0, 0.35, x), smoothstep(0.25, 0.85, x) * 0.85, smoothstep(0.7, 1.2, x) * 0.95);
  var c = u.ink.rgb * 0.8 + vec3f(0.05, 0.045, 0.045) * (0.5 + 0.5 * fbm(p * 14.0, 3, 9u)) * smoothstep(0.0, 0.25, v1.edge);
  c += vec3f(1.0, 0.4, 0.12) * T * 0.12 * smoothstep(0.0, 0.3, v1.edge);
  c += bb * crack * (0.35 + 1.4 * T);
  c += bb * T * 0.35 * exp(-v1.edge / 0.08);
  return present(c);`],

  ['hex_chrome', 'cells', 'a hex lattice of chrome tubes that swell with a travelling wave', ['scale', 'swell', 'speed', ''],
   N => `  let sc = mix(3.5, 8.0, k.x);
  let q = p * sc;
  let s2 = vec2f(1.0, 1.7320508); let hs = 0.5 * s2;
  let a = q - s2 * floor(q / s2) - hs;
  let b = (q - hs) - s2 * floor((q - hs) / s2) - hs;
  let gv = select(b, a, dot(a, a) < dot(b, b));
  let ag = abs(gv);
  let dd = dot(ag, vec2f(0.5, 0.8660254));
  let hd = max(ag.x, dd);
  let edge = 0.5 - hd;
  let dir = select(vec2f(0.5 * sign(gv.x), 0.8660254 * sign(gv.y)), vec2f(sign(gv.x), 0.0), ag.x >= dd);
  let wave = 0.5 + 0.5 * sin(p.x * 5.0 + p.y * 3.0 - t * mix(0.6, 2.4, k.z));
  let w = mix(0.05, 0.1, k.y) * (0.45 + 0.55 * wave) + 0.02;
  let s = edge / w;
  let m = smoothstep(1.0, 1.0 - 1.5 * px() * sc / w, s);
  let c = tubeShade(s, -dir, metalF0(), 0.0);
  let bg = u.ink.rgb + u.tone.rgb * 0.12 * wave * smoothstep(0.1, 0.5, edge);
  return present(mix(bg, c, m));`],

  ['bubble_raft', 'cells', 'a raft of pillowed chrome bubbles with an oil-film sheen', ['scale', 'drift', 'sheen', ''],
   N => `  let sc = mix(4.0, 9.0, k.x);
  let v = voronoi(p * sc, t * mix(0.1, 0.7, k.y), 0.8, 81u);
  let x = v.f1 / max(v.f1 + v.edge, 1e-3);
  let E = 1.0 - x;
  let n = normalize(vec3f(-v.rel / max(v.f1, 1e-4) * pow(x, 2.0) * 1.8, 1.0));
  var c = chrome(n, mix(metalF0(), vec3f(0.5), 0.3), 0.0);
  let fc = film(250.0 + 700.0 * E + 200.0 * v.id.x, n.z);
  c *= mix(vec3f(1.0), fc * 1.6, mix(0.0, 0.8, k.z));
  let seam = smoothstep(0.0, 0.02 + 1.5 * px() * sc, v.edge);
  return present(mix(u.ink.rgb, c, seam));`],

  // ---- glass -------------------------------------------------------------
  ['tile_ring', 'glass', 'rounded metal tiles tilting on a travelling bump; a specular ring rolls out', ['tiles', 'rings', 'tilt', ''],
   N => `  let nt = floor(mix(5.0, 11.0, k.x));
  let g = p * nt; let id = floor(g); let q = fract(g) - 0.5;
  let cc = (id + 0.5) / nt;
  let rc = length(cc) + 1e-4;
  let wv = rc * mix(10.0, 24.0, k.y) - t * 2.2;
  let tilt = cc / rc * cos(wv) * mix(0.15, 0.6, k.z);
  let rad = 0.14; let bnd = 0.5 - 0.06 - rad;
  let dq = abs(q) - vec2f(bnd);
  let sd = length(max(dq, vec2f(0.0))) + min(max(dq.x, dq.y), 0.0) - rad;
  let mq = max(dq, vec2f(0.0));
  var gd = select(vec2f(0.0, sign(q.y)), vec2f(sign(q.x), 0.0), dq.x > dq.y);
  if (mq.x > 0.0 && mq.y > 0.0) { gd = normalize(mq) * sign(q); }
  let bev = smoothstep(-0.09, 0.0, sd);
  let n = normalize(vec3f(-tilt + q * 0.35 + gd * bev * 1.4, 1.0));
  let c = chrome(n, metalF0(), 0.0) * (1.0 - 0.3 * bev);
  let m = smoothstep(0.0, -1.5 * px() * nt, sd);
  return present(mix(u.ink.rgb, c, m));`],

  ['slat_wave', 'glass', 'brushed louvre slats twisting on a wave, light leaking between', ['slats', 'twist', 'speed', ''],
   N => `  let ns = floor(mix(9.0, 20.0, k.x));
  let gy = p.y * ns; let id = floor(gy); let ly = fract(gy) - 0.5;
  let th = mix(0.4, 1.25, k.y) * sin(p.x * 3.5 - t * mix(0.6, 2.2, k.z) + id * 0.35);
  let ch = cos(th);
  let s = ly / (0.47 * ch);
  let g = gnoise(vec2f(p.x * 6.0, (id + 0.5 + s * 0.4) * 60.0), 17u);
  let n = normalize(vec3f(0.0, sin(th) + s * 0.25, ch));
  var c = chrome(n, mix(metalF0(), u.cream.rgb, 0.1), 0.0) * (0.85 + 0.15 * g);
  let m = bandMask(s, 2.0 * px() * ns / (0.47 * ch));
  let leak = u.ink.rgb + mix(u.tone.rgb, u.cream.rgb, 0.4) * 0.6 * (1.0 - ch) * (0.6 + 0.4 * sin(p.x * 2.0 + 1.0));
  return present(mix(leak, c, m));`],

  ['fluted_glass', 'glass', 'vertical fluted louvres, each sampling the light field at its own offset', ['flutes', 'power', 'drift', ''],
   N => `  let nf = floor(mix(6.0, 16.0, k.x));
  let xi = p.x * nf; let id = floor(xi); let lx = fract(xi) - 0.5;
  let cx = (id + 0.5) / nf;
  let mag = mix(1.5, 5.0, k.y);
  let tt = t * mix(0.4, 1.6, k.z);
  let yo = 0.03 * sin(id * 1.7);
  let r = lightField(vec2f(cx - lx * mag / nf, p.y + yo), tt).r;
  let gc = lightField(vec2f(cx - lx * mag * 1.06 / nf, p.y + yo), tt).g;
  let b = lightField(vec2f(cx - lx * mag * 1.12 / nf, p.y + yo), tt).b;
  var c = vec3f(r, gc, b) * (1.0 - 0.7 * pow(abs(lx) * 2.0, 5.0));
  c += u.cream.rgb * 0.35 * exp(-pow((lx + 0.22) * 22.0, 2.0));
  c *= smoothstep(0.5, 0.5 - 1.5 * px() * nf, abs(lx)) * 0.6 + 0.4;
  return present(c);`],

  ['glass_blocks', 'glass', 'pillowed glass blocks bending the light field behind them', ['blocks', 'bend', 'drift', ''],
   N => `  let nb = floor(mix(3.0, 6.0, k.x));
  let g = p * nb; let q = fract(g) - 0.5;
  let ax = 2.0 * abs(q.x); let ay = 2.0 * abs(q.y);
  let a = 1.0 - pow(ax, 4.0); let b = 1.0 - pow(ay, 4.0);
  let gx = -8.0 * pow(ax, 3.0) * sign(q.x) * b;
  let gy = -8.0 * pow(ay, 3.0) * sign(q.y) * a;
  let rip = 0.25 * sin(length(q) * 40.0);
  let gr = vec2f(gx, gy) * 0.12 + normalize(q + 1e-4) * rip * 0.1;
  let n = normalize(vec3f(-gr, 1.0));
  let sp = p + n.xy * mix(0.04, 0.2, k.y) / nb * 3.0;
  var c = lightField(sp, t * mix(0.4, 1.6, k.z)) * 0.72;
  c += chrome(n, vec3f(0.04), 0.0) * 0.7;
  let mortar = smoothstep(0.455, 0.47, max(abs(q.x), abs(q.y)));
  return present(mix(c, u.ink.rgb * 1.2 + u.tone.rgb * 0.04, mortar));`],

  ['oil_slick', 'glass', 'a thin oil film on dark liquid; thickness sets the interference color', ['scale', 'thick', 'flow', ''],
   N => `  let sc = mix(1.0, 2.4, k.x); let tt = t * mix(0.2, 0.9, k.z);
${N(q => `hSlick(${q}, tt, sc)`, '1.0')}
  let d = mix(160.0, 620.0, 0.5 + 0.5 * sin(h_ * mix(40.0, 120.0, k.y) + 0.2 * tt));
  let r = reflect(-VIEW, n);
  let lum = dot(env(r, 0.0), vec3f(0.3, 0.5, 0.2));
  let slick = smoothstep(-0.3, 0.1, fbm(p * 1.4 + vec2f(0.03 * tt, 0.0), 3, 95u));
  let water = u.ink.rgb + env(r, 0.0) * 0.08;
  let fc = film(d, n.z);
  let oil = fc * (0.3 + 1.1 * lum);
  return present(mix(water, oil, slick));`],

  ['soap_bubble', 'glass', 'a soap bubble; its film drains thin at the top and swirls', ['size', 'swirl', 'drain', ''],
   N => `  let R = mix(0.3, 0.43, k.x);
  let c0 = p - vec2f(0.0, 0.015 * sin(t * 0.7));
  let a = atan2(c0.y, c0.x);
  let Rw = R * (1.0 + 0.012 * sin(a * 3.0 + t * 1.3));
  let q = c0 / Rw; let rr = dot(q, q);
  let nz = sqrt(max(1.0 - rr, 0.0));
  let n = vec3f(q, nz);
  let sw = fbm(rot2(0.2 * t) * q * 2.2 + vec2f(0.0, 0.1 * t), 4, 97u);
  let d = mix(60.0, 900.0, pow(0.5 - 0.5 * q.y, mix(0.6, 1.8, k.z))) + sw * mix(80.0, 400.0, k.y);
  let fc = film(max(d, 20.0), nz);
  let refl = 0.12 + 0.85 * pow(1.0 - nz, 2.0);
  let r = reflect(-VIEW, n);
  let e = env(r, 0.3);
  let bgc = u.ink.rgb + u.tone.rgb * 0.07 * smoothstep(0.6, -0.6, p.y);
  var c = bgc * 0.9 + fc * (0.2 + 0.9 * e) * refl * 1.6;
  c += u.cream.rgb * pow(max(dot(n, normalize(normalize(KEY) + VIEW)), 0.0), 300.0) * 1.5;
  let m = smoothstep(1.0, 1.0 - 3.0 * px() / R, rr);
  return present(mix(bgc, c, m));`],
];
