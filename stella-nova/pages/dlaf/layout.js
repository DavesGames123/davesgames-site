// ============================================================================
//  DLAF PAGE  ·  layout.js — phone layout, framing and touch maths (no DOM)
// ----------------------------------------------------------------------------
//  DOM-free. main.js, tests.mjs and tests-dom.mjs use it. The numbers here
//  agree with the PHONE and LANDSCAPE blocks of style.css:
//
//    phone      max-width 768, or max-height 500 on a coarse pointer
//    portrait   a phone that is not landscape: dock at the base, the panel
//               is a bottom sheet (half or full height) above the dock
//    landscape  a phone with max-height 500 and width > height: the panel
//               is a drawer on the right, the dock is a tab at the lower left
//    desktop    the panel is on the left
//
//  grep -n targets
//    media queries ......... "export const PHONE_QUERY"
//    layout kind ........... "export function layoutKind"
//    framing margins ....... "export function occlusionOf"
//    overlay model ......... "export function overlayRects"
//    pixel ratio cap ....... "export function dprCap"
//    pinch and pan (2D) .... "export function pinch2D"
//    sheet snap ............ "export function sheetSnap"
//    dock items ............ "export const DOCK_ITEMS"
// ============================================================================

// The media query of the PHONE block (style.css) and of PHONE_Q (main.js).
export const PHONE_QUERY = '(max-width:768px), (max-height:500px) and (pointer:coarse)';
// The media query of the LANDSCAPE block (style.css).
export const LANDSCAPE_QUERY = '(max-height:500px) and (orientation:landscape) and (max-width:768px), (max-height:500px) and (orientation:landscape) and (pointer:coarse)';

// The dock, left to right: id and what one tap does.
export const DOCK_ITEMS = Object.freeze([
  { id: 'dockPanel', does: 'open or close the controls' },
  { id: 'dockPreset', does: 'choose a hook preset' },
  { id: 'dockSurf', does: 'switch Lines and Surface' },
  { id: 'dockRegrow', does: 'regrow' },
  { id: 'dockPlay', does: 'pause or grow' },
]);

// Minimum touch target and text size (CSS px) on a coarse pointer.
export const TOUCH_PX = 44, MIN_TEXT_PX = 11;

// v = { w, h, coarse }. The same test as PHONE_QUERY and LANDSCAPE_QUERY.
export function isPhone(v) { return v.w <= 768 || (v.h <= 500 && !!v.coarse); }
export function layoutKind(v) {
  if (!isPhone(v)) return 'desktop';
  return v.h <= 500 && v.w > v.h ? 'landscape' : 'portrait';
}

// Evaluate a media query list (the subset that style.css uses: max-width,
// max-height, min-width, pointer, orientation, "and", ",") for v.
export function matchQuery(q, v) {
  return q.split(',').some(part => part.trim().split(/\s+and\s+/).every(t => {
    const m = /\(\s*([a-z-]+)\s*:\s*([a-z0-9.]+)\s*\)/.exec(t);
    if (!m) return false;
    const [, f, val] = m, n = parseFloat(val);
    if (f === 'max-width') return v.w <= n;
    if (f === 'min-width') return v.w >= n;
    if (f === 'max-height') return v.h <= n;
    if (f === 'min-height') return v.h >= n;
    if (f === 'pointer') return (val === 'coarse') === !!v.coarse;
    if (f === 'orientation') return (val === 'landscape') === (v.w > v.h);
    return false;
  }));
}

// Framing margins { l, r, t, b } in CSS px from overlay rects (each
// { left, right, top, bottom }, in a w x h canvas). Each overlay removes the
// edge strip that costs the least area: a sheet at the base cuts the base,
// a drawer cuts the right side, the walker caption at the lower right of a
// landscape phone cuts the base or the right side. A rect off screen (a
// closed sheet or drawer) cuts nothing.
export function occlusionOf(rects, w, h) {
  const o = { l: 0, r: 0, t: 0, b: 0 };
  for (const q of rects) {
    if (!q) continue;
    const x0 = Math.max(0, q.left), x1 = Math.min(w, q.right), y0 = Math.max(0, q.top), y1 = Math.min(h, q.bottom);
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;
    const cut = [['l', x1, x1 * h], ['r', w - x0, (w - x0) * h], ['t', y1, y1 * w], ['b', h - y0, (h - y0) * w]];
    let best = cut[0];
    for (const c of cut) if (c[2] < best[2]) best = c;
    o[best[0]] = Math.max(o[best[0]], best[1]);
  }
  return o;
}

