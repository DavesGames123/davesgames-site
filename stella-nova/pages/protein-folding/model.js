// ============================================================================
//  PROTEIN FOLDING  ·  model.js — C-alpha structure-based (Go) model
// ----------------------------------------------------------------------------
//  No DOM and no THREE. worker.js runs it in the page, tests.mjs in Node.
//
//  One bead per residue at the C-alpha. The native structure (proteins.js)
//  sets every minimum of the energy:
//
//    V = sum_bonds  Kb (r - r0)^2
//      + sum_angles Ka (theta - theta0)^2
//      + sum_dihed  K1 [1 - cos(phi - phi0)] + K3 [1 - cos 3(phi - phi0)]
//      + sum_native eps [5 (s/r)^12 - 6 (s/r)^10]      s = native distance
//      + sum_other  eps (sigma/r)^12                    shifted to 0 at rc
//      - F |x_last - x_first|                           pull on the termini
//
//  Units: angstrom, eps = 1, mass = 1, kB = 1. T is in eps/kB and time in
//  tau. The energy scale is not calibrated to any real protein.
//
//  Langevin dynamics with the BAOAB splitting: half kick, half drift, an
//  exact Ornstein-Uhlenbeck step for the velocity, half drift, new force,
//  half kick. Friction gamma is in 1/tau.
//
//  GREP MAP
//    export function buildSystem ...... topology from a protein record
//    export function forces ........... energy and force, all terms
//    export function step ............. BAOAB steps with a neighbour list
//    export function observe .......... Q, Rg, RMSD, energy, end distance
//    export function kabsch ........... Horn quaternion fit, RMSD, rotation
//    export function initExtended / initCoil / initNative   start shapes
//    function buildList ............... non-native neighbour list
// ============================================================================

export const PARAMS = {
  Kb: 100, Ka: 20, K1: 1, K3: 0.5, eps: 1,
  sigma: 4.0,       // non-native bead diameter, angstrom
  rc: 6.5,          // non-native cutoff, angstrom
  skin: 2.0,        // neighbour list skin, angstrom
  qCut: 1.2,        // a native contact is formed when r < qCut * s
  dt: 0.005,
};

// --- small RNG: sfc32, seeded; normals by Box-Muller ----------------------
export function makeRng(seed) {
  let a = 0x9e3779b9 ^ seed, b = 0x243f6a88 + seed * 7919, c = 0xb7e15162 ^ (seed * 31), d = 1;
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11); d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 16; i++) next();
  let spare = null;
  next.normal = () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u = 0; while (u < 1e-12) u = next();
    const r = Math.sqrt(-2 * Math.log(u)), th = 2 * Math.PI * next();
    spare = r * Math.sin(th); return r * Math.cos(th);
  };
  return next;
}

// --- geometry helpers ------------------------------------------------------
function angleAt(x, i, j, k) {
  const ux = x[3 * i] - x[3 * j], uy = x[3 * i + 1] - x[3 * j + 1], uz = x[3 * i + 2] - x[3 * j + 2];
  const wx = x[3 * k] - x[3 * j], wy = x[3 * k + 1] - x[3 * j + 1], wz = x[3 * k + 2] - x[3 * j + 2];
  const c = (ux * wx + uy * wy + uz * wz) / Math.sqrt((ux * ux + uy * uy + uz * uz) * (wx * wx + wy * wy + wz * wz));
  return Math.acos(Math.max(-1, Math.min(1, c)));
}
export function dihedralAt(x, i, j, k, l) {
  const Fx = x[3 * i] - x[3 * j], Fy = x[3 * i + 1] - x[3 * j + 1], Fz = x[3 * i + 2] - x[3 * j + 2];
  const Gx = x[3 * j] - x[3 * k], Gy = x[3 * j + 1] - x[3 * k + 1], Gz = x[3 * j + 2] - x[3 * k + 2];
  const Hx = x[3 * l] - x[3 * k], Hy = x[3 * l + 1] - x[3 * k + 1], Hz = x[3 * l + 2] - x[3 * k + 2];
  const Ax = Fy * Gz - Fz * Gy, Ay = Fz * Gx - Fx * Gz, Az = Fx * Gy - Fy * Gx;
  const Bx = Hy * Gz - Hz * Gy, By = Hz * Gx - Hx * Gz, Bz = Hx * Gy - Hy * Gx;
  const g = Math.sqrt(Gx * Gx + Gy * Gy + Gz * Gz);
  const cs = Ax * Bx + Ay * By + Az * Bz;
  const sn = ((By * Az - Bz * Ay) * Gx + (Bz * Ax - Bx * Az) * Gy + (Bx * Ay - By * Ax) * Gz) / g;
  return Math.atan2(sn, cs);
}

