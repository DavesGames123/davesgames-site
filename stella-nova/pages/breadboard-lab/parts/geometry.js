// ============================================================================
//  BREADBOARD LAB  ·  parts/geometry.js — boards, holes, strips and pins
// ----------------------------------------------------------------------------
//  Pure geometry in millimetres (CONTRACT 3.1, 3.2, 3.10). Node, the worker
//  and the view all use it. One grid unit G = 2.54 mm.
//
//  BOARD FRAME. Origin at the board centre, y = 0 at the base, the top at
//  y = H = 8.5. Column 1 is at -X. Rows a..e are at -Z, f..j at +Z, and the
//  0.3 inch channel between e and f is where a DIP straddles.
//
//  ROTATION. rot is in quarter turns clockwise in the top view: one step maps
//  (x, z) to (-z, x). A part on a board turns by board.rot + part.rot.
//
//  A PIN PLUGS INTO THE NEAREST HOLE OF ANY BOARD within 0.6 mm. So a part
//  can span two boards that sit side by side (the ESP32 over two boards).
//  A free part (bench supply, Uno-style board) plugs into nothing: wires go
//  to its socket pins.
//
//  GREP MAP
//    BOARD_TYPES / BOARD_H .. the three board types (3.2)
//    holeLocal / parseLocal . a local hole id -> board-local mm
//    holeList / holeTable ... every hole of a type (cached)
//    stripOf / strips ....... connectivity (columns T/B, rails, split rails)
//    rotXZ / boardToWorld / worldToBoard ... frames
//    holeWorld / parseHole .. a full hole id 'b1:a12' -> world mm
//    pinLocal / partPinsWorld ... pin grid -> mm -> world
//    nearestHole ............ the snap search over every board
//    resolvePins ............ pin -> hole for the whole document
//    defOfPart .............. registry, else doc.customParts
//    partFootprint .......... holes under a part body (covered-hole check)
// ============================================================================
import { G, pinGrid } from './schema.js';

export { G };
export const BOARD_H = 8.5;
export const ROWS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
export const RAILS = ['TN', 'TP', 'BP', 'BN'];
const RAIL_Z = { TN: -22.86, TP: -20.32, BP: 20.32, BN: 22.86 };
export const PIN_SNAP = 0.6;

export const BOARD_TYPES = {
  bb830: { cols: 63, railHoles: 50, rails: RAILS, size: [165.1, 54.6, 8.5], name: 'Full 830' },
  bb400: { cols: 30, railHoles: 25, rails: RAILS, size: [82.6, 54.6, 8.5], name: 'Half 400' },
  bb170: { cols: 17, railHoles: 0, rails: [], size: [45.7, 34.5, 8.5], name: 'Mini 170' },
};

const r2 = v => Math.round(v * 1e6) / 1e6;

export function rowZ(ri) {
  return ri < 5 ? -3.81 - (4 - ri) * G : 3.81 + (ri - 5) * G;
}
export function colX(type, c) {
  return (c - (BOARD_TYPES[type].cols + 1) / 2) * G;
}
export function railX(type, k) {
  const n = BOARD_TYPES[type].railHoles;
  return (k - 1 + Math.floor((k - 1) / 5) - (n - 1 + Math.floor((n - 1) / 5)) / 2) * G;
}

// 'a12' -> { kind:'term', row:'a', ri:0, col:12 } ; 'TP7' -> { kind:'rail', rail:'TP', k:7 }
export function parseLocal(type, local) {
  const bt = BOARD_TYPES[type];
  if (!bt || typeof local !== 'string') return null;
  let m = /^([a-j])(\d+)$/.exec(local);
  if (m) {
    const col = +m[2];
    if (col < 1 || col > bt.cols || String(col) !== m[2]) return null;
    return { kind: 'term', row: m[1], ri: ROWS.indexOf(m[1]), col };
  }
  m = /^(TP|TN|BP|BN)(\d+)$/.exec(local);
  if (m && bt.railHoles) {
    const k = +m[2];
    if (k < 1 || k > bt.railHoles || String(k) !== m[2]) return null;
    return { kind: 'rail', rail: m[1], k };
  }
  return null;
}

export function holeLocal(type, local) {
  const h = parseLocal(type, local);
  if (!h) return null;
  if (h.kind === 'term') return { x: r2(colX(type, h.col)), z: r2(rowZ(h.ri)) };
  return { x: r2(railX(type, h.k)), z: RAIL_Z[h.rail] };
}

