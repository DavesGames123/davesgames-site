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
//  This file is the entry that main.js loads. It keeps init(), the store
//  subscriptions, dispose, resize and the view change handler, and it
//  re-exports the public API. The work is in viewport/, one concern per
//  file. Each file opens with a header and its grep targets.
//
//  MODULES  (viewport/<name>.js)
//      state ......... constants, context bindings (bind), R, math helpers
//      resources ..... samplers, layouts, BRDF LUT, shadow map, shaderModule
//      environment ... envState, envChunk (generated WGSL), frame bind group
//      pipelines ..... pbr, shadow, bg / ground, post, blit pipelines
//      textures ...... map textures, half-float upload
//      test-maps ..... makeTestMaps
//      material ...... material sets, setMaps, snapshot, pinA, useTestMaps
//      preview-mesh .. ensureMesh, uploadMesh, wireframe edges, loadOBJFile
//      lights ........ lightsState, key light, shadowMatrix
//      targets ....... makeTargets (HDR, MSAA, depth, LDR), aaMode
//      uniforms ...... writeFrame (struct Frame), writeMaterial
//      render ........ requestRender, tick, renderScene
//      offscreen ..... renderOffscreen, readback, screenshot
//      hud ........... buildHud, syncHud, compare divider, OBJ drop, stats
//      prefs ......... localStorage restore and save (per viewer)
//      selftest ...... __studio.viewport.selfTest
//      api ........... __studio.viewport, setMesh, setDebugView
//
//  GREP TARGETS (this file)
//      init .......... bindings, prefs, shaders, camera, store subscriptions
//      dispose ....... release the loop, the env poll, sets and targets
//      resize ........ canvas size from #viewport-wrap and the pixel ratio
//      onView ........ view:changed: camera, compare sets, HUD, prefs
// ============================================================================
import * as C from './contract.js';
import { createOrbitCamera } from './camera.js';
import { loadShaders } from '../../lib/shaders.js';
import {
  VIEWPORT_DEBUG_VIEWS, VIEW_DEFAULTS,
  store, state, gpu, canvas, wrap, hud, cam, bind, R, clamp,
} from './viewport/state.js';
import { createStatic, buildLut } from './viewport/resources.js';
import { safeEnvBindings } from './viewport/environment.js';
import { defaultSet, setMaps, snapshot, destroySet } from './viewport/material.js';
import { destroyTargets } from './viewport/targets.js';
import { requestRender } from './viewport/render.js';
import { buildHud, syncHud, placeDivider, updateStats } from './viewport/hud.js';
import { PREF_VIEW_KEYS, readPrefs, savePrefsSoon } from './viewport/prefs.js';
import { api } from './viewport/api.js';

export { VIEWPORT_DEBUG_VIEWS, DEBUG_LABELS, TONEMAP_LABELS, VIEW_DEFAULTS } from './viewport/state.js';
export { makeTestMaps } from './viewport/test-maps.js';
export { setMaps, pinA, useTestMaps } from './viewport/material.js';
export { loadOBJFile } from './viewport/preview-mesh.js';
export { requestRender } from './viewport/render.js';
export { renderOffscreen, screenshot, screenshotDataURL } from './viewport/offscreen.js';
export { setMesh, setDebugView, api } from './viewport/api.js';

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

// ------------------------------------------------------------ resize, view changes
function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const r = wrap.getBoundingClientRect();
  const w = clamp(Math.round(r.width * dpr), 1, 4096), h = clamp(Math.round(r.height * dpr), 1, 4096);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  placeDivider();
}

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