// --- topology --------------------------------------------------------------
// protein: { seq, ss, ca: [x,y,z,...], con: [i,j,...] } from proteins.js
export function buildSystem(protein, opt = {}) {
  const P = { ...PARAMS, ...(opt.params || {}) };
  const N = protein.seq.length;
  const nat = Float64Array.from(protein.ca);
  const r0 = new Float64Array(N - 1), th0 = new Float64Array(Math.max(0, N - 2)), ph0 = new Float64Array(Math.max(0, N - 3));
  for (let i = 0; i < N - 1; i++) r0[i] = Math.hypot(nat[3 * i + 3] - nat[3 * i], nat[3 * i + 4] - nat[3 * i + 1], nat[3 * i + 5] - nat[3 * i + 2]);
  for (let i = 0; i < N - 2; i++) th0[i] = angleAt(nat, i, i + 1, i + 2);
  for (let i = 0; i < N - 3; i++) ph0[i] = dihedralAt(nat, i, i + 1, i + 2, i + 3);
  const nc = protein.con.length / 2;
  const ci = new Int32Array(nc), cj = new Int32Array(nc), s2 = new Float64Array(nc);
  const isNat = new Uint8Array(N * N);
  for (let c = 0; c < nc; c++) {
    const i = protein.con[2 * c], j = protein.con[2 * c + 1];
    ci[c] = i; cj[c] = j;
    s2[c] = (nat[3 * i] - nat[3 * j]) ** 2 + (nat[3 * i + 1] - nat[3 * j + 1]) ** 2 + (nat[3 * i + 2] - nat[3 * j + 2]) ** 2;
    isNat[i * N + j] = isNat[j * N + i] = 1;
  }
  const sys = {
    N, P, nat, r0, th0, ph0, ci, cj, s2, isNat, nc,
    x: Float64Array.from(nat), v: new Float64Array(3 * N), f: new Float64Array(3 * N),
    T: opt.T ?? 0.8, gamma: opt.gamma ?? 1, pull: 0,
    rng: makeRng(opt.seed ?? 1),
    list: new Int32Array(0), nList: 0, xList: new Float64Array(3 * N), listBuilds: 0,
    E: 0, Eparts: new Float64Array(6), t: 0, steps: 0,
    formed: new Uint8Array(nc),
  };
  buildList(sys);
  forces(sys);
  return sys;
}

// --- non-native neighbour list (Verlet, rebuilt on half-skin moves) -------
function buildList(sys) {
  const { N, x, isNat, P } = sys;
  const rl2 = (P.rc + P.skin) ** 2;
  let buf = sys.list.length ? sys.list : new Int32Array(Math.max(64, N * 24));
  let n = 0;
  for (let i = 0; i < N; i++) {
    const xi = x[3 * i], yi = x[3 * i + 1], zi = x[3 * i + 2];
    for (let j = i + 4; j < N; j++) {
      if (isNat[i * N + j]) continue;
      const dx = xi - x[3 * j], dy = yi - x[3 * j + 1], dz = zi - x[3 * j + 2];
      if (dx * dx + dy * dy + dz * dz > rl2) continue;
      if (2 * n + 2 > buf.length) { const nb = new Int32Array(buf.length * 2); nb.set(buf); buf = nb; }
      buf[2 * n] = i; buf[2 * n + 1] = j; n++;
    }
  }
  sys.list = buf; sys.nList = n; sys.xList.set(x); sys.listBuilds++;
}
function listStale(sys) {
  const { x, xList, N } = sys, lim = (sys.P.skin / 2) ** 2;
  for (let i = 0; i < 3 * N; i += 3) {
    const dx = x[i] - xList[i], dy = x[i + 1] - xList[i + 1], dz = x[i + 2] - xList[i + 2];
    if (dx * dx + dy * dy + dz * dz > lim) return true;
  }
  return false;
}

