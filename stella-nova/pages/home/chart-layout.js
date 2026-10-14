// ============================================================================
//  CHART LAYOUT  ·  where the constellations and their labels go
// ----------------------------------------------------------------------------
//  The home star chart (main.js buildChart) asks this file for the place of
//  each star, each line and each constellation label, in chart units
//  (1000 x 620). No DOM: tests.mjs runs it in node.
//
//  1. STARS. placeStars puts the pages of one constellation about the
//     anchors of sectors.js LAYOUT (one anchor per group), with a seeded
//     best-of-40 spread, and joins them with a minimum spanning tree.
//  2. SPREAD. Each constellation is a box: the box of its stars, and the
//     box of its label above it. The SECTOR_TEXT centres are only the
//     start. Boxes that overlap push apart, a weak spring pulls each one
//     back to its start, and the frame keeps every box inside. So a large
//     constellation does not cover its neighbours, and no label is cut by
//     the frame edge.
//  3. LABELS. Each label then takes the best of eight places about its own
//     stars: no other label, star or line under it, inside the frame,
//     near its stars, top first.
//  The label size comes in CSS px with the chart width in px, because the
//  labels have a fixed CSS size: on a narrow chart they take more units.
//
//  grep -n targets
//    seeded random ........ "function mulberry"
//    star placement ....... "function placeStars"
//    label size guess ..... "function guessLabel"
//    spread pass .......... "function spread"
//    label pass ........... "function placeLabels"
//    entry ................ "function layoutChart"
//    overlap count ........ "function chartIssues"
// ============================================================================
(function (O) {
'use strict';
const W = 1000, H = 620;
const PAD = 7;          // units of clear space about the stars of a sector
const GAP = 6;          // units between the stars and their label
const EDGE = 10;        // units of clear space inside the frame

function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// The stars and lines of one sector. groups: [{ pages }], anchors: sectors.js
// LAYOUT[id] ([[x, y, r]] per group), si: the sector index (the seed).
function placeStars(groups, anchors, si) {
  const r = mulberry(100 + si * 17);
  const placed = [], edges = [];
  groups.forEach((g, gi) => {
    const [cx, cy, rad] = anchors[gi] || anchors[anchors.length - 1];
    const pts = [];
    g.pages.forEach(p => {
      let best = null;
      if (g.pages.length === 1) best = [cx, cy];
      else {
        let bd = -1;
        for (let k = 0; k < 40; k++) {
          const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad;
          const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.78;
          let md = 1e9; for (const q of pts) md = Math.min(md, Math.hypot(q[0] - x, q[1] - y));
          if (pts.length === 0) md = 1e9 - d;
          if (md > bd) { bd = md; best = [x, y]; }
        }
      }
      pts.push(best);
      placed.push({ p, x: best[0], y: best[1], g: gi });
    });
    // Prim minimum spanning tree inside the group.
    const idx = placed.map((s, i) => i).filter(i => placed[i].g === gi);
    const inT = new Set([idx[0]]);
    while (inT.size < idx.length) {
      let bd = 1e9, e = null;
      for (const a of inT) for (const b of idx) if (!inT.has(b)) {
        const d = Math.hypot(placed[a].x - placed[b].x, placed[a].y - placed[b].y);
        if (d < bd) { bd = d; e = [a, b]; }
      }
      edges.push(e); inT.add(e[1]);
    }
    // Join the group to the nearest star of an earlier group.
    if (gi > 0) {
      let bd = 1e9, e = null;
      for (const a of idx) placed.forEach((s, b) => { if (s.g < gi) { const d = Math.hypot(placed[a].x - s.x, placed[a].y - s.y); if (d < bd) { bd = d; e = [b, a]; } } });
      if (e) edges.push(e);
    }
  });
  return { stars: placed, edges };
}

// The CSS px size of a label (.c-label) before it is in the page: glyph
// disc, name, count, padding. main.js measures the real ones after the
// first draw and lays out again.
function guessLabel(name, count) {
  return [5 + 18 + 6 + name.length * 7.1 + 5 + String(count).length * 6.6 + 10 + 2, 28];
}

const box = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
const shift = (b, dx, dy) => box(b.x0 + dx, b.y0 + dy, b.x1 + dx, b.y1 + dy);
const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
function starBox(stars) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const s of stars) { x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x); y1 = Math.max(y1, s.y); }
  return box(x0 - PAD, y0 - PAD, x1 + PAD, y1 + PAD);
}
// The label box at one of eight places about the star box b. lw, lh: units.
const SIDES = ['top', 'bottom', 'top-right', 'top-left', 'bottom-right', 'bottom-left', 'right', 'left'];
function labelAt(b, side, lw, lh) {
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const L = { x: cx, y: cy };
  if (side === 'top') { L.y = b.y0 - GAP - lh / 2; }
  else if (side === 'bottom') { L.y = b.y1 + GAP + lh / 2; }
  else if (side === 'right') { L.x = b.x1 + GAP + lw / 2; }
  else if (side === 'left') { L.x = b.x0 - GAP - lw / 2; }
  else {
    L.y = side.startsWith('top') ? b.y0 - GAP + lh / 2 - lh : b.y1 + GAP + lh / 2;
    L.x = side.endsWith('right') ? b.x1 - lw / 2 + lw * 0.35 : b.x0 + lw / 2 - lw * 0.35;
  }
  return { x: L.x, y: L.y, b: box(L.x - lw / 2, L.y - lh / 2, L.x + lw / 2, L.y + lh / 2) };
}

