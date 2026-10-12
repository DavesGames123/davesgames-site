// ============================================================================
//  PATTERN DESIGNER  ·  patterns/kit.js — shared tools of the newer families
// ----------------------------------------------------------------------------
//  The tiling, textile, geometric, op-art, botanical, paths and mesh
//  families (and the newer grid and flow entries) draw through
//  board(ctx), an output that clips each element to the board rectangle.
//  So no point of their SVG falls outside the paper, and tests.mjs can
//  check that.
//
//  CLIP RULES
//    filled ring       Sutherland-Hodgman against the four board edges
//    stroked ring      cut into open runs (no false edge on the border)
//    open line         cut into runs (Liang-Barsky on each segment)
//    circle            kept as a circle when it is fully inside; else a
//                      64-gon that goes through the rules above
//    multi             each ring as a filled ring
//
//  grep -n targets
//    clipped output ....... "export function board"
//    lattice helpers ...... "export function cells"  "export function hexCells"
//    ink choice ........... "export function inkAt"
//    misc geometry ........ "export function arcPts"  "export function segX"
// ============================================================================
import { TAU, clamp, clipHalf } from '../engine.js';

// The part of a ring inside [x0, x1] x [y0, y1].
export function clipRing(p, x0, y0, x1, y1) {
  let q = clipHalf(p, -1, 0, -x0);
  if (q.length >= 6) q = clipHalf(q, 1, 0, x1);
  if (q.length >= 6) q = clipHalf(q, 0, -1, -y0);
  if (q.length >= 6) q = clipHalf(q, 0, 1, y1);
  return q.length >= 6 ? q : [];
}
// The runs of a polyline inside the rectangle.
export function clipRuns(p, x0, y0, x1, y1, closed = false) {
  const q = closed ? p.concat([p[0], p[1]]) : p, runs = [];
  let cur = null;
  for (let i = 2; i < q.length; i += 2) {
    let ax = q[i - 2], ay = q[i - 1], bx = q[i], by = q[i + 1], t0 = 0, t1 = 1;
    const dx = bx - ax, dy = by - ay;
    let keep = true;
    for (const [pp, qq] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]]) {
      if (pp === 0) { if (qq < 0) { keep = false; break; } continue; }
      const r = qq / pp;
      if (pp < 0) { if (r > t1) { keep = false; break; } if (r > t0) t0 = r; }
      else { if (r < t0) { keep = false; break; } if (r < t1) t1 = r; }
    }
    if (!keep) { if (cur) { runs.push(cur); cur = null; } continue; }
    const sx = ax + dx * t0, sy = ay + dy * t0, ex = ax + dx * t1, ey = ay + dy * t1;
    if (cur && t0 === 0) cur.push(ex, ey);
    else { if (cur) runs.push(cur); cur = [sx, sy, ex, ey]; }
    if (t1 < 1) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  // A closed ring that stays whole keeps its closing join.
  return runs.filter(r => r.length >= 4);
}
// A writer with the Out interface that clips to the board.
export function board(ctx) {
  const { W, H, out } = ctx;
  const inside = (x, y) => x >= 0 && y >= 0 && x <= W && y <= H;
  const allIn = p => { for (let i = 0; i < p.length; i += 2) if (!inside(p[i], p[i + 1])) return false; return true; };
  const B = {
    full: () => out.full(),
    poly(pts, closed = false, o = {}) {
      if (!pts || pts.length < 4) return false;
      if (allIn(pts)) return out.poly(pts, closed, o);
      const filled = closed && (o.f ?? 0) !== -1;
      if (filled) { const r = clipRing(pts, 0, 0, W, H); return r.length ? out.poly(r, true, o) : false; }
      let any = false;
      for (const r of clipRuns(pts, 0, 0, W, H, closed)) any = out.poly(r, false, Object.assign({}, o, { f: -1, s: o.s ?? 0 })) || any;
      return any;
    },
    line(x1, y1, x2, y2, o = {}) { return B.poly([x1, y1, x2, y2], false, o); },
    rect(x, y, w, h, o = {}) { return B.poly([x, y, x + w, y, x + w, y + h, x, y + h], true, o); },
    circle(x, y, r, o = {}) {
      if (!(r > 0.05)) return false;
      if (x - r >= 0 && y - r >= 0 && x + r <= W && y + r <= H) return out.circle(x, y, r, o);
      if (x + r < 0 || y + r < 0 || x - r > W || y - r > H) return false;
      const p = [], n = 64;
      for (let i = 0; i < n; i++) { const a = TAU * i / n; p.push(x + r * Math.cos(a), y + r * Math.sin(a)); }
      return B.poly(p, true, { f: o.f ?? 0, s: o.s ?? -1, w: o.w ?? 1 });
    },
    multi(rings, o = {}) {
      const rr = rings.map(r => allIn(r) ? r : clipRing(r, 0, 0, W, H)).filter(r => r.length >= 6);
      return rr.length ? out.multi(rr, o) : false;
    },
    ngon(x, y, r, n, rot = 0, o = {}, k = 1) {
      const pts = [], m = k === 1 ? n : 2 * n;
      for (let i = 0; i < m; i++) { const a = rot + TAU * i / m, q = (k !== 1 && i % 2) ? r * k : r; pts.push(x + q * Math.cos(a), y + q * Math.sin(a)); }
      return B.poly(pts, true, o);
    },
  };
  return B;
}

