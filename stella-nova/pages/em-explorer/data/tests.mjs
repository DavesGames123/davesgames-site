// em-explorer DATA tests.
//
//   node stella-nova/pages/em-explorer/data/tests.mjs          offline
//   node stella-nova/pages/em-explorer/data/tests.mjs --live   + real chunks
//   ... --live --png <dir>   also writes one PNG slice per dataset
//
// Offline tests build synthetic sharded, unsharded and OME-Zarr volumes in
// memory and serve them through a fake fetch with Range support.
// Live tests fetch a handful of real chunks from each dataset (a few MB in
// all). JPEG chunks decode through python3 + PIL here, because node has no
// image decoder; the browser path (createImageBitmap) cannot run in node.

import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { murmur3_x86_128, murmurHash64 } from './hash.js';
import { chunkId, shardOf, shardName, gridShape, parseMinishardIndex } from './precomputed.js';
import { lz4Block, decodeBlosc, gunzip, zstd } from './codecs.js';
import { ByteLRU } from './cache.js';
import { Scheduler } from './scheduler.js';
import { resolveUrl } from './urls.js';
import { sliceChunks } from './slice.js';
import { openVolume, DATA_API_VERSION } from './index.js';

const argv = process.argv.slice(2);
const LIVE = argv.includes('--live');
const PNG_DIR = argv.includes('--png') ? argv[argv.indexOf('--png') + 1] : null;

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; } else { fail++; console.log('FAIL', name, extra !== undefined ? extra : ''); }
}
function eq(a, b, name) { ok(a === b, name, `got ${a} want ${b}`); }
async function section(name, fn) {
  const before = fail;
  const t = performance.now();
  try { await fn(); } catch (e) { fail++; console.log('FAIL', name, 'threw', e && e.stack || e); }
  console.log((fail === before ? 'ok  ' : 'BAD ') + name + ' (' + (performance.now() - t).toFixed(0) + ' ms)');
}

// ---------------------------------------------------------------- helpers

