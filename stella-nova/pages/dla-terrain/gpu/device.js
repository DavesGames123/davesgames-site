// ============================================================================
//  DLA TERRAIN  ·  gpu/device.js — the device, the shared layouts, loadWGSL
// ----------------------------------------------------------------------------
//  createGPU(canvas, opts) -> gpu, the object of the module interface in
//  CONTRACT.md:
//    gpu = { device, queue, hdrFormat: 'rgba16float', depthFormat:
//            'depth32float', globalsLayout, globalsBindGroup (a getter: it is
//            new when the terrain size changes), loadWGSL(url), assets,
//            quality, ... }
//  plus the CORE extras that the packages can use:
//    canvasFormat, context      the swap chain (null in Deno, see opts.headless)
//    globalsBuffer              the Globals uniform (528 bytes)
//    shadowSampleLayout         group 2 for opaque, water and volumetric
//                               (tShadow, sShadow, cascades)
//    shadowPassLayout           group 2 for drawShadow (SP)
//    emptyLayout                a bind group layout with no entries, for a
//                               pipeline that has no group 1
//    shadowDepthState           depthStencil state for a shadow pipeline
//    depthState(write, compare) depthStencil state for a scene pipeline
//    sLinear, sNearest, sRepeat samplers
//    shadowCascades, shadowSize the cascade count and the map size
//
//    loadRawWGSL(url)           one file, no prefix
//    coarse                     a touch screen (true): packages may do less
//    profile, profileId         the device profile of gpu/budget.js (caps
//                               that the modules read: gpu.profile.veg ...)
//    onPressure(fn)             fn(profileId) after an out-of-memory error
//                               took the profile one step lower
//    shadows, shadowSampleBindGroup, shadowSplits   the cascade state
//
//  loadWGSL(url) fetches shaders/common.wgsl, then the detail file
//  (../../lib/dla-terrain-detail.wgsl, else gpu/detail-stub.wgsl), then url,
//  and returns the joined text. A relative url resolves against the page
//  folder (pages/dla-terrain/). The texts are cached.
//
//  PHONES (gpu/budget.js): the profile comes from opts.profile, ?gpu=<id>,
//  the step after a device loss, or detectProfile. A phone profile asks for
//  no raised limits (phoneLimits: the WebGPU defaults, plus only what a
//  module needs over them). device.lost: the next createGPU runs one profile
//  lower; after a second loss createGPU throws (no restart loop).
//
//  SAFARI (gpu/budget.js header): Safari on a Mac, or an Apple GPU in the
//  adapter info, takes the 'safari' profile when no profile is forced.
//  opts.safeStart (main.js CRASH GUARD) takes 'safe' instead of the
//  desktop or Safari profile. gpu.mem is the live GPU byte tally of the
//  device (budget.js trackDevice): every createBuffer and createTexture of
//  every module, less the destroyed ones; gpu/frame.js holds it under the
//  profile budgetMB. gpu.profileWhy says why the profile was picked.
//
//  grep -n targets: "export async function createGPU", "function loadWGSL",
//  "globalsLayout", "shadowSampleLayout", "shadowPassLayout",
//  "export function phoneLimits", "export const recovery"
// ============================================================================
import { GLOBALS_BYTES } from './globals.js';
import { detectProfile, pageEnv, profileFor, lostPolicy, pressureStep, PROFILES, isAppleGPU, trackDevice, guardProfile } from './budget.js';

const PAGE = new URL('../', import.meta.url);
export const DETAIL_URLS = [new URL('../../../lib/dla-terrain-detail.wgsl', import.meta.url).href,
  new URL('./detail-stub.wgsl', import.meta.url).href];

