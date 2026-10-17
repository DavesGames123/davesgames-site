// ============================================================================
//  DIAGRAM LAYOUT  ·  TensorExpr -> positioned diagram scene  (DOM-free)
// ----------------------------------------------------------------------------
//  layoutExpr(expr, opts) turns one TensorExpr (CONTRACT.md shape) into a
//  scene: a flat list of keyed items that the renderer draws and the
//  transitions interpolate. Item types:
//      node    a tensor (shape by kind), metric cap or cup, delta line,
//              epsilon bar, scalar circle
//      circle  a derivative ring round a node (dashed for partial, solid
//              for nabla), with its own legs
//      leg     one index slot. Free legs run straight to the row boundary,
//              up for an upper index and down for a lower one. A dummy
//              pair is one wire, kept as two legs that meet at its middle.
//      bar     symmetrisation (wavy) or antisymmetrisation (straight) over
//              legs, with the 1/n! weight
//      text    coefficients, + and - and = signs, bond sizes, einsum string
//
//  Penrose rules (CONTRACT.md "DIAGRAM API"). A contraction joins the upper
//  leg of one node to the lower leg of another. The layout puts the node
//  with the lower slot one level higher, so that the wire is a short S
//  curve. Cycles (a trace of a product) and self contractions route round
//  the side. Nodes take separate columns, so a free leg never runs through
//  a node. The column order is the best of all orders (up to 6 units per
//  term, else a swap search) by crossings, then wire length, then distance
//  from the TeX order.
//
//  The 'network' style uses one row: bonds leave the box sides, adjacent
//  bonds are straight, others arc over or under. Variance does not set
//  the bond side (tensor networks ignore it), free legs still go up or
//  down by variance.
//
//  Keys are stable across steps: term key 'T<side>.<term>', factor key
//  '<name>#<occurrence>', leg key '<term>|<factor>:<slot>'. transition.js
//  matches terms between two scenes and re-keys them.
//
//  EXPORTS   (jump with grep -n "<anchor>" layout.js)
//      STYLES ......... "export const STYLES"
//      METRICS ........ "export const METRICS"     spacing constants
//      kindOf ......... "export function kindOf"   factor kind from name
//      isDerivFactor .. "export function isDerivFactor"
//      sidesOf ........ "export function sidesOf"  equation sides
//      layoutExpr ..... "export function layoutExpr"
//      unitBoxes ...... "export function unitBoxes" node boxes (tests)
// ============================================================================

import { N_PTS, cubicPts, routePts, resample, splitHalf, countCrossings } from './geom.js';
import { symText, nameText, coeffParts, textWidth, einsumOf } from './text.js';
import { fallbackIndexColor } from './colors.js';

export const STYLES = ['penrose', 'birdtrack', 'network'];

export const METRICS = {
  spacing: 26, nodeH: 30, levelGap: 80, legOut: 40, gapX: 30, pieceGap: 14,
  rowGap: 30, margin: 20, ringPad: 9, labelPad: 24, maxPerm: 6,
};

const M = METRICS;

export function isDerivFactor(f) {
  if (!f) return false;
  if (f.kind === 'partial' || f.kind === 'nabla') return true;
  if (f.kind) return false;
  return /^\\?(partial|nabla)$/.test(String(f.name || f.tex || ''));
}

export function kindOf(f) {
  const ix = f.indices || [];
  const n = String(f.name || f.tex || '').replace(/^\\/, '');
  let k = f.kind;
  if (!k) {
    if (n === 'partial') k = 'partial';
    else if (n === 'nabla') k = 'nabla';
    else if (n === 'delta' && ix.length === 2) k = 'delta';
    else if (n === 'epsilon' && ix.length >= 2) k = 'epsilon';
    else if (n === 'Gamma' && ix.length === 3) k = 'christoffel';
    else if (n === 'g' && ix.length === 2) k = ix[0].up && ix[1].up ? 'inverseMetric' : 'metric';
    else if (!ix.length) k = 'scalar';
    else k = 'tensor';
  }
  // A metric with mixed variance is the identity map: draw it as a delta.
  if ((k === 'metric' || k === 'inverseMetric') && ix.length === 2) {
    if (ix[0].up !== ix[1].up) k = 'delta';
    else k = ix[0].up ? 'inverseMetric' : 'metric';
  }
  // A delta with two lower (or two upper) slots is the Euclidean metric.
  if (k === 'delta' && ix.length === 2 && ix[0].up === ix[1].up) k = ix[0].up ? 'inverseMetric' : 'metric';
  return k;
}

function shapeFor(kind, nOwn, name) {
  const n = String(name || '').replace(/^\\/, '');
  switch (kind) {
    case 'metric': return 'cap';
    case 'inverseMetric': return 'cup';
    case 'delta': return 'line';
    case 'epsilon': return 'bar';
    case 'scalar': return 'circle';
    case 'christoffel': return 'trap';
    case 'partial': case 'nabla': return 'none';
    default:
      if (/^(Lambda|J)$/.test(n)) return 'hex';
      if (nOwn <= 1) return 'circle';
      return nOwn === 2 ? 'round' : 'rect';
  }
}

