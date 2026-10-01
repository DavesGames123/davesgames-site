/* ============================================================================
   SMITH CHART  ·  rf.js  (RF math, no DOM)
   ----------------------------------------------------------------------------
   This file defines the global RF. main.js reads it for all the math. Node
   can require it too (rf.test.mjs), because it has no DOM and no canvas.

   CONVENTIONS
     A complex number is { re, im }.
     Z is an impedance in ohms. z = Z / Z0 is the normalized impedance.
     gamma is the reflection coefficient: gamma = (z - 1) / (z + 1).
     A length l is in wavelengths. A move of l toward the generator turns
     gamma clockwise by 4*pi*l: gamma(l) = gamma_L * exp(-j * 4*pi*l).
     A negative l moves toward the load.
     f is in hertz, L in henry, C in farad, B in siemens.

   GREP MAP
     grep -n 'function parseEng'      read "2.2n", "1.5GHz", "50 ohm"
     grep -n 'function fmtEng'        write 2.2e-9 as "2.20 n"
     grep -n 'function zToGamma'      z to gamma, and back
     grep -n 'function towardGen'     move along a lossless line
     grep -n 'function wtg'           the "wavelengths toward generator" scale
     grep -n 'function gammaFrom'     |gamma|, VSWR or S11 dB, with a phase
     grep -n 'function qOf'           the Q of a point, |x| / r
     grep -n 'function equivalent'    series and parallel R with L or C
     grep -n 'function seriesRLC'     series RLC load
     grep -n 'function parallelRLC'   parallel RLC load
     grep -n 'function lMatch'        L-network match, both topologies
     grep -n 'function shuntStub'     single shunt-stub match, normalized
     grep -n 'function stubMatch'     shunt-stub match in real units
     grep -n 'function quarterWave'   line + quarter-wave transformer match
     grep -n 'function parseTouchstone'  read a .s1p / .s2p file
     grep -n 'function gammaAtFreq'   interpolate a sweep at one frequency
   ========================================================================== */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const C0 = 299792458;                     // speed of light, m/s

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
  const finite = a => isFinite(a.re) && isFinite(a.im);

  // ------------------------------------------------------------------ units
  // Engineering prefixes. 'm' is milli and 'M' is mega. "meg" is also mega,
  // as in SPICE. A unit after the prefix (Hz, H, F, ohm, Ω, m, s) is allowed
  // and has no effect on the value.
  const PREFIX = { f: 1e-15, p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, meg: 1e6, G: 1e9, T: 1e12 };
  function parseEng(s) {
    if (typeof s === 'number') return s;
    const t = String(s == null ? '' : s).trim();
    if (!t) return NaN;
    if (/^[-+]?(inf|∞)/i.test(t)) return t[0] === '-' ? -Infinity : Infinity;
    // The case of the prefix matters (m and M), so match it case-sensitive.
    const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*(meg|[fpnuµμmkKMGT])?\s*([a-zA-ZΩ]{0,4})\s*$/.exec(t);
    if (!m) return NaN;
    let v = parseFloat(m[1]);
    let pre = m[2] || '', unit = m[3] || '';
    // "5m" alone is milli. "5 mm" is milli + metre. "5 MHz" is mega + hertz.
    // A lone unit letter that is also a prefix ("5 m") stays a prefix.
    if (pre && !PREFIX[pre]) return NaN;
    if (pre) v *= PREFIX[pre];
    if (unit && !/^(hz|ohms?|Ω|h|f|m|s|v|a|w|db|deg)$/i.test(unit)) return NaN;
    return v;
  }
  const ENG_P = { '-15': 'f', '-12': 'p', '-9': 'n', '-6': 'µ', '-3': 'm', '0': '', '3': 'k', '6': 'M', '9': 'G', '12': 'T' };
  // 2.2e-9, 'H' -> "2.20 nH". sig is the count of significant digits.
  // compact drops the space (for the URL): "2.2n".
  function fmtEng(v, unit, sig, compact) {
    unit = unit || ''; sig = sig || 3;
    if (v === 0) return compact ? '0' : `0 ${unit}`.trim();
    if (!isFinite(v)) return isNaN(v) ? '—' : (v < 0 ? '−∞' : '∞');
    let e = Math.floor(Math.log10(Math.abs(v)) / 3) * 3;
    e = Math.max(-15, Math.min(12, e));
    let m = v / Math.pow(10, e);
    let s = (+m.toPrecision(sig)).toString();
    if (Math.abs(+s) >= 1000 && e < 12) { e += 3; m = v / Math.pow(10, e); s = (+m.toPrecision(sig)).toString(); }
    if (!compact) {
      // keep trailing zeros for a steady column of digits
      s = m.toPrecision(sig);
      if (s.includes('e')) s = (+s).toString();
    }
    const p = ENG_P[String(e)];
    return compact ? `${s}${p}` : `${s} ${p}${unit}`.trim();
  }

  // ----------------------------------------------------------- the chart map
  function zToGamma(z) {
    if (!finite(z)) return cx(1, 0);
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

  // A point from a magnitude form and a phase in degrees.
  //   kind 'mag'  value is |gamma|
  //   kind 'vswr' value is the VSWR (1 or more)
  //   kind 'db'   value is S11 in dB. A positive value is read as a return
  //               loss, so 10 and -10 give the same point.
  function gammaFrom(kind, value, phaseDeg) {
    let m;
    if (kind === 'vswr') m = value >= 1 ? (value - 1) / (value + 1) : NaN;
    else if (kind === 'db') m = Math.pow(10, -Math.abs(value) / 20);
    else m = value;
    if (!(m >= 0)) return null;
    return polar(m, phaseDeg * Math.PI / 180);
  }

  // The Q of a point: |x| / r. Infinity on the rim.
  function qOf(z) { return z.re > 0 ? Math.abs(z.im) / z.re : Infinity; }

  // The part of a reactance X (ohms) at f: X > 0 is an inductor, X < 0 a
  // capacitor. The part of a susceptance B (siemens): B > 0 is a capacitor,
  // B < 0 an inductor. { kind: 'L' | 'C' | null, value }.
  function partOfX(X, f) {
    const w = TAU * f;
    if (!(w > 0) || !isFinite(X) || Math.abs(X) < 1e-12) return { kind: null, value: 0 };
    return X > 0 ? { kind: 'L', value: X / w } : { kind: 'C', value: -1 / (w * X) };
  }
  function partOfB(B, f) {
    const w = TAU * f;
    if (!(w > 0) || !isFinite(B) || Math.abs(B) < 1e-15) return { kind: null, value: 0 };
    return B > 0 ? { kind: 'C', value: B / w } : { kind: 'L', value: -1 / (w * B) };
  }
  // The reactance of a part at f (inverse of partOfX), and the susceptance.
  function xOfPart(p, f) {
    const w = TAU * f;
    if (!p.kind) return 0;
    return p.kind === 'L' ? w * p.value : -1 / (w * p.value);
  }
  function bOfPart(p, f) {
    const w = TAU * f;
    if (!p.kind) return 0;
    return p.kind === 'C' ? w * p.value : -1 / (w * p.value);
  }

  // The series and the parallel equivalent of Z (ohms) at f.
  //   series:   Rs with Ls or Cs
  //   parallel: Rp across Lp or Cp
  function equivalent(Z, f) {
    const Y = inv(Z);
    return {
      series: { R: Z.re, part: partOfX(Z.im, f) },
      parallel: { R: Y.re > 0 ? 1 / Y.re : Infinity, part: partOfB(Y.im, f) },
    };
  }

  // ------------------------------------------------------------ load models
  // Z in ohms of R + jwL + 1/(jwC). C = Infinity (or 0) removes the
  // capacitor, which is then a short in series.
  function seriesRLC(R, L, C, f) {
    const w = TAU * f;
    const xc = isFinite(C) && C > 0 ? 1 / (w * C) : 0;
    return cx(R, w * (L || 0) - xc);
  }
  // Z in ohms of R, L and C in parallel. R = Infinity (or 0) removes R,
  // L = Infinity (or 0) removes L, C = 0 removes C. With no part left, the
  // load is an open circuit.
  function parallelRLC(R, L, C, f) {
    const w = TAU * f;
    let G = 0, B = 0;
    if (isFinite(R) && R > 0) G = 1 / R;
    if (isFinite(L) && L > 0) B -= 1 / (w * L);
    if (isFinite(C) && C > 0) B += w * C;
    if (G === 0 && B === 0) return cx(Infinity, 0);
    return inv(cx(G, B));
  }

  // --------------------------------------------------------------- matching
  // L-network match of ZL (ohms) to Z0 (ohms) with two lossless parts.
  // Two topologies, named by the part next to the load:
  //   'series'  series part at the load, then a shunt part at the input.
  //             It exists when 0 < RL <= Z0.
  //   'shunt'   shunt part across the load, then a series part at the input.
  //             It exists when 0 < GL <= 1/Z0.
  // Each topology has two solutions (one when the root is 0). Each solution:
  //   { topo, sign, near: {pos, X|B, part}, far: {pos, X|B, part}, mid, q }
  // near is the part at the load, far the part at the input. mid is Z (ohms)
  // between the two parts. q is the Q of mid, which sets the bandwidth.
  // A part with value 0 is a plain wire (series) or nothing (shunt).
  function lMatch(ZL, Z0, f) {
    const out = [];
    if (!finite(ZL) || !(Z0 > 0)) return out;
    const R = ZL.re, X = ZL.im;
    if (Math.abs(R - Z0) < 1e-9 * Z0 && Math.abs(X) < 1e-9 * Z0) return out;
    // series part at the load: |ZL + jXs| on the circle Re(1/Z) = 1/Z0
    if (R > 0 && R <= Z0 * (1 + 1e-12)) {
      const s = Math.sqrt(Math.max(0, R * Z0 - R * R));
      for (const sign of s > 1e-12 * Z0 ? [1, -1] : [1]) {
        const Xs = -X + sign * s;
        const mid = cx(R, sign * s), Ym = inv(mid), Bp = -Ym.im;
        out.push({
          topo: 'series', sign,
          near: { pos: 'series', X: Xs, part: partOfX(Xs, f) },
          far: { pos: 'shunt', B: Bp, part: partOfB(Bp, f) },
          mid, q: qOf(mid),
        });
      }
    }
    // shunt part across the load
    const YL = inv(ZL), G = YL.re, BL = YL.im;
    if (G > 0 && G <= (1 / Z0) * (1 + 1e-12)) {
      const t = Math.sqrt(Math.max(0, G / Z0 - G * G));
      for (const sign of t > 1e-12 / Z0 ? [1, -1] : [1]) {
        const Bs = -BL + sign * t;
        const mid = inv(cx(G, sign * t)), Xp = -mid.im;
        out.push({
          topo: 'shunt', sign,
          near: { pos: 'shunt', B: Bs, part: partOfB(Bs, f) },
          far: { pos: 'series', X: Xp, part: partOfX(Xp, f) },
          mid, q: qOf(mid),
        });
      }
    }
    return out;
  }
  // The input impedance of an L-network solution, built from the part values
  // at f (not from the stored X and B). The tests use it to check a match.
  function lNetworkZin(ZL, sol, f) {
    const step = (Z, el) => el.pos === 'series'
      ? add(Z, cx(0, xOfPart(el.part, f)))
      : inv(add(inv(Z), cx(0, bOfPart(el.part, f))));
    return step(step(ZL, sol.near), sol.far);
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
  // The guided wavelength in metres: vf * c / f.
  const lambdaOf = (f, vf) => (vf || 1) * C0 / f;
  // shuntStub in real units. Adds d and l in degrees and in metres.
  function stubMatch(ZL, Z0, kind, f, vf) {
    const lam = lambdaOf(f, vf);
    return shuntStub(scale(ZL, 1 / Z0), kind).map(s => ({
      ...s, dDeg: s.d * 360, lDeg: s.l * 360,
      dM: isFinite(lam) ? s.d * lam : NaN, lM: isFinite(lam) ? s.l * lam : NaN,
    }));
  }
  // The input admittance (normalized) of a shunt stub of length l.
  function stubY(kind, l) {
    const bl = TAU * l;
    return kind === 'short' ? cx(0, -1 / Math.tan(bl)) : cx(0, Math.tan(bl));
  }

  // Line + quarter-wave transformer. A line of length d turns the load to a
  // real R (a voltage maximum, R = Z0 * VSWR, or a minimum, R = Z0 / VSWR).
  // A lambda/4 line of Zt = sqrt(Z0 * R) then gives Z0.
  // Each solution: { at: 'max' | 'min', d, R, Zt }, nearest first.
  function quarterWave(ZL, Z0) {
    const z = scale(ZL, 1 / Z0), g = zToGamma(z), m = abs(g);
    if (!(m > 1e-9) || m >= 1 - 1e-12) return [];
    const th = arg(g), S = vswr(m);
    const wrap = d => { d %= 0.5; return d < 0 ? d + 0.5 : d; };
    const out = [
      { at: 'max', d: wrap(th / (2 * TAU)), R: Z0 * S },
      { at: 'min', d: wrap((th + Math.PI) / (2 * TAU)), R: Z0 / S },
    ].map(s => ({ ...s, Zt: Math.sqrt(Z0 * s.R) }));
    out.sort((a, b) => a.d - b.d);
    return out;
  }

  // ------------------------------------------------------------- Touchstone
  // Read a Touchstone file (version 1, and the plain parts of version 2).
  // Only S11 (or Z11, Y11 for a 1-port) is kept: the first pair of each
  // record. ports comes from the [Number of Ports] keyword, from the file
  // name (.s2p), or from the count of numbers on the first data line.
  // Returns { ref, param, fmt, ports, points: [{ f, g }] }, with g relative
  // to ref (ohms) and f in hertz, sorted by f. Throws on a bad file.
  function parseTouchstone(text, name) {
    let unit = 1e9, param = 'S', fmt = 'MA', ref = 50, ports = 0, gotOpt = false;
    const ext = /\.s(\d+)p$/i.exec(name || '');
    if (ext) ports = +ext[1];
    const nums = [];
    let firstLineCount = 0;
    const UNITS = { hz: 1, khz: 1e3, mhz: 1e6, ghz: 1e9 };
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.replace(/!.*/, '').trim();
      if (!line) continue;
      if (line[0] === '#') {
        if (gotOpt) continue;                 // only the first option line counts
        gotOpt = true;
        const tok = line.slice(1).trim().split(/\s+/);
        for (let i = 0; i < tok.length; i++) {
          const t = tok[i].toLowerCase();
          if (UNITS[t]) unit = UNITS[t];
          else if (/^[syzgh]$/.test(t)) param = t.toUpperCase();
          else if (t === 'ri' || t === 'ma' || t === 'db') fmt = t.toUpperCase();
          else if (t === 'r') { ref = parseFloat(tok[++i]); if (!(ref > 0)) throw new Error('Bad reference R in the option line.'); }
        }
        continue;
      }
      if (line[0] === '[') {
        const np = /^\[number of ports\]\s*(\d+)/i.exec(line);
        if (np) ports = +np[1];
        continue;                              // other v2 keywords: skip
      }
      const vals = line.split(/[\s,]+/).map(Number);
      if (vals.some(v => !isFinite(v))) throw new Error(`Not a number in the line: "${raw.trim()}"`);
      if (!firstLineCount) firstLineCount = vals.length;
      for (const v of vals) nums.push(v);
    }
    if (!ports) {
      if (firstLineCount === 3) ports = 1;
      else if (firstLineCount === 9) ports = 2;
      else throw new Error('The port count is not clear. Use a .s1p or .s2p file name.');
    }
    if (ports !== 1 && param !== 'S') throw new Error(`${param}-parameters are read only for a 1-port file.`);
    const rec = 1 + 2 * ports * ports;
    if (nums.length < rec) throw new Error('The file has no data.');
    if (nums.length % rec) throw new Error(`The data does not divide into records of ${rec} numbers.`);
    const points = [];
    for (let i = 0; i < nums.length; i += rec) {
      const f = nums[i] * unit, a = nums[i + 1], b = nums[i + 2];
      let v;
      if (fmt === 'RI') v = cx(a, b);
      else if (fmt === 'DB') v = polar(Math.pow(10, a / 20), b * Math.PI / 180);
      else v = polar(a, b * Math.PI / 180);
      // Z and Y data in a version-1 file are normalized to R.
      let g = v;
      if (param === 'Z') g = zToGamma(v);
      else if (param === 'Y') g = zToGamma(inv(v));
      else if (param !== 'S') throw new Error(`${param}-parameters are not supported.`);
      points.push({ f, g });
    }
    points.sort((p, q) => p.f - q.f);
    return { ref, param, fmt, ports, points };
  }
  // gamma at f by linear interpolation of re and im between the two nearest
  // points. null when f is outside the data.
  function gammaAtFreq(points, f) {
    if (!points || !points.length) return null;
    if (f < points[0].f || f > points[points.length - 1].f) return null;
    let lo = 0, hi = points.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (points[mid].f <= f) lo = mid; else hi = mid; }
    const a = points[lo], b = points[hi];
    if (b.f === a.f) return a.g;
    const t = (f - a.f) / (b.f - a.f);
    return cx(a.g.re + (b.g.re - a.g.re) * t, a.g.im + (b.g.im - a.g.im) * t);
  }
  // A gamma relative to ref, given as an impedance in ohms.
  function zFromGammaRef(g, ref) { return scale(gammaToZ(g), ref); }

  const RF = {
    TAU, C0, cx, add, sub, mul, div, abs, arg, polar, scale, inv, finite,
    parseEng, fmtEng,
    zToGamma, gammaToZ, towardGen, zIn, wtg, gammaFrom, qOf,
    vswr, returnLossDb, mismatchLossDb,
    partOfX, partOfB, xOfPart, bOfPart, equivalent,
    seriesRLC, parallelRLC,
    lMatch, lNetworkZin, shuntStub, stubMatch, stubY, lambdaOf, quarterWave,
    parseTouchstone, gammaAtFreq, zFromGammaRef,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = RF;
  else root.RF = RF;
})(this);
