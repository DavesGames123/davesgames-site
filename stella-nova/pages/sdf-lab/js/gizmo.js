// ============================================================================
//  SDF FORGE  ·  gizmo.js — move, rotate and scale handles
// ----------------------------------------------------------------------------
//  PURE. It reads a pane projection and pointer pixels and returns line
//  geometry and a total delta. Nothing here touches the page.
//
//  THE GIZMO IS A CONSTANT NUMBER OF PIXELS (Forge gizmo/mod.rs). AXIS_PX is
//  a length on screen; worldPerPx at the pivot turns it into world units.
//  Every tolerance is a pixel too, and a touch screen multiplies all of them
//  so a finger can grab a handle.
//
//  drag RETURNS THE TOTAL DELTA SINCE begin, never a per-frame step. The
//  caller keeps the transform from the press and applies the total to it, so
//  one undo is one record and a snap lands on the absolute value. Rotation
//  unwraps the atan2 angle against the previous sample, so it can pass half
//  a turn.
//
//  HANDLES
//    move    three axis arrows, three plane squares, a centre square (screen plane)
//    rotate  three rings (front half live), one outer ring about the view axis
//    scale   three axis boxes, a centre box (uniform)
//
//  GREP MAP
//    AXIS_PX / TOL ........ the pixel sizes
//    build ................ handles for a pivot, axes and tool
//    hit .................. the handle under a pixel (nearest within tolerance)
//    begin / drag ......... a drag and its total delta
// ============================================================================
import * as V from './math.js';

export const AXIS_PX = 92;
export const TOL = { axis: 12, ring: 8, plane: 2, center: 10 };
export const COLORS = ['#e2474e', '#63c24c', '#4f86e8'];
export const HOT = '#ffd84a';

// axes: three world unit vectors (WORLD or LOCAL frame)
export function build(P, c, axes, tool, ui = 1) {
  const wl = P.worldPerPx(c) * AXIS_PX * ui;
  const pc = P.project(c);
  if (!pc) return null;
  const toEye = P.ortho ? V.scale(P.fwd, -1) : V.norm(V.sub(P.eye, c));
  const G = { P, c, axes, tool, wl, ui, pc, toEye, handles: [] };
  const pr = p => P.project(p);
  if (tool === 'move' || tool === 'scale') {
    for (let i = 0; i < 3; i++) {
      const a = axes[i], p0 = pr(V.add(c, V.scale(a, wl * 0.16))), p1 = pr(V.add(c, V.scale(a, wl)));
      if (p0 && p1) G.handles.push({ id: 'a' + i, kind: 'axis', i, seg: [p0, p1], color: COLORS[i] });
    }
    if (tool === 'move') {
      for (const [i, j] of [[0, 1], [1, 2], [0, 2]]) {
        const k = 3 - i - j;
        const q = [[0.22, 0.22], [0.44, 0.22], [0.44, 0.44], [0.22, 0.44]].map(([s, t]) => pr(V.add(c, V.add(V.scale(axes[i], s * wl), V.scale(axes[j], t * wl)))));
        if (q.every(Boolean)) G.handles.push({ id: 'p' + k, kind: 'plane', i, j, k, quad: q, color: COLORS[k] });
      }
    }
    G.handles.push({ id: 'c', kind: 'center', box: 7 * ui, color: '#d8dbe4' });
  } else if (tool === 'rotate') {
    for (let i = 0; i < 3; i++) {
      const n = axes[i], b1 = axes[(i + 1) % 3], b2 = axes[(i + 2) % 3];
      const pts = [];
      for (let s = 0; s <= 72; s++) {
        const a = s / 72 * Math.PI * 2;
        const w = V.add(c, V.add(V.scale(b1, Math.cos(a) * wl), V.scale(b2, Math.sin(a) * wl)));
        const front = V.dot(V.sub(w, c), toEye) >= -0.02 * wl;
        const q = pr(w);
        pts.push(q ? [q[0], q[1], front] : null);
      }
      G.handles.push({ id: 'r' + i, kind: 'ring', i, n, pts, color: COLORS[i] });
    }
    const vp = [];
    const R = P.right, U = P.up;
    for (let s = 0; s <= 72; s++) { const a = s / 72 * Math.PI * 2; const q = pr(V.add(c, V.add(V.scale(R, Math.cos(a) * wl * 1.18), V.scale(U, Math.sin(a) * wl * 1.18)))); vp.push(q ? [q[0], q[1], true] : null); }
    G.handles.push({ id: 'rv', kind: 'ring', i: 3, n: toEye, pts: vp, color: '#9aa0ae' });
  }
  return G;
}

const segDist = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1;
  const t = V.clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L, 0, 1);
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
};
const inQuad = (p, q) => {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (c !== 0) { if (s && Math.sign(c) !== s) return false; s = Math.sign(c); }
  }
  return true;
};

