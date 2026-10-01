// lbm2d.wgsl — the 2D wind tunnel solver: a D2Q9 lattice Boltzmann method
// with BGK collision and a Smagorinsky eddy viscosity. sdf.wgsl is prepended.
//
// One step() call is one lattice time step for every cell. It pulls the nine
// populations from the neighbours (streaming), applies the boundaries, then
// relaxes toward equilibrium (collision), and writes the other buffer. The
// host swaps the two buffers each step.
//
// Populations are stored by direction: f[q * n + cell], cell = x + nx * y.
//
// Cell types (buffer `types`, written by voxelize):
//   0 fluid   1 far field (equilibrium at the inlet velocity)   2 outlet
//   3 porous part (fluid for the solver, drawn as object: legs, wheels)
//   4 fixed ground wall   5 moving ground belt   6 free-slip wall
//   8 + k solid, copy k
// Walls and solids use halfway bounce-back. The belt adds the wall velocity
// term 6 w_q (c_q . u_w). The free-slip wall (the tunnel roof, and the floor
// when there is no ground) reflects specularly: the population that arrives
// with c = (cx, -1) left the cell (x - cx, y) with c = (cx, +1). The outlet copies the populations of the cell
// upstream for the directions that would come from outside the grid.
//
// The force sums -2 (f - w_q) c_q, not -2 f c_q. The w_q part is the
// reference pressure rho0 / 3. It cancels on a closed body, but not on a
// body that stands on the floor: the hoof soles are not wetted, so it
// gave the cow a false downforce (lift coefficient -5.4).
//
// Forces. On a measure step, each bounce-back link from fluid into copy k adds
// -2 f c_q to the force on copy k (momentum exchange). The sum goes through
// workgroup atomics, then one global atomic per workgroup, in fixed point
// (FIX). The measure step also writes the macro texture: (ux, uy, rho - 1, solid), solid 1, porous 0.5.
// rho - 1 keeps the pressure exact in half floats; rho itself would step by 1/1024.
//
// grep: struct SimU  fn feq  fn voxelize  fn initF  fn step  fn area  fn sponge

// Sponge. The free-slip walls reflect sound fully, so a pressure wave from
// the start or from vortex shedding rings between roof and floor (the 2D car
// lift oscillated with the 1000-step period of that standing wave). In a band
// SPONGE cells wide along the slip walls and the outlet, collision also pulls
// the density toward 1 at the local velocity. That damps the sound and
// leaves the flow.

struct SimU {
  nx: u32, ny: u32, nz: u32, n: u32,
  U: f32,         // inlet velocity, lattice units (after the start ramp)
  tau: f32,       // molecular relaxation time
  noise: f32,     // inlet turbulence, fraction of U
  beltU: f32,     // ground belt velocity
  step: u32,
  measure: u32,   // 1: accumulate forces and write the macro texture
  ground: u32,    // 0 none, 1 fixed wall, 2 belt
  pad: u32,
};

@group(0) @binding(0) var<uniform> S: SimU;
@group(0) @binding(1) var<uniform> SH: ShapeU;
@group(0) @binding(2) var<storage, read_write> fA: array<f32>;
@group(0) @binding(3) var<storage, read_write> fB: array<f32>;
@group(0) @binding(4) var<storage, read_write> types: array<u32>;
@group(0) @binding(5) var macroOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var<storage, read_write> forces: array<atomic<i32>, 16>;

const FIX = 1048576.0;
const T_FLUID = 0u;
const T_EQ = 1u;
const T_OUT = 2u;
const T_GHOST = 3u;
const T_WALL = 4u;
const T_BELT = 5u;
const T_SLIP = 6u;
const T_SOLID = 8u;

var<private> CX: array<i32, 9> = array<i32, 9>(0, 1, 0, -1, 0, 1, -1, -1, 1);
var<private> CY: array<i32, 9> = array<i32, 9>(0, 0, 1, 0, -1, 1, 1, -1, -1);
var<private> W: array<f32, 9> = array<f32, 9>(4.0 / 9.0, 1.0 / 9.0, 1.0 / 9.0, 1.0 / 9.0, 1.0 / 9.0,
                                              1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0);
var<private> OPP: array<u32, 9> = array<u32, 9>(0u, 3u, 4u, 1u, 2u, 7u, 8u, 5u, 6u);
var<private> MY: array<u32, 9> = array<u32, 9>(0u, 1u, 4u, 3u, 2u, 8u, 7u, 6u, 5u);

