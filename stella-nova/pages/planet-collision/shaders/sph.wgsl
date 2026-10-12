// ============================================================================
//  PLANET COLLISION  ·  shaders/sph.wgsl — the SPH impact solver on the GPU
// ----------------------------------------------------------------------------
//  One module, many entry points. engine.js gives each entry point a bind
//  group layout with only the bindings it uses (8 storage buffers or
//  fewer). sph.js (class CpuSPH) is the f64 reference of the same
//  arithmetic, step by step; tests.mjs checks the two against each other.
//
//  One step (engine.js "_encodeStep"):
//    cs_kickDrift
//    cs_gridClear, cs_gridCount, cs_scanLocal, cs_scanBlocks, cs_scanAdd,
//    cs_gridScatter, cs_reorder          (a counting sort into hashed cells,
//                                         then copies in bucket order)
//    cs_gravity                          (every KG steps; direct sum;
//                                         cs_gravitySelf in the relax)
//    cs_density                          (rho, Balsara, EOS, T, hNext)
//    cs_forces                           (pressure, viscosity, du, CFL)
//    cs_kick2                            (+ gravity, the second half kick)
//    cs_dtUpdate                         (one thread: t, the next dt)
//  cs_boost gives the bodies their velocity and spin after the relax.
//  cs_statsClear + cs_stats fill the counters in ctl for the page.
//  cs_density and cs_forces run in bucket order: invocation k is particle
//  sorted[k], and the neighbour loops read the sorted copies sA, sB, sC,
//  thS, so a bucket is one run of memory.
//
//  Buffers (one row per particle, np rows, padding rows have mass 0):
//    pos   x y z h          vel   vx vy vz m       pred  vpx vpy vpz u_pred
//    th    rho P c balsara  aux   T hNext nOther xv acc   ax ay az du
//    grav  2 rows: g phi, then gp phip (the sum before)
//    uu    u                tag   material | body << 4
//    hashes, sorted (u32 per particle); count, cursor (atomic, H);
//    range (start, count per bucket, H); blocks (block sums, H / 256)
//    sA, sB, sC, thS        bucket-order copies (x h; v_pred m; tag u_pred;
//                           rho P c balsara)
//    ctl   the step state and the stats counters (struct Ctl)
//
//  Precedence: every mix of * with ^, or of && with ||, has parentheses
//  (Chrome's Tint rejects WGSL that naga accepts).
//
//  grep -n targets: "fn tillotson", "fn soundSpeed", "fn uCold", "fn cs_kickDrift",
//  "fn cs_gravity", "fn cs_density", "fn cs_forces", "fn cs_kick2", "fn cs_dtUpdate",
//  "fn cs_scanLocal", "fn cs_reorder", "fn gsum", "fn cellHash", "fn cs_stats", "fn cs_boost"
// ============================================================================

const WN: f32 = 3.3422538049298023;   // 21 / (2 pi), Wendland C2 in 3D
const F_RELAX: u32 = 1u;
const F_SELF: u32 = 2u;
const DT_INF: u32 = 0x7f7fffffu;

