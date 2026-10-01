// ============================================================================
//  MATERIAL STUDIO  ·  export/readback.js — baked maps from the GPU to the CPU
// ────────────────────────────────────────────────────────────────────────────
//  readTexture copies one GPU texture to a mapped buffer and gives half
//  bits, 4 per texel. It accepts rgba16float, rgba32float and the 8-bit
//  rgba and bgra formats. MapSource reads the slots of one MaterialMaps set
//  on demand. It asks __studio.bake.readback first, and it uses readTexture
//  when the bake module has no readback. It keeps each slot up to 2048².
//
//  GREP TARGETS
//      readTexture  MapSource  get(slot)  drop(slot)
// ============================================================================
import { f32ToF16 } from '../zip.js';
import { C } from './ctx.js';

/**
 * Read a GPU texture back as half-float bits (4 per texel). Accepts
 * rgba16float (copied as is), rgba32float and rgba8unorm (converted).
 * @param {GPUTexture} tex @returns {Promise<Uint16Array>}
 */
export async function readTexture(tex) {
  const d = C.gpu.device;
  if (!d) throw new Error('No GPU device');
  const w = tex.width, h = tex.height, fmt = tex.format || 'rgba16float';
  const bpt = fmt === 'rgba32float' ? 16 : fmt === 'rgba16float' ? 8 : 4;
  const bpr = Math.ceil((w * bpt) / 256) * 256;
  const buf = d.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = d.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr, rowsPerImage: h }, [w, h, 1]);
  d.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const src = new Uint8Array(buf.getMappedRange());
  const out = new Uint16Array(w * h * 4);
  if (bpt === 8) {
    const o8 = new Uint8Array(out.buffer);
    for (let y = 0; y < h; y++) o8.set(src.subarray(y * bpr, (y * bpr) + (w * 8)), y * w * 8);
  } else if (bpt === 16) {
    for (let y = 0; y < h; y++) {
      const row = new Float32Array(src.buffer, src.byteOffset + (y * bpr), w * 4);
      for (let i = 0; i < w * 4; i++) out[(y * w * 4) + i] = f32ToF16(row[i]);
    }
  } else {
    const bgra = /^bgra/.test(fmt);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
      const sc = bgra && c < 3 ? 2 - c : c;
      out[(((y * w) + x) * 4) + c] = f32ToF16(src[(y * bpr) + (x * 4) + sc] / 255);
    }
  }
  buf.unmap(); buf.destroy();
  return out;
}

/** Lazy per-slot readback cache for one MaterialMaps set. */
export class MapSource {
  constructor(maps) { this.maps = maps; this.res = maps.res || maps.albedo?.width; this.cache = new Map(); this.keep = this.res <= 2048; }
  async get(slot) {
    if (this.cache.has(slot)) return this.cache.get(slot);
    const n = this.res * this.res * 4;
    let data = null;
    const bake = window.__studio?.bake;
    if (bake && typeof bake.readback === 'function') {
      try {
        // bake.readback(name, {maps, format}): half bits of THIS map set, linear (no sRGB).
        let r = await bake.readback(slot, { maps: this.maps, format: 'half', srgb: false });
        if (r && r.data) r = r.data;
        if (r instanceof Uint16Array && r.length === n) data = r;
        else if (r instanceof Float32Array && r.length === n) { data = new Uint16Array(n); for (let i = 0; i < n; i++) data[i] = f32ToF16(r[i]); }
      } catch (e) { console.warn('[export] bake.readback failed, the export reads the texture itself', e); }
    }
    if (!data) {
      const tex = this.maps[slot];
      if (!tex) throw new Error(`The bake result has no ${slot} map`);
      data = await readTexture(tex);
    }
    this.cache.set(slot, data);
    return data;
  }
  drop(slot) { if (!this.keep) this.cache.delete(slot); }
}
