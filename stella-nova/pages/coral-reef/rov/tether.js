// ============================================================================
//  CORAL REEF  ·  ROV  ·  the tether (DOM-free rope, node and browser)
// ----------------------------------------------------------------------------
//  A verlet rope of n segments. Point 0 is fixed to the ROV termination,
//  point n to its top far above in the dark (rov/cables.js). Each step: verlet
//  integration with a small net weight and drag, then distance
//  constraints; half way through the constraints and at the end, the
//  rock: every point inside the SDF shell (2 radii) goes out along the
//  gradient. The winch pays out: the rest length follows 1.12 times
//  the straight distance, slowly, so the rope always sags in a catenary.
//
//  The tube. createTetherTube makes the cable surface from the rope
//  points: a centripetal Catmull-Rom curve through every rope point,
//  resampled by chord length to `rings` points, then one ring of `radial`
//  vertices on each point. The ring frames come from parallel transport
//  (the normal of a ring is the normal of the ring before, projected on
//  the plane of the new tangent), so the tube does not twist or flip. The
//  first normal follows the first normal of the last frame, so the braid
//  texture does not swim. All arrays are made once; update() writes into
//  them (no allocation per frame). Three is not needed: rov/index.js puts
//  the arrays in one BufferGeometry.
//
//  slack (1.12): the rest length over the straight distance; mid: also
//  collide the middle of each segment (long cables, rov/cables.js).
//
//  USE
//    const t = createTether({ n: 56, a, b });  t.step(dt, A, B, sdf) -> points
//    t.reset(a, b) a straight rope again
//    const tube = createTetherTube({ rings: 240, radial: 16, radius: 0.024 });
//    tube.update(t.points, t.count)   fills tube.positions, normals, uvs
//    tube.indices (Uint16 or Uint32, fixed), tube.curve (rings x 3),
//    tube.tangents, tube.ringNormals (rings x 3), tube.length (m)
//    braidTexel(u, v) -> 0..1, the braid pattern (rov/index.js DataTexture)
//
//  grep -n targets
//    "export function createTether", "export function createTetherTube",
//    "function catmull", "export function braidTexel"
// ============================================================================

export function createTether({ n = 56, a, b, weight = 0.5, drag = 0.04, iters = 12, radius = 0.025, slack = 1.12, mid = false } = {}) {
  const N = n + 1, P = new Float64Array(N * 3), Q = new Float64Array(N * 3);
  for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) { P[i * 3 + k] = a[k] + (b[k] - a[k]) * i / n; Q[i * 3 + k] = P[i * 3 + k]; }
  let rest = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * slack / n;
  // a point nearer than 2 radii to the rock goes out along the gradient
  function collide(sdf) {
    const e = 0.03, want = radius * 2;
    for (let i = 1; i < n; i++) {
      const o = i * 3, x = P[o], y = P[o + 1], z = P[o + 2], d = sdf(x, y, z);
      if (d >= want) continue;
      const nx = sdf(x + e, y, z) - sdf(x - e, y, z), ny = sdf(x, y + e, z) - sdf(x, y - e, z), nz = sdf(x, y, z + e) - sdf(x, y, z - e);
      // unit direction; the step in metres is the sdf gap over the gradient
      // length (the rock sdf is a scaled bound, about 0.4 per metre)
      const l = Math.hypot(nx, ny, nz) || 1e-9, s = (want - d) / Math.max(0.2, l / (2 * e)) / l;
      P[o] += nx * s; P[o + 1] += ny * s; P[o + 2] += nz * s;
    }
    // mid: the middle of each segment too (long segments over a ridge):
    // a middle in the shell moves both ends out (a fixed end stays)
    if (mid) for (let i = 0; i < n; i++) {
      const o = i * 3, x = (P[o] + P[o + 3]) / 2, y = (P[o + 1] + P[o + 4]) / 2, z = (P[o + 2] + P[o + 5]) / 2, d = sdf(x, y, z);
      if (d >= want) continue;
      const nx = sdf(x + e, y, z) - sdf(x - e, y, z), ny = sdf(x, y + e, z) - sdf(x, y - e, z), nz = sdf(x, y, z + e) - sdf(x, y, z - e);
      const l = Math.hypot(nx, ny, nz) || 1e-9, s = (want - d) / Math.max(0.2, l / (2 * e)) / l;
      const ka = i === 0 ? 0 : 1, kb = i + 1 === n ? 0 : 1, kk = ka + kb ? 2 / (ka + kb) : 0;
      if (ka) { P[o] += nx * s * kk; P[o + 1] += ny * s * kk; P[o + 2] += nz * s * kk; }
      if (kb) { P[o + 3] += nx * s * kk; P[o + 4] += ny * s * kk; P[o + 5] += nz * s * kk; }
    }
  }
  function step(dt, A, B, sdf) {
    dt = Math.min(dt, 0.05);
    const want = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]) * slack / n;
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
      // rock: every point, half way through the constraints and at the
      // end (about 2 x n sdf calls a step, 0.75 us each on the real rock)
      if (sdf && (it === (iters >> 1) || it === iters - 1)) collide(sdf);
    }
    return P;
  }
  // reset(a, b): a straight rope again (a region jump behind a fade)
  function reset(a2, b2) {
    for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) { P[i * 3 + k] = a2[k] + (b2[k] - a2[k]) * i / n; Q[i * 3 + k] = P[i * 3 + k]; }
    rest = Math.hypot(b2[0] - a2[0], b2[1] - a2[1], b2[2] - a2[2]) * slack / n;
  }
  return { points: P, prev: Q, count: N, step, reset, get rest() { return rest; } };
}

