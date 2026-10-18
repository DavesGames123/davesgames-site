// ============================================================================
//  DLA TERRAIN  ·  weather-worker.js — runs weather-model.js off the main
//  thread (package SKY). sky-state.js createSky starts it as a module worker.
// ----------------------------------------------------------------------------
//  IN   { type: 'reset', epoch, seed, prevail, id, over, env, cells, t, spin }
//       { type: 'preset', id, over }      a front starts at the next step
//       { type: 'cells', cells }          a new terrain (n x n heights)
//       { type: 'step', env }             one step of DT s
//  OUT  { type: 'snap', snap }            after each reset and step (snap.kind
//                                         'reset' or 'step', snap.epoch of the
//                                         last reset); the data buffer is
//                                         transferred
//  A model step costs about 2 ms (64 x 64). The messages run in order, so a
//  preset or a terrain applies to the steps after it.
// ============================================================================
import { createModel } from './weather-model.js';

let model = null, epoch = 0;
function send(snap, kind) {
  snap.epoch = epoch;
  snap.kind = kind;
  snap.fronts = model.frontPos();
  snap.baseId = model.baseId;
  self.postMessage({ type: 'snap', snap }, [snap.data.buffer]);
}
self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'reset') {
      epoch = m.epoch;
      model = createModel({ seed: m.seed, prevail: m.prevail });
      model.setCells(m.cells);
      model.setPreset(m.id, m.over, true);
      model.init(m.env, m.spin ?? 90);
      model.t = m.t;
      send(model.snapshot(), 'reset');
    } else if (!model) {
      return;
    } else if (m.type === 'preset') {
      model.setPreset(m.id, m.over, false);
    } else if (m.type === 'cells') {
      model.setCells(m.cells);
    } else if (m.type === 'step') {
      model.step(m.env);
      send(model.snapshot(), 'step');
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message || err) });
  }
};
