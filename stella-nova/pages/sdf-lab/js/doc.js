// ============================================================================
//  SDF FORGE  ·  doc.js — the document: a tree of SDF nodes
// ----------------------------------------------------------------------------
//  PURE. No DOM, no GPU. The renderer, the CPU field, the worker and the tests
//  all read the same document through this module.
//
//  A DOCUMENT is { version, nextId, counters, roots: [id], nodes: {id: node} }.
//  A NODE is a primitive or a group:
//    common   id, kind ('prim' | 'group'), type, name, hidden,
//             pos [x y z], rot [x y z] Euler degrees, scl [x y z],
//             mods [{ id, type, on, p: {...} }]   the modifier stack
//    prim     p: {...} parameters, mat: { color [r g b], rough, metal }
//    group    op ('union' | 'subtract' | 'intersect'), smooth (bool), k,
//             children [id] in BLEND ORDER: subtract keeps the first child
//             and cuts every later one out of it.
//  A child's transform is relative to its parent, like Forge's hierarchy.
//
//  PRIMITIVES ARE CENTRED ON THEIR LOCAL ORIGIN and the creation gesture puts
//  them ON the construction plane (Forge decision 10) by moving the origin up
//  by the half height. The pivot therefore sits at the middle of the shape,
//  which is where a twist or a rotation wants it.
//
//  NON-UNIFORM SCALE. A distance field stops being a distance under a
//  non-uniform scale. The field divides the local point by s and multiplies
//  the distance by min(s). The zero set is exact (a positive factor keeps the
//  sign), and the result is a LOWER bound of the true distance with a
//  Lipschitz constant of at most 1, so sphere tracing stays safe. Use the
//  ellipsoid primitive when the field quality off the surface matters.
//
//  IDS, NOT INDICES. A node keeps its id for life. An undo record names a
//  node by id and the stack stays LIFO, so a delete and its undo restore the
//  node with the same id at the same place in its parent (Forge decision 4).
//
//  GREP MAP
//    PRIMS / MODS / OPS ......... the tables (labels, params, defaults, ranges)
//    newDoc / makePrim / makeGroup / addNode / removeNode / moveNode
//    groupNodes / ungroup / duplicate / addMod / removeMod / moveMod
//    getPath / setPath .......... a dotted path into a node ('p.r', 'pos.1')
//    parentOf / walk / depthFirst / isDescendant
//    worldMatrix / localBounds / worldBounds / docBounds   (decision 16)
//    toJSON / fromJSON / validate
// ============================================================================
import * as M from './math.js';

// ── the tables ──────────────────────────────────────────────────────────────
// Each param: [key, label, default, min, max, step]. The creation gesture is in
// input.js (GESTURES); 'create' here names it so the panel and the gesture
// table cannot disagree (a test walks both).
export const PRIMS = {
  sphere:    { label: 'Sphere',    group: 'standard', create: 'radius',   params: [['r', 'RADIUS', 1, 0.01, 50, 0.01]] },
  box:       { label: 'Box',       group: 'standard', create: 'boxfoot',  params: [['w', 'LENGTH', 2, 0.01, 100, 0.01], ['h', 'HEIGHT', 2, 0.01, 100, 0.01], ['d', 'WIDTH', 2, 0.01, 100, 0.01]] },
  cylinder:  { label: 'Cylinder',  group: 'standard', create: 'radiusH',  params: [['r', 'RADIUS', 0.8, 0.01, 50, 0.01], ['h', 'HEIGHT', 2, 0.01, 100, 0.01]] },
  cone:      { label: 'Cone',      group: 'standard', create: 'cone',     params: [['r1', 'RADIUS 1', 1, 0, 50, 0.01], ['r2', 'RADIUS 2', 0.25, 0, 50, 0.01], ['h', 'HEIGHT', 2, 0.01, 100, 0.01]] },
  torus:     { label: 'Torus',     group: 'standard', create: 'torus',    params: [['R', 'RADIUS 1', 1, 0.01, 50, 0.01], ['r', 'RADIUS 2', 0.3, 0.005, 50, 0.005]] },
  plane:     { label: 'Plane',     group: 'standard', create: 'click',    params: [['s', 'SIZE', 4, 0.1, 100, 0.1]] },
  roundbox:  { label: 'RoundBox',  group: 'extended', create: 'boxfoot',  params: [['w', 'LENGTH', 2, 0.01, 100, 0.01], ['h', 'HEIGHT', 2, 0.01, 100, 0.01], ['d', 'WIDTH', 2, 0.01, 100, 0.01], ['r', 'FILLET', 0.2, 0, 50, 0.005]] },
  capsule:   { label: 'Capsule',   group: 'extended', create: 'radiusH',  params: [['r', 'RADIUS', 0.5, 0.01, 50, 0.01], ['h', 'HEIGHT', 1.5, 0, 100, 0.01]] },
  octa:      { label: 'Octa',      group: 'extended', create: 'radius',   params: [['s', 'SIZE', 1, 0.01, 50, 0.01]] },
  link:      { label: 'Link',      group: 'extended', create: 'link',     params: [['le', 'LENGTH', 0.5, 0, 50, 0.01], ['R', 'RADIUS 1', 0.6, 0.01, 50, 0.01], ['r', 'RADIUS 2', 0.18, 0.005, 50, 0.005]] },
  hexprism:  { label: 'HexPrism',  group: 'extended', create: 'radiusH',  params: [['r', 'RADIUS', 0.8, 0.01, 50, 0.01], ['h', 'HEIGHT', 2, 0.01, 100, 0.01]] },
  ellipsoid: { label: 'Ellipsoid', group: 'extended', create: 'boxfoot',  params: [['rx', 'RADIUS X', 1.2, 0.01, 50, 0.01], ['ry', 'RADIUS Y', 0.8, 0.01, 50, 0.01], ['rz', 'RADIUS Z', 0.6, 0.01, 50, 0.01]] },
};
export const PRIM_TYPES = Object.keys(PRIMS);

