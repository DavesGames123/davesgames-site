// ============================================================================
//  CNN EXPLAINER  ·  draw.js  the network overview on one 2D canvas
// ----------------------------------------------------------------------------
//  drawNetwork(g, L, opts) draws the layout of layout.js: the column (or
//  block) titles, every feature map from maps.js, the output bars, and the
//  hover links: the edges from the maps that feed the map under the pointer
//  and its receptive field in every earlier layer, down to the picture.
//  With opts.flow (the guided run of tour.js) it draws the layers that the
//  run has passed, the active layer as it fills in, the edges and dots of
//  the data that flows into it, and the layers ahead as faint tiles.
//  The page and the screensaver both call it. g is in CSS px (the caller
//  sets the device-pixel transform).
//
//  grep -n 'export const THEME'        colours and fonts of the canvas
//  grep -n 'export function drawNetwork'
//  grep -n 'function drawLinks'        edges + receptive field rectangles
//  grep -n 'function drawBars'         the class bars (and the winner ring)
//  grep -n 'export function barWidths' the drawn width of each class bar
//  grep -n 'export function fillOf'    how far a map of the run has filled
//  grep -n 'function fillIn'           one map of the active layer
//  grep -n 'function drawFlowLines'    the edges into the active layer
//  grep -n 'function drawParticles'    the dots that run along them
//  grep -n 'export function roundRect' a rounded rectangle path
// ============================================================================
import { ARCH, CLASSES, receptiveField } from './net.js';
import { GRID, feeders, fieldMaps, mapRect, prevShown } from './layout.js';

export const THEME = {
  bg: '#0b0d13', ink: '#e6e9f0', dim: '#9aa3b5', faint: '#5d6578', line: 'rgba(255,255,255,0.09)',
  accent: '#ffa06e', field: '#ffd666', edge: 'rgba(156,200,255,0.42)', pos: '#62c4ff', neg: '#ff9a62',
  bar: 'rgba(255,255,255,0.22)', track: 'rgba(255,255,255,0.06)',
  sans: 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif', serif: '"STIX Two Text", Georgia, serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};

export function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

const pct = p => (p >= 0.995 ? (p * 100).toFixed(0) : p >= 0.1 ? (p * 100).toFixed(1) : (p * 100).toFixed(2)) + '%';

