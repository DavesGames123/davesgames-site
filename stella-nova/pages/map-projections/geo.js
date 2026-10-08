// ============================================================================
//  MAP PROJECTIONS  ·  geo.js — clip, close, resample, project  (no DOM)
// ----------------------------------------------------------------------------
//  Input geometry is world unit vectors. Output is screen x, y lists, ready
//  for a canvas path. One or more "frames" take part: a frame is one map
//  (proj.js makeMap) with its screen transform and a weight. A still map has
//  one frame of weight 1. A morph has two: the geometry is clipped by both
//  maps, so every vertex is valid in both, and the screen point is the
//  weighted sum. No edge can then jump across the map during the morph.
//
//  CLIPPING, per frame, in its clip frame (see proj.js FRAMES):
//   1. Each vertex gets its clip lon/lat. Lon is unwrapped along the ring.
//   2. A ring whose unwrapped lon walks a full turn goes round a pole of
//      the clip frame (interior on the left: east -> north pole, west ->
//      south pole). It is closed along that pole (two meridian edges and
//      the pole edge), so it becomes a plain polygon in the lon/lat plane.
//   3. Sutherland-Hodgman against each rect of the map, for each copy of
//      the polygon shifted by -2pi, 0, +2pi. The crossings are exact: with
//      a meridian, the plane through the axis; with a parallel, the small
//      circle (a quadratic along the chord).
//  Edge kinds: an edge is a great-circle arc of the source (kind -1), or a
//  straight line in the clip lon/lat plane of frame k (kind k: the cut, an
//  edge parallel, the pole edge), which is how it is resampled.
//
//  RESAMPLING. Each edge is split at its midpoint (on the great circle, or
//  on the planar line for kind k) while the projected midpoint is more
//  than tol px off the chord, or the chord is longer than maxSeg px.
//
//  GREP MAP
//    grep -n 'export function frameOf'      a frame: map + screen + weight
//    grep -n 'export function clipPolygon'  rings -> filled pieces
//    grep -n 'export function clipLine'     lines -> stroked runs
//    grep -n 'export function outline'      the edge of the map (the sphere)
//    grep -n 'export function graticule'    meridians and parallels
//    grep -n 'export function pointAt'      one world point -> screen
// ============================================================================
import { apply, vec, rawIn, rectOf, D, PI, TAU, HALF } from './proj.js';

const { sin, cos, atan2, hypot, sqrt, abs, min, max } = Math;

// screen: { k, x, y, sy }: X = x + k * rawX, Y = y + sy * k * rawY. sy is -1
// for a canvas (y down) and the default.
export function frameOf(m, screen, weight = 1, rects = null) {
  const k = screen.k, ox = screen.x, oy = screen.y, sy = (screen.sy ?? -1) * k;
  return {
    m, M: m.M, Mt: m.Mt, rects: rects || m.rects, w: weight,
    project(L, P, r) { const q = rawIn(m, L, P, r); return [ox + k * q[0], oy + sy * q[1]]; },
  };
}

// ── vertices ───────────────────────────────────────────────────────────────
// { w: world unit vector, L, P: clip lon/lat per frame, r: rect per frame,
//   b: kind of the edge to the next vertex }
const _t = [0, 0, 0];
function clipLL(F, w) { apply(F.M, w, _t); return [atan2(_t[1], _t[0]), atan2(_t[2], hypot(_t[0], _t[1]))]; }
function fromPlanar(F, l, p) { const c = cos(p); return apply(F.Mt, [c * cos(l), c * sin(l), sin(p)]); }
const near = (l, ref) => l - ref > PI ? l - TAU : ref - l > PI ? l + TAU : l;
function norm(v) { const n = hypot(v[0], v[1], v[2]) || 1; v[0] /= n; v[1] /= n; v[2] /= n; return v; }
function mk(w, nf) { return nf === 1 ? { w, L: [0], P: [0], r: [0], b: -1 } : { w, L: [0, 0], P: [0, 0], r: [0, 0], b: -1 }; }
// A new vertex at world point w: frames before k get lon on the branch of
// the reference vertices a, b (both on the same side of any earlier cut).
function derive(w, a, b, k, frames) {
  const v = mk(w, frames.length);
  for (let j = 0; j < k; j++) {
    const ll = clipLL(frames[j], w);
    v.L[j] = max(min(near(ll[0], (a.L[j] + b.L[j]) / 2), max(a.L[j], b.L[j]) + 1e-12), min(a.L[j], b.L[j]) - 1e-12);
    // keep inside the rect of a (pieces are inside one rect per frame)
    v.P[j] = ll[1]; v.r[j] = a.r[j];
  }
  return v;
}

