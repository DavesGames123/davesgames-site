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
import { loadSimCode } from './engine.js';
import { Renderer, loadRenderCode } from './render.js';
import { SCENARIOS, REAL } from './scenarios.js';
import { typesetAll } from '../../lib/sci-math.js';
import { cam, camStats, resetCamStats } from './app/camera.js';
import { cardArt } from './app/card-art.js';
import { $, QUALITY, Q, UI, SPEED_MIN, SPEED_MAX, N_OPTS, PHONE_Q, RM_Q, SPEED_STOPS } from './app/env.js';
import { restoreSnap, truncateHistory } from './app/history.js';
import { workerJobs, workerCall } from './app/jobs.js';
import { drawLegend } from './app/legend.js';
import { buildSegments } from './app/lines.js';
import { frame, allFree, stepsWanted, orbitsPerMin } from './app/loop.js';
import { resize, setQuality } from './app/quality.js';
import { refreshReadout, fmtTime } from './app/readout.js';
import { startRun, limitsFor, currentSpec } from './app/runs.js';
import { satState } from './app/sat.js';
import { S, bootDone, bootReady } from './app/state.js';
import { syncStory, storyText } from './app/story.js';

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

// ── UI ────────────────────────────────────────────────────────────────────
export function setPaused(p) {
  if (!p && UI.paused && S.run) truncateHistory();
  UI.paused = p;
  if (S.run) S.run.scrubbing = false;
  syncPlayButtons();
}
export function syncPlayButtons() {
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
export function syncScrub() {
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
