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
//  8  pacing: the wall time from the start of the default run (Saturn,
//     Normal speed, desktop budget) to the first shed grains, from a model
//     of the frame loop that drives a CPU pile (N = 800) with the director
//     of pacing.js; it must be under 5 s. The screensaver's budget too.
//     node tests.mjs --pace runs test 8 only; --pace-old adds the old run.
//  10 story camera: the default run's trace through app/director.js (node,
//     DOM stubbed): view turn rate, the moon in frame, the pull-out
//  11 screensaver: the reel is seeded (same seed, same reel; seeds differ),
//     no run twice in a row, every shot lasts 5-12 s, every spiral run
//     starts outside its fluid limit and sheds within 4 s at the saver's
//     speed (pacing model, cached pile)
//  12 phone layout (style.css, read as text): 44 px touch targets on a
//     coarse pointer, the dock and bottom sheets on a phone, the short
//     landscape strip, no page scroll, the canvas takes every touch
//  9  memory: the GPU bytes of the page (scene, bloom, canvas, moons, ring)
//     for desktop and phone profiles, against budget.js LIMIT; phones get
//     at most 4096 grains, a pixel ratio of 1.5 and no MSAA
//
//  Each test prints PASS or FAIL with its numbers. Exit code 1 on a FAIL.
//  Published values: Wikipedia "Roche limit", revision of 2020-12 (tables
//  "Roche limits for selected examples"), and the A ring outer edge
//  136,775 km (NASA Saturnian rings fact sheet).
// ============================================================================
import * as P from './physics.js';
import * as PC from './pacing.js';
import { SCENARIOS, REAL, limitsOf } from './scenarios.js';
import * as BG from './budget.js';
import * as SP from './saver-plan.js';

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

  // 1b ─ the Roche distance of each scenario: limitsOf (the page) against
  // the formulas written out here, and the numbers that the notes print
  { let worst = 0;
    const all = [...SCENARIOS.filter(x => x.kind !== 'real'), ...Object.values(REAL)];
    for (const sc of all) {
      const q = sc.q, L = limitsOf(q);
      const rigid = Math.pow(2 * q, 1 / 3), fluid = 2.44 * Math.pow(q, 1 / 3);
      worst = Math.max(worst, Math.abs(L.rigid - rigid) / rigid, Math.abs(L.fluid - fluid) / fluid);
    }
    ok('Roche distance of every scenario = R (2 rho_p/rho_s)^(1/3) and 2.44 R (rho_p/rho_s)^(1/3)', worst < 1e-12, `${all.length} scenarios, worst rel diff ${worst.toExponential(1)}`);
    const sat = SCENARIOS.find(x => x.key === 'saturn'), close = SCENARIOS.find(x => x.key === 'close');
    const claims = [
      ['Saturn story: fluid limit 2.15 R_S', limitsOf(sat.q).fluid, 2.15],
      ['"A moon too close": fluid limit 2.44 R_p', limitsOf(close.q).fluid, 2.44],
      ['Phobos: fluid 3.12, rigid 1.61 Mars radii', limitsOf(REAL.phobos.q).fluid, 3.12, limitsOf(REAL.phobos.q).rigid, 1.61],
      ['Io: fluid 1.76 Jupiter radii', limitsOf(REAL.io.q).fluid, 1.76],
      ['Shoemaker-Levy 9: fluid 3.4 Jupiter radii', limitsOf(REAL.sl9.q).fluid, 3.4],
      ['the Moon: fluid 2.88 Earth radii', limitsOf(REAL.moon.q).fluid, 2.88],
      ['Pan at 77% of its fluid limit (the note said 70% before 2026-10-08)', REAL.pan.d / limitsOf(REAL.pan.q).fluid, 0.77],
    ];
    for (const c of claims) {
      const okk = Math.abs(c[1] - c[2]) <= 0.006 * c[2] + 0.005 && (c.length < 5 || Math.abs(c[3] - c[4]) <= 0.006 * c[4] + 0.005);
      ok('note: ' + c[0], okk, `${c[1].toFixed(3)}${c.length > 3 ? ', ' + c[3].toFixed(3) : ''}`);
    }
    // the default story starts outside the fluid limit; its drag ends
    // under 0.8 d_fluid, where a fluid pile sheds fast
    ok('Saturn story starts outside the fluid limit and ends well inside it', sat.d > limitsOf(sat.q).fluid && sat.d1 < 0.8 * limitsOf(sat.q).fluid, `start ${sat.d} R_S = ${(sat.d / limitsOf(sat.q).fluid).toFixed(3)} d_fluid, end ${sat.d1} R_S = ${(sat.d1 / limitsOf(sat.q).fluid).toFixed(3)} d_fluid`);
  }

  // 1c ─ a grain that hits the planet: the CPU keeps the impact point and
  // time (the GPU puts them in the spin row of the parked grain)
  { const C = P.contactParams(400, P.MATERIALS.fluid), pl = { GM: 5e6, Rp: 100, J2: 0, drag: 0 };
    const g = new P.CpuSim(1, [1], [1], C, pl);
    // the frame point on a circular orbit at 1.5 R_p; the grain falls
    // straight in from 30 units inside it at 300 units per time
    const o = P.orbitStart(pl, { kind: 'circular', d: 1.5 }), ref = new P.RefOrbit(pl, o.X, o.V);
    g.x.set([-30, 0, 0]); g.v.set([-300, 0, 0]); g.init(ref);
    const dt = 1e-3; let n = 0;
    while (g.mass[0] > 0 && n < 400) { g.block(dt, 1, ref); n++; }
    const p = [g.impact[0], g.impact[1], g.impact[2]], r = Math.hypot(...p), tHit = g.impact[3];
    const speed = 300;   // the radial speed; the frame moves along its orbit
    ok('impact record: point on the surface, time of the step', g.mass[0] === 0 && r <= pl.Rp && r > pl.Rp - 1.5 * speed * dt && Math.abs(tHit - n * dt) < 1e-12, `|p| = ${r.toFixed(3)} (R_p 100, one step ${(speed * dt).toFixed(2)}), t = ${tHit.toFixed(4)} after ${n} steps, L lost ${g.Llost[2].toExponential(2)}`);
  }

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
      const Ld = (e1.L[2] + s2.Llost[2] - e0.L[2]) / Math.abs(e0.L[2]);
      return { f, d: spec.d, bound: an.M / st.M, drift: (e1.E - W - e0.E) / Math.abs(e0.Us), Ld, acc: s2.accreted || 0 };
    };
    const a = run(0.6), b = run(1.5);
    ok('disruption at 0.6 d_fluid (fluid pile, N = 400)', a.bound < 0.5, `d = ${a.d.toFixed(2)} R_p, bound ${(100 * a.bound).toFixed(1)}% after 3 orbits, ledger drift ${a.drift.toExponential(2)} |U_self|, ${a.acc} grains hit the planet`);
    ok('survival at 1.5 d_fluid (fluid pile, N = 400)', b.bound > 0.95, `d = ${b.d.toFixed(2)} R_p, bound ${(100 * b.bound).toFixed(1)}% after 3 orbits, ledger drift ${b.drift.toExponential(2)} |U_self|`);
    // the books over a whole breakup: energy (E - W, the grains that hit
    // the planet included) and the angular momentum about the spin axis
    // (L_z + the L_z that the hits took)
    ok('breakup run: energy ledger drift over 3 orbits', Math.abs(a.drift) < 2e-3 && Math.abs(b.drift) < 2e-3, `|d(E - W)| / |U_self| ${Math.abs(a.drift).toExponential(2)} (torn), ${Math.abs(b.drift).toExponential(2)} (whole)`);
    ok('breakup run: angular momentum drift over 3 orbits', Math.abs(a.Ld) < 1e-5 && Math.abs(b.Ld) < 1e-5, `|dL_z| / L_z ${Math.abs(a.Ld).toExponential(2)} (torn, ${a.acc} hits), ${Math.abs(b.Ld).toExponential(2)} (whole)`);
  }
}

