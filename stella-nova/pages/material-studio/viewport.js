// ============================================================================
//  MATERIAL STUDIO  ·  viewport.js — the WebGPU 3D material preview
// ────────────────────────────────────────────────────────────────────────────
//  Renders the baked MaterialMaps on a preview mesh in canvas#vp, under the
//  environment from env.js plus up to 4 analytic lights. The viewport renders
//  on demand: an event, a camera move or the turntable asks for a frame, and
//  the loop stops when nothing moves.
//
//  DATA FLOW
//      bake:done (MaterialMaps) ─► setMaps ─► R.cur (material set, group 1)
//      view:changed ─► syncHud, mesh rebuild if mesh/subdiv changed ─► frame
//      env:changed / env.getEnvBindings() ─► envState ─► frame bind group 0
//      camera input (camera.js) ─► requestRender
//      frame: [shadow pass] ─► main HDR pass (bg, ground, mesh A|B, wire)
//             ─► tonemap pass ─► [FXAA pass] ─► canvas (or offscreen texture)
//
//  ENVIRONMENT  (three kinds, picked per frame by envState)
//      'lib'  env.js has envWGSL + envBindGroupEntries and getEnvBindings()
//             is not null: the generated chunk pastes envWGSL({group:0,
//             binding:8}) and calls envSpecular / envIrradiance /
//             envBackground, so rotation, intensity, exposure, tint,
//             saturation and the background mode come from env.js (EnvU).
//      'tex'  a generic getEnvBindings() with the fields below.
//      'proc' no environment yet: sky_proc in viewport-common.wgsl.
//  GENERIC ENVIRONMENT FIELDS  (the 'tex' kind, all optional)
//      radiance    GPUTexture, mips: mip m holds roughness m / (mipCount - 1).
//                  6 array layers = cube map, else equirect (u = 0.5 looks
//                  down -Z, v = 0 is up; see env_uv in viewport-common.wgsl).
//      irradiance  GPUTexture (cube or equirect) with the cosine-weighted mean
//                  radiance, so diffuse = albedo * value. Else `sh` (9 rgb
//                  coefficients, 27 or 36 floats) or, last, the top radiance mip.
//      mipCount, radianceDim / irradianceDim ('cube' | '2d') hints, sunDir.
//      The BRDF LUT and the sampler from env.js are not used: the viewport
//      renders its own LUT (viewport-lut.wgsl, sheen term in .b).
//      state.env.rotation is in degrees, state.env.intensity multiplies IBL.
//      state.env.lights[i] (same reading as env.js writeUniform):
//      {type:'dir'|'point', color:'#hex', intensity, on (false = off),
//      dir:[x,y,z] toward the light, pos (point; else dir * dist), dist
//      (default 3), range (point cutoff, 0 = pure inverse square)}.
//      The first directional light casts the shadow-map shadow.
//
//  VIEW STATE  (store state.view; VIEW_DEFAULTS adds the keys the contract
//      does not list. The HUD and any panel change them with store.setView.)
//
//  SECTIONS  (grep -n the banner to jump)
//      constants ........ VIEWPORT_DEBUG_VIEWS, VIEW_DEFAULTS, formats
//      init ............. module entry, shader load, static resources
//      static resources . samplers, layouts, LUT, dummies, shadow map
//      environment ...... envState, envChunk (generated WGSL)
//      pipelines ........ pbrPipeline, bgPipeline, groundPipeline, postPipeline
//      material sets .... makeMatSet, setMaps, defaultSet, makeTestSet, snapshot
//      mesh ............. ensureMesh, uploadMesh, loadOBJFile
//      lights ........... lightsState, key light and shadow matrix
//      targets .......... makeTargets (HDR, MSAA, depth, LDR)
//      render ........... renderScene, requestRender, tick
//      offscreen ........ renderOffscreen, screenshot, readback
//      hud .............. buildHud, syncHud, compare divider, OBJ drop
//      prefs ............ localStorage restore and save (per viewer)
//      api / selfTest ... __studio.viewport
// ============================================================================
import * as C from './contract.js';
import { buildMesh, parseOBJ, edgeIndices, MESH_LABELS } from './mesh.js';
import { createOrbitCamera, lookAt, ortho, m4mul } from './camera.js';
import { loadShaders } from '../../lib/shaders.js';
import {
  VIEWPORT_DEBUG_VIEWS, DEBUG_LABELS, TONEMAP_LABELS, VIEW_DEFAULTS, HDR, DEPTH, FRAME_FLOATS, MAT_FLOATS,
  store, state, gpu, device, envMod, canvas, wrap, hud, gctx, cam, bind,
  R, clamp, warnOnce, hexToLinear, norm3, idOf,
} from './viewport/state.js';
export { VIEWPORT_DEBUG_VIEWS, DEBUG_LABELS, TONEMAP_LABELS, VIEW_DEFAULTS } from './viewport/state.js';
import { renderOffscreen, screenshot, screenshotDataURL } from './viewport/offscreen.js';
export { renderOffscreen, screenshot, screenshotDataURL } from './viewport/offscreen.js';
import { requestRender, renderScene } from './viewport/render.js';
export { requestRender } from './viewport/render.js';
import { ensureMesh, ensureEdges, loadOBJFile } from './viewport/preview-mesh.js';
export { loadOBJFile } from './viewport/preview-mesh.js';
import { makeMatSet, destroySet, defaultSet, snapshot, setMaps, pinA, useTestMaps } from './viewport/material.js';
export { setMaps, pinA, useTestMaps } from './viewport/material.js';
import { buildHud, syncHud, placeDivider, updateStats } from './viewport/hud.js';
import { writeFrame, writeMaterial } from './viewport/uniforms.js';
import { pbrPipeline, shadowPipeline, bgPipeline, postPipeline, blitPipeline } from './viewport/pipelines.js';
import { PREF_VIEW_KEYS, readPrefs, savePrefsSoon } from './viewport/prefs.js';
import { makeTargets, destroyTargets, aaMode } from './viewport/targets.js';
import { lightsState, shadowMatrix } from './viewport/lights.js';
import { mapTexture, writeHalf } from './viewport/textures.js';
import { makeTestMaps } from './viewport/test-maps.js';
export { makeTestMaps } from './viewport/test-maps.js';
import { safeEnvBindings, envState, envChunk, frameLayout, ensureFrameBG } from './viewport/environment.js';
import { createStatic, shaderModule, buildLut } from './viewport/resources.js';

