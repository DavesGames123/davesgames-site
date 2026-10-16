// THERMAL CONVECTION · tests/sim.test.mjs — package SIM: sim/params.js,
// sim/ref.js (the CPU spec of the solver) and, when present, the WGSL and
// sim/gpu.js. No browser. Run through ../tests.mjs, or alone:
//   node -e "import('./tests/sim.test.mjs').then(m => m.default((n, c, i) => console.log(c ? 'ok  ' : 'FAIL', n, i || '')))"
import { DEFAULTS, PRESETS, GRIDS, TRACERS, clampParams, planFrame, cflDt, DT_MAX, MAX_FRAME_DT, TIME_RATE, RA_CRIT } from '../sim/params.js';
import { createRefSim, fftLine, radices, initialState, derived } from '../sim/ref.js';

const finite = a => { for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false; return true; };

function growth(opts, p, dt, t1) {
  const r = createRefSim(opts, Object.assign({ noise: 1e-3 }, p));
  const n = Math.round(t1 / dt);
  for (let s = 0; s < n; s++) r.step(dt);
  const k1 = r.stats().ke;
  for (let s = 0; s < n; s++) r.step(dt);
  return Math.log(r.stats().ke / k1) / (2 * t1); // growth rate of the amplitude
}

export default async function (ok) {
  // ── params ──
  const d = clampParams({});
  ok('sim params: clampParams({}) gives the contract defaults',
    d.Ra === 1e5 && d.Pr === 1 && d.Ma === 80 && d.mode === 'plate' && d.top === 'free' && d.burner.r === 0.12 && d.Lx === 4);
  const c = clampParams({ Ra: 1e9, Pr: -1, Ma: 999, mode: 'x', top: 'y', speed: NaN, burner: { x: 1.25 } });
  ok('sim params: clampParams clamps and repairs bad values',
    c.Ra === 1e7 && c.Pr === 0.1 && c.Ma === 200 && c.mode === 'plate' && c.top === 'free' && c.speed === 1 && c.burner.x === 0.25, JSON.stringify(c));
  const want = ['granulation', 'soup', 'benard', 'hexagons', 'onset', 'turbulent'];
  ok('sim params: the six contract presets exist with params, palette and view',
    want.every(k => PRESETS[k] && PRESETS[k].params && PRESETS[k].palette && PRESETS[k].view && PRESETS[k].id === k));
  ok('sim params: preset modes match the contract',
    PRESETS.granulation.params.mode === 'sun' && PRESETS.granulation.params.Ra === 1e6 && PRESETS.granulation.palette === 'solar'
    && PRESETS.soup.params.mode === 'burner' && PRESETS.soup.palette === 'broth' && PRESETS.benard.params.Ra === 5e4
    && PRESETS.hexagons.params.mode === 'pan' && PRESETS.hexagons.params.Ma === 120 && PRESETS.onset.params.Ra === 3000
    && PRESETS.onset.fromRest === true && PRESETS.turbulent.params.Ra === 5e6);
  ok('sim params: every preset survives clampParams unchanged',
    want.every(k => Object.entries(PRESETS[k].params).every(([key, v]) => typeof v === 'object' || clampParams(PRESETS[k].params)[key] === v)));
  ok('sim params: GRIDS keep dx = dy = dz and Lx = 4',
    [0, 1, 2].every(q => GRIDS[q][0] / GRIDS[q][2] === 4 && GRIDS[q][1] / GRIDS[q][2] === 4) && GRIDS[2].join() === '128,128,32');
  ok('sim params: default tracer counts (phone 6000, desktop 20000)', TRACERS[0] === 6000 && TRACERS[2] === 20000);
  const pf = planFrame(1 / 60, 1, 0.3, 1 / 32, 3);
  ok('sim params: planFrame covers the frame in CFL-limited substeps',
    pf.n >= 1 && Math.abs(pf.simDt - TIME_RATE / 60) < 1e-12 && pf.dt <= cflDt(0.3, 1 / 32) + 1e-12, JSON.stringify(pf));
  const pc = planFrame(1 / 30, 8, 5, 1 / 32, 3);
  ok('sim params: planFrame caps substeps and loses speed, not stability',
    pc.n === 3 && Math.abs(pc.dt - cflDt(5, 1 / 32)) < 1e-12 && pc.simDt < (8 * TIME_RATE) / 30, JSON.stringify(pc));
  ok('sim params: a long frame is cut to MAX_FRAME_DT; speed 0 pauses',
    Math.abs(planFrame(5, 1, 0, 1 / 32, 8).simDt - MAX_FRAME_DT * TIME_RATE) < 1e-9 && planFrame(1 / 60, 0, 0, 1 / 32, 3).n === 0
    && cflDt(0, 1) === DT_MAX);

  // ── FFT ──
  let fftErr = 0;
  for (const N of [16, 24, 48, 64, 96, 128]) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) { re[i] = Math.sin(1.7 * i * i + 0.3); im[i] = Math.cos(0.9 * i); }
    const [or, oi] = fftLine(re.slice(), im.slice(), new Float64Array(N), new Float64Array(N), N, radices(N));
    for (let m = 0; m < N; m++) {
      let a = 0, b = 0;
      for (let i = 0; i < N; i++) { const t = (-2 * Math.PI * m * i) / N; a += re[i] * Math.cos(t) - im[i] * Math.sin(t); b += re[i] * Math.sin(t) + im[i] * Math.cos(t); }
      fftErr = Math.max(fftErr, Math.hypot(a - or[m], b - oi[m]));
    }
  }
  ok('sim ref: mixed-radix Stockham FFT equals the DFT (N = 16, 24, 48, 64, 96, 128)', fftErr < 1e-9, fftErr.toExponential(2));
  let threw = false; try { radices(20); } catch { threw = true; }
  ok('sim ref: radices() refuses sizes with a factor 5', threw);

  // ── conduction states are exact steady states ──
  for (const [mode, top] of [['plate', 'rigid'], ['plate', 'free'], ['sun', 'free'], ['pan', 'free'], ['burner', 'free']]) {
    const r = createRefSim({ nx: 16, ny: 16, nz: 8, seed: 1 }, { Ra: 1e4, mode, top, noise: 0 });
    for (let s = 0; s < 10; s++) r.step(0.1);
    const st = r.stats();
    if (mode === 'burner') { // Tb (1 - z) is not the 3D conduction state, but its wall flux is mean(Tb)
      const nu0 = createRefSim({ nx: 16, ny: 16, nz: 8, seed: 1 }, { mode, noise: 0 }).stats().Nu;
      ok('sim ref: burner start state has Nu = 1 (flux reference = mean Tb)', Math.abs(nu0 - 1) < 1e-4, nu0.toFixed(5));
      continue;
    }
    ok(`sim ref: ${mode} / ${top} conduction state stays at rest with Nu = 1`,
      st.ke < 1e-20 && Math.abs(st.Nu - 1) < 1e-4, `ke ${st.ke.toExponential(1)} Nu ${st.Nu.toFixed(5)}`);
  }

  // ── onset ──
  const g16 = { nx: 16, ny: 16, nz: 8, seed: 1 };
  {
    const r = createRefSim(g16, { Ra: 1000, mode: 'plate', top: 'rigid', noise: 1e-2 });
    for (let s = 0; s < 50; s++) r.step(0.1);
    const k1 = r.stats().ke;
    for (let s = 0; s < 300; s++) r.step(0.1);
    const st = r.stats();
    ok('sim ref: Ra 1000 rigid-rigid decays back to conduction', st.ke < k1 * 1e-3 && Math.abs(st.Nu - 1) < 1e-3, `ke ${k1.toExponential(1)} -> ${st.ke.toExponential(1)}`);
  }
  {
    const r = createRefSim(g16, { Ra: 5000, mode: 'plate', top: 'rigid', noise: 1e-3 });
    const k0 = (() => { r.step(0.1); return r.stats().ke; })();
    for (let s = 0; s < 250; s++) r.step(0.1);
    const st = r.stats();
    ok('sim ref: Ra 5000 rigid-rigid perturbation grows', st.ke > k0 * 1e3, `ke ${k0.toExponential(1)} -> ${st.ke.toExponential(1)}`);
  }
  const g2 = { nx: 32, ny: 4, nz: 16, seed: 2 }; // Lx = 2: k = pi, near the critical wave number
  const r1500 = growth(g2, { Ra: 1500, top: 'rigid' }, 0.05, 15), r1900 = growth(g2, { Ra: 1900, top: 'rigid' }, 0.05, 15);
  ok(`sim ref: rigid-rigid onset is bracketed near ${RA_CRIT.rigid} (Ra 1500 decays, 1900 grows)`, r1500 < 0 && r1900 > 0,
    `rates ${r1500.toFixed(4)}, ${r1900.toFixed(4)} per tff`);
  const f950 = growth(g2, { Ra: 950, top: 'free' }, 0.05, 15), f1300 = growth(g2, { Ra: 1300, top: 'free' }, 0.05, 15);
  ok(`sim ref: rigid-free onset is bracketed near ${RA_CRIT.free} (Ra 950 decays, 1300 grows)`, f950 < 0 && f1300 > 0,
    `rates ${f950.toFixed(4)}, ${f1300.toFixed(4)} per tff`);

  // ── developed flow: Nu, divergence ──
  {
    const r = createRefSim(g16, { Ra: 1e4, mode: 'plate', top: 'free' });
    let divWorst = 0;
    for (let s = 0; s < 600; s++) { r.step(0.1); if (s % 25 === 0) divWorst = Math.max(divWorst, r.stats().divMax * r.dims.dx); }
    const st = r.stats();
    divWorst = Math.max(divWorst, st.divMax * r.dims.dx);
    ok('sim ref: projection meets max |div u| dx < 1e-3 at 16 x 16 x 8 (every 25 steps of a developing run)', divWorst < 1e-3, divWorst.toExponential(2));
    ok('sim ref: Nu > 1 after developing at Ra 1e4', st.Nu > 1.5, `Nu ${st.Nu.toFixed(3)} at t ${st.simTime.toFixed(0)}`);
    ok('sim ref: developed Ra 1e4 flow has |u| of order 0.1 to 1 (free-fall units)', st.vmax > 0.05 && st.vmax < 1.5, st.vmax.toFixed(3));
  }

  // ── burner ──
  {
    const r = createRefSim({ nx: 24, ny: 24, nz: 8, seed: 5 }, { Ra: 1e5, Pr: 7, mode: 'burner', top: 'free' });
    for (let s = 0; s < 500; s++) r.step(0.1);
    const st = r.stats(), D = r.derived, nx = 24, nxy = 576, k = 4;
    let wIn = 0, nIn = 0, wOut = 0, nOut = 0;
    for (let j = 0; j < nx; j++) for (let i = 0; i < nx; i++) {
      const x = (i + 0.5) / 8, y = (j + 0.5) / 8, rho = Math.hypot(x - D.bx, y - D.by);
      const w = r.vel[4 * (i + nx * j + nxy * k) + 2];
      if (rho < D.br) { wIn += w; nIn++; } else if (rho > 2 * D.br) { wOut += w; nOut++; }
    }
    wIn /= nIn; wOut /= nOut;
    const off = Math.hypot(st.plume[0] - D.bx, st.plume[1] - D.by);
    ok('sim ref: burner mode makes a central upflow over the hot patch', wIn > 0.05 && wIn > 5 * Math.abs(wOut),
      `mean w inside ${wIn.toFixed(3)}, outside ${wOut.toFixed(4)}`);
    ok('sim ref: burner plume (strongest mid-height upflow) sits over the burner', off < D.br * 1.5, `plume off by ${off.toFixed(2)}`);
  }

  // ── pan (Bénard–Marangoni) ──
  {
    const p = { Ra: 300, Pr: 7, mode: 'pan', noise: 1e-2 };
    const a = createRefSim(g16, Object.assign({ Ma: 0 }, p)), b = createRefSim(g16, Object.assign({ Ma: 150 }, p));
    for (let s = 0; s < 20; s++) { a.step(0.1); b.step(0.1); }
    const a0 = a.stats().ke, b0 = b.stats().ke;
    for (let s = 0; s < 480; s++) { a.step(0.1); b.step(0.1); }
    const sa = a.stats(), sb = b.stats();
    ok('sim ref: pan mode at Ra 300 with Ma 0 stays at rest (buoyancy alone is subcritical)', sa.ke < a0 * 1e-3, `ke ${a0.toExponential(1)} -> ${sa.ke.toExponential(1)}`);
    ok('sim ref: pan mode at Ra 300 with Ma 150 makes cells (surface tension drives them)', sb.ke > b0 * 1e3 && sb.Nu > 1.05,
      `ke ${b0.toExponential(1)} -> ${sb.ke.toExponential(1)}, Nu ${sb.Nu.toFixed(3)}`);
  }

  // ── periodic wrap: the scheme commutes with a periodic shift ──
  {
    const nx = 16, ny = 16, nz = 8, n = nx * ny * nz, si = 5, sj = 3;
    const p = { Ra: 2e4, mode: 'plate', top: 'free', noise: 0.05 };
    const a = createRefSim({ nx, ny, nz, seed: 7 }, p), b = createRefSim({ nx, ny, nz, seed: 99 }, p);
    const shift = A => { const o = new Float32Array(n); for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) o[(i + si) % nx + nx * ((j + sj) % ny + ny * k)] = A[i + nx * (j + ny * k)]; return o; };
    for (let s = 0; s < 60; s++) a.step(0.1);  // a developed, moving state
    b.load({ U: shift(a.U), V: shift(a.V), W: shift(a.W), T: shift(a.T) });
    a.load({});                                 // same (cleared) pressure history in both
    for (let s = 0; s < 40; s++) { a.step(0.1); b.step(0.1); }
    const sa = shift(a.T), sw = shift(a.W);
    let e = 0; for (let c2 = 0; c2 < n; c2++) e = Math.max(e, Math.abs(sa[c2] - b.T[c2]), Math.abs(sw[c2] - b.W[c2]));
    ok('sim ref: periodic wrap in x and y (a shifted state stays the shifted solution)', e < 1e-4 && a.stats().vmax > 0.01, `max diff ${e.toExponential(2)}`);
  }

  // ── determinism ──
  {
    const p = { Ra: 1e4, mode: 'plate' };
    const a = createRefSim({ nx: 16, ny: 16, nz: 8, seed: 42 }, p), b = createRefSim({ nx: 16, ny: 16, nz: 8, seed: 42 }, p), c3 = createRefSim({ nx: 16, ny: 16, nz: 8, seed: 43 }, p);
    a.setTracers(64); b.setTracers(64);
    for (let s = 0; s < 30; s++) { a.step(0.1); b.step(0.1); c3.step(0.1); }
    let same = true; for (let i = 0; i < a.T.length; i++) if (a.T[i] !== b.T[i] || a.U[i] !== b.U[i]) { same = false; break; }
    for (let i = 0; i < a.tracers.length; i++) if (a.tracers[i] !== b.tracers[i]) same = false;
    let diff = false; for (let i = 0; i < a.T.length; i++) if (a.T[i] !== c3.T[i]) { diff = true; break; }
    ok('sim ref: same seed gives bit-identical fields and tracers; another seed differs', same && diff);
    const s1 = initialState({ nx: 16, ny: 16, nz: 8 }, p, 42).T;
    ok('sim ref: initialState(seed) is the ref start state (gpu.js uploads it)', s1.every((v, i) => v === createRefSim({ nx: 16, ny: 16, nz: 8, seed: 42 }, p).T[i]));
  }

  // ── long run at Ra 1e7 with the CFL plan ──
  {
    const r = createRefSim(g16, { Ra: 1e7, mode: 'plate', top: 'rigid' });
    let subs = 0, vmaxHi = 0, ok1 = true;
    for (let f = 0; f < 2400; f++) {
      subs += r.frame(1 / 30, 3).n;
      if (f % 100 === 0) { const st = r.stats(); vmaxHi = Math.max(vmaxHi, st.vmax); if (!Number.isFinite(st.ke)) ok1 = false; }
    }
    const st = r.stats();
    ok('sim ref: no NaN over a long run at Ra 1e7 with the CFL cap', ok1 && finite(r.T) && finite(r.vel) && st.vmax < 3,
      `t ${st.simTime.toFixed(0)} tff, ${subs} substeps, vmax <= ${vmaxHi.toFixed(2)}, Nu ${st.Nu.toFixed(1)}`);
  }

  // ── tracers ──
  {
    const r = createRefSim(g16, { Ra: 1e4, mode: 'plate' });
    r.setTracers(500);
    for (let s = 0; s < 300; s++) r.step(0.2);
    const t = r.tracers; let inside = true, young = 0;
    for (let i = 0; i < 500; i++) {
      const x = t[4 * i], y = t[4 * i + 1], z = t[4 * i + 2], age = t[4 * i + 3];
      if (!(x >= 0 && x < 2 && y >= 0 && y < 2 && z >= 0 && z <= 1 && age >= 0)) inside = false;
      if (age < 20) young++;
    }
    ok('sim ref: tracers stay in the box and respawn after their life', inside && young > 50 && r.tracerCount === 500, `${young} younger than 20 tff`);
  }

  // ── sun mode coefficients ──
  {
    const D = derived({ mode: 'sun' }, { nx: 128, ny: 128, nz: 32 });
    ok('sim ref: sun mode heats an 8-layer bottom zone over an insulating wall, Robin top', D.botNeumann && D.nHeat === 8 && D.tRobin && D.rTop < 1 && D.Tcond[0] > D.Tcond[31]);
  }

}
