// ============================================================================
//  PERIODIC TABLE  ·  layouts.js  ·  where each view puts each element
// ----------------------------------------------------------------------------
//  Pure geometry, no DOM. A layout is
//    { id, items, bounds, decor, disc }
//    items[i]   the place of ELEMENTS[i]: { x, y, s, a, h }
//               x, y  the tile centre in world units (one table cell = 1)
//               s     the tile side (or the disc diameter)
//               a     opacity 0..1 (the timeline hides undiscovered ones)
//               h     height 0..1 for the 3D tower (0 elsewhere)
//    bounds     { x0, y0, x1, y1 }, the box the camera fits
//    decor      labels and guides: { t: 'text' | 'line' | 'ring' | 'axis' }
//    disc       true when the view draws discs, not squares
//  render.js morphs between two layouts. tests.mjs checks that every view
//  places every element once, with no two tiles overlapping.
//
//  GREP MAP
//    grep -n "export const VIEWS"     the view list (id, name, build)
//    grep -n "function standard"      18 columns, f-block below
//    grep -n "function long"          32 columns
//    grep -n "function spiral"        Benfey-style spiral
//    grep -n "function radial"        rings, one per period
//    grep -n "function janet"         left-step table
//    grep -n "function blocks"        s, p, d, f islands by subshell
//    grep -n "function timeline"      stacks per decade of discovery
//    grep -n "function abundance"     tile area from log abundance
//    grep -n "function scatter"       property against property
//    grep -n "export function morph"  one element between two layouts
// ============================================================================
import { ELEMENTS, lastSubshell, propT, propLinear, PROP, propRange, fmt, BLOCK } from './chem.js';

const N = ELEMENTS.length;
const TAU = Math.PI * 2;

function boundsOf(items, pad = 0.6) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const it of items) {
    if (it.a <= 0) continue;
    x0 = Math.min(x0, it.x - it.s / 2); x1 = Math.max(x1, it.x + it.s / 2);
    y0 = Math.min(y0, it.y - it.s / 2); y1 = Math.max(y1, it.y + it.s / 2);
  }
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}
const item = (x, y, s = 0.92, a = 1, h = 0) => ({ x, y, s, a, h });

// Standard position of an element: group column 1..18, period row; the
// f-block (La-Yb, Ac-No) in two rows under the table. Lu and Lr sit in
// group 3, as in the IUPAC 2021 provisional report (and as their 5d1 / 6d1
// valence suggests), so the f rows hold 14 elements each.
export function stdPos(e) {
  if (e.block === 'f') return [3 + (e.col32 - 3), e.period + 2.6];
  return [e.group, e.period];
}

function standard() {
  const items = ELEMENTS.map(e => { const [x, y] = stdPos(e); return item(x, y); });
  const decor = [];
  const top = { 1: 1, 2: 2, 13: 2, 14: 2, 15: 2, 16: 2, 17: 2, 18: 1 };
  for (let g = 1; g <= 18; g++) decor.push({ t: 'text', x: g, y: (top[g] || 4) - 0.66, text: String(g), size: 0.26, role: 'group' });
  for (let p = 1; p <= 7; p++) decor.push({ t: 'text', x: 0.3, y: p, text: String(p), size: 0.3, role: 'period' });
  decor.push({ t: 'text', x: 2.35, y: 8.6, text: 'Lanthanides', size: 0.24, align: 'right', role: 'label' });
  decor.push({ t: 'text', x: 2.35, y: 9.6, text: 'Actinides', size: 0.24, align: 'right', role: 'label' });
  decor.push({ t: 'line', pts: [[2.5, 6.5], [2.5, 8.1], [2.75, 8.1]], role: 'guide' });
  decor.push({ t: 'line', pts: [[2.5, 7.5], [2.5, 7.75]], role: 'guide' });
  return { items, decor, disc: false };
}

function long() {
  const items = ELEMENTS.map(e => item(e.col32, e.period));
  const decor = [];
  const spans = [['s', 1, 2], ['f', 3, 16], ['d', 17, 26], ['p', 27, 32]];
  for (const [b, a, z] of spans) {
    decor.push({ t: 'text', x: (a + z) / 2, y: 0.05, text: BLOCK[b].name, size: 0.3, role: 'block', color: BLOCK[b].color });
    decor.push({ t: 'line', pts: [[a - 0.4, 0.35], [z + 0.4, 0.35]], role: 'block', color: BLOCK[b].color });
  }
  for (let p = 1; p <= 7; p++) decor.push({ t: 'text', x: 0.25, y: p, text: String(p), size: 0.3, role: 'period' });
  return { items, decor, disc: false };
}