// ------------------------------------------------------------ constants

// ------------------------------------------------------------ init
/** @param {object} ctx main.js module context */
export async function init(ctx) {
  bind({ store: ctx.store, state: ctx.store.state, gpu: ctx.gpu, envMod: ctx.modules.env || null });
  for (const [k, v] of Object.entries(VIEW_DEFAULTS)) if (state.view[k] === undefined) state.view[k] = Array.isArray(v) ? [...v] : v;
  const prefs = readPrefs();
  if (prefs.view) for (const k of PREF_VIEW_KEYS) if (prefs.view[k] !== undefined) state.view[k] = prefs.view[k];
  if (!C.MESHES.includes(state.view.mesh)) state.view.mesh = 'sphere';
  if (!VIEWPORT_DEBUG_VIEWS.includes(state.view.debug)) state.view.debug = 'lit';

  bind({ canvas: ctx.$('vp') }); bind({ wrap: canvas.parentElement, hud: ctx.$('vp-hud') });
  buildHud();
  ctx.register('viewport', api);

  if (!gpu.ok || !gpu.device) { hud.classList.add('vp-nogpu'); return; }
  bind({ device: gpu.device });
  R.SH = await loadShaders(import.meta.url, [
    'shaders/viewport-common.wgsl', 'shaders/pbr.wgsl', 'shaders/viewport-bg.wgsl',
    'shaders/viewport-post.wgsl', 'shaders/viewport-lut.wgsl',
  ]);
  createStatic();
  buildLut();
  R.def = defaultSet();
  R.cur = R.def;

  bind({ cam: createOrbitCamera(canvas, {
    onEnvRotate: d => { let r = (Number(state.env.rotation) || 0) + d; r = ((r + 180) % 360 + 360) % 360 - 180; store.setEnv({ rotation: Math.round(r * 10) / 10 }); },
    getRadius: () => (R.mesh && R.mesh.radius) || 1,
  }) });
  cam.fov = clamp(+state.view.fov || 35, 10, 100);
  cam.update(0, Math.max(1, wrap.clientWidth) / Math.max(1, wrap.clientHeight));
  // keep the saved angles, refit the distance to this viewport's aspect
  if (prefs.camera) cam.setState({ yaw: prefs.camera.yaw, pitch: prefs.camera.pitch, fov: prefs.camera.fov });
  cam.frame(1, !!prefs.camera, true);
  cam.autoRotate = !!state.view.autoRotate;
  cam.onChange(() => { requestRender(); savePrefsSoon(); });

  bind({ gctx: gpu.configureCanvas(canvas) });
  resize();
  new ResizeObserver(() => { resize(); requestRender(); }).observe(wrap);

  store.on('bake:start', () => { R.baking = true; updateStats(); });
  store.on('bake:done', maps => { R.baking = false; setMaps(maps); });
  store.on('bake:error', () => { R.baking = false; updateStats(); });
  store.on('view:changed', onView);
  store.on('env:changed', () => { R.shadowSig = ''; requestRender(); });
  store.on('*', evt => { if (typeof evt === 'string' && evt.startsWith('env:') && evt !== 'env:changed') requestRender(); });
  // the environment may finish loading without an event: poll the handle
  R.envPoll = setInterval(() => {
    const b = safeEnvBindings();
    const id = b && (b.specTex || b.radiance);
    const ver = b && b.version;
    if (id !== (R.env && R.env.rad) || ver !== R.envVersion) { R.envVersion = ver; requestRender(); }
  }, 400);

  gpu.onTeardown(dispose);
  gpu.onDeviceLost?.(() => { R.disposed = true; cancelAnimationFrame(R.raf); });
  if (state.maps) setMaps(state.maps);
  syncHud();
  requestRender();
}

