// ============================================================================
//  BREADBOARD LAB  ·  sim/client.js — the main-thread handle of the simulator
// ----------------------------------------------------------------------------
//  createSim({ inline }) → sim (contract 3.8). By default it starts the
//  module worker sim/worker.js. With inline: true, or when Worker is absent
//  or fails to start, it runs sim/host.js on this thread with the same
//  messages, so the page still works (slower) and node tests can drive it.
//  A worker that errors before its first reply is dropped: the messages
//  sent so far replay into the inline host, and an 'error' says so.
//
//  Replies: 'frame', 'event', 'serial', 'state', 'error' go to the on()
//  listeners. load() and measureR() return promises; loadProgram() returns a
//  promise of { ok, errors } (reply type 'program').
//
//  GREP MAP
//    createSim ........... worker or inline transport
//    on / emit ........... listeners
//    load / measureR ..... request and reply promises
//    dispose ............. ends the worker (GPU-release rule: main.js calls it
//                          on pagehide)
// ============================================================================
import { createHost } from './host.js';

export function createSim(opts = {}) {
  const ls = { frame: new Set(), event: new Set(), serial: new Set(), state: new Set(), error: new Set() };
  const emit = (t, v) => { for (const f of ls[t] || []) { try { f(v); } catch (e) { /* a listener must not stop the sim */ } } };
  let pendingLoad = [], reqId = 1, mrWait = new Map(), progWait = [];
  let worker = null, host = null, disposed = false;
  // messages sent before the worker first replies, replayed inline if the
  // worker fails to start (no module workers, a load error)
  let replay = [], replied = false;

  function onMsg(m) {
    if (!m || disposed) return;
    if (!replied) { replied = true; replay = []; }
    switch (m.type) {
      case 'frame': { const { type, ...f } = m; emit('frame', f); break; }
      case 'event': { const { type, ...ev } = m; emit('event', ev); break; }
      case 'serial': emit('serial', { mcu: m.mcu, text: m.text }); break;
      case 'state': { const { type, ...s } = m; emit('state', s); break; }
      case 'loaded': { const r = pendingLoad.shift(); if (r) r({ ok: m.ok, warnings: m.warnings, dcop: m.dcop, programs: m.programs }); break; }
      case 'measureR': { const r = mrWait.get(m.reqId); if (r) { mrWait.delete(m.reqId); r(m.ohms); } break; }
      case 'program': { const r = progWait.shift(); if (r) r({ ok: m.ok, errors: m.errors }); break; }
      case 'error': emit('error', m.msg); break;
      default: break;
    }
  }

  function startInline() {
    host = createHost((m) => onMsg(m), { loadRuntime: opts.loadRuntime });
  }
  function fallback(why) {
    if (worker) { try { worker.terminate(); } catch (e) { /* already gone */ } }
    worker = null;
    startInline();
    emit('error', `worker unavailable (${why}); the simulator runs on the page thread`);
    const msgs = replay; replay = [];
    for (const m of msgs) host.handle(m);
  }
  if (!opts.inline && typeof Worker !== 'undefined') {
    try {
      worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => onMsg(e.data);
      worker.onerror = (e) => { if (!replied) fallback(e && e.message || 'start failed'); else emit('error', `worker: ${e && e.message || 'failed'}`); };
      worker.onmessageerror = () => emit('error', 'worker: a message could not be read');
    } catch (e) { worker = null; }
  }
  if (!worker) startInline();
  const send = (m) => {
    if (disposed) return;
    if (worker) { worker.postMessage(m); if (!replied) replay.push(m); }
    else host.handle(m);
  };

  return {
    get inline() { return !worker; },
    load(netlist, o = {}) { return new Promise(res => { pendingLoad.push(res); send({ cmd: 'load', netlist, carry: o.carry, opts: o.opts }); }); },
    start() { send({ cmd: 'run' }); },
    pause() { send({ cmd: 'pause' }); },
    stepOnce(dt) { send({ cmd: 'step', dt }); },
    setSpeed(x) { send({ cmd: 'speed', x }); },
    reset() { send({ cmd: 'reset' }); },
    setParam(owner, key, value) { send({ cmd: 'param', owner, key, value }); },
    patch(owner, elements) { send({ cmd: 'patch', owner, elements }); },
    press(id, on) { send({ cmd: 'press', id, on }); },
    repair(owner) { send({ cmd: 'repair', owner }); },
    loadProgram(mcu, program) { return new Promise(res => { progWait.push(res); send({ cmd: 'program', mcu, program }); }); },
    serialIn(mcu, text) { send({ cmd: 'serial', mcu, text }); },
    setProbe(probe) { send({ cmd: 'probe', probe }); },
    removeProbe(id) { send({ cmd: 'probe', remove: id }); },
    measureR(probe) { return new Promise(res => { const id = reqId++; mrWait.set(id, res); send({ cmd: 'measureR', probe, reqId: id }); }); },
    on(type, fn) { if (!ls[type]) ls[type] = new Set(); ls[type].add(fn); return () => ls[type].delete(fn); },
    dispose() {
      if (disposed) return;
      send({ cmd: 'dispose' });
      disposed = true;
      if (worker) { worker.terminate(); worker = null; }
      for (const s of Object.values(ls)) s.clear();
    },
  };
}
