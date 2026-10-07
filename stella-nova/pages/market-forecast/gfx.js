// ============================================================================
//  GFX  ·  market-forecast/gfx.js — WebGPU primitives for the charts
// ----------------------------------------------------------------------------
//  Every chart on the page is a "scene" that, once per frame, fills a Prims
//  list with triangles in device pixels, and draws its text on a 2D
//  overlay canvas. gfx.js draws the Prims with WebGPU (shaders/prim.wgsl).
//  When the browser has no WebGPU, or the device fails, it draws the same
//  Prims with Canvas2D: one fill per triangle, the mean colour of its
//  vertices, no glow layer. The output is plainer but complete.
//
//  Layers, drawn in this order: 0 back (alpha), 1 glow (additive),
//  2 front (alpha).
//
//  API
//    const gpu = await initGpu()             one shared device, or null
//    const v = createView(canvas, overlay, gpu)
//    v.render(scene, t)   scene.build(P, W, H, t) and scene.overlay(ctx, w, h, t)
//    v.resize()           match the backing stores to the CSS size and dpr
//    v.backend            'webgpu' or 'canvas2d'
//    Prims: P.rect(x0,y0,x1,y1,c,layer?), P.quad(a,b,c,d,colors,layer?),
//           P.line(pts,width,c,{layer,soft,reveal,glow}),
//           P.band(xs,lo,hi,cTop,cBot,{reveal,alphaOf}), P.tri(...)
//    Colours are [r,g,b,a] in 0..1, straight alpha.
//
//  grep -n targets
//    device ............... "export async function initGpu"
//    vertex layout ........ "const STRIDE"
//    line strip ........... "line(pts"
//    canvas2d fallback .... "function draw2d"
// ============================================================================
const STRIDE = 10;   // floats per vertex: p.xy, e.xyzw, c.rgba

