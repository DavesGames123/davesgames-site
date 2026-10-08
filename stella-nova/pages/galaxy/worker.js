// ============================================================================
//  GALAXY  ·  worker.js — builds galaxies off the main thread
// ----------------------------------------------------------------------------
//  main.js posts { id, P, opts }; the worker answers { id, built } with the
//  star array transferred. buildGalaxy takes 0.2-1 s for 160k stars, so a
//  build on the main thread would stall the frame loop and saver cuts.
// ============================================================================
import { buildGalaxy } from './model.js';
self.onmessage = e => {
  const { id, P, opts } = e.data;
  try {
    const b = buildGalaxy(P, opts);
    const stars = b.stars.slice();
    self.postMessage({ id, built: { gals: b.gals, nGal: b.nGal, stars, count: b.count, meta: b.meta, P: b.P, list: b.list.map(g => ({ rot: g.rot, centre: g.centre, L: g.L, scale: g.scale, seedOff: g.seedOff, P: g.P })) } }, [stars.buffer, b.gals.buffer]);
  } catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
};
