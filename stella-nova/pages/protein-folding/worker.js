// ============================================================================
//  PROTEIN FOLDING  ·  worker.js — a module worker around sim-host.js
// ----------------------------------------------------------------------------
//  Frames go back with their typed arrays transferred, not copied.
//  grep: createHost
// ============================================================================
import { createHost } from './sim-host.js';
const host = createHost(m => postMessage(m, m.x ? [m.x.buffer, m.formed.buffer, m.samples.buffer] : [m.pos.buffer, m.bestPos.buffer, m.samples.buffer]));
onmessage = e => host.handle(e.data);