// ── polygon clipping ───────────────────────────────────────────────────────
// rings: arrays of world unit vectors (closed implicitly). Returns pieces
// { xy: [X, Y, ...] } in screen px, or with raw: true the vertex lists.
export function clipPolygon(rings, frames, opt = {}) {
  let pieces = [];
  for (const r of rings) {
    if (r.length < 3) continue;
    pieces.push(r.map(w => mk(w, frames.length)));
  }
  for (let k = 0; k < frames.length; k++) {
    const out = [];
    for (let pc of pieces) {
      if (k > 0) pc = densifyPlanar(pc, k, frames);
      clipRingInFrame(pc, k, frames, out);
    }
    pieces = out;
  }
  if (opt.raw) return pieces;
  return pieces.map(pc => ({ xy: resample(pc, frames, true, opt), rects: pc[0].r.slice() }));
}
// Edges that are straight in an earlier frame's lon/lat plane are cut into
// 2 deg steps before a later frame clips them as great-circle arcs.
function densifyPlanar(pc, k, frames, closed = true) {
  const out = [], n = pc.length;
  for (let i = 0; i < n; i++) {
    const a = pc[i]; out.push(a);
    if (!closed && i === n - 1) break;
    if (a.b < 0 || a.b >= k) continue;
    const b = pc[(i + 1) % n], j = a.b, F = frames[j];
    const steps = Math.ceil(max(abs(b.L[j] - a.L[j]), abs(b.P[j] - a.P[j])) / (2 * D));
    for (let s = 1; s < steps; s++) {
      const t = s / steps, l = a.L[j] + (b.L[j] - a.L[j]) * t, p = a.P[j] + (b.P[j] - a.P[j]) * t;
      const v = derive(fromPlanar(F, l, p), a, b, j, frames);
      v.L[j] = l; v.P[j] = p; v.r[j] = a.r[j]; v.b = j;
      for (let q = j + 1; q < k; q++) { const ll = clipLL(frames[q], v.w); v.L[q] = near(ll[0], a.L[q]); v.P[q] = ll[1]; v.r[q] = a.r[q]; }
      out.push(v);
    }
  }
  return out;
}

// Unwrapped clip lon (u) and lat (p) of a vertex list in frame k.
function unwrap(pc, k, F) {
  const n = pc.length, u = new Float64Array(n), p = new Float64Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const ll = clipLL(F, pc[i].w);
    u[i] = i === 0 ? ll[0] : prev + wrapD(ll[0] - (prev - TAU * Math.round(prev / TAU)));
    // keep the exact lon of a vertex made on this frame's own cut: none yet
    prev = u[i]; p[i] = ll[1];
  }
  return { u, p };
}
const wrapD = d => d - TAU * Math.round(d / TAU);

