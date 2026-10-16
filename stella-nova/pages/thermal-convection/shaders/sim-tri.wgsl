// THERMAL CONVECTION · shaders/sim-tri.wgsl — pass 4 of a step (sim/ref.js
// tri()): per Fourier mode (mx, my), the implicit diffusion of U, V, T and
// W (with the semi-implicit buoyancy) and the incremental projection, each
// an exact tridiagonal solve in z. One thread per mode. Prepended by
// sim-common.wgsl.
//
// Listing (grep -n "^fn \|^@compute" sim-tri.wgsl):
//   sidx                spectral index of field f, mode b, layer k
//   thomas(...)         in-place Thomas solve of one or two fields
//   tri                 the pass                   dispatch ceil(nh * ny / 64)
//
// pspec holds the pressure in Fourier space between steps (nh * ny * nz).
// nz <= 64 (the private arrays).

@group(0) @binding(6) var<storage, read_write> spec: array<vec2f>;
@group(0) @binding(7) var<storage, read_write> pspec: array<vec2f>;

var<private> cp: array<f32, 64>;
var<private> pr: array<vec2f, 64>;

fn sidx(f: u32, b: u32, k: u32) -> u32 {
  return (f * prm.specN) + b + (k * prm.nh * prm.ny);
}

fn cmul(a: vec2f, b: vec2f) -> vec2f {
  return vec2f((a.x * b.x) - (a.y * b.y), (a.x * b.y) + (a.y * b.x));
}

// Rows k0..k1: diag = base + cc (2 - e_k) + zone (k < nHeat), off = -cc,
// e_k0 = eLo, e_k1 = eHi. Fields fA and (when two) fB share the matrix.
fn thomas(fA: u32, fB: u32, two: bool, b: u32, k0: u32, k1: u32, base: f32, cc: f32, eLo: f32, eHi: f32, zone: f32) {
  let off = -cc;
  var prev = 0.0;
  var dA = vec2f(0.0);
  var dB = vec2f(0.0);
  for (var k = k0; k <= k1; k++) {
    var e = 0.0;
    if (k == k0) { e = e + eLo; }
    if (k == k1) { e = e + eHi; }
    var diag = base + (cc * (2.0 - e));
    if (k < prm.nHeat) { diag = diag + zone; }
    let den = diag - (off * prev);
    let iA = sidx(fA, b, k);
    dA = (spec[iA] - (off * dA)) / den;
    spec[iA] = dA;
    if (two) {
      let iB = sidx(fB, b, k);
      dB = (spec[iB] - (off * dB)) / den;
      spec[iB] = dB;
    }
    prev = off / den;
    cp[k] = prev;
  }
  var xA = dA;
  var xB = dB;
  for (var k = k1; k > k0; k--) {
    let kk = k - 1u;
    let iA = sidx(fA, b, kk);
    xA = spec[iA] - (cp[kk] * xA);
    spec[iA] = xA;
    if (two) {
      let iB = sidx(fB, b, kk);
      xB = spec[iB] - (cp[kk] * xB);
      spec[iB] = xB;
    }
  }
}

