// stars.wgsl — resolved stars as point sprites (instanced quads).
// engine.js prepends common.wgsl.
//
//   One instance per star, six vertices per quad. model.js writes each star
//   as four vec4 (see "Star record" there). The vertex stage moves the star
//   for the time U.eye.w:
//     pop 0  circular orbit at Omega(R) (old disk, bulge, halo, clusters);
//            the density wave brightens it inside an arm, it does not move it
//     pop 2  born in an arm at t_b, then free at Omega(R): young stars and
//            HII regions drift downstream of the arm and fade with age
//     pop 3  bar stars, rigid with the pattern
//     pop 4  fixed positions (tidal tails, the jet)
//     pop 5  the sky: foreground stars and background galaxies
//     pop 6  an interacting pair's test stars: a Catmull-Rom curve through
//            the recorded keyframes TR (half floats, encounter.js is the
//            CPU mirror), at keyframe time U.enc.x; far from both hosts
//            the sprite widens (0.03 x the distance, the same flux)
//   Density gain U.enc.w (1 sparse .. 0.3 dense) makes the sprites of a
//   dense view smaller and dimmer, so the cores do not merge to a blob.
//   Brightness: a star of light L at distance d gives flux L / (4 pi d^2),
//   spread over a Gaussian of sigma px, so its peak radiance is
//   flux / (pixel solid angle * 2 pi sigma^2). The volume uses the same
//   units, so the stars and the diffuse light add up.
//   Dust in front of a star: the exponential column along the line of
//   sight (columnExp), with kappa taken where the line crosses the disk.

@group(0) @binding(0) var<uniform> U: Uni;
@group(0) @binding(1) var<uniform> G: array<Gal, 2>;
@group(0) @binding(2) var<storage, read> S: array<vec4f>;
@group(0) @binding(3) var nT: texture_3d<f32>;
@group(0) @binding(4) var nS: sampler;
@group(0) @binding(5) var<storage, read> TR: array<vec2u>;

fn trk(k: i32, i: u32) -> vec3f {
  let q = TR[u32(k) * u32(U.enc.y + 0.5) + i];
  let xy = unpack2x16float(q.x);
  return vec3f(xy, unpack2x16float(q.y).x);
}
fn catmull(p0: vec3f, p1: vec3f, p2: vec3f, p3: vec3f, f: f32) -> vec3f {
  let f2 = f * f;
  let f3 = f2 * f;
  return 0.5 * (2.0 * p1 + (p2 - p0) * f + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * f2 + (3.0 * p1 - p0 - 3.0 * p2 + p3) * f3);
}

struct VO {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) col: vec3f,
}

fn dustTau(g: Gal, pw: vec3f, toCam: vec3f, L: f32) -> f32 {
  if (g.dust.x <= 0.0 && g.dust2.z <= 0.0) { return 0.0; }
  let pl = toLocal(g, pw);
  let dl = dirLocal(g, toCam);
  var R = length(pl.xy);
  var phi = atan2(pl.y, pl.x);
  if (abs(dl.z) > 0.02) {
    let sc = -pl.z / dl.z;
    if (sc > 0.0 && sc < L) {
      let c = pl + dl * sc;
      R = length(c.xy);
      phi = atan2(c.y, c.x);
    }
  }
  let s = spiralS(g, R, phi);
  let ramp = smoothstep(0.55 * g.arms.z, 1.1 * g.arms.z, R);
  let lane = armProfile(g.arms.x * s + g.dust3.x, g.dust3.y) * ramp;
  let seed = vec3f(g.halo.w * 7.31, g.halo.w * 3.17, g.halo.w * 1.9);
  let n = textureSampleLevel(nT, nS, (vec3f(R * cos(s), R * sin(s), 0.0) + seed) * 0.14, 0.0);
  let fil = mix(1.0, smoothstep(0.3, 0.75, n.r) * 1.8, g.dust2.w);
  var kap = g.dust.x * exp(-R * g.dust.y) * (0.3 + g.dust.w * lane) * fil;
  if (g.dust3.z > 0.0) { kap *= smoothstep(0.55 * g.dust3.z, g.dust3.z, R); }
  let dr = (R - g.dust2.x) * g.dust2.y;
  kap += g.dust2.z * exp(-dr * dr);
  // path length inside the dusty disk (radius 4 R_dust) toward the camera
  let Re = 4.0 / g.dust.y;
  let a = dot(dl.xy, dl.xy);
  var Lx = L;
  if (a > 1e-6) {
    let b = dot(pl.xy, dl.xy);
    let c = dot(pl.xy, pl.xy) - Re * Re;
    let disc = b * b - a * c;
    if (disc > 0.0) { Lx = min(L, max(0.0, (-b + sqrt(disc)) / a)); }
  }
  return kap * columnExp(pl.z, dl.z, 1.0 / g.dust.z, Lx);
}

