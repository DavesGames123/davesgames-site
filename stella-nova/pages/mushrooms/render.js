// ============================================================================
//  MUSHROOM DRAW  ·  render.js — a plate on a 2D canvas, as vectors
// ----------------------------------------------------------------------------
//  Original code (davesgames.io). Lines are paths through the view
//  transform on each draw, never a cached raster, so a zoom stays sharp.
//  The paper grain is the only raster: a small noise tile at screen scale.
//
//  drawPlate(ctx, P) draws one plate. P:
//    L        the layout from plate.js layoutPlate()
//    theme    a THEMES entry; ink overrides theme.ink when set
//    style    'pen' | 'brush' | 'wash' (plate.js STYLES)
//    pen      the pen width in mm; jitter 0..1 (hand-drawn wobble)
//    specs    [spec | null] by cell (engine.js buildSpecimen results)
//    progress [null | length] by cell: null draws all, a number draws that
//             many units of line in the draw-on order
//    view     { s, ox, oy }: device px per mm, device px of the plate origin
//    grain, marker, hiCell, paperOut, dpr, scale (true: a scale bar)
//  drawSpec() draws one specimen at a fit; the saver uses it for close-ups.
//
//  GREP MAP
//    grep -n 'export function drawPlate'   the plate
//    grep -n 'export function drawSpec'    one specimen: washes, then lines
//    grep -n 'export function specPoints'  the jittered points, cached
//    grep -n 'export function brushPolys'  the brush stroke polygons, cached
//    grep -n 'export function washFill'    the wash colour for a style
//    grep -n 'function tracePartial'       the draw-on path to a length
//    grep -n 'export function makeGrain'   the paper noise tile
// ============================================================================
import { mulberry, brushPoly } from './geom.js';
import { fitSpec, scaleBar, specExtras } from './plate.js';

export const SERIF = '"STIX Two Text", "Times New Roman", Georgia, serif';
export function labelFont(size, style) {
  return (style === 'italic' ? 'italic ' : '') + size.toFixed(2) + 'px ' + SERIF;
}
// Pen width factor by line kind: outline, detail, hatch, ground.
export const PEN_K = [1, 0.72, 0.55, 0.55];
export const BRUSH_K = [2.6, 1.5, 0.95, 1.1];

