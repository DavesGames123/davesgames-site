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
//  8  WGSL text: no line of any shader mixes && with || (Tint precedence
//     rule); naga validates each module (render shaders after common.wgsl)
//  G  GPU (Deno WebGPU): primed fields = CPU (rho, P, c, Balsara, a, du, g,
//     phi, T, hNext, nOther); 20 steps = CPU; energy over 300 steps; the
//     relax and launch; stats counters; no validation errors. --time: the
//     ms per step at 16k, 32k, 49k
//  R  the renderer (Deno WebGPU, an offscreen texture, no browser and no
//     image file): every shader compiles clean; before contact the target
//     fills its disc and the sky round it is dark, with no glow; the
//     bilateral filter makes the depth smooth and keeps the silhouette; a
//     grazing hit makes debris (fn classify) and glowing pixels; the colour
//     modes and the cutaway change the image; no validation errors.
//     --time also prints ms per frame
//  P  the page (Deno, main.js with the DOM stubbed and an offscreen
//     texture for the canvas): boot, the relax, the launch, first contact
//     (the flash and the fades), the numbers, a preset change, a random
//     draw, pagehide; no errors
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
  const files = fs.readdirSync(new URL('./shaders/', import.meta.url)).filter(f => f.endsWith('.wgsl')).sort();
  const mix = [];
  for (const f of files) {
    const w = fs.readFileSync(new URL('./shaders/' + f, import.meta.url), 'utf8').split('\n');
    w.forEach((l, i) => { if (!l.trim().startsWith('//') && l.includes('&&') && l.includes('||')) mix.push(f + ':' + (i + 1)); });
  }
  ok('8 WGSL: no line mixes && with ||', mix.length === 0, mix.join(', ') || `none in ${files.length} files`);
  // naga on each module as the GPU sees it (render shaders after common.wgsl)
  const naga = (await import('node:os')).homedir() + '/.cargo/bin/naga';
  if (fs.existsSync(naga)) {
    const { spawnSync } = await import('node:child_process');
    const tmp = fs.mkdtempSync((await import('node:os')).tmpdir() + '/pc-naga-'), bad = [];
    const src = f => fs.readFileSync(new URL('./shaders/' + f, import.meta.url), 'utf8');
    for (const f of files.filter(f => f !== 'common.wgsl')) {
      const code = ['fluid.wgsl', 'smooth.wgsl', 'shade.wgsl', 'debris.wgsl'].includes(f) ? src('common.wgsl') + '\n' + src(f) : src(f);
      fs.writeFileSync(tmp + '/' + f, code);
      const r = spawnSync(naga, [tmp + '/' + f], { encoding: 'utf8' });
      if (r.status !== 0) bad.push(f + ': ' + (r.stderr || r.stdout).trim().split('\n').slice(0, 3).join(' '));
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    ok('8 naga validates every shader module', bad.length === 0, bad.join(' | ') || files.filter(f => f !== 'common.wgsl').join(', '));
  } else console.log('SKIP  8 naga: ~/.cargo/bin/naga is not installed');
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

// R ─ the renderer (Deno WebGPU, offscreen)
async function renderTests() {
  if (typeof navigator === 'undefined' || !navigator.gpu) { console.log('SKIP  render tests: no navigator.gpu here'); return; }
  const { SphGPU } = await import('./engine.js');
  const { Renderer, loadRenderCode, defaultFrame, classify } = await import('./render.js');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) { console.log('SKIP  render tests: no adapter'); return; }
  const device = await adapter.requestDevice();
  const errs = []; device.addEventListener?.('uncapturederror', e => errs.push(String(e.error?.message || e)));
  const N = 8000, W = 320, H = 200;
  const sim = await SphGPU.create(device, N, await Deno.readTextFile(new URL('./shaders/sph.wgsl', import.meta.url)));
  const setup = buildScenario(PRESETS.find(p => p.key === 'moon-graze'), N, 3);
  sim.upload(setup, makeParams(setup, { KG: 4 }));
  for (let k = 0; k < 10; k++) sim.relaxSteps(20);
  sim.launch();
  const tex = device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const ren = new Renderer(device, { getCurrentTexture: () => tex }, 'rgba8unorm', await loadRenderCode(u => Deno.readTextFile(u)));
  const msgs = (await ren.compilationMessages()).filter(m => / error /.test(m));
  ok('R every render shader compiles with no error', msgs.length === 0, msgs.slice(0, 3).join(' | ') || 'common + fluid, smooth, shade, debris; centres; post');
  ren.attach(sim, setup); ren.resize(W, H);
  const readTex = async (t, bpp, w, h) => {
    const bpr = Math.ceil(w * bpp / 256) * 256, buf = device.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder(); enc.copyTextureToBuffer({ texture: t }, { buffer: buf, bytesPerRow: bpr }, [w, h]); device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ); const a = buf.getMappedRange().slice(0); buf.unmap(); buf.destroy(); return { a, bpr };
  };
  const rgb = async () => { const { a, bpr } = await readTex(tex, 4, W, H), px = new Uint8Array(a); return (x, y) => { const o = y * bpr + 4 * x; return [px[o], px[o + 1], px[o + 2]]; }; };
  const scan = at => { let glow = 0, lit = 0, s = [0, 0, 0]; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = at(x, y); if (c[0] > 150 && c[0] > c[1] + 30 && c[1] > c[2]) glow++; if (c[0] + c[1] + c[2] > 60) { lit++; s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; } } return { glow, lit, mean: s.map(v => lit ? v / lit : 0) }; };
  // before contact: look at the target from 4 radii, the impactor out of view
  const f = defaultFrame(), X0 = setup.bodies[0].X, R0 = setup.bodies[0].R;
  f.eye = [X0[0], X0[1] - 4 * R0, X0[2]]; f.target = X0; f.fov = 0.7;
  ren.render(f); let at = await rgb();
  const ctr = ren.project(X0, W, H), rpx = ren.focal * R0 / (4 * R0);
  const cIn = at(Math.round(ctr.x), Math.round(ctr.y)), cOut = at(Math.min(W - 1, Math.round(ctr.x + 1.35 * rpx)), Math.round(ctr.y));
  const pre = scan(at);
  ok('R before contact: the target fills its disc, dark sky outside, no glow', cIn[0] + cIn[1] + cIn[2] > 90 && cOut[0] + cOut[1] + cOut[2] < 60 && pre.glow === 0,
    `centre rgb ${cIn.join(',')}, 1.35 R out ${cOut.join(',')}, ${pre.glow} glowing px, disc ${rpx.toFixed(0)} px`);
  // the bilateral filter: depth roughness down, silhouette unchanged
  const zr = new Float32Array((await readTex(ren.rawZ, 8, W, H)).a), zs0 = await readTex(ren.smB, 4, W, H), zs = new Float32Array(zs0.a);
  const bprR = Math.ceil(W * 8 / 256) * 256 / 8, bprS = zs0.bpr / 4;
  let covR = 0, covS = 0, rough = [0, 0], cnt = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const r = k => zr[(y * bprR + x + k) * 2], s = k => zs[y * bprS + x + k];
    if (r(0) > 0) covR++; if (s(0) > 0) covS++;
    if (r(-1) > 0 && r(0) > 0 && r(1) > 0 && s(-1) > 0 && s(1) > 0) { rough[0] += Math.abs(r(-1) - 2 * r(0) + r(1)); rough[1] += Math.abs(s(-1) - 2 * s(0) + s(1)); cnt++; }
  }
  ok('R bilateral filter: depth roughness down, silhouette kept', rough[1] < 0.5 * rough[0] && covR === covS && cnt > 1000,
    `mean |d2z| raw ${(rough[0] / cnt).toExponential(2)} smoothed ${(rough[1] / cnt).toExponential(2)}; covered px ${covR} raw, ${covS} smoothed`);
  // run through the grazing hit; watch from the side
  f.eye = [0.6, -7, 2.0]; f.target = [0, 0, 0]; f.streakT = 0.05;
  let cls = null, st = null;
  for (let k = 0; k < 12; k++) { for (let j = 0; j < 10; j++) sim.step(20); st = await sim.stats(); if (st.tSec > 1.4 * 3600) break; }
  const rb = await sim.readback(['pos', 'vel', 'aux', 'tag']);
  cls = classify(rb, sim.n, sim.prm.hmax, f);
  ok('R a grazing hit makes debris fragments (fn classify)', cls.debris > 0.01 * sim.n && cls.fluid > 0.8 * sim.n,
    `t ${(st.tSec / 3600).toFixed(2)} h: fluid ${cls.fluid}, debris ${cls.debris}, vapour ${cls.vapour}`);
  ren.render(f); at = await rgb();
  const post = scan(at);
  ok('R after contact: hot melt glows (red > green > blue pixels)', post.glow > 20, `${post.glow} glowing px, ${post.lit} lit px`);
  const means = [];
  for (const m of [0, 1, 2, 3, 4]) { f.mode = m; ren.render(f); means.push(scan(await rgb()).mean); }
  let minD = 1e9; for (let i = 0; i < means.length; i++) for (let j = i + 1; j < means.length; j++) minD = Math.min(minD, Math.hypot(...means[i].map((v, c) => v - means[j][c])));
  ok('R the five colour modes give five different images', minD > 4, `smallest mean-colour distance ${minD.toFixed(1)}; means ${means.map(c => c.map(v => v.toFixed(0)).join('/')).join(' ')}`);
  f.mode = 0; f.cut = { on: true, n: [0, -1, 0], d: 0 };
  ren.render(f); const cut = scan(await rgb());
  ok('R the cutaway changes the image', Math.hypot(...cut.mean.map((v, c) => v - means[0][c])) > 3 || Math.abs(cut.lit - post.lit) > 200,
    `lit px ${post.lit} -> ${cut.lit}, mean ${means[0].map(v => v.toFixed(0)).join('/')} -> ${cut.mean.map(v => v.toFixed(0)).join('/')}`);
  if (ARGS.includes('--time')) {
    for (const [n, w, h] of [[32768, 1600, 900], [12288, 780, 1688]]) {
      const s2 = await SphGPU.create(device, n, await Deno.readTextFile(new URL('./shaders/sph.wgsl', import.meta.url)));
      const su = buildScenario(PRESETS[0], n, 2); s2.upload(su, makeParams(su, { KG: 4 })); s2.relaxSteps(5); s2.launch();
      const t2 = device.createTexture({ size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT });
      const r2 = new Renderer(device, { getCurrentTexture: () => t2 }, 'rgba8unorm', await loadRenderCode(u => Deno.readTextFile(u)));
      r2.attach(s2, su); r2.resize(w, h);
      const g = defaultFrame(); g.eye = [0.5, -4, 1]; g.streakT = 0.05;
      for (let k = 0; k < 3; k++) r2.render(g); await device.queue.onSubmittedWorkDone();
      const t0 = performance.now(); for (let k = 0; k < 20; k++) r2.render(g); await device.queue.onSubmittedWorkDone();
      console.log(`INFO  render ${n} particles at ${w}x${h}: ${((performance.now() - t0) / 20).toFixed(2)} ms per frame`);
      r2.destroy(); s2.destroy(); t2.destroy();
    }
  }
  ok('R no WebGPU validation errors', errs.length === 0, errs.slice(0, 3).join(' | ') || 'none');
  ren.destroy(); sim.destroy(); device.destroy();
}

