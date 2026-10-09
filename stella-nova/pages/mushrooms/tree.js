// ============================================================================
//  MUSHROOM DRAW  ·  tree.js — a seeded tree of life of made-up fungi (no DOM)
// ----------------------------------------------------------------------------
//  Original code (davesgames.io). Adapted from fishdraw/tree.js on this
//  site (our own wrapper code, not the upstream fishdraw). It is a copy,
//  not an import: the fish module imports the fish engine, and a mushroom
//  box has a different shape (ASPECT). The topology and layouts follow it.
//
//  MODEL. buildTree() runs a birth-death process in time 0..T_MAX:
//    1. Topology. Each living lineage splits with rate lambda (speciation)
//       and ends with rate mu (extinction). The first event is a split. At
//       the tip cap, lambda is 0. A radiation gives one daughter lineage
//       4x lambda for RAD_SPAN time units. At T_MAX each living lineage is
//       a tip. A run with fewer than three living tips runs again.
//    2. Traits. drift() moves the engine params of the parent along each
//       branch: a random walk whose step grows with sqrt(branch time) and
//       with the rate of the group (GROUP_RATES: colour and surface fast,
//       underside slow). Hues wrap round the circle. Enum fields (profile,
//       underside, ring, texture, marks) switch with a chance that grows
//       with time; KEY_RATES makes profile and underside rare. A switch to
//       a morel or puffball gives a smooth underside, and a switch away
//       from them gives gills back. The habitat (ground, moss, grass,
//       litter) and the camera height do not drift (FIXED).
//    3. Names. Each node has an engine seed, and its name is
//       randomName(seed), the same rule as the page: the name comes from
//       the seed. A node founds a new genus when its params differ from
//       the founder of its genus by more than GENUS_D. Other nodes search
//       the seed stream for a seed whose name has the genus of the clade.
//  drawParams() is the params that the tree draws: litter, grass and moss
//  off, at most three fruit bodies, so a small mushroom stays legible.
//  The same options and seed give the same tree (mulberry only).
//
//  LAYOUT. layoutTree() places the nodes in a box of w x h mm at (ox, oy),
//  or at their natural size when o.tip (the tip box width in mm) is set:
//    clado   time (or change) on x, one row per tip; elbow branches
//    radial  time on the radius, tips round a full circle; arc branches
//    fan     a half circle that opens upward, root at the base
//  Each tip gets a box of w x ASPECT w. Tip boxes never overlap.
//
//  GREP MAP
//    grep -n 'export function buildTree'    topology, traits, names
//    grep -n 'export function drift'        the trait random walk
//    grep -n 'export function drawParams'   the params the tree draws
//    grep -n 'export function layoutTree'   the three layouts
//    grep -n 'function layoutNatural'       the screen layout
//    grep -n 'export function paramChanges' the changes on a lineage
//    grep -n 'export function lineage'      root to node
//    grep -n 'export function cladeName'    a family name (-aceae)
// ============================================================================
import { PARAMS, PARAM_BY_KEY, sanitize, roundTo, randomName } from './engine.js';
import { mulberry } from './geom.js';