const texts = new Map();
async function fetchText(u) {
  if (texts.has(u)) return texts.get(u);
  const p = (async () => {
    const r = await fetch(u);
    if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
    return r.text();
  })();
  texts.set(u, p);
  p.catch(() => texts.delete(u));
  return p;
}
let prefixP = null;
export function wgslPrefix() {
  if (prefixP) return prefixP;
  prefixP = (async () => {
    const common = await fetchText(new URL('shaders/common.wgsl', PAGE).href);
    let detail = null, from = null;
    for (const u of DETAIL_URLS) {
      try { detail = await fetchText(u); from = u; break; } catch { /* next */ }
    }
    if (detail && !/fn\s+detailHeight\s*\(/.test(detail)) detail += '\n' + (await fetchText(DETAIL_URLS[1]));
    return { text: common + '\n// ── detail: ' + (from || 'none') + '\n' + (detail || '') + '\n', from };
  })();
  return prefixP;
}
// the text of one file, no prefix (a relative url resolves against the page)
export function loadRawWGSL(url) { return fetchText(new URL(url, PAGE).href); }
export async function loadWGSL(url) {
  const u = new URL(url, PAGE).href;
  const [pre, body] = await Promise.all([wgslPrefix(), fetchText(u)]);
  return pre.text + '\n// ── ' + url + '\n' + body;
}

export const QUALITY = [
  { id: 'low', label: 'Low', q: 0.25, scale: 0.6, shadow: 1024, cascades: 3, taa: false },
  { id: 'medium', label: 'Medium', q: 0.5, scale: 0.8, shadow: 2048, cascades: 3, taa: true },
  { id: 'high', label: 'High', q: 0.75, scale: 1.0, shadow: 2048, cascades: 4, taa: true },
  { id: 'ultra', label: 'Ultra', q: 1.0, scale: 1.0, shadow: 4096, cascades: 4, taa: true },
];

// The packages need more than the WebGPU defaults (VEG has 9 storage
// buffers in one compute stage, for example): ask for what the adapter has,
// with caps on the sizes.
const RAISE = ['maxStorageBuffersPerShaderStage', 'maxStorageTexturesPerShaderStage', 'maxSampledTexturesPerShaderStage',
  'maxSamplersPerShaderStage', 'maxUniformBuffersPerShaderStage', 'maxBindingsPerBindGroup', 'maxDynamicUniformBuffersPerPipelineLayout',
  'maxDynamicStorageBuffersPerPipelineLayout', 'maxComputeWorkgroupStorageSize', 'maxComputeInvocationsPerWorkgroup',
  'maxComputeWorkgroupSizeX', 'maxComputeWorkgroupSizeY', 'maxComputeWorkgroupSizeZ', 'maxColorAttachmentBytesPerSample',
  'maxInterStageShaderVariables', 'maxVertexBuffers', 'maxVertexAttributes', 'maxTextureArrayLayers', 'maxBindGroups'];
export function deviceLimits(lim) {
  const out = {};
  for (const k of RAISE) if (lim[k] !== undefined) out[k] = lim[k];
  out.maxTextureDimension2D = Math.min(lim.maxTextureDimension2D, 8192);
  out.maxStorageBufferBindingSize = Math.min(lim.maxStorageBufferBindingSize, 1 << 30);
  out.maxBufferSize = Math.min(lim.maxBufferSize, 1 << 30);
  return out;
}

// A phone asks for the WebGPU defaults, plus only the limits over the
// defaults that a module needs (each capped at the adapter). NEED lists
// them; a Deno run of every module on a default-limit device found them.
export const NEED = {};
export function phoneLimits(lim) {
  const out = {};
  for (const k in NEED) if (lim[k] !== undefined) out[k] = Math.min(lim[k], NEED[k]);
  return out;
}

// the state that outlives one device: the profile after a loss, the losses
export const recovery = { losses: 0, next: null, blocked: false, oom: 0 };

// -> { id, why, forced }. A forced profile (opts.profile, a restart after a
// loss, ?gpu=) is kept; else the detected one, then the crash guard.
export function chooseProfile(opts = {}, adapterInfo = null) {
  if (opts.profile && PROFILES[opts.profile]) return { id: opts.profile, why: 'opts', forced: true };
  if (recovery.next) return { id: recovery.next, why: 'after a device loss', forced: true };
  let q = null;
  try { q = new URLSearchParams(globalThis.location ? location.search : '').get('gpu'); } catch { /* no location */ }
  if (q && PROFILES[q]) return { id: q, why: '?gpu=' + q, forced: true };
  const env = pageEnv();
  if (opts.coarse) env.coarse = true;
  env.adapterInfo = adapterInfo;
  const det = detectProfile(env);
  const id = opts.safeStart ? guardProfile(det, { unclean: true, zoomed: true }) : det;
  return { id, why: id !== det ? 'crash guard (was ' + det + ')' : det === 'safari' ? (isAppleGPU(adapterInfo) ? 'Apple GPU' : 'Safari') : 'detected', forced: false };
}

export async function createGPU(canvas, opts = {}) {
  if (!globalThis.navigator || !navigator.gpu) throw new Error('no WebGPU');
  if (recovery.blocked) throw new Error('the GPU was lost two times: no restart');
  let pick = chooseProfile(opts);
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: profileFor(pick.id).raiseLimits ? 'high-performance' : 'low-power' });
  if (!adapter) throw new Error('no WebGPU adapter');
  // an Apple GPU (adapter.info, when the browser has it) takes the Safari caps
  let info = null;
  try { info = adapter.info || null; } catch { info = null; }
  if (!pick.forced && pick.id === 'desktop' && isAppleGPU(info)) pick = chooseProfile(opts, info);
  const profileId = pick.id;
  const profile = profileFor(profileId);
  const want = [];
  for (const f of ['float32-filterable', 'rg11b10ufloat-renderable', 'timestamp-query']) if (adapter.features.has(f)) want.push(f);
  const lim = adapter.limits;
  const device = await adapter.requestDevice({
    requiredFeatures: want,
    requiredLimits: profile.raiseLimits ? deviceLimits(lim) : phoneLimits(lim),
  });
  // the live GPU bytes of this device (every module allocates through it)
  const mem = trackDevice(device, {});
  let context = null, canvasFormat = 'bgra8unorm';
  if (canvas && canvas.getContext) {
    context = canvas.getContext('webgpu');
    canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format: canvasFormat, alphaMode: 'opaque' });
  }
  const V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT, C = GPUShaderStage.COMPUTE, ALL = V | F | C;
  const globalsLayout = device.createBindGroupLayout({
    label: 'globals',
    entries: [
      { binding: 0, visibility: ALL, buffer: { type: 'uniform' } },
      { binding: 1, visibility: ALL, texture: { sampleType: 'unfilterable-float' } },
      { binding: 2, visibility: ALL, texture: { sampleType: 'float' } },
      { binding: 3, visibility: ALL, texture: { sampleType: 'float' } },
      { binding: 4, visibility: ALL, texture: { sampleType: 'uint' } },
      { binding: 5, visibility: ALL, sampler: { type: 'filtering' } },
    ],
  });
  const shadowSampleLayout = device.createBindGroupLayout({
    label: 'shadow sample',
    entries: [
      { binding: 0, visibility: ALL, texture: { sampleType: 'depth', viewDimension: '2d-array' } },
      { binding: 1, visibility: ALL, sampler: { type: 'comparison' } },
      { binding: 2, visibility: ALL, buffer: { type: 'uniform' } },
    ],
  });
  const shadowPassLayout = device.createBindGroupLayout({
    label: 'shadow pass',
    entries: [{ binding: 3, visibility: ALL, buffer: { type: 'uniform' } }],
  });
  const emptyLayout = device.createBindGroupLayout({ label: 'empty', entries: [] });
  const globalsBuffer = device.createBuffer({ label: 'Globals', size: Math.ceil(GLOBALS_BYTES / 16) * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const sLinear = device.createSampler({ label: 'linear clamp', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const sNearest = device.createSampler({ label: 'nearest clamp', magFilter: 'nearest', minFilter: 'nearest' });
  const sRepeat = device.createSampler({ label: 'linear repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat', maxAnisotropy: 8 });

  const qi = Math.max(0, Math.min(QUALITY.length - 1, opts.qualityIndex ?? 2));
  const capped = (v, cap) => (cap == null ? v : Math.min(v, cap));
  const gpu = {
    device, queue: device.queue, adapter, context, canvasFormat,
    hdrFormat: 'rgba16float', depthFormat: 'depth32float',
    globalsLayout, shadowSampleLayout, shadowPassLayout, emptyLayout,
    globalsBuffer, sLinear, sNearest, sRepeat,
    loadWGSL, loadRawWGSL, assets: opts.assets || null, coarse: !!opts.coarse,
    shadows: null,               // gpu/shadows.js object (main.js sets it)
    get shadowSampleBindGroup() { return gpu.shadows ? gpu.shadows.sampleBindGroup : null; },
    get shadowSplits() { return gpu.shadows && gpu.shadows.info ? gpu.shadows.info.splits : null; },
    qualityIndex: qi, quality: QUALITY[qi].q, qualityPreset: QUALITY[qi],
    shadowSize: capped(Math.min(QUALITY[qi].shadow, device.limits.maxTextureDimension2D), profile.shadowSize),
    shadowCascades: capped(QUALITY[qi].cascades, profile.cascades),
    profile, profileId, profileWhy: pick.why, adapterInfo: info, mem, recovery, pressureFns: [],
    onPressure(fn) { gpu.pressureFns.push(fn); },
    features: want,
    shadowDepthState: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater', depthBias: -2, depthBiasSlopeScale: -2.0, depthBiasClamp: 0 },
    depthState(write = true, compare = 'greater') { return { format: 'depth32float', depthWriteEnabled: write, depthCompare: compare }; },
    _globalsBG: null,
    get globalsBindGroup() { return gpu._globalsBG; },
  };
  // a loss: the next createGPU (main.js onLost -> bootGPU) runs one profile
  // lower, one time. This handler is the first on device.lost, so the state
  // is set before main.js restarts.
  device.lost.then(info => {
    const r = lostPolicy(recovery, info, gpu.profileId);
    if (info && info.reason === 'destroyed') return;
    if (r.restart) recovery.next = r.profile; else recovery.blocked = true;
    console.warn('dla-terrain: device lost (' + r.why + '), next profile', r.restart ? r.profile : 'none');
  });
  // out of memory: one profile lower for what is made from now on; the frame
  // graph (gpu/frame.js) also lowers the size of its targets
  const onError = e => {
    const err = e && e.error;
    const oom = err && ((typeof GPUOutOfMemoryError !== 'undefined' && err instanceof GPUOutOfMemoryError) || /out of memory|OutOfMemory/i.test(String(err.message || err.constructor?.name)));
    if (!oom) return;
    const next = pressureStep(recovery, gpu.profileId, globalThis.performance ? performance.now() : 0);
    if (next !== gpu.profileId) {
      gpu.profileId = next; gpu.profile = profileFor(next);
      gpu.shadowSize = capped(gpu.shadowSize, gpu.profile.shadowSize); gpu.shadowCascades = capped(gpu.shadowCascades, gpu.profile.cascades);
      console.warn('dla-terrain: GPU out of memory, profile', next);
      for (const fn of gpu.pressureFns) try { fn(next); } catch (x) { console.warn(x); }
    }
  };
  if (device.addEventListener) device.addEventListener('uncapturederror', onError);
  gpu._onError = onError;
  return gpu;
}

// group 0 for one set of terrain textures (terrain-gpu.js calls it)
export function makeGlobalsBindGroup(gpu, tex) {
  gpu._globalsBG = gpu.device.createBindGroup({
    label: 'globals',
    layout: gpu.globalsLayout,
    entries: [
      { binding: 0, resource: { buffer: gpu.globalsBuffer } },
      { binding: 1, resource: tex.height.createView() },
      { binding: 2, resource: tex.normal.createView() },
      { binding: 3, resource: tex.aux.createView() },
      { binding: 4, resource: tex.biome.createView() },
      { binding: 5, resource: gpu.sLinear },
    ],
  });
  return gpu._globalsBG;
}
