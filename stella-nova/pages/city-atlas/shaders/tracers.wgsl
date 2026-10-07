// tracers.wgsl — moving streak lines for the ocean and wind overlays
// (common.wgsl in front).
//
// A tracer is a particle with a trail of K points in a ring. tracers.js
// moves the ring head about 60 times a second; between moves the newest
// point slides with its particle. Particles with index < T.nInner live in
// the inner region (a square of half T.innerR), the rest in the outer square
// of half T.outerR. A particle that leaves its region, reaches a wall or
// land, or ends its life is born again at a random place in its region,
// with all its trail points on that place (they draw with zero alpha).
//
//   ocean (T.mode 0): u = oceanAt(p). The screen step is compressed:
//         |step| = T.speedup * u_ref * (|u| / u_ref)^0.6, so slow water still
//         moves. u_ref = T.colourTop.
//   wind  (T.mode 1): u = windAt(p), the lattice field. The screen step is
//         linear in speed (|step| = T.speedup * |u|), so the channels and
//         the wakes keep their real speed ratios.
//
// lines.wgsl draws the trails.
//
// grep: struct TrailU  fn fieldAt  fn spawn  fn advect

struct TrailU {
  count: u32, K: u32, head: u32, seed: u32,
  dt: f32, mode: u32, nInner: u32, reseed: u32,
  speedup: f32, lift: f32, lineW: f32, alpha: f32,
  innerR: f32, outerR: f32, colourTop: f32, lifeS: f32,
};

@group(2) @binding(0) var<uniform> T: TrailU;
@group(2) @binding(1) var<storage, read_write> parts: array<vec4f>;   // x, y, age s, life s
@group(2) @binding(2) var<storage, read_write> trail: array<vec4f>;   // x, y, surface height m, speed m/s (-1: not born)

// Velocity (m/s) and a usable flag at p.
fn fieldAt(p: vec2f) -> vec3f {
  if (T.mode == 0u) {
    if (max(abs(p.x), abs(p.y)) > G.grid.y * 0.98) { return vec3f(0.0); }
    if (waterAt(p) < 0.55) { return vec3f(0.0); }
    return vec3f(oceanAt(p), 1.0);
  }
  let w = windAt(p);
  if (w.w < 0.5 || w.z > 0.3) { return vec3f(0.0); }
  return vec3f(w.xy, 1.0);
}

fn rand2(i: u32, k: u32) -> vec2f {
  return vec2f(hash11(i * 7919u + k * 104729u + T.seed), hash11(i * 15485863u + k * 32452843u + T.seed * 3u));
}

fn spawn(i: u32) -> vec2f {
  let r = select(T.outerR, T.innerR, i < T.nInner);
  var p = vec2f(0.0);
  for (var k = 0u; k < 8u; k++) {
    p = (rand2(i, k) * 2.0 - 1.0) * r;
    // the outer group avoids the inner square, where the inner group lives
    if (i >= T.nInner && max(abs(p.x), abs(p.y)) < T.innerR) { continue; }
    if (fieldAt(p).z > 0.5) { break; }
  }
  return p;
}

fn stepOf(u: vec2f) -> vec2f {
  let s = length(u);
  if (s < 1e-5) { return vec2f(0.0); }
  if (T.mode == 0u) {
    let uref = max(T.colourTop, 0.05);
    return u / s * T.speedup * uref * pow(s / uref, 0.6);
  }
  return u * T.speedup;
}

@compute @workgroup_size(64)
fn advect(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= T.count) { return; }
  var q = parts[i];
  var born = T.reseed == 1u || q.z > q.w;
  var speed = 0.0;
  if (!born) {
    let f0 = fieldAt(q.xy);
    if (f0.z < 0.5) {
      born = true;
    } else {
      let mid = q.xy + 0.5 * T.dt * stepOf(f0.xy);
      let f1 = fieldAt(mid);
      let v = select(f0.xy, f1.xy, f1.z > 0.5);
      q = vec4f(q.xy + T.dt * stepOf(v), q.z + T.dt, q.w);
      speed = length(v);
      let r = select(T.outerR, T.innerR, i < T.nInner);
      if (max(abs(q.x), abs(q.y)) > r) { born = true; }
    }
  }
  let base = i * T.K;
  if (born) {
    let p = spawn(i);
    let life = T.lifeS * (0.6 + 0.8 * hash11(i * 31u + T.seed * 7u));
    // a reseed spreads the ages, so the first lives do not all end together
    let age = select(0.0, hash11(i * 13u + T.seed) * life, T.reseed == 1u);
    parts[i] = vec4f(p, age, life);
    for (var k = 0u; k < T.K; k++) { trail[base + k] = vec4f(p, 0.0, -1.0); }
    return;
  }
  parts[i] = q;
  // the surface height goes with the point (not exaggerated), so lines.wgsl
  // needs no height lookup per vertex
  trail[base + T.head] = vec4f(q.xy, heightAt(q.xy).y, speed);
}