// ── jitter ──────────────────────────────────────────────────────────────────
// Each polyline gets a small shift and two slow waves along its length.
// The amplitude is a share of the specimen size.
const ptsCache = new WeakMap();
export function specPoints(f, jitter) {
  const key = Math.round(jitter * 100);
  let m = ptsCache.get(f);
  if (!m) { m = new Map(); ptsCache.set(f, m); }
  if (m.has(key)) return m.get(key);
  let out;
  if (!key) out = { xy: f.xy, brush: new Map() };
  else {
    const amt = key / 100 * Math.hypot(f.bbox.w, f.bbox.h) * 0.0035, xy = new Float64Array(f.xy.length);
    const n = f.offs.length - 1, wl = Math.hypot(f.bbox.w, f.bbox.h) / 60;
    for (let i = 0; i < n; i++) {
      const r = mulberry((f.seed ^ Math.imul(i + 1, 0x9E3779B1)) >>> 0);
      const a1 = r() * 6.283, a2 = r() * 6.283, b1 = r() * 6.283, b2 = r() * 6.283;
      const sx = (r() - 0.5) * amt * 0.8, sy = (r() - 0.5) * amt * 0.8;
      let s = 0;
      for (let k = f.offs[i]; k < f.offs[i + 1]; k++) {
        if (k > f.offs[i]) s += Math.hypot(f.xy[k * 2] - f.xy[k * 2 - 2], f.xy[k * 2 + 1] - f.xy[k * 2 - 1]);
        xy[k * 2] = f.xy[k * 2] + sx + amt * (0.55 * Math.sin(s / (wl * 5) + a1) + 0.3 * Math.sin(s / (wl * 1.5) + a2));
        xy[k * 2 + 1] = f.xy[k * 2 + 1] + sy + amt * (0.55 * Math.sin(s / (wl * 6) + b1) + 0.3 * Math.sin(s / (wl * 1.8) + b2));
      }
    }
    out = { xy, brush: new Map() };
  }
  m.set(key, out);
  return out;
}
// The pen paths, one per line kind.
export function kindPaths(f, jitter) {
  const P = specPoints(f, jitter);
  if (P.paths) return P.paths;
  const paths = [new Path2D(), new Path2D(), new Path2D(), new Path2D()], xy = P.xy;
  for (let i = 0; i + 1 < f.offs.length; i++) {
    const a = f.offs[i], b = f.offs[i + 1], p = paths[f.kinds[i]];
    if (b - a < 2) continue;
    p.moveTo(xy[a * 2], xy[a * 2 + 1]);
    for (let k = a + 1; k < b; k++) p.lineTo(xy[k * 2], xy[k * 2 + 1]);
  }
  return (P.paths = paths);
}
// The brush polygons for a base width w (units), per polyline.
export function brushPolys(f, jitter, w) {
  const P = specPoints(f, jitter), key = w.toPrecision(3);
  if (P.brush.has(key)) return P.brush.get(key);
  const out = [];
  for (let i = 0; i + 1 < f.offs.length; i++) out.push(brushPoly(P.xy, f.offs[i], f.offs[i + 1], w * BRUSH_K[f.kinds[i]], (f.seed ^ (i * 7919)) >>> 0));
  if (P.brush.size > 6) P.brush.clear();
  P.brush.set(key, out);
  return out;
}
function brushPath(polys, from, to) {
  const p = new Path2D();
  for (let i = from; i < to; i++) {
    const q = polys[i];
    if (!q) continue;
    p.moveTo(q[0], q[1]);
    for (let k = 2; k < q.length; k += 2) p.lineTo(q[k], q[k + 1]);
    p.closePath();
  }
  return p;
}

