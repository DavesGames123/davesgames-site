// ============================================================================
//  LINKAGES  ·  layers.js — the depth stack of each linkage and its clash check
// ----------------------------------------------------------------------------
//  No DOM and no THREE: tests.mjs runs this file in Node, and scene.js
//  builds its bars, pins and frame from the same stack. Units are mm.
//  z is the depth along the pin axis: the backboard face is z = 0, and +z
//  comes toward the viewer.
//
//  WHY LAYERS. A real planar linkage keeps its links apart in depth. Two
//  links that sweep across each other must sit in different layers. A pin
//  spans only the layers of the links that it joins, with a washer in each
//  gap and a thin cap at each end. A link that passes near a pin must sit
//  outside the span of that pin.
//
//  STACK. Layer n is z = Z0 + n PITCH .. + THICK. The gap between two
//  layers is PITCH - THICK = 2 mm. A cap is CAP = 1.2 mm, so 0.8 mm stays
//  clear of the next layer.
//    backboard ........ z -12 .. 0
//    hub, frame ....... z 0 .. 3, flat on the backboard
//    ground pin ....... a cast boss (r 8) from z 0 up to its lowest link
//    input pin ........ a sleeve (r 5.5) from z 0 up to its lowest link
//    moving pin ....... a cap (r 5.5) below its lowest link
//    every pin ........ r 3.5 in each link hole, r 5.5 washers or sleeves
//                       between its links, a cap (r 5.5) on top
//
//  CLASH CHECK. Each solid is a capsule (a segment with a radius) swept
//  over a z range. Two solids clash at an input angle when they are less
//  than CLR apart in z and less than CLR apart in the plane. These pairs
//  may touch by design: two fixed solids, a pin and a link that it joins,
//  the hub and its input link or input pin, the hub and the backboard.
//
//  GREP MAP
//    export const LAYERS ........ the layer of each link, per linkage
//    export function makeStack .. links, pins and fixed solids from a table
//    function pinSegs ........... the (r, z0, z1) runs of one pin
//    export function solidsAt ... every solid at one input angle
//    export function clashes .... the clashing pairs over a full turn
//    export function pinReach ... pins that miss a layer of a link they join
// ============================================================================
import { TAU } from './mech.js';

export const THICK = 6, PITCH = 8, Z0 = 5, CAP = 1.2, CLR = 0.5, BEVEL = 0.6;
export const PIN_R = 3.5, SLEEVE_R = 5.5, BOSS_R = 8;
// the hub annulus is r 22; the spoke reaches r 25
export const HUB = { r: 25, z0: 0, z1: 3 };
export const WIDTH = { fourbar: 16, peaucellier: 16, jansen: 12 };
export const INPUT = { fourbar: 'O2', peaucellier: 'O1', jansen: 'O' };
// the Jansen frame: a flat bar on the backboard from Z toward O. It stops
// before the hub, so the hub turns clear of it.
export const FRAME = { w: 18, z0: 0, z1: 3 };

// The layer of each link. A search over all tables found these: the fewest
// layers with no clash over a full turn, then the shortest pins, then the
// input link nearest the backboard. The four-bar coupler passes over pin
// O2, so it sits in front of the crank. In the Jansen leg, links j and kk
// pass over the input pin O, so the crank sits in layer 1 and j and kk in
// front of it.
export const LAYERS = {
  fourbar: { crank: 0, coupler: 1, rocker: 0 },
  peaucellier: { arm: 0, longA: 2, longB: 3, rhCA: 1, rhCB: 2, rhAP: 0, rhBP: 1 },
  jansen: { crank: 1, j: 2, kk: 3, b: 0, c: 1, d: 2, e: 1, f: 0, g: 2, h: 1, i: 0 },
};

