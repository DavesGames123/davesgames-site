// ============================================================================
//  BREADBOARD LAB  ·  sim/host.js — the sim loop behind the worker messages
// ----------------------------------------------------------------------------
//  createHost(post) handles the worker commands of contract 3.8 and posts the
//  replies. sim/worker.js wraps it in a module worker; sim/client.js uses it
//  directly in inline mode (node tests, or no Worker). One code path, so the
//  inline fallback behaves like the worker.
//
//  REAL TIME. The loop runs in slices of at most 12 ms. Each slice targets
//  t_sim = t0 + speed · (wall − wall0). If the sim is more than 100 ms of
//  wall time behind, the debt is dropped (the clock is rebased), so a heavy
//  circuit slows down instead of locking the page. ratio = sim seconds per
//  wall second / speed, over the last second.
//
//  CARRY. load(netlist) keeps the state of the old engine (capacitor
//  voltages, inductor currents, damage, the running MCU) when ids match, so
//  a wire change rebuilds the netlist and keeps running.
//
//  FRAMES at 30 Hz: {type:'frame', ...Frame}, typed arrays transferred. Then
//  one {type:'event'} per SimEvent and {type:'serial', mcu, text}.
//
//  GREP MAP
//    createHost .......... the command switch (handle)
//    loop / rebase ....... the real-time slices
//    postFrame ........... frame, events, serial
//    MCU_RUNTIME ......... the lazy import of mcu/runtime.js
// ============================================================================
import { createEngine } from './engine.js';

const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const SLICE_MS = 12, FRAME_MS = 1000 / 30, DEBT_MS = 100;

let runtimePromise = null;
function loadRuntime() {
  if (!runtimePromise) {
    runtimePromise = import('../mcu/runtime.js')
      .then(m => (spec) => m.createMcu(spec))
      .catch(() => null);
  }
  return runtimePromise;
}

export function createHost(post, opts = {}) {
  let eng = null, running = false, speed = 1, timer = null, disposed = false;
  let wall0 = 0, sim0 = 0, lastFrame = 0;
  let rWall = 0, rSim = 0, ratio = 1;
  let mcuFactory = opts.mcuFactory || null;
  let queue = Promise.resolve();

  const rebase = () => { wall0 = nowMs(); sim0 = eng ? eng.t : 0; rWall = wall0; rSim = sim0; };
  const state = () => post({ type: 'state', running, speed, t: eng ? eng.t : 0, ratio });

  function postFrame() {
    if (!eng) return;
    const f = eng.frame();
    f.speed = speed; f.running = running; f.ratio = ratio;
    const tr = [f.nodeV.buffer, f.wires.buffer];
    for (const k in f.probes) { const p = f.probes[k]; if (p.kind === 'scope') for (const c of p.ch) tr.push(c.buffer); }
    post({ type: 'frame', ...f }, tr);
    for (const ev of eng.drainEvents()) post({ type: 'event', ...ev });
    for (const s of eng.drainSerial()) post({ type: 'serial', mcu: s.mcu, text: s.text });
    lastFrame = nowMs();
  }

  function schedule(ms) {
    if (disposed || timer != null) return;
    timer = setTimeout(() => { timer = null; loop(); }, ms);
  }
  function loop() {
    if (!running || !eng || disposed) return;
    const w = nowMs();
    let target = sim0 + speed * (w - wall0) / 1000;
    if ((target - eng.t) / Math.max(speed, 1e-9) > DEBT_MS / 1000) {
      sim0 = eng.t - speed * DEBT_MS / 1000 * 0.5; wall0 = w;
      target = sim0 + speed * DEBT_MS / 1000 * 0.5;
    }
    try { eng.advanceTo(target, SLICE_MS); }
    catch (e) { running = false; post({ type: 'error', msg: `sim: ${e && e.message || e}` }); state(); return; }
    const w2 = nowMs();
    if (w2 - rWall >= 1000) {
      ratio = (eng.t - rSim) / ((w2 - rWall) / 1000) / Math.max(speed, 1e-12);
      rWall = w2; rSim = eng.t;
    } else if (w2 - rWall >= 250 && ratio === 1) {
      ratio = (eng.t - rSim) / ((w2 - rWall) / 1000) / Math.max(speed, 1e-12);
    }
    if (w2 - lastFrame >= FRAME_MS) postFrame();
    schedule(eng.t >= target - 1e-12 ? 4 : 0);
  }

  async function doLoad(msg) {
    if (!mcuFactory && opts.loadRuntime !== false) mcuFactory = await loadRuntime();
    const old = eng;
    const nl = msg.netlist;
    eng = createEngine(nl, { mcuFactory, ...(msg.opts || {}) });
    let init;
    if (old && msg.carry !== false && old.started) { eng.restoreState(old.snapshotState()); init = { ok: true, method: 'carry' }; }
    else init = eng._start();
    const warnings = [...(nl.warnings || []), ...eng.warnings];
    post({ type: 'loaded', ok: !!(init && init.ok), warnings, dcop: init, programs: eng.loadResults });
    rebase();
    postFrame();
    if (running) schedule(0);
  }

  function handle(msg) {
    if (disposed || !msg) return;
    const run = (f) => { queue = queue.then(f).catch(e => post({ type: 'error', msg: String(e && e.message || e) })); return queue; };
    switch (msg.cmd) {
      case 'load': return run(() => doLoad(msg));
      default: return run(() => cmd(msg));
    }
  }

  function cmd(msg) {
    switch (msg.cmd) {
      case 'run': running = true; rebase(); state(); schedule(0); break;
      case 'pause': running = false; state(); postFrame(); break;
      case 'reset': if (eng) { eng.reset(); eng._start(); } rebase(); ratio = 1; state(); postFrame(); break;
      case 'dispose': running = false; disposed = true; if (timer != null) clearTimeout(timer); timer = null; eng = null; break;
      case 'speed': speed = Math.max(1e-6, +msg.x || 1); rebase(); state(); break;
      case 'step': if (eng) { eng.advanceTo(eng.t + (+msg.dt || 1e-3)); postFrame(); state(); } break;
      case 'param': if (eng) eng.setParam(msg.owner, msg.key, msg.value); break;
      case 'patch': if (eng) eng.patch(msg.owner, msg.elements); break;
      case 'press': if (eng) eng.press(msg.id, !!msg.on); break;
      case 'repair': if (eng) { eng.repair(msg.owner); postFrame(); } break;
      case 'program': if (eng) { const r = eng.loadProgram(msg.mcu, msg.program); post({ type: 'program', mcu: msg.mcu, ...r }); } break;
      case 'serial': if (eng) eng.serialIn(msg.mcu, msg.text); break;
      case 'probe': if (eng) { if (msg.probe) eng.addProbe(msg.probe); else if (msg.remove) eng.removeProbe(msg.remove); } break;
      case 'measureR': {
        let ohms = Infinity;
        if (eng) {
          const p = eng.probeSpecs.find(q => q.id === msg.probe);
          if (p) ohms = eng.measureR(p.leads.red, p.leads.black);
          else if (msg.a != null && msg.b != null) ohms = eng.measureR(msg.a, msg.b);
        }
        post({ type: 'measureR', reqId: msg.reqId, ohms });
        break;
      }
      default: post({ type: 'error', msg: `unknown command ${msg.cmd}` });
    }
  }

  return { handle, get engine() { return eng; } };
}
