// ============================================================================
//  FISHDRAW  ·  render.js — draw a plate on a 2D canvas, as vectors
// ----------------------------------------------------------------------------
//  Our own code around fishdraw by Lingdong Huang (MIT, LICENSE-fishdraw.txt).
//  The fish lines are paths through the view transform on each draw, never a
//  cached raster, so a zoom stays sharp at the device pixel ratio. The
//  paper grain is the only raster: a small noise tile at screen scale.
//
//  drawPlate(ctx, P) draws one plate. P:
//    L        the layout from plate.js layoutPlate()
//    theme    a THEMES entry; ink overrides theme.ink when set
//    pen      the pen width in mm; jitter 0..1 (hand-drawn wobble)
//    fishes   [fish | null] by cell; a fish is a pool.js result
//    progress [null | length] by cell: null draws all of it, a number
//             draws that many fish units of line (the pen draw-on)
//    view     { s, ox, oy }: device px per mm, and the device px of the
//             plate origin
//    grain    a pattern canvas from makeGrain(), or null
//    marker   true draws the pen tip of each cell that is still drawing
//    hiCell   a cell index to outline (hover), or -1
//    paperOut true fills the desk around the page with a shadow
//
//  GREP MAP
//    grep -n 'export function drawPlate'   the plate
//    grep -n 'export function fishPoints'  the jittered points, cached
//    grep -n 'function tracePartial'       the draw-on path to a length
//    grep -n 'export function makeGrain'   the paper noise tile
//    grep -n 'export function labelFont'   the type of every label
// ============================================================================
import { mulberry } from './engine.js';

export const SERIF = '"STIX Two Text", "Times New Roman", Georgia, serif';
export function labelFont(size, style) {
  return (style === 'italic' ? 'italic ' : '') + size.toFixed(2) + 'px ' + SERIF;
}