function clipRingInFrame(pc, k, frames, out) {
  const F = frames[k];
  let { u, p } = unwrap(pc, k, F);
  let V = pc.slice();
  const n = V.length;
  const W = u[n - 1] + wrapD(atan2Lon(F, V[0].w) - atan2Lon(F, V[n - 1].w)) - u[0];
  if (abs(W) > PI) {
    // Closes round a pole: east (W > 0) -> north, west -> south. The ring
    // is first restarted where it crosses the cut (u = pi mod 2 pi), so the
    // closing edges run along the cut: the map edge in a cylinder, a slit
    // of zero area in an azimuthal map, never a seam through the map.
    const P0 = W > 0 ? HALF : -HALF;
    const uu = Array.from(u), pp = Array.from(p);
    uu.push(u[n - 1] + wrapD(atan2Lon(F, V[0].w) - atan2Lon(F, V[n - 1].w))); pp.push(p[0]);
    const band = x => Math.floor((x + PI) / TAU);
    let at = -1;
    for (let i = 0; i < n; i++) if (band(uu[i]) !== band(uu[i + 1])) { at = i; break; }
    let X = null, cU = 0;
    if (at >= 0) {
      const b0 = band(uu[at]), b1 = band(uu[at + 1]);
      cU = (b1 > b0 ? b1 : b0) * TAU - PI;
      const e = { v: V[(at + 1) % n], u: uu[at + 1], p: pp[at + 1] };
      X = cross({ v: V[at], u: uu[at], p: pp[at] }, e, 0, cU, V[at].b, k, frames);
    }
    // The new order: the crossing, the rest of the ring, back to the
    // vertex before the crossing. The unwrapped lon is walked again.
    const nv = [], np = [];
    if (X) { X.v.b = V[at].b; nv.push(X.v); np.push(X.p); }
    for (let q = 1; q <= n; q++) { const i = X ? (at + q) % n : q - 1; nv.push(V[i]); np.push(p[i]); }
    const nu = [X ? cU : u[0]];
    for (let q = 1; q < nv.length; q++) nu.push(nu[q - 1] + wrapD(atan2Lon(F, nv[q].w) - atan2Lon(F, nv[q - 1].w)));
    const u0 = nu[0], p0 = np[0], uE = u0 + W;
    const a = cloneV(nv[0]), b = closeVertex(null, k, frames, uE, P0, F), c = closeVertex(null, k, frames, u0, P0, F);
    a.b = k; b.b = k; c.b = k;
    nv.push(a, b, c); nu.push(uE, uE, u0); np.push(p0, P0, P0);
    V = nv; u = Float64Array.from(nu); p = Float64Array.from(np);
  }
  let lo = Infinity, hi = -Infinity, plo = Infinity, phi = -Infinity;
  for (let i = 0; i < u.length; i++) { if (u[i] < lo) lo = u[i]; if (u[i] > hi) hi = u[i]; if (p[i] < plo) plo = p[i]; if (p[i] > phi) phi = p[i]; }
  // Fast path: the whole ring lies inside one rect (most islands).
  if (V === pc || V.length === pc.length) {
    for (let ri = 0; ri < F.rects.length; ri++) {
      const R = F.rects[ri];
      if (plo < R[2] || phi > R[3]) continue;
      for (let o = -1; o <= 1; o++) {
        const off = o * TAU;
        if (lo >= R[0] + off && hi <= R[1] + off) {
          const own = k === 0;   // frame 0 made these vertices: safe to write
          out.push(V.map((v, i) => { const c = own ? v : cloneV(v); c.L[k] = u[i] - off; c.P[k] = p[i]; c.r[k] = ri; return c; }));
          return;
        }
      }
    }
  }
  for (let ri = 0; ri < F.rects.length; ri++) {
    const R = F.rects[ri];
    for (let o = -2; o <= 2; o++) {
      const off = o * TAU;
      if (hi < R[0] + off - 1e-12 || lo > R[1] + off + 1e-12) continue;
      let pts = V.map((v, i) => ({ v, u: u[i] - off, p: p[i] }));
      pts = shClip(pts, 0, R[0], k, frames, true);
      if (pts.length > 2) pts = shClip(pts, 0, R[1], k, frames, false);
      if (pts.length > 2 && R[2] > -HALF + 1e-12) pts = shClip(pts, 1, R[2], k, frames, true);
      if (pts.length > 2 && R[3] < HALF - 1e-12) pts = shClip(pts, 1, R[3], k, frames, false);
      if (pts.length < 3 || abs(planarArea(pts)) < 1e-12) continue;   // a sliver on the cut
      out.push(pts.map(q => { const v = cloneV(q.v); v.L[k] = q.u; v.P[k] = q.p; v.r[k] = ri; v.b = q.b ?? q.v.b; return v; }));
    }
  }
}
function planarArea(q) { let a = 0; for (let i = 0, n = q.length; i < n; i++) { const j = (i + 1) % n; a += q[i].u * q[j].p - q[j].u * q[i].p; } return a / 2; }
function planarLength(q) { let s = 0; for (let i = 1; i < q.length; i++) s += abs(q[i].u - q[i - 1].u) + abs(q[i].p - q[i - 1].p); return s; }
const atan2Lon = (F, w) => { apply(F.M, w, _t); return atan2(_t[1], _t[0]); };
function cloneV(v) { const c = { w: v.w, L: v.L.slice(), P: v.P.slice(), r: v.r.slice(), b: v.b }; return c; }
function closeVertex(src, k, frames, u, p, F = frames[k]) {
  const w = src ? src.w : fromPlanar(F, u, p);
  const v = src ? cloneV(src) : mk(w, frames.length);
  if (!src) for (let j = 0; j < k; j++) { const ll = clipLL(frames[j], w); v.L[j] = ll[0]; v.P[j] = ll[1]; }
  return v;
}

