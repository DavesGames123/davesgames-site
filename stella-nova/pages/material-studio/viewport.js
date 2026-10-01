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
import { PREF_VIEW_KEYS, readPrefs, savePrefsSoon } from './viewport/prefs.js';
import { makeTargets, destroyTargets, aaMode } from './viewport/targets.js';
import { lightsState, shadowMatrix } from './viewport/lights.js';
import { mapTexture, writeHalf } from './viewport/textures.js';
import { makeTestMaps } from './viewport/test-maps.js';
export { makeTestMaps } from './viewport/test-maps.js';
import { safeEnvBindings, envState, envChunk, frameLayout, ensureFrameBG } from './viewport/environment.js';
import { createStatic, shaderModule, buildLut } from './viewport/resources.js';

// ------------------------------------------------------------ constants
const RAW_VIEWS = new Set(VIEWPORT_DEBUG_VIEWS.filter(v => !['lit', 'diffuseOnly', 'specularOnly'].includes(v)));
// Raw views that show map data, not a color: the post pass writes them with
// no sRGB encode and no dither, so roughness 0.5 shows as 128, as in the PNG.
const DATA_VIEWS = new Set(['opacity', 'normal', 'worldNormal', 'ao', 'roughness', 'metallic', 'height', 'clearcoat', 'anisotropy', 'ndotl']);
const SNAP_MAX = 1024;
const VB_STRIDE = 48;
const SUBDIV_OPTIONS = [32, 64, 96, 128, 192, 256, 384, 512];

const VB_LAYOUT = {
  arrayStride: VB_STRIDE,
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },
    { shaderLocation: 1, offset: 12, format: 'float32x3' },
    { shaderLocation: 2, offset: 24, format: 'float32x2' },
    { shaderLocation: 3, offset: 32, format: 'float32x4' },
  ],
};
const PREMUL = {
  color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
};

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
function sceneModule(e, which) {
  const body = which === 'pbr' ? R.SH['shaders/pbr.wgsl'] : R.SH['shaders/viewport-bg.wgsl'];
  return shaderModule(`vp-${which}-${e.key}`, R.SH['shaders/viewport-common.wgsl'] + envChunk(e) + body);
}

/**
 * @param {object} e env state  @param {number} samples
 * @param {'back'|'front'|'none'} cull @param {boolean} blend @param {boolean} wire
 */
function pbrPipeline(e, samples, cull, blend, wire = false) {
  const key = `pbr|${e.key}|${samples}|${cull}|${blend}|${wire}`;
  if (R.pipes.has(key)) return R.pipes.get(key);
  const m = sceneModule(e, 'pbr');
  const p = device.createRenderPipeline({
    label: 'vp-' + key,
    layout: device.createPipelineLayout({ bindGroupLayouts: [frameLayout(e), R.layout.mat] }),
    vertex: { module: m, entryPoint: wire ? 'vs_wire' : 'vs_main', buffers: [VB_LAYOUT] },
    fragment: { module: m, entryPoint: wire ? 'fs_wire' : 'fs_main', targets: [{ format: HDR, blend: blend || wire ? PREMUL : undefined }] },
    primitive: { topology: wire ? 'line-list' : 'triangle-list', cullMode: wire ? 'none' : cull, frontFace: 'ccw' },
    depthStencil: { format: DEPTH, depthWriteEnabled: !blend && !wire, depthCompare: wire ? 'less-equal' : 'less' },
    multisample: { count: samples },
  });
  R.pipes.set(key, p);
  return p;
}

function shadowPipeline(e) {
  const key = `shadow|${e.key}`;
  if (R.pipes.has(key)) return R.pipes.get(key);
  const m = sceneModule(e, 'pbr');
  const p = device.createRenderPipeline({
    label: 'vp-shadow',
    layout: device.createPipelineLayout({ bindGroupLayouts: [R.layout.frameOnly, R.layout.mat] }),
    vertex: { module: m, entryPoint: 'vs_shadow', buffers: [VB_LAYOUT] },
    fragment: { module: m, entryPoint: 'fs_shadow', targets: [] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2.5 },
  });
  R.pipes.set(key, p);
  return p;
}

