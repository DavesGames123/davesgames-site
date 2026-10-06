// ============================================================================
//  LENS  ·  strong-lens engine for the gravitational-imaging page (ES module)
// ----------------------------------------------------------------------------
//  No DOM, no GPU. Node can import this module, so tools can render the
//  model to PNG and test it. All angles are in milli-arcseconds (mas). All
//  masses are in solar masses.
//
//  MODEL
//    macro     elliptical power-law (EPL) mass, deflection by the series of
//              Tessore & Metcalf (2015), plus external shear. Paper eq. 7.
//    subs      pseudo-Jaffe (PJ) perturbers, paper eq. 9. Each has x, y,
//              m (total mass), rt (truncation radius, mas) and on.
//    source    sum of elliptical Gaussian lobes, with an analytic gradient.
//
//  The constants come from the paper (JVAS B1938+666, zl 0.881, zs 2.059,
//  Planck 2015): Sigma_cr = 1.50e11 Msun/arcsec^2. PC_PER_MAS comes from
//  the Planck 2015 angular-diameter distance at zl (7.96 pc per mas).
//
//  EXPORTS   (jump with grep -n "<anchor>" lens.js)
//    constants ........ "export const SIGMA_CR"
//    PJ mass .......... "export function pjMass"
//    deflection ....... "export function deflect"
//    source ........... "export function srcEval"
//    ray shooting ..... "export function shoot"
//    image render ..... "export function render"
//    blur ............. "export function blur"
//    critical curves .. "export function critical"
//    magnification .... "export function magnification"
//    smooth fit ....... "export function smoothFit"
//    residual test .... "export function experiment"
//    GI solver ........ "export function giSolve"
// ============================================================================

export const SIGMA_CR = 1.50e5;      // Msun per mas^2 (1.50e11 per arcsec^2)
export const PC_PER_MAS = 7.96;      // proper pc per mas at z = 0.881
export const R80 = 80 / PC_PER_MAS;  // 80 pc in mas

// Projected (cylindrical) mass of a PJ profile inside radius R.
// Integral of paper eq. 9: M(<R) = m (rt + R - sqrt(R^2 + rt^2)) / rt.
export function pjMass(R, m, rt) {
  return m * (rt + R - Math.sqrt(R * R + rt * rt)) / rt;
}

// PJ total mass that puts m80 inside R80 for a truncation radius rt.
export function pjTotalFor(m80, rt) {
  return m80 / pjMass(R80, 1, rt);
}

// Einstein radius (mas) of a point mass m: m = pi theta_E^2 Sigma_cr.
export function thetaE(m) { return Math.sqrt(m / (Math.PI * SIGMA_CR)); }

// Deflection at (x, y). Writes [ax, ay] into out. lens = { b, q, phi (rad),
// gamma, shear, shearPhi (rad), x0, y0, subs: [...], aff (optional) }.
export function deflect(L, x, y, out) {
  let ax = 0, ay = 0;
  // EPL. Rotate into the frame where the major axis is x.
  const dx = x - L.x0, dy = y - L.y0;
  const c = Math.cos(L.phi), s = Math.sin(L.phi);
  const u = c * dx + s * dy, v = -s * dx + c * dy;
  const q = L.q, t = L.gamma - 1, b = L.b;
  const R = Math.sqrt(q * q * u * u + v * v) + 1e-9;
  const ph = Math.atan2(v, q * u);
  const f = (1 - q) / (1 + q);
  // Series for e^{i ph} 2F1(1, t/2; 2 - t/2; -f e^{2 i ph}).
  let wr = Math.cos(ph), wi = Math.sin(ph);
  let sr = wr, si = wi;
  const c2 = Math.cos(2 * ph), s2 = Math.sin(2 * ph);
  for (let n = 1; n < 40; n++) {
    const k = -f * (2 * n - (2 - t)) / (2 * n + (2 - t));
    const nr = k * (c2 * wr - s2 * wi), ni = k * (c2 * wi + s2 * wr);
    wr = nr; wi = ni; sr += wr; si += wi;
    if (Math.abs(wr) + Math.abs(wi) < 1e-7) break;
  }
  const amp = 2 * b / (1 + q) * Math.pow(b / R, t - 1);
  const au = amp * sr, av = amp * si;
  ax += c * au - s * av; ay += s * au + c * av;
  // External shear.
  const g1 = L.shear * Math.cos(2 * L.shearPhi), g2 = L.shear * Math.sin(2 * L.shearPhi);
  ax += g1 * dx + g2 * dy; ay += g2 * dx - g1 * dy;
  // PJ perturbers.
  const subs = L.subs;
  if (subs) for (let i = 0; i < subs.length; i++) {
    const p = subs[i];
    if (!p.on || p.m <= 0) continue;
    const ex = x - p.x, ey = y - p.y;
    const r2 = ex * ex + ey * ey + 1e-8, r = Math.sqrt(r2);
    const a = pjMass(r, p.m, p.rt) / (Math.PI * SIGMA_CR * r2);
    ax += a * ex; ay += a * ey;
  }
  // Affine correction from smoothFit().
  const af = L.aff;
  if (af) {
    const ux = x - af.x, uy = y - af.y;
    ax += af.a0 + (af.k + af.g1) * ux + af.g2 * uy;
    ay += af.a1 + af.g2 * ux + (af.k - af.g1) * uy;
  }
  out[0] = ax; out[1] = ay;
}

