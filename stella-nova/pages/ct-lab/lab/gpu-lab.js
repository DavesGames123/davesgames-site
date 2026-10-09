// lab/gpu-lab.js - optional WebGPU back end for the CT lab. It wraps the engine runner
// (engine/gpu.js) for the two jobs the lab gives the GPU: forward projection of the
// phantom (and its basis images) and the full FBP back-projection. Any GPU error turns
// the GPU off for the rest of the visit, and the CPU code takes over.
//
// grep handles: initGpu, gpuForward, gpuFBP, releaseGpu

import { createGpuCT } from '../engine/index.js';

let state = null;   // { device, ct } or null

export async function initGpu() {
  try {
    const gpu = globalThis.navigator && navigator.gpu;
    if (!gpu) return null;
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    const ct = createGpuCT(device);
    state = { device, ct };
    device.lost.then(() => { state = null; });
    return state;
  } catch (e) {
    state = null;
    return null;
  }
}

export const gpuReady = () => !!state;

// forward(image, geom) -> Promise<Sinogram>, or null when the GPU is off.
export async function gpuForward(image, geom) {
  if (!state) return null;
  try { return await state.ct.forward2D(image, geom); } catch (e) { releaseGpu(); return null; }
}

// Back-project a filtered sinogram with FBP weights. -> Image2D, or null.
export async function gpuFBP(filtered, geom, dims, weights) {
  if (!state) return null;
  try { return await state.ct.backProject2D(filtered, geom, dims, { fbp: true, weights }); } catch (e) { releaseGpu(); return null; }
}

export function releaseGpu() {
  if (!state) return;
  try { state.ct.destroy(); } catch (e) { /* already gone */ }
  try { state.device.destroy(); } catch (e) { /* already gone */ }
  state = null;
}
