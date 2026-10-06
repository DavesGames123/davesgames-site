// ============================================================================
//  PARTICLE COLLIDER  ·  worker.js — one transport engine in a Web Worker
// ----------------------------------------------------------------------------
//  main.js starts navigator.hardwareConcurrency - 1 of these (2 to 8) and
//  gives each a share of the primaries (transport.js splitPrims). The
//  engine and its physics tables persist between events.
//    in:  { id, prims, seed, opt }
//    out: { id, R } with R = pack(result); the typed arrays are transferred
//         (transport.js transfers). On an error: { id, error }.
// ============================================================================
import { createEngine, pack, transfers } from './transport.js';

let E = null, key = '';
self.onmessage = ev => {
  const { id, prims, seed, opt } = ev.data;
  try {
    const k = JSON.stringify(opt || {});
    if (!E || k !== key) { E = createEngine(opt || {}); key = k; }
    const P = pack(E.run(prims, seed));
    self.postMessage({ id, R: P }, transfers(P));
  } catch (e) {
    self.postMessage({ id, error: String(e && e.stack || e) });
  }
};