struct Mat { r0: vec4f, r1: vec4f, r2: vec4f, r3: vec4f };
// r0: rho0 A B E0   r1: Eiv Ecv a b   r2: alpha beta kT cmin2   r3: Tmelt
struct BodyRow { X: vec4f, V: vec4f, W: vec4f };
struct Params {
  n: u32, np: u32, hmask: u32, flags: u32,
  cell: f32, hmin: f32, hmax: f32, etaH: f32,
  alpha: f32, beta: f32, cfl: f32, cacc: f32,
  eps2: f32, dtMax: f32, damp: f32, T0: f32,
  dtMin: f32, growth: f32, nblk: u32, epsInv: f32,
  mats: array<Mat, 4>,
  bodies: array<BodyRow, 4>,
};
struct Ctl {
  t: f32, dt: f32, tg: f32, tgp: f32,
  dtBits: atomic<u32>, steps: u32, p0: u32, p1: u32,
  maxT: atomic<u32>, maxP: atomic<u32>, maxV: atomic<u32>, touching: atomic<u32>,
  melt: atomic<u32>, vapour: atomic<u32>, p2: u32, p3: u32,
  unbound: array<atomic<u32>, 4>,
  count: array<atomic<u32>, 4>,
  sx: array<atomic<i32>, 4>,
  sy: array<atomic<i32>, 4>,
  sz: array<atomic<i32>, 4>,
};

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> ctl: Ctl;
@group(0) @binding(2) var<storage, read_write> pos: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> vel: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> pred: array<vec4f>;
@group(0) @binding(5) var<storage, read_write> th: array<vec4f>;
@group(0) @binding(6) var<storage, read_write> aux: array<vec4f>;
@group(0) @binding(7) var<storage, read_write> acc: array<vec4f>;
@group(0) @binding(8) var<storage, read_write> grav: array<vec4f>;
@group(0) @binding(9) var<storage, read_write> uu: array<f32>;
@group(0) @binding(10) var<storage, read_write> tag: array<u32>;
@group(0) @binding(11) var<storage, read_write> hashes: array<u32>;
@group(0) @binding(12) var<storage, read_write> count: array<atomic<u32>>;
@group(0) @binding(13) var<storage, read_write> range: array<vec2u>;
@group(0) @binding(14) var<storage, read_write> cursor: array<atomic<u32>>;
@group(0) @binding(15) var<storage, read_write> blocks: array<u32>;
@group(0) @binding(16) var<storage, read_write> sorted: array<u32>;
@group(0) @binding(17) var<storage, read_write> sA: array<vec4f>;   // sorted: x y z h
@group(0) @binding(18) var<storage, read_write> sB: array<vec4f>;   // sorted: vpx vpy vpz m
@group(0) @binding(19) var<storage, read_write> sC: array<vec2u>;   // sorted: tag, bits of u_pred
@group(0) @binding(20) var<storage, read_write> thS: array<vec4f>;  // sorted: rho P c balsara

// ── equation of state (eos.js has the same arithmetic in f64) ──────────────
fn tillotson(m: Mat, rho: f32, u: f32) -> f32 {
  let rho0 = m.r0.x; let A = m.r0.y; let B = m.r0.z; let E0 = m.r0.w;
  let Eiv = m.r1.x; let Ecv = m.r1.y; let a = m.r1.z; let b = m.r1.w;
  let eta = max(rho / rho0, 1e-6);
  let mu = eta - 1.0;
  let w = u / (E0 * eta * eta) + 1.0;
  let Pc = (a + b / w) * rho * u + A * mu + B * mu * mu;
  var p = Pc;
  if (eta < 1.0 && u > Eiv) {
    let x = 1.0 / eta - 1.0;
    let Pe = a * rho * u + (b * rho * u / w + A * mu * exp(-m.r2.y * x)) * exp(-m.r2.x * x * x);
    if (u >= Ecv) { p = Pe; } else { p = ((u - Eiv) * Pe + (Ecv - u) * Pc) / (Ecv - Eiv); }
  }
  return max(p, 0.0);
}
fn soundSpeed(m: Mat, rho: f32, u: f32, p: f32) -> f32 {
  let d = 1e-3 * rho;
  let du = p / (rho * rho) * d;
  let c2 = (tillotson(m, rho + d, u + du) - p) / d;
  return sqrt(max(c2, m.r2.w));
}
fn uCold(m: Mat, eta: f32) -> f32 {
  if (eta <= 1.0) { return 0.0; }
  let l = log(eta);
  return (m.r0.y * (l + 1.0 / eta - 1.0) + m.r0.z * (eta - 2.0 * l - 1.0 / eta)) / m.r0.x;
}

// ── kernel: Wendland C2, support H = 2h ─────────────────────────────────────
fn Wk(r: f32, h: f32) -> f32 {
  let H = 2.0 * h; let q = r / H;
  if (q >= 1.0) { return 0.0; }
  let a = 1.0 - q; let a2 = a * a;
  return WN / (H * H * H) * (a2 * a2) * (1.0 + 4.0 * q);
}
fn dWk(r: f32, h: f32) -> f32 {
  let H = 2.0 * h; let q = r / H;
  if (q >= 1.0) { return 0.0; }
  let a = 1.0 - q;
  return WN / (H * H * H * H) * (-20.0 * q * (a * a * a));
}

