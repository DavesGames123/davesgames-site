/* ============================================================================
   HYDROGEN TABLE  ·  physics  (pure ES module, no DOM)
   ----------------------------------------------------------------------------
   The hydrogen wave function in atomic units (a0 = 1):
       psi_nlm(r, theta, phi) = R_nl(r) * Y_lm(theta, phi)
       R_nl(r) = sqrt((2/n)^3 (n-l-1)! / (2n (n+l)!)) e^(-rho/2) rho^l L(rho)
       rho     = 2r / n,   L = generalized Laguerre L^(2l+1)_(n-l-1)
   main.js, worker.js and the Node checks import this file. The tile fill in
   worker.js calls fillTile, so the checks test the same code that draws.

   A TILE is a square cut through the nucleus. Two kinds exist:
     complex  |Y_lm|^2 does not change with phi. The cut is the x-z plane,
              z up. On the left half phi = pi, so psi gets the sign (-1)^m.
     real     cos(m phi) for m > 0, sin(|m| phi) for m < 0, times sqrt(2).
              A vertical cut at the azimuth of a lobe, or the x-y plane when
              |m| = l (all lobes lie on the equator, for example d_xy).
   In each tile psi is real, so one signed field holds both the density
   (psi^2) and the sign.

   BRIGHTNESS. Each tile is scaled to its own peak. The page can instead
   scale it to the peak of its outer lobe, as the classic plot does. Inner
   peaks then go to white. fillTile gives the ratio of the two peaks.

   GREP MAP
     grep -n 'export function laguerre'    L^a_k(x) by upward recurrence
     grep -n 'export function radialR'     R_nl(r), normalized
     grep -n 'export function legendre'    P_l^m(x), Condon-Shortley phase
     grep -n 'export function ylmNorm'     the Y_lm normalization constant
     grep -n 'export function tileSpec'    the plane, the name, the extent
     grep -n 'export function psiAt'       exact psi at a point of a tile
     grep -n 'export function fillTile'    the fast fill (lookup tables)
     grep -n 'export function tileList'    the tiles of the table, in order
     grep -n 'export function shellTiles'  the tiles of one shell n
     grep -n 'export function poseMatrix'  R = Rz Ry Rx from three angles
     grep -n 'export function startNorm'   the start-pose scale of a tile
     grep -n 'export function fillTileRot' a tile of the turned orbital
     grep -n 'export function fillPose'    start pose or turned, one call
   ========================================================================== */

export const HARTREE_EV = 27.211386245988;   // CODATA 2018
export const E1_EV = -HARTREE_EV / 2;        // -13.6057 eV
export const L_LETTER = 'spdfghiklm';      // no j, by convention

export function factorial(k) { let f = 1; for (let i = 2; i <= k; i++) f *= i; return f; }

// Generalized Laguerre L^a_k(x). L_0 = 1, L_1 = 1 + a - x, then
// (j+1) L_(j+1) = (2j + 1 + a - x) L_j - (j + a) L_(j-1).
export function laguerre(k, a, x) {
  if (k === 0) return 1;
  let p = 1, q = 1 + a - x;
  for (let j = 1; j < k; j++) { const t = ((2 * j + 1 + a - x) * q - (j + a) * p) / (j + 1); p = q; q = t; }
  return q;
}

export function radialNorm(n, l) {
  return Math.sqrt(Math.pow(2 / n, 3) * factorial(n - l - 1) / (2 * n * factorial(n + l)));
}

export function radialR(n, l, r) {
  const rho = 2 * r / n;
  return radialNorm(n, l) * Math.exp(-rho / 2) * Math.pow(rho, l) * laguerre(n - l - 1, 2 * l + 1, rho);
}

// Associated Legendre P_l^m(x) for m >= 0, with the (-1)^m phase that scipy
// also uses. Start from P_m^m, then climb l. With bare = true the factor
// (1 - x^2)^(m/2) is left out, so the result is a smooth polynomial.
export function legendre(l, m, x, bare = false) {
  let pmm = 1;
  if (m > 0) { const s = bare ? 1 : Math.sqrt(Math.max(0, (1 - x) * (1 + x))); let f = 1; for (let i = 1; i <= m; i++) { pmm *= -f * s; f += 2; } }
  if (l === m) return pmm;
  let p1 = x * (2 * m + 1) * pmm;
  if (l === m + 1) return p1;
  let p0 = pmm;
  for (let ll = m + 2; ll <= l; ll++) { const t = ((2 * ll - 1) * x * p1 - (ll + m - 1) * p0) / (ll - m); p0 = p1; p1 = t; }
  return p1;
}

export function ylmNorm(l, m) {
  const am = Math.abs(m);
  return Math.sqrt((2 * l + 1) / (4 * Math.PI) * factorial(l - am) / factorial(l + am));
}

