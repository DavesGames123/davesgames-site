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
import { Renderer, loadRenderCode } from './render.js';
import { SCENARIOS, REAL, STORY, specFor, flybyStart } from './scenarios.js';
import { drawGauge, drawBound, drawEnergy, drawRuns, MAT_COLOR } from './plots.js';
import { typesetAll } from '../../lib/sci-math.js';
import { cam, camStats, resetCamStats } from './app/camera.js';
import { cardArt } from './app/card-art.js';
import { drawFrame } from './app/draw.js';
import { $, QUALITY, Q, UI, PHONE_Q, G_SI, CALM_SPEED, COARSE, SNAP_CAP, RUNS_KEY, SPEED_STOPS, KM_SATURN, REF_SWEEP, SPEED_MIN, SPEED_MAX, N_OPTS, RM_Q } from './app/env.js';
import { workerJobs, workerCall } from './app/jobs.js';
import { drawLegend } from './app/legend.js';
import { buildSegments } from './app/lines.js';
import { satState } from './app/sat.js';
import { S, bootDone, pileCache, bootReady } from './app/state.js';

let gpuPending = false;
let lastT = performance.now();

// ── boot (called at the end of the module, after every const is set) ─────
async function boot() {
  buildUI();
  typesetAll(document).catch(() => {});
  if (!navigator.gpu) return fail(new Error('navigator.gpu is missing'));
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return fail(new Error('no GPU adapter'));
  // timestamp-query, when the adapter has it, is only used by profile()
  S.dev = await adapter.requestDevice({ requiredFeatures: adapter.features.has('timestamp-query') ? ['timestamp-query'] : [] });
  S.dev.lost.then(i => { if (i.reason !== 'destroyed') fail(new Error('GPU device lost: ' + i.message)); });
  S.dev.addEventListener('uncapturederror', e => { console.error('WebGPU:', e.error.message); });
  const canvas = $('gpu');
  S.ctx = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  S.ctx.configure({ device: S.dev, format, alphaMode: 'opaque' });
  const [sc, rc] = await Promise.all([loadSimCode(), loadRenderCode()]);
  S.simCode = sc;
  S.ren = new Renderer(S.dev, S.ctx, format, rc, { gridN: QUALITY[Q.preset].gridN });
  loadPlanetMap().catch(e => console.warn('planet map:', e.message));
  S.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  S.worker.onmessage = e => { const j = workerJobs.get(e.data.id); workerJobs.delete(e.data.id); if (j) j(e.data); };
  S.worker.onerror = e => console.error('worker:', e.message);
  resize(); window.addEventListener('resize', resize);
  window.__roche = { state: () => debugState(), ren: S.ren, cam, UI, camStats, resetCamStats, profile, restoreSnap, get run() { return S.run; }, fps: () => S.fps, gpuMs: () => S.gpuMs, cpuMs: () => S.cpuMs };
  requestAnimationFrame(frame);
  bootDone();
  if (!S.saverOn) await startRun();
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
  if (S.ren) S.ren.setPlanetTexture(levels);
  for (const b of levels) b.close();
}
function fail(e) {
  console.error(e);
  $('nogpu').classList.remove('off');
  $('nogpuWhy').textContent = String(e && e.message || e);
}
function resize() {
  if (!S.ren) return;
  const c = $('gpu');
  const dpr = Math.min(window.devicePixelRatio || 1, PHONE_Q.matches ? 1.5 : 2);
  let w = c.clientWidth * dpr, h = c.clientHeight * dpr;
  const maxPx = QUALITY[Q.preset].maxPx * Q.scale * Q.scale, k = Math.min(1, Math.sqrt(maxPx / (w * h)));
  w = Math.round(w * k); h = Math.round(h * k);
  c.width = w; c.height = h;
  S.ren.resize(w, h);
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
  const serial = ++S.runSerial;
  const spec = specIn || currentSpec();
  const sc = spec.scen || SCENARIOS.find(s => s.key === spec.key);
  if (S.run) { for (const s of S.run.sats) s.gpu.destroy(); S.ren.removeSims(); }
  const two = spec.kind === 'compare';
  // Auto quality: when the governor has already gone down to its floor
  // (60% render scale, no bloom), the next run takes half the grains
  if (UI.quality === 'auto' && Q.scale <= 0.65 && !Q.bloom && UI.N > 4096) { UI.N = UI.N / 2; $('nSel').value = UI.N; Q.note = 'fewer grains for speed'; }
  let N = UI.N;
  if (sc && sc.nScale) N = Math.max(4096, Math.round(N * sc.nScale / 1024) * 1024);
  if (S.saverOn) N = Math.min(N, 8192);
  const nEach = two ? Math.max(4096, N / 2) : N;
  const mats = two ? spec.materials : [spec.material];
  S.run = { serial, spec, sats: [], phase: 'init', t: 0, T0: 1, frames: 0, started: performance.now(), recorded: false, track: [],
    snaps: [], viewIdx: -1, epoch: 0, stepLeft: 0, rate: 0, story: { approach: 0 }, storyKey: 'approach' };
  for (let k = 0; k < mats.length; k++) {
    const mat = matFor(mats[k], spec, !two);
    const C = P.contactParams(nEach, mat);
    const gpu = new SimGPU(S.dev, nEach, S.simCode);
    const e = S.ren.addSim(gpu);
    S.run.sats.push({ idx: k, matName: mats[k], mat, C, gpu, e, N: nEach, color: MAT_COLOR[mats[k]] || '#d8dfe8', hist: [], ehist: [], an: null, E0: null, L0: null, frag: [], phase: two ? k * Math.PI : 0 });
  }
  setBusy(true, 'Building the moon', 0);
  syncStory(true);
  // the cloud or the cached pile
  for (const s of S.run.sats) {
    const key = `${s.N}|${s.matName}|${s.mat.mu}|${s.mat.coh}`;
    s.cacheKey = key;
    if (pileCache.has(key)) { s.pile = pileCache.get(key); continue; }
    const cl = await workerCall({ type: 'cloud', N: s.N, seed: 3 + s.idx });
    if (serial !== S.runSerial) return;
    s.cloud = cl;
  }
  if (serial !== S.runSerial) return;
  // planet (R_p from the expected pile radius, so the scale does not jump)
  for (const s of S.run.sats) { s.Rp = s.C.Rs / spec.s; s.k = 1 / s.Rp; }
  // settle each moon that has no cached pile
  for (const s of S.run.sats) {
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
  S.run.limits = limitsFor(spec);
  S.run.viewD = viewDistance(spec, S.run.limits);
  if (S.run.sats.every(s => s.pile)) await placeSats(serial);
  else if (serial === S.runSerial) S.run.phase = 'settle';
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
  const spec = S.run.spec;
  for (const s of S.run.sats) {
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
  const enc = S.dev.createCommandEncoder();
  for (const s of S.run.sats) {
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
  S.dev.queue.submit([enc.finish()]);
  setBusy(true, 'Letting the rubble settle under its own gravity', total ? done / total : 1);
  return all;
}
async function placeSats(serial) {
  S.run.phase = 'placing';
  for (const s of S.run.sats) {
    if (!s.pile) {
      const rb = await s.gpu.readback();
      if (serial !== S.runSerial) return;
      const N = s.N, pos = new Float64Array(N * 3);
      for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) pos[3 * i + k] = rb.body[12 * i + k];
      const st = P.pileStats(pos, s.mass);
      for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) pos[3 * i + k] -= st.com[k];
      s.pile = { pos, st: P.pileStats(pos, s.mass), rad: Float64Array.from(s.rad), mass: Float64Array.from(s.mass) };
      pileCache.set(s.cacheKey, s.pile);
    }
  }
  prepareOrbit();
  for (const s of S.run.sats) {
    const N = s.N, pos = Float64Array.from(s.pile.pos), vel = new Float64Array(N * 3), spin = new Float64Array(N * 3);
    s.rad = s.pile.rad; s.mass = s.pile.mass; s.M0 = s.pile.st.M; s.Rs = s.pile.st.R;
    P.placeOnOrbit(pos, vel, spin, s.mass, s.o.Omega);
    s.gpu.setParams(s.C, s.pl, 0);
    s.gpu.ref = s.ref; s.gpu.t = 0;
    s.gpu.setState(pos, vel, spin, s.rad, s.mass);
    s.gpu.prime();
    S.ren.setTags(s.e, new Float32Array(s.gpu.np).fill(1));
    s.e.fresh = true;
    s.hist = [[0, 1]]; s.ehist = []; s.an = null; s.E0 = null; s.L0 = null; s.frag = [];
  }
  const s0 = S.run.sats[0], spec = S.run.spec;
  // the time unit: one orbit (circular, spiral: the start orbit) or the
  // period of a circular orbit at the pericentre (flyby)
  const a0 = spec.kind === 'flyby' ? spec.peri * s0.Rp : spec.d * s0.Rp;
  S.run.T0 = P.orbitalPeriod(s0.pl.GM, a0);
  if (spec.kind === 'spiral') {
    const d0 = spec.d, d1 = spec.d1, Tm = P.orbitalPeriod(s0.pl.GM, Math.sqrt(d0 * d1) * s0.Rp);
    const kappa = Math.log(d0 / d1) / (2 * spec.orbits * Tm);
    for (const s of S.run.sats) { s.pl.drag = kappa; s.gpu.setParams(s.C, s.pl, 0); }
  }
  if (spec.kind === 'flyby') {
    // time from the start to the pericentre, by the Kepler equation
    const el = P.keplerElements(s0.o.X, s0.o.V, s0.pl.GM);
    S.run.tPeri = timeToPeri(s0.o.X, s0.o.V, s0.pl.GM, el);
  }
  const rhoReal = spec.rhoS || 1.0;
  S.run.tUnitSec = Math.sqrt(s0.pile.st.rho / (G_SI * rhoReal * 1000));
  S.run.heatRef = 0.006 * s0.C.vesc * s0.C.vesc;
  S.run.phase = 'orbit'; S.run.t = 0; S.run.recorded = false; S.run.track = [];
  S.run.lastRead = 0;
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
export function limitsFor(spec) {
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
  const tCpu = performance.now();
  try { frameBody(now); } finally { S.cpuMs = 0.9 * S.cpuMs + 0.1 * (performance.now() - tCpu); }
}
// The speed in orbits per minute of wall time. Reduce motion caps it at
// Normal; the screensaver sets its own.
export function orbitsPerMin() {
  if (S.saverOn && S.saver) return S.saver.speed;
  return Math.pow(10, UI.calm ? Math.min(UI.speedLog, CALM_SPEED) : UI.speedLog);
}
function allFree() { return S.run.sats.every(s => !s.gpu.busy && !s.waiting); }
function frameBody(now) {
  const dtReal = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  S.fps = 0.95 * S.fps + 0.05 / Math.max(dtReal, 1e-3);
  if (!S.run || !S.ren || S.run.phase === 'init' || S.run.phase === 'placing' || S.profiling) return;
  const cssW = $('gpu').clientWidth, cssH = $('gpu').clientHeight;
  if (cssW < 2 || cssH < 2) return;
  let steps = 0;
  if (S.run.phase === 'settle') {
    if (settleStep(Math.max(2, Math.min(S.saverOn ? 24 : 12, Math.floor(S.stepsMax / 32))))) { S.run.phase = 'placing'; placeSats(S.run.serial); }
  } else if (S.run.phase === 'orbit') {
    if (S.run.pendingRestore !== undefined && S.run.pendingRestore !== null && allFree()) { const i = S.run.pendingRestore; S.run.pendingRestore = null; restoreSnap(i); }
    const s0 = S.run.sats[0];
    // the spiral ends at d1: the drag stops there
    if (S.run.spec.kind === 'spiral') for (const s of S.run.sats) if (s.pl.drag > 0 && Math.hypot(...s.ref.X) < S.run.spec.d1 * s.Rp) { s.pl.drag = 0; s.gpu.setParams(s.C, s.pl, 0); }
    const playing = !UI.paused && !S.run.scrubbing;
    if (playing) {
      // steps this frame: the speed in steps, carried over frames, capped
      // by the GPU budget; part blocks are fine (engine.js encodeSteps)
      const want = orbitsPerMin() / 60 * S.run.T0 / s0.C.dt * dtReal;
      S.warpCarry += want;
      steps = Math.min(Math.floor(S.warpCarry), S.stepsMax);
      S.warpCarry = Math.min(S.warpCarry - steps, 1);
      S.run.rate = 0.9 * S.run.rate + 0.1 * (steps / Math.max(dtReal, 1e-3));
    } else if (S.run.stepLeft > 0) {
      steps = Math.min(S.run.stepLeft, S.stepsMax);
      S.run.stepLeft -= steps;
      if (S.run.stepLeft <= 0) S.run.forceRead = true;
    }
    // a readback once a second while it plays; the O(N^2) potential
    // (energy) every second one
    const due = allFree() && (playing ? now - (S.run.lastRead || 0) > 1000 : (S.run.forceRead || now - (S.run.lastRead || 0) > 2000));
    if (steps > 0) {
      const enc = S.dev.createCommandEncoder();
      for (const s of S.run.sats) s.gpu.encodeSteps(enc, steps, due);
      S.dev.queue.submit([enc.finish()]);
      S.run.t = s0.gpu.t;
    }
    if (due && !S.run.scrubbing) { S.run.lastRead = now; S.run.forceRead = false; S.run.reads = (S.run.reads || 0) + 1; readAll(!playing || S.run.reads % 2 === 1); }
  }
  // GPU time of the whole frame (sim + draw)
  const tSub = performance.now();
  drawFrame(now, cssW, cssH, steps);
  if (!gpuPending) {
    gpuPending = true;
    S.dev.queue.onSubmittedWorkDone().then(() => {
      const ms = performance.now() - tSub;
      S.gpuMs = 0.8 * S.gpuMs + 0.2 * ms; gpuPending = false;
      const target = Math.max(8, Math.ceil(stepsWanted() * 1.25));
      if (S.gpuMs > 14 && S.stepsMax > 8) S.stepsMax = Math.max(8, Math.floor(S.stepsMax * 0.8));
      else if (S.gpuMs < 9 && S.stepsMax < target) S.stepsMax += 8;
      else if (S.stepsMax > target) S.stepsMax = target;
    });
  }
  governQuality(now);
  S.run.frames++;
  if (S.run.frames % 10 === 0) refreshReadout(false);
  if (UI.showFps && S.run.frames % 20 === 0) $('fpsChip').textContent = `${S.fps.toFixed(0)} fps · GPU ${S.gpuMs.toFixed(1)} ms · CPU ${S.cpuMs.toFixed(1)} ms · ${(S.ren.W * S.ren.H / 1e6).toFixed(1)} MP · ${Q.preset}${Q.bloom ? '' : ', no bloom'} · ${S.stepsMax} steps max`;
}
// steps per frame the speed asks for, at 60 fps
function stepsWanted() {
  if (!S.run || !S.run.sats.length || !S.run.T0) return 64;
  return orbitsPerMin() / 60 * S.run.T0 / S.run.sats[0].C.dt / 60;
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
  if (UI.quality !== 'auto' || now < Q.cool || S.saverOn && S.saver && S.saver.fade < 0.5) return;
  const slow = f < 52 || S.gpuMs > 15, good = f >= 59 && S.gpuMs < 9;
  w.good = good ? w.good + 1 : 0;
  if (slow) {
    if (Q.scale > 0.65) { Q.scale = Math.round((Q.scale - 0.1) * 10) / 10; resize(); }
    else if (Q.bloom) Q.bloom = false;
    else S.stepsMax = Math.max(8, S.stepsMax >> 1);
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
  const serial = S.run.serial, epoch = S.run.epoch;
  const parts = await Promise.all(S.run.sats.map(s => readAndAnalyze(s, potential, epoch)));
  if (serial !== S.runSerial || epoch !== S.run.epoch || parts.some(p => !p)) return;
  updatePhase(parts[0].t);
  const t = parts[0].t, last = S.run.snaps[S.run.snaps.length - 1];
  if (last && t <= last.t + 1e-9) return;
  S.run.snaps.push({ t, sats: parts, story: Object.assign({}, S.run.story) });
  if (S.run.snaps.length > SNAP_CAP) {
    // drop the record whose neighbours are closest in time
    let best = 1, gap = Infinity;
    for (let i = 1; i < S.run.snaps.length - 1; i++) { const g = S.run.snaps[i + 1].t - S.run.snaps[i - 1].t; if (g < gap) { gap = g; best = i; } }
    S.run.snaps.splice(best, 1);
  }
  S.run.viewIdx = S.run.snaps.length - 1;
  syncScrub();
}
async function readAndAnalyze(s, potential, epoch) {
  const serial = S.run.serial;
  s.waiting = true;
  const rb = await s.gpu.readback(potential);
  if (!rb) { s.waiting = false; return null; }
  if (serial !== S.runSerial) return null;
  // the compact copy for the history: position, velocity, spin
  const N = s.N, st = new Float32Array(N * 9), b = rb.body;
  for (let i = 0; i < N; i++) {
    const o = 12 * i, q = 9 * i;
    st[q] = b[o]; st[q + 1] = b[o + 1]; st[q + 2] = b[o + 2];
    st[q + 3] = b[o + 4]; st[q + 4] = b[o + 5]; st[q + 5] = b[o + 6];
    st[q + 6] = b[o + 8]; st[q + 7] = b[o + 9]; st[q + 8] = b[o + 10];
  }
  const res = await workerCall({ type: 'analyze', N: s.N, np: s.gpu.np, body: rb.body, grav: rb.grav, rad: s.rad, X: rb.X, V: rb.V, GMp: s.pl.GM, t: rb.t, fragCount: 24, seed: S.run.frames }, [rb.body.buffer, rb.grav.buffer]);
  s.waiting = false;
  if (serial !== S.runSerial || epoch !== S.run.epoch) return null;
  onAnalysis(s, res, rb);
  return { t: rb.t, X: rb.X, V: rb.V, W: rb.W, Llost: rb.Llost, drag: s.pl.drag, st, tags: res.tags, an: s.an, E0: s.E0, Us0: s.Us0, L0: s.L0 };
}
function onAnalysis(s, a, rb) {
  S.ren.setTags(s.e, a.tags);
  const T0 = S.run.T0, tt = a.t / T0;
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
  if (!S.run.recorded && tt >= 3 && (S.run.spec.kind === 'circular' || S.run.spec.kind === 'compare' || S.run.spec.kind === 'real')) {
    if (s.idx === S.run.sats.length - 1) S.run.recorded = true;
    addRunPoint({ x: S.run.spec.d / Math.cbrt(S.run.spec.q), y: f, mat: s.matName });
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
  if (!S.run || S.run.phase !== 'orbit' || !S.run.snaps.length) return;
  i = Math.max(0, Math.min(S.run.snaps.length - 1, i | 0));
  if (!allFree()) { S.run.pendingRestore = i; return; }
  const rec = S.run.snaps[i];
  S.run.epoch++;
  S.run.sats.forEach((s, k) => {
    const sn = rec.sats[k], N = s.N;
    const pos = new Float64Array(N * 3), vel = new Float64Array(N * 3), spin = new Float64Array(N * 3);
    for (let j = 0; j < N; j++) for (let c = 0; c < 3; c++) { pos[3 * j + c] = sn.st[9 * j + c]; vel[3 * j + c] = sn.st[9 * j + 3 + c]; spin[3 * j + c] = sn.st[9 * j + 6 + c]; }
    s.ref.X = sn.X.slice(); s.ref.V = sn.V.slice(); s.ref.t = sn.t;
    s.pl.drag = sn.drag;
    s.gpu.setParams(s.C, s.pl, 0);
    s.gpu.setState(pos, vel, spin, s.rad, s.mass);
    s.gpu.t = sn.t; s.gpu.W = sn.W; s.gpu.Llost = sn.Llost.slice();
    s.gpu.prime();
    S.ren.setTags(s.e, sn.tags); s.e.fresh = true;
    s.an = sn.an; s.E0 = sn.E0; s.Us0 = sn.Us0; s.L0 = sn.L0;
  });
  S.run.t = rec.t; S.run.viewIdx = i; S.run.track = []; S.warpCarry = 0; S.run.stepLeft = 0;
  S.run.story = Object.assign({}, rec.story);
  S.run.storyKey = storyKeyAt(S.run.story);
  syncScrub(); syncStory(); refreshReadout(true);
}
// Play or step after a scrub: the records after the current one, and the
// plot points after its time, are gone.
function truncateHistory() {
  if (!S.run || S.run.viewIdx < 0 || S.run.viewIdx >= S.run.snaps.length - 1) return;
  S.run.snaps.length = S.run.viewIdx + 1;
  const tt = S.run.t / S.run.T0;
  for (const s of S.run.sats) { s.hist = s.hist.filter(p => p[0] <= tt + 1e-9); s.ehist = s.ehist.filter(p => p[0] <= tt + 1e-9); }
  syncScrub();
}

// ── story phases ──────────────────────────────────────────────────────────
// Called after each read of all moons (sat 0 decides). Times are in sim
// time; run.story holds the start time of each phase reached.
function updatePhase(t) {
  const s = S.run.sats[0], st = S.run.story, L = S.run.limits;
  if (!s.an) return;
  const d = Math.hypot(...satState(s).r) / s.Rp;
  if (st.cross === undefined && (d < L.fluid)) st.cross = t;
  if (st.cross !== undefined && st.torn === undefined && s.an.f < 0.75) st.torn = t;
  if (st.torn !== undefined && st.ring === undefined && t - st.torn > (s.an.f < 0.25 ? 0.75 : 1.5) * S.run.T0) st.ring = t;
  const k = storyKeyAt(st);
  if (k !== S.run.storyKey) { S.run.storyKey = k; syncStory(); }
}
function storyKeyAt(st) { return st.ring !== undefined ? 'ring' : st.torn !== undefined ? 'torn' : st.cross !== undefined ? 'cross' : 'approach'; }
function storyText(key) {
  const spec = S.run.spec, Pn = spec.planetName || 'the planet';
  const subj = spec.kind === 'flyby' ? 'comet' : 'moon';
  let tx = STORY.find(x => x.key === key).text;
  if (key === 'approach') {
    if (spec.kind === 'flyby') tx = 'A loose comet falls toward {P}.';
    else if (spec.kind === 'compare') tx = 'Two moons circle {P}: one loose, one rough.';
    else if (spec.kind !== 'spiral') tx = `The ${subj} circles {P}, outside its Roche limit: the tide only stretches it a little.`;
    else if (spec.key !== 'saturn') tx = 'A moon spirals toward {P}, pulled in by a drag.';
  } else if (key === 'cross' && spec.kind !== 'spiral' && S.run.story.cross < 0.05 * S.run.T0) tx = `The ${subj} starts inside the Roche limit: {P}’s tide beats its own gravity.`;
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
  if (!S.run) return;
  const order = STORY.map(x => x.key), cur = order.indexOf(S.run.storyKey);
  for (const b of box.children) {
    const i = order.indexOf(b.dataset.p), reached = S.run.story[b.dataset.p] !== undefined || i === 0;
    b.classList.toggle('now', i === cur); b.classList.toggle('done', i < cur); b.disabled = !reached;
    b.title = reached ? 'Go back to: ' + b.textContent : 'Not reached yet';
  }
  $('caption').textContent = S.run.phase === 'orbit' || S.run.phase === 'placing' ? storyText(S.run.storyKey) : 'Building the moon from thousands of grains…';
}
// Jump to the first record at or after the start of a phase.
function seekPhase(key) {
  if (!S.run || S.run.phase !== 'orbit') return;
  const t0 = S.run.story[key] ?? (key === 'approach' ? 0 : undefined);
  if (t0 === undefined || !S.run.snaps.length) return;
  let i = S.run.snaps.findIndex(r => r.t >= t0 - 1e-9);
  if (i < 0) i = S.run.snaps.length - 1;
  setPaused(true);
  restoreSnap(i);
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
  if (!S.run || !S.run.sats.length) return;
  const s = S.run.sats[0], spec = S.run.spec, L = S.run.limits || limitsFor(spec);
  if (!s.ref) return;
  const st = satState(s);
  const dNow = Math.hypot(...st.r) / s.Rp;
  const tt = S.run.t / S.run.T0;
  const orbit = S.run.phase === 'orbit';
  // clock: hours and orbits
  const secs = S.run.tUnitSec ? S.run.t * S.run.tUnitSec : 0;
  const unitsNote = spec.unitsNote ? ' (for a Saturn-size planet)' : '';
  $('clock').textContent = orbit ? `${fmtTime(secs)} · ${tt.toFixed(2)} orbits` : '';
  $('clock').title = orbit ? `Time since the start${unitsNote}; one orbit is the start orbit (${fmtTime(S.run.T0 * S.run.tUnitSec)}).` : '';
  // the speed label: what it asks for and what the GPU gives
  const opm = orbitsPerMin();
  const got = S.run.rate > 0 && orbit && !UI.paused ? S.run.rate * s.C.dt / S.run.T0 * 60 : opm;
  const slow = orbit && !UI.paused && got < 0.8 * opm;
  $('speedV').textContent = `${opm < 1 ? opm.toFixed(2) : opm.toFixed(opm < 10 ? 1 : 0)} orbits/min${slow ? ` (GPU: ${got.toFixed(1)})` : ''}`;
  $('speedV').title = S.run.tUnitSec ? `1 s on screen = ${fmtTime(opm / 60 * S.run.T0 * S.run.tUnitSec)} at ${planetName(spec)}` : '';
  $('dockSpeedV').textContent = SPEED_STOPS.reduce((b, x) => Math.abs(x.v - UI.speedLog) < Math.abs(b.v - UI.speedLog) ? x : b).name;
  // distance bar: from the surface (1) to a little past the start
  const maxD = Math.max(S.run.viewD * 1.15, L.fluid * 1.3);
  const x = v => Math.max(0, Math.min(100, (v - 1) / (maxD - 1) * 100));
  $('distTitle').textContent = `Distance from ${planetName(spec)}`;
  document.querySelector('#distBar .zone.in').style.width = x(L.fluid) + '%';
  document.querySelector('#distBar .zone.out').style.left = x(L.fluid) + '%';
  $('distLim').style.left = x(L.fluid) + '%';
  $('distMark').style.left = x(dNow) + '%';
  // one-piece share
  const fs = S.run.sats.map(q => q.an ? q.an.f : 1);
  $('pieceV').textContent = S.run.sats.length > 1 ? fs.map((f, i) => `${S.run.sats[i].matName === 'rigid' ? 'rough' : 'loose'} ${Math.round(100 * f)}%`).join(' · ') : `${Math.round(100 * fs[0])}%`;
  $('pieceV').classList.toggle('two', S.run.sats.length > 1);
  drawSpark();
  // the live sentence
  const subj = spec.kind === 'flyby' ? 'The comet' : S.run.sats.length > 1 ? 'The moons' : 'The moon';
  const Pn = planetName(spec), km = dNow * (spec.Rkm || KM_SATURN);
  let sent;
  if (!orbit) sent = 'Building the moon: thousands of grains settle together under their own gravity.';
  else if (fs[0] < 0.25 && S.run.sats.length === 1 && S.run.storyKey === 'ring') sent = `${subj} is gone: its pieces now circle ${Pn}${spec.kind === 'flyby' ? ' in a stream' : ' as a ring'}.`;
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
  const tNow = S.run.t / S.run.T0, tMax = Math.max(1, tNow * 1.1);
  g.strokeStyle = 'rgba(160,180,210,0.18)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, h - 1); g.lineTo(w, h - 1); g.moveTo(0, 2); g.lineTo(w, 2); g.stroke();
  for (const s of S.run.sats) {
    g.strokeStyle = S.run.sats.length > 1 ? s.color : '#ffb46a'; g.lineWidth = 1.6; g.beginPath();
    let first = true;
    for (const [t, f] of s.hist) { if (t > tNow + 1e-9) break; const X = t / tMax * w, Y = 2 + (1 - f) * (h - 4); if (first) { g.moveTo(X, Y); first = false; } else g.lineTo(X, Y); }
    g.stroke();
  }
}
function refreshDetails(dNow, tt, L) {
  const s = S.run.sats[0], spec = S.run.spec;
  const tStr = spec.kind === 'flyby' && S.run.tPeri !== undefined ? `${(S.run.t - S.run.tPeri) / S.run.T0 >= 0 ? '+' : '−'}${Math.abs((S.run.t - S.run.tPeri) / S.run.T0).toFixed(2)} from the closest pass` : `${tt.toFixed(2)} orbits`;
  $('rdT').textContent = `${tStr} · ${fmtTime(S.run.t * (S.run.tUnitSec || 0))}`;
  $('rdD').textContent = dNow.toFixed(3);
  $('rdDr').textContent = (dNow / L.rigid).toFixed(3);
  $('rdDf').textContent = (dNow / L.fluid).toFixed(3);
  const bnd = S.run.sats.map(x => x.an ? (100 * x.an.f).toFixed(1) + '%' : '—').join(' · ');
  $('rdB').textContent = bnd;
  $('rdG').textContent = s.an ? String(s.an.groups) : '—';
  $('rdH').textContent = s.an && s.an.live && Number.isFinite(s.an.rH) ? (s.an.rH / (s.Rs * Math.cbrt(s.an.f))).toFixed(2) : '—';
  $('rdRho').textContent = s.pile ? `${s.pile.st.rho.toFixed(3)} (packing ${(s.pile.st.rho / P.RHO_GRAIN).toFixed(2)})` : '—';
  $('rdE').textContent = s.an && Number.isFinite(s.an.drift) ? s.an.drift.toExponential(1) + ' |U_s|' : (s.pl && s.pl.drag ? 'drag on: not tracked' : '—');
  $('rdL').textContent = s.an && Number.isFinite(s.an.Ldrift) && !(s.pl && s.pl.drag) ? s.an.Ldrift.toExponential(1) : '—';
  $('rdAcc').textContent = s.an ? String(s.an.accreted) : '—';
  $('rdDt').textContent = `${s.C.dt.toExponential(2)} (${Math.round(S.run.T0 / s.C.dt).toLocaleString()} per orbit)`;
  $('rdGpu').textContent = `${S.gpuMs.toFixed(1)} ms · ${S.stepsMax} steps max · ${S.fps.toFixed(0)} fps · ${(S.ren.W * S.ren.H / 1e6).toFixed(1)} MP`;
  // gauge: a_tide / g at the surface = 2 (rho_p/rho_s) (R_p/d)^3
  const ratio = 2 * spec.q * Math.pow(1 / dNow, 3);
  drawGauge($('gaugeC'), ratio);
  $('gaugeV').textContent = ratio.toFixed(2);
  const tMax = Math.max(1, Math.ceil(Math.max(tt, 0.5) * 1.15));
  const tu = spec.kind === 'flyby' ? 'T_q' : 'orbits';
  drawBound($('boundC'), S.run.sats.map(x => ({ pts: x.hist, color: x.color })), tMax, tu);
  $('boundV').textContent = bnd;
  drawEnergy($('energyC'), S.run.sats.map(x => ({ pts: x.ehist, color: x.color })), tMax, tu);
  $('energyV').textContent = s.an && Number.isFinite(s.an.drift) ? s.an.drift.toExponential(1) : '—';
  const xCur = (spec.kind === 'flyby' ? spec.peri : dNow) / Math.cbrt(spec.q);
  drawRuns($('runsC'), loadRuns(), REF_SWEEP, xCur);
  $('runsV').textContent = `x = ${xCur.toFixed(2)}`;
}

// ── UI ────────────────────────────────────────────────────────────────────
function setPaused(p) {
  if (!p && UI.paused && S.run) truncateHistory();
  UI.paused = p;
  if (S.run) S.run.scrubbing = false;
  syncPlayButtons();
}
function syncPlayButtons() {
  const p = UI.paused;
  for (const id of ['playBtn', 'dockPlay']) { const b = $(id); b.textContent = p ? '▶' : '❚❚'; b.setAttribute('aria-label', p ? 'Play' : 'Pause'); b.classList.toggle('on', p); }
  $('playBtn').title = p ? 'Play (Space)' : 'Pause (Space)';
  document.body.classList.toggle('paused', p);
}
function stepBy(frac) {
  if (!S.run || S.run.phase !== 'orbit') return;
  if (!UI.paused) setPaused(true);
  truncateHistory();
  S.run.stepLeft += Math.max(1, Math.round(frac * S.run.T0 / S.run.sats[0].C.dt));
}
function setSpeed(v) {
  UI.speedLog = Math.max(SPEED_MIN, Math.min(SPEED_MAX, v));
  $('speed').value = UI.speedLog;
  S.stepsMax = Math.max(S.stepsMax, 8);
  for (const b of $('stops').querySelectorAll('button')) b.classList.toggle('on', Math.abs(+b.dataset.s - UI.speedLog) < 0.02);
  refreshReadout(false);
}
function syncScrub() {
  const sc = $('scrub'), n = S.run ? S.run.snaps.length : 0;
  sc.max = Math.max(0, n - 1); sc.disabled = n < 2;
  if (!S.run || !S.run.scrubbing) sc.value = S.run && S.run.viewIdx >= 0 ? S.run.viewIdx : 0;
  const live = !S.run || S.run.viewIdx >= n - 1;
  $('scrubInfo').textContent = n < 2 ? 'history fills as it runs' : live ? (UI.paused ? 'paused' : 'live') : `back in time: ${fmtTime(S.run.snaps[S.run.viewIdx].t * S.run.tUnitSec)} · press play to go on from here`;
  $('story').classList.toggle('past', !live);
}
// open one panel (drawer, popover, modal); null closes them all
const PANELS = ['gallery', 'display', 'advanced', 'details', 'explain', 'moreMenu'];
function openPanel(id) {
  for (const p of PANELS) { const el = $(p), on = p === id && el.classList.contains('off'); el.classList.toggle('off', !on); }
  for (const [b, p] of [['scenBtn', 'gallery'], ['dispBtn', 'display'], ['advBtn', 'advanced'], ['detBtn', 'details'], ['helpBtn', 'explain'], ['dockDisp', 'display'], ['dockMore', 'moreMenu']]) $(b).classList.toggle('on', !$(p).classList.contains('off'));
  document.body.classList.toggle('drawer-open', !$('advanced').classList.contains('off') || !$('details').classList.contains('off'));
  if (id === 'details' && S.run) refreshReadout(true);
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
    if (!S.run || S.run.phase !== 'orbit') return;
    if (!UI.paused) setPaused(true);
    S.run.scrubbing = true;
    const i = +sc.value;
    if (allFree()) restoreSnap(i); else S.run.pendingRestore = i;
  });
  sc.addEventListener('change', () => { if (S.run) S.run.scrubbing = false; syncScrub(); });
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

// Per-stage GPU time (ms, median of n): each stage is submitted alone and
// timed to its completion on the queue (onSubmittedWorkDone). The frame
// loop stops while it runs. Stages: sim blocks (1 and 4), the gravity sum
// alone, a readback, the worker analysis, then the render stages and each
// scene draw alone.
async function profile(n = 7) {
  S.profiling = true;
  await new Promise(r => setTimeout(r, 100));
  const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
  const q = S.dev.queue, s = S.run.sats[0], g = s.gpu, out = {};
  const time = async fn => { await q.onSubmittedWorkDone(); const t0 = performance.now(); await fn(); await q.onSubmittedWorkDone(); return performance.now() - t0; };
  const rep = async (name, fn) => { const a = []; for (let i = 0; i < n; i++) a.push(await time(fn)); out[name] = +med(a).toFixed(2); };
  const steps = Math.max(1, Math.round(stepsWanted()));
  await rep('sim 1 block', () => { const e = S.dev.createCommandEncoder(); for (const x of S.run.sats) x.gpu.encode(e, 1, false); q.submit([e.finish()]); });
  await rep(`sim ${steps} steps (one frame at this speed)`, () => { const e = S.dev.createCommandEncoder(); for (const x of S.run.sats) x.gpu.encodeSteps(e, steps, false); q.submit([e.finish()]); });
  await rep('gravity sum', () => { const e = S.dev.createCommandEncoder(); const p = e.beginComputePass(); for (const x of S.run.sats) x.gpu._dispatch(p, 'gravity', x.gpu.bg.gravity, null, x.gpu.np); p.end(); q.submit([e.finish()]); });
  await rep('readback', async () => { await g.readback(); });
  { const a = []; for (let i = 0; i < 3; i++) { const rb = await g.readback(); const t0 = performance.now(); await workerCall({ type: 'analyze', N: s.N, np: g.np, body: rb.body, grav: rb.grav, rad: s.rad, X: rb.X, V: rb.V, GMp: s.pl.GM, t: rb.t, fragCount: 24 }, [rb.body.buffer, rb.grav.buffer]); a.push(performance.now() - t0); } out['analysis (worker, CPU)'] = +med(a).toFixed(2); }
  S.run.t = S.run.sats[0].gpu.t;
  const { frame, sims } = S.run.lastFrame;
  if (S.dev.features.has('timestamp-query')) {
    // GPU timestamps: the sim steps of one frame at this speed, then each
    // render stage, all in one submit
    const runs = [];
    for (let i = 0; i < n; i++) runs.push(await S.ren.renderGPU(frame, sims, null, enc => {
      for (const x of S.run.sats) { x.gpu.tw = () => S.ren._tw('sim ' + steps + ' steps'); x.gpu.encodeSteps(enc, steps, false); x.gpu.tw = null; }
    }));
    for (const k of Object.keys(runs[0])) out['GPU ' + k] = +med(runs.map(x => x[k] || 0)).toFixed(3);
    out['GPU frame at this speed'] = +med(runs.map(x => Object.values(x).reduce((a, v) => a + v, 0))).toFixed(3);
    for (const d of ['sky', 'surface', 'part', 'disk', 'field', 'lines', 'atmo']) {
      const a = []; for (let i = 0; i < n; i++) a.push((await S.ren.renderGPU(frame, sims, { [d]: true })).scene);
      out['GPU scene: ' + d + ' alone'] = +med(a).toFixed(3);
    }
  }
  const st = []; for (let i = 0; i < n; i++) st.push(await S.ren.renderTimed(frame, sims));
  for (const k of Object.keys(st[0])) out['render ' + k] = +med(st.map(x => x[k])).toFixed(2);
  for (const d of ['sky', 'surface', 'part', 'disk', 'field', 'lines', 'atmo']) {
    const a = []; for (let i = 0; i < n; i++) a.push((await S.ren.renderTimed(frame, sims, { [d]: true })).scene);
    out['scene: ' + d + ' alone'] = +med(a).toFixed(2);
  }
  { const a = []; for (let i = 0; i < n; i++) a.push((await S.ren.renderTimed(frame, sims, {})).scene); out['scene: empty pass'] = +med(a).toFixed(2); }
  { const t0 = performance.now(); for (let i = 0; i < 20; i++) buildSegments(S.ren.W / $('gpu').clientWidth); out['CPU buildSegments'] = +((performance.now() - t0) / 20).toFixed(2); }
  { const t0 = performance.now(); for (let i = 0; i < 10; i++) refreshReadout(false); out['CPU readouts'] = +((performance.now() - t0) / 10).toFixed(2); }
  out.canvas = `${S.ren.W}x${S.ren.H}`; out.N = S.run.sats.map(x => x.N).join('+'); out.field = UI.field; out['steps per frame'] = steps;
  S.profiling = false;
  return out;
}

function debugState() {
  if (!S.run) return null;
  return {
    phase: S.run.phase, scen: UI.scen, story: S.run.storyKey, storyT: Object.fromEntries(Object.entries(S.run.story).map(([k, v]) => [k, +(v / S.run.T0).toFixed(3)])),
    quality: { preset: Q.preset, scale: Q.scale, bloom: Q.bloom, stepsMax: S.stepsMax, px: S.ren.W * S.ren.H }, cam: Object.assign({}, camStats, { prev: undefined }), calm: UI.calm,
    orbitsPerMin: orbitsPerMin(), gotOrbitsPerMin: S.run.sats[0] ? S.run.rate * S.run.sats[0].C.dt / S.run.T0 * 60 : 0, paused: UI.paused,
    t: S.run.t, T0: S.run.T0, orbits: S.run.t / S.run.T0, hours: S.run.t * (S.run.tUnitSec || 0) / 3600, snaps: S.run.snaps.length, viewIdx: S.run.viewIdx, wallS: (performance.now() - S.run.started) / 1000,
    gpuMs: S.gpuMs, cpuMs: S.cpuMs, stepsMax: S.stepsMax, fps: S.fps,
    sats: S.run.sats.filter(s => s.ref).map(s => ({ N: s.N, mat: s.matName, f: s.an && s.an.f, drift: s.an && s.an.drift, Ldrift: s.an && s.an.Ldrift, groups: s.an && s.an.groups, accreted: s.an && s.an.accreted, overflow: s.gpu.overflow, d: Math.hypot(...satState(s).r) / s.Rp, drag: s.pl.drag })),
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
const WGSL_EXTRACT = `// shaders/sim.wgsl · cs_forces: one contact
let Fn = max(0.0, P.kn * (-gap) - P.gnK * sm * vn);
F = Fn * n;
var ft = -P.kt * sp - P.gtK * sm * vt;
let cap = P.mu * (Fn + coh);
if (length(ft) > cap) { ft = ft * (cap / length(ft)); }
// then the tide, relative to the frame point X
td = tide(S.X, xi0);`;
export function saverCamera(g, dt) {
  const sh = S.saver.cur; if (!sh) return;
  const c = sh.cam;
  S.saver.az += dt * S.saver.spin;
  const prog = Math.min(1, (performance.now() - S.saver.shotAt) / (S.saver.hold * 1000));
  const ease = prog * prog * (3 - 2 * prog);
  g.az = (c.az ?? 0.9) + S.saver.az;
  g.el = c.elTo !== undefined ? c.el + (c.elTo - c.el) * ease : (c.el ?? g.el);
  const z = c.zoomTo !== undefined ? c.zoom + (c.zoomTo - c.zoom) * ease : c.zoom * (1 - 0.06 * ease);
  g.dist = g.dist / (cam.zoom || 1) * z;
}
function saverLabel() {
  if (!S.saver || !S.saver.opts.label || !S.run || S.run.phase !== 'orbit' || !S.run.sats[0].ref) return;
  const s = S.run.sats[0], L = S.run.limits || limitsFor(S.run.spec);
  const st = satState(s), dNow = Math.hypot(...st.r) / s.Rp;
  const bnd = S.run.sats.map(x => x.an ? (100 * x.an.f).toFixed(0) + '%' : '100%').join(' / ');
  S.saver.opts.label({
    title: 'Roche limit', sub: S.saver.cur ? S.saver.cur.title : '',
    params: [
      { sym: 'd/R_p', name: 'distance', value: dNow.toFixed(2), cls: 'm5' },
      { sym: 'd_\\mathrm{fluid}', name: 'Roche limit', value: L.fluid.toFixed(2) + ' R_p', cls: 'm1' },
      { sym: 'f_b', name: 'in one piece', value: bnd, cls: 'm3' },
    ],
    tex: ['d_\\mathrm{fluid} \\approx 2.44\\,R_p\\left(\\rho_p/\\rho_s\\right)^{1/3}'],
    rules: [['d_\\mathrm{fluid}', 'm1'], ['R_p', 'm5']],
    eq: ['d_fluid ≈ 2.44 R_p (ρ_p/ρ_s)^(1/3)'],
    lines: [storyText(S.run.storyKey), `${s.N.toLocaleString()} grains · self-gravity, contacts, tide on the GPU`],
    code: { lang: 'wgsl', name: 'sim.wgsl · cs_forces', text: WGSL_EXTRACT },
    anchor: () => {
      const cs = $('gpu');
      const q = S.ren.project([0, 0, 0], cs.clientWidth, cs.clientHeight);
      if (!q) return null;
      return { x: q.x, y: q.y, r: Math.max(8, S.ren.focal / q.w / (S.ren.H / cs.clientHeight)) };
    },
  });
}
function saverScenario() {
  const sv = S.saver;
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
export function saverFade(dt) {
  const sv = S.saver; if (!sv) return 1;
  const rate = sv.fadeTarget > sv.fade ? 0.5 : 0.7;   // 2 s in, 1.4 s out
  sv.fade += Math.sign(sv.fadeTarget - sv.fade) * Math.min(Math.abs(sv.fadeTarget - sv.fade), rate * dt);
  return sv.fade;
}
window.snSaver = {
  async enter(opts) {
    S.saverOn = true;
    await bootReady;
    document.documentElement.classList.add('sn-saver');
    openPanel(null);
    let seed = (opts.seed >>> 0) || 1;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const calm = Math.max(Math.min(1, Math.max(0, opts.calm ?? 0.7)), RM_Q.matches ? 1 : 0);
    S.saver = { opts, rnd, calm, queue: [], cur: null, az: 0, spin: 0, hold: 40, shotAt: performance.now(), fade: 0, fadeTarget: 0, state: 'warm', speed: 100 };
    if (RM_Q.matches) UI.calm = true;
    UI.paused = false;
    resetCamStats();
    UI.N = Math.min(UI.N, 8192);
    resize();
    saverScenario();
    S.saver.tick = setInterval(() => {
      if (!S.saverOn) return;
      const sv = S.saver;
      if (sv.state === 'fadeout') { if (sv.fade <= 0.001) saverScenario(); return; }
      if (!S.run || S.run.phase !== 'orbit') return;
      if (sv.state === 'warm') {
        // the warm-up runs in the dark at full speed; then the view fades
        // in (at most 12 s of dark: a slow GPU fades in early)
        if (S.run.t / S.run.T0 < sv.cur.shot.warm(S.run) && performance.now() - sv.warmAt < 12000) { sv.speed = 100; sv.shotAt = performance.now(); return; }
        sv.speed = sv.cur.shot.speed * (sv.calm > 0.85 ? 0.75 : 1);
        cam.pose = null; sv.az = 0;
        sv.state = 'show'; sv.fadeTarget = 1; sv.shotAt = performance.now();
      }
      const until = sv.cur.shot.until;
      if ((until && until(S.run)) || (performance.now() - sv.shotAt) / 1000 > sv.hold) { sv.state = 'fadeout'; sv.fadeTarget = 0; return; }
      saverLabel();
    }, 500);
    return { canvas: $('gpu'), warmupMs: 2500 };
  },
  exit() {
    S.saverOn = false;
    if (S.saver) clearInterval(S.saver.tick);
    S.saver = null;
    document.documentElement.classList.remove('sn-saver');
    resize();
  },
  debug() { return S.saver ? { shot: S.saver.cur && S.saver.cur.shot.key, cam: S.saver.cur && S.saver.cur.cam, hold: S.saver.hold, state: S.saver.state, fade: S.saver.fade, camStats: Object.assign({}, camStats, { prev: undefined }), state2: debugState() } : null; },
};

boot().catch(e => fail(e));