// Modifiers. 'kind' says what the modifier acts on: 'domain' warps the point
// before the shape below it is evaluated, 'dist' changes the distance after.
export const MODS = {
  round:    { label: 'Round',    kind: 'dist',   params: [['r', 'RADIUS', 0.1, 0, 10, 0.005]] },
  onion:    { label: 'Shell',    kind: 'dist',   params: [['t', 'THICKNESS', 0.05, 0.001, 10, 0.005]] },
  twist:    { label: 'Twist',    kind: 'domain', params: [['k', 'ANGLE / UNIT', 0.8, -20, 20, 0.01]] },
  bend:     { label: 'Bend',     kind: 'domain', params: [['k', 'ANGLE / UNIT', 0.3, -10, 10, 0.01]] },
  elongate: { label: 'Elongate', kind: 'domain', params: [['x', 'X', 0.5, 0, 50, 0.01], ['y', 'Y', 0, 0, 50, 0.01], ['z', 'Z', 0, 0, 50, 0.01]] },
  repeat:   { label: 'Repeat',   kind: 'domain', params: [['s', 'SPACING', 2, 0.01, 100, 0.01], ['nx', 'COPIES X', 2, 0, 16, 1], ['ny', 'COPIES Y', 0, 0, 16, 1], ['nz', 'COPIES Z', 0, 0, 16, 1]] },
  mirror:   { label: 'Mirror',   kind: 'domain', params: [['x', 'MIRROR X', 1, 0, 1, 1], ['y', 'MIRROR Y', 0, 0, 1, 1], ['z', 'MIRROR Z', 0, 0, 1, 1], ['off', 'OFFSET', 0, -50, 50, 0.01]] },
  displace: { label: 'Displace', kind: 'dist',   params: [['a', 'AMOUNT', 0.06, -2, 2, 0.005], ['f', 'FREQUENCY', 3, 0.05, 50, 0.05]] },
};
export const MOD_TYPES = Object.keys(MODS);

export const OPS = { union: 'Union', subtract: 'Subtract', intersect: 'Intersect' };
export const GROUP_PARAMS = [['k', 'BLEND K', 0.3, 0.001, 10, 0.005]];
export const MAT_DEFAULT = () => ({ color: [0.78, 0.78, 0.80], rough: 0.45, metal: 0 });

const defaults = rows => Object.fromEntries(rows.map(r => [r[0], r[2]]));
const LABEL = { union: 'Union', subtract: 'Subtract', intersect: 'Intersect' };

// ── creation and lookup ─────────────────────────────────────────────────────
export function newDoc() { return { version: 1, nextId: 1, counters: {}, roots: [], nodes: {} }; }

