// ============================================================================
//  CORRUPTION  ·  gpu.js — the WebGPU renderer (no DOM: Deno imports it)
// ----------------------------------------------------------------------------
//  The shader is shaders/corruption.wgsl plus the library section of
//  pages/sdf-solids-table/shaders/pack.wgsl (the part between LIB_START and
//  LIB_END: camera helpers, hashing, gradient noise, Worley cells, distance
//  primitives, the studio, the optics and the finisher). buildModule() joins
//  them. The library is read from that page at load time and not copied, so
//  a fix there reaches this page too. tests.mjs checks that the two markers
//  are still in the pack.
//
//  ONE FRAME (frame())
//    compute  cs_sample (only after an SDF model change): surface points
//    pass 1   HDR rgba16float + depth32float:
//               fs_scene (ray march, writes frag_depth)
//               vs_mesh / fs_mesh (mesh models only, depth test)
//               vs_part x 4 shapes (instanced polyhedra)
//               vs_glyph (instanced digits, additive, no depth write)
//    pass 2   fs_post into the output view (canvas or offscreen texture)
//
//  GREP MAP
//    grep -n 'export function sliceLibrary'   the library cut
//    grep -n 'export async function createRenderer'
//    grep -n 'function resize'                HDR and depth targets
//    grep -n 'function setMesh'               mesh upload (null: SDF model)
//    grep -n 'function frame'                 encode one frame
//    grep -n 'async function pick'            one ray, read back
// ============================================================================
import { UNIFORM_FLOATS, UNIFORM_OFFSET } from './params.js';
import { polyhedra } from './models.js';

export const LIB_START = '// ── pixel, camera, rotation';
export const LIB_END = '// ── the 78 cells';
export const MAX_SAMPLES = 4096;
export const HDR_FORMAT = 'rgba16float';
export const DEPTH_FORMAT = 'depth32float';

export function sliceLibrary(pack) {
  const a = pack.indexOf(LIB_START), b = pack.indexOf(LIB_END);
  if (a < 0 || b < a) throw new Error('corruption: the sdf-solids library markers are missing from pack.wgsl');
  return pack.slice(a, b);
}
export function buildModule(pack, page) {
  return page + '\n// ── library: pages/sdf-solids-table/shaders/pack.wgsl ──\n' + sliceLibrary(pack);
}