// the (r, z0, z1) runs of one pin, from the bottom up. ls: its links
// sorted by z0. base: 'boss' (ground), 'sleeve' (input) or 'cap'.
function pinSegs(ls, base) {
  const s = [], lo = ls[0].z0;
  if (base === 'boss') s.push({ r: BOSS_R, z0: 0, z1: lo, part: 'boss' });
  else if (base === 'sleeve') s.push({ r: SLEEVE_R, z0: 0, z1: lo });
  else s.push({ r: SLEEVE_R, z0: lo - CAP, z1: lo });
  ls.forEach((l, k) => {
    s.push({ r: PIN_R, z0: l.z0, z1: l.z1, hole: l.id });
    if (k + 1 < ls.length && ls[k + 1].z0 > l.z1) s.push({ r: SLEEVE_R, z0: l.z1, z1: ls[k + 1].z0 });
  });
  const hi = ls[ls.length - 1].z1;
  s.push({ r: SLEEVE_R, z0: hi, z1: hi + CAP });
  return s;
}

// L: makeLinkage(unit). table: { link id: layer }.
// -> { id, links, pins, fixed, hub, depth }
export function makeStack(id, L, table = LAYERS[id]) {
  const r = WIDTH[id] / 2 + BEVEL;
  const links = L.links.map(l => {
    const n = table[l.id], z0 = Z0 + n * PITCH;
    return { id: l.id, from: l.from, to: l.to, len: l.len, layer: n, r, z0, z1: z0 + THICK };
  });
  const joints = [...new Set(L.links.flatMap(l => [l.from, l.to]))];
  const pins = joints.map(j => {
    const ls = links.filter(l => l.from === j || l.to === j).sort((a, b) => a.z0 - b.z0);
    const ground = L.ground.includes(j), input = j === INPUT[id];
    return { joint: j, fixed: ground, links: ls.map(l => l.id), segs: pinSegs(ls, input ? 'sleeve' : ground ? 'boss' : 'cap') };
  });
  const fixed = [];
  const Q0 = L.pose(0); L.reset();
  if (id === 'jansen') {
    const O = Q0.J.O, Z = Q0.J.Z, dl = Math.hypot(O[0] - Z[0], O[1] - Z[1]);
    const fr = FRAME.w / 2 + BEVEL, len = dl - (HUB.r + fr + 1.5);
    const ux = (O[0] - Z[0]) / dl, uy = (O[1] - Z[1]) / dl;
    fixed.push({ name: 'frame', a: Z, b: [Z[0] + ux * len, Z[1] + uy * len], r: fr, z0: FRAME.z0, z1: FRAME.z1, len, ang: Math.atan2(uy, ux) });
  }
  if (id === 'peaucellier') {
    let y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < 72; i++) { const y = L.pose(i / 72 * TAU).J.P[1]; y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    L.reset();
    fixed.push({ name: 'rail', a: [L.line, y0 - 20], b: [L.line, y1 + 20], r: 2.5, z0: 0, z1: 2 });
  }
  const depth = Math.max(...links.map(l => l.z1)) + CAP;
  return { id, links, pins, fixed, hub: { joint: INPUT[id], ...HUB }, depth };
}

// Every solid at input angle th: { name, body, a, b, r, z0, z1 }.
// body: a link id, 'pin:J', 'hub', 'ground' (the backboard and the
// frame). fixed marks the solids that never move.
export function solidsAt(st, L, th) {
  const Q = L.pose(th), J = Q.J, out = [];
  for (const l of st.links) out.push({ name: l.id, body: l.id, a: J[l.from], b: J[l.to], r: l.r, z0: l.z0, z1: l.z1 });
  for (const p of st.pins) p.segs.forEach((s, k) => out.push({ name: `pin ${p.joint}`, body: 'pin:' + p.joint, joins: p.links, fixed: p.fixed, a: J[p.joint], b: J[p.joint], r: s.r, z0: s.z0, z1: s.z1, k }));
  for (const f of st.fixed) out.push({ name: f.name, body: 'ground', fixed: true, a: f.a, b: f.b, r: f.r, z0: f.z0, z1: f.z1 });
  out.push({ name: 'backboard', body: 'ground', fixed: true, board: true, z0: -12, z1: 0 });
  const h = J[st.hub.joint];
  out.push({ name: 'hub', body: 'hub', a: h, b: h, r: st.hub.r, z0: st.hub.z0, z1: st.hub.z1, input: st.hub.joint });
  return out;
}