fn feq(q: u32, rho: f32, u: vec2f) -> f32 {
  let cu = f32(CX[q]) * u.x + f32(CY[q]) * u.y;
  return W[q] * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * dot(u, u));
}

const SPONGE = 16.0;
fn ramp(d: f32) -> f32 { let t = clamp(1.0 - d / SPONGE, 0.0, 1.0); return t * t; }
fn sponge(x: u32, y: u32) -> f32 {
  var r = max(ramp(f32(S.ny - 1u - y)), ramp(f32(S.nx - 1u - x)));
  if (S.ground == 0u) { r = max(r, ramp(f32(y))); }
  return 0.15 * r;
}

fn hash(a: u32) -> u32 {
  var x = a;
  x ^= x >> 16u; x *= 0x7feb352du;
  x ^= x >> 15u; x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}
fn rnd(a: u32) -> f32 { return f32(hash(a) & 0xffffffu) / 16777216.0 - 0.5; }

// Inlet velocity with turbulence. The noise is smooth in y and in time (8
// cells, 16 steps), so it survives long enough to reach the object.
fn inlet(y: u32) -> vec2f {
  if (S.noise <= 0.0) { return vec2f(S.U, 0.0); }
  let fy = f32(y) / 8.0;
  let ft = f32(S.step) / 16.0;
  let iy = u32(fy);
  let it = u32(ft);
  let ty = fy - f32(iy);
  let tt = ft - f32(it);
  var v = vec2f(0.0);
  for (var c = 0u; c < 2u; c++) {
    let a = mix(rnd(iy * 7919u + it * 104729u + c * 31u), rnd((iy + 1u) * 7919u + it * 104729u + c * 31u), ty);
    let b = mix(rnd(iy * 7919u + (it + 1u) * 104729u + c * 31u), rnd((iy + 1u) * 7919u + (it + 1u) * 104729u + c * 31u), ty);
    v[c] = mix(a, b, tt);
  }
  return vec2f(S.U * (1.0 + v.x * S.noise * 2.0), S.U * v.y * S.noise * 2.0);
}

fn boundaryType(x: u32, y: u32) -> u32 {
  var t = T_FLUID;
  if (x == 0u) { t = T_EQ; }
  if (x == S.nx - 1u) { t = T_OUT; }
  if (y == S.ny - 1u) { t = T_SLIP; }
  if (y == 0u) {
    if (S.ground == 1u) { t = T_WALL; }
    else if (S.ground == 2u) { t = T_BELT; }
    else { t = T_SLIP; }
  }
  return t;
}

// Writes the cell types from the shape. A cell that was solid and is now fluid
// gets the rest equilibrium, so a live shape change does not leave stale
// populations in the flow.
@compute @workgroup_size(128)
fn voxelize(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= S.n) { return; }
  let x = i % S.nx;
  let y = i / S.nx;
  var t = boundaryType(x, y);
  if (t == T_FLUID) {
    let c = projSolid(vec2f(f32(x) + 0.5, f32(y) + 0.5));
    if (c >= 100) { t = T_GHOST; }
    else if (c >= 0) { t = T_SOLID + u32(c); }
  }
  let old = types[i];
  if (old >= T_SOLID && t < T_WALL) {
    for (var q = 0u; q < 9u; q++) {
      let e = feq(q, 1.0, vec2f(0.0));
      fA[q * S.n + i] = e;
      fB[q * S.n + i] = e;
    }
  }
  types[i] = t;
}

// Fills both buffers with the equilibrium at the inlet velocity.
@compute @workgroup_size(128)
fn initF(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= S.n) { return; }
  let solid = types[i] >= T_WALL;
  let u = select(vec2f(S.U, 0.0), vec2f(0.0), solid);
  for (var q = 0u; q < 9u; q++) {
    let e = feq(q, 1.0, u);
    fA[q * S.n + i] = e;
    fB[q * S.n + i] = e;
  }
}

var<workgroup> wf: array<atomic<i32>, 8>;