// One half-plane of Sutherland-Hodgman. axis 0: u >= c (keepGE) or u <= c;
// axis 1: p >= c or p <= c. Points are { v, u, p, b? } (b overrides v.b).
function shClip(pts, axis, c, k, frames, keepGE) {
  const n = pts.length, out = [];
  const val = q => axis ? q.p : q.u;
  const inside = q => keepGE ? val(q) >= c - 1e-12 : val(q) <= c + 1e-12;
  for (let i = 0; i < n; i++) {
    const s = pts[i], e = pts[(i + 1) % n], si = inside(s), ei = inside(e);
    const kind = s.b ?? s.v.b;
    if (si) out.push(s);
    if (si !== ei) {
      const x = cross(s, e, axis, c, kind, k, frames);
      if (si) { x.b = k; out.push(x); }            // leaving: the next edge runs on the boundary
      else { x.b = kind; out.push(x); }            // entering: the rest of this edge
    }
  }
  return out;
}
// The crossing of edge s -> e with u = c (axis 0) or p = c (axis 1).
function cross(s, e, axis, c, kind, k, frames) {
  const F = frames[k];
  let w, u, p;
  if (kind === k) {
    const t = axis ? (c - s.p) / (e.p - s.p) : (c - s.u) / (e.u - s.u);
    u = s.u + (e.u - s.u) * t; p = s.p + (e.p - s.p) * t;
    if (axis) p = c; else u = c;
    w = fromPlanar(F, u, p);
  } else {
    const S = apply(F.M, s.v.w, [0, 0, 0]), E = apply(F.M, e.v.w, [0, 0, 0]);
    const d = [E[0] - S[0], E[1] - S[1], E[2] - S[2]];
    let t;
    if (!axis) {
      const nx = -sin(c), ny = cos(c), a = S[0] * nx + S[1] * ny, b = E[0] * nx + E[1] * ny;
      t = abs(a - b) < 1e-300 ? 0.5 : a / (a - b);
    } else {
      const sc = sin(c), s2 = sc * sc;
      const A = d[2] * d[2] - s2 * (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
      const B = 2 * (S[2] * d[2] - s2 * (S[0] * d[0] + S[1] * d[1] + S[2] * d[2]));
      const C = S[2] * S[2] - s2 * (S[0] * S[0] + S[1] * S[1] + S[2] * S[2]);
      t = solveRoot(A, B, C, S[2], d[2], sc);
    }
    t = max(0, min(1, t));
    const X = [S[0] + d[0] * t, S[1] + d[1] * t, S[2] + d[2] * t]; norm(X);
    w = apply(F.Mt, X, [0, 0, 0]);
    if (axis) { p = c; u = near(atan2(X[1], X[0]), s.u + (e.u - s.u) * t); u = max(min(u, max(s.u, e.u)), min(s.u, e.u)); }
    else { u = c; p = atan2(X[2], hypot(X[0], X[1])); }
  }
  const v = derive(w, s.v, e.v, k, frames);
  return { v, u, p };
}
function solveRoot(A, B, C, z0, dz, sc) {
  const ok = t => t >= -1e-9 && t <= 1 + 1e-9 && (z0 + dz * t) * sc >= -1e-15;
  if (abs(A) < 1e-15) { const t = -C / B; return ok(t) ? t : 0.5; }
  const disc = B * B - 4 * A * C; if (disc < 0) return 0.5;
  const q = sqrt(disc), t1 = (-B - q) / (2 * A), t2 = (-B + q) / (2 * A);
  if (ok(t1) && ok(t2)) return min(t1, t2) >= 0 ? min(t1, t2) : max(t1, t2);
  return ok(t1) ? t1 : ok(t2) ? t2 : 0.5;
}

// ── line clipping ──────────────────────────────────────────────────────────
// line: world unit vectors. Returns runs { xy }.
export function clipLine(line, frames, opt = {}) {
  let runs = [line.map(w => mk(w, frames.length))];
  for (let k = 0; k < frames.length; k++) {
    const out = [];
    for (let run of runs) {
      if (k > 0) run = densifyPlanar(run, k, frames, false);
      clipRunInFrame(run, k, frames, out);
    }
    runs = out;
  }
  if (opt.raw) return runs;
  return runs.map(r => ({ xy: resample(r, frames, false, opt) }));
}
function clipRunInFrame(run, k, frames, out) {
  if (run.length < 2) return;
  const F = frames[k], { u, p } = unwrap(run, k, F);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < u.length; i++) { if (u[i] < lo) lo = u[i]; if (u[i] > hi) hi = u[i]; }
  for (let ri = 0; ri < F.rects.length; ri++) {
    const R = F.rects[ri];
    for (let o = -2; o <= 2; o++) {
      const off = o * TAU;
      if (hi < R[0] + off - 1e-12 || lo > R[1] + off + 1e-12) continue;
      let parts = [run.map((v, i) => ({ v, u: u[i] - off, p: p[i] }))];
      const planes = [[0, R[0], true], [0, R[1], false]];
      if (R[2] > -HALF + 1e-12) planes.push([1, R[2], true]);
      if (R[3] < HALF - 1e-12) planes.push([1, R[3], false]);
      for (const [axis, c, ge] of planes) {
        const next = [];
        for (const part of parts) splitRun(part, axis, c, ge, k, frames, next);
        parts = next;
      }
      for (const part of parts) if (part.length > 1 && planarLength(part) > 1e-12) out.push(part.map(q => { const v = cloneV(q.v); v.L[k] = q.u; v.P[k] = q.p; v.r[k] = ri; v.b = q.b ?? q.v.b; return v; }));
    }
  }
}
function splitRun(pts, axis, c, keepGE, k, frames, out) {
  const val = q => axis ? q.p : q.u;
  const inside = q => keepGE ? val(q) >= c - 1e-12 : val(q) <= c + 1e-12;
  let cur = [];
  for (let i = 0; i < pts.length; i++) {
    const s = pts[i], si = inside(s);
    if (si) cur.push(s);
    if (i === pts.length - 1) break;
    const e = pts[i + 1], ei = inside(e);
    if (si !== ei) {
      const x = cross(s, e, axis, c, s.b ?? s.v.b, k, frames);
      x.b = s.b ?? s.v.b;
      cur.push(x);
      if (si) { if (cur.length > 1) out.push(cur); cur = []; }
    }
  }
  if (cur.length > 1) out.push(cur);
}

