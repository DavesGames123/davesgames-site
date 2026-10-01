// lbm3d.wgsl — the 3D wind tunnel solver: a D3Q19 lattice Boltzmann method
// with BGK collision and a Smagorinsky eddy viscosity. sdf.wgsl is prepended.
//
// The scheme is the one of lbm2d.wgsl in three dimensions: pull streaming,
// boundaries, collision, write the other buffer. Populations are stored by
// direction: f[q * n + cell], cell = x + nx * (y + ny * z).
//
// Cell types (buffer `types`, written by voxelize):
//   0 fluid   1 inlet (equilibrium at the inlet velocity)   2 outlet
//   4 fixed ground wall   5 moving ground belt   6 free-slip wall
//   8 + k solid, copy k
//
// Belt gap. On a moving belt, a fixed solid that touches the floor, or sits
// one cell above it, is a singular contact: the belt drives the body
// through the gap (truck Cd 5.7). On a belt, voxelize keeps the two rows
// above the floor fluid (truck Cd 1.36). The views still draw the wheels on
// the floor.
//
// The roof (y = ny - 1) and the two side walls (z = 0, z = nz - 1) are
// free-slip, and so is the floor when there is no ground. A population that
// arrives from a free-slip cell is the mirror population of the cell next to
// it: flip the components of c that cross the wall, and keep the cell
// coordinate on those axes.
//
// The force sums -2 (f - w_q) c_q, not -2 f c_q. The w_q part is the
// reference pressure rho0 / 3. It cancels on a closed body, but not on a
// body that stands on the floor: the hoof soles are not wetted, so it
// gave the cow a false downforce (lift coefficient -5.4).
//
// The measure step writes the macro texture (ux, uy, uz, rho - 1) and adds
// the momentum exchange of each solid link to forces[3 * copy + axis].
// forces[12 + k] gets the frontal cells of copy k from area().
//
// grep: struct SimU  fn feq  fn inlet  fn boundaryType  fn voxelize  fn initF
//       fn step  fn area  fn sponge  fn dirOf

// Sponge. The free-slip walls reflect sound fully, so a pressure wave from
// the start or from vortex shedding rings between roof and floor (the 2D car
// lift oscillated with the 1000-step period of that standing wave). In a band
// SPONGE cells wide along the slip walls and the outlet, collision also pulls
// the density toward 1 at the local velocity. That damps the sound and
// leaves the flow.

struct SimU {
  nx: u32, ny: u32, nz: u32, n: u32,
  U: f32,
  tau: f32,
  noise: f32,
  beltU: f32,
  step: u32,
  measure: u32,
  ground: u32,    // 0 none (free-slip floor), 1 fixed wall, 2 belt
  pad: u32,
};

@group(0) @binding(0) var<uniform> S: SimU;
@group(0) @binding(1) var<uniform> SH: ShapeU;
@group(0) @binding(2) var<storage, read_write> fA: array<f32>;
@group(0) @binding(3) var<storage, read_write> fB: array<f32>;
@group(0) @binding(4) var<storage, read_write> types: array<u32>;
@group(0) @binding(5) var macroOut: texture_storage_3d<rgba16float, write>;
@group(0) @binding(6) var<storage, read_write> forces: array<atomic<i32>, 16>;

const FIX = 1048576.0;
const T_FLUID = 0u;
const T_EQ = 1u;
const T_OUT = 2u;
const T_WALL = 4u;
const T_BELT = 5u;
const T_SLIP = 6u;
const T_SOLID = 8u;

var<private> C: array<vec3i, 19> = array<vec3i, 19>(
  vec3i(0, 0, 0),
  vec3i(1, 0, 0), vec3i(-1, 0, 0), vec3i(0, 1, 0), vec3i(0, -1, 0), vec3i(0, 0, 1), vec3i(0, 0, -1),
  vec3i(1, 1, 0), vec3i(-1, -1, 0), vec3i(1, 0, 1), vec3i(-1, 0, -1), vec3i(0, 1, 1), vec3i(0, -1, -1),
  vec3i(1, -1, 0), vec3i(-1, 1, 0), vec3i(1, 0, -1), vec3i(-1, 0, 1), vec3i(0, 1, -1), vec3i(0, -1, 1));

fn wq(q: u32) -> f32 {
  if (q == 0u) { return 1.0 / 3.0; }
  if (q < 7u) { return 1.0 / 18.0; }
  return 1.0 / 36.0;
}
fn opp(q: u32) -> u32 {
  if (q == 0u) { return 0u; }
  return select(q - 1u, q + 1u, (q & 1u) == 1u);
}
fn dirOf(c: vec3i) -> u32 {
  for (var q = 0u; q < 19u; q++) { if (all(C[q] == c)) { return q; } }
  return 0u;
}

fn feq(q: u32, rho: f32, u: vec3f) -> f32 {
  let cu = dot(vec3f(C[q]), u);
  return wq(q) * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * dot(u, u));
}

