// ============================================================================
//  ALPHA QUDITS  ·  records/scenes/grid.js  ·  all 172 records as glyphs
// ----------------------------------------------------------------------------
//  Every record of the model as our record glyph (draw.js), first grouped by
//  the pair of slots it occupies (the edges of the square), then sorted into
//  the four sectors of the two exchanges. The cells fly from one order to
//  the other. Tap or hover a cell: a card shows the record large, its terms,
//  what X and Y read on it and its weight. The groups, their sizes and every
//  record's sector come from MODEL; nothing is typed in.
//
//  grep -n targets:  const STEPS | function groupsFor | function layout |
//  function hit | function card | caption
// ============================================================================
import { RECORDS, BY_ID, SECTOR_ORDER, SECTOR_ROWS, EDGES, recordText, wText, COMBO_TEXT } from '../data.js';
import { C, font, label, ease, clamp, lerp, rrect, drawGlyph, SECTOR_COLOR } from '../draw.js';

const STEPS = [
  { id: 'edges', label: 'By pair of slots', dur: 9 },
  { id: 'sectors', label: 'By sector', dur: 13 },
];

// The group a record belongs to by slots: a mixed product and its image
// share one group (Q1q1 with Q2q2), as in the paper's Table S3.
function edgeGroup(r) {
  if (r.kind === 'commutator') return 'arc';
  if (r.sameEnd || !r.image) return r.edge;
  return [r.edge, r.image.slots.join('')].sort().join(' + ');
}
const EDGE_ORDER = (() => {
  const seen = [];
  for (const e of EDGES) for (const r of RECORDS) if (r.edge === e.id) { const k = edgeGroup(r); if (!seen.includes(k)) seen.push(k); }
  return seen;
})();
const ORDER_BY_EDGE = RECORDS.slice().sort((a, b) => EDGE_ORDER.indexOf(edgeGroup(a)) - EDGE_ORDER.indexOf(edgeGroup(b)) || a.id - b.id);

function groupsFor(step) {
  if (step === 'sectors') {
    return SECTOR_ROWS.map(s => ({
      key: s.key, color: SECTOR_COLOR[s.key],
      title: `${s.label}  ${s.count} records, weight ${wText(s.k)}`,
      ids: ORDER_BY_EDGE.filter(r => r.sector === s.key).map(r => r.id),
    }));
  }
  return EDGE_ORDER.map(k => {
    const ids = ORDER_BY_EDGE.filter(r => edgeGroup(r) === k).map(r => r.id);
    return { key: k, color: C.text, title: (k === 'arc' ? 'the arc: commutators' : k) + '  ' + ids.length + ' records', ids };
  });
}

// Positions of all records for a step at width W.
function layout(step, W, x0 = 0, y0 = 0, maxH = 0) {
  let L = layoutAt(step, W, x0, y0, W < 500 ? 29 : 34);
  // the saver: shrink the cells until the grid fits the clear band
  for (let target = 32; maxH && L.height > maxH && target > 12; target -= 2) L = layoutAt(step, W, x0, y0, target);
  return L;
}
function layoutAt(step, W, x0, y0, target) {
  const pad = 10;
  const cols = Math.max(6, Math.floor((W - 2 * pad) / target));
  const pitch = (W - 2 * pad) / cols, size = pitch - 3;
  const pos = new Map(), heads = [];
  let y = y0 + 6;
  for (const gr of groupsFor(step)) {
    heads.push({ ...gr, y: y + 9, x: x0 + pad });
    y += 22;
    gr.ids.forEach((id, n) => {
      const c = n % cols, r = Math.floor(n / cols);
      pos.set(id, { x: x0 + pad + c * pitch + pitch / 2, y: y + r * pitch + pitch / 2 });
    });
    y += Math.ceil(gr.ids.length / cols) * pitch + 8;
  }
  return { pos, heads, size, pitch, height: y - y0 + 4 };
}

function hit(st, p) {
  const L = st.L && st.L[st.step];
  if (!L) return null;
  for (const [id, q] of L.pos) if (Math.abs(p.x - q.x) <= L.pitch / 2 && Math.abs(p.y - q.y) <= L.pitch / 2) return id;
  return null;
}

function card(g, env, r, at, L) {
  const W = env.view.w, s = Math.min(94, W * 0.26);
  const w = Math.min(W - 16, 300), h = s + 20;
  let x = clamp(at.x - w / 2, env.view.x + 8, env.view.x + env.view.w - w - 8);
  let y = at.y + L.pitch / 2 + 6;
  if (y + h > env.view.y + env.view.h - 4) y = at.y - L.pitch / 2 - 6 - h;
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 16;
  rrect(g, x, y, w, h, 12); g.fillStyle = 'rgba(12,18,22,0.96)'; g.fill();
  g.shadowBlur = 0;
  g.strokeStyle = SECTOR_COLOR[r.sector]; g.lineWidth = 1.2; g.stroke();
  drawGlyph(g, r, x + 10 + s / 2, y + h / 2, s, { hi: 0.4 });
  const tx = x + 20 + s, fs = W < 420 ? 11 : 12;
  const lines = [
    ['Record ' + r.id, C.text, 600],
    [r.kind === 'commutator' ? 'commutator, order sign −1' : COMBO_TEXT[r.combo], C.dim, 500],
    ['X = ' + (r.X > 0 ? '+1' : '−1') + ',  Y = ' + (r.Y > 0 ? '+1' : '−1'), C.text, 500],
    ['k = ' + r.k + ',  weight ' + wText(r.k), SECTOR_COLOR[r.sector], 600],
  ];
  lines.forEach(([t, c, wgt], i) => label(g, t, tx, y + 18 + i * (fs + 7), { font: font(fs, wgt), color: c, align: 'left' }));
  g.restore();
}

