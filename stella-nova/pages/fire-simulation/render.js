// ============================================================================
//  FIRE SIMULATION  ·  pages/fire-simulation/render.js — Canvas 2D drawing
// ----------------------------------------------------------------------------
//  Our code (davesgames.io). Two jobs:
//    drawOverlay   the domain frame, burners and swirls, on the 2D overlay
//                  canvas over the GPU canvas (and in the CPU path)
//    drawField     the CPU path only (no GPU): background, heat and glow
//  draw() = drawField + drawOverlay (the CPU path, the node tests).
//  Temperature goes into an RGBA image at one pixel per cell (cell k =
//  j NX + i, row 0 at the bottom). Two kinds of LUT:
//    palette LUT  { n, rgba, glow } from palette.js paletteLut(): straight
//                 sRGB colour and alpha of flame and smoke (blackbody, tone
//                 mapped), and an emission-only glow table
//    byte LUT     768 bytes RGB (a colour map, or rampLut()): alpha = 3.5 t
//  Cold cells are transparent, so the theme background shows. The glow
//  pass draws a quarter-size image on top with additive blending. For a
//  palette LUT that image holds emission only, so smoke does not glow.
//  Burners and swirls draw as shapes.
//
//  rampLut(colors, stops)   768-byte LUT of a flame ramp
//  fitView(S, rect, cam), draw(ctx, S, view, look, cache, makeCanvas, cw, ch)
//  drawField(...same), drawOverlay(ctx, S, view, look, cw, ch)
//  grep -n targets: "export function rampLut", "function heatImage",
//  "function glowImage", "export function drawField", "export function drawOverlay"
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
  const f = S.f, NX = f.NX, NY = f.NY;
  if (!cache.cv || cache.cv.width !== NX || cache.cv.height !== NY) {
    cache.cv = makeCanvas(NX, NY); cache.cx = cache.cv.getContext('2d'); cache.img = cache.cx.createImageData(NX, NY);
    cache.gw = makeCanvas(Math.max(2, NX >> 2), Math.max(2, NY >> 2)); cache.gx = cache.gw.getContext('2d');
    cache.gimg = cache.gx.createImageData(cache.gw.width, cache.gw.height);
  }
  const d = cache.img.data, lut = look.lut, speed = look.colorBy === 'speed';
  const P = lut && lut.rgba ? lut.rgba : null, PN = P ? lut.n - 1 : 0;
  let vmax = 1e-6;
  if (speed) for (let k = 0; k < f.numCells; k++) vmax = Math.max(vmax, Math.abs(f.v[k]), Math.abs(f.u[k]));
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const k = j * NX + i, o = ((NY - 1 - j) * NX + i) * 4;
    let t = speed ? Math.min(1, Math.hypot(f.u[k], f.v[k]) / vmax) : f.t[k];
    if (!(t > 0)) t = 0; else if (t > 1) t = 1;
    if (P) {
      const q = ((t * PN + 0.5) | 0) * 4;
      d[o] = P[q]; d[o + 1] = P[q + 1]; d[o + 2] = P[q + 2]; d[o + 3] = speed ? 255 : P[q + 3];
    } else {
      const q = (t * 255 | 0) * 3;
      d[o] = lut[q]; d[o + 1] = lut[q + 1]; d[o + 2] = lut[q + 2];
      d[o + 3] = speed ? 255 : Math.min(255, t * 255 * 3.5);
    }
  }
  cache.cx.putImageData(cache.img, 0, 0);
  return cache.cv;
}
// Quarter-size emission image for the glow pass (palette LUT only): each
// pixel is the mean glow colour of a 4 x 4 block of cells, weighted by
// the glow alpha. Smoke has zero glow alpha, so smoke does not glow.
function glowImage(S, look, cache) {
  const f = S.f, NX = f.NX, NY = f.NY, G = look.lut.glow, PN = look.lut.n - 1;
  const GW = cache.gw.width, GH = cache.gw.height, d = cache.gimg.data;
  for (let gj = 0; gj < GH; gj++) for (let gi = 0; gi < GW; gi++) {
    let r = 0, g = 0, b = 0, a = 0, c = 0;
    const i1 = Math.min(NX, gi * 4 + 4), j1 = Math.min(NY, gj * 4 + 4);
    for (let j = gj * 4; j < j1; j++) for (let i = gi * 4; i < i1; i++) {
      let t = f.t[j * NX + i]; if (!(t > 0)) t = 0; else if (t > 1) t = 1;
      const q = ((t * PN + 0.5) | 0) * 4, w = G[q + 3];
      r += G[q] * w; g += G[q + 1] * w; b += G[q + 2] * w; a += w; c++;
    }
    const o = ((GH - 1 - gj) * GW + gi) * 4;
    if (a > 0) { d[o] = r / a; d[o + 1] = g / a; d[o + 2] = b / a; d[o + 3] = a / Math.max(1, c); }
    else d[o] = d[o + 1] = d[o + 2] = d[o + 3] = 0;
  }
  cache.gx.putImageData(cache.gimg, 0, 0);
  return cache.gw;
}

