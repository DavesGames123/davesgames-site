// ============================================================================
//  MAXWELL'S EQUATIONS  ·  geom.js — the fields, the forms and the integrals
// ----------------------------------------------------------------------------
//  Pure math. No DOM and no three.js, so tests.mjs runs it in node and the
//  scenes draw from the same numbers. Units: eps0 = mu0 = c = 1.
//
//  Each source has a field, a flux function and a set of field lines. A
//  field line is the centre line of one flux tube, so each line carries the
//  same flux. A scene counts lines that cross a surface, and that count is
//  the flux in tube units.
//
//  SOURCES
//    point charges on the z axis .... eAxis, psiAxis, axisLines
//    a ring current in z = 0 ......... ringA, ringB, ringPsi, ringLines
//    a straight wire on the z axis ... wireB (B tubes and H sheets)
//    a capacitor in a wire ........... capItot, capB, capE, profileCurrent
//    a plane wave along z ............ waveEB
//
//  FORMS AND INTEGRALS
//    star surfaces (Gauss) ........... starSurface, crossings
//    parametric quadrature ........... surfaceFlux, loopIntegral, volumeIntegral
//    numeric d ....................... grad, curl, div
//    the Stokes map and sample forms .. stokesMap, SAMPLE
//    cubical cochains ................ cubeComplex (d0, d1, d2: dd = 0)
//
//  GREP MAP   (grep -n "<anchor>" geom.js)
//    "export function eAxis"   "export function axisLines"   "export function ellipKE"
//    "export function ringB"   "export function ringLines"   "export function starSurface"
//    "export function crossings"  "export function surfaceFlux"  "export function cubeComplex"
//    "export function capItot"    "export function waveEB"      "export const SAMPLE"
// ============================================================================

export const TAU = Math.PI * 2;
const hyp = Math.hypot;

// ── vectors (plain arrays) ─────────────────────────────────────────────────
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = a => hyp(a[0], a[1], a[2]);
export const unit = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// A seeded random source (LCG). Same seed, same numbers.
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

// ── point charges on the z axis ────────────────────────────────────────────
// Q = [{ z, q }]. E = sum q r^ / (4 pi r^2).
export function eAxis(Q, p) {
  let x = 0, y = 0, z = 0;
  for (const c of Q) {
    const dx = p[0], dy = p[1], dz = p[2] - c.z, r2 = dx * dx + dy * dy + dz * dz, r = Math.sqrt(r2), k = c.q / (2 * TAU * r2 * r);
    x += k * dx; y += k * dy; z += k * dz;
  }
  return [x, y, z];
}
// The potential phi (E = -grad phi).
export function phiAxis(Q, p) {
  let v = 0;
  for (const c of Q) v += c.q / (2 * TAU * hyp(p[0], p[1], p[2] - c.z));
  return v;
}
// The Stokes flux function: the flux of E inside the cone of polar angle
// theta_i round each charge, summed. It is constant along a field line in
// a meridian plane. On the axis above every charge it is 0, below every
// charge it is the total charge.
export function psiAxis(Q, r, z) {
  let s = 0;
  for (const c of Q) { const dz = z - c.z; s += c.q * (1 - dz / hyp(r, dz)) / 2; }
  return s;
}

