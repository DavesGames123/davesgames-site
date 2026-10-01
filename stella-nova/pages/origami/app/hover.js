// app/hover.js -- what is under the pointer (app.rs update_hover, plus creases and vertices).
//
// In the diagram: the planar face, the nearest crease (with ERASE, the crease a
// click removes), and the nearest checked vertex. In the fold: the nearest
// projected face and crease edge. The result goes into S.hovered* and the
// status line.
//
// grep map:
//   updateHover -- the face, crease, edges and vertex under S.cursor
//   KIND_NAME   -- a crease kind letter to its status word
//   statusHover -- the status line for the hover

import { Assignment } from '../model.js';
import { snap } from '../view.js';
import { pointInPoly, pointInTri2, pointSegDist, findIndex } from './geom.js';
import { COARSE, S } from './state.js';
import { dpr, geom2d, view2d, region3d, phys, paneAt, snapPx } from './layout.js';
import { eraseTarget, planarEdgesOf, creaseOfPlanar } from './edit.js';
import { defaultStatus, setStatus } from './readouts.js';

export function updateHover() {
  S.hoveredFace = null; S.hoveredCrease = null; S.hoveredEdges = null; S.hoveredVertex = null;
  if (!S.cursor || S.libraryOpen || !geom2d) return;
  const pane = paneAt(S.cursor);
  const p = phys(S.cursor);
  if (pane === '2d') {
    const v = view2d();
    const world = v.toWorld(p);
    S.hoveredFace = findIndex(S.planar.faces, (face) => pointInPoly(world, face.map((i) => S.planar.vertices[i])));
    if (S.tool === 'erase') {
      S.hoveredCrease = eraseTarget(snap(world, S.pattern, S.gridN, v, snapPx()));
    } else {
      let best = null, bestD = (COARSE ? 12 : 6) * dpr / v.scale;
      for (let i = 0; i < S.pattern.edges.length; i++) {
        const [a, b] = S.pattern.segment(i);
        const d = pointSegDist(world, a, b);
        if (d < bestD) { bestD = d; best = i; }
      }
      S.hoveredCrease = best;
    }
    let bv = null, bd = 10 * dpr / v.scale;
    for (const r of S.report) {
      const d = Math.hypot(S.planar.vertices[r.vertex][0] - world[0], S.planar.vertices[r.vertex][1] - world[1]);
      if (d < bd) { bd = d; bv = r; }
    }
    S.hoveredVertex = bv;
    if (S.hoveredCrease !== null) S.hoveredEdges = planarEdgesOf(S.hoveredCrease);
  } else if (pane === '3d') {
    const r = region3d();
    const m = S.orbit.matrix((r[2] - r[0]) / Math.max(r[3] - r[1], 1));
    const eye = S.orbit.eye();
    const N = S.mesh.nodes;
    const pr = (i) => S.orbit.project(N[3 * i], N[3 * i + 1], N[3 * i + 2], m, r);
    let bestDepth = Infinity, hit = null;
    S.mesh.tris.forEach((t, ti) => {
      const q = t.v.map(pr);
      if (q.some((x) => !x)) return;
      if (pointInTri2(p, q[0], q[1], q[2])) {
        const g = [0, 1, 2].map((k) => (N[3 * t.v[0] + k] + N[3 * t.v[1] + k] + N[3 * t.v[2] + k]) / 3);
        const depth = Math.hypot(eye[0] - g[0], eye[1] - g[1], eye[2] - g[2]);
        if (depth < bestDepth) { bestDepth = depth; hit = S.mesh.faceOf[ti] ?? null; }
      }
    });
    S.hoveredFace = hit;
    // The nearest projected crease edge within a few pixels (web addition).
    let be = null, bd = (COARSE ? 12 : 6) * dpr;
    S.planar.edges.forEach((e, i) => {
      if (S.planar.assignment[i] === Assignment.Border && S.tool === 'erase') return;
      const a = pr(e[0]), b = pr(e[1]);
      if (!a || !b) return;
      const d = pointSegDist(p, a, b);
      if (d < bd) { bd = d; be = i; }
    });
    if (be !== null) {
      S.hoveredCrease = creaseOfPlanar(be);
      S.hoveredEdges = S.hoveredCrease !== null ? planarEdgesOf(S.hoveredCrease) : [be];
    }
  }
  statusHover();
}

const KIND_NAME = { M: 'mountain', V: 'valley', B: 'border', F: 'aux', U: 'unassigned' };
function statusHover() {
  const parts = [];
  if (S.hoveredVertex) {
    const r = S.hoveredVertex;
    const mk = (ok) => (ok ? '✓' : '✕');
    parts.push(`vertex ${r.vertex} · degree ${r.degree} · Kawasaki ${r.kawasakiResidual.toFixed(2)}° ${mk(r.kawasakiOk)}` +
      ` · Maekawa ${r.maekawa === null ? 'undecided' : (r.maekawa > 0 ? '+' : '') + r.maekawa + ' ' + mk(r.maekawaOk)}` +
      ` · BLB ${r.blbOk === null ? 'undecided' : mk(r.blbOk)}`);
  }
  if (S.hoveredCrease !== null) {
    const k = S.pattern.assignment[S.hoveredCrease];
    parts.push(`crease ${S.hoveredCrease} · ${KIND_NAME[k]}${S.tool === 'erase' && k !== Assignment.Border ? ' · click to erase' : ''}`);
  }
  if (S.hoveredFace !== null) parts.push(`face ${S.hoveredFace}`);
  setStatus(parts.length ? parts.join('   ') : defaultStatus());
}
