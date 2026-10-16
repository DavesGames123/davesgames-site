// THERMAL CONVECTION · shaders/sim-advect.wgsl — passes 1 and 2 of a step
// (sim/ref.js advect()): MacCormack advection of U, V, W, T and the explicit
// boundary sources. One thread per cell; each thread does the four fields
// at their own staggered points. Prepended by sim-common.wgsl.
//
// Listing (grep -n "^fn \|^@compute" sim-advect.wgsl):
//   rawv, fetch     field value with the boundary ghosts (ref.js fetch)
//   foff            staggered offsets of U, V, W, T in cells
//   sampleF         trilinear sample + the 8-corner min / max
//   traceP          RK2 trace in vel
//   advA            hat = SL(phi)                       (writes hat)
//   advB            clamped MacCormack + sources        (writes rhs)
//
// Buffers: uvw = U | V | W (3 n f32), Tf = T (n), hat and rhs = 4 n f32
// (field f at f * n).

@group(0) @binding(1) var<storage, read_write> uvw: array<f32>;
@group(0) @binding(2) var<storage, read_write> Tf: array<f32>;
@group(0) @binding(3) var<storage, read_write> hat: array<f32>;
@group(0) @binding(4) var<storage, read_write> rhs: array<f32>;

fn rawv(f: u32, src: u32, c: u32) -> f32 {
  if (src == 1u) { return hat[(f * prm.n) + c]; }
  if (f == 3u) { return Tf[c]; }
  return uvw[(f * prm.n) + c];
}

fn fetch(f: u32, src: u32, i: i32, j: i32, k: i32) -> f32 {
  let nz = i32(prm.nz);
  if (f == 2u) {
    if (k <= 0 || k >= nz) { return 0.0; }
    return rawv(f, src, cidx(i, j, k));
  }
  if (k < 0) {
    let v = rawv(f, src, cidx(i, j, 0));
    if (f == 3u) {
      if (prm.botNeumann == 1u) { return v; }
      return (2.0 * bottomT(i, j)) - v;
    }
    return -v;
  }
  if (k >= nz) {
    let v = rawv(f, src, cidx(i, j, nz - 1));
    if (f == 3u) { return topGhostT(v); }
    if (prm.topFree == 1u) { return v; }
    return -v;
  }
  return rawv(f, src, cidx(i, j, k));
}

fn foff(f: u32) -> vec3f {
  if (f == 0u) { return vec3f(0.0, 0.5, 0.5); }
  if (f == 1u) { return vec3f(0.5, 0.0, 0.5); }
  if (f == 2u) { return vec3f(0.5, 0.5, 0.0); }
  return vec3f(0.5, 0.5, 0.5);
}

struct Smp { v: f32, lo: f32, hi: f32 };

fn sampleF(f: u32, src: u32, p: vec3f) -> Smp {
  let nx = i32(prm.nx);
  let ny = i32(prm.ny);
  let g = (p / prm.dx) - foff(f);
  let fl = floor(g);
  let fr = g - fl;
  let i0 = wrapi(i32(fl.x), nx);
  let j0 = wrapi(i32(fl.y), ny);
  let i1 = select(i0 + 1, 0, i0 + 1 == nx);
  let j1 = select(j0 + 1, 0, j0 + 1 == ny);
  let k0 = i32(fl.z);
  let k1 = k0 + 1;
  let c000 = fetch(f, src, i0, j0, k0);
  let c100 = fetch(f, src, i1, j0, k0);
  let c010 = fetch(f, src, i0, j1, k0);
  let c110 = fetch(f, src, i1, j1, k0);
  let c001 = fetch(f, src, i0, j0, k1);
  let c101 = fetch(f, src, i1, j0, k1);
  let c011 = fetch(f, src, i0, j1, k1);
  let c111 = fetch(f, src, i1, j1, k1);
  var s: Smp;
  s.lo = min(min(min(c000, c100), min(c010, c110)), min(min(c001, c101), min(c011, c111)));
  s.hi = max(max(max(c000, c100), max(c010, c110)), max(max(c001, c101), max(c011, c111)));
  let a0 = mix(c000, c100, fr.x);
  let a1 = mix(c010, c110, fr.x);
  let b0 = mix(c001, c101, fr.x);
  let b1 = mix(c011, c111, fr.x);
  s.v = mix(mix(a0, a1, fr.y), mix(b0, b1, fr.y), fr.z);
  return s;
}

fn traceP(p: vec3f, h: f32) -> vec3f {
  let v1 = velAt(p);
  let v2 = velAt(p + ((0.5 * h) * v1));
  var q = p + (h * v2);
  q.z = clamp(q.z, 0.0, 1.0);
  return q;
}

fn cellOf(c: u32) -> vec3i {
  return vec3i(i32(c % prm.nx), i32((c / prm.nx) % prm.ny), i32(c / prm.nxy));
}

@compute @workgroup_size(64)
fn advA(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let c = gid.x + (gid.y * nwg.x * 64u);
  if (c >= prm.n) { return; }
  let q = cellOf(c);
  for (var f = 0u; f < 4u; f++) {
    if (f == 2u && q.z == 0) {
      hat[(2u * prm.n) + c] = 0.0;
      continue;
    }
    let p = (vec3f(q) + foff(f)) * prm.dx;
    let pd = traceP(p, -prm.dt);
    hat[(f * prm.n) + c] = sampleF(f, 0u, pd).v;
  }
}

@compute @workgroup_size(64)
fn advB(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let c = gid.x + (gid.y * nwg.x * 64u);
  if (c >= prm.n) { return; }
  let q = cellOf(c);
  let nz = i32(prm.nz);
  let dt = prm.dt;
  let dz2 = prm.dx * prm.dx;
  for (var f = 0u; f < 4u; f++) {
    if (f == 2u && q.z == 0) {
      rhs[(2u * prm.n) + c] = 0.0;
      continue;
    }
    let p = (vec3f(q) + foff(f)) * prm.dx;
    let s0 = sampleF(f, 0u, traceP(p, -dt));
    let s1 = sampleF(f, 1u, traceP(p, dt));
    var v = hat[(f * prm.n) + c] + (0.5 * (rawv(f, 0u, c) - s1.v));
    v = clamp(v, s0.lo, s0.hi);
    if (f < 2u && prm.maEff != 0.0 && q.z == nz - 1) {
      // Marangoni stress s = du/dz = -Ma_eff dT_s/dx at the top face
      var cm: u32;
      if (f == 0u) { cm = cidx(wrapi(q.x - 1, i32(prm.nx)), q.y, q.z); }
      else { cm = cidx(q.x, wrapi(q.y - 1, i32(prm.ny)), q.z); }
      let ts = 0.5 * (Tf[c] + topGhostT(Tf[c]));
      let tsm = 0.5 * (Tf[cm] + topGhostT(Tf[cm]));
      let st = (-prm.maEff * (ts - tsm)) / prm.dx;
      v = v + ((dt * prm.nu * st) / prm.dx);
    }
    if (f == 3u) {
      let ck = dt * prm.kappa;
      if (q.z == 0 && prm.botNeumann == 0u) { v = v + ((2.0 * ck * bottomT(q.x, q.y)) / dz2); }
      if (q.z == nz - 1 && prm.tRobin == 1u) { v = v + ((-ck * prm.hConst * prm.gTop) / dz2); }
      if (u32(q.z) < prm.nHeat) { v = v + (dt * prm.relax); }
    }
    rhs[(f * prm.n) + c] = v;
  }
}