@compute @workgroup_size(64)
fn tri(@builtin(global_invocation_id) gid: vec3u) {
  let b = gid.x;
  if (b >= prm.nh * prm.ny) { return; }
  let mx = b % prm.nh;
  let my = b / prm.nh;
  let nz = prm.nz;
  let dt = prm.dt;
  let dz = prm.dx;
  let dz2 = dz * dz;
  let st = prm.nh * prm.ny;
  let sx = sin((PI * f32(mx)) / f32(prm.nx));
  let sy = sin((PI * f32(my)) / f32(prm.ny));
  let lam = (-4.0 * ((sx * sx) + (sy * sy))) / dz2;
  let thx = (TAU * f32(mx)) / f32(prm.nx);
  let thy = (TAU * f32(my)) / f32(prm.ny);
  // (1 - e^(-i th)) / dx, with 1 - cos th = 2 sin^2(th / 2): no f32 cancellation,
  // and div . grad equals lam exactly in the algebra
  let gx = vec2f(2.0 * sx * sx, sin(thx)) / dz;
  let gy = vec2f(2.0 * sy * sy, sin(thy)) / dz;
  let isZero = (mx == 0u) && (my == 0u);
  let ip0 = b;

  // incremental pressure: u* -= dt grad p_old
  if (!isZero) {
    for (var k = 0u; k < nz; k++) {
      let q = dt * pspec[ip0 + (k * st)];
      spec[sidx(0u, b, k)] = spec[sidx(0u, b, k)] - cmul(gx, q);
      spec[sidx(1u, b, k)] = spec[sidx(1u, b, k)] - cmul(gy, q);
      if (k > 0u) {
        let qm = dt * pspec[ip0 + ((k - 1u) * st)];
        spec[sidx(2u, b, k)] = spec[sidx(2u, b, k)] - ((q - qm) / dz);
      }
    }
  }

  let cv = (dt * prm.nu) / dz2;
  let ck = (dt * prm.kappa) / dz2;
  let eTopU = select(-1.0, 1.0, prm.topFree == 1u);
  let eTopT = select(-1.0, prm.rTop, prm.tRobin == 1u);
  let eBotT = select(-1.0, 1.0, prm.botNeumann == 1u);
  // U and V share the matrix; T next (with the heat bath rows)
  thomas(0u, 1u, true, b, 0u, nz - 1u, 1.0 - (dt * prm.nu * lam), cv, -1.0, eTopU, 0.0);
  thomas(3u, 3u, false, b, 0u, nz - 1u, 1.0 - (dt * prm.kappa * lam), ck, eBotT, eTopT, dt * prm.relax);
  // buoyancy from the new T, then W (faces 1..nz-1, Dirichlet ends)
  spec[sidx(2u, b, 0u)] = vec2f(0.0);
  for (var k = 1u; k < nz; k++) {
    let tw = 0.5 * dt * (spec[sidx(3u, b, k)] + spec[sidx(3u, b, k - 1u)]);
    spec[sidx(2u, b, k)] = spec[sidx(2u, b, k)] + tw;
  }
  thomas(2u, 2u, false, b, 1u, nz - 1u, 1.0 - (dt * prm.nu * lam), cv, 0.0, 0.0, 0.0);

  if (isZero) {
    // no mean vertical flow, no mean horizontal wind
    for (var k = 0u; k < nz; k++) {
      spec[sidx(0u, b, k)] = vec2f(0.0);
      spec[sidx(1u, b, k)] = vec2f(0.0);
      spec[sidx(2u, b, k)] = vec2f(0.0);
    }
    return;
  }

  // projection: (lam + Lz) phi = div u*, Neumann ends
  let ax = vec2f(-2.0 * sx * sx, sin(thx)) / dz;   // (e^(i th) - 1) / dx
  let ay = vec2f(-2.0 * sy * sy, sin(thy)) / dz;
  let off = 1.0 / dz2;
  var prev = 0.0;
  var dprev = vec2f(0.0);
  for (var k = 0u; k < nz; k++) {
    var wUp = vec2f(0.0);
    if (k + 1u < nz) { wUp = spec[sidx(2u, b, k + 1u)]; }
    let dv = cmul(ax, spec[sidx(0u, b, k)]) + cmul(ay, spec[sidx(1u, b, k)]) + ((wUp - spec[sidx(2u, b, k)]) / dz);
    var e = 0.0;
    if (k == 0u) { e = e + 1.0; }
    if (k == nz - 1u) { e = e + 1.0; }
    let den = lam + ((e - 2.0) / dz2) - (off * prev);
    dprev = (dv - (off * dprev)) / den;
    pr[k] = dprev;
    prev = off / den;
    cp[k] = prev;
  }
  for (var k = nz - 1u; k > 0u; k--) {
    let kk = k - 1u;
    pr[kk] = pr[kk] - (cp[kk] * pr[k]);
  }
  for (var k = 0u; k < nz; k++) {
    let ph = pr[k];
    pspec[ip0 + (k * st)] = pspec[ip0 + (k * st)] + (ph / dt);
    spec[sidx(0u, b, k)] = spec[sidx(0u, b, k)] - cmul(gx, ph);
    spec[sidx(1u, b, k)] = spec[sidx(1u, b, k)] - cmul(gy, ph);
    if (k > 0u) {
      spec[sidx(2u, b, k)] = spec[sidx(2u, b, k)] - ((ph - pr[k - 1u]) / dz);
    }
  }
}
