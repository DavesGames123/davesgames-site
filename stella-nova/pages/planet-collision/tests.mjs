// ============================================================================
//  PLANET COLLISION  ·  tests.mjs — checks of the EOS, the bodies, the CPU
//  solver and the GPU solver
// ----------------------------------------------------------------------------
//  node stella-nova/pages/planet-collision/tests.mjs         CPU tests
//
//  1  Tillotson EOS (SI) against its published properties: P(rho0, 0) = 0,
//     bulk modulus A at rho0, Grueneisen a + b, the ideal-gas limit a, a
//     hand value for iron, continuity at Eiv and Ecv, u_cold against a
//     numerical integral, the sound speed at rho0
//  2  hydrostatic bodies: every data.js body solves with its real mass; its
//     model radius is within 8 % of the real one (printed per body)
//  3  particles: counts, mass, layer shares, inside the model radius
//  4  impact geometry: the point-mass orbit from d0 meets at contact with
//     the asked speed and impact parameter; centre of mass at rest at 0
//  5  a settled spinning body (CPU, Earth, N 1200): radius kept, energy,
//     momentum and angular momentum conserved (KG = 1)
//  6  two bodies merge (CPU, Mars + half Mars, head-on at v_esc): the
//     bound remnant holds > 95 % of the mass, no NaN, mass sum exact,
//     energy kept through the impact
//  7  presets: every preset builds, sources given, contact in 1-20 min of
//     sim time
//
//  Each test prints PASS or FAIL with its numbers. Exit code 1 on a FAIL.
// ============================================================================
import { MATERIALS, BODIES, UNIT } from './data.js';
import { tillotson, soundSpeed, uCold, matSI } from './eos.js';
import { profile, bodyParticles, impactGeometry, buildScenario, rng } from './build.js';
import { CpuSPH, makeParams, boundMass } from './sph.js';
import { PRESETS, randomScenario } from './scenarios.js';

