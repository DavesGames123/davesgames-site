// ════════════════════════════════════════════════════════════════════════════
//  STRING LAB · strings.js — stiff damped string, finite differences + modes
// ────────────────────────────────────────────────────────────────────────────
//  The model is the stiff damped wave equation (Bilbao, Numerical Sound
//  Synthesis, 2009, ch. 7):
//
//    u_tt = c^2 u_xx - kappa^2 u_xxxx - 2 sigma0 u_t + 2 sigma1 u_txx + f
//
//  The scheme is explicit and centred. Both ends are simply supported
//  (u = 0, u_xx = 0), so each array has two ghost cells per end with odd
//  symmetry. The grid spacing obeys the stability bound in hMin(). The
//  scheme conserves a discrete energy exactly when sigma0 = sigma1 = 0.
//
//  Three time levels live in the ring (older, mid, newer). The public fields
//  (u, v, a and the force parts) are at the MID level, so v and a are exact
//  centred differences: a = (u^{n+1} - 2 u^n + u^{n-1}) / k^2.
//
//  SECTION MAP   (grep -n "<anchor>" strings.js)
//    stability bound ...... "export function hMin"
//    inharmonicity ........ "export function inharmonicity"
//    damping fit .......... "export function dampingFromT60"
//    simulator class ...... "export class StringSim"
//    time step loop ....... "step(n"
//    bow friction ......... "bowNewton"
//    derived fields ....... "_fields()"
//    energy ............... "energyParts()"
//    excitations .......... "pluck(", "strike(", "bow(", "touch("
//    fretting ............. "setLength("
//    modal solution ....... "export function modalFrequencies"
//    view clock ........... "export function viewStepper"
// ════════════════════════════════════════════════════════════════════════════

const LN1000 = Math.log(1000);
const G = 2; // ghost cells per end

/** Smallest stable grid spacing for the explicit stiff damped scheme. */
export function hMin(c, kappa, sigma1, k) {
  const a = c * c * k * k + 4 * sigma1 * k;
  return Math.sqrt((a + Math.sqrt(a * a + 16 * kappa * kappa * k * k)) / 2);
}

/** B = pi^3 E d^4 / (64 T L^2)  (solid round core of diameter d). */
export function inharmonicity({ E, d, T, L }) {
  return (Math.PI ** 3 * E * d ** 4) / (64 * T * L * L);
}

/** kappa from material: kappa^2 = E I / mu, I = pi d^4 / 64. */
export function kappaOf(E, d, mu) {
  if (!E || !d) return 0;
  return Math.sqrt((E * Math.PI * d ** 4) / 64 / mu);
}

/** Squared wavenumber beta^2 of a mode at frequency f on a stiff string. */
export function waveNumberSq(f, c, kappa) {
  const w = 2 * Math.PI * f;
  if (!kappa) return (w * w) / (c * c);
  return (-c * c + Math.sqrt(c ** 4 + 4 * kappa * kappa * w * w)) / (2 * kappa * kappa);
}

/**
 * Fit sigma0, sigma1 so that the T60 decay time is T1 at f1 and T2 at f2.
 * Mode decay rate is sigma0 + sigma1 beta^2, and T60 = ln(1000) / rate.
 */
export function dampingFromT60({ f1, T1, f2, T2, c, kappa = 0 }) {
  const x1 = waveNumberSq(f1, c, kappa);
  const x2 = waveNumberSq(f2, c, kappa);
  const sigma1 = (LN1000 * (1 / T2 - 1 / T1)) / (x2 - x1);
  const sigma0 = LN1000 / T1 - sigma1 * x1;
  return { sigma0: Math.max(0, sigma0), sigma1: Math.max(0, sigma1) };
}

