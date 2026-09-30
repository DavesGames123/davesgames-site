// shape.wgsl — stage 1 of the bake: write the cloud shape field.
//
// One thread per voxel of the SDF volume. The kernel writes a signed field f
// into fieldOut: f > 0 is cloud, f <= 0 is air. Only the sign and the zero
// crossing matter, because jfa.wgsl turns the crossings into a true signed
// distance. The upstream project gets this volume from a Worley generator or
// from a MagicaVoxel sculpt. The presets here stand in for both sources.
//
//   preset 0  cloudscape      tiling-style Worley billows, coverage mask
//   preset 1  cumulus field   scattered puffs with flat bases
//   preset 2  cumulus tower   one tall cell with an anvil top
//   preset 3  stratus sheet   thin broken layer
//   preset 4  voxel sculpt    blocky hand-made-style volume (MagicaVoxel stand-in)
//   preset 5  torus           analytic shape, to show that any volume works
//
// Motion: P.anim.xyz offsets the noise domain (drift + rise) and P.anim.w
// moves the warp phase (morph). The box masks use q and do not move, so a
// drifting cloudscape enters at one edge and fades at the other. The puff
// footprint takes only the horizontal offset, so puffs keep flat bases. The
// tower and the torus keep their geometry, and only their billow detail moves.

@group(0) @binding(1) var fieldOut : texture_storage_3d<r32float, write>;

fn seedU() -> u32 { return u32(P.shape.w); }

// Billow noise, 0..1, high inside a puff. Mixes inverted Worley and value
// noise per octave; P.shape3.x sets the Worley share.
fn billow(w: vec3f, seed: u32) -> f32 {
  var a = 1.0;
  var fr = P.shape.z;
  var sum = 0.0;
  var norm = 0.0;
  let oct = i32(P.shape2.x);
  for (var i = 0; i < 6; i++) {
    if (i >= oct) { break; }
    let s = seed + u32(i) * 101u;
    let wv = 1.0 - clamp(worley(w * fr, 0, s), 0.0, 1.0);
    let vv = vnoise(w * fr * 1.7, s + 53u);
    sum += a * mix(vv, wv, P.shape3.x);
    norm += a;
    a *= P.shape2.y;
    fr *= 2.0;
  }
  return sum / max(norm, 1e-4);
}

fn warp(w: vec3f, seed: u32) -> vec3f {
  let q = w * P.shape.z * 0.5 + vec3f(1.0, 0.61, -0.83) * P.anim.w;
  let o = vec3f(vnoise(q, seed + 7u), vnoise(q, seed + 19u), vnoise(q, seed + 31u)) - 0.5;
  return w + o * P.misc2.x * 2.0;
}

// Vertical profile over the box height h in 0..1. A high bottom exponent
// gives a flat base; a low top exponent gives a rounded top.
fn vertical(h: f32) -> f32 {
  return (1.0 - pow(h, P.shape2.z)) * (1.0 - pow(1.0 - h, P.shape2.w));
}

fn smin(a: f32, b: f32, k: f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

fn sdEllipsoid(p: vec3f, r: vec3f) -> f32 {
  let k0 = length(p / r);
  let k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-5);
}

// Distance-like field for the puff presets: negative inside.
fn puffs(w: vec3f, seed: u32) -> f32 {
  var d = 1e5;
  let cell = 3.0;
  let c0 = vec2i(floor(w.xz / cell));
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let c = c0 + vec2i(i, j);
      let h = hash3(vec3i(c.x, 0, c.y), seed);
      if (h.z > P.shape.y * 1.4) { continue; }
      let size = mix(0.6, 1.3, fract(h.z * 7.13)) * (0.6 + P.shape.y);
      let base = vec3f((vec2f(c) + 0.2 + 0.6 * h.xy) * cell, 0.0).xzy;
      let b = vec3f(base.x, P.boxMin.y + 0.35, base.z);
      // Five lobes per puff: a body and four shoulders.
      for (var k = 0; k < 5; k++) {
        let r = hash3(vec3i(c.x, k + 1, c.y), seed);
        let off = select(vec3f(r.x - 0.5, 0.0, r.z - 0.5) * 2.2 * size, vec3f(0.0), k == 0);
        let rad = size * select(mix(0.55, 0.85, r.y), 1.0, k == 0);
        let ctr = b + off + vec3f(0.0, rad * 0.75, 0.0);
        d = smin(d, length(w - ctr) - rad, 0.45 * size);
      }
    }
  }
  return d;
}