@compute @workgroup_size(128)
fn step(@builtin(global_invocation_id) g: vec3u, @builtin(local_invocation_index) li: u32) {
  let measure = S.measure != 0u;
  if (measure && li < 8u) { atomicStore(&wf[li], 0); }
  workgroupBarrier();

  let i = g.x;
  if (i < S.n) {
    let x = i % S.nx;
    let y = i / S.nx;
    let t = types[i];
    if (t >= T_WALL) {
      if (measure) { textureStore(macroOut, vec2u(x, y), vec4f(0.0, 0.0, 0.0, 1.0)); }
    } else if (t == T_EQ) {
      let u = inlet(y);
      for (var q = 0u; q < 9u; q++) { fB[q * S.n + i] = feq(q, 1.0, u); }
      if (measure) { textureStore(macroOut, vec2u(x, y), vec4f(u, 0.0, 0.0)); }
    } else {
      var f: array<f32, 9>;
      var fx = vec2f(0.0);
      var copy = 0u;
      var hit = false;
      for (var q = 0u; q < 9u; q++) {
        var sx = i32(x) - CX[q];
        let sy = clamp(i32(y) - CY[q], 0, i32(S.ny) - 1);
        if (sx >= i32(S.nx)) { sx = i32(S.nx) - 2; }
        let s = u32(sx) + S.nx * u32(sy);
        let st = types[s];
        if (st == T_SLIP) {
          let ox = clamp(i32(x) - CX[q], 0, i32(S.nx) - 1);
          f[q] = fA[MY[q] * S.n + u32(ox) + S.nx * y];
        } else if (st >= T_WALL) {
          let a = fA[OPP[q] * S.n + i];
          var v = a;
          if (st == T_BELT) { v += 6.0 * W[q] * f32(CX[q]) * S.beltU; }
          f[q] = v;
          if (st >= T_SOLID) {
            fx -= 2.0 * (a - W[q]) * vec2f(f32(CX[q]), f32(CY[q]));
            copy = st - T_SOLID;
            hit = true;
          }
        } else {
          f[q] = fA[q * S.n + s];
        }
      }

      var rho = 0.0;
      var u = vec2f(0.0);
      for (var q = 0u; q < 9u; q++) {
        rho += f[q];
        u += f[q] * vec2f(f32(CX[q]), f32(CY[q]));
      }
      let bad = !(rho > 0.2 && rho < 5.0);
      if (bad) { rho = 1.0; u = vec2f(S.U, 0.0); }
      else { u /= rho; }
      let sp = length(u);
      if (sp > 0.35) { u *= 0.35 / sp; }

      // Smagorinsky: the eddy viscosity comes from the non-equilibrium stress.
      var pxx = 0.0; var pyy = 0.0; var pxy = 0.0;
      for (var q = 0u; q < 9u; q++) {
        let ne = f[q] - feq(q, rho, u);
        let cx = f32(CX[q]); let cy = f32(CY[q]);
        pxx += cx * cx * ne; pyy += cy * cy * ne; pxy += cx * cy * ne;
      }
      let Q = pxx * pxx + pyy * pyy + 2.0 * pxy * pxy;
      let tau = 0.5 * (S.tau + sqrt(S.tau * S.tau + 0.76421222 * sqrt(Q) / rho));
      let om = 1.0 / tau;

      let sg = sponge(x, y);
      for (var q = 0u; q < 9u; q++) {
        let e = feq(q, rho, u);
        let damp = sg * (feq(q, 1.0, u) - e);
        fB[q * S.n + i] = select(f[q] + om * (e - f[q]) + damp, e, bad);
      }
      if (measure) {
        textureStore(macroOut, vec2u(x, y), vec4f(u, rho - 1.0, select(0.0, 0.5, t == T_GHOST)));
        if (hit) {
          atomicAdd(&wf[copy * 2u], i32(round(fx.x * FIX)));
          atomicAdd(&wf[copy * 2u + 1u], i32(round(fx.y * FIX)));
        }
      }
    }
  }

  workgroupBarrier();
  if (measure && li < 8u) {
    let v = atomicLoad(&wf[li]);
    if (v != 0) { atomicAdd(&forces[li], v); }
  }
}

// Frontal size per copy, in cells: the rows that hold any solid of copy k.
// forces[8 + k] gets the count.
@compute @workgroup_size(64)
fn area(@builtin(global_invocation_id) g: vec3u) {
  let y = g.x;
  if (y >= S.ny) { return; }
  var mask = 0u;
  for (var x = 0u; x < S.nx; x++) {
    let t = types[x + S.nx * y];
    if (t >= T_SOLID) { mask |= 1u << (t - T_SOLID); }
  }
  for (var k = 0u; k < 4u; k++) {
    if ((mask & (1u << k)) != 0u) { atomicAdd(&forces[8u + k], 1); }
  }
}
