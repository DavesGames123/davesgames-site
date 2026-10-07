// ============================================================================
//  MAXWELL'S EQUATIONS  ·  physics.js  ·  the field model  (ES module, no DOM)
// ----------------------------------------------------------------------------
//  Every field on the page comes from this file. Nothing is drawn as fixed
//  art. main.js and the panels read the fields here, and tests.mjs checks
//  the four laws against them with Node.
//
//  COORDINATES AND UNITS
//      x to the right, y up, z out of the page. A panel shows the page plane
//      z = 0. The renderer turns y down. Lengths are scene units. In the
//      scene, EPS0 = MU0 = 1, so a flux reads in units of q/eps0. The light
//      panel uses the SI values SI_EPS0 and SI_MU0.
//
//  SOURCES
//      point charges  {x, y, z, q}. coulomb() adds q r / (4 pi eps0 r^3).
//      segments       straight current segments {ax..bz, ux..uz, L, I}.
//                     segB() is the Biot-Savart law of each segment, in
//                     closed form, with a wire radius `soft`. segA() is
//                     the vector potential of the same segment, so
//                     curl A = B. Each softened element dl x r / (r^2 +
//                     a^2)^(3/2) has zero divergence, so a sum of them has
//                     zero divergence too.
//      bar magnet     magnetSegments(): a short solenoid of rings. The
//                     bound current of a uniform magnet is a solenoid sheet.
//      capacitor      makeCapacitor(): two plates of point charges, the
//                     wires, the spokes on each plate, and a charge at each
//                     far wire end (the source). The displacement current
//                     of a point charge is radial and spherically
//                     symmetric, so it adds no B. Thus the Biot-Savart B of
//                     the conduction segments is the full B.
//
//  MEASUREMENTS   (each is a numerical integral of a computed field)
//      sphereFluxCharges  Gauss E: the E.dA integral of each charge over the
//                         sphere, about the axis from the centre to the
//                         charge (adaptive Simpson in cos theta).
//      sphereFlux         any field through a sphere (Gauss-Legendre x
//                         uniform phi). Returns net, out and in.
//      discFlux           any field through a disc. rectFlux: a rectangle.
//      loopIntegral       the line integral of a field round a circle.
//      rectLoopIntegral   the same round a rectangle in the page plane.
//      faradayMagnet      flux and EMF of a moving magnet through a loop.
//      faradayRect        flux and EMF of the capacitor current.
//      ampereMaxwell      both sides of the Ampere-Maxwell law at a loop.
//      Wave1D             the 1D Yee update of Faraday and Ampere-Maxwell.
//
//  SECTION MAP   (jump with grep -n "<anchor>" physics.js)
//      constants ........... "export const EPS0"
//      quadrature .......... "export function gaussLegendre"
//      coulomb ............. "export function coulomb"
//      Gauss E flux ........ "export function sphereFluxCharges"
//      segments ............ "export function segment"
//      Biot-Savart ......... "export function segB"
//      vector potential .... "export function segA"
//      magnet .............. "export function magnetSegments"
//      capacitor ........... "export function makeCapacitor"
//      flux integrals ...... "export function sphereFlux"
//      line integrals ...... "export function loopIntegral"
//      Faraday ............. "export function faradayMagnet"
//      Ampere-Maxwell ...... "export function ampereMaxwell"
//      field lines ......... "export function traceLine"
//      light ............... "export class Wave1D"
// ============================================================================

export const EPS0 = 1, MU0 = 1;
export const SI_EPS0 = 8.8541878128e-12;   // F/m, CODATA 2018
export const SI_MU0 = 1.25663706212e-6;    // H/m, CODATA 2018
export const lightSpeed = (mu0, eps0) => 1 / Math.sqrt(mu0 * eps0);
const KE = 1 / (4 * Math.PI * EPS0), KB = MU0 / (4 * Math.PI);

// Gauss-Legendre nodes and weights on [-1, 1], by Newton on P_n.
const GL = new Map();
export function gaussLegendre(n) {
  if (GL.has(n)) return GL.get(n);
  const x = new Float64Array(n), w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let z = Math.cos(Math.PI * (i + 0.75) / (n + 0.5)), pp = 0;
    for (let it = 0; it < 100; it++) {
      let p1 = 1, p2 = 0;
      for (let j = 1; j <= n; j++) { const p3 = p2; p2 = p1; p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j; }
      pp = n * (z * p1 - p2) / (z * z - 1);
      const dz = p1 / pp; z -= dz;
      if (Math.abs(dz) < 1e-15) break;
    }
    x[i] = z; w[i] = 2 / ((1 - z * z) * pp * pp);
  }
  const r = { x, w }; GL.set(n, r); return r;
}

