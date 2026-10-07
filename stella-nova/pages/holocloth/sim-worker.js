// ============================================================================
//  THIN-FILM CLOTH  ·  sim-worker.js — runs the XPBD cloth off the page thread
// ----------------------------------------------------------------------------
//  The page thread (simhost.js) posts one message per frame; the worker
//  answers with the new surface. The same handler runs on the page thread
//  when a module worker is not available (simhost.js LocalSim), so this
//  file only wires messages to sim-core.js.
// ============================================================================
import { SimCore } from './sim-core.js';

const core = new SimCore();
self.onmessage = e => {
  const out = core.handle(e.data);
  if (out) self.postMessage(out.msg, out.transfer);
};
