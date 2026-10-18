// ============================================================================
//  TENSOR CALCULUS  ·  ui/fit-layout.js  ·  sizes for the panes and bars (CORE)
// ----------------------------------------------------------------------------
//  DOM-free. main.js reads the window size, calls planLayout() and writes the
//  result to data attributes. style.css has one rule set for each value.
//
//    body[data-device]    'desktop' | 'portrait' | 'landscape'  (phones)
//    #stage[data-shape]   the grid of the views on a desktop:
//                           all:  'wide' (3D left, equation and Penrose
//                                 diagram stacked at the right; only when
//                                 the right column is WIDE_MIN px), 'tall'
//                                 (3D on top, the other two below side by
//                                 side), 'column' (three rows)
//                           pair: 'row' | 'stack'      focus: 'one'
//    .pane[data-head]     'l' | 'm' | 's' | 'xs': how much of the pane
//                           header shows, so the header never wraps
//                           l   all labels and the caption
//                           m   no caption, short button labels
//                           s   m, and no focus button
//                           xs  s, and short title and style labels
//    #player[data-fit]    'l' | 'm' | 's' | 'xs' on a desktop, 'phone' or
//                           'land' on a phone (see playerLevel)
//
//  The widths of the header items are estimates from the character count
//  (Inter and STIX at the sizes of style.css). The CSS also stops a wrap
//  (white-space: nowrap, overflow: hidden), so a bad estimate cuts a label
//  but never makes a second line.
//
//  texScale() gives the font scale of the equation, so the equation fills
//  its pane when there is room, and scrolls in its own box when it is too
//  wide at the smallest scale.
//
//  EXPORTS   (grep -n "^export" ui/fit-layout.js)
//      SIZES, HEAD_ITEMS, WIDE_MIN, deviceOf, panelWidth, stageBox, stageShape, paneBoxes,
//      headWidth, headLevel, playerWidth, playerLevel, texScale, planLayout
// ============================================================================

// CSS px. These match the :root values of style.css (tests check it).
export const SIZES = Object.freeze({
  topH: 52, topHFrame: 44, panelW: 360, panelVw: 0.34, playerH: 66, gap: 10,
  phoneTopH: 46, phonePlayerH: 104, dockH: 64, landBarH: 60, landDockW: 340,
  phoneMaxW: 768, phoneMaxH: 500,
});

const LEVELS = ['l', 'm', 's', 'xs'];
const SANS = 6.9, SERIF = 8, GAP = 8, HEAD_PAD = 22;
const btn = (text, touch) => text.length * SANS + (touch ? 26 : 20);
const segW = (labels, touch) => labels.reduce((a, s) => a + s.length * SANS + (touch ? 24 : 18), 2);

// Each header item: [kind, long text, short text]. 'cap' is the caption
// (it shrinks with an ellipsis; 60 px are kept for it at level l).
export const HEAD_ITEMS = Object.freeze({
  tex: [['title', 'Equation', 'Equation'], ['cap'], ['btn', 'Write out sums', 'Sums'], ['focus'], ['close']],
  viz: [['title', '3D', '3D'], ['cap'], ['btn', 'Follow the steps', 'Follow'], ['btn', 'Scene', 'Scene'], ['focus'], ['close']],
  diagram: [['title', 'Penrose diagram', 'Penrose'], ['seg', ['Penrose', 'Birdtrack', 'Network'], ['Pen', 'Bird', 'Net']], ['btn', 'Legend', 'Legend'], ['focus'], ['close']],
});

// The width a pane header needs at a level. phone: no focus or close
// buttons (one view at a time), and 44 px targets.
export function headWidth(pane, level, { phone = false } = {}) {
  const items = HEAD_ITEMS[pane];
  if (!items) throw new Error('unknown pane ' + pane);
  const L = LEVELS.indexOf(level);
  if (L < 0) throw new Error('unknown level ' + level);
  const touch = phone;
  const parts = [];
  for (const [kind, a, b] of items) {
    if (kind === 'title') parts.push((L >= 3 ? b : a).length * SERIF);
    else if (kind === 'cap') { if (L === 0) parts.push(60); }
    else if (kind === 'btn') parts.push(btn(L >= 1 ? b : a, touch));
    else if (kind === 'seg') parts.push(segW(L >= 1 ? b : a, touch));
    else if (kind === 'focus') { if (!phone && L < 2) parts.push(touch ? 44 : 30); }
    else if (kind === 'close') { if (!phone) parts.push(touch ? 44 : 30); }
  }
  return HEAD_PAD + parts.reduce((a, x) => a + x, 0) + GAP * Math.max(0, parts.length - 1);
}

// The first level whose header fits the width; 'xs' when none does.
export function headLevel(pane, width, opts = {}) {
  for (const lv of LEVELS) if (headWidth(pane, lv, opts) <= width) return lv;
  return 'xs';
}

export function deviceOf({ w, h, coarse = false }) {
  const phone = w <= SIZES.phoneMaxW || (h <= SIZES.phoneMaxH && coarse);
  if (!phone) return 'desktop';
  return h <= SIZES.phoneMaxH && w > h ? 'landscape' : 'portrait';
}

// The panel is 360 px, or 34 % of the window when that is less (narrow
// desktops), as in style.css.
export function panelWidth(w) { return Math.round(Math.min(SIZES.panelW, w * SIZES.panelVw)); }