// Equation sides: lhs/rhs, sides[], or terms tagged with .side.
export function sidesOf(expr) {
  if (!expr) return [[]];
  if (expr.lhs && expr.rhs) return [expr.lhs.terms || [], expr.rhs.terms || []];
  if (Array.isArray(expr.sides) && expr.sides.length) return expr.sides.map(s => (Array.isArray(s) ? s : s.terms || []));
  const terms = expr.terms || [];
  if (terms.some(t => t.side !== undefined && t.side !== null)) {
    const order = [], by = new Map();
    for (const t of terms) {
      const s = t.side ?? 0;
      if (!by.has(s)) { by.set(s, []); order.push(s); }
      by.get(s).push(t);
    }
    return order.map(s => by.get(s));
  }
  return [terms];
}

// ---------------------------------------------------------------------------
//  Units: one non-derivative factor plus the derivatives that act on it.
// ---------------------------------------------------------------------------

function buildUnits(term, tkey, net) {
  const facs = term.factors || [];
  const occ = new Map();
  const fkey = f => {
    const n = f.name || f.tex || '?';
    const c = occ.get(n) || 0;
    occ.set(n, c + 1);
    return `${n}#${c}`;
  };
  const units = [];
  let pend = [];
  facs.forEach((f, fi) => {
    const k = fkey(f);
    if (isDerivFactor(f)) { pend.push({ f, fi, k }); return; }
    units.push(makeUnit(tkey, f, fi, k, pend, net));
    pend = [];
  });
  if (pend.length) units.push(makeUnit(tkey, null, -1, null, pend, net));
  units.forEach((u, i) => { u.orig = i; });
  return units;
}

function makeUnit(tkey, f, fi, k, pend, net) {
  const kind = f ? kindOf(f) : 'none';
  const own = f ? (f.indices || []) : [];
  const u = {
    key: `${tkey}|${k || pend[0].k}`, tkey, kind, fi, factor: f,
    label: f ? nameText(f.tex || f.name) : '',
    shape: f ? shapeFor(kind, own.length, f.name) : 'none',
    dashed: kind === 'christoffel',
    layers: [], slots: [], own: [],
  };
  if (u.shape === 'none' && f) u.shape = 'round';
  for (const d of pend) {
    const L = { key: `${tkey}|${d.k}:c`, dkind: kindOf(d.f) === 'partial' ? 'partial' : 'nabla', slots: [] };
    (d.f.indices || []).forEach((ix, j) => L.slots.push(slotOf(tkey, d.k, j, ix, d.fi, 'deriv', u)));
    u.layers.push(L);
  }
  if (f && f.deriv && f.deriv.length) {
    const dk = f.derivKind === 'partial' || f.derivKind === 'comma' ? 'partial' : 'nabla';
    const L = { key: `${tkey}|${k}:dc`, dkind: dk, slots: [] };
    f.deriv.forEach((ix, j) => L.slots.push(slotOf(tkey, k, 'd' + j, ix, fi, 'deriv', u)));
    u.layers.push(L);
  }
  own.forEach((ix, j) => u.own.push(slotOf(tkey, k, j, ix, fi, 'own', u)));
  for (const L of u.layers) u.slots.push(...L.slots);
  u.slots.push(...u.own);
  // Inner node size.
  const lw = textWidth(u.label, 16);
  if (kind === 'delta') { u.ownCols = 1; u.iw = M.spacing; u.ih = 14; }
  else if (kind === 'metric' || kind === 'inverseMetric') { u.ownCols = 2; u.iw = 2 * M.spacing; u.ih = 20; }
  else if (kind === 'epsilon') { u.ownCols = Math.max(own.length, 1); u.iw = u.ownCols * M.spacing; u.ih = 8; }
  else if (kind === 'scalar') { u.ownCols = 0; u.iw = Math.max(30, lw + 14); u.ih = 30; }
  else if (kind === 'none') { u.ownCols = 0; u.iw = 12; u.ih = 12; }
  else {
    u.ownCols = Math.max(own.length, 1);
    u.iw = Math.max(own.length <= 1 ? 30 : 34, u.ownCols * M.spacing, lw + 14);
    u.ih = M.nodeH;
  }
  if (net && kind !== 'scalar') u.shape = 'box';
  u.depth = u.layers.length;
  return u;
}

function slotOf(tkey, fk, j, ix, fi, role, unit) {
  return { key: `${tkey}|${fk}:${j}`, sym: String(ix.sym), up: !!ix.up, fi, j, role, unit };
}

// ---------------------------------------------------------------------------
//  Pairs (dummy indices) inside one term.
// ---------------------------------------------------------------------------

