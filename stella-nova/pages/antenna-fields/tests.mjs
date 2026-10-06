// ============================================================================
//  ANTENNA FIELDS  ·  tests.mjs — node tests for em.js
// ----------------------------------------------------------------------------
//  Run:  node stella-nova/pages/antenna-fields/tests.mjs
//  Each check prints its numbers. The exit code is 1 if a check fails.
//    1  Hertzian element vs the textbook spherical fields, near and far
//    2  Maxwell: E = (1/(j w eps)) curl H by finite differences (Yagi)
//    3  element sum of a sinusoidal dipole vs its closed-form near field
//    4  half-wave dipole impedance (induced EMF) and directivity
//    5  mutual impedance of two half-wave dipoles at 0.5 lambda
//    6  array factor vs the closed form, steered beam
//    7  power: Poynting flux through a sphere = |I|^2 R_in / 2
//    8  Yagi-Uda MoM: forward main lobe, front/back ratio
//    9  MoM convergence, small loop radiation resistance
// ============================================================================
import * as em from './em.js';

let fails = 0;
const fmt = (v, d = 3) => (typeof v === 'number' ? v.toFixed(d) : String(v));
function check(name, ok, info) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : ''));
  if (!ok) fails++;
}
const out = new Float64Array(18);
const cabs = (r, i) => Math.hypot(r, i);
const crel = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) / Math.max(1e-30, Math.hypot(b[0], b[1]));

// 1. Hertzian element vs the closed form ------------------------------------
{
  const L = em.elemList(1);
  const Idl = 0.01;
  L.d.set([0, 0, 0, 0, 0, 1, Idl, 0]); L.n = 1;
  let worst = 0;
  for (const r of [0.04, 0.3, 8]) {
    const th = 0.61, ph = 0.7;
    const st = Math.sin(th), ct = Math.cos(th), cp = Math.cos(ph), sp = Math.sin(ph);
    em.fieldAt(L, r * st * cp, r * st * sp, r * ct, out);
    const c = em.hertzClosed(Idl, r, th);
    // Spherical -> Cartesian: E = Er rhat + Eth thhat, H = Hph phhat.
    const rh = [st * cp, st * sp, ct], thh = [ct * cp, ct * sp, -st], phh = [-sp, cp, 0];
    for (let a = 0; a < 3; a++) {
      const Ee = [c.Er[0] * rh[a] + c.Eth[0] * thh[a], c.Er[1] * rh[a] + c.Eth[1] * thh[a]];
      const He = [c.Hph[0] * phh[a], c.Hph[1] * phh[a]];
      const sE = Math.hypot(c.Er[0], c.Er[1], c.Eth[0], c.Eth[1]), sH = Math.hypot(c.Hph[0], c.Hph[1]);
      worst = Math.max(worst, Math.hypot(out[2 * a] - Ee[0], out[2 * a + 1] - Ee[1]) / sE, Math.hypot(out[6 + 2 * a] - He[0], out[7 + 2 * a] - He[1]) / sH);
    }
  }
  check('hertzian fields vs closed form (kr = 0.25, 1.9, 50)', worst < 1e-12, 'max rel err ' + worst.toExponential(2));
}

