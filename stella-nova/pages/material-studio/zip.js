// ============================================================================
//  MATERIAL STUDIO  ·  zip.js — zip archives and image codecs, no dependencies
// ────────────────────────────────────────────────────────────────────────────
//  Owner: IO agent. Imported by export.js and import.js, not by main.js.
//  The module holds no DOM code, so Node 24 can import it for tests (it uses
//  only CompressionStream, DecompressionStream, Blob and Response).
//
//  DATA FLOW
//      export.js  packed channel arrays ─▶ encodePNG / encodeTGA / encodeEXR
//                 ─▶ Uint8Array files ─▶ makeZip ─▶ Blob application/zip
//      import.js  dropped .zip ─▶ readZip ─▶ entries ─▶ decodePNG (exact 8/16
//                 bit, no alpha premultiply) ─▶ channel edits ─▶ encodePNG
//
//  WHY OWN PNG CODECS
//      A 2D canvas stores premultiplied alpha. A packed map such as Unity
//      MetallicSmoothness (R = metal, A = smoothness) loses its RGB data where
//      A is 0, and a canvas cannot hold 16 bits. So this file writes and reads
//      PNG itself: 8 or 16 bits, gray, gray+alpha, RGB or RGBA, adaptive row
//      filters, zlib from CompressionStream('deflate').
//
//  CONTENTS  (grep -n the name to jump)
//      crc32 ................ CRC-32 (zip and PNG chunks)
//      deflateRaw / inflateRaw / zlibDeflate / zlibInflate  stream helpers
//      toBytes .............. string | ArrayBuffer | view | Blob -> Uint8Array
//      makeZip .............. async zip writer (store or deflate per entry)
//      makeZipSync .......... store-only zip writer (sync, contract stub name)
//      readZip .............. zip reader (store + deflate entries)
//      encodePNG ............ 8/16-bit PNG writer, 1-4 channels
//      decodePNG ............ PNG reader (non-interlaced, every color type)
//      encodeTGA ............ 24/32-bit RLE TGA writer
//      encodeEXR ............ half-float uncompressed scanline OpenEXR writer
//      f32ToF16 / f16ToF32 .. half-float bit conversions
//      sniffImage ........... detect png/jpeg/webp/gif/bmp/tga/exr from bytes
// ============================================================================

// ------------------------------------------------------------ crc32
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 of bytes. Pass a previous result as `crc` to continue a run.
 *  @param {Uint8Array} data @param {number} [crc] @returns {number} unsigned */
export function crc32(data, crc = 0) {
  let c = ~crc;
  for (let i = 0, n = data.length; i < n; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (~c) >>> 0;
}

// ------------------------------------------------------------ streams
async function pipe(data, Ctor, format) {
  const s = new Blob([data]).stream().pipeThrough(new Ctor(format));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
/** Raw DEFLATE (zip method 8). */
export const deflateRaw = d => pipe(d, CompressionStream, 'deflate-raw');
/** Raw INFLATE. */
export const inflateRaw = d => pipe(d, DecompressionStream, 'deflate-raw');
/** zlib DEFLATE (PNG IDAT). */
export const zlibDeflate = d => pipe(d, CompressionStream, 'deflate');
/** zlib INFLATE. */
export const zlibInflate = d => pipe(d, DecompressionStream, 'deflate');

const TE = new TextEncoder();
/** Normalize file data to bytes. @returns {Promise<Uint8Array>} */
export async function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (typeof data === 'string') return TE.encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data && typeof data.arrayBuffer === 'function') return new Uint8Array(await data.arrayBuffer());
  throw new Error('zip: unsupported data for entry');
}

// ------------------------------------------------------------ zip writer
function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}
// Entries that are already compressed gain nothing from deflate.
const STORED_EXT = /\.(png|jpe?g|webp|gif|glb|zip|gz|ktx2|basis|mp4|webm)$/i;

/**
 * Write a zip archive.
 * @param {Array<{name:string, data:Uint8Array|ArrayBuffer|string|Blob, date?:Date}>} files
 *        name uses '/' for folders. A duplicate name throws.
 * @param {{compress?:'auto'|'store'|'deflate', comment?:string, onProgress?:(i:number,n:number,name:string)=>void}} [opts]
 *        auto (default) deflates text and raw data, stores png/jpg/glb.
 * @returns {Promise<Blob>} application/zip
 */
