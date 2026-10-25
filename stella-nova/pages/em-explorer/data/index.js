// em-explorer DATA package: public API.
//
// This module streams volume-EM data from public buckets. It reads
// neuroglancer precomputed volumes (sharded v1 and unsharded) and
// OME-Zarr v2 multiscale groups. It decodes JPEG, raw, gzip, zstd and
// blosc-lz4 chunks, keeps them in a byte-capped LRU cache, and builds 2D
// slices for the VIEW package. All fetch and decode work runs in a
// module worker (data/worker.js). Where no module worker is available
// (node tests, old browsers), the same engine runs on the calling thread.
//
// API
//   openVolume(record, opts?) -> Promise<Volume>
//     record: { id, format: 'precomputed' | 'zarr', url }
//       url: https://... or gs://bucket/path (gs:// goes through the GCS
//       JSON API, which sends CORS headers for every public bucket).
//       format is optional: the reader tries `info`, then `.zattrs`.
//       Optional: maxScales (keep the first N scales), name.
//     opts: { worker: true|false, cacheBytes, maxInFlight, prefixBytes, hostCap }
//   setPhone(bool)        cache cap 96 MB (phone) or 256 MB (desktop).
//   setCacheBytes(n)      set the cache cap in bytes.
//   warm()                start the module worker now (round 2: main.js
//                         calls it as soon as this module is in, so the
//                         worker starts while VIEW and the UI still load).
//
// Volume
//   id, format, dtype ('uint8'), yzOrder ('zy': yz plane is u=z, v=y)
//   scales[i] = { key, size [x,y,z], resolution [nm], chunk [x,y,z],
//                 encoding, voxelOffset [x,y,z] (voxels of this scale) }
//   bounds = { min [nm], max [nm] } of scale 0.
//   getSlice(scaleIndex, plane, index, rect, { signal, priority })
//     -> Promise<{ data: Uint8Array, width, height }>
//     plane 'xy' | 'xz' | 'yz'; (u, v) = xy:(x, y), xz:(x, z), yz:(z, y).
//     index: voxel on the normal axis, this scale. rect [u0, v0, u1, v1)
//     in voxels of this scale, 0-based (voxelOffset is folded in).
//     data is row-major, rows along v. Voxels outside the volume are 0.
//   getChunk(scaleIndex, [cx, cy, cz], { signal, priority })
//     -> Promise<{ data: Uint8Array, shape [x,y,z] }>  (x is fastest)
//     Chunk grid positions count from voxel 0 of the scale. Do not
//     write into data: without a worker it is the cached copy.
//   prefetchIndexes([{ si, chunks: [[cx, cy, cz], ...] }]) -> Promise<n>
//     load the shard and minishard indexes of these chunks (sharded
//     precomputed; a no-op for zarr). VIEW calls it once per volume with
//     the tiles of the first view.
//   setFocus({ x, y, z })  view centre in nm. Queued requests nearest
//     to the focus go first, when the caller gives no priority.
//   cancelAll()           drop all queued and in-flight requests.
//   stats() -> Promise<{ cacheBytes, cacheCap, chunks, indexBytes, inFlight,
//                        queued, fetched, fetchedBytes, errors }>
//   dispose()             cancel all and release the reader.
//
// Worker: index.js starts data/worker.js as a module worker. When the
// worker cannot start, or has no OffscreenCanvas for JPEG (Safari before
// 16.4), the engine runs on the main thread instead.
//
// Rules: at most 24 fetches in flight in the browser (8 for a private
// engine with opts.fetch, the tests), at most 6 per HTTP/1.1 host (S3,
// where data/urls.js spreads chunks over three host names); an aborted signal removes its
// requests when no other caller waits for the same chunk. A missing shard,
// minishard entry or zarr chunk gives a chunk of zeros (fill value).
//
// Find things (grep -n):
//   'export async function openVolume'   data/index.js
//   'function createEngine'              data/engine.js
//   'function chunkId'                   data/precomputed.js  (morton)
//   'function readShardedChunk'          data/precomputed.js
//   'function openZarr'                  data/zarr.js
//   'function murmur3_x86_128'           data/hash.js
//   'function decodeBlosc'               data/codecs.js
//   'function lz4Block'                  data/codecs.js
//   'function decodeJpegBrowser'         data/codecs.js
//   'class ByteLRU'                      data/cache.js
//   'class Scheduler'                    data/scheduler.js
//   'function assembleSlice'             data/slice.js
//   'function resolveUrl'                data/urls.js
//   'function s3ShardHosts'              data/urls.js  (S3 host names)
//   'function hostSlot'                  data/engine.js (6 per HTTP/1.1 host)
//   'async function prefetchIndexes'     data/engine.js
//   'async shardHead'                    data/precomputed.js (small shards)
//   'self.onmessage' / 'scope.onmessage' data/worker.js  (message ops)
//   node data/tests.mjs [--live] [--png dir]   offline and live tests

