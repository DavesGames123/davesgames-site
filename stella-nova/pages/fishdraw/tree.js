// ============================================================================
//  FISHDRAW  ·  tree.js — a seeded tree of life of fake fish (no DOM)
// ----------------------------------------------------------------------------
//  Our own code around fishdraw by Lingdong Huang (MIT, LICENSE-fishdraw.txt).
//  The upstream engine is not changed. This module makes a phylogeny of
//  generate_params() sets. The worker pool draws each node with the upstream
//  fish(), so every node and every tip is a real fishdraw fish.
//
//  MODEL. buildTree() runs a birth-death process in time 0..T_MAX:
//    1. Topology. Each living lineage splits with rate lambda (speciation)
//       and ends with rate mu (extinction). The first event is always a
//       split. At the tip cap, lambda is 0. A radiation gives one daughter
//       lineage 4x lambda for RAD_SPAN time units (a burst of splits).
//       At T_MAX each living lineage becomes a tip. A run with fewer than
//       three living tips runs again (same PRNG stream).
//    2. Traits. drift() moves the params of the parent along each branch:
//       a random walk whose step grows with sqrt(branch time) and with the
//       rate of the field's group (GROUP_RATES: body slow, pattern fast).
//       Enum and bool fields switch with a chance that grows with time.
//       Every value is clamped to its range and rounded to its step.
//    3. Names. The root keeps its name. A node founds a new genus when its
//       params differ from the founder of its genus by more than GENUS_D
//       (paramDistance). Other nodes keep the genus. The species name
//       comes from the upstream binomen() tables (randomName), so names
//       read like upstream names, and a clade shares a genus.
//  The same options and seed give the same tree (mulberry32 only).
//
//  LAYOUT. layoutTree() places the nodes in a box of w x h mm at (ox, oy):
//    clado   time (or change) on x, one row per tip; elbow branches
//    radial  time on the radius, tips round a full circle; arc branches
//    fan     a half circle that opens upward, root at the base
//  Each tip gets a fish box (5:3). Tip boxes never overlap: clado gives
//  each tip its own row, and the radial layouts space tips so that the
//  centre distance is more than the box diagonal (tests.mjs checks it).
//
//  GREP MAP
//    grep -n 'export function buildTree'    topology, traits, names
//    grep -n 'export function drift'        the trait random walk
//    grep -n 'export function layoutTree'   the three layouts
//    grep -n 'export function paramChanges' the changes on a lineage
//    grep -n 'export function lineage'      root to node
//    grep -n 'export function cladeName'    a family name from a genus
// ============================================================================
import { PARAMS, PARAM_BY_KEY, sanitize, roundTo, mulberry, randomName } from './engine.js';