// The handle under (x, y), or null. mul scales the tolerances (touch).
export function hit(G, x, y, mul = 1) {
  if (!G) return null;
  const p = [x, y];
  let best = null, bd = Infinity;
  const take = (h, d, tol) => { if (d <= tol * mul && d < bd) { bd = d; best = h; } };
  for (const h of G.handles) {
    if (h.kind === 'center') take(h, Math.max(Math.abs(x - G.pc[0]), Math.abs(y - G.pc[1])) - h.box, TOL.center * 0.6);
    else if (h.kind === 'axis') take(h, segDist(p, h.seg[0], h.seg[1]), TOL.axis);
    else if (h.kind === 'plane') { if (inQuad(p, h.quad)) take(h, 0.5, TOL.plane); }
    else if (h.kind === 'ring') {
      for (let s = 0; s < h.pts.length - 1; s++) {
        const a = h.pts[s], b = h.pts[s + 1];
        if (!a || !b || !(a[2] && b[2])) continue;
        take(h, segDist(p, a, b), TOL.ring);
      }
    }
  }
  // a centre or a plane handle wins inside its area (it sits on top)
  return best ? best.id : null;
}

function rayPlane(r, c, n) {
  const den = V.dot(r.d, n);
  if (Math.abs(den) < 1e-6) return null;
  const t = V.dot(V.sub(c, r.o), n) / den;
  return V.add(r.o, V.scale(r.d, t));
}
// Closest point on the line c + a s to the ray. Returns s, or null when the
// ray runs along the axis.
function lineParam(r, c, a) {
  const w0 = V.sub(r.o, c), b = V.dot(r.d, a), d = V.dot(r.d, w0), e = V.dot(a, w0);
  const den = 1 - b * b;
  if (den < 2e-3) return null;
  return (e - b * d) / den;
}

export function begin(G, id, x, y) {
  const h = G.handles.find(k => k.id === id);
  if (!h) return null;
  const r = G.P.ray(x, y);
  const S = { G, h, x0: x, y0: y, prevA: 0, total: 0 };
  if (h.kind === 'axis') {
    S.s0 = lineParam(r, G.c, G.axes[h.i]);
    const p0 = G.P.project(G.c), p1 = G.P.project(V.add(G.c, G.axes[h.i]));
    S.dir2 = p0 && p1 ? [p1[0] - p0[0], p1[1] - p0[1]] : [1, 0];   // px per world unit
  } else if (h.kind === 'plane') {
    S.n = G.axes[h.k]; S.h0 = rayPlane(r, G.c, S.n);
  } else if (h.kind === 'center') {
    S.n = G.P.fwd; S.h0 = rayPlane(r, G.c, S.n);
  } else if (h.kind === 'ring') {
    S.n = h.n;
    const b1 = Math.abs(S.n[1]) < 0.9 ? V.norm(V.cross(S.n, [0, 1, 0])) : V.norm(V.cross(S.n, [1, 0, 0]));
    S.b1 = b1; S.b2 = V.cross(S.n, b1);
    S.edge = Math.abs(V.dot(r.d, S.n)) < 0.12;
    const hp = rayPlane(r, G.c, S.n);
    S.a0 = hp ? angleIn(S, V.sub(hp, G.c)) : 0;
    // the screen tangent at the grab point, for an edge-on ring
    const q = G.P.project(G.c);
    S.tan2 = q ? V.norm([-(y - q[1]), x - q[0], 0]) : [1, 0, 0];
    S.rpx = q ? Math.max(20, Math.hypot(x - q[0], y - q[1])) : 60;
  }
  return S;
}
const angleIn = (S, v) => Math.atan2(V.dot(v, S.b2), V.dot(v, S.b1));

// The total change since begin: { move: [x y z] } | { rot: { axis, angle } } | { scale: [x y z] }
export function drag(S, x, y) {
  const G = S.G, h = S.h, r = G.P.ray(x, y);
  if (h.kind === 'axis') {
    const a = G.axes[h.i];
    let ds;
    const s = S.s0 == null ? null : lineParam(r, G.c, a);
    if (s == null) {
      // along the view axis: project the pointer motion on the axis' screen direction
      const L2 = Math.hypot(S.dir2[0], S.dir2[1]) || 1;
      ds = ((x - S.x0) * S.dir2[0] + (y - S.y0) * S.dir2[1]) / (L2 * L2);
    } else ds = s - S.s0;
    if (G.tool === 'scale') {
      const f = [1, 1, 1]; f[h.i] = Math.max(0.01, 1 + ds / G.wl);
      return { scale: f };
    }
    return { move: V.scale(a, ds) };
  }
  if (h.kind === 'plane' || h.kind === 'center') {
    if (G.tool === 'scale') { const f = Math.max(0.01, Math.exp(((x - S.x0) - (y - S.y0)) * 0.008)); return { scale: [f, f, f] }; }
    const hp = rayPlane(r, G.c, S.n);
    if (!hp || !S.h0) return { move: [0, 0, 0] };
    return { move: V.sub(hp, S.h0) };
  }
  if (h.kind === 'ring') {
    let a;
    if (S.edge) a = ((x - S.x0) * S.tan2[0] + (y - S.y0) * S.tan2[1]) / S.rpx;
    else {
      const hp = rayPlane(r, G.c, S.n);
      if (!hp) return { rot: { axis: S.n, angle: S.total } };
      a = angleIn(S, V.sub(hp, G.c)) - S.a0;
    }
    // unwrap against the last sample
    let da = a - S.prevA;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    S.total += da; S.prevA = a;
    return { rot: { axis: S.n, angle: S.total } };
  }
  return {};
}