// opts: maps (maps.js), result, hover, focus ({ li, c } or { bar }), reveal
// (li -> 0..1), labels (true), barT (0..1, the bars grow in), win (0..1,
// the top class lights up), flow (the guided run: { li, k, time, reduced },
// see drawFlow), zoom ({ li, f }: the column of an open zoom fades out).
// Returns { bars }: the drawn width of each class bar (the tests read it).
export function drawNetwork(g, L, o = {}) {
  const T = THEME, reveal = o.reveal || (() => 1), labels = o.labels !== false;
  const flow = o.flow || null, zoom = o.zoom && o.zoom.f > 0 ? o.zoom : null;
  const zf = li => (zoom && zoom.li === li ? 1 - zoom.f : 1);
  // title alpha: in a run, the layers ahead are dim
  const titleA = li => (flow ? (li < flow.li ? 0.85 : li === flow.li ? 1 : 0.4) : Math.min(1, 0.35 + reveal(li))) * zf(li);
  g.save();
  g.textBaseline = 'alphabetic';
  // titles
  if (labels) for (const col of L.cols) {
    const a = titleA(col.li);
    if (a <= 0.02) continue;
    g.globalAlpha = a;
    const on = flow && flow.li === col.li && !flow.ended;
    if (L.orient === 'h') {
      if (col.w < 34 && !on) continue;
      g.textAlign = 'center';
      g.font = `${on ? 600 : 500} 12px ${T.sans}`; g.fillStyle = on ? T.accent : o.hover && o.hover.li === col.li ? T.ink : T.dim;
      g.fillText(col.label, col.cx, L.head - 20);
      if (col.w >= 52) { g.font = `400 10.5px ${T.sans}`; g.fillStyle = T.faint; g.fillText(col.sub, col.cx, L.head - 6); }
    } else {
      if (L.inline && col.li < 11) {
        g.textAlign = 'left'; g.font = `500 11px ${T.sans}`; g.fillStyle = on ? T.accent : T.dim;
        g.fillText(col.label, col.x, col.y + col.rowH / 2 + 4);
        continue;
      }
      const ty = col.y + Math.min(20, (L.title || 34) - 6);
      g.textAlign = 'left'; g.font = `500 14px ${T.serif}`; g.fillStyle = on ? T.accent : T.ink;
      g.fillText(col.label, col.x, ty);
      g.textAlign = 'right'; g.font = `400 11.5px ${T.sans}`; g.fillStyle = T.faint;
      g.fillText(col.sub, col.x + col.w, ty);
    }
  }
  g.globalAlpha = 1;
  // the lines into the active layer go under the maps
  if (flow && !flow.ended) drawFlowLines(g, L, flow, o);
  // maps
  g.imageSmoothingEnabled = false;
  for (const m of L.maps) {
    const z = zf(m.li); if (z <= 0) continue;
    if (flow && m.li > flow.li) { ghost(g, m, 0.55 * z); continue; }
    if (flow && m.li === flow.li && flow.k < 1) { fillIn(g, L, m, flow, o.maps, z); continue; }
    const a = (flow ? 1 : reveal(m.li)) * z; if (a <= 0) continue;
    const im = o.maps && o.maps.img(m.li, m.c);
    g.globalAlpha = a;
    if (im && im.width) g.drawImage(im, m.x, m.y, m.s, m.s);
    else { g.fillStyle = T.track; g.fillRect(m.x, m.y, m.s, m.s); }
    g.strokeStyle = T.line; g.lineWidth = 1; g.strokeRect(m.x + 0.5, m.y + 0.5, m.s - 1, m.s - 1);
  }
  g.globalAlpha = 1;
  if (flow && !flow.ended && !flow.reduced) drawParticles(g, L, flow, o);
  let bars = null;
  if (o.result) bars = drawBars(g, L, o.result, o, (flow ? (flow.li >= 11 ? 1 : 0.55) : reveal(11)) * zf(11), o.barT == null ? 1 : o.barT, o.win == null ? 0 : o.win);
  if (o.hover) drawLinks(g, L, o.hover, o);
  if (o.focus) {
    const r = o.focus.bar != null ? L.bars[o.focus.bar] : mapRect(L, o.focus.li, o.focus.c);
    if (r) {
      g.strokeStyle = T.accent; g.lineWidth = 2;
      const w = r.s || r.w, h = r.s || r.h;
      roundRect(g, r.x - 3, r.y - 3, w + 6, h + 6, 4); g.stroke();
    }
  }
  g.restore();
  return { bars };
}

// a map the run has not reached: a faint tile with its outline
function ghost(g, m, a) {
  g.globalAlpha = a;
  g.fillStyle = THEME.track; g.fillRect(m.x, m.y, m.s, m.s);
  g.strokeStyle = THEME.line; g.lineWidth = 1; g.strokeRect(m.x + 0.5, m.y + 0.5, m.s - 1, m.s - 1);
  g.globalAlpha = 1;
}

const ease = k => { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); };

// How far map c of the active layer has filled in (0..1) at flow k. The
// maps start one after the other, so the fill runs down the column.
export function fillOf(li, c, k, reduced = false) {
  if (reduced) return ease(k / 0.3);
  if (li === 0) return c < 0 ? ease(k / 0.25) : ease((k - 0.25 - c * 0.12) / 0.4);
  return Math.max(0, Math.min(1, (k - 0.12 - Math.max(0, c) * 0.035) / 0.45));
}

