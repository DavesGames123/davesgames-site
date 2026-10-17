// ============================================================================
//  DIAGRAM TRANSITION  ·  one OpTrace step as a frame at time t  (DOM-free)
// ----------------------------------------------------------------------------
//  stepFrame(step, A, B, t) gives the scene between the layout A of
//  step.before and the layout B of step.after. The frame is continuous in t:
//  at t = 0 it is A, at t = 1 it is B (plus overlay items that mark the
//  operation, flagged overlay: true).
//
//  1. matchTerms pairs the terms of B with the terms of A (same side, same
//     factor names first, then most shared names). rekey gives each matched
//     B item the key of its A item, so that the interpolation moves it.
//  2. lerpScene interpolates matched items (positions, leg points, colours).
//     New items grow: a leg grows out of its slot, a derivative ring grows
//     round its node, a bar grows from its middle, a node scales up. A new
//     term with no match slides out of its source term (a sum expands into
//     terms side by side). Old items fade, legs pull back into their slot
//     (terms that cancel fade).
//  3. The step kind adds its own motion:
//       contract / trace ....... legs swing and join (from 2), focus pulses
//       raise / lower .......... the leg bends over a metric cap or cup
//       transform .............. Jacobian nodes wrap the free legs
//       symmetrize / antisym ... a wavy or straight bar with 1/n! appears
//       partial / covariant .... the ring grows (from 2)
//       expandSum .............. terms slide out (from 2)
//
//  EXPORTS   (jump with grep -n "<anchor>" transition.js)
//      ease ........... "export function ease"
//      matchTerms ..... "export function matchTerms"
//      rekey .......... "export function rekey"
//      lerpScene ...... "export function lerpScene"
//      stepFrame ...... "export function stepFrame"
// ============================================================================

import { N_PTS, routePts, resample, pointAt } from './geom.js';
import { lerpColor } from './colors.js';

