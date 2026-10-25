// ============================================================================
//  STRANDS · shots.js — saver shots and a DOM-free shot renderer
// ----------------------------------------------------------------------------
//  SAVER (CONTRACT.md phase 2) cuts a seeded shuffle across every package's
//  saverShots. Each shot here is plain data:
//    { id, scene, params, t0, seconds, label, tex, aspect }
//  t0       the scene time the shot starts at (the shot plays t0 .. t0 + seconds)
//  tex      one TeX line for the plate (text.js TEX)
//  aspect   the w / h the scene is laid out for; renderShot fits it in a box
//
//  renderShot(g, shot, t, box, opts) draws the shot at shot time t (0 at the
//  cut) into box { x, y, w, h } on a 2D context. The scene rect is the
//  largest rect of the shot aspect (or the box aspect, if the box is
//  narrower, as at 9:16) centred in the box, so the subject sits in the
//  clear band when the saver passes the band as the box. opts: { theme:
//  'dark' | 'light', calm, facts }. calm slows the clock to 0.6.
//
//  EXPORTS   (jump with grep -n "<anchor>" shots.js)
//    SAVER_SHOTS .. "export const SAVER_SHOTS"
//    renderShot ... "export function renderShot"
//    shotRect ..... "export function shotRect"
// ============================================================================
import { drawScene } from './scenes.js';
import { THEMES, drawBoard } from './paint.js';
import { TEX, ANALOGY } from './text.js';
import { facts as modelFacts } from './model-link.js';

export const SAVER_SHOTS = [
  { id: 'strands-pair-4', scene: 'pair', params: { d1: 4, d2: 4 }, t0: 0, seconds: 9, aspect: 1.5 },
  { id: 'strands-pair-32', scene: 'pair', params: { d1: 3, d2: 2 }, t0: 2, seconds: 8, aspect: 1.5 },
  { id: 'strands-swap-3', scene: 'swap', params: { d: 3 }, t0: 2.0, seconds: 11, aspect: 1.6 },
  { id: 'strands-swap-2', scene: 'swap', params: { d: 2 }, t0: 4.0, seconds: 8, aspect: 1.6 },
  { id: 'strands-read-qutrit', scene: 'read', params: { link: 'qutrit-qubit', basis: 0 }, t0: 0, seconds: 8.4, aspect: 1.5 },
  { id: 'strands-read-qubit', scene: 'read', params: { link: 'qubit-qutrit', basis: 1 }, t0: 0, seconds: 5.6, aspect: 1.5 },
  { id: 'strands-shared', scene: 'shared', params: { k: 3, copies: 'auto' }, t0: 1.5, seconds: 11, aspect: 1.25 },
  { id: 'strands-object-knot', scene: 'object', params: { stage: 'auto' }, t0: 0, seconds: 12, aspect: 1.5 },
  { id: 'strands-object-paths', scene: 'object', params: { stage: 'paths' }, t0: 0, seconds: 7, aspect: 1.5 },
  { id: 'strands-object-terms', scene: 'object', params: { stage: 'terms' }, t0: 0, seconds: 8, aspect: 1.5 },
  { id: 'strands-object-mirror', scene: 'object', params: { stage: 'weights' }, t0: 0, seconds: 7, aspect: 1.5 },
].map(s => ({ ...s, label: ANALOGY[s.scene].title, tex: TEX[s.scene] }));

/** The scene rect for a shot inside a box. */
export function shotRect(shot, box) {
  const want = shot.aspect || 1.5;
  const asp = Math.max(0.56, Math.min(want, box.w / Math.max(1, box.h)));
  let w = box.w, h = w / asp;
  if (h > box.h) { h = box.h; w = h * asp; }
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

export function renderShot(g, shot, t, box, opts = {}) {
  const th = THEMES[opts.theme] || THEMES.dark;
  drawBoard(g, th, box);
  const r = shotRect(shot, box);
  const k = opts.calm ? 0.6 : 1;
  return drawScene(g, shot.scene, shot.params, shot.t0 + t * k, r, { th, live: { plucks: [] }, facts: opts.facts || modelFacts(null) });
}