// One map of the active layer. Input: the picture fades in, then the red,
// green and blue maps move out of it to their places. Other layers: the
// map fills in row by row behind a scan line (a fade with reduced motion).
function fillIn(g, L, m, flow, maps, z) {
  const T = THEME, q = fillOf(m.li, m.c, flow.k, flow.reduced), im = maps && maps.img(m.li, m.c);
  if (m.li === 0 && m.c >= 0 && !flow.reduced) {
    if (q <= 0) return;
    // the channel moves out of the picture
    const pic = mapRect(L, 0, -1);
    const x = pic ? pic.x + (m.x - pic.x) * q : m.x, y = pic ? pic.y + (m.y - pic.y) * q : m.y;
    g.globalAlpha = Math.min(1, q * 1.6) * z;
    if (im && im.width) g.drawImage(im, x, y, m.s, m.s);
    g.strokeStyle = T.line; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, m.s - 1, m.s - 1);
    g.globalAlpha = 1;
    return;
  }
  if (flow.reduced || m.li === 0) {
    ghost(g, m, 0.55 * z);
    if (q <= 0) return;
    g.globalAlpha = q * z;
    if (im && im.width) g.drawImage(im, m.x, m.y, m.s, m.s);
    g.globalAlpha = 1;
    return;
  }
  ghost(g, m, 0.55 * z);
  if (q <= 0) return;
  const n = GRID[m.li], cell = m.s / n, rows = q * n, full = Math.floor(rows), part = rows - full;
  g.save();
  g.beginPath();
  if (full > 0) g.rect(m.x, m.y, m.s, full * cell);
  if (full < n) g.rect(m.x, m.y + full * cell, part * m.s, cell);
  g.clip();
  g.globalAlpha = z;
  if (im && im.width) g.drawImage(im, m.x, m.y, m.s, m.s);
  g.restore();
  if (q < 1) {
    // the scan: the line under the filled rows and the window on it
    const yy = m.y + Math.min(full, n - 1) * cell;
    g.globalAlpha = 0.9 * z;
    g.fillStyle = T.field; g.fillRect(m.x, yy + cell - 0.5, part * m.s, Math.max(1, Math.min(1.5, cell)));
    g.strokeStyle = T.field; g.lineWidth = 1;
    const kw = Math.max(2, cell * (ARCHK[m.li] || 1));
    g.strokeRect(m.x + part * m.s - kw / 2, yy + cell / 2 - kw / 2, kw, kw);
    g.globalAlpha = 1;
  }
}
// the window of a layer type, in cells of the output (conv 3, pool 2)
const ARCHK = [1, 3, 1, 3, 1, 2, 3, 1, 3, 1, 2, 1];

// the anchors of an edge from map (or bar) a to map (or bar) b
function edge(L, a, b) {
  const as = a.s || a.h, bs = b.s || b.h;
  if (L.orient === 'h') {
    const x0 = a.x + (a.s || a.w), y0 = a.y + as / 2, x1 = b.x - 2, y1 = b.y + bs / 2, mx = (x0 + x1) / 2;
    return [x0, y0, mx, y0, mx, y1, x1, y1];
  }
  const x0 = a.x + (a.s || a.w) / 2, y0 = a.y + as, x1 = b.x + (b.s ? b.s / 2 : 12), y1 = b.y - 2, my = (y0 + y1) / 2;
  return [x0, y0, x0, my, x1, my, x1, y1];
}
function bez(e, t) {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * e[0] + b * e[2] + c * e[4] + d * e[6], a * e[1] + b * e[3] + c * e[5] + d * e[7]];
}