function pairUp(units, warnings, tkey) {
  const bySym = new Map();
  for (const u of units) for (const s of u.slots) {
    if (!bySym.has(s.sym)) bySym.set(s.sym, []);
    bySym.get(s.sym).push(s);
  }
  const pairs = [], free = [];
  for (const [sym, L] of bySym) {
    if (L.length === 1) { free.push(L[0]); continue; }
    if (L.length > 2) warnings.push(`${tkey}: index ${sym} appears ${L.length} times`);
    // Prefer an up/down match first.
    const rest = L.slice();
    while (rest.length >= 2) {
      let a = rest.findIndex(s => s.up), b = rest.findIndex(s => !s.up);
      if (a < 0 || b < 0) { a = 0; b = 1; }
      const sa = rest[a], sb = rest[b];
      rest.splice(Math.max(a, b), 1); rest.splice(Math.min(a, b), 1);
      let type;
      if (sa.up !== sb.up) type = sa.unit === sb.unit ? 'self' : 'dir';
      else type = sa.up ? 'over' : 'under';
      const up = sa.up ? sa : sb, dn = sa.up ? sb : sa;
      pairs.push({ sym, type, a: type === 'dir' || type === 'self' ? up : sa, b: type === 'dir' || type === 'self' ? dn : sb, key: `${tkey}|w:${sym}` });
    }
    if (rest.length) free.push(rest[0]);
  }
  return { pairs, free };
}

// Levels: an upper slot on A joined to a lower slot on B puts B above A.
function assignLevels(units, pairs) {
  const n = units.length, idx = new Map(units.map((u, i) => [u, i]));
  const out = Array.from({ length: n }, () => []);
  for (const p of pairs) if (p.type === 'dir') out[idx.get(p.a.unit)].push({ to: idx.get(p.b.unit), p });
  // DFS to find back edges.
  const state = new Array(n).fill(0);
  const visit = i => {
    state[i] = 1;
    for (const e of out[i]) {
      if (state[e.to] === 1) e.p.type = 'around';
      else if (state[e.to] === 0) visit(e.to);
    }
    state[i] = 2;
  };
  for (let i = 0; i < n; i++) if (!state[i]) visit(i);
  const edges = [];
  for (let i = 0; i < n; i++) for (const e of out[i]) if (e.p.type === 'dir') edges.push([i, e.to]);
  const level = new Array(n).fill(0);
  for (let it = 0; it < n; it++) {
    let moved = false;
    for (const [a, b] of edges) if (level[b] < level[a] + 1) { level[b] = level[a] + 1; moved = true; }
    if (!moved) break;
  }
  // Pull sources up next to their lowest successor.
  for (let it = 0; it < n; it++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      const succ = edges.filter(e => e[0] === i).map(e => level[e[1]]);
      const pred = edges.filter(e => e[1] === i).map(e => level[e[0]]);
      if (succ.length) {
        const want = Math.min(...succ) - 1;
        const lo = pred.length ? Math.max(...pred) + 1 : -Infinity;
        if (want > level[i] && want >= lo) { level[i] = want; moved = true; }
      }
    }
    if (!moved) break;
  }
  const maxL = Math.max(0, ...level);
  const linked = new Set(edges.flat());
  units.forEach((u, i) => {
    u.level = linked.has(i) ? level[i] : Math.round(maxL / 2);
  });
  return maxL;
}

// ---------------------------------------------------------------------------
//  Placement of one unit at (x0, cy).
// ---------------------------------------------------------------------------

function unitWidth(u, net, freeSet) {
  if (net) {
    const freeTop = u.slots.filter(s => freeSet.has(s) && s.up).length;
    const freeBot = u.slots.filter(s => freeSet.has(s) && !s.up).length;
    const cols = Math.max(freeTop, freeBot, 1);
    const inner = u.kind === 'scalar' ? u.iw : Math.max(u.iw, cols * M.spacing, textWidth(u.label, 15) + 18);
    u.netCols = cols;
    u.netIw = inner;
    return inner + 2 * u.depth * M.ringPad;
  }
  let w = u.iw + 2 * u.depth * M.ringPad;
  for (const L of u.layers) w += L.slots.length * M.spacing;
  return w;
}

function sideSlotsOf(u, pairs) {
  // Network style: bonded slots go to the sides.
  const left = [], right = [];
  for (const p of pairs) {
    for (const [s, o] of [[p.a, p.b], [p.b, p.a]]) {
      if (s.unit !== u) continue;
      if (o.unit === u) { right.push({ s, p, rank: 2 }); continue; }
      const side = o.unit.col > u.col ? right : left;
      const span = Math.abs(o.unit.col - u.col);
      side.push({ s, p, o, rank: span === 1 ? 1 : p.arc === 'under' ? 3 : 0, span });
    }
  }
  const sorter = side => side.sort((x, y) => x.rank - y.rank || (x.rank === 0 ? y.span - x.span : x.rank === 3 ? x.span - y.span : 0) || x.p.key.localeCompare(y.p.key));
  return { left: sorter(left), right: sorter(right) };
}

