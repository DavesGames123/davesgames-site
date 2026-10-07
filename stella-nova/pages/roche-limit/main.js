// ============================================================================
//  ROCHE LIMIT  ·  main.js — boot, runs, frame loop, camera, panel, saver
// ----------------------------------------------------------------------------
//  A RUN is one scenario with one or two satellites. Each satellite is a
//  SimGPU (engine.js). A run has two phases:
//    settle  a loose cloud (physics.js makeCloud, built in the worker) falls
//            together under its own gravity with a drag, far from any
//            planet (GM = 0). The settled pile is cached by N and material.
//    orbit   the pile goes onto its start orbit (placeOnOrbit, synchronous
//            spin), the planet is switched on, and the clock starts.
//  Each frame encodes B blocks of 32 steps per satellite (the time warp),
//  then the renderer draws the same buffers. B follows the warp setting and
//  a GPU budget (queue.onSubmittedWorkDone). About four times a second a
//  satellite is read back; worker.js finds the bound mass, its centre and
//  the energy, and returns the bound / shed tag of each grain.
//
//  PREDICTION, drawn with the run: the rigid, synchronous and fluid Roche
//  circles for the run's density ratio, the Hill sphere of the bound mass,
//  the Kepler conic of the bound centre ahead in time, short conics of shed
//  grains, the tide / self-gravity gauge, and the bound mass after 3 orbits
//  against distance (plots.js).
//
//  grep -n targets
//    settings and state ..... "const UI"
//    start a run ............ "async function startRun"
//    settle ................. "function settleStep"
//    orbit start ............ "async function placeSats"
//    frame loop ............. "function frame"
//    analysis results ....... "function onAnalysis"
//    camera ................. "function cameraFrame"
//    lines .................. "function buildSegments"
//    field overlay .......... "function fieldParams"
//    labels ................. "function placeLabels"
//    panel, dock, sheet ..... "function buildUI"
//    framing (overlays) ..... "function occlusion"
//    screensaver ............ "SCREENSAVER"
// ============================================================================
import * as P from './physics.js';
import { SimGPU, loadSimCode } from './engine.js';
import { Renderer, loadRenderCode, norm, cross, sub } from './render.js';
import { SCENARIOS, REAL, specFor, flybyStart } from './scenarios.js';
import { drawGauge, drawBound, drawEnergy, drawRuns, MAT_COLOR } from './plots.js';
import { typesetAll } from '../../lib/sci-math.js';
import { plateBand } from '../../lib/saver-clear.js';

const $ = id => document.getElementById(id);
const PHONE_Q = window.matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const COARSE = window.matchMedia('(pointer:coarse)').matches;
const N_OPTS = [4096, 8192, 16384, 24576, 32768];
const WARP = [0, 0.25, 0.5, 1, 2, 4, 8, 16, 32];          // blocks of 32 steps per frame
const G_SI = 6.674e-11;
const RUNS_KEY = 'roche-limit-runs-v1';

// Bound mass after 3 orbits, measured with this code: N = 16384, q = 1,
// circular orbits, 2026-10-06, shaders/sim.wgsl run from Deno (a scratch
// sweep script; readbacks every 1/6 orbit). x = d / (R_p q^(1/3)).
// Disruption (bound < 50%): fluid 0.92-0.95 d_fluid, rigid-ish 0.70-0.75,
// cohesive 0.65-0.70; d_rigid is 0.52 d_fluid.
const REF_SWEEP = [
  ...[[0.80, 0.011], [0.85, 0.010], [0.88, 0.049], [0.90, 0.154], [0.92, 0.008], [0.95, 1.0], [1.00, 1.0], [1.05, 1.0]].map(([f, y]) => ({ x: f * P.K_FLUID, y, mat: 'fluid' })),
  ...[[0.65, 0.007], [0.70, 0.006], [0.75, 1.0], [0.80, 1.0]].map(([f, y]) => ({ x: f * P.K_FLUID, y, mat: 'rigid' })),
  ...[[0.55, 0.135], [0.60, 0.261], [0.65, 0.360], [0.70, 1.0], [0.75, 1.0]].map(([f, y]) => ({ x: f * P.K_FLUID, y, mat: 'cohesive' })),
];

const UI = {
  scen: 'moon', body: 'phobos',
  d: 1.9, peri: 1.6, e: 1, qLog: 0, J2: 0,
  material: 'fluid', mu: 0, coh: 0,
  N: (PHONE_Q.matches || COARSE) ? 4096 : 16384,
  warp: 2, paused: false,
  cam: 'planet', color: 0, field: 0,
  rings: true, hill: true, pred: true, track: true, ringOn: true, blur: false, ringGain: 2,
  calm: window.matchMedia('(prefers-reduced-motion: reduce)').matches,   // Reduce motion
};

let dev = null, ctx = null, ren = null, simCode = null, worker = null;
let run = null;            // the current run
let runSerial = 0;
const pileCache = new Map();
let gpuMs = 0, gpuPending = false, blocksMax = 8, warpCarry = 0;
let lastT = performance.now(), fps = 60;
let saverOn = false;
let bootDone; const bootReady = new Promise(r => { bootDone = r; });
const workerJobs = new Map(); let jobId = 0;

// ── boot (called at the end of the module, after every const is set) ─────
async function boot() {
  buildUI();
  typesetAll(document).catch(() => {});
  if (!navigator.gpu) return fail(new Error('navigator.gpu is missing'));
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return fail(new Error('no GPU adapter'));
  dev = await adapter.requestDevice();
  dev.lost.then(i => { if (i.reason !== 'destroyed') fail(new Error('GPU device lost: ' + i.message)); });
  dev.addEventListener('uncapturederror', e => { console.error('WebGPU:', e.error.message); });
  const canvas = $('gpu');
  ctx = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device: dev, format, alphaMode: 'opaque' });
  const [sc, rc] = await Promise.all([loadSimCode(), loadRenderCode()]);
  simCode = sc;
  ren = new Renderer(dev, ctx, format, rc, { gridN: (PHONE_Q.matches || COARSE) ? 512 : 1024 });
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = e => { const j = workerJobs.get(e.data.id); workerJobs.delete(e.data.id); if (j) j(e.data); };
  worker.onerror = e => console.error('worker:', e.message);
  resize(); window.addEventListener('resize', resize);
  window.__roche = { state: () => debugState(), ren, cam, UI, camStats, resetCamStats, get run() { return run; } };
  requestAnimationFrame(frame);
  bootDone();
  if (!saverOn) await startRun();
}
function fail(e) {
  console.error(e);
  $('nogpu').classList.remove('off');
  $('nogpuWhy').textContent = String(e && e.message || e);
}
function resize() {
  if (!ren) return;
  const c = $('gpu');
  const dpr = Math.min(window.devicePixelRatio || 1, PHONE_Q.matches ? 1.5 : 2);
  let w = c.clientWidth * dpr, h = c.clientHeight * dpr;
  const maxPx = PHONE_Q.matches ? 1.6e6 : 3.6e6, k = Math.min(1, Math.sqrt(maxPx / (w * h)));
  w = Math.round(w * k); h = Math.round(h * k);
  c.width = w; c.height = h;
  ren.resize(w, h);
}
function workerCall(msg, transfer = []) {
  return new Promise(res => { const id = ++jobId; workerJobs.set(id, res); worker.postMessage(Object.assign({ id }, msg), transfer); });
}

// ── runs ──────────────────────────────────────────────────────────────────
function currentSpec() {
  const sc = SCENARIOS.find(s => s.key === UI.scen);
  const ui = { q: Math.pow(10, UI.qLog), material: UI.material, J2: UI.J2, d: UI.d, peri: UI.peri, e: UI.e, mu: UI.mu, coh: UI.coh, body: UI.body };
  const spec = specFor(sc, ui);
  spec.scen = sc;
  return spec;
}
function matFor(name, spec, custom) {
  const m = Object.assign({}, P.MATERIALS[name]);
  if (custom) { if (spec.mu !== undefined) m.mu = spec.mu; if (spec.coh !== undefined) m.coh = spec.coh; m.muR = m.mu > 0 ? P.MATERIALS.rigid.muR : 0; }
  return m;
}