// The edges into the active layer: from each map that feeds a map of it
// (every map for a conv, the same map for ReLU and pool), or from the last
// pooled maps into the class bars. dst(k) is the fill of target k.
function flowPairs(L, flow) {
  const li = flow.li, src = prevShown(L, li);
  if (li < 1 || src < 0) return [];
  const pairs = [];
  if (li === 11) {
    const ms = L.maps.filter(m => m.li === src);
    for (const b of L.bars) for (const m of ms) pairs.push({ a: m, b, c: b.i, h: (m.c * 7 + b.i * 13) % 17 / 17 });
    return pairs;
  }
  const t = ARCH[li].type;
  for (const d of L.maps.filter(m => m.li === li)) {
    for (const k of feeders(li, d.c)) {
      const a = mapRect(L, src, src === 0 ? k : t === 'conv' ? k : d.c);
      if (a) pairs.push({ a, b: d, c: d.c, h: (k * 7 + d.c * 13) % 17 / 17 });
    }
  }
  return pairs;
}
// the lines are visible while the data moves, then fade
const lineEnv = k => ease(k / 0.12) * (1 - ease((k - 0.82) / 0.18));

function drawFlowLines(g, L, flow, o) {
  if (flow.li < 1) return;
  const env = flow.reduced ? 0.6 * (1 - ease((flow.k - 0.5) / 0.5)) : lineEnv(flow.k);
  if (env <= 0.01) return;
  const pairs = flowPairs(L, flow), many = pairs.length > 40;
  g.save();
  g.strokeStyle = THEME.edge; g.lineWidth = 1;
  g.globalAlpha = env * (many ? 0.22 : 0.5);
  g.beginPath();
  for (const p of pairs) { const e = edge(L, p.a, p.b); g.moveTo(e[0], e[1]); g.bezierCurveTo(e[2], e[3], e[4], e[5], e[6], e[7]); }
  g.stroke();
  g.restore();
}

// Dots run along the edges while their target map is still filling in:
// the values on their way. Their colour is the bright end of the gradient.
function drawParticles(g, L, flow, o) {
  if (flow.li < 1) return;
  const env = lineEnv(flow.k);
  if (env <= 0.01) return;
  const pairs = flowPairs(L, flow), out = flow.li === 11;
  const per = out ? 2 : pairs.length > 40 ? 1 : 3;
  const col = o.maps && o.maps.rgb ? o.maps.rgb(0.86) : THEME.field;
  g.save();
  g.fillStyle = col;
  for (const p of pairs) {
    const q = out ? Math.min(1, flow.k / 0.55) : fillOf(flow.li, p.c, flow.k);
    if (q >= 1) continue;
    const e = edge(L, p.a, p.b);
    for (let j = 0; j < per; j++) {
      const ph = (flow.time * 0.6 + p.h + j / per) % 1;
      const [x, y] = bez(e, ph);
      g.globalAlpha = env * Math.sin(Math.PI * ph) * (out ? 0.75 : 0.9);
      g.fillRect(x - 1.2, y - 1.2, 2.4, 2.4);
    }
  }
  g.restore();
}

// The drawn width of each class bar: the probability times the bar width,
// times grow (0..1). The output column of the run, the page and the tests
// use it.
export function barWidths(L, probs, grow = 1) {
  return L.bars.map(b => {
    const bh = Math.max(3, Math.min(7, b.h * 0.16)), p = probs[b.i] * grow;
    return p > 0.0005 ? Math.max(bh, b.w * p) : 0;
  });
}