// ── resampling and projection ──────────────────────────────────────────────
function screenOf(v, frames) {
  if (frames.length === 1) return frames[0].project(v.L[0], v.P[0], v.r[0]);
  let X = 0, Y = 0;
  for (let k = 0; k < frames.length; k++) { const q = frames[k].project(v.L[k], v.P[k], v.r[k]); X += frames[k].w * q[0]; Y += frames[k].w * q[1]; }
  return [X, Y];
}
function midV(a, b, frames) {
  const nf = frames.length, kind = a.b;
  let w;
  const v = { w: null, L: nf === 1 ? [0] : [0, 0], P: nf === 1 ? [0] : [0, 0], r: a.r, b: kind };
  if (kind >= 0) {
    const F = frames[kind];
    v.L[kind] = (a.L[kind] + b.L[kind]) / 2; v.P[kind] = (a.P[kind] + b.P[kind]) / 2;
    w = fromPlanar(F, v.L[kind], v.P[kind]);
  } else {
    w = norm([a.w[0] + b.w[0], a.w[1] + b.w[1], a.w[2] + b.w[2]]);
    if (!isFinite(w[0])) w = a.w;
  }
  v.w = w;
  for (let k = 0; k < nf; k++) {
    if (k === kind) continue;
    const ll = clipLL(frames[k], w);
    const lo = min(a.L[k], b.L[k]), hi = max(a.L[k], b.L[k]);
    v.L[k] = max(lo, min(hi, near(ll[0], (a.L[k] + b.L[k]) / 2)));
    v.P[k] = ll[1];
  }
  return v;
}
function resample(pc, frames, closed, opt) {
  const tol = opt.tol ?? 0.35, tol2 = tol * tol, short2 = (opt.short ?? 3) ** 2, maxSeg = opt.maxSeg ?? 60, max2 = maxSeg * maxSeg, depthMax = opt.depth ?? 12;
  const out = [];
  const n = pc.length, last = closed ? n : n - 1;
  let A = screenOf(pc[0], frames);
  out.push(A[0], A[1]);
  const rec = (a, b, Pa, Pb, depth) => {
    if (depth >= depthMax) return;
    const dx = Pb[0] - Pa[0], dy = Pb[1] - Pa[1], len2 = dx * dx + dy * dy;
    if (len2 < short2 && a.b < 0) return;   // a short great-circle chord cannot bow by tol
    const m = midV(a, b, frames), Pm = screenOf(m, frames);
    const ex = Pm[0] - (Pa[0] + Pb[0]) / 2, ey = Pm[1] - (Pa[1] + Pb[1]) / 2;
    if (ex * ex + ey * ey > tol2 || len2 > max2) {
      rec(a, m, Pa, Pm, depth + 1);
      out.push(Pm[0], Pm[1]);
      rec(m, b, Pm, Pb, depth + 1);
    }
  };
  for (let i = 0; i < last; i++) {
    const a = pc[i], b = pc[(i + 1) % n], B = screenOf(b, frames);
    rec(a, b, A, B, 0);
    if (i < n - 1 || !closed) out.push(B[0], B[1]);
    A = B;
  }
  return out;
}