function placeUnit(u, x0, cy, net, freeSet, pairs) {
  u.x0 = x0; u.cy = cy; u.x1 = x0 + u.W;
  const pad = M.ringPad, d = u.depth;
  if (net) {
    const iw = u.netIw;
    const nSide = pairs ? Math.max(0, ...['left', 'right'].map(k => u._sides ? u._sides[k].length : 0)) : 0;
    const ih = Math.max(u.ih, nSide * 11 + 12);
    u.ix0 = x0 + d * pad; u.ix1 = u.ix0 + iw; u.iy0 = cy - ih / 2; u.iy1 = cy + ih / 2;
    u.rings = u.layers.map((L, i) => ({ L, x0: x0 + i * pad, x1: x0 + u.W - i * pad, y0: cy - ih / 2 - (d - i) * pad, y1: cy + ih / 2 + (d - i) * pad }));
    const top = u.slots.filter(s => freeSet.has(s) && s.up), bot = u.slots.filter(s => freeSet.has(s) && !s.up);
    const ycut = (s, up) => {
      // Free legs of derivative slots start on their ring.
      const L = u.layers.find(l => l.slots.includes(s));
      if (L) { const r = u.rings[u.layers.indexOf(L)]; return up ? r.y0 : r.y1; }
      return up ? u.iy0 : u.iy1;
    };
    const place = (arr, up) => arr.forEach((s, i) => {
      s.x = u.ix0 + (iw - arr.length * M.spacing) / 2 + (i + 0.5) * M.spacing;
      s.y = ycut(s, up); s.dir = up ? [0, -1] : [0, 1];
    });
    place(top, true); place(bot, false);
    if (u._sides) {
      for (const side of ['left', 'right']) {
        const arr = u._sides[side];
        arr.forEach((e, i) => {
          const L = u.layers.find(l => l.slots.includes(e.s));
          const xr = L ? u.rings[u.layers.indexOf(L)] : null;
          e.s.x = side === 'left' ? (xr ? xr.x0 : u.ix0) : (xr ? xr.x1 : u.ix1);
          e.s.y = cy + (i - (arr.length - 1) / 2) * 11;
          e.s.dir = side === 'left' ? [-1, 0] : [1, 0];
        });
      }
    }
    u.box = { x0: u.x0, x1: u.x1, y0: Math.min(u.iy0, ...u.rings.map(r => r.y0)), y1: Math.max(u.iy1, ...u.rings.map(r => r.y1)) };
    return;
  }
  // Penrose and birdtrack.
  let x = x0;
  const ringX0 = [];
  for (const L of u.layers) {
    ringX0.push(x);
    x += pad;
    L.slots.forEach((s, i) => { s.x = x + (i + 0.5) * M.spacing; });
    x += L.slots.length * M.spacing;
  }
  u.ix0 = x; u.ix1 = x + u.iw; u.iy0 = cy - u.ih / 2; u.iy1 = cy + u.ih / 2;
  u.rings = u.layers.map((L, i) => ({ L, x0: ringX0[i], x1: x0 + u.W - i * pad, y0: cy - u.ih / 2 - (d - i) * pad - 2, y1: cy + u.ih / 2 + (d - i) * pad + 2 }));
  u.layers.forEach((L, i) => L.slots.forEach(s => { s.y = s.up ? u.rings[i].y0 : u.rings[i].y1; s.dir = s.up ? [0, -1] : [0, 1]; }));
  const n = u.own.length;
  if (u.kind === 'delta') {
    const cx = (u.ix0 + u.ix1) / 2;
    u.own.forEach(s => { s.x = cx; s.y = s.up ? u.iy0 : u.iy1; s.dir = s.up ? [0, -1] : [0, 1]; });
  } else {
    const cols = Math.max(u.ownCols, 1);
    const off = u.ix0 + (u.iw - cols * M.spacing) / 2;
    u.own.forEach((s, j) => {
      const col = u.kind === 'metric' || u.kind === 'inverseMetric' ? j : (n <= cols ? j : j % cols);
      s.x = off + (col + 0.5) * M.spacing;
      s.y = s.up ? u.iy0 : u.iy1;
      if (u.kind === 'metric') s.y = u.iy1;
      if (u.kind === 'inverseMetric') s.y = u.iy0;
      if (u.shape === 'circle' && n === 1) s.x = (u.ix0 + u.ix1) / 2;
      s.dir = s.up ? [0, -1] : [0, 1];
    });
  }
  u.box = { x0: u.x0, x1: u.x1, y0: Math.min(u.iy0, ...u.rings.map(r => r.y0)), y1: Math.max(u.iy1, ...u.rings.map(r => r.y1)) };
}

// ---------------------------------------------------------------------------
//  Wires.
// ---------------------------------------------------------------------------