// 8 ─ pacing: wall time to the first shed grains
// The page's numbers come from N_page grains (pacing.js DESKTOP or PHONE):
// the orbit in steps (T0 / dt at that N), the settle in steps, the cloud
// build (timed here, in node). The CPU pile (N = cfg.N) stands in for the
// moon: it runs the same orbit, so its shape and its bound mass give the
// director the same signals as the worker's analysis on the page. Frames
// run at 60 fps; each frame runs the orbits that the speed asks for,
// capped by the step budget of the profile.
function paceRun(cfg) {
  const prof = cfg.profile || PC.DESKTOP, N = cfg.N || 800, mat = P.MATERIALS.fluid;
  const { C, cl, sim } = settledPile(N, mat, 7, PC.SETTLE_TIME);
  const st = P.pileStats(sim.x, sim.mass);
  const spec = { kind: 'circular', q: cfg.q, s: cfg.s, J2: cfg.J2 || 0 };
  const pl = P.planetFor(st, spec);
  const o = P.orbitStart(pl, { kind: 'circular', d: cfg.d0 });
  const T0 = P.orbitalPeriod(pl.GM, cfg.d0 * pl.Rp);
  const Tm = P.orbitalPeriod(pl.GM, Math.sqrt(cfg.d0 * cfg.d1) * pl.Rp);
  pl.drag = Math.log(cfg.d0 / cfg.d1) / (2 * cfg.orbits * Tm);
  const s2 = new P.CpuSim(N, cl.rad, cl.mass, C, pl);
  s2.x.set(sim.x); P.placeOnOrbit(s2.x, s2.v, s2.w, s2.mass, o.Omega);
  const ref = new P.RefOrbit(pl, o.X, o.V); s2.init(ref);
  const dF = P.rocheFluid(pl.Rp, pl.rhoP, pl.rhoS) / pl.Rp;
  // the page: steps per orbit and per settle at N_page (T0 / dt does not
  // depend on R_p: T0 = 2 pi sqrt(d^3 / (G q rho_s 4 pi / 3)))
  const Cp = P.contactParams(prof.N, mat);
  const stepsOrbit = T0 / Cp.dt;
  const settleSteps = Math.ceil(cfg.settleTime / (Cp.dt * P.K_STEP)) * P.K_STEP;
  let t0 = Date.now(); P.makeCloud(prof.N, 3); const cloudS = (Date.now() - t0) / 1000;
  const settleS = settleSteps / (cfg.settlePerFrame || prof.stepsPerFrame) / prof.fps;
  const pace = cfg.director ? PC.newPace() : null;
  const frameS = 1 / prof.fps, cpuStepOrbit = C.dt / T0;
  let wall = cloudS + settleS, carryO = 0, carryCpu = 0, lastRead = 0, orbits = 0;
  const out = { cloudS, settleS, stepsOrbit, dF, tShed: null, tTorn: null, oShed: null, oTorn: null, dShed: null, slowAt: null,
    trace: cfg.trace ? [] : null, meta: { pl: Object.assign({}, pl), o, T0, Rs: st.R, M0: st.M, kappa: pl.drag } };
  let an = null, f = 1, el = 1, spread = st.R, comAll = [0, 0, 0], tRead = 0, stopAt = Infinity;
  while (wall < 60 && wall < stopAt) {
    const factor = pace ? PC.stepFactor(pace, frameS) : 1;
    if (pace && pace.mode === 'breakup' && out.slowAt === null) out.slowAt = wall;
    const want = cfg.speed * factor / 60 * frameS;                    // orbits this frame
    const cap = prof.stepsPerFrame / stepsOrbit;
    const run = Math.min(want, cap);
    carryCpu += run / cpuStepOrbit;
    const blocks = Math.floor(carryCpu / P.K_STEP);
    for (let b = 0; b < blocks; b++) s2.block(C.dt, P.K_STEP, ref);
    carryCpu -= blocks * P.K_STEP; orbits += blocks * P.K_STEP * cpuStepOrbit;
    if (pl.drag > 0 && Math.hypot(...ref.X) < cfg.d1 * pl.Rp) pl.drag = 0;
    wall += frameS;
    if ((wall - lastRead) * 1000 >= cfg.readMs) {
      lastRead = wall;
      an = P.analyzeBound(s2.x, s2.v, s2.mass, s2.rad, 3, ref.X, pl.GM);
      f = an.M / st.M; el = P.boundShape(s2.x, s2.mass, an.mask, an.com).el; tRead = orbits * T0;
      if (cfg.trace) { // as worker.js: the centre and the rms spread of all grains left
        let Ma = 0, s2s = 0; comAll = [0, 0, 0];
        for (let i = 0; i < N; i++) { const m = s2.mass[i]; if (!m) continue; Ma += m; for (let k = 0; k < 3; k++) comAll[k] += m * s2.x[3 * i + k]; }
        comAll = comAll.map(q => q / Ma);
        for (let i = 0; i < N; i++) { const m = s2.mass[i]; if (!m) continue; s2s += m * ((s2.x[3 * i] - comAll[0]) ** 2 + (s2.x[3 * i + 1] - comAll[1]) ** 2 + (s2.x[3 * i + 2] - comAll[2]) ** 2); }
        spread = Math.sqrt(s2s / Ma);
      }
      if (pace) PC.updatePace(pace, { f, el }, orbits * T0, T0);
      const d = Math.hypot(...ref.X) / pl.Rp;
      if (out.tShed === null && f < 0.97) { out.tShed = wall; out.oShed = orbits; out.dShed = d / dF; }
      if (out.tTorn === null && f < 0.75) { out.tTorn = wall; out.oTorn = orbits; stopAt = cfg.trace ? wall + cfg.trace : wall; }
    }
    if (cfg.trace) out.trace.push({ wall, X: ref.X.slice(), V: ref.V.slice(), t: orbits * T0, pace: pace ? Object.assign({}, pace) : null, drag: pl.drag,
      an: an ? { f, el, live: f > 0.2 && an.M > 0, com: an.com.slice(), vcm: an.vcm.slice(), t: tRead, spread, comAll: comAll.slice(), vcmAll: [0, 0, 0] } : null });
  }
  return out;
}
async function paceTests(old) {
  const sc = SCENARIOS.find(x => x.key === 'saturn');
  const base = { q: sc.q, s: sc.s, J2: sc.J2, speed: sc.speed };
  const cur = Object.assign({}, base, { d0: sc.d, d1: sc.d1, orbits: sc.orbits, director: true, settleTime: PC.SETTLE_TIME, readMs: PC.READ_MS.story });
  const fmt = r => `cloud ${r.cloudS.toFixed(2)} s + settle ${r.settleS.toFixed(2)} s; first shed at ${r.tShed?.toFixed(2)} s (${r.oShed?.toFixed(3)} orbit, d = ${r.dShed?.toFixed(3)} d_fluid), slow motion from ${r.slowAt?.toFixed(2) ?? '-'} s, 25% shed at ${r.tTorn?.toFixed(2)} s (${r.oTorn?.toFixed(3)} orbit)`;
  const a = paceRun(Object.assign({ trace: CAMERA ? 7 : 0 }, cur));
  ok('pacing: default run (Saturn, Normal, desktop budget) sheds within 5 s', a.tShed !== null && a.tShed < 5, fmt(a));
  ok('pacing: the slow motion starts before the first shed grains', a.slowAt !== null && a.slowAt <= a.tShed, `slow motion at ${a.slowAt?.toFixed(2)} s, first shed at ${a.tShed?.toFixed(2)} s`);
  // the screensaver: its base speed (pacing.js SAVER_SPEED); the pile is
  // in the cache after the first run, so no settle
  const sv = paceRun(Object.assign({}, cur, { speed: PC.SAVER_SPEED, settleTime: 0 }));
  ok('pacing: screensaver run (cached pile) sheds within 4 s', sv.tShed !== null && sv.tShed - sv.cloudS < 4, `first shed ${(sv.tShed - sv.cloudS).toFixed(2)} s after the start (no cloud, no settle)`);
  if (CAMERA) await cameraTests(a, sc);
  saverTests(cur);
  if (old) {
    const b = paceRun(Object.assign({}, base, { d0: 2.7, d1: 1.7, orbits: 4, director: false, settleTime: 6, readMs: 1000, settlePerFrame: 64 }));
    console.log(`INFO  old pacing (2.7 -> 1.7 in 4 orbits, one speed, settle 6 at 64 steps/frame): ${fmt(b)}`);
  }
}

