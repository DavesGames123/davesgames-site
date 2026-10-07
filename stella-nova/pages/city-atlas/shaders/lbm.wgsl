// lbm.wgsl — the wind solver: a 2D D2Q9 lattice Boltzmann method with BGK
// collision, a Smagorinsky eddy viscosity, and a drag and body force term.
//
// wind.js runs two lattices with this one module:
//   coarse  256 x 256 cells over 12 km: terrain above the block level is a
//           wall; land cover, trees and the city add drag (a canopy term);
//           the optional sea breeze adds a force from the sea toward land.
//   fine    up to 640 x 640 cells over the building disc (about 10 m
//           cells): buildings taller than the slice height are walls. Its
//           inflow and side cells take their velocity from the coarse field.
// Both lattices turn with the wind: lattice +x is the direction the wind
// blows TO (S.dir in the world frame), so the inlet is always column 0.
// Lattice speed U (S.U) is the free stream. The renderer scales speed by
// (wind m/s) / U. The model is 2D: no vertical motion, no buoyancy, no
// turbulence closure beyond Smagorinsky. It shows where the flow channels,
// separates and sheds, not real gust speeds.
//
// Populations by direction: f[q * n + cell], cell = x + nx * y. step() pulls
// from the neighbours (streaming), applies halfway bounce-back at walls,
// relaxes toward equilibrium (collision) and writes the other buffer.
//
// Cell types: 0 fluid, 1 free stream (equilibrium at the inflow velocity),
// 2 outlet (copies its upstream neighbour), 4 wall.
// S.closed = 1 makes every edge cell a wall and turns off the forces and
// the sponge: the mass test in tests.mjs (tools/wind-check.js) uses it.
//
// The force (aux.xy, lattice units) and the drag rate (aux.z) enter by the
// velocity shift: the equilibrium uses u + tau (F / rho - k u).
//
// grep: struct SimU  fn feq  fn voxelize  fn initF  fn step  fn inflow  fn sponge

struct SimU {
  nx: u32, ny: u32, n: u32, fine: u32,
  U: f32,            // free-stream lattice speed
  tau: f32,          // molecular relaxation time
  noise: f32,        // inflow turbulence, share of U
  stepNo: u32,
  dir: vec2f,        // world direction the wind blows to (unit)
  half: f32,         // half side of this lattice, m
  cHalf: f32,        // half side of the coarse lattice, m (the fine inflow reads it)
  gHalfIn: f32,      // inner height raster half side, m
  gHalfOut: f32,     // outer height raster half side, m
  bHalf: f32,        // building raster half side, m
  slice: f32,        // slice height above the ground, m
  block: f32,        // ground higher than this (m above sea level) is a wall
  seaBreeze: f32,    // sea breeze force scale, lattice units
  drag: f32,         // canopy drag scale
  closed: u32,       // 1: closed box test
  writeMacro: u32,
  pad0: u32, pad1: u32, pad2: u32,
};

@group(0) @binding(0) var<uniform> S: SimU;
@group(0) @binding(1) var<storage, read_write> fA: array<f32>;
@group(0) @binding(2) var<storage, read_write> fB: array<f32>;
@group(0) @binding(3) var<storage, read_write> types: array<u32>;
@group(0) @binding(4) var<storage, read_write> aux: array<vec4f>;
@group(0) @binding(5) var macroOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var coarseIn: texture_2d<f32>;   // coarse macro (fine lattice inflow)
@group(0) @binding(7) var hIn: texture_2d<f32>;        // inner heights (r ground)
@group(0) @binding(8) var hOut: texture_2d<f32>;       // outer heights
@group(0) @binding(9) var bTex: texture_2d<f32>;       // building heights m (r32float), north up
@group(0) @binding(10) var rTex: texture_2d<f32>;      // rg8unorm: roughness, smoothed land share
@group(0) @binding(11) var linS: sampler;

const T_FLUID = 0u;
const T_EQ = 1u;
const T_OUT = 2u;
const T_WALL = 4u;

var<private> CX: array<i32, 9> = array<i32, 9>(0, 1, 0, -1, 0, 1, -1, -1, 1);
var<private> CY: array<i32, 9> = array<i32, 9>(0, 0, 1, 0, -1, 1, 1, -1, -1);
var<private> W: array<f32, 9> = array<f32, 9>(4.0 / 9.0, 1.0 / 9.0, 1.0 / 9.0, 1.0 / 9.0, 1.0 / 9.0,
                                              1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0);
var<private> OPP: array<u32, 9> = array<u32, 9>(0u, 3u, 4u, 1u, 2u, 7u, 8u, 5u, 6u);

