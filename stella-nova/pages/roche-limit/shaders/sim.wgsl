// ============================================================================
//  ROCHE LIMIT  ·  shaders/sim.wgsl — the rubble pile on the GPU
// ----------------------------------------------------------------------------
//  One module, eight entry points. engine.js gives each entry point its own
//  bind group layout with only the bindings it uses (8 storage buffers or
//  fewer per stage). physics.js (class CpuSim) is the f64 reference of the
//  same arithmetic; tests.mjs checks the two against each other.
//
//  A block of K steps (engine.js "encodeBlock"):
//    K times:  cs_kick (v += cF a ; x += dt v ; planet hit)
//              every KNL steps: cs_gridClear, cs_gridScatter, cs_nlist
//              cs_forces (contacts, tide, J2, drag, gravity extrapolation)
//    cs_gravity (direct sum, tiles of 256 in workgroup memory)
//  cs_potential fills the self potential before a readback (energy).
//  cs_kick with no drift flag is the half kick that makes v synchronous
//  before a readback.
//
//  Buffers (one row per grain i, np rows, padded with mass 0):
//    body    pos (xyz, radius) · vel (xyz, mass) · spin (xyz, 0)
//    accs    acc (total fast accel) · alpha (angular accel) ·
//            fcF, fcT (contact force and torque, for the work ledger)
//    grav    g (self-gravity accel, potential) · gp (g of the block before)
//    ledger  xyz: angular momentum of grains that hit the planet,
//            w: work of contacts minus the energy of grains that hit
//    diag    |tide| · |self g| · collision heat (energy per mass, summed
//            until the renderer reads it) · contact count
//    nbr     NB slots per grain, then np counts; xi: tangential springs
//    gcount, gitems   the hashed grid, CAP grains per bucket; gcount[H]
//            counts the grains that found their bucket full, gcount[H+1]
//            the neighbours that found a full list (NB)
//
//  grep -n targets: "fn cs_kick", "fn cs_forces", "fn tide", "fn cs_gravity", "fn cs_potential",
//  "fn cs_gridScatter", "fn cs_nlist", "fn cellHash"
// ============================================================================

const NB: u32 = 24u;
const CAP: u32 = 16u;
const PI: f32 = 3.14159265;

struct Params {
  n: u32, np: u32, hmask: u32, flags: u32,
  kn: f32, kt: f32, gnK: f32, gtK: f32,
  mu: f32, muR: f32, coh: f32, cohGap: f32,
  skin: f32, cell: f32, w0r: f32, settle: f32,
  GM: f32, Rp: f32, J2: f32, drag: f32,
  park: f32, p0: f32, p1: f32, p2: f32,
};
struct Step {
  X: vec3f, dt: f32,
  V: vec3f, cF: f32,
  frac: f32, flags: u32, s0: f32, s1: f32,
};
struct Body { pos: vec4f, vel: vec4f, spin: vec4f };
struct Acc { acc: vec4f, alpha: vec4f, fcF: vec4f, fcT: vec4f };
struct Grav { g: vec4f, gp: vec4f };

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<uniform> S: Step;
@group(0) @binding(2) var<storage, read_write> body: array<Body>;
@group(0) @binding(3) var<storage, read_write> accs: array<Acc>;
@group(0) @binding(4) var<storage, read_write> grav: array<Grav>;
@group(0) @binding(5) var<storage, read_write> ledger: array<vec4f>;
@group(0) @binding(6) var<storage, read_write> nbrA: array<u32>;
@group(0) @binding(7) var<storage, read_write> xiA: array<vec4f>;
@group(0) @binding(8) var<storage, read_write> nbrB: array<u32>;
@group(0) @binding(9) var<storage, read_write> xiB: array<vec4f>;
@group(0) @binding(10) var<storage, read_write> gcount: array<atomic<u32>>;
@group(0) @binding(11) var<storage, read_write> gitems: array<u32>;
@group(0) @binding(12) var<storage, read_write> diag: array<vec4f>;