// Adaptive Simpson on [a, b].
function simpson(f, a, b, tol, depth = 48) {
  const fa = f(a), fb = f(b), m = (a + b) / 2, fm = f(m);
  const rec = (a, b, fa, fm, fb, whole, tol, d) => {
    const m = (a + b) / 2, lm = (a + m) / 2, rm = (m + b) / 2, flm = f(lm), frm = f(rm);
    const left = (m - a) / 6 * (fa + 4 * flm + fm), right = (b - m) / 6 * (fm + 4 * frm + fb);
    if (d <= 0 || Math.abs(left + right - whole) <= 15 * tol) return left + right + (left + right - whole) / 15;
    return rec(a, m, fa, flm, fm, left, tol / 2, d - 1) + rec(m, b, fm, frm, fb, right, tol / 2, d - 1);
  };
  return rec(a, b, fa, fm, fb, (b - a) / 6 * (fa + 4 * fm + fb), tol, depth);
}

/* ═══ COULOMB ═══ */
// E of point charges {x, y, z, q} at (x, y, z), added into out.
export function coulomb(charges, x, y, z, out = [0, 0, 0]) {
  for (const c of charges) {
    const dx = x - c.x, dy = y - c.y, dz = z - (c.z || 0), r2 = dx * dx + dy * dy + dz * dz;
    if (r2 < 1e-18) continue;
    const k = KE * c.q / (r2 * Math.sqrt(r2));
    out[0] += k * dx; out[1] += k * dy; out[2] += k * dz;
  }
  return out;
}

// Gauss E. The flux of E through a sphere (centre c, radius R), as the sum
// of each charge's E.dA integral. For one charge at distance d from the
// centre, put the polar axis on the charge: then E.n depends on theta only,
// and dA = 2 pi R^2 d(cos theta). The integrand is E.n of Coulomb's law.
export function sphereFluxCharge(q, d, R) {
  if (d < 1e-9 * R) return q / EPS0;
  const f = u => (R - d * u) / Math.pow(Math.max(1e-300, R * R + d * d - 2 * R * d * u), 1.5);
  return KE * q * 2 * Math.PI * R * R * simpson(f, -1, 1, 1e-11 / (R * R));
}
export function sphereFluxCharges(charges, cx, cy, cz, R) {
  let s = 0;
  for (const c of charges) s += sphereFluxCharge(c.q, Math.hypot(c.x - cx, c.y - cy, (c.z || 0) - cz), R);
  return s;
}
export function chargeInside(charges, cx, cy, cz, R) {
  let s = 0;
  for (const c of charges) if (Math.hypot(c.x - cx, c.y - cy, (c.z || 0) - cz) < R) s += c.q;
  return s;
}

/* ═══ SEGMENTS ═══ */
// A straight current segment from a to b with current I (from a to b).
export function segment(ax, ay, az, bx, by, bz, I) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz);
  return { ax, ay, az, bx, by, bz, ux: dx / L, uy: dy / L, uz: dz / L, L, I };
}

// Biot-Savart B of segments at (x, y, z), added into out. scale multiplies
// each current. For one segment: w = r - a, s0 = w.u, rho = w - s0 u,
// D^2 = rho^2 + soft^2, and
//   B = mu0 I / (4 pi) (u x w) / D^2 [t / sqrt(D^2 + t^2)] from t=-s0 to L-s0.
export function segB(segs, x, y, z, soft, scale = 1, out = [0, 0, 0]) {
  const a2 = soft * soft;
  for (const s of segs) {
    const wx = x - s.ax, wy = y - s.ay, wz = z - s.az, s0 = wx * s.ux + wy * s.uy + wz * s.uz;
    const w2 = wx * wx + wy * wy + wz * wz, D2 = Math.max(1e-18, w2 - s0 * s0 + a2);
    const t1 = -s0, t2 = s.L - s0;
    const f = t2 / Math.sqrt(D2 + t2 * t2) - t1 / Math.sqrt(D2 + t1 * t1);
    const k = KB * s.I * scale * f / D2;
    out[0] += k * (s.uy * wz - s.uz * wy);
    out[1] += k * (s.uz * wx - s.ux * wz);
    out[2] += k * (s.ux * wy - s.uy * wx);
  }
  return out;
}
// Vector potential of the same segments: A = mu0 I / (4 pi) u asinh(t/D).
export function segA(segs, x, y, z, soft, scale = 1, out = [0, 0, 0]) {
  const a2 = soft * soft;
  for (const s of segs) {
    const wx = x - s.ax, wy = y - s.ay, wz = z - s.az, s0 = wx * s.ux + wy * s.uy + wz * s.uz;
    const D = Math.sqrt(Math.max(1e-18, wx * wx + wy * wy + wz * wz - s0 * s0 + a2));
    const k = KB * s.I * scale * (Math.asinh((s.L - s0) / D) - Math.asinh(-s0 / D));
    out[0] += k * s.ux; out[1] += k * s.uy; out[2] += k * s.uz;
  }
  return out;
}