// Source surface brightness at (bx, by). lobes: [{ x, y, sx, sy, ang, amp }].
export function srcEval(lobes, bx, by) {
  let I = 0;
  for (let i = 0; i < lobes.length; i++) {
    const o = lobes[i];
    const dx = bx - o.x, dy = by - o.y;
    const c = Math.cos(o.ang), s = Math.sin(o.ang);
    const u = (c * dx + s * dy) / o.sx, v = (-s * dx + c * dy) / o.sy;
    I += o.amp * Math.exp(-0.5 * (u * u + v * v));
  }
  return I;
}

// Source gradient. Writes [dI/dbx, dI/dby] into out and returns I.
export function srcGrad(lobes, bx, by, out) {
  let I = 0, gx = 0, gy = 0;
  for (let i = 0; i < lobes.length; i++) {
    const o = lobes[i];
    const dx = bx - o.x, dy = by - o.y;
    const c = Math.cos(o.ang), s = Math.sin(o.ang);
    const u = (c * dx + s * dy) / o.sx, v = (-s * dx + c * dy) / o.sy;
    const e = o.amp * Math.exp(-0.5 * (u * u + v * v));
    const du = -u / o.sx * e, dv = -v / o.sy * e;
    I += e; gx += c * du - s * dv; gy += s * du + c * dv;
  }
  out[0] = gx; out[1] = gy;
  return I;
}

// Ray-shoot a window. win = { x0, y0, size, n } with (x0, y0) the centre.
// ss = supersamples per axis. Returns { bx, by } (Float32Array n*n*ss*ss)
// in row-major pixel order, subsamples grouped per pixel. Row 0 is the top
// (largest y).
export function shoot(L, win, ss = 1) {
  const { n, size } = win, px = size / n, N = n * n * ss * ss;
  const bx = new Float32Array(N), by = new Float32Array(N), a = [0, 0];
  let k = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++)
    for (let sj = 0; sj < ss; sj++) for (let si = 0; si < ss; si++) {
      const x = win.x0 - size / 2 + (i + (si + 0.5) / ss) * px;
      const y = win.y0 + size / 2 - (j + (sj + 0.5) / ss) * px;
      deflect(L, x, y, a);
      bx[k] = x - a[0]; by[k] = y - a[1]; k++;
    }
  return { bx, by, n, ss };
}

// Image from shot rays. Returns Float32Array n*n of surface brightness.
export function render(rays, lobes, out) {
  const { bx, by, n, ss } = rays, s2 = ss * ss;
  const img = out || new Float32Array(n * n);
  for (let p = 0, k = 0; p < n * n; p++) {
    let sum = 0;
    for (let q = 0; q < s2; q++, k++) sum += srcEval(lobes, bx[k], by[k]);
    img[p] = sum / s2;
  }
  return img;
}