// 2. Maxwell curl check on a Yagi near field ----------------------------------
{
  const A = em.buildAntenna({ type: 'yagi', Lr: 0.495, Ld: 0.47, Lz: 0.44, sr: 0.2, sd: 0.25, nd: 3, a: 1e-3 });
  const p = [0.31, 0.17, 0.12], h = 1e-5, H = (x, y, z) => { em.fieldAt(A.elems, x, y, z, out); return Array.from(out.slice(6, 12)); };
  const d = (ax, comp) => {
    const q1 = p.slice(), q0 = p.slice(); q1[ax] += h; q0[ax] -= h;
    const a = H(...q1), b = H(...q0); return [(a[2 * comp] - b[2 * comp]) / (2 * h), (a[2 * comp + 1] - b[2 * comp + 1]) / (2 * h)];
  };
  // curl H, then E = -j (eta/k) curl H
  const cx = [d(1, 2)[0] - d(2, 1)[0], d(1, 2)[1] - d(2, 1)[1]];
  const cy = [d(2, 0)[0] - d(0, 2)[0], d(2, 0)[1] - d(0, 2)[1]];
  const cz = [d(0, 1)[0] - d(1, 0)[0], d(0, 1)[1] - d(1, 0)[1]];
  const q = em.ETA / em.K;
  const Ec = [cx, cy, cz].map(c => [q * c[1], -q * c[0]]);
  em.fieldAt(A.elems, p[0], p[1], p[2], out);
  const En = Math.hypot(...out.slice(0, 6));
  let err = 0;
  for (let a = 0; a < 3; a++) err = Math.max(err, Math.hypot(Ec[a][0] - out[2 * a], Ec[a][1] - out[2 * a + 1]) / En);
  check('E = curl H / (j w eps) near a Yagi', err < 1e-5, 'rel err ' + err.toExponential(2));
}

// 3. Element sum vs the closed-form sinusoidal dipole near field -------------
{
  const h = 0.25, ne = 4000, L = em.elemList(ne);
  for (let i = 0; i < ne; i++) {
    const z = -h + (i + 0.5) * 2 * h / ne;
    L.d.set([0, 0, z, 0, 0, 1, Math.sin(em.K * (h - Math.abs(z))) * 2 * h / ne, 0], i * em.STRIDE);
  }
  L.n = ne;
  let worst = 0;
  for (const [rho, z] of [[0.1, 0.1], [0.05, -0.2], [0.3, 0.4], [1.2, 0.3]]) {
    em.fieldAt(L, rho, 0, z, out);
    const c = em.pwsField(h, 1, rho, z);
    worst = Math.max(worst, crel([out[4], out[5]], c.Ez), crel([out[0], out[1]], c.Erho), crel([out[8], out[9]], c.Hphi));
  }
  check('element sum vs closed-form half-wave near field', worst < 2e-3, 'max rel err ' + worst.toExponential(2));
}

// 4. Half-wave dipole: impedance and directivity -----------------------------
let Zhw;
{
  Zhw = em.dipoleZsin(0.5, 1e-5).Zin;
  check('half-wave dipole Z_in (sinusoidal current, induced EMF)', Math.abs(Zhw[0] - 73.08) < 0.3 && Math.abs(Zhw[1] - 42.5) < 0.3,
    'Z = ' + fmt(Zhw[0], 2) + ' + j' + fmt(Zhw[1], 2) + ' ohm (textbook 73.08 + j42.5)');
  const A = em.buildAntenna({ type: 'dipole', L: 0.5, a: 1e-5, model: 'sin' });
  const s = em.patternStats(A.elems, { nt: 96, np: 64 });
  check('half-wave directivity', Math.abs(s.D - 1.641) < 0.004 && Math.abs(s.Ddb - 2.15) < 0.02, 'D = ' + fmt(s.D, 4) + ' = ' + fmt(s.Ddb, 3) + ' dBi, HPBW ' + fmt(s.hpbwE, 1) + ' deg');
  const Hz = em.buildAntenna({ type: 'hertz', dl: 0.02 });
  const sh = em.patternStats(Hz.elems, { nt: 48, np: 32 });
  check('hertzian directivity 1.5 and R_rad = (2 pi/3) eta (dl/lambda)^2', Math.abs(sh.D - 1.5) < 1e-3 && Math.abs(2 * sh.P - Hz.Zin[0]) / Hz.Zin[0] < 1e-3,
    'D = ' + fmt(sh.D, 4) + ', 2P = ' + fmt(2 * sh.P, 5) + ' ohm vs ' + fmt(Hz.Zin[0], 5));
}

// 5. Mutual impedance ---------------------------------------------------------
{
  const Z = em.mutualZsin(0.5, 0.5, 0.5);
  check('mutual Z of half-wave dipoles at 0.5 lambda', Math.abs(Z[0] + 12.5) < 0.2 && Math.abs(Z[1] + 29.9) < 0.2, 'Z12 = ' + fmt(Z[0], 2) + ' ' + fmt(Z[1], 2) + 'j ohm (textbook -12.5 - j29.9)');
}

