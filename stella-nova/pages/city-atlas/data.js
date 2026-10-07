// data.js — load and decode one city file (data/<id>.bin). No DOM, no GPU,
// so worker.js and tests.mjs use it as well.
//
// A city file is one zlib stream (tools/build_city.py writes it):
//   'CTA1'  u32 json length  json  zero pad to 8  section bytes ...
// json = { version, meta, sections: [{ name, dtype, shape, offset, length,
// delta }] }. offset counts from the first byte after the pad. delta:
//   'row'     prefix sum along each row of a 2D int16 raster
//   'stream'  prefix sum over the whole array, per component (shape[1])
// The page fetches the file and inflates it with DecompressionStream. It
// never sizes a buffer from Content-Length: the live server gzips the
// transfer and the header then gives the compressed size.
//
// grep: function inflate  function parseCity  function loadCity  function undelta
//       function buildingsOf

const DTYPES = { i8: Int8Array, u8: Uint8Array, i16: Int16Array, u16: Uint16Array, i32: Int32Array, u32: Uint32Array, f32: Float32Array };

export async function inflate(bytes) {
  if (typeof DecompressionStream === 'function') {
    const ds = new DecompressionStream('deflate');
    const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
    return new Uint8Array(await out.arrayBuffer());
  }
  // Node without DecompressionStream (old versions): zlib.
  const zlib = await import('node:zlib');
  return new Uint8Array(zlib.inflateSync(bytes));
}

function undelta(a, mode, shape) {
  if (mode === 'row') {
    const w = shape[shape.length - 1];
    for (let r = 0; r < a.length / w; r++) {
      const o = r * w;
      for (let i = 1; i < w; i++) a[o + i] = a[o + i] + a[o + i - 1];
    }
  } else if (mode === 'stream') {
    const c = shape.length > 1 ? shape[1] : 1;
    for (let i = c; i < a.length; i++) a[i] = a[i] + a[i - c];
  }
  return a;
}

// raw: the inflated bytes (Uint8Array). Returns { meta, arrays }.
export function parseCity(raw) {
  const u8 = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
  if (magic !== 'CTA1') throw new Error(`city file: bad magic ${magic}`);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const jlen = dv.getUint32(4, true);
  const head = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + jlen)));
  const start = Math.ceil((8 + jlen) / 8) * 8;
  const arrays = {};
  for (const s of head.sections) {
    const T = DTYPES[s.dtype];
    if (!T) throw new Error(`city file: dtype ${s.dtype}`);
    const off = start + s.offset;
    if (off + s.length > u8.byteLength) throw new Error(`city file: section ${s.name} past the end`);
    // copy, so the array owns an aligned buffer it can transfer
    const a = new T(u8.slice(off, off + s.length).buffer);
    arrays[s.name] = s.delta ? undelta(a, s.delta, s.shape) : a;
    arrays[s.name].shape = s.shape;
  }
  return { meta: head.meta, version: head.version, arrays };
}

export async function loadCity(url, fetchFn = fetch) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return parseCity(await inflate(bytes));
}

// The buildings as plain arrays: per building height, base, use, rings.
//   h, hmin   m          base   m (lowest ground under the footprint)
//   kind      use class (low 4 bits) + 128 when the height is estimated
//   rings     ring count per building; ringLen: vertices per ring
//   xy        0.5 m units, all rings in order; tri: roof triangles, local
//             vertex index per building (over its rings in order)
export function buildingsOf(c) {
  const A = c.arrays;
  const n = A.b_h ? A.b_h.length : 0;
  return {
    n,
    h: A.b_h, hmin: A.b_hmin, base: A.b_base, kind: A.b_kind,
    rings: A.b_rings, ringLen: A.b_ringlen, ntri: A.b_ntri,
    xy: A.b_xy, tri: A.b_tri,
  };
}