// Separable Gaussian blur with sigma in pixels. Zero outside the image.
// The kernel sums to 1, so the result stays in surface-brightness units.
// The operator is symmetric, so it is also its own adjoint (giSolve).
export function blur(img, n, sigma, out) {
  const res = out || new Float32Array(n * n);
  if (!(sigma > 0.3)) { res.set(img); return res; }
  const r = Math.min(Math.ceil(3 * sigma), n), K = new Float32Array(2 * r + 1);
  let ks = 0;
  for (let i = -r; i <= r; i++) { K[i + r] = Math.exp(-0.5 * (i / sigma) ** 2); ks += K[i + r]; }
  for (let i = 0; i < K.length; i++) K[i] /= ks;
  const tmp = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const row = j * n;
    for (let i = 0; i < n; i++) {
      let s = 0;
      const a = Math.max(0, i - r), b = Math.min(n - 1, i + r);
      for (let t = a; t <= b; t++) s += img[row + t] * K[t - i + r];
      tmp[row + i] = s;
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      const a = Math.max(0, j - r), b = Math.min(n - 1, j + r);
      for (let t = a; t <= b; t++) s += tmp[t * n + i] * K[t - j + r];
      res[j * n + i] = s;
    }
  }
  return res;
}

// Inverse magnification det(A) at (x, y), by central differences.
export function detA(L, x, y, h = 0.25) {
  const a = [0, 0], b = [0, 0], c = [0, 0], d = [0, 0];
  deflect(L, x + h, y, a); deflect(L, x - h, y, b);
  deflect(L, x, y + h, c); deflect(L, x, y - h, d);
  const axx = (a[0] - b[0]) / (2 * h), ayx = (a[1] - b[1]) / (2 * h);
  const axy = (c[0] - d[0]) / (2 * h), ayy = (c[1] - d[1]) / (2 * h);
  return (1 - axx) * (1 - ayy) - axy * ayx;
}

// Magnification parts at (x, y): total mu and the tangential and radial
// eigenvalues of the Jacobian.
export function magnification(L, x, y, h = 0.25) {
  const a = [0, 0], b = [0, 0], c = [0, 0], d = [0, 0];
  deflect(L, x + h, y, a); deflect(L, x - h, y, b);
  deflect(L, x, y + h, c); deflect(L, x, y - h, d);
  const A11 = 1 - (a[0] - b[0]) / (2 * h), A22 = 1 - (c[1] - d[1]) / (2 * h);
  const A12 = -((c[0] - d[0]) + (a[1] - b[1])) / (4 * h);
  const tr = (A11 + A22) / 2, df = Math.sqrt(((A11 - A22) / 2) ** 2 + A12 * A12);
  const l1 = tr - df, l2 = tr + df;
  return { mu: 1 / (l1 * l2), lt: l1, lr: l2 };
}

// Critical curves (det A = 0) by marching squares on a grid over win, and
// their caustics through the lens equation. Returns two Float32Arrays of
// segments [x1, y1, x2, y2, ...].
export function critical(L, win) {
  const n = win.n, px = win.size / n, D = new Float32Array((n + 1) * (n + 1));
  const X = i => win.x0 - win.size / 2 + i * px, Y = j => win.y0 + win.size / 2 - j * px;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) D[j * (n + 1) + i] = detA(L, X(i), Y(j), px * 0.5);
  const crit = [], caus = [], a = [0, 0];
  const lerp = (i0, j0, i1, j1) => {
    const d0 = D[j0 * (n + 1) + i0], d1 = D[j1 * (n + 1) + i1], t = d0 / (d0 - d1);
    return [X(i0 + (i1 - i0) * t), Y(j0 + (j1 - j0) * t)];
  };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const v = [D[j * (n + 1) + i], D[j * (n + 1) + i + 1], D[(j + 1) * (n + 1) + i + 1], D[(j + 1) * (n + 1) + i]];
    const pts = [];
    if ((v[0] > 0) !== (v[1] > 0)) pts.push(lerp(i, j, i + 1, j));
    if ((v[1] > 0) !== (v[2] > 0)) pts.push(lerp(i + 1, j, i + 1, j + 1));
    if ((v[2] > 0) !== (v[3] > 0)) pts.push(lerp(i + 1, j + 1, i, j + 1));
    if ((v[3] > 0) !== (v[0] > 0)) pts.push(lerp(i, j + 1, i, j));
    for (let k = 0; k + 1 < pts.length; k += 2) {
      const [p, q] = [pts[k], pts[k + 1]];
      crit.push(p[0], p[1], q[0], q[1]);
      deflect(L, p[0], p[1], a); const s0 = [p[0] - a[0], p[1] - a[1]];
      deflect(L, q[0], q[1], a);
      caus.push(s0[0], s0[1], q[0] - a[0], q[1] - a[1]);
    }
  }
  return { crit: new Float32Array(crit), caus: new Float32Array(caus) };
}