/* ═══ BAR MAGNET ═══ */
// A bar magnet as a solenoid: `rings` rings of radius `radius` along an
// axis in the page at `angle`, from -half to +half about (x, y). The current
// turns right-handed about the axis, so B inside points along the axis and
// the north pole is at +half.
// soft 4 is a thick wire: the field near the rings stays smooth, so the
// sphere quadrature of Gauss B holds to about 1e-5 of the outward flux.
export const MAGNET = { half: 38, radius: 13, rings: 16, segs: 32, current: 18.75, soft: 4 };
export function magnetSegments(x, y, angle, m = MAGNET) {
  const ca = Math.cos(angle), sa = Math.sin(angle), out = [];
  for (let k = 0; k < m.rings; k++) {
    const s = -m.half + 2 * m.half * (k + 0.5) / m.rings, cx = x + s * ca, cy = y + s * sa;
    const P = j => { const p = 2 * Math.PI * j / m.segs, c = Math.cos(p) * m.radius, z = Math.sin(p) * m.radius; return [cx - sa * c, cy + ca * c, z]; };
    for (let j = 0; j < m.segs; j++) { const a = P(j), b = P(j + 1); out.push(segment(a[0], a[1], a[2], b[0], b[1], b[2], m.current)); }
  }
  return out;
}

/* ═══ CAPACITOR ═══ */
// A parallel-plate capacitor on the x axis, fed by a wire from each side.
// Plates at x = -gap/2 (charge +Q) and x = +gap/2 (charge -Q), radius Rp,
// each a disc of point charges on rings (1, 6, 12, ...), equal weights.
// The ring points sit half a step off the page plane, so no spoke lies in
// the page (a spoke in the page would cross a pickup loop drawn there).
// A current I > 0 flows in +x: into the left plate, out of the right one.
// The far wire ends hold -Q (left) and +Q (right): the source. Charge q of
// each point = w Q, current of each segment = f I.
export function makeCapacitor({ gap = 56, Rp = 64, rings = 3, far = 6000, soft = 0.25 } = {}) {
  const pts = [[0, 0]];
  for (let k = 1; k <= rings; k++) { const r = Rp * k / rings, n = 6 * k; for (let j = 0; j < n; j++) { const p = 2 * Math.PI * (j + 0.5) / n; pts.push([r * Math.cos(p), r * Math.sin(p)]); } }
  const w = 1 / pts.length, xl = -gap / 2, xr = gap / 2;
  const charges = [], segs = [];
  segs.push(segment(-far, 0, 0, xl, 0, 0, 1));
  for (const [y, z] of pts) {
    charges.push({ x: xl, y, z, w });
    charges.push({ x: xr, y, z, w: -w });
    if (Math.hypot(y, z) > 0) { segs.push(segment(xl, 0, 0, xl, y, z, w)); segs.push(segment(xr, y, z, xr, 0, 0, w)); }
  }
  segs.push(segment(xr, 0, 0, far, 0, 0, 1));
  charges.push({ x: -far, y: 0, z: 0, w: -1 }, { x: far, y: 0, z: 0, w: 1 });
  return { gap, Rp, far, soft, charges, segs, xl, xr };
}
// The charges of the capacitor at charge Q (or at rate dQ/dt).
export const capCharges = (cap, Q) => cap.charges.map(c => ({ x: c.x, y: c.y, z: c.z, q: c.w * Q }));
export const capE = (cap, Q, x, y, z, out = [0, 0, 0]) => {
  for (const c of cap.charges) {
    const dx = x - c.x, dy = y - c.y, dz = z - c.z, r2 = dx * dx + dy * dy + dz * dz;
    if (r2 < 1e-18) continue;
    const k = KE * c.w * Q / (r2 * Math.sqrt(r2));
    out[0] += k * dx; out[1] += k * dy; out[2] += k * dz;
  }
  return out;
};
export const capB = (cap, I, x, y, z, out = [0, 0, 0]) => segB(cap.segs, x, y, z, cap.soft, I, out);

