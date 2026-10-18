// ============================================================================
//  PLANT GROWTH  ·  phone layout, gestures and the dock clock (no DOM)
// ----------------------------------------------------------------------------
//  main.js gives this module plain numbers and rects. The node tests reach
//  all of it (tests.mjs, "layout").
//
//  LAYOUT. PHONE_QUERY is the media query of the PHONE block in style.css.
//  layoutFor(w, h, coarse) says which layout a viewport gets: "desktop"
//  (panel at the left), "sheet" (bottom sheet in portrait) or "drawer"
//  (right drawer on a short landscape touch screen).
//
//  OCCLUSION. occlusion(rects, w, h) turns the rects of the overlays into
//  margins of the canvas that they cover. An overlay wider than tall covers
//  the top or the base, any other covers a side. It counts only when it
//  spans half of that edge or more. clearFractions(o, w, h) gives the part
//  of the height and width that stays clear, for saver.js fitDistance.
//
//  GESTURES. createGestures() reads pointer events of the canvas. One
//  finger (or the left mouse button) orbits and keeps "follow" on, so the
//  framing still follows the growth of the crown. Two fingers (pinch or
//  pan), a wheel, a right drag or a modifier drag set the view by hand, so
//  they turn follow off. A double tap turns follow on again. A double tap
//  is two short taps of one finger, near each other, close in time. A
//  pinch is never a double tap.
//
//  CLOCK. dockClock(t, seasonOf) gives the text of the dock clock: the
//  year, the month and the season, and the part of the year done.
//
//  ECO LIMITS. ecoLimits(coarse) gives the caps of the ground ecosystem
//  (eco.js buildEco): grass tussocks (8 blades each), forbs, stones, leaf
//  litter, woodland trees, seedlings, and the mesh LOD of the nature pack.
//  A coarse pointer (a phone or a tablet) gets the phone caps.
//
//  PIXEL RATIO. pixelRatioStep(state, dt) lowers the pixel ratio of a
//  phone by steps of 0.25 (to 1) when frames are slow for 2 s.
//
//  grep -n targets
//    phone query .......... "export const PHONE_QUERY"
//    layout ............... "export function layoutFor"
//    occlusion ............ "export function occlusion"
//    clear fractions ...... "export function clearFractions"
//    gestures ............. "export function createGestures"
//    dock clock ........... "export function dockClock"
//    species cycle ........ "export function nextId"
//    eco limits ........... "export const ECO_LIMITS"
//    pixel ratio .......... "export function pixelRatioStep"
// ============================================================================

export const PHONE_QUERY = '(max-width:768px), (max-height:500px) and (pointer:coarse)';

export function layoutFor(w, h, coarse) {
  const phone = w <= 768 || (h <= 500 && !!coarse);
  if (!phone) return 'desktop';
  return h <= 500 && w > h ? 'drawer' : 'sheet';
}

// rects: [{ left, top, right, bottom }] in CSS px of the viewport.
export function occlusion(rects, w, h) {
  const o = { l: 0, r: 0, t: 0, b: 0 };
  for (const q of rects) {
    if (!q) continue;
    const x0 = Math.max(0, q.left), x1 = Math.min(w, q.right), y0 = Math.max(0, q.top), y1 = Math.min(h, q.bottom);
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;
    const fw = (x1 - x0) / w, fh = (y1 - y0) / h;
    if (fw >= fh) {
      if (fw < 0.5) continue;
      if (y0 + y1 > h) o.b = Math.max(o.b, h - y0); else o.t = Math.max(o.t, y1);
    } else {
      if (fh < 0.5) continue;
      if (x0 + x1 < w) o.l = Math.max(o.l, x1); else o.r = Math.max(o.r, w - x0);
    }
  }
  return o;
}

// The clear part of the frame, as fractions. A floor of 0.3 keeps the fit
// finite when a full-height sheet covers most of the frame.
export function clearFractions(o, w, h) {
  return { hF: Math.max(0.3, (h - o.t - o.b) / h), wF: Math.max(0.3, (w - o.l - o.r) / w) };
}