// Best smooth model without one perturber. A smooth model can absorb the
// part of the perturber's pull that is the same, or changes linearly, over
// the arc: a source shift plus a local change of convergence and shear.
// Fit d alpha(theta) = a + G (theta - c), G symmetric (5 parameters), to the
// perturber deflection by linear least squares. Weights are the image
// brightness, so the fit cares about the arc. Returns an "aff" object for
// lens.aff: deflect() adds it to the macro model.
export function smoothFit(sub, img, win) {
  const { n } = win, px = win.size / n, a = [0, 0];
  const A = Array.from({ length: 5 }, () => new Float64Array(5)), b = new Float64Array(5);
  const only = { b: 0, q: 1, phi: 0, gamma: 2, shear: 0, shearPhi: 0, x0: 0, y0: 0, subs: [{ ...sub, on: true }] };
  let wmax = 0; for (let p = 0; p < n * n; p++) wmax = Math.max(wmax, img[p]);
  for (let j = 0, p = 0; j < n; j++) for (let i = 0; i < n; i++, p++) {
    const w = img[p] / (wmax || 1) + 1e-4;
    const dx = (i + 0.5) * px - win.size / 2, dy = win.size / 2 - (j + 0.5) * px;
    pjOnly(only, win.x0 + dx, win.y0 + dy, a);
    // rows: ax = a0 + (k + g1) dx + g2 dy ; ay = a1 + g2 dx + (k - g1) dy
    const rx = [1, 0, dx, dx, dy], ry = [0, 1, dy, -dy, dx];
    for (let r = 0; r < 5; r++) {
      b[r] += w * (rx[r] * a[0] + ry[r] * a[1]);
      for (let c = 0; c < 5; c++) A[r][c] += w * (rx[r] * rx[c] + ry[r] * ry[c]);
    }
  }
  const z = solveN(A, b);
  return { x: win.x0, y: win.y0, a0: z[0], a1: z[1], k: z[2], g1: z[3], g2: z[4] };
}

// One residual test, as on the page and in build-floor.mjs. The data are
// the lens with the perturber, blurred by a beam of fwhm (mas). The model
// is the best smooth fit (smoothFit). Window: max(60, 5 fwhm) mas around
// the perturber, n pixels, with enough supersamples for about 0.4 mas.
// noise is the r.m.s. per beam in surface-brightness units.
// Returns { win, data, model, res (in noise units), max, I1, I0 }.
export function experiment({ lens, lobes, sub, fwhm, noise, n = 128, size }) {
  const S = size || Math.max(60, 5 * fwhm), win = { x0: sub.x, y0: sub.y, size: S, n };
  const px = S / n, sig = fwhm / 2.355 / px, ss = Math.min(8, Math.max(2, Math.ceil(px / 0.4)));
  const others = (lens.subs || []).filter(p => p !== sub);
  const L1 = { ...lens, subs: [...others, { ...sub, on: true }] };
  const r1 = shoot(L1, win, ss), I1 = render(r1, lobes), data = blur(I1, n, sig);
  const aff = smoothFit(sub, I1, win);
  const L0 = { ...lens, subs: others, aff };
  const I0 = render(shoot(L0, win, ss), lobes), model = blur(I0, n, sig);
  const res = new Float32Array(n * n);
  let max = 0;
  for (let p = 0; p < n * n; p++) { res[p] = (data[p] - model[p]) / noise; max = Math.max(max, Math.abs(res[p])); }
  return { win, data, model, res, max, I1, I0, aff };
}

function pjOnly(L, x, y, out) {
  const p = L.subs[0], ex = x - p.x, ey = y - p.y, r2 = ex * ex + ey * ey + 1e-8;
  const k = pjMass(Math.sqrt(r2), p.m, p.rt) / (Math.PI * SIGMA_CR * r2);
  out[0] = k * ex; out[1] = k * ey;
}