// ── colour ──────────────────────────────────────────────────────────────────
export function mixHex(a, b, t) {
  const A = parseInt(a.slice(1), 16), B = parseInt(b.slice(1), 16);
  const ch = s => Math.round(((A >> s) & 255) * (1 - t) + ((B >> s) & 255) * t);
  return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
}
const lit = h => { const n = parseInt(h.slice(1), 16); return (((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11) / 255; };
// The fill of a wash in a style, or null (pen draws no washes).
export function washFill(theme, ink, style, color) {
  if (style === 'wash') {
    const dk = lit(theme.paper) < 0.4;
    return mixHex(theme.paper, color, dk ? 0.5 : 0.68);
  }
  if (style === 'brush') return mixHex(theme.paper, ink, 0.05 + 0.16 * (1 - lit(color)));
  return null;
}

// The path of the first `len` units of line in f.order. Returns the tip.
function tracePartial(ctx, f, xy, len) {
  let acc = 0, tip = null, done = 0;
  const n = f.offs.length - 1, ord = f.order;
  ctx.beginPath();
  for (let j = 0; j < n; j++) {
    const i = ord ? ord[j] : j, a = f.offs[i], b = f.offs[i + 1], L = f.lens[i];
    if (b - a < 2) { done = j + 1; continue; }
    ctx.moveTo(xy[a * 2], xy[a * 2 + 1]);
    if (acc + L <= len) { for (let k = a + 1; k < b; k++) ctx.lineTo(xy[k * 2], xy[k * 2 + 1]); acc += L; done = j + 1; continue; }
    let rest = len - acc;
    for (let k = a + 1; k < b; k++) {
      const x0 = xy[k * 2 - 2], y0 = xy[k * 2 - 1], x1 = xy[k * 2], y1 = xy[k * 2 + 1], d = Math.hypot(x1 - x0, y1 - y0);
      if (d >= rest) { const t = d ? rest / d : 0; tip = [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]; ctx.lineTo(tip[0], tip[1]); break; }
      rest -= d; ctx.lineTo(x1, y1);
    }
    if (!tip) tip = [xy[b * 2 - 2], xy[b * 2 - 1]];
    break;
  }
  return { tip, done };
}

// ── grain ───────────────────────────────────────────────────────────────────
export function makeGrain(seed = 7) {
  const n = 256, c = document.createElement('canvas');
  c.width = c.height = n;
  const x = c.getContext('2d'), img = x.createImageData(n, n), r = mulberry(seed);
  for (let i = 0; i < n * n; i++) {
    const v = r();
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v < 0.5 ? 0 : 255;
    img.data[i * 4 + 3] = Math.abs(v - 0.5) * 34;
  }
  x.putImageData(img, 0, 0);
  x.globalAlpha = 0.07; x.strokeStyle = '#000'; x.lineWidth = 0.6;
  for (let i = 0; i < 70; i++) {
    const px = r() * n, py = r() * n, a = r() * 6.283, l = 4 + r() * 14;
    x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px + Math.cos(a + 0.5) * l * 0.5, py + Math.sin(a + 0.5) * l * 0.5, px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke();
  }
  return c;
}

// ── paper ───────────────────────────────────────────────────────────────────
export function drawPaper(ctx, L, theme, view, grain, paperOut, dpr = 1) {
  const s = view.s, X = mm => view.ox + mm * s, Y = mm => view.oy + mm * s;
  if (paperOut) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 24 * dpr; ctx.shadowOffsetY = 6 * dpr;
    ctx.fillStyle = theme.paper; ctx.fillRect(X(0), Y(0), L.w * s, L.h * s);
    ctx.restore();
  }
  ctx.fillStyle = theme.paper; ctx.fillRect(X(0), Y(0), L.w * s, L.h * s);
  ctx.save();
  ctx.beginPath(); ctx.rect(X(0), Y(0), L.w * s, L.h * s); ctx.clip();
  if (theme.grid) {
    ctx.strokeStyle = theme.grid;
    for (let pass = 0; pass < 2; pass++) {
      const step = pass ? 25 : 5;
      ctx.lineWidth = Math.max(0.5, s * (pass ? 0.18 : 0.08));
      ctx.beginPath();
      for (let x = 0; x <= L.w; x += step) { ctx.moveTo(X(x), Y(0)); ctx.lineTo(X(x), Y(L.h)); }
      for (let y = 0; y <= L.h; y += step) { ctx.moveTo(X(0), Y(y)); ctx.lineTo(X(L.w), Y(y)); }
      ctx.stroke();
    }
  }
  if (grain && theme.grain) {
    ctx.globalAlpha = theme.grain;
    ctx.fillStyle = ctx.createPattern(grain, 'repeat'); ctx.fillRect(X(0), Y(0), L.w * s, L.h * s);
    ctx.globalAlpha = 1;
  }
  if (theme.vignette) {
    const cx = X(L.w / 2), cy = Y(L.h / 2), R = Math.hypot(L.w, L.h) * s / 2;
    const g = ctx.createRadialGradient(cx, cy, R * 0.45, cx, cy, R * 1.05);
    g.addColorStop(0, 'rgba(60,40,20,0)'); g.addColorStop(1, `rgba(60,40,20,${theme.vignette})`);
    ctx.fillStyle = g; ctx.fillRect(X(0), Y(0), L.w * s, L.h * s);
  }
  ctx.restore();
}

// ── drawSpec ────────────────────────────────────────────────────────────────
// fit: { k, ox, oy } in plate mm; view: { s, ox, oy } device px per mm.
// o: { theme, ink, style, pen (mm), jitter, prog (null or units), marker, dpr }
export function drawSpec(ctx, f, fit, view, o) {
  const k = fit.k * view.s;
  const ink = o.ink || o.theme.ink;
  ctx.setTransform(k, 0, 0, k, view.ox + fit.ox * view.s, view.oy + fit.oy * view.s);
  const prog = o.prog == null || o.prog >= f.total ? null : Math.max(0, o.prog);
  // Washes, back to front; they bloom in over the last 40% of the draw-on.
  const wa = prog == null ? 1 : Math.min(1, Math.max(0, (prog / f.total - 0.55) / 0.4));
  if (o.style !== 'pen' && wa > 0) {
    ctx.globalAlpha = wa;
    for (const w of f.washes) {
      const fill = washFill(o.theme, ink, o.style, w.color);
      if (!fill) continue;
      const p = w.path || (w.path = (() => { const q = new Path2D(); q.moveTo(w.xy[0], w.xy[1]); for (let i = 2; i < w.xy.length; i += 2) q.lineTo(w.xy[i], w.xy[i + 1]); q.closePath(); return q; })());
      ctx.fillStyle = fill; ctx.fill(p);
      if (o.style === 'wash') {
        // The pooled pigment at the edge of a watercolour wash.
        ctx.strokeStyle = mixHex(fill, '#000000', 0.12); ctx.lineWidth = Math.max(o.pen * 1.6, 0.3) * view.s / k;
        ctx.globalAlpha = wa * 0.35; ctx.stroke(p); ctx.globalAlpha = wa;
      }
    }
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = ink; ctx.fillStyle = ink;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const px = view.s / k;            // units per device px... times mm
  const minW = 0.35 / k;            // at least 0.35 device px
  const xy = specPoints(f, o.jitter || 0).xy;
  const brush = o.style === 'brush';
  const bw = o.pen / fit.k;         // the pen width in units
  if (prog == null) {
    if (brush) {
      const polys = brushPolys(f, o.jitter || 0, bw);
      ctx.fill(brushPath(polys, 0, polys.length));
    } else {
      const paths = kindPaths(f, o.jitter || 0);
      for (let i = 0; i < 4; i++) { ctx.lineWidth = Math.max(o.pen * PEN_K[i] * px, minW); ctx.stroke(paths[i]); }
    }
  } else if (prog > 0) {
    ctx.lineWidth = Math.max(o.pen * 0.75 * px, minW);
    const { tip, done } = tracePartial(ctx, f, xy, prog);
    if (brush) {
      ctx.stroke();
      const polys = brushPolys(f, o.jitter || 0, bw);
      const p = new Path2D();
      for (let j = 0; j < done; j++) {
        const q = polys[f.order[j]];
        if (!q) continue;
        p.moveTo(q[0], q[1]);
        for (let i = 2; i < q.length; i += 2) p.lineTo(q[i], q[i + 1]);
        p.closePath();
      }
      ctx.fill(p);
    } else ctx.stroke();
    if (tip && o.marker) {
      const r = Math.max(o.pen * view.s * 1.6, 2.2 * (o.dpr || 1)) / k;
      ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(tip[0], tip[1], r * 2.2, 0, 6.283); ctx.fill();
      ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(tip[0], tip[1], r, 0, 6.283); ctx.fill();
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// ── drawPlate ───────────────────────────────────────────────────────────────
export function drawPlate(ctx, P) {
  const { L, theme, view } = P, s = view.s, dpr = P.dpr || 1;
  const X = mm => view.ox + mm * s, Y = mm => view.oy + mm * s;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (!P.noPaper) drawPaper(ctx, L, theme, view, P.grain, P.paperOut, dpr);
  ctx.strokeStyle = theme.rule;
  for (const r of L.rules) { ctx.lineWidth = r.lw * s; ctx.strokeRect(X(r.x), Y(r.y), r.w * s, r.h * s); }
  ctx.fillStyle = theme.text; ctx.textBaseline = 'alphabetic';
  // One cell: the figure label sits just under the specimen.
  const one = L.cells.length === 1 && P.specs[0] ? specExtras(P.specs[0], L.cells[0], (P.fits && P.fits[0]) || fitSpec(P.specs[0], L.cells[0])) : null;
  for (const t0 of L.texts) {
    const t = one && t0.role === 'num' ? Object.assign({}, t0, { y: one.labelY }) : t0;
    if (t.role === 'num') {
      const fN = labelFont(t.size * s, 'normal'), fI = labelFont(t.size * s, 'italic');
      ctx.font = fN; const wN = ctx.measureText(t.text + ' ').width;
      ctx.font = fI; const wI = ctx.measureText(t.name).width;
      const x0 = X(t.x) - (wN + wI) / 2;
      ctx.textAlign = 'left';
      ctx.font = fN; ctx.fillText(t.text + ' ', x0, Y(t.y));
      ctx.font = fI; ctx.fillText(t.name, x0 + wN, Y(t.y));
      continue;
    }
    ctx.font = labelFont(t.size * s, t.style);
    ctx.textAlign = t.align === 'right' ? 'right' : t.align === 'left' ? 'left' : 'center';
    ctx.fillText(t.text, X(t.x), Y(t.y));
  }
  const ink = P.ink || theme.ink;
  for (const c of L.cells) {
    const f = P.specs[c.i];
    if (c.i === P.hiCell) {
      ctx.save(); ctx.strokeStyle = theme.rule; ctx.globalAlpha = 0.35; ctx.lineWidth = Math.max(1, s * 0.25);
      ctx.setLineDash([4 * dpr, 4 * dpr]); ctx.strokeRect(X(c.x), Y(c.y), c.w * s, c.h * s); ctx.restore();
    }
    if (!f) {
      ctx.save(); ctx.strokeStyle = ink; ctx.globalAlpha = 0.12; ctx.lineWidth = Math.max(1, s * 0.2);
      ctx.setLineDash([3 * dpr, 5 * dpr]);
      ctx.beginPath(); ctx.ellipse(X(c.ax + c.aw / 2), Y(c.ay + c.ah / 2), c.aw * 0.3 * s, c.ah * 0.3 * s, 0, 0, 6.283); ctx.stroke();
      ctx.restore();
      continue;
    }
    if (X(c.x) > ctx.canvas.width || Y(c.y) > ctx.canvas.height || X(c.x + c.w) < 0 || Y(c.y + c.h) < 0) continue;
    const fit = P.fits && P.fits[c.i] || fitSpec(f, c);
    drawSpec(ctx, f, fit, view, { theme, ink: P.ink, style: P.style, pen: P.pen, jitter: P.jitter, prog: P.progress ? P.progress[c.i] : null, marker: P.marker, dpr });
    if (P.scale) {
      const ex = specExtras(f, c, fit), sb = scaleBar(fit.k, Math.min(c.aw * 0.14, f.bbox.w * fit.k * 0.3)), bx = ex.barX, by = ex.barY;
      const th = Math.max(0.15, Math.min(c.aw, c.ah) * 0.002);
      ctx.strokeStyle = theme.text; ctx.lineWidth = th * 2 * s;
      ctx.beginPath();
      ctx.moveTo(X(bx), Y(by)); ctx.lineTo(X(bx + sb.len), Y(by));
      for (const t of [0, 0.5, 1]) { ctx.moveTo(X(bx + sb.len * t), Y(by)); ctx.lineTo(X(bx + sb.len * t), Y(by - (t === 0.5 ? 0.6 : 1) * ex.fs * 0.45)); }
      ctx.stroke();
      ctx.fillStyle = theme.text; ctx.font = labelFont(ex.fs * s, 'normal'); ctx.textAlign = 'left';
      ctx.fillText(sb.text, X(bx + sb.len + c.aw * 0.012), Y(by));
    }
  }
  ctx.restore();
}