export async function makeZip(files, opts = {}) {
  const mode = opts.compress || 'auto';
  const now = new Date();
  const parts = [], central = [];
  const seen = new Set();
  let offset = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (seen.has(f.name)) throw new Error('zip: duplicate entry ' + f.name);
    seen.add(f.name);
    opts.onProgress?.(i, files.length, f.name);
    const raw = await toBytes(f.data);
    const crc = crc32(raw);
    let method = 0, body = raw;
    const want = mode === 'deflate' || (mode === 'auto' && !STORED_EXT.test(f.name) && raw.length > 96);
    if (want) {
      const z = await deflateRaw(raw);
      if (z.length < raw.length) { method = 8; body = z; }
    }
    const name = TE.encode(f.name);
    const { time, date } = dosTime(f.date || now);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, method, true); lh.setUint16(10, time, true); lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, body.length, true); lh.setUint32(22, raw.length, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(lh.buffer, name, body);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true); ch.setUint16(10, method, true); ch.setUint16(12, time, true);
    ch.setUint16(14, date, true); ch.setUint32(16, crc, true); ch.setUint32(20, body.length, true);
    ch.setUint32(24, raw.length, true); ch.setUint16(28, name.length, true);
    ch.setUint32(38, f.name.endsWith('/') ? 0x10 : 0, true); ch.setUint32(42, offset, true);
    central.push(ch.buffer, name);
    offset += 30 + name.length + body.length;
    if (offset > 0xFFFFFFFF) throw new Error('zip: archive is larger than 4 GB (zip64 is not supported)');
  }
  let cdSize = 0;
  for (const c of central) cdSize += c.byteLength;
  const comment = TE.encode(opts.comment || '');
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true); end.setUint16(20, comment.length, true);
  return new Blob([...parts, ...central, end.buffer, comment], { type: 'application/zip' });
}

/** Store-only zip, synchronous (the contract stub signature). Data must be
 *  Uint8Array, ArrayBuffer or string. @returns {Blob} */
export function makeZipSync(files) {
  const enc = files.map(f => ({ name: f.name, data: typeof f.data === 'string' ? TE.encode(f.data) : (f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data)) }));
  const parts = [], central = [];
  const { time, date } = dosTime(new Date());
  let offset = 0;
  for (const f of enc) {
    const name = TE.encode(f.name), crc = crc32(f.data), n = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, n, true); lh.setUint32(22, n, true); lh.setUint16(26, name.length, true);
    parts.push(lh.buffer, name, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, n, true); ch.setUint32(24, n, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(ch.buffer, name);
    offset += 30 + name.length + n;
  }
  let cd = 0; for (const c of central) cd += c.byteLength;
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, enc.length, true); end.setUint16(10, enc.length, true);
  end.setUint32(12, cd, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

// ------------------------------------------------------------ zip reader
const TD = new TextDecoder();
/**
 * Read a zip archive. Folders and macOS resource forks (__MACOSX/, ._*) are skipped.
 * @param {ArrayBuffer|Uint8Array|Blob} input
 * @returns {Promise<Array<{name:string, data:Uint8Array}>>}
 */
export async function readZip(input) {
  const u8 = await toBytes(input);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip: end of central directory not found');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = [];
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip: bad central directory entry');
    const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const loc = dv.getUint32(p + 42, true);
    const name = TD.decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/') || name.startsWith('__MACOSX/') || /(^|\/)\._/.test(name)) continue;
    if (flags & 1) throw new Error('zip: encrypted entry ' + name);
    const lnlen = dv.getUint16(loc + 26, true), lxlen = dv.getUint16(loc + 28, true);
    const start = loc + 30 + lnlen + lxlen;
    const body = u8.subarray(start, start + csize);
    let data;
    if (method === 0) data = body.slice();
    else if (method === 8) data = await inflateRaw(body);
    else throw new Error(`zip: method ${method} is not supported (${name})`);
    out.push({ name, data });
  }
  return out;
}

// ------------------------------------------------------------ png encode
const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const COLOR_TYPE = { 1: 0, 2: 4, 3: 2, 4: 6 };

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
}

/**
 * Encode a PNG.
 * @param {{width:number, height:number, channels:1|2|3|4, bitDepth?:8|16,
 *          data:Uint8Array|Uint16Array, srgb?:boolean, text?:Object<string,string>}} img
 *        data is row-major, top row first, `channels` values per pixel;
 *        Uint16Array for bitDepth 16. srgb adds an sRGB chunk (color maps only).
 * @returns {Promise<Uint8Array>}
 */
