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
//  11 screensaver: the reel is seeded (same seed, same reel; seeds
//     differ); 1000 seeds x 12 takes are valid runs, with no take and no
//     planet twice in a row, and every planet, body and orbit reached; the
//     shot plan against 1000 random event timelines: shots of 5-12 s, cuts
//     at most 5 s after a new phase, an impact shot, no surface shot at a
//     compact star, every take ends, the Director view loops; the shot
//     poses keep the eye outside the planet and the subject in view; every
//     spiral story starts outside its fluid limit and sheds within 4 s at
//     the saver's speed (pacing model, cached pile)
//  12 phone layout (style.css, read as text): 44 px touch targets on a
//     coarse pointer, the dock and bottom sheets on a phone, the short
//     landscape strip, no page scroll, the canvas takes every touch
//  13 random runs and start layouts (roll.js, initial.js): 3000 seeds
//     valid, every choice reached, seeds reproducible and unrelated,
//     presets valid, the world unit keeps the tide; the part sizes, the
//     orbit tilt and the ellipse start, spin modes and the cap, contact
//     lobes touch, a binary holds its mutual orbit (CPU), a train shares
//     one orbit, two moons, the core mass, clumps.
//     node tests.mjs --start runs test 13 only.
//  14 renderer (Deno WebGPU, offscreen texture): every planet style draws
//     with no error; a white dwarf under one pixel shows a core; grains
//     near it are lit by it; the origin colour stamps each grain's side of
//     the moon and the age colour keeps the shed time
//  15 every preset and 16 random seeds through the page's run code on the
//     GPU (Deno; app/runs.js, worker.js, app/history.js with the DOM
//     stubbed): each preset's claim (torn, hits, a capture with one body
//     bound and one unbound, a core that holds), finite values, no errors.
//     The first scenarios saturn, flyby and compare run the same path
//     (scen:<key>), set up by applyScenario as the gallery does; the
//     flyby comet must tear into 5 or more groups. deno run -A tests.mjs --gpu --rolls=sl9,seed:5 runs a few;
//     --no-rolls skips test 15. The cutting director (app/cuts.js) runs
//     in the Director view over each run: it cuts after the tear, and
//     every pose is finite and outside the planet.
//     The screensaver protocol (Deno): enter() returns the canvas and a
//     warm-up, and exit() gives back the view settings of the user.
//  16 the link (node, DOM stubbed): ?seed= at boot, cleared by a story,
//     ?run= for a preset
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
import * as SG from './shot-geom.js';
import * as RL from './roll.js';
import * as IN from './initial.js';

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