async function startRun(specIn) {
  const serial = ++runSerial;
  const spec = specIn || currentSpec();
  const sc = spec.scen || SCENARIOS.find(s => s.key === spec.key);
  if (run) { for (const s of run.sats) s.gpu.destroy(); ren.removeSims(); }
  const two = spec.kind === 'compare';
  let N = UI.N;
  if (sc && sc.nScale) N = Math.max(4096, Math.round(N * sc.nScale / 1024) * 1024);
  if (saverOn) N = Math.min(N, run && run.saverN || 8192);
  const nEach = two ? Math.max(4096, N / 2) : N;
  const mats = two ? spec.materials : [spec.material];
  run = { serial, spec, sats: [], phase: 'init', t: 0, T0: 1, frames: 0, started: performance.now(), recorded: false, track: [] };
  for (let k = 0; k < mats.length; k++) {
    const mat = matFor(mats[k], spec, !two);
    const C = P.contactParams(nEach, mat);
    const gpu = new SimGPU(dev, nEach, simCode);
    const e = ren.addSim(gpu);
    run.sats.push({ idx: k, matName: mats[k], mat, C, gpu, e, N: nEach, color: MAT_COLOR[mats[k]] || '#d8dfe8', hist: [], ehist: [], an: null, anT: 0, E0: null, L0: null, frag: [], phase: two ? k * Math.PI : 0 });
  }
  setBusy(true, 'Building the grains', 0);
  // the cloud or the cached pile
  for (const s of run.sats) {
    const key = `${s.N}|${s.matName}|${s.mat.mu}|${s.mat.coh}`;
    s.cacheKey = key;
    if (pileCache.has(key)) { s.pile = pileCache.get(key); continue; }
    const cl = await workerCall({ type: 'cloud', N: s.N, seed: 3 + s.idx });
    if (serial !== runSerial) return;
    s.cloud = cl;
  }
  if (serial !== runSerial) return;
  // planet (R_p from the expected pile radius, so the scale does not jump)
  for (const s of run.sats) {
    s.Rp = s.C.Rs / spec.s; s.k = 1 / s.Rp;
  }
  // settle each satellite that has no cached pile
  for (const s of run.sats) {
    if (s.pile) continue;
    const z = new Float64Array(s.N * 3);
    s.gpu.setParams(s.C, { GM: 0, Rp: 1 }, 1.5);
    s.gpu.ref = null;
    s.gpu.setState(s.cloud.pos, z, z, s.cloud.rad, s.cloud.mass);
    s.gpu.prime();
    s.settleBlocks = Math.ceil(6 / (s.C.dt * s.gpu.K));
    s.settleDone = 0;
    s.rad = s.cloud.rad; s.mass = s.cloud.mass;
  }
  // start positions for the display during the settle
  prepareOrbit();
  if (run.sats.every(s => s.pile)) await placeSats(serial);
  else if (serial === runSerial) run.phase = 'settle';
}
// Planet and start orbit for each satellite (from the spec; the pile
// stats replace the expected density once the pile is settled).
function prepareOrbit() {
  const spec = run.spec;
  for (const s of run.sats) {
    const rhoS = s.pile ? s.pile.st.rho : P.RHO_GRAIN * P.PHI0;
    const rhoP = spec.q * rhoS;
    const GM = P.G * rhoP * 4 / 3 * Math.PI * s.Rp ** 3;
    s.pl = { Rp: s.Rp, rhoP, rhoS, GM, Mp: GM, J2: spec.J2 || 0, drag: 0 };
    const o = orbitFor(spec, s.pl);
    // compare: the second moon half an orbit ahead
    if (s.phase) { const c = Math.cos(s.phase), sn = Math.sin(s.phase); o.X = [c * o.X[0] - sn * o.X[1], sn * o.X[0] + c * o.X[1], 0]; o.V = [c * o.V[0] - sn * o.V[1], sn * o.V[0] + c * o.V[1], 0]; }
    s.o = o;
    s.ref = new P.RefOrbit(s.pl, o.X, o.V);
  }
}
function orbitFor(spec, pl) {
  if (spec.kind === 'flyby') {
    return P.orbitStart(pl, { kind: 'flyby', peri: spec.peri, e: spec.e, r0: flybyStart(spec) });
  }
  return P.orbitStart(pl, { kind: 'circular', d: spec.d });
}
function settleStep(budgetBlocks) {
  let all = true, done = 0, total = 0;
  const enc = dev.createCommandEncoder();
  for (const s of run.sats) {
    if (s.pile) continue;
    const left = s.settleBlocks - s.settleDone;
    if (left > 0) {
      const n = Math.min(left, budgetBlocks);
      const dragOff = s.settleDone + n > 0.8 * s.settleBlocks && s.settleDone <= 0.8 * s.settleBlocks;
      s.gpu.encode(enc, n, false);
      s.settleDone += n;
      if (dragOff) s.gpu.setParams(s.C, { GM: 0, Rp: 1 }, 0);
      all = all && s.settleDone >= s.settleBlocks;
    }
    done += Math.min(s.settleDone, s.settleBlocks); total += s.settleBlocks;
  }
  dev.queue.submit([enc.finish()]);
  setBusy(true, 'Settling the rubble pile under its own gravity', total ? done / total : 1);
  return all;
}
async function placeSats(serial) {
  run.phase = 'placing';
  for (const s of run.sats) {
    if (!s.pile) {
      const rb = await s.gpu.readback();
      if (serial !== runSerial) return;
      const N = s.N, pos = new Float64Array(N * 3);
      for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) pos[3 * i + k] = rb.body[12 * i + k];
      const st = P.pileStats(pos, s.mass);
      for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) pos[3 * i + k] -= st.com[k];
      s.pile = { pos, st: P.pileStats(pos, s.mass), rad: Float64Array.from(s.rad), mass: Float64Array.from(s.mass) };
      pileCache.set(s.cacheKey, s.pile);
    }
  }
  prepareOrbit();
  for (const s of run.sats) {
    const N = s.N, pos = Float64Array.from(s.pile.pos), vel = new Float64Array(N * 3), spin = new Float64Array(N * 3);
    s.rad = s.pile.rad; s.mass = s.pile.mass; s.M0 = s.pile.st.M; s.Rs = s.pile.st.R;
    P.placeOnOrbit(pos, vel, spin, s.mass, s.o.Omega);
    s.gpu.setParams(s.C, s.pl, 0);
    s.gpu.ref = s.ref; s.gpu.t = 0;
    s.gpu.setState(pos, vel, spin, s.rad, s.mass);
    s.gpu.prime();
    ren.setTags(s.e, new Float32Array(s.gpu.np).fill(1));
    s.hist = [[0, 1]]; s.ehist = []; s.an = null; s.E0 = null; s.L0 = null; s.frag = [];
  }
  const s0 = run.sats[0], spec = run.spec;
  // the time unit for the plots: one orbit (circular) or the period of a
  // circular orbit at the pericentre (flyby)
  const a0 = spec.kind === 'flyby' ? spec.peri * s0.Rp : spec.d * s0.Rp;
  run.T0 = P.orbitalPeriod(s0.pl.GM, a0);
  if (spec.kind === 'spiral') {
    const d0 = spec.d, d1 = spec.d1, Tm = P.orbitalPeriod(s0.pl.GM, Math.sqrt(d0 * d1) * s0.Rp);
    const kappa = Math.log(d0 / d1) / (2 * spec.orbits * Tm);
    for (const s of run.sats) { s.pl.drag = kappa; s.gpu.setParams(s.C, s.pl, 0); }
  }
  if (spec.kind === 'flyby') {
    // time from the start to the pericentre, by the Kepler equation
    const el = P.keplerElements(s0.o.X, s0.o.V, s0.pl.GM);
    run.tPeri = timeToPeri(s0.o.X, s0.o.V, s0.pl.GM, el);
  }
  const rhoReal = spec.rhoS || 1.0;
  run.tUnitSec = Math.sqrt(s0.pile.st.rho / (G_SI * rhoReal * 1000));
  run.phase = 'orbit'; run.t = 0; run.recorded = false; run.track = [];
  run.limits = limitsFor(spec);
  setBusy(false);
  refreshReadout(true);
}
function timeToPeri(X, V, GM, el) {
  const r = Math.hypot(...X), e = el.e;
  const rv = X[0] * V[0] + X[1] * V[1] + X[2] * V[2];
  if (Math.abs(e - 1) < 1e-6) {
    const q = el.p / 2, D = Math.sign(rv) * Math.sqrt(Math.max(0, r / q - 1));
    return -Math.sqrt(2 * q ** 3 / GM) * (D + D ** 3 / 3);
  }
  if (e < 1) {
    const a = el.a, n = Math.sqrt(GM / a ** 3);
    let E = Math.acos(Math.max(-1, Math.min(1, (1 - r / a) / e))); if (rv < 0) E = -E;
    let M = E - e * Math.sin(E); if (M > 0) M -= 2 * Math.PI;
    return -M / n;
  }
  const a = -el.a, n = Math.sqrt(GM / a ** 3);
  let H = Math.acosh(Math.max(1, (1 + r / a) / e)); if (rv < 0) H = -H;
  return -(e * Math.sinh(H) - H) / n;
}
function limitsFor(spec) {
  const c = Math.cbrt(spec.q);
  return { rigid: P.K_RIGID * c, sync: P.K_RIGID_SYNC * c, fluid: P.K_FLUID * c, chandra: P.K_FLUID_CH * c };
}
function setBusy(on, text, frac = 0) {
  $('busy').classList.toggle('off', !on);
  if (on) { $('busyT').textContent = text; $('busyBar').style.width = (100 * frac).toFixed(0) + '%'; }
}

// ── frame loop ────────────────────────────────────────────────────────────
function frame(now) {
  requestAnimationFrame(frame);
  const dtReal = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  fps = 0.95 * fps + 0.05 / Math.max(dtReal, 1e-3);
  if (!run || !ren || run.phase === 'init' || run.phase === 'placing') return;
  const cssW = $('gpu').clientWidth, cssH = $('gpu').clientHeight;
  if (cssW < 2 || cssH < 2) return;
  let blocks = 0;
  if (run.phase === 'settle') {
    if (settleStep(saverOn ? 24 : 12)) { run.phase = 'placing'; placeSats(run.serial); }
  } else if (run.phase === 'orbit' && !UI.paused) {
    // the spiral ends at d1: the drag stops there
    if (run.spec.kind === 'spiral') for (const s of run.sats) if (s.pl.drag > 0 && Math.hypot(...s.ref.X) < run.spec.d1 * s.Rp) { s.pl.drag = 0; s.gpu.setParams(s.C, s.pl, 0); }
    warpCarry += WARP[warpIndex()];
    blocks = Math.min(Math.floor(warpCarry), blocksMax);
    warpCarry -= Math.floor(warpCarry);
    if (blocks > 0) {
      const due = now - (run.lastRead || 0) > 240 && run.sats.every(s => !s.gpu.busy && !s.waiting);
      const enc = dev.createCommandEncoder();
      for (const s of run.sats) s.gpu.encode(enc, blocks, due);
      dev.queue.submit([enc.finish()]);
      run.t = run.sats[0].gpu.t;
      if (due) { run.lastRead = now; for (const s of run.sats) readAndAnalyze(s); }
    } else if (now - (run.lastRead || 0) > 600 && run.sats.every(s => !s.gpu.busy && !s.waiting)) {
      run.lastRead = now; for (const s of run.sats) readAndAnalyze(s);
    }
  }
  // GPU time of the whole frame (sim + draw)
  const tSub = performance.now();
  drawFrame(now, cssW, cssH, blocks);
  if (!gpuPending) {
    gpuPending = true;
    dev.queue.onSubmittedWorkDone().then(() => {
      const ms = performance.now() - tSub;
      gpuMs = 0.8 * gpuMs + 0.2 * ms; gpuPending = false;
      const target = Math.max(1, Math.ceil(WARP[warpIndex()]));
      if (gpuMs > 26 && blocksMax > 1) blocksMax = Math.max(1, Math.floor(blocksMax * 0.75));
      else if (gpuMs < 14 && blocksMax < target) blocksMax++;
      else if (blocksMax > target) blocksMax = target;
    });
  }
  run.frames++;
  if (run.frames % 15 === 0) refreshReadout(false);
}

