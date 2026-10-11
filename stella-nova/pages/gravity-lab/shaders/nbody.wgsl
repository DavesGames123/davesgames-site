// ============================================================================
//  GRAVITY LAB  ·  shaders/nbody.wgsl — the particles on the GPU
// ----------------------------------------------------------------------------
//  One module, three entry points. engine.js gives each entry point its
//  own bind group layout with only the bindings it uses.
//
//  RESTRICTED MODE (cs_restricted). Test particles feel at most MAXB
//  bodies and do not pull back. The CPU (nbody.js System) moves the bodies
//  in f64 and writes S + 1 rows of their states (traj); one dispatch moves
//  every particle S kick-drift-kick steps against those rows, one thread
//  per particle, with no barrier. nbody.js CpuParticles is the f64
//  reference of the same arithmetic.
//    each step:  v += dt/2 a ; x += dt v ; hit test (row k+1) ;
//                a = a(x, row k+1) ; v += dt/2 a
//  A particle inside a body with the absorb flag ends: mass 0, parked at
//  P.park. Its spin row keeps the impact: xyz the point on the surface
//  relative to the body centre, w the sim time (the roche-limit convention:
//  a parked grain with spin.w > 0 is an impact flash). diag keeps the body
//  index + 1 and the impact speed; hits[j] counts the impacts on body j.
//
//  SELF-GRAVITY MODE. cs_gravity: the softened direct sum over all
//  particles in tiles of 256 in workgroup memory (acc xyz, potential w).
//  cs_kick: v += cF a, then x += dt v when K.drift is 1.
//
//  Buffers (one row per particle, np rows, padded rows have mass 0):
//    body   pos (xyz, draw radius) · vel (xyz, mass: 0 = gone) · spin
//           (impact point, impact time; 0 for a live particle)
//    diag   live: |a| · the index of the body with the strongest pull ·
//           0 · 0.   gone: |a| · body index · impact speed · body index + 1
//    traj   (S + 1) rows of MAXB bodies, 3 vec4 each: pos.xyz GM ·
//           vel.xyz R · eps absorb epsP 0
//
//  WGSL NOTE: no mixed * and ^, no mixed && and || without parentheses
//  (Tint rejects what naga allows).
//
//  grep -n targets: "fn cs_restricted", "fn accAt", "fn hitAt",
//  "fn cs_gravity", "fn cs_kick"
// ============================================================================

const MAXB: u32 = 32u;

struct Params {
  n: u32, S: u32, nb: u32, flags: u32,
  dt: f32, t0: f32, park: f32, p0: f32,
};
struct SelfP { n: u32, np: u32, e2: f32, p0: f32 };
struct Kick { cF: f32, dt: f32, drift: u32, p0: u32 };
struct Body { pos: vec4f, vel: vec4f, spin: vec4f };

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> traj: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> body: array<Body>;
@group(0) @binding(3) var<storage, read_write> diag: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> hits: array<atomic<u32>>;
@group(0) @binding(5) var<uniform> SP: SelfP;
@group(0) @binding(6) var<uniform> K: Kick;
@group(0) @binding(7) var<storage, read_write> acc: array<vec4f>;

// ── restricted mode ─────────────────────────────────────────────────────────
fn accAt(row: u32, x: vec3f) -> vec3f {
  var a = vec3f(0.0);
  let o0 = row * MAXB * 3u;
  for (var j = 0u; j < P.nb; j++) {
    let p = traj[o0 + 3u * j];
    if (p.w <= 0.0) { continue; }
    let e = traj[o0 + 3u * j + 2u];
    let d = p.xyz - x;
    let r2 = dot(d, d) + e.x * e.x + e.z * e.z;
    a = a + d * (p.w / (r2 * sqrt(r2)));
  }
  return a;
}
// the index of the first absorbing body that holds x, or -1
fn hitAt(row: u32, x: vec3f) -> i32 {
  let o0 = row * MAXB * 3u;
  for (var j = 0u; j < P.nb; j++) {
    let R = traj[o0 + 3u * j + 1u].w;
    let ab = traj[o0 + 3u * j + 2u].y;
    if (R <= 0.0 || ab <= 0.0) { continue; }
    let d = traj[o0 + 3u * j].xyz - x;
    if (dot(d, d) < R * R) { return i32(j); }
  }
  return -1;
}
// the body with the strongest pull on x (for the colour of a particle)
fn domAt(row: u32, x: vec3f) -> f32 {
  let o0 = row * MAXB * 3u;
  var best = 0.0;
  var bi = 0u;
  for (var j = 0u; j < P.nb; j++) {
    let p = traj[o0 + 3u * j];
    if (p.w <= 0.0) { continue; }
    let d = p.xyz - x;
    let g = p.w / max(dot(d, d), 1e-20);
    if (g > best) { best = g; bi = j; }
  }
  return f32(bi);
}

