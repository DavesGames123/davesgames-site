// worker.js — makes the city off the main thread (module worker).
//
// Messages in:   { id, type: 'gen', opts }      -> { id, city }
//                { id, type: 'mesh', light }    -> { id, mesh }  (3D buffers of the last city)
// Errors go back as { id, error }. main.js runs gen.js on the main thread
// when a module worker cannot start.
//
// grep: onmessage  type === 'gen'  type === 'mesh'

import { generate } from './gen.js';

let last = null;

self.onmessage = async (e) => {
  const { id, type } = e.data || {};
  try {
    if (type === 'gen') {
      last = await generate(e.data.opts);
      self.postMessage({ id, city: last });
    } else if (type === 'mesh') {
      if (!last) throw new Error('no city yet');
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
