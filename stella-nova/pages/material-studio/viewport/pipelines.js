// ============================================================================
//  MATERIAL STUDIO  ·  viewport/pipelines.js — render pipelines, cached by key
// ────────────────────────────────────────────────────────────────────────────
//  Makes the render pipelines of the viewport and keeps each one in R.pipes
//  under a key. The key holds every input that changes the pipeline: the env
//  key, the sample count, the cull mode, the blend and the target format. The
//  scene modules are viewport-common.wgsl, the envChunk WGSL and pbr.wgsl or
//  viewport-bg.wgsl, in that order.
//
//  GREP TARGETS
//      VB_LAYOUT .............. vertex layout: position, normal, uv, tangent
//      PREMUL ................. premultiplied alpha blend
//      sceneModule ............ common + envChunk + pbr / bg WGSL
//      pbrPipeline ............ mesh and wireframe
//      shadowPipeline ......... depth-only key light pass
//      bgPipeline ............. background and ground
//      postPipeline ........... tonemap and FXAA
//      blitPipeline ........... copy a map into a snapshot texture
// ============================================================================
import { HDR, DEPTH, gpu, device, R } from './state.js';
import { shaderModule } from './resources.js';
import { envChunk, frameLayout } from './environment.js';

const VB_STRIDE = 48;

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

function sceneModule(e, which) {
  const body = which === 'pbr' ? R.SH['shaders/pbr.wgsl'] : R.SH['shaders/viewport-bg.wgsl'];
  return shaderModule(`vp-${which}-${e.key}`, R.SH['shaders/viewport-common.wgsl'] + envChunk(e) + body);
}

/**
 * @param {object} e env state  @param {number} samples
 * @param {'back'|'front'|'none'} cull @param {boolean} blend @param {boolean} wire
 */
export function pbrPipeline(e, samples, cull, blend, wire = false) {
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

export function shadowPipeline(e) {
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

export function bgPipeline(e, samples, ground) {
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

export function postPipeline(entry, format = gpu.format) {
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

export function blitPipeline() {
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