// Forge names objects Box001, Sphere002 and so on, with ONE running counter so
// the number also tells the creation order across kinds.
function autoName(doc, label) {
  doc.counters.all = (doc.counters.all || 0) + 1;
  return label + String(doc.counters.all).padStart(3, '0');
}
function baseNode(doc, kind, type, label) {
  const id = doc.nextId++;
  return { id, kind, type, name: autoName(doc, label), hidden: false, pos: [0, 0, 0], rot: [0, 0, 0], scl: [1, 1, 1], mods: [] };
}
export function makePrim(doc, type, over = {}) {
  const T = PRIMS[type];
  if (!T) throw new Error('unknown primitive ' + type);
  const n = baseNode(doc, 'prim', type, T.label);
  n.p = defaults(T.params); n.mat = MAT_DEFAULT();
  return deepAssign(n, over);
}
export function makeGroup(doc, op = 'union', smooth = false, over = {}) {
  const n = baseNode(doc, 'group', 'group', (smooth ? 'Smooth' : '') + LABEL[op]);
  n.op = op; n.smooth = smooth; n.p = { k: 0.3 }; n.children = [];
  return deepAssign(n, over);
}
export function makeMod(doc, type, over = {}) {
  const T = MODS[type];
  if (!T) throw new Error('unknown modifier ' + type);
  return { id: doc.nextId++, type, on: true, p: { ...defaults(T.params), ...(over.p || {}) } };
}
function deepAssign(n, over) {
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && n[k] && typeof n[k] === 'object' && !Array.isArray(n[k])) Object.assign(n[k], v);
    else n[k] = Array.isArray(v) ? v.slice() : v;
  }
  return n;
}

export const node = (doc, id) => doc.nodes[id];
export function parentOf(doc, id) {
  for (const n of Object.values(doc.nodes)) if (n.kind === 'group' && n.children.includes(id)) return n;
  return null;
}
export const siblings = (doc, id) => { const p = parentOf(doc, id); return p ? p.children : doc.roots; };

// Insert a node (and nothing else) under parent at index. parent null is the root.
export function addNode(doc, n, parentId = null, index = -1) {
  doc.nodes[n.id] = n;
  const list = parentId == null ? doc.roots : doc.nodes[parentId].children;
  if (index < 0 || index > list.length) list.push(n.id); else list.splice(index, 0, n.id);
  return n;
}
// Remove a node and its subtree. Returns the removed ids.
export function removeNode(doc, id) {
  const list = siblings(doc, id), i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
  const gone = [];
  walk(doc, id, n => { gone.push(n.id); });
  gone.forEach(g => delete doc.nodes[g]);
  return gone;
}
export function isDescendant(doc, id, ofId) {
  let hit = false;
  walk(doc, ofId, n => { if (n.id === id && n.id !== ofId) hit = true; });
  return hit;
}
// Move a node to a new parent and index. A group cannot move into itself.
export function moveNode(doc, id, parentId = null, index = -1) {
  if (parentId != null && (parentId === id || isDescendant(doc, parentId, id))) return false;
  const from = siblings(doc, id), i = from.indexOf(id);
  from.splice(i, 1);
  const to = parentId == null ? doc.roots : doc.nodes[parentId].children;
  if (to === from && index > i) index--;
  if (index < 0 || index > to.length) to.push(id); else to.splice(index, 0, id);
  return true;
}
export function walk(doc, id, fn, depth = 0) {
  const n = doc.nodes[id];
  if (!n) return;
  fn(n, depth);
  if (n.kind === 'group') n.children.forEach(c => walk(doc, c, fn, depth + 1));
}
export function depthFirst(doc) {
  const out = [];
  doc.roots.forEach(r => walk(doc, r, (n, d) => out.push({ n, depth: d })));
  return out;
}