// ── kick and drift ──────────────────────────────────────────────────────────
// v += cF acc, w += cF alpha, then x += dt v when flags bit 0 is set.
// A grain inside the planet leaves: its energy and angular momentum go to
// the ledger, it gets mass 0 and is parked far away.
@compute @workgroup_size(64)
fn cs_kick(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.n) { return; }
  let b = body[i];
  let m = b.vel.w;
  if (m == 0.0) { return; }
  let a = accs[i];
  let v = b.vel.xyz + S.cF * a.acc.xyz;
  let w = b.spin.xyz + S.cF * a.alpha.xyz;
  var x = b.pos.xyz;
  if ((S.flags & 1u) != 0u) { x = x + S.dt * v; }
  let R = S.X + x;
  if (P.GM > 0.0 && dot(R, R) < P.Rp * P.Rp) {
    // v is the half-step velocity. A test that moved it to the time of x
    // (v + dt/2 a) gave a 4x larger ledger drift (physics.js accrete)
    let VV = S.V + v;
    let ri = b.pos.w;
    let e = 0.5 * m * dot(VV, VV) + 0.2 * m * ri * ri * dot(w, w) - P.GM * m / length(R) + m * grav[i].g.w;
    let L = m * cross(R, VV) + 0.4 * m * ri * ri * w;
    ledger[i] = ledger[i] + vec4f(L, -e);
    body[i] = Body(vec4f(P.park, P.park, P.park, ri), vec4f(0.0), vec4f(0.0));
    return;
  }
  body[i] = Body(vec4f(x, b.pos.w), vec4f(v, m), vec4f(w, 0.0));
}

// ── the tide ────────────────────────────────────────────────────────────────
// G M [X/|X|^3 - R/|R|^3], R = X + x, with no large terms that cancel
// (physics.js tideAccel has the derivation).
fn tide(X: vec3f, x: vec3f) -> vec3f {
  let R = X + x;
  let R2 = dot(R, R);
  let X2 = dot(X, X);
  let Rm = sqrt(R2);
  let Xm = sqrt(X2);
  let R3 = R2 * Rm;
  let X3 = X2 * Xm;
  let dR = (2.0 * dot(X, x) + dot(x, x)) / (Rm + Xm);
  let d3 = dR * (R2 + Rm * Xm + X2);
  let f = d3 / (X3 * R3);
  return P.GM * (R * f - x / X3);
}
fn j2acc(r: vec3f) -> vec3f {
  let r2 = dot(r, r);
  let k = 1.5 * P.J2 * P.GM * P.Rp * P.Rp / (r2 * r2 * sqrt(r2));
  let z2 = 5.0 * r.z * r.z / r2;
  return k * vec3f(r.x * (z2 - 1.0), r.y * (z2 - 1.0), r.z * (z2 - 3.0));
}

// ── contact forces ──────────────────────────────────────────────────────────
// Spring-dashpot normal force, Cundall-Strack friction spring with a
// Coulomb cap, rolling resistance, cohesion. Then the tide, the J2 tide,
// the drag, the settle drag and the extrapolated self-gravity.
@compute @workgroup_size(64)
fn cs_forces(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.n) { return; }
  let bi = body[i];
  let mi = bi.vel.w;
  let old = accs[i];
  if (mi == 0.0) {
    accs[i] = Acc(vec4f(0.0), vec4f(0.0), vec4f(0.0), vec4f(0.0));
    diag[i] = vec4f(0.0);
    return;
  }
  let xi0 = bi.pos.xyz;
  let ri = bi.pos.w;
  let vi = bi.vel.xyz;
  let wi = bi.spin.xyz;
  var f = vec3f(0.0);
  var t = vec3f(0.0);
  var pn = 0.0;
  var heat = 0.0;   // power taken by the dashpots and by sliding friction
  var nc = 0.0;
  let reach = select(0.0, P.cohGap, P.coh > 0.0);
  let cnt = min(nbrA[P.np * NB + i], NB);
  for (var s = 0u; s < cnt; s++) {
    let q = i * NB + s;
    let j = nbrA[q];
    let bj = body[j];
    let d = xi0 - bj.pos.xyz;
    let dist = length(d);
    let rj = bj.pos.w;
    let gap = dist - (ri + rj);
    if (gap >= reach || bj.vel.w == 0.0 || dist <= 0.0) {
      xiA[q] = vec4f(0.0);
      continue;
    }
    let n = d / dist;
    var F = vec3f(0.0);
    // cohesion: C while the grains touch, falling linearly to 0 at a gap of
    // cohGap, so the force has no jump at the edge of its reach
    let coh = P.coh * clamp(1.0 - gap / max(P.cohGap, 1e-6), 0.0, 1.0);
    if (gap < 0.0) {
      let mj = bj.vel.w;
      let sm = sqrt(mi * mj / (mi + mj));
      // lever arms to the middle of the overlap: the two torques and the
      // pair's orbital torque then cancel exactly, so the friction keeps
      // the angular momentum (arms of r_i, r_j leave -delta n x F_t)
      let ai = ri + 0.5 * gap;
      let aj = rj + 0.5 * gap;
      let wsum = ai * wi + aj * bj.spin.xyz;
      let vrel = vi - bj.vel.xyz - cross(wsum, n);
      let vn = dot(vrel, n);
      let vt = vrel - vn * n;
      let Fn = max(0.0, P.kn * (-gap) - P.gnK * sm * vn);
      if (Fn > 0.0) { heat = heat + P.gnK * sm * vn * vn; }
      F = Fn * n;
      pn = pn + Fn;
      nc = nc + 1.0;
      if (P.mu > 0.0) {
        var sp = xiA[q].xyz;
        let l0 = length(sp);
        sp = sp - dot(sp, n) * n;
        let l1 = length(sp);
        if (l1 > 1e-12) { sp = sp * (l0 / l1); }
        sp = sp + vt * S.dt;
        var ft = -P.kt * sp - P.gtK * sm * vt;
        let fm = length(ft);
        let cap = P.mu * (Fn + coh);
        if (fm > cap) {
          heat = heat + cap * length(vt);
          ft = ft * (cap / fm);
          // sliding: the spring holds the elastic part of the capped force
          // only, not the dashpot part (Luding 2008), so it stores no
          // energy that the dashpot took
          sp = -(ft + P.gtK * sm * vt) / P.kt;
        }
        else { heat = heat + P.gtK * sm * dot(vt, vt); }
        xiA[q] = vec4f(sp, 0.0);
        F = F + ft;
        t = t - ai * cross(n, ft);
      }
      if (P.muR > 0.0) {
        let wr = wi - bj.spin.xyz;
        let wp = wr - dot(wr, n) * n;
        let pm = sqrt(dot(wp, wp) + P.w0r * P.w0r);
        t = t - (P.muR * (ri * rj / (ri + rj)) * Fn / pm) * wp;
      }
    }
    F = F - coh * n;
    f = f + F;
  }
  let g = grav[i];
  var a = f / mi + g.g.xyz + S.frac * (g.g.xyz - g.gp.xyz);
  var td = vec3f(0.0);
  if (P.GM > 0.0) {
    td = tide(S.X, xi0);
    if (P.J2 != 0.0) { td = td + j2acc(S.X + xi0) - j2acc(S.X); }
    a = a + td - P.drag * vi;
  }
  a = a - P.settle * vi;
  // contact work over the step, trapezoid rule
  let pw = dot(f + old.fcF.xyz, vi) + dot(t + old.fcT.xyz, wi);
  ledger[i].w = ledger[i].w + 0.5 * pw * S.dt;
  let iI = 1.0 / (0.4 * mi * ri * ri);
  accs[i] = Acc(vec4f(a, 0.0), vec4f(t * iI, 0.0), vec4f(f, 0.0), vec4f(t, 0.0));
  // diag.z: energy per unit mass taken by collisions since the renderer
  // last read it (particles.wgsl cs_smooth reads it and sets it to 0);
  // each grain of a pair counts half the pair's power
  let heatAcc = diag[i].z + 0.5 * heat / mi * S.dt;
  diag[i] = vec4f(length(td), length(g.g.xyz), heatAcc, nc);
}

