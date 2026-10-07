// ============================================================================
//  ROCHE LIMIT  ·  tests.mjs — checks of the model, the CPU reference and GPU
// ----------------------------------------------------------------------------
//  node stella-nova/pages/roche-limit/tests.mjs          all CPU tests, then
//                                                       the GPU test in Deno
//  deno run -A stella-nova/pages/roche-limit/tests.mjs --gpu   GPU test only
//
//  1  Roche formulas against published values (Earth-Moon, Earth-comet,
//     Phobos, the Saturn A ring edge)
//  2  the tide formula against a direct f64 difference and the quadrupole
//  3  a two-body Kepler orbit in the moving frame: energy, angular momentum
//     and the period over 10 orbits; Kepler conic prediction closes
//  4  a gravitating pair (extrapolated self-gravity): energy over 10 orbits
//  5  the energy ledger E - W of an isolated pile; the bound mass search
//     when no grain stays bound; the friction spring of a sliding contact;
//     the torque balance of one contact
//  6  disruption at low N (CPU): a fluid pile at 0.6 d_fluid loses most of
//     its mass in 3 orbits, at 1.5 d_fluid it keeps it
//  7  GPU (Deno WebGPU): forces of shaders/sim.wgsl against CpuSim for a
//     pile of 300 grains with every force term on, then 2 blocks of motion
//
//  Each test prints PASS or FAIL with its numbers. Exit code 1 on a FAIL.
//  Published values: Wikipedia "Roche limit", revision of 2020-12 (tables
//  "Roche limits for selected examples"), and the A ring outer edge
//  136,775 km (NASA Saturnian rings fact sheet).
// ============================================================================
import * as P from './physics.js';

