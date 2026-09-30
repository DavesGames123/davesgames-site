// common.wgsl — shared header for every SDF Clouds program.
//
// engine.js puts this file in front of each program source. It holds the
// Params uniform and the hash and noise functions. Params mirrors pack() in
// params.js slot for slot. Every field is a vec4f, so the JS side fills a flat
// Float32Array and no padding rule applies.

struct Params {
  camPos   : vec4f, // xyz eye,              w time (s)
  camFwd   : vec4f, // xyz forward,          w tan(fov / 2)
  camRight : vec4f, // xyz right,            w frame index
  camUp    : vec4f, // xyz up,               w unused
  boxMin   : vec4f, // xyz cloud box min,    w voxel size (world)
  boxMax   : vec4f, // xyz cloud box max,    w SDF clamp (world)
  volRes   : vec4f, // xyz SDF volume res,   w largest axis
  litRes   : vec4f, // xyz light map res,    w AO on
  sun      : vec4f, // xyz dir to sun,       w sun intensity
  sunCol   : vec4f, // rgb sun colour,       w ambient
  march    : vec4f, // x max steps  y min step  z step growth  w iso
  march2   : vec4f, // x SDF skip   y SDF inside  z jitter  w fog density
  dens     : vec4f, // x density    y edge ramp   z light absorption  w light step
  ero      : vec4f, // x on         y intensity   z band  w texture scale
  ero2     : vec4f, // xyz wind,    w edge exponent
  phase    : vec4f, // x HG g       y bias        z scale  w powder on
  powder   : vec4f, // x powder k   y powder mix  z baked light  w live light steps
  viz      : vec4f, // x slice y    y heat max    z ground shadows  w shadow strength
  shape    : vec4f, // x preset     y coverage    z frequency  w seed
  shape2   : vec4f, // x octaves    y gain        z top exponent  w bottom exponent
  shape3   : vec4f, // x worley mix y AO intensity  z AO offset  w exposure
  misc     : vec4f, // x light erosion  y fog falloff  z soft shadows  w ground on
  misc2    : vec4f, // x warp       y erosion cells  z fog steps  w light max steps
  anim     : vec4f, // xyz shape noise offset (world), w warp phase
  anim2    : vec4f, // xyz lightning point (world),    w lightning energy
  anim3    : vec4f, // xyz boil layer scroll velocity, w boil mix
  anim4    : vec4f, // x lightning glow radius,        yzw unused
};

@group(0) @binding(0) var<uniform> P : Params;

// pcg3d (Jarzynski and Olano 2020). Three well-mixed words from three words.
fn pcg3(v0: vec3u) -> vec3u {
  var v = v0 * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> vec3u(16u);
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}

fn hash3(p: vec3i, seed: u32) -> vec3f {
  let h = pcg3(bitcast<vec3u>(p) + vec3u(seed * 747796405u, seed * 2891336453u, seed * 277803737u));
  return vec3f(h >> vec3u(8u)) / 16777216.0;
}

fn hash1(p: vec3i, seed: u32) -> f32 { return hash3(p, seed).x; }

// Value noise, quintic fade, range 0..1.
fn vnoise(p: vec3f, seed: u32) -> f32 {
  let i = vec3i(floor(p));
  let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let a = hash1(i + vec3i(0, 0, 0), seed);
  let b = hash1(i + vec3i(1, 0, 0), seed);
  let c = hash1(i + vec3i(0, 1, 0), seed);
  let d = hash1(i + vec3i(1, 1, 0), seed);
  let e = hash1(i + vec3i(0, 0, 1), seed);
  let g = hash1(i + vec3i(1, 0, 1), seed);
  let h = hash1(i + vec3i(0, 1, 1), seed);
  let k = hash1(i + vec3i(1, 1, 1), seed);
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y),
             mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z);
}

// Worley F1 distance. period > 0 wraps the cell lattice, so the result tiles
// with that many cells per unit of p.
fn worley(p: vec3f, period: i32, seed: u32) -> f32 {
  let c = vec3i(floor(p));
  let f = fract(p);
  var d = 1e9;
  for (var z = -1; z <= 1; z++) {
    for (var y = -1; y <= 1; y++) {
      for (var x = -1; x <= 1; x++) {
        let o = vec3i(x, y, z);
        var cc = c + o;
        if (period > 0) { cc = ((cc % vec3i(period)) + vec3i(period)) % vec3i(period); }
        let v = vec3f(o) + hash3(cc, seed) - f;
        d = min(d, dot(v, v));
      }
    }
  }
  return sqrt(d);
}
