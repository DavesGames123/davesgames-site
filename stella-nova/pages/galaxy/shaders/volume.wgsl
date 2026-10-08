// volume.wgsl — the diffuse light and the dust, ray marched (fragment).
// engine.js prepends common.wgsl.
//
//   One ray per pixel of the low-resolution volume target. The ray is cut
//   to the union of the galaxy boxes, then marched front to back with
//   emission-absorption:
//       C += T j (1 - e^(-sigma dt)) / sigma,   T *= e^(-sigma dt)
//   sigma = kappa * REDDEN, so dust dims blue light more than red. The step
//   is short near the disk plane and near the centre, and long elsewhere;
//   the count is bounded by U.off.w. A fixed per-pixel offset (interleaved
//   gradient noise) breaks up the banding of the steps.
//
//   Density terms (sampleGal):
//     halo          (1 + r/r_h)^-3.5
//     bulge         triaxial Sersic, Prugniel-Simien deprojection
//     thin disk     exponential in R and z, a weak density-wave term
//     thick disk    exponential, no arms
//     young disk    thin, in the arms (a strong density wave)
//     HII knots     Worley cells x arms, H-alpha pink
//     bar           boxy ellipse turning with the pattern
//     dust          exponential, arm lanes upstream of the light, domain-
//                   warped fBm filaments, ridged lanes, a ring, a hole
//   The noise is read from the 3D tile (noise.wgsl) in the "unwound"
//   frame q = (R cos s, R sin s, z): there the arms are straight, so the
//   filaments run along the arms and turn with the pattern.

@group(0) @binding(0) var<uniform> U: Uni;
@group(0) @binding(1) var<uniform> G: array<Gal, 2>;
@group(0) @binding(2) var nT: texture_3d<f32>;
@group(0) @binding(3) var nS: sampler;

struct Med { e: vec3f, k: f32 }

fn tex(q: vec3f) -> vec4f { return textureSampleLevel(nT, nS, q, 0.0); }

// Mean of armProfile over a turn: Gamma(n + 1/2) / (sqrt(pi) Gamma(n + 1)).
fn armMean(n: f32) -> f32 { return (1.0 - 0.125 / max(n, 0.6)) / sqrt(3.14159 * max(n, 0.6)); }