fn idx(x: u32, y: u32, z: u32) -> u32 { return x + S.nx * (y + S.ny * z); }

const SPONGE = 10.0;
fn ramp(d: f32) -> f32 { let t = clamp(1.0 - d / SPONGE, 0.0, 1.0); return t * t; }
fn sponge(x: u32, y: u32, z: u32) -> f32 {
  var r = max(ramp(f32(S.ny - 1u - y)), ramp(f32(S.nx - 1u - x)));
  r = max(r, max(ramp(f32(z)), ramp(f32(S.nz - 1u - z))));
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
fn lat(i: vec3u, c: u32) -> f32 {
  return f32(hash((i.x * 73856093u) ^ (i.y * 19349663u) ^ (i.z * 83492791u) ^ (c * 2654435761u)) & 0xffffu) / 65536.0 - 0.5;
}
fn vn(p: vec3f, c: u32) -> f32 {
  let i = vec3u(floor(p));
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = mix(mix(lat(i, c), lat(i + vec3u(1u, 0u, 0u), c), u.x), mix(lat(i + vec3u(0u, 1u, 0u), c), lat(i + vec3u(1u, 1u, 0u), c), u.x), u.y);
  let b = mix(mix(lat(i + vec3u(0u, 0u, 1u), c), lat(i + vec3u(1u, 0u, 1u), c), u.x), mix(lat(i + vec3u(0u, 1u, 1u), c), lat(i + vec3u(1u, 1u, 1u), c), u.x), u.y);
  return mix(a, b, u.z);
}

// Inlet velocity with turbulence that is smooth in y, z (6 cells) and time
// (16 steps).
fn inlet(y: u32, z: u32) -> vec3f {
  if (S.noise <= 0.0) { return vec3f(S.U, 0.0, 0.0); }
  let p = vec3f(f32(y) / 6.0, f32(z) / 6.0, f32(S.step) / 16.0);
  let a = 2.0 * S.noise * S.U;
  return vec3f(S.U + a * vn(p, 0u), a * vn(p, 1u), a * vn(p, 2u));
}

fn boundaryType(x: u32, y: u32, z: u32) -> u32 {
  var t = T_FLUID;
  if (z == 0u || z == S.nz - 1u || y == S.ny - 1u) { t = T_SLIP; }
  if (y == 0u) {
    if (S.ground == 1u) { t = T_WALL; }
    else if (S.ground == 2u) { t = T_BELT; }
    else { t = T_SLIP; }
  }
  if (t == T_FLUID) {
    if (x == 0u) { t = T_EQ; }
    if (x == S.nx - 1u) { t = T_OUT; }
  }
  return t;
}

@compute @workgroup_size(128)
fn voxelize(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= S.n) { return; }
  let x = i % S.nx;
  let y = (i / S.nx) % S.ny;
  let z = i / (S.nx * S.ny);
  var t = boundaryType(x, y, z);
  if (t == T_FLUID || t == T_OUT) {
    let o = objDist(vec3f(f32(x), f32(y), f32(z)) + 0.5);
    if (o.x < 0.0 && !(S.ground == 2u && y < 3u)) { t = T_SOLID + u32(o.z); }
  }
  let old = types[i];
  if (old >= T_SOLID && t < T_WALL) {
    for (var q = 0u; q < 19u; q++) {
      let e = feq(q, 1.0, vec3f(0.0));
      fA[q * S.n + i] = e;
      fB[q * S.n + i] = e;
    }
  }
  types[i] = t;
}

@compute @workgroup_size(128)
fn initF(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= S.n) { return; }
  let solid = types[i] >= T_WALL;
  let u = select(vec3f(S.U, 0.0, 0.0), vec3f(0.0), solid);
  for (var q = 0u; q < 19u; q++) {
    let e = feq(q, 1.0, u);
    fA[q * S.n + i] = e;
    fB[q * S.n + i] = e;
  }
}

var<workgroup> wf: array<atomic<i32>, 12>;