// P ─ main.js in Deno with a stubbed DOM (no browser, no image file)
async function pageTest() {
  if (typeof navigator === 'undefined' || !navigator.gpu) { console.log('SKIP  page test: no navigator.gpu here'); return; }
  const els = new Map(), listeners = {}, errors = [];
  const el = id => {
    if (!els.has(id)) els.set(id, { id, hidden: false, textContent: '', innerHTML: '', value: '', style: {}, dataset: {}, width: 0, height: 0,
      classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, addEventListener() {}, setPointerCapture() {},
      querySelectorAll: () => [], getContext: () => ctxStub });
    return els.get(id);
  };
  let tex = null, device = null;
  const ctxStub = {
    configure(o) { device = o.device; tex = device.createTexture({ size: [320, 200], format: o.format, usage: GPUTextureUsage.RENDER_ATTACHMENT }); },
    getCurrentTexture: () => tex,
  };
  const rafQ = [];
  const G = globalThis, saved = {};
  const stub = { window: G, document: { getElementById: el }, matchMedia: () => ({ matches: false }), screen: { width: 1280, height: 800 },
    innerWidth: 320, innerHeight: 200, devicePixelRatio: 1, location: { href: 'http://x/pages/planet-collision/?run=moon-graze', search: '?run=moon-graze' },
    history: { replaceState() {} }, addEventListener: (k, f) => { (listeners[k] = listeners[k] || []).push(f); },
    requestAnimationFrame: f => rafQ.push(f), createImageBitmap: () => Promise.reject(new Error('no images in the test')) };
  for (const k of Object.keys(stub)) { saved[k] = Object.getOwnPropertyDescriptor(G, k); Object.defineProperty(G, k, { value: stub[k], configurable: true, writable: true }); }
  const realFetch = G.fetch;
  G.fetch = async url => { const u = String(url); if (u.endsWith('.jpg')) return { ok: false, status: 404 }; return { ok: true, text: () => Deno.readTextFile(new URL(u)) }; };
  const ce = console.error; console.error = (...a) => { errors.push(a.join(' ')); };
  try {
    await import('./main.js?page-test');
    for (let k = 0; k < 400 && !G.__pc?.S?.sim && !errors.length; k++) await new Promise(r => setTimeout(r, 50));
    if (!G.__pc) { ok('P boot', false, errors.slice(0, 3).join(' | ') || 'no window.__pc after 20 s'); return; }
    const S = G.__pc.S;
    let t = 0;
    const pump = async n => { for (let k = 0; k < n; k++) { const f = rafQ.shift(); if (!f) break; t += 16.7; f(t); if (k % 6 === 5) await S.dev.queue.onSubmittedWorkDone(); } await S.dev.queue.onSubmittedWorkDone(); await new Promise(r => setTimeout(r, 30)); };
    await pump(12);
    const relaxed = S.phase === 'run';
    for (let k = 0; k < 60 && !S.contact; k++) await pump(12);
    const c = S.contact, fl = S.f.flashes[0];
    await pump(30);
    ok('P boot, relax, launch, first contact with a flash', relaxed && !!c && !!fl && fl.r > 0 && S.f.bodies[0].shadow < 1,
      `phase ${S.phase}, contact at ${c ? (c.simT * UNIT.T / 60).toFixed(1) + ' min' : 'none'}, flash r ${fl ? fl.r.toFixed(3) : '-'}, shadow ${S.f.bodies[0].shadow.toFixed(2)}, ${S.sim.n} particles`);
    const nums = el('nums').innerHTML;
    ok('P the numbers fill in', /Molten/.test(nums) && /J</.test(nums) && el('capTitle').textContent.length > 0, `title "${el('capTitle').textContent}"; ${nums.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)}`);
    G.__pc.startRun((await import('./scenarios.js')).presetByKey('theia'), 1); await pump(14);
    G.__pc.startRun((await import('./scenarios.js')).randomScenario(77), 77); await pump(14);
    ok('P a preset change and a random draw run', S.sc.key === 'random-77' && S.phase === 'run', `now "${S.sc.title}", phase ${S.phase}`);
    for (const f of listeners.pagehide || []) f();
    ok('P pagehide frees the solver, the renderer and the device', S.sim === null && S.dev === null, 'sim, ren, dev null');
    ok('P no errors on the page', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');
  } finally {
    console.error = ce; G.fetch = realFetch;
    for (const k of Object.keys(stub)) { if (saved[k]) Object.defineProperty(G, k, saved[k]); else delete G[k]; }
  }
}

if (!GPU_ONLY) {
  eosTests(); bodyTests(); geometryTests(); await presetTests(); cpuTests();
}
if (typeof Deno !== 'undefined') { await gpuTests(); await renderTests(); await pageTest(); }
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
