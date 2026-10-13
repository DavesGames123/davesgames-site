// ============================================================================
//  GRAVITY LAB  ·  main.js — entry: boot, the frame loop, the debug object
// ----------------------------------------------------------------------------
//  The page runs one EXPERIMENT at a time: a spec (experiments/, or a
//  random roll from roll.js) in a Lab (lab.js): the bodies in f64 on the
//  CPU (nbody.js), up to tens of thousands of particles on the GPU
//  (engine.js, shaders/nbody.wgsl). render.js draws the bodies, the
//  particle rows straight from the GPU buffers, and the trails.
//
//  ONE FRAME
//    stepRun      move the sim by spec.rate x speed x the wall time
//                 (app/run.js; events go on the bus)
//    saverFrame   the screensaver's camera goal and slow motion
//    camFrame     the camera (app/camera.js) in frame coordinates
//    render       bodies, segments, camera uniform, draw
//    placeLabels  the body names (app/ui.js)
//  refreshHUD runs at 4 Hz.
//
//  MODULE TREE (app/, one concern per file; each has its own grep list)
//    state.js    S, UI, SPEEDS, $, the bus, bootReady
//    run.js      startRun / stepRun / throwItem / bodyInstances / segments
//    camera.js   the orbit camera, fitDist, the saver springs
//    pointer.js  turn, zoom, pick, follow, throw with the path ahead
//    ui.js       controls, panels, gallery, tray, HUD, labels, toasts
//    saver.js    window.snSaver: the director and the plate
//  Root (no DOM): nbody.js lab.js engine.js budget.js data.js
//  experiments/ items.js roll.js frame.js saver-plan.js render.js size.js
//
//  RELEASE. lib/gpu-guard.js destroys the device on pagehide; this file
//  also destroys it there (and the Lab and renderer buffers first).
//
//  grep -n targets: "async function boot", "function loop", "window.__glab"
// ============================================================================
import { loadNbodyCode } from './engine.js';
import { Renderer, loadRenderCode } from './render.js';
import { S, UI, $, bootDone, bootFailed, PHONE_Q, COARSE } from './app/state.js';
import { stepRun, bodyInstances, segments, lights } from './app/run.js';
import { camFrame, cam } from './app/camera.js';
import { buildUI, applyChoice, firstChoice, refreshHUD, placeLabels, resizeNow } from './app/ui.js';
import { saverFrame } from './app/saver.js';
import { typesetAll } from '../../lib/sci-math.js';

let last = 0, hudAt = 0;
function loop(now) {
  requestAnimationFrame(loop);
  if (!S.ren || !S.lab) return;
  const dt = Math.min(0.1, Math.max(0, (now - (last || now)) / 1000));
  last = now;
  S.fps = 0.95 * S.fps + 0.05 * (dt > 0 ? 1 / dt : 60);
  if (S.saverOn && S.saver) saverFrame(dt);
  // a step while paused: S.stepFrames frames at the current speed
  const stepping = UI.paused && S.stepFrames > 0;
  if (stepping) { UI.paused = false; S.stepFrames--; }
  try { stepRun(dt); } catch (e) { console.error(e); }
  if (stepping) UI.paused = true;
  const R = S.ren, c = camFrame(R.W / (S.dpr || 1), R.H / (S.dpr || 1), dt);
  S.camNow = c;
  const b = bodyInstances();
  R.setBodies(b.f || new Float32Array(12), b.n || 0);
  const sg = segments(S.dpr || 1);
  R.setSegments(sg.f, sg.n);
  const sp = S.spec, U = sp.scale || { V: 1 };
  R.writeCam(Object.assign(c, {
    t: S.lab.t, dpr: S.dpr || 1, frame: [S.frame.c[0], S.frame.c[1], S.frame.c[2], S.frame.th], lights: lights(),
    minBodyPx: 3 * (S.dpr || 1), minPtPx: 1.05 * (S.dpr || 1), flashT: sp.rate * 0.8, colorMode: UI.colorMode,
    gain: PHONE_Q.matches || COARSE ? 0.8 : 0.62, speedScale: 1 / Math.max(1e-30, typicalSpeed()), vref: S.frame.v,
  }));
  R.render();
  placeLabels();
  if (now - hudAt > 250) { hudAt = now; refreshHUD(); }
}
// the circular speed at half the view extent about the total mass: the
// middle of the speed colour ramp
function typicalSpeed() {
  const sys = S.lab.sys, ext = S.spec.view.extent;
  let M = 0; for (let i = 0; i < sys.n; i++) if (sys.alive[i]) M += sys.m[i];
  if (!(M > 0)) M = 1;
  return 2 * Math.sqrt(M / (0.5 * ext));
}

async function boot() {
  buildUI();
  typesetAll(document).catch(() => {});
  if (!navigator.gpu) return fail(new Error('navigator.gpu is missing'));
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return fail(new Error('no GPU adapter'));
  S.dev = await adapter.requestDevice();
  S.dev.lost.then(i => { if (i.reason !== 'destroyed') fail(new Error('GPU device lost: ' + i.message)); });
  S.dev.addEventListener('uncapturederror', e => console.error('WebGPU:', e.error.message));
  S.ctx = $('gpu').getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  S.ctx.configure({ device: S.dev, format, alphaMode: 'opaque' });
  const [nb, rc] = await Promise.all([loadNbodyCode(), loadRenderCode()]);
  S.code = { nbody: nb };
  S.ren = new Renderer(S.dev, S.ctx, format, rc);
  resizeNow();
  window.addEventListener('resize', resizeNow);
  PHONE_Q.addEventListener && PHONE_Q.addEventListener('change', resizeNow);
  $('busy').classList.add('off');
  window.__glab = { S, UI, cam, get spec() { return S.spec; }, get lab() { return S.lab; }, msgs: () => S.ren.compilationMessages() };
  requestAnimationFrame(loop);
  if (!S.saverOn) applyChoice(firstChoice(), { url: false });
  bootDone();
}
function fail(e) {
  console.error(e);
  $('busy').classList.add('off');
  $('nogpu').classList.remove('off');
  $('nogpuWhy').textContent = String(e && e.message || e);
  bootFailed(e);
}
window.addEventListener('pagehide', () => {
  try { if (S.lab) S.lab.destroy(); if (S.ren) S.ren.destroy(); if (S.dev) S.dev.destroy(); } catch (e) { /* already gone */ }
  S.lab = null; S.ren = null;
});

boot().catch(e => fail(e));
