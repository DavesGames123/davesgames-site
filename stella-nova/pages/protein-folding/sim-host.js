// ============================================================================
//  PROTEIN FOLDING  ·  sim-host.js — runs one simulation, worker or not
// ----------------------------------------------------------------------------
//  createHost(send) returns { handle(msg), stop() }. worker.js wires it to
//  postMessage in a module worker. When module workers fail, main.js runs
//  the same host on the main thread with a smaller time budget.
//  main.js starts one host per Go replica, so replicas run on separate
//  cores, and one host for the whole HP search (replica exchange needs all
//  the lattice replicas in one place).
//
//  Each tick runs up to `rate` steps (Go) or sweeps (HP) inside the time
//  budget (12 ms in a worker), then sends one frame. Ticks repeat about
//  every 16 ms.
//
//  DRAWN CHAIN (Go). At high speed one frame holds up to 1500 steps (7 tau),
//  more than the 2 tau velocity memory, so each raw frame is a new thermal
//  sample: the beads jump 2 to 3 A per frame on a 3.8 A bond. The frame x is
//  therefore a display chain, not the last state:
//    1  the mean of the chain over the frame, sampled every AVG steps
//    2  that mean fitted onto the last drawn chain, so it does not turn
//    3  an exponential mean over frames. The time constant is the shorter
//       of TAU_SIM (tau of simulated time) and TAU_WALL (wall seconds), so
//       a chain lags the state by 0.3 s at most and folds at the same speed
//    4  bonds set back to the native length (a mean cuts the corners)
//    5  a part of the turn to the native fit, time constant TURN_S in wall
//       seconds, times Q^2, at most TURN_MAX rad/s, so a folded chain comes
//       to rest on the ghost and an unfolded chain does not swing
//  obs, formed and samples stay the instantaneous values. 'reset' and
//  'go-init' start a new display chain.
//
//  MESSAGES IN
//    go-init  { protein, seed, T, gamma, pull, start, rate, running }
//    hp-init  { seq, dim, replicas, mode, Tlo, Thi, Tfix, seed, rate, running }
//    set      { any of T gamma pull rate running mode Tlo Thi Tfix }
//    reset    { start }            extended | coil | native (Go only)
//    step     { n }                n steps or sweeps now, then one frame
//  Any message may carry gen; frames carry the last gen seen, so the page
//  can drop frames sent before a restart.
//  MESSAGES OUT
//    frame    Go: x (C-alpha fitted onto native), obs, formed, samples
//             (Q, Rg, E, T every 50 steps), sps
//             HP: pos, E, T, bestE, bestPos, moves, acc, swap, samples, sps
//
//  grep: function goTick  function hpTick  function post  function handle
// ============================================================================
import * as M from './model.js';
import * as L from './lattice.js';

