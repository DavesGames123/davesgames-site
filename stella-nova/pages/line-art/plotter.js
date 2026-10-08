// ============================================================================
//  LINE ART  ·  plotter.js — the pen plotter view (canvas 2D)
// ----------------------------------------------------------------------------
//  The engine gives 2D paths in image units (0..W, 0..H, y up) and a
//  camera depth for each path. The image is the whole view canvas (the
//  frame rectangle only aims the camera, see geom.js viewFit). This module
//  keeps the paths as vectors and draws them like a pen plotter:
//    - a "sheet" is one render: the path list in depth order (near paths
//      first, geom.js orderPaths), with the length of each path.
//    - 'plot' and 'swap' renders fill a hidden sheet. When the render is
//      done (finish), the sheet is sorted by depth and shown.
//    - in 'plot' mode a pen then moves along the paths in order and lays
//      ink. The pen speed adapts, so the sheet finishes near `plotTime`
//      seconds after the start. A move from the end of one path to the
//      start of the next is a pen-up travel at six times the speed.
//    - after a 'swap' render all paths show at once (camera previews).
//  Layers, all at device pixels and the size of the view canvas:
//    paper  (theme fill and texture, drawn once per resize or theme)
//    glow   (a wide soft stroke under the ink, for themes with glow)
//    ink    (the strokes; new ink is added each frame)
//  frame() puts paper, glow, ink and the pen head on the view canvas.
//  Zoom and pan never scale a raster: they change the transform and draw
//  all vectors again (function redrawInk).
//
//  GREP MAP
//    grep -n 'function toScreen'     image units -> device pixels
//    grep -n 'begin(W'               start a sheet
//    grep -n 'add(buf'               decode one engine chunk
//    grep -n 'advancePen'            the plotter step of one frame
//    grep -n 'emitRange'             one part of one path, with jitter
//    grep -n 'redrawInk'             all vectors again (zoom, theme, width)
//    grep -n 'function drawPaper'    paper textures
//    grep -n 'exportPNG'             a large still of the sheet
// ============================================================================

import { TRAVEL_SPEEDUP, DOT_COST, orderPaths, clampPan } from './geom.js';

const JITTER_STEP = 5;       // jitter subdivision, image units

