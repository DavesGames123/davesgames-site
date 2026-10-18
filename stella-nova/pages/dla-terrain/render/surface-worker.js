// ============================================================================
//  DLA TERRAIN  ·  render/surface-worker.js — the surface fields off the main
//  thread (GROUND). Module worker: { id, res, t } -> { id, m, data, wind,
//  strata, glacier, latitude, stats } (data transferred) or { id, error }.
//  t holds the Terrain fields that render/surface-sim.js simulateSurface
//  reads (n, worldSize, seaLevel, height, flow, sediment, water, river,
//  moisture, temperature, opts).
// ============================================================================
import { simulateSurface } from './surface-sim.js';

self.onmessage = async (e) => {
  const { id, res, t } = e.data || {};
  try {
    const s = await simulateSurface(t, { res });
    self.postMessage({ id, m: s.m, data: s.data, wind: s.wind, strata: s.strata, glacier: s.glacier, stats: s.stats }, [s.data.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
