// OME-Zarr v2 reader (3D, uint8).
//
// The group .zattrs holds multiscales[0]: axes (names) and datasets
// (path, scale and translation transforms, in nm). Each array .zarray
// holds shape, chunks, dtype, compressor, order and dimension_separator.
// Chunk key: <path>/<i0><sep><i1><sep><i2> in array axis order.
// Compressors: null, zstd, blosc (lz4, zstd, zlib), gzip, zlib.
// The reader returns chunks with x fastest, shape [x, y, z] = the full
// chunk (zarr pads edge chunks). A missing chunk gives the fill value.

import { zstd, decodeBlosc, gunzip, inflate } from './codecs.js';

const AXES = { x: 0, y: 1, z: 2 };

function spatialOrder(axes, ndim) {
  if (ndim !== 3) throw new Error('em-explorer DATA: only 3D zarr arrays are supported (ndim ' + ndim + ')');
  if (!axes) return [2, 1, 0];
  const names = axes.map((a) => (typeof a === 'string' ? a : a.name).toLowerCase());
  const order = names.map((n) => AXES[n]);
  if (order.some((o) => o === undefined) || new Set(order).size !== 3) {
    throw new Error('em-explorer DATA: zarr axes ' + names.join(',') + ' are not x, y, z');
  }
  return order;
}

function transformsOf(ds, order) {
  const res = [1, 1, 1], tr = [0, 0, 0];
  for (const t of ds.coordinateTransformations || []) {
    if (t.type === 'scale') t.scale.forEach((v, i) => { res[order[i]] = v; });
    if (t.type === 'translation') t.translation.forEach((v, i) => { tr[order[i]] = v; });
  }
  return { res, tr };
}

export async function openZarr(store, io, record = {}) {
  const attrs = await io.fetchJson(store.url('.zattrs'), { optional: true });
  const ms = attrs && attrs.multiscales && attrs.multiscales[0];
  let entries;
  if (ms) {
    const ndim = (ms.axes || ['z', 'y', 'x']).length;
    const order = spatialOrder(ms.axes, ndim);
    entries = ms.datasets.map((ds) => ({ path: ds.path, order, ...transformsOf(ds, order) }));
  } else {
    entries = [{ path: '', order: [2, 1, 0], res: [1, 1, 1], tr: [0, 0, 0] }];
  }
  if (record.maxScales) entries = entries.slice(0, record.maxScales);
  const arrays = await Promise.all(entries.map((e) =>
    io.fetchJson(store.url((e.path ? e.path + '/' : '') + '.zarray'))));
  const scales = entries.map((e, i) => {
    const a = arrays[i];
    if (a.zarr_format !== 2) throw new Error('em-explorer DATA: zarr_format ' + a.zarr_format + ' is not supported');
    if (!/^[|<>]?u1$/.test(a.dtype)) throw new Error('em-explorer DATA: zarr dtype ' + a.dtype + ' is not supported');
    const order = e.order;
    if (a.shape.length !== 3) throw new Error('em-explorer DATA: only 3D zarr arrays are supported');
    const size = [0, 0, 0], chunk = [0, 0, 0];
    a.shape.forEach((v, j) => { size[order[j]] = v; });
    a.chunks.forEach((v, j) => { chunk[order[j]] = v; });
    const comp = a.compressor;
    const encoding = comp ? (comp.id === 'blosc' ? 'blosc-' + (comp.cname || 'lz4') : comp.id) : 'raw';
    return {
      key: e.path,
      size, chunk,
      resolution: e.res,
      encoding,
      voxelOffset: e.tr.map((t, d) => t / e.res[d]),
      zarr: {
        order, compressor: comp, fill: a.fill_value || 0,
        sep: a.dimension_separator || '.', memOrder: a.order || 'C',
        chunksArr: a.chunks.slice(), filters: a.filters,
      },
    };
  });
  for (const s of scales) {
    if (s.zarr.filters && s.zarr.filters.length) throw new Error('em-explorer DATA: zarr filters are not supported');
  }
  return new ZarrSource(store, scales, io);
}

async function decompress(comp, bytes) {
  if (!comp) return bytes;
  switch (comp.id) {
    case 'zstd': return zstd(bytes);
    case 'blosc': return decodeBlosc(bytes);
    case 'gzip': return gunzip(bytes);
    case 'zlib': return inflate(bytes);
    default: throw new Error('em-explorer DATA: zarr compressor ' + comp.id + ' is not supported');
  }
}

export class ZarrSource {
  constructor(store, scales, io) {
    this.store = store;
    this.scales = scales;
    this.io = io;
  }

  chunkPath(s, c) {
    const z = s.zarr;
    const idx = z.order.map((d) => c[d]);
    return (s.key ? s.key + '/' : '') + idx.join(z.sep);
  }

  async readChunk(si, c, signal) {
    const s = this.scales[si];
    const z = s.zarr;
    const shape = s.chunk.slice();
    const n = shape[0] * shape[1] * shape[2];
    const bytes = await this.io.fetchBytes(this.store.url(this.chunkPath(s, c)), { signal });
    if (!bytes) {
      const data = new Uint8Array(n);
      if (z.fill) data.fill(z.fill);
      return { data, shape, empty: true };
    }
    let data = await decompress(z.compressor, bytes);
    if (data.length < n) throw new Error('em-explorer DATA: zarr chunk has ' + data.length + ' bytes, expected ' + n);
    if (data.length > n) data = data.subarray(0, n);
    // Memory order of array axis j: C order makes the last axis fastest.
    const arrAxes = z.memOrder === 'F' ? z.order.slice() : z.order.slice().reverse();
    if (arrAxes[0] === 0 && arrAxes[1] === 1 && arrAxes[2] === 2) return { data, shape };
    return { data: toXFastest(data, shape, arrAxes), shape };
  }
}

// arrAxes: spatial axis per memory position, fastest first.
export function toXFastest(src, shape, arrAxes) {
  const stride = [0, 0, 0];
  let st = 1;
  for (const d of arrAxes) { stride[d] = st; st *= shape[d]; }
  const out = new Uint8Array(src.length);
  let o = 0;
  for (let z = 0; z < shape[2]; z++) {
    for (let y = 0; y < shape[1]; y++) {
      let i = y * stride[1] + z * stride[2];
      for (let x = 0; x < shape[0]; x++, i += stride[0]) out[o++] = src[i];
    }
  }
  return out;
}