function solveN(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    if (Math.abs(M[c][c]) < 1e-30) return new Array(n).fill(0);
    for (let r = 0; r < n; r++) if (r !== c) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

// ---------------------------------------------------------------- GI
// Gravitational imaging, toy form. The page knows the true source, so it
// solves only for a pixellated potential correction dpsi on a G x G node
// grid over win. Each Newton step linearises I(theta) = S(theta - alpha0 -
// grad dpsi) about the current dpsi and solves
//   (A^T A / s^2 + lam R) d = A^T r / s^2 - lam R dpsi
// by conjugate gradients, where A = blur(-gradS . grad_bilinear(.)).
// R penalises kappa (mass), grad kappa (grad) or lap kappa (curv), with
// kappa = lap(dpsi) / 2. Returns kappa on the nodes in Msun per node cell.
//   opts = { L0, lobes, win, data, sigma (noise), psf (px), G, lam, reg,
//            newton, cg }
export function giSolve(o) {
  const { L0, lobes, win, data, sigma, psf } = o;
  const n = win.n, px = win.size / n, G = o.G || 33, h = win.size / (G - 1);
  const NN = n * n, M = G * G;
  // Base deflection and bilinear cell of each pixel.
  const ax0 = new Float32Array(NN), ay0 = new Float32Array(NN);
  const ci = new Int32Array(NN), fx = new Float32Array(NN), fy = new Float32Array(NN);
  const xs = new Float32Array(NN), ys = new Float32Array(NN), a = [0, 0];
  for (let j = 0, p = 0; j < n; j++) for (let i = 0; i < n; i++, p++) {
    const x = win.x0 - win.size / 2 + (i + 0.5) * px, y = win.y0 + win.size / 2 - (j + 0.5) * px;
    xs[p] = x; ys[p] = y; deflect(L0, x, y, a); ax0[p] = a[0]; ay0[p] = a[1];
    // Node (gi, gj): x = left + gi h, y = top - gj h.
    const u = (x - (win.x0 - win.size / 2)) / h, w = ((win.y0 + win.size / 2) - y) / h;
    const gi = Math.min(G - 2, Math.floor(u)), gj = Math.min(G - 2, Math.floor(w));
    ci[p] = gj * G + gi; fx[p] = u - gi; fy[p] = w - gj;
  }
  // grad of bilinear psi at pixel p (x right, y up; node rows go down).
  const gradAt = (psi, p, out) => {
    const c = ci[p], X = fx[p], Y = fy[p];
    const p00 = psi[c], p10 = psi[c + 1], p01 = psi[c + G], p11 = psi[c + G + 1];
    out[0] = ((1 - Y) * (p10 - p00) + Y * (p11 - p01)) / h;
    out[1] = -((1 - X) * (p01 - p00) + X * (p11 - p10)) / h;
  };
  const gradT = (p, gx, gy, acc) => {
    const c = ci[p], X = fx[p], Y = fy[p];
    gx /= h; gy /= -h;
    acc[c] += -(1 - Y) * gx - (1 - X) * gy;
    acc[c + 1] += (1 - Y) * gx - X * gy;
    acc[c + G] += -Y * gx + (1 - X) * gy;
    acc[c + G + 1] += Y * gx + X * gy;
  };
  // Laplacian on nodes (zero outside), and kappa = lap / 2 in kappa units.
  const lap = (v, out) => {
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const k = j * G + i, c = v[k];
      const l = i > 0 ? v[k - 1] : 0, r = i < G - 1 ? v[k + 1] : 0;
      const u = j > 0 ? v[k - G] : 0, d = j < G - 1 ? v[k + G] : 0;
      out[k] = (l + r + u + d - 4 * c) / (h * h);
    }
    return out;
  };
  const gradN = (v, out) => {   // forward differences, 2 components
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const k = j * G + i;
      out[2 * k] = i < G - 1 ? (v[k + 1] - v[k]) / h : 0;
      out[2 * k + 1] = j < G - 1 ? (v[k + G] - v[k]) / h : 0;
    }
    return out;
  };
  const gradNT = (g, out) => {
    out.fill(0);
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const k = j * G + i;
      if (i < G - 1) { out[k + 1] += g[2 * k] / h; out[k] -= g[2 * k] / h; }
      if (j < G - 1) { out[k + G] += g[2 * k + 1] / h; out[k] -= g[2 * k + 1] / h; }
    }
    return out;
  };
  const t1 = new Float64Array(M), t2 = new Float64Array(M), tg = new Float64Array(2 * M);
  // R v. The Laplacian is symmetric with this boundary, so R = Op^T Op.
  const reg = o.reg || 'mass';
  const Rv = (v, out) => {
    lap(v, t1);                         // 2 kappa
    if (reg === 'mass') { lap(t1, out); }
    else if (reg === 'grad') { gradN(t1, tg); gradNT(tg, t2); lap(t2, out); }
    else { lap(t1, t2); lap(t2, t1); lap(t1, out); }
    for (let k = 0; k < M; k++) out[k] = out[k] * 0.25 + 1e-6 * v[k];
    return out;
  };
  const psi = new Float64Array(M), gsx = new Float32Array(NN), gsy = new Float32Array(NN);
  const model = new Float32Array(NN), bl = new Float32Array(NN), res = new Float32Array(NN);
  const tmp = new Float32Array(NN), tmp2 = new Float32Array(NN), g = [0, 0], gs = [0, 0];
  const s2 = 1 / (sigma * sigma), lam = o.lam;
  // A x: blur(-gradS . grad psi_x).
  const Ax = (x, out) => {
    for (let p = 0; p < NN; p++) { gradAt(x, p, g); tmp[p] = -(gsx[p] * g[0] + gsy[p] * g[1]); }
    return blur(tmp, n, psf, out);
  };
  const ATy = (y, out) => {
    blur(y, n, psf, tmp2); out.fill(0);
    for (let p = 0; p < NN; p++) { const v = tmp2[p]; if (v) gradT(p, -gsx[p] * v, -gsy[p] * v, out); }
    return out;
  };
  const Hv = (v, out) => {
    Ax(v, tmp); const r = ATy(tmp, new Float64Array(M)); Rv(v, out);
    for (let k = 0; k < M; k++) out[k] = r[k] * s2 + lam * out[k];
    return out;
  };
  const newton = o.newton || 4, cgN = o.cg || 120;
  let chi2 = 0;
  for (let it = 0; it < newton; it++) {
    for (let p = 0; p < NN; p++) {
      gradAt(psi, p, g);
      model[p] = srcGrad(lobes, xs[p] - ax0[p] - g[0], ys[p] - ay0[p] - g[1], gs);
      gsx[p] = gs[0]; gsy[p] = gs[1];
    }
    blur(model, n, psf, bl);
    chi2 = 0;
    for (let p = 0; p < NN; p++) { res[p] = data[p] - bl[p]; chi2 += res[p] * res[p] * s2; }
    // Right-hand side.
    const rhs = ATy(res, new Float64Array(M)), rp = Rv(psi, new Float64Array(M));
    for (let k = 0; k < M; k++) rhs[k] = rhs[k] * s2 - lam * rp[k];
    // CG.
    const d = new Float64Array(M), r = Float64Array.from(rhs), pv = Float64Array.from(rhs), Hp = new Float64Array(M);
    let rr = 0; for (let k = 0; k < M; k++) rr += r[k] * r[k];
    const rr0 = rr;
    for (let c = 0; c < cgN && rr > 1e-14 * rr0; c++) {
      Hv(pv, Hp);
      let pHp = 0; for (let k = 0; k < M; k++) pHp += pv[k] * Hp[k];
      const al = rr / pHp;
      let rn = 0;
      for (let k = 0; k < M; k++) { d[k] += al * pv[k]; r[k] -= al * Hp[k]; rn += r[k] * r[k]; }
      const be = rn / rr; rr = rn;
      for (let k = 0; k < M; k++) pv[k] = r[k] + be * pv[k];
    }
    for (let k = 0; k < M; k++) psi[k] += d[k];
  }
  // kappa = lap(psi) / 2, and mass per node cell.
  const kap = lap(psi, new Float64Array(M));
  for (let k = 0; k < M; k++) kap[k] *= 0.5;
  // The outer ring of nodes has a one-sided Laplacian. Zero it.
  for (let i = 0; i < G; i++) { kap[i] = kap[(G - 1) * G + i] = kap[i * G] = kap[i * G + G - 1] = 0; }
  return { kappa: kap, psi, G, h, chi2: chi2 / NN, cellMass: SIGMA_CR * h * h };
}
