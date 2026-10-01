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

function goTick() {
  const t0 = performance.now();
  let n = 0;
  while (n < rate && performance.now() - t0 < BUDGET) {
    const k = Math.min(SAMPLE, rate - n);
    M.step(sys, k); n += k;
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
function post() {
  const now = performance.now(), sps = doneSinceFrame / Math.max(1e-3, (now - lastPost) / 1000);
  lastPost = now; doneSinceFrame = 0;
  if (kind === 'go') {
    const xf = new Float64Array(3 * sys.N);
    const obs = M.observe(sys, xf);
    const x = Float32Array.from(xf), formed = Uint8Array.from(sys.formed), s = Float32Array.from(samples);
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
  samples = [];
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
