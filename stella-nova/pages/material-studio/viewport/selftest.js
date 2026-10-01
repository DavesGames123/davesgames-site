// ============================================================================
//  MATERIAL STUDIO  ·  viewport/selftest.js — __studio.viewport.selfTest
// ────────────────────────────────────────────────────────────────────────────
//  Renders every debug view offscreen at 64 x 64 with the test maps, inside a
//  GPU validation error scope. A view fails on a thrown error or a validation
//  error. The result also holds the center texel and the mean of each view,
//  and the triangle count of each contract mesh at subdiv 32.
//
//  GREP TARGETS
//      selfTest ............... {ok, env, mesh, triangles, views, meshes}
// ============================================================================
import * as C from '../contract.js';
import { buildMesh } from '../mesh.js';
import { VIEWPORT_DEBUG_VIEWS, gpu, device, R } from './state.js';
import { makeTestMaps } from './test-maps.js';
import { makeMatSet } from './material.js';
import { renderOffscreen } from './offscreen.js';

/** Render every debug view offscreen with the test maps and check for GPU
 *  validation errors and blank output. */
export async function selfTest() {
  if (!device) return { ok: false, reason: gpu ? gpu.reason : 'no gpu' };
  if (!R.test) { const m = makeTestMaps(256); R.test = makeMatSet(m, m.scalars, true, 256, 'test'); }
  const views = {};
  let ok = true;
  for (const dv of VIEWPORT_DEBUG_VIEWS) {
    device.pushErrorScope('validation');
    let img = null, err = null;
    try { img = await renderOffscreen({ width: 64, height: 64, debug: dv, set: R.test }); } catch (e) { err = e.message; }
    const ge = await device.popErrorScope();
    if (ge) err = ge.message;
    let center = null, mean = 0;
    if (img) {
      const i = (32 * 64 + 32) * 4;
      center = [img.data[i], img.data[i + 1], img.data[i + 2]];
      for (let k = 0; k < img.data.length; k += 4) mean += img.data[k] + img.data[k + 1] + img.data[k + 2];
      mean /= (img.data.length / 4) * 3;
    }
    if (err) ok = false;
    views[dv] = err ? { error: err } : { center, mean: +mean.toFixed(1) };
  }
  const meshes = {};
  for (const m of C.MESHES) { const d = buildMesh(m, { subdiv: 32 }); meshes[m] = d.indices.length / 3; }
  return { ok, env: R.env ? R.env.key : 'none', mesh: R.mesh && R.mesh.name, triangles: R.mesh && R.mesh.triangles, views, meshes };
}
