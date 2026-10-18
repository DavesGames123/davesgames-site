// ============================================================================
//  DLA TERRAIN  ·  layout.js — the phone layout as numbers (no DOM)
// ----------------------------------------------------------------------------
//  style.css draws the layout. This file holds the same numbers, so node
//  tests can check each viewport, and main.js uses the clear-rect maths to
//  frame the terrain in the part of the screen that no panel covers.
//
//    layoutMode(w, h, coarse) -> 'wide' | 'sheet' | 'drawer'
//        wide    a left column (desktop, a landscape tablet)
//        sheet   a bottom sheet over the dock (phone or tablet in portrait)
//        drawer  a right drawer and a short dock (phone in landscape)
//        The rule is PHONE_Q of ui.js and the LANDSCAPE block of style.css.
//    DOCK_H, STATUS_H, TOP_H, GRIP_H, SHEET_MAX, DRAWER_MAX, DOCK_LAND_MAX
//        the CSS sizes in px (tests compare them with style.css)
//    sheetHeights(h, inset) -> { half, full }   the two sheet stops in px
//    snapSheet(px, stops) -> 'closed' | 'half' | 'full'   the stop nearest
//        to a sheet height at the end of a grip drag
//    layoutRects(w, h, o) -> { mode, top, dock, status, panel, map }
//        o = { coarse, panel: 'closed' | 'half' | 'full', inset: { t, r, b, l } }
//        each rect is { x, y, w, h } in CSS px, or null when not shown
//    clearRect(w, h, rects) -> { l, t, r, b, x, y, w, h }
//        the margins that the bars cover (the rule of wave-membrane
//        occlusion(): a rect counts only when it spans half of its edge)
//    centreShift(clear, w, h) -> [sx, sy]   the NDC shift that moves the
//        image centre to the centre of the clear rect (cam.matrices shift)
//
//  grep -n targets: "export function layoutMode", "export function clearRect",
//  "export function layoutRects", "export function snapSheet"
// ============================================================================

export const PHONE_W = 768, SHORT_H = 500;
export const DOCK_H = 64, STATUS_H = 26, TOP_H = 44, GRIP_H = 30;
export const SHEET_MAX = 540, SHEET_K = 0.48, SHEET_GAP = 40;
export const DRAWER_MAX = 400, DRAWER_K = 0.46, DOCK_LAND_MAX = 460;
export const MAP_PHONE = 132, MAP_LAND = 112, PANEL_W = 320;

const ins = o => ({ t: 0, r: 0, b: 0, l: 0, ...(o || {}) });

export function layoutMode(w, h, coarse) {
  const land = w > h;
  if (h <= SHORT_H && land && (coarse || w <= PHONE_W)) return 'drawer';
  if (w <= PHONE_W || (h <= SHORT_H && coarse)) return 'sheet';
  return 'wide';
}

export function sheetHeights(h, inset) {
  const i = ins(inset);
  const dock = DOCK_H + i.b;
  return { half: Math.min(h * SHEET_K, SHEET_MAX), full: Math.max(0, h - dock - SHEET_GAP) };
}

// the stop nearest to px; under 60% of the half stop the sheet closes
export function snapSheet(px, stops) {
  if (px < stops.half * 0.6) return 'closed';
  return px < (stops.half + stops.full) / 2 ? 'half' : 'full';
}

export function layoutRects(w, h, o = {}) {
  const i = ins(o.inset), mode = layoutMode(w, h, !!o.coarse);
  const open = o.panel && o.panel !== 'closed';
  const R = (x, y, rw, rh) => ({ x, y, w: rw, h: rh });
  if (mode === 'wide') {
    return {
      mode, top: R(0, 0, w, 52), dock: null, status: R(open ? PANEL_W : 0, h - 34, w - (open ? PANEL_W : 0), 34),
      panel: open ? R(0, 0, PANEL_W, h) : null, map: R(w - 14 - 220, h - 34 - 12 - 240, 220, 240),
    };
  }
  const dockH = DOCK_H + i.b;
  if (mode === 'drawer') {
    const dw = Math.min(w * DRAWER_K, DRAWER_MAX);
    const dockW = Math.min(DOCK_LAND_MAX, w - (open ? dw : 0) - 8);
    return {
      mode, top: null, dock: R(0, h - dockH, dockW, dockH), status: R(0, h - dockH - STATUS_H, dockW, STATUS_H),
      panel: open ? R(w - dw, 0, dw, h) : null, map: R(8 + i.l, 8, MAP_LAND, MAP_LAND + 22),
    };
  }
  const top = TOP_H + i.t, st = sheetHeights(h, i);
  const ph = o.panel === 'full' ? st.full : st.half;
  return {
    mode, top: R(0, 0, w, top), dock: R(0, h - dockH, w, dockH), status: R(0, h - dockH - STATUS_H, w, STATUS_H),
    panel: open ? R(0, h - dockH - ph, w, ph) : null,
    map: open ? null : R(w - 10 - i.r - MAP_PHONE, top + 4, MAP_PHONE, MAP_PHONE + 22),
  };
}

// rects: an array of { x, y, w, h } (or DOMRect: left, top, right, bottom)
export function clearRect(w, h, rects) {
  const o = { l: 0, t: 0, r: 0, b: 0 };
  for (const q of rects || []) {
    if (!q) continue;
    const left = q.left ?? q.x, top = q.top ?? q.y;
    const right = q.right ?? left + q.w, bottom = q.bottom ?? top + q.h;
    const x0 = Math.max(0, left), x1 = Math.min(w, right), y0 = Math.max(0, top), y1 = Math.min(h, bottom);
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
  // keep a usable view: at least 30% of each axis stays clear
  const kx = (o.l + o.r) / (0.7 * w), ky = (o.t + o.b) / (0.7 * h);
  if (kx > 1) { o.l /= kx; o.r /= kx; }
  if (ky > 1) { o.t /= ky; o.b /= ky; }
  return { ...o, x: o.l, y: o.t, w: w - o.l - o.r, h: h - o.t - o.b };
}

export function centreShift(c, w, h) {
  if (!c || !(w > 0) || !(h > 0)) return [0, 0];
  const xc = c.l + (w - c.l - c.r) / 2, yc = c.t + (h - c.t - c.b) / 2;
  return [2 * xc / w - 1, 1 - 2 * yc / h];
}
