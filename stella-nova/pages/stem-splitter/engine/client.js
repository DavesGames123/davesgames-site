// ============================================================================
//  CLIENT  ·  stem-splitter/engine/client.js — the main-thread engine API
// ----------------------------------------------------------------------------
//  createEngine() gives the object that the UI calls (CONTRACT 5.4). It
//  starts worker.js as a module Worker on the first call, sends requests
//  (CONTRACT 5.3) and routes the progress events to the onProgress of the
//  running call. Rejections are Error objects with a `code`
//  ('cancelled' | 'oom' | 'net' | 'hash' | 'session' | 'run').
//
//  Release: the worker owns its WebGPU device, and lib/gpu-guard.js sees
//  only the devices of the page thread. So pagehide and the shell's
//  window.__snRelease call terminate(), which ends the worker at once and
//  frees the device and the ORT heap. The next call starts a new worker
//  and repeats the last init().
//
//  separate() copies left / right before it sends them, so the caller keeps
//  its arrays (the "Original" row). Pass { transfer: true } to send the
//  caller's arrays with no copy; they are then detached.
//
//  GREP MAP
//    factory ............... "export function createEngine"
//    worker start .......... "function start"
//    request ............... "function call"
//    stop / release ........ "function terminate"
//    API methods ........... "const engine = {"
// ============================================================================

const stopped = () => Object.assign(new Error('engine stopped'), { code: 'cancelled' });

export function createEngine({ workerUrl, WorkerImpl, modelsLoader } = {}) {
  const url = workerUrl || new URL('./worker.js', import.meta.url);
  const W = WorkerImpl || (typeof Worker !== 'undefined' ? Worker : null);
  const loadModels = modelsLoader || (() => import('../models.js').then(m => m.MODELS));
  let w = null, seq = 0, gen = 0, initArgs = null, initDone = null;
  const pend = new Map();
  let progress = null;      // onProgress of the running load / separate

  function onMessage(e) {
    const m = e.data;
    if (m && m.op === 'progress') { if (progress) { try { progress(m); } catch (err) { /* UI error */ } } return; }
    const p = pend.get(m && m.id);
    if (!p) return;
    pend.delete(m.id);
    if (m.ok) p.res(m.result);
    else p.rej(Object.assign(new Error(m.error), { code: m.code || 'run' }));
  }

  function start() {
    if (w) return w;
    if (!W) throw Object.assign(new Error('this browser has no Web Worker'), { code: 'session' });
    w = new W(url, { type: 'module' });
    w.onmessage = onMessage;
    w.onerror = e => {
      const err = Object.assign(new Error('worker error: ' + ((e && e.message) || 'load failed')), { code: 'session' });
      for (const p of pend.values()) p.rej(err);
      pend.clear();
    };
    initDone = null;
    return w;
  }

  function call(op, body = {}, transfer = []) {
    return new Promise((res, rej) => {
      let worker;
      try { worker = start(); } catch (e) { rej(e); return; }
      const id = ++seq;
      pend.set(id, { res, rej });
      worker.postMessage({ id, op, ...body }, transfer);
    });
  }

  // A worker started after terminate() repeats the last init first.
  async function ready() {
    if (!w) start();
    if (!initDone) initDone = call('init', { ep: (initArgs && initArgs.ep) || 'auto' });
    return initDone;
  }

  // A call that was waiting for init when terminate() ran must not go on
  // to a new worker: it rejects as cancelled.
  const live = g => { if (g !== gen) throw stopped(); };

  function terminate() {
    gen++;
    if (w) { try { w.terminate(); } catch (e) { /* ignore */ } }
    w = null; initDone = null; progress = null;
    for (const p of pend.values()) p.rej(stopped());
    pend.clear();
  }

  if (typeof addEventListener === 'function') addEventListener('pagehide', terminate);
  if (typeof window !== 'undefined') {
    const prev = window.__snRelease;
    window.__snRelease = function () { terminate(); if (typeof prev === 'function') return prev.apply(this, arguments); };
  }

  const engine = {
    async init({ ep = 'auto' } = {}) {
      initArgs = { ep };
      if (!w) start();
      initDone = call('init', { ep });
      return initDone;
    },
    async models() {
      const g = gen;
      const MODELS = await loadModels();
      await ready(); live(g);
      const cached = await call('cached');
      return Object.values(MODELS).map(m => ({
        id: m.id, label: m.label, note: m.note, stems: m.stems.slice(),
        bytes: m.graph.bytes + m.weights.bytes, cached: !!cached[m.id],
      }));
    },
    async load(modelId, onProgress) {
      const g = gen;
      await ready(); live(g);
      progress = onProgress || null;
      try { return await call('load', { model: modelId }); } finally { progress = null; }
    },
    async separate({ modelId, left, right, quality = 'standard', onProgress, transfer = false, shiftOffsets }) {
      const g = gen;
      await ready(); live(g);
      const L = transfer ? left : Float32Array.from(left), R = transfer ? right : Float32Array.from(right);
      progress = onProgress || null;
      try {
        const body = { model: modelId, left: L, right: R, quality };
        if (shiftOffsets) body.shiftOffsets = shiftOffsets;
        return await call('separate', body, [...new Set([L.buffer, R.buffer])]);
      } finally { progress = null; }
    },
    cancel() { if (w) { const id = ++seq; w.postMessage({ id, op: 'cancel' }); } },
    async evict(modelId) { const g = gen; await ready(); live(g); await call('evict', { model: modelId }); },
    async dispose() { if (w) await call('dispose'); },
    terminate,
  };
  return engine;
}