// soft friction law (Bilbao 2009, eq. 7.42 family): phi(eta)
function phi(eta, a) {
  return Math.sqrt(2 * a) * eta * Math.exp(-a * eta * eta + 0.5);
}
function dphi(eta, a) {
  return Math.sqrt(2 * a) * Math.exp(-a * eta * eta + 0.5) * (1 - 2 * a * eta * eta);
}

export class StringSim {
  /**
   * @param {object} p
   *   L (m), T (N), mu (kg/m), d (m, core), E (Pa) or kappa (m^2/s),
   *   sigma0 (1/s), sigma1 (m^2/s), fs (Hz, default 44100),
   *   N (optional segment count, clamped to the stable maximum),
   *   gridMultiple (optional, default 1: N = floor(L / hMin))
   */
  constructor(p) {
    this.p = { ...p };
    this.T = p.T;
    this.mu = p.mu;
    this.fs = p.fs || 44100;
    this.k = 1 / this.fs;
    this.c = Math.sqrt(p.T / p.mu);
    this.kappa = p.kappa != null ? p.kappa : kappaOf(p.E, p.d, p.mu);
    this.sigma0 = p.sigma0 || 0;
    this.sigma1 = p.sigma1 || 0;
    this.time = 0;
    this._bow = null;
    this._touches = [];
    this._grid(p.L, null);
  }

  /** Physical constants that depend on L. */
  get B() {
    return (this.kappa * this.kappa * Math.PI * Math.PI) / (this.c * this.c * this.L * this.L);
  }
  get f1() {
    return this.c / (2 * this.L);
  }
  /** f_1 with inharmonicity: the fundamental the scheme should ring at. */
  get f1Stiff() {
    return this.f1 * Math.sqrt(1 + this.B);
  }

  _grid(L, keep) {
    const { c, kappa, sigma1, k } = this;
    this.L = L;
    const h0 = hMin(c, kappa, sigma1, k);
    let Nmax = Math.max(4, Math.floor(L / h0));
    let N = Nmax;
    if (this.p.N) N = Math.min(this.p.N, Nmax);
    else {
      // gridMultiple rounds N down (exact node positions at 1/m fractions);
      // it costs accuracy, because the scheme is least dispersive at h = hMin
      const m = this.p.gridMultiple || 1;
      N = Math.max(4, Math.floor(Nmax / m) * m);
    }
    if (this.p.maxN) N = Math.min(N, this.p.maxN);
    this.N = N;
    this.h = L / N;
    const n = N + 1 + 2 * G;
    const old = keep;
    this._r = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
    this._next = new Float64Array(n);
    this.u = new Float64Array(N + 1);
    this.v = new Float64Array(N + 1);
    this.a = new Float64Array(N + 1);
    this.aTension = new Float64Array(N + 1);
    this.aStiff = new Float64Array(N + 1);
    this.aDamp = new Float64Array(N + 1);
    this.aBow = new Float64Array(N + 1);
    this.sig = new Float64Array(N + 1); // per-node extra damping (touch), 1/s
    if (old) {
      // resample the three time levels onto the new grid (fractional x)
      for (let r = 0; r < 3; r++) {
        const src = old[r], dst = this._r[r], No = old.N;
        for (let i = 1; i < N; i++) {
          const x = (i / N) * No, j = Math.floor(x), f = x - j;
          dst[i + G] = src[j + G] * (1 - f) + src[Math.min(No, j + 1) + G] * f;
        }
        this._ghost(dst);
      }
    }
    this._coef();
    this._fields();
  }

  /**
   * Exact frequency of mode n in THIS scheme (lossless dispersion relation):
   * sin^2(w k / 2) = lam^2 s + 4 mu^2 s^2,  s = sin^2(beta h / 2).
   * It differs from the continuous f_n by the numerical dispersion.
   */
  schemeFrequency(n) {
    const b = (n * Math.PI) / this.L;
    const s = Math.sin((b * this.h) / 2) ** 2;
    const v = this.lam2 * s + 4 * this.mu2 * s * s;
    return (2 * Math.asin(Math.min(1, Math.sqrt(v)))) / this.k / (2 * Math.PI);
  }