// ── compound operations ─────────────────────────────────────────────────────
// Wrap nodes in a new boolean group. The nodes move under the parent of the
// first one, in the given order (the order is the blend order). The group sits
// at the centre of their bounds, so its gizmo lands on what it holds.
export function groupNodes(doc, ids, op = 'union', smooth = false, k = 0.3) {
  ids = ids.filter(id => doc.nodes[id]);
  // drop ids that sit inside another listed id
  ids = ids.filter(id => !ids.some(o => o !== id && isDescendant(doc, id, o)));
  if (!ids.length) return null;
  const par = parentOf(doc, ids[0]), list = par ? par.children : doc.roots;
  const at = list.indexOf(ids[0]);
  const parW = par ? worldMatrix(doc, par.id) : M.M4I();
  const parInv = M.m4inv(parW);
  // centre in the parent's frame
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const id of ids) {
    const b = worldBounds(doc, id);
    if (!b) continue;
    for (const c of corners(b)) { const q = M.m4vec(parInv, c); lo = lo.map((v, j) => Math.min(v, q[j])); hi = hi.map((v, j) => Math.max(v, q[j])); }
  }
  const ctr = isFinite(lo[0]) ? lo.map((v, j) => +((v + hi[j]) / 2).toFixed(4)) : [0, 0, 0];
  const g = makeGroup(doc, op, smooth, { p: { k } });
  g.pos = ctr;
  // world matrices before the move, so each child keeps its place
  const keep = ids.map(id => [id, worldMatrix(doc, id), parentOf(doc, id)]);
  for (const id of ids) { const l = siblings(doc, id); l.splice(l.indexOf(id), 1); }
  doc.nodes[g.id] = g;
  list.splice(Math.min(at, list.length), 0, g.id);
  const gInv = M.m4inv(M.m4mul(parW, M.trs(ctr, [0, 0, 0], [1, 1, 1])));
  for (const [id, W, p] of keep) {
    g.children.push(id);
    const n = doc.nodes[id];
    // same parent: the group adds a pure translation, so subtract it exactly
    if (p === par) n.pos = M.sub(n.pos, ctr);
    else Object.assign(n, decompose(M.m4mul(gInv, W)));
  }
  return g;
}
// Replace a group by its children. The group transform is baked into each child.
export function ungroup(doc, id) {
  const g = doc.nodes[id];
  if (!g || g.kind !== 'group') return [];
  const par = parentOf(doc, id), list = par ? par.children : doc.roots;
  const at = list.indexOf(id);
  const G = M.trs(g.pos, g.rot, g.scl);
  const kids = g.children.slice();
  for (const c of kids) {
    const n = doc.nodes[c];
    const W = M.m4mul(G, M.trs(n.pos, n.rot, n.scl));
    Object.assign(n, decompose(W));
    // a group's distance modifiers do not pass to the children; it is a choice the user makes
  }
  list.splice(at, 1, ...kids);
  delete doc.nodes[id];
  return kids;
}
// Decompose an affine matrix to pos, Euler and scale. Exact unless the matrix
// carries shear (a non-uniform parent with a rotated child, Forge decision 5).
export function decompose(W) {
  const c = [0, 1, 2].map(i => [W[i * 4], W[i * 4 + 1], W[i * 4 + 2]]);
  const s = c.map(M.len);
  const R = [...M.scale(c[0], 1 / s[0]), ...M.scale(c[1], 1 / s[1]), ...M.scale(c[2], 1 / s[2])];
  const r = M.m3ToEuler(R);
  const f = x => +x.toFixed(6);
  return { pos: [W[12], W[13], W[14]].map(f), rot: r.map(f), scl: s.map(f) };
}
// Deep copy a subtree with fresh ids and names. Returns the new root node.
export function duplicate(doc, id, offset = [0, 0, 0]) {
  const src = doc.nodes[id];
  if (!src) return null;
  const copy = (n) => {
    const T = n.kind === 'group' ? null : PRIMS[n.type];
    const c = JSON.parse(JSON.stringify(n));
    c.id = doc.nextId++;
    c.name = autoName(doc, n.kind === 'group' ? (n.smooth ? 'Smooth' : '') + LABEL[n.op] : T.label);
    c.mods = c.mods.map(m => ({ ...m, id: doc.nextId++ }));
    doc.nodes[c.id] = c;
    if (n.kind === 'group') c.children = n.children.map(k => copy(doc.nodes[k]).id);
    return c;
  };
  const c = copy(src);
  c.pos = M.add(c.pos, offset);
  const list = siblings(doc, id);
  list.splice(list.indexOf(id) + 1, 0, c.id);
  return c;
}

// ── modifiers ───────────────────────────────────────────────────────────────
export function addMod(doc, id, type, index = -1) {
  const n = doc.nodes[id], m = makeMod(doc, type);
  if (index < 0 || index > n.mods.length) n.mods.push(m); else n.mods.splice(index, 0, m);
  return m;
}
export function removeMod(doc, id, modId) {
  const n = doc.nodes[id], i = n.mods.findIndex(m => m.id === modId);
  if (i >= 0) n.mods.splice(i, 1);
  return i;
}
export function moveMod(doc, id, modId, dir) {
  const n = doc.nodes[id], i = n.mods.findIndex(m => m.id === modId), j = i + dir;
  if (i < 0 || j < 0 || j >= n.mods.length) return false;
  [n.mods[i], n.mods[j]] = [n.mods[j], n.mods[i]];
  return true;
}

