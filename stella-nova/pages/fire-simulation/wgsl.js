// ============================================================================
//  FIRE SIMULATION  ·  pages/fire-simulation/wgsl.js — WebGPU compute shaders
// ----------------------------------------------------------------------------
//  Our code (davesgames.io). One WGSL module per pass. Each pass is a line
//  by line copy of the CPU pass of the same name in solver.js (same texel
//  rules, same order), so the node tests of solver.js speak for the GPU.
//  Textures: state rgba16float (u left face, v bottom face, T centre),
//  curl r32float, src rgba32float (T source, jet, stir u, stir v),
//  multigrid levels rg32float (p, f), emit rgba16float (glow light),
//  lut rgba8unorm (n x 2: flame colour + alpha, glow).
//  Mixed operators carry explicit parentheses (Chrome Tint rejects some).
//
//  WGSL.<pass> for pass in: curl force div smooth restrict prolong project
//  advect mac resample emit render
//  grep -n targets: "const STEP", "const COMMON", "curl:", "force:", "mac:",
//  "render:"
// ============================================================================

// The step uniform: 20 floats, then 32 swirls (x, y, spin, radius).
// gpu.js packs it in this order (STEP_FIELDS).
const STEP = /* wgsl */`
struct Step {
  dt: f32, h: f32, nx: f32, ny: f32,
  lift: f32, accel: f32, gravity: f32, eps: f32,
  visc: f32, drag: f32, wind: f32, floorH: f32,
  pertX: f32, pertY: f32, kappa: f32, fireCool: f32,
  smokeCool: f32, nSwirl: f32, spin: f32, flameT: f32,
  swirl: array<vec4<f32>, 32>,
};
@group(0) @binding(0) var<uniform> P: Step;
`;
const LEVEL = /* wgsl */`
struct Lv { w: f32, h: f32, color: f32, omega: f32, gc: f32, cw: f32, ch: f32, cgc: f32 };
@group(0) @binding(0) var<uniform> L: Lv;
`;
const COMMON = /* wgsl */`
fn sstep(e0: f32, e1: f32, x: f32) -> f32 { let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0); return t * t * (3.0 - (2.0 * t)); }
fn ld(t: texture_2d<f32>, i: i32, j: i32) -> vec4<f32> { return textureLoad(t, vec2<i32>(i, j), 0); }
`;
const MAIN = `@compute @workgroup_size(8, 8)\nfn main(@builtin(global_invocation_id) g: vec3<u32>) {`;

// Border rules (solver.js borderU / borderV), reading the pass input A.
const BORDER = /* wgsl */`
fn borderU(i: i32, j: i32) -> f32 {
  let ny = i32(P.ny);
  if (j == 0) { return 0.0; }
  if (j == ny - 1) { return ld(A, i, ny - 2).x; }
  return ld(A, 1, j).x;
}
fn borderV(i: i32, j: i32) -> f32 {
  let nx = i32(P.nx);
  if (j <= 1) { return 0.0; }
  return ld(A, select(nx - 2, 1, i == 0), j).y;
}
// bilinear sample of component c of A at (x, y) metres, field offset (ox, oy) cells
fn sampleA(c: i32, x: f32, y: f32, ox: f32, oy: f32) -> f32 {
  let gx = clamp((x / P.h) - ox, 0.0, P.nx - 1.001);
  let gy = clamp((y / P.h) - oy, 0.0, P.ny - 1.001);
  let i0 = i32(floor(gx)); let j0 = i32(floor(gy));
  let tx = gx - f32(i0); let ty = gy - f32(j0);
  let a = ld(A, i0, j0)[c]; let b = ld(A, i0 + 1, j0)[c];
  let d = ld(A, i0, j0 + 1)[c]; let e = ld(A, i0 + 1, j0 + 1)[c];
  return ((1.0 - tx) * (1.0 - ty) * a) + (tx * (1.0 - ty) * b) + ((1.0 - tx) * ty * d) + (tx * ty * e);
}
`;

