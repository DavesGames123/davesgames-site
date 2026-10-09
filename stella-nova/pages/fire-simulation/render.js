// ============================================================================
//  FIRE SIMULATION  ·  pages/fire-simulation/render.js — Canvas 2D renderer
// ----------------------------------------------------------------------------
//  Our code (davesgames.io). Temperature goes into an RGBA image at one
//  pixel per cell through a flame ramp (FIRE in scene.js; 'Classic' is the
//  upstream getFireColor) or a colour map. Cold cells are transparent, so
//  the theme background shows. A glow pass draws a quarter-size copy on
//  top with additive blending. Burners and swirls draw as shapes.
//
//  rampLut(colors, stops)   768-byte LUT of a flame ramp
//  fitView(S, rect, cam), draw(ctx, S, view, look, cache, makeCanvas, cw, ch)
//  grep -n targets: "export function rampLut", "function heatImage", "export function draw"
// ============================================================================
import { burnCell } from './solver.js';

const hex = h => { const n = parseInt(String(h).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export function rampLut(colors, stops) {
  const out = new Uint8Array(768), C = colors.map(hex);
  for (let k = 0; k < 256; k++) {
    const t = k / 255; let i = 0; while (i < stops.length - 2 && t > stops[i + 1]) i++;
    const u = Math.min(1, Math.max(0, (t - stops[i]) / (stops[i + 1] - stops[i])));
    for (let c = 0; c < 3; c++) out[k * 3 + c] = Math.round(C[i][c] + (C[i + 1][c] - C[i][c]) * u);
  }
  return out;
}
export function fitView(S, rect, cam) {
  const z = cam && cam.zoom ? cam.zoom : 1, s = Math.min(rect.w / S.W, rect.h / S.H) * z;
  const cx = cam && cam.cx != null ? cam.cx * S.W : S.W / 2, cy = cam && cam.cy != null ? cam.cy * S.H : S.H / 2;
  return { s, ox: rect.x + rect.w / 2 - cx * s, oy: rect.y + rect.h / 2 + cy * s, rect };
}

function heatImage(S, look, cache, makeCanvas) {
  const f = S.f, n = f.numY, NX = f.numX, NY = f.numY;
  if (!cache.cv || cache.cv.width !== NX || cache.cv.height !== NY) {
    cache.cv = makeCanvas(NX, NY); cache.cx = cache.cv.getContext('2d'); cache.img = cache.cx.createImageData(NX, NY);
    cache.gw = makeCanvas(Math.max(2, NX >> 2), Math.max(2, NY >> 2)); cache.gx = cache.gw.getContext('2d');
  }
  const d = cache.img.data, lut = look.lut, speed = look.colorBy === 'speed';
  let vmax = 1e-6;
  if (speed) for (let k = 0; k < f.numCells; k++) vmax = Math.max(vmax, Math.abs(f.v[k]), Math.abs(f.u[k]));
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const k = i * n + j, o = ((NY - 1 - j) * NX + i) * 4;
    let t = speed ? Math.min(1, Math.hypot(f.u[k], f.v[k]) / vmax) : f.t[k];
    if (!(t > 0)) t = 0; else if (t > 1) t = 1;
    const q = (t * 255 | 0) * 3;
    d[o] = lut[q]; d[o + 1] = lut[q + 1]; d[o + 2] = lut[q + 2];
    d[o + 3] = speed ? 255 : Math.min(255, t * 255 * 3.5);
  }
  cache.cx.putImageData(cache.img, 0, 0);
  return cache.cv;
}

export function draw(ctx, S, view, look, cache, makeCanvas, cw, ch) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  const g = ctx.createLinearGradient(0, 0, 0, ch); g.addColorStop(0, look.bg2); g.addColorStop(1, look.bg);
  ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
  if (!S.f) return;
  const X = x => view.ox + x * view.s, Y = y => view.oy - y * view.s;
  const img = heatImage(S, look, cache, makeCanvas);
  const x0 = X(0), y0 = Y(S.H), w = S.W * view.s, h = S.H * view.s;
  ctx.save(); ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, x0, y0, w, h);
  if (look.glow > 0 && look.colorBy !== 'speed') {
    cache.gx.clearRect(0, 0, cache.gw.width, cache.gw.height);
    cache.gx.drawImage(img, 0, 0, cache.gw.width, cache.gw.height);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = look.glow * 0.7;
    ctx.drawImage(cache.gw, x0 - w * 0.01, y0 - h * 0.02, w * 1.02, h * 1.03);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
  // the domain frame
  ctx.strokeStyle = look.wall; ctx.globalAlpha = 0.25; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, w, h); ctx.globalAlpha = 1;
  // burners
  if (look.showBurners) for (const b of S.cfg.burners) {
    ctx.lineWidth = Math.max(2, view.s * 0.012);
    ctx.strokeStyle = b.held ? look.accent : look.burner; ctx.fillStyle = look.burner;
    const bx = X(b.x), by = Y(b.y);
    if (b.kind === 'ring') { ctx.beginPath(); ctx.arc(bx, by, (b.r + S.f.h) * view.s, 0, Math.PI * 2); ctx.stroke(); }
    else if (b.kind === 'disc') { ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.arc(bx, by, b.r * 0.7 * view.s, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; if (b.held) ctx.stroke(); }
    else if (b.kind === 'log') { const lw = b.r * 2.6 * view.s, lh = Math.max(6, S.f.h * 4 * view.s); ctx.fillStyle = look.log; ctx.beginPath(); (ctx.roundRect ? ctx.roundRect(bx - lw / 2, by - lh / 2, lw, lh, lh / 2) : ctx.rect(bx - lw / 2, by - lh / 2, lw, lh)); ctx.fill(); if (b.held) ctx.stroke(); }
    else { const tw = Math.max(5, b.r * 0.5 * view.s); ctx.beginPath(); ctx.moveTo(bx - tw, by + tw * 2.2); ctx.lineTo(bx + tw, by + tw * 2.2); ctx.lineTo(bx + tw * 0.6, by); ctx.lineTo(bx - tw * 0.6, by); ctx.closePath(); ctx.fill(); if (b.held) ctx.stroke(); }
    if (!b.on) { ctx.globalAlpha = 0.6; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(bx, by, (b.r + S.f.h) * view.s, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; }
  }
  if (look.showSwirls) {
    ctx.strokeStyle = look.ink; ctx.globalAlpha = 0.35; ctx.lineWidth = 1;
    const f = S.f;
    for (let k = 0; k < f.numSwirls; k++) { ctx.beginPath(); ctx.arc(X(f.swirlX[k]), Y(f.swirlY[k]), S.cfg.swirlMaxRadius * view.s, 0, Math.PI * 2); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
  if (look.veil > 0) { ctx.globalAlpha = look.veil; ctx.fillStyle = look.bg; ctx.fillRect(0, 0, cw, ch); ctx.globalAlpha = 1; }
}

export function pickBurner(S, x, y) {
  let best = null, bd = Infinity;
  for (const b of S.cfg.burners) { const d = Math.hypot(b.x - x, b.y - y); const reach = b.r * (b.kind === 'log' ? 1.4 : 1) + 0.04; if (d < reach && d < bd) { bd = d; best = b; } }
  return best;
}
export { burnCell };