export async function encodePNG(img) {
  const { width: w, height: h, channels: ch, data } = img;
  const bits = img.bitDepth || 8;
  if (!(ch in COLOR_TYPE)) throw new Error('png: channels must be 1-4');
  if (data.length !== w * h * ch) throw new Error(`png: data length ${data.length} is not ${w}x${h}x${ch}`);
  const bpp = ch * (bits >> 3), stride = w * bpp;
  const out = new Uint8Array(h * (stride + 1));
  let prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  const scratch = [0, 1, 2, 3, 4].map(() => new Uint8Array(stride));
  // Big inputs try fewer filters: Up and Paeth win on almost every map.
  const filters = w * h * bpp > 16 * 1024 * 1024 ? [2, 4] : [0, 1, 2, 3, 4];
  for (let y = 0; y < h; y++) {
    if (bits === 16) {
      for (let i = 0, o = y * w * ch; i < w * ch; i++) { const v = data[o + i]; cur[i * 2] = v >> 8; cur[i * 2 + 1] = v & 255; }
    } else cur.set(data.subarray(y * stride, y * stride + stride));
    let best = 0, bestSum = Infinity;
    for (const f of filters) {
      const s = scratch[f];
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        let v;
        switch (f) {
          case 0: v = cur[i]; break;
          case 1: v = cur[i] - a; break;
          case 2: v = cur[i] - b; break;
          case 3: v = cur[i] - ((a + b) >> 1); break;
          default: v = cur[i] - paeth(a, b, c);
        }
        v &= 255; s[i] = v; sum += v < 128 ? v : 256 - v;
        if (sum >= bestSum) break;
      }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }
    // the early break above leaves the losing rows partial: redo the winner fully
    const s = scratch[best];
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      const p = best === 0 ? 0 : best === 1 ? a : best === 2 ? b : best === 3 ? ((a + b) >> 1) : paeth(a, b, c);
      s[i] = (cur[i] - p) & 255;
    }
    const o = y * (stride + 1);
    out[o] = best; out.set(s, o + 1);
    const t = prev; prev = cur; cur = t;
  }
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = bits; ihdr[9] = COLOR_TYPE[ch];
  const chunks = [PNG_SIG, chunk('IHDR', ihdr)];
  if (img.srgb) chunks.push(chunk('sRGB', new Uint8Array([0])));
  for (const [k, v] of Object.entries(img.text || {})) chunks.push(chunk('tEXt', TE.encode(`${k}\0${v}`)));
  chunks.push(chunk('IDAT', await zlibDeflate(out)), chunk('IEND', new Uint8Array(0)));
  let n = 0; for (const c of chunks) n += c.length;
  const png = new Uint8Array(n);
  let p = 0; for (const c of chunks) { png.set(c, p); p += c.length; }
  return png;
}

// ------------------------------------------------------------ png decode
/**
 * Decode a non-interlaced PNG exactly (no premultiply, no color management).
 * Palette and sub-8-bit gray expand to 8 bits; tRNS becomes an alpha channel.
 * @param {Uint8Array|ArrayBuffer} input
 * @returns {Promise<{width:number,height:number,channels:1|2|3|4,bitDepth:8|16,data:Uint8Array|Uint16Array,srgb:boolean}>}
 * @throws for interlaced files (the caller falls back to createImageBitmap)
 */
