// ============================================================================
//  THREAD ART  ·  saver-worker.js — computes saver pieces off the main thread
// ----------------------------------------------------------------------------
//  saver.js posts { id, spec, rgba } (rgba: the source at spec.res, RGBA).
//  The worker runs the greedy CPU step to the end (saver-core.js
//  makePiece) and posts { id, piece } with its buffers transferred, or
//  { id, error }. It holds no state between messages.
// ============================================================================
import { makePiece, pieceBuffers } from './saver-core.js';

self.onmessage = e => {
  const { id, spec, rgba } = e.data;
  try {
    const piece = makePiece(spec, rgba);
    self.postMessage({ id, piece }, pieceBuffers(piece));
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
