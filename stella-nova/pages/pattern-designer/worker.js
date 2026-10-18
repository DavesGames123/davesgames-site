// ============================================================================
//  PATTERN DESIGNER  ·  worker.js — runs patterns off the main thread
// ----------------------------------------------------------------------------
//  A module worker. One message is one job:
//    { id, job: { pat, P, seed, W, H, mods, D, detail, cap } }
//  D and detail are the Density and Detail controls (density.js), cap the
//  element cap of the device (density.js runCap). The reply is
//  { id, res: { items, clip, frame, capped, points, ms, cached } } or
//  { id, error }. The page keeps one worker for the artboard and one for
//  the explorer thumbnails, so a slow pattern does not hold up the other.
//
//  CACHE. The last results stay in a small cache keyed by the job, so a
//  step back to a pattern, a seed or a slider value shows at once. The
//  cache holds at most CACHE_N results and CACHE_POINTS points in all.
//
//  grep -n targets: "export function runJob", "function jobKey", "const CACHE_N"
// ============================================================================
import { PATTERNS } from './patterns/index.js';
import { run, CAP } from './engine.js';
import { applyModifiers } from './modifiers.js';

const CACHE_N = 8, CACHE_POINTS = 3000000;
const cache = new Map();
// The cache key. A text mask carries a large grid: its word, size and
// margin name it.
function jobKey(job) {
  const mods = (job.mods || []).map(m => m && m.text ? Object.assign({}, m, { text: `${m.word}|${m.text.grid ? m.text.grid.w + 'x' + m.text.grid.h : ''}` }) : m);
  return JSON.stringify([job.pat, job.P, job.seed, job.W, job.H, mods, job.D || 1, job.detail || 0, job.cap || null]);
}
export function runJob(job, useCache = false) {
  const key = useCache ? jobKey(job) : '';
  if (useCache && cache.has(key)) {
    const hit = cache.get(key); cache.delete(key); cache.set(key, hit);
    return Object.assign({}, hit, { cached: true });
  }
  const pat = PATTERNS.find(p => p.id === job.pat);
  if (!pat) throw new Error('no pattern ' + job.pat);
  const cap = job.cap || CAP;
  const r = run(pat, job.P, job.seed, job.W, job.H, cap, { D: job.D || 1, detail: job.detail || 0 });
  const m = applyModifiers(r.items, job.mods, job.W, job.H, job.seed, cap);
  const res = { items: m.items, clip: m.clip, frame: m.frame, capped: r.capped || m.capped, points: r.points, ms: r.ms };
  if (useCache) {
    cache.set(key, res);
    let pts = 0; for (const v of cache.values()) pts += v.points;
    for (const [k, v] of cache) { if (cache.size <= CACHE_N && pts <= CACHE_POINTS) break; if (k === key) continue; cache.delete(k); pts -= v.points; }
  }
  return res;
}
export const cacheSize = () => cache.size;
if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof document === 'undefined') {
  self.onmessage = e => {
    const { id, job } = e.data;
    try { self.postMessage({ id, res: runJob(job, true) }); }
    catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
  };
}