export async function decodePNG(input) {
  const u8 = await toBytes(input);
  for (let i = 0; i < 8; i++) if (u8[i] !== PNG_SIG[i]) throw new Error('png: bad signature');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let p = 8, w = 0, h = 0, bits = 8, ct = 0, interlace = 0, plte = null, trns = null, srgb = false;
  const idat = [];
  while (p < u8.length) {
    const len = dv.getUint32(p), type = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
    const body = u8.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = dv.getUint32(p + 8); h = dv.getUint32(p + 12); bits = body[8]; ct = body[9]; interlace = body[12]; }
    else if (type === 'PLTE') plte = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'sRGB') srgb = true;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (interlace) throw new Error('png: interlaced');
  let total = 0; for (const c of idat) total += c.length;
  const z = new Uint8Array(total); { let o = 0; for (const c of idat) { z.set(c, o); o += c.length; } }
  const raw = await zlibInflate(z);
  const spp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
  const bpp = Math.max(1, (spp * bits) >> 3), stride = (w * spp * bits + 7) >> 3;
  const px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, o = y * stride, po = o - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i], a = i >= bpp ? px[o + i - bpp] : 0, b = y ? px[po + i] : 0, c = (y && i >= bpp) ? px[po + i - bpp] : 0;
      px[o + i] = (f === 0 ? x : f === 1 ? x + a : f === 2 ? x + b : f === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c)) & 255;
    }
  }
  // expand to 8/16-bit samples
  const sample = (y, i) => { // i-th sample in row y, for bits < 8
    const bit = i * bits, byte = px[y * stride + (bit >> 3)];
    return (byte >> (8 - bits - (bit & 7))) & ((1 << bits) - 1);
  };
  if (ct === 3) {
    const hasA = !!trns, ch = hasA ? 4 : 3, out = new Uint8Array(w * h * ch);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const idx = bits === 8 ? px[y * stride + x] : sample(y, x), o = (y * w + x) * ch;
      out[o] = plte[idx * 3]; out[o + 1] = plte[idx * 3 + 1]; out[o + 2] = plte[idx * 3 + 2];
      if (hasA) out[o + 3] = idx < trns.length ? trns[idx] : 255;
    }
    return { width: w, height: h, channels: ch, bitDepth: 8, data: out, srgb };
  }
  if (bits === 16) {
    const out = new Uint16Array(w * h * spp);
    for (let i = 0; i < out.length; i++) out[i] = (px[i * 2] << 8) | px[i * 2 + 1];
    return { width: w, height: h, channels: spp, bitDepth: 16, data: out, srgb };
  }
  if (bits < 8) { // gray only
    const out = new Uint8Array(w * h), k = 255 / ((1 << bits) - 1);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = Math.round(sample(y, x) * k);
    return { width: w, height: h, channels: 1, bitDepth: 8, data: out, srgb };
  }
  return { width: w, height: h, channels: spp, bitDepth: 8, data: px, srgb };
}

// ------------------------------------------------------------ tga
/**
 * Encode an RLE TGA (type 10), bottom-up rows, 24 or 32 bits.
 * @param {{width:number,height:number,channels:3|4|1,data:Uint8Array}} img  8-bit, top row first
 * @returns {Uint8Array}
 */
export function encodeTGA(img) {
  const { width: w, height: h, data } = img;
  const ch = img.channels, outCh = ch === 4 ? 4 : 3;
  const head = new Uint8Array(18);
  head[2] = 10; head[12] = w & 255; head[13] = w >> 8; head[14] = h & 255; head[15] = h >> 8;
  head[16] = outCh * 8; head[17] = outCh === 4 ? 8 : 0;
  const body = new Uint8Array(w * h * (outCh + 1) + h * 2);
  let o = 0;
  const pix = (x, y, k) => { const i = (y * w + x) * ch; return ch === 1 ? data[i] : data[i + k]; };
  const same = (x0, x1, y) => { for (let k = 0; k < outCh; k++) if (pix(x0, y, k) !== pix(x1, y, k)) return false; return true; };
  const put = (x, y) => { body[o++] = pix(x, y, 2); body[o++] = pix(x, y, 1); body[o++] = pix(x, y, 0); if (outCh === 4) body[o++] = pix(x, y, 3); };
  for (let yy = h - 1; yy >= 0; yy--) {
    let x = 0;
    while (x < w) {
      let run = 1;
      while (x + run < w && run < 128 && same(x, x + run, yy)) run++;
      if (run > 1) { body[o++] = 0x80 | (run - 1); put(x, yy); x += run; continue; }
      let lit = 1;
      while (x + lit < w && lit < 128 && !(x + lit + 1 < w && same(x + lit, x + lit + 1, yy))) lit++;
      body[o++] = lit - 1;
      for (let i = 0; i < lit; i++) put(x + i, yy);
      x += lit;
    }
  }
  const out = new Uint8Array(18 + o + 26);
  out.set(head); out.set(body.subarray(0, o), 18);
  out.set(TE.encode('\0\0\0\0\0\0\0\0TRUEVISION-XFILE.\0'), 18 + o);
  return out;
}

// ------------------------------------------------------------ half floats
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
/** float -> IEEE half bits (round to nearest even). */
export function f32ToF16(v) {
  f32[0] = v;
  const x = u32[0], sign = (x >>> 16) & 0x8000;
  let e = ((x >>> 23) & 0xff) - 127 + 15, m = x & 0x7fffff;
  if (((x >>> 23) & 0xff) === 0xff) return sign | 0x7c00 | (m ? 0x200 : 0);
  if (e >= 0x1f) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    m |= 0x800000;
    const shift = 14 - e;
    let r = m >> shift;
    const rem = m & ((1 << shift) - 1), half = 1 << (shift - 1);
    if (rem > half || (rem === half && (r & 1))) r++;
    return sign | r;
  }
  let r = (e << 10) | (m >> 13);
  const rem = m & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && (r & 1))) r++;
  return sign | r;
}
/** IEEE half bits -> float. */
export function f16ToF32(h) {
  const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
  if (e === 0) return s * m * 5.960464477539063e-8;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * Math.pow(2, e - 15);
}