export class Prims {
  constructor() { this.layers = [new Float32Array(1 << 16), new Float32Array(1 << 14), new Float32Array(1 << 15)]; this.n = [0, 0, 0]; }
  clear() { this.n = [0, 0, 0]; }
  _v(L, x, y, e0, e1, e2, e3, c) {
    let a = this.layers[L];
    if (this.n[L] + STRIDE > a.length) { const b = new Float32Array(a.length * 2); b.set(a); this.layers[L] = a = b; }
    const o = this.n[L];
    a[o] = x; a[o + 1] = y; a[o + 2] = e0; a[o + 3] = e1; a[o + 4] = e2; a[o + 5] = e3;
    a[o + 6] = c[0]; a[o + 7] = c[1]; a[o + 8] = c[2]; a[o + 9] = c[3];
    this.n[L] = o + STRIDE;
  }
  tri(L, p, c, e = [0, 0, 0, 0]) { for (let i = 0; i < 3; i++) this._v(L, p[i][0], p[i][1], e[0], e[1], e[2], e[3], c[i] || c[0]); }
  // quad a b c d in order around the edge; colors one or four
  quad(a, b, c, d, cols, L = 0, ea = null) {
    const C = cols.length === 4 && Array.isArray(cols[0]) ? cols : [cols, cols, cols, cols];
    const E = ea || [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    const P = [a, b, c, d];
    for (const i of [0, 1, 2, 0, 2, 3]) this._v(L, P[i][0], P[i][1], E[i][0], E[i][1], E[i][2], E[i][3], C[i]);
  }
  rect(x0, y0, x1, y1, c, L = 0) { this.quad([x0, y0], [x1, y0], [x1, y1], [x0, y1], c, L); }
  // A polyline as one strip with miter joins. width in device px.
  // opts.soft: edge softness 0..1 (0.35 is a crisp anti-aliased edge,
  // 1 a full glow), opts.reveal: masked by the reveal front, opts.front:
  // the light at the front, opts.colors: one colour per point.
  line(pts, width, c, o = {}) {
    const L = o.layer ?? 2, n = pts.length; if (n < 2) return;
    const h = width / 2 + 1, soft = o.soft ?? Math.min(1, 1.6 / (width / 2 + 1)), rv = o.reveal ? 1 : 0, fr = o.front ?? 0;
    const nx = new Float32Array(n), ny = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = pts[Math.max(0, i - 1)], q = pts[Math.min(n - 1, i + 1)];
      let dx = q[0] - p[0], dy = q[1] - p[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      let mx = -dy, my = dx;
      if (i > 0 && i < n - 1) {
        // miter: the mean of the two segment normals, scaled, capped at 3
        const a = pts[i - 1], b = pts[i], d = pts[i + 1];
        let ux = b[0] - a[0], uy = b[1] - a[1], vx = d[0] - b[0], vy = d[1] - b[1];
        const lu = Math.hypot(ux, uy) || 1, lv = Math.hypot(vx, vy) || 1; ux /= lu; uy /= lu; vx /= lv; vy /= lv;
        let ax = -uy - vy, ay = ux + vx; const la = Math.hypot(ax, ay);
        if (la > 1e-6) { ax /= la; ay /= la; const k = Math.min(3, 1 / Math.max(0.2, ax * -uy + ay * ux)); mx = ax * k; my = ay * k; }
      }
      nx[i] = mx; ny[i] = my;
    }
    for (let i = 0; i < n - 1; i++) {
      const a = pts[i], b = pts[i + 1], ca = o.colors ? o.colors[i] : c, cb = o.colors ? o.colors[i + 1] : c;
      this.quad([a[0] + nx[i] * h, a[1] + ny[i] * h], [b[0] + nx[i + 1] * h, b[1] + ny[i + 1] * h],
        [b[0] - nx[i + 1] * h, b[1] - ny[i + 1] * h], [a[0] - nx[i] * h, a[1] - ny[i] * h],
        [ca, cb, cb, ca], L, [[rv, 1, soft, fr], [rv, 1, soft, fr], [rv, -1, soft, fr], [rv, -1, soft, fr]]);
    }
  }
  // A filled band between two curves at xs. colours per point via alphaOf(i).
  band(xs, lo, hi, cHi, cLo, o = {}) {
    const L = o.layer ?? 0, rv = o.reveal ? 1 : 0, fr = o.front ?? 0, E = [rv, 0, 0.001, fr];
    for (let i = 0; i < xs.length - 1; i++) {
      const k0 = o.alphaOf ? o.alphaOf(i) : 1, k1 = o.alphaOf ? o.alphaOf(i + 1) : 1;
      const t0 = [cHi[0], cHi[1], cHi[2], cHi[3] * k0], t1 = [cHi[0], cHi[1], cHi[2], cHi[3] * k1];
      const b0 = [cLo[0], cLo[1], cLo[2], cLo[3] * k0], b1 = [cLo[0], cLo[1], cLo[2], cLo[3] * k1];
      this.quad([xs[i], hi[i]], [xs[i + 1], hi[i + 1]], [xs[i + 1], lo[i + 1]], [xs[i], lo[i]], [t0, t1, b1, b0], L, [E, E, E, E]);
    }
  }
}

let gpuP = null;
export function initGpu() {
  if (gpuP) return gpuP;
  gpuP = (async () => {
    if (!navigator.gpu || new URLSearchParams(location.search).get('gfx') === '2d') return null;
    try {
      const ad = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!ad) return null;
      const device = await ad.requestDevice();
      const code = await (await fetch(new URL('./shaders/prim.wgsl', import.meta.url))).text();
      const mod = device.createShaderModule({ code });
      const info = await mod.getCompilationInfo();
      const errs = info.messages.filter(m => m.type === 'error');
      if (errs.length) throw new Error('prim.wgsl: ' + errs.map(m => m.lineNum + ':' + m.message).join('; '));
      const format = navigator.gpu.getPreferredCanvasFormat();
      const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
      const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] });
      const mk = blend => device.createRenderPipeline({
        layout: pl,
        vertex: { module: mod, entryPoint: 'vs', buffers: [{ arrayStride: STRIDE * 4, attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x2' }, { shaderLocation: 1, offset: 8, format: 'float32x4' }, { shaderLocation: 2, offset: 24, format: 'float32x4' }] }] },
        fragment: { module: mod, entryPoint: 'fs', targets: [{ format, blend }] },
        primitive: { topology: 'triangle-list' },
      });
      const alpha = mk({ color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } });
      const add = mk({ color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } });
      let lost = false;
      device.lost.then(() => { lost = true; });
      return { device, format, layout, alpha, add, get lost() { return lost; } };
    } catch (e) {
      console.warn('market-forecast: WebGPU unavailable, using Canvas2D charts:', e && e.message);
      return null;
    }
  })();
  return gpuP;
}

