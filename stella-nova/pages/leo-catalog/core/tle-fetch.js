// ============================================================================
//  LEO CATALOG  ·  core/tle-fetch.js — TLE download, cache and source order
// ----------------------------------------------------------------------------
//  fetchTLE(url) returns TLE text. It holds an abort-based timeout so a slow
//  source cannot hang boot. Responses go into the Cache API for TLE_TTL_MS.
//  CelesTrak updates each group about every 2 h and blocks clients that
//  download more often, so a reload in that window reads the cache. A stale
//  cache entry is the fallback when the network fetch fails.
//
//  CelesTrak sends 403 (IP block) or 429 (rate limit) to a client that
//  downloads too much, or it holds the connection with no response. Each new
//  request extends the block, so after the first 403, 429, timeout or network
//  error this page sends no more requests to CelesTrak. The timeout covers
//  the time to the response headers, not the body, so a large group on a
//  slow link does not trip it.
//
//  Each group has three sources, tried in order (urlsForGroup):
//    1. data/<group>.txt next to the page. The tle-snapshot workflow
//       downloads it from CelesTrak every 2 h and puts it in the Pages deploy.
//    2. The same file on the live site, for local servers that have no data/.
//       GitHub Pages sends Access-Control-Allow-Origin: *.
//    3. CelesTrak, only when neither snapshot is available.
//  So a visitor sends no request to CelesTrak while a snapshot exists.
//
//  grep -n targets: "const TLE_CACHE", "async function cacheRead",
//  "async function cacheWrite", "export async function fetchTLE",
//  "export const TLE_SNAPSHOT_DIRS", "export function urlsForGroup"
// ============================================================================

const TLE_CACHE   = 'leo-catalog-tle-v1';
const TLE_TTL_MS  = 2 * 60 * 60 * 1000;
const HAS_CACHE   = typeof caches !== 'undefined';
let celestrakBlocked = false;
async function cacheRead(url) {
  if (!HAS_CACHE) return null;
  try {
    const hit = await (await caches.open(TLE_CACHE)).match(url);
    if (!hit) return null;
    const at = Number(hit.headers.get('x-fetched-at')) || 0;
    return { text: await hit.text(), fresh: Date.now() - at < TLE_TTL_MS };
  } catch (e) { return null; }
}
async function cacheWrite(url, text) {
  if (!HAS_CACHE) return;
  try {
    const c = await caches.open(TLE_CACHE);
    await c.put(url, new Response(text, { headers: { 'x-fetched-at': String(Date.now()) } }));
  } catch (e) {}
}
export async function fetchTLE(url, timeout = 8000) {
  const cached = await cacheRead(url);
  if (cached && cached.fresh) return cached.text;
  const isCelestrak = url.startsWith('https://celestrak.org/');
  if (isCelestrak && celestrakBlocked) {
    if (cached) return cached.text;
    throw new Error('CelesTrak blocked');
  }
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { mode: 'cors', signal: ctrl.signal });
    clearTimeout(id);
    if (isCelestrak && (res.status === 403 || res.status === 429)) celestrakBlocked = true;
    if (!res.ok) throw new Error('HTTP '+res.status);
    const text = await res.text();
    // CelesTrak answers a rate-limited request with 200 and a plain-text notice.
    if (!/^1 \d/m.test(text)) throw new Error('no TLE in response');
    cacheWrite(url, text);
    return text;
  } catch (e) {
    clearTimeout(id);
    // AbortError is the timeout; TypeError is a network or CORS failure.
    if (isCelestrak && (e.name === 'AbortError' || e.name === 'TypeError')) celestrakBlocked = true;
    if (cached) return cached.text;
    throw e;
  }
}

// The data/ folder is one level up from this module (core/ -> page folder).
export const TLE_SNAPSHOT_DIRS = [...new Set([
  new URL('../data/', import.meta.url).href,
  'https://davesgames.io/stella-nova/pages/leo-catalog/data/',
])];
const URL_GP = (group) => `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`;
export function urlsForGroup(group) {
  return [...TLE_SNAPSHOT_DIRS.map(d => d + group + '.txt'), URL_GP(group)];
}
