// ============================================================================
//  MANIM LIVE  ·  engine.js  (main-thread API of the engine)
// ----------------------------------------------------------------------------
//  The real ManimCE 0.22.0 runs in Pyodide in worker.js. This module owns
//  that worker and gives the IDE the protocol of CONTRACT.md section 6:
//
//    createEngine({onStatus}) -> {ready, run(code, opts) -> handle, cancel(),
//                                 (option pyodide: {module, indexURL, options}
//                                  is for the Node test harness only)
//                                 introspect(name), source(name),
//                                 complete(code, line, col), info, restart()}
//    handle.on('scenes' | 'animation' | 'frame' | 'log' | 'error' | 'done', fn)
//    handle.done -> Promise<summary>
//
//  FRAMES. The worker sends one ImageBitmap per manim write_frame call with
//  a repeat count (a held frame of self.wait is one bitmap). This module
//  emits one 'frame' event per frame index, all with the same bitmap.
//
//  CANCEL. With crossOriginIsolated, a SharedArrayBuffer is the Pyodide
//  interrupt buffer: cancel() writes SIGINT (2) and Python raises
//  KeyboardInterrupt at once; the interpreter stays warm. Without it,
//  cancel() terminates the worker and starts a new one (a new boot).
//
//  GREP MAP
//    grep -n 'function spawn'      worker start, init message
//    grep -n 'function onMessage'  worker -> handles and promises
//    grep -n 'run(code'            one run, handle object
//    grep -n 'cancel()'            interrupt or restart
// ============================================================================

const EVENTS = ['scenes', 'animation', 'frame', 'log', 'error', 'done'];

