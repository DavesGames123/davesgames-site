// ============================================================================
//  THIN-FILM CLOTH  ·  simhost.js — the page side of the cloth simulation
// ----------------------------------------------------------------------------
//  createSim() starts sim-worker.js as a module worker. If that fails (an
//  old browser, or a worker error at start), it runs sim-core.js on the page
//  thread with the same messages. The caller sees one interface:
//    sim.post(msg)        send a message (see sim-core.js for the protocol)
//    sim.onmessage = fn   receive 'frame' and 'lut' answers
//    sim.kind             'worker' or 'page thread'
// ============================================================================
import { SimCore } from './sim-core.js';

class LocalSim {
  constructor() { this.core = new SimCore(); this.onmessage = null; this.kind = 'page thread'; }
  post(m) {
    const out = this.core.handle(m);
    // answer on a later task, as a worker does
    if (out) queueMicrotask(() => this.onmessage && this.onmessage(out.msg));
  }
}

export function createSim() {
  let w = null;
  try { w = new Worker(new URL('./sim-worker.js', import.meta.url), { type: 'module' }); } catch (e) { w = null; }
  if (!w) return new LocalSim();
  const host = { kind: 'worker', onmessage: null, queue: [], local: null };
  host.post = m => { if (host.local) host.local.post(m); else w.postMessage(m); };
  w.onmessage = e => host.onmessage && host.onmessage(e.data);
  // A worker that fails to load (for example a module worker in an old
  // Safari) reports an error: switch to the page thread and replay the
  // last init.
  w.onerror = ev => {
    ev.preventDefault && ev.preventDefault();
    if (host.local) return;
    w.terminate(); host.local = new LocalSim(); host.kind = 'page thread';
    host.local.onmessage = m => host.onmessage && host.onmessage(m);
    if (host.lastInit) host.local.post(host.lastInit);
    for (const m of host.pendingLut || []) host.local.post(m);
    host.onfallback && host.onfallback();
  };
  const post = host.post;
  host.post = m => { if (m.op === 'init') host.lastInit = m; if (m.op === 'lut') (host.pendingLut = host.pendingLut || []).push(m); post(m); };
  return host;
}