function mulberry(seed) {
  return () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// One sheet: the paths of one render.
function newSheet(W, H) {
  return { W, H, paths: [], total: 0, ink: 0, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, done: false };
}

// depth: one camera depth per path of buf (worker chunk), or none.
function decode(buf, sheet, depth) {
  const n = buf[0];
  let i = 1;
  for (let k = 0; k < n; k++) {
    const m = buf[i++];
    const pts = buf.subarray(i, i + m * 2);
    i += m * 2;
    let len = 0;
    for (let j = 2; j < pts.length; j += 2) len += Math.hypot(pts[j] - pts[j - 2], pts[j + 1] - pts[j - 1]);
    for (let j = 0; j < pts.length; j += 2) {
      const x = pts[j], y = pts[j + 1];
      if (x < sheet.x0) sheet.x0 = x; if (x > sheet.x1) sheet.x1 = x; if (y < sheet.y0) sheet.y0 = y; if (y > sheet.y1) sheet.y1 = y;
    }
    sheet.ink += len;
    const idx = sheet.paths.length;
    // the pen-up travel from the end of the last path, in pen time
    let tc = 0;
    if (idx > 0) { const q = sheet.paths[idx - 1].pts, l = q.length - 2; tc = Math.hypot(pts[0] - q[l], pts[1] - q[l + 1]) / TRAVEL_SPEEDUP; }
    const cost = Math.max(len, DOT_COST) + tc;
    sheet.paths.push({ pts, len, cost, depth: depth ? depth[k] : idx, phase: (idx * 0.618034) % 1 * 100 });
    sheet.total += cost;
  }
}

export class Plotter {
  constructor(view) {
    this.view = view;
    this.vx = view.getContext('2d');
    this.paper = document.createElement('canvas');
    this.ink = document.createElement('canvas');
    this.glow = document.createElement('canvas');
    this.ix = this.ink.getContext('2d');
    this.gx = this.glow.getContext('2d');
    this.dpr = 1; this.cw = 0; this.ch = 0;
    this.frameRect = { x: 0, y: 0, w: 100, h: 100 };
    this.zoom = 1; this.panX = 0; this.panY = 0;
    this.theme = null;
    this.style = { width: 1.2, jitter: 0, penHead: true, plotTime: 6 };
    this.sheet = newSheet(1, 1);
    this.incoming = null;    // the hidden sheet of a 'plot' or 'swap' render
    this.thinNow = 1;        // the line width factor of the shown sheet (function thin)
    this.mode = 'instant';
    this.nextMode = 'instant';  // the mode after finish(): 'plot' or 'instant'
    this.pen = { i: 0, d: 0, travel: 0, x: 0, y: 0, down: false };
    this.t0 = 0;
    this.dirty = true;
    this.inkDirty = true;    // the ink layer needs a full redraw
    this.onIdle = null;      // called once when a plot is finished
    this.alpha = 1;          // fade of the whole sheet (the saver cut)
  }

  // ── geometry ─────────────────────────────────────────────────────────────
  resize(cssW, cssH, dpr) {
    const w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
    if (w === this.cw && h === this.ch && dpr === this.dpr) return false;
    this.dpr = dpr; this.cw = w; this.ch = h;
    for (const c of [this.view, this.paper, this.ink, this.glow]) { c.width = w; c.height = h; }
    this.drawPaper();
    this.inkDirty = true; this.dirty = true;
    return true;
  }
  // The clear area of the screen, in CSS px. The camera aims the example
  // view into it (worker frame); fitContent fills it. The image itself
  // covers the whole view.
  setFrame(r) {
    const f = this.frameRect;
    if (f.x === r.x && f.y === r.y && f.w === r.w && f.h === r.h) return;
    this.frameRect = { ...r };
    this.inkDirty = true; this.dirty = true;
  }
  get viewW() { return this.cw / this.dpr; }
  get viewH() { return this.ch / this.dpr; }
  // CSS px per image unit at zoom 1: 1 when the sheet was made for this
  // view size; a stale sheet (before the render for a new size) fits.
  baseScale(s = this.sheet) {
    return Math.min(this.viewW / s.W, this.viewH / s.H);
  }
  // image units -> device pixels: returns [a, b, c, d] with X = a + x*b, Y = c - y*d
  xform(s = this.sheet) {
    const k = this.baseScale(s) * this.zoom, dpr = this.dpr;
    const cx = this.viewW / 2 + this.panX, cy = this.viewH / 2 + this.panY;
    return [(cx - s.W / 2 * k) * dpr, k * dpr, (cy + s.H / 2 * k) * dpr, k * dpr];
  }
  toScreen(x, y) { const t = this.xform(); return [(t[0] + x * t[1]) / this.dpr, (t[2] - y * t[3]) / this.dpr]; }
  toImage(px, py) { const t = this.xform(); return [(px * this.dpr - t[0]) / t[1], (t[2] - py * this.dpr) / t[3]]; }

  zoomAt(px, py, factor) {
    const z = Math.max(0.25, Math.min(40, this.zoom * factor));
    factor = z / this.zoom;
    const cx = this.viewW / 2 + this.panX, cy = this.viewH / 2 + this.panY;
    this.panX += (px - cx) * (1 - factor);
    this.panY += (py - cy) * (1 - factor);
    this.zoom = z;
    this.inkDirty = true; this.dirty = true;
  }
  // Zoom and pan so the drawn paths fill `fill` of the frame (the saver).
  // The pan is clamped so the image still covers the whole view: no edge
  // of the render shows as a cut line.
  fitContent(fill = 0.9, maxZoom = 4) {
    const s = this.sheet; if (!s.paths.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of s.paths) for (let j = 0; j < p.pts.length; j += 2) {
      const x = p.pts[j], y = p.pts[j + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const f = this.frameRect, k = this.baseScale(s);
    const z = Math.max(1, Math.min(maxZoom, fill * f.w / Math.max(1, (x1 - x0) * k), fill * f.h / Math.max(1, (y1 - y0) * k)));
    this.zoom = z;
    const px = f.x + f.w / 2 - this.viewW / 2 - ((x0 + x1) / 2 - s.W / 2) * k * z;
    const py = f.y + f.h / 2 - this.viewH / 2 + ((y0 + y1) / 2 - s.H / 2) * k * z;
    [this.panX, this.panY] = clampPan(px, py, s.W * k * z, s.H * k * z, this.viewW, this.viewH);
    this.inkDirty = true; this.dirty = true;
  }
  panBy(dx, dy) { this.panX += dx; this.panY += dy; this.inkDirty = true; this.dirty = true; }
  resetView() { this.zoom = 1; this.panX = 0; this.panY = 0; this.inkDirty = true; this.dirty = true; }

  setTheme(theme) { this.theme = theme; this.drawPaper(); this.inkDirty = true; this.dirty = true; }
  setStyle(s) {
    const redraw = s.width !== undefined && s.width !== this.style.width || s.jitter !== undefined && s.jitter !== this.style.jitter;
    Object.assign(this.style, s);
    if (redraw) this.inkDirty = true;
    this.dirty = true;
  }

  // ── sheets ───────────────────────────────────────────────────────────────
  // 'plot' and 'swap' fill a hidden sheet; finish() sorts it by depth and
  // shows it (and starts the pen for 'plot'). 'instant' starts a new shown
  // sheet in engine order (not used by the page).
  begin(W, H, mode) {
    if (mode === 'swap' || mode === 'plot') { this.incoming = newSheet(W, H); this.nextMode = mode === 'plot' ? 'plot' : 'instant'; return; }
    this.mode = mode;
    this.incoming = null;
    this.sheet = newSheet(W, H);
    this.pen = { i: 0, d: 0, travel: 0, x: W / 2, y: H / 2, down: false };
    this.t0 = performance.now();
    this.inkDirty = true; this.dirty = true;
    this.idleSent = false;
  }
  add(buf, depth) {
    if (this.incoming) { decode(buf, this.incoming, depth); return; }
    decode(buf, this.sheet, depth);
    if (this.mode === 'instant') { this.pen.i = this.sheet.paths.length; this.pen.d = 0; this.inkDirty = true; }
    this.dirty = true;
  }
  finish() {
    if (this.incoming) {
      const s = this.incoming;
      this.incoming = null;
      const o = orderPaths(s.paths);
      s.paths = o.paths; s.total = o.total; s.done = true;
      this.sheet = s;
      if (this.nextMode === 'plot') {
        this.mode = 'plot';
        this.pen = { i: 0, d: 0, travel: 0, x: s.W / 2, y: s.H / 2, down: false };
        this.t0 = performance.now(); this.idleSent = false;
      } else {
        this.mode = 'instant';
        this.pen = { i: s.paths.length, d: 0, travel: 0, x: 0, y: 0, down: false };
      }
      this.inkDirty = true; this.dirty = true;
      return;
    }
    this.sheet.done = true;
    // the line width can change with the density of the whole sheet
    if (Math.abs(this.thin() - (this.thinNow || 1)) > 0.02) this.inkDirty = true;
    this.dirty = true;
  }
  // Draw the shown sheet again from the first path.
  replay(plotTime) {
    if (plotTime) this.style.plotTime = plotTime;
    this.mode = 'plot';
    this.pen = { i: 0, d: 0, travel: 0, x: this.sheet.W / 2, y: this.sheet.H / 2, down: false };
    this.t0 = performance.now();
    this.inkDirty = true; this.dirty = true; this.idleSent = false;
  }
  // Show all of the shown sheet at once.
  finishPlot() { this.pen = { i: this.sheet.paths.length, d: 0, travel: 0, x: 0, y: 0, down: false }; this.inkDirty = true; this.dirty = true; }
  get plotting() { return this.mode === 'plot' && this.pen.i < this.sheet.paths.length; }
  get progress() {
    const s = this.sheet; if (!s.paths.length) return 0;
    return Math.min(1, this.drawnLength() / Math.max(1, s.total));
  }
  drawnLength() {
    // The ink length so far (a sum is cheap enough: once per stats update).
    const s = this.sheet; let d = 0;
    for (let i = 0; i < Math.min(this.pen.i, s.paths.length); i++) d += s.paths[i].cost;
    return d + this.pen.d;
  }

  // ── drawing ──────────────────────────────────────────────────────────────
  // Dense drawings get thinner lines: ink length per area of the drawn box,
  // in CSS px, at this zoom. 0.35 px of line per px^2 keeps the full width.
  thin(s = this.sheet) {
    if (!s.done || !(s.x1 > s.x0) || !(s.y1 > s.y0)) return 1;
    const k = this.baseScale(s) * this.zoom;
    const area = Math.max(400, (s.x1 - s.x0) * k * (s.y1 - s.y0) * k);
    const d = s.ink * k / area;
    return Math.max(0.35, Math.min(1, Math.sqrt(0.35 / Math.max(1e-6, d))));
  }
  strokeStyle(ctx, kind) {
    const th = this.theme, w = this.style.width * this.dpr * this.thinNow;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (kind === 'glow') { ctx.strokeStyle = th.glow; ctx.lineWidth = w * 4 + 3 * this.dpr; ctx.globalAlpha = 0.16; }
    else { ctx.strokeStyle = th.ink; ctx.lineWidth = w; ctx.globalAlpha = 1; }
  }
  // Add the part [d0, d1] of path p to the current canvas path.
  emitRange(ctx, t, p, d0, d1) {
    const pts = p.pts, J = this.style.jitter;
    const X = (x, y, s) => {
      if (J > 0) {
        const u = s / 23 + p.phase;
        x += J * (Math.sin(u * 1.7) * 0.6 + Math.sin(u * 4.3 + 1.1) * 0.3 + Math.sin(u * 9.1 + 2.3) * 0.1);
        y += J * (Math.sin(u * 1.3 + 4.2) * 0.6 + Math.sin(u * 3.7 + 0.4) * 0.3 + Math.sin(u * 8.3 + 5.1) * 0.1);
      }
      return [t[0] + x * t[1], t[2] - y * t[3]];
    };
    if (pts.length < 4 || p.len === 0) {
      // a dot (ln sphere Paths3) or a degenerate path
      const [a, b] = X(pts[0], pts[1], 0);
      ctx.moveTo(a, b); ctx.lineTo(a + 0.01, b);
      this.pen.x = pts[0]; this.pen.y = pts[1];
      return;
    }
    let s = 0, started = false, lx = 0, ly = 0;
    for (let j = 2; j < pts.length; j += 2) {
      const ax = pts[j - 2], ay = pts[j - 1], bx = pts[j], by = pts[j + 1];
      const L = Math.hypot(bx - ax, by - ay);
      const s1 = s + L;
      if (s1 >= d0 && s <= d1 && L > 0) {
        const u0 = Math.max(0, (d0 - s) / L), u1 = Math.min(1, (d1 - s) / L);
        if (!started) { const [a, b] = X(ax + (bx - ax) * u0, ay + (by - ay) * u0, s + L * u0); ctx.moveTo(a, b); started = true; }
        if (J > 0) {
          // subdivide so long edges wobble along their length
          const n = Math.max(1, Math.ceil(L * (u1 - u0) / JITTER_STEP));
          for (let k = 1; k <= n; k++) {
            const u = u0 + (u1 - u0) * k / n;
            const [a, b] = X(ax + (bx - ax) * u, ay + (by - ay) * u, s + L * u); ctx.lineTo(a, b);
          }
        } else {
          const [a, b] = X(ax + (bx - ax) * u1, ay + (by - ay) * u1, 0); ctx.lineTo(a, b);
        }
        lx = ax + (bx - ax) * u1; ly = ay + (by - ay) * u1;
      }
      if (s1 > d1) break;
      s = s1;
    }
    if (started) { this.pen.x = lx; this.pen.y = ly; }
  }
  // Stroke the paths [i0, i1) and the part [0, dEnd] of path i1 on both layers.
  strokeSpan(i0, i1, dEnd) {
    const s = this.sheet, t = this.xform(), glow = !!this.theme.glow;
    const layers = glow ? [[this.gx, 'glow'], [this.ix, 'ink']] : [[this.ix, 'ink']];
    for (const [ctx, kind] of layers) {
      this.strokeStyle(ctx, kind);
      let n = 0;
      ctx.beginPath();
      for (let i = i0; i < i1 && i < s.paths.length; i++) {
        const p = s.paths[i];
        this.emitRange(ctx, t, p, 0, p.len);
        if (++n === 4000) { ctx.stroke(); ctx.beginPath(); n = 0; }
      }
      if (dEnd > 0 && i1 < s.paths.length) this.emitRange(ctx, t, s.paths[i1], 0, dEnd);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  redrawInk() {
    this.thinNow = this.thin();
    this.ix.setTransform(1, 0, 0, 1, 0, 0); this.ix.clearRect(0, 0, this.cw, this.ch);
    this.gx.setTransform(1, 0, 0, 1, 0, 0); this.gx.clearRect(0, 0, this.cw, this.ch);
    const px = this.pen.x, py = this.pen.y;
    this.strokeSpan(0, this.pen.i, this.pen.d);
    this.pen.x = px; this.pen.y = py;
    this.inkDirty = false;
  }
  // The plotter step of one frame: move the pen by the time `dt` (s).
  advancePen(now, dt) {
    const s = this.sheet, pen = this.pen;
    if (pen.i >= s.paths.length) return false;
    const elapsed = (now - this.t0) / 1000;
    const left = Math.max(0.25, this.style.plotTime - elapsed);
    const remaining = Math.max(1, s.total - this.drawnLengthFast());
    // Before the render is done the rest is unknown: assume as much again
    // as is known, so the pen does not race to the end of the first chunk.
    const est = s.done ? remaining : remaining * 2;
    const speed = Math.max(40, est / left);
    let budget = speed * dt;
    const i0 = pen.i, d0 = pen.d;
    let i = pen.i, d = pen.d;
    while (budget > 0 && i < s.paths.length) {
      const p = s.paths[i];
      if (d === 0 && pen.travel > 0) {
        const c = pen.travel / TRAVEL_SPEEDUP;
        if (c > budget) { pen.travel -= budget * TRAVEL_SPEEDUP; this.drawnFast += budget; budget = 0; break; }
        budget -= c; this.drawnFast += c; pen.travel = 0;
      }
      const cost = Math.max(p.len, DOT_COST) - d;
      if (cost <= budget) {
        budget -= cost; i++; d = 0;
        this.drawnFast += cost;
        if (i < s.paths.length) {
          const q = s.paths[i], last = p.pts.length - 2;
          pen.travel = Math.hypot(q.pts[0] - p.pts[last], q.pts[1] - p.pts[last + 1]);
        }
      } else {
        d += budget; this.drawnFast += budget; budget = 0;
      }
    }
    // Stroke from (i0, d0) to (i, d).
    const t = this.xform(), glow = !!this.theme.glow;
    const layers = glow ? [[this.gx, 'glow'], [this.ix, 'ink']] : [[this.ix, 'ink']];
    for (const [ctx, kind] of layers) {
      this.strokeStyle(ctx, kind);
      ctx.beginPath();
      let n = 0;
      for (let k = i0; k <= i && k < s.paths.length; k++) {
        const p = s.paths[k];
        const a = k === i0 ? d0 : 0, b = k === i ? d : p.len;
        if (k === i && d === 0) break;
        if (b > a || p.len === 0) this.emitRange(ctx, t, p, a, b);
        if (++n === 4000) { ctx.stroke(); ctx.beginPath(); n = 0; }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    pen.i = i; pen.d = d; pen.down = pen.travel === 0;
    if (pen.travel > 0 && i < s.paths.length) {
      // the head moves along the travel line
      const q = s.paths[i], f = Math.min(1, pen.travel / Math.max(1e-6, Math.hypot(q.pts[0] - pen.x, q.pts[1] - pen.y)));
      pen.hx = q.pts[0] + (pen.x - q.pts[0]) * f; pen.hy = q.pts[1] + (pen.y - q.pts[1]) * f;
    } else { pen.hx = pen.x; pen.hy = pen.y; }
    return true;
  }
  drawnLengthFast() {
    if (this.drawnFastFor !== this.sheet || this.drawnFastT0 !== this.t0) { this.drawnFastFor = this.sheet; this.drawnFastT0 = this.t0; this.drawnFast = this.drawnLength(); }
    return this.drawnFast;
  }

  frame(now) {
    const dt = Math.min(0.1, (now - (this.lastT || now)) / 1000);
    this.lastT = now;
    if (this.inkDirty) { this.redrawInk(); this.dirty = true; }
    let moving = false;
    if (this.mode === 'plot') {
      moving = this.advancePen(now, dt);
      if (moving) this.dirty = true;
      else if (this.sheet.done && !this.idleSent) { this.idleSent = true; if (this.onIdle) this.onIdle(); }
    } else if (this.mode === 'instant' && this.pen.i < this.sheet.paths.length) {
      this.strokeSpan(this.pen.i, this.sheet.paths.length, 0);
      this.pen.i = this.sheet.paths.length; this.dirty = true;
    }
    if (!this.dirty) return;
    this.dirty = false;
    const v = this.vx;
    v.setTransform(1, 0, 0, 1, 0, 0);
    v.globalAlpha = 1;
    v.drawImage(this.paper, 0, 0);
    v.globalAlpha = this.alpha;
    if (this.theme.glow) { v.globalCompositeOperation = this.theme.dark ? 'lighter' : 'source-over'; v.drawImage(this.glow, 0, 0); v.globalCompositeOperation = 'source-over'; }
    v.drawImage(this.ink, 0, 0);
    v.globalAlpha = 1;
    if (moving && this.style.penHead) this.drawPenHead(v);
  }
  drawPenHead(v) {
    const t = this.xform(), pen = this.pen;
    const x = t[0] + (pen.hx ?? pen.x) * t[1], y = t[2] - (pen.hy ?? pen.y) * t[3], r = 4.5 * this.dpr;
    v.save();
    v.strokeStyle = this.theme.ink; v.fillStyle = this.theme.ink; v.lineWidth = 1.2 * this.dpr;
    v.globalAlpha = 0.85;
    v.beginPath(); v.arc(x, y, r, 0, Math.PI * 2);
    if (pen.down) v.fill(); else v.stroke();
    v.globalAlpha = 0.35;
    v.beginPath(); v.moveTo(x - r * 3, y); v.lineTo(x - r * 1.6, y); v.moveTo(x + r * 1.6, y); v.lineTo(x + r * 3, y);
    v.moveTo(x, y - r * 3); v.lineTo(x, y - r * 1.6); v.moveTo(x, y + r * 1.6); v.lineTo(x, y + r * 3);
    v.stroke();
    v.restore();
  }

  drawPaper() {
    if (!this.theme || !this.cw) return;
    drawPaper(this.paper.getContext('2d'), this.cw, this.ch, this.dpr, this.theme);
  }

  // A still of the shown sheet: the frame area at `scale` x CSS size.
  exportPNG(scale) {
    const s = this.sheet, f = this.frameRect, k = this.baseScale(s);
    const w = Math.round(s.W * k * scale), h = Math.round(s.H * k * scale);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    drawPaper(ctx, w, h, scale, this.theme);
    const t = [0, k * scale, h, k * scale];
    const save = { pen: this.pen, zoom: this.zoom };
    this.pen = { ...this.pen };
    const kinds = this.theme.glow ? ['glow', 'ink'] : ['ink'];
    for (const kind of kinds) {
      const layer = document.createElement('canvas'); layer.width = w; layer.height = h;
      const lx = layer.getContext('2d');
      const oldDpr = this.dpr; this.dpr = scale; this.zoom = 1;
      this.strokeStyle(lx, kind);
      this.dpr = oldDpr;
      lx.beginPath();
      let n = 0;
      for (const p of s.paths) { this.emitRange(lx, t, p, 0, p.len); if (++n === 4000) { lx.stroke(); lx.beginPath(); n = 0; } }
      lx.stroke();
      ctx.globalCompositeOperation = kind === 'glow' && this.theme.dark ? 'lighter' : 'source-over';
      ctx.drawImage(layer, 0, 0);
    }
    this.pen = save.pen; this.zoom = save.zoom;
    void f;
    return c;
  }
}

// ── paper ──────────────────────────────────────────────────────────────────
const tiles = new Map();
function grainTile(dark, kraft) {
  const key = (dark ? 'd' : 'l') + (kraft ? 'k' : '');
  if (tiles.has(key)) return tiles.get(key);
  const n = 256, c = document.createElement('canvas'); c.width = c.height = n;
  const x = c.getContext('2d'), img = x.createImageData(n, n), rnd = mulberry(dark ? 7 : 3);
  for (let i = 0; i < n * n; i++) {
    const v = rnd(), o = i * 4;
    if (v < 0.5) { img.data[o] = 0; img.data[o + 1] = 0; img.data[o + 2] = 0; img.data[o + 3] = (0.5 - v) * (dark ? 46 : 34); }
    else { img.data[o] = 255; img.data[o + 1] = 255; img.data[o + 2] = 250; img.data[o + 3] = (v - 0.5) * (dark ? 14 : 44); }
  }
  x.putImageData(img, 0, 0);
  if (kraft) {
    x.globalAlpha = 0.18; x.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      x.strokeStyle = rnd() < 0.5 ? '#5a3a1c' : '#f3e2c4'; x.lineWidth = 0.5 + rnd() * 0.8;
      const a = rnd() * Math.PI, l = 8 + rnd() * 30, px = rnd() * n, py = rnd() * n;
      x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px + Math.cos(a) * l * 0.5 + rnd() * 6, py + Math.sin(a) * l * 0.5, px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke();
    }
  }
  tiles.set(key, c);
  return c;
}

export function drawPaper(ctx, w, h, dpr, th) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  ctx.fillStyle = th.paper; ctx.fillRect(0, 0, w, h);
  const rnd = mulberry(11);
  if (th.texture === 'grain' || th.texture === 'fibers') {
    for (let i = 0; i < 14; i++) {
      const cx = rnd() * w, cy = rnd() * h, rr = (0.2 + rnd() * 0.4) * Math.max(w, h);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr), darkBlob = rnd() < 0.5;
      const col = th.dark ? (darkBlob ? '0,0,0' : '255,255,255') : (darkBlob ? '120,95,60' : '255,255,250');
      g.addColorStop(0, `rgba(${col},${th.dark ? 0.035 : 0.05})`); g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    const tile = grainTile(th.dark, th.texture === 'fibers');
    const pat = ctx.createPattern(tile, 'repeat');
    ctx.save(); ctx.scale(Math.max(1, dpr / 1.5), Math.max(1, dpr / 1.5)); ctx.fillStyle = pat; ctx.fillRect(0, 0, w * 2, h * 2); ctx.restore();
  }
  if (th.texture === 'grid') {
    const step = 24 * dpr;
    ctx.strokeStyle = th.grid; ctx.lineWidth = Math.max(1, dpr * 0.6);
    ctx.beginPath();
    for (let x = (w / 2) % step; x < w; x += step) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h); }
    for (let y = (h / 2) % step; y < h; y += step) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(w, Math.round(y) + 0.5); }
    ctx.stroke();
    ctx.lineWidth = Math.max(1, dpr * 1.1); ctx.globalAlpha = 1.6;
    ctx.beginPath();
    for (let x = (w / 2) % (step * 5); x < w; x += step * 5) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h); }
    for (let y = (h / 2) % (step * 5); y < h; y += step * 5) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(w, Math.round(y) + 0.5); }
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  // vignette
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.62);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, th.dark ? 'rgba(0,0,0,0.45)' : 'rgba(70,50,20,0.13)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}