fn sampleGal(g: Gal, p: vec3f, fp: f32) -> Med {
  var e = vec3f(0.0);
  var k = 0.0;
  let R = length(p.xy);
  let az = abs(p.z);
  let r3 = length(p);
  // fade to zero at the box walls, so the box never shows as an edge
  let win = 1.0 - smoothstep(0.6, 1.0, max(R / g.box.x, az / g.box.y));
  e += win * g.halo.x * pow(1.0 + r3 * g.halo.y, -3.5) * g.cBulge.rgb;
  let m = max(length(p * vec3f(1.0, g.bulge2.x, g.bulge2.y)) / g.bulge.y, 0.012);
  e += win * g.bulge.x * pow(m, -g.bulge2.z) * exp(-g.bulge.w * pow(m, g.bulge.z)) * g.cBulge.rgb;
  if (g.disk.x <= 0.0 && g.dust.x <= 0.0) { return Med(e, 0.0); }

  let phi = atan2(p.y, p.x);
  let s = spiralS(g, R, phi);
  let ms = g.arms.x * s;
  let ramp = smoothstep(0.55 * g.arms.z, 1.1 * g.arms.z, R);
  let seed = vec3f(g.halo.w * 7.31, g.halo.w * 3.17, g.halo.w * 1.9);
  let q = vec3f(R * cos(s), R * sin(s), p.z * 2.0) + seed;
  // Fine noise fades out when a pixel covers more than its scale.
  let fine = U.extra.x * (1.0 - smoothstep(0.12, 0.6, fp));
  // domain warp: a coarse sample moves the finer ones
  let w = tex(q * 0.045);
  let qw = q + vec3f(w.a - 0.5, w.r - 0.5, 0.0) * 4.0;
  let n1 = tex(qw * 0.14);
  let n2 = tex(qw * 0.37 + vec3f(0.31, 0.17, 0.53));
  let n2r = mix(0.5, n2.r, fine);
  let n2b = mix(0.6, n2.b, fine);

  // arms: major arms, optional minor arms half-way between them, then
  // flocculent fragments
  let sharp = g.arms2.x;
  var A = armProfile(ms, sharp);
  if (g.ext.x > 0.0) { A = max(A, g.ext.x * armProfile(ms + 3.14159, sharp * 1.3)); }
  let frag = smoothstep(0.45, 0.75, n1.r * 0.7 + w.r * 0.5 - 0.1);
  A = mix(A, A * frag * 2.2, g.arms2.z);
  let contrast = g.arms.w * ramp;
  let armMod = max(0.0, 1.0 + contrast * (A / armMean(sharp) - 1.0));
  // young light peaks a little downstream of the arm crest (the stars
  // drift ahead of the pattern inside corotation)
  var Ay = armProfile(ms - 0.3, sharp * 1.25);
  Ay = mix(Ay, Ay * frag * 2.4, g.arms2.z);
  let youngMod = max(0.0, 1.0 + contrast * 1.15 * (Ay / armMean(sharp * 1.25) - 1.0));

  let irr = g.halo.z;
  let clump = mix(1.0, 0.15 + 2.2 * smoothstep(0.38, 0.8, w.r * 0.75 + n1.r * 0.55 - 0.1), irr);

  let ex = exp(-R * g.disk.y);
  let thin = g.disk.x * ex * exp(-az * g.disk.z) * mix(1.0, armMod, 0.55) * mix(1.0, clump, 0.6);
  let thick = win * g.thick.x * exp(-R * g.thick.y - az * g.thick.z);
  e += thin * g.cDisk.rgb + thick * mix(g.cBulge.rgb, g.cDisk.rgb, 0.4);
  let yz = exp(-az * g.arms2.w);
  let young = g.thick.w * ex * yz * youngMod * (0.3 + 1.4 * n1.r) * clump;
  e += young * g.cYoung.rgb;
  // HII knots: 1 - F1 Worley cells, raised to a high power, in the arms
  let cell = tex(qw * g.hii.y * 0.125 + vec3f(0.5, 0.2, 0.7)).g;
  let knot = pow(cell, 7.0) * mix(youngMod, 1.0, 0.1) * ex * yz * g.hii.x * clump * (0.4 + n2r);
  e += knot * g.cHii.rgb;

  // bar: turns with the pattern; dust lanes on its leading edges
  if (g.bar.x > 0.0) {
    let c = cos(g.arms2.y);
    let sn = sin(g.arms2.y);
    let xb = c * p.x + sn * p.y;
    let yb = -sn * p.x + c * p.y;
    let u = pow(xb * xb * g.bar.y * g.bar.y + yb * yb * g.bar.z * g.bar.z, 1.5);
    e += g.bar.x * exp(-u) * exp(-az * g.disk.z / 1.6) * mix(g.cBulge.rgb, g.cDisk.rgb, 0.35);
    let ax = abs(xb) * g.bar.y;
    let off = yb * g.bar.z - sign(xb) * 0.55;
    let lane = exp(-off * off * 9.0) * smoothstep(1.15, 0.6, ax) * smoothstep(0.08, 0.3, ax);
    k += g.bar.w * lane * g.dust.x * 0.6 * exp(-az * g.dust.z) * (0.6 + 0.8 * n2r);
  }

  // dust
  if (g.dust.x > 0.0 || g.dust2.z > 0.0) {
    var dl = armProfile(ms + g.dust3.x, g.dust3.y);
    if (g.ext.x > 0.0) { dl = max(dl, g.ext.x * armProfile(ms + 3.14159 + g.dust3.x, g.dust3.y * 1.3)); }
    dl = mix(dl, dl * frag * 2.0, g.arms2.z) * ramp;
    // filaments: warped fBm; lanes: ridged noise
    let filn = smoothstep(0.28, 0.72, n1.r * 0.65 + n2r * 0.55 - 0.08);
    let fil = mix(1.0, filn * 1.9, g.dust2.w);
    let ridge = mix(1.0, 0.45 + 0.9 * n2b * n2b, g.dust2.w);
    let dz = exp(-az * g.dust.z);
    var kd = g.dust.x * exp(-R * g.dust.y) * dz * (0.3 + g.dust.w * dl) * fil * ridge;
    if (g.dust3.z > 0.0) { kd *= smoothstep(0.55 * g.dust3.z, g.dust3.z, R); }
    let dr = (R - g.dust2.x) * g.dust2.y;
    kd += g.dust2.z * exp(-dr * dr) * dz * mix(1.0, 0.4 + 1.2 * n1.r, g.dust2.w * 0.7);
    k += kd * mix(1.0, clump, 0.7);
  }
  return Med(e * win, k);
}