// Benfey-style spiral: one turn per period, the angle from the 32-column
// position, so every group lies on one ray and the d and f blocks open as
// wedges in the outer turns. Discs grow with the radius.
export const SPIRAL = { r0: 3.6, dr: 1.25 };
function spiral() {
  const { r0, dr } = SPIRAL;
  const items = ELEMENTS.map(e => {
    const f = (e.col32 - 0.5) / 32;
    const th = -Math.PI / 2 + TAU * f;
    const r = r0 + dr * (e.period - 1 + f);
    const s = Math.min(0.9 * dr, 0.9 * TAU * r / 32);
    return item(r * Math.cos(th), r * Math.sin(th), s);
  });
  const decor = [];
  const pts = [];
  for (let k = 0; k <= 7 * 96; k++) {
    const f = k / 96, th = -Math.PI / 2 + TAU * f, r = r0 + dr * (f - 0.5 / 32);
    pts.push([r * Math.cos(th), r * Math.sin(th)]);
  }
  decor.push({ t: 'line', pts, role: 'guide' });
  decor.push({ t: 'text', x: 0, y: -0.25, text: 'one turn', size: 0.34, role: 'label' });
  decor.push({ t: 'text', x: 0, y: 0.3, text: 'per period', size: 0.34, role: 'label' });
  for (const [g, col] of [[1, 1], [2, 2], [3, 17], [8, 22], [11, 25], [14, 28], [17, 31], [18, 32]]) {
    const th = -Math.PI / 2 + TAU * (col - 0.5) / 32, r = r0 + dr * 7.1;
    decor.push({ t: 'text', x: r * Math.cos(th), y: r * Math.sin(th), text: 'G' + g, size: 0.3, role: 'group' });
  }
  return { items, decor, disc: true };
}

// Rings, one per period (the valence shell n), the elements of a period
// spread evenly round its ring.
export const RADIAL = { r0: 1.15, dr: 1.3 };
function radial() {
  const { r0, dr } = RADIAL;
  const byP = {};
  for (const e of ELEMENTS) (byP[e.period] = byP[e.period] || []).push(e);
  const items = new Array(N);
  const decor = [];
  for (const p in byP) {
    const list = byP[p].slice().sort((a, b) => a.col32 - b.col32);
    const R = r0 + (p - 1) * dr;
    const s = Math.min(0.9 * dr, 0.9 * TAU * R / list.length);
    list.forEach((e, i) => {
      const th = -Math.PI / 2 + TAU * (i + 0.5) / list.length;
      items[e.z - 1] = item(R * Math.cos(th), R * Math.sin(th), s);
    });
    decor.push({ t: 'ring', x: 0, y: 0, r: R, role: 'guide' });
  }
  for (let p = 1; p <= 7; p++) decor.push({ t: 'text', x: r0 + (p - 1) * dr + 0.02, y: 0.08, text: 'n=' + p, size: 0.2, role: 'period', align: 'center', rot: 0 });
  return { items, decor, disc: true };
}

// Janet's left-step table: rows by n + l of the last subshell (Madelung),
// blocks f d p s from left to right, helium in the s-block.
const JSTART = [31, 25, 15, 1];   // first column of s, p, d, f
function janet() {
  const items = ELEMENTS.map(e => {
    const [n, l, k] = lastSubshell(e.z);
    return item(JSTART[l] + k - 1, n + l);
  });
  const decor = [];
  for (const [b, l, w] of [['f', 3, 14], ['d', 2, 10], ['p', 1, 6], ['s', 0, 2]]) {
    const a = JSTART[l];
    decor.push({ t: 'text', x: a + (w - 1) / 2, y: 0.1, text: BLOCK[b].name, size: 0.3, role: 'block', color: BLOCK[b].color });
    decor.push({ t: 'line', pts: [[a - 0.4, 0.4], [a + w - 0.6, 0.4]], role: 'block', color: BLOCK[b].color });
  }
  for (let r = 1; r <= 8; r++) decor.push({ t: 'text', x: 33.1, y: r, text: 'n + l = ' + r, size: 0.22, role: 'period', align: 'left' });
  return { items, decor, disc: false };
}

