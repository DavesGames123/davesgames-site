// ============================================================================
//  RETRO SHELF  ·  unzip.js — read ZIP archives in the browser and in node
// ----------------------------------------------------------------------------
//  The page keeps each freeware game as the archive that its rights holder
//  released. When a person presses Play, the player page unpacks the
//  archive in memory with these functions. Nothing is written to disk.
//
//  Supports: stored (0) and deflate (8) entries, archives with a stub in
//  front (a self-extracting .exe, for example the DOOM 1.9 installer), and
//  the 32-bit format (no ZIP64). Deflate uses DecompressionStream
//  ('deflate-raw'), which browsers and node 18+ have.
//
//  grep -n targets
//    "export function zipList"   "export async function zipRead"
//    "export async function zipAll"   "export async function fetchBytes"
//    "export async function sha256Hex"   "function findEnd"
// ============================================================================

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const dec = new TextDecoder('latin1');

// The end-of-central-directory record: the last "PK\5\6" with a comment
// length that reaches the end of the bytes.
function findEnd(b) {
  const lo = Math.max(0, b.length - 22 - 65535);
  for (let i = b.length - 22; i >= lo; i--) {
    if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 5 && b[i + 3] === 6 && i + 22 + u16(b, i + 20) === b.length) return i;
  }
  throw new Error('not a ZIP archive (no end record)');
}

/** List the entries: [{ name, method, size, csize, data }] (data = offset of the packed bytes). */
export function zipList(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const e = findEnd(b);
  const count = u16(b, e + 10), cdSize = u32(b, e + 12), cdOff = u32(b, e + 16);
  // A stub in front of the archive moves every offset by the same amount.
  const shift = e - cdSize - cdOff;
  const out = [];
  let p = cdOff + shift;
  for (let i = 0; i < count; i++) {
    if (u32(b, p) !== 0x02014b50) throw new Error('bad central directory entry ' + i);
    const method = u16(b, p + 10), csize = u32(b, p + 20), size = u32(b, p + 24);
    const nl = u16(b, p + 28), xl = u16(b, p + 30), cl = u16(b, p + 32);
    const local = u32(b, p + 42) + shift;
    const name = dec.decode(b.subarray(p + 46, p + 46 + nl));
    if (u32(b, local) !== 0x04034b50) throw new Error('bad local header for ' + name);
    const data = local + 30 + u16(b, local + 26) + u16(b, local + 28);
    if (!name.endsWith('/')) out.push({ name, method, size, csize, data });
    p += 46 + nl + xl + cl;
  }
  return out;
}

async function inflateRaw(src) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([src]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The bytes of one entry from zipList. */
export async function zipRead(bytes, entry) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const src = b.subarray(entry.data, entry.data + entry.csize);
  let out;
  if (entry.method === 0) out = src.slice();
  else if (entry.method === 8) out = await inflateRaw(src);
  else throw new Error('ZIP method ' + entry.method + ' is not supported (' + entry.name + ')');
  if (out.length !== entry.size) throw new Error('size of ' + entry.name + ' is ' + out.length + ', not ' + entry.size);
  return out;
}

/** Every file of the archive: Map name -> bytes. */
export async function zipAll(bytes) {
  const m = new Map();
  for (const e of zipList(bytes)) m.set(e.name, await zipRead(bytes, e));
  return m;
}

/** sha256 of bytes as hex (Web Crypto, browser and node). */
export async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Fetch a file as bytes. The live site can send it gzip-encoded, so
 * content-length can be the packed size: the chunks are joined at their
 * real length, and content-length only drives the progress (0..1, clamped).
 */
export async function fetchBytes(url, onProgress) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
  const total = +r.headers.get('content-length') || 0;
  if (!r.body || !r.body.getReader) return new Uint8Array(await r.arrayBuffer());
  const rd = r.body.getReader(), parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    parts.push(value); n += value.length;
    if (onProgress && total) onProgress(Math.min(1, n / total));
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  if (onProgress) onProgress(1);
  return out;
}
