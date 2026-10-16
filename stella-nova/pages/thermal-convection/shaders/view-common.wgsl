// ============================================================================
//  THERMAL CONVECTION  ·  shaders/view-common.wgsl — shared view code (VIEW)
// ----------------------------------------------------------------------------
//  render/views.js puts this file in front of view-prep.wgsl and
//  view-draw.wgsl. It holds struct View (packView in views.js writes it, the
//  field order is VIEW_FIELDS), the sim field bindings (T and vel, read only)
//  and the sampling math. views.js has a JS copy of each function, and
//  tests/view.test.mjs checks the copies.
//
//  Field layout (sim contract): index i + nx * (j + ny * k), k = 0 at the
//  bottom, cell centres at ((i + 0.5) dx, (j + 0.5) dy, (k + 0.5) dz).
//  Periodic in x and y, clamped in z.
//
//  grep -n targets: "struct View", "fn wrapi", "fn cellIdx", "fn sampleT",
//  "fn sampleV", "fn crw", "fn sectRow", "fn fkey", "fn funkey", "fn toneT",
//  "fn toLinear"
// ============================================================================

struct View {
  viewProj : mat4x4<f32>,
  dims   : vec4<f32>,  // nx, ny, nz, dz (= 1 / nz)
  box    : vec4<f32>,  // Lx, Ly, zScale, surfaceZ
  seg    : vec4<f32>,  // p0.x, p0.y, dir.x, dir.y   (slice line in the box)
  segB   : vec4<f32>,  // len, ns, nzs (= nz + 2), slab (tracer half width)
  tone   : vec4<f32>,  // gain, bias, auto (0 or 1), srgbOut (0 or 1)
  look   : vec4<f32>,  // relief, sheen, isotherms (0 or 1), dpr
  rSurf  : vec4<f32>,  // device px x, y, w, h of the surface rect
  rFluid : vec4<f32>,  // device px rect of the fluid section
  rBar   : vec4<f32>,  // device px rect of the hot-plate bar
  rBlock : vec4<f32>,  // device px rect of the block view
  over   : vec4<f32>,  // tracerCount, arrows in s, arrows in z, streak time
  eye    : vec4<f32>,  // block eye (box units, z scaled), cut line shown (0 or 1)
};

@group(0) @binding(0) var<uniform> V : View;
@group(0) @binding(1) var<storage, read> fieldT : array<f32>;
@group(0) @binding(2) var<storage, read> fieldV : array<vec4<f32>>;

fn wrapi(i : i32, n : i32) -> i32 {
  return ((i % n) + n) % n;
}

fn cellIdx(i : i32, j : i32, k : i32) -> u32 {
  let nx = i32(V.dims.x);
  let ny = i32(V.dims.y);
  let nz = i32(V.dims.z);
  let kk = clamp(k, 0, nz - 1);
  return u32(wrapi(i, nx) + nx * (wrapi(j, ny) + ny * kk));
}

// fractional cell coordinates of a box point (x, y periodic, z clamped)
fn gridCoord(p : vec3<f32>) -> vec3<f32> {
  let gx = p.x * (V.dims.x / V.box.x) - 0.5;
  let gy = p.y * (V.dims.y / V.box.y) - 0.5;
  let gz = clamp(p.z * V.dims.z - 0.5, 0.0, V.dims.z - 1.0);
  return vec3<f32>(gx, gy, gz);
}

// trilinear T at a box point
fn sampleT(p : vec3<f32>) -> f32 {
  let g = gridCoord(p);
  let b = floor(g);
  let f = g - b;
  let i = i32(b.x);
  let j = i32(b.y);
  let k = i32(b.z);
  let c00 = mix(fieldT[cellIdx(i, j, k)], fieldT[cellIdx(i + 1, j, k)], f.x);
  let c10 = mix(fieldT[cellIdx(i, j + 1, k)], fieldT[cellIdx(i + 1, j + 1, k)], f.x);
  let c01 = mix(fieldT[cellIdx(i, j, k + 1)], fieldT[cellIdx(i + 1, j, k + 1)], f.x);
  let c11 = mix(fieldT[cellIdx(i, j + 1, k + 1)], fieldT[cellIdx(i + 1, j + 1, k + 1)], f.x);
  return mix(mix(c00, c10, f.y), mix(c01, c11, f.y), f.z);
}

// trilinear velocity (u, v, w, 0) at a box point
fn sampleV(p : vec3<f32>) -> vec4<f32> {
  let g = gridCoord(p);
  let b = floor(g);
  let f = g - b;
  let i = i32(b.x);
  let j = i32(b.y);
  let k = i32(b.z);
  let c00 = mix(fieldV[cellIdx(i, j, k)], fieldV[cellIdx(i + 1, j, k)], f.x);
  let c10 = mix(fieldV[cellIdx(i, j + 1, k)], fieldV[cellIdx(i + 1, j + 1, k)], f.x);
  let c01 = mix(fieldV[cellIdx(i, j, k + 1)], fieldV[cellIdx(i + 1, j, k + 1)], f.x);
  let c11 = mix(fieldV[cellIdx(i, j + 1, k + 1)], fieldV[cellIdx(i + 1, j + 1, k + 1)], f.x);
  return mix(mix(c00, c10, f.y), mix(c01, c11, f.y), f.z);
}

// Catmull-Rom weights for the 4 taps at -1, 0, 1, 2 (sum = 1)
fn crw(t : f32) -> vec4<f32> {
  let t2 = t * t;
  let t3 = t2 * t;
  return vec4<f32>(
    (-0.5 * t3) + t2 - (0.5 * t),
    (1.5 * t3) - (2.5 * t2) + 1.0,
    (-1.5 * t3) + (2.0 * t2) + (0.5 * t),
    (0.5 * t3) - (0.5 * t2));
}

// z in [0, 1] -> section row in [0, nz + 1]: row 0 = bottom wall,
// rows 1..nz = cell centres, row nz + 1 = top wall
fn sectRow(z : f32) -> f32 {
  let nz = V.dims.z;
  let h = 0.5 / nz;
  let zc = clamp(z, 0.0, 1.0);
  if (zc <= h) { return zc / h; }
  if (zc >= 1.0 - h) { return nz + ((zc - (1.0 - h)) / h); }
  return 1.0 + ((zc - h) * nz);
}

// order-preserving f32 -> u32 key (for atomicMin / atomicMax)
fn fkey(f : f32) -> u32 {
  let b = bitcast<u32>(f);
  if ((b & 0x80000000u) != 0u) { return ~b; }
  return b | 0x80000000u;
}

fn funkey(k : u32) -> f32 {
  if ((k & 0x80000000u) != 0u) { return bitcast<f32>(k & 0x7fffffffu); }
  return bitcast<f32>(~k);
}

// temperature -> palette coordinate: auto range [lo, hi], then gain about bias
fn toneT(T : f32, lo : f32, hi : f32) -> f32 {
  var tn = T;
  if (V.tone.z > 0.5) { tn = (T - lo) / max(hi - lo, 1e-4); }
  return clamp(0.5 + (V.tone.x * (tn - V.tone.y)), 0.0, 1.0);
}

fn toLinear(c : vec3<f32>) -> vec3<f32> {
  let lo = c / 12.92;
  let hi = pow((c + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
  return select(hi, lo, c <= vec3<f32>(0.04045));
}
