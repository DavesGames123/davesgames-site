// ============================================================================
//  WEIGHTS  ·  stem-splitter/engine/weights.js — model bytes and their cache
// ----------------------------------------------------------------------------
//  The worker gets the ONNX graph and the official Demucs .th weights with
//  getModelBytes (CONTRACT 2.5 step 5 and 6):
//    1. read Cache Storage "stem-models-v1" first (key = absolute URL +
//       "?sha=" + sha256), so a cached model works with no network;
//    2. else fetch the file and join the chunks at their real size (never
//       size a buffer from content-length: Pages can gzip);
//    3. check the sha256 (crypto.subtle) of the bytes, from the network
//       and from the cache; a bad cache entry is deleted;
//    4. store new bytes, then ask once for persistent storage.
//  The sizes in models.js are for progress only.
//  The service worker passes these URLs through (sw.js PASS_PATH), so this
//  cache is the only copy. With no `caches` (node), steps 1 and 4 are
//  skipped. Errors carry a code: 'net' (fetch failed or not ok) or 'hash'.
//
//  GREP MAP
//    cache name / key ...... "export const CACHE_NAME", "export function cacheKey"
//    URL of a model file ... "export function modelUrl"
//    download + verify ..... "export async function getModelBytes"
//    which are cached ...... "export async function cachedModels"
//    remove a model ........ "export async function evictModel"
// ============================================================================

export const CACHE_NAME = 'stem-models-v1';
const PAGE_DIR = new URL('../', import.meta.url);

// Paths in models.js are relative to the page folder.
export const modelUrl = (file, base = PAGE_DIR) => new URL(file, base).href;
export const cacheKey = (url, sha256) => url + '?sha=' + sha256;

const fail = (code, msg) => Object.assign(new Error(msg), { code });
const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
const openCache = async (cs) => {
  const store = cs === undefined ? (typeof caches !== 'undefined' ? caches : null) : cs;
  if (!store) return null;
  try { return await store.open(CACHE_NAME); } catch (e) { return null; }
};
let persistAsked = false;

async function readAll(res, total, onProgress) {
  const parts = [];
  let got = 0, last = 0;
  if (res.body && res.body.getReader) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); got += value.byteLength;
      const t = Date.now();
      if (onProgress && t - last > 100) { last = t; onProgress({ phase: 'download', loaded: got, total }); }
    }
  } else {
    const b = new Uint8Array(await res.arrayBuffer());
    parts.push(b); got = b.byteLength;
  }
  if (parts.length === 1 && parts[0].byteOffset === 0 && parts[0].byteLength === parts[0].buffer.byteLength) return parts[0];
  const out = new Uint8Array(got);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.byteLength; }
  return out;
}

// -> { data: Uint8Array, fromCache }. opts: { fetchImpl, cacheStorage
// (null = no cache), persist } for tests and node.
export async function getModelBytes(url, { bytes, sha256 }, onProgress, opts = {}) {
  const fetchImpl = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  const cache = await openCache(opts.cacheStorage);
  const key = cacheKey(url, sha256);
  if (cache) {
    let hit = null;
    try { hit = await cache.match(key); } catch (e) { hit = null; }
    if (hit) {
      const data = await readAll(hit, bytes, null);
      if (onProgress) onProgress({ phase: 'verify', loaded: data.byteLength, total: bytes });
      if (hex(await crypto.subtle.digest('SHA-256', data)) === sha256) return { data, fromCache: true };
      try { await cache.delete(key); } catch (e) { /* ignore */ }
    }
  }
  if (!fetchImpl) throw fail('net', 'no fetch in this context');
  let res;
  try { res = await fetchImpl(url, { cache: 'no-store' }); } catch (e) { throw fail('net', 'download failed: ' + (e && e.message || e)); }
  if (!res.ok) throw fail('net', 'download failed: HTTP ' + res.status + ' for ' + url.split('/').pop());
  let data;
  try { data = await readAll(res, bytes, onProgress); } catch (e) { throw fail('net', 'download stopped: ' + (e && e.message || e)); }
  if (onProgress) onProgress({ phase: 'verify', loaded: data.byteLength, total: bytes });
  const sum = hex(await crypto.subtle.digest('SHA-256', data));
  if (sum !== sha256) throw fail('hash', 'sha256 check failed for ' + url.split('/').pop() + ' (' + data.byteLength + ' bytes)');
  if (cache) {
    try {
      await cache.put(key, new Response(data, { headers: { 'content-type': 'application/octet-stream' } }));
      const nav = typeof navigator !== 'undefined' ? navigator : null;
      if (!persistAsked && opts.persist !== false && nav && nav.storage && nav.storage.persist) {
        persistAsked = true;
        nav.storage.persist().catch(() => {});
      }
    } catch (e) { /* quota: run without the cache */ }
  }
  return { data, fromCache: false };
}

const filesOf = m => [m.graph, m.weights].filter(Boolean);

// -> { [id]: true when the graph and the weights are both in the cache }.
export async function cachedModels(MODELS, opts = {}) {
  const cache = await openCache(opts.cacheStorage), out = {};
  for (const [id, m] of Object.entries(MODELS)) {
    let all = !!cache;
    for (const f of filesOf(m)) {
      if (!all) break;
      try { all = !!(await cache.match(cacheKey(modelUrl(f.file, opts.base), f.sha256))); } catch (e) { all = false; }
    }
    out[id] = all;
  }
  return out;
}

export async function evictModel(model, opts = {}) {
  const cache = await openCache(opts.cacheStorage);
  if (!cache) return;
  for (const f of filesOf(model)) {
    try { await cache.delete(cacheKey(modelUrl(f.file, opts.base), f.sha256)); } catch (e) { /* ignore */ }
  }
}
