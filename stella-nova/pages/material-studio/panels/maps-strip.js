// ============================================================================
//  MATERIAL STUDIO  ·  panels/maps-strip.js — the #maps-strip thumbnails and the map lightbox
// ────────────────────────────────────────────────────────────────────────────
//  One tile per map channel. renderTiles draws the baked maps into an
//  rgba8 texture with shaders/panels-thumb.wgsl and reads them back. A
//  click on a tile solos it in the viewport. A double-click opens the
//  lightbox with a texel readout.
//
//  GREP TARGETS
//      TILES THUMB thumbs initThumbPipeline tileUniform renderTiles initStrip
//      markSolo updateStrip tileStat openLightbox
// ============================================================================
import { ctx, store, state, $ } from './ctx.js';
import { rgbToHex } from './color.js';
import { h, ibtn } from './dom.js';

// One tile per map channel. `view` is the viewport debug view the tile solos.
export const TILES = [
  { id: 'albedo', label: 'Base Color', slot: 'albedo', mode: 0, view: 'albedo' },
  { id: 'opacity', label: 'Opacity', slot: 'albedo', mode: 2, mask: [0, 0, 0, 1], view: 'opacity' },
  { id: 'normal', label: 'Normal', slot: 'normal', mode: 1, view: 'normal' },
  { id: 'ao', label: 'AO', slot: 'orm', mode: 2, mask: [1, 0, 0, 0], view: 'ao' },
  { id: 'roughness', label: 'Roughness', slot: 'orm', mode: 2, mask: [0, 1, 0, 0], view: 'roughness' },
  { id: 'metallic', label: 'Metallic', slot: 'orm', mode: 2, mask: [0, 0, 1, 0], view: 'metallic' },
  { id: 'height', label: 'Height', slot: 'height', mode: 2, mask: [1, 0, 0, 0], view: 'height' },
  { id: 'emissive', label: 'Emissive', slot: 'emissive', mode: 3, view: 'emissive' },
  { id: 'clearcoat', label: 'Clearcoat', slot: 'extra', mode: 2, mask: [1, 0, 0, 0], view: 'clearcoat' },
  { id: 'ccRough', label: 'Coat Rough', slot: 'extra', mode: 2, mask: [0, 1, 0, 0], view: null },
  { id: 'sheen', label: 'Sheen', slot: 'extra', mode: 2, mask: [0, 0, 1, 0], view: 'sheen' },
  { id: 'anisotropy', label: 'Anisotropy', slot: 'extra', mode: 2, mask: [0, 0, 0, 1], view: 'anisotropy' },
];
const THUMB = 128;
export const thumbs = { pipe: null, samp: null, ubufs: [], tiles: new Map(), busy: false, again: false, n: 0, err: null };
export async function initThumbPipeline() {
  const g = ctx.gpu; if (!g.ok) return;
  let code;
  try { code = await (await fetch(new URL('../shaders/panels-thumb.wgsl', import.meta.url))).text(); }
  catch (e) { thumbs.err = 'shader fetch failed'; return; }
  const d = g.device;
  const mod = d.createShaderModule({ code, label: 'panels-thumb' });
  thumbs.pipe = await d.createRenderPipelineAsync({
    label: 'panels-thumb', layout: 'auto',
    vertex: { module: mod, entryPoint: 'vs' },
    fragment: { module: mod, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
    primitive: { topology: 'triangle-list' },
  });
  thumbs.samp = d.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat' });
}
/** Uniform for one tile: mask vec4f, mode u32, gain f32, footprint f32, pad. */
function tileUniform(t, size, res, gain) {
  const d = ctx.gpu.device;
  const buf = d.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const ab = new ArrayBuffer(32), f = new Float32Array(ab), u = new Uint32Array(ab);
  f.set(t.mask || [1, 1, 1, 1], 0); u[4] = t.mode; f[5] = gain; f[6] = 1 / size; f[7] = res / size;
  d.queue.writeBuffer(buf, 0, ab);
  return buf;
}
/**
 * Render the given tiles of `maps` to rgba8 images. All GPU work is submitted
 * before the first await, so the bake may recycle the maps afterwards.
 * @returns {Promise<ImageData[]>|null}
 */
function renderTiles(maps, list, size) {
  const d = ctx.gpu.device; if (!thumbs.pipe || !maps) return null;
  const W = size * list.length, bpr = Math.ceil((W * 4) / 256) * 256;
  const tgt = d.createTexture({ size: [W, size], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const rb = d.createBuffer({ size: bpr * size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const gain = maps.scalars?.emissiveStrength ?? state.scalars?.emissiveStrength ?? 1;
  const ubs = [];
  const enc = d.createCommandEncoder({ label: 'panels-thumbs' });
  const pass = enc.beginRenderPass({ colorAttachments: [{ view: tgt.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0.05, g: 0.06, b: 0.08, a: 1 } }] });
  pass.setPipeline(thumbs.pipe);
  list.forEach((t, i) => {
    const tex = maps[t.slot]; if (!tex) return;
    const ub = tileUniform(t, size, maps.res || tex.width || 1024, gain); ubs.push(ub);
    const bg = d.createBindGroup({ layout: thumbs.pipe.getBindGroupLayout(0), entries: [
      { binding: 0, resource: tex.createView() }, { binding: 1, resource: thumbs.samp }, { binding: 2, resource: { buffer: ub } }] });
    pass.setViewport(i * size, 0, size, size, 0, 1);
    pass.setBindGroup(0, bg); pass.draw(3);
  });
  pass.end();
  enc.copyTextureToBuffer({ texture: tgt }, { buffer: rb, bytesPerRow: bpr }, [W, size]);
  d.queue.submit([enc.finish()]);
  return rb.mapAsync(GPUMapMode.READ).then(() => {
    const src = new Uint8Array(rb.getMappedRange());
    const imgs = list.map((t, i) => {
      const img = new ImageData(size, size);
      for (let y = 0; y < size; y++) img.data.set(src.subarray(y * bpr + i * size * 4, y * bpr + (i + 1) * size * 4), y * size * 4);
      return img;
    });
    rb.unmap(); rb.destroy(); tgt.destroy(); ubs.forEach(b => b.destroy());
    return imgs;
  }, e => { rb.destroy(); tgt.destroy(); ubs.forEach(b => b.destroy()); throw e; });
}
export function initStrip() {
  const strip = $('maps-strip'); if (!strip) return;
  strip.classList.add('pn-strip');
  strip.replaceChildren(...TILES.map(t => {
    const cv = h('canvas', { width: THUMB, height: THUMB, class: 'mt-cv' });
    const stat = h('span', { class: 'mt-stat' }, '—');
    const el = h('button', { type: 'button', class: 'mt', dataset: { tile: t.id }, title: `${t.label}${t.view ? ': click to solo in the viewport' : ''}. Double-click to enlarge.` },
      cv, h('span', { class: 'mt-l' }, t.label), stat);
    el.addEventListener('click', () => {
      if (!t.view) return;
      store.setView({ debug: state.view.debug === t.view ? 'lit' : t.view });
    });
    el.addEventListener('dblclick', () => openLightbox(t));
    thumbs.tiles.set(t.id, { el, cv, stat, t });
    return el;
  }));
  markSolo();
}
export function markSolo() { for (const { el, t } of thumbs.tiles.values()) el.classList.toggle('on', !!t.view && state.view.debug === t.view); }
export async function updateStrip() {
  if (!thumbs.pipe || !state.maps) return;
  if (thumbs.busy) { thumbs.again = true; return; }
  thumbs.busy = true;
  try {
    const p = renderTiles(state.maps, TILES, THUMB);
    if (!p) return;
    const imgs = await p;
    imgs.forEach((img, i) => {
      const tl = thumbs.tiles.get(TILES[i].id); if (!tl) return;
      tl.cv.getContext('2d').putImageData(img, 0, 0);
      tl.stat.textContent = tileStat(img, TILES[i]);
      tl.el.classList.toggle('flat', /^flat/.test(tl.stat.textContent));
    });
    thumbs.n++;
  } catch (e) { console.warn('[panels] thumbnails', e); thumbs.err = String(e.message || e); }
  finally {
    thumbs.busy = false;
    if (thumbs.again) { thumbs.again = false; updateStrip(); }
  }
}
/** Min/max of a gray tile (display value), or 'flat x' when constant. */
export function tileStat(img, t) {
  const d = img.data; let mn = 255, mx = 0;
  const step = 4 * 7;
  for (let i = 0; i < d.length; i += step) { const v = t.mode === 2 ? d[i] : Math.max(d[i], d[i + 1], d[i + 2]); if (v < mn) mn = v; if (v > mx) mx = v; }
  if (mx - mn <= 1) return t.mode === 2 ? `flat ${(mn / 255).toFixed(2)}` : `flat ${rgbToHex([d[0] / 255, d[1] / 255, d[2] / 255])}`;
  return t.mode === 2 ? `${(mn / 255).toFixed(2)}–${(mx / 255).toFixed(2)}` : '';
}
async function openLightbox(t) {
  if (!state.maps || !thumbs.pipe) return;
  const S = 512;
  const cv = h('canvas', { width: S, height: S, class: 'lb-cv' });
  const read = h('span', { class: 'mono pn-sub' }, 'hover to read texels');
  const sel = h('select', { class: 'pn-sel', 'aria-label': 'Channel' }, TILES.map(x => h('option', { value: x.id }, x.label)));
  sel.value = t.id;
  const close = () => box.remove();
  const box = h('div', { class: 'pn-modal', role: 'dialog', 'aria-label': 'Map preview', onclick: e => { if (e.target === box) close(); } },
    h('div', { class: 'pn-modal-c lb' },
      h('div', { class: 'pn-modal-h' }, h('b', null, 'Map preview'), sel, h('span', { class: 'pn-sub' }, `${state.maps.res}² source`), ibtn('close', 'Close', close)),
      cv, read));
  document.body.appendChild(box);
  const draw = async id => {
    const tile = TILES.find(x => x.id === id);
    const p = renderTiles(state.maps, [tile], S); if (!p) return;
    const [img] = await p; cv.getContext('2d').putImageData(img, 0, 0); cv._img = img;
  };
  sel.addEventListener('change', () => draw(sel.value));
  cv.addEventListener('pointermove', e => {
    const r = cv.getBoundingClientRect(), x = Math.floor((e.clientX - r.left) / r.width * S), y = Math.floor((e.clientY - r.top) / r.height * S);
    const img = cv._img; if (!img || x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    read.textContent = `uv ${(x / S).toFixed(3)}, ${(y / S).toFixed(3)}  ·  ${[0, 1, 2].map(k => (img.data[i + k] / 255).toFixed(3)).join('  ')}  (display)`;
  });
  box.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  box.tabIndex = -1; box.focus();
  await draw(t.id);
}
