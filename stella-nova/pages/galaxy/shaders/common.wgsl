// common.wgsl — shared structs and helpers. engine.js puts this text in
// front of volume.wgsl and stars.wgsl (WGSL has no include).
//
//   Uni  one per frame: the camera, the sizes and the look
//   Gal  one per galaxy, GAL_VEC4 = 24 vec4 (model.js packGalaxy has the
//        same order, field by field)

struct Uni {
  eye: vec4f,     // camera position (kpc), w = time (Myr)
  right: vec4f,   // camera right, w = tan(fov/2) * aspect
  up: vec4f,      // camera up, w = tan(fov/2)
  fwd: vec4f,     // camera forward, w = number of galaxies
  off: vec4f,     // ndc offset x, y (plate framing); z = frame; w = ray steps
  res: vec4f,     // render w, h; volume w, h
  look: vec4f,    // exposure scale, bloom mix, star gain, twinkle
  misc: vec4f,    // reference surface brightness, sky gain, auto key, auto rate
  extra: vec4f,   // noise detail 0..1, peak clamp (x reference), wall time (s), -
}

struct Gal {
  rx: vec4f, ry: vec4f, rz: vec4f, // world -> local rows; w = centre x, y, z
  bulge: vec4f,   // rho0/4pi, r_e, 1/n, b_n
  bulge2: vec4f,  // 1/q, 1/c, p (Prugniel-Simien), v_flat (rad/Myr * kpc)
  disk: vec4f,    // rho0/4pi, 1/R_d, 1/h_z, R_max
  thick: vec4f,   // rho0/4pi, 1/R_d, 1/h_z, young rho0/4pi
  arms: vec4f,    // m, 1/tan(pitch), R_0, contrast
  arms2: vec4f,   // sharpness, Omega_p t, flocculence, 1/h_young
  bar: vec4f,     // rho0/4pi, 1/a, 1/b, bar dust
  dust: vec4f,    // kappa_0, 1/R_dust, 1/h_dust, arm lane strength
  dust2: vec4f,   // ring radius, 1/ring width, ring kappa, filaments
  dust3: vec4f,   // lane offset (rad), lane sharpness, inner hole radius, Omega_p (rad/Myr)
  hii: vec4f,     // amplitude, cell frequency (1/kpc), -, R_t (rotation turnover)
  halo: vec4f,    // rho0/4pi, 1/r_h, irregularity, noise seed offset
  cBulge: vec4f, cDisk: vec4f, cYoung: vec4f, cHii: vec4f,
  box: vec4f,     // R box, z box, vertical step scale, active
  ext: vec4f,     // minor arms, barred flag, position angle, -
  pad0: vec4f, pad1: vec4f, pad2: vec4f,
}

const TAU: f32 = 6.2831853;
// Extinction per channel against V (A_lambda ~ 1/lambda at 650, 550, 450 nm).
const REDDEN = vec3f(0.85, 1.0, 1.22);

fn toLocal(g: Gal, p: vec3f) -> vec3f {
  let d = p - vec3f(g.rx.w, g.ry.w, g.rz.w);
  return vec3f(dot(g.rx.xyz, d), dot(g.ry.xyz, d), dot(g.rz.xyz, d));
}
fn dirLocal(g: Gal, d: vec3f) -> vec3f {
  return vec3f(dot(g.rx.xyz, d), dot(g.ry.xyz, d), dot(g.rz.xyz, d));
}
fn toWorld(g: Gal, l: vec3f) -> vec3f {
  return g.rx.xyz * l.x + g.ry.xyz * l.y + g.rz.xyz * l.z + vec3f(g.rx.w, g.ry.w, g.rz.w);
}
// Spiral coordinate: 0 on arm 0, the arms are where cos(m s) = 1. The
// pattern turns rigidly by Omega_p t, so the arms never wind up.
fn spiralS(g: Gal, R: f32, phi: f32) -> f32 {
  return phi + log(max(R, 0.05) / g.arms.z) * g.arms.y - g.arms2.y;
}
// Arm profile, 0..1, sharpened by a power.
fn armProfile(ms: f32, sharp: f32) -> f32 {
  return pow(max(0.5 + 0.5 * cos(ms), 0.0), sharp);
}
// Angular speed (rad/Myr) of the rotation curve v = v_f R / sqrt(R^2 + R_t^2).
fn omegaAt(g: Gal, R: f32) -> f32 {
  return g.bulge2.w / sqrt(R * R + g.hii.w * g.hii.w);
}
// Column of exp(-|z|/h) along s in [0, L] from height z0 with slope dz.
// F(z) = sign(z) h (1 - exp(-|z|/h)) is the antiderivative in z.
fn columnExp(z0: f32, dz: f32, h: f32, L: f32) -> f32 {
  if (abs(dz) < 1e-4) { return L * exp(-abs(z0) / h); }
  let z1 = z0 + dz * L;
  let F0 = sign(z0) * h * (1.0 - exp(-abs(z0) / h));
  let F1 = sign(z1) * h * (1.0 - exp(-abs(z1) / h));
  return (F1 - F0) / dz;
}