// The braid: two sets of helical strands (left and right lay) and a dark
// tracer stripe along the cable. u: round the cable 0..1, v: along it in
// cable diameters. 0.72..1 (a soft pattern under the cable colour).
export function braidTexel(u, v) {
  const s1 = 0.5 + 0.5 * Math.cos((u + v * 0.5) * Math.PI * 2 * 4);
  const s2 = 0.5 + 0.5 * Math.cos((u - v * 0.5) * Math.PI * 2 * 4);
  const over = (Math.floor(v * 2 + u * 4) & 1) ? s1 : s2;      // over / under
  const tracer = Math.abs(((u * 1 + 0.5) % 1) - 0.5) < 0.06 ? 0.82 : 1;
  return (0.72 + 0.28 * Math.pow(over, 0.6)) * tracer;
}

// Centripetal Catmull-Rom (alpha 0.5, Barry-Goldman form) on one segment
// p1..p2 with neighbours p0, p3, at t in 0..1. Writes out[o..o+2].
function catmull(P, i0, i1, i2, i3, t, out, o) {
  const d = (a, b) => Math.sqrt(Math.sqrt((P[b] - P[a]) ** 2 + (P[b + 1] - P[a + 1]) ** 2 + (P[b + 2] - P[a + 2]) ** 2)) || 1e-6;
  const t0 = 0, t1 = t0 + d(i0, i1), t2 = t1 + d(i1, i2), t3 = t2 + d(i2, i3);
  const u = t1 + (t2 - t1) * t;
  for (let k = 0; k < 3; k++) {
    const a = P[i0 + k], b = P[i1 + k], c = P[i2 + k], e = P[i3 + k];
    const A1 = ((t1 - u) * a + (u - t0) * b) / (t1 - t0);
    const A2 = ((t2 - u) * b + (u - t1) * c) / (t2 - t1);
    const A3 = ((t3 - u) * c + (u - t2) * e) / (t3 - t2);
    const B1 = ((t2 - u) * A1 + (u - t0) * A2) / (t2 - t0);
    const B2 = ((t3 - u) * A2 + (u - t1) * A3) / (t3 - t1);
    out[o + k] = ((t2 - u) * B1 + (u - t1) * B2) / (t2 - t1);
  }
}