/* ═══ FLUX INTEGRALS ═══ */
// Flux of field(x, y, z) -> [fx, fy, fz] through a sphere. Gauss-Legendre
// in cos theta (polar axis z) and uniform phi. out and in are the outward
// and inward parts (in < 0), so net = out + in.
export function sphereFlux(field, cx, cy, cz, R, nu = 48, nphi = 96) {
  const { x: U, w: W } = gaussLegendre(nu), f = [0, 0, 0];
  let out = 0, inn = 0;
  for (let i = 0; i < nu; i++) {
    const u = U[i], st = Math.sqrt(1 - u * u), wa = W[i] * R * R * 2 * Math.PI / nphi;
    for (let k = 0; k < nphi; k++) {
      const p = 2 * Math.PI * (k + 0.5) / nphi, nx = st * Math.cos(p), ny = st * Math.sin(p), nz = u;
      f[0] = f[1] = f[2] = 0; field(cx + R * nx, cy + R * ny, cz + R * nz, f);
      const v = (f[0] * nx + f[1] * ny + f[2] * nz) * wa;
      if (v > 0) out += v; else inn += v;
    }
  }
  return { net: out + inn, out, in: inn };
}
// Two unit vectors normal to n (n is a unit vector).
function basis(nx, ny, nz) {
  const ax = Math.abs(nx) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let ex = ny * ax[2] - nz * ax[1], ey = nz * ax[0] - nx * ax[2], ez = nx * ax[1] - ny * ax[0];
  const l = Math.hypot(ex, ey, ez); ex /= l; ey /= l; ez /= l;
  return [[ex, ey, ez], [ny * ez - nz * ey, nz * ex - nx * ez, nx * ey - ny * ex]];
}
// Flux through the disc (centre c, unit normal n, radius R). Gauss-Legendre
// in r (weight r dr) and uniform phi.
export function discFlux(field, c, n, R, nr = 32, nphi = 64) {
  const { x: U, w: W } = gaussLegendre(nr), [e1, e2] = basis(n[0], n[1], n[2]), f = [0, 0, 0];
  let s = 0;
  for (let i = 0; i < nr; i++) {
    const r = R * (U[i] + 1) / 2, wr = W[i] * R / 2 * r * 2 * Math.PI / nphi;
    for (let k = 0; k < nphi; k++) {
      const p = 2 * Math.PI * (k + 0.5) / nphi, cp = Math.cos(p) * r, sp = Math.sin(p) * r;
      f[0] = f[1] = f[2] = 0;
      field(c[0] + cp * e1[0] + sp * e2[0], c[1] + cp * e1[1] + sp * e2[1], c[2] + cp * e1[2] + sp * e2[2], f);
      s += (f[0] * n[0] + f[1] * n[1] + f[2] * n[2]) * wr;
    }
  }
  return s;
}
// Flux of the z component through the rectangle [x0, x1] x [y0, y1] in the
// page plane (normal +z, out of the page).
export function rectFlux(field, x0, y0, x1, y1, n = 24) {
  const { x: U, w: W } = gaussLegendre(n), f = [0, 0, 0];
  let s = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = x0 + (x1 - x0) * (U[i] + 1) / 2, y = y0 + (y1 - y0) * (U[j] + 1) / 2;
    f[0] = f[1] = f[2] = 0; field(x, y, 0, f);
    s += f[2] * W[i] * W[j];
  }
  return s * (x1 - x0) * (y1 - y0) / 4;
}