// Field lines of axial charges. Each positive charge sends perUnit * q
// lines into each of naz meridian planes, at the flux levels
// (k + 1/2) / perUnit, so one line carries 1 / (perUnit * naz) of flux.
// A line stops on a negative charge or past rmax. Returns
//   [{ pts: [[x,y,z], ...], from: i, to: j or -1, level, az }]
// Q must have a total charge >= 0, so no line comes in from infinity.
export function axisLines(Q, { perUnit = 2, naz = 12, rmax = 30, h0 = 0.035, maxSteps = 4000, show = 4 } = {}) {
  const out = [];
  // E in the meridian plane (r, z), r >= 0.
  const Erz = (r, z) => { const e = eAxis(Q, [r, 0, z]); return [e[0], e[2]]; };
  for (let i = 0; i < Q.length; i++) {
    const c = Q[i];
    if (c.q <= 0) continue;
    let base = 0;
    for (let j = 0; j < Q.length; j++) if (j !== i && Q[j].z > c.z) base += Q[j].q;
    const n = Math.round(c.q * perUnit);
    for (let k = 0; k < n; k++) {
      const level = base + (k + 0.5) / perUnit;
      const ct = 1 - 2 * (level - base) / c.q;               // cos theta near the charge
      const st = Math.sqrt(Math.max(0, 1 - ct * ct));
      const d0 = 0.02;
      const pts = [];
      let r = d0 * st, z = c.z + d0 * ct, to = -1;
      pts.push([r, z]);
      for (let s = 0; s < maxSteps; s++) {
        let dmin = Infinity;
        for (const q of Q) dmin = Math.min(dmin, hyp(r, z - q.z));
        const h = Math.min(h0, Math.max(0.004, 0.3 * dmin));
        const f = (a, b) => { const e = Erz(a, b), l = hyp(e[0], e[1]) || 1; return [e[0] / l, e[1] / l]; };
        const k1 = f(r, z), k2 = f(r + h / 2 * k1[0], z + h / 2 * k1[1]), k3 = f(r + h / 2 * k2[0], z + h / 2 * k2[1]), k4 = f(r + h * k3[0], z + h * k3[1]);
        r += h / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
        z += h / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
        if (r < 0) r = -r;
        let hit = -1;
        for (let j = 0; j < Q.length; j++) if (Q[j].q < 0 && hyp(r, z - Q[j].z) < 0.02) hit = j;
        if (hit >= 0) { pts.push([0, Q[hit].z]); to = hit; break; }
        if (hyp(r, z) > rmax) break;
        if (hyp(r, z) < show + 0.5 || !pts.length || hyp(pts[pts.length - 1][0], pts[pts.length - 1][1]) < show + 0.5) pts.push([r, z]);
      }
      for (let a = 0; a < naz; a++) {
        const phi = (a + (k % 2) * 0.5) * TAU / naz, cp = Math.cos(phi), sp = Math.sin(phi);
        out.push({ pts: pts.map(([rr, zz]) => [rr * cp, rr * sp, zz]), from: i, to, level, az: phi });
      }
    }
  }
  return out;
}

// ── complete elliptic integrals K(m), E(m), m = k^2, by the AGM ────────────
export function ellipKE(m) {
  let a = 1, b = Math.sqrt(1 - m), c = Math.sqrt(m), sum = c * c / 2, p = 1;
  for (let i = 0; i < 40 && Math.abs(c) > 1e-15; i++) {
    const an = (a + b) / 2;
    c = (a - b) / 2; b = Math.sqrt(a * b); a = an;
    p *= 2; sum += p * c * c / 2;
  }
  const K = Math.PI / (2 * a);
  return [K, K * (1 - sum)];
}

// ── a ring current: radius a in the plane z = 0, current I (mu0 = 1) ───────
// A_phi(r, z). The flux through the disc of radius r at height z is
// 2 pi r A_phi (ringPsi).
export function ringAphi(a, r, z, I = 1) {
  if (r < 1e-9) return 0;
  const den = (a + r) * (a + r) + z * z, m = 4 * a * r / den;
  const [K, E] = ellipKE(Math.min(m, 1 - 1e-15));
  return I / Math.PI * Math.sqrt(a / r) / Math.sqrt(m) * ((1 - m / 2) * K - E);
}
export const ringPsi = (a, r, z, I = 1) => TAU * r * ringAphi(a, r, z, I);
// B in Cartesian coordinates (closed forms, Smythe).
export function ringB(a, p, I = 1) {
  const r = hyp(p[0], p[1]), z = p[2];
  const den = (a + r) * (a + r) + z * z, m = 4 * a * r / den, q = (a - r) * (a - r) + z * z;
  const [K, E] = ellipKE(Math.min(m, 1 - 1e-15));
  const s = I / (Math.PI * Math.sqrt(den));
  const Bz = s / 2 * (K + (a * a - r * r - z * z) / q * E);
  if (r < 1e-9) return [0, 0, Bz];
  const Br = s / 2 * z / r * (-K + (a * a + r * r + z * z) / q * E);
  return [Br * p[0] / r, Br * p[1] / r, Bz];
}
// A as a vector (A_phi phi^), for loop integrals of A.
export function ringA(a, p, I = 1) {
  const r = hyp(p[0], p[1]);
  if (r < 1e-9) return [0, 0, 0];
  const A = ringAphi(a, r, p[2], I);
  return [-A * p[1] / r, A * p[0] / r, 0];
}

