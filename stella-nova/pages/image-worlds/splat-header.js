// ============================================================================
//  IMAGE WORLDS  ·  splat-header.js — read the header of a Gaussian splat file
// ────────────────────────────────────────────────────────────────────────────
//  DOM-free. The page uses it to name a file before Spark decodes it (format,
//  splat count, SH degree), to reject a file that is not a splat, and to
//  show the count on the world card. tests.mjs runs it in Node.
//
//  FORMATS
//    spz     gzip stream. Inside: a 16-byte header, little endian:
//              u32 magic 0x5053474e ("NGSP"), u32 version, u32 numPoints,
//              u8 shDegree, u8 fractionalBits, u8 flags (bit 0 antialiased),
//              u8 reserved. image-blaster and World Labs write this format.
//    ply     ASCII header to "end_header". A splat PLY has the 3DGS vertex
//            properties (f_dc_0, opacity, scale_0, rot_0). The SH degree comes
//            from the f_rest_* count: 3 ((d + 1)^2 - 1) of them.
//    splat   no header: 32 bytes per splat (antimatter15 layout).
//    ksplat  4096-byte header: u8 major, u8 minor, u32 maxSectionCount at 4,
//            u32 sectionCount at 8, u32 maxSplatCount at 12, u32 splatCount
//            at 16, u16 compressionLevel at 20 (mkkellogg layout).
//    rad     Spark's LoD format: magic "RAD0" only, no count here.
//
//  EXPORTS
//    sniffFormat(head, name) ... 'spz' | 'ply' | 'splat' | 'ksplat' | 'rad' | null
//    parseSplatHeader(head, totalSize, name)
//                         ...... async -> { format, count, version, shDegree,
//                                fractionalBits, antialiased, warn }
//                                head: Uint8Array of the first bytes (64 KiB
//                                is enough for every format here).
//    HEAD_BYTES ............... how many bytes the page reads for the header
// ============================================================================
export const HEAD_BYTES = 65536;
const SPZ_MAGIC = 0x5053474e, RAD_MAGIC = 0x30444152;

const ext = name => {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || '').split(/[?#]/)[0]);
  return m ? m[1].toLowerCase() : '';
};

export function sniffFormat(head, name = '') {
  if (head && head.length >= 4) {
    const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
    if (head[0] === 0x1f && head[1] === 0x8b) return 'spz';
    if (head[0] === 0x70 && head[1] === 0x6c && head[2] === 0x79) return 'ply';
    if (dv.getUint32(0, true) === RAD_MAGIC) return 'rad';
  }
  const e = ext(name);
  if (e === 'splat' || e === 'ksplat') return e;
  return null;
}

// Inflate only as much of a gzip stream as the caller needs. The input is a
// part of the file, so the inflater would fail at its end: stop reading
// once there are enough bytes, and ignore the error that follows.
async function gunzipHead(head, need) {
  if (typeof DecompressionStream === 'undefined') throw new Error('this browser cannot inflate gzip (no DecompressionStream)');
  const ds = new DecompressionStream('gzip');
  const w = ds.writable.getWriter(), r = ds.readable.getReader();
  // Close at once: the inflater then gives what it can and fails at the
  // cut. Without the close a short input waits for more bytes forever.
  w.write(head).catch(() => {}); w.close().catch(() => {});
  const parts = []; let n = 0;
  try {
    while (n < need) {
      const { value, done } = await r.read();
      if (done) break;
      parts.push(value); n += value.length;
    }
  } catch (e) {
    if (n < need) throw new Error('the gzip stream ends before the SPZ header');
  }
  r.cancel().catch(() => {}); w.abort().catch(() => {});
  const out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function parsePly(head) {
  const text = new TextDecoder('latin1').decode(head.subarray(0, Math.min(head.length, 16384)));
  const end = text.indexOf('end_header');
  if (end < 0) throw new Error('PLY header has no end_header in the first 16 KiB');
  const lines = text.slice(0, end).split(/\r?\n/);
  let count = 0, inVertex = false, format = '';
  const props = [];
  for (const ln of lines) {
    const t = ln.trim().split(/\s+/);
    if (t[0] === 'format') format = t[1];
    else if (t[0] === 'element') { inVertex = t[1] === 'vertex'; if (inVertex) count = +t[2]; }
    else if (t[0] === 'property' && inVertex) props.push(t[t.length - 1]);
  }
  const need = ['x', 'y', 'z', 'f_dc_0', 'opacity', 'scale_0', 'rot_0'];
  const missing = need.filter(p => !props.includes(p));
  const rest = props.filter(p => /^f_rest_\d+$/.test(p)).length;
  const sh = Math.round(Math.sqrt(rest / 3 + 1)) - 1;
  return {
    format: 'ply', count, version: format, shDegree: rest ? sh : 0,
    warn: missing.length ? 'not a Gaussian splat PLY (no ' + missing.join(', ') + ')' : (format !== 'binary_little_endian' ? 'PLY format ' + format : ''),
  };
}

export async function parseSplatHeader(head, totalSize = head.length, name = '') {
  const format = sniffFormat(head, name);
  if (!format) throw new Error('not a splat file: ' + (name || 'unnamed') + ' (expected .spz, .ply, .splat or .ksplat)');
  if (format === 'spz') {
    const h = await gunzipHead(head, 16);
    if (h.length < 16) throw new Error('SPZ header is short (' + h.length + ' bytes)');
    const dv = new DataView(h.buffer, h.byteOffset, 16);
    if (dv.getUint32(0, true) !== SPZ_MAGIC) throw new Error('gzip stream is not SPZ (bad magic)');
    const version = dv.getUint32(4, true), count = dv.getUint32(8, true);
    const shDegree = h[12], fractionalBits = h[13], flags = h[14];
    const warn = version < 1 || version > 4 ? 'SPZ version ' + version + ' is unknown' : shDegree > 3 ? 'SH degree ' + shDegree + ' > 3' : '';
    return { format, count, version, shDegree, fractionalBits, antialiased: !!(flags & 1), warn };
  }
  if (format === 'ply') return parsePly(head);
  if (format === 'splat') {
    const rem = totalSize % 32;
    return { format, count: Math.floor(totalSize / 32), version: 0, shDegree: 0, warn: rem ? 'size is not a multiple of 32 bytes' : '' };
  }
  if (format === 'ksplat') {
    if (head.length < 24) throw new Error('KSPLAT header is short');
    const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
    return { format, count: dv.getUint32(16, true), version: head[0] + '.' + head[1], shDegree: null, compression: dv.getUint16(20, true), warn: '' };
  }
  return { format, count: null, version: null, shDegree: null, warn: '' };
}