function dispose() {
  R.disposed = true;
  cancelAnimationFrame(R.raf); R.raf = 0;
  clearInterval(R.envPoll);
  for (const s of [R.A, R.lastCopy, R.test, R.def]) destroySet(s);
  destroyTargets(R.targets);
}

// ------------------------------------------------------------ static resources
// ------------------------------------------------------------ environment
// ------------------------------------------------------------ pipelines
// ------------------------------------------------------------ material sets
// ------------------------------------------------------------ mesh
// ------------------------------------------------------------ targets
function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const r = wrap.getBoundingClientRect();
  const w = clamp(Math.round(r.width * dpr), 1, 4096), h = clamp(Math.round(r.height * dpr), 1, 4096);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  placeDivider();
}

// ------------------------------------------------------------ render
// ------------------------------------------------------------ offscreen
// ------------------------------------------------------------ hud
function onView(v) {
  if (!cam) { syncHud(); return; }
  if (v.mesh === 'custom' && !R.custom) { state.view.mesh = 'sphere'; }
  if (Math.abs(cam.fov - (+v.fov || 35)) > 1e-6) cam.setState({ fov: clamp(+v.fov || 35, 10, 100) });
  cam.autoRotate = !!v.autoRotate;
  if (v.compare === 'prev' && !R.lastCopy && R.cur && R.cur !== R.def) R.lastCopy = snapshot(R.cur, 'last');
  if (v.compare === 'off') { destroySet(R.A); R.A = null; destroySet(R.lastCopy); R.lastCopy = null; }
  if (v.compare === 'prev' && R.A && R.A.label === 'pinned') { destroySet(R.A); R.A = null; }
  syncHud();
  savePrefsSoon();
  requestRender();
}

// ------------------------------------------------------------ api / selfTest
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

/** Render every debug view offscreen with the test maps and check for GPU
 *  validation errors and blank output. */
async function selfTest() {
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