@compute @workgroup_size(128)
fn step(@builtin(global_invocation_id) g: vec3u, @builtin(local_invocation_index) li: u32) {
  let measure = S.measure != 0u;
  if (measure && li < 12u) { atomicStore(&wf[li], 0); }
  workgroupBarrier();

  let i = g.x;
  if (i < S.n) {
    let x = i % S.nx;
    let y = (i / S.nx) % S.ny;
    let z = i / (S.nx * S.ny);
    let t = types[i];
    let pos = vec3u(x, y, z);
    if (t >= T_WALL) {
      // A free-slip wall shows the free stream (see lbm2d.wgsl).
      if (measure) { textureStore(macroOut, pos, select(vec4f(0.0), vec4f(S.U, 0.0, 0.0, 0.0), t == T_SLIP)); }
    } else if (t == T_EQ) {
      let u = inlet(y, z);
      for (var q = 0u; q < 19u; q++) { fB[q * S.n + i] = feq(q, 1.0, u); }
      if (measure) { textureStore(macroOut, pos, vec4f(u, 0.0)); }
    } else {
      var f: array<f32, 19>;
      var fx = vec3f(0.0);
      var copy = 0u;
      var hit = false;
      let maxc = vec3i(i32(S.nx) - 1, i32(S.ny) - 1, i32(S.nz) - 1);
      for (var q = 0u; q < 19u; q++) {
        let c = C[q];
        var sp = vec3i(pos) - c;
        if (sp.x > maxc.x) { sp.x = maxc.x - 1; }
        sp = clamp(sp, vec3i(0), maxc);
        let s = idx(u32(sp.x), u32(sp.y), u32(sp.z));
        let st = types[s];
        if (st == T_SLIP) {
          // Which axes cross a free-slip wall.
          let fy = (sp.y == maxc.y) || (sp.y == 0 && S.ground == 0u);
          let fz = sp.z == 0 || sp.z == maxc.z;
          var cm = c;
          var o = vec3i(pos) - c;
          if (fy) { cm.y = -c.y; o.y = i32(y); }
          if (fz) { cm.z = -c.z; o.z = i32(z); }
          o = clamp(o, vec3i(0), maxc);
          if (fy || fz) {
            f[q] = fA[dirOf(cm) * S.n + idx(u32(o.x), u32(o.y), u32(o.z))];
          } else {
            f[q] = fA[opp(q) * S.n + i];
          }
        } else if (st >= T_WALL) {
          let a = fA[opp(q) * S.n + i];
          var v = a;
          if (st == T_BELT) { v += 6.0 * wq(q) * f32(c.x) * S.beltU; }
          f[q] = v;
          if (st >= T_SOLID) {
            fx -= 2.0 * (a - wq(q)) * vec3f(c);
            copy = st - T_SOLID;
            hit = true;
          }
        } else {
          f[q] = fA[q * S.n + s];
        }
      }

      var rho = 0.0;
      var u = vec3f(0.0);
      for (var q = 0u; q < 19u; q++) {
        rho += f[q];
        u += f[q] * vec3f(C[q]);
      }
      let bad = !(rho > 0.2 && rho < 5.0);
      if (bad) { rho = 1.0; u = vec3f(S.U, 0.0, 0.0); }
      else { u /= rho; }
      let spd = length(u);
      if (spd > 0.35) { u *= 0.35 / spd; }

      var pxx = 0.0; var pyy = 0.0; var pzz = 0.0;
      var pxy = 0.0; var pxz = 0.0; var pyz = 0.0;
      for (var q = 0u; q < 19u; q++) {
        let ne = f[q] - feq(q, rho, u);
        let c = vec3f(C[q]);
        pxx += c.x * c.x * ne; pyy += c.y * c.y * ne; pzz += c.z * c.z * ne;
        pxy += c.x * c.y * ne; pxz += c.x * c.z * ne; pyz += c.y * c.z * ne;
      }
      let Q = pxx * pxx + pyy * pyy + pzz * pzz + 2.0 * (pxy * pxy + pxz * pxz + pyz * pyz);
      let tau = 0.5 * (S.tau + sqrt(S.tau * S.tau + 0.76421222 * sqrt(Q) / rho));
      let om = 1.0 / tau;

      let sg = sponge(x, y, z);
      for (var q = 0u; q < 19u; q++) {
        let e = feq(q, rho, u);
        let damp = sg * (feq(q, 1.0, u) - e);
        fB[q * S.n + i] = select(f[q] + om * (e - f[q]) + damp, e, bad);
      }
      if (measure) {
        textureStore(macroOut, pos, vec4f(u, rho - 1.0));
        if (hit) {
          atomicAdd(&wf[copy * 3u], i32(round(fx.x * FIX)));
          atomicAdd(&wf[copy * 3u + 1u], i32(round(fx.y * FIX)));
          atomicAdd(&wf[copy * 3u + 2u], i32(round(fx.z * FIX)));
        }
      }
    }
  }

  workgroupBarrier();
  if (measure && li < 12u) {
    let v = atomicLoad(&wf[li]);
    if (v != 0) { atomicAdd(&forces[li], v); }
  }
}

// Frontal cells per copy: the (y, z) columns that hold any solid of copy k.
@compute @workgroup_size(64)
fn area(@builtin(global_invocation_id) g: vec3u) {
  let c = g.x;
  if (c >= S.ny * S.nz) { return; }
  let y = c % S.ny;
  let z = c / S.ny;
  var mask = 0u;
  for (var x = 0u; x < S.nx; x++) {
    let t = types[idx(x, y, z)];
    if (t >= T_SOLID) { mask |= 1u << (t - T_SOLID); }
  }
  for (var k = 0u; k < 4u; k++) {
    if ((mask & (1u << k)) != 0u) { atomicAdd(&forces[12u + k], 1); }
  }
}