// A thumbnail: all paths of a sheet fitted in a small canvas.
export function drawThumb(canvas, sheetBufs, W, H, th) {
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  drawPaper(ctx, w, h, 1, { ...th, texture: th.texture === 'grid' ? 'grid' : 'none' });
  const k = Math.min(w / W, h / H) * 0.94, ox = (w - W * k) / 2, oy = (h + H * k) / 2;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const pass = (style, width, alpha) => {
    ctx.strokeStyle = style; ctx.lineWidth = width; ctx.globalAlpha = alpha;
    ctx.beginPath();
    for (const buf of sheetBufs) {
      let i = 1;
      for (let n = 0; n < buf[0]; n++) {
        const m = buf[i++];
        ctx.moveTo(ox + buf[i] * k, oy - buf[i + 1] * k);
        if (m === 1 || (m === 2 && buf[i] === buf[i + 2] && buf[i + 1] === buf[i + 3])) ctx.lineTo(ox + buf[i] * k + 0.01, oy - buf[i + 1] * k);
        for (let j = 1; j < m; j++) ctx.lineTo(ox + buf[i + j * 2] * k, oy - buf[i + j * 2 + 1] * k);
        i += m * 2;
      }
    }
    ctx.stroke(); ctx.globalAlpha = 1;
  };
  if (th.glow) pass(th.glow, 3, 0.18);
  pass(th.ink, Math.max(0.6, Math.min(1.1, w / 260)), 1);
}
