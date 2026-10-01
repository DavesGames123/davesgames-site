// ============================================================================
//  MATERIAL STUDIO  ·  viewport/textures.js — map textures and half-float upload
// ────────────────────────────────────────────────────────────────────────────
//  Makes the rgba16float map textures that the material sets use, and fills
//  them from a per-texel callback. The default set and the test maps use
//  writeHalf(). The bake output does not come through this file.
//
//  GREP TARGETS
//      mapTexture ............. one HDR map texture, res x res
//      toHalf ................. float32 to float16 bits
//      writeHalf .............. fill a texture from fn(u, v, px, x, y)
// ============================================================================
import { HDR, device } from './state.js';

export function mapTexture(label, res, usage = 0) {
  return device.createTexture({
    label, size: [res, res, 1], format: HDR,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT | usage,
  });
}

// float -> half float bits
const f32b = new Float32Array(1), u32b = new Uint32Array(f32b.buffer);
function toHalf(v) {
  f32b[0] = v; const x = u32b[0];
  const sign = (x >>> 16) & 0x8000;
  const e = ((x >>> 23) & 0xff) - 112;
  const m = x & 0x7fffff;
  if (e <= 0) return sign;
  if (e >= 31) return sign | 0x7c00;
  return sign | (e << 10) | (m >>> 13);
}
export function writeHalf(tex, res, fn) {
  const data = new Uint16Array(res * res * 4);
  const px = [0, 0, 0, 0];
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    fn((x + 0.5) / res, (y + 0.5) / res, px, x, y);
    const o = (y * res + x) * 4;
    data[o] = toHalf(px[0]); data[o + 1] = toHalf(px[1]); data[o + 2] = toHalf(px[2]); data[o + 3] = toHalf(px[3]);
  }
  device.queue.writeTexture({ texture: tex }, data, { bytesPerRow: res * 8, rowsPerImage: res }, [res, res, 1]);
}
