// THERMAL CONVECTION · shaders/sim-fft.wgsl — passes 3 and 5 of a step
// (sim/ref.js fwdX, lineY, invX): the xy FFTs of the four fields. One
// workgroup per line, the line in workgroup memory, mixed-radix Stockham
// stages (radix 4, 2, 3; ref.js fftLine is the same code). Prepended by
// sim-common.wgsl.
//
// Listing (grep -n "^fn \|^@compute" sim-fft.wgsl):
//   fftLine(lid, N, nst, codes)  forward DFT of sh[0..N); returns the half holding it
//   fwdX     rhs (real) -> spec, half spectrum mx = 0..nx/2        dispatch (ny, nz)
//   fwdY     spec, complex FFT along y                             dispatch (nh, nz)
//   invY     spec, inverse along y (conj, forward, conj)           dispatch (nh, nz)
//   invX     spec -> U, V, W, T (Hermitian fill, real part / (nx ny)) dispatch (ny, nz)
//
// Spectral layout: field f, mode (mx, my), layer k at f * specN + mx + nh * (my + ny * k).
// Radix codes: 4 bits per stage, stage s radix = (codes >> (4 s)) & 15.
// Line length max 256 (sh holds two halves of 256).

@group(0) @binding(1) var<storage, read_write> uvw: array<f32>;
@group(0) @binding(2) var<storage, read_write> Tf: array<f32>;
@group(0) @binding(4) var<storage, read_write> rhs: array<f32>;
@group(0) @binding(6) var<storage, read_write> spec: array<vec2f>;

var<workgroup> sh: array<vec2f, 512>;

fn cmul(a: vec2f, b: vec2f) -> vec2f {
  return vec2f((a.x * b.x) - (a.y * b.y), (a.x * b.y) + (a.y * b.x));
}

fn cis(a: f32) -> vec2f {
  return vec2f(cos(a), sin(a));
}

fn fftLine(lid: u32, N: u32, nst: u32, codes: u32) -> u32 {
  var src = 0u;
  var p = 1u;
  for (var s = 0u; s < nst; s++) {
    let r = (codes >> (4u * s)) & 15u;
    let m = N / r;
    let so = src * 256u;
    let dso = (1u - src) * 256u;
    for (var i = lid; i < m; i += 64u) {
      let k = i % p;
      let w1 = cis((-TAU * f32(k)) / f32(p * r));
      let j = ((i - k) * r) + k;
      let a0 = sh[so + i];
      let a1 = cmul(sh[so + i + m], w1);
      if (r == 2u) {
        sh[dso + j] = a0 + a1;
        sh[dso + j + p] = a0 - a1;
      } else if (r == 3u) {
        let w2 = cmul(w1, w1);
        let a2 = cmul(sh[so + i + (2u * m)], w2);
        let t1 = a1 + a2;
        let t2 = a0 - (0.5 * t1);
        let t3 = -0.8660254037844386 * (a1 - a2);
        sh[dso + j] = a0 + t1;
        sh[dso + j + p] = vec2f(t2.x - t3.y, t2.y + t3.x);
        sh[dso + j + (2u * p)] = vec2f(t2.x + t3.y, t2.y - t3.x);
      } else {
        let w2 = cmul(w1, w1);
        let w3 = cmul(w2, w1);
        let a2 = cmul(sh[so + i + (2u * m)], w2);
        let a3 = cmul(sh[so + i + (3u * m)], w3);
        let s02 = a0 + a2;
        let d02 = a0 - a2;
        let s13 = a1 + a3;
        let d13 = a1 - a3;
        sh[dso + j] = s02 + s13;
        sh[dso + j + p] = vec2f(d02.x + d13.y, d02.y - d13.x);
        sh[dso + j + (2u * p)] = s02 - s13;
        sh[dso + j + (3u * p)] = vec2f(d02.x - d13.y, d02.y + d13.x);
      }
    }
    workgroupBarrier();
    src = 1u - src;
    p = p * r;
  }
  return src;
}

@compute @workgroup_size(64)
fn fwdX(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) lid: u32) {
  let N = prm.nx;
  let row = prm.nx * (wid.x + (prm.ny * wid.y));
  let srow = prm.nh * (wid.x + (prm.ny * wid.y));
  for (var f = 0u; f < 4u; f++) {
    for (var t = lid; t < N; t += 64u) { sh[t] = vec2f(rhs[(f * prm.n) + row + t], 0.0); }
    workgroupBarrier();
    let h = fftLine(lid, N, prm.stX, prm.radX) * 256u;
    for (var t = lid; t < prm.nh; t += 64u) { spec[(f * prm.specN) + srow + t] = sh[h + t]; }
    workgroupBarrier();
  }
}

fn lineY(mx: u32, k: u32, lid: u32, inv: bool) {
  let N = prm.ny;
  let sg = select(1.0, -1.0, inv);
  let base = mx + (prm.nh * prm.ny * k);
  for (var f = 0u; f < 4u; f++) {
    let b = (f * prm.specN) + base;
    for (var t = lid; t < N; t += 64u) {
      let z = spec[b + (prm.nh * t)];
      sh[t] = vec2f(z.x, sg * z.y);
    }
    workgroupBarrier();
    let h = fftLine(lid, N, prm.stY, prm.radY) * 256u;
    for (var t = lid; t < N; t += 64u) {
      let z = sh[h + t];
      spec[b + (prm.nh * t)] = vec2f(z.x, sg * z.y);
    }
    workgroupBarrier();
  }
}

@compute @workgroup_size(64)
fn fwdY(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) lid: u32) {
  lineY(wid.x, wid.y, lid, false);
}

@compute @workgroup_size(64)
fn invY(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) lid: u32) {
  lineY(wid.x, wid.y, lid, true);
}

@compute @workgroup_size(64)
fn invX(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) lid: u32) {
  let N = prm.nx;
  let row = prm.nx * (wid.x + (prm.ny * wid.y));
  let srow = prm.nh * (wid.x + (prm.ny * wid.y));
  let sc = 1.0 / f32(prm.nx * prm.ny);
  for (var f = 0u; f < 4u; f++) {
    let b = (f * prm.specN) + srow;
    for (var t = lid; t < N; t += 64u) {
      // Y(m) = conj(Z(m)) for m <= nx/2, Z(nx - m) above (Hermitian fill of the conj)
      if (t < prm.nh) {
        let z = spec[b + t];
        sh[t] = vec2f(z.x, -z.y);
      } else {
        sh[t] = spec[b + (N - t)];
      }
    }
    workgroupBarrier();
    let h = fftLine(lid, N, prm.stX, prm.radX) * 256u;
    for (var t = lid; t < N; t += 64u) {
      let v = sh[h + t].x * sc;
      if (f == 3u) {
        Tf[row + t] = v;
      } else if (f == 2u && wid.y == 0u) {
        uvw[(2u * prm.n) + row + t] = 0.0;
      } else {
        uvw[(f * prm.n) + row + t] = v;
      }
    }
    workgroupBarrier();
  }
}
