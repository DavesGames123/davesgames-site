// ============================================================================
//  PLANET COLLISION  ·  tests.mjs — checks of the EOS, the bodies, the CPU
//  solver and the GPU solver
// ----------------------------------------------------------------------------
//  node stella-nova/pages/planet-collision/tests.mjs         CPU tests, then
//                                                            the GPU tests in Deno
//  deno run -A stella-nova/pages/planet-collision/tests.mjs --gpu          GPU only
//  deno run -A stella-nova/pages/planet-collision/tests.mjs --gpu --time   + timing
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
//  7  presets and budget: every preset builds, sources given, contact in
//     1-20 min of sim time; profile bytes under LIMIT; phones <= 12288
//  8  WGSL text: no line mixes && with || (Tint precedence rule)
//  G  GPU (Deno WebGPU): primed fields = CPU (rho, P, c, Balsara, a, du, g,
//     phi, T, hNext, nOther); 20 steps = CPU; energy over 300 steps; the
//     relax and launch; stats counters; no validation errors. --time: the
//     ms per step at 16k, 32k, 49k
//
//  Each test prints PASS or FAIL with its numbers. Exit code 1 on a FAIL.
// ============================================================================
import { MATERIALS, BODIES, UNIT } from './data.js';
import { tillotson, soundSpeed, uCold, matSI } from './eos.js';
import { profile, bodyParticles, impactGeometry, buildScenario, rng } from './build.js';
import { CpuSPH, makeParams, boundMass } from './sph.js';
import { PRESETS, randomScenario } from './scenarios.js';
import * as BG from './budget.js';

const ARGS = typeof Deno !== 'undefined' ? Deno.args : process.argv.slice(2);
const GPU_ONLY = ARGS.includes('--gpu');
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
  let over = [];
  for (const [k, p] of Object.entries(BG.PROFILES)) { const lim = k.startsWith('phone') ? BG.LIMIT.touch : BG.LIMIT.desktop; if (BG.gpuBytes(p.N) > lim) over.push(k); }
  const ph = BG.pickProfile({ phone: true });
  ok('7 profile bytes under LIMIT; a phone gets <= 12288', over.length === 0 && ph.N <= 12288, `phone ${ph.N} (${(BG.gpuBytes(ph.N) / 1e6).toFixed(1)} MB), desktop ${BG.pickProfile({}).N}${over.length ? ', over: ' + over.join(' ') : ''}`);
  const fs = await import('node:fs');
  const w = fs.readFileSync(new URL('./shaders/sph.wgsl', import.meta.url), 'utf8').split('\n');
  const mix = w.map((l, i) => [l, i + 1]).filter(([l]) => !l.trim().startsWith('//') && l.includes('&&') && l.includes('||'));
  ok('8 WGSL: no line mixes && with ||', mix.length === 0, mix.map(m => 'line ' + m[1]).join(', ') || 'none');
}