// ── 1 kick and drift ───────────────────────────────────────────────────────
@compute @workgroup_size(64)
fn cs_kickDrift(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.n) { return; }
  let dt = ctl.dt;
  let a = acc[i];
  let v = vel[i];
  let vh = v.xyz + 0.5 * dt * a.xyz;
  let uh = max(0.0, uu[i] + 0.5 * dt * a.w);
  let hN = aux[i].y;
  pos[i] = vec4f(pos[i].xyz + dt * vh, hN);
  vel[i] = vec4f(vh, v.w);
  uu[i] = uh;
  pred[i] = vec4f(vh + 0.5 * dt * a.xyz, max(0.0, uh + 0.5 * dt * a.w));
}

// ── 2 the grid: hash, count, scan, scatter ─────────────────────────────────
fn cellOf(x: vec3f) -> vec3i { return vec3i(floor(x / P.cell)); }
fn cellHash(c: vec3i) -> u32 {
  var h = (bitcast<u32>(c.x) * 73856093u) ^ (bitcast<u32>(c.y) * 19349663u) ^ (bitcast<u32>(c.z) * 83492791u);
  h = h ^ (h >> 16u);
  h = h * 0x7feb352du;
  h = h ^ (h >> 15u);
  h = h * 0x846ca68bu;
  h = h ^ (h >> 16u);
  return h & P.hmask;
}
@compute @workgroup_size(256)
fn cs_gridClear(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x > P.hmask) { return; }
  atomicStore(&count[gid.x], 0u);
}
@compute @workgroup_size(64)
fn cs_gridCount(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.n) { return; }
  let h = cellHash(cellOf(pos[i].xyz));
  hashes[i] = h;
  atomicAdd(&count[h], 1u);
}
var<workgroup> sh: array<u32, 256>;
// exclusive scan of each block of 256 buckets; block totals to blocks[]
@compute @workgroup_size(256)
fn cs_scanLocal(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wid: vec3u) {
  let i = gid.x;
  let c = atomicLoad(&count[i]);
  sh[li] = c;
  workgroupBarrier();
  for (var off = 1u; off < 256u; off = off << 1u) {
    var t = 0u;
    if (li >= off) { t = sh[li - off]; }
    workgroupBarrier();
    sh[li] = sh[li] + t;
    workgroupBarrier();
  }
  range[i] = vec2u(sh[li] - c, c);
  if (li == 255u) { blocks[wid.x] = sh[255]; }
}
// exclusive scan of the block totals (at most 1024 blocks: 4 per thread)
@compute @workgroup_size(256)
fn cs_scanBlocks(@builtin(local_invocation_index) li: u32) {
  let k0 = li * 4u;
  var v: array<u32, 4>;
  var s = 0u;
  for (var k = 0u; k < 4u; k++) {
    var x = 0u;
    if (k0 + k < P.nblk) { x = blocks[k0 + k]; }
    v[k] = x; s += x;
  }
  sh[li] = s;
  workgroupBarrier();
  for (var off = 1u; off < 256u; off = off << 1u) {
    var t = 0u;
    if (li >= off) { t = sh[li - off]; }
    workgroupBarrier();
    sh[li] = sh[li] + t;
    workgroupBarrier();
  }
  var run = sh[li] - s;
  for (var k = 0u; k < 4u; k++) {
    if (k0 + k < P.nblk) { blocks[k0 + k] = run; }
    run += v[k];
  }
}
@compute @workgroup_size(256)
fn cs_scanAdd(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i > P.hmask) { return; }
  let r = range[i];
  let s = r.x + blocks[i / 256u];
  range[i] = vec2u(s, r.y);
  atomicStore(&cursor[i], s);
}
@compute @workgroup_size(64)
fn cs_gridScatter(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.n) { return; }
  let slot = atomicAdd(&cursor[hashes[i]], 1u);
  sorted[slot] = i;
}
// copies in bucket order: the neighbour loops read memory in runs
@compute @workgroup_size(64)
fn cs_reorder(@builtin(global_invocation_id) gid: vec3u) {
  let k = gid.x;
  if (k >= P.n) { return; }
  let i = sorted[k];
  let p = pred[i];
  sA[k] = pos[i];
  sB[k] = vec4f(p.xyz, vel[i].w);
  sC[k] = vec2u(tag[i], bitcast<u32>(p.w));
}