// --- energy and force ------------------------------------------------------
// Writes -grad V into sys.f, the total into sys.E and the parts into
// sys.Eparts: [bond, angle, dihedral, native, non-native, pull].
// With full = true it scans every non-native pair (tests use it).
export function forces(sys, full = false) {
  const { N, x, f, P, r0, th0, ph0, ci, cj, s2 } = sys;
  f.fill(0);
  let eb = 0, ea = 0, ed = 0, en = 0, eo = 0, ep = 0;
  // bonds
  for (let i = 0; i < N - 1; i++) {
    const a = 3 * i, b = a + 3;
    const dx = x[b] - x[a], dy = x[b + 1] - x[a + 1], dz = x[b + 2] - x[a + 2];
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz), d = r - r0[i];
    eb += P.Kb * d * d;
    const g = -2 * P.Kb * d / r;
    f[b] += g * dx; f[b + 1] += g * dy; f[b + 2] += g * dz;
    f[a] -= g * dx; f[a + 1] -= g * dy; f[a + 2] -= g * dz;
  }
  // angles
  for (let i = 0; i < N - 2; i++) {
    const a = 3 * i, b = a + 3, c = a + 6;
    const ux = x[a] - x[b], uy = x[a + 1] - x[b + 1], uz = x[a + 2] - x[b + 2];
    const wx = x[c] - x[b], wy = x[c + 1] - x[b + 1], wz = x[c + 2] - x[b + 2];
    const lu2 = ux * ux + uy * uy + uz * uz, lw2 = wx * wx + wy * wy + wz * wz, luw = Math.sqrt(lu2 * lw2);
    let cs = (ux * wx + uy * wy + uz * wz) / luw;
    cs = Math.max(-0.999999, Math.min(0.999999, cs));
    const th = Math.acos(cs), d = th - th0[i];
    ea += P.Ka * d * d;
    // dV/dtheta * dtheta/dcos = 2 Ka d * (-1/sin)
    const k = 2 * P.Ka * d / Math.sqrt(1 - cs * cs);   // F = k * dcos/dx
    const gax = wx / luw - cs * ux / lu2, gay = wy / luw - cs * uy / lu2, gaz = wz / luw - cs * uz / lu2;
    const gcx = ux / luw - cs * wx / lw2, gcy = uy / luw - cs * wy / lw2, gcz = uz / luw - cs * wz / lw2;
    f[a] += k * gax; f[a + 1] += k * gay; f[a + 2] += k * gaz;
    f[c] += k * gcx; f[c + 1] += k * gcy; f[c + 2] += k * gcz;
    f[b] -= k * (gax + gcx); f[b + 1] -= k * (gay + gcy); f[b + 2] -= k * (gaz + gcz);
  }
  // dihedrals (Blondel-Karplus gradient)
  for (let i = 0; i < N - 3; i++) {
    const a = 3 * i, b = a + 3, c = a + 6, e = a + 9;
    const Fx = x[a] - x[b], Fy = x[a + 1] - x[b + 1], Fz = x[a + 2] - x[b + 2];
    const Gx = x[b] - x[c], Gy = x[b + 1] - x[c + 1], Gz = x[b + 2] - x[c + 2];
    const Hx = x[e] - x[c], Hy = x[e + 1] - x[c + 1], Hz = x[e + 2] - x[c + 2];
    const Ax = Fy * Gz - Fz * Gy, Ay = Fz * Gx - Fx * Gz, Az = Fx * Gy - Fy * Gx;
    const Bx = Hy * Gz - Hz * Gy, By = Hz * Gx - Hx * Gz, Bz = Hx * Gy - Hy * Gx;
    const A2 = Ax * Ax + Ay * Ay + Az * Az, B2 = Bx * Bx + By * By + Bz * Bz;
    const g = Math.sqrt(Gx * Gx + Gy * Gy + Gz * Gz);
    if (A2 < 1e-10 || B2 < 1e-10) continue;
    const cs = Ax * Bx + Ay * By + Az * Bz;
    const sn = ((By * Az - Bz * Ay) * Gx + (Bz * Ax - Bx * Az) * Gy + (Bx * Ay - By * Ax) * Gz) / g;
    const phi = Math.atan2(sn, cs), d = phi - ph0[i];
    ed += P.K1 * (1 - Math.cos(d)) + P.K3 * (1 - Math.cos(3 * d));
    const dV = P.K1 * Math.sin(d) + 3 * P.K3 * Math.sin(3 * d);
    const FG = Fx * Gx + Fy * Gy + Fz * Gz, HG = Hx * Gx + Hy * Gy + Hz * Gz;
    const ka = g / A2, kb = g / B2, fa = FG / (A2 * g), hb = HG / (B2 * g);
    // dphi/dx: i = -ka A ; l = kb B ; j = ka A + fa A - hb B ; k = hb B - fa A - kb B
    // force = -dV * dphi/dx
    f[a] += dV * ka * Ax; f[a + 1] += dV * ka * Ay; f[a + 2] += dV * ka * Az;
    f[e] -= dV * kb * Bx; f[e + 1] -= dV * kb * By; f[e + 2] -= dV * kb * Bz;
    f[b] -= dV * ((ka + fa) * Ax - hb * Bx); f[b + 1] -= dV * ((ka + fa) * Ay - hb * By); f[b + 2] -= dV * ((ka + fa) * Az - hb * Bz);
    f[c] -= dV * ((hb - kb) * Bx - fa * Ax); f[c + 1] -= dV * ((hb - kb) * By - fa * Ay); f[c + 2] -= dV * ((hb - kb) * Bz - fa * Az);
  }
  // native contacts, LJ 10-12
  const eps = P.eps, qc2 = P.qCut * P.qCut, formed = sys.formed;
  for (let c = 0; c < ci.length; c++) {
    const a = 3 * ci[c], b = 3 * cj[c];
    const dx = x[a] - x[b], dy = x[a + 1] - x[b + 1], dz = x[a + 2] - x[b + 2];
    const r2 = dx * dx + dy * dy + dz * dz;
    const s = s2[c] / r2, s5 = s * s * s * s * s, s6 = s5 * s;
    en += eps * (5 * s6 - 6 * s5);
    formed[c] = r2 < qc2 * s2[c] ? 1 : 0;
    const g = 60 * eps * (s6 - s5) / r2;
    f[a] += g * dx; f[a + 1] += g * dy; f[a + 2] += g * dz;
    f[b] -= g * dx; f[b + 1] -= g * dy; f[b + 2] -= g * dz;
  }
  // non-native repulsion
  const sg2 = P.sigma * P.sigma, rc2 = P.rc * P.rc, shift = (sg2 / rc2) ** 6;
  const pairNN = (i, j) => {
    const a = 3 * i, b = 3 * j;
    const dx = x[a] - x[b], dy = x[a + 1] - x[b + 1], dz = x[a + 2] - x[b + 2];
    const r2 = dx * dx + dy * dy + dz * dz;
    if (r2 >= rc2) return;
    const s = sg2 / r2, s6 = s * s * s * s * s * s;
    eo += eps * (s6 - shift);
    const g = 12 * eps * s6 / r2;
    f[a] += g * dx; f[a + 1] += g * dy; f[a + 2] += g * dz;
    f[b] -= g * dx; f[b + 1] -= g * dy; f[b + 2] -= g * dz;
  };
  if (full) { for (let i = 0; i < N; i++) for (let j = i + 4; j < N; j++) if (!sys.isNat[i * N + j]) pairNN(i, j); }
  else { const L = sys.list; for (let p = 0; p < sys.nList; p++) pairNN(L[2 * p], L[2 * p + 1]); }
  // constant pulling force on the termini, along the end-to-end vector
  if (sys.pull && N > 1) {
    const a = 0, b = 3 * (N - 1);
    const dx = x[b] - x[a], dy = x[b + 1] - x[a + 1], dz = x[b + 2] - x[a + 2];
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    ep = -sys.pull * r;
    const g = sys.pull / r;
    f[b] += g * dx; f[b + 1] += g * dy; f[b + 2] += g * dz;
    f[a] -= g * dx; f[a + 1] -= g * dy; f[a + 2] -= g * dz;
  }
  const E = sys.Eparts;
  E[0] = eb; E[1] = ea; E[2] = ed; E[3] = en; E[4] = eo; E[5] = ep;
  sys.E = eb + ea + ed + en + eo + ep;
  return sys.E;
}