  _coef() {
    const { c, kappa, k, h } = this;
    this.lam2 = (c * c * k * k) / (h * h);
    this.mu2 = (kappa * kappa * k * k) / (h ** 4);
    this.s1c = (2 * this.sigma1 * k) / (h * h);
  }

  _ghost(w) {
    const N = this.N;
    w[G] = 0;
    w[G + N] = 0;
    w[G - 1] = -w[G + 1];
    w[G - 2] = -w[G + 2];
    w[G + N + 1] = -w[G + N - 1];
    w[G + N + 2] = -w[G + N - 2];
  }

  reset() {
    for (const w of this._r) w.fill(0);
    this._bow = null;
    this._touches = [];
    this.sig.fill(0);
    this.time = 0;
    this._fields();
  }

  /** Advance n time steps of length k = 1 / fs. */
  step(n = 1) {
    const N = this.N, k = this.k, s0 = this.sigma0;
    const lam2 = this.lam2, mu2 = this.mu2, s1c = this.s1c, sig = this.sig;
    for (let s = 0; s < n; s++) {
      this._updateTouches();
      const r = this._r;
      const up = r[1], u = r[2], un = this._next; // older r[0] is dropped
      for (let i = 1; i < N; i++) {
        const j = i + G;
        const d2 = u[j + 1] - 2 * u[j] + u[j - 1];
        const d4 = u[j + 2] - 4 * u[j + 1] + 6 * u[j] - 4 * u[j - 1] + u[j - 2];
        const d2p = up[j + 1] - 2 * up[j] + up[j - 1];
        const sg = (s0 + sig[i]) * k;
        un[j] = (2 * u[j] - (1 - sg) * up[j] + lam2 * d2 - mu2 * d4 + s1c * (d2 - d2p)) / (1 + sg);
      }
      if (this._bow) this._bowNewton(un, u, up);
      this._ghost(un);
      // rotate: older <- older? (drop r[0]); r = [up, u, un]
      const spare = r[0];
      r[0] = up; r[1] = u; r[2] = un;
      this._next = spare;
      this.time += k;
    }
    this._fields();
    return this;
  }

  /** Bow at one node: solve eta + (beta/2k) phi(eta) = b by Newton. */
  _bowNewton(un, u, up) {
    const b0 = this._bow, k = this.k;
    const i = b0.i, j = i + G;
    const sg = (this.sigma0 + this.sig[i]) * k;
    const beta = (k * k * b0.force) / (this.mu * this.h * (1 + sg));
    const q = un[j];
    const b = (q - up[j]) / (2 * k) - b0.vel;
    const g = beta / (2 * k);
    let eta = b0.eta;
    for (let it = 0; it < 30; it++) {
      const F = eta + g * phi(eta, b0.a) - b;
      const dF = 1 + g * dphi(eta, b0.a);
      const dEta = F / (Math.abs(dF) > 1e-9 ? dF : 1e-9);
      eta -= dEta;
      if (Math.abs(dEta) < 1e-12) break;
    }
    if (!Number.isFinite(eta)) eta = 0;
    b0.eta = eta;
    un[j] = q - beta * phi(eta, b0.a);
    b0.lastAccel = -(b0.force / (this.mu * this.h)) * phi(eta, b0.a);
  }

  _updateTouches() {
    if (!this._touches.length) return;
    const t = this.time;
    const keep = [];
    this.sig.fill(0);
    for (const tc of this._touches) {
      if (t < tc.until) {
        keep.push(tc);
        for (const [i, w] of tc.taps) this.sig[i] += tc.strength * w;
      }
    }
    this._touches = keep;
  }

