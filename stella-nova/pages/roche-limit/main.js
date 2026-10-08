// ============================================================================
//  ROCHE LIMIT  ·  main.js — entry: module tree, boot, debug object
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
//  Fast 24). The story clock (pacing.js) multiplies it: x4 on the
//  approach, down to x0.3 (slow motion) at the breakup, x3 as the ring
//  spreads. The story strip prints the time warp. Each frame runs the steps that the speed asks for, capped by
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
//  CAMERA. The default is the story camera (app/director.js): a wide shot,
//  a push in to the moon as it breaks up, a pull out to the ring, on
//  springs, with the view turning at most a few degrees a second. The
//  start orbit is turned about the planet's axis so the breakup happens
//  in front of the view. Planet, From above and Follow are as before: a
//  governor caps the turn at ROT_MAX (4 deg/s, 2.5 with Reduce motion;
//  6 deg/s for a button choice), with no roll (up is +z). Reduce motion
//  puts the story camera on the planet view.
//
//  MODULE TREE (app/, one concern per file; each file has its own grep list)
//    env.js        $, device queries, constants, QUALITY, Q, UI
//    state.js      S (shared mutable state), pileCache, bootReady
//    jobs.js       workerCall: jobs for worker.js
//    runs.js       startRun / settleStep / placeSats / limitsFor
//    loop.js       frame / frameBody / orbitsPerMin / stepsWanted
//    quality.js    resize / governQuality / setQuality
//    history.js    readAll / onAnalysis / restoreSnap / truncateHistory
//    story.js      updatePhase / storyText / syncStory / seekPhase
//    sat.js        satCentre / satState
//    camera.js     cam / camStats / camGoal / poseOf / cameraFrame
//    director.js   planShots / storyGoal / smoothStory (the story camera)
//    lines.js      segs / buildSegments
//    field.js      fieldParams / smoothField
//    draw.js       drawFrame
//    labels.js     placeLabels
//    occlusion.js  occlusion (overlay margins)
//    readout.js    refreshReadout / refreshDetails / fmtTime
//    controls.js   buildUI / applyScenario / setPaused / setSpeed / openPanel
//    pointer.js    bindPointer
//    legend.js     drawLegend
//    card-art.js   cardArt
//    debug.js      profile / debugState
//    saver.js      SHOTS and window.snSaver (the screensaver)
//
//  ORDER   The app modules call each other only inside functions, so their
//          import cycles read no binding at load. saver.js installs
//          window.snSaver when it loads; main.js imports it for that.
//
//  grep -n targets
//    boot .................. "async function boot"
//    planet map ............ "async function loadPlanetMap"
//    debug object .......... "window.__roche"
// ============================================================================
import { loadSimCode } from './engine.js';
import { Renderer, loadRenderCode } from './render.js';
import { typesetAll } from '../../lib/sci-math.js';
import { cam, camStats, resetCamStats } from './app/camera.js';
import { buildUI } from './app/controls.js';
import { debugState, profile } from './app/debug.js';
import { $, QUALITY, Q, UI } from './app/env.js';
import { restoreSnap } from './app/history.js';
import { workerJobs } from './app/jobs.js';
import { frame } from './app/loop.js';
import { resize } from './app/quality.js';
import { startRun } from './app/runs.js';
import { S, bootDone } from './app/state.js';
import './app/saver.js';

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

boot().catch(e => fail(e));