// ── 3 gravity: direct sum in tiles of 256, Plummer softening ───────────────
// Each invocation sums for two particles, i0 and i0 + 128 (one tile read
// serves two pairs). cs_gravitySelf: only the particle's own body (relax).
var<workgroup> tileP: array<vec4f, 256>;
var<workgroup> tileB: array<u32, 256>;
fn gsum(wid: u32, li: u32, selfOnly: bool) {
  let i0 = wid * 256u + li;
  let i1 = i0 + 128u;
  let x0 = pos[i0].xyz; let x1 = pos[i1].xyz;
  let b0 = (tag[i0] >> 4u) & 15u; let b1 = (tag[i1] >> 4u) & 15u;
  var g0 = vec3f(0.0); var g1 = vec3f(0.0);
  var p0 = 0.0; var p1 = 0.0;
  for (var base = 0u; base < P.np; base += 256u) {
    let ja = base + li; let jb = ja + 128u;
    tileP[li] = vec4f(pos[ja].xyz, vel[ja].w);
    tileP[li + 128u] = vec4f(pos[jb].xyz, vel[jb].w);
    tileB[li] = (tag[ja] >> 4u) & 15u;
    tileB[li + 128u] = (tag[jb] >> 4u) & 15u;
    workgroupBarrier();
    for (var k = 0u; k < 256u; k++) {
      let pj = tileP[k];
      var m0 = pj.w; var m1 = pj.w;
      if (selfOnly) {
        if (tileB[k] != b0) { m0 = 0.0; }
        if (tileB[k] != b1) { m1 = 0.0; }
      }
      let d0 = pj.xyz - x0;
      let r0 = inverseSqrt(dot(d0, d0) + P.eps2);
      g0 += (m0 * r0 * r0 * r0) * d0; p0 -= m0 * r0;
      let d1 = pj.xyz - x1;
      let r1 = inverseSqrt(dot(d1, d1) + P.eps2);
      g1 += (m1 * r1 * r1 * r1) * d1; p1 -= m1 * r1;
    }
    workgroupBarrier();
  }
  if (i0 < P.n) {
    grav[2u * i0 + 1u] = grav[2u * i0];
    grav[2u * i0] = vec4f(g0, p0 + vel[i0].w * P.epsInv);
  }
  if (i1 < P.n) {
    grav[2u * i1 + 1u] = grav[2u * i1];
    grav[2u * i1] = vec4f(g1, p1 + vel[i1].w * P.epsInv);
  }
  if (i0 == 0u) { ctl.tgp = ctl.tg; ctl.tg = ctl.t + ctl.dt; }
}
@compute @workgroup_size(128)
fn cs_gravity(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) li: u32) { gsum(wid.x, li, false); }
@compute @workgroup_size(128)
fn cs_gravitySelf(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) li: u32) { gsum(wid.x, li, true); }

