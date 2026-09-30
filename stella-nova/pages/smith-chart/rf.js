/* ============================================================================
   SMITH CHART  ·  rf.js  (RF math, no DOM)
   ----------------------------------------------------------------------------
   This file defines the global RF. main.js reads it for all the math. A Node
   script can require it too, because it has no DOM and no canvas.

   CONVENTIONS
     A complex number is { re, im }.
     z is the impedance normalized to Z0. y = 1 / z.
     gamma is the reflection coefficient: gamma = (z - 1) / (z + 1).
     A length l is in wavelengths. A move of l toward the generator turns
     gamma clockwise by 4*pi*l: gamma(l) = gamma_L * exp(-j * 4*pi*l).

   GREP MAP
     grep -n 'function zToGamma'     z to gamma, and back
     grep -n 'function towardGen'    move along a lossless line
     grep -n 'function wtg'          the "wavelengths toward generator" scale
     grep -n 'function seriesRLC'    the impedance of a series RLC load
     grep -n 'function shuntStub'    single shunt-stub match, two solutions
   ========================================================================== */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;

  const cx = (re, im) => ({ re, im: im || 0 });
  const add = (a, b) => cx(a.re + b.re, a.im + b.im);
  const sub = (a, b) => cx(a.re - b.re, a.im - b.im);
  const mul = (a, b) => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
  function div(a, b) {
    const d = b.re * b.re + b.im * b.im;
    if (d === 0) return cx(Infinity, 0);
    return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
  }
  const abs = a => Math.hypot(a.re, a.im);
  const arg = a => Math.atan2(a.im, a.re);
  const polar = (m, t) => cx(m * Math.cos(t), m * Math.sin(t));
  const scale = (a, k) => cx(a.re * k, a.im * k);
  const ONE = cx(1, 0);

  function zToGamma(z) {
    if (!isFinite(z.re) || !isFinite(z.im)) return cx(1, 0);
    return div(sub(z, ONE), add(z, ONE));
  }
  // gamma = 1 is the open circuit. The caller keeps |gamma| below 1 where a
  // finite z is necessary.
  function gammaToZ(g) { return div(add(ONE, g), sub(ONE, g)); }
  function inv(z) { return div(ONE, z); }

  function towardGen(g, l) { return mul(g, polar(1, -2 * TAU * l)); }
  function zIn(z, l) { return gammaToZ(towardGen(zToGamma(z), l)); }

  // Position on the outer scale. The short circuit (angle pi) is 0. The value
  // increases clockwise and wraps at 0.5.
  function wtg(g) {
    let w = (Math.PI - arg(g)) / (2 * TAU);
    w %= 0.5; if (w < 0) w += 0.5;
    return w;
  }

  function vswr(m) { return m >= 1 ? Infinity : (1 + m) / (1 - m); }
  function returnLossDb(m) { return m <= 0 ? Infinity : -20 * Math.log10(m); }
  function mismatchLossDb(m) { return m >= 1 ? Infinity : -10 * Math.log10(1 - m * m); }

  // Z in ohms of R + jwL + 1/(jwC). L in henry, C in farad, f in hertz.
  // C = Infinity removes the capacitor.
  function seriesRLC(R, L, C, f) {
    const w = TAU * f;
    const xc = isFinite(C) && C > 0 ? 1 / (w * C) : 0;
    return cx(R, w * L - xc);
  }

  // Single shunt-stub match on a lossless line. The load is z (normalized).
  // The stub sits a distance d from the load. At d, y = 1 + jb. The stub
  // supplies -jb, so the sum is 1. kind is 'open' or 'short'.
  // Each solution: { d, l, b, gammaD } with d and l in wavelengths.
  function shuntStub(z, kind) {
    const r = z.re, x = z.im;
    if (!(r > 0) || !isFinite(r) || !isFinite(x)) return [];
    if (Math.abs(r - 1) < 1e-9 && Math.abs(x) < 1e-9) return [];
    // t = tan(beta * d). The roots come from Re(y(d)) = 1 (Pozar, section 5.2).
    const ts = [];
    if (Math.abs(r - 1) > 1e-9) {
      const s = Math.sqrt(r * ((1 - r) * (1 - r) + x * x));
      ts.push((x + s) / (r - 1), (x - s) / (r - 1));
    } else {
      ts.push(-x / 2, Infinity);            // r = 1: the second root is d = 0.25
    }
    const out = [];
    for (const t of ts) {
      let d = isFinite(t) ? Math.atan(t) / TAU : 0.25;
      if (d < 0) d += 0.5;
      const gD = towardGen(zToGamma(z), d);
      const yD = inv(gammaToZ(gD));
      if (Math.abs(yD.re - 1) > 1e-6) continue;
      const b = yD.im;
      // Open stub: y = j tan(beta l). Short stub: y = -j cot(beta l).
      let bl = kind === 'short' ? Math.atan2(1, b) : Math.atan(-b);
      if (bl < 0) bl += Math.PI;
      out.push({ d, l: bl / TAU, b, gammaD: gD });
    }
    out.sort((a, b) => a.d - b.d);
    return out;
  }

  const RF = {
    TAU, cx, add, sub, mul, div, abs, arg, polar, scale, inv,
    zToGamma, gammaToZ, towardGen, zIn, wtg,
    vswr, returnLossDb, mismatchLossDb, seriesRLC, shuntStub,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = RF;
  else root.RF = RF;
})(this);
