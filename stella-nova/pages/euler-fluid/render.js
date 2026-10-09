// ============================================================================
//  EULER FLUID  ·  pages/euler-fluid/render.js — Canvas 2D renderer
// ----------------------------------------------------------------------------
//  Our code (davesgames.io). The grid field goes into an ImageData at one
//  pixel per cell, then drawImage scales it into the view (smoothed, so the
//  cells do not show as blocks). Walls and obstacles draw as vector shapes
//  on top, then streamlines, velocity arrows and a field legend.
//
//  fitView(S, rect)           the world-to-device map of the domain
//  draw(ctx, S, view, look, cache, makeCanvas, cw, ch)
//  look = { bg, bg2, ink, wall, accent, colorBy, lut (768 bytes), stream,
//           vel, smooth, palette, veil }
//
//  grep -n targets: "export function fitView", "function fieldImage",
//  "export function draw"
// ============================================================================
import { obstacleSDF } from './solver.js';

export function fitView(S, rect, cam) {
  const z = cam && cam.zoom ? cam.zoom : 1;
  const s = Math.min(rect.w / S.W, rect.h / S.H) * z;
  const cx = cam && cam.cx != null ? cam.cx : S.W / 2, cy = cam && cam.cy != null ? cam.cy : S.H / 2;
  return { s, ox: rect.x + rect.w / 2 - cx * s, oy: rect.y + rect.h / 2 + cy * s, rect };
}