function wirePts(p, units, net, loopIx) {
  const a = p.a, b = p.b, A = a.unit, B = b.unit;
  const pa = [a.x, a.y], pb = [b.x, b.y];
  if (net) {
    if (A === B) {
      return cubicPts(pa, [pa[0] + 34, pa[1] - 14], [pb[0] + 34, pb[1] + 14], pb);
    }
    const span = Math.abs(A.col - B.col);
    if (span === 1) {
      const dx = Math.abs(pb[0] - pa[0]) * 0.45;
      return cubicPts(pa, [pa[0] + a.dir[0] * dx, pa[1]], [pb[0] + b.dir[0] * dx, pb[1]], pb);
    }
    const lo = p.arc === 'under';
    const ext = lo ? Math.max(A.box.y1, B.box.y1, ...units.filter(u => between(u, A, B)).map(u => u.box.y1))
                   : Math.min(A.box.y0, B.box.y0, ...units.filter(u => between(u, A, B)).map(u => u.box.y0));
    const h = (lo ? 1 : -1) * (20 + 6 * span + 6 * (p.stack || 0));
    const y = ext + h;
    return routePts([pa, [pa[0] + a.dir[0] * 14, pa[1]], [pa[0] + a.dir[0] * 14, y], [pb[0] + b.dir[0] * 14, y], [pb[0] + b.dir[0] * 14, pb[1]], pb], 12);
  }
  if (p.type === 'dir') {
    const k = Math.max(18, (pa[1] - pb[1]) * 0.5);
    return cubicPts(pa, [pa[0], pa[1] - k], [pb[0], pb[1] + k], pb);
  }
  if (p.type === 'under' || p.type === 'over') {
    const s = p.type === 'under' ? 1 : -1;
    const ext = s > 0 ? Math.max(pa[1], pb[1], A.box.y1, B.box.y1) : Math.min(pa[1], pb[1], A.box.y0, B.box.y0);
    const y = ext + s * (22 + 0.16 * Math.abs(pb[0] - pa[0]) + 6 * (loopIx || 0));
    return cubicPts(pa, [pa[0], y], [pb[0], y], pb);
  }
  // self and around: up out of a, round the side, into b from below.
  const k = loopIx || 0;
  let xs;
  const lo = Math.min(A.box.x0, B.box.x0), hi = Math.max(A.box.x1, B.box.x1);
  if (A === B) xs = (a.x + b.x) / 2 >= (A.box.x0 + A.box.x1) / 2 ? hi + 12 + 7 * k : lo - 12 - 7 * k;
  else {
    const right = Math.abs(hi - a.x) + Math.abs(hi - b.x), left = Math.abs(a.x - lo) + Math.abs(b.x - lo);
    xs = right <= left ? hi + 12 + 7 * k : lo - 12 - 7 * k;
  }
  const yt = Math.min(a.y, A.box.y0) - 14 - 6 * k;
  const yb = Math.max(b.y, B.box.y1) + 14 + 6 * k;
  return routePts([pa, [pa[0], yt], [xs, yt], [xs, yb], [pb[0], yb], pb], 11);
}

function between(u, A, B) {
  const lo = Math.min(A.col, B.col), hi = Math.max(A.col, B.col);
  return u.col > lo && u.col < hi;
}

// ---------------------------------------------------------------------------
//  One term: order, place, route.
// ---------------------------------------------------------------------------

function termGeometry(T, order, top, bottom, coarse) {
  const { units, pairs, free, net, levelCy } = T;
  const freeSet = new Set(free);
  order.forEach((u, i) => { u.col = i; });
  if (net) {
    for (const p of pairs) {
      if (p.a.unit === p.b.unit || Math.abs(p.a.unit.col - p.b.unit.col) === 1) { p.arc = null; continue; }
      const lo = Math.min(p.a.unit.col, p.b.unit.col), hi = Math.max(p.a.unit.col, p.b.unit.col);
      let up = 0, dn = 0;
      for (const u of order.slice(lo + 1, hi)) for (const s of u.slots) if (freeSet.has(s)) (s.up ? up++ : dn++);
      p.arc = up > dn ? 'under' : 'over';
    }
    for (const u of order) u._sides = sideSlotsOf(u, pairs);
    // Stack arcs that share an end so they nest.
    const arcs = pairs.filter(p => p.arc).sort((x, y) => Math.abs(x.a.unit.col - x.b.unit.col) - Math.abs(y.a.unit.col - y.b.unit.col));
    arcs.forEach((p, i) => { p.stack = i; });
  }
  let x = 0;
  for (const u of order) {
    u.W = unitWidth(u, net, freeSet);
    placeUnit(u, x, net ? 0 : levelCy(u.level), net, freeSet, pairs);
    x += u.W + M.gapX;
  }
  const width = Math.max(0, x - M.gapX);
  const strands = [], wires = [];
  const loops = new Map();
  for (const p of pairs) {
    let li = 0;
    if (p.type === 'self' || p.type === 'around' || p.type === 'under' || p.type === 'over') {
      const lk = p.type + (p.type === 'self' ? p.a.unit.key : '');
      li = loops.get(lk) || 0; loops.set(lk, li + 1);
    }
    const dense = wirePts(p, units, net, li);
    wires.push({ p, dense });
    strands.push({ id: p.key, pts: resample(dense, coarse ? 14 : 30) });
  }
  const freeLegs = free.map(s => {
    const end = [s.x + (net && s.dir[0] ? s.dir[0] * 30 : 0), s.dir[0] ? s.y : (s.up ? top : bottom)];
    const pts = [[s.x, s.y], end];
    strands.push({ id: s.key, pts: resample(pts, 6) });
    return { s, pts, end };
  });
  const crossings = countCrossings(strands);
  let len = 0;
  for (const w of wires) len += Math.abs(w.p.a.x - w.p.b.x);
  let disp = 0;
  order.forEach((u, i) => { disp += Math.abs(i - u.orig); });
  return { width, wires, freeLegs, crossings, cost: crossings * 1000 + len * 0.06 + disp * 6 };
}

