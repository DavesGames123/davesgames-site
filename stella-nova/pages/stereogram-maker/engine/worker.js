// ============================================================================
//  STEREOGRAM ENGINE  ·  engine/worker.js — the module worker
// ----------------------------------------------------------------------------
//  new Worker(new URL('./engine/worker.js', import.meta.url), { type: 'module' })
//  The protocol and the ops are in worker-core.js. Use
//  createEngineClient(worker) from engine/index.js to call it.
// ============================================================================
import { handle } from './worker-core.js';
self.onmessage = async ev => {
  const { reply, transfer } = await handle(ev.data);
  self.postMessage(reply, transfer);
};
