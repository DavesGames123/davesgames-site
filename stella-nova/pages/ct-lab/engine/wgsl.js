// wgsl.js - WGSL compute kernels for the CT engine (used by gpu.js).
// Conventions match geometry.js and project.js (see CONTRACT.md).
// Every mixed && / || expression has parentheses (Chrome Tint rule).
//
// grep handles: FORWARD_2D, BACKPROJECT_2D, BACKPROJECT_CONE

const PARAMS_2D = /* wgsl */ `
struct Params {
  nx: u32, ny: u32, nDet: u32, nAngles: u32,
  px: f32, du: f32, offset: f32, sod: f32,
  sdd: f32, kind: u32, flags: u32, pad: u32,
};
@group(0) @binding(0) var<uniform> P: Params;
`;

export const FORWARD_2D = /* wgsl */ `${PARAMS_2D}
@group(0) @binding(1) var<storage, read> img: array<f32>;
@group(0) @binding(2) var<storage, read> angles: array<f32>;
@group(0) @binding(3) var<storage, read_write> sino: array<f32>;

fn pix(ix: i32, iy: i32) -> f32 {
  if ((ix < 0) || (iy < 0) || (ix >= i32(P.nx)) || (iy >= i32(P.ny))) { return 0.0; }
  return img[u32(iy) * P.nx + u32(ix)];
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  let a = gid.y;
  if ((i >= P.nDet) || (a >= P.nAngles)) { return; }
  let b = angles[a];
  let c = cos(b);
  let s = sin(b);
  let d = vec2f(-s, c);
  let n = vec2f(c, s);
  let u = (f32(i) - 0.5 * f32(P.nDet - 1u)) * P.du + P.offset;
  var o = u * n;
  var dir = d;
  if (P.kind != 0u) {
    o = -P.sod * d;
    if (P.kind == 2u) {
      let g = u / P.sdd;
      dir = cos(g) * d + sin(g) * n;
    } else {
      dir = normalize(P.sdd * d + u * n);
    }
  }
  let nxf = f32(P.nx);
  let nyf = f32(P.ny);
  let f0x = (o.x + 0.5 * nxf * P.px) / P.px - 0.5;
  let f0y = (0.5 * nyf * P.px - o.y) / P.px - 0.5;
  let gx = dir.x / P.px;
  let gy = -dir.y / P.px;
  var acc = 0.0;
  if (abs(gx) >= abs(gy)) {
    let sl = gy / gx;
    for (var ix = 0; ix < i32(P.nx); ix = ix + 1) {
      let fy = f0y + (f32(ix) - f0x) * sl;
      if ((fy <= -1.0) || (fy >= nyf)) { continue; }
      let i0 = floor(fy);
      let w = fy - i0;
      acc = acc + (1.0 - w) * pix(ix, i32(i0)) + w * pix(ix, i32(i0) + 1);
    }
    acc = acc / abs(gx);
  } else {
    let sl = gx / gy;
    for (var iy = 0; iy < i32(P.ny); iy = iy + 1) {
      let fx = f0x + (f32(iy) - f0y) * sl;
      if ((fx <= -1.0) || (fx >= nxf)) { continue; }
      let i0 = floor(fx);
      let w = fx - i0;
      acc = acc + (1.0 - w) * pix(i32(i0), iy) + w * pix(i32(i0) + 1, iy);
    }
    acc = acc / abs(gy);
  }
  sino[a * P.nDet + i] = acc;
}
`;

