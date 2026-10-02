// app/draw.js -- the two panes' draw lists (app.rs draw_2d, draw_3d) and the GPU submit.
//
// draw2d builds the diagram: face fills from the sim mesh, the grid, the
// creases by kind, the hover and foldability marks, the vertex dots and the
// snap preview. draw3d builds the folded sheet: shaded faces sorted back to
// front, then the planar creases. Each returns { rect, tris, lines, over } in
// physical pixels for gpu.frame.
//
// grep map:
//   faceFill        -- a face pastel, mixed toward the accent on hover
//   disc / ring     -- the vertex dot and the mark ring
//   style2d         -- crease colour and width by kind
//   draw2d / draw3d -- the two panes
//   render          -- measure, draw both panes, the screensaver veil, submit

import { Assignment } from '../model.js';
import { reportOk } from '../foldability.js';
import { snap } from '../view.js';
import * as theme from '../theme.js';
import { tri } from '../tris.js';
import { seg } from '../lines.js';
import { th, S, gpu } from './state.js';
import { dpr, measure, geom2d, geom3d, view2d, region3d, phys, paneAt, snapPx } from './layout.js';

// The fill for a face: its pastel, moved toward the accent when hovered.
function faceFill(face) {
  const base = theme.facePastel(face);
  return S.hoveredFace === face ? theme.mix(base, th.accent, 0.4) : base;
}

// A disc as a triangle fan, for the vertex dots the native quad pass drew.
function disc(out, c, r, color) {
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    tri(out, c, [c[0] + Math.cos(a0) * r, c[1] + Math.sin(a0) * r], [c[0] + Math.cos(a1) * r, c[1] + Math.sin(a1) * r], color);
  }
}
// A ring as a closed polyline of segments.
function ring(out, c, r, w, color) {
  const n = 20;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    seg(out, [c[0] + Math.cos(a0) * r, c[1] + Math.sin(a0) * r], [c[0] + Math.cos(a1) * r, c[1] + Math.sin(a1) * r], w, color);
  }
}

// Crease style by kind, in the diagram (app.rs draw_2d).
function style2d(kind) {
  switch (kind) {
    case Assignment.Mountain: return [th.mountain, 2.4];
    case Assignment.Valley: return [th.valley, 2.4];
    case Assignment.Border: return [th.border, 3.0];
    case Assignment.Flat: return [theme.dim(th.aux, 0.9), 1.6];
    default: return [th.textDim, 1.8];
  }
}

export function draw2d() {
  const v = view2d();
  const tris = [], lines = [], over = [];
  // Line widths are the native physical widths at a 2x display. At 1x they
  // keep 80% of the native width, so a crease stays legible.
  const lw = Math.max(dpr * 0.5, 0.8);
  const planar = S.planar, mesh = S.mesh;

  // Each face in its pastel. The triangles come from the sim mesh, whose
  // indices match the planarized pattern.
  for (let t = 0; t < mesh.tris.length; t++) {
    const tv = mesh.tris[t].v;
    const f = mesh.faceOf[t] ?? 0;
    tri(tris, v.toPx(planar.vertices[tv[0]]), v.toPx(planar.vertices[tv[1]]), v.toPx(planar.vertices[tv[2]]), faceFill(f));
  }

  // The reference grid, faint, over the fills.
  if (S.showGrid) {
    const gc = theme.dim(th.grid, 0.6);
    for (let i = 0; i <= S.gridN; i++) {
      const t = -0.5 + i / S.gridN;
      seg(lines, v.toPx([t, -0.5]), v.toPx([t, 0.5]), 1.0 * lw, gc);
      seg(lines, v.toPx([-0.5, t]), v.toPx([0.5, t]), 1.0 * lw, gc);
    }
  }

  // Creases by kind. Boundaries thicker.
  for (let i = 0; i < S.pattern.edges.length; i++) {
    const [a, b] = S.pattern.segment(i);
    const [color, w] = style2d(S.pattern.assignment[i]);
    seg(lines, v.toPx(a), v.toPx(b), w * lw, color);
  }
  // The hovered crease, widened (web addition). With ERASE it shows the
  // crease a click removes, in the accent.
  if (S.hoveredCrease !== null && S.hoveredCrease < S.pattern.edges.length) {
    const [a, b] = S.pattern.segment(S.hoveredCrease);
    const [color, w] = style2d(S.pattern.assignment[S.hoveredCrease]);
    const c = S.tool === 'erase' ? th.accent : theme.mix(color, [1, 1, 1, 1], 0.3);
    seg(lines, v.toPx(a), v.toPx(b), (w + 2.6) * lw, c);
  }

  // Foldability: an amber ring on each interior vertex that fails a check.
  for (const r of S.report) {
    if (reportOk(r)) continue;
    ring(lines, v.toPx(planar.vertices[r.vertex]), 7 * dpr, 1.8 * dpr, th.bad);
  }
  if (S.hoveredVertex) {
    const r = S.hoveredVertex;
    ring(lines, v.toPx(planar.vertices[r.vertex]), 10 * dpr, 1.4 * dpr, reportOk(r) ? th.good : th.bad);
  }

  // Vertex dots above the creases.
  for (const p of S.pattern.vertices) disc(over, v.toPx(p), 2.6 * lw, th.textDim);

  // The rubber band while drawing, and the snap target under the pointer.
  if (S.cursor && paneAt(S.cursor) === '2d') {
    const end = snap(v.toWorld(phys(S.cursor)), S.pattern, S.gridN, v, snapPx());
    if (S.drawing && S.tool !== 'erase') seg(lines, v.toPx(S.drawing), v.toPx(end), 2.0 * lw, th.accent);
    if (S.tool !== 'erase') ring(lines, v.toPx(end), 4.5 * dpr, 1.2 * dpr, theme.dim(th.accent, 0.9));
  }
  return { rect: geom2d.rect, tris, lines, over };
}