function drawBars(g, L, result, o, alpha, grow, win) {
  const T = THEME, probs = result.probs, top = result.top, widths = barWidths(L, probs, grow);
  g.save(); g.globalAlpha = alpha;
  for (const b of L.bars) {
    const on = b.i === top && (grow >= 1 || win > 0), hov = o.hover && o.hover.kind === 'bar' && o.hover.i === b.i;
    const fs = L.orient === 'h' ? Math.max(10.5, Math.min(13, b.h * 0.32)) : 13;
    const ty = L.orient === 'h' ? b.y + Math.min(b.h * 0.5, fs + 4) : b.y + fs + 1;
    const text = b.w >= 90;
    if (text) {
      g.font = `${on ? 600 : 400} ${fs}px ${T.sans}`; g.textAlign = 'left';
      g.fillStyle = on ? T.ink : hov ? T.ink : T.dim;
      g.fillText(CLASSES[b.i], b.x, ty);
      if (o.labels !== false && grow > 0) {
        g.textAlign = 'right'; g.font = `400 ${fs - 1}px ${T.mono}`; g.fillStyle = on ? T.accent : T.faint;
        g.fillText(pct(probs[b.i] * grow), b.x + b.w, ty);
      }
    }
    const by = text ? ty + 5 : b.y + b.h / 2 - 2, bh = Math.max(3, Math.min(7, b.h * 0.16));
    g.fillStyle = T.track; roundRect(g, b.x, by, b.w, bh, bh / 2); g.fill();
    if (widths[b.i] > 0) { g.fillStyle = on ? T.accent : T.bar; roundRect(g, b.x, by, widths[b.i], bh, bh / 2); g.fill(); }
    if (on && win > 0 && win < 1.01) {
      // the winner: a ring that fades in
      g.save(); g.globalAlpha = alpha * win * 0.9; g.strokeStyle = T.accent; g.lineWidth = 1.5;
      roundRect(g, b.x - 5, b.y - 3, b.w + 10, b.h + 6, 6); g.stroke(); g.restore();
    }
  }
  g.restore();
  return widths;
}

function drawLinks(g, L, hv, o) {
  const T = THEME;
  g.save();
  // edges into the hovered map or bar (columns only; the phone blocks
  // outline the feeding maps instead)
  let li, c;
  if (hv.kind === 'bar') { li = 11; c = hv.i; } else { li = hv.li; c = hv.c; }
  if (li >= 1) {
    const dst = li === 11 ? L.bars[c] : mapRect(L, li, c);
    const srcs = feeders(li, c).map(k => mapRect(L, li - 1, k)).filter(Boolean);
    if (dst) {
      g.strokeStyle = T.edge; g.lineWidth = 1;
      for (const s of srcs) {
        if (L.orient === 'h') {
          const x0 = s.x + s.s, y0 = s.y + s.s / 2, x1 = dst.x - 2, y1 = dst.y + (dst.s || dst.h) / 2, mx = (x0 + x1) / 2;
          g.beginPath(); g.moveTo(x0, y0); g.bezierCurveTo(mx, y0, mx, y1, x1, y1); g.stroke();
        } else {
          g.strokeRect(s.x - 1.5, s.y - 1.5, s.s + 3, s.s + 3);
        }
      }
      if (li === 0 || hv.kind !== 'bar') {
        const r = dst; g.strokeStyle = T.accent; g.lineWidth = 1.5;
        if (r.s) g.strokeRect(r.x - 1.5, r.y - 1.5, r.s + 3, r.s + 3);
      }
    }
  }
  // receptive field of the hovered cell
  if (hv.kind === 'map' && hv.gy != null && hv.li >= 1) {
    g.strokeStyle = T.field; g.lineWidth = 1.25;
    const self = mapRect(L, hv.li, hv.c), n = GRID[hv.li];
    if (self) { const k = self.s / n; g.strokeRect(self.x + hv.gx * k, self.y + hv.gy * k, Math.max(2, k), Math.max(2, k)); }
    for (const f of receptiveField(hv.li, hv.gy, hv.gx)) {
      const nn = GRID[f.li];
      for (const ch of fieldMaps(hv.li, hv.c, f.li)) {
        const r = mapRect(L, f.li, ch); if (!r) continue;
        const k = r.s / nn;
        g.globalAlpha = 0.9;
        g.strokeRect(r.x + f.x0 * k, r.y + f.y0 * k, Math.max(2, f.size * k), Math.max(2, f.size * k));
      }
    }
  }
  g.restore();
}