export const T_MAX = 100;
export const MA_PER_T = 4.2;          // made-up millions of years per time unit
export const RAD_SPAN = 18;
export const GENUS_D = 0.13;
export const TIP_CAP = 64;
export const ASPECT = 0.8;            // tip box height / width
export const GROUP_RATES = { cap: 0.6, under: 0.45, stem: 0.7, surface: 1.0, colour: 1.2, cluster: 0.8, view: 0 };
export const KEY_RATES = { profile: 0.35, under: 0.35, ring: 0.6, stemTex: 0.7, marks: 0.7, capHue: 0.45, gillHue: 0.45, fleshHue: 0.45 };
export const FIXED = new Set(['ground', 'moss', 'grass', 'litter', 'elev']);
const MOREL = 8, PUFF = 9;
const ERA_POOL = ['Sporian', 'Hyphal', 'Mycelian', 'Lamellar', 'Basidian', 'Ascozoic', 'Rhizomorphic', 'Velar', 'Pileian', 'Stipitan'];
const DRIFTING = PARAMS.filter(d => !FIXED.has(d.key));

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const isHue = d => d.key.endsWith('Hue');
function gauss(rnd) {
  const u = Math.max(1e-9, rnd()), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ── drift ───────────────────────────────────────────────────────────────────
export function drift(p, dt, rate, rnd) {
  const o = Object.assign({}, p), f = Math.max(0, dt) / T_MAX, prof0 = o.profile;
  for (const d of DRIFTING) {
    const g = (GROUP_RATES[d.group] ?? 1) * (KEY_RATES[d.key] ?? 1) * rate;
    if (d.kind === 'float' || d.kind === 'int') {
      const sd = 0.3 * (d.max - d.min) * g * Math.sqrt(f);
      let v = +o[d.key] + gauss(rnd) * sd;
      v = isHue(d) ? ((v % 360) + 360) % 360 : clamp(v, d.min, d.max);
      o[d.key] = roundTo(v, d.step);
    } else {
      const chance = 1 - Math.exp(-g * f * 0.9);
      if (rnd() < chance) o[d.key] = d.kind === 'bool' ? (o[d.key] ? 0 : 1) : Math.floor(rnd() * d.opts.length);
    }
  }
  const special = q => q === MOREL || q === PUFF;
  if (special(o.profile)) o.under = 4;
  else if (special(prof0) && o.under === 4) o.under = 0;
  return sanitize(o);
}
// The params the tree draws: no litter, grass or moss, three bodies at most.
export function drawParams(p) {
  return Object.assign({}, p, { litter: 0, grass: 0, moss: 0, count: Math.min(3, p.count) });
}
// Mean change per drifting field, 0..1 (hue on the circle, enums 0 or 1).
export function paramDistance(a, b) {
  let s = 0;
  for (const d of DRIFTING) {
    if (d.kind === 'float' || d.kind === 'int') {
      let x = Math.abs(a[d.key] - b[d.key]);
      if (isHue(d)) x = Math.min(x, 360 - x) * 2;
      s += x / (d.max - d.min);
    } else s += a[d.key] === b[d.key] ? 0 : 1;
  }
  return s / DRIFTING.length;
}
const genusOf = name => String(name).trim().split(/\s+/)[0];

// ── buildTree ───────────────────────────────────────────────────────────────
// o = { rootParams, rootSeed, seed, mut, spec, ext, maxTips, radiations }
// Returns { nodes, root, tips, eras, seed, opts }. A node:
//   { id, parent, children, t, kind ('root'|'split'|'tip'|'extinct'),
//     params, seed, name, genus, founder, change, radiation, depth }
export function buildTree(o) {
  const rnd = mulberry((o.seed >>> 0) || 1);
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
  function topology() {
    const root = mk(null, 0, 'root');
    const first = mk(root, 2 + rnd() * 6, 'split');
    const lineages = [{ from: first, mult: 1, until: -1 }, { from: first, mult: 1, until: -1 }];
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
  let root;
  for (let attempt = 0; attempt < 12; attempt++) {
    nodes = [];
    root = topology();
    if (nodes.filter(q => q.kind === 'tip').length >= Math.min(3, maxTips)) break;
  }
  // Traits, in creation order (a parent is made before its child).
  root.params = sanitize(Object.assign({}, o.rootParams));
  root.change = 0;
  for (const n of nodes) {
    if (n === root) continue;
    const p = nodes[n.parent];
    n.params = drift(p.params, n.t - p.t, mut, rnd);
    n.change = p.change + paramDistance(n.params, p.params);
  }
  // Names: a seed per node, and the name of that seed.
  const used = new Set();
  const u32 = () => ((rnd() * 4294967295) >>> 0) || 1;
  root.seed = (o.rootSeed >>> 0) || 1;
  root.name = randomName(root.seed);
  root.genus = genusOf(root.name);
  root.founder = root.id;
  used.add(root.name);
  for (const n of nodes) {
    if (n === root) continue;
    const p = nodes[n.parent], f = nodes[p.founder];
    const lim = n.kind === 'tip' || n.kind === 'extinct' ? GENUS_D * 1.4 : GENUS_D;
    if (paramDistance(n.params, f.params) > lim) {
      // A new genus: a fresh seed whose genus is not in use.
      let s = u32();
      for (let k = 0; k < 50 && [...used].some(nm => genusOf(nm) === genusOf(randomName(s))); k++) s = u32();
      n.seed = s; n.founder = n.id;
    } else {
      // The genus of the clade: walk the seed stream until a name has it.
      // A rare genus can take a few thousand tries (well under 10 ms).
      let s = 0, base = u32();
      for (let k = 0; k < 400000; k++) {
        const c = (base + Math.imul(k, 0x9E3779B1)) >>> 0 || 1;
        const nm = randomName(c);
        if (genusOf(nm) === p.genus && !used.has(nm)) { s = c; break; }
      }
      n.seed = s || base; n.founder = s ? p.founder : n.id;
    }
    n.name = randomName(n.seed);
    n.genus = genusOf(n.name);
    used.add(n.name);
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
// The fields that differ between a and b, largest change first:
// [{ key, label, group, from, to, d }], d is the change / range (1 for enums).
export function paramChanges(a, b) {
  const out = [];
  for (const d of PARAMS) {
    const x = a[d.key], y = b[d.key];
    if (x === y) continue;
    const num = d.kind === 'float' || d.kind === 'int';
    const show = v => (num ? String(roundTo(v, d.kind === 'int' || d.step >= 1 ? 1 : 0.01)) : d.kind === 'bool' ? (v ? 'on' : 'off') : d.opts[v]);
    let dd = 1;
    if (num) { dd = Math.abs(y - x); if (isHue(d)) dd = Math.min(dd, 360 - dd) * 2; dd /= d.max - d.min; }
    out.push({ key: d.key, label: d.label, group: d.group, from: show(x), to: show(y), d: dd });
  }
  return out.sort((p, q) => q.d - p.d);
}
// A fungal family name from a genus: "Amanita" -> "Amanitaceae".
export function cladeName(genus) {
  const g = String(genus || 'Fung');
  if (/myces$/.test(g)) return g.replace(/myces$/, 'mycetaceae');
  if (/derma$/.test(g)) return g.replace(/a$/, 'ataceae');
  return g.replace(/ops$/, 'op').replace(/(us|um|a|on|is|es|e)$/, '') + 'aceae';
}
export const maAgo = t => Math.round((T_MAX - t) * MA_PER_T);
export const PARAM_LABEL = k => (PARAM_BY_KEY[k] || {}).label || k;

// ── layoutTree ──────────────────────────────────────────────────────────────
// kind 'clado' | 'radial' | 'fan'; o = { w, h, ox, oy, xMode ('time' |
// 'change'), axis } or o = { tip, ox, oy } for the natural layout.
// Returns { kind, pos: [{ x, y, a?, r? }], branch: [{ elbow, run }],
//   box: [{ x, y, w, h, anc? } | null], tip: { w, h }, order, ... } in mm.
// branch[id] runs from the parent to node id: elbow is drawn as soon as
// the parent exists, run grows with time.
export function layoutTree(tree, kind, o) {
  if (o.tip) return layoutNatural(tree, kind, o);
  const A = ASPECT, { nodes } = tree, n = tree.tips.length;
  const W = o.w, H = o.h, OX = o.ox || 0, OY = o.oy || 0;
  const maxC = Math.max(1e-9, ...nodes.map(q => q.change));
  const val = q => (o.xMode === 'change' ? q.change / maxC * T_MAX : q.t);
  const order = [], slot = new Array(nodes.length), post = [];
  (function walk(id) { const q = nodes[id]; if (!q.children.length) { slot[id] = order.length; order.push(id); } q.children.forEach(walk); post.push(id); })(tree.root);
  const pos = new Array(nodes.length), box = new Array(nodes.length).fill(null), branch = new Array(nodes.length).fill(null);
  const out = { kind, pos, box, branch, order };

  if (kind === 'clado') {
    const axisH = o.axis === false ? 0 : Math.min(H * 0.1, 14);
    const top = H * 0.02, rowH = (H - axisH - top) / Math.max(1, n);
    // Living tips sit in two staggered columns when the rows are thin.
    const stagger = rowH * 0.74 < H * 0.07 && n > 6;
    let fh = Math.min(rowH * (stagger ? 1.5 : 0.74), H * 0.2), fw = fh / A;
    if (fw > W * (stagger ? 0.12 : 0.2)) { fw = W * (stagger ? 0.12 : 0.2); fh = fw * A; }
    const eh = Math.min(fh, rowH * 0.74), ew = eh / A;
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
      if (q.kind === 'extinct' && o.xMode !== 'change') box[id] = { x: Math.min(p.x + gap, xOf(T_MAX) - ew - gap), y: p.y - eh / 2, w: ew, h: eh };
      else {
        const col = stagger ? (li++ % 2) : 0;
        box[id] = { x: Math.max(p.x, xOf(T_MAX)) + gap + col * fw * 1.05, y: p.y - fh / 2, w: fw, h: fh };
      }
    }
    for (const q of nodes) {
      if (q.parent < 0) continue;
      const p = pos[q.parent], c = pos[q.id];
      branch[q.id] = { elbow: [[p.x, p.y], [p.x, c.y]], run: [[p.x, c.y], [c.x, c.y]] };
    }
    const aw = Math.min(fw * 0.5, rowH * 1.1 / A * 0.6), ah = aw * A;
    for (const q of nodes) if (q.children.length) box[q.id] = { x: pos[q.id].x - aw * 0.5, y: pos[q.id].y - ah * 1.08, w: aw, h: ah, anc: true };
    Object.assign(out, { tip: { w: fw, h: fh }, xOf, axisY: OY + H - axisH, axisH, top: OY + top, bottom: OY + H - axisH, x0: xOf(0), x1: xOf(T_MAX) });
    return out;
  }
  const fan = kind === 'fan';
  const span = fan ? Math.PI * 0.94 : Math.PI * 2;
  const a0 = fan ? Math.PI * 1.03 : -Math.PI / 2;
  const cx = OX + W / 2, cy = fan ? OY + H * 0.97 : OY + H / 2;
  const Rout = fan ? Math.min(W / 2, H * 0.95) : Math.min(W, H) / 2;
  const dA = span / Math.max(1, n), diag = Math.hypot(1, A);
  const angleOf = i => a0 + (fan ? i + 0.5 : i) * dA;
  // Box width s: neighbours at radius Rf must be more than a diagonal apart.
  let s = Rout * 0.3;
  for (let k = 0; k < 8; k++) {
    const Rf = Rout - s * diag * 0.52;
    const chord = n > 1 ? 2 * Rf * Math.sin(Math.min(Math.PI / 2, dA / 2)) : Rout;
    s = Math.min(Rout * 0.3, chord / (diag * 1.03));
  }
  const Rf = Rout - s * diag * 0.52, rT = Math.max(Rf * 0.25, Rf - s * 0.8), r0 = fan ? Rout * 0.04 : 0;
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
    if (!q.children.length) box[q.id] = { x: cx + Rf * Math.cos(c.a) - s / 2, y: cy + Rf * Math.sin(c.a) - s * A / 2, w: s, h: s * A };
    if (q.parent >= 0) {
      const p = pos[q.parent];
      branch[q.id] = { elbow: arc(p.r, p.a, c.a), run: [[cx + p.r * Math.cos(c.a), cy + p.r * Math.sin(c.a)], [c.x, c.y]] };
    }
  }
  const as = s * 0.45;
  for (const q of nodes) if (q.children.length) box[q.id] = { x: pos[q.id].x - as / 2, y: pos[q.id].y - as * A / 2, w: as, h: as * A, anc: true };
  Object.assign(out, { tip: { w: s, h: s * A }, cx, cy, rOf, Rf, rT, fan, a0, span });
  return out;
}

// ── layoutNatural ───────────────────────────────────────────────────────────
// The layout for the screen: the mushrooms set the size, not the box. o.tip
// is the width of a tip box in mm; the layout returns its own w and h.
// Each split is one column (cladogram) or one ring (radial, fan) further
// out. Ancestor boxes are ANC of the tip size and sit on their node.
export const ANC = 0.7;
function layoutNatural(tree, kind, o) {
  const A = ASPECT, { nodes } = tree, n = tree.tips.length, s = o.tip, OX = o.ox || 0, OY = o.oy || 0;
  const order = [], slot = new Array(nodes.length), post = [];
  (function walk(id) { const q = nodes[id]; if (!q.children.length) { slot[id] = order.length; order.push(id); } q.children.forEach(walk); post.push(id); })(tree.root);
  const pos = new Array(nodes.length), box = new Array(nodes.length).fill(null), branch = new Array(nodes.length).fill(null);
  const D = Math.max(1, ...nodes.filter(q => q.children.length).map(q => q.depth));
  const aw = s * ANC, ah = aw * A, fh = s * A;
  const out = { kind, pos, box, branch, order, natural: true, tip: { w: s, h: fh }, anc: { w: aw, h: ah } };
  const tipBox = (q, x, y) => { const w = q.kind === 'extinct' ? s * 0.85 : s; return { w, h: w * A, x, y }; };
  if (kind === 'clado') {
    const rowH = fh * 1.32, colW = aw * 1.22, top = fh * 0.4, x0 = aw * 0.6;
    const tipX = x0 + (D + 1) * colW, gap = s * 0.05;
    for (const id of post) {
      const q = nodes[id];
      if (!q.children.length) pos[id] = { x: OX + (q.kind === 'extinct' ? x0 + q.depth * colW : tipX), y: OY + top + (slot[id] + 0.5) * rowH };
      else { const ys = q.children.map(c => pos[c].y); pos[id] = { x: OX + x0 + q.depth * colW, y: (Math.min(...ys) + Math.max(...ys)) / 2 }; }
    }
    for (const q of nodes) {
      const p = pos[q.id];
      if (!q.children.length) { const b = tipBox(q, 0, 0); box[q.id] = { x: p.x + gap, y: p.y - b.h / 2, w: b.w, h: b.h }; }
      else box[q.id] = { x: p.x - aw / 2, y: p.y - ah / 2, w: aw, h: ah, anc: true };
      if (q.parent >= 0) { const pp = pos[q.parent]; branch[q.id] = { elbow: [[pp.x, pp.y], [pp.x, p.y]], run: [[pp.x, p.y], [p.x, p.y]] }; }
    }
    let maxX = 0;
    for (const b of box) if (b) maxX = Math.max(maxX, b.x + b.w - OX);
    out.w = maxX + s * 0.1; out.h = top * 2 + n * rowH;
    return out;
  }
  const fan = kind === 'fan', diag = Math.hypot(1, A);
  const span = fan ? Math.PI * 0.94 : Math.PI * 2;
  const a0 = fan ? Math.PI * 1.03 : -Math.PI / 2;
  const dA = span / Math.max(1, n);
  const ringW = aw * 1.15;
  const chordR = n > 1 ? 1.08 * diag * s / (2 * Math.sin(Math.min(Math.PI / 2, dA / 2))) : s;
  const Rf = Math.max(chordR, ringW * (D + 1) + s * 0.75);
  const Rout = Rf + s * diag / 2 + s * 0.14;
  const W = 2 * Rout, H = fan ? Rout + s * 0.55 : 2 * Rout;
  const cx = OX + W / 2, cy = fan ? OY + H - s * 0.55 : OY + H / 2;
  const tipR = Rf - s * 0.62;
  const rOfDepth = d => (fan ? s * 0.35 : 0) + ringW * d;
  for (const id of post) {
    const q = nodes[id];
    let a;
    if (!q.children.length) a = a0 + (fan ? slot[id] + 0.5 : slot[id]) * dA;
    else { const as = q.children.map(c => pos[c].a); a = (Math.min(...as) + Math.max(...as)) / 2; }
    const r = q.children.length ? rOfDepth(q.depth) : q.kind === 'extinct' ? Math.min(tipR, rOfDepth(q.depth)) : tipR;
    pos[id] = { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), a, r };
  }
  const arc = (r, a, b) => {
    const k = Math.max(2, Math.ceil(Math.abs(b - a) / 0.05)), pts = [];
    for (let i = 0; i <= k; i++) { const t = a + (b - a) * i / k; pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); }
    return pts;
  };
  for (const q of nodes) {
    const c = pos[q.id];
    if (!q.children.length) { const b = tipBox(q, 0, 0); box[q.id] = { x: cx + Rf * Math.cos(c.a) - b.w / 2, y: cy + Rf * Math.sin(c.a) - b.h / 2, w: b.w, h: b.h }; }
    else box[q.id] = { x: c.x - aw / 2, y: c.y - ah / 2, w: aw, h: ah, anc: true };
    if (q.parent >= 0) { const p = pos[q.parent]; branch[q.id] = { elbow: arc(p.r, p.a, c.a), run: [[cx + p.r * Math.cos(c.a), cy + p.r * Math.sin(c.a)], [c.x, c.y]] }; }
  }
  Object.assign(out, { w: W, h: H, cx, cy, Rf, fan, a0, span, ringW, D });
  return out;
}

// Tip boxes of a layout (for the overlap test and hit tests).
export function tipBoxes(tree, lay) { return tree.tips.map(id => Object.assign({ id }, lay.box[id])); }
