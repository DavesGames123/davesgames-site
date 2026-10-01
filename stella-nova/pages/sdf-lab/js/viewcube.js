// ============================================================================
//  SDF FORGE  ·  viewcube.js — which way the camera looks, and a click that
//  turns it somewhere else
// ----------------------------------------------------------------------------
//  PURE. It reads the camera basis and pointer pixels and returns faces to
//  draw and a direction to snap to (Forge viewcube/mod.rs).
//
//  THE PROJECTION IS BUILT FROM THE ORIENTATION ALONE. It never reads the eye
//  or the distance, so the cube does not swim as the user dollies.
//  THE SCALE IS FIXED FOR EVERY ORIENTATION: the divisor is the largest
//  half-extent any orientation projects (the root of three), so the cube
//  never breathes as it turns.
//  BACK FACES ARE CULLED by the normal and the rest are drawn back to front.
//  EACH FACE IS A THREE BY THREE GRID: the centre cell is the face, a side
//  cell the edge, a corner cell the corner, and the most specific wins, so
//  the 20 edge and corner views can be clicked.
//
//  GREP MAP
//    FACES ...... normal, in-face axes and label of each face
//    layout ..... projected faces for a box and a camera basis
//    pick ....... the direction under a pointer (face, edge or corner)
// ============================================================================
import * as V from './math.js';

export const FIT = 0.96, BAND = 0.6;
export const FACES = [
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], label: 'TOP' },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], label: 'BOTTOM' },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], label: 'FRONT' },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], label: 'BACK' },
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], label: 'RIGHT' },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], label: 'LEFT' },
];
const LIGHT = V.norm([0.30, 0.88, 0.37]);

export function layout(box, B) {
  const s = box.size * 0.5 * FIT / Math.sqrt(3);
  const cx = box.x + box.size / 2, cy = box.y + box.size / 2;
  const P = v => [cx + V.dot(v, B.right) * s, cy - V.dot(v, B.up) * s];
  const out = [];
  for (const f of FACES) {
    const facing = V.dot(f.n, B.fwd);
    if (facing > -1e-3) continue;
    const c = f.n;
    const corner = (a, b) => P(V.add(c, V.add(V.scale(f.u, a), V.scale(f.v, b))));
    out.push({
      ...f, depth: facing, shade: 0.5 + 0.5 * V.dot(f.n, LIGHT),
      quad: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)],
      o: P(c), eu: V.sub(P(f.u), P([0, 0, 0])), ev: V.sub(P(f.v), P([0, 0, 0])),
    });
  }
  out.sort((a, b) => b.depth - a.depth);
  return { faces: out, cx, cy, s };
}

// Face-local coordinates of a pixel: solve o + eu a + ev b = p.
function local(f, x, y) {
  const [ux, uy] = f.eu, [vx, vy] = f.ev, det = ux * vy - uy * vx;
  if (Math.abs(det) < 1e-6) return null;
  const px = x - f.o[0], py = y - f.o[1];
  return [(px * vy - py * vx) / det, (ux * py - uy * px) / det];
}
// { dir, rank, face } or null. dir points from the target to the eye.
export function pick(L, x, y) {
  let best = null;
  for (const f of L.faces) {
    const q = local(f, x, y);
    if (!q || Math.abs(q[0]) > 1 || Math.abs(q[1]) > 1) continue;
    const cu = q[0] < -BAND ? -1 : q[0] > BAND ? 1 : 0, cv = q[1] < -BAND ? -1 : q[1] > BAND ? 1 : 0;
    const dir = V.add(f.n, V.add(V.scale(f.u, cu), V.scale(f.v, cv)));
    const rank = Math.abs(cu) + Math.abs(cv);
    if (!best || rank > best.rank || (rank === best.rank && f.depth < best.face.depth)) best = { dir, rank, face: f, cell: [cu, cv] };
  }
  return best;
}
