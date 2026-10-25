// ============================================================================
//  VIEW CAMERA  ·  pure maths for the tiled slice viewer (no DOM, no GL)
// ----------------------------------------------------------------------------
//  World units are nm. Voxel i of scale s covers [i*res, (i+1)*res) nm on
//  each axis, and voxel 0 is the start of the volume. The camera is one
//  3D centre (nm) and one zoom (nmPerPx, nm per CSS px). Each view shows
//  one plane through the centre. The centre coordinate on the normal axis
//  of a plane is the slice of that plane.
//
//  Plane axes (u right, v down), the neuroglancer panel convention:
//    xy: u = x, v = y     xz: u = x, v = z     yz: u = z, v = y
//
//  GREP MAP
//    grep -n 'export const PLANES'     the plane axis table
//    grep -n 'export function chooseScale'   scale level for a zoom
//    grep -n 'export function tileSize'      tile size in voxels
//    grep -n 'export function visibleTiles'  tiles that cover a view
//    grep -n 'export function sliceIndex'    slice index at a scale
//    grep -n 'export function scaleBar'      nice scale bar length
//    grep -n 'export function layoutViews'   single and three-plane layout
//    grep -n 'export function zoomPath'      smooth zoom flight (van Wijk)
//    grep -n 'export function clampCamera'   keep the centre in the volume
// ============================================================================

export const PLANES = {
  xy: { u: 0, v: 1, n: 2 },
  xz: { u: 0, v: 2, n: 1 },
  yz: { u: 2, v: 1, n: 0 },
};
export const PLANE_NAMES = ['xy', 'xz', 'yz'];
export const AXIS = ['x', 'y', 'z'];

// Extent of the volume in nm on each axis, from scale 0.
export function extentNm(vol) {
  const s = vol.scales[0];
  return [0, 1, 2].map(i => s.size[i] * s.resolution[i]);
}

// The finest in-plane resolution of one scale (nm per voxel).
export function inPlaneRes(scale, plane) {
  const a = PLANES[plane];
  return Math.min(scale.resolution[a.u], scale.resolution[a.v]);
}

// zoom (CSS px per scale-0 voxel) <-> nmPerPx
export function zoomToNmPerPx(vol, plane, zoom) { return inPlaneRes(vol.scales[0], plane) / Math.max(zoom, 1e-9); }
export function nmPerPxToZoom(vol, plane, npp) { return inPlaneRes(vol.scales[0], plane) / npp; }

// Scale level for a zoom. Scales run from fine (0) to coarse. The level is
// the coarsest one whose voxel is no larger than bias device px, so one
// device px shows about one voxel. bias > 1 trades detail for fewer tiles.
export function chooseScale(scales, plane, nmPerDevPx, bias = 1) {
  let best = 0;
  const lim = nmPerDevPx * bias * 1.0001;
  for (let s = 0; s < scales.length; s++) {
    if (inPlaneRes(scales[s], plane) <= lim) best = s;
  }
  return best;
}

// The coarsest scale: the base level that is always loaded (and the minimap).
export function baseScale(scales) { return scales.length - 1; }

// Tile size in voxels on (u, v): 256 or more, a multiple of the chunk size,
// so one tile reads whole chunks.
export function tileSize(scale, plane, min = 256) {
  const a = PLANES[plane];
  const t = c => { c = Math.max(1, c | 0); return Math.ceil(Math.max(min, c) / c) * c; };
  return [t(scale.chunk[a.u]), t(scale.chunk[a.v])];
}

// Slice index of a centre coordinate (nm) at a scale.
export function sliceIndex(scale, plane, nm) {
  const n = PLANES[plane].n;
  const i = Math.floor(nm / scale.resolution[n]);
  return Math.max(0, Math.min(scale.size[n] - 1, i));
}

// The nm rect of a view: [u0, v0, u1, v1]. The view focus (fx, fy, CSS px
// inside the viewport) shows the camera centre.
export function viewRectNm(view, cam) {
  const a = PLANES[view.plane], vp = view.vp, k = cam.nmPerPx;
  const fx = view.fx ?? vp.w / 2, fy = view.fy ?? vp.h / 2;
  const cu = cam.center[a.u], cv = cam.center[a.v];
  return [cu - fx * k, cv - fy * k, cu + (vp.w - fx) * k, cv + (vp.h - fy) * k];
}