fn feq(q: u32, rho: f32, u: vec2f) -> f32 {
  let cu = f32(CX[q]) * u.x + f32(CY[q]) * u.y;
  return W[q] * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * dot(u, u));
}

// Lattice cell centre -> world metres.
fn worldOf(x: u32, y: u32) -> vec2f {
  let cell = 2.0 * S.half / f32(S.nx);
  let s = vec2f(f32(x) + 0.5, f32(y) + 0.5) * cell - S.half;
  let d = S.dir;
  return s.x * d + s.y * vec2f(-d.y, d.x);
}

fn texAt(t: texture_2d<f32>, p: vec2f, half: f32) -> vec4f {
  let n = vec2i(textureDimensions(t));
  let g = vec2i(floor((p + half) / (2.0 * half) * vec2f(n)));
  return textureLoad(t, clamp(g, vec2i(0), n - 1), 0);
}

fn groundAt(p: vec2f) -> f32 {
  if (max(abs(p.x), abs(p.y)) < S.gHalfIn) { return texAt(hIn, p, S.gHalfIn).x; }
  return texAt(hOut, p, S.gHalfOut).x;
}

fn hash(a: u32) -> u32 {
  var x = a;
  x ^= x >> 16u; x *= 0x7feb352du;
  x ^= x >> 15u; x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}
fn rnd(a: u32) -> f32 { return f32(hash(a) & 0xffffffu) / 16777216.0 - 0.5; }

// Inflow velocity of an edge cell. Coarse: the free stream with a slow,
// smooth turbulence. Fine: the coarse field at the same place.
fn inflow(x: u32, y: u32) -> vec2f {
  if (S.fine == 1u) {
    let cell = 2.0 * S.half / f32(S.nx);
    let s = vec2f(f32(x) + 0.5, f32(y) + 0.5) * cell - S.half;
    let uv = (s + S.cHalf) / (2.0 * S.cHalf);
    let m = textureSampleLevel(coarseIn, linS, uv, 0.0);
    return m.xy;
  }
  if (S.noise <= 0.0) { return vec2f(S.U, 0.0); }
  let fy = f32(y) / 10.0;
  let ft = f32(S.stepNo) / 40.0;
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

fn edgeType(x: u32, y: u32) -> u32 {
  if (S.closed == 1u) {
    if (x == 0u || y == 0u || x == S.nx - 1u || y == S.ny - 1u) { return T_WALL; }
    return T_FLUID;
  }
  if (x == S.nx - 1u) { return T_OUT; }
  if (x == 0u || y == 0u || y == S.ny - 1u) { return T_EQ; }
  return T_FLUID;
}

// Cell types and the force terms, after a new wind direction or slice.
@compute @workgroup_size(128)
fn voxelize(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= S.n) { return; }
  let x = i % S.nx;
  let y = i / S.nx;
  var t = edgeType(x, y);
  var a = vec4f(0.0);
  if (S.closed == 0u) {
    let p = worldOf(x, y);
    let ground = groundAt(p);
    var solid = ground > S.block;
    if (S.fine == 1u && max(abs(p.x), abs(p.y)) < S.bHalf) {
      solid = solid || texAt(bTex, p, S.bHalf).x > S.slice;
    }
    if (solid && t == T_FLUID) { t = T_WALL; }
    if (solid && t == T_EQ) { t = T_WALL; }
    // drag: land cover roughness (0..1) and the ground near the block level
    let rg = texAt(rTex, p, S.gHalfIn);
    let inner = max(abs(p.x), abs(p.y)) < S.gHalfIn;
    let rough = select(0.15, rg.x, inner);
    let hill = smoothstep(S.block - 120.0, S.block, ground);
    a.z = S.drag * (0.02 + rough) + 0.03 * hill;
    // sea breeze: toward higher land share
    if (inner && S.seaBreeze != 0.0) {
      let cell = 2.0 * S.gHalfIn / f32(textureDimensions(rTex).x);
      let gx = texAt(rTex, p + vec2f(cell, 0.0), S.gHalfIn).y - texAt(rTex, p - vec2f(cell, 0.0), S.gHalfIn).y;
      let gy = texAt(rTex, p + vec2f(0.0, cell), S.gHalfIn).y - texAt(rTex, p - vec2f(0.0, cell), S.gHalfIn).y;
      let gw = vec2f(gx, gy);
      let d = S.dir;
      a.x = S.seaBreeze * dot(gw, d);
      a.y = S.seaBreeze * dot(gw, vec2f(-d.y, d.x));
    }
  }
  types[i] = t;
  aux[i] = a;
}