async function readAndAnalyze(s) {
  const serial = run.serial;
  s.waiting = true;
  const rb = await s.gpu.readback();
  if (!rb) { s.waiting = false; return; }
  if (serial !== runSerial) return;
  const res = await workerCall({ type: 'analyze', N: s.N, np: s.gpu.np, body: rb.body, grav: rb.grav, rad: s.rad, X: rb.X, V: rb.V, GMp: s.pl.GM, t: rb.t, fragCount: 24, seed: run.frames }, [rb.body.buffer, rb.grav.buffer]);
  s.waiting = false;
  if (serial !== runSerial) return;
  onAnalysis(s, res, rb);
}
function onAnalysis(s, a, rb) {
  ren.setTags(s.e, a.tags);
  const T0 = run.T0, tt = a.t / T0;
  const f = a.M / s.M0;
  // energy ledger: E - W, relative to |U_self| at the start
  const ledger = a.E - rb.W;
  if (s.E0 === null) { s.E0 = ledger; s.Us0 = Math.abs(a.Us); s.L0 = a.L[2]; }
  const drift = Math.abs(ledger - s.E0) / s.Us0;
  const Ldrift = (a.L[2] + rb.Llost[2] - s.L0) / Math.abs(s.L0);
  // once the bound mass is small, the centre to follow is that of all grains
  // once the bound mass is small, the camera and the field use the frame
  // point (the start orbit of the satellite) instead of the remnant
  const live = f > 0.2 && a.M > 0;
  s.an = { f, live, com: live ? a.com : [0, 0, 0], vcm: live ? a.vcm : [0, 0, 0], rH: live ? a.rH : NaN, comAll: a.comAll, vcmAll: a.vcmAll, spread: a.spread, groups: a.groups, M: a.M, X: a.X, V: a.V, t: a.t, drift, Ldrift, accreted: a.accreted, wall: performance.now() };
  if (run.spec.drag || (s.pl.drag > 0)) s.an.drift = NaN;
  s.hist.push([tt, f]); if (s.hist.length > 2000) s.hist.splice(0, s.hist.length - 2000);
  if (Number.isFinite(s.an.drift)) { s.ehist.push([tt, Math.max(drift, 1e-12)]); if (s.ehist.length > 2000) s.ehist.splice(0, 1); }
  // shed-grain conics
  s.frag = [];
  const fr = a.frag;
  for (let i = 0; i + 5 < fr.length && s.frag.length < 6; i += 6) {
    const r = [fr[i], fr[i + 1], fr[i + 2]], v = [fr[i + 3], fr[i + 4], fr[i + 5]];
    s.frag.push(P.keplerPath(r, v, s.pl.GM, 0.1 * T0, 24).pts);
  }

  // a run point after 3 orbits (circular kinds only)
  if (!run.recorded && tt >= 3 && (run.spec.kind === 'circular' || run.spec.kind === 'compare' || run.spec.kind === 'real')) {
    if (s.idx === run.sats.length - 1) run.recorded = true;
    if (run.spec.kind !== 'flyby' && run.spec.kind !== 'spiral') addRunPoint({ x: run.spec.d / Math.cbrt(run.spec.q), y: f, mat: s.matName });
  }
}
function addRunPoint(p) {
  const list = loadRuns(); list.push(p); while (list.length > 60) list.shift();
  try { localStorage.setItem(RUNS_KEY, JSON.stringify(list)); } catch (e) {}
}
function loadRuns() { try { return JSON.parse(localStorage.getItem(RUNS_KEY) || '[]'); } catch (e) { return []; } }

// The bound centre now, in world units (planet radii), extrapolated from
// the last analysis with its velocity.
function satCentre(s) {
  const X = s.ref.X;
  if (!s.an) return [X[0] * s.k, X[1] * s.k, X[2] * s.k];
  const dt = s.gpu.t - s.an.t;
  return [0, 1, 2].map(i => (X[i] + s.an.com[i] + s.an.vcm[i] * dt) * s.k);
}
function satState(s) {
  const X = s.ref.X, V = s.ref.V;
  if (!s.an) return { r: X.slice(), v: V.slice() };
  const dt = s.gpu.t - s.an.t;
  return { r: [0, 1, 2].map(i => X[i] + s.an.com[i] + s.an.vcm[i] * dt), v: [0, 1, 2].map(i => V[i] + s.an.vcm[i]) };
}