// ── 4 density, Balsara switch, EOS ─────────────────────────────────────────
// Invocation k is the k-th particle in bucket order (i = sorted[k]).
@compute @workgroup_size(64)
fn cs_density(@builtin(global_invocation_id) gid: vec3u) {
  let k0 = gid.x;
  if (k0 >= P.n) { return; }
  let i = sorted[k0];
  let pi = sA[k0];
  let xi = pi.xyz; let hi = pi.w; let H2 = 4.0 * hi * hi;
  let vi = sB[k0];
  let ti = sC[k0];
  let bi = (ti.x >> 4u) & 15u;
  let ci = cellOf(xi);
  var rho = 0.0; var dv = 0.0; var curl = vec3f(0.0); var nO = 0.0;
  for (var dz = -1; dz <= 1; dz++) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let c = ci + vec3i(dx, dy, dz);
        let r = range[cellHash(c)];
        for (var k = r.x; k < r.x + r.y; k++) {
          let pj = sA[k];
          if (any(cellOf(pj.xyz) != c)) { continue; }
          let d = xi - pj.xyz;
          let r2 = dot(d, d);
          if (r2 >= H2) { continue; }
          let rr = sqrt(r2);
          let bj = sB[k];
          rho += bj.w * Wk(rr, hi);
          if (((sC[k].x >> 4u) & 15u) != bi) { nO += 1.0; }
          if (rr > 0.0) {
            let kk = bj.w * dWk(rr, hi) / rr;
            let vv = bj.xyz - vi.xyz;
            dv += kk * dot(vv, d);
            curl += kk * cross(vv, d);
          }
        }
      }
    }
  }
  let M = P.mats[ti.x & 15u];
  let u = bitcast<f32>(ti.y);
  let p = tillotson(M, rho, u);
  let c = soundSpeed(M, rho, u, p);
  let dvA = abs(dv / rho);
  let cu = length(curl) / rho;
  let t4 = vec4f(rho, p, c, dvA / (dvA + cu + 1e-4 * c / hi));
  th[i] = t4;
  thS[k0] = t4;
  let T = P.T0 + max(0.0, u - uCold(M, rho / M.r0.x)) * M.r2.z;
  var xv = 0.0;
  if (rho < M.r0.x) { xv = clamp((u - M.r1.x) / (M.r1.y - M.r1.x), 0.0, 1.0); }
  let hN = clamp(P.etaH * pow(vi.w / rho, 1.0 / 3.0), P.hmin, P.hmax);
  aux[i] = vec4f(T, hN, nO, xv);
}

// ── 5 pressure force, viscosity, energy equation, CFL ──────────────────────
@compute @workgroup_size(64)
fn cs_forces(@builtin(global_invocation_id) gid: vec3u) {
  let k0 = gid.x;
  if (k0 >= P.n) { return; }
  let i = sorted[k0];
  let pi = sA[k0];
  let xi = pi.xyz; let hi = pi.w;
  let vi = sB[k0].xyz;
  let ti = thS[k0];
  let Ai = ti.y / (ti.x * ti.x);
  let ci = ti.z;
  let cc = cellOf(xi);
  var a = vec3f(0.0); var du = 0.0; var vs = 2.0 * ci;
  for (var dz = -1; dz <= 1; dz++) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let c = cc + vec3i(dx, dy, dz);
        let r = range[cellHash(c)];
        for (var k = r.x; k < r.x + r.y; k++) {
          if (k == k0) { continue; }
          let pj = sA[k];
          if (any(cellOf(pj.xyz) != c)) { continue; }
          let hj = pj.w; let hm = max(hi, hj);
          let d = xi - pj.xyz;
          let r2 = dot(d, d);
          if (r2 >= 4.0 * hm * hm || r2 == 0.0) { continue; }
          let rr = sqrt(r2);
          let gk = 0.5 * (dWk(rr, hi) + dWk(rr, hj)) / rr;
          let bj = sB[k];
          let vv = vi - bj.xyz;
          let vr = dot(vv, d);
          let tj = thS[k];
          var Pi = 0.0;
          if (vr < 0.0) {
            let hb = 0.5 * (hi + hj);
            let mu = hb * vr / (r2 + 0.01 * hb * hb);
            let cb = 0.5 * (ci + tj.z); let rb = 0.5 * (ti.x + tj.x); let fb = 0.5 * (ti.w + tj.w);
            Pi = fb * (-P.alpha * cb * mu + P.beta * mu * mu) / rb;
          }
          let Aj = tj.y / (tj.x * tj.x);
          a -= (bj.w * (Ai + Aj + Pi) * gk) * d;
          du += bj.w * (Ai + 0.5 * Pi) * gk * vr;
          vs = max(vs, ci + tj.z - 3.0 * min(0.0, vr / rr));
        }
      }
    }
  }
  acc[i] = vec4f(a, du);
  atomicMin(&ctl.dtBits, bitcast<u32>(P.cfl * hi / vs));
}

