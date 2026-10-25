// ============================================================================
//  BLACK OCTOBER  ·  render.js — draw the growth on a 2D canvas
// ----------------------------------------------------------------------------
//  drawScene(g, L, st) draws one frame of the layout L (grow.js) in CSS px.
//  The caller sets g to CSS px (setTransform(dpr, ...)). All positions go
//  through the view in st (model.js toScreen), so line widths stay 1 px at
//  every zoom: the lines stay crisp. No blur and no glow.
//
//  st = { w, h, view, zoom,       zoom = view.s / the fit scale
//         k, frac,                the first k nodes are shown; the edge of
//                                 node k-1 is drawn to frac (0..1)
//         colors,                 Map thread -> CSS colour (model.js)
//         hidden, confOff,        Sets: hidden threads, hidden confidences
//         hover, sel,             node ids or null
//         front,                  null or a time (ms): the growth front ring
//         labels,                 'auto' | 'none' | Set of ids to label
//         font }                  base text px (11 on a mouse, 12 on touch)
//
//  ENCODING (the page key in index.html says the same)
//    radius = time, one ring per UTC day; the inner band = before the window
//    one wedge per thread; a line = parent link, drawn outward in time
//    filled dot = confirmed, hollow = reported, hollow + slash = disputed
//    dot size = number of sources; a dashed arc = a related link
//
//  grep -n targets
//    frame ............ "export function drawScene"
//    band + rings ..... "function drawRings"
//    edges ............ "function drawEdges"
//    related arcs ..... "function drawRelated"
//    dots ............. "function drawNode"
//    text ............. "function drawLabels"
// ============================================================================
import { toScreen, dayLabel, monthLabel, placeLabels, relatedPairs, linksOf } from './model.js';

export const PAL = Object.freeze({
  bg: '#06070b', band: 'rgba(255,255,255,0.028)', ring: 'rgba(255,255,255,0.075)', ringMonth: 'rgba(255,255,255,0.16)',
  ringWin: 'rgba(255,255,255,0.22)', sector: 'rgba(255,255,255,0.035)', text: '#e6e8ee', dim: '#8b91a3', faint: '#5a6072',
  related: 'rgba(225,228,240,0.38)', front: 'rgba(255,255,255,0.55)', sel: '#ffffff',
});
const SANS = 'Inter, system-ui, -apple-system, sans-serif', SERIF = "'STIX Two Text', Georgia, serif";

// k: the dot scale of a small screen (st.dotScale, 1 on a large screen).
export function nodeRadius(n, zoom = 1, k = 1) {
  const z = Math.min(2.4, Math.max(1, Math.pow(zoom, 0.38)));
  return (1.5 + 0.62 * Math.sqrt(n.ev.sources.length) + (n.parent ? 0 : 0.9)) * z * k;
}

// Halo text: a stroke in the background colour under the fill.
function text(g, s, x, y, col, halo = PAL.bg) {
  g.lineWidth = 3; g.strokeStyle = halo; g.lineJoin = 'round'; g.strokeText(s, x, y);
  g.fillStyle = col; g.fillText(s, x, y);
}

function circle(g, v, r) {
  const [x, y] = toScreen(v, 0, 0);
  g.beginPath(); g.arc(x, y, Math.max(0, r * v.s), 0, Math.PI * 2);
}

