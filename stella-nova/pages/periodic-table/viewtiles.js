// ============================================================================
//  PERIODIC TABLE  ·  viewtiles.js  ·  the squircle view picker
// ----------------------------------------------------------------------------
//  One squircle tile per view in #views, at the top of the screen. Each
//  tile is a small canvas that draws the view's own layout (layouts.js
//  buildLayout) in the view's own colour mode: a live miniature, not an
//  icon. The squircle is a superellipse |x|^n + |y|^n = 1. The canvas
//  draws it, so the glow (CSS drop-shadow) follows the real shape.
//  The 3D tower miniature is an oblique sketch of bars, with height from
//  the electronegativity.
//
//  GREP MAP
//    grep -n "export function squircle"      the superellipse path
//    grep -n "export function miniPoints"    layout -> tile coordinates
//    grep -n "function drawTile"             one miniature
//    grep -n "export function mountViewTiles" the buttons and redraws
// ============================================================================
import { ELEMENTS } from './chem.js';
import { buildLayout } from './layouts.js';
import { colorOf, BG } from './render.js';

const SQ_N = 5;          // superellipse exponent: 2 = ellipse, large = square
const SQ_STEPS = 64;

/** Add a superellipse path (x, y, w, h) to the 2D context g. */
export function squircle(g, x, y, w, h, n = SQ_N) {
  const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2;
  g.beginPath();
  for (let i = 0; i <= SQ_STEPS; i++) {
    const t = (i / SQ_STEPS) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    const px = cx + rx * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
    const py = cy + ry * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
    if (i) g.lineTo(px, py); else g.moveTo(px, py);
  }
  g.closePath();
}

/**
 * The layout of view `id` fitted into a size x size tile with padding pad.
 * Returns { pts: [{ i, x, y, s, a }], disc, k }: tile pixels, centred.
 * The 3D tower comes back as an oblique sketch: y moves up by the height.
 */
export function miniPoints(id, size, pad = 0.17) {
  const L = buildLayout(id, { prop: 'en', year: 2030, source: 'crust', x: 'radius', y: 'ie1' });
  const tower = id === 'tower';
  const src = L.items.map((it, i) => {
    if (!tower) return { i, x: it.x, y: it.y, s: it.s, a: it.a };
    // oblique: rows recede up and to the right, bars rise by the height
    return { i, x: it.x + it.y * 0.42, y: it.y * 0.5 - it.h * 2.6, s: it.s, a: it.a, h: it.h, by: it.y * 0.5 };
  });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of src) {
    if (p.a <= 0) continue;
    x0 = Math.min(x0, p.x - p.s / 2); x1 = Math.max(x1, p.x + p.s / 2);
    y0 = Math.min(y0, p.y - p.s / 2); y1 = Math.max(y1, (tower ? p.by : p.y) + p.s / 2);
  }
  const inner = size * (1 - 2 * pad);
  const k = inner / Math.max(x1 - x0, y1 - y0);
  const ox = size / 2 - ((x0 + x1) / 2) * k, oy = size / 2 - ((y0 + y1) / 2) * k;
  const pts = src.map(p => ({ i: p.i, x: ox + p.x * k, y: oy + p.y * k, s: p.s * k, a: p.a, h: p.h, by: p.by == null ? null : oy + p.by * k }));
  return { pts, disc: !!L.disc, k, tower };
}

// The colour state a miniature uses: the view's own default colour mode.
function miniState(v) {
  return { color: v.id === 'tower' || v.id === 'heat' ? 'prop' : v.color, prop: 'en', cmap: v.id === 'heat' ? 'turbo' : 'magma', temp: 298 };
}

function drawTile(cv, v, active) {
  const dpr = Math.min(3, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
  const size = cv.clientWidth || 56;
  const px = Math.round(size * dpr);
  if (cv.width !== px) { cv.width = px; cv.height = px; }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, size, size);
  // body: a dark glass squircle with a soft light from the top left
  squircle(g, 0.5, 0.5, size - 1, size - 1);
  const bg = g.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, active ? '#1d2a4a' : '#141a2e');
  bg.addColorStop(1, active ? '#0c1226' : BG);
  g.fillStyle = bg; g.fill();
  g.save(); g.clip();
  const shine = g.createRadialGradient(size * 0.25, size * 0.1, 0, size * 0.25, size * 0.1, size * 0.9);
  shine.addColorStop(0, active ? 'rgba(127,180,255,0.22)' : 'rgba(127,180,255,0.1)');
  shine.addColorStop(1, 'rgba(127,180,255,0)');
  g.fillStyle = shine; g.fillRect(0, 0, size, size);
  // the miniature
  const S = miniState(v);
  const M = miniPoints(v.id, size);
  const order = M.tower ? M.pts.slice().sort((a, b) => a.by - b.by) : M.pts;
  for (const p of order) {
    if (p.a <= 0.01) continue;
    const col = colorOf(ELEMENTS[p.i], S) || '#4a5266';
    g.globalAlpha = (active ? 1 : 0.82) * Math.min(1, p.a);
    g.fillStyle = col;
    const s = Math.max(0.9, p.s * 0.86);
    if (M.tower) {
      const top = p.y, bot = p.by;
      g.globalAlpha *= 0.55;
      g.fillRect(p.x - s / 2, top, s, Math.max(0.6, bot - top));
      g.globalAlpha /= 0.55;
      g.fillRect(p.x - s / 2, top - s * 0.25, s, s * 0.5);
    } else if (M.disc) {
      g.beginPath(); g.arc(p.x, p.y, s / 2, 0, Math.PI * 2); g.fill();
    } else {
      g.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
  }
  g.restore();
  g.globalAlpha = 1;
  // rim
  squircle(g, 0.5, 0.5, size - 1, size - 1);
  g.lineWidth = 1;
  g.strokeStyle = active ? 'rgba(160,200,255,0.75)' : 'rgba(127,180,255,0.2)';
  g.stroke();
}

/**
 * Fill host with one tile button per view. onPick(id) runs on a click.
 * Returns { setActive(id), redraw() }.
 */
export function mountViewTiles(host, views, { onPick }) {
  const tiles = views.map(v => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'vtile'; b.dataset.view = v.id; b.title = v.hint;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-label', `${v.name}: ${v.hint}`);
    const cv = document.createElement('canvas');
    cv.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = v.name;
    b.append(cv, label);
    b.onclick = () => onPick(v.id);
    host.appendChild(b);
    return { v, b, cv };
  });
  let current = null;
  const redraw = () => { for (const t of tiles) drawTile(t.cv, t.v, t.v.id === current); };
  const api = {
    setActive(id) {
      if (id === current) return;
      current = id;
      for (const t of tiles) {
        const on = t.v.id === id;
        t.b.classList.toggle('on', on);
        t.b.setAttribute('aria-selected', String(on));
      }
      redraw();
      const on = tiles.find(t => t.v.id === id);
      if (on && on.b.scrollIntoView && host.scrollWidth > host.clientWidth) on.b.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    },
    redraw,
  };
  // the tile size changes between the desktop and phone layouts
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(redraw).observe(host);
  return api;
}
