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
//   10  wire nodes (the GPU source) vs the closed form and the element sum
//   11  geom.js: Poynting flux through a sphere = the pattern integral, at
//       every radius (divergence theorem); P(t) < 0 only near the antenna
//   12  geom.js: half-wave directivity 4 pi U_max / (sphere flux) = 1.64
//   13  geom.js: phasor sum = farIntensity; array terms line up at the
//       steering angle sin(theta_s) = -beta/(kd)
//   14  geom.js: E-H phase gap -90 deg near, 0 far (Hertzian closed form)
//   15  geom.js: energy velocity |v| <= c, = c and radial in the far field
//   16  circleFlux = S(t).n at the sample points
//   17  flow.js and overlay.js draw every antenna and view into a recording
//       2D context with finite coordinates only (a CPU probe grid)
//   18  patternGrid (the 3D mesh): the grid integral of U = the radiated power
// ============================================================================
import * as em from './em.js';
import * as geom from './geom.js';
import { createFlow } from './flow.js';
import { drawOverlay, mapper } from './overlay.js';

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

// 10. Wire nodes -----------------------------------------------------------------
{
  const o12 = new Float64Array(12);
  // Half-wave and 1.25-wavelength sinusoidal dipoles: nodes vs pwsField (exact).
  let worst = 0;
  for (const Lw of [0.5, 1.25]) {
    const A = em.buildAntenna({ type: 'dipole', L: Lw, a: 1e-3, model: 'sin' });
    const Im = 1 / Math.sin(em.K * Lw / 2);
    for (const [rho, z] of [[0.1, 0.1], [0.05, -0.2], [0.3, 0.4], [1.2, 0.3], [0.02, 0.7]]) {
      em.fieldAtNodes(A.nodes, rho, 0, z, o12);
      const c = em.pwsField(Lw / 2, Im, rho, z);
      worst = Math.max(worst, crel([o12[4], o12[5]], c.Ez), crel([o12[0], o12[1]], c.Erho), crel([o12[8], o12[9]], c.Hphi));
    }
  }
  check('wire nodes vs closed-form sinusoidal dipole (L = 0.5, 1.25)', worst < 1e-12, 'nodes 3, max rel err ' + worst.toExponential(2));
  // MoM Yagi-Uda: nodes vs a dense element sum of the same node currents.
  const Y = em.buildAntenna({ type: 'yagi', Lr: 0.495, Ld: 0.47, Lz: 0.44, sr: 0.2, sd: 0.25, nd: 3, a: 1e-3, budget: 20000 });
  let wy = 0;
  for (const p of [[0.3, 0.1, 0.2], [0.05, 0.02, -0.1], [1.5, -0.7, 0.4], [0.2, 0.2, 0.6]]) {
    em.fieldAt(Y.elems, p[0], p[1], p[2], out); em.fieldAtNodes(Y.nodes, p[0], p[1], p[2], o12);
    const n = Math.hypot(...out.slice(0, 12));
    for (let i = 0; i < 12; i++) wy = Math.max(wy, Math.abs(out[i] - o12[i]) / n);
  }
  check('wire nodes vs element sum, 5-element Yagi MoM', wy < 1e-6, Y.nodes.n + ' nodes vs ' + Y.elems.n + ' elements, max rel err ' + wy.toExponential(2));
}