// Orbital blocks: the s, d and p islands side by side, f below, each row
// one subshell n (so 3d sits beside 4s, as it fills there). Helium is in
// the s island. The tile is placed by the subshell the Madelung rule fills
// last, and its electron count there.
const BX = { s: 0, d: 3.4, p: 14.8, f: 1.4 };
function blocks() {
  const items = ELEMENTS.map(e => {
    const [n, l, k] = lastSubshell(e.z);
    const b = 'spdf'[l];
    if (b === 'f') return item(BX.f + k, n + 4.7);
    return item(BX[b] + k, n);
  });
  const decor = [];
  const rows = { s: [1, 7], p: [2, 7], d: [3, 6], f: [4, 5] };
  for (const b of 'spdf') {
    const [a, z] = rows[b];
    for (let n = a; n <= z; n++) {
      const y = b === 'f' ? n + 4.7 : n;
      const x = b === 'p' ? BX.p + 6.75 : BX[b] + 0.3;
      decor.push({ t: 'text', x, y, text: n + b, size: 0.27, role: 'sub', color: BLOCK[b].color, align: b === 'p' ? 'left' : 'right' });
    }
    const w = { s: 2, p: 6, d: 10, f: 14 }[b];
    const y = b === 'f' ? a + 4.7 - 0.82 : a - 0.82;
    decor.push({ t: 'text', x: BX[b] + (w + 1) / 2, y, text: `${b}-block  ·  l = ${'spdf'.indexOf(b)}  ·  ${w} electrons per subshell`, size: 0.24, role: 'block', color: BLOCK[b].color });
  }
  return { items, decor, disc: false };
}

// Discovery timeline: column 0 holds the elements known since antiquity,
// column 1 those found before 1750, then one column per decade. Each
// column stacks upwards in the order of discovery.
export const TL0 = 1750;
export function tlColumn(e) {
  const y = e.disc.year;
  if (!y) return 0;
  if (y < TL0) return 1;
  return 2 + Math.floor((y - TL0) / 10);
}
function timeline(opts = {}) {
  const year = opts.year ?? 2030;
  const cols = {};
  const order = ELEMENTS.slice().sort((a, b) => (a.disc.year || 0) - (b.disc.year || 0) || a.z - b.z);
  const items = new Array(N);
  for (const e of order) {
    const c = tlColumn(e);
    const k = cols[c] = (cols[c] || 0) + 1;
    const shown = !e.disc.year || e.disc.year <= year;
    items[e.z - 1] = item(c * 1.06, 12 - (k - 1) * 1.0, 0.94, shown ? 1 : 0);
  }
  const decor = [];
  const last = 2 + Math.floor((2010 - TL0) / 10);
  decor.push({ t: 'axis', x0: -0.5, x1: last * 1.06 + 0.5, y: 12.62, role: 'axis' });
  decor.push({ t: 'text', x: 0, y: 13.05, text: 'Antiquity', size: 0.34, role: 'tick', rot: -0.6, align: 'right' });
  decor.push({ t: 'text', x: 1.06, y: 13.05, text: '< ' + TL0, size: 0.34, role: 'tick', rot: -0.6, align: 'right' });
  for (let c = 2; c <= last; c++) {
    const yr = TL0 + (c - 2) * 10;
    if (yr % 20 === 0 || c === last) decor.push({ t: 'text', x: c * 1.06, y: 13.05, text: yr + 's', size: 0.34, role: 'tick', rot: -0.6, align: 'right' });
  }
  return { items, decor, disc: false, year };
}

// Abundance: standard places, tile side from the log of the abundance in
// the chosen reservoir. No data: a faint small tile.
function abundance(opts = {}) {
  const src = opts.source || 'crust';
  const items = ELEMENTS.map(e => {
    const [x, y] = stdPos(e);
    const t = propT(src, e);
    return t == null ? item(x, y, 0.2, 0.35) : item(x, y, 0.24 + 0.72 * t);
  });
  const decor = [{ t: 'text', x: 9.5, y: 0.2, text: `${PROP[src].name}: tile size follows the log of the abundance`, size: 0.32, role: 'label' }];
  return { items, decor, disc: false, source: src };
}