// ── camera ────────────────────────────────────────────────────────────────
// The user found the first version nauseating: a follow camera that turned
// with the moon's orbit, hard cuts and fast moves at high time warp. Now:
//   - every view is inertial: az and el are fixed in space, never measured
//     from the moving moon; the up axis is +z, so there is no roll
//   - the default is the planet view (orbit centre at the centre)
//   - follow is opt-in; when the moon goes round the planet faster than
//     FOLLOW_MAX_DEG per real second, follow tracks the orbit centre instead
//   - a governor moves the camera: an ease toward the goal with a speed
//     limit and an acceleration limit, for the turn of the view, for the
//     target (as a fraction of the distance) and for the zoom. User input
//     (a drag, a pinch) moves it at once; a button choice gets a short
//     boost (still eased); everything else stays under ROT_MAX.
//   - camStats keeps the largest view rotation (deg/s, deg/frame) and the
//     largest shift of the planet centre on screen (deg/frame)
const RM_Q = window.matchMedia('(prefers-reduced-motion: reduce)');
const FOLLOW_MAX_DEG = 8;        // deg/s of the moon about the planet, real time
const ROT_MAX = { calm: 2.5, normal: 4 };        // deg/s, view turn
const LIN_MAX = { calm: 0.025, normal: 0.035 };  // target speed / distance, 1/s
const ZOOM_MAX = { calm: 0.08, normal: 0.12 };   // d(ln dist)/dt, 1/s
const cam = { az: 0.9, el: 0.42, zoom: 1, pose: null, user: false, dragging: false, boostUntil: 0, vr: 0, vl: 0, vz: 0, fastFollow: false };
const camStats = { rotDegS: 0, rotDegFrame: 0, planetDegFrame: 0, planetDegS: 0, frames: 0, userFrames: 0, prev: null };
function resetCamStats() { Object.assign(camStats, { rotDegS: 0, rotDegFrame: 0, planetDegFrame: 0, planetDegS: 0, frames: 0, userFrames: 0, prev: null }); }
// Reduce motion caps the time warp at 4 blocks a frame.
function warpIndex() { return UI.calm ? Math.min(UI.warp, 5) : UI.warp; }
// sim time per real second at the current warp
function simRate() { const s = run.sats[0]; return UI.paused ? 0 : WARP[warpIndex()] * 32 * s.C.dt * Math.min(60, Math.max(20, fps)); }
function camGoal(cssW, cssH) {
  const s = run.sats[0];
  const dW = s.ref ? Math.hypot(...s.ref.X) * s.k : run.spec.d || 2;
  const Rw = (s.Rs || s.C.Rs) * s.k;
  let target, dist, el = cam.el;
  let mode = UI.cam;
  cam.fastFollow = false;
  if (mode === 'follow' && run.phase === 'orbit') {
    // how fast does the moon go round the planet, in real time?
    const st = satState(s), r = Math.hypot(...st.r), h = Math.hypot(...cross(st.r, st.v));
    const degS = h / (r * r) * simRate() * 180 / Math.PI;
    if (degS > FOLLOW_MAX_DEG) { cam.fastFollow = true; mode = 'planet'; }
  }
  if (mode === 'follow') {
    target = satCentre(s);
    dist = 9 * Rw;
    if (run.spec.kind === 'flyby' && s.an && s.an.comAll) {
      const dt = s.gpu.t - s.an.t;
      if (!s.an.live) target = [0, 1, 2].map(i => (s.ref.X[i] + s.an.comAll[i] + s.an.vcmAll[i] * dt) * s.k);
      dist = Math.min(Math.max(dist, 1.2 * s.an.spread * s.k), 30 * Rw);
    }
  } else if (mode === 'planet') {
    target = [0, 0, 0]; dist = 2.7 * Math.max(Math.min(dW, 5), 2.0); el = Math.max(0.28, cam.el);
    if (run.spec.kind === 'compare') dist = 2.5 * Math.max(dW, 2);
  } else {
    target = [0, 0, 0]; dist = 3.1 * Math.max(Math.min(dW, 3.2), 1.8); el = 1.42;
  }
  if (mode !== 'follow') dist *= Math.max(1, 0.8 * cssH / cssW);
  return { target, dist: dist * cam.zoom, az: cam.az, el };
}
// The eye and target for a goal, framed in the clear part of the canvas.
function poseOf(g, cssW, cssH) {
  const o = occlusion(cssW, cssH);
  const clearW = Math.max(80, cssW - o.l - o.r), clearH = Math.max(80, cssH - o.t - o.b);
  const fit = Math.min(1.9, Math.max(cssW / clearW * 0.85, cssH / clearH, 1));
  const dist = g.dist * fit;
  const ce = Math.cos(g.el), dir = [ce * Math.cos(g.az), ce * Math.sin(g.az), Math.sin(g.el)];
  const eye = [0, 1, 2].map(i => g.target[i] + dist * dir[i]), target = g.target.slice();
  const f = norm(sub(target, eye)), r = norm(cross(f, [0, 0, 1])), u = cross(r, f);
  const focal = 0.5 * cssH / Math.tan(FOV / 2);
  const ox = (o.l - o.r) / 2, oy = (o.b - o.t) / 2;
  const sx = -ox * dist / focal, sy = -oy * dist / focal;
  for (let i = 0; i < 3; i++) { const d = sx * r[i] + sy * u[i]; eye[i] += d; target[i] += d; }
  const re = Math.hypot(...eye);
  if (re < 1.3) for (let i = 0; i < 3; i++) eye[i] *= 1.3 / re;
  return { eye, target };
}
const FOV = 0.62;
// rotate unit vector a toward unit vector b by at most ang (radians)
function turnToward(a, b, ang) {
  const c = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])), full = Math.acos(c);
  if (full < 1e-9) return b.slice();
  if (ang >= full) return b.slice();
  let ax = cross(a, b); const l = Math.hypot(...ax);
  ax = l < 1e-9 ? [0, 0, 1] : ax.map(q => q / l);
  const cs = Math.cos(ang), sn = Math.sin(ang), d = ax[0] * a[0] + ax[1] * a[1] + ax[2] * a[2], x = cross(ax, a);
  return [0, 1, 2].map(i => a[i] * cs + x[i] * sn + ax[i] * d * (1 - cs));
}
function cameraFrame(dtReal, cssW, cssH) {
  const g = camGoal(cssW, cssH);
  if (saverOn && saver) saverCamera(g, dtReal);
  const want = poseOf(g, cssW, cssH);
  const P0 = cam.pose;
  if (!P0 || ![...P0.eye, ...P0.target].every(Number.isFinite)) { cam.pose = { eye: want.eye.slice(), target: want.target.slice() }; return finishPose(dtReal, true); }
  const dt = Math.max(1e-3, Math.min(0.1, dtReal));
  const user = cam.dragging || performance.now() < (cam.userUntil || 0), boost = performance.now() < cam.boostUntil;
  const calm = UI.calm ? 'calm' : 'normal';
  const rotMax = (user ? 720 : boost ? 20 : ROT_MAX[calm]) * Math.PI / 180;
  const linMax = user ? 50 : boost ? 0.3 : LIN_MAX[calm];
  const zoomMax = user ? 50 : boost ? 0.5 : ZOOM_MAX[calm];
  const acc = user ? 1e9 : 2.0;            // speed limits are reached in about 0.5 s
  const ease = 1 - Math.exp(-dt * (user ? 40 : 1.4));
  // the offset of the eye from the target: direction and length
  const oC = sub(P0.eye, P0.target), oW = sub(want.eye, want.target);
  const lC = Math.hypot(...oC), lW = Math.hypot(...oW);
  const dC = oC.map(q => q / lC), dW2 = oW.map(q => q / lW);
  const ang = Math.acos(Math.max(-1, Math.min(1, dC[0] * dW2[0] + dC[1] * dW2[1] + dC[2] * dW2[2])));
  cam.vr = Math.min(Math.min(rotMax, ang * ease / dt), cam.vr + acc * rotMax * dt);
  const dir = turnToward(dC, dW2, cam.vr * dt);
  const lz = Math.log(lW / lC);
  cam.vz = Math.min(Math.min(zoomMax, Math.abs(lz) * ease / dt), cam.vz + acc * zoomMax * dt);
  const len = lC * Math.exp(Math.sign(lz) * Math.min(Math.abs(lz), cam.vz * dt));
  const dT = sub(want.target, P0.target), lT = Math.hypot(...dT);
  const vmax = linMax * len;
  cam.vl = Math.min(Math.min(vmax, lT * ease / dt), cam.vl + acc * vmax * dt);
  const stepT = lT > 1e-12 ? Math.min(lT, cam.vl * dt) / lT : 0;
  const target = [0, 1, 2].map(i => P0.target[i] + dT[i] * stepT);
  let eye = [0, 1, 2].map(i => target[i] + dir[i] * len);
  const re = Math.hypot(...eye);
  if (re < 1.3) eye = eye.map(q => q * 1.3 / re);
  cam.pose = { eye, target };
  return finishPose(dtReal, false, user || boost);
}
// The frame for the renderer, and the motion statistics.
function finishPose(dtReal, snapped, exempt = false) {
  const { eye, target } = cam.pose;
  const dist = Math.hypot(...sub(eye, target));
  const f = norm(sub(target, eye)), r = norm(cross(f, [0, 0, 1])), u = cross(r, f);
  const pc = norm(sub([0, 0, 0], eye));
  const pcCam = [dot3(pc, r), dot3(pc, u), dot3(pc, f)];
  const pv = camStats.prev;
  if (pv && !snapped && dtReal > 0 && dtReal < 0.1) {
    // the turn between the two camera bases: angle of B_prev^T B_now
    const tr = dot3(pv.r, r) + dot3(pv.u, u) + dot3(pv.f, f);
    const rot = Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) * 180 / Math.PI;
    const pl = Math.acos(Math.max(-1, Math.min(1, dot3(pv.pc, pcCam)))) * 180 / Math.PI;
    if (exempt || (saverOn && saver && saver.fade < 0.05)) camStats.userFrames++;
    else {
      camStats.frames++;
      camStats.rotDegFrame = Math.max(camStats.rotDegFrame, rot); camStats.rotDegS = Math.max(camStats.rotDegS, rot / dtReal);
      camStats.planetDegFrame = Math.max(camStats.planetDegFrame, pl); camStats.planetDegS = Math.max(camStats.planetDegS, pl / dtReal);
    }
  }
  camStats.prev = { r, u, f, pc: pcCam };
  return { eye, target, fov: FOV, near: Math.max(1e-4, dist * 0.02), subject: target };
}
function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

// ── overlays: lines ───────────────────────────────────────────────────────
let segs = new Float32Array(16 * 8192), segN = 0;
function seg(a, b, ca, cb, w) {
  if (segN >= 8192) return;
  const o = segN++ * 16;
  segs[o] = a[0]; segs[o + 1] = a[1]; segs[o + 2] = a[2]; segs[o + 3] = w;
  segs[o + 4] = b[0]; segs[o + 5] = b[1]; segs[o + 6] = b[2];
  segs.set(ca, o + 8); segs.set(cb, o + 12);
}
function circle(c, r, col, w, dash = 0, n = 192) {
  for (let i = 0; i < n; i++) {
    if (dash && (i % 4) >= 2) continue;
    const a0 = 2 * Math.PI * i / n, a1 = 2 * Math.PI * (i + 1) / n;
    seg([c[0] + r * Math.cos(a0), c[1] + r * Math.sin(a0), c[2]], [c[0] + r * Math.cos(a1), c[1] + r * Math.sin(a1), c[2]], col, col, w);
  }
}
function hex(h, a) { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, a]; }
function buildSegments(dpr) {
  segN = 0;
  const s0 = run.sats[0], L = run.limits || limitsFor(run.spec);
  const W = 1.6 * dpr;
  if (UI.rings) {
    circle([0, 0, 0], L.rigid, hex(MAT_COLOR.rigid, 0.85), W);
    circle([0, 0, 0], L.sync, hex('#ffd666', 0.55), W * 0.8, 1);
    circle([0, 0, 0], L.fluid, hex(MAT_COLOR.fluid, 0.85), W);
  }
  if (run.phase !== 'orbit') return;
  for (const s of run.sats) {
    const c = satCentre(s);
    if (UI.hill && s.an && s.an.live && Number.isFinite(s.an.rH)) circle(c, s.an.rH * s.k, [1, 1, 1, 0.45], W * 0.8, 1, 96);
    if (UI.pred && (!s.an || s.an.live)) {
      const st = satState(s);
      const T = run.spec.kind === 'flyby' ? 2.5 * run.T0 : run.T0;
      const pts = P.keplerPath(st.r, st.v, s.pl.GM, T, 200).pts;
      for (let i = 0; i < 199; i++) {
        const a0 = 0.9 * (1 - i / 199), a1 = 0.9 * (1 - (i + 1) / 199);
        seg([pts[3 * i] * s.k, pts[3 * i + 1] * s.k, pts[3 * i + 2] * s.k], [pts[3 * i + 3] * s.k, pts[3 * i + 4] * s.k, pts[3 * i + 5] * s.k], [1, 0.95, 0.85, a0], [1, 0.95, 0.85, a1], W);
      }
    }
    if (UI.pred && !saverOn) {
      for (const fp of s.frag) {
        for (let i = 0; i < 23; i++) {
          const a0 = 0.32 * (1 - i / 23), a1 = 0.32 * (1 - (i + 1) / 23);
          seg([fp[3 * i] * s.k, fp[3 * i + 1] * s.k, fp[3 * i + 2] * s.k], [fp[3 * i + 3] * s.k, fp[3 * i + 4] * s.k, fp[3 * i + 5] * s.k], [0.55, 0.85, 1, a0], [0.55, 0.85, 1, a1], W * 0.55);
        }
      }
    }
  }
  if (UI.track && run.track.length > 1) {
    const tr = run.track, n = tr.length;
    for (let i = 1; i < n; i++) { const a = 0.6 * i / n; seg(tr[i - 1], tr[i], [1, 0.75, 0.35, a * 0.9], [1, 0.75, 0.35, a], W * 0.9); }
    if (s0.an && s0.an.live) seg(tr[n - 1], satCentre(s0), [1, 0.75, 0.35, 0.6], [1, 0.75, 0.35, 0.6], W * 0.9);
  }
}