// 11. Flux through a sphere ------------------------------------------------------
{
  const cases = [
    ['half-wave', em.buildAntenna({ type: 'dipole', L: 0.5, a: 1e-3, model: 'sin' }), [0, 0, 0], [0.3, 1, 3]],
    ['6-element Yagi', em.buildAntenna({ type: 'yagi', Lr: 0.495, Ld: 0.47, Lz: 0.44, sr: 0.2, sd: 0.25, nd: 4, a: 1e-3 }), [0.4, 0, 0], [1.2, 2.5]],
    ['loop C = 1', em.buildAntenna({ type: 'loop', C: 1, a: 1e-3 }), [0, 0, 0], [0.4, 2]],
    ['Hertzian', em.buildAntenna({ type: 'hertz', dl: 0.02 }), [0, 0, 0], [0.05, 0.3, 3]],
  ];
  for (const [nm, A, c, radii] of cases) {
    const st = em.patternStats(A.elems, { nt: 64, np: 128 });
    const fl = radii.map(r => geom.sphereFlux(A, c, r, 48, 96));
    const err = Math.max(...fl.map(f => Math.abs(f.P - st.P) / st.P));
    check(nm + ': sphere flux = pattern integral at r = ' + radii.join(', '), err < 4e-3,
      'P = ' + fl.map(f => fmt(f.P, 4)).join(', ') + ' W vs ' + fmt(st.P, 4) + ' W, max rel err ' + err.toExponential(2));
  }
  // The stored energy sloshes: P(t) dips below 0 near a Hertzian dipole, not far away.
  const Hz = em.buildAntenna({ type: 'hertz', dl: 0.02 });
  const near = geom.sphereFlux(Hz, [0, 0, 0], 0.05, 32, 32), far = geom.sphereFlux(Hz, [0, 0, 0], 3, 32, 32);
  const pmin = sf => Math.min(...Array.from({ length: 64 }, (_, i) => geom.fluxAt(sf, Math.PI * i / 64)));
  check('Hertzian: P(t) < 0 at r = 0.05 (reactive), P(t) >= 0 at r = 3 (radiating)', pmin(near) < -10 * near.P && pmin(far) > -0.01 * far.P,
    'min P(t)/P = ' + fmt(pmin(near) / near.P, 1) + ' and ' + fmt(pmin(far) / far.P, 4) + ', |Q|/P = ' + fmt(Math.hypot(...near.Q) / near.P, 1) + ' and ' + fmt(Math.hypot(...far.Q) / far.P, 4));
  // The page text: the whole-sphere flux goes below zero near a small antenna
  // (a small loop too), but not near a large one (the 6-element Yagi).
  const Lp = em.buildAntenna({ type: 'loop', C: 0.15, a: 1e-3 }), lp = geom.sphereFlux(Lp, [0, 0, 0], 0.05, 24, 48);
  const Yg = em.buildAntenna({ type: 'yagi', Lr: 0.495, Ld: 0.47, Lz: 0.44, sr: 0.2, sd: 0.25, nd: 4, a: 1e-3 }), yg = geom.sphereFlux(Yg, [0.4, 0, 0], 0.75, 24, 48);
  check('small loop: P(t) < 0 at r = 0.05; 6-element Yagi: P(t) > 0 at r = 0.75', pmin(lp) < 0 && pmin(yg) > 0,
    'min P(t)/P = ' + fmt(pmin(lp) / lp.P, 2) + ' and ' + fmt(pmin(yg) / yg.P, 2));
}

// 12. Half-wave directivity from the sphere flux -------------------------------------
{
  const A = em.buildAntenna({ type: 'dipole', L: 0.5, a: 1e-3, model: 'sin' });
  const P = geom.sphereFlux(A, [0, 0, 0], 2, 48, 32).P, Umax = em.farIntensity(A.elems, 1, 0, 0);
  const D = 4 * Math.PI * Umax / P;
  check('half-wave directivity 4 pi U_max / (sphere flux) = 1.64', Math.abs(D - 1.641) < 0.005, 'D = ' + fmt(D, 4) + ' = ' + fmt(10 * Math.log10(D), 3) + ' dBi');
}