function permutations(arr) {
  if (arr.length <= 1) return [arr.slice()];
  const out = [];
  arr.forEach((x, i) => {
    for (const p of permutations([...arr.slice(0, i), ...arr.slice(i + 1)])) out.push([x, ...p]);
  });
  return out;
}

function chooseOrder(T, top, bottom) {
  const base = T.units.slice();
  if (base.length <= 1 || !T.pairs.length) return base;
  if (base.length <= M.maxPerm) {
    let best = base, bestC = Infinity;
    for (const ord of permutations(base)) {
      const g = termGeometry(T, ord, top, bottom, true);
      if (g.cost < bestC - 1e-9) { bestC = g.cost; best = ord; }
    }
    return best;
  }
  let cur = base.slice(), curC = termGeometry(T, cur, top, bottom, true).cost;
  for (let pass = 0; pass < 6; pass++) {
    let improved = false;
    for (let i = 0; i < cur.length; i++) for (let j = i + 1; j < cur.length; j++) {
      const nx = cur.slice(); [nx[i], nx[j]] = [nx[j], nx[i]];
      const c = termGeometry(T, nx, top, bottom, true).cost;
      if (c < curC - 1e-9) { cur = nx; curC = c; improved = true; }
    }
    if (!improved) break;
  }
  return cur;
}

// ---------------------------------------------------------------------------
//  Whole expression.
// ---------------------------------------------------------------------------

export function layoutExpr(expr, opts = {}) {
  const style = STYLES.includes(opts.style) ? opts.style : 'penrose';
  const net = style === 'network';
  const color = opts.indexColor || fallbackIndexColor;
  const maxWidth = opts.maxWidth || 900;
  const dim = opts.dim || 4;
  const warnings = [];
  const sides = sidesOf(expr);

  // Pass 1: units, pairs, levels and order for each term.
  const pieces = [];
  const termsOut = [];
  sides.forEach((terms, si) => {
    if (si > 0) pieces.push({ kind: 'op', text: '=', key: `eq${si}`, w: textWidth('=', 22) + 6 });
    if (!terms.length) pieces.push({ kind: 'op', text: '0', key: `zero${si}`, w: textWidth('0', 22) });
    terms.forEach((term, ti) => {
      const tkey = `T${si}.${ti}`;
      const units = buildUnits(term, tkey, net);
      const { pairs, free } = pairUp(units, warnings, tkey);
      const maxL = net ? 0 : assignLevels(units, pairs);
      const maxH = Math.max(30, ...units.map(u => u.ih + 2 * u.depth * M.ringPad + 4));
      const gap = Math.max(M.levelGap, maxH + 46);
      const T = { key: tkey, term, units, pairs, free, net, maxL, si, ti,
        levelCy: L => (maxL / 2 - L) * gap };
      // y extents do not depend on the order.
      let y0 = Infinity, y1 = -Infinity;
      for (const u of units) {
        const cy = net ? 0 : T.levelCy(u.level);
        const h = (net ? Math.max(u.ih, 30) : u.ih) / 2 + u.depth * M.ringPad + 2;
        y0 = Math.min(y0, cy - h); y1 = Math.max(y1, cy + h);
      }
      if (!units.length) { y0 = -12; y1 = 12; }
      T.y0 = y0; T.y1 = y1;
      const cp = coeffParts(term.coeff);
      const empty = !units.length;
      const ctext = empty ? (cp.text || (term.coeff === 0 ? '0' : '1')) : cp.text;
      const sign = cp.sign < 0 ? '−' : '+';
      const first = ti === 0;
      if (!first || cp.sign < 0) pieces.push({ kind: 'op', text: sign, key: `${tkey}|sep`, w: textWidth(sign, 22) + 4, term: T, sep: true });
      if (ctext) pieces.push({ kind: 'coeff', text: ctext, key: `${tkey}|coeff`, w: textWidth(ctext, 20) + 2, term: T });
      if (!empty) pieces.push({ kind: 'term', key: tkey, term: T });
      termsOut.push(T);
    });
  });

  // Order each term with a provisional boundary.
  for (const T of termsOut) {
    if (!T.units.length) { T.order = []; continue; }
    const top = T.y0 - M.legOut, bottom = T.y1 + M.legOut;
    T.order = chooseOrder(T, top, bottom);
    const g = termGeometry(T, T.order, top, bottom, false);
    let wy0 = Infinity, wy1 = -Infinity;
    for (const w of g.wires) for (const p of w.dense) { wy0 = Math.min(wy0, p[1]); wy1 = Math.max(wy1, p[1]); }
    T.top = Math.min(T.y0 - M.legOut, wy0 - 16);
    T.bottom = Math.max(T.y1 + M.legOut, wy1 + 16);
    T.width = g.width;
    if (net) {
      const es = einsumOf(T.term, isDerivFactor);
      // Only terms that contract or join two operands get a line.
      if (es) {
        const [ins, outs] = es.spec.split('->');
        const letters = ins.replace(/,/g, '');
        if (es.names.length >= 2 || letters.length > outs.length) T.einsum = es;
      }
    }
  }
  for (const p of pieces) if (p.kind === 'term') p.w = p.term.width;

  // Pass 2: rows. Break only before a sign piece or '='.
  const rows = [];
  let row = { pieces: [], w: 0 };
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    // Measure the run up to the next break point.
    let run = 0, j = i;
    do { run += pieces[j].w + M.pieceGap; j++; } while (j < pieces.length && !(pieces[j].sep || pieces[j].text === '='));
    if ((p.sep || p.text === '=') && row.pieces.length && row.w + run > maxWidth) { rows.push(row); row = { pieces: [], w: 0 }; }
    row.pieces.push(p); row.w += p.w + M.pieceGap;
  }
  if (row.pieces.length) rows.push(row);

  const items = [];
  let crossings = 0;
  const perTerm = {};
  let yCursor = M.margin;
  let sceneW = 0;
  for (const R of rows) {
    const terms = R.pieces.filter(p => p.kind === 'term').map(p => p.term);
    const top = Math.min(-20, ...terms.map(t => t.top));
    const bottom = Math.max(20, ...terms.map(t => t.bottom));
    R.ein = net ? terms.filter(t => t.einsum) : [];
    const einsumPad = R.ein.length ? 10 + 18 * R.ein.length : 0;
    const rowTop = top - M.labelPad, rowBot = bottom + M.labelPad + einsumPad;
    const oy = yCursor - rowTop;
    R.y = oy; R.top = oy + top; R.bottom = oy + bottom;
    R.w -= M.pieceGap;
    sceneW = Math.max(sceneW, R.w);
    R.oy = oy;
    yCursor = oy + rowBot + M.rowGap;
  }
  sceneW += 2 * M.margin;
  const sceneH = yCursor - M.rowGap + M.margin;

  for (const R of rows) {
    let x = M.margin + (sceneW - 2 * M.margin - R.w) / 2;
    const oy = R.oy;
    for (const p of R.pieces) {
      if (p.kind === 'op' || p.kind === 'coeff') {
        items.push({ type: 'text', key: p.key, x: x + p.w / 2, y: oy + 7, text: p.text, size: p.kind === 'op' ? 22 : 20, role: p.kind, anchor: 'middle' });
        x += p.w + M.pieceGap;
        continue;
      }
      const T = p.term;
      const g = termGeometry(T, T.order, R.top - oy, R.bottom - oy, false);
      crossings += g.crossings;
      perTerm[T.key] = g.crossings;
      emitTerm(items, T, g, x, oy, { color, net, dim, style });
      if (net && T.einsum) {
        const li = R.ein.indexOf(T);
        items.push({ type: 'text', key: `${T.key}|einsum`, x: sceneW / 2, y: R.bottom + M.labelPad + 18 + 18 * li, text: `einsum('${T.einsum.spec}', ${T.einsum.names.join(', ')})`, size: 12, role: 'einsum', anchor: 'middle' });
      }
      x += p.w + M.pieceGap;
    }
  }
  return {
    style, width: sceneW, height: sceneH, items, crossings, perTerm, warnings,
    rows: rows.map(R => ({ top: R.top, bottom: R.bottom, y: R.y })),
    tex: expr && expr.tex, dim,
  };
}