// The stage box (CSS px) for a window. o: { panelOpen = true, inFrame }
export function stageBox({ w, h, coarse = false }, o = {}) {
  const device = deviceOf({ w, h, coarse });
  if (device === 'portrait') {
    const top = o.inFrame ? 0 : SIZES.phoneTopH;
    return { device, left: 0, top, w, h: Math.max(0, h - top - SIZES.phonePlayerH - SIZES.dockH), pad: 0 };
  }
  if (device === 'landscape') return { device, left: 0, top: 0, w, h: Math.max(0, h - SIZES.landBarH), pad: 0 };
  const left = o.panelOpen === false ? 0 : panelWidth(w);
  const top = o.inFrame ? SIZES.topHFrame : SIZES.topH;
  return { device, left, top, w: w - left, h: Math.max(0, h - top - SIZES.playerH), pad: SIZES.gap };
}

// 'wide' needs a stage of aspect 1.25 or more and a right column of
// WIDE_MIN px or more (the Penrose diagram header at level xs).
export const WIDE_MIN = 330;
export function stageShape(mode, w, h) {
  const a = w / Math.max(1, h);
  const right = (w - 3 * SIZES.gap) / 2.3;
  if (mode === 'all') return a >= 1.25 && right >= WIDE_MIN ? 'wide' : a >= 0.7 ? 'tall' : 'column';
  if (mode === 'pair') return a >= 1.1 ? 'row' : 'stack';
  return 'one';
}

// The box of each pane on screen, as the CSS grid of each shape gives it.
// views: the ordered list (ui/layout.js). Returns { [view]: { w, h } }.
export function paneBoxes(box, mode, views, device = box.device) {
  const out = {};
  if (device !== 'desktop') { for (const v of views) out[v] = { w: box.w, h: box.h }; return out; }
  const g = box.pad, W = box.w - 2 * g, H = box.h - 2 * g;
  const shape = stageShape(mode, box.w, box.h);
  if (shape === 'one') out[views[0]] = { w: W, h: H };
  else if (shape === 'row') views.forEach(v => { out[v] = { w: (W - g) / 2, h: H }; });
  else if (shape === 'stack') views.forEach(v => { out[v] = { w: W, h: (H - g) / 2 }; });
  else if (shape === 'wide') {
    const w1 = (W - g) * 1.3 / 2.3;
    out.viz = { w: w1, h: H };
    out.tex = { w: W - g - w1, h: (H - g) / 2 };
    out.diagram = { w: W - g - w1, h: (H - g) / 2 };
  } else if (shape === 'tall') {
    const h1 = (H - g) * 1.2 / 2.2;
    out.viz = { w: W, h: h1 };
    out.tex = { w: (W - g) / 2, h: H - g - h1 };
    out.diagram = { w: (W - g) / 2, h: H - g - h1 };
  } else {                                   // column: 3D, equation, Penrose diagram
    const u = (H - 2 * g) / 3;
    out.viz = { w: W, h: u * 1.2 }; out.tex = { w: W, h: u * 0.8 }; out.diagram = { w: W, h: u };
  }
  return out;
}

// The width the desktop player needs at a level, for a bar W px wide. The
// lens takes up to a share of the bar; the step label needs a minimum.
const PLAYER = Object.freeze({
  l: { fixed: 124 + 108 + 126 + 70 + 28 + 220, lens: 0.28 },
  m: { fixed: 124 + 62 + 126 + 60 + 28 + 180, lens: 0.24 },
  s: { fixed: 124 + 62 + 126 + 50 + 24 + 130, lens: 0.2 },
  xs: { fixed: 124 + 62 + 126 + 30 + 24 + 110, lens: 0 },
});
export function playerWidth(level, W) { const p = PLAYER[level]; return p.fixed + p.lens * W; }

// device 'portrait' -> 'phone', 'landscape' -> 'land', else a desktop level.
export function playerLevel(W, device = 'desktop') {
  if (device === 'portrait') return 'phone';
  if (device === 'landscape') return 'land';
  for (const lv of LEVELS) if (playerWidth(lv, W) <= W) return lv;
  return 'xs';
}

// The font scale of the equation. contentW/H: the measured size of the
// equation stack at scale k. boxW/H: the room for it. Returns { k, scroll }:
// scroll is true when the equation is wider than the box at the smallest
// scale, so each line scrolls in its own box.
export function texScale({ contentW, contentH, boxW, boxH, k = 1, min = 0.75, max = 2.2 }) {
  if (!(contentW > 0 && contentH > 0 && boxW > 0 && boxH > 0)) return { k: Math.min(max, Math.max(min, k || 1)), scroll: false };
  const natW = contentW / k, natH = contentH / k;
  const fit = Math.min(boxW / natW, boxH / natH);
  const out = Math.min(max, Math.max(min, fit));
  return { k: Math.round(out * 1000) / 1000, scroll: natW * min > boxW + 0.5 };
}

// The full plan for a window. vp: { w, h, coarse }. o: { panelOpen, inFrame,
// mode, views }.
export function planLayout(vp, o = {}) {
  const views = o.views || ['tex', 'viz', 'diagram'];
  const box = stageBox(vp, o);
  const device = box.device;
  const phone = device !== 'desktop';
  // A phone shows one view at a time: all three sit in a row (scroll snap).
  const mode = phone ? 'all' : (o.mode || (views.length >= 3 ? 'all' : views.length === 2 ? 'pair' : 'focus'));
  const shown = phone ? ['tex', 'viz', 'diagram'] : views;
  const shape = phone ? 'one' : stageShape(mode, box.w, box.h);
  const boxes = paneBoxes(box, mode, shown, device);
  const panes = {};
  for (const v of shown) panes[v] = { ...boxes[v], head: headLevel(v, boxes[v].w, { phone }) };
  const playerW = device === "desktop" ? box.w : device === "landscape" ? vp.w - SIZES.landDockW : vp.w;
  return { device, stage: box, mode, shape, views: shown, panes, playerW, player: playerLevel(playerW, device) };
}
