// ============================================================================
//  SANDBOX  ·  runs a submission in a Web Worker with a time limit (ES module)
// ----------------------------------------------------------------------------
//  runSubmission(code, { scene, timeoutMs }) starts sandbox-worker.js as a
//  module worker, sends the code and the scene meta (fps, frames, camera),
//  and waits for the world. If the time limit is gone first, the main
//  thread terminates the worker and reports a timeout. Each run uses a new
//  worker, so a bad run cannot leave state for the next run.
//
//  scene can be a scene id ('rigid', ...), a scene from scenes.js, or a
//  World (its fps, frames and camera are used). The submission sees the
//  reference camera, fps and frame count, as the page contract says.
//
//  This module has no DOM at import time. Only runSubmission needs the
//  Worker global, so Node tests can import SUBMISSIONS and makeApi from it.
//  The api that submission code sees is documented in sandbox-worker.js.
//
//  EXPORTS   (grep -n "<anchor>" sandbox.js)
//    run in worker .... "export async function runSubmission"
//    scene meta ....... "export function metaFor"
//    presets .......... "export { SUBMISSIONS"   (data in submissions.js)
//    api / no worker .. "export { makeApi"       (from sandbox-worker.js)
// ============================================================================

import { CAMERA, sceneById } from './scenes.js';

export { SUBMISSIONS, STRATEGY_LABEL } from './submissions.js';
export { makeApi, evaluate } from './sandbox-worker.js';

const FPS = 30;

// The meta that the worker needs: { fps, frames, camera }.
export function metaFor(scene) {
  const s = typeof scene === 'string' ? sceneById(scene) : scene;
  if (!s) throw new Error(`unknown scene ${scene}`);
  const cam = s.camera || CAMERA;
  const fps = s.fps || FPS;
  const frames = s.frames || Math.round((s.seconds || 3) * fps);
  return { fps, frames, camera: { eye: cam.eye.slice(), target: cam.target.slice(), fovY: cam.fovY } };
}

// Run code in a worker. Never throws. Returns
// { ok, world?, errors: [string], log: [string], ms }.
export async function runSubmission(code, { scene, timeoutMs = 8000 } = {}) {
  const t0 = performance.now();
  let meta;
  try { meta = metaFor(scene); }
  catch (e) { return { ok: false, errors: [e.message], log: [], ms: 0 }; }
  if (typeof Worker === 'undefined') return { ok: false, errors: ['this browser has no Web Workers'], log: [], ms: 0 };

  let worker;
  try { worker = new Worker(new URL('./sandbox-worker.js', import.meta.url), { type: 'module' }); }
  catch (e) { return { ok: false, errors: [`could not start the worker: ${e.message}`], log: [], ms: performance.now() - t0 }; }

  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true; clearTimeout(timer); worker.terminate();
      resolve({ ok: !!r.ok, world: r.world, errors: r.errors || [], log: r.log || [], ms: performance.now() - t0 });
    };
    const timer = setTimeout(() => finish({
      ok: false,
      errors: [`time limit: the code ran for more than ${(timeoutMs / 1000).toFixed(1)} s and was stopped`],
    }), timeoutMs);
    worker.onmessage = (ev) => finish(ev.data || { ok: false, errors: ['empty reply from the worker'] });
    worker.onerror = (ev) => { ev.preventDefault && ev.preventDefault(); finish({ ok: false, errors: [`worker error: ${ev.message || 'could not load sandbox-worker.js'}`] }); };
    worker.onmessageerror = () => finish({ ok: false, errors: ['the world could not be read from the worker'] });
    worker.postMessage({ code: String(code), meta });
  });
}