export function createHost(send, opt = {}) {
let kind = null, sys = null, hp = null, rnd = null, dead = false;
let rate = 200, running = true, timer = 0, gen = 0;
let samples = [], doneSinceFrame = 0, lastPost = performance.now();
const BUDGET = opt.budget ?? 12, PERIOD = 16, SAMPLE = 50;
const AVG = 5, TAU_SIM = 1.5, TAU_WALL = 0.3, TURN_S = 4, TURN_MAX = 4 * Math.PI / 180;
let acc = null, accN = 0, disp = null, dispAt = 0;

function goTick() {
  const t0 = performance.now();
  let n = 0;
  while (n < rate && performance.now() - t0 < BUDGET) {
    const k = Math.min(SAMPLE, rate - n);
    for (let j = 0; j < k; j += AVG) {
      M.step(sys, Math.min(AVG, k - j));
      const x = sys.x; for (let i = 0; i < x.length; i++) acc[i] += x[i];
      accN++;
    }
    n += k;
    let q = 0; for (let c = 0; c < sys.nc; c++) q += sys.formed[c];
    let cx = 0, cy = 0, cz = 0; const x = sys.x, N = sys.N;
    for (let i = 0; i < N; i++) { cx += x[3 * i]; cy += x[3 * i + 1]; cz += x[3 * i + 2]; }
    cx /= N; cy /= N; cz /= N;
    let rg = 0; for (let i = 0; i < N; i++) rg += (x[3 * i] - cx) ** 2 + (x[3 * i + 1] - cy) ** 2 + (x[3 * i + 2] - cz) ** 2;
    samples.push(sys.nc ? q / sys.nc : 0, Math.sqrt(rg / N), sys.E, sys.T);
  }
  doneSinceFrame += n;
}
function hpTick() {
  const t0 = performance.now();
  let n = 0;
  while (n < rate && performance.now() - t0 < BUDGET) {
    L.searchSweep(hp, rnd); n++;
    for (let r = 0; r < hp.R; r++) samples.push(hp.chains[r].E);
  }
  doneSinceFrame += n;
}
// The display chain (see DRAWN CHAIN in the header).
function drawn(now) {
  const N = sys.N, L = 3 * N;
  const mean = new Float64Array(L);
  if (accN) for (let i = 0; i < L; i++) mean[i] = acc[i] / accN; else mean.set(sys.x);
  const span = accN * AVG * sys.P.dt;
  acc.fill(0); accN = 0;
  if (!disp) {
    disp = M.applyFit(M.kabsch(mean, sys.nat, N), mean, new Float64Array(L), N);
    dispAt = now; return disp;
  }
  const a = M.applyFit(M.kabsch(mean, disp, N), mean, new Float64Array(L), N);
  const dw = Math.min(0.25, (now - dispAt) / 1000);
  const w = 1 - Math.exp(-Math.min(span / TAU_SIM, dw / TAU_WALL));
  for (let i = 0; i < L; i++) disp[i] += w * (a[i] - disp[i]);
  // A mean of a moving chain cuts its corners, and the bonds get 10 to 25 %
  // short. A few passes set each bond back to its native length r0.
  const r0 = sys.r0;
  for (let it = 0; it < 4; it++) for (let i = 0; i < N - 1; i++) {
    const p = 3 * i, q = p + 3;
    const dx = disp[q] - disp[p], dy = disp[q + 1] - disp[p + 1], dz = disp[q + 2] - disp[p + 2];
    const d = Math.hypot(dx, dy, dz); if (d < 1e-9) continue;
    const c = 0.5 * (d - r0[i]) / d;
    disp[p] += c * dx; disp[p + 1] += c * dy; disp[p + 2] += c * dz;
    disp[q] -= c * dx; disp[q + 1] -= c * dy; disp[q + 2] -= c * dz;
  }
  // A part of the turn to the native fit, about the native centroid.
  const fit = M.kabsch(disp, sys.nat, N), [q0, q1, q2, q3] = fit.q;
  // The native fit of a chain that has not folded changes from frame to
  // frame, so the turn is weighted by Q^2 and has a cap of TURN_MAX rad/s.
  let q = 0; for (let c = 0; c < sys.nc; c++) q += sys.formed[c];
  q = sys.nc ? q / sys.nc : 0;
  const b = (1 - Math.exp(-dw / TURN_S)) * q * q;
  dispAt = now;
  const half = Math.acos(Math.min(1, Math.abs(q0))), sg = q0 < 0 ? -1 : 1;
  const sv = Math.sin(half), h2 = Math.min(half * b, 0.5 * TURN_MAX * dw);
  const p0 = Math.cos(h2), m = sv > 1e-9 ? sg * Math.sin(h2) / sv : 0;
  const p1 = q1 * m, p2 = q2 * m, p3 = q3 * m;
  const R = [
    p0 * p0 + p1 * p1 - p2 * p2 - p3 * p3, 2 * (p1 * p2 - p0 * p3), 2 * (p1 * p3 + p0 * p2),
    2 * (p1 * p2 + p0 * p3), p0 * p0 - p1 * p1 + p2 * p2 - p3 * p3, 2 * (p2 * p3 - p0 * p1),
    2 * (p1 * p3 - p0 * p2), 2 * (p2 * p3 + p0 * p1), p0 * p0 - p1 * p1 - p2 * p2 + p3 * p3,
  ];
  // The centroid goes to the native centroid at once: the fit pins it there.
  return M.applyFit({ R, ca: fit.ca, cb: fit.cb }, disp, disp, N);
}
function post() {
  const now = performance.now(), sps = doneSinceFrame / Math.max(1e-3, (now - lastPost) / 1000);
  lastPost = now; doneSinceFrame = 0;
  if (kind === 'go') {
    const obs = M.observe(sys);
    const x = Float32Array.from(drawn(now)), formed = Uint8Array.from(sys.formed), s = Float32Array.from(samples);
    samples = [];
    send({ type: 'frame', gen, kind, x, obs, formed, samples: s, sps, T: sys.T, Eparts: Array.from(sys.Eparts), blowups: sys.blowups || 0 });
  } else if (kind === 'hp') {
    const N = hp.seq.length, pos = new Int32Array(hp.R * 3 * N);
    hp.chains.forEach((c, r) => pos.set(c.pos, r * 3 * N));
    const s = Int16Array.from(samples); samples = [];
    send({
      type: 'frame', gen, kind, pos, E: hp.chains.map(c => c.E), T: hp.T.slice(), bestE: hp.bestE, bestPos: Int32Array.from(hp.bestPos),
      bestAt: hp.bestAt, moves: hp.moves, sweeps: hp.sweeps, acc: Array.from(hp.acc, (a, r) => a / Math.max(1, hp.tried[r])),
      swap: hp.swapTry ? hp.swapAcc / hp.swapTry : 0, samples: s, sps,
    });
  }
}
function tick() {
  timer = 0;
  if (dead) return;
  const t0 = performance.now();
  if (running && (sys || hp)) {
    if (kind === 'go') goTick(); else hpTick();
    post();
  }
  timer = setTimeout(tick, running ? Math.max(0, PERIOD - (performance.now() - t0)) : 60);
}
function start(which) {
  if (which === 'native') M.initNative(sys);
  else if (which === 'coil') M.initCoil(sys);
  else M.initExtended(sys);
  samples = []; acc = new Float64Array(3 * sys.N); accN = 0; disp = null;
}

function handle(m) {
  if (dead) return;
  if (m.gen !== undefined) gen = m.gen;
  if (m.type === 'go-init') {
    kind = 'go'; hp = null;
    sys = M.buildSystem(m.protein, { seed: m.seed, T: m.T, gamma: m.gamma });
    sys.pull = m.pull || 0; rate = m.rate ?? rate; running = m.running ?? true;
    start(m.start);
    post();
  } else if (m.type === 'hp-init') {
    kind = 'hp'; sys = null;
    rnd = M.makeRng(m.seed || 1);
    hp = L.createSearch(m.seq, { dim: m.dim, replicas: m.replicas, mode: m.mode, Tlo: m.Tlo, Thi: m.Thi, Tfix: m.Tfix });
    rate = m.rate ?? rate; running = m.running ?? true; samples = [];
    post();
  } else if (m.type === 'set') {
    if (sys) {
      if (m.T !== undefined) sys.T = m.T;
      if (m.gamma !== undefined) sys.gamma = m.gamma;
      if (m.pull !== undefined) { sys.pull = m.pull; M.forces(sys); }
    }
    if (hp) {
      for (const k of ['mode', 'Tlo', 'Thi', 'Tfix']) if (m[k] !== undefined) hp[k] = m[k];
      if (m.mode !== undefined || m.Tlo !== undefined || m.Thi !== undefined || m.Tfix !== undefined) L.setTemps(hp);
    }
    if (m.rate !== undefined) rate = m.rate;
    if (m.running !== undefined) running = m.running;
  } else if (m.type === 'reset') {
    if (sys) { start(m.start); post(); }
  } else if (m.type === 'step') {
    const keep = rate; rate = m.n || 1;
    if (kind === 'go') goTick(); else if (hp) hpTick();
    rate = keep; post();
  }
  if (!timer) timer = setTimeout(tick, 0);
}
return { handle, stop() { dead = true; clearTimeout(timer); } };
}