// ── self-gravity: direct sum ────────────────────────────────────────────────
// Newton for r >= SMIN = 2 R_MIN, the smallest sum of two grain radii, so
// two grains that do not overlap feel the exact force of two spheres. Inside
// SMIN (deep overlap only) the field is linear, as inside a uniform sphere.
// The force is m d / max(r, SMIN)^3: one inverseSqrt per pair, no branch.
// Tiles of 256 bodies (x, y, z, m) in workgroup memory. The potential is a
// separate entry point (cs_potential), run only before a readback.
const SMIN: f32 = 1.7;
var<workgroup> tile: array<vec4f, 256>;

@compute @workgroup_size(128)
fn cs_gravity(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) li: u32) {
  // Each invocation sums for two grains, i0 and i0 + 128: one tile read
  // serves two pairs (5.3 ms against 7.4 ms for one grain each, 24k grains).
  let i0 = wid.x * 256u + li;
  let i1 = i0 + 128u;
  let p0 = body[i0].pos.xyz;
  let p1 = body[i1].pos.xyz;
  var a0 = vec3f(0.0);
  var a1 = vec3f(0.0);
  for (var base = 0u; base < P.np; base += 256u) {
    let b0 = body[base + li];
    let b1 = body[base + li + 128u];
    tile[li] = vec4f(b0.pos.xyz, b0.vel.w);
    tile[li + 128u] = vec4f(b1.pos.xyz, b1.vel.w);
    workgroupBarrier();
    for (var k = 0u; k < 256u; k++) {
      let pj = tile[k];
      let d0 = pj.xyz - p0;
      let r0 = inverseSqrt(max(dot(d0, d0), SMIN * SMIN));
      a0 = a0 + (pj.w * r0 * r0 * r0) * d0;
      let d1 = pj.xyz - p1;
      let r1 = inverseSqrt(max(dot(d1, d1), SMIN * SMIN));
      a1 = a1 + (pj.w * r1 * r1 * r1) * d1;
    }
    workgroupBarrier();
  }
  if (i0 < P.n) { let o = grav[i0].g; grav[i0] = Grav(vec4f(a0, o.w), o); }
  if (i1 < P.n) { let o = grav[i1].g; grav[i1] = Grav(vec4f(a1, o.w), o); }
}
// The potential per unit mass, -sum m/r (the linear-field form inside
// SMIN), into grav[i].g.w. The self pair adds -1.5 m_i/SMIN; it is removed.
@compute @workgroup_size(256)
fn cs_potential(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) li: u32) {
  let i = gid.x;
  let valid = i < P.n;
  var pi = vec3f(0.0);
  var mi = 0.0;
  if (valid) { pi = body[i].pos.xyz; mi = body[i].vel.w; }
  var phi = 0.0;
  for (var base = 0u; base < P.np; base += 256u) {
    let bj = body[base + li];
    tile[li] = vec4f(bj.pos.xyz, bj.vel.w);
    workgroupBarrier();
    for (var k = 0u; k < 256u; k++) {
      let pj = tile[k];
      let d = pj.xyz - pi;
      let r2 = dot(d, d);
      let outside = pj.w * inverseSqrt(max(r2, SMIN * SMIN));
      let inside = pj.w * (1.5 - 0.5 * r2 / (SMIN * SMIN)) / SMIN;
      phi = phi - select(outside, inside, r2 < SMIN * SMIN);
    }
    workgroupBarrier();
  }
  if (valid) { grav[i].g.w = phi + 1.5 * mi / SMIN; }
}

