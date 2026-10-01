// ============================================================================
//  MATERIAL STUDIO  ·  editor/thumbs.js — node thumbnails and bake errors
// ────────────────────────────────────────────────────────────────────────────
//  Keeps one thumbnail per node from __studio.bake.thumb(nodeId). A
//  generation counter makes all thumbnails stale after a bake. Stale nodes
//  go into a queue that loads 8 thumbnails per 30 ms tick. The old image
//  stays on screen until the new one comes. The file also keeps the bake
//  error per node, which render.js draws as a red outline.
//
//  GREP TARGETS
//      thumbFor .......... current entry, queue a load when stale
//      wantThumb / pumpThumbs ... the load queue
//      staleThumbs ....... thumbGen++ (all thumbnails stale)
//      invalidateThumbs .. one node, or all (api)
//      errors ............ nodeId -> message
//      onBakeDone / onBakeError / onBakeThumb ... store event handlers
// ============================================================================
import { state } from '../store.js';
import { dirty } from './render.js';

const thumbs = new Map();   // nodeId -> {img, gen}
const thumbBusy = new Set();
const thumbQueue = new Set();
let thumbGen = 0, thumbTimer = 0;
export const errors = new Map();   // nodeId -> message

/** The thumbnail entry {img, gen} of a node; a stale or missing one is queued. */
export function thumbFor(id) {
  const t = thumbs.get(id);
  if (!t || t.gen !== thumbGen) wantThumb(id);
  return t;
}
function wantThumb(id) {
  const t = thumbs.get(id);
  if ((t && t.gen === thumbGen) || thumbBusy.has(id)) return;
  thumbQueue.add(id);
  if (!thumbTimer) thumbTimer = setTimeout(pumpThumbs, 30);
}
function pumpThumbs() {
  thumbTimer = 0;
  const bake = window.__studio?.bake;
  if (!bake || typeof bake.thumb !== 'function') { thumbQueue.clear(); return; }
  let n = 0;
  for (const id of thumbQueue) {
    if (n++ >= 8) break;
    thumbQueue.delete(id);
    const gen = thumbGen;
    thumbBusy.add(id);
    let r;
    try { r = bake.thumb(id); } catch (e) { r = null; }
    Promise.resolve(r).then(img => {
      thumbBusy.delete(id);
      if (img && typeof ImageData !== 'undefined' && img instanceof ImageData) {
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        c.getContext('2d').putImageData(img, 0, 0); img = c;
      }
      const old = thumbs.get(id);
      thumbs.set(id, { img: img || old?.img || null, gen });
      if (img) dirty();
    }, () => { thumbBusy.delete(id); thumbs.set(id, { img: thumbs.get(id)?.img || null, gen }); });
  }
  if (thumbQueue.size) thumbTimer = setTimeout(pumpThumbs, 30);
}

export function staleThumbs() { thumbGen++; }
export function invalidateThumbs(id) { if (id) thumbs.delete(id); else thumbGen++; dirty(); }

export function onBakeDone() { thumbGen++; errors.clear(); for (const e of state.compiled?.errors || []) if (e.nodeId) errors.set(e.nodeId, e.message); dirty(); }
export function onBakeError(p) { if (p?.nodeId) errors.set(p.nodeId, p.message || 'error'); dirty(); }
export function onBakeThumb(p) { if (p?.nodeId) { thumbs.delete(p.nodeId); dirty(); } }