// --- BAOAB Langevin --------------------------------------------------------
export function step(sys, n = 1) {
  const { x, v, f, N, rng } = sys, dt = sys.P.dt, h = dt / 2;
  const c1 = Math.exp(-sys.gamma * dt), c2 = Math.sqrt((1 - c1 * c1) * sys.T);
  const M = 3 * N;
  for (let s = 0; s < n; s++) {
    for (let k = 0; k < M; k++) { v[k] += h * f[k]; x[k] += h * v[k]; }
    for (let k = 0; k < M; k++) v[k] = c1 * v[k] + c2 * rng.normal();
    for (let k = 0; k < M; k++) x[k] += h * v[k];
    if (listStale(sys)) buildList(sys);
    forces(sys);
    for (let k = 0; k < M; k++) v[k] += h * f[k];
    sys.t += dt; sys.steps++;
  }
  // A blow-up (NaN, or an energy no thermal state can reach) restarts the
  // chain extended rather than poison the page; sys.blowups counts them.
  if (!(sys.E < 1e6)) { const t = sys.t, st = sys.steps; initExtended(sys); sys.t = t; sys.steps = st; sys.blowups = (sys.blowups || 0) + 1; }
}

// --- Kabsch fit by Horn's quaternion method --------------------------------
// Fits a onto b (both flat xyz, n points). Returns { rmsd, R (row-major
// 3x3), ca, cb } with b ~ R (a - ca) + cb. Reflections are not allowed.
export function kabsch(a, b, n) {
  const ca = [0, 0, 0], cb = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { ca[k] += a[3 * i + k]; cb[k] += b[3 * i + k]; }
  for (let k = 0; k < 3; k++) { ca[k] /= n; cb[k] /= n; }
  const S = new Float64Array(9); let ga = 0, gb = 0;
  for (let i = 0; i < n; i++) {
    const ax = a[3 * i] - ca[0], ay = a[3 * i + 1] - ca[1], az = a[3 * i + 2] - ca[2];
    const bx = b[3 * i] - cb[0], by = b[3 * i + 1] - cb[1], bz = b[3 * i + 2] - cb[2];
    ga += ax * ax + ay * ay + az * az; gb += bx * bx + by * by + bz * bz;
    S[0] += ax * bx; S[1] += ax * by; S[2] += ax * bz;
    S[3] += ay * bx; S[4] += ay * by; S[5] += ay * bz;
    S[6] += az * bx; S[7] += az * by; S[8] += az * bz;
  }
  const [xx, xy, xz, yx, yy, yz, zx, zy, zz] = S;
  const K = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ];
  const { val, vec } = jacobi4(K);
  let m = 0; for (let k = 1; k < 4; k++) if (val[k] > val[m]) m = k;
  const q0 = vec[0][m], q1 = vec[1][m], q2 = vec[2][m], q3 = vec[3][m];
  const R = [
    q0 * q0 + q1 * q1 - q2 * q2 - q3 * q3, 2 * (q1 * q2 - q0 * q3), 2 * (q1 * q3 + q0 * q2),
    2 * (q1 * q2 + q0 * q3), q0 * q0 - q1 * q1 + q2 * q2 - q3 * q3, 2 * (q2 * q3 - q0 * q1),
    2 * (q1 * q3 - q0 * q2), 2 * (q2 * q3 + q0 * q1), q0 * q0 - q1 * q1 - q2 * q2 + q3 * q3,
  ];
  const rmsd = Math.sqrt(Math.max(0, (ga + gb - 2 * val[m]) / n));
  return { rmsd, R, ca, cb };
}
// Cyclic Jacobi eigen solver for a symmetric 4x4 matrix.
function jacobi4(A0) {
  const A = A0.map(r => r.slice()), V = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  for (let sweep = 0; sweep < 30; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 4; q++) off += A[p][q] * A[p][q];
    if (off < 1e-22) break;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 4; q++) {
      if (Math.abs(A[p][q]) < 1e-300) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 4; k++) { const akp = A[k][p], akq = A[k][q]; A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq; }
      for (let k = 0; k < 4; k++) { const apk = A[p][k], aqk = A[q][k]; A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < 4; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
    }
  }
  return { val: [A[0][0], A[1][1], A[2][2], A[3][3]], vec: V };
}
// Applies a kabsch() result to a: writes R (a - ca) + cb into out.
export function applyFit(fit, a, out, n) {
  const { R, ca, cb } = fit;
  for (let i = 0; i < n; i++) {
    const x = a[3 * i] - ca[0], y = a[3 * i + 1] - ca[1], z = a[3 * i + 2] - ca[2];
    out[3 * i] = R[0] * x + R[1] * y + R[2] * z + cb[0];
    out[3 * i + 1] = R[3] * x + R[4] * y + R[5] * z + cb[1];
    out[3 * i + 2] = R[6] * x + R[7] * y + R[8] * z + cb[2];
  }
  return out;
}