fn tower(w: vec3f) -> f32 {
  let s = 0.7 + P.shape.y;
  let p = w - vec3f(0.0, P.boxMin.y, 0.0);
  var d = sdEllipsoid(p - vec3f(0.0, 0.7, 0.0), vec3f(2.4, 0.8, 2.1) * s);
  d = smin(d, sdEllipsoid(p - vec3f(0.2, 1.4, -0.1), vec3f(1.5, 1.0, 1.4) * s), 0.5);
  d = smin(d, sdEllipsoid(p - vec3f(-0.1, 2.1, 0.1), vec3f(1.1, 0.8, 1.0) * s), 0.5);
  d = smin(d, sdEllipsoid(p - vec3f(0.5, 2.6, 0.0), vec3f(2.9, 0.25, 2.2) * s), 0.6);
  return max(d, P.boxMin.y + 0.1 - w.y);
}

fn torusField(w: vec3f) -> f32 {
  let c = vec3f(0.0, (P.boxMin.y + P.boxMax.y) * 0.5, 0.0);
  let p = w - c;
  let a = 0.35;
  let q = vec3f(p.x, p.y * cos(a) - p.z * sin(a), p.y * sin(a) + p.z * cos(a));
  let R = 2.2 + 1.6 * P.shape.y;
  let r = 0.45 + 0.4 * P.shape.y;
  return length(vec2f(length(q.xz) - R, q.y)) - r;
}

fn shapeField(q: vec3f, w0: vec3f) -> f32 {
  let seed = seedU();
  let preset = i32(P.shape.x);
  let off = P.anim.xyz;
  let w = warp(w0 - off, seed);
  let edge = smoothstep(0.0, 0.08, min(q.x, 1.0 - q.x)) * smoothstep(0.0, 0.08, min(q.z, 1.0 - q.z));
  // Round footprint for the layer presets, so the square box edge never shows.
  let disc = 1.0 - smoothstep(0.6, 1.0, length(q.xz - 0.5) * 2.0);
  if (preset == 0) {
    let mask = smoothstep(0.15, 0.85, vnoise(vec3f(w.x, 0.0, w.z) * 0.28, seed + 3u));
    let raw = billow(w, seed) * vertical(q.y) * mix(1.0, mask * 1.5, 0.4) * disc;
    return raw - (1.0 - P.shape.y) * 0.55;
  }
  if (preset == 1 || preset == 2) {
    var d: f32;
    if (preset == 1) { d = puffs(warp(w0 - vec3f(off.x, 0.0, off.z), seed), seed); }
    else { d = tower(warp(w0, seed)); }
    d += (0.5 - billow(w, seed)) * 0.9;
    return -d - (1.0 - edge) * 2.0;
  }
  if (preset == 3) {
    let hh = abs(q.y - 0.3) / 0.16;
    let raw = billow(w * vec3f(1.0, 2.5, 1.0), seed) * (1.0 - hh * hh) * disc;
    return raw - (1.0 - P.shape.y) * 0.6;
  }
  if (preset == 4) {
    // Blocky volume: 0.5-unit cells inside an ellipsoid envelope. A cell is
    // on or off, so the field is +-0.5 and the crossing sits halfway.
    let cellI = vec3i(floor(w0 / 0.5));
    let cc = (vec3f(cellI) + 0.5) * 0.5;
    let env = sdEllipsoid(cc - vec3f(0.0, 2.4, 0.0), vec3f(4.5, 1.2, 3.6));
    let n = vnoise((cc - off) * 0.6, seed);
    let on = env + (n - 0.5) * 2.2 < -0.2 + P.shape.y && hash1(cellI, seed) < 0.97;
    return select(-0.5, 0.5, on && edge > 0.5);
  }
  var d = torusField(w0);
  d += (0.5 - billow(w, seed)) * 0.6;
  return -d;
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let res = vec3u(P.volRes.xyz);
  if (any(id >= res)) { return; }
  let q = (vec3f(id) + 0.5) / vec3f(res);
  let w = mix(P.boxMin.xyz, P.boxMax.xyz, q);
  var f = shapeField(q, w);
  // The outer voxel shell stays air, so every surface closes inside the box.
  if (any(id == vec3u(0u)) || any(id == res - 1u)) { f = min(f, -0.01); }
  textureStore(fieldOut, id, vec4f(f, 0.0, 0.0, 0.0));
}
