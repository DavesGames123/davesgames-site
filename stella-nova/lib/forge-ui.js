// ============================================================================
//  STELLA NOVA  ·  lib/forge-ui.js — squircle panels that unfold from a button
// ----------------------------------------------------------------------------
//  The motion of Forge, the modeller in Warp (warp_core/src/panels/forge/src/
//  ui/mod.rs header), written again for the DOM. Pairs with lib/forge-ui.css.
//
//  A PANEL UNFOLDS FROM ITS BUTTON. At t = 0 the panel is clipped to the
//  rect of the button that opened it; the clip grows to the whole panel. So
//  the panel comes OUT of the thing that was pressed. A close runs the same
//  move backwards into the button.
//
//  A PANEL IN MOTION TAKES NO CLICKS. The controls sit at their settled
//  places and the clip reveals them, but until the clip settles, the rect a
//  control shows and the rect it will have are different. So pointer-events
//  stay off until the animation ends (Forge HIT_T). The content fades in
//  after 45 % of the open (Forge CONTENT_T).
//
//  REDUCED MOTION, OR NO Element.animate (node, jsdom): every change is
//  instant, and the promise resolves at once.
//
//  GREP MAP
//    SQ_N / squirclePath ... the superellipse outline (the CSS mask source)
//    reducedMotion ......... the media query, safe without a window
//    unfold ................ open or close a panel from a button rect
//    measure / flip ........ animate list rows from their old places
// ============================================================================

export const SQ_N = 4;

// The outline of a size x size squircle-cornered square with corner radius r,
// as an SVG path. lib/forge-ui.css carries squirclePath() as its mask.
export function squirclePath(size = 100, r = 40, n = SQ_N, steps = 10) {
  const P = [];
  const corner = (cx, cy, q) => {
    for (let i = 0; i <= steps; i++) {
      const t = (q + i / steps) * Math.PI / 2, c = Math.cos(t), s = Math.sin(t);
      P.push([cx + r * Math.sign(c) * Math.abs(c) ** (2 / n), cy + r * Math.sign(s) * Math.abs(s) ** (2 / n)]);
    }
  };
  corner(size - r, size - r, 0); corner(r, size - r, 1); corner(r, r, 2); corner(size - r, r, 3);
  return 'M' + P.map(p => p.map(v => +v.toFixed(1)).join(' ')).join('L') + 'Z';
}

export function reducedMotion() {
  try { return !!(globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
}

const OPEN_MS = 360, CLOSE_MS = 220, CONTENT_T = 0.45;
const EASE_OUT = 'cubic-bezier(0.16,1,0.3,1)', EASE_IN = 'cubic-bezier(0.5,0,0.75,0)';

// Open or close `el`. from: the element (or a DOMRect) the panel grows out
// of. Resolves when the panel has settled. A later call cancels an earlier one.
export function unfold(el, { open = true, from = null, radius = 14, content = '.pb' } = {}) {
  if (!el) return Promise.resolve();
  if (el._unfold) { el._unfold.cancel(); el._unfold = null; }
  const shown = !el.hidden;
  if (open) el.hidden = false;
  el.classList.toggle('is-open', open);
  const can = typeof el.animate === 'function' && !reducedMotion();
  if (!can || (open && shown && !el._closing)) {
    if (!open) el.hidden = true;
    el._closing = false;
    return Promise.resolve();
  }
  if (!open && !shown) return Promise.resolve();
  const pr = el.getBoundingClientRect();
  let fr = from && (typeof from.getBoundingClientRect === 'function' ? from.getBoundingClientRect() : from);
  if (!fr || !fr.width) fr = { left: pr.left, right: pr.right, top: pr.top, bottom: pr.top + 1 };
  const W = pr.width, H = pr.height, clamp = (v, hi) => Math.max(0, Math.min(hi, v));
  let l = clamp(fr.left - pr.left, W - 2), r = clamp(pr.right - fr.right, W - 2);
  let t = clamp(fr.top - pr.top, H - 2), b = clamp(pr.bottom - fr.bottom, H - 2);
  if (l + r > W - 2) { const m = Math.min(l, W - 2); l = m; r = W - 2 - m; }
  if (t + b > H - 2) { const m = Math.min(t, H - 2); t = m; b = H - 2 - m; }
  const small = `inset(${t}px ${r}px ${b}px ${l}px round 8px)`, full = `inset(0px 0px 0px 0px round ${radius}px)`;
  el.style.pointerEvents = 'none';
  el._closing = !open;
  const anim = el.animate(open ? [{ clipPath: small, opacity: 0.6 }, { clipPath: full, opacity: 1 }] : [{ clipPath: full, opacity: 1 }, { clipPath: small, opacity: 0 }],
    { duration: open ? OPEN_MS : CLOSE_MS, easing: open ? EASE_OUT : EASE_IN });
  const inner = content && el.querySelector(content);
  if (inner && open) inner.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: OPEN_MS * (1 - CONTENT_T), delay: OPEN_MS * CONTENT_T, easing: EASE_OUT, fill: 'backwards' });
  el._unfold = anim;
  return anim.finished.then(() => {
    if (el._unfold !== anim) return;
    el._unfold = null; el._closing = false;
    el.style.pointerEvents = '';
    if (!open) el.hidden = true;
  }, () => { el.style.pointerEvents = ''; });
}

// FLIP: measure(pairs) before a change, flip(before, pairs) after it. pairs is
// a list of [key, element]; a key keeps its row across a rebuild.
export function measure(pairs) {
  const m = new Map();
  for (const [k, e] of pairs) if (e && e.isConnected) m.set(k, e.getBoundingClientRect());
  return m;
}
export function flip(before, pairs, ms = 260) {
  if (reducedMotion()) return;
  for (const [k, e] of pairs) {
    const a = before.get(k);
    if (!a || !e || typeof e.animate !== 'function') continue;
    const b = e.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
    if (Math.abs(dx) + Math.abs(dy) < 0.5) continue;
    e.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: ms, easing: EASE_OUT });
  }
}
