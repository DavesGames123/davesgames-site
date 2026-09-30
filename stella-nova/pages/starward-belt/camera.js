// camera.js — the rail camera. No DOM, no GPU.
//
// The camera center stays on a band around the belt axis (rail.a to rail.b).
// s is the position along the axis, 0 at rail.a and 1 at rail.b.
// d is the drift across the axis, world units, clamped to rail.lateral.
// zoom is screen CSS pixels per world unit.
//
// The field shader and the SVG overlay both read view(): the same center,
// zoom and viewport size give the same world-to-screen map on both layers.
// view().fit is the fit zoom, the zoom that shows the full belt.
//
// Fit: the belt box is a rect on the belt axis, FIT_TRIM shorter than the
// rail and rail.lateral wide. Its axis-aligned bounds, rounded to FIT_ROUND
// world units, must fit in the viewport. For the canon rail the bounds are
// exactly 900 x 1750, the numbers of the first version of this page.
//
// grep: function createCamera  function fitBox  setRail  toScreen  toWorld  panBy  zoomAt  step  axis

import { RAIL } from './data.js';

const FIT_TRIM = 28;      // world units off the rail length
const FIT_ROUND = 10;     // world units

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Axis-aligned size of the belt box of a rail, world units. When nodes are
// given, the box also grows to hold each station ring plus FIT_PAD around the
// belt center. The original map's stations sit inside its rail box, so its
// fit does not change. Random maps can scatter stations wider than the rail.
const FIT_PAD = 20;       // world units past each station ring
export function fitBox(rail, nodes = []) {
  const ax = rail.b.x - rail.a.x, ay = rail.b.y - rail.a.y;
  const len = Math.hypot(ax, ay) || 1;
  const ux = Math.abs(ax / len), uy = Math.abs(ay / len);
  const along = Math.max(1, len - FIT_TRIM), across = rail.lateral;
  const r = (v) => Math.max(FIT_ROUND, Math.round(v / FIT_ROUND) * FIT_ROUND);
  let w = r(ux * along + uy * across), h = r(uy * along + ux * across);
  const cx = (rail.a.x + rail.b.x) / 2, cy = (rail.a.y + rail.b.y) / 2;
  for (const n of nodes) {
    const m = (n.ring || 0) + FIT_PAD;
    w = Math.max(w, r(2 * (Math.abs(n.x - cx) + m)));
    h = Math.max(h, r(2 * (Math.abs(n.y - cy) + m)));
  }
  return { w, h };
}

export function createCamera(rail0 = RAIL, nodes0 = []) {
  // cur follows tgt with a smooth ease, so every input glides.
  const tgt = { s: 0.5, d: 0, zoom: 1 };
  const cur = { s: 0.5, d: 0, zoom: 1 };
  const vp = { w: 1, h: 1 };
  let zMin = 0.3, zMax = 4, fit = 0.3 / 0.85;
  let rail, LEN, box;
  const AXIS = { ux: 0, uy: 1, len: 1 };     // unit vector, a -> b
  const ACROSS = { ux: -1, uy: 0 };          // unit normal

  function useRail(r, nodes = []) {
    rail = r;
    const ax = r.b.x - r.a.x, ay = r.b.y - r.a.y;
    LEN = Math.hypot(ax, ay) || 1;
    AXIS.ux = ax / LEN; AXIS.uy = ay / LEN; AXIS.len = LEN;
    ACROSS.ux = -AXIS.uy; ACROSS.uy = AXIS.ux;
    box = fitBox(r, nodes);
  }

  function center(st) {
    const t = st.s * LEN;
    return {
      x: rail.a.x + AXIS.ux * t + ACROSS.ux * st.d,
      y: rail.a.y + AXIS.uy * t + ACROSS.uy * st.d,
    };
  }

  function fromCenter(x, y) {
    const rx = x - rail.a.x, ry = y - rail.a.y;
    return { s: (rx * AXIS.ux + ry * AXIS.uy) / LEN, d: rx * ACROSS.ux + ry * ACROSS.uy };
  }

  function clampTgt() {
    tgt.zoom = clamp(tgt.zoom, zMin, zMax);
    tgt.s = clamp(tgt.s, 0, 1);
    tgt.d = clamp(tgt.d, -rail.lateral, rail.lateral);
  }

  function limits() {
    fit = Math.min(vp.w / box.w, vp.h / box.h);
    zMin = fit * 0.85; zMax = fit * 6;
  }

  useRail(rail0, nodes0);

  return {
    // Set the viewport size in CSS pixels. The fit zoom shows the full belt.
    resize(w, h) {
      vp.w = Math.max(1, w); vp.h = Math.max(1, h);
      limits();
      clampTgt();
    },
    // Use a new rail (a new map). The zoom limits follow the new belt. The
    // caller then calls home() to frame it.
    setRail(r, nodes = []) {
      useRail(r, nodes);
      limits();
      clampTgt();
    },
    // Show the full belt at the fit zoom. (sx, sy) moves the belt on the
    // screen by that many CSS px, so the page can keep it clear of its UI.
    home(instant = false, sx = 0, sy = 0) {
      const z = zMin / 0.85;      // the first version computed it so; keep the bits
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
      return { cx: c.x, cy: c.y, zoom: cur.zoom, w: vp.w, h: vp.h, fit };
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
    // The belt axis of the current rail: unit vector a -> b and its length.
    get axis() { return { ux: AXIS.ux, uy: AXIS.uy, len: LEN }; },
    get fitZoom() { return zMin / 0.85; },
  };
}