export function draw3d() {
  const r = region3d();
  const aspect = (r[2] - r[0]) / Math.max(r[3] - r[1], 1);
  const m = S.orbit.matrix(aspect);
  const eye = S.orbit.eye();
  const L = [0.3, 0.7, 0.6]; const ll = Math.hypot(...L); const light = L.map((x) => x / ll);
  const N = S.mesh.nodes;
  const lw = Math.max(dpr * 0.5, 0.8);
  const tris = [], lines = [];

  // Faces, shaded, back to front. The side facing away is darker.
  const faces = [];
  for (let t = 0; t < S.mesh.tris.length; t++) {
    const [ia, ib, ic] = S.mesh.tris[t].v;
    const ax = N[3 * ia], ay = N[3 * ia + 1], az = N[3 * ia + 2];
    const bx = N[3 * ib], by = N[3 * ib + 1], bz = N[3 * ib + 2];
    const cx = N[3 * ic], cy = N[3 * ic + 1], cz = N[3 * ic + 2];
    const pa = S.orbit.project(ax, ay, az, m, r), pb = S.orbit.project(bx, by, bz, m, r), pc = S.orbit.project(cx, cy, cz, m, r);
    if (!pa || !pb || !pc) continue;
    const gx = (ax + bx + cx) / 3, gy = (ay + by + cy) / 3, gz = (az + bz + cz) / 3;
    const depth = Math.hypot(eye[0] - gx, eye[1] - gy, eye[2] - gz);
    const ux = bx - ax, uy = by - ay, uz = bz - az, wx = cx - ax, wy = cy - ay, wz = cz - az;
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const nl = Math.hypot(nx, ny, nz);
    if (nl > 0 && Number.isFinite(nl)) { nx /= nl; ny /= nl; nz /= nl; } else { nx = ny = nz = 0; }
    let vx = eye[0] - gx, vy = eye[1] - gy, vz = eye[2] - gz;
    const vl = Math.hypot(vx, vy, vz) || 1; vx /= vl; vy /= vl; vz /= vl;
    const facing = nx * vx + ny * vy + nz * vz;
    const side = facing >= 0 ? 1.0 : 0.66;
    const lambert = 0.74 + 0.26 * Math.abs(nx * light[0] + ny * light[1] + nz * light[2]);
    const base = faceFill(S.mesh.faceOf[t] ?? 0);
    const shade = Math.min(Math.max(side * lambert, 0), 1.2);
    faces.push([depth, pa, pb, pc, [base[0] * shade, base[1] * shade, base[2] * shade, 1]]);
  }
  faces.sort((x, y) => y[0] - x[0]);
  for (const f of faces) tri(tris, f[1], f[2], f[3], f[4]);

  // The planar creases on the folded sheet.
  const hot = S.hoveredEdges ? new Set(S.hoveredEdges) : null;
  const drawEdge = (i, boost) => {
    const [ia, ib] = S.planar.edges[i];
    const pa = S.orbit.project(N[3 * ia], N[3 * ia + 1], N[3 * ia + 2], m, r);
    const pb = S.orbit.project(N[3 * ib], N[3 * ib + 1], N[3 * ib + 2], m, r);
    if (!pa || !pb) return;
    let color, w;
    switch (S.planar.assignment[i]) {
      case Assignment.Mountain: color = th.mountain; w = 2.2; break;
      case Assignment.Valley: color = th.valley; w = 2.2; break;
      case Assignment.Border: color = th.border; w = 2.6; break;
      default: color = theme.dim(th.aux, 0.8); w = 1.4;
    }
    if (boost) { color = S.tool === 'erase' ? th.accent : theme.mix(color, [1, 1, 1, 1], 0.3); w += 2.6; }
    seg(lines, pa, pb, w * lw, color);
  };
  for (let i = 0; i < S.planar.edges.length; i++) drawEdge(i, false);
  if (hot) for (const i of hot) drawEdge(i, true);
  return { rect: geom3d.rect, tris, lines, over: [] };
}

// Measure the panes, build both draw lists, and submit one GPU frame.
export function render() {
  measure();
  const p2 = draw2d(), p3 = draw3d();
  // The screensaver fade: a veil of the canvas colour over both panes.
  if (S.veil > 0) {
    const c = [th.canvas[0], th.canvas[1], th.canvas[2], Math.min(1, S.veil)];
    for (const p of [p2, p3]) { const r = p.rect; tri(p.over, [r[0], r[1]], [r[2], r[1]], [r[2], r[3]], c); tri(p.over, [r[0], r[1]], [r[2], r[3]], [r[0], r[3]], c); }
  }
  gpu.frame(th.canvas, [p2, p3]);
}
