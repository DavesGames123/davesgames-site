// gpu.js - small WebGPU runner for the CT engine kernels in wgsl.js.
// One call = upload, dispatch, read back. Buffers are temporary; pipelines are cached.
// The GPU back-projector is pixel driven (FBP style), not the exact adjoint of forward2D.
//
// grep handles: createGpuCT, forward2D, backProject2D, backProjectCone, destroy

import { FORWARD_2D, BACKPROJECT_2D, BACKPROJECT_CONE } from './wgsl.js';
import { angleWeights } from './geometry.js';

const KIND = (g) => (g.type === 'parallel' ? 0 : g.detector === 'arc' ? 2 : 1);

export function createGpuCT(device) {
  const GBU = globalThis.GPUBufferUsage;
  const pipes = {};
  const live = new Set();
  const pipe = (key, code) => pipes[key] ?? (pipes[key] = device.createComputePipeline({
    layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'main' },
  }));
  const buf = (data, usage) => {
    const b = device.createBuffer({ size: Math.max(16, Math.ceil(data.byteLength / 4) * 4), usage: usage | GBU.COPY_DST });
    device.queue.writeBuffer(b, 0, data);
    live.add(b); return b;
  };
  const out = (bytes) => { const b = device.createBuffer({ size: Math.max(16, bytes), usage: GBU.STORAGE | GBU.COPY_SRC }); live.add(b); return b; };
  const params = (vals) => {
    const ab = new ArrayBuffer(48), u = new Uint32Array(ab), f = new Float32Array(ab);
    vals.forEach((v, i) => { if (v.f !== undefined) f[i] = v.f; else u[i] = v; });
    return buf(new Uint8Array(ab), GBU.UNIFORM);
  };
  async function run(p, entries, groups, outBuf, bytes) {
    const bg = device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: entries.map((b, i) => ({ binding: i, resource: { buffer: b } })) });
    const rb = device.createBuffer({ size: Math.max(16, bytes), usage: GBU.MAP_READ | GBU.COPY_DST });
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(p); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(...groups); pass.end();
    enc.copyBufferToBuffer(outBuf, 0, rb, 0, Math.max(16, bytes));
    device.queue.submit([enc.finish()]);
    await rb.mapAsync(globalThis.GPUMapMode.READ);
    const res = new Float32Array(rb.getMappedRange().slice(0, bytes));
    rb.unmap(); rb.destroy();
    for (const b of entries) { b.destroy(); live.delete(b); }
    return res;
  }
  return {
    async forward2D(image, geom) {
      const px = image.width / image.nx, n = geom.nAngles * geom.nDet;
      const P = params([image.nx, image.ny, geom.nDet, geom.nAngles, { f: px }, { f: geom.du }, { f: geom.offset ?? 0 },
        { f: geom.sod ?? 0 }, { f: geom.sdd ?? 0 }, KIND(geom), 0, 0]);
      const o = out(n * 4);
      const data = await run(pipe('f2', FORWARD_2D), [P, buf(image.data, GBU.STORAGE), buf(Float32Array.from(geom.angles), GBU.STORAGE), o],
        [Math.ceil(geom.nDet / 64), geom.nAngles, 1], o, n * 4);
      return { nAngles: geom.nAngles, nDet: geom.nDet, data };
    },
    // opts.fbp: distance weights and angle quadrature (input must be filterSinogram output).
    async backProject2D(sino, geom, dims, o = {}) {
      const nx = dims.nx, ny = dims.ny ?? nx, width = dims.width ?? 2, px = width / nx;
      let w;
      if (o.weights) w = Float32Array.from(o.weights);
      else if (o.fbp) {
        w = angleWeights(geom);
        if (geom.type === 'parallel') { let s = 0; for (const v of w) s += v; if (s > 1.5 * Math.PI) for (let k = 0; k < w.length; k++) w[k] *= 0.5; }
      } else w = new Float32Array(geom.nAngles).fill(1);
      const P = params([nx, ny, geom.nDet, geom.nAngles, { f: px }, { f: geom.du }, { f: geom.offset ?? 0 },
        { f: geom.sod ?? 0 }, { f: geom.sdd ?? 0 }, KIND(geom), o.fbp ? 1 : 0, 0]);
      const ob = out(nx * ny * 4);
      const data = await run(pipe('b2', BACKPROJECT_2D), [P, buf(sino.data, GBU.STORAGE), buf(Float32Array.from(geom.angles), GBU.STORAGE), buf(w, GBU.STORAGE), ob],
        [Math.ceil(nx / 8), Math.ceil(ny / 8), 1], ob, nx * ny * 4);
      return { nx, ny, width, data };
    },
    // proj must be pre-weighted and filtered (FDK). Use fdkFilter from recon.js, or pass raw for a plain back-projection.
    async backProjectCone(proj, geom, dims, o = {}) {
      const nx = dims.nx, ny = dims.ny ?? nx, nz = dims.nz ?? nx, width = dims.width ?? 2, px = width / nx;
      const w = o.weights ? Float32Array.from(o.weights) : angleWeights(geom);
      const P = params([nx, ny, nz, geom.nAngles, geom.nu, geom.nv, { f: px }, { f: geom.du }, { f: geom.dv },
        { f: geom.sod }, { f: geom.sdd }, 0]);
      const ob = out(nx * ny * nz * 4);
      const data = await run(pipe('bc', BACKPROJECT_CONE), [P, buf(proj.data, GBU.STORAGE), buf(Float32Array.from(geom.angles), GBU.STORAGE), buf(w, GBU.STORAGE), ob],
        [Math.ceil(nx / 8), Math.ceil(ny / 8), nz], ob, nx * ny * nz * 4);
      return { nx, ny, nz, width, data };
    },
    destroy() { for (const b of live) b.destroy(); live.clear(); for (const k in pipes) delete pipes[k]; },
  };
}