// 10 ─ the story camera (app/director.js) on the default run, replayed in
// node with stubs for the DOM: the view turns slowly, it keeps the moon
// in frame through the breakup, and it pulls out to the planet after it.
async function cameraTests(run, sc) {
  const mq = () => ({ matches: false, addEventListener() {} });
  globalThis.window = globalThis.window || { matchMedia: mq, devicePixelRatio: 1 };
  globalThis.document = globalThis.document || { getElementById: () => null, documentElement: { classList: { add() {}, remove() {}, toggle() {} } } };
  const { S } = await import('./app/state.js');
  const C = await import('./app/camera.js');
  const D = await import('./app/director.js');
  const { UI } = await import('./app/env.js');
  const m = run.meta, Rp = m.pl.Rp, k = 1 / Rp;
  const pl = Object.assign({}, m.pl, { drag: m.kappa });
  const sat = { k, Rp, Rs: m.Rs, C: { Rs: m.Rs }, pl, o: { X: m.o.X.slice(), V: m.o.V.slice() }, ref: new P.RefOrbit(pl, m.o.X, m.o.V), an: null, gpu: { t: 0 } };
  S.run = { phase: 'orbit', serial: 1, spec: { kind: 'spiral', d1: sc.d1, key: 'saturn' }, T0: m.T0, limits: limitsOf(sc.q), viewD: 2.3, t: 0, story: {}, sats: [sat], pace: PC.newPace() };
  UI.cam = 'story'; UI.calm = false; UI.paused = false; UI.scen = 'saturn'; UI.speedLog = Math.log10(sc.speed);
  C.cam.az = 0.9; C.cam.el = sc.el; C.cam.zoom = 1; C.cam.pose = null; C.resetCamStats();
  D.planShots();
  const psi = S.run.shot.psi, rz = v => [Math.cos(psi) * v[0] - Math.sin(psi) * v[1], Math.sin(psi) * v[0] + Math.cos(psi) * v[1], v[2]];
  const FOVH = 0.31;
  let worstMoon = 0, moonFrames = 0, endPlanet = null, endDist = 0, rotMax = 0, prevF = null;
  const W = 1280, H = 800;
  for (let i = 0; i < run.trace.length; i++) {
    const fr = run.trace[i], dt = i ? fr.wall - run.trace[i - 1].wall : 1 / 60;
    sat.ref.X = rz(fr.X); sat.ref.V = rz(fr.V); sat.gpu.t = fr.t; S.run.t = fr.t;
    S.run.pace = fr.pace;
    if (fr.an) sat.an = Object.assign({}, fr.an, { com: rz(fr.an.com), vcm: rz(fr.an.vcm), comAll: rz(fr.an.comAll) });
    const p = C.cameraFrame(dt, W, H);
    const f = [0, 1, 2].map(q => p.target[q] - p.eye[q]), fl = Math.hypot(...f);
    if (prevF) { const c = (f[0] * prevF[0] + f[1] * prevF[1] + f[2] * prevF[2]) / (fl * Math.hypot(...prevF)); const rr = Math.acos(Math.min(1, c)) * 180 / Math.PI / dt; rotMax = Math.max(rotMax, rr); }
    prevF = f;
    const moon = sat.an && sat.an.live ? [0, 1, 2].map(q => (sat.ref.X[q] + sat.an.com[q]) * k) : sat.ref.X.map(q => q * k);
    const toM = [0, 1, 2].map(q => moon[q] - p.eye[q]), ang = Math.acos(Math.min(1, (toM[0] * f[0] + toM[1] * f[1] + toM[2] * f[2]) / (fl * Math.hypot(...toM))));
    if (fr.pace && fr.pace.mode === 'breakup' && sat.an && sat.an.live) { worstMoon = Math.max(worstMoon, ang); moonFrames++; }
    const toP = p.eye.map(q => -q), angP = Math.acos(Math.min(1, (toP[0] * f[0] + toP[1] * f[1] + toP[2] * f[2]) / (fl * Math.hypot(...toP))));
    endPlanet = angP; endDist = Math.hypot(...p.eye);
  }
  ok('story camera: the view turns at most 10 deg/s', rotMax <= 10, `largest turn of the view axis ${rotMax.toFixed(1)} deg/s over ${run.trace.length} frames`);
  ok('story camera: the moon stays in frame through the breakup', moonFrames > 30 && worstMoon < FOVH, `${moonFrames} frames in slow motion; the moon at most ${(worstMoon * 180 / Math.PI).toFixed(1)} deg off the view axis (half the view is ${(FOVH * 180 / Math.PI).toFixed(1)})`);
  ok('story camera: after the breakup it pulls out to the planet', endPlanet < FOVH && endDist > 3, `at the end the planet is ${(endPlanet * 180 / Math.PI).toFixed(1)} deg off axis, the eye ${endDist.toFixed(2)} R_p from it`);
}

