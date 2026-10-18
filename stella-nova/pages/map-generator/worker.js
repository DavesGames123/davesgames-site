// worker.js — makes the city off the main thread (module worker).
//
// Messages in:   { id, type: 'gen', opts }      -> { id, city }
//                { id, type: 'mesh', light }    -> { id, mesh }  (3D buffers of the last city)
// While it works:                               -> { id, progress: { k, sub } }
//   k is a stage key of layout.js STAGES (terrain, field, water, main,
//   major, minor, blocks, lots, mesh), sub the share 0..1 inside the
//   stage (the terrain sends the LIB frac). main.js shows it in #loading.
// Errors go back as { id, error }. main.js runs gen.js on the main thread
// when a module worker cannot start.
//
// grep: onmessage  type === 'gen'  type === 'mesh'  function progress

import { generate } from './gen.js';

let last = null;

// Post at most one terrain progress message per 2% of the bar.
function progress(id) {
  let lastF = -1;
  return {
    onTerrain: (p) => {
      const f = +p.frac || 0;
      if (f - lastF < 0.02 && f < 1) return;
      lastF = f;
      self.postMessage({ id, progress: { k: 'terrain', sub: f } });
    },
    onStage: (k) => { self.postMessage({ id, progress: { k, sub: 0 } }); },
  };
}

self.onmessage = async (e) => {
  const { id, type } = e.data || {};
  try {
    if (type === 'gen') {
      last = await generate({ ...e.data.opts, ...progress(id) });
      self.postMessage({ id, city: last });
    } else if (type === 'mesh') {
      if (!last) throw new Error('no city yet');
      self.postMessage({ id, progress: { k: 'mesh', sub: 0 } });
      const { buildMesh } = await import('./mesh3d.js');
      const { timeline } = await import('./playback.js');
      const mesh = buildMesh(last, timeline(last));
      self.postMessage({ id, mesh }, mesh.transfer);
      delete mesh.transfer;
    }
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
