// ============================================================================
//  CNN EXPLAINER  ·  draw.js  the network overview on one 2D canvas
// ----------------------------------------------------------------------------
//  drawNetwork(g, L, opts) draws the layout of layout.js: the column (or
//  block) titles, every feature map from maps.js, the output bars, and the
//  hover links: the edges from the maps that feed the map under the pointer
//  and its receptive field in every earlier layer, down to the picture.
//  The page and the screensaver both call it. g is in CSS px (the caller
//  sets the device-pixel transform).
//
//  grep -n 'export const THEME'        colours and fonts of the canvas
//  grep -n 'export function drawNetwork'
//  grep -n 'function drawLinks'        edges + receptive field rectangles
//  grep -n 'function drawBars'         the class bars
//  grep -n 'export function roundRect' a rounded rectangle path
// ============================================================================
import { CLASSES, receptiveField } from './net.js';
import { GRID, feeders, fieldMaps, mapRect } from './layout.js';

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
// (li -> 0..1), labels (true), barT (0..1, the bars grow in), dim (0..1).
export function drawNetwork(g, L, o = {}) {
  const T = THEME, reveal = o.reveal || (() => 1), labels = o.labels !== false;
  g.save();
  g.textBaseline = 'alphabetic';
  // titles
  if (labels) for (const col of L.cols) {
    const a = Math.min(1, 0.35 + reveal(col.li));
    g.globalAlpha = a;
    if (L.orient === 'h') {
      g.textAlign = 'center';
      g.font = `500 12px ${T.sans}`; g.fillStyle = o.hover && o.hover.li === col.li ? T.ink : T.dim;
      g.fillText(col.label, col.cx, L.head - 20);
      g.font = `400 10.5px ${T.sans}`; g.fillStyle = T.faint;
      g.fillText(col.sub, col.cx, L.head - 6);
    } else {
      if (L.inline && col.li < 11) {
        g.textAlign = 'left'; g.font = `500 11px ${T.sans}`; g.fillStyle = T.dim;
        g.fillText(col.label, col.x, col.y + col.rowH / 2 + 4);
        continue;
      }
      const ty = col.y + Math.min(20, (L.title || 34) - 6);
      g.textAlign = 'left'; g.font = `500 14px ${T.serif}`; g.fillStyle = T.ink;
      g.fillText(col.label, col.x, ty);
      g.textAlign = 'right'; g.font = `400 11.5px ${T.sans}`; g.fillStyle = T.faint;
      g.fillText(col.sub, col.x + col.w, ty);
    }
  }
  g.globalAlpha = 1;
  // maps
  g.imageSmoothingEnabled = false;
  for (const m of L.maps) {
    const a = reveal(m.li); if (a <= 0) continue;
    const im = o.maps && o.maps.img(m.li, m.c);
    g.globalAlpha = a;
    if (im && im.width) g.drawImage(im, m.x, m.y, m.s, m.s);
    else { g.fillStyle = T.track; g.fillRect(m.x, m.y, m.s, m.s); }
    g.strokeStyle = T.line; g.lineWidth = 1; g.strokeRect(m.x + 0.5, m.y + 0.5, m.s - 1, m.s - 1);
  }
  g.globalAlpha = 1;
  if (o.result) drawBars(g, L, o.result, o, reveal(11), o.barT == null ? 1 : o.barT);
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
}

function drawBars(g, L, result, o, alpha, grow) {
  const T = THEME, probs = result.probs, top = result.top;
  g.save(); g.globalAlpha = alpha;
  for (const b of L.bars) {
    const p = probs[b.i] * grow, on = b.i === top, hov = o.hover && o.hover.kind === 'bar' && o.hover.i === b.i;
    const fs = L.orient === 'h' ? Math.max(10.5, Math.min(13, b.h * 0.32)) : 13;
    const ty = L.orient === 'h' ? b.y + Math.min(b.h * 0.5, fs + 4) : b.y + fs + 1;
    g.font = `${on ? 600 : 400} ${fs}px ${T.sans}`; g.textAlign = 'left';
    g.fillStyle = on ? T.ink : hov ? T.ink : T.dim;
    g.fillText(CLASSES[b.i], b.x, ty);
    if (o.labels !== false) {
      g.textAlign = 'right'; g.font = `400 ${fs - 1}px ${T.mono}`; g.fillStyle = on ? T.accent : T.faint;
      g.fillText(pct(probs[b.i]), b.x + b.w, ty);
    }
    const by = ty + 5, bh = Math.max(3, Math.min(7, b.h * 0.16));
    g.fillStyle = T.track; roundRect(g, b.x, by, b.w, bh, bh / 2); g.fill();
    if (p > 0.0005) { g.fillStyle = on ? T.accent : T.bar; roundRect(g, b.x, by, Math.max(bh, b.w * p), bh, bh / 2); g.fill(); }
  }
  g.restore();
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