// Names of the real orbitals, Cartesian form, up to f.
const REAL_NAMES = {
  1: { 0: 'z', 1: 'x', '-1': 'y' },
  2: { 0: 'z²', 1: 'xz', '-1': 'yz', 2: 'x²−y²', '-2': 'xy' },
  3: { 0: 'z³', 1: 'xz²', '-1': 'yz²', 2: 'z(x²−y²)', '-2': 'xyz', 3: 'x(x²−3y²)', '-3': 'y(3x²−y²)' },
};

export function orbitalName(n, l, m, kind) {
  const base = n + L_LETTER[l];
  if (kind !== 'real' || l === 0) return base;
  const t = REAL_NAMES[l] && REAL_NAMES[l][m];
  return t ? base + ' ' + t : base + (m === 0 ? ' m0' : (m > 0 ? ' c' : ' s') + Math.abs(m));
}

// Radius of the outer edge of the orbital. The outer lobe of R^2 has a peak.
// The edge is where R^2 falls to EDGE times that peak. The tile half-width is
// this edge times PAD. The result is about n^2 times a small factor.
const EDGE = 0.006, PAD = 1.12;
const extentCache = new Map();
export function tileExtent(n, l) {
  const key = n * 16 + l;
  if (extentCache.has(key)) return extentCache.get(key);
  const rEnd = 4 * n * n + 20, N = 8000, dr = rEnd / N;
  let lastNode = 0, prev = radialR(n, l, dr);
  for (let i = 2; i <= N; i++) { const v = radialR(n, l, i * dr); if (v * prev < 0) lastNode = i * dr; prev = v; }
  let peak = 0;
  for (let i = 0; i <= N; i++) { const r = i * dr; if (r < lastNode) continue; const v = radialR(n, l, r) ** 2; if (v > peak) peak = v; }
  let edge = rEnd;
  for (let i = N; i >= 0; i--) { const r = i * dr; if (radialR(n, l, r) ** 2 >= EDGE * peak) { edge = r; break; } }
  const hw = edge * PAD;
  extentCache.set(key, hw);
  lastNodeCache.set(key, lastNode);
  return hw;
}
// Radius of the outermost radial node (0 when there is none).
const lastNodeCache = new Map();
export function outerNode(n, l) { tileExtent(n, l); return lastNodeCache.get(n * 16 + l); }

// The plane and the axes of one tile. A point (u, v) of the tile, u to the
// right and v up, is at u * ex + v * ey in space.
export function tileSpec(n, l, m, kind) {
  let plane = 'xz', phi0 = 0;
  if (kind === 'real' && l > 0) {
    if (Math.abs(m) === l) plane = 'xy';
    else if (m < 0) { phi0 = Math.PI / (2 * Math.abs(m)); plane = Math.abs(m) === 1 ? 'yz' : 'vert'; }
  }
  const ex = plane === 'xy' ? [1, 0, 0] : [Math.cos(phi0), Math.sin(phi0), 0];
  const ey = plane === 'xy' ? [0, 1, 0] : [0, 0, 1];
  return {
    n, l, m, kind, plane, phi0, ex, ey,
    hw: tileExtent(n, l),
    rOuter: outerNode(n, l),
    name: orbitalName(n, l, m, kind),
    planeLabel: plane === 'vert' ? `φ=${Math.round(phi0 * 180 / Math.PI)}°` : plane,
    radialNodes: n - l - 1,
    polarNodes: l - Math.abs(m),        // nodal cones (a plane when theta = 90 deg)
    azimNodes: Math.abs(m),             // nodal planes of cos or sin (m phi)
  };
}

// The angular factor at polar cosine c and azimuth phi, real valued.
function angular(l, m, kind, c, phi) {
  const am = Math.abs(m), N = ylmNorm(l, am), P = legendre(l, am, c);
  if (kind === 'complex' || m === 0) return N * P * (kind === 'complex' ? Math.cos(m * phi) : 1);
  // Real orbitals: drop the (-1)^m phase so that p_x is positive along +x.
  const cs = (am & 1) ? -1 : 1;
  return cs * Math.SQRT2 * N * P * (m > 0 ? Math.cos(am * phi) : Math.sin(am * phi));
}

// Exact psi at tile point (u, v), in a0. For a complex tile the cut is at
// phi = 0 or pi, so e^(i m phi) = cos(m phi) = +-1 and psi is real.
export function psiAt(S, u, v) {
  const x = u * S.ex[0] + v * S.ey[0], y = u * S.ex[1] + v * S.ey[1], z = u * S.ex[2] + v * S.ey[2];
  const r = Math.sqrt(x * x + y * y + z * z);
  const c = r > 0 ? z / r : 1, phi = Math.atan2(y, x);
  return radialR(S.n, S.l, r) * angular(S.l, S.m, S.kind, c, phi);
}