// ── field overlay ─────────────────────────────────────────────────────────
// World units: lengths in R_p, GM scaled by k^3, Omega in 1/sim time.
function fieldParams() {
  const s = run.sats[0];
  const k = s.k, c = satCentre(s);
  // the bound mass while the moon lives; after that, the start mass at the
  // frame point (the lobe a moon of that mass would have there)
  const fM = s.an && s.an.live ? s.an.f : 1;
  const GMs = P.G * (s.M0 || 1) * fM * k ** 3, GMp = s.pl.GM * k ** 3;
  const st = satState(s);
  const r = Math.hypot(...st.r), h = Math.hypot(...cross(st.r, st.v));
  const omega = h / (r * r);
  const satR = (s.Rs || s.C.Rs) * k * Math.cbrt(fM);
  const phi = p => { const rp = Math.max(Math.hypot(...p), 1), rs = Math.max(Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]), satR); return -GMp / rp - GMs / rs - 0.5 * omega * omega * (p[0] * p[0] + p[1] * p[1]); };
  // L1: the highest Phi on the line from the planet to the satellite
  const dc = Math.hypot(...c), u = c.map(q => q / dc);
  let best = -Infinity, bx = 0;
  for (let i = 0; i <= 400; i++) { const x = dc * (0.55 + 0.45 * i / 400) - satR * 0.2; const v = phi(u.map(q => q * x)); if (x < dc - satR && v > best) { best = v; bx = x; } }
  // colour scale: the depth of the satellite's lobe below L1
  const depth = Math.abs(best - phi([c[0] + u[0] * satR, c[1] + u[1] * satR, c[2] + u[2] * satR]));
  return { GMs, GMp, omega, phiL1: best, L1: u.map(q => q * bx), satR, c, scale: Math.max(depth, 1e-9), ext: Math.max(2.2, dc + 1.2) };
}

// The field values change in steps when an analysis lands (bound mass,
// L1): ease them over about a second, so the contours never jump.
let fieldS = null;
function smoothField(f, dt) {
  if (!fieldS || fieldS.serial !== run.serial) { fieldS = Object.assign({ serial: run.serial }, f); return f; }
  const k = 1 - Math.exp(-Math.min(0.1, dt || 0.016) / (UI.calm ? 1.2 : 0.6));
  for (const key of ['GMs', 'omega', 'phiL1', 'scale', 'satR', 'ext']) fieldS[key] += (f[key] - fieldS[key]) * k;
  fieldS.L1 = fieldS.L1.map((q, i) => q + (f.L1[i] - q) * k);
  return Object.assign({}, f, fieldS, { c: f.c });
}

// ── draw ──────────────────────────────────────────────────────────────────
// The sun behind the planet as seen from the eye, and below the ring
// plane while the eye is above it: the ring is seen in transmitted,
// forward-scattered light, and the atmosphere rim glows.
function backlitSun(cf) { const d = norm(sub([0, 0, 0], cf.eye)); return norm([d[0] + 0.14, d[1] - 0.06, -Math.abs(d[2]) - 0.10]); }
// the sun: about 40 degrees from the default view and 34 degrees above the
// orbit plane, so a moon beyond 1.8 R_p is never in the planet's shadow
const SUN = norm([-0.024, 0.825, 0.565]);
function drawFrame(now, cssW, cssH, blocks) {
  const dtReal = Math.min(0.1, (now - (run.lastDraw || now)) / 1000); run.lastDraw = now;
  const cf = cameraFrame(dtReal || 0.016, cssW, cssH);
  const dpr = ren.W / cssW;
  const spec = run.spec;
  const fp = run.phase === 'orbit' ? smoothField(fieldParams(), dtReal) : null;
  const s0 = run.sats[0];
  const frame = {
    eye: cf.eye, target: cf.target, fov: cf.fov, near: cf.near, time: now / 1000,
    sun: saverOn && saver && saver.backlit ? backlitSun(cf) : SUN, sunI: 1.45,
    atm: spec.style === 3 ? 0.035 : 0.05, spin: now / 1000 * 0.02, style: spec.style ?? 0, shine: 0.25,
    sat: fp ? fp.c : satCentre(s0), satR: fp ? fp.satR : (s0.C.Rs * s0.k),
    GMs: fp ? fp.GMs : 0, GMp: fp ? fp.GMp : 0, omega: fp ? fp.omega : 0, phiL1: fp ? fp.phiL1 : 0,
    fieldMode: fp ? UI.field : 0, fieldExt: fp ? fp.ext : 4, fieldScale: fp ? fp.scale : 1, fieldAlpha: 0.62,
    ringExt: 3.6, ringGain: UI.ringGain, ringBlend: blocks > 0 ? (UI.calm ? 0.94 : Math.min(0.92, 0.6 + 0.08 * blocks)) : 0.97, ringOn: UI.ringOn,
    exposure: 0.88 * (saverOn ? saverFade(dtReal) : 1), bloom: 0.08, bloomThreshold: 1.0, vignette: 0.32,
    grainR: s0.k,   // the mean grain radius (1) in world units
  };
  if (run.spec.key === 'ring' || (saver && saver.longRing)) frame.ringBlend = blocks > 0 ? Math.max(frame.ringBlend, 0.92) : 0.97;
  // the past track of the bound centre: one point per 0.01 R_p of travel
  if (run.phase === 'orbit' && s0.an && s0.an.live) {
    const c = satCentre(s0), tr = run.track, l = tr[tr.length - 1];
    if (!l || Math.hypot(c[0] - l[0], c[1] - l[1], c[2] - l[2]) > 0.01) { tr.push(c); if (tr.length > 1500) tr.shift(); }
  }
  buildSegments(dpr);
  ren.setSegments(segs, segN);
  // sim time of this frame: the grains' screen motion (streaks if on, and
  // the dimming of grains that jump more than a few px)
  const frameT = blocks > 0 ? blocks * 32 * s0.C.dt : 0;
  const motion = [UI.blur && !UI.calm ? 1 : 0, UI.calm ? 3 : 6, UI.calm ? 0.04 : 0.08];
  const sims = run.sats.map(s => ({
    e: s.e, ring: run.phase === 'orbit',
    frame: [s.ref.X[0] * s.k, s.ref.X[1] * s.k, s.ref.X[2] * s.k, s.k],
    refV: [s.ref.V[0] * s.k, s.ref.V[1] * s.k, s.ref.V[2] * s.k, frameT], motion,
    opts: [UI.color, UI.color === 2 ? 1 : 0, 1.0, s.C.vesc],
    tint: s.matName === 'rigid' ? [1.0, 0.82, 0.62, 1] : s.matName === 'cohesive' ? [0.75, 1.0, 0.72, 1] : [0.78, 0.9, 1.0, 1],
  }));
  if (run.phase === 'settle') for (const s of sims) s.frame = [s.frame[0], s.frame[1], s.frame[2], s.frame[3]];
  ren.render(frame, sims);
  placeLabels(cssW, cssH, fp);
}

// ── DOM labels ────────────────────────────────────────────────────────────
const labelEls = {};
function label(key, text, cls) {
  let el = labelEls[key];
  if (!el) { el = labelEls[key] = document.createElement('div'); el.className = 'lbl ' + (cls || ''); $('labels').appendChild(el); }
  if (el.textContent !== text) el.textContent = text;
  return el;
}
function placeLabels(cssW, cssH, fp) {
  const show = (key, text, p, cls, dy = 0) => {
    const el = label(key, text, cls);
    const q = p && ren.project(p, cssW, cssH);
    if (!q || q.x < 0 || q.y < 0 || q.x > cssW || q.y > cssH) { el.style.display = 'none'; return; }
    el.style.display = ''; el.style.transform = `translate(${q.x.toFixed(1)}px, ${(q.y + dy).toFixed(1)}px)`;
  };
  const L = run.limits || limitsFor(run.spec);
  // put the ring names on the side of the circle nearest the viewer
  const a = cam.az - 0.35;
  const on = UI.rings && !saverOn;
  // each name at its own angle, so the three do not stack where the
  // circles are close on screen
  for (const [key, r, name, da] of [['rigid', L.rigid, 'rigid limit', -0.5], ['sync', L.sync, 'synchronous rigid', -0.22], ['fluid', L.fluid, 'fluid limit', 0.08]]) {
    if (!on) { label('r_' + key, '').style.display = 'none'; continue; }
    show('r_' + key, `${name} ${r.toFixed(2)} R`, [r * Math.cos(a + da), r * Math.sin(a + da), 0], 'ring-' + key, -8);
  }
  const showL1 = fp && UI.field === 1 && !saverOn && run.sats[0].an && run.sats[0].an.live;
  if (showL1) show('L1', 'L1', fp.L1, 'pt'); else label('L1', '').style.display = 'none';
}