function emitTerm(items, T, g, ox, oy, { color, net, dim }) {
  const P = (x, y) => [x + ox, y + oy];
  for (const u of T.order) {
    if (u.kind !== 'none') {
      items.push({
        type: 'node', key: u.key, kind: u.kind, shape: u.shape, label: u.label, dashed: u.dashed,
        x: ox + (u.ix0 + u.ix1) / 2, y: oy + (u.iy0 + u.iy1) / 2, w: u.ix1 - u.ix0, h: u.iy1 - u.iy0,
        sx: u.own.map(s => s.x + ox), rank: u.own.length, term: T.key, level: u.level,
      });
    }
    u.rings.forEach((r) => {
      items.push({ type: 'circle', key: r.L.key, dkind: r.L.dkind, x0: r.x0 + ox, x1: r.x1 + ox, y0: r.y0 + oy, y1: r.y1 + oy,
        x: ox + (r.x0 + r.x1) / 2, y: oy + (r.y0 + r.y1) / 2, term: T.key, unit: u.key });
    });
  }
  for (const w of g.wires) {
    const [h1, h2] = splitHalf(w.dense.map(p => P(p[0], p[1])), N_PTS);
    const c = color(w.p.sym);
    const mk = (s, pts, other) => ({
      type: 'leg', key: s.key, sym: s.sym, label: symText(s.sym), up: s.up, color: c, pts, free: false,
      strand: w.p.key, wire: w.p.type, slot: pts[0].slice(), end: pts[pts.length - 1].slice(), mate: other.key,
      term: T.key, unit: s.unit.key, role: s.role,
    });
    items.push(mk(w.p.a, h1, w.p.b), mk(w.p.b, h2, w.p.a));
    if (net) {
      const m = h1[h1.length - 1];
      const below = m[1] > oy + w.p.a.unit.cy + 0.5;
      items.push({ type: 'text', key: `${w.p.key}:dim`, x: m[0], y: m[1] + (below ? 13 : -5), text: String(dim), size: 10, role: 'dim', anchor: 'middle', term: T.key });
    }
  }
  for (const f of g.freeLegs) {
    const s = f.s;
    const pts = resample(f.pts.map(p => P(p[0], p[1])), N_PTS);
    const end = pts[pts.length - 1];
    const side = !!s.dir[0];
    const lab = side ? [end[0] + s.dir[0] * 10, end[1] + 5] : [end[0], end[1] + (s.up ? -9 : 19)];
    items.push({
      type: 'leg', key: s.key, sym: s.sym, label: symText(s.sym), up: s.up, color: color(s.sym), pts, free: true,
      strand: s.key, slot: pts[0].slice(), end: end.slice(), labelX: lab[0], labelY: lab[1],
      term: T.key, unit: s.unit.key, role: s.role,
    });
  }
  // Symmetry bars.
  const legByKey = new Map();
  for (const it of items) if (it.type === 'leg' && it.term === T.key) legByKey.set(it.key, it);
  const groups = [];
  for (const u of T.units) {
    const f = u.factor;
    if (!f || !f.sym) continue;
    for (const sg of f.sym) {
      let ks = sg.slots || [];
      if (ks.length === 2 && ks[1] - ks[0] > 1) ks = Array.from({ length: ks[1] - ks[0] + 1 }, (_, i) => ks[0] + i);
      const slots = ks.map(k => u.own[k]).filter(Boolean);
      if (slots.length >= 2) groups.push({ type: sg.type, slots });
    }
  }
  for (const sg of T.term.sym || []) {
    let slots = [];
    if (sg.refs) {
      const byFi = new Map();
      for (const u of T.units) for (const s of u.slots) byFi.set(`${s.fi}:${s.j}`, s);
      slots = sg.refs.map(([fi, j]) => byFi.get(`${fi}:${j}`)).filter(Boolean);
    } else if (sg.syms) {
      const all = T.units.flatMap(u => u.slots);
      slots = sg.syms.map(sym => all.find(s => s.sym === String(sym))).filter(Boolean);
    }
    if (slots.length >= 2) groups.push({ type: sg.type, slots });
  }
  for (const gr of groups) {
    const legs = gr.slots.map(s => legByKey.get(s.key)).filter(Boolean);
    if (legs.length < 2) continue;
    const up = legs.every(l => l.up), down = legs.every(l => !l.up);
    if (!up && !down) continue;
    const y = up ? Math.min(...legs.map(l => l.slot[1])) - 13 : Math.max(...legs.map(l => l.slot[1])) + 13;
    const xs = legs.map(l => xAtY(l.pts, y, l.slot[0]));
    const n = legs.length;
    const x0 = Math.min(...xs) - 7, x1 = Math.max(...xs) + 7;
    const weight = `1/${n}!`;
    // Put the weight where no leg runs: right, left, then beyond the bar.
    const tw = textWidth(weight, 12) + 2;
    const termLegs = [...legByKey.values()];
    const clear = (a, b, yy) => termLegs.every(l => { const lx = xAtY(l.pts, yy, NaN); return !(lx > a - 3 && lx < b + 3); });
    const cands = [
      [x1 + 5, y + 4, 'start', x1 + 5, x1 + 5 + tw],
      [x0 - 5, y + 4, 'end', x0 - 5 - tw, x0 - 5],
      [(x0 + x1) / 2, y + (up ? -8 : 16), 'middle', (x0 + x1) / 2 - tw / 2, (x0 + x1) / 2 + tw / 2],
    ];
    const wsel = cands.find(c => clear(c[3], c[4], y)) || cands[0];
    items.push({
      type: 'bar', key: `${T.key}|bar:${gr.type}:${legs.map(l => l.sym).join(',')}`, btype: gr.type === 'antisym' ? 'antisym' : 'sym',
      x0, x1, y, up, weight, n, term: T.key, legs: legs.map(l => l.key),
      wx: wsel[0], wy: wsel[1], wa: wsel[2],
    });
  }
}

function xAtY(pts, y, fallback) {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if ((a[1] - y) * (b[1] - y) <= 0 && a[1] !== b[1]) return a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]);
  }
  return fallback;
}

// Node and ring boxes of a scene, for overlap tests.
export function unitBoxes(scene) {
  const by = new Map();
  for (const it of scene.items) {
    let b = null;
    if (it.type === 'node') b = { x0: it.x - it.w / 2, x1: it.x + it.w / 2, y0: it.y - it.h / 2, y1: it.y + it.h / 2 };
    if (it.type === 'circle') b = { x0: it.x0, x1: it.x1, y0: it.y0, y1: it.y1 };
    if (!b) continue;
    const k = it.type === 'circle' ? it.unit : it.key;
    const o = by.get(k);
    by.set(k, o ? { x0: Math.min(o.x0, b.x0), x1: Math.max(o.x1, b.x1), y0: Math.min(o.y0, b.y0), y1: Math.max(o.y1, b.y1) } : b);
  }
  return [...by.entries()].map(([key, box]) => ({ key, ...box }));
}
