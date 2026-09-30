/* ============================================================================
   WAVE MEMBRANE  ·  solver  (no DOM, no THREE)
   ----------------------------------------------------------------------------
   This file solves the 2D wave equation on a clamped membrane:
       laplacian(u) = (1/c^2) * d2u/dt2
   The grid holds N x N nodes over the unit square [0,1]^2. The index of node
   (i, j) is j*N + i, with i along x and j along y. Edge nodes are fixed at
   u = 0. The circle shape also fixes every node outside the disk of radius 0.5
   at the center (0.5, 0.5).

   SCHEME. Explicit leapfrog in time, 5-point Laplacian in space:
       uNext = 2u - uPrev + dt^2 * acc,     acc = c^2 * lap(u)
   The step dt = cfl * h / c. The 2D stability limit is cfl <= 1/sqrt(2), so
   the constructor clamps cfl to 0.5 or less.

   The file runs in two places. A browser loads it as a classic script, and it
   defines the global MembraneSolver. Node loads it with require(), and it
   exports { MembraneSolver }.

   GREP MAP
     grep -n 'constructor'       grid, mask, and buffers
     grep -n 'setMode('          the standing-wave start from mode shapes
     grep -n '_refineShape'      the grid eigenmode of a drum mode (opt-in)
     grep -n 'omega('            the analytic angular frequency
     grep -n 'step('             the leapfrog update
     grep -n '_computeAcc'       the 5-point Laplacian times c^2
     grep -n 'energy('           the discrete total energy
     grep -n 'static besselJ'    Bessel function J_m by periodic quadrature
     grep -n 'static besselZero' n-th positive zero of J_m
   ========================================================================== */
class MembraneSolver {
  constructor(opts) {
    const o = opts || {};
    const N = Math.max(8, Math.floor(o.N || 96));
    this.N = N;
    this.c = o.c > 0 ? o.c : 1.0;
    this.shape = o.shape === 'circle' ? 'circle' : 'square';
    // Clamp the Courant number. Above 1/sqrt(2) the 2D scheme diverges.
    this.cfl = Math.min(0.5, o.cfl > 0 ? o.cfl : 0.5);
    this.h = 1 / (N - 1);
    this.dt = this.cfl * this.h / this.c;
    this.t = 0;
    this.u = new Float32Array(N * N);
    this.uPrev = new Float32Array(N * N);
    this.acc = new Float32Array(N * N);
    this.mask = new Uint8Array(N * N);
    // A node is free when it is off the square edge, and, for the circle,
    // strictly inside the disk. All other nodes stay at u = 0.
    for (let j = 1; j < N - 1; j++) {
      for (let i = 1; i < N - 1; i++) {
        let free = 1;
        if (this.shape === 'circle') {
          const x = i * this.h - 0.5, y = j * this.h - 0.5;
          free = Math.hypot(x, y) < 0.5 ? 1 : 0;
        }
        this.mask[j * N + i] = free;
      }
    }
  }

  // The analytic angular frequency of mode (m, n).
  // Square: c*pi*sqrt(m^2 + n^2). Circle: c * k_mn, k_mn = j_{m,n} / 0.5.
  omega(m, n) {
    if (this.shape === 'circle') return this.c * MembraneSolver.besselZero(m, n) / 0.5;
    return this.c * Math.PI * Math.sqrt(m * m + n * n);
  }