// --- observables -----------------------------------------------------------
// Q uses the formed[] flags that forces() writes for the current x.
export function observe(sys, fitOut) {
  const { N, x, nat, nc, formed } = sys;
  let q = 0; for (let c = 0; c < nc; c++) q += formed[c];
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < N; i++) { cx += x[3 * i]; cy += x[3 * i + 1]; cz += x[3 * i + 2]; }
  cx /= N; cy /= N; cz /= N;
  let rg = 0;
  for (let i = 0; i < N; i++) rg += (x[3 * i] - cx) ** 2 + (x[3 * i + 1] - cy) ** 2 + (x[3 * i + 2] - cz) ** 2;
  const fit = kabsch(x, nat, N);
  if (fitOut) applyFit(fit, x, fitOut, N);
  const b = 3 * (N - 1);
  return {
    Q: nc ? q / nc : 0, Rg: Math.sqrt(rg / N), rmsd: fit.rmsd, E: sys.E,
    ree: Math.hypot(x[b] - x[0], x[b + 1] - x[1], x[b + 2] - x[2]), t: sys.t, steps: sys.steps,
  };
}
export function nativeRg(sys) {
  const { N, nat } = sys; let rg = 0;
  for (let i = 0; i < 3 * N; i++) rg += nat[i] * nat[i];
  return Math.sqrt(rg / N);   // proteins.js stores centred coordinates
}

