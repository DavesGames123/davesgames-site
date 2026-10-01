// tris.js -- the triangle-fill pass: flat-shaded faces in one instanced draw.
//
// Port of origami src/tris.rs. A face fills as a fan of triangles, one instance
// each. The corners are projected to pixels on the CPU, so this pass uploads
// them and draws. It runs before the line pass, so creases draw over the fills.
//
// grep map:
//   FLOATS    -- one instance: three pixel corners and a linear RGBA colour
//   tri       -- push one triangle onto a pane's float list
//   TriPass   -- pipeline, screen uniform, growing instance buffer

// p0, p1, p2 (6 floats) and colour (4 floats): 40 bytes per instance.
const FLOATS = 10;

// Push one triangle, corners in physical pixels.
export function tri(out, p0, p1, p2, c) {
  out.push(p0[0], p0[1], p1[0], p1[1], p2[0], p2[1], c[0], c[1], c[2], c[3]);
}

export class TriPass {
  static FLOATS = FLOATS;

  constructor(device, format, code) {
    this.device = device;
    const module = device.createShaderModule({ label: 'tris', code });
    this.screen = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const layout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} }],
    });
    this.bind = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: this.screen } }] });
    this.pipeline = device.createRenderPipeline({
      label: 'tris-pipeline',
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: {
        module, entryPoint: 'vs',
        buffers: [{
          arrayStride: FLOATS * 4, stepMode: 'instance',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },
            { shaderLocation: 1, offset: 8, format: 'float32x2' },
            { shaderLocation: 2, offset: 16, format: 'float32x2' },
            { shaderLocation: 3, offset: 24, format: 'float32x4' },
          ],
        }],
      },
      fragment: {
        module, entryPoint: 'fs',
        targets: [{
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      multisample: { count: 4 },
    });
    this.cap = 0;
    this.inst = null;
  }

  // Upload every pane's list once. Returns the first instance of each pane.
  upload(lists, w, h, encode) {
    let n = 0;
    for (const l of lists) n += l.length;
    const offsets = [];
    if (n === 0) return lists.map(() => 0);
    if (n > this.cap) {
      if (this.inst) this.inst.destroy();
      this.cap = Math.max(n, this.cap * 2, 4096);
      this.inst = this.device.createBuffer({ size: this.cap * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    }
    const data = new Float32Array(n);
    let at = 0;
    for (const l of lists) { offsets.push(at / FLOATS); data.set(l, at); at += l.length; }
    this.device.queue.writeBuffer(this.screen, 0, new Float32Array([w, h, encode, 0]));
    this.device.queue.writeBuffer(this.inst, 0, data);
    return offsets;
  }

  // Draw an uploaded instance range.
  draw(pass, first, count) {
    if (!count) return;
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bind);
    pass.setVertexBuffer(0, this.inst);
    pass.draw(3, count, 0, first);
  }
}