// Tower: standard places, height from a property.
function tower(opts = {}) {
  const id = opts.prop || 'density';
  const items = ELEMENTS.map(e => {
    const [x, y] = stdPos(e);
    const t = propLinear(id, e);
    return item(x, y, 0.86, 1, t == null ? 0 : 0.03 + 0.97 * t);
  });
  return { items, decor: [], disc: false, prop: id, three: true };
}

function heat(opts = {}) {
  const L = standard();
  L.prop = opts.prop || 'en';
  return L;
}

// Push overlapping discs apart (a few passes), but never more than `limit`
// from the true data point, so that a pile of equal values reads as a
// cluster and each point stays where its numbers put it. The first pass
// stores the true point in it.x0, it.y0.
export function relax(list, limit) {
  for (const it of list) { it.x0 = it.x; it.y0 = it.y; }
  for (let pass = 0; pass < 160; pass++) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        const want = (a.s + b.s) / 2 * 1.02;
        if (d >= want) continue;
        if (d < 1e-6) { dx = Math.cos(i + j); dy = Math.sin(i + j); d = 1; }
        const push = (want - d) / 2 / d;
        a.x -= dx * push; a.y -= dy * push; b.x += dx * push; b.y += dy * push;
      }
    }
    for (const it of list) {
      const ox = it.x - it.x0, oy = it.y - it.y0, o = Math.hypot(ox, oy);
      if (o > limit) { it.x = it.x0 + ox * limit / o; it.y = it.y0 + oy * limit / o; }
    }
  }
}

// Scatter: property X against property Y. Elements with a missing value
// sit in a row under the axis, so every element is still on screen.
// relax() moves a point at most 1.4 cells from its true place, so that no
// two labelled discs overlap; the card shows the exact values.
export const SCATTER = { w: 17, h: 9.5 };
function scatter(opts = {}) {
  const X = opts.x || 'radius', Y = opts.y || 'ie1';
  const { w, h } = SCATTER;
  const missing = [];
  const items = ELEMENTS.map(e => {
    const tx = propT(X, e), ty = propT(Y, e);
    if (tx == null || ty == null) { missing.push(e.z - 1); return null; }
    return item(tx * w, h - ty * h, 0.56);
  });
  relax(items.filter(Boolean), 1.4);
  missing.forEach((i, k) => { items[i] = item((k + 0.5) * (w / Math.max(missing.length, 1)), h + 2.1, Math.min(0.5, 0.9 * w / Math.max(missing.length, 1)), 0.55); });
  const decor = [
    { t: 'axis', x0: 0, x1: w, y: h + 0.5, role: 'axis' },
    { t: 'axis', x0: 0, y0: 0, y1: h, x: -0.5, vertical: true, role: 'axis' },
    { t: 'text', x: w / 2, y: h + 1.25, text: PROP[X].name + (PROP[X].unit ? ' (' + PROP[X].unit + ')' : '') + (PROP[X].log ? ', log' : ''), size: 0.34, role: 'label' },
    { t: 'text', x: -1.3, y: h / 2, text: PROP[Y].name + (PROP[Y].unit ? ' (' + PROP[Y].unit + ')' : '') + (PROP[Y].log ? ', log' : ''), size: 0.34, role: 'label', rot: -Math.PI / 2 },
  ];
  if (missing.length) decor.push({ t: 'text', x: w / 2, y: h + 2.75, text: 'No data for one of the two properties', size: 0.24, role: 'tick' });
  for (const [id, horiz] of [[X, true], [Y, false]]) {
    const [lo, hi] = propRange(id), p = PROP[id];
    for (let k = 0; k <= 4; k++) {
      const t = k / 4;
      const v = p.log ? Math.exp(Math.log(lo) + t * (Math.log(hi) - Math.log(lo))) : lo + t * (hi - lo);
      decor.push(horiz ? { t: 'text', x: t * w, y: h + 0.82, text: fmt(v, p.digits > 2 ? 2 : p.digits), size: 0.24, role: 'tick' }
        : { t: 'text', x: -0.7, y: h - t * h, text: fmt(v, p.digits > 2 ? 2 : p.digits), size: 0.24, role: 'tick', align: 'right' });
    }
  }
  return { items, decor, disc: true, x: X, y: Y };
}

