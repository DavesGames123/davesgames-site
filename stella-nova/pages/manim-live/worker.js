// ============================================================================
//  MANIM LIVE  ·  worker.js  (module Web Worker: the browser host of the engine)
// ----------------------------------------------------------------------------
//  Runs Pyodide 314.0.7 and the real ManimCE 0.22.0 (engine-core.js) off the
//  main thread. engine.js owns this worker; see CONTRACT.md section 6.
//
//  MESSAGES IN   {type:'init', interruptBuffer, pyodide?}  once, first
//                (pyodide = {module, indexURL, options}: only the Node test
//                harness sets it, to use a local Pyodide instead of the CDN)
//                {type:'run', id, code, opts}
//                {type:'introspect'|'source', id, name}
//                {type:'complete', id, code, line, col}
//  MESSAGES OUT  {type:'status', stage, detail}
//                {type:'ready', info} | {type:'boot-error', message, stack}
//                {type:'event', id, name, data}          scenes, animation, log, error, done
//                {type:'frame', id, index, t, repeat, width, height, bitmap}  (bitmap transferred)
//                {type:'result', id, value} | {type:'fail', id, message}
//
//  The worker answers one request at a time: run() is one synchronous
//  Python call, so a later request waits in the message queue.
//
//  HOST PIECES (env for engine-core.js)
//    grep -n 'getContext'     OffscreenCanvas per surface size (cairo shim)
//    grep -n 'emitFrame'      RGBA -> OffscreenCanvas -> ImageBitmap, transferred
//    grep -n 'readBytesSync'  synchronous XHR for fonts and MathJax (allowed in workers)
// ============================================================================

import { bootRuntime, PYODIDE_CDN } from './engine-core.js';

const BASE = new URL('./', import.meta.url);
const url = (rel) => new URL(rel, BASE).href;
let runtime = null;
let currentId = null;
let interrupt = null;
let bootPromise = null;
let pyodideSource = { module: PYODIDE_CDN + 'pyodide.mjs', indexURL: PYODIDE_CDN, options: {} };
const post = (msg, transfer) => self.postMessage(msg, transfer || []);

const contexts = new Map();
let frameCanvas = null;
let frameCtx = null;

function syncGet(rel, type) {
  const x = new XMLHttpRequest();
  x.open('GET', url(rel), false);
  if (type === 'arraybuffer') x.responseType = 'arraybuffer';
  x.send();
  if (x.status !== 200 && x.status !== 0) throw new Error(`GET ${rel}: HTTP ${x.status}`);
  return type === 'arraybuffer' ? new Uint8Array(x.response) : x.responseText;
}

const env = {
  async loadPyodide() {
    const { loadPyodide } = await import(pyodideSource.module);
    const py = await loadPyodide({
      ...pyodideSource.options,
      indexURL: pyodideSource.indexURL,
      stdout: (text) => { if (currentId != null) post({ type: 'event', id: currentId, name: 'log', data: { stream: 'stdout', text } }); },
      stderr: (text) => { if (currentId != null) post({ type: 'event', id: currentId, name: 'log', data: { stream: 'stderr', text } }); },
    });
    if (interrupt) py.setInterruptBuffer(interrupt);
    return py;
  },
  async fetchBytes(rel) {
    const r = await fetch(url(rel));
    if (!r.ok) throw new Error(`GET ${rel}: HTTP ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  },
  readBytesSync: (rel) => syncGet(rel, 'arraybuffer'),
  readTextSync: (rel) => syncGet(rel, 'text'),
  getContext(w, h) {
    const key = w + 'x' + h;
    let ctx = contexts.get(key);
    if (!ctx) {
      ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
      contexts.set(key, ctx);
    }
    return ctx;
  },
  emitFrame(u8, w, h, index, t, repeat) {
    if (!frameCanvas || frameCanvas.width !== w || frameCanvas.height !== h) {
      frameCanvas = new OffscreenCanvas(w, h);
      frameCtx = frameCanvas.getContext('2d');
    }
    frameCtx.putImageData(new ImageData(new Uint8ClampedArray(u8), w, h), 0, 0);
    const bitmap = frameCanvas.transferToImageBitmap();
    post({ type: 'frame', id: currentId, index, t, repeat, width: w, height: h, bitmap }, [bitmap]);
  },
  makeScriptScope() {
    // MathJax runs in the worker global scope (no window, no document).
    return { global: self, run: (code, name) => (0, eval)(code + '\n//# sourceURL=manim-live/' + name) };
  },
  async sha256(bytes) {
    const d = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
  },
  onStatus: (s) => post({ type: 'status', stage: s.stage, detail: s.detail }),
};

function boot() {
  bootPromise = bootRuntime(env).then((rt) => {
    runtime = rt;
    post({ type: 'ready', info: rt.info });
    return rt;
  }, (err) => {
    post({ type: 'boot-error', message: String(err && err.message || err), stack: String(err && err.stack || '') });
    throw err;
  });
  return bootPromise;
}

function handle(msg) {
  const { id } = msg;
  try {
    if (msg.type === 'run') {
      currentId = id;
      if (interrupt) Atomics.store(interrupt, 0, 0);
      const summary = runtime.run(msg.code, msg.opts || {}, (name, data) => post({ type: 'event', id, name, data }));
      post({ type: 'result', id, value: summary });
    } else if (msg.type === 'introspect') {
      post({ type: 'result', id, value: runtime.introspect(msg.name) });
    } else if (msg.type === 'source') {
      post({ type: 'result', id, value: runtime.source(msg.name) });
    } else if (msg.type === 'complete') {
      post({ type: 'result', id, value: runtime.complete(msg.code, msg.line, msg.col) });
    } else {
      post({ type: 'fail', id, message: 'unknown request ' + msg.type });
    }
  } catch (err) {
    post({ type: 'fail', id, message: String(err && err.message || err) });
  } finally {
    if (msg.type === 'run') currentId = null;
  }
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type === 'init') {
    interrupt = msg.interruptBuffer || null;
    if (msg.pyodide) pyodideSource = { ...pyodideSource, ...msg.pyodide };
    boot().catch(() => {});
    return;
  }
  try {
    await bootPromise;
  } catch (err) {
    post({ type: 'fail', id: msg.id, message: 'engine did not start: ' + String(err && err.message || err) });
    return;
  }
  handle(msg);
};