// 11 ─ the screensaver reel (saver-plan.js)
function saverTests(cur) {
  const keys = seed => { const r = SP.rng(seed); return [0, 1, 2].flatMap(() => SP.makeReel(r).map(x => x.key)).join(' '); };
  ok('saver: the reel is seeded', keys(7) === keys(7) && keys(7) !== keys(8), `seed 7: ${keys(7).split(' ').slice(0, 6).join(' ')}; seed 8: ${keys(8).split(' ').slice(0, 6).join(' ')}`);
  let twice = 0, lens = [], minL = Infinity, maxL = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const r = SP.rng(seed); let last = null;
    for (let k = 0; k < 3; k++) { const reel = SP.makeReel(r, last); if (reel[0].key === last) twice++; last = reel[reel.length - 1].key; }
    // play the shots of one run against a breakup at 0.5-3 s and a ring
    // phase 4-9 s after it, in 50 ms ticks
    const plan = SP.shotPlan(r), tB = 0.5 + 2.5 * r(), tR = tB + 4 + 5 * r();
    let t = 0;
    for (const sh of plan) {
      const t0 = t; let el = 0, bAt = null;
      while (true) { el = t - t0; if (bAt === null && t >= tB) bAt = el; if (SP.shotDone(sh, el, { breakupAt: bAt, ring: t >= tR })) break; t += 0.05; }
      lens.push(el); minL = Math.min(minL, el); maxL = Math.max(maxL, el);
    }
  }
  ok('saver: no run plays twice in a row', twice === 0, `${twice} repeats over 200 seeds x 3 reels`);
  ok('saver: every shot lasts 5-12 s (cuts every 5-12 s)', minL >= SP.CUT_MIN - 1e-9 && maxL <= SP.CUT_MAX + 0.05, `${lens.length} shots, ${minL.toFixed(2)} to ${maxL.toFixed(2)} s, mean ${(lens.reduce((a, b) => a + b, 0) / lens.length).toFixed(2)} s`);
  for (const run of SP.RUNS) {
    const sc = SCENARIOS.find(x => x.key === run.scen);
    if (sc.kind !== 'spiral') continue;
    const spec = Object.assign({ q: sc.q, d: sc.d, d1: sc.d1, orbits: sc.orbits, J2: sc.J2 || 0 }, run.spec);
    const dF = limitsOf(spec.q).fluid;
    const r = paceRun(Object.assign({}, cur, { q: spec.q, J2: spec.J2, s: sc.s || 0.12, d0: spec.d, d1: spec.d1, orbits: spec.orbits, speed: PC.SAVER_SPEED, settleTime: 0 }));
    const tS = r.tShed === null ? Infinity : r.tShed - r.cloudS;
    ok(`saver run "${run.key}": starts outside the limit, sheds within 4 s`, spec.d > dF && spec.d < 1.1 * dF && spec.d1 < 0.8 * dF && tS < 4, `start ${(spec.d / dF).toFixed(3)} d_fluid, end ${(spec.d1 / dF).toFixed(3)}; first shed ${tS.toFixed(2)} s after the start (${r.oShed?.toFixed(3)} orbit)`);
  }
}

