// ============================================================================
//  DLAF PAGE  ·  surface.js — feed the SDF mesher, collect brick records
// ----------------------------------------------------------------------------
//  The page side of the surface view. It runs surface-core.js in the module
//  worker surface-worker.js when the browser gives one, or inline on the
//  main thread in a time budget per frame (no Worker, a worker error, the
//  node tests). Either way the page sees one interface:
//
//    const sf = createSurface({ inline })
//    sf.reset(opts)     a new surface (surfaceOptions): a regrow, or a new
//                       blend, flow strength or resolution
//    sf.push(model)     send the particles that joined since the last push
//    sf.finish()        the growth stopped: flush the radius steps
//    sf.tick(ms)        inline mode: one slice of core work
//    sf.take()          the brick records that arrived (and a cleared flag)
//    sf.applied         particles that the mesher has, for the growth pace
//    sf.busy, sf.verts, sf.mode ('worker' | 'inline')
//
//  grep -n targets
//    worker start .......... "function startWorker"
//    messages .............. "function onMsg"
// ============================================================================
import { createSurfaceCore } from './surface-core.js';

export function createSurface(o = {}) {
  let worker = null, core = null, opts = null, gen = 0;
  let sent = 0, applied = 0, busy = false, verts = 0, tris = 0, model = null, cleared = false;
  let queue = [];

  function onMsg(e) {
    const m = e.data;
    if (!m || m.gen !== gen) return;
    if (m.type === 'mesh') {
      for (const r of m.list) queue.push(r);
      applied = m.applied; busy = m.busy; verts = m.verts; tris = m.tris;
    }
  }
  function startWorker() {
    if (o.inline || typeof Worker === 'undefined') return null;
    try {
      const w = new Worker(new URL('./surface-worker.js', import.meta.url), { type: 'module' });
      w.onmessage = onMsg;
      w.onerror = (ev) => { if (ev && ev.preventDefault) ev.preventDefault(); toInline(); };
      return w;
    } catch (err) { return null; }
  }
  // A worker that fails (no module workers) hands over to the inline core.
  function toInline() {
    if (worker) { try { worker.terminate(); } catch (e) { /* gone */ } }
    worker = null;
    if (opts) { const keep = model; reset(opts); if (keep) push(keep); }
  }
  worker = startWorker();

  function reset(nopts) {
    opts = nopts; gen++; sent = 0; applied = 0; busy = false; verts = 0; tris = 0;
    queue = []; cleared = true;
    if (worker) { worker.postMessage({ type: 'reset', gen, opts }); core = null; }
    else core = createSurfaceCore(opts);
  }

  function push(m) {
    model = m;
    if (!opts || !m) return 0;
    const n = m.count;
    if (n <= sent) return 0;
    const a = sent;
    if (worker) {
      const pos = new Float32Array(m.pos.subarray(a * 3, n * 3)), parent = new Int32Array(m.parent.subarray(a, n));
      worker.postMessage({ type: 'add', gen, from: a, pos, parent }, [pos.buffer, parent.buffer]);
    } else core.add(m.pos, m.parent, a, n, 0);
    sent = n; busy = true;
    return n - a;
  }

  function finish() {
    if (worker) worker.postMessage({ type: 'finish', gen });
    else if (core) core.finish();
  }

  function tick(ms = 6) {
    if (worker || !core) return;
    if (core.busy) for (const r of core.update(ms)) queue.push(r);
    applied = core.count; busy = core.busy; verts = core.stats.verts; tris = core.stats.tris;
  }

  function take() {
    const q = queue, c = cleared;
    queue = []; cleared = false;
    return { list: q, cleared: c };
  }

  return {
    reset, push, finish, tick, take,
    get applied() { return applied; }, get sent() { return sent; },
    get busy() { return busy || (worker ? applied < sent : false); },
    get verts() { return verts; }, get tris() { return tris; },
    get mode() { return worker ? 'worker' : 'inline'; },
    get opts() { return opts; },
  };
}
