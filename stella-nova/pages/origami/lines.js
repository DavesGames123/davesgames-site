// lines.js -- the line pass: anti-aliased segments in one instanced draw.
//
// Port of origami src/lines.rs. Every crease and every folded edge is a segment
// in physical pixels. The shader expands each one into a quad of its width with
// one pixel of coverage on the long edges.
//
// grep map:
//   FLOATS    -- one instance: two pixel ends, a linear RGBA colour, a width
//   seg       -- push one segment onto a pane's float list
//   LinePass  -- pipeline, screen uniform, growing instance buffer

// a, b (4 floats), colour (4), width (1), padding (3): 48 bytes per instance.
const FLOATS = 12;

// Push one segment, in physical pixels.
export function seg(out, a, b, width, c) {
  out.push(a[0], a[1], b[0], b[1], c[0], c[1], c[2], c[3], width, 0, 0, 0);
}

export class LinePass {
  static FLOATS = FLOATS;

  constructor(device, format, code) {
    this.device = device;
    const module = device.createShaderModule({ label: 'lines', code });
    this.screen = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const layout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} }],
    });
    this.bind = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: this.screen } }] });
    this.pipeline = device.createRenderPipeline({
      label: 'lines-pipeline',
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: {
        module, entryPoint: 'vs',
        buffers: [{
          arrayStride: FLOATS * 4, stepMode: 'instance',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },
            { shaderLocation: 1, offset: 8, format: 'float32x2' },
            { shaderLocation: 2, offset: 16, format: 'float32x4' },
            { shaderLocation: 3, offset: 32, format: 'float32' },
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

  // Draw an uploaded instance range: six vertices per segment.
  draw(pass, first, count) {
    if (!count) return;
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bind);
    pass.setVertexBuffer(0, this.inst);
    pass.draw(6, count, 0, first);
  }
}