// ── paths ───────────────────────────────────────────────────────────────────
// 'p.r', 'pos.1', 'mat.color.0', 'mods.<modId>.p.k', 'name', 'hidden'
function resolve(n, path) {
  const ks = path.split('.');
  let o = n, i = 0;
  while (i < ks.length - 1) {
    if (ks[i] === 'mods') { o = o.mods.find(m => m.id === +ks[i + 1]); i += 2; }
    else { o = o[ks[i]]; i++; }
    if (o == null) return null;
  }
  return { o, k: ks[ks.length - 1] };
}
export function getPath(doc, id, path) {
  const n = doc.nodes[id]; if (!n) return undefined;
  const r = resolve(n, path); if (!r) return undefined;
  const v = r.o[r.k];
  return Array.isArray(v) ? v.slice() : v;
}
export function setPath(doc, id, path, value) {
  const n = doc.nodes[id]; if (!n) return false;
  const r = resolve(n, path); if (!r) return false;
  r.o[r.k] = Array.isArray(value) ? value.slice() : value;
  return true;
}
// Does a change to this path change the shader (structure) or only the params?
export function isStructural(path) {
  return path === 'hidden' || path === 'op' || path === 'smooth' || /^mods\.\d+\.on$/.test(path);
}

// ── transforms and bounds ───────────────────────────────────────────────────
export const localMatrix = n => M.trs(n.pos, n.rot, n.scl);
export function worldMatrix(doc, id) {
  let W = M.M4I(), n = doc.nodes[id];
  const chain = [];
  while (n) { chain.unshift(n); n = parentOf(doc, n.id); }
  for (const c of chain) W = M.m4mul(W, localMatrix(c));
  return W;
}
export const parentMatrix = (doc, id) => { const p = parentOf(doc, id); return p ? worldMatrix(doc, p.id) : M.M4I(); };

export function corners(b) {
  const out = [];
  for (let i = 0; i < 8; i++) out.push([i & 1 ? b.hi[0] : b.lo[0], i & 2 ? b.hi[1] : b.lo[1], i & 4 ? b.hi[2] : b.lo[2]]);
  return out;
}
const box = (x, y, z) => ({ lo: [-x, -y, -z], hi: [x, y, z] });
const grow = (b, r) => ({ lo: b.lo.map(v => v - r), hi: b.hi.map(v => v + r) });
const absMax = (b, j) => Math.max(Math.abs(b.lo[j]), Math.abs(b.hi[j]));

