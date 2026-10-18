// ============================================================================
//  CNN EXPLAINER  ·  image.js  any picture -> the 64x64 RGB input
// ----------------------------------------------------------------------------
//  DOM-free. coverResample() takes RGBA bytes of any size, crops the centre
//  square and box-filters it to size x size RGB bytes. The page uses it for
//  uploads and camera snapshots. tools/ in the scratchpad used the same
//  function to make examples/examples.bin from the source photos.
//
//  grep -n 'export function coverResample'   crop + box filter
//  grep -n 'export function rgbToRGBA'       RGB bytes -> RGBA (for ImageData)
// ============================================================================

export function coverResample(rgba, w, h, size = 64) {
  const side = Math.min(w, h), ox = (w - side) / 2, oy = (h - side) / 2;
  const out = new Uint8Array(size * size * 3);
  const step = side / size;
  for (let y = 0; y < size; y++) {
    const sy0 = oy + y * step, sy1 = sy0 + step;
    for (let x = 0; x < size; x++) {
      const sx0 = ox + x * step, sx1 = sx0 + step;
      let r = 0, g = 0, b = 0, wsum = 0;
      for (let py = Math.floor(sy0); py < Math.ceil(sy1); py++) {
        const wy = Math.min(sy1, py + 1) - Math.max(sy0, py); if (wy <= 0) continue;
        const yy = Math.min(h - 1, Math.max(0, py));
        for (let px = Math.floor(sx0); px < Math.ceil(sx1); px++) {
          const wx = Math.min(sx1, px + 1) - Math.max(sx0, px); if (wx <= 0) continue;
          const xx = Math.min(w - 1, Math.max(0, px));
          const i = (yy * w + xx) * 4, ww = wx * wy;
          r += rgba[i] * ww; g += rgba[i + 1] * ww; b += rgba[i + 2] * ww; wsum += ww;
        }
      }
      const o = (y * size + x) * 3;
      out[o] = Math.round(r / wsum); out[o + 1] = Math.round(g / wsum); out[o + 2] = Math.round(b / wsum);
    }
  }
  return out;
}

export function rgbToRGBA(rgb, out = new Uint8ClampedArray(rgb.length / 3 * 4)) {
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
    out[j] = rgb[i]; out[j + 1] = rgb[i + 1]; out[j + 2] = rgb[i + 2]; out[j + 3] = 255;
  }
  return out;
}