// the distance between two segments in the plane
function segDist(p, q, s, t) {
  const d1 = [q[0] - p[0], q[1] - p[1]], d2 = [t[0] - s[0], t[1] - s[1]], r = [p[0] - s[0], p[1] - s[1]];
  const a = d1[0] * d1[0] + d1[1] * d1[1], e = d2[0] * d2[0] + d2[1] * d2[1], f = d2[0] * r[0] + d2[1] * r[1];
  let u, v;
  if (a < 1e-12 && e < 1e-12) { u = v = 0; }
  else if (a < 1e-12) { u = 0; v = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = d1[0] * r[0] + d1[1] * r[1];
    if (e < 1e-12) { v = 0; u = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = d1[0] * d2[0] + d1[1] * d2[1], den = a * e - b * b;
      u = den > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      v = (b * u + f) / e;
      if (v < 0) { v = 0; u = Math.min(1, Math.max(0, -c / a)); }
      else if (v > 1) { v = 1; u = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  const x = p[0] + d1[0] * u - s[0] - d2[0] * v, y = p[1] + d1[1] * u - s[1] - d2[1] * v;
  return Math.hypot(x, y);
}

// may solids x and y touch by design?
function allowed(x, y, inputLink) {
  if (x.body === y.body) return true;
  if (x.fixed && y.fixed) return true;
  for (const [p, q] of [[x, y], [y, x]]) {
    if (p.joins && p.joins.includes(q.body)) return true;
    if (p.body === 'hub' && (q.body === inputLink || q.body === 'pin:' + p.input || q.board)) return true;
  }
  return false;
}

// The clashing pairs over N input angles: [{ pair, gap, th }], gap the
// worst plane clearance (mm, < 0 is overlap) while the z ranges are
// closer than clr (for the backboard, the z clearance). An empty list is
// a clean stack.
export function clashes(st, L, N = 720, clr = CLR) {
  const inputLink = st.links.find(l => l.from === INPUT[st.id] || l.to === INPUT[st.id]).id;
  const worst = new Map();
  L.reset();
  for (let i = 0; i < N; i++) {
    const th = TAU * i / N, S = solidsAt(st, L, th);
    for (let m = 0; m < S.length; m++) for (let n = m + 1; n < S.length; n++) {
      const x = S[m], y = S[n];
      if (allowed(x, y, inputLink)) continue;
      const zg = Math.max(x.z0 - y.z1, y.z0 - x.z1);
      if (zg >= clr) continue;
      // the backboard fills the plane: its clearance is the z clearance
      const g = x.board || y.board ? zg : segDist(x.a, x.b, y.a, y.b) - x.r - y.r;
      if (g >= clr) continue;
      const key = [x.name, y.name].sort().join(' / ');
      const w = worst.get(key);
      if (!w || g < w.gap) worst.set(key, { pair: key, gap: g, th });
    }
  }
  L.reset();
  return [...worst.values()].sort((p, q) => p.pair.localeCompare(q.pair));
}

// Pins that miss part of a link they join: [{ joint, link }]. A pin must
// be one solid with no gap in z, pass through the full z range of each of
// its links, and end in a cap above its top link.
export function pinReach(st) {
  const miss = [];
  for (const p of st.pins) {
    const s = p.segs.slice().sort((a, b) => a.z0 - b.z0);
    for (let k = 1; k < s.length; k++) if (Math.abs(s[k].z0 - s[k - 1].z1) > 1e-9) miss.push({ joint: p.joint, link: 'gap at z ' + s[k - 1].z1 });
    for (const id of p.links) {
      const l = st.links.find(q => q.id === id), top = Math.max(...p.links.map(q => st.links.find(m => m.id === q).z1));
      if (!(s[0].z0 <= l.z0 && s[s.length - 1].z1 >= top + CAP - 1e-9)) miss.push({ joint: p.joint, link: id });
    }
  }
  return miss;
}