// ── the map edge and the graticule ─────────────────────────────────────────
// The outline: each rect of frame 0 as a planar ring (kind 0), then clipped
// by the other frames. In a still map this is the "sphere": fill it for the
// ocean, stroke it for the edge.
export function outline(frames, opt = {}) {
  const F = frames[0], nf = frames.length, out = [];
  for (let ri = 0; ri < F.rects.length; ri++) {
    const [l0, l1, p0, p1] = F.rects[ri];
    const corners = [[l0, p0], [l1, p0], [l1, p1], [l0, p1]];
    let pc = corners.map(([l, p]) => {
      const v = mk(fromPlanar(F, l, p), nf); v.L[0] = l; v.P[0] = p; v.r[0] = ri; v.b = 0; return v;
    });
    let pieces = [pc];
    for (let k = 1; k < nf; k++) {
      const next = [];
      for (const q of pieces) clipRingInFrame(densifyPlanar(q, k, frames), k, frames, next);
      pieces = next;
    }
    for (const q of pieces) out.push(opt.raw ? q : { xy: resample(q, frames, true, opt) });
  }
  return out;
}
// The visible edge of the map, for a stroke: the outline without the
// edges that lie inside the map. In an azimuthal clip frame the cut
// (lon = +-pi) is a radius and the +pi/2 pole edge is the centre point.
export function edgeLines(frames, opt = {}) {
  const runs = [];
  const hidden = (a, b) => {
    const k = a.b; if (k < 0) return false;
    const F = frames[k]; if (!F.m.def) return false;
    // an interrupted map: the equator between its north and south lobes
    if (F.rects.length > 1 && abs(a.P[k]) < 1e-9 && abs(b.P[k]) < 1e-9) return true;
    if (F.m.def.family !== 'azimuthal') return false;
    const onCut = abs(abs(a.L[k]) - PI) < 1e-9 && abs(abs(b.L[k]) - PI) < 1e-9;
    const onPole = abs(a.P[k] - HALF) < 1e-9 && abs(b.P[k] - HALF) < 1e-9;   // the centre point; the antipode edge (-pi/2) is the rim
    return onCut || onPole;
  };
  for (const pc of outline(frames, Object.assign({}, opt, { raw: true }))) {
    const n = pc.length;
    let start = 0;
    for (let i = 0; i < n; i++) if (hidden(pc[i], pc[(i + 1) % n])) { start = i + 1; break; }
    let cur = [];
    for (let q = 0; q <= n; q++) {
      const i = (start + q) % n, a = pc[i], b = pc[(i + 1) % n];
      cur.push(a);
      if (q === n) break;
      if (hidden(a, b)) { if (cur.length > 1) runs.push(cur); cur = []; }
    }
    if (cur.length > 1) runs.push(cur);
  }
  return runs.map(r => ({ xy: resample(r, frames, false, opt) }));
}
// Graticule lines as world unit vectors, densified every 1 deg (parallels
// are small circles, so they are not great-circle edges).
export function graticule(step = 15, opt = {}) {
  const lines = [], mLat = opt.meridianLat ?? 89.9999, ext = opt.full ?? 89.9999;
  for (let lo = -180; lo < 180; lo += step) {
    const lim = lo % 90 === 0 ? ext : mLat, pts = [];
    for (let la = -lim; la <= lim + 1e-9; la += 1) pts.push(vec(lo * D, la * D));
    lines.push(pts);
  }
  for (let la = -90 + step; la < 90; la += step) {
    const pts = [];
    for (let lo = -180; lo <= 180; lo += 1) pts.push(vec(lo * D, la * D));
    lines.push(pts);
  }
  return lines;
}
// One world point (radians) -> screen, or null where a frame does not show it.
export function pointAt(frames, lo, la) {
  const w = vec(lo, la);
  let X = 0, Y = 0;
  for (const F of frames) {
    const ll = clipLL(F, w), r = rectOf({ rects: F.rects }, ll[0], ll[1]);
    if (r < 0) return null;
    const q = F.project(ll[0], ll[1], r); X += F.w * q[0]; Y += F.w * q[1];
  }
  return [X, Y];
}
// Rings from the data format (flat [lon, lat] in 1/100 deg) to unit vectors.
export function ringsFromFlat(list, scale = 0.01) {
  return list.map(r => { const out = []; for (let i = 0; i < r.length; i += 2) out.push(vec(r[i] * scale * D, r[i + 1] * scale * D)); return out; });
}
// The same rings as stroke lines, broken at edges that run along the +-180
// meridian (the seams where Natural Earth cuts Russia, Fiji, Antarctica).
export function seamlessLines(list, scale = 0.01) {
  const out = [];
  for (const r of list) {
    const n = r.length / 2; let cur = [];
    for (let i = 0; i <= n; i++) {
      const j = i % n, lo = r[2 * j] * scale, la = r[2 * j + 1] * scale;
      if (cur.length) {
        const pj = (i - 1) % n, plo = r[2 * pj] * scale;
        if (abs(abs(plo) - 180) < 1e-6 && abs(abs(lo) - 180) < 1e-6) { if (cur.length > 1) out.push(cur); cur = []; }
      }
      cur.push(vec(lo * D, la * D));
    }
    if (cur.length > 1) out.push(cur);
  }
  return out;
}