function drawRings(g, L, st, boxes) {
  const v = st.view, f = st.font;
  const [ox, oy] = toScreen(v, 0, 0);
  g.font = `${f - 1}px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'bottom';
  if (L.band) {
    const B = L.band;
    g.beginPath(); g.arc(ox, oy, B.rMain * v.s, 0, Math.PI * 2); g.arc(ox, oy, Math.max(0, (B.r0 - 0.02) * v.s), 0, Math.PI * 2, true);
    g.fillStyle = PAL.band; g.fill('evenodd');
    g.setLineDash([2, 3]); g.lineWidth = 1; g.strokeStyle = PAL.ringMonth;
    let last = -1e9;
    for (const m of B.months) {
      circle(g, v, m.r); g.stroke();
      const py = oy - m.r * v.s;
      if (last - py >= f + 2 && m.r * v.s > 18) { g.setLineDash([]); text(g, monthLabel(m.t), ox, py - 1, PAL.faint); g.setLineDash([2, 3]); last = py; }
    }
    g.setLineDash([]);
    if (B.rMain * v.s > 30) {
      g.font = `italic ${f}px ${SERIF}`; g.textBaseline = 'middle';
      text(g, B.label, ox, oy + (B.r0 + B.r1) / 2 * v.s, PAL.dim);
      g.font = `${f - 1}px ${SANS}`; g.textBaseline = 'bottom';
    }
  }
  // the window start and the day rings
  g.lineWidth = 1; g.strokeStyle = PAL.ringWin;
  circle(g, v, L.radiusOf(L.tw)); g.stroke();
  g.strokeStyle = PAL.ring;
  let last = oy - L.radiusOf(L.tw) * v.s;
  for (const d of L.rings) {
    circle(g, v, d.r); g.stroke();
    const py = oy - d.r * v.s;
    if (last - py >= f + 3) { const s = dayLabel(d.t), w = g.measureText(s).width; text(g, s, ox, py - 1, PAL.dim); boxes.push({ x0: ox - w / 2 - 2, y0: py - f - 1, x1: ox + w / 2 + 2, y1: py }); last = py; }
  }
  // the thread wedges
  g.strokeStyle = PAL.sector; g.beginPath();
  const r0 = (L.band ? L.band.r0 : L.radiusOf(L.tw)) * v.s;
  for (const th of L.threads) for (const a of [th.a0, th.a1]) {
    g.moveTo(ox + Math.cos(a) * r0, oy + Math.sin(a) * r0); g.lineTo(ox + Math.cos(a) * v.s, oy + Math.sin(a) * v.s);
  }
  g.stroke();
}

function edgePath(g, v, pts, upto = 1) {
  const n = pts.length / 2, m = Math.max(2, Math.ceil(n * upto));
  let [x, y] = toScreen(v, pts[0], pts[1]);
  g.moveTo(x, y);
  for (let k = 1; k < m && k < n; k++) { [x, y] = toScreen(v, pts[k * 2], pts[k * 2 + 1]); g.lineTo(x, y); }
}

function drawEdges(g, L, st, focus) {
  const v = st.view, idx = st.index, lw = Math.min(2, 0.9 + 0.12 * Math.log2(Math.max(1, st.zoom)));
  g.lineWidth = lw; g.lineJoin = 'round'; g.lineCap = 'round';
  const byTh = new Map();
  for (const e of L.edges) {
    const i = idx.get(e.to), c = L.byId.get(e.to);
    if (i >= st.k || st.hidden.has(c.thread)) continue;
    if (!byTh.has(c.thread)) byTh.set(c.thread, []);
    byTh.get(c.thread).push(e);
  }
  for (const [th, list] of byTh) {
    g.strokeStyle = st.colors.get(th); g.globalAlpha = focus ? 0.28 : 0.72;
    g.beginPath();
    for (const e of list) edgePath(g, v, e.pts, idx.get(e.to) === st.k - 1 ? st.frac : 1);
    g.stroke();
  }
  g.globalAlpha = 1;
  if (focus) {
    g.lineWidth = lw + 0.8;
    for (const e of L.edges) {
      if (!focus.edges.has(e.to) || idx.get(e.to) >= st.k || st.hidden.has(L.byId.get(e.to).thread)) continue;
      g.strokeStyle = st.colors.get(L.byId.get(e.to).thread);
      g.beginPath(); edgePath(g, v, e.pts, idx.get(e.to) === st.k - 1 ? st.frac : 1); g.stroke();
    }
  }
}

function drawRelated(g, L, st, focus) {
  const v = st.view, idx = st.index;
  for (const [a, b] of st.pairs) {
    const A = L.byId.get(a), B = L.byId.get(b);
    if (idx.get(a) >= st.k || idx.get(b) >= st.k || st.hidden.has(A.thread) || st.hidden.has(B.thread)) continue;
    const on = focus && (focus.id === a || focus.id === b);
    const [x0, y0] = toScreen(v, A.x, A.y), [x1, y1] = toScreen(v, B.x, B.y);
    const [qx, qy] = toScreen(v, (A.x + B.x) * 0.22, (A.y + B.y) * 0.22);
    g.setLineDash(on ? [] : [3, 3]); g.lineWidth = on ? 1.6 : 1; g.strokeStyle = on ? PAL.sel : PAL.related;
    g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(qx, qy, x1, y1); g.stroke();
  }
  g.setLineDash([]);
}

// One dot. confirmed: filled. reported: hollow. disputed: hollow + slash.
export function drawNode(g, x, y, r, col, conf, bg = PAL.bg, halo = 1) {
  g.beginPath(); g.arc(x, y, r + halo, 0, Math.PI * 2); g.fillStyle = bg; g.fill();
  g.beginPath(); g.arc(x, y, conf === 'confirmed' ? r : Math.max(0.5, r - 0.6), 0, Math.PI * 2);
  if (conf === 'confirmed') { g.fillStyle = col; g.fill(); return; }
  g.lineWidth = 1.2; g.strokeStyle = col; g.stroke();
  if (conf === 'disputed') {
    const d = (r + 1.6) * Math.SQRT1_2;
    g.beginPath(); g.moveTo(x - d, y + d); g.lineTo(x + d, y - d); g.lineWidth = 1.3; g.stroke();
  }
}

function drawLabels(g, L, st, shown, boxes) {
  const v = st.view, f = st.font;
  // thread names at the rim
  g.font = `500 ${f}px ${SANS}`; g.textBaseline = 'middle';
  for (const th of L.threads) {
    if (st.hidden.has(th.id)) continue;
    const a = (th.a0 + th.a1) / 2, c = Math.cos(a), s = Math.sin(a);
    const [x, y] = toScreen(v, c * 1.03, s * 1.03), name = st.names(th.id), w = g.measureText(name).width;
    const lx = c >= 0 ? x : x - w, b = { x0: lx - 2, y0: y - f / 2 - 1, x1: lx + w + 2, y1: y + f / 2 + 1 };
    if (b.x1 < 0 || b.x0 > st.w || b.y1 < 0 || b.y0 > st.h) continue;
    if (boxes.some(q => b.x0 < q.x1 && b.x1 > q.x0 && b.y0 < q.y1 && b.y1 > q.y0)) continue;
    boxes.push(b); g.textAlign = 'left'; text(g, name, lx, y, st.colors.get(th.id));
  }
  if (st.labels === 'none') return;
  const want = st.labels instanceof Set ? st.labels : null;
  if (!want && st.zoom < 1.7 && !st.sel && !st.hover) return;
  g.font = `${f}px ${SANS}`;
  const items = [], maxCh = st.zoom > 4 ? 90 : st.zoom > 2.5 ? 60 : 40;
  for (const n of shown) {
    const force = n.id === st.sel || n.id === st.hover || (want && want.has(n.id));
    if (want ? !force : (!force && st.zoom < 1.7)) continue;
    const [x, y] = toScreen(v, n.x, n.y);
    if (x < -40 || x > st.w + 40 || y < -20 || y > st.h + 20) continue;
    const t = n.ev.title.length > maxCh ? n.ev.title.slice(0, maxCh - 1) + '…' : n.ev.title;
    items.push({ n, t, x, y, w: g.measureText(t).width, h: f + 2,
      pri: (force ? 1e6 : 0) + (n.parent ? 0 : 60) + (n.ev.confidence === 'disputed' ? 30 : 0) + n.ev.sources.length * 6 + n.t / 1e12 });
  }
  const dots = shown.map(n => { const [x, y] = toScreen(v, n.x, n.y), r = nodeRadius(n, st.zoom, st.dotScale); return { x0: x - r, y0: y - r, x1: x + r, y1: y + r }; });
  g.textAlign = 'left'; g.textBaseline = 'top';
  for (const it of placeLabels(items, boxes.concat(dots), 160)) text(g, it.t, it.lx, it.ly, it.n.id === st.sel ? PAL.sel : PAL.text);
}

export function drawScene(g, L, st) {
  const v = st.view;
  st.index = st.index || new Map(L.nodes.map((n, i) => [n.id, i]));
  st.pairs = st.pairs || relatedPairs(L);
  st.names = st.names || (id => id);
  st.dotScale = st.dotScale || 1;
  g.fillStyle = PAL.bg; g.fillRect(0, 0, st.w, st.h);
  const boxes = [];
  drawRings(g, L, st, boxes);
  const fid = st.sel || st.hover;
  let focus = null;
  if (fid && L.byId.has(fid)) {
    const lk = linksOf(L, fid);
    focus = { id: fid, edges: new Set([fid, ...lk.chain.slice(0, -1)]), near: new Set([fid, ...lk.chain, ...lk.children, ...lk.related]) };
    for (const c of lk.children) focus.edges.add(c);
  }
  drawEdges(g, L, st, focus);
  drawRelated(g, L, st, focus);
  const shown = [];
  for (let i = 0; i < st.k && i < L.nodes.length; i++) {
    const n = L.nodes[i];
    if (st.hidden.has(n.thread) || st.confOff.has(n.ev.confidence)) continue;
    shown.push(n);
  }
  for (const n of shown) {
    const [x, y] = toScreen(v, n.x, n.y);
    if (x < -10 || x > st.w + 10 || y < -10 || y > st.h + 10) continue;
    if (n === L.nodes[st.k - 1] && st.frac < 1) continue;
    g.globalAlpha = focus && !focus.near.has(n.id) ? 0.45 : 1;
    drawNode(g, x, y, nodeRadius(n, st.zoom, st.dotScale), st.colors.get(n.thread), n.ev.confidence, PAL.bg, st.dotScale < 1 ? 0.5 : 1);
  }
  g.globalAlpha = 1;
  for (const id of [st.hover, st.sel]) {
    const n = id && L.byId.get(id);
    if (!n || st.index.get(id) >= st.k) continue;
    const [x, y] = toScreen(v, n.x, n.y);
    g.beginPath(); g.arc(x, y, nodeRadius(n, st.zoom, st.dotScale) + 3.5, 0, Math.PI * 2);
    g.lineWidth = id === st.sel ? 1.6 : 1; g.strokeStyle = PAL.sel; g.stroke();
  }
  if (st.front != null) {
    const r = L.radiusOf(st.front);
    g.lineWidth = 1; g.strokeStyle = PAL.front; g.setLineDash([1, 3]);
    circle(g, v, r); g.stroke(); g.setLineDash([]);
  }
  drawLabels(g, L, st, shown, boxes);
}