// 13 ─ random runs and start layouts (roll.js, initial.js)
function startTests() {
  // the roll space: every seed valid, the same seed the same run, all
  // choices reached
  { let bad = [], seen = { planet: new Set(), body: new Set(), material: new Set(), spin: new Set(), orbit: new Set() }, combos = new Set();
    for (let seed = 1; seed <= 3000; seed++) {
      const s = RL.rollRun(seed), e = RL.checkSpec(s);
      if (e) bad.push(`${seed}: ${e}`);
      for (const k of Object.keys(seen)) seen[k].add(k === 'orbit' ? s.orbitKind : s.choice[k]);
      combos.add(`${s.choice.planet}|${s.choice.body}|${s.orbitKind}`);
    }
    ok('rolls: 3000 seeds give valid runs', bad.length === 0, bad.slice(0, 3).join('; ') || 'all pass checkSpec');
    const cov = Object.entries(seen).map(([k, v]) => `${k} ${v.size}`).join(', ');
    ok('rolls: every planet, body, material, spin and orbit is reached', seen.planet.size === 10 && seen.body.size === 9 && seen.material.size === 4 && seen.spin.size === 4 && seen.orbit.size === 6, `${cov}; ${combos.size} planet-body-orbit combinations`);
    const a = JSON.stringify(RL.rollRun(4242)), b = JSON.stringify(RL.rollRun(4242)), c = JSON.stringify(RL.rollRun(4243));
    let same = 0; for (let i = 1; i <= 1000; i++) { const x = RL.rollRun(i).choice, y = RL.rollRun(i + 1).choice; if (x.planet === y.planet && x.body === y.body) same++; }
    ok('rolls: neighbour seeds give unrelated runs', same < 40, `${same} of 1000 neighbour pairs share planet and body (chance: about 11)`);
    ok('rolls: the same seed gives the same run', a === b && a !== c, `seed 4242: "${RL.rollRun(4242).title}"; 4243: "${RL.rollRun(4243).title}"`);
    const bp = RL.PRESETS.map(p => [p.key, RL.checkSpec(RL.presetSpec(p.key))]).filter(x => x[1]);
    ok('presets: a dozen or more, all valid, unique keys', RL.PRESETS.length >= 12 && bp.length === 0 && new Set(RL.PRESETS.map(p => p.key)).size === RL.PRESETS.length, `${RL.PRESETS.length} presets; ${bp.map(x => x.join(': ')).join('; ') || 'all valid'}`);
    // the world unit: the tide is the same (q / d^3 in true and world units)
    const w = RL.presetSpec('wd'), tideW = w.q / (w.peri ** 3), tideT = w.qTrue / ((w.peri / w.bodyR) ** 3);
    ok('rolls: the world unit of a white dwarf keeps the tide', rel(tideW, tideT) < 1e-12 && w.bodyR < 0.02, `q ${w.q} world, ${w.qTrue.toExponential(3)} true, drawn radius ${w.bodyR.toExponential(2)} world units; Roche limit ${w.LfTrue.toFixed(0)} radii = ${(w.LfTrue * w.Rtrue / 1e6).toFixed(2)} million km`); }

  // a settled pile for the layouts
  const N = 600, mat = P.MATERIALS.fluid, { C, sim } = settledPile(N, mat, 5, 4);
  const st0 = P.pileStats(sim.x, sim.mass), pos = Float64Array.from(sim.x);
  for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) pos[3 * i + k] -= st0.com[k];
  const pile = { pos, rad: Float64Array.from(sim.rad), mass: Float64Array.from(sim.mass), st: P.pileStats(pos, sim.mass) };
  const pl = P.planetFor(pile.st, { q: 1.2, s: 0.1, J2: 0 });
  const mk = (orbit, extra = {}) => { const o = IN.orbitStart3(pl, orbit); return Object.assign(o, { P: pl }, extra); };
  const mom = b => { let M = 0, p = [0, 0, 0], c = [0, 0, 0]; for (let i = 0; i < N; i++) { M += b.mass[i]; for (let k = 0; k < 3; k++) { p[k] += b.mass[i] * b.vel[3 * i + k]; c[k] += b.mass[i] * b.pos[3 * i + k]; } } return { M, p: Math.hypot(...p) / M, c: Math.hypot(...c) / M }; };
  const Lf = P.K_FLUID * Math.cbrt(1.2);
  // part sizes
  { const t = ['single', 'core', 'contact', 'binary', 'two', 'train'].map(type => [type, IN.partSizes({ type, k: 9, ratio: 0.3 }, 4096)]);
    ok('layouts: part sizes add up to N, each at least 256', t.every(([, s]) => s.reduce((a, b) => a + b, 0) === 4096 && s.every(n => n >= IN.MIN_PART)), t.map(([k, s]) => `${k} ${s.join('+')}`).join('; ')); }
  // orbits
  { const o1 = IN.orbitStart3(pl, { kind: 'circular', d: 2.5, inc: 157 * Math.PI / 180 });
    const o2 = IN.orbitStart3(pl, { kind: 'flyby', peri: 1.2, e: 0.6, r0: 9, inc: 0 });
    const el2 = P.keplerElements(o2.X, o2.V, pl.GM), apo = 1.2 * pl.Rp * 1.6 / 0.4;
    ok('orbits: tilt and backward orbit; an ellipse starts inside its apocentre', Math.abs(Math.acos(o1.n[2]) * 180 / Math.PI - 157) < 1e-9 && Math.hypot(...o2.X) <= 0.97 * apo + 1e-6 && rel(el2.e, 0.6) < 1e-9 && rel(el2.rp, 1.2 * pl.Rp) < 1e-9,
      `inclination ${(Math.acos(o1.n[2]) * 180 / Math.PI).toFixed(3)} deg; ellipse r0 ${(Math.hypot(...o2.X) / apo).toFixed(3)} of the apocentre, e ${el2.e.toFixed(6)}, q ${(el2.rp / pl.Rp).toFixed(6)} R_p`); }
  // single with spin modes: momentum zero, spin as asked, capped
  { const orb = mk({ kind: 'circular', d: 1.05 * Lf });
    const wb = Math.sqrt(4 * Math.PI / 3 * pile.st.rho);
    const res = ['sync', 'prograde', 'retrograde', 'tumbling'].map(mode => { const b = IN.buildStart(pile, { layout: { type: 'single' }, spin: { mode, k: 2 } }, orb, P.rng(3)); return [mode, b, mom(b)]; });
    const big = IN.spinVector({ mode: 'prograde', k: 50 }, orb.Omega, orb.n, pile.st.rho, P.rng(1));
    const w = r => Math.hypot(r[1].spin[0], r[1].spin[1], r[1].spin[2]);
    ok('layouts: one pile, every spin mode: no net momentum, spin rate as asked, capped at 0.7 of breakup', res.every(r => r[2].p < 1e-9 * pile.st.R * orb.Omega + 1e-12) && rel(w(res[0]), orb.Omega) < 1e-12 && rel(w(res[1]), 2 * orb.Omega) < 1e-12 && res[2][1].spin[2] < 0 && rel(Math.hypot(...big), 0.7 * wb) < 1e-12,
      res.map(r => `${r[0]} |w| ${(w(r) / orb.Omega).toFixed(2)} Omega`).join(', ') + `; cap ${(Math.hypot(...big) / wb).toFixed(2)} w_breakup`); }
  // contact binary: the lobes touch, none overlaps, it turns as one body
  { const orb = mk({ kind: 'circular', d: 1.05 * Lf });
    const b = IN.buildStart(pile, { layout: { type: 'contact', ratio: 0.7 }, spin: { mode: 'sync' } }, orb, P.rng(4));
    const n0 = b.parts[0].n; let gap = Infinity;
    for (let i = 0; i < n0; i++) for (let j = n0; j < N; j++) { const g = Math.hypot(b.pos[3 * i] - b.pos[3 * j], b.pos[3 * i + 1] - b.pos[3 * j + 1], b.pos[3 * i + 2] - b.pos[3 * j + 2]) - b.rad[i] - b.rad[j]; if (g < gap) gap = g; }
    const m = mom(b);
    ok('layouts: contact binary lobes touch without overlap, no net momentum', gap >= 0 && gap < 0.1 && m.p < 1e-9 && m.c < 1e-9, `closest gap between the lobes ${gap.toFixed(4)} grain radii; lobes ${b.parts.map(p => p.n).join(' + ')} grains`); }
  // binary: separation in range, circular mutual orbit; it stays at its
  // separation for a quarter orbit with no planet (CPU)
  { const orb = mk({ kind: 'circular', d: 2.4 * Lf });
    const b = IN.buildStart(pile, { layout: { type: 'binary', ratio: 0.5, sep: 2.5, tilt: 0.3 }, spin: { mode: 'sync' } }, orb, P.rng(5));
    const [p0, p1] = b.parts, M = p0.M + p1.M, D = b.parts.D, rs = p0.R + p1.R;
    const vrel = Math.hypot(...[0, 1, 2].map(k => p1.u[k] - p0.u[k]));
    const g = new P.CpuSim(N, b.rad, b.mass, C, { GM: 0, Rp: 1 });
    g.x.set(b.pos); g.v.set(b.vel); g.w.set(b.spin); g.init(null);
    const T = 2 * Math.PI * Math.sqrt(D ** 3 / M), nb = Math.ceil(0.25 * T / (C.dt * P.K_STEP));
    const sep = () => { const c = [0, 1].map(k => { let m = 0, x = [0, 0, 0]; const a = k ? p0.n : 0, e = k ? N : p0.n; for (let i = a; i < e; i++) { m += g.mass[i]; for (let q = 0; q < 3; q++) x[q] += g.mass[i] * g.x[3 * i + q]; } return x.map(q => q / m); }); return Math.hypot(c[0][0] - c[1][0], c[0][1] - c[1][1], c[0][2] - c[1][2]); };
    let dmin = Infinity, dmax = 0;
    for (let k = 0; k < nb; k++) { g.block(C.dt); const d = sep(); dmin = Math.min(dmin, d); dmax = Math.max(dmax, d); }
    ok('layouts: binary on a circular mutual orbit; it holds its separation (CPU, no planet)', D >= 1.15 * rs && D <= 0.6 * b.parts.rH + 1e-9 && rel(vrel, Math.sqrt(M / D)) < 1e-12 && dmin > 0.95 * D && dmax < 1.05 * D,
      `D = ${(D / rs).toFixed(2)} (R_1 + R_2) = ${(D / b.parts.rH).toFixed(2)} r_H; over ${(0.25).toFixed(2)} of a mutual orbit (${nb} blocks) the separation stays in ${(dmin / D).toFixed(3)}-${(dmax / D).toFixed(3)} D`); }
  // train: every fragment on the orbit of the frame point (same energy and
  // angular momentum about the planet), none touching
  { const orb = mk({ kind: 'flyby', peri: 0.6 * Lf, e: 1, r0: 1.25 * Lf });
    const b = IN.buildStart(pile, { layout: { type: 'train', k: 2, gap: 2.6 }, spin: { mode: 'tumbling', k: 1 } }, orb, P.rng(6));
    const E = (X, V) => 0.5 * (V[0] ** 2 + V[1] ** 2 + V[2] ** 2) - pl.GM / Math.hypot(...X);
    const Lz = (X, V) => X[0] * V[1] - X[1] * V[0];
    const e0 = E(orb.X, orb.V), l0 = Lz(orb.X, orb.V);
    const dev = b.parts.slice(1).map(p => { const X = [0, 1, 2].map(k => orb.X[k] + p.c[k]), V = [0, 1, 2].map(k => orb.V[k] + p.u[k]); return Math.max(Math.abs(E(X, V) - e0) / Math.abs(pl.GM / Math.hypot(...orb.X)), Math.abs(Lz(X, V) - l0) / Math.abs(l0)); });
    const dist = Math.hypot(...b.parts[1].c);
    ok('layouts: a train of fragments shares one orbit and does not touch', dev.every(d => d < 1e-8) && dist > b.parts[0].R + b.parts[1].R, `${b.parts.length} fragments; largest energy / angular momentum error ${Math.max(...dev).toExponential(2)}; first gap ${(dist / (b.parts[0].R + b.parts[1].R)).toFixed(2)} (R_0 + R_1)`); }
  // two moons: the second on its own circular orbit
  { const orb = mk({ kind: 'circular', d: 1.05 * Lf });
    const b = IN.buildStart(pile, { layout: { type: 'two', ratio: 0.7, d2: 1.12, phi: -0.6 }, spin: { mode: 'sync' } }, orb, P.rng(7));
    const X2 = [0, 1, 2].map(k => orb.X[k] + b.parts[1].c[k]), V2 = [0, 1, 2].map(k => orb.V[k] + b.parts[1].u[k]);
    const r2 = Math.hypot(...X2), vr = (X2[0] * V2[0] + X2[1] * V2[1] + X2[2] * V2[2]) / r2;
    ok('layouts: two moons, the second on a circular orbit 12% wider', rel(r2, 1.12 * Math.hypot(...orb.X)) < 1e-9 && Math.abs(vr) < 1e-9 * Math.hypot(...V2) && rel(Math.hypot(...V2), Math.sqrt(pl.GM / r2)) < 1e-9, `r_2 / r_1 = ${(r2 / Math.hypot(...orb.X)).toFixed(6)}, radial speed ${vr.toExponential(1)}`); }
  // core: the mass share of the core
  { const m = Float64Array.from(pile.mass), share = IN.coreMasses(pile.pos, m, 0.3, 3);
    const want = 0.9 / 1.6;
    ok('layouts: a core of 30% of the grains at 3x density holds about 56% of the mass', Math.abs(share - want) < 0.03, `core share ${(100 * share).toFixed(1)}% (uniform grains: ${(100 * want).toFixed(1)}%)`); }
  // clumps: two piles apart are two clumps; a lone grain is debris
  { const b = IN.buildStart(pile, { layout: { type: 'binary', ratio: 0.5, sep: 3 }, spin: { mode: 'sync' } }, mk({ kind: 'circular', d: 1.05 * Lf }), P.rng(8));
    b.pos[0] += 500;
    const r = IN.clumpMask(b.pos, b.mass, b.rad, 3, 0.05 * pile.st.M);
    let n = 0; for (const v of r.mask) n += v;
    ok('clumps: two separate piles are two clumps; a lone grain is not', r.clumps === 2 && n === N - 1 && r.mask[0] === 0, `${r.clumps} clumps, ${n} of ${N} grains in them`); }
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

