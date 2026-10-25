// Decoders for the em-explorer DATA package.
//
// gunzip / inflate: DecompressionStream ('gzip' / 'deflate').
// zstd: vendored fzstd 0.1.1 (MIT).
// blosc: c-blosc 1.x frames with lz4, zstd or zlib inside, byte shuffle.
// jpeg: createImageBitmap and a 2D canvas (OffscreenCanvas in a worker).
//   A neuroglancer JPEG chunk stacks its z slices vertically, so image
//   rows in order are the chunk voxels with x fastest.

import { decompress as zstdDecompress } from '../../../vendor/fzstd@0.1.1/esm/index.mjs';

async function streamDecode(bytes, format) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('em-explorer DATA: this browser has no DecompressionStream (' + format + ')');
  }
  const ds = new DecompressionStream(format);
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function gunzip(bytes) { return streamDecode(bytes, 'gzip'); }
export function inflate(bytes) { return streamDecode(bytes, 'deflate'); }

export function zstd(bytes) { return zstdDecompress(bytes); }

// LZ4 block format. Writes into dst from dstPos, returns the end position.
export function lz4Block(src, dst, dstPos = 0, srcPos = 0, srcEnd = src.length) {
  let ip = srcPos, op = dstPos;
  const dstEnd = dst.length;
  while (ip < srcEnd) {
    const token = src[ip++];
    let lit = token >>> 4;
    if (lit === 15) { let b; do { b = src[ip++]; lit += b; } while (b === 255 && ip < srcEnd); }
    if (op + lit > dstEnd || ip + lit > srcEnd) throw new Error('lz4: literal run out of range');
    dst.set(src.subarray(ip, ip + lit), op);
    ip += lit; op += lit;
    if (ip >= srcEnd) break;
    const off = src[ip] | (src[ip + 1] << 8);
    ip += 2;
    if (off === 0 || off > op - dstPos) throw new Error('lz4: bad offset');
    let ml = token & 15;
    if (ml === 15) { let b; do { b = src[ip++]; ml += b; } while (b === 255 && ip < srcEnd); }
    ml += 4;
    if (op + ml > dstEnd) throw new Error('lz4: match out of range');
    let m = op - off;
    if (off >= ml) { dst.copyWithin(op, m, m + ml); op += ml; }
    else { for (let i = 0; i < ml; i++) dst[op++] = dst[m++]; }
  }
  return op;
}

const BLOSC_MAX_SPLITS = 16, BLOSC_MIN_BUFFERSIZE = 128;

// c-blosc 1.x frame -> bytes.
export async function decodeBlosc(src) {
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const flags = src[2], typesize = src[3] || 1;
  const nbytes = dv.getUint32(4, true), blocksize = dv.getUint32(8, true);
  const out = new Uint8Array(nbytes);
  if (nbytes === 0) return out;
  if (flags & 0x02) { out.set(src.subarray(16, 16 + nbytes)); return out; }
  const compformat = (flags & 0xe0) >>> 5;
  const shuffle = (flags & 0x01) && typesize > 1;
  if (flags & 0x04) throw new Error('blosc: bitshuffle is not supported');
  const dontSplit = (flags & 0x10) !== 0;
  const nblocks = Math.ceil(nbytes / blocksize);
  const leftover = nbytes % blocksize;
  const tmp = new Uint8Array(blocksize);
  for (let j = 0; j < nblocks; j++) {
    const last = j === nblocks - 1 && leftover > 0;
    const bsize = last ? leftover : blocksize;
    let ip = dv.getUint32(16 + 4 * j, true);
    const split = !dontSplit && typesize <= BLOSC_MAX_SPLITS &&
      (blocksize / typesize) >= BLOSC_MIN_BUFFERSIZE && !last;
    const nstreams = split ? typesize : 1;
    const neblock = bsize / nstreams;
    const dst = shuffle ? tmp : out;
    const base = shuffle ? 0 : j * blocksize;
    for (let s = 0; s < nstreams; s++) {
      const csize = dv.getInt32(ip, true); ip += 4;
      const at = base + s * neblock;
      if (csize === neblock) {
        dst.set(src.subarray(ip, ip + neblock), at);
      } else if (compformat === 1) {
        const end = lz4Block(src, dst, at, ip, ip + csize);
        if (end - at !== neblock) throw new Error('blosc: lz4 size mismatch');
      } else if (compformat === 4) {
        dst.set(zstdDecompress(src.subarray(ip, ip + csize)).subarray(0, neblock), at);
      } else if (compformat === 3) {
        dst.set((await inflate(src.subarray(ip, ip + csize))).subarray(0, neblock), at);
      } else {
        throw new Error('blosc: compressor ' + compformat + ' is not supported');
      }
      ip += csize;
    }
    if (shuffle) {
      const n = Math.floor(bsize / typesize);
      const o = j * blocksize;
      for (let t = 0; t < typesize; t++) {
        for (let i = 0; i < n; i++) out[o + i * typesize + t] = tmp[t * n + i];
      }
      for (let i = n * typesize; i < bsize; i++) out[o + i] = tmp[i];
    }
  }
  return out;
}

// Browser JPEG decoder: returns { data (one byte per pixel), width, height }.
let jpegCanvas = null, jpegCtx = null;
function canvasFor(w, h) {
  if (!jpegCanvas || jpegCanvas.width < w || jpegCanvas.height < h) {
    const cw = Math.max(w, jpegCanvas ? jpegCanvas.width : 0);
    const ch = Math.max(h, jpegCanvas ? jpegCanvas.height : 0);
    if (typeof OffscreenCanvas !== 'undefined') jpegCanvas = new OffscreenCanvas(cw, ch);
    else { jpegCanvas = document.createElement('canvas'); jpegCanvas.width = cw; jpegCanvas.height = ch; }
    jpegCtx = jpegCanvas.getContext('2d', { willReadFrequently: true });
  }
  return jpegCtx;
}

export async function decodeJpegBrowser(bytes) {
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  let bmp;
  try {
    bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  } catch (e) {
    bmp = await createImageBitmap(blob);
  }
  const w = bmp.width, h = bmp.height;
  const g = canvasFor(w, h);
  g.clearRect(0, 0, w, h);
  g.drawImage(bmp, 0, 0);
  if (bmp.close) bmp.close();
  const rgba = g.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = rgba[j];
  return { data: out, width: w, height: h };
}