// ── jitter ──────────────────────────────────────────────────────────────────
// Each polyline gets a small constant shift and two slow waves along its
// arc length, in fish units. The seed is the fish seed and the polyline
// index, so the same fish and jitter give the same wobble.
const ptsCache = new WeakMap();
export function fishPoints(f, jitter) {
  const key = Math.round(jitter * 100);
  let m = ptsCache.get(f);
  if (!m) { m = new Map(); ptsCache.set(f, m); }
  if (m.has(key)) return m.get(key);
  let out;
  if (!key) out = { xy: f.xy };
  else {
    const amt = key / 100 * 2.4, xy = new Float64Array(f.xy.length);
    const n = f.offs.length - 1;
    for (let i = 0; i < n; i++) {
      const r = mulberry((f.seed ^ Math.imul(i + 1, 0x9E3779B1)) >>> 0);
      const a1 = r() * 6.283, a2 = r() * 6.283, b1 = r() * 6.283, b2 = r() * 6.283;
      const sx = (r() - 0.5) * amt * 0.8, sy = (r() - 0.5) * amt * 0.8;
      let s = 0;
      for (let k = f.offs[i]; k < f.offs[i + 1]; k++) {
        if (k > f.offs[i]) s += Math.hypot(f.xy[k * 2] - f.xy[k * 2 - 2], f.xy[k * 2 + 1] - f.xy[k * 2 - 1]);
        xy[k * 2] = f.xy[k * 2] + sx + amt * (0.55 * Math.sin(s / 31 + a1) + 0.3 * Math.sin(s / 9 + a2));
        xy[k * 2 + 1] = f.xy[k * 2 + 1] + sy + amt * (0.55 * Math.sin(s / 37 + b1) + 0.3 * Math.sin(s / 11 + b2));
      }
    }
    out = { xy };
  }
  m.set(key, out);
  return out;
}
function fishPath(f, jitter) {
  const P = fishPoints(f, jitter);
  if (P.path) return P.path;
  const p = new Path2D(), xy = P.xy;
  for (let i = 0; i + 1 < f.offs.length; i++) {
    const a = f.offs[i], b = f.offs[i + 1];
    if (b - a < 2) continue;
    p.moveTo(xy[a * 2], xy[a * 2 + 1]);
    for (let k = a + 1; k < b; k++) p.lineTo(xy[k * 2], xy[k * 2 + 1]);
  }
  P.path = p;
  return p;
}
// The path of the first `len` units of line, in drawing order (the upstream
// order of the polylines, as the upstream SMIL animation). Returns the pen
// tip [x, y] or null when the fish is done.
function tracePartial(ctx, f, xy, len) {
  let acc = 0, tip = null;
  ctx.beginPath();
  for (let i = 0; i + 1 < f.offs.length; i++) {
    const a = f.offs[i], b = f.offs[i + 1], L = f.lens[i];
    if (b - a < 2) continue;
    ctx.moveTo(xy[a * 2], xy[a * 2 + 1]);
    if (acc + L <= len) {
      for (let k = a + 1; k < b; k++) ctx.lineTo(xy[k * 2], xy[k * 2 + 1]);
      acc += L;
      continue;
    }
    // The pen is in this polyline.
    let rest = len - acc;
    for (let k = a + 1; k < b; k++) {
      const x0 = xy[k * 2 - 2], y0 = xy[k * 2 - 1], x1 = xy[k * 2], y1 = xy[k * 2 + 1];
      const d = Math.hypot(x1 - x0, y1 - y0);
      if (d >= rest) {
        const t = d ? rest / d : 0;
        tip = [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
        ctx.lineTo(tip[0], tip[1]);
        break;
      }
      rest -= d;
      ctx.lineTo(x1, y1);
    }
    if (!tip) tip = [xy[b * 2 - 2], xy[b * 2 - 1]];
    break;
  }
  return tip;
}

// ── grain ───────────────────────────────────────────────────────────────────
// A 256 px tile of soft value noise and short fibres, grey on transparent.
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

// ── drawPlate ───────────────────────────────────────────────────────────────
export function drawPlate(ctx, P) {
  const { L, theme, view } = P, s = view.s;
  const ink = P.ink || theme.ink;
  const X = mm => view.ox + mm * s, Y = mm => view.oy + mm * s;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Paper, with a soft shadow when the page sits on the desk.
  if (P.paperOut) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 24 * (P.dpr || 1); ctx.shadowOffsetY = 6 * (P.dpr || 1);
    ctx.fillStyle = theme.paper; ctx.fillRect(X(0), Y(0), L.w * s, L.h * s);
    ctx.restore();
  }
  ctx.fillStyle = theme.paper; ctx.fillRect(X(0), Y(0), L.w * s, L.h * s);
  ctx.save();
  ctx.beginPath(); ctx.rect(X(0), Y(0), L.w * s, L.h * s); ctx.clip();
  if (theme.grid) {
    // A 5 mm blueprint grid, with a stronger line each 25 mm.
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
  if (P.grain && theme.grain) {
    const pat = ctx.createPattern(P.grain, 'repeat');
    ctx.globalAlpha = theme.grain;
    ctx.fillStyle = pat; ctx.fillRect(X(0), Y(0), L.w * s, L.h * s);
    ctx.globalAlpha = 1;
  }
  if (theme.vignette) {
    const cx = X(L.w / 2), cy = Y(L.h / 2), R = Math.hypot(L.w, L.h) * s / 2;
    const g = ctx.createRadialGradient(cx, cy, R * 0.45, cx, cy, R * 1.05);
    g.addColorStop(0, 'rgba(60,40,20,0)'); g.addColorStop(1, `rgba(60,40,20,${theme.vignette})`);
    ctx.fillStyle = g; ctx.fillRect(X(0), Y(0), L.w * s, L.h * s);
  }
  ctx.restore();

  // Border rules.
  ctx.strokeStyle = theme.rule;
  for (const r of L.rules) { ctx.lineWidth = r.lw * s; ctx.strokeRect(X(r.x), Y(r.y), r.w * s, r.h * s); }

  // Text.
  ctx.fillStyle = theme.text; ctx.textBaseline = 'alphabetic';
  for (const t of L.texts) {
    if (t.role === 'num') {
      // "12. Genus species": the number upright, the name in italics,
      // centred together.
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

  // Fish.
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const c of L.cells) {
    const f = P.fishes[c.i];
    if (c.i === P.hiCell) {
      ctx.save(); ctx.strokeStyle = theme.rule; ctx.globalAlpha = 0.35; ctx.lineWidth = Math.max(1, s * 0.25);
      ctx.setLineDash([4 * (P.dpr || 1), 4 * (P.dpr || 1)]);
      ctx.strokeRect(X(c.x), Y(c.y), c.w * s, c.h * s); ctx.restore();
    }
    if (!f) {
      // A cell that waits for its fish: a faint box.
      ctx.save(); ctx.strokeStyle = ink; ctx.globalAlpha = 0.12; ctx.lineWidth = Math.max(1, s * 0.2);
      ctx.setLineDash([3 * (P.dpr || 1), 5 * (P.dpr || 1)]);
      const ix = c.fw * 0.18, iy = c.fh * 0.25;
      ctx.beginPath(); ctx.ellipse(X(c.fx + c.fw / 2), Y(c.fy + c.fh / 2), (c.fw / 2 - ix) * s, (c.fh / 2 - iy) * s, 0, 0, 6.283); ctx.stroke();
      ctx.restore();
      continue;
    }
    const k = c.k * s;
    // Cull a cell that is out of the canvas (a zoomed view).
    const cx0 = X(c.fx), cy0 = Y(c.fy);
    if (cx0 > ctx.canvas.width || cy0 > ctx.canvas.height || cx0 + c.fw * s < 0 || cy0 + c.fh * s < 0) continue;
    ctx.setTransform(k, 0, 0, k, cx0, cy0);
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(P.pen * s, 0.35) / k;
    const prog = P.progress && P.progress[c.i];
    if (prog == null || prog >= f.total) {
      ctx.stroke(fishPath(f, P.jitter || 0));
    } else if (prog > 0) {
      const tip = tracePartial(ctx, f, fishPoints(f, P.jitter || 0).xy, prog);
      ctx.stroke();
      if (tip && P.marker) {
        const r = Math.max(P.pen * s * 1.6, 2.2 * (P.dpr || 1)) / k;
        ctx.fillStyle = ink; ctx.globalAlpha = 0.25;
        ctx.beginPath(); ctx.arc(tip[0], tip[1], r * 2.2, 0, 6.283); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(tip[0], tip[1], r, 0, 6.283); ctx.fill();
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  ctx.restore();
}