export function createView(canvas, overlay, gpu) {
  const P = new Prims();
  const octx = overlay.getContext('2d');
  let ctx = null, ubuf = null, bind = null, vbuf = null, vcap = 0, c2d = null;
  if (gpu) {
    ctx = canvas.getContext('webgpu');
    ctx.configure({ device: gpu.device, format: gpu.format, alphaMode: 'opaque' });
    ubuf = gpu.device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    bind = gpu.device.createBindGroup({ layout: gpu.layout, entries: [{ binding: 0, resource: { buffer: ubuf } }] });
  } else c2d = canvas.getContext('2d');
  const view = {
    backend: gpu ? 'webgpu' : 'canvas2d', dpr: 1, W: 0, H: 0, w: 0, h: 0, P, bg: [0.035, 0.043, 0.06, 1], reveal: [0, 0], prog: 1,
    resize() {
      const r = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
      if (W !== canvas.width || H !== canvas.height) { canvas.width = W; canvas.height = H; }
      if (overlay.width !== W || overlay.height !== H) { overlay.width = W; overlay.height = H; }
      Object.assign(view, { dpr, W, H, w: r.width, h: r.height });
    },
    render(scene, t) {
      if (!view.W) view.resize();
      P.clear();
      scene.build(P, view.W, view.H, t, view);
      if (gpu && !gpu.lost) drawGpu(t); else draw2d();
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, view.W, view.H);
      octx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
      if (scene.overlay) scene.overlay(octx, view.w, view.h, t, view);
    },
  };
  function drawGpu(t) {
    const d = gpu.device, total = P.n[0] + P.n[1] + P.n[2];
    if (total * 4 > vcap) { if (vbuf) vbuf.destroy(); vcap = Math.max(1 << 20, total * 8); vbuf = d.createBuffer({ size: vcap, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }); }
    let off = 0; const offs = [];
    for (let L = 0; L < 3; L++) { offs.push(off); if (P.n[L]) d.queue.writeBuffer(vbuf, off, P.layers[L], 0, P.n[L]); off += P.n[L] * 4; }
    d.queue.writeBuffer(ubuf, 0, new Float32Array([view.W, view.H, view.reveal[0], view.reveal[1], view.prog, t, 0, 0]));
    const enc = d.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store',
      clearValue: { r: view.bg[0], g: view.bg[1], b: view.bg[2], a: 1 } }] });
    pass.setBindGroup(0, bind);
    for (let L = 0; L < 3; L++) {
      if (!P.n[L]) continue;
      pass.setPipeline(L === 1 ? gpu.add : gpu.alpha);
      pass.setVertexBuffer(0, vbuf, offs[L], P.n[L] * 4);
      pass.draw(P.n[L] / STRIDE);
    }
    pass.end();
    d.queue.submit([enc.finish()]);
  }
  function draw2d() {
    const g = c2d, front = view.reveal[0] + (view.reveal[1] - view.reveal[0]) * view.prog;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = `rgb(${view.bg.slice(0, 3).map(v => Math.round(v * 255)).join(',')})`;
    g.fillRect(0, 0, view.W, view.H);
    for (const L of [0, 2]) {
      const a = P.layers[L], n = P.n[L];
      for (let o = 0; o < n; o += STRIDE * 3) {
        let r = 0, gg = 0, b = 0, al = 0, rv = 0, xm = 0, edge = 0;
        for (let k = 0; k < 3; k++) { const q = o + k * STRIDE; r += a[q + 6]; gg += a[q + 7]; b += a[q + 8]; al += a[q + 9]; rv += a[q + 2]; xm += a[q]; edge += a[q + 4] > 0.9 ? 1 : 0; }
        if (rv > 1.5 && xm / 3 > front) continue;
        al /= 3; if (edge === 3 && al < 0.2) continue;   // a soft halo; skip
        const ax = a[o], ay = a[o + 1], bx = a[o + STRIDE], by = a[o + STRIDE + 1], cx = a[o + 2 * STRIDE], cy = a[o + 2 * STRIDE + 1];
        if (Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2 > view.W * view.H * 0.2) {
          // a large wash (the background): a vertical gradient, not a mean colour
          let lo = o, hi = o;
          for (let k = 1; k < 3; k++) { const q = o + k * STRIDE; if (a[q + 1] < a[lo + 1]) lo = q; if (a[q + 1] > a[hi + 1]) hi = q; }
          const col = q => `rgba(${Math.round(a[q + 6] * 255)},${Math.round(a[q + 7] * 255)},${Math.round(a[q + 8] * 255)},${a[q + 9]})`;
          const gr = g.createLinearGradient(0, a[lo + 1], 0, a[hi + 1]); gr.addColorStop(0, col(lo)); gr.addColorStop(1, col(hi));
          g.fillStyle = gr; g.fillRect(0, a[lo + 1], view.W, a[hi + 1] - a[lo + 1]);
          continue;
        }
        g.fillStyle = `rgba(${Math.round(r / 3 * 255)},${Math.round(gg / 3 * 255)},${Math.round(b / 3 * 255)},${al.toFixed(3)})`;
        g.beginPath(); g.moveTo(a[o], a[o + 1]); g.lineTo(a[o + STRIDE], a[o + STRIDE + 1]); g.lineTo(a[o + 2 * STRIDE], a[o + 2 * STRIDE + 1]); g.closePath(); g.fill();
      }
    }
  }
  view.resize();
  return view;
}