const CORNER = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  var o: VO;
  o.pos = vec4f(0.0, 0.0, 2.0, 1.0);   // outside the clip volume: culled
  o.uv = vec2f(0.0);
  o.col = vec3f(0.0);
  let a = S[ii * 4u];
  let b = S[ii * 4u + 1u];
  let c = S[ii * 4u + 2u];
  let d = S[ii * 4u + 3u];
  let pop = i32(a.x + 0.5);
  let t = U.eye.w;
  let gi = min(u32(b.x + 0.5), 1u);
  let g = G[gi];
  var pw = vec3f(0.0);
  var bright = 1.0;
  let sky = pop == 5;
  if (pop == 0) {
    let R = a.y;
    let phi = a.z + omegaAt(g, R) * b.z * t;
    if (b.y > 0.0 && g.arms.w > 0.0) {
      let ramp = smoothstep(0.55 * g.arms.z, 1.1 * g.arms.z, R);
      let A = armProfile(g.arms.x * spiralS(g, R, phi), g.arms2.x);
      bright = max(0.2, 1.0 + b.y * ramp * (A * 2.4 - 0.7));
    }
    pw = toWorld(g, vec3f(R * cos(phi), R * sin(phi), a.w));
  } else if (pop == 2) {
    let R = a.y;
    let life = b.y;
    let age = fract(t / life + b.z) * life;
    let phiB = a.z - log(max(R, 0.05) / g.arms.z) * g.arms.y + g.dust3.w * (t - age);
    let phi = phiB + omegaAt(g, R) * age;
    pw = toWorld(g, vec3f(R * cos(phi), R * sin(phi), a.w));
    let x = age / life;
    if (b.w > 0.5) { bright = smoothstep(0.0, 0.12, x) * (1.0 - x) * 2.2; }
    else { bright = smoothstep(0.0, 0.05, x) * pow(1.0 - x, 3.0) * 3.2; }
  } else if (pop == 3) {
    let cs = cos(g.arms2.y);
    let sn = sin(g.arms2.y);
    pw = toWorld(g, vec3f(cs * a.y - sn * a.z, sn * a.y + cs * a.z, a.w));
  } else if (pop == 4) {
    pw = a.yzw;
  } else if (pop == 6) {
    let K = i32(U.enc.z + 0.5);
    if (K < 2) { return o; }
    let u = clamp(U.enc.x, 0.0, f32(K - 1));
    let k1 = min(K - 2, i32(floor(u)));
    let i = u32(a.y + 0.5);
    pw = catmull(trk(max(k1 - 1, 0), i), trk(k1, i), trk(k1 + 1, i), trk(min(k1 + 2, K - 1), i), u - f32(k1));
  }
  if (bright <= 0.001) { return o; }

  var v = pw - U.eye.xyz;
  if (sky) { v = a.yzw; }
  let zc = dot(v, U.fwd.xyz);
  if (zc < 0.01) { return o; }
  let ndc = vec2f(dot(v, U.right.xyz) / (zc * U.right.w), dot(v, U.up.xyz) / (zc * U.up.w)) + U.off.xy;
  let pxAng = 2.0 * U.up.w / U.res.y;
  let dens = clamp(U.enc.w, 0.3, 1.0);
  let sig0 = max(0.75, U.res.y / 1300.0) * mix(0.8, 1.0, dens);
  let tw = 1.0 + d.y * U.look.w * 0.5 * sin(U.extra.z * (1.7 + 1.3 * fract(b.w * 3.7)) + b.w * 7.0);
  var peak: f32;
  var sig: f32;
  var trans = vec3f(1.0);
  if (sky) {
    sig = sig0 * d.x;
    peak = c.w * U.misc.x * U.misc.y;
    if (b.x > 0.5) {
      // a background galaxy, behind the subject: its dust dims it
      var tau = 0.0;
      let far = U.eye.xyz + v * 3000.0;
      for (var k = 0; k < i32(U.fwd.w); k++) { tau += dustTau(G[k], far, -v, 3000.0); }
      trans = exp(-tau * REDDEN);
    }
  } else {
    let dist = length(v);
    var physR = d.z;
    if (pop == 6) {
      // debris far from both hosts is sparse: a wider, fainter sprite (the
      // same flux), so the tails read as a glow and not as speckle
      let dm = min(length(pw - vec3f(G[0].rx.w, G[0].ry.w, G[0].rz.w)), length(pw - vec3f(G[1].rx.w, G[1].ry.w, G[1].rz.w)));
      physR = max(physR, 0.03 * dm);
    }
    let physPx = physR / max(1e-4, dist * pxAng);
    sig = max(sig0 * d.x, physPx);
    let flux = c.w * bright * U.look.z * mix(0.75, 1.0, dens) / (12.566 * dist * dist);
    peak = flux / (pxAng * pxAng * 6.2832 * sig * sig);
    peak = min(peak, U.misc.x * U.extra.y);
    var tau = 0.0;
    for (var k = 0; k < i32(U.fwd.w); k++) { tau += dustTau(G[k], pw, -v / dist, dist); }
    trans = exp(-tau * REDDEN);
  }
  peak *= tw;
  if (peak * max(trans.x, max(trans.y, trans.z)) < U.misc.x * 1e-4) { return o; }
  var cr = CORNER[vi];
  var q = cr;
  if (sky && b.x > 0.5) {
    // background galaxy: an ellipse, axis ratio b.y at angle b.z
    let ca = cos(b.z);
    let sa = sin(b.z);
    let e = vec2f(cr.x, cr.y * b.y);
    q = vec2f(ca * e.x - sa * e.y, sa * e.x + ca * e.y);
  }
  let half = 3.0 * sig;
  o.pos = vec4f(ndc + q * half * 2.0 / U.res.xy, 0.5, 1.0);
  o.uv = cr;
  o.col = c.rgb * peak * trans;
  return o;
}

@fragment fn fs(i: VO) -> @location(0) vec4f {
  let r2 = dot(i.uv, i.uv);
  if (r2 > 1.0) { discard; }
  let a = max(exp(-4.5 * r2) - 0.011, 0.0);
  return vec4f(i.col * a, 0.0);
}