  // Set a standing-wave start from a list of modes {m, n, amp}. The initial
  // velocity is zero, so uPrev = u + 0.5*dt^2*acc (a Taylor step back in time).
  //
  // The optional second argument {refine: true} is an extension for the page.
  // It changes only the circle shape. The staircase edge of the disk makes the
  // analytic Bessel shape a near eigenmode of the grid, not an exact one. The
  // small error sits at grid scale, where the Laplacian is about (2/h)^2, so
  // it fills the acceleration map with noise. With refine, each drum mode goes
  // through _refineShape first. Without the argument, u0 is the plain formula.
  setMode(modes, opts) {
    const N = this.N, h = this.h, list = modes || [];
    const u = this.u, mask = this.mask;
    const refine = !!(opts && opts.refine) && this.shape === 'circle';
    // _refineShape runs the solver, so get every shape before u is set.
    const shapes = refine ? list.map(md => this._refineShape(md.m | 0, md.n | 0)) : null;
    u.fill(0);
    if (refine) {
      list.forEach((md, q) => {
        const amp = md.amp == null ? 1 : +md.amp, shape = shapes[q];
        for (let id = 0; id < N * N; id++) u[id] += amp * shape[id];
      });
    }
    for (const md of (refine ? [] : list)) {
      const m = md.m | 0, n = md.n | 0, amp = md.amp == null ? 1 : +md.amp;
      if (this.shape === 'circle') {
        const k = MembraneSolver.besselZero(m, n) / 0.5;
        for (let j = 0; j < N; j++) {
          for (let i = 0; i < N; i++) {
            const id = j * N + i;
            if (!mask[id]) continue;
            const x = i * h - 0.5, y = j * h - 0.5;
            const r = Math.hypot(x, y), th = Math.atan2(y, x);
            u[id] += amp * MembraneSolver.besselJ(m, k * r) * Math.cos(m * th);
          }
        }
      } else {
        for (let j = 0; j < N; j++) {
          const sy = Math.sin(n * Math.PI * j * h);
          for (let i = 0; i < N; i++) {
            const id = j * N + i;
            if (!mask[id]) continue;
            u[id] += amp * Math.sin(m * Math.PI * i * h) * sy;
          }
        }
      }
    }
    this._computeAcc();
    const k2 = 0.5 * this.dt * this.dt, up = this.uPrev, acc = this.acc;
    for (let id = 0; id < N * N; id++) up[id] = mask[id] ? u[id] + k2 * acc[id] : 0;
    this.t = 0;
  }

  // The grid eigenmode nearest to drum mode (m, n), at unit amplitude.
  // The method is a time-domain projection. It starts from the analytic
  // Bessel shape, runs the solver for 6 periods of the analytic omega, and
  // sums u(t) * cos(omega t) under a Hann window. Parts of u at other
  // frequencies cancel in the sum. The grid-scale error has a much higher
  // frequency, so it drops out. The result goes into a cache per solver.
  _refineShape(m, n) {
    const key = m + ',' + n;
    this._shapeCache = this._shapeCache || {};
    if (this._shapeCache[key]) return this._shapeCache[key];
    const NN = this.N * this.N, w = this.omega(m, n);
    this.setMode([{ m: m, n: n, amp: 1 }]);
    const steps = Math.max(8, Math.round(6 * (2 * Math.PI / w) / this.dt));
    const sum = new Float64Array(NN);
    let norm = 0;
    for (let q = 0; q <= steps; q++) {
      const cw = Math.cos(w * q * this.dt);
      const wt = (0.5 - 0.5 * Math.cos(2 * Math.PI * q / steps)) * cw;
      norm += wt * cw;
      const u = this.u;
      for (let id = 0; id < NN; id++) sum[id] += wt * u[id];
      this.step(1);
    }
    const out = new Float32Array(NN);
    for (let id = 0; id < NN; id++) out[id] = this.mask[id] ? sum[id] / norm : 0;
    this._shapeCache[key] = out;
    return out;
  }

  // acc = c^2 * 5-point Laplacian of u on free nodes, 0 on fixed nodes.
  _computeAcc() {
    const N = this.N, u = this.u, acc = this.acc, mask = this.mask;
    const s = this.c * this.c / (this.h * this.h);
    for (let j = 1; j < N - 1; j++) {
      const row = j * N;
      for (let i = 1; i < N - 1; i++) {
        const id = row + i;
        acc[id] = mask[id]
          ? s * (u[id - 1] + u[id + 1] + u[id - N] + u[id + N] - 4 * u[id])
          : 0;
      }
    }
    // The outer ring is always fixed. Keep its acceleration at zero.
    for (let i = 0; i < N; i++) {
      acc[i] = 0; acc[(N - 1) * N + i] = 0; acc[i * N] = 0; acc[i * N + N - 1] = 0;
    }
  }