// Closed field lines of the ring at the flux levels (k + 1/2) dPsi,
// k = 0 .. n-1, in naz meridian planes. Each line starts in z = 0 inside
// the ring and goes round the wire once. A line that does not close
// inside rmax is left out (closed: false lines are not returned).
export function ringLines(a, { n = 6, dPsi = 0.5, naz = 10, rmax = 14, h0 = 0.03, kStart = 0 } = {}) {
  const out = [];
  const Brz = (r, z) => { const b = ringB(a, [r, 0, z]); return [b[0], b[2]]; };
  for (let k = kStart; k < kStart + n; k++) {
    const level = (k + 0.5) * dPsi;
    // r0 in (0, a) with ringPsi = level.
    let lo = 1e-6, hi = a * (1 - 1e-6);
    for (let it = 0; it < 80; it++) { const mid = (lo + hi) / 2; if (ringPsi(a, mid, 0) < level) lo = mid; else hi = mid; }
    const r0 = (lo + hi) / 2;
    let r = r0, z = 0, ang = 0, closed = false;
    const pts = [[r, z]];
    let prevA = Math.atan2(z, r - a);
    for (let s = 0; s < 20000; s++) {
      const dw = hyp(r - a, z);
      const h = Math.min(h0, Math.max(0.002, 0.25 * dw));
      const f = (x, y) => { const b = Brz(x, y), l = hyp(b[0], b[1]) || 1; return [b[0] / l, b[1] / l]; };
      const k1 = f(r, z), k2 = f(r + h / 2 * k1[0], z + h / 2 * k1[1]), k3 = f(r + h / 2 * k2[0], z + h / 2 * k2[1]), k4 = f(r + h * k3[0], z + h * k3[1]);
      r += h / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
      z += h / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
      const A = Math.atan2(z, r - a);
      let dA = A - prevA; if (dA > Math.PI) dA -= TAU; if (dA < -Math.PI) dA += TAU;
      ang += dA; prevA = A;
      if (hyp(r, z) > rmax) break;
      if (Math.abs(ang) >= TAU) { closed = true; pts.push(pts[0]); break; }
      pts.push([r, z]);
    }
    if (!closed) continue;
    for (let j = 0; j < naz; j++) {
      const phi = (j + (k % 2) * 0.5) * TAU / naz, cp = Math.cos(phi), sp = Math.sin(phi);
      out.push({ pts: pts.map(([rr, zz]) => [rr * cp, rr * sp, zz]), level, az: phi, closed: true });
    }
  }
  return out;
}

// ── a straight wire on the z axis, current I (mu0 = 1) ─────────────────────
// B = I / (2 pi r) phi^. As a 2-form B = (I / 2 pi) dz ^ d(ln r): its tubes
// are the cells between the cylinders ln r = const and the planes z = const.
// As a 1-form, star B = (I / 2 pi) d(phi): its sheets are the half-planes
// phi = const, and a loop round the wire crosses I sheets per unit.
export function wireB(p, I = 1) {
  const r2 = p[0] * p[0] + p[1] * p[1] || 1e-12, k = I / (TAU * r2);
  return [-k * p[1], k * p[0], 0];
}

