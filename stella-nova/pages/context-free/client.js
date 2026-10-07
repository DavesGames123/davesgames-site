// ============================================================================
//  CONTEXT FREE  ·  client.js — render lanes (one worker each)
// ----------------------------------------------------------------------------
//  Our own code (GPL-2.0-or-later, see COPYING).
//
//  A lane is one worker and a queue of jobs. lane.run(job, hooks) returns a
//  promise of the result. lane.cancel() stops the job that runs (the worker
//  is terminated: the engine is synchronous and cannot read a message while
//  it renders) and rejects the queued ones with { cancelled: true }. The
//  next run() starts a new worker from the compiled module, which takes a
//  few ms.
//
//  job   { src, files, variation, defs, opts, svg }   (see worker.js)
//  hooks { onParsed(p), onProgress(p), onFrame(img, index) }
//        img is an ImageData (RGBA, not premultiplied)
//  result { ok, width, height, shapes, info, diags, image (ImageData) | svg }
//
//  lane.growFrame(mode, at, mask) asks the worker for one frame of the
//  growth replay of the last job with opts.grow: an ImageBitmap at the
//  full render size, drawn by the engine (patch 0004).
//
//  GREP MAP
//    grep -n 'export function compiledModule'
//    grep -n 'export function createLane'
// ============================================================================
let modP = null;

// The engine module, compiled once for every lane and restart.
export function compiledModule() {
  if (!modP) {
    const url = new URL('./cf.wasm', import.meta.url);
    modP = (WebAssembly.compileStreaming
      ? WebAssembly.compileStreaming(fetch(url)).catch(() => fetch(url).then(r => r.arrayBuffer()).then(b => WebAssembly.compile(b)))
      : fetch(url).then(r => r.arrayBuffer()).then(b => WebAssembly.compile(b)));
  }
  return modP;
}

let nextId = 1;

export function createLane(name = 'lane') {
  let worker = null, current = null, initP = null;
  const queue = [], frames = new Map();

  function spawn() {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module', name: 'cf-' + name });
    worker.onmessage = onMessage;
    worker.onerror = e => fail(new Error('worker error: ' + (e.message || 'load failed')));
    const w = worker;
    // The init message goes first, so the worker never starts an engine
    // of its own before the module arrives.
    initP = compiledModule().then(module => { w.postMessage({ type: 'init', module }); },
      () => { w.postMessage({ type: 'init' }); });
  }

  function fail(err) {
    if (current) { current.reject(err); current = null; }
    if (worker) { worker.terminate(); worker = null; }
    pump();
  }

  function onMessage(e) {
    const m = e.data;
    if (m.type === 'fatal') { fail(new Error(m.error)); return; }
    if (m.type === 'growFrame') {
      const f = frames.get(m.id); frames.delete(m.id);
      if (f) f.resolve(m.bitmap ? { bitmap: m.bitmap, w: m.w, h: m.h, at: m.at } : null);
      return;
    }
    if (!current || m.id !== current.id) return;
    const h = current.hooks || {};
    if (m.type === 'parsed') { if (h.onParsed) h.onParsed(m); return; }
    if (m.type === 'progress') { if (h.onProgress) h.onProgress(m); return; }
    if (m.type === 'frame') {
      if (h.onFrame) h.onFrame(new ImageData(new Uint8ClampedArray(m.buf), m.w, m.h), m.index);
      return;
    }
    if (m.type === 'done') {
      if (m.buf) m.image = new ImageData(new Uint8ClampedArray(m.buf), m.width, m.height);
      delete m.buf;
      const c = current; current = null;
      c.resolve(m);
      pump();
    }
  }

  function pump() {
    if (current || !queue.length) return;
    current = queue.shift();
    if (!worker) spawn();
    const { id, job } = current, w = worker;
    initP.then(() => { if (worker === w && current && current.id === id) w.postMessage(Object.assign({ type: 'job', id }, job)); });
  }

  function run(job, hooks = {}) {
    return new Promise((resolve, reject) => {
      queue.push({ id: nextId++, job, hooks, resolve, reject });
      pump();
    });
  }

  // One growth replay frame of the last job that ran with opts.grow (see
  // worker.js). Resolves to { bitmap, w, h, at } or null. A frame waits
  // behind a running job in the worker.
  function growFrame(mode, at, mask = false) {
    if (!worker) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const id = nextId++;
      frames.set(id, { resolve, reject });
      worker.postMessage({ type: 'growFrame', id, mode, at, mask });
    });
  }

  // Stop the running job and drop the queue.
  function cancel() {
    const err = { cancelled: true };
    for (const f of frames.values()) f.reject(err);
    frames.clear();
    while (queue.length) queue.shift().reject(err);
    if (current) {
      const c = current; current = null;
      if (worker) { worker.terminate(); worker = null; }
      c.reject(err);
    }
  }

  return {
    run, cancel, growFrame,
    get busy() { return !!current || queue.length > 0; },
    get pending() { return queue.length + (current ? 1 : 0); },
    destroy() { cancel(); if (worker) { worker.terminate(); worker = null; } },
  };
}