// ------------------------------------------------------------ exr
/**
 * Encode an uncompressed scanline OpenEXR with HALF channels.
 * @param {{width:number,height:number,channels:1|3|4,data:Uint16Array}} img
 *        data holds half bits, `channels` per pixel, top row first.
 *        1 channel is written as 'Y'; 3/4 as R,G,B(,A).
 * @returns {Uint8Array}
 */
export function encodeEXR(img) {
  const { width: w, height: h, channels: ch, data } = img;
  const names = ch === 1 ? ['Y'] : ch === 3 ? ['R', 'G', 'B'] : ['R', 'G', 'B', 'A'];
  const order = names.map((n, i) => [n, i]).sort((a, b) => (a[0] < b[0] ? -1 : 1)); // EXR wants sorted names
  const bytes = [];
  const u8 = v => bytes.push(v & 255);
  const i32 = v => { u8(v); u8(v >> 8); u8(v >> 16); u8(v >> 24); };
  const f32v = v => { f32[0] = v; i32(u32[0]); };
  const str = s => { for (const c of s) u8(c.charCodeAt(0)); u8(0); };
  const attr = (name, type, size, write) => { str(name); str(type); i32(size); write(); };
  i32(20000630); i32(2);
  let chSize = 1; for (const [n] of order) chSize += n.length + 1 + 16;
  attr('channels', 'chlist', chSize, () => { for (const [n] of order) { str(n); i32(1); u8(0); u8(0); u8(0); u8(0); i32(1); i32(1); } u8(0); });
  attr('compression', 'compression', 1, () => u8(0));
  attr('dataWindow', 'box2i', 16, () => { i32(0); i32(0); i32(w - 1); i32(h - 1); });
  attr('displayWindow', 'box2i', 16, () => { i32(0); i32(0); i32(w - 1); i32(h - 1); });
  attr('lineOrder', 'lineOrder', 1, () => u8(0));
  attr('pixelAspectRatio', 'float', 4, () => f32v(1));
  attr('screenWindowCenter', 'v2f', 8, () => { f32v(0); f32v(0); });
  attr('screenWindowWidth', 'float', 4, () => f32v(1));
  u8(0);
  const head = bytes.length, line = 8 + w * ch * 2;
  const out = new Uint8Array(head + h * 8 + h * line);
  out.set(bytes);
  const dv = new DataView(out.buffer);
  const base = head + h * 8;
  for (let y = 0; y < h; y++) {
    const off = base + y * line;
    dv.setUint32(head + y * 8, off, true); dv.setUint32(head + y * 8 + 4, 0, true);
    dv.setInt32(off, y, true); dv.setInt32(off + 4, w * ch * 2, true);
    let p = off + 8;
    for (const [, ci] of order) for (let x = 0; x < w; x++, p += 2) dv.setUint16(p, data[(y * w + x) * ch + ci], true);
  }
  return out;
}

// ------------------------------------------------------------ sniff
/** Detect an image container from its first bytes.
 *  @param {Uint8Array} u8 @returns {'png'|'jpeg'|'webp'|'gif'|'bmp'|'exr'|'zip'|null} */
export function sniffImage(u8) {
  if (u8.length < 12) return null;
  if (u8[0] === 137 && u8[1] === 80 && u8[2] === 78 && u8[3] === 71) return 'png';
  if (u8[0] === 0xff && u8[1] === 0xd8) return 'jpeg';
  if (u8[0] === 82 && u8[1] === 73 && u8[2] === 70 && u8[3] === 70 && u8[8] === 87 && u8[9] === 69) return 'webp';
  if (u8[0] === 71 && u8[1] === 73 && u8[2] === 70) return 'gif';
  if (u8[0] === 66 && u8[1] === 77) return 'bmp';
  if (u8[0] === 0x76 && u8[1] === 0x2f && u8[2] === 0x31 && u8[3] === 0x01) return 'exr';
  if (u8[0] === 0x50 && u8[1] === 0x4b && u8[2] === 3 && u8[3] === 4) return 'zip';
  return null;
}

/** Contract stub name: store-only, synchronous. */
export const makeZipStore = makeZipSync;