// 11 ─ the screensaver reel and the shot plan (saver-plan.js, shot-geom.js)
function saverTests(cur) {
  const keys = seed => { const rs = { rnd: SP.rng(seed), bag: null, last: null }; return Array.from({ length: 40 }, () => SP.nextTake(rs).key + (rs.last.planet ? '@' + rs.last.planet : '')).join(' '); };
  ok('saver: the reel is seeded', keys(7) === keys(7) && keys(7) !== keys(8), `seed 7: ${keys(7).split(' ').slice(0, 5).join(' ')}; seed 8: ${keys(8).split(' ').slice(0, 5).join(' ')}`);
  // 1000 saver seeds, 12 takes each: every take valid, none twice in a
  // row, no planet twice in a row, rolls differ in planet and body
  let bad = [], twice = 0, samePl = 0, rollSame = 0, rolls = 0, takes = 0, minPl = Infinity;
  const seen = { planet: new Set(), body: new Set(), orbit: new Set(), kind: new Set() };
  for (let seed = 1; seed <= 1000; seed++) {
    const rs = { rnd: SP.rng(seed), bag: null, last: null }; let prev = null; const pl = new Set();
    for (let k = 0; k < 12; k++) {
      const e = SP.nextTake(rs); takes++; seen.kind.add(e.kind);
      let spec = null;
      if (e.kind === 'roll') { spec = e.spec; rolls++; if (prev && (spec.planet === prev.planet || spec.body === prev.body)) rollSame++; }
      else if (e.kind === 'preset') spec = RL.presetSpec(e.preset);
      else if (!SCENARIOS.find(x => x.key === e.scen)) bad.push(`${seed}: story ${e.key}`);
      if (spec) { const w = RL.checkSpec(spec); if (w) bad.push(`${seed}/${e.key}: ${w}`); seen.planet.add(spec.planet); seen.body.add(spec.body); seen.orbit.add(spec.orbitKind); }
      if (prev && prev.key === e.key) twice++;
      if (prev && prev.planet && e.planet && prev.planet === e.planet) samePl++;
      if (e.planet) pl.add(e.planet);
      prev = { key: e.key, planet: e.planet, body: e.body };
    }
    minPl = Math.min(minPl, pl.size);
  }
  ok('saver reel: 1000 seeds x 12 takes, every take a valid run', bad.length === 0, `${takes} takes (${rolls} fresh rolls); ${bad.slice(0, 3).join('; ') || 'all pass checkSpec'}`);
  ok('saver reel: no take twice in a row, no planet twice in a row', twice === 0 && samePl === 0 && rollSame === 0, `${twice} repeated takes, ${samePl} repeated planets, ${rollSame} rolls that share the planet or body of the take before`);
  ok('saver reel: varied (every planet, body and orbit; 5+ planets in 12 takes)', seen.planet.size === 10 && seen.body.size === 9 && seen.orbit.size === 6 && minPl >= 5 && seen.kind.size === 3, `${seen.planet.size} planets, ${seen.body.size} bodies, ${seen.orbit.size} orbits, kinds ${[...seen.kind].join('/')}; at least ${minPl} planets in each 12 takes`);
  // the shot plan against random event timelines, in 50 ms ticks: crack
  // at 0.5-4 s (or never: a weak roll), torn 2-8 s later, ring 4-12 s
  // after that, an impact in some runs
  let lens = [], minL = Infinity, maxL = 0, sameKind = 0, wrongPhase = 0, lateCut = 0, endT = 0, stallEnd = 0, impactOk = 0, impactRuns = 0, compactBad = 0, missed = 0;
  const kinds = new Set();
  for (let seed = 1; seed <= 1000; seed++) {
    const r = SP.rng(seed * 31 + 5), weak = r() < 0.1, compact = r() < 0.15;
    const tC = weak ? Infinity : 0.5 + 3.5 * r(), tT = tC + 2 + 6 * r(), tR = tT + 4 + 8 * r(), tI = r() < 0.4 ? tC + 1 + 10 * r() : Infinity;
    const phaseAt = t => t >= tR ? 'ring' : t >= tT ? 'torn' : t >= tC ? 'crack' : 'approach';
    const tk = SP.newTake(SP.rng(seed), { surface: !compact });
    let t = 0, prevKind = null, shotT = 0, lastPhase = 'approach', phaseT = 0, res;
    if (tI < Infinity && !compact) impactRuns++;
    while (t < 200) {
      const ph = phaseAt(t);
      if (ph !== lastPhase) { lastPhase = ph; phaseT = t; }
      res = SP.takeStep(tk, 0.05, { phase: ph, impact: t >= tI });
      if (res === 'end') break;
      if (res === 'cut') {
        const sh = tk.shot; kinds.add(sh.kind);
        if (tk.shots.length > 1) { const L = t - shotT; lens.push(L); minL = Math.min(minL, L); maxL = Math.max(maxL, L); }
        if (sh.kind === prevKind) sameKind++;
        if (sh.phase !== 'impact' && sh.phase !== ph) wrongPhase++;
        if (sh.kind === 'impact' && t >= tI) impactOk++;
        if ((sh.kind === 'surface' || sh.kind === 'impact') && compact) compactBad++;
        // a cut into a new phase comes at most CUT_MIN s after it starts
        // (or after an impact shot that started in it)
        if (sh.phase === ph && ph !== 'approach' && tk.shots.filter(x => x.phase === ph).length === 1 && t - phaseT > SP.CUT_MIN + 0.06) { const prevSh = tk.shots[tk.shots.length - 2]; if (!(prevSh && prevSh.kind === 'impact' && prevSh.from === ph)) lateCut++; }
        prevKind = sh.kind; shotT = t;
      }
      t += 0.05;
    }
    endT = Math.max(endT, t);
    if (weak && t <= SP.STALL + SP.CUT_MAX + 0.1) stallEnd++;
    if (!weak && tR + 2 * SP.CUT_MAX < 200 && !tk.shots.some(x => x.phase === 'ring')) missed++;
  }
  ok('shot plan: every shot lasts 5-12 s (cuts every 5-12 s)', minL >= SP.CUT_MIN - 1e-9 && maxL <= SP.CUT_MAX + 0.06, `${lens.length} shots, ${minL.toFixed(2)} to ${maxL.toFixed(2)} s, mean ${(lens.reduce((a, b) => a + b, 0) / lens.length).toFixed(2)} s`);
  ok('shot plan: cuts follow the events', sameKind === 0 && wrongPhase === 0 && lateCut === 0 && missed === 0, `${sameKind} repeated kinds, ${wrongPhase} shots of a phase that is over, ${lateCut} cuts more than ${SP.CUT_MIN} s after a new phase, ${missed} takes with no ring shot`);
  ok('shot plan: impacts get a shot; compact stars get no surface shot', impactOk >= 0.8 * impactRuns && compactBad === 0, `${impactOk} impact shots in ${impactRuns} runs with an impact; ${compactBad} surface shots at a compact star`);
  ok('shot plan: every take ends; a weak roll ends early; every kind plays', endT <= SP.TAKE_MAX + SP.CUT_MAX + 1 && stallEnd >= 1 && kinds.size === SP.KINDS.length, `longest take ${endT.toFixed(1)} s; ${stallEnd} weak rolls ended by ${SP.STALL + SP.CUT_MAX} s; kinds ${[...kinds].sort().join(' ')}`);
  { const tk = SP.newTake(SP.rng(9), { surface: true }, true); let t = 0, ends = 0, n = 0; while (t < 600) { const r = SP.takeStep(tk, 0.1, { phase: t < 3 ? 'approach' : t < 8 ? 'crack' : t < 14 ? 'torn' : 'ring', impact: false }); if (r === 'end') ends++; if (r === 'cut') n++; t += 0.1; }
    ok('shot plan: the Director view loops (never ends)', ends === 0 && n > 50, `${n} cuts in 600 s, ${ends} ends`); }
  // the poses: random scenes; the eye stays outside the planet, the
  // subject stays in the view (half the view height is 0.31 rad), and
  // the surface view puts its subject 12 deg above the horizon
  { let worst = 0, inside = 0, elevErr = 0, n = 0;
    const ang = (eye, a, b) => { const u = [0, 1, 2].map(i => a[i] - eye[i]), v = [0, 1, 2].map(i => b[i] - eye[i]); return Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / Math.hypot(...u) / Math.hypot(...v)))); };
    for (let seed = 1; seed <= 300; seed++) {
      const r = SP.rng(seed), d = 1.4 + 1.8 * r(), th = 6.283 * r(), c = [d * Math.cos(th), d * Math.sin(th), 0.05 * (r() - 0.5)];
      const v = [-Math.sin(th), Math.cos(th), 0.02].map(q => q * 0.8), Rw = 0.06 + 0.08 * r();
      const base = { target: c.slice(), dist: 1.5, az: 6.283 * r(), el: 0.3 };
      const fp = c.map((q, i) => q + [0.1, -0.05, 0.01][i]);
      for (const kind of ['surface', 'ride', 'impact', 'wide', 'push', 'skim', 'top']) {
        for (const phase of kind === 'surface' ? ['approach', 'ring'] : ['torn']) {
          const sh = Object.assign({ kind, phase, side: r() < 0.5 ? -1 : 1, len: 6 }, SP.SHOTS[kind]);
          const ctx = { base, prog: r(), c, v, frag: kind === 'ride' ? { p: fp, v } : null, bodyR: 1, ringR: 2, impact: kind === 'impact' ? [Math.cos(th), Math.sin(th), 0] : null, Rw };
          const g = SG.shotGoal(sh, ctx);
          const ce = Math.cos(g.el), eye = [g.target[0] + g.dist * ce * Math.cos(g.az), g.target[1] + g.dist * ce * Math.sin(g.az), g.target[2] + g.dist * Math.sin(g.el)];
          if (g.abs ? Math.hypot(...eye) < g.minR - 1e-9 || g.minR < 1.0 : g.minR < 1.3) inside++;
          const subj = kind === 'ride' ? fp : kind === 'impact' ? ctx.impact : kind === 'surface' && phase === 'ring' ? sh.ringDir.map(q => q * 2) : c;
          worst = Math.max(worst, ang(eye, g.target, subj)); n++;
          if (kind === 'surface') { const up = eye.map(q => q / Math.hypot(...eye)), w = subj.map((q, i) => q - eye[i]), e = Math.asin((w[0] * up[0] + w[1] * up[1] + w[2] * up[2]) / Math.hypot(...w)); elevErr = Math.max(elevErr, Math.abs(e - 12 * Math.PI / 180)); }
        }
      }
    }
    ok('shot poses: the eye stays outside the planet, the subject in view', inside === 0 && worst < 0.31, `${n} poses; ${inside} eyes inside (an offset shot has minR 1.3, which app/camera.js poseOf enforces); the subject at most ${(worst * 180 / Math.PI).toFixed(1)} deg off the view axis (half the view is 17.8)`);
    ok('shot poses: the surface view sees its subject 12 deg above the horizon', elevErr < 3 * Math.PI / 180, `worst error ${(elevErr * 180 / Math.PI).toFixed(2)} deg (the stand point is 4% of a radius above the plane)`); }
  // the presets and random runs of the reel: test 13 checks their specs,
  // test 15 runs them on the GPU
  for (const run of SP.RUNS) {
    const sc = SCENARIOS.find(x => x.key === run.scen);
    if (!sc || sc.kind !== 'spiral') continue;
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

// 14 ─ the renderer in Deno: every planet style (0-10) draws with no
// WebGPU error; a white dwarf smaller than a pixel still shows a bright
// core; the grains next to it are lit by it (style 9). An offscreen
// texture stands in for the canvas: no browser, no screenshot file.
async function renderTest() {
  if (typeof navigator === 'undefined' || !navigator.gpu) { console.log('SKIP  render test: no navigator.gpu here'); return; }
  const { Renderer, loadRenderCode } = await import('./render.js');
  const { SimGPU, loadSimCode } = await import('./engine.js');
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const errs = []; device.addEventListener?.('uncapturederror', e => errs.push(String(e.error?.message || e)));
  const W = 320, H = 200, fmt = 'rgba8unorm';
  const tex = device.createTexture({ size: [W, H], format: fmt, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const ren = new Renderer(device, { getCurrentTexture: () => tex }, fmt, await loadRenderCode(), { gridN: 256 });
  ren.resize(W, H, 1);
  const msgs = (await ren.compilationMessages()).filter(m => / error /.test(m));
  // a small pile 3 world units out on +x
  const N = 300, { cl, sim } = settledPile(N, P.MATERIALS.fluid, 3, 2);
  const gpu = new SimGPU(device, N, await loadSimCode());
  const z = new Float64Array(N * 3);
  gpu.setParams(P.contactParams(N, P.MATERIALS.fluid), { GM: 0, Rp: 1 }, 0); gpu.setState(sim.x, z, z, cl.rad, cl.mass);
  const e = ren.addSim(gpu); ren.setTags(e, new Float32Array(gpu.np).fill(1));
  const k = 0.2 / P.expectedRadius(N);
  const frame = (style, bodyR, eye) => ({ eye, target: [0, 0, 0], fov: 0.62, near: 0.01, time: 1, sun: [-0.024, 0.825, 0.565], sunI: 1.45, atm: 0.05, spin: 0, style, shine: 0.25,
    flattening: 0, realRings: 0, sat: [3, 0, 0], satR: 0.2, GMs: 0, GMp: 0, omega: 0, phiL1: 0, fieldMode: 0, fieldExt: 4, fieldScale: 1, fieldAlpha: 0,
    ringExt: 3.6, ringGain: 2, ringBlend: 0.9, ringOn: true, exposure: 0.88, bloom: 0.08, bloomThreshold: 1, vignette: 0.32, grainR: k, bodyR });
  const sims = [{ e, ring: true, frame: [3, 0, 0, k], refV: [0, 0, 0, 0], motion: [0, 6, 0.08, 1], opts: [4, 0, 1, 1], tint: [0.78, 0.9, 1, 1], heatInv: 1, simT: 0, flashT: 0, strain: 1 }];
  const read = async () => {
    const bpr = Math.ceil(W * 4 / 256) * 256, buf = device.createBuffer({ size: bpr * H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder(); enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr }, [W, H]); device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ); const px = new Uint8Array(buf.getMappedRange().slice(0)); buf.unmap(); buf.destroy();
    return (x, y) => { const o = y * bpr + 4 * x; return (px[o] + px[o + 1] + px[o + 2]) / 3; };
  };
  // where the pile lands on screen: the brightest pixel in a box round it
  const region = (at, cx, cy, r) => { let m = 0, s = 0; for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) { const v = at(x, y); m = Math.max(m, v); s += v; } return { max: m, mean: s / (2 * r + 1) ** 2 }; };
  const eye = [0.5, -9, 1.2];
  let styles = [];
  for (let st = 0; st <= 10; st++) { ren.render(frame(st, st >= 9 ? 0.0153 : 1, eye), sims); const at = await read(); styles.push(Math.round(at(W / 2, H / 2))); }
  ok('render: every planet style (0-10) draws with no WebGPU error', errs.length === 0 && msgs.length === 0, `centre brightness by style ${styles.join(' ')}; ${errs.concat(msgs).join(' | ') || 'no errors'}`);
  // a white dwarf 0.0153 world units across, 9 units away: under one pixel
  const prj = p => ren.project(p, W, H);
  ren.render(frame(9, 0.0153, eye), sims); let at = await read();
  const c = prj([0, 0, 0]), pp = prj([3, 0, 0]);
  const core = at(Math.round(c.x), Math.round(c.y)), lit9 = region(at, Math.round(pp.x), Math.round(pp.y), 3);
  // the same pile under a planet with the sun behind it (style 0) and
  // under a white dwarf: the white dwarf lights the side facing it
  ok('render: a white dwarf under one pixel still shows a bright core', core > 200 && ren.focal * 0.0153 / 9 < 1, `disc ${(ren.focal * 0.0153 / 9).toFixed(2)} px wide, core brightness ${core.toFixed(0)} of 255`);
  ok('render: grains near a white dwarf are lit by it', lit9.max > 60, `brightest grain pixel ${lit9.max.toFixed(0)}, mean ${lit9.mean.toFixed(1)} round the pile`);
  // the age and origin colours (modes 5 and 6): cs_smooth stamps each
  // grain's side of the moon on the stamp frame, and the shed time when
  // the tag says shed; a bound tag clears it
  const readStress = async () => {
    const buf = device.createBuffer({ size: gpu.np * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder(); enc.copyBufferToBuffer(e.stress, 0, buf, 0, gpu.np * 16); device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ); const a = new Float32Array(buf.getMappedRange().slice(0)); buf.unmap(); buf.destroy(); return a;
  };
  const Rs = P.expectedRadius(N), sim5 = Object.assign({}, sims[0], { opts: [6, 0, 1, 1], stamp: true, invRs: 1 / Rs, invT0: 1, simT: 0.25 });
  ren.render(frame(1, 1, eye), [sim5]);
  let st4 = await readStress(), cxz = 0, nz = 0, zmin = 1, zmax = -1;
  for (let i = 0; i < N; i++) { const zz = st4[4 * i + 2]; cxz += zz * sim.x[3 * i]; nz += sim.x[3 * i] * sim.x[3 * i]; zmin = Math.min(zmin, zz); zmax = Math.max(zmax, zz); }
  // the planet is at the origin, the pile at +x: the side facing it has x < 0
  const slope = cxz / nz * Rs;
  ok('render: the origin colour stamps each grain\'s side of the moon', Math.abs(slope + 1) < 0.02 && zmin < -0.8 && zmax > 0.8, `origin = ${slope.toFixed(3)} x / R_s (want -1), range ${zmin.toFixed(2)} to ${zmax.toFixed(2)}`);
  ren.setTags(e, new Float32Array(gpu.np).fill(0));
  ren.render(frame(1, 1, eye), [Object.assign({}, sim5, { opts: [5, 0, 1, 1], stamp: false, simT: 0.5 })]);
  ren.render(frame(1, 1, eye), [Object.assign({}, sim5, { opts: [5, 0, 1, 1], stamp: false, simT: 0.7 })]);
  st4 = await readStress();
  let shedOk = 0, keepOrg = 0; for (let i = 0; i < N; i++) { if (st4[4 * i + 3] === 0.5) shedOk++; if (Math.abs(st4[4 * i + 2] + sim.x[3 * i] / Rs) < 0.05 || Math.abs(st4[4 * i + 2]) === 1) keepOrg++; }
  ren.setTags(e, new Float32Array(gpu.np).fill(1));
  ren.render(frame(1, 1, eye), [Object.assign({}, sim5, { opts: [5, 0, 1, 1], stamp: false, simT: 0.8 })]);
  st4 = await readStress();
  let cleared = 0; for (let i = 0; i < N; i++) if (st4[4 * i + 3] === 0) cleared++;
  ok('render: the age colour keeps the shed time; a bound grain clears it', shedOk === N && cleared === N && keepOrg === N, `${shedOk} of ${N} stamped at t = 0.5 (not 0.7), ${cleared} cleared when bound again, ${keepOrg} kept their origin`);
  ok('render: no WebGPU validation errors', errs.length === 0, errs.join(' | ') || 'none');
  gpu.destroy(); device.destroy();
}

// 15 ─ the presets on the GPU through the page's own run code (Deno):
// app/runs.js startRun, the settle, placeSats, the engine, worker.js and
// app/history.js readAll, with the DOM stubbed and an offscreen renderer.
// Each preset runs to one orbit past its spiral end or its closest pass;
// the test checks the physics outcome that its card claims.
function domStub() {
  const el = () => new Proxy(function () {}, {
    get: (t, k) => k === 'children' ? [] : k === 'style' ? {} : k === 'classList' ? { add() {}, remove() {}, toggle() {}, contains: () => true }
      : k === Symbol.iterator ? [][Symbol.iterator] : k === Symbol.toPrimitive ? () => 0 : (k === 'textContent' || k === 'innerHTML' || k === 'value') ? '' : (k === 'clientWidth' || k === 'clientHeight') ? 0 : k === 'then' ? undefined : el(),
    set: () => true, apply: () => el(),
  });
  const mq = () => ({ matches: false, addEventListener() {} });
  globalThis.window = globalThis.window || { matchMedia: mq, devicePixelRatio: 1, addEventListener() {} };
  globalThis.document = { getElementById: () => el(), querySelector: () => el(), querySelectorAll: () => [], createElement: () => el(), body: el(), documentElement: { classList: { add() {}, remove() {}, toggle() {} } } };
}
async function rollRunTests(keys) {
  if (typeof navigator === 'undefined' || !navigator.gpu) { console.log('SKIP  preset runs: no navigator.gpu here'); return; }
  domStub();
  const { S } = await import('./app/state.js');
  const { UI } = await import('./app/env.js');
  const R = await import('./app/runs.js');
  const H = await import('./app/history.js');
  const { workerJobs } = await import('./app/jobs.js');
  const { Renderer, loadRenderCode } = await import('./render.js');
  const { loadSimCode } = await import('./engine.js');
  const adapter = await navigator.gpu.requestAdapter();
  S.dev = await adapter.requestDevice();
  const errs = []; S.dev.addEventListener?.('uncapturederror', e => errs.push(String(e.error?.message || e)));
  S.simCode = await loadSimCode();
  const tex = S.dev.createTexture({ size: [64, 64], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT });
  S.ren = new Renderer(S.dev, { getCurrentTexture: () => tex }, 'rgba8unorm', await loadRenderCode(), { gridN: 128 });
  S.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  S.worker.onmessage = e => { const j = workerJobs.get(e.data.id); workerJobs.delete(e.data.id); if (j) j(e.data); };
  UI.N = 4096; UI.quality = 'medium';
  const G = P.G;
  let weak = [], nSeeds = 0;
  // the cutting director (app/cuts.js) in the Director view, driven by
  // the run: wall time per block from the speed the shot asks for
  const CU = await import('./app/cuts.js'), DI = await import('./app/director.js'), LO = await import('./app/loop.js');
  const dirStat = { runs: 0, cuts: 0, bad: [], phases: new Set(), kinds: new Set(), tornCut: 0, torn: 0, rideFrag: 0, rides: 0, probes: [] };
  for (const key of keys) {
    if (!key) continue;
    const seed = key.startsWith('seed:') ? +key.slice(5) : null, scen = key.startsWith('scen:') ? key.slice(5) : null;
    const t0 = Date.now();
    // scen:<key>: a first scenario (the code path before the rolls). The
    // gallery path, applyScenario, sets q, the material and the orbit in
    // UI; before 2026-10-11 the test set only UI.scen, so each scenario
    // ran with the q, the material and the orbit left in UI (q = 1 here)
    if (scen) (await import('./app/controls.js')).applyScenario(scen); else UI.roll = seed !== null ? RL.rollRun(seed) : RL.presetSpec(key);
    const spec = R.currentSpec();
    await R.startRun(spec);
    const run = S.run;
    if (run.phase === 'settle') { while (!R.settleStep(24)) await S.dev.queue.onSubmittedWorkDone(); await R.placeSats(run.serial); }
    const s = run.sats[0], T0 = run.T0;
    UI.cam = 'cut'; UI.calm = false; UI.paused = false; S.cuts = null;
    const dirRun = { kinds: [], tornAt: null, cutAfterTorn: false, wallAfter: 0 };
    // the end: one orbit after the drag stops, or after the closest pass
    // (the first flyby scenario runs 3 orbits after, for the chain)
    let tEnd = spec.kind === 'flyby' ? run.tPeri + (scen ? 3 : 1) * T0 : spec.kind === 'spiral' ? Infinity : 6 * T0, dragOff = null, reads = 0, fMin = 1, maxGroups = 0;
    while (S.run.t < tEnd && S.run.t < 12 * T0) {
      if (spec.kind === 'spiral' && s.pl.drag > 0 && Math.hypot(...s.ref.X) < spec.d1 * s.Rp) { s.pl.drag = 0; s.gpu.setParams(s.C, s.pl, 0); }
      if (spec.kind === 'spiral' && s.pl.drag === 0 && dragOff === null) { dragOff = S.run.t; tEnd = dragOff + 1.0 * T0; }
      const enc = S.dev.createCommandEncoder(); for (const q of run.sats) q.gpu.encodeSteps(enc, 512, true); S.dev.queue.submit([enc.finish()]);
      S.run.t = s.gpu.t;
      if (++reads % 8 === 0) { await H.readAll(true); if (s.an) { fMin = Math.min(fMin, s.an.f); maxGroups = Math.max(maxGroups, s.an.groups); } }
      // the director: the wall time of this block at the speed it asks for
      if (run.pace) {
        run.pace.factor = run.pace.target;
        const opm = LO.orbitsPerMin(), wall = Math.min(1, 512 * s.C.dt / (opm / 60 * T0));
        const r = CU.cutsTick(wall);
        const sh = CU.curShot();
        if (dirRun.tornAt !== null) dirRun.wallAfter += wall;
        if (r === 'cut') { dirStat.cuts++; dirRun.kinds.push(sh.kind); dirStat.kinds.add(sh.kind); dirStat.phases.add(sh.phase); if (dirRun.tornAt !== null) dirRun.cutAfterTorn = true; if (sh.kind === 'ride') dirStat.rides++; }
        if (run.story.torn !== undefined && dirRun.tornAt === null) dirRun.tornAt = run.t;
        if (sh) {
          const g = CU.cutCamera(DI.storyGoal(wall));
          const ce = Math.cos(g.el), eye = [g.target[0] + g.dist * ce * Math.cos(g.az), g.target[1] + g.dist * ce * Math.sin(g.az), g.target[2] + g.dist * Math.sin(g.el)];
          const fine = [...g.target, g.dist, g.az, g.el].every(Number.isFinite) && g.dist > 0;
          if (!fine || (g.abs && Math.hypot(...eye) < g.minR - 1e-6)) dirStat.bad.push(`${key}: ${sh.kind} ${fine ? 'eye inside' : 'not finite'}`);
          if (sh.kind === 'ride' && S.cuts.frag && sh.phase === 'torn') dirStat.rideFrag++;
        }
      }
    }
    dirStat.runs++;
    // a run that goes on for CUT_MIN s of wall time after the tear must cut
    if (dirRun.tornAt !== null && dirRun.wallAfter > SP.CUT_MIN + 0.5) { dirStat.torn++; if (dirRun.cutAfterTorn) dirStat.tornCut++; }
    await H.readAll(true);
    // a ride's fragment: picked from the analysis, moved on by its own
    // orbit for 1024 steps; the grain it was picked from must stay with it
    // (within 8% of the distance moved: the stream's own pull and the
    // contacts are not in the fragment's orbit), and the next read puts
    // the ride back on the grain
    if (s.an && s.an.f < 0.75 && S.cuts) {
      const p0 = CU.rideProbe();
      if (p0) {
        // the grain that was picked: the one at the fragment's point now
        const at = (rb, i) => [0, 1, 2].map(k => (rb.X[k] + rb.body[12 * i + k]) * s.k);
        const rb0 = await s.gpu.readback(false); let i0 = -1, d0 = Infinity;
        for (let i = 0; i < s.N; i++) { const d = Math.hypot(...at(rb0, i).map((q, k) => q - p0.p[k])); if (d < d0) { d0 = d; i0 = i; } }
        const enc = S.dev.createCommandEncoder(); for (const q of run.sats) q.gpu.encodeSteps(enc, 1024, false); S.dev.queue.submit([enc.finish()]); S.run.t = s.gpu.t;
        const p1 = CU.rideProbe(true), rb1 = await s.gpu.readback(false);
        const dmin = Math.hypot(...at(rb1, i0).map((q, k) => q - p1.p[k]));
        // a read puts the ride back on the grain's own state
        await H.readAll(true);
        const p2 = CU.rideProbe(true), rb2 = await s.gpu.readback(false);
        const dsync = p2 ? Math.hypot(...at(rb2, i0).map((q, k) => q - p2.p[k])) : Infinity;
        dirStat.probes.push({ key, moved: Math.hypot(...[0, 1, 2].map(k => p1.p[k] - p0.p[k])), dmin, d0, dsync });
      }
    }
    // the state at the end, in the planet frame
    const rb = await s.gpu.readback(false), N = s.N, pos = new Float64Array(N * 3), vel = new Float64Array(N * 3), m = new Float64Array(N);
    for (let i = 0; i < N; i++) { for (let k = 0; k < 3; k++) { pos[3 * i + k] = rb.body[12 * i + k]; vel[3 * i + k] = rb.body[12 * i + 4 + k]; } m[i] = rb.body[12 * i + 7]; }
    const fin = pos.every(Number.isFinite) && vel.every(Number.isFinite);
    const cm = IN.clumpMask(pos, m, s.rad, 3, 0.03 * s.Mtot, N);
    // the clumps: mass, and the orbital energy about the planet of each
    const parent = new Map();
    { // group the clumped grains by a flood fill on the clump mask (friends of friends again)
      const link = 2 * P.R_MAX * 1.1 + 0.1; const idx = []; for (let i = 0; i < N; i++) if (cm.mask[i]) idx.push(i);
      const seen = new Set();
      for (const i0 of idx) { if (seen.has(i0)) continue; const g = [i0]; seen.add(i0);
        for (let q = 0; q < g.length; q++) { const i = g[q]; for (const j of idx) { if (seen.has(j)) continue; const d = Math.hypot(pos[3 * i] - pos[3 * j], pos[3 * i + 1] - pos[3 * j + 1], pos[3 * i + 2] - pos[3 * j + 2]); if (d < link * 1.0 + 0.1) { seen.add(j); g.push(j); } } }
        parent.set(i0, g); }
    }
    const clumps = [...parent.values()].map(g => { let M = 0, c = [0, 0, 0], v = [0, 0, 0]; for (const i of g) { M += m[i]; for (let k = 0; k < 3; k++) { c[k] += m[i] * pos[3 * i + k]; v[k] += m[i] * vel[3 * i + k]; } }
      c = c.map((q, k) => rb.X[k] + q / M); v = v.map((q, k) => rb.V[k] + q / M);
      const E = 0.5 * (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) - s.pl.GM / Math.hypot(...c);
      const core = g.reduce((a, i) => a + (m[i] > 1.5 * P.RHO_GRAIN * 4 / 3 * Math.PI * P.R_MAX ** 3 ? m[i] : 0), 0) / M;
      return { M: M / s.Mtot, E, r: Math.hypot(...c) / s.Rp / (spec.bodyR || 1), core };
    }).sort((a, b) => b.M - a.M);
    const hits = m.reduce((a, q) => a + (q === 0 ? 1 : 0), 0);
    const info = `${(Date.now() - t0) / 1000 | 0} s wall, ${(S.run.t / T0).toFixed(2)} T0 (pass at ${run.tPeri !== undefined ? (run.tPeri / T0).toFixed(2) : "-"}); end: el ${s.an ? s.an.el.toFixed(2) : "-"}, groups ${s.an ? s.an.groups : "-"}, d ${(Math.hypot(...rb.X) / s.Rp).toFixed(2)}; f_min ${(100 * fMin).toFixed(0)}%, ${clumps.length} clumps (largest ${clumps.slice(0, 3).map(c => (100 * c.M).toFixed(0) + '%' + (c.core ? ` core ${(100 * c.core).toFixed(0)}%` : '')).join(', ')}), ${hits} grains hit`;
    // a full grid bucket (hash collisions, engine.js CAP = 16) drops a
    // grain from the lists of one rebuild (8 steps). The count adds up over
    // the run (thousands of rebuilds); up to N / 200 events are allowed
    // (didymos gave 1 to 6 in the runs of 2026-10-11)
    let pass = fin && errs.length === 0 && rb.overflow <= N / 200 && rb.listFull === 0, claim = '';
    if (!fin || rb.overflow || rb.listFull) claim = `[finite ${fin}, bucket overflow ${rb.overflow}, list full ${rb.listFull}] `;
    if (scen === 'compare') { const f2 = run.sats[1].an ? run.sats[1].an.f : 1; pass = pass && fMin < 0.75 && f2 > 0.9; claim += `the loose moon is torn (${(100 * fMin).toFixed(0)}%), the rough one holds (${(100 * f2).toFixed(0)}%)`; }
    else if (scen === 'flyby') {
      // the card says the comet breaks into a string of pearls: under 75%
      // still bound three T_q after the pass, in 5 or more groups. Before
      // 2026-10-11 the harness ran this story with q = 1 (see above), the
      // comet kept all its mass, and the check was only a note
      const fEnd = s.an ? s.an.f : 1, ng = s.an ? s.an.groups : 0;
      pass = pass && fEnd < 0.75 && ng >= 5;
      claim += `the comet is torn into a chain: ${(100 * fEnd).toFixed(0)}% bound, ${ng} groups, three T_q after the pass`;
    }
    else if (scen) { const fEnd = s.an ? s.an.f : 1; pass = pass && Math.min(fMin, fEnd) < 0.75; claim += `the first scenario still tears its moon (${(100 * Math.min(fMin, fEnd)).toFixed(0)}% bound)`; }
    else if (seed !== null) {
      claim += `"${spec.title}" runs with finite values and no errors`;
      // a weak roll: nothing much happens in the first orbit after the pass
      // or the spiral end (no tear, no hits, no capture)
      nSeeds++;
      const fEnd = s.an ? s.an.f : 1;
      if (Math.min(fMin, fEnd) > 0.5 && hits < 0.02 * N && !spec.capture) weak.push(`${key} (${spec.orbitKind}, f_min ${(100 * fMin).toFixed(0)}%)`);
    }
    else if (key === 'triton') { const two = clumps.filter(c => c.M > 0.1); const bnd = two.filter(c => c.E < 0).length, unb = two.filter(c => c.E > 0).length; pass = pass && bnd >= 1 && unb >= 1; claim += `one body bound, one unbound: ${two.map(c => `${(100 * c.M).toFixed(0)}% E ${c.E < 0 ? '<' : '>'} 0`).join(', ')}`; }
    else if (key === 'mantle') {
      // the core share of the mass at the start, and in the largest piece now
      const L = spec.layout, c00 = L.frac * L.factor / (L.frac * L.factor + 1 - L.frac), c0 = clumps[0];
      pass = pass && c0 && c0.M > 0.3 && c0.core > 1.2 * c00;
      claim += `the mantle goes, the core holds: the largest piece is ${c0 ? (100 * c0.M).toFixed(0) : '-'}% of the mass and ${c0 ? (100 * c0.core).toFixed(0) : '-'}% core (${(100 * c00).toFixed(0)}% at the start)`;
    }
    else if (key === 'sl9' || key === 'skim') { pass = pass && hits > 0.02 * N; claim += `grains hit the planet: ${hits}`; }
    else if (key === 'didymos') { pass = pass && fMin < 0.75; claim += 'the pair is split and stretched'; }
    else if (spec.kind === 'flyby') {
      // a stream of touching grains is one friends-of-friends group, so
      // the test reads the bound mass (Hill sphere and energy) at the end
      const fEnd = s.an ? s.an.f : 1;
      pass = pass && fEnd < 0.75; claim += `torn on the pass: ${(100 * fEnd).toFixed(0)}% still bound at the end`;
    }
    else { pass = pass && fMin < 0.75; claim += 'torn: the bound share falls under 75%'; }
    ok(`${seed !== null ? 'random run' : scen ? 'scenario run' : 'preset run'} "${key}" on the GPU: ${claim}`, pass, info + (errs.length ? ' | ' + errs.join(' | ') : ''));
  }
  // the screensaver with Reduce motion: the camera keeps the planet view,
  // and the take must still end (app/camera.js runs the shot clock)
  if (S.run && S.run.pace) {
    const CA = await import('./app/camera.js');
    S.saverOn = true; S.saver = { state: 'show', rnd: SP.rng(1), calm: 1, fade: 1, speed: 7 }; UI.calm = true; S.cuts = null;
    let wall = 0, shots = 0, story = 0;
    while (wall < 80 && !(S.cuts && S.cuts.take.done)) { CA.cameraFrame(0.05, 640, 360); if (CA.storyActive()) story++; wall += 0.05; }
    shots = S.cuts ? S.cuts.take.shots.length : 0;
    ok('screensaver with Reduce motion: the take still ends, the camera stays calm', !!(S.cuts && S.cuts.take.done) && story === 0 && LO.orbitsPerMin() <= 7 * 1.5 + 1e-9, `ended after ${wall.toFixed(1)} s of wall time and ${shots} shots; ${story} story-camera frames; speed ${LO.orbitsPerMin().toFixed(2)} orbits/min`);
    S.saverOn = false; S.saver = null; UI.calm = false; S.cuts = null;
  }
  // the protocol: enter() returns the page canvas and a warm-up, starts
  // a seeded take, and exit() gives back the view settings of the user
  {
    const ST = await import('./app/state.js'); ST.bootDone();
    await import('./app/saver.js');
    const before = { N: 16384, pred: true, hill: true, track: true, cam: 'planet', color: 0, field: 1, ringGain: 1 };
    Object.assign(UI, before);
    let r = null, err = '';
    try { r = await window.snSaver.enter({ calm: 0.5, seed: 1234 }); } catch (e) { err = String(e && e.message || e); }
    const inTake = UI.N <= 8192 && UI.cam === 'story' && UI.pred === false;
    const take = window.snSaver.debug && window.snSaver.debug();
    window.snSaver.exit();
    const back = Object.keys(before).filter(k => UI[k] !== before[k]);
    ok('screensaver protocol: enter returns the canvas and a warm-up; exit gives back the view settings', !err && r && !!r.canvas && r.warmupMs > 0 && inTake && back.length === 0,
      `${err || ''}take ${take && take.take}, during the take N ${inTake ? '<= 8192, story camera' : 'not set'}; changed after exit: ${back.join(' ') || 'none'}`);
    if (S.run) await new Promise(res => setTimeout(res, 50));
  }
  if (dirStat.runs) ok('Director view on the GPU runs: cuts on events, every pose finite and outside the planet', dirStat.bad.length === 0 && dirStat.tornCut === dirStat.torn && dirStat.phases.size >= 3, `${dirStat.runs} runs, ${dirStat.cuts} cuts; ${dirStat.tornCut} of ${dirStat.torn} runs that go on ${SP.CUT_MIN} s past the tear cut after it; phases ${[...dirStat.phases].join(' ')}; kinds ${[...dirStat.kinds].sort().join(' ')}; ${dirStat.rideFrag} ride frames on a fragment in ${dirStat.rides} rides; ${dirStat.bad.slice(0, 3).join('; ') || 'no bad pose'}`);
  if (dirStat.probes.length) { const pr = dirStat.probes, bad = pr.filter(q => !(q.d0 < 1e-4 && q.dmin < 0.08 * q.moved && q.dsync < 1e-4));
    ok('Director ride: the fragment\'s own orbit follows its grain', bad.length === 0, `${pr.length} runs; the picked grain found at ${Math.max(...pr.map(q => q.d0)).toExponential(1)}; moved ${Math.min(...pr.map(q => q.moved)).toFixed(3)}-${Math.max(...pr.map(q => q.moved)).toFixed(3)} world units in 1024 steps, off its grain by ${Math.max(...pr.map(q => q.dmin / q.moved * 100)).toFixed(2)}% of that at worst (limit 8%), back on it after a read: ${Math.max(...pr.map(q => q.dsync)).toExponential(1)}${bad.length ? '; off: ' + bad.map(q => q.key).join(' ') : ''}`); }
  if (nSeeds) ok('random runs: at most a quarter are weak (no tear, hit or capture in one orbit)', weak.length <= nSeeds / 4, `${weak.length} of ${nSeeds} weak${weak.length ? ': ' + weak.join(', ') : ''}`);
  for (const q of S.run.sats) q.gpu.destroy();
  S.worker.terminate(); S.dev.destroy();
}

// 16 ─ the link (node, DOM stubbed): ?seed= at boot loads that roll and
// stays in the URL; a story from the gallery clears it; ?run= loads a
// preset. buildUI read the link after applyScenario had cleared it,
// before 2026-10-11 (found in review).
async function linkTests() {
  const el = () => new Proxy(function () {}, { get: (t, k) => k === 'children' ? [] : k === 'style' ? {} : k === 'classList' ? { add() {}, remove() {}, toggle() {}, contains: () => true } : k === Symbol.iterator ? [][Symbol.iterator] : k === Symbol.toPrimitive ? () => 0 : (k === 'textContent' || k === 'innerHTML' || k === 'value') ? '' : k === 'then' ? undefined : el(), set: () => true, apply: () => el() });
  const mq = () => ({ matches: false, addEventListener() {} });
  globalThis.window = globalThis.window || { matchMedia: mq, devicePixelRatio: 1 };
  globalThis.window.addEventListener = globalThis.window.addEventListener || (() => {});
  globalThis.document = { getElementById: () => el(), querySelector: () => el(), querySelectorAll: () => [], createElement: () => el(), body: el(), documentElement: { classList: { add() {}, remove() {}, toggle() {} } } };
  let href = 'https://davesgames.io/stella-nova/pages/roche-limit/?seed=4242';
  globalThis.location = { get href() { return href; }, get search() { return new URL(href).search; } };
  globalThis.history = { state: null, replaceState(st, t, u) { href = String(u); } };
  const C = await import('./app/controls.js'), { UI } = await import('./app/env.js'), { S } = await import('./app/state.js');
  S.run = null;   // the camera test leaves its run here
  C.buildUI();
  const boot = UI.roll && UI.roll.seed === 4242 && /seed=4242/.test(href);
  C.applyScenario('flyby');
  const cleared = UI.roll === null && !/seed=/.test(href);
  href = 'https://davesgames.io/stella-nova/pages/roche-limit/?run=triton';
  const sp = C.urlSpec(); if (sp) C.applyRoll(sp);
  const preset = sp && sp.preset === 'triton' && /run=triton/.test(href);
  ok('link: ?seed= loads its roll at boot, a story clears it, ?run= loads a preset', boot && cleared && preset, `boot ${boot}, cleared ${cleared}, preset ${preset}`);
}

const ARGS = typeof Deno !== 'undefined' ? Deno.args : process.argv.slice(2);
const PACE_ONLY = ARGS.includes('--pace') || ARGS.includes('--pace-old');
const START_ONLY = ARGS.includes('--start');
const CAMERA = typeof Deno === 'undefined';   // the camera test imports app/ with DOM stubs: node only
if (!GPU_ONLY) {
  const t0 = Date.now();
  if (START_ONLY) startTests();
  else if (ARGS.includes('--link')) await linkTests();
  else {
    if (!PACE_ONLY) { cpuTests(); budgetTests(); startTests(); if (CAMERA) await layoutTests(); }
    await paceTests(ARGS.includes('--pace-old'));
    if (CAMERA && !PACE_ONLY) await linkTests();
  }
  console.log(`CPU tests: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
if (typeof Deno !== 'undefined') {
  const only = ARGS.find(a => a.startsWith('--rolls='));
  if (only) await rollRunTests(only.slice(8).split(','));
  else { await gpuTest(); await renderTest(); if (!ARGS.includes('--no-rolls')) await rollRunTests(['scen:saturn', 'scen:flyby', 'scen:compare', ...RL.PRESETS.map(p => p.key), ...Array.from({ length: 16 }, (_, i) => 'seed:' + (i + 1))]); }
}
else if (PACE_ONLY || START_ONLY || ARGS.includes('--link')) {}
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
