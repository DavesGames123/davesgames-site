// ============================================================================
//  CHLADNI PLATE  ·  sim.js — driven response and the sand (no DOM, no GL)
// ----------------------------------------------------------------------------
//  The plate is driven by a force at one point x_d at angular frequency w.
//  With the modes phi_n (max |phi_n| = 1) and the mode frequencies w_n:
//      c_n(w) = phi_n(x_d) w^2 / (w_n^2 - w^2 + 2 i zeta w_n w)
//      a(x)   = G0 |sum_n c_n phi_n(x)|          (acceleration, in g)
//  The w^2 makes a(x) an acceleration. At a resonance the term of mode n
//  is G0 phi_n(x_d) / (2 zeta), so the pattern of that mode wins.
//
//  Sand: a grain lifts off only where a(x) > 1 g. It then takes a random
//  hop that grows with a - 1, and it drifts down the slope of a. A grain
//  where a < 1 g stays. So the grains leave the moving parts and stop in
//  the band along each nodal line where a < 1 g. A stronger drive makes
//  that band thinner.
//
//  grep -n targets
//    modal weights ....... "coeffs("
//    field on the grid ... "field("
//    response curve ...... "curve("
//    grain step .......... "step("
// ============================================================================

export function makeSim(res, maskBits, maskW, maskH) {
  const { nx, ny, n, k, modes, fill, idx } = res;
  const N = nx * ny;
  const S = {
    res, nx, ny, n, k,
    omega: new Float64Array(k), freq: new Float64Array(k),
    dIdx: 0, dPhi: new Float64Array(k),
    cr: new Float64Array(k), ci: new Float64Array(k),
    amp: new Float32Array(N),      // a(x) on every grid point, in g
    wr: new Float32Array(N), wi: new Float32Array(N),   // complex a(x), in g
    ampMax: 0,
    count: 0, cap: 0,
    pu: null, pv: null, act: null, buf: null,
  };

  // Mode frequencies for the material and thickness (see solver.js).
  S.setScale = (Dref, rho, t, hM) => {
    const sc = Dref / (rho * t * Math.pow(hM, 4));
    for (let m = 0; m < k; m++) { S.omega[m] = Math.sqrt(Math.max(0, res.lambda[m]) * sc); S.freq[m] = S.omega[m] / (2 * Math.PI); }
  };
  // The drive point in grid cells (bilinear phi_n at that point).
  S.setDrive = (u, v) => {
    for (let m = 0; m < k; m++) S.dPhi[m] = sampleMode(m, u, v);
  };
  function sampleMode(m, u, v) {
    const i = Math.max(0, Math.min(nx - 2, Math.floor(u))), j = Math.max(0, Math.min(ny - 2, Math.floor(v)));
    const a = u - i, b = v - j, o = m * n;
    const f00 = modes[o + fill[j * nx + i]], f10 = modes[o + fill[j * nx + i + 1]];
    const f01 = modes[o + fill[(j + 1) * nx + i]], f11 = modes[o + fill[(j + 1) * nx + i + 1]];
    return (f00 * (1 - a) + f10 * a) * (1 - b) + (f01 * (1 - a) + f11 * a) * b;
  }
  S.sampleMode = sampleMode;

  S.coeffs = (w, zeta, out_r, out_i) => {
    const cr = out_r || S.cr, ci = out_i || S.ci, w2 = w * w;
    for (let m = 0; m < k; m++) {
      const wn = S.omega[m], re = wn * wn - w2, im = 2 * zeta * wn * w, d = re * re + im * im;
      const g = S.dPhi[m] * w2 / d;
      cr[m] = g * re; ci[m] = -g * im;
    }
  };

  // a(x) on the plate nodes, then copied out to every grid point through
  // the fill map, so a grain near the edge reads no false zero.
  const nodeA = new Float32Array(n);
  S.field = (w, zeta, G0) => {
    S.coeffs(w, zeta);
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let m = 0; m < k; m++) {
      const a = S.cr[m], b = S.ci[m]; if (!a && !b) continue;
      const o = m * n;
      for (let i = 0; i < n; i++) { const p = modes[o + i]; re[i] += a * p; im[i] += b * p; }
    }
    let mx = 0;
    for (let i = 0; i < n; i++) { const v = G0 * Math.hypot(re[i], im[i]); nodeA[i] = v; if (v > mx) mx = v; }
    for (let g = 0; g < N; g++) { const q = fill[g]; S.amp[g] = nodeA[q]; S.wr[g] = G0 * re[q]; S.wi[g] = G0 * im[q]; }
    S.ampMax = mx;
    return mx;
  };
  S.ampBytes = (u8) => {
    const inv = S.ampMax > 0 ? 255 / S.ampMax : 0;
    for (let g = 0; g < N; g++) u8[g] = idx[g] >= 0 ? Math.min(255, S.amp[g] * inv) : 0;
  };

  // Peak acceleration over the plate against frequency (a node subset).
  S.curve = (f0, f1, count, zeta, G0) => {
    const step = Math.max(1, Math.floor(n / 700)), sub = [];
    for (let i = 0; i < n; i += step) sub.push(i);
    const F = new Float64Array(count), A = new Float64Array(count), cr = new Float64Array(k), ci = new Float64Array(k);
    const sr = new Float64Array(sub.length), si = new Float64Array(sub.length);
    for (let q = 0; q < count; q++) {
      const f = f0 * Math.pow(f1 / f0, q / (count - 1)); F[q] = f;
      S.coeffs(2 * Math.PI * f, zeta, cr, ci);
      sr.fill(0); si.fill(0);
      for (let m = 0; m < k; m++) {
        const a = cr[m], b = ci[m], o = m * n;
        for (let s = 0; s < sub.length; s++) { const p = modes[o + sub[s]]; sr[s] += a * p; si[s] += b * p; }
      }
      let mx = 0;
      for (let s = 0; s < sub.length; s++) mx = Math.max(mx, sr[s] * sr[s] + si[s] * si[s]);
      A[q] = G0 * Math.sqrt(mx);
    }
    return { F, A };
  };

  // ---------------------------------------------------------------- sand
  let seed = 0x9e3779b9;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const sx = maskW / (nx - 1), sy = maskH / (ny - 1);
  const onPlate = (u, v) => {
    const X = (u * sx) | 0, Y = (v * sy) | 0;
    return X >= 0 && Y >= 0 && X < maskW && Y < maskH && maskBits[Y * maskW + X] === 1;
  };
  S.onPlate = onPlate;
  S.resize = (count) => {
    if (count > S.cap) {
      const pu = new Float32Array(count), pv = new Float32Array(count), act = new Float32Array(count);
      if (S.pu) { pu.set(S.pu.subarray(0, S.count)); pv.set(S.pv.subarray(0, S.count)); act.set(S.act.subarray(0, S.count)); }
      S.pu = pu; S.pv = pv; S.act = act; S.buf = new Float32Array(count * 3); S.cap = count;
    }
    for (let p = S.count; p < count; p++) scatter(p);
    S.count = count;
  };
  function scatter(p) {
    for (let t = 0; t < 400; t++) {
      const u = rnd() * (nx - 1), v = rnd() * (ny - 1);
      if (onPlate(u, v)) { S.pu[p] = u; S.pv[p] = v; S.act[p] = 0; return; }
    }
    S.pu[p] = (nx - 1) / 2; S.pv[p] = (ny - 1) / 2;
  }
  S.scatter = () => { for (let p = 0; p < S.count; p++) scatter(p); };

  // One time step of dt s. hopK sets the hop length in grid cells.
  S.step = (dt, hopK, creep) => {
    creep = creep == null ? 1.2 : creep;
    const wr = S.wr, wi = S.wi, pu = S.pu, pv = S.pv, act = S.act, buf = S.buf;
    const st = Math.sqrt(Math.min(dt, 1 / 20) * 60), kk = hopK * st, decay = Math.pow(0.04, dt);
    for (let p = 0; p < S.count; p++) {
      let u = pu[p], v = pv[p];
      const i = Math.min(nx - 2, Math.max(0, u | 0)), j = Math.min(ny - 2, Math.max(0, v | 0));
      const a = u - i, b = v - j, g = j * nx + i;
      // Interpolate the complex field, then take |.|: the magnitude of a
      // line through a cell is then zero on the whole line, not only at
      // the grid nodes.
      const r00 = wr[g], r10 = wr[g + 1], r01 = wr[g + nx], r11 = wr[g + nx + 1];
      const i00 = wi[g], i10 = wi[g + 1], i01 = wi[g + nx], i11 = wi[g + nx + 1];
      const re = (r00 * (1 - a) + r10 * a) * (1 - b) + (r01 * (1 - a) + r11 * a) * b;
      const im = (i00 * (1 - a) + i10 * a) * (1 - b) + (i01 * (1 - a) + i11 * a) * b;
      const A = Math.hypot(re, im) + 1e-9;
      const rdu = (r10 - r00) * (1 - b) + (r11 - r01) * b, rdv = (r01 - r00) * (1 - a) + (r11 - r10) * a;
      const idu = (i10 - i00) * (1 - b) + (i11 - i01) * b, idv = (i01 - i00) * (1 - a) + (i11 - i10) * a;
      const gu = (re * rdu + im * idu) / A, gv = (re * rdv + im * idv) / A;
      if (A > 1) {
        const e = Math.min(A - 1, 30), s = kk * Math.sqrt(e) * 0.42;
        const gl = Math.hypot(gu, gv) + 1e-6, dr = kk * Math.min(e, 6) * 0.05 / gl;
        const nu = u + s * (rnd() + rnd() + rnd() - 1.5) - gu * dr;
        const nv = v + s * (rnd() + rnd() + rnd() - 1.5) - gv * dr;
        if (onPlate(nu, nv)) { u = nu; v = nv; }
        else { const hu = u + (nu - u) * 0.3, hv = v + (nv - v) * 0.3; if (onPlate(hu, hv)) { u = hu; v = hv; } }
        pu[p] = u; pv[p] = v;
        act[p] = Math.min(1, act[p] + Math.min(1, e / 5) * 0.5);
      } else {
        // below 1 g a grain does not jump, but the shaking still walks it
        // slowly down the slope of a, so a band of sand narrows to the line
        act[p] *= decay;
        if (A > 0.04) {
          const gl = Math.hypot(gu, gv);
          if (gl > 1e-4) {
            const d = Math.min(0.4, creep * A * dt, 0.5 * A / gl), j = 0.1 * st;
            // a small jitter keeps a pile of some width (a few mm)
            const nu = u - gu / gl * d + j * (rnd() - 0.5), nv = v - gv / gl * d + j * (rnd() - 0.5);
            if (onPlate(nu, nv)) { pu[p] = u = nu; pv[p] = v = nv; }
          }
        }
      }
      const o = p * 3; buf[o] = u; buf[o + 1] = v; buf[o + 2] = act[p];
    }
  };
  // The share of grains that are moving (for the labels and the saver).
  S.moving = () => { let c = 0; for (let p = 0; p < S.count; p += 7) if (S.act[p] > 0.2) c++; return c / Math.max(1, Math.ceil(S.count / 7)); };
  return S;
}