import { createEngine, DESKTOP_CACHE, PHONE_CACHE, BROWSER_IN_FLIGHT, PREFIX_BYTES } from './engine.js';
import { decodeJpegBrowser } from './codecs.js';
import { abortError } from './scheduler.js';

export const DATA_API_VERSION = 1;
export { DESKTOP_CACHE, PHONE_CACHE };

let shared = null;
let capBytes = null;

function detectPhone() {
  try {
    const nav = typeof navigator !== 'undefined' ? navigator : {};
    if (nav.deviceMemory && nav.deviceMemory <= 2) return true;
    if (typeof matchMedia === 'function' && typeof screen !== 'undefined') {
      return matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
    }
  } catch (e) { /* not a browser */ }
  return false;
}

function currentCap() {
  return capBytes || (detectPhone() ? PHONE_CACHE : DESKTOP_CACHE);
}

export function setCacheBytes(n) {
  if (!(n > 0)) return;
  capBytes = n;
  if (shared) shared.then((b) => b.setCacheBytes(n), () => {});
}

export function setPhone(phone) {
  setCacheBytes(phone ? PHONE_CACHE : DESKTOP_CACHE);
}

function localBackend(opts = {}) {
  const canJpeg = typeof createImageBitmap === 'function' &&
    (typeof OffscreenCanvas !== 'undefined' || typeof document !== 'undefined');
  const engine = createEngine({
    fetch: opts.fetch,
    decodeJpeg: opts.decodeJpeg || (canJpeg ? decodeJpegBrowser : null),
    cacheBytes: opts.cacheBytes || currentCap(),
    maxInFlight: opts.maxInFlight || (opts.fetch || opts.private ? undefined : BROWSER_IN_FLIGHT),
    prefixBytes: opts.prefixBytes ?? (opts.fetch || opts.private ? 0 : PREFIX_BYTES),
    hostCap: opts.hostCap,
  });
  return {
    kind: 'local',
    engine,
    open: (record) => engine.open(record),
    chunk: (vid, si, c, o) => engine.getChunk(vid, si, c, o),
    slice: (vid, si, plane, index, rect, o) => engine.getSlice(vid, si, plane, index, rect, o),
    prefetch: (vid, groups) => engine.prefetchIndexes(vid, groups),
    focus: (vid, nm) => engine.setFocus(vid, nm),
    cancelAll: (vid) => engine.cancelAll(vid),
    close: (vid) => engine.close(vid),
    stats: () => Promise.resolve(engine.stats()),
    setCacheBytes: (n) => engine.setCacheBytes(n),
  };
}

