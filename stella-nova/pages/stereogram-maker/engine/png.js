// ============================================================================
//  STEREOGRAM ENGINE  ·  engine/png.js — a small PNG writer (no DOM)
// ----------------------------------------------------------------------------
//  encodePNG(img) writes an RGBA Image as a PNG with stored (not
//  compressed) deflate blocks, so it needs no zlib. The node tests and
//  the scratch previews use it. A page saves with canvas.toBlob, which
//  compresses.
//
//  grep -n targets: "export function encodePNG", "function crc32"
// ============================================================================
let CRC = null;
function crc32(buf, start, end) {
  if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function encodePNG(img) {
  const { w, h, data } = img, rowLen = w * 4 + 1, raw = new Uint8Array(rowLen * h);
  for (let y = 0; y < h; y++) { raw[y * rowLen] = 0; raw.set(data.subarray(y * w * 4, (y + 1) * w * 4), y * rowLen + 1); }
  const nBlocks = Math.max(1, Math.ceil(raw.length / 65535));
  const z = new Uint8Array(2 + raw.length + nBlocks * 5 + 4);
  z[0] = 0x78; z[1] = 0x01;
  let p = 2;
  for (let b = 0; b < nBlocks; b++) {
    const s = b * 65535, n = Math.min(65535, raw.length - s);
    z[p++] = b === nBlocks - 1 ? 1 : 0; z[p++] = n & 255; z[p++] = n >> 8; z[p++] = ~n & 255; z[p++] = (~n >> 8) & 255;
    z.set(raw.subarray(s, s + n), p); p += n;
  }
  let a = 1, bb = 0;
  for (let i = 0; i < raw.length; i++) { a = (a + raw[i]) % 65521; bb = (bb + a) % 65521; }
  const ad = ((bb << 16) | a) >>> 0;
  z[p++] = ad >>> 24; z[p++] = ad >>> 16 & 255; z[p++] = ad >>> 8 & 255; z[p++] = ad & 255;
  const chunks = [];
  const chunk = (type, body) => {
    const c = new Uint8Array(12 + body.length), dv = new DataView(c.buffer);
    dv.setUint32(0, body.length);
    for (let i = 0; i < 4; i++) c[4 + i] = type.charCodeAt(i);
    c.set(body, 8);
    dv.setUint32(8 + body.length, crc32(c, 4, 8 + body.length));
    chunks.push(c);
  };
  const ih = new Uint8Array(13), dv = new DataView(ih.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ih[8] = 8; ih[9] = 6;
  chunk('IHDR', ih); chunk('IDAT', z); chunk('IEND', new Uint8Array(0));
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  const total = 8 + chunks.reduce((s, c) => s + c.length, 0), out = new Uint8Array(total);
  out.set(sig, 0); let q = 8; for (const c of chunks) { out.set(c, q); q += c.length; }
  return out;
}
// A DepthMap as a grey Image (white near), for previews.
export function depthToImage(depth) {
  const d = new Uint8ClampedArray(depth.w * depth.h * 4);
  for (let i = 0; i < depth.data.length; i++) { const v = depth.data[i] * 255; d[4 * i] = d[4 * i + 1] = d[4 * i + 2] = v; d[4 * i + 3] = 255; }
  return { w: depth.w, h: depth.h, data: d };
}