// Screen (CSS px in canvas) <-> world (nm) for one view.
export function screenToWorld(view, cam, sx, sy) {
  const a = PLANES[view.plane], vp = view.vp, k = cam.nmPerPx;
  const fx = view.fx ?? vp.w / 2, fy = view.fy ?? vp.h / 2;
  const p = cam.center.slice();
  p[a.u] = cam.center[a.u] + (sx - vp.x - fx) * k;
  p[a.v] = cam.center[a.v] + (sy - vp.y - fy) * k;
  return p;
}
export function worldToScreen(view, cam, p) {
  const a = PLANES[view.plane], vp = view.vp, k = cam.nmPerPx;
  const fx = view.fx ?? vp.w / 2, fy = view.fy ?? vp.h / 2;
  return [vp.x + fx + (p[a.u] - cam.center[a.u]) / k, vp.y + fy + (p[a.v] - cam.center[a.v]) / k];
}

// Tiles of one scale that cover a view, nearest to the focus first.
// Each tile: { tu, tv, rect: [u0, v0, u1, v1) voxels clipped to the scale,
// nm: [u0, v0, u1, v1] nm, d: distance to the focus in tile units }.
export function visibleTiles(view, cam, scale, margin = 0) {
  const a = PLANES[view.plane];
  const [ts_u, ts_v] = tileSize(scale, view.plane);
  const ru = scale.resolution[a.u], rv = scale.resolution[a.v];
  const su = scale.size[a.u], sv = scale.size[a.v];
  const r = viewRectNm(view, cam);
  const nu = Math.ceil(su / ts_u), nv = Math.ceil(sv / ts_v);
  const t0u = Math.max(0, Math.floor(r[0] / (ru * ts_u)) - margin);
  const t1u = Math.min(nu - 1, Math.floor(r[2] / (ru * ts_u)) + margin);
  const t0v = Math.max(0, Math.floor(r[1] / (rv * ts_v)) - margin);
  const t1v = Math.min(nv - 1, Math.floor(r[3] / (rv * ts_v)) + margin);
  const fu = cam.center[a.u] / (ru * ts_u) - 0.5, fv = cam.center[a.v] / (rv * ts_v) - 0.5;
  const out = [];
  for (let tv = t0v; tv <= t1v; tv++) for (let tu = t0u; tu <= t1u; tu++) {
    const u0 = tu * ts_u, v0 = tv * ts_v, u1 = Math.min(su, u0 + ts_u), v1 = Math.min(sv, v0 + ts_v);
    out.push({ tu, tv, rect: [u0, v0, u1, v1], nm: [u0 * ru, v0 * rv, u1 * ru, v1 * rv], d: Math.hypot(tu - fu, tv - fv) });
  }
  out.sort((p, q) => p.d - q.d);
  return out;
}

// Scale bar: the largest 1, 2 or 5 x 10^k nm that fits in maxPx CSS px.
export function scaleBar(nmPerPx, maxPx = 120) {
  const target = nmPerPx * maxPx;
  if (!(target > 0) || !isFinite(target)) return { nm: 0, px: 0, label: '' };
  const p = Math.pow(10, Math.floor(Math.log10(target)));
  let len = p;
  for (const m of [1, 2, 5]) if (m * p <= target * 1.000001) len = m * p;
  return { nm: len, px: len / nmPerPx, label: formatLength(len) };
}
export function formatLength(nm) {
  const f = (x) => { const r = Math.round(x * 100) / 100; return String(r); };
  if (nm < 1) return f(nm * 1000) + ' pm';
  if (nm < 1000) return f(nm) + ' nm';
  if (nm < 1e6) return f(nm / 1000) + ' µm';
  return f(nm / 1e6) + ' mm';
}

// Zoom limits: in to maxZoom CSS px per finest voxel, out to where the whole
// in-plane extent fits in `fit` of the smaller viewport side.
export function zoomLimits(vol, plane, vpw, vph, maxZoom = 24, fit = 0.33) {
  const a = PLANES[plane], ext = extentNm(vol);
  const minNpp = inPlaneRes(vol.scales[0], plane) / maxZoom;
  const maxNpp = Math.max(ext[a.u], ext[a.v]) / Math.max(1, Math.min(vpw, vph) * fit);
  return { minNpp, maxNpp: Math.max(maxNpp, minNpp) };
}

// The zoom that fits the whole plane in a view, with a margin.
export function fitNmPerPx(vol, plane, vpw, vph, pad = 0.92) {
  const a = PLANES[plane], ext = extentNm(vol);
  return Math.max(ext[a.u] / Math.max(1, vpw * pad), ext[a.v] / Math.max(1, vph * pad));
}

// Keep the centre in the volume (each axis in [0, extent]) and the zoom in
// its limits.
export function clampCamera(cam, vol, lim) {
  const ext = extentNm(vol);
  for (let i = 0; i < 3; i++) cam.center[i] = Math.min(ext[i] - 1e-6, Math.max(0, cam.center[i]));
  if (lim) cam.nmPerPx = Math.min(lim.maxNpp, Math.max(lim.minNpp, cam.nmPerPx));
  return cam;
}