export function ease(t) {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

const L = (a, b, t) => a + (b - a) * t;
const LP = (P, Q, t) => P.map((p, i) => [L(p[0], Q[i][0], t), L(p[1], Q[i][1], t)]);

// Leg interpolation that keeps the leg a curve of about the same length:
// lerp the start point, the first direction, each turn angle and each
// segment length. A straight leg then swings round its slot to its new
// shape instead of shrinking through the middle.
function swing(P, Q, t) {
  if (t <= 0) return P.map(p => p.slice());
  if (t >= 1) return Q.map(p => p.slice());
  const polar = R => {
    const ang = [], len = [];
    for (let i = 0; i < R.length - 1; i++) {
      const dx = R[i + 1][0] - R[i][0], dy = R[i + 1][1] - R[i][1];
      len.push(Math.hypot(dx, dy)); ang.push(Math.atan2(dy, dx));
    }
    // Zero-length segments keep the previous direction.
    for (let i = 0; i < ang.length; i++) if (len[i] < 1e-9) ang[i] = i ? ang[i - 1] : (ang.find((a, k) => len[k] >= 1e-9) ?? 0);
    const turn = ang.map((a, i) => (i ? wrap(a - ang[i - 1]) : a));
    return { turn, len };
  };
  const a = polar(P), b = polar(Q);
  const out = [[L(P[0][0], Q[0][0], t), L(P[0][1], Q[0][1], t)]];
  let dir = a.turn[0] + wrap(b.turn[0] - a.turn[0]) * t;
  for (let i = 0; i < a.len.length; i++) {
    if (i) dir += L(a.turn[i], b.turn[i], t);
    const l = L(a.len[i], b.len[i], t), p = out[i];
    out.push([p[0] + Math.cos(dir) * l, p[1] + Math.sin(dir) * l]);
  }
  return out;
}
function wrap(x) { while (x > Math.PI) x -= 2 * Math.PI; while (x < -Math.PI) x += 2 * Math.PI; return x; }

function termInfo(scene) {
  const by = new Map();
  for (const it of scene.items) {
    const k = it.term || (typeof it.key === 'string' && it.key.startsWith('T') ? it.key.split('|')[0] : null);
    if (!k || !/^T\d+\.\d+$/.test(k)) continue;
    if (!by.has(k)) by.set(k, { key: k, side: +k.slice(1).split('.')[0], names: [], x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity });
    const t = by.get(k);
    if (it.type === 'node') t.names.push(it.label + '/' + it.rank);
    if (it.type === 'circle') t.names.push(it.dkind);
    const xs = it.type === 'leg' ? it.pts.map(p => p[0]) : [it.x ?? it.x0];
    const ys = it.type === 'leg' ? it.pts.map(p => p[1]) : [it.y ?? 0];
    for (const x of xs) { t.x0 = Math.min(t.x0, x); t.x1 = Math.max(t.x1, x); }
    for (const y of ys) { t.y0 = Math.min(t.y0, y); t.y1 = Math.max(t.y1, y); }
  }
  for (const t of by.values()) { t.names.sort(); t.sig = t.names.join(' '); t.cx = (t.x0 + t.x1) / 2; t.cy = (t.y0 + t.y1) / 2; }
  return [...by.values()];
}

function jaccard(a, b) {
  const A = new Map(), B = new Map();
  for (const x of a) A.set(x, (A.get(x) || 0) + 1);
  for (const x of b) B.set(x, (B.get(x) || 0) + 1);
  let inter = 0, uni = 0;
  for (const k of new Set([...A.keys(), ...B.keys()])) { inter += Math.min(A.get(k) || 0, B.get(k) || 0); uni += Math.max(A.get(k) || 0, B.get(k) || 0); }
  return uni ? inter / uni : 1;
}

// Map from B term key to { to: A term key | null, spawn: [dx, dy] | null }.
export function matchTerms(A, B) {
  const ta = termInfo(A), tb = termInfo(B);
  const used = new Set(), out = new Map();
  // Exact signatures first, in order, then the best overlap.
  for (const pass of [0, 1]) {
    tb.forEach((b, bi) => {
      if (out.has(b.key)) return;
      let best = null, bestS = -1;
      ta.forEach((a, ai) => {
        if (used.has(a.key) || a.side !== b.side) return;
        const exact = a.sig === b.sig;
        if (pass === 0 && !exact) return;
        const s = (exact ? 2 : 0) + jaccard(a.names, b.names) - 0.01 * Math.abs(ai - bi);
        if (s > bestS) { bestS = s; best = a; }
      });
      if (best && (pass === 0 || bestS > 0.25)) { used.add(best.key); out.set(b.key, { to: best.key, spawn: null }); }
    });
  }
  for (const b of tb) {
    if (out.has(b.key)) continue;
    let src = null, bestS = -1;
    for (const a of ta) {
      const s = jaccard(a.names, b.names) + (a.side === b.side ? 0.1 : 0);
      if (s > bestS) { bestS = s; src = a; }
    }
    out.set(b.key, { to: null, spawn: src ? [src.cx - b.cx, src.cy - b.cy] : null });
  }
  return out;
}

const REF_FIELDS = ['key', 'term', 'unit', 'strand', 'mate'];

export function rekey(scene, match) {
  const swap = k => {
    if (typeof k !== 'string') return k;
    const i = k.indexOf('|');
    const head = i < 0 ? k : k.slice(0, i);
    const m = match.get(head);
    if (!m) return k;
    const nh = m.to || `N:${head}`;
    return i < 0 ? nh : nh + k.slice(i);
  };
  const items = scene.items.map(it => {
    const o = { ...it };
    for (const f of REF_FIELDS) if (o[f] !== undefined) o[f] = swap(o[f]);
    if (o.legs) o.legs = o.legs.map(swap);
    const head = it.term || (typeof it.key === 'string' ? it.key.split('|')[0] : '');
    const m = match.get(head);
    if (m && !m.to && m.spawn) o.spawn = m.spawn;
    return o;
  });
  return { ...scene, items };
}

function lerpItem(a, b, t) {
  const o = { ...b };
  switch (b.type) {
    case 'node':
      o.x = L(a.x, b.x, t); o.y = L(a.y, b.y, t); o.w = L(a.w, b.w, t); o.h = L(a.h, b.h, t);
      if (a.sx && b.sx && a.sx.length === b.sx.length) o.sx = a.sx.map((v, i) => L(v, b.sx[i], t));
      break;
    case 'circle':
      for (const f of ['x0', 'x1', 'y0', 'y1', 'x', 'y']) o[f] = L(a[f], b[f], t);
      break;
    case 'bar':
      for (const f of ['x0', 'x1', 'y', 'wx', 'wy']) if (a[f] !== undefined && b[f] !== undefined) o[f] = L(a[f], b[f], t);
      break;
    case 'text':
      o.x = L(a.x, b.x, t); o.y = L(a.y, b.y, t);
      break;
    case 'leg': {
      // Mostly swing, part straight blend: long reroutes do not fly wide.
      const sw = swing(a.pts, b.pts, t), li = LP(a.pts, b.pts, t);
      o.pts = sw.map((p, i) => [p[0] * 0.7 + li[i][0] * 0.3, p[1] * 0.7 + li[i][1] * 0.3]);
      o.slot = o.pts[0]; o.end = o.pts[o.pts.length - 1];
      o.color = lerpColor(a.color, b.color, t);
      o.label = t < 0.5 ? a.label : b.label;
      if (a.free && b.free) {
        o.labelX = o.end[0] + L(a.labelX - a.end[0], b.labelX - b.end[0], t);
        o.labelY = o.end[1] + L(a.labelY - a.end[1], b.labelY - b.end[1], t);
        o.labelO = 1;
      }
      else if (a.free) { o.labelX = a.labelX + (o.end[0] - a.end[0]); o.labelY = a.labelY + (o.end[1] - a.end[1]); o.labelO = 1 - t; o.label = a.label; }
      else if (b.free) { o.labelX = b.labelX + (o.end[0] - b.end[0]); o.labelY = b.labelY + (o.end[1] - b.end[1]); o.labelO = t; }
      o.free = t < 0.5 ? a.free : b.free;
      o.up = t < 0.5 ? a.up : b.up;
      break;
    }
    default: break;
  }
  o.o = L(a.o ?? 1, b.o ?? 1, t);
  return o;
}

function shifted(it, d) {
  const o = { ...it };
  if (it.type === 'leg') {
    o.pts = it.pts.map(p => [p[0] + d[0], p[1] + d[1]]);
    o.slot = o.pts[0]; o.end = o.pts[o.pts.length - 1];
    if (o.labelX !== undefined) { o.labelX += d[0]; o.labelY += d[1]; }
  } else if (it.type === 'circle' || it.type === 'bar') {
    for (const f of ['x0', 'x1']) if (o[f] !== undefined) o[f] += d[0];
    for (const f of ['y0', 'y1']) if (o[f] !== undefined) o[f] += d[1];
    if (o.x !== undefined) o.x += d[0];
    if (o.y !== undefined) o.y += d[1];
    if (o.wx !== undefined) { o.wx += d[0]; o.wy += d[1]; }
  } else {
    o.x += d[0]; o.y += d[1];
    if (o.sx) o.sx = o.sx.map(v => v + d[0]);
  }
  return o;
}

// e = 1 is fully present. dir 'in' or 'out' only names the purpose.
function grow(it, e) {
  const o = { ...it, o: (it.o ?? 1) * Math.min(1, e * 1.6) };
  if (it.type === 'leg') {
    const s = it.pts[0];
    o.pts = it.pts.map(p => [s[0] + (p[0] - s[0]) * e, s[1] + (p[1] - s[1]) * e]);
    o.end = o.pts[o.pts.length - 1];
    if (it.labelX !== undefined) { o.labelX = it.labelX + (o.end[0] - it.end[0]); o.labelY = it.labelY + (o.end[1] - it.end[1]); }
    o.labelO = e;
  } else if (it.type === 'circle') {
    const cx = (it.x0 + it.x1) / 2, cy = (it.y0 + it.y1) / 2;
    o.x0 = cx + (it.x0 - cx) * e; o.x1 = cx + (it.x1 - cx) * e;
    o.y0 = cy + (it.y0 - cy) * e; o.y1 = cy + (it.y1 - cy) * e;
    o.o = (it.o ?? 1) * Math.min(1, e * 3);
  } else if (it.type === 'bar') {
    const cx = (it.x0 + it.x1) / 2;
    o.x0 = cx + (it.x0 - cx) * e; o.x1 = cx + (it.x1 - cx) * e;
  } else if (it.type === 'node') {
    const s = 0.4 + 0.6 * e;
    o.w = it.w * s; o.h = it.h * s;
    if (it.sx) o.sx = it.sx.map(v => it.x + (v - it.x) * s);
  }
  return o;
}

function appear(it, e) {
  if (it.spawn) {
    const d = [it.spawn[0] * (1 - e), it.spawn[1] * (1 - e)];
    return { ...shifted(it, d), o: (it.o ?? 1) * e, labelO: e };
  }
  // New legs grow after their node or ring has mostly appeared.
  if (it.type === 'leg') return grow(it, Math.min(1, Math.max(0, (e - 0.35) / 0.65)));
  return grow(it, e);
}

export function lerpScene(A, B, e) {
  const amap = new Map(A.items.map(it => [it.key, it]));
  const bmap = new Map(B.items.map(it => [it.key, it]));
  const items = [];
  for (const a of A.items) {
    const b = bmap.get(a.key);
    if (b && b.type === a.type) {
      const same = a.type !== 'text' || a.text === b.text;
      const sameShape = a.type !== 'node' || (a.shape === b.shape && a.label === b.label);
      if (same && sameShape) { items.push(lerpItem(a, b, e)); continue; }
      // Crossfade a changed text or node.
      const mid = lerpItem(a, b, e);
      items.push({ ...mid, ...pickShape(a), key: a.key + '~a', o: (a.o ?? 1) * (1 - e) });
      items.push({ ...mid, key: a.key + '~b', o: (b.o ?? 1) * e });
      continue;
    }
    items.push(grow(a, 1 - e));
  }
  const born = [];
  for (const b of B.items) if (!amap.has(b.key) || amap.get(b.key).type !== b.type) { const it = appear(b, e); items.push(it); born.push([b, it]); }
  // A new leg on a new ring rides on the ring while the ring grows.
  for (const [b, it] of born) {
    if (it.type !== 'leg' || b.role !== 'deriv' || b.spawn) continue;
    const ring = born.find(([r]) => r.type === 'circle' && r.unit === b.unit);
    if (!ring) continue;
    const r = ring[0], cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    const dx = (cx + (b.pts[0][0] - cx) * e) - b.pts[0][0], dy = (cy + (b.pts[0][1] - cy) * e) - b.pts[0][1];
    it.pts = it.pts.map(p => [p[0] + dx, p[1] + dy]);
    it.slot = it.pts[0]; it.end = it.pts[it.pts.length - 1];
    if (it.labelX !== undefined) { it.labelX += dx; it.labelY += dy; }
  }
  // Keep every leg inside the frame.
  const W = L(A.width, B.width, e), H = L(A.height, B.height, e);
  for (const it of items) if (it.type === 'leg') it.pts = it.pts.map(p => [Math.min(W - 3, Math.max(3, p[0])), Math.min(H - 3, Math.max(3, p[1]))]);
  return {
    ...B, items,
    width: L(A.width, B.width, e), height: L(A.height, B.height, e),
    crossings: e < 0.5 ? A.crossings : B.crossings,
  };
}

function pickShape(a) {
  return a.type === 'node' ? { shape: a.shape, label: a.label } : a.type === 'text' ? { text: a.text } : {};
}

// Path of a leg that bends over a cap (lower) or cup (raise).
function hookPose(a, b) {
  const s = a.slot, d = a.up ? -1 : 1;
  const side = b.end[0] >= s[0] ? 1 : -1;
  const xs = s[0] + side * 20;
  const y1 = s[1] + d * 18;
  return resample(routePts([s, [s[0], y1], [xs, y1], [xs, b.end[1]]], 10), N_PTS);
}

export function stepFrame(step, A, B, t, opts = {}) {
  const e = ease(t);
  const match = matchTerms(A, B);
  const Bk = rekey(B, match);
  const S = lerpScene(A, Bk, e);
  const kind = step && step.kind;
  const focus = new Set((step && step.focus) || []);
  const amap = new Map(A.items.map(it => [it.key, it]));
  const bmap = new Map(Bk.items.map(it => [it.key, it]));
  const extra = [];
  if (kind === 'raise' || kind === 'lower') {
    for (const it of S.items) {
      if (it.type !== 'leg') continue;
      const a = amap.get(it.key), b = bmap.get(it.key);
      if (!a || !b || a.up === b.up) continue;
      const pose = hookPose(a, b);
      const u = e < 0.5 ? ease(e / 0.5) : ease((e - 0.5) / 0.5);
      it.pts = e < 0.5 ? LP(a.pts, pose, u) : LP(pose, b.pts, u);
      it.slot = it.pts[0]; it.end = it.pts[it.pts.length - 1];
      if (b.free) { it.labelX = it.end[0]; it.labelY = it.end[1] + (b.up ? -9 : 19); }
      const bend = pose[Math.round(N_PTS * 0.3)];
      extra.push({ type: 'node', key: it.key + ':metric', shape: a.up ? 'cap' : 'cup', kind: a.up ? 'metric' : 'inverseMetric',
        label: 'g', x: bend[0], y: bend[1] + (a.up ? -4 : 4), w: 18, h: 10, sx: [bend[0] - 9, bend[0] + 9], o: Math.sin(Math.PI * e), overlay: true, term: it.term });
    }
  }
  const nodesA = A.items.filter(i => i.type === 'node').length, nodesB = B.items.filter(i => i.type === 'node').length;
  if (kind === 'transform' && nodesA === nodesB) {
    for (const it of S.items) {
      if (it.type !== 'leg' || !it.free) continue;
      if (focus.size && !focus.has(it.sym) && !focus.has(it.sym.replace(/['′]+$/, ''))) continue;
      const at = pointAt(it.pts, 0.55).p;
      const lab = it.up ? 'J' : 'J⁻¹';
      const w = (it.up ? 20 : 30) * e;
      extra.push({ type: 'node', key: it.key + ':J', shape: 'hex', kind: 'jacobian', label: lab, x: at[0], y: at[1], w, h: 18 * e, sx: [], o: Math.min(1, e * 2), overlay: true, term: it.term, small: true });
    }
  }
  if ((kind === 'symmetrize' || kind === 'antisymmetrize') && !Bk.items.some(i => i.type === 'bar' && !amap.has(i.key))) {
    const byTerm = new Map();
    for (const it of S.items) {
      if (it.type !== 'leg' || !it.free) continue;
      if (focus.size && !focus.has(it.sym)) continue;
      const k = `${it.term}|${it.up ? 'u' : 'd'}`;
      if (!byTerm.has(k)) byTerm.set(k, []);
      byTerm.get(k).push(it);
    }
    for (const [k, legs] of byTerm) {
      if (legs.length < 2) continue;
      const up = legs[0].up;
      const y = up ? Math.max(...legs.map(l => l.end[1])) + 16 : Math.min(...legs.map(l => l.end[1])) - 16;
      const xs = legs.map(l => l.end[0]);
      const x0 = Math.min(...xs) - 7, x1 = Math.max(...xs) + 7, cx = (x0 + x1) / 2;
      extra.push({ type: 'bar', key: k + ':opbar', btype: kind === 'symmetrize' ? 'sym' : 'antisym', x0: cx + (x0 - cx) * e, x1: cx + (x1 - cx) * e, y, up,
        weight: `1/${legs.length}!`, n: legs.length, o: Math.min(1, e * 2), overlay: true, term: legs[0].term });
    }
  }
  if (focus.size) {
    const p = Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
    for (const it of S.items) if (it.type === 'leg' && focus.has(it.sym)) it.wmul = 1 + 0.9 * p;
  }
  S.items.push(...extra);
  S.step = step ? { id: step.id, kind, t } : null;
  return S;
}