// The views, in menu order. color: the colour mode a view starts with.
export const VIEWS = [
  { id: 'standard', name: 'Standard', hint: '18 columns, the f-block below', build: standard, color: 'cat' },
  { id: 'long', name: 'Long form', hint: '32 columns, the f-block inline', build: long, color: 'block' },
  { id: 'spiral', name: 'Spiral', hint: 'One turn per period; groups lie on rays', build: spiral, color: 'cat' },
  { id: 'radial', name: 'Shells', hint: 'One ring per period, by valence shell n', build: radial, color: 'cat' },
  { id: 'janet', name: 'Left-step', hint: 'Janet: rows by n + l, the Aufbau order', build: janet, color: 'block' },
  { id: 'blocks', name: 'Orbital blocks', hint: 's, p, d and f islands, one row per subshell', build: blocks, color: 'block' },
  { id: 'tower', name: '3D tower', hint: 'A property as height; drag to turn', build: tower, color: 'prop', three: true },
  { id: 'heat', name: 'Heat map', hint: 'Any property on a colour map', build: heat, color: 'prop' },
  { id: 'timeline', name: 'Discovery', hint: 'Scrub the years; elements appear as found', build: timeline, color: 'cat' },
  { id: 'abundance', name: 'Abundance', hint: 'Tile size from log abundance', build: abundance, color: 'cat' },
  { id: 'scatter', name: 'Scatter', hint: 'Property against property', build: scatter, color: 'cat' },
];
export const VIEW = Object.fromEntries(VIEWS.map(v => [v.id, v]));

export function buildLayout(id, opts = {}) {
  const v = VIEW[id] || VIEW.standard;
  const L = v.build(opts);
  L.id = v.id;
  L.bounds = boundsOf(L.items, L.disc ? 0.9 : 0.7);
  // keep the decor inside the fitted box
  for (const d of L.decor) {
    if (d.t !== 'text') continue;
    const w = (d.text || '').length * (d.size || 0.3) * 0.32;
    L.bounds.x0 = Math.min(L.bounds.x0, d.x - (d.align === 'right' ? w * 2 : w) - 0.2);
    L.bounds.x1 = Math.max(L.bounds.x1, d.x + (d.align === 'left' ? w * 2 : w) + 0.2);
    L.bounds.y0 = Math.min(L.bounds.y0, d.y - 0.4);
    L.bounds.y1 = Math.max(L.bounds.y1, d.y + 0.4);
  }
  return L;
}

// ── morph ───────────────────────────────────────────────────────────────────
const clamp01 = t => t < 0 ? 0 : t > 1 ? 1 : t;
// Ease with a small overshoot at the end, so a tile lands and settles.
export function easeBack(t, k = 1.25) { const u = t - 1; return 1 + (k + 1) * u * u * u + k * u * u; }
export const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

// The stagger of element i in a transition A -> B: a sweep across B, left
// to right with a small jitter by Z, so tiles leave in a wave.
export function delays(B) {
  const xs = B.items.map(it => it.x);
  const lo = Math.min(...xs), hi = Math.max(...xs);
  return B.items.map((it, i) => 0.32 * ((it.x - lo) / Math.max(1e-6, hi - lo)) + 0.06 * (((i * 37) % 11) / 11));
}

// One element at transition time t (0..1) from layout A to layout B. The
// path bends sideways (an arc), so tiles fly instead of sliding.
export function morph(a, b, t, delay = 0) {
  const span = 1 - 0.38;
  const u = clamp01((t - delay) / span);
  const e = easeBack(easeInOut(u) * 0.999 + 0.001 * u, 0.9);
  const dx = b.x - a.x, dy = b.y - a.y;
  const bend = 0.18 * Math.sin(Math.PI * u);
  return {
    x: a.x + dx * e - dy * bend,
    y: a.y + dy * e + dx * bend,
    s: a.s + (b.s - a.s) * clamp01(e),
    a: a.a + (b.a - a.a) * clamp01(u * 1.4),
    h: a.h + (b.h - a.h) * clamp01(e),
    u,
  };
}