@compute @workgroup_size(64)
fn cs_restricted(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.n) { return; }
  let b = body[i];
  if (b.vel.w <= 0.0) { return; }
  var x = b.pos.xyz;
  var v = b.vel.xyz;
  let h = P.dt;
  var a = accAt(0u, x);
  for (var k = 0u; k < P.S; k++) {
    v = v + (0.5 * h) * a;
    x = x + h * v;
    let j = hitAt(k + 1u, x);
    if (j >= 0) {
      let o = (k + 1u) * MAXB * 3u + 3u * u32(j);
      let B = traj[o];
      let BV = traj[o + 1u];
      let n = normalize(x - B.xyz);
      let tHit = P.t0 + f32(k + 1u) * h;
      body[i] = Body(vec4f(P.park, P.park, P.park, b.pos.w), vec4f(0.0), vec4f(n * BV.w, max(tHit, 1e-6)));
      diag[i] = vec4f(length(a), f32(j), length(v - BV.xyz), f32(j) + 1.0);
      atomicAdd(&hits[u32(j)], 1u);
      return;
    }
    a = accAt(k + 1u, x);
    v = v + (0.5 * h) * a;
  }
  body[i] = Body(vec4f(x, b.pos.w), vec4f(v, b.vel.w), b.spin);
  diag[i] = vec4f(length(a), domAt(P.S, x), 0.0, 0.0);
}

// ── self-gravity mode ───────────────────────────────────────────────────────
var<workgroup> tile: array<vec4f, 256>;

@compute @workgroup_size(256)
fn cs_gravity(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_id) lid: vec3u) {
  let i = gid.x;
  var xi = vec3f(0.0);
  if (i < SP.n) { xi = body[i].pos.xyz; }
  var a = vec3f(0.0);
  var phi = 0.0;
  let tiles = SP.np / 256u;
  for (var t = 0u; t < tiles; t++) {
    let j = t * 256u + lid.x;
    var q = vec4f(0.0);
    if (j < SP.n) { let bj = body[j]; q = vec4f(bj.pos.xyz, bj.vel.w); }
    tile[lid.x] = q;
    workgroupBarrier();
    for (var k = 0u; k < 256u; k++) {
      let p = tile[k];
      let d = p.xyz - xi;
      let r2 = dot(d, d) + SP.e2;
      let ir = inverseSqrt(max(r2, 1e-30));
      // the self pair and the empty rows give 0, picked by select (the
      // unused value may be inf or NaN when e2 is 0)
      let skip = ((t * 256u + k) == i) || (p.w <= 0.0);
      a = a + select(d * (p.w * ir * ir * ir), vec3f(0.0), skip);
      phi = phi - select(p.w * ir, 0.0, skip);
    }
    workgroupBarrier();
  }
  if (i < SP.n) { acc[i] = vec4f(a, phi); }
}

@compute @workgroup_size(64)
fn cs_kick(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= SP.n) { return; }
  let b = body[i];
  let v = b.vel.xyz + K.cF * acc[i].xyz;
  var x = b.pos.xyz;
  if (K.drift != 0u) { x = x + K.dt * v; }
  body[i] = Body(vec4f(x, b.pos.w), vec4f(v, b.vel.w), b.spin);
}
