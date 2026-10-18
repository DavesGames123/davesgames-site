// layout.js — the phone layout rules of the City Generator page, as pure
// functions. No DOM: main.js calls them with numbers it measures, and
// tests.mjs and mobile.mjs check them.
//
// MODES. layoutMode(w, h, coarse) gives the layout for a window:
//   'desk'    the desktop page: foot controls, drawers at the sides
//   'sheet'   phone or tablet portrait (w <= 768): a dock at the base and
//             the settings in a bottom sheet with a half and a full height
//   'drawer'  short landscape touch screen (h <= 500): the dock is a tab at
//             the lower left and the settings are a drawer on the right
// PHONE_Q and LAND_Q are the same rules as CSS media queries. style.css
// uses the same strings (tests.mjs makes sure that they agree).
//
// FRAMING. occlusion(w, h, rects) reads the boxes of the overlays (head,
// foot, dock, open sheet) and gives the margins they cover on each edge,
// as pages/wave-membrane does. fitClear() fits the map in the clear area
// that stays. offsets3D() gives the NDC shift that centres the 3D view in
// the same clear area.
//
// INPUT. sheetSnap() is the grip rule of the sheet (a tap toggles half and
// full, a drag up gives full, a drag down gives half, then closed).
// pinchStep() and clampPan() move the 2D view. isDoubleTap() finds a
// double tap. scrubTime() maps a touch on the playback bar to a time.
//
// COST. dprFor() caps the pixel ratio of each canvas. citySizeFor() picks
// the default city size. progressShare() turns a generation stage into a
// share 0..1 for the progress bar.
//
// grep: export const PHONE_Q  export const LAND_Q  export function layoutMode
//       export function mediaMatches  export function occlusion  export function fitClear
//       export function offsets3D  export function sheetSnap  export function pinchStep
//       export function clampPan  export function isDoubleTap  export function scrubTime
//       export function dprFor  export function citySizeFor  export const STAGES
//       export function progressShare  export function accordionToggle  export const DOCK
//       export function shiftX

export const PHONE_Q = '(max-width: 768px), (max-height: 500px) and (pointer: coarse)';
export const LAND_Q = '(max-height: 500px) and (orientation: landscape) and (pointer: coarse), (max-height: 500px) and (orientation: landscape) and (max-width: 768px)';

// The dock: the size of one target and the gaps (px). style.css uses them.
export const DOCK = { target: 44, button: 48, gap: 6, pad: 10, height: 64 };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function layoutMode(w, h, coarse) {
  const phone = w <= 768 || (h <= 500 && coarse);
  if (!phone) return 'desk';
  if (h <= 500 && w > h && (coarse || w <= 768)) return 'drawer';
  return 'sheet';
}

// A small media query evaluator for the features this page uses
// (max-width, max-height, min-width, min-height, orientation, pointer).
// env = { w, h, coarse }. The jsdom checks stub matchMedia with it.
export function mediaMatches(query, env) {
  const one = (part) => {
    const re = /\(\s*([a-z-]+)\s*:\s*([^)]+?)\s*\)/g;
    let m, ok = true, any = false;
    while ((m = re.exec(part))) {
      any = true;
      const [, f, v] = m, n = parseFloat(v);
      if (f === 'max-width') ok = ok && env.w <= n;
      else if (f === 'min-width') ok = ok && env.w >= n;
      else if (f === 'max-height') ok = ok && env.h <= n;
      else if (f === 'min-height') ok = ok && env.h >= n;
      else if (f === 'orientation') ok = ok && (v === 'landscape' ? env.w > env.h : env.w <= env.h);
      else if (f === 'pointer') ok = ok && (v === 'coarse' ? !!env.coarse : !env.coarse);
      else if (f === 'prefers-reduced-motion') ok = ok && false;
      else ok = false;
    }
    return any && ok;
  };
  return query.split(',').some(one);
}

// Overlay margins in CSS px, after pages/wave-membrane occlusion(). A box
// wider than tall (relative to the window) covers the top or the base; any
// other box covers a side. A box counts only when it spans 40% of that edge
// or more, so a small corner box does not move the map.
export function occlusion(w, h, rects) {
  const o = { l: 0, r: 0, t: 0, b: 0 };
  for (const q of rects) {
    if (!q) continue;
    const x0 = Math.max(0, q.left), x1 = Math.min(w, q.right);
    const y0 = Math.max(0, q.top), y1 = Math.min(h, q.bottom);
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;
    const fw = (x1 - x0) / w, fh = (y1 - y0) / h;
    if (fw >= fh) {
      if (fw < 0.4) continue;
      if (y0 + y1 > h) o.b = Math.max(o.b, h - y0); else o.t = Math.max(o.t, y1);
    } else {
      if (fh < 0.4) continue;
      if (x0 + x1 < w) o.l = Math.max(o.l, x1); else o.r = Math.max(o.r, w - x0);
    }
  }
  // keep a clear area of 30% of each side or more: a taller overlay gives
  // up its margin in proportion
  const kv = (o.t + o.b) / (0.7 * h), kh = (o.l + o.r) / (0.7 * w);
  if (kv > 1) { o.t /= kv; o.b /= kv; }
  if (kh > 1) { o.l /= kh; o.r /= kh; }
  return o;
}

