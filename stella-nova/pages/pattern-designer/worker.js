// ============================================================================
//  PATTERN DESIGNER  ·  worker.js — runs patterns off the main thread
// ----------------------------------------------------------------------------
//  A module worker. One message is one job:
//    { id, job: { pat, P, seed, W, H, mods } }
//  The reply is { id, res: { items, clip, frame, capped, points, ms } } or
//  { id, error }. The page keeps one worker for the artboard and one for
//  the explorer thumbnails, so a slow pattern does not hold up the other.
//  The node caps live in engine.js (CAP); modifiers.js keeps them too.
// ============================================================================
import { PATTERNS } from './patterns/index.js';
import { run } from './engine.js';
import { applyModifiers } from './modifiers.js';

export function runJob(job) {
  const pat = PATTERNS.find(p => p.id === job.pat);
  if (!pat) throw new Error('no pattern ' + job.pat);
  const r = run(pat, job.P, job.seed, job.W, job.H);
  const m = applyModifiers(r.items, job.mods, job.W, job.H, job.seed);
  return { items: m.items, clip: m.clip, frame: m.frame, capped: r.capped || m.capped, points: r.points, ms: r.ms };
}
if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof document === 'undefined') {
  self.onmessage = e => {
    const { id, job } = e.data;
    try { self.postMessage({ id, res: runJob(job) }); }
    catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
  };
}