// Both buffers at the equilibrium of the free stream (rest in walls).
@compute @workgroup_size(128)
fn initF(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= S.n) { return; }
  let solid = types[i] >= T_WALL;
  var u = vec2f(S.U, 0.0);
  if (S.closed == 1u) {
    // a test flow: a gentle swirl, so the box is not at rest
    let x = f32(i % S.nx) / f32(S.nx) - 0.5;
    let y = f32(i / S.nx) / f32(S.ny) - 0.5;
    u = vec2f(-y, x) * S.U * 2.0;
  }
  if (S.fine == 1u) { u = inflow(i % S.nx, i / S.nx); }
  if (solid) { u = vec2f(0.0); }
  for (var q = 0u; q < 9u; q++) {
    let e = feq(q, 1.0, u);
    fA[q * S.n + i] = e;
    fB[q * S.n + i] = e;
  }
}

const SPONGE = 14.0;
fn sponge(x: u32) -> f32 {
  if (S.closed == 1u) { return 0.0; }
  let t = clamp(1.0 - f32(S.nx - 1u - x) / SPONGE, 0.0, 1.0);
  return 0.15 * t * t;
}

@compute @workgroup_size(128)
fn step(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= S.n) { return; }
  let x = i % S.nx;
  let y = i / S.nx;
  let t = types[i];
  if (t >= T_WALL) {
    if (S.writeMacro == 1u) { textureStore(macroOut, vec2u(x, y), vec4f(0.0, 0.0, 0.0, 1.0)); }
    return;
  }
  if (t == T_EQ) {
    let u = inflow(x, y);
    for (var q = 0u; q < 9u; q++) { fB[q * S.n + i] = feq(q, 1.0, u); }
    if (S.writeMacro == 1u) { textureStore(macroOut, vec2u(x, y), vec4f(u, 0.0, 0.0)); }
    return;
  }
  var f: array<f32, 9>;
  for (var q = 0u; q < 9u; q++) {
    var sx = i32(x) - CX[q];
    let sy = clamp(i32(y) - CY[q], 0, i32(S.ny) - 1);
    if (sx >= i32(S.nx)) { sx = i32(S.nx) - 2; }
    sx = max(sx, 0);
    let s = u32(sx) + S.nx * u32(sy);
    if (types[s] >= T_WALL) {
      f[q] = fA[OPP[q] * S.n + i];
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
  if (bad) { rho = 1.0; u = vec2f(S.U, 0.0); } else { u /= rho; }
  let sp = length(u);
  if (sp > 0.3) { u *= 0.3 / sp; }

  // Smagorinsky: eddy viscosity from the non-equilibrium stress.
  var pxx = 0.0; var pyy = 0.0; var pxy = 0.0;
  for (var q = 0u; q < 9u; q++) {
    let ne = f[q] - feq(q, rho, u);
    let cx = f32(CX[q]); let cy = f32(CY[q]);
    pxx += cx * cx * ne; pyy += cy * cy * ne; pxy += cx * cy * ne;
  }
  let Q = pxx * pxx + pyy * pyy + 2.0 * pxy * pxy;
  let tau = 0.5 * (S.tau + sqrt(S.tau * S.tau + 0.76421222 * sqrt(Q) / rho));
  let om = 1.0 / tau;

  // drag and body force by the velocity shift
  let a = aux[i];
  var ue = u;
  if (S.closed == 0u) {
    ue = u + tau * (a.xy / rho - a.z * u);
    let se = length(ue);
    if (se > 0.3) { ue *= 0.3 / se; }
  }
  let sg = sponge(x);
  for (var q = 0u; q < 9u; q++) {
    let e = feq(q, rho, ue);
    let damp = sg * (feq(q, 1.0, ue) - e);
    fB[q * S.n + i] = select(f[q] + om * (e - f[q]) + damp, feq(q, 1.0, u), bad);
  }
  if (S.writeMacro == 1u) {
    textureStore(macroOut, vec2u(x, y), vec4f(u, rho - 1.0, 0.0));
  }
}

// Total mass, for the closed-box test: one partial sum per workgroup.
var<workgroup> part: array<f32, 128>;
@compute @workgroup_size(128)
fn massSum(@builtin(global_invocation_id) g: vec3u, @builtin(local_invocation_index) li: u32,
           @builtin(workgroup_id) wg: vec3u) {
  let i = g.x;
  var m = 0.0;
  if (i < S.n && types[i] < T_WALL) {
    for (var q = 0u; q < 9u; q++) { m += fA[q * S.n + i]; }
  }
  part[li] = m;
  workgroupBarrier();
  for (var k = 64u; k > 0u; k >>= 1u) {
    if (li < k) { part[li] += part[li + k]; }
    workgroupBarrier();
  }
  if (li == 0u) { aux[wg.x] = vec4f(part[0], 0.0, 0.0, 0.0); }
}