// 13. Phasor sums ----------------------------------------------------------------------
{
  let worst = 0;
  const ants = [
    em.buildAntenna({ type: 'dipole', L: 1.25, a: 1e-3, model: 'sin' }),
    em.buildAntenna({ type: 'array', N: 8, d: 0.5, beta: -0.9, Le: 0.5, a: 1e-3 }),
    em.buildAntenna({ type: 'yagi', Lr: 0.495, Ld: 0.47, Lz: 0.44, sr: 0.2, sd: 0.25, nd: 4, a: 1e-3 }),
  ];
  for (const A of ants) for (const [th, ph] of [[0.4, 0.3], [1.2, 2.0], [Math.PI / 2, 0.1], [2.5, 4.0]]) {
    const s = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
    const U = em.farIntensity(A.elems, ...s), q = geom.phasorTerms(A, s);
    worst = Math.max(worst, Math.abs(q.U - U) / Math.max(U, 1e-12));
  }
  check('phasor sum |sum|^2 = U for dipole, array and Yagi', worst < 1e-9, 'max rel err ' + worst.toExponential(2));
  const N = 8, d = 0.5, ts = 25 * Math.PI / 180, beta = -em.K * d * Math.sin(ts);
  const Ar = em.buildAntenna({ type: 'array', N, d, beta, Le: 0.5, a: 1e-3 });
  const s = [Math.sin(ts), Math.cos(ts), 0];   // 25 deg from broadside (+y) toward +x
  const q = geom.phasorTerms(Ar, s), st = em.patternStats(Ar.elems);
  const steer = Math.atan2(st.dir[0], Math.abs(st.dir[1])) * 180 / Math.PI;
  check('array: terms line up at theta_s = asin(-beta/(kd)) = 25 deg', Math.abs(Math.hypot(...q.sum) / q.mags - 1) < 1e-9 && Math.abs(steer - 25) < 0.2,
    q.terms.length + ' terms, |sum|/sum|t| = ' + fmt(Math.hypot(...q.sum) / q.mags, 9) + ', beam at ' + fmt(steer, 2) + ' deg');
}

// 14. E-H phase gap ---------------------------------------------------------------------
{
  const Hz = em.buildAntenna({ type: 'hertz', dl: 0.01 });
  let worst = 0;
  const rows = [];
  for (const kr of [0.05, 0.5, 1, 3, 60]) {
    const r = kr / em.K, o = geom.observer(Hz, [0, 0, 0], [r, 0, 0]);
    worst = Math.max(worst, Math.abs(o.gap - geom.hertzGap(kr)));
    rows.push('kr ' + kr + ': ' + fmt(o.gap, 1));
  }
  check('E-H gap = closed form; -90 deg near, 0 far', worst < 1e-6 && geom.hertzGap(0.05) < -87 && Math.abs(geom.hertzGap(60)) < 1,
    rows.join(', ') + ' deg; max err ' + worst.toExponential(2));
}

// 15. Energy velocity ------------------------------------------------------------------
{
  const Y = em.buildAntenna({ type: 'yagi', Lr: 0.495, Ld: 0.47, Lz: 0.44, sr: 0.2, sd: 0.25, nd: 4, a: 1e-3 });
  let vmax = 0, r = 12345;
  const rnd = () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296 - 0.5; };
  const f = new Float64Array(12);
  for (let i = 0; i < 400; i++) {
    geom.fieldPoint(Y, 3 * rnd(), 3 * rnd(), 3 * rnd(), f);
    const ph = 6.283 * rnd(), c = Math.cos(ph), s = Math.sin(ph);
    const E = [0, 1, 2].map(k => f[2 * k] * c - f[2 * k + 1] * s), H = [0, 1, 2].map(k => f[6 + 2 * k] * c - f[7 + 2 * k] * s);
    vmax = Math.max(vmax, Math.hypot(...geom.energyVelocity(E, H)));
  }
  const A = em.buildAntenna({ type: 'dipole', L: 0.5, a: 1e-3, model: 'sin' }), R = 40;
  geom.fieldPoint(A, R, 0, 0, f);
  const E = [0, 1, 2].map(k => f[2 * k] * 0.3 - f[2 * k + 1] * 0.95), H = [0, 1, 2].map(k => f[6 + 2 * k] * 0.3 - f[7 + 2 * k] * 0.95);
  const v = geom.energyVelocity(E, H);
  check('energy velocity: |v| <= c near a Yagi; = c and radial at r = 40', vmax <= 1 + 1e-12 && Math.abs(v[0] - 1) < 2e-3,
    'max |v|/c over 400 points ' + fmt(vmax, 4) + ', far v/c = (' + v.map(q => fmt(q, 4)).join(', ') + ')');
}