// 6. Array factor ---------------------------------------------------------------
{
  const N = 9, d = 0.42, beta = -em.K * d * Math.sin(25 * Math.PI / 180);
  const A = em.buildAntenna({ type: 'array', N, d, beta, Le: 0.5, a: 1e-3 });
  const one = em.buildAntenna({ type: 'array', N: 1, d, beta: 0, Le: 0.5, a: 1e-3 });
  let err = 0;
  for (let i = 0; i < 720; i++) {
    const ph = 2 * Math.PI * i / 720, sx = Math.cos(ph), sy = Math.sin(ph);
    const psi = em.K * d * sx + beta;
    const af = Math.abs(Math.sin(psi / 2)) < 1e-9 ? N : Math.sin(N * psi / 2) / Math.sin(psi / 2);
    const U = em.farIntensity(A.elems, sx, sy, 0), Ue = em.farIntensity(one.elems, sx, sy, 0);
    err = Math.max(err, Math.abs(U / Ue - af * af) / (N * N));
  }
  const s = em.patternStats(A.elems);
  const steer = Math.atan2(s.dir[0], Math.abs(s.dir[1])) * 180 / Math.PI;
  check('array factor vs closed form (N = 9, d = 0.42, steered 25 deg)', err < 1e-9 && Math.abs(steer - 25) < 0.2,
    'max err ' + err.toExponential(2) + ', beam at ' + fmt(steer, 2) + ' deg from broadside, D = ' + fmt(s.Ddb, 2) + ' dBi');
}

// 7. Power conservation -------------------------------------------------------
function sphereFlux(L, r, nt = 48, np = 96) {
  const g = em.gaussLegendre(nt);
  let P = 0;
  for (let i = 0; i < nt; i++) {
    const ct = g.x[i], st = Math.sqrt(1 - ct * ct);
    for (let j = 0; j < np; j++) {
      const ph = 2 * Math.PI * (j + 0.5) / np, n = [st * Math.cos(ph), st * Math.sin(ph), ct];
      em.fieldAt(L, r * n[0], r * n[1], r * n[2], out);
      // 1/2 Re{E x H*} . n
      const E = [[out[0], out[1]], [out[2], out[3]], [out[4], out[5]]], H = [[out[6], -out[7]], [out[8], -out[9]], [out[10], -out[11]]];
      const re = (a, b) => a[0] * b[0] - a[1] * b[1];
      const S = [re(E[1], H[2]) - re(E[2], H[1]), re(E[2], H[0]) - re(E[0], H[2]), re(E[0], H[1]) - re(E[1], H[0])];
      P += 0.5 * (S[0] * n[0] + S[1] * n[1] + S[2] * n[2]) * g.w[i] * (2 * Math.PI / np) * r * r;
    }
  }
  return P;
}
{
  const A = em.buildAntenna({ type: 'dipole', L: 0.5, a: 1e-5, model: 'sin' });
  const P1 = sphereFlux(A.elems, 0.4), P2 = sphereFlux(A.elems, 2.0), want = A.Zin[0] / 2;
  check('half-wave: Poynting flux at r = 0.4 and 2 lambda = I^2 R_in / 2', Math.abs(P1 - want) / want < 3e-3 && Math.abs(P2 - want) / want < 3e-3,
    'P = ' + fmt(P1, 3) + ', ' + fmt(P2, 3) + ' W vs ' + fmt(want, 3) + ' W');
  const Lp = em.buildAntenna({ type: 'loop', C: 1, a: 1e-3 });
  const Pl = sphereFlux(Lp.elems, 0.6), wl = Lp.Zin[0] / 2;
  check('one-wavelength loop: flux at r = 0.6 lambda = I^2 R_in / 2', Math.abs(Pl - wl) / wl < 3e-3, 'P = ' + fmt(Pl, 3) + ' W vs ' + fmt(wl, 3) + ' W');
  const Y = em.buildAntenna({ type: 'yagi', Lr: 0.495, Ld: 0.47, Lz: 0.44, sr: 0.2, sd: 0.25, nd: 4, a: 1e-3 });
  const Py = sphereFlux(Y.elems, 1.6, 64, 128), wy = Y.Zin[0] / 2;
  check('6-element Yagi: flux at r = 1.6 lambda = I^2 R_in / 2', Math.abs(Py - wy) / wy < 5e-3, 'P = ' + fmt(Py, 3) + ' W vs ' + fmt(wy, 3) + ' W');
}

