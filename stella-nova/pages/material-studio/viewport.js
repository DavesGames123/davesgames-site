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

// ------------------------------------------------------------ constants
/** Contract DEBUG_VIEWS plus 'ndotl'. The index is the shader debug id. */
export const VIEWPORT_DEBUG_VIEWS = Object.freeze([...C.DEBUG_VIEWS, 'ndotl']);
export const DEBUG_LABELS = Object.freeze({
  lit: 'Lit', albedo: 'Base Color', opacity: 'Opacity', normal: 'Normal (map)', worldNormal: 'Normal (world)',
  ao: 'AO', roughness: 'Roughness', metallic: 'Metallic', height: 'Height', emissive: 'Emissive',
  clearcoat: 'Clearcoat', sheen: 'Sheen', anisotropy: 'Anisotropy', uv: 'UV Checker',
  diffuseOnly: 'Diffuse Only', specularOnly: 'Specular Only', ndotl: 'N dot L',
});
export const TONEMAP_LABELS = Object.freeze({
  aces: 'ACES', agx: 'AgX', khronosNeutral: 'Khronos Neutral', reinhard: 'Reinhard', filmic: 'Filmic', linear: 'None (clamp)',
});
/** View keys that the viewport adds to state.view when they are missing. */
export const VIEW_DEFAULTS = Object.freeze({
  fov: 35, ground: true, grid: false, shadows: true, shadowStrength: 0.85,
  aa: 'msaa',             // 'msaa' | 'fxaa' | 'both' | 'off'
  compare: 'off',         // 'off' | 'prev' (A = previous bake) | 'pinned' (A = pinned snapshot)
  compareSplit: 0.5,
  uvOffset: [0, 0], parallaxScale: 1, pomSteps: 32,
  normalStrength: 1, flipGreen: false, anisoRotation: 0, sheenRoughness: 0.5, specOcclusion: 1,
});
const RAW_VIEWS = new Set(VIEWPORT_DEBUG_VIEWS.filter(v => !['lit', 'diffuseOnly', 'specularOnly'].includes(v)));
const HDR = 'rgba16float';
const DEPTH = 'depth24plus';
const SHADOW_RES = 2048;
const LUT_RES = 128;
const SNAP_MAX = 1024;
const FRAME_FLOATS = 144;     // 576 bytes, see struct Frame
const MAT_FLOATS = 20;        // 80 bytes, see struct Material
const VB_STRIDE = 48;
const SUBDIV_OPTIONS = [32, 64, 96, 128, 192, 256, 384, 512];
const PREF_KEY = 'material-studio.viewport';
const PREF_VIEW_KEYS = ['mesh', 'debug', 'tonemap', 'exposure', 'fov', 'background', 'aa', 'ground', 'grid', 'shadows', 'shadowStrength',
  'uvScale', 'uvOffset', 'parallax', 'parallaxScale', 'pomSteps', 'displacement', 'subdiv', 'normalStrength', 'flipGreen',
  'anisoRotation', 'sheenRoughness', 'specOcclusion', 'autoRotate', 'wireframe'];

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