// 16. circleFlux ----------------------------------------------------------------------
{
  const A = em.buildAntenna({ type: 'dipole', L: 0.5, a: 1e-3, model: 'sin' }), cf = geom.circleFlux(A, [0, 0, 0], 0.3, [1, 0, 0], [0, 0, 1], 8);
  let w = 0, big = 0;
  for (const i of [0, 1, 3]) {
    const a = 2 * Math.PI * i / 8, n = [Math.cos(a), 0, Math.sin(a)], f = geom.fieldPoint(A, 0.3 * n[0], 0, 0.3 * n[2]);
    for (const ph of [0.2, 0.7, 2.1]) {
      const c = Math.cos(ph), s = Math.sin(ph);
      const E = [0, 1, 2].map(k => f[2 * k] * c - f[2 * k + 1] * s), H = [0, 1, 2].map(k => f[6 + 2 * k] * c - f[7 + 2 * k] * s);
      const S = [E[1] * H[2] - E[2] * H[1], E[2] * H[0] - E[0] * H[2], E[0] * H[1] - E[1] * H[0]], d = S[0] * n[0] + S[1] * n[1] + S[2] * n[2];
      w = Math.max(w, Math.abs(d - (cf.s[i] + cf.q[2 * i] * Math.cos(2 * ph) - cf.q[2 * i + 1] * Math.sin(2 * ph)))); big = Math.max(big, Math.abs(d));
    }
  }
  check('circleFlux: s + Re{q e^{2jwt}} = S(t).n', w / big < 1e-6, 'max rel err ' + (w / big).toExponential(2));
}