// 12 ─ the phone layout, from the stylesheet text
async function layoutTests() {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // the body of the first @media block whose query contains q
  const block = q => { const i = css.indexOf(q); if (i < 0) return ''; let k = css.indexOf('{', i) + 1, depth = 1, j = k; while (depth && j < css.length) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; } return css.slice(k, j - 1); };
  const rule = (b, sel) => { const m = b.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\#]/g, '\\$&') + '\\s*\\{([^}]*)\\}')); return m ? m[1] : ''; };
  const px = (r, prop) => { const m = r.match(new RegExp(prop + ':(\\d+)px')); return m ? +m[1] : 0; };
  const coarse = block('@media (pointer:coarse)'), phone = block('@media (max-width:768px)'), land = block('@media (max-height:500px) and (orientation:landscape) and (pointer:coarse)');
  const t = [['.ib,.tb', 'min-height'], ['.seg button,.chips button,.toggles label', 'min-height'], ['#phases button', 'min-height']].map(([sel, pr]) => [sel, px(rule(coarse, sel), pr)]);
  ok('phone: touch targets are 44 px on a coarse pointer', t.every(x => x[1] >= 44), t.map(x => `${x[0]} ${x[1]} px`).join('; '));
  const dockB = px(rule(phone, '#dock > button'), 'height');
  ok('phone: dock buttons 48 px, sheets above the dock', dockB >= 44 && /bottom:var\(--dock-h\)/.test(rule(phone, '.pop:not(#moreMenu),.drawer')), `dock button ${dockB} px`);
  ok('phone landscape: the strip drops the phase buttons and keeps one-line text', /display:none/.test(rule(land, '#phases')) && /nowrap/.test(rule(land, '#caption')), 'checked #phases, #caption');
  ok('no page scroll; the canvas takes every touch (pinch, drag)', /overflow:hidden/.test(rule(css, 'html,body')) && /touch-action:none/.test(rule(css, '#gpu')) && /nowrap/.test(rule(css, '#warp')) && /ellipsis/.test(rule(css, '#warp')), 'html,body overflow hidden; #gpu touch-action none; #warp one line');
}

