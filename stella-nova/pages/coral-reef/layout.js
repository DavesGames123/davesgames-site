// ============================================================================
//  CORAL REEF  ·  phone layout and touch logic (no DOM, node tests reach it)
// ----------------------------------------------------------------------------
//  main.js and shell.js call these functions. tests.mjs and mobile-check.mjs
//  test them at 360x740, 390x844, 430x932, 768x1024 and 844x390.
//
//  LAYOUT. Three forms, the same as the media queries of style.css:
//    desktop ... the panel at the left, no dock
//    sheet ..... portrait phone: the dock at the base, the panel a bottom
//                sheet above the dock, at half or full height
//    drawer .... landscape phone: the dock at the lower left, the panel a
//                drawer at the right edge
//
//  GREP MAP
//    grep -n 'export const PHONE_QUERY'    the media query (style.css PHONE)
//    grep -n 'export function layoutFor'   the form for a viewport
//    grep -n 'export function overlayRects' the dock and panel rects of a form
//    grep -n 'export function clearFromRects' the px under the overlays
//    grep -n 'export function sheetSnap'   the drag of the sheet grip
//    grep -n 'export function tapGesture'  tap, double tap or a drag
//    grep -n 'export function pixelRatio'  the capped device pixel ratio
//    grep -n 'export function nextPreset'  the dock preset button
// ============================================================================

export const PHONE_QUERY = '(max-width:768px), (max-height:500px) and (pointer:coarse)';
export const DOCK_H = 64;          // px, without the safe-area inset
export const SHEET_HALF = 0.46;    // the half sheet: 46% of the height, 500 px at most
export const SHEET_HALF_MAX = 500;
export const SHEET_FULL_GAP = 40;  // the full sheet stops 40 px below the top
export const DRAWER_W = 0.46;      // the landscape drawer: 46% of the width, 380 px at most
export const DRAWER_MAX = 380;
export const DOCK_LAND_W = 0.58;   // the landscape dock: 58% of the width, 460 px at most
export const DOCK_LAND_MAX = 460;

// The form for a viewport. Same logic as PHONE_QUERY and the LANDSCAPE block.
export function layoutFor({ w, h, coarse = false }) {
  const phone = w <= 768 || (h <= 500 && coarse);
  if (!phone) return 'desktop';
  return h <= 500 && w > h ? 'drawer' : 'sheet';
}

// The dock and the panel as rects ({ x0, y0, x1, y1 } in px) for a form.
// sheet: 'closed' | 'half' | 'full'. inset: the safe-area inset at the base.
export function overlayRects({ w, h, coarse = false, sheet = 'closed', inset = 0, panelW = 300 }) {
  const form = layoutFor({ w, h, coarse }), out = [];
  if (form === 'desktop') {
    if (sheet !== 'closed') out.push({ x0: 0, y0: 0, x1: panelW, y1: h });
    return { form, rects: out };
  }
  const dh = DOCK_H + inset;
  if (form === 'sheet') {
    out.push({ x0: 0, y0: h - dh, x1: w, y1: h });
    if (sheet !== 'closed') {
      const sh = sheet === 'full' ? h - dh - SHEET_FULL_GAP : Math.min(SHEET_HALF * h, SHEET_HALF_MAX);
      out.push({ x0: 0, y0: h - dh - sh, x1: w, y1: h - dh });
    }
  } else {
    out.push({ x0: 0, y0: h - dh, x1: Math.min(DOCK_LAND_W * w, DOCK_LAND_MAX), y1: h });
    if (sheet !== 'closed') out.push({ x0: w - Math.min(DRAWER_W * w, DRAWER_MAX), y0: 0, x1: w, y1: h });
  }
  return { form, rects: out };
}

// Px of the canvas under the overlays at each edge ({ l, r, t, b }). An
// overlay wider than tall (in canvas terms) covers the top or the base; any
// other covers a side. It covers the edge that it is nearer to, after the
// overlays at that edge (the sheet sits on the dock, so it covers the
// base). An overlay that covers less than half of its edge (a corner box)
// does not count. An overlay that leaves less than MIN_CLEAR of the canvas
// clear (the full sheet) does not count: the reef keeps the last framing.
export const MIN_CLEAR = 0.2;
export function clearFromRects(rects, w, h) {
  const o = { l: 0, r: 0, t: 0, b: 0 };
  const list = rects.map(q => {
    const x0 = Math.max(0, q.x0), x1 = Math.min(w, q.x1), y0 = Math.max(0, q.y0), y1 = Math.min(h, q.y1);
    return { x0, x1, y0, y1, edge: Math.min(y0, h - y1, x0, w - x1) };
  }).sort((a, b) => a.edge - b.edge);
  for (const { x0, x1, y0, y1 } of list) {
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;
    const fw = (x1 - x0) / w, fh = (y1 - y0) / h;
    if (fw >= fh) {
      if (fw < 0.5) continue;
      const base = (h - o.b) - y1 <= y0 - o.t;
      const t = base ? o.t : Math.max(o.t, y1), b = base ? Math.max(o.b, h - y0) : o.b;
      if (h - t - b < MIN_CLEAR * h) continue;
      o.t = t; o.b = b;
    } else {
      if (fh < 0.5) continue;
      const right = (w - o.r) - x1 <= x0 - o.l;
      const l = right ? o.l : Math.max(o.l, x1), r = right ? Math.max(o.r, w - x0) : o.r;
      if (w - l - r < MIN_CLEAR * w) continue;
      o.l = l; o.r = r;
    }
  }
  return o;
}

// The sheet state after a drag of the grip by dy px (down is positive).
// A short drag (a tap) toggles half and full.
export function sheetSnap(state, dy) {
  if (Math.abs(dy) < 8) return state === 'full' ? 'half' : 'full';
  if (dy < -40) return 'full';
  if (dy > 40) return state === 'full' ? 'half' : 'closed';
  return state;
}

// The gesture of a pointer that went up: 'drag' (an orbit or a pinch),
// 'tap', or 'double' (a second tap near the first, soon after it).
// down, up: { x, y, t }. prev: the last tap ({ x, y, t }) or null.
export const TAP_MOVE = 10, TAP_MS = 450, DOUBLE_MS = 320, DOUBLE_PX = 36;
export function tapGesture(down, up, prev) {
  if (!down || Math.hypot(up.x - down.x, up.y - down.y) >= TAP_MOVE || up.t - down.t >= TAP_MS) return 'drag';
  if (prev && up.t - prev.t < DOUBLE_MS && Math.hypot(up.x - prev.x, up.y - prev.y) < DOUBLE_PX) return 'double';
  return 'tap';
}

// The device pixel ratio for the renderer. A touch screen gets at most 1.6
// and at most 2.2 M drawn pixels; a desktop gets at most 2 and 8.3 M.
export function pixelRatio(dpr, w, h, coarse) {
  const cap = coarse ? 1.6 : 2, px = coarse ? 2.2e6 : 8.3e6;
  const r = Math.min(dpr || 1, cap, Math.sqrt(px / Math.max(1, w * h)));
  return Math.max(0.75, Math.round(r * 100) / 100);
}

// The preset after cur in ids (the dock preset button cycles them).
export function nextPreset(ids, cur) {
  const i = ids.indexOf(cur);
  return ids[(i + 1) % ids.length];
}