// ── a star-shaped closed surface (the Gaussian surface) ────────────────────
// R(dir) = R0 (1 + sum amp_i g_i(dir, t)), with lobes that breathe. The
// centre is c. inside(p) < 0 inside, > 0 outside. Star-shaped about c,
// so each ray from c meets it once.
export function starSurface({ c = [0, 0, 0], R0 = 1, lobes = [], amp = 0 } = {}) {
  const S = { c, R0, lobes, amp, t: 0 };
  S.radius = (d) => {
    let s = 0;
    for (const L of S.lobes) {
      const g = Math.exp(L.k * (dot(d, L.n) - 1));
      s += L.w * Math.sin(L.f * S.t + L.ph) * g;
    }
    return S.R0 * Math.max(0.35, 1 + S.amp * s);
  };
  S.inside = (p) => { const v = sub(p, S.c), l = len(v); if (l < 1e-12) return -S.R0; return l - S.radius(mul(v, 1 / l)); };
  S.point = (d) => add(S.c, mul(d, S.radius(d)));
  return S;
}
// Seeded lobes for starSurface.
export function makeLobes(seed, n = 5) {
  const r = rng(seed), L = [];
  for (let i = 0; i < n; i++) {
    const z = 2 * r() - 1, ph = TAU * r(), s = Math.sqrt(1 - z * z);
    L.push({ n: [s * Math.cos(ph), s * Math.sin(ph), z], k: 1.5 + 3 * r(), w: 0.35 + 0.4 * r(), f: 0.25 + 0.5 * r(), ph: TAU * r() });
  }
  return L;
}

// Where polylines cross a closed surface. f(p) < 0 inside. Returns
// { out, inn, pts: [[x,y,z, sign]] }. sign +1: the line goes out.
export function crossings(lines, f) {
  let out = 0, inn = 0;
  const pts = [];
  for (const L of lines) {
    const P = L.pts;
    let a = P[0], fa = f(a);
    for (let i = 1; i < P.length; i++) {
      const b = P[i], fb = f(b);
      if ((fa < 0) !== (fb < 0)) {
        // a few bisection steps for the point
        let lo = 0, hi = 1, flo = fa;
        for (let it = 0; it < 6; it++) {
          const m = (lo + hi) / 2, q = [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m, a[2] + (b[2] - a[2]) * m], fm = f(q);
          if ((fm < 0) === (flo < 0)) { lo = m; flo = fm; } else hi = m;
        }
        const m = (lo + hi) / 2, sg = fa < 0 ? 1 : -1;
        pts.push([a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m, a[2] + (b[2] - a[2]) * m, sg]);
        if (sg > 0) out++; else inn++;
      }
      a = b; fa = fb;
    }
  }
  return { out, inn, pts };
}

// ── quadrature ─────────────────────────────────────────────────────────────
// Flux of F through the surface P(u, v), u, v in [0,1]^2, normal along
// dP/du x dP/dv. Midpoint rule, central differences for the partials.
export function surfaceFlux(F, P, nu = 96, nv = 96) {
  let s = 0;
  const hu = 1 / nu, hv = 1 / nv, e = 1e-5;
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const u = (i + 0.5) * hu, v = (j + 0.5) * hv;
    const pu = mul(sub(P(u + e, v), P(u - e, v)), 1 / (2 * e)), pv = mul(sub(P(u, v + e), P(u, v - e)), 1 / (2 * e));
    s += dot(F(P(u, v)), cross(pu, pv)) * hu * hv;
  }
  return s;
}
// Line integral of F along C(s), s in [0,1] (a closed loop when C(0) = C(1)).
export function loopIntegral(F, C, n = 512) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const a = C(i / n), b = C((i + 1) / n), m = C((i + 0.5) / n);
    s += dot(F(m), sub(b, a));
  }
  return s;
}
// Integral of the scalar g over the solid M(u, v, w), unit cube domain.
export function volumeIntegral(g, M, n = 24) {
  let s = 0;
  const h = 1 / n, e = 1e-5;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
    const u = (i + 0.5) * h, v = (j + 0.5) * h, w = (k + 0.5) * h;
    const mu = mul(sub(M(u + e, v, w), M(u - e, v, w)), 1 / (2 * e));
    const mv = mul(sub(M(u, v + e, w), M(u, v - e, w)), 1 / (2 * e));
    const mw = mul(sub(M(u, v, w + e), M(u, v, w - e)), 1 / (2 * e));
    s += g(M(u, v, w)) * dot(mu, cross(mv, mw)) * h * h * h;
  }
  return s;
}