// Snap a normal-axis coordinate to the middle of its scale-0 voxel.
export function snapSlice(vol, axis, nm) {
  const r = vol.scales[0].resolution[axis];
  const n = vol.scales[0].size[axis];
  const i = Math.max(0, Math.min(n - 1, Math.floor(nm / r)));
  return (i + 0.5) * r;
}

// Views in a canvas of w x h CSS px. single: one view of `plane`.
// three: the main plane large, the two other planes small. The focus of the
// main view sits in the middle of the area inside the insets.
export function layoutViews(w, h, layout, plane, insets = {}, gap = 2) {
  const ins = { top: 0, right: 0, bottom: 0, left: 0, ...insets };
  const focus = (vp, useInsets) => {
    if (!useInsets) return { fx: vp.w / 2, fy: vp.h / 2 };
    const l = Math.min(ins.left, vp.w * 0.45), r = Math.min(ins.right, vp.w * 0.45);
    const t = Math.min(ins.top, vp.h * 0.45), b = Math.min(ins.bottom, vp.h * 0.45);
    return { fx: l + (vp.w - l - r) / 2, fy: t + (vp.h - t - b) / 2 };
  };
  if (layout !== 'three') {
    const vp = { x: 0, y: 0, w, h };
    return [{ plane, vp, main: true, ...focus(vp, true) }];
  }
  const others = PLANE_NAMES.filter(p => p !== plane);
  let vps;
  if (w >= h) {
    const mw = Math.round((w - gap) * 0.64), sw = w - gap - mw, sh = Math.round((h - gap) / 2);
    vps = [{ x: 0, y: 0, w: mw, h }, { x: mw + gap, y: 0, w: sw, h: sh }, { x: mw + gap, y: sh + gap, w: sw, h: h - gap - sh }];
  } else {
    const mh = Math.round((h - gap) * 0.6), sh = h - gap - mh, sw = Math.round((w - gap) / 2);
    vps = [{ x: 0, y: 0, w, h: mh }, { x: 0, y: mh + gap, w: sw, h: sh }, { x: sw + gap, y: mh + gap, w: w - gap - sw, h: sh }];
  }
  return [plane, ...others].map((p, i) => ({ plane: p, vp: vps[i], main: i === 0, ...focus(vps[i], i === 0) }));
}

export function viewAt(views, sx, sy) {
  for (let i = views.length - 1; i >= 0; i--) {
    const v = views[i].vp;
    if (sx >= v.x && sx < v.x + v.w && sy >= v.y && sy < v.y + v.h) return views[i];
  }
  return null;
}

// Smooth zoom flight between two views (van Wijk and Nuij 2003, the same
// path as d3.interpolateZoom). p = [u, v, w] with w the visible width in nm.
// Returns { S, at(t) -> [u, v, w] } for t in [0, 1]. S is the path length;
// a duration proportional to S keeps the apparent speed even.
export function zoomPath(p0, p1, rho = 1.414) {
  const ux0 = p0[0], uy0 = p0[1], w0 = p0[2];
  const ux1 = p1[0], uy1 = p1[1], w1 = p1[2];
  const dx = ux1 - ux0, dy = uy1 - uy0, d2 = dx * dx + dy * dy;
  const r2 = rho * rho, r4 = r2 * r2;
  if (d2 < 1e-12 * Math.max(w0, w1) ** 2) {
    const S = Math.log(w1 / w0) / rho;
    return { S: Math.abs(S), at: t => [ux0 + t * dx, uy0 + t * dy, w0 * Math.exp(rho * t * S)] };
  }
  const d1 = Math.sqrt(d2);
  const b0 = (w1 * w1 - w0 * w0 + r4 * d2) / (2 * w0 * r2 * d1);
  const b1 = (w1 * w1 - w0 * w0 - r4 * d2) / (2 * w1 * r2 * d1);
  const rr0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
  const rr1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
  const S = (rr1 - rr0) / rho;
  const cosh = x => (Math.exp(x) + Math.exp(-x)) / 2;
  const sinh = x => (Math.exp(x) - Math.exp(-x)) / 2;
  const tanh = x => { const e = Math.exp(2 * x); return (e - 1) / (e + 1); };
  return {
    S,
    at(t) {
      const s = t * S, c0 = cosh(rr0);
      const u = w0 / (r2 * d1) * (c0 * tanh(rho * s + rr0) - sinh(rr0));
      return [ux0 + u * dx, uy0 + u * dy, w0 * c0 / cosh(rho * s + rr0)];
    },
  };
}

export const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