// ── lattices ───────────────────────────────────────────────────────────────
// A square grid of n cells across the short side, centred on the board.
export function cells(ctx, n) {
  const s = ctx.S / n, nx = Math.ceil(ctx.W / s) + 1, ny = Math.ceil(ctx.H / s) + 1;
  return { s, nx, ny, x0: (ctx.W - nx * s) / 2, y0: (ctx.H - ny * s) / 2 };
}
// Centres of a pointy-top hex grid with circumradius R that covers the
// board: calls fn(x, y, i, j).
export function hexCells(ctx, R, fn) {
  const w = Math.sqrt(3) * R, h = 1.5 * R, nj = Math.ceil(ctx.H / h) + 2, ni = Math.ceil(ctx.W / w) + 2;
  for (let j = -1; j < nj; j++) for (let i = -1; i < ni; i++) {
    const x = i * w + (j & 1 ? w / 2 : 0), y = j * h;
    fn(x, y, i, j);
    if (ctx.out.full()) return;
  }
}
// ── ink ────────────────────────────────────────────────────────────────────
// An ink slot 0..n-1. mix 0: a slow noise field picks (colour in
// patches); mix 1: each call picks at random.
export function inkAt(ctx, x, y, n, mix = 0.3, sc = 0.0022) {
  if (n <= 1) return 0;
  if (ctx.rng.chance(mix)) return ctx.rng.int(0, n - 1);
  return clamp(Math.floor((0.5 + 0.55 * ctx.noise.fbm(x * sc, y * sc, 2)) * n), 0, n - 1);
}
// ── geometry ───────────────────────────────────────────────────────────────
// Points on an arc about (cx, cy), about one point per 5 units of length.
export function arcPts(cx, cy, r, a0, a1, step = 5) {
  const n = Math.max(3, Math.ceil(Math.abs(a1 - a0) * r / step)), p = [];
  for (let k = 0; k <= n; k++) { const a = a0 + (a1 - a0) * k / n; p.push(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
  return p;
}
// The crossing of the line p + t d with the line q + u e. Returns
// [x, y, t, u] or null when the lines are parallel.
export function segX(px, py, dx, dy, qx, qy, ex, ey) {
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((qx - px) * ey - (qy - py) * ex) / den, u = ((qx - px) * dy - (qy - py) * dx) / den;
  return [px + t * dx, py + t * dy, t, u];
}
// Rotate a flat point list about (cx, cy) by angle a.
export function turn(p, cx, cy, a) {
  if (!a) return p;
  const c = Math.cos(a), s = Math.sin(a), o = new Array(p.length);
  for (let i = 0; i < p.length; i += 2) { const x = p[i] - cx, y = p[i + 1] - cy; o[i] = cx + x * c - y * s; o[i + 1] = cy + x * s + y * c; }
  return o;
}