function bgPipeline(e, samples, ground) {
  const key = `${ground ? 'ground' : 'bg'}|${e.key}|${samples}`;
  if (R.pipes.has(key)) return R.pipes.get(key);
  const m = sceneModule(e, 'bg');
  const p = device.createRenderPipeline({
    label: 'vp-' + key,
    layout: device.createPipelineLayout({ bindGroupLayouts: [frameLayout(e)] }),
    vertex: { module: m, entryPoint: ground ? 'vs_ground' : 'vs_bg' },
    fragment: { module: m, entryPoint: ground ? 'fs_ground' : 'fs_bg', targets: [{ format: HDR, blend: ground ? PREMUL : undefined }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: DEPTH, depthWriteEnabled: false, depthCompare: ground ? 'less' : 'always' },
    multisample: { count: samples },
  });
  R.pipes.set(key, p);
  return p;
}

function postPipeline(entry, format = gpu.format) {
  const key = `post|${entry}|${format}`;
  if (R.pipes.has(key)) return R.pipes.get(key);
  const m = shaderModule('vp-post', R.SH['shaders/viewport-post.wgsl']);
  const p = device.createRenderPipeline({
    label: 'vp-' + key,
    layout: device.createPipelineLayout({ bindGroupLayouts: [R.layout.post] }),
    vertex: { module: m, entryPoint: 'vs_full' },
    fragment: { module: m, entryPoint: entry, targets: [{ format }] },
  });
  R.pipes.set(key, p);
  return p;
}

function blitPipeline() {
  const key = 'blit';
  if (R.pipes.has(key)) return R.pipes.get(key);
  const m = shaderModule('vp-lut', R.SH['shaders/viewport-lut.wgsl']);
  const p = device.createRenderPipeline({
    label: 'vp-blit',
    layout: device.createPipelineLayout({ bindGroupLayouts: [R.layout.blit] }),
    vertex: { module: m, entryPoint: 'vs_full' },
    fragment: { module: m, entryPoint: 'fs_blit', targets: [{ format: HDR }] },
  });
  R.pipes.set(key, p);
  return p;
}

// ------------------------------------------------------------ material sets
/**
 * A material set: the six map textures, the scalars, a uniform buffer and
 * the group 1 bind group. `owned` sets are destroyed by the viewport.
 */
function makeMatSet(tex, scalars, owned, res, label) {
  const fill = R.def ? R.def.tex : null;
  const t = {};
  for (const k of C.MAP_NAMES) t[k] = tex[k] || (fill && fill[k]);
  const ubuf = device.createBuffer({ label: 'vp-mat-' + label, size: MAT_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bg = device.createBindGroup({
    label: 'vp-mat-' + label,
    layout: R.layout.mat,
    entries: [
      { binding: 0, resource: { buffer: ubuf } },
      ...C.MAP_NAMES.map((k, i) => ({ binding: i + 1, resource: t[k].createView() })),
      { binding: 7, resource: R.samp.map },
    ],
  });
  return { tex: t, scalars: { ...C.DEFAULT_SCALARS, ...(scalars || {}) }, owned, ubuf, bg, res, label, version: ++R.matVersion };
}

function destroySet(s) {
  if (!s) return;
  if (s.owned) for (const k of C.MAP_NAMES) { try { s.tex[k] && s.tex[k] !== R.def?.tex[k] && s.tex[k].destroy(); } catch (e) {} }
  try { s.ubuf.destroy(); } catch (e) {}
}

/** Flat defaults for slots before the first bake (contract MATERIAL_INPUTS defaults). */
function defaultSet() {
  const v = {
    albedo: [0.8, 0.8, 0.8, 1], normal: [0.5, 0.5, 1, 1], orm: [1, 0.5, 0, 1],
    height: [0.5, 0.5, 0.5, 1], emissive: [0, 0, 0, 1], extra: [0, 0.1, 0, 0],
  };
  const tex = {};
  for (const k of C.MAP_NAMES) {
    tex[k] = mapTexture('vp-default-' + k, 4);
    writeHalf(tex[k], 4, (u, w, px) => { px[0] = v[k][0]; px[1] = v[k][1]; px[2] = v[k][2]; px[3] = v[k][3]; });
  }
  return makeMatSet(tex, C.DEFAULT_SCALARS, true, 4, 'default');
}

/**
 * Show a bake result. Called on bake:done. In compare 'prev' mode the old
 * snapshot becomes A and the new maps are copied for the next swap.
 * @param {import('./contract.js').MaterialMaps} maps
 * @param {import('./contract.js').Scalars} [scalars]
 */
export function setMaps(maps, scalars) {
  if (!device || !maps) return;
  const sc = scalars || maps.scalars || state.scalars;
  if (R.cur && R.cur !== R.def && R.cur !== R.test && !R.cur.owned) destroySet({ ...R.cur, owned: false });
  R.cur = makeMatSet(maps, sc, false, maps.res || 0, 'bake');
  if (state.view.compare === 'prev') {
    if (R.lastCopy) { destroySet(R.A); R.A = R.lastCopy; R.A.label = 'previous'; }
    R.lastCopy = snapshot(R.cur, 'last');
  }
  R.shadowSig = '';
  updateStats();
  requestRender();
}

/** Copy a set into viewport-owned textures (at most SNAP_MAX texels a side). */
function snapshot(src, label) {
  const res = Math.max(4, Math.min(SNAP_MAX, src.res || src.tex.albedo.width || 4));
  const enc = device.createCommandEncoder();
  const out = {};
  for (const k of C.MAP_NAMES) {
    out[k] = mapTexture(`vp-${label}-${k}`, res);
    const bg = device.createBindGroup({ layout: R.layout.blit, entries: [{ binding: 0, resource: src.tex[k].createView() }, { binding: 1, resource: R.samp.clamp }] });
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: out[k].createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
    pass.setPipeline(blitPipeline()); pass.setBindGroup(0, bg); pass.draw(3); pass.end();
  }
  device.queue.submit([enc.finish()]);
  return makeMatSet(out, src.scalars, true, res, label);
}

/** Pin the current maps as side A of the compare view. */
export function pinA() {
  if (!device || !R.cur) return;
  destroySet(R.A);
  R.A = snapshot(R.cur, 'pinned');
  R.A.label = 'pinned';
  if (state.view.compare === 'off' || state.view.compare === 'prev') store.setView({ compare: 'pinned' });
  else requestRender();
  store.toast('Pinned the current material as A', 'ok', 1600);
}

/** Show synthetic test maps until the next bake. */
export function useTestMaps(res = 512) {
  if (!device) return false;
  if (!R.test || R.test.res !== res) { destroySet(R.test); const m = makeTestMaps(res); R.test = makeMatSet(m, m.scalars, true, res, 'test'); }
  R.cur = R.test; R.shadowSig = '';
  requestRender();
  return true;
}

// ------------------------------------------------------------ mesh
function ensureMesh() {
  let name = state.view.mesh;
  if (name === 'custom' && !R.custom) name = 'sphere';
  const sub = clamp(+state.view.subdiv || 128, 16, 512);
  const key = name === 'custom' ? 'custom|' + idOf(R.custom) : `${name}|${sub}`;
  if (R.mesh && R.meshKey === key) return R.mesh;
  const data = name === 'custom' ? R.custom : buildMesh(name, { subdiv: sub });
  if (R.mesh) { R.mesh.vbuf.destroy(); R.mesh.ibuf.destroy(); R.mesh.ebuf?.destroy(); }
  R.mesh = uploadMesh(data, name);
  R.meshKey = key; R.shadowSig = '';
  updateStats();
  return R.mesh;
}

function uploadMesh(m, name) {
  const nv = m.positions.length / 3;
  const v = new Float32Array(nv * 12);
  for (let i = 0; i < nv; i++) {
    const o = i * 12;
    v[o] = m.positions[i * 3]; v[o + 1] = m.positions[i * 3 + 1]; v[o + 2] = m.positions[i * 3 + 2];
    v[o + 3] = m.normals[i * 3]; v[o + 4] = m.normals[i * 3 + 1]; v[o + 5] = m.normals[i * 3 + 2];
    v[o + 6] = m.uvs[i * 2]; v[o + 7] = m.uvs[i * 2 + 1];
    v[o + 8] = m.tangents[i * 4]; v[o + 9] = m.tangents[i * 4 + 1]; v[o + 10] = m.tangents[i * 4 + 2]; v[o + 11] = m.tangents[i * 4 + 3];
  }
  const vbuf = device.createBuffer({ label: 'vp-vb-' + name, size: v.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(vbuf, 0, v);
  const ibuf = device.createBuffer({ label: 'vp-ib-' + name, size: Math.max(4, m.indices.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(ibuf, 0, m.indices);
  const b = m.bounds || { min: [-1, -1, -1], max: [1, 1, 1], radius: 1 };
  return { name, data: m, vbuf, ibuf, count: m.indices.length, ebuf: null, ecount: 0, minY: b.min[1], radius: b.radius, vertices: nv, triangles: m.indices.length / 3 };
}

function ensureEdges(mesh) {
  if (mesh.ebuf) return;
  const e = edgeIndices(mesh.data);
  mesh.ebuf = device.createBuffer({ label: 'vp-edges', size: Math.max(4, e.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(mesh.ebuf, 0, e);
  mesh.ecount = e.length;
}

/** Load a Wavefront .obj File as the 'custom' mesh. */
export async function loadOBJFile(file) {
  if (!file) return false;
  if (file.size > 96 * 1024 * 1024) { store.toast('The .obj file is larger than 96 MB', 'error'); return false; }
  try {
    const m = parseOBJ(await file.text());
    R.custom = m;
    store.toast(`Loaded ${file.name}: ${m.positions.length / 3} vertices, ${m.indices.length / 3} triangles`, 'ok');
    if (state.view.mesh === 'custom') { R.meshKey = ''; requestRender(); }
    else store.setView({ mesh: 'custom' });
    syncHud();
    cam && cam.frame(1);
    return true;
  } catch (e) {
    store.toast('Could not read the .obj file: ' + e.message, 'error');
    return false;
  }
}

// ------------------------------------------------------------ targets
function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const r = wrap.getBoundingClientRect();
  const w = clamp(Math.round(r.width * dpr), 1, 4096), h = clamp(Math.round(r.height * dpr), 1, 4096);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  placeDivider();
}

// ------------------------------------------------------------ render
/** Ask for one frame. Coalesces into the next animation frame. */
export function requestRender() {
  if (!device || R.disposed) return;
  R.needs = true;
  if (!R.raf) R.raf = requestAnimationFrame(tick);
}

function tick(t) {
  R.raf = 0;
  if (R.disposed) return;
  const dt = R.last ? (t - R.last) / 1000 : 1 / 60;
  R.last = t;
  const moving = cam.update(dt, canvas.width / Math.max(1, canvas.height));
  if (R.needs || moving) {
    R.needs = false;
    try { renderToCanvas(); } catch (e) { console.error('[viewport] render', e); }
    R.fpsN++;
    if (t - R.fpsT > 500) { R.fps = (R.fpsN * 1000) / (t - R.fpsT); R.fpsT = t; R.fpsN = 0; updateStats(); }
  }
  if (moving) R.raf = requestAnimationFrame(tick);
  else { R.last = 0; R.fpsN = 0; R.fpsT = t; }
}

function renderToCanvas() {
  if (!gctx) return;
  const { samples, fxaa } = aaMode();
  const w = canvas.width, h = canvas.height;
  const T0 = R.targets;
  if (!T0 || T0.w !== w || T0.h !== h || T0.samples !== samples || T0.fxaa !== fxaa) { destroyTargets(T0); R.targets = makeTargets(w, h, samples, fxaa); }
  const t0 = performance.now();
  renderScene(R.targets, gctx.getCurrentTexture().createView(), {});
  R.frameMs = performance.now() - t0;
  updateStats();
}

function writeFrame(T, e, L, mesh, o) {
  const f = R.frameData; f.fill(0);
  const v = state.view, env = state.env;
  f.set(cam.viewProj, 0); f.set(cam.invViewProj, 16);
  const groundY = mesh.minY - 0.002 - (v.displacement ? (activeScalars().displacementScale || 0) : 0);
  const shadowM = shadowMatrix(L.key, mesh.radius, groundY);
  f.set(shadowM, 32);
  f.set([cam.eye[0], cam.eye[1], cam.eye[2], performance.now() / 1000], 48);
  const mips = e.kind === 'proc' ? 8 : e.mips;
  const inten = e.kind === 'lib' ? (+e.b.intensity || 0) : (Number.isFinite(+env.intensity) ? +env.intensity : 1);
  f.set([((Number(env.rotation) || 0) * Math.PI) / 180, inten, e.kind === 'proc' ? 8 : mips, e.kind === 'proc' ? 0 : 1], 52);
  const debug = o.debug || v.debug;
  const raw = RAW_VIEWS.has(debug);
  let mode = 0, lod = 0;
  const bgc = hexToLinear(env.bgColor || '#1a1f2a');
  if (raw) mode = 3;
  else if (v.background === 'solid') mode = 1;
  else if (v.background === 'checker') mode = 2;
  else if (v.background === 'gradient') mode = 3;
  else if (env.background === 'color' && e.kind !== 'lib') mode = 1;
  else if (env.background === 'hdri') lod = 0;
  else lod = clamp(Number(env.blur ?? 0.35), 0, 1) * (mips - 1);
  f.set([bgc[0], bgc[1], bgc[2], mode], 56);
  const groundOn = v.ground !== false && mesh.name !== 'plane';
  f.set([lod, groundY, groundOn ? 1 : 0, v.grid ? 1 : 0], 60);
  const shadowsOn = v.shadows !== false;
  f.set([VIEWPORT_DEBUG_VIEWS.indexOf(debug), L.lights.length, shadowsOn ? clamp(+v.shadowStrength || 0, 0, 1) : 0, clamp(+v.specOcclusion, 0, 1)], 64);
  f.set([T.w, T.h, 1 / T.w, 1 / T.h], 68);
  f.set([L.key[0], L.key[1], L.key[2], shadowsOn ? 1 : 0], 72);
  for (let i = 0; i < L.lights.length; i++) {
    const l = L.lights[i], b = 76 + i * 8;
    f.set([l.v[0], l.v[1], l.v[2], l.type], b);
    f.set([l.color[0], l.color[1], l.color[2], i === L.keyIdx && shadowsOn ? 1 : 0], b + 4);
  }
  if (e.sh) {
    const s = e.sh, stride = s.length >= 36 ? 4 : 3;
    for (let i = 0; i < 9; i++) f.set([s[i * stride], s[i * stride + 1], s[i * stride + 2], 0], 108 + i * 4);
  }
  device.queue.writeBuffer(R.frameBuf, 0, f);
  return { groundOn, shadowM, raw, data: DATA_VIEWS.has(debug) };
}

function activeScalars() { return (R.cur && R.cur.scalars) || state.scalars || C.DEFAULT_SCALARS; }

function writeMaterial(set) {
  const v = state.view, s = set.scalars;
  const uvs = +v.uvScale || 1, off = Array.isArray(v.uvOffset) ? v.uvOffset : [0, 0];
  const alpha = s.alphaMode === 'blend' ? 2 : s.alphaMode === 'mask' ? 1 : 0;
  const disp = v.displacement ? 1 : 0;
  const pom = v.parallax && !disp ? (s.displacementScale || 0) * (+v.parallaxScale || 0) : 0;
  const m = new Float32Array(MAT_FLOATS);
  m.set([uvs, uvs, +off[0] || 0, +off[1] || 0], 0);
  m.set([s.ior ?? 1.5, s.transmission ?? 0, s.displacementScale ?? 0.05, s.emissiveStrength ?? 1], 4);
  m.set([alpha, s.alphaCutoff ?? 0.5, pom, disp], 8);
  m.set([+v.normalStrength || 0, v.flipGreen ? -1 : 1, ((+v.anisoRotation || 0) * Math.PI) / 180, clamp(+v.sheenRoughness || 0.5, 0.07, 1)], 12);
  m.set([clamp(+v.pomSteps || 32, 4, 64), s.doubleSided ? 1 : 0, 0, 0], 16);
  device.queue.writeBuffer(set.ubuf, 0, m);
}

/**
 * Encode and submit one frame into `outView` (a view of T.finalFormat).
 * @param {object} T targets  @param {GPUTextureView} outView
 * @param {{set?:object, debug?:string, compare?:boolean}} o overrides
 */
function renderScene(T, outView, o) {
  const mesh = ensureMesh();
  const e = envState();
  R.env = e;
  ensureFrameBG(e);
  const L = lightsState(e);
  R.key = L.key;
  const cur = o.set || R.cur;
  const compare = o.compare !== false && !o.set && state.view.compare !== 'off';
  const A = compare ? (R.A || (state.view.compare === 'prev' ? R.lastCopy : null)) : null;
  const fr = writeFrame(T, e, L, mesh, o);
  writeMaterial(cur);
  if (A) writeMaterial(A);

  const enc = device.createCommandEncoder({ label: 'vp-frame' });
  // shadow pass, only when its inputs changed
  const sig = `${R.meshKey}|${cur.version}|${L.key.map(x => x.toFixed(4))}|${state.view.displacement}|${state.view.uvScale}|${state.view.uvOffset}|${cur.scalars.displacementScale}|${cur.scalars.alphaMode}|${cur.scalars.alphaCutoff}|${e.key}`;
  if (state.view.shadows !== false && sig !== R.shadowSig) {
    const sp = enc.beginRenderPass({ label: 'vp-shadow', colorAttachments: [], depthStencilAttachment: { view: R.shadowView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
    sp.setPipeline(shadowPipeline(e));
    sp.setBindGroup(0, R.shadowFrameBG); sp.setBindGroup(1, cur.bg);
    sp.setVertexBuffer(0, mesh.vbuf); sp.setIndexBuffer(mesh.ibuf, 'uint32');
    sp.drawIndexed(mesh.count);
    sp.end();
    R.shadowSig = sig;
  }

  const pass = enc.beginRenderPass({
    label: 'vp-main',
    colorAttachments: [{
      view: T.samples > 1 ? T.msaaView : T.hdrView, resolveTarget: T.samples > 1 ? T.hdrView : undefined,
      loadOp: 'clear', storeOp: T.samples > 1 ? 'discard' : 'store', clearValue: [0, 0, 0, 1],
    }],
    depthStencilAttachment: { view: T.depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
  });
  pass.setBindGroup(0, R.frameBG);
  pass.setPipeline(bgPipeline(e, T.samples, false)); pass.draw(3);
  if (fr.groundOn || state.view.grid) { pass.setPipeline(bgPipeline(e, T.samples, true)); pass.draw(6); }
  pass.setVertexBuffer(0, mesh.vbuf);
  const split = clamp(Math.round((+state.view.compareSplit || 0.5) * T.w), 0, T.w);
  const sides = A ? [[A, 0, split], [cur, split, T.w - split]] : [[cur, 0, T.w]];
  for (const [set, x, w] of sides) {
    if (w <= 0) continue;
    pass.setScissorRect(x, 0, w, T.h);
    drawMesh(pass, set, e, T.samples, mesh);
  }
  pass.setScissorRect(0, 0, T.w, T.h);
  if (state.view.wireframe) {
    ensureEdges(mesh);
    pass.setPipeline(pbrPipeline(e, T.samples, 'none', false, true));
    pass.setBindGroup(1, cur.bg);
    pass.setIndexBuffer(mesh.ebuf, 'uint32');
    pass.drawIndexed(mesh.ecount);
  }
  pass.end();

  // post
  const v = state.view;
  const tm = Math.max(0, C.TONEMAPPERS.indexOf(v.tonemap));
  device.queue.writeBuffer(R.postBuf, 0, new Float32Array([
    Math.pow(2, +v.exposure || 0), tm, fr.data ? 2 : fr.raw ? 1 : 0, fr.data ? 0 : 1,
    A ? split / T.w : -1, 0.75, 1 / T.w, 1 / T.h,
  ]));
  const post = (view, entry, bg) => {
    const p = enc.beginRenderPass({ label: 'vp-' + entry, colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
    p.setPipeline(postPipeline(entry, T.finalFormat)); p.setBindGroup(0, bg); p.draw(3); p.end();
  };
  if (T.fxaa) { post(T.ldrView, 'fs_tonemap', T.tonemapBG); post(outView, 'fs_fxaa', T.fxaaBG); }
  else post(outView, 'fs_tonemap', T.tonemapBG);
  device.queue.submit([enc.finish()]);
}

function drawMesh(pass, set, e, samples, mesh) {
  const s = set.scalars;
  const blend = s.alphaMode === 'blend';
  const ds = !!s.doubleSided || mesh.name === 'plane' || mesh.name === 'custom';
  pass.setBindGroup(1, set.bg);
  pass.setIndexBuffer(mesh.ibuf, 'uint32');
  if (blend) {
    if (ds) { pass.setPipeline(pbrPipeline(e, samples, 'front', true)); pass.drawIndexed(mesh.count); }
    pass.setPipeline(pbrPipeline(e, samples, 'back', true)); pass.drawIndexed(mesh.count);
  } else {
    pass.setPipeline(pbrPipeline(e, samples, ds ? 'none' : 'back', false)); pass.drawIndexed(mesh.count);
  }
}

// ------------------------------------------------------------ offscreen
/**
 * Render one frame into an offscreen texture and read it back.
 * @param {{width?:number, height?:number, debug?:string, set?:object, compare?:boolean}} [o]
 * @returns {Promise<{width:number, height:number, data:Uint8ClampedArray}>} RGBA8
 */
export async function renderOffscreen(o = {}) {
  if (!device) throw new Error('no WebGPU device');
  const w = clamp(Math.round(o.width || canvas.width), 1, 4096), h = clamp(Math.round(o.height || canvas.height), 1, 4096);
  const { samples, fxaa } = aaMode();
  const fmt = gpu.format;
  const T = makeTargets(w, h, samples, fxaa, fmt);
  const out = device.createTexture({ label: 'vp-shot', size: [w, h, 1], format: fmt, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const aspect = canvas.width / Math.max(1, canvas.height);
  cam.update(0, w / h);
  try { renderScene(T, out.createView(), o); }
  finally { cam.update(0, aspect); }
  const data = await readback(out, w, h, fmt);
  out.destroy(); destroyTargets(T);
  requestRender();
  return { width: w, height: h, data };
}

async function readback(tex, w, h, fmt) {
  const bpr = Math.ceil((w * 4) / 256) * 256;
  const buf = device.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr, rowsPerImage: h }, [w, h, 1]);
  device.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const src = new Uint8Array(buf.getMappedRange());
  const data = new Uint8ClampedArray(w * h * 4);
  const bgra = fmt.startsWith('bgra');
  for (let y = 0; y < h; y++) {
    const so = y * bpr, d = y * w * 4;
    for (let x = 0; x < w; x++) {
      const s = so + x * 4, t = d + x * 4;
      data[t] = bgra ? src[s + 2] : src[s]; data[t + 1] = src[s + 1]; data[t + 2] = bgra ? src[s] : src[s + 2]; data[t + 3] = 255;
    }
  }
  buf.unmap(); buf.destroy();
  return data;
}

/**
 * PNG of the viewport. Default size: the canvas size.
 * @param {{width?:number, height?:number, debug?:string, type?:string}} [o]
 * @returns {Promise<Blob>}
 */
export async function screenshot(o = {}) {
  const img = await renderOffscreen(o);
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('toBlob failed'))), o.type || 'image/png'));
}
/** Same as screenshot, as a data URL (handy for headless checks). */
export async function screenshotDataURL(o = {}) {
  const b = await screenshot(o);
  return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });
}
async function saveScreenshot() {
  try {
    const b = await screenshot({ width: canvas.width, height: canvas.height });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = `material-${(state.graph && state.graph.name) || 'preview'}-${state.view.debug}.png`.replace(/[^\w.-]+/g, '_');
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (e) { store.toast('Screenshot failed: ' + e.message, 'error'); }
}

// ------------------------------------------------------------ hud
let hudEls = {};
function opt(v, l) { return `<option value="${v}">${l}</option>`; }

function buildHud() {
  hud.innerHTML = `
<div class="vp-bar">
  <select data-k="mesh" title="Preview mesh" aria-label="Preview mesh">${C.MESHES.map(m => opt(m, MESH_LABELS[m] || m)).join('')}${opt('custom', MESH_LABELS.custom)}</select>
  <select data-k="debug" title="View: lit or one channel" aria-label="Debug view">${VIEWPORT_DEBUG_VIEWS.map(v => opt(v, DEBUG_LABELS[v] || v)).join('')}</select>
  <select data-k="tonemap" class="vp-hide-s" title="Tonemapper" aria-label="Tonemapper">${C.TONEMAPPERS.map(t => opt(t, TONEMAP_LABELS[t] || t)).join('')}</select>
  <label class="vp-ev" title="Exposure (EV)"><span>EV</span><input type="range" data-k="exposure" min="-6" max="6" step="0.1"><output data-out="exposure"></output></label>
  <button type="button" data-act="frame" title="Frame the mesh (F, double-click)">Frame</button>
  <button type="button" data-tog="autoRotate" title="Turntable">Turn</button>
  <button type="button" data-tog="wireframe" class="vp-hide-s" title="Wireframe overlay">Wire</button>
  <button type="button" data-act="more" aria-expanded="false" title="All viewport settings">View</button>
</div>
<div class="vp-more" hidden>
  <div class="vp-sec">Camera &amp; display</div>
  <label>FOV<input type="range" data-k="fov" min="10" max="100" step="1"><output data-out="fov"></output></label>
  <label>Tonemap<select data-k="tonemap">${C.TONEMAPPERS.map(t => opt(t, TONEMAP_LABELS[t] || t)).join('')}</select></label>
  <label>Background<select data-k="background">${opt('env', 'Environment')}${opt('solid', 'Solid color')}${opt('checker', 'Checker')}${opt('gradient', 'Gradient')}</select></label>
  <label>Anti-alias<select data-k="aa">${opt('msaa', 'MSAA 4x')}${opt('fxaa', 'FXAA')}${opt('both', 'MSAA + FXAA')}${opt('off', 'Off')}</select></label>
  <label>Compare<select data-k="compare">${opt('off', 'Off')}${opt('prev', 'A = previous bake')}${opt('pinned', 'A = pinned')}</select></label>
  <div class="vp-row"><button type="button" data-act="pin" title="Copy the current maps into side A">Pin A</button><button type="button" data-act="testmaps" title="Show synthetic test maps until the next bake">Test maps</button></div>
  <div class="vp-sec">Surface</div>
  <label>UV scale<input type="range" data-k="uvScale" min="0.25" max="16" step="0.25"><output data-out="uvScale"></output></label>
  <label>UV offset U<input type="range" data-k="uvOffset.0" min="-1" max="1" step="0.01"><output data-out="uvOffset.0"></output></label>
  <label>UV offset V<input type="range" data-k="uvOffset.1" min="-1" max="1" step="0.01"><output data-out="uvOffset.1"></output></label>
  <label>Normal str.<input type="range" data-k="normalStrength" min="0" max="3" step="0.05"><output data-out="normalStrength"></output></label>
  <label class="vp-chk"><input type="checkbox" data-k="flipGreen">Flip green (DirectX map)</label>
  <label>Aniso rot.<input type="range" data-k="anisoRotation" min="-180" max="180" step="1"><output data-out="anisoRotation"></output></label>
  <label>Sheen rough.<input type="range" data-k="sheenRoughness" min="0.07" max="1" step="0.01"><output data-out="sheenRoughness"></output></label>
  <label>Spec. occl.<input type="range" data-k="specOcclusion" min="0" max="1" step="0.05"><output data-out="specOcclusion"></output></label>
  <div class="vp-sec">Height</div>
  <label class="vp-chk"><input type="checkbox" data-k="parallax">Parallax occlusion</label>
  <label>POM depth ×<input type="range" data-k="parallaxScale" min="0" max="4" step="0.05"><output data-out="parallaxScale"></output></label>
  <label>POM steps<input type="range" data-k="pomSteps" min="4" max="64" step="1"><output data-out="pomSteps"></output></label>
  <label class="vp-chk"><input type="checkbox" data-k="displacement">Displace vertices</label>
  <label>Mesh density<select data-k="subdiv" data-num>${SUBDIV_OPTIONS.map(n => opt(n, n)).join('')}</select></label>
  <div class="vp-sec">Stage</div>
  <label class="vp-chk"><input type="checkbox" data-k="ground">Ground shadow</label>
  <label class="vp-chk"><input type="checkbox" data-k="grid">Grid</label>
  <label class="vp-chk"><input type="checkbox" data-k="shadows">Key light shadows</label>
  <label>Shadow str.<input type="range" data-k="shadowStrength" min="0" max="1" step="0.05"><output data-out="shadowStrength"></output></label>
  <label class="vp-chk"><input type="checkbox" data-k="wireframe">Wireframe</label>
  <div class="vp-row">
    <button type="button" data-act="obj" title="Load a Wavefront .obj mesh (or drop it on the viewport)">Load .obj</button>
    <button type="button" data-act="shot" title="Save a PNG of the viewport">PNG</button>
    <button type="button" data-act="reset" title="Reset the camera (R)">Reset cam</button>
  </div>
  <div class="vp-help">Drag orbit · right/Ctrl drag pan · wheel/pinch zoom · Shift drag turns the environment · double-click frames</div>
  <input type="file" accept=".obj,text/plain" data-file hidden>
</div>
<div class="vp-ab" hidden><span class="vp-a">A</span><span class="vp-b">B · current</span></div>
<div class="vp-divider" hidden role="separator" aria-label="Compare split" tabindex="0"></div>
<div class="vp-stats" aria-live="off"></div>
<div class="vp-drop" hidden>Drop an .obj file to preview it</div>
<div class="vp-nogpu-msg">WebGPU is not available: the 3D preview is off.</div>`;
  hudEls = {
    more: hud.querySelector('.vp-more'), moreBtn: hud.querySelector('[data-act=more]'), stats: hud.querySelector('.vp-stats'),
    divider: hud.querySelector('.vp-divider'), ab: hud.querySelector('.vp-ab'), drop: hud.querySelector('.vp-drop'),
    file: hud.querySelector('[data-file]'),
  };

  const readVal = el => {
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'range' || el.dataset.num !== undefined) return +el.value;
    return el.value;
  };
  const apply = (el, merge) => {
    const k = el.dataset.k;
    const val = readVal(el);
    if (k.includes('.')) {
      const [a, i] = k.split('.');
      const arr = Array.isArray(state.view[a]) ? [...state.view[a]] : [0, 0];
      arr[+i] = val;
      store.setView({ [a]: arr });
    } else store.setView({ [k]: val });
  };
  hud.addEventListener('input', e => { const el = e.target.closest('[data-k]'); if (el && el.type === 'range') apply(el); });
  hud.addEventListener('change', e => { const el = e.target.closest('[data-k]'); if (el) apply(el); });
  hud.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tog) { store.setView({ [b.dataset.tog]: !state.view[b.dataset.tog] }); return; }
    switch (b.dataset.act) {
      case 'frame': cam && cam.frame(); break;
      case 'reset': cam && cam.reset(); break;
      case 'more': {
        const open = hudEls.more.hidden;
        hudEls.more.hidden = !open; b.setAttribute('aria-expanded', String(open)); b.classList.toggle('on', open);
        break;
      }
      case 'pin': pinA(); break;
      case 'testmaps': useTestMaps(); break;
      case 'obj': hudEls.file.click(); break;
      case 'shot': saveScreenshot(); break;
      default: break;
    }
  });
  hudEls.file.addEventListener('change', () => { const f = hudEls.file.files[0]; if (f) loadOBJFile(f); hudEls.file.value = ''; });
  // a click on the canvas closes the settings panel
  canvas.addEventListener('pointerdown', () => { if (!hudEls.more.hidden) { hudEls.more.hidden = true; hudEls.moreBtn.classList.remove('on'); hudEls.moreBtn.setAttribute('aria-expanded', 'false'); } });

  // drag and drop .obj
  let dragDepth = 0;
  wrap.addEventListener('dragenter', e => { if (hasFiles(e)) { dragDepth++; hudEls.drop.hidden = false; e.preventDefault(); } });
  wrap.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  wrap.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) hudEls.drop.hidden = true; });
  wrap.addEventListener('drop', e => {
    dragDepth = 0; hudEls.drop.hidden = true;
    const f = [...(e.dataTransfer?.files || [])].find(x => /\.obj$/i.test(x.name));
    if (!f) return;
    e.preventDefault(); e.stopPropagation();
    loadOBJFile(f);
  });

  // compare divider
  const dv = hudEls.divider;
  let dragging = false;
  dv.addEventListener('pointerdown', e => { dragging = true; dv.setPointerCapture(e.pointerId); e.preventDefault(); });
  dv.addEventListener('pointermove', e => {
    if (!dragging) return;
    const r = wrap.getBoundingClientRect();
    store.setView({ compareSplit: clamp((e.clientX - r.left) / r.width, 0.02, 0.98) });
  });
  const end = () => { dragging = false; };
  dv.addEventListener('pointerup', end); dv.addEventListener('pointercancel', end);
  dv.addEventListener('keydown', e => {
    const s = +state.view.compareSplit || 0.5;
    if (e.key === 'ArrowLeft') store.setView({ compareSplit: clamp(s - 0.02, 0.02, 0.98) });
    else if (e.key === 'ArrowRight') store.setView({ compareSplit: clamp(s + 0.02, 0.02, 0.98) });
  });
}
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');

function fmtOut(k, v) {
  if (k === 'exposure') return (v >= 0 ? '+' : '') + (+v).toFixed(1);
  if (k === 'fov' || k === 'anisoRotation' || k === 'pomSteps') return Math.round(v) + (k === 'pomSteps' ? '' : '°');
  return (+v).toFixed(2);
}

function syncHud() {
  if (!hud) return;
  const v = state.view;
  for (const el of hud.querySelectorAll('[data-k]')) {
    const k = el.dataset.k;
    let val;
    if (k.includes('.')) { const [a, i] = k.split('.'); val = Array.isArray(v[a]) ? v[a][+i] : 0; }
    else val = v[k];
    if (el.type === 'checkbox') el.checked = !!val;
    else if (document.activeElement !== el || el.tagName === 'SELECT') el.value = String(val ?? '');
  }
  for (const o of hud.querySelectorAll('[data-out]')) {
    const k = o.dataset.out;
    const val = k.includes('.') ? (v[k.split('.')[0]] || [])[+k.split('.')[1]] : v[k];
    o.textContent = fmtOut(k, +val || 0);
  }
  for (const b of hud.querySelectorAll('[data-tog]')) b.classList.toggle('on', !!v[b.dataset.tog]);
  const cmp = v.compare !== 'off';
  hudEls.divider.hidden = !cmp; hudEls.ab.hidden = !cmp;
  if (cmp) {
    hudEls.ab.querySelector('.vp-a').textContent = v.compare === 'prev' ? 'A · previous bake' : 'A · pinned';
    placeDivider();
  }
  const meshSel = hud.querySelector('select[data-k=mesh]');
  if (meshSel) meshSel.querySelector('option[value=custom]').disabled = !R.custom;
}

function placeDivider() {
  if (!hudEls.divider) return;
  const s = clamp(+state.view.compareSplit || 0.5, 0, 1);
  hudEls.divider.style.left = (s * 100).toFixed(3) + '%';
  hudEls.ab.style.setProperty('--split', (s * 100).toFixed(3) + '%');
}

function updateStats() {
  if (!hudEls.stats) return;
  const m = R.mesh, cur = R.cur;
  const parts = [];
  if (m) parts.push(`${m.triangles.toLocaleString()} tris`);
  if (cur) parts.push(cur === R.def ? 'no bake yet' : cur === R.test ? `test maps ${cur.res}²` : `maps ${cur.res}²`);
  if (R.baking) parts.push('baking…');
  parts.push(R.env ? (R.env.kind === 'lib' ? 'env ' + ((R.env.b.source && R.env.b.source.label) || 'IBL') : R.env.kind === 'tex' ? 'IBL' : 'studio sky') : 'studio sky');
  if (R.fps) parts.push(`${R.fps.toFixed(0)} fps`);
  parts.push(`${R.frameMs.toFixed(1)} ms cpu`);
  const txt = parts.join(' · ');
  if (hudEls.stats.textContent !== txt) hudEls.stats.textContent = txt;
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