// Fast fill of a size x size tile, row 0 at the top. Writes psi / max|psi|
// into out and returns max|psi|. It also sets S.outer: the peak |psi| of the
// outer lobe (outside the last radial node), divided by max|psi|. R(r) and the bare polar polynomial come from
// lookup tables with linear interpolation. The factor sin^|m|(theta) and the
// azimuth factor are exact, because sin(theta) has a kink in cos(theta).
const LUT_N = 4096;
export function fillTile(S, size, out) {
  const { n, l, m, kind, hw } = S, am = Math.abs(m);
  const rMax = hw * Math.SQRT2 * 1.001;
  const Rt = new Float64Array(LUT_N + 2), At = new Float64Array(LUT_N + 2);
  for (let i = 0; i <= LUT_N + 1; i++) Rt[i] = radialR(n, l, (i / LUT_N) * rMax);
  const N = ylmNorm(l, am) * (kind === 'real' && m !== 0 ? Math.SQRT2 * ((am & 1) ? -1 : 1) : 1);
  for (let i = 0; i <= LUT_N + 1; i++) At[i] = N * legendre(l, am, Math.min(1, -1 + 2 * i / LUT_N), true);
  const kR = LUT_N / rMax, kA = LUT_N / 2;
  const step = 2 * hw / size;
  const xy = S.plane === 'xy';
  // Vertical cut: phi is phi0 on the right half and phi0 + pi on the left.
  const trig = p => (kind === 'real' && m < 0) ? Math.sin(am * p) : Math.cos(m * p);
  const fR = trig(S.phi0), fL = trig(S.phi0 + Math.PI);
  const eqA = N * legendre(l, am, 0);
  let peak = 0, outer = 0;
  const rO = S.rOuter || 0;
  for (let j = 0; j < size; j++) {
    const v = hw - (j + 0.5) * step, row = j * size;
    for (let i = 0; i < size; i++) {
      const u = -hw + (i + 0.5) * step;
      const r = Math.sqrt(u * u + v * v);
      let t = r * kR, k = t | 0, f = t - k;
      const R = Rt[k] + (Rt[k + 1] - Rt[k]) * f;
      let a;
      if (xy) {
        const ph = Math.atan2(v, u);
        a = eqA * (m < 0 ? Math.sin(am * ph) : Math.cos(am * ph));
      } else {
        const c = r > 0 ? v / r : 1;
        t = (c + 1) * kA; k = t | 0; f = t - k;
        let sn = 1;
        if (am) { const s = r > 0 ? (u < 0 ? -u : u) / r : 0; for (let e = 0; e < am; e++) sn *= s; }
        a = (At[k] + (At[k + 1] - At[k]) * f) * sn * (u >= 0 ? fR : fL);
      }
      const p = R * a;
      out[row + i] = p;
      const q = p < 0 ? -p : p;
      if (q > peak) peak = q;
      if (r >= rO && q > outer) outer = q;
    }
  }
  S.outer = peak > 0 ? outer / peak : 1;
  if (peak > 0) { const s = 1 / peak; for (let i = 0; i < size * size; i++) out[i] *= s; }
  return peak;
}

// The tiles of the table: rows by n, then l, then m. Complex tiles use
// m = 0..l (m and -m give the same density). Real tiles use
// m = 0, +1, -1, +2, -2 ... so that each row holds n^2 tiles.
export function tileList(nMax, kind) {
  const out = [];
  for (let n = 1; n <= nMax; n++) out.push(...shellTiles(n, kind));
  return out;
}

// The tiles of one shell n, in the order of tileList.
export function shellTiles(n, kind) {
  const out = [];
  for (let l = 0; l < n; l++) {
    if (kind === 'complex') for (let m = 0; m <= l; m++) out.push({ n, l, m, col: colIndex(l, m, kind) });
    else { out.push({ n, l, m: 0, col: colIndex(l, 0, kind) }); for (let k = 1; k <= l; k++) { out.push({ n, l, m: k, col: colIndex(l, k, kind) }); out.push({ n, l, m: -k, col: colIndex(l, -k, kind) }); } }
  }
  return out;
}

// Column of (l, m) in the aligned table. Complex: l(l+1)/2 + m. Real: l^2 + slot.
export function colIndex(l, m, kind) {
  if (kind === 'complex') return l * (l + 1) / 2 + m;
  return l * l + (m === 0 ? 0 : m > 0 ? 2 * m - 1 : -2 * m);
}

export function energyEV(n) { return E1_EV / (n * n); }
export function meanR(n, l) { return (3 * n * n - l * (l + 1)) / 2; }

