// view.js — which part of the extent raster the screen shows.
//
// A dataset covers an EXTENT (meta.bbox). Its subject is the CORE
// (meta.core, normalized in the extent). The view is a rect in normalized
// extent coords {x0, y0, x1, y1} (origin top-left, y down) that has the
// aspect of the viewport, so the map always fills the screen:
//   1. Take the smallest rect of the viewport aspect that holds the core,
//      centered on the core center.
//   2. If that rect is larger than the extent, shrink it (same aspect) until
//      it fits. The extent then covers the screen, with no letterbox.
//   3. Shift the rect so that it stays inside the extent.
// A v1 dataset has no core. Then the core is the full extent.
//
// grep: function computeView  function lonLatToScreen  function metersPerScreenPx

export function coreOf(meta) {
  const c = meta?.core;
  if (c && c.x1 > c.x0 && c.y1 > c.y0) return c;
  return { x0: 0, y0: 0, x1: 1, y1: 1 };
}

// viewportAspect = width / height of the screen area.
export function computeView(meta, viewportAspect) {
  const W = meta.width, H = meta.height;          // raster px (square in metres)
  const A = viewportAspect > 0 ? viewportAspect : 1;
  const c = coreOf(meta);
  const cw = (c.x1 - c.x0) * W, ch = (c.y1 - c.y0) * H;
  const cx = (c.x0 + c.x1) / 2 * W, cy = (c.y0 + c.y1) / 2 * H;

  // 1. the smallest rect of aspect A that holds the core
  let vw, vh;
  if (cw / ch > A) { vw = cw; vh = cw / A; } else { vh = ch; vw = ch * A; }

  // 2. shrink it until it fits in the extent
  const k = Math.min(1, W / vw, H / vh);
  vw *= k; vh *= k;

  // 3. center on the core, then keep it inside the extent
  let x0 = cx - vw / 2, y0 = cy - vh / 2;
  x0 = Math.min(Math.max(x0, 0), W - vw);
  y0 = Math.min(Math.max(y0, 0), H - vh);
  return { x0: x0 / W, y0: y0 / H, x1: (x0 + vw) / W, y1: (y0 + vh) / H };
}

// Normalized extent coords of a lon/lat (equirectangular inside the bbox).
export function lonLatToExtent(meta, lon, lat) {
  const b = meta.bbox;
  return { x: (lon - b.lon0) / (b.lon1 - b.lon0), y: (b.lat1 - lat) / (b.lat1 - b.lat0) };
}

// Screen px of a lon/lat for a screen of w x h px that shows the view.
export function lonLatToScreen(meta, view, lon, lat, w, h) {
  const p = lonLatToExtent(meta, lon, lat);
  return extentToScreen(view, p.x, p.y, w, h);
}

export function extentToScreen(view, x, y, w, h) {
  return {
    x: (x - view.x0) / (view.x1 - view.x0) * w,
    y: (y - view.y0) / (view.y1 - view.y0) * h,
  };
}

// Metres per screen px (vertical), for the scale bar.
export function metersPerScreenPx(meta, view, screenH) {
  const b = meta.bbox;
  const mppY = meta.metersPerPixel > 0 ? meta.metersPerPixel : ((b.lat1 - b.lat0) * 111320) / meta.height;
  return (mppY * (view.y1 - view.y0) * meta.height) / screenH;
}

// The four corners of the view as lon/lat, for the locator outline.
export function viewCornersLonLat(meta, view) {
  const b = meta.bbox;
  const lon = (x) => b.lon0 + x * (b.lon1 - b.lon0);
  const lat = (y) => b.lat1 - y * (b.lat1 - b.lat0);
  return [[lon(view.x0), lat(view.y0)], [lon(view.x1), lat(view.y0)], [lon(view.x1), lat(view.y1)], [lon(view.x0), lat(view.y1)]];
}
