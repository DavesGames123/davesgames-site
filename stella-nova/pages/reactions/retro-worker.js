// ============================================================================
//  REACTIONS  ·  retro-worker.js — the route search off the main thread
// ----------------------------------------------------------------------------
//  A module worker. It loads OpenChemLib (no force-field tables: the search
//  needs only graphs and ID codes) and data/species.json once, then answers
//  { id, smiles | sp, maxSteps } with { id, result } (retro.js findRoutes)
//  or { id, error }.
// ============================================================================
import { setOCL } from './react.js';
import { useData, graphOf } from './species.js';
import { fromOCL } from './rxgraph.js';
import { findRoutes, setRetroOCL } from './retro.js';

let ready = null;
function boot() {
  if (!ready) ready = (async () => {
    const [OCL, data] = await Promise.all([
      import(new URL('../../vendor/openchemlib@9.25.1/dist/openchemlib.js', import.meta.url).href),
      fetch(new URL('data/species.json', import.meta.url)).then(r => r.json()),
    ]);
    setOCL(OCL); setRetroOCL(OCL); useData(data);
    return OCL;
  })();
  return ready;
}
self.onmessage = async e => {
  const { id, smiles, sp, maxSteps } = e.data;
  try {
    const OCL = await boot();
    const G = sp ? graphOf(sp) : fromOCL(OCL, OCL.Molecule.fromSmiles(smiles));
    const result = findRoutes(G, { maxSteps: maxSteps || 6 });
    self.postMessage({ id, result });
  } catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
};