// 8. Yagi-Uda ------------------------------------------------------------------
{
  const Y3 = em.buildAntenna({ type: 'yagi', Lr: 0.495, Ld: 0.47, Lz: 0.44, sr: 0.2, sd: 0.2, nd: 1, a: 1e-3 });
  const s3 = em.patternStats(Y3.elems);
  check('3-element Yagi MoM: main lobe toward the director (+x)', s3.dir[0] > 0.99 && s3.fb > 8 && s3.Ddb > 6,
    'dir (' + s3.dir.map(v => fmt(v, 3)).join(', ') + '), G = ' + fmt(s3.Ddb, 2) + ' dBi, F/B = ' + fmt(s3.fb, 1) + ' dB, Z = ' + fmt(Y3.Zin[0], 1) + ' + j' + fmt(Y3.Zin[1], 1));
  const Y6 = em.buildAntenna({ type: 'yagi', Lr: 0.495, Ld: 0.47, Lz: 0.44, sr: 0.2, sd: 0.25, nd: 4, a: 1e-3 });
  const s6 = em.patternStats(Y6.elems);
  check('6-element Yagi: more gain than 3 elements', s6.dir[0] > 0.99 && s6.Ddb > s3.Ddb + 2,
    'G = ' + fmt(s6.Ddb, 2) + ' dBi, F/B = ' + fmt(s6.fb, 1) + ' dB, HPBW E/H ' + fmt(s6.hpbwE, 1) + ' / ' + fmt(s6.hpbwH, 1) + ' deg');
}

// 9. MoM convergence and the small loop ----------------------------------------
{
  const a = 1e-3;
  const z20 = em.solveWires([{ x: 0, y: 0, zc: 0, h: 0.25, a, n: 20, V: 1 }]).Zin;
  const z40 = em.solveWires([{ x: 0, y: 0, zc: 0, h: 0.25, a, n: 40, V: 1 }]).Zin;
  const dz = Math.hypot(z40[0] - z20[0], z40[1] - z20[1]) / Math.hypot(...z40);
  check('half-wave MoM (a = 0.001 lambda): N = 20 vs 40 within 3 %', dz < 0.03 && z40[0] > 70 && z40[0] < 95,
    'Z20 = ' + fmt(z20[0], 2) + ' + j' + fmt(z20[1], 2) + ', Z40 = ' + fmt(z40[0], 2) + ' + j' + fmt(z40[1], 2) + ' ohm');
  // The textbook 20 pi^2 (C/lambda)^4 uses eta = 120 pi. With the exact eta
  // it is (eta pi/6)(C/lambda)^4. R_in is larger: the gap capacitance of the
  // higher modes steps it up, so the check uses the uniform mode alone.
  const C = 0.1, lp = em.solveLoop(C / (2 * Math.PI), 1e-4, 40), Rt = em.ETA * Math.PI / 6 * C ** 4;
  check('small loop mode-0 R = (eta pi/6)(C/lambda)^4 (20 pi^2 C^4 with exact eta)', Math.abs(lp.Z0[0] - Rt) / Rt < 0.01,
    'R0 = ' + lp.Z0[0].toExponential(4) + ' vs ' + Rt.toExponential(4) + ' ohm; R_in with the gap = ' + lp.Zin[0].toExponential(4) + ', X_in = ' + fmt(lp.Zin[1], 2));
}

console.log(fails ? fails + ' check(s) failed' : 'all checks passed');
process.exit(fails ? 1 : 0);
