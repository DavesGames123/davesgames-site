// ============================================================================
//  CORAL REEF  ·  coral-link.js  ·  the reef worker link with a fall back
// ----------------------------------------------------------------------------
//  main.js talks to the reef worker (mesh-worker.js) through this link.
//  When the worker fails (no module workers, onerror, messageerror, or an
//  error message before 'ready'), the link stops it and runs the same
//  runner on the main thread (createReefRunner), with a lower budget and
//  small time slices. It replays the state messages (init, budget, current,
//  env, play, rate, and the last reset, single or restore), so the page
//  goes on. The new runner has no parked reef, so a replayed 'restore'
//  acts as 'reset': after a fall back the reef grows again (one time).
//  DOM-free: tests/robust.test.mjs drives it with a fake Worker.
//
//  createCoralLink({ makeWorker, makeRunner, onMessage, onFallback, lower })
//    makeWorker() -> a Worker (or throws)
//    makeRunner(post) -> { onMessage(m) } (mesh-worker.js createReefRunner)
//    onMessage(m)       each message of the worker or the runner
//    onFallback(why)    the link went to the main thread (main.js resets
//                       its gen counter: the runner counts from 0 again)
//    lower(budget) -> budget   the main-thread budget (default: half the
//                       particles and triangles)
//  -> { post(m, transfer), kill(), get local, get why }
//
//  grep -n targets: "export function createCoralLink", "function fallback"
// ============================================================================

const KEEP = ['budget', 'current', 'play', 'rate'];

export function halfBudget(b = {}) {
  const o = Object.assign({}, b);
  if (o.particles) o.particles = Math.max(4000, Math.round(o.particles / 2));
  if (o.tris) o.tris = Math.max(100000, Math.round(o.tris / 2));
  if (o.colonies) o.colonies = Math.max(8, Math.round(o.colonies * 0.7));
  return o;
}

export function createCoralLink({ makeWorker, makeRunner, onMessage, onFallback, lower = halfBudget }) {
  const state = { init: null, last: null, env: {}, keep: {} };
  let worker = null, runner = null, why = '', ready = false, dead = false;

  function remember(m) {
    if (!m || !m.type) return;
    if (m.type === 'init') { state.init = m; state.last = null; }
    else if (m.type === 'reset' || m.type === 'single' || m.type === 'restore') state.last = m;
    else if (m.type === 'env') Object.assign(state.env, m.env || {});
    else if (KEEP.includes(m.type)) state.keep[m.type] = m;
  }
  function fromWorker(m) {
    if (dead) return;
    if (m && m.type === 'ready') ready = true;
    if (m && m.type === 'error' && !ready && worker) { fallback('the reef worker failed: ' + String(m.message || '').split('\n')[0]); return; }
    onMessage(m);
  }
  function fallback(reason) {
    if (runner || dead) return;
    why = reason;
    if (worker) { try { worker.terminate(); } catch (e) { /* gone */ } worker = null; }
    runner = makeRunner(m => { if (!dead) onMessage(m); });
    if (onFallback) onFallback(reason);
    runner.onMessage({ type: 'budget', growMs: 3, meshMs: 4, maxPost: 1500 });
    if (state.init) runner.onMessage(Object.assign({}, state.init, { budget: lower(state.init.budget || {}) }));
    for (const k of KEEP) if (k !== 'budget' && state.keep[k]) runner.onMessage(state.keep[k]);
    if (Object.keys(state.env).length) runner.onMessage({ type: 'env', env: Object.assign({}, state.env) });
    if (state.last) runner.onMessage(state.last);
  }
  try {
    worker = makeWorker();
    worker.onmessage = e => fromWorker(e.data);
    worker.onerror = e => { if (e && e.preventDefault) e.preventDefault(); fallback('the reef worker stopped: ' + String((e && e.message) || 'error')); };
    worker.onmessageerror = () => fallback('a reef worker message could not be read');
  } catch (e) {
    worker = null;
    fallback('no module worker: ' + String((e && e.message) || e));
  }
  return {
    post(m, tr) {
      if (dead) return;
      if (m && m.type !== 'budget') remember(m);
      if (runner) { runner.onMessage(m); return; }
      try { worker.postMessage(m, tr || []); } catch (e) { fallback('a post to the reef worker failed: ' + String(e && e.message)); }
    },
    kill() { dead = true; if (worker) { try { worker.terminate(); } catch (e) { /* gone */ } } worker = null; },
    get local() { return !!runner; }, get why() { return why; }, get ready() { return ready; },
  };
}