function u64le(values) {
  const b = new Uint8Array(values.length * 8);
  const dv = new DataView(b.buffer);
  values.forEach((v, i) => dv.setBigUint64(i * 8, BigInt(v), true));
  return b;
}
function concat(parts) {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const voxel = (x, y, z) => (x * 7 + y * 13 + z * 29 + ((x * y) >> 3)) & 255;

function fakeFetch(files, log) {
  return async (url, init = {}) => {
    if (log) log.push(url);
    const body = files.get(url);
    if (!body) return new Response(null, { status: 404 });
    const r = init.headers && init.headers.Range;
    if (r) {
      const m = /^bytes=(\d+)-(\d+)$/.exec(r);
      const a = +m[1], b = Math.min(+m[2] + 1, body.length);
      return new Response(body.slice(a, b), { status: 206 });
    }
    return new Response(body.slice(), { status: 200 });
  };
}

// Greedy LZ4 block encoder, test only.
function lz4Encode(src) {
  const out = [];
  const table = new Map();
  let anchor = 0, i = 0;
  const lenBytes = (n) => { while (n >= 255) { out.push(255); n -= 255; } out.push(n); };
  const emit = (litEnd, off, ml) => {
    const lit = litEnd - anchor;
    const tok = (Math.min(lit, 15) << 4) | (ml ? Math.min(ml - 4, 15) : 0);
    out.push(tok);
    if (lit >= 15) lenBytes(lit - 15);
    for (let k = anchor; k < litEnd; k++) out.push(src[k]);
    if (ml) {
      out.push(off & 255, off >> 8);
      if (ml - 4 >= 15) lenBytes(ml - 4 - 15);
    }
  };
  while (i + 12 < src.length) {
    const key = src[i] | (src[i + 1] << 8) | (src[i + 2] << 16) | (src[i + 3] << 24);
    const cand = table.get(key);
    table.set(key, i);
    if (cand !== undefined && i - cand < 65536 && i - cand > 0) {
      let ml = 0;
      while (i + ml < src.length - 5 && src[cand + ml] === src[i + ml]) ml++;
      if (ml >= 4) { emit(i, i - cand, ml); i += ml; anchor = i; continue; }
    }
    i++;
  }
  emit(src.length, 0, 0);
  return Uint8Array.from(out);
}

function bloscFrame(data, { typesize = 1, shuffle = false, blocksize = 4096, lz4 = true } = {}) {
  const nbytes = data.length;
  const nblocks = Math.ceil(nbytes / blocksize);
  const blocks = [];
  for (let j = 0; j < nblocks; j++) {
    let blk = data.subarray(j * blocksize, Math.min(nbytes, (j + 1) * blocksize));
    const last = j === nblocks - 1 && nbytes % blocksize;
    if (shuffle && typesize > 1) {
      const n = Math.floor(blk.length / typesize);
      const t = new Uint8Array(blk.length);
      for (let s = 0; s < typesize; s++) for (let i = 0; i < n; i++) t[s * n + i] = blk[i * typesize + s];
      for (let i = n * typesize; i < blk.length; i++) t[i] = blk[i];
      blk = t;
    }
    const split = typesize <= 16 && blocksize / typesize >= 128 && !last;
    const ns = split ? typesize : 1;
    const ne = blk.length / ns;
    const parts = [];
    for (let s = 0; s < ns; s++) {
      const piece = blk.subarray(s * ne, (s + 1) * ne);
      const c = lz4 ? lz4Encode(piece) : piece;
      const useRaw = !lz4 || c.length >= ne;
      const body = useRaw ? piece : c;
      const hdr = new Uint8Array(4); new DataView(hdr.buffer).setInt32(0, body.length, true);
      parts.push(hdr, body);
    }
    blocks.push(concat(parts));
  }
  const head = new Uint8Array(16 + 4 * nblocks);
  const dv = new DataView(head.buffer);
  head[0] = 2; head[1] = 1; head[2] = (1 << 5) | (shuffle ? 1 : 0); head[3] = typesize;
  dv.setUint32(4, nbytes, true); dv.setUint32(8, blocksize, true);
  let off = head.length;
  blocks.forEach((b, j) => { dv.setUint32(16 + 4 * j, off, true); off += b.length; });
  dv.setUint32(12, off, true);
  return concat([head, ...blocks]);
}

// Builds a sharded precomputed scale into files (Map url -> bytes).
function buildSharded(files, base, scale, sharding, chunkBytes) {
  const grid = gridShape(scale);
  const shards = new Map();
  for (let cz = 0; cz < grid[2]; cz++) for (let cy = 0; cy < grid[1]; cy++) for (let cx = 0; cx < grid[0]; cx++) {
    const c = [cx, cy, cz];
    if (cx === 1 && cy === 1 && cz === 0) continue; // one missing chunk
    const id = chunkId(grid, c);
    const { shard, minishard } = shardOf(sharding, id);
    if (!shards.has(shard)) shards.set(shard, new Map());
    const mm = shards.get(shard);
    if (!mm.has(minishard)) mm.set(minishard, []);
    let bytes = chunkBytes(c);
    if (sharding.data_encoding === 'gzip') bytes = new Uint8Array(zlib.gzipSync(bytes));
    mm.get(minishard).push({ id, bytes });
  }
  const nm = 2 ** sharding.minishard_bits;
  for (const [shard, mm] of shards) {
    const data = [], idx = [];
    let pos = 0;
    const minis = [];
    for (let m = 0; m < nm; m++) {
      const list = (mm.get(m) || []).sort((a, b) => (a.id < b.id ? -1 : 1));
      if (!list.length) { minis.push(null); continue; }
      const ids = [], offs = [], sizes = [];
      let prevId = 0n, prevEnd = 0;
      for (const e of list) {
        ids.push(e.id - prevId); prevId = e.id;
        offs.push(pos - prevEnd);
        sizes.push(e.bytes.length);
        data.push(e.bytes); pos += e.bytes.length; prevEnd = pos;
      }
      minis.push(u64le([...ids, ...offs, ...sizes]));
    }
    const shardIndex = [];
    for (let m = 0; m < nm; m++) {
      if (!minis[m]) { shardIndex.push(0, 0); continue; }
      let b = minis[m];
      if (sharding.minishard_index_encoding === 'gzip') b = new Uint8Array(zlib.gzipSync(b));
      idx.push(b);
      shardIndex.push(pos, pos + b.length);
      pos += b.length;
    }
    files.set(base + '/' + scale.key + '/' + shardName(sharding, shard),
      concat([u64le(shardIndex), ...data, ...idx]));
  }
}

function chunkRaw(scale, c) {
  const sh = [0, 1, 2].map((d) => Math.min(scale.chunk[d], scale.size[d] - c[d] * scale.chunk[d]));
  const out = new Uint8Array(sh[0] * sh[1] * sh[2]);
  let o = 0;
  for (let z = 0; z < sh[2]; z++) for (let y = 0; y < sh[1]; y++) for (let x = 0; x < sh[0]; x++) {
    out[o++] = voxel(c[0] * scale.chunk[0] + x, c[1] * scale.chunk[1] + y, c[2] * scale.chunk[2] + z);
  }
  return out;
}

const PLANE_UVN = { xy: [0, 1, 2], xz: [0, 2, 1], yz: [2, 1, 0] };
function checkSlice(r, scale, plane, index, rect, missing, name) {
  const [ua, va, na] = PLANE_UVN[plane];
  let bad = 0, first = null;
  for (let v = rect[1]; v < rect[3]; v++) for (let u = rect[0]; u < rect[2]; u++) {
    const p = [0, 0, 0]; p[ua] = u; p[va] = v; p[na] = index;
    const inside = p.every((q, d) => q >= 0 && q < scale.size[d]);
    let want = inside ? voxel(p[0], p[1], p[2]) : 0;
    if (inside && missing && missing(p)) want = 0;
    const got = r.data[(v - rect[1]) * (rect[2] - rect[0]) + (u - rect[0])];
    if (got !== want) { bad++; if (!first) first = { p, got, want }; }
  }
  ok(bad === 0 && r.width === rect[2] - rect[0] && r.height === rect[3] - rect[1],
    name, JSON.stringify({ bad, first, w: r.width, h: r.height }));
}

// ---------------------------------------------------------------- offline

await section('api: exports', async () => {
  eq(DATA_API_VERSION, 1, 'api version');
  eq(typeof openVolume, 'function', 'openVolume');
});

await section('murmur3_x86_128 SMHasher verification 0xB3ECE62A', async () => {
  const key = new Uint8Array(256), hashes = new Uint8Array(256 * 16);
  for (let i = 0; i < 256; i++) {
    key[i] = i;
    const h = murmur3_x86_128(key.subarray(0, i), 256 - i);
    const dv = new DataView(hashes.buffer, i * 16, 16);
    h.forEach((v, k) => dv.setUint32(k * 4, v, true));
  }
  const fin = murmur3_x86_128(hashes, 0)[0];
  eq(fin.toString(16), 'b3ece62a', 'verification value');
  ok(typeof murmurHash64(5n) === 'bigint', 'hash64 is a BigInt');
  ok(murmurHash64(0n) !== murmurHash64(1n), 'hash64 separates keys');
});

await section('compressed morton chunk id and shard names', async () => {
  eq(chunkId([4, 4, 4], [1, 0, 0]), 1n, 'x bit');
  eq(chunkId([4, 4, 4], [0, 1, 0]), 2n, 'y bit');
  eq(chunkId([4, 4, 4], [0, 0, 1]), 4n, 'z bit');
  eq(chunkId([4, 4, 4], [1, 1, 1]), 7n, 'xyz');
  eq(chunkId([4, 4, 4], [2, 0, 0]), 8n, 'second x bit');
  eq(chunkId([8, 2, 1], [5, 1, 0]), 11n, 'uneven grid drops spent axes');
  eq(chunkId([1, 1, 1], [0, 0, 0]), 0n, 'single chunk');
  eq(shardName({ shard_bits: 15 }, 0x1a), '001a.shard', 'shard name 15 bits');
  eq(shardName({ shard_bits: 0 }, 0), '0.shard', 'shard name 0 bits');
  eq(shardName({ shard_bits: 17 }, 0x1abcd), '1abcd.shard', 'shard name 17 bits (5 digits)');
  eq(shardName({ shard_bits: 17 }, 0xbcd), '00bcd.shard', 'shard name zero pad');
  const s = shardOf({ hash: 'identity', preshift_bits: 9, minishard_bits: 6, shard_bits: 15 }, ((5n << 6n) | 3n) << 9n | 77n);
  eq(s.minishard, 3, 'identity minishard'); eq(s.shard, 5, 'identity shard');
  const mi = parseMinishardIndex(u64le([4, 3, 10, 0, 7, 0, 5, 6, 9]));
  eq(mi.ids.join(','), '4,7,17', 'minishard ids delta');
  eq([...mi.offsets].join(','), '0,12,18', 'minishard offsets delta');
});

await section('codecs: lz4, blosc, gzip, zstd', async () => {
  const lz = Uint8Array.from([0x35, 97, 98, 99, 3, 0, 0x00]);
  const dst = new Uint8Array(12);
  eq(lz4Block(lz, dst), 12, 'lz4 length');
  eq(new TextDecoder().decode(dst), 'abcabcabcabc', 'lz4 overlap copy');
  const big = new Uint8Array(70000);
  for (let i = 0; i < big.length; i++) big[i] = voxel(i % 300, (i / 300) | 0, 3) & 0xf0;
  const enc = lz4Encode(big), back = new Uint8Array(big.length);
  eq(lz4Block(enc, back), big.length, 'lz4 roundtrip length');
  ok(Buffer.compare(Buffer.from(back), Buffer.from(big)) === 0, 'lz4 roundtrip bytes');
  ok(enc.length < big.length / 2, 'lz4 compresses', enc.length);
  for (const cfg of [{}, { blocksize: 1000 }, { typesize: 2, shuffle: true, blocksize: 4096 }, { lz4: false }]) {
    const fr = bloscFrame(big, cfg);
    const out = await decodeBlosc(fr);
    ok(out.length === big.length && Buffer.compare(Buffer.from(out), Buffer.from(big)) === 0, 'blosc ' + JSON.stringify(cfg));
  }
  const mem = new Uint8Array(16 + 5); mem[0] = 2; mem[2] = 0x02; mem[3] = 1;
  new DataView(mem.buffer).setUint32(4, 5, true); mem.set([1, 2, 3, 4, 5], 16);
  eq((await decodeBlosc(mem)).join(','), '1,2,3,4,5', 'blosc memcpyed');
  eq(Buffer.from(await gunzip(new Uint8Array(zlib.gzipSync(big)))).compare(Buffer.from(big)), 0, 'gunzip');
  eq(Buffer.from(zstd(new Uint8Array(zlib.zstdCompressSync(big)))).compare(Buffer.from(big)), 0, 'zstd');
});

await section('cache: byte LRU', async () => {
  const c = new ByteLRU(100);
  c.set('a', 1, 40); c.set('b', 2, 40); c.get('a'); c.set('c', 3, 40);
  ok(c.has('a') && !c.has('b') && c.has('c'), 'evicts least recent', [...c.map.keys()]);
  eq(c.bytes, 80, 'byte total');
  c.set('huge', 4, 500);
  ok(c.has('huge') && c.size === 1, 'newest entry stays over cap');
  c.setCap(10); eq(c.size, 1, 'setCap keeps newest');
});

await section('scheduler: limit, priority, dedupe, cancel', async () => {
  const s = new Scheduler({ maxInFlight: 2 });
  const order = [];
  const gates = new Map();
  const job = (k) => (signal) => new Promise((res, rej) => {
    order.push(k);
    gates.set(k, res);
    signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted job ' + k), { name: 'AbortError' })));
  });
  const p1 = s.run('a', job('a'), { priority: 5 });
  const p2 = s.run('b', job('b'), { priority: 5 });
  const ac = new AbortController();
  const p3 = s.run('c', job('c'), { priority: 9, signal: ac.signal });
  const p4 = s.run('d', job('d'), { priority: 1 });
  const p4b = s.run('d', job('d-dup'), { priority: 7 });
  eq(s.running, 2, 'two in flight'); eq(s.queued, 2, 'two queued');
  ac.abort();
  let r3; try { await p3; } catch (e) { r3 = e.name; }
  eq(r3, 'AbortError', 'queued cancel rejects');
  eq(s.queued, 1, 'cancelled task left the queue');
  gates.get('a')('A');
  eq(await p1, 'A', 'resolve a');
  await new Promise((r) => setTimeout(r, 0));
  eq(order.join(''), 'abd', 'priority picks d, c never ran');
  gates.get('d')('D');
  ok((await p4) === 'D' && (await p4b) === 'D', 'dedupe shares result');
  const ac2 = new AbortController();
  const p5 = s.run('e', job('e'), { signal: ac2.signal });
  await new Promise((r) => setTimeout(r, 0));
  ac2.abort();
  let r5; try { await p5; } catch (e) { r5 = e.name; }
  eq(r5, 'AbortError', 'running cancel rejects');
  gates.get('b')('B'); await p2;
  await new Promise((r) => setTimeout(r, 0));
  eq(s.running, 0, 'all slots free after abort');
  // Focus distance orders tasks without priority.
  const s2 = new Scheduler({ maxInFlight: 1 });
  const seen = [];
  const blocker = s2.run('x', () => new Promise((r) => setTimeout(r, 5)), {});
  s2.setFocus(1, { x: 0, y: 0, z: 0 });
  const far = s2.run('far', async () => seen.push('far'), { group: 1, centre: [1000, 0, 0] });
  const near = s2.run('near', async () => seen.push('near'), { group: 1, centre: [10, 0, 0] });
  await Promise.all([blocker, far, near]);
  eq(seen.join(','), 'near,far', 'focus distance order');
});

await section('urls: gs:// via JSON API, s3://', async () => {
  eq(resolveUrl('gs://h01-release/data/20210601/4nm_raw').url('info'),
    'https://storage.googleapis.com/storage/v1/b/h01-release/o/data%2F20210601%2F4nm_raw%2Finfo?alt=media', 'gs');
  eq(resolveUrl('s3://bucket/a/b/').url('info'), 'https://bucket.s3.amazonaws.com/a/b/info', 's3');
  eq(resolveUrl('precomputed://https://x.org/v/').url('8_8_40/0.shard'), 'https://x.org/v/8_8_40/0.shard', 'https strip');
});

await section('slice: chunk list order', async () => {
  const sc = { size: [100, 100, 100], chunk: [32, 32, 32] };
  const cs = sliceChunks(sc, 'xy', 40, [0, 0, 100, 100]);
  eq(cs.length, 16, '4x4 chunks');
  ok(cs[0][0] >= 1 && cs[0][0] <= 2 && cs[0][1] >= 1 && cs[0][1] <= 2, 'centre chunk first', cs[0]);
  eq(sliceChunks(sc, 'yz', 200, [0, 0, 10, 10]).length, 0, 'index outside');
});

const BASE = 'https://test.invalid/vol';
for (const hash of ['identity', 'murmurhash3_x86_128']) {
  await section('precomputed sharded v1 (' + hash + ', gzip data + index, raw)', async () => {
    const files = new Map();
    const scale = { key: 's0', size: [100, 70, 40], chunk: [32, 32, 16] };
    const sharding = { '@type': 'neuroglancer_uint64_sharded_v1', hash, preshift_bits: 1,
      minishard_bits: 2, shard_bits: 2, minishard_index_encoding: 'gzip', data_encoding: 'gzip' };
    buildSharded(files, BASE, scale, sharding, (c) => chunkRaw(scale, c));
    const info = { data_type: 'uint8', num_channels: 1, type: 'image', scales: [{
      key: 's0', size: scale.size, resolution: [4, 4, 30], chunk_sizes: [scale.chunk], encoding: 'raw',
      voxel_offset: [10, 20, 30], sharding }] };
    files.set(BASE + '/info', new TextEncoder().encode(JSON.stringify(info)));
    const log = [];
    const vol = await openVolume({ id: 't', url: BASE }, { fetch: fakeFetch(files, log), maxInFlight: 3 });
    eq(vol.format, 'precomputed', 'auto format');
    eq(vol.scales[0].chunk.join(','), '32,32,16', 'chunk');
    eq(vol.bounds.min.join(','), '40,80,900', 'bounds min nm');
    eq(vol.yzOrder, 'zy', 'yz order flag');
    const missing = (p) => Math.floor(p[0] / 32) === 1 && Math.floor(p[1] / 32) === 1 && Math.floor(p[2] / 16) === 0;
    for (const [plane, index, rect] of [
      ['xy', 5, [0, 0, 100, 70]], ['xy', 39, [-5, 60, 110, 75]], ['xz', 33, [10, 0, 90, 40]],
      ['yz', 64, [0, 0, 40, 70]], ['yz', 3, [5, 30, 30, 69]], ['xy', 20, [33, 33, 60, 50]],
    ]) {
      const r = await vol.getSlice(0, plane, index, rect);
      checkSlice(r, scale, plane, index, rect, missing, `${plane} ${index} ${rect}`);
    }
    const ch = await vol.getChunk(0, [3, 2, 2]);
    eq(ch.shape.join(','), '4,6,8', 'edge chunk clipped shape');
    eq(ch.data[0], voxel(96, 64, 32), 'edge chunk first voxel');
    const n = log.length;
    await vol.getSlice(0, 'xy', 5, [0, 0, 100, 70]);
    eq(log.length, n, 'second read comes from the cache');
    const st = await vol.stats();
    ok(st.chunks > 0 && st.cacheBytes > 0 && st.inFlight === 0, 'stats', st);
    ok(!log.some((u) => /info.*info/.test(u)), 'one info fetch');
  });
}

await section('precomputed unsharded + JPEG reshape (stub decoder)', async () => {
  const files = new Map();
  const scale = { key: '8_8_8', size: [50, 40, 20], chunk: [16, 16, 8] };
  const off = [100, 0, 7];
  const grid = gridShape(scale);
  for (let cz = 0; cz < grid[2]; cz++) for (let cy = 0; cy < grid[1]; cy++) for (let cx = 0; cx < grid[0]; cx++) {
    const c = [cx, cy, cz];
    const sh = [0, 1, 2].map((d) => Math.min(scale.chunk[d], scale.size[d] - c[d] * scale.chunk[d]));
    const name = [0, 1, 2].map((d) => (off[d] + c[d] * scale.chunk[d]) + '-' + (off[d] + c[d] * scale.chunk[d] + sh[d])).join('_');
    // The fake "JPEG" holds the width, height and the raw pixels.
    const raw = chunkRaw(scale, c);
    const b = new Uint8Array(4 + raw.length);
    new DataView(b.buffer).setUint16(0, sh[0], true); new DataView(b.buffer).setUint16(2, sh[1] * sh[2], true);
    b.set(raw, 4);
    files.set(BASE + '/u/8_8_8/' + name, b);
  }
  const info = { data_type: 'uint8', num_channels: 1, scales: [{ key: '8_8_8', size: scale.size,
    resolution: [8, 8, 8], chunk_sizes: [scale.chunk], encoding: 'jpeg', voxel_offset: off }] };
  files.set(BASE + '/u/info', new TextEncoder().encode(JSON.stringify(info)));
  const decodeJpeg = async (b) => {
    const dv = new DataView(b.buffer, b.byteOffset);
    return { width: dv.getUint16(0, true), height: dv.getUint16(2, true), data: b.subarray(4) };
  };
  const vol = await openVolume({ id: 'u', url: BASE + '/u', format: 'precomputed' }, { fetch: fakeFetch(files), decodeJpeg });
  for (const [plane, index, rect] of [['xy', 19, [0, 0, 50, 40]], ['xz', 39, [0, 0, 50, 20]], ['yz', 49, [0, 0, 20, 40]]]) {
    checkSlice(await vol.getSlice(0, plane, index, rect), scale, plane, index, rect, null, 'unsharded ' + plane);
  }
});

for (const variant of ['zstd C', 'blosc-lz4 C', 'gzip F', 'zstd xyz axes']) {
  await section('OME-Zarr v2 ' + variant, async () => {
    const files = new Map();
    const Z = BASE + '/z.zarr';
    const size = [70, 50, 30], chunk = [32, 32, 16];
    const xyzAxes = variant.includes('xyz');
    const axes = xyzAxes ? ['x', 'y', 'z'] : ['z', 'y', 'x'];
    const order = variant.includes(' F') ? 'F' : 'C';
    const comp = variant.startsWith('zstd') ? { id: 'zstd', level: 3 }
      : variant.startsWith('blosc') ? { id: 'blosc', cname: 'lz4', clevel: 5, shuffle: 1, blocksize: 0 }
        : { id: 'gzip', level: 5 };
    const perm = (v) => (xyzAxes ? v : [v[2], v[1], v[0]]);
    files.set(Z + '/.zattrs', new TextEncoder().encode(JSON.stringify({ multiscales: [{
      axes: axes.map((name) => ({ name, type: 'space', unit: 'nanometer' })),
      datasets: [{ path: 's0', coordinateTransformations: [
        { type: 'scale', scale: perm([4, 5, 6]) }, { type: 'translation', translation: perm([8, 0, 3]) }] }] }] })));
    files.set(Z + '/s0/.zarray', new TextEncoder().encode(JSON.stringify({ zarr_format: 2, dtype: '|u1',
      shape: perm(size), chunks: perm(chunk), compressor: comp, fill_value: 0, order, filters: null,
      dimension_separator: '/' })));
    const g = gridShape({ size, chunk });
    for (let cz = 0; cz < g[2]; cz++) for (let cy = 0; cy < g[1]; cy++) for (let cx = 0; cx < g[0]; cx++) {
      if (cx === 1 && cy === 0 && cz === 1) continue;
      // Full (padded) chunk in array memory order.
      const arrShape = perm(chunk);
      const n = chunk[0] * chunk[1] * chunk[2];
      const buf = new Uint8Array(n);
      const memAxes = order === 'C' ? [2, 1, 0] : [0, 1, 2]; // array axis index, fastest first
      const strides = [0, 0, 0]; let st = 1;
      for (const j of memAxes) { strides[j] = st; st *= arrShape[j]; }
      for (let z = 0; z < chunk[2]; z++) for (let y = 0; y < chunk[1]; y++) for (let x = 0; x < chunk[0]; x++) {
        const gx = cx * chunk[0] + x, gy = cy * chunk[1] + y, gz = cz * chunk[2] + z;
        const v = gx < size[0] && gy < size[1] && gz < size[2] ? voxel(gx, gy, gz) : 0;
        const a = perm([x, y, z]);
        buf[a[0] * strides[0] + a[1] * strides[1] + a[2] * strides[2]] = v;
      }
      const enc = comp.id === 'zstd' ? new Uint8Array(zlib.zstdCompressSync(buf))
        : comp.id === 'blosc' ? bloscFrame(buf, { blocksize: 8192 }) : new Uint8Array(zlib.gzipSync(buf));
      files.set(Z + '/s0/' + perm([cx, cy, cz]).join('/'), enc);
    }
    const vol = await openVolume({ id: 'z', url: Z }, { fetch: fakeFetch(files) });
    eq(vol.format, 'zarr', 'auto format zarr');
    eq(vol.scales[0].size.join(','), '70,50,30', 'size x,y,z');
    eq(vol.scales[0].resolution.join(','), '4,5,6', 'resolution x,y,z');
    eq(vol.scales[0].voxelOffset.join(','), '2,0,0.5', 'voxel offset from translation');
    const scale = { size, chunk };
    const missing = (p) => Math.floor(p[0] / 32) === 1 && Math.floor(p[1] / 32) === 0 && Math.floor(p[2] / 16) === 1;
    for (const [plane, index, rect] of [['xy', 17, [0, 0, 70, 50]], ['xz', 40, [0, 0, 70, 30]], ['yz', 66, [0, 0, 30, 50]]]) {
      checkSlice(await vol.getSlice(0, plane, index, rect), scale, plane, index, rect, missing, 'zarr ' + plane);
    }
  });
}

await section('cancel: aborted slice rejects and frees the queue', async () => {
  const files = new Map();
  const scale = { key: 's0', size: [256, 256, 16], chunk: [32, 32, 16] };
  const sharding = { hash: 'identity', preshift_bits: 0, minishard_bits: 1, shard_bits: 1,
    minishard_index_encoding: 'raw', data_encoding: 'raw' };
  buildSharded(files, BASE + '/c', scale, sharding, (c) => chunkRaw(scale, c));
  files.set(BASE + '/c/info', new TextEncoder().encode(JSON.stringify({ data_type: 'uint8', scales: [{
    key: 's0', size: scale.size, resolution: [1, 1, 1], chunk_sizes: [scale.chunk], encoding: 'raw', sharding }] })));
  let inflight = 0, maxSeen = 0, aborted = 0;
  const base = fakeFetch(files);
  const slowFetch = async (url, init) => {
    inflight++; maxSeen = Math.max(maxSeen, inflight);
    try {
      await new Promise((res, rej) => {
        const t = setTimeout(res, 15);
        init.signal && init.signal.addEventListener('abort', () => { clearTimeout(t); aborted++; rej(Object.assign(new Error('a'), { name: 'AbortError' })); });
      });
      return await base(url, init);
    } finally { inflight--; }
  };
  const vol = await openVolume({ id: 'c', url: BASE + '/c' }, { fetch: slowFetch });
  const ac = new AbortController();
  const p = vol.getSlice(0, 'xy', 3, [0, 0, 256, 256], { signal: ac.signal });
  await new Promise((r) => setTimeout(r, 40));
  ac.abort();
  let name; try { await p; } catch (e) { name = e.name; }
  eq(name, 'AbortError', 'slice rejects with AbortError');
  await new Promise((r) => setTimeout(r, 60));
  const st = await vol.stats();
  ok(st.queued === 0 && st.inFlight === 0, 'queue empty after abort', st);
  ok(maxSeen <= 8, 'never more than 8 fetches in flight', maxSeen);
  ok(st.chunks < 64, 'not all 64 chunks fetched', st.chunks);
  const r = await vol.getSlice(0, 'xy', 3, [0, 0, 256, 256]);
  checkSlice(r, scale, 'xy', 3, [0, 0, 256, 256], (q) => Math.floor(q[0] / 32) === 1 && Math.floor(q[1] / 32) === 1, 'slice after cancel');
});

await section('worker protocol: index.js -> worker.js through a fake Worker', async () => {
  const files = new Map();
  const scale = { key: 's0', size: [96, 64, 32], chunk: [32, 32, 16] };
  const sharding = { hash: 'identity', preshift_bits: 0, minishard_bits: 1, shard_bits: 1,
    minishard_index_encoding: 'gzip', data_encoding: 'raw' };
  buildSharded(files, BASE + '/w', scale, sharding, (c) => chunkRaw(scale, c));
  files.set(BASE + '/w/info', new TextEncoder().encode(JSON.stringify({ data_type: 'uint8', scales: [{
    key: 's0', size: scale.size, resolution: [2, 2, 2], chunk_sizes: [scale.chunk], encoding: 'raw', sharding }] })));
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch(files);
  const posted = [];
  class FakeWorker {
    constructor(url, opts) {
      eq(opts && opts.type, 'module', 'module worker');
      ok(String(url).endsWith('/data/worker.js'), 'worker url', String(url));
      const outer = this;
      globalThis.self = {
        postMessage(m, transfer) { posted.push(m.op || 'reply'); setTimeout(() => outer.onmessage && outer.onmessage({ data: structuredClone(m, { transfer }) }), 0); },
        onmessage: null,
      };
      this.inner = globalThis.self;
      import('./worker.js');
    }
    postMessage(m) { setTimeout(() => this.inner.onmessage && this.inner.onmessage({ data: structuredClone(m) }), 0); }
    terminate() {}
  }
  globalThis.window = {};
  globalThis.Worker = FakeWorker;
  try {
    globalThis.createImageBitmap = () => {};
    globalThis.OffscreenCanvas = class {};
    const vol = await openVolume({ id: 'w', url: BASE + '/w' });
    eq(vol.backend.kind, 'worker', 'worker backend chosen');
    eq(vol.scales[0].size.join(','), '96,64,32', 'meta through worker');
    vol.setFocus({ x: 10, y: 10, z: 10 });
    const r = await vol.getSlice(0, 'xz', 7, [0, 0, 96, 32]);
    checkSlice(r, scale, 'xz', 7, [0, 0, 96, 32], null, 'worker slice');
    const ch = await vol.getChunk(0, [2, 1, 1]);
    eq(ch.data[0], voxel(64, 32, 16), 'worker chunk');
    const ac = new AbortController(); ac.abort();
    let n1; try { await vol.getSlice(0, 'xy', 1, [0, 0, 8, 8], { signal: ac.signal }); } catch (e) { n1 = e.name; }
    eq(n1, 'AbortError', 'pre-aborted signal');
    const st = await vol.stats();
    ok(st.chunks >= 6 && st.cacheCap > 0, 'worker stats', st);
    vol.dispose();
    ok(posted[0] === 'ready', 'ready first', posted);
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.window; delete globalThis.Worker; delete globalThis.self;
    delete globalThis.createImageBitmap; delete globalThis.OffscreenCanvas;
  }
});

// ---------------------------------------------------------------- live

function decodeJpegPIL(bytes) {
  const out = execFileSync('python3', ['-I', '-c',
    'import sys,io\nfrom PIL import Image\nim=Image.open(io.BytesIO(sys.stdin.buffer.read())).convert("L")\n' +
    'sys.stdout.buffer.write(im.size[0].to_bytes(4,"little")+im.size[1].to_bytes(4,"little")+im.tobytes())'],
  { input: Buffer.from(bytes), maxBuffer: 64 << 20 });
  const w = out.readUInt32LE(0), h = out.readUInt32LE(4);
  return Promise.resolve({ width: w, height: h, data: new Uint8Array(out.buffer, out.byteOffset + 8, w * h) });
}

function stat(d) {
  let s = 0, s2 = 0, zeros = 0;
  for (const v of d) { s += v; s2 += v * v; if (v === 0) zeros++; }
  const m = s / d.length;
  return { mean: +m.toFixed(1), sd: +Math.sqrt(Math.max(0, s2 / d.length - m * m)).toFixed(1), zeroFrac: +(zeros / d.length).toFixed(3) };
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function writePng(path, w, h, data) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; Buffer.from(data.buffer, data.byteOffset + y * w, w).copy(raw, y * (w + 1) + 1); }
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type), body]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(tb));
    return Buffer.concat([len, tb, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

const LIVE_SETS = [
  { record: { id: 'hemibrain', format: 'precomputed', url: 'https://storage.googleapis.com/neuroglancer-janelia-flyem-hemibrain/emdata/clahe_yz/jpeg' },
    probes: [0, 3], codec: 'jpeg, sharded v1, gzip minishard index' },
  { record: { id: 'minnie65', format: 'precomputed', url: 'https://bossdb-open-data.s3.amazonaws.com/iarpa_microns/minnie/minnie65/em' },
    probes: [0, 2], codec: 's0 raw + gzip data, s2 jpeg, sharded v1' },
  { record: { id: 'jrc_hela-2', format: 'zarr', url: 'https://janelia-cosem-datasets.s3.amazonaws.com/jrc_hela-2/jrc_hela-2.zarr/recon-1/em/fibsem-uint8' },
    probes: [0, 3], codec: 's0 zstd 128^3, s3 blosc-lz4 64^3' },
  { record: { id: 'h01', format: 'precomputed', url: 'gs://h01-release/data/20210601/4nm_raw' },
    probes: [0, 4], codec: 'jpeg, sharded v1, via GCS JSON API' },
];

if (LIVE) {
  if (PNG_DIR) mkdirSync(PNG_DIR, { recursive: true });
  for (const set of LIVE_SETS) {
    await section('live ' + set.record.id + ' (' + set.codec + ')', async () => {
      let bytes = 0;
      const countingFetch = async (url, init) => {
        const r = await fetch(url, init);
        const b = await r.arrayBuffer();
        bytes += b.byteLength;
        return new Response(b, { status: r.status, headers: r.headers });
      };
      const vol = await openVolume(set.record, { fetch: countingFetch, decodeJpeg: decodeJpegPIL });
      ok(vol.scales.length >= 5, 'scales', vol.scales.length);
      for (const si of set.probes) {
        const s = vol.scales[si];
        // Centre of the volume, then the chunk that holds it.
        const centre = s.size.map((n) => Math.floor(n / 2));
        const c = centre.map((v, d) => Math.floor(v / s.chunk[d]));
        const t = performance.now();
        const ch = await vol.getChunk(si, c);
        const ms = performance.now() - t;
        const st = stat(ch.data);
        const want = ch.shape[0] * ch.shape[1] * ch.shape[2];
        ok(ch.data.length === want, `s${si} chunk length`, [ch.data.length, want]);
        ok(st.sd > 4 && st.zeroFrac < 0.9, `s${si} chunk has image content`, st);
        console.log(`     s${si} ${s.key} ${s.encoding} chunk ${c} shape ${ch.shape} mean ${st.mean} sd ${st.sd} zero ${st.zeroFrac} ${ms.toFixed(0)} ms`);
        // A slice of 2x2 chunks around the centre, in all three planes.
        for (const plane of ['xy', 'xz', 'yz']) {
          const [ua, va, na] = PLANE_UVN[plane];
          const rect = [centre[ua] - s.chunk[ua], centre[va] - s.chunk[va], centre[ua] + s.chunk[ua], centre[va] + s.chunk[va]];
          const r = await vol.getSlice(si, plane, centre[na], rect);
          const ss = stat(r.data);
          ok(r.width === rect[2] - rect[0] && ss.sd > 4, `s${si} ${plane} slice`, ss);
          if (PNG_DIR && plane === 'xy') writePng(join(PNG_DIR, `${set.record.id}-s${si}-xy.png`), r.width, r.height, r.data);
        }
      }
      console.log(`     fetched ${(bytes / 1e6).toFixed(2)} MB`);
    });
  }
}

console.log(`\n${pass} passed, ${fail} failed${LIVE ? '' : ' (offline; add --live for real chunks)'}`);
process.exit(fail ? 1 : 0);
