// ============================================================================
//  STEREOGRAM ENGINE  ·  engine/client.js — the page side of the worker
// ----------------------------------------------------------------------------
//  createEngineClient(worker) -> { call(op, ...args) -> Promise, close() }
//  Each call gets an id; the reply with that id settles the promise. The
//  protocol is in worker-core.js.
//
//  grep -n targets: "export function createEngineClient"
// ============================================================================
export function createEngineClient(worker) {
  let next = 1;
  const wait = new Map();
  worker.addEventListener('message', ev => {
    const m = ev.data, w = m && wait.get(m.id);
    if (!w) return;
    wait.delete(m.id);
    if (m.ok) w.res(m.result); else w.rej(new Error(m.error));
  });
  return {
    call(op, ...args) {
      const id = next++;
      return new Promise((res, rej) => { wait.set(id, { res, rej }); worker.postMessage({ id, op, args }); });
    },
    close() { worker.terminate(); for (const w of wait.values()) w.rej(new Error('engine worker closed')); wait.clear(); },
  };
}
