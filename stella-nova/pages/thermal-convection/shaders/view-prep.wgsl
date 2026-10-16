// ============================================================================
//  THERMAL CONVECTION  ·  shaders/view-prep.wgsl — view prepass (VIEW)
// ----------------------------------------------------------------------------
//  Compute, once per frame before the render pass (view-common.wgsl is put
//  in front of this file):
//    csSurface  (8 x 8 per group, nx x ny) the horizontal section at
//               surfaceZ: surf[i + nx j] = (T, w, dw/dx, dw/dy). The draw
//               pass samples it with Catmull-Rom (crisp at magnification).
//    csSection  (8 x 8 per group, ns x nzs) the vertical section along the
//               slice line: sect[s + ns r] = (T, u_s, w, |(u_s, w)|), u_s =
//               velocity along the cut. Row 0 and row nz + 1 are the walls
//               (T extrapolated from the two nearest cells, no-slip bottom,
//               w = 0 at the top), rows 1..nz the cell centres (see sectRow).
//    csRange    (1 thread) folds this frame's min / max keys (atoms) into the
//               smoothed ranges (range[0] = surface T lo, hi, section T lo,
//               hi; range[1] = max |w| at the surface, max speed in the
//               section, ready flag) and resets the keys.
//  Every group reduces into workgroup atomics first, then one global atomic.
//
//  grep -n targets: "fn csSurface", "fn csSection", "fn csRange", "fn layerTV",
//  "var<workgroup> wg", "RANGE_EMA"
// ============================================================================

@group(0) @binding(3) var<storage, read_write> surf : array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> sect : array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> atoms : array<atomic<u32>, 8>;
@group(0) @binding(6) var<storage, read_write> range : array<vec4<f32>, 2>;

var<workgroup> wg : array<atomic<u32>, 4>;

const RANGE_EMA : f32 = 0.08;

// (T, u, v, w) at layer height surfaceZ for cell column (i, j), linear in z
fn layerTV(i : i32, j : i32, k0 : i32, k1 : i32, fz : f32) -> vec4<f32> {
  let a = cellIdx(i, j, k0);
  let b = cellIdx(i, j, k1);
  let t = mix(fieldT[a], fieldT[b], fz);
  let v = mix(fieldV[a], fieldV[b], fz);
  return vec4<f32>(t, v.x, v.y, v.z);
}

@compute @workgroup_size(8, 8)
fn csSurface(@builtin(global_invocation_id) gid : vec3<u32>, @builtin(local_invocation_index) li : u32) {
  if (li == 0u) {
    atomicStore(&wg[0], 0xffffffffu);
    atomicStore(&wg[1], 0u);
    atomicStore(&wg[2], 0u);
  }
  workgroupBarrier();
  let nx = u32(V.dims.x);
  let ny = u32(V.dims.y);
  if ((gid.x < nx) && (gid.y < ny)) {
    let nz = i32(V.dims.z);
    let gz = clamp((V.box.w * V.dims.z) - 0.5, 0.0, V.dims.z - 1.0);
    let k0 = i32(floor(gz));
    let k1 = min(k0 + 1, nz - 1);
    let fz = gz - f32(k0);
    let i = i32(gid.x);
    let j = i32(gid.y);
    let c = layerTV(i, j, k0, k1, fz);
    let dxs = V.box.x / V.dims.x;
    let dys = V.box.y / V.dims.y;
    let wE = layerTV(i + 1, j, k0, k1, fz).w;
    let wW = layerTV(i - 1, j, k0, k1, fz).w;
    let wN = layerTV(i, j + 1, k0, k1, fz).w;
    let wS = layerTV(i, j - 1, k0, k1, fz).w;
    surf[gid.x + (nx * gid.y)] = vec4<f32>(c.x, c.w, (wE - wW) / (2.0 * dxs), (wN - wS) / (2.0 * dys));
    atomicMin(&wg[0], fkey(c.x));
    atomicMax(&wg[1], fkey(c.x));
    atomicMax(&wg[2], fkey(abs(c.w)));
  }
  workgroupBarrier();
  if (li == 0u) {
    atomicMin(&atoms[0], atomicLoad(&wg[0]));
    atomicMax(&atoms[1], atomicLoad(&wg[1]));
    atomicMax(&atoms[2], atomicLoad(&wg[2]));
  }
}

