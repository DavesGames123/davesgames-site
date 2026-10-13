// ============================================================================
//  BREADBOARD LAB  ·  core/space.js — bench space and hole maths (pure)
// ----------------------------------------------------------------------------
//  This module puts CONTRACT 3.1 and 3.2 into code for the view and the store.
//  It has no THREE and no DOM, so node and the worker can import it.
//  parts/geometry.js (PARTS) owns the same rules for the netlist. The view
//  uses this copy for picking and snapping, so that the view works before
//  PARTS delivers and in the node tests. The two must agree: the SCENE tests
//  check this file against the numbers in CONTRACT 3.2.
//
//  Space: +Y up, the mat is y = 0, millimetres. One grid unit G = 2.54 mm.
//  A quarter turn (rot + 1) maps local (x, z) to (-z, x): clockwise in the
//  top view. Board-local origin = board centre, top surface y = 8.5.
//
//  GREP MAP
//    BOARD_TYPES / RAIL_Z ...... board sizes, columns, rail rows
//    colX / rowZ / railX ....... hole coordinates of one axis
//    parseLocal / parseHoleId .. hole id syntax and range checks
//    holeLocal / holeList ...... every hole of a board type
//    stripOf / strips .......... strip connectivity (a-e, f-j, rails, split)
//    rotXZ / boardToWorld ...... frames: board-local <-> world
//    localNearest / nearestHole  O(1) hole lookup near a point
//    boardRect / boardHit ...... world footprint of a board
//    evalExpr / pinLocal ....... '$span-1' pin coordinates
//    partFrame / partPinsWorld . where the pins of a placed part are
// ============================================================================

export const G = 2.54;
export const BOARD_H = 8.5;
export const ROWS = 'abcdefghij';
export const RAIL_Z = { TN: -22.86, TP: -20.32, BP: 20.32, BN: 22.86 };
export const RAIL_NAMES = ['TP', 'TN', 'BP', 'BN'];

export const BOARD_TYPES = {
  bb830: { cols: 63, railHoles: 50, size: [165.1, 54.6, 8.5], label: 'Full 830' },
  bb400: { cols: 30, railHoles: 25, size: [82.6, 54.6, 8.5], label: 'Half 400' },
  bb170: { cols: 17, railHoles: 0, size: [45.7, 34.5, 8.5], label: 'Mini 170' },
};

const r2 = v => Math.round(v * 1e6) / 1e6;     // trims float dust (-0, 1e-15)

export function colX(cols, c) { return r2((c - (cols + 1) / 2) * G); }
export function rowZ(ri) { return ri <= 4 ? r2(-3.81 - (4 - ri) * G) : r2(3.81 + (ri - 5) * G); }
const railU = k => (k - 1) + Math.floor((k - 1) / 5);
export function railX(n, k) { return r2((railU(k) - railU(n) / 2) * G); }

// ── ids ────────────────────────────────────────────────────────────────────
const TERM_RE = /^([a-j])([1-9][0-9]?)$/;
const RAIL_RE = /^(TP|TN|BP|BN)([1-9][0-9]?)$/;

export function parseLocal(type, local) {
  const bt = BOARD_TYPES[type];
  if (!bt || typeof local !== 'string') return null;
  let m = TERM_RE.exec(local);
  if (m) {
    const col = +m[2];
    if (col < 1 || col > bt.cols) return null;
    return { kind: 'term', row: m[1], ri: ROWS.indexOf(m[1]), col };
  }
  m = RAIL_RE.exec(local);
  if (m) {
    const k = +m[2];
    if (!bt.railHoles || k < 1 || k > bt.railHoles) return null;
    return { kind: 'rail', rail: m[1], k };
  }
  return null;
}

export function parseHoleId(id) {
  if (typeof id !== 'string') return null;
  const i = id.indexOf(':');
  if (i <= 0) return null;
  return { board: id.slice(0, i), local: id.slice(i + 1) };
}

export function holeLocal(type, local) {
  const p = parseLocal(type, local);
  if (!p) return null;
  const bt = BOARD_TYPES[type];
  if (p.kind === 'term') return { x: colX(bt.cols, p.col), z: rowZ(p.ri) };
  return { x: railX(bt.railHoles, p.k), z: RAIL_Z[p.rail] };
}