// Push overlapping sector boxes apart. Each item: { home: [dx, dy] = 0,
// d: [dx, dy], sb: star box at d = 0, lb: label box at d = 0 }.
function spread(items, iters) {
  const n = items.length;
  for (let it = 0; it < iters; it++) {
    let worst = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const A = items[i], B = items[j];
      for (const a of [A.sb, A.lb]) for (const b of [B.sb, B.lb]) {
        const pa = shift(a, A.d[0], A.d[1]), pb = shift(b, B.d[0], B.d[1]);
        if (!hit(pa, pb)) continue;
        // the least move that parts the two boxes, plus a margin
        const ox = Math.min(pa.x1 - pb.x0, pb.x1 - pa.x0) + 2, oy = Math.min(pa.y1 - pb.y0, pb.y1 - pa.y0) + 2;
        const wa = B.mass / (A.mass + B.mass), wb = 1 - wa;
        if (ox * 0.62 < oy) {   // the chart is wide: a side move is cheaper
          const s = (pa.x0 + pa.x1) < (pb.x0 + pb.x1) ? -1 : 1;
          A.d[0] += s * ox * wa; B.d[0] -= s * ox * wb;
        } else {
          const s = (pa.y0 + pa.y1) < (pb.y0 + pb.y1) ? -1 : 1;
          A.d[1] += s * oy * wa; B.d[1] -= s * oy * wb;
        }
        worst = Math.max(worst, Math.min(ox, oy));
      }
    }
    for (const A of items) {
      // a weak pull back to the hand-placed centre
      A.d[0] *= 0.9995; A.d[1] *= 0.9995;
      // keep both boxes inside the frame
      const u = box(Math.min(A.sb.x0, A.lb.x0), Math.min(A.sb.y0, A.lb.y0), Math.max(A.sb.x1, A.lb.x1), Math.max(A.sb.y1, A.lb.y1));
      A.d[0] = Math.max(EDGE - u.x0, Math.min(W - EDGE - u.x1, A.d[0]));
      A.d[1] = Math.max(EDGE - u.y0, Math.min(H - EDGE - u.y1, A.d[1]));
    }
    if (worst === 0 && it > 20) break;
  }
}

