// ============================================================================
//  BREADBOARD LAB  ·  sim/worker.js — the module worker that runs the sim
// ----------------------------------------------------------------------------
//  Made by sim/client.js with new Worker(new URL('./worker.js',
//  import.meta.url), { type: 'module' }). All logic is in sim/host.js; this
//  file only joins it to the worker message port. The MCU runtime
//  (mcu/runtime.js) loads lazily inside the host, so the sketches run here,
//  on the sim clock, off the main thread.
//
//  GREP MAP
//    createHost ... sim/host.js
//    onmessage .... commands in (contract 3.8 worker messages)
// ============================================================================
import { createHost } from './host.js';

const host = createHost((msg, transfer) => self.postMessage(msg, transfer || []));
self.onmessage = (e) => host.handle(e.data);
