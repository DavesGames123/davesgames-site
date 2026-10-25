// Neuroglancer precomputed reader (image volumes, uint8).
//
// Unsharded: one object per chunk, named x0-x1_y0-y1_z0-z1 in voxels
// (voxel_offset included). Sharded v1 ("neuroglancer_uint64_sharded_v1"):
//   1. chunk id = compressed morton code of the chunk grid position.
//   2. h = hash(id >> preshift_bits), identity or murmurhash3_x86_128.
//   3. minishard = h & (2^minishard_bits - 1),
//      shard = (h >> minishard_bits) & (2^shard_bits - 1).
//   4. <key>/<shard hex, ceil(shard_bits/4) digits>.shard.
//   5. Shard index: 2^minishard_bits pairs of uint64 [start, end), bytes
//      after the shard index, of each minishard index.
//   6. Minishard index (raw or gzip): 3n uint64 = delta chunk ids,
//      delta offsets (from the end of the previous chunk), sizes.
//   7. Chunk bytes (raw or gzip data_encoding), then the scale encoding.
// Edge chunks have the clipped shape. Missing shards or chunks give zeros.

import { murmurHash64 } from './hash.js';
import { gunzip } from './codecs.js';

export function gridShape(scale) {
  return [0, 1, 2].map((d) => Math.ceil(scale.size[d] / scale.chunk[d]));
}

export function chunkId(grid, c) {
  const bits = grid.map((g) => Math.ceil(Math.log2(Math.max(g, 1))));
  const maxBits = Math.max(...bits);
  let id = 0n, j = 0n;
  for (let i = 0; i < maxBits; i++) {
    for (let d = 0; d < 3; d++) {
      if (i < bits[d]) {
        if ((BigInt(c[d]) >> BigInt(i)) & 1n) id |= 1n << j;
        j++;
      }
    }
  }
  return id;
}

export function shardOf(sharding, id) {
  const pre = id >> BigInt(sharding.preshift_bits || 0);
  const h = sharding.hash === 'murmurhash3_x86_128' ? murmurHash64(pre) : pre;
  const mb = BigInt(sharding.minishard_bits || 0), sb = BigInt(sharding.shard_bits || 0);
  const minishard = Number(h & ((1n << mb) - 1n));
  const shard = Number((h >> mb) & ((1n << sb) - 1n));
  return { shard, minishard };
}

export function shardName(sharding, shard) {
  const digits = Math.ceil((sharding.shard_bits || 0) / 4);
  return shard.toString(16).padStart(digits, '0') + '.shard';
}

export function parseInfo(info, record = {}) {
  if (!info || !Array.isArray(info.scales)) throw new Error('em-explorer DATA: not a precomputed info file');
  if (info.type && info.type !== 'image') throw new Error('em-explorer DATA: precomputed type ' + info.type + ' is not an image');
  if (info.data_type !== 'uint8') throw new Error('em-explorer DATA: data_type ' + info.data_type + ' is not supported');
  let scales = info.scales.map((s) => ({
    key: s.key,
    size: s.size.slice(0, 3),
    resolution: s.resolution.slice(0, 3),
    chunk: s.chunk_sizes[0].slice(0, 3),
    encoding: s.encoding,
    voxelOffset: (s.voxel_offset || [0, 0, 0]).slice(0, 3),
    sharding: s.sharding || null,
  }));
  if (record.maxScales) scales = scales.slice(0, record.maxScales);
  for (const s of scales) {
    if (s.encoding !== 'raw' && s.encoding !== 'jpeg') {
      throw new Error('em-explorer DATA: encoding ' + s.encoding + ' is not supported');
    }
    if (s.sharding && s.sharding['@type'] && s.sharding['@type'] !== 'neuroglancer_uint64_sharded_v1') {
      throw new Error('em-explorer DATA: sharding ' + s.sharding['@type'] + ' is not supported');
    }
  }
  return scales;
}

function readU64(dv, off) {
  return dv.getBigUint64(off, true);
}

export function parseMinishardIndex(bytes) {
  const n = bytes.byteLength / 24;
  if (!Number.isInteger(n)) throw new Error('em-explorer DATA: bad minishard index length ' + bytes.byteLength);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ids = new BigUint64Array(n);
  const offsets = new Float64Array(n), sizes = new Float64Array(n);
  let id = 0n, end = 0;
  for (let i = 0; i < n; i++) {
    id += readU64(dv, i * 8);
    ids[i] = id;
    const size = Number(readU64(dv, (2 * n + i) * 8));
    const start = end + Number(readU64(dv, (n + i) * 8));
    offsets[i] = start; sizes[i] = size;
    end = start + size;
  }
  return { ids, offsets, sizes };
}

function findChunk(mini, id) {
  const { ids } = mini;
  let lo = 0, hi = ids.length - 1;
  if (hi >= 0 && ids[hi] >= ids[0]) {
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ids[mid] === id) return mid;
      if (ids[mid] < id) lo = mid + 1; else hi = mid - 1;
    }
  }
  for (let i = 0; i < ids.length; i++) if (ids[i] === id) return i;
  return -1;
}