export function createEngine({ onStatus = () => {}, pyodide = null } = {}) {
  let worker = null;
  let interrupt = null;
  let nextId = 1;
  const handles = new Map();   // run id -> handle internals
  const requests = new Map();  // request id -> {resolve, reject}
  let readyResolve, readyReject;
  let current = null;          // run id in progress (or queued last)
  const api = {};

  const status = (s) => { try { onStatus(s); } catch (e) { console.error(e); } };

  function newReady() {
    api.ready = new Promise((res, rej) => { readyResolve = res; readyReject = rej; });
    api.ready.catch(() => {});
  }

  function spawn() {
    newReady();
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    interrupt = (globalThis.crossOriginIsolated && typeof SharedArrayBuffer === 'function')
      ? new Int32Array(new SharedArrayBuffer(4)) : null;
    worker.onmessage = onMessage;
    worker.onerror = (e) => {
      const message = (e && e.message) || 'worker error';
      status({ stage: 'error', error: { message }, detail: message });
      readyReject(new Error(message));
    };
    worker.postMessage({ type: 'init', interruptBuffer: interrupt, pyodide });
  }

  function onMessage(e) {
    const m = e.data;
    switch (m.type) {
      case 'status':
        if (m.stage !== 'ready') status({ stage: m.stage, detail: m.detail, text: m.detail });
        break;
      case 'ready':
        api.info = m.info;
        status({ stage: 'ready', ready: true, detail: 'manim ' + m.info.manimVersion, text: 'manim ' + m.info.manimVersion, info: m.info });
        readyResolve(m.info);
        break;
      case 'boot-error':
        status({ stage: 'error', error: { message: m.message }, detail: m.message });
        readyReject(new Error(m.message));
        break;
      case 'event': {
        const h = handles.get(m.id);
        if (h) h.emit(m.name, m.data);
        break;
      }
      case 'frame': {
        const h = handles.get(m.id);
        if (!h) { m.bitmap && m.bitmap.close && m.bitmap.close(); break; }
        h.fps = h.fps || 15;
        for (let k = 0; k < m.repeat; k++) {
          const index = m.index + k;
          h.emit('frame', { index, t: index / h.fps, bitmap: m.bitmap, repeat: m.repeat, width: m.width, height: m.height });
        }
        break;
      }
      case 'result':
      case 'fail': {
        const h = handles.get(m.id);
        if (h) {
          handles.delete(m.id);
          if (current === m.id) current = null;
          h.finish(m.type === 'result' ? m.value : { ok: false, error: { type: 'EngineError', message: m.message } }, m.type === 'fail' ? m.message : null);
          break;
        }
        const r = requests.get(m.id);
        if (r) {
          requests.delete(m.id);
          if (m.type === 'result') r.resolve(m.value); else r.reject(new Error(m.message));
        }
        break;
      }
      default:
        break;
    }
  }

  function request(type, payload) {
    const id = nextId++;
    return api.ready.then(() => new Promise((resolve, reject) => {
      requests.set(id, { resolve, reject });
      worker.postMessage({ type, id, ...payload });
    }));
  }

  api.run = function run(code, opts = {}) {
    const id = nextId++;
    const listeners = new Map(EVENTS.map((n) => [n, new Set()]));
    let finishDone;
    const quality = opts.quality || 'low';
    const fps = opts.fps || { phone: 15, low: 15, medium: 30, high: 60 }[quality] || 15;
    const h = {
      id,
      fps,
      emit(name, data) {
        const set = listeners.get(name);
        if (!set) return;
        for (const fn of set) { try { fn(data); } catch (err) { console.error(err); } }
      },
      finish(summary, failMessage) {
        if (failMessage) h.emit('error', { type: 'EngineError', message: failMessage, traceback: '', line: null });
        finishDone(summary);
      },
    };
    const handle = {
      id,
      on(name, fn) { if (listeners.has(name)) listeners.get(name).add(fn); return handle; },
      off(name, fn) { if (listeners.has(name)) listeners.get(name).delete(fn); return handle; },
      done: new Promise((res) => { finishDone = res; }),
      cancel: () => api.cancel(),
    };
    handles.set(id, h);
    current = id;
    api.ready.then(
      () => worker.postMessage({ type: 'run', id, code, opts: { ...opts, quality, fps } }),
      (err) => {
        handles.delete(id);
        h.emit('error', { type: 'EngineError', message: 'Python did not start: ' + err.message, traceback: '', line: null });
        finishDone({ ok: false, error: { type: 'EngineError', message: err.message } });
      },
    );
    return handle;
  };

  api.cancel = function cancel() {
    if (current == null) return false;
    if (interrupt) {
      Atomics.store(interrupt, 0, 2); // SIGINT -> KeyboardInterrupt in Python
      return true;
    }
    // No shared memory: stop the worker and boot a new one.
    const stopped = [...handles.entries()];
    handles.clear();
    current = null;
    worker.terminate();
    for (const [, h] of stopped) {
      h.emit('error', { type: 'KeyboardInterrupt', message: 'Run cancelled. The engine restarts (no SharedArrayBuffer on this page).', traceback: '', line: null });
      h.finish({ ok: false, cancelled: true }, null);
    }
    for (const [, r] of requests) r.reject(new Error('cancelled'));
    requests.clear();
    status({ stage: 'restart', detail: 'Restarting Python after cancel' });
    spawn();
    return true;
  };

  api.restart = function restart() {
    for (const [, h] of handles) h.finish({ ok: false, cancelled: true }, null);
    handles.clear();
    for (const [, r] of requests) r.reject(new Error('restarted'));
    requests.clear();
    current = null;
    if (worker) worker.terminate();
    spawn();
    return api.ready;
  };

  api.facts = () => api.ready; // same object as engine.info, for ui/hood.js
  api.introspect = (name) => request('introspect', { name });
  api.source = (name) => request('source', { name });
  api.complete = (code, line, col) => request('complete', { code, line, col });
  api.terminate = () => { if (worker) worker.terminate(); worker = null; };
  Object.defineProperty(api, 'canInterrupt', { get: () => !!interrupt });

  spawn();
  return api;
}
