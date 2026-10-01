// ============================================================================
//  MATERIAL STUDIO  ·  gpu.js — the one shared GPUDevice
// ────────────────────────────────────────────────────────────────────────────
//  initGPU() asks for one adapter and one device for the whole page. Every
//  module uses `gpu.device`; no module calls requestDevice itself. When
//  WebGPU is missing or the request fails, gpu.ok stays false, #nogpu shows,
//  and the graph editor and panels still work.
//
//  CONTENTS  (grep -n the name to jump)
//      gpu ................. the shared status object (device, format, ...)
//      initGPU ............. request the adapter and device, once
//      configureCanvas ..... configure a canvas context with gpu.format
//      onDeviceLost ........ subscribe to device loss
//      onTeardown .......... run a cleanup before the device is destroyed
//      withErrorScope ...... run GPU work inside a validation error scope
//      teardown ............ release everything (pagehide calls it)
//
//  DEVICE FEATURES AND LIMITS
//      'float32-filterable' is requested only when the adapter has it
//      (gpu.features.float32Filterable tells). The bake writes rgba16float,
//      which filters on every device. Selected limits are raised to the
//      adapter maximum: color attachments and bytes per sample (bake MRT),
//      texture size (4096 export), buffer sizes, sampled textures per stage.
//
//  PAGE SWAP
//      The site shell removes this iframe on a nav click. lib/gpu-guard.js
//      (loaded first in index.html) also destroys devices on release. This
//      module adds its own pagehide teardown: it runs onTeardown callbacks,
//      unconfigures canvases, then destroys the device.
// ============================================================================

/**
 * @type {{ok:boolean, reason:string, adapter:GPUAdapter|null, device:GPUDevice|null,
 *          format:GPUTextureFormat|null, features:{float32Filterable:boolean, timestampQuery:boolean},
 *          limits:Object<string,number>, adapterInfo:Object, lost:boolean,
 *          errors:{count:number, last:string[]}}}
 */
export const gpu = {
  ok: false, reason: 'not started', adapter: null, device: null, format: null,
  features: { float32Filterable: false, timestampQuery: false },
  limits: {}, adapterInfo: {}, lost: false,
  // Count and the last 20 messages of uncaptured GPU errors. selfTest reads them.
  errors: { count: 0, last: [] },
};

const lostFns = new Set();
const teardownFns = new Set();
const contexts = new Set();
let started = null;
let torn = false;

const RAISE = [
  'maxColorAttachments', 'maxColorAttachmentBytesPerSample', 'maxTextureDimension2D',
  'maxBufferSize', 'maxStorageBufferBindingSize', 'maxSampledTexturesPerShaderStage',
  'maxBindGroups', 'maxUniformBufferBindingSize',
];

function showBanner(reason) {
  const el = document.getElementById('nogpu');
  if (!el) return;
  const msg = el.querySelector('.why');
  if (msg) msg.textContent = reason;
  el.hidden = false;
}

/**
 * Request the shared adapter and device. Safe to call more than once: later
 * calls return the same promise. Never throws; check the result's ok.
 * @returns {Promise<typeof gpu>}
 */
export function initGPU() {
  if (started) return started;
  started = (async () => {
    if (!navigator.gpu) { gpu.reason = 'navigator.gpu is missing (WebGPU is off or not supported)'; showBanner(gpu.reason); return gpu; }
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) throw new Error('requestAdapter returned null');
      const requiredFeatures = [];
      if (adapter.features.has('float32-filterable')) requiredFeatures.push('float32-filterable');
      if (adapter.features.has('timestamp-query')) requiredFeatures.push('timestamp-query');
      const requiredLimits = {};
      for (const k of RAISE) if (adapter.limits[k] !== undefined) requiredLimits[k] = adapter.limits[k];
      const device = await adapter.requestDevice({ requiredFeatures, requiredLimits, label: 'material-studio' });
      gpu.adapter = adapter; gpu.device = device;
      gpu.format = navigator.gpu.getPreferredCanvasFormat();
      gpu.features.float32Filterable = device.features.has('float32-filterable');
      gpu.features.timestampQuery = device.features.has('timestamp-query');
      for (const k of RAISE) gpu.limits[k] = device.limits[k];
      try { gpu.adapterInfo = adapter.info ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture } : {}; } catch (e) {}
      gpu.ok = true; gpu.reason = '';
      device.lost.then(info => {
        gpu.ok = false; gpu.lost = true; gpu.reason = 'device lost: ' + (info.message || info.reason || '');
        if (torn) return;
        console.warn('[gpu]', gpu.reason);
        for (const fn of lostFns) { try { fn(info); } catch (e) { console.error(e); } }
      });
      device.addEventListener?.('uncapturederror', ev => {
        const msg = String(ev.error && ev.error.message || ev.error);
        gpu.errors.count++; gpu.errors.last.push(msg.slice(0, 500));
        if (gpu.errors.last.length > 20) gpu.errors.last.shift();
        console.error('[gpu] uncaptured error:', msg);
      });
      window.addEventListener('pagehide', teardown);
    } catch (e) {
      gpu.ok = false; gpu.reason = 'WebGPU device request failed: ' + (e && e.message || e);
      showBanner(gpu.reason);
    }
    return gpu;
  })();
  return started;
}

/**
 * Configure a canvas for the shared device. Returns null without a device.
 * @param {HTMLCanvasElement} canvas
 * @param {{alphaMode?:GPUCanvasAlphaMode, format?:GPUTextureFormat}} [opts]
 * @returns {GPUCanvasContext|null}
 */
export function configureCanvas(canvas, opts = {}) {
  if (!gpu.device) return null;
  const ctx = canvas.getContext('webgpu');
  if (!ctx) return null;
  ctx.configure({ device: gpu.device, format: opts.format || gpu.format, alphaMode: opts.alphaMode || 'opaque' });
  contexts.add(ctx);
  return ctx;
}

/** Subscribe to device loss (not called on pagehide teardown).
 *  @param {(info:GPUDeviceLostInfo)=>void} fn @returns {()=>void} */
export function onDeviceLost(fn) { lostFns.add(fn); return () => lostFns.delete(fn); }

/** Run fn before the device is destroyed (free textures, stop loops).
 *  @param {()=>void} fn @returns {()=>void} */
export function onTeardown(fn) { teardownFns.add(fn); return () => teardownFns.delete(fn); }

/**
 * Run `fn` inside a validation error scope and report the first error.
 * @template T
 * @param {string} label  shown in the console with the error
 * @param {()=>T} fn
 * @returns {Promise<{value:T|undefined, error:GPUError|null}>}
 */
export async function withErrorScope(label, fn) {
  const d = gpu.device;
  if (!d) return { value: undefined, error: null };
  d.pushErrorScope('validation');
  let value;
  try { value = fn(); } catch (e) { await d.popErrorScope(); throw e; }
  const error = await d.popErrorScope();
  if (error) console.error(`[gpu] ${label}:`, error.message);
  return { value, error };
}

/** Release all GPU work: run teardown callbacks, unconfigure canvases, destroy the device. */
export function teardown() {
  if (torn) return;
  torn = true;
  for (const fn of teardownFns) { try { fn(); } catch (e) {} }
  for (const c of contexts) { try { c.unconfigure(); } catch (e) {} }
  try { gpu.device && gpu.device.destroy(); } catch (e) {}
  gpu.ok = false; gpu.reason = 'torn down';
}

// The functions are also on the object, so ctx.gpu carries the whole API.
Object.assign(gpu, { initGPU, configureCanvas, onDeviceLost, onTeardown, withErrorScope, teardown });

export default gpu;