const listCache = new Map();
export function holeList(type) {
  if (listCache.has(type)) return listCache.get(type);
  const bt = BOARD_TYPES[type];
  if (!bt) return [];
  const out = [];
  for (const rail of ['TN', 'TP']) for (let k = 1; k <= bt.railHoles; k++) out.push(rail + k);
  for (const row of ROWS) for (let c = 1; c <= bt.cols; c++) out.push(row + c);
  for (const rail of ['BP', 'BN']) for (let k = 1; k <= bt.railHoles; k++) out.push(rail + k);
  listCache.set(type, out);
  return out;
}

export function stripOf(type, local, params) {
  const p = parseLocal(type, local);
  if (!p) return null;
  if (p.kind === 'term') return p.col + (p.ri <= 4 ? 'T' : 'B');
  if (type === 'bb830' && params && params.splitRails) return p.rail + (p.k <= 25 ? '.1' : '.2');
  return p.rail;
}

export function strips(type, params) {
  const out = {};
  for (const local of holeList(type)) {
    const s = stripOf(type, local, params);
    (out[s] || (out[s] = [])).push(local);
  }
  return out;
}

// ── frames ─────────────────────────────────────────────────────────────────
export function normRot(rot) { const r = Math.round(+rot || 0) % 4; return r < 0 ? r + 4 : r; }

export function rotXZ(x, z, rot) {
  switch (normRot(rot)) {
    case 1: return [-z, x];
    case 2: return [-x, -z];
    case 3: return [z, -x];
    default: return [x, z];
  }
}

export function boardToWorld(board, x, z) {
  const [rx, rz] = rotXZ(x, z, board.rot);
  return { x: r2(board.x + rx), y: BOARD_H, z: r2(board.z + rz) };
}

export function worldToBoard(board, x, z) {
  const [lx, lz] = rotXZ(x - board.x, z - board.z, 4 - normRot(board.rot));
  return { x: r2(lx), z: r2(lz) };
}

export function findBoard(doc, id) {
  for (const b of doc.boards || []) if (b.id === id) return b;
  return null;
}

export function holeWorld(doc, holeId) {
  const h = parseHoleId(holeId);
  if (!h) return null;
  const b = findBoard(doc, h.board);
  if (!b) return null;
  const p = holeLocal(b.type, h.local);
  return p ? boardToWorld(b, p.x, p.z) : null;
}

export function validHole(doc, holeId) { return !!holeWorld(doc, holeId); }

// World axis-aligned rectangle of a board.
export function boardRect(board) {
  const bt = BOARD_TYPES[board.type];
  if (!bt) return null;
  const odd = normRot(board.rot) % 2 === 1;
  const w = odd ? bt.size[1] : bt.size[0], d = odd ? bt.size[0] : bt.size[1];
  return { minX: board.x - w / 2, maxX: board.x + w / 2, minZ: board.z - d / 2, maxZ: board.z + d / 2, w, d };
}

// The board whose top face holds the world point (x, z), or null.
export function boardHit(doc, x, z, pad = 0) {
  for (const b of doc.boards || []) {
    const r = boardRect(b);
    if (r && x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad) return b;
  }
  return null;
}

// ── hole lookup ────────────────────────────────────────────────────────────
// Nearest hole of one board type to a board-local point. Checks only the few
// candidate holes around the point, so the cost does not grow with the board.
export function localNearest(type, x, z, maxDist = Infinity) {
  const bt = BOARD_TYPES[type];
  if (!bt) return null;
  let best = null, bestD = maxDist;
  const tryHole = (local, hx, hz) => {
    const d = Math.hypot(x - hx, z - hz);
    if (d <= bestD) { bestD = d; best = local; }
  };
  const c0 = Math.round(x / G + (bt.cols + 1) / 2);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const riTop = clamp(4 - Math.round((-3.81 - z) / G), 0, 4);
  const riBot = clamp(5 + Math.round((z - 3.81) / G), 5, 9);
  for (const r of [riTop, riBot]) {
    for (let dc = -1; dc <= 1; dc++) {
      const c = c0 + dc;
      if (c < 1 || c > bt.cols) continue;
      tryHole(ROWS[r] + c, colX(bt.cols, c), rowZ(r));
    }
  }
  if (bt.railHoles) {
    const n = bt.railHoles;
    const u = x / G + railU(n) / 2;
    const k0 = Math.round(u * 5 / 6) + 1;
    for (const rail of RAIL_NAMES) {
      const rz = RAIL_Z[rail];
      if (Math.abs(rz - z) > bestD) continue;
      for (let k = k0 - 2; k <= k0 + 2; k++) {
        if (k < 1 || k > n) continue;
        tryHole(rail + k, railX(n, k), rz);
      }
    }
  }
  return best ? { local: best, d: bestD } : null;
}

