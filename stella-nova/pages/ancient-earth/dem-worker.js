// ============================================================================
//  ANCIENT EARTH  ·  dem-worker.js  ·  decode DEM chunks off the main thread
// ----------------------------------------------------------------------------
//  Message in:  { id, w, h, bytes }  bytes = k frames of w x h codes
//  Message out: { id, rg }           rg = k frames of [code, coast km / 16]
//  The chamfer passes (data.js coastDistance) cost about 7 ms per frame on
//  a fast laptop and 4x that on a slow one, 10 frames per chunk. Here they
//  never hold up a rendered frame.
// ============================================================================
import { coastDistance } from './data.js';

self.onmessage = e => {
  const { id, w, h, bytes } = e.data, n = w * h, k = bytes.length / n;
  const rg = new Uint8Array(n * 2 * k), tmp = new Uint8Array(n);
  for (let f = 0; f < k; f++) {
    const codes = bytes.subarray(f * n, (f + 1) * n);
    coastDistance(codes, w, h, tmp);
    const o = f * n * 2;
    for (let i = 0; i < n; i++) { rg[o + 2 * i] = codes[i]; rg[o + 2 * i + 1] = tmp[i]; }
  }
  self.postMessage({ id, rg }, [rg.buffer]);
};