function workerBackend(allowNoJpeg = false) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    } catch (e) { reject(e); return; }
    const pending = new Map();
    let nextId = 1, ready = false;
    const timer = setTimeout(() => { if (!ready) { worker.terminate(); reject(new Error('worker timeout')); } }, 20000);
    worker.onerror = (e) => {
      if (!ready) { clearTimeout(timer); worker.terminate(); reject(new Error('worker failed: ' + (e && e.message))); }
    };
    worker.onmessage = (e) => {
      const m = e.data || {};
      if (m.op === 'ready') {
        ready = true; clearTimeout(timer);
        if (m.jpeg === false && !allowNoJpeg) { worker.terminate(); reject(new Error('no JPEG decoder in the worker')); return; }
        resolve(api);
        return;
      }
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (p.signal && p.onAbort) p.signal.removeEventListener('abort', p.onAbort);
      if (m.ok) p.resolve(m.result);
      else p.reject(m.abort ? abortError() : new Error(m.error));
    };
    function call(msg, signal) {
      if (signal && signal.aborted) return Promise.reject(abortError());
      const id = nextId++;
      return new Promise((res, rej) => {
        const p = { resolve: res, reject: rej, signal, onAbort: null };
        if (signal) {
          p.onAbort = () => {
            if (!pending.has(id)) return;
            pending.delete(id);
            worker.postMessage({ op: 'cancel', ref: id });
            rej(abortError());
          };
          signal.addEventListener('abort', p.onAbort, { once: true });
        }
        pending.set(id, p);
        worker.postMessage({ ...msg, id });
      });
    }
    const api = {
      kind: 'worker',
      worker,
      open: (record) => call({ op: 'open', record: JSON.parse(JSON.stringify(record)) }),
      chunk: (vid, si, c, o = {}) => call({ op: 'chunk', vid, si, c: [...c], priority: o.priority }, o.signal),
      slice: (vid, si, plane, index, rect, o = {}) =>
        call({ op: 'slice', vid, si, plane, index, rect: [...rect], priority: o.priority }, o.signal),
      prefetch: (vid, groups) => call({ op: 'prefetch', vid, groups: JSON.parse(JSON.stringify(groups || [])) }),
      focus: (vid, nm) => worker.postMessage({ op: 'focus', vid, nm: { x: nm.x, y: nm.y, z: nm.z } }),
      cancelAll: (vid) => worker.postMessage({ op: 'cancelAll', vid }),
      close: (vid) => worker.postMessage({ op: 'close', vid }),
      stats: () => call({ op: 'stats' }),
      setCacheBytes: (n) => worker.postMessage({ op: 'cap', bytes: n }),
    };
  }).then((api) => { api.setCacheBytes(currentCap()); return api; });
}

export function warm() { sharedBackend().catch(() => {}); }

function sharedBackend() {
  if (!shared) {
    shared = (async () => {
      const canWorker = typeof Worker !== 'undefined' && typeof window !== 'undefined';
      if (canWorker) {
        try { return await workerBackend(); } catch (e) {
          if (typeof console !== 'undefined') console.warn('em-explorer DATA: no module worker, decoding on the main thread.', e);
        }
      }
      return localBackend();
    })();
  }
  return shared;
}

class Volume {
  constructor(backend, meta) {
    this.backend = backend;
    this.vid = meta.vid;
    this.id = meta.id;
    this.format = meta.format;
    this.dtype = meta.dtype;
    this.yzOrder = meta.yzOrder;
    this.scales = meta.scales;
    this.bounds = meta.bounds;
    this.disposed = false;
  }
  getSlice(scaleIndex, plane, index, rect, opts = {}) {
    return this.backend.slice(this.vid, scaleIndex, plane, index, rect, opts);
  }
  getChunk(scaleIndex, c, opts = {}) {
    return this.backend.chunk(this.vid, scaleIndex, c, opts);
  }
  prefetchIndexes(groups) { return this.disposed ? Promise.resolve(0) : this.backend.prefetch(this.vid, groups); }
  setFocus(nm) { if (nm) this.backend.focus(this.vid, nm); }
  cancelAll() { this.backend.cancelAll(this.vid); }
  stats() { return this.backend.stats(); }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.backend.close(this.vid);
  }
}

// opts.worker false: run on this thread. opts.fetch / opts.decodeJpeg
// (tests): a private engine with these functions.
export async function openVolume(record, opts = {}) {
  if (!record || !(record.url || record.source)) throw new Error('em-explorer DATA: the record has no url');
  let backend;
  if (opts.fetch || opts.decodeJpeg || opts.private) backend = localBackend(opts);
  else if (opts.worker === false) backend = await (shared = shared || Promise.resolve(localBackend(opts)));
  else backend = await sharedBackend();
  const meta = await backend.open(record);
  return new Volume(backend, meta);
}