const GREY = (() => { const l = new Uint8Array(768); for (let i = 0; i < 256; i++) l[3 * i] = l[3 * i + 1] = l[3 * i + 2] = i; return l; })();
const hex = h => { const n = parseInt(String(h).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

// The field of each cell, as t in 0..1, into an RGBA image.
function fieldImage(S, look, cache, makeCanvas) {
  const f = S.f, n = f.numY, NX = f.numX, NY = f.numY, h = f.h, by = look.colorBy;
  if (!cache.cv || cache.cv.width !== NX || cache.cv.height !== NY) {
    cache.cv = makeCanvas(NX, NY); cache.cx = cache.cv.getContext('2d');
    cache.img = cache.cx.createImageData(NX, NY); cache.val = new Float32Array(NX * NY);
  }
  const val = cache.val, lut = look.lut || GREY, bg = hex(look.bg);
  let lo = Infinity, hi = -Infinity;
  const smoke = k => (S.kind === 'paint' || S.kind === 'jets') ? f.m[k] : 1 - f.m[k];
  for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
    const k = i * n + j; let v = 0;
    if (by === 'pressure' || by === 'pressmoke') v = f.p[k];
    else if (by === 'speed') { const u = i < NX - 1 ? (f.u[k] + f.u[k + n]) * 0.5 : f.u[k], w = j < NY - 1 ? (f.v[k] + f.v[k + 1]) * 0.5 : f.v[k]; v = Math.hypot(u, w); }
    else if (by === 'vorticity') { v = (i > 0 && j > 0 && i < NX - 1 && j < NY - 1) ? ((f.v[k + n] - f.v[k - n]) - (f.u[k + 1] - f.u[k - 1])) / (2 * h) : 0; }
    else v = smoke(k);
    val[j * NX + i] = v;
    if (f.s[k] !== 0 && Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  }
  if (by === 'smoke') { lo = 0; hi = 1; }
  else {
    // a robust range: the 1st and 99th percentile of the open cells, so one
    // hot cell at a moving lid or a thrown obstacle does not wash out the field
    const smp = cache.smp || (cache.smp = new Float32Array(4096)); let m = 0;
    const stride = Math.max(1, Math.floor(NX * NY / 4096));
    for (let q = 0; q < NX * NY && m < 4096; q += stride) { const i = q % NX, j = (q / NX) | 0; if (f.s[i * n + j] !== 0 && Number.isFinite(val[q])) smp[m++] = val[q]; }
    if (m > 16) { const a = smp.subarray(0, m).sort(); lo = a[Math.floor(m * 0.01)]; hi = a[Math.floor(m * 0.99)]; }
    if (by === 'vorticity') { const w = Math.max(Math.abs(lo), Math.abs(hi), 1e-6); lo = -w; hi = w; }
    if (by === 'speed') lo = 0;
  }
  if (!(hi > lo)) { hi = lo + 1; }
  cache.range = [lo, hi];
  const d = cache.img.data, inv = 1 / (hi - lo);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const k = i * n + j, o = ((NY - 1 - j) * NX + i) * 4;
    if (f.s[k] === 0) { d[o] = bg[0]; d[o + 1] = bg[1]; d[o + 2] = bg[2]; d[o + 3] = 255; continue; }
    let t = (val[j * NX + i] - lo) * inv; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const q = (t * 255 | 0) * 3;
    let r = lut[q], g = lut[q + 1], b = lut[q + 2];
    if (by === 'pressmoke') { const s = 1 - smoke(k) * 0.85; r *= s; g *= s; b *= s; }
    d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
  }
  cache.cx.putImageData(cache.img, 0, 0);
  return cache.cv;
}

function obstaclePath(ctx, o, view, grow = 0) {
  const X = x => view.ox + x * view.s, Y = y => view.oy - y * view.s;
  ctx.beginPath();
  if (o.shape === 'circle') { ctx.arc(X(o.x), Y(o.y), (o.r + grow) * view.s, 0, Math.PI * 2); return; }
  const c = Math.cos(o.a), s = Math.sin(o.a), pts = [];
  if (o.shape === 'ellipse') { for (let k = 0; k <= 40; k++) { const t = k / 40 * Math.PI * 2; pts.push([Math.cos(t) * (o.r * 1.4 + grow), Math.sin(t) * (o.r * 0.42 + grow)]); } }
  else { const ax = (o.shape === 'plate' ? o.r * 1.2 : o.r * 0.85) + grow, ay = (o.shape === 'plate' ? Math.max(0.012, o.r * 0.12) : o.r * 0.85) + grow; pts.push([-ax, -ay], [ax, -ay], [ax, ay], [-ax, ay]); }
  pts.forEach(([px, py], k) => { const x = X(o.x + c * px - s * py), y = Y(o.y + s * px + c * py); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.closePath();
}

export function draw(ctx, S, view, look, cache, makeCanvas, cw, ch) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, ch); g.addColorStop(0, look.bg2); g.addColorStop(1, look.bg);
  ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
  const f = S.f; if (!f) return;
  const img = fieldImage(S, look, cache, makeCanvas);
  const X = x => view.ox + x * view.s, Y = y => view.oy - y * view.s;
  ctx.save();
  ctx.imageSmoothingEnabled = look.smooth !== false;
  ctx.drawImage(img, X(0), Y(S.H), S.W * view.s, S.H * view.s);
  ctx.restore();
  // walls: the solid border cells as panels
  ctx.fillStyle = look.wallFill; ctx.strokeStyle = look.wall; ctx.lineWidth = Math.max(1, view.s * 0.003);
  const h = f.h, n = f.numY, wall = S.wall;
  const band = (x0, y0, x1, y1) => { ctx.fillRect(X(x0), Y(y1), (x1 - x0) * view.s, (y1 - y0) * view.s); };
  if (wall[0 * n + 1]) band(0, 0, h, S.H);
  if (wall[(f.numX - 1) * n + 1]) band(S.W - h, 0, S.W, S.H);
  if (wall[1 * n + 0]) band(0, 0, S.W, h);
  if (wall[1 * n + f.numY - 1]) band(0, S.H - h, S.W, S.H);
  ctx.strokeRect(X(0), Y(S.H), S.W * view.s, S.H * view.s);
  // streamlines (upstream: every 5 cells, 15 steps of 0.01 s)
  if (look.stream) {
    ctx.strokeStyle = look.ink; ctx.globalAlpha = 0.42; ctx.lineWidth = Math.max(1, view.s * 0.0022);
    const step = Math.max(3, Math.round(f.numY / 20));
    for (let i = 1; i < f.numX - 1; i += step) for (let j = 1; j < f.numY - 1; j += step) {
      let x = (i + 0.5) * h, y = (j + 0.5) * h;
      ctx.beginPath(); ctx.moveTo(X(x), Y(y));
      for (let q = 0; q < 15; q++) {
        const u = f.sampleField(x, y, 0), v = f.sampleField(x, y, 1);
        x += u * 0.01; y += v * 0.01;
        if (x > f.numX * h || !Number.isFinite(x + y)) break;
        ctx.lineTo(X(x), Y(y));
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  if (look.vel) {
    ctx.strokeStyle = look.accent; ctx.globalAlpha = 0.7; ctx.lineWidth = 1;
    const step = Math.max(2, Math.round(f.numY / 30)), sc = 0.02;
    ctx.beginPath();
    for (let i = 1; i < f.numX - 1; i += step) for (let j = 1; j < f.numY - 1; j += step) {
      const k = i * n + j, x = (i + 0.5) * h, y = (j + 0.5) * h, u = (f.u[k] + f.u[k + n]) * 0.5, v = (f.v[k] + f.v[k + 1]) * 0.5;
      if (!Number.isFinite(u + v)) continue;
      ctx.moveTo(X(x), Y(y)); ctx.lineTo(X(x + u * sc), Y(y + v * sc));
    }
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  // obstacles
  const pal = look.palette || ['#ddd'];
  S.obstacles.forEach((o, k) => {
    obstaclePath(ctx, o, view, h * 0.5);
    ctx.fillStyle = pal[k % pal.length]; ctx.fill();
    ctx.lineWidth = Math.max(1.5, view.s * 0.004); ctx.strokeStyle = look.outline; ctx.stroke();
    if (o.held) { ctx.lineWidth = Math.max(2, view.s * 0.006); ctx.strokeStyle = look.accent; ctx.stroke(); }
  });
  if (S.finger) { obstaclePath(ctx, S.finger, view, 0); ctx.strokeStyle = look.accent; ctx.lineWidth = 2; ctx.globalAlpha = 0.8; ctx.stroke(); ctx.globalAlpha = 1; }
  // legend: the colour bar with its range
  if (look.legend !== false && cache.range) {
    const lw = Math.min(220, view.rect.w * 0.3), lh = 8, lx = view.rect.x + view.rect.w - lw - 14, ly = view.rect.y + 14;
    const lut = look.lut || GREY, gr = ctx.createLinearGradient(lx, 0, lx + lw, 0);
    for (let k = 0; k <= 8; k++) { const q = (k / 8 * 255 | 0) * 3; gr.addColorStop(k / 8, `rgb(${lut[q]},${lut[q + 1]},${lut[q + 2]})`); }
    ctx.fillStyle = gr; ctx.fillRect(lx, ly, lw, lh);
    ctx.strokeStyle = look.ink; ctx.globalAlpha = 0.5; ctx.lineWidth = 1; ctx.strokeRect(lx, ly, lw, lh); ctx.globalAlpha = 1;
    const fs = Math.round(11 * (look.dpr || 1));
    ctx.fillStyle = 'rgba(6,8,13,0.55)'; ctx.fillRect(lx - 8, ly - 6, lw + 16, lh + fs + 16);
    ctx.fillStyle = gr; ctx.fillRect(lx, ly, lw, lh);
    ctx.font = `${fs}px Inter, system-ui, sans-serif`; ctx.fillStyle = '#e6ebf2'; ctx.textBaseline = 'top';
    const [lo, hi] = cache.range, unit = { pressure: ' Pa', pressmoke: ' Pa', speed: ' m/s', vorticity: ' 1/s', smoke: '' }[look.colorBy];
    const fmt = v => Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(1) : v.toFixed(2);
    ctx.textAlign = 'left'; ctx.fillText(fmt(lo) + unit, lx, ly + lh + 4);
    ctx.textAlign = 'right'; ctx.fillText(fmt(hi) + unit, lx + lw, ly + lh + 4);
    ctx.textAlign = 'left';
  }
  if (look.veil > 0) { ctx.globalAlpha = look.veil; ctx.fillStyle = look.bg; ctx.fillRect(0, 0, cw, ch); ctx.globalAlpha = 1; }
}

// Pick the obstacle under a world point (or null).
export function pickObstacle(S, x, y, pad = 0.02) {
  let best = null, bd = pad;
  for (const o of S.obstacles) { const d = obstacleSDF(o, x, y); if (d < bd) { bd = d; best = o; } }
  return best;
}