/* ═══ LINE INTEGRALS ═══ */
// The line integral of field round a circle (centre c, unit normal n,
// radius R), in the right-hand sense about n. The trapezoid rule is
// spectrally exact for a smooth periodic integrand.
export function loopIntegral(field, c, n, R, M = 360) {
  const [e1, e2] = basis(n[0], n[1], n[2]), f = [0, 0, 0], ds = 2 * Math.PI * R / M;
  let s = 0;
  for (let k = 0; k < M; k++) {
    const p = 2 * Math.PI * k / M, cp = Math.cos(p), sp = Math.sin(p);
    f[0] = f[1] = f[2] = 0;
    field(c[0] + R * (cp * e1[0] + sp * e2[0]), c[1] + R * (cp * e1[1] + sp * e2[1]), c[2] + R * (cp * e1[2] + sp * e2[2]), f);
    s += (f[0] * (-sp * e1[0] + cp * e2[0]) + f[1] * (-sp * e1[1] + cp * e2[1]) + f[2] * (-sp * e1[2] + cp * e2[2])) * ds;
  }
  return s;
}
// The line integral round the rectangle [x0, x1] x [y0, y1] in the page
// plane, counterclockwise (right-hand about +z). Gauss-Legendre per side.
export function rectLoopIntegral(field, x0, y0, x1, y1, n = 32) {
  const { x: U, w: W } = gaussLegendre(n), f = [0, 0, 0];
  const side = (ax, ay, bx, by) => {
    let s = 0; const L = Math.hypot(bx - ax, by - ay), tx = (bx - ax) / L, ty = (by - ay) / L;
    for (let i = 0; i < n; i++) {
      const t = (U[i] + 1) / 2; f[0] = f[1] = f[2] = 0; field(ax + (bx - ax) * t, ay + (by - ay) * t, 0, f);
      s += (f[0] * tx + f[1] * ty) * W[i] * L / 2;
    }
    return s;
  };
  return side(x0, y0, x1, y0) + side(x1, y0, x1, y1) + side(x1, y1, x0, y1) + side(x0, y1, x0, y0);
}

/* ═══ FARADAY ═══ */
// A magnet on the x axis (angle 0) with its centre at X and velocity V, and
// a fixed circular loop at x = loop.x, radius loop.R, normal +x.
//   phi       flux of B through the loop disc (surface integral)
//   emfLine   the line integral of the induced E = -dA/dt round the loop,
//             with dA/dt = V dA/dX (the field moves with the magnet)
//   emfFlux   -dPhi/dt = -V dPhi/dX
// The derivatives in X are central differences with step h.
export function faradayMagnet(X, V, loop, m = MAGNET, h = 0.25) {
  const c = [loop.x, 0, 0], n = [1, 0, 0];
  const Bf = segs => (x, y, z, o) => segB(segs, x, y, z, m.soft, 1, o);
  const s0 = magnetSegments(X, 0, 0, m), sp = magnetSegments(X + h, 0, 0, m), sm = magnetSegments(X - h, 0, 0, m);
  const phi = discFlux(Bf(s0), c, n, loop.R);
  const dPhidX = (discFlux(Bf(sp), c, n, loop.R) - discFlux(Bf(sm), c, n, loop.R)) / (2 * h);
  const Ap = [0, 0, 0], Am = [0, 0, 0];
  const Ef = (x, y, z, o) => {
    Ap[0] = Ap[1] = Ap[2] = Am[0] = Am[1] = Am[2] = 0;
    segA(sp, x, y, z, m.soft, 1, Ap); segA(sm, x, y, z, m.soft, 1, Am);
    o[0] -= V * (Ap[0] - Am[0]) / (2 * h); o[1] -= V * (Ap[1] - Am[1]) / (2 * h); o[2] -= V * (Ap[2] - Am[2]) / (2 * h);
    return o;
  };
  const emfLine = loopIntegral(Ef, c, n, loop.R, 180);
  return { phi, dPhidX, emfFlux: -V * dPhidX, emfLine };
}
// The capacitor current through a rectangle loop in the page plane (normal
// +z). Flux per unit current, and the EMF from E = -dA/dt = -(dI/dt) A/I.
export function faradayRect(cap, rect, I, dIdt) {
  const B1 = (x, y, z, o) => segB(cap.segs, x, y, z, cap.soft, 1, o);
  const A1 = (x, y, z, o) => segA(cap.segs, x, y, z, cap.soft, 1, o);
  const phi1 = rectFlux(B1, rect.x0, rect.y0, rect.x1, rect.y1);
  const line1 = rectLoopIntegral(A1, rect.x0, rect.y0, rect.x1, rect.y1);
  return { phi: phi1 * I, emfFlux: -phi1 * dIdt, emfLine: -line1 * dIdt, phi1, line1 };
}

