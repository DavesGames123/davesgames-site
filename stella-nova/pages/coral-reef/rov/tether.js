// ============================================================================
//  CORAL REEF  ·  ROV  ·  the tether (DOM-free rope, node and browser)
// ----------------------------------------------------------------------------
//  A verlet rope of n segments. Point 0 is fixed to the ROV termination,
//  point n to the cage or ship far above in the dark. Each step: verlet
//  integration with a small net weight and drag, then distance
//  constraints, then the rock: a point inside the SDF shell goes out along
//  the gradient. The winch pays out: the rest length follows 1.12 times
//  the straight distance, slowly, so the rope always sags in a catenary.
//
//  grep -n targets
//    "export function createTether"
// ============================================================================

export function createTether({ n = 28, a, b, weight = 0.5, drag = 0.04, iters = 12, radius = 0.025 } = {}) {
  const N = n + 1, P = new Float64Array(N * 3), Q = new Float64Array(N * 3);
  for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) { P[i * 3 + k] = a[k] + (b[k] - a[k]) * i / n; Q[i * 3 + k] = P[i * 3 + k]; }
  let rest = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * 1.12 / n;
  let frame = 0;
  function step(dt, A, B, sdf) {
    dt = Math.min(dt, 0.05);
    const want = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]) * 1.12 / n;
    rest += (want - rest) * (1 - Math.exp(-dt * 0.5));
    const g = -weight * dt * dt, dk = 1 - drag;
    for (let i = 1; i < n; i++) {
      const o = i * 3;
      for (let k = 0; k < 3; k++) {
        const p = P[o + k], v = (p - Q[o + k]) * dk;
        Q[o + k] = p; P[o + k] = p + v + (k === 1 ? g : 0);
      }
    }
    for (let k = 0; k < 3; k++) { P[k] = A[k]; P[n * 3 + k] = B[k]; }
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < n; i++) {
        const o = i * 3, o2 = o + 3;
        const dx = P[o2] - P[o], dy = P[o2 + 1] - P[o + 1], dz = P[o2 + 2] - P[o + 2];
        const d = Math.hypot(dx, dy, dz) || 1e-9, diff = (d - rest) / d;
        const wa = i === 0 ? 0 : 1, wb = i + 1 === n ? 0 : 1, ws = wa + wb || 1, ca = diff * wa / ws, cb = diff * wb / ws;
        P[o] += dx * ca; P[o + 1] += dy * ca; P[o + 2] += dz * ca;
        P[o2] -= dx * cb; P[o2 + 1] -= dy * cb; P[o2 + 2] -= dz * cb;
      }
    }
    // rock: every other frame, half the points each
    if (sdf) {
      frame++;
      for (let i = 1 + (frame & 1); i < n; i += 2) {
        const o = i * 3, x = P[o], y = P[o + 1], z = P[o + 2], d = sdf(x, y, z);
        if (d < radius * 2) {
          const e = 0.03;
          let nx = sdf(x + e, y, z) - sdf(x - e, y, z), ny = sdf(x, y + e, z) - sdf(x, y - e, z), nz = sdf(x, y, z + e) - sdf(x, y, z - e);
          const l = Math.hypot(nx, ny, nz) || 1, s = (radius * 2 - d) / l;
          P[o] += nx * s; P[o + 1] += ny * s; P[o + 2] += nz * s;
        }
      }
    }
    return P;
  }
  return { points: P, count: N, step, get rest() { return rest; } };
}
