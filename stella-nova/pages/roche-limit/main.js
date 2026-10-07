// ============================================================================
//  ROCHE LIMIT  ·  main.js — boot, runs, time, history, camera, story, UI
// ----------------------------------------------------------------------------
//  A RUN is one scenario with one or two moons. Each moon is a SimGPU
//  (engine.js). A run has two phases:
//    settle  a loose cloud (physics.js makeCloud, built in the worker) falls
//            together under its own gravity with a drag, far from any
//            planet (GM = 0). The settled pile is cached by N and material.
//    orbit   the pile goes onto its start orbit (placeOnOrbit, synchronous
//            spin), the planet is switched on, and the clock starts.
//
//  TIME. The speed is in orbits (of the start orbit) per minute of wall
//  time, on a log slider with three labelled stops (Slow 1.5, Normal 6,
//  Fast 24). Each frame runs the steps that the speed asks for, capped by
//  a GPU budget (queue.onSubmittedWorkDone). Pause (Space) stops the steps;
//  the camera, the drag and the drawing stay live. Step (. and ,) runs
//  1/100 or 1/10 of an orbit while paused.
//
//  HISTORY. About once a second all moons are read back; worker.js finds
//  the bound mass, its centre and the energy and tags each grain bound or
//  shed. Each readback also keeps a compact copy of the grains (position,
//  velocity, spin) in run.snaps, at most SNAP_CAP records; when full, the
//  record with the closest neighbours goes, so the records cover the whole
//  run. The scrubber and the phase strip restore a record onto the GPU
//  (function restoreSnap). Play after a scrub drops the later records.
//  The friction springs of the contacts are not in the record: they start
//  from zero after a restore.
//
//  STORY. Four phases (scenarios.js STORY): spiral in, cross the limit
//  (the distance drops under the fluid limit), torn apart (bound mass under
//  75%), a ring (0.75 orbit after the tear when under 25% is left, else
//  1.5 orbits after it). Each
//  phase has a one-line caption; the phase strip marks the phases reached
//  and seeks to them.
//
//  CAMERA. Planet-fixed and calm: the default view looks at the planet from
//  a fixed direction and distance (run.viewD) and never follows the moon.
//  A governor caps the turn of the view at ROT_MAX (4 deg/s, 2.5 with
//  Reduce motion; 6 deg/s for a button choice), with no roll (up is +z).
//  Follow is opt-in and falls back to the planet view when the moon goes
//  round faster than FOLLOW_MAX_DEG per real second.
//
//  grep -n targets
//    settings and state ..... "const UI"
//    start a run ............ "async function startRun"
//    settle ................. "function settleStep"
//    orbit start ............ "async function placeSats"
//    frame loop ............. "function frameBody"
//    speed .................. "function orbitsPerMin"
//    readback, history ...... "async function readAll", "function restoreSnap"
//    story phases ........... "function updatePhase"
//    camera ................. "function cameraFrame"
//    lines .................. "function buildSegments"
//    field overlay .......... "function fieldParams"
//    labels ................. "function placeLabels"
//    readouts ............... "function refreshReadout"
//    UI ..................... "function buildUI", "function applyScenario"
//    gallery art ............ "function cardArt"
//    legend ................. "function drawLegend"
//    framing (overlays) ..... "function occlusion"
//    profile ................ "async function profile"
//    screensaver ............ "SCREENSAVER"
// ============================================================================
import * as P from './physics.js';
import { SimGPU, loadSimCode } from './engine.js';
import { Renderer, loadRenderCode, norm, cross, sub } from './render.js';
import { SCENARIOS, REAL, STORY, SATURN_RINGS, specFor, flybyStart } from './scenarios.js';
import { drawGauge, drawBound, drawEnergy, drawRuns, MAT_COLOR } from './plots.js';
import { typesetAll } from '../../lib/sci-math.js';
import { plateBand } from '../../lib/saver-clear.js';

const $ = id => document.getElementById(id);
const PHONE_Q = window.matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const COARSE = window.matchMedia('(pointer:coarse)').matches;
const N_OPTS = [4096, 8192, 16384, 24576, 32768];
const G_SI = 6.674e-11;
const RUNS_KEY = 'roche-limit-runs-v1';
const SPEED_STOPS = [{ name: 'Slow', v: 0.18 }, { name: 'Normal', v: 0.78 }, { name: 'Fast', v: 1.38 }];   // log10 orbits/min
const SPEED_MIN = -1.3, SPEED_MAX = 2, CALM_SPEED = 0.78;
const SNAP_CAP = 60;
const KM_SATURN = 60268;

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

// Quality presets. Auto starts at Medium (Low on a phone) and the governor
// (function governQuality) lowers the render scale, then the bloom, then
// the steps per frame when frames run long, and raises them back when
// there is room. The grain count changes only between runs.
const QUALITY = {
  high:   { N: 16384, maxPx: 3.6e6, bloom: true, gridN: 1024 },
  medium: { N: 8192,  maxPx: 1.8e6, bloom: true, gridN: 512 },
  low:    { N: 4096,  maxPx: 0.9e6, bloom: false, gridN: 512 },
};
const Q = { preset: (PHONE_Q.matches || COARSE) ? 'low' : 'medium', scale: 1, bloom: true, win: { n: 0, t0: 0, slow: 0, good: 0 }, cool: 0, note: '' };
Q.bloom = QUALITY[Q.preset].bloom;

const UI = {
  scen: 'saturn', body: 'phobos',
  d: 2.7, peri: 1.6, e: 1, qLog: 0, J2: 0,
  material: 'fluid', mu: 0, coh: 0,
  N: (PHONE_Q.matches || COARSE) ? 4096 : 8192,
  quality: 'auto', showFps: false,
  speedLog: 0.78, paused: false,
  cam: 'planet', color: 4, field: 0,
  rings: true, real: true, hill: false, pred: true, track: true, ringOn: true, blur: false, ringGain: 2,
  calm: window.matchMedia('(prefers-reduced-motion: reduce)').matches,   // Reduce motion
};

let dev = null, ctx = null, ren = null, simCode = null, worker = null;
let run = null;            // the current run
let runSerial = 0;
const pileCache = new Map();
let gpuMs = 0, gpuPending = false, stepsMax = 128, warpCarry = 0;
let lastT = performance.now(), fps = 60;
let saverOn = false;
let profiling = false;
let bootDone; const bootReady = new Promise(r => { bootDone = r; });
const workerJobs = new Map(); let jobId = 0;