// ── hashed grid ─────────────────────────────────────────────────────────────
fn cellOf(x: vec3f) -> vec3i { return vec3i(floor(x / P.cell)); }
// A sum of three products, then a 32-bit finaliser (lowbias32), so that
// small cell coordinates spread over the low bits. The common XOR of the
// products maps many small coordinate triples to one value: 2106 cells of a
// ball went into 1242 buckets, and a settled pile filled buckets past CAP.
fn cellHash(c: vec3i) -> u32 {
  var h = (bitcast<u32>(c.x) * 73856093u) + (bitcast<u32>(c.y) * 19349663u) + (bitcast<u32>(c.z) * 83492791u);
  h = h ^ (h >> 16u);
  h = h * 0x7feb352du;
  h = h ^ (h >> 15u);
  h = h * 0x846ca68bu;
  h = h ^ (h >> 16u);
  return h & P.hmask;
}
@compute @workgroup_size(64)
fn cs_gridClear(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x > P.hmask) { return; }
  atomicStore(&gcount[gid.x], 0u);
}
@compute @workgroup_size(64)
fn cs_gridScatter(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.n) { return; }
  let b = body[i];
  if (b.vel.w == 0.0) { return; }
  let h = cellHash(cellOf(b.pos.xyz));
  let slot = atomicAdd(&gcount[h], 1u);
  if (slot < CAP) { gitems[h * CAP + slot] = i; }
  else { atomicAdd(&gcount[P.hmask + 1u], 1u); }   // overflow count (never cleared)
}

// ── neighbour lists ─────────────────────────────────────────────────────────
// Every grain j with |x_i - x_j| < r_i + r_j + skin, from the 27 cells
// around i. A grain counts only in its own cell (two cells can share a
// bucket). The spring of a contact that was in the old list is copied.
// Reads nbrA/xiA (old), writes nbrB/xiB (new).
@compute @workgroup_size(64)
fn cs_nlist(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.n) { return; }
  let b = body[i];
  if (b.vel.w == 0.0) { nbrB[P.np * NB + i] = 0u; return; }
  let xi0 = b.pos.xyz;
  let c0 = cellOf(xi0);
  let oldCnt = min(nbrA[P.np * NB + i], NB);
  var c = 0u;
  for (var dz = -1; dz <= 1; dz++) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let cc = c0 + vec3i(dx, dy, dz);
        let h = cellHash(cc);
        let k = min(atomicLoad(&gcount[h]), CAP);
        for (var u = 0u; u < k; u++) {
          let j = gitems[h * CAP + u];
          if (j == i) { continue; }
          let bj = body[j];
          if (any(cellOf(bj.pos.xyz) != cc)) { continue; }
          let d = xi0 - bj.pos.xyz;
          let s = b.pos.w + bj.pos.w + P.skin;
          if (dot(d, d) >= s * s) { continue; }
          if (c >= NB) { atomicAdd(&gcount[P.hmask + 2u], 1u); continue; }   // list full (counted)
          var sp = vec4f(0.0);
          for (var o = 0u; o < oldCnt; o++) {
            if (nbrA[i * NB + o] == j) { sp = xiA[i * NB + o]; break; }
          }
          nbrB[i * NB + c] = j;
          xiB[i * NB + c] = sp;
          c = c + 1u;
        }
      }
    }
  }
  nbrB[P.np * NB + i] = c;
}