const ARGS = typeof Deno !== 'undefined' ? Deno.args : process.argv.slice(2);
const GPU_ONLY = false;
let fails = 0;
const ok = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}  ${info}`); if (!cond) fails++; };
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);

function eosTests() {
  const M = Object.fromEntries(Object.entries(MATERIALS).map(([k, r]) => [k, matSI(r)]));
  let worst = 0;
  for (const m of Object.values(M)) worst = Math.max(worst, Math.abs(tillotson(m, m.rho0, 0)));
  ok('1 P(rho0, u = 0) = 0', worst === 0, `max |P| ${worst} Pa`);
  let eK = 0, eG = 0, eI = 0, eC = 0;
  for (const m of Object.values(M)) {
    const d = 1e-7, K = (tillotson(m, m.rho0 * (1 + d), 0) - tillotson(m, m.rho0, 0)) / d;
    eK = Math.max(eK, rel(K, m.A));
    const du = 1e-3 * m.Eiv, G = (tillotson(m, m.rho0, du) - tillotson(m, m.rho0, 0)) / du / m.rho0;
    eG = Math.max(eG, rel(G, m.a + m.b));
    const rho = 1e-4 * m.rho0, u = 3 * m.Ecv, gas = tillotson(m, rho, u) / (rho * u);
    eI = Math.max(eI, rel(gas, m.a));
    eC = Math.max(eC, rel(soundSpeed(m, m.rho0, 0), Math.sqrt(m.A / m.rho0)));
  }
  ok('1 bulk modulus at rho0 = A', eK < 1e-5, `max rel err ${eK.toExponential(2)}`);
  ok('1 Grueneisen (1/rho) dP/du at rho0 = a + b', eG < 1e-3, `max rel err ${eG.toExponential(2)}`);
  ok('1 expanded hot limit P / (rho u) = a (ideal gas)', eI < 1e-3, `max rel err ${eI.toExponential(2)}`);
  ok('1 sound speed at rho0, u = 0 is sqrt(A / rho0)', eC < 2e-3, `max rel err ${eC.toExponential(2)} (granite ${soundSpeed(M.granite, 2680, 0).toFixed(0)} m/s)`);
  // a hand value: iron at eta 1.5, u = 1 MJ/kg (Melosh 1989 eq. AII.1 with table AII.3)
  //   w = 1e6 / (9.5e6 * 2.25) + 1 = 1.046784; (0.5 + 1.5 / w) * 11700 * 1e6 = 2.26156e10
  //   + 1.28e11 * 0.5 + 1.05e11 * 0.25  ->  1.128656e11 Pa
  const Pfe = tillotson(M.iron, 11700, 1e6);
  ok('1 iron at 11700 kg/m^3, 1 MJ/kg = 112.87 GPa (hand value)', rel(Pfe, 1.128656e11) < 1e-5, `${(Pfe / 1e9).toFixed(3)} GPa`);
  let jump = 0;
  for (const m of Object.values(M)) for (const u of [m.Eiv, m.Ecv]) {
    const a = tillotson(m, 0.8 * m.rho0, u * (1 - 1e-9)), b = tillotson(m, 0.8 * m.rho0, u * (1 + 1e-9));
    jump = Math.max(jump, Math.abs(a - b) / Math.max(1, Math.abs(a)));
  }
  ok('1 continuous across Eiv and Ecv (eta 0.8)', jump < 1e-6, `max rel jump ${jump.toExponential(2)}`);
  { const m = M.iron, eta = 1.4, n = 2000; let s = 0;
    for (let k = 0; k <= n; k++) { const e = 1 + (eta - 1) * k / n, mu = e - 1, f = (m.A * mu + m.B * mu * mu) / (m.rho0 * e * e) * (m.rho0 * (eta - 1) / n) / m.rho0 * m.rho0 / m.rho0; const w = k === 0 || k === n ? 1 : (k % 2 ? 4 : 2); s += w * f; }
    s /= 3; s *= m.rho0 / m.rho0;
    // integrand (A mu + B mu^2) / rho^2 d rho with rho = rho0 e: = (A mu + B mu^2) / (rho0 e^2) de
    let s2 = 0; for (let k = 0; k <= n; k++) { const e = 1 + (eta - 1) * k / n, mu = e - 1, w = k === 0 || k === n ? 1 : (k % 2 ? 4 : 2); s2 += w * (m.A * mu + m.B * mu * mu) / (m.rho0 * e * e); }
    s2 *= (eta - 1) / n / 3;
    ok('1 u_cold = integral of P_cold / rho^2', rel(uCold(m, eta), s2) < 1e-8, `iron eta 1.4: ${(uCold(m, eta) / 1e6).toFixed(4)} MJ/kg, Simpson ${(s2 / 1e6).toFixed(4)}`); }
}

function bodyTests() {
  const rows = [];
  let worst = 0, massErr = 0;
  for (const [k, b] of Object.entries(BODIES)) {
    const p = profile(b);
    massErr = Math.max(massErr, rel(p.m[p.m.length - 1], b.mass / UNIT.M));
    if (b.radius) { const e = p.R * UNIT.L / b.radius - 1; worst = Math.max(worst, Math.abs(e)); rows.push(`${k} ${(p.R * UNIT.L / 1e3).toFixed(0)}/${(b.radius / 1e3).toFixed(0)} km`); }
  }
  ok('2 hydrostatic bodies: real mass', massErr < 1e-9, `max rel err ${massErr.toExponential(1)}`);
  ok('2 model radius within 8 % of the real radius', worst < 0.08, `worst ${(100 * worst).toFixed(1)} %: ${rows.join(', ')}`);
  const e = profile(BODIES.earth);
  console.log(`INFO  Earth model: centre ${(e.Pc * UNIT.P / 1e9).toFixed(0)} GPa (PREM 364 GPa), core edge ${(e.edges[0] * UNIT.L / 1e3).toFixed(0)} km (PREM 3480 km): Tillotson iron is too soft at core pressures`);
  // particles
  const R = rng(3), n = 3000, pt = bodyParticles(e, n, R);
  let ms = 0, rmax = 0, core = 0;
  for (let i = 0; i < n; i++) { ms += pt.mp; rmax = Math.max(rmax, Math.hypot(pt.pos[3 * i], pt.pos[3 * i + 1], pt.pos[3 * i + 2])); if (pt.mat[i] === 0) core++; }
  ok('3 particles: count, mass, core share, inside R', pt.n === n && rel(ms, e.M) < 1e-12 && Math.abs(core / n - 0.325) < 0.01 && rmax <= e.R, `n ${pt.n}, core ${(core / n).toFixed(4)} (0.325), r_max/R ${(rmax / e.R).toFixed(4)}`);
}

function geometryTests() {
  let worst = '', bad = 0;
  for (const [vRel, b] of [[1, 0], [1, 0.7], [1.5, 0.5], [2.5, 0.9], [0.9, 0.3]]) {
    const g = impactGeometry(1, 0.12, 0.94, 0.53, { vRel, b, d0: 1.6 });
    const Mt = 1.12, Rs = 1.47;
    let s = [g.X[1][0] - g.X[0][0], g.X[1][1] - g.X[0][1], g.V[1][0] - g.V[0][0], g.V[1][1] - g.V[0][1]];
    const f = q => { const r = Math.hypot(q[0], q[1]), k = -Mt / r ** 3; return [q[2], q[3], k * q[0], k * q[1]]; };
    for (let it = 0; it < 1e6 && Math.hypot(s[0], s[1]) > Rs; it++) {
      const h = 2e-5;
      const k1 = f(s), k2 = f(s.map((x, j) => x + h / 2 * k1[j])), k3 = f(s.map((x, j) => x + h / 2 * k2[j])), k4 = f(s.map((x, j) => x + h * k3[j]));
      s = s.map((x, j) => x + h / 6 * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
    }
    const r = Math.hypot(s[0], s[1]), v = Math.hypot(s[2], s[3]), bb = Math.abs(s[0] * s[3] - s[1] * s[2]) / (r * v);
    const P = [0, 1].map(c => 1 * g.V[0][c] + 0.12 * g.V[1][c]), X = [0, 1].map(c => 1 * g.X[0][c] + 0.12 * g.X[1][c]);
    const e = Math.max(rel(v, g.vImp), Math.abs(bb - b), Math.hypot(...P), Math.hypot(...X));
    if (e > 1e-4) bad++;
    worst += ` [${vRel}, ${b}] v ${(v / g.vImp).toFixed(5)} b ${bb.toFixed(4)}`;
  }
  ok('4 impact geometry: contact speed and impact parameter, COM at rest', bad === 0, worst.trim());
}

function settledEarth(N, seed) {
  const st = buildScenario({ bodies: [{ key: 'earth', spinH: 10 }], impact: {} }, N, seed);
  const prm = makeParams(st, { KG: 1 });
  const s = new CpuSPH(st, prm);
  s.relax(120);
  return { st, prm, s };
}
function cpuTests() {
  const t0 = Date.now();
  { const { s } = settledEarth(1200, 3);
    const r90 = () => { const r = []; for (let i = 0; i < s.N; i++) r.push(Math.hypot(s.x[3 * i], s.x[3 * i + 1], s.x[3 * i + 2])); r.sort((a, b) => a - b); return r[Math.floor(0.9 * s.N)]; };
    s.launch();
    const R0 = r90(), E0 = s.energy(), M0 = s.momentum();
    s.run(250);
    const E = s.energy(), M = s.momentum(), R1 = r90();
    const Mtot = s.m.reduce((a, b) => a + b, 0), L0 = Math.hypot(...M0.L);
    ok('5 settled body keeps its radius (250 steps, spin 10 h)', Math.abs(R1 / R0 - 1) < 0.03, `r90 ${R0.toFixed(4)} -> ${R1.toFixed(4)} R_E, sim time ${(s.t * UNIT.T / 3600).toFixed(2)} h`);
    ok('5 energy conserved (KG = 1)', Math.abs(E.E - E0.E) / Math.abs(E0.W) < 1e-4, `|dE|/|W| ${(Math.abs(E.E - E0.E) / Math.abs(E0.W)).toExponential(2)} (K ${E0.K.toExponential(3)} -> ${E.K.toExponential(3)})`);
    const dP = Math.hypot(M.P[0] - M0.P[0], M.P[1] - M0.P[1], M.P[2] - M0.P[2]) / Mtot;
    ok('5 momentum and angular momentum conserved', dP < 1e-12 && Math.hypot(M.L[0] - M0.L[0], M.L[1] - M0.L[1], M.L[2] - M0.L[2]) / L0 < 1e-3,
      `|dP|/M ${dP.toExponential(1)} R_E/T, |dL|/|L| ${(Math.hypot(M.L[0] - M0.L[0], M.L[1] - M0.L[1], M.L[2] - M0.L[2]) / L0).toExponential(2)}`); }
  { const sc = { bodies: [{ key: 'mars' }, { key: 'mars', massScale: 0.5 }], impact: { vRel: 1.0, b: 0, d0: 1.3 }, fmin: 0.3 };
    const st = buildScenario(sc, 700, 5), prm = makeParams(st, { KG: 1 }), s = new CpuSPH(st, prm);
    s.relax(80); s.launch();
    const E0 = s.energy(), M0 = s.m.reduce((a, b) => a + b, 0);
    let Tmax = 0;
    while (s.t < 10) { s.run(25); for (let i = 0; i < s.N; i++) Tmax = Math.max(Tmax, s.T[i]); }
    const E = s.energy(), bm = boundMass(s.x, s.v, s.m, s.phi, s.N);
    let nan = 0; for (let i = 0; i < 3 * s.N; i++) if (!Number.isFinite(s.x[i]) || !Number.isFinite(s.v[i])) nan++;
    const M1 = s.m.reduce((a, b) => a + b, 0);
    ok('6 two bodies merge: bound remnant > 95 % of the mass', bm.M / M1 > 0.95 && nan === 0 && M1 === M0, `bound ${(100 * bm.M / M1).toFixed(2)} %, NaN ${nan}, mass sum ${M1 === M0 ? 'exact' : M1 / M0}, peak T ${Tmax.toFixed(0)} K, ${(s.t * UNIT.T / 3600).toFixed(2)} h`);
    ok('6 energy kept through the impact (KG = 1)', Math.abs(E.E - E0.E) / Math.abs(E0.W) < 5e-3, `|dE|/|W| ${(Math.abs(E.E - E0.E) / Math.abs(E0.W)).toExponential(2)}, u ${E0.U.toExponential(2)} -> ${E.U.toExponential(2)}`); }
  console.log(`INFO  CPU solver tests: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

async function presetTests() {
  let bad = [], minT = Infinity, maxT = 0;
  for (const p of [...PRESETS, randomScenario(1), randomScenario(2), randomScenario(99)]) {
    const s = buildScenario(p, 8192, 1), tc = s.impact.tContact * UNIT.T / 60;
    minT = Math.min(minT, tc); maxT = Math.max(maxT, tc);
    if (!p.src || !p.title || s.N !== 8192 || !(tc > 1 && tc < 20) || s.bodies.some(b => b.n < 400)) bad.push(p.key);
  }
  ok('7 presets build, with sources, contact in 1-20 min', bad.length === 0, `${PRESETS.length} presets, contact ${minT.toFixed(1)}-${maxT.toFixed(1)} min${bad.length ? ', bad: ' + bad.join(' ') : ''}`);
}

if (!GPU_ONLY) {
  eosTests(); bodyTests(); geometryTests(); await presetTests(); cpuTests();
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
if (typeof Deno !== 'undefined') { if (fails) Deno.exit(1); }
else process.exitCode = fails ? 1 : 0;