  /** Fill u, v, a and the acceleration parts at the mid time level. */
  _fields() {
    const N = this.N, k = this.k, h = this.h;
    const [um, u, up] = this._r; // um = u^{n-1}, u = u^n, up = u^{n+1}
    const c2 = this.c * this.c, kap2 = this.kappa * this.kappa;
    for (let i = 0; i <= N; i++) {
      const j = i + G;
      this.u[i] = u[j];
      this.v[i] = (up[j] - um[j]) / (2 * k);
      if (i === 0 || i === N) {
        this.a[i] = this.aTension[i] = this.aStiff[i] = this.aDamp[i] = this.aBow[i] = 0;
        continue;
      }
      const d2 = (u[j + 1] - 2 * u[j] + u[j - 1]) / (h * h);
      const d4 = (u[j + 2] - 4 * u[j + 1] + 6 * u[j] - 4 * u[j - 1] + u[j - 2]) / h ** 4;
      const d2m = (um[j + 1] - 2 * um[j] + um[j - 1]) / (h * h);
      this.aTension[i] = c2 * d2;
      this.aStiff[i] = -kap2 * d4;
      this.aDamp[i] = -2 * (this.sigma0 + this.sig[i]) * this.v[i] + (2 * this.sigma1 * (d2 - d2m)) / k;
      this.a[i] = (up[j] - 2 * u[j] + um[j]) / (k * k);
      this.aBow[i] = this.a[i] - this.aTension[i] - this.aStiff[i] - this.aDamp[i];
    }
  }

  /** Energy parts (J) of the scheme at time n - 1/2 (levels n-1 and n). */
  energyParts() {
    const N = this.N, k = this.k, h = this.h;
    const um = this._r[0], u = this._r[1];
    let kin = 0, ten = 0, stf = 0;
    for (let i = 1; i < N; i++) {
      const j = i + G;
      const dt = (u[j] - um[j]) / k;
      kin += dt * dt;
      const a2 = (u[j + 1] - 2 * u[j] + u[j - 1]) / (h * h);
      const b2 = (um[j + 1] - 2 * um[j] + um[j - 1]) / (h * h);
      stf += a2 * b2;
    }
    for (let i = 0; i < N; i++) {
      const j = i + G;
      ten += ((u[j + 1] - u[j]) / h) * ((um[j + 1] - um[j]) / h);
    }
    const EI = this.kappa * this.kappa * this.mu;
    return {
      kinetic: 0.5 * this.mu * h * kin,
      tension: 0.5 * this.T * h * ten,
      stiffness: 0.5 * EI * h * stf,
    };
  }
  energy() {
    const e = this.energyParts();
    return e.kinetic + e.tension + e.stiffness;
  }

  /** Transverse force on the bridge (x = 0), mid level: T u_x - EI u_xxx. */
  bridgeForce() {
    const u = this._r[1], h = this.h;
    const ux = u[G + 1] / h;
    const uxxx = (u[G + 2] - 2 * u[G + 1]) / h ** 3;
    return this.T * ux - this.kappa * this.kappa * this.mu * uxxx;
  }

  /** Displacement at a fraction of the length (linear interpolation). */
  sampleAt(pos) {
    const x = Math.min(1, Math.max(0, pos)) * this.N;
    const i = Math.min(this.N - 1, Math.floor(x)), f = x - i;
    return this.u[i] * (1 - f) + this.u[i + 1] * f;
  }

  _setAll(shape, vel) {
    // u^{n-1} = s - k v, u^n = s, u^{n+1} = s + k v  (consistent centred start)
    const N = this.N, k = this.k;
    const [a, b, c] = this._r;
    for (let i = 0; i <= N; i++) {
      const j = i + G, s = shape[i], v = vel ? vel[i] : 0;
      a[j] = s - k * v;
      b[j] = s;
      c[j] = s + k * v;
    }
    for (const w of this._r) this._ghost(w);
    this._fields();
  }

  _shapeNow() {
    const s = new Float64Array(this.N + 1);
    for (let i = 0; i <= this.N; i++) s[i] = this._r[1][i + G];
    return s;
  }

