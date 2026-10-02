// ============================================================================
//  SERVICE WORKER  ·  the whole site in Cache Storage, for offline use
// ----------------------------------------------------------------------------
//  Scope: the site root (/), so it covers /, /site.html and /stella-nova/.
//  The shell (stella-nova/lib/offline.js) and the root index.html register
//  it. Pages opened from file:// do not use it.
//
//  File list: sw-manifest.js (self.SN_OFFLINE), written by
//  tools/offline-manifest.mjs. Each entry is [path, hash]. The tool also
//  writes VERSION below, so a deploy that changes a file changes this
//  file, and the browser installs the new worker.
//
//  Caches
//    sn-core-<VERSION>  core files. Install downloads all of them. A new
//                       version gets a new cache. Activate deletes the old.
//    sn-lazy            lazy files (meshes, photos, big data). One cache for
//                       all versions. The background pass (message
//                       "sn-warm") and the first request fill it. Activate
//                       deletes entries that the manifest no longer lists.
//    sn-runtime         other same-origin GETs, stale-while-revalidate.
//    sn-live            live data (TLE snapshot, NOAA storms, CelesTrak,
//                       AlphaFold): network first, then the last good copy.
//  Each stored response has the header x-sn-hash (the manifest hash), so a
//  new version copies an unchanged file from an old cache and does not
//  download it again. Live copies have x-sn-saved (the save time).
//
//  Responses are stored with no Content-Length and no Content-Encoding.
//  The body in the cache is decoded, so those headers would be wrong.
//
//  Local servers (localhost, 127.0.0.1): the worker caches nothing unless
//  it was registered as sw.js?local=1 (the shell does that only after an
//  opt-in, see lib/offline.js). Otherwise it deletes the sn-* caches and
//  unregisters itself, so a dev server always gives the files on disk.
//
//  When a live request fails and the worker answers from sn-live, it posts
//  { type: 'sn-live-fallback', url, saved } to each window. The shell shows
//  a notice with the date of the copy.
//
//  grep -n targets
//    version stamp ........ "const VERSION"
//    local-server guard ... "const DEV_OFF"
//    live data rules ...... "const LIVE_PATH"
//    install / precache ... "async function precache"
//    background pass ...... "async function warm"
//    request routing ..... "function route"
// ============================================================================
'use strict';
const VERSION = 'd5d856418e98fc25';
importScripts('sw-manifest.js');

const DEV_OFF = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(self.location.hostname)
  && !new URL(self.location.href).searchParams.has('local');
const M = self.SN_OFFLINE;
const SCOPE = new URL('./', self.location).href;     // site root, with slash
const CORE = 'sn-core-' + VERSION;
const LAZY = 'sn-lazy', RUNTIME = 'sn-runtime', LIVE = 'sn-live';
const coreHash = new Map(M.core);
const lazyHash = new Map(M.lazy);

// Live data. Same-origin: the TLE snapshot that the deploy writes (not in
// git, so not in the manifest). Cross-origin: hosts that pages fetch for
// live values. Other cross-origin requests pass through untouched.
const LIVE_PATH = /^stella-nova\/pages\/leo-catalog\/data\/[^/]+\.txt$/;
const LIVE_HOSTS = new Set(['davesgames.io', 'www.nhc.noaa.gov', 'celestrak.org', 'alphafold.ebi.ac.uk']);

// Site path of a same-origin URL: no leading slash, "dir/" -> "dir/index.html".
function sitePath(url) {
  if (!url.href.startsWith(SCOPE)) return null;
  let p = decodeURIComponent(url.pathname.slice(new URL(SCOPE).pathname.length));
  if (p === '' || p.endsWith('/')) p += 'index.html';
  return p;
}

// Copy a response with a new header set: drop the encoding headers, add ours.
function restamp(res, extra) {
  const h = new Headers(res.headers);
  h.delete('content-length'); h.delete('content-encoding');
  for (const k in extra) h.set(k, extra[k]);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

// Download one manifest file. The ?sn=<hash> query skips the HTTP cache
// and the CDN edge cache, so the bytes match the hash of this deploy.
async function download(path, hash) {
  let err;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(SCOPE + path + '?sn=' + hash, { cache: 'no-store', credentials: 'same-origin' });
      if (res.ok) return restamp(res, { 'x-sn-hash': hash });
      err = new Error('HTTP ' + res.status + ' ' + path);
      if (res.status === 404) break;
    } catch (e) { err = e; }
  }
  throw err;
}

// Find a stored copy of path with this hash in any of our caches.
async function findStored(path, hash, names) {
  for (const n of names) {
    const r = await (await caches.open(n)).match(SCOPE + path);
    if (r && r.headers.get('x-sn-hash') === hash) return r;
  }
  return null;
}

// Run fn over items, n at a time.
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

// Install: fill sn-core-<VERSION>. A file already in this cache (an
// earlier install that stopped) or in an older cache with the same hash
// is copied. A failed download fails the install, so the old worker stays.
async function precache() {
  const cache = await caches.open(CORE);
  const names = [CORE, ...(await caches.keys()).filter((n) => n.startsWith('sn-core-') && n !== CORE), LAZY];
  const failed = [];
  await pool(M.core, 6, async ([path, hash]) => {
    try {
      const old = await findStored(path, hash, names);
      if (old) { if (!(await cache.match(SCOPE + path))) await cache.put(SCOPE + path, old); return; }
      await cache.put(SCOPE + path, await download(path, hash));
    } catch (e) { failed.push(path); }
  });
  if (failed.length) throw new Error('precache failed: ' + failed.slice(0, 5).join(', ') + (failed.length > 5 ? ' ...' : ''));
}