const GPU_ONLY = typeof Deno !== 'undefined' && Deno.args.includes('--gpu');
let fails = 0;
const ok = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}  ${info}`); if (!cond) fails++; };
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);

function settledPile(N, mat, seed = 7, time = 6) {
  const C = P.contactParams(N, mat);
  const cl = P.makeCloud(N, seed);
  const sim = new P.CpuSim(N, cl.rad, cl.mass, C, { GM: 0, Rp: 1 });
  sim.x.set(cl.pos); sim.init(null);
  const blocks = Math.ceil(time / (C.dt * P.K_STEP));
  for (let b = 0; b < blocks; b++) { sim.settleDrag = b < blocks * 0.8 ? 1.5 : 0; sim.block(C.dt); }
  sim.settleDrag = 0;
  return { C, cl, sim };
}

function cpuTests() {
  // 1 ─ Roche formulas
  const B = P.BODIES;
  const em_r = P.rocheRigid(B.earth.R, B.earth.rho, B.moon.rho), em_f = P.rocheFluid(B.earth.R, B.earth.rho, B.moon.rho);
  ok('Earth-Moon rigid limit', rel(em_r, 9492) < 1e-3, `${em_r.toFixed(0)} km vs 9,492 km`);
  ok('Earth-Moon fluid limit', rel(em_f, 18381) < 1e-3, `${em_f.toFixed(0)} km vs 18,381 km`);
  const ec_r = P.rocheRigid(B.earth.R, B.earth.rho, B.comet.rho), ec_f = P.rocheFluid(B.earth.R, B.earth.rho, B.comet.rho);
  ok('Earth-comet limits', rel(ec_r, 17887) < 1e-3 && rel(ec_f, 34638) < 1e-3, `${ec_r.toFixed(0)} / ${ec_f.toFixed(0)} km vs 17,887 / 34,638 km`);
  const ph_r = B.phobos.peri / P.rocheRigid(B.mars.R, B.mars.rho, B.phobos.rho), ph_f = B.phobos.peri / P.rocheFluid(B.mars.R, B.mars.rho, B.phobos.rho);
  ok('Phobos periapsis / Roche limit', Math.abs(ph_r - 1.72) < 0.05 && Math.abs(ph_f - 0.89) < 0.03, `${(100 * ph_r).toFixed(0)}% rigid, ${(100 * ph_f).toFixed(0)}% fluid vs 172% / 89%`);
  const sat_f = P.rocheFluid(B.saturn.R, B.saturn.rho, B.ice.rho);
  ok('Saturn: fluid limit of ice near the A ring edge', rel(sat_f, B.ringA.a) < 0.03, `${sat_f.toFixed(0)} km vs 136,775 km (${(100 * (sat_f / B.ringA.a - 1)).toFixed(1)}%)`);
  ok('rigid coefficient is 2^(1/3)', Math.abs(P.K_RIGID - 1.2599) < 1e-4, P.K_RIGID.toFixed(4));
  // the gauge: tide = self gravity exactly at the rigid limit
  { const Rp = 1, rhoP = 3, rhoS = 1.5, d = P.rocheRigid(Rp, rhoP, rhoS), r = 0.01;
    const g = P.tideGauge(rhoP * 4 / 3 * Math.PI * Rp ** 3, rhoS * 4 / 3 * Math.PI * r ** 3, r, d);
    ok('gauge ratio is 1 at d_rigid', Math.abs(g.ratio - 1) < 1e-12, g.ratio.toFixed(12)); }

  // 2 ─ tide formula
  { const GM = 7.3, X = [1234.5, -321.2, 40.1], x = [3.2, -1.1, 0.7], o = [0, 0, 0];
    P.tideAccel(GM, ...X, ...x, o);
    const R = X.map((q, k) => q + x[k]), r3 = Math.hypot(...R) ** 3, X3 = Math.hypot(...X) ** 3;
    const direct = [0, 1, 2].map(k => GM * (X[k] / X3 - R[k] / r3));
    const d = Math.hypot(...X), u = X.map(q => q / d), ux = u[0] * x[0] + u[1] * x[1] + u[2] * x[2];
    const quad = [0, 1, 2].map(k => GM / d ** 3 * (3 * ux * u[k] - x[k]));
    const e1 = Math.hypot(...o.map((q, k) => q - direct[k])) / Math.hypot(...direct);
    const e2 = Math.hypot(...o.map((q, k) => q - quad[k])) / Math.hypot(...quad);
    ok('tide: stable form = direct difference', e1 < 1e-9, `rel err ${e1.toExponential(2)}`);
    ok('tide: near the quadrupole 3(u.x)u - x', e2 < 1e-2, `rel diff ${e2.toExponential(2)} (|x|/d = ${(Math.hypot(...x) / d).toExponential(1)})`); }

  // 3 ─ Kepler orbit of one grain in the moving frame
  { const C = P.contactParams(400, P.MATERIALS.fluid);
    const pl = { GM: 5e6, Rp: 100, J2: 0, drag: 0 };
    const o = P.orbitStart(pl, { kind: 'circular', d: 3 });
    const g = new P.CpuSim(1, [1], [1], C, pl);
    g.v.set([0, 0.2 * o.V[1], 0]);
    const ref = new P.RefOrbit(pl, o.X, o.V); g.init(ref);
    const st = () => { const r = [ref.X[0] + g.x[0], ref.X[1] + g.x[1], ref.X[2] + g.x[2]], v = [ref.V[0] + g.v[0], ref.V[1] + g.v[1], ref.V[2] + g.v[2]]; return { r, v }; };
    const s0 = st(), el = P.keplerElements(s0.r, s0.v, pl.GM), T = P.orbitalPeriod(pl.GM, el.a);
    const E0 = P.energyOf(g.x, g.v, g.w, g.rad, g.mass, g.phi, ref.X, ref.V, pl.GM);
    const dt = T / 4000, K = 40, nb = Math.round(10 * T / (dt * K));
    for (let b = 0; b < nb; b++) g.block(dt, K, ref);
    const E1 = P.energyOf(g.x, g.v, g.w, g.rad, g.mass, g.phi, ref.X, ref.V, pl.GM);
    const s1 = st(), back = Math.hypot(s1.r[0] - s0.r[0], s1.r[1] - s0.r[1], s1.r[2] - s0.r[2]) / Math.hypot(...s0.r);
    ok('Kepler: energy over 10 orbits (e = ' + el.e.toFixed(2) + ')', rel(E1.E, E0.E) < 1e-6, `|dE/E| = ${rel(E1.E, E0.E).toExponential(2)}`);
    ok('Kepler: angular momentum over 10 orbits', rel(E1.L[2], E0.L[2]) < 1e-6, `|dL/L| = ${rel(E1.L[2], E0.L[2]).toExponential(2)}`);
    ok('Kepler: back at the start after 10 periods (leapfrog phase error)', back < 3e-3, `|dr|/r = ${back.toExponential(2)}`);
    const path = P.keplerPath(s0.r, s0.v, pl.GM, T, 65).pts;
    const close = Math.hypot(path[192] - path[0], path[193] - path[1], path[194] - path[2]) / Math.hypot(...s0.r);
    ok('Kepler conic: the predicted path closes after one period', close < 1e-9, `${close.toExponential(2)}`);
  }

  // 4 ─ a gravitating pair, gravity once per block (extrapolated)
  { const C = P.contactParams(400, P.MATERIALS.fluid);
    const m = P.RHO_GRAIN * 4 / 3 * Math.PI, sep = 12, w = Math.sqrt(2 * m / sep ** 3);
    const g = new P.CpuSim(2, [1, 1], [m, m], C, { GM: 0, Rp: 1 });
    g.x.set([sep / 2, 0, 0, -sep / 2, 0, 0]); g.v.set([0, w * sep / 2, 0, 0, -w * sep / 2, 0]);
    g.init(null);
    const E0 = P.energyOf(g.x, g.v, g.w, g.rad, g.mass, g.phi, [0, 0, 0], [0, 0, 0], 0);
    const T = 2 * Math.PI / w, nb = Math.round(10 * T / (C.dt * P.K_STEP));
    for (let b = 0; b < nb; b++) g.block(C.dt);
    const E1 = P.energyOf(g.x, g.v, g.w, g.rad, g.mass, g.phi, [0, 0, 0], [0, 0, 0], 0);
    const h = C.dt * P.K_STEP;
    ok('pair, gravity per block: energy over 10 orbits', rel(E1.E, E0.E) < 1e-4, `|dE/E| = ${rel(E1.E, E0.E).toExponential(2)}, h = T/${(T / h).toFixed(0)}`);
  }

  // 5 ─ energy ledger of an isolated pile
  { const { sim } = settledPile(400, P.MATERIALS.rigid, 3);
    const z = [0, 0, 0];
    let W0 = 0; for (const q of sim.work) W0 += q;
    const e0 = P.energyOf(sim.x, sim.v, sim.w, sim.rad, sim.mass, sim.phi, z, z, 0);
    // stir it: random velocities at 0.3 of the escape speed
    const r = P.rng(5); for (let i = 0; i < sim.v.length; i++) sim.v[i] += (r() - 0.5) * 0.6 * sim.C.vesc;
    const e1 = P.energyOf(sim.x, sim.v, sim.w, sim.rad, sim.mass, sim.phi, z, z, 0);
    for (let b = 0; b < 300; b++) sim.block(sim.C.dt);
    let W1 = 0; for (const q of sim.work) W1 += q;
    const e2 = P.energyOf(sim.x, sim.v, sim.w, sim.rad, sim.mass, sim.phi, z, z, 0);
    const drift = Math.abs((e2.E - W1) - (e1.E - W0)) / Math.abs(e0.Us);
    ok('ledger E - W of a stirred rough pile', drift < 1e-3, `|d(E-W)|/|U_self| = ${drift.toExponential(2)}; dissipated ${((e1.E - e2.E) / Math.abs(e0.Us)).toExponential(2)} |U_self|`);
  }

  // 5b ─ the bound mass search when no grain stays bound: two touching
  // grains that fly apart at 100x their mutual escape speed
  { const pos = [0, 0, 0, 2.0, 0, 0], vel = [0, 0, 0, 0, 500, 0], mass = [7, 7], rad = [1, 1];
    const an = P.analyzeBound(pos, vel, mass, rad, 3, [100, 0, 0], 1e6);
    ok('bound mass search: an unbound pair gives M = 0 and a finite centre', an.M === 0 && an.com.every(Number.isFinite), `M = ${an.M}, com = ${an.com.map(q => +q.toFixed(3)).join(', ')}`); }

  // 5c ─ a sliding contact: after the Coulomb cap, the friction spring
  // holds only the elastic part of the force (Luding 2008). The first
  // version stored the dashpot part too; a rough pile then gained energy
  // and angular momentum (rigid moon at 0.8 d_fluid: ledger 0.3 |U_self|).
  { const mat = P.MATERIALS.rigid, C = P.contactParams(400, mat);
    const m = P.RHO_GRAIN * 4 / 3 * Math.PI;
    const g = new P.CpuSim(2, [1, 1], [m, m], C, { GM: 0, Rp: 1 });
    g.x.set([0, 0, 0, 1.95, 0, 0]); g.v.set([0, 0, 0, 0, 40, 0]);
    g.buildNeighbors(); g.fast(C.dt, 0);
    const q = 0, xi = Math.hypot(g.xi[q], g.xi[q + 1], g.xi[q + 2]);
    const meff = m / 2, Fn = C.kn * 0.05, gt = C.gtK * Math.sqrt(meff), vt = 40;
    const want = Math.abs(C.mu * Fn - gt * vt) / C.kt;
    ok('sliding contact: the spring keeps the elastic part only', Math.abs(xi - want) < 1e-9 * Math.max(1, want), `k_t |xi| = ${(C.kt * xi).toFixed(3)}, mu F_n - g_t v_t = ${(C.kt * want).toFixed(3)}, mu F_n = ${(C.mu * Fn).toFixed(3)}`); }

  // 5d ─ angular momentum of one contact: x_i x F_i + x_j x F_j + tau_i +
  // tau_j = 0. Lever arms of r_i, r_j left -delta n x F_t, and a cohesive
  // pile (which keeps an overlap) drifted in L_z.
  { const mat = P.MATERIALS.cohesive, C = P.contactParams(400, mat);
    const m = P.RHO_GRAIN * 4 / 3 * Math.PI;
    const g = new P.CpuSim(2, [1, 0.9], [m, m * 0.729], C, { GM: 0, Rp: 1 });
    g.x.set([0, 0, 0, 1.75, 0.3, 0]); g.v.set([0, 0, 0, 0.2, 3, 1]); g.w.set([0.5, 0, 2, 0, -1, 0]);
    g.buildNeighbors(); g.fast(C.dt, 0);
    let T = [0, 0, 0], F = 0;
    for (let i = 0; i < 2; i++) {
      const x = [g.x[3 * i], g.x[3 * i + 1], g.x[3 * i + 2]], f = [g.fc[6 * i], g.fc[6 * i + 1], g.fc[6 * i + 2]];
      T[0] += x[1] * f[2] - x[2] * f[1] + g.fc[6 * i + 3]; T[1] += x[2] * f[0] - x[0] * f[2] + g.fc[6 * i + 4]; T[2] += x[0] * f[1] - x[1] * f[0] + g.fc[6 * i + 5];
      F = Math.max(F, Math.hypot(...f));
    }
    const rel = Math.hypot(...T) / F;
    ok('one contact keeps the angular momentum (torque sum / |F|)', rel < 1e-12, `${rel.toExponential(2)} (overlap ${(1.9 - Math.hypot(1.75, 0.3)).toFixed(3)})`); }

  // 6 ─ disruption at low N
  { const N = 400, { C, cl, sim } = settledPile(N, P.MATERIALS.fluid, 7);
    const st = P.pileStats(sim.x, sim.mass);
    const run = f => {
      const spec = { kind: 'circular', q: 1, s: 0.08 };
      const pl = P.planetFor(st, spec);
      spec.d = f * P.rocheFluid(pl.Rp, pl.rhoP, pl.rhoS) / pl.Rp;
      const o = P.orbitStart(pl, spec);
      const s2 = new P.CpuSim(N, cl.rad, cl.mass, C, pl);
      s2.x.set(sim.x); P.placeOnOrbit(s2.x, s2.v, s2.w, s2.mass, o.Omega);
      const ref = new P.RefOrbit(pl, o.X, o.V); s2.init(ref);
      const e0 = P.energyOf(s2.x, s2.v, s2.w, s2.rad, s2.mass, s2.phi, ref.X, ref.V, pl.GM);
      const T = P.orbitalPeriod(pl.GM, spec.d * pl.Rp), nb = Math.ceil(3 * T / (C.dt * P.K_STEP));
      for (let b = 0; b < nb; b++) s2.block(C.dt, P.K_STEP, ref);
      const an = P.analyzeBound(s2.x, s2.v, s2.mass, s2.rad, 3, ref.X, pl.GM);
      const e1 = P.energyOf(s2.x, s2.v, s2.w, s2.rad, s2.mass, s2.phi, ref.X, ref.V, pl.GM);
      let W = 0; for (const q of s2.work) W += q;
      return { f, d: spec.d, bound: an.M / st.M, drift: (e1.E - W - e0.E) / Math.abs(e0.Us), acc: s2.accreted || 0 };
    };
    const a = run(0.6), b = run(1.5);
    ok('disruption at 0.6 d_fluid (fluid pile, N = 400)', a.bound < 0.5, `d = ${a.d.toFixed(2)} R_p, bound ${(100 * a.bound).toFixed(1)}% after 3 orbits, ledger drift ${a.drift.toExponential(2)} |U_self|, ${a.acc} grains hit the planet`);
    ok('survival at 1.5 d_fluid (fluid pile, N = 400)', b.bound > 0.95, `d = ${b.d.toFixed(2)} R_p, bound ${(100 * b.bound).toFixed(1)}% after 3 orbits, ledger drift ${b.drift.toExponential(2)} |U_self|`);
  }
}

// 7 ─ GPU against CPU (Deno WebGPU)
async function gpuTest() {
  if (typeof navigator === 'undefined' || !navigator.gpu) { console.log('SKIP  GPU test: no navigator.gpu here'); return; }
  const { SimGPU, loadSimCode } = await import('./engine.js');
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const errs = []; device.addEventListener?.('uncapturederror', e => errs.push(String(e.error?.message || e)));
  const N = 300, mat = P.MATERIALS.cohesive;
  const { C, cl, sim } = settledPile(N, mat, 11, 4);
  const st = P.pileStats(sim.x, sim.mass);
  const spec = { kind: 'circular', q: 1.5, s: 0.08, J2: 0.015 };
  const pl = P.planetFor(st, spec);
  spec.d = 0.8 * P.rocheFluid(pl.Rp, pl.rhoP, pl.rhoS) / pl.Rp;
  const o = P.orbitStart(pl, spec);
  const cpu = new P.CpuSim(N, cl.rad, cl.mass, C, pl);
  cpu.x.set(sim.x); P.placeOnOrbit(cpu.x, cpu.v, cpu.w, cpu.mass, o.Omega);
  // stir: random velocities and spins, so dashpots, friction and rolling act
  const r = P.rng(9);
  for (let i = 0; i < 3 * N; i++) { cpu.v[i] += (r() - 0.5) * 0.2 * C.vesc; cpu.w[i] += (r() - 0.5) * 0.2 * C.vesc; }
  const pos0 = cpu.x.slice(), vel0 = cpu.v.slice(), spin0 = cpu.w.slice();
  const refC = new P.RefOrbit(pl, o.X, o.V); cpu.init(refC);
  const gpu = new SimGPU(device, N, await loadSimCode());
  gpu.setParams(C, pl, 0);
  gpu.ref = new P.RefOrbit(pl, o.X, o.V);
  gpu.setState(pos0, vel0, spin0, cl.rad, cl.mass);
  gpu.prime();
  const acc = await gpu.readAccs();
  let num = 0, den = 0, numA = 0, denA = 0, contacts = 0;
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < 3; k++) {
      num += (acc[16 * i + k] - cpu.aF[3 * i + k]) ** 2; den += cpu.aF[3 * i + k] ** 2;
      numA += (acc[16 * i + 4 + k] - cpu.al[3 * i + k]) ** 2; denA += cpu.al[3 * i + k] ** 2;
    }
    contacts += cpu.cnt[i];
  }
  const eF = Math.sqrt(num / den), eA = Math.sqrt(numA / denA);
  ok('GPU forces = CPU reference (300 grains, every term on)', eF < 1e-4, `rms rel err of the acceleration ${eF.toExponential(2)} (${contacts} list entries)`);
  ok('GPU torques = CPU reference', eA < 1e-3, `rms rel err of the angular acceleration ${eA.toExponential(2)}`);
  // two blocks of motion
  for (let b = 0; b < 2; b++) cpu.block(C.dt, P.K_STEP, refC);
  const enc = device.createCommandEncoder(); gpu.encode(enc, 2, true); device.queue.submit([enc.finish()]);
  const rb = await gpu.readback();
  let dx = 0, dv = 0, vs = 0;
  for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) {
    dx = Math.max(dx, Math.abs(rb.body[12 * i + k] - cpu.x[3 * i + k]));
    dv += (rb.body[12 * i + 4 + k] - cpu.v[3 * i + k]) ** 2; vs += cpu.v[3 * i + k] ** 2;
  }
  ok('GPU = CPU after 2 blocks (64 steps)', dx < 1e-2 && Math.sqrt(dv / vs) < 1e-3, `max |dx| ${dx.toExponential(2)} grain radii, rms rel dv ${Math.sqrt(dv / vs).toExponential(2)}, ref dX ${Math.abs(rb.X[0] - refC.X[0]).toExponential(1)}`);
  // energy from the GPU readback (cs_potential) against the CPU energy
  { const N3 = N * 3, gx = new Float64Array(N3), gv = new Float64Array(N3), gw = new Float64Array(N3), gm = new Float64Array(N), gp = new Float64Array(N);
    for (let i = 0; i < N; i++) { for (let k = 0; k < 3; k++) { gx[3 * i + k] = rb.body[12 * i + k]; gv[3 * i + k] = rb.body[12 * i + 4 + k]; gw[3 * i + k] = rb.body[12 * i + 8 + k]; } gm[i] = rb.body[12 * i + 7]; gp[i] = rb.grav[8 * i + 3]; }
    const eg = P.energyOf(gx, gv, gw, cl.rad, gm, gp, rb.X, rb.V, pl.GM), ec = P.energyOf(cpu.x, cpu.v, cpu.w, cpu.rad, cpu.mass, cpu.phi, refC.X, refC.V, pl.GM);
    const dU = Math.abs(eg.Us - ec.Us) / Math.abs(ec.Us), dK = Math.abs((eg.K + eg.Kr + eg.Up) - (ec.K + ec.Kr + ec.Up)) / Math.abs(ec.Us);
    let Wc = 0; for (const q of cpu.work) Wc += q;
    ok('GPU energy terms = CPU (self potential, orbit)', dU < 1e-5 && dK < 1e-3, `|dU_self|/|U_self| ${dU.toExponential(2)}, |d(K + U_planet)|/|U_self| ${dK.toExponential(2)}, contact work GPU ${rb.W.toExponential(4)} CPU ${Wc.toExponential(4)}`); }
  ok('no grid bucket or neighbour list overflow', rb.overflow === 0 && rb.listFull === 0, `${rb.overflow} grains found a full bucket, ${rb.listFull} a full list`);
  ok('no WebGPU validation errors', errs.length === 0, errs.join(' | ') || 'none');
  gpu.destroy(); device.destroy();
}

if (!GPU_ONLY) {
  const t0 = Date.now();
  cpuTests();
  console.log(`CPU tests: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
if (typeof Deno !== 'undefined') await gpuTest();
else {
  // Node has no WebGPU: run the GPU test in Deno when it is installed.
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const here = fileURLToPath(import.meta.url);
  const d = spawnSync('deno', ['run', '-A', here, '--gpu'], { encoding: 'utf8' });
  if (d.error) console.log('SKIP  GPU test: deno is not installed (' + d.error.code + ')');
  else { process.stdout.write(d.stdout); if (d.stderr.trim()) process.stdout.write(d.stderr); if (d.status !== 0) fails++; }
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
if (typeof Deno !== 'undefined') { if (fails) Deno.exit(1); }
else process.exitCode = fails ? 1 : 0;