// CPU path: background gradient, the heat image and the glow.
export function drawField(ctx, S, view, look, cache, makeCanvas, cw, ch) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  const g = ctx.createLinearGradient(0, 0, 0, ch); g.addColorStop(0, look.bg2); g.addColorStop(1, look.bg);
  ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
  if (!S.f || !S.f.cpu) return;
  const img = heatImage(S, look, cache, makeCanvas);
  const x0 = view.ox, y0 = view.oy - S.H * view.s, w = S.W * view.s, h = S.H * view.s;
  ctx.save(); ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, x0, y0, w, h);
  if (look.glow > 0 && look.colorBy !== 'speed') {
    if (look.lut && look.lut.glow) glowImage(S, look, cache);
    else { cache.gx.clearRect(0, 0, cache.gw.width, cache.gw.height); cache.gx.drawImage(img, 0, 0, cache.gw.width, cache.gw.height); }
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = look.glow * 0.7;
    ctx.drawImage(cache.gw, x0 - w * 0.01, y0 - h * 0.02, w * 1.02, h * 1.03);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
}

// Both paths: the domain frame, burners, swirls and (CPU path) the veil.
// clear: the overlay canvas over the GPU canvas starts transparent.
export function drawOverlay(ctx, S, view, look, cw, ch, clear) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (clear) ctx.clearRect(0, 0, cw, ch);
  if (!S.f) return;
  const X = x => view.ox + x * view.s, Y = y => view.oy - y * view.s, h = S.f.h;
  const x0 = X(0), y0 = Y(S.H), w = S.W * view.s, hh = S.H * view.s;
  ctx.strokeStyle = look.wall; ctx.globalAlpha = 0.25; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, w, hh); ctx.globalAlpha = 1;
  if (look.showBurners) for (const b of S.cfg.burners) {
    ctx.lineWidth = Math.max(2, view.s * 0.012);
    ctx.strokeStyle = b.held ? look.accent : look.burner; ctx.fillStyle = look.burner;
    const bx = X(b.x), by = Y(b.y);
    if (b.kind === 'ring') { ctx.beginPath(); ctx.arc(bx, by, (b.r + h) * view.s, 0, Math.PI * 2); ctx.stroke(); }
    else if (b.kind === 'disc') { ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.arc(bx, by, b.r * 0.7 * view.s, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; if (b.held) ctx.stroke(); }
    else if (b.kind === 'log') { const lw = b.r * 2.6 * view.s, lh = Math.max(6, 0.016 * view.s); ctx.fillStyle = look.log; ctx.beginPath(); (ctx.roundRect ? ctx.roundRect(bx - lw / 2, by - lh / 2, lw, lh, lh / 2) : ctx.rect(bx - lw / 2, by - lh / 2, lw, lh)); ctx.fill(); if (b.held) ctx.stroke(); }
    else { const tw = Math.max(5, b.r * 0.5 * view.s); ctx.beginPath(); ctx.moveTo(bx - tw, by + tw * 2.2); ctx.lineTo(bx + tw, by + tw * 2.2); ctx.lineTo(bx + tw * 0.6, by); ctx.lineTo(bx - tw * 0.6, by); ctx.closePath(); ctx.fill(); if (b.held) ctx.stroke(); }
    if (!b.on) { ctx.globalAlpha = 0.6; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(bx, by, (b.r + h) * view.s, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; }
  }
  if (look.showSwirls) {
    ctx.strokeStyle = look.ink; ctx.lineWidth = 1;
    for (const s of S.swirls || []) { ctx.globalAlpha = 0.35 * Math.min(1, Math.abs(s.w) / Math.max(1e-6, Math.abs(s.om))); ctx.beginPath(); ctx.arc(X(s.x), Y(s.y), s.R * view.s, 0, Math.PI * 2); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
  if (look.veil > 0) { ctx.globalAlpha = look.veil; ctx.fillStyle = look.bg; ctx.fillRect(0, 0, cw, ch); ctx.globalAlpha = 1; }
}

export function draw(ctx, S, view, look, cache, makeCanvas, cw, ch) {
  drawField(ctx, S, view, look, cache, makeCanvas, cw, ch);
  drawOverlay(ctx, S, view, look, cw, ch, false);
}

export function pickBurner(S, x, y) {
  let best = null, bd = Infinity;
  for (const b of S.cfg.burners) { const d = Math.hypot(b.x - x, b.y - y); const reach = b.r * (b.kind === 'log' ? 1.4 : 1) + 0.04; if (d < reach && d < bd) { bd = d; best = b; } }
  return best;
}
export { burnCell };
