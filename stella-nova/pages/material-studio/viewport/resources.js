// ============================================================================
//  MATERIAL STUDIO  ·  viewport/resources.js — samplers, layouts, LUT, shadow map
// ────────────────────────────────────────────────────────────────────────────
//  The static GPU objects of the viewport. init() calls createStatic() and
//  buildLut() once after the shaders load. The objects go into R and stay
//  until the device is lost. shaderModule() keeps one module per WGSL source,
//  and it logs WGSL compile errors to the console.
//
//  GREP TARGETS
//      SHADOW_RES / LUT_RES ... shadow map and BRDF LUT size
//      createStatic ........... samplers, bind group layouts, buffers, textures
//      shaderModule ........... cached GPUShaderModule per source text
//      buildLut ............... renders viewport-lut.wgsl fs_lut into R.lut
// ============================================================================
import { HDR, FRAME_FLOATS, device, R } from './state.js';

const SHADOW_RES = 2048;
const LUT_RES = 128;

export function createStatic() {
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

export function shaderModule(label, code) {
  if (R.modules.has(code)) return R.modules.get(code);
  const m = device.createShaderModule({ label, code });
  m.getCompilationInfo?.().then(info => {
    for (const msg of info.messages) if (msg.type === 'error') console.error(`[viewport] WGSL ${label} ${msg.lineNum}:${msg.linePos} ${msg.message}`);
  }).catch(() => {});
  R.modules.set(code, m);
  return m;
}

export function buildLut() {
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