// ── readout and plots ─────────────────────────────────────────────────────
function fmtTime(sec) {
  if (sec < 120) return sec.toFixed(0) + ' s';
  if (sec < 7200) return (sec / 60).toFixed(1) + ' min';
  if (sec < 3 * 86400) return (sec / 3600).toFixed(1) + ' h';
  return (sec / 86400).toFixed(1) + ' d';
}
function refreshReadout(force) {
  if (!run || !run.sats.length) return;
  const s = run.sats[0], spec = run.spec, L = run.limits || limitsFor(spec);
  const st = satState(s);
  const dNow = Math.hypot(...st.r) / s.Rp;
  const tt = run.t / run.T0;
  const unit = spec.kind === 'flyby' ? 'T_q' : 'orbits';
  let tStr;
  if (spec.kind === 'flyby' && run.tPeri !== undefined) { const tp = (run.t - run.tPeri) / run.T0; tStr = `${tp >= 0 ? '+' : '−'}${Math.abs(tp).toFixed(2)} from pericentre`; }
  else tStr = `${tt.toFixed(2)} ${unit}`;
  const real = run.tUnitSec ? fmtTime((spec.kind === 'flyby' && run.tPeri !== undefined ? Math.abs(run.t - run.tPeri) : run.t) * run.tUnitSec) : '';
  $('rdT').textContent = `${tStr} · ${real}`;
  $('rdD').textContent = dNow.toFixed(3);
  $('rdDr').textContent = (dNow / L.rigid).toFixed(3);
  $('rdDf').textContent = (dNow / L.fluid).toFixed(3);
  const bnd = run.sats.map(x => x.an ? (100 * x.an.f).toFixed(1) + '%' : '—').join(' · ');
  $('rdB').textContent = bnd;
  $('rdG').textContent = s.an ? String(s.an.groups) : '—';
  $('rdH').textContent = s.an && s.an.live && Number.isFinite(s.an.rH) ? (s.an.rH / (s.Rs * Math.cbrt(s.an.f))).toFixed(2) : '—';
  $('rdRho').textContent = s.pile ? `${s.pile.st.rho.toFixed(3)} (packing ${(s.pile.st.rho / P.RHO_GRAIN).toFixed(2)})` : '—';
  $('rdE').textContent = s.an && Number.isFinite(s.an.drift) ? s.an.drift.toExponential(1) + ' |U_s|' : (s.pl && s.pl.drag ? 'drag on' : '—');
  $('rdL').textContent = s.an && Number.isFinite(s.an.Ldrift) && !(s.pl && s.pl.drag) ? s.an.Ldrift.toExponential(1) : '—';
  $('rdAcc').textContent = s.an ? String(s.an.accreted) : '—';
  $('rdDt').textContent = `${s.C.dt.toExponential(2)} (${Math.round(run.T0 / s.C.dt).toLocaleString()} per orbit)`;
  $('camHint').textContent = cam.fastFollow ? 'The moon goes round faster than 8 degrees per second at this time warp, so the view stays on the orbit centre. Lower the time warp to follow the moon.' : (UI.cam === 'follow' ? 'The view follows the moon, with its direction fixed in space.' : '');
  $('rdGpu').textContent = `${gpuMs.toFixed(1)} ms · ${blocksMax} blocks max · ${fps.toFixed(0)} fps`;
  // gauge: a_tide / g at the surface of the bound mass
  const fB = s.an ? Math.max(s.an.f, 1e-3) : 1;
  const ratio = 2 * spec.q * Math.pow(1 / dNow, 3) * (1 / 1);   // = 2 (M_p/m)(r/d)^3 with rho_s fixed
  void fB;
  drawGauge($('gaugeC'), ratio);
  $('gaugeV').textContent = ratio.toFixed(2);
  const tMax = Math.max(1, Math.ceil(Math.max(tt, 0.5) * 1.15));
  const tu = spec.kind === 'flyby' ? 'T_q' : 'orbits';
  drawBound($('boundC'), run.sats.map(x => ({ pts: x.hist, color: x.color })), tMax, tu);
  $('boundV').textContent = bnd;
  drawEnergy($('energyC'), run.sats.map(x => ({ pts: x.ehist, color: x.color })), tMax, tu);
  $('energyV').textContent = s.an && Number.isFinite(s.an.drift) ? s.an.drift.toExponential(1) : '—';
  const xCur = (spec.kind === 'flyby' ? spec.peri : dNow) / Math.cbrt(spec.q);
  drawRuns($('runsC'), loadRuns(), REF_SWEEP, xCur);
  $('runsV').textContent = `x = d / R_p q^⅓ = ${xCur.toFixed(2)}`;
  const sc = SCENARIOS.find(x => x.key === UI.scen);
  $('stMain').textContent = spec.name || (sc && sc.name) || '';
  $('stRight').textContent = `t ${tStr} · d ${dNow.toFixed(2)} R_p · bound ${bnd}`;
}

// ── UI ────────────────────────────────────────────────────────────────────
function buildUI() {
  const scBox = $('scenarios');
  for (const sc of SCENARIOS) {
    const b = document.createElement('button');
    b.dataset.k = sc.key; b.innerHTML = `<b>${sc.short}</b><span>${sc.name}</span>`;
    b.addEventListener('click', () => { applyScenario(sc.key); startRun(); });
    scBox.appendChild(b);
  }
  const bBox = $('bodies');
  for (const [k, r] of Object.entries(REAL)) {
    const b = document.createElement('button'); b.dataset.b = k; b.textContent = r.name.replace(' at ', ' · ').replace(' in the rings of ', ' · ');
    b.addEventListener('click', () => { UI.body = k; applyScenario('bodies'); startRun(); });
    bBox.appendChild(b);
  }
  const nSel = $('nSel');
  for (const n of N_OPTS) { const o = document.createElement('option'); o.value = n; o.textContent = (n / 1024) + 'k' + (n >= 24576 ? ' (fast GPU)' : ''); nSel.appendChild(o); }
  nSel.value = UI.N;
  nSel.addEventListener('change', () => { UI.N = +nSel.value; startRun(); });
  const bind = (id, key, fmt, after, live = false) => {
    const inp = $(id), out = $(id + 'V');
    const show = () => { UI[key] = +inp.value; if (out) out.textContent = fmt(+inp.value); };
    inp.addEventListener('input', () => { show(); if (live && after) after(); });
    inp.addEventListener('change', () => { show(); if (!live && after) after(); });
    show();
  };
  bind('d', 'd', v => v.toFixed(2), () => startRun());
  bind('peri', 'peri', v => v.toFixed(2), () => startRun());
  bind('ecc', 'e', v => v.toFixed(2), () => startRun());
  bind('q', 'qLog', v => Math.pow(10, v).toFixed(2), () => startRun());
  bind('j2', 'J2', v => v.toFixed(4), () => startRun());
  bind('mu', 'mu', v => v.toFixed(2), () => startRun());
  bind('coh', 'coh', v => v.toFixed(2), () => startRun());
  bind('warp', 'warp', v => WARP[v] ? `${WARP[v]}` : 'paused', () => { syncWarp(); }, true);
  bind('ringGain', 'ringGain', v => '×' + v, null, true);
  for (const b of $('materials').querySelectorAll('button')) b.addEventListener('click', () => {
    UI.material = b.dataset.m; const m = P.MATERIALS[UI.material]; UI.mu = m.mu; UI.coh = m.coh;
    $('mu').value = UI.mu; $('coh').value = UI.coh; $('muV').textContent = UI.mu.toFixed(2); $('cohV').textContent = UI.coh.toFixed(2);
    syncButtons(); startRun();
  });
  const segBtns = (box, key, attr, conv = v => v) => { for (const b of $(box).querySelectorAll('button')) b.addEventListener('click', () => { UI[key] = conv(b.dataset[attr]); cam.boostUntil = performance.now() + 3000; syncButtons(); }); };
  segBtns('cams', 'cam', 'c'); segBtns('colors', 'color', 'k', Number); segBtns('fields', 'field', 'f', Number);
  // Reduce motion: on when the system asks for it, until the user sets it
  let calmSet = false;
  $('tCalm').addEventListener('change', () => { calmSet = true; });
  RM_Q.addEventListener('change', e => { if (!calmSet) { UI.calm = e.matches; $('tCalm').checked = UI.calm; } });
  for (const [id, key] of [['tCalm', 'calm'], ['tRings', 'rings'], ['tHill', 'hill'], ['tPred', 'pred'], ['tTrack', 'track'], ['tRing', 'ringOn'], ['tBlur', 'blur']]) {
    const c = $(id); c.checked = UI[key]; c.addEventListener('change', () => { UI[key] = c.checked; });
  }
  $('restartBtn').addEventListener('click', () => startRun());
  const setPaused = p => { UI.paused = p; $('pauseBtn').textContent = p ? 'Play' : 'Pause'; $('dockPlay').textContent = p ? '▶' : '❚❚'; $('dockPlay').classList.toggle('on', p); };
  $('pauseBtn').addEventListener('click', () => setPaused(!UI.paused));
  $('dockPlay').addEventListener('click', () => setPaused(!UI.paused));
  for (const b of $('dockWarp').querySelectorAll('button')) b.addEventListener('click', () => { UI.warp = Math.max(1, Math.min(WARP.length - 1, UI.warp + +b.dataset.d)); $('warp').value = UI.warp; $('warpV').textContent = WARP[UI.warp]; syncWarp(); });
  $('dockHeat').addEventListener('click', () => { UI.field = (UI.field + 1) % 3; syncButtons(); });
  $('dockCam').addEventListener('click', () => { UI.cam = { follow: 'planet', planet: 'top', top: 'follow' }[UI.cam]; cam.boostUntil = performance.now() + 3000; syncButtons(); });
  $('hudToggle').addEventListener('click', () => { const h = $('hud'); h.classList.toggle('min'); $('hudToggle').textContent = h.classList.contains('min') ? '◂' : '▸'; });
  // panel, phone sheet, dock (the wave-membrane pattern)
  const panel = $('panel'), dockPanel = $('dockPanel');
  const setOpen = open => {
    panel.classList.toggle('open', open); if (!open) panel.classList.remove('full');
    document.body.classList.toggle('panel-closed', !open);
    dockPanel.classList.toggle('on', open); dockPanel.setAttribute('aria-expanded', String(open));
  };
  const toggle = () => setOpen(!panel.classList.contains('open'));
  $('gear').addEventListener('click', toggle); dockPanel.addEventListener('click', toggle);
  $('panelClose').addEventListener('click', () => setOpen(false));
  setOpen(!PHONE_Q.matches);
  const placePlots = () => { (PHONE_Q.matches ? $('plotsHome') : $('hud')).insertBefore($('plotsHud'), PHONE_Q.matches ? null : $('hudToggle')); };
  placePlots();
  PHONE_Q.addEventListener('change', e => { setOpen(!e.matches); placePlots(); });
  const grip = $('sheetGrip'); let gripY = null;
  grip.addEventListener('pointerdown', e => { gripY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) {} });
  grip.addEventListener('pointerup', e => {
    if (gripY === null) return; const dy = e.clientY - gripY; gripY = null;
    if (Math.abs(dy) < 8) panel.classList.toggle('full'); else if (dy < -40) panel.classList.add('full');
    else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
  });
  grip.addEventListener('pointercancel', () => { gripY = null; });
  bindPointer();
  applyScenario(UI.scen, true);
}
function syncWarp() { $('dockWarpV').textContent = WARP[UI.warp] >= 1 ? WARP[UI.warp] + '×' : WARP[UI.warp] ? '¼–½' : '0'; blocksMax = Math.max(blocksMax, 1); $('warpHint').textContent = warpHint(); }
function warpHint() {
  const w = WARP[UI.warp];
  if (!run || !run.sats.length || !w) return w ? '' : 'Paused.';
  const s = run.sats[0], perSec = w * 32 * s.C.dt * Math.min(60, fps);
  return `${w} blocks of 32 steps per frame: about ${(perSec / run.T0 * 60).toFixed(1)} orbits per minute at ${Math.round(fps)} fps (lower if the GPU is busy).`;
}
function applyScenario(key, quiet) {
  UI.scen = key;
  const sc = SCENARIOS.find(s => s.key === key);
  const src = sc.kind === 'real' ? REAL[UI.body] : sc;
  UI.d = src.d ?? UI.d; UI.peri = src.peri ?? UI.peri; UI.e = src.e ?? UI.e;
  UI.qLog = Math.log10(src.q ?? 1); UI.J2 = src.J2 || 0;
  UI.material = src.material || (sc.materials ? sc.materials[0] : 'fluid');
  const m = P.MATERIALS[UI.material]; UI.mu = m.mu; UI.coh = m.coh;
  UI.cam = src.cam || sc.cam || 'planet'; cam.zoom = 1; cam.boostUntil = performance.now() + 3000;
  if (!quiet || true) { UI.warp = sc.warp ?? UI.warp; }
  for (const [id, key2, f] of [['d', 'd', v => v.toFixed(2)], ['peri', 'peri', v => v.toFixed(2)], ['ecc', 'e', v => v.toFixed(2)], ['q', 'qLog', v => Math.pow(10, v).toFixed(2)], ['j2', 'J2', v => v.toFixed(4)], ['mu', 'mu', v => v.toFixed(2)], ['coh', 'coh', v => v.toFixed(2)], ['warp', 'warp', v => WARP[v] ? `${WARP[v]}` : 'paused']]) {
    $(id).value = UI[key2]; $(id + 'V').textContent = f(UI[key2]);
  }
  const kind = sc.kind === 'real' ? REAL[UI.body].kind : sc.kind;
  $('rowD').style.display = kind === 'flyby' ? 'none' : '';
  $('rowPeri').style.display = kind === 'flyby' ? '' : 'none';
  $('rowEcc').style.display = kind === 'flyby' ? '' : 'none';
  $('bodyBox').style.display = sc.kind === 'real' ? '' : 'none';
  $('scenHint').textContent = sc.kind === 'real' ? REAL[UI.body].note : sc.hint;
  syncButtons(); syncWarp();
}
function syncButtons() {
  for (const b of $('scenarios').querySelectorAll('button')) b.classList.toggle('on', b.dataset.k === UI.scen);
  for (const b of $('bodies').querySelectorAll('button')) b.classList.toggle('on', b.dataset.b === UI.body);
  for (const b of $('materials').querySelectorAll('button')) b.classList.toggle('on', b.dataset.m === UI.material);
  $('materials').classList.toggle('dim', UI.scen === 'compare');
  for (const b of $('cams').querySelectorAll('button')) b.classList.toggle('on', b.dataset.c === UI.cam);
  for (const b of $('colors').querySelectorAll('button')) b.classList.toggle('on', +b.dataset.k === UI.color);
  for (const b of $('fields').querySelectorAll('button')) b.classList.toggle('on', +b.dataset.f === UI.field);
  $('dockHeat').classList.toggle('on', UI.field > 0);
  $('matHint').textContent = UI.scen === 'compare' ? 'This scenario runs one fluid and one rough moon.' : P.MATERIALS[UI.material].note;
  drawLegend();
}
function drawLegend() {
  const lg = $('legend');
  lg.classList.toggle('off', UI.field === 0 && UI.color !== 2);
  const c = $('lgBar'), g = c.getContext('2d'), w = c.width, h = c.height;
  const grad = g.createLinearGradient(0, 0, w, 0);
  if (UI.field === 1) {
    $('lgTitle').textContent = 'Roche potential, relative to L1 (bright line: Roche lobe)';
    [[0, '#1a8cd9'], [0.35, '#0f3d5e'], [0.5, '#080a12'], [0.65, '#9b3b2c'], [1, '#ffd173']].forEach(([o, col]) => grad.addColorStop(o, col));
    $('lgLo').textContent = 'held'; $('lgMid').textContent = 'L1'; $('lgHi').textContent = 'free';
  } else {
    $('lgTitle').textContent = UI.field === 2 ? 'Tidal stretch |a_tide| / |a_sat| (bright line: 1)' : 'Grain stress |tide| / |self-gravity|';
    [[0, '#05051a'], [0.25, '#4d1a8c'], [0.5, '#d94059'], [0.75, '#ff9e26'], [1, '#fff8bf']].forEach(([o, col]) => grad.addColorStop(o, col));
    const lo = UI.field === 2 ? '0.01' : '0.03', hi = UI.field === 2 ? '100' : '30';
    $('lgLo').textContent = lo; $('lgMid').textContent = '1'; $('lgHi').textContent = hi;
  }
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
}