/* ═══ AMPERE-MAXWELL ═══ */
// Both sides at a circular loop centred on the axis at x = loop.x, radius
// loop.s, normal +x. I is the wire current, so dQ/dt = I.
//   lhs     the line integral of B round the loop (Biot-Savart B)
//   Ienc    conduction current through the loop disc (segments that cross)
//   dPhiE   dPhi_E/dt through the disc: the flux of the Coulomb field of
//           the charge rates dq/dt = w I
//   rhs     mu0 (Ienc + eps0 dPhiE)
export function ampereMaxwell(cap, I, loop, M = 360) {
  const c = [loop.x, 0, 0], n = [1, 0, 0];
  const lhs = loopIntegral((x, y, z, o) => segB(cap.segs, x, y, z, cap.soft, I, o), c, n, loop.s, M);
  let Ienc = 0;
  for (const s of cap.segs) {
    if ((s.ax - loop.x) * (s.bx - loop.x) >= 0) continue;
    const t = (loop.x - s.ax) / (s.bx - s.ax), y = s.ay + (s.by - s.ay) * t, z = s.az + (s.bz - s.az) * t;
    if (Math.hypot(y, z) < loop.s) Ienc += s.I * I * Math.sign(s.bx - s.ax);
  }
  const dPhiE = discFlux((x, y, z, o) => capE(cap, I, x, y, z, o), c, n, loop.s, 48, 96);
  return { lhs, Ienc, dPhiE, disp: EPS0 * dPhiE, rhs: MU0 * (Ienc + EPS0 * dPhiE) };
}

/* ═══ FIELD LINES ═══ */
// Trace a line of a 2D field f(x, y) -> [fx, fy] from (x, y), in direction
// dir (+1 along the field, -1 against it), with step h (midpoint rule).
// stop(x, y, n) ends the line. Returns a flat [x0, y0, x1, y1, ...] list.
export function traceLine(f, x, y, dir, h, maxN, stop) {
  const pts = [x, y];
  for (let n = 0; n < maxN; n++) {
    const [ax, ay] = f(x, y), m = Math.hypot(ax, ay);
    if (!(m > 1e-14)) break;
    const mx = x + dir * h / 2 * ax / m, my = y + dir * h / 2 * ay / m;
    const [bx, by] = f(mx, my), m2 = Math.hypot(bx, by);
    if (!(m2 > 1e-14)) break;
    x += dir * h * bx / m2; y += dir * h * by / m2;
    pts.push(x, y);
    if (stop(x, y, n)) break;
  }
  return pts;
}

/* ═══ LIGHT ═══ */
// One dimension of Faraday and Ampere-Maxwell on a Yee grid: E_y at whole
// cells, B_z at half cells, in SI units.
//   dBz/dt = -dEy/dx                       (Faraday)
//   dEy/dt = -(1/(mu0 eps0)) dBz/dx - J/eps0   (Ampere-Maxwell)
// The wave speed is not put in. It comes out of the two updates. The ends
// absorb (first-order Mur, the one place that uses c), so the grid looks open.
export class Wave1D {
  constructor({ n = 400, dx = 1, dt = 1.5e-9, mu0 = SI_MU0, eps0 = SI_EPS0 } = {}) {
    Object.assign(this, { n, dx, dt, mu0, eps0 });
    this.E = new Float64Array(n); this.B = new Float64Array(n); this.t = 0; this.steps = 0;
    const c = lightSpeed(mu0, eps0), q = c * dt;
    this.mur = (q - dx) / (q + dx);
  }
  // J: a soft source current density (A/m^2) at cell src, or 0.
  step(src = -1, J = 0) {
    const { E, B, n, dx, dt, mu0, eps0 } = this;
    for (let i = 0; i < n - 1; i++) B[i] -= dt / dx * (E[i + 1] - E[i]);
    const e1 = E[1], en = E[n - 2], e0 = E[0], el = E[n - 1];
    for (let i = 1; i < n - 1; i++) E[i] -= dt / (mu0 * eps0 * dx) * (B[i] - B[i - 1]);
    if (src > 0) E[src] -= dt * J / eps0;
    E[0] = e1 + this.mur * (E[1] - e0);
    E[n - 1] = en + this.mur * (E[n - 2] - el);
    this.t += dt; this.steps++;
  }
}
