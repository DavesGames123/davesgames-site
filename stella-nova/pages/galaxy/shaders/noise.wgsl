// noise.wgsl — fills the 3D noise texture once, at start (compute).
//
//   The volume and star shaders sample this tile with repeat addressing
//   instead of computing noise at every ray step. Every channel tiles,
//   because the lattice wraps with the period of each octave.
//     r  gradient fBm, 4 octaves, period 4 cells      (dust filaments)
//     g  1 - Worley F1, 8 cells per side               (star-forming knots)
//     b  ridged fBm, 3 octaves, period 6               (dust lanes)
//     a  gradient fBm, 4 octaves, period 3, new seed   (domain warp)

@group(0) @binding(0) var dst: texture_storage_3d<rgba8unorm, write>;
override N: u32 = 96u;

fn pcg3d(v0: vec3u) -> vec3u {
  var v = v0 * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v = v ^ (v >> vec3u(16u));
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
fn rand3(c: vec3i, per: i32, seed: u32) -> vec3f {
  let w = vec3u(((c % per) + per) % per);
  let h = pcg3d(w + vec3u(seed * 1013u, seed * 7919u, seed * 104729u));
  return vec3f(h & vec3u(0xffffu)) / 65535.0;
}
fn grad(c: vec3i, per: i32, seed: u32, f: vec3f) -> f32 {
  let g = rand3(c, per, seed) * 2.0 - 1.0;
  return dot(normalize(g + vec3f(1e-4)), f);
}
// Periodic gradient noise, about -0.7..0.7.
fn gnoise(p: vec3f, per: i32, seed: u32) -> f32 {
  let i = vec3i(floor(p));
  let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let n000 = grad(i, per, seed, f);
  let n100 = grad(i + vec3i(1, 0, 0), per, seed, f - vec3f(1.0, 0.0, 0.0));
  let n010 = grad(i + vec3i(0, 1, 0), per, seed, f - vec3f(0.0, 1.0, 0.0));
  let n110 = grad(i + vec3i(1, 1, 0), per, seed, f - vec3f(1.0, 1.0, 0.0));
  let n001 = grad(i + vec3i(0, 0, 1), per, seed, f - vec3f(0.0, 0.0, 1.0));
  let n101 = grad(i + vec3i(1, 0, 1), per, seed, f - vec3f(1.0, 0.0, 1.0));
  let n011 = grad(i + vec3i(0, 1, 1), per, seed, f - vec3f(0.0, 1.0, 1.0));
  let n111 = grad(i + vec3i(1, 1, 1), per, seed, f - vec3f(1.0, 1.0, 1.0));
  let x00 = mix(n000, n100, u.x); let x10 = mix(n010, n110, u.x);
  let x01 = mix(n001, n101, u.x); let x11 = mix(n011, n111, u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}
fn fbm(x: vec3f, per0: i32, oct: i32, seed: u32) -> f32 {
  var s = 0.0; var a = 0.5; var per = per0;
  for (var o = 0; o < oct; o++) {
    s += a * gnoise(x * f32(per), per, seed + u32(o));
    a *= 0.5; per *= 2;
  }
  return s;
}
fn ridged(x: vec3f, per0: i32, oct: i32, seed: u32) -> f32 {
  var s = 0.0; var a = 0.55; var per = per0;
  for (var o = 0; o < oct; o++) {
    let r = 1.0 - abs(gnoise(x * f32(per), per, seed + u32(o)) * 1.6);
    s += a * r * r;
    a *= 0.5; per *= 2;
  }
  return s;
}
fn worley(x: vec3f, cells: i32, seed: u32) -> f32 {
  let p = x * f32(cells);
  let i = vec3i(floor(p));
  var d = 9.0;
  for (var k = -1; k <= 1; k++) {
    for (var j = -1; j <= 1; j++) {
      for (var h = -1; h <= 1; h++) {
        let c = i + vec3i(h, j, k);
        let fp = vec3f(c) + rand3(c, cells, seed);
        d = min(d, length(fp - p));
      }
    }
  }
  return d;
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= N || id.y >= N || id.z >= N) { return; }
  let x = (vec3f(id) + 0.5) / f32(N);
  let r = clamp(0.5 + 0.8 * fbm(x, 4, 4, 1u), 0.0, 1.0);
  let g = clamp(1.0 - worley(x, 8, 9u) * 1.25, 0.0, 1.0);
  let b = clamp(ridged(x, 6, 3, 17u), 0.0, 1.0);
  let a = clamp(0.5 + 0.8 * fbm(x, 3, 4, 29u), 0.0, 1.0);
  textureStore(dst, id, vec4f(r, g, b, a));
}