const TABLE = {};
// [{ id, x, z }] for every hole of a type, cached.
export function holeTable(type) {
  if (TABLE[type]) return TABLE[type];
  const bt = BOARD_TYPES[type];
  if (!bt) return [];
  const out = [];
  for (const rail of ['TN', 'TP']) for (let k = 1; k <= bt.railHoles; k++) out.push(rail + k);
  for (const row of ROWS) for (let c = 1; c <= bt.cols; c++) out.push(row + c);
  for (const rail of ['BP', 'BN']) for (let k = 1; k <= bt.railHoles; k++) out.push(rail + k);
  return (TABLE[type] = Object.freeze(out.map(id => Object.freeze({ id, ...holeLocal(type, id) }))));
}
export function holeList(type) { return holeTable(type).map(h => h.id); }

// ---------------------------------------------------------------- strips
export function stripOf(type, local, params) {
  const h = parseLocal(type, local);
  if (!h) return null;
  if (h.kind === 'term') return h.col + (h.ri < 5 ? 'T' : 'B');
  if (type === 'bb830' && params && params.splitRails) {
    return h.rail + (h.k <= BOARD_TYPES[type].railHoles / 2 ? '.1' : '.2');
  }
  return h.rail;
}
export function strips(type, params) {
  const o = {};
  for (const id of holeList(type)) {
    const s = stripOf(type, id, params);
    (o[s] || (o[s] = [])).push(id);
  }
  return o;
}

// ---------------------------------------------------------------- frames
export function rotXZ(x, z, rot) {
  const r = ((rot | 0) % 4 + 4) % 4;
  if (r === 0) return { x, z };
  if (r === 1) return { x: -z, z: x };
  if (r === 2) return { x: -x, z: -z };
  return { x: z, z: -x };
}
export function boardToWorld(board, x, z) {
  const p = rotXZ(x, z, board.rot || 0);
  return { x: r2(p.x + (board.x || 0)), y: BOARD_H, z: r2(p.z + (board.z || 0)) };
}
export function worldToBoard(board, x, z) {
  const p = rotXZ(x - (board.x || 0), z - (board.z || 0), -(board.rot || 0));
  return { x: r2(p.x), z: r2(p.z) };
}

export function parseHole(holeId) {
  if (typeof holeId !== 'string') return null;
  const i = holeId.indexOf(':');
  if (i < 1) return null;
  return { board: holeId.slice(0, i), local: holeId.slice(i + 1) };
}
const boardById = (doc, id) => (doc.boards || []).find(b => b.id === id) || null;

export function holeWorld(doc, holeId) {
  const h = parseHole(holeId);
  if (!h) return null;
  const b = boardById(doc, h.board);
  if (!b) return null;
  const l = holeLocal(b.type, h.local);
  return l ? boardToWorld(b, l.x, l.z) : null;
}

// ---------------------------------------------------------------- pins
export function pinLocal(def, pin, params) {
  const g = pinGrid(def, pin, params);
  return { x: r2(g.x * G), z: r2(g.z * G) };
}

// Where the part frame sits: { board|null, x, z, rot } in that board's frame
// (or the world). A part whose board is gone falls back to the world frame.
function partFrame(doc, part) {
  const pl = part.place || {};
  const b = pl.on ? boardById(doc, pl.on) : null;
  return { board: b, x: pl.x || 0, z: pl.z || 0, rot: pl.rot || 0 };
}
// Part-local mm (pin 1 at 0,0, rot 0) -> world { x, z }.
export function partToWorld(doc, part, lx, lz) {
  const f = partFrame(doc, part);
  const p = rotXZ(lx, lz, f.rot);
  if (f.board) { const w = boardToWorld(f.board, p.x + f.x, p.z + f.z); return { x: w.x, z: w.z }; }
  return { x: r2(p.x + f.x), z: r2(p.z + f.z) };
}
export function worldToPart(doc, part, wx, wz) {
  const f = partFrame(doc, part);
  let x = wx, z = wz;
  if (f.board) { const b = worldToBoard(f.board, x, z); x = b.x; z = b.z; }
  const p = rotXZ(x - f.x, z - f.z, -f.rot);
  return { x: r2(p.x), z: r2(p.z) };
}

export function partPinsWorld(doc, part, def) {
  const f = partFrame(doc, part);
  const out = [];
  for (const pin of def.pins || []) {
    const l = pinLocal(def, pin, part.params);
    const w = partToWorld(doc, part, l.x, l.z);
    const y = f.board ? BOARD_H : (pin.y || 0);
    out.push({ pin: pin.name, x: w.x, y, z: w.z });
  }
  return out;
}