// --- start shapes ----------------------------------------------------------
// NeRF: place bead i from i-1, i-2, i-3 with bond r, angle th, dihedral ph.
function place(x, i, r, th, ph) {
  const a = 3 * (i - 3), b = 3 * (i - 2), c = 3 * (i - 1);
  let bcx = x[c] - x[b], bcy = x[c + 1] - x[b + 1], bcz = x[c + 2] - x[b + 2];
  const lbc = Math.hypot(bcx, bcy, bcz); bcx /= lbc; bcy /= lbc; bcz /= lbc;
  const abx = x[b] - x[a], aby = x[b + 1] - x[a + 1], abz = x[b + 2] - x[a + 2];
  let nx = aby * bcz - abz * bcy, ny = abz * bcx - abx * bcz, nz = abx * bcy - aby * bcx;
  const ln = Math.hypot(nx, ny, nz) || 1; nx /= ln; ny /= ln; nz /= ln;
  const mx = ny * bcz - nz * bcy, my = nz * bcx - nx * bcz, mz = nx * bcy - ny * bcx;
  const d0 = -r * Math.cos(th), d1 = r * Math.sin(th) * Math.cos(ph), d2 = r * Math.sin(th) * Math.sin(ph);
  x[3 * i] = x[c] + d0 * bcx + d1 * mx + d2 * nx;
  x[3 * i + 1] = x[c + 1] + d0 * bcy + d1 * my + d2 * ny;
  x[3 * i + 2] = x[c + 2] + d0 * bcz + d1 * mz + d2 * nz;
}
function build(sys, dihedral) {
  const { N, x, r0, th0 } = sys;
  x.fill(0);
  if (N > 1) x[3] = r0[0];
  if (N > 2) { const t = Math.PI - th0[0]; x[6] = x[3] + r0[1] * Math.cos(t); x[7] = r0[1] * Math.sin(t); }
  for (let i = 3; i < N; i++) place(x, i, r0[i - 1], th0[i - 2], dihedral(i));
}
function finishStart(sys) {
  const { x, v, N } = sys;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < N; i++) { cx += x[3 * i]; cy += x[3 * i + 1]; cz += x[3 * i + 2]; }
  for (let i = 0; i < N; i++) { x[3 * i] -= cx / N; x[3 * i + 1] -= cy / N; x[3 * i + 2] -= cz / N; }
  const s = Math.sqrt(sys.T);
  for (let k = 0; k < 3 * N; k++) v[k] = s * sys.rng.normal();
  buildList(sys); forces(sys);
  sys.t = 0; sys.steps = 0;
}
// Fully extended: native bonds and angles, every dihedral at 180 deg.
export function initExtended(sys) { build(sys, () => Math.PI); finishStart(sys); }
// Random coil: grown one bead at a time with random dihedrals. Each bead
// tries up to 60 dihedrals and keeps the first that puts it at least
// max(4 A, 0.8 s_ij) from every earlier bead (j <= i - 3), else the one
// with the most room. s_ij is the native distance of a native pair.
export function initCoil(sys) {
  const { N, x, rng, r0, th0, ci, cj, s2 } = sys;
  const need = new Float64Array(N * N).fill(16);
  for (let c = 0; c < ci.length; c++) need[ci[c] * N + cj[c]] = need[cj[c] * N + ci[c]] = Math.max(16, 0.64 * s2[c]);
  build(sys, () => Math.PI);
  for (let i = 3; i < N; i++) {
    let bestPh = Math.PI, bestD = -1;
    for (let t = 0; t < 60; t++) {
      const ph = (rng() * 2 - 1) * Math.PI;
      place(x, i, r0[i - 1], th0[i - 2], ph);
      let dmin = Infinity;   // the worst ratio d^2 / need^2
      for (let j = 0; j <= i - 3; j++) dmin = Math.min(dmin, ((x[3 * i] - x[3 * j]) ** 2 + (x[3 * i + 1] - x[3 * j + 1]) ** 2 + (x[3 * i + 2] - x[3 * j + 2]) ** 2) / need[i * N + j]);
      if (dmin > bestD) { bestD = dmin; bestPh = ph; }
      if (dmin >= 1) break;
    }
    place(x, i, r0[i - 1], th0[i - 2], bestPh);
  }
  finishStart(sys);
}
export function initNative(sys) { sys.x.set(sys.nat); finishStart(sys); }
