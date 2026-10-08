// ============================================================================
//  PLANET FORGE  ·  png.js — a small PNG encoder (no DOM, no canvas)
// ----------------------------------------------------------------------------
//  canvas.toBlob gives 8-bit RGBA only and premultiplies alpha. The height
//  map needs 16 bits and the gray maps need one channel, so the page
//  writes PNG itself: signature, IHDR, one IDAT (zlib from the platform
//  CompressionStream('deflate')), IEND. Each row uses filter 1 (Sub),
//  which suits smooth fields. Works in the page, in a worker, in node 18+
//  and in Deno.
//
//  encodePNG({ width, height, channels 1|2|3|4, depth 8|16, data }) -> Uint8Array
//  decodePNGRaw(bytes) -> the same object (tests only: unfilters Sub/None)
// ============================================================================

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes, crc = 0xffffffff) {
  for (let i = 0; i < bytes.length; i++) crc = CRC[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  return crc;
}

async function zlib(bytes) {
  const cs = new CompressionStream('deflate');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(cs));
  return new Uint8Array(await out.arrayBuffer());
}
async function unzlib(bytes) {
  const ds = new DecompressionStream('deflate');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

const COLOR_TYPE = { 1: 0, 2: 4, 3: 2, 4: 6 };

export async function encodePNG(img) {
  const { width: w, height: h, channels: ch, depth } = img;
  const bpp = ch * (depth / 8), stride = w * bpp;
  // raw bytes, big-endian for 16-bit
  let raw;
  if (depth === 16) {
    raw = new Uint8Array(w * h * ch * 2);
    const s = img.data;
    for (let i = 0; i < s.length; i++) { raw[i * 2] = s[i] >> 8; raw[i * 2 + 1] = s[i] & 255; }
  } else raw = img.data instanceof Uint8Array ? img.data : new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  const filt = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1), r = y * stride;
    filt[o] = 1;
    for (let i = 0; i < stride; i++) filt[o + 1 + i] = (raw[r + i] - (i >= bpp ? raw[r + i - bpp] : 0)) & 255;
  }
  const idat = await zlib(filt);
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = depth; ihdr[9] = COLOR_TYPE[ch]; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const chunks = [chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  const total = 8 + chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total); out.set(sig, 0);
  let o = 8; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, (crc32(out.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0);
  return out;
}

// For tests: read back what encodePNG wrote (filters None and Sub only).
export async function decodePNGRaw(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 8, w = 0, h = 0, depth = 8, ct = 0; const idat = [];
  while (o < bytes.length) {
    const len = dv.getUint32(o), type = String.fromCharCode(...bytes.subarray(o + 4, o + 8));
    const d = bytes.subarray(o + 8, o + 8 + len);
    const crc = dv.getUint32(o + 8 + len);
    if (((crc32(bytes.subarray(o + 4, o + 8 + len)) ^ 0xffffffff) >>> 0) !== crc) throw new Error('crc ' + type);
    if (type === 'IHDR') { const v = new DataView(d.buffer, d.byteOffset); w = v.getUint32(0); h = v.getUint32(4); depth = d[8]; ct = d[9]; }
    if (type === 'IDAT') idat.push(d);
    o += 12 + len;
  }
  const ch = { 0: 1, 4: 2, 2: 3, 6: 4 }[ct];
  const all = new Uint8Array(idat.reduce((a, c) => a + c.length, 0)); let k = 0; for (const c of idat) { all.set(c, k); k += c.length; }
  const f = await unzlib(all);
  const bpp = ch * depth / 8, stride = w * bpp, raw = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const t = f[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const v = f[y * (stride + 1) + 1 + i];
      raw[y * stride + i] = t === 1 ? (v + (i >= bpp ? raw[y * stride + i - bpp] : 0)) & 255 : v;
    }
  }
  if (depth === 16) { const d = new Uint16Array(w * h * ch); for (let i = 0; i < d.length; i++) d[i] = (raw[i * 2] << 8) | raw[i * 2 + 1]; return { width: w, height: h, channels: ch, depth, data: d }; }
  return { width: w, height: h, channels: ch, depth, data: raw };
}
