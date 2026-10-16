// ============================================================================
//  THERMAL CONVECTION  ·  render/layout.js — view rects and slice geometry (VIEW)
// ----------------------------------------------------------------------------
//  No DOM. All rects are { x, y, w, h } in CSS px, y down.
//
//  layoutRects(w, h, view, clear, opts) -> { surface?, slice?, block? }
//    view   'split' (default) | 'block' | 'surface' | 'slice'
//    clear  { t, b, l, r } CSS px that the UI covers (dock, panel, plate)
//    opts   { Lx = 4, Ly = 4, cutLen = Lx, zScale = 1, side = false,
//             gap = 10, pad = 12 }
//    split: the surface (aspect Lx : Ly) on top and its cross-section
//    (aspect cutLen : zScale) directly under it, with the same x and the
//    same width, so the cut line on the surface and the section read as one
//    cut. opts.side puts the section to the right of the surface (same
//    width, centred on the surface height), for wide saver frames.
//    Every rect is inside the clear area minus pad, with integer px.
//
//  sectionFit(rect, len, zScale) -> { fluid, bar }
//    Inside a slice rect: the fluid section (aspect len : zScale, top
//    aligned, centred in x) and the hot-plate bar right under it.
//
//  Slice = { angle, offset }: a vertical plane, angle about z (0 = along +x),
//  offset = signed distance of the plane from the box centre along the
//  plane normal n = (-sin a, cos a). The domain is periodic in x and y.
//  wrapOffset(angle, offset, Lx, Ly) wraps offset into [-h, h), h = the half
//  extent of the box along n, so a sweep leaves one side and comes back at
//  the other side.
//  sliceSegment(slice, Lx, Ly) -> { p0, p1, dir, nrm, len, offset, angle }
//    The part of the plane line inside the box; p0 is the start in the
//    +dir direction. The section coordinate is s = dot(p - p0, dir) in
//    [0, len].
//  sliceFromPoints(a, b, Lx, Ly) -> { angle, offset } | null  (box units)
//  surfaceToBox(px, py, rect, Lx, Ly) -> { x, y } | null   (y up on screen)
//  boxToSurface(x, y, rect, Lx, Ly) -> { px, py }
//  zScaleLabel(z) -> '' at 1, else 'Vertical scale ×1.5'
//  rectInside(r, outer) -> bool
//
//  grep -n targets: "export function layoutRects", "export function sectionFit",
//  "export function wrapOffset", "export function sliceSegment",
//  "export function sliceFromPoints", "export function surfaceToBox",
//  "export function boxToSurface", "export function zScaleLabel",
//  "export function rectInside", "export function clearArea"
// ============================================================================

const R = Math.round;

export function clearArea(w, h, clear = {}, pad = 12) {
  const t = (clear.t || 0) + pad, b = (clear.b || 0) + pad;
  const l = (clear.l || 0) + pad, r = (clear.r || 0) + pad;
  return { x: l, y: t, w: Math.max(0, w - l - r), h: Math.max(0, h - t - b) };
}

// largest rect of aspect a = w / h inside area, centred
function fit(area, a) {
  let w = area.w, h = w / a;
  if (h > area.h) { h = area.h; w = h * a; }
  w = Math.floor(w); h = Math.floor(h);
  return { x: R(area.x + (area.w - w) / 2), y: R(area.y + (area.h - h) / 2), w, h };
}

export function layoutRects(w, h, view = 'split', clear = {}, opts = {}) {
  const Lx = opts.Lx || 4, Ly = opts.Ly || 4;
  const cutLen = Math.max(1e-3, opts.cutLen || Lx);
  const zScale = Math.min(2.5, Math.max(1, opts.zScale || 1));
  const gap = opts.gap ?? 10, pad = opts.pad ?? 12;
  const A = clearArea(w, h, clear, pad);
  if (A.w < 2 || A.h < 2) return {};
  const aSurf = Lx / Ly;            // w / h
  const aSlice = cutLen / zScale;   // w / h
  if (view === 'block') return { block: { x: R(A.x), y: R(A.y), w: Math.floor(A.w), h: Math.floor(A.h) } };
  if (view === 'surface') return { surface: fit(A, aSurf) };
  if (view === 'slice') return { slice: fit(A, aSlice) };
  // split: both rects share the width W
  const k = 1 / aSurf + 1 / aSlice;          // total height per unit width (stacked)
  if (opts.side) {
    let W = Math.min((A.w - gap) / 2, A.h * aSurf, A.h * aSlice);
    W = Math.floor(Math.max(0, W));
    const hs = Math.floor(W / aSurf), hc = Math.floor(W / aSlice);
    const x0 = R(A.x + (A.w - (2 * W + gap)) / 2);
    const yc = A.y + A.h / 2;
    return {
      surface: { x: x0, y: R(yc - hs / 2), w: W, h: hs },
      slice: { x: x0 + W + gap, y: R(yc - hc / 2), w: W, h: hc },
    };
  }
  let W = Math.min(A.w, (A.h - gap) / k);
  W = Math.floor(Math.max(0, W));
  const hs = Math.floor(W / aSurf), hc = Math.floor(W / aSlice);
  const x0 = R(A.x + (A.w - W) / 2);
  const y0 = R(A.y + (A.h - (hs + gap + hc)) / 2);
  return {
    surface: { x: x0, y: y0, w: W, h: hs },
    slice: { x: x0, y: y0 + hs + gap, w: W, h: hc },
  };
}

