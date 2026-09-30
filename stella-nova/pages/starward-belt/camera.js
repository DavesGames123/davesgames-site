// camera.js — the rail camera. No DOM, no GPU.
//
// The camera center stays on a band around the belt axis (RAIL.a to RAIL.b).
// s is the position along the axis, 0 at RAIL.a and 1 at RAIL.b.
// d is the drift across the axis, world units, clamped to RAIL.lateral.
// zoom is screen CSS pixels per world unit.
//
// The field shader and the SVG overlay both read view(): the same center,
// zoom and viewport size give the same world-to-screen map on both layers.
//
// grep: function createCamera  toScreen  toWorld  panBy  zoomAt  step

import { RAIL } from './data.js';

const AX = RAIL.b.x - RAIL.a.x, AY = RAIL.b.y - RAIL.a.y;
const LEN = Math.hypot(AX, AY);
export const AXIS = { ux: AX / LEN, uy: AY / LEN, len: LEN };   // unit vector, a -> b
export const ACROSS = { ux: -AXIS.uy, uy: AXIS.ux };            // unit normal

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function createCamera() {
  // cur follows tgt with a smooth ease, so every input glides.
  const tgt = { s: 0.5, d: 0, zoom: 1 };
  const cur = { s: 0.5, d: 0, zoom: 1 };
  const vp = { w: 1, h: 1 };
  let zMin = 0.3, zMax = 4;

  function center(st) {
    const t = st.s * LEN;
    return {
      x: RAIL.a.x + AXIS.ux * t + ACROSS.ux * st.d,
      y: RAIL.a.y + AXIS.uy * t + ACROSS.uy * st.d,
    };
  }

  function fromCenter(x, y) {
    const rx = x - RAIL.a.x, ry = y - RAIL.a.y;
    return { s: (rx * AXIS.ux + ry * AXIS.uy) / LEN, d: rx * ACROSS.ux + ry * ACROSS.uy };
  }

  function clampTgt() {
    tgt.zoom = clamp(tgt.zoom, zMin, zMax);
    tgt.s = clamp(tgt.s, 0, 1);
    tgt.d = clamp(tgt.d, -RAIL.lateral, RAIL.lateral);
  }

  return {
    // Set the viewport size in CSS pixels. The fit zoom shows the full belt.
    resize(w, h) {
      vp.w = Math.max(1, w); vp.h = Math.max(1, h);
      const fit = Math.min(vp.w / 900, vp.h / 1750);
      zMin = fit * 0.85; zMax = fit * 6;
      clampTgt();
    },
    // Show the full belt at the fit zoom. (sx, sy) moves the belt on the
    // screen by that many CSS px, so the page can keep it clear of its UI.
    home(instant = false, sx = 0, sy = 0) {
      const z = zMin / 0.85;
      const c = center({ s: 0.5, d: 0 });
      const p = fromCenter(c.x - sx / z, c.y - sy / z);
      tgt.s = p.s; tgt.d = p.d; tgt.zoom = z;
      clampTgt();
      if (instant) Object.assign(cur, tgt);
    },
    // Advance the ease by dt seconds. Returns true while the camera moves.
    step(dt) {
      const k = 1 - Math.exp(-dt * 9);
      let moving = false;
      for (const key of ['s', 'd', 'zoom']) {
        const diff = tgt[key] - cur[key];
        const eps = key === 'zoom' ? 1e-4 : key === 's' ? 1e-5 : 1e-2;
        if (Math.abs(diff) > eps) { cur[key] += diff * k; moving = true; }
        else cur[key] = tgt[key];
      }
      return moving;
    },
    // The current view, used by both layers.
    view() {
      const c = center(cur);
      return { cx: c.x, cy: c.y, zoom: cur.zoom, w: vp.w, h: vp.h };
    },
    toScreen(x, y) {
      const c = center(cur);
      return { x: (x - c.x) * cur.zoom + vp.w / 2, y: (y - c.y) * cur.zoom + vp.h / 2 };
    },
    toWorld(sx, sy) {
      const c = center(cur);
      return { x: (sx - vp.w / 2) / cur.zoom + c.x, y: (sy - vp.h / 2) / cur.zoom + c.y };
    },
    // Pan by a screen-pixel delta. The rail takes the along-axis part at
    // full rate and the across-axis part up to the lateral clamp.
    panBy(dx, dy) {
      const c = center(tgt);
      const p = fromCenter(c.x - dx / tgt.zoom, c.y - dy / tgt.zoom);
      tgt.s = p.s; tgt.d = p.d; clampTgt();
    },
    // Move along the rail by a fraction of the belt length.
    slide(ds) { tgt.s += ds; clampTgt(); },
    // Zoom by factor f and keep the world point under (sx, sy) fixed.
    zoomAt(f, sx, sy) {
      const c = center(tgt);
      const wx = (sx - vp.w / 2) / tgt.zoom + c.x, wy = (sy - vp.h / 2) / tgt.zoom + c.y;
      const z = clamp(tgt.zoom * f, zMin, zMax);
      const p = fromCenter(wx - (sx - vp.w / 2) / z, wy - (sy - vp.h / 2) / z);
      tgt.zoom = z; tgt.s = p.s; tgt.d = p.d; clampTgt();
    },
    // Glide to a world point at a zoom (the zoom stays if z is omitted).
    focus(x, y, z) {
      const p = fromCenter(x, y);
      tgt.s = p.s; tgt.d = p.d; if (z) tgt.zoom = z; clampTgt();
    },
    get fitZoom() { return zMin / 0.85; },
  };
}
