// ============================================================================
//  BIOME PARTS  ·  worker.js — Taiga-S1 off the main thread
// ----------------------------------------------------------------------------
//  A module worker. It loads the weights once (taiga-s1/model.safetensors and
//  config.json, next to the page) and runs core.Runner: every forward pass
//  and every session step happens here, so the ray marcher keeps its frames.
//  Protocol: { id, cmd, arg } in, { id, ok, value | error } out; cmd is one of
//  start, think, act, log, result. The first message back is { ready, params }.
// ============================================================================
import { Runner } from './core.js';

let runner = null;
const base = new URL('../taiga-s1/', import.meta.url);
const ready = (async () => {
  const [buf, cfg] = await Promise.all([fetch(new URL('model.safetensors', base)).then(r => r.arrayBuffer()), fetch(new URL('config.json', base)).then(r => r.json())]);
  runner = Runner.fromBuffers(buf, cfg);
  self.postMessage({ ready: true, params: runner.M.params, temperature: cfg.config.temperature, version: cfg.metadata && cfg.metadata.version });
})().catch(e => self.postMessage({ ready: false, error: String(e && e.message || e) }));

self.onmessage = async ev => {
  const { id, cmd, arg } = ev.data;
  try {
    await ready;
    const value = runner[cmd](arg);
    self.postMessage({ id, ok: true, value });
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e && e.stack || e) });
  }
};