// Pixel-driven back-projection with linear interpolation. flags bit 0: distance weights (FBP).
export const BACKPROJECT_2D = /* wgsl */ `${PARAMS_2D}
@group(0) @binding(1) var<storage, read> sino: array<f32>;
@group(0) @binding(2) var<storage, read> angles: array<f32>;
@group(0) @binding(3) var<storage, read> weights: array<f32>;
@group(0) @binding(4) var<storage, read_write> img: array<f32>;

fn sample(row: u32, f: f32) -> f32 {
  if ((f <= -1.0) || (f >= f32(P.nDet))) { return 0.0; }
  let i0 = floor(f);
  let t = f - i0;
  let k = i32(i0);
  var v = 0.0;
  if (k >= 0) { v = v + (1.0 - t) * sino[row + u32(k)]; }
  if (k + 1 < i32(P.nDet)) { v = v + t * sino[row + u32(k + 1)]; }
  return v;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let ix = gid.x;
  let iy = gid.y;
  if ((ix >= P.nx) || (iy >= P.ny)) { return; }
  let x = (f32(ix) + 0.5) * P.px - 0.5 * f32(P.nx) * P.px;
  let y = 0.5 * f32(P.ny) * P.px - (f32(iy) + 0.5) * P.px;
  let c0 = 0.5 * f32(P.nDet - 1u);
  let dw = (P.flags & 1u) != 0u;
  var acc = 0.0;
  for (var a = 0u; a < P.nAngles; a = a + 1u) {
    let b = angles[a];
    let c = cos(b);
    let s = sin(b);
    let xn = x * c + y * s;
    var u = xn;
    var w = weights[a];
    if (P.kind != 0u) {
      let L = P.sod - x * s + y * c;
      if (P.kind == 2u) {
        u = P.sdd * atan2(xn, L);
        if (dw) { w = w / (L * L + xn * xn); }
      } else {
        u = P.sdd * xn / L;
        if (dw) { w = w * (P.sod * P.sod) / (L * L); }
      }
    }
    let f = (u - P.offset) / P.du + c0;
    acc = acc + w * sample(a * P.nDet, f);
  }
  img[iy * P.nx + ix] = acc;
}
`;

// Voxel-driven FDK back-projection (flat detector, circular orbit), bilinear detector sampling.
export const BACKPROJECT_CONE = /* wgsl */ `
struct Params {
  nx: u32, ny: u32, nz: u32, nAngles: u32,
  nu: u32, nv: u32, px: f32, du: f32,
  dv: f32, sod: f32, sdd: f32, pad: u32,
};
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> proj: array<f32>;
@group(0) @binding(2) var<storage, read> angles: array<f32>;
@group(0) @binding(3) var<storage, read> weights: array<f32>;
@group(0) @binding(4) var<storage, read_write> vol: array<f32>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let ix = gid.x;
  let iy = gid.y;
  let iz = gid.z;
  if ((ix >= P.nx) || (iy >= P.ny) || (iz >= P.nz)) { return; }
  let x = (f32(ix) + 0.5) * P.px - 0.5 * f32(P.nx) * P.px;
  let y = 0.5 * f32(P.ny) * P.px - (f32(iy) + 0.5) * P.px;
  let z = (f32(iz) + 0.5) * P.px - 0.5 * f32(P.nz) * P.px;
  let cu = 0.5 * f32(P.nu - 1u);
  let cv = 0.5 * f32(P.nv - 1u);
  var acc = 0.0;
  for (var a = 0u; a < P.nAngles; a = a + 1u) {
    let b = angles[a];
    let c = cos(b);
    let s = sin(b);
    let L = P.sod - x * s + y * c;
    let xn = x * c + y * s;
    let mag = P.sdd / L;
    let fu = mag * xn / P.du + cu;
    let fv = mag * z / P.dv + cv;
    if ((fu < 0.0) || (fu > f32(P.nu - 1u)) || (fv < 0.0) || (fv > f32(P.nv - 1u))) { continue; }
    let i0 = min(u32(fu), P.nu - 2u);
    let j0 = min(u32(fv), P.nv - 2u);
    let tu = fu - f32(i0);
    let tv = fv - f32(j0);
    let r0 = (a * P.nv + j0) * P.nu + i0;
    let r1 = r0 + P.nu;
    let v = (1.0 - tv) * ((1.0 - tu) * proj[r0] + tu * proj[r0 + 1u]) + tv * ((1.0 - tu) * proj[r1] + tu * proj[r1 + 1u]);
    acc = acc + weights[a] * (P.sod * P.sod) / (L * L) * v;
  }
  vol[(iz * P.ny + iy) * P.nx + ix] = acc;
}
`;