// ------------------------------------------------------------ module state
let store = null, state = null, gpu = null, device = null, envMod = null;
let canvas = null, wrap = null, hud = null, gctx = null, cam = null;
/** Runtime GPU objects and caches. */
const R = {
  SH: null, samp: {}, layout: {}, pipes: new Map(), modules: new Map(),
  lut: null, shadow: null, dummy2d: null, dummyCube: null,
  frameBuf: null, frameData: new Float32Array(FRAME_FLOATS), postBuf: null,
  frameBG: null, frameBGKey: '', shadowFrameBG: null, env: null,
  mesh: null, meshKey: '', custom: null, edgesFor: null,
  cur: null, def: null, test: null, A: null, lastCopy: null, matVersion: 0,
  targets: null, shadowSig: '', key: null,
  raf: 0, needs: false, last: 0, frameMs: 0, fps: 0, fpsT: 0, fpsN: 0,
  baking: false, envPoll: 0, warned: new Set(), disposed: false,
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const warnOnce = (k, msg) => { if (!R.warned.has(k)) { R.warned.add(k); console.warn('[viewport]', msg); } };

function hexToLinear(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
}
const norm3 = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// ------------------------------------------------------------ init
/** @param {object} ctx main.js module context */
export async function init(ctx) {
  store = ctx.store; state = store.state; gpu = ctx.gpu; envMod = ctx.modules.env || null;
  for (const [k, v] of Object.entries(VIEW_DEFAULTS)) if (state.view[k] === undefined) state.view[k] = Array.isArray(v) ? [...v] : v;
  const prefs = readPrefs();
  if (prefs.view) for (const k of PREF_VIEW_KEYS) if (prefs.view[k] !== undefined) state.view[k] = prefs.view[k];
  if (!C.MESHES.includes(state.view.mesh)) state.view.mesh = 'sphere';
  if (!VIEWPORT_DEBUG_VIEWS.includes(state.view.debug)) state.view.debug = 'lit';

  canvas = ctx.$('vp'); wrap = canvas.parentElement; hud = ctx.$('vp-hud');
  buildHud();
  ctx.register('viewport', api);

  if (!gpu.ok || !gpu.device) { hud.classList.add('vp-nogpu'); return; }
  device = gpu.device;
  R.SH = await loadShaders(import.meta.url, [
    'shaders/viewport-common.wgsl', 'shaders/pbr.wgsl', 'shaders/viewport-bg.wgsl',
    'shaders/viewport-post.wgsl', 'shaders/viewport-lut.wgsl',
  ]);
  createStatic();
  buildLut();
  R.def = defaultSet();
  R.cur = R.def;

  cam = createOrbitCamera(canvas, {
    onEnvRotate: d => { let r = (Number(state.env.rotation) || 0) + d; r = ((r + 180) % 360 + 360) % 360 - 180; store.setEnv({ rotation: Math.round(r * 10) / 10 }); },
    getRadius: () => (R.mesh && R.mesh.radius) || 1,
  });
  cam.fov = clamp(+state.view.fov || 35, 10, 100);
  cam.update(0, Math.max(1, wrap.clientWidth) / Math.max(1, wrap.clientHeight));
  // keep the saved angles, refit the distance to this viewport's aspect
  if (prefs.camera) cam.setState({ yaw: prefs.camera.yaw, pitch: prefs.camera.pitch, fov: prefs.camera.fov });
  cam.frame(1, !!prefs.camera, true);
  cam.autoRotate = !!state.view.autoRotate;
  cam.onChange(() => { requestRender(); savePrefsSoon(); });

  gctx = gpu.configureCanvas(canvas);
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
function createStatic() {
  const d = device;
  R.samp.map = d.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 8 });
  R.samp.env = d.createSampler({ addressModeU: 'repeat', addressModeV: 'clamp-to-edge', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' });
  R.samp.clamp = d.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  R.samp.shadow = d.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' });

  const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, FR = GPUShaderStage.FRAGMENT;
  const tex = (binding, vis = VF) => ({ binding, visibility: vis, texture: { sampleType: 'float', viewDimension: '2d' } });
  R.layout.mat = d.createBindGroupLayout({
    label: 'vp-material',
    entries: [
      { binding: 0, visibility: VF, buffer: { type: 'uniform' } },
      tex(1), tex(2), tex(3), tex(4), tex(5), tex(6),
      { binding: 7, visibility: VF, sampler: { type: 'filtering' } },
    ],
  });
  R.layout.frameOnly = d.createBindGroupLayout({ label: 'vp-frame-only', entries: [{ binding: 0, visibility: VF, buffer: { type: 'uniform' } }] });
  R.layout.post = d.createBindGroupLayout({
    label: 'vp-post',
    entries: [tex(0, FR), { binding: 1, visibility: FR, sampler: { type: 'filtering' } }, { binding: 2, visibility: FR, buffer: { type: 'uniform' } }],
  });
  R.layout.blit = d.createBindGroupLayout({ label: 'vp-blit', entries: [tex(0, FR), { binding: 1, visibility: FR, sampler: { type: 'filtering' } }] });

  R.frameBuf = d.createBuffer({ label: 'vp-frame', size: FRAME_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  R.postBuf = d.createBuffer({ label: 'vp-post', size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  R.shadowFrameBG = d.createBindGroup({ layout: R.layout.frameOnly, entries: [{ binding: 0, resource: { buffer: R.frameBuf } }] });

  R.dummy2d = d.createTexture({ label: 'vp-dummy2d', size: [1, 1, 1], format: HDR, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  R.dummyCube = d.createTexture({ label: 'vp-dummycube', size: [1, 1, 6], format: HDR, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  R.shadow = d.createTexture({ label: 'vp-shadow', size: [SHADOW_RES, SHADOW_RES, 1], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
  R.shadowView = R.shadow.createView();
  R.lut = d.createTexture({ label: 'vp-brdf-lut', size: [LUT_RES, LUT_RES, 1], format: HDR, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
  R.lutView = R.lut.createView();
}

function shaderModule(label, code) {
  if (R.modules.has(code)) return R.modules.get(code);
  const m = device.createShaderModule({ label, code });
  m.getCompilationInfo?.().then(info => {
    for (const msg of info.messages) if (msg.type === 'error') console.error(`[viewport] WGSL ${label} ${msg.lineNum}:${msg.linePos} ${msg.message}`);
  }).catch(() => {});
  R.modules.set(code, m);
  return m;
}

function buildLut() {
  const m = shaderModule('vp-lut', R.SH['shaders/viewport-lut.wgsl']);
  const p = device.createRenderPipeline({
    label: 'vp-lut', layout: 'auto',
    vertex: { module: m, entryPoint: 'vs_full' },
    fragment: { module: m, entryPoint: 'fs_lut', targets: [{ format: HDR }] },
  });
  const enc = device.createCommandEncoder();
  const pass = enc.beginRenderPass({ colorAttachments: [{ view: R.lutView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
  pass.setPipeline(p); pass.draw(3); pass.end();
  device.queue.submit([enc.finish()]);
}

// ------------------------------------------------------------ environment
function safeEnvBindings() {
  try { return envMod && typeof envMod.getEnvBindings === 'function' ? envMod.getEnvBindings() : null; }
  catch (e) { warnOnce('envthrow', 'getEnvBindings threw: ' + e.message); return null; }
}
function usableTex(t, name) {
  if (!t || typeof t.createView !== 'function') return false;
  if (/32float$/.test(t.format || '') && !gpu.features.float32Filterable) { warnOnce('f32' + name, `${name} is ${t.format} and float32-filterable is missing; ignored`); return false; }
  return true;
}
const dimOf = (t, hint) => hint ? (hint === 'cube' ? 'cube' : '2d') : (t.depthOrArrayLayers === 6 ? 'cube' : '2d');

/** Read env.js and return the frame environment description. */
function envState() {
  const b = safeEnvBindings();
  const e = { b, kind: 'proc', radDim: '2d', irrMode: 'proc', rad: null, irr: null, mips: 8, sh: null, sun: null, lib: '' };
  if (b && b.specTex && typeof envMod.envWGSL === 'function' && typeof envMod.envBindGroupEntries === 'function') {
    try { e.lib = envMod.envWGSL({ group: 0, binding: 8 }); } catch (err) { warnOnce('envwgsl', 'envWGSL failed: ' + err.message); }
  }
  if (e.lib) {
    e.kind = 'lib'; e.rad = b.specTex; e.irrMode = 'lib';
    e.mips = Math.max(1, b.mipCount || b.specTex.mipLevelCount || 1);
  } else if (b && usableTex(b.radiance, 'radiance')) {
    e.kind = 'tex';
    e.rad = b.radiance;
    e.radDim = dimOf(b.radiance, b.radianceDim || (b.kind === 'cube' ? 'cube' : null));
    e.mips = Math.max(1, b.mipCount || b.radiance.mipLevelCount || 1);
    if (b.irradiance && usableTex(b.irradiance, 'irradiance')) { e.irr = b.irradiance; e.irrMode = dimOf(b.irradiance, b.irradianceDim) === 'cube' ? 'cube' : '2d'; }
    else if (b.sh && b.sh.length >= 27) { e.irrMode = 'sh'; e.sh = b.sh; }
    else e.irrMode = 'rad';
    if (Array.isArray(b.sunDir) && b.sunDir.length === 3) e.sun = norm3(b.sunDir);
  }
  e.key = `${e.kind}|${e.radDim}|${e.irrMode}`;
  return e;
}

/** Generated WGSL for the env bindings 1 and 2 and the two sampling functions. */
function envChunk(e) {
  if (e.kind === 'lib') {
    return `
// ---- generated by viewport.js envChunk (lib): env.js envWGSL at bindings 8..13
${e.lib}
@group(0) @binding(1) var tRad: texture_2d<f32>;
@group(0) @binding(2) var tIrr: texture_2d<f32>;
fn env_radiance(dir: vec3f, lod: f32) -> vec3f {
  return envSpecular(dir, lod / max(F.env.z - 1.0, 1.0));
}
fn env_irradiance(n: vec3f) -> vec3f {
  return envIrradiance(n);
}
fn env_background(d: vec3f) -> vec3f {
  return envBackground(d);
}
`;
  }
  const radT = e.radDim === 'cube' ? 'texture_cube<f32>' : 'texture_2d<f32>';
  const irrT = e.irrMode === 'cube' ? 'texture_cube<f32>' : 'texture_2d<f32>';
  const co = dim => (dim === 'cube' ? 'd' : 'env_uv(d)');
  let irr;
  if (e.kind === 'proc') irr = 'return sky_proc(n, 1.0) * F.env.y;';
  else if (e.irrMode === 'cube' || e.irrMode === '2d') irr = `let d = env_rot(n);\n  return textureSampleLevel(tIrr, sEnv, ${co(e.irrMode)}, 0.0).rgb * F.env.y;`;
  else if (e.irrMode === 'sh') irr = 'return sh_eval(env_rot(n)) * F.env.y;';
  else irr = `let d = env_rot(n);\n  return textureSampleLevel(tRad, sEnv, ${co(e.radDim)}, max(F.env.z - 1.0, 0.0)).rgb * F.env.y;`;
  const rad = e.kind === 'proc'
    ? 'return sky_proc(env_rot(dir), lod / max(F.env.z - 1.0, 1.0)) * F.env.y;'
    : `let d = env_rot(dir);\n  return textureSampleLevel(tRad, sEnv, ${co(e.radDim)}, lod).rgb * F.env.y;`;
  return `
// ---- generated by viewport.js envChunk (${e.key})
@group(0) @binding(1) var tRad: ${radT};
@group(0) @binding(2) var tIrr: ${irrT};
fn env_radiance(dir: vec3f, lod: f32) -> vec3f {
  ${rad}
}
fn env_irradiance(n: vec3f) -> vec3f {
  ${irr}
}
fn env_background(d: vec3f) -> vec3f {
  return env_radiance(d, F.bgB.x);
}
`;
}

function frameLayout(e) {
  const k = 'frame|' + e.key;
  if (R.layout[k]) return R.layout[k];
  const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
  R.layout[k] = device.createBindGroupLayout({
    label: 'vp-' + k,
    entries: [
      { binding: 0, visibility: VF, buffer: { type: 'uniform' } },
      { binding: 1, visibility: VF, texture: { sampleType: 'float', viewDimension: e.radDim === 'cube' && e.kind === 'tex' ? 'cube' : '2d' } },
      { binding: 2, visibility: VF, texture: { sampleType: 'float', viewDimension: e.irrMode === 'cube' ? 'cube' : '2d' } },
      { binding: 3, visibility: VF, sampler: { type: 'filtering' } },
      { binding: 4, visibility: VF, texture: { sampleType: 'float', viewDimension: '2d' } },
      { binding: 5, visibility: VF, texture: { sampleType: 'depth', viewDimension: '2d' } },
      { binding: 6, visibility: VF, sampler: { type: 'comparison' } },
      { binding: 7, visibility: VF, sampler: { type: 'filtering' } },
      ...(e.kind === 'lib' ? envMod.envBindGroupLayoutEntries(8, VF) : []),
    ],
  });
  return R.layout[k];
}

/** (Re)build the frame bind group when the env textures change. */
function ensureFrameBG(e) {
  const id = `${e.key}|${idOf(e.rad)}|${idOf(e.irr)}`;
  if (R.frameBG && R.frameBGKey === id) return;
  const radView = e.kind === 'tex' ? e.rad.createView({ dimension: e.radDim === 'cube' ? 'cube' : '2d' }) : R.dummy2d.createView();
  const irrView = (e.irrMode === 'cube' || e.irrMode === '2d') ? e.irr.createView({ dimension: e.irrMode === 'cube' ? 'cube' : '2d' }) : R.dummy2d.createView();
  R.frameBG = device.createBindGroup({
    label: 'vp-frame-bg',
    layout: frameLayout(e),
    entries: [
      { binding: 0, resource: { buffer: R.frameBuf } },
      { binding: 1, resource: radView },
      { binding: 2, resource: irrView },
      { binding: 3, resource: R.samp.env },
      { binding: 4, resource: R.lutView },
      { binding: 5, resource: R.shadowView },
      { binding: 6, resource: R.samp.shadow },
      { binding: 7, resource: R.samp.clamp },
      ...(e.kind === 'lib' ? envMod.envBindGroupEntries(8) : []),
    ],
  });
  R.frameBGKey = id;
}
const idMap = new WeakMap(); let idNext = 1;
function idOf(o) { if (!o) return 0; if (!idMap.has(o)) idMap.set(o, idNext++); return idMap.get(o); }

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

function mapTexture(label, res, usage = 0) {
  return device.createTexture({
    label, size: [res, res, 1], format: HDR,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT | usage,
  });
}

// float -> half float bits
const f32b = new Float32Array(1), u32b = new Uint32Array(f32b.buffer);
function toHalf(v) {
  f32b[0] = v; const x = u32b[0];
  const sign = (x >>> 16) & 0x8000;
  const e = ((x >>> 23) & 0xff) - 112;
  const m = x & 0x7fffff;
  if (e <= 0) return sign;
  if (e >= 31) return sign | 0x7c00;
  return sign | (e << 10) | (m >>> 13);
}
function writeHalf(tex, res, fn) {
  const data = new Uint16Array(res * res * 4);
  const px = [0, 0, 0, 0];
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    fn((x + 0.5) / res, (y + 0.5) / res, px, x, y);
    const o = (y * res + x) * 4;
    data[o] = toHalf(px[0]); data[o + 1] = toHalf(px[1]); data[o + 2] = toHalf(px[2]); data[o + 3] = toHalf(px[3]);
  }
  device.queue.writeTexture({ texture: tex }, data, { bytesPerRow: res * 8, rowsPerImage: res }, [res, res, 1]);
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
 * Synthetic maps for tests and for a quick look before the bake works:
 * a checker base color, studs with bevels in height, a +Y normal map made
 * from that height, metal studs, emissive stripes, clearcoat on the left half,
 * sheen on the bottom quarter, anisotropy on the studs, an opacity corner.
 */
export function makeTestMaps(res = 512) {
  const H = new Float32Array(res * res);
  const studH = (u, v) => {
    const cx = (u * 4) % 1 - 0.5, cy = (v * 4) % 1 - 0.5;
    const d = Math.hypot(cx, cy);
    const stud = 1 - smooth(0.24, 0.33, d);
    const groove = Math.exp(-Math.pow(((u + v) * 6) % 1 - 0.5, 2) / 0.002) * 0.12;
    return { h: 0.5 + 0.32 * stud - groove * (1 - stud), stud, cx, cy };
  };
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) H[y * res + x] = studH((x + 0.5) / res, (y + 0.5) / res).h;
  const h = (x, y) => H[((y + res) % res) * res + ((x + res) % res)];
  const tex = {};
  for (const k of C.MAP_NAMES) tex[k] = mapTexture('vp-test-' + k, res);
  writeHalf(tex.height, res, (u, v, px, x, y) => { const s = h(x, y); px[0] = px[1] = px[2] = s; px[3] = 1; });
  const k = res / 24;
  writeHalf(tex.normal, res, (u, v, px, x, y) => {
    const du = (h(x + 1, y) - h(x - 1, y)) * 0.5, dv = (h(x, y + 1) - h(x, y - 1)) * 0.5;
    // OpenGL +Y: green follows image-up, which is -v
    const n = norm3([-du * k, dv * k, 1]);
    px[0] = n[0] * 0.5 + 0.5; px[1] = n[1] * 0.5 + 0.5; px[2] = n[2] * 0.5 + 0.5; px[3] = 1;
  });
  writeHalf(tex.albedo, res, (u, v, px) => {
    const s = studH(u, v);
    const ch = ((Math.floor(u * 8) + Math.floor(v * 8)) & 1) === 1;
    const c = s.stud > 0.5 ? [0.95, 0.72, 0.32] : ch ? [0.62, 0.18, 0.06] : [0.32, 0.36, 0.42];
    px[0] = c[0]; px[1] = c[1]; px[2] = c[2];
    px[3] = (u > 0.75 && v < 0.25) ? 0.25 + 0.75 * ((v * 4) % 1) : 1;
  });
  writeHalf(tex.orm, res, (u, v, px, x, y) => {
    const s = studH(u, v);
    const lap = (h(x + 2, y) + h(x - 2, y) + h(x, y + 2) + h(x, y - 2)) * 0.25 - h(x, y);
    px[0] = clamp(1 - Math.max(0, lap) * 18, 0.2, 1);
    px[1] = s.stud > 0.5 ? 0.22 : (((Math.floor(u * 8) + Math.floor(v * 8)) & 1) ? 0.45 : 0.75);
    px[2] = s.stud > 0.5 ? 1 : 0;
    px[3] = 1;
  });
  writeHalf(tex.emissive, res, (u, v, px) => {
    const band = Math.abs(((v * 8) % 1) - 0.5) < 0.02 && u < 0.25 ? 1 : 0;
    px[0] = 0.2 * band; px[1] = 1.4 * band; px[2] = 2.0 * band; px[3] = 1;
  });
  writeHalf(tex.extra, res, (u, v, px) => {
    const s = studH(u, v);
    px[0] = u < 0.5 ? 1 : 0; px[1] = 0.06; px[2] = v > 0.75 ? 0.8 : 0; px[3] = s.stud > 0.5 ? 0.7 : 0;
  });
  return { ...tex, res, scalars: { ...C.DEFAULT_SCALARS, displacementScale: 0.04 } };
  function smooth(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
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

// ------------------------------------------------------------ lights
function lightsState(e) {
  const out = [];
  let key = null, keyIdx = -1;
  const rot = ((Number(state.env.rotation) || 0) * Math.PI) / 180;
  for (const L of (state.env.lights || [])) {
    if (out.length >= 4) break;
    if (!L || L.on === false || L.enabled === false) continue;
    const type = L.type === 'point' ? 2 : 1;
    const c = hexToLinear(L.color || '#ffffff');
    const I = Number.isFinite(+L.intensity) ? +L.intensity : 1;
    let v;
    if (type === 1) {
      if (Array.isArray(L.dir)) v = norm3(L.dir);
      else {
        const az = ((+L.azimuth || 0) * Math.PI) / 180, el = ((L.elevation ?? 45) * Math.PI) / 180;
        v = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
      }
      if (keyIdx < 0) { key = v; keyIdx = out.length; }
    } else {
      const d = Array.isArray(L.dir) && L.dir.length >= 3 ? norm3(L.dir.map(Number)) : norm3([0.4, 0.7, 0.6]);
      v = Array.isArray(L.pos) ? L.pos.slice(0, 3).map(Number) : d.map(x => x * (+L.dist || 3));
    }
    // w: 1 dir, 2 + range point (range 0 = pure inverse square)
    out.push({ type: type === 2 ? 2 + Math.max(0, +L.range || 0) : 1, v, color: c.map(x => x * Math.max(0, I)) });
  }
  if (!key) {
    if (e.sun) key = e.sun;
    else if (e.kind === 'proc') key = norm3([0.55, 0.62, 0.56]);
    else key = norm3([0.25, 1, 0.2]);
    if (e.sun || e.kind === 'proc') { // the studio key and a sun turn with the environment
      const c = Math.cos(rot), s = Math.sin(rot);
      key = [c * key[0] - s * key[2], key[1], s * key[0] + c * key[2]];
    }
  }
  return { lights: out, key, keyIdx };
}

function shadowMatrix(key, radius, groundY) {
  const up = Math.abs(key[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
  const r = radius * 1.25 + 0.2;
  const eye = [key[0] * 8, key[1] * 8, key[2] * 8];
  const view = lookAt(eye, [0, 0, 0], up);
  // tighten the box so the ground near the mesh is inside it too
  const proj = ortho(-r * 1.6, r * 1.6, -r * 1.6, r * 1.6, 8 - r * 2.5, 8 + r * 2.5 + Math.max(0, -groundY));
  return m4mul(proj, view);
}

// ------------------------------------------------------------ targets
function makeTargets(w, h, samples, fxaa, finalFormat = gpu.format) {
  const d = device;
  const T = { w, h, samples, fxaa };
  T.hdr = d.createTexture({ label: 'vp-hdr', size: [w, h, 1], format: HDR, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
  T.msaa = samples > 1 ? d.createTexture({ label: 'vp-msaa', size: [w, h, 1], format: HDR, sampleCount: samples, usage: GPUTextureUsage.RENDER_ATTACHMENT }) : null;
  T.depth = d.createTexture({ label: 'vp-depth', size: [w, h, 1], format: DEPTH, sampleCount: samples, usage: GPUTextureUsage.RENDER_ATTACHMENT });
  T.ldr = fxaa ? d.createTexture({ label: 'vp-ldr', size: [w, h, 1], format: finalFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING }) : null;
  T.hdrView = T.hdr.createView(); T.msaaView = T.msaa && T.msaa.createView(); T.depthView = T.depth.createView(); T.ldrView = T.ldr && T.ldr.createView();
  T.tonemapBG = d.createBindGroup({ layout: R.layout.post, entries: [{ binding: 0, resource: T.hdrView }, { binding: 1, resource: R.samp.clamp }, { binding: 2, resource: { buffer: R.postBuf } }] });
  T.fxaaBG = fxaa ? d.createBindGroup({ layout: R.layout.post, entries: [{ binding: 0, resource: T.ldrView }, { binding: 1, resource: R.samp.clamp }, { binding: 2, resource: { buffer: R.postBuf } }] }) : null;
  T.finalFormat = finalFormat;
  return T;
}
function destroyTargets(T) { if (!T) return; for (const k of ['hdr', 'msaa', 'depth', 'ldr']) try { T[k] && T[k].destroy(); } catch (e) {} }

function aaMode() { const a = state.view.aa; return { samples: a === 'msaa' || a === 'both' ? 4 : 1, fxaa: a === 'fxaa' || a === 'both' }; }

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
  return { groundOn, shadowM, raw };
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
    Math.pow(2, +v.exposure || 0), tm, fr.raw ? 1 : 0, 1,
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

// ------------------------------------------------------------ prefs
function readPrefs() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch (e) { return {}; }
}
let prefTimer = 0;
function savePrefsSoon() {
  clearTimeout(prefTimer);
  prefTimer = setTimeout(() => {
    try {
      const view = {};
      for (const k of PREF_VIEW_KEYS) if (state.view[k] !== undefined) view[k] = state.view[k];
      if (view.mesh === 'custom') view.mesh = 'sphere';
      localStorage.setItem(PREF_KEY, JSON.stringify({ view, camera: cam ? cam.getState() : null }));
    } catch (e) {}
  }, 400);
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