// pointer: drag to orbit, pinch or wheel to zoom, double-click to reset
function bindPointer() {
  const c = $('gpu'), pts = new Map();
  let pinch0 = 0, zoom0 = 1;
  c.addEventListener('pointerdown', e => { pts.set(e.pointerId, [e.clientX, e.clientY]); try { c.setPointerCapture(e.pointerId); } catch (x) {} if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); zoom0 = cam.zoom; } });
  c.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) {
      cam.az -= (e.clientX - prev[0]) * 0.006; cam.el = Math.max(-1.45, Math.min(1.45, cam.el + (e.clientY - prev[1]) * 0.006));
      cam.dragging = true;
    } else if (pts.size === 2 && pinch0 > 0) {
      const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      cam.zoom = Math.max(0.08, Math.min(8, zoom0 * pinch0 / d)); cam.dragging = true;
    }
  });
  const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch0 = 0; if (!pts.size) { cam.dragging = false; cam.userUntil = performance.now() + 250; } };
  c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
  c.addEventListener('wheel', e => { e.preventDefault(); cam.zoom = Math.max(0.08, Math.min(8, cam.zoom * Math.exp(e.deltaY * 0.0012))); cam.userUntil = performance.now() + 250; }, { passive: false });
  c.addEventListener('dblclick', () => { cam.zoom = 1; cam.az = 0.9; cam.el = 0.42; cam.boostUntil = performance.now() + 3000; });
}

// Overlay margins in CSS px (the wave-membrane rule): an overlay that spans
// half an edge or more covers that edge. The saver adds the plate band.
let band = null, bandAt = -1e9;
function occlusion(w, h) {
  const o = { l: 0, r: 0, t: 0, b: 0 };
  if (saverOn) {
    const now = performance.now();
    if (now - bandAt > 250) { bandAt = now; band = plateBand(h); }
    if (band) { let t = band.t, b = band.b; const k = (t + b) / (0.65 * h); if (k > 1) { t /= k; b /= k; } o.t = t; o.b = b; }
    return o;
  }
  for (const id of ['panel', 'dock', 'status', 'hud']) {
    const el = $(id); if (!el) continue;
    const q = el.getBoundingClientRect();
    const x0 = Math.max(0, q.left), x1 = Math.min(w, q.right), y0 = Math.max(0, q.top), y1 = Math.min(h, q.bottom);
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;
    const fw = (x1 - x0) / w, fh = (y1 - y0) / h;
    if (fw >= fh) { if (fw < 0.5) continue; if (y0 + y1 > h) o.b = Math.max(o.b, h - y0); else o.t = Math.max(o.t, y1); }
    else { if (fh < 0.5) continue; if (x0 + x1 < w) o.l = Math.max(o.l, x1); else o.r = Math.max(o.r, w - x0); }
  }
  return o;
}

function debugState() {
  if (!run) return null;
  return {
    phase: run.phase, scen: UI.scen, cam: Object.assign({}, camStats, { prev: undefined }), calm: UI.calm, warp: WARP[warpIndex()], t: run.t, T0: run.T0, orbits: run.t / run.T0, gpuMs, blocksMax, fps,
    sats: run.sats.filter(s => s.ref).map(s => ({ N: s.N, mat: s.matName, f: s.an && s.an.f, drift: s.an && s.an.drift, Ldrift: s.an && s.an.Ldrift, groups: s.an && s.an.groups, accreted: s.an && s.an.accreted, overflow: s.gpu.overflow, d: Math.hypot(...satState(s).r) / s.Rp })),
  };
}