// ── boot (called at the end of the module, after every const is set) ─────
async function boot() {
  buildUI();
  typesetAll(document).catch(() => {});
  if (!navigator.gpu) return fail(new Error('navigator.gpu is missing'));
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return fail(new Error('no GPU adapter'));
  // timestamp-query, when the adapter has it, is only used by profile()
  dev = await adapter.requestDevice({ requiredFeatures: adapter.features.has('timestamp-query') ? ['timestamp-query'] : [] });
  dev.lost.then(i => { if (i.reason !== 'destroyed') fail(new Error('GPU device lost: ' + i.message)); });
  dev.addEventListener('uncapturederror', e => { console.error('WebGPU:', e.error.message); });
  const canvas = $('gpu');
  ctx = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device: dev, format, alphaMode: 'opaque' });
  const [sc, rc] = await Promise.all([loadSimCode(), loadRenderCode()]);
  simCode = sc;
  ren = new Renderer(dev, ctx, format, rc, { gridN: QUALITY[Q.preset].gridN });
  loadPlanetMap().catch(e => console.warn('planet map:', e.message));
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = e => { const j = workerJobs.get(e.data.id); workerJobs.delete(e.data.id); if (j) j(e.data); };
  worker.onerror = e => console.error('worker:', e.message);
  resize(); window.addEventListener('resize', resize);
  window.__roche = { state: () => debugState(), ren, cam, UI, camStats, resetCamStats, profile, restoreSnap, get run() { return run; }, fps: () => fps, gpuMs: () => gpuMs, cpuMs: () => cpuMs };
  requestAnimationFrame(frame);
  bootDone();
  if (!saverOn) await startRun();
}
// The Saturn map (tex/saturn_2k.jpg, Solar System Scope, CC BY 4.0) and
// its mip levels, made here by halving down to 16 px wide. Until it is in,
// style 5 draws the procedural Saturn (style 1).
async function loadPlanetMap() {
  const r = await fetch(new URL('./tex/saturn_2k.jpg', import.meta.url));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const b0 = await createImageBitmap(await r.blob());
  const levels = [b0];
  let w = b0.width, h = b0.height;
  while (w > 16) { w >>= 1; h = Math.max(1, h >> 1); levels.push(await createImageBitmap(b0, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' })); }
  if (ren) ren.setPlanetTexture(levels);
  for (const b of levels) b.close();
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
  const maxPx = QUALITY[Q.preset].maxPx * Q.scale * Q.scale, k = Math.min(1, Math.sqrt(maxPx / (w * h)));
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
  // Auto quality: when the governor has already gone down to its floor
  // (60% render scale, no bloom), the next run takes half the grains
  if (UI.quality === 'auto' && Q.scale <= 0.65 && !Q.bloom && UI.N > 4096) { UI.N = UI.N / 2; $('nSel').value = UI.N; Q.note = 'fewer grains for speed'; }
  let N = UI.N;
  if (sc && sc.nScale) N = Math.max(4096, Math.round(N * sc.nScale / 1024) * 1024);
  if (saverOn) N = Math.min(N, 8192);
  const nEach = two ? Math.max(4096, N / 2) : N;
  const mats = two ? spec.materials : [spec.material];
  run = { serial, spec, sats: [], phase: 'init', t: 0, T0: 1, frames: 0, started: performance.now(), recorded: false, track: [],
    snaps: [], viewIdx: -1, epoch: 0, stepLeft: 0, rate: 0, story: { approach: 0 }, storyKey: 'approach' };
  for (let k = 0; k < mats.length; k++) {
    const mat = matFor(mats[k], spec, !two);
    const C = P.contactParams(nEach, mat);
    const gpu = new SimGPU(dev, nEach, simCode);
    const e = ren.addSim(gpu);
    run.sats.push({ idx: k, matName: mats[k], mat, C, gpu, e, N: nEach, color: MAT_COLOR[mats[k]] || '#d8dfe8', hist: [], ehist: [], an: null, E0: null, L0: null, frag: [], phase: two ? k * Math.PI : 0 });
  }
  setBusy(true, 'Building the moon', 0);
  syncStory(true);
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
  for (const s of run.sats) { s.Rp = s.C.Rs / spec.s; s.k = 1 / s.Rp; }
  // settle each moon that has no cached pile
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
  run.limits = limitsFor(spec);
  run.viewD = viewDistance(spec, run.limits);
  if (run.sats.every(s => s.pile)) await placeSats(serial);
  else if (serial === runSerial) run.phase = 'settle';
}
// The distance (planet radii) the planet view frames: the start orbit or
// the closest pass, and the rings of Saturn, fixed for the whole run so
// the view never zooms on its own.
function viewDistance(spec, L) {
  if (spec.kind === 'flyby') return Math.max(spec.peri + 1.3, 2.4);
  return Math.min(7, Math.max(spec.d || 2, spec.rings ? 2.3 : 0, 1.6));
}
// Planet and start orbit for each moon (from the spec; the pile stats
// replace the expected density once the pile is settled).
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
  if (spec.kind === 'flyby') return P.orbitStart(pl, { kind: 'flyby', peri: spec.peri, e: spec.e, r0: flybyStart(spec) });
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
  setBusy(true, 'Letting the rubble settle under its own gravity', total ? done / total : 1);
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
    s.e.fresh = true;
    s.hist = [[0, 1]]; s.ehist = []; s.an = null; s.E0 = null; s.L0 = null; s.frag = [];
  }
  const s0 = run.sats[0], spec = run.spec;
  // the time unit: one orbit (circular, spiral: the start orbit) or the
  // period of a circular orbit at the pericentre (flyby)
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
  run.heatRef = 0.006 * s0.C.vesc * s0.C.vesc;
  run.phase = 'orbit'; run.t = 0; run.recorded = false; run.track = [];
  run.lastRead = 0;
  setBusy(false);
  syncStory();
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
let cpuMs = 0;   // main-thread time of one frame (ms, smoothed)
function frame(now) {
  requestAnimationFrame(frame);
  const tCpu = performance.now();
  try { frameBody(now); } finally { cpuMs = 0.9 * cpuMs + 0.1 * (performance.now() - tCpu); }
}
// The speed in orbits per minute of wall time. Reduce motion caps it at
// Normal; the screensaver sets its own.
function orbitsPerMin() {
  if (saverOn && saver) return saver.speed;
  return Math.pow(10, UI.calm ? Math.min(UI.speedLog, CALM_SPEED) : UI.speedLog);
}
function allFree() { return run.sats.every(s => !s.gpu.busy && !s.waiting); }
function frameBody(now) {
  const dtReal = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  fps = 0.95 * fps + 0.05 / Math.max(dtReal, 1e-3);
  if (!run || !ren || run.phase === 'init' || run.phase === 'placing' || profiling) return;
  const cssW = $('gpu').clientWidth, cssH = $('gpu').clientHeight;
  if (cssW < 2 || cssH < 2) return;
  let steps = 0;
  if (run.phase === 'settle') {
    if (settleStep(Math.max(2, Math.min(saverOn ? 24 : 12, Math.floor(stepsMax / 32))))) { run.phase = 'placing'; placeSats(run.serial); }
  } else if (run.phase === 'orbit') {
    if (run.pendingRestore !== undefined && run.pendingRestore !== null && allFree()) { const i = run.pendingRestore; run.pendingRestore = null; restoreSnap(i); }
    const s0 = run.sats[0];
    // the spiral ends at d1: the drag stops there
    if (run.spec.kind === 'spiral') for (const s of run.sats) if (s.pl.drag > 0 && Math.hypot(...s.ref.X) < run.spec.d1 * s.Rp) { s.pl.drag = 0; s.gpu.setParams(s.C, s.pl, 0); }
    const playing = !UI.paused && !run.scrubbing;
    if (playing) {
      // steps this frame: the speed in steps, carried over frames, capped
      // by the GPU budget; part blocks are fine (engine.js encodeSteps)
      const want = orbitsPerMin() / 60 * run.T0 / s0.C.dt * dtReal;
      warpCarry += want;
      steps = Math.min(Math.floor(warpCarry), stepsMax);
      warpCarry = Math.min(warpCarry - steps, 1);
      run.rate = 0.9 * run.rate + 0.1 * (steps / Math.max(dtReal, 1e-3));
    } else if (run.stepLeft > 0) {
      steps = Math.min(run.stepLeft, stepsMax);
      run.stepLeft -= steps;
      if (run.stepLeft <= 0) run.forceRead = true;
    }
    // a readback once a second while it plays; the O(N^2) potential
    // (energy) every second one
    const due = allFree() && (playing ? now - (run.lastRead || 0) > 1000 : (run.forceRead || now - (run.lastRead || 0) > 2000));
    if (steps > 0) {
      const enc = dev.createCommandEncoder();
      for (const s of run.sats) s.gpu.encodeSteps(enc, steps, due);
      dev.queue.submit([enc.finish()]);
      run.t = s0.gpu.t;
    }
    if (due && !run.scrubbing) { run.lastRead = now; run.forceRead = false; run.reads = (run.reads || 0) + 1; readAll(!playing || run.reads % 2 === 1); }
  }
  // GPU time of the whole frame (sim + draw)
  const tSub = performance.now();
  drawFrame(now, cssW, cssH, steps);
  if (!gpuPending) {
    gpuPending = true;
    dev.queue.onSubmittedWorkDone().then(() => {
      const ms = performance.now() - tSub;
      gpuMs = 0.8 * gpuMs + 0.2 * ms; gpuPending = false;
      const target = Math.max(8, Math.ceil(stepsWanted() * 1.25));
      if (gpuMs > 14 && stepsMax > 8) stepsMax = Math.max(8, Math.floor(stepsMax * 0.8));
      else if (gpuMs < 9 && stepsMax < target) stepsMax += 8;
      else if (stepsMax > target) stepsMax = target;
    });
  }
  governQuality(now);
  run.frames++;
  if (run.frames % 10 === 0) refreshReadout(false);
  if (UI.showFps && run.frames % 20 === 0) $('fpsChip').textContent = `${fps.toFixed(0)} fps · GPU ${gpuMs.toFixed(1)} ms · CPU ${cpuMs.toFixed(1)} ms · ${(ren.W * ren.H / 1e6).toFixed(1)} MP · ${Q.preset}${Q.bloom ? '' : ', no bloom'} · ${stepsMax} steps max`;
}
// steps per frame the speed asks for, at 60 fps
function stepsWanted() {
  if (!run || !run.sats.length || !run.T0) return 64;
  return orbitsPerMin() / 60 * run.T0 / run.sats[0].C.dt / 60;
}
// The Auto quality governor, once a second: frames that run long (under
// 52 fps, or a GPU frame over 15 ms) lower the render scale by 10% (down
// to 60%), then switch off the bloom, then halve the steps per frame.
// Three good seconds (59 fps, GPU under 9 ms) step back up. A change waits
// 2 s for the next one.
function governQuality(now) {
  const w = Q.win;
  if (!w.t0) { w.t0 = now; w.n = 0; }
  w.n++;
  if (now - w.t0 < 1000) return;
  const f = w.n * 1000 / (now - w.t0); w.t0 = now; w.n = 0;
  if (UI.quality !== 'auto' || now < Q.cool || saverOn && saver && saver.fade < 0.5) return;
  const slow = f < 52 || gpuMs > 15, good = f >= 59 && gpuMs < 9;
  w.good = good ? w.good + 1 : 0;
  if (slow) {
    if (Q.scale > 0.65) { Q.scale = Math.round((Q.scale - 0.1) * 10) / 10; resize(); }
    else if (Q.bloom) Q.bloom = false;
    else stepsMax = Math.max(8, stepsMax >> 1);
    Q.cool = now + 2000; Q.slowRuns = (Q.slowRuns || 0) + 1;
  } else if (w.good >= 3) {
    if (!Q.bloom && QUALITY[Q.preset].bloom) Q.bloom = true;
    else if (Q.scale < 1) { Q.scale = Math.min(1, Math.round((Q.scale + 0.1) * 10) / 10); resize(); }
    w.good = 0; Q.cool = now + 2000;
  }
}
// A quality preset: grain count (for the next run), pixel budget, bloom.
function setQuality(name) {
  UI.quality = name;
  Q.preset = name === 'auto' ? ((PHONE_Q.matches || COARSE) ? 'low' : 'medium') : name;
  const P0 = QUALITY[Q.preset];
  Q.scale = 1; Q.bloom = P0.bloom; UI.N = P0.N; $('nSel').value = UI.N;
  resize();
}

// ── readback, analysis, history ───────────────────────────────────────────
// Read every moon, analyse, then keep one history record for the read.
async function readAll(potential) {
  const serial = run.serial, epoch = run.epoch;
  const parts = await Promise.all(run.sats.map(s => readAndAnalyze(s, potential, epoch)));
  if (serial !== runSerial || epoch !== run.epoch || parts.some(p => !p)) return;
  updatePhase(parts[0].t);
  const t = parts[0].t, last = run.snaps[run.snaps.length - 1];
  if (last && t <= last.t + 1e-9) return;
  run.snaps.push({ t, sats: parts, story: Object.assign({}, run.story) });
  if (run.snaps.length > SNAP_CAP) {
    // drop the record whose neighbours are closest in time
    let best = 1, gap = Infinity;
    for (let i = 1; i < run.snaps.length - 1; i++) { const g = run.snaps[i + 1].t - run.snaps[i - 1].t; if (g < gap) { gap = g; best = i; } }
    run.snaps.splice(best, 1);
  }
  run.viewIdx = run.snaps.length - 1;
  syncScrub();
}
async function readAndAnalyze(s, potential, epoch) {
  const serial = run.serial;
  s.waiting = true;
  const rb = await s.gpu.readback(potential);
  if (!rb) { s.waiting = false; return null; }
  if (serial !== runSerial) return null;
  // the compact copy for the history: position, velocity, spin
  const N = s.N, st = new Float32Array(N * 9), b = rb.body;
  for (let i = 0; i < N; i++) {
    const o = 12 * i, q = 9 * i;
    st[q] = b[o]; st[q + 1] = b[o + 1]; st[q + 2] = b[o + 2];
    st[q + 3] = b[o + 4]; st[q + 4] = b[o + 5]; st[q + 5] = b[o + 6];
    st[q + 6] = b[o + 8]; st[q + 7] = b[o + 9]; st[q + 8] = b[o + 10];
  }
  const res = await workerCall({ type: 'analyze', N: s.N, np: s.gpu.np, body: rb.body, grav: rb.grav, rad: s.rad, X: rb.X, V: rb.V, GMp: s.pl.GM, t: rb.t, fragCount: 24, seed: run.frames }, [rb.body.buffer, rb.grav.buffer]);
  s.waiting = false;
  if (serial !== runSerial || epoch !== run.epoch) return null;
  onAnalysis(s, res, rb);
  return { t: rb.t, X: rb.X, V: rb.V, W: rb.W, Llost: rb.Llost, drag: s.pl.drag, st, tags: res.tags, an: s.an, E0: s.E0, Us0: s.Us0, L0: s.L0 };
}
function onAnalysis(s, a, rb) {
  ren.setTags(s.e, a.tags);
  const T0 = run.T0, tt = a.t / T0;
  const f = a.M / s.M0;
  // energy ledger: E - W, relative to |U_self| at the start; only from a
  // readback with a fresh potential
  const prevDrift = s.an ? s.an.drift : NaN;
  let drift = prevDrift;
  if (rb.fresh) {
    const ledger = a.E - rb.W;
    if (s.E0 === null) { s.E0 = ledger; s.Us0 = Math.abs(a.Us); }
    drift = Math.abs(ledger - s.E0) / s.Us0;
  }
  if (s.L0 === null || s.L0 === undefined) s.L0 = a.L[2];
  const Ldrift = (a.L[2] + rb.Llost[2] - s.L0) / Math.abs(s.L0);
  // once the bound mass is small, the field and the labels use the frame
  // point (the start orbit of the moon) instead of the remnant
  const live = f > 0.2 && a.M > 0;
  s.an = { f, live, com: live ? a.com : [0, 0, 0], vcm: live ? a.vcm : [0, 0, 0], rH: live ? a.rH : NaN, comAll: a.comAll, vcmAll: a.vcmAll, spread: a.spread, groups: a.groups, M: a.M, X: a.X, V: a.V, t: a.t, drift, Ldrift, accreted: a.accreted, wall: performance.now() };
  // the ledger E - W holds only without the drag: it starts again when
  // the drag stops
  if (s.pl.drag > 0) { s.an.drift = NaN; s.E0 = null; }
  if (!s.hist.length || tt > s.hist[s.hist.length - 1][0]) { s.hist.push([tt, f]); if (s.hist.length > 2000) s.hist.splice(0, s.hist.length - 2000); }
  if (rb.fresh && Number.isFinite(s.an.drift)) { s.ehist.push([tt, Math.max(drift, 1e-12)]); if (s.ehist.length > 2000) s.ehist.splice(0, 1); }
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
    addRunPoint({ x: run.spec.d / Math.cbrt(run.spec.q), y: f, mat: s.matName });
  }
}
function addRunPoint(p) {
  const list = loadRuns(); list.push(p); while (list.length > 60) list.shift();
  try { localStorage.setItem(RUNS_KEY, JSON.stringify(list)); } catch (e) {}
}
function loadRuns() { try { return JSON.parse(localStorage.getItem(RUNS_KEY) || '[]'); } catch (e) { return []; } }

// Put history record i back onto the GPU: the grains, the frame point, the
// drag, the tags and the analysis. The run stays paused on it.
function restoreSnap(i) {
  if (!run || run.phase !== 'orbit' || !run.snaps.length) return;
  i = Math.max(0, Math.min(run.snaps.length - 1, i | 0));
  if (!allFree()) { run.pendingRestore = i; return; }
  const rec = run.snaps[i];
  run.epoch++;
  run.sats.forEach((s, k) => {
    const sn = rec.sats[k], N = s.N;
    const pos = new Float64Array(N * 3), vel = new Float64Array(N * 3), spin = new Float64Array(N * 3);
    for (let j = 0; j < N; j++) for (let c = 0; c < 3; c++) { pos[3 * j + c] = sn.st[9 * j + c]; vel[3 * j + c] = sn.st[9 * j + 3 + c]; spin[3 * j + c] = sn.st[9 * j + 6 + c]; }
    s.ref.X = sn.X.slice(); s.ref.V = sn.V.slice(); s.ref.t = sn.t;
    s.pl.drag = sn.drag;
    s.gpu.setParams(s.C, s.pl, 0);
    s.gpu.setState(pos, vel, spin, s.rad, s.mass);
    s.gpu.t = sn.t; s.gpu.W = sn.W; s.gpu.Llost = sn.Llost.slice();
    s.gpu.prime();
    ren.setTags(s.e, sn.tags); s.e.fresh = true;
    s.an = sn.an; s.E0 = sn.E0; s.Us0 = sn.Us0; s.L0 = sn.L0;
  });
  run.t = rec.t; run.viewIdx = i; run.track = []; warpCarry = 0; run.stepLeft = 0;
  run.story = Object.assign({}, rec.story);
  run.storyKey = storyKeyAt(run.story);
  syncScrub(); syncStory(); refreshReadout(true);
}
// Play or step after a scrub: the records after the current one, and the
// plot points after its time, are gone.
function truncateHistory() {
  if (!run || run.viewIdx < 0 || run.viewIdx >= run.snaps.length - 1) return;
  run.snaps.length = run.viewIdx + 1;
  const tt = run.t / run.T0;
  for (const s of run.sats) { s.hist = s.hist.filter(p => p[0] <= tt + 1e-9); s.ehist = s.ehist.filter(p => p[0] <= tt + 1e-9); }
  syncScrub();
}

// ── story phases ──────────────────────────────────────────────────────────
// Called after each read of all moons (sat 0 decides). Times are in sim
// time; run.story holds the start time of each phase reached.
function updatePhase(t) {
  const s = run.sats[0], st = run.story, L = run.limits;
  if (!s.an) return;
  const d = Math.hypot(...satState(s).r) / s.Rp;
  if (st.cross === undefined && (d < L.fluid)) st.cross = t;
  if (st.cross !== undefined && st.torn === undefined && s.an.f < 0.75) st.torn = t;
  if (st.torn !== undefined && st.ring === undefined && t - st.torn > (s.an.f < 0.25 ? 0.75 : 1.5) * run.T0) st.ring = t;
  const k = storyKeyAt(st);
  if (k !== run.storyKey) { run.storyKey = k; syncStory(); }
}
function storyKeyAt(st) { return st.ring !== undefined ? 'ring' : st.torn !== undefined ? 'torn' : st.cross !== undefined ? 'cross' : 'approach'; }
function storyText(key) {
  const spec = run.spec, Pn = spec.planetName || 'the planet';
  const subj = spec.kind === 'flyby' ? 'comet' : 'moon';
  let tx = STORY.find(x => x.key === key).text;
  if (key === 'approach') {
    if (spec.kind === 'flyby') tx = 'A loose comet falls toward {P}.';
    else if (spec.kind === 'compare') tx = 'Two moons circle {P}: one loose, one rough.';
    else if (spec.kind !== 'spiral') tx = `The ${subj} circles {P}, outside its Roche limit: the tide only stretches it a little.`;
    else if (spec.key !== 'saturn') tx = 'A moon spirals toward {P}, pulled in by a drag.';
  } else if (key === 'cross' && spec.kind !== 'spiral' && run.story.cross < 0.05 * run.T0) tx = `The ${subj} starts inside the Roche limit: {P}’s tide beats its own gravity.`;
  else if (key === 'torn' && spec.kind === 'flyby') tx = 'The comet is pulled into a long stream of rubble.';
  else if (key === 'ring' && spec.kind === 'flyby') tx = 'The stream’s own gravity gathers it into a chain of clumps.';
  else if (key === 'ring' && spec.key !== 'saturn') tx = 'The debris spreads into a ring around {P}.';
  tx = tx.split('{P}').join(Pn);
  return tx.charAt(0).toUpperCase() + tx.slice(1);
}
function syncStory(reset) {
  const box = $('phases');
  if (reset || !box.children.length) {
    box.innerHTML = '';
    for (const p of STORY) {
      const b = document.createElement('button');
      b.dataset.p = p.key; b.innerHTML = `<i></i><span>${p.short}</span>`;
      b.addEventListener('click', () => seekPhase(p.key));
      box.appendChild(b);
    }
  }
  if (!run) return;
  const order = STORY.map(x => x.key), cur = order.indexOf(run.storyKey);
  for (const b of box.children) {
    const i = order.indexOf(b.dataset.p), reached = run.story[b.dataset.p] !== undefined || i === 0;
    b.classList.toggle('now', i === cur); b.classList.toggle('done', i < cur); b.disabled = !reached;
    b.title = reached ? 'Go back to: ' + b.textContent : 'Not reached yet';
  }
  $('caption').textContent = run.phase === 'orbit' || run.phase === 'placing' ? storyText(run.storyKey) : 'Building the moon from thousands of grains…';
}
// Jump to the first record at or after the start of a phase.
function seekPhase(key) {
  if (!run || run.phase !== 'orbit') return;
  const t0 = run.story[key] ?? (key === 'approach' ? 0 : undefined);
  if (t0 === undefined || !run.snaps.length) return;
  let i = run.snaps.findIndex(r => r.t >= t0 - 1e-9);
  if (i < 0) i = run.snaps.length - 1;
  setPaused(true);
  restoreSnap(i);
}

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
// The user found the first version nauseating and asked for the planet to
// stay still while the moon goes round. Now:
//   - the default is the planet view: the planet at the centre, a fixed
//     direction and a fixed distance for the run (run.viewD); the camera
//     never follows the moon unless the user picks Follow
//   - every view is inertial (az and el fixed in space) with +z up: no roll
//   - a governor moves the camera: an ease toward the goal with a speed
//     limit and an acceleration limit, for the turn of the view, for the
//     target (as a fraction of the distance) and for the zoom. A drag or a
//     pinch moves it at once; a button choice gets at most 6 deg/s; all
//     else stays under ROT_MAX
//   - camStats keeps the largest view rotation (deg/s, deg/frame) and the
//     largest shift of the planet centre on screen (deg/frame), user moves
//     not counted
const RM_Q = window.matchMedia('(prefers-reduced-motion: reduce)');
const FOLLOW_MAX_DEG = 8;        // deg/s of the moon about the planet, real time
const ROT_MAX = { calm: 2.5, normal: 4 };        // deg/s, view turn
const ROT_BOOST = 6;                              // deg/s, after a button choice
const LIN_MAX = { calm: 0.025, normal: 0.035 };  // target speed / distance, 1/s
const ZOOM_MAX = { calm: 0.08, normal: 0.12 };   // d(ln dist)/dt, 1/s
const cam = { az: 0.9, el: 0.22, zoom: 1, pose: null, user: false, dragging: false, boostUntil: 0, vr: 0, vl: 0, vz: 0, fastFollow: false };
const camStats = { rotDegS: 0, rotDegFrame: 0, planetDegFrame: 0, planetDegS: 0, frames: 0, userFrames: 0, prev: null };
function resetCamStats() { Object.assign(camStats, { rotDegS: 0, rotDegFrame: 0, planetDegFrame: 0, planetDegS: 0, frames: 0, userFrames: 0, prev: null }); }
// sim time per real second at the current speed
function simRate() { return UI.paused ? 0 : orbitsPerMin() / 60 * run.T0; }
function camGoal(cssW, cssH) {
  const s = run.sats[0];
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
  const vd = run.viewD || 2.5;
  if (mode === 'follow') {
    target = satCentre(s);
    dist = 9 * Rw;
    if (run.spec.kind === 'flyby' && s.an && s.an.comAll) {
      const dt = s.gpu.t - s.an.t;
      if (!s.an.live) target = [0, 1, 2].map(i => (s.ref.X[i] + s.an.comAll[i] + s.an.vcmAll[i] * dt) * s.k);
      dist = Math.min(Math.max(dist, 1.2 * s.an.spread * s.k), 30 * Rw);
    }
  } else if (mode === 'planet') {
    target = [0, 0, 0]; dist = 2.35 * vd;
  } else {
    target = [0, 0, 0]; dist = 2.6 * vd; el = 1.42;
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
  const rotMax = (user ? 720 : boost && !UI.calm ? ROT_BOOST : ROT_MAX[calm]) * Math.PI / 180;
  const linMax = user ? 50 : boost ? 0.2 : LIN_MAX[calm];
  const zoomMax = user ? 50 : boost ? 0.3 : ZOOM_MAX[calm];
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
  return finishPose(dtReal, false, user);
}
// The frame for the renderer, and the motion statistics. Only user moves
// (drag, pinch, wheel) are exempt from camStats; the 6 deg/s button boost
// is counted.
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
// The Roche limit (fluid) bright, the solid-moon limit faint, the path
// ahead, the past track, the drag arrow on the moon while the drag is on,
// and (paused only) short paths of shed grains.
function buildSegments(dpr) {
  segN = 0;
  const s0 = run.sats[0], L = run.limits || limitsFor(run.spec);
  const W = 1.6 * dpr;
  if (UI.rings) {
    circle([0, 0, 0], L.fluid, hex('#ff7a59', 0.8), W, 0, 256);
    circle([0, 0, 0], L.rigid, hex('#9aa6b8', 0.35), W * 0.7, 1);
  }
  if (run.phase !== 'orbit') return;
  for (const s of run.sats) {
    const c = satCentre(s);
    if (UI.hill && s.an && s.an.live && Number.isFinite(s.an.rH)) circle(c, s.an.rH * s.k, [1, 1, 1, 0.45], W * 0.8, 1, 96);
    if (UI.pred && (!s.an || s.an.live)) {
      const st = satState(s);
      const T = run.spec.kind === 'flyby' ? 2.5 * run.T0 : 0.6 * run.T0;
      const pts = P.keplerPath(st.r, st.v, s.pl.GM, T, 120).pts;
      for (let i = 0; i < 119; i++) {
        const a0 = 0.55 * (1 - i / 119), a1 = 0.55 * (1 - (i + 1) / 119);
        seg([pts[3 * i] * s.k, pts[3 * i + 1] * s.k, pts[3 * i + 2] * s.k], [pts[3 * i + 3] * s.k, pts[3 * i + 4] * s.k, pts[3 * i + 5] * s.k], [1, 0.95, 0.85, a0], [1, 0.95, 0.85, a1], W * 0.8);
      }
    }
    if (UI.pred && UI.paused && !saverOn) {
      for (const fp of s.frag) {
        for (let i = 0; i < 23; i++) {
          const a0 = 0.32 * (1 - i / 23), a1 = 0.32 * (1 - (i + 1) / 23);
          seg([fp[3 * i] * s.k, fp[3 * i + 1] * s.k, fp[3 * i + 2] * s.k], [fp[3 * i + 3] * s.k, fp[3 * i + 4] * s.k, fp[3 * i + 5] * s.k], [0.55, 0.85, 1, a0], [0.55, 0.85, 1, a1], W * 0.55);
        }
      }
    }
    // the drag: an arrow against the motion, from the moon's edge
    if (s.pl.drag > 0 && (!s.an || s.an.live)) {
      const st = satState(s), v = norm(st.v), Rw = (s.Rs || s.C.Rs) * s.k;
      const a = [0, 1, 2].map(i => c[i] - v[i] * 1.3 * Rw), b = [0, 1, 2].map(i => c[i] - v[i] * (1.3 * Rw + 0.32));
      const col = [1, 0.62, 0.3, 0.85];
      seg(a, b, col, col, W * 1.1);
      const sd = norm(cross(v, [0, 0, 1]));
      for (const sg of [1, -1]) seg(b, [0, 1, 2].map(i => b[i] + v[i] * 0.07 + sd[i] * sg * 0.045), col, col, W * 1.1);
    }
  }
  if (UI.track && run.track.length > 1) {
    const tr = run.track, n = tr.length;
    for (let i = 1; i < n; i++) { const a = 0.45 * i / n; seg(tr[i - 1], tr[i], [1, 0.75, 0.35, a * 0.9], [1, 0.75, 0.35, a], W * 0.8); }
    if (s0.an && s0.an.live) seg(tr[n - 1], satCentre(s0), [1, 0.75, 0.35, 0.45], [1, 0.75, 0.35, 0.45], W * 0.8);
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
  // L1: the highest Phi on the line from the planet to the moon
  const dc = Math.hypot(...c), u = c.map(q => q / dc);
  let best = -Infinity, bx = 0;
  for (let i = 0; i <= 400; i++) { const x = dc * (0.55 + 0.45 * i / 400) - satR * 0.2; const v = phi(u.map(q => q * x)); if (x < dc - satR && v > best) { best = v; bx = x; } }
  // colour scale: the depth of the moon's lobe below L1
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
function drawFrame(now, cssW, cssH, steps) {
  const dtReal = Math.min(0.1, (now - (run.lastDraw || now)) / 1000); run.lastDraw = now;
  const cf = cameraFrame(dtReal || 0.016, cssW, cssH);
  const dpr = ren.W / cssW;
  const spec = run.spec;
  const fp = run.phase === 'orbit' ? smoothField(fieldParams(), dtReal) : null;
  const s0 = run.sats[0];
  const style = spec.style === 5 && !ren.planetTexW ? 1 : (spec.style ?? 0);
  const frameT = steps > 0 ? steps * s0.C.dt : 0;
  const frame = {
    eye: cf.eye, target: cf.target, fov: cf.fov, near: cf.near, time: now / 1000,
    sun: saverOn && saver && saver.backlit ? backlitSun(cf) : SUN, sunI: 1.45,
    atm: spec.style === 3 ? 0.035 : 0.05, spin: now / 1000 * 0.02, style, shine: 0.25,
    flattening: spec.flattening || 0, realRings: UI.real && spec.rings ? 1 : 0,
    sat: fp ? fp.c : satCentre(s0), satR: fp ? fp.satR : (s0.C.Rs * s0.k),
    GMs: fp ? fp.GMs : 0, GMp: fp ? fp.GMp : 0, omega: fp ? fp.omega : 0, phiL1: fp ? fp.phiL1 : 0,
    fieldMode: fp ? UI.field : 0, fieldExt: fp ? fp.ext : 4, fieldScale: fp ? fp.scale : 1, fieldAlpha: 0.62,
    ringExt: 3.6, ringGain: UI.ringOn ? UI.ringGain : 0, ringBlend: steps > 0 ? (UI.calm ? 0.94 : Math.min(0.92, 0.6 + 0.08 * steps / 32)) : 0.97, ringOn: UI.ringOn || frameRealRings(spec),
    exposure: 0.88 * (saverOn ? saverFade(dtReal) : 1), bloom: Q.bloom ? 0.08 : 0, bloomThreshold: 1.0, vignette: 0.32,
    grainR: s0.k,   // the mean grain radius (1) in world units
  };
  // the past track of the bound centre: one point per 0.01 R_p of travel
  if (run.phase === 'orbit' && s0.an && s0.an.live) {
    const c = satCentre(s0), tr = run.track, l = tr[tr.length - 1];
    if (!l || Math.hypot(c[0] - l[0], c[1] - l[1], c[2] - l[2]) > 0.01) { tr.push(c); if (tr.length > 600) tr.shift(); }
  }
  buildSegments(dpr);
  ren.setSegments(segs, segN);
  // the grains' screen motion (streaks if on, and the dimming of grains
  // that jump more than a few px), and the decay of the collision heat
  // (time constant 1/20 orbit; frozen while paused)
  const decay = frameT > 0 ? Math.exp(-frameT / (run.T0 / 20)) : 1;
  const motion = [UI.blur && !UI.calm ? 1 : 0, UI.calm ? 3 : 6, UI.calm ? 0.04 : 0.08, decay];
  const sims = run.sats.map(s => ({
    e: s.e, ring: run.phase === 'orbit',
    frame: [s.ref.X[0] * s.k, s.ref.X[1] * s.k, s.ref.X[2] * s.k, s.k],
    refV: [s.ref.V[0] * s.k, s.ref.V[1] * s.k, s.ref.V[2] * s.k, frameT], motion,
    opts: [UI.color, UI.color === 2 ? 1 : 0, 1.0, s.C.vesc],
    tint: s.matName === 'rigid' ? [1.0, 0.82, 0.62, 1] : s.matName === 'cohesive' ? [0.75, 1.0, 0.72, 1] : [0.78, 0.9, 1.0, 1],
    heatInv: 1 / (run.heatRef || 0.006 * s.C.vesc * s.C.vesc),
  }));
  run.lastFrame = { frame, sims };
  ren.render(frame, sims);
  placeLabels(cssW, cssH, fp);
}
// The real-ring picture is drawn by the ring pass, so that pass runs when
// it is on even if the debris glow is off.
function frameRealRings(spec) { return UI.real && !!spec.rings; }

// ── DOM labels ────────────────────────────────────────────────────────────
const labelEls = {};
function label(key, text, cls) {
  let el = labelEls[key];
  if (!el) { el = labelEls[key] = document.createElement('div'); el.className = 'lbl ' + (cls || ''); $('labels').appendChild(el); }
  if (el.textContent !== text) el.textContent = text;
  return el;
}
function hideLabel(key) { const el = labelEls[key]; if (el) el.style.display = 'none'; }
function placeLabels(cssW, cssH, fp) {
  const show = (key, text, p, cls, dy = 0) => {
    const el = label(key, text, cls);
    const q = p && ren.project(p, cssW, cssH);
    if (!q || q.x < 0 || q.y < 0 || q.x > cssW || q.y > cssH) { el.style.display = 'none'; return; }
    el.style.display = ''; el.style.transform = `translate(${q.x.toFixed(1)}px, ${(q.y + dy).toFixed(1)}px)`;
  };
  const L = run.limits || limitsFor(run.spec);
  // names on the side of the circles nearest the viewer
  // (at az +- 1 rad: off to the sides, so no name sits on the planet)
  const a = cam.az + 1.0;
  const on = !saverOn;
  if (on && UI.rings) show('r_fluid', 'Roche limit', [L.fluid * Math.cos(a), L.fluid * Math.sin(a), 0], 'ring-fluid', -10);
  else hideLabel('r_fluid');
  if (on && UI.rings && L.rigid * Math.sin(1.0) > 1.35) show('r_rigid', 'limit for a solid moon', [L.rigid * Math.cos(a), L.rigid * Math.sin(a), 0], 'ring-rigid', -8);
  else hideLabel('r_rigid');
  // today's rings of Saturn: one name for the rings, one for the gap
  const realOn = on && UI.real && run.spec.rings;
  const A = SATURN_RINGS.find(r => r.name === 'A ring'), CD = SATURN_RINGS.find(r => r.name === 'Cassini Division');
  const b1 = cam.az - 1.15, b2 = cam.az - 1.6;
  if (realOn) show('sr_rings', 'today’s rings', [A.r1 / KM_SATURN * Math.cos(b1), A.r1 / KM_SATURN * Math.sin(b1), 0], 'ring-real', 8); else hideLabel('sr_rings');
  const cdr = (CD.r0 + CD.r1) / 2 / KM_SATURN;
  if (realOn && cssW >= 600) show('sr_cd', 'Cassini Division', [cdr * Math.cos(b2), cdr * Math.sin(b2), 0], 'ring-real', -14); else hideLabel('sr_cd');
  const s = run.sats[0];
  if (on && run.phase === 'orbit' && s.pl.drag > 0 && (!s.an || s.an.live)) {
    const c = satCentre(s), st = satState(s), v = norm(st.v), Rw = (s.Rs || s.C.Rs) * s.k;
    show('drag', 'drag (tides, sped up)', [0, 1, 2].map(i => c[i] - v[i] * (1.3 * Rw + 0.4)), 'drag', 0);
  } else hideLabel('drag');
  const showL1 = fp && UI.field === 1 && !saverOn && s.an && s.an.live;
  if (showL1) show('L1', 'L1', fp.L1, 'pt'); else hideLabel('L1');
}

// ── readouts ──────────────────────────────────────────────────────────────
function fmtTime(sec) {
  if (sec < 120) return sec.toFixed(0) + ' s';
  if (sec < 7200) return (sec / 60).toFixed(0) + ' min';
  if (sec < 3 * 86400) return (sec / 3600).toFixed(1) + ' h';
  return (sec / 86400).toFixed(1) + ' days';
}
function fmtKm(km) { return km >= 1e4 ? Math.round(km / 100) * 100 : Math.round(km); }
function planetName(spec, cap) { const n = spec.planetName || 'the planet'; return cap ? n.charAt(0).toUpperCase() + n.slice(1) : n; }
function refreshReadout(force) {
  if (!run || !run.sats.length) return;
  const s = run.sats[0], spec = run.spec, L = run.limits || limitsFor(spec);
  if (!s.ref) return;
  const st = satState(s);
  const dNow = Math.hypot(...st.r) / s.Rp;
  const tt = run.t / run.T0;
  const orbit = run.phase === 'orbit';
  // clock: hours and orbits
  const secs = run.tUnitSec ? run.t * run.tUnitSec : 0;
  const unitsNote = spec.unitsNote ? ' (for a Saturn-size planet)' : '';
  $('clock').textContent = orbit ? `${fmtTime(secs)} · ${tt.toFixed(2)} orbits` : '';
  $('clock').title = orbit ? `Time since the start${unitsNote}; one orbit is the start orbit (${fmtTime(run.T0 * run.tUnitSec)}).` : '';
  // the speed label: what it asks for and what the GPU gives
  const opm = orbitsPerMin();
  const got = run.rate > 0 && orbit && !UI.paused ? run.rate * s.C.dt / run.T0 * 60 : opm;
  const slow = orbit && !UI.paused && got < 0.8 * opm;
  $('speedV').textContent = `${opm < 1 ? opm.toFixed(2) : opm.toFixed(opm < 10 ? 1 : 0)} orbits/min${slow ? ` (GPU: ${got.toFixed(1)})` : ''}`;
  $('speedV').title = run.tUnitSec ? `1 s on screen = ${fmtTime(opm / 60 * run.T0 * run.tUnitSec)} at ${planetName(spec)}` : '';
  $('dockSpeedV').textContent = SPEED_STOPS.reduce((b, x) => Math.abs(x.v - UI.speedLog) < Math.abs(b.v - UI.speedLog) ? x : b).name;
  // distance bar: from the surface (1) to a little past the start
  const maxD = Math.max(run.viewD * 1.15, L.fluid * 1.3);
  const x = v => Math.max(0, Math.min(100, (v - 1) / (maxD - 1) * 100));
  $('distTitle').textContent = `Distance from ${planetName(spec)}`;
  document.querySelector('#distBar .zone.in').style.width = x(L.fluid) + '%';
  document.querySelector('#distBar .zone.out').style.left = x(L.fluid) + '%';
  $('distLim').style.left = x(L.fluid) + '%';
  $('distMark').style.left = x(dNow) + '%';
  // one-piece share
  const fs = run.sats.map(q => q.an ? q.an.f : 1);
  $('pieceV').textContent = run.sats.length > 1 ? fs.map((f, i) => `${run.sats[i].matName === 'rigid' ? 'rough' : 'loose'} ${Math.round(100 * f)}%`).join(' · ') : `${Math.round(100 * fs[0])}%`;
  $('pieceV').classList.toggle('two', run.sats.length > 1);
  drawSpark();
  // the live sentence
  const subj = spec.kind === 'flyby' ? 'The comet' : run.sats.length > 1 ? 'The moons' : 'The moon';
  const Pn = planetName(spec), km = dNow * (spec.Rkm || KM_SATURN);
  let sent;
  if (!orbit) sent = 'Building the moon: thousands of grains settle together under their own gravity.';
  else if (fs[0] < 0.25 && run.sats.length === 1 && run.storyKey === 'ring') sent = `${subj} is gone: its pieces now circle ${Pn}${spec.kind === 'flyby' ? ' in a stream' : ' as a ring'}.`;
  else if (dNow < L.fluid) {
    const holds = s.matName !== 'fluid' && fs[0] > 0.9;
    sent = `${subj} is ${dNow.toFixed(2)} ${Pn} radii out, inside the Roche limit (${L.fluid.toFixed(2)}): ${holds ? 'friction still holds it together, for now.' : `${Pn}’s tide is stronger than its own gravity, so it comes apart.`}`;
  } else sent = `${subj} is ${dNow.toFixed(2)} ${Pn} radii out (${fmtKm(km).toLocaleString()} km), ${Math.round((dNow / L.fluid - 1) * 100)}% outside the Roche limit: it holds together.`;
  $('sentence').textContent = sent;
  if (!$('details').classList.contains('off') || force) refreshDetails(dNow, tt, L);
  syncPlayButtons();
}
function drawSpark() {
  const c = $('spark'); if (!c || !c.clientWidth) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight || 40;
  if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const tNow = run.t / run.T0, tMax = Math.max(1, tNow * 1.1);
  g.strokeStyle = 'rgba(160,180,210,0.18)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, h - 1); g.lineTo(w, h - 1); g.moveTo(0, 2); g.lineTo(w, 2); g.stroke();
  for (const s of run.sats) {
    g.strokeStyle = run.sats.length > 1 ? s.color : '#ffb46a'; g.lineWidth = 1.6; g.beginPath();
    let first = true;
    for (const [t, f] of s.hist) { if (t > tNow + 1e-9) break; const X = t / tMax * w, Y = 2 + (1 - f) * (h - 4); if (first) { g.moveTo(X, Y); first = false; } else g.lineTo(X, Y); }
    g.stroke();
  }
}
function refreshDetails(dNow, tt, L) {
  const s = run.sats[0], spec = run.spec;
  const tStr = spec.kind === 'flyby' && run.tPeri !== undefined ? `${(run.t - run.tPeri) / run.T0 >= 0 ? '+' : '−'}${Math.abs((run.t - run.tPeri) / run.T0).toFixed(2)} from the closest pass` : `${tt.toFixed(2)} orbits`;
  $('rdT').textContent = `${tStr} · ${fmtTime(run.t * (run.tUnitSec || 0))}`;
  $('rdD').textContent = dNow.toFixed(3);
  $('rdDr').textContent = (dNow / L.rigid).toFixed(3);
  $('rdDf').textContent = (dNow / L.fluid).toFixed(3);
  const bnd = run.sats.map(x => x.an ? (100 * x.an.f).toFixed(1) + '%' : '—').join(' · ');
  $('rdB').textContent = bnd;
  $('rdG').textContent = s.an ? String(s.an.groups) : '—';
  $('rdH').textContent = s.an && s.an.live && Number.isFinite(s.an.rH) ? (s.an.rH / (s.Rs * Math.cbrt(s.an.f))).toFixed(2) : '—';
  $('rdRho').textContent = s.pile ? `${s.pile.st.rho.toFixed(3)} (packing ${(s.pile.st.rho / P.RHO_GRAIN).toFixed(2)})` : '—';
  $('rdE').textContent = s.an && Number.isFinite(s.an.drift) ? s.an.drift.toExponential(1) + ' |U_s|' : (s.pl && s.pl.drag ? 'drag on: not tracked' : '—');
  $('rdL').textContent = s.an && Number.isFinite(s.an.Ldrift) && !(s.pl && s.pl.drag) ? s.an.Ldrift.toExponential(1) : '—';
  $('rdAcc').textContent = s.an ? String(s.an.accreted) : '—';
  $('rdDt').textContent = `${s.C.dt.toExponential(2)} (${Math.round(run.T0 / s.C.dt).toLocaleString()} per orbit)`;
  $('rdGpu').textContent = `${gpuMs.toFixed(1)} ms · ${stepsMax} steps max · ${fps.toFixed(0)} fps · ${(ren.W * ren.H / 1e6).toFixed(1)} MP`;
  // gauge: a_tide / g at the surface = 2 (rho_p/rho_s) (R_p/d)^3
  const ratio = 2 * spec.q * Math.pow(1 / dNow, 3);
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
  $('runsV').textContent = `x = ${xCur.toFixed(2)}`;
}

// ── UI ────────────────────────────────────────────────────────────────────
function setPaused(p) {
  if (!p && UI.paused && run) truncateHistory();
  UI.paused = p;
  if (run) run.scrubbing = false;
  syncPlayButtons();
}
function syncPlayButtons() {
  const p = UI.paused;
  for (const id of ['playBtn', 'dockPlay']) { const b = $(id); b.textContent = p ? '▶' : '❚❚'; b.setAttribute('aria-label', p ? 'Play' : 'Pause'); b.classList.toggle('on', p); }
  $('playBtn').title = p ? 'Play (Space)' : 'Pause (Space)';
  document.body.classList.toggle('paused', p);
}
function stepBy(frac) {
  if (!run || run.phase !== 'orbit') return;
  if (!UI.paused) setPaused(true);
  truncateHistory();
  run.stepLeft += Math.max(1, Math.round(frac * run.T0 / run.sats[0].C.dt));
}
function setSpeed(v) {
  UI.speedLog = Math.max(SPEED_MIN, Math.min(SPEED_MAX, v));
  $('speed').value = UI.speedLog;
  stepsMax = Math.max(stepsMax, 8);
  for (const b of $('stops').querySelectorAll('button')) b.classList.toggle('on', Math.abs(+b.dataset.s - UI.speedLog) < 0.02);
  refreshReadout(false);
}
function syncScrub() {
  const sc = $('scrub'), n = run ? run.snaps.length : 0;
  sc.max = Math.max(0, n - 1); sc.disabled = n < 2;
  if (!run || !run.scrubbing) sc.value = run && run.viewIdx >= 0 ? run.viewIdx : 0;
  const live = !run || run.viewIdx >= n - 1;
  $('scrubInfo').textContent = n < 2 ? 'history fills as it runs' : live ? (UI.paused ? 'paused' : 'live') : `back in time: ${fmtTime(run.snaps[run.viewIdx].t * run.tUnitSec)} · press play to go on from here`;
  $('story').classList.toggle('past', !live);
}
// open one panel (drawer, popover, modal); null closes them all
const PANELS = ['gallery', 'display', 'advanced', 'details', 'explain', 'moreMenu'];
function openPanel(id) {
  for (const p of PANELS) { const el = $(p), on = p === id && el.classList.contains('off'); el.classList.toggle('off', !on); }
  for (const [b, p] of [['scenBtn', 'gallery'], ['dispBtn', 'display'], ['advBtn', 'advanced'], ['detBtn', 'details'], ['helpBtn', 'explain'], ['dockDisp', 'display'], ['dockMore', 'moreMenu']]) $(b).classList.toggle('on', !$(p).classList.contains('off'));
  document.body.classList.toggle('drawer-open', !$('advanced').classList.contains('off') || !$('details').classList.contains('off'));
  if (id === 'details' && run) refreshReadout(true);
}
function buildUI() {
  // the gallery
  const cards = $('cards');
  for (const sc of SCENARIOS) {
    const b = document.createElement('button');
    b.className = 'scard'; b.dataset.k = sc.key;
    b.innerHTML = `${cardArt(sc.key)}<b>${sc.name}</b><span>${sc.blurb}</span>`;
    b.addEventListener('click', () => { applyScenario(sc.key); startRun(); openPanel(null); });
    cards.appendChild(b);
  }
  const bBox = $('bodies');
  for (const [k, r] of Object.entries(REAL)) {
    const b = document.createElement('button'); b.dataset.b = k; b.textContent = r.name;
    b.addEventListener('click', () => { UI.body = k; applyScenario('bodies'); startRun(); });
    bBox.appendChild(b);
  }
  const nSel = $('nSel');
  for (const n of N_OPTS) { const o = document.createElement('option'); o.value = n; o.textContent = (n / 1024) + 'k' + (n >= 24576 ? ' (fast GPU)' : ''); nSel.appendChild(o); }
  nSel.value = UI.N;
  nSel.addEventListener('change', () => { UI.N = +nSel.value; });
  // Advanced: the values change on input; "Start again" applies them
  const bind = (id, key, fmt) => {
    const inp = $(id), out = $(id + 'V');
    const show = () => { UI[key] = +inp.value; if (out) out.textContent = fmt(+inp.value); };
    inp.addEventListener('input', show); show();
  };
  bind('d', 'd', v => v.toFixed(2));
  bind('peri', 'peri', v => v.toFixed(2));
  bind('ecc', 'e', v => v.toFixed(2));
  bind('q', 'qLog', v => Math.pow(10, v).toFixed(2));
  bind('j2', 'J2', v => v.toFixed(4));
  bind('mu', 'mu', v => v.toFixed(2));
  bind('coh', 'coh', v => v.toFixed(2));
  for (const b of $('materials').querySelectorAll('button')) b.addEventListener('click', () => {
    UI.material = b.dataset.m; const m = P.MATERIALS[UI.material]; UI.mu = m.mu; UI.coh = m.coh;
    $('mu').value = UI.mu; $('coh').value = UI.coh; $('muV').textContent = UI.mu.toFixed(2); $('cohV').textContent = UI.coh.toFixed(2);
    syncButtons();
  });
  $('applyBtn').addEventListener('click', () => { startRun(); if (PHONE_Q.matches) openPanel(null); });
  // Display
  const segBtns = (box, key, attr, conv = v => v) => { for (const b of $(box).querySelectorAll('button')) b.addEventListener('click', () => { UI[key] = conv(b.dataset[attr]); cam.boostUntil = performance.now() + 3000; if (key === 'cam') { cam.zoom = 1; } syncButtons(); }); };
  segBtns('cams', 'cam', 'c'); segBtns('colors', 'color', 'k', Number); segBtns('fields', 'field', 'f', Number);
  for (const b of $('quals').querySelectorAll('button')) b.addEventListener('click', () => { setQuality(b.dataset.q); syncButtons(); });
  // Reduce motion: on when the system asks for it, until the user sets it
  let calmSet = false;
  $('tCalm').addEventListener('change', () => { calmSet = true; });
  RM_Q.addEventListener('change', e => { if (!calmSet) { UI.calm = e.matches; $('tCalm').checked = UI.calm; } });
  for (const [id, key] of [['tCalm', 'calm'], ['tRings', 'rings'], ['tReal', 'real'], ['tHill', 'hill'], ['tPred', 'pred'], ['tRing', 'ringOn'], ['tBlur', 'blur']]) {
    const c = $(id); c.checked = UI[key]; c.addEventListener('change', () => { UI[key] = c.checked; refreshReadout(false); });
  }
  $('tFps').addEventListener('change', () => { UI.showFps = $('tFps').checked; $('fpsChip').classList.toggle('off', !UI.showFps); });
  // transport and speed
  $('resetBtn').addEventListener('click', () => startRun());
  $('playBtn').addEventListener('click', () => setPaused(!UI.paused));
  $('dockPlay').addEventListener('click', () => setPaused(!UI.paused));
  $('stepBtn').addEventListener('click', () => stepBy(0.01));
  $('dockStep').addEventListener('click', () => stepBy(0.01));
  $('blockBtn').addEventListener('click', () => stepBy(0.1));
  $('speed').addEventListener('input', () => setSpeed(+$('speed').value));
  for (const b of $('stops').querySelectorAll('button')) b.addEventListener('click', () => setSpeed(+b.dataset.s));
  for (const b of $('dockSpeed').querySelectorAll('button')) b.addEventListener('click', () => {
    let i = 0;
    SPEED_STOPS.forEach((x, k) => { if (Math.abs(x.v - UI.speedLog) < Math.abs(SPEED_STOPS[i].v - UI.speedLog)) i = k; });
    setSpeed(SPEED_STOPS[Math.max(0, Math.min(SPEED_STOPS.length - 1, i + +b.dataset.d))].v);
  });
  // the scrubber: drag to go back; it pauses
  const sc = $('scrub');
  sc.addEventListener('input', () => {
    if (!run || run.phase !== 'orbit') return;
    if (!UI.paused) setPaused(true);
    run.scrubbing = true;
    const i = +sc.value;
    if (allFree()) restoreSnap(i); else run.pendingRestore = i;
  });
  sc.addEventListener('change', () => { if (run) run.scrubbing = false; syncScrub(); });
  // panels
  $('scenBtn').addEventListener('click', () => openPanel('gallery'));
  $('dispBtn').addEventListener('click', () => openPanel('display'));
  $('advBtn').addEventListener('click', () => openPanel('advanced'));
  $('detBtn').addEventListener('click', () => openPanel('details'));
  $('helpBtn').addEventListener('click', () => openPanel('explain'));
  $('dockDisp').addEventListener('click', () => openPanel('display'));
  $('dockMore').addEventListener('click', () => openPanel('moreMenu'));
  for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => openPanel(null));
  for (const b of $('moreMenu').querySelectorAll('[data-open]')) b.addEventListener('click', () => openPanel(b.dataset.open));
  $('gallery').addEventListener('click', e => { if (e.target === $('gallery')) openPanel(null); });
  $('gpu').addEventListener('pointerdown', () => { for (const p of ['display', 'explain', 'moreMenu']) if (!$(p).classList.contains('off')) openPanel(null); });
  // keys
  window.addEventListener('keydown', e => {
    if (e.target && (e.target.tagName === 'INPUT' && e.target.type !== 'range' || e.target.tagName === 'SELECT')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ') { e.preventDefault(); setPaused(!UI.paused); }
    else if (e.key === '.') stepBy(0.01);
    else if (e.key === ',') stepBy(0.1);
    else if (e.key === '[') setSpeed(UI.speedLog - 0.3);
    else if (e.key === ']') setSpeed(UI.speedLog + 0.3);
    else if (e.key === 'r' || e.key === 'R') startRun();
    else if (e.key === 'Escape') openPanel(null);
  });
  bindPointer();
  syncStory(true);
  applyScenario(UI.scen);
  setSpeed(UI.speedLog);
  syncPlayButtons();
}
function applyScenario(key) {
  UI.scen = key;
  const sc = SCENARIOS.find(s => s.key === key);
  const src = sc.kind === 'real' ? REAL[UI.body] : sc;
  UI.d = src.d ?? UI.d; UI.peri = src.peri ?? UI.peri; UI.e = src.e ?? UI.e;
  UI.qLog = Math.log10(src.q ?? 1); UI.J2 = src.J2 || 0;
  UI.material = src.material || (sc.materials ? sc.materials[0] : 'fluid');
  const m = P.MATERIALS[UI.material]; UI.mu = m.mu; UI.coh = m.coh;
  UI.cam = 'planet'; cam.zoom = 1; cam.el = sc.el ?? 0.42; cam.az = 0.9; cam.boostUntil = performance.now() + 3000;
  UI.color = sc.color ?? 4; UI.field = 0;
  if (sc.speed) setSpeed(Math.log10(sc.speed));
  UI.paused = false;
  for (const [id, key2, f] of [['d', 'd', v => v.toFixed(2)], ['peri', 'peri', v => v.toFixed(2)], ['ecc', 'e', v => v.toFixed(2)], ['q', 'qLog', v => Math.pow(10, v).toFixed(2)], ['j2', 'J2', v => v.toFixed(4)], ['mu', 'mu', v => v.toFixed(2)], ['coh', 'coh', v => v.toFixed(2)]]) {
    $(id).value = UI[key2]; $(id + 'V').textContent = f(UI[key2]);
  }
  const kind = sc.kind === 'real' ? REAL[UI.body].kind : sc.kind;
  $('rowD').style.display = kind === 'flyby' ? 'none' : '';
  $('rowPeri').style.display = kind === 'flyby' ? '' : 'none';
  $('rowEcc').style.display = kind === 'flyby' ? '' : 'none';
  $('scenName').textContent = sc.kind === 'real' ? REAL[UI.body].name : sc.name;
  $('explainSaturn').style.display = key === 'saturn' || (sc.kind === 'real' && UI.body === 'pan') ? '' : 'none';
  $('tReal').closest('label').style.display = (sc.kind === 'real' ? REAL[UI.body].rings : sc.rings) ? '' : 'none';
  syncButtons();
}
function syncButtons() {
  for (const b of $('cards').querySelectorAll('.scard')) b.classList.toggle('on', b.dataset.k === UI.scen);
  for (const b of $('bodies').querySelectorAll('button')) b.classList.toggle('on', UI.scen === 'bodies' && b.dataset.b === UI.body);
  for (const b of $('materials').querySelectorAll('button')) b.classList.toggle('on', b.dataset.m === UI.material);
  $('materials').classList.toggle('dim', UI.scen === 'compare');
  for (const b of $('cams').querySelectorAll('button')) b.classList.toggle('on', b.dataset.c === UI.cam);
  for (const b of $('colors').querySelectorAll('button')) b.classList.toggle('on', +b.dataset.k === UI.color);
  for (const b of $('fields').querySelectorAll('button')) b.classList.toggle('on', +b.dataset.f === UI.field);
  for (const b of $('quals').querySelectorAll('button')) b.classList.toggle('on', b.dataset.q === UI.quality);
  $('matHint').textContent = UI.scen === 'compare' ? 'This story runs one loose and one rough moon.' : P.MATERIALS[UI.material].note;
  $('camHint').textContent = UI.cam === 'follow' ? 'The view follows the moon, with its direction fixed in space. At high speed it stays on the planet instead.' : UI.cam === 'planet' ? 'The planet stays still; the moon goes round it.' : '';
  drawLegend();
}

// matplotlib "plasma" (the polynomial fit in shaders/particles.wgsl)
function plasma(t) {
  const C = [[0.05873234392399702, 0.02333670892565664, 0.5433401826748754], [2.176514634195958, 0.2383834171260182, 0.7539604599784036], [-2.689460476458034, -7.455851135738909, 3.110799939717086],
    [6.130348345893603, 42.3461881477227, -28.51885465332158], [-11.10743619062271, -82.66631109428045, 60.13984767418263], [10.02306557647065, 71.41361770095349, -54.07218655560067], [-3.658713842777788, -22.93153465461149, 18.19190778539828]];
  return [0, 1, 2].map(k => { let v = C[6][k]; for (let i = 5; i >= 0; i--) v = C[i][k] + t * v; return Math.round(255 * Math.max(0, Math.min(1, v))); });
}
function drawLegend() {
  const lg = $('legend');
  const heat = UI.color === 3 || UI.color === 4;
  lg.classList.toggle('off', UI.field === 0 && UI.color !== 2 && !heat);
  const c = $('lgBar'), g = c.getContext('2d'), w = c.width, h = c.height;
  const grad = g.createLinearGradient(0, 0, w, 0);
  if (UI.field === 1) {
    $('lgTitle').textContent = 'Force map: who holds a grain (bright line: the moon’s grip)';
    [[0, '#1a8cd9'], [0.35, '#0f3d5e'], [0.5, '#080a12'], [0.65, '#9b3b2c'], [1, '#ffd173']].forEach(([o, col]) => grad.addColorStop(o, col));
    $('lgLo').textContent = 'the moon'; $('lgMid').textContent = 'L1'; $('lgHi').textContent = 'the planet';
  } else if (UI.field === 2) {
    $('lgTitle').textContent = 'Force map: tide against the moon’s pull (bright line: equal)';
    [[0, '#05051a'], [0.25, '#4d1a8c'], [0.5, '#d94059'], [0.75, '#ff9e26'], [1, '#fff8bf']].forEach(([o, col]) => grad.addColorStop(o, col));
    $('lgLo').textContent = '0.01×'; $('lgMid').textContent = 'equal'; $('lgHi').textContent = '100×';
  } else if (heat) {
    $('lgTitle').textContent = UI.color === 4 ? 'Ice; grains that collide glow by the heat of their collisions' : 'Heat from collisions (energy per kilogram, log scale)';
    for (let i = 0; i <= 10; i++) { const p = plasma(i / 10); grad.addColorStop(i / 10, `rgb(${p[0]},${p[1]},${p[2]})`); }
    $('lgLo').textContent = 'cool'; $('lgMid').textContent = 'warm'; $('lgHi').textContent = 'hot';
  } else {
    $('lgTitle').textContent = 'Tide strain on each grain: tide / the moon’s own pull';
    [[0, '#05051a'], [0.25, '#4d1a8c'], [0.5, '#d94059'], [0.75, '#ff9e26'], [1, '#fff8bf']].forEach(([o, col]) => grad.addColorStop(o, col));
    $('lgLo').textContent = '0.03×'; $('lgMid').textContent = 'equal'; $('lgHi').textContent = '30×';
  }
  g.clearRect(0, 0, w, h); g.fillStyle = grad; g.fillRect(0, 0, w, h);
}

// Small pictures for the gallery cards (inline SVG, 160 x 90).
function cardArt(key) {
  const sv = body => `<svg viewBox="0 0 160 90" aria-hidden="true"><rect width="160" height="90" fill="#070b13"/>${body}</svg>`;
  const stars = '<g fill="#9fb3d1" opacity="0.5"><circle cx="12" cy="14" r="0.8"/><circle cx="140" cy="20" r="0.7"/><circle cx="128" cy="76" r="0.8"/><circle cx="30" cy="70" r="0.6"/><circle cx="96" cy="8" r="0.6"/></g>';
  if (key === 'saturn') return sv(`${stars}<ellipse cx="80" cy="47" rx="60" ry="13" fill="none" stroke="#cdb98e" stroke-opacity="0.5" stroke-width="7"/><ellipse cx="80" cy="45" rx="20" ry="18" fill="#d9c08a"/><path d="M60 45 a20 18 0 0 1 40 0" fill="#e6d3a6"/><ellipse cx="80" cy="47" rx="60" ry="13" fill="none" stroke="#e8dcc0" stroke-opacity="0.7" stroke-width="3" stroke-dasharray="0 0 60 200"/><path d="M128 40 q8 6 2 12" fill="none" stroke="#bfe0ff" stroke-width="2" stroke-dasharray="2 3"/><circle cx="131" cy="36" r="3.4" fill="#cfe4ff"/>`);
  if (key === 'close') return sv(`${stars}<circle cx="80" cy="45" r="16" fill="#6f9cc8"/><ellipse cx="80" cy="45" rx="46" ry="22" fill="none" stroke="#ff7a59" stroke-opacity="0.75" stroke-dasharray="3 3"/><path d="M146 45 C146 10 40 8 30 40 C24 60 60 74 96 66" fill="none" stroke="#ffd7a0" stroke-opacity="0.6" stroke-width="1.4"/><ellipse cx="100" cy="65" rx="5" ry="3.5" fill="#cfe4ff"/>`);
  if (key === 'flyby') return sv(`${stars}<circle cx="64" cy="48" r="20" fill="#c99a6a"/><path d="M64 51 h20" stroke="#a87650" stroke-width="2"/><path d="M150 6 Q70 40 150 86" fill="none" stroke="#ffd7a0" stroke-opacity="0.5" stroke-width="1.2"/>${[0, 1, 2, 3, 4, 5, 6].map(i => `<circle cx="${108 + i * 5.5}" cy="${62 + i * 3.4}" r="${2.2 - i * 0.18}" fill="#e8eef8"/>`).join('')}`);
  if (key === 'compare') return sv(`${stars}<circle cx="80" cy="45" r="15" fill="#6f9cc8"/><ellipse cx="80" cy="45" rx="54" ry="24" fill="none" stroke="#9aa6b8" stroke-opacity="0.35"/><ellipse cx="30" cy="40" rx="7.5" ry="4" fill="#62c4ff"/><circle cx="21" cy="40" r="1.2" fill="#62c4ff"/><circle cx="39" cy="41" r="1.2" fill="#62c4ff"/><circle cx="131" cy="50" r="5" fill="#ff9a62"/>`);
  return sv(`${stars}<circle cx="58" cy="46" r="22" fill="#b5603f"/><circle cx="58" cy="46" r="46" fill="none" stroke="#ff7a59" stroke-opacity="0.6" stroke-dasharray="3 3"/><circle cx="96" cy="36" r="3.5" fill="#a59c90"/><text x="104" y="40" fill="#9fb3d1" font-size="9" font-family="Inter, system-ui, sans-serif">Phobos</text>`);
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
  c.addEventListener('dblclick', () => { const sc = SCENARIOS.find(s => s.key === UI.scen); cam.zoom = 1; cam.az = 0.9; cam.el = sc.el ?? 0.42; cam.boostUntil = performance.now() + 3000; });
}

// Overlay margins in CSS px. The bar covers the top; the story strip and
// the readout card (and the dock on a phone) cover the bottom; an open
// drawer covers its side. The saver uses the plate band instead.
let band = null, bandAt = -1e9;
function occlusion(w, h) {
  const o = { l: 0, r: 0, t: 0, b: 0 };
  if (saverOn) {
    const now = performance.now();
    if (now - bandAt > 250) { bandAt = now; band = plateBand(h); }
    if (band) { let t = band.t, b = band.b; const k = (t + b) / (0.65 * h); if (k > 1) { t /= k; b /= k; } o.t = t; o.b = b; }
    return o;
  }
  const rect = id => { const el = $(id); if (!el || el.classList.contains('off') || el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return null; const q = el.getBoundingClientRect(); return q.width > 1 && q.height > 1 ? q : null; };
  const bar = rect('bar'); if (bar) o.t = Math.max(o.t, Math.min(h * 0.3, bar.bottom));
  const ro = rect('readouts'); if (ro && ro.width < w * 0.6 && !PHONE_Q.matches) { /* a corner card: the moon may pass behind it, the planet stays clear */ }
  else if (ro && PHONE_Q.matches) o.t = Math.max(o.t, Math.min(h * 0.4, ro.bottom));
  for (const id of ['story', 'dock']) { const q = rect(id); if (q && q.top > h * 0.4) o.b = Math.max(o.b, Math.min(h * 0.45, h - q.top)); }
  for (const id of ['advanced', 'details']) {
    const q = rect(id); if (!q || PHONE_Q.matches) continue;
    if (q.left > w / 2) o.r = Math.max(o.r, w - q.left); else o.l = Math.max(o.l, q.right);
  }
  return o;
}

// Per-stage GPU time (ms, median of n): each stage is submitted alone and
// timed to its completion on the queue (onSubmittedWorkDone). The frame
// loop stops while it runs. Stages: sim blocks (1 and 4), the gravity sum
// alone, a readback, the worker analysis, then the render stages and each
// scene draw alone.
async function profile(n = 7) {
  profiling = true;
  await new Promise(r => setTimeout(r, 100));
  const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
  const q = dev.queue, s = run.sats[0], g = s.gpu, out = {};
  const time = async fn => { await q.onSubmittedWorkDone(); const t0 = performance.now(); await fn(); await q.onSubmittedWorkDone(); return performance.now() - t0; };
  const rep = async (name, fn) => { const a = []; for (let i = 0; i < n; i++) a.push(await time(fn)); out[name] = +med(a).toFixed(2); };
  const steps = Math.max(1, Math.round(stepsWanted()));
  await rep('sim 1 block', () => { const e = dev.createCommandEncoder(); for (const x of run.sats) x.gpu.encode(e, 1, false); q.submit([e.finish()]); });
  await rep(`sim ${steps} steps (one frame at this speed)`, () => { const e = dev.createCommandEncoder(); for (const x of run.sats) x.gpu.encodeSteps(e, steps, false); q.submit([e.finish()]); });
  await rep('gravity sum', () => { const e = dev.createCommandEncoder(); const p = e.beginComputePass(); for (const x of run.sats) x.gpu._dispatch(p, 'gravity', x.gpu.bg.gravity, null, x.gpu.np); p.end(); q.submit([e.finish()]); });
  await rep('readback', async () => { await g.readback(); });
  { const a = []; for (let i = 0; i < 3; i++) { const rb = await g.readback(); const t0 = performance.now(); await workerCall({ type: 'analyze', N: s.N, np: g.np, body: rb.body, grav: rb.grav, rad: s.rad, X: rb.X, V: rb.V, GMp: s.pl.GM, t: rb.t, fragCount: 24 }, [rb.body.buffer, rb.grav.buffer]); a.push(performance.now() - t0); } out['analysis (worker, CPU)'] = +med(a).toFixed(2); }
  run.t = run.sats[0].gpu.t;
  const { frame, sims } = run.lastFrame;
  if (dev.features.has('timestamp-query')) {
    // GPU timestamps: the sim steps of one frame at this speed, then each
    // render stage, all in one submit
    const runs = [];
    for (let i = 0; i < n; i++) runs.push(await ren.renderGPU(frame, sims, null, enc => {
      for (const x of run.sats) { x.gpu.tw = () => ren._tw('sim ' + steps + ' steps'); x.gpu.encodeSteps(enc, steps, false); x.gpu.tw = null; }
    }));
    for (const k of Object.keys(runs[0])) out['GPU ' + k] = +med(runs.map(x => x[k] || 0)).toFixed(3);
    out['GPU frame at this speed'] = +med(runs.map(x => Object.values(x).reduce((a, v) => a + v, 0))).toFixed(3);
    for (const d of ['sky', 'surface', 'part', 'disk', 'field', 'lines', 'atmo']) {
      const a = []; for (let i = 0; i < n; i++) a.push((await ren.renderGPU(frame, sims, { [d]: true })).scene);
      out['GPU scene: ' + d + ' alone'] = +med(a).toFixed(3);
    }
  }
  const st = []; for (let i = 0; i < n; i++) st.push(await ren.renderTimed(frame, sims));
  for (const k of Object.keys(st[0])) out['render ' + k] = +med(st.map(x => x[k])).toFixed(2);
  for (const d of ['sky', 'surface', 'part', 'disk', 'field', 'lines', 'atmo']) {
    const a = []; for (let i = 0; i < n; i++) a.push((await ren.renderTimed(frame, sims, { [d]: true })).scene);
    out['scene: ' + d + ' alone'] = +med(a).toFixed(2);
  }
  { const a = []; for (let i = 0; i < n; i++) a.push((await ren.renderTimed(frame, sims, {})).scene); out['scene: empty pass'] = +med(a).toFixed(2); }
  { const t0 = performance.now(); for (let i = 0; i < 20; i++) buildSegments(ren.W / $('gpu').clientWidth); out['CPU buildSegments'] = +((performance.now() - t0) / 20).toFixed(2); }
  { const t0 = performance.now(); for (let i = 0; i < 10; i++) refreshReadout(false); out['CPU readouts'] = +((performance.now() - t0) / 10).toFixed(2); }
  out.canvas = `${ren.W}x${ren.H}`; out.N = run.sats.map(x => x.N).join('+'); out.field = UI.field; out['steps per frame'] = steps;
  profiling = false;
  return out;
}

function debugState() {
  if (!run) return null;
  return {
    phase: run.phase, scen: UI.scen, story: run.storyKey, storyT: Object.fromEntries(Object.entries(run.story).map(([k, v]) => [k, +(v / run.T0).toFixed(3)])),
    quality: { preset: Q.preset, scale: Q.scale, bloom: Q.bloom, stepsMax, px: ren.W * ren.H }, cam: Object.assign({}, camStats, { prev: undefined }), calm: UI.calm,
    orbitsPerMin: orbitsPerMin(), gotOrbitsPerMin: run.sats[0] ? run.rate * run.sats[0].C.dt / run.T0 * 60 : 0, paused: UI.paused,
    t: run.t, T0: run.T0, orbits: run.t / run.T0, hours: run.t * (run.tUnitSec || 0) / 3600, snaps: run.snaps.length, viewIdx: run.viewIdx, wallS: (performance.now() - run.started) / 1000,
    gpuMs, cpuMs, stepsMax, fps,
    sats: run.sats.filter(s => s.ref).map(s => ({ N: s.N, mat: s.matName, f: s.an && s.an.f, drift: s.an && s.an.drift, Ldrift: s.an && s.an.Ldrift, groups: s.an && s.an.groups, accreted: s.an && s.an.accreted, overflow: s.gpu.overflow, d: Math.hypot(...satState(s).r) / s.Rp, drag: s.pl.drag })),
  };
}

// ── SCREENSAVER ───────────────────────────────────────────────────────────
// lib/screensaver.js has the protocol. enter() hides the page UI (CSS
// under html.sn-saver), takes N = 8192 and plays a seeded shuffle of
// SHOTS. Every shot is planet-fixed: the camera looks at the planet from a
// slowly turning direction and never follows the moon; the page's camera
// governor caps the turn (ROT_MAX). A new shot fades to black, settles,
// runs its warm-up in the dark at full speed, then fades in over 2 s.
//   saturn   the main shot: the Saturn story from the start, slow, until
//            the ring phase plus some time (at most 80 s)
//   rings    a fly-by of today's rings at their true size, with a moon
//            torn up in them: the run starts near the limit and warms up
//            in the dark; the camera rises slowly from the ring plane
//   comet    the comet pass of Jupiter
// The subject is framed in the clear band of the plate (plateBand).
const SHOTS = [
  { key: 'saturn', scen: 'saturn', title: 'How Saturn may have got its rings', warm: () => 0, speed: 5, hold: 80,
    until: r => r.story.ring !== undefined && (r.t - r.story.ring) / r.T0 > 1.5,
    cam: { zoom: 1, el: 0.22, az: 0.9, spin: 0.6 } },
  { key: 'rings', scen: 'saturn', title: 'Today’s rings of Saturn, at their true size', spec: { d: 2.2, d1: 1.75, orbits: 1.5 }, warm: () => 1.6, speed: 3, hold: 45,
    cam: { zoom: 0.92, el: 0.05, elTo: 0.42, az: 0.5, spin: 1.6, zoomTo: 0.7, backlit: true } },
  { key: 'comet', scen: 'flyby', title: 'A comet torn into a string of pearls', warm: r => r.tPeri !== undefined ? (r.tPeri / r.T0 - 0.8) : 0, speed: 2, hold: 40,
    until: r => r.t / r.T0 > r.tPeri / r.T0 + 5, cam: { zoom: 0.9, el: 0.6, az: 1.2, spin: 0.5 } },
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
  const prog = Math.min(1, (performance.now() - saver.shotAt) / (saver.hold * 1000));
  const ease = prog * prog * (3 - 2 * prog);
  g.az = (c.az ?? 0.9) + saver.az;
  g.el = c.elTo !== undefined ? c.el + (c.elTo - c.el) * ease : (c.el ?? g.el);
  const z = c.zoomTo !== undefined ? c.zoom + (c.zoomTo - c.zoom) * ease : c.zoom * (1 - 0.06 * ease);
  g.dist = g.dist / (cam.zoom || 1) * z;
}
function saverLabel() {
  if (!saver || !saver.opts.label || !run || run.phase !== 'orbit' || !run.sats[0].ref) return;
  const s = run.sats[0], L = run.limits || limitsFor(run.spec);
  const st = satState(s), dNow = Math.hypot(...st.r) / s.Rp;
  const bnd = run.sats.map(x => x.an ? (100 * x.an.f).toFixed(0) + '%' : '100%').join(' / ');
  saver.opts.label({
    title: 'Roche limit', sub: saver.cur ? saver.cur.title : '',
    params: [
      { sym: 'd/R_p', name: 'distance', value: dNow.toFixed(2), cls: 'm5' },
      { sym: 'd_\\mathrm{fluid}', name: 'Roche limit', value: L.fluid.toFixed(2) + ' R_p', cls: 'm1' },
      { sym: 'f_b', name: 'in one piece', value: bnd, cls: 'm3' },
    ],
    tex: ['d_\\mathrm{fluid} \\approx 2.44\\,R_p\\left(\\rho_p/\\rho_s\\right)^{1/3}'],
    rules: [['d_\\mathrm{fluid}', 'm1'], ['R_p', 'm5']],
    eq: ['d_fluid ≈ 2.44 R_p (ρ_p/ρ_s)^(1/3)'],
    lines: [storyText(run.storyKey), `${s.N.toLocaleString()} grains · self-gravity, contacts, tide on the GPU`],
    code: { lang: 'wgsl', name: 'sim.wgsl · cs_forces', text: WGSL_EXTRACT },
    anchor: () => {
      const cs = $('gpu');
      const q = ren.project([0, 0, 0], cs.clientWidth, cs.clientHeight);
      if (!q) return null;
      return { x: q.x, y: q.y, r: Math.max(8, ren.focal / q.w / (ren.H / cs.clientHeight)) };
    },
  });
}
function saverScenario() {
  const sv = saver;
  if (!sv.queue.length) {
    // the Saturn story first in each round, then the other two in a seeded
    // order; never the same shot twice in a row
    const rest = SHOTS.slice(1);
    if (sv.rnd() < 0.5) rest.reverse();
    sv.queue = [SHOTS[0], ...rest];
    if (sv.last && sv.queue[0] === sv.last) sv.queue.push(sv.queue.shift());
  }
  const shot = sv.queue.shift(); sv.last = shot;
  sv.cur = { shot, title: shot.title, cam: shot.cam };
  UI.ringGain = 2; UI.rings = true; UI.real = true; UI.pred = false; UI.hill = false; UI.track = false; UI.blur = false; UI.ringOn = true;
  applyScenario(shot.scen);
  UI.cam = 'planet'; UI.color = 4; UI.field = 0;
  const spec = currentSpec();
  if (shot.spec) Object.assign(spec, shot.spec);
  sv.speed = 100;
  sv.state = 'warm'; sv.warmAt = performance.now();
  sv.spin = (sv.rnd() < 0.5 ? -1 : 1) * (shot.cam.spin || 0.6) * (1 - 0.5 * sv.calm) * Math.PI / 180;
  sv.backlit = !!shot.cam.backlit;
  sv.hold = shot.hold * (1 + 0.3 * sv.calm);
  sv.shotAt = performance.now(); sv.az = 0;
  startRun(spec);
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
    openPanel(null);
    let seed = (opts.seed >>> 0) || 1;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const calm = Math.max(Math.min(1, Math.max(0, opts.calm ?? 0.7)), RM_Q.matches ? 1 : 0);
    saver = { opts, rnd, calm, queue: [], cur: null, az: 0, spin: 0, hold: 40, shotAt: performance.now(), fade: 0, fadeTarget: 0, state: 'warm', speed: 100 };
    if (RM_Q.matches) UI.calm = true;
    UI.paused = false;
    resetCamStats();
    UI.N = Math.min(UI.N, 8192);
    resize();
    saverScenario();
    saver.tick = setInterval(() => {
      if (!saverOn) return;
      const sv = saver;
      if (sv.state === 'fadeout') { if (sv.fade <= 0.001) saverScenario(); return; }
      if (!run || run.phase !== 'orbit') return;
      if (sv.state === 'warm') {
        // the warm-up runs in the dark at full speed; then the view fades
        // in (at most 12 s of dark: a slow GPU fades in early)
        if (run.t / run.T0 < sv.cur.shot.warm(run) && performance.now() - sv.warmAt < 12000) { sv.speed = 100; sv.shotAt = performance.now(); return; }
        sv.speed = sv.cur.shot.speed * (sv.calm > 0.85 ? 0.75 : 1);
        cam.pose = null; sv.az = 0;
        sv.state = 'show'; sv.fadeTarget = 1; sv.shotAt = performance.now();
      }
      const until = sv.cur.shot.until;
      if ((until && until(run)) || (performance.now() - sv.shotAt) / 1000 > sv.hold) { sv.state = 'fadeout'; sv.fadeTarget = 0; return; }
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
  debug() { return saver ? { shot: saver.cur && saver.cur.shot.key, cam: saver.cur && saver.cur.cam, hold: saver.hold, state: saver.state, fade: saver.fade, camStats: Object.assign({}, camStats, { prev: undefined }), state2: debugState() } : null; },
};

boot().catch(e => fail(e));