  /**
   * Pluck: a triangle with its peak at pos, height amp (m). width (fraction)
   * rounds the corner with a raised-cosine kernel on the odd extension of
   * the string, which keeps every sin(n pi pos) zero. Adds to the current
   * shape when add is true.
   */
  pluck({ pos = 0.2, amp = 0.002, width = 0, add = false } = {}) {
    const N = this.N;
    const p = Math.min(0.999, Math.max(0.001, pos));
    const tri = (x) => {
      // odd 2-periodic extension of the triangle
      let y = ((x % 2) + 2) % 2;
      let sgn = 1;
      if (y > 1) { y = 2 - y; sgn = -1; }
      return sgn * (y <= p ? (amp * y) / p : (amp * (1 - y)) / (1 - p));
    };
    const s = add ? this._shapeNow() : new Float64Array(N + 1);
    const M = width > 0 ? 24 : 0;
    for (let i = 1; i < N; i++) {
      const x = i / N;
      let val = 0;
      if (!M) val = tri(x);
      else {
        let wsum = 0;
        for (let m = -M; m <= M; m++) {
          const t = m / M, w = 0.5 + 0.5 * Math.cos(Math.PI * t);
          val += w * tri(x + t * width);
          wsum += w;
        }
        val /= wsum;
      }
      s[i] += val;
    }
    this._setAll(s, null);
    return this;
  }

  /** Strike: raised-cosine velocity bump (m/s) of the given width at pos. */
  strike({ pos = 0.12, vel = 1, width = 0.03 } = {}) {
    const N = this.N;
    const s = this._shapeNow();
    const v = new Float64Array(N + 1);
    for (let i = 0; i <= N; i++) v[i] = this.v[i];
    for (let i = 1; i < N; i++) {
      const dx = Math.abs(i / N - pos);
      if (dx < width) v[i] += vel * (0.5 + 0.5 * Math.cos((Math.PI * dx) / width));
    }
    this._setAll(s, v);
    return this;
  }

  /**
   * Bow: stick-slip friction at pos. vel = bow speed (m/s), force = bow
   * force (N), a = friction law sharpness (s^2/m^2, about 50..200).
   */
  bow({ pos = 0.1, vel = 0.1, force = 0.6, a = 100 } = {}) {
    const i = Math.max(2, Math.min(this.N - 2, Math.round(pos * this.N)));
    this._bow = { i, pos, vel, force, a, eta: -vel, lastAccel: 0 };
    return this;
  }
  stopBow() {
    this._bow = null;
    return this;
  }
  get bowing() {
    return this._bow ? { ...this._bow } : null;
  }

  /**
   * Light touch (natural harmonic): a strong local damper at pos for the
   * given seconds. Modes with a node at pos survive; the rest die.
   */
  touch({ pos = 0.5, strength = 4000, seconds = 0.08 } = {}) {
    const x = pos * this.N, i = Math.floor(x), f = x - i;
    const taps = [];
    if (i >= 1 && i < this.N) taps.push([i, 1 - f]);
    if (i + 1 >= 1 && i + 1 < this.N && f > 0) taps.push([i + 1, f]);
    this._touches.push({ taps, strength, until: this.time + seconds });
    this._updateTouches();
    return this;
  }

  /** Multiply the motion by factor (mute or palm damping). */
  damp(factor = 0) {
    const s = this._shapeNow();
    const v = new Float64Array(this.N + 1);
    for (let i = 0; i <= this.N; i++) { s[i] *= factor; v[i] = this.v[i] * factor; }
    this._setAll(s, v);
    return this;
  }

  /** Stopped (vibrating) length in metres, for fretting. Re-grids. */
  setLength(L) {
    if (Math.abs(L - this.L) < 1e-12) return this;
    const old = this._r.map((w) => w.slice());
    old.N = this.N;
    const bow = this._bow;
    this._grid(L, old);
    if (bow) this.bow(bow);
    this._touches = [];
    return this;
  }