// ------------------------------------------------------------ rotated tiles
// The rotation animation turns the orbital and keeps the tile plane fixed.
// rot is the 3x3 matrix R, row-major, from the orbital frame to the lab
// frame. Tile point (u, v) is at p = u ex + v ey in the lab, so the orbital
// sees q = R^T p = u a + v b, with a = R^T ex and b = R^T ey.

// R = Rz(gz) Ry(gy) Rx(gx), angles in degrees, row-major.
export function poseMatrix(gx, gy, gz) {
  const d = Math.PI / 180;
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(gx * d), Math.sin(gx * d), Math.cos(gy * d), Math.sin(gy * d), Math.cos(gz * d), Math.sin(gz * d)];
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy,     cy * sx,                cy * cx,
  ];
}

// The peak |psi| and the outer ratio of a tile in its start pose. A rotated
// tile keeps this scale, so a lobe that turns out of the plane goes dark,
// and the tile does not jump in brightness. The start plane goes through
// the lobes, so it holds the peak of the orbital.
const normCache = new Map();
export function startNorm(S) {
  const key = `${S.kind}:${S.n},${S.l},${S.m}`;
  let v = normCache.get(key);
  if (!v) {
    const N = 192, S0 = { ...S }, f = new Float32Array(N * N);
    const peak = fillTile(S0, N, f);
    v = { peak, outer: S0.outer };
    normCache.set(key, v);
  }
  return v;
}

// Fill a tile with the orbital turned by rot. out gets psi / peak, clamped
// to [-1, 1] (colorize reads a table by |psi| and has no clamp).
// sin^|m|(theta) e^(i m phi) = (qx + i qy)^|m| / r^|m|, so no atan2 is used.
// A complex tile shows |psi|: the e^(i m phi) factor has modulus 1.
export function fillTileRot(S, size, out, rot, peak) {
  const { n, l, m, kind, hw } = S, am = Math.abs(m);
  const rMax = hw * Math.SQRT2 * 1.001;
  const Rt = new Float64Array(LUT_N + 2), At = new Float64Array(LUT_N + 2);
  for (let i = 0; i <= LUT_N + 1; i++) Rt[i] = radialR(n, l, (i / LUT_N) * rMax);
  const N = ylmNorm(l, am) * (kind === 'real' && m !== 0 ? Math.SQRT2 * ((am & 1) ? -1 : 1) : 1);
  for (let i = 0; i <= LUT_N + 1; i++) At[i] = N * legendre(l, am, Math.min(1, -1 + 2 * i / LUT_N), true);
  const kR = LUT_N / rMax, kA = LUT_N / 2, step = 2 * hw / size, inv = peak > 0 ? 1 / peak : 1;
  const T = (e, k) => rot[k] * e[0] + rot[3 + k] * e[1] + rot[6 + k] * e[2];
  const ax = T(S.ex, 0), ay = T(S.ex, 1), az = T(S.ex, 2);
  const bx = T(S.ey, 0), by = T(S.ey, 1), bz = T(S.ey, 2);
  const mode = am === 0 ? 0 : kind === 'complex' ? 1 : m > 0 ? 2 : 3;
  for (let j = 0; j < size; j++) {
    const v = hw - (j + 0.5) * step, row = j * size;
    for (let i = 0; i < size; i++) {
      const u = -hw + (i + 0.5) * step;
      const qx = u * ax + v * bx, qy = u * ay + v * by, qz = u * az + v * bz;
      const r = Math.sqrt(qx * qx + qy * qy + qz * qz);
      let t = r * kR, k = t | 0, f = t - k;
      const R = Rt[k] + (Rt[k + 1] - Rt[k]) * f;
      const c = r > 0 ? qz / r : 1;
      t = (c + 1) * kA; k = t | 0; f = t - k;
      let a = At[k] + (At[k + 1] - At[k]) * f;
      if (mode) {
        if (r === 0) a = 0;
        else {
          const x = qx / r, y = qy / r;
          let re = 1, im = 0;
          for (let e = 0; e < am; e++) { const t2 = re * x - im * y; im = re * y + im * x; re = t2; }
          a *= mode === 1 ? Math.sqrt(re * re + im * im) : mode === 2 ? re : im;
        }
      }
      let p = R * a * inv;
      out[row + i] = p > 1 ? 1 : p < -1 ? -1 : p;
    }
  }
}

// Fill a tile in the pose rot, or in its start pose when rot is null.
// Sets S.outer and returns the scale peak. worker.js and the page-thread
// fallback in main.js both call this.
export function fillPose(S, size, out, rot) {
  if (!rot) return fillTile(S, size, out);
  const nz = startNorm(S);
  fillTileRot(S, size, out, rot, nz.peak);
  S.outer = nz.outer;
  return nz.peak;
}
