// ============================================================================
//  POST-PROCESS TABLE  ·  page.js — the per-page PAGE object
// ────────────────────────────────────────────────────────────────────────────
//  30 image operators applied to a shared source you pick, upload or drop; a fragment shader per cell reads the source texture.
//  The shared table-engine drives this object through its ctx. main.js fetches
//  the data and calls bootTable(PAGE, data); the engine calls PAGE.init and
//  PAGE.draw from there. The noise pack arrives as ctx.noisePack. The sample photos arrive as ctx.photos.
// ============================================================================
const NOISE_SOURCES = ["fbm", "warp", "worley_edge", "marble", "plasma", "caustics", "voronoi_id", "truchet", "ridged", "gyroid", "stars", "cracks"];
// ---------------------------------------------------------- synthetic test images (2D canvas)
const SRC2D = {
  color_bars(c, W) { const cols = ['#c0c0c0','#c0c000','#00c0c0','#00c000','#c000c0','#c00000','#0000c0']; cols.forEach((k, i) => { c.fillStyle = k; c.fillRect(i * W / 7, 0, W / 7 + 1, W * 0.67); });
    const low = ['#0000c0','#131313','#c000c0','#131313','#00c0c0','#131313','#c0c0c0']; low.forEach((k, i) => { c.fillStyle = k; c.fillRect(i * W / 7, W * 0.67, W / 7 + 1, W * 0.08); });
    const plg = ['#00214c','#ffffff','#32006a','#131313']; plg.forEach((k, i) => { c.fillStyle = k; c.fillRect(i * W / 4, W * 0.75, W / 4 + 1, W * 0.25); });
    for (let i = 0; i < 4; i++) { c.fillStyle = `rgb(${8 + i * 10},${8 + i * 10},${8 + i * 10})`; c.fillRect(W * 0.75 + i * W / 16, W * 0.75, W / 16 + 1, W * 0.25); } },
  macbeth(c, W) { const P = ['#735244','#c29682','#627a9d','#576c43','#8580b1','#67bdaa','#d67e2c','#505ba6','#c15a63','#5e3c6c','#9dbc40','#e0a32e','#383d96','#469449','#af363c','#e7c71f','#bb5695','#0885a1','#f3f3f2','#c8c8c8','#a0a0a0','#7a7a7a','#555555','#343434'];
    c.fillStyle = '#111'; c.fillRect(0, 0, W, W); const g = W / 6, m = g * 0.08; P.forEach((k, i) => { c.fillStyle = k; c.fillRect((i % 6) * g + m, Math.floor(i / 6) * g * 1.5 + m + g * 0.0, g - 2 * m, g * 1.5 - 2 * m); }); },
  zone_plate(c, W) { const im = c.createImageData(W, W); for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const dx = x - W / 2, dy = y - W / 2; const v = 0.5 + 0.5 * Math.cos((dx * dx + dy * dy) * 0.0012); const i = (y * W + x) * 4; im.data[i] = im.data[i + 1] = im.data[i + 2] = v * 255; im.data[i + 3] = 255; } c.putImageData(im, 0, 0); },
  siemens(c, W) { c.fillStyle = '#f0f0f0'; c.fillRect(0, 0, W, W); c.fillStyle = '#101010'; const n = 36; for (let i = 0; i < n; i++) { c.beginPath(); c.moveTo(W / 2, W / 2); c.arc(W / 2, W / 2, W * 0.7, i * 2 * Math.PI / n, (i + 0.5) * 2 * Math.PI / n); c.closePath(); c.fill(); } c.fillStyle = '#f0f0f0'; c.beginPath(); c.arc(W / 2, W / 2, W * 0.03, 0, 7); c.fill(); },
};
export const PAGE = {
  async init(ctx) {
    const NOISE_PACK = ctx.noisePack; const PHOTOS = ctx.photos;
    const { device, format, tiles, PACK, $ } = ctx; this.ctx = ctx;
    this.tex = device.createTexture({ size: [512, 512], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    this.smp = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'mirror-repeat', addressModeV: 'mirror-repeat' });
    this.bgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} }, { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} }] });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [this.bgl] });
    const module = device.createShaderModule({ code: PACK });
    module.getCompilationInfo().then(info => { const errs = info.messages.filter(m => m.type === 'error'); if (errs.length) for (const t of tiles) ctx.setStatus(t, errs[0].message.slice(0, 120), true); });
    for (const t of tiles) device.createRenderPipelineAsync({ layout, vertex: { module, entryPoint: 'vs_main' }, fragment: { module, entryPoint: 'fs_' + t.s.name, targets: [{ format }] }, primitive: { topology: 'triangle-list' } })
      .then(p => { t.pipeline = p; t.dirty = true; }).catch(e => ctx.setStatus(t, String(e.message || e).slice(0, 120), true));
    // noise sources: pipelines from the noise pack, rendered straight into the source texture
    const nbgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
    const nmod = device.createShaderModule({ code: NOISE_PACK }); const nlayout = device.createPipelineLayout({ bindGroupLayouts: [nbgl] });
    this.nbuf = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.nbind = device.createBindGroup({ layout: nbgl, entries: [{ binding: 0, resource: { buffer: this.nbuf } }] });
    this.npipes = {};
    for (const n of NOISE_SOURCES) this.npipes[n] = device.createRenderPipeline({ layout: nlayout, vertex: { module: nmod, entryPoint: 'vs_main' }, fragment: { module: nmod, entryPoint: 'fs_' + n, targets: [{ format: 'rgba8unorm' }] }, primitive: { topology: 'triangle-list' } });
    // thumbnails
    const thumbs = $('thumbs'); this.work = document.createElement('canvas'); this.work.width = this.work.height = 512; this.wctx = this.work.getContext('2d');
    const add = (id, kind, draw) => { const b = document.createElement('button'); b.type = 'button'; b.title = id.replace(/_/g, ' '); const cv = document.createElement('canvas'); b.appendChild(cv); thumbs.appendChild(b);
      b.addEventListener('click', () => this.select(id, kind, b)); return { b, cv }; };
    this.photos = {};
    for (const [id, uri] of Object.entries(PHOTOS)) { const { cv, b } = add(id, 'photo'); cv.width = cv.height = 96; const img = new Image(); img.onload = () => { cv.getContext('2d').drawImage(img, 0, 0, 96, 96); }; img.src = uri; this.photos[id] = img; }
    for (const [id, draw] of Object.entries(SRC2D)) { const { cv } = add(id, '2d'); cv.width = cv.height = 96; draw(cv.getContext('2d'), 96); }
    for (const n of NOISE_SOURCES) { const { cv } = add(n, 'noise'); cv.width = cv.height = 96; const c2 = cv.getContext('webgpu'); c2.configure({ device, format: 'rgba8unorm', alphaMode: 'opaque' }); this.renderNoise(n, c2.getCurrentTexture().createView(), 96); }
    const up = add('upload', 'upload'); up.cv.width = up.cv.height = 96; const uc = up.cv.getContext('2d'); uc.fillStyle = '#1c2436'; uc.fillRect(0, 0, 96, 96); uc.fillStyle = '#96c8ff'; uc.font = '40px sans-serif'; uc.fillText('+', 34, 62); this.upBtn = up;
    up.b.addEventListener('click', () => $('upload').click());
    $('upload').addEventListener('change', e => { const f = e.target.files[0]; if (f) this.loadImage(f); });
    const side = $('side'); side.addEventListener('dragover', e => { e.preventDefault(); }); side.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && f.type.startsWith('image/')) this.loadImage(f); });
    this.select('astronaut', 'photo', thumbs.children[0]);
  },
  renderNoise(n, view, size) {
    const { device, G } = this.ctx; const d = new Float32Array(24);
    d[0] = size; d[1] = size; d[2] = 3.0; d[3] = 1; d.set([0.02, 0.02, 0.03, 1], 4); d.set([0.35, 0.55, 0.75, 1], 8); d.set([0.91, 0.93, 0.96, 1], 12); d[16] = 1; d[17] = 1; d.set([0.5, 0.5, 0.5, 0.5], 20);
    device.queue.writeBuffer(this.nbuf, 0, d);
    const enc = device.createCommandEncoder(); const pass = enc.beginRenderPass({ colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(this.npipes[n]); pass.setBindGroup(0, this.nbind); pass.draw(3); pass.end(); device.queue.submit([enc.finish()]);
  },
  copyWork() { this.ctx.device.queue.copyExternalImageToTexture({ source: this.work }, { texture: this.tex }, [512, 512]); },
  // A source click records only the latest pending write. tick() applies one write
  // per frame, before the grid draws, so rapid switching can neither stack GPU work
  // nor let a cell read the source texture while that texture is being written.
  tick() { if (!this.pending) return; const apply = this.pending; this.pending = null; apply(); return true; },
  select(id, kind, btn) {
    this.ctx.$('thumbs').querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
    if (kind === 'photo') { const img = this.photos[id]; const put = () => { this.wctx.drawImage(img, 0, 0, 512, 512); this.pending = () => this.copyWork(); }; if (img.complete && img.naturalWidth) put(); else img.addEventListener('load', put, { once: true }); }
    else if (kind === '2d') { SRC2D[id](this.wctx, 512); this.pending = () => this.copyWork(); }
    else if (kind === 'noise') this.pending = () => this.renderNoise(id, this.tex.createView(), 512);
  },
  loadImage(file) {
    const img = new Image(); img.onload = () => { const s = Math.max(512 / img.width, 512 / img.height); const w = img.width * s, h = img.height * s;
      this.wctx.fillStyle = '#000'; this.wctx.fillRect(0, 0, 512, 512); this.wctx.drawImage(img, (512 - w) / 2, (512 - h) / 2, w, h);
      this.pending = () => this.copyWork();
      const uc = this.upBtn.cv.getContext('2d'); uc.drawImage(this.work, 0, 0, 96, 96);
      this.ctx.$('thumbs').querySelectorAll('button').forEach(b => b.classList.toggle('active', b === this.upBtn.b));
      URL.revokeObjectURL(img.src); };
    img.src = URL.createObjectURL(file);
  },
  bind(surf) { if (!surf.page.bind) surf.page.bind = this.ctx.device.createBindGroup({ layout: this.bgl, entries: [{ binding: 0, resource: { buffer: surf.buf } }, { binding: 1, resource: this.tex.createView() }, { binding: 2, resource: this.smp }] }); return surf.page.bind; },
  draw(enc, t, surf, rect, dpr, dt, now, moving) {
    const { device, G } = this.ctx; const d = surf.data;
    d[0] = rect.width; d[1] = rect.height; d[2] = t.phase; d[3] = dpr;
    d.set([G.ink[0], G.ink[1], G.ink[2], 1], 4); d.set([G.tone[0], G.tone[1], G.tone[2], 1], 8); d.set([G.cream[0], G.cream[1], G.cream[2], 1], 12);
    d[16] = G.amount; d[17] = G.zoom; d[18] = 0; d[19] = 0; d.set(t.knobs, 20);
    device.queue.writeBuffer(surf.buf, 0, d);
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: surf.ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(t.pipeline); pass.setBindGroup(0, this.bind(surf)); pass.draw(3); pass.end();
  },
};