// The view { s, ox, oy } that fits a map of mw x mh units in the clear area
// of a w x h window, margin px inside it.
export function fitClear(mw, mh, w, h, occ, margin = 0) {
  const o = occ || { l: 0, r: 0, t: 0, b: 0 };
  const cw = Math.max(1, w - o.l - o.r - 2 * margin), ch = Math.max(1, h - o.t - o.b - 2 * margin);
  const s = Math.min(cw / mw, ch / mh);
  return { s, ox: o.l + margin + (cw - mw * s) / 2, oy: o.t + margin + (ch - mh * s) / 2 };
}

// The NDC shift of the 3D view that puts the screen centre in the centre of
// the clear area (x right, y up), as the saver offsetY.
export function offsets3D(w, h, occ) {
  if (!occ) return { x: 0, y: 0 };
  return { x: (occ.l - occ.r) / Math.max(1, w), y: (occ.b - occ.t) / Math.max(1, h) };
}

// Shift a column-major view-projection matrix by ox in NDC x (in place),
// as camera.js viewProj does for offsetY. view3d.js calls it.
export function shiftX(vp, ox) {
  for (let c = 0; c < 4; c++) vp[c * 4] += ox * vp[c * 4 + 3];
  return vp;
}

// The grip of the bottom sheet. state: 'closed' | 'half' | 'full'.
// dy: the drag in px (down is positive). A move under 8 px is a tap.
export function sheetSnap(state, dy) {
  if (state === 'closed') return dy < -40 ? 'full' : 'half';
  if (Math.abs(dy) < 8) return state === 'full' ? 'half' : 'full';
  if (dy < -40) return 'full';
  if (dy > 40) return state === 'full' ? 'half' : 'closed';
  return state;
}

// One step of a two-finger gesture on the 2D map: the mid point pans the
// map, the distance change zooms it about the mid point.
// last, now = { mid: {x, y}, d }.
export function pinchStep(v, last, now, sMin = 0.05, sMax = 40) {
  let ox = v.ox + now.mid.x - last.mid.x, oy = v.oy + now.mid.y - last.mid.y;
  const s = clamp(v.s * now.d / Math.max(1, last.d), sMin, sMax), k = s / v.s;
  ox = now.mid.x - (now.mid.x - ox) * k;
  oy = now.mid.y - (now.mid.y - oy) * k;
  return { s, ox, oy };
}

// Keep keep px of the map in the window, so a pan cannot lose the map.
export function clampPan(v, mw, mh, w, h, keep = 80) {
  const W = mw * v.s, H = mh * v.s;
  const kx = Math.min(keep, W), ky = Math.min(keep, H);
  return { s: v.s, ox: clamp(v.ox, kx - W, w - kx), oy: clamp(v.oy, ky - H, h - ky) };
}

// Two taps within 320 ms and 28 px. a, b = { t (ms), x, y }.
export function isDoubleTap(a, b) {
  return !!a && !!b && b.t - a.t < 320 && b.t > a.t && Math.hypot(b.x - a.x, b.y - a.y) < 28;
}

export function scrubTime(x, left, width, dur) {
  return clamp((x - left) / Math.max(1, width), 0, 1) * (dur || 0);
}

// The pixel ratio of a canvas. kind '2d' or '3d'. Phones draw the 3D view
// at 1.5 or less; its pixel budget is in view3d.js size().
export function dprFor(dpr, phone, kind) {
  const d = dpr || 1;
  if (kind === '3d') return Math.min(d, phone ? 1.5 : 2);
  return Math.min(d, 2);
}

// The default city size: a town on a phone (the 3D buffers of a full city
// are about 23 MB), the page default elsewhere.
export function citySizeFor(phone, pageDefault) { return phone ? 'town' : pageDefault; }

// The generation stages in order and their share of the progress bar
// (a rough measure of the time each takes on a terrain city).
export const STAGES = [
  ['terrain', 0.00, 'Terrain'], ['field', 0.44, 'Tensor field'], ['water', 0.46, 'Water'],
  ['main', 0.50, 'Main roads'], ['major', 0.58, 'Major roads'], ['minor', 0.68, 'Minor roads'],
  ['blocks', 0.86, 'Blocks'], ['lots', 0.93, 'Lots'], ['mesh', 0.97, '3D model'], ['done', 1, 'Done'],
];
// k: a stage key; sub: 0..1 inside the stage (the terrain sends its LIB
// stage share). terrain off: the city stages fill the whole bar.
export function progressShare(k, sub = 0, terrain = true) {
  const i = STAGES.findIndex((s) => s[0] === k);
  if (i < 0) return 0;
  const a = STAGES[i][1], b = i + 1 < STAGES.length ? STAGES[i + 1][1] : 1;
  let f = a + (b - a) * clamp(sub, 0, 1);
  if (!terrain) { const t0 = STAGES[1][1]; f = k === 'terrain' ? 0 : (f - t0) / (1 - t0); }
  return clamp(f, 0, 1);
}

// The accordion of the sheet. open: an array of open keys. single: one
// section at a time (phones). Returns the new array.
export function accordionToggle(open, k, single) {
  if (open.includes(k)) return open.filter((x) => x !== k);
  return single ? [k] : open.concat(k);
}