// The overlay rects of style.css for viewport v (no safe-area insets), with
// the panel open at sheet 'half' or 'full', or closed. The tests frame the
// cluster with them. Values follow style.css: dock 64, status 30, topbar 48,
// legend strip 40, sheet min(50% h, 540), full sheet h - dock - 40,
// drawer min(46% w, 380), landscape dock tab min(460, 58% w).
export function overlayRects(v, o = {}) {
  const { w, h } = v, kind = layoutKind(v), sheet = o.sheet || 'closed', walk = !!o.walk;
  const R = (left, top, right, bottom) => ({ left, top, right, bottom });
  const out = {};
  if (kind === 'desktop') {
    const pw = 300, open = sheet !== 'closed';
    out.topbar = R(0, 0, w, 52);
    if (open) out.panel = R(0, 0, pw, h);
    out.status = R(open ? pw : 0, h - 36, w, h);
    if (walk) { const l = open ? pw : 0, cw = Math.min(560, w - l - 32), cx = l + (w - l) / 2; out.walkCap = R(cx - cw / 2, h - 48 - 120, cx + cw / 2, h - 48); }
    return out;
  }
  const dock = 64;
  if (kind === 'landscape') {
    out.dock = R(0, h - dock, Math.min(460, w * 0.58), h);
    if (sheet !== 'closed') out.panel = R(w - Math.min(w * 0.46, 380), 0, w, h);
    else if (walk) out.walkCap = R(w - 10 - Math.min(340, w * 0.4), h - 10 - 150, w - 10, h - 10);
    return out;
  }
  out.topbar = R(0, 0, w, 48);
  out.legend = R(10, 50, w - 10, 90);
  out.dock = R(0, h - dock, w, h);
  out.status = R(0, h - dock - 30, w, h - dock);
  if (sheet === 'half') out.panel = R(0, h - dock - Math.min(h * 0.5, 540), w, h - dock);
  else if (sheet === 'full') out.panel = R(0, 40, w, h - dock);
  else if (walk) out.walkCap = R(10, h - dock - 34 - 150, w - 10, h - dock - 34);
  return out;
}

// The device pixel ratio for the drawing buffer. Phones draw the SDF
// surface (PBR, a shadow map, contact AO) at 1.5 at most, and the lines
// and dots at 2 at most. A desktop draws at 2 at most.
export function dprCap(o = {}) {
  const d = Math.max(1, o.dpr || 1);
  return Math.min(d, o.phone && o.surface ? 1.5 : 2);
}

// One step of a two-finger gesture on the 2D view. base is the eased fit
// { cx, cy, scale, ox, oy } (S.view), user is { zoom, panX, panY }. a0, b0
// are the two touch points of the last event, a1, b1 of this one ([x, y]
// CSS px in a w x h canvas). The world point under the old midpoint goes
// under the new midpoint (pan), and the zoom scales by the spread ratio.
// Returns a new { zoom, panX, panY }. The same call with a0 = a1 and
// b0 = b1 offset by the wheel ratio zooms at the cursor.
export function pinch2D(base, user, a0, b0, a1, b1, w, h, lim = [0.3, 30]) {
  const d0 = Math.hypot(a0[0] - b0[0], a0[1] - b0[1]), d1 = Math.hypot(a1[0] - b1[0], a1[1] - b1[1]);
  const ratio = d0 > 1 ? d1 / d0 : 1;
  return zoomAt(base, user, [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2], [(a1[0] + b1[0]) / 2, (a1[1] + b1[1]) / 2], ratio, w, h, lim);
}

// Zoom by ratio so that the world point under m0 goes under m1.
export function zoomAt(base, user, m0, m1, ratio, w, h, lim = [0.3, 30]) {
  const s0 = base.scale * user.zoom;
  const zoom = Math.min(lim[1], Math.max(lim[0], user.zoom * ratio));
  const s1 = base.scale * zoom;
  const wx = base.cx + user.panX + (m0[0] - w / 2 - base.ox) / s0;
  const wy = base.cy + user.panY - (m0[1] - h / 2 - base.oy) / s0;
  return {
    zoom,
    panX: wx - (m1[0] - w / 2 - base.ox) / s1 - base.cx,
    panY: wy + (m1[1] - h / 2 - base.oy) / s1 - base.cy,
  };
}

// World point to CSS px for the 2D view (the inverse of zoomAt's maths, the
// same map as camera.js ortho2D).
export function screen2D(base, user, p, w, h) {
  const s = base.scale * user.zoom;
  return [w / 2 + base.ox + (p[0] - base.cx - user.panX) * s, h / 2 + base.oy - (p[1] - base.cy - user.panY) * s];
}

// The sheet state after a drag on the grip by dy CSS px (down is +).
// state is 'half' or 'full'. A tap (|dy| < 8) toggles half and full.
export function sheetSnap(state, dy) {
  if (Math.abs(dy) < 8) return state === 'full' ? 'half' : 'full';
  if (dy < -40) return 'full';
  if (dy > 40) return state === 'full' ? 'half' : 'closed';
  return state;
}