// ── SCREENSAVER ───────────────────────────────────────────────────────────
// lib/screensaver.js has the protocol. enter() hides the panel (CSS under
// html.sn-saver), takes N = 8192 and plays a seeded shuffle of SHOTS.
// Calm shots (the user found the first version nauseating): every camera
// is an inertial planet or top view (no follow camera on a moving moon),
// the camera governor of the page moves it (ROT_MAX, LIN_MAX), a shot
// holds 14-30 s (longer when calm), each scenario shows two cameras and
// the change between them is a slow eased move, not a cut. A new scenario
// fades to black, settles and runs its warm-up in the dark at full warp,
// then fades in over 2 s at a low warp. The time warp after the warm-up is
// low, and lower again when calm or when the system asks for less motion.
// The subject is framed in the clear band of the plate (plateBand).
// warm: the sim time (in T0) to reach before the shot fades in (a
// function of the run for the flyby); warp: the warp index after that.
const SHOTS = [
  { scen: 'ring', title: 'A moon becomes a ring', warm: () => 8, warp: 6,
    cams: [{ mode: 'planet', zoom: 0.95, el: 0.1, az: 0.6, backlit: true }, { mode: 'top', zoom: 0.8, el: 1.25, az: 0.9 }] },
  { scen: 'moon', title: 'Inside the fluid limit', warm: () => 0.05, warp: 3,
    cams: [{ mode: 'planet', zoom: 0.62, el: 0.45, az: 0.9 }, { mode: 'planet', zoom: 0.72, el: 0.55, az: 0.55, field: 1 }] },
  { scen: 'flyby', title: 'A comet torn into a string of pearls', warm: r => r.tPeri !== undefined ? (r.tPeri / r.T0 - 0.8) : 0, warp: 2, until: r => r.tPeri / r.T0 + 6,
    cams: [{ mode: 'planet', zoom: 0.5, el: 0.6, az: 1.2 }, { mode: 'planet', zoom: 0.7, el: 1.0, az: 0.8 }] },
  { scen: 'compare', title: 'Fluid against rigid', warm: () => 0.3, warp: 3,
    cams: [{ mode: 'planet', zoom: 0.75, el: 0.62, az: 0.9 }, { mode: 'top', zoom: 0.85, el: 1.3, az: 0.9 }] },
  { scen: 'spiral', title: 'Crossing the limit', warm: () => 1.5, warp: 4,
    cams: [{ mode: 'planet', zoom: 0.7, el: 0.4, az: 0.9, color: 2 }, { mode: 'top', zoom: 0.85, el: 1.3, az: 0.9 }] },
];
let saver = null;
const WGSL_EXTRACT = `// shaders/sim.wgsl · cs_forces: one contact
let Fn = max(0.0, P.kn * (-gap) - P.gnK * sm * vn);
F = Fn * n;
var ft = -P.kt * sp - P.gtK * sm * vt;
let cap = P.mu * (Fn + coh);
if (length(ft) > cap) { ft = ft * (cap / length(ft)); }
// then the tide, relative to the frame point X
td = tide(S.X, xi0);`;
function saverCamera(g, dt) {
  const sh = saver.cur; if (!sh) return;
  const c = sh.cam;
  saver.az += dt * saver.spin;
  g.az = (c.az ?? 0.9) + saver.az;
  g.el = c.el ?? g.el;
  // a slow push-in of 8% over the hold
  g.dist = g.dist / (cam.zoom || 1) * c.zoom * (1 - 0.08 * Math.min(1, (performance.now() - saver.shotAt) / (saver.hold * 1000)));
}
function saverLabel() {
  if (!saver || !saver.opts.label || !run || run.phase !== 'orbit' || !run.sats[0].ref) return;
  const s = run.sats[0], L = run.limits || limitsFor(run.spec);
  const st = satState(s), dNow = Math.hypot(...st.r) / s.Rp;
  const bnd = run.sats.map(x => x.an ? (100 * x.an.f).toFixed(0) + '%' : '100%').join(' / ');
  saver.opts.label({
    title: 'Roche limit', sub: saver.cur ? saver.cur.shot.title : '',
    params: [
      { sym: 'd/R_p', name: 'distance', value: dNow.toFixed(2), cls: 'm5' },
      { sym: 'd_\\mathrm{rigid}', name: 'rigid limit', value: L.rigid.toFixed(2) + ' R_p', cls: 'm2' },
      { sym: 'd_\\mathrm{fluid}', name: 'fluid limit', value: L.fluid.toFixed(2) + ' R_p', cls: 'm1' },
      { sym: 'f_b', name: 'bound mass', value: bnd, cls: 'm3' },
    ],
    tex: ['d_\\mathrm{fluid} \\approx 2.44\\,R_p\\left(\\rho_p/\\rho_s\\right)^{1/3}'],
    rules: [['d_\\mathrm{fluid}', 'm1'], ['R_p', 'm5']],
    eq: ['d_fluid ≈ 2.44 R_p (ρ_p/ρ_s)^(1/3)'],
    lines: [`${s.N.toLocaleString()} grains · self-gravity, contacts, tide on the GPU`],
    code: { lang: 'wgsl', name: 'sim.wgsl · cs_forces', text: WGSL_EXTRACT },
    anchor: () => {
      const c = satCentre(s), cs = $('gpu');
      const q = ren.project(c, cs.clientWidth, cs.clientHeight);
      if (!q) return null;
      return { x: q.x, y: q.y, r: Math.max(8, (s.Rs || s.C.Rs) * s.k * ren.focal / q.w / (ren.H / cs.clientHeight)) };
    },
  });
}
// The next shot: a new scenario (fade out first) or the second camera of
// this one (an eased move).
function saverNext() {
  const sv = saver;
  if (sv.cur && sv.camsLeft > 0) {
    sv.cur.i++; sv.cur.cam = sv.cur.shot.cams[sv.cur.i]; sv.camsLeft--;
    saverApplyCam(); return;
  }
  sv.state = 'fadeout'; sv.fadeTarget = 0;
}
function saverApplyCam() {
  const sv = saver, c = sv.cur.cam;
  UI.cam = c.mode; UI.color = c.color || 0; UI.field = c.field || 0;
  sv.spin = (sv.rnd() < 0.5 ? -1 : 1) * (0.4 + 0.6 * sv.rnd()) * (1 - 0.6 * sv.calm) * Math.PI / 180;
  sv.backlit = !!c.backlit;
  sv.hold = 14 + 16 * sv.calm * (0.7 + 0.3 * sv.rnd());
  sv.shotAt = performance.now();
  saverLabel();
}
function saverScenario() {
  const sv = saver;
  if (!sv.queue.length) {
    // a new seeded shuffle of the scenarios, never the same twice in a row
    const order = SHOTS.slice();
    for (let j = order.length - 1; j > 0; j--) { const q = Math.floor(sv.rnd() * (j + 1)); [order[j], order[q]] = [order[q], order[j]]; }
    if (sv.last && order[0] === sv.last) order.push(order.shift());
    sv.queue = order;
  }
  const shot = sv.queue.shift(); sv.last = shot;
  sv.cur = { shot, i: 0, cam: shot.cams[0] }; sv.camsLeft = shot.cams.length - 1;
  UI.ringGain = 2; UI.rings = true; UI.pred = true; UI.hill = true; UI.track = false; UI.blur = false;
  applyScenario(shot.scen, true);
  UI.warp = WARP.length - 1;
  sv.longRing = shot.scen === 'ring';
  sv.state = 'warm'; sv.warmAt = performance.now();
  saverApplyCam();
  startRun();
}
// Called each frame by drawFrame: the fade, as an exposure factor.
function saverFade(dt) {
  const sv = saver; if (!sv) return 1;
  const rate = sv.fadeTarget > sv.fade ? 0.5 : 0.7;   // 2 s in, 1.4 s out
  sv.fade += Math.sign(sv.fadeTarget - sv.fade) * Math.min(Math.abs(sv.fadeTarget - sv.fade), rate * dt);
  return sv.fade;
}
window.snSaver = {
  async enter(opts) {
    saverOn = true;
    await bootReady;
    document.documentElement.classList.add('sn-saver');
    let seed = (opts.seed >>> 0) || 1;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const calm = Math.max(Math.min(1, Math.max(0, opts.calm ?? 0.7)), RM_Q.matches ? 1 : 0);
    saver = { opts, rnd, calm, queue: [], cur: null, camsLeft: 0, az: 0, spin: 0, hold: 20, shotAt: performance.now(), fade: 0, fadeTarget: 0, state: 'warm' };
    if (RM_Q.matches) UI.calm = true;
    resetCamStats();
    UI.N = Math.min(UI.N, 8192);
    if (run) run.saverN = 8192;
    resize();
    saverScenario();
    saver.tick = setInterval(() => {
      if (!saverOn) return;
      const sv = saver;
      if (sv.state === 'fadeout') { if (sv.fade <= 0.001) saverScenario(); return; }
      if (!run || run.phase !== 'orbit') return;
      if (sv.state === 'warm') {
        // the warm-up runs in the dark at full warp; then the view fades in
        // (at most 12 s of dark: a slow GPU fades in early)
        if (run.t / run.T0 < sv.cur.shot.warm(run) && performance.now() - sv.warmAt < 12000) { UI.warp = WARP.length - 1; sv.shotAt = performance.now(); return; }
        UI.warp = Math.max(1, sv.cur.shot.warp - (sv.calm > 0.85 ? 1 : 0));
        cam.pose = null; sv.az = 0;
        sv.state = 'show'; sv.fadeTarget = 1; sv.shotAt = performance.now();
      }
      const until = sv.cur.shot.until;
      if (until && run.t / run.T0 > until(run)) { sv.camsLeft = 0; saverNext(); return; }
      if ((performance.now() - sv.shotAt) / 1000 > sv.hold) saverNext();
      saverLabel();
    }, 500);
    return { canvas: $('gpu'), warmupMs: 2500 };
  },
  exit() {
    saverOn = false;
    if (saver) clearInterval(saver.tick);
    saver = null;
    document.documentElement.classList.remove('sn-saver');
    resize();
  },
  debug() { return saver ? { shot: saver.cur && saver.cur.shot.scen, cam: saver.cur && saver.cur.cam, hold: saver.hold, state: saver.state, fade: saver.fade, camStats: Object.assign({}, camStats, { prev: undefined }), state2: debugState() } : null; },
};

boot().catch(e => fail(e));