// ── numeric d on R^3 (central differences) ─────────────────────────────────
// 0-form f -> 1-form grad f; 1-form F -> 2-form curl F; 2-form F -> 3-form div F.
const H = 1e-4;
export function grad(f) {
  return p => [(f([p[0] + H, p[1], p[2]]) - f([p[0] - H, p[1], p[2]])) / (2 * H),
    (f([p[0], p[1] + H, p[2]]) - f([p[0], p[1] - H, p[2]])) / (2 * H),
    (f([p[0], p[1], p[2] + H]) - f([p[0], p[1], p[2] - H])) / (2 * H)];
}
export function curl(F) {
  return p => {
    const dx = (k) => (F([p[0] + H, p[1], p[2]])[k] - F([p[0] - H, p[1], p[2]])[k]) / (2 * H);
    const dy = (k) => (F([p[0], p[1] + H, p[2]])[k] - F([p[0], p[1] - H, p[2]])[k]) / (2 * H);
    const dz = (k) => (F([p[0], p[1], p[2] + H])[k] - F([p[0], p[1], p[2] - H])[k]) / (2 * H);
    return [dy(2) - dz(1), dz(0) - dx(2), dx(1) - dy(0)];
  };
}
export function div(F) {
  return p => (F([p[0] + H, p[1], p[2]])[0] - F([p[0] - H, p[1], p[2]])[0]
    + F([p[0], p[1] + H, p[2]])[1] - F([p[0], p[1] - H, p[2]])[1]
    + F([p[0], p[1], p[2] + H])[2] - F([p[0], p[1], p[2] - H])[2]) / (2 * H);
}

// ── the Stokes map: the unit cube onto a bent, twisted block ───────────────
// The scene draws the path (v = w = 0), the sheet (w = 0) and the solid
// from this one map, so all three share their edges.
export function stokesMap(u, v, w) {
  const x = -1.5 + 3 * u, bend = 0.55 * Math.sin(Math.PI * u);
  const y = -0.9 + 1.8 * v, tw = 0.5 * (u - 0.5);
  const h = 1.1 * w;
  const c = Math.cos(tw), s = Math.sin(tw);
  return [x + 0.15 * Math.sin(2.1 * y), (y * c - h * s) * (1 + 0.15 * u), bend + y * s + h * c - 0.55 + 0.2 * y * y];
}
// Sample forms for the three Stokes cases and their d, in closed form.
//   f      a 0-form,       df = grad f
//   alpha  a 1-form,       d alpha = curl alpha (as a 2-form)
//   beta   a 2-form,       d beta = div beta (as a 3-form)
export const SAMPLE = {
  f: p => Math.sin(1.3 * p[0]) + 0.6 * p[1] * p[2] + 0.3 * p[2],
  df: p => [1.3 * Math.cos(1.3 * p[0]), 0.6 * p[2], 0.6 * p[1] + 0.3],
  alpha: p => [-p[1] + 0.3 * p[2], p[0] + 0.2 * p[0] * p[2], 0.5 * Math.sin(p[0])],
  dalpha: p => [0 - 0.2 * p[0], 0.3 - 0.5 * Math.cos(p[0]), 1 + 0.2 * p[2] + 1],
  beta: p => [p[0] + 0.4 * p[1] * p[1], 0.5 * p[1] * p[2], 0.3 * p[2] * p[2] + Math.sin(p[0])],
  dbeta: p => 1 + 0.5 * p[2] + 0.6 * p[2],
};