// ── 6 second half kick, gravity added ──────────────────────────────────────
// Relax mode: v is damped (factor exp(-dt / damp)), du = 0 and u is set to
// u_cold at the particle's SPH density.
@compute @workgroup_size(64)
fn cs_kick2(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.n) { return; }
  let dt = ctl.dt;
  let tn = ctl.t + dt;
  let span = ctl.tg - ctl.tgp;
  var fr = 0.0;
  if (span > 0.0) { fr = clamp((tn - ctl.tg) / span, 0.0, 2.0); }
  let g0 = grav[2u * i].xyz;
  let g = g0 + fr * (g0 - grav[2u * i + 1u].xyz);
  let s = acc[i];
  let a = s.xyz + g;
  let relax = (P.flags & F_RELAX) != 0u;
  var damp = 1.0;
  if (relax) { damp = exp(-dt / P.damp); }
  var du = s.w;
  if (relax) { du = 0.0; }
  let v = vel[i];
  vel[i] = vec4f((v.xyz + 0.5 * dt * a) * damp, v.w);
  if (relax) {
    // relax: the body stays on its cold curve at the SPH density (T = T0)
    let M = P.mats[tag[i] & 15u];
    uu[i] = uCold(M, th[i].x / M.r0.x);
  } else {
    uu[i] = max(0.0, uu[i] + 0.5 * dt * du);
  }
  acc[i] = vec4f(a, du);
  let h = pos[i].w;
  atomicMin(&ctl.dtBits, bitcast<u32>(P.cacc * sqrt(h / max(length(a), 1e-20))));
}

// ── 7 the next time step (one thread) ──────────────────────────────────────
@compute @workgroup_size(1)
fn cs_dtUpdate() {
  let cand = bitcast<f32>(atomicLoad(&ctl.dtBits));
  ctl.t = ctl.t + ctl.dt;
  var d = min(cand, P.dtMax);
  if (ctl.dt > 0.0) { d = min(d, ctl.dt * P.growth); }
  ctl.dt = max(d, P.dtMin);
  ctl.steps = ctl.steps + 1u;
  atomicStore(&ctl.dtBits, DT_INF);
}

// ── launch: body velocity V and spin W about the body centre X ─────────────
@compute @workgroup_size(64)
fn cs_boost(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.n) { return; }
  let B = P.bodies[(tag[i] >> 4u) & 3u];
  let r = pos[i].xyz - B.X.xyz;
  vel[i] = vec4f(B.V.xyz + cross(B.W.xyz, r), vel[i].w);
}

// ── stats for the page (cut on events, plates) ─────────────────────────────
@compute @workgroup_size(1)
fn cs_statsClear() {
  atomicStore(&ctl.maxT, 0u); atomicStore(&ctl.maxP, 0u); atomicStore(&ctl.maxV, 0u);
  atomicStore(&ctl.touching, 0u); atomicStore(&ctl.melt, 0u); atomicStore(&ctl.vapour, 0u);
  for (var b = 0u; b < 4u; b++) {
    atomicStore(&ctl.unbound[b], 0u); atomicStore(&ctl.count[b], 0u);
    atomicStore(&ctl.sx[b], 0); atomicStore(&ctl.sy[b], 0); atomicStore(&ctl.sz[b], 0);
  }
}
// positions in the body sums: fixed point, 1/256 code unit, |x| <= 64
@compute @workgroup_size(64)
fn cs_stats(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.n) { return; }
  let mi = tag[i];
  let b = (mi >> 4u) & 3u;
  let x = aux[i];
  let v = vel[i].xyz;
  atomicMax(&ctl.maxT, bitcast<u32>(x.x));
  atomicMax(&ctl.maxP, bitcast<u32>(th[i].y));
  atomicMax(&ctl.maxV, bitcast<u32>(length(v)));
  if (x.z > 0.0) { atomicAdd(&ctl.touching, 1u); }
  if (x.x > P.mats[mi & 15u].r3.x) { atomicAdd(&ctl.melt, 1u); }
  if (x.w > 0.5) { atomicAdd(&ctl.vapour, 1u); }
  if (0.5 * dot(v, v) + grav[2u * i].w > 0.0) { atomicAdd(&ctl.unbound[b], 1u); }
  atomicAdd(&ctl.count[b], 1u);
  let q = vec3i(round(clamp(pos[i].xyz, vec3f(-64.0), vec3f(64.0)) * 256.0));
  atomicAdd(&ctl.sx[b], q.x); atomicAdd(&ctl.sy[b], q.y); atomicAdd(&ctl.sz[b], q.z);
}