// 9 ─ the GPU memory budget
function budgetTests() {
  const prof = [
    ['laptop 1440x900 @2, medium', 1440, 900, 2, 'medium', false, 1],
    ['desktop 1920x1080 @1, medium', 1920, 1080, 1, 'medium', false, 1],
    ['desktop 2560x1440 @2, high', 2560, 1440, 2, 'high', false, 1],
    ['desktop 2560x1440 @2, high, two moons', 2560, 1440, 2, 'high', false, 2],
    ['phone 390x844 @3, portrait', 390, 844, 3, 'low', true, 1],
    ['phone 844x390 @3, landscape', 844, 390, 3, 'low', true, 1],
    ['tablet 1024x1366 @2', 1024, 1366, 2, 'low', true, 1],
  ];
  for (const [name, w, h, dpr, preset, touch, sats] of prof) {
    const Qp = BG.QUALITY[preset], N = sats > 1 ? Qp.N / 2 : Qp.N;
    const b = BG.pageBytes({ cssW: w, cssH: h, dpr, touch, maxPx: Qp.maxPx, N, sats, gridN: Qp.gridN });
    const lim = touch ? BG.LIMIT.touch : BG.LIMIT.desktop;
    const legacy = b.total - b.r.bytes.total + legacyScene(w, h, dpr, touch, Qp.maxPx);
    const rules = b.r.samples === 1 || b.r.pr <= BG.MSAA_PR_MAX;
    const phone = !touch || (N <= 4096 && b.r.pr <= 1.5 && b.r.samples === 1);
    ok(`memory: ${name}`, b.total <= lim && rules && phone, `${(b.total / 1e6).toFixed(0)} MB of ${(lim / 1e6).toFixed(0)} (scene ${(b.r.bytes.total / 1e6).toFixed(0)}, ${sats} x ${N} grains ${(b.sims / 1e6).toFixed(1)}, ring ${(b.ring / 1e6).toFixed(1)}); pr ${b.r.pr.toFixed(2)}, ${b.r.samples}x; before: ${(legacy / 1e6).toFixed(0)} MB`);
  }
}
// The page before budget.js: 4x MSAA at the preset's pixels, always.
function legacyScene(w, h, dpr, touch, maxPx) {
  const d = Math.min(dpr, touch ? 1.5 : 2); let W = w * d, H = h * d; const k = Math.min(1, Math.sqrt(maxPx / (W * H)));
  const px = Math.round(W * k) * Math.round(H * k);
  return BG.sceneBytes(px, 4).total;
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
  // the 64 steps go in three part-block encodes (24 + 24 + 16), as the page
  // does at a low time warp (engine.js encodeSteps)
  for (const [n, sync] of [[24, false], [24, false], [16, true]]) { const enc = device.createCommandEncoder(); gpu.encodeSteps(enc, n, sync); device.queue.submit([enc.finish()]); }
  const rb = await gpu.readback();
  let dx = 0, dv = 0, vs = 0;
  for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) {
    dx = Math.max(dx, Math.abs(rb.body[12 * i + k] - cpu.x[3 * i + k]));
    dv += (rb.body[12 * i + 4 + k] - cpu.v[3 * i + k]) ** 2; vs += cpu.v[3 * i + k] ** 2;
  }
  ok('GPU = CPU after 2 blocks (64 steps, encoded as 24 + 24 + 16)', dx < 1e-2 && Math.sqrt(dv / vs) < 1e-3, `max |dx| ${dx.toExponential(2)} grain radii, rms rel dv ${Math.sqrt(dv / vs).toExponential(2)}, ref dX ${Math.abs(rb.X[0] - refC.X[0]).toExponential(1)}`);
  // energy from the GPU readback (cs_potential) against the CPU energy
  { const N3 = N * 3, gx = new Float64Array(N3), gv = new Float64Array(N3), gw = new Float64Array(N3), gm = new Float64Array(N), gp = new Float64Array(N);
    for (let i = 0; i < N; i++) { for (let k = 0; k < 3; k++) { gx[3 * i + k] = rb.body[12 * i + k]; gv[3 * i + k] = rb.body[12 * i + 4 + k]; gw[3 * i + k] = rb.body[12 * i + 8 + k]; } gm[i] = rb.body[12 * i + 7]; gp[i] = rb.grav[8 * i + 3]; }
    const eg = P.energyOf(gx, gv, gw, cl.rad, gm, gp, rb.X, rb.V, pl.GM), ec = P.energyOf(cpu.x, cpu.v, cpu.w, cpu.rad, cpu.mass, cpu.phi, refC.X, refC.V, pl.GM);
    const dU = Math.abs(eg.Us - ec.Us) / Math.abs(ec.Us), dK = Math.abs((eg.K + eg.Kr + eg.Up) - (ec.K + ec.Kr + ec.Up)) / Math.abs(ec.Us);
    let Wc = 0; for (const q of cpu.work) Wc += q;
    ok('GPU energy terms = CPU (self potential, orbit)', dU < 1e-5 && dK < 1e-3, `|dU_self|/|U_self| ${dU.toExponential(2)}, |d(K + U_planet)|/|U_self| ${dK.toExponential(2)}, contact work GPU ${rb.W.toExponential(4)} CPU ${Wc.toExponential(4)}`); }
  // a grain that hits the planet on the GPU: its spin row holds the
  // impact point and time, as the CPU's impact record
  { const pl2 = { GM: 5e6, Rp: 100, J2: 0, drag: 0 }, C2 = P.contactParams(400, P.MATERIALS.fluid);
    const o2 = P.orbitStart(pl2, { kind: 'circular', d: 1.5 });
    const cpu2 = new P.CpuSim(1, [1], [1], C2, pl2); cpu2.x.set([-30, 0, 0]); cpu2.v.set([-300, 0, 0]);
    const rc = new P.RefOrbit(pl2, o2.X, o2.V); cpu2.init(rc);
    const g2 = new SimGPU(device, 1, await loadSimCode());
    g2.setParams(Object.assign({}, C2, { dt: 1e-3 }), pl2, 0); g2.ref = new P.RefOrbit(pl2, o2.X, o2.V);
    g2.setState([-30, 0, 0], [-300, 0, 0], [0, 0, 0], [1], [1]); g2.prime();
    for (let k = 0; k < 120; k++) cpu2.block(1e-3, 1, rc);
    const enc = device.createCommandEncoder(); g2.encodeSteps(enc, 120, true); device.queue.submit([enc.finish()]);
    const rb2 = await g2.readback(false);
    const gs = [rb2.body[8], rb2.body[9], rb2.body[10], rb2.body[11]], cs = Array.from(cpu2.impact);
    const dp = Math.hypot(gs[0] - cs[0], gs[1] - cs[1], gs[2] - cs[2]);
    ok('GPU impact stamp = CPU impact record', rb2.body[7] === 0 && dp < 1e-2 && Math.abs(gs[3] - cs[3]) < 1e-5, `|dp| ${dp.toExponential(2)}, t GPU ${gs[3].toFixed(5)} CPU ${cs[3].toFixed(5)}`);
    g2.destroy(); }
  ok('no grid bucket or neighbour list overflow', rb.overflow === 0 && rb.listFull === 0, `${rb.overflow} grains found a full bucket, ${rb.listFull} a full list`);
  ok('no WebGPU validation errors', errs.length === 0, errs.join(' | ') || 'none');
  gpu.destroy(); device.destroy();
}

const ARGS = typeof Deno !== 'undefined' ? Deno.args : process.argv.slice(2);
const PACE_ONLY = ARGS.includes('--pace') || ARGS.includes('--pace-old');
const CAMERA = typeof Deno === 'undefined';   // the camera test imports app/ with DOM stubs: node only
if (!GPU_ONLY) {
  const t0 = Date.now();
  if (!PACE_ONLY) { cpuTests(); budgetTests(); if (CAMERA) await layoutTests(); }
  await paceTests(ARGS.includes('--pace-old'));
  console.log(`CPU tests: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
if (typeof Deno !== 'undefined') await gpuTest();
else if (PACE_ONLY) {}
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