export function clippedShape(scale, c) {
  return [0, 1, 2].map((d) => Math.min(scale.chunk[d], scale.size[d] - c[d] * scale.chunk[d]));
}

// io: { fetchBytes(url, { range, signal }) -> Uint8Array | null (404),
//       decodeJpeg(bytes) -> { data, width, height }, indexCache }
export class PrecomputedSource {
  constructor(store, scales, io) {
    this.store = store;
    this.scales = scales;
    this.io = io;
  }

  async readChunk(si, c, signal) {
    const s = this.scales[si];
    const shape = clippedShape(s, c);
    if (shape.some((n) => n <= 0)) throw new Error('em-explorer DATA: chunk out of range');
    const raw = s.sharding
      ? await this.readShardedChunk(si, c, signal)
      : await this.readUnshardedChunk(si, c, shape, signal);
    if (!raw) return { data: new Uint8Array(shape[0] * shape[1] * shape[2]), shape, empty: true };
    return this.decode(s, raw, shape);
  }

  async readUnshardedChunk(si, c, shape, signal) {
    const s = this.scales[si];
    const r = [0, 1, 2].map((d) => {
      const a = s.voxelOffset[d] + c[d] * s.chunk[d];
      return a + '-' + (a + shape[d]);
    });
    return this.io.fetchBytes(this.store.url(s.key + '/' + r.join('_')), { signal });
  }

  shardIndexBytes(sh) { return 16 * 2 ** (sh.minishard_bits || 0); }

  // Shared index fetches do not take the caller signal: other chunks need them too.
  cachedIndex(key, load) {
    const cache = this.io.indexCache;
    const hit = cache.lru.get(key);
    if (hit !== undefined) return Promise.resolve(hit);
    let p = cache.pending.get(key);
    if (!p) {
      p = load().then((v) => {
        cache.pending.delete(key);
        cache.lru.set(key, v, v ? (v.byteLength || v.ids.length * 24 + 64) : 64);
        return v;
      }, (err) => { cache.pending.delete(key); throw err; });
      cache.pending.set(key, p);
    }
    return p;
  }

  async readShardedChunk(si, c, signal) {
    const s = this.scales[si];
    const sh = s.sharding;
    const id = chunkId(gridShape(s), c);
    const { shard, minishard } = shardOf(sh, id);
    const url = this.store.url(s.key + '/' + shardName(sh, shard));
    const indexEnd = this.shardIndexBytes(sh);
    const shardIndex = await this.cachedIndex('s|' + url, () =>
      this.io.fetchBytes(url, { range: [0, indexEnd] }));
    if (!shardIndex) return null;
    const dv = new DataView(shardIndex.buffer, shardIndex.byteOffset, shardIndex.byteLength);
    const start = Number(readU64(dv, minishard * 16));
    const end = Number(readU64(dv, minishard * 16 + 8));
    if (end <= start) return null;
    const mini = await this.cachedIndex('m|' + url + '|' + minishard, async () => {
      let b = await this.io.fetchBytes(url, { range: [indexEnd + start, indexEnd + end] });
      if (!b) return null;
      if (sh.minishard_index_encoding === 'gzip') b = await gunzip(b);
      return parseMinishardIndex(b);
    });
    if (!mini) return null;
    const i = findChunk(mini, id);
    if (i < 0) return null;
    const off = indexEnd + mini.offsets[i];
    let b = await this.io.fetchBytes(url, { range: [off, off + mini.sizes[i]], signal });
    if (!b) return null;
    if (sh.data_encoding === 'gzip') b = await gunzip(b);
    return b;
  }

  async decode(s, bytes, shape) {
    const want = shape[0] * shape[1] * shape[2];
    if (s.encoding === 'raw') {
      if (bytes.length === want) return { data: bytes, shape };
      const full = s.chunk[0] * s.chunk[1] * s.chunk[2];
      if (bytes.length === full) return { data: bytes, shape: s.chunk.slice() };
      throw new Error('em-explorer DATA: raw chunk has ' + bytes.length + ' bytes, expected ' + want);
    }
    if (!this.io.decodeJpeg) throw new Error('em-explorer DATA: no JPEG decoder here');
    const img = await this.io.decodeJpeg(bytes);
    if (img.width === shape[0] && img.height === shape[1] * shape[2]) return { data: img.data, shape };
    if (img.width === s.chunk[0] && img.height === s.chunk[1] * s.chunk[2]) {
      return { data: img.data, shape: s.chunk.slice() };
    }
    if (img.width * img.height === want) return { data: img.data, shape };
    throw new Error('em-explorer DATA: JPEG chunk is ' + img.width + 'x' + img.height +
      ', expected ' + shape[0] + 'x' + shape[1] * shape[2]);
  }
}