  // Do k leapfrog steps. The update is in place, so the u, uPrev, and acc
  // arrays keep their identity. A caller can hold a reference to them.
  step(k) {
    const count = k == null ? 1 : Math.max(0, k | 0);
    const N = this.N, u = this.u, up = this.uPrev, acc = this.acc, mask = this.mask;
    const d2 = this.dt * this.dt;
    for (let s = 0; s < count; s++) {
      for (let id = 0; id < N * N; id++) {
        if (!mask[id]) { u[id] = 0; up[id] = 0; continue; }
        const cur = u[id];
        u[id] = 2 * cur - up[id] + d2 * acc[id];
        up[id] = cur;
      }
      this._computeAcc();
      this.t += this.dt;
    }
  }

  // Discrete total energy, times h^2:
  //   kinetic   0.5 * ((u - uPrev)/dt)^2                 over free nodes
  //   potential 0.5 * c^2 * (grad u . grad uPrev)        forward differences
  // The kinetic term measures velocity at the half step t - dt/2. The
  // potential term uses the product of the two time levels, so it also sits at
  // t - dt/2. With this pairing the leapfrog scheme conserves the sum exactly,
  // apart from round-off. The plain |grad u|^2 form sits at t, a half step off,
  // and it swings by about omega*dt/2 of the total each period.
  // It differs from 0.5*c^2*|grad u|^2 only by terms of order dt^2.
  // The potential sum runs over every node that has a forward neighbor. Fixed
  // nodes hold u = 0, so this equals the sum over every grid link that touches
  // a free node. The link from an edge node to its free neighbor stays in.
  energy() {
    const N = this.N, u = this.u, up = this.uPrev, mask = this.mask;
    const idt = 1 / this.dt, ih = 1 / this.h, c2 = this.c * this.c;
    let ke = 0, pe = 0;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const id = j * N + i;
        if (mask[id]) { const v = (u[id] - up[id]) * idt; ke += v * v; }
        if (i < N - 1) pe += (u[id + 1] - u[id]) * (up[id + 1] - up[id]) * ih * ih;
        if (j < N - 1) pe += (u[id + N] - u[id]) * (up[id + N] - up[id]) * ih * ih;
      }
    }
    return (0.5 * ke + 0.5 * c2 * pe) * this.h * this.h;
  }

  // Bessel function of the first kind, integer order m.
  //   J_m(x) = (1/2pi) * integral over [0, 2pi) of cos(m*tau - x*sin(tau))
  // The integrand is periodic, so the trapezoid rule converges exponentially.
  // With 128 samples the error is near machine precision for m <= 6, x <= 25.
  static besselJ(m, x) {
    const M = 128;
    let s = 0;
    for (let k = 0; k < M; k++) {
      const tau = (2 * Math.PI * k) / M;
      s += Math.cos(m * tau - x * Math.sin(tau));
    }
    return s / M;
  }

  // The n-th positive zero of J_m (n >= 1). A scan in steps of 0.05 finds a
  // sign change, then bisection refines the bracket to 1e-13. Results go into
  // a cache, because the page asks for the same zeros many times.
  static besselZero(m, n) {
    const key = m + ',' + n;
    const cache = MembraneSolver._zeroCache;
    if (cache[key] !== undefined) return cache[key];
    const J = MembraneSolver.besselJ;
    let a = 0.05, fa = J(m, a), found = 0, root = NaN;
    while (a < 200) {
      const b = a + 0.05, fb = J(m, b);
      if (fa === 0 && a > 0.05) { found++; if (found === n) { root = a; break; } }
      else if (fa * fb < 0) {
        found++;
        if (found === n) {
          let lo = a, hi = b, flo = fa;
          for (let it = 0; it < 80 && hi - lo > 1e-13; it++) {
            const mid = 0.5 * (lo + hi), fm = J(m, mid);
            if (flo * fm <= 0) hi = mid; else { lo = mid; flo = fm; }
          }
          root = 0.5 * (lo + hi);
          break;
        }
      }
      a = b; fa = fb;
    }
    cache[key] = root;
    return root;
  }
}
MembraneSolver._zeroCache = {};

// A top-level class makes a global binding, but not a property of window.
// Set the property too, so window.MembraneSolver also works in a browser.
if (typeof globalThis !== 'undefined') globalThis.MembraneSolver = MembraneSolver;
if (typeof module !== 'undefined' && module.exports) module.exports = { MembraneSolver };