// Each label takes the best of the eight places. Big sectors choose first.
function placeLabels(out, sizeOf) {
  const order = Object.keys(out).sort((a, b) => out[b].stars.length - out[a].stars.length);
  const taken = [];
  const allStars = Object.values(out).flatMap(o => o.stars);
  const allLines = Object.values(out).flatMap(o => o.edges.map(([a, b]) => [o.stars[a], o.stars[b]]));
  for (const id of order) {
    const o = out[id], [lw, lh] = sizeOf(id), sb = starBox(o.stars);
    let best = null;
    SIDES.forEach((side, k) => {
      const L = labelAt(sb, side, lw, lh);
      let cost = k * 0.6;   // top first, then the others in order
      if (L.b.x0 < EDGE || L.b.y0 < EDGE || L.b.x1 > W - EDGE || L.b.y1 > H - EDGE) cost += 400;
      for (const t of taken) if (hit(L.b, t)) cost += 300;
      for (const s of allStars) if (s.x > L.b.x0 - 4 && s.x < L.b.x1 + 4 && s.y > L.b.y0 - 4 && s.y < L.b.y1 + 4) cost += s.id === id ? 60 : 120;
      for (const [a, b] of allLines) if (segHitsBox(a, b, L.b)) cost += 40;
      if (!best || cost < best.cost) best = { cost, L, side };
    });
    o.label = [best.L.x, best.L.y]; o.labelBox = best.L.b; o.side = best.side;
    taken.push(best.L.b);
  }
}
function segHitsBox(a, b, r) {
  // a segment against a box: sample it (the lines are short)
  const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4));
  for (let k = 0; k <= n; k++) { const t = k / n, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t; if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return true; }
  return false;
}

// The whole chart. secs: [{ id, name, short }], groupsOf(sec) -> [{ pages }],
// anchors: LAYOUT, opts: { chartPx (CSS px width of the chart), labelPx:
// { id: [w, h] } measured, else guessed }. Returns { id: { stars, edges,
// label: [x, y], side } } in chart units; stars carry { p, x, y, g }.
function layoutChart(secs, groupsOf, anchors, opts = {}) {
  const k = W / Math.max(300, opts.chartPx || 900);    // units per CSS px
  const items = [], out = {};
  const sizes = {};
  secs.forEach((sec, si) => {
    const groups = groupsOf(sec);
    const pl = placeStars(groups, anchors[sec.id], si);
    const n = pl.stars.length;
    const px = (opts.labelPx && opts.labelPx[sec.id]) || guessLabel(sec.short || sec.name, n);
    sizes[sec.id] = [px[0] * k, px[1] * k];
    const sb = starBox(pl.stars);
    const lb = labelAt(sb, 'top', sizes[sec.id][0], sizes[sec.id][1]).b;
    items.push({ id: sec.id, d: [0, 0], sb, lb, mass: 1 + n });
    out[sec.id] = pl;
  });
  spread(items, opts.iters || 600);
  for (const it of items) {
    const o = out[it.id];
    for (const s of o.stars) { s.x += it.d[0]; s.y += it.d[1]; s.id = it.id; }
    o.move = it.d;
  }
  placeLabels(out, id => sizes[id]);
  return out;
}

// The faults a reader sees, for tests.mjs and for tuning: labels over
// labels, labels over stars or lines of any sector, labels or stars cut by
// the frame, and star boxes of two sectors that overlap.
function chartIssues(out) {
  const ids = Object.keys(out), res = { labelLabel: 0, labelStar: 0, labelLine: 0, outside: 0, sectorOverlap: 0 };
  const lines = ids.flatMap(id => out[id].edges.map(([a, b]) => [out[id].stars[a], out[id].stars[b], id]));
  ids.forEach((id, i) => {
    const L = out[id].labelBox;
    if (L.x0 < 0 || L.y0 < 0 || L.x1 > W || L.y1 > H) res.outside++;
    for (const s of out[id].stars) if (s.x < 4 || s.y < 4 || s.x > W - 4 || s.y > H - 4) res.outside++;
    ids.forEach((jd, j) => {
      if (j > i && hit(L, out[jd].labelBox)) res.labelLabel++;
      for (const s of out[jd].stars) if (s.x > L.x0 && s.x < L.x1 && s.y > L.y0 && s.y < L.y1) res.labelStar++;
      if (j > i && hit(starBox(out[id].stars), starBox(out[jd].stars))) res.sectorOverlap++;
    });
    for (const [a, b] of lines) if (segHitsBox(a, b, L)) res.labelLine++;
  });
  return res;
}

Object.assign(O, { placeStars, layoutChart, chartIssues, guessLabel, CHART_W: W, CHART_H: H });
})(typeof window !== 'undefined' ? (window.Observatory = window.Observatory || {}) : globalThis.Observatory = globalThis.Observatory || {});