// G ─ GPU against CPU (Deno WebGPU)
async function gpuTests() {
  if (typeof navigator === 'undefined' || !navigator.gpu) { console.log('SKIP  GPU tests: no navigator.gpu here'); return; }
  const { SphGPU } = await import('./engine.js');
  const code = await Deno.readTextFile(new URL('./shaders/sph.wgsl', import.meta.url));
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) { console.log('SKIP  GPU tests: no adapter'); return; }
  const device = await adapter.requestDevice();
  const errs = []; device.addEventListener?.('uncapturederror', e => errs.push(String(e.error?.message || e)));
  // two bodies in contact range, with a velocity field, so every term acts
  const st = buildScenario({ bodies: [{ key: 'mars' }, { key: 'moon' }], impact: { vRel: 1.2, b: 0.5, d0: 1.02 } }, 1500, 4);
  for (let i = 0; i < 3 * st.N; i++) st.vel[i] = 0.05 * Math.sin(i * 1.7);
  const prm = makeParams(st, { KG: 1 });
  const cpu = new CpuSPH(st, prm); cpu.prime();
  const g = await SphGPU.create(device, 2048, code); g.upload(st, prm); g.prime();
  const rb = await g.readback(['pos', 'vel', 'th', 'aux', 'acc', 'grav', 'uu']);
  const err = (f, fc) => { let n = 0, d = 0; for (let i = 0; i < st.N; i++) { const a = f(i), b = fc(i); n += (a - b) ** 2; d += b * b; } return Math.sqrt(n / d); };
  const E = {
    rho: err(i => rb.th[4 * i], i => cpu.rho[i]), P: err(i => rb.th[4 * i + 1], i => cpu.P[i]), c: err(i => rb.th[4 * i + 2], i => cpu.cs[i]),
    bal: err(i => rb.th[4 * i + 3], i => cpu.bal[i]), a: err(i => rb.acc[4 * i], i => cpu.a[3 * i]), du: err(i => rb.acc[4 * i + 3], i => cpu.du[i]),
    g: err(i => rb.grav[8 * i + 1], i => cpu.g[3 * i + 1]), phi: err(i => rb.grav[8 * i + 3], i => cpu.phi[i]),
    T: err(i => rb.aux[4 * i], i => cpu.T[i]), hN: err(i => rb.aux[4 * i + 1], i => cpu.hn[i]),
  };
  let nOd = 0, nOs = 0; for (let i = 0; i < st.N; i++) { nOd = Math.max(nOd, Math.abs(rb.aux[4 * i + 2] - cpu.nOther[i])); nOs += cpu.nOther[i]; }
  const eMax = Math.max(...Object.values(E));
  ok('G primed fields = CPU (1500 particles, bodies in contact)', eMax < 1e-4 && nOd === 0 && nOs > 0, Object.entries(E).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ') + `; nOther exact (${nOs} cross pairs)`);
  ok('G first time step = CPU', rel(rb.ctl.dt, cpu.dt) < 1e-4, `GPU ${rb.ctl.dt.toExponential(5)} CPU ${cpu.dt.toExponential(5)}`);
  cpu.run(20); g.step(20);
  const r2 = await g.readback(['pos', 'vel']);
  let dx = 0; for (let i = 0; i < st.N; i++) for (let c = 0; c < 3; c++) dx = Math.max(dx, Math.abs(r2.pos[4 * i + c] - cpu.x[3 * i + c]));
  ok('G 20 steps = CPU', dx < 1e-5 && rel(r2.ctl.t, cpu.t) < 1e-4, `max |dx| ${dx.toExponential(2)} R_E (h ${prm.hmax.toFixed(3)}), t GPU ${r2.ctl.t.toFixed(6)} CPU ${cpu.t.toFixed(6)}`);
  g.destroy();
  // energy over 300 steps of a spinning settled body, relax and launch on the GPU
  { const st2 = buildScenario({ bodies: [{ key: 'earth', spinH: 8 }], impact: {} }, 4000, 9), p2 = makeParams(st2, { KG: 1 });
    const G = await SphGPU.create(device, 4096, code); G.upload(st2, p2);
    for (let k = 0; k < 6; k++) G.relaxSteps(25);
    G.launch();
    const en = r => { let K = 0, U = 0, W = 0, Lz = 0; for (let i = 0; i < G.n; i++) { const m = r.vel[4 * i + 3]; K += 0.5 * m * (r.vel[4 * i] ** 2 + r.vel[4 * i + 1] ** 2 + r.vel[4 * i + 2] ** 2); U += m * r.uu[i]; W += 0.5 * m * r.grav[8 * i + 3]; Lz += m * (r.pos[4 * i] * r.vel[4 * i + 1] - r.pos[4 * i + 1] * r.vel[4 * i]); } return { K, U, W, E: K + U + W, Lz }; };
    const a = await G.readback(['pos', 'vel', 'uu', 'grav']), A = en(a);
    // launched spin: v = W x r about the body centre (X = 0)
    const w = p2.bodies[0].W[2]; let sv = 0; for (let i = 0; i < G.n; i++) sv = Math.max(sv, Math.abs(a.vel[4 * i] + w * a.pos[4 * i + 1]) + Math.abs(a.vel[4 * i + 1] - w * a.pos[4 * i]));
    ok('G launch gives v = W x r', sv < 1e-5, `max |v - W x r| ${sv.toExponential(2)}, spin 8 h`);
    for (let k = 0; k < 6; k++) G.step(50);
    const b = await G.readback(['pos', 'vel', 'uu', 'grav']), B = en(b);
    ok('G energy and L_z over 300 GPU steps (KG = 1)', Math.abs(B.E - A.E) / Math.abs(A.W) < 1e-4 && Math.abs(B.Lz - A.Lz) / Math.abs(A.Lz) < 1e-3,
      `|dE|/|W| ${(Math.abs(B.E - A.E) / Math.abs(A.W)).toExponential(2)}, |dLz|/|Lz| ${(Math.abs(B.Lz - A.Lz) / Math.abs(A.Lz)).toExponential(2)}, ${(b.ctl.t * UNIT.T / 3600).toFixed(2)} h`);
    const S = await G.stats();
    let cx = 0; for (let i = 0; i < G.n; i++) cx += b.pos[4 * i];
    ok('G stats: counts, centre, nothing unbound, no melt', S.count[0] === G.n && S.unbound[0] === 0 && Math.abs(S.com[0][0] - cx / G.n) < 0.01 && S.melt === 0,
      `count ${S.count[0]}, com x ${S.com[0][0].toFixed(4)} (readback ${(cx / G.n).toFixed(4)}), unbound ${S.unbound[0]}, melt ${S.melt}, max T ${S.maxT.toFixed(0)} K, max P ${S.maxPGPa.toFixed(0)} GPa`);
    G.destroy(); }
  if (ARGS.includes('--time')) {
    for (const N of [16384, 32768, 49152]) {
      const s3 = buildScenario(PRESETS[0], N, 2), p3 = makeParams(s3, { KG: 4 });
      const G = await SphGPU.create(device, N, code); G.upload(s3, p3); G.relaxSteps(8); G.launch(); await G.stats();
      const t0 = performance.now(); G.step(40); await G.stats();
      console.log(`INFO  ${N} particles, KG 4: ${((performance.now() - t0) / 40).toFixed(2)} ms per step (${adapter.info?.description || 'adapter'})`);
      G.destroy();
    }
  }
  ok('G no WebGPU validation errors', errs.length === 0, errs.slice(0, 3).join(' | ') || 'none');
  device.destroy();
}

if (!GPU_ONLY) {
  eosTests(); bodyTests(); geometryTests(); await presetTests(); cpuTests();
}
if (typeof Deno !== 'undefined') await gpuTests();
else {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const d = spawnSync('deno', ['run', '-A', fileURLToPath(import.meta.url), '--gpu'], { encoding: 'utf8' });
  if (d.error) console.log('SKIP  GPU tests: deno is not installed (' + d.error.code + ')');
  else { process.stdout.write(d.stdout); if (d.stderr.trim()) process.stdout.write(d.stderr); if (d.status !== 0) fails++; }
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
if (typeof Deno !== 'undefined') { if (fails) Deno.exit(1); }
else process.exitCode = fails ? 1 : 0;
