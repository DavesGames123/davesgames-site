// THERMAL CONVECTION · shaders/sim-common.wgsl — shared part of every sim
// module. sim/gpu.js prepends this file to sim-advect, sim-fft, sim-tri and
// sim-misc. The numerics are specified in sim/ref.js (same names).
//
// Listing (grep -n "^fn \|^struct \|^@group" sim-common.wgsl):
//   struct Prm            the uniform (field order = UNIFORM_FIELDS in gpu.js)
//   prm   @binding(0)     uniform
//   vel   @binding(5)     cell-centred (u, v, w, 0), used by velAt()
//   wrapi, cidx           periodic index helpers
//   bottomT(i, j)         bottom wall temperature (burner patch or 1)
//   topGhostT(Tc)         ghost T above the top cell
//   pcg, u01              hash RNG (same as ref.js)
//   velAt(p)              trilinear cell-centred velocity, z clamped

struct Prm {
  nx: u32, ny: u32, nz: u32, nh: u32,
  n: u32, nxy: u32, specN: u32, tracerCount: u32,
  dx: f32, dt: f32, nu: f32, kappa: f32,
  Lx: f32, Ly: f32, maEff: f32, life: f32,
  mode: u32, topFree: u32, tRobin: u32, botNeumann: u32,
  rTop: f32, gTop: f32, hConst: f32, relax: f32,
  nHeat: u32, frame: u32, seed: u32, stX: u32,
  radX: u32, stY: u32, radY: u32, kMid: u32,
  bx: f32, by: f32, br: f32, bpow: f32,
};

@group(0) @binding(0) var<uniform> prm: Prm;
@group(0) @binding(5) var<storage, read_write> vel: array<vec4f>;

const PI: f32 = 3.14159265358979;
const TAU: f32 = 6.28318530717959;

fn wrapi(a: i32, m: i32) -> i32 {
  return ((a % m) + m) % m;
}

fn cidx(i: i32, j: i32, k: i32) -> u32 {
  return u32(i) + (prm.nx * (u32(j) + (prm.ny * u32(k))));
}

fn bottomT(i: i32, j: i32) -> f32 {
  if (prm.mode != 1u) { return 1.0; }
  let x = (f32(i) + 0.5) * prm.dx;
  let y = (f32(j) + 0.5) * prm.dx;
  var ddx = x - prm.bx;
  ddx = ddx - (prm.Lx * round(ddx / prm.Lx));
  var ddy = y - prm.by;
  ddy = ddy - (prm.Ly * round(ddy / prm.Ly));
  return 0.1 + (0.6 * prm.bpow * exp(-((ddx * ddx) + (ddy * ddy)) / (prm.br * prm.br)));
}

fn topGhostT(tc: f32) -> f32 {
  if (prm.tRobin == 1u) { return (prm.rTop * tc) - (prm.gTop * prm.hConst); }
  return -tc;
}

fn pcg(v: u32) -> u32 {
  let s = (v * 747796405u) + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

fn u01(h: u32) -> f32 {
  return f32(h >> 8u) / 16777216.0;
}

fn velAt(p: vec3f) -> vec3f {
  let nx = i32(prm.nx);
  let ny = i32(prm.ny);
  let nz = i32(prm.nz);
  let gx = (p.x / prm.dx) - 0.5;
  let gy = (p.y / prm.dx) - 0.5;
  let gz = clamp((p.z / prm.dx) - 0.5, 0.0, f32(nz - 1));
  let fx0 = floor(gx);
  let fy0 = floor(gy);
  let k0 = min(i32(floor(gz)), nz - 2);
  let fx = gx - fx0;
  let fy = gy - fy0;
  let fz = gz - f32(k0);
  let i0 = wrapi(i32(fx0), nx);
  let j0 = wrapi(i32(fy0), ny);
  let i1 = select(i0 + 1, 0, i0 + 1 == nx);
  let j1 = select(j0 + 1, 0, j0 + 1 == ny);
  let a00 = mix(vel[cidx(i0, j0, k0)].xyz, vel[cidx(i1, j0, k0)].xyz, fx);
  let a10 = mix(vel[cidx(i0, j1, k0)].xyz, vel[cidx(i1, j1, k0)].xyz, fx);
  let a01 = mix(vel[cidx(i0, j0, k0 + 1)].xyz, vel[cidx(i1, j0, k0 + 1)].xyz, fx);
  let a11 = mix(vel[cidx(i0, j1, k0 + 1)].xyz, vel[cidx(i1, j1, k0 + 1)].xyz, fx);
  return mix(mix(a00, a10, fy), mix(a01, a11, fy), fz);
}