export function createTetherTube({ rings = 240, radial = 16, radius = 0.024, maxPoints = 128 } = {}) {
  const RV = radial + 1, NV = rings * RV;
  const positions = new Float32Array(NV * 3), normals = new Float32Array(NV * 3), uvs = new Float32Array(NV * 2);
  const indices = NV > 65535 ? new Uint32Array((rings - 1) * radial * 6) : new Uint16Array((rings - 1) * radial * 6);
  for (let r = 0, o = 0; r < rings - 1; r++) for (let j = 0; j < radial; j++) {
    const a = r * RV + j, b = a + 1, c = a + RV, d = c + 1;
    // counter-clockwise seen from outside: the ring goes round the tangent
    // by the right hand (e = cos n + sin b, b = t x n), so (a, b, c) faces
    // along +e, the stored normal (a, c, b faced into the tube)
    indices[o++] = a; indices[o++] = b; indices[o++] = c; indices[o++] = b; indices[o++] = d; indices[o++] = c;
  }
  const COS = new Float64Array(RV), SIN = new Float64Array(RV);
  for (let j = 0; j <= radial; j++) { const a = j / radial * Math.PI * 2; COS[j] = Math.cos(a); SIN[j] = Math.sin(a); }
  const curve = new Float64Array(rings * 3), tangents = new Float64Array(rings * 3), ringNormals = new Float64Array(rings * 3);
  const ext = new Float64Array((maxPoints + 2) * 3), cum = new Float64Array(maxPoints + 1);
  const ref = [0, 0, 0];
  let hasRef = false;
  const T = {
    positions, normals, uvs, indices, curve, tangents, ringNormals, rings, radial, radius, length: 0,
    update(P, count) {
      const n = Math.min(count, maxPoints);
      // extended points: a phantom point past each end (reflection)
      for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) ext[(i + 1) * 3 + k] = P[i * 3 + k];
      for (let k = 0; k < 3; k++) {
        ext[k] = 2 * P[k] - P[3 + k];
        ext[(n + 1) * 3 + k] = 2 * P[(n - 1) * 3 + k] - P[(n - 2) * 3 + k];
      }
      cum[0] = 0;
      for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(P[i * 3] - P[i * 3 - 3], P[i * 3 + 1] - P[i * 3 - 2], P[i * 3 + 2] - P[i * 3 - 1]);
      const L = cum[n - 1] || 1e-6;
      T.length = L;
      // resample by chord length
      let seg = 0;
      for (let r = 0; r < rings; r++) {
        const s = L * r / (rings - 1);
        while (seg < n - 2 && cum[seg + 1] < s) seg++;
        const sl = cum[seg + 1] - cum[seg] || 1e-9, t = Math.min(1, Math.max(0, (s - cum[seg]) / sl));
        catmull(ext, seg * 3, (seg + 1) * 3, (seg + 2) * 3, (seg + 3) * 3, t, curve, r * 3);
      }
      // the ends are exact
      for (let k = 0; k < 3; k++) { curve[k] = P[k]; curve[(rings - 1) * 3 + k] = P[(n - 1) * 3 + k]; }
      // tangents (central differences)
      for (let r = 0; r < rings; r++) {
        const a = Math.max(0, r - 1) * 3, b = Math.min(rings - 1, r + 1) * 3, o = r * 3;
        let x = curve[b] - curve[a], y = curve[b + 1] - curve[a + 1], z = curve[b + 2] - curve[a + 2];
        const l = Math.hypot(x, y, z);
        if (l < 1e-9) { if (r) { x = tangents[o - 3]; y = tangents[o - 2]; z = tangents[o - 1]; } else { x = 0; y = 1; z = 0; } } else { x /= l; y /= l; z /= l; }
        tangents[o] = x; tangents[o + 1] = y; tangents[o + 2] = z;
      }
      // parallel transport of the normal
      let nx, ny, nz;
      {
        const tx = tangents[0], ty = tangents[1], tz = tangents[2];
        if (hasRef) { nx = ref[0]; ny = ref[1]; nz = ref[2]; } else if (Math.abs(ty) < 0.9) { nx = 0; ny = 1; nz = 0; } else { nx = 1; ny = 0; nz = 0; }
        let q = nx * tx + ny * ty + nz * tz; nx -= tx * q; ny -= ty * q; nz -= tz * q;
        let l = Math.hypot(nx, ny, nz);
        if (l < 1e-4) { nx = Math.abs(ty) < 0.9 ? 0 : 1; ny = Math.abs(ty) < 0.9 ? 1 : 0; nz = 0; q = nx * tx + ny * ty + nz * tz; nx -= tx * q; ny -= ty * q; nz -= tz * q; l = Math.hypot(nx, ny, nz) || 1; }
        nx /= l; ny /= l; nz /= l;
        ref[0] = nx; ref[1] = ny; ref[2] = nz; hasRef = true;
      }
      const vK = 1 / (2 * radius * 4);          // v: in units of 4 diameters
      let s = 0;
      for (let r = 0; r < rings; r++) {
        const o = r * 3, tx = tangents[o], ty = tangents[o + 1], tz = tangents[o + 2];
        if (r) {
          const q = nx * tx + ny * ty + nz * tz; nx -= tx * q; ny -= ty * q; nz -= tz * q;
          const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
          s += Math.hypot(curve[o] - curve[o - 3], curve[o + 1] - curve[o - 2], curve[o + 2] - curve[o - 1]);
        }
        ringNormals[o] = nx; ringNormals[o + 1] = ny; ringNormals[o + 2] = nz;
        const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
        const cx = curve[o], cy = curve[o + 1], cz = curve[o + 2], v = s * vK;
        for (let j = 0; j <= radial; j++) {
          const w = (r * RV + j), w3 = w * 3, c = COS[j], si = SIN[j];
          const ex = c * nx + si * bx, ey = c * ny + si * by, ez = c * nz + si * bz;
          normals[w3] = ex; normals[w3 + 1] = ey; normals[w3 + 2] = ez;
          positions[w3] = cx + ex * radius; positions[w3 + 1] = cy + ey * radius; positions[w3 + 2] = cz + ez * radius;
          uvs[w * 2] = j / radial; uvs[w * 2 + 1] = v;
        }
      }
      return T;
    },
  };
  return T;
}
