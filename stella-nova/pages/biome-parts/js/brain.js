// ============================================================================
//  BIOME PARTS  ·  brain.js — the page's handle on Taiga-S1
// ----------------------------------------------------------------------------
//  createBrain() starts worker.js (a module worker). If module workers fail
//  (an old browser), it loads the same Runner on the main thread. Either way
//  the page gets one object with async start / think / act / log / result,
//  and info { params, temperature, where }.
//  terminate() ends the worker (pagehide).
// ============================================================================
export async function createBrain() {
  try { return await workerBrain(); } catch (e) { return await localBrain(e); }
}
function workerBrain() {
  return new Promise((resolve, reject) => {
    let w;
    try { w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); } catch (e) { reject(e); return; }
    const wait = new Map();
    let n = 0;
    const timer = setTimeout(() => { w.terminate(); reject(new Error('worker timeout')); }, 20000);
    w.onerror = e => { clearTimeout(timer); w.terminate(); reject(e); };
    w.onmessage = ev => {
      const m = ev.data;
      if ('ready' in m) {
        clearTimeout(timer);
        if (!m.ready) { w.terminate(); reject(new Error(m.error)); return; }
        const call = (cmd, arg) => new Promise((res, rej) => { const id = ++n; wait.set(id, [res, rej]); w.postMessage({ id, cmd, arg }); });
        resolve({ info: { params: m.params, temperature: m.temperature, version: m.version, where: 'worker' },
          start: a => call('start', a), think: () => call('think'), act: a => call('act', a), log: () => call('log'), result: () => call('result'),
          terminate: () => w.terminate() });
        return;
      }
      const p = wait.get(m.id); if (!p) return;
      wait.delete(m.id);
      if (m.ok) p[0](m.value); else p[1](new Error(m.error));
    };
  });
}
async function localBrain(why) {
  const { Runner } = await import('./core.js');
  const base = new URL('../taiga-s1/', import.meta.url);
  const [buf, cfg] = await Promise.all([fetch(new URL('model.safetensors', base)).then(r => r.arrayBuffer()), fetch(new URL('config.json', base)).then(r => r.json())]);
  const R = Runner.fromBuffers(buf, cfg);
  const wrap = f => async a => f(a);
  return { info: { params: R.M.params, temperature: cfg.config.temperature, version: cfg.metadata && cfg.metadata.version, where: 'main thread (' + String(why && why.message || why) + ')' },
    start: wrap(a => R.start(a)), think: wrap(() => R.think()), act: wrap(a => R.act(a)), log: wrap(() => R.log()), result: wrap(() => R.result()), terminate: () => {} };
}