// 17. Drawing: flow.js and overlay.js into a recording context ----------------------
{
  let bad = 0, calls = 0;
  const fin = (args, where) => { for (const v of args) if (typeof v === 'number' && !Number.isFinite(v)) { if (bad < 4) console.log('  non-finite in ' + where, args); bad++; } };
  globalThis.Path2D = class { moveTo(...a) { calls++; fin(a, 'Path2D.moveTo'); } lineTo(...a) { calls++; fin(a, 'Path2D.lineTo'); } };
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return s => ({ width: String(s).length * 6 });
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return (...a) => { fin(a, k); return { addColorStop() {} }; };
      return (...a) => { calls++; fin(a, String(k)); };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  // A CPU probe grid in the format of field-gl.js readProbe: T0..T3 RGBA per cell.
  const probeOf = (A, view, axU, axV, w, h) => {
    const T = [0, 1, 2, 3].map(() => new Float32Array(w * h * 4)), f = new Float64Array(12);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const u = view.u0 + (i + 0.5) / w * (view.u1 - view.u0), v = view.v0 + (j + 0.5) / h * (view.v1 - view.v0);
      geom.fieldPoint(A, u * axU[0] + v * axV[0], u * axU[1] + v * axV[1], u * axU[2] + v * axV[2], f);
      const o = (j * w + i) * 4;
      T[0].set([f[0], f[1], f[2], f[3]], o); T[1].set([f[4], f[5], f[6], f[7]], o); T[2].set([f[8], f[9], f[10], f[11]], o);
    }
    return { w, h, T };
  };
  const ants = [
    ['half-wave', { type: 'dipole', L: 0.5, a: 1e-3, model: 'sin' }, 'side'],
    ['dipole 1.25', { type: 'dipole', L: 1.25, a: 1e-3, model: 'mom' }, 'top'],
    ['loop', { type: 'loop', C: 0.15, a: 1e-3 }, 'side'],
    ['loop above', { type: 'loop', C: 1, a: 1e-3 }, 'top'],
    ['array', { type: 'array', N: 8, d: 0.5, beta: -1, Le: 0.5, a: 1e-3 }, 'top'],
    ['Yagi', { type: 'yagi', Lr: 0.495, Ld: 0.47, Lz: 0.44, sr: 0.2, sd: 0.25, nd: 4, a: 1e-3 }, 'top'],
    ['Hertzian', { type: 'hertz', dl: 0.05 }, 'side'],
  ];
  for (const [nm, st, vw] of ants) {
    const A = em.buildAntenna(st), axU = [1, 0, 0], axV = vw === 'side' ? [0, 0, 1] : [0, 1, 0];
    const view = { u0: -2, u1: 2, v0: -1.25, v1: 1.25 }, W = 800, H = 500;
    const probe = probeOf(A, view, axU, axV, 64, 40), fl = createFlow(300, 3);
    for (let k = 0; k < 20; k++) { fl.field(probe, k * 0.3, axU, axV, null); fl.step(1 / 60, 0.4, 4 / 64, 2.5 / 40); }
    const c = [0, 0, 0], p = [0.9, 0, 0.2].map((q, k) => k === 2 && vw === 'top' ? 0 : q);
    if (vw === 'top') p[1] = 0.2;
    const ob = geom.observer(A, c, p), r = Math.hypot(...p);
    for (const phase of [0, 1.3, 4]) {
      drawOverlay(ctx, {
        W, H, dpr: 2, view, map: mapper(view, W, H), wires: A.wires, plane: vw, axU, axV, phase, centre: [0, 0],
        zones: { on: true, rNear: 0.2, rFar: 1, lambdaM: 1 }, lines: null, feed: [0, 0, 0],
        flow: c2 => fl.draw(c2, W, H, '1,2,3', 2, 1),
        obs: { u: 0.9, v: 0.2, ob, sf: geom.sphereFlux(A, c, r, 8, 16), circle: geom.circleFlux(A, c, r, axU, axV, 24), sphere: true, zone: 'far', lambdaM: 1 },
        phasors: { pt: geom.phasorTerms(A, p.map(q => q / r)), rect: { x: 500, y: 300, w: 280, h: 190 } },
        scaleBox: { x: 10, y: 480, lambdaM: 1 },
      });
    }
  }
  check('flow.js and overlay.js: 7 antennas x 3 phases, finite coordinates only', bad === 0 && calls > 1000, calls + ' draw calls, ' + bad + ' non-finite');
}

// 18. patternGrid --------------------------------------------------------------------
{
  const A = em.buildAntenna({ type: 'yagi', Lr: 0.495, Ld: 0.47, Lz: 0.44, sr: 0.2, sd: 0.25, nd: 4, a: 1e-3 });
  const g = geom.patternGrid((x, y, z) => em.farIntensity(A.elems, x, y, z), 96, 192), st = em.patternStats(A.elems, { nt: 64, np: 128 });
  // trapezoid in theta and phi (the seam column repeats, so phi uses np cells)
  let P = 0;
  for (let i = 0; i <= g.nt; i++) {
    const th = Math.PI * i / g.nt, wt = (i === 0 || i === g.nt ? 0.5 : 1) * Math.PI / g.nt * Math.sin(th);
    for (let j = 0; j < g.np; j++) P += g.U[i * (g.np + 1) + j] * wt * 2 * Math.PI / g.np;
  }
  const seam = Math.max(...Array.from({ length: g.nt + 1 }, (_, i) => Math.abs(g.U[i * (g.np + 1)] - g.U[i * (g.np + 1) + g.np])));
  check('patternGrid: grid integral of U = P_rad, seam closed', Math.abs(P - st.P) / st.P < 2e-3 && seam === 0 && Math.abs(g.Umax / st.Umax - 1) < 0.01,
    'P = ' + fmt(P, 3) + ' W vs ' + fmt(st.P, 3) + ' W, Umax grid/true = ' + fmt(g.Umax / st.Umax, 4));
}

console.log(fails ? fails + ' check(s) failed' : 'all checks passed');
process.exit(fails ? 1 : 0);
