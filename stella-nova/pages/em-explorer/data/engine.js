// Fetch and decode engine for the em-explorer DATA package.
//
// One engine runs in the module worker (or on the calling thread as a
// fallback). It owns the HTTP layer, the decoded chunk cache (ByteLRU,
// shared by all volumes), the small index cache (shard and minishard
// indexes) and the Scheduler (max 8 fetches in flight, priority, cancel).
//
// createEngine({ fetch, decodeJpeg, cacheBytes, maxInFlight, hostCap,
//                prefixBytes }) -> {
//   open(record) -> Promise<{ vid, meta }>,
//   getChunk(vid, si, c, opts), getSlice(vid, si, plane, index, rect, opts),
//   prefetchIndexes(vid, [{ si, chunks: [[cx,cy,cz], ...] }]) -> Promise<n>,
//   setFocus(vid, nm), cancelAll(vid?), close(vid), stats(),
//   setCacheBytes(n) }
//
// maxInFlight: 8 by default (tests); the browser backends pass
// BROWSER_IN_FLIGHT (24), because GCS speaks HTTP/2 and a cap of 8 held
// the hemibrain home view at 40 s (NOTES.md, round 2 timeline).
// hostCap: fetches in flight per HTTP/1.1 host name (S3), default 6, the
// browser limit, so the queue order stays ours and not the browser's.
// prefixBytes: read a whole small shard in one request (precomputed.js
// PREFIX_BYTES in the browser backends; 0, off, by default).

import { ByteLRU } from './cache.js';
import { Scheduler, abortError } from './scheduler.js';
import { resolveUrl, hostOf, isHttp1Host } from './urls.js';
import { PrecomputedSource, parseInfo, PREFIX_BYTES } from './precomputed.js';
import { openZarr } from './zarr.js';
import { assembleSlice } from './slice.js';

export const DESKTOP_CACHE = 256 * 1024 * 1024;
export const PHONE_CACHE = 96 * 1024 * 1024;
const INDEX_CACHE = 24 * 1024 * 1024;
const MAX_RANGE_SLACK = 1 << 20;
export const BROWSER_IN_FLIGHT = 24;
export { PREFIX_BYTES };
const HOST_CAP = 6;
const PREFETCH_LANES = 4;

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(abortError()); }, { once: true });
  });
}