export async function createRenderer(device, { code, format }) {
  device.pushErrorScope('validation');
  const module = device.createShaderModule({ code });
  if (module.getCompilationInfo) {
    const info = await module.getCompilationInfo();
    const errs = info.messages.filter(m => m.type === 'error');
    if (errs.length) throw new Error('WGSL: ' + errs.map(m => `${m.lineNum}:${m.linePos} ${m.message}`).join('\n'));
  }
  const uBuf = device.createBuffer({ size: UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const sBuf = device.createBuffer({ size: MAX_SAMPLES * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const pickBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const pickRead = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });

  const poly = polyhedra();
  const polyBuf = device.createBuffer({ size: poly.data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(polyBuf, 0, poly.data);

  const vtx = [{ arrayStride: 24, attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },
    { shaderLocation: 1, offset: 12, format: 'float32x3' }] }];
  const depthW = { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' };
  const hdrT = [{ format: HDR_FORMAT }];
  const P = {
    scene: device.createRenderPipeline({ layout: 'auto',
      vertex: { module, entryPoint: 'vs_full' },
      fragment: { module, entryPoint: 'fs_scene', targets: hdrT },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'always' } }),
    mesh: device.createRenderPipeline({ layout: 'auto',
      vertex: { module, entryPoint: 'vs_mesh', buffers: vtx },
      fragment: { module, entryPoint: 'fs_mesh', targets: hdrT },
      primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: depthW }),
    part: device.createRenderPipeline({ layout: 'auto',
      vertex: { module, entryPoint: 'vs_part', buffers: vtx },
      fragment: { module, entryPoint: 'fs_part', targets: hdrT },
      primitive: { topology: 'triangle-list', cullMode: 'back' }, depthStencil: depthW }),
    glyph: device.createRenderPipeline({ layout: 'auto',
      vertex: { module, entryPoint: 'vs_glyph' },
      fragment: { module, entryPoint: 'fs_glyph', targets: [{ format: HDR_FORMAT,
        blend: { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
                 alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } } }] },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'less' } }),
    post: device.createRenderPipeline({ layout: 'auto',
      vertex: { module, entryPoint: 'vs_full' },
      fragment: { module, entryPoint: 'fs_post', targets: [{ format }] } }),
    sample: device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'cs_sample' } }),
    pick: device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'cs_pick' } }),
  };
  const err = await device.popErrorScope();
  if (err) throw new Error('WebGPU: ' + err.message);

  const bg = (pipe, entries) => device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries });
  const U0 = { binding: 0, resource: { buffer: uBuf } };
  const S1 = { binding: 1, resource: { buffer: sBuf } };
  const G = {
    scene: bg(P.scene, [U0]),
    mesh: bg(P.mesh, [U0]),
    part: bg(P.part, [U0, S1]),
    glyph: bg(P.glyph, [U0, S1]),
    sample: bg(P.sample, [U0, { binding: 2, resource: { buffer: sBuf } }]),
    pick: bg(P.pick, [U0, { binding: 5, resource: { buffer: pickBuf } }]),
    post: null,
  };
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });

  const st = { w: 0, h: 0, hdr: null, depth: null, mesh: null, samples: 0, needSample: false, busyPick: false };

  function resize(w, h) {
    w = Math.max(1, Math.floor(w)); h = Math.max(1, Math.floor(h));
    if (w === st.w && h === st.h) return;
    if (st.hdr) st.hdr.destroy();
    if (st.depth) st.depth.destroy();
    st.w = w; st.h = h;
    st.hdr = device.createTexture({ size: [w, h], format: HDR_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    st.depth = device.createTexture({ size: [w, h], format: DEPTH_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    G.post = bg(P.post, [U0, { binding: 3, resource: st.hdr.createView() }, { binding: 4, resource: sampler }]);
  }

  // mesh: { positions, normals, indices } or null for an SDF model
  function setMesh(mesh) {
    if (st.mesh) { st.mesh.vb.destroy(); st.mesh.ib.destroy(); st.mesh = null; }
    if (!mesh) return;
    const n = mesh.positions.length / 3, inter = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      inter[i * 6] = mesh.positions[i * 3]; inter[i * 6 + 1] = mesh.positions[i * 3 + 1]; inter[i * 6 + 2] = mesh.positions[i * 3 + 2];
      inter[i * 6 + 3] = mesh.normals[i * 3]; inter[i * 6 + 4] = mesh.normals[i * 3 + 1]; inter[i * 6 + 5] = mesh.normals[i * 3 + 2];
    }
    const vb = device.createBuffer({ size: inter.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(vb, 0, inter);
    const idx = mesh.indices instanceof Uint32Array ? mesh.indices : new Uint32Array(mesh.indices);
    const padded = idx.length % 2 ? new Uint32Array([...idx, 0]) : idx;
    const ib = device.createBuffer({ size: padded.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(ib, 0, padded);
    st.mesh = { vb, ib, count: idx.length };
  }
  // CPU samples (mesh models): Float32Array n x 8
  function setSamples(arr) {
    const n = Math.min(MAX_SAMPLES, arr.length / 8);
    device.queue.writeBuffer(sBuf, 0, arr, 0, n * 8);
    st.samples = n; st.needSample = false;
  }
  // GPU samples (SDF models): cs_sample runs at the next frame
  function requestSdfSamples(n = MAX_SAMPLES) { st.samples = Math.min(n, MAX_SAMPLES); st.needSample = true; }

  // U: the packed Float32Array (params.js packUniforms); its k.w must be
  // st.samples. out: a GPUTextureView in the format given at creation.
  function frame(U, out) {
    U[UNIFORM_OFFSET.k + 3] = st.samples;
    device.queue.writeBuffer(uBuf, 0, U);
    const enc = device.createCommandEncoder();
    if (st.needSample) {
      const c = enc.beginComputePass();
      c.setPipeline(P.sample); c.setBindGroup(0, G.sample);
      c.dispatchWorkgroups(Math.ceil(st.samples / 64));
      c.end();
      st.needSample = false;
    }
    const rp = enc.beginRenderPass({
      colorAttachments: [{ view: st.hdr.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      depthStencilAttachment: { view: st.depth.createView(), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 },
    });
    rp.setPipeline(P.scene); rp.setBindGroup(0, G.scene); rp.draw(3);
    if (st.mesh) {
      rp.setPipeline(P.mesh); rp.setBindGroup(0, G.mesh);
      rp.setVertexBuffer(0, st.mesh.vb); rp.setIndexBuffer(st.mesh.ib, 'uint32');
      rp.drawIndexed(st.mesh.count);
    }
    const parts = Math.round(U[UNIFORM_OFFSET.part]);
    if (parts > 0) {
      const q = Math.ceil(parts / poly.ranges.length);
      rp.setPipeline(P.part); rp.setBindGroup(0, G.part); rp.setVertexBuffer(0, polyBuf);
      poly.ranges.forEach((r, s) => rp.draw(r.count, q, r.first, s * q));
    }
    const glyphs = Math.round(U[UNIFORM_OFFSET.part + 1]);
    if (glyphs > 0) { rp.setPipeline(P.glyph); rp.setBindGroup(0, G.glyph); rp.draw(6, glyphs); }
    rp.end();
    const pp = enc.beginRenderPass({ colorAttachments: [{ view: out, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    pp.setPipeline(P.post); pp.setBindGroup(0, G.post); pp.draw(3);
    pp.end();
    device.queue.submit([enc.finish()]);
  }

  // one ray against the SDF scene; U carries pick and pickD. -> [x, y, z, t]
  // with t < 0 for a miss, or null when a pick is still running
  async function pick(U) {
    if (st.busyPick) return null;
    st.busyPick = true;
    try {
      U[UNIFORM_OFFSET.k + 3] = st.samples;
      device.queue.writeBuffer(uBuf, 0, U);
      const enc = device.createCommandEncoder();
      const c = enc.beginComputePass();
      c.setPipeline(P.pick); c.setBindGroup(0, G.pick); c.dispatchWorkgroups(1); c.end();
      enc.copyBufferToBuffer(pickBuf, 0, pickRead, 0, 16);
      device.queue.submit([enc.finish()]);
      await pickRead.mapAsync(GPUMapMode.READ);
      const r = Array.from(new Float32Array(pickRead.getMappedRange().slice(0)));
      pickRead.unmap();
      return r;
    } finally { st.busyPick = false; }
  }

  return { device, resize, setMesh, setSamples, requestSdfSamples, frame, pick, st, poly };
}
