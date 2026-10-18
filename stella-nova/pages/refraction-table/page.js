
const NOISE_SOURCES = ["fbm", "warp", "marble", "voronoi_id", "plasma", "caustics", "checker", "hex", "stripes_wave", "sum_sines", "truchet", "stars"];
import { PHOTOS } from './photos.js';
// core/config.ts, verbatim
const DEFAULT_CONFIG = { blur: 3, saturation: 1.5, tint: '255, 255, 255', tintOpacity: 0.04, refractionStrength: 22, bezelWidth: 34, thickness: 24, ior: 1.5, chromaticAberration: 0.18, lightAngle: -35, edgeHighlight: 0.9, specularStrength: 0.26, fresnelPower: 2.2, elevation: 1, noiseOpacity: 0, noiseScale: 1, borderRadius: 28, appearance: 'auto' };
const MATERIAL_PRESETS = {
  clear:   { blur: 2,  saturation: 1.55, tintOpacity: 0.03, refractionStrength: 26, bezelWidth: 36, thickness: 26 },
  thin:    { blur: 6,  saturation: 1.5,  tintOpacity: 0.05, refractionStrength: 18, bezelWidth: 26, thickness: 18 },
  regular: { blur: 14, saturation: 1.7,  tintOpacity: 0.09, refractionStrength: 16, bezelWidth: 30, thickness: 20 },
  thick:   { blur: 22, saturation: 1.8,  tintOpacity: 0.13, refractionStrength: 12, bezelWidth: 28, thickness: 18 },
  ultra:   { blur: 30, saturation: 1.85, tintOpacity: 0.17, refractionStrength: 10, bezelWidth: 26, thickness: 16 },
  adaptive:{ blur: 12, saturation: 1.6,  tintOpacity: 0.06, refractionStrength: 18, bezelWidth: 30, thickness: 20, adaptiveTint: true },
};
const LUMA_LIGHT = 0.80, LUMA_DARK = 0.10;
// core/optics.ts refractionProfile: the normalizing peak of the exact Snell displacement for (T/B, n)
const peakCache = new Map();
function profilePeak(thickness, bezel, ior) {
  const ratio = thickness / Math.max(bezel, 0.001); const key = ratio + '|' + ior; if (peakCache.has(key)) return peakCache.get(key);
  let peak = 0; if (ior > 1 && thickness > 0) { const eta = 1 / Math.max(1, ior);
    for (let i = 1; i < 512; i++) { const s = i / 512; const root = Math.sqrt(s * (2 - s)); const slope = ratio * (1 - s) / root; const cosI = 1 / Math.sqrt(1 + slope * slope); const sinI = slope * cosI; const k = eta * cosI - Math.sqrt(Math.max(0, 1 - eta * eta * sinI * sinI)); peak = Math.max(peak, root * Math.abs(k * sinI / (-eta + k * cosI))); } }
  peakCache.set(key, peak); return peak;
}
const SRC2D = {
  color_bars(c, W) { const cols = ['#c0c0c0','#c0c000','#00c0c0','#00c000','#c000c0','#c00000','#0000c0']; cols.forEach((k, i) => { c.fillStyle = k; c.fillRect(i * W / 7, 0, W / 7 + 1, W * 0.67); });
    const low = ['#0000c0','#131313','#c000c0','#131313','#00c0c0','#131313','#c0c0c0']; low.forEach((k, i) => { c.fillStyle = k; c.fillRect(i * W / 7, W * 0.67, W / 7 + 1, W * 0.08); });
    const plg = ['#00214c','#ffffff','#32006a','#131313']; plg.forEach((k, i) => { c.fillStyle = k; c.fillRect(i * W / 4, W * 0.75, W / 4 + 1, W * 0.25); }); },
  wordmark(c, W) { c.fillStyle = '#0e1118'; c.fillRect(0, 0, W, W); c.fillStyle = '#e8ecf4'; c.font = `bold ${W * 0.16}px sans-serif`; c.textAlign = 'center'; for (let i = 0; i < 5; i++) c.fillText('LIQUID GLASS', W / 2, W * (0.16 + i * 0.19)); },
  grid(c, W) { c.fillStyle = '#f2f4f8'; c.fillRect(0, 0, W, W); c.strokeStyle = '#1a2233'; c.lineWidth = 2; for (let i = 0; i <= 16; i++) { c.beginPath(); c.moveTo(i * W / 16, 0); c.lineTo(i * W / 16, W); c.moveTo(0, i * W / 16); c.lineTo(W, i * W / 16); c.stroke(); } },
  siemens(c, W) { c.fillStyle = '#f0f0f0'; c.fillRect(0, 0, W, W); c.fillStyle = '#101010'; const n = 36; for (let i = 0; i < n; i++) { c.beginPath(); c.moveTo(W / 2, W / 2); c.arc(W / 2, W / 2, W * 0.7, i * 2 * Math.PI / n, (i + 0.5) * 2 * Math.PI / n); c.closePath(); c.fill(); } },
};
export const PAGE = {
  async init(ctx) { const NOISE_PACK = ctx.noisePack;
    const { device, format, tiles, PACK, $ } = ctx; this.ctx = ctx;
    this.tex = device.createTexture({ size: [512, 512], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    this.smp = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'mirror-repeat', addressModeV: 'mirror-repeat' });
    this.bgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} }, { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} }] });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [this.bgl] });
    const module = device.createShaderModule({ code: PACK });
    module.getCompilationInfo().then(info => { const errs = info.messages.filter(m => m.type === 'error'); if (errs.length) for (const t of tiles) ctx.setStatus(t, errs[0].message.slice(0, 120), true); });
    const pipe = device.createRenderPipelineAsync({ layout, vertex: { module, entryPoint: 'vs_main' }, fragment: { module, entryPoint: 'fs_glass', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
    for (const t of tiles) pipe.then(p => { t.pipeline = p; t.dirty = true; }).catch(e => ctx.setStatus(t, String(e.message || e).slice(0, 120), true));
    const nbgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
    const nmod = device.createShaderModule({ code: NOISE_PACK }); const nlayout = device.createPipelineLayout({ bindGroupLayouts: [nbgl] });
    this.nbuf = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.nbind = device.createBindGroup({ layout: nbgl, entries: [{ binding: 0, resource: { buffer: this.nbuf } }] });
    this.npipes = {};
    for (const n of NOISE_SOURCES) this.npipes[n] = device.createRenderPipeline({ layout: nlayout, vertex: { module: nmod, entryPoint: 'vs_main' }, fragment: { module: nmod, entryPoint: 'fs_' + n, targets: [{ format: 'rgba8unorm' }] }, primitive: { topology: 'triangle-list' } });
    const thumbs = $('thumbs'); this.work = document.createElement('canvas'); this.work.width = this.work.height = 512; this.wctx = this.work.getContext('2d');
    const add = (id, kind) => { const b = document.createElement('button'); b.type = 'button'; b.title = id.replace(/_/g, ' '); const cv = document.createElement('canvas'); b.appendChild(cv); thumbs.appendChild(b); b.addEventListener('click', () => this.select(id, kind, b)); return { b, cv }; };
    this.photos = {};
    for (const [id, uri] of Object.entries(PHOTOS)) { const { cv } = add(id, 'photo'); cv.width = cv.height = 96; const img = new Image(); img.onload = () => { cv.getContext('2d').drawImage(img, 0, 0, 96, 96); }; img.src = uri; this.photos[id] = img; }
    for (const [id, draw] of Object.entries(SRC2D)) { const { cv } = add(id, '2d'); cv.width = cv.height = 96; draw(cv.getContext('2d'), 96); }
    for (const n of NOISE_SOURCES) { const { cv } = add(n, 'noise'); cv.width = cv.height = 96; const c2 = cv.getContext('webgpu'); c2.configure({ device, format: 'rgba8unorm', alphaMode: 'opaque' }); this.renderNoise(n, c2.getCurrentTexture().createView(), 96); }
    const up = add('upload', 'upload'); up.cv.width = up.cv.height = 96; const uc = up.cv.getContext('2d'); uc.fillStyle = '#1c2436'; uc.fillRect(0, 0, 96, 96); uc.fillStyle = '#96c8ff'; uc.font = '40px sans-serif'; uc.fillText('+', 34, 62); this.upBtn = up;
    up.b.addEventListener('click', () => $('upload').click());
    $('upload').addEventListener('change', e => { const f = e.target.files[0]; if (f) this.loadImage(f); });
    const side = $('side'); side.addEventListener('dragover', e => { e.preventDefault(); }); side.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && f.type.startsWith('image/')) this.loadImage(f); });
    this.select('coffee', 'photo', thumbs.children[Object.keys(PHOTOS).indexOf('coffee')]);
    this.darkBackdrop = true;
    $('appearance').addEventListener('click', () => { this.darkBackdrop = !this.darkBackdrop; $('appearance').classList.toggle('on', this.darkBackdrop); $('appearance').textContent = this.darkBackdrop ? '◐ backdrop reads as dark' : '◑ backdrop reads as light'; ctx.markAllDirty(); });
  },
  renderNoise(n, view, size) {
    const { device } = this.ctx; const d = new Float32Array(24);
    d[0] = size; d[1] = size; d[2] = 3.0; d[3] = 1; d.set([0.02, 0.02, 0.03, 1], 4); d.set([0.35, 0.55, 0.75, 1], 8); d.set([0.91, 0.93, 0.96, 1], 12); d[16] = 1; d[17] = 1; d.set([0.5, 0.5, 0.5, 0.5], 20);
    device.queue.writeBuffer(this.nbuf, 0, d);
    const enc = device.createCommandEncoder(); const pass = enc.beginRenderPass({ colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(this.npipes[n]); pass.setBindGroup(0, this.nbind); pass.draw(3); pass.end(); device.queue.submit([enc.finish()]);
  },
  select(id, kind, btn) {
    const { device, $ } = this.ctx;
    $('thumbs').querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
    if (kind === 'photo') { const img = this.photos[id]; const go = () => { this.wctx.drawImage(img, 0, 0, 512, 512); device.queue.copyExternalImageToTexture({ source: this.work }, { texture: this.tex }, [512, 512]); this.ctx.markAllDirty(); }; if (img.complete && img.naturalWidth) go(); else img.addEventListener('load', go, { once: true }); }
    else if (kind === '2d') { SRC2D[id](this.wctx, 512); device.queue.copyExternalImageToTexture({ source: this.work }, { texture: this.tex }, [512, 512]); }
    else if (kind === 'noise') this.renderNoise(id, this.tex.createView(), 512);
    this.ctx.markAllDirty();
  },
  loadImage(file) {
    const img = new Image(); img.onload = () => { const s = Math.max(512 / img.width, 512 / img.height); const w = img.width * s, h = img.height * s;
      this.wctx.fillStyle = '#000'; this.wctx.fillRect(0, 0, 512, 512); this.wctx.drawImage(img, (512 - w) / 2, (512 - h) / 2, w, h);
      this.ctx.device.queue.copyExternalImageToTexture({ source: this.work }, { texture: this.tex }, [512, 512]);
      const uc = this.upBtn.cv.getContext('2d'); uc.drawImage(this.work, 0, 0, 96, 96);
      this.ctx.$('thumbs').querySelectorAll('button').forEach(b => b.classList.toggle('active', b === this.upBtn.b));
      this.ctx.markAllDirty(); URL.revokeObjectURL(img.src); };
    img.src = URL.createObjectURL(file);
  },
  bind(surf) { if (!surf.page.bind) surf.page.bind = this.ctx.device.createBindGroup({ layout: this.bgl, entries: [{ binding: 0, resource: { buffer: surf.buf } }, { binding: 1, resource: this.tex.createView() }, { binding: 2, resource: this.smp }] }); return surf.page.bind; },
  // resolveGlassConfig: defaults ← material preset ← the cell's overrides ← the cell's knobs
  resolve(t) {
    const o = t.s.cfg; const preset = o.material ? MATERIAL_PRESETS[o.material] : {};
    const c = { ...DEFAULT_CONFIG, ...preset, ...o }; const k = t.knobs; const G = this.ctx.G;
    c.refractionStrength *= Math.pow(4, k[0] - 0.5); c.bezelWidth *= Math.pow(4, k[1] - 0.5); c.blur *= Math.pow(4, k[2] - 0.5) * (k[2] > 0.02 ? 1 : 0); c.chromaticAberration = Math.min(1, c.chromaticAberration * 2 * k[3]);
    c.refractionStrength *= G.lensing;
    return c;
  },
  draw(enc, t, surf, rect, dpr, dt, now, moving) {
    const { device, G } = this.ctx; const d = surf.data; const c = this.resolve(t);
    // the cell is a 420 CSS-px virtual frame: the library's px parameters keep their meaning at any cell size
    const zoom = Math.min(rect.width, rect.height) / 420; const W = rect.width / zoom, H = rect.height / zoom; const cell = Math.min(W, H); const shape = t.s.cfg.shape || 'rect';
    const half = shape === 'pill' ? [0.39, 0.17] : shape === 'circle' ? [0.26, 0.26] : shape === 'squircle' ? [0.3, 0.3] : [0.36, 0.26];
    const hw = half[0] * cell, hh = half[1] * cell; const radius = shape === 'rect' ? c.borderRadius : 1e4;
    const drift = G.drift; const cx = W / 2 + drift * 0.17 * cell * Math.sin(t.phase * 0.6), cy = H / 2 + drift * 0.1 * cell * Math.sin(t.phase * 0.45 + 1.3);
    const dark = t.s.cfg.appearance ? t.s.cfg.appearance === 'dark' : this.darkBackdrop; const L = dark ? LUMA_DARK : LUMA_LIGHT;
    const bezel = Math.min(c.bezelWidth, hw, hh); const peak = profilePeak(c.thickness, bezel, c.ior);
    const tint = c.tint.split(',').map(x => +x / 255);
    d[0] = W; d[1] = H; d[2] = t.phase; d[3] = dpr * zoom;
    d.set([G.ink[0], G.ink[1], G.ink[2], 1], 4); d.set([G.tone[0], G.tone[1], G.tone[2], 1], 8); d.set([G.cream[0], G.cream[1], G.cream[2], 1], 12);
    d.set([cx, cy, hw, hh, radius, c.bezelWidth, c.thickness, c.ior, c.refractionStrength, c.blur, c.saturation, c.tintOpacity, tint[0], tint[1], tint[2], c.chromaticAberration,
      c.lightAngle, c.edgeHighlight, c.specularStrength, c.fresnelPower, c.elevation, c.noiseOpacity, c.noiseScale, L, dark ? 1 : 0, t.rate, peak, c.adaptiveTint ? 1 : 0, 0, c.showMap || 0, c.superN || 0, 0], 16);
    d.set(t.knobs, 48);
    device.queue.writeBuffer(surf.buf, 0, d);
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: surf.ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(t.pipeline); pass.setBindGroup(0, this.bind(surf)); pass.draw(3); pass.end();
  },
  source(t) { return this.ctx.fnSource('fs_glass'); },
};