export function createEngine(opts = {}) {
  const fetchFn = opts.fetch || ((...a) => fetch(...a));
  const decodeJpeg = opts.decodeJpeg || null;
  const cache = new ByteLRU(opts.cacheBytes || DESKTOP_CACHE);
  const indexCache = { lru: new ByteLRU(INDEX_CACHE), pending: new Map() };
  const sched = new Scheduler({ maxInFlight: opts.maxInFlight || 8 });
  const vols = new Map();
  const byUrl = new Map();
  const counters = { fetched: 0, fetchedBytes: 0, errors: 0 };
  let nextVid = 1;
  const hostCap = opts.hostCap === undefined ? HOST_CAP : opts.hostCap;
  const lanes = new Map();

  // A slot on an HTTP/1.1 host; waits in arrival order, leaves on abort.
  function hostSlot(url, signal) {
    const host = hostOf(url);
    if (!hostCap || !isHttp1Host(host)) return Promise.resolve(() => {});
    let L = lanes.get(host);
    if (!L) lanes.set(host, L = { n: 0, wait: [] });
    const release = () => { L.n--; while (L.wait.length) { const w = L.wait.shift(); if (w.go()) break; } };
    if (L.n < hostCap) { L.n++; return Promise.resolve(release); }
    return new Promise((resolve, reject) => {
      const w = { done: false, go: () => { if (w.done) return false; w.done = true; L.n++; resolve(release); return true; } };
      if (signal) signal.addEventListener('abort', () => { if (!w.done) { w.done = true; reject(abortError()); } }, { once: true });
      L.wait.push(w);
    });
  }

  async function fetchBytes(url, o = {}) {
    if (o.signal && o.signal.aborted) throw abortError();
    const release = await hostSlot(url, o.signal);
    try { return await fetchBytesNow(url, o); } finally { release(); }
  }

  async function fetchBytesNow(url, { range, signal } = {}) {
    const headers = {};
    if (range) headers.Range = 'bytes=' + range[0] + '-' + (range[1] - 1);
    for (let attempt = 0; ; attempt++) {
      if (signal && signal.aborted) throw abortError();
      let res;
      try {
        res = await fetchFn(url, { headers, signal, credentials: 'omit', mode: 'cors' });
      } catch (err) {
        if (err && err.name === 'AbortError') throw err;
        if (attempt < 2) { await sleep(400 * (attempt + 1), signal); continue; }
        counters.errors++;
        throw new Error('em-explorer DATA: network error for ' + url + ' (' + (err && err.message) + ')');
      }
      if (res.status === 404) { try { res.body && res.body.cancel(); } catch (e) { /* ignore */ } return null; }
      if (res.status >= 500 || res.status === 429) {
        try { res.body && res.body.cancel(); } catch (e) { /* ignore */ }
        if (attempt < 2) { await sleep(600 * (attempt + 1), signal); continue; }
      }
      if (!res.ok) { counters.errors++; throw new Error('em-explorer DATA: HTTP ' + res.status + ' for ' + url); }
      if (range && res.status === 200) {
        // The server ignored Range. Read the body only when it is small.
        const len = Number(res.headers.get('content-length'));
        if (!(len > 0 && len <= range[1] + MAX_RANGE_SLACK)) {
          try { res.body && res.body.cancel(); } catch (e) { /* ignore */ }
          counters.errors++;
          throw new Error('em-explorer DATA: server ignored Range for ' + url);
        }
        const all = new Uint8Array(await res.arrayBuffer());
        counters.fetched++; counters.fetchedBytes += all.length;
        return all.subarray(range[0], range[1]);
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      counters.fetched++; counters.fetchedBytes += buf.length;
      return buf;
    }
  }

  async function fetchJson(url, { optional } = {}) {
    const b = await fetchBytes(url);
    if (!b) {
      if (optional) return null;
      throw new Error('em-explorer DATA: not found ' + url);
    }
    try { return JSON.parse(new TextDecoder().decode(b)); } catch (e) {
      if (optional) return null;
      throw new Error('em-explorer DATA: bad JSON at ' + url);
    }
  }

  const io = { fetchBytes, fetchJson, decodeJpeg, indexCache, prefixBytes: opts.prefixBytes || 0 };

  async function openSource(record) {
    const store = resolveUrl(record.url || record.source);
    const fmt = record.format || record.type;
    if (fmt === 'zarr' || fmt === 'ome-zarr') return { format: 'zarr', src: await openZarr(store, io, record) };
    if (fmt === 'precomputed') {
      const info = record.info || await fetchJson(store.url('info'));
      return { format: 'precomputed', src: new PrecomputedSource(store, parseInfo(info, record), io) };
    }
    const info = await fetchJson(store.url('info'), { optional: true });
    if (info && info.scales) return { format: 'precomputed', src: new PrecomputedSource(store, parseInfo(info, record), io) };
    return { format: 'zarr', src: await openZarr(store, io, record) };
  }

  function metaOf(vid, record, format, src) {
    const scales = src.scales.map((s) => ({
      key: s.key, size: s.size.slice(), resolution: s.resolution.slice(),
      chunk: s.chunk.slice(), encoding: s.encoding, voxelOffset: s.voxelOffset.slice(),
    }));
    const s0 = scales[0];
    return {
      vid, id: record.id, format, dtype: 'uint8', yzOrder: 'zy', scales,
      bounds: {
        min: [0, 1, 2].map((d) => s0.voxelOffset[d] * s0.resolution[d]),
        max: [0, 1, 2].map((d) => (s0.voxelOffset[d] + s0.size[d]) * s0.resolution[d]),
      },
    };
  }

  async function open(record) {
    const url = String(record.url || record.source) + '|' + (record.maxScales || '');
    let p = byUrl.get(url);
    if (!p) {
      p = (async () => {
        const { format, src } = await openSource(record);
        const vid = nextVid++;
        const meta = metaOf(vid, record, format, src);
        vols.set(vid, { src, meta });
        return meta;
      })();
      byUrl.set(url, p);
      p.catch(() => byUrl.delete(url));
    }
    const meta = await p;
    return { ...meta, id: record.id };
  }

  function vol(vid) {
    const v = vols.get(vid);
    if (!v) throw new Error('em-explorer DATA: volume ' + vid + ' is not open');
    return v;
  }

  function chunkCentre(meta, si, c) {
    const s = meta.scales[si];
    return [0, 1, 2].map((d) => (s.voxelOffset[d] + (c[d] + 0.5) * s.chunk[d]) * s.resolution[d]);
  }

  function getChunk(vid, si, c, o = {}) {
    const v = vol(vid);
    if (!(si >= 0 && si < v.meta.scales.length)) return Promise.reject(new Error('em-explorer DATA: bad scale ' + si));
    const key = vid + '|' + si + '|' + c[0] + ',' + c[1] + ',' + c[2];
    const hit = cache.get(key);
    if (hit) return Promise.resolve(hit);
    return sched.run(key, async (signal) => {
      const r = await v.src.readChunk(si, c, signal);
      const out = { data: r.data, shape: r.shape };
      cache.set(key, out, r.data.byteLength + 96);
      return out;
    }, { signal: o.signal, priority: o.priority, group: vid, centre: chunkCentre(v.meta, si, c) });
  }

  // Warm the shard and minishard indexes of these chunks (sharded
  // precomputed only), so the first chunk of each shard waits one round
  // trip and not three. Index fetches do not take a scheduler slot.
  async function prefetchIndexes(vid, groups) {
    const v = vols.get(vid);
    if (!v || typeof v.src.warmIndex !== 'function') return 0;
    const list = [];
    for (const g of groups || []) {
      if (!(g.si >= 0 && g.si < v.meta.scales.length)) continue;
      for (const c of g.chunks || []) list.push([g.si, c]);
    }
    // in the given order (coarse first), at most PREFETCH_LANES at a time
    let next = 0, n = 0;
    const lane = async () => {
      while (next < list.length) {
        const [si, c] = list[next++];
        try { if (await v.src.warmIndex(si, c)) n++; } catch (e) { /* the chunk read reports it */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PREFETCH_LANES, list.length) }, lane));
    return n;
  }

  function getSlice(vid, si, plane, index, rect, o = {}) {
    const v = vol(vid);
    const s = v.meta.scales[si];
    if (!s) return Promise.reject(new Error('em-explorer DATA: bad scale ' + si));
    return assembleSlice(s, plane, index, rect, (c) => getChunk(vid, si, c, o));
  }

  return {
    io,
    open,
    getChunk,
    getSlice,
    prefetchIndexes,
    meta(vid) { return vol(vid).meta; },
    setFocus(vid, nm) { if (nm) sched.setFocus(vid, { x: +nm.x || 0, y: +nm.y || 0, z: +nm.z || 0 }); },
    cancelAll(vid) { sched.cancelAll(vid); },
    close(vid) { sched.cancelAll(vid); },
    setCacheBytes(n) { if (n > 0) cache.setCap(n); },
    stats() {
      return {
        cacheBytes: cache.bytes, cacheCap: cache.cap, chunks: cache.size,
        indexBytes: indexCache.lru.bytes,
        inFlight: sched.running, queued: sched.queued, ...counters,
      };
    },
  };
}