// Ray against the box |x|,|y| < R, |z| < Z of one galaxy, in its frame.
fn boxHit(o: vec3f, d: vec3f, R: f32, Z: f32) -> vec2f {
  let dd = select(d, vec3f(1e-6), abs(d) < vec3f(1e-6));
  let inv = 1.0 / dd;
  let b = vec3f(R, R, Z);
  let t1 = (-b - o) * inv;
  let t2 = (b - o) * inv;
  let tn = min(t1, t2);
  let tf = max(t1, t2);
  return vec2f(max(max(tn.x, tn.y), tn.z), min(min(tf.x, tf.y), tf.z));
}

// Step length that suits one galaxy at local point p, direction d.
fn stepFor(g: Gal, p: vec3f, d: vec3f) -> f32 {
  let zs = g.box.z;
  let plane = 0.5 * (abs(p.z) + zs) / max(abs(d.z), 0.12);
  let centre = 0.35 * (length(p) + zs);
  var s = min(plane, centre);
  let outside = max(abs(p.z) - g.box.y, length(p.xy) - g.box.x);
  if (outside > 0.0) { s = max(s, outside); }
  return s;
}

struct VOut { @builtin(position) pos: vec4f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let xy = vec2f(f32((i << 1u) & 2u), f32(i & 2u)) * 2.0 - 1.0;
  return VOut(vec4f(xy, 0.0, 1.0));
}

@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / U.res.zw;
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0) - U.off.xy;
  let dir = normalize(U.fwd.xyz + U.right.xyz * ndc.x * U.right.w + U.up.xyz * ndc.y * U.up.w);
  let eye = U.eye.xyz;
  let nGal = i32(U.fwd.w);
  var t0 = 1e9;
  var t1 = -1e9;
  for (var gi = 0; gi < nGal; gi++) {
    let g = G[gi];
    let h = boxHit(toLocal(g, eye), dirLocal(g, dir), g.box.x, g.box.y);
    if (h.y > max(h.x, 0.0)) { t0 = min(t0, h.x); t1 = max(t1, h.y); }
  }
  t0 = max(t0, 0.0);
  if (t1 <= t0) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  let seg = t1 - t0;
  let nsteps = i32(U.off.w);
  let dtMin = seg / (f32(nsteps) * 8.0);
  let dtMax = seg * 2.5 / f32(nsteps);
  let pxAng = 2.0 * U.up.w / U.res.w;
  let jit = fract(52.9829189 * fract(dot(fc.xy, vec2f(0.06711056, 0.00583715))));

  var T = vec3f(1.0);
  var col = vec3f(0.0);
  var t = t0;
  var dt = dtMin;
  // first step length, then the offset inside it
  for (var gi = 0; gi < nGal; gi++) {
    let g = G[gi];
    dt = max(dt, min(dtMax, stepFor(g, toLocal(g, eye + dir * t0), dirLocal(g, dir))));
  }
  t += dt * jit;
  for (var i = 0; i < nsteps; i++) {
    if (t > t1) { break; }
    let p = eye + dir * t;
    var e = vec3f(0.0);
    var kap = 0.0;
    var dn = 1e9;
    for (var gi = 0; gi < nGal; gi++) {
      let g = G[gi];
      let pl = toLocal(g, p);
      let m = sampleGal(g, pl, t * pxAng);
      e += m.e;
      kap += m.k;
      dn = min(dn, stepFor(g, pl, dirLocal(g, dir)));
    }
    let h = clamp(dt, dtMin, dtMax);
    let sig = kap * REDDEN;
    let att = exp(-sig * h);
    col += T * e * select((1.0 - att) / max(sig, vec3f(1e-8)), vec3f(h), sig < vec3f(1e-4));
    T *= att;
    if (max(T.x, max(T.y, T.z)) < 0.004) { break; }
    t += h;
    dt = clamp(dn, dtMin, dtMax);
  }
  return vec4f(col, (T.x + T.y + T.z) / 3.0);
}
