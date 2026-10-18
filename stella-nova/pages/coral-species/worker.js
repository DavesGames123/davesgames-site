// ============================================================================
//  CORAL SPECIES  ·  worker.js  ·  the reef worker on the small rock base
// ----------------------------------------------------------------------------
//  A module worker. It runs the runner of pages/coral-reef/mesh-worker.js
//  (createReefRunner: the DLA growth of reef.js and the SDF meshes of
//  coral-sdf.js) with the rock of base.js in place of the reef rock. The
//  protocol is the one in the mesh-worker.js header: 'init', then
//  'single' for the one colony, 'rate', 'env', 'play'.
//
//  WRAPPER. mesh-worker.js wires itself to self.onmessage when it loads
//  in a worker, unless self.__reefTest is set. This file sets the flag,
//  then imports it (a dynamic import, so the flag comes first), and wires
//  the runner with its own makeRock. Messages that come before the import
//  is done wait in a queue. No change to the coral-reef files.
// ============================================================================
self.__reefTest = true;
const queue = [];
let run = null;
self.onmessage = e => { if (run) run.onMessage(e.data); else queue.push(e.data); };

(async () => {
  try {
    const [{ createReefRunner }, { createBase }] = await Promise.all([import('../coral-reef/mesh-worker.js'), import('./base.js')]);
    run = createReefRunner({
      post: (m, tr) => self.postMessage(m, tr || []),
      // the SDF only: the page draws the meshes of its own copy
      makeRock: ro => createBase({ seed: ro.seed, mesh: false }),
    });
    while (queue.length) await run.onMessage(queue.shift());
  } catch (e) {
    self.postMessage({ type: 'error', message: String((e && e.stack) || e) });
  }
})();
