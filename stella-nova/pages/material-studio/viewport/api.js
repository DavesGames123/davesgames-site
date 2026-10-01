// ============================================================================
//  MATERIAL STUDIO  ·  viewport/api.js — __studio.viewport
// ────────────────────────────────────────────────────────────────────────────
//  The object that init() registers as __studio.viewport. Panels, export.js
//  and the headless checks drive the viewport through it. setMesh() and
//  setDebugView() check the name, then write state.view through the store.
//
//  GREP TARGETS
//      setMesh ................ contract MESHES or 'custom'
//      setDebugView ........... one of VIEWPORT_DEBUG_VIEWS
//      export const api ....... the __studio.viewport object
//      stats .................. fps, frame ms, loop, mesh, maps, env, pipelines
// ============================================================================
import * as C from '../contract.js';
import { VIEWPORT_DEBUG_VIEWS, store, cam, R } from './state.js';
import { setMaps, useTestMaps, pinA } from './material.js';
import { makeTestMaps } from './test-maps.js';
import { loadOBJFile } from './preview-mesh.js';
import { requestRender } from './render.js';
import { renderOffscreen, screenshot, screenshotDataURL } from './offscreen.js';
import { selfTest } from './selftest.js';

/** @param {string} name one of contract MESHES, or 'custom' after loadOBJFile */
export function setMesh(name) {
  if (name !== 'custom' && !C.MESHES.includes(name)) throw new Error('unknown mesh ' + name);
  store.setView({ mesh: name });
}
/** @param {string} name one of VIEWPORT_DEBUG_VIEWS */
export function setDebugView(name) {
  if (!VIEWPORT_DEBUG_VIEWS.includes(name)) throw new Error('unknown debug view ' + name);
  store.setView({ debug: name });
}

/** __studio.viewport */
export const api = {
  setMesh, setDebugView, setMaps, screenshot, screenshotDataURL, renderOffscreen, requestRender,
  useTestMaps, makeTestMaps, pinA, loadOBJFile,
  frame: () => cam && cam.frame(),
  get camera() { return cam; },
  get envKey() { return R.env && R.env.key; },
  stats: () => ({ fps: R.fps, frameMs: R.frameMs, looping: !!R.raf, mesh: R.mesh && { name: R.mesh.name, vertices: R.mesh.vertices, triangles: R.mesh.triangles }, maps: R.cur && R.cur.label, env: R.env && R.env.key, pipelines: R.pipes.size }),
  selfTest,
};