// The shape's extent in its own frame, before modifiers.
export function primBounds(n) {
  const p = n.p;
  switch (n.type) {
    case 'sphere': return box(p.r, p.r, p.r);
    case 'box': case 'roundbox': return box(p.w / 2, p.h / 2, p.d / 2);
    case 'cylinder': return box(p.r, p.h / 2, p.r);
    case 'cone': { const r = Math.max(p.r1, p.r2); return box(r, p.h / 2, r); }
    case 'torus': return box(p.R + p.r, p.r, p.R + p.r);
    case 'plane': return { lo: [-p.s / 2, -0.001, -p.s / 2], hi: [p.s / 2, 0, p.s / 2], infinite: true };
    case 'capsule': return box(p.r, p.h / 2 + p.r, p.r);
    case 'octa': return box(p.s, p.s, p.s);
    case 'link': return box(p.R + p.r, p.le + p.R + p.r, p.r);
    case 'hexprism': { const c = p.r * 1.1547006; return box(c, p.h / 2, c); }
    case 'ellipsoid': return box(p.rx, p.ry, p.rz);
  }
  return box(1, 1, 1);
}
// Apply one modifier to a local bound. Conservative: the shape stays inside.
export function modBounds(b, m) {
  if (!m.on) return b;
  const p = m.p;
  switch (m.type) {
    case 'round': return grow(b, Math.max(0, p.r));
    case 'onion': return grow(b, Math.max(0, p.t));
    case 'displace': return grow(b, Math.abs(p.a));
    case 'elongate': return { lo: [b.lo[0] - p.x, b.lo[1] - p.y, b.lo[2] - p.z], hi: [b.hi[0] + p.x, b.hi[1] + p.y, b.hi[2] + p.z] };
    case 'twist': { const r = Math.hypot(absMax(b, 0), absMax(b, 2)); return { lo: [-r, b.lo[1], -r], hi: [r, b.hi[1], r] }; }
    case 'bend': { const r = Math.hypot(absMax(b, 0), absMax(b, 1)); return { lo: [-r, -r, b.lo[2]], hi: [r, r, b.hi[2]] }; }
    case 'repeat': {
      const n = [p.nx, p.ny, p.nz].map(v => Math.max(0, Math.round(v)));
      return { lo: b.lo.map((v, j) => v - p.s * n[j]), hi: b.hi.map((v, j) => v + p.s * n[j]) };
    }
    case 'mirror': {
      const f = [p.x, p.y, p.z], o = { lo: b.lo.slice(), hi: b.hi.slice() };
      for (let j = 0; j < 3; j++) if (f[j] >= 0.5) { const e = Math.max(0, b.hi[j] + p.off); o.lo[j] = -e; o.hi[j] = e; }
      return o;
    }
  }
  return b;
}
// Local bounds of a node, modifiers included. null when it holds nothing visible.
export function localBounds(doc, id) {
  const n = doc.nodes[id];
  if (!n || n.hidden) return null;
  let b;
  if (n.kind === 'prim') b = primBounds(n);
  else {
    const kids = n.children.map(c => {
      const cb = localBounds(doc, c);
      return cb && transformBounds(cb, localMatrix(doc.nodes[c]));
    });
    const live = kids.filter(Boolean);
    if (!live.length) return null;
    if (n.op === 'subtract') b = kids[0] || null;
    else if (n.op === 'intersect') {
      if (live.length !== kids.length) b = live[0];
      else b = live.reduce((a, c) => ({ lo: a.lo.map((v, j) => Math.max(v, c.lo[j])), hi: a.hi.map((v, j) => Math.min(v, c.hi[j])) }));
    } else b = live.reduce((a, c) => ({ lo: a.lo.map((v, j) => Math.min(v, c.lo[j])), hi: a.hi.map((v, j) => Math.max(v, c.hi[j])) }));
    if (!b) return null;
    if (n.smooth && n.op === 'union') b = grow(b, n.p.k * 0.25);
  }
  for (const m of n.mods) b = modBounds(b, m);
  return b;
}
// Decision 16: a box is eight corners, not two.
export function transformBounds(b, W) {
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const c of corners(b)) { const q = M.m4vec(W, c); lo = lo.map((v, j) => Math.min(v, q[j])); hi = hi.map((v, j) => Math.max(v, q[j])); }
  return { lo, hi };
}
export function worldBounds(doc, id) {
  const b = localBounds(doc, id);
  return b ? transformBounds(b, worldMatrix(doc, id)) : null;
}
export function docBounds(doc) {
  let out = null;
  for (const r of doc.roots) {
    const b = worldBounds(doc, r);
    if (!b) continue;
    out = out ? { lo: out.lo.map((v, j) => Math.min(v, b.lo[j])), hi: out.hi.map((v, j) => Math.max(v, b.hi[j])) } : b;
  }
  return out;
}

// ── files ───────────────────────────────────────────────────────────────────
export const toJSON = doc => JSON.stringify(doc);
export function fromJSON(text) {
  const d = typeof text === 'string' ? JSON.parse(text) : JSON.parse(JSON.stringify(text));
  const err = validate(d);
  if (err) throw new Error('not an SDF Forge document: ' + err);
  // JSON object keys are strings; ids are numbers
  const nodes = {};
  for (const n of Object.values(d.nodes)) nodes[n.id] = n;
  d.nodes = nodes;
  return d;
}
export function validate(d) {
  if (!d || typeof d !== 'object') return 'not an object';
  if (d.version !== 1) return 'version';
  if (!Array.isArray(d.roots) || typeof d.nodes !== 'object') return 'roots or nodes';
  const seen = new Set();
  const ok3 = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  const check = id => {
    const n = d.nodes[id];
    if (!n) return 'missing node ' + id;
    if (seen.has(id)) return 'node used twice ' + id;
    seen.add(id);
    if (!ok3(n.pos) || !ok3(n.rot) || !ok3(n.scl)) return 'transform of ' + id;
    if (!Array.isArray(n.mods) || n.mods.some(m => !MODS[m.type])) return 'modifiers of ' + id;
    if (n.kind === 'prim') { if (!PRIMS[n.type]) return 'type of ' + id; }
    else if (n.kind === 'group') {
      if (!OPS[n.op] || !Array.isArray(n.children)) return 'group ' + id;
      for (const c of n.children) { const e = check(c); if (e) return e; }
    } else return 'kind of ' + id;
    return null;
  };
  for (const r of d.roots) { const e = check(r); if (e) return e; }
  return null;
}