// ── cubical cochains on an n x n x n grid of unit cells ────────────────────
// Vertices, edges, faces and cells with fixed orientations. d0, d1, d2 are
// the coboundary maps: (d w)(cell) = sum of w over the cell boundary, with
// signs. dd = 0 and Stokes hold exactly at this level.
export function cubeComplex(n) {
  const V = (i, j, k) => (i * (n + 1) + j) * (n + 1) + k;
  const nv = (n + 1) ** 3;
  const edges = [], faces = [], cells = [];
  const eIdx = new Map(), fIdx = new Map();
  // edges along axis a from vertex (i,j,k)
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) for (let k = 0; k <= n; k++) {
    for (let a = 0; a < 3; a++) {
      const t = [i, j, k]; t[a]++;
      if (t[a] > n) continue;
      eIdx.set(`${i},${j},${k},${a}`, edges.length);
      edges.push([V(i, j, k), V(...t)]);
    }
  }
  const E = (i, j, k, a) => eIdx.get(`${i},${j},${k},${a}`);
  // face spanned by axes a < b at (i,j,k); boundary loop +e_a(p) +e_b(p+a) -e_a(p+b) -e_b(p)
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) for (let k = 0; k <= n; k++) {
    for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
      const p = [i, j, k], pa = p.slice(), pb = p.slice(); pa[a]++; pb[b]++;
      if (pa[a] > n || pb[b] > n) continue;
      fIdx.set(`${i},${j},${k},${a}${b}`, faces.length);
      faces.push({ a, b, p, bd: [[E(...p, a), 1], [E(...pa, b), 1], [E(...pb, a), -1], [E(...p, b), -1]] });
    }
  }
  const F = (p, ab) => fIdx.get(`${p[0]},${p[1]},${p[2]},${ab}`);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
    const p = [i, j, k], px = [i + 1, j, k], py = [i, j + 1, k], pz = [i, j, k + 1];
    // outward orientation: face ab has normal e_a x e_b; xy -> +z, xz -> -y, yz -> +x
    cells.push({ p, bd: [[F(pz, '01'), 1], [F(p, '01'), -1], [F(py, '02'), -1], [F(p, '02'), 1], [F(px, '12'), 1], [F(p, '12'), -1]] });
  }
  const d0 = w => edges.map(([u, v]) => w[v] - w[u]);
  const d1 = w => faces.map(f => f.bd.reduce((s, [e, sg]) => s + sg * w[e], 0));
  const d2 = w => cells.map(c => c.bd.reduce((s, [f, sg]) => s + sg * w[f], 0));
  // faces on the outer boundary with their outward sign
  const boundary = [];
  faces.forEach((f, idx) => {
    const c = 3 - f.a - f.b, v = f.p[c];
    if (v === 0) boundary.push([idx, c === 1 ? 1 : -1]);
    else if (v === n) boundary.push([idx, c === 1 ? -1 : 1]);
  });
  return { n, nv, edges, faces, cells, d0, d1, d2, boundary };
}

