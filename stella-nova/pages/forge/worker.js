// ============================================================================
//  PLANET FORGE  ·  worker.js — one generator worker (module worker)
// ----------------------------------------------------------------------------
//  Messages in:
//    { id, cmd: 'rows', planet, W, y0, y1 }  -> { id, part } (row stripe)
//    { id, cmd: 'finish', planet, M }       -> { id, normal, ao, stats, reliefKm }
//  prepare() is cached by the recipe JSON, so a worker builds the craters,
//  plates and height quantiles once per planet, not once per stripe.
// ============================================================================
import { prepare, sampleRows, finish } from './maps.js';

let key = '', ctx = null;
const ctxFor = P => { const k = JSON.stringify(P); if (k !== key) { ctx = prepare(P); key = k; } return ctx; };

self.onmessage = ({ data: m }) => {
  try {
    if (m.cmd === 'rows') {
      const part = sampleRows(ctxFor(m.planet), m.W, m.y0, m.y1);
      self.postMessage({ id: m.id, part }, [part.height.buffer, part.albedo.buffer, part.mat.buffer, part.emissive.buffer, part.cloud.buffer]);
    } else if (m.cmd === 'finish') {
      const M = finish(m.M, m.planet, ctxFor(m.planet));
      self.postMessage({ id: m.id, normal: M.normal, ao: M.ao, stats: M.stats, reliefKm: M.reliefKm }, [M.normal.buffer, M.ao.buffer]);
    }
  } catch (e) { self.postMessage({ id: m.id, error: String(e && e.stack || e) }); }
};
