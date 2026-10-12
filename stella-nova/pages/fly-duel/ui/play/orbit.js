// ============================================================================
//  FLY DUEL  ·  play mode, orbit gestures on the 3D table  (ES module, DOM)
// ----------------------------------------------------------------------------
//  In play mode the player can turn the seat camera. The gestures are on
//  the table box (the box that holds the scene canvas):
//      drag (one pointer)     turn about the seat look point
//      pinch (two pointers)   zoom
//      wheel                  zoom
//  The clamps are in ui/fly3d/director.js ORBIT. The scene does the turn
//  (scene.orbitBy, zoomBy, seatView).
//
//  TAP OR DRAG. classifyGesture() tells a tap from a drag by the distance
//  and the time. A pointer that moves less than TAP.move px (TAP.moveTouch
//  on touch) is not a drag, and the camera does not turn. A drag gives no
//  pick: the click after it is eaten (consumeDrag). A tap is a short press
//  (TAP.ms) that did not move: it picks a card as before. A long press
//  that did not move is a 'hold' (the long-press inspect of play.js).
//
//  BACK TO THE SEAT. While the camera is away from the seat (orbiting),
//  a double tap or double click on empty table (no card and no fly under
//  both taps, scene.pickPermanent) puts it back: seat(). The click of the
//  second tap is eaten, so it picks nothing. play.js adds the "Back to my
//  seat" button and the C key (user: "its also very hard to get back to
//  first person perspective if you dont know what you're doing").
//
//  The hand is a sibling box (ui/play/hand.js), so a drag of a hand card
//  to play never reaches these listeners. blocked() (hand.dragging) is a
//  second guard.
//
//  GREP MAP
//      grep -n 'export const TAP'              tap limits
//      grep -n 'export function classifyGesture'  tap | drag | hold
//      grep -n 'export const WHEEL'            wheel zoom rate
//      grep -n 'export function isDoubleTap'   two taps -> back to the seat
//      grep -n 'export function wheelZoom'     wheel delta -> factor
//      grep -n 'export function attachOrbit'   the DOM listeners
// ============================================================================

export const TAP = { move: 8, moveTouch: 14, ms: 420 };
export const WHEEL = { perPx: 0.0015, max: 1.5 };
export const DOUBLE = { ms: 380, px: 28 };

// Two taps { x, y, t } (t in ms) make a double tap when the second comes
// soon after the first and near it.
export function isDoubleTap(a, b) {
  if (!a || !b) return false;
  const dt = b.t - a.t;
  return dt >= 0 && dt <= DOUBLE.ms && Math.hypot(b.x - a.x, b.y - a.y) <= DOUBLE.px;
}

// { dx, dy, ms, touch, pointers } -> 'tap' | 'drag' | 'hold'
export function classifyGesture({ dx = 0, dy = 0, ms = 0, touch = false, pointers = 1 } = {}) {
  if (pointers > 1) return 'drag';
  const lim = touch ? TAP.moveTouch : TAP.move;
  if (Math.hypot(dx, dy) > lim) return 'drag';
  return ms <= TAP.ms ? 'tap' : 'hold';
}

// A wheel delta (px) -> a zoom factor for scene.zoomBy, limited per event.
export function wheelZoom(deltaY, deltaMode = 0) {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const k = Math.exp(px * WHEEL.perPx);
  return Math.max(1 / WHEEL.max, Math.min(WHEEL.max, k));
}

// el: the table box. scene: { orbitBy, zoomBy, seatView, pickPermanent? }.
// opts: { blocked() -> true while a hand card drags, onChange(orbiting),
// empty(x, y) -> true on empty table (default: scene.pickPermanent finds
// nothing) }.
// Returns { consumeDrag(), seat(), get orbiting, dispose() }.
export function attachOrbit(el, scene, opts = {}) {
  const pts = new Map();
  let g = null;                      // the gesture of the pointers down
  let ate = false, orbiting = false;
  let lastTap = null;                // the last tap on empty table
  const empty = (x, y) => {
    try {
      if (opts.empty) return !!opts.empty(x, y);
      return !scene.pickPermanent?.(x, y);
    } catch { return false; }
  };
  const blocked = () => { try { return !!opts.blocked?.(); } catch { return false; } };
  const setOrbiting = v => { if (v !== orbiting) { orbiting = v; opts.onChange?.(v); } };
  const pinchD = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };

  function down(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (blocked()) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) g = { x0: e.clientX, y0: e.clientY, t0: performance.now(), touch: e.pointerType === 'touch', drag: false, pointers: 1 };
    else if (g) { g.pointers = Math.max(g.pointers, pts.size); g.drag = true; g.pinch = pinchD(); }
  }
  function move(e) {
    const p = pts.get(e.pointerId);
    if (!p || !g) return;
    if (blocked()) { pts.clear(); g = null; return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pts.size >= 2) {
      const d = pinchD();
      if (g.pinch) { scene.zoomBy?.(g.pinch / d); setOrbiting(true); }
      g.pinch = d;
      return;
    }
    if (!g.drag && classifyGesture({ dx: e.clientX - g.x0, dy: e.clientY - g.y0, ms: 0, touch: g.touch }) === 'drag') g.drag = true;
    if (g.drag && scene.orbitBy?.(dx, dy)) setOrbiting(true);
  }
  function up(e) {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size === 0 && g) {
      const kind = g.drag ? 'drag' : classifyGesture({ dx: e.clientX - g.x0, dy: e.clientY - g.y0, ms: performance.now() - g.t0, touch: g.touch, pointers: g.pointers });
      if (kind === 'drag') ate = true;
      if (kind === 'tap') {
        const tap = { x: e.clientX, y: e.clientY, t: performance.now() };
        const onEmpty = empty(tap.x, tap.y);
        if (orbiting && onEmpty && isDoubleTap(lastTap, tap)) { ate = true; lastTap = null; seat(); }
        else lastTap = onEmpty ? tap : null;
      } else lastTap = null;
      g = null;
    } else if (g) g.pinch = null;
  }
  function wheel(e) {
    if (blocked()) return;
    e.preventDefault();
    if (scene.zoomBy?.(wheelZoom(e.deltaY, e.deltaMode))) setOrbiting(true);
  }
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', wheel, { passive: false });
  function seat() { scene.seatView?.(); setOrbiting(false); }
  return {
    // true once after a drag or a double tap: the click handler skips
    // its pick
    consumeDrag() { const a = ate; ate = false; return a; },
    seat,
    get orbiting() { return orbiting; },
    dispose() {
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
    },
  };
}
