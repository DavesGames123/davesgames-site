// ============================================================================
//  MATERIAL STUDIO  ·  viewport/targets.js — render targets and the anti-alias mode
// ────────────────────────────────────────────────────────────────────────────
//  Makes the HDR, MSAA, depth and LDR textures for one frame size, and the
//  post pass bind groups that read them. The canvas keeps one set in
//  R.targets. renderOffscreen() makes a set for each call and destroys it.
//
//  GREP TARGETS
//      makeTargets ............ textures and post bind groups for w x h
//      destroyTargets ......... destroy the textures of a set
//      aaMode ................. {samples, fxaa} from state.view.aa
// ============================================================================
import { HDR, DEPTH, gpu, device, state, R } from './state.js';

export function makeTargets(w, h, samples, fxaa, finalFormat = gpu.format) {
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
export function destroyTargets(T) { if (!T) return; for (const k of ['hdr', 'msaa', 'depth', 'ldr']) try { T[k] && T[k].destroy(); } catch (e) {} }

export function aaMode() { const a = state.view.aa; return { samples: a === 'msaa' || a === 'both' ? 4 : 1, fxaa: a === 'fxaa' || a === 'both' }; }