function draw(g, env, st, t) {
  const W = env.view.w;
  if (!st.L || st.LW !== W || st.LY !== env.view.y || st.LH !== env.view.h) {
    const mh = env.fill ? env.view.h : 0;
    st.L = { edges: layout('edges', W, env.view.x, env.view.y, mh), sectors: layout('sectors', W, env.view.x, env.view.y, mh) };
    st.LW = W; st.LY = env.view.y; st.LH = env.view.h;
  }
  if (st.shown !== st.step) {
    // start a flight from where the cells are now
    st.from = st.shown ? st.L[st.shown].pos : null;
    st.transT = t; st.shown = st.step;
  }
  const L = st.L[st.step];
  const rank = new Map(); let k = 0; for (const id of L.pos.keys()) rank.set(id, k++);
  const fly = id => st.from ? ease(t - st.transT - rank.get(id) / RECORDS.length * 1.3, 0, 0.9) : ease(t - st.transT - rank.get(id) / RECORDS.length * 1.6, 0, 0.6);
  // headers
  const headA = ease(t - st.transT, 1.2, 2.2);
  for (const h of L.heads) label(g, h.title, h.x + 2, h.y, { font: font(W < 420 ? 11 : 12, 600), color: h.color, align: 'left', alpha: st.from ? headA : 1 });
  // auto walk of the highlight
  let sel = st.sel;
  if (sel == null && st.auto && t - st.transT > 2.6) {
    const ids = [...L.pos.keys()];
    sel = ids[(Math.floor((t - st.transT - 2.6) / 1.6) * 23 + 5) % ids.length];
  }
  st.shownSel = sel ?? st.hover ?? null;
  for (const r of RECORDS) {
    const to = L.pos.get(r.id), from = st.from ? st.from.get(r.id) : { x: to.x, y: to.y + 18 };
    const u = fly(r.id);
    const x = lerp(from.x, to.x, u), y = lerp(from.y, to.y, u) - Math.sin(Math.PI * u) * (st.from ? 26 : 0);
    const on = r.id === st.shownSel || r.id === st.hover;
    const shimmer = 0.88 + 0.12 * Math.sin(t * 1.8 - rank.get(r.id) * 0.21);
    drawGlyph(g, r, x, y, L.size, { alpha: (st.from ? 1 : u) * (on ? 1 : shimmer), hi: on ? 1 : 0 });
  }
  const showId = st.shownSel;
  if (showId != null && fly(showId) >= 1) card(g, env, BY_ID.get(showId), L.pos.get(showId), L);
}

export default {
  id: 'grid',
  title: 'All ' + RECORDS.length + ' records',
  steps: STEPS,
  analogy: {
    right: 'Every record is drawn, none is summarised: two letters on the square of slots, the faint copy its mirror image, the badge saying whether it is the sum or the difference of the two.',
    breaks: 'The drawings depend on the basis of letters chosen at each end; the counts and the weights do not. A glyph is a label for a direction of the readout space, not a picture of anything in space.',
  },
  height(W) {
    const a = layout('edges', W), b = layout('sectors', W);
    return Math.round(Math.max(a.height, b.height) + 8);
  },
  init(p) { return { sel: p.sel ?? null, hover: null }; },
  pointer(st, type, p, env, t) {
    const id = hit(st, p);
    if (type === 'hover') { if (id !== st.hover) { st.hover = id; return true; } return false; }
    if (type === 'leave') { if (st.hover != null) { st.hover = null; return true; } return false; }
    if (type === 'tap') { st.sel = id === st.sel ? null : id; st.auto = false; st.stepSince = t; return true; }
    return false;
  },
  draw,
  caption(st) {
    const id = st.shownSel ?? st.sel ?? st.hover;
    if (id != null && BY_ID.has(id)) {
      const r = BY_ID.get(id), tx = recordText(r);
      return `Record ${r.id}: ${tx.name}. Sector ${SECTOR_ROWS.find(x => x.key === r.sector).label}: X reads ${r.X > 0 ? '+1' : '−1'}, Y reads ${r.Y > 0 ? '+1' : '−1'}, so k = ${r.k} and it adds ${wText(r.k)}.`;
    }
    if (st.step === 'edges') return `The ${RECORDS.length} records of the model, grouped by the pair of slots they occupy. Tap a glyph to read it.`;
    return `The same ${RECORDS.length} records sorted into the four sectors: ${SECTOR_ORDER.map(k => SECTOR_ROWS.find(s => s.key === k).count).join(' + ')} = ${RECORDS.length}.`;
  },
};
