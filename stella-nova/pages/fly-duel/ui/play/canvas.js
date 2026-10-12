// ============================================================================
//  FLY DUEL  ·  play mode, card canvases  (ES module, DOM)
// ----------------------------------------------------------------------------
//  Every card in play mode is drawn by drawCard() / cardBack() of
//  ui/cardface.js, the same painter as the cards on the 3D table, so a card
//  in your hand looks like the card on the table. This file sizes a canvas
//  for the device pixel ratio, paints it, and paints it again when the
//  card picture loads (loadCardArt).
//
//  paintCard() remembers what it drew (card id, size, state) on the canvas
//  and skips a paint that would draw the same thing.
//
//  GREP MAP
//      grep -n 'export function paintCard'    face
//      grep -n 'export function paintBack'    back
//      grep -n 'export function cardCanvas'   new canvas + face
//      grep -n 'export function colourHex'    colour id -> hex
// ============================================================================
import * as CF from '../cardface.js';
import { TOKENS } from '../tokens.js';

const DPR_MAX = 3;
const dprNow = () => Math.min(DPR_MAX, Math.max(1, globalThis.devicePixelRatio || 1));

// colour id -> hex: ui/cardface.js colourInfo() when it is there, else the
// page tokens, else --none.
export function colourHex(k) {
  try { const i = CF.colourInfo?.(k); if (i?.hex) return i.hex; } catch { /* older cardface */ }
  return TOKENS[k] || TOKENS.none;
}

function size(cv, w, h) {
  const k = dprNow();
  const W = Math.round(w * k), H = Math.round(h * k);
  if (cv.width !== W) cv.width = W;
  if (cv.height !== H) cv.height = H;
  cv.style.width = `${w}px`;
  cv.style.height = `${h}px`;
  return k;
}

// Paint one face. state: the drawCard state flags. mode: 'auto' | 'thumb'
// | 'full' (auto: thumb below 180 CSS px).
export function paintCard(cv, card, { w, h, state = {}, mode = 'auto' } = {}) {
  if (!cv || !card) return;
  const key = `${card.id}|${w}x${h}|${mode}|${JSON.stringify(state)}|${CF.getCardArt?.(card.id) ? 1 : 0}`;
  if (cv._pk === key) return;
  cv._pk = key;
  const k = size(cv, w, h);
  const g = cv.getContext('2d');
  if (!g) return;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, cv.width, cv.height);
  const m = CF.cardMode ? CF.cardMode(mode, w * k, k) : 'full';
  CF.drawCard(g, card, { w: cv.width, h: cv.height, state, mode: m, dpr: k });
  if (!CF.getCardArt?.(card.id) && CF.loadCardArt) {
    const id = card.id;
    CF.loadCardArt(id).then(() => {
      if (cv._pk && cv._pk.startsWith(`${id}|`)) { cv._pk = ''; paintCard(cv, card, { w, h, state, mode }); }
    }).catch(() => {});
  }
}

export function paintBack(cv, { w, h } = {}) {
  const key = `back|${w}x${h}`;
  if (cv._pk === key) return;
  cv._pk = key;
  size(cv, w, h);
  const g = cv.getContext('2d');
  if (!g) return;
  g.clearRect(0, 0, cv.width, cv.height);
  CF.cardBack(g, { w: cv.width, h: cv.height });
}

export function cardCanvas(doc, card, opts) {
  const cv = doc.createElement('canvas');
  cv.className = 'pl-cv';
  paintCard(cv, card, opts);
  return cv;
}
