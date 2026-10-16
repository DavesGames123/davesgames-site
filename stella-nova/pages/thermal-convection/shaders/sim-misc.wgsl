// THERMAL CONVECTION · shaders/sim-misc.wgsl — passes 6 and 7 of a step
// (sim/ref.js tracerStep, computeVel) and the stats reduction (ref.js
// stats). Prepended by sim-common.wgsl.
//
// Listing (grep -n "^fn \|^@compute" sim-misc.wgsl):
//   velPass      vel = cell-centred mean of the face velocities   1 thread / cell
//   tracerStep   RK2 in vel, age, respawn (pcg hash)              1 thread / tracer
//   statsA       one thread per column, workgroup partial records 64 columns / group
//   statsB       one workgroup of 256 sums the partials into out[0..12)
//
// Stats record (12 f32): 0 sum |u|^2, 1 sum T, 2 sum bottom flux (Tb - T0) 2 / dz,
// 3 max |u|^2, 4 top T max, 5 its column, 6 top T min, 7 its column,
// 8 max w at k = nz / 2, 9 its column, 10 sum (1 - T) in the heat zone,
// 11 sum top-layer T. Columns are i + nx j, stored as f32 (exact below 2^24).

@group(0) @binding(1) var<storage, read_write> uvw: array<f32>;
@group(0) @binding(2) var<storage, read_write> Tf: array<f32>;
@group(0) @binding(8) var<storage, read_write> tracers: array<vec4f>;
@group(0) @binding(9) var<storage, read_write> partials: array<f32>;
@group(0) @binding(10) var<storage, read_write> statsOut: array<f32>;

const NREC: u32 = 12u;
var<workgroup> red: array<array<f32, 12>, 256>;

@compute @workgroup_size(64)
fn velPass(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let c = gid.x + (gid.y * nwg.x * 64u);
  if (c >= prm.n) { return; }
  let i = c % prm.nx;
  let j = (c / prm.nx) % prm.ny;
  let k = c / prm.nxy;
  let ci = c - i + select(i + 1u, 0u, i + 1u == prm.nx);
  let cj = c + (select(j + 1u, 0u, j + 1u == prm.ny) * prm.nx) - (j * prm.nx);
  var wUp = 0.0;
  if (k + 1u < prm.nz) { wUp = uvw[(2u * prm.n) + c + prm.nxy]; }
  let u = 0.5 * (uvw[c] + uvw[ci]);
  let v = 0.5 * (uvw[prm.n + c] + uvw[prm.n + cj]);
  let w = 0.5 * (uvw[(2u * prm.n) + c] + wUp);
  vel[c] = vec4f(u, v, w, 0.0);
}

@compute @workgroup_size(64)
fn tracerStep(@builtin(global_invocation_id) gid: vec3u) {
  let t = gid.x;
  if (t >= prm.tracerCount) { return; }
  let q = tracers[t];
  let dt = prm.dt;
  let v1 = velAt(q.xyz);
  let v2 = velAt(q.xyz + ((0.5 * dt) * v1));
  var p = q.xyz + (dt * v2);
  let age = q.w + dt;
  p.x = p.x - (prm.Lx * floor(p.x / prm.Lx));
  p.y = p.y - (prm.Ly * floor(p.y / prm.Ly));
  let life = prm.life * (0.6 + (0.4 * u01(pcg(t ^ prm.seed))));
  if (p.z < 0.0 || p.z > 1.0 || age > life) {
    var h = pcg(t + pcg(prm.frame ^ prm.seed));
    let x = u01(h) * prm.Lx;
    h = pcg(h);
    let y = u01(h) * prm.Ly;
    h = pcg(h);
    tracers[t] = vec4f(x, y, u01(h), 0.0);
  } else {
    tracers[t] = vec4f(p, age);
  }
}

fn neutral() -> array<f32, 12> {
  return array<f32, 12>(0.0, 0.0, 0.0, 0.0, -1e30, 0.0, 1e30, 0.0, -1e30, 0.0, 0.0, 0.0);
}

fn comb(a: array<f32, 12>, b: array<f32, 12>) -> array<f32, 12> {
  var r = a;
  r[0] = a[0] + b[0];
  r[1] = a[1] + b[1];
  r[2] = a[2] + b[2];
  r[3] = max(a[3], b[3]);
  if (b[4] > a[4]) { r[4] = b[4]; r[5] = b[5]; }
  if (b[6] < a[6]) { r[6] = b[6]; r[7] = b[7]; }
  if (b[8] > a[8]) { r[8] = b[8]; r[9] = b[9]; }
  r[10] = a[10] + b[10];
  r[11] = a[11] + b[11];
  return r;
}

@compute @workgroup_size(64)
fn statsA(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) lid: u32, @builtin(workgroup_id) wid: vec3u) {
  let col = gid.x;
  var r = neutral();
  if (col < prm.nxy) {
    let i = i32(col % prm.nx);
    let j = i32(col / prm.nx);
    for (var k = 0u; k < prm.nz; k++) {
      let c = col + (prm.nxy * k);
      let v = vel[c].xyz;
      let q = dot(v, v);
      let t = Tf[c];
      r[0] = r[0] + q;
      r[1] = r[1] + t;
      r[3] = max(r[3], q);
      if (k < prm.nHeat) { r[10] = r[10] + (1.0 - t); }
    }
    r[2] = ((bottomT(i, j) - Tf[col]) * 2.0) / prm.dx;
    let tt = Tf[col + (prm.nxy * (prm.nz - 1u))];
    r[4] = tt;
    r[5] = f32(col);
    r[6] = tt;
    r[7] = f32(col);
    r[8] = vel[col + (prm.nxy * prm.kMid)].z;
    r[9] = f32(col);
    r[11] = tt;
  }
  red[lid] = r;
  workgroupBarrier();
  for (var s = 32u; s > 0u; s = s >> 1u) {
    if (lid < s) { red[lid] = comb(red[lid], red[lid + s]); }
    workgroupBarrier();
  }
  if (lid == 0u) {
    let o = wid.x * NREC;
    for (var q = 0u; q < NREC; q++) { partials[o + q] = red[0][q]; }
  }
}

@compute @workgroup_size(256)
fn statsB(@builtin(local_invocation_index) lid: u32) {
  let np = (prm.nxy + 63u) / 64u;
  var r = neutral();
  for (var p = lid; p < np; p += 256u) {
    var b: array<f32, 12>;
    for (var q = 0u; q < NREC; q++) { b[q] = partials[(p * NREC) + q]; }
    r = comb(r, b);
  }
  red[lid] = r;
  workgroupBarrier();
  for (var s = 128u; s > 0u; s = s >> 1u) {
    if (lid < s) { red[lid] = comb(red[lid], red[lid + s]); }
    workgroupBarrier();
  }
  if (lid == 0u) {
    for (var q = 0u; q < NREC; q++) { statsOut[q] = red[0][q]; }
    statsOut[12] = f32(prm.frame);
  }
}
