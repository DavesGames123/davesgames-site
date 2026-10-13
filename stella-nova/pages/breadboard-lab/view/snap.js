// ============================================================================
//  BREADBOARD LAB  ·  view/snap.js — where a dragged thing lands (pure)
// ----------------------------------------------------------------------------
//  A dragged part snaps pin 1 to a hole within 2 mm (CONTRACT 4.2). Every
//  other pin then must sit within 0.6 mm of a free hole of any board (the
//  rule of 3.10, so a part may span two boards). The result lists each pin
//  with ok true (green) or false (red). A board-only part off the boards is
//  red everywhere. A free part (mount 'free') never snaps and is always ok.
//
//  A dragged board snaps edge to edge with the other boards within 4 mm,
//  and lines up the flush edge when it is close.
//
//  No THREE and no DOM: the node tests run every function here.
//
//  GREP MAP
//    SNAP_MM / PIN_MM .......... the two distances of the rules
//    occupiedHoles ............. holes that other parts' pins fill
//    snapPart .................. pin-1 snap, pin check, the place to store
//    shiftPlace ................ move other selected parts by the same delta
//    snapBoard ................. edge-to-edge board snap
//    snapWirePoint ............. a free wire bend point on the 0.1" grid
// ============================================================================
import {
  BOARD_H, G, boardRect, boardToWorld, findBoard, holeWorld, nearestHole, nearestHoleInfo,
  normRot, partPinsWorld, pinLocal, rotXZ, worldToBoard,
} from '../core/space.js';
import { lookupDef } from '../core/doc.js';

export const SNAP_MM = 2;
export const PIN_MM = 0.6;
export const BOARD_SNAP_MM = 4;

// Map holeId → partId for every board-plugged pin, without the parts in
// `exclude` (the parts that move).
export function occupiedHoles(doc, registry, exclude = new Set()) {
  const out = new Map();
  for (const part of doc.parts || []) {
    if (exclude.has(part.id)) continue;
    const def = lookupDef(doc, registry, part.def);
    if (!def || def.mount === 'free') continue;
    for (const p of partPinsWorld(doc, part, def)) {
      const h = nearestHole(doc, p.x, p.z, PIN_MM);
      if (h && !out.has(h)) out.set(h, part.id);
    }
  }
  return out;
}

// x, z: where the pointer puts pin 1 (world mm). rot: world quarter turns.
export function snapPart(doc, def, params, o = {}) {
  const mount = (def && def.mount) || 'board';
  const rot = normRot(o.rot);
  const occupied = o.occupied || new Map();
  let x = o.x, z = o.z, board = null, snapped = false;
  if (mount !== 'free') {
    const h = nearestHoleInfo(doc, x, z, o.snap ?? SNAP_MM);
    if (h) {
      const w = holeWorld(doc, h.hole);
      x = w.x; z = w.z;
      board = findBoard(doc, h.board);
      snapped = true;
    }
  }
  const pins = [];
  for (const pd of (def && def.pins) || []) {
    const l = pinLocal(def, pd, params);
    const [rx, rz] = rotXZ(l.x, l.z, rot);
    const px = x + rx, pz = z + rz;
    let hole = null, ok = true;
    if (mount !== 'free' && (snapped || mount === 'board')) {
      hole = nearestHole(doc, px, pz, PIN_MM);
      ok = !!hole && !occupied.has(hole);
    }
    pins.push({ pin: pd.name, x: px, y: board ? BOARD_H : 0, z: pz, hole, ok });
  }
  const ok = pins.every(p => p.ok) && (mount !== 'board' || snapped);
  const place = board
    ? { on: board.id, ...worldToBoard(board, x, z), rot: normRot(rot - (board.rot || 0)) }
    : { on: null, x, z, rot };
  return { ok, snapped, board: board ? board.id : null, x, z, y: board ? BOARD_H : 0, rot, place, pins };
}

// The new place of a part that moves by (dx, dz) world mm with the leader.
// Parts on a board stay on a board when the shifted pin 1 lands on a hole.
export function shiftPlace(doc, part, def, dx, dz, o = {}) {
  const pl = part.place || {};
  let wx, wz, wrot;
  if (pl.on) {
    const b = findBoard(doc, pl.on);
    if (!b) return { ...pl };
    const w = boardToWorld(b, pl.x, pl.z);
    wx = w.x; wz = w.z; wrot = normRot((b.rot || 0) + (pl.rot || 0));
  } else { wx = pl.x; wz = pl.z; wrot = normRot(pl.rot); }
  return snapPart(doc, def, part.params, { x: wx + dx, z: wz + dz, rot: wrot, occupied: o.occupied, snap: 0.3 });
}

// Edge-to-edge snap of a board at (x, z, rot) against every other board.
export function snapBoard(doc, boardId, x, z, rot, dist = BOARD_SNAP_MM) {
  const me = (doc.boards || []).find(b => b.id === boardId);
  if (!me) return { x, z, snapped: false };
  const r = boardRect({ ...me, x, z, rot });
  let bestX = null, bestZ = null;
  const take = (cur, shift) => (cur === null || Math.abs(shift) < Math.abs(cur) ? shift : cur);
  for (const o of doc.boards) {
    if (o.id === boardId) continue;
    const q = boardRect(o);
    if (!q) continue;
    const zOverlap = r.minZ < q.maxZ + dist && r.maxZ > q.minZ - dist;
    const xOverlap = r.minX < q.maxX + dist && r.maxX > q.minX - dist;
    if (zOverlap) {
      if (Math.abs(r.minX - q.maxX) < dist) bestX = take(bestX, q.maxX - r.minX);
      if (Math.abs(r.maxX - q.minX) < dist) bestX = take(bestX, q.minX - r.maxX);
    }
    if (xOverlap) {
      if (Math.abs(r.minZ - q.maxZ) < dist) bestZ = take(bestZ, q.maxZ - r.minZ);
      if (Math.abs(r.maxZ - q.minZ) < dist) bestZ = take(bestZ, q.minZ - r.maxZ);
    }
    // Flush alignment along the touching edge.
    if (zOverlap && bestX !== null && bestZ === null) {
      if (Math.abs(r.minZ - q.minZ) < dist) bestZ = take(bestZ, q.minZ - r.minZ);
      else if (Math.abs(r.maxZ - q.maxZ) < dist) bestZ = take(bestZ, q.maxZ - r.maxZ);
    }
    if (xOverlap && bestZ !== null && bestX === null) {
      if (Math.abs(r.minX - q.minX) < dist) bestX = take(bestX, q.minX - r.minX);
      else if (Math.abs(r.maxX - q.maxX) < dist) bestX = take(bestX, q.maxX - r.maxX);
    }
  }
  const nx = x + (bestX || 0), nz = z + (bestZ || 0);
  return { x: Math.round(nx * 1e4) / 1e4, z: Math.round(nz * 1e4) / 1e4, snapped: bestX !== null || bestZ !== null };
}

// Bend points of a free wire sit on the 0.1 inch grid of the world, at a
// height above the boards.
export function snapWirePoint(x, z, y = BOARD_H + 6) {
  return [Math.round(x / G) * G, y, Math.round(z / G) * G].map(v => Math.round(v * 1e4) / 1e4);
}