// Nearest hole of any board to a world point. opts.filter(holeId) may veto.
export function nearestHoleInfo(doc, x, z, maxDist = 1.27, opts = {}) {
  let best = null;
  for (const b of doc.boards || []) {
    if (opts.board && b.id !== opts.board) continue;
    const r = boardRect(b);
    if (!r || x < r.minX - maxDist || x > r.maxX + maxDist || z < r.minZ - maxDist || z > r.maxZ + maxDist) continue;
    const l = worldToBoard(b, x, z);
    const hit = localNearest(b.type, l.x, l.z, maxDist);
    if (!hit) continue;
    const hole = b.id + ':' + hit.local;
    if (opts.filter && !opts.filter(hole)) continue;
    if (!best || hit.d < best.d) best = { hole, d: hit.d, board: b.id, local: hit.local };
  }
  return best;
}

export function nearestHole(doc, x, z, maxDist = 1.27, opts) {
  const h = nearestHoleInfo(doc, x, z, maxDist, opts);
  return h ? h.hole : null;
}

// ── part pins ──────────────────────────────────────────────────────────────
// Expression of + - * / ( ) numbers and $param, for pin coordinates such as
// '$span' or '$span-1'. Unknown params read 0. Bad syntax throws.
export function evalExpr(src, params = {}) {
  if (typeof src === 'number') return src;
  const s = String(src);
  let i = 0;
  const ws = () => { while (s[i] === ' ') i++; };
  function prim() {
    ws();
    if (s[i] === '(') { i++; const v = sum(); ws(); if (s[i++] !== ')') throw new Error('missing ) in ' + s); return v; }
    if (s[i] === '-') { i++; return -prim(); }
    if (s[i] === '+') { i++; return prim(); }
    if (s[i] === '$') {
      i++;
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
      if (!m) throw new Error('bad param name in ' + s);
      i += m[0].length;
      const v = +params[m[0]];
      return Number.isFinite(v) ? v : 0;
    }
    const m = /^\d+(\.\d+)?/.exec(s.slice(i));
    if (!m) throw new Error('bad expression ' + s);
    i += m[0].length;
    return +m[0];
  }
  function prod() {
    let v = prim();
    for (;;) { ws(); const c = s[i]; if (c !== '*' && c !== '/') return v; i++; const w = prim(); v = c === '*' ? v * w : v / w; }
  }
  function sum() {
    let v = prod();
    for (;;) { ws(); const c = s[i]; if (c !== '+' && c !== '-') return v; i++; const w = prod(); v = c === '+' ? v + w : v - w; }
  }
  const v = sum();
  ws();
  if (i < s.length) throw new Error('trailing text in ' + s);
  return v;
}

// Instance params with def defaults filled in.
export function fullParams(def, params) {
  const out = {};
  for (const p of (def && def.params) || []) out[p.key] = p.default;
  return Object.assign(out, params || {});
}

export function pinLocal(def, pin, params) {
  const pd = typeof pin === 'object' ? pin : ((def && def.pins) || []).find(p => p.name === pin);
  if (!pd) return null;
  const P = fullParams(def, params);
  return { x: r2(evalExpr(pd.x, P) * G), z: r2(evalExpr(pd.z, P) * G) };
}

// World position and world rotation of pin 1 of a placed part.
export function partFrame(doc, part) {
  const pl = part.place || {};
  if (pl.on) {
    const b = findBoard(doc, pl.on);
    if (b) {
      const w = boardToWorld(b, +pl.x || 0, +pl.z || 0);
      return { x: w.x, y: BOARD_H, z: w.z, rot: normRot((b.rot || 0) + (pl.rot || 0)), board: b };
    }
  }
  return { x: +pl.x || 0, y: 0, z: +pl.z || 0, rot: normRot(pl.rot), board: null };
}

export function partPinsWorld(doc, part, def) {
  const f = partFrame(doc, part);
  const out = [];
  for (const pd of (def && def.pins) || []) {
    const l = pinLocal(def, pd, part.params);
    const [rx, rz] = rotXZ(l.x, l.z, f.rot);
    out.push({ pin: pd.name, x: r2(f.x + rx), y: f.y, z: r2(f.z + rz), socket: !!pd.socket });
  }
  return out;
}
