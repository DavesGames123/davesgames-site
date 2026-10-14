// ============================================================================
//  WORKER  ·  stem-splitter/engine/worker.js — the module worker entry
// ----------------------------------------------------------------------------
//  client.js starts this file as a module Worker. It loads onnxruntime-web
//  1.30.0 from stella-nova/vendor (JSEP build, webgpu + wasm EPs; no CDN)
//  and hands every message to runtime.js, which holds the logic and the
//  protocol of CONTRACT 5.3. The model list is models.js (MODEL role).
//  Ending the worker (client terminate()) frees its WebGPU device and the
//  ORT heap.
//
//  GREP MAP
//    ORT path ........ "const ORT_DIR"
//    wiring .......... "self.onmessage"
// ============================================================================
import { MODELS } from '../models.js';
import { createRuntime } from './runtime.js';

const ORT_DIR = new URL('../../../vendor/onnxruntime-web@1.30.0/dist/', import.meta.url).href;

const rt = createRuntime({
  loadOrt: () => import(ORT_DIR + 'ort.min.mjs'),
  ortDir: ORT_DIR,
  models: MODELS,
  post: (msg, transfer) => self.postMessage(msg, transfer || []),
});

self.onmessage = e => { rt.handle(e.data); };