export function sectionFit(rect, len, zScale = 1) {
  const bar = Math.min(12, Math.max(4, R(rect.h * 0.07)));
  const availH = Math.max(1, rect.h - bar);
  const a = Math.max(1e-3, len) / Math.max(1e-3, zScale);   // w / h of the fluid
  let fw = rect.w, fh = fw / a;
  if (fh > availH) { fh = availH; fw = fh * a; }
  const fluid = { x: rect.x + (rect.w - fw) / 2, y: rect.y, w: fw, h: fh };
  return { fluid, bar: { x: fluid.x, y: fluid.y + fh, w: fw, h: bar } };
}

export function wrapOffset(angle, offset, Lx = 4, Ly = 4) {
  const hExt = 0.5 * (Lx * Math.abs(Math.sin(angle)) + Ly * Math.abs(Math.cos(angle)));
  const P = 2 * hExt;
  if (!(P > 0)) return 0;
  let o = (offset + hExt) % P;
  if (o < 0) o += P;
  return o - hExt;
}

export function sliceSegment(slice = {}, Lx = 4, Ly = 4) {
  const angle = Number.isFinite(slice.angle) ? slice.angle : 0;
  const offset = wrapOffset(angle, Number.isFinite(slice.offset) ? slice.offset : 0, Lx, Ly);
  const dir = [Math.cos(angle), Math.sin(angle)];
  const nrm = [-dir[1], dir[0]];
  const q = [Lx / 2 + nrm[0] * offset, Ly / 2 + nrm[1] * offset];
  // clip q + dir t to the box: Liang–Barsky
  let t0 = -Infinity, t1 = Infinity;
  const clipAxis = (q0, d, hi) => {
    if (Math.abs(d) < 1e-12) { if (q0 < 0 || q0 > hi) { t0 = 1; t1 = 0; } return; }
    let a = (0 - q0) / d, b = (hi - q0) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
  };
  clipAxis(q[0], dir[0], Lx);
  clipAxis(q[1], dir[1], Ly);
  if (!(t1 > t0)) { t0 = 0; t1 = 0; }
  const p0 = [q[0] + dir[0] * t0, q[1] + dir[1] * t0];
  const p1 = [q[0] + dir[0] * t1, q[1] + dir[1] * t1];
  return { p0, p1, dir, nrm, len: t1 - t0, offset, angle };
}

export function sliceFromPoints(a, b, Lx = 4, Ly = 4) {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (Math.hypot(dx, dy) < 1e-3) return null;
  const angle = Math.atan2(dy, dx);
  const n = [-Math.sin(angle), Math.cos(angle)];
  const offset = wrapOffset(angle, (a.x - Lx / 2) * n[0] + (a.y - Ly / 2) * n[1], Lx, Ly);
  return { angle, offset };
}

export function surfaceToBox(px, py, rect, Lx = 4, Ly = 4) {
  if (!rect || px < rect.x || py < rect.y || px > rect.x + rect.w || py > rect.y + rect.h) return null;
  return { x: ((px - rect.x) / rect.w) * Lx, y: (1 - (py - rect.y) / rect.h) * Ly };
}

export function boxToSurface(x, y, rect, Lx = 4, Ly = 4) {
  return { px: rect.x + (x / Lx) * rect.w, py: rect.y + (1 - y / Ly) * rect.h };
}

export function zScaleLabel(z) {
  if (!(z > 1.001)) return '';
  return `Vertical scale ×${(Math.round(z * 10) / 10).toFixed(1)}`;
}

export function rectInside(r, o, eps = 0.5) {
  return r.x >= o.x - eps && r.y >= o.y - eps && r.x + r.w <= o.x + o.w + eps && r.y + r.h <= o.y + o.h + eps;
}