// ---------------------------------------------------------------- search
export function nearestHole(doc, x, z, maxDist = 1.27, opts = {}) {
  let best = null, bd = maxDist * maxDist + 1e-9;
  for (const b of doc.boards || []) {
    if (opts.boards && !opts.boards.includes(b.id)) continue;
    const bt = BOARD_TYPES[b.type];
    if (!bt) continue;
    const l = worldToBoard(b, x, z);
    const hw = bt.size[0] / 2 + maxDist, hd = bt.size[1] / 2 + maxDist;
    if (Math.abs(l.x) > hw || Math.abs(l.z) > hd) continue;
    for (const h of holeTable(b.type)) {
      const dx = h.x - l.x, dz = h.z - l.z, d = dx * dx + dz * dz;
      if (d < bd) {
        const id = b.id + ':' + h.id;
        if (opts.exclude && opts.exclude.has(id)) continue;
        bd = d; best = id;
      }
    }
  }
  return best;
}

export function isBoardMounted(part, def) {
  return !!(part.place && part.place.on) && def.mount !== 'free';
}

// The def of a part: the registry, else the document's own custom parts
// (as sim/netlist.js and core/doc.js lookupDef do). Only the part editor's
// Save adds a custom def to the registry, so a document from a link, the
// autosave or a file has its custom defs only in doc.customParts.
function defOfPart(doc, registry, id) {
  const d = registry && registry.get ? registry.get(id) : null;
  return d || (doc.customParts || []).find(c => c && c.id === id) || null;
}

export function resolvePins(doc, registry) {
  const pinHole = {};
  const covered = new Set();
  const byHole = new Map();
  for (const part of doc.parts || []) {
    const def = defOfPart(doc, registry, part.def);
    if (!def) continue;
    const mounted = isBoardMounted(part, def);
    for (const p of partPinsWorld(doc, part, def)) {
      const key = part.id + '.' + p.pin;
      const hole = mounted ? nearestHole(doc, p.x, p.z, PIN_SNAP) : null;
      pinHole[key] = hole;
      if (hole) { if (!byHole.has(hole)) byHole.set(hole, []); byHole.get(hole).push(key); }
    }
  }
  for (const part of doc.parts || []) {
    const def = defOfPart(doc, registry, part.def);
    if (!def || !isBoardMounted(part, def)) continue;
    for (const h of partFootprint(doc, part, def).holes) covered.add(h);
  }
  const overlaps = [];
  for (const [hole, pins] of byHole) if (pins.length > 1) overlaps.push({ hole, pins });
  return { pinHole, covered, overlaps };
}

// Holes the body covers: def.footprint is a rect in grid units around pin 1
// at rot 0. The part's own pin holes do not count. Parts with no footprint
// (axial leads, wires) cover nothing.
export function partFootprint(doc, part, def) {
  const holes = new Set();
  const corners = [];
  const fp = def.footprint;
  if (fp) {
    for (const [gx, gz] of [[fp.x0, fp.z0], [fp.x1, fp.z0], [fp.x1, fp.z1], [fp.x0, fp.z1]]) corners.push(partToWorld(doc, part, gx * G, gz * G));
  } else {
    for (const p of partPinsWorld(doc, part, def)) corners.push({ x: p.x, z: p.z });
  }
  if (!corners.length) { const w = partToWorld(doc, part, 0, 0); corners.push(w); }
  const pad = fp ? 0 : 1;
  const bbox = {
    min: [Math.min(...corners.map(c => c.x)) - pad, Math.min(...corners.map(c => c.z)) - pad],
    max: [Math.max(...corners.map(c => c.x)) + pad, Math.max(...corners.map(c => c.z)) + pad],
  };
  if (!fp || !isBoardMounted(part, def)) return { holes, bbox };
  const own = new Set();
  for (const p of partPinsWorld(doc, part, def)) { const h = nearestHole(doc, p.x, p.z, PIN_SNAP); if (h) own.add(h); }
  const eps = 0.05;
  for (const b of doc.boards || []) {
    for (const h of holeTable(b.type)) {
      const w = boardToWorld(b, h.x, h.z);
      if (w.x < bbox.min[0] - eps || w.x > bbox.max[0] + eps || w.z < bbox.min[1] - eps || w.z > bbox.max[1] + eps) continue;
      const l = worldToPart(doc, part, w.x, w.z);
      const gx = l.x / G, gz = l.z / G;
      if (gx < fp.x0 - 1e-6 || gx > fp.x1 + 1e-6 || gz < fp.z0 - 1e-6 || gz > fp.z1 + 1e-6) continue;
      const id = b.id + ':' + h.id;
      if (!own.has(id)) holes.add(id);
    }
  }
  return { holes, bbox };
}
