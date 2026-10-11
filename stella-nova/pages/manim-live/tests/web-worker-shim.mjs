// ============================================================================
//  MANIM LIVE  ·  tests/web-worker-shim.mjs  (run worker.js + engine.js in Node)
// ----------------------------------------------------------------------------
//  Node has no Web Worker, OffscreenCanvas or synchronous XHR. This file
//  gives the few pieces that worker.js and engine.js use, so the tests run
//  the REAL worker.js and engine.js (not copies):
//
//    installMainGlobals()   globalThis.Worker -> node:worker_threads Worker
//                           that loads this file as its entry
//    (entry, in a thread)   self, postMessage, onmessage, XMLHttpRequest
//                           (sync, file:), fetch (file:), OffscreenCanvas
//                           and ImageData (@napi-rs/canvas), then
//                           import(worker.js)
//
//  ImageBitmap stand-in: {width, height, data: Uint8ClampedArray, close()}
//  (worker_threads can clone it; a real ImageBitmap is transferred).
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker as NodeWorker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const SELF = fileURLToPath(import.meta.url);

export function installMainGlobals() {
  globalThis.Worker = class ShimWorker {
    constructor(url, opts = {}) {
      this.onmessage = null;
      this.onerror = null;
      this.w = new NodeWorker(SELF, { workerData: { url: String(url), cache: process.env.MANIM_LIVE_CACHE } });
      this.w.on('message', (data) => {
        if (data && data.type === 'frame' && data.bitmap) data.bitmap.close = () => {};
        this.onmessage && this.onmessage({ data });
      });
      this.w.on('error', (e) => this.onerror && this.onerror(e));
    }
    postMessage(m) { this.w.postMessage(m); }
    terminate() { this.w.terminate(); }
  };
}

// Options that make worker.js use the local npm Pyodide (no CDN in tests).
export function localPyodide() {
  const nm = path.join(process.env.MANIM_LIVE_CACHE, 'node_modules');
  return {
    module: pathToFileURL(path.join(nm, 'pyodide', 'pyodide.mjs')).href,
    indexURL: path.join(nm, 'pyodide') + path.sep,
    options: { packageCacheDir: path.join(process.env.MANIM_LIVE_CACHE, 'pyodide-packages') },
  };
}

async function workerEntry() {
  const nm = path.join(workerData.cache, 'node_modules');
  const canvas = await import(pathToFileURL(path.join(nm, '@napi-rs', 'canvas', 'index.js')).href);
  const g = globalThis;
  g.self = g;
  g.postMessage = (msg) => parentPort.postMessage(msg);
  parentPort.on('message', (data) => { if (typeof g.onmessage === 'function') g.onmessage({ data }); });
  const toPath = (u) => fileURLToPath(new URL(u));
  g.XMLHttpRequest = class {
    open(method, u, async) { this.u = u; if (async !== false) throw new Error('shim: sync XHR only'); }
    send() {
      const buf = fs.readFileSync(toPath(this.u));
      this.status = 200;
      this.response = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      this.responseText = buf.toString('utf8');
    }
  };
  const realFetch = g.fetch;
  g.fetch = async (u, o) => {
    const s = String(u);
    if (!s.startsWith('file:')) return realFetch(u, o);
    const buf = fs.readFileSync(toPath(s));
    return new Response(buf);
  };
  g.ImageData = canvas.ImageData;
  g.OffscreenCanvas = class {
    constructor(w, h) { this.width = w; this.height = h; this.c = canvas.createCanvas(w, h); }
    getContext(kind) { return this.c.getContext(kind); }
    transferToImageBitmap() {
      const ctx = this.c.getContext('2d');
      const d = ctx.getImageData(0, 0, this.width, this.height);
      ctx.clearRect(0, 0, this.width, this.height);
      return { width: this.width, height: this.height, data: new Uint8ClampedArray(d.data) };
    }
  };
  await import(workerData.url);
}

if (!isMainThread && workerData && workerData.url) {
  workerEntry().catch((e) => { console.error(e); process.exit(1); });
}