// ── a capacitor in a wire on the z axis ────────────────────────────────────
// Plates of radius a at z = +-g, ideal (no fringe field). Current I flows
// in +z, so the lower plate holds +Q and the upper plate -Q. Between the
// plates E = Q / (pi a^2) z^ and the displacement current density
// dE/dt = I / (pi a^2) carries the current on across the gap.
export function capItot(cap, r, z, I) {
  if (Math.abs(z) >= cap.g) return I;
  return I * Math.min(1, (r * r) / (cap.a * cap.a));
}
// The current that passes through the disc of radius r at height z, split
// into the conduction part and the displacement part.
export function capSplit(cap, r, z, I) {
  if (Math.abs(z) >= cap.g) return { cond: I, disp: 0 };
  return { cond: 0, disp: I * Math.min(1, (r * r) / (cap.a * cap.a)) };
}
// B is azimuthal by symmetry, so the loop law gives it exactly.
export function capB(cap, p, I) {
  const r = Math.hypot(p[0], p[1]);
  if (r < 1e-9) return [0, 0, 0];
  const B = capItot(cap, r, p[2], I) / (TAU * r);
  return [-B * p[1] / r, B * p[0] / r, 0];
}
export function capE(cap, p, Q) {
  const r = Math.hypot(p[0], p[1]);
  if (Math.abs(p[2]) >= cap.g || r >= cap.a) return [0, 0, 0];
  return [0, 0, Q / (Math.PI * cap.a * cap.a)];
}
// The total current density (conduction + displacement) in the gap as a
// vector field; the wire itself is a line current, counted by axisCrossings.
export function capJd(cap, p, I) {
  const r = Math.hypot(p[0], p[1]);
  if (Math.abs(p[2]) >= cap.g || r >= cap.a) return [0, 0, 0];
  return [0, 0, I / (Math.PI * cap.a * cap.a)];
}
// The current through an axisymmetric surface bounded by the horizontal
// loop of radius r0 at height z0. prof(s) = [r, z], s in [0, 1], runs from
// the loop (s = 0) to the axis (s = 1, r = 0). The loop runs counter-
// clockwise seen from +z, so the normal of a flat disc is +z.
//   cond  I when the surface meets the wire (the axis outside the gap)
//   disp  the displacement current: -int J_z 2 pi r dr along the profile
export function profileCurrent(cap, prof, I, n = 2000) {
  const end = prof(1);
  const cond = Math.abs(end[1]) > cap.g ? I : 0;
  let disp = 0;
  // J_z is I / (pi a^2) for r < a in the gap, so a piece from r1 to r2
  // inside the gap carries I (min(r2,a)^2 - min(r1,a)^2) / a^2, exactly.
  for (let i = 0; i < n; i++) {
    const a = prof(i / n), b = prof((i + 1) / n), m = prof((i + 0.5) / n);
    if (Math.abs(m[1]) >= cap.g) continue;
    const ra = Math.min(a[0], cap.a), rb = Math.min(b[0], cap.a);
    disp -= I * (rb * rb - ra * ra) / (cap.a * cap.a);
  }
  return { cond, disp };
}
// The bag: from the loop out past the plate edge to radius R, then to
// the mid-plane z = 0 and in to the axis. It meets no wire.
export function bagProfile(cap, r0, z0, R = cap.a + 0.35) {
  const pts = [[r0, z0], [R, z0 - 0.25 * Math.sign(z0)], [R, 0.3 * Math.sign(z0)], [R, 0], [0, 0]];
  const L = []; let tot = 0;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); L.push(d); tot += d; }
  return s => {
    let d = s * tot;
    for (let i = 0; i < L.length; i++) {
      if (d <= L[i] || i === L.length - 1) { const t = Math.min(1, d / L[i]); return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]; }
      d -= L[i];
    }
    return pts[pts.length - 1];
  };
}
// A flat disc: the loop straight in to the axis.
export const discProfile = (r0, z0) => s => [r0 * (1 - s), z0];
// An axisymmetric surface as P(u, v): u along the profile, v round the axis.
export const revolve = prof => (u, v) => { const [r, z] = prof(u); return [r * Math.cos(TAU * v), r * Math.sin(TAU * v), z]; };

// ── a plane wave along z, E along x, B along y (c = 1) ─────────────────────
export function waveEB(z, t, k = TAU / 2.4, E0 = 1) {
  const ph = Math.cos(k * (z - t));
  return { E: [E0 * ph, 0, 0], B: [0, E0 * ph, 0] };
}