// Pointer gestures on the canvas. Each method gets a plain event object:
// { id, type ('touch' | 'mouse' | 'pen'), x, y, t (ms), button, mod }.
// The return value is null or { follow: true | false }.
export function createGestures(opt = {}) {
  const TAP_MS = opt.tapMs ?? 260, GAP_MS = opt.gapMs ?? 340, MOVE = opt.move ?? 12, NEAR = opt.near ?? 36;
  const live = new Map();
  let multi = false, lastTap = null;
  return {
    down(e) {
      live.set(e.id, { x: e.x, y: e.y, t: e.t, moved: false });
      if (live.size >= 2) { multi = true; lastTap = null; return { follow: false }; }
      if (e.type !== 'touch' && (e.button !== 0 || e.mod)) return { follow: false };
      return null;
    },
    move(e) {
      const p = live.get(e.id); if (!p) return null;
      if (Math.hypot(e.x - p.x, e.y - p.y) > MOVE) p.moved = true;
      return null;
    },
    up(e) {
      const p = live.get(e.id); live.delete(e.id);
      if (!p) return null;
      const wasMulti = multi;
      if (live.size === 0) multi = false;
      if (wasMulti || e.type !== 'touch') return null;
      const tap = !p.moved && e.t - p.t <= TAP_MS && Math.hypot(e.x - p.x, e.y - p.y) <= MOVE;
      if (!tap) { lastTap = null; return null; }
      if (lastTap && e.t - lastTap.t <= GAP_MS && Math.hypot(e.x - lastTap.x, e.y - lastTap.y) <= NEAR) {
        lastTap = null;
        return { follow: true };
      }
      lastTap = { x: e.x, y: e.y, t: e.t };
      return null;
    },
    cancel(e) { live.delete(e.id); if (live.size === 0) multi = false; lastTap = null; return null; },
    wheel() { return { follow: false }; },
    get pointers() { return live.size; },
  };
}

const SHORT = { January: 'Jan', February: 'Feb', March: 'Mar', April: 'Apr', May: 'May', June: 'Jun', July: 'Jul', August: 'Aug', September: 'Sep', October: 'Oct', November: 'Nov', December: 'Dec' };
export function dockClock(t, seasonOf) {
  const se = seasonOf(Math.max(0, t));
  return {
    year: `Year ${se.year + 1}`,
    sub: `${SHORT[se.month] || se.month} · ${se.season}`,
    season: se.season,
    frac: Math.max(0, Math.min(1, se.p)),
    label: `Year ${se.year + 1}, ${se.month}, ${se.season}`,
  };
}

export function nextId(ids, id, step = 1) {
  const i = ids.indexOf(id);
  return ids[((i < 0 ? 0 : i + step) % ids.length + ids.length) % ids.length];
}

// state: { ratio, min, slow (s), acc (s) }. dt in s. Returns the new
// ratio when it changes, else 0. A frame slower than 1/24 s counts as slow.
export function pixelRatioStep(st, dt) {
  if (st.ratio <= st.min) return 0;
  if (dt > 1 / 24) st.slow += dt; else st.slow = Math.max(0, st.slow - dt * 0.5);
  if (st.slow < 2) return 0;
  st.slow = 0;
  st.ratio = Math.max(st.min, Math.round((st.ratio - 0.25) * 100) / 100);
  return st.ratio;
}

export const ECO_LIMITS = {
  desktop: { tussocks: 26000, forbs: 700, stones: 1400, litter: 7000, woodland: 520, seedlings: 160, lod: 1, R: 24 },
  phone: { tussocks: 9000, forbs: 260, stones: 500, litter: 2200, woodland: 220, seedlings: 60, lod: 2, R: 20 },
};
export function ecoLimits(coarse) { return coarse ? ECO_LIMITS.phone : ECO_LIMITS.desktop; }