export const WGSL = {
  curl: STEP + COMMON + /* wgsl */`
@group(0) @binding(1) var A: texture_2d<f32>;
@group(0) @binding(2) var O: texture_storage_2d<r32float, write>;
${MAIN}
  let nx = i32(P.nx); let ny = i32(P.ny); let i = i32(g.x); let j = i32(g.y);
  if (i >= nx || j >= ny) { return; }
  var w = 0.0;
  if (i >= 1 && j >= 1 && i <= nx - 2 && j <= ny - 2) {
    let vr = ld(A, i + 1, j).y + ld(A, i + 1, j + 1).y;
    let vl = ld(A, i - 1, j).y + ld(A, i - 1, j + 1).y;
    let ut = ld(A, i, j + 1).x + ld(A, i + 1, j + 1).x;
    let ub = ld(A, i, j - 1).x + ld(A, i + 1, j - 1).x;
    w = ((vr - vl) - (ut - ub)) * (0.25 / P.h);
  }
  textureStore(O, vec2<i32>(i, j), vec4<f32>(w, 0.0, 0.0, 0.0));
}`,

  force: STEP + COMMON + /* wgsl */`
@group(0) @binding(1) var A: texture_2d<f32>;
@group(0) @binding(2) var W: texture_2d<f32>;
@group(0) @binding(3) var SRC: texture_2d<f32>;
@group(0) @binding(4) var O: texture_storage_2d<rgba16float, write>;
` + BORDER + /* wgsl */`
fn lw(i: i32, j: i32) -> f32 { return ld(W, i, j).x; }
fn confW(t: f32) -> f32 { return sstep(0.02, 0.1, t) * (1.0 - sstep(0.5, 0.85, t)); }
fn viscW(t: f32) -> f32 { return sstep(0.35, 0.9, t); }
fn conf(ci: i32, cj: i32) -> vec2<f32> {
  let nx = i32(P.nx); let ny = i32(P.ny);
  if (ci < 1 || cj < 1 || ci > nx - 2 || cj > ny - 2) { return vec2<f32>(0.0, 0.0); }
  let wc = lw(ci, cj); let wt = confW(ld(A, ci, cj).z);
  if (!(wt > 0.0) || wc == 0.0) { return vec2<f32>(0.0, 0.0); }
  let gx = (abs(lw(ci + 1, cj)) - abs(lw(ci - 1, cj))) * (0.5 / P.h);
  let gy = (abs(lw(ci, cj + 1)) - abs(lw(ci, cj - 1))) * (0.5 / P.h);
  let len = sqrt((gx * gx) + (gy * gy)) + 1e-5;
  let s = P.eps * P.h * wt * wc;
  return vec2<f32>((s * gy) / len, -(s * gx) / len);
}
${MAIN}
  let nx = i32(P.nx); let ny = i32(P.ny); let i = i32(g.x); let j = i32(g.y);
  if (i >= nx || j >= ny) { return; }
  let a = ld(A, i, j);
  var o = vec4<f32>(0.0, 0.0, a.z, 0.0);
  let cc = conf(i, j);
  let ns = i32(P.nSwirl);
  if (i >= 1 && j >= 1 && j <= ny - 2) {
    var u = a.x;
    let al = ld(A, i - 1, j);
    let tu = 0.5 * (al.z + a.z);
    let av = P.visc * viscW(tu);
    if (av > 0.0) {
      let ur = ld(A, min(i + 1, nx - 1), j).x;
      u = u + (av * ((0.25 * (al.x + ur + ld(A, i, j - 1).x + ld(A, i, j + 1).x)) - u));
    }
    u = u + (P.dt * 0.5 * (conf(i - 1, j).x + cc.x));
    let s0 = ld(SRC, i - 1, j); let s1 = ld(SRC, i, j);
    let sr = 0.5 * (s0.x + s1.x);
    u = u + (0.5 * (s0.z + s1.z)) + (P.pertX * sr);
    let x = f32(i) * P.h; let yc = (f32(j) + 0.5) * P.h;
    for (var q = 0; q < ns; q = q + 1) {
      let s = P.swirl[q]; let rx = x - s.x; let ry = yc - s.y;
      let r2 = (rx * rx) + (ry * ry); let R2 = s.w * s.w;
      if (r2 < R2) { let m = 1.0 - (r2 / R2); u = u + (P.dt * P.spin * m * m * ry * s.z); }
    }
    u = u - (u * P.drag * (1.0 - sstep(0.0, 0.1, tu)));
    if (yc < P.floorH) { u = 0.0; }
    if ((i == 1 && P.wind > 0.0) || (i == nx - 1 && P.wind < 0.0)) { u = u + ((P.wind - u) * 0.2); }
    o.x = u;
  } else { o.x = borderU(i, j); }
  if (i >= 1 && i <= nx - 2 && j >= 2) {
    var v = a.y;
    let ab = ld(A, i, j - 1);
    let tv = 0.5 * (ab.z + a.z);
    let av = P.visc * viscW(tv);
    if (av > 0.0) {
      let vt = ld(A, i, min(j + 1, ny - 1)).y;
      v = v + (av * ((0.25 * (ld(A, i - 1, j).y + ld(A, i + 1, j).y + ab.y + vt)) - v));
    }
    v = v + ((P.lift * tv) - v) * P.accel + (P.gravity * P.dt);
    v = v + (P.dt * 0.5 * (conf(i, j - 1).y + cc.y));
    let s0 = ld(SRC, i, j - 1); let s1 = ld(SRC, i, j);
    let sr = 0.5 * (s0.x + s1.x);
    v = v + (0.5 * (s0.w + s1.w)) + (P.pertY * sr);
    let jet = max(s0.y, s1.y);
    if (jet > 0.0) { v = max(v, jet); }
    let xc = (f32(i) + 0.5) * P.h; let y = f32(j) * P.h;
    for (var q = 0; q < ns; q = q + 1) {
      let s = P.swirl[q]; let rx = xc - s.x; let ry = y - s.y;
      let r2 = (rx * rx) + (ry * ry); let R2 = s.w * s.w;
      if (r2 < R2) { let m = 1.0 - (r2 / R2); v = v - (P.dt * P.spin * m * m * rx * s.z); }
    }
    if (y < P.floorH) { v = 0.0; }
    o.y = v;
  } else { o.y = borderV(i, j); }
  textureStore(O, vec2<i32>(i, j), o);
}`,

  // (p from the last step, divergence of B); 0 on the border
  div: STEP + COMMON + /* wgsl */`
@group(0) @binding(1) var B: texture_2d<f32>;
@group(0) @binding(2) var Q: texture_2d<f32>;
@group(0) @binding(3) var O: texture_storage_2d<rg32float, write>;
${MAIN}
  let nx = i32(P.nx); let ny = i32(P.ny); let i = i32(g.x); let j = i32(g.y);
  if (i >= nx || j >= ny) { return; }
  var o = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  if (i >= 1 && j >= 1 && i <= nx - 2 && j <= ny - 2) {
    let b = ld(B, i, j);
    o = vec4<f32>(ld(Q, i, j).x, (ld(B, i + 1, j).x - b.x) + (ld(B, i, j + 1).y - b.y), 0.0, 0.0);
  }
  textureStore(O, vec2<i32>(i, j), o);
}`,

  smooth: LEVEL + COMMON + /* wgsl */`
@group(0) @binding(1) var X: texture_2d<f32>;
@group(0) @binding(2) var O: texture_storage_2d<rg32float, write>;
${MAIN}
  let W = i32(L.w); let H = i32(L.h); let i = i32(g.x); let j = i32(g.y);
  if (i >= W || j >= H) { return; }
  let c = ld(X, i, j);
  var p = c.x;
  if (i >= 1 && j >= 1 && i <= W - 2 && j <= H - 2 && ((i + j) & 1) == i32(L.color)) {
    let m = f32(select(0, 1, i == 1) + select(0, 1, i == W - 2) + select(0, 1, j == H - 2));
    let n = select(4.0, 3.0, j == 1) - (L.gc * m);
    var sum = ld(X, i - 1, j).x + ld(X, i + 1, j).x + ld(X, i, j + 1).x;
    if (j > 1) { sum = sum + ld(X, i, j - 1).x; }
    p = ((1.0 - L.omega) * p) + ((L.omega * (sum - c.y)) / n);
  }
  textureStore(O, vec2<i32>(i, j), vec4<f32>(p, c.y, 0.0, 0.0));
}`,

  // dispatch over the coarse level; L.w/h/gc = fine, L.cw/ch = coarse
  restrict: LEVEL + COMMON + /* wgsl */`
@group(0) @binding(1) var X: texture_2d<f32>;
@group(0) @binding(2) var O: texture_storage_2d<rg32float, write>;
fn res(x: i32, y: i32) -> f32 {
  let W = i32(L.w); let H = i32(L.h);
  let c = ld(X, x, y);
  let m = f32(select(0, 1, x == 1) + select(0, 1, x == W - 2) + select(0, 1, y == H - 2));
  let n = select(4.0, 3.0, y == 1) - (L.gc * m);
  var sum = ld(X, x - 1, y).x + ld(X, x + 1, y).x + ld(X, x, y + 1).x;
  if (y > 1) { sum = sum + ld(X, x, y - 1).x; }
  return c.y - (sum - (n * c.x));
}
${MAIN}
  let CW = i32(L.cw); let CH = i32(L.ch); let I = i32(g.x); let J = i32(g.y);
  if (I >= CW || J >= CH) { return; }
  var f = 0.0;
  if (I >= 1 && J >= 1 && I <= CW - 2 && J <= CH - 2) {
    var s = 0.0; var c = 0.0;
    for (var y = (2 * J) - 1; y <= 2 * J; y = y + 1) {
      for (var x = (2 * I) - 1; x <= 2 * I; x = x + 1) {
        if (x <= i32(L.w) - 2 && y <= i32(L.h) - 2) { s = s + res(x, y); c = c + 1.0; }
      }
    }
    if (c > 0.0) { f = (s * 4.0) / c; }
  }
  textureStore(O, vec2<i32>(I, J), vec4<f32>(0.0, f, 0.0, 0.0));
}`,

  // dispatch over the fine level; L.w/h = fine, L.cw/ch = coarse
  prolong: LEVEL + COMMON + /* wgsl */`
@group(0) @binding(1) var X: texture_2d<f32>;
@group(0) @binding(2) var C: texture_2d<f32>;
@group(0) @binding(3) var O: texture_storage_2d<rg32float, write>;
${MAIN}
  let W = i32(L.w); let H = i32(L.h); let x = i32(g.x); let y = i32(g.y);
  if (x >= W || y >= H) { return; }
  var c = ld(X, x, y);
  if (x >= 1 && y >= 1 && x <= W - 2 && y <= H - 2) {
    let I = (x + 1) >> 1u; let J = (y + 1) >> 1u;
    let I2 = select(I + 1, I - 1, (x & 1) == 1);
    var J2 = select(J + 1, J - 1, (y & 1) == 1);
    if (J2 == 0) { J2 = 1; }
    let e = (0.5625 * ld(C, I, J).x) + (0.1875 * (ld(C, I2, J).x + ld(C, I, J2).x)) + (0.0625 * ld(C, I2, J2).x);
    c.x = c.x + e;
  }
  textureStore(O, vec2<i32>(x, y), vec4<f32>(c.x, c.y, 0.0, 0.0));
}`,

  project: STEP + COMMON + /* wgsl */`
@group(0) @binding(1) var B: texture_2d<f32>;
@group(0) @binding(2) var Q: texture_2d<f32>;
@group(0) @binding(3) var O: texture_storage_2d<rgba16float, write>;
fn lp(i: i32, j: i32) -> f32 { return ld(Q, i, j).x; }
${MAIN}
  let nx = i32(P.nx); let ny = i32(P.ny); let i = i32(g.x); let j = i32(g.y);
  if (i >= nx || j >= ny) { return; }
  var o = ld(B, i, j);
  if (i >= 1 && j >= 1 && j <= ny - 2) {
    o.x = o.x - (select(0.0, lp(i, j), i <= nx - 2) - select(0.0, lp(i - 1, j), i >= 2));
  }
  if (i >= 1 && i <= nx - 2 && j >= 2) {
    o.y = o.y - (select(0.0, lp(i, j), j <= ny - 2) - lp(i, j - 1));
  }
  textureStore(O, vec2<i32>(i, j), o);
}`,

  advect: STEP + COMMON + /* wgsl */`
@group(0) @binding(1) var A: texture_2d<f32>;
@group(0) @binding(2) var O: texture_storage_2d<rgba16float, write>;
` + BORDER + /* wgsl */`
${MAIN}
  let nx = i32(P.nx); let ny = i32(P.ny); let i = i32(g.x); let j = i32(g.y);
  if (i >= nx || j >= ny) { return; }
  let a = ld(A, i, j);
  var o = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  let h = P.h; let dt = P.dt;
  if (i >= 1 && j >= 1 && j <= ny - 2) {
    let vb = 0.25 * (ld(A, i - 1, j).y + a.y + ld(A, i - 1, j + 1).y + ld(A, i, j + 1).y);
    o.x = sampleA(0, (f32(i) * h) - (dt * a.x), ((f32(j) + 0.5) * h) - (dt * vb), 0.0, 0.5);
  } else { o.x = borderU(i, j); }
  if (i >= 1 && i <= nx - 2 && j >= 2) {
    let ub = 0.25 * (ld(A, i, j - 1).x + a.x + ld(A, i + 1, j - 1).x + ld(A, i + 1, j).x);
    o.y = sampleA(1, ((f32(i) + 0.5) * h) - (dt * ub), (f32(j) * h) - (dt * a.y), 0.5, 0.0);
  } else { o.y = borderV(i, j); }
  if (i >= 1 && j >= 1 && i <= nx - 2 && j <= ny - 2) {
    let uc = 0.5 * (a.x + ld(A, i + 1, j).x); let vc = 0.5 * (a.y + ld(A, i, j + 1).y);
    o.z = sampleA(2, ((f32(i) + 0.5) * h) - (dt * uc), ((f32(j) + 0.5) * h) - (dt * vc), 0.5, 0.5);
  }
  textureStore(O, vec2<i32>(i, j), o);
}`,

  mac: STEP + COMMON + /* wgsl */`
@group(0) @binding(1) var A: texture_2d<f32>;
@group(0) @binding(2) var B: texture_2d<f32>;
@group(0) @binding(3) var SRC: texture_2d<f32>;
@group(0) @binding(4) var O: texture_storage_2d<rgba16float, write>;
fn sampleB(x: f32, y: f32) -> f32 {
  let gx = clamp((x / P.h) - 0.5, 0.0, P.nx - 1.001);
  let gy = clamp((y / P.h) - 0.5, 0.0, P.ny - 1.001);
  let i0 = i32(floor(gx)); let j0 = i32(floor(gy));
  let tx = gx - f32(i0); let ty = gy - f32(j0);
  return ((1.0 - tx) * (1.0 - ty) * ld(B, i0, j0).z) + (tx * (1.0 - ty) * ld(B, i0 + 1, j0).z) + ((1.0 - tx) * ty * ld(B, i0, j0 + 1).z) + (tx * ty * ld(B, i0 + 1, j0 + 1).z);
}
fn sampleS(x: f32, y: f32) -> f32 {
  let gx = clamp((x / P.h) - 0.5, 0.0, P.nx - 1.001);
  let gy = clamp((y / P.h) - 0.5, 0.0, P.ny - 1.001);
  let i0 = i32(floor(gx)); let j0 = i32(floor(gy));
  let tx = gx - f32(i0); let ty = gy - f32(j0);
  return ((1.0 - tx) * (1.0 - ty) * ld(SRC, i0, j0).x) + (tx * (1.0 - ty) * ld(SRC, i0 + 1, j0).x) + ((1.0 - tx) * ty * ld(SRC, i0, j0 + 1).x) + (tx * ty * ld(SRC, i0 + 1, j0 + 1).x);
}
${MAIN}
  let nx = i32(P.nx); let ny = i32(P.ny); let i = i32(g.x); let j = i32(g.y);
  if (i >= nx || j >= ny) { return; }
  let b = ld(B, i, j);
  var t = 0.0;
  if (i >= 1 && j >= 1 && i <= nx - 2 && j <= ny - 2) {
    let a = ld(A, i, j); let h = P.h; let dt = P.dt;
    let uc = 0.5 * (a.x + ld(A, i + 1, j).x); let vc = 0.5 * (a.y + ld(A, i, j + 1).y);
    let xc = (f32(i) + 0.5) * h; let yc = (f32(j) + 0.5) * h;
    let back = sampleB(xc + (dt * uc), yc + (dt * vc));
    var tn = b.z + (0.5 * (a.z - back));
    let gx = clamp(((xc - (dt * uc)) / h) - 0.5, 0.0, P.nx - 1.001);
    let gy = clamp(((yc - (dt * vc)) / h) - 0.5, 0.0, P.ny - 1.001);
    let qi = i32(floor(gx)); let qj = i32(floor(gy));
    let t00 = ld(A, qi, qj).z; let t10 = ld(A, qi + 1, qj).z; let t01 = ld(A, qi, qj + 1).z; let t11 = ld(A, qi + 1, qj + 1).z;
    tn = clamp(tn, min(min(t00, t10), min(t01, t11)), max(max(t00, t10), max(t01, t11)));
    if (P.kappa > 0.0) {
      tn = tn + (P.kappa * ((0.25 * (ld(A, i - 1, j).z + ld(A, i + 1, j).z + ld(A, i, j - 1).z + ld(A, i, j + 1).z)) - a.z));
    }
    tn = max(0.0, tn - select(P.fireCool, P.smokeCool, tn < P.flameT));
    var sp = ld(SRC, i, j).x;
    for (var k = 1; k <= 4; k = k + 1) {
      let s = f32(k) * 0.25;
      sp = max(sp, sampleS(xc - (s * dt * uc), yc - (s * dt * vc)));
    }
    t = max(tn, sp);
  }
  textureStore(O, vec2<i32>(i, j), vec4<f32>(b.x, b.y, t, 0.0));
}`,

  // old state -> new size (the frame governor); R = (old nx, ny, h, 0)
  resample: STEP + COMMON + /* wgsl */`
@group(0) @binding(1) var A: texture_2d<f32>;
@group(0) @binding(2) var<uniform> R: vec4<f32>;
@group(0) @binding(3) var O: texture_storage_2d<rgba16float, write>;
fn sampleOld(c: i32, x: f32, y: f32, ox: f32, oy: f32) -> f32 {
  let gx = clamp((x / R.z) - ox, 0.0, R.x - 1.001);
  let gy = clamp((y / R.z) - oy, 0.0, R.y - 1.001);
  let i0 = i32(floor(gx)); let j0 = i32(floor(gy));
  let tx = gx - f32(i0); let ty = gy - f32(j0);
  return ((1.0 - tx) * (1.0 - ty) * ld(A, i0, j0)[c]) + (tx * (1.0 - ty) * ld(A, i0 + 1, j0)[c]) + ((1.0 - tx) * ty * ld(A, i0, j0 + 1)[c]) + (tx * ty * ld(A, i0 + 1, j0 + 1)[c]);
}
${MAIN}
  let nx = i32(P.nx); let ny = i32(P.ny); let i = i32(g.x); let j = i32(g.y);
  if (i >= nx || j >= ny) { return; }
  let h = P.h;
  var o = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  o.x = sampleOld(0, f32(i) * h, (f32(j) + 0.5) * h, 0.0, 0.5);
  o.y = sampleOld(1, (f32(i) + 0.5) * h, f32(j) * h, 0.5, 0.0);
  if (i >= 1 && j >= 1 && i <= nx - 2 && j <= ny - 2) { o.z = sampleOld(2, (f32(i) + 0.5) * h, (f32(j) + 0.5) * h, 0.5, 0.5); }
  textureStore(O, vec2<i32>(i, j), o);
}`,

  // glow light per cell: the mean of 25 glow LUT samples on a 9 x 9 block
  // (stride 2), premultiplied. E = (mode, lut n, 0, 0); mode 0 palette,
  // 1 colour map (alpha 3.5 t), 2 speed (no glow).
  emit: STEP + COMMON + /* wgsl */`
@group(0) @binding(1) var A: texture_2d<f32>;
@group(0) @binding(2) var LUT: texture_2d<f32>;
@group(0) @binding(3) var<uniform> E: vec4<f32>;
@group(0) @binding(4) var O: texture_storage_2d<rgba16float, write>;
${MAIN}
  let nx = i32(P.nx); let ny = i32(P.ny); let i = i32(g.x); let j = i32(g.y);
  if (i >= nx || j >= ny) { return; }
  var acc = vec3<f32>(0.0, 0.0, 0.0);
  if (E.x < 1.5) {
    let n = i32(E.y);
    for (var b = -2; b <= 2; b = b + 1) {
      for (var a = -2; a <= 2; a = a + 1) {
        let t = clamp(ld(A, clamp(i + (2 * a), 0, nx - 1), clamp(j + (2 * b), 0, ny - 1)).z, 0.0, 1.0);
        let q = i32((t * f32(n - 1)) + 0.5);
        if (E.x < 0.5) { let gl = textureLoad(LUT, vec2<i32>(q, 1), 0); acc = acc + (gl.rgb * gl.a); }
        else { let c = textureLoad(LUT, vec2<i32>(q, 0), 0); acc = acc + (c.rgb * min(1.0, 3.5 * t)); }
      }
    }
  }
  textureStore(O, vec2<i32>(i, j), vec4<f32>(acc / 25.0, 0.0));
}`,

  // Full-screen composite. V: view = (ox, oy, s, canvas h), dom = (W, H,
  // nx, ny), bg, bg2 (sRGB), opt = (glow, mode, veil, 1 / vmax), aux =
  // (lut n, 0, 0, 0). B-spline bicubic T (4 bilinear taps), LUT colour,
  // straight alpha over the background gradient, glow added.
  render: /* wgsl */`
struct V { view: vec4<f32>, dom: vec4<f32>, bg: vec4<f32>, bg2: vec4<f32>, opt: vec4<f32>, aux: vec4<f32> };
@group(0) @binding(0) var<uniform> U: V;
@group(0) @binding(1) var A: texture_2d<f32>;
@group(0) @binding(2) var EM: texture_2d<f32>;
@group(0) @binding(3) var LUT: texture_2d<f32>;
@group(0) @binding(4) var SM: sampler;
@vertex fn vs(@builtin(vertex_index) k: u32) -> @builtin(position) vec4<f32> {
  let x = f32((k << 1u) & 2u); let y = f32(k & 2u);
  return vec4<f32>((x * 2.0) - 1.0, (y * 2.0) - 1.0, 0.0, 1.0);
}
fn bicubic(uv: vec2<f32>) -> vec4<f32> {
  let size = U.dom.zw;
  let tc = (uv * size) - 0.5;
  let ic = floor(tc); let f = tc - ic;
  let f2 = f * f; let f3 = f2 * f;
  let w0 = (1.0 / 6.0) * ((1.0 - f) * (1.0 - f) * (1.0 - f));
  let w1 = (1.0 / 6.0) * (((3.0 * f3) - (6.0 * f2)) + 4.0);
  let w2 = (1.0 / 6.0) * ((((-3.0) * f3) + (3.0 * f2)) + ((3.0 * f) + 1.0));
  let w3 = (1.0 / 6.0) * f3;
  let g0 = w0 + w1; let g1 = w2 + w3;
  let p0 = ((ic - 1.0) + (w1 / g0) + 0.5) / size;
  let p1 = ((ic + 1.0) + (w3 / g1) + 0.5) / size;
  let a = textureSampleLevel(A, SM, vec2<f32>(p0.x, p0.y), 0.0);
  let b = textureSampleLevel(A, SM, vec2<f32>(p1.x, p0.y), 0.0);
  let c = textureSampleLevel(A, SM, vec2<f32>(p0.x, p1.y), 0.0);
  let d = textureSampleLevel(A, SM, vec2<f32>(p1.x, p1.y), 0.0);
  return (g0.y * ((g0.x * a) + (g1.x * b))) + (g1.y * ((g0.x * c) + (g1.x * d)));
}
@fragment fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let px = pos.x; let py = pos.y;
  var col = mix(U.bg2.rgb, U.bg.rgb, clamp(py / U.view.w, 0.0, 1.0));
  let x = (px - U.view.x) / U.view.z; let y = (U.view.y - py) / U.view.z;
  if (x >= 0.0 && y >= 0.0 && x <= U.dom.x && y <= U.dom.y) {
    let uv = vec2<f32>(x / U.dom.x, y / U.dom.y);
    let s = bicubic(uv);
    let n = i32(U.aux.x);
    let mode = U.opt.y;
    var t = clamp(s.z, 0.0, 1.0);
    if (mode > 1.5) { t = clamp(length(s.xy) * U.opt.w, 0.0, 1.0); }
    let q = i32((t * f32(n - 1)) + 0.5);
    let lc = textureLoad(LUT, vec2<i32>(q, 0), 0);
    var al = lc.a;
    if (mode > 0.5) { al = select(min(1.0, 3.5 * t), 1.0, mode > 1.5); }
    col = mix(col, lc.rgb, al);
    if (mode < 1.5) { col = col + (U.opt.x * 0.7 * textureSampleLevel(EM, SM, uv, 0.0).rgb); }
  }
  col = mix(col, U.bg.rgb, U.opt.z);
  return vec4<f32>(min(col, vec3<f32>(1.0, 1.0, 1.0)), 1.0);
}`,
};

// Uniform layout of Step: the field order of the struct above.
export const STEP_FIELDS = ['dt', 'h', 'NX', 'NY', 'lift', 'accel', 'gravity', 'eps', 'visc', 'drag', 'wind', 'floorH',
  'pertX', 'pertY', 'kappa', 'fireCool', 'smokeCool', 'nSwirl', 'spin', 'flameT'];
