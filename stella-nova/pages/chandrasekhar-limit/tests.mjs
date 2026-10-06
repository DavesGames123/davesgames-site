// ============================================================================
//  CHANDRASEKHAR LIMIT  ·  tests.mjs — node stella-nova/pages/chandrasekhar-limit/tests.mjs
// ----------------------------------------------------------------------------
//  Checks physics.js against published values:
//    lane-emden ... xi_1 and omega_n for n = 1 (pi, pi exactly), n = 1.5
//                   (3.65375, 2.71406) and n = 3 (6.89685, 2.01824)
//    M_Ch ......... the formula with the solver's omega_3, mu_e = 2: within
//                   0.5 % of 5.836 / mu_e^2 = 1.459 Msun (Shapiro and
//                   Teukolsky 1983, eq. 3.3.17)
//    exact curve .. M(x_c) rises with x_c and goes to M_Ch (0.1 % at
//                   x_c = 1000), R goes to 0; the dimensioned formula and
//                   the solved n = 3 limit agree
//    Sirius B ..... the mu_e = 2 model of 1.018 Msun has R within 3 % of
//                   0.008098 Rsun (a cold model, so a little small)
//    slope ........ d ln R / d ln M = -1/3 at low mass (x_c 0.01 to 0.02)
//    E(R) ......... a minimum below the critical mass, none above it; the
//                   'profile' critical mass is M_Ch, the uniform one 1.20 M_Ch
//    eos .......... Gamma goes from 5/3 to 4/3
// ============================================================================
import * as P from './physics.js';

let fail = 0, n = 0;
const ok = (c, msg) => { n++; console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fail++; };
const rel = (a, b) => Math.abs(a / b - 1);

for (const [nn, xi, om] of [[1, Math.PI, Math.PI], [1.5, 3.65375, 2.71406], [3, 6.89685, 2.01824]]) {
  const L = P.laneEmden(nn);
  ok(Math.abs(L.xi1 - xi) < 2e-5 && Math.abs(L.omega - om) < 2e-5, `lane-emden n=${nn}: xi1 ${L.xi1.toFixed(6)} omega ${L.omega.toFixed(6)} (want ${xi.toFixed(5)}, ${om.toFixed(5)})`);
}
const om3 = P.laneEmden(3).omega;
const Mch = P.massChandra(2, { omega3: om3 }).Msun;
ok(rel(Mch, 5.836 / 4) < 0.005, `M_Ch(mu_e=2) = ${Mch.toFixed(4)} Msun, ${(100 * rel(Mch, 5.836 / 4)).toFixed(2)} % from 1.459`);
const MchH = P.massChandra(2, { omega3: om3, perElectron: P.K.mH }).Msun;
ok(rel(MchH, 1.4337) < 0.001, `M_Ch with m_H = ${MchH.toFixed(4)} Msun (Chandrasekhar's form)`);
ok(rel(P.massChandra(56 / 26).Msun, P.massChandra(2).Msun * (2 * 26 / 56) ** 2) < 1e-12, `M_Ch scales as mu_e^-2 (iron: ${P.massChandra(56 / 26).Msun.toFixed(3)})`);

const C = P.massRadiusCurve(2);
ok(C.every((w, i) => i === 0 || (w.M > C[i - 1].M && w.R < C[i - 1].R)), `exact curve: M rises and R falls over ${C.length} models`);
const big = P.whiteDwarf(1000);
ok(rel(big.M, Mch) < 1e-3 && big.R < 3e4, `x_c = 1000: M = ${big.M.toFixed(5)}, R = ${(big.R / 1e3).toFixed(1)} km`);
ok(rel(big.omega, om3) < 1e-3, `exact solver omega at x_c = 1000: ${big.omega.toFixed(5)} -> omega_3`);

const sb = P.STARS[0], m = P.dwarfOfMass(sb.M);
ok(rel(m.R / P.K.Rsun, sb.R) < 0.03, `Sirius B: model R = ${(m.R / P.K.Rsun).toFixed(6)} Rsun vs ${sb.R} (${(100 * (m.R / P.K.Rsun / sb.R - 1)).toFixed(2)} %), rho_c ${m.rhoc.toExponential(2)} kg/m^3`);

const a = P.whiteDwarf(0.01), b = P.whiteDwarf(0.02);
const slope = Math.log(b.R / a.R) / Math.log(b.M / a.M);
ok(Math.abs(slope + 1 / 3) < 0.005, `low-mass slope d ln R / d ln M = ${slope.toFixed(4)}`);
const nr = P.radiusNR(a.M);
ok(rel(nr, a.R) < 0.01, `n = 1.5 polytrope radius matches the exact model at x_c = 0.01 (${(100 * rel(nr, a.R)).toFixed(2)} %)`);

for (const mode of ['profile', 'uniform']) {
  const E = P.energyModel(2, mode);
  const want = mode === 'profile' ? Mch : Mch * 1.1994;
  ok(rel(E.Mcrit, want) < 2e-3, `E(R) ${mode}: critical mass ${E.Mcrit.toFixed(4)} Msun`);
  ok(E.minimum(0.8 * E.Mcrit) && !E.minimum(1.02 * E.Mcrit), `E(R) ${mode}: minimum at 0.8 M_crit (R = ${(E.minimum(0.8 * E.Mcrit).R / 1e3).toFixed(0)} km), none at 1.02 M_crit`);
}

const eos = P.eos(2);
ok(Math.abs(eos.Gamma(1e-4) - 5 / 3) < 1e-6 && Math.abs(eos.Gamma(1e4) - 4 / 3) < 1e-4, `Gamma: ${eos.Gamma(1e-4).toFixed(5)} -> ${eos.Gamma(1e4).toFixed(5)}`);
ok(rel(eos.f(1.5e-3), (8 / 5) * 1.5e-3 ** 5) < 1e-3, 'f(x) series agrees with the closed form at x = 1.5e-3');

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