// bilinear (T, u, v, w) in layer k at horizontal box point (x, y)
fn layerAt(x : f32, y : f32, k : i32) -> vec4<f32> {
  let gx = (x * (V.dims.x / V.box.x)) - 0.5;
  let gy = (y * (V.dims.y / V.box.y)) - 0.5;
  let bx = floor(gx);
  let by = floor(gy);
  let fx = gx - bx;
  let fy = gy - by;
  let i = i32(bx);
  let j = i32(by);
  let a = layerTV(i, j, k, k, 0.0);
  let b = layerTV(i + 1, j, k, k, 0.0);
  let c = layerTV(i, j + 1, k, k, 0.0);
  let d = layerTV(i + 1, j + 1, k, k, 0.0);
  return mix(mix(a, b, fx), mix(c, d, fx), fy);
}

@compute @workgroup_size(8, 8)
fn csSection(@builtin(global_invocation_id) gid : vec3<u32>, @builtin(local_invocation_index) li : u32) {
  if (li == 0u) {
    atomicStore(&wg[0], 0xffffffffu);
    atomicStore(&wg[1], 0u);
    atomicStore(&wg[2], 0u);
  }
  workgroupBarrier();
  let ns = u32(V.segB.y);
  let nzs = u32(V.segB.z);
  if ((gid.x < ns) && (gid.y < nzs)) {
    let nz = i32(V.dims.z);
    let s = V.segB.x * (f32(gid.x) / max(f32(ns) - 1.0, 1.0));
    let x = V.seg.x + (V.seg.z * s);
    let y = V.seg.y + (V.seg.w * s);
    let r = i32(gid.y);
    var q : vec4<f32>;
    if (r == 0) {
      let a = layerAt(x, y, 0);
      let b = layerAt(x, y, min(1, nz - 1));
      q = vec4<f32>((1.5 * a.x) - (0.5 * b.x), 0.0, 0.0, 0.0);
    } else if (r == nz + 1) {
      let a = layerAt(x, y, nz - 1);
      let b = layerAt(x, y, max(nz - 2, 0));
      q = vec4<f32>((1.5 * a.x) - (0.5 * b.x), a.y, a.z, 0.0);
    } else {
      q = layerAt(x, y, r - 1);
    }
    let us = (q.y * V.seg.z) + (q.z * V.seg.w);
    let sp = length(vec2<f32>(us, q.w));
    sect[gid.x + (ns * gid.y)] = vec4<f32>(q.x, us, q.w, sp);
    atomicMin(&wg[0], fkey(q.x));
    atomicMax(&wg[1], fkey(q.x));
    atomicMax(&wg[2], fkey(sp));
  }
  workgroupBarrier();
  if (li == 0u) {
    atomicMin(&atoms[3], atomicLoad(&wg[0]));
    atomicMax(&atoms[4], atomicLoad(&wg[1]));
    atomicMax(&atoms[5], atomicLoad(&wg[2]));
  }
}

@compute @workgroup_size(1)
fn csRange() {
  let k0 = atomicLoad(&atoms[0]);
  let k1 = atomicLoad(&atoms[1]);
  let k2 = atomicLoad(&atoms[2]);
  let k3 = atomicLoad(&atoms[3]);
  let k4 = atomicLoad(&atoms[4]);
  let k5 = atomicLoad(&atoms[5]);
  var r0 = range[0];
  var r1 = range[1];
  let a = select(RANGE_EMA, 1.0, r1.z < 0.5);
  if (k1 != 0u) {
    let lo = funkey(k0);
    let hi = funkey(k1);
    r0.x = mix(r0.x, lo, a);
    r0.y = mix(r0.y, hi, a);
    r1.x = mix(r1.x, funkey(k2), a);
  }
  if (k4 != 0u) {
    r0.z = mix(r0.z, funkey(k3), a);
    r0.w = mix(r0.w, funkey(k4), a);
    r1.y = mix(r1.y, funkey(k5), a);
  }
  if ((k1 != 0u) && (k4 != 0u)) { r1.z = 1.0; }
  range[0] = r0;
  range[1] = r1;
  atomicStore(&atoms[0], 0xffffffffu);
  atomicStore(&atoms[1], 0u);
  atomicStore(&atoms[2], 0u);
  atomicStore(&atoms[3], 0xffffffffu);
  atomicStore(&atoms[4], 0u);
  atomicStore(&atoms[5], 0u);
}