export const T_MAX = 100;
export const MA_PER_T = 4.6;          // made-up millions of years per time unit
export const RAD_SPAN = 18;
export const GENUS_D = 0.2;
export const TIP_CAP = 64;
// Relative drift speed of each param group.
export const GROUP_RATES = { body: 0.35, skin: 1.6, dorsal: 0.8, wing: 0.8, pelvic: 0.7, anal: 0.7, tail: 0.9, head: 0.55, eye: 0.7, whisk: 1.1 };
const ERA_POOL = ['Squamian', 'Pinnozoic', 'Branchian', 'Caudal', 'Opercular', 'Neoichthyan', 'Hadalian', 'Lateral', 'Spiracular', 'Radian'];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function gauss(rnd) {
  const u = Math.max(1e-9, rnd()), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ── drift ───────────────────────────────────────────────────────────────────
// p moved along a branch of dt time units at mutation rate `rate`.
export function drift(p, dt, rate, rnd) {
  const o = Object.assign({}, p), f = Math.max(0, dt) / T_MAX;
  for (const d of PARAMS) {
    const g = (GROUP_RATES[d.group] || 1) * rate;
    if (d.kind === 'float' || d.kind === 'int') {
      const sd = 0.35 * (d.max - d.min) * g * Math.sqrt(f);
      o[d.key] = roundTo(clamp(+o[d.key] + gauss(rnd) * sd, d.min, d.max), d.step);
    } else {
      const chance = 1 - Math.exp(-g * f * 0.9);
      if (rnd() < chance) o[d.key] = d.kind === 'bool' ? (o[d.key] ? 0 : 1) : Math.floor(rnd() * d.opts.length);
    }
  }
  return sanitize(o);
}

// Mean change per field, 0..1: a numeric field adds |delta| / range, an
// enum or bool field adds 1 when it differs.
export function paramDistance(a, b) {
  let s = 0;
  for (const d of PARAMS) {
    if (d.kind === 'float' || d.kind === 'int') s += Math.abs(a[d.key] - b[d.key]) / (d.max - d.min);
    else s += a[d.key] === b[d.key] ? 0 : 1;
  }
  return s / PARAMS.length;
}

// ── buildTree ───────────────────────────────────────────────────────────────
// o = { E, rootName, rootParams, seed, mut, spec, ext, maxTips, radiations }
// Returns { nodes, root, tips, eras, seed, opts }. A node:
//   { id, parent, children, t, kind ('root'|'split'|'tip'|'extinct'),
//     params, name, genus, change, radiation, depth }
export function buildTree(o) {
  const E = o.E, rnd = mulberry((o.seed >>> 0) || 1);
  const mut = o.mut ?? 1, spec = o.spec ?? 1, ext = o.ext ?? 1;
  const maxTips = clamp(Math.round(o.maxTips ?? 24), 2, TIP_CAP);
  const lam0 = 0.04 * spec, mu0 = 0.012 * ext;
  let nodes = [];
  const mk = (parent, t, kind) => {
    const n = { id: nodes.length, parent: parent ? parent.id : -1, children: [], t, kind, depth: parent ? parent.depth + 1 : 0, radiation: false };
    if (parent) parent.children.push(n.id);
    nodes.push(n);
    return n;
  };
  // A run that leaves fewer than three living tips (or maxTips, if less)
  // runs again from the same PRNG stream, at most 12 times.
  let root;
  for (let attempt = 0; attempt < 12; attempt++) {
    nodes = [];
    root = topology();
    if (nodes.filter(q => q.kind === 'tip').length >= Math.min(3, maxTips)) break;
  }
  function topology() {
  const root = mk(null, 0, 'root');
  // The first event: a split soon after the root.
  const first = mk(root, 2 + rnd() * 6, 'split');
  let lineages = [{ from: first, mult: 1, until: -1 }, { from: first, mult: 1, until: -1 }];
  let time = first.t;
  for (let guard = 0; guard < 5000; guard++) {
    const alive = lineages.length;
    const lam = lineages.map(l => (alive >= maxTips ? 0 : lam0 * (l.until > time ? l.mult : 1)));
    const mu = alive > 1 ? mu0 : 0;
    const total = lam.reduce((a, b) => a + b, 0) + mu * alive;
    if (total <= 0) break;
    const dt = -Math.log(Math.max(1e-12, rnd())) / total;
    if (time + dt >= T_MAX) break;
    time += dt;
    let r = rnd() * total, i = 0;
    for (; i < alive - 1; i++) { r -= lam[i] + mu; if (r <= 0) break; }
    const l = lineages[i];
    const isSplit = rnd() * (lam[i] + mu) < lam[i];
    lineages.splice(i, 1);
    if (isSplit) {
      const n = mk(l.from, time, 'split');
      const a = { from: n, mult: l.mult, until: l.until }, b = { from: n, mult: l.mult, until: l.until };
      if (o.radiations !== false && l.until <= time && rnd() < 0.14) { a.mult = 4; a.until = time + RAD_SPAN; n.radiation = true; }
      lineages.push(a, b);
    } else mk(l.from, time, 'extinct');
  }
  for (const l of lineages) mk(l.from, T_MAX, 'tip');
  return root;
  }

  // Traits, in creation order (a parent is always made before its child).
  root.params = sanitize(Object.assign({}, o.rootParams));
  root.change = 0;
  for (const n of nodes) {
    if (n === root) continue;
    const p = nodes[n.parent];
    n.params = drift(p.params, n.t - p.t, mut, rnd);
    n.change = p.change + paramDistance(n.params, p.params);
  }
  // Names. The genus founder is the first node of each genus.
  const used = new Set();
  const u32 = () => (rnd() * 4294967295) >>> 0;
  const parts = s => String(s).trim().split(/\s+/);
  root.name = String(o.rootName).trim();
  root.genus = parts(root.name)[0] || 'Pisces';
  root.founder = root.id;
  used.add(root.name);
  for (const n of nodes) {
    if (n === root) continue;
    const p = nodes[n.parent];
    const f = nodes[p.founder];
    if (n.kind !== 'tip' && n.kind !== 'extinct' && paramDistance(n.params, f.params) > GENUS_D) {
      n.genus = parts(randomName(E, u32()))[0]; n.founder = n.id;
    } else if ((n.kind === 'tip' || n.kind === 'extinct') && paramDistance(n.params, f.params) > GENUS_D * 1.4) {
      n.genus = parts(randomName(E, u32()))[0]; n.founder = n.id;
    } else { n.genus = p.genus; n.founder = p.founder; }
    let name = '';
    for (let k = 0; k < 20 && (!name || used.has(name)); k++) name = n.genus + ' ' + (parts(randomName(E, u32()))[1] || 'novus');
    n.name = name; used.add(name);
  }
  // Eras: five made-up periods with seeded bounds.
  const names = ERA_POOL.slice();
  for (let i = names.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [names[i], names[j]] = [names[j], names[i]]; }
  const cuts = [0];
  for (let i = 0; i < 4; i++) cuts.push(cuts[i] + 0.12 + rnd() * 0.16);
  const scale = T_MAX / (cuts[4] + 0.12 + rnd() * 0.16);
  const eras = names.slice(0, 5).map((nm, i) => ({ name: nm, t0: cuts[i] * scale, t1: i < 4 ? cuts[i + 1] * scale : T_MAX }));
  const tips = nodes.filter(n => !n.children.length).map(n => n.id);
  return { nodes, root: 0, tips, eras, seed: o.seed >>> 0, opts: { mut, spec, ext, maxTips, radiations: o.radiations !== false } };
}

export function lineage(tree, id) {
  const out = [];
  for (let n = tree.nodes[id]; n; n = n.parent >= 0 ? tree.nodes[n.parent] : null) out.push(n.id);
  return out.reverse();
}
// The fields that differ between params a and b, largest change first:
// [{ key, label, from, to, d }], d is the change / range (1 for enums).
export function paramChanges(a, b) {
  const out = [];
  for (const d of PARAMS) {
    const x = a[d.key], y = b[d.key];
    if (x === y) continue;
    const num = d.kind === 'float' || d.kind === 'int';
    const show = v => (num ? String(roundTo(v, d.kind === 'int' ? 1 : d.step >= 1 ? 1 : 0.01)) : d.kind === 'bool' ? (v ? 'on' : 'off') : d.opts[v]);
    out.push({ key: d.key, label: d.label, group: d.group, from: show(x), to: show(y), d: num ? Math.abs(y - x) / (d.max - d.min) : 1 });
  }
  return out.sort((p, q) => q.d - p.d);
}
// "Colidae" from "Colus": a family name for a clade label.
export function cladeName(genus) {
  const g = String(genus || 'Pisc');
  return g.replace(/(us|a|is|es|on|um|ys|os|ax|er|ia|ii|as)$/i, '') + 'idae';
}
// Made-up "millions of years ago" for a time t.
export const maAgo = t => Math.round((T_MAX - t) * MA_PER_T);
export const PARAM_LABEL = k => (PARAM_BY_KEY[k] || {}).label || k;

// ── layoutTree ──────────────────────────────────────────────────────────────
// kind 'clado' | 'radial' | 'fan'; o = { w, h, ox, oy, xMode ('time' |
// 'change'), axis (bool) }. Returns
//   { kind, pos: [{ x, y, a? }], branch: [{ elbow: [[x,y],..], run: [[x,y],[x,y]] }],
//     fish: [{ x, y, w, h } | null], tip: { w, h }, cx, cy, r: (t) => radius,
//     xOf: (v) => x, axisY, top, bottom }
// pos and fish are in mm. branch[id] runs from the parent to node id:
// elbow is drawn as soon as the parent exists, run grows with time.
export function layoutTree(tree, kind, o) {
  const { nodes } = tree, n = tree.tips.length;
  const W = o.w, H = o.h, OX = o.ox || 0, OY = o.oy || 0;
  const maxC = Math.max(1e-9, ...nodes.map(q => q.change));
  const val = q => (o.xMode === 'change' ? q.change / maxC * T_MAX : q.t);
  // Tip order: depth-first, children in creation order.
  const order = [], slot = new Array(nodes.length);
  (function walk(id) { const q = nodes[id]; if (!q.children.length) { slot[id] = order.length; order.push(id); } q.children.forEach(walk); })(tree.root);
  const pos = new Array(nodes.length), fish = new Array(nodes.length).fill(null), branch = new Array(nodes.length).fill(null);
  const out = { kind, pos, fish, branch, order };
  // Children-first walk for internal positions.
  const post = [];
  (function walk(id) { nodes[id].children.forEach(walk); post.push(id); })(tree.root);

  if (kind === 'clado') {
    const axisH = o.axis === false ? 0 : Math.min(H * 0.1, 14);
    const top = H * 0.02, rowH = (H - axisH - top) / Math.max(1, n);
    // Living tips sit in two staggered columns when the rows are thin, so
    // a fish can be 1.6 rows high: two living tips in one column are at
    // least two rows apart. Extinct tips get a small box of 0.74 rows,
    // left of the first column.
    const stagger = rowH * 0.74 < H * 0.07 && n > 6;
    let fh = Math.min(rowH * (stagger ? 1.5 : 0.74), H * 0.2), fw = fh * 5 / 3;
    if (fw > W * (stagger ? 0.15 : 0.24)) { fw = W * (stagger ? 0.15 : 0.24); fh = fw * 0.6; }
    const eh = Math.min(fh, rowH * 0.74), ew = eh * 5 / 3;
    const gap = fw * 0.04, cols = stagger ? 2.05 : 1;
    const x0 = W * 0.03 + fw * 0.2, x1 = W - fw * cols - gap - W * 0.01;
    const xOf = v => OX + x0 + v / T_MAX * (x1 - x0);
    for (const id of post) {
      const q = nodes[id];
      if (!q.children.length) { pos[id] = { x: xOf(val(q)), y: OY + top + (slot[id] + 0.5) * rowH }; continue; }
      const ys = q.children.map(c => pos[c].y);
      pos[id] = { x: xOf(val(q)), y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    }
    let li = 0;
    for (const id of order) {
      const q = nodes[id], p = pos[id];
      if (q.kind === 'extinct' && o.xMode !== 'change') {
        fish[id] = { x: Math.min(p.x + gap, xOf(T_MAX) - ew - gap), y: p.y - eh / 2, w: ew, h: eh };
      } else {
        const col = stagger ? (li++ % 2) : 0;
        fish[id] = { x: Math.max(p.x, xOf(T_MAX)) + gap + col * fw * 1.05, y: p.y - fh / 2, w: fw, h: fh };
      }
    }
    for (const q of nodes) {
      if (q.parent < 0) continue;
      const p = pos[q.parent], c = pos[q.id];
      branch[q.id] = { elbow: [[p.x, p.y], [p.x, c.y]], run: [[p.x, c.y], [c.x, c.y]] };
    }
    const aw = Math.min(fw * 0.5, rowH * 1.1), ah = aw * 0.6;
    for (const q of nodes) if (q.children.length) fish[q.id] = { x: pos[q.id].x - aw * 0.5, y: pos[q.id].y - ah * 1.08, w: aw, h: ah, anc: true };
    Object.assign(out, { tip: { w: fw, h: fh }, xOf, axisY: OY + H - axisH, axisH, top: OY + top, bottom: OY + H - axisH, x0: xOf(0), x1: xOf(T_MAX) });
    return out;
  }

  // radial and fan
  const fan = kind === 'fan';
  const span = fan ? Math.PI * 0.94 : Math.PI * 2;
  const a0 = fan ? Math.PI + Math.PI * 0.03 : -Math.PI / 2;
  const cx = OX + W / 2, cy = fan ? OY + H * 0.97 : OY + H / 2;
  const Rout = fan ? Math.min(W / 2, H * 0.95) : Math.min(W, H) / 2;
  const dA = span / Math.max(1, fan ? n : n);
  const angleOf = i => a0 + (fan ? (i + 0.5) : i) * dA;
  // Fish size s (box w = s, h = 0.6 s): neighbours at radius Rf = Rout -
  // 0.6 s must be more than the box diagonal (1.17 s) apart.
  let s = Rout * 0.3;
  for (let k = 0; k < 8; k++) {
    const Rf = Rout - s * 0.6;
    const chord = n > 1 ? 2 * Rf * Math.sin(Math.min(Math.PI / 2, dA / 2)) : Rout;
    s = Math.min(Rout * 0.3, chord / 1.2);
  }
  const Rf = Rout - s * 0.6, rT = Math.max(Rf * 0.25, Rf - s * 0.75), r0 = fan ? Rout * 0.04 : 0;
  const rOf = v => r0 + v / T_MAX * (rT - r0);
  for (const id of post) {
    const q = nodes[id];
    let a;
    if (!q.children.length) a = angleOf(slot[id]);
    else { const as = q.children.map(c => pos[c].a); a = (Math.min(...as) + Math.max(...as)) / 2; }
    const r = rOf(val(q));
    pos[id] = { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), a, r };
  }
  const arc = (r, a, b) => {
    const k = Math.max(2, Math.ceil(Math.abs(b - a) / 0.05)), pts = [];
    for (let i = 0; i <= k; i++) { const t = a + (b - a) * i / k; pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); }
    return pts;
  };
  for (const q of nodes) {
    const c = pos[q.id];
    if (!q.children.length) fish[q.id] = { x: cx + Rf * Math.cos(c.a) - s / 2, y: cy + Rf * Math.sin(c.a) - s * 0.3, w: s, h: s * 0.6 };
    if (q.parent >= 0) {
      const p = pos[q.parent];
      branch[q.id] = { elbow: arc(p.r, p.a, c.a), run: [[cx + p.r * Math.cos(c.a), cy + p.r * Math.sin(c.a)], [c.x, c.y]] };
    }
  }
  const as = s * 0.45;
  for (const q of nodes) if (q.children.length) fish[q.id] = { x: pos[q.id].x - as / 2, y: pos[q.id].y - as * 0.3, w: as, h: as * 0.6, anc: true };
  Object.assign(out, { tip: { w: s, h: s * 0.6 }, cx, cy, rOf, Rf, rT, fan, a0, span });
  return out;
}

// Tip fish boxes of a layout (for the overlap test and hit tests).
export function tipBoxes(tree, lay) { return tree.tips.map(id => Object.assign({ id }, lay.fish[id])); }