self.addEventListener('install', (e) => {
  e.waitUntil(DEV_OFF ? self.skipWaiting() : precache().then(() => self.skipWaiting()));
});

// Activate: delete old core caches, delete lazy entries that are gone or
// changed, then take control of the open pages.
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    if (DEV_OFF) {
      for (const n of await caches.keys()) if (n.startsWith('sn-')) await caches.delete(n);
      await self.registration.unregister();
      return;
    }
    for (const n of await caches.keys()) if (n.startsWith('sn-core-') && n !== CORE) await caches.delete(n);
    const lazy = await caches.open(LAZY);
    for (const req of await lazy.keys()) {
      const p = sitePath(new URL(req.url));
      const r = await lazy.match(req);
      if (!lazyHash.has(p) || r.headers.get('x-sn-hash') !== lazyHash.get(p)) await lazy.delete(req);
    }
    // Same-origin runtime copies may be of files that are now in the manifest.
    const rt = await caches.open(RUNTIME);
    for (const req of await rt.keys()) {
      const p = sitePath(new URL(req.url));
      if (coreHash.has(p) || lazyHash.has(p)) await rt.delete(req);
    }
    await self.clients.claim();
  })());
});

// Background pass: download each lazy file that is not stored yet. One
// pass at a time. Progress goes to the windows as { type: 'sn-warm' }.
let warming = null;
async function warm() {
  const cache = await caches.open(LAZY);
  const todo = [];
  for (const [path, hash] of M.lazy) {
    const r = await cache.match(SCOPE + path);
    if (!r || r.headers.get('x-sn-hash') !== hash) todo.push([path, hash]);
  }
  let done = M.lazy.length - todo.length, failed = 0;
  await pool(todo, 3, async ([path, hash]) => {
    try { await cache.put(SCOPE + path, await download(path, hash)); done++; } catch (e) { failed++; }
  });
  await tell({ type: 'sn-warm', version: VERSION, done, total: M.lazy.length, failed });
  return { done, total: M.lazy.length, failed };
}

async function tell(msg) {
  for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) c.postMessage(msg);
}

self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type === 'sn-warm') {
    if (!warming) warming = warm().finally(() => { warming = null; });
    e.waitUntil(warming);
  } else if (d.type === 'sn-status' && e.ports[0]) {
    e.waitUntil((async () => {
      const core = (await (await caches.open(CORE)).keys()).length;
      const lazy = (await (await caches.open(LAZY)).keys()).length;
      e.ports[0].postMessage({ version: VERSION, core, coreTotal: M.core.length, lazy, lazyTotal: M.lazy.length, warming: !!warming });
    })());
  }
});

// Network first; on failure, the last good copy from sn-live, with a notice.
// cache: 'no-cache' makes the browser ask the server: with no network, an
// HTTP cache copy must not count as a live answer.
async function liveFirst(req) {
  const cache = await caches.open(LIVE);
  try {
    const res = await fetch(req.mode === 'navigate' ? req : new Request(req, { cache: 'no-cache' }));
    if (res.ok && res.type !== 'opaque') await cache.put(req.url, restamp(res.clone(), { 'x-sn-saved': new Date().toISOString() }));
    return res;
  } catch (err) {
    const hit = await cache.match(req.url);
    if (!hit) throw err;
    tell({ type: 'sn-live-fallback', url: req.url, saved: hit.headers.get('x-sn-saved') });
    return hit;
  }
}

// Same-origin, not in the manifest: answer from cache, refresh behind it.
async function staleWhileRevalidate(e, req) {
  const cache = await caches.open(RUNTIME);
  const hit = await cache.match(req);
  const net = fetch(req).then(async (res) => {
    if (res.ok && res.type === 'basic') await cache.put(req, restamp(res.clone(), {}));
    return res;
  });
  if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
  return net;
}

// Manifest file: the stored copy, else the network (and keep a lazy file).
async function fromManifest(req, path) {
  const inCore = coreHash.has(path);
  const hash = inCore ? coreHash.get(path) : lazyHash.get(path);
  const cache = await caches.open(inCore ? CORE : LAZY);
  const hit = await cache.match(SCOPE + path);
  if (hit) return hit;
  if (inCore) {
    // Not installed yet (first visit), or evicted: an older cache, then the network.
    for (const n of await caches.keys()) {
      if (!n.startsWith('sn-core-')) continue;
      const r = await (await caches.open(n)).match(SCOPE + path);
      if (r && r.headers.get('x-sn-hash') === hash) return r;
    }
    return fetch(req);
  }
  // Lazy file, first request: download it as the background pass does,
  // keep it, and answer with the stored copy.
  try {
    await cache.put(SCOPE + path, await download(path, hash));
    return await cache.match(SCOPE + path);
  } catch (e) {
    return fetch(req);
  }
}

function route(e) {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return null;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    const path = sitePath(url);
    if (path === null) return null;
    if (LIVE_PATH.test(path)) return liveFirst(req);
    if (coreHash.has(path) || lazyHash.has(path)) return fromManifest(req, path);
    return staleWhileRevalidate(e, req);
  }
  if (LIVE_HOSTS.has(url.hostname)) {
    if (url.hostname === 'davesgames.io' && !LIVE_PATH.test(url.pathname.slice(1))) return null;
    return liveFirst(req);
  }
  return null;
}

self.addEventListener('fetch', (e) => {
  if (DEV_OFF) return;
  const p = route(e);
  if (p) e.respondWith(p.catch(() => new Response('offline: ' + e.request.url, { status: 504, statusText: 'Offline', headers: { 'content-type': 'text/plain' } })));
});