  /** Change tension (tuning) keeping mu; re-grids when needed. */
  setTension(T) {
    this.T = T;
    this.c = Math.sqrt(T / this.mu);
    const old = this._r.map((w) => w.slice());
    old.N = this.N;
    this._grid(this.L, old);
    return this;
  }
}

// ── modal solution ──────────────────────────────────────────────────────────

function cOf(p) { return Math.sqrt(p.T / p.mu); }
function kappaP(p) { return p.kappa != null ? p.kappa : kappaOf(p.E, p.d, p.mu); }

/** Inharmonicity B of a parameter set. */
export function paramsB(p) {
  const c = cOf(p), kap = kappaP(p);
  return (kap * kap * Math.PI * Math.PI) / (c * c * p.L * p.L);
}

/** f_n = n f_1 sqrt(1 + B n^2), n = 1..nMax. */
export function modalFrequencies(p, nMax) {
  const f1 = cOf(p) / (2 * p.L), B = paramsB(p);
  const out = new Float64Array(nMax);
  for (let n = 1; n <= nMax; n++) out[n - 1] = n * f1 * Math.sqrt(1 + B * n * n);
  return out;
}

/** sigma_n = sigma0 + sigma1 (n pi / L)^2. */
export function modalDecay(p, nMax) {
  const out = new Float64Array(nMax);
  for (let n = 1; n <= nMax; n++) {
    const b = (n * Math.PI) / p.L;
    out[n - 1] = (p.sigma0 || 0) + (p.sigma1 || 0) * b * b;
  }
  return out;
}

/** Triangle pluck at pos with height amp: b_n = 2 A sin(n pi p) / (n^2 pi^2 p (1 - p)). */
export function pluckCoefficients(pos, amp, nMax) {
  const out = new Float64Array(nMax);
  for (let n = 1; n <= nMax; n++) {
    out[n - 1] = (2 * amp * Math.sin(n * Math.PI * pos)) / (n * n * Math.PI * Math.PI * pos * (1 - pos));
  }
  return out;
}

/** Exact modal displacement at x (fraction) and t (s) for coefficients b. */
export function modalDisplacement(p, coefs, x, t, freqs, decay) {
  const n = coefs.length;
  const f = freqs || modalFrequencies(p, n);
  const s = decay || modalDecay(p, n);
  let u = 0;
  for (let i = 0; i < n; i++) {
    u += coefs[i] * Math.exp(-s[i] * t) * Math.cos(2 * Math.PI * f[i] * t) * Math.sin((i + 1) * Math.PI * x);
  }
  return u;
}

/** Project a sampled shape (N+1 points, ends 0) onto sin(n pi x). */
export function modalProject(shape, nMax) {
  const N = shape.length - 1;
  const out = new Float64Array(nMax);
  for (let n = 1; n <= nMax; n++) {
    let s = 0;
    for (let i = 1; i < N; i++) s += shape[i] * Math.sin((n * Math.PI * i) / N);
    out[n - 1] = (2 / N) * s;
  }
  return out;
}

// ── view clock ──────────────────────────────────────────────────────────────

/**
 * Slow motion: timeScale simulated seconds per wall second. advance(dt)
 * returns how many steps of k to run this frame and keeps the remainder.
 * maxSteps caps one frame (the view drops time, not accuracy).
 */
export function viewStepper({ timeScale = 1, k = 1 / 44100, maxSteps = 4000 } = {}) {
  let carry = 0;
  const st = {
    timeScale,
    advance(dtWall) {
      carry += Math.max(0, Math.min(dtWall, 0.1)) * st.timeScale;
      let n = Math.floor(carry / k);
      carry -= n * k;
      if (n > maxSteps) { n = maxSteps; carry = 0; }
      return n;
    },
    reset() { carry = 0; },
  };
  return st;
}
