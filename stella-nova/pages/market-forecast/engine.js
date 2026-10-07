// ============================================================================
//  ENGINE  ·  market-forecast/engine.js — the page side of the worker
// ----------------------------------------------------------------------------
//  createEngine({ ep }) starts worker.js and returns promise methods:
//    engine.info              { gpu, ep, threads, isolated } after ready
//    engine.ready             resolves when the runtime is loaded
//    engine.load(model, onProgress)            build the session (and fetch
//                                              weights for the HF models)
//    engine.forecast(model, rows, H, groups)   -> { q, levels, ep, timings }
//    engine.terminate()
//  The worker owns its WebGPU device. lib/gpu-guard.js only sees the devices
//  of the page thread, so the engine stops the worker on pagehide and when
//  the shell calls window.__snRelease. Stopping the worker frees its device.
//
//  grep -n targets: "export function createEngine", "function release"
// ============================================================================
export function createEngine({ ep = 'auto' } = {}) {
  const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  let seq = 0, dead = false;
  const pend = new Map(), prog = new Map();
  w.onmessage = e => {
    const m = e.data;
    if (m.op === 'progress') { const f = prog.get(m.model); if (f) f(m); return; }
    const p = pend.get(m.id); if (!p) return;
    pend.delete(m.id);
    m.ok ? p.res(m.result) : p.rej(new Error(m.error));
  };
  w.onerror = e => { for (const p of pend.values()) p.rej(new Error('worker error: ' + (e.message || 'load failed'))); pend.clear(); };
  const call = (op, body = {}, transfer = []) => new Promise((res, rej) => {
    if (dead) return rej(new Error('engine stopped'));
    const id = ++seq; pend.set(id, { res, rej }); w.postMessage({ id, op, ...body }, transfer);
  });
  function release() {
    if (dead) return; dead = true;
    try { w.terminate(); } catch (e) {}
    for (const p of pend.values()) p.rej(new Error('engine stopped'));
    pend.clear();
  }
  addEventListener('pagehide', release);
  const prev = window.__snRelease;
  window.__snRelease = function () { release(); if (typeof prev === 'function') return prev.apply(this, arguments); };
  const engine = {
    info: null,
    ready: null,
    load(model, onProgress) { if (onProgress) prog.set(model, onProgress); return call('load', { model }); },
    forecast(model, rows, H, groups) {
      const copy = rows.map(r => Float64Array.from(r));
      return call('forecast', { model, rows: copy, H, groups }, copy.map(r => r.buffer));
    },
    terminate: release,
    get dead() { return dead; },
  };
  engine.ready = call('init', { ep }).then(info => (engine.info = info));
  return engine;
}
